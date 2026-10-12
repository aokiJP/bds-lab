// connect: are the secrets the panel's 「🔗 連携」 put in the repository real? Run in GitHub's Actions (connect.yml):
//   node lab.mjs connect check discord|cloudflare|microsoft|google|ai
// Each check reads only its own secrets from the environment, hides them in the run's log first (::add-mask::), asks the
// service itself, and says what it found as one annotation the panel reads (panel/lib/setup.mjs runNotice):
//   ::notice title=connect-<service>::{"ok":true,...}
// What is said is names, ids and yes/no only — never a token, a password, a key or an e-mail address. What the next step
// needs is made here: Discord's invite link of the person's own bot; Google's AAS token from the one-time oauth_token
// (written back as the secrets GOOGLE_AAS_TOKEN / GOOGLE_EMAIL with gh through stdin, the oauth_token's secret removed).
// Each service: a pure part (what the answers mean) and a part that asks, with fetchImpl / run / setSecret given (tests).
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
export const SERVICES = ['discord', 'cloudflare', 'microsoft', 'google', 'ai'];
/** the secrets each check reads (and hides in the log before anything else) */
export const SECRETS = {
  discord: ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID'],
  cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
  microsoft: ['MS_EMAIL', 'MS_PASSWORD'],
  google: ['GOOGLE_OAUTH_TOKEN', 'GOOGLE_AAS_TOKEN', 'GOOGLE_EMAIL'],
  ai: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
};
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const val = (env, k) => String(env[k] ?? '').trim();

// ---- the annotation (pure) ----
/** a result with every secret's value taken out (pure): a value found anywhere in it becomes *** (a bug's last guard) */
export function scrub(result, secrets) {
  const vs = [...new Set(secrets.flatMap((x) => [String(x ?? ''), String(x ?? '').trim()]))].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length);
  const walk = (x) => (typeof x === 'string' ? vs.reduce((s, v) => s.split(v).join('***'), x)
    : Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)])) : x);
  return walk(result);
}
/** the line the panel reads (pure): `::notice title=connect-<service>::<JSON on one line>` (the runner reads %, CR, LF
 *  of the data escaped) */
export function noticeLine(service, result) {
  const data = JSON.stringify(result).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::notice title=connect-${service}::${data}`;
}

// ---- Discord ----
// the invite's permissions: what a DM and the notices need in a server the bot shares with the person (a DM itself needs
// none): View Channels 1<<10 + Send Messages 1<<11 + Attach Files 1<<15 (a screenshot, an .mcaddon)
export const DISCORD_PERMISSIONS = (1 << 10) | (1 << 11) | (1 << 15);
/** the bot's invite link (pure): scope bot only, the permissions above */
export const discordInvite = (appId) => `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${DISCORD_PERMISSIONS}`;
/** DISCORD_USER_ID's form (pure) → 'ok' | 'missing' | 'bad' (a Discord user id: 17 to 20 digits) */
export const discordUserId = (v) => (!v ? 'missing' : /^\d{17,20}$/.test(v) ? 'ok' : 'bad');
/** what Discord said of the bot (GET /users/@me) and its application (GET /oauth2/applications/@me) → the result (pure) */
export function discordResult(me, app, userId) {
  const u = discordUserId(userId);
  if (!me?.bot) return { ok: false, problem: 'そのトークンはボットのものではありません（Developer Portal の Bot → Reset Token の値を）' };
  const r = { ok: u !== 'bad', bot: String(me.username ?? ''), botId: String(me.id ?? ''), appId: String(app?.id ?? me.id ?? ''), invite: discordInvite(String(app?.id ?? me.id)), userId: u };
  if (u === 'bad') r.problem = 'DISCORD_USER_ID は Discord のユーザー ID（数字 17〜20 桁: 設定 → 詳細設定 → 開発者モード → 自分を右クリック → ID をコピー）です';
  r.next = u === 'missing' ? '招待リンクでボットを自分のサーバーに入れ、DISCORD_USER_ID（自分のユーザー ID）を入れてください' : '招待リンクでボットを自分のサーバーに入れてください（DM はそのサーバーの「メンバーからの DM を許可」がオンで届きます）';
  return r;
}
export async function checkDiscord({ env = process.env, fetchImpl = fetch } = {}) {
  const token = val(env, 'DISCORD_BOT_TOKEN');
  if (!token) return { ok: false, missing: ['DISCORD_BOT_TOKEN'], problem: 'DISCORD_BOT_TOKEN がありません' };
  const Dc = await imp('app/lib/discord.mjs');
  const call = Dc.rest({ token, base: env.DISCORD_API_URL || Dc.API, fetchImpl });
  try {
    const me = await call('GET', '/users/@me');
    const app = await call('GET', '/oauth2/applications/@me').catch(() => null);
    return discordResult(me, app, val(env, 'DISCORD_USER_ID'));
  } catch (e) {
    return { ok: false, status: e.status ?? null, problem: e.status === 401 ? 'ボットのトークン（DISCORD_BOT_TOKEN）が違うか、作り直されています' : `Discord に聞けません（${e.status ? `HTTP ${e.status}` : e.cause?.code ?? e.message}）` };
  }
}

// ---- Cloudflare ----
export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
/** what Cloudflare said (pure) → the result. verify: GET /user/tokens/verify (or the account's); account: GET
 *  /accounts/<id>; sub: GET /accounts/<id>/workers/subdomain — each { status, body } */
export function cloudflareResult({ verify, account, sub }) {
  const active = verify?.status === 200 && verify.body?.success !== false && verify.body?.result?.status === 'active';
  if (!active) return { ok: false, token: false, problem: verify?.status === 200 ? `トークンが使えない状態です（${verify.body?.result?.status ?? '不明'}）` : 'CLOUDFLARE_API_TOKEN が違うか、失効しています（My Profile → API Tokens で「Edit Cloudflare Workers」から作り直す）' };
  if (account?.status !== 200 || account.body?.success === false) return { ok: false, token: true, account: false, problem: 'このトークンで CLOUDFLARE_ACCOUNT_ID のアカウントを読めません（ID が別のアカウントのものか、トークンの Account Resources にそのアカウントがありません）' };
  const r = { ok: true, token: true, account: true, accountName: String(account.body?.result?.name ?? '') };
  const name = sub?.status === 200 ? String(sub.body?.result?.subdomain ?? '') : '';
  if (name) { r.subdomain = `${name}.workers.dev`; return r; }
  r.ok = false; r.subdomain = null;
  r.problem = sub?.status === 403 ? 'このトークンでは Workers のサブドメインを読めません（「Edit Cloudflare Workers」のテンプレートで作り直す）'
    : 'workers.dev のサブドメインがまだありません: auth-deploy が落ちます';
  r.next = 'dash.cloudflare.com → Workers & Pages を一度開き、workers.dev のサブドメイン（<名前>.workers.dev）を決めてください';
  return r;
}
export async function checkCloudflare({ env = process.env, fetchImpl = fetch, cfProblem } = {}) {
  const token = val(env, 'CLOUDFLARE_API_TOKEN'), account = val(env, 'CLOUDFLARE_ACCOUNT_ID');
  const missing = [!token && 'CLOUDFLARE_API_TOKEN', !account && 'CLOUDFLARE_ACCOUNT_ID'].filter(Boolean);
  if (missing.length) return { ok: false, missing, problem: `${missing.join('・')} がありません` };
  cfProblem ??= (await imp('panel/lib/setup.mjs')).cfProblem;
  const shape = cfProblem({ token, account });
  if (shape) return { ok: false, problem: shape };
  const base = (env.CLOUDFLARE_API_URL || CLOUDFLARE_API).replace(/\/$/, '');
  const get = async (p) => {
    const r = await fetchImpl(`${base}${p}`, { headers: { authorization: `Bearer ${token}`, 'user-agent': 'bds-lab' }, signal: AbortSignal.timeout(30_000) });
    let body = null; try { body = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, body };
  };
  try {
    // (a user's token, then an account's own token: each has its own verify)
    let verify = await get('/user/tokens/verify');
    if (verify.status !== 200) { const v2 = await get(`/accounts/${account}/tokens/verify`); if (v2.status === 200) verify = v2; }
    if (verify.status !== 200 || verify.body?.result?.status !== 'active') return cloudflareResult({ verify });
    const acc = await get(`/accounts/${account}`);
    if (acc.status !== 200) return cloudflareResult({ verify, account: acc });
    return cloudflareResult({ verify, account: acc, sub: await get(`/accounts/${account}/workers/subdomain`) });
  } catch (e) { return { ok: false, problem: `Cloudflare に聞けません（${e.cause?.code ?? e.message}）` }; }
}

// ---- Microsoft ----
/** MS_EMAIL / MS_PASSWORD's form (pure): a real sign-in is only on the device (app.yml: lib/signin.mjs drives the game's
 *  own page), so this says the form and where it is really tried. The password is never said, only whether there is one */
export function checkMicrosoft({ env = process.env } = {}) {
  const email = val(env, 'MS_EMAIL'), password = String(env.MS_PASSWORD ?? '');
  if (!email) return { ok: false, missing: ['MS_EMAIL'], problem: 'MS_EMAIL がありません' };
  if (!EMAIL_RE.test(email)) return { ok: false, email: false, problem: 'MS_EMAIL がメールアドレスの形ではありません' };
  if (password && /^\s|\s$/.test(password.replace(/[\r\n]+$/, ''))) return { ok: false, email: true, password: true, problem: 'MS_PASSWORD の前後に空白があります（貼るときに入った？）' };
  return { ok: true, email: true, password: Boolean(password), verified: false,
    next: password ? '本当に入れるかは app.yml（端末のゲームのサインイン）で確かめます' : 'MS_PASSWORD がないので、app.yml のサインインでは Authenticator の承認かメールのコードを聞きます' };
}

// ---- Google ----
/** the secrets set with gh through stdin (GH_TOKEN: the App's token or LAB_SECRETS_TOKEN) → { set(name, value), remove(name) }
 *  each → { ok, error? } (an error never carries the value) */
export function ghSecrets({ repo, token, run = spawnSync }) {
  const env = { ...process.env, GH_TOKEN: token };
  const said = (r, v) => (r.status === 0 ? { ok: true } : { ok: false, error: String(r.stderr || r.error?.message || `終了 ${r.status}`).split(v || '\0').join('<値>').trim().slice(0, 200) });
  return {
    set: (name, value) => said(run('gh', ['secret', 'set', name, '--repo', repo], { input: value, encoding: 'utf8', env, timeout: 60_000 }), value),
    remove: (name) => said(run('gh', ['secret', 'delete', name, '--repo', repo], { encoding: 'utf8', env, timeout: 60_000 })),
  };
}
/** GOOGLE_OAUTH_TOKEN (once, from the panel) → an AAS token (apk.mjs exchangeToken: apkeep) → the secrets GOOGLE_AAS_TOKEN
 *  and GOOGLE_EMAIL; the oauth_token's secret removed (used or not: it is one-time). Without it, GOOGLE_AAS_TOKEN's form
 *  (apk.mjs playCredentials). secrets: ghSecrets(); exchange: tests; mask(value): hides a new value in the log */
export async function checkGoogle({ env = process.env, secrets, exchange, mask = () => {}, log = () => {} } = {}) {
  const K = await imp('app/lib/apk.mjs');
  const oauth = val(env, 'GOOGLE_OAUTH_TOKEN'), email = val(env, 'GOOGLE_EMAIL');
  if (oauth) {
    if (!EMAIL_RE.test(email)) return { ok: false, missing: email ? [] : ['GOOGLE_EMAIL'], problem: email ? 'GOOGLE_EMAIL がメールアドレスの形ではありません' : 'GOOGLE_EMAIL がありません（oauth_token と組で要ります）' };
    const repo = env.GITHUB_REPOSITORY, token = env.GH_TOKEN || env.LAB_SECRETS_TOKEN || '';
    // (the secrets must be writable before the one-time value is spent)
    if (!secrets && (!repo || !token)) return { ok: false, problem: '秘密を書けません（App のトークンか LAB_SECRETS_TOKEN と GITHUB_REPOSITORY が要ります）' };
    secrets ??= ghSecrets({ repo, token });
    let aas, problem = null;
    try { aas = await (exchange ?? ((o) => K.exchangeToken({ toolsDir: path.join(TOP, 'tools'), email, oauthToken: o, env, log })))(oauth); } catch (e) { problem = e.message; }
    const removed = secrets.remove('GOOGLE_OAUTH_TOKEN');
    if (problem || !aas) return { ok: false, problem: problem ?? 'AAS トークンを受け取れませんでした', next: 'oauth_token は一度きりで数分で切れます: accounts.google.com でログインし直して新しい値を', oauthRemoved: removed.ok };
    mask(aas);
    const set = [], failed = [];
    for (const [k, v] of [['GOOGLE_AAS_TOKEN', aas], ['GOOGLE_EMAIL', email]]) { const r = secrets.set(k, v); if (r.ok) set.push(k); else failed.push(`${k}: ${String(r.error ?? '').split(aas).join('<値>')}`); }
    return { ok: !failed.length, made: 'GOOGLE_AAS_TOKEN', set, oauthRemoved: removed.ok, ...(failed.length ? { problem: `秘密を書けません: ${failed.join(' / ')}` } : {}) };
  }
  const c = K.playCredentials(env);
  if (!c.email && !c.aasToken) return { ok: false, missing: ['GOOGLE_OAUTH_TOKEN'], problem: 'GOOGLE_OAUTH_TOKEN も GOOGLE_AAS_TOKEN もありません' };
  if (!c.ready) return { ok: false, missing: [!c.email && 'GOOGLE_EMAIL', !c.aasToken && 'GOOGLE_AAS_TOKEN'].filter(Boolean), problem: c.problems.join(' / ') || 'GOOGLE_EMAIL と GOOGLE_AAS_TOKEN は組で要ります' };
  return { ok: true, aas: true, verified: false, next: 'Google Play に実際に入れるかは app.yml（APK を取るところ）で確かめます' };
}

// ---- AI ----
/** the models' list (common/auth.mjs's same calls) → { status, count } */
async function aiModels(kind, key, base, fetchImpl) {
  const r = kind === 'anthropic'
    ? await fetchImpl(`${(base || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models?limit=1000`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) })
    : await fetchImpl(`${(base || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  let body = null; try { body = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, count: Array.isArray(body?.data) ? body.data.length : null };
}
/** one key's answer (pure) → { ok, models } or { ok: false, problem } (as common/auth.mjs: 401/403 = a wrong key) */
export const aiOne = (a) => (a.status === 200 ? { ok: true, models: a.count ?? 0 } : { ok: false, problem: a.status === 401 || a.status === 403 ? '鍵が違います' : `HTTP ${a.status}` });
export async function checkAi({ env = process.env, fetchImpl = fetch } = {}) {
  const a = val(env, 'ANTHROPIC_API_KEY'), o = val(env, 'OPENAI_API_KEY'), ob = val(env, 'OPENAI_BASE_URL');
  if (!a && !o && !ob) return { ok: false, missing: ['ANTHROPIC_API_KEY'], problem: 'ANTHROPIC_API_KEY も OPENAI_API_KEY もありません' };
  const r = { ok: true };
  for (const [kind, key, base] of [['anthropic', a, env.ANTHROPIC_BASE_URL], ['openai', o || (ob ? 'none' : ''), ob]]) {
    if (!key) continue;
    try { r[kind] = aiOne(await aiModels(kind, key, base, fetchImpl)); } catch (e) { r[kind] = { ok: false, problem: `届きません（${e.cause?.code ?? e.message}）` }; }
    r.ok &&= r[kind].ok;
  }
  return r;
}

// ---- the command ----
/** connect check <service>: the check, its secrets hidden first in Actions, the annotation → true when ok. opts: tests */
export async function connectCmd(args = [], { env = process.env, out = console.log, fetchImpl = fetch, ...opts } = {}) {
  const [sub, service] = args;
  if (sub !== 'check' || !SERVICES.includes(service)) { out(`使い方: node lab.mjs connect check <${SERVICES.join('|')}>（GitHub の Actions の connect.yml で。結果は注釈 connect-<service>）`); return false; }
  const secrets = SECRETS[service].map((k) => String(env[k] ?? '')).filter(Boolean);
  const SF = await imp('app/lib/secretform.mjs');
  const inCi = env.GITHUB_ACTIONS === 'true';
  const mask = (v) => { if (inCi) for (const l of SF.maskLines(v)) out(l); };
  secrets.forEach(mask);
  const made = [];
  let result;
  try {
    result = service === 'discord' ? await checkDiscord({ env, fetchImpl })
      : service === 'cloudflare' ? await checkCloudflare({ env, fetchImpl })
        : service === 'microsoft' ? checkMicrosoft({ env })
          : service === 'google' ? await checkGoogle({ env, secrets: opts.secrets, exchange: opts.exchange, mask: (v) => { made.push(v); mask(v); }, log: (s) => out(`  ${s}`) })
            : await checkAi({ env, fetchImpl });
  } catch (e) { result = { ok: false, problem: e.message }; }
  // (what goes out: the service's name first, no secret's value in any part of it)
  result = scrub({ service, ...result }, [...secrets, ...made]);
  out(noticeLine(service, result));
  out(`${result.ok ? 'OK' : 'E'} connect ${service}${result.problem ? `: ${result.problem}` : ''}`);
  return Boolean(result.ok);
}
