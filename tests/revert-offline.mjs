// the file-revert parts without a browser or a network: the history, a version's text, the line difference (pure), the restore
// as a new commit (a fake GitHub on node:http, through ghrules' fakeCheck; the same text as now writes nothing) and the card on
// a small fake DOM (pick a version → the difference → 「この版に戻す」 through ctx.guarded; empty and failing states).
// node tests/revert-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const R = await imp('panel/lib/revert.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const S1 = 'a'.repeat(40), S2 = 'b'.repeat(40), S3 = 'c'.repeat(40);
async function fakeGitHub(init = {}) {
  const st = { texts: { [S1]: 'one\ntwo\n', [S2]: 'one\ntwo\nthree\n', [S3]: 'one\nTWO\nthree\nfour\n' }, head: S3, puts: [], seen: [], commits: init.commits ?? [S3, S2, S1], missingAt: init.missingAt ?? null };
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === null ? '' : JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method, body = b ? JSON.parse(b) : null; let x;
      st.seen.push(`${m} ${u}`);
      { const bad = fakeCheck(m, u, body); if (bad) return send(res, 422, { message: bad.message }); }
      if (init.down) return send(res, 500, { message: 'boom' });
      if (m === 'GET' && (x = /^\/repos\/o\/lab\/commits\?per_page=\d+&path=([^&]+)/.exec(u))) {
        return send(res, 200, st.commits.map((s, i) => ({ sha: s, author: { login: 'o' }, commit: { author: { name: 'O', date: `2026-01-0${3 - i}T10:00:00Z` }, message: `edit ${s[0]}\n\nbody` } })));
      }
      if (m === 'GET' && (x = /^\/repos\/o\/lab\/contents\/([^?]+)(?:\?ref=(.+))?$/.exec(u))) {
        const ref = x[2] ?? st.head;
        if (ref === st.missingAt || !(ref in st.texts)) return send(res, 404, { message: 'Not Found' });
        return send(res, 200, { content: Buffer.from(st.texts[ref]).toString('base64'), sha: `blob-${ref.slice(0, 4)}` });
      }
      if (m === 'PUT' && /^\/repos\/o\/lab\/contents\//.test(u)) {
        if (body.sha !== `blob-${st.head.slice(0, 4)}`) return send(res, 409, { message: `${u} does not match ${body.sha}` });
        st.puts.push(body); const n = 'd'.repeat(40); st.texts[n] = Buffer.from(body.content, 'base64').toString(); st.head = n;
        return send(res, 200, { commit: { sha: n } });
      }
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { st, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base: `http://127.0.0.1:${srv.address().port}` }) };
}
const F = 'units/x/tests.txt';

await t('lineDiff: lines only in the new / only in the old, duplicates counted, empty and CRLF handled (pure)', () => {
  eq(R.lineDiff('a\nb\n', 'a\nb\nc\n'), { added: 1, removed: 0 });
  eq(R.lineDiff('a\nb\n', 'a\nB\n'), { added: 1, removed: 1 });
  eq(R.lineDiff('a\na\n', 'a\n'), { added: 0, removed: 1 });
  eq(R.lineDiff('', 'a\n'), { added: 1, removed: 0 });
  eq(R.lineDiff('a\r\nb\r\n', 'a\nb\n'), { added: 0, removed: 0 });
  eq(R.lineDiff(null, null), { added: 0, removed: 0 });
  eq(R.restoreMessage(F, S1), `${F} を aaaaaaa の版に戻す`);
});

await t('history and contentAt: one entry per commit (sha, date, author, first line of the message); the text at a commit; none when absent', async () => {
  const f = await fakeGitHub();
  try {
    const h = await R.history(f.api, 'o/lab', F);
    eq(h.map((c) => c.sha), [S3, S2, S1]); eq(h[0], { sha: S3, date: '2026-01-03T10:00:00Z', author: 'o', message: 'edit c' });
    eq(await R.contentAt(f.api, 'o/lab', F, S1), 'one\ntwo\n');
    f.st.missingAt = S2; eq(await R.contentAt(f.api, 'o/lab', F, S2), null);
    let e = null; try { await R.history(f.api, 'o/lab', ''); } catch (x) { e = x; } ok(e, 'a path is needed');
  } finally { f.close(); }
});

await t('restore: the earlier text written over the file as a new commit with the current sha and the message; the same text as now writes nothing; a missing version is refused', async () => {
  const f = await fakeGitHub();
  try {
    const r = await R.restore(f.api, 'o/lab', F, S1);
    eq([r.changed, r.added, r.removed], [true, 1, 3]);
    eq(f.st.puts.length, 1); eq(f.st.puts[0].message, `${F} を aaaaaaa の版に戻す`); eq(f.st.puts[0].sha, 'blob-cccc');
    eq(f.st.texts[f.st.head], 'one\ntwo\n');
    const again = await R.restore(f.api, 'o/lab', F, S1);
    eq(again.changed, false); eq(f.st.puts.length, 1, 'nothing written for the same text');
    f.st.missingAt = S2; let e = null; try { await R.restore(f.api, 'o/lab', F, S2); } catch (x) { e = x; }
    ok(e && /ありません/.test(e.message), e?.message); eq(f.st.puts.length, 1);
  } finally { f.close(); }
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

await t('revertCard: the history listed; choosing a version shows the line difference; 「この版に戻す」 goes through ctx.guarded and writes a new commit, then the list is read again', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/revert.mjs'), f = await fakeGitHub();
  try {
    const calls = [];
    const guarded = async (action, detail, fn, done) => { calls.push([action, detail]); try { const r = await fn(); if (done) toast.append(document.createTextNode(done)); return r; } catch (e) { toast.append(document.createTextNode(e.message)); return undefined; } };
    const recs = [];
    const c = UI.revertCard({ api: f.api, lab: { slug: 'o/lab', role: 'admin' }, guarded, record: (a, d) => recs.push([a, d]) }, { path: F });
    await tick();
    eq(c.all((e) => e.attrs['data-sha']).length, 3);
    await btn(c, /^aaaaaaa/).click(); await tick();
    ok(/1 行増え、3 行減ります/.test(c.textContent), c.textContent);
    await btn(c, /この版に戻す/).click(); await tick();
    eq(calls, [['contents', { file: F, sha: 'aaaaaaa' }]]); eq(f.st.puts.length, 1);
    ok(/戻しました/.test(c.textContent) && /新しい commit/.test(toast.textContent), c.textContent);
    eq(recs, [['revert', { file: F, sha: 'aaaaaaa', changed: true }]]);
  } finally { f.close(); }
});

await t('revertCard: a version equal to now cannot be pressed and says why; no history says how to fill it; a failing GitHub shows the words (failView) and a way to read again', async () => {
  const UI0 = await imp('panel/ui/revert.mjs');
  let f = await fakeGitHub(); fakeDom();
  try {
    f.st.texts[S3] = f.st.texts[S1]; // now equals S1
    const c = UI0.revertCard({ api: f.api, lab: { slug: 'o/lab' } }, { path: F });
    await tick(); await btn(c, /^aaaaaaa/).click(); await tick();
    const go = btn(c, /この版に戻す/); ok(go.disabled && /同じ中身/.test(c.textContent), 'disabled with a reason');
    await go.click(); eq(f.st.puts.length, 0);
  } finally { f.close(); }
  f = await fakeGitHub({ commits: [] }); fakeDom();
  try { const c = UI0.revertCard({ api: f.api, lab: { slug: 'o/lab' } }, { path: F }); await tick(); ok(/履歴はまだありません/.test(c.textContent), c.textContent); } finally { f.close(); }
  f = await fakeGitHub({ down: true }); fakeDom();
  try { const c = UI0.revertCard({ api: f.api, lab: { slug: 'o/lab' } }, { path: F }); await tick(); ok(c.all((e) => e.attrs.role === 'alert').length === 1 && btn(c, /読み直す/), c.textContent); } finally { f.close(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
