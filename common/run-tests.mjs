// The lab's offline test files, several at a time (the gate, `share`'s check of a release, `auto gate --all`).
// Most of a test's time is waiting (fake servers, timeouts, child processes), not CPU: on a 2-core machine 25 tests took
// 8.5 minutes one by one, a fraction of that side by side. Each test already works in its own temp folder; the few that
// share something in the lab folder (SERIAL below) each get a copy of their own when the lab is a git work tree — HEAD checked
// out in the temp folder with the changes not committed yet put over it — and run side by side with the rest; without git (or
// a copy) they run after the others one by one, as before. The longest first: the last ones to start are the short ones.
//   node common/run-tests.mjs [--jobs n] [--cwd dir] [--timeout ms] [--json] [--wrap <module>] [--results <file>] [--no-isolate] <test.mjs>...
//   LAB_GATE_JOBS=n  how many at a time (default: cores, at least 2, at most 6; 1 = one by one, as before)
//   --wrap m         each test with m's prepare(unit, { root, env }) → { env, finish({ ok, ms }) } (common/deps.mjs: what it read)
//   --results f      one JSON line per test as soon as it ends: { unit, ok, ms, ...finish() } (without --wrap: deps null)
//   --no-isolate     the SERIAL ones in the lab folder itself, after the others (as before)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// tests that write into the lab folder itself (units, .lab-current, runs/): never side by side with another in the same folder
// (each in a copy of its own, or one by one after the others)
// (cli-offline: it and offline.mjs both read and write the lab's remembered lab, .lab-kind — side by side, one saw the other's)
export const SERIAL = new Set(['tests/make-offline.mjs', 'tests/guards-offline.mjs', 'tests/cli-offline.mjs', 'tests/ci-offline.mjs', 'tests/import-offline.mjs', 'tests/colony-offline.mjs', 'tests/app-offline.mjs', 'tests/app-browser.mjs', 'tests/device-offline.mjs', 'tests/host-offline.mjs', 'tests/dev-bds.mjs']);
// tests that take long by design (the app lab drives a fake device through every step): their own time limit
export const LONG = { 'tests/app-offline.mjs': 3600000, 'tests/offline.mjs': 1800000, 'tests/env-offline.mjs': 1800000 };
// a test's usual seconds on CI's runner (verify's every offline test, 2026-10); a test not here counts as UNKNOWN. For the order
// (the longest first) and the shards' balance: a wrong number makes a run or a shard longer, never a test left out
export const TIME = {
  'tests/app-offline.mjs': 445, 'tests/rd-overlap-offline.mjs': 267, 'tests/env-offline.mjs': 234, 'tests/offline.mjs': 194, 'tests/device-offline.mjs': 86,
  'tests/host-offline.mjs': 65, 'tests/colony-offline.mjs': 50, 'tests/realplayer-offline.mjs': 48, 'tests/scratch-offline.mjs': 40, 'tests/rd-title-offline.mjs': 36,
  'tests/login-offline.mjs': 25, 'tests/cli-offline.mjs': 23, 'tests/rd-boot-offline.mjs': 20, 'tests/sim-offline.mjs': 16, 'tests/auto-offline.mjs': 13, 'tests/lint-offline.mjs': 13,
};
const UNKNOWN = 60;

/** shard i of n (1-based) of the list (pure): the tests split so the shards end about together — each test to the shard it
 *  makes shortest, the longest first; side by side tests count as their time over the jobs (never under the longest of them),
 *  SERIAL ones in full (one after another on their runner). first: seconds shard 1 spends besides (the workflow's steps after
 *  the gate there). The shard's tests in the list's order; every test in exactly one shard */
export function shardOf(list, i, n, { time = TIME, jobs = 4, first = 0 } = {}) {
  if (!(Number.isInteger(n) && n >= 1 && Number.isInteger(i) && i >= 1 && i <= n)) throw new Error(`shard ${i}/${n}: i/n with 1 ≤ i ≤ n`);
  const w = (t) => time[t] ?? UNKNOWN;
  const s = Array.from({ length: n }, (_, k) => ({ par: 0, max: 0, ser: k === 0 ? first : 0, tests: new Set() }));
  const est = (x) => Math.max(x.par / jobs, x.max) + x.ser;
  const after = (x, t) => (SERIAL.has(t) ? { ...x, ser: x.ser + w(t) } : { ...x, par: x.par + w(t), max: Math.max(x.max, w(t)) });
  for (const t of [...new Set(list)].sort((a, b) => w(b) - w(a) || (a < b ? -1 : 1))) {
    let best = 0;
    for (let k = 1; k < n; k++) if (est(after(s[k], t)) < est(after(s[best], t))) best = k;
    const x = after(s[best], t);
    s[best] = { ...x, tests: s[best].tests.add(t) };
  }
  return list.filter((t, k) => list.indexOf(t) === k && s[i - 1].tests.has(t));
}

export const defaultJobs = () => {
  const n = Number(process.env.LAB_GATE_JOBS);
  if (Number.isInteger(n) && n >= 1) return n;
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.min(6, Math.max(2, cpus));
};

// ---------- a SERIAL test's own copy of the lab ----------
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
// the top of the git work tree cwd is the top of, with a commit checked out; else null (no copies: the old way)
function workTree(cwd) {
  const r = git(cwd, ['rev-parse', '--show-toplevel']);
  if (r.status !== 0 || !r.stdout.trim() || real(r.stdout.trim()) !== real(cwd)) return null;
  return git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']).status === 0 ? path.resolve(cwd) : null;
}
// HEAD in a new folder of the temp folder (git worktree add --detach), and the work tree's changes not committed yet over it:
// the changed files and the new ones git does not ignore copied, the deleted ones deleted → { top, parent, dir } or null
function makeCopy(top) {
  let parent = null;
  try {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-iso-'));
    const dir = path.join(parent, path.basename(top)), c = { top, parent, dir };
    // (no hooks: a post-checkout hook is the person's, not a copy's)
    const add = git(top, ['-c', `core.hooksPath=${os.devNull}`, 'worktree', 'add', '--detach', '--quiet', dir, 'HEAD']);
    if (add.status !== 0) { dropCopy(c); return null; }
    const z = (args) => { const r = git(top, args); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.split('\0').filter(Boolean); };
    for (const f of new Set([...z(['diff', '--name-only', '--no-renames', '-z', 'HEAD']), ...z(['ls-files', '--others', '--exclude-standard', '-z'])])) {
      const from = path.join(top, f), to = path.join(dir, f);
      let st = null;
      try { st = fs.lstatSync(from); } catch { /* deleted */ }
      if (st?.isDirectory()) continue;   // (a submodule)
      fs.rmSync(to, { recursive: true, force: true });
      if (!st) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
      else { fs.copyFileSync(from, to); fs.chmodSync(to, st.mode & 0o7777); }
    }
    // the lab's starting point, which git ignores (.lab-base.json and .lab/base: lab.mjs makes them on its first run in a folder):
    // as the lab folder has it, or the copy's first `node lab.mjs` reads every file to make its own — not what the test did there,
    // and it would look as if the test had read the whole lab
    for (const f of ['.lab-base.json', path.join('.lab', 'base')]) {
      const from = path.join(top, f);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, f), { recursive: true });
    }
    return c;
  } catch {
    if (parent) dropCopy({ top, parent, dir: path.join(parent, path.basename(top)) });
    return null;
  }
}
function dropCopy(c) {
  git(c.top, ['worktree', 'remove', '--force', '--force', c.dir]);
  try { fs.rmSync(c.parent, { recursive: true, force: true }); } catch { /* the temp folder's cleaner takes it */ }
  git(c.top, ['worktree', 'prune']);
}
// copies still there go however this process ends: done, failed, stopped (Ctrl-C, a cancelled run) — the tests are stopped first
const copies = new Set(), kids = new Set();
function guardCopies() {
  const clean = () => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } for (const c of copies) dropCopy(c); copies.clear(); };
  const sig = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map((s) => [s, () => { clean(); process.exit(128 + (os.constants.signals[s] ?? 0)); }]));
  process.on('exit', clean);
  for (const [s, f] of Object.entries(sig)) process.on(s, f);
  return () => { process.off('exit', clean); for (const [s, f] of Object.entries(sig)) process.off(s, f); };
}

function one(t, cwd, env, timeout) {
  return new Promise((res) => {
    const limit = Math.max(timeout, LONG[t] ?? 0), t0 = Date.now(); let text = '', done = false;
    const c = spawn(process.execPath, [t], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    kids.add(c);
    const add = (d) => { text += d; if (text.length > 64e6) text = text.slice(-32e6); };
    c.stdout.on('data', add); c.stderr.on('data', add);
    const kill = setTimeout(() => { text += `\n✘ ${t}: no end after ${Math.round(limit / 1000)} s (stopped)`; try { c.kill('SIGKILL'); } catch { /* gone */ } }, limit);
    const end = (code) => { if (done) return; done = true; kids.delete(c); clearTimeout(kill); res({ t, ok: code === 0, code, ms: Date.now() - t0, lines: text.trim().split('\n') }); };
    c.on('error', (e) => { text += `\n✘ ${e.message}`; end(-1); });
    c.on('close', (code) => end(code));
  });
}

// → [{ t, ok, code, ms, lines }] in the order given; onDone(result) as each one ends. They start the longest first (times: the
// caller's ms per test, else TIME, else UNKNOWN). isolate: a SERIAL test in a copy of its own when cwd is the top of a git work
// tree (side by side with the rest), else after the others one by one. wrap: a module (its path) or an object with
// prepare(unit, { root, env }) → { env, finish({ ok, ms }) }: the test runs with that env added, and finish's value goes into
// results — a file, one JSON line { unit, ok, ms, ...finish() } appended as each test ends (a run stopped keeps what ended)
export function runTests(list, { cwd, env = process.env, jobs = defaultJobs(), timeout = 900000, onDone = () => {}, times = {}, wrap, results, isolate = true } = {}) {
  const est = (t) => times?.[t] ?? (TIME[t] ?? UNKNOWN) * 1000;
  const order = [...new Set(list)].sort((a, b) => est(b) - est(a)), out = new Map();
  return (async () => {
    const w = typeof wrap === 'string' ? await import(pathToFileURL(path.resolve(wrap)).href) : wrap ?? null;
    if (results) fs.mkdirSync(path.dirname(path.resolve(results)), { recursive: true });
    const here = path.resolve(cwd ?? process.cwd());
    const top = isolate && order.some((t) => SERIAL.has(t)) ? workTree(here) : null;
    const queue = order.filter((t) => top || !SERIAL.has(t)), later = order.filter((t) => !top && SERIAL.has(t));
    let warned = false;
    const run = async (t, at = cwd) => {
      let p = null;
      try { p = w ? await w.prepare(t, { root: at ?? here, env }) : null; } catch { p = null; }
      const r = await one(t, at, p?.env ? { ...env, ...p.env } : env, timeout);
      let extra = { deps: null };
      try { if (p) extra = await p.finish({ ok: r.ok, ms: r.ms }); } catch { extra = { deps: null }; }
      if (results) {
        try { fs.appendFileSync(results, JSON.stringify({ unit: t, ok: r.ok, ms: r.ms, ...extra }) + '\n'); } catch (e) { if (!warned) { warned = true; console.error(`W run-tests: 結果を ${results} に書けない: ${e.message}`); } }
      }
      onDone(r);
      return r;
    };
    const unguard = top ? guardCopies() : () => {};
    try {
      let i = 0;
      const worker = async () => {
        while (i < queue.length) {
          const t = queue[i++];
          if (!(top && SERIAL.has(t))) { out.set(t, await run(t)); continue; }
          const copy = makeCopy(top);
          if (!copy || path.isAbsolute(t) || !fs.existsSync(path.join(copy.dir, t))) { if (copy) dropCopy(copy); later.push(t); continue; }
          copies.add(copy);
          try { out.set(t, await run(t, copy.dir)); } finally { copies.delete(copy); dropCopy(copy); }
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, queue.length)) }, worker));
      for (const t of later) out.set(t, await run(t));
    } finally { unguard(); }
    return list.map((t) => out.get(t));
  })();
}

// the first lines that say what failed (✘ / FAIL), else the last line
export const why = (r) => r.lines.filter((l) => /^(✘|FAIL )/.test(l)).slice(0, 2).join(' | ') || r.lines.at(-1) || `exit ${r.code}`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), flag = (k) => { const i = a.indexOf(k); if (i < 0) return undefined; const v = a[i + 1]; a.splice(i, 2); return v; };
  const jobs = Number(flag('--jobs')) || defaultJobs(), cwd = path.resolve(flag('--cwd') ?? process.cwd()), timeout = Number(flag('--timeout')) || 900000;
  const wrap = flag('--wrap'), results = flag('--results');
  const json = a.includes('--json'), isolate = !a.includes('--no-isolate'), list = a.filter((x) => x !== '--json' && x !== '--no-isolate');
  const res = await runTests(list, { cwd, jobs, timeout, wrap: wrap && path.resolve(wrap), results: results && path.resolve(results), isolate, onDone: json ? () => {} : (r) => console.log(`${r.ok ? '✔' : '✘'} ${r.t} (${(r.ms / 1000).toFixed(0)} s)${r.ok ? '' : ': ' + why(r)}`) });
  if (json) process.stdout.write(JSON.stringify(res.map((r) => ({ ...r, lines: r.ok ? r.lines.slice(-3) : r.lines.slice(-200) }))));
  else console.log(res.every((r) => r.ok) ? `PASS ${res.length} tests` : `FAIL ${res.filter((r) => !r.ok).map((r) => r.t).join(' ')}`);
  process.exitCode = res.every((r) => r.ok) ? 0 : 1;
}
