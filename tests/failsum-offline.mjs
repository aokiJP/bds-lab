// the failed-run summary without a browser or a network: summarize (pure) for the common failures — a secret not there, the BDS
// not fetched, a test's expectation not met, out of time, stopped, a workflow that could not start — and diagnose's fix used
// as the next step; then the card on a small fake DOM against a fake GitHub on node:http (through ghrules' fakeCheck): three
// lines for a failed run, nothing written, a passed run said so, a failing GitHub shown with failView and a way to read again.
// node tests/failsum-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const FS = await imp('panel/lib/failsum.mjs'), G = await imp('panel/lib/gh.mjs'), GD = await imp('panel/lib/guide.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const run = (conclusion, more = {}) => ({ id: 7, status: 'completed', conclusion, html_url: 'https://github.com/o/lab/actions/runs/7', ...more });
const job = (name, conclusion, steps, id = 70) => ({ id, name, conclusion, check_run_url: `https://api.github.com/repos/o/lab/check-runs/${id}`, steps: steps.map(([n, c], i) => ({ number: i + 1, name: n, conclusion: c })) });
const an = (message, level = 'failure', title = '') => ({ annotation_level: level, title, message });

await t('summarize: a missing secret → where (job, step number, step name), why with the name, the next step to 「秘密」', () => {
  const s = FS.summarize({ run: run('failure'), jobs: [job('notify', 'failure', [['Set up job', 'success'], ['Send', 'failure'], ['Post', 'skipped']])], annotations: [an('DISCORD_BOT_TOKEN is not set'), an('note', 'notice')] });
  eq(s.cause, 'secret');
  eq(s.where, 'ジョブ「notify」の 2 段目「Send」で落ちました');
  ok(/DISCORD_BOT_TOKEN/.test(s.why) && /登録されていない/.test(s.why), s.why);
  ok(/「秘密」で DISCORD_BOT_TOKEN を登録/.test(s.next), s.next);
  eq(s.lines.length, 3); ok(s.lines[0].startsWith('📍 どこで: ') && s.lines[1].startsWith('❓ なぜ: ') && s.lines[2].startsWith('👉 次の 1 手: '), s.lines.join('|'));
  // (an ERROR in capitals is not a secret's name)
  ok(FS.summarize({ run: run('failure'), jobs: [job('x', 'failure', [['Build', 'failure']])], annotations: [an('ERROR: something missing')] }).cause !== 'secret', 'ERROR is no secret');
  eq(FS.summarize({ run: run('failure'), jobs: [], annotations: [an('Input required and not supplied: token')] }).cause, 'secret');
});

await t('summarize: the BDS not fetched (by the words or by the failed step\'s name) comes before the test it stopped', () => {
  eq(FS.summarize({ run: run('failure'), jobs: [job('test', 'failure', [['Fetch BDS', 'failure'], ['Run tests', 'skipped']])] }).cause, 'bds');
  const s = FS.summarize({ run: run('failure'), jobs: [job('go', 'failure', [['go', 'failure']])], annotations: [an('GET https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.21.zip 404')] });
  eq(s.cause, 'bds'); ok(/BDS/.test(s.why) && /upkeep/.test(s.next), s.next);
});

await t('summarize: a test\'s expectation not met; out of time (run, job or words); stopped; a workflow that could not start', () => {
  const s = FS.summarize({ run: run('failure'), jobs: [job('test', 'failure', [['Checkout', 'success'], ['node lab.mjs go', 'failure']])], annotations: [an('FAIL ## ruby: expected "= gave 3" got "gave 2"')] });
  eq(s.cause, 'test'); ok(/期待/.test(s.why) && /ゆるめて通すのはだめ/.test(s.next), s.next);
  eq(FS.summarize({ run: run('failure'), jobs: [job('t', 'failure', [['Run tests', 'failure']])] }).cause, 'test', 'by the step name');
  const to = FS.summarize({ run: run('timed_out'), jobs: [job('make', 'timed_out', [['make', 'cancelled']])] });
  eq(to.cause, 'timeout'); eq(to.where, 'ジョブ「make」の 1 段目「make」で時間切れになりました');
  eq(FS.summarize({ run: run('failure'), jobs: [job('a', 'failure', [['b', 'failure']])], annotations: [an('The job running on runner X has exceeded the maximum execution time of 360 minutes.')] }).cause, 'timeout');
  const c = FS.summarize({ run: run('cancelled'), jobs: [job('a', 'cancelled', [['b', 'success'], ['c', 'cancelled']])] });
  eq(c.cause, 'cancelled'); ok(/止まりました/.test(c.where) && /こわれたのではありません/.test(c.next), c.where);
  const st = FS.summarize({ run: run('startup_failure'), jobs: [] });
  eq(st.cause, 'startup'); ok(/始まる前/.test(st.where), st.where);
});

await t('summarize: nothing known → GitHub\'s own words (failure first, trimmed) and the failed step to open; no words → said so', () => {
  const long = 'x'.repeat(400);
  const s = FS.summarize({ run: run('failure'), jobs: [job('a', 'failure', [['Pack', 'failure']])], annotations: [an('just a warning', 'warning'), an(`odd thing ${long}`)] });
  eq(s.cause, null); ok(s.why.startsWith('GitHub の言葉: odd thing') && s.why.length < 200, s.why);
  ok(/「Pack」/.test(s.next), s.next);
  const n = FS.summarize({ run: run('failure'), jobs: [] });
  ok(/注釈/.test(n.why) && /見つかりません/.test(n.where), n.why);
});

await t('summarize: diagnose\'s first fix is the next step (one wording); runs not failed → null; failedAt picks failure before cancelled', () => {
  const jobs = [job('n', 'failure', [['Send', 'failure']])], annotations = [an('DISCORD_BOT_TOKEN is not set')];
  const diagnosis = GD.diagnose({ run: run('failure'), jobs, annotations, secrets: [], known: ['DISCORD_BOT_TOKEN'] });
  const s = FS.summarize({ run: run('failure'), jobs, annotations, diagnosis });
  eq(s.next, diagnosis[0].fix); eq(s.tab, 'secrets');
  // (diagnose's entry for the same cause, not just its first: the lines agree)
  const two = [{ title: 'ネットワークの一時的な失敗です', fix: 'net fix', tab: 'runs' }, { title: '時間切れです', fix: 'time fix', tab: 'start' }];
  const tt = FS.summarize({ run: run('timed_out'), jobs: [job('a', 'timed_out', [['b', 'cancelled']])], diagnosis: two });
  eq([tt.next, tt.tab], ['time fix', 'start']);
  eq(FS.summarize({ run: run('failure'), jobs: [job('a', 'failure', [['Pack', 'failure']])], diagnosis: two }).next, 'net fix', 'no same cause: the first');
  eq(FS.summarize({ run: run('success'), jobs }), null);
  eq(FS.summarize({ run: { status: 'in_progress', conclusion: null }, jobs }), null);
  eq(FS.summarize({ run: run('skipped') }), null);
  const at = FS.failedAt([job('a', 'cancelled', [['s', 'cancelled']], 1), job('b', 'failure', [['ok', 'success'], ['bad', 'failure']], 2)]);
  eq([at.job.name, at.step.name, at.index], ['b', 'bad', 1]);
  eq(FS.failedAt([job('a', 'success', [['s', 'success']])]).job, null);
  ok(FS.CAUSES.map((c) => c.id).join() === 'cancelled,timeout,secret,bds,test,startup', 'the table');
});

// ---- a fake GitHub ----
async function fakeGitHub(init = {}) {
  const st = { seen: [], writes: [] };
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method, body = b ? JSON.parse(b) : null;
      st.seen.push(`${m} ${u}`);
      { const bad = fakeCheck(m, u, body); if (bad) return send(res, 422, { message: bad.message }); }
      if (m !== 'GET') { st.writes.push(`${m} ${u}`); return send(res, 405, { message: 'no writes here' }); }
      if (init.down) return send(res, 500, { message: 'boom' });
      if (/^\/repos\/o\/lab\/actions\/runs\/7\/jobs/.test(u)) return send(res, 200, { total_count: 2, jobs: init.jobs ?? [job('setup', 'success', [['a', 'success']], 69), job('test', 'failure', [['Checkout', 'success'], ['Fetch BDS', 'failure']], 70)] });
      if (/^\/repos\/o\/lab\/check-runs\/70\/annotations/.test(u)) return init.noNotes ? send(res, 500, { message: 'x' }) : send(res, 200, [an('curl: (22) bedrock-server zip 404')]);
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { st, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base: `http://127.0.0.1:${srv.address().port}` }) };
}

// ---- a small DOM ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
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
  return { E, toast };
}
const tick = () => new Promise((r) => setTimeout(r, 40));
const btn = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];

await t('failsumCard: a failed run → three lines (where, why, next) from its jobs and annotations, a github.com link, 「写す」 copies them; only reads', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/failsum.mjs'), f = await fakeGitHub();
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (s) => { copied.push(s); } } }, configurable: true });
  try {
    const recs = [], guards = [];
    const c = UI.failsumCard({ api: f.api, lab: { slug: 'o/lab', secrets: [] }, record: (...a) => recs.push(a), guarded: (...a) => guards.push(a) }, run('failure'));
    await tick();
    const lines = c.all((e) => e.attrs['data-line']).map((e) => e.textContent);
    eq(lines.length, 3, c.textContent);
    ok(/ジョブ「test」の 2 段目「Fetch BDS」で落ちました/.test(lines[0]), lines[0]);
    ok(/BDS/.test(lines[1]) && /upkeep/.test(lines[2]), lines.join('|'));
    ok(c.all((e) => e.tagName === 'A' && e.attrs.href === 'https://github.com/o/lab/actions/runs/7').length === 1, 'the run on github.com');
    await btn(c, /写す/).click();
    eq(copied, [lines.join('\n')]); ok(/写しました/.test(toast.textContent), toast.textContent);
    eq(f.st.writes, []); eq(recs, [], 'a read is not recorded'); eq(guards, [], 'nothing guarded: nothing written');
    ok(f.st.seen.every((s) => !/\/logs/.test(s)), 'never a log');
  } finally { f.close(); }
});

await t('failsumCard: a missing secret → a button to 「秘密」 via ctx.go; a non-github link is not drawn; notes that fail to read leave the steps', async () => {
  fakeDom(); const UI = await imp('panel/ui/failsum.mjs');
  let f = await fakeGitHub({ jobs: [job('notify', 'failure', [['Send', 'failure']], 70)] });
  try {
    // (the annotations say a known secret is not there)
    f.api.annotations = async () => [an('DISCORD_BOT_TOKEN is not set')];
    const went = [];
    const c = UI.failsumCard({ api: f.api, lab: { slug: 'o/lab', secrets: [] }, go: (tab) => went.push(tab) }, run('failure', { html_url: 'https://evil.example/x' }));
    await tick();
    ok(/DISCORD_BOT_TOKEN/.test(c.textContent), c.textContent);
    await btn(c, /「秘密」を開く/).click(); eq(went, ['secrets']);
    eq(c.all((e) => e.tagName === 'A').length, 0, 'no link out of github.com');
  } finally { f.close(); }
  f = await fakeGitHub({ noNotes: true }); fakeDom();
  try { const c = UI.failsumCard({ api: f.api, lab: { slug: 'o/lab' } }, run('failure')); await tick(); ok(/Fetch BDS/.test(c.textContent) && c.all((e) => e.attrs['data-line']).length === 3, c.textContent); } finally { f.close(); }
});

await t('failsumCard: a passed run and one still going say so; a failing GitHub shows the words (failView) and 「読み直す」 that reads again', async () => {
  fakeDom(); const UI = await imp('panel/ui/failsum.mjs');
  let f = await fakeGitHub({ jobs: [job('a', 'success', [['a', 'success']])] });
  try {
    const c = UI.failsumCard({ api: f.api, lab: { slug: 'o/lab' } }, run('success')); await tick(); ok(/落ちていません/.test(c.textContent), c.textContent);
    const g = UI.failsumCard({ api: f.api, lab: { slug: 'o/lab' } }, { id: 7, status: 'in_progress', conclusion: null }); await tick(); ok(/まだ動いています/.test(g.textContent), g.textContent);
  } finally { f.close(); }
  f = await fakeGitHub({ down: true }); fakeDom();
  try {
    const c = UI.failsumCard({ api: f.api, lab: { slug: 'o/lab' } }, run('failure')); await tick();
    ok(c.all((e) => e.attrs.role === 'alert').length === 1, c.textContent);
    const n = f.st.seen.length; await btn(c, /読み直す/).click(); await tick(); ok(f.st.seen.length > n, 'read again');
  } finally { f.close(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
