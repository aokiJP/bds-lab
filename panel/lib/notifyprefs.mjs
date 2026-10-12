// notifyprefs: who wants to hear what (a run failed or passed, a release, the weekly report, a connection that is not well,
// a secret that is old), member by member. Kept in the lab's default branch (.github/bds-lab-notify.json), so the CLI side
// (common/notify.mjs) can read the same file and mention the people who asked, in Discord. Pure: no DOM, no fetch.
//
//   { "version": 1, "members": { "alice": { "kinds": ["failed", "release"], "discord": "123456789012345678" } } }
//
// A member who is not in the file hears the DEFAULT_KINDS. "discord" is the member's Discord user id (digits), only to mention
// them; it is not a secret, but nothing else is kept (no token, no address).

export const NOTIFY_FILE = '.github/bds-lab-notify.json';
export const KINDS = ['failed', 'passed', 'release', 'weekly', 'connect', 'secrets'];
export const KIND_WORDS = { failed: '落ちたとき', passed: '通ったとき', release: 'リリースが出たとき', weekly: '週報', connect: '連携の調子が悪いとき', secrets: '秘密が古くなったとき' };
export const DEFAULT_KINDS = Object.freeze(['failed', 'release', 'connect']);
export const MAX_MEMBERS = 200, MAX_BYTES = 200_000;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, DISCORD_ID = /^\d{15,25}$/;

export const defaultPrefs = () => ({ version: 1, members: {} });
const bad = (m) => Object.assign(new Error(m), { prefs: true });
const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** the file's text (or an object) → prefs; refused in words when it is not JSON or not the right shape. Empty text = default. */
export function parsePrefs(json) {
  let j = json;
  if (typeof json === 'string') {
    if (json.length > MAX_BYTES) throw bad('通知の設定が大きすぎます');
    if (!json.trim()) return defaultPrefs();
    try { j = JSON.parse(json); } catch { throw bad(`${NOTIFY_FILE} が JSON として読めません（かっこやカンマを見直してください）`); }
  }
  if (!plain(j)) throw bad('通知の設定は { "version": 1, "members": {…} } の形で書いてください');
  for (const k of Object.keys(j)) if (k !== 'version' && k !== 'members') throw bad(`知らない項目 "${k}" があります（version と members だけです）`);
  if (j.version !== undefined && j.version !== 1) throw bad('version は 1 です');
  const m = j.members ?? {};
  if (!plain(m)) throw bad('members は { "ユーザー名": {…} } の形です');
  const names = Object.keys(m);
  if (names.length > MAX_MEMBERS) throw bad(`人が多すぎます（${MAX_MEMBERS} 人まで）`);
  const out = {};
  for (const login of names) {
    const v = m[login];
    if (!LOGIN.test(login)) throw bad(`ユーザー名 "${login.slice(0, 40)}" が正しくありません`);
    if (!plain(v)) throw bad(`${login}: { "kinds": […] } の形で書いてください`);
    for (const k of Object.keys(v)) if (k !== 'kinds' && k !== 'discord') throw bad(`${login}: 知らない項目 "${k}" があります（kinds と discord だけです）`);
    if (!Array.isArray(v.kinds)) throw bad(`${login}: kinds は ${KINDS.join(' ')} の並びです`);
    for (const k of v.kinds) if (!KINDS.includes(k)) throw bad(`${login}: "${String(k).slice(0, 30)}" は知らない種類です（${KINDS.join(' ')}）`);
    if (v.discord !== undefined && !DISCORD_ID.test(String(v.discord))) throw bad(`${login}: discord は Discord のユーザー ID（数字 15〜25 桁）です`);
    out[login] = { kinds: KINDS.filter((k) => v.kinds.includes(k)), ...(v.discord !== undefined ? { discord: String(v.discord) } : {}) };
  }
  return { version: 1, members: out };
}

const find = (prefs, login) => { const l = String(login ?? '').toLowerCase(); const k = Object.keys(prefs?.members ?? {}).find((x) => x.toLowerCase() === l); return k === undefined ? null : k; };

/** the kinds a member hears: what they chose, or the defaults when they never did */
export const kindsOf = (prefs, login) => { const k = find(prefs, login); return k === null ? [...DEFAULT_KINDS] : [...prefs.members[k].kinds]; };
/** does this member want this kind? */
export const wants = (prefs, login, kind) => KINDS.includes(kind) && kindsOf(prefs, login).includes(kind);

/** prefs with one switch changed (a new object; the old one is untouched). A discord id is kept when given: null removes it. */
export function setPref(prefs, login, kind, on, discord) {
  if (!LOGIN.test(String(login ?? ''))) throw bad(`ユーザー名 "${String(login ?? '').slice(0, 40)}" が正しくありません`);
  if (kind !== null && !KINDS.includes(kind)) throw bad(`"${String(kind).slice(0, 30)}" は知らない種類です`);
  const base = prefs ?? defaultPrefs(), key = find(base, login) ?? login, cur = base.members[key];
  const set = new Set(kindsOf(base, login));
  if (kind !== null) { if (on) set.add(kind); else set.delete(kind); }
  const e = { kinds: KINDS.filter((k) => set.has(k)) };
  let d = cur?.discord;
  if (discord === null) d = undefined; else if (discord !== undefined) { if (!DISCORD_ID.test(String(discord))) throw bad('discord は Discord のユーザー ID（数字 15〜25 桁）です'); d = String(discord); }
  if (d !== undefined) e.discord = d;
  if (!cur && Object.keys(base.members).length >= MAX_MEMBERS) throw bad(`人が多すぎます（${MAX_MEMBERS} 人まで）`);
  return { version: 1, members: { ...base.members, [key]: e } };
}

/** the Discord mentions for a kind: ["<@id>", …], the people who want it and gave their id, each once, in the file's order */
export function mentions(prefs, kind) {
  if (!KINDS.includes(kind)) return [];
  const out = [];
  for (const [login, v] of Object.entries(prefs?.members ?? {})) if (v.discord && v.kinds.includes(kind) && DISCORD_ID.test(String(v.discord))) out.push(`<@${v.discord}>`);
  return [...new Set(out)];
}

/** prefs → the file's text (stable order, a final newline) */
export const prefsText = (prefs) => `${JSON.stringify({ version: 1, members: Object.fromEntries(Object.entries(prefs.members).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`;
