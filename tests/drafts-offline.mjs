// the editor's 「下書き」 without a browser or a network: the pure store (key, size, age, secrets, the one-second gathering), and
// editorView on a small fake DOM and a fake GitHub (its writes through ghrules' fakeCheck): a draft offered when the file is
// opened again, 戻す / 捨てる, a changed GitHub noticed, saved → the draft gone.
// node tests/drafts-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const D = await imp('panel/lib/drafts.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
const K = D.draftKey({ account: 'o', slug: 'o/lab', unit: 'ruby', path: 'src/main.ts' });
const DAY = 24 * 3600 * 1000;

await t('key: account, lab, unit and path; any one missing gives none', () => {
  ok(K && K.startsWith(D.PREFIX), K);
  eq(D.draftKey({ account: 'o', slug: 'o/lab', unit: 'ruby' }), null);
  ok(K !== D.draftKey({ account: 'p', slug: 'o/lab', unit: 'ruby', path: 'src/main.ts' }), 'another account, another draft');
});
await t('save / load / drop / list; 1 MB at most; 30 days; secrets and secret-like files never kept', () => {
  const s = memStore();
  eq(D.saveDraft(s, K, { text: 'hello', baseSha: 'a1', path: 'src/main.ts', now: 1000 }), { ok: true });
  eq(D.loadDraft(s, K, 2000), { text: 'hello', baseSha: 'a1', at: 1000 });
  eq(D.listDrafts(s, 2000).map((x) => [x.account, x.slug, x.unit, x.path, x.bytes]), [['o', 'o/lab', 'ruby', 'src/main.ts', 5]]);
  eq(D.loadDraft(s, K, 1000 + 30 * DAY + 1), null); eq(s.length, 0, 'the old one forgotten');
  D.saveDraft(s, K, { text: 'x', path: 'src/main.ts' }); D.dropDraft(s, K); eq(s.length, 0);
  ok(!D.saveDraft(s, K, { text: 'a'.repeat(1_000_001), path: 'src/main.ts' }).ok, 'over 1 MB');
  ok(D.saveDraft(s, K, { text: 'a'.repeat(1_000_000), path: 'src/main.ts' }).ok, 'exactly 1 MB');
  for (const p of ['.env', 'bds/.env.local', 'x/server.pem', 'secrets.json', 'api_token.txt']) ok(!D.saveDraft(s, K, { text: 'a', path: p }).ok && D.isSecretPath(p), p);
  ok(!D.isSecretPath('src/main.ts') && !D.isSecretPath('tests.txt'), 'plain files are kept');
  const bad = D.saveDraft(s, K, { text: `const t = "ghp_${'a'.repeat(36)}"`, path: 'src/main.ts' });
  ok(!bad.ok && !bad.why.includes('ghp_'), bad.why);
  ok(!D.saveDraft(null, K, { text: 'a' }).ok && !D.saveDraft(s, null, { text: 'a' }).ok, 'no store / no key: said, not thrown');
  s.m.set(K, '{broken'); eq(D.loadDraft(s, K), null); eq(s.length, 0, 'a broken one dropped');
  const full = { ...memStore(), setItem() { throw new Error('quota'); } };
  ok(!D.saveDraft(full, K, { text: 'a', path: 'f' }).ok, 'full storage said');
});
await t('words and the stale check', () => {
  eq([D.ago(0, 10_000), D.ago(0, 180_000), D.ago(0, 2 * 3600_000), D.ago(0, 5 * DAY)], ['たった今', '3 分前', '2 時間前', '5 日前']);
  ok(D.staleDraft({ baseSha: 'a' }, 'b') && !D.staleDraft({ baseSha: 'a' }, 'a') && !D.staleDraft({ baseSha: null }, 'b'));
});
await t('the saver gathers keystrokes into one save a second, and flush saves at once', () => {
  const s = memStore(), q = []; let n = 0;
  const sv = D.draftSaver(s, { timers: { set: (f) => { q.push(f); return ++n; }, clear: (id) => { q[id - 1] = null; } } });
  sv.push(K, { text: 'a', path: 'f' }); sv.push(K, { text: 'ab', path: 'f' }); sv.push(K, { text: 'abc', path: 'f' });
  eq(s.length, 0, 'nothing yet'); ok(sv.waiting);
  q.filter(Boolean).forEach((f) => f());
  eq(JSON.parse(s.getItem(K)).text, 'abc'); ok(!sv.waiting);
  sv.push(K, { text: 'abcd', path: 'f' }); sv.flush(); eq(JSON.parse(s.getItem(K)).text, 'abcd');
  sv.push(K, { text: 'zz', path: 'f' }); sv.cancel(); sv.flush(); eq(JSON.parse(s.getItem(K)).text, 'abcd', 'cancelled');
});

// ---- the editor on a small DOM and a fake GitHub ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
function fakeApi(files) {
  const st = { files: { ...files }, puts: [], writes: 0 };
  const call = async (method, p, body) => {
    const m = /^\/repos\/o\/lab\/contents\/(.+)$/.exec(p); if (!m) throw new G.GhError(404, 'Not Found', p);
    const f = decodeURIComponent(m[1]);
    if (method === 'GET') { if (!st.files[f]) throw new G.GhError(404, 'Not Found', p); return { type: 'file', encoding: 'base64', content: b64(st.files[f].text), sha: st.files[f].sha }; }
    const bad = fakeCheck(method, p, body); if (bad) throw new G.GhError(422, bad.message, p);
    if (st.files[f] && body.sha !== st.files[f].sha) throw new G.GhError(409, `${f} does not match ${body.sha}`, p);
    st.writes++; const sha = `sha${st.writes}`; st.files[f] = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha }; st.puts.push(f);
    return { content: { sha }, commit: { html_url: 'https://github.com/o/lab/commit/x' } };
  };
  return { st, api: { call, putFile: (r, p, text, sha, message) => call('PUT', `/repos/${r}/contents/${p}`, { message, content: b64(text), ...(sha ? { sha } : {}) }) } };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const ctxOf = (api, store, over = {}) => ({ api, lab: { slug: 'o/lab', role: 'admin', repo: { default_branch: 'main' }, workflows: [] }, me: { login: 'o' }, role: 'admin', guarded: async (a, d, fn, done) => fn(), draftStore: store, draftWait: 5, ...over });
const btn = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];
const byId = (c, id) => c.all((e) => e.attrs.id === id)[0];
const KEY = (f = 'src/main.ts') => D.draftKey({ account: 'o', slug: 'o/lab', unit: 'ruby', path: f });

await t('typing keeps a draft; opening the file again offers it: 戻す puts it back, 捨てる drops it; saving removes it', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1\n', sha: 's1' } });
  const ed = UI.editorView(ctxOf(f.api, store), 'ruby'); await settle();
  const ta = byId(ed, 'edit-text'); eq(ta.value, 'v1\n');
  ok(!byId(ed, 'edit-draft').textContent, 'no draft at first');
  ta.value = 'v1 and more\n'; await ta.fire('input'); eq(store.length, 0, 'not at every key');
  await settle(); eq(D.loadDraft(store, KEY()).text, 'v1 and more\n');
  // the tab closed, the file opened anew
  const ed2 = UI.editorView(ctxOf(f.api, store), 'ruby'); await settle();
  const box = byId(ed2, 'edit-draft'); ok(/下書きがあります（たった今）/.test(box.textContent), box.textContent);
  ok(!/GitHub の中身が変わって/.test(box.textContent), 'GitHub unchanged: not said');
  eq(byId(ed2, 'edit-text').value, 'v1\n', 'GitHub\'s text until chosen');
  await btn(box, /戻す/).fire('click'); eq(byId(ed2, 'edit-text').value, 'v1 and more\n');
  const ed3 = UI.editorView(ctxOf(f.api, store), 'ruby'); await settle();
  await btn(byId(ed3, 'edit-draft'), /捨てる/).fire('click'); eq(store.length, 0); eq(byId(ed3, 'edit-text').value, 'v1\n');
  // typed again, then saved: the draft gone
  const ta3 = byId(ed3, 'edit-text'); ta3.value = 'v2\n'; await ta3.fire('input'); await settle(); eq(store.length, 1);
  await btn(ed3, /^保存$/).fire('click'); await settle();
  eq(f.st.files['bds/addons/ruby/src/main.ts'].text, 'v2\n'); eq(store.length, 0, 'saved: no draft left');
  ok(!(await btn(ed3, /^保存$/)).disabled);
});
await t('typing back to the original leaves no draft; a changed GitHub is told; leaving a file keeps its draft', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1\n', sha: 's1' }, 'bds/addons/ruby/tests.txt': { text: 't\n', sha: 't1' } });
  const ed = UI.editorView(ctxOf(f.api, store), 'ruby'); await settle();
  const ta = byId(ed, 'edit-text'); ta.value = 'x'; await ta.fire('input'); ta.value = 'v1\n'; await ta.fire('input'); await settle();
  eq(store.length, 0, 'same as GitHub: nothing kept');
  ta.value = 'draft text\n'; await ta.fire('input'); await settle();
  f.st.files['bds/addons/ruby/src/main.ts'] = { text: 'changed on github\n', sha: 's2' };
  const ed2 = UI.editorView(ctxOf(f.api, store), 'ruby'); await settle();
  const box = byId(ed2, 'edit-draft'); ok(/下書きがあります/.test(box.textContent) && /GitHub の中身が変わっています/.test(box.textContent), box.textContent);
  // another file chosen: the one being typed is kept first
  const ta2 = byId(ed2, 'edit-text'); ta2.value = 'more\n'; await ta2.fire('input');
  const pick = byId(ed2, 'edit-file'); pick.value = 'tests.txt'; await pick.fire('change'); await settle();
  eq(D.loadDraft(store, KEY()).text, 'more\n', 'kept at once when leaving the file');
  eq(byId(ed2, 'edit-text').value, 't\n');
});
await t('a storage that cannot keep it is said, not thrown; no storage at all still edits', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/workspace.mjs'), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1\n', sha: 's1' } });
  const full = { ...memStore(), setItem() { throw new Error('quota'); } };
  const ed = UI.editorView(ctxOf(f.api, full), 'ruby'); await settle();
  const ta = byId(ed, 'edit-text'); ta.value = 'v9\n'; await ta.fire('input'); await settle();
  ok(/下書きは残せませんでした/.test(byId(ed, 'edit-draft').textContent), byId(ed, 'edit-draft').textContent);
  const ed2 = UI.editorView(ctxOf(f.api, null), 'ruby'); await settle();
  const ta2 = byId(ed2, 'edit-text'); ta2.value = 'v9\n'; await ta2.fire('input'); await settle();
  await btn(ed2, /^保存$/).fire('click'); await settle();
  eq(f.st.files['bds/addons/ruby/src/main.ts'].text, 'v9\n');
});

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
