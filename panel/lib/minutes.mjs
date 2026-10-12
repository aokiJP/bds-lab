// minutes: how many Actions minutes this month has used, where they went (by workflow, weekdays and weekends), where the month
// will end at that pace, and what to cut to save some (a number on each tip). Pure: no DOM, no fetch, no node:. The days are the
// browser's calendar (stats.mjs clock / dayList), the minutes are stats.mjs minutesBy's estimate (a run's time rounded up to a
// minute; GitHub's own bill may differ). A run is GitHub's own: its title is `display_title` (`name` is the workflow's name).
import { clock, startMs, minutesBy, dayList } from './stats.mjs';

const MAX_TIPS = 5;
const flowOf = (r) => String(r?.path ?? '').split('@')[0] || String(r?.name ?? '') || '?';
const baseOf = (p) => String(p).split('/').pop();
const titleOf = (r) => String(r?.display_title ?? r?.name ?? '');
const weekend = (day) => { const wd = new Date(`${day}T00:00:00Z`).getUTCDay(); return wd === 0 || wd === 6; };
const round1 = (x) => Math.round(x * 10) / 10;
const num = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));

/** the first day of the month `now` is in, in the zone (YYYY-MM-01) — what the runs are read from (pure) */
export function monthStart(now = Date.now(), tz = 'UTC') {
  const c = clock(now, tz) ?? clock(Date.now(), tz);
  return `${c.day.slice(0, 7)}-01`;
}

/** this month's minutes and where they are going (pure) → { used (minutes so far), perDay, weekdayPerDay, weekendPerDay (the
 *  minutes of an average such day so far; one with no such day yet takes the whole month's pace), monthEnd (used + the days left,
 *  each at its kind's pace), day (the day of the month), days (days in the month), left (days left), daily (the minutes of each
 *  day so far, the oldest first: [{ day, minutes }]), limit (the free minutes; null when not known), overBy (monthEnd over limit,
 *  0 when under; null when limit is not known), byWorkflow ([{ path, name, minutes, runs, share, monthEnd }], most first), tips
 *  ([{ id, text, saves (minutes by month end) }], most first) }.
 *  opts: { now (ms), tz, limit? (a number of minutes; anything else is "not known" — no number is ever assumed) } */
export function forecast(runs, opts = {}) {
  const { now = Date.now(), tz = 'UTC' } = opts ?? {};
  const lim = num(opts?.limit), limit = Number.isFinite(lim) && lim >= 0 ? lim : null;
  const c = clock(now, tz) ?? clock(Date.now(), tz), first = `${c.day.slice(0, 7)}-01`;
  const [y, m, dnow] = c.day.split('-').map(Number), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), left = days - dnow;
  const mine = (Array.isArray(runs) ? runs : []).filter((r) => { const k = r && typeof r === 'object' ? clock(startMs(r), tz) : null; return k !== null && k.day >= first && k.day <= c.day; });
  const dayOf = (r) => clock(startMs(r), tz).day;
  const list = dayList({ days: dnow, tz, now });
  const perDayMin = new Map(list.map((d) => [d, 0]));
  for (const e of minutesBy(mine, dayOf)) perDayMin.set(e.where, e.minutes);
  const daily = list.map((day) => ({ day, minutes: perDayMin.get(day) ?? 0 }));
  const used = daily.reduce((a, d) => a + d.minutes, 0);
  const perDay = used / dnow;
  const kind = (end) => { const ds = daily.filter((d) => weekend(d.day) === end); return ds.length ? ds.reduce((a, d) => a + d.minutes, 0) / ds.length : perDay; };
  const weekdayPerDay = kind(false), weekendPerDay = kind(true);
  let more = 0, restWeekends = 0;
  for (let i = 1; i <= left; i++) { const day = new Date(Date.UTC(y, m - 1, dnow + i)).toISOString().slice(0, 10); if (weekend(day)) { more += weekendPerDay; restWeekends++; } else more += weekdayPerDay; }
  const monthEnd = Math.round(used + more);
  const share = (mins) => (used ? mins / used : 0);
  // (a workflow's own month end: its share of the pace carries on)
  const wf = minutesBy(mine, flowOf).map((e) => ({ path: e.where, name: baseOf(e.where), minutes: e.minutes, runs: e.runs, share: share(e.minutes), monthEnd: Math.round(used ? e.minutes * monthEnd / used : 0) }));

  const tips = [];
  const weeksLeft = left / 7;
  // verify's [bds] runs (the real server): fewer a week
  const bds = mine.filter((r) => flowOf(r).endsWith('verify.yml') && titleOf(r).includes('[bds]'));
  if (bds.length) {
    const mins = minutesBy(bds, () => 'x')[0]?.minutes ?? 0, perRun = mins / bds.length;
    const perWeek = Math.max(1, Math.round(bds.length / (dnow / 7))), to = Math.max(1, Math.floor(perWeek / 2));
    const saves = Math.round(perRun * (perWeek - to) * weeksLeft);
    if (perWeek > to && saves > 0) tips.push({ id: 'verify-bds', saves, text: `verify の [bds] を週 ${perWeek} 回 → ${to} 回にすると、月末までに約 ${saves} 分（1 回およそ ${Math.round(perRun)} 分）` });
  }
  // the hourly scheduler: every 3 hours
  const sch = mine.filter((r) => flowOf(r).endsWith('schedule.yml'));
  if (sch.length) {
    const perDaySch = sch.length / dnow;
    if (perDaySch >= 12) {
      const mins = minutesBy(sch, () => 'x')[0]?.minutes ?? 0, perRunS = mins / sch.length;
      const saves = Math.round(perRunS * perDaySch * (2 / 3) * left);
      if (saves > 0) tips.push({ id: 'schedule-hourly', saves, text: `schedule の毎時を 3 時間ごとにすると、月末までに約 ${saves} 分（今は 1 日 ${round1(perDaySch)} 回）` });
    }
  }
  // weekends that cost as much as weekdays: pause them
  if (restWeekends && weekendPerDay >= 1 && weekendPerDay >= weekdayPerDay * 0.8) {
    const saves = Math.round(weekendPerDay * restWeekends);
    tips.push({ id: 'weekend', saves, text: `土日の実行を止めると、月末までに約 ${saves} 分（土日は 1 日 ${Math.round(weekendPerDay)} 分ずつ使っています）` });
  }
  // the biggest workflow: half the runs
  const big = wf.find((x) => x.share >= 0.4 && x.runs >= 10);
  if (big && left) {
    const saves = Math.round(big.monthEnd * 0.5 - big.minutes * 0.5);
    if (saves > 0) tips.push({ id: `big-${big.name}`, saves, text: `${big.name} がいちばん多く（全体の ${Math.round(big.share * 100)}%）、回数を半分にすると月末までに約 ${saves} 分` });
  }
  tips.sort((a, b) => b.saves - a.saves);
  return { used, perDay: round1(perDay), weekdayPerDay: round1(weekdayPerDay), weekendPerDay: round1(weekendPerDay), monthEnd, day: dnow, days, left, daily,
    limit, overBy: limit === null ? null : Math.max(0, monthEnd - limit), byWorkflow: wf, tips: tips.slice(0, MAX_TIPS) };
}
