// testhist (the 試験の履歴 card): each unit's tests day by day — a small SVG bar row per unit (✓ passed above, ✗ failed below, each
// with its own shape, not only a colour) and, under it, the same numbers as a table. Reads unit.yml's runs through ctx.api.runs.
// Drawn with attributes only (no style attribute: the page's CSP allows none). Nothing is written to GitHub.
import { h, failView } from './dom.mjs';
import * as T from '../lib/testhist.mjs';
import { readRuns } from './stats.mjs';
import { localZone } from '../lib/stats.mjs';

const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) e.setAttribute(k, String(v));
  for (const c of kids.flat()) if (c !== null && c !== undefined) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const BAR = 6, GAP = 1, HALF = 12;

/** one unit's bars: passed days go up (blue, a filled bar with ✓ in the words), failed days go down (red, an open bar), a middle line */
export function bars(u) {
  const w = u.days.length * (BAR + GAP), most = Math.max(1, ...u.days.map((d) => Math.max(d.pass, d.fail)));
  const svg = s('svg', { width: w, height: HALF * 2 + 2, viewBox: `0 0 ${w} ${HALF * 2 + 2}`, role: 'img', 'aria-label': `${u.unit}: ✓${u.pass} ✗${u.fail}` });
  svg.append(s('line', { x1: 0, y1: HALF + 1, x2: w, y2: HALF + 1, stroke: 'var(--line)', 'stroke-width': 1 }));
  u.days.forEach((d, i) => {
    const x = i * (BAR + GAP), title = `${d.date} ✓${d.pass} ✗${d.fail}`;
    if (d.pass) { const hh = Math.max(2, Math.round((d.pass / most) * HALF)); svg.append(s('rect', { x, y: HALF - hh, width: BAR, height: hh, fill: 'var(--accent)' }, s('title', {}, title))); }
    if (d.fail) { const hh = Math.max(2, Math.round((d.fail / most) * HALF)); svg.append(s('rect', { x: x + 0.5, y: HALF + 2, width: BAR - 1, height: hh, fill: 'none', stroke: 'var(--bad)', 'stroke-width': 1.5 }, s('title', {}, title))); }
  });
  return svg;
}

/** the card: ctx = { api, lab: { slug }, now? } → an element (a failure: failView with 「もう一度」) */
export function testHistCard(ctx, { days = 30 } = {}) {
  const box = h('section', { class: 'card', id: 'testhist' }, h('h3', {}, '📈 試験の履歴'), h('p', { class: 'muted' }, '読み込み中…'));
  const draw = async () => {
    try {
      // (the days shown, every page of them — not the newest 100, which a busy lab fills before 30 days; and the last pass before
      // them is looked for in what was read)
      const now = ctx.now ?? Date.now(), tz = ctx.tz ?? localZone();
      const runs = await readRuns(ctx.api, ctx.lab.slug, { workflow: 'unit.yml', since: new Date(now - (days + 1) * T.DAY).toISOString().slice(0, 10) });
      const r = T.history(runs, { days, now, tz });
      const head = h('h3', {}, '📈 試験の履歴');
      if (!r.units.length) { box.replaceChildren(head, h('p', { class: 'muted' }, `この ${r.days} 日は、ユニットの試験（test・go）の実行がまだありません。ユニットの「試験」を押すと、ここに出ます。`)); return; }
      box.replaceChildren(head, h('p', { class: 'muted' }, `ここ ${r.days} 日の、ユニットごとの試験。上向きの青い棒 ✓ は通った回、下向きの赤い枠 ✗ は落ちた回です。`),
        ...r.units.map((u) => h('div', { class: 'row', 'data-unit': u.unit }, h('strong', {}, u.unit), ' ', bars(u), ' ',
          h('span', {}, `通る割合 ${pct(u.rate)}`, u.streak ? `・連続で通った ${u.streak} 回` : '', u.fail && !u.streak ? '・いま落ちています ✗' : ''))),
        h('table', { class: 'plain' }, h('thead', {}, h('tr', {}, ['ユニット', '✓ 通った', '✗ 落ちた', '通る割合', '最後に通った日'].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.units.map((u) => h('tr', {}, h('td', {}, u.unit), h('td', {}, u.pass), h('td', {}, u.fail), h('td', {}, pct(u.rate)), h('td', {}, u.lastPass ?? `この ${r.days} 日にはありません`))))));
    } catch (e) { box.replaceChildren(h('h3', {}, '📈 試験の履歴'), failView(e, () => { box.replaceChildren(h('p', { class: 'muted' }, '読み込み中…')); draw(); })); }
  };
  draw();
  return box;
}
