// The lab's offline test files, several at a time (the gate, `share`'s check of a release, `auto gate --all`).
// Most of a test's time is waiting (fake servers, timeouts, child processes), not CPU: on a 2-core machine 25 tests took
// 8.5 minutes one by one, a fraction of that side by side. Each test already works in its own temp folder; the few that
// share something in the lab folder run alone after the others (SERIAL below).
//   node common/run-tests.mjs [--jobs n] [--cwd dir] [--timeout ms] [--json] <test.mjs>...
//   LAB_GATE_JOBS=n  how many at a time (default: cores, at least 2, at most 6; 1 = one by one, as before)
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// tests that write into the lab folder itself (units, .lab-current, runs/): never side by side with another
// (cli-offline: it and offline.mjs both read and write the lab's remembered lab, .lab-kind — side by side, one saw the other's)
export const SERIAL = new Set(['tests/make-offline.mjs', 'tests/guards-offline.mjs', 'tests/cli-offline.mjs', 'tests/ci-offline.mjs', 'tests/import-offline.mjs', 'tests/colony-offline.mjs', 'tests/app-offline.mjs', 'tests/app-browser.mjs', 'tests/device-offline.mjs', 'tests/host-offline.mjs', 'tests/dev-bds.mjs']);
// tests that take long by design (the app lab drives a fake device through every step): their own time limit
export const LONG = { 'tests/app-offline.mjs': 3600000, 'tests/offline.mjs': 1800000, 'tests/env-offline.mjs': 1800000 };
// a test's usual seconds on a 4-core runner (from `auto gate --all`); a test not here counts as UNKNOWN. Only for the shards'
// balance: a wrong number makes one shard longer, never a test left out. Empty while CI runs them on one runner
// (common/verify-plan.mjs SHARDS): every test counts the same
export const TIME = {};
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

// → [{ t, ok, code, ms, lines }] in the order given; onDone(result) as each one ends
export function runTests(list, { cwd, env = process.env, jobs = defaultJobs(), timeout = 900000, onDone = () => {} } = {}) {
  const one = (t) => new Promise((res) => {
    const limit = Math.max(timeout, LONG[t] ?? 0), t0 = Date.now(); let text = '', done = false;
    const c = spawn(process.execPath, [t], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (d) => { text += d; if (text.length > 64e6) text = text.slice(-32e6); };
    c.stdout.on('data', add); c.stderr.on('data', add);
    const kill = setTimeout(() => { text += `\n✘ ${t}: no end after ${Math.round(limit / 1000)} s (stopped)`; try { c.kill('SIGKILL'); } catch { /* gone */ } }, limit);
    const end = (code) => { if (done) return; done = true; clearTimeout(kill); const r = { t, ok: code === 0, code, ms: Date.now() - t0, lines: text.trim().split('\n') }; onDone(r); res(r); };
    c.on('error', (e) => { text += `\n✘ ${e.message}`; end(-1); });
    c.on('close', (code) => end(code));
  });
  const par = list.filter((t) => !SERIAL.has(t)), ser = list.filter((t) => SERIAL.has(t)), out = new Map();
  return (async () => {
    let i = 0;
    const worker = async () => { while (i < par.length) { const t = par[i++]; out.set(t, await one(t)); } };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, par.length)) }, worker));
    for (const t of ser) out.set(t, await one(t));
    return list.map((t) => out.get(t));
  })();
}

// the first lines that say what failed (✘ / FAIL), else the last line
export const why = (r) => r.lines.filter((l) => /^(✘|FAIL )/.test(l)).slice(0, 2).join(' | ') || r.lines.at(-1) || `exit ${r.code}`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), flag = (k) => { const i = a.indexOf(k); if (i < 0) return undefined; const v = a[i + 1]; a.splice(i, 2); return v; };
  const jobs = Number(flag('--jobs')) || defaultJobs(), cwd = path.resolve(flag('--cwd') ?? process.cwd()), timeout = Number(flag('--timeout')) || 900000;
  const json = a.includes('--json'), list = a.filter((x) => x !== '--json');
  const res = await runTests(list, { cwd, jobs, timeout, onDone: json ? () => {} : (r) => console.log(`${r.ok ? '✔' : '✘'} ${r.t} (${(r.ms / 1000).toFixed(0)} s)${r.ok ? '' : ': ' + why(r)}`) });
  if (json) process.stdout.write(JSON.stringify(res.map((r) => ({ ...r, lines: r.ok ? r.lines.slice(-3) : r.lines.slice(-200) }))));
  else console.log(res.every((r) => r.ok) ? `PASS ${res.length} tests` : `FAIL ${res.filter((r) => !r.ok).map((r) => r.t).join(' ')}`);
  process.exitCode = res.every((r) => r.ok) ? 0 : 1;
}
