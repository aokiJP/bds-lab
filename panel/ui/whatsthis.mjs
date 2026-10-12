// whatsthis (a button): the ❓ at a tab's top right. Pressed, it puts a few words beside each button, heading and label of the
// tab that has one (role=note); pressed again — or Esc — they go. Only reads the screen; nothing is sent anywhere.
import { h } from './dom.mjs';
import * as W from '../lib/whatsthis.mjs';

/** { tab, root: the element holding the tab's screen (or a function giving it) } → the ❓ button */
export function whatsThisButton(ctx, { tab, root } = {}) {
  let notes = [];
  // (Esc takes the words away; the listener lives only while the words are shown)
  const onKey = (e) => { if (e?.key === 'Escape') off(); };
  const off = () => { for (const n of notes) n.remove(); notes = []; globalThis.document?.removeEventListener?.('keydown', onKey); btn.setAttribute('aria-pressed', 'false'); btn.title = 'このボタンや欄が何かを見る'; };
  const on = () => {
    const top = typeof root === 'function' ? root() : root;
    const els = top?.querySelectorAll ? [...top.querySelectorAll('button, h2, label')].filter((e) => e !== btn && !e.closest?.('[role=note]')) : [];
    const tips = W.tipsFor(tab, els.map((e) => e.textContent));
    for (const { index, tip } of tips) {
      const note = h('small', { class: 'muted whatsthis', role: 'note' }, `❓ ${tip}`);
      els[index].after(note);
      notes.push(note);
    }
    globalThis.document?.addEventListener?.('keydown', onKey);
    btn.setAttribute('aria-pressed', 'true');
    btn.title = '説明を消す';
    if (!tips.length) { const none = h('small', { class: 'muted whatsthis', role: 'note' }, '❓ この画面には、説明を付けるものがまだありません。'); btn.after(none); notes.push(none); }
  };
  const btn = h('button', { class: 'whatsthis', type: 'button', 'aria-label': 'これは何？', 'aria-pressed': 'false', title: 'このボタンや欄が何かを見る',
    onclick: () => (notes.length ? off() : on()) }, '❓');
  return btn;
}
