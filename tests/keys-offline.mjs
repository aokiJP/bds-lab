// keys (⌨️ キーボードだけで) without a browser: KEYMAP has every shortcut the panel had (and asks the same as model.mjs shortcut,
// key by key), match() leaves text boxes, Japanese typing and Ctrl/⌘/Alt alone (Ctrl/⌘+K works everywhere), the list for
// people, Tab kept inside a dialog, 「本文へ飛ぶ」, and the 「設定」 card on a small fake DOM (a click runs onclick, a disabled
// button is not pressed).
// node tests/keys-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const K = await imp('panel/lib/keys.mjs'), M = await imp('panel/lib/model.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const key = (k, more = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, target: { tagName: 'BODY' }, ...more });
const TABS = ['overview', 'runs', 'addons', 'releases', 'stats', 'schedule', 'live', 'hosts', 'members', 'setup', 'settings'];

await t('KEYMAP: [キー, 言葉, 動き] for every key the panel had: Ctrl/⌘+K, ?, 1〜9, 0, /, r', () => {
  eq(K.KEYMAP.map(([k]) => k), ['Mod+K', '?', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '/', 'r']);
  for (const [k, words, move] of K.KEYMAP) ok(typeof words === 'string' && words.length > 1 && move && typeof move === 'object', k);
  ok(Object.isFrozen(K.KEYMAP) && Object.isFrozen(K.KEYMAP[0]), 'frozen');
  eq(K.match(key('k', { ctrlKey: true })), { palette: true });
  eq(K.match(key('?')), { help: true }); eq(K.match(key('/')), { search: true }); eq(K.match(key('r')), { reload: true });
  eq(K.match(key('1')), { tab: 0 }); eq(K.match(key('9')), { tab: 8 }); eq(K.match(key('0')), { tab: 9 });
});

await t('match + resolve ask the same as model.mjs shortcut for every key, with 11, 3 and no tabs shown', () => {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '/', 'r', '?', 'R', 'x', 'Enter', 'Tab', 'k', ' '];
  for (const tabs of [TABS, TABS.slice(0, 3), []]) for (const k of keys) eq(K.resolve(K.match(key(k)), tabs), M.shortcut(k, tabs), `${k} with ${tabs.length} tabs:`);
});

await t('match: Ctrl/⌘+K works anywhere (also in a text box, either case); with Alt or while typing Japanese, nothing', () => {
  for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
    eq(K.match(key('k', mod)), { palette: true }); eq(K.match(key('K', { ...mod, shiftKey: true })), { palette: true });
    eq(K.match(key('k', { ...mod, target: { tagName: 'INPUT' } })), { palette: true }, 'in a text box');
    eq(K.match(key('k', { ...mod, altKey: true })), null, 'Alt');
    eq(K.match(key('k', { ...mod, isComposing: true })), null, 'composing');
  }
  eq(K.match(key('k')), null, 'k alone is not a shortcut');
});

await t('match: the other keys never in a text box, a contenteditable, with Ctrl/⌘/Alt or while composing', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) for (const k of ['1', '0', '/', 'r', '?']) eq(K.match(key(k, { target: { tagName: tag } })), null, `${k} in ${tag}`);
  eq(K.match(key('r', { target: { tagName: 'DIV', isContentEditable: true } })), null, 'contenteditable');
  eq(K.match(key('r'), K.KEYMAP, { tagName: 'TEXTAREA' }), null, 'the active element given wins over target');
  eq(K.match(key('r', { target: { tagName: 'INPUT' } }), K.KEYMAP, { tagName: 'BUTTON' }), { reload: true }, 'focus on a button');
  for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) for (const k of ['1', '/', 'r', '?']) eq(K.match(key(k, mod)), null, `${k} ${JSON.stringify(mod)}`);
  eq(K.match(key('R')), null, 'Shift+R is not r (as before)');
  eq(K.match(null), null); eq(K.match({}), null); eq(K.match(key('r'), []), null, 'an empty map');
  const m = K.match(key('1')); m.tab = 5; eq(K.match(key('1')), { tab: 0 }, 'a copy: the table is not changed');
});

await t('resolve: a tab past the ones shown is nothing; the other moves as they are', () => {
  eq(K.resolve({ tab: 2 }, ['a', 'b']), null); eq(K.resolve({ tab: 1 }, ['a', 'b']), { tab: 'b' });
  eq(K.resolve({ reload: true }, []), { reload: true }); eq(K.resolve(null, TABS), null); eq(K.resolve({ tab: 'x' }, TABS), null);
});

await t('label / rows / helpLine: Ctrl or ⌘, the tab keys in one row, every move said', () => {
  eq(K.label('Mod+K'), 'Ctrl+K'); eq(K.label('Mod+K', true), '⌘+K'); eq(K.label('r'), 'R'); eq(K.label('?'), '?');
  ok(K.isMac('MacIntel') && K.isMac('iPhone') && !K.isMac('Win32') && !K.isMac(''), 'isMac');
  const r = K.rows();
  eq(r.map((x) => x.keys), ['Ctrl+K', '?', '1〜9・0', '/', 'R']);
  eq(K.rows(K.KEYMAP, true)[0].keys, '⌘+K');
  for (const x of r) ok(x.words && !/palette|reload|search/.test(x.words), `plain words: ${x.words}`);
  eq(K.rows([['1', 'a', { tab: 0 }], ['2', 'b', { tab: 1 }]]).map((x) => x.keys), ['1・2']);
  const line = K.helpLine();
  ok(/Ctrl\+K: /.test(line) && /1〜9・0: タブ/.test(line) && /\/: 実行を探す/.test(line) && /R: 読み直す/.test(line), line);
});

await t('trapIndex: Tab from the last → the first, Shift+Tab from the first → the last, otherwise the browser moves', () => {
  eq(K.trapIndex(3, 2), 0); eq(K.trapIndex(3, 0, true), 2);
  eq(K.trapIndex(3, 1), null); eq(K.trapIndex(3, 1, true), null); eq(K.trapIndex(3, 0), null);
  eq(K.trapIndex(3, -1), 0, 'focus outside: in'); eq(K.trapIndex(3, -1, true), 2);
  eq(K.trapIndex(1, 0), 0); eq(K.trapIndex(0, -1), null, 'nothing to focus');
});

await t('tabProblems: tabindex above 0, a button or link with no words, a live button taken out of Tab', () => {
  eq(K.tabProblems([{ tag: 'button', name: 'OK' }, { tag: 'a', name: 'GitHub', tabindex: '0' }, { tag: 'input', name: '' }]), []);
  const p = K.tabProblems([{ tag: 'button', name: '次へ', tabindex: '3' }, { tag: 'button', name: '  ' }, { tag: 'a', name: '見る', tabindex: '-1' },
    { tag: 'button', name: '止める', tabindex: '-1', disabled: true }, { tag: 'div', name: '', tabindex: '-1' }]);
  eq(p.length, 3, JSON.stringify(p));
  ok(/1 番目のボタン「次へ」/.test(p[0].what) && /順番/.test(p[0].why), p[0].what);
  ok(/2 番目のボタン/.test(p[1].what) && /言葉がない/.test(p[1].why), p[1].why);
  ok(/3 番目のリンク/.test(p[2].what) && /Tab で行けません/.test(p[2].why), p[2].why);
  eq(K.tabProblems(), []);
});

// ---- the card, the trap and the skip link on a small DOM ----
function fakeDom() {
  class Nd { get textContent() { return ''; } }
  class T extends Nd { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends Nd {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, hidden: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    hasAttribute(k) { return k in this.attrs; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    removeEventListener(type, fn) { this.on[type] = (this.on[type] ?? []).filter((f) => f !== fn); }
    append(...xs) { for (const x of xs) { if (x === null || x === undefined || Array.isArray(x)) throw new Error('append(bad)'); const n = x instanceof Nd ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    focus() { doc.activeElement = this; }
    // (as a browser: a click runs the click listeners — h()'s onclick — unless the button is disabled)
    click() { if (this.disabled) return; for (const fn of this.on.click ?? []) fn({ target: this, preventDefault() { this.prevented = true; } }); }
    // (a key pressed with the focus here: the listeners of this element and its parents, as a bubbling keydown)
    key(k, shiftKey = false) { const ev = { key: k, shiftKey, prevented: false, preventDefault() { this.prevented = true; } }; for (let e = this; e; e = e.parent) for (const fn of e.on.keydown ?? []) fn(ev); return ev; }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
    // (only what FOCUSABLE asks: a[href], button, input, select, textarea, [tabindex], [contenteditable="true"])
    querySelectorAll() { return this.all((e) => (e.tagName === 'A' && 'href' in e.attrs) || ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) || 'tabindex' in e.attrs || e.attrs.contenteditable === 'true'); }
  }
  const main = new E('main'); main.attrs.id = 'main';
  const toast = new E('div');
  const doc = { activeElement: null, createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'main' ? main : id === 'toast' ? toast : null) };
  globalThis.Node = Nd;
  globalThis.document = doc;
  return { doc, main, E };
}

await t('the fake DOM: a click runs onclick, a disabled button is not pressed', async () => {
  fakeDom();
  const { h } = await imp('panel/ui/dom.mjs');
  let n = 0;
  h('button', { onclick: () => n++ }).click(); eq(n, 1, 'pressed');
  h('button', { disabled: true, onclick: () => n++ }).click(); eq(n, 1, 'a disabled button is not pressed');
});

await t('keysCard: the list from KEYMAP (Ctrl or ⌘), and 「Tab で回れるか確かめる」 says what it found (fake DOM)', async () => {
  const { doc, main } = fakeDom();
  const { h } = await imp('panel/ui/dom.mjs');
  const UI = await imp('panel/ui/keys.mjs');
  const card = UI.keysCard({ document: doc, mac: false });
  const cells = card.all((e) => e.tagName === 'KBD').map((e) => e.textContent);
  eq(cells, ['Ctrl+K', '?', '1〜9・0', '/', 'R']);
  ok(/キーボードだけで/.test(card.textContent) && /読み直す/.test(card.textContent) && /Shift\+Tab/.test(card.textContent), card.textContent);
  ok(!/palette|reload|Mod\+/.test(card.textContent), 'no names from the code shown');
  eq(UI.keysCard({ document: doc, mac: true }).all((e) => e.tagName === 'KBD')[0].textContent, '⌘+K');

  main.append(h('button', {}, '動かす'), h('a', { href: 'https://github.com/' }, 'GitHub'), h('input', { type: 'text' }));
  const btn = card.all((e) => e.attrs['data-keys-do'] === 'check')[0];
  ok(btn && !btn.disabled, 'pressable'); btn.click();
  ok(/3 か所に Tab で行けます/.test(card.textContent) && /困るところは見つかりませんでした/.test(card.textContent), card.textContent);

  main.append(h('button', { tabindex: '2' }, '飛ぶ'), h('button', {}));
  btn.click();
  const res = card.all((e) => e.attrs['data-keys'] === 'result')[0].textContent;
  ok(/気になるところが 2 つ/.test(res) && /順番が飛びます/.test(res) && /言葉がない/.test(res), res);
});

await t('keysCard: no screen to look at → the reason and the next step, never an empty box (fake DOM)', async () => {
  const { doc } = fakeDom();
  const UI = await imp('panel/ui/keys.mjs');
  const card = UI.keysCard({ document: { ...doc, getElementById: () => null }, mac: false });
  card.all((e) => e.attrs['data-keys-do'] === 'check')[0].click();
  const bad = card.all((e) => e.attrs.role === 'alert')[0];
  ok(bad && /見つかりませんでした/.test(bad.textContent) && /もう一度/.test(bad.textContent), card.textContent);
});

await t('focusTrap: Tab from the last goes to the first, Shift+Tab from the first to the last; release gives the focus back (fake DOM)', async () => {
  const { doc, E } = fakeDom();
  const { h } = await imp('panel/ui/dom.mjs');
  const UI = await imp('panel/ui/keys.mjs');
  const opener = new E('button'); opener.focus();
  const a = h('input', { type: 'text' }), off = h('button', { disabled: true }, '押せない'), skip = h('button', { tabindex: '-1' }, '外'), b = h('button', {}, 'OK'), c = h('button', {}, '閉じる');
  const box = h('div', { role: 'dialog' }, a, off, skip, h('p', {}, '文'), b, c);
  const fs = UI.focusables(box); ok(fs.length === 3 && fs[0] === a && fs[1] === b && fs[2] === c, 'disabled and tabindex -1 are not in the round');
  const release = UI.focusTrap(box, doc);
  c.focus(); let ev = c.key('Tab'); ok(ev.prevented && doc.activeElement === a, 'last → first');
  a.focus(); ev = a.key('Tab', true); ok(ev.prevented && doc.activeElement === c, 'first ← last');
  b.focus(); ev = b.key('Tab'); ok(!ev.prevented && doc.activeElement === b, 'in the middle: the browser moves it');
  a.focus(); ev = a.key('Enter'); ok(!ev.prevented, 'other keys left alone');
  release();
  ok(doc.activeElement === opener, 'the focus back where it was');
  c.focus(); ev = c.key('Tab'); ok(!ev.prevented, 'released: no trap');
});

await t('skipLink: 「本文へ飛ぶ」 to #main moves the focus there (made focusable once) (fake DOM)', async () => {
  const { doc, main } = fakeDom();
  const UI = await imp('panel/ui/keys.mjs');
  const s = UI.skipLink('main', doc);
  eq([s.tagName, s.attrs.href, s.textContent], ['A', '#main', '本文へ飛ぶ']);
  s.click();
  ok(doc.activeElement === main && main.attrs.tabindex === '-1', 'focused');
  main.attrs.tabindex = '0'; s.click(); eq(main.attrs.tabindex, '0', 'a tabindex already there is kept');
  const none = UI.skipLink('nowhere', doc); none.click(); ok(doc.activeElement === main, 'no such part: nothing breaks');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
