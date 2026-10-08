// node lab.mjs unitci (unit.yml, in the lab's own GitHub Actions): a unit made, taken in, tested or finished from the management
// panel's 「アドオン」 — no computer of the person's in between. The workflow's inputs come as JOB UNIT TITLE REQUEST FILE WORDS;
// plan(env) checks them by the panel's own rules (panel/lib/workspace.mjs, panel/lib/units.mjs) and says the one command:
//   new            node lab.mjs bds new <unit> "<title>" ["<request>"]
//   import         node lab.mjs import incoming/<f> ["<words>"] [--name <unit>]
//   test sim go    node lab.mjs <job> -a <unit>
// The words go to it as arguments (never through a shell), on the bds lab (LAB_KIND), and what it prints — the lab's and the
// person's words — is shown with workflow commands stopped (no line of it is taken for one). The result: the run's summary,
// an annotation when it failed (notify tells it) and the step's outputs ok and unit (new / import: the unit made,
// bds/addons/<unit> — unit.yml commits it; go leaves bds/dist/*.mcaddon for unit.yml to upload as unit-<unit>).
//   unitci [--dry]    --dry: the checked command alone, nothing run (anywhere; the rest only inside Actions)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UNIT } from '../panel/lib/units.mjs';
import * as W from '../panel/lib/workspace.mjs';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// (a word shown as typed when it is plain, quoted when not; long ones shortened — for the log only, never run)
const shown = (a) => (/^[\w./:@-]+$/.test(a) ? a : JSON.stringify(a.length > 80 ? `${a.slice(0, 79)}…` : a));
const made = (job, unit, args) => ({ job, unit, args, show: `node ${args.map(shown).join(' ')}` });

/** the workflow's inputs (the environment: JOB UNIT TITLE REQUEST FILE WORDS) → { job, unit, args (to node: lab.mjs …), show }
 *  or { error } in words (pure). The error never repeats what was given (it is shown in the log) */
export function plan(env = {}) {
  const v = (k) => String(env[k] ?? '').trim();
  const job = v('JOB'), unit = v('UNIT'), title = v('TITLE'), request = v('REQUEST'), file = v('FILE'), words = v('WORDS');
  if (!W.JOBS.includes(job)) return { error: `JOB は ${W.JOBS.join('・')} のどれか` };
  if (job === 'import') {
    if (file.length > W.LIMITS.file || !W.INCOMING.test(file) || file.includes('..')) return { error: 'FILE は incoming/<名前>（.mcaddon・.mcpack・.zip。英数字と . _ -）' };
    if (unit && !UNIT.test(unit)) return { error: `UNIT: ${W.UNIT_SAY}` };
    const bad = W.textProblem(words, { max: W.LIMITS.words, what: 'WORDS' });
    if (bad) return { error: bad };
    return made(job, unit, ['lab.mjs', 'import', file, ...(words ? [words] : []), ...(unit ? ['--name', unit] : [])]);
  }
  if (!UNIT.test(unit)) return { error: `UNIT: ${W.UNIT_SAY}` };
  if (job === 'new') {
    const t = title || unit, bad = W.textProblem(t, { max: W.LIMITS.title, line: true, what: 'TITLE' }) || W.textProblem(request, { max: W.LIMITS.request, what: 'REQUEST' });
    if (bad) return { error: bad };
    return made(job, unit, ['lab.mjs', 'bds', 'new', unit, t, ...(request ? [request] : [])]);
  }
  return made(job, unit, ['lab.mjs', job, '-a', unit]);
}
/** the unit `new` or `import` made, from what it printed: `OK bds/addons/<name>/…` (pure); null when none */
export function madeUnit(lines) {
  for (const l of lines ?? []) { const m = /^OK bds\/addons\/([a-z0-9_]{1,60})\//.exec(String(l)); if (m) return m[1]; }
  return null;
}
// (a code block that what it holds cannot close: more backticks than its longest run)
const fence = (text) => '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length + 1)));
/** the run's summary (Markdown, pure): what was done, where it went, the last lines the lab printed */
export function summaryText({ plan: p, ok, lines = [], unit = null }) {
  if (p.error) return `## ❌ unitci: 始められません\n\n- ${p.error}\n`;
  const said = { new: `ユニット bds/addons/${unit ?? p.unit} を作りました（unit.yml が既定の枝に入れます）`, import: `bds/addons/${unit ?? '?'} に取り込みました（unit.yml が既定の枝に入れます）`,
    test: '試験が通りました', sim: 'すばやい試し（sim）が通りました', go: `.mcaddon ができました（成果物 unit-${p.unit}）` }[p.job];
  const tail = lines.slice(-30).map((l) => l.slice(0, 300)).join('\n'), f = fence(tail);
  return [`## ${ok ? '✅' : '❌'} ${W.JOB_WORDS[p.job]}${p.unit ? ` ${p.unit}` : ''}`, '', ok ? `- ${said}` : '- 落ちました: 最後の行を見てください（直したら「アドオン」から、もう一度）', '', f, tail, f, ''].join('\n');
}
const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** unitci: the plan run (in unit.yml) → true when the lab's command passed. deps (tests): env, spawn (spawnSync's shape), out,
 *  root (the lab's folder) */
export async function unitCiCmd(args = [], { env = process.env, spawn = spawnSync, out = console.log, root = TOP } = {}) {
  const p = plan(env);
  if (args.includes('--dry')) { out(p.error ? `ERR ${p.error}` : `OK ${p.show}`); return !p.error; }
  if (!env.GITHUB_ACTIONS && !env.LAB_UNIT_CI) throw new Error('unitci は unit.yml の中で（手元からは node lab.mjs <job> -a <unit>。確かめるだけなら unitci --dry）');
  // (the import's pack: a file in the lab's own incoming/ folder — neither of them a link to somewhere else)
  const real = (f, dir) => { const s = fs.lstatSync(path.join(root, ...f.split('/')), { throwIfNoEntry: false }); return Boolean(dir ? s?.isDirectory() : s?.isFile()); };
  const why = p.error ?? (p.job === 'import' && !(real('incoming', true) && real(p.args[2])) ? `${p.args[2]} がありません（パネルの取り込みがまだ届いていないか、もう消されました）` : null);
  // (from here what is printed is the person's and the lab's words: no workflow command until the end)
  const stop = crypto.randomBytes(8).toString('hex');
  out(`::stop-commands::${stop}`);
  let r = null, lines = [];
  try {
    if (why) out(`ERR ${why}`);
    else {
      out(`unitci: ${p.show}`);
      r = spawn(process.execPath, p.args, { cwd: root, encoding: 'utf8', maxBuffer: 256e6, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, FORCE_COLOR: '0', LAB_KIND: 'bds' } });
      const text = `${r.stdout ?? ''}${r.stderr ? `\n${r.stderr}` : ''}`;
      lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
      for (const l of lines) out(l);
      if (r.error) out(`ERR ${r.error.message}`);
    }
  } finally { out(`::${stop}::`); }
  const ok = !why && r?.status === 0 && !r?.error;
  const unit = ok && ['new', 'import'].includes(p.job) ? madeUnit(lines) ?? (p.job === 'new' ? p.unit : null) : p.unit || null;
  const put = (f, text) => { if (f) { try { fs.appendFileSync(f, text); } catch { /* the summary and outputs are extra */ } } };
  put(env.GITHUB_STEP_SUMMARY, summaryText({ plan: why && !p.error ? { ...p, error: why } : p, ok, lines, unit }));
  put(env.GITHUB_OUTPUT, `ok=${ok}\n${unit && /^[a-z0-9_]+$/.test(unit) ? `unit=${unit}\n` : ''}`);
  if (!ok) {
    const last = lines.filter((l) => /^(FAIL|ERR|E |Q |W )/.test(l)).slice(-8);
    out(`::error title=${esc(`unit ${p.job ?? ''}`.trim()).replace(/[:,]/g, ' ')}::${esc(why ?? ((last.length ? last : lines.slice(-8)).join('\n') || 'ラボのコマンドが落ちました'))}`);
  }
  return ok;
}
