// schedule: workflows the lab starts by itself at set times. They are written in the lab's default branch,
// .github/bds-lab-schedule.json (the management panel's 「予約」 makes it: panel/ui/schedule.mjs), and schedule.yml starts them
// every hour in the lab's own Actions with its own GITHUB_TOKEN (`node lab.mjs schedule ci`: common/schedule.mjs imports these
// same checks and times): no one's computer, no one's own token. Pure (no DOM, no fetch): the page, Node's tests and Actions
// all run it.
//
//   {
//     "version": 1,
//     "jobs": [
//       { "id": "verify-1", "workflow": "verify.yml", "inputs": {}, "every": "day", "at": "03:00", "timezone": "Asia/Tokyo", "enabled": true, "note": "毎晩の試験" },
//       { "id": "ai-make-1", "workflow": "ai-make.yml", "inputs": { "request": "…" }, "every": "week", "at": "09:00", "weekday": 1, "timezone": "Asia/Tokyo", "enabled": false },
//       { "id": "latest-1", "workflow": "latest.yml", "inputs": {}, "every": "hour", "hours": 6, "timezone": "UTC", "enabled": true }
//     ]
//   }
//
// The schedule runs once an hour, so a time is an hour on the clock of its time zone ("HH:00"): a job starts in the hourly run
// of that hour (GitHub may start it some minutes late; more when GitHub is busy). every: "hour" (hours: 1 2 3 4 6 8 12 — the
// hours of the day that number divides), "day" (at), "week" (weekday 0 = Sunday … 6 = Saturday, and at). An hour the clock
// skips (summer time begins) is taken by the next hourly run; an hour it repeats (summer time ends) starts once.

export const SCHEDULE_FILE = '.github/bds-lab-schedule.json';
/** the hourly workflow that starts them — never one of them: started by itself, it would start the same hour's jobs again and again */
export const SCHEDULER = 'schedule.yml';
/** workflows that spend the AI's API money each time they run (the panel asks before one is scheduled) */
export const AI_WORKFLOWS = ['ai-make.yml'];
export const MAX_JOBS = 50, MAX_INPUTS = 30, MAX_VALUE = 5000, MAX_BYTES = 500_000;
export const EVERY = ['hour', 'day', 'week'];
export const EVERY_WORDS = { hour: '何時間かごと', day: '毎日', week: '毎週' };
/** "hour": how many hours apart — the numbers that divide a day, so the hours are the same every day */
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const KEYS = ['version', 'jobs'], JOB_KEYS = ['id', 'workflow', 'inputs', 'every', 'hours', 'at', 'weekday', 'timezone', 'enabled', 'note'];
const ID = /^[A-Za-z0-9][\w-]{0,39}$/, WORKFLOW = /^[A-Za-z0-9][\w.-]{0,98}\.ya?ml$/, INPUT = /^[A-Za-z_][\w-]{0,99}$/, AT = /^([01]\d|2[0-3]):00$/;
// (an IANA name — Area/Place — or UTC; abbreviations such as JST are left out: what Intl takes of those differs between browsers)
const TZ = /^(UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;
const HOUR = 3_600_000, QUARTER = 900_000;
const isObj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/** a time zone the schedule takes: an IANA name (Asia/Tokyo) or UTC, known to Intl (pure) */
export function validTimezone(tz) {
  if (typeof tz !== 'string' || !TZ.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** one job → { job, errors } (pure): job in its own form (defaults filled: inputs {}, hours 1, timezone UTC, enabled) or null */
export function checkJob(j) {
  if (!isObj(j)) return { job: null, errors: ['{ "id": …, "workflow": …, "every": … } の形'] };
  const e = [];
  for (const k of Object.keys(j)) if (!JOB_KEYS.includes(k)) e.push(`${k}: 知らない項目です（${JOB_KEYS.join(' ')}）`);
  if (typeof j.id !== 'string' || !ID.test(j.id)) e.push('id: 英数字・_ -（40 文字まで）');
  if (typeof j.workflow !== 'string' || !WORKFLOW.test(j.workflow) || j.workflow.includes('..')) e.push('workflow: .github/workflows のファイルの名前（例 verify.yml）');
  else if (j.workflow === SCHEDULER) e.push(`workflow: ${SCHEDULER} は予約できません（予約を始めるワークフロー自身です）`);
  if (j.inputs !== undefined) {
    if (!isObj(j.inputs)) e.push('inputs: { "名前": "値" } の形');
    else {
      const ks = Object.keys(j.inputs);
      if (ks.length > MAX_INPUTS) e.push(`inputs: ${MAX_INPUTS} 個まで（いま ${ks.length} 個）`);
      for (const k of ks.slice(0, MAX_INPUTS + 1)) {
        if (!INPUT.test(k)) e.push(`inputs: 「${k.slice(0, 40)}」は入力の名前になりません（英字か _ から、英数字・_ -）`);
        if (typeof j.inputs[k] !== 'string') e.push(`inputs.${k.slice(0, 40)}: 値は文字で（true / false も "true" / "false"）`);
        else if (j.inputs[k].length > MAX_VALUE) e.push(`inputs.${k.slice(0, 40)}: ${MAX_VALUE} 文字まで`);
      }
      // (what GitHub takes in one start: 65535 characters of inputs)
      if (JSON.stringify(j.inputs).length > 65535) e.push('inputs: 合わせて 65535 文字まで（GitHub が受け付ける大きさ）');
    }
  }
  if (!EVERY.includes(j.every)) e.push('every: "hour"（何時間かごと）か "day"（毎日）か "week"（毎週）');
  else {
    if (j.every === 'hour') { if (j.hours !== undefined && !HOUR_STEPS.includes(j.hours)) e.push(`hours: ${HOUR_STEPS.join(' ')} のどれか（1 日を割り切る数: 毎日同じ時に）`); }
    else if (j.hours !== undefined) e.push('hours: every が "hour" のときだけ');
    if (j.every !== 'hour') { if (typeof j.at !== 'string' || !AT.test(j.at)) e.push('at: "HH:00"（00:00〜23:00。予約は 1 時間に 1 回なので、分は 00）'); }
    else if (j.at !== undefined) e.push('at: every が "day" か "week" のときだけ');
    if (j.every === 'week') { if (!Number.isInteger(j.weekday) || j.weekday < 0 || j.weekday > 6) e.push('weekday: 0〜6 の整数（0 = 日曜、1 = 月曜 … 6 = 土曜）'); }
    else if (j.weekday !== undefined) e.push('weekday: every が "week" のときだけ');
  }
  if (j.timezone !== undefined && !validTimezone(j.timezone)) e.push(`timezone: ${String(j.timezone).slice(0, 60)} は知らない時間帯（例 Asia/Tokyo・UTC）`);
  if (j.enabled !== undefined && typeof j.enabled !== 'boolean') e.push('enabled: true か false');
  if (j.note !== undefined && (typeof j.note !== 'string' || j.note.length > 200)) e.push('note: 200 文字までの文字');
  if (e.length) return { job: null, errors: e };
  return { job: { id: j.id, workflow: j.workflow, inputs: { ...(j.inputs ?? {}) }, every: j.every, ...(j.every === 'hour' ? { hours: j.hours ?? 1 } : { at: j.at }),
    ...(j.every === 'week' ? { weekday: j.weekday } : {}), timezone: j.timezone ?? 'UTC', enabled: j.enabled ?? true, ...(j.note ? { note: j.note } : {}) }, errors: [] };
}

/** .github/bds-lab-schedule.json's JSON (null: there is none) → { jobs, errors } (pure). jobs: those that check out, each in its
 *  own form; errors in words, each job's as `jobs[i]（id）: …`. A file with errors starts nothing (common/schedule.mjs ci) */
export function checkSchedule(j) {
  if (j === null || j === undefined) return { jobs: [], errors: [] };
  if (!isObj(j)) return { jobs: [], errors: [`${SCHEDULE_FILE} が JSON のオブジェクトではありません`] };
  const e = [];
  for (const k of Object.keys(j)) if (!KEYS.includes(k)) e.push(`${k}: 知らない項目です（${KEYS.join(' ')}）`);
  if (j.version !== undefined && j.version !== 1) e.push('version: 1');
  if (j.jobs !== undefined && !Array.isArray(j.jobs)) return { jobs: [], errors: [...e, 'jobs: [ { … }, … ] の並び'] };
  const raw = j.jobs ?? [];
  if (raw.length > MAX_JOBS) e.push(`jobs: ${MAX_JOBS} 件まで（いま ${raw.length} 件）`);
  if (new TextEncoder().encode(JSON.stringify(j)).length > MAX_BYTES) e.push(`${SCHEDULE_FILE} が大きすぎます（${MAX_BYTES / 1000} KB まで）`);
  const jobs = [], seen = new Map();
  raw.forEach((x, i) => {
    const c = checkJob(x), at = `jobs[${i}]${typeof x?.id === 'string' && ID.test(x.id) ? `（${x.id}）` : ''}`;
    for (const m of c.errors) e.push(`${at}: ${m}`);
    if (!c.job) return;
    const k = c.job.id.toLowerCase();
    if (seen.has(k)) e.push(`${at}: id が jobs[${seen.get(k)}] と同じです（id は 1 つずつ）`);
    else { seen.set(k, i); jobs.push(c.job); }
  });
  return { jobs, errors: e };
}

/** the jobs → the file's text (pure): each job that checks out in its own form, any other kept as it was (a file mended one
 *  job at a time) → { text, errors } (errors: checkSchedule's of that text) */
export function scheduleText(jobs) {
  const j = { version: 1, jobs: (jobs ?? []).map((x) => checkJob(x).job ?? x) };
  return { text: `${JSON.stringify(j, null, 2)}\n`, errors: checkSchedule(j).errors };
}

/** a new job's id from its workflow, not one of ids: verify.yml → verify-1, verify-2, … (pure) */
export function newId(workflow, ids = []) {
  const base = String(workflow ?? '').replace(/\.ya?ml$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+/, '').slice(0, 30) || 'job';
  const have = new Set(ids.map((x) => String(x).toLowerCase()));
  for (let i = 1; ; i++) if (!have.has(`${base}-${i}`.toLowerCase())) return `${base}-${i}`;
}

// ---- times: the clock of a time zone ----
const FMT = new Map();
/** an instant → its time zone's clock: { y, mo, d, h, mi, wd (0 = Sunday), wall (the hours since 1970 as that clock reads) } */
function clock(t, tz) {
  let f = FMT.get(tz);
  if (!f) { if (FMT.size > 200) FMT.clear(); f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); FMT.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(t).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const h = p.hour % 24, wall = Date.UTC(p.year, p.month - 1, p.day, h) / HOUR;
  return { y: p.year, mo: p.month, d: p.day, h, mi: p.minute, wd: new Date(wall * HOUR).getUTCDay(), wall };
}
const atHour = (job) => Number(String(job.at ?? '00:00').slice(0, 2));
/** is this hour of the clock (wall: clock().wall) one of the job's (pure) */
function inHour(job, wall) {
  const h = ((wall % 24) + 24) % 24;
  if (job.every === 'hour') return h % (job.hours ?? 1) === 0;
  if (h !== atHour(job)) return false;
  return job.every !== 'week' || new Date(wall * HOUR).getUTCDay() === job.weekday;
}
/** should the hourly run at `now` start this job (pure): the hour on its time zone's clock is one of the job's — at's hour,
 *  on its weekday for "week", divided by hours for "hour". Each hour the clock shows since the run an hour before counts: an
 *  hour the clock skipped (summer time) is taken by the run after it; an hour it repeats starts once (the first time) */
export function due(job, now = new Date()) {
  const t = +new Date(now), tz = job.timezone ?? 'UTC', p = clock(t, tz), q = clock(t - HOUR, tz);
  for (let w = Math.max(q.wall + 1, p.wall - 2); w <= p.wall; w++) if (inHour(job, w)) return true;
  return false;
}
/** from the clock c, the hours to the job's next hour (0: this one) */
function hoursTo(job, c) {
  if (job.every === 'hour') { const n = job.hours ?? 1; return (n - (c.h % n)) % n; }
  const d = (atHour(job) - c.h + 24) % 24;
  return job.every === 'week' ? (((job.weekday - c.wd + 7) % 7) * 24 + atHour(job) - c.h + 168) % 168 : d;
}
/** the next n times the job starts after now (pure) → [Date]: the start of each of its hours on its time zone's clock (the
 *  hourly run starts it within that hour) */
export function nextRuns(job, now = new Date(), n = 3) {
  const tz = job.timezone ?? 'UTC', out = [], want = Math.max(0, Math.min(Number(n) || 0, 100));
  let t = Math.floor(+new Date(now) / QUARTER) * QUARTER + QUARTER;
  // (each start of an hour of that clock — every time zone is a whole number of quarter hours from UTC — asked `due`; the
  // hours between jumped over, one short so that a clock moved for summer time in between is not passed by)
  for (let i = 0; out.length < want && i < 200 + want * 20; i++) {
    const c = clock(t, tz);
    if (c.mi !== 0) { t += QUARTER; continue; }
    if (due(job, t)) { out.push(new Date(t)); t += HOUR; continue; }
    t += Math.max(1, hoursTo(job, c) - 1) * HOUR;
  }
  return out;
}

const pad = (x) => String(x).padStart(2, '0');
/** an instant on a time zone's clock, in words: 10/09（金）03:00 (pure) */
export function fmtWhen(d, tz = 'UTC') { const c = clock(+new Date(d), tz); return `${pad(c.mo)}/${pad(c.d)}（${WEEKDAYS[c.wd]}）${pad(c.h)}:${pad(c.mi)}`; }
/** when a job starts, in words (pure): 毎日 03:00（Asia/Tokyo） · 毎週 月曜 09:00（Asia/Tokyo） · 6 時間ごと（0・6・12・18 時、UTC） · 毎時 */
export function describe(job) {
  const tz = job.timezone ?? 'UTC';
  if (job.every === 'hour') {
    const n = job.hours ?? 1;
    if (n === 1) return '毎時';
    return `${n} 時間ごと（${24 / n <= 6 ? `${Array.from({ length: 24 / n }, (_, i) => i * n).join('・')} 時` : '0 時から'}、${tz}）`;
  }
  if (job.every === 'week') return `毎週 ${WEEKDAYS[job.weekday] ?? '?'}曜 ${job.at}（${tz}）`;
  return `毎日 ${job.at}（${tz}）`;
}
