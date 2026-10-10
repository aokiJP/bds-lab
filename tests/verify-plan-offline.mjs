// verify's plan and memory (common/verify-plan.mjs) without GitHub: which units run (new, failed last time, another machine, a
// file they read changed, not passed for a week on the nightly run; the cheap offline tests come along whenever the offline job
// runs), the real server only at the end of a pull request ([bds] / [full ci] in the title, by hand, the default branch, nightly —
// the rest waits and says how), everything and the extra ones by hand with full or [full ci], every allowed unit with no memory;
// the memory only from a trusted run (never a pull request's, a fork's, an expired or a broken artifact) and merged after the run
// (a pass in, a failure or an unknown read out, the old ones dropped); the whole plan and the whole merge on a temp git repository
// with a fake GitHub, the outputs and the summary written, the token never printed; verify.yml runs what the plan names, and
// notify.yml's if starts a runner exactly for the runs app notify tells.
// node tests/verify-plan-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = await import(pathToFileURL(path.join(TOP, 'common', 'verify-plan.mjs')).href);
const S = await import(pathToFileURL(path.join(TOP, 'common', 'verify-state.mjs')).href);
const Z = await import(pathToFileURL(path.join(TOP, 'sandbox-be', 'src', 'colony', 'zip.js')).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-verifyplan-'));
const ENV = S.envKey(), NOW = Date.parse('2026-10-10T00:00:00Z'), DAY = 864e5;
const entry = (deps, { ms = 30000, at = NOW - DAY, env = ENV } = {}) => ({ deps, ms, sha: 'a'.repeat(40), at: new Date(at).toISOString(), env });

await t('select (pure): new, failed last time, another machine, a file read changed (3 named), stale only when asked; the rest stays out', () => {
  const units = ['tests/a-offline.mjs', 'tests/b-offline.mjs', 'tests/c-offline.mjs', 'tests/d-offline.mjs', 'tests/e-offline.mjs', 'bds:dev'];
  const values = { 'common/x.mjs': 'x1', 'common/y.mjs': 'y1', 'dir:tests': 'd1', k1: 'v', k2: 'v', k3: 'v', k4: 'v' };
  const state = { v: 1, units: {
    'tests/a-offline.mjs': entry({ 'common/x.mjs': 'x0', 'common/y.mjs': 'y1' }),
    'tests/b-offline.mjs': entry({ 'common/y.mjs': 'y1', 'dir:tests': 'd1' }),
    'tests/c-offline.mjs': entry({ 'common/y.mjs': 'y1' }, { env: 'win32-x64 node22' }),
    'tests/d-offline.mjs': entry({ k1: 'old', k2: 'old', k3: 'old', k4: 'old' }),
    'bds:dev': entry({ 'common/y.mjs': 'y1' }, { at: NOW - 10 * DAY }),
  } };
  const m = V.select(state, units, values, { env: ENV, now: NOW, cheapMs: 0 });
  eq([...m.keys()], ['tests/a-offline.mjs', 'tests/c-offline.mjs', 'tests/d-offline.mjs', 'tests/e-offline.mjs'], 'in the units\' order');
  eq(m.get('tests/a-offline.mjs'), '変わった: common/x.mjs');
  ok(/別の環境で通った記録（win32-x64 node22）/.test(m.get('tests/c-offline.mjs')), m.get('tests/c-offline.mjs'));
  eq(m.get('tests/d-offline.mjs'), '変わった: k1、k2、k3 ほか 1 個');
  ok(/記録がない/.test(m.get('tests/e-offline.mjs')), m.get('tests/e-offline.mjs'));
  const night = V.select(state, units, values, { env: ENV, now: NOW, staleDays: 7, cheapMs: 0 });
  ok(night.has('bds:dev') && /7 日より前に通ったきり/.test(night.get('bds:dev')) && !night.has('tests/b-offline.mjs'), [...night].join(' | '));
  eq(V.select({ v: 1, units: { 'tests/a-offline.mjs': { deps: 'x' } } }, ['tests/a-offline.mjs'], {}, { env: ENV }).get('tests/a-offline.mjs'), '前の記録が読めない');
  eq(V.select({ v: 1, units: { constructor: entry({}) } }, ['toString'], {}, { env: ENV }).get('toString'), '前に通った記録がない（新しい・前に落ちた）', 'an inherited name is no entry');
});

await t('the cheap offline tests come along when the offline job runs anyway — not the steps, not the real server, not when nothing offline runs', () => {
  const units = ['tests/a-offline.mjs', 'tests/cheap-offline.mjs', 'tests/slow-offline.mjs', 'step:eslint', 'bds:bench'];
  const same = { f: 'v' };
  const st = { v: 1, units: { 'tests/a-offline.mjs': entry({ f: 'old' }), 'tests/cheap-offline.mjs': entry(same, { ms: 2000 }), 'tests/slow-offline.mjs': entry(same, { ms: 60000 }), 'step:eslint': entry(same, { ms: 1000 }), 'bds:bench': entry({ f: 'old' }, { ms: 1000 }) } };
  const m = V.select(st, units, same, { env: ENV, now: NOW });
  eq([...m.keys()], ['tests/a-offline.mjs', 'tests/cheap-offline.mjs', 'bds:bench']);
  eq(m.get('tests/cheap-offline.mjs'), '安いので一緒に（前に 2 秒）');
  eq([...V.select({ v: 1, units: { ...st.units, 'tests/a-offline.mjs': entry(same) } }, units, same, { env: ENV, now: NOW }).keys()], ['bds:bench'], 'only the real server changed');
});

await t('the plan (pure): the real server waits unless allowed; full: everything and the extra ones; no memory: every allowed unit; the outputs', () => {
  const units = ['tests/a-offline.mjs', 'tests/b-offline.mjs', 'step:eslint', 'step:github-smoke', 'tests/panel-browser.mjs', 'bds:bench', 'bds:scratch', 'bds:dev', 'bds:play', 'bds:addon:coins', 'bds:addon:shop'];
  const none = V.planVerify({ units, state: null });
  eq([none.offline, none.tests, none.eslint, none.smoke, none.browser, none.bds, none.extra, none.waiting.size, none.skipped], [true, ['tests/a-offline.mjs', 'tests/b-offline.mjs'], true, true, true, false, false, 6, 0]);
  eq(V.outputs(none), ['offline=true', 'tests=tests/a-offline.mjs tests/b-offline.mjs', 'eslint=true', 'smoke=true', 'browser=true', 'bds=false', 'bdsparts=["none"]', 'addons=', 'extra=false']);
  const allowed = V.planVerify({ units, state: null, bdsAllowed: true });
  eq([allowed.bds, allowed.bdsParts, allowed.addons, allowed.waiting.size], [true, ['bench', 'scratch', 'dev', 'play', 'addons'], ['coins', 'shop'], 0]);
  ok(V.outputs(allowed).includes('bdsparts=["bench","scratch","dev","play","addons"]') && V.outputs(allowed).includes('addons=coins shop'), V.outputs(allowed).join(' '));
  const full = V.planVerify({ units, state: { v: 1, units: {} }, full: true });
  eq([full.extra, full.bds, full.run.size, full.waiting.size], [true, true, units.length, 0]);
  // everything passed with the same reads; then one addon changed: its job alone, once the server may run
  const st = { v: 1, units: Object.fromEntries(units.map((u) => [u, entry({ f: 'v' }, { ms: 60000 })])) };
  const quiet = V.planVerify({ units, state: st, values: { f: 'v' }, env: ENV, now: NOW, bdsAllowed: true });
  eq([quiet.offline, quiet.bds, quiet.run.size, quiet.skipped], [false, false, 0, units.length], 'the same content: nothing');
  st.units['bds:addon:shop'] = entry({ f: 'old' });
  const one = V.planVerify({ units, state: st, values: { f: 'v' }, env: ENV, now: NOW, bdsAllowed: true });
  eq([one.offline, one.bds, one.bdsParts, one.addons, one.skipped], [false, true, ['addons'], ['shop'], units.length - 1]);
  const waits = V.planVerify({ units, state: st, values: { f: 'v' }, env: ENV, now: NOW });
  eq([waits.bds, [...waits.waiting.keys()]], [false, ['bds:addon:shop']]);
  const text = V.summary(waits).join('\n');
  ok(/流す: なし/.test(text) && /流さない: 10 個/.test(text) && /1 個が待っている。流すには commit の題（1 行目）に \[bds\]/.test(text) && /bds:addon:shop: 変わった: f/.test(text), text);
});

await t('what the run asks (pure): [bds] / [full ci] in the title only, by hand (full or not), nightly (stale), the default branch', () => {
  const push = (message, ref = 'feature', def = 'main') => V.askedOf('push', { head_commit: { message }, repository: { default_branch: def } }, ref);
  eq(push('a change'), { full: false, bds: false, staleDays: 0 });
  eq(push('verify: the real server [bds]'), { full: false, bds: true, staleDays: 0 });
  eq(push('a change\n\nsay [bds] or [full ci] in the title'), { full: false, bds: false, staleDays: 0 }, 'named in the body only');
  eq(push('[full ci] everything'), { full: true, bds: true, staleDays: 0 });
  eq(push('a change', 'main'), { full: false, bds: true, staleDays: 0 }, 'the default branch');
  eq(V.askedOf('workflow_dispatch', { inputs: { full: 'false' } }), { full: false, bds: true, staleDays: 0 });
  eq(V.askedOf('workflow_dispatch', { inputs: { full: true } }), { full: true, bds: true, staleDays: 0 });
  eq(V.askedOf('schedule', {}), { full: false, bds: true, staleDays: 7 });
  eq([V.askedOf('pull_request', {}), V.askedOf('', null)], [{ full: false, bds: false, staleDays: 0 }, { full: false, bds: false, staleDays: 0 }]);
});

await t('the memory after a run (pure): a pass with its reads in, a failure or unknown reads out, the rest kept unless older than 60 days; broken lines skipped; which runs are trusted', () => {
  const prev = { v: 1, units: { keep: entry({ f: 'v' }), fails: entry({ f: 'v' }), unknown: entry({ f: 'v' }), old: entry({ f: 'v' }, { at: NOW - 61 * DAY }) } };
  const rows = V.parseResults([`{"unit":"new","ok":true,"ms":5,"deps":{"g":"w"},"sha":"s","env":"${ENV}"}`, '{"unit":"fails","ok":false,"ms":5,"deps":null}', '{"unit":"unknown","ok":true,"ms":5,"deps":null}', '{broken', '{"unit":3,"ok":true}', ''].join('\n'));
  eq(rows.map((r) => r.unit), ['new', 'fails', 'unknown']);
  const next = V.mergeState(prev, rows, { now: NOW });
  eq(Object.keys(next.units).sort(), ['keep', 'new']);
  eq([next.v, next.units.new.deps, next.units.new.env, next.units.new.at, next.units.keep], [1, { g: 'w' }, ENV, new Date(NOW).toISOString(), prev.units.keep]);
  eq(Object.keys(V.mergeState({ v: 99, units: { x: entry({}) } }, [], { now: NOW }).units), [], 'another version: nothing of it');
  eq(V.mergeState(null, [], { now: NOW }).units, {});
  const run = (o) => ({ event: 'push', path: '.github/workflows/verify.yml', repository: { id: 1 }, head_repository: { id: 1 }, ...o });
  eq([run(), run({ event: 'workflow_dispatch' }), run({ event: 'schedule' }), run({ path: '.github/workflows/verify.yml@refs/heads/x' })].map(V.trusted), [true, true, true, true]);
  eq([run({ event: 'pull_request' }), run({ event: 'pull_request_target' }), run({ head_repository: { id: 2 } }), run({ path: '.github/workflows/verify.yml.bak' }), run({ repository: {} }), null].map(V.trusted), [false, false, false, false, false, false]);
});

// ---- a fake GitHub: routes url → JSON, a status, or bytes (an artifact's zip) ----
const zipOf = (files) => Z.writeZip(Object.entries(files).map(([name, s]) => ({ name, data: Buffer.from(s) })));
const fakeGitHub = (routes, seen = []) => async (url, init) => {
  seen.push({ url: String(url), auth: init?.headers?.authorization });
  const r = routes[String(url)];
  const no = (status) => ({ ok: false, status, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
  if (r === undefined) return no(404);
  if (typeof r === 'number') return no(r);
  if (Buffer.isBuffer(r)) return { ok: true, status: 200, json: async () => { throw new Error('not JSON'); }, arrayBuffer: async () => r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength) };
  return { ok: true, status: 200, json: async () => r, arrayBuffer: async () => new ArrayBuffer(0) };
};
const API = 'http://fake', REPO = 'o/r', LIST = `${API}/repos/${REPO}/actions/artifacts?name=verify-state&per_page=30`;
const art = (id, runId, created, o = {}) => ({ id, name: 'verify-state', expired: false, created_at: created, archive_download_url: `${API}/zip/${id}`, workflow_run: { id: runId, repository_id: 1, head_repository_id: 1 }, ...o });
const runOf = (id, o = {}) => ({ id, run_number: id + 1000, event: 'push', path: '.github/workflows/verify.yml', head_sha: 'c'.repeat(40), head_branch: 'main', repository: { id: 1 }, head_repository: { id: 1 }, ...o });
const stateRoutes = (state, id = 2, runId = 20) => ({ [LIST]: { artifacts: [art(id, runId, '2026-10-09T02:00:00Z')] }, [`${API}/repos/${REPO}/actions/runs/${runId}`]: runOf(runId), [`${API}/zip/${id}`]: zipOf({ 'verify-state.json': JSON.stringify(state) }) });

await t('the memory from GitHub: the newest trusted, readable verify-state — never a pull request\'s, a fork\'s, an expired or a broken one; a refused list throws', async () => {
  const good = { v: 1, at: 'x', units: { 'tests/a-offline.mjs': entry({ f: 'v' }) } };
  const routes = {
    [LIST]: { artifacts: [
      art(6, 60, '2026-10-09T06:00:00Z', { workflow_run: { id: 60, repository_id: 1, head_repository_id: 2 } }),
      art(5, 50, '2026-10-09T05:00:00Z'),
      art(4, 40, '2026-10-09T04:00:00Z', { expired: true }),
      art(3, 30, '2026-10-09T03:00:00Z'),
      art(1, 10, '2026-10-09T01:00:00Z'),
      art(2, 20, '2026-10-09T02:00:00Z'),
    ] },
    [`${API}/repos/${REPO}/actions/runs/50`]: runOf(50, { event: 'pull_request' }),
    [`${API}/repos/${REPO}/actions/runs/30`]: runOf(30),
    [`${API}/repos/${REPO}/actions/runs/20`]: runOf(20, { event: 'schedule' }),
    [`${API}/repos/${REPO}/actions/runs/10`]: runOf(10),
    [`${API}/zip/3`]: Buffer.from('not a zip at all'),
    [`${API}/zip/2`]: zipOf({ 'verify-state.json': JSON.stringify(good) }),
    [`${API}/zip/1`]: zipOf({ 'verify-state.json': JSON.stringify({ v: 1, units: {} }) }),
  };
  const seen = [], got = await V.loadState({ api: API, repo: REPO, token: 'tok-1' }, fakeGitHub(routes, seen));
  eq([got?.run.id, got?.run.number, got?.run.at, Object.keys(got?.state.units ?? {})], [20, 1020, '2026-10-09T02:00:00Z', ['tests/a-offline.mjs']]);
  ok(!seen.some((x) => /\/runs\/(40|60)$|\/zip\/(4|5|6)$/.test(x.url)), `never asked for those: ${seen.map((x) => x.url).join(' ')}`);
  ok(seen.every((x) => x.auth === 'Bearer tok-1'), 'asked with the token');
  eq(await V.loadState({ api: API, repo: REPO, token: 't' }, fakeGitHub({ [LIST]: { artifacts: [] } })), null, 'none');
  const odd = { ...routes, [`${API}/zip/2`]: zipOf({ 'verify-state.json': JSON.stringify({ v: 2, units: {} }) }), [`${API}/zip/1`]: zipOf({ 'other.json': '{}' }) };
  eq(await V.loadState({ api: API, repo: REPO, token: 't' }, fakeGitHub(odd)), null, 'another version, no state file in the zip: none');
  let threw = ''; try { await V.loadState({ api: API, repo: REPO, token: 't' }, fakeGitHub({ [LIST]: 500 })); } catch (e) { threw = e.message; }
  ok(/500/.test(threw), threw);
});

// ---- a temp git repository ----
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const put = (dir, files) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); } };
const commit = (dir, files, msg) => { put(dir, files); git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };
const envFor = (d, { message = 'a change', event = 'push', ref = 'feature', inputs, ...extra } = {}) => {
  const base = path.join(TMP, `${path.basename(d)}-${Math.random().toString(36).slice(2, 8)}`);
  fs.writeFileSync(`${base}-event.json`, JSON.stringify({ head_commit: { message }, repository: { default_branch: 'main' }, ...(inputs ? { inputs } : {}) }));
  fs.writeFileSync(`${base}-out.txt`, ''); fs.writeFileSync(`${base}-sum.md`, '');
  return { GITHUB_OUTPUT: `${base}-out.txt`, GITHUB_STEP_SUMMARY: `${base}-sum.md`, GITHUB_EVENT_PATH: `${base}-event.json`, GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: ref, GITHUB_REPOSITORY: REPO, GITHUB_API_URL: API, GITHUB_TOKEN: 'tok-SECRET-1234', ...extra };
};
const quiet = () => { const said = []; return { said, out: (l) => said.push(l) }; };
const read = (f) => fs.readFileSync(f, 'utf8');

await t('the plan on a repository: only what read a changed file runs (a folder listed sees files added, not edits); the real server waits on a branch, runs with [bds], by hand or on the default branch; outputs and summary written; the token never printed', async () => {
  const d = path.join(TMP, 'repo'); fs.mkdirSync(d); git(d, 'init', '-q');
  const c1 = commit(d, { 'common/x.mjs': 'x\n', 'common/y.mjs': 'y\n', 'tests/a-offline.mjs': 'a\n', 'tests/b-offline.mjs': 'b\n', 'tests/offline.mjs': 'o\n', '.github/workflows/verify.yml': 'name: verify\n', 'bds/addons/coins/bp/manifest.json': '{}\n', 'bds/addons/junk/readme.txt': 'no pack\n' }, 'one');
  const dep = (keys) => S.valuesOf(keys, S.treeAt(d, c1)), slow = { ms: 600000 };
  const state = { v: 1, at: 'x', units: {
    'tests/a-offline.mjs': entry(dep(['tests/a-offline.mjs', 'common/x.mjs', '.github/workflows/verify.yml']), slow),
    'tests/b-offline.mjs': entry(dep(['tests/b-offline.mjs', 'common/y.mjs', '.github/workflows/verify.yml']), slow),
    'tests/offline.mjs': entry(dep(['tests/offline.mjs', 'dir:common']), slow),
    'step:eslint': entry(dep(['common/x.mjs', 'common/y.mjs']), slow),
    'step:github-smoke': entry(dep(['common/y.mjs']), slow),
    'tests/panel-browser.mjs': entry(dep(['common/y.mjs']), slow),
    'bds:bench': entry(dep(['common/y.mjs']), slow), 'bds:scratch': entry(dep(['common/y.mjs']), slow), 'bds:play': entry(dep(['common/y.mjs']), slow),
    'bds:dev': entry(dep(['common/x.mjs']), slow), 'bds:addon:coins': entry(dep(['common/x.mjs', 'dir:bds/addons/coins']), slow),
  } };
  commit(d, { 'common/x.mjs': 'x2\n' }, 'two');
  const gh = fakeGitHub(stateRoutes(state));
  const env = envFor(d), q = quiet();
  const p = await V.main({ env, cwd: d, fetchImpl: gh, out: q.out, argv: [] });
  eq([p.tests, p.eslint, p.smoke, p.browser, p.bds, [...p.waiting.keys()], p.skipped], [['tests/a-offline.mjs'], true, false, false, false, ['bds:dev', 'bds:addon:coins'], 7]);
  const o = read(env.GITHUB_OUTPUT), sum = read(env.GITHUB_STEP_SUMMARY);
  ok(/^offline=true$/m.test(o) && /^tests=tests\/a-offline\.mjs$/m.test(o) && /^bds=false$/m.test(o) && /^bdsparts=\["none"\]$/m.test(o) && /^addons=$/m.test(o) && /^extra=false$/m.test(o), o);
  ok(/^### verify の計画\n記録: 実行 #1020（ccccccc・main・2026-10-09 02:00 UTC）のもの/.test(sum) && /- tests\/a-offline\.mjs: 変わった: common\/x\.mjs/.test(sum) && /2 個が待っている/.test(sum), sum);
  ok(![...q.said, o, sum].join('\n').includes('SECRET'), 'the token never printed');
  for (const e of [envFor(d, { message: 'x again [bds]' }), envFor(d, { event: 'workflow_dispatch', inputs: { full: 'false' } }), envFor(d, { ref: 'main' })]) {
    const r = await V.main({ env: e, cwd: d, fetchImpl: gh, out: quiet().out, argv: [] });
    eq([r.bds, r.bdsParts, r.addons, r.waiting.size, r.extra], [true, ['dev', 'addons'], ['coins'], 0, false], e.GITHUB_EVENT_NAME);
    ok(/^bdsparts=\["dev","addons"\]$/m.test(read(e.GITHUB_OUTPUT)) && /^addons=coins$/m.test(read(e.GITHUB_OUTPUT)), read(e.GITHUB_OUTPUT));
  }
  // a file added to a folder a unit listed: it runs; full by hand: everything and the extra ones; GitHub refusing: every allowed unit
  commit(d, { 'common/z.mjs': 'z\n' }, 'three');
  eq((await V.main({ env: envFor(d), cwd: d, fetchImpl: gh, out: quiet().out, argv: [] })).tests, ['tests/a-offline.mjs', 'tests/offline.mjs'], 'dir:common listed');
  const fullEnv = envFor(d, { event: 'workflow_dispatch', inputs: { full: 'true' } }), full = await V.main({ env: fullEnv, cwd: d, fetchImpl: gh, out: quiet().out, argv: [] });
  eq([full.extra, full.run.size, full.tests.length], [true, 11, 3]);
  ok(/^extra=true$/m.test(read(fullEnv.GITHUB_OUTPUT)) && !/すべて（macOS/.test(read(fullEnv.GITHUB_STEP_SUMMARY)), read(fullEnv.GITHUB_STEP_SUMMARY));
  const refused = await V.main({ env: envFor(d), cwd: d, fetchImpl: fakeGitHub({ [LIST]: 500 }), out: quiet().out, argv: [] });
  eq([refused.tests.length, refused.bds, refused.waiting.size, refused.extra], [3, false, 5, false]);
  ok(/計画を作れない（GitHub が 500 で断りました）/.test(refused.run.get('tests/offline.mjs')), refused.run.get('tests/offline.mjs'));
});

await t('--merge: the newest trusted state and this run\'s verify-results-* → the file and a summary line; nothing written when either cannot be read', async () => {
  const prev = { v: 1, at: 'x', units: { 'tests/a-offline.mjs': entry({ f: 'v' }), 'tests/b-offline.mjs': entry({ f: 'v' }), 'bds:dev': entry({ f: 'v' }) } };
  const lines = (...rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const routes = {
    ...stateRoutes(prev),
    [`${API}/repos/${REPO}/actions/runs/77/artifacts?per_page=100`]: { artifacts: [
      { name: 'verify-results-offline', expired: false, archive_download_url: `${API}/zip/r1` },
      { name: 'verify-results-bds-dev', expired: false, archive_download_url: `${API}/zip/r2` },
      { name: 'bds-addons', expired: false, archive_download_url: `${API}/zip/r3` },
    ] },
    [`${API}/zip/r1`]: zipOf({ 'offline.jsonl': lines({ unit: 'tests/a-offline.mjs', ok: true, ms: 9, deps: { g: 'w' }, sha: 's', env: ENV }, { unit: 'tests/b-offline.mjs', ok: false, ms: 9, deps: null }), 'eslint.jsonl': lines({ unit: 'step:eslint', ok: true, ms: 3, deps: { h: 'u' }, sha: 's', env: ENV }) }),
    [`${API}/zip/r2`]: zipOf({ 'bds.jsonl': lines({ unit: 'bds:dev', ok: true, ms: 9, deps: null }) }),
  };
  const out = path.join(TMP, 'merged', 'verify-state.json'), sum = path.join(TMP, 'merge-sum.md'), q = quiet();
  fs.writeFileSync(sum, '');
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_API_URL: API, GITHUB_TOKEN: 'tok-SECRET-1234', GITHUB_RUN_ID: '77', GITHUB_STEP_SUMMARY: sum };
  const next = await V.main({ env, cwd: TOP, fetchImpl: fakeGitHub(routes), out: q.out, argv: ['--merge', '--out', out] });
  const file = JSON.parse(read(out));
  eq([Object.keys(file.units).sort(), file.units['tests/a-offline.mjs'].deps, file.v], [['step:eslint', 'tests/a-offline.mjs'], { g: 'w' }, 1]);
  eq(Object.keys(next.units).sort(), Object.keys(file.units).sort());
  ok(/^記録: 前の #1020（3 個） \+ この実行の結果 4 個（通った 2・落ちた 1・読んだものが分からない 1）→ 2 個$/m.test(q.said.join('\n')) && /^### verify の記録\n記録: /.test(read(sum)) && !read(sum).includes('SECRET'), q.said.join('\n'));
  fs.rmSync(out);
  for (const bad of [{ ...routes, [LIST]: 500 }, { ...routes, [`${API}/repos/${REPO}/actions/runs/77/artifacts?per_page=100`]: 403 }]) {
    const qq = quiet(), r = await V.main({ env, cwd: TOP, fetchImpl: fakeGitHub(bad), out: qq.out, argv: ['--merge', '--out', out] });
    ok(r === null && !fs.existsSync(out) && /新しい記録は書かない（前のものが残る）/.test(qq.said.join('\n')), qq.said.join('\n'));
  }
  const first = await V.main({ env, cwd: TOP, fetchImpl: fakeGitHub({ ...routes, [LIST]: { artifacts: [] } }), out: quiet().out, argv: ['--merge', '--out', out] });
  eq(Object.keys(first.units).sort(), ['step:eslint', 'tests/a-offline.mjs'], 'the first memory: this run\'s passes');
});

await t('verify.yml runs what the plan names: every output handed on, each step and part as its unit, the tests recorded, the memory saved by the state job', () => {
  const y = read(path.join(TOP, '.github', 'workflows', 'verify.yml'));
  const names = V.outputs(V.planVerify({ units: [] })).map((l) => l.split('=')[0]);
  for (const o of names) ok(y.includes(`${o}: \${{ steps.plan.outputs.${o} }}`), `the plan job hands on ${o}`);
  for (const p of V.BDS_PARTS) ok(y.includes(`matrix.part == '${p}'`) && y.includes(`run bds:${p} --results`), `the real server's part ${p}: run as bds:${p}`);
  for (const u of V.STEPS) ok(y.includes(`run ${u} --results`), `the step ${u} run as its unit`);
  ok(y.includes("--unit 'bds:addon:{}'") && y.includes('auto gate --tests') && y.includes('--record --results'), 'the addons and the offline tests recorded');
  ok(y.includes('node common/verify-plan.mjs --merge --out') && y.includes('name: verify-state') && /name: verify-results-/.test(y), 'the state job saves the memory');
  ok(/schedule:\s*\n(?:\s*#.*\n)*\s*- cron:/.test(y) && /full:\s*\n\s*description:/.test(y), 'nightly, and full by hand');
  // (the first `node lab.mjs` of a checkout reads every file to make the lab's starting point: done before any unit is recorded)
  for (const [job, next, cmd] of [['offline', 'bds', 'node lab.mjs help > /dev/null'], ['bds', 'end', 'node ../lab.mjs help > /dev/null']]) {
    const body = y.slice(y.indexOf(`\n  ${job}:\n`), y.indexOf(`\n  ${next}:\n`)).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const at = body.indexOf(cmd), first = body.search(/common\/deps\.mjs|--record/);
    ok(at > 0 && first > at, `${job}: the lab's starting point made before the first recorded unit`);
  }
});

await t('notify.yml starts a runner exactly for the runs app notify tells (its if, evaluated as GitHub does: strings without case)', async () => {
  const RM = await import(pathToFileURL(path.join(TOP, 'app', 'lib', 'runmsg.mjs')).href);
  const yml = read(path.join(TOP, '.github', 'workflows', 'notify.yml'));
  const expr = /^ {4}if: >-\n((?: {6}.*\n)+)/m.exec(yml)?.[1].replace(/\s+/g, ' ').trim();
  ok(expr, 'the notify job\'s if');
  const js = expr.replace(/github\.event_name/g, 'E').replace(/github\.event\.workflow_run\.conclusion/g, 'C').replace(/github\.event\.workflow_run\.event/g, 'V').replace(/vars\.LAB_NOTIFY/g, 'P')
    .replace(/!=/g, '!==').replace(/([^!=])==([^=])/g, '$1===$2').replace(/'([^']*)'/g, (_, x) => `'${x.toLowerCase()}'`);
  ok(!/[A-Za-z_]\.[A-Za-z_]/.test(js.replace(/'[^']*'/g, '')), `every context understood: ${js}`);
  const starts = new Function('E', 'C', 'V', 'P', `return (${js});`);
  for (const P of ['', 'auto', 'ALL', 'all', 'failures', 'off', 'Off', 'something']) for (const C of ['success', 'failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required']) for (const V0 of ['push', 'workflow_dispatch', 'schedule']) {
    const run = { status: 'completed', conclusion: C, event: V0 };
    eq(starts('workflow_run', C, V0, P.toLowerCase()), RM.shouldNotify(run, P), `LAB_NOTIFY=${P || '(none)'} ${C} ${V0}`);
  }
  ok(starts('workflow_dispatch', '', '', ''), 'by hand: always');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
