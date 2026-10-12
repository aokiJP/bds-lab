// nlsched (a schedule from a Japanese sentence) without a browser or a network: a table of sentences → the job(s) read (each
// through schedule.mjs's checkJob) or the question asked (nothing guessed), and the card on a small fake DOM (said back, the
// button off with its reason, the job(s) handed to onJob — which here writes them as the 「予約」 tab does, through a fake
// guarded that follows the policy and a fake GitHub that follows ghrules).
// node tests/nlsched-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const N = await imp('panel/lib/nlsched.mjs'), S = await imp('panel/lib/schedule.mjs'), { fakeCheck } = await imp('panel/lib/ghrules.mjs'), P = await imp('panel/lib/policy.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const WF = [{ name: 'verify', path: '.github/workflows/verify.yml', state: 'active' }, 'unit.yml', 'latest.yml', 'ai-make.yml', 'schedule.yml', 'weekly.yml',
  { name: 'old', path: '.github/workflows/old.yml', state: 'disabled_manually' }];
const OPTS = { workflows: WF, units: ['ruby', 'lamp'], tz: 'Asia/Tokyo' };
const TK = 'Asia/Tokyo';

// [sentence, what is wanted: { every, at?, hours?, weekdays?, workflow, inputs?, timezone?, said? } or { ask: /re/ }]
const TABLE = [
  ['毎週月曜の朝 9 時に verify', { workflow: 'verify.yml', every: 'week', at: '09:00', weekdays: [1], said: '毎週月曜 09:00（Asia/Tokyo）に verify.yml' }],
  ['平日の夜 10 時に unit test ruby', { workflow: 'unit.yml', inputs: { job: 'test', unit: 'ruby' }, every: 'week', at: '22:00', weekdays: [1, 2, 3, 4, 5] }],
  ['3 時間ごとに latest', { workflow: 'latest.yml', every: 'hour', hours: 3 }],
  ['毎日九時に verify', { workflow: 'verify.yml', every: 'day', at: '09:00', said: '毎日 09:00（Asia/Tokyo）に verify.yml' }],
  ['毎日二十三時に verify.yml', { workflow: 'verify.yml', every: 'day', at: '23:00' }],
  ['毎日　２１時に　ｖｅｒｉｆｙ', { workflow: 'verify.yml', every: 'day', at: '21:00' }],
  ['毎日 午後３時に latest', { workflow: 'latest.yml', every: 'day', at: '15:00' }],
  ['毎日 午前 0 時に latest', { workflow: 'latest.yml', every: 'day', at: '00:00' }],
  ['毎日 夕方5時に weekly', { workflow: 'weekly.yml', every: 'day', at: '17:00' }],
  ['毎晩 11 時に verify', { workflow: 'verify.yml', every: 'day', at: '23:00' }],
  ['毎日 21:00 UTC に latest', { workflow: 'latest.yml', every: 'day', at: '21:00', timezone: 'UTC' }],
  ['毎日 日本時間の 3 時に verify', { workflow: 'verify.yml', every: 'day', at: '03:00', timezone: TK }],
  ['毎週金曜 18 時 America/New_York で weekly', { workflow: 'weekly.yml', every: 'week', at: '18:00', weekdays: [5], timezone: 'America/New_York' }],
  ['週末の朝7時にlatest', { workflow: 'latest.yml', every: 'week', at: '07:00', weekdays: [6, 0] }],
  ['毎週土日の昼12時に weekly', { workflow: 'weekly.yml', every: 'week', at: '12:00', weekdays: [6, 0] }],
  ['毎週月・水・金曜の 二十三時 に verify', { workflow: 'verify.yml', every: 'week', at: '23:00', weekdays: [1, 3, 5] }],
  ['六時間おきに verify', { workflow: 'verify.yml', every: 'hour', hours: 6 }],
  ['毎時 latest', { workflow: 'latest.yml', every: 'hour', hours: 1 }],
  ['ユニット ruby の試験を毎晩11時', { workflow: 'unit.yml', inputs: { job: 'test', unit: 'ruby' }, every: 'day', at: '23:00' }],
  ['毎日 4 時に unit sim lamp', { workflow: 'unit.yml', inputs: { job: 'sim', unit: 'lamp' }, every: 'day', at: '04:00' }],
  ['ai-make を毎日 3 時に「光る剣を作る」', { workflow: 'ai-make.yml', inputs: { request: '光る剣を作る' }, every: 'day', at: '03:00' }],
  // asked, never guessed
  ['毎日十時半に verify', { ask: /分は 00 だけ.*10:00 か 11:00/ }],
  ['毎日 9:30 に verify', { ask: /分は 00 だけ/ }],
  ['毎朝 verify', { ask: /何時ですか/ }],
  ['毎日 verify', { ask: /何時ですか/ }],
  ['午後３時に verify', { ask: /毎日ですか、毎週ですか/ }],
  ['毎日 9 時', { ask: /何を予約しますか/ }],
  ['5時間ごとに latest', { ask: /5 時間ごとはできません/ }],
  ['30分ごとに latest', { ask: /1 時間に 1 回まで/ }],
  ['毎月 1 日に verify', { ask: /毎月/ }],
  ['毎週 9 時に verify', { ask: /何曜日/ }],
  ['unit ruby 毎日 9 時', { ask: /test・sim・go/ }],
  ['毎日 9 時に unit test', { ask: /どのユニット/ }],
  ['毎日 9 時に unit test gold', { ask: /「gold」というユニットはありません/ }],
  ['毎日 9 時に ai-make', { ask: /「…」の中に/ }],
  ['毎日 9 時に schedule', { ask: /schedule\.yml は予約できません/ }],
  ['毎日 9 時に old', { ask: /止まっています/ }],
  ['毎日 9 時に nope.yml', { ask: /nope\.yml というワークフローはありません/ }],
  ['毎日 9 時に verify と latest', { ask: /どれですか/ }],
  ['毎日 朝 13 時に verify', { ask: /は何時ですか/ }],
  ['毎日 9 時と 21 時に verify', { ask: /時刻が 2 つ/ }],
  ['3時間ごとに 毎日 verify', { ask: /一緒にできません/ }],
  ['毎日 9 時 Mars/Base に verify', { ask: /知らない時間帯/ }],
  ['', { ask: /いつ・何を/ }],
];

await t(`the table: ${TABLE.length} sentences → their job(s), each through checkJob, or a question (pure)`, () => {
  ok(TABLE.length >= 20, 'twenty or more');
  for (const [text, want] of TABLE) {
    const r = N.parse(text, OPTS);
    if (want.ask) {
      ok(r.ask && want.ask.test(r.ask), `${text}: asked ${JSON.stringify(r.ask)} said ${JSON.stringify(r.said)}`);
      eq([r.job, r.jobs], [null, []], `${text}: nothing made when asked`);
      continue;
    }
    ok(!r.ask, `${text}: asked ${r.ask}`);
    eq(r.job, r.jobs[0], `${text}: job is the first`);
    eq(r.jobs.map((j) => j.weekday ?? null), want.weekdays ?? [null], `${text}: weekdays`);
    for (const j of r.jobs) {
      eq(S.checkJob(j), { job: j, errors: [] }, `${text}: checkJob`);
      eq([j.workflow, j.every, j.at, j.hours, j.inputs, j.timezone, j.enabled], [want.workflow, want.every, want.at, want.hours, want.inputs ?? {}, want.timezone ?? TK, true], `${text}`);
    }
    if (want.said) eq(r.said, want.said, `${text}: said`);
    ok(r.said.includes(want.workflow), `${text}: said names the workflow: ${r.said}`);
  }
});

await t('normalize: full-width and kanji numerals become digits (九 十 十二 二十三 〇)', () => {
  eq(N.normalize('九時・十時・十二時・二十三時・〇時　１０時'), '9時・10時・12時・23時・0時 10時');
  eq(N.normalize('三時間おき'), '3時間おき');
});

await t('ids: new ones are not the schedule\'s (平日: five, one after another); the time zone falls back to UTC', () => {
  const r = N.parse('平日の夜 10 時に verify', { ...OPTS, ids: ['verify-1', 'VERIFY-3'] });
  eq(r.jobs.map((j) => j.id), ['verify-2', 'verify-4', 'verify-5', 'verify-6', 'verify-7']);
  ok(/平日（月〜金）22:00（Asia\/Tokyo）に verify\.yml（予約 5 件）/.test(r.said), r.said);
  eq(N.parse('毎日 9 時に verify', { workflows: WF, tz: 'Nowhere/Land' }).job.timezone, 'UTC');
  eq(S.checkSchedule({ version: 1, jobs: r.jobs }).errors, [], 'together they are a schedule');
  // the unit's said: what and its inputs
  ok(/に unit\.yml（job=test unit=ruby）/.test(N.parse('毎日 9 時に unit test ruby', OPTS).said), 'unit said');
  // a question keeps what was understood
  eq(N.parse('毎日十時半に verify', OPTS).said, 'verify.yml');
});

// ---- the card on a small DOM ----
function fakeDom() {
  class Nd { get textContent() { return ''; } }
  class T extends Nd { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends Nd {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { if (x === null || x === undefined || Array.isArray(x)) throw new Error('append(bad)'); const n = x instanceof Nd ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    set textContent(s) { this.kids = []; if (s) this.append(String(s)); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this }))); }
    // (as a browser's: a disabled button is not pressed)
    click() { return this.disabled ? Promise.resolve([]) : this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = Nd;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null) };
  return { toast };
}

await t('the card: said back as typed, a question turns the button off with its reason, 「この予約を足す」 hands each job to onJob (written through guarded(dispatch) to a fake GitHub that follows ghrules); a viewer cannot (fake DOM)', async () => {
  const { toast } = fakeDom();
  const UI = await imp('panel/ui/nlsched.mjs'), DOM = await imp('panel/ui/dom.mjs');
  const files = {}, puts = [], guards = [];
  let n = 0;
  const api = {
    async putFile(r, p, text, sha, message) {
      const bad = fakeCheck('PUT', `/repos/${r}/contents/${p}`, { message, content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) });
      if (bad) throw Object.assign(new Error(bad.message), { status: 422 });
      if ((files[p]?.sha ?? undefined) !== sha) throw Object.assign(new Error('409 does not match'), { status: 409 });
      puts.push({ p, sha, message }); files[p] = { text, sha: `s${++n}` }; return { content: { sha: files[p].sha } };
    },
  };
  // (as the panel's: the policy decides before anything is sent)
  const guarded = (role) => async (action, detail, fn, done) => { guards.push({ action, detail }); if (!P.can(P.DEFAULT_POLICY, role, action)) { DOM.toast('許されていません', true); return undefined; } try { const r = await fn(); if (done) DOM.toast(done); return r; } catch (e) { DOM.toast(e.message, true); return undefined; } };
  // (the tab's save, in short: the jobs so far and this one, written with the sha read)
  const jobs = [];
  const onJob = (role) => async (job) => {
    const out = S.scheduleText([...jobs, job]);
    const r = await guarded(role)('dispatch', { file: S.SCHEDULE_FILE, workflow: job.workflow }, () => api.putFile('o/lab', S.SCHEDULE_FILE, out.text, files[S.SCHEDULE_FILE]?.sha, `panel: 予約 — ${job.id}`));
    if (r !== undefined) jobs.push(job);
    return r;
  };
  const ctx = { workflows: WF, units: ['ruby'], tz: TK, ids: () => jobs.map((j) => j.id), now: () => Date.UTC(2026, 9, 12, 0, 0), may: (a) => P.can(P.DEFAULT_POLICY, 'write', a) };
  const btn = (c) => c.all((e) => e.tagName === 'BUTTON' && /この予約を足す/.test(e.textContent))[0];
  const box = (c) => c.all((e) => e.tagName === 'INPUT')[0];
  const type = async (c, s) => { box(c).value = s; await box(c).fire('input'); };

  let card = UI.nlScheduleCard(ctx, { onJob: onJob('write') });
  ok(btn(card).disabled && /いつ・何を/.test(card.textContent), 'empty: off, with its reason');
  ok(/毎週月曜の朝 9 時に verify/.test(card.textContent), 'examples shown');
  await type(card, '毎日十時半に verify');
  ok(btn(card).disabled && /❓/.test(card.textContent) && /書き直して/.test(card.textContent), 'a question: off, with its reason');
  await btn(card).click(); eq(puts.length, 0, 'a disabled button is not pressed');
  // (pressed anyway — onclick called directly — it still adds nothing while there is a question)
  await btn(card).fire('click'); eq(puts.length, 0, 'nothing added while asking');

  await type(card, '平日の夜 10 時に unit test ruby');
  ok(!btn(card).disabled, 'understood: on');
  ok(/✔ 平日（月〜金）22:00（Asia\/Tokyo）に unit\.yml（job=test unit=ruby）（予約 5 件）/.test(card.textContent), card.textContent);
  ok(/次は 10\/12（月）22:00・10\/13（火）22:00・10\/14（水）22:00/.test(card.textContent), `next runs: ${card.textContent}`);
  await btn(card).click();
  eq(jobs.map((j) => [j.id, j.weekday]), [['unit-1', 1], ['unit-2', 2], ['unit-3', 3], ['unit-4', 4], ['unit-5', 5]], 'five jobs handed one by one');
  eq(guards.map((g) => g.action), Array(5).fill('dispatch')); eq(puts.map((p) => p.sha), [undefined, 's1', 's2', 's3', 's4'], 'each with the sha before it');
  eq(S.checkSchedule(JSON.parse(files[S.SCHEDULE_FILE].text)).errors, [], 'the file checks out');
  ok(/足しました/.test(card.textContent) && box(card).value === '', 'told, and the box emptied');

  // ids go on from those there
  await type(card, '毎日 9 時に unit go ruby');
  await btn(card).click(); eq(jobs.at(-1).id, 'unit-6');

  // onJobs: all at once
  let given = null;
  card = UI.nlScheduleCard({ ...ctx, ids: [] }, { onJobs: async (js) => { given = js; return true; } });
  await type(card, '週末の朝7時にlatest'); await btn(card).click();
  eq(given.map((j) => j.weekday), [6, 0]);

  // refused by the policy (a viewer's onJob): not added, said where the tab says it, the sentence kept
  const before = puts.length;
  card = UI.nlScheduleCard(ctx, { onJob: onJob('read') });
  await type(card, '毎日 9 時に verify'); await btn(card).click();
  eq(puts.length, before, 'refused: nothing written'); eq(box(card).value, '毎日 9 時に verify', 'kept as typed');
  ok(toast.textContent.includes('許されていません'), 'said');

  // a role without dispatch: off, with the reason
  card = UI.nlScheduleCard({ ...ctx, may: (a) => P.can(P.DEFAULT_POLICY, 'read', a) }, { onJob: onJob('read') });
  await type(card, '毎日 9 時に verify');
  ok(btn(card).disabled && /ワークフローを始める/.test(card.textContent), 'no right: off, with its reason');

  // no onJob: off, with the reason
  card = UI.nlScheduleCard(ctx);
  await type(card, '毎日 9 時に verify');
  ok(btn(card).disabled && /予約」のタブ/.test(card.textContent), 'nowhere to add');

  // onJob throws: failView, the sentence kept; part of several said
  let k = 0;
  card = UI.nlScheduleCard({ ...ctx, ids: [] }, { onJob: async () => { if (++k > 1) throw new Error('GitHub: 500'); return true; } });
  await type(card, '週末の朝7時にlatest'); await btn(card).click();
  ok(/GitHub: 500/.test(card.textContent) && /2 件のうち 1 件は足しました/.test(card.textContent), card.textContent);
  ok(card.all((e) => e.attrs.role === 'alert').length === 1, 'failView');

  // ai-make: the AI's cost said
  card = UI.nlScheduleCard(ctx, { onJob: onJob('write') });
  await type(card, 'ai-make を毎日 3 時に「光る剣」');
  ok(/AI の料金/.test(card.textContent), 'AI said');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
