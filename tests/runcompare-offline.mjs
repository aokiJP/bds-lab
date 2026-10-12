// the management panel's 「実行の比較」 without a browser or a network: panel/lib/runcompare.mjs (jobs and steps side by side,
// what took longer in words and biggest first, the commits and what a run started from, the two runs to show first — with odd
// input) and panel/ui/runcompare.mjs (the card on a small stand-in DOM and a fake GitHub that only reads).
// node tests/runcompare-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const R = await imp('panel/lib/runcompare.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40);
const at = (min) => new Date(Date.UTC(2026, 9, 8, 0, 0, 0) + min * 60_000).toISOString();
const run = (id, conclusion, startMin, extra = {}) => ({ id, run_number: id, name: 'unit', status: 'completed', conclusion, head_branch: 'main', head_sha: id % 2 ? SHA_A : SHA_B, event: 'push', display_title: `t${id}`, actor: { login: 'neko' }, run_started_at: at(startMin), ...extra });
const step = (name, s, e, conclusion = 'success') => ({ name, conclusion, started_at: at(s), completed_at: at(e) });
const job = (name, s, e, conclusion = 'success', steps = []) => ({ name, status: 'completed', conclusion, started_at: at(s), completed_at: at(e), steps });

await t('time in words: seconds, minutes, hours; 「2 分 → 7 分（+5 分）」, faster, same, unknown (pure)', () => {
  eq([R.words(45_000), R.words(120_000), R.words(3_900_000), R.words(7_200_000), R.words(null), R.words(NaN)], ['45 秒', '2 分', '1 時間 5 分', '2 時間', '—', '—']);
  eq(R.diffText(120_000, 420_000), '2 分 → 7 分（+5 分）');
  eq(R.diffText(420_000, 120_000), '7 分 → 2 分（−5 分）');
  eq(R.diffText(60_000, 60_000), '1 分 → 1 分（同じ）');
  eq(R.diffText(null, 60_000), '— → 1 分');
});

await t('a job\'s or step\'s time: from start to end; none when skipped, unfinished or backwards (pure)', () => {
  eq(R.spanMs(job('x', 0, 3)), 180_000);
  eq([R.spanMs(null), R.spanMs({}), R.spanMs({ ...job('x', 0, 3), conclusion: 'skipped' }), R.spanMs({ started_at: at(5), completed_at: at(1) }), R.spanMs({ started_at: 'x', completed_at: 'y' })], [null, null, null, null, null]);
});

await t('the link to GitHub\'s comparison: only for two different commits and a real owner/name (pure)', () => {
  eq(R.compareUrl('o/lab', SHA_A, SHA_B), `https://github.com/o/lab/compare/${SHA_A}...${SHA_B}`);
  eq([R.compareUrl('o/lab', SHA_A, SHA_A), R.compareUrl('o/lab', null, SHA_B), R.compareUrl('', SHA_A, SHA_B), R.compareUrl('o/lab/x', SHA_A, SHA_B), R.compareUrl('o/lab', 'zz', SHA_B)], [null, null, null, null, null]);
});

await t('which two to show first: the last one that passed and the newest; none passed, one run, odd input (pure)', () => {
  const rs = [run(1, 'success', 0), run(2, 'failure', 10), run(3, 'success', 20), run(4, 'failure', 30)];
  const d = R.defaults(rs);
  eq([d.a.id, d.b.id], [3, 4]);
  eq(R.defaults([run(5, 'success', 40), ...rs]).a.id, 3, 'the newest passed: the one before it that passed');
  eq([R.defaults([run(1, 'failure', 0), run(2, 'failure', 5)]).a, R.defaults([run(1, 'failure', 0)]).a, R.defaults([]).b, R.defaults(null).b], [null, null, null, null]);
  eq(R.defaults([null, 3, run(7, 'success', 0), run(8, 'failure', 1)]).a.id, 7);
});

await t('two runs compared: jobs side by side, steps that differ, slower biggest first, jobs only one has, commits and inputs (pure)', () => {
  const a = run(1, 'success', 0), b = run(2, 'failure', 60, { head_branch: 'fix', actor: { login: 'inu' } });
  const ja = [job('build', 0, 2, 'success', [step('setup', 0, 1), step('test', 1, 2)]), job('lint', 0, 1), job('old', 0, 1)];
  const jb = [job('build', 60, 67, 'failure', [step('setup', 60, 61), step('test', 61, 67, 'failure')]), job('lint', 60, 61), job('new', 60, 62)];
  const c = R.compareRuns(a, ja, b, jb, { slug: 'o/lab' });
  eq(c.jobs.map((j) => [j.name, j.changed]), [['build', true], ['lint', false], ['old', true], ['new', true]]);
  eq(c.jobs[0].a, { conclusion: 'success', ms: 120_000 });
  eq(c.jobs[0].b, { conclusion: 'failure', ms: 420_000 });
  eq(c.jobs[0].steps.map((s) => [s.name, s.changed]), [['setup', false], ['test', true]]);
  eq(c.jobs[2].b, null);
  eq(c.jobs[3].a, null);
  eq(c.slower.map((s) => [s.name, s.step, s.deltaMs]), [['build', null, 300_000], ['build', 'test', 300_000]]);
  eq(c.slower[0].text, '2 分 → 7 分（+5 分）');
  eq(c.commits, { a: SHA_A, b: SHA_B, same: false, url: `https://github.com/o/lab/compare/${SHA_A}...${SHA_B}` });
  eq(c.inputs.filter((i) => i.changed).map((i) => [i.key, i.a, i.b]), [['branch', 'main', 'fix'], ['title', 't1', 't2'], ['actor', 'neko', 'inu']]);
  // (the order is the biggest first: a third, smaller slowdown comes after)
  const d = R.compareRuns(a, [job('x', 0, 1), job('y', 0, 1)], b, [job('x', 0, 2), job('y', 0, 9)]);
  eq(d.slower.map((s) => s.name), ['y', 'x']);
  eq(d.slower.map((s) => s.deltaMs), [480_000, 60_000]);
});

await t('faster or under a second slower is not "slower"; the same commit says so; odd input does not throw (pure)', () => {
  const a = run(1, 'success', 0), b = run(3, 'success', 5);
  const c = R.compareRuns(a, [job('x', 0, 5)], b, [job('x', 0, 2)]);
  eq(c.slower, []);
  eq(c.commits.same, true);
  eq(c.commits.url, null);
  const e = R.compareRuns(null, null, undefined, [null, 5, {}]);
  eq([e.jobs.length, e.slower, e.commits.a, e.inputs.every((i) => !i.changed)], [0, [], null, true]);
  const u = R.compareRuns(a, [{ name: 'x', conclusion: 'success' }], b, [{ name: 'x', conclusion: 'success' }]);
  eq([u.jobs[0].a.ms, u.jobs[0].changed, u.slower], [null, false, []], 'no times: nothing slower');
});

// ---- the card: a small DOM and a fake GitHub that only reads ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    change(v) { this.value = v; return Promise.all((this.on.change ?? []).map((fn) => fn({ target: this }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: () => null, body: new E('body') };
}
function fakeGitHub(jobsByRun, { fail = 0 } = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url), m = init.method;
    seen.push(`${m} ${u.pathname}`);
    const reply = (code, j) => ({ status: code, ok: code < 400, headers: { get: () => null }, text: async () => JSON.stringify(j) });
    if (fakeCheck(m, u.pathname + u.search, init.body ? JSON.parse(init.body) : null)) return reply(422, { message: 'rules' });
    if (fail) return reply(fail, { message: 'Server Error' });
    const x = /^\/repos\/o\/lab\/actions\/runs\/(\d+)\/jobs$/.exec(u.pathname);
    return x && jobsByRun[x[1]] ? reply(200, { jobs: jobsByRun[x[1]] }) : reply(404, { message: 'Not Found' });
  };
  return { seen, api: G.gh({ token: 'ghu_usertoken0123456789', fetchImpl }) };
}
const LAB = { slug: 'o/lab', role: 'write' };
const RUNS = [run(1, 'success', 0), run(3, 'success', 30), run(4, 'failure', 60, { head_branch: 'fix' })];
const JOBS = { 3: [job('build', 30, 32, 'success', [step('test', 30, 32)])], 4: [job('build', 60, 67, 'failure', [step('test', 60, 67, 'failure')])], 1: [job('build', 0, 1)] };

await t('the card: first the last pass and the newest, jobs read for those two only (nothing written), the table, 「2 分 → 7 分（+5 分）」, the GitHub link', async () => {
  fakeDom(); const UI = await imp('panel/ui/runcompare.mjs'), f = fakeGitHub(JOBS);
  const el = UI.runCompareCard({ api: f.api, lab: LAB }, { runs: RUNS });
  await el.loaded;
  eq(f.seen.sort(), ['GET /repos/o/lab/actions/runs/3/jobs', 'GET /repos/o/lab/actions/runs/4/jobs']);
  ok(f.seen.every((s) => s.startsWith('GET ')), 'reads only');
  const tx = el.textContent;
  ok(/2 分 → 7 分（\+5 分）/.test(tx) && /build/.test(tx) && /test/.test(tx), tx);
  ok(/main → fix/.test(tx), 'the branch differs');
  eq(el.all((e) => e.attrs['data-job']).map((e) => [e.attrs['data-job'], e.attrs['data-changed']]), [['build', 'yes']]);
  eq(el.all((e) => e.attrs['data-step']).map((e) => e.attrs['data-step']), ['test']);
  const a = el.all((e) => e.tagName === 'A');
  eq(a.map((e) => e.attrs.href), [`https://github.com/o/lab/compare/${SHA_A}...${SHA_B}`]);
  eq(a[0].attrs.rel, 'noopener noreferrer');
  eq(el.all((e) => e.tagName === 'OPTION' && e.attrs.selected !== undefined).map((e) => e.value), ['3', '4']);
  ok(el.all((e) => 'style' in e.attrs).length === 0, 'no style attribute');
});

await t('choosing again: another pair is read (the jobs of a run read once), the same run twice says so and reads nothing; the link is only GitHub\'s', async () => {
  fakeDom(); const UI = await imp('panel/ui/runcompare.mjs'), f = fakeGitHub(JOBS);
  const el = UI.runCompareCard({ api: f.api, lab: LAB }, { runs: RUNS });
  await el.loaded;
  const [sa] = el.all((e) => e.tagName === 'SELECT'), go = el.all((e) => e.attrs.id === 'runcompare-go')[0];
  await sa.change('1'); await go.click();
  eq(f.seen.length, 3, 'run 1\'s jobs read, 3 and 4 not again');
  ok(/1 分/.test(el.textContent), el.textContent);
  await sa.change('4'); await go.click();
  ok(/同じ実行どうしは比べられません/.test(el.textContent), el.textContent);
  eq(f.seen.length, 3);
  ok(el.all((e) => e.tagName === 'A').length === 0, 'no link for nothing');
});

await t('the card: fewer than two runs says what to do; a failed read shows the failure, not an empty box', async () => {
  fakeDom(); const UI = await imp('panel/ui/runcompare.mjs');
  const one = UI.runCompareCard({ api: fakeGitHub({}).api, lab: LAB }, { runs: [RUNS[0]] });
  await one.loaded;
  ok(/2 つ以上/.test(one.textContent), one.textContent);
  eq(one.all((e) => e.tagName === 'BUTTON').length, 0);
  const none = UI.runCompareCard({ api: fakeGitHub({}).api, lab: LAB }, {});
  ok(/2 つ以上/.test(none.textContent), 'no runs given');
  const bad = UI.runCompareCard({ api: fakeGitHub(JOBS, { fail: 500 }).api, lab: LAB }, { runs: RUNS });
  await bad.loaded;
  eq(bad.all((e) => e.attrs.role === 'alert').length, 1);
  ok(!/ghu_/.test(bad.textContent), 'no token');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
