// stats (the 「統計」 tab): the lab's runs — up to 300, read 100 at a time — and each lender's host.yml runs, as charts and, under
// each, the same numbers as a table (「数字で見る」). The charts are drawn with a few small SVG tools of this file's own
// (document.createElementNS: no library, nothing parsed as HTML — every word is text) in the panel's own colours, its CSS
// variables, so light and dark alike: passed is --accent and failed --bad (blue and red stay apart for colour-blind eyes, which
// the green --ok and the red --bad do not), the rest a wash of --muted; the heat map is one hue (--accent), darker where there
// are more; text is --fg and --muted, hairlines --line. Colour is never the only way to tell: the legend names each with its
// mark (✅ ❌ ➖), the stack always runs in the same order, a readout (pointer, touch or the arrow keys) gives the numbers, and
// the table twin has them all. Styles go through the CSSOM (the page's CSP allows no style attribute).
import { h, act, link } from './dom.mjs';
import * as S from '../lib/stats.mjs';
import * as M from '../lib/model.mjs';

// (the SVG namespace: a name, not an address the page reaches — written in parts, because tests/panel-offline.mjs reads every
// http(s):// in a panel file as an address and allows GitHub's alone)
const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const C = { ok: 'var(--accent)', bad: 'var(--bad)', other: 'var(--muted)', text: 'var(--fg)', quiet: 'var(--muted)', line: 'var(--line)', card: 'var(--card)', empty: 'var(--chip)' };
const WASH = '0.45', LEVELS = [0, 0.3, 0.5, 0.75, 1], WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];
/** the periods to choose from (days) */
export const RANGES = [7, 30, 90];
export const PER_PAGE = 100, MAX_PAGES = 3, MAX_HOSTS = 20;
// (what was read, kept a minute per client and lab: going to another tab and back does not read it all again)
const MEMO = new WeakMap(), TTL = 60_000;

// ---- reading ----
/** a repository's runs, the newest first, up to MAX_PAGES × PER_PAGE (read 100 at a time; a short page ends it): the lab's
 *  (all workflows) or one workflow's (`workflow: 'host.yml'`); since: 'YYYY-MM-DD', only runs created from then on */
export async function readRuns(api, slug, { workflow = '', since = '' } = {}) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = `per_page=${PER_PAGE}&page=${page}${since ? `&created=${encodeURIComponent(`>=${since}`)}` : ''}`;
    const rs = (await api.call('GET', `/repos/${slug}/actions/${workflow ? `workflows/${encodeURIComponent(workflow)}/` : ''}runs?${q}`))?.workflow_runs ?? [];
    out.push(...rs);
    if (rs.length < PER_PAGE) break;
  }
  return out;
}

// ---- the small SVG tools ----
/** an SVG element: attributes as attributes, `style` through the CSSOM, text as text */
const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};
const r1 = (x) => Math.round(x * 10) / 10;
const crisp = (y) => Math.round(y) + 0.5;
const mmdd = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const weekdayOf = (day) => WEEK_JA[new Date(`${day}T00:00:00Z`).getUTCDay()];
const pct = (x) => `${Math.round(x * 100)}%`;
const text = (x, y, label, anchor = 'middle', fill = C.quiet, halo = false) => s('text', { x: r1(x), y: r1(y), 'text-anchor': anchor, style: { fill, fontSize: '11px', ...(halo ? { stroke: C.card, strokeWidth: '3px', strokeLinejoin: 'round', paintOrder: 'stroke' } : {}) } }, label);
const hairline = (x1, y1, x2, y2) => s('line', { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), 'stroke-width': 1, 'shape-rendering': 'crispEdges', style: { stroke: C.line } });
/** a column with its top corners rounded (4 px at most) and its foot square, for a bar's data end */
const capped = (x, y, w, hgt, r) => (r < 1 ? s('rect', { x: r1(x), y: r1(y), width: r1(w), height: r1(hgt) })
  : s('path', { d: `M${r1(x)} ${r1(y + hgt)}V${r1(y + r)}Q${r1(x)} ${r1(y)} ${r1(x + r)} ${r1(y)}H${r1(x + w - r)}Q${r1(x + w)} ${r1(y)} ${r1(x + w)} ${r1(y + r)}V${r1(y + hgt)}Z` }));
const dot = (cx, cy, fill) => s('circle', { cx: r1(cx), cy: r1(cy), r: 4, style: { fill, stroke: C.card, strokeWidth: '2px' } });
/** the marks along a day axis: the newest day and every few before it (so the labels never touch) */
function dayLabels(days, x, slot, W, R, y) {
  const every = Math.max(1, Math.ceil(52 / slot)), out = [];
  for (let i = days.length - 1; i >= 0; i -= every) out.push(text(Math.min(x(i), W - R - 12), y, mmdd(days[i].day)));
  return out;
}
const yTicks = (ticks, yOf, L, W, R, fmt = String) => ticks.flatMap((v) => [hairline(L, crisp(yOf(v)), W - R, crisp(yOf(v))), text(L - 6, yOf(v) + 4, fmt(v), 'end')]);
const LEFT_RIGHT = { ArrowLeft: -1, ArrowRight: 1 };

// ---- a chart that draws again at the width it has, with a readout ----
/** `draw(width)` → an SVG, drawn into `box` at the box's own width and again when that changes (a phone turned, a window
 *  dragged): the text keeps its size, the chart takes the room */
function fit(box, draw) {
  let w = 0;
  const go = () => {
    const n = Math.floor(box.clientWidth) > 0 ? Math.max(240, Math.floor(box.clientWidth)) : 340;
    if (n !== w) { w = n; box.replaceChildren(draw(n)); }
  };
  go();
  if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => { if (box.isConnected === false) ro.disconnect(); else go(); }); ro.observe(box); }
}
/** the readout of a chart: the numbers of the column / cell under the pointer (or touch) or chosen with the arrow keys, every
 *  series at once, values first. c: { svg, hit, n, first? (where the keys start: the newest), W, x(i), y(i), at(px, py) → i,
 *  info(i) → { title, rows: [[colour, label, value]] }, mark(i), keys: { key: step } } */
function readout(c, tip) {
  let at = -1;
  const hide = () => { at = -1; tip.style.display = 'none'; c.mark(-1); };
  const show = (i) => {
    if (!(i >= 0 && i < c.n)) return hide();
    at = i;
    const info = c.info(i);
    // (a short stroke of the series' colour, not a box)
    tip.replaceChildren(h('div', { style: { fontWeight: '600', marginBottom: '2px' } }, info.title), ...info.rows.map(([colour, label, value]) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      h('span', { style: { width: '12px', height: '3px', borderRadius: '2px', background: colour, flex: 'none' } }), h('strong', {}, String(value)), h('span', { class: 'muted' }, label))));
    tip.style.display = 'block';
    const w = tip.offsetWidth || 150, x = c.x(i);
    Object.assign(tip.style, { left: `${Math.max(0, x + 12 + w > c.W ? x - 12 - w : x + 12)}px`, top: `${r1(c.y(i))}px` });
    c.mark(i);
  };
  const where = (e) => { const r = c.svg.getBoundingClientRect(); return c.at(e.clientX - r.left, e.clientY - r.top); };
  c.hit.addEventListener('pointermove', (e) => show(where(e)));
  c.hit.addEventListener('pointerdown', (e) => show(where(e)));
  // (a finger lifted leaves the numbers up: the next tap moves them)
  c.hit.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hide(); });
  c.svg.addEventListener('focus', () => show(at >= 0 ? at : c.first ?? c.n - 1));
  c.svg.addEventListener('blur', hide);
  // (a step to a place that is there; at the edge, the place stays)
  const next = (i, step) => (i + step >= 0 && i + step < c.n ? i + step : i);
  c.svg.addEventListener('keydown', (e) => {
    if (!Object.hasOwn(c.keys, e.key)) return;
    e.preventDefault();
    show(next(at < 0 ? c.first ?? c.n - 1 : at, c.keys[e.key]));
  });
}
/** a chart box: made now, drawn by .start() once it is on the page (it needs its width) */
function chartBox(make) {
  const holder = h('div', {}), tip = h('div', { role: 'status', style: { display: 'none', position: 'absolute', pointerEvents: 'none', zIndex: '2', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px', padding: '4px 8px', fontSize: '12px' } });
  return { box: h('div', { style: { position: 'relative' } }, holder, tip), start: () => fit(holder, (W) => { const c = make(W); tip.style.display = 'none'; readout(c, tip); return c.svg; }) };
}
const svgOf = (W, H, label, ...kids) => s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0, 'aria-label': `${label}（矢印キーで日を選べます。数字は下の「数字で見る」にも）`, style: { display: 'block' } }, ...kids);
const overlay = (x, y, w, hgt) => s('rect', { x, y, width: w, height: hgt, fill: 'transparent', style: { touchAction: 'pan-y' } });

// ---- the charts ----
/** the runs started each day, stacked: failed at the foot, then passed, then the rest — 2 px of surface between the pieces */
function barsChart(days, W) {
  const n = days.length, ticks = S.niceTicks(Math.max(0, ...days.map((d) => d.count))), yMax = ticks.at(-1);
  const L = 38, R = 6, T = 16, ph = 132, B = 22, H = T + ph + B, pw = Math.max(40, W - L - R), slot = pw / Math.max(1, n);
  const y = (v) => T + ph * (1 - v / yMax), x = (i) => L + (i + 0.5) * slot, gap = slot >= 6 ? 2 : 1, bw = Math.max(1, Math.min(24, slot - gap));
  const band = s('rect', { y: T, width: r1(slot), height: ph, rx: 3, style: { fill: C.empty, display: 'none' } });
  const bars = days.flatMap((d, i) => {
    let acc = 0;
    const parts = [['bad', C.bad, '1'], ['ok', C.ok, '1'], ['other', C.other, WASH]].filter(([k]) => d[k] > 0).map(([k, fill, op]) => { const p = { k, fill, op, y1: y(acc + d[k]), y0: y(acc) }; acc += d[k]; return p; });
    return parts.map((p, j) => {
      const foot = p.y0 - (j ? 2 : 0), hgt = Math.max(1, foot - p.y1), yTop = foot - hgt, e = j === parts.length - 1 ? capped(x(i) - bw / 2, yTop, bw, hgt, Math.min(4, bw / 2, hgt)) : s('rect', { x: r1(x(i) - bw / 2), y: r1(yTop), width: r1(bw), height: r1(hgt) });
      Object.assign(e.style, { fill: p.fill, fillOpacity: p.op });
      return e;
    });
  });
  // (the busiest day, its total at the top of the bar: the one number written on the chart)
  const peak = days.reduce((b, d, i) => (d.count > days[b]?.count ? i : b), 0), busiest = days[peak];
  const label = busiest?.count > 0 ? text(Math.min(Math.max(x(peak), L + 8), W - R - 8), y(busiest.count) - 4, String(busiest.count), 'middle', C.text) : null;
  const hit = overlay(L, T, pw, ph + B);
  const total = days.reduce((a, d) => a + d.count, 0);
  return {
    svg: svgOf(W, H, `日ごとの実行の数: ${n} 日で ${total} 件`, band, yTicks(ticks, y, L, W, R), bars, label, dayLabels(days, x, slot, W, R, H - 6), hit),
    hit, n, W, x, y: () => T,
    at: (px) => Math.floor((px - L) / slot),
    info: (i) => { const d = days[i]; return { title: `${mmdd(d.day)}（${weekdayOf(d.day)}）　計 ${d.count} 件`, rows: [[C.bad, '❌ 落ちた', d.bad], [C.ok, '✅ 通った', d.ok], [C.other, '➖ そのほか', d.other]] }; },
    mark: (i) => { if (i < 0) { band.style.display = 'none'; return; } band.setAttribute('x', r1(L + i * slot)); band.style.display = ''; },
    keys: LEFT_RIGHT,
  };
}
/** the share that passed each day, a line (a day with none passed or failed breaks it; the last day carries its value) */
function rateChart(days, W) {
  const n = days.length, L = 38, R = 6, T = 16, ph = 84, B = 22, H = T + ph + B, pw = Math.max(40, W - L - R), slot = pw / Math.max(1, n);
  const y = (v) => T + ph * (1 - v), x = (i) => L + (i + 0.5) * slot, runs = S.stretches(days.map((d) => d.rate));
  const lines = runs.map((r) => (r.length > 1 ? s('path', { d: S.pathOf(r.map(({ i, v }) => [x(i), y(v)])), fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', style: { stroke: C.ok } }) : dot(x(r[0].i), y(r[0].v), C.ok)));
  const end = runs.at(-1)?.at(-1);
  const endMarks = end ? [dot(x(end.i), y(end.v), C.ok), text(x(end.i) - 9, y(end.v) + 4, pct(end.v), 'end', C.text, true)] : [];
  const cross = hairline(0, T, 0, T + ph), ring = dot(0, 0, C.ok);
  for (const e of [cross, ring]) e.style.display = 'none';
  const hit = overlay(L, T, pw, ph + B);
  return {
    svg: svgOf(W, H, `日ごとの通った割合: ${runs.length ? `いちばん新しい値 ${pct(end.v)}` : '値のある日がありません'}`, yTicks([0, 0.5, 1], y, L, W, R, pct), dayLabels(days, x, slot, W, R, H - 6), lines, endMarks, cross, ring, hit),
    hit, n, W, x, y: () => T,
    at: (px) => Math.floor((px - L) / slot),
    info: (i) => { const d = days[i]; return { title: `${mmdd(d.day)}（${weekdayOf(d.day)}）`, rows: [[C.ok, '通った割合', d.rate === null ? '—' : pct(d.rate)], [C.ok, '✅ 通った', d.ok], [C.bad, '❌ 落ちた', d.bad]] }; },
    mark: (i) => {
      const d = days[i], on = i >= 0;
      cross.style.display = on ? '' : 'none';
      if (on) { for (const a of ['x1', 'x2']) cross.setAttribute(a, crisp(x(i))); ring.setAttribute('cx', r1(x(i))); ring.setAttribute('cy', r1(d.rate === null ? 0 : y(d.rate))); }
      ring.style.display = on && d.rate !== null ? '' : 'none';
    },
    keys: LEFT_RIGHT,
  };
}
/** the week by the hour: 7 rows × 24 cells, one hue, darker for more — 2 px of surface between the cells */
function heatChart(grid, W) {
  const LW = 22, T = 16, pw = W - LW - 4, cw = pw / 24, ch = Math.max(14, Math.min(22, cw)), H = T + 7 * ch + 4, max = Math.max(0, ...grid.flat());
  const cells = grid.flatMap((row, wd) => row.map((v, hr) => s('rect', { x: r1(LW + hr * cw + 1), y: r1(T + wd * ch + 1), width: r1(cw - 2), height: r1(ch - 2), rx: 2, style: { fill: v ? C.ok : C.empty, fillOpacity: v ? String(LEVELS[S.heatLevel(v, max)]) : '1' } })));
  const ring = s('rect', { width: r1(cw), height: r1(ch), rx: 3, fill: 'none', 'stroke-width': 2, style: { stroke: C.text, display: 'none' } });
  const hit = overlay(LW, T, pw, 7 * ch);
  const hours = Array.from({ length: 8 }, (_, k) => text(LW + (k * 3 + 0.5) * cw, 11, String(k * 3))), weekdays = WEEK_JA.map((d, wd) => text(LW - 5, T + wd * ch + ch / 2 + 4, d, 'end'));
  return {
    svg: svgOf(W, H, `曜日と時間ごとに始まった実行: いちばん多い所で ${max} 件`, hours, weekdays, cells, ring, hit),
    hit, n: 168, first: 0, W, x: (i) => LW + ((i % 24) + 0.5) * cw, y: (i) => T + Math.floor(i / 24) * ch - 4,
    at: (px, py) => { const c = Math.floor((px - LW) / cw), r = Math.floor((py - T) / ch); return c >= 0 && c < 24 && r >= 0 && r < 7 ? r * 24 + c : -1; },
    info: (i) => ({ title: `${WEEK_JA[Math.floor(i / 24)]}曜日 ${i % 24} 時台`, rows: [[C.ok, '始まった実行', grid[Math.floor(i / 24)][i % 24]]] }),
    mark: (i) => { if (i < 0) { ring.style.display = 'none'; return; } ring.setAttribute('x', r1(LW + (i % 24) * cw)); ring.setAttribute('y', r1(T + Math.floor(i / 24) * ch)); ring.style.display = ''; },
    keys: { ...LEFT_RIGHT, ArrowUp: -24, ArrowDown: 24 },
  };
}
/** a workflow's recent times as a small line (the oldest at the left); the last run is a dot, red when it failed */
function spark(recent) {
  if (!recent.length) return h('span', { class: 'muted' }, '—');
  const W = 110, H = 28, pts = S.sparkPoints(recent.map((x) => x.ms), W, H, 6), [ex, ey] = pts.at(-1);
  const say = `直近 ${recent.length} 回のかかった時間（古い順）: ${recent.map((x) => `${M.fmtMs(x.ms)}${x.kind === 'bad' ? '（落ちた）' : ''}`).join('、')}`;
  return s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': say, style: { display: 'block' } }, s('title', {}, say),
    pts.length > 1 ? s('path', { d: S.pathOf(pts), fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', style: { stroke: C.quiet } }) : null, dot(ex, ey, recent.at(-1).kind === 'bad' ? C.bad : C.ok));
}

// ---- the page ----
const legend = (items) => h('div', { class: 'row', style: { gap: '14px', fontSize: '13px' } }, items.map(([colour, label, op]) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
  h('span', { style: { width: '10px', height: '10px', borderRadius: '2px', background: colour, opacity: op ?? '1', flex: 'none' } }), label)));
/** the numbers of a chart as a table, closed until asked for */
const twin = (what, head, rows) => h('details', {}, h('summary', {}, `📋 数字で見る（${what}）`),
  h('table', { style: { maxHeight: '320px', overflowY: 'auto' } }, h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
const section = (title, say, ...kids) => h('div', { class: 'card' }, h('h2', {}, title), h('p', { class: 'muted' }, say), ...kids);
const tile = (label, value) => h('div', { style: { flex: '1 1 140px', background: 'var(--chip)', borderRadius: '10px', padding: '8px 10px' } }, h('div', { class: 'muted', style: { fontSize: '12px' } }, label), h('div', { style: { fontSize: '22px', fontWeight: '600' } }, value));
const dash = (x, f = String) => (x === null || x === undefined ? '—' : f(x));

/** the 「統計」 tab. ctx: { api (call(method, path)), lab: { slug }, hosts (as panel.js reads them: [{ slug, repo, error }] — those it
 *  could read, up to 20, have their host.yml runs read), tz? (IANA; default this browser's), find(name)? (the runs tab narrowed to
 *  a workflow's name: a button on each workflow and flake), now? (ms: tests only) } → a promise of what was read
 *  ({ at, since, lab: [runs], hosts: [{ slug, url, runs (null: not readable) }] }) */
export function statsTab(body, ctx) {
  const { api, lab } = ctx, tz = ctx.tz ?? S.localZone(), hosts = (ctx.hosts ?? []).filter((x) => x?.repo && !x.error).slice(0, MAX_HOSTS);
  let days = 30, data = null;
  const out = h('div', {}, h('p', { class: 'muted' }, '実行を読んでいます…'));
  const picks = RANGES.map((d) => [d, h('button', { 'data-days': d, class: d === days ? 'on' : '', 'aria-pressed': d === days ? 'true' : 'false', onclick: () => { days = d; for (const [k, b] of picks) { b.className = k === days ? 'on' : ''; b.setAttribute('aria-pressed', k === days ? 'true' : 'false'); } if (data) draw(); } }, `${d} 日`)]);
  // (one row above everything it narrows)
  body.append(h('div', { class: 'card' }, h('h2', {}, `統計（${lab.slug}）`),
    h('p', { class: 'muted' }, `ラボの実行（新しい順に ${MAX_PAGES * PER_PAGE} 件まで）と、貸し手の host.yml の実行から。日と時間は ${tz} の暦で数えます。`),
    h('div', { class: 'row', role: 'group', 'aria-label': '期間' }, picks.map(([, b]) => b), h('button', { onclick: () => load(true) }, '読み直す'))), out);

  const draw = () => {
    const opts = { days, tz, now: data.at }, mine = S.inWindow(data.lab, opts), rows = S.byDay(mine, opts), later = [];
    const sum = (k) => rows.reduce((a, d) => a + d[k], 0), ok = sum('ok'), bad = sum('bad'), ms = sum('ms');
    const cards = [];
    // (the newest 300 only: said when they do not reach back through the period)
    const oldest = data.lab.length >= MAX_PAGES * PER_PAGE ? S.clock(Math.min(...data.lab.map(S.startMs)), tz)?.day : null;
    cards.push(h('div', { class: 'card' }, h('h2', {}, `この ${days} 日`), oldest && oldest > rows[0].day ? h('p', { class: 'warn' }, `読めたのは新しい ${data.lab.length} 件（${oldest} から）だけです: ${days} 日の全部ではありません`) : null,
      h('div', { class: 'row', style: { alignItems: 'stretch' } }, tile('始まった実行', String(mine.length)), tile('通った割合', ok + bad ? pct(ok / (ok + bad)) : '—'), tile('落ちた', String(bad)), tile('かかった時間', ms ? M.fmtMs(ms) : '—'))));
    if (!mine.length) cards.push(h('div', { class: 'card' }, h('p', { class: 'muted' }, `この ${days} 日に始まった実行はありません`)));
    else {
      const bars = chartBox((W) => barsChart(rows, W)), rate = chartBox((W) => rateChart(rows, W)), grid = S.heat(mine, tz), heatBox = chartBox((W) => heatChart(grid, W));
      later.push(bars.start, rate.start, heatBox.start);
      const dayRows = [...rows].reverse();
      cards.push(
        section('日ごとの実行', 'その日に始まった実行の数。積み上げは下から ❌ 落ちた・✅ 通った・➖ そのほか（止めた・飛ばした・動いている）。',
          legend([[C.bad, '❌ 落ちた'], [C.ok, '✅ 通った'], [C.other, '➖ そのほか', WASH]]), bars.box,
          twin('日ごと', ['日', '始まった', '✅ 通った', '❌ 落ちた', '➖ そのほか', '通った割合', 'かかった時間'], dayRows.map((d) => [`${d.day}（${weekdayOf(d.day)}）`, d.count, d.ok, d.bad, d.other, dash(d.rate, pct), d.ms ? M.fmtMs(d.ms) : '—']))),
        section('通った割合', 'その日に始まった実行のうち、終わったものの中で通った割合。通った・落ちたがない日は線を切ります。', rate.box,
          twin('日ごと', ['日', '通った割合', '✅ 通った', '❌ 落ちた'], dayRows.map((d) => [`${d.day}（${weekdayOf(d.day)}）`, dash(d.rate, pct), d.ok, d.bad]))));
      const wf = S.byWorkflow(mine), find = (name) => (ctx.find ? h('button', { class: 'linkish', onclick: () => ctx.find(name) }, name) : name);
      cards.push(section('ワークフローごと', '始まった回数・通った割合・かかる時間（中央値）。線は直近の実行のかかった時間（右が新しい）です。',
        // (the small line under each name: four columns fit a phone)
        h('table', { id: 'statswf', style: { whiteSpace: 'nowrap' } }, h('thead', {}, h('tr', {}, ['ワークフローと推移', '回数', '通った', '時間'].map((t) => h('th', {}, t)))),
          h('tbody', {}, wf.map((x) => h('tr', { 'data-wf': x.path }, h('td', {}, h('div', {}, x.last === 'bad' ? '❌ ' : x.last === 'ok' ? '✅ ' : '➖ ', find(x.name)), spark(x.recent)), h('td', {}, String(x.runs)),
            h('td', {}, x.rate === null ? '—' : [pct(x.rate), h('div', { class: 'muted' }, `${x.ok}/${x.ok + x.bad}`)]), h('td', {}, dash(x.ms, M.fmtMs))))))));
      const fl = S.flaky(mine);
      cards.push(section('通ったり落ちたりするもの', '同じワークフローの同じ枝で、通る・落ちるが 3 回以上入れ替わっているもの。コードを変えていないのに結果が変わる試験の疑いです。',
        fl.length ? h('ul', { class: 'plain', id: 'statsflaky' }, fl.map((x) => h('li', { class: 'row', 'data-flaky': x.path }, h('span', { class: 'grow' }, '⚠️ ', find(x.name), ' ', h('span', { class: 'chip' }, x.branch || '—'),
          h('div', { class: 'muted' }, `${x.runs} 回のうち ✅ ${x.ok}・❌ ${x.bad}・入れ替わり ${x.flips} 回${x.retried ? `・やり直し ${x.retried} 回` : ''}`))))) : h('p', { class: 'ok' }, '✅ 入れ替わっているものはありません')));
      cards.push(section('いつ始まるか', `曜日と時間ごとに始まった実行の数（${tz}）。濃いほど多い。`,
        h('div', { class: 'row', style: { gap: '6px', fontSize: '13px' } }, '少ない', LEVELS.map((l, k) => h('span', { style: { width: '14px', height: '14px', borderRadius: '2px', background: k ? C.ok : C.empty, opacity: k ? String(l) : '1' } })), '多い'), heatBox.box,
        twin('曜日と時間', ['', ...Array.from({ length: 24 }, (_, k) => String(k)), '計'], grid.map((row, wd) => [`${WEEK_JA[wd]}曜`, ...row.map((v) => (v ? String(v) : '·')), String(row.reduce((a, v) => a + v, 0))]))));
    }
    cards.push(minutesCard(data, opts, mine));
    out.replaceChildren(...cards);
    // (on the page now: each chart takes the width it has)
    for (const f of later) f();
  };
  /** the minutes the lab's Actions and each lender's spent in the period, an estimate (the lab and the lenders' host.yml runs) */
  const minutesCard = (d, opts, mine) => {
    const rs = [...mine.map((r) => ({ ...r, where: lab.slug })), ...d.hosts.flatMap((x) => S.inWindow(x.runs ?? [], opts).map((r) => ({ ...r, where: x.slug })))];
    const by = S.minutesBy(rs, 'where'), at = (slug) => by.find((e) => e.where === slug) ?? { where: slug, minutes: 0, runs: 0, ms: 0 };
    const list = [{ slug: lab.slug, name: `ラボ（${lab.slug}）`, url: null, ...at(lab.slug) }, ...d.hosts.map((x) => ({ slug: x.slug, name: x.slug, url: x.url, unread: x.runs === null, ...at(x.slug) }))].sort((a, b) => b.minutes - a.minutes);
    const top = Math.max(1, ...list.map((e) => e.minutes));
    return section('使った分（見積もり）', '実行の始まりから最後の更新までを分に切り上げた見積もりです（GitHub の請求そのものではありません）。ラボの分は持ち主、貸し手の分は貸し手のものです。',
      h('ul', { class: 'plain', id: 'statsminutes' }, list.map((e) => h('li', { 'data-where': e.slug },
        h('div', { class: 'row' }, h('span', { class: 'grow' }, e.url ? link(e.url, e.name) : e.name, e.unread ? h('span', { class: 'chip bad' }, '読めません') : null), h('strong', {}, `${e.minutes} 分`), h('span', { class: 'muted' }, `${e.runs} 回`)),
        // (one place alone is a number, not a bar to compare)
        list.length > 1 ? h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round((e.minutes / top) * 100)}%` } })) : null))),
      twin('場所ごと', ['場所', '終わった実行', '分（見積もり）'], list.map((e) => [e.name, e.runs, e.minutes])));
  };

  let pending = null;
  const load = (fresh = false) => (pending ??= act(async () => {
    // (the last picture stays, dimmed, while the numbers come again)
    out.style.opacity = '0.55';
    try {
      const now = ctx.now ?? Date.now(), key = [lab.slug, ...hosts.map((x) => x.slug)].join(' '), memo = MEMO.get(api) ?? new Map(), hit = memo.get(key);
      MEMO.set(api, memo);
      // (what was read a moment after now — the clock was set back — is not kept)
      if (!fresh && hit && now - hit.at >= 0 && now - hit.at < TTL) data = hit;
      else {
        const since = new Date(now - (Math.max(...RANGES) + 1) * 86_400_000).toISOString().slice(0, 10);
        const [mine, ...theirs] = await Promise.all([readRuns(api, lab.slug, { since }), ...hosts.map((x) => readRuns(api, x.slug, { workflow: 'host.yml', since }).catch(() => null))]);
        data = { at: now, since, lab: mine, hosts: hosts.map((x, i) => ({ slug: x.slug, url: x.repo?.html_url, runs: theirs[i] })) };
        memo.set(key, data);
      }
      draw();
      return data;
    } catch (e) { out.replaceChildren(h('p', { class: 'bad' }, e.message ?? String(e))); return undefined; } finally { out.style.opacity = ''; }
  }).finally(() => { pending = null; }));
  return load();
}
