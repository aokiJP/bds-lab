// The verify run's plan (.github/workflows/verify.yml, its first job) and its memory (the state job, its last): which units this
// run needs — an offline test, a workflow step, a part of the real server — from what each one read when it last passed
// (common/deps.mjs recorded it, common/verify-state.mjs names the contents). A unit runs again only when the content of a file
// it read changed, when it is new or failed last time, or on another machine: nothing is verified twice (a merge of what
// passed, a revert, a push that changed only the panel runs only what reads what changed).
// The real server (bds:*) runs at the end of a pull request, not on each push: a commit title with [bds] (or [full ci]), by
// hand, a push to the default branch, or the nightly run; on the other pushes the summary says what waits and how to run it.
// Nightly (schedule): also what has not passed for STALE_DAYS, so every unit runs at least once a week. [full ci] in the title,
// or by hand with full: everything and the extra ones (macOS, Endstone, LeviLamina). No memory yet, or one it cannot read:
// every unit allowed. When the offline job runs at all, the offline tests that took under CHEAP_MS come along (cheap insurance
// against what a record cannot see, a test that lists files with git).
// The memory is the artifact verify-state (verify-state.json) of a trusted run only — a push, by hand or nightly, of this very
// repository's verify.yml: a pull request's run can change the workflow, so its artifacts are never read.
//   node common/verify-plan.mjs        the plan: GITHUB_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_API_URL,
//                                      GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REF_NAME → offline, tests, eslint, smoke,
//                                      browser, bds, bdsparts, addons, extra, offmatrix (the offline job's runners, each with its
//                                      list: offlineSplit) in $GITHUB_OUTPUT; why in $GITHUB_STEP_SUMMARY
//   node common/verify-plan.mjs --merge --out <file>   the memory: the newest trusted state and this run's (GITHUB_RUN_ID)
//                                      verify-results-* artifacts → the new state (nothing written when one cannot be read: the
//                                      state before stays the newest)
// It never fails the run over its memory: a plan it cannot make is every unit allowed. Tested by tests/verify-plan-offline.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { policy } from './auto-guard.mjs';
import { STATE_VERSION, treeAt, valuesOf, envKey } from './verify-state.mjs';
import { TIME, PARTS } from './run-tests.mjs';
import { listEntries, readEntry } from '../sandbox-be/src/colony/zip.js';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const STALE_DAYS = 7;
export const CHEAP_MS = 15000;
export const KEEP_DAYS = 60;
// the workflow's steps that are units of their own (the offline job runs them), and the real server's parts (each a job)
export const STEPS = ['step:eslint', 'step:github-smoke', 'tests/panel-browser.mjs'];
export const BDS_PARTS = ['bench', 'scratch', 'dev', 'play'];
const TRUSTED = new Set(['push', 'workflow_dispatch', 'schedule']);
const isBds = (u) => u.startsWith('bds:');
const isTest = (u) => !isBds(u) && !STEPS.includes(u);
const msg = (e) => String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 200);

/** the checkout's units: the offline tests `auto gate --all` runs (in its order), the steps, the real server's parts and one
 *  per addon with a pack (a name the workflow can put on a command line: letters, digits, _ and -) */
export function listUnits(root = TOP) {
  const pol = policy(root);
  const all = fs.readdirSync(path.join(root, 'tests')).filter((f) => /^(offline|[\w-]+-offline)\.mjs$/.test(f)).map((f) => `tests/${f}`);
  const tests = [...new Set([...pol.gate, ...all.filter((t) => !pol.gate.includes(t)).sort()])].filter((t) => fs.existsSync(path.join(root, t)));
  let addons = [];
  try { addons = fs.readdirSync(path.join(root, 'bds', 'addons')).filter((n) => /^[A-Za-z0-9_-]+$/.test(n) && fs.existsSync(path.join(root, 'bds', 'addons', n, 'bp', 'manifest.json'))).sort(); } catch { /* none */ }
  return [...tests, ...STEPS, ...BDS_PARTS.map((p) => `bds:${p}`), ...addons.map((n) => `bds:addon:${n}`)];
}

/** every key the state's units read → its value in root's HEAD */
export function valuesNow(state, root = TOP) {
  const keys = new Set();
  for (const e of Object.values(state?.units ?? {})) if (e?.deps && typeof e.deps === 'object') for (const k of Object.keys(e.deps)) keys.add(k);
  return valuesOf([...keys], treeAt(root, 'HEAD'));
}

/** which units run and why (pure): not in the state (new, or it failed last time), passed on another machine, a file it read
 *  changed (up to 3 named), or — staleDays — not passed for that long; when the offline job runs at all, the offline tests that
 *  took under cheapMs come along → Map(unit → why) in the units' order */
export function select(state, units, values, { env = envKey(), now = Date.now(), staleDays = 0, cheapMs = CHEAP_MS } = {}) {
  const had = state?.units && typeof state.units === 'object' ? state.units : {}, why = new Map();
  for (const u of units) {
    const e = Object.hasOwn(had, u) ? had[u] : null;
    if (!e) { why.set(u, '前に通った記録がない（新しい・前に落ちた）'); continue; }
    if (typeof e !== 'object' || !e.deps || typeof e.deps !== 'object') { why.set(u, '前の記録が読めない'); continue; }
    if (e.env !== env) { why.set(u, `別の環境で通った記録（${e.env ?? '不明'}）`); continue; }
    const changed = Object.keys(e.deps).filter((k) => e.deps[k] !== values[k]);
    if (changed.length) { why.set(u, `変わった: ${changed.slice(0, 3).join('、')}${changed.length > 3 ? ` ほか ${changed.length - 3} 個` : ''}`); continue; }
    const at = Date.parse(e.at ?? '');
    if (staleDays > 0 && !(now - at <= staleDays * 864e5)) why.set(u, `${staleDays} 日より前に通ったきり`);
  }
  if ([...why.keys()].some((u) => !isBds(u))) {
    for (const u of units) {
      const ms = had[u]?.ms;
      if (!why.has(u) && isTest(u) && Number.isFinite(ms) && ms < cheapMs) why.set(u, `安いので一緒に（前に ${Math.round(ms / 1000)} 秒）`);
    }
  }
  return new Map(units.filter((u) => why.has(u)).map((u) => [u, why.get(u)]));
}

// The offline tests on one runner, or on two when together they are long: OFFLINE_SPLIT_S of their own seconds (what each took
// last time, from the memory — a test in parts its slowest part's time each part —, else run-tests' TIME, else a minute) is about
// 100 s on one runner's 6 at a time. Each runner gets its own list, the longest test first to the runner that would end first (its
// time over 6 at a time, never under its slowest part); runner 1 also runs the steps (ESLint, GitHub flows, about 20 s after)
export const OFFLINE_SPLIT_S = 600, OFFLINE_JOBS = 6, STEPS_S = 20;
export function offlineSplit(tests, state, { time = TIME, parts = PARTS, n = null } = {}) {
  const had = state?.units && typeof state.units === 'object' ? state.units : {};
  const k = (t) => (parts?.[t]?.length > 1 ? parts[t].length : 1);
  const secs = (t) => (Number.isFinite(had[t]?.ms) ? (had[t].ms / 1000) * k(t) : time[t] ?? 60);
  const total = tests.reduce((a, t) => a + secs(t), 0), m = n ?? (total > OFFLINE_SPLIT_S ? 2 : 1);
  const s = Array.from({ length: m }, (_, i) => ({ sum: 0, max: 0, first: i === 0 ? STEPS_S : 0, tests: new Set() }));
  const est = (x) => Math.max(x.sum / OFFLINE_JOBS, x.max) + x.first;
  for (const t of [...tests].sort((a, b) => secs(b) - secs(a) || (a < b ? -1 : 1))) {
    const add = (x) => ({ ...x, sum: x.sum + secs(t), max: Math.max(x.max, secs(t) / k(t)) });
    let best = 0;
    for (let i = 1; i < m; i++) if (est(add(s[i])) < est(add(s[best]))) best = i;
    s[best] = { ...add(s[best]), tests: s[best].tests.add(t) };
  }
  return s.map((x) => tests.filter((t) => x.tests.has(t)));
}

/** the plan (pure) → { offline, tests, eslint, smoke, browser, bds, bdsParts, addons, extra, run, waiting, skipped }:
 *  full — everything and the extra ones; no state — every unit allowed; the real server's units only when bdsAllowed (or full),
 *  the others wait (run and waiting: Map(unit → why)) */
export function planVerify({ units = [], state = null, values = {}, env = envKey(), now = Date.now(), full = false, bdsAllowed = false, staleDays = 0, reason = '' } = {}) {
  const picked = full || !state ? new Map(units.map((u) => [u, full ? '手で full・[full ci]: すべて' : reason || '前に通った記録（状態）がない: すべて']))
    : select(state, units, values, { env, now, staleDays });
  const run = new Map(), waiting = new Map();
  for (const [u, why] of picked) (isBds(u) && !(full || bdsAllowed) ? waiting : run).set(u, why);
  const tests = [...run.keys()].filter(isTest);
  const addons = [...run.keys()].filter((u) => u.startsWith('bds:addon:')).map((u) => u.slice('bds:addon:'.length));
  const bdsParts = [...BDS_PARTS.filter((p) => run.has(`bds:${p}`)), ...(addons.length ? ['addons'] : [])];
  const eslint = run.has('step:eslint'), smoke = run.has('step:github-smoke'), browser = run.has('tests/panel-browser.mjs');
  // the offline job's runners: Linux in one or two lists (offlineSplit), macOS (full only) the whole list on one
  const offMatrix = offlineSplit(tests, state).map((list, i) => ({ os: 'ubuntu-latest', shard: i + 1, tests: list.join(' ') }));
  if (full) offMatrix.push({ os: 'macos-latest', shard: 1, tests: tests.join(' ') });
  return { offline: tests.length > 0 || eslint || smoke || browser, tests, eslint, smoke, browser, bds: bdsParts.length > 0, bdsParts, addons, extra: !!full, offMatrix, run, waiting, skipped: units.length - picked.size };
}

/** what the run asks for (pure): the event's name, its payload, the branch → { full, bds, staleDays }. [full ci] / [bds] count in
 *  the head commit's title (its first line) only; by hand: the plan with the real server, full = everything */
export function askedOf(name, ev = {}, ref = '') {
  const title = String(ev?.head_commit?.message ?? '').split('\n')[0];
  const full = title.includes('[full ci]') || (name === 'workflow_dispatch' && String(ev?.inputs?.full) === 'true');
  const onDefault = name === 'push' && !!ev?.repository?.default_branch && ref === ev.repository.default_branch;
  return { full, bds: full || title.includes('[bds]') || name === 'workflow_dispatch' || name === 'schedule' || onDefault, staleDays: name === 'schedule' ? STALE_DAYS : 0 };
}

/** the plan's outputs for $GITHUB_OUTPUT (pure; a matrix of nothing is an error even for a job that will not run) */
export const outputs = (p) => [`offline=${p.offline}`, `tests=${p.tests.join(' ')}`, `eslint=${p.eslint}`, `smoke=${p.smoke}`, `browser=${p.browser}`, `bds=${p.bds}`,
  `bdsparts=${JSON.stringify(p.bdsParts.length ? p.bdsParts : ['none'])}`, `addons=${p.addons.join(' ')}`, `extra=${p.extra}`,
  `offmatrix=${JSON.stringify(p.offMatrix?.length ? p.offMatrix : [{ os: 'ubuntu-latest', shard: 1, tests: '' }])}`];

/** the plan in words (pure): where its memory came from, what runs and why, how many do not, what waits for the real server */
export function summary(p, from = null) {
  const L = [];
  L.push(`記録: ${from ? `実行 #${from.number ?? from.id}（${String(from.sha ?? '').slice(0, 7)}${from.branch ? `・${from.branch}` : ''}${from.at ? `・${String(from.at).slice(0, 16).replace('T', ' ')} UTC` : ''}）のもの` : 'なし（初めて・読めない）'}`);
  const what = [];
  const linux = (p.offMatrix ?? []).filter((x) => x.os === 'ubuntu-latest' && x.tests);
  if (p.tests.length) what.push(`オフラインの試験 ${p.tests.length} 本${linux.length > 1 ? `（${linux.length} 台に分けて: ${linux.map((x) => x.tests.split(' ').length).join(' 本・')} 本）` : ''}`);
  if (p.eslint) what.push('ESLint');
  if (p.smoke) what.push('GitHub の流れ');
  if (p.browser) what.push('本物のブラウザ');
  if (p.bds) what.push(`本物の BDS（${[...BDS_PARTS.filter((x) => p.bdsParts.includes(x)), ...(p.addons.length ? [`アドオン ${p.addons.join('・')}`] : [])].join('・')}）`);
  L.push(`流す: ${p.run.size ? `${p.run.size} 個 — ${what.join('・')}` : 'なし'}`);
  for (const [u, why] of [...p.run].slice(0, 40)) L.push(`- ${u}: ${why}`);
  if (p.run.size > 40) L.push(`- ほか ${p.run.size - 40} 個`);
  L.push(`流さない: ${p.skipped} 個（前に通ったときに読んだファイルの中身が変わっていない）`);
  if (p.waiting.size) {
    L.push(`本物の BDS は PR の最後に: ${p.waiting.size} 個が待っている。流すには commit の題（1 行目）に [bds] を入れるか、Actions の verify を手で（Run workflow）`);
    for (const [u, why] of [...p.waiting].slice(0, 12)) L.push(`- ${u}: ${why}`);
    if (p.waiting.size > 12) L.push(`- ほか ${p.waiting.size - 12} 個`);
  }
  if (!p.extra) L.push('すべて（macOS・Endstone・LeviLamina も）流すには: Actions の verify を手で full にするか、commit の題に [full ci]');
  return L;
}

// ---------- the memory on GitHub: artifacts ----------
const headers = (token) => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'bds-lab' });
async function getJson(fetchImpl, url, token) {
  const r = await fetchImpl(url, { headers: headers(token) });
  if (!r.ok) throw new Error(`GitHub が ${r.status} で断りました`);
  return r.json();
}
async function getBytes(fetchImpl, url, token) {
  const r = await fetchImpl(url, { headers: headers(token) });
  if (!r.ok) throw new Error(`GitHub が ${r.status} で断りました`);
  return Buffer.from(await r.arrayBuffer());
}
/** the files of an artifact's zip whose names end with ext → [{ name, text }] (pure) */
export function zipTexts(buf, ext) {
  return listEntries(buf).filter((e) => !e.dir && e.name.endsWith(ext)).map((e) => ({ name: e.name, text: readEntry(buf, e).toString('utf8') }));
}

/** a run whose artifacts may be believed (pure): this repository's own verify.yml, run by a push, by hand or nightly — never a
 *  pull request (it can change the workflow) and never another repository's code */
export const trusted = (run) => !!run && TRUSTED.has(run.event) && /^\.github\/workflows\/verify\.yml(@|$)/.test(String(run.path ?? ''))
  && run.repository?.id != null && run.head_repository?.id === run.repository.id;

/** the newest trusted, readable verify-state → { state, run: { id, number, sha, branch, at } } or null; GitHub refusing the
 *  list throws (a refused or broken artifact: the next older one) */
export async function loadState({ api, repo, token }, fetchImpl = fetch) {
  const j = await getJson(fetchImpl, `${api}/repos/${repo}/actions/artifacts?name=verify-state&per_page=30`, token);
  const arts = (j?.artifacts ?? []).filter((a) => a?.name === 'verify-state' && !a.expired && a.workflow_run?.id != null
    && a.workflow_run.repository_id != null && a.workflow_run.head_repository_id === a.workflow_run.repository_id)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  for (const a of arts.slice(0, 10)) {
    try {
      const run = await getJson(fetchImpl, `${api}/repos/${repo}/actions/runs/${a.workflow_run.id}`, token);
      if (!trusted(run)) continue;
      const file = zipTexts(await getBytes(fetchImpl, a.archive_download_url, token), '.json').find((x) => path.posix.basename(x.name) === 'verify-state.json');
      const s = file ? JSON.parse(file.text) : null;
      if (s?.v === STATE_VERSION && s.units && typeof s.units === 'object' && !Array.isArray(s.units)) {
        return { state: s, run: { id: run.id, number: run.run_number, sha: run.head_sha, branch: run.head_branch, at: a.created_at } };
      }
    } catch { /* this one cannot be read: an older one */ }
  }
  return null;
}

/** JSON lines → the results in them, a broken line left out (pure) */
export function parseResults(text) {
  const rows = [];
  for (const l of String(text).split('\n')) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l); if (r && typeof r.unit === 'string' && typeof r.ok === 'boolean') rows.push(r); } catch { /* a line cut short */ }
  }
  return rows;
}

/** this run's results: its artifacts named verify-results-*, every .jsonl in them */
export async function runResults({ api, repo, token, runId }, fetchImpl = fetch) {
  const j = await getJson(fetchImpl, `${api}/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, token);
  const rows = [];
  for (const a of (j?.artifacts ?? []).filter((x) => String(x?.name ?? '').startsWith('verify-results-') && !x.expired)) {
    for (const f of zipTexts(await getBytes(fetchImpl, a.archive_download_url, token), '.jsonl')) rows.push(...parseResults(f.text));
  }
  return rows;
}

/** the state after a run (pure): a unit that passed with what it read known → its entry; one that failed, or whose reads are not
 *  known → gone (it runs next time); the rest as they were, but none older than keepDays */
export function mergeState(prev, results, { now = Date.now(), keepDays = KEEP_DAYS } = {}) {
  const at = new Date(now).toISOString(), units = {};
  const before = prev?.v === STATE_VERSION && prev.units && typeof prev.units === 'object' ? prev.units : {};
  for (const [u, e] of Object.entries(before)) if (e && typeof e === 'object' && now - Date.parse(e.at ?? '') <= keepDays * 864e5) units[u] = e;
  for (const r of results ?? []) {
    if (!r || typeof r.unit !== 'string') continue;
    if (r.ok === true && r.deps && typeof r.deps === 'object' && !Array.isArray(r.deps)) units[r.unit] = { deps: r.deps, ms: r.ms, sha: r.sha, at, env: r.env };
    else delete units[r.unit];
  }
  return { v: STATE_VERSION, at, units };
}

function readEvent(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) ?? {}; } catch { return {}; } }

/** --merge: the new state into --out (the state job) */
async function merge({ gh, env, fetchImpl, out, file }) {
  if (!file) { out('使い方: node common/verify-plan.mjs --merge --out <file>'); process.exitCode = 2; return null; }
  let prev = null, rows = [];
  try { prev = await loadState(gh, fetchImpl); } catch (e) { out(`W 前の記録を読めない（${msg(e)}）: 新しい記録は書かない（前のものが残る）`); return null; }
  try { rows = await runResults({ ...gh, runId: env.GITHUB_RUN_ID }, fetchImpl); } catch (e) { out(`W この実行の結果を読めない（${msg(e)}）: 新しい記録は書かない（前のものが残る）`); return null; }
  const next = mergeState(prev?.state ?? null, rows);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next));
  const ok = rows.filter((r) => r.ok === true && r.deps).length, bad = rows.filter((r) => r.ok !== true).length, unknown = rows.length - ok - bad;
  const line = `記録: 前の ${prev ? `#${prev.run.number ?? prev.run.id}（${Object.keys(prev.state.units).length} 個）` : '記録なし'} + この実行の結果 ${rows.length} 個（通った ${ok}・落ちた ${bad}${unknown ? `・読んだものが分からない ${unknown}` : ''}）→ ${Object.keys(next.units).length} 個`;
  out(line);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### verify の記録\n${line}\n`);
  return next;
}

/** the plan for the checkout's HEAD (and $GITHUB_OUTPUT, $GITHUB_STEP_SUMMARY written when set); --merge: the state job */
export async function main({ env = process.env, cwd = TOP, fetchImpl = fetch, out = console.log, argv = process.argv.slice(2) } = {}) {
  const gh = { api: env.GITHUB_API_URL || 'https://api.github.com', repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN };
  if (argv.includes('--merge')) { const i = argv.indexOf('--out'); return merge({ gh, env, fetchImpl, out, file: i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }); }
  const ask = askedOf(env.GITHUB_EVENT_NAME ?? '', readEvent(env.GITHUB_EVENT_PATH), env.GITHUB_REF_NAME ?? '');
  const units = listUnits(cwd);
  let p, from = null;
  try {
    const loaded = ask.full ? null : await loadState(gh, fetchImpl);
    from = loaded?.run ?? null;
    p = planVerify({ units, state: loaded?.state ?? null, values: loaded ? valuesNow(loaded.state, cwd) : {}, full: ask.full, bdsAllowed: ask.bds, staleDays: ask.staleDays });
  } catch (e) {
    from = null;
    p = planVerify({ units, state: null, bdsAllowed: ask.bds, reason: `計画を作れない（${msg(e)}）: すべて` });
  }
  const lines = outputs(p), text = summary(p, from);
  for (const l of lines) out(l);
  for (const l of text) out(l);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### verify の計画\n${text.join('\n')}\n`);
  return p;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
