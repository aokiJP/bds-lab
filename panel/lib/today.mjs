// today (the 「概要」's top card): the things to do now, heaviest first, from what the page has read — runs that stayed failed,
// a schedule that does not start, secrets that stood long, invitations nobody answered, releases not told, lenders running
// short. Only what is to be done is listed. Pure: no DOM, no fetch, no node:. The words are plain; no action name or id is said.
import { kindOf, startMs, BAD } from './stats.mjs';
import { ageOf } from './secretwatch.mjs';

const DAY = 86_400_000;
/** days an invitation waits before it is worth a nudge / a release is "new enough to tell" / minutes a lender is short at */
export const WAIT_DAYS = 3, TELL_DAYS = 7, LOW_MINUTES = 60;
const flowOf = (r) => String(r?.path ?? '').split('@')[0] || String(r?.name ?? '') || '?';
const titleOf = (r) => String(r?.display_title ?? r?.name ?? '').replace(/\s+/g, ' ').slice(0, 60);
const days = (ms, now) => Math.max(0, Math.floor((now - ms) / DAY));
const arr = (x) => (Array.isArray(x) ? x : null);

/** facts (what the caller read; a part that is missing or not a list is simply not looked at):
 *  { now (ms), runs: [GitHub's runs], schedule: { broken?, errors?: [..], runs?: [the scheduler's runs] }, secrets: [{ name,
 *  updated_at }], invitations: [{ id, login, at }], releases: [{ tag_name, name, published_at }], told: [tag_name already
 *  told] (releases are judged only when this is a list), hosts: [{ slug, left (minutes) | null }] }
 *  → [{ id, say, tab, weight }], the heaviest first (pure) */
export function todo(facts = {}) {
  const f = facts ?? {}, now = Number.isFinite(f.now) ? f.now : Date.now(), out = [];
  // (a workflow whose newest finished run failed is still down: a later good run clears it)
  const runs = arr(f.runs);
  if (runs) {
    const last = new Map();
    for (const r of runs.filter((x) => x && typeof x === 'object' && x.status === 'completed' && x.conclusion !== 'cancelled' && x.conclusion !== 'skipped')) {
      const k = flowOf(r), p = last.get(k);
      if (!p || (startMs(r) || 0) > (startMs(p) || 0)) last.set(k, r);
    }
    for (const [k, r] of last) {
      if (kindOf(r) !== 'bad') continue;
      const d = days(startMs(r), now), name = titleOf(r) || k.split('/').pop();
      out.push({ id: `run:${k}`, say: `「${name}」が落ちたままです（${Number.isFinite(d) ? `${d} 日前` : 'いつからか不明'}）。理由を見て、直してやり直しましょう。`, tab: 'runs', weight: 90 + Math.min(d || 0, 9) });
    }
  }
  const s = f.schedule && typeof f.schedule === 'object' ? f.schedule : null;
  if (s) {
    const errs = arr(s.errors) ?? [];
    if (s.broken) out.push({ id: 'schedule:broken', say: '予約のファイルが読めないので、どの予約も始まっていません。直しましょう。', tab: 'schedule', weight: 85 });
    else if (errs.length) out.push({ id: 'schedule:errors', say: `予約の書き方に間違いが ${errs.length} 個あり、直すまで予約は始まりません。`, tab: 'schedule', weight: 85 });
    const sr = (arr(s.runs) ?? []).filter((r) => r?.status === 'completed').sort((a, b) => (startMs(b) || 0) - (startMs(a) || 0))[0];
    if (sr && BAD.includes(sr.conclusion)) out.push({ id: 'schedule:down', say: '予約を始める係（毎時の実行）が落ちています。予約が止まっているかもしれません。', tab: 'schedule', weight: 80 });
  }
  for (const x of ageOf(arr(f.secrets) ?? [], { now })) {
    if (x.level === 'ok') continue;
    out.push({ id: `secret:${x.name}`, say: `秘密「${x.name}」を ${x.days} 日、入れ替えていません。新しいものに替えましょう。`, tab: 'secrets', weight: x.level === 'stale' ? 60 : 40 });
  }
  for (const i of arr(f.invitations) ?? []) {
    const t = Date.parse(i?.at), d = Number.isFinite(t) ? days(t, now) : 0;
    if (d >= WAIT_DAYS) out.push({ id: `invite:${i.id ?? i.login}`, say: `${i.login ?? 'だれか'} さんへの招待に、${d} 日、返事がありません。声をかけましょう。`, tab: 'members', weight: 50 + Math.min(d, 9) });
  }
  const told = arr(f.told);
  if (told) {
    for (const r of arr(f.releases) ?? []) {
      const t = Date.parse(r?.published_at), tag = String(r?.tag_name ?? '');
      if (r?.draft || !tag || !Number.isFinite(t) || told.includes(tag) || now - t > TELL_DAYS * DAY) continue;
      out.push({ id: `release:${tag}`, say: `リリース「${String(r.name || tag).slice(0, 60)}」を、まだ Discord に知らせていません。`, tab: 'releases', weight: 30 });
    }
  }
  for (const hst of arr(f.hosts) ?? []) {
    if (Number.isFinite(hst?.left) && hst.left < LOW_MINUTES) out.push({ id: `host:${hst.slug}`, say: `貸し手 ${hst.slug} の今月の残りは ${hst.left} 分です。${hst.left === 0 ? 'もう借りられません。' : 'そろそろ足りなくなります。'}`, tab: 'hosts', weight: 20 + (hst.left === 0 ? 5 : 0) });
  }
  return out.sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1));
}
