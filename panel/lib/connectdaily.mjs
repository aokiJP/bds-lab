// connectdaily (the 「🔗 連携」's daily check, the pure part): connect.yml checks every day the services whose secrets are there
// (common/connect-daily.mjs) and leaves one notice `connect-daily` — one line of JSON: { ok, at, checked, bad, services: { key:
// { ok, verified?, problem?, next? } } }, names and words only, never a value. Here: that notice read for the screen, which of
// connect.yml's runs to look in (the scheduled ones first), and how old the last check is. Nothing here touches the network:
// readDaily asks GitHub through the api handed in (lib/gh.mjs).
import { runNotice } from './setup.mjs';
import * as C from './connect.mjs';

export const WORKFLOW = 'connect.yml';
export const TITLE = 'connect-daily';
/** a check older than this (ms) means the daily one has stopped (a day and a half: one missed day is not yet said) */
export const STALE_MS = 36 * 3600_000;
/** how many of connect.yml's newest finished runs are looked in for the notice */
export const LOOK = 3;
const line = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, 200) : '');

/** the notice's message → { ok, at (ms), services: [{ key, name, ok, text, next }], bad: [names] } or null when it is not one
 *  (pure). Only the services connect.mjs knows are kept; each one's words through connect.mjs parseResult (the same words as
 *  the tab's own check) */
export function parseDaily(msg) {
  let j = null; try { j = JSON.parse(String(msg ?? '')); } catch { /* not JSON */ }
  if (!j || typeof j !== 'object' || typeof j.ok !== 'boolean' || !j.services || typeof j.services !== 'object') return null;
  const at = Date.parse(String(j.at ?? ''));
  const services = C.SERVICES.filter((s) => j.services[s.key] && typeof j.services[s.key] === 'object' && typeof j.services[s.key].ok === 'boolean').map((s) => {
    const r = j.services[s.key], p = C.parseResult(JSON.stringify({ ok: r.ok, verified: r.verified, problem: line(r.problem) || undefined }));
    return { key: s.key, name: s.name, ok: r.ok, text: p.text, next: line(r.next) || null };
  });
  return { ok: j.ok && services.every((s) => s.ok), at: Number.isFinite(at) ? at : null, services, bad: services.filter((s) => !s.ok).map((s) => s.name) };
}

/** connect.yml's runs → the finished ones to look in, newest first, the scheduled ones (the daily check) before the others (pure) */
export function candidates(runs, n = LOOK) {
  const done = (Array.isArray(runs) ? runs : []).filter((r) => r && r.status === 'completed' && r.id !== undefined && r.id !== null);
  const t = (r) => Date.parse(r.run_started_at ?? r.created_at ?? '') || 0;
  return done.sort((a, b) => (b.event === 'schedule') - (a.event === 'schedule') || t(b) - t(a)).slice(0, n);
}

/** how old a check is in words (pure): 「今日」「きのう」「N 日前」; stale when older than STALE_MS */
export function age(at, now = Date.now()) {
  if (!Number.isFinite(at)) return { words: 'いつか分かりません', stale: true };
  const ms = Math.max(0, now - at), d = Math.floor(ms / 86400_000), hrs = Math.floor(ms / 3600_000);
  return { words: hrs < 1 ? 'さっき' : d < 1 ? `${hrs} 時間前` : d === 1 ? 'きのう' : `${d} 日前`, stale: ms > STALE_MS };
}

/** what the card says (pure) → { tone: 'ok' | 'bad' | 'stale' | 'none', head, lines: [{ ok, name, text, next }], when, url }.
 *  found: readDaily's answer (null: no daily check yet) */
export function view(found, now = Date.now()) {
  if (!found) return { tone: 'none', head: 'まだ毎日の確かめの結果がありません（connect.yml が 1 日 1 回、入っている連携を確かめます）', lines: [], when: null, url: null };
  const d = found.daily, a = age(d.at, now), url = /^https:\/\/github\.com\//.test(String(found.run?.html_url ?? '')) ? found.run.html_url : null;
  const lines = d.services.map((s) => ({ ok: s.ok, name: s.name, text: s.text, next: s.next }));
  const head = !d.services.length ? '連携の秘密はまだ 1 つも入っていません（入れると、毎日ここで確かめます）'
    : d.bad.length ? `${d.bad.join('・')} がつながらなくなっています` : 'ぜんぶ、つながっています';
  const tone = d.bad.length ? 'bad' : a.stale ? 'stale' : 'ok';
  return { tone, head: a.stale ? `${head}（ただし最後の確かめは ${a.words}: 毎日の確かめが止まっているかもしれません）` : head, lines, when: a.words, url };
}

/** the newest daily check: connect.yml's newest finished runs (candidates) looked in for the notice `connect-daily` →
 *  { run, daily } or null when none has one. api: lib/gh.mjs (runs, jobs, annotations) — reading only */
export async function readDaily(api, slug) {
  for (const run of candidates(await api.runs(slug, { workflow: WORKFLOW, per: 20 }))) {
    const daily = parseDaily(await runNotice(api, slug, run.id, TITLE));
    if (daily) return { run, daily };
  }
  return null;
}
