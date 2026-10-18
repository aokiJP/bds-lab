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
  for (const p of ['bp/items/token_coin.json', 'rp/textures/items/secret_door.png', 'bp/entities/password_parrot.json']) ok(!D.isSecretPath(p), `an addon's own file named so is kept: ${p}`);
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
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1\n', sha: 's1' } });
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
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1\n', sha: 's1' }, 'bds/addons/ruby/tests.txt': { text: 't\n', sha: 't1' } });
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
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1\n', sha: 's1' } });
  const full = { ...memStore(), setItem() { throw new Error('quota'); } };
  const ed = UI.editorView(ctxOf(f.api, full), 'ruby'); await settle();
  const ta = byId(ed, 'edit-text'); ta.value = 'v9\n'; await ta.fire('input'); await settle();
  ok(/下書きは残せませんでした/.test(byId(ed, 'edit-draft').textContent), byId(ed, 'edit-draft').textContent);
  const ed2 = UI.editorView(ctxOf(f.api, null), 'ruby'); await settle();
  const ta2 = byId(ed2, 'edit-text'); ta2.value = 'v9\n'; await ta2.fire('input'); await settle();
  await btn(ed2, /^保存$/).fire('click'); await settle();
  eq(f.st.files['bds/addons/ruby/src/main.ts'].text, 'v9\n');
});

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const fileReply = (text, sha) => ({ type: 'file', encoding: 'base64', content: b64(text), sha });
await t('A → B → A: an older read cannot replace the latest file', async () => {
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), store = memStore(), pending = [];
  const api = { call: async () => { const p = deferred(); pending.push(p); return p.promise; } };
  const ed = UI.editorView(ctxOf(api, store), 'ruby'), pick = byId(ed, 'edit-file');
  pick.value = 'tests.txt'; const b = pick.fire('change');
  pick.value = 'src/main.ts'; const a = pick.fire('change');
  pending[2].resolve(fileReply('latest', 'a2')); await a;
  pending[0].resolve(fileReply('stale', 'a0')); pending[1].resolve(fileReply('other', 'b')); await b; await settle();
  eq(byId(ed, 'edit-text').value, 'latest', 'the newest request wins even for the same path');
  ed.stop?.();
});
await t('typing during a save keeps a draft based on the saved version, and the next save uses its SHA', async () => {
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1', sha: 's1' } }), gate = deferred();
  let first = true;
  const api = { ...f.api, putFile: async (...args) => { if (first) { first = false; await gate.promise; } return f.api.putFile(...args); } };
  const ed = UI.editorView(ctxOf(api, store), 'ruby'); await settle(); const ta = byId(ed, 'edit-text');
  ta.value = 'v2'; await ta.fire('input'); const saving = btn(ed, /^保存$/).fire('click');
  ta.value = 'v3'; await ta.fire('input'); gate.resolve(); await saving;
  eq(f.st.files['bds/addons/ruby/src/main.ts'].text, 'v2');
  eq(ta.value, 'v3'); eq(D.loadDraft(store, KEY()).text, 'v3'); eq(D.loadDraft(store, KEY()).baseSha, 'sha1');
  await btn(ed, /^保存$/).fire('click'); eq(f.st.files['bds/addons/ruby/src/main.ts'].text, 'v3'); eq(store.length, 0); ed.stop?.();
});
await t('concurrent saves share one write, lock navigation, and a cancelled guard leaves the draft intact', async () => {
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1', sha: 's1' } }), gate = deferred();
  let writes = 0;
  const api = { ...f.api, putFile: async (...args) => { writes++; await gate.promise; return f.api.putFile(...args); } };
  const ed = UI.editorView(ctxOf(api, store), 'ruby'); await settle(); const ta = byId(ed, 'edit-text');
  ta.value = 'v2'; await ta.fire('input'); const one = btn(ed, /^保存$/).fire('click'), two = btn(ed, /^保存$/).fire('click');
  ok(byId(ed, 'edit-file').disabled, 'navigation locked until the write finishes'); eq(writes, 1);
  gate.resolve(); await Promise.all([one, two]); eq(f.st.writes, 1); ok(!byId(ed, 'edit-file').disabled); ed.stop?.();
  const cancelled = UI.editorView(ctxOf(f.api, store, { guarded: async () => undefined }), 'ruby'); await settle();
  const text = byId(cancelled, 'edit-text'); text.value = 'not saved'; await text.fire('input');
  await btn(cancelled, /^保存$/).fire('click');
  eq(D.loadDraft(store, KEY()).text, 'not saved'); ok(!btn(cancelled, /^保存$/).disabled); cancelled.stop?.();
});
await t('save-and-test does not test an older version while new edits are still unsaved', async () => {
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1', sha: 's1' } }), gate = deferred(), ran = [];
  const api = { ...f.api, putFile: async (...args) => { await gate.promise; return f.api.putFile(...args); } };
  const ed = UI.editorView(ctxOf(api, store, { runUnit: (x) => ran.push(x) }), 'ruby'); await settle();
  const ta = byId(ed, 'edit-text'); ta.value = 'v2'; await ta.fire('input'); const saving = btn(ed, /保存して試験/).fire('click');
  ta.value = 'v3'; await ta.fire('input'); gate.resolve(); await saving;
  eq(ran, []); ok(/未保存/.test(byId(ed, 'edit-state').textContent)); ed.stop?.();
});
await t('closing an editor flushes its draft, ignores late reads and releases lifecycle listeners', async () => {
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1', sha: 's1' } });
  const listeners = new Set(), oldAdd = globalThis.addEventListener, oldRemove = globalThis.removeEventListener;
  globalThis.addEventListener = (_k, fn) => listeners.add(fn); globalThis.removeEventListener = (_k, fn) => listeners.delete(fn);
  try {
    const ed = UI.editorView(ctxOf(f.api, store, { draftWait: 100000 }), 'ruby'); await settle();
    const ta = byId(ed, 'edit-text'); ta.value = 'new'; await ta.fire('input');
    ok(typeof ed.stop === 'function', 'editor has a disposal hook'); ed.stop();
    eq(D.loadDraft(store, KEY()).text, 'new'); eq(listeners.size, 0);
    const gate = deferred(), waiting = UI.editorView(ctxOf({ call: () => gate.promise }, store), 'ruby');
    waiting.stop(); gate.resolve(fileReply('late', 's9')); await settle(); eq(byId(waiting, 'edit-text').value, '');
  } finally { globalThis.addEventListener = oldAdd; globalThis.removeEventListener = oldRemove; }
});
await t('blocked storage and malformed future drafts do not crash the editor or settings', () => {
  const broken = { getItem() { throw new Error('blocked'); }, get length() { throw new Error('blocked'); } };
  eq(D.loadDraft(broken, KEY()), null); eq(D.listDrafts(broken), []);
  const store = memStore(); store.setItem(KEY(), JSON.stringify({ text: 'future', at: Date.now() + 365 * DAY }));
  eq(D.loadDraft(store, KEY()), null);
});

await t('leaving the editor while policy confirmation is pending does not send a stale write', async () => {
  fakeDom(); const UI = await imp('panel/ui/workspace.mjs'), store = memStore(), f = fakeApi({ 'bds/addons/ruby/src/main.ts': { text: 'v1', sha: 's1' } }), gate = deferred();
  const ed = UI.editorView(ctxOf(f.api, store, { guarded: async (_a, _d, fn) => { await gate.promise; return fn(); } }), 'ruby'); await settle();
  const ta = byId(ed, 'edit-text'); ta.value = 'kept'; await ta.fire('input');
  const saving = btn(ed, /^保存$/).fire('click'); ed.stop(); gate.resolve(); await saving;
  eq(f.st.writes, 0); eq(D.loadDraft(store, KEY()).text, 'kept');
});

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
