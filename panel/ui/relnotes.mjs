// relnotes (a card): the draft of a release's notes for the people who play — what is new, what is fixed, the rest — made from
// the commits since the previous release (lib/relnotes.mjs), shown as words to read and a button that copies them. Nothing is
// written to GitHub; the copy goes to the clipboard of this browser only.
import { h, act, failView } from './dom.mjs';
import * as R from '../lib/relnotes.mjs';

/** ctx: { api, lab: { slug, repo, role }, me, policy, role, guarded?, record? } · unit: { name, kind } (null: the whole lab) ·
 *  fromTag: the previous release's tag (undefined: found from the lab's releases; null: the first version).
 *  → an element that draws itself */
export function relnotesCard(ctx, { unit = null, fromTag } = {}) {
  const say = h('div', { class: 'muted', role: 'status' }, '下書きを作っています…'), out = h('div', {});
  const copy = h('button', { class: 'primary', disabled: true, title: '下書きができるまで押せません' }, '写す');
  const again = h('button', { onclick: () => draw() }, 'もう一度作る');
  let md = '';
  copy.addEventListener('click', () => act(async () => {
    const clip = ctx.clipboard ?? globalThis.navigator?.clipboard;
    if (!clip?.writeText) throw new Error('このブラウザでは写せません: 下の文を選んで写してください');
    await clip.writeText(md);
  }, 'リリースノートの下書きを写しました'));
  async function draw() {
    copy.disabled = true; say.replaceChildren('下書きを作っています…'); out.replaceChildren();
    try {
      const d = await R.draftNotes(ctx.api, ctx.lab.slug, { unit, fromTag, head: ctx.lab.repo?.default_branch ?? 'HEAD', title: unit ? `${unit.name}` : '' });
      md = d.markdown;
      say.replaceChildren(d.from ? `${d.from} から今までの変わったところです（${d.count} 件）。` : '前のリリースが見つからないので、最初の版として書きました。');
      if (d.truncated) say.append(' 多いので、新しい方だけを見ています。');
      if (!d.count) { out.replaceChildren(h('p', { class: 'muted' }, '遊ぶ人に伝える変更がまだありません。アドオンを直してから、もう一度作ってください。')); return; }
      out.replaceChildren(h('pre', { 'aria-label': 'リリースノートの下書き' }, md));
      copy.disabled = false; copy.removeAttribute?.('title');
    } catch (e) { say.replaceChildren(); out.replaceChildren(failView(e, draw)); }
  }
  const card = h('div', { class: 'card', 'data-card': 'relnotes' }, h('h3', {}, `📝 リリースノートの下書き${unit ? `（${unit.name}）` : ''}`),
    h('p', { class: 'muted' }, '前のリリースから今までの変更を、遊ぶ人向けの言葉に分けます。直してから使ってください。'), say, out, h('div', { class: 'row' }, copy, again));
  draw();
  return card;
}
