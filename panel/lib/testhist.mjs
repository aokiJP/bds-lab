// testhist (「試験の履歴」): from unit.yml's runs (run-name "unit <job> <unit>", job test or go), for each unit, how many passed and
// failed each day, the share that passed, the last day one passed and how many passed in a row up to now. Pure: no DOM, no network.
export const JOBS = ['test', 'go'];
export const DAY = 86_400_000;
const PASS = ['success'], FAIL = ['failure', 'timed_out'];
import { clock, dayList } from './stats.mjs';

/** a run's name → { job, unit } | null (not a unit's test or go run) */
export function parseName(name) {
  const m = /^unit (\S+) (\S+)\s*$/.exec(String(name ?? '').trim());
  return m && JOBS.includes(m[1]) ? { job: m[1], unit: m[2] } : null;
}
/** runs as GitHub gives them (any order) → { days, units: [{ unit, days: [{ date, pass, fail }] (oldest first, `days` of them up to
 *  today, quiet days 0/0), rate (0..1 of the passed and failed in them; null: none), lastPass ('YYYY-MM-DD' | null, over all the
 *  runs given), streak (passes in a row from the newest run), pass, fail }] } the units with the most failures first.
 *  Only finished runs that passed or failed count (cancelled, skipped, running ones do not). */
export function history(runs, { days = 30, now = Date.now(), tz = 'UTC' } = {}) {
  const n = Math.max(1, Math.min(365, Math.floor(Number(days)) || 30));
  // (days on the person's own calendar — tz: a run at 08:00 in Tokyo is that day, not the one before in UTC)
  const dayOf = (ms) => clock(ms, tz)?.day ?? new Date(ms).toISOString().slice(0, 10);
  const dates = dayList({ days: n, tz, now });
  const by = new Map();
  for (const r of Array.isArray(runs) ? runs : []) {
    // (the run-name "unit <job> <unit>" is GitHub's display_title; name is the workflow's own name)
    const id = parseName(r?.display_title) ?? parseName(r?.name);
    const pass = PASS.includes(r?.conclusion), fail = FAIL.includes(r?.conclusion);
    if (!id || r?.status !== 'completed' || !(pass || fail)) continue;
    const ms = Date.parse(r.run_started_at ?? r.created_at);
    if (Number.isNaN(ms)) continue;
    if (!by.has(id.unit)) by.set(id.unit, []);
    by.get(id.unit).push({ ms, pass });
  }
  const units = [...by].map(([unit, list]) => {
    list.sort((a, b) => b.ms - a.ms);
    const cells = dates.map((date) => ({ date, pass: 0, fail: 0 })), at = new Map(cells.map((c) => [c.date, c]));
    for (const x of list) { const c = at.get(dayOf(x.ms)); if (c) c[x.pass ? 'pass' : 'fail']++; }
    const pass = cells.reduce((a, c) => a + c.pass, 0), fail = cells.reduce((a, c) => a + c.fail, 0);
    let streak = 0;
    for (const x of list) { if (!x.pass) break; streak++; }
    const last = list.find((x) => x.pass);
    return { unit, days: cells, rate: pass + fail ? pass / (pass + fail) : null, lastPass: last ? dayOf(last.ms) : null, streak, pass, fail };
  });
  units.sort((a, b) => b.fail - a.fail || a.unit.localeCompare(b.unit));
  return { days: n, units };
}
