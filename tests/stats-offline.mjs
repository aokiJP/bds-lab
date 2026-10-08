// the management panel's 「統計」 and 「健康度」 without a browser or a network: the pure functions of panel/lib/stats.mjs (how many runs
// started each day and how they ended, the workflows, the minutes, the week by the hour, the ones that pass and fail by turns, the
// scales the charts are drawn with — across time zones, summer time, month ends, the edges of a window and empty input) and of
// panel/lib/health.mjs (the score and its letter, what to mend first, the Markdown report), then the screens on a small stand-in DOM
// and a fake GitHub (panel/ui/stats.mjs: what is read and drawn; panel/ui/health.mjs: the card and the report file).
// node tests/stats-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const S = await imp('panel/lib/stats.mjs'), H = await imp('panel/lib/health.mjs'), P = await imp('panel/lib/policy.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ---- runs as GitHub gives them ----
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
let nextId = 1;
/** a finished run that started at `start` and took `ms` */
const mkMs = (start, ms, conclusion = 'success', extra = {}) => ({ id: nextId++, name: 'verify', path: '.github/workflows/verify.yml', status: 'completed', conclusion, head_branch: 'main', event: 'push', created_at: start, run_started_at: start, updated_at: iso(Date.parse(start) + ms), ...extra });
const mk = (start, minutes, conclusion = 'success', extra = {}) => mkMs(start, Math.round(minutes * 60_000), conclusion, extra);

await t('how a run ended and how long it took: passed, failed (timed out and never started too), the rest; a run that ran nothing took no time (pure)', () => {
  const k = (conclusion, status = 'completed') => S.kindOf({ status, conclusion });
  eq(['success', 'failure', 'timed_out', 'startup_failure', 'cancelled', 'skipped', 'neutral', 'action_required', 'stale', null].map((c) => k(c)), ['ok', 'bad', 'bad', 'bad', 'other', 'other', 'other', 'other', 'other', 'other']);
  eq([S.kindOf({ status: 'in_progress', conclusion: null }), S.kindOf({ status: 'queued' }), S.kindOf({ status: 'in_progress', conclusion: 'success' }), S.kindOf(null), S.kindOf(undefined), S.kindOf({})], ['other', 'other', 'other', 'other', 'other', 'other'], 'only a finished run counts');
  eq(S.took(mk('2026-10-08T00:00:00Z', 5)), 300_000);
  eq(S.took(mk('2026-10-08T00:00:00Z', 0)), 0, 'a run that took no time is 0, not none');
  eq(['skipped', 'startup_failure', 'action_required', 'stale'].map((c) => S.took(mk('2026-10-08T00:00:00Z', 5, c))), [null, null, null, null], 'these ran nothing');
  eq(['failure', 'cancelled', 'timed_out', 'neutral'].map((c) => S.took(mk('2026-10-08T00:00:00Z', 5, c))), [300_000, 300_000, 300_000, 300_000], 'these did run');
  eq(S.took({ status: 'in_progress', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:05:00Z' }), null, 'not finished');
  eq(S.took({ status: 'completed', conclusion: 'success', run_started_at: '2026-10-08T00:05:00Z', updated_at: '2026-10-08T00:00:00Z' }), null, 'dates that run backwards');
  eq(S.took({ status: 'completed', conclusion: 'success', created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:01:00Z' }), 60_000, 'created_at when there is no run_started_at');
  eq([S.took({ status: 'completed', conclusion: 'success' }), S.took({ status: 'completed', conclusion: 'success', created_at: 'x', updated_at: 'y' }), S.took(null), S.took(undefined)], [null, null, null, null]);
  // (when it started: the latest attempt's start, else the run's creation; no date: NaN)
  const day = (d) => Date.parse(`2026-10-0${d}T00:00:00Z`);
  eq([S.startMs({ run_started_at: '2026-10-08T00:00:00Z', created_at: '2026-10-07T00:00:00Z' }), S.startMs({ created_at: '2026-10-07T00:00:00Z' }), S.startMs({ run_started_at: null, created_at: '2026-10-07T00:00:00Z' })], [Date.parse('2026-10-08T00:00:00Z'), day(7), day(7)]);
  ok(Number.isNaN(S.startMs({})) && Number.isNaN(S.startMs(null)) && Number.isNaN(S.startMs(undefined)), 'no date: NaN');
  eq(S.BAD, ['failure', 'timed_out', 'startup_failure'], 'what counts as failed');
});

await t('a moment in a time zone: its day, weekday and hour — Tokyo, New York, India\'s half hour, Nepal\'s three quarters; summer time; a zone Intl does not know is UTC; no time is no clock (pure)', () => {
  const at = (when, tz) => { const c = S.clock(Date.parse(when), tz); return [c.day, c.wd, c.hour]; };
  // (2026-10-08 is a Thursday: weekday 4)
  eq(at('2026-10-08T14:59:59Z', 'Asia/Tokyo'), ['2026-10-08', 4, 23]);
  eq(at('2026-10-08T15:00:00Z', 'Asia/Tokyo'), ['2026-10-09', 5, 0]);
  eq(at('2026-10-08T18:29:59Z', 'Asia/Kolkata'), ['2026-10-08', 4, 23]);
  eq(at('2026-10-08T18:30:00Z', 'Asia/Kolkata'), ['2026-10-09', 5, 0]);
  eq(at('2026-10-08T00:00:00Z', 'Asia/Kathmandu'), ['2026-10-08', 4, 5], '05:45');
  eq(at('2026-10-08T18:14:59Z', 'Asia/Kathmandu'), ['2026-10-08', 4, 23]);
  eq(at('2026-10-08T18:15:00Z', 'Asia/Kathmandu'), ['2026-10-09', 5, 0]);
  eq(at('2026-10-08T03:59:59Z', 'America/New_York'), ['2026-10-07', 3, 23], 'EDT is four hours behind');
  eq(at('2026-10-08T04:00:00Z', 'America/New_York'), ['2026-10-08', 4, 0]);
  eq(at('2026-10-08T00:00:00Z', 'UTC'), ['2026-10-08', 4, 0], 'midnight is hour 0, not 24');
  // (an engine that writes midnight as 24: still hour 0 — a zone name not used above, so the calendar is made anew)
  const real = Intl.DateTimeFormat;
  Intl.DateTimeFormat = class extends real { formatToParts(d) { return super.formatToParts(d).map((x) => (x.type === 'hour' && x.value === '00' ? { ...x, value: '24' } : x)); } };
  try { eq(at('2026-10-08T00:00:00Z', 'Etc/UTC'), ['2026-10-08', 4, 0]); } finally { Intl.DateTimeFormat = real; }
  // (summer time ends in New York on Sunday 2026-11-01: 01:30 comes twice, an hour apart)
  eq(at('2026-11-01T05:30:00Z', 'America/New_York'), ['2026-11-01', 0, 1]);
  eq(at('2026-11-01T06:30:00Z', 'America/New_York'), ['2026-11-01', 0, 1]);
  eq(at('2026-10-08T00:00:00Z', 'Mars/Base'), at('2026-10-08T00:00:00Z', 'UTC'), 'a zone it does not know is UTC');
  eq(at('2026-10-08T00:00:00Z', undefined), ['2026-10-08', 4, 0]);
  eq([S.clock(NaN), S.clock(undefined), S.clock(null), S.clock('x'), S.clock(1e20)], [null, null, null, null, null]);
  eq(S.clock('2026-10-08T00:00:00Z').day, '2026-10-08', 'an ISO string too');
  ok(typeof S.localZone() === 'string' && S.clock(0, S.localZone()) !== null, 'this browser\'s own zone is one Intl knows');
});

await t('the days of a window are counted on the calendar: month and year ends, a leap day, summer time, the limits (pure)', () => {
  const L = (days, tz, now) => S.dayList({ days, tz, now: Date.parse(now) });
  eq(L(3, 'UTC', '2026-03-01T00:30:00Z'), ['2026-02-27', '2026-02-28', '2026-03-01']);
  eq(L(3, 'UTC', '2028-03-01T00:30:00Z'), ['2028-02-28', '2028-02-29', '2028-03-01'], 'a leap year');
  eq(L(3, 'UTC', '2027-01-01T23:59:59Z'), ['2026-12-30', '2026-12-31', '2027-01-01']);
  eq(L(2, 'Asia/Tokyo', '2026-12-31T15:00:00Z'), ['2026-12-31', '2027-01-01'], 'the new year has come in Tokyo');
  eq(L(2, 'UTC', '2026-12-31T15:00:00Z'), ['2026-12-30', '2026-12-31'], 'and not yet in UTC');
  // (summer time begins in Berlin on Sunday 2026-03-29, a day of 23 hours; it ends in New York on 2026-11-01, a day of 25)
  eq(L(5, 'Europe/Berlin', '2026-03-29T22:30:00Z'), ['2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30']);
  eq(L(4, 'America/New_York', '2026-11-02T12:00:00Z'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  for (const [tz, now] of [['Europe/Berlin', '2026-03-30T12:00:00Z'], ['America/New_York', '2026-11-02T12:00:00Z'], ['Australia/Lord_Howe', '2026-04-06T12:00:00Z'], ['Asia/Tokyo', '2026-10-08T15:00:00Z']]) {
    const l = L(40, tz, now);
    eq(new Set(l).size, 40, `${tz}: none twice`);
    for (let i = 1; i < l.length; i++) eq((Date.parse(l[i]) - Date.parse(l[i - 1])) / 86_400_000, 1, `${tz}: none skipped`);
  }
  const now = '2026-10-08T00:00:00Z';
  eq([L(0, 'UTC', now).length, L(1, 'UTC', now), L(400, 'UTC', now).length, L(401, 'UTC', now).length, L(-3, 'UTC', now).length, L(2.9, 'UTC', now).length], [0, ['2026-10-08'], 400, 400, 0, 2]);
  eq([S.dayList({ days: 'x' }).length, S.dayList({}).length, S.dayList().length, S.dayList(null).length], [30, 30, 30, 30], 'no number: 30 days');
  eq(S.dayList({ days: 2, tz: 'UTC', now: 'garbage' }).length, 2, 'a now that is no time is the present');
  eq(S.dayList({ days: 2, tz: 'UTC', now: new Date('2026-10-08T05:00:00Z') }), ['2026-10-07', '2026-10-08'], 'a Date too');
});

await t('days: how many started each day and how they ended, by the calendar of a time zone; the edges of the window; empty (pure)', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const rs = [
    mk('2026-10-08T01:00:00Z', 10), mk('2026-10-08T02:00:00Z', 20, 'failure'), mk('2026-10-08T03:00:00Z', 5, 'cancelled'), mk('2026-10-08T04:00:00Z', 0, 'skipped'),
    { ...mk('2026-10-08T05:00:00Z', 7), status: 'in_progress', conclusion: null },
    mk('2026-10-07T23:59:59Z', 1), mk('2026-10-06T00:00:00Z', 30, 'timed_out'),
    mk('2026-10-05T23:59:59Z', 1),      // the day before a window of three days
    mk('2026-10-08T12:00:01Z', 1),      // a moment after now: still today
    mk('2026-10-09T00:00:00Z', 1),      // tomorrow
    { ...mk('2026-10-08T01:00:00Z', 1), run_started_at: 'not a date', created_at: 'nor this' }, { id: 9 }, null, 'run', 7,
  ];
  const u = S.byDay(rs, { days: 3, tz: 'UTC', now });
  eq(u.map((x) => x.day), ['2026-10-06', '2026-10-07', '2026-10-08']);
  eq(u[0], { day: '2026-10-06', count: 1, ok: 0, bad: 1, other: 0, rate: 0, ms: 1_800_000 }, 'the first day of the window is in, a timed out run is failed');
  eq(u[1], { day: '2026-10-07', count: 1, ok: 1, bad: 0, other: 0, rate: 1, ms: 60_000 }, '23:59:59 is still the 7th');
  eq(u[2], { day: '2026-10-08', count: 6, ok: 2, bad: 1, other: 3, rate: 2 / 3, ms: 2_160_000 }, 'cancelled, skipped and going are the rest; a skipped or going run has no time; the junk is left out');
  // (the same runs in Tokyo: nine hours on — the 7th's last second is the 8th, and the 5th's is the 6th)
  const j = S.byDay(rs, { days: 3, tz: 'Asia/Tokyo', now });
  eq(j.map((x) => [x.day, x.count, x.ok, x.bad, x.other, x.rate, x.ms]), [['2026-10-06', 2, 1, 1, 0, 0.5, 1_860_000], ['2026-10-07', 0, 0, 0, 0, null, 0], ['2026-10-08', 7, 3, 1, 3, 0.75, 2_220_000]]);
  eq(S.inWindow(rs, { days: 3, tz: 'UTC', now }).length, 8, 'the runs in the window: the same eight');
  eq(S.inWindow(rs, { days: 3, tz: 'Asia/Tokyo', now }).length, 9);
  ok(S.inWindow(rs, { days: 3, tz: 'UTC', now }).every((r) => rs.includes(r)), 'the runs themselves, not copies');
  eq(S.inWindow(rs, { days: 0, tz: 'UTC', now }), [], 'a window of no days holds nothing');
  // (empty: every day is there, with nothing in it)
  eq(S.byDay([], { days: 2, tz: 'UTC', now }), [{ day: '2026-10-07', count: 0, ok: 0, bad: 0, other: 0, rate: null, ms: 0 }, { day: '2026-10-08', count: 0, ok: 0, bad: 0, other: 0, rate: null, ms: 0 }]);
  eq([S.byDay(undefined, { days: 1, tz: 'UTC', now }).length, S.byDay(null, { days: 1, tz: 'UTC', now }).length, S.byDay(rs, { days: 0, now }), S.byDay([], null).length, S.inWindow(null, { days: 2 }), S.inWindow(undefined)], [1, 1, [], 30, [], []]);
  // (a run with nothing but going or cancelled in a day: no share of passing)
  eq(S.byDay([mk('2026-10-08T01:00:00Z', 1, 'cancelled')], { days: 1, tz: 'UTC', now })[0].rate, null);
});

await t('workflows: runs, passed and failed, the share, the middle time, the small line, how it ended last; busiest first; empty (pure)', () => {
  const rs = [
    mk('2026-10-01T00:00:00Z', 1), mk('2026-10-02T00:00:00Z', 2), mk('2026-10-03T00:00:00Z', 3, 'failure'), mk('2026-10-04T00:00:00Z', 4),
    mk('2026-10-05T00:00:00Z', 9, 'cancelled'), mk('2026-10-06T00:00:00Z', 0, 'skipped'), { ...mk('2026-10-07T00:00:00Z', 1), status: 'in_progress', conclusion: null },
    // (GitHub may write the ref after the file: one workflow)
    mk('2026-10-01T00:00:00Z', 5, 'success', { name: 'pages', path: '.github/workflows/pages.yml@refs/heads/main' }), mk('2026-10-02T00:00:00Z', 7, 'success', { name: 'pages', path: '.github/workflows/pages.yml@refs/heads/dev' }),
    mk('2026-10-03T00:00:00Z', 1, 'startup_failure', { name: 'broken', path: '.github/workflows/broken.yml' }), mk('2026-10-03T00:00:00Z', 1, 'cancelled', { name: 'only-cancelled', path: '.github/workflows/c.yml' }),
  ];
  const w = S.byWorkflow(rs);
  eq(w.map((x) => [x.path, x.runs]), [['.github/workflows/verify.yml', 7], ['.github/workflows/pages.yml', 2], ['.github/workflows/broken.yml', 1], ['.github/workflows/c.yml', 1]], 'the busiest first, then the more failed');
  eq(w[0], { name: 'verify', path: '.github/workflows/verify.yml', runs: 7, ok: 3, bad: 1, rate: 0.75, ms: 180_000,
    recent: [{ ms: 60_000, kind: 'ok' }, { ms: 120_000, kind: 'ok' }, { ms: 180_000, kind: 'bad' }, { ms: 240_000, kind: 'ok' }], last: 'ok' }, 'four times 1 2 3 4 minutes: the middle is the upper of two; cancelled, skipped and going are not in the share or the line');
  eq([w[1].name, w[1].ok, w[1].bad, w[1].rate, w[1].ms, w[1].last], ['pages', 2, 0, 1, 420_000, 'ok']);
  eq([w[2].bad, w[2].rate, w[2].ms, w[2].recent, w[2].last], [1, 0, null, [], 'bad'], 'a file that did not load: failed, with no time');
  eq([w[3].ok, w[3].bad, w[3].rate, w[3].ms, w[3].last], [0, 0, null, null, null], 'only cancelled: no share, no time');
  const odd = S.byWorkflow([mk('2026-10-01T00:00:00Z', 1), mk('2026-10-02T00:00:00Z', 5), mk('2026-10-03T00:00:00Z', 3)]);
  eq(odd[0].ms, 180_000, 'an odd number: the middle one');
  // (the small line keeps the last twelve, the oldest first)
  const many = S.byWorkflow(Array.from({ length: 15 }, (_, i) => mk(`2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`, i + 1)));
  eq(many[0].recent.map((x) => x.ms / 60_000), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  eq(many[0].ms, 8 * 60_000, 'the middle of fifteen: the eighth');
  eq(S.byWorkflow([{ status: 'completed', conclusion: 'success', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:01:00Z' }])[0].path, '?', 'no file, no name: one called ?');
  // (as many runs: the one that failed more first, whatever the names say)
  eq(S.byWorkflow([mk('2026-10-01T00:00:00Z', 1, 'success', { name: 'a-fine', path: '.github/workflows/a.yml' }), mk('2026-10-01T00:00:00Z', 1, 'failure', { name: 'z-failing', path: '.github/workflows/z.yml' })]).map((x) => x.name), ['z-failing', 'a-fine']);
  eq(S.byWorkflow([mk('2026-10-01T00:00:00Z', 1, 'success', { name: 'b', path: '.github/workflows/b.yml' }), mk('2026-10-01T00:00:00Z', 1, 'success', { name: 'a', path: '.github/workflows/a.yml' })]).map((x) => x.name), ['a', 'b'], 'then by name');
  eq([S.byWorkflow([]), S.byWorkflow(), S.byWorkflow(null), S.byWorkflow([null, 3, 'x'])], [[], [], [], []]);
});

await t('minutes: a finished run counts its time rounded up to the minute, one at least; what ran nothing or is going counts none; by place; empty (pure)', () => {
  const d = (ms, conclusion = 'success', extra = {}) => mkMs('2026-10-08T00:00:00Z', ms, conclusion, extra);
  const rs = [
    d(60_000, 'success', { where: 'lab' }), d(60_001, 'failure', { where: 'lab' }), d(0, 'success', { where: 'lab' }), d(59_999, 'cancelled', { where: 'lab' }),
    d(3_570_000, 'success', { where: 'host/a' }), d(300_000, 'skipped', { where: 'host/a' }), { ...d(300_000, 'success', { where: 'host/a' }), status: 'in_progress', conclusion: null },
    d(120_000, 'success'), d(120_000, 'success', { repository: { full_name: 'o/r' } }), d(120_000, 'success', { where: '' }),
  ];
  eq(S.minutesBy(rs, 'where'), [{ where: 'host/a', minutes: 60, runs: 1, ms: 3_570_000 }, { where: 'lab', minutes: 1 + 2 + 1 + 1, runs: 4, ms: 60_000 + 60_001 + 0 + 59_999 }], '60 000 ms is one minute, 60 001 two, none at all one, 3 570 000 sixty (59.5 up)');
  eq(S.minutesBy(rs), [{ where: 'o/r', minutes: 2, runs: 1, ms: 120_000 }], 'by default: the run\'s repository');
  eq(S.minutesBy(rs, (r) => r.event).map((x) => [x.where, x.minutes, x.runs]), [['push', 71, 8]], 'or by what a function says: 5 + 60 + 2 + 2 + 2');
  eq(S.minutesBy([d(60_000, 'success', { where: 'b' }), d(60_000, 'success', { where: 'a' }), d(120_000, 'success', { where: 'c' })], 'where').map((x) => [x.where, x.minutes]), [['c', 2], ['a', 1], ['b', 1]], 'most first, then by name');
  eq([S.minutesBy([]), S.minutesBy(), S.minutesBy(null, 'where'), S.minutesBy([null, 1], 'where')], [[], [], [], []]);
});

await t('the week by the hour: 7 rows (Sunday first) of 24, in the zone asked for; every run counts however it ended (pure)', () => {
  const rs = [mk('2026-10-08T14:59:59Z', 1), mk('2026-10-08T15:00:00Z', 1, 'failure'), { ...mk('2026-10-08T15:30:00Z', 1), status: 'in_progress', conclusion: null }, mk('2026-10-11T00:00:00Z', 1, 'cancelled'), { id: 1 }, null];
  const cells = (g) => g.flatMap((row, wd) => row.map((v, hr) => (v ? [wd, hr, v] : null)).filter(Boolean));
  const tokyo = S.heat(rs, 'Asia/Tokyo');
  eq([tokyo.length, tokyo.every((r) => r.length === 24)], [7, true]);
  eq(cells(tokyo), [[0, 9, 1], [4, 23, 1], [5, 0, 2]], 'Sunday 09:00, Thursday 23:00, Friday 00:00 twice');
  eq(cells(S.heat(rs, 'UTC')), [[0, 0, 1], [4, 14, 1], [4, 15, 2]]);
  eq(cells(S.heat(rs)), cells(S.heat(rs, 'UTC')), 'no zone: UTC');
  eq(cells(S.heat(rs, 'Mars/Base')), cells(S.heat(rs, 'UTC')), 'an unknown zone: UTC');
  // (summer time ending: 01:30 twice, both are hour 1 of Sunday)
  eq(cells(S.heat([mk('2026-11-01T05:30:00Z', 1), mk('2026-11-01T06:30:00Z', 1)], 'America/New_York')), [[0, 1, 2]]);
  eq(S.heat([], 'UTC').flat().reduce((a, b) => a + b, 0), 0);
  eq([S.heat().length, S.heat(null, 'UTC').length, S.heat(undefined, 'UTC')[0].length], [7, 7, 24]);
});

await t('flaky: the same workflow on the same branch passing and failing by turns — three changes, not one fix; cancelled and going are not looked at; empty (pure)', () => {
  // (one run a day from the 1st: S passed, F failed, T timed out, C cancelled)
  const how = { S: 'success', F: 'failure', T: 'timed_out', C: 'cancelled' };
  const seq = (list, extra = {}) => list.map((c, i) => mk(`2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`, 1, how[c], extra));
  const f = (list, extra, opts) => S.flaky(seq(list, extra), opts);
  eq(f(['S', 'F', 'S', 'F']).map((x) => [x.runs, x.ok, x.bad, x.flips, x.last]), [[4, 2, 2, 3, 'bad']], 'passed, failed, passed, failed: three changes');
  eq([f(['S', 'F', 'S']).length, f(['S', 'S', 'F', 'F']).length, f(['S', 'S', 'S']).length, f(['F']).length, f([]).length], [0, 0, 0, 0, 0], 'two changes (a failure and its fix), one, none');
  eq(f(['S', 'F', 'S'], {}, { minFlips: 2 }).length, 1, 'two changes count when asked');
  eq(f(['F', 'S', 'F', 'S', 'F']).map((x) => [x.flips, x.last]), [[4, 'bad']]);
  eq(f(['S', 'C', 'F', 'C', 'S', 'F']).map((x) => [x.runs, x.flips]), [[4, 3]], 'cancelled runs in between change nothing');
  eq(f(['S', 'T', 'S', 'T']).length, 1, 'a timeout is a failure');
  eq(S.flaky([...seq(['S', 'F', 'S', 'F']), { ...mk('2026-10-20T00:00:00Z', 1), status: 'in_progress', conclusion: null }, mk('2026-10-21T00:00:00Z', 1, 'skipped'), mk('2026-10-22T00:00:00Z', 1, 'startup_failure')])[0].runs, 4, 'going, skipped and a file that did not load are not looked at');
  // (another branch, another workflow: each its own run of results)
  const mixed = [...seq(['S', 'F', 'S', 'F', 'S'], { head_branch: 'main' }), ...seq(['S', 'F', 'S'], { head_branch: 'dev' }), ...seq(['F', 'S', 'F', 'S'], { head_branch: 'main', name: 'pages', path: '.github/workflows/pages.yml' })];
  eq(S.flaky(mixed).map((x) => [x.name, x.branch, x.flips]), [['verify', 'main', 4], ['pages', 'main', 3]], 'the most turns first; the dev branch (2 changes) is not one');
  // (all passing on one branch and all failing on another, in turn in time: no branch changes its result)
  const split = [...[1, 3, 5, 7].map((d) => mk(`2026-10-0${d}T00:00:00Z`, 1, 'success', { head_branch: 'main' })), ...[2, 4, 6, 8].map((d) => mk(`2026-10-0${d}T00:00:00Z`, 1, 'failure', { head_branch: 'broken' }))];
  eq(S.flaky(split), [], 'each branch on its own');
  eq(S.flaky(split.map((r) => ({ ...r, head_branch: 'main' }))).map((x) => x.flips), [7], 'the same runs on one branch change seven times');
  // (runs in any order: they are taken in the order they happened; one started at the same moment by its number)
  eq(S.flaky(seq(['S', 'F', 'S', 'F']).reverse()).map((x) => [x.flips, x.last]), [[3, 'bad']]);
  eq(S.flaky([mk('2026-10-01T00:00:00Z', 1, 'success', { id: 2 }), mk('2026-10-01T00:00:00Z', 1, 'failure', { id: 1 }), mk('2026-10-01T00:00:00Z', 1, 'success', { id: 4 }), mk('2026-10-01T00:00:00Z', 1, 'failure', { id: 3 })]).map((x) => x.flips), [3]);
  // (runs that needed another attempt are counted, not the reason it is flagged)
  eq(f(['S', 'F', 'S', 'F'], { run_attempt: 2 })[0].retried, 4);
  eq([f(['S', 'F', 'S', 'F'])[0].retried, f(['S', 'F', 'S', 'F'], { run_attempt: 1 })[0].retried], [0, 0]);
  eq(f(['S', 'F', 'S', 'F', 'S', 'F', 'S', 'F'], {}, { minFlips: 8 }).length, 0, 'seven changes are not eight');
  eq([S.flaky([]), S.flaky(), S.flaky(null), S.flaky([null, 4])], [[], [], [], []]);
});

await t('the scales the charts use: marks of a count axis, how dark a cell is, stretches of a line, a small line in its box, a path (pure)', () => {
  eq([0, 1, 2, 3, 4, 5, 7, 10, 23, 120, 300, 1000].map((m) => S.niceTicks(m)), [[0, 1], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 2, 4, 6], [0, 2, 4, 6, 8], [0, 5, 10], [0, 10, 20, 30], [0, 50, 100, 150], [0, 100, 200, 300], [0, 500, 1000]]);
  eq([NaN, -5, '9', Infinity, undefined, null, 0.4].map((m) => S.niceTicks(m)), Array(7).fill([0, 1]), 'no count: 0 and 1');
  eq(S.niceTicks(100, 2), [0, 50, 100]);
  for (const m of [1, 6, 17, 99, 250, 4999]) { const k = S.niceTicks(m); ok(k.at(-1) >= m && k.every((x, i) => Number.isInteger(x) && (i === 0 || x > k[i - 1])), `ticks for ${m}: ${k}`); }
  eq([[0, 10], [1, 10], [2.5, 10], [2.6, 10], [5, 10], [7.5, 10], [7.6, 10], [10, 10], [11, 10], [3, 0], [-1, 10], [NaN, 10], [4, NaN]].map(([v, m]) => S.heatLevel(v, m)), [0, 1, 1, 2, 2, 3, 4, 4, 4, 0, 0, 0, 0]);
  eq([S.heatLevel(3, 10, 2), S.heatLevel(6, 10, 2), S.heatLevel(10, 10, 1)], [1, 2, 1]);
  eq(S.stretches([1, null, 2, 3, undefined, NaN, 4]), [[{ i: 0, v: 1 }], [{ i: 2, v: 2 }, { i: 3, v: 3 }], [{ i: 6, v: 4 }]], 'a day with none breaks the line');
  eq([S.stretches([0, 0]), S.stretches([]), S.stretches([null, null]), S.stretches(), S.stretches(null)], [[[{ i: 0, v: 0 }, { i: 1, v: 0 }]], [], [], [], []], 'zero is a value');
  eq(S.sparkPoints([1, 2, 3], 100, 24, 4), [[4, 20], [50, 12], [96, 4]], 'the least at the foot, the most at the top');
  eq([S.sparkPoints([]), S.sparkPoints([5]), S.sparkPoints([2, 2]), S.sparkPoints()], [[], [[50, 12]], [[4, 12], [96, 12]], []], 'one value and a flat line run through the middle');
  eq(S.pathOf([[1.04, 2], [3, 4.26], [0.05, 9]]), 'M1 2L3 4.3L0.1 9');
  eq([S.pathOf([]), S.pathOf(), S.pathOf(null)], ['', '', '']);
});

// ---- health ----
await t('the letters: A from 90, B 75, C 60, D 40, E below — the edges (pure)', () => {
  eq([100, 90, 89, 75, 74, 60, 59, 40, 39, 1, 0].map(H.gradeOf), ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E', 'E']);
  eq(H.GRADES.map(([m]) => m), [90, 75, 60, 40]);
  eq(H.FACTORS.reduce((a, x) => a + x.max, 0), 100, 'the eight things give 100 points together');
  eq(H.FACTORS.map((x) => x.key), ['setup', 'runs', 'policy', 'secrets', 'access', 'lenders', 'admins', 'version']);
});

await t('the score: eight things with their points; what could not be read is left out and the rest counted to 100; each says what it is; edges and nonsense (pure)', () => {
  const all = { setupOk: 9, setupTotal: 9, successRate: 1, policyErrors: 0, staleSecrets: 0, flagged: 0, lendersAlways: 2, adminsIdle: 0, versionLive: true };
  const best = H.score(all);
  eq([best.score, best.grade, best.known, best.factors.map((x) => `${x.points}/${x.max}`).join(' ')], [100, 'A', 8, '20/20 25/25 15/15 10/10 10/10 10/10 5/5 5/5']);
  ok(best.factors.every((x) => x.known && x.gain === 0 && typeof x.say === 'string' && x.say.length > 0), JSON.stringify(best.factors));
  eq(H.lift(best), [], 'nothing to mend');
  // (a mixed lab: set up 6 of 8, 80% passing, a sound policy, two old secrets, three to look at, one lender, one administrator not lending, an old page)
  const mid = H.score({ setupOk: 6, setupTotal: 8, successRate: 0.8, policyErrors: [], staleSecrets: 2, flagged: 3, lendersAlways: 1, adminsIdle: 1, versionLive: false });
  eq(mid.factors.map((x) => [x.key, x.points, x.gain]), [['setup', 15, 5], ['runs', 20, 5], ['policy', 15, 0], ['secrets', 4, 6], ['access', 4, 6], ['lenders', 5, 5], ['admins', 3, 2], ['version', 0, 5]]);
  eq([mid.score, mid.grade], [66, 'C']);
  eq(H.lift(mid).map((x) => x.key), ['secrets', 'access', 'setup'], 'the biggest gap first; the order above on a tie');
  eq(H.lift(mid, 5).map((x) => x.key), ['secrets', 'access', 'setup', 'runs', 'lenders']);
  eq(H.lift(mid, 0), []);
  eq(mid.factors.filter((x) => x.tab === null).map((x) => x.key), ['version'], 'the page\'s version is mended by reading it again: no tab');
  eq(Object.fromEntries(mid.factors.map((x) => [x.key, x.tab])), { setup: 'setup', runs: 'runs', policy: 'members', secrets: 'secrets', access: 'members', lenders: 'hosts', admins: 'hosts', version: null });
  eq(mid.factors.map((x) => x.say), ['準備ができていないところが 2 個あります（6/8）', '最近の実行の 80% が通っています', 'ポリシー（.github/bds-lab-panel.json）は正しく読めています', '180 日以上そのままの秘密が 2 個あります', 'アクセスの棚卸しで見ておくことが 3 件あります',
    'いつも貸している人は 1 人だけです（2 人以上だと、1 人が止まっても続きます）', 'まだいつも貸していない管理者が 1 人います', 'このページは新しい版ではありません（読み直すか、pages.yml を見てください）'], 'each says what it found');
  eq(best.factors.map((x) => x.say), ['準備は全部できています（9/9）', '最近の実行の 100% が通っています', 'ポリシー（.github/bds-lab-panel.json）は正しく読めています', '古い秘密はありません', '見直すところのある人はいません', 'いつも貸している人が 2 人います', '管理者はみんないつも貸しています', 'このページはいちばん新しい版です']);
  // (a broken policy allows nothing: all of its points go)
  eq(H.score({ policyErrors: 1 }).factors[2].points, 0);
  eq(H.score({ policyErrors: ['a', 'b'] }).factors[2].say, 'ポリシー（.github/bds-lab-panel.json）に誤りが 2 件あります: 直すまでパネルは何も許しません');
  eq([H.score({ policyErrors: 0 }).score, H.score({ policyErrors: 1 }).score, H.score({ policyErrors: 1 }).grade], [100, 0, 'E']);
  eq([best.enough, mid.enough], [true, true]);
  // (not read: left out, the rest counted to 100 — and when what was read is worth under 40 of the 100 points, no number is given)
  const some = H.score({ successRate: 1, versionLive: true });
  eq([some.score, some.grade, some.known, some.enough], [100, 'A', 2, false], '30 points read: an A that tells nothing');
  eq([H.ENOUGH, H.score({ successRate: 1, policyErrors: 0 }).enough, H.score({ successRate: 1, policyErrors: 0 }).known, H.score({ setupOk: 1, setupTotal: 2, staleSecrets: 0, flagged: 0 }).enough, H.score({ policyErrors: 0, staleSecrets: 0, flagged: 0, lendersAlways: 2, adminsIdle: 0, versionLive: true }).enough], [40, true, 2, true, true], '25 + 15 = 40 is enough; so is 20 + 10 + 10');
  eq([H.score({ policyErrors: 0, versionLive: true }).enough, H.score({ staleSecrets: 0, flagged: 0, lendersAlways: 2 }).enough, H.score({}).enough], [false, false, false]);
  ok(some.factors.filter((x) => !x.known).length === 6 && some.factors.filter((x) => !x.known).every((x) => x.points === 0 && x.max === 0 && x.gain === 0), 'what was not read gives nothing and asks nothing');
  const lag = H.score({ successRate: 1, versionLive: false });
  eq([lag.score, lag.factors[7].gain], [83, 17], '25 of 30 points; mending the page would add 17');
  eq(H.score({ successRate: 0.8 }).score, 80);
  // (the edges of what a thing can be)
  eq([0, 0.5, 1].map((r) => H.score({ successRate: r }).factors[1].points), [0, 13, 25]);
  eq([9, 12, 0, 4].map((ok) => H.score({ setupOk: ok, setupTotal: 9 }).factors[0].points), [20, 20, 0, 9], 'more done than there are: all of them');
  eq([[2, 9], [9, 0], [3, -1]].map(([o, n]) => H.score({ setupOk: o, setupTotal: n }).factors[0].known), [true, false, false]);
  eq([1.5, -0.1, NaN, '0.9', null, undefined, Infinity, true].map((r) => H.score({ successRate: r }).factors[1].known), Array(8).fill(false), 'a rate is a number from 0 to 1: anything else was not read');
  eq([0, 1, 3, 4, 9].map((n) => H.score({ staleSecrets: n }).factors[3].points), [10, 7, 1, 0, 0]);
  eq([0, 1, 5, 6].map((n) => H.score({ flagged: n }).factors[4].points), [10, 8, 0, 0]);
  eq([0, 1, 2, 5].map((n) => H.score({ lendersAlways: n }).factors[5].points), [0, 5, 10, 10]);
  eq([0, 1, 2, 3].map((n) => H.score({ adminsIdle: n }).factors[6].points), [5, 3, 1, 0]);
  eq([-1, '2', NaN, null, undefined, true, {}].map((n) => H.score({ staleSecrets: n }).factors[3].known), Array(7).fill(false), 'a count is a whole number from 0, or a list');
  eq(H.score({ staleSecrets: 2.7 }).factors[3].points, 4, '2.7 is 2');
  eq([true, false].map((v) => H.score({ versionLive: v }).factors[7].points), [5, 0]);
  eq(['yes', 1, null].map((v) => H.score({ versionLive: v }).factors[7].known), [false, false, false]);
  // (nothing read: no number to give)
  for (const x of [undefined, null, {}, { successRate: 'x' }]) { const n = H.score(x); eq([n.score, n.grade, n.known, n.enough, n.factors.length], [0, 'E', 0, false, 8], JSON.stringify(x)); eq(H.lift(n), []); }
  eq(H.lift(undefined), []);
  eq(H.lift({}), []);
  // (points are whole numbers and the score is 100 only when nothing is short)
  for (let i = 0; i < 200; i++) {
    const f = { setupOk: i % 10, setupTotal: 9, successRate: (i % 11) / 10, policyErrors: i % 7 === 0 ? 1 : 0, staleSecrets: i % 5, flagged: i % 4, lendersAlways: i % 3, adminsIdle: i % 2, versionLive: i % 6 !== 0 };
    const r = H.score(f);
    ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100 && r.factors.every((x) => Number.isInteger(x.points) && x.points >= 0 && x.points <= x.max), JSON.stringify([f, r]));
    ok((r.score === 100) === r.factors.every((x) => x.points === x.max), `100 only when nothing is short: ${JSON.stringify(f)} → ${r.score}`);
    ok(r.grade === H.gradeOf(r.score), 'the letter is the score\'s');
  }
});

/** the number of cells in each row of each table of a Markdown text (an escaped \| is not a cell's edge) */
const tables = (md) => {
  const out = []; let cur = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('|')) { (cur ??= []).push(line.replace(/\\\|/g, '').split('|').length - 2); } else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
};
await t('the report in Markdown: the same input gives the same text; each thing in its place; other people\'s words made harmless; links only to https; every table whole (pure)', () => {
  const sc = H.score({ setupOk: 6, setupTotal: 8, successRate: 0.8, policyErrors: [], staleSecrets: 2, flagged: 3, lendersAlways: 1, adminsIdle: 1, versionLive: false });
  const policy = P.checkPolicy({ roles: { admin: ['*'], write: ['dispatch', 'run.cancel'], auditor: ['audit.read'] }, teams: { auditors: 'auditor' }, confirm: ['secrets.delete'], idleMinutes: 30, audit: 'issue', adminsLend: true }).policy;
  const review = { flagged: 1, rows: [{ login: 'alice', kind: '持ち主', role: 'admin', last: '2026-10-07', days: 1, flags: [] }, { login: 'bob|*evil*', kind: 'メンバー', role: 'push', last: null, days: null, flags: ['実行の記録が見えない', '管理者（全部できる）'] }] };
  // (twelve failures, the newest first: the first with words that would be Markdown and HTML, the next with links)
  const failures = Array.from({ length: 12 }, (_, i) => ({ name: i === 0 ? 'ver|ify <b>x</b> [a](b) `c` _d_' : `wf${i}`, head_branch: i === 0 ? 'feat/<x>\nnew' : 'main', created_at: `2026-10-${String(20 - i).padStart(2, '0')}T01:02:03Z`,
    html_url: i === 0 ? 'https://github.com/o/lab/actions/runs/1' : i === 1 ? 'javascript:alert(1)' : i === 2 ? 'https://x.example/a(b)c' : '' }));
  const input = { lab: 'o/lab', date: '2026-10-08', score: sc, review, policy, policyErrors: [], failures: [...failures].reverse(), lenders: [{ slug: 'admin2/lab', always: true, runs: 3, minutes: 12 }, { where: 'x/y', always: false, runs: 0, minutes: 0 }, { name: 'z|z', runs: undefined, minutes: undefined }] };
  const md = H.report(input);
  eq(H.report(input), md, 'the same input, the same text');
  eq(H.report(JSON.parse(JSON.stringify(input))), md, 'and a copy of it');
  ok(md.endsWith('\n') && !md.endsWith('\n\n'), 'ends in one newline');
  eq(md.split('\n').filter((l) => /^#{1,2} /.test(l)), ['# bds-lab ラボの健康度の報告書', '## 点の内訳', '## 直すと点が上がること', '## アクセスの見直し', '## パネルのポリシー（.github/bds-lab-panel.json）', '## 最近の失敗', '## 時間を貸している人', '## 点の付け方']);
  ok(md.includes('- ラボ: o/lab\n- 日付: 2026-10-08\n- 健康度: **66 / 100**（評価 **C**）\n- 測れた項目: 8 / 8\n'), md.slice(0, 200));
  ok(md.includes('| 項目 | 点 | 満点 | 状況 |\n| --- | ---: | ---: | --- |\n') && md.includes('| 貸し手 | いつも貸す | 実行 | 分（見積もり） |\n| --- | --- | ---: | ---: |\n'), 'numbers to the right');
  ok(md.includes('| 準備 | 15 | 20 | 準備ができていないところが 2 個あります（6/8） |') && md.includes('| 秘密の古さ | 4 | 10 | 180 日以上そのままの秘密が 2 個あります |') && md.includes('| ページの版 | 0 | 5 |'), 'the points of each');
  ok(md.includes('1. 180 日以上そのままの秘密が 2 個あります（+6 点・パネルの「秘密」で）\n2. アクセスの棚卸しで見ておくことが 3 件あります（+6 点・パネルの「メンバー」で）\n3. 準備ができていないところが 2 個あります（6/8）（+5 点・パネルの「準備」で）\n'), 'what to mend first, with its gain and where');
  ok(md.includes('見ておくこと **1** 件（2 行）') && md.includes('| alice | 持ち主 | 管理者 | 2026-10-07 | — |') && md.includes('| bob\\|\\*evil\\* | メンバー | 書き込み | — | 実行の記録が見えない / 管理者（全部できる） |'), 'the review; a login with | and * is made safe');
  ok(md.includes('| admin | すべて |') && md.includes('| write | ワークフローを始める・実行を止める |') && md.includes('| auditor | 監査ログを見る |') && md.includes('- 確かめてから行う操作: 秘密を消す') && md.includes('- 操作がないときにサインアウトする: 30 分')
    && md.includes('- 監査ログ: 残す（issue）') && md.includes('- 管理者はいつも時間を貸す: はい') && md.includes('- チームの役割: auditors → auditor') && md.includes('- ポリシーの誤り: なし'), 'the policy');
  // (the ten newest of twelve; the two oldest are left out; other people's words, and links, made safe)
  const fl = md.split('## 最近の失敗')[1].split('## 時間を貸している人')[0], rows = fl.split('\n').filter((l) => l.startsWith('| 2026-'));
  ok(fl.includes('落ちた実行 12 件のうち、新しい 10 件:'), fl);
  eq(rows.map((r) => r.slice(2, 18)), Array.from({ length: 10 }, (_, i) => `2026-10-${20 - i} 01:02`), 'the newest first, ten of them');
  eq(rows[0], '| 2026-10-20 01:02 | [ver\\|ify \\<b\\>x\\</b\\> \\[a\\](b) \\`c\\` \\_d\\_](https://github.com/o/lab/actions/runs/1) | feat/\\<x\\> new |', 'escaped; a link to https');
  eq(rows[1], '| 2026-10-19 01:02 | wf1 | main |', 'a link to javascript: is only words');
  eq(rows[2], '| 2026-10-18 01:02 | [wf2](https://x.example/a%28b%29c) | main |', 'a ) in an address cannot end the link');
  ok(!/<b>|<x>/.test(md), 'no HTML tag gets through');
  eq(tables(md).map((r) => [r.length, r[0]]), [[10, 4], [4, 5], [5, 2], [12, 3], [5, 4]], 'the tables (heading, rule and rows): points, review, roles, failures, lenders — each row as wide as its heading, whatever was in the words');
  ok(tables(md).every((rowsOf) => rowsOf.every((n) => n === rowsOf[0])), 'whole');
  ok(md.includes('| admin2/lab | はい | 3 | 12 |') && md.includes('| x/y | いいえ | 0 | 0 |') && md.includes('| z\\|z | — | — | — |'), 'lenders: what is not known is —');
  ok(md.includes('合計 100 点（準備 20・実行の成功 25・ポリシー 15・秘密の古さ 10・アクセス 10・時間を貸す人 10・管理者の貸し出し 5・ページの版 5）') && md.includes('読めた項目の満点が 40 点に満たないときは、点を出しません') && md.includes('A: 90 点以上・B: 75 点以上・C: 60 点以上・D: 40 点以上・E: それより下'), 'how the points are given');
  ok(!/undefined|NaN|\[object|null/.test(md), md.match(/.*(undefined|NaN|\[object|null).*/)?.[0]);
});

await t('the report with little: nothing read, no score, no people, no policy, no lenders — it says so and holds no nonsense (pure)', () => {
  for (const input of [undefined, null, {}, { lab: undefined, date: 'soon' }, { score: H.score({}) }, { lab: { slug: 'o/lab' }, date: new Date('2026-10-08T05:00:00Z') }]) {
    const md = H.report(input);
    ok(md.startsWith('# bds-lab ラボの健康度の報告書\n') && !/undefined|NaN|\[object|null/.test(md), JSON.stringify(input) + md);
    ok(md.includes('まだ測れていません') && md.includes('読めていません（メンバーを読めるのはラボの管理者だけです）') && md.includes('最近の実行に、落ちたものはありません') && md.includes('読めた貸し手はいません'), md);
    ok(!md.includes('## 点の内訳') && !md.includes('## 直すと点が上がること'), 'no table of points when none was read');
  }
  ok(H.report({ lab: { slug: 'o/lab' }, date: new Date('2026-10-08T05:00:00Z') }).includes('- ラボ: o/lab\n- 日付: 2026-10-08\n'), 'the lab as an object, the date as a Date');
  ok(H.report({ date: 'soon' }).includes('- ラボ: （不明）\n- 日付: （不明）\n'));
  // (a score that was read but nothing to mend; a review with no one in it; a policy that allows nothing; a failure with no time or link)
  const md = H.report({ lab: 'o/lab', date: '2026-10-08', score: H.score({ successRate: 1 }), review: { flagged: 0, rows: [] }, policy: P.LOCKED_POLICY, policyErrors: ['roles: x'], failures: [{ name: 'a' }], lenders: [] });
  ok(md.includes('- 健康度: まだ測れていません（読めた項目が少なすぎます: 1 / 8）') && md.includes('| 実行の成功 | 25 | 25 |') && md.includes('- 直すところはありません') && md.includes('気になるところはありません（0 行）') && md.includes('**ポリシーの誤り 1 件**') && md.includes('roles: x') && md.includes('| — | a | — |'), md);
  ok(!/undefined|NaN|\[object|null/.test(md), md);
  eq(tables(md).every((rows) => rows.every((n) => n === rows[0])), true);
  eq(H.mdText('a|b*c_d`e<f>g[h]i~j#k&l\\m'), 'a\\|b\\*c\\_d\\`e\\<f\\>g\\[h\\]i\\~j\\#k\\&l\\\\m');
  eq([H.mdText(undefined), H.mdText(null), H.mdText('  a \n\t b  '), H.mdText('x'.repeat(200)).length, H.mdText('abcdef', 3)], ['', '', 'a b', 120, 'abc']);
  // (a token that got into a run's name, a branch, a login or an address: taken out before anything is written)
  eq(H.mdText('deploy ghp_abcdefghijklmnopqrstuvwx now'), 'deploy \\[消しました\\] now');
  const leaked = H.report({ lab: 'o/lab', date: '2026-10-08', failures: [{ name: 'a github_pat_11AAAAAAA0abcdefghijklmn', head_branch: 'b ghs_abcdefghijklmnopqrst', created_at: '2026-10-07T00:00:00Z', html_url: 'https://github.com/o/lab/actions/runs/1?token=ghp_abcdefghijklmnopqrstuvwx' }],
    review: { flagged: 0, rows: [{ login: 'eyJhbGciOiJIUzI1NiJ9.abc', kind: 'メンバー', role: 'push', last: null, flags: [] }] } });
  ok(!/ghp_|ghs_|github_pat_|eyJhbGci/.test(leaked) && leaked.includes('消しました'), leaked);
  eq([H.mdLink('t', 'https://example.com/a'), H.mdLink('t', 'http://example.com'), H.mdLink('t', 'javascript:alert(1)'), H.mdLink('t', 'https://a.example/x y'), H.mdLink('t', 'https://a.example/(x)'), H.mdLink('a|b', 'https://a.example/'), H.mdLink('t', undefined), H.mdLink('t', 'https://a.example/<x>')],
    ['[t](https://example.com/a)', 't', 't', 't', '[t](https://a.example/%28x%29)', '[a\\|b](https://a.example/)', 't', 't']);
});

// ---- the screens on a small DOM ----
function fakeDom() {
  const dom = { width: 0 };
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag, ns = null) { super(); Object.assign(this, { tagName: tag.toUpperCase(), ns, kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
    get clientWidth() { return dom.width; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type, ev = {}) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {}, ...ev }))); }
    click() { return this.fire('click'); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 340, height: 200 }; }
    focus() {}
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createElementNS: (ns, tag) => new E(tag, ns), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast, dom };
}
const { E, dom } = fakeDom();
const until = async (fn, what = 'it') => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 5)); } throw new Error(`${what} never came`); };
const NOW = Date.parse('2026-10-08T12:30:00Z');
/** runs at 10:00 UTC every day back from today (one a day), failing on every fifth; and two more of another workflow */
const labRuns = () => {
  const out = [];
  for (let d = 0; d < 60; d++) out.push(mk(iso(Date.parse('2026-10-08T10:00:00Z') - d * 86_400_000), 5, d % 5 === 0 ? 'failure' : 'success', { head_branch: 'main', id: 1000 + d }));
  out.push(mk('2026-10-07T20:00:00Z', 3, 'success', { name: 'pages', path: '.github/workflows/pages.yml', id: 2000 }), mk('2026-08-20T20:00:00Z', 3, 'success', { name: 'pages', path: '.github/workflows/pages.yml', id: 2001 }));
  return out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
};
/** GitHub as the screens read it: runs of the lab and of the hosts' host.yml (100 a page), the people; every call is kept */
function fakeGitHub({ lab = labRuns(), hosts = {}, fail = {} } = {}) {
  const log = [];
  const api = {
    log,
    call: async (method, p) => {
      log.push(`${method} ${p}`);
      const u = new URL(`https://x${p}`), m = /^\/repos\/([^/]+\/[^/]+)\/actions\/(?:workflows\/([^/]+)\/)?runs$/.exec(u.pathname);
      if (m) {
        if (fail[m[1]]) throw Object.assign(new Error(fail[m[1]]), { status: 404 });
        const all = m[2] ? hosts[m[1]] ?? [] : m[1] === 'o/lab' ? lab : [], per = Number(u.searchParams.get('per_page')), page = Number(u.searchParams.get('page') ?? 1);
        return { workflow_runs: all.slice((page - 1) * per, page * per) };
      }
      if (/\/collaborators$/.test(u.pathname)) return [{ login: 'o', permissions: { admin: true } }, { login: 'helper', permissions: { push: true } }];
      if (/\/invitations$/.test(u.pathname)) return [];
      throw Object.assign(new Error(`no ${p}`), { status: 404 });
    },
    runs: async (slug, { per = 20 } = {}) => { log.push(`runs ${slug} ${per}`); return lab.slice(0, per); },
    secrets: async () => { log.push('secrets'); return [{ name: 'A', updated_at: '2026-09-01T00:00:00Z' }, { name: 'B', updated_at: '2025-01-01T00:00:00Z' }, { name: 'C', updated_at: '2025-02-01T00:00:00Z' }]; },
  };
  return api;
}
const LAB = { slug: 'o/lab', repo: { owner: { login: 'o' }, visibility: 'public', permissions: { admin: true }, default_branch: 'main' }, role: 'admin', secrets: ['A'], workflows: [] };
const kids = (el, tag) => el.all((e) => e.tagName === tag.toUpperCase());
const tile = (root, label) => { const l = root.all((e) => e.tagName === 'DIV' && e.kids.length === 1 && e.textContent === label)[0]; return l?.parent.kids[1].textContent; };

await t('reading the runs: 100 a page, three pages at most, a short page ends it; only since a day; a workflow\'s own', async () => {
  const { readRuns, PER_PAGE, MAX_PAGES } = await imp('panel/ui/stats.mjs');
  eq([PER_PAGE, MAX_PAGES], [100, 3]);
  const mkApi = (n) => { const log = []; return { log, call: async (m, p) => { log.push(p); const page = Number(/[?&]page=(\d+)/.exec(p)[1]); return { workflow_runs: Array.from({ length: Math.max(0, Math.min(100, n - (page - 1) * 100)) }, (_, i) => ({ id: (page - 1) * 100 + i })) }; } }; };
  const a = mkApi(1000), r = await readRuns(a, 'o/lab', { since: '2026-07-09' });
  eq([r.length, a.log.length], [300, 3], 'three reads of a hundred, and no more');
  eq(r.map((x) => x.id).slice(98, 102), [98, 99, 100, 101], 'one after the other');
  eq(a.log, ['/repos/o/lab/actions/runs?per_page=100&page=1&created=%3E%3D2026-07-09', '/repos/o/lab/actions/runs?per_page=100&page=2&created=%3E%3D2026-07-09', '/repos/o/lab/actions/runs?per_page=100&page=3&created=%3E%3D2026-07-09']);
  const b = mkApi(150);
  eq([(await readRuns(b, 'o/lab')).length, b.log], [150, ['/repos/o/lab/actions/runs?per_page=100&page=1', '/repos/o/lab/actions/runs?per_page=100&page=2']], 'a short page ends it: no third read; no since: no filter');
  const c = mkApi(0); eq([(await readRuns(c, 'o/lab')).length, c.log.length], [0, 1]);
  const d = mkApi(100); eq([(await readRuns(d, 'o/lab')).length, d.log.length], [100, 2], 'a full page may have a next one');
  const e = mkApi(5); await readRuns(e, 'lender/host', { workflow: 'host.yml' }); eq(e.log, ['/repos/lender/host/actions/workflows/host.yml/runs?per_page=100&page=1']);
  eq(await readRuns({ call: async () => null }, 'o/lab'), [], 'GitHub gave nothing: none');
  let thrown = null; try { await readRuns({ call: async () => { throw new Error('GitHub: 403'); } }, 'o/lab'); } catch (x) { thrown = x.message; }
  eq(thrown, 'GitHub: 403', 'a refusal is the caller\'s to say');
});

await t('the 「統計」 tab: reads the lab (3 × 100) and each host\'s host.yml, draws the charts and tables, a period chosen without reading again, 読み直す reads again (fake GitHub, fake DOM)', async () => {
  const { statsTab } = await imp('panel/ui/stats.mjs');
  const host = (n) => Array.from({ length: n }, (_, i) => mk(iso(Date.parse('2026-10-08T09:00:00Z') - i * 86_400_000), 12, 'success', { name: 'host', path: '.github/workflows/host.yml' }));
  const api = fakeGitHub({ hosts: { 'lender/host': host(10), 'fork/lab': host(3) }, fail: { 'gone/host': 'Not Found' } });
  const body = new E('div'), found = [];
  const hosts = [{ slug: 'lender/host', repo: { html_url: 'https://github.com/lender/host' } }, { slug: 'fork/lab', repo: { html_url: 'javascript:alert(1)' } }, { slug: 'no/see', error: 'このトークンでは見えません' },
    { slug: 'both/odd', repo: { html_url: 'https://github.com/both/odd' }, error: 'x' }, { slug: 'gone/host', repo: { html_url: 'https://github.com/gone/host' } }];
  const data = await statsTab(body, { api, lab: LAB, hosts, tz: 'UTC', now: NOW, find: (n) => found.push(n) });
  // (what was read: only GETs of runs — the lab, 62 runs on one page, and the readable hosts' host.yml)
  ok(api.log.every((l) => l.startsWith('GET /repos/') && /\/actions\/(workflows\/host\.yml\/)?runs\?per_page=100&page=1&created=%3E%3D2026-07-09$/.test(l)), api.log.join('\n'));
  eq(api.log.map((l) => l.split('?')[0]).sort(), ['GET /repos/fork/lab/actions/workflows/host.yml/runs', 'GET /repos/gone/host/actions/workflows/host.yml/runs', 'GET /repos/lender/host/actions/workflows/host.yml/runs', 'GET /repos/o/lab/actions/runs'], 'a host with an error is not asked');
  eq([data.lab.length, data.hosts.map((x) => [x.slug, x.runs === null ? null : x.runs.length])], [62, [['lender/host', 10], ['fork/lab', 3], ['gone/host', null]]], 'a host that cannot be read is kept as not read');
  // (the first picture: 30 days)
  eq(body.all((e) => e.className === 'card').map((c) => c.kids[0].textContent), ['統計（o/lab）', 'この 30 日', '日ごとの実行', '通った割合', 'ワークフローごと', '通ったり落ちたりするもの', 'いつ始まるか', '使った分（見積もり）']);
  eq(kids(body, 'button').filter((b) => b.attrs['data-days']).map((b) => [b.attrs['data-days'], b.className, b.attrs['aria-pressed']]), [['7', '', 'false'], ['30', 'on', 'true'], ['90', '', 'false']]);
  // (30 days to 2026-10-08, UTC: 30 verify runs, one a day, failing on days 0 5 10 15 20 25 → 6 failed, 24 passed; and the pages run of the 7th)
  eq([tile(body, '始まった実行'), tile(body, '通った割合'), tile(body, '落ちた'), tile(body, 'かかった時間')], ['31', '81%', '6', '2 時間 33 分'], '31 runs, 25 of 31 passed (80.6%), 6 failed; 30 × 5 min + 3 min');
  // (the charts: SVG made with createElementNS, each with its table twin)
  const svgs = body.all((e) => e.tagName === 'SVG' && e.ns === 'http://www.w3.org/2000/svg');
  ok(svgs.length > 0 && body.all((e) => e.ns !== null).every((e) => e.ns === 'http://www.w3.org/2000/svg'), 'every SVG element is made in the SVG namespace');
  const [bars, rate] = svgs, heat = svgs.find((e) => /曜日と時間/.test(e.attrs['aria-label']));
  eq(svgs.length, 5, 'bars, the rate, one small line for each of the two workflows, the heat map');
  ok(/日ごとの実行の数: 30 日で 31 件/.test(bars.attrs['aria-label']) && bars.attrs.role === 'img' && bars.attrs.tabindex === '0', bars.attrs['aria-label']);
  ok(/日ごとの通った割合: いちばん新しい値 0%/.test(rate.attrs['aria-label']) && /曜日と時間ごとに始まった実行: いちばん多い所で 5 件/.test(heat.attrs['aria-label']), `${rate.attrs['aria-label']} | ${heat.attrs['aria-label']}`);
  eq(bars.all((e) => (e.tagName === 'PATH' || e.tagName === 'RECT') && e.style.fill === 'var(--bad)').length, 6, 'a red piece for each failed day');
  eq(bars.all((e) => e.style.fill === 'var(--accent)').length, 24, 'a blue piece for each day that had a pass: 24 days (the pages run is on a day with a verify run)');
  eq(heat.all((e) => e.tagName === 'RECT' && e.attrs.rx === '2').length, 168, '7 × 24 cells');
  eq(kids(body, 'details').map((d) => d.kids[0].textContent), ['📋 数字で見る（日ごと）', '📋 数字で見る（日ごと）', '📋 数字で見る（曜日と時間）', '📋 数字で見る（場所ごと）']);
  const dayTable = kids(kids(body, 'details')[0], 'tr');
  eq([dayTable.length, dayTable[1].kids.map((c) => c.textContent)], [31, ['2026-10-08（木）', '1', '0', '1', '0', '0%', '5 分 0 秒']], 'a row for each day, the newest first (and a head)');
  eq(dayTable[2].kids.map((c) => c.textContent), ['2026-10-07（水）', '2', '2', '0', '0', '100%', '8 分 0 秒'], 'the 7th: a verify run and the pages run, both passed');
  // (workflows: a row each, the busiest first, the file in data-wf; the name a button when the page can find its runs)
  const wf = body.all((e) => e.attrs['data-wf']);
  eq(wf.map((r) => [r.attrs['data-wf'], r.kids[1].textContent, r.kids[2].textContent, r.kids[3].textContent]), [['.github/workflows/verify.yml', '30', '80%24/30', '5 分 0 秒'], ['.github/workflows/pages.yml', '1', '100%1/1', '3 分 0 秒']]);
  eq(kids(wf[0], 'button').map((b) => b.textContent), ['verify']);
  await kids(wf[0], 'button')[0].click(); eq(found, ['verify'], 'the runs tab narrowed to the workflow');
  eq(kids(wf[0], 'svg').length, 1, 'a small line in the row');
  // (one run a day with a failure every fifth: passed, failed, passed … — eleven changes: flagged, once)
  eq(body.all((e) => e.attrs['data-flaky']).map((r) => [r.attrs['data-flaky'], r.textContent]), [['.github/workflows/verify.yml', '⚠️ verify main30 回のうち ✅ 24・❌ 6・入れ替わり 11 回']]);
  // (minutes: the lab 30 × 5 + 3 = 153; the lender 10 × 12 = 120; the fork 3 × 12 = 36; the host that could not be read, none)
  const mins = body.all((e) => e.attrs['data-where']);
  eq(mins.map((m) => [m.attrs['data-where'], m.kids[0].kids[1].textContent, m.kids[0].kids[2].textContent]), [['o/lab', '153 分', '31 回'], ['lender/host', '120 分', '10 回'], ['fork/lab', '36 分', '3 回'], ['gone/host', '0 分', '0 回']]);
  ok(mins[3].textContent.includes('読めません') && !mins[0].textContent.includes('読めません'), 'the host that was not read says so');
  eq(kids(mins[1], 'a').map((a) => a.attrs.href), ['https://github.com/lender/host'], 'a host with an https address is linked');
  eq(kids(mins[2], 'a').length, 0, 'one whose address is not https is words');
  eq(mins.map((m) => m.kids[1].kids[0].style.width), ['100%', '78%', '24%', '0%'], 'the bars: shares of the most (more than one place to compare)');
  // (another period: no new reads; 7 days to the 8th: 7 verify runs (days 0 and 5 failed) and the pages run of the 7th)
  const reads = api.log.length;
  await body.all((e) => e.attrs['data-days'] === '7')[0].click();
  eq(api.log.length, reads, 'the period is chosen from what was read');
  eq([tile(body, '始まった実行'), tile(body, '落ちた'), kids(body, 'button').filter((b) => b.attrs['data-days']).map((b) => [b.className, b.attrs['aria-pressed']])], ['8', '2', [['on', 'true'], ['', 'false'], ['', 'false']]], 'the chosen period is marked, for the eye and for a screen reader');
  ok(body.all((e) => e.tagName === 'SVG' && e.attrs.role === 'img')[0].attrs['aria-label'].includes('7 日で 8 件'));
  await body.all((e) => e.attrs['data-days'] === '90')[0].click();
  eq(tile(body, '始まった実行'), '62', '90 days: all 62 — the pages run of August (the 20th, 49 days ago) is in now');
  ok(!body.textContent.includes('読めたのは新しい'), 'all of it was read: no warning');
  // (読み直す: reads again, at once — not from what was kept)
  await kids(body, 'button').filter((b) => b.textContent === '読み直す')[0].click();
  eq(api.log.length - reads, 4, 'again: the lab and the three hosts that can be read');
  // (going to another tab and back, within a minute: from what was kept — the same client and lab; after it, read again)
  const again = api.log.length;
  await statsTab(new E('div'), { api, lab: LAB, hosts, tz: 'UTC', now: NOW + 30_000 });
  eq(api.log.length, again, 'kept for a minute');
  await statsTab(new E('div'), { api, lab: LAB, hosts, tz: 'UTC', now: NOW + 61_000 });
  eq(api.log.length - again, 4, 'and read again after it');
  // (a clock set back: what was read "later" than now is not trusted)
  const back = api.log.length;
  await statsTab(new E('div'), { api, lab: LAB, hosts, tz: 'UTC', now: NOW - 5_000 });
  eq(api.log.length - back, 4, 'a reading from the future is read again');
  await statsTab(new E('div'), { api: fakeGitHub(), lab: LAB, hosts, tz: 'UTC', now: NOW + 30_000 });
  // (another client — another sign-in — keeps its own)
  const other = fakeGitHub();
  await statsTab(new E('div'), { api: other, lab: LAB, hosts, tz: 'UTC', now: NOW + 30_000 });
  eq(other.log.length, 4, 'another client reads for itself');
});

await t('the drawing: the stack in its order with 2 px of surface between, no bar thicker than 24 px however wide, the heat map one hue darker for more with an empty cell in --chip (fake DOM)', async () => {
  const { statsTab } = await imp('panel/ui/stats.mjs');
  // (one day, the 8th: one failed, two passed, one cancelled)
  const lab = [mk('2026-10-08T01:00:00Z', 5, 'failure'), mk('2026-10-08T02:00:00Z', 5), mk('2026-10-08T03:00:00Z', 5), mk('2026-10-08T04:00:00Z', 5, 'cancelled')];
  const pieces = (svg) => svg.all((e) => (e.tagName === 'RECT' || e.tagName === 'PATH') && ['var(--bad)', 'var(--accent)', 'var(--muted)'].includes(e.style.fill));
  const narrow = new E('div');
  await statsTab(narrow, { api: fakeGitHub({ lab }), lab: LAB, hosts: [], tz: 'UTC', now: NOW });
  const p = pieces(kids(narrow, 'svg')[0]);
  eq(p.map((x) => [x.tagName, x.style.fill, x.style.fillOpacity]), [['RECT', 'var(--bad)', '1'], ['RECT', 'var(--accent)', '1'], ['PATH', 'var(--muted)', '0.45']], 'failed at the foot, then passed, then the rest as a wash; the top piece has its end rounded');
  // (a scale of 4 over 132 px: 33 px a run — failed y 115, 33 high; passed 64 high above it, with its foot 2 px up from the failed one's top)
  eq([p[0].attrs.y, p[0].attrs.height, p[1].attrs.y, p[1].attrs.height], ['115', '33', '49', '64']);
  eq(Number(p[0].attrs.y) - (Number(p[1].attrs.y) + Number(p[1].attrs.height)), 2, '2 px of surface between the pieces');
  ok(/^M[\d.]+ 47V/.test(p[2].attrs.d), `the top piece stands on the passed one with the same 2 px: ${p[2].attrs.d}`);
  eq(p[0].attrs.width, '7.9', 'at a phone\'s width 30 days leave 7.9 px for a bar');
  // (the axes: the marks of a scale of 4, the busiest day's total over its bar, a date for every sixth day back from the newest)
  eq(kids(kids(narrow, 'svg')[0], 'text').map((x) => x.textContent), ['0', '1', '2', '3', '4', '4', '10/8', '10/2', '9/26', '9/20', '9/14']);
  eq(kids(kids(narrow, 'svg')[1], 'text').map((x) => x.textContent), ['0%', '50%', '100%', '10/8', '10/2', '9/26', '9/20', '9/14', '67%'], 'the marks of the scale, the days, and the last value written by its dot: 2 of the 3 that ended passed');
  // (wide: the bars stop at 24 px)
  dom.width = 1000;
  try {
    const wide = new E('div');
    await statsTab(wide, { api: fakeGitHub({ lab }), lab: LAB, hosts: [], tz: 'UTC', now: NOW });
    const q = pieces(kids(wide, 'svg')[0]);
    eq([q[0].attrs.width, q[1].attrs.width], ['24', '24'], 'no bar thicker than 24 px');
    eq(kids(wide, 'svg')[0].attrs.width, '1000', 'drawn at the width it has');
    ok(Number(kids(narrow, 'svg')[0].attrs.width) === 340, 'and at 340 when it has none');
  } finally { dom.width = 0; }
  // (the heat map: two runs in one cell (Thursday 10:00) and one in another (Friday 11:00): the most is the darkest, half of it half dark)
  const heatRuns = [mk('2026-10-08T10:05:00Z', 1), mk('2026-10-08T10:50:00Z', 1), mk('2026-10-02T11:00:00Z', 1)];
  const hb = new E('div');
  await statsTab(hb, { api: fakeGitHub({ lab: heatRuns }), lab: LAB, hosts: [], tz: 'UTC', now: NOW });
  const heat = kids(hb, 'svg').find((e) => /曜日と時間/.test(e.attrs['aria-label'])), cells = heat.all((e) => e.tagName === 'RECT' && e.attrs.rx === '2');
  // (the cells are 13.08 wide, 14 high, from x 22 and y 16: Thursday 10:00 at 153.8, 73; Friday 11:00 at 166.9, 87)
  eq(cells.filter((c) => c.style.fill === 'var(--accent)').map((c) => [c.attrs.x, c.attrs.y, c.style.fillOpacity]), [['153.8', '73', '1'], ['166.9', '87', '0.5']], 'two cells have runs: the busier one fully, the other half');
  eq(cells.filter((c) => c.style.fill === 'var(--chip)').length, 166, 'every other cell is empty: --chip');
  ok(cells.every((c) => c.style.fill !== 'var(--chip)' || c.style.fillOpacity === '1'), 'an empty cell is the plain --chip');
});

await t('the readout of a chart: the numbers of the day under the pointer, every series, values first; the arrow keys do the same; it goes when the pointer leaves; touch leaves it up', async () => {
  const { statsTab } = await imp('panel/ui/stats.mjs');
  const body = new E('div');
  await statsTab(body, { api: fakeGitHub(), lab: LAB, hosts: [], tz: 'UTC', now: NOW });
  const box = body.all((e) => e.tagName === 'DIV' && e.style.position === 'relative')[0], svg = kids(box, 'svg')[0], tip = box.all((e) => e.attrs.role === 'status')[0];
  const hit = svg.all((e) => e.tagName === 'RECT' && e.attrs.fill === 'transparent')[0];
  eq(tip.style.display, 'none', 'nothing before the pointer comes');
  // (340 wide: the plot runs from 38 to 334 for 30 days, 9.87 px each; the last day, the 8th, is the 30th: its middle is x 329)
  await hit.fire('pointermove', { clientX: 329, clientY: 50 });
  eq(tip.style.display, 'block');
  eq(tip.textContent, '10/8（木）　計 1 件1❌ 落ちた0✅ 通った0➖ そのほか', 'the 8th: the one verify run, failed (day 0)');
  await hit.fire('pointermove', { clientX: 319, clientY: 50 });
  eq(tip.textContent, '10/7（水）　計 2 件0❌ 落ちた2✅ 通った0➖ そのほか', 'the day before: the verify run and the pages run, both passed');
  ok(parseFloat(tip.style.left) >= 0 && tip.style.top === '16px', JSON.stringify(tip.style));
  // (the 11th column, the 19th of September, spans x 136.7 – 146.5: the day is the column the pointer is in, not the nearest middle)
  await hit.fire('pointermove', { clientX: 145, clientY: 50 });
  ok(tip.textContent.startsWith('9/19（土）'), tip.textContent);
  await hit.fire('pointermove', { clientX: 137, clientY: 50 });
  ok(tip.textContent.startsWith('9/19（土）'), tip.textContent);
  await hit.fire('pointerleave', { pointerType: 'touch' });
  eq(tip.style.display, 'block', 'a lifted finger leaves the numbers up');
  await hit.fire('pointerleave', { pointerType: 'mouse' });
  eq(tip.style.display, 'none', 'the mouse leaving takes them away');
  // (keys: focus shows the newest day; left goes back a day; right does not go past the newest; blur hides)
  const day = () => tip.textContent.match(/^\d+\/\d+（.）/)[0], key = (k) => svg.fire('keydown', { key: k });
  await svg.fire('focus'); eq(day(), '10/8（木）');
  await key('ArrowLeft'); eq(day(), '10/7（水）');
  await key('ArrowLeft'); await key('ArrowLeft'); eq(day(), '10/5（月）');
  await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight'); eq(day(), '10/8（木）', 'not past the newest');
  for (let i = 0; i < 40; i++) await key('ArrowLeft');
  eq(day(), '9/9（水）', 'nor before the first of the 30 days');
  let kept = false; await svg.fire('keydown', { key: 'Enter', preventDefault() { kept = true; } }); eq(kept, false, 'other keys are left alone');
  await svg.fire('keydown', { key: 'toString', preventDefault() { kept = true; } }); eq(kept, false, 'a name from Object is no key');
  await svg.fire('blur'); eq(tip.style.display, 'none');
  // (the rate chart: its day's share and counts)
  const rbox = body.all((e) => e.tagName === 'DIV' && e.style.position === 'relative')[1], rsvg = kids(rbox, 'svg')[0], rtip = rbox.all((e) => e.attrs.role === 'status')[0];
  await rsvg.fire('focus'); await rsvg.fire('keydown', { key: 'ArrowLeft' });
  eq(rtip.textContent, '10/7（水）100%通った割合2✅ 通った0❌ 落ちた');
  // (the heat map: 7 rows of 24; the keys start at Sunday 0:00 and go by hour and by day)
  const heatBox = body.all((e) => e.tagName === 'DIV' && e.style.position === 'relative')[2], hsvg = kids(heatBox, 'svg')[0], htip = heatBox.all((e) => e.attrs.role === 'status')[0];
  const hhit = hsvg.all((e) => e.tagName === 'RECT' && e.attrs.fill === 'transparent')[0];
  const hkey = (k) => hsvg.fire('keydown', { key: k });
  await hsvg.fire('focus'); eq(htip.textContent, '日曜日 0 時台0始まった実行');
  await hkey('ArrowDown'); await hkey('ArrowRight'); ok(htip.textContent.startsWith('月曜日 1 時台'), htip.textContent);
  await hkey('ArrowUp'); await hkey('ArrowUp'); ok(htip.textContent.startsWith('日曜日 1 時台'), `not above the first row: ${htip.textContent}`);
  await hkey('ArrowLeft'); await hkey('ArrowLeft'); ok(htip.textContent.startsWith('日曜日 0 時台'), `at the start it stays: ${htip.textContent}`);
  for (let i = 0; i < 8; i++) await hkey('ArrowDown');
  ok(htip.textContent.startsWith('土曜日 0 時台'), `not below the last row: ${htip.textContent}`);
  // (a cell by the pointer: labels 22 wide, 7 rows from y 16 — Thursday 10:00, where each of the five Thursdays of the 30 days has its run)
  const cw = (340 - 22 - 4) / 24, ch = Math.max(14, Math.min(22, cw));
  await hhit.fire('pointermove', { clientX: 22 + 10.5 * cw, clientY: 16 + 4.5 * ch });
  eq(htip.textContent, '木曜日 10 時台5始まった実行');
  await hhit.fire('pointermove', { clientX: 5, clientY: 30 });
  eq(htip.style.display, 'none', 'off the cells: nothing');
});

await t('reading again keeps the last picture, dimmed, until the new numbers come (the tab and the card)', async () => {
  const { statsTab } = await imp('panel/ui/stats.mjs'), { healthCard } = await imp('panel/ui/health.mjs');
  // (the tab: a read that waits to be let go)
  let release; const gate = new Promise((r) => { release = r; });
  const api = fakeGitHub(), call = api.call;
  const body = new E('div'), first = statsTab(body, { api, lab: LAB, hosts: [], tz: 'UTC', now: NOW });
  const out = body.kids.at(-1);
  await first; eq(out.style.opacity, '', 'drawn: not dimmed');
  api.call = async (...a) => { await gate; return call(...a); };
  const again = kids(body, 'button').filter((b) => b.textContent === '読み直す')[0].click();
  await until(() => out.style.opacity === '0.55', 'the dimming');
  ok(kids(out, 'svg').length > 0, 'the last picture is still there');
  release(); await again;
  eq(out.style.opacity, '', 'the new numbers drawn: not dimmed');
  // (the card)
  let free; const hold = new Promise((r) => { free = r; });
  const card = healthCard({ api: fakeGitHub(), lab: LAB, hosts: [], policyErrors: [], version: { state: 'live', say: '' }, now: NOW, checks: async () => { await hold; return [{ ok: true }]; }, go() {} });
  await until(() => card.style.opacity === '0.55', 'the card dimmed');
  free(); await until(() => !card.textContent.includes('測っています'), 'the card');
  eq(card.style.opacity, '');
});

await t('the 「統計」 tab when it cannot read, when there is nothing in the period, and when only the newest 300 were read (fake GitHub, fake DOM)', async () => {
  const { statsTab } = await imp('panel/ui/stats.mjs');
  // (a refusal: said in the tab, in words; no chart)
  const bad = new E('div');
  eq(await statsTab(bad, { api: { call: async () => { throw new Error('GitHub: 見つかりません'); } }, lab: LAB, hosts: [], tz: 'UTC', now: NOW }), undefined);
  ok(bad.textContent.includes('GitHub: 見つかりません') && !kids(bad, 'svg').length && bad.all((e) => e.className === 'bad').length === 1, bad.textContent);
  // (no run at all: the numbers say nothing, the charts are not drawn; the lab's minutes are still there)
  const none = new E('div');
  await statsTab(none, { api: fakeGitHub({ lab: [] }), lab: LAB, hosts: [], tz: 'UTC', now: NOW });
  ok(none.textContent.includes('この 30 日に始まった実行はありません') && !kids(none, 'svg').length, none.textContent);
  eq([tile(none, '始まった実行'), tile(none, '通った割合'), tile(none, '落ちた'), tile(none, 'かかった時間')], ['0', '—', '0', '—']);
  eq(none.all((e) => e.attrs['data-where']).map((e) => e.attrs['data-where']), ['o/lab']);
  eq([none.all((e) => e.className === 'bar').length, none.all((e) => e.attrs['data-where'])[0].textContent], [0, 'ラボ（o/lab）0 分0 回'], 'the lab alone: a number, no bar to compare with');
  // (runs only long ago: none in 30 days, and all of them in 90)
  const old = new E('div');
  await statsTab(old, { api: fakeGitHub({ lab: [mk('2026-07-15T00:00:00Z', 1)] }), lab: LAB, hosts: [], tz: 'UTC', now: NOW });
  ok(old.textContent.includes('この 30 日に始まった実行はありません'), old.textContent);
  await old.all((e) => e.attrs['data-days'] === '90')[0].click();
  eq(tile(old, '始まった実行'), '1');
  // (300 read, and the oldest of them is newer than the window's first day: said, with the day it reaches back to)
  const many = Array.from({ length: 400 }, (_, i) => mkMs(iso(Date.parse('2026-10-08T11:00:00Z') - i * 3_600_000), 300_000, 'success', { id: 5000 + i }));
  const cut = new E('div'), api = fakeGitHub({ lab: many });
  await statsTab(cut, { api, lab: LAB, hosts: [], tz: 'UTC', now: NOW });
  eq(api.log.length, 3, 'three reads');
  ok(cut.textContent.includes('読めたのは新しい 300 件（2026-09-26 から）だけです: 30 日の全部ではありません'), cut.textContent.slice(0, 300));
  eq(tile(cut, '始まった実行'), '300');
  await cut.all((e) => e.attrs['data-days'] === '7')[0].click();
  ok(!cut.textContent.includes('読めたのは新しい'), 'a period the 300 cover is whole: no warning');
  eq(tile(cut, '始まった実行'), '156', 'the 7 days: one an hour from the 2nd 00:00 to the 8th 11:00 — 6 days of 24 and 12 hours');
});

await t('the 「健康度」 card: the points and the letter, the three things to mend first each with its tab, what could not be read counted out, 測り直す reads again, kept five minutes (fake GitHub, fake DOM)', async () => {
  const { healthCard, readFacts } = await imp('panel/ui/health.mjs');
  const api = fakeGitHub(), went = [];
  // (the lab: 6 of 8 checks (one cannot be told); 62 runs, 50 passed and 12 failed; a sound policy that makes administrators lend; two secrets over 180 days;
  // the owner sees one fork that lends always and one that does not, and an administrator who does not; one person to look at; the page is not the newest)
  const ctx = { api, lab: LAB, hosts: [], me: { login: 'o' }, config: {}, panelUrl: 'https://o.github.io/lab/', policy: P.checkPolicy({ adminsLend: true }).policy, policyErrors: [], version: { state: 'newer', say: 'x' }, now: NOW,
    checks: async () => [{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: false }, { ok: false }, { ok: null }],
    lending: async () => ({ list: [{ slug: 'a/lab', owner: 'a', always: { ok: true }, admin: true }, { slug: 'b/lab', owner: 'b', always: { ok: false, why: ['x'] }, admin: false }], idle: ['c'], admins: ['a', 'c'] }),
    go: (tab) => went.push(tab), reload: () => went.push('reload') };
  const card = healthCard(ctx);
  ok(card.attrs.id === 'labhealth' && card.className === 'card' && card.textContent.includes('測っています'), 'a card at once, filled when read');
  await until(() => !card.textContent.includes('測っています'), 'the card');
  const sc = (await readFacts(ctx)).score;
  eq(sc.factors.map((x) => `${x.key} ${x.points}/${x.max}`), ['setup 15/20', 'runs 20/25', 'policy 15/15', 'secrets 4/10', 'access 8/10', 'lenders 5/10', 'admins 3/5', 'version 0/5'], 'setup 6 of 8; 50 of 62 passed; a sound policy; two old secrets; one person to look at; one lender; one administrator idle; the page behind');
  eq([sc.score, sc.grade, sc.known, sc.enough], [70, 'C', 8, true]);
  ok(card.textContent.includes('70') && card.textContent.includes('評価 C') && card.textContent.includes('/ 100') && card.textContent.includes('8/8 項目で測りました') && !card.textContent.includes('数えません'), card.textContent.slice(0, 200));
  // (the three that would raise it most, with their buttons: the biggest gap, then the next two in the order of the list)
  const rows = card.all((e) => e.attrs['data-factor'] && e.className === 'row');
  eq(rows.map((r) => r.attrs['data-factor']), ['secrets', 'setup', 'runs']);
  ok(rows.every((r) => kids(r, 'button').length === 1), 'a button each');
  eq(rows.map((r) => [r.kids[0].textContent, kids(r, 'button')[0].textContent]), [['⚠️ 180 日以上そのままの秘密が 2 個あります（+6 点）', '「秘密」を開く'], ['⚠️ 準備ができていないところが 2 個あります（6/8）（+5 点）', '「準備」を開く'], ['⚠️ 最近の実行の 81% が通っています（+5 点）', '「進み具合」を開く']].map(([a, b]) => [a.replace('81%', '81%'), b]));
  await kids(rows[0], 'button')[0].click(); await kids(rows[1], 'button')[0].click();
  eq(went, ['secrets', 'setup'], 'the button goes to the tab where it is mended');
  // (the numbers behind: every factor, with what was read)
  eq(card.all((e) => e.tagName === 'TR' && e.attrs['data-factor']).map((r) => r.kids.map((c) => c.textContent).slice(0, 3).join('|')), ['準備|15|20', '実行の成功|20|25', 'ポリシー|15|15', '秘密の古さ|4|10', 'アクセス|8|10', '時間を貸す人|5|10', '管理者の貸し出し|3|5', 'ページの版|0|5']);
  ok(card.textContent.includes('📋 数字で見る（点の内訳）'));
  // (a thing mended by reading the page again has no tab: its button reads the page again)
  const lagging = healthCard({ ...ctx, api: fakeGitHub(), runs: [mk('2026-10-08T00:00:00Z', 1)], checks: async () => [{ ok: true }], lending: undefined, lab: { ...LAB, role: 'write' } });
  await until(() => !lagging.textContent.includes('測っています'), 'a second card');
  const vrow = lagging.all((e) => e.attrs['data-factor'] === 'version' && e.className === 'row')[0];
  eq(kids(vrow, 'button').map((b) => b.textContent), ['読み直す']);
  await kids(vrow, 'button')[0].click(); eq(went.at(-1), 'reload', 'ctx.reload');
  // (a card reads for itself each time it is drawn — what was just mended shows — and 測り直す reads again)
  const calls = api.log.length;
  const second = healthCard({ ...ctx, now: NOW + 1000 });
  await until(() => !second.textContent.includes('測っています'), 'the second card');
  ok(api.log.length > calls, 'drawn again: read again');
  const before = api.log.length;
  await kids(second, 'button').filter((b) => b.textContent === '測り直す')[0].click();
  ok(api.log.length > before, '測り直す reads again at once');
  // (no age asked: every call reads, even in the same moment, even when the clock was set back)
  const same = api.log.length, later = { ...ctx, now: NOW + 500_000 };
  await readFacts(later); await readFacts(later); await readFacts({ ...ctx, now: NOW - 5_000 });
  ok(api.log.length >= same + 3 * 3, `${api.log.length - same} calls for three readings`);
  const asked = await readFacts({ ...ctx, now: NOW - 5_000 }, { maxAge: 60_000 }), now0 = api.log.length;
  await readFacts({ ...ctx, now: NOW - 5_000 }, { maxAge: 60_000 });
  eq(api.log.length, now0, 'and a reading made at that clock is reused when it is young');
  ok(asked.score.known === 8);
  // (what the panel knows itself is taken as it is now, even from a reading made before: the policy mended, the page renewed)
  const mended = await readFacts({ ...ctx, policyErrors: ['x'], version: { state: 'newer', say: '' } });
  const kept = await readFacts({ ...ctx, policyErrors: [], version: { state: 'live', say: '' } }, { maxAge: 60_000 });
  eq([mended.score.factors[2].points, kept.score.factors[2].points, mended.score.factors[7].points, kept.score.factors[7].points], [0, 15, 0, 5], 'the same reading, the new policy and page');
  const log = api.log.length;
  await readFacts({ ...ctx, policyErrors: [] }, { maxAge: 60_000 });
  eq(api.log.length, log, 'a reading no older than asked for is not made again');
  await readFacts({ ...ctx, policyErrors: [] }, { maxAge: 60_000, fresh: true });
  ok(api.log.length > log, 'unless a fresh one is asked for');
  const young = api.log.length;
  await readFacts({ ...ctx, policyErrors: [], now: NOW + 120_000 }, { maxAge: 60_000 });
  ok(api.log.length > young, 'an older one is');
  // (all well: nothing to mend)
  const fine = healthCard({ ...ctx, api: Object.assign(fakeGitHub({ lab: [mk('2026-10-08T00:00:00Z', 1)] }), { secrets: async () => [{ name: 'A', updated_at: '2026-09-01T00:00:00Z' }] }), checks: async () => [{ ok: true }], version: { state: 'live', say: '' }, lending: async () => ({ list: [{ slug: 'a/lab', owner: 'a', always: { ok: true } }, { slug: 'b/lab', owner: 'b', always: { ok: true } }], idle: [] }), lab: { ...LAB, role: 'write' } });
  await until(() => !fine.textContent.includes('測っています'), 'the fine card');
  ok(fine.textContent.includes('評価 A') && fine.textContent.includes('100') && fine.textContent.includes('✅ 直すところはありません') && fine.textContent.includes('7/8 項目で測りました'), fine.textContent);
});

await t('the readings the card makes: the share that passed counts only what ended passed or failed; administrators idle only where the policy says they must lend; nothing a sign-in may not read is guessed (fake GitHub)', async () => {
  const { readFacts } = await imp('panel/ui/health.mjs');
  const base = (over = {}) => ({ api: fakeGitHub(), lab: LAB, hosts: [], policyErrors: [], version: { state: 'live', say: '' }, now: NOW, checks: async () => [{ ok: true }], ...over });
  // (3 passed, 1 failed, 2 cancelled, 1 going: 3 of the 4 that ended passed or failed — 19 of 25 points, not 3 of 7)
  const runs = [mk('2026-10-08T01:00:00Z', 1), mk('2026-10-08T02:00:00Z', 1), mk('2026-10-08T03:00:00Z', 1), mk('2026-10-08T04:00:00Z', 1, 'failure'), mk('2026-10-08T05:00:00Z', 1, 'cancelled'), mk('2026-10-08T06:00:00Z', 1, 'cancelled'), { ...mk('2026-10-08T07:00:00Z', 1), status: 'in_progress', conclusion: null }];
  const f = await readFacts(base({ runs }));
  eq(f.score.factors[1].points, 19, '3 of 4');
  eq(f.failures.length, 1, 'the failed ones, for the report');
  eq(f.runs.length, 7);
  // (only cancelled ones: no share to tell)
  eq((await readFacts(base({ runs: [mk('2026-10-08T05:00:00Z', 1, 'cancelled')] }))).score.factors[1].known, false);
  // (administrators idle count where the policy makes them lend; the lenders are counted either way)
  const lending = async () => ({ list: [{ slug: 'a/lab', owner: 'a', always: { ok: true } }], idle: ['c', 'd'] });
  const lax = (await readFacts(base({ lending, policy: P.DEFAULT_POLICY }))).score.factors;
  eq([lax[5].known, lax[5].points, lax[6].known], [true, 5, false], 'the policy does not make them lend: not counted');
  const strict = (await readFacts(base({ api: fakeGitHub(), lending, policy: P.checkPolicy({ adminsLend: true }).policy }))).score.factors;
  eq([strict[6].known, strict[6].points], [true, 1], 'where it does: two idle');
  // (not the owner: no lending to read — neither the lenders nor the administrators are guessed; not an administrator: the people are not read)
  const w = (await readFacts(base({ api: fakeGitHub(), lab: { ...LAB, role: 'write' }, lending: undefined }))).score.factors;
  eq(w.map((x) => x.known), [true, true, true, true, false, false, false, true], 'setup, runs, policy, secrets and the page; not the people, the lenders or the administrators');
  const none = await readFacts(base({ api: fakeGitHub(), lab: { ...LAB, role: 'write' }, lending: undefined, policyErrors: undefined, version: undefined, checks: async () => { throw new Error('x'); }, runs: [] }));
  eq([none.score.known, none.review, none.lending, none.runs, none.failures], [1, null, null, [], []], 'only the secrets could be read');
  // (what GitHub says wrong: a list of nothing, secrets that are not a list, lenders without their shape)
  const odd = await readFacts(base({ api: { runs: async () => 'x', secrets: async () => ({}), call: async () => { throw new Error('x'); } }, lending: async () => ({ list: 5 }), checks: async () => ({}) }));
  ok(Number.isInteger(odd.score.score) && odd.runs.length === 0, JSON.stringify(odd.score));
  // (a refusal does not stop the report: GitHub's own words never reach the score)
  const refused = await readFacts(base({ api: { runs: async () => { throw Object.assign(new Error('GitHub: 403 token ghp_secretsecretsecret'), { status: 403 }); }, secrets: async () => { throw new Error('x'); }, call: async () => { throw new Error('x'); } }, runs: undefined }));
  ok(!JSON.stringify(refused).includes('ghp_') && refused.runs.length === 0);
});

await t('the 「健康度」 card for someone who may not read much: what was not read is out of the score and said; nothing read says it cannot tell; too little read gives no number; the readings never throw (fake DOM)', async () => {
  const { healthCard } = await imp('panel/ui/health.mjs');
  // (a writer: no secrets, no people, no lenders; the policy, the runs and the page are known: 40 of 45 points)
  const refuse = Object.assign(fakeGitHub(), { secrets: async () => { throw Object.assign(new Error('403'), { status: 403 }); } });
  const w = healthCard({ api: refuse, lab: { ...LAB, role: 'write' }, hosts: [], policyErrors: [], version: { state: 'live', say: '' }, now: NOW, checks: async () => { throw new Error('no'); }, go() {} });
  await until(() => !w.textContent.includes('測っています'), 'the writer\'s card');
  ok(w.textContent.includes('3/8 項目で測りました（この役割・設定で読めないものは数えません）') && w.textContent.includes('89') && w.textContent.includes('評価 B'), w.textContent);
  const trs = w.all((e) => e.tagName === 'TR' && e.attrs['data-factor']);
  eq(trs.filter((r) => r.kids[1].textContent === '—').map((r) => r.attrs['data-factor']), ['setup', 'secrets', 'access', 'lenders', 'admins'], 'not read: —');
  // (nothing at all: no runs, nothing known)
  const none = healthCard({ api: { runs: async () => { throw new Error('x'); }, secrets: async () => { throw new Error('x'); } }, lab: { ...LAB, role: 'read' }, hosts: [], now: NOW, checks: async () => null, go() {} });
  await until(() => !none.textContent.includes('測っています'), 'the empty card');
  ok(none.textContent.includes('まだ測れません: この役割では、読めるものがありませんでした') && !none.textContent.includes('評価') && none.textContent.includes('0/8 項目で測りました'), none.textContent);
  eq(none.all((e) => e.attrs['data-factor'] && e.className === 'row').length, 0, 'nothing to mend: no buttons');
  // (only the page's version read: an A that would tell nothing is not given — but what could be mended is still shown)
  const little = healthCard({ api: { runs: async () => [] , secrets: async () => { throw new Error('x'); } }, lab: { ...LAB, role: 'read' }, hosts: [], version: { state: 'newer', say: '' }, now: NOW, checks: async () => null, go() {}, reload() {} });
  await until(() => !little.textContent.includes('測っています'), 'the little card');
  ok(little.textContent.includes('まだ測れません: この役割・設定では、読めた項目が少なすぎます') && !little.textContent.includes('評価') && little.all((e) => e.attrs['data-factor'] === 'version' && e.className === 'row').length === 1, little.textContent);
  // (a run list that GitHub cut short or filled with junk)
  const odd = healthCard({ api: fakeGitHub(), lab: LAB, hosts: [], runs: [null, { status: 'completed', conclusion: 'success' }, 7], policyErrors: [], now: NOW, checks: async () => [], go() {} });
  await until(() => !odd.textContent.includes('測っています'), 'the odd card');
  ok(!odd.textContent.includes('NaN') && !odd.textContent.includes('undefined'), odd.textContent);
});

await t('the report button: reads, makes the Markdown in this page — a Blob and a link to download, nothing sent; again replaces the file (fake GitHub, fake DOM)', async () => {
  const { reportButton } = await imp('panel/ui/health.mjs');
  const made = [], revoked = [], real = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = (b) => { made.push(b); return `blob:fake/${made.length}`; }; URL.revokeObjectURL = (u) => { revoked.push(u); };
  try {
    // (a/lab's host.yml: four runs of ten minutes in the last four days, one 20 days ago, one 40 days ago — only 30 days count)
    const host = [...Array.from({ length: 4 }, (_, i) => mk(iso(Date.parse('2026-10-08T09:00:00Z') - i * 86_400_000), 10, 'success', { name: 'host', path: '.github/workflows/host.yml' })),
      mk(iso(Date.parse('2026-10-08T09:00:00Z') - 20 * 86_400_000), 10, 'success', { name: 'host', path: '.github/workflows/host.yml' }), mk(iso(Date.parse('2026-10-08T09:00:00Z') - 40 * 86_400_000), 10, 'success', { name: 'host', path: '.github/workflows/host.yml' })];
    const api = fakeGitHub({ hosts: { 'a/lab': host }, fail: { 'gone/lab': 'Not Found' } });
    const ctx = { api, lab: LAB, hosts: [], me: { login: 'o' }, policy: P.checkPolicy({ roles: { admin: ['*'], write: ['dispatch'] }, adminsLend: true }).policy, policyErrors: [], version: { state: 'live', say: '' }, now: NOW, tz: 'Asia/Tokyo',
      checks: async () => [{ ok: true }, { ok: false }], go() {},
      lending: async () => ({ list: [{ slug: 'a/lab', owner: 'a', always: { ok: true }, admin: true }, { slug: 'zz/lab', owner: 'zz', always: { ok: false, why: [] }, admin: false }, { slug: 'gone/lab', owner: 'gone', always: { ok: true }, admin: false }], idle: [], admins: ['a'] }) };
    const row = reportButton(ctx);
    eq(row.attrs.id, 'healthreport');
    const [btn] = kids(row, 'button');
    ok(btn.textContent.includes('報告書') && kids(row, 'a').length === 0, 'no link before it is made');
    await btn.click();
    const a = kids(row, 'a')[0];
    eq([kids(row, 'a').length, a.attrs.href, a.attrs.download, a.className], [1, 'blob:fake/1', 'bds-lab-health-o_lab-2026-10-08.md', 'btn'], 'the day in Tokyo, the lab\'s name safe for a file');
    const md = await made[0].text();
    eq([made.length, made[0].type], [1, 'text/markdown;charset=utf-8']);
    ok(md.startsWith('# bds-lab ラボの健康度の報告書\n\n- ラボ: o/lab\n- 日付: 2026-10-08\n- 健康度: **') && md.includes('## 点の内訳') && md.includes('| 管理者の貸し出し | 5 | 5 |'), md.slice(0, 400));
    ok(md.includes('落ちた実行 12 件のうち、新しい 10 件:'), 'the lab\'s 12 failed runs');
    ok(md.includes('| a/lab | はい | 5 | 50 |') && md.includes('| zz/lab | いいえ | 0 | 0 |') && md.includes('| gone/lab | はい | — | — |'), `the lenders — 5 runs of 10 minutes in 30 days (the 40-day-old one is out); one with no run; one that could not be read: ${md.split('## 時間を貸している人')[1]?.slice(0, 300)}`);
    ok(/## アクセスの見直し\n\n見ておくこと \*\*1\*\* 件（2 行）/.test(md) && md.includes('| helper | メンバー | 書き込み | — | 実行の記録が見えない |'), 'an administrator: the people were read');
    ok(md.includes('- 管理者はいつも時間を貸す: はい') && md.includes('| write | ワークフローを始める |') && md.includes('- ポリシーの誤り: なし'), 'the policy as the panel has it');
    eq(api.log.filter((l) => /host\.yml/.test(l)).map((l) => l.split('?')[0]).sort(), ['GET /repos/a/lab/actions/workflows/host.yml/runs', 'GET /repos/gone/lab/actions/workflows/host.yml/runs', 'GET /repos/zz/lab/actions/workflows/host.yml/runs']);
    ok(api.log.every((l) => !/^(POST|PUT|PATCH|DELETE) /.test(l)), 'nothing was written anywhere');
    // (again: the first file's address is given back, a new one made — from what was read a moment ago; a minute later, read again)
    const reads = () => api.log.filter((l) => l === 'runs o/lab 100').length;
    eq(reads(), 1);
    await btn.click();
    eq([made.length, revoked, kids(row, 'a').length, kids(row, 'a')[0].attrs.href, reads()], [2, ['blob:fake/1'], 1, 'blob:fake/2', 1]);
    ctx.now = NOW + 90_000;
    await btn.click();
    eq([made.length, revoked.length, reads()], [3, 2, 2], 'a minute and a half on: read again');
    // (a lab that could not be read at all still gets its report — saying so)
    const hard = reportButton({ ...ctx, api: { runs: async () => { throw new Error('x'); }, secrets: async () => { throw new Error('x'); }, call: async () => { throw new Error('x'); } }, lending: undefined, checks: async () => null, lab: { ...LAB, role: 'write' }, hosts: [], policyErrors: undefined });
    await kids(hard, 'button')[0].click();
    eq(kids(hard, 'a').length, 1);
    const little = await made.at(-1).text();
    ok(little.startsWith('# bds-lab ラボの健康度の報告書\n') && little.includes('- 健康度: まだ測れていません（読めた項目が少なすぎます: 1 / 8）') && little.includes('読めた貸し手はいません') && !/undefined|NaN|\[object/.test(little), little);
  } finally { URL.createObjectURL = real.create; URL.revokeObjectURL = real.revoke; }
});

await t('the four files: no HTML parsed, no style attribute, no colour of their own, nothing stored, no way out but the panel\'s own GitHub client (static)', () => {
  for (const f of ['panel/lib/stats.mjs', 'panel/lib/health.mjs', 'panel/ui/stats.mjs', 'panel/ui/health.mjs']) {
    const src = fs.readFileSync(path.join(TOP, f), 'utf8'), code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n').replace(/\/\/ \(.*$/gm, '');
    for (const bad of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\(/, /new Function/, /localStorage|sessionStorage|indexedDB|document\.cookie/, /\bfetch\(/, /XMLHttpRequest|WebSocket|sendBeacon/, /setAttribute\(\s*['"]style['"]/, /\.cssText/, /createElement\(\s*['"]style['"]/, /\bimport\(/])
      ok(!bad.test(code), `${f}: ${bad}`);
    if (f.startsWith('panel/ui/')) ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(code), `${f}: its own colour`);
    if (f.startsWith('panel/lib/')) ok(!/\bdocument\b|\bwindow\b|from 'node:/.test(code), `${f}: not pure`);
  }
  ok(/createElementNS/.test(fs.readFileSync(path.join(TOP, 'panel/ui/stats.mjs'), 'utf8')), 'the charts are made with createElementNS');
  const css = fs.readFileSync(path.join(TOP, 'panel/ui/stats.mjs'), 'utf8').match(/var\(--[a-z]+\)/g) ?? [];
  ok(css.length > 8 && css.every((v) => ['var(--accent)', 'var(--bad)', 'var(--muted)', 'var(--fg)', 'var(--line)', 'var(--card)', 'var(--chip)'].includes(v)), `only the panel's own variables: ${[...new Set(css)]}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
