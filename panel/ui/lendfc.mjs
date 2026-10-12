// lendfc (a card for 「貸し借り」): when each lender looks free — a small 7 × 24 heat picture (own SVG, attributes only) of
// the week, the three freest hours in words, and the minutes left this month. A lender that cannot be read is named with
// the reason. It only reads (host.yml's runs): nothing is started or written here.
import { h, failView } from './dom.mjs';
import * as L from '../lib/lendfc.mjs';
import { localZone } from '../lib/stats.mjs';

const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); for (const k of kids) e.append(k); return e; };
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const DAYS = ['日', '月', '火', '水', '木', '金', '土'], C = 9;

/** one lender's week as an <svg>: a cell a hour, greener = freer, grey = outside the lender's hours */
export function heatSvg(slug, free) {
  const W = 24 * C + 16, H = 7 * C + 12, title = s('title'), svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${slug} の一週間の空き（緑が濃いほど空いています。灰色は貸さない時間）` });
  title.append(document.createTextNode(`${slug} の一週間の空き`));
  svg.append(title);
  for (const [wd, hr, sc] of free) {
    svg.append(s('rect', { x: 16 + hr * C, y: 12 + wd * C, width: C - 1, height: C - 1, fill: sc ? '#2e7d32' : '#888888', 'fill-opacity': sc ? Math.round((0.15 + 0.85 * sc / 100) * 100) / 100 : 0.15 }));
  }
  DAYS.forEach((d, i) => svg.append(s('text', { x: 0, y: 12 + i * C + 8, 'font-size': 8, fill: 'currentColor' }, document.createTextNode(d))));
  for (const hr of [0, 6, 12, 18]) svg.append(s('text', { x: 16 + hr * C, y: 8, 'font-size': 8, fill: 'currentColor' }, document.createTextNode(String(hr))));
  return svg;
}

/** the card. ctx: { api, hosts: [{ slug, rules }], now? (ms, tests), tz? } → the element at once (「読んでいます…」), filled when read;
 *  el.ready: the promise of that reading (tests) */
export function lendForecastCard(ctx) {
  const body = h('div', { role: 'status' }, '読んでいます…');
  const el = h('div', { class: 'card lend-forecast' }, h('h3', {}, '🌙 貸し手の空き予報'), body);
  const read = async () => {
    fill(body, '読んでいます…');
    try {
      const now = ctx.now ?? Date.now(), hosts = ctx.hosts ?? [], from = new Date(now - (L.WEEKS * 7 + 1) * 86_400_000).toISOString().slice(0, 10);
      const runs = {}, rules = {};
      await Promise.all(hosts.map(async (x) => {
        rules[x.slug] = x.rules ?? null;
        // (one lender that cannot be read does not hide the others: its reason is kept)
        try { runs[x.slug] = x.rules ? await ctx.api.runs(x.slug, { workflow: 'host.yml', created: `>=${from}`, per: 100 }) : []; } catch (e) { runs[x.slug] = e instanceof Error ? e : new Error(String(e)); }
      }));
      const order = Object.fromEntries(hosts.map((x, i) => [x.slug, i]));
      const list = L.availability(runs, { now, tz: ctx.tz ?? localZone(), rules }).sort((a, b) => order[a.slug] - order[b.slug]);
      fill(body, list.length ? list.map((a) => h('div', { class: 'lend-forecast-host' },
        h('h4', {}, a.slug),
        a.reason && !a.free.length ? h('div', { class: 'muted' }, `⏸️ 予報を出せません: ${a.reason}`) : [
          heatSvg(a.slug, a.free),
          h('div', { class: 'muted' }, `時間は ${a.tz} です。今月あと ${a.left} 分ほど借りられます。`),
          a.best.length ? h('ol', {}, a.best.map((b) => h('li', {}, `${b.when}: ${b.why}`))) : h('div', { class: 'muted' }, a.reason || '空いていそうな時間は見つかりませんでした。')])) : h('p', { class: 'muted' }, 'まだ貸し手がありません。「貸し借り」で貸し手を足すと、ここに出ます。'),
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => read() }, 'もう一度読む')));
    } catch (e) {
      fill(body, failView(e, () => read()), h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => read() }, 'もう一度読む')));
    }
  };
  el.ready = read();
  return el;
}
