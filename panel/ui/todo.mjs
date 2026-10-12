// todo card: the lab's issues as three columns — やる, やっている, できた — each card with buttons that move it (plain buttons,
// no dragging: they work with the keyboard). A move is the label change (lib/todo.mjs moveOps) through ctx.guarded with the
// policy's `issues` action, and the two labels are made first, in the same guarded step, when the repository has none.
// GitHub is read when the card is made and again after each move.
import { h, failView } from './dom.mjs';
import * as T from '../lib/todo.mjs';

const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const SHOW_DONE = 10;
const WHERE = { todo: '→ やる', doing: '→ やっている', done: '→ できた' };

/** ctx: { api, lab: { slug }, guarded(action, detail, fn, done), may?(action) } → the card (an element that fills itself) */
export function todoCard(ctx) {
  const { api, lab } = ctx;
  const body = h('div', {}), root = h('div', { class: 'card', 'data-todo': lab.slug }, h('h3', {}, '🗂 ToDo ボード'), body);
  let made = false;   // (the labels checked once: the card does not ask again)
  const why = !ctx.guarded ? 'ここでは動かせません（記録に残せないため）' : ctx.may && !ctx.may('issues') ? 'この役割では動かせません（Issue を変える力が要ります。管理者に頼んでください）' : null;
  const at = (p) => `/repos/${lab.slug}${p}`;
  const move = async (issue, to) => {
    const ops = T.moveOps(issue, to);
    if (!ops.length) return;
    const r = await ctx.guarded('issues', { number: issue.number, to }, async () => {
      if (!made) { for (const l of T.LABELS) await api.createLabel(lab.slug, l); made = true; }
      for (const o of ops) await api.call(o.method, at(o.path), o.body);
      return true;
    }, `#${issue.number} を「${T.COLUMNS.find((c) => c.id === to).label}」に動かしました`);
    if (r !== undefined) await load();
  };
  const card = (i, col) => h('li', { class: 'todo-card', 'data-issue': i.number },
    h('div', {}, `#${i.number} ${i.title ?? ''}`),
    h('div', { class: 'row' }, T.COLUMNS.filter((c) => c.id !== col).map((c) => h('button', { 'data-to': c.id, disabled: Boolean(why), title: why ?? '', onclick: () => { if (!why) return move(i, c.id); return undefined; } }, WHERE[c.id]))));
  const load = async () => {
    fill(body, h('p', { class: 'muted' }, 'Issue を読んでいます…'));
    let issues;
    try { issues = await api.call('GET', at('/issues?state=all&per_page=100&sort=updated')); } catch (e) { fill(body, failView(e, load), h('button', { onclick: load }, '読み直す')); return; }
    const cols = T.columns(issues);
    fill(body, why ? h('p', { class: 'muted' }, why) : null,
      h('div', { class: 'grid' }, T.COLUMNS.map((c) => {
        const all = cols[c.id], list = c.id === 'done' ? all.slice(0, SHOW_DONE) : all;
        return h('section', { 'data-col': c.id, 'aria-label': c.label }, h('h4', {}, `${c.label}（${all.length}）`),
          list.length ? h('ul', {}, list.map((i) => card(i, c.id))) : h('p', { class: 'muted' }, 'まだありません'),
          all.length > list.length ? h('p', { class: 'muted' }, `ほか ${all.length - list.length} 件`) : null);
      })),
      h('button', { onclick: load }, '読み直す'));
  };
  load();
  return root;
}
