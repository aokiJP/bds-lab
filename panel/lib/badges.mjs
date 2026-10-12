// badges: the lab's small prizes — the first addon, the first release, ten tests passed in a row, the first lend, four weekly
// reports… — worked out from what the lab already has (its units, runs, releases and lenders), and which of them this
// browser has not seen yet (`fresh`). Pure: no DOM, no fetch, no node:. A run, a release are GitHub's own (lib/stats.mjs says
// which fields). Only the newest runs the panel reads are counted, so a prize can come late, never early.
import * as S from './stats.mjs';

const only = (xs) => (Array.isArray(xs) ? xs.filter((x) => x && typeof x === 'object') : []);
const fileOf = (r) => String(r?.path ?? '').split('/').pop();
/** the workflows whose runs are the lab's tests (verify.yml, unit.yml) */
const isTest = (r) => /^(verify|unit|test[\w-]*)\.yml$/.test(fileOf(r));
/** the runs that came out, oldest first, with their start (ms) */
const timed = (runs) => only(runs).map((r) => ({ r, at: S.startMs(r) })).filter((x) => Number.isFinite(x.at)).sort((a, b) => a.at - b.at);
const when = (r) => Date.parse(r?.published_at ?? r?.created_at ?? '');

/** how many tests in a row must pass, and how many weekly reports must go out */
export const STREAK = 10, WEEKLIES = 4;

/** the longest row of passes (pure): runs that ended passed or failed only count, oldest first; a failure ends the row.
 *  → { best, at (ms the row reached `need`; null: never) } */
export function streak(runs, need = STREAK) {
  let n = 0, best = 0, at = null;
  for (const { r, at: t } of timed(runs).filter(({ r: x }) => isTest(x))) {
    const k = S.kindOf(r);
    if (k === 'other') continue;
    n = k === 'ok' ? n + 1 : 0;
    best = Math.max(best, n);
    if (n >= need && at === null) at = t;
  }
  return { best, at };
}

/** every badge: { id, name, icon, text (what earns it, in easy words), test(data) → false | { at (ms or null: no date known) } } */
export const BADGES = [
  { id: 'first-addon', icon: '🧱', name: '初めてのアドオン', text: 'アドオンが 1 つできました。',
    test: ({ units }) => (only(units).some((u) => (u.kind ?? 'bds') === 'bds') ? { at: null } : false) },
  { id: 'five-addons', icon: '🏘', name: 'アドオン 5 つ', text: 'アドオンが 5 つになりました。',
    test: ({ units }) => (only(units).filter((u) => (u.kind ?? 'bds') === 'bds').length >= 5 ? { at: null } : false) },
  { id: 'first-release', icon: '📦', name: '初めてのリリース', text: '最初のリリースを出しました。',
    test: ({ releases }) => {
      const ats = only(releases).filter((r) => !r.draft).map(when);
      if (!ats.length) return false;
      const known = ats.filter(Number.isFinite);
      return { at: known.length ? Math.min(...known) : null };
    } },
  { id: 'green-ten', icon: '✅', name: `試験が ${STREAK} 回続けて通った`, text: `試験が落ちずに ${STREAK} 回続けて通りました。`,
    test: ({ runs }) => { const s = streak(runs); return s.at === null ? false : { at: s.at }; } },
  { id: 'first-lend', icon: '🤝', name: '初めての貸し借り', text: '貸し手とつながりました。',
    test: ({ hosts }) => (only(hosts).some((x) => x.slug && !x.error) ? { at: null } : false) },
  { id: 'weekly-four', icon: '📰', name: `週報を ${WEEKLIES} 回`, text: `週報を ${WEEKLIES} 回送りました。`,
    test: ({ runs }) => {
      const ok = timed(runs).filter(({ r }) => fileOf(r) === 'notify.yml' && S.kindOf(r) === 'ok');
      return ok.length >= WEEKLIES ? { at: ok[WEEKLIES - 1].at } : false;
    } },
  { id: 'hundred-runs', icon: '🏃', name: '実行 100 回', text: 'ラボの実行が 100 回を超えました。',
    test: ({ runs }) => { const t = timed(runs); return t.length >= 100 ? { at: t[99].at } : false; } },
];

/** the badges this lab has earned (pure) → [{ id, at (ms; null: the day is not known) }] in BADGES' order */
export function earned({ units = [], runs = [], releases = [], hosts = [], now = Date.now() } = {}) {
  const data = { units, runs, releases, hosts, now }, out = [];
  for (const b of BADGES) { const r = b.test(data); if (r) out.push({ id: b.id, at: Number.isFinite(r.at) ? r.at : null }); }
  return out;
}
/** the earned ones this browser has not seen (pure): `seen` is the list of ids kept */
export const fresh = (got, seen) => { const s = new Set(Array.isArray(seen) ? seen : []); return only(got).filter((x) => !s.has(x.id)); };
/** the badge of an id (pure) */
export const byId = (id) => BADGES.find((b) => b.id === id) ?? null;
