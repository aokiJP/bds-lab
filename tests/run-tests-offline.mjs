// The offline tests side by side (common/run-tests.mjs) on a temp git repository whose fake tests have the names of real SERIAL
// ones: two SERIAL tests run at the same time, each in a copy of its own (they meet there: one alone would wait in vain), the
// changes not committed are in the copies (a changed file, a new one, a deleted one; an ignored one not), the lab folder itself
// stays as it was and no copy stays (a test failing, the runner stopped); a result line as each test ends; the longest first
// (the caller's times, else TIME); a wrap's prepare for each test (the copy its root while it runs), its env in the test, its
// finish in the line — common/deps.mjs's keys of a test run in a copy are the repository's; without git (or with --no-isolate),
// as before: the SERIAL ones after the others, one by one, in the folder itself; the command line's --json unchanged.
// node tests/run-tests-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = await import(pathToFileURL(path.join(TOP, 'common', 'run-tests.mjs')).href);
const CLI = path.join(TOP, 'common', 'run-tests.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-runtests-'));
// the copies go into a temp folder of this test's own (os.tmpdir() reads TMPDIR): what stays there is seen
const ISO = path.join(TMP, 'tmp'), LAB = path.join(TMP, 'lab');
fs.mkdirSync(ISO, { recursive: true });
process.env.TMPDIR = ISO;
const git = (...a) => { const r = spawnSync('git', a, { cwd: LAB, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const left = () => fs.readdirSync(ISO).filter((f) => f.startsWith('bdslab-iso-'));
const worktrees = () => git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;
let logN = 0;
const newLog = () => { const d = path.join(TMP, `log-${++logN}`); fs.mkdirSync(d); return d; };
const read = (log, f) => { try { return fs.readFileSync(path.join(log, f), 'utf8'); } catch { return null; } };
const started = (log, n) => JSON.parse(read(log, `${n}.start`) ?? 'null');

// one fake test for every name: what it sees of the lab and where it runs; a SERIAL one writes into the lab folder, as theirs do.
// RENDEZVOUS="a b": those wait until all of them started (alone: a failure); HANG=<name> never ends; FAIL=<name> exits 1
const FAKE = `import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), name = path.basename(fileURLToPath(import.meta.url), '.mjs').replace(/-offline$/, '');
const LOG = process.env.LOG, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), at = (f) => path.join(TOP, f);
fs.appendFileSync(path.join(LOG, 'order.txt'), name + '\\n');
const me = { name, pid: process.pid, cwd: process.cwd(), top: TOP, data: fs.readFileSync(at('data.txt'), 'utf8').trim(), added: fs.existsSync(at('new.txt')), old: fs.existsSync(at('old.txt')), ignored: fs.existsSync(at('ignored.log')), base: fs.existsSync(at('.lab-base.json')) && fs.existsSync(at('.lab/base/x.txt')), wrap: process.env.FAKE_WRAP ?? null, start: Date.now() };
fs.writeFileSync(path.join(LOG, name + '.start'), JSON.stringify(me));
const meet = (process.env.RENDEZVOUS ?? '').split(' ').filter(Boolean);
if (meet.includes(name)) for (const t0 = Date.now(); !meet.every((n) => fs.existsSync(path.join(LOG, n + '.start'))); await sleep(30)) if (Date.now() - t0 > 20000) { console.log('✘ ' + name + ': alone (the others never started)'); process.exit(1); }
if (process.env.HANG === name) await sleep(600000);
if (['make', 'cli', 'guards', 'app'].includes(name)) { fs.writeFileSync(at('.lab-current'), name); fs.mkdirSync(at('runs'), { recursive: true }); fs.writeFileSync(at('runs/' + name + '.txt'), name); }
await sleep(Number(process.env.NAP ?? 50));
fs.writeFileSync(path.join(LOG, name + '.end'), String(Date.now()));
console.log('ok ' + name + ' wrap=' + me.wrap);
process.exit(process.env.FAIL === name ? 1 : 0);
`;
const NAMES = ['make', 'cli', 'guards', 'app', 'a', 'b', 'sim', 'zz'];
const testOf = (n) => (n === 'offline' ? 'tests/offline.mjs' : `tests/${n}-offline.mjs`);
fs.mkdirSync(path.join(LAB, 'tests'), { recursive: true });
for (const n of [...NAMES, 'offline']) fs.writeFileSync(path.join(LAB, testOf(n)), FAKE);
fs.writeFileSync(path.join(LAB, 'data.txt'), 'v1\n'); fs.writeFileSync(path.join(LAB, 'old.txt'), 'old\n'); fs.writeFileSync(path.join(LAB, '.gitignore'), '*.log\n.lab/\n.lab-base.json\n');
fs.mkdirSync(path.join(LAB, '.github', 'workflows'), { recursive: true }); fs.writeFileSync(path.join(LAB, '.github', 'workflows', 'verify.yml'), 'name: verify\n');
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one');
const HEAD_DATA = git('rev-parse', 'HEAD:data.txt');
// the work tree's changes, not committed: a changed file, a new one, a deleted one, an ignored one
fs.writeFileSync(path.join(LAB, 'data.txt'), 'v2\n'); fs.writeFileSync(path.join(LAB, 'new.txt'), 'new\n'); fs.rmSync(path.join(LAB, 'old.txt')); fs.writeFileSync(path.join(LAB, 'ignored.log'), 'log\n');
// the lab's starting point lab.mjs makes on its first run (ignored by git): a copy carries it, or its first `node lab.mjs` reads every file
fs.writeFileSync(path.join(LAB, '.lab-base.json'), '{}\n'); fs.mkdirSync(path.join(LAB, '.lab', 'base'), { recursive: true }); fs.writeFileSync(path.join(LAB, '.lab', 'base', 'x.txt'), 'x\n');
const STATUS = git('status', '--porcelain', '--ignored');
const ISO_REAL = fs.realpathSync(ISO);

await t('SERIAL tests side by side, each in a copy of its own with the changes not committed and the lab\'s starting point (.lab-base.json, .lab/base); the lab folder stays as it was; no copy stays', async () => {
  const log = newLog();
  const res = await R.runTests([testOf('make'), testOf('cli'), testOf('a')], { cwd: LAB, jobs: 3, env: { ...process.env, LOG: log, RENDEZVOUS: 'make cli' } });
  eq(res.map((r) => [r.t, r.ok]), [[testOf('make'), true], [testOf('cli'), true], [testOf('a'), true]], JSON.stringify(res.map((r) => r.lines)));
  const [m, c, a] = ['make', 'cli', 'a'].map((n) => started(log, n));
  ok(m.top !== c.top && m.top.startsWith(ISO_REAL) && c.top.startsWith(ISO_REAL) && m.cwd === m.top && c.cwd === c.top, `own copies: ${m.top} ${c.top}`);
  eq(a.top, fs.realpathSync(LAB), 'the others in the lab folder');
  for (const x of [m, c]) eq([x.data, x.added, x.old, x.ignored, x.base], ['v2', true, false, false, true], `${x.name} sees the changes, not the ignored file — but the lab's starting point`);
  ok(!fs.existsSync(path.join(LAB, '.lab-current')) && !fs.existsSync(path.join(LAB, 'runs')), 'nothing written into the lab folder');
  eq(git('status', '--porcelain', '--ignored'), STATUS, 'the lab folder as it was');
  eq([worktrees(), left()], [1, []], 'no copy stays');
});

await t('a result line as each test ends (there before onDone); they start the longest first: the caller\'s times, else TIME, else a minute', async () => {
  const log = newLog(), results = path.join(TMP, 'results-1.jsonl'), seen = [];
  const list = ['sim', 'zz', 'offline', 'app'].map(testOf);
  await R.runTests(list, { cwd: LAB, jobs: 1, results, parts: {}, env: { ...process.env, LOG: log }, onDone: (r) => { const rows = fs.readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); seen.push([rows.length, rows.at(-1).unit === r.t]); } });
  eq(read(log, 'order.txt').trim().split('\n'), ['app', 'offline', 'zz', 'sim'], 'TIME: app 800 s, offline 300 s, zz unknown (60 s), sim 26 s');
  eq(seen, [[1, true], [2, true], [3, true], [4, true]], 'a line each time one ended');
  const rows = fs.readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  eq(rows.map((x) => [x.unit, x.ok, x.deps, Number.isInteger(x.ms)]), ['app', 'offline', 'zz', 'sim'].map((n) => [testOf(n), true, null, true]), 'without a wrap: deps null');
  const log2 = newLog();
  await R.runTests(list, { cwd: LAB, jobs: 1, parts: {}, times: { [testOf('sim')]: 9e6, [testOf('zz')]: 1 }, env: { ...process.env, LOG: log2 } });
  eq(read(log2, 'order.txt').trim().split('\n'), ['sim', 'app', 'offline', 'zz'], 'the caller\'s times first');
  eq([worktrees(), left()], [1, []], 'no copy stays');
});

await t('parts: a test in parts runs as processes side by side (their args / env; a SERIAL one each in a copy of its own); one result: ok only when every part is, the longest part\'s time, the parts\' reads together (null if one is unknown); the real list splits app-offline and offline.mjs', async () => {
  const log = newLog(), results = path.join(TMP, 'results-parts.jsonl');
  const parts = { [testOf('app')]: [{ env: { PART: '1' } }, { env: { PART: '2' } }], [testOf('b')]: [{ args: ['x'] }, { args: ['y'] }] };
  let n = 0;
  const wrap = { prepare(unit) { const k = ++n; return { env: {}, finish: () => ({ deps: unit === testOf('b') && k % 2 ? null : { [`r${k}.txt`]: 'v' } }) }; } };
  const res = await R.runTests([testOf('app'), testOf('b'), testOf('a')], { cwd: LAB, jobs: 4, parts, wrap, results, env: { ...process.env, LOG: log, RENDEZVOUS: 'a' } });
  eq(res.map((r) => [r.t, r.ok]), [[testOf('app'), true], [testOf('b'), true], [testOf('a'), true]], JSON.stringify(res.map((r) => r.lines)));
  const app = res[0];
  ok(app.lines.filter((l) => /^── tests\/app-offline\.mjs part \d\/2 \(PART=\d\) ok/.test(l)).length === 2 && app.lines.filter((l) => l === 'ok app wrap=null').length === 2, app.lines.join('\n'));
  ok(res[1].lines.some((l) => /part 1\/2 \(x\)/.test(l)) && res[1].lines.some((l) => /part 2\/2 \(y\)/.test(l)), res[1].lines.join('\n'));
  const rows = fs.readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  eq(rows.map((x) => x.unit).sort(), [testOf('a'), testOf('app'), testOf('b')].sort(), 'one line a test');
  const appRow = rows.find((x) => x.unit === testOf('app'));
  eq(Object.keys(appRow.deps ?? {}).length, 2, 'the parts\' reads together');
  eq(rows.find((x) => x.unit === testOf('b')).deps, null, 'a part\'s reads unknown: unknown');
  ok(Number.isInteger(appRow.ms) && appRow.ms === res[0].ms && appRow.ms < 20000, `the longest part's time: ${appRow.ms}`);
  const failing = await R.runTests([testOf('b')], { cwd: LAB, jobs: 2, parts: { [testOf('b')]: [{ env: { FAIL: 'none' } }, { env: { FAIL: 'b' } }] }, env: { ...process.env, LOG: newLog() } });
  eq([failing[0].ok, failing[0].code], [false, 1], 'one part failing fails the test');
  ok(R.PARTS['tests/app-offline.mjs'].length >= 2 && R.PARTS['tests/offline.mjs'].some((p) => p.args.includes('docker') && p.args.includes('ll')), 'the real list: app-offline in shards, offline.mjs by lab (ll with docker)');
  eq([worktrees(), left()], [1, []], 'no copy stays');
});

await t('wrap: prepare for each test (a SERIAL one\'s root is its copy), its env in the test, its finish in the result line — an object or a module', async () => {
  const log = newLog(), results = path.join(TMP, 'results-2.jsonl'), calls = [];
  const wrap = { prepare(unit, { root, env }) { calls.push([unit, root, !!env]); return { env: { FAKE_WRAP: unit }, finish({ ok: passed, ms }) { return { deps: { 'x.txt': 'abc' }, sha: 'h', env: `e-${passed}-${Number.isInteger(ms)}` }; } }; } };
  const res = await R.runTests([testOf('make'), testOf('a')], { cwd: LAB, jobs: 2, wrap, results, env: { ...process.env, LOG: log } });
  ok(res.every((r) => r.ok && r.lines.includes(`ok ${r.t.slice(6, -12)} wrap=${r.t}`)), JSON.stringify(res.map((r) => r.lines)));
  const byUnit = Object.fromEntries(calls.map(([u, root, env]) => [u, [root, env]]));
  ok(byUnit[testOf('make')][0].startsWith(ISO) && byUnit[testOf('a')][0] === LAB && calls.every((c) => c[2]), JSON.stringify(calls));
  const rows = fs.readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).sort((x, y) => (x.unit < y.unit ? -1 : 1));
  eq(rows.map((x) => [x.unit, x.ok, x.deps, x.sha, x.env]), [[testOf('a'), true, { 'x.txt': 'abc' }, 'h', 'e-true-true'], [testOf('make'), true, { 'x.txt': 'abc' }, 'h', 'e-true-true']]);
  const mod = path.join(TMP, 'wrap.mjs');
  fs.writeFileSync(mod, "export function prepare(unit) { return { env: { FAKE_WRAP: 'mod:' + unit }, finish() { return { deps: null, sha: 'm', env: 'm' }; } }; }\n");
  const [r] = await R.runTests([testOf('b')], { cwd: LAB, wrap: mod, env: { ...process.env, LOG: newLog() } });
  ok(r.ok && r.lines.includes(`ok b wrap=mod:${testOf('b')}`), r.lines.join('\n'));
  eq([worktrees(), left()], [1, []], 'no copy stays');
});

await t('common/deps.mjs as the wrap: a test run in a copy is recorded under the repository\'s keys, with HEAD\'s values', async () => {
  const results = path.join(TMP, 'results-3.jsonl');
  await R.runTests([testOf('guards')], { cwd: LAB, wrap: path.join(TOP, 'common', 'deps.mjs'), results, env: { ...process.env, LOG: newLog() } });
  const [row] = fs.readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  ok(row.ok && row.deps, JSON.stringify(row));
  eq([row.deps[testOf('guards')], row.deps['data.txt'], row.deps['new.txt'], row.deps['.github/workflows/verify.yml'], row.sha], [git('rev-parse', `HEAD:${testOf('guards')}`), HEAD_DATA, 'absent', git('rev-parse', 'HEAD:.github/workflows/verify.yml'), git('rev-parse', 'HEAD')]);
  eq(Object.keys(row.deps).filter((k) => /bdslab-|^\//.test(k)), [], 'no key of the copy\'s own path');
  eq([worktrees(), left()], [1, []], 'no copy stays');
});

await t('a SERIAL test failing, or the runner stopped while one runs: its copy goes, the test is stopped', async () => {
  const [r] = await R.runTests([testOf('make')], { cwd: LAB, env: { ...process.env, LOG: newLog(), FAIL: 'make' } });
  ok(!r.ok && r.code === 1, r.lines.join('\n'));
  eq([worktrees(), left()], [1, []], 'failed: no copy stays');
  const log = newLog();
  const c = spawn(process.execPath, [CLI, '--jobs', '2', '--cwd', LAB, testOf('make'), testOf('cli')], { env: { ...process.env, LOG: log, HANG: 'make', TMPDIR: ISO }, stdio: 'ignore' });
  const closed = new Promise((res) => c.on('close', (code, sig) => res(code ?? sig)));
  for (let k = 0; k < 400 && !read(log, 'make.start'); k++) await sleep(50);
  ok(read(log, 'make.start'), 'make started');
  c.kill('SIGTERM');
  eq(await closed, 143, 'the runner stopped');
  const pid = started(log, 'make').pid;
  let alive = true;
  for (let k = 0; k < 100 && alive; k++) { try { process.kill(pid, 0); await sleep(50); } catch { alive = false; } }
  ok(!alive, 'the test stopped');
  eq([worktrees(), left()], [1, []], 'stopped: no copy stays');
  ok(!fs.existsSync(path.join(LAB, '.lab-current')), 'the lab folder untouched');
});

await t('without git, or --no-isolate: as before — the SERIAL ones after the others, one by one, in the folder itself', async () => {
  const plain = path.join(TMP, 'plain');
  fs.cpSync(LAB, plain, { recursive: true, filter: (f) => path.basename(f) !== '.git' });
  for (const [cwd, isolate] of [[plain, true], [LAB, false]]) {
    const log = newLog();
    const res = await R.runTests([testOf('make'), testOf('cli'), testOf('a'), testOf('b')], { cwd, jobs: 3, isolate, env: { ...process.env, LOG: log, NAP: '300' } });
    ok(res.every((r) => r.ok), JSON.stringify(res.map((r) => r.lines)));
    const s = Object.fromEntries(['make', 'cli', 'a', 'b'].map((n) => [n, { ...started(log, n), end: Number(read(log, `${n}.end`)) }]));
    ok(s.make.top === fs.realpathSync(cwd) && s.cli.top === fs.realpathSync(cwd), `in the folder itself: ${s.make.top}`);
    ok(Math.min(s.make.start, s.cli.start) >= Math.max(s.a.end, s.b.end), `after the others (${cwd === plain ? 'no git' : '--no-isolate'})`);
    ok(s.make.end <= s.cli.start || s.cli.end <= s.make.start, 'one by one');
    fs.rmSync(path.join(cwd, '.lab-current'), { force: true }); fs.rmSync(path.join(cwd, 'runs'), { recursive: true, force: true });
  }
  eq([worktrees(), left()], [1, []], 'no copy made');
  eq(git('status', '--porcelain', '--ignored'), STATUS, 'the lab folder as it was');
});

await t('the command line: --json says what it said ({ t, ok, code, ms, lines }); --results and --wrap; --no-isolate', () => {
  const results = path.join(TMP, 'results-4.jsonl'), mod = path.join(TMP, 'wrap.mjs');
  const r = spawnSync(process.execPath, [CLI, '--json', '--cwd', LAB, '--results', results, '--wrap', mod, testOf('a'), testOf('cli')], { encoding: 'utf8', env: { ...process.env, LOG: newLog(), TMPDIR: ISO } });
  eq(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  eq(rows.map((x) => Object.keys(x)), [['t', 'ok', 'code', 'ms', 'lines'], ['t', 'ok', 'code', 'ms', 'lines']]);
  eq(rows.map((x) => [x.t, x.ok, x.code]), [[testOf('a'), true, 0], [testOf('cli'), true, 0]], 'in the order given');
  ok(rows[1].lines.includes(`ok cli wrap=mod:${testOf('cli')}`), rows[1].lines.join('\n'));
  eq(fs.readFileSync(results, 'utf8').trim().split('\n').map((l) => JSON.parse(l).unit).sort(), [testOf('a'), testOf('cli')]);
  const log = newLog();
  const n = spawnSync(process.execPath, [CLI, '--cwd', LAB, '--no-isolate', testOf('cli')], { encoding: 'utf8', env: { ...process.env, LOG: log, TMPDIR: ISO } });
  ok(n.status === 0 && /^✔ tests\/cli-offline\.mjs \(\d+ s\)\nPASS 1 tests\n$/.test(n.stdout), n.stdout + n.stderr);
  eq(started(log, 'cli').top, fs.realpathSync(LAB), '--no-isolate: in the lab folder');
  fs.rmSync(path.join(LAB, '.lab-current'), { force: true }); fs.rmSync(path.join(LAB, 'runs'), { recursive: true, force: true });
  eq([worktrees(), left()], [1, []], 'no copy stays');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
