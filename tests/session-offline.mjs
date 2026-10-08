// the panel's side of 「GitHub でサインイン」 with no browser and no network (panel/lib/session.mjs, the accounts' OAuth
// fields in panel/lib/accounts.mjs, the card in panel/ui/signin.mjs on a tiny stand-in DOM): the service's /login address;
// the handoff read from the # and the panel's own route left; broken, doubled, oversized or unasked-for handoffs refused;
// when to renew, when it ran out, when the panel was left too long; refresh and logout against a fake service; an OAuth
// account remembered in this browser or kept for this tab only.
// node tests/session-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const S = await imp('panel/lib/session.mjs'), AC = await imp('panel/lib/accounts.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const hand = (j) => Buffer.from(typeof j === 'string' ? j : JSON.stringify(j)).toString('base64url');
const TOK = { access_token: 'ghu_A1', expires_in: 28800, refresh_token: 'ghr_R1', refresh_token_expires_in: 15811200, token_type: 'bearer' };
const AUTH = 'https://auth.test';
// (the nonce this tab kept when it began the sign-in, and the same left in the panel's own # — the service hands it back)
const NONCE = 'NonceNonceNonce01', MINE = `bdslab-nonce=${NONCE}&`, KEPT = { nonce: NONCE };

await t('loginUrl: the service\'s /login with the panel\'s address to return to (its route kept, an old handoff dropped, this tab\'s nonce added), the account picker and a login hint when asked; an address that is not https is refused (pure)', () => {
  const u = new URL(S.loginUrl(`${AUTH}/`, { returnTo: 'https://o.github.io/bds-lab/#runs?repo=o/r&run=5&bdslab-auth=old&bdslab-nonce=old0000000000000', select: true, login: 'author1', nonce: 'NonceNonceNonce01' }));
  eq([u.origin, u.pathname, u.searchParams.get('return'), u.searchParams.get('select'), u.searchParams.get('login')], [AUTH, '/login', 'https://o.github.io/bds-lab/#runs?repo=o/r&run=5&bdslab-nonce=NonceNonceNonce01', '1', 'author1']);
  const plain = new URL(S.loginUrl(AUTH, { returnTo: 'https://o.github.io/bds-lab/', login: '../x', nonce: 'short' }));
  eq([plain.searchParams.get('return'), plain.searchParams.get('select'), plain.searchParams.get('login')], ['https://o.github.io/bds-lab/', null, null], 'no picker; a login or nonce of the wrong shape left out');
  ok(S.loginUrl('http://127.0.0.1:8787', { returnTo: 'x' }).startsWith('http://127.0.0.1:8787/login?'), 'http on this machine (trying it out)');
  for (const bad of ['http://auth.test', 'https://auth.test/sub', 'javascript:alert(1)', '', null, 'https://u:p@auth.test']) {
    let threw = null; try { S.loginUrl(bad, { returnTo: 'x' }); } catch (e) { threw = e; }
    ok(threw?.code === 'config' && /サインインのサービス/.test(threw.message), `${bad}: refused`);
  }
  const n1 = S.newNonce(), n2 = S.newNonce();
  ok(/^[A-Za-z0-9_-]{22}$/.test(n1) && n1 !== n2, 'a nonce: 16 random bytes');
});

await t('takeHandoff: the tokens from the #, the rest of the # (the panel\'s own route) handed back; an error word; nothing of ours → null (pure)', () => {
  eq(S.takeHandoff(`#${MINE}bdslab-auth=${hand(TOK)}`, KEPT), { tokens: TOK, rest: '' });
  eq(S.takeHandoff(`#runs?repo=o/r&run=5&bdslab-nonce=NonceNonceNonce01&bdslab-auth=${hand(TOK)}`, { nonce: 'NonceNonceNonce01' }), { tokens: TOK, rest: '#runs?repo=o/r&run=5' });
  eq(S.takeHandoff(`overview&${MINE}bdslab-auth=${hand({ access_token: 'ghu_noexpiry' })}`, KEPT), { tokens: { access_token: 'ghu_noexpiry', expires_in: null, refresh_token: null, refresh_token_expires_in: null, token_type: 'bearer' }, rest: '#overview' }, 'a token that never runs out (the App\'s expiry off)');
  eq(S.takeHandoff(`#overview&${MINE}bdslab-auth-error=denied`, KEPT), { error: 'denied', rest: '#overview' });
  eq(S.takeHandoff(`#${MINE}bdslab-auth-error=<script>`, KEPT), { error: 'unknown', rest: '' }, 'an error word of another shape: unknown');
  eq(S.takeHandoff(`#${MINE}bdslab-auth=${hand({ ...TOK, scope: 'repo', extra: 'x' })}`, KEPT).tokens, TOK, 'only the five fields');
  for (const h of ['', '#', '#runs?repo=o/r', '#bdslab-authx=1', '#xbdslab-auth=1', `#${MINE}runs`, null, undefined]) { eq(S.takeHandoff(h), null, String(h)); eq(S.takeHandoff(h, KEPT), null, String(h)); }
});

await t('takeHandoff takes nothing this tab did not begin: with no opts, no nonce kept, or another, every handoff — tokens or an error word, a nonce in the # or none — is { error: \'nonce\' } (login CSRF; pure)', () => {
  const tok = `#bdslab-auth=${hand(TOK)}`, withNonce = `#overview&${MINE}bdslab-auth=${hand(TOK)}`, word = `#${MINE}bdslab-auth-error=denied`;
  eq(S.takeHandoff(tok), { error: 'nonce', rest: '' }, 'no opts: a link made elsewhere');
  eq(S.takeHandoff(withNonce), { error: 'nonce', rest: '#overview' }, 'no opts, though the # names a nonce');
  for (const o of [{}, { nonce: null }, { nonce: undefined }, { nonce: '' }, { nonce: 'short' }, { nonce: 'NonceNonceNonce02' }, null]) {
    for (const h of [tok, withNonce, word]) eq(S.takeHandoff(h, o)?.error, 'nonce', `${JSON.stringify(o)} ${h.slice(0, 30)}`);
  }
  eq(S.takeHandoff(withNonce, KEPT), { tokens: TOK, rest: '#overview' }, 'the very nonce this tab kept: taken');
  eq(S.takeHandoff(tok, KEPT), { error: 'nonce', rest: '' }, 'this tab began one, but the # has no nonce');
});

await t('takeHandoff refuses: broken base64 or JSON, no access token, another token type, a token of a strange shape, two handoffs, over 8 KB, and one without the nonce the panel kept (pure)', () => {
  const err = (h, o) => S.takeHandoff(h, o)?.error;
  eq(err(`#${MINE}bdslab-auth=***`, KEPT), 'broken');
  eq(err(`#${MINE}bdslab-auth=${hand('not json')}`, KEPT), 'broken');
  eq(err(`#${MINE}bdslab-auth=${hand('[1]')}`, KEPT), 'broken');
  eq(err(`#${MINE}bdslab-auth=${Buffer.from([0xff, 0xfe, 0x7b]).toString('base64url')}`, KEPT), 'broken', 'not UTF-8');
  eq(err(`#${MINE}bdslab-auth=${hand({ ...TOK, access_token: '' })}`, KEPT), 'broken');
  eq(err(`#${MINE}bdslab-auth=${hand({ ...TOK, access_token: 'has space' })}`, KEPT), 'broken');
  eq(err(`#${MINE}bdslab-auth=${hand({ ...TOK, token_type: 'mac' })}`, KEPT), 'broken');
  eq(err(`#${MINE}bdslab-auth=${hand({ ...TOK, access_token: 'ghu_EVIL' })}&bdslab-auth=${hand(TOK)}`, KEPT), 'broken', 'two handoffs: neither');
  eq(err(`#${MINE}bdslab-auth=${hand(TOK)}&bdslab-auth-error=denied`, KEPT), 'broken');
  const big = S.takeHandoff(`#overview&${MINE}bdslab-auth=${hand({ ...TOK, access_token: `ghu_${'x'.repeat(2000)}`, pad: 'y'.repeat(6000) })}`, KEPT);
  eq(big, { error: 'too_big', rest: '#overview' });
  const n = 'NonceNonceNonce01', good = `#bdslab-nonce=${n}&bdslab-auth=${hand(TOK)}`;
  eq(S.takeHandoff(good, { nonce: n }).tokens, TOK, 'the nonce this tab kept');
  eq(err(good, { nonce: 'NonceNonceNonce02' }), 'nonce', 'another nonce');
  eq(err(`#bdslab-auth=${hand(TOK)}`, { nonce: n }), 'nonce', 'a link made elsewhere (no nonce)');
  eq(err(good, { nonce: null }), 'nonce', 'this tab began no sign-in');
  eq(err(`#bdslab-nonce=${n}&bdslab-nonce=${n}&bdslab-auth=${hand(TOK)}`, { nonce: n }), 'broken');
  ok(/始めていない/.test(S.explainAuth('nonce')) && /期限/.test(S.explainAuth('refresh')) && S.explainAuth('wh<at>') === 'サインインできませんでした（what）', 'the words for each');
});

await t('the times: fromHandoff in ms from now, needsRefresh 5 minutes before (only with a refresh token still good), expired, idleOut (pure)', () => {
  const now = Date.parse('2026-10-08T00:00:00Z'), s = S.fromHandoff(TOK, now);
  eq(s, { token: 'ghu_A1', expiresAt: now + 28800_000, refresh: 'ghr_R1', refreshExpiresAt: now + 15811200_000 });
  eq(S.fromHandoff({ access_token: 'x', expires_in: null, refresh_token: null, refresh_token_expires_in: null }, now), { token: 'x', expiresAt: null, refresh: null, refreshExpiresAt: null });
  eq([S.needsRefresh(s, now), S.needsRefresh(s, s.expiresAt - 5 * 60_000 - 1), S.needsRefresh(s, s.expiresAt - 5 * 60_000), S.needsRefresh(s, s.expiresAt + 1), S.needsRefresh(s, s.expiresAt - 60_000, 30_000)], [false, false, true, true, false]);
  eq([S.needsRefresh({ ...s, refresh: null }, s.expiresAt), S.needsRefresh({ ...s, refreshExpiresAt: s.expiresAt - 1 }, s.expiresAt), S.needsRefresh({ token: 'x', expiresAt: null }, now), S.needsRefresh(null, now)], [false, false, false, false], 'nothing to renew with, or nothing that runs out');
  eq([S.expired(s, s.expiresAt - 1), S.expired(s, s.expiresAt), S.expired({ expiresAt: null }, now)], [false, true, false]);
  eq([S.idleOut(now, now + 29 * 60_000, 30), S.idleOut(now, now + 30 * 60_000, 30), S.idleOut(now, now + 1e9, 0), S.idleOut(now, now + 1e9, null), S.idleOut(undefined, now, 30)], [false, true, false, false, false]);
});

await t('refresh and logout against a fake service: POST JSON with no cookie and no Referer; the renewed tokens in the account\'s shape; a refused or unreachable service said in words; logout never throws', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], cookie: req.headers.cookie, body: b });
      const j = JSON.parse(b || '{}'), send = (st, o) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(o === null ? '' : JSON.stringify(o)); };
      if (req.url === '/refresh') return j.refresh_token === 'ghr_R1' ? send(200, { ...TOK, access_token: 'ghu_A2', refresh_token: 'ghr_R2' }) : j.refresh_token === 'ghr_junk' ? send(200, { nope: 1 }) : send(401, { error: 'refresh' });
      if (req.url === '/logout') return j.access_token === 'ghu_A2' ? send(204, null) : send(502, { error: 'github' });
      send(404, { error: 'not_found' });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`, inits = [];
  const fetchImpl = (url, init) => { inits.push(init); return fetch(url, init); };
  try {
    const now = Date.parse('2026-10-08T00:00:00Z');
    eq(await S.refresh(base, 'ghr_R1', fetchImpl, now), { token: 'ghu_A2', expiresAt: now + 28800_000, refresh: 'ghr_R2', refreshExpiresAt: now + 15811200_000 });
    eq([seen[0].method, seen[0].url, seen[0].type, seen[0].cookie, JSON.parse(seen[0].body)], ['POST', '/refresh', 'application/json', undefined, { refresh_token: 'ghr_R1' }]);
    eq([inits[0].credentials, inits[0].cache, inits[0].referrerPolicy], ['omit', 'no-store', 'no-referrer']);
    let e1 = null; try { await S.refresh(base, 'ghr_used', fetchImpl); } catch (e) { e1 = e; }
    ok(e1?.code === 'refresh' && /期限が切れました/.test(e1.message), `a refused refresh: ${e1?.message}`);
    let e2 = null; try { await S.refresh(base, 'ghr_junk', fetchImpl); } catch (e) { e2 = e; }
    eq(e2?.code, 'broken', 'an answer without tokens');
    let e3 = null; try { await S.refresh('http://127.0.0.1:9', 'ghr_R1'); } catch (e) { e3 = e; }
    ok(e3?.code === 'unreachable' && /つながりません/.test(e3.message), `nobody there: ${e3?.message}`);
    eq([await S.logout(base, 'ghu_A2', fetchImpl), await S.logout(base, 'ghu_other', fetchImpl), await S.logout('http://127.0.0.1:9', 'ghu_A2'), await S.logout('not an address', 'ghu_A2', fetchImpl)], [true, false, false, false]);
    eq(JSON.parse(seen.find((s) => s.url === '/logout').body), { access_token: 'ghu_A2' });
  } finally { srv.close(); }
});

await t('an OAuth account: kind, expiry and refresh token kept beside its token — in localStorage when remembered, this tab only when not; renewed in place; signed in again with a typed token: plain again; forgotten: all gone (pure)', () => {
  const local = AC.memoryStorage(), session = AC.memoryStorage(), D = { lab: 'aokiJP/bds-lab' };
  const A = AC.accounts({ local, session, defaults: D });
  const dump = (st) => Array.from({ length: st.length }, (_, i) => st.key(i)).map((k) => `${k}=${st.getItem(k)}`).join('\n');
  const now = Date.parse('2026-10-08T00:00:00Z');
  A.add({ login: 'author1', token: 'tok-typed', remember: true, cfg: { lab: 'author1/bds-lab' } });
  eq(A.session('author1'), { kind: 'token', expiresAt: null, refresh: null, refreshExpiresAt: null }, 'a typed token: kind token');
  A.add({ login: 'author1', avatar: 'https://avatars.githubusercontent.com/u/1', remember: true, kind: 'oauth', ...S.fromHandoff(TOK, now) });
  eq([A.token('author1'), A.session('author1'), A.cfg('author1').lab], ['ghu_A1', { kind: 'oauth', expiresAt: now + 28800_000, refresh: 'ghr_R1', refreshExpiresAt: now + 15811200_000 }, 'author1/bds-lab'], 'signed in with GitHub: the settings kept');
  A.add({ login: 'borrower1', remember: false, kind: 'oauth', ...S.fromHandoff({ ...TOK, access_token: 'ghu_B1', refresh_token: 'ghr_B1' }, now) });
  ok(dump(local).includes('ghr_R1') && !dump(local).includes('ghr_B1') && dump(session).includes('ghr_B1') && !dump(session).includes('ghr_R1'), `remembered: localStorage; not: this tab\n${dump(local)}\n--\n${dump(session)}`);
  const A2 = AC.accounts({ local, session: AC.memoryStorage(), defaults: D });
  eq([A2.list().map((e) => e.login), A2.session('borrower1'), A2.session('author1').refresh], [['author1'], null, 'ghr_R1'], 'a new tab: the tab-only one and its refresh token gone');
  ok(A.setTokens('borrower1', { token: 'ghu_B2', expiresAt: now + 1000, refresh: 'ghr_B2', refreshExpiresAt: now + 2000 }), 'renewed');
  eq([A.token('borrower1'), A.session('borrower1')], ['ghu_B2', { kind: 'oauth', expiresAt: now + 1000, refresh: 'ghr_B2', refreshExpiresAt: now + 2000 }]);
  ok(dump(session).includes('ghr_B2') && !dump(local).includes('ghr_B2') && !dump(session).includes('ghr_B1'), 'renewed where it lives, the old one gone');
  ok(!A.setTokens('nobody', { token: 'x' }) && !A.setTokens('borrower1', { token: '' }), 'no such account, or no token: nothing');
  A.add({ login: 'author1', token: 'github_pat_again', remember: true });
  eq([A.session('author1'), /ghr_R1/.test(dump(local))], [{ kind: 'token', expiresAt: null, refresh: null, refreshExpiresAt: null }, false], 'a typed token again: no refresh token left behind');
  A.remove('borrower1');
  ok(!/borrower1|ghr_B|ghu_B/.test(dump(session) + dump(local)), `forgotten: all of it\n${dump(session)}`);
  eq(A.session('borrower1'), null);
  eq(AC.cleanSession({ kind: 'oauth', expiresAt: 'soon', refresh: 'has space', refreshExpiresAt: -1 }), { kind: 'oauth', expiresAt: null, refresh: null, refreshExpiresAt: null }, 'stored values of the wrong shape: none');
  eq(AC.cleanSession({ kind: 'admin', refresh: 'ghr_x' }), { kind: 'token', expiresAt: null, refresh: null, refreshExpiresAt: null });
});

await t('the sign-in card: with a service, 「GitHub でサインイン」 on top and the token form folded below (#tok #lab #rem #go kept); without one, the token form open in the same words; each way calls back with what was typed', async () => {
  // (a stand-in for the few DOM calls panel/ui/dom.mjs makes)
  class N {}
  class El extends N {
    constructor(tag) { super(); Object.assign(this, { tag, attrs: {}, kids: [], on: {}, style: {}, className: '', value: '', checked: false }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(k, f) { (this.on[k] ??= []).push(f); }
    append(...c) { this.kids.push(...c); }
    remove() {}
    fire(k) { for (const f of this.on[k] ?? []) f({ target: this }); }
    get text() { return this.kids.map((c) => (c instanceof El ? c.text : c.data)).join(''); }
    all() { return [this, ...this.kids.filter((c) => c instanceof El).flatMap((c) => c.all())]; }
    find(id) { return this.all().find((e) => e.attrs.id === id) ?? null; }
  }
  const toasts = [];
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new El(tag), createTextNode: (data) => Object.assign(new N(), { data }), getElementById: (id) => (id === 'toast' ? { append: (d) => toasts.push(d.text) } : null) };
  const { signInCard } = await imp('panel/ui/signin.mjs');
  const calls = [];
  const plain = signInCard({ lab: 'o/lab', err: 'トークンが受け付けられません', onToken: (x) => calls.push(['token', x]), onOAuth: (x) => calls.push(['oauth', x]) });
  const det = plain.all().find((e) => e.tag === 'details');
  ok(det && 'open' in det.attrs && !plain.find('oauth'), 'no service: the token form, open');
  ok(['tok', 'lab', 'rem', 'go'].every((id) => plain.find(id) && det.find(id)), 'its ids');
  ok(/GitHub のトークンで入る/.test(plain.text) && /あなたのトークンに GitHub が許していることだけ/.test(plain.text) && /トークンを作る（Fine-grained）/.test(plain.text) && /このブラウザに覚える/.test(plain.text) && /トークンが受け付けられません/.test(plain.text), plain.text);
  plain.find('go').fire('click');
  eq([calls.length, toasts.at(-1)], [0, 'トークンを入れてください']);
  plain.find('tok').value = ' github_pat_x '; plain.find('rem').checked = false; plain.find('go').fire('click');
  eq(calls.pop(), ['token', { token: 'github_pat_x', lab: 'o/lab', remember: false }]);
  const svc = signInCard({ authUrl: AUTH, lab: 'o/lab', adding: true, onToken: (x) => calls.push(['token', x]), onOAuth: (x) => calls.push(['oauth', x]), back: () => calls.push(['back']) });
  const d2 = svc.all().find((e) => e.tag === 'details');
  ok(d2 && !('open' in d2.attrs) && ['tok', 'lab', 'rem', 'go'].every((id) => d2.find(id)) && !d2.find('oauth'), 'a service: the token form folded, its ids inside');
  ok(svc.all().indexOf(svc.find('oauth')) < svc.all().indexOf(d2) && /アカウントを加える/.test(svc.text) && /GitHub App を入れたところから自動/.test(svc.text) && /トークンで入る（最初の設定・サービスが無いとき）/.test(svc.text), svc.text);
  svc.find('oauth-lab').value = 'not a slug'; svc.find('oauth-lab').fire('input'); svc.find('oauth').fire('click');
  eq([calls.length, toasts.at(-1), svc.find('lab').value], [0, 'ラボのリポジトリは owner/名前 で', 'not a slug'], 'a wrong lab: said; the token form\'s lab follows');
  svc.find('oauth-lab').value = 'o/other'; svc.find('oauth-rem').checked = false; svc.find('oauth').fire('click');
  eq(calls.pop(), ['oauth', { remember: false, lab: 'o/other' }]);
  svc.all().find((e) => e.tag === 'button' && e.text === '戻る').fire('click');
  eq(calls.pop(), ['back']);
  ok(/もう一度サインイン/.test(signInCard({ authUrl: AUTH, login: 'author1', lab: 'o/lab' }).text) && /author1 のトークンを入れ直す/.test(signInCard({ login: 'author1', lab: 'o/lab' }).text), 'signing one account in again');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
