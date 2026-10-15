// the 「AI 作成の進み具合」 card without a browser or a network: the stages from a run's jobs and steps (pure: now, done, fell,
// still to come, the time left from earlier runs), the card on a small fake DOM over a fake GitHub (node:http, GitHub's rules
// for writes through ghrules): read again every 15 s and stopped when the run is over, a fall told with GitHub's words and the
// next step, the retry through the page's guard (or told why not), the way to the release.
// node tests/progress-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const PG = await imp('panel/lib/progress.mjs'), G = await imp('panel/lib/gh.mjs'), P = await imp('panel/lib/policy.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const T0 = Date.parse('2026-01-01T00:00:00Z'), at = (min) => new Date(T0 + min * 60_000).toISOString();
const step = (name, status, conclusion, a, b) => ({ name, status, conclusion: conclusion ?? null, started_at: a === undefined ? null : at(a), completed_at: b === undefined ? null : at(b) });
const PRE = (c = 'success') => [step('Set up job', 'completed', 'success', 0, 0), step('Run actions/checkout@v5', 'completed', 'success', 0, 1), step('Run npm i -g esbuild@0.28', 'completed', 'success', 1, 2)];
const job = (steps) => [{ id: 1, name: 'make', steps }];
const states = (r) => r.stages.map((s) => s.state);
const EXPECT = 20 * 60_000;

// (the page's requests to the fake GitHub counted where they start — its fetch, answer and body read: a wait ends when none is
// open and none has come or gone for a while — not after a fixed time, which a busy CI runner can outlast)
const net = { busy: 0, at: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (...x) => {
  net.busy++; net.at = Date.now();
  try { const r = await realFetch(...x), body = await r.arrayBuffer(); return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers }); } finally { net.busy--; net.at = Date.now(); }
};
const settle = async () => {
  const until = Date.now() + 10_000;
  await new Promise((r) => setTimeout(r, 30));
  while (Date.now() < until && (net.busy > 0 || Date.now() - net.at < 60)) await new Promise((r) => setTimeout(r, 15));
};

await t('the stages: five, in order, with their words', () => {
  eq(PG.STAGES.map((s) => s.label), ['考える', '作る', '本物のサーバーで遊ぶ', '配る', '知らせる']);
});
await t('queued: nothing begun; just begun: thinking', () => {
  eq(states(PG.stagesOf([], { run: { status: 'queued' } })), ['todo', 'todo', 'todo', 'todo', 'todo']);
  const r = PG.stagesOf(job([...PRE(), step('make', 'in_progress', null, 2)]), { now: T0 + 3 * 60_000, run: { status: 'in_progress' }, expect: EXPECT });
  eq(states(r), ['now', 'todo', 'todo', 'todo', 'todo']); ok(r.estimated && r.percent > 0 && r.percent < 20, r.percent);
});
await t('inside the make step: the stage follows the time against the usual time (a guess, said so)', () => {
  const run = { status: 'in_progress' }, s = job([...PRE(), step('make', 'in_progress', null, 2)]);
  eq(states(PG.stagesOf(s, { now: T0 + (2 + 11) * 60_000, run, expect: EXPECT })), ['done', 'done', 'now', 'todo', 'todo']);
  eq(states(PG.stagesOf(s, { now: T0 + (2 + 19) * 60_000, run, expect: EXPECT })), ['done', 'done', 'done', 'now', 'todo']);
  eq(states(PG.stagesOf(s, { now: T0 + 500 * 60_000, run, expect: EXPECT })).slice(0, 4), ['done', 'done', 'done', 'now'], 'past the usual time: the last stage, never done');
  eq(states(PG.stagesOf(s, { now: T0 + 9 * 60_000, run, expect: null })), ['now', 'todo', 'todo', 'todo', 'todo'], 'no history: the first');
});
await t('make done, upload going: telling; all done: all done, 100%', () => {
  const mk = step('make', 'completed', 'success', 2, 20);
  eq(states(PG.stagesOf(job([...PRE(), mk, step('Run actions/upload-artifact', 'in_progress', null, 20)]), { run: { status: 'in_progress' }, expect: EXPECT })), ['done', 'done', 'done', 'done', 'now']);
  const r = PG.stagesOf(job([...PRE(), mk, step('Run actions/upload-artifact', 'completed', 'success', 20, 21)]), { run: { status: 'completed', conclusion: 'success' } });
  eq(states(r), ['done', 'done', 'done', 'done', 'done']); eq([r.percent, r.failed, r.index], [100, false, -1]);
});
await t('a fall: the stage it fell in is failed, before it done, after it still to come; the words of the failure can name the stage', () => {
  const run = { status: 'completed', conclusion: 'failure' }, s = job([...PRE(), step('make', 'completed', 'failure', 2, 12), step('Run actions/upload-artifact', 'completed', 'success', 12, 12)]);
  const r = PG.stagesOf(s, { run, expect: EXPECT });
  eq(states(r), ['done', 'done', 'failed', 'todo', 'todo']); ok(r.failed && r.index === 2, 'index');
  eq(states(PG.stagesOf(s, { run, expect: EXPECT, hint: 'server did not start (playtest)' })), ['done', 'done', 'failed', 'todo', 'todo']);
  eq(states(PG.stagesOf(s, { run, expect: EXPECT, hint: 'build failed' })), ['done', 'failed', 'todo', 'todo', 'todo']);
  eq(states(PG.stagesOf(job([step('Set up job', 'completed', 'failure', 0, 0)]), { run })).includes('failed'), true, 'a run with no step to blame still shows where');
  ok(PG.nextStep('play').length > 10 && PG.nextStep('zzz').length > 10, 'a next step for each');
});
await t('steps named for the stages are used as they are', () => {
  const s = job([step('think', 'completed', 'success', 0, 2), step('build', 'completed', 'success', 2, 6), step('playtest on server', 'in_progress', null, 6)]);
  eq(states(PG.stagesOf(s, { run: { status: 'in_progress' } })), ['done', 'done', 'now', 'todo', 'todo']);
});
await t('the time left: the middle of the earlier good runs; unknown without them; over for a finished run', () => {
  const r = (id, min, c = 'success') => ({ id, status: 'completed', conclusion: c, run_started_at: at(0), updated_at: at(min) });
  eq(PG.expectedMs([r(1, 10), r(2, 30), r(3, 20), r(4, 999, 'failure')]), 20 * 60_000); eq(PG.expectedMs([]), null);
  const run = { id: 9, status: 'in_progress', run_started_at: at(0) };
  eq(PG.etaOf(run, [r(1, 20)], T0 + 5 * 60_000), 15 * 60_000); eq(PG.etaOf(run, [], T0), null); eq(PG.etaOf({ ...run, status: 'completed' }, [r(1, 20)], T0), null);
  eq(PG.etaOf(run, [r(1, 20)], T0 + 99 * 60_000), 0);
  eq([PG.etaWords(15 * 60_000), PG.etaWords(0), PG.etaWords(null)], ['あと約 15 分', 'まもなく終わります', '']);
});

// ---- a fake GitHub and a small DOM ----
async function fakeGitHub(init) {
  const st = { run: { ...init.run }, jobs: init.jobs, notes: init.notes ?? [], reruns: 0, seen: [] };
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === null ? '' : JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method, body = b ? JSON.parse(b) : null; st.seen.push(`${m} ${u}`);
      { const bad = fakeCheck(m, u, body); if (bad) return send(res, 422, { message: bad.message }); }
      if (u === `/repos/o/lab/actions/runs/${st.run.id}` && m === 'GET') { const out = { ...st.run }; st.onRead?.(st); return send(res, 200, out); }
      if (/^\/repos\/o\/lab\/actions\/workflows\/ai-make\.yml\/runs\?/.test(u)) return send(res, 200, { workflow_runs: init.history ?? [] });
      if (u.startsWith(`/repos/o/lab/actions/runs/${st.run.id}/jobs`)) return send(res, 200, { jobs: st.jobs.map((j) => ({ ...j, check_run_url: 'https://api.github.com/repos/o/lab/check-runs/55' })) });
      if (u.startsWith('/repos/o/lab/check-runs/55/annotations')) return send(res, 200, st.notes);
      if (u === `/repos/o/lab/actions/runs/${st.run.id}/rerun-failed-jobs` && m === 'POST') { st.reruns++; st.run.status = 'in_progress'; st.run.conclusion = null; return send(res, 201, null); }
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { st, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base: `http://127.0.0.1:${srv.address().port}` }) };
}
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { toast };
}
const fakeTimers = () => { const tm = { fns: new Map(), n: 0, cleared: 0, every: null }; tm.setInterval = (fn, ms) => { tm.every = ms; tm.fns.set(++tm.n, fn); return tm.n; }; tm.clearInterval = (id) => { tm.fns.delete(id); tm.cleared++; }; tm.tick = () => Promise.all([...tm.fns.values()].map((f) => f())); return tm; };
const RUNNING = { id: 77, status: 'in_progress', conclusion: null, run_started_at: at(0), html_url: 'https://github.com/o/lab/actions/runs/77', path: '.github/workflows/ai-make.yml' };
const HIST = [{ id: 5, status: 'completed', conclusion: 'success', run_started_at: at(0), updated_at: at(20) }];
const LAB = (o = {}) => ({ slug: 'o/lab', role: 'admin', ...o });

await t('the card: stages drawn, the time left, read every 15 s, stopped when the run is over, then the way to the release (github.com only)', async () => {
  fakeDom(); const UI = await imp('panel/ui/progress.mjs'), f = await fakeGitHub({ run: RUNNING, history: HIST, jobs: job([...PRE(), step('make', 'in_progress', null, 2)]) }), tm = fakeTimers();
  try {
    const c = UI.progressCard({ api: f.api, lab: LAB(), me: { login: 'o' }, timers: tm, now: () => T0 + 13 * 60_000 }, RUNNING); await settle();
    eq(c.all((e) => e.attrs['data-stage']).map((e) => e.attrs['data-state']), ['done', 'done', 'now', 'todo', 'todo']);
    ok(/あと約 7 分/.test(c.textContent) && /目安/.test(c.textContent), c.textContent);
    eq(tm.every, 15_000); eq(tm.fns.size, 1);
    f.st.run = { ...RUNNING, status: 'completed', conclusion: 'success', updated_at: at(21) };
    f.st.jobs = job([...PRE(), step('make', 'completed', 'success', 2, 20), step('Run actions/upload-artifact', 'completed', 'success', 20, 21)]);
    await tm.tick(); await settle();
    eq(tm.fns.size, 0, 'stopped'); ok(/できました/.test(c.textContent), c.textContent);
    const hrefs = c.all((e) => e.tagName === 'A').map((a) => a.attrs.href);
    ok(hrefs.includes('https://github.com/o/lab/releases') && hrefs.every((x) => x.startsWith('https://github.com/')), hrefs.join());
    ok(!c.textContent.includes('ghu_'), 'no token shown');
  } finally { f.close(); }
});
await t('a fall: the stage, GitHub\'s words, the next step; the retry goes through the guard; a role the policy does not allow is told why', async () => {
  fakeDom(); const UI = await imp('panel/ui/progress.mjs');
  const FELL = { ...RUNNING, status: 'completed', conclusion: 'failure', updated_at: at(12) };
  const jobs = job([...PRE(), step('make', 'completed', 'failure', 2, 12)]).map((j) => ({ ...j, conclusion: 'failure' }));
  const notes = [{ annotation_level: 'failure', message: 'playtest: server did not start' }, { annotation_level: 'notice', message: 'just a notice' }];
  let f = await fakeGitHub({ run: FELL, history: HIST, jobs, notes }), tm = fakeTimers();
  try {
    const calls = [];
    const guarded = async (action, detail, fn, done) => { calls.push([action, detail]); return (await fn()) ?? true; };
    const c = UI.progressCard({ api: f.api, lab: LAB(), timers: tm, guarded, now: () => T0 + 13 * 60_000 }, FELL); await settle();
    ok(/「本物のサーバーで遊ぶ」で止まりました/.test(c.textContent) && /server did not start/.test(c.textContent) && !/just a notice/.test(c.textContent) && /次の 1 手/.test(c.textContent), c.textContent);
    eq(tm.fns.size, 0, 'no polling for a run already over');
    const b = c.all((e) => e.tagName === 'BUTTON' && /やり直す/.test(e.textContent))[0]; ok(b && !b.disabled, 'retry offered');
    await b.click(); await settle();
    eq(calls, [['dispatch', { run: '77', workflow: 'ai-make.yml' }]]); eq(f.st.reruns, 1);
    eq(tm.fns.size, 1, 'reading again after the retry');
  } finally { f.close(); }
  f = await fakeGitHub({ run: FELL, history: HIST, jobs, notes }); tm = fakeTimers();
  try {
    const policy = P.parse ? { roles: { reader: ['audit.read'] } } : null;
    const c = UI.progressCard({ api: f.api, lab: LAB({ role: 'write' }), role: 'reader', policy, timers: tm }, FELL); await settle();
    const b = c.all((e) => e.tagName === 'BUTTON' && /やり直す/.test(e.textContent))[0];
    ok(b.disabled && /許していません/.test(c.textContent), c.textContent);
    await b.click(); eq(f.st.reruns, 0, 'nothing sent');
  } finally { f.close(); }
});
await t('GitHub cannot be read: the words and a way to try again, never an empty box', async () => {
  fakeDom(); const UI = await imp('panel/ui/progress.mjs'), f = await fakeGitHub({ run: RUNNING, jobs: [] }), tm = fakeTimers();
  const api = { ...f.api, call: async () => { throw new Error('GitHub につながりません'); } };
  try {
    const c = UI.progressCard({ api, lab: LAB(), timers: tm }, RUNNING); await settle();
    ok(/つながりません/.test(c.textContent) && c.all((e) => e.attrs.role === 'alert').length === 1, c.textContent);
  } finally { f.close(); }
});

await t('a jobs failure stays visible, and the same card recovers on the next read', async () => {
  fakeDom(); const UI = await imp('panel/ui/progress.mjs'), tm = fakeTimers();
  let broken = true;
  const api = { call: async () => RUNNING, runs: async () => [], jobs: async () => { if (broken) throw new Error('jobs offline'); return []; } };
  const c = UI.progressCard({ api, lab: LAB(), timers: tm }, RUNNING); await settle();
  ok(c.textContent.includes('jobs offline') && c.all((e) => e.attrs.role === 'alert').length === 1, c.textContent);
  broken = false; await tm.tick();
  ok(!c.textContent.includes('jobs offline'), 'the next successful read clears the error'); c.stop();
});
await t('a stopped card never restarts its poller after an in-flight read completes', async () => {
  fakeDom(); const UI = await imp('panel/ui/progress.mjs'), tm = fakeTimers();
  let finish, reads = 0;
  const api = { call: () => { reads++; return new Promise((r) => { finish = r; }); }, runs: async () => [], jobs: async () => [] };
  const c = UI.progressCard({ api, lab: LAB(), timers: tm }, RUNNING);
  c.stop(); finish(RUNNING); await settle();
  eq(tm.fns.size, 0, 'no timer resurrected'); eq(reads, 1); eq(c.all((e) => e.attrs['data-stage']).length, 0, 'no late draw');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
