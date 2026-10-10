// guide (the screen of lib/guide.mjs): each tab's 「？ このタブでできること」 (open the first time a tab is seen), the beginner's
// guide card with its progress and the next step, 「やりたいこと」 (Ctrl/⌘+K: what someone wants, in their own words → the
// place for it, and the panel's words explained) and the glossary.
import { h } from './dom.mjs';
import * as G from '../lib/guide.mjs';

/** the tab's help line: open the first time this browser sees the tab, folded after */
export function helpLine(tab, storage) {
  const x = G.HELP[tab];
  if (!x) return null;
  const key = `bdslab.panel.help.${tab}`, first = !storage.getItem(key);
  storage.setItem(key, '1');
  return h('details', { class: 'help', open: first ? 'open' : null }, h('summary', {}, `？ ${x.title}でできること`), h('p', {}, x.what), x.tips.length ? h('ul', {}, x.tips.map((t) => h('li', { class: 'muted' }, t))) : null);
}

/** the guide for this role: done of total, each step a tap away, the next one first; hidden on asking (per lab and browser) */
export function guideCard({ role, facts, go, storage, labSlug }) {
  const key = `bdslab.panel.guide.hidden.${labSlug}`, g = G.guideSteps(role, facts);
  if (storage.getItem(key) && !facts.forceShow) return null;
  const pct = Math.round((g.done / Math.max(1, g.total)) * 100);
  const card = h('div', { class: 'card', id: 'guide' }, h('h2', {}, g.next ? `🧭 はじめてのガイド（${g.done}/${g.total}）` : '🎉 準備は全部できました'),
    h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })),
    g.next ? h('div', { class: 'next' }, h('p', {}, h('strong', {}, `次: ${g.next.title}`)), h('p', { class: 'muted' }, g.next.why), h('button', { class: 'primary', onclick: () => go(g.next.tab) }, `「${g.next.title}」へ`)) : h('p', { class: 'muted' }, 'これで一通り使えます。困ったら Ctrl（⌘）+K か右上の 🔎 で「やりたいこと」を入れてください。'),
    h('ol', { class: 'steps' }, g.steps.map((s) => h('li', { class: s.done ? 'ok' : '', 'data-step': s.id }, `${s.done ? '✅' : '⬜'} ${s.title}`, s.done ? null : h('button', { class: 'linkish', onclick: () => go(s.tab) }, ' 開く')))),
    h('div', { class: 'row' }, h('button', { onclick: () => { storage.setItem(key, '1'); card.remove(); } }, 'ガイドを隠す'), h('span', { class: 'muted' }, '（🔎 で「はじめて」と入れるとまた出ます）')));
  return card;
}

/** 「やりたいこと」: a box over the page — typed words → the places for them and the words explained; Enter takes the first,
 *  ↑↓ choose, Esc closes. ctx: { tabs(), may(action), go(tab, anchor) } → { open, close } */
export function palette(ctx) {
  let box = null, sel = 0, found = [];
  const close = () => { box?.remove(); box = null; };
  const choose = (x) => { close(); ctx.go(x.tab, x.anchor ?? null, x.id); };
  const open = () => {
    if (box) return box.querySelector('input').focus();
    const input = h('input', { type: 'search', placeholder: '何をしたいですか？（例: 秘密を登録したい・アドオンを作りたい・ひみつ）', 'aria-label': 'やりたいこと' });
    const list = h('ul', { class: 'plain', role: 'listbox' }), terms = h('div', {});
    const draw = () => {
      found = G.findIntents(input.value, { tabs: ctx.tabs(), may: ctx.may });
      sel = Math.min(sel, Math.max(0, found.length - 1));
      list.replaceChildren(...(found.length ? found.map((x, i) => h('li', {}, h('button', { class: i === sel ? 'on' : '', role: 'option', 'data-intent': x.id, onclick: () => choose(x) }, x.label)))
        : [h('li', { class: 'muted' }, 'まだ見つかりません: 言い方を変えてみてください（例: 「止めたい」「招く」「貸す」）')]));
      const t = G.findTerms(input.value);
      terms.replaceChildren(...(t.length ? [h('h3', {}, 'ことばの意味'), ...t.map((g) => h('p', {}, h('strong', {}, g.term), ': ', g.means))] : []));
    };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, found.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      else if (e.key === 'Enter' && !e.isComposing && found[sel]) { e.preventDefault(); choose(found[sel]); }
    });
    box = h('div', { id: 'palette', role: 'dialog', 'aria-label': 'やりたいこと', onclick: (e) => { if (e.target === box) close(); } },
      h('div', { class: 'card' }, h('h2', {}, '🔎 やりたいこと'), input, list, terms, h('p', { class: 'muted' }, 'Enter で開く・↑↓ で選ぶ・Esc で閉じる（Ctrl/⌘+K でいつでも）')));
    document.body.append(box);
    draw(); input.focus();
  };
  return { open, close, isOpen: () => Boolean(box) };
}

/** the glossary, every word the panel uses */
export const glossaryCard = () => h('div', { class: 'card', id: 'glossary' }, h('h2', {}, '📖 ことばの意味'),
  h('dl', {}, G.GLOSSARY.flatMap((g) => [h('dt', {}, g.term), h('dd', { class: 'muted' }, g.means)])));
