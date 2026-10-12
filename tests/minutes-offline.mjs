// the management panel's 「分の見込みと節約」 without a browser or a network: forecast in panel/lib/minutes.mjs (the month so far,
// the month's end at the pace of weekdays and weekends, by workflow, the tips with their numbers, the free minutes only when
// known — across time zones and the first and last day of a month) and the card in panel/ui/minutes.mjs on a small stand-in DOM
// and a fake GitHub (what is read, the SVG line and dotted line, the table twin, a failure with its next step).
// node tests/minutes-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const L = await imp('panel/lib/minutes.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
let nextId = 1;
const mk = (start, minutes, extra = {}) => ({ id: nextId++, name: 'verify', display_title: 'verify', path: '.github/workflows/verify.yml', status: 'completed', conclusion: 'success', created_at: start, run_started_at: start, updated_at: iso(Date.parse(start) + minutes * 60_000), ...extra });
// 2026-10-08 is a Thursday; the 1st was a Thursday too, the 3rd and 4th a weekend
const NOW = Date.parse('2026-10-08T12:30:00Z');
const WEEKDAYS = [1, 2, 5, 6, 7, 8];
const verifyRuns = () => WEEKDAYS.map((d) => mk(`2026-10-0${d}T10:00:00Z`, 10, { display_title: 'verify [bds]' }));

await t('the month so far and its end: weekdays and weekends at their own pace; nothing assumed about the free minutes (pure)', () => {
  const f = L.forecast(verifyRuns(), { now: NOW, tz: 'UTC' });
  eq([f.used, f.perDay, f.weekdayPerDay, f.weekendPerDay], [60, 7.5, 10, 0]);
  // (23 days left: 16 weekdays at 10, 7 weekend days at 0)
  eq([f.day, f.days, f.left, f.monthEnd], [8, 31, 23, 220]);
  eq([f.limit, f.overBy], [null, null], 'no limit given: not known, not 2000');
  eq(f.daily.length, 8); eq(f.daily.map((d) => d.minutes), [10, 10, 0, 0, 10, 10, 10, 10]);
  eq(f.byWorkflow.map((x) => [x.name, x.minutes, x.runs, x.monthEnd]), [['verify.yml', 60, 6, 220]]);
  for (const bad of [undefined, null, '', 'abc', -5, NaN]) eq(L.forecast([], { now: NOW, limit: bad }).limit, null, `limit ${String(bad)}`);
  const g = L.forecast(verifyRuns(), { now: NOW, tz: 'UTC', limit: 200 });
  eq([g.limit, g.overBy], [200, 20]);
  eq(L.forecast(verifyRuns(), { now: NOW, tz: 'UTC', limit: '300' }).overBy, 0, 'a number as text, and under the limit');
});

await t('tips carry numbers: verify [bds] fewer a week, the hourly scheduler every 3 hours; most saving first (pure)', () => {
  const sch = [];
  for (let d = 1; d <= 8; d++) for (let h = 0; h < 24; h++) sch.push(mk(`2026-10-0${d}T${String(h).padStart(2, '0')}:00:00Z`, 1, { name: 'schedule', display_title: 'schedule', path: '.github/workflows/schedule.yml' }));
  const f = L.forecast([...verifyRuns(), ...sch], { now: NOW, tz: 'UTC' });
  const bds = f.tips.find((x) => x.id === 'verify-bds'), hourly = f.tips.find((x) => x.id === 'schedule-hourly');
  ok(bds && /verify の \[bds\] を週 5 回 → 2 回/.test(bds.text) && bds.saves === 99 && bds.text.includes('約 99 分'), JSON.stringify(bds));
  // (24 runs a day of 1 minute: 2/3 of them, 23 days left)
  ok(hourly && hourly.saves === Math.round(24 * (2 / 3) * 23) && /毎時を 3 時間ごと/.test(hourly.text) && hourly.text.includes(`約 ${hourly.saves} 分`), JSON.stringify(hourly));
  eq(f.tips.map((x) => x.saves), [...f.tips.map((x) => x.saves)].sort((a, b) => b - a), 'most first');
  ok(f.tips.length <= 5);
  eq(L.forecast(verifyRuns().map((r) => ({ ...r, display_title: 'verify' })), { now: NOW, tz: 'UTC' }).tips.find((x) => x.id === 'verify-bds'), undefined, 'no [bds], no such tip');
});

await t('the calendar is the browser\'s: Tokyo\'s month starts nine hours early; the last day has nothing left; a run of another month is not counted (pure)', () => {
  // 2026-09-30T20:00Z is October 1st, 05:00 in Tokyo
  const runs = [mk('2026-09-30T20:00:00Z', 7), mk('2026-09-30T10:00:00Z', 50), mk('2026-10-08T12:00:00Z', 3)];
  eq(L.forecast(runs, { now: NOW, tz: 'Asia/Tokyo' }).used, 10, 'Tokyo');
  eq(L.forecast(runs, { now: NOW, tz: 'UTC' }).used, 3, 'UTC');
  eq(L.monthStart(NOW, 'Asia/Tokyo'), '2026-10-01');
  eq(L.monthStart(Date.parse('2026-09-30T20:00:00Z'), 'Asia/Tokyo'), '2026-10-01');
  eq(L.monthStart(Date.parse('2026-09-30T20:00:00Z'), 'UTC'), '2026-09-01');
  const lastDay = L.forecast([mk('2026-10-31T01:00:00Z', 4)], { now: Date.parse('2026-10-31T09:00:00Z'), tz: 'UTC' });
  eq([lastDay.left, lastDay.used, lastDay.monthEnd], [0, 4, 4]);
  const first = L.forecast([], { now: Date.parse('2026-10-01T09:00:00Z'), tz: 'UTC' });
  eq([first.used, first.monthEnd, first.perDay, first.tips, first.byWorkflow], [0, 0, 0, [], []]);
});

await t('bad input is no error: no runs, nulls, runs that ran nothing or are still going (pure)', () => {
  for (const runs of [undefined, null, 'x', [], [null, undefined, 5, {}]]) eq(L.forecast(runs, { now: NOW }).used, 0);
  eq(L.forecast([mk('2026-10-08T10:00:00Z', 5, { conclusion: 'skipped' }), mk('2026-10-08T10:00:00Z', 5, { status: 'in_progress', conclusion: null })], { now: NOW, tz: 'UTC' }).used, 0);
  eq(L.forecast([mk('2026-10-08T10:00:00Z', 0.1)], { now: NOW, tz: 'UTC' }).used, 1, 'one minute at least, as stats.mjs counts');
  eq(L.forecast([], undefined).used, 0);
});

// ---- the card on a small DOM ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag, ns = null) { super(); Object.assign(this, { tagName: tag.toUpperCase(), ns, kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    // (a disabled button is not pressed)
    click() { if (this.disabled) return Promise.resolve([]); return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createElementNS: (ns, tag) => new E(tag, ns), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
const { toast } = fakeDom();
const M = await imp('panel/ui/minutes.mjs');
const byId = (root, id) => root.all((e) => e.attrs.id === id)[0];
function fakeApi({ runs = verifyRuns(), fail = false } = {}) {
  const calls = [];
  return { calls, call: async (method, p) => {
    calls.push([method, p]);
    const bad = fakeCheck(method, p, undefined); if (bad) throw Object.assign(new Error(bad.message), { status: 422 });
    if (fail) throw Object.assign(new Error('GitHub に届きません'), { status: 502 });
    return { workflow_runs: runs };
  } };
}
const ctxOf = (api, more = {}) => ({ api, lab: { slug: 'o/lab' }, tz: 'UTC', now: NOW, ...more });

await t('the card reads only the month (from the day before the 1st) and says the numbers, the chart and the tips; no limit: "分かりません" (screen)', async () => {
  const api = fakeApi(), card = M.minutesCard(ctxOf(api));
  await card.ready;
  eq(api.calls.length, 1); ok(api.calls.every(([m]) => m === 'GET'), 'reads only');
  ok(decodeURIComponent(api.calls[0][1]).includes('created=>=2026-09-30'), api.calls[0][1]);
  ok(api.calls[0][1].startsWith('/repos/o/lab/actions/runs?'), api.calls[0][1]);
  eq([byId(card, 'minutesused').textContent, byId(card, 'minutesend').textContent], ['60 分', '約 220 分']);
  ok(byId(card, 'minuteslimit').textContent.includes('分かりません') && !/2000/.test(card.textContent), byId(card, 'minuteslimit').textContent);
  const parts = card.all((e) => e.ns).filter((e) => e.attrs['data-part']).map((e) => e.attrs['data-part']);
  ok(parts.includes('used') && parts.includes('forecast') && parts.includes('end') && !parts.includes('limit'), parts.join());
  const dotted = card.all((e) => e.attrs['data-part'] === 'forecast')[0];
  ok(dotted.attrs['stroke-dasharray'] && dotted.attrs.d.startsWith('M'), 'dotted line');
  ok(card.all((e) => e.ns).every((e) => !('style' in e.attrs) && Object.keys(e.style).length === 0), 'SVG with attributes only');
  eq(byId(card, 'minuteswf').all((e) => e.tagName === 'TR' && e.attrs['data-wf']).map((e) => e.textContent), ['verify.yml602206']);
  ok(card.all((e) => e.attrs['data-tip'] === 'verify-bds')[0].textContent.includes('週 5 回 → 2 回'));
});

await t('with a limit: under it, or over it by how much; the line is drawn (screen)', async () => {
  const over = M.minutesCard(ctxOf(fakeApi(), { limit: 200 })); await over.ready;
  ok(byId(over, 'minuteslimit').textContent.includes('約 20 分') && byId(over, 'minuteslimit').className === 'bad');
  ok(over.all((e) => e.attrs['data-part'] === 'limit').length === 1);
  const under = M.minutesCard(ctxOf(fakeApi(), { limit: 500 })); await under.ready;
  ok(byId(under, 'minuteslimit').textContent.includes('収まりそう') && byId(under, 'minuteslimit').textContent.includes('280'));
});

await t('a month with no runs is said so; a read that fails shows the words and 「読み直す」, which reads again (screen)', async () => {
  const none = M.minutesCard(ctxOf(fakeApi({ runs: [] }))); await none.ready;
  ok(none.textContent.includes('今月はまだ実行がありません') && byId(none, 'minutestips').textContent.includes('ありません'));
  const api = fakeApi({ fail: true }), card = M.minutesCard(ctxOf(api));
  await card.ready;
  ok(card.textContent.includes('GitHub に届きません'));
  const again = card.all((e) => e.tagName === 'BUTTON' && e.textContent === '読み直す')[0];
  ok(again, 'the next step'); await again.click();
  eq(api.calls.length, 2, 'read again');
  again.disabled = true; await again.click(); eq(api.calls.length, 2, 'a disabled button is not pressed');
  void toast;
});

await t('nothing secret or outside GitHub: no address in the card, only the panel\'s colour variables (screen)', async () => {
  const card = M.minutesCard(ctxOf(fakeApi(), { limit: 200 })); await card.ready;
  ok(!/https?:\/\//.test(card.textContent));
  const src = fs.readFileSync(path.join(TOP, 'panel/ui/minutes.mjs'), 'utf8') + fs.readFileSync(path.join(TOP, 'panel/lib/minutes.mjs'), 'utf8');
  ok(!/\bfetch\s*\(|localStorage|sessionStorage|document\.cookie/.test(src), 'no fetch or storage of its own');
  const colours = card.all((e) => e.ns).flatMap((e) => [e.attrs.stroke, e.attrs.fill]).filter(Boolean).filter((v) => v !== 'none');
  ok(colours.length && colours.every((v) => /^var\(--(accent|bad|muted|line)\)$/.test(v)), [...new Set(colours)].join());
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
