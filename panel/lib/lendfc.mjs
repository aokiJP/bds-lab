// lendfc (the forecast of lenders' free time, pure): from a lender's past runs of host.yml and its .lab-host.json (hours,
// minutesPerMonth — read as model.mjs reads them), which hours of the week look free and how many minutes are left this
// month. A slot is free when it is inside the lender's hours; the more runs started or went on there in the weeks looked
// at, the lower its score. Nothing is read or written here.
import * as M from './model.mjs';
import { clock, startMs } from './stats.mjs';

export const WEEKS = 4;
const HOUR = 3_600_000, WD = ['日', '月', '火', '水', '木', '金', '土'];
const toMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : Number(v));
const slotOf = (ms, tz) => { const c = clock(ms, tz); return c && c.wd >= 0 ? c.wd * 24 + c.hour : -1; };

/** a slot (weekday 0 = Sunday, hour) in words: 「月曜 9 時〜10 時」 */
export const whenText = (wd, hour) => `${WD[wd]}曜 ${hour} 時〜${hour + 1} 時`;

/** runsByHost: { slug: runs[] (host.yml's, GitHub's) | Error }, opts: { now (ms/Date/ISO), tz (the zone the grid is in; the
 *  lender's own when it has one), rules: { slug: rules (model.checkRules(..).rules) | null } } →
 *  [{ slug, tz, free: [[weekday, hour, score 0–100]] (168 slots, Sunday first), best: [{ when, why }] (up to 3), left (minutes
 *  until the lender's 80% stop; null when unknown), reason (why nothing could be said: '' when it could) }] */
export function availability(runsByHost = {}, opts = {}) {
  const now = Number.isFinite(toMs(opts.now)) ? toMs(opts.now) : Date.now(), rulesOf = opts.rules ?? {};
  return Object.keys(runsByHost ?? {}).map((slug) => {
    const runs = runsByHost[slug], rules = rulesOf[slug] ?? null, out = { slug, tz: opts.tz ?? 'UTC', free: [], best: [], left: null, reason: '' };
    if (!rules) return { ...out, reason: '.lab-host.json がないか正しくありません: 貸し手に「貸し借り」で条件を保存してもらってください' };
    if (!Array.isArray(runs)) return { ...out, reason: `実行を読めませんでした（${runs?.message ?? '理由は分かりません'}）` };
    const tz = opts.tz ?? rules.timezone ?? 'UTC';
    // (the minutes: this month in the lender's own zone, as 「貸し借り」 counts them)
    const used = M.monthMinutes(runs, M.monthOf(now, rules.timezone ?? 'UTC'), rules.timezone ?? 'UTC');
    const left = M.hostNow(rules, used, new Date(now)).remaining;
    // (how busy each slot of the week was: a run counts in every hour it went on, in the zone of the grid)
    const busy = Array(168).fill(0), from = now - WEEKS * 7 * 86_400_000;
    for (const r of runs) {
      const a = startMs(r);
      if (!Number.isFinite(a) || a < from || a > now) continue;
      const e = Date.parse(r.updated_at), b = r.status === 'completed' && Number.isFinite(e) && e > a ? e : a;
      for (let t = Math.floor(a / HOUR) * HOUR; t <= b; t += HOUR) { const s = slotOf(Math.max(t, a), tz); if (s >= 0) busy[s]++; }
    }
    // (inside the lender's hours: each slot of the coming week, at its half hour)
    const open = Array(168).fill(null), first = Array(168).fill(0);
    for (let t = Math.floor(now / HOUR) * HOUR + HOUR / 2, i = 0; i < 24 * 8; i++, t += HOUR) {
      const s = slotOf(t, tz);
      if (s >= 0 && open[s] === null) { open[s] = M.within(rules.hours, rules.timezone ?? 'UTC', new Date(t)); first[s] = i; }
    }
    const max = Math.max(1, ...busy);
    const free = Array.from({ length: 168 }, (_, s) => [Math.floor(s / 24), s % 24, open[s] === false ? 0 : Math.round(100 * (1 - busy[s] / max / 2))]);
    // (a slot nobody used scores 100; the busiest one inside the hours 50: the hours matter, the history only orders)
    const best = left <= 0 ? [] : [...free].filter((f) => f[2] > 0).sort((x, y) => y[2] - x[2] || first[x[0] * 24 + x[1]] - first[y[0] * 24 + y[1]])
      .slice(0, 3).map(([wd, hr, sc]) => ({ when: whenText(wd, hr), why: busy[wd * 24 + hr] ? `貸す時間の中で、ふだんの実行が少ない（${busy[wd * 24 + hr]} 回）` : `貸す時間の中で、この ${WEEKS} 週間は実行がありません` }));
    return { ...out, tz, free, best, left, reason: left <= 0 ? '今月の分はもう使い切りました（上限の 80%）' : free.every((f) => f[2] === 0) ? `貸す時間（${rules.hours} ${rules.timezone ?? 'UTC'}）が見つかりません` : '' };
  });
}
