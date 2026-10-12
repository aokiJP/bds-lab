// mobilenav (スマホの下のメニュー): a bar fixed at the bottom of a narrow screen with the tabs used most and 「その他」, which
// opens the rest above the bar (lib/mobilenav.mjs picks them). panel/mobilenav.css shows it only at 640px wide or less and
// leaves room under the page for it. Nothing is written to GitHub (no guarded, no record): the tabs opened are kept in this
// browser only, so the bar follows what this person opens.
import { h } from './dom.mjs';
import * as N from '../lib/mobilenav.mjs';

/** ctx: { tabs ([['overview', '概要'], …] — the ones shown to this person), current (the tab now), go(key), role?, storage? }
 *  → a <nav> (aria-label; the current tab with aria-current="page") */
export function mobileNav(ctx = {}) {
  const storage = ctx.storage, current = ctx.current;
  const { main, more } = N.pick(ctx.tabs, { role: ctx.role ?? null, recent: N.loadRecent(storage) });
  const inMore = more.find((t) => t.key === current) ?? null;
  const nav = h('nav', { class: 'mobilenav', 'aria-label': 'よく使うタブ' });
  const open = (yes) => {
    list.hidden = !yes;
    moreBtn?.setAttribute('aria-expanded', yes ? 'true' : 'false');
    nav.classList?.toggle('open', yes);
  };
  const pick = (key) => {
    open(false);
    N.remember(storage, key);
    if (key !== current) ctx.go?.(key);
  };
  const tabBtn = (t) => h('button', { type: 'button', class: t.key === current ? 'on' : '', 'data-mtab': t.key,
    'aria-current': t.key === current ? 'page' : null, onclick: () => pick(t.key) }, t.label);

  const list = h('ul', { class: 'mobilenav-more', id: 'mobilenav-more', 'aria-label': 'ほかのタブ' },
    more.map((t) => h('li', {}, tabBtn(t))));
  let moreBtn = null;
  if (more.length) {
    // (the tab now is among the rest: 「その他」 says which, so the bar still shows where you are)
    moreBtn = h('button', { type: 'button', class: inMore ? 'on' : '', 'data-mtab': N.MORE.key, 'aria-haspopup': 'true',
      'aria-controls': 'mobilenav-more', 'aria-expanded': 'false', onclick: () => open(list.hidden) },
    N.MORE.label, inMore ? h('span', { class: 'mobilenav-now' }, `（今: ${inMore.label}）`) : null);
  }
  const bar = h('div', { class: 'mobilenav-bar' }, main.map((t) => (t.key === N.MORE.key ? moreBtn : tabBtn(t))));
  // (Esc closes the rest and goes back to 「その他」)
  nav.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !list.hidden) { open(false); moreBtn?.focus?.(); } });
  nav.append(...(more.length ? [list] : []), bar);
  open(false);
  return nav;
}
