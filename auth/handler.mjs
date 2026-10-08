// auth: the panel's small sign-in service — GitHub's OAuth web flow for the lab's GitHub App, done where the App's client
// secret can live (a Cloudflare Worker: worker.mjs; or your own server behind TLS: node.mjs), and nothing more. It keeps no
// store: a sign-in's state rides in one signed value (the `state` GitHub carries back, and the same value in an HttpOnly
// cookie of this origin), and the tokens are handed to the panel once, after the # of its address (never in a query: the #
// reaches no server, no log, no Referer). The panel then talks to GitHub itself with the person's own user token: what it may
// see and do is what GitHub gives that person through the App installed on the lab's repositories — this service adds no
// power and holds no token. Runs as it is on Node 22, in a browser and on Workers: fetch, Request, Response, URL,
// crypto.subtle, TextEncoder (and btoa/atob) only.
//   GET /health                          → { ok, clientId, origins, version } (CORS to the panel's origins)
//   GET /login?return=<panel>&select=1&login=<name>   → 302 to GitHub (the state signed, in the cookie and the URL)
//   GET /callback?code&state             → 302 to <panel>#bdslab-auth=<base64url(JSON tokens)> (or #bdslab-auth-error=<word>)
//   POST /refresh {refresh_token}        → the renewed tokens (from the panel's origins only)
//   POST /logout {access_token}          → 204 (the token revoked on GitHub; from the panel's origins only)
export const VERSION = '1';
/** what only the real GitHub can confirm (kept in this one place; the tests use a fake GitHub) */
export const GITHUB = {
  // (GitHub's OAuth web flow takes PKCE: code_challenge S256 at /authorize, code_verifier at /access_token — 要実測)
  pkce: true,
  // (prompt=select_account: GitHub shows its account picker, for a second account in one browser — 要実測)
  selectAccount: 'select_account',
  authorize: '/login/oauth/authorize',
  token: '/login/oauth/access_token',
  revoke: (clientId) => `/applications/${encodeURIComponent(clientId)}/token`,
  apiVersion: '2022-11-28',
};
const COOKIE = '__Host-bdslab_state', TTL = 600_000, UA = `bds-lab-auth/${VERSION}`;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, TOKEN = /^[\x21-\x7e]{1,2048}$/;
/** on every answer: nothing cached, no Referer, no sniffing, nothing framed or loaded */
export const HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" };
const enc = new TextEncoder(), dec = new TextDecoder();
const b64url = (bytes) => { const b = new Uint8Array(bytes); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0));
const reply = (status, body, extra = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...HEADERS, ...(body === null ? {} : { 'content-type': 'application/json; charset=utf-8' }), ...extra } });

/** a panel's origin as written in PANEL_ORIGINS → the origin, or null (pure): https, or http on this machine only */
function originOf(s) {
  let u; try { u = new URL(s); } catch { return null; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  return (u.protocol === 'https:' || (u.protocol === 'http:' && local)) && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password ? u.origin : null;
}
/** env → the service's settings (pure): what is missing is named (never a value) */
export function config(env = {}) {
  const base = (v, d) => String(v ?? '').trim().replace(/\/+$/, '') || d;
  const origins = [...new Set(String(env.PANEL_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(originOf).filter(Boolean))];
  const c = { clientId: String(env.GITHUB_CLIENT_ID ?? '').trim(), secret: String(env.GITHUB_CLIENT_SECRET ?? '').trim(), stateSecret: String(env.STATE_SECRET ?? ''), origins, web: base(env.GITHUB_WEB, 'https://github.com'), api: base(env.GITHUB_API, 'https://api.github.com') };
  c.missing = [!c.clientId && 'GITHUB_CLIENT_ID', !c.secret && 'GITHUB_CLIENT_SECRET', c.stateSecret.length < 32 && 'STATE_SECRET', !origins.length && 'PANEL_ORIGINS'].filter(Boolean);
  return c;
}
/** GitHub's token answer → the tokens the panel is handed, or null (pure): only these five fields, each checked */
export function tokensOf(j) {
  const num = (v) => { const n = typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e9 ? Math.floor(n) : null; };
  if (!j || typeof j !== 'object' || !TOKEN.test(String(j.access_token ?? '')) || (j.token_type !== undefined && !/^bearer$/i.test(String(j.token_type)))) return null;
  return { access_token: j.access_token, expires_in: num(j.expires_in), refresh_token: TOKEN.test(String(j.refresh_token ?? '')) ? j.refresh_token : null, refresh_token_expires_in: num(j.refresh_token_expires_in), token_type: 'bearer' };
}

/** env → async (Request) → Response. fetchImpl reaches GitHub (a fake in tests); now is the clock (tests move it) */
export function handler(env, { fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now() } = {}) {
  const c = config(env ?? {}), subtle = () => globalThis.crypto.subtle;
  let keyP = null;
  const key = () => (keyP ??= subtle().importKey('raw', enc.encode(c.stateSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  // (one key, each use its own label: a state's signature is never a PKCE verifier)
  const mac = async (label, data) => subtle().sign('HMAC', await key(), enc.encode(`${label}\n${data}`));
  // (the PKCE verifier is written nowhere — not in the state GitHub's address carries, not in the cookie: it is made again
  //  from the state's nonce with the secret, so a code seen on the way cannot be redeemed with what travelled beside it)
  const verifierOf = async (nonce) => b64url(await mac('pkce', nonce));
  const cookie = (v, age) => `${COOKIE}=${v}; Max-Age=${age}; Path=/; Secure; HttpOnly; SameSite=Lax`;
  const cookieOf = (req) => { for (const part of String(req.headers.get('cookie') ?? '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim(); } return null; };
  /** the address a sign-in returns to → the same, cleaned, or null: one of PANEL_ORIGINS, no user:password, no handoff in it */
  const returnOf = (s) => {
    if (typeof s !== 'string' || !s || s.length > 1500) return null;
    let u; try { u = new URL(s); } catch { return null; }
    if (!c.origins.includes(u.origin) || u.username || u.password || /bdslab-auth/.test(u.hash)) return null;
    return `${u.origin}${u.pathname}${u.search}${u.hash}`;
  };
  // (the panel's own # is kept: its route — a run Discord linked to — and the nonce it left to know its own sign-in)
  const handTo = (back, part) => { const i = back.indexOf('#'), frag = i < 0 ? '' : back.slice(i + 1); return `${i < 0 ? back : back.slice(0, i)}#${frag ? `${frag}&` : ''}${part}`; };
  /** a sign-in begun → { state, n }: where it returns (r), a nonce (n), when (t), signed */
  async function signState(r) {
    const n = b64url(globalThis.crypto.getRandomValues(new Uint8Array(16))), payload = b64url(enc.encode(JSON.stringify({ r, n, t: now() })));
    return { state: `${payload}.${b64url(await mac('state', payload))}`, n };
  }
  async function openState(state) {
    const m = /^([A-Za-z0-9_-]{1,3000})\.([A-Za-z0-9_-]{43})$/.exec(String(state ?? ''));
    if (!m) return null;
    let good = false; try { good = await subtle().verify('HMAC', await key(), unb64url(m[2]), enc.encode(`state\n${m[1]}`)); } catch { return null; }
    if (!good) return null;
    try { const s = JSON.parse(dec.decode(unb64url(m[1]))); return typeof s?.r === 'string' && /^[A-Za-z0-9_-]{22}$/.test(String(s.n)) && Number.isFinite(s.t) ? s : null; } catch { return null; }
  }
  /** a code or a refresh token traded at GitHub → { ok, tokens } / { ok: false, error } (GitHub's own words are not passed on) */
  async function exchange(params) {
    let r, j;
    try {
      r = await fetchImpl(`${c.web}${GITHUB.token}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, ...params }).toString() });
      j = await r.json();
    } catch { return { ok: false, error: 'github' }; }
    const tokens = r.ok && !j?.error ? tokensOf(j) : null;
    return tokens ? { ok: true, tokens } : { ok: false, error: 'exchange' };
  }
  const readJson = async (req) => {
    if (Number(req.headers.get('content-length') ?? 0) > 4096) return null;
    const t = await req.text().catch(() => '');
    try { const j = t.length <= 4096 ? JSON.parse(t) : null; return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; }
  };

  async function login(url) {
    const back = returnOf(url.searchParams.get('return'));
    if (!back) return reply(400, { error: 'return' });
    const { state, n } = await signState(back);
    const q = new URLSearchParams({ client_id: c.clientId, redirect_uri: `${url.origin}/callback`, state });
    if (GITHUB.pkce) { q.set('code_challenge', b64url(await subtle().digest('SHA-256', enc.encode(await verifierOf(n))))); q.set('code_challenge_method', 'S256'); }
    if (/^(1|true)$/.test(url.searchParams.get('select') ?? '')) q.set('prompt', GITHUB.selectAccount);
    const who = url.searchParams.get('login');
    if (who && LOGIN.test(who)) q.set('login', who);
    return reply(302, null, { location: `${c.web}${GITHUB.authorize}?${q}`, 'set-cookie': cookie(state, TTL / 1000) });
  }
  async function callback(url, req) {
    const clear = { 'set-cookie': cookie('', 0) }, state = url.searchParams.get('state') ?? '', s = await openState(state);
    // (a state this service did not sign: no address to trust — nothing is followed)
    if (!s) return reply(400, { error: 'state' }, clear);
    const back = returnOf(s.r);
    if (!back) return reply(400, { error: 'return' }, clear);
    const go = (part) => reply(302, null, { ...clear, location: handTo(back, part) });
    // (the cookie set when this browser began: a callback address made elsewhere and sent to someone signs nobody in)
    if (cookieOf(req) !== state) return go('bdslab-auth-error=cookie');
    const age = now() - s.t;
    if (!(age <= TTL && age >= -60_000)) return go('bdslab-auth-error=expired');
    const err = url.searchParams.get('error');
    if (err) return go(`bdslab-auth-error=${err === 'access_denied' ? 'denied' : 'github'}`);
    const code = url.searchParams.get('code') ?? '';
    if (!/^[\x21-\x7e]{1,512}$/.test(code)) return go('bdslab-auth-error=code');
    const t = await exchange({ code, redirect_uri: `${url.origin}/callback`, ...(GITHUB.pkce ? { code_verifier: await verifierOf(s.n) } : {}) });
    if (!t.ok) return go(`bdslab-auth-error=${t.error}`);
    return go(`bdslab-auth=${b64url(enc.encode(JSON.stringify(t.tokens)))}`);
  }
  async function refresh(body, cors) {
    const rt = body?.refresh_token;
    if (typeof rt !== 'string' || !TOKEN.test(rt)) return reply(400, { error: 'body' }, cors);
    const t = await exchange({ grant_type: 'refresh_token', refresh_token: rt });
    if (t.ok) return reply(200, t.tokens, cors);
    return t.error === 'github' ? reply(502, { error: 'github' }, cors) : reply(401, { error: 'refresh' }, cors);
  }
  async function logout(body, cors) {
    const at = body?.access_token;
    if (typeof at !== 'string' || !TOKEN.test(at)) return reply(400, { error: 'body' }, cors);
    let r;
    try {
      r = await fetchImpl(`${c.api}${GITHUB.revoke(c.clientId)}`, { method: 'DELETE', headers: { accept: 'application/vnd.github+json', authorization: `Basic ${btoa(`${c.clientId}:${c.secret}`)}`, 'content-type': 'application/json', 'x-github-api-version': GITHUB.apiVersion, 'user-agent': UA }, body: JSON.stringify({ access_token: at }) });
      await r.text().catch(() => '');
    } catch { return reply(502, { error: 'github' }, cors); }
    // (404 / 422: GitHub knows no such token any more — gone already, which is what was asked)
    return r.ok || r.status === 404 || r.status === 422 ? reply(204, null, cors) : reply(502, { error: 'github' }, cors);
  }

  const ROUTES = { '/health': 'GET', '/login': 'GET', '/callback': 'GET', '/refresh': 'POST', '/logout': 'POST' };
  async function route(req) {
    const url = new URL(req.url), path = url.pathname, want = ROUTES[path];
    if (!want) return reply(404, { error: 'not_found' });
    // (CORS for the panel's own origins alone; a browser says where a call comes from — anything else is not the panel)
    const origin = req.headers.get('origin'), allowed = origin !== null && c.origins.includes(origin);
    const cors = allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      return allowed && path !== '/login' && path !== '/callback' ? reply(204, null, { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }) : reply(403, { error: 'origin' }, { vary: 'Origin' });
    }
    if (req.method !== want) return reply(405, { error: 'method' }, { allow: `${want}, OPTIONS` });
    if (path === '/health') return reply(c.missing.length ? 503 : 200, { ok: !c.missing.length, clientId: c.clientId || null, origins: c.origins, version: VERSION, ...(c.missing.length ? { missing: c.missing } : {}) }, cors);
    if (c.missing.length) return reply(500, { error: 'config' }, cors);
    if (path === '/login') return login(url);
    if (path === '/callback') return callback(url, req);
    if (!allowed) return reply(403, { error: 'origin' }, { vary: 'Origin' });
    const body = await readJson(req);
    return path === '/refresh' ? refresh(body, cors) : logout(body, cors);
  }
  return async (request) => { try { return await route(request); } catch { return reply(500, { error: 'internal' }); } };
}
