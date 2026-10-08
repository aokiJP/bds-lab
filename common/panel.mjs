// node lab.mjs panel <check|shots|hook>: the management panel (panel/), its sign-in service (auth/) and the workflows' App
// tokens tried right after a change, without a deploy.
//   check [--quick] [--all] [files..]  the checks the changed files need (git's changed and new files when none are named):
//                                       ESLint, the offline tests, and the real browser (panel-browser, ~1 min; --quick: not)
//   shots [dir]                         the real-browser run with a picture of each tab it opens (default .lab/panel-shots)
//   hook                                for Claude Code's PostToolUse: a file just edited → its quick checks; a failure is told
//                                       back to the AI at once (exit 2), anything else is silent
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BROWSER = 'tests/panel-browser.mjs';
// (a file → the tests that hold it; the first match wins its group, all groups add up)
const RULES = [
  [/^panel\/lib\/(policy|audit|members)\.mjs$/, ['tests/governance-offline.mjs']],
  [/^panel\/(lib|ui)\/setup\.mjs$/, ['tests/setup-offline.mjs']],
  [/^panel\/(lib\/session|ui\/signin)\.mjs$/, ['tests/session-offline.mjs']],
  [/^panel\//, ['tests/panel-offline.mjs', BROWSER]],
  [/^host\/template\//, ['tests/panel-offline.mjs']],
  [/^auth\//, ['tests/auth-offline.mjs', BROWSER]],
  [/^common\/(panel-config|ghapp)\.mjs$/, ['tests/appci-offline.mjs', 'tests/panel-offline.mjs']],
  [/^common\/panel\.mjs$/, ['tests/panel-offline.mjs']],
  [/^app\/(app\.mjs|lib\/runfiles\.mjs)$/, ['tests/panel-offline.mjs']],
  [/^tests\/(panel-offline|panel-browser|governance-offline|setup-offline|session-offline|auth-offline|appci-offline)\.mjs$/, (f) => [f]],
];
export const ALL = ['tests/panel-offline.mjs', 'tests/governance-offline.mjs', 'tests/setup-offline.mjs', 'tests/session-offline.mjs', 'tests/auth-offline.mjs', 'tests/appci-offline.mjs', BROWSER];
const LINTABLE = /^(panel|auth)\/.*\.(m?js)$|^common\/(panel|panel-config|ghapp)\.mjs$/;

/** the changed files → { lint: [files], tests: [files] } (pure); quick leaves the browser out */
export function plan(files, { quick = false } = {}) {
  const tests = new Set(), lint = [];
  for (const f0 of files) {
    const f = f0.replace(/\\/g, '/').replace(/^\.\//, '');
    if (LINTABLE.test(f)) lint.push(f);
    if (f.startsWith('panel/lib/') || f.startsWith('panel/ui/')) tests.add('tests/panel-offline.mjs');
    for (const [re, t] of RULES) if (re.test(f)) for (const x of typeof t === 'function' ? t(f) : t) tests.add(x);
  }
  return { lint: [...new Set(lint)], tests: ALL.filter((t) => tests.has(t) && !(quick && t === BROWSER)) };
}
/** what git sees changed (staged, not, and new files) */
export function changed(cwd = TOP) {
  const run = (a) => spawnSync('git', a, { cwd, encoding: 'utf8' }).stdout ?? '';
  return [...new Set([...run(['diff', '--name-only', 'HEAD']).split('\n'), ...run(['ls-files', '--others', '--exclude-standard']).split('\n')].filter(Boolean))];
}
/** a test's or ESLint's output → the lines worth reading (pure): its failures and what follows each, else its tail */
export function failLines(out, max = 30) {
  const l = String(out).split('\n'), keep = [];
  l.forEach((x, i) => { if (/^(FAIL|✘|not ok)|\berror\b|Error:/.test(x)) keep.push(...l.slice(i, i + 6)); });
  return [...new Set(keep.length ? keep : l.slice(-12))].slice(0, max);
}

function runOne(cmd, args, env = {}) {
  const t0 = Date.now(), r = spawnSync(cmd, args, { cwd: TOP, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600_000, maxBuffer: 64 << 20 });
  return { ok: r.status === 0, ms: Date.now() - t0, out: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` };
}
// (ESLint as this machine has it: the repository's own, else one on the PATH; none → said and left out)
const LOCAL_ESLINT = path.join(TOP, 'node_modules', 'eslint', 'bin', 'eslint.js');
const hasEslint = () => fs.existsSync(LOCAL_ESLINT) || spawnSync(process.platform === 'win32' ? 'eslint.cmd' : 'eslint', ['--version'], { encoding: 'utf8' }).status === 0;
const eslint = (files) => (fs.existsSync(LOCAL_ESLINT) ? runOne(process.execPath, [LOCAL_ESLINT, '-c', 'tests/eslint.config.mjs', ...files]) : runOne(process.platform === 'win32' ? 'eslint.cmd' : 'eslint', ['-c', 'tests/eslint.config.mjs', ...files]));

/** the checks run → true when all passed; out: each one ✔/✘ with its time, a failure's lines */
export function check({ files, quick = false, all = false, out = console.log } = {}) {
  const p = all ? { lint: ['panel', 'auth', 'common/panel.mjs', 'common/panel-config.mjs', 'common/ghapp.mjs'], tests: ALL.filter((t) => !(quick && t === BROWSER)) } : plan(files ?? changed(), { quick });
  if (!p.lint.length && !p.tests.length) { out('panel: 変えたファイルに、パネルの試験の要るものはありません（--all ですべて）'); return true; }
  let ok = true;
  const say = (name, r) => { ok &&= r.ok; out(`${r.ok ? '✔' : '✘'} ${name}（${(r.ms / 1000).toFixed(1)} 秒）`); if (!r.ok) for (const x of failLines(r.out)) out(`    ${x}`); };
  if (p.lint.length) {
    if (hasEslint()) say(`ESLint ${p.lint.length} 個`, eslint(p.lint));
    else out('・ ESLint がありません（npm i -g eslint）: とばします');
  }
  for (const t of p.tests) say(t, runOne(process.execPath, [t]));
  out(ok ? 'PASS panel check' : 'FAIL panel check: ✘ の行を直してから、もう一度');
  return ok;
}

export async function panelCmd(args, out = console.log) {
  const [sub = 'check', ...rest] = args;
  if (sub === 'check') return check({ quick: rest.includes('--quick'), all: rest.includes('--all'), files: rest.filter((a) => !a.startsWith('--')).length ? rest.filter((a) => !a.startsWith('--')) : undefined, out });
  if (sub === 'shots') {
    const dir = path.resolve(TOP, rest[0] ?? '.lab/panel-shots');
    fs.rmSync(dir, { recursive: true, force: true });
    const r = runOne(process.execPath, [BROWSER], { PANEL_SHOTS: dir });
    for (const x of failLines(r.out)) if (!r.ok) out(`    ${x}`);
    const pics = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
    out(`${r.ok ? '✔' : '✘'} 本物のブラウザで ${pics.length} 枚: ${path.relative(TOP, dir)}/`);
    for (const f of pics) out(`  ${path.relative(TOP, path.join(dir, f))}`);
    return r.ok;
  }
  if (sub === 'hook') {
    // (Claude Code's PostToolUse: { tool_input: { file_path } } on stdin; only the panel's files are checked, quickly)
    let file = '';
    try { file = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')?.tool_input?.file_path ?? ''; } catch { return true; }
    const rel = path.relative(TOP, path.resolve(TOP, file)).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) return true;
    const p = plan([rel], { quick: true });
    if (!p.lint.length && !p.tests.length) return true;
    const lines = [];
    if (check({ files: [rel], quick: true, out: (x) => lines.push(x) })) return true;
    process.stderr.write(`${rel} を変えたあとのパネルの試験（node lab.mjs panel check --quick）:\n${lines.join('\n')}\n`);
    process.exit(2);
  }
  out('usage: node lab.mjs panel check [--quick] [--all] [files..] | shots [dir] | hook');
  return false;
}
