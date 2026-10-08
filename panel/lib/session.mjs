// session: the panel's side of 「GitHub でサインイン」 (the service's side is auth/). The panel sends the person to the
// service's /login; GitHub asks them; the service sends them back with the tokens after the # of the panel's address — read
// here once, and the panel takes them out of the address at once — and the account keeps them (lib/accounts.mjs, kind
// 'oauth'). A GitHub App's user token runs out (8 hours) and is renewed through the service's /refresh with its refresh
// token; leaving revokes it on GitHub (/logout). The service's address comes from the panel's config at run time. No DOM,
// no storage: the panel hands in what it has (tests call these as they are). GitHub stays the gate: these tokens can do
// only what GitHub gives the person through the App.
const MAX = 8 * 1024;
const TOKEN = /^[\x21-\x7e]{1,2048}$/, LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const OURS = /^bdslab-(auth|auth-error|nonce)=/;
const b64url = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0));

/** what a sign-in's short word means for the person (pure) */
export function explainAuth(code) {
  const say = {
    denied: 'GitHub でのサインインが取り消されました',
    cookie: 'サインインを始めたブラウザ（タブ）とは別のところに戻りました。もう一度「GitHub でサインイン」から',
    expired: 'サインインに時間がかかりすぎました（10 分まで）。もう一度',
    nonce: 'このパネルが始めていないサインインの受け渡しは使いません。もう一度「GitHub でサインイン」から',
    state: 'サインインの受け渡しが壊れています。もう一度',
    broken: 'サインインの受け渡しが壊れています。もう一度',
    too_big: 'サインインの受け渡しが壊れています（大きすぎます）。もう一度',
    code: 'GitHub がサインインを受け付けませんでした。もう一度',
    exchange: 'GitHub がサインインを受け付けませんでした。もう一度',
    refresh: 'サインインの期限が切れました。もう一度サインインしてください',
    github: 'GitHub につながりません。しばらくしてから',
    unreachable: 'サインインのサービスにつながりません（アドレスと、パネルの CSP の connect-src を確かめてください）',
    config: 'サインインのサービスの設定が足りません（管理する人に: GITHUB_CLIENT_ID・GITHUB_CLIENT_SECRET・STATE_SECRET・PANEL_ORIGINS）',
    origin: 'このパネルのアドレスは、サインインのサービスに許されていません（PANEL_ORIGINS）',
    return: 'このパネルのアドレスは、サインインのサービスに許されていません（PANEL_ORIGINS）',
    body: 'サインインのサービスが頼みを受け付けませんでした',
  };
  return say[code] ?? `サインインできませんでした（${String(code ?? '').replace(/[^a-z_]/g, '').slice(0, 32) || '?'}）`;
}
const authError = (code) => Object.assign(new Error(explainAuth(code)), { code });

/** the service's address from the config → its origin, or null (pure): https, or http on this machine only; at the root */
export function authBase(authUrl) {
  let u; try { u = new URL(String(authUrl ?? '')); } catch { return null; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  return (u.protocol === 'https:' || (u.protocol === 'http:' && local)) && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password ? u.origin : null;
}
/** a fresh nonce for one sign-in: the panel keeps it in this tab and expects it back after the # */
export const newNonce = () => b64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
/** the service's /login for this panel (pure): returnTo = the panel's address (its own # kept, an old handoff dropped);
 *  select: GitHub's account picker (another account); login: the account to suggest; nonce: newNonce()'s, kept in this tab */
export function loginUrl(authUrl, { returnTo, select = false, login = null, nonce = null } = {}) {
  const base = authBase(authUrl);
  if (!base) throw authError('config');
  const s = String(returnTo ?? ''), i = s.indexOf('#'), page = i < 0 ? s : s.slice(0, i);
  const parts = (i < 0 ? '' : s.slice(i + 1)).split('&').filter((p) => p && !OURS.test(p));
  if (nonce && NONCE.test(nonce)) parts.push(`bdslab-nonce=${nonce}`);
  const q = new URLSearchParams({ return: parts.length ? `${page}#${parts.join('&')}` : page });
  if (select) q.set('select', '1');
  if (login && LOGIN.test(login)) q.set('login', login);
  return `${base}/login?${q}`;
}
/** GitHub's tokens as handed over → the same five fields, checked, or null (pure) */
export function cleanTokens(j) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e9 ? Math.floor(v) : null);
  if (!j || typeof j !== 'object' || !TOKEN.test(String(j.access_token ?? '')) || (j.token_type !== undefined && j.token_type !== null && !/^bearer$/i.test(String(j.token_type)))) return null;
  return { access_token: j.access_token, expires_in: num(j.expires_in), refresh_token: TOKEN.test(String(j.refresh_token ?? '')) ? j.refresh_token : null, refresh_token_expires_in: num(j.refresh_token_expires_in), token_type: 'bearer' };
}
/** the address's # → { tokens, rest } / { error, rest } / null when no handoff is in it (pure). rest: the # without ours
 *  (the panel's own route), '' when nothing is left. Broken, doubled or over 8 KB: an error. With { nonce } (the one this
 *  tab kept — null when it began none), a handoff without that very nonce is refused: a link made elsewhere signs nobody in */
export function takeHandoff(hash, opts = {}) {
  const s = String(hash ?? '').replace(/^#/, '');
  if (!/(^|&)bdslab-auth(-error)?=/.test(s)) return null;
  const parts = s.split('&'), of = (k) => parts.filter((p) => p.startsWith(`${k}=`)).map((p) => p.slice(k.length + 1));
  const kept = parts.filter((p) => p && !OURS.test(p)).join('&'), rest = kept ? `#${kept}` : '';
  if (s.length > MAX) return { error: 'too_big', rest };
  const got = of('bdslab-auth'), bad = of('bdslab-auth-error'), nonce = of('bdslab-nonce');
  if (got.length + bad.length !== 1 || nonce.length > 1) return { error: 'broken', rest };
  if ('nonce' in opts && !(typeof opts.nonce === 'string' && NONCE.test(opts.nonce) && nonce[0] === opts.nonce)) return { error: 'nonce', rest };
  if (bad.length) return { error: /^[a-z_]{1,32}$/.test(bad[0]) ? bad[0] : 'unknown', rest };
  if (!/^[A-Za-z0-9_-]+$/.test(got[0])) return { error: 'broken', rest };
  let j; try { j = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unb64url(got[0]))); } catch { return { error: 'broken', rest }; }
  const tokens = cleanTokens(j);
  return tokens ? { tokens, rest } : { error: 'broken', rest };
}
/** the handed tokens → what the account keeps (pure): { token, expiresAt, refresh, refreshExpiresAt } (ms; null: never) */
export const fromHandoff = (t, now = Date.now()) => ({ token: t.access_token, expiresAt: t.expires_in ? now + t.expires_in * 1000 : null, refresh: t.refresh_token ?? null, refreshExpiresAt: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : null });
/** time to renew (pure): the token runs out within skewMs, and the refresh token is still good */
export const needsRefresh = (s, now = Date.now(), skewMs = 5 * 60_000) => Boolean(s?.expiresAt && s.refresh && now >= s.expiresAt - skewMs && (!s.refreshExpiresAt || now < s.refreshExpiresAt));
/** the token has run out (pure): sign in again unless it can be renewed */
export const expired = (s, now = Date.now()) => Boolean(s?.expiresAt && now >= s.expiresAt);
/** away too long (pure): no use for `minutes` (0 or none: never) */
export const idleOut = (lastActiveMs, now = Date.now(), minutes = 0) => Number(minutes) > 0 && Number.isFinite(Number(lastActiveMs)) && now - Number(lastActiveMs) >= Number(minutes) * 60_000;

// (the panel's two calls to the service: JSON, no cookie, no Referer, nothing cached)
async function call(authUrl, path, body, fetchImpl) {
  const base = authBase(authUrl);
  if (!base) throw authError('config');
  let r; try { r = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); } catch { throw authError('unreachable'); }
  return r;
}
/** the refresh token → the renewed { token, expiresAt, refresh, refreshExpiresAt } (GitHub gives a new refresh token too);
 *  throws with the reason when it cannot (then: sign in again) */
export async function refresh(authUrl, refreshToken, fetchImpl = (...a) => globalThis.fetch(...a), now = Date.now()) {
  const r = await call(authUrl, '/refresh', { refresh_token: refreshToken }, fetchImpl);
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw authError(typeof j?.error === 'string' ? j.error : 'refresh');
  const t = cleanTokens(j);
  if (!t) throw authError('broken');
  return fromHandoff(t, now);
}
/** the token revoked on GitHub through the service → true when it is gone (never throws: the panel forgets it anyway) */
export async function logout(authUrl, token, fetchImpl = (...a) => globalThis.fetch(...a)) {
  try { const r = await call(authUrl, '/logout', { access_token: token }, fetchImpl); return r.status === 204; } catch { return false; }
}
