// 「これは何？」 without a browser: the tips that fit a screen (pure), and the ❓ button on a small fake DOM — pressed it puts a
// note (role=note) beside the buttons, headings and labels that have a tip, pressed again or Esc it takes them away.
// node tests/whatsthis-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const W = await imp('panel/lib/whatsthis.mjs'), G = await imp('panel/lib/guide.mjs');
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

await t('tipsFor: only what is on the screen, by index; marks and … ignored; the longest wording wins', () => {
  const r = W.tipsFor('units', ['🆕 新しく作る', '何もない', '試験…', '']);
  eq(r.map((x) => x.index), [0, 2]);
  ok(r.every((x) => typeof x.tip === 'string' && x.tip.length > 5), JSON.stringify(r));
  const s = W.tipsFor('start', ['すぐ始める', '始める']);
  ok(s[0].tip !== s[1].tip, 'すぐ始める must not take the tip of 始める');
});
await t('tipsFor: unknown tab, bad input, nothing on screen → nothing', () => {
  eq(W.tipsFor('nope', ['始める']), []); eq(W.tipsFor('start', null), []); eq(W.tipsFor('start', []), []); eq(W.tipsFor(undefined, undefined), []);
});
await t('TIPS: every tab is one of the guide tabs, every tip is a pair of words, no tab name or id is shown to people', () => {
  for (const [tab, list] of Object.entries(W.TIPS)) {
    ok(G.HELP[tab], `unknown tab ${tab}`);
    for (const [k, v] of list) ok(k && v && !/secrets\.put|dispatch|run\.cancel/.test(v), `${tab}: ${k}`);
  }
  ok(Object.isFrozen(W.TIPS) && Object.isFrozen(W.TIPS.start), 'frozen');
});

function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    after(n) { const i = this.parent.kids.indexOf(this); n.parent = this.parent; this.parent.kids.splice(i + 1, 0, n); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    closest(sel) { const role = /\[role=(\w+)\]/.exec(sel)?.[1]; for (let e = this; e; e = e.parent) if (role && e.attrs?.role === role) return e; return null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return this.attrs.disabled !== undefined ? Promise.resolve() : Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
    querySelectorAll(sel) { const tags = sel.split(',').map((s) => s.trim().toUpperCase()); return this.all((e) => tags.includes(e.tagName)); }
  }
  const keys = [];
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: () => null, body: new E('body'),
    addEventListener: (type, fn) => { if (type === 'keydown') keys.push(fn); }, removeEventListener: (type, fn) => { const i = keys.indexOf(fn); if (type === 'keydown' && i >= 0) keys.splice(i, 1); } };
  return { keys, key: (k) => Promise.all([...keys].map((fn) => fn({ key: k }))) };
}
const screen = (h) => h('div', {}, h('h2', {}, '予約'), h('label', {}, '曜日'), h('button', {}, 'この予約を足す'), h('button', {}, '関係ないボタン'));
const notes = (root) => root.all((e) => e.attrs.role === 'note');

await t('pressed: a note beside each thing with a tip, none beside the rest; pressed again: gone', async () => {
  const d = fakeDom(); const { h } = await imp('panel/ui/dom.mjs'), UI = await imp('panel/ui/whatsthis.mjs');
  const root = screen(h), b = UI.whatsThisButton({}, { tab: 'schedule', root }); root.append(b);
  eq(notes(root).length, 0);
  await b.click();
  eq(notes(root).length, 2, notes(root).map((n) => n.textContent).join('|'));
  const kids = root.kids; const at = (txt) => kids.findIndex((k) => k.textContent === txt);
  ok(kids[at('曜日') + 1].attrs.role === 'note' && kids[at('この予約を足す') + 1].attrs.role === 'note' && kids[at('関係ないボタン') + 1]?.attrs.role !== 'note', 'beside the right ones');
  eq(b.attrs['aria-pressed'], 'true'); eq(d.keys.length, 1);
  await b.click();
  eq(notes(root).length, 0); eq(b.attrs['aria-pressed'], 'false'); eq(d.keys.length, 0, 'listener removed');
});
await t('pressed twice over: never doubles; pressing on a note-less screen says so', async () => {
  fakeDom(); const { h } = await imp('panel/ui/dom.mjs'), UI = await imp('panel/ui/whatsthis.mjs');
  const root = h('div', {}, h('button', {}, 'なにか')), b = UI.whatsThisButton({}, { tab: 'schedule', root: () => root }); root.append(b);
  await b.click(); eq(notes(root).length, 1); ok(/まだありません/.test(notes(root)[0].textContent), 'says none');
  await b.click(); eq(notes(root).length, 0);
});
await t('Esc takes the notes away; another key does not; Esc with none shown does nothing', async () => {
  const d = fakeDom(); const { h } = await imp('panel/ui/dom.mjs'), UI = await imp('panel/ui/whatsthis.mjs');
  const root = screen(h), b = UI.whatsThisButton({}, { tab: 'schedule', root }); root.append(b);
  await d.key('Escape'); eq(notes(root).length, 0);
  await b.click(); await d.key('a'); eq(notes(root).length, 2);
  await d.key('Escape'); eq(notes(root).length, 0); eq(b.attrs['aria-pressed'], 'false'); eq(d.keys.length, 0);
});
await t('the ❓ itself and its own notes are not annotated; a disabled ❓ is not pressed', async () => {
  fakeDom(); const { h } = await imp('panel/ui/dom.mjs'), UI = await imp('panel/ui/whatsthis.mjs');
  const root = screen(h), b = UI.whatsThisButton({}, { tab: 'schedule', root }); root.append(b);
  await b.click(); await b.click(); await b.click(); eq(notes(root).length, 2, 'no notes on notes');
  await b.click();
  b.setAttribute('disabled', ''); await b.click(); eq(notes(root).length, 0, 'disabled: nothing');
});

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
