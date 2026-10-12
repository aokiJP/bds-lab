// connect (common/connect.mjs) against fake services on node:http, with no network: Discord (the bot, its application →
// the invite link; a wrong token; DISCORD_USER_ID's form), Cloudflare (a user's and an account's token verified, the
// account read, workers.dev's subdomain there or not), Microsoft (the form only), Google (the one-time oauth_token → an
// AAS token through a fake apkeep, the secrets written and the oauth_token's removed; an AAS token's form), AI (Anthropic
// and OpenAI's models listed, a wrong key). Every check: one `::notice title=connect-<service>::<JSON>` line, the secrets
// hidden first in Actions (::add-mask::), and no secret's value anywhere else in what is printed.
// node tests/connect-offline.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = await import(pathToFileURL(path.join(TOP, 'common', 'connect.mjs')).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ---- the fake services ----
const BOT = 'MTFAKE.bot-token.0123456789abcdefghij', CF = 'cf-token-0123456789abcdefghijKLMN', ACC = '0123456789abcdef0123456789abcdef';
const ANT = 'sk-ant-fake-0123456789', OAI = 'sk-oai-fake-0123456789';
const st = { seen: [], cfSub: 'mysub', cfAccountToken: false };
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://fake'), h = req.headers;
  st.seen.push({ method: req.method, path: u.pathname + u.search, headers: h });
  const send = (status, j) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  // Discord
  if (u.pathname.startsWith('/discord/')) {
    if (h.authorization !== `Bot ${BOT}`) return send(401, { message: '401: Unauthorized', code: 0 });
    if (u.pathname === '/discord/users/@me') return send(200, { id: '1111111111111111111', username: 'lab-bot', bot: true });
    if (u.pathname === '/discord/oauth2/applications/@me') return send(200, { id: '2222222222222222222', name: 'lab-app' });
    return send(404, { code: 0 });
  }
  // Cloudflare
  if (u.pathname.startsWith('/cf/')) {
    const good = h.authorization === `Bearer ${CF}`;
    if (u.pathname === '/cf/user/tokens/verify') return good && !st.cfAccountToken ? send(200, { success: true, result: { id: 'x', status: 'active' } }) : send(401, { success: false, errors: [{ code: 1000 }] });
    if (u.pathname === `/cf/accounts/${ACC}/tokens/verify`) return good && st.cfAccountToken ? send(200, { success: true, result: { id: 'y', status: 'active' } }) : send(401, { success: false });
    if (!good) return send(403, { success: false });
    if (u.pathname === `/cf/accounts/${ACC}`) return send(200, { success: true, result: { id: ACC, name: 'Lab Account' } });
    if (u.pathname === `/cf/accounts/${ACC}/workers/subdomain`) return st.cfSub ? send(200, { success: true, result: { subdomain: st.cfSub } }) : send(404, { success: false, errors: [{ code: 10007 }] });
    return send(404, { success: false });
  }
  // Anthropic / OpenAI
  if (u.pathname === '/ant/v1/models') return h['x-api-key'] === ANT && h['anthropic-version'] ? send(200, { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], has_more: false }) : send(401, { type: 'error' });
  if (u.pathname === '/oai/models') return h.authorization === `Bearer ${OAI}` ? send(200, { object: 'list', data: [{ id: 'g1' }, { id: 'g2' }] }) : send(401, { error: {} });
  send(404, {});
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${fake.address().port}`;
const baseEnv = { DISCORD_API_URL: `${BASE}/discord`, CLOUDFLARE_API_URL: `${BASE}/cf`, ANTHROPIC_BASE_URL: `${BASE}/ant`, GITHUB_ACTIONS: 'true' };
/** connect check <service> with env → { ok, lines, notice (parsed), text } */
async function run(service, env, opts = {}) {
  const lines = [];
  const r = await C.connectCmd(['check', service], { env: { ...baseEnv, ...env }, out: (s) => lines.push(String(s)), ...opts });
  const n = lines.filter((l) => l.startsWith(`::notice title=connect-${service}::`));
  eq(n.length, 1, 'one notice');
  const notice = JSON.parse(n[0].slice(`::notice title=connect-${service}::`.length).replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%25/g, '%'));
  eq(notice.ok, r, 'the notice and the exit agree');
  eq(notice.service, service);
  return { ok: r, lines, notice, text: lines.join('\n') };
}
/** no secret's value in what is printed, but in its ::add-mask:: line (which hides it) */
const noLeak = (text, secrets) => {
  const shown = text.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n');
  for (const s of secrets) ok(!shown.includes(s), `a secret is printed: …${s.slice(-4)}`);
};
const masked = (text, s) => ok(text.split('\n').includes(`::add-mask::${s}`), `not masked: …${s.slice(-4)}`);

// ---- pure ----
await t('noticeLine: one line, % escaped (the runner reads it unescaped)', async () => {
  const l = C.noticeLine('ai', { ok: true, problem: 'a%b\nc' });
  ok(!/\n/.test(l), 'one line'); ok(l.startsWith('::notice title=connect-ai::{'), l); ok(l.includes('a%25b\\nc'), l);
  eq(C.noticeLine('ai', { ok: true }), '::notice title=connect-ai::{"ok":true}');
});
await t('scrub: a value in any string becomes ***, keys and booleans untouched', async () => {
  // (a string that held a secret is replaced whole: no *** in a sentence telling where the secret was, or how long)
  const H = '（秘密が含まれていたので伏せました）';
  eq(C.scrub({ ok: true, a: 'x secretvalue y', b: ['secretvalue'], c: { d: 'true' }, e: 'clean' }, ['secretvalue', 'true']), { ok: true, a: H, b: [H], c: { d: H }, e: 'clean' });
});
await t('discord: invite link (scope bot, View Channels + Send Messages + Attach Files)', async () => {
  eq(C.discordInvite('123'), 'https://discord.com/oauth2/authorize?client_id=123&scope=bot&permissions=35840');
  eq(['', '12345678901234567', '12345678901234567890', '1234567890123456', '123456789012345678901', '1234567890123456x'].map(C.discordUserId), ['missing', 'ok', 'ok', 'bad', 'bad', 'bad']);
  eq(C.discordResult({ id: '1', username: 'u' }, null, '').ok, false, 'not a bot');
});
await t('cloudflare: result from the answers', async () => {
  const v = { status: 200, body: { success: true, result: { status: 'active' } } }, a = { status: 200, body: { success: true, result: { name: 'N' } } };
  eq(C.cloudflareResult({ verify: v, account: a, sub: { status: 200, body: { result: { subdomain: 's' } } } }), { ok: true, token: true, account: true, accountName: 'N', subdomain: 's.workers.dev' });
  eq(C.cloudflareResult({ verify: { status: 200, body: { success: true, result: { status: 'disabled' } } } }).ok, false);
  ok(/Workers のサブドメインを読めません/.test(C.cloudflareResult({ verify: v, account: a, sub: { status: 403, body: null } }).problem), '403');
});

// ---- discord ----
await t('discord: the bot read, the invite link made, the user id checked, the token masked and never printed', async () => {
  const r = await run('discord', { DISCORD_BOT_TOKEN: BOT, DISCORD_USER_ID: '333333333333333333' });
  eq(r.ok, true); eq(r.notice.bot, 'lab-bot'); eq(r.notice.appId, '2222222222222222222'); eq(r.notice.userId, 'ok');
  eq(r.notice.invite, 'https://discord.com/oauth2/authorize?client_id=2222222222222222222&scope=bot&permissions=35840');
  masked(r.text, BOT); noLeak(r.text, [BOT]);
  ok(st.seen.some((s) => s.path === '/discord/users/@me' && /^DiscordBot /.test(s.headers['user-agent'])), 'Discord REST as app/lib/discord.mjs');
});
await t('discord: no user id → ok with the next step; a wrong one → not ok', async () => {
  const a = await run('discord', { DISCORD_BOT_TOKEN: BOT });
  eq([a.ok, a.notice.userId], [true, 'missing']); ok(/DISCORD_USER_ID/.test(a.notice.next), a.notice.next);
  const b = await run('discord', { DISCORD_BOT_TOKEN: BOT, DISCORD_USER_ID: '12ab' });
  eq([b.ok, b.notice.userId], [false, 'bad']);
});
await t('discord: a wrong token (401) and none', async () => {
  const a = await run('discord', { DISCORD_BOT_TOKEN: 'wrong-token-xyz-0000' });
  eq([a.ok, a.notice.status], [false, 401]); ok(/DISCORD_BOT_TOKEN/.test(a.notice.problem), a.notice.problem); noLeak(a.text, ['wrong-token-xyz-0000']);
  const b = await run('discord', {});
  eq([b.ok, b.notice.missing], [false, ['DISCORD_BOT_TOKEN']]);
});

// ---- cloudflare ----
await t('cloudflare: user token verified, account read, subdomain there', async () => {
  st.cfSub = 'mysub'; st.cfAccountToken = false;
  const r = await run('cloudflare', { CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: ACC });
  eq(r.ok, true); eq(r.notice.subdomain, 'mysub.workers.dev'); eq(r.notice.accountName, 'Lab Account');
  masked(r.text, CF); noLeak(r.text, [CF]);
});
await t('cloudflare: an account-owned token verified by the account\'s verify', async () => {
  st.cfAccountToken = true;
  const r = await run('cloudflare', { CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: ACC });
  st.cfAccountToken = false;
  eq(r.ok, true);
});
await t('cloudflare: no workers.dev subdomain → not ok, with where to make it', async () => {
  st.cfSub = null;
  const r = await run('cloudflare', { CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: ACC });
  st.cfSub = 'mysub';
  eq([r.ok, r.notice.token, r.notice.account, r.notice.subdomain], [false, true, true, null]);
  ok(/auth-deploy/.test(r.notice.problem) && /dash\.cloudflare\.com/.test(r.notice.next), JSON.stringify(r.notice));
});
await t('cloudflare: a wrong token, another account, a bad account id, none', async () => {
  const a = await run('cloudflare', { CLOUDFLARE_API_TOKEN: 'x'.repeat(40), CLOUDFLARE_ACCOUNT_ID: ACC });
  eq([a.ok, a.notice.token], [false, false]);
  const b = await run('cloudflare', { CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: 'f'.repeat(32) });
  eq([b.ok, b.notice.token, b.notice.account], [false, true, false]);
  const c = await run('cloudflare', { CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: 'nothex' });
  ok(!c.ok && /32 文字/.test(c.notice.problem), c.notice.problem);
  const d = await run('cloudflare', {});
  eq(d.notice.missing, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
});

// ---- microsoft ----
await t('microsoft: the form only, the password never said', async () => {
  const pw = 'P@ssw0rd-very-secret';
  const a = await run('microsoft', { MS_EMAIL: 'me@example.com', MS_PASSWORD: pw });
  eq([a.ok, a.notice.email, a.notice.password, a.notice.verified], [true, true, true, false]); ok(/app\.yml/.test(a.notice.next), a.notice.next);
  masked(a.text, pw); masked(a.text, 'me@example.com'); noLeak(a.text, [pw, 'me@example.com']);
  const b = await run('microsoft', { MS_EMAIL: 'me@example.com' });
  eq([b.ok, b.notice.password], [true, false]);
  eq((await run('microsoft', { MS_EMAIL: 'not-an-email', MS_PASSWORD: pw })).ok, false);
  eq((await run('microsoft', {})).notice.missing, ['MS_EMAIL']);
  eq((await run('microsoft', { MS_EMAIL: 'me@example.com', MS_PASSWORD: ' spaced ' })).ok, false);
});

// ---- google ----
const OAUTH = 'oauth2_4/FAKE-one-time-0123456789', AAS = 'aas_et/FAKE-aas-token-0123456789abcdefghijklmnop', EMAIL = 'player@gmail.com';
const fakeSecrets = (fails = []) => { const s = { set: {}, removed: [] }; s.api = { set: (k, v) => (fails.includes(k) ? { ok: false, error: `denied ${v}` } : ((s.set[k] = v), { ok: true })), remove: (k) => { s.removed.push(k); return { ok: true }; } }; return s; };
await t('google: oauth_token → AAS token through apkeep (apk.mjs exchangeToken), secrets written, oauth_token removed', async () => {
  // (a fake apkeep: the binary found by APKEEP_BIN, its run answered as apkeep does)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-')), bin = path.join(dir, 'apkeep');
  fs.writeFileSync(bin, '#!/bin/sh\n'); fs.chmodSync(bin, 0o755);
  const K = await import(pathToFileURL(path.join(TOP, 'app', 'lib', 'apk.mjs')).href);
  let argv = null;
  const exchange = (o) => K.exchangeToken({ toolsDir: dir, email: EMAIL, oauthToken: o, env: { APKEEP_BIN: bin }, log: () => {}, run: (b, a) => { argv = [b, ...a]; return { status: 0, stdout: `AAS Token: ${AAS}\n`, stderr: '' }; } });
  const s = fakeSecrets();
  const r = await run('google', { GOOGLE_OAUTH_TOKEN: OAUTH, GOOGLE_EMAIL: EMAIL }, { secrets: s.api, exchange });
  eq(r.ok, true); eq(r.notice.set, ['GOOGLE_EMAIL', 'GOOGLE_AAS_TOKEN']); eq(r.notice.oauthRemoved, true);
  eq(s.set, { GOOGLE_EMAIL: EMAIL, GOOGLE_AAS_TOKEN: AAS }); eq(s.removed, ['GOOGLE_OAUTH_TOKEN']);
  eq(argv, [bin, '-e', EMAIL, '--oauth-token', OAUTH]);
  masked(r.text, OAUTH); masked(r.text, AAS); noLeak(r.text, [OAUTH, AAS, EMAIL]);
  ok(r.text.indexOf(`::add-mask::${AAS}`) < r.text.indexOf('::notice'), 'the AAS token masked before the notice');
  fs.rmSync(dir, { recursive: true, force: true });
});
await t('google: exchange fails → not ok, the one-time oauth_token (spent) removed, no AAS token set', async () => {
  const s = fakeSecrets();
  const r = await run('google', { GOOGLE_OAUTH_TOKEN: OAUTH, GOOGLE_EMAIL: EMAIL }, { secrets: s.api, exchange: async () => { throw new Error('AAS トークンを受け取れませんでした'); } });
  eq([r.ok, r.notice.oauthRemoved], [false, true]); eq(s.set, { GOOGLE_EMAIL: EMAIL }); eq(s.removed, ['GOOGLE_OAUTH_TOKEN']); ok(/accounts\.google\.com/.test(r.notice.next), r.notice.next);
});
await t('google: a secret that cannot be written → not ok, its value never said', async () => {
  const s = fakeSecrets(['GOOGLE_AAS_TOKEN']);
  const r = await run('google', { GOOGLE_OAUTH_TOKEN: OAUTH, GOOGLE_EMAIL: EMAIL }, { secrets: s.api, exchange: async () => AAS });
  eq([r.ok, r.notice.set], [false, ['GOOGLE_EMAIL']]); noLeak(r.text, [AAS, OAUTH]);
  eq(s.removed, [], 'the AAS token not kept: the one-time value is not removed either (to be tried again, not lost)');
});
await t('google: the secrets cannot be written at all → the oauth_token is not spent', async () => {
  let spent = false;
  const s = fakeSecrets(['GOOGLE_EMAIL']);
  const r = await run('google', { GOOGLE_OAUTH_TOKEN: OAUTH, GOOGLE_EMAIL: EMAIL }, { secrets: s.api, exchange: async () => { spent = true; return AAS; } });
  ok(!r.ok && /まだ使っていません/.test(r.notice.problem), r.notice.problem); eq([spent, s.removed], [false, []]); noLeak(r.text, [OAUTH]);
});
await t('ghSecrets: a value goes to gh through stdin, never its command line; an error never says the value', () => {
  const calls = [];
  const fake = (cmd, args, o) => { calls.push({ cmd, args, input: o.input, token: o.env.GH_TOKEN }); return args[1] === 'set' && args[2] === 'BAD' ? { status: 1, stderr: `could not set ${o.input}` } : { status: 0 }; };
  const g = C.ghSecrets({ repo: 'o/lab', token: 'ghs_x', run: fake });
  eq(g.set('GOOGLE_AAS_TOKEN', AAS), { ok: true });
  eq([calls[0].cmd, calls[0].args, calls[0].input, calls[0].token], ['gh', ['secret', 'set', 'GOOGLE_AAS_TOKEN', '--repo', 'o/lab'], AAS, 'ghs_x']);
  ok(!calls[0].args.join(' ').includes(AAS), 'not on the command line');
  const bad = g.set('BAD', AAS);
  ok(!bad.ok && !bad.error.includes(AAS) && /<値>/.test(bad.error), bad.error);
  eq(g.remove('GOOGLE_OAUTH_TOKEN'), { ok: true }); eq(calls.at(-1).args, ['secret', 'delete', 'GOOGLE_OAUTH_TOKEN', '--repo', 'o/lab']);
});
await t('google: no email with the oauth_token, no way to write secrets → the oauth_token is not spent', async () => {
  let spent = false;
  const a = await run('google', { GOOGLE_OAUTH_TOKEN: OAUTH }, { exchange: async () => { spent = true; return AAS; } });
  eq([a.ok, a.notice.missing], [false, ['GOOGLE_EMAIL']]);
  const b = await run('google', { GOOGLE_OAUTH_TOKEN: OAUTH, GOOGLE_EMAIL: EMAIL }, { exchange: async () => { spent = true; return AAS; } });
  ok(!b.ok && /LAB_SECRETS_TOKEN/.test(b.notice.problem), b.notice.problem); eq(spent, false, 'spent');
});
await t('google: an AAS token already there → its form (apk.mjs playCredentials)', async () => {
  const a = await run('google', { GOOGLE_AAS_TOKEN: AAS, GOOGLE_EMAIL: EMAIL });
  eq([a.ok, a.notice.aas], [true, true]); noLeak(a.text, [AAS, EMAIL]);
  const b = await run('google', { GOOGLE_AAS_TOKEN: OAUTH, GOOGLE_EMAIL: EMAIL });
  ok(!b.ok && /oauth_token/.test(b.notice.problem), b.notice.problem); noLeak(b.text, [OAUTH]);
  eq((await run('google', { GOOGLE_AAS_TOKEN: AAS })).notice.missing, ['GOOGLE_EMAIL']);
  eq((await run('google', {})).notice.missing, ['GOOGLE_OAUTH_TOKEN']);
});

// ---- ai ----
await t('ai: Anthropic and OpenAI keys checked (common/auth.mjs\'s calls), the models counted', async () => {
  const r = await run('ai', { ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: OAI, OPENAI_BASE_URL: `${BASE}/oai` });
  eq(r.ok, true); eq(r.notice.anthropic, { ok: true, models: 3 }); eq(r.notice.openai, { ok: true, models: 2 });
  masked(r.text, ANT); masked(r.text, OAI); noLeak(r.text, [ANT, OAI]);
});
await t('ai: a wrong key → not ok (鍵が違います); none → missing', async () => {
  const r = await run('ai', { ANTHROPIC_API_KEY: 'sk-ant-wrong-000000' });
  eq([r.ok, r.notice.anthropic], [false, { ok: false, problem: '鍵が違います' }]);
  const b = await run('ai', { ANTHROPIC_API_KEY: ANT, OPENAI_API_KEY: 'sk-wrong-11111111', OPENAI_BASE_URL: `${BASE}/oai` });
  eq([b.ok, b.notice.anthropic.ok, b.notice.openai.ok], [false, true, false]);
  eq((await run('ai', {})).ok, false);
});

// ---- the command ----
await t('usage: an unknown service or no check → false, no notice', async () => {
  for (const a of [['check', 'nope'], ['nope'], []]) { const lines = []; eq(await C.connectCmd(a, { env: {}, out: (s) => lines.push(s) }), false); ok(!lines.some((l) => l.startsWith('::notice')), 'no notice'); }
});
await t('outside Actions: no ::add-mask:: lines (nothing to hide from)', async () => {
  const lines = [];
  await C.connectCmd(['check', 'microsoft'], { env: { MS_EMAIL: 'me@example.com' }, out: (s) => lines.push(s) });
  ok(!lines.some((l) => l.startsWith('::add-mask::')), lines.join('\n'));
});

fake.close();
console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
