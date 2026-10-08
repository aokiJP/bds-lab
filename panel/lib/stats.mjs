// stats: the lab's runs as numbers (the 「統計」 tab, ui/stats.mjs) — how many started each day and how they ended, how each
// workflow does, when runs start (the week by the hour), the minutes the lab and each lender spent, the workflows that pass and
// fail by turns — and the small scales the charts are drawn with. Pure: no DOM, no fetch, no node:. A day is the calendar day in
// a time zone (IANA names, through Intl; one Intl does not know is UTC). A run is GitHub's own: `status`, `conclusion`,
// `run_started_at` (else `created_at`), `updated_at`, `path`, `name`, `head_branch`.

/** the conclusions counted as failed — as workflowHealth in model.mjs counts them */
export const BAD = ['failure', 'timed_out', 'startup_failure'];
// (nothing ran in these: no minutes, no time)
const NO_TIME = ['skipped', 'startup_failure', 'action_required', 'stale'];
const MAX_DAYS = 400;

// (the runs given, as far as they are runs: a list that is none, or has nulls in it, is no error)
const only = (runs) => (Array.isArray(runs) ? runs.filter((r) => r && typeof r === 'object') : []);
const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));
/** when a run started, in ms (NaN: it does not say) — `run_started_at`, else `created_at` (pure) */
export const startMs = (r) => Date.parse(r?.run_started_at ?? r?.created_at);
// (the order runs happened in; one started at the same moment by its number)
const oldestFirst = (a, b) => (startMs(a) || 0) - (startMs(b) || 0) || (a?.id ?? 0) - (b?.id ?? 0);
// (a workflow is its file — GitHub may add `@<ref>` to the path — else its name)
const flowKey = (r) => String(r?.path ?? '').split('@')[0] || String(r?.name ?? '') || '?';

/** how a run ended, for counting (pure): 'ok' (passed), 'bad' (failed, timed out, never started) or 'other' (cancelled, skipped,
 *  still going …) */
export const kindOf = (r) => (r?.status !== 'completed' ? 'other' : r.conclusion === 'success' ? 'ok' : BAD.includes(r.conclusion) ? 'bad' : 'other');

/** the time a finished run took, in ms (pure): its start to its last update; null for one not finished, one that ran nothing
 *  (skipped, never started, waiting for approval) and dates that make no sense */
export function took(r) {
  if (r?.status !== 'completed' || NO_TIME.includes(r.conclusion)) return null;
  const d = Date.parse(r.updated_at) - startMs(r);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

// ---- the calendar of a time zone ----
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formats = new Map();
const formatter = (tz) => {
  const key = String(tz ?? 'UTC');
  if (!formats.has(key)) {
    const make = (timeZone) => new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' });
    let f; try { f = make(key); } catch { f = make('UTC'); }
    formats.set(key, f);
  }
  return formats.get(key);
};
/** an instant in a time zone → { day: 'YYYY-MM-DD', wd: 0 (Sunday) – 6, hour: 0–23 }; null when it is no time (pure) */
export function clock(ms, tz = 'UTC') {
  if (ms === null || ms === undefined) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const p = {};
  for (const x of formatter(tz).formatToParts(d)) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, wd: WEEK.indexOf(p.weekday), hour: Number(p.hour) % 24 };
}
/** this browser's own time zone, else UTC */
export const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** the last `days` calendar days in a zone, the oldest first, as 'YYYY-MM-DD' (pure; days: 0–400, 30 when it is no number):
 *  counted on the calendar, so a day of 23 or 25 hours (summer time) is neither skipped nor doubled */
export function dayList(opts) {
  const { days = 30, tz = 'UTC', now = Date.now() } = opts ?? {};
  const n = Number.isFinite(Number(days)) ? Math.min(MAX_DAYS, Math.max(0, Math.floor(Number(days)))) : 30;
  const c = clock(toMs(now), tz) ?? clock(Date.now(), tz), [y, m, d] = c.day.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d - (n - 1 - i))).toISOString().slice(0, 10));
}

/** the runs that started inside the window dayList names, in the order given (pure) */
export function inWindow(runs = [], opts = {}) {
  const list = dayList(opts), tz = opts?.tz ?? 'UTC';
  if (!list.length) return [];
  return only(runs).filter((r) => { const c = clock(startMs(r), tz); return c !== null && c.day >= list[0] && c.day <= list.at(-1); });
}

/** the last `days` days, the oldest first, each { day, count (started that day), ok, bad, other, rate (ok of ok + bad; null when
 *  there is neither), ms (the time the finished runs took) } (pure): a run belongs to the day it started in `tz`; one outside
 *  the window, or with a date that is no date, is left out */
export function byDay(runs = [], opts = {}) {
  const list = dayList(opts), tz = opts?.tz ?? 'UTC';
  const slots = new Map(list.map((day) => [day, { day, count: 0, ok: 0, bad: 0, other: 0, rate: null, ms: 0 }]));
  for (const r of only(runs)) {
    const c = clock(startMs(r), tz), s = c && slots.get(c.day);
    if (!s) continue;
    s.count++; s[kindOf(r)]++; s.ms += took(r) ?? 0;
  }
  return list.map((day) => { const s = slots.get(day); s.rate = s.ok + s.bad ? s.ok / (s.ok + s.bad) : null; return s; });
}

/** each workflow over the runs given (pure) → [{ name, path, runs (all of them), ok, bad, rate (ok of ok + bad; null when
 *  neither), ms (the middle time — the upper of two — of the runs that finished, passed or failed; null without one), recent (the
 *  last 12 of those: { ms, kind }, the oldest first), last ('ok' | 'bad' | null: how its newest decided run ended) }], the busiest
 *  first */
export function byWorkflow(runs = []) {
  const by = new Map();
  for (const r of only(runs)) { const k = flowKey(r); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  return [...by.entries()].map(([path, l]) => {
    const old = [...l].sort(oldestFirst), kinds = l.map(kindOf);
    const ok = kinds.filter((k) => k === 'ok').length, bad = kinds.filter((k) => k === 'bad').length;
    const timed = old.filter((r) => ['success', 'failure', 'timed_out'].includes(r.conclusion) && took(r) !== null);
    const ms = timed.map(took).sort((a, b) => a - b), decided = old.filter((r) => kindOf(r) !== 'other');
    return { name: String(old.at(-1).name ?? path), path, runs: l.length, ok, bad, rate: ok + bad ? ok / (ok + bad) : null, ms: ms.length ? ms[Math.floor(ms.length / 2)] : null,
      recent: timed.slice(-12).map((r) => ({ ms: took(r), kind: kindOf(r) })), last: decided.length ? kindOf(decided.at(-1)) : null };
  }).sort((a, b) => b.runs - a.runs || b.bad - a.bad || a.name.localeCompare(b.name));
}

/** the minutes spent, where by where (pure) → [{ where, minutes, runs, ms }], the most minutes first. A finished run counts its
 *  time rounded up to a minute, one minute at least (GitHub bills by the minute: the panel's own count of a host's month, model.mjs
 *  monthMinutes, does the same) — an estimate, from `run_started_at` to `updated_at`; one that ran nothing or is still going
 *  counts none. where: (run) → the place, or the name of the run's property that holds it (default: the run's repository) */
export function minutesBy(runs = [], where = (r) => r?.repository?.full_name) {
  const key = typeof where === 'function' ? where : (r) => r?.[where], by = new Map();
  for (const r of only(runs)) {
    const w = String(key(r) ?? ''), ms = took(r);
    if (!w || ms === null) continue;
    const e = by.get(w) ?? { where: w, minutes: 0, runs: 0, ms: 0 };
    e.minutes += Math.max(1, Math.ceil(ms / 60_000)); e.runs++; e.ms += ms;
    by.set(w, e);
  }
  return [...by.values()].sort((a, b) => b.minutes - a.minutes || a.where.localeCompare(b.where));
}

/** when runs start (pure) → 7 rows (Sunday first) of 24 hours: the number that started then, in the zone */
export function heat(runs = [], tz = 'UTC') {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of only(runs)) { const c = clock(startMs(r), tz); if (c && c.wd >= 0) grid[c.wd][c.hour]++; }
  return grid;
}

/** the workflows that pass and fail by turns on one branch (pure) → [{ name, path, branch, runs, ok, bad, flips (how often the
 *  result changed from one run to the next), retried (runs that needed another attempt), last }], the most turns first. Runs
 *  that did not pass or fail (cancelled, skipped, going …) and a workflow file that does not load (startup_failure) are not
 *  looked at; at least `minFlips` changes (3: passed, failed, passed, failed) — one failure between passes is as likely a fix as a
 *  flake */
export function flaky(runs = [], { minFlips = 3 } = {}) {
  const by = new Map();
  for (const r of only(runs)) {
    const k = r?.status === 'completed' ? (r.conclusion === 'success' ? 'ok' : ['failure', 'timed_out'].includes(r.conclusion) ? 'bad' : null) : null;
    if (!k) continue;
    const id = `${flowKey(r)}\n${r.head_branch ?? ''}`;
    if (!by.has(id)) by.set(id, []);
    by.get(id).push({ r, k });
  }
  const out = [];
  for (const l of by.values()) {
    l.sort((a, b) => oldestFirst(a.r, b.r));
    let flips = 0; for (let i = 1; i < l.length; i++) if (l[i].k !== l[i - 1].k) flips++;
    if (flips < minFlips) continue;
    const r = l.at(-1).r;
    out.push({ name: String(r.name ?? flowKey(r)), path: flowKey(r), branch: String(r.head_branch ?? ''), runs: l.length, ok: l.filter((x) => x.k === 'ok').length, bad: l.filter((x) => x.k === 'bad').length,
      flips, retried: l.filter((x) => (x.r.run_attempt ?? 1) > 1).length, last: l.at(-1).k });
  }
  return out.sort((a, b) => b.flips - a.flips || b.bad - a.bad || a.name.localeCompare(b.name) || a.branch.localeCompare(b.branch));
}

// ---- the small scales the charts are drawn with ----
/** the marks of a count axis (pure): 0 and whole-number steps of 1, 2 or 5 times a power of ten, up to the first at or past max */
export function niceTicks(max, want = 4) {
  const m = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 1, raw = m / Math.max(1, want), pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow;
  const step = Math.max(1, Math.round((f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow)), n = Math.max(1, Math.ceil(m / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => i * step);
}
/** how dark a cell of the heat map is (pure): 0 for none, else 1 – steps by its share of the most */
export function heatLevel(v, max, steps = 4) {
  if (!(v > 0) || !(max > 0)) return 0;
  return Math.min(steps, Math.max(1, Math.ceil((v / max) * steps)));
}
/** the stretches of a series that has values (pure) → [[{ i, v }, …], …]: a day with none (null) breaks the line */
export function stretches(values = []) {
  const out = []; let cur = null;
  (values ?? []).forEach((v, i) => {
    if (v === null || v === undefined || Number.isNaN(v)) { cur = null; return; }
    if (!cur) { cur = []; out.push(cur); }
    cur.push({ i, v });
  });
  return out;
}
/** a series scaled into a w × h box with `pad` around it (pure) → [[x, y], …], the first at the left and the last at the right;
 *  a flat series (and a single value) runs through the middle */
export function sparkPoints(values = [], w = 100, h = 24, pad = 4) {
  const v = values ?? [], n = v.length, lo = Math.min(...v), hi = Math.max(...v);
  return v.map((x, i) => [n > 1 ? pad + (i * (w - 2 * pad)) / (n - 1) : w / 2, hi > lo ? h - pad - ((x - lo) / (hi - lo)) * (h - 2 * pad) : h / 2]);
}
/** points as an SVG path, one decimal (pure) */
export const pathOf = (points) => (points ?? []).map(([x, y], i) => `${i ? 'L' : 'M'}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join('');
