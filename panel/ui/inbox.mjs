// inbox (the screen of lib/inbox.mjs): the 🔔 in the header with the number of news not read yet, and the list that opens at the
// top of the page — all, not read, failures — with 「すべて読んだ」 and, for each piece of news, the tab it belongs to. What happened
// while the panel was closed comes in when it is opened again (nothing here is pushed from a server). Text is always text.
import { h, $, main, link } from './dom.mjs';
import { ago } from '../lib/model.mjs';
import { KIND_WORDS } from '../lib/inbox.mjs';

const when = (at) => (Number.isFinite(Date.parse(at)) ? ago(at) : '');
const FILTERS = [['all', 'すべて'], ['unread', '未読'], ['failed', '失敗']];
const PICK = { all: () => true, unread: (x) => !x.read, failed: (x) => x.kind === 'failure' };
const EMPTY = { all: 'まだお知らせはありません。', unread: '読んでいないお知らせはありません。', failed: '失敗のお知らせはありません。' };

/** the 🔔: the number of news not read; a tap shows the list at the top of the page (toggleInbox), or ctx.open() when the page
 *  has its own way. It follows the store by itself. ctx: { inbox (lib/inbox.mjs store), go(tab, item), open?() } */
export function bellButton(ctx) {
  const b = h('button', { id: 'bell', onclick: () => (ctx.open ? ctx.open() : toggleInbox(ctx)) });
  const draw = () => {
    const n = ctx.inbox.unread();
    b.replaceChildren(n ? `🔔 ${n > 99 ? '99+' : n}` : '🔔');
    b.className = n ? 'on' : '';
    b.setAttribute('aria-label', n ? `お知らせ（未読 ${n} 件）` : 'お知らせ');
    b.setAttribute('title', n ? `お知らせ: 未読 ${n} 件` : 'お知らせ');
  };
  // (a bell the page drew over is no longer listening)
  const off = ctx.inbox.onChange(() => { if (b.isConnected) draw(); else off(); });
  draw();
  return b;
}

/** the list: the news newest first, narrowed to all / not read / failures; 「すべて読んだ」 and 「消す」; a piece of news is
 *  opened with its button — read, and ctx.go(its tab, it) — with a link to GitHub's page for it when there is one. It follows
 *  the store (news that arrives while it is open). ctx: { inbox, go(tab, item), close?() } → the card */
export function inboxPanel(ctx) {
  let show = 'all';
  const bar = h('div', {}), list = h('ul', { class: 'plain' });
  const draw = () => {
    const n = ctx.inbox.unread(), xs = ctx.inbox.list().filter(PICK[show]);
    // (h leaves out what is null; replaceChildren would write it as the word)
    bar.replaceChildren(h('div', { class: 'row' }, FILTERS.map(([k, t]) => h('button', { class: show === k ? 'on' : '', 'data-filter': k, 'aria-pressed': show === k ? 'true' : 'false', onclick: () => { show = k; draw(); } }, k === 'unread' ? `${t}（${n}）` : t)),
      h('button', { id: 'inboxread', disabled: !n, onclick: () => { ctx.inbox.markRead('all'); draw(); } }, 'すべて読んだ'),
      h('button', { class: 'danger', id: 'inboxclear', onclick: () => { if (confirm('お知らせを全部消しますか')) { ctx.inbox.clear(); draw(); } } }, '消す'),
      ctx.close ? h('button', { id: 'inboxclose', onclick: ctx.close }, '閉じる') : null));
    list.replaceChildren(...(xs.length ? xs.map((x) => h('li', { 'data-inbox': x.id },
      h('div', {}, x.read ? null : [h('span', { class: 'chip' }, '新着'), ' '], h('span', { class: ['ok', 'warn', 'bad'].includes(x.level) ? x.level : '' }, x.title)),
      x.body ? h('div', { class: 'muted' }, x.body) : null, h('div', { class: 'muted' }, [KIND_WORDS[x.kind], when(x.at)].filter(Boolean).join(' · ')),
      x.tab || x.url ? h('div', { class: 'row' }, x.tab ? h('button', { onclick: () => { ctx.inbox.markRead(x.id); ctx.close?.(); ctx.go(x.tab, x); } }, '開く') : null, x.url ? link(x.url, 'GitHub') : null) : null)) : [h('li', { class: 'muted' }, EMPTY[show])]));
  };
  const card = h('div', { class: 'card', id: 'inbox' }, h('h2', {}, '🔔 お知らせ'), h('p', { class: 'muted' }, 'パネルを開いていなかった間のことは、次に開いたときにここに出ます。'), bar, list);
  // (a list the page drew over, or left for another tab, is no longer listening)
  const off = ctx.inbox.onChange(() => { if (card.isConnected) draw(); else off(); });
  draw();
  return card;
}

/** the list at the top of the page, or taken away if it is there already → true when it is shown now */
export function toggleInbox(ctx) {
  const old = $('inbox');
  if (old) { old.remove(); return false; }
  main().prepend(inboxPanel({ ...ctx, close: () => $('inbox')?.remove() }));
  return true;
}
