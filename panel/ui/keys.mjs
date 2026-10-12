// keys (a card in 「設定」): ⌨️ キーボードだけで — the list of every shortcut (lib/keys.mjs KEYMAP, the same table the page's
// keydown reads) and 「Tab で回れるか確かめる」 (what on this page keeps a keyboard from going round). Also focusTrap(el): Tab stays
// inside a dialog; skipLink(): 「本文へ飛ぶ」, the first thing Tab reaches. Nothing is written to GitHub or kept: no guarded, no
// record.
import { h, failView } from './dom.mjs';
import * as K from '../lib/keys.mjs';

/** what Tab can reach (the browser's own list; disabled, hidden and tabindex -1 left out by focusables()) */
export const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
const away = (e) => e.disabled || e.hidden || e.getAttribute?.('tabindex') === '-1' || (e.tagName === 'INPUT' && e.type === 'hidden');
/** the elements Tab goes round inside el, in order */
export const focusables = (el) => [...(el?.querySelectorAll?.(FOCUSABLE) ?? [])].filter((e) => !away(e));

/** Tab and Shift+Tab stay inside el (a dialog): from the last → the first, from the first → the last.
 *  → release(): takes the trap off and gives the focus back to where it was before (if it can) */
export function focusTrap(el, doc = globalThis.document) {
  const before = doc?.activeElement ?? null;
  const onKey = (e) => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const list = focusables(el);
    const to = K.trapIndex(list.length, list.indexOf(doc?.activeElement), Boolean(e.shiftKey));
    if (to === null) return;
    e.preventDefault?.();
    list[to].focus?.();
  };
  el.addEventListener('keydown', onKey);
  return () => {
    el.removeEventListener?.('keydown', onKey);
    if (before && typeof before.focus === 'function') { try { before.focus(); } catch { /* gone from the page */ } }
  };
}

/** 「本文へ飛ぶ」: a link to put first in <body>; pressing it moves the focus to the main part (id, default 'main') */
export function skipLink(target = 'main', doc = globalThis.document) {
  return h('a', { href: `#${target}`, class: 'skip-link', onclick: (e) => {
    const m = doc?.getElementById?.(target);
    if (!m) return;
    e?.preventDefault?.();
    if (!m.hasAttribute?.('tabindex')) m.setAttribute('tabindex', '-1');
    m.focus?.();
  } }, '本文へ飛ぶ');
}

/** what in root keeps a keyboard from going round (lib/keys.mjs tabProblems) → [{ what, why }] */
export function tabCheck(root) {
  const items = [...(root?.querySelectorAll?.(FOCUSABLE) ?? [])].map((e) => ({
    tag: String(e.tagName ?? '').toLowerCase(), tabindex: e.getAttribute?.('tabindex') ?? null, disabled: Boolean(e.disabled),
    name: e.getAttribute?.('aria-label') || e.getAttribute?.('title') || e.textContent || e.value || '',
  }));
  return K.tabProblems(items);
}

/** ctx: { mac? (⌘ instead of Ctrl; default from navigator), keymap?, root? (what 「確かめる」 looks at; default #main),
 *  document? } → an element */
export function keysCard(ctx = {}) {
  const doc = ctx.document ?? globalThis.document;
  const mac = ctx.mac ?? K.isMac(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
  const keymap = ctx.keymap ?? K.KEYMAP;
  const out = h('div', { 'data-keys': 'result' });
  const check = () => {
    const root = ctx.root ?? doc?.getElementById?.('main');
    if (!root) { out.replaceChildren(failView(new Error('確かめる画面が見つかりませんでした。ページを読み直して（R キー）、もう一度押してください'))); return; }
    let bad;
    try { bad = tabCheck(root); } catch (e) { out.replaceChildren(failView(e, check)); return; }
    const n = focusables(root).length;
    out.replaceChildren(bad.length
      ? h('div', {}, h('p', { class: 'warn' }, `この画面で ${n} か所に Tab で行けます。気になるところが ${bad.length} つあります:`),
        h('ul', {}, bad.map((b) => h('li', {}, `${b.what}: ${b.why}`))))
      : h('p', { class: 'ok' }, `この画面で ${n} か所に Tab で行けます。困るところは見つかりませんでした。`));
  };
  return h('div', { class: 'card', 'data-card': 'keys' },
    h('h3', {}, '⌨️ キーボードだけで'),
    h('p', { class: 'muted' }, 'マウスがなくても使えます。Tab で次へ、Shift+Tab で前へ、Enter かスペースで押します。文字を入れる欄の中では、下のキー（Ctrl と ⌘ のもの以外）は効きません。'),
    h('table', { class: 'keys' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'キー'), h('th', { scope: 'col' }, 'すること'))),
      h('tbody', {}, K.rows(keymap, mac).map((r) => h('tr', {}, h('td', {}, h('kbd', {}, r.keys)), h('td', {}, r.words))))),
    h('div', { class: 'row' }, h('button', { type: 'button', 'data-keys-do': 'check', onclick: check }, 'Tab で回れるか確かめる')),
    out);
}
