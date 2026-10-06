#!/usr/bin/env node
// The command line itself, and what v1.19 fixed in it (each check here failed on v1.18.0): --help never runs a command;
// nothing spends AI tokens unless asked (`skill bench` without --via); bad arguments get a usage line, never a stack trace,
// a silent no-op or a long run; the money caps of the autopilot cannot be switched off by a typo; a lab name in front of any
// lab-level command works. No server, no network, no AI: fake AI CLIs on PATH record any attempt to spend.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-cli-')), BIN = path.join(T, 'bin'), SPEND = path.join(T, 'spend.log');
fs.mkdirSync(BIN);
for (const a of ['claude', 'codex', 'gemini']) { fs.writeFileSync(path.join(BIN, a), `#!/bin/sh\necho "${a} $*" >> "${SPEND}"\nexit 3\n`); fs.chmodSync(path.join(BIN, a), 0o755); }
const kind0 = (() => { try { return fs.readFileSync(path.join(TOP, '.lab-kind'), 'utf8'); } catch { return null; } })();
const lab = (args, e = {}, cwd = TOP, timeout = 60000) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(cwd, 'lab.mjs'), ...args], { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL', input: '', env: { ...process.env, PATH: BIN + path.delimiter + process.env.PATH, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', LAB_DOTENV: 'off', LAB_NOTIFY: 'off', ...e } });
  return { code: r.status, t: (r.stdout ?? '') + (r.stderr ?? ''), ms: Date.now() - t0, timedOut: r.error?.code === 'ETIMEDOUT' };
};
const spent = () => (fs.existsSync(SPEND) ? fs.readFileSync(SPEND, 'utf8') : '');
const STACK = /\n\s+at .+:\d+:\d+|TypeError|ReferenceError|ENOENT: no such file/;

// --help: the help, never the command (skill verify --help ran every probe on a server; skill bench --help a paid run)
for (const a of [['skill', 'verify', '--help'], ['skill', 'bench', '--help'], ['share', '--help'], ['go', '-h'], ['end', 'go', '--help']]) {
  const r = lab(a, {}, TOP, 20000);
  ok(r.code === 0 && !r.timedOut && r.ms < 15000 && r.t.trim() && !/^(share v|verifying|started|PASS|FAIL|on |off )/m.test(r.t) && !STACK.test(r.t), `${a.join(' ')}: prints help and returns (${r.ms} ms)`, r.t);
}
ok(!spent(), '--help spent no AI tokens', spent());
{ const h = lab(['help', 'record']), ls = h.t.split('\n').filter((l) => /^\(help /.test(l)); ok(ls.length && ls.every((l) => /(^|[^\w-])record([^\w-]|$)/i.test(l)), '`help record` finds the word record, not every line with "records" (it showed 3 skills lines)', h.t); }
ok(((() => { try { return fs.readFileSync(path.join(TOP, '.lab-kind'), 'utf8'); } catch { return null; } })()) === kind0, '`end go --help` does not switch the remembered lab');

// fewer tokens: help <topic> <word> prints only the parts with the word (help player is ~3,800 tokens whole)
{ const all = lab(['help', 'player']).t, part = lab(['help', 'player', 'fish']); ok(part.code === 0 && /fish/.test(part.t) && part.t.length * 5 < all.length && part.t.split('\n').filter(Boolean).every((l) => /fish/i.test(l)), 'help player fish: only the lines with fish (a fifth or less of the topic)', part.t); }
// bds new prints the skill(s) for the request (a close second too), and splits the request into acceptance lines correctly
{
  const u = 'zz_cli_new', U = path.join(TOP, 'bds', 'addons', u), cur = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : null;
  fs.rmSync(U, { recursive: true, force: true });
  try {
    const r = lab(['bds', 'new', u, 'Zap', 'アイテム lab:zap_wand を追加。使うと ZAP! と伝え、3秒クールダウン'], { LAB_SKILL_READS: 'off' });
    ok(/^# skill bds-/m.test(r.t) && !/^close: read the one that fits/m.test(r.t), 'bds new: the skill text itself (two if close), never "read it with another call"', r.t);
    const acc = fs.readFileSync(path.join(U, 'TASK.md'), 'utf8').split('\n').filter((l) => l.startsWith('- [ ]'));
    ok(acc.length === 2 && acc[1].includes('ZAP! と伝え'), 'TASK.md: "ZAP!" inside a Japanese sentence does not cut it in two (QA then asked for a section per fragment)', acc.join('\n'));
  } finally { fs.rmSync(U, { recursive: true, force: true }); if (cur0 === null) fs.rmSync(cur, { force: true }); else fs.writeFileSync(cur, cur0); }
}

// skill bench: tokens only with an explicit --via (it defaulted to the claude CLI)
let r = lab(['skill', 'bench']);
ok(r.code !== 0 && /--via is required|usage: node lab\.mjs skill bench --via/.test(r.t) && !spent(), 'skill bench without --via: the usage, nothing run', r.t + spent());
r = lab(['skill', 'bench', '--via', 'claude', '--runs', 'x']);
ok(r.code !== 0 && /--runs x: a whole number/.test(r.t) && !spent(), 'skill bench --runs x: refused before anything runs', r.t);
r = lab(['skill', 'bench', '--via', 'claude', '--tasks', 'nosuchtask']);
ok(r.code !== 0 && /unknown nosuchtask/.test(r.t) && !spent(), 'skill bench --tasks <unknown>: refused, the tasks named', r.t);

// usage lines instead of "undefined", stack traces and silent successes
r = lab(['skill', 'promote']); ok(r.code !== 0 && /usage: node lab\.mjs skill promote/.test(r.t) && !/undefined/.test(r.t), 'skill promote with no id: usage (was "ERR no rule undefined")', r.t);
r = lab(['skill', 'retire']); ok(r.code !== 0 && /usage: node lab\.mjs skill retire/.test(r.t), 'skill retire with no id: usage', r.t);
r = lab(['skill', 'learn', '--from', path.join(T, 'nowhere')]); ok(r.code !== 0 && /not found/.test(r.t), 'skill learn --from <missing>: an error, not "OK 0 new"', r.t);
r = lab(['doc']); ok(r.code !== 0 && /^ERR usage: node lab\.mjs doc/m.test(r.t) && !STACK.test(r.t), 'doc with no word: the usage without a stack trace', r.t);
r = lab(['apply', path.join(T, 'no-patch.txt')]); ok(r.code !== 0 && /ERR no such file/.test(r.t) && !STACK.test(r.t), 'apply <missing file>: an error line, not an ENOENT crash', r.t);
r = lab(['verify', 'no_such_unit_zz']); ok(r.code !== 0 && /no bds unit "no_such_unit_zz"/.test(r.t) && r.ms < 15000, 'verify <unknown unit>: refused at once (it ran check/test/qa for minutes)', r.t);
r = lab(['share', 'zzz']); ok(r.code !== 0 && /ERR share: unknown zzz/.test(r.t) && r.ms < 15000, 'share <unknown arg>: refused (it built and verified a whole release)', r.t);
r = lab(['setup', 'zzz']); ok(r.code !== 0 && /setup: unknown zzz/.test(r.t) && r.ms < 15000, 'setup <unknown arg>: refused (it started a server install)', r.t);
r = lab(['ui', 'build'], {}, TOP, 20000); ok(!r.timedOut && /usage: node lab\.mjs ui build|ERR several addons|ERR no addon|use <name>/.test(r.t), '`ui build` reaches the JSON UI builder (it opened the browser page and never returned)', r.t);
// (no credentials: the person's own Google ones in the environment are not this test's)
r = lab(['app', 'token'], { APP_LOGIN_HEADLESS: '1', DISPLAY: '', GOOGLE_EMAIL: '', GOOGLE_AAS_TOKEN: '', GOOGLE_PASSWORD: '' }, TOP, 30000);
ok(!r.timedOut && r.code !== 0 && /GOOGLE_EMAIL/.test(r.t), 'app token with no screen, no credentials and no terminal: an error at once (it waited forever)', r.t);

// a lab name before any lab-level command (end status printed the Endstone lab's usage)
r = lab(['end', 'status']);
ok(r.code === 0 && /^next: /m.test(r.t) && !/^usage: node lab\.mjs new/m.test(r.t), '`end status`: the status, not the lab\'s usage', r.t);
if (kind0 !== null) fs.writeFileSync(path.join(TOP, '.lab-kind'), kind0); else fs.rmSync(path.join(TOP, '.lab-kind'), { force: true });

// the autopilot's money floor: a value of the wrong type is refused, and a hand-edited one fails closed
{
  const X = path.join(T, 'auto-root'); fs.mkdirSync(path.join(X, 'auto'), { recursive: true });
  const e = { LAB_AUTO_ROOT: X };
  r = lab(['auto', 'policy', 'dailyTokens=abc'], e); ok(r.code !== 0 && /a number ≥ 0/.test(r.t) && !fs.existsSync(path.join(X, 'auto', 'policy.json')), 'auto policy dailyTokens=abc: refused (it was stored, and a string cap never stops anything)', r.t);
  r = lab(['auto', 'policy', 'merge=sometimes'], e); ok(r.code !== 0 && /auto \| pr \| local/.test(r.t), 'auto policy merge=<other>: refused', r.t);
  r = lab(['auto', 'policy', 'kinds.nope=true'], e); ok(r.code !== 0 && /no such setting/.test(r.t), 'auto policy kinds.<unknown>: refused', r.t);
  r = lab(['auto', 'policy', 'dailyTokens=5000', 'kinds.forge=false'], e); const p = JSON.parse(fs.readFileSync(path.join(X, 'auto', 'policy.json'), 'utf8'));
  ok(r.code === 0 && p.dailyTokens === 5000 && p.kinds.forge === false, 'auto policy: right types are kept', r.t);
  fs.writeFileSync(path.join(X, 'auto', 'policy.json'), JSON.stringify({ dailyTokens: '3e6x', taskTokens: 'lots' }));
  const G = await import(path.join(TOP, 'common', 'auto-guard.mjs'));
  const pol = G.policy(X);
  ok(pol.dailyTokens === 0 && pol.taskTokens === 0 && !G.canSpend(pol, 0).ok, 'a hand-edited non-number cap reads as 0: nothing runs (fails closed)', JSON.stringify(pol));
}

// add: what keeps a definition from loading is said at add time (it was found only by go)
{
  const U = path.join(TOP, 'bds', 'addons', 'zz_cli_add'), cur = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : null;
  fs.rmSync(U, { recursive: true, force: true });
  try {
    lab(['bds', 'new', 'zz_cli_add', 'Zz', '--js']);
    r = lab(['bds', 'add', 'item', 'lab:big', 'Big', 'max_stack_size=999', '-a', 'zz_cli_add']);
    ok(r.code !== 0 && /^E .*max_stack_size: must be 1\.\.64 \(got 999\)/m.test(r.t), 'add item max_stack_size=999: E line and exit 1', r.t);
    r = lab(['bds', 'add', 'entity', 'lab:blob', 'Blob', 'health=notjson', '-a', 'zz_cli_add']);
    ok(/^W health=notjson is not JSON/m.test(r.t), 'add entity health=notjson: a W line says it became a string', r.t);
  } finally { fs.rmSync(U, { recursive: true, force: true }); if (cur0 === null) fs.rmSync(cur, { force: true }); else fs.writeFileSync(cur, cur0); }
}

// api with no current addon: the modules a new addon gets (it looked only in server-gametest: "none: World")
{
  const cur = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : null;
  fs.rmSync(cur, { force: true });
  try {
    r = lab(['bds', 'api', 'World'], { LAB_ADDON: '' });
    ok(/^class World \{/m.test(r.t) || /api offline needs|types/.test(r.t), 'api World with no current addon: the class (or, offline, why not)', r.t);
  } finally { if (cur0 !== null) fs.writeFileSync(cur, cur0); }
}

// refine --via "<cmd {prompt}>": the prompt (SKILL.md text: backticks, $()) is quoted, never run by the shell
{
  const S = path.join(T, 'skills'); fs.cpSync(path.join(TOP, 'skills'), S, { recursive: true });
  const target = 'bds-debug', f = path.join(S, target, 'SKILL.md'), pwn = path.join(T, 'PWNED');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^Done when.*$/m, '') + `\n\`$(touch ${pwn})\` and $(touch ${pwn}) and $\` $& $' "quoted" 'single'\n`);   // (no Done line: the brief has work, so the AI command runs)
  const got = path.join(T, 'got.txt');
  r = lab(['skill', 'refine', target, '--via', `printf %s {prompt} > '${got}'; echo none`, '--rounds', '1'], { LAB_SKILLS_DIR: S, LAB_STATE_DIR: path.join(T, 'state'), LAB_SKILL_READS: 'off' });
  ok(/round 1:/.test(r.t) && !fs.existsSync(pwn) && fs.existsSync(got) && fs.readFileSync(got, 'utf8').includes(`$(touch ${pwn}) and $\` $& $' "quoted" 'single'`), 'refine --via "<cmd {prompt}>": the command got the prompt exactly ($( ) $` $& quotes), and none of it was executed by the shell', r.t);
  // a second brief before --done keeps the first snapshot (it re-based on the edit: --done saw no change, --revert lost the original)
  const orig = fs.readFileSync(path.join(S, 'bds-tests', 'SKILL.md'), 'utf8');
  const env = { LAB_SKILLS_DIR: S, LAB_STATE_DIR: path.join(T, 'state2'), LAB_SKILL_READS: 'off' };
  lab(['skill', 'refine', 'bds-tests'], env);
  fs.writeFileSync(path.join(S, 'bds-tests', 'SKILL.md'), orig.replace(/^1\. .*$/m, '1. Write tests.'));
  r = lab(['skill', 'refine', 'bds-tests'], env);
  ok(/under way since its snapshot/.test(r.t), 'a second refine brief says a refine is under way and keeps its snapshot', r.t);
  lab(['skill', 'refine', 'bds-tests', '--revert'], env);
  ok(fs.readFileSync(path.join(S, 'bds-tests', 'SKILL.md'), 'utf8') === orig, '--revert after two briefs puts back the original, not the edit', '');
}

// undo / flaky on a throwaway unit
{
  const u = 'zz_cli_undo', U = path.join(TOP, 'bds', 'addons', u), CP = path.join(TOP, 'bds', '.lab', 'checkpoints', u), cur = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : null;
  fs.rmSync(U, { recursive: true, force: true }); fs.rmSync(CP, { recursive: true, force: true });
  try {
    lab(['bds', 'new', u, 'Zz', '--js']);
    const f = path.join(U, 'tests.txt');
    for (let i = 0; i < 20; i++) { fs.writeFileSync(f, `## v${i}\n@A join\n`); lab(['checkpoint', `v${i}`, '-a', u]); }
    const first = fs.readdirSync(CP).sort()[0];
    fs.writeFileSync(f, '## now\n@A join\n');
    r = lab(['undo', first, '-a', u]);
    ok(r.code === 0 && fs.readFileSync(f, 'utf8').startsWith('## v0') && fs.readdirSync(CP).length === 20, 'undo to the oldest of 20 checkpoints works (the new "before undo" one no longer prunes it first)', r.t);
    const n0 = fs.readdirSync(CP).sort().join(' ');
    r = lab(['undo', '19990101-000000000-zzz', '-a', u]);
    ok(r.code !== 0 && /19990101-000000000-zzz/.test(r.t) && fs.readdirSync(CP).sort().join(' ') === n0, 'undo <unknown id>: refused, and no checkpoint taken for nothing', r.t);
    // flaky: every run fails before a section runs (a syntax error): FAIL, never "OK every section every time"
    fs.writeFileSync(path.join(U, 'bp', 'scripts', 'main.js'), 'import { world } from "@minecraft/server";\nthis is not javascript (\n');
    r = lab(['flaky', '2', '-a', u], {}, TOP, 300000);
    ok(r.code !== 0 && /^FAIL zz_cli_undo/m.test(r.t) && !/^OK zz_cli_undo/m.test(r.t), 'flaky when every run fails before any section: FAIL (it said OK)', r.t);
  } finally { fs.rmSync(U, { recursive: true, force: true }); fs.rmSync(CP, { recursive: true, force: true }); if (cur0 === null) fs.rmSync(cur, { force: true }); else fs.writeFileSync(cur, cur0); }
}

ok(!spent(), 'nothing above spent AI tokens', spent());
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} cli-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
