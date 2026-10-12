// minutes (a card on the 「統計」 tab): this month's Actions minutes so far (a line, the days added up), where the month will end
// (a dotted line and a dot), by workflow, and what to cut to save some. The runs are read from the first of the month (stats.mjs
// readMonth below, which turns the pages up to 20 × 100 runs, not stats.mjs's 3); the numbers are lib/minutes.mjs forecast. The free minutes are not assumed: ctx.limit (a number) or "分かりません".
// The chart is SVG made with createElementNS, all in attributes (the page's CSP allows no style attribute), with a table twin.
import { h, act, failView } from './dom.mjs';
import { forecast, monthStart } from '../lib/minutes.mjs';
import * as S from '../lib/stats.mjs';

// (the SVG namespace, written in parts as ui/stats.mjs does)
const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) e.setAttribute(k, String(v));
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};
const W = 320, H = 150, PAD = { l: 40, r: 10, t: 10, b: 22 };
const r1 = (x) => Math.round(x * 10) / 10;
const PER_PAGE = 100, MAX_PAGES = 20;

/** the runs created from `since` on, the newest first, page after page until a short page (at most MAX_PAGES) → { runs, cutFrom }
 *  (cutFrom: the day the reading stopped at when there were more pages than that, else null) */
async function readMonth(api, slug, since, tz) {
  const runs = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = `per_page=${PER_PAGE}&page=${page}&created=${encodeURIComponent(`>=${since}`)}`;
    const rs = (await api.call('GET', `/repos/${slug}/actions/runs?${q}`))?.workflow_runs ?? [];
    runs.push(...rs);
    if (rs.length < PER_PAGE) return { runs, cutFrom: null };
  }
  const days = runs.map((r) => S.clock(S.startMs(r), tz)?.day).filter(Boolean).sort();
  return { runs, cutFrom: days[0] ?? null };
}

/** the chart: the minutes added up day by day (a line), the rest of the month at the pace so far (dotted, ending in a dot), the
 *  free minutes (a line, when known) */
export function chart(f) {
  let sum = 0;
  const pts = f.daily.map((d, i) => [i + 1, (sum += d.minutes)]);
  const top = Math.max(1, f.monthEnd, f.limit ?? 0, f.used) * 1.05;
  const x = (day) => PAD.l + ((day - 1) / Math.max(1, f.days - 1)) * (W - PAD.l - PAD.r), y = (v) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
  const d = (list) => list.map(([a, b], i) => `${i ? 'L' : 'M'}${r1(x(a))} ${r1(y(b))}`).join('');
  const last = pts.at(-1) ?? [1, 0];
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `今月は ${f.used} 分、月末は約 ${f.monthEnd} 分の見込み` },
    s('line', { x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b, stroke: 'var(--line)', 'stroke-width': 1 }),
    s('text', { x: PAD.l - 4, y: r1(y(top / 1.05)) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, String(Math.round(top / 1.05))),
    s('text', { x: PAD.l - 4, y: H - PAD.b + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, '0'),
    s('text', { x: PAD.l, y: H - 6, 'text-anchor': 'start', 'font-size': 11, fill: 'var(--muted)' }, '1日'),
    s('text', { x: W - PAD.r, y: H - 6, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, `${f.days}日`),
    f.limit === null ? null : s('line', { x1: PAD.l, y1: r1(y(f.limit)), x2: W - PAD.r, y2: r1(y(f.limit)), stroke: 'var(--bad)', 'stroke-width': 1, 'data-part': 'limit' }),
    s('path', { d: d(pts), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'data-part': 'used' }),
    f.left ? s('path', { d: d([last, [f.days, f.monthEnd]]), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-dasharray': '4 4', 'data-part': 'forecast' }) : null,
    s('circle', { cx: r1(x(f.left ? f.days : last[0])), cy: r1(y(f.left ? f.monthEnd : last[1])), r: 4, fill: 'var(--accent)', 'data-part': 'end' }));
  return svg;
}

/** the card. ctx: { api (call), lab: { slug }, tz? (IANA; default this browser's), limit? (the free minutes, a number), now? (ms: tests
 *  only) } → an element (the card; it fills in when the month's runs have been read) */
export function minutesCard(ctx) {
  const { api, lab } = ctx, tz = ctx.tz ?? S.localZone();
  const out = h('div', {}, h('p', { class: 'muted' }, '今月の実行を読んでいます…'));
  const card = h('div', { class: 'card', id: 'minutescard' }, h('h2', {}, '⏱ 分の見込みと節約'), out);
  const load = () => act(async () => {
    const now = ctx.now ?? Date.now();
    // (the day before the 1st: the API counts days in UTC, the month is in this browser's zone)
    const since = new Date(Date.parse(`${monthStart(now, tz)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    let runs, cutFrom;
    try { ({ runs, cutFrom } = await readMonth(api, lab.slug, since, tz)); } catch (e) { out.replaceChildren(failView(e, load), h('button', { onclick: load }, '読み直す')); return; }
    const f = forecast(runs, { now, tz, limit: ctx.limit });
    const cut = cutFrom && cutFrom > monthStart(now, tz) ? cutFrom : null;
    out.replaceChildren(
      h('p', {}, `今月（${f.day} 日目）は `, h('strong', { id: 'minutesused' }, `${f.used} 分`), ' 使いました。このままだと月末は ', h('strong', { id: 'minutesend' }, `約 ${f.monthEnd} 分`), ' です。'),
      h('p', { class: 'muted' }, `1 日の平均 ${f.perDay} 分（平日 ${f.weekdayPerDay} 分・土日 ${f.weekendPerDay} 分）。実行の始まりから最後の更新までを分に切り上げた見積もりです。GitHub の請求はジョブごと・請求日ごとに数えるので、ずれることがあります。`),
      cut ? h('p', { class: 'warn', id: 'minutescut' }, `${Number(cut.slice(5, 7))}月${Number(cut.slice(8, 10))}日より前は読めていません（見込みは少なめです）。`) : null,
      f.limit === null ? h('p', { class: 'warn', id: 'minuteslimit' }, '無料の分の上限は分かりません（このパネルは決めつけません）。GitHub の「Billing」で確かめてください。')
        : f.overBy > 0 ? h('p', { class: 'bad', id: 'minuteslimit' }, `上限 ${f.limit} 分を約 ${f.overBy} 分こえる見積もりです。下の案で減らしましょう。`)
          : h('p', { class: 'ok', id: 'minuteslimit' }, `上限 ${f.limit} 分の中に収まる見積もりです（あと約 ${f.limit - f.monthEnd} 分の余り）。`),
      chart(f),
      h('p', { class: 'muted' }, '実線は今までの合計、点線は今のペースで続けた場合、赤い線は上限です。'),
      h('h3', {}, 'ワークフローごと'),
      f.byWorkflow.length ? h('table', { id: 'minuteswf' }, h('thead', {}, h('tr', {}, ['ワークフロー', '今まで（分）', '月末の見込み（分）', '回数'].map((t) => h('th', {}, t)))),
        h('tbody', {}, f.byWorkflow.map((x) => h('tr', { 'data-wf': x.path }, h('td', {}, x.name), h('td', {}, String(x.minutes)), h('td', {}, String(x.monthEnd)), h('td', {}, String(x.runs)))))) : h('p', { class: 'muted' }, '今月はまだ実行がありません'),
      h('h3', {}, '節約の案'),
      f.tips.length ? h('ul', { class: 'plain', id: 'minutestips' }, f.tips.map((t) => h('li', { 'data-tip': t.id }, t.text))) : h('p', { class: 'ok', id: 'minutestips' }, '今のところ、減らす案はありません'));
    return f;
  });
  card.ready = load();
  return card;
}
