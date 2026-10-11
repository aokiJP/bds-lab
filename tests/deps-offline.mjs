// verify's record of what a unit read (common/deps-hook.mjs, common/deps.mjs) on a temp git repository with real child processes:
// every way of reading a file (ESM, import(), require, each fs function, named imports, a relative import not there), a child
// given an env made anew, a worker given its own env, a command found on PATH, files on a child's command line, a copy of the
// repository in the temp folder read as the repository, a file looked for and made later, git's own and ignored files left out,
// a sandboxed child (--permission) started without the recorder and its allowed folder recorded instead, '!' → null, a record
// inside another's, prepare/finish, and the command line: run (its output, its exit code, its line) and each (n at a time, each
// one's output whole in a group, a failure's annotation escaped, the lines in the order they ended, one that failed beside
// others again alone, a cancelled run keeps what ended and leaves no record folder). node tests/deps-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = await import(pathToFileURL(path.join(TOP, 'common', 'deps.mjs')).href);
const S = await import(pathToFileURL(path.join(TOP, 'common', 'verify-state.mjs')).href);
const CLI = path.join(TOP, 'common', 'deps.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (this test may itself run inside a recording — auto gate --record: what only shows without one is said, not checked)
const RECORDED = !!process.env.LAB_DEPS_OUT;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-deps-test-'));
const REPO = path.join(TMP, 'repo'), COPY = path.join(TMP, 'copy', 'lab'), DEST = path.join(TMP, 'dest');
const git = (...a) => { const r = spawnSync('git', a, { cwd: REPO, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const put = (files, at = REPO) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(at, f)), { recursive: true }); fs.writeFileSync(path.join(at, f), s); } };
const commit = (msg) => { git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
const blob = (f) => git('rev-parse', `HEAD:${f}`);

// the fixture: every way of reading the recorder must see, in one process tree
const MAIN = `import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { readFile as readFileP } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync, execSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { s } from './lib/static.mjs';
const require = createRequire(import.meta.url), DEST = process.env.DEST, COPY = process.env.COPY;
await import('./lib/dyn.mjs');
require('./lib/req.cjs');
try { await import('./lib/nope.mjs'); } catch { /* not there */ }
readFileSync('lib/named.txt');
await new Promise((r) => fs.readFile('lib/cb.txt', r));
await readFileP('lib/prom.txt');
await fsp.readFile('lib/prom2.txt');
await new Promise((r) => fs.createReadStream('lib/stream.txt').on('close', r).resume());
fs.closeSync(fs.openSync('lib/open.txt'));
statSync('lib/stat.txt');
fs.lstatSync('lib/lstat.txt');
await fsp.stat('lib/pstat.txt');
fs.existsSync('lib/exists.txt');
fs.accessSync('lib/access.txt');
await new Promise((r) => fs.access('lib/cbaccess.txt', r));
fs.readdirSync('listed');
fs.readdirSync('rec', { recursive: true });
fs.opendirSync('opened').closeSync();
fs.copyFileSync('lib/copy-src.txt', path.join(DEST, 'copied.txt'));
fs.cpSync('tree', path.join(DEST, 'tree'), { recursive: true });
if (!fs.existsSync('later.txt')) fs.writeFileSync('later.txt', 'made\\n');
readFileSync('later.txt');
readFileSync('.git/HEAD'); readFileSync('ignored/secret.txt'); readFileSync('note.log');
readFileSync(path.join(COPY, 'deep', 'in-copy.txt'));
fs.existsSync(path.join(COPY, 'deep', 'missing.txt'));
readFileSync(path.join(COPY, 'top.txt'));
const kid = spawnSync(process.execPath, ['-e', "require('fs').readFileSync('lib/child-only.txt')"], { env: { PATH: process.env.PATH } });
const tool = spawnSync('tool', [], { env: { ...process.env, PATH: path.resolve('bin') + path.delimiter + process.env.PATH } });
const sh = spawnSync('sh', ['lib/run.sh']);
execSync('sh lib/run2.sh');
await new Promise((r) => new Worker("'use strict'; require('fs').readFileSync('lib/worker.txt')", { eval: true, env: {} }).on('exit', r));
await new Promise((r) => new Worker(new URL('./lib/wfile.cjs', import.meta.url), { env: {} }).on('exit', r));
console.log('fixture ok', s, kid.status, tool.status, sh.status);
`;
fs.mkdirSync(REPO, { recursive: true });
git('init', '-q');
const lib = Object.fromEntries(['named', 'cb', 'prom', 'prom2', 'stream', 'open', 'stat', 'lstat', 'pstat', 'exists', 'access', 'cbaccess', 'copy-src', 'child-only', 'worker', 'wfile'].map((n) => [`lib/${n}.txt`, `${n}\n`]));
put({
  '.gitignore': 'ignored/\n*.log\n', '.github/workflows/verify.yml': 'name: verify\n', 'main.mjs': MAIN, 'top.txt': 'top\n',
  'lib/static.mjs': 'export const s = 1;\n', 'lib/dyn.mjs': 'export const d = 1;\n', 'lib/req.cjs': 'module.exports = 1;\n', ...lib,
  'lib/wfile.cjs': "require('fs').readFileSync(__dirname + '/wfile.txt');\n",
  'lib/run.sh': 'exit 0\n', 'lib/run2.sh': 'exit 0\n', 'bin/tool': '#!/bin/sh\nexit 0\n',
  'listed/x.txt': 'x\n', 'rec/a.txt': 'a\n', 'rec/inner/b.txt': 'b\n', 'opened/o.txt': 'o\n', 'tree/a.txt': 'a\n', 'tree/sub/b.txt': 'b\n',
  'deep/in-copy.txt': 'in copy\n', 'deep/other.txt': 'other\n', 'sand/s.cjs': "console.log('sandbox', require('fs').readFileSync(__dirname + '/data.txt', 'utf8').trim())\n", 'sand/data.txt': 'sand data\n',
  'pass.mjs': "import fs from 'node:fs'; fs.readFileSync('lib/named.txt'); console.log('hello from pass');\n",
  'fail.mjs': "console.log('about to fail'); process.exit(3);\n",
  'step.mjs': "const n = process.argv[2]; console.log(`line1 ${n}`); if (n === 'b') console.log('50% of b\\r'); console.log(`line2 ${n}`); await new Promise((r) => setTimeout(r, { a: 1500, b: 0, c: 200, quick: 0, slow: 600000 }[n] ?? 0)); if (n === 'slow') console.log('never'); process.exit(n === 'b' ? 1 : 0);\n",
  'slow.mjs': "import fs from 'node:fs'; fs.writeFileSync(process.env.PIDS + '/' + process.argv[2], String(process.pid)); await new Promise((r) => setTimeout(r, process.argv[2] === 'slow' ? 600000 : 0));\n",
  // (fails beside another one — it waits a moment to see one — and passes alone; 'bad' fails either way)
  'crowd.mjs': "import fs from 'node:fs'; import path from 'node:path'; const d = process.env.CROWD, n = process.argv[2], me = path.join(d, n), sleep = (ms) => new Promise((r) => setTimeout(r, ms)); fs.writeFileSync(me, ''); const others = () => fs.readdirSync(d).filter((f) => f !== n); for (const t0 = Date.now(); !others().length && Date.now() - t0 < 1500; await sleep(20)); const o = others(); await sleep(400); fs.rmSync(me); console.log(o.length ? `beside ${o.sort().join(' ')}` : 'alone'); process.exit(o.length || n === 'bad' ? 1 : 0);\n",
});
fs.chmodSync(path.join(REPO, 'bin', 'tool'), 0o755);
put({ 'ignored/secret.txt': 'secret\n', 'note.log': 'log\n' });
commit('one');
// (a copy of the repository in the temp folder, made here: what the fixture reads there is read as the repository's)
fs.cpSync(REPO, COPY, { recursive: true, filter: (f) => !f.includes(`${path.sep}.git`) });
fs.mkdirSync(DEST, { recursive: true });
// a recorded run of a command in the repository → { deps, sha, env, r }
const recorded = (args, { env = process.env, root = REPO } = {}) => {
  const p = D.prepare('unit:test', { root, env });
  const r = spawnSync(args[0], args.slice(1), { cwd: REPO, encoding: 'utf8', env: { ...env, ...p.env, DEST, COPY } });
  return { ...p.finish({ ok: r.status === 0, ms: 1 }), r, dir: p.dir };
};
// (the fixture once: it makes later.txt)
const FIX = recorded([process.execPath, 'main.mjs']);

await t('every way of reading is recorded: ESM, import(), require, each fs function (named imports too), a child given a new env, a worker given its own, PATH, the command line', () => {
  const { deps, r } = FIX;
  ok(r.status === 0 && /fixture ok 1 0 0 0/.test(r.stdout), r.stdout + r.stderr);
  ok(deps, 'deps known');
  const files = ['main.mjs', 'lib/static.mjs', 'lib/dyn.mjs', 'lib/req.cjs', 'lib/wfile.cjs', ...Object.keys(lib), 'lib/run.sh', 'lib/run2.sh', 'bin/tool', 'tree/a.txt', 'tree/sub/b.txt', '.github/workflows/verify.yml'];
  const missing = files.filter((f) => deps[f] !== blob(f));
  eq(missing, [], 'files with their blob ids');
  const tree = S.treeAt(REPO);
  for (const k of ['dir:listed', 'dir:rec', 'dir:rec/inner', 'dir:opened', 'dir:tree', 'dir:tree/sub', 'dir:lib']) { ok(deps[k] && deps[k] !== 'absent', `${k}: ${deps[k]}`); eq(deps[k], S.valuesOf([k], tree)[k], k); }
  eq(deps['lib/nope.mjs'], 'absent', 'a relative import not there');
  eq(Object.keys(deps), [...Object.keys(deps)].sort(), 'keys sorted');
});

await t('looked for, then made: absent until committed; a copy in the temp folder is the repository (2 parts or more); git\'s own, ignored files and the rest of the machine are not', () => {
  const { deps } = FIX;
  eq([deps['later.txt'], deps['dir:later.txt']], ['absent', 'absent'], 'later.txt: looked for, made, read');
  eq(deps['deep/in-copy.txt'], blob('deep/in-copy.txt'), 'read in the copy: the repository\'s file');
  eq(deps['deep/missing.txt'], 'absent', 'looked for in the copy: where the repository has its folder');
  ok(!('deep/other.txt' in deps), 'the copy\'s other files: not read, not there');
  ok(!('top.txt' in deps), 'the copy\'s top.txt: one part only, not mapped');
  const stray = Object.keys(deps).filter((k) => /(^|\/)\.git\/|^ignored|note\.log|^\/|bdslab-|dest\//.test(k));
  eq(stray, [], 'nothing of .git/, ignored, outside');
  commit('later');
  ok(S.valuesOf(['later.txt'], S.treeAt(REPO))['later.txt'] !== deps['later.txt'], 'committed: its value changes, the unit runs again');
});

await t('a sandboxed child (--permission) starts without the recorder (it could not load it) and what it may read is recorded instead; may read anything: not known', () => {
  const sand = path.join(REPO, 'sand');
  for (const env of [{ PATH: process.env.PATH }, null]) {
    const opts = env ? `{ env: ${JSON.stringify(env)}, encoding: 'utf8' }` : `{ encoding: 'utf8' }`;
    const code = `const r = require('child_process').spawnSync(process.execPath, ['--permission', '--allow-fs-read=${sand}', 'sand/s.cjs'], ${opts}); process.stdout.write(r.stdout + r.stderr); process.exit(r.status);`;
    const { deps, r } = recorded([process.execPath, '-e', code]);
    ok(r.status === 0 && /sandbox sand data/.test(r.stdout), `the sandboxed child runs (${env ? 'its own env' : 'the env inherited'}): ${r.stdout}${r.stderr}`);
    eq([deps?.['sand/s.cjs'], deps?.['sand/data.txt'], deps?.['dir:sand'] !== 'absent'], [blob('sand/s.cjs'), blob('sand/data.txt'), true], 'its allowed folder');
  }
  // (inside a recording the '!' would make this test's own record not known too: then it is not run)
  if (RECORDED) { console.log('     (inside a recording: the sandboxed child that may read anything is not run here)'); return; }
  const any = recorded([process.execPath, '-e', "require('child_process').spawnSync(process.execPath, ['--permission', '--allow-fs-read=*', '-e', '1'])"]);
  eq([any.r.status, any.deps], [0, null], 'may read anything: not known');
});

await t('a record not whole is null: a \'!\' line anywhere, nothing recorded, no folder; a record inside another one\'s goes to both', () => {
  const d = fs.mkdtempSync(path.join(TMP, 'rec-'));
  eq(D.collect(d, REPO), null, 'nothing recorded');
  fs.writeFileSync(path.join(d, '1-a.txt'), `r ${path.join(REPO, 'main.mjs')}\n`);
  eq(D.collect(d, REPO)?.['main.mjs'], blob('main.mjs'), 'a line read');
  fs.writeFileSync(path.join(d, '2-b.txt'), '! module.registerHooks がない\n');
  eq(D.collect(d, REPO), null, 'a \'!\' line');
  eq(D.collect(path.join(TMP, 'no-such'), REPO), null, 'no folder');
  const outer = D.prepare('outer', { root: REPO }), inner = D.prepare('inner', { root: REPO, env: { ...process.env, ...outer.env } });
  const r = spawnSync(process.execPath, ['pass.mjs'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...outer.env, ...inner.env } });
  ok(r.status === 0, r.stderr);
  const a = inner.finish({ ok: true }), b = outer.finish({ ok: true });
  eq([a.deps?.['lib/named.txt'], b.deps?.['lib/named.txt']], [blob('lib/named.txt'), blob('lib/named.txt')], 'both records');
});

await t('recordEnv keeps NODE_OPTIONS and a recording going on (pure); the recorder does nothing without LAB_DEPS_OUT', () => {
  const e = D.recordEnv('/rec', { NODE_OPTIONS: '--no-warnings', LAB_DEPS_OUT: '/outer', LAB_DEPS_ROOT: '/r0' }, '/r');
  eq(e, { NODE_OPTIONS: `--no-warnings --import=${D.HOOK}`, LAB_DEPS_OUT: ['/rec', '/outer'].join(path.delimiter), LAB_DEPS_ROOT: ['/r', '/r0'].join(path.delimiter) });
  eq(D.recordEnv('/rec', { NODE_OPTIONS: e.NODE_OPTIONS }, '/r').NODE_OPTIONS, e.NODE_OPTIONS, 'the recorder loaded once');
  eq(D.HOOK, pathToFileURL(path.join(TOP, 'common', 'deps-hook.mjs')).href);
  if (RECORDED) { console.log('     (inside a recording: the recorder without LAB_DEPS_OUT is not checked here)'); return; }
  const env = { ...process.env, NODE_OPTIONS: `--import=${D.HOOK}` }; delete env.LAB_DEPS_OUT;
  const r = spawnSync(process.execPath, ['-e', "console.log(globalThis[Symbol.for('bds-lab.deps-hook')] === undefined)"], { encoding: 'utf8', env });
  eq(r.stdout.trim(), 'true', 'not started');
});

await t('prepare/finish: the env for the unit, then its result\'s deps, sha and env; the record folder goes; a failure has no deps', () => {
  const p = D.prepare('tests/x-offline.mjs', { root: REPO, env: { ...process.env, NODE_OPTIONS: '--no-warnings' } });
  ok(p.env.NODE_OPTIONS.startsWith('--no-warnings') && p.env.NODE_OPTIONS.includes(`--import=${D.HOOK}`), p.env.NODE_OPTIONS);
  ok(p.env.LAB_DEPS_OUT.split(path.delimiter)[0] === p.dir && fs.existsSync(p.dir) && p.dir.startsWith(os.tmpdir()), p.env.LAB_DEPS_OUT);
  ok(p.env.LAB_DEPS_ROOT.split(path.delimiter).includes(REPO), p.env.LAB_DEPS_ROOT);
  spawnSync(process.execPath, ['pass.mjs'], { cwd: REPO, env: { ...process.env, ...p.env } });
  const f = p.finish({ ok: true, ms: 12 });
  eq([f.sha, f.env, f.deps?.['pass.mjs'], f.deps?.['lib/named.txt']], [git('rev-parse', 'HEAD'), S.envKey(), blob('pass.mjs'), blob('lib/named.txt')]);
  ok(!fs.existsSync(p.dir), 'the record folder is gone');
  ok(p.finish({ ok: false }) === f, 'finish twice: the same');
  const q = D.prepare('tests/y-offline.mjs', { root: REPO });
  spawnSync(process.execPath, ['pass.mjs'], { cwd: REPO, env: { ...process.env, ...q.env } });
  eq(q.finish({ ok: false, ms: 1 }).deps, null, 'a failure: no deps');
  ok(!fs.existsSync(q.dir), 'its folder gone too');
});

await t('run: the command\'s output as it is, its exit code, one result line', () => {
  const res = path.join(TMP, 'run.jsonl');
  const a = spawnSync(process.execPath, [CLI, 'run', 'step:pass', '--results', res, '--cwd', REPO, '--', process.execPath, 'pass.mjs'], { encoding: 'utf8' });
  eq([a.status, a.stdout], [0, 'hello from pass\n']);
  const b = spawnSync(process.execPath, [CLI, 'run', 'step:fail', '--results', res, '--cwd', REPO, '--', process.execPath, 'fail.mjs'], { encoding: 'utf8' });
  eq([b.status, b.stdout], [3, 'about to fail\n']);
  const rows = fs.readFileSync(res, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  eq(rows.map((x) => [x.unit, x.ok, x.sha, x.env, Number.isInteger(x.ms)]), [['step:pass', true, git('rev-parse', 'HEAD'), S.envKey(), true], ['step:fail', false, git('rev-parse', 'HEAD'), S.envKey(), true]]);
  eq([rows[0].deps?.['pass.mjs'], rows[0].deps?.['lib/named.txt'], rows[1].deps], [blob('pass.mjs'), blob('lib/named.txt'), null]);
  const u = spawnSync(process.execPath, [CLI, 'run', 'x', '--results', res], { encoding: 'utf8' });
  ok(u.status === 2 && /使い方/.test(u.stderr), 'no command: the usage');
});

await t('each: n at a time, each one\'s output whole in its group, a failure annotated (escaped), lines in the order they ended, exit 1 after all ran', () => {
  const res = path.join(TMP, 'each.jsonl'), t0 = Date.now();
  const r = spawnSync(process.execPath, [CLI, 'each', '--results', res, '--jobs', '2', '--no-retry', '--unit', 'u:{}', '--names', 'a b c', '--cwd', REPO, '--', process.execPath, 'step.mjs', '{}'], { encoding: 'utf8' });
  eq(r.status, 1, r.stdout + r.stderr);
  ok(Date.now() - t0 < 1500 + 200 + 6000, 'side by side');
  const out = r.stdout;
  for (const n of ['a', 'b', 'c']) ok(new RegExp(`::group::${n}\\nline1 ${n}\\n${n === 'b' ? '50% of b\\r?\\n' : ''}line2 ${n}\\n[✔✘] u:${n}[^\\n]*（[^\\n]*）\\n::endgroup::\\n`).test(out), `group ${n} whole:\n${out}`);
  const err = out.split('\n').filter((l) => l.startsWith('::error'));
  eq(err.length, 1, out);
  ok(err[0].startsWith('::error title=u%3Ab::line1 b%0A50%25 of b%0D%0Aline2 b') && !/[\r]/.test(err[0]), err[0]);
  ok(/✘ 3 個のうち 1 個が落ちた: u:b/.test(out), out);
  const rows = fs.readFileSync(res, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  eq(rows.map((x) => [x.unit, x.ok]), [['u:b', false], ['u:c', true], ['u:a', true]], 'the order they ended');
  ok(rows[2].deps?.['step.mjs'] === blob('step.mjs') && rows[0].deps === null, 'deps for a pass');
  const all = spawnSync(process.execPath, [CLI, 'each', '--results', res, '--jobs', '3', '--unit', 'v:{}', '--names', 'a c', '--cwd', REPO, '--', process.execPath, 'step.mjs', '{}'], { encoding: 'utf8' });
  ok(all.status === 0 && /✔ 2 個すべて通った/.test(all.stdout) && !/::error/.test(all.stdout), all.stdout);
});

await t('each, n > 1: one that failed beside others runs again alone — a pass with a warning, or the error; its later line is the one that counts', () => {
  const res = path.join(TMP, 'retry.jsonl'), crowd = fs.mkdtempSync(path.join(TMP, 'crowd-'));
  const go = (names) => spawnSync(process.execPath, [CLI, 'each', '--results', res, '--jobs', '3', '--unit', 'c:{}', '--names', names, '--cwd', REPO, '--', process.execPath, 'crowd.mjs', '{}'], { encoding: 'utf8', env: { ...process.env, CROWD: crowd } });
  const r = go('x y bad'), out = r.stdout;
  eq(r.status, 1, out + r.stderr);
  for (const n of ['x', 'y']) ok(new RegExp(`::group::${n}（1 つだけでもう一度）\\nalone\\n✔ c:${n}`).test(out) && out.includes(`::warning title=c%3A${n}::`), `${n} again alone:\n${out}`);
  const err = out.split('\n').filter((l) => l.startsWith('::error'));
  eq([err.length, err[0]?.startsWith('::error title=c%3Abad::')], [1, true], out);
  ok(/✘ 3 個のうち 1 個が落ちた: c:bad$/m.test(out), out);
  const rows = fs.readFileSync(res, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  eq([rows.length, rows.slice(0, 3).every((x) => !x.ok), rows.slice(3).map((x) => [x.unit, x.ok])], [6, true, [['c:x', true], ['c:y', true], ['c:bad', false]]], 'the first tries, then the ones alone');
  fs.rmSync(res);
  const fine = go('x y');
  ok(fine.status === 0 && /✔ 2 個すべて通った（2 個は 1 つだけでもう一度流して通った: x y）/.test(fine.stdout) && !/::error/.test(fine.stdout), fine.stdout);
  const plain = spawnSync(process.execPath, [CLI, 'each', '--results', res, '--jobs', '2', '--no-retry', '--unit', 'c:{}', '--names', 'x y', '--cwd', REPO, '--', process.execPath, 'crowd.mjs', '{}'], { encoding: 'utf8', env: { ...process.env, CROWD: crowd } });
  ok(plain.status === 1 && (plain.stdout.match(/^::error/gm) ?? []).length === 2 && !/1 つだけ/.test(plain.stdout), `--no-retry: as before\n${plain.stdout}`);
});

await t('each cancelled: what ended keeps its line, the units running stop, no record folder stays', async () => {
  const res = path.join(TMP, 'cancel.jsonl'), own = fs.mkdtempSync(path.join(TMP, 'own-tmp-')), pids = fs.mkdtempSync(path.join(TMP, 'pids-'));
  const c = spawn(process.execPath, [CLI, 'each', '--results', res, '--jobs', '2', '--unit', 'w:{}', '--names', 'quick slow', '--cwd', REPO, '--', process.execPath, 'slow.mjs', '{}'], { env: { ...process.env, TMPDIR: own, PIDS: pids }, stdio: 'ignore' });
  const closed = new Promise((r) => c.on('close', (code, sig) => r(code ?? sig)));
  for (let k = 0; k < 400 && !(fs.existsSync(res) && fs.existsSync(path.join(pids, 'slow'))); k++) await sleep(50);
  ok(fs.existsSync(res) && fs.existsSync(path.join(pids, 'slow')), 'quick ended, slow started');
  c.kill('SIGTERM');
  eq(await closed, 143, 'stopped');
  eq(fs.readFileSync(res, 'utf8').trim().split('\n').map((l) => JSON.parse(l).unit), ['w:quick'], 'only what ended');
  const pid = Number(fs.readFileSync(path.join(pids, 'slow'), 'utf8'));
  let alive = true;
  for (let k = 0; k < 100 && alive; k++) { try { process.kill(pid, 0); await sleep(50); } catch { alive = false; } }
  ok(!alive, 'the running unit stopped');
  eq(fs.readdirSync(own).filter((f) => f.startsWith('bdslab-deps-')), [], 'no record folder left');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
