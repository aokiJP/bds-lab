// wizard (the screen of lib/wizard.mjs): 「何がしたい？」 — one question at a time with big buttons, 「戻る」 and 「最初から」;
// at the end the tab to go to and the heading of the place to look at (its id only goes to ctx.go, never to the person). Where it is stays in sessionStorage (ctx.storage), so a
// redraw of the page does not lose it. ctx: { tabs(), may(action), go(tab), storage, labSlug? }
import { h } from './dom.mjs';
import * as W from '../lib/wizard.mjs';

const KEY = (ctx) => `bdslab.panel.wizard.${ctx.labSlug ?? ''}`;
const load = (ctx) => { try { const p = JSON.parse(ctx.storage.getItem(KEY(ctx)) ?? '[]'); return Array.isArray(p) ? p.filter((x) => typeof x === 'string') : []; } catch { return []; /* not ours: from the start */ } };
const save = (ctx, path) => { try { ctx.storage.setItem(KEY(ctx), JSON.stringify(path)); } catch { /* storage full or off: this once, it is not kept */ } };

export function wizardCard(ctx) {
  const card = h('div', { class: 'card', id: 'wizard' });
  const show = (...kids) => card.replaceChildren(...kids.filter(Boolean));
  const draw = () => {
    let path = load(ctx), r = W.next(path);
    if (r.error) { path = []; save(ctx, path); r = W.next(path); }
    const set = (p) => { save(ctx, p); draw(); };
    const nav = h('div', { class: 'row' },
      path.length ? h('button', { 'data-act': 'back', onclick: () => set(path.slice(0, -1)) }, '← 戻る') : null,
      path.length ? h('button', { 'data-act': 'restart', onclick: () => set([]) }, '最初から') : null);
    if (r.ask) {
      show(h('h2', {}, '🧭 何がしたい？'), h('p', {}, h('strong', {}, r.ask)),
        h('div', { class: 'col' }, r.options.map((o) => h('button', { class: 'primary big', 'data-choice': o.id, onclick: () => set([...path, o.id]) }, o.label))), nav);
      return;
    }
    const to = W.resolve(r.key, ctx);
    if (!to.tab) { show(h('h2', {}, '🧭 何がしたい？'), h('p', { class: 'warn', role: 'alert' }, to.why), nav); return; }
    show(h('h2', {}, '🧭 ここへ行きましょう'),
      to.why ? h('p', { class: 'warn', role: 'alert', 'data-why': '1' }, `${to.why} かわりに、こちらへ。`) : null,
      h('p', {}, to.say),
      to.where ? h('p', { class: 'muted' }, `開いたら、「${to.where}」の場所を見てください。`) : null,
      h('button', { class: 'primary big', 'data-go': to.tab, onclick: () => ctx.go(to.tab, to.focus) }, `「${to.name}」のタブへ行く`), nav);
  };
  draw();
  return card;
}
