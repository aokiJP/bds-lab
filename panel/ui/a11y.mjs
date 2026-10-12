// a11y (a card in 「設定」): 見やすさ — 大きな字・はっきりした色・動きを減らす・リンクに下線 — four switches and 「今すぐ見る」,
// kept in this browser (lib/a11y.mjs). Nothing is written to GitHub: it is about this screen only, so no guarded and no record.
// apply(document, prefs) puts the classes on <html> (panel/a11y.css reads them); the page calls it once at start-up.
import { h, failView, toast } from './dom.mjs';
import * as A from '../lib/a11y.mjs';

/** the classes for prefs on <html>, the others taken off → the classes now on */
export function apply(doc, prefs) {
  const el = doc?.documentElement, on = A.classes(prefs);
  if (!el?.classList) return on;
  for (const c of A.ALL_CLASSES) el.classList.toggle(c, on.includes(c));
  return on;
}

/** ctx: { storage (localStorage), document?, matchMedia? } → an element */
export function a11yCard(ctx = {}) {
  const doc = ctx.document ?? globalThis.document, storage = ctx.storage, mm = ctx.matchMedia ?? globalThis.matchMedia;
  const device = () => A.fromMedia(typeof mm === 'function' ? (q) => mm.call(globalThis, q) : null);
  const box = h('div', { class: 'card', 'data-card': 'a11y' });
  const st = { now: A.load(storage, device()), draft: null };
  st.draft = { ...st.now };
  const same = () => A.PREFS.every((p) => st.draft[p.key] === st.now[p.key]);

  const tail = h('div', {});
  const drawTail = () => {
    const mine = A.chosen(storage), still = same();
    tail.replaceChildren(...[
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', 'data-a11y-do': 'show', disabled: still, onclick: show }, '今すぐ見る'),
        h('button', { type: 'button', 'data-a11y-do': 'reset', disabled: !mine, onclick: back }, 'この端末の設定に戻す')),
      still ? h('p', { class: 'muted' }, '「今すぐ見る」は、チェックを変えると押せます。') : null,
      mine ? null : h('p', { class: 'muted' }, 'いまはこの端末（スマホ・パソコン）の設定に合わせています。「この端末の設定に戻す」は、ここで選んだあとに押せます。'),
    ].filter(Boolean));
  };

  function show() {
    if (same()) return;
    st.now = { ...st.draft };
    apply(doc, st.now);
    if (!A.save(storage, st.now, device())) box.append(failView(new Error('このブラウザには残せませんでした（保存の場所がいっぱいか、断られました）。このページを開いている間だけ効きます。ブラウザの保存の設定を見直して、もう一度「今すぐ見る」を押してください')));
    else toast('見え方を変えました（このブラウザに残します）');
    drawTail();
  }
  function back() {
    if (!A.chosen(storage)) return;
    A.reset(storage);
    st.now = A.load(storage, device()); st.draft = { ...st.now };
    apply(doc, st.now);
    toast('この端末の設定に戻しました');
    draw();
  }

  const row = (p) => h('li', { class: 'row', 'data-a11y': p.key },
    h('label', {},
      h('input', { type: 'checkbox', 'data-a11y-key': p.key, checked: st.draft[p.key], 'aria-label': p.words,
        onchange: (ev) => { st.draft[p.key] = Boolean(ev.target.checked); drawTail(); } }),
      ' ', h('b', {}, p.words), ' ', h('span', { class: 'muted' }, p.hint)));

  function draw() {
    box.replaceChildren(
      h('h3', {}, '♿ 見やすさ'),
      h('p', { class: 'muted' }, '見え方を選んで「今すぐ見る」を押します。この端末のこのブラウザだけに残ります（ほかの人やラボには届きません）。'),
      h('ul', { class: 'plain' }, A.PREFS.map(row)),
      tail);
    drawTail();
  }
  draw();
  return box;
}
