// the failed-run Issue without a browser or a network: the text (pure, secrets hidden), finding the run's Issue among the labelled
// ones, making it once (a fake GitHub on node:http through ghrules' fakeCheck) and the card (guarded 'issues', a link, no second Issue).
// node tests/runissue-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const R = await imp('panel/lib/runissue.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const TOKEN = 'ghp_' + 'a'.repeat(36);
const RUN = { id: 77, run_number: 5, name: 'unit', display_title: 'test unit', conclusion: 'failure', head_branch: 'main', head_sha: 'abcdef1234567', html_url: 'https://github.com/o/lab/actions/runs/77' };
const JOBS = [{ id: 1, name: 'build', conclusion: 'success', steps: [] }, { id: 2, name: 'test', conclusion: 'failure', html_url: 'https://github.com/o/lab/actions/runs/77/job/2', steps: [{ name: 'go', conclusion: 'failure' }, { name: 'setup', conclusion: 'success' }] }];
const NOTES = [{ annotation_level: 'failure', title: 'tests.txt', message: `boom ${TOKEN}`, path: 'units/x/tests.txt', start_line: 3 }];

async function fakeGitHub(init = {}) {
  const st = { issues: init.issues ?? [], posts: [], seen: [] };
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method, body = b ? JSON.parse(b) : null;
      st.seen.push(`${m} ${u}`);
      { const x = fakeCheck(m, u, body); if (x) return send(res, 422, { message: x.message }); }
      if (init.down) return send(res, 500, { message: 'boom' });
      if (m === 'GET' && /^\/repos\/o\/lab\/issues\?/.test(u)) return send(res, 200, st.issues);
      if (m === 'GET' && /\/actions\/runs\/77\/jobs/.test(u)) return send(res, 200, { jobs: JOBS });
      if (m === 'GET' && /\/check-runs\/2\/annotations/.test(u)) return send(res, 200, NOTES);
      if (m === 'POST' && u === '/repos/o/lab/issues') { st.posts.push(body); const n = 100 + st.posts.length; st.issues.push({ number: n, state: 'open', body: body.body, html_url: `https://github.com/o/lab/issues/${n}` }); return send(res, 201, { number: n, html_url: `https://github.com/o/lab/issues/${n}` }); }
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { st, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base: `http://127.0.0.1:${srv.address().port}` }) };
}

await t('issueBody: marker, summary, failed job and step, annotation, run link; a secret is hidden; labels; fits the issue rules', () => {
  const x = R.issueBody(RUN, JOBS, NOTES);
  ok(x.body.includes('<!-- bds-lab-run:77 -->') && x.body.includes(RUN.html_url), x.body);
  ok(/test（失敗）: 失敗した step go/.test(x.body) && !/build/.test(x.body), x.body);
  ok(/units\/x\/tests.txt:3/.test(x.body) && /boom/.test(x.body), x.body);
  ok(!x.body.includes(TOKEN) && /伏せました/.test(x.body), 'secret hidden');
  eq(x.labels, ['bds-lab-run']); ok(x.title.length > 0 && x.title.length <= 120, x.title);
  eq(fakeCheck('POST', '/repos/o/lab/issues', x), null);
  const e = R.issueBody({ id: 1, conclusion: 'failure' }, [], []);
  ok(/見つかりませんでした/.test(e.body) && /注釈はありません/.test(e.body), e.body);
  ok(R.issueBody(RUN, [], Array.from({ length: 25 }, () => ({ message: 'm' }))).body.includes('ほか 5 件'));
  const at = R.issueBody({ ...RUN, display_title: 'fix for @alice and @org/team' }, [], [{ message: 'ping @bob' }]);
  ok(!/@[\w-]/.test(at.body) && !/@[\w-]/.test(at.title) && at.title.includes('@\u200balice') && at.body.includes('@\u200bbob'), 'no one is called by an @ in a title or a note');
});

await t('findIssue: found by its marker among the labelled issues (a pull request is skipped); none gives null', async () => {
  const f = await fakeGitHub({ issues: [{ number: 3, state: 'closed', body: R.marker(5), html_url: 'u3' }, { number: 4, state: 'open', body: R.marker(77), html_url: 'u4', pull_request: {} }, { number: 9, state: 'closed', body: `x ${R.marker(77)}`, html_url: 'u9' }] });
  try {
    eq(await R.findIssue(f.api, 'o/lab', 77), { number: 9, html_url: 'u9', state: 'closed' });
    eq(await R.findIssue(f.api, 'o/lab', 8), null);
    ok(f.st.seen.every((s) => /labels=bds-lab-run/.test(s) && !/search/.test(s)), f.st.seen.join());
  } finally { f.close(); }
});

await t('openOrCreate: makes one Issue; the second time opens the same; a run that did not fail is refused; a failing GitHub throws', async () => {
  const f = await fakeGitHub();
  try {
    const a = await R.openOrCreate(f.api, 'o/lab', RUN);
    eq([a.existed, a.issue.number], [false, 101]); eq(f.st.posts.length, 1);
    ok(!f.st.posts[0].body.includes(TOKEN) && /boom/.test(f.st.posts[0].body), 'annotation read, secret hidden');
    const b = await R.openOrCreate(f.api, 'o/lab', RUN);
    eq([b.existed, b.issue.number], [true, 101]); eq(f.st.posts.length, 1, 'no second issue');
    let e = null; try { await R.openOrCreate(f.api, 'o/lab', { ...RUN, conclusion: 'success' }); } catch (x) { e = x; } ok(e && /落ちていない/.test(e.message), 'refused');
  } finally { f.close(); }
  const d = await fakeGitHub({ down: true });
  try { let e = null; try { await R.openOrCreate(d.api, 'o/lab', RUN); } catch (x) { e = x; } ok(e, 'throws'); } finally { d.close(); }
});

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
const tick = () => new Promise((r) => setTimeout(r, 30));
const btn = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];

await t('runIssueCard: one click goes through ctx.guarded("issues") (a policy action) and shows the link; the second click opens the same Issue', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/runissue.mjs'), f = await fakeGitHub();
  try {
    const calls = [];
    // (as the panel's: an action the policy does not know — or a writer may not do — is refused before anything is sent)
    const P = await imp('panel/lib/policy.mjs');
    const guarded = async (action, detail, fn, done) => { calls.push([action, detail]); ok(action === 'issues', 'action'); if (!P.can(P.DEFAULT_POLICY, 'write', action)) { toast.append(globalThis.document.createTextNode('許されていません')); return undefined; } try { const r = await fn(); if (done) toast.append(globalThis.document.createTextNode(done)); return r; } catch (e) { toast.append(globalThis.document.createTextNode(e.message)); return undefined; } };
    const c = UI.runIssueCard({ api: f.api, lab: { slug: 'o/lab' }, guarded }, RUN);
    await btn(c, /失敗から Issue/).click(); await tick();
    eq(calls, [['issues', { run: 77 }]]); ok(/作りました/.test(c.textContent) && c.all((e) => e.attrs.href === 'https://github.com/o/lab/issues/101').length === 1, c.textContent);
    await btn(c, /失敗から Issue/).click(); await tick();
    ok(/もうあります/.test(c.textContent), c.textContent); eq(f.st.posts.length, 1);
    eq(calls.length, 1, 'the one already there is only read: not guarded, not in the audit log');
  } finally { f.close(); }
});

await t('runIssueCard: a run that passed cannot be pressed and says why; a failing GitHub shows the words in a toast', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/runissue.mjs');
  let f = await fakeGitHub();
  try { const c = UI.runIssueCard({ api: f.api, lab: { slug: 'o/lab' } }, { ...RUN, conclusion: 'success' }); const b = btn(c, /失敗から Issue/); ok(b.disabled && /落ちていない/.test(c.textContent), 'disabled with reason'); await b.click(); eq(f.st.seen.length, 0); } finally { f.close(); }
  f = await fakeGitHub({ down: true });
  try { const c = UI.runIssueCard({ api: f.api, lab: { slug: 'o/lab' } }, RUN); await btn(c, /失敗から Issue/).click(); await tick(); ok(toast.textContent.length > 0 && !/作りました/.test(c.textContent), 'toast'); } finally { f.close(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
