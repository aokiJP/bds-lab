// the panel's sign-in service (auth/) against a fake GitHub (its web side: authorize and access_token; its API: the token's
// revocation), with no network: a sign-in from /login through GitHub to /callback and the handoff the panel reads; a state
// altered, no cookie, an old state, a return to another origin; refresh and logout from the panel's origins only (CORS);
// logout's Basic auth and DELETE; every answer's headers; no secret, code or token in any answer (but the handoff after the
// Location's # and refresh's own body); auth/node.mjs on a free port, the same flow; worker.mjs's shape; the files that ship.
// node tests/auth-offline.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const A = await imp('auth/handler.mjs'), S = await imp('panel/lib/session.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const b64url = (b) => Buffer.from(b).toString('base64url');

// ---- a fake GitHub: /web (authorize: the person says yes; access_token: codes and refresh tokens) and /api (revoke) ----
const CLIENT_ID = 'Iv23liFAKECLIENT', CLIENT_SECRET = 'fake-client-secret-0123456789abcdef', STATE_SECRET = 'fake-state-secret-0123456789abcdef-0123456789';
const PANEL = 'https://panel.test', AUTH = 'https://auth.test';
const gh = { codes: new Map(), refreshes: new Set(), seen: [], verifiers: [], revoked: [], deny: false, n: 0 };
const issue = () => { gh.n++; const tk = { access_token: `ghu_AccessToken${gh.n}x`, expires_in: 28800, refresh_token: `ghr_RefreshToken${gh.n}x`, refresh_token_expires_in: 15811200, token_type: 'bearer', scope: '' }; gh.refreshes.add(tk.refresh_token); return tk; };
const fake = http.createServer(async (req, res) => {
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
  const u = new URL(req.url, 'http://fake');
  gh.seen.push({ method: req.method, path: u.pathname, headers: req.headers, body });
  const send = (status, j, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(j === null ? '' : JSON.stringify(j)); };
  if (req.method === 'GET' && u.pathname === '/web/login/oauth/authorize') {
    const q = u.searchParams, back = new URL(q.get('redirect_uri'));
    if (gh.deny) { back.search = new URLSearchParams({ error: 'access_denied', error_description: 'The user has denied your application access.', state: q.get('state') }).toString(); return send(302, null, { location: back.href }); }
    const code = `code${crypto.randomBytes(6).toString('hex')}`;
    gh.codes.set(code, { challenge: q.get('code_challenge'), method: q.get('code_challenge_method'), redirect: q.get('redirect_uri'), client: q.get('client_id') });
    back.search = new URLSearchParams({ code, state: q.get('state') }).toString();
    return send(302, null, { location: back.href });
  }
  if (req.method === 'POST' && u.pathname === '/web/login/oauth/access_token') {
    const p = new URLSearchParams(body);
    if (req.headers.accept !== 'application/json' || p.get('client_id') !== CLIENT_ID || p.get('client_secret') !== CLIENT_SECRET) return send(200, { error: 'incorrect_client_credentials' });
    if (p.get('grant_type') === 'refresh_token') {
      if (!gh.refreshes.delete(p.get('refresh_token'))) return send(200, { error: 'bad_refresh_token', error_description: 'The refresh token passed is incorrect or expired.' });
      return send(200, issue());
    }
    const c = gh.codes.get(p.get('code'));
    gh.codes.delete(p.get('code'));
    gh.verifiers.push(p.get('code_verifier'));
    if (!c || c.redirect !== p.get('redirect_uri') || c.method !== 'S256' || c.challenge !== b64url(crypto.createHash('sha256').update(p.get('code_verifier') ?? '').digest())) return send(200, { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
    return send(200, issue());
  }
  if (req.method === 'DELETE' && u.pathname === `/api/applications/${CLIENT_ID}/token`) {
    if (req.headers.authorization !== `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`) return send(401, { message: 'Requires authentication' });
    gh.revoked.push(JSON.parse(body).access_token);
    return send(204, null);
  }
  send(404, { message: 'Not Found' });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const GH = `http://127.0.0.1:${fake.address().port}`;
const ENV = { GITHUB_CLIENT_ID: CLIENT_ID, GITHUB_CLIENT_SECRET: CLIENT_SECRET, PANEL_ORIGINS: `${PANEL}, http://127.0.0.1:9, not an origin, https://x.test/path`, STATE_SECRET, GITHUB_WEB: `${GH}/web`, GITHUB_API: `${GH}/api` };

// ---- every answer the service gives is kept: none may carry a secret, a code or a token where it should not ----
const answers = [];
let clock = Date.parse('2026-10-08T00:00:00Z');
const H = A.handler(ENV, { now: () => clock });
async function ask(url, init = {}) {
  const r = await H(new Request(url, init));
  const text = r.status === 204 || r.status === 302 ? '' : await r.text();
  const a = { url, status: r.status, headers: Object.fromEntries(r.headers), cookie: r.headers.getSetCookie(), text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  answers.push(a);
  return a;
}
const cookieOf = (a) => /^__Host-bdslab_state=([^;]*)/.exec(a.cookie[0] ?? '')?.[1] ?? null;
/** the person's browser: /login → GitHub (the fake says yes) → the callback address GitHub sends them to */
async function toGitHub(ret, extra = '') {
  const login = await ask(`${AUTH}/login?return=${encodeURIComponent(ret)}${extra}`);
  ok(login.status === 302, `login: ${login.status} ${login.text}`);
  const at = await fetch(login.headers.location, { redirect: 'manual' });
  return { login, state: new URL(login.headers.location).searchParams.get('state'), cookie: cookieOf(login), callback: at.headers.get('location') };
}

await t('a sign-in: /login signs a state into the cookie and GitHub\'s address (PKCE S256, the account picker, a login hint); /callback trades the code and hands the tokens over after the panel\'s # — its own route kept — and the panel reads them', async () => {
  const s = await toGitHub(`${PANEL}/bds-lab/#runs?repo=o/r&run=5&bdslab-nonce=NonceNonceNonce01`, '&select=1&login=author1');
  const q = new URL(s.login.headers.location).searchParams;
  ok(s.login.headers.location.startsWith(`${GH}/web/login/oauth/authorize?`), s.login.headers.location);
  eq([q.get('client_id'), q.get('redirect_uri'), q.get('code_challenge_method'), q.get('prompt'), q.get('login')], [CLIENT_ID, `${AUTH}/callback`, 'S256', 'select_account', 'author1']);
  ok(/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge')), q.get('code_challenge'));
  ok(s.state && s.cookie === s.state, 'the cookie and the state are the same value');
  ok(/; Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/.test(s.login.cookie[0]) && !/Domain=/i.test(s.login.cookie[0]), s.login.cookie[0]);
  ok(s.callback.startsWith(`${AUTH}/callback?code=`), s.callback);
  const cb = await ask(s.callback, { headers: { cookie: `other=1; __Host-bdslab_state=${s.cookie}` } });
  ok(cb.status === 302 && cb.headers.location.startsWith(`${PANEL}/bds-lab/#runs?repo=o/r&run=5&bdslab-nonce=NonceNonceNonce01&bdslab-auth=`), cb.headers.location);
  ok(/^__Host-bdslab_state=; Max-Age=0; Path=\/; Secure; HttpOnly; SameSite=Lax$/.test(cb.cookie[0]), `the cookie is cleared: ${cb.cookie[0]}`);
  const tok = gh.seen.filter((x) => x.path === '/web/login/oauth/access_token').at(-1), p = new URLSearchParams(tok.body);
  eq([p.get('client_id'), p.get('code'), p.get('redirect_uri'), tok.headers.accept, tok.headers['content-type']], [CLIENT_ID, new URL(s.callback).searchParams.get('code'), `${AUTH}/callback`, 'application/json', 'application/x-www-form-urlencoded'], 'GitHub is asked as its docs say');
  ok(/^[A-Za-z0-9_-]{43}$/.test(p.get('code_verifier')), 'a PKCE verifier GitHub can check (the fake checked it against the challenge)');
  const got = S.takeHandoff(new URL(cb.headers.location).hash, { nonce: 'NonceNonceNonce01' });
  eq(got, { tokens: { access_token: 'ghu_AccessToken1x', expires_in: 28800, refresh_token: 'ghr_RefreshToken1x', refresh_token_expires_in: 15811200, token_type: 'bearer' }, rest: '#runs?repo=o/r&run=5' }, 'the panel reads the five fields, its route left');
  // the panel's own link to the service, the same flow
  const s2 = await toGitHub(new URL(S.loginUrl(AUTH, { returnTo: `${PANEL}/bds-lab/`, nonce: 'NonceNonceNonce02' })).searchParams.get('return'));
  const cb2 = await ask(s2.callback, { headers: { cookie: `__Host-bdslab_state=${s2.cookie}` } });
  eq(S.takeHandoff(new URL(cb2.headers.location).hash, { nonce: 'NonceNonceNonce02' })?.tokens?.access_token, 'ghu_AccessToken2x');
  eq(new URL(s2.login.headers.location).searchParams.get('prompt'), null, 'no account picker unless asked');
});

await t('a state that is not ours: altered, signed with another secret, cut, or no state — 400, nothing followed; the code is never traded', async () => {
  const s = await toGitHub(`${PANEL}/`);
  const [payload, sig] = s.state.split('.');
  const forged = JSON.parse(Buffer.from(payload, 'base64url')); forged.r = 'https://evil.test/';
  const bad = [`${b64url(JSON.stringify(forged))}.${sig}`, `${payload}.${b64url(crypto.createHmac('sha256', 'another-secret-0123456789abcdef0123').update(`state\n${payload}`).digest())}`, payload, `${payload}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`, ''];
  const before = gh.seen.filter((x) => x.path === '/web/login/oauth/access_token').length;
  for (const st of bad) {
    const cb = await ask(`${AUTH}/callback?code=${new URL(s.callback).searchParams.get('code')}&state=${encodeURIComponent(st)}`, { headers: { cookie: `__Host-bdslab_state=${st}` } });
    ok(cb.status === 400 && cb.json?.error === 'state' && !cb.headers.location, `${st.slice(0, 30)}…: ${cb.status} ${cb.text}`);
  }
  eq(gh.seen.filter((x) => x.path === '/web/login/oauth/access_token').length, before, 'GitHub was never asked');
});

await t('a callback in a browser that did not begin it (no cookie, another sign-in\'s cookie), an old state, GitHub saying no, a code GitHub refuses: back to the panel with the reason, no token', async () => {
  const s = await toGitHub(`${PANEL}/`), other = await toGitHub(`${PANEL}/`);
  const none = await ask(s.callback);
  eq([none.status, none.headers.location], [302, `${PANEL}/#bdslab-auth-error=cookie`], 'no cookie');
  const mixed = await ask(s.callback, { headers: { cookie: `__Host-bdslab_state=${other.cookie}` } });
  eq(mixed.headers.location, `${PANEL}/#bdslab-auth-error=cookie`, 'another sign-in\'s cookie');
  const old = await toGitHub(`${PANEL}/`);
  clock += 10 * 60_000 + 1;
  const late = await ask(old.callback, { headers: { cookie: `__Host-bdslab_state=${old.cookie}` } });
  eq(late.headers.location, `${PANEL}/#bdslab-auth-error=expired`, 'over 10 minutes');
  clock -= 10 * 60_000 + 1;
  gh.deny = true; const no = await toGitHub(`${PANEL}/x/#overview`); gh.deny = false;
  eq((await ask(no.callback, { headers: { cookie: `__Host-bdslab_state=${no.cookie}` } })).headers.location, `${PANEL}/x/#overview&bdslab-auth-error=denied`, 'the person said no on GitHub');
  const used = await toGitHub(`${PANEL}/`);
  ok((await ask(used.callback, { headers: { cookie: `__Host-bdslab_state=${used.cookie}` } })).headers.location.includes('#bdslab-auth='), 'first time: signed in');
  eq((await ask(used.callback, { headers: { cookie: `__Host-bdslab_state=${used.cookie}` } })).headers.location, `${PANEL}/#bdslab-auth-error=exchange`, 'a code used twice: GitHub refuses it');
  const nocode = await ask(used.callback.replace(/code=[^&]*&/, ''), { headers: { cookie: `__Host-bdslab_state=${used.cookie}` } });
  eq(nocode.headers.location, `${PANEL}/#bdslab-auth-error=code`);
  for (const a of [none, mixed, late]) eq(S.takeHandoff(new URL(a.headers.location).hash)?.tokens, undefined, 'no token handed');
  eq(S.takeHandoff('#bdslab-auth-error=cookie'), { error: 'cookie', rest: '' });
});

await t('the return address: only the panel\'s origins (PANEL_ORIGINS) — another origin, a look-alike, user@host, javascript:, a relative one, a handoff planted in it, too long: 400 with no cookie', async () => {
  for (const r of ['https://evil.test/', 'https://panel.test.evil.test/', 'https://panel.test@evil.test/', 'http://panel.test/', 'javascript:alert(1)//https://panel.test/', '//evil.test/', '/bds-lab/', `${PANEL}/#bdslab-auth=e30`, `${PANEL}/${'a'.repeat(1600)}`, 'https://x.test/path', '']) {
    const a = await ask(`${AUTH}/login?return=${encodeURIComponent(r)}`);
    ok(a.status === 400 && a.json?.error === 'return' && !a.cookie.length && !a.headers.location, `${r.slice(0, 40)}: ${a.status} ${a.text}`);
  }
  ok((await ask(`${AUTH}/login?return=${encodeURIComponent('http://127.0.0.1:9/')}`)).status === 302, 'http on this machine (a panel tried out locally)');
  ok((await ask(`${AUTH}/login?return=${encodeURIComponent(`${PANEL}/`)}&login=${encodeURIComponent('../x')}`)).headers.location.indexOf('login=') < 0, 'a login GitHub would not give is not passed on');
});

await t('refresh: from the panel\'s origin, the refresh token traded (grant_type=refresh_token) with CORS for that origin alone; another origin, none, or a bad body: refused', async () => {
  const s = await toGitHub(`${PANEL}/`);
  const t0 = S.takeHandoff(new URL((await ask(s.callback, { headers: { cookie: `__Host-bdslab_state=${s.cookie}` } })).headers.location).hash).tokens;
  const pre = await ask(`${AUTH}/refresh`, { method: 'OPTIONS', headers: { origin: PANEL, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  eq([pre.status, pre.headers['access-control-allow-origin'], pre.headers['access-control-allow-methods'], pre.headers['access-control-allow-headers'], pre.headers.vary], [204, PANEL, 'GET, POST', 'content-type', 'Origin'], 'preflight');
  const preBad = await ask(`${AUTH}/refresh`, { method: 'OPTIONS', headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' } });
  ok(preBad.status === 403 && !preBad.headers['access-control-allow-origin'], 'another origin\'s preflight: no CORS');
  const r = await ask(`${AUTH}/refresh`, { method: 'POST', headers: { origin: PANEL, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: t0.refresh_token }) });
  ok(r.status === 200 && r.headers['access-control-allow-origin'] === PANEL && r.headers.vary === 'Origin', `${r.status} ${JSON.stringify(r.headers)}`);
  eq(Object.keys(r.json), ['access_token', 'expires_in', 'refresh_token', 'refresh_token_expires_in', 'token_type'], 'the five fields only');
  ok(r.json.access_token !== t0.access_token && r.json.refresh_token !== t0.refresh_token, 'new tokens');
  eq(new URLSearchParams(gh.seen.at(-1).body).get('grant_type'), 'refresh_token');
  const again = await ask(`${AUTH}/refresh`, { method: 'POST', headers: { origin: PANEL, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: t0.refresh_token }) });
  eq([again.status, again.json], [401, { error: 'refresh' }], 'a used refresh token: GitHub\'s words not passed on');
  const n = gh.seen.length;
  for (const o of ['https://evil.test', null, 'null']) {
    const x = await ask(`${AUTH}/refresh`, { method: 'POST', headers: { ...(o ? { origin: o } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: r.json.refresh_token }) });
    ok(x.status === 403 && x.json?.error === 'origin' && !x.headers['access-control-allow-origin'], `origin ${o}: ${x.status} ${JSON.stringify(x.headers)}`);
  }
  eq(gh.seen.length, n, 'GitHub was never asked for another origin');
  for (const body of ['not json', '[]', JSON.stringify({ refresh_token: 'has space' }), JSON.stringify({ refresh_token: 'x'.repeat(5000) })]) {
    const x = await ask(`${AUTH}/refresh`, { method: 'POST', headers: { origin: PANEL, 'content-type': 'application/json' }, body });
    ok(x.status === 400 && x.json?.error === 'body' && x.headers['access-control-allow-origin'] === PANEL, `${body.slice(0, 20)}: ${x.status}`);
  }
  eq((await ask(`${AUTH}/refresh`, { headers: { origin: PANEL } })).status, 405, 'GET: not this way');
  const health = await ask(`${AUTH}/health`, { headers: { origin: PANEL } });
  eq([health.status, health.json, health.headers['access-control-allow-origin']], [200, { ok: true, clientId: CLIENT_ID, origins: [PANEL, 'http://127.0.0.1:9'], version: A.VERSION }, PANEL], 'health: the panel may read it');
  eq((await ask(`${AUTH}/health`, { headers: { origin: 'https://evil.test' } })).headers['access-control-allow-origin'], undefined, 'not for another origin');
});

await t('logout: from the panel\'s origin, the token revoked on GitHub with DELETE /applications/{client_id}/token and Basic client_id:client_secret → 204; another origin: refused, nothing revoked', async () => {
  const x = await ask(`${AUTH}/logout`, { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'ghu_AccessToken1x' }) });
  ok(x.status === 403 && !gh.revoked.length, `${x.status}`);
  const r = await ask(`${AUTH}/logout`, { method: 'POST', headers: { origin: PANEL, 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'ghu_AccessToken1x' }) });
  eq([r.status, r.text, r.headers['access-control-allow-origin'], gh.revoked], [204, '', PANEL, ['ghu_AccessToken1x']]);
  const d = gh.seen.filter((s) => s.method === 'DELETE').at(-1);
  eq([d.path, d.headers.authorization, d.headers.accept, d.headers['x-github-api-version'], JSON.parse(d.body)], [`/api/applications/${CLIENT_ID}/token`, `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`, 'application/vnd.github+json', '2022-11-28', { access_token: 'ghu_AccessToken1x' }]);
  eq((await ask(`${AUTH}/logout`, { method: 'POST', headers: { origin: PANEL }, body: '{}' })).status, 400, 'no token: nothing to do');
});

await t('every answer: no-store, no Referer, nosniff, a CSP that loads and frames nothing; no secret, code or verifier anywhere; tokens only after the Location\'s # (and in refresh\'s own body)', async () => {
  await ask(`${AUTH}/nowhere`); await ask(`${AUTH}/login`, { method: 'POST' });
  const codes = [...gh.seen].filter((s) => s.path === '/web/login/oauth/access_token').map((s) => new URLSearchParams(s.body).get('code')).filter(Boolean);
  ok(answers.length > 40 && codes.length > 3 && gh.verifiers.length > 3, `${answers.length} answers`);
  for (const a of answers) {
    eq([a.headers['cache-control'], a.headers['referrer-policy'], a.headers['x-content-type-options'], a.headers['content-security-policy']], ['no-store', 'no-referrer', 'nosniff', "default-src 'none'; frame-ancestors 'none'"], `${a.url} ${a.status}`);
    // (the state as well, opened: what it carries travels in GitHub's address and the cookie)
    const state = new URL(String(a.headers.location ?? 'x:'), AUTH).searchParams.get('state'), opened = state ? Buffer.from(state.split('.')[0], 'base64url').toString() : '';
    if (state) eq(Object.keys(JSON.parse(opened)), ['r', 'n', 't'], 'the state: where it returns, a nonce, when — no verifier');
    const shown = JSON.stringify({ ...a.headers, location: String(a.headers.location ?? '').split('#')[0], cookie: a.cookie, opened, text: /\/refresh$/.test(a.url) && a.status === 200 ? '' : a.text });
    for (const secret of [CLIENT_SECRET, STATE_SECRET, ...codes, ...gh.verifiers]) ok(!shown.includes(secret), `${a.url}: ${secret.slice(0, 12)}… shown\n${shown}`);
    ok(!/gh[ur]_/.test(shown), `${a.url}: a token outside the #\n${shown}`);
    if (a.status >= 400) ok(a.json && Object.keys(a.json).join() === 'error' && /^[a-z_]+$/.test(a.json.error), `${a.url}: an error is {error} alone: ${a.text}`);
  }
  // a service without its settings: says which are missing (names, never values), signs nobody in
  const bare = A.handler({ GITHUB_CLIENT_SECRET: CLIENT_SECRET, STATE_SECRET: 'short' });
  const h = await bare(new Request(`${AUTH}/health`));
  eq([h.status, await h.json()], [503, { ok: false, clientId: null, origins: [], version: A.VERSION, missing: ['GITHUB_CLIENT_ID', 'STATE_SECRET', 'PANEL_ORIGINS'] }]);
  const l = await bare(new Request(`${AUTH}/login?return=${encodeURIComponent(`${PANEL}/`)}`));
  eq([l.status, await l.json()], [500, { error: 'config' }]);
});

await t('the files that run it: handler.mjs uses no node: module (Workers and browsers run it as it is); worker.mjs exports { fetch(req, env) }; wrangler.toml names bds-lab-auth / worker.mjs; the Dockerfile is node:22-alpine, auth/ alone, not root', async () => {
  for (const f of ['auth/handler.mjs', 'auth/worker.mjs', 'panel/lib/session.mjs', 'panel/lib/accounts.mjs']) ok(!/from 'node:|require\(/.test(fs.readFileSync(path.join(TOP, f), 'utf8')), `${f}: no node: import`);
  const W = await imp('auth/worker.mjs');
  eq([Object.keys(W.default), typeof W.default.fetch, W.default.fetch.length], [['fetch'], 'function', 2]);
  const r = await W.default.fetch(new Request(`${AUTH}/health`, { headers: { origin: PANEL } }), ENV);
  eq([r.status, (await r.json()).ok, r.headers.get('access-control-allow-origin')], [200, true, PANEL]);
  const toml = fs.readFileSync(path.join(TOP, 'auth', 'wrangler.toml'), 'utf8');
  ok(/^name = "bds-lab-auth"$/m.test(toml) && /^main = "worker\.mjs"$/m.test(toml) && !/SECRET\s*=/.test(toml), toml);
  const df = fs.readFileSync(path.join(TOP, 'auth', 'Dockerfile'), 'utf8'), from = df.split('\n').filter((l) => /^(FROM|COPY|ADD|USER) /.test(l));
  ok(from[0] === 'FROM node:22-alpine' && from.filter((l) => /^(COPY|ADD) /.test(l)).every((l) => /^COPY (handler|node)\.mjs (handler|node)\.mjs \.\/$/.test(l)) && /^USER (?!root)\w+/.test(from.at(-1)), from.join('\n'));
});

await t('auth/node.mjs on a free port: the same sign-in through node:http (cookie, Origin and body passed through; PUBLIC_URL is the address GitHub sends people back to)', async () => {
  const PUB = 'https://auth.example.test';
  const child = spawn(process.execPath, [path.join(TOP, 'auth', 'node.mjs')], { env: { PATH: process.env.PATH, ...ENV, PUBLIC_URL: PUB, PORT: '0', HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  try {
    const port = await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error(`no port\n${out}`)), 10_000); child.stdout.on('data', (d) => { out += d; const m = /listening on (\d+)/.exec(out); if (m) { clearTimeout(to); res(Number(m[1])); } }); child.stderr.on('data', (d) => { out += d; }); child.on('exit', (c) => rej(new Error(`exited ${c}\n${out}`))); });
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/login?return=${encodeURIComponent(`${PANEL}/lab/#overview`)}`, { redirect: 'manual' });
    const loc = login.headers.get('location'), state = new URL(loc).searchParams.get('state'), cookie = /^__Host-bdslab_state=([^;]*)/.exec(login.headers.getSetCookie()[0])[1];
    ok(login.status === 302 && new URL(loc).searchParams.get('redirect_uri') === `${PUB}/callback` && cookie === state && login.headers.get('cache-control') === 'no-store', `${login.status} ${loc}`);
    const back = (await fetch(loc, { redirect: 'manual' })).headers.get('location');
    const cb = await fetch(`${base}${new URL(back).pathname}${new URL(back).search}`, { redirect: 'manual', headers: { cookie: `__Host-bdslab_state=${cookie}` } });
    const hand = S.takeHandoff(new URL(cb.headers.get('location')).hash);
    ok(cb.status === 302 && hand?.tokens?.access_token?.startsWith('ghu_') && hand.rest === '#overview', `${cb.status} ${cb.headers.get('location')}`);
    eq(new URLSearchParams(gh.seen.filter((x) => x.path === '/web/login/oauth/access_token').at(-1).body).get('redirect_uri'), `${PUB}/callback`);
    const r = await fetch(`${base}/refresh`, { method: 'POST', headers: { origin: PANEL, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: hand.tokens.refresh_token }) });
    eq([r.status, r.headers.get('access-control-allow-origin'), (await r.json()).token_type], [200, PANEL, 'bearer']);
    const big = await fetch(`${base}/refresh`, { method: 'POST', headers: { origin: PANEL, 'content-type': 'application/json' }, body: 'x'.repeat(20_000) }).catch((e) => ({ status: `closed: ${e.message}` }));
    ok(big.status === 413 || /closed/.test(String(big.status)), `a body over 16 KB: ${big.status}`);
    const lo = await fetch(`${base}/logout`, { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ access_token: hand.tokens.access_token }) });
    eq(lo.status, 403);
    ok(!out.includes(CLIENT_SECRET) && !out.includes(STATE_SECRET) && !/gh[ur]_|code/.test(out), `it logs nothing of a request\n${out}`);
  } finally { child.kill(); }
});

fake.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
