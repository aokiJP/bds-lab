// weekly: the lab's week in one message for Discord — how many runs started in the last 7 days and how they ended, the share
// that passed (and last week's), the minutes they spent, the workflows that failed most, the releases that came out and the
// minutes each lender's host.yml spent. The same words in the panel (ui/weekly.mjs) and in the CLI (common/weekly.mjs, which
// imports this file). Pure: no DOM, no fetch, no node:. A run, a release are GitHub's own (lib/stats.mjs says which fields).
// The week is the 7 × 24 hours before `now` (not a calendar week): sent on any day, it says the same 7 days a reader expects.
import * as S from './stats.mjs';

/** the most a message holds: Discord takes 2000; notify.mjs cuts at 1900 with its own mark in front — so a little under that */
export const LIMIT = 1880;
export const WEEK_MS = 7 * 86_400_000;
/** how many of each list are named */
export const TOP = 3, MAX_RELEASES = 5, MAX_HOSTS = 10;

const only = (xs) => (Array.isArray(xs) ? xs.filter((x) => x && typeof x === 'object') : []);
const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));
const pct = (x) => `${Math.round(x * 100)}%`;
/** a word from GitHub (a workflow's, a release's, a repository's name) on one line of the message (pure): no control
 *  characters, spaces as one, never a mention — an @ is followed by a zero-width space, so "@everyone" in a release's title
 *  calls no one — and at most n letters */
export const word = (s, n = 80) => {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/@/g, '@​');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
// (an address in the message: GitHub's alone)
const ghUrl = (u) => (/^https:\/\/github\.com\/[^\s<>]*$/.test(String(u ?? '')) ? String(u) : '');
// (the counts of a list of runs)
const tally = (runs) => {
  const k = runs.map(S.kindOf), ok = k.filter((x) => x === 'ok').length, bad = k.filter((x) => x === 'bad').length;
  return { runs: runs.length, ok, bad, other: runs.length - ok - bad, rate: ok + bad ? ok / (ok + bad) : null };
};
// (the minutes a list of runs spent, as stats counts them)
const minutesOf = (runs) => S.minutesBy(runs, () => 'all')[0] ?? { minutes: 0, runs: 0 };

/** the lines, cut to fit `limit` letters joined (pure): whole lines from the end go first, and a last line says some were left
 *  out; a single line longer than the limit is cut */
export function fit(lines, limit = LIMIT) {
  const ls = (lines ?? []).map(String), len = (xs) => xs.join('\n').length;
  if (len(ls) <= limit) return ls;
  const more = '…（長いので、ここまで）', out = [...ls];
  while (out.length > 1 && len([...out, more]) > limit) out.pop();
  const kept = len([...out, more]) <= limit ? [...out, more] : out;
  return kept.length === 1 && kept[0].length > limit ? [`${kept[0].slice(0, limit - 1)}…`] : kept;
}

/** the week's report (pure). runs: the lab's runs (any number of weeks: only the last 7 days are counted, the 7 before them
 *  give last week's share); releases: the lab's releases; hosts: [{ slug, runs (host.yml's; null: not readable) }]; now: the
 *  end of the week (ms, a Date or a date string); tz: the calendar the two days are named in; slug: the lab's name, for the
 *  first line; partial: the runs given are not all (the newest so many): said.
 *  → { text (≤ LIMIT letters: Discord's 2000 and notify's 1900 both), lines (the same, one per line, before fitting),
 *  numbers: { from, to (ms), days: ['YYYY-MM-DD' first, last], runs, ok, bad, other, rate (null: none passed nor failed),
 *  prevRate, minutes, top: [{ name, path, bad, runs }], releases: [{ tag, name, url, at }] (newestFirst), hosts:
 *  [{ slug, minutes, runs, unread }] (the most minutes first), hostMinutes, partial } } */
export function report({ runs = [], releases = [], now = Date.now(), hosts = [], tz = 'UTC', slug = '', partial = false } = {}) {
  const to = Number.isFinite(toMs(now)) ? toMs(now) : Date.now(), from = to - WEEK_MS, prevFrom = from - WEEK_MS;
  const inRange = (a, b) => (r) => { const t = S.startMs(r); return Number.isFinite(t) && t > a && t <= b; };
  const all = only(runs), week = all.filter(inRange(from, to)), prev = all.filter(inRange(prevFrom, from));
  const n = tally(week), p = tally(prev), minutes = minutesOf(week).minutes;
  const top = S.byWorkflow(week).filter((x) => x.bad > 0).sort((a, b) => b.bad - a.bad || a.name.localeCompare(b.name)).slice(0, TOP)
    .map((x) => ({ name: x.name, path: x.path, bad: x.bad, runs: x.runs }));
  const rel = only(releases).filter((r) => !r.draft).map((r) => ({ r, at: Date.parse(r.published_at ?? r.created_at ?? '') }))
    .filter((x) => Number.isFinite(x.at) && x.at > from && x.at <= to).sort((a, b) => b.at - a.at)
    .map(({ r, at }) => ({ tag: String(r.tag_name ?? ''), name: String(r.name || r.tag_name || ''), url: ghUrl(r.html_url), at }));
  const hs = only(hosts).filter((x) => x.slug).map((x) => {
    const unread = !Array.isArray(x.runs), m = unread ? { minutes: 0, runs: 0 } : minutesOf(only(x.runs).filter(inRange(from, to)));
    return { slug: String(x.slug), minutes: m.minutes, runs: m.runs, unread };
  }).sort((a, b) => b.minutes - a.minutes || a.slug.localeCompare(b.slug));
  const day = (ms) => S.clock(ms, tz)?.day ?? new Date(ms).toISOString().slice(0, 10);
  const days = [day(from + 1), day(to)], hostMinutes = hs.reduce((a, x) => a + x.minutes, 0);
  const numbers = { from, to, days, ...n, prevRate: p.rate, minutes, top, releases: rel, hosts: hs, hostMinutes, partial: Boolean(partial) };

  const lines = [`📰 週報${slug ? `（${word(slug, 100)}）` : ''} ${days[0]}〜${days[1]}`];
  if (partial) lines.push(`（実行は新しい ${all.length} 件だけを読みました: 本当はもっと多いかもしれません）`);
  lines.push(n.runs ? `▶ 実行 ${n.runs} 回: ✅ 通った ${n.ok}・❌ 落ちた ${n.bad}・➖ そのほか ${n.other}` : '▶ この 7 日に始まった実行はありません');
  if (n.rate !== null) lines.push(`📊 通った割合 ${pct(n.rate)}${p.rate !== null ? `（先週 ${pct(p.rate)}）` : ''}`);
  else if (n.runs) lines.push('📊 通った割合: 通った・落ちたで終わった実行がまだありません');
  lines.push(`⏱ 使った分（見積もり）: ${minutes} 分`);
  if (top.length) { lines.push('❌ よく落ちたもの:'); top.forEach((x, i) => lines.push(`  ${i + 1}. ${word(x.name)} — ${x.bad} 回（${x.runs} 回のうち）`)); }
  else if (n.runs) lines.push('✅ 落ちた実行はありません');
  if (rel.length) {
    lines.push(`📦 新しいリリース ${rel.length} 件:`);
    for (const x of rel.slice(0, MAX_RELEASES)) lines.push(`  ・${word(x.name)}${x.name !== x.tag && x.tag ? `（${word(x.tag, 60)}）` : ''}${x.url ? ` ${x.url}` : ''}`);
    if (rel.length > MAX_RELEASES) lines.push(`  ・ほか ${rel.length - MAX_RELEASES} 件`);
  } else lines.push('📦 新しいリリースはありません');
  if (hs.length) {
    lines.push(`🤝 貸し手の分（見積もり）: 合わせて ${hostMinutes} 分`);
    for (const x of hs.slice(0, MAX_HOSTS)) lines.push(`  ・${word(x.slug, 100)}: ${x.unread ? '読めませんでした' : `${x.minutes} 分（${x.runs} 回）`}`);
    if (hs.length > MAX_HOSTS) lines.push(`  ・ほか ${hs.length - MAX_HOSTS} 人`);
  } else lines.push('🤝 貸し手の Actions は使っていません');
  return { text: fit(lines).join('\n'), lines, numbers };
}
