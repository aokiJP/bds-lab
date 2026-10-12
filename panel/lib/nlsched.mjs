// nlsched: a schedule (lib/schedule.mjs's jobs) from a sentence in Japanese — 「毎週月曜の朝 9 時に verify」「平日の夜 10 時に unit
// test ruby」「3 時間ごとに latest」. Pure (no DOM, no fetch): the 「予約」 tab's card (panel/ui/nlsched.mjs) and Node's tests run it.
//
// What it reads: digits full-width or kanji (九時・二十三時・十時半), 午前/午後/朝/昼/夕方/夜/晩/深夜, 毎日/毎朝/毎晩/平日/週末/土日/
// 毎週X曜 (several: 月・水・金曜), N 時間ごと/おき, 毎時, a time zone (UTC・日本時間・Asia/Tokyo), the workflow by its file's name
// (verify, verify.yml), unit.yml as 「unit test ruby」 (test・sim・go and a unit's name), ai-make.yml's request in 「…」.
// What it does not know it asks (「何時？」…), never filled by a guess: minutes (the schedule starts once an hour), a time with
// no 毎日/毎週, a workflow not named. 平日 and 週末 are one job per day (a job has one weekday): jobs holds them all.
import * as S from './schedule.mjs';

const KANJI = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** a run of kanji numerals → its number: 九 9 · 十 10 · 十二 12 · 二十三 23 · 一二 12 (pure) */
function kanjiNumber(s) {
  const i = s.indexOf('十');
  const digits = (x) => (x === '' ? null : Number([...x].map((c) => KANJI[c]).join('')));
  if (i < 0) return digits(s);
  return (digits(s.slice(0, i)) ?? 1) * 10 + (digits(s.slice(i + 1).replace(/十/g, '')) ?? 0);
}
/** the sentence as it is read: full-width to half (NFKC), kanji numerals to digits, spaces one (pure) */
export function normalize(text) {
  return String(text ?? '').normalize('NFKC').replace(/[〇零一二三四五六七八九十]+/g, kanjiNumber).replace(/\s+/g, ' ').trim();
}

const WD = S.WEEKDAYS;
const pad = (x) => String(x).padStart(2, '0');
/** a workflow as ctx.workflows has it (GitHub's { name, path, state }, or a file name) → { file, base, active } */
const wfOf = (w) => { const file = String(w?.path ?? w ?? '').split('/').pop(); return { file, base: file.replace(/\.ya?ml$/, '').toLowerCase(), active: (w?.state ?? 'active') === 'active' }; };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (s) => new RegExp(`(?<![A-Za-z0-9_.-])${esc(s)}(?:\\.ya?ml)?(?![A-Za-z0-9_-])`, 'i');
/** a few workflows also by a Japanese word (only when the lab has them) */
const ALIASES = { verify: ['全体の試験'], latest: ['最新版', '最新'], weekly: ['週報'] };
const UNIT_JOBS = ['test', 'sim', 'go'];
const UNIT_JOB_WORDS = { 試験: 'test', テスト: 'test', シム: 'sim', 仕上げ: 'go' };

/** an hour said with a part of the day → 0..23, or null when it cannot be that (pure). 夜 12 時 and 深夜 12 時 are 0 時 */
function hourOf(part, h) {
  if (!Number.isInteger(h) || h < 0 || h > 24) return null;
  if (h === 24) return part ? null : 0;
  switch (part) {
    case '午前': return h === 12 ? 0 : h <= 11 ? h : null;
    case '午後': return h === 12 ? 12 : h <= 11 ? h + 12 : null;
    case '朝': return h >= 4 && h <= 11 ? h : null;
    case '昼': return h === 11 || h === 12 ? h : h >= 1 && h <= 4 ? h + 12 : null;
    case '夕方': return h >= 3 && h <= 7 ? h + 12 : h >= 15 && h <= 19 ? h : null;
    case '夜': case '晩': return h >= 6 && h <= 11 ? h + 12 : h === 12 ? 0 : h >= 18 && h <= 23 ? h : h <= 3 ? h : null;
    case '深夜': case '夜中': return h === 12 ? 0 : h <= 4 ? h : h >= 22 && h <= 23 ? h : null;
    case 'am': return h === 12 ? 0 : h <= 11 ? h : null;
    case 'pm': return h === 12 ? 12 : h <= 11 ? h + 12 : null;
    default: return h <= 23 ? h : null;
  }
}

/** a sentence → { job, jobs, said, ask } (pure).
 *  opts: { workflows (ctx.workflows: GitHub's { name, path, state } or file names), units (the units' names: a unit not among
 *  them is asked about; none given: any name of a unit's form), tz (the time zone when the sentence names none; else UTC),
 *  ids (the ids the schedule has: new ones are not those) }.
 *  jobs: each checks out by schedule.mjs's checkJob (平日: 5, 週末: 2, else 1); job: the first. said: what was read, in words
 *  (「毎週月曜 09:00（Asia/Tokyo）に verify.yml」). ask: what is not known, as a question — then job is null and jobs empty */
export function parse(text, opts = {}) {
  const raw = String(text ?? '').trim();
  let s = normalize(raw);
  const got = [], none = (ask) => ({ job: null, jobs: [], said: got.join('、'), ask });
  if (!s) return none('いつ・何を予約しますか（例: 毎週月曜の朝 9 時に verify）');

  // ---- the time zone (taken out first: its letters are no workflow's) ----
  let tz = null;
  const iana = s.match(/(?<![A-Za-z])([A-Z][A-Za-z]+\/[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)?)/);
  if (iana) { if (!S.validTimezone(iana[1])) return none(`${iana[1]} は知らない時間帯です（例 Asia/Tokyo・UTC）`); tz = iana[1]; s = s.replace(iana[0], ' '); }
  else if (/(?<![A-Za-z])(UTC|GMT)(?![A-Za-z])|協定世界時/i.test(s)) { tz = 'UTC'; s = s.replace(/(?<![A-Za-z])(UTC|GMT)(?![A-Za-z])|協定世界時/i, ' '); }
  else if (/日本時間|(?<![A-Za-z])JST(?![A-Za-z])/i.test(s)) { tz = 'Asia/Tokyo'; s = s.replace(/日本時間|(?<![A-Za-z])JST(?![A-Za-z])/i, ' '); }
  tz ??= S.validTimezone(opts.tz) ? opts.tz : 'UTC';

  // ---- what: the workflow (and its inputs) ----
  const wfs = (opts.workflows ?? []).map(wfOf).filter((w) => /\.ya?ml$/.test(w.file));
  let workflow = null, inputs = {};
  // (ai-make's request in 「…」 or "…" — taken out before anything else is read in it)
  const quoted = s.match(/「([^」]*)」|"([^"]*)"|“([^”]*)”/);
  if (quoted) s = s.replace(quoted[0], ' ');
  const request = quoted ? (quoted[1] ?? quoted[2] ?? quoted[3]).trim() : null;
  const unitM = s.match(/(?<![A-Za-z0-9_-])(?:unit(?:\.ya?ml)?|ユニット)(?![A-Za-z0-9_-])\s*(?:の\s*)?((?:[A-Za-z][A-Za-z0-9_]*|試験|テスト|シム|仕上げ)(?:\s*(?:を|の)?\s*(?:[A-Za-z][A-Za-z0-9_]*|試験|テスト|シム|仕上げ))?)?/i);
  if (unitM && (!wfs.length || wfs.some((w) => w.base === 'unit'))) {
    workflow = wfs.find((w) => w.base === 'unit')?.file ?? 'unit.yml';
    s = s.replace(unitM[0], ' ');
    const toks = (unitM[1] ?? '').split(/\s*(?:を|の)?\s+|\s*(?:を|の)\s*/).filter(Boolean);
    let job = null, unit = null;
    for (const t of toks) {
      const j = UNIT_JOBS.includes(t.toLowerCase()) ? t.toLowerCase() : UNIT_JOB_WORDS[t] ?? null;
      if (j && !job) job = j; else if (/^[A-Za-z0-9_]+$/.test(t) && !unit) unit = t.toLowerCase();
    }
    // (「ruby の試験」 — the job word after the unit's place; the sentence's own 試験 / テスト anywhere)
    if (!job) { const w = s.match(/試験|テスト|シム|仕上げ/); if (w) job = UNIT_JOB_WORDS[w[0]]; }
    got.push(`${workflow}${job ? ` の ${job}` : ''}${unit ? `（${unit}）` : ''}`);
    if (!unit) return none(`どのユニットですか（unit test <名前>${opts.units?.length ? `: ${opts.units.slice(0, 8).join('・')}` : ''}）`);
    if (opts.units?.length && !opts.units.map((u) => String(u).toLowerCase()).includes(unit)) return none(`「${unit}」というユニットはありません（${opts.units.slice(0, 8).join('・')}）`);
    if (!/^[a-z0-9_]{1,64}$/.test(unit)) return none(`「${unit}」はユニットの名前になりません（英小文字・数字・_）`);
    if (!job) return none(`ユニット ${unit} で何をしますか（test・sim・go のどれか）`);
    inputs = { job, unit };
  } else {
    const named = s.match(/(?<![A-Za-z0-9_.-])([A-Za-z0-9][\w.-]*\.ya?ml)(?![A-Za-z0-9_-])/i);
    let hits = wfs.filter((w) => word(w.base).test(s) || (ALIASES[w.base] ?? []).some((a) => s.includes(a)));
    if (named && !hits.some((w) => w.file.toLowerCase() === named[1].toLowerCase())) hits = wfs.length ? [] : [{ file: named[1], base: named[1].replace(/\.ya?ml$/, '').toLowerCase(), active: true }];
    if (named && !hits.length) return none(`${named[1]} というワークフローはありません${wfs.length ? `（${wfs.filter((w) => w.active && w.file !== S.SCHEDULER).map((w) => w.base).slice(0, 10).join('・')}）` : ''}`);
    // (the longest name when one is in another: ai-make before make)
    hits = hits.filter((w) => !hits.some((o) => o !== w && o.base.length > w.base.length && o.base.includes(w.base)));
    if (hits.length > 1) return none(`どれですか: ${hits.map((w) => w.file).join('・')}（1 つずつ予約します）`);
    if (!hits.length) return none(`何を予約しますか（ワークフローの名前: ${wfs.filter((w) => w.active && w.file !== S.SCHEDULER).map((w) => w.base).slice(0, 10).join('・') || '例 verify'}）`);
    const w = hits[0];
    workflow = w.file;
    for (const re of [word(w.base), ...(ALIASES[w.base] ?? []).map((a) => new RegExp(esc(a)))]) s = s.replace(re, ' ');
    got.push(workflow);
    if (workflow === S.SCHEDULER) return none(`${S.SCHEDULER} は予約できません（予約を始めるワークフロー自身です）`);
    if (!w.active) return none(`${workflow} は止まっています（GitHub の Actions で有効にしてから）`);
    if (S.AI_WORKFLOWS.includes(workflow)) {
      if (!request) return none(`${workflow} に何を作ってもらいますか（「…」の中に書いてください）`);
      inputs = { request };
    }
  }

  // ---- how often ----
  if (/毎月|毎年|\d+\s*(?:日|週間?|か月|ヶ月|カ月)\s*(?:ごと|おき|置き|毎)|隔週/.test(s)) return none('予約は 毎時・何時間かごと・毎日・毎週 だけです（毎月・何日ごとはできません）');
  if (/\d+\s*分\s*(?:ごと|おき|置き|毎)/.test(s)) return none('予約は 1 時間に 1 回までです（何時間ごとにしますか: 1 2 3 4 6 8 12）');
  let hours = null;
  const hm = s.match(/(\d+)\s*時間\s*(?:ごと|おき|置き|毎|に\s*1\s*回)|毎時(?:間)?|1\s*時間に\s*1\s*回/);
  if (hm) { hours = hm[1] ? Number(hm[1]) : 1; s = s.replace(hm[0], ' '); }
  if (hours !== null && !S.HOUR_STEPS.includes(hours)) return none(`${hours} 時間ごとはできません（1 日を割り切る数: ${S.HOUR_STEPS.join(' ')}。どれにしますか）`);
  const days = new Set();
  let kind = null;
  if (/平日/.test(s)) { kind = '平日'; [1, 2, 3, 4, 5].forEach((d) => days.add(d)); s = s.replace(/平日/g, ' '); }
  if (/週末|土日(?!曜)/.test(s)) { kind = kind ? 'mix' : '週末'; [6, 0].forEach((d) => days.add(d)); s = s.replace(/週末|土日(?!曜)/g, ' '); }
  for (const m of s.matchAll(/((?:[日月火水木金土][・、,と\s]*)+)曜/g)) for (const c of m[1].match(/[日月火水木金土]/g)) days.add(WD.indexOf(c));
  if (/毎週|週に?\s*1\s*回/.test(s) && !days.size) return none('毎週 何曜日ですか（例: 毎週月曜）');
  const daily = /毎日(?!曜)|毎朝|毎晩|毎夜|毎夕|日に\s*1\s*回/.test(s);
  if (daily && days.size) return none('毎日 と 曜日 の両方があります（どちらにしますか）');
  if (hours !== null && (daily || days.size)) return none('何時間ごと と 毎日・曜日 は一緒にできません（何時間ごとは毎日続きます）');

  // ---- what time ----
  const PART = '午前|午後|朝|昼|夕方|夜中|深夜|夜|晩';
  const tm = [...s.matchAll(new RegExp(`(?:(${PART}|am|pm)\\s*(?:の\\s*)?)?(?<!\\d)(\\d{1,2})\\s*(?:時\\s*(?:(半)|(\\d{1,2})\\s*分)?|:\\s*(\\d{2}))\\s*(am|pm)?`, 'gi'))];
  // (毎朝 / 毎晩 say the part of the day when the time does not)
  const dayPart = s.match(/毎(朝|晩|夜|夕)/)?.[1];
  if (tm.length > 1) return none(`時刻が ${tm.length} つあります（1 つずつ予約します）`);
  let at = null;
  if (tm.length) {
    const [all, p1, hh, half, mm1, mm2, p2] = tm[0];
    const part = (p1 ?? p2 ?? (dayPart === '夕' ? '夕方' : dayPart) ?? '').toLowerCase() || null;
    const h = hourOf(part, Number(hh)), mi = half ? 30 : Number(mm1 ?? mm2 ?? 0);
    if (h === null || mi > 59) return none(`「${all.trim()}」は何時ですか（0〜23 時か、午前・午後をつけて）`);
    if (mi !== 0) return none(`予約は 1 時間に 1 回なので、分は 00 だけです（${pad(h)}:00 か ${pad((h + 1) % 24)}:00 のどちらにしますか）`);
    at = `${pad(h)}:00`;
  } else if (new RegExp(`${PART}`).test(s) && hours === null) return none('何時ですか（例: 朝 9 時・夜 10 時）');

  // ---- the jobs ----
  let every;
  if (hours !== null) {
    every = 'hour';
    if (at && Number(at.slice(0, 2)) % hours !== 0) return none(`${hours} 時間ごとは 0 時から数えます（${Array.from({ length: Math.min(24 / hours, 6) }, (_, i) => i * hours).join('・')} 時…）。${at} からにはできません`);
  } else if (days.size) every = 'week';
  else if (daily) every = 'day';
  else {
    if (at) got.push(`${at}（${tz}）`);
    return none('毎日ですか、毎週ですか（例: 毎日・平日・毎週月曜・3 時間ごと）');
  }
  const order = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const when = every === 'hour' ? S.describe({ every, hours, timezone: tz })
    : every === 'day' ? `毎日${at ? ` ${at}` : ''}（${tz}）`
      : `${kind === '平日' && order.length === 5 ? '平日（月〜金）' : kind === '週末' && order.length === 2 ? '週末（土・日）' : `毎週${order.map((d) => WD[d]).join('・')}曜 `}${at ?? ''}（${tz}）`;
  got.unshift(when);
  if (every !== 'hour' && !at) return none('何時ですか（例: 朝 9 時・夜 10 時・21 時）');
  const ids = [...(opts.ids ?? [])], note = raw.slice(0, 200);
  const jobs = [];
  for (const wd of every === 'week' ? order : [null]) {
    const id = S.newId(workflow, ids);
    ids.push(id);
    const c = S.checkJob({ id, workflow, inputs, every, ...(every === 'hour' ? { hours } : { at }), ...(wd !== null ? { weekday: wd } : {}), timezone: tz, enabled: true, ...(note ? { note } : {}) });
    if (!c.job) return none(c.errors.join(' / '));
    jobs.push(c.job);
  }
  const what = `${workflow}${Object.keys(inputs).length ? `（${Object.entries(inputs).map(([k, v]) => `${k}=${v.length > 40 ? `${v.slice(0, 40)}…` : v}`).join(' ')}）` : ''}`;
  return { job: jobs[0], jobs, said: `${when}に ${what}${jobs.length > 1 ? `（予約 ${jobs.length} 件）` : ''}`, ask: null };
}
