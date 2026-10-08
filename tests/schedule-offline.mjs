// the 「予約」 (workflows the lab starts by itself at set times) without a browser or GitHub: the file checked (errors in words,
// each job's own; the scheduler itself never one of them), when a job is due (Asia/Tokyo and UTC, a week's day, every N hours,
// summer time skipping and repeating an hour), its next times and its words; `node lab.mjs schedule ci` against a fake GitHub
// (node:http) and a file in a temp folder — only the jobs on and due started, on the repository's default branch with their
// inputs; a broken file starts nothing (exit 1); what GitHub refused is said and is exit 1; the token is never in what it
// prints — and list / check; and the 「予約」 tab on a small fake DOM (added, changed, paused, deleted through putFile with the
// sha read, ai-make asked first, a change made elsewhere not written over; the file not read: why where the list goes, with
// 「読み直す」; a write refused for another reason than the sha — a protected branch — the form kept, GitHub's own words).
// node tests/schedule-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const S = await imp('panel/lib/schedule.mjs'), C = await imp('common/schedule.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const iso = (ds) => ds.map((d) => d.toISOString());
const job = (o) => { const c = S.checkJob({ id: 'j', workflow: 'verify.yml', ...o }); if (!c.job) throw new Error(c.errors.join(' / ')); return c.job; };
// (2026-10-08 is a Thursday: 18:17 UTC is Friday 03:17 in Tokyo — an hourly run at minute 17)
const NOW = Date.parse('2026-10-08T18:17:00Z');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-schedule-'));

await t('the file checked: a good one in its own form (defaults filled), none = no jobs; each wrong thing said in words, a job\'s as jobs[i]（id）; schedule.yml itself never a job (pure)', () => {
  eq(S.checkSchedule(null), { jobs: [], errors: [] });
  const good = S.checkSchedule({ version: 1, jobs: [
    { id: 'nightly', workflow: 'verify.yml', every: 'day', at: '03:00', timezone: 'Asia/Tokyo', note: '毎晩' },
    { id: 'weekly', workflow: 'ai-make.yml', inputs: { request: 'ルビーの剣', unit: '' }, every: 'week', weekday: 1, at: '09:00', timezone: 'Asia/Tokyo', enabled: false },
    { id: 'sync', workflow: 'latest.yaml', every: 'hour', hours: 6 }, { id: 'tick', workflow: 'notify.yml', every: 'hour' }] });
  eq(good.errors, []);
  eq(good.jobs, [
    { id: 'nightly', workflow: 'verify.yml', inputs: {}, every: 'day', at: '03:00', timezone: 'Asia/Tokyo', enabled: true, note: '毎晩' },
    { id: 'weekly', workflow: 'ai-make.yml', inputs: { request: 'ルビーの剣', unit: '' }, every: 'week', at: '09:00', weekday: 1, timezone: 'Asia/Tokyo', enabled: false },
    { id: 'sync', workflow: 'latest.yaml', inputs: {}, every: 'hour', hours: 6, timezone: 'UTC', enabled: true },
    { id: 'tick', workflow: 'notify.yml', inputs: {}, every: 'hour', hours: 1, timezone: 'UTC', enabled: true }]);
  const base = { id: 'x', workflow: 'verify.yml', every: 'day', at: '03:00' };
  const bad = [
    ['x', /オブジェクト/], [[], /オブジェクト/], [{ jobz: [] }, /jobz: 知らない項目/], [{ version: 2 }, /version: 1/], [{ jobs: {} }, /jobs: \[/],
    [{ jobs: ['x'] }, /jobs\[0\]: \{ "id"/], [{ jobs: [{ ...base, id: '' }] }, /jobs\[0\]: id:/], [{ jobs: [{ ...base, id: 'a b' }] }, /^jobs\[0\]: id:/], [{ jobs: [{ ...base, cron: '* * * * *' }] }, /jobs\[0\]（x）: cron: 知らない項目/],
    [{ jobs: [{ ...base, workflow: 'verify' }] }, /workflow: \.github\/workflows/], [{ jobs: [{ ...base, workflow: 'a/verify.yml' }] }, /workflow:/], [{ jobs: [{ ...base, workflow: '..yml' }] }, /workflow:/], [{ jobs: [{ ...base, workflow: 'x/../y.yml' }] }, /workflow:/],
    [{ jobs: [{ ...base, workflow: 'schedule.yml' }] }, /schedule\.yml は予約できません/],
    [{ jobs: [{ ...base, inputs: [] }] }, /inputs: \{/], [{ jobs: [{ ...base, inputs: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, 'v'])) }] }, /inputs: 30 個まで/],
    [{ jobs: [{ ...base, inputs: { wait: true } }] }, /inputs\.wait: 値は文字で/], [{ jobs: [{ ...base, inputs: { '1a': 'x' } }] }, /入力の名前になりません/], [{ jobs: [{ ...base, inputs: { a: 'x'.repeat(5001) } }] }, /5000 文字まで/],
    [{ jobs: [{ ...base, inputs: Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, 'x'.repeat(4900)])) }] }, /65535 文字まで/],
    [{ jobs: [{ ...base, every: 'month' }] }, /every: "hour"/], [{ jobs: [{ id: 'x', workflow: 'verify.yml', every: 'hour', hours: 5 }] }, /hours: 1 2 3 4 6 8 12/], [{ jobs: [{ id: 'x', workflow: 'verify.yml', every: 'hour', hours: '6' }] }, /hours:/],
    [{ jobs: [{ ...base, hours: 6 }] }, /hours: every が "hour" のときだけ/], [{ jobs: [{ ...base, at: '3:00' }] }, /at: "HH:00"/], [{ jobs: [{ ...base, at: '03:30' }] }, /分は 00/], [{ jobs: [{ ...base, at: '24:00' }] }, /at:/],
    [{ jobs: [{ id: 'x', workflow: 'verify.yml', every: 'day' }] }, /at: "HH:00"/], [{ jobs: [{ id: 'x', workflow: 'verify.yml', every: 'hour', at: '03:00' }] }, /at: every が "day" か "week"/],
    [{ jobs: [{ ...base, every: 'week' }] }, /weekday: 0〜6/], [{ jobs: [{ ...base, every: 'week', weekday: 7 }] }, /weekday: 0〜6/], [{ jobs: [{ ...base, every: 'week', weekday: 1.5 }] }, /weekday/], [{ jobs: [{ ...base, weekday: 1 }] }, /weekday: every が "week" のときだけ/],
    [{ jobs: [{ ...base, timezone: 'Mars/Olympus' }] }, /timezone: Mars\/Olympus は知らない時間帯/], [{ jobs: [{ ...base, timezone: 'JST' }] }, /timezone/], [{ jobs: [{ ...base, timezone: 9 }] }, /timezone/],
    [{ jobs: [{ ...base, enabled: 'yes' }] }, /enabled: true か false/], [{ jobs: [{ ...base, note: 'x'.repeat(201) }] }, /note: 200 文字/],
    [{ jobs: [base, { ...base, id: 'X' }] }, /jobs\[1\]（X）: id が jobs\[0\] と同じです/], [{ jobs: Array.from({ length: 51 }, (_, i) => ({ ...base, id: `j${i}` })) }, /jobs: 50 件まで（いま 51 件）/],
    [{ jobs: Array.from({ length: 30 }, (_, i) => ({ ...base, id: `j${i}`, inputs: { a: 'あ'.repeat(5000), b: 'い'.repeat(1000) } })) }, /大きすぎます/],
  ];
  for (const [j, re] of bad) { const r = S.checkSchedule(j); ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(j).slice(0, 120)} → ${r.errors.join(' / ')}`); }
  // (the jobs that do check out are still told, each in its own form: the panel shows them, ci starts none while any error stands)
  const mixed = S.checkSchedule({ jobs: [{ ...base, at: '03:30' }, { ...base, id: 'y' }] });
  eq([mixed.jobs.map((j) => j.id), mixed.errors.length], [['y'], 1]);
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/Argentina/Buenos_Aires', 'Etc/GMT-9', 'Asia/Kolkata']) eq(S.checkJob({ ...base, timezone: tz }).errors, [], tz);
  eq([S.validTimezone('Asia/Tokyo'), S.validTimezone('asia/nowhere'), S.validTimezone('EST'), S.validTimezone(null)], [true, false, false, false]);
});

await t('due: the hour on the job\'s own clock — Asia/Tokyo and UTC apart, a week\'s day by that clock, every N hours from 0 — once an hourly run, however late in the hour it runs (pure)', () => {
  const tokyo = job({ every: 'day', at: '03:00', timezone: 'Asia/Tokyo' }), utc = job({ every: 'day', at: '03:00' });
  eq(['2026-10-08T17:59:00Z', '2026-10-08T18:00:00Z', '2026-10-08T18:17:00Z', '2026-10-08T18:59:00Z', '2026-10-08T19:00:00Z'].map((x) => S.due(tokyo, Date.parse(x))), [false, true, true, true, false], 'Tokyo 03:00 = 18:00 UTC');
  eq([S.due(utc, NOW), S.due(utc, Date.parse('2026-10-09T03:17:00Z')), S.due(tokyo, Date.parse('2026-10-09T03:17:00Z'))], [false, true, false], 'the same 03:00 in UTC is nine hours later');
  // (Friday in Tokyo while it is still Thursday in UTC)
  const fri = job({ every: 'week', weekday: 5, at: '03:00', timezone: 'Asia/Tokyo' }), thu = job({ every: 'week', weekday: 4, at: '03:00', timezone: 'Asia/Tokyo' }), thuUtc = job({ every: 'week', weekday: 4, at: '18:00' });
  eq([S.due(fri, NOW), S.due(thu, NOW), S.due(thuUtc, NOW), S.due(fri, NOW + 7 * 86_400_000), S.due(fri, NOW + 86_400_000)], [true, false, true, true, false]);
  const each = (j, hours, from = Date.parse('2026-10-05T00:17:00Z')) => Array.from({ length: hours }, (_, k) => from + k * 3_600_000).filter((x) => S.due(j, x));
  eq(each(job({ every: 'hour', hours: 6, timezone: 'Asia/Tokyo' }), 24, Date.parse('2026-10-08T15:17:00Z')).map((x) => S.fmtWhen(x, 'Asia/Tokyo')), ['10/09（金）00:17', '10/09（金）06:17', '10/09（金）12:17', '10/09（金）18:17'], 'every 6 hours of the Tokyo clock');
  eq([each(job({ every: 'hour' }), 168).length, each(job({ every: 'hour', hours: 3 }), 168).length, each(job({ every: 'hour', hours: 12 }), 168).length, each(tokyo, 168).length, each(fri, 168).length], [168, 56, 14, 7, 1], 'a week of hourly runs');
  // (half-hour zones: the hour of that clock, whatever minute the run comes at)
  const kol = job({ every: 'day', at: '03:00', timezone: 'Asia/Kolkata' });
  eq(each(kol, 48).map((x) => new Date(x).toISOString()), ['2026-10-05T22:17:00.000Z', '2026-10-06T22:17:00.000Z']);
});

await t('due over summer time: an hour the clock skips is taken by the run after it, an hour it repeats starts once (America/New_York, pure)', () => {
  const each = (j, from) => Array.from({ length: 48 }, (_, k) => from + k * 3_600_000).filter((x) => S.due(j, x)).map((x) => `${new Date(x).toISOString()} ${S.fmtWhen(x, j.timezone)}`);
  eq(each(job({ every: 'day', at: '02:00', timezone: 'America/New_York' }), Date.parse('2026-03-08T00:17:00Z')), ['2026-03-08T07:17:00.000Z 03/08（日）03:17', '2026-03-09T06:17:00.000Z 03/09（月）02:17'], 'spring forward: 02:00 does not exist — the 03:00 run takes it');
  eq(each(job({ every: 'day', at: '01:00', timezone: 'America/New_York' }), Date.parse('2026-11-01T00:17:00Z')), ['2026-11-01T05:17:00.000Z 11/01（日）01:17', '2026-11-02T06:17:00.000Z 11/02（月）01:17'], 'fall back: 01:00 twice — started once');
  eq(each(job({ every: 'hour', timezone: 'America/New_York' }), Date.parse('2026-03-08T00:17:00Z')).length, 48, 'every hour: one run each hourly run, skipped hour or not');
});

await t('nextRuns: the next times after now, each the start of its hour on the job\'s clock and each one `due` (pure)', () => {
  const tokyo = job({ every: 'day', at: '03:00', timezone: 'Asia/Tokyo' });
  eq(iso(S.nextRuns(tokyo, NOW, 3)), ['2026-10-09T18:00:00.000Z', '2026-10-10T18:00:00.000Z', '2026-10-11T18:00:00.000Z'], 'this hour\'s already started: tomorrow on');
  eq(iso(S.nextRuns(tokyo, Date.parse('2026-10-08T17:59:00Z'), 1)), ['2026-10-08T18:00:00.000Z']);
  eq(iso(S.nextRuns(job({ every: 'day', at: '18:00' }), NOW, 2)), ['2026-10-09T18:00:00.000Z', '2026-10-10T18:00:00.000Z'], 'UTC');
  const mon = job({ every: 'week', weekday: 1, at: '09:00', timezone: 'Asia/Tokyo' });
  eq(S.nextRuns(mon, NOW, 3).map((d) => S.fmtWhen(d, 'Asia/Tokyo')), ['10/12（月）09:00', '10/19（月）09:00', '10/26（月）09:00'], 'Mondays in Tokyo');
  eq(S.nextRuns(job({ every: 'hour', hours: 6, timezone: 'Asia/Tokyo' }), NOW, 4).map((d) => S.fmtWhen(d, 'Asia/Tokyo')), ['10/09（金）06:00', '10/09（金）12:00', '10/09（金）18:00', '10/10（土）00:00']);
  eq(iso(S.nextRuns(job({ every: 'hour' }), NOW, 2)), ['2026-10-08T19:00:00.000Z', '2026-10-08T20:00:00.000Z']);
  eq(iso(S.nextRuns(job({ every: 'day', at: '03:00', timezone: 'Asia/Kolkata' }), NOW, 1)), ['2026-10-08T21:30:00.000Z'], 'a half-hour zone: its own hour\'s start');
  eq(iso(S.nextRuns(job({ every: 'day', at: '02:00', timezone: 'America/New_York' }), Date.parse('2026-03-07T12:00:00Z'), 3)), ['2026-03-08T07:00:00.000Z', '2026-03-09T06:00:00.000Z', '2026-03-10T06:00:00.000Z'], 'the skipped 02:00 at 03:00');
  eq(iso(S.nextRuns(job({ every: 'day', at: '01:00', timezone: 'America/New_York' }), Date.parse('2026-10-31T12:00:00Z'), 2)), ['2026-11-01T05:00:00.000Z', '2026-11-02T06:00:00.000Z'], 'the repeated 01:00 once');
  eq(S.nextRuns(tokyo, NOW, 0), []);
  for (const j of [tokyo, mon, job({ every: 'hour', hours: 4, timezone: 'Australia/Lord_Howe' }), job({ every: 'week', weekday: 0, at: '23:00', timezone: 'Pacific/Chatham' })]) {
    const ns = S.nextRuns(j, NOW, 6);
    ok(ns.length === 6 && ns.every((d, k) => d > NOW && (k === 0 || d > ns[k - 1]) && S.due(j, d) && S.due(j, +d + 17 * 60_000)), `${S.describe(j)}: ${iso(ns)}`);
  }
});

await t('describe and fmtWhen: when, in words; scheduleText: the file in its own form (a job still wrong kept as it was); newId (pure)', () => {
  eq([S.describe(job({ every: 'day', at: '03:00', timezone: 'Asia/Tokyo' })), S.describe(job({ every: 'week', weekday: 1, at: '09:00', timezone: 'Asia/Tokyo' })), S.describe(job({ every: 'hour', hours: 6, timezone: 'Asia/Tokyo' })),
    S.describe(job({ every: 'hour', hours: 2 })), S.describe(job({ every: 'hour' }))],
  ['毎日 03:00（Asia/Tokyo）', '毎週 月曜 09:00（Asia/Tokyo）', '6 時間ごと（0・6・12・18 時、Asia/Tokyo）', '2 時間ごと（0 時から、UTC）', '毎時']);
  eq([S.fmtWhen(Date.parse('2026-10-09T18:00:00Z'), 'Asia/Tokyo'), S.fmtWhen(NOW), S.fmtWhen(new Date(NOW), 'America/New_York')], ['10/10（土）03:00', '10/08（木）18:17', '10/08（木）14:17']);
  const out = S.scheduleText([{ timezone: 'Asia/Tokyo', at: '03:00', every: 'day', workflow: 'verify.yml', id: 'a' }, { id: 'b', workflow: 'verify.yml', every: 'day', at: '03:30' }]);
  eq(JSON.parse(out.text), { version: 1, jobs: [{ id: 'a', workflow: 'verify.yml', inputs: {}, every: 'day', at: '03:00', timezone: 'Asia/Tokyo', enabled: true }, { id: 'b', workflow: 'verify.yml', every: 'day', at: '03:30' }] });
  ok(out.text.endsWith('}\n') && /^ {2}"version": 1,$/m.test(out.text) && out.errors.length === 1 && /jobs\[1\]（b）: at/.test(out.errors[0]), out.text + out.errors.join());
  eq([S.newId('verify.yml'), S.newId('verify.yml', ['Verify-1', 'verify-2']), S.newId('My Flow.yaml'), S.newId('___.yml')], ['verify-1', 'verify-3', 'My-Flow-1', 'job-1']);
  ok(S.checkJob({ id: S.newId('a.b.c.yml'), workflow: 'a.b.c.yml', every: 'hour' }).job, 'a new id is an id');
});

// ---- `node lab.mjs schedule ci` against a fake GitHub ----
const TOKEN = 'ghs_SeCrEtScheduleToken1234567890';
async function fakeGitHub({ defaultBranch = 'trunk', repoStatus = 200, refuse = {} } = {}) {
  const st = { seen: [], dispatched: [] };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === null ? '' : JSON.stringify(j)); };
      st.seen.push({ m: req.method, u: req.url, auth: req.headers.authorization === `Bearer ${TOKEN}`, version: req.headers['x-github-api-version'] });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Bad credentials' });
      let x;
      if (req.method === 'GET' && req.url === '/repos/o/lab') return repoStatus === 200 ? send(200, { full_name: 'o/lab', default_branch: defaultBranch }) : send(repoStatus, { message: 'Server Error' });
      if (req.method === 'POST' && (x = /^\/repos\/o\/lab\/actions\/workflows\/([^/?]+)\/dispatches$/.exec(req.url))) {
        const wf = decodeURIComponent(x[1]);
        if (refuse[wf]) return send(refuse[wf].status, { message: refuse[wf].message });
        st.dispatched.push({ wf, body: JSON.parse(b) });
        res.writeHead(204); return res.end();
      }
      send(404, { message: `Not Found ${req.method} ${req.url}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { st, url: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections?.(); return new Promise((r) => srv.close(r)); } };
}
let fileN = 0;
const scheduleFile = (j) => { const f = path.join(TMP, `s${++fileN}`, '.github', 'bds-lab-schedule.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof j === 'string' ? j : JSON.stringify(j, null, 2)); return f; };
const cli = async (args, { file, env = {}, now = NOW }) => { const lines = []; const r = await C.scheduleCmd(args, { out: (s) => lines.push(String(s)), env, file, now }); return { r, lines, text: lines.join('\n') }; };
const tz = 'Asia/Tokyo';
const JOBS = [
  { id: 'tokyo-3', workflow: 'verify.yml', inputs: { mode: 'quick' }, every: 'day', at: '03:00', timezone: tz },
  { id: 'utc-18', workflow: 'latest.yml', every: 'day', at: '18:00', timezone: 'UTC' },
  { id: 'utc-19', workflow: 'latest.yml', every: 'day', at: '19:00' },
  { id: 'fri-tokyo', workflow: 'maint.yml', every: 'week', weekday: 5, at: '03:00', timezone: tz },
  { id: 'thu-tokyo', workflow: 'maint.yml', every: 'week', weekday: 4, at: '03:00', timezone: tz },
  { id: 'thu-utc', workflow: 'bundle.yml', every: 'week', weekday: 4, at: '18:00' },
  { id: 'every-3', workflow: 'notify.yml', inputs: { run: '', message: 'まいじ' }, every: 'hour', hours: 3, timezone: tz },
  { id: 'every-6', workflow: 'notify.yml', every: 'hour', hours: 6, timezone: tz },
  { id: 'paused', workflow: 'verify.yml', every: 'day', at: '03:00', timezone: tz, enabled: false, note: '止めておく' },
  { id: 'ai', workflow: 'ai-make.yml', inputs: { request: 'ルビーの剣' }, every: 'day', at: '03:00', timezone: tz },
];
const ENV = (url, more = {}) => ({ GITHUB_REPOSITORY: 'o/lab', GITHUB_TOKEN: TOKEN, GITHUB_API_URL: `${url}/`, GITHUB_REF_NAME: 'other', ...more });

await t('ci: only the jobs on and due this hour started — on the repository\'s default branch, with their inputs, the run\'s token — the rest said skipped or paused; the token never printed (fake GitHub)', async () => {
  const f = await fakeGitHub();
  try {
    const file = scheduleFile({ version: 1, jobs: JOBS });
    const { r, lines, text } = await cli(['ci'], { file, env: ENV(f.url) });
    ok(r === true, text);
    eq(f.st.dispatched, [
      { wf: 'verify.yml', body: { ref: 'trunk', inputs: { mode: 'quick' } } }, { wf: 'latest.yml', body: { ref: 'trunk', inputs: {} } }, { wf: 'maint.yml', body: { ref: 'trunk', inputs: {} } },
      { wf: 'bundle.yml', body: { ref: 'trunk', inputs: {} } }, { wf: 'notify.yml', body: { ref: 'trunk', inputs: { run: '', message: 'まいじ' } } }, { wf: 'ai-make.yml', body: { ref: 'trunk', inputs: { request: 'ルビーの剣' } } }], 'the due ones, in order');
    ok(f.st.seen.every((x) => x.auth && x.version === '2022-11-28') && f.st.seen[0].m === 'GET' && f.st.seen[0].u === '/repos/o/lab', JSON.stringify(f.st.seen));
    ok(lines.includes('✔ 始めました: tokyo-3 — verify.yml・毎日 03:00（Asia/Tokyo） → trunk'), text);
    ok(lines.includes('· 飛ばしました（今ではない）: utc-19 — latest.yml・毎日 19:00（UTC）・次 10/08（木）19:00・10/09（金）19:00・10/10（土）19:00'), text);
    ok(lines.some((l) => /^· 飛ばしました（今ではない）: thu-tokyo — maint\.yml・毎週 木曜 03:00（Asia\/Tokyo）・次 10\/15（木）03:00/.test(l)) && lines.some((l) => l.startsWith('· 飛ばしました（今ではない）: every-6 ')), text);
    ok(lines.includes('⏸ 止めています: paused — verify.yml・毎日 03:00（Asia/Tokyo）'), text);
    eq(lines.at(-1), '予約 10 件（2026-10-08 18:17 UTC）: 始めた 6・今ではない 3・止めている 1');
    ok(!text.includes(TOKEN), 'no token');
    // the hour after: only the hourly-ish ones that fall then
    const next = await cli(['ci'], { file, env: ENV(f.url), now: NOW + 3_600_000 });
    eq([next.r, f.st.dispatched.length, f.st.dispatched.at(-1).wf], [true, 7, 'latest.yml'], `04:17 in Tokyo, 19:17 UTC: utc-19 alone → ${next.text}`);
    ok(next.lines.includes('✔ 始めました: utc-19 — latest.yml・毎日 19:00（UTC） → trunk'), next.text);
  } finally { await f.close(); }
});

await t('ci: what GitHub refused is said in words and is exit 1, the others still start; GitHub\'s message never carries the token or a line of its own into the log; the default branch unknown → GITHUB_REF_NAME (fake GitHub)', async () => {
  const f = await fakeGitHub({ repoStatus: 500, refuse: { 'gone.yml': { status: 404, message: 'Not Found' }, 'bad.yml': { status: 422, message: `Unexpected inputs provided: ["x"] ${TOKEN}\n::error::injected` }, 'deny.yml': { status: 403, message: 'Resource not accessible by integration' } } });
  try {
    const file = scheduleFile({ jobs: [{ id: 'gone', workflow: 'gone.yml', every: 'hour' }, { id: 'bad', workflow: 'bad.yml', inputs: { x: '1' }, every: 'hour' }, { id: 'deny', workflow: 'deny.yml', every: 'hour' }, { id: 'fine', workflow: 'verify.yml', every: 'hour' }] });
    const { r, lines, text } = await cli(['ci'], { file, env: ENV(f.url) });
    ok(r === false, text);
    eq(f.st.dispatched, [{ wf: 'verify.yml', body: { ref: 'other', inputs: {} } }], 'the default branch not readable: the run\'s own branch');
    ok(lines.some((l) => /^W schedule: o\/lab の既定の枝を読めません（HTTP 500 Server Error）: other（GITHUB_REF_NAME）で始めます$/.test(l)), text);
    ok(lines.includes('✘ 始められません: gone — gone.yml・毎時: gone.yml が見つかりません（.github/workflows にあるか・名前を確かめる）'), text);
    ok(lines.some((l) => l.startsWith('✘ 始められません: bad — bad.yml・毎時: GitHub が受け付けません: Unexpected inputs provided: ["x"] *** ::error::injected')), text);
    ok(lines.some((l) => /deny\.yml・毎時: 権限がありません（schedule\.yml の permissions に actions: write）/.test(l)), text);
    eq(lines.at(-1), '予約 4 件（2026-10-08 18:17 UTC）: 始めた 1・今ではない 0・止めている 0・始められない 3');
    ok(!text.includes(TOKEN) && lines.every((l) => !/[\r\n]/.test(l)) && !lines.some((l) => l.startsWith('::')), text);
  } finally { await f.close(); }
  // GitHub not there at all: said, exit 1, no token
  const file = scheduleFile({ jobs: [{ id: 'fine', workflow: 'verify.yml', every: 'hour' }] });
  const down = await cli(['ci'], { file, env: ENV('http://127.0.0.1:9', { GITHUB_REF_NAME: '' }) });
  ok(down.r === false && /既定の枝が分かりません/.test(down.text) && !down.text.includes(TOKEN), down.text);
});

await t('ci: a broken file starts nothing (exit 1, why in words); no file: nothing to do; outside Actions (no token): said, nothing asked of GitHub; --dry: what it would start, nothing started (fake GitHub)', async () => {
  const f = await fakeGitHub();
  try {
    const due = { id: 'due', workflow: 'verify.yml', every: 'hour' };
    for (const [content, re] of [['{ "version": 1, "jobs": [ ', /JSON ではありません/], [{ jobs: [due, { ...due, id: 'late', every: 'day', at: '03:30' }] }, /jobs\[1\]（late）: at: "HH:00"/], [{ jobs: [due, { ...due, id: 'DUE' }] }, /id が jobs\[0\] と同じ/], [{ version: 1, jobs: [due], extra: 1 }, /extra: 知らない項目/], ['[]', /オブジェクトではありません/]]) {
      const { r, text } = await cli(['ci'], { file: scheduleFile(content), env: ENV(f.url) });
      ok(r === false && re.test(text) && /正しくないので、何も始めません/.test(text), text);
    }
    eq(f.st.seen.length, 0, 'GitHub not asked at all');
    // (a BOM from an editor is not a broken file)
    const bom = await cli(['ci'], { file: scheduleFile(`\uFEFF${JSON.stringify({ jobs: [due] })}`), env: ENV(f.url) });
    ok(bom.r === true && f.st.dispatched.length === 1, bom.text);
    const none = await cli(['ci'], { file: path.join(TMP, 'nowhere', 'bds-lab-schedule.json'), env: ENV(f.url) });
    ok(none.r === true && /予約はありません/.test(none.text), none.text);
    const file = scheduleFile({ jobs: JOBS });
    for (const env of [{ GITHUB_REPOSITORY: 'o/lab', GITHUB_API_URL: f.url }, { GITHUB_TOKEN: TOKEN, GITHUB_API_URL: f.url }, { GITHUB_REPOSITORY: 'not a repo', GITHUB_TOKEN: TOKEN, GITHUB_API_URL: f.url }]) {
      const out = await cli(['ci'], { file, env });
      ok(out.r === false && /GITHUB_REPOSITORY と GITHUB_TOKEN が要ります/.test(out.text) && !out.text.includes(TOKEN), out.text);
    }
    const seen = f.st.seen.length;
    const dry = await cli(['ci', '--dry'], { file, env: {} });
    ok(dry.r === true && dry.lines.includes('▷ 始めます（--dry: 始めていません）: tokyo-3 — verify.yml・毎日 03:00（Asia/Tokyo）') && dry.lines.at(-1) === '予約 10 件（2026-10-08 18:17 UTC）: 始める 6・今ではない 3・止めている 1', dry.text);
    eq(f.st.seen.length, seen, '--dry asks GitHub nothing');
  } finally { await f.close(); }
});

await t('list and check: each job with when, its next three times, on or paused; the file checked (exit 1 when it is not right); usage', async () => {
  const file = scheduleFile({ version: 1, jobs: JOBS });
  const l = await cli(['list'], { file });
  ok(l.r === true && l.lines[0] === `予約 10 件（${S.SCHEDULE_FILE}）`, l.text);
  ok(l.lines.includes('▶ tokyo-3  verify.yml  毎日 03:00（Asia/Tokyo）  次 10/10（土）03:00・10/11（日）03:00・10/12（月）03:00  入力 mode=quick'), l.text);
  ok(l.lines.includes('⏸ paused  verify.yml  毎日 03:00（Asia/Tokyo）  止めています  — 止めておく'), l.text);
  const c = await cli(['check'], { file });
  ok(c.r === true && c.lines.at(-1) === `✔ ${S.SCHEDULE_FILE}: 予約 10 件（動かす 9 件）、正しい形です`, c.text);
  const badFile = scheduleFile({ jobs: [{ id: 'x', workflow: 'schedule.yml', every: 'day', at: '03:00' }] });
  const bc = await cli(['check'], { file: badFile });
  ok(bc.r === false && bc.lines.some((x) => /^✘ jobs\[0\]（x）: workflow: schedule\.yml は予約できません/.test(x)), bc.text);
  const bl = await cli(['list'], { file: badFile });
  ok(bl.r === false && /直すまでどれも始まりません/.test(bl.text), bl.text);
  const nf = path.join(TMP, 'nowhere', 'x.json');
  eq([(await cli(['check'], { file: nf })).r, (await cli(['list'], { file: nf })).r], [true, true]);
  const u = await cli([], { file });
  ok(u.r === false && /usage: node lab\.mjs schedule ci \[--dry\] \| list \| check/.test(u.text), u.text);
  ok((await cli(['help'], { file })).r === true, 'help is not a failure');
});

// ---- the 「予約」 tab on a small DOM: enough for panel/ui/dom.mjs's h and the tab ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  // (attributes the page reads back as properties)
  const REFLECT = { type: (v) => v, id: (v) => v, disabled: () => true, hidden: () => true };
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, hidden: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (REFLECT[k]) this[k] = REFLECT[k](String(v)); }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    // (a real DOM shows null, undefined or a list handed to append as text: told here)
    append(...xs) { for (const x of xs) { if (x === null || x === undefined || Array.isArray(x)) throw new Error(`append(${x === null ? 'null' : Array.isArray(x) ? '[…]' : 'undefined'})`); const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    click() { return this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}

await t('the 「予約」 tab: the jobs with when and their next three times; added from a workflow\'s own inputs (a required one asked for), changed, paused, deleted — each written with the sha read, through guarded(dispatch, { file }); schedule.yml never offered and its state shown; ai-make asked first; hostrun.yml needs its role; a change made elsewhere read again, not written over (fake DOM)', async () => {
  const { E, toast } = fakeDom();
  const UI = await imp('panel/ui/schedule.mjs'), DOM = await imp('panel/ui/dom.mjs');
  const NOWMS = Date.parse('2026-10-08T18:10:00Z');
  const files = { [S.SCHEDULE_FILE]: { text: JSON.stringify({ version: 1, jobs: [{ id: 'verify-1', workflow: 'verify.yml', inputs: { mode: 'full', why: 'x' }, every: 'day', at: '03:00', timezone: 'Asia/Tokyo' }] }), sha: 's1' } };
  let shaN = 1;
  const calls = [];
  const api = {
    async file(r, p) { calls.push(['file', r, p]); const f = files[p]; return f ? { text: f.text, sha: f.sha } : null; },
    async putFile(r, p, text, sha, message) {
      calls.push(['put', r, p, sha, message]);
      if ((files[p]?.sha ?? undefined) !== sha) throw Object.assign(new Error(`GitHub: 409 ${p} does not match ${sha}`), { status: 409 });
      files[p] = { text, sha: `s${++shaN}` };
      return { content: { sha: files[p].sha } };
    },
  };
  const INPUTS = {
    'verify.yml': { dispatch: true, inputs: [{ name: 'mode', description: 'how much', default: 'quick', type: 'choice', options: ['quick', 'full'], required: false }, { name: 'why', description: '', default: '', type: 'string', options: [], required: true }] },
    'ai-make.yml': { dispatch: true, inputs: [{ name: 'request', description: 'what to make', default: '', type: 'string', options: [], required: false }, { name: 'unit', description: '', default: '', type: 'string', options: [], required: false }] },
    'hostrun.yml': { dispatch: true, inputs: [{ name: 'job', description: '', default: 'gate', type: 'string', options: [], required: false }] },
  };
  const guards = [], asked = [];
  let answer = true;
  globalThis.confirm = (q) => { asked.push(q); return answer; };
  const ctx = (over = {}) => ({ api, lab: { slug: 'o/lab', repo: { default_branch: 'main' } },
    workflows: [{ name: 'verify', path: '.github/workflows/verify.yml', state: 'active' }, { name: 'ai-make', path: '.github/workflows/ai-make.yml', state: 'active' }, { name: 'pages', path: '.github/workflows/pages.yml', state: 'active' },
      { name: 'hostrun', path: '.github/workflows/hostrun.yml', state: 'active' }, { name: 'schedule', path: '.github/workflows/schedule.yml', state: 'disabled_inactivity' }, { name: 'old', path: '.github/workflows/old.yml', state: 'disabled_manually' }],
    dispatchInputs: async (file) => INPUTS[file] ?? { dispatch: false, inputs: [] },
    may: (a) => a === 'dispatch', gate: (a) => (a === 'dispatch' ? {} : { disabled: true, title: 'no' }),
    // (as the panel's: the action allowed, done, and a failure told — not thrown)
    guarded: async (action, detail, fn, done) => { guards.push({ action, detail }); try { const r = await fn(); if (done) DOM.toast(done); return r; } catch (e) { DOM.toast(e.message, true); return undefined; } },
    now: () => NOWMS, ...over });
  const body = new E('div');
  await UI.scheduleTab(body, ctx());
  const btn = (root, text) => root.all((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const label = (root, l) => root.all((e) => e.attrs['aria-label'] === l)[0];
  const rows = () => body.all((e) => e.tagName === 'LI' && e.attrs['data-job'] !== undefined);
  const last = () => toast.kids.at(-1)?.textContent ?? '';
  const written = () => JSON.parse(files[S.SCHEDULE_FILE].text).jobs;
  const form = () => body.all((e) => e.id === 'scheduleform')[0];

  ok(/毎日 03:00（Asia\/Tokyo）/.test(rows()[0].textContent) && rows()[0].textContent.includes('次: 10/10（土）03:00・10/11（日）03:00・10/12（月）03:00') && /入力: mode=full why=x/.test(rows()[0].textContent), rows()[0].textContent);
  ok(/schedule\.yml が GitHub で止まっています（disabled_inactivity: 公開リポジトリは 60 日/.test(body.textContent), 'the scheduler\'s own state');

  // add: the workflows offered, a required input asked for
  await btn(body, '＋ 予約を足す')[0].click();
  eq(label(form(), 'ワークフロー').all((e) => e.tagName === 'OPTION').map((o) => o.value), ['verify.yml', 'ai-make.yml', 'pages.yml', 'hostrun.yml'], 'schedule.yml and a stopped one not offered');
  await btn(form(), '予約する')[0].click();
  ok(/入力 why が要ります/.test(last()) && !calls.some((c) => c[0] === 'put'), last());
  label(form(), 'why').value = 'nightly';
  label(form(), 'いつ').value = 'week'; await label(form(), 'いつ').fire('change');
  label(form(), '時刻').value = '09:00'; await label(form(), '時刻').fire('change');
  label(form(), '時間帯').value = 'Asia/Tokyo'; await label(form(), '時間帯').fire('input');
  const preview = body.all((e) => e.id === 'schedulepreview')[0];
  eq(preview.textContent, '毎週 月曜 09:00（Asia/Tokyo）・次: 10/12（月）09:00・10/19（月）09:00・10/26（月）09:00');
  ok(label(form(), '何時間ごと').parent.hidden === true && label(form(), '曜日').parent.hidden === false, 'the fields of "week" only');
  label(form(), '時間帯').value = 'Mars/Base'; await label(form(), '時間帯').fire('input');
  ok(preview.className === 'warn' && /知らない時間帯/.test(preview.textContent), preview.textContent);
  label(form(), '時間帯').value = 'Asia/Tokyo';
  await btn(form(), '予約する')[0].click();
  eq(calls.filter((c) => c[0] === 'put').map((c) => c[3]), ['s1'], 'written with the sha read');
  eq(guards.at(-1), { action: 'dispatch', detail: { file: S.SCHEDULE_FILE, workflow: 'verify.yml' } });
  eq(written()[1], { id: 'verify-2', workflow: 'verify.yml', inputs: { mode: 'quick', why: 'nightly' }, every: 'week', at: '09:00', weekday: 1, timezone: 'Asia/Tokyo', enabled: true });
  ok(!form() && rows().length === 2 && /予約しました: verify\.yml・毎週 月曜 09:00/.test(last()), last());

  // pause the first, change the second (its id kept)
  await btn(rows()[0], '止める')[0].click();
  eq([written()[0].enabled, calls.filter((c) => c[0] === 'put').at(-1)[3]], [false, 's2']);
  ok(/⏸ 止めています/.test(rows()[0].textContent) && /止めている間は始まりません/.test(rows()[0].textContent), rows()[0].textContent);
  await btn(rows()[1], '直す')[0].click();
  eq([label(form(), 'いつ').value, label(form(), '曜日').value, label(form(), 'why').value, label(form(), 'mode').value], ['week', '1', 'nightly', 'quick'], 'the job\'s own values');
  label(form(), '時刻').value = '10:00';
  await btn(form(), '保存')[0].click();
  eq([written()[1].id, written()[1].at, written().length], ['verify-2', '10:00', 2]);

  // ai-make: asked first — no, nothing written; yes, written (an empty input left to its default)
  await btn(body, '＋ 予約を足す')[0].click();
  label(form(), 'ワークフロー').value = 'ai-make.yml'; await label(form(), 'ワークフロー').fire('change');
  ok(/AI の API の料金/.test(form().textContent) && label(form(), 'request') && !label(form(), 'why'), 'its own inputs');
  label(form(), 'request').value = 'ルビーの剣';
  // (a new job's time zone is this browser's: set, so the test is the same wherever it runs)
  label(form(), '時間帯').value = 'UTC';
  const puts = () => calls.filter((c) => c[0] === 'put').length, before = puts();
  answer = false;
  await btn(form(), '予約する')[0].click();
  ok(/^AI の料金を使います: ai-make\.yml は始まるたびに/.test(asked.at(-1)) && puts() === before, asked.at(-1));
  answer = true;
  await btn(form(), '予約する')[0].click();
  eq(written()[2], { id: 'ai-make-1', workflow: 'ai-make.yml', inputs: { request: 'ルビーの剣' }, every: 'day', at: '03:00', timezone: 'UTC', enabled: true });
  // (paused and resumed: asked again on resuming)
  await btn(rows()[2], '止める')[0].click();
  const n = asked.length;
  await btn(rows()[2], '動かす')[0].click();
  ok(asked.length === n + 1 && /AI の料金を使います/.test(asked.at(-1)) && written()[2].enabled === true, asked.at(-1));

  // a workflow that cannot be started by hand; hostrun.yml without the role for it
  await btn(body, '＋ 予約を足す')[0].click();
  label(form(), 'ワークフロー').value = 'pages.yml'; await label(form(), 'ワークフロー').fire('change');
  ok(/手で始められません/.test(form().textContent), form().textContent);
  const p2 = puts();
  await btn(form(), '予約する')[0].click();
  label(form(), 'ワークフロー').value = 'hostrun.yml'; await label(form(), 'ワークフロー').fire('change');
  await btn(form(), '予約する')[0].click();
  ok(puts() === p2 && /hostrun\.yml）予約は、あなたの役割には許されていません/.test(last()), last());
  await btn(form(), 'やめる')[0].click();

  // delete
  await btn(rows()[2], '消す')[0].click();
  ok(/^予約「ai-make\.yml・毎日 03:00（UTC）」を消しますか/.test(asked.at(-1)) && written().length === 2 && rows().length === 2, asked.at(-1));

  // changed elsewhere since it was read: not written over — read again
  files[S.SCHEDULE_FILE] = { text: JSON.stringify({ version: 1, jobs: [...written(), { id: 'theirs', workflow: 'verify.yml', every: 'hour' }] }), sha: 'elsewhere' };
  await btn(rows()[0], '動かす')[0].click();
  ok(/does not match/.test(last()) && rows().length === 3 && files[S.SCHEDULE_FILE].sha === 'elsewhere' && rows()[2].textContent.includes('毎時'), last());
  await btn(rows()[0], '動かす')[0].click();
  eq([written()[0].enabled, written()[2].id], [true, 'theirs'], 'then written on the sha read again');

  // a job written by hand that is not right: shown with why, mended in the form; the file's own errors at the top
  files[S.SCHEDULE_FILE] = { text: JSON.stringify({ version: 1, jobs: [{ id: 'hand', workflow: 'verify.yml', inputs: { why: 'w' }, every: 'day', at: '03:30', timezone: 'Asia/Tokyo' }, { id: 'ok', workflow: 'verify.yml', every: 'hour' }], extra: true }), sha: 'h1' };
  await btn(body, '読み直す')[0].click();
  ok(/直すまで、どの予約も始まりません/.test(body.textContent) && /extra: 知らない項目/.test(body.textContent) && /正しくない予約/.test(rows()[0].textContent) && /分は 00/.test(rows()[0].textContent), body.textContent);
  await btn(rows()[0], '直す')[0].click();
  eq([label(form(), '時刻').value, label(form(), 'why').value], ['03:00', 'w']);
  await btn(form(), '保存')[0].click();
  eq(JSON.parse(files[S.SCHEDULE_FILE].text), { version: 1, jobs: [{ id: 'hand', workflow: 'verify.yml', inputs: { mode: 'quick', why: 'w' }, every: 'day', at: '03:00', timezone: 'Asia/Tokyo', enabled: true }, { id: 'ok', workflow: 'verify.yml', inputs: {}, every: 'hour', hours: 1, timezone: 'UTC', enabled: true }] });
  ok(!/直すまで/.test(body.textContent), 'mended');

  // not JSON: said; saving over it asked first. No file: made (no sha)
  files[S.SCHEDULE_FILE] = { text: 'nope', sha: 'b1' };
  const broken = new E('div');
  await UI.scheduleTab(broken, ctx());
  ok(/JSON ではありません/.test(broken.textContent), broken.textContent);
  await btn(broken, '＋ 予約を足す')[0].click();
  const bf = broken.all((e) => e.id === 'scheduleform')[0];
  label(bf, 'why').value = 'again';
  await btn(bf, '予約する')[0].click();
  ok(/JSON として読めません。保存すると、その中身は消えて/.test(asked.at(-1)) && written().length === 1 && files[S.SCHEDULE_FILE].sha !== 'b1', asked.at(-1));
  delete files[S.SCHEDULE_FILE];
  const fresh = new E('div');
  await UI.scheduleTab(fresh, ctx());
  ok(/まだ予約はありません/.test(fresh.textContent), fresh.textContent);
  await btn(fresh, '＋ 予約を足す')[0].click();
  label(fresh.all((e) => e.id === 'scheduleform')[0], 'why').value = 'first';
  await btn(fresh.all((e) => e.id === 'scheduleform')[0], '予約する')[0].click();
  eq([calls.filter((c) => c[0] === 'put').at(-1)[3], written().map((j) => j.id)], [undefined, ['verify-1']], 'a new file: no sha');

  // a role that may not start workflows: the list only
  const ro = new E('div');
  await UI.scheduleTab(ro, ctx({ may: () => false, gate: () => ({ disabled: true, title: 'no' }) }));
  ok(/見るだけです/.test(ro.textContent) && btn(ro, '＋ 予約を足す')[0].disabled && btn(ro, '止める')[0].disabled && btn(ro, '消す')[0].disabled, ro.textContent);
  ok(!body.all((e) => /^(https?:)?\/\//.test(e.attrs.href ?? '') && !/^https:\/\/github\.com\//.test(e.attrs.href)).length, 'links to GitHub only');
});

// ---- the 「予約」 tab when GitHub says no: its own fake DOM, and a fake api that reads and writes as GitHub does (with the
// sha), told to fail its reads (readError) or to refuse the next write (refusal) ----
async function sayNo(jobs) {
  const { E, toast } = fakeDom();
  const UI = await imp('panel/ui/schedule.mjs'), DOM = await imp('panel/ui/dom.mjs');
  const g = { files: { [S.SCHEDULE_FILE]: { text: JSON.stringify({ version: 1, jobs }), sha: 's1' } }, reads: 0, readError: null, refusal: null };
  let shaN = 1;
  g.api = {
    async file(r, p) { g.reads++; if (g.readError) throw g.readError; return g.files[p] ? { ...g.files[p] } : null; },
    async putFile(r, p, text, sha) {
      // (as GitHub: a sha that is not the file's — or none for a file that is there — refused in GitHub's own words)
      if (g.refusal) { const e = g.refusal; g.refusal = null; throw e; }
      if (g.files[p] && sha === undefined) throw Object.assign(new Error('GitHub が受け付けません: Invalid request.\n\n"sha" wasn\'t supplied.'), { status: 422 });
      if (g.files[p]?.sha !== sha) throw Object.assign(new Error(`GitHub: 409 ${p} does not match ${sha}`), { status: 409 });
      g.files[p] = { text, sha: `s${++shaN}` };
      return { content: { sha: g.files[p].sha } };
    },
  };
  globalThis.confirm = () => true;
  const ctx = { api: g.api, lab: { slug: 'o/lab', repo: { default_branch: 'main' } }, workflows: ['verify.yml'], may: () => true, now: () => NOW,
    dispatchInputs: async () => ({ dispatch: true, inputs: [{ name: 'why', description: '', default: '', type: 'string', options: [], required: true }] }),
    guarded: async (action, detail, fn, done) => { try { const r = await fn(); if (done) DOM.toast(done); return r; } catch (e) { DOM.toast(e.message, true); return undefined; } } };
  return { g, tab: async (body = new E('div')) => ({ body, read: await UI.scheduleTab(body, ctx) }),
    btn: (root, text) => root.all((e) => e.tagName === 'BUTTON' && e.textContent === text), label: (root, l) => root.all((e) => e.attrs['aria-label'] === l)[0],
    rows: (root) => root.all((e) => e.tagName === 'LI' && e.attrs['data-job'] !== undefined), form: (root) => root.all((e) => e.id === 'scheduleform')[0],
    bad: (root) => root.all((e) => e.className === 'bad'), last: () => toast.kids.at(-1)?.textContent ?? '' };
}

await t('the 「予約」 tab, the file not read (GitHub down, the network, no right to it): why in the list\'s place (class bad) with 「読み直す」 — never 「読んでいます…」 for good, nor the jobs read before as if they were the file\'s; read again, the list there (fake DOM)', async () => {
  const { g, tab, btn, rows, bad } = await sayNo([{ id: 'verify-1', workflow: 'verify.yml', every: 'day', at: '03:00', timezone: 'Asia/Tokyo' }]);
  g.readError = Object.assign(new Error('GitHub: 502 Bad Gateway'), { status: 502 });
  const { body, read } = await tab();
  eq(read, undefined, 'not read');
  ok(!body.textContent.includes('読んでいます') && bad(body).length === 1 && bad(body)[0].textContent.startsWith(`${S.SCHEDULE_FILE} を読めません: GitHub: 502 Bad Gateway`) && btn(bad(body)[0], '読み直す').length === 1, body.textContent);
  const place = bad(body)[0].parent;
  g.readError = new TypeError('Failed to fetch');
  await btn(bad(body)[0], '読み直す')[0].click();
  ok(bad(body).length === 1 && bad(body)[0].textContent.startsWith(`${S.SCHEDULE_FILE} を読めません: Failed to fetch`), body.textContent);
  g.readError = null;
  await btn(bad(body)[0], '読み直す')[0].click();
  ok(!bad(body).length && rows(body).length === 1 && body.all((e) => e.id === 'schedulelist')[0].parent === place, `read: the list where the reason was → ${body.textContent}`);
  // read before, not now (「読み直す」 under the list): why in the list's place, not the jobs read before
  g.readError = Object.assign(new Error('このトークンには、その操作の権限がありません（Resource not accessible by integration）'), { status: 403 });
  await btn(body, '読み直す')[0].click();
  ok(!rows(body).length && bad(body).length === 1 && bad(body)[0].textContent.startsWith(`${S.SCHEDULE_FILE} を読めません: このトークンには、その操作の権限がありません`), body.textContent);
  g.readError = null;
  await btn(bad(body)[0], '読み直す')[0].click();
  eq([rows(body).length, bad(body).length], [1, 0]);
});

await t('the 「予約」 tab, a write GitHub refuses: one whose sha read is no longer the file\'s (409 「does not match」, 409 「is at … but expected …」, 422 「"sha" wasn\'t supplied」) read again, the form closed; any other 409 / 422 (a protected default branch, a ruleset) — the form kept as typed, GitHub\'s own words with what it may be, nothing read again (fake DOM)', async () => {
  const mine = { id: 'verify-1', workflow: 'verify.yml', inputs: { why: 'w' }, every: 'day', at: '03:00', timezone: 'Asia/Tokyo' };
  const { g, tab, btn, label, rows, form, last } = await sayNo([mine]);
  const { body } = await tab(), P = S.SCHEDULE_FILE;
  await btn(rows(body)[0], '直す')[0].click();
  label(form(body), 'why').value = 'typed';
  label(form(body), '時刻').value = '05:00';
  for (const [status, said] of [[409, 'GitHub: 409 Repository rule violations found\n\nChanges must be made through a pull request.\n\n'], [422, 'GitHub が受け付けません: Protected branch update failed for refs/heads/main.']]) {
    const reads = g.reads;
    g.refusal = Object.assign(new Error(said), { status });
    await btn(form(body), '保存')[0].click();
    ok(form(body) && label(form(body), 'why').value === 'typed' && label(form(body), '時刻').value === '05:00', `${status}: the form kept as typed`);
    ok(last().startsWith(said) && last().endsWith('既定の枝が守られているかもしれません（PR が要ります）'), last());
    eq([g.reads, g.files[P].sha], [reads, 's1'], `${status}: nothing read again, nothing written`);
  }
  // (a row's own button: the same — and the form open meanwhile left as it is)
  g.refusal = Object.assign(new Error('GitHub: 409 Repository rule violations found'), { status: 409 });
  const reads = g.reads;
  await btn(rows(body)[0], '止める')[0].click();
  ok(form(body) && label(form(body), 'why').value === 'typed' && g.reads === reads && /既定の枝が守られているかもしれません/.test(last()), last());
  // changed elsewhere since it was read — GitHub says the sha does not match: read again, nothing written over, the form closed
  g.files[P] = { text: JSON.stringify({ version: 1, jobs: [mine, { id: 'theirs', workflow: 'verify.yml', every: 'hour' }] }), sha: 'elsewhere' };
  await btn(form(body), '保存')[0].click();
  ok(!form(body) && rows(body).length === 2 && /does not match s1/.test(last()) && !/守られて/.test(last()) && g.files[P].sha === 'elsewhere', last());
  // (the branch moved under the write: the same)
  await btn(rows(body)[1], '直す')[0].click();
  label(form(body), 'why').value = 'x';
  g.refusal = Object.assign(new Error('GitHub: 409 is at 0123abc but expected 4567def'), { status: 409 });
  const before = g.reads;
  await btn(form(body), '保存')[0].click();
  ok(!form(body) && g.reads === before + 1 && !/守られて/.test(last()), last());
  // (made elsewhere while it was read as none — GitHub asks for its sha: read again, theirs shown, nothing written over)
  delete g.files[P];
  const { body: fresh } = await tab();
  ok(/まだ予約はありません/.test(fresh.textContent), fresh.textContent);
  await btn(fresh, '＋ 予約を足す')[0].click();
  label(form(fresh), 'why').value = 'mine';
  g.files[P] = { text: JSON.stringify({ version: 1, jobs: [{ id: 'theirs', workflow: 'verify.yml', every: 'hour' }] }), sha: 't1' };
  await btn(form(fresh), '予約する')[0].click();
  ok(!form(fresh) && /"sha" wasn't supplied/.test(last()) && rows(fresh).map((r) => r.attrs['data-job']).join() === 'theirs' && g.files[P].sha === 't1', last());
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
