// inbox: what happened since the last look, kept as a list to read when someone comes back — a run that ended or failed,
// someone asking to join, a new lender, an invitation from a fork, a newer version of the page. The panel reads the lab now
// and then (snapshot), asks what is different from the look before (diff: nothing on the first look, and a part that could
// not be read is never taken for one that is empty) and keeps the news (store: in the browser's own storage, 200 at most, each
// piece once however often it is found). Nothing here is a secret: run names, branches, who asked. No DOM, no fetch, no node:;
// the storage is handed in (tests pass a plain object).
import { STATE_ICON } from './model.mjs';

export const INBOX_MAX = 200;
const FAILED = ['failure', 'timed_out', 'startup_failure'];
const LEVELS = ['ok', 'info', 'warn', 'bad'];
/** the kinds of news, in words (the chips of the list) */
export const KIND_WORDS = { run: '実行が終わった', failure: '失敗', join: '参加のお願い', fork: 'フォークで貸す', invite: 'フォークからの招待', version: '新しい版' };

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const https = (u) => (/^https:\/\//.test(String(u ?? '')) ? String(u).slice(0, 300) : '');
const iso = (t) => (Number.isFinite(Date.parse(t)) ? String(t) : '');
const repoOf = (url) => /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100})\/actions\/runs\//.exec(String(url ?? ''))?.[1] ?? null;

/** what the panel read of the lab now, kept small (pure) → { v: 1, at, runs, joins, forks, invitations, version }. Each part is
 *  a list of { id, … }, or null when it was not read. runs: GitHub's, newest first (the newest 100 kept); joins: model.joinRequests's;
 *  forks: the lab's lending forks (model.lendingForks's: { slug, owner, always }); invitations: GitHub's repository invitations
 *  (api.myInvitations(); only a fork's are kept — narrow them to the lab's own forks first, as 「いまやること」 does, to tell no
 *  others); version: debug.versionState's { state, say }. nowMs: when it was read */
export function snapshot({ runs = null, joins = null, forks = null, invitations = null, version = null } = {}, nowMs = Date.now()) {
  const list = (a, f) => (Array.isArray(a) ? a.filter(Boolean).map(f).filter((x) => x && x.id) : null);
  return {
    v: 1, at: new Date(nowMs).toISOString(),
    runs: list(Array.isArray(runs) ? runs.slice(0, 100) : runs, (r) => (r.id === undefined || r.id === null ? null : { id: String(r.id), name: clip(r.name ?? r.display_title, 80), status: String(r.status ?? ''), conclusion: r.conclusion ?? null, attempt: Number(r.run_attempt) || 1,
      branch: clip(r.head_branch, 80), actor: clip(r.triggering_actor?.login ?? r.actor?.login, 40), at: iso(r.updated_at ?? r.created_at), url: https(r.html_url), repo: repoOf(r.html_url) })),
    joins: list(joins, (j) => (j.number === undefined || j.number === null ? null : { id: String(j.number), login: clip(j.login, 40), body: clip(String(j.body ?? '').split('\n').find((l) => l.trim() && !l.trim().startsWith('—')), 120), at: iso(j.at), url: https(j.url) })),
    forks: list(forks, (f) => { const slug = f.slug ?? f.full_name; return slug ? { id: String(slug), owner: clip(typeof f.owner === 'string' ? f.owner : f.owner?.login ?? String(slug).split('/')[0], 40), always: Boolean(f.always?.ok ?? f.always) } : null; }),
    invitations: list(Array.isArray(invitations) ? invitations.filter((i) => i?.repository?.fork) : invitations, (i) => (i.id === undefined || i.id === null ? null : { id: String(i.id), repo: clip(i.repository?.full_name, 140), from: clip(i.inviter?.login, 40), at: iso(i.created_at), url: https(i.html_url) })),
    version: version && typeof version === 'object' ? { state: String(version.state ?? ''), say: clip(version.say, 300) } : null,
  };
}

/** what is new in `next` against `prev` — two snapshots, the look before and now (pure) → [{ id, kind, title, body, tab, at,
 *  level }] (kind: run · failure · join · fork · invite · version; level: ok · info · warn · bad; run events also carry run,
 *  repo and url, the others url when GitHub has a page for it). Nothing when there is no look before, or a part was not read
 *  on one side. A run is told when it ended after it was seen going, and a failure whenever it is new (also one nobody saw
 *  going); a pass nobody saw going is not told. A re-run is a new attempt: told again */
export function diff(prev, next) {
  if (prev?.v !== 1 || next?.v !== 1) return [];
  const out = [], both = (k) => Array.isArray(prev[k]) && Array.isArray(next[k]);
  if (both('runs')) {
    const was = new Map(prev.runs.map((r) => [r.id, r]));
    for (const r of next.runs) {
      if (r.status !== 'completed') continue;
      const p = was.get(r.id), bad = FAILED.includes(r.conclusion);
      if (p && p.status === 'completed' && p.attempt === r.attempt && p.conclusion === r.conclusion) continue;
      if (!bad && !(p && (p.status !== 'completed' || p.attempt !== r.attempt))) continue;
      const say = (bad ? { failure: '失敗しました', timed_out: '時間切れになりました', startup_failure: '始められませんでした' } : { success: '通りました', cancelled: '止まりました', skipped: '飛ばされました', action_required: '承認を待っています' })[r.conclusion] ?? '終わりました';
      out.push({ id: `run:${r.id}:${r.attempt}:${r.conclusion}`, kind: bad ? 'failure' : 'run', title: `${STATE_ICON[r.conclusion] ?? '•'} ${r.name || '実行'} が${say}`, body: [r.branch, r.actor].filter(Boolean).join(' · '), tab: 'runs', at: r.at || next.at,
        level: bad ? 'bad' : r.conclusion === 'success' ? 'ok' : r.conclusion === 'action_required' ? 'warn' : 'info', run: r.id, repo: r.repo ?? null, url: r.url });
    }
  }
  const fresh = (k) => { const had = new Set(prev[k].map((x) => x.id)); return next[k].filter((x) => !had.has(x.id)); };
  if (both('joins')) for (const j of fresh('joins')) out.push({ id: `join:${j.id}`, kind: 'join', title: `🙋 ${j.login || '?'} さんから参加のお願い`, body: j.body, tab: 'members', at: j.at || next.at, level: 'warn', url: j.url });
  if (both('forks')) for (const f of fresh('forks')) out.push({ id: `fork:${f.id}`, kind: 'fork', title: `⏱ ${f.owner || '?'} さんがフォークで貸し始めました`, body: `${f.id}${f.always ? '・いつも貸す' : ''}`, tab: 'hosts', at: next.at, level: 'info' });
  if (both('invitations')) for (const i of fresh('invitations')) out.push({ id: `invite:${i.id}`, kind: 'invite', title: `📨 ${i.repo || 'フォーク'} への招待が届きました`, body: `${i.from ? `${i.from} さんから: ` : ''}受けると、そのフォークを預かれます`, tab: 'hosts', at: i.at || next.at, level: 'warn', url: i.url });
  const v = next.version;
  if (v?.state === 'newer' && !(prev.version?.state === 'newer' && prev.version.say === v.say)) out.push({ id: `version:${/\b[0-9a-f]{7,40}\b/.exec(v.say)?.[0] ?? 'newer'}`, kind: 'version', title: '🆕 新しい版が出ています', body: v.say, tab: 'overview', at: next.at, level: 'info' });
  return out;
}

// (the people who want to know when the list changes: the bell and the list, however many times the store was made over the
// same storage and key)
const LISTENERS = new WeakMap();
const listeners = (storage, key) => { if (!LISTENERS.has(storage)) LISTENERS.set(storage, new Map()); const m = LISTENERS.get(storage); if (!m.has(key)) m.set(key, new Set()); return m.get(key); };
/** a piece of news as it is kept (pure): the fields cut to size, anything else dropped, an address only if https; null when it is not one */
function keep(x, nowMs) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || typeof x.title !== 'string') return null;
  const at = iso(x.at) || new Date(nowMs).toISOString();
  return { id: x.id.slice(0, 200), kind: String(x.kind ?? '').replace(/[^a-z]/g, '').slice(0, 20), title: clip(x.title, 200), body: clip(x.body, 300), tab: String(x.tab ?? '').replace(/[^a-z]/g, '').slice(0, 20), at,
    level: LEVELS.includes(x.level) ? x.level : 'info', run: x.run ? String(x.run).replace(/\D/g, '').slice(0, 20) || null : null, repo: x.repo ? clip(x.repo, 140) : null, url: https(x.url), read: Boolean(x.read) };
}
const newest = (a, b) => Date.parse(b.at) - Date.parse(a.at);

/** the news kept in `storage` under `key` (a localStorage; one that refuses is no trouble: nothing is kept) → { add, list, unread,
 *  markRead, clear, last, remember, onChange }. add(events): the new ones (an id already there is not added again; the newest
 *  `max` kept) → how many were new; list(): newest first; unread(): how many are not read; markRead(id | 'all') → how many
 *  changed; clear() → how many were removed; last(): the snapshot the look before kept (null: none), remember(snapshot) keeps one;
 *  onChange(fn) → a way to stop being told (told after add, markRead and clear changed something, by any store over this
 *  storage and key). The key is one per account and per lab (the page's: bdslab.panel.inbox.<login>.<lab>) — nobody is shown
 *  another person's news */
export function store(storage, key, { max = INBOX_MAX } = {}) {
  const SNAP = `${key}.snapshot`, subs = listeners(storage, key);
  const read = () => { try { const j = JSON.parse(storage.getItem(key) ?? 'null'); return Array.isArray(j?.items) ? j.items.map((x) => keep(x, 0)).filter(Boolean) : []; } catch { return []; } };
  const write = (items) => { try { storage.setItem(key, JSON.stringify({ v: 1, items })); } catch { /* storage full or refused */ } };
  const tell = () => { for (const fn of [...subs]) { try { fn(); } catch { /* a view's trouble is not the store's */ } } };
  return {
    add(events, nowMs = Date.now()) {
      const items = read(), have = new Set(items.map((x) => x.id)), fresh = [];
      for (const e of [events].flat()) { const k = keep(e, nowMs); if (k && !have.has(k.id)) { have.add(k.id); fresh.push({ ...k, read: false }); } }
      if (!fresh.length) return 0;
      const all = [...fresh, ...items].sort(newest).slice(0, max), kept = new Set(all.map((x) => x.id)), n = fresh.filter((x) => kept.has(x.id)).length;
      write(all);
      if (n) tell();
      return n;
    },
    list: () => read().sort(newest),
    unread: () => read().filter((x) => !x.read).length,
    markRead(id) {
      const items = read(), todo = items.filter((x) => !x.read && (id === 'all' || x.id === id));
      if (!todo.length) return 0;
      for (const x of todo) x.read = true;
      write(items); tell();
      return todo.length;
    },
    clear() { const n = read().length; if (!n) return 0; try { storage.removeItem(key); } catch { /* refused */ } tell(); return n; },
    last() { try { const j = JSON.parse(storage.getItem(SNAP) ?? 'null'); return j?.v === 1 && ['runs', 'joins', 'forks', 'invitations'].every((k) => j[k] === null || Array.isArray(j[k])) ? j : null; } catch { return null; } },
    remember(snap) { try { if (snap?.v === 1) storage.setItem(SNAP, JSON.stringify(snap)); else storage.removeItem(SNAP); } catch { /* storage full or refused */ } },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
