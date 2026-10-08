// node lab.mjs ghapp token <owner/repo> [--perm <name>=read|write ...] [--env <NAME>]: a short-lived token of the lab's own
// GitHub App (variable APP_ID, secret APP_PRIVATE_KEY: the management panel's 「準備」 makes both) for one repository
// where the App is installed — the lab itself, or a lender's host whose owner installed it. hostrun.yml and secrets.yml use it
// in place of a person's long-lived token (LAB_HOST_TOKEN, LAB_SECRETS_TOKEN): an hour at most, that repository only, only the
// permissions asked for. The token is masked in the log (::add-mask::) and written to $GITHUB_ENV under <NAME> — never printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const PERM = /^[a-z_]+=(read|write)$/;
const b64url = (b) => Buffer.from(b).toString('base64url');
/** the App's JWT (RS256; issued a minute back for a clock that runs fast, 9 minutes: GitHub takes 10 at most) */
export function appJwt(appId, pem, now = Date.now()) {
  if (!/^\d+$/.test(String(appId ?? ''))) throw new Error('APP_ID は数字です（App の番号: 変数 APP_ID）');
  const iat = Math.floor(now / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), body = b64url(JSON.stringify({ iat, exp: iat + 540, iss: String(appId) }));
  let sig;
  try { sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(String(pem).replace(/\\n/g, '\n')); } catch { throw new Error('APP_PRIVATE_KEY が App の秘密鍵（PEM）として読めません'); }
  return `${head}.${body}.${b64url(sig)}`;
}
/** → { token, expiresAt, permissions } for that one repository: the App's installation there, then a token narrowed to it */
export async function installationToken({ appId, pem, repo, permissions = null, api = 'https://api.github.com', fetchImpl = fetch, now = Date.now() }) {
  if (!SLUG.test(String(repo ?? ''))) throw new Error(`${repo} は owner/repo ではありません`);
  const jwt = appJwt(appId, pem, now);
  const call = async (method, p, body) => {
    const r = await fetchImpl(`${api}${p}`, { method, headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`GitHub: ${method} ${p.split('?')[0]}: HTTP ${r.status}${j.message ? ` ${String(j.message).slice(0, 160)}` : ''}`), { status: r.status });
    return j;
  };
  let inst;
  try { inst = await call('GET', `/repos/${repo}/installation`); }
  catch (e) { if (e.status === 404) throw new Error(`${repo} に App が入っていません: 持ち主に App を入れてもらう（管理パネルの「準備」のリンク）`); throw e; }
  const t = await call('POST', `/app/installations/${inst.id}/access_tokens`, { repositories: [repo.split('/')[1]], ...(permissions ? { permissions } : {}) });
  if (!t.token) throw new Error('GitHub がトークンを返しませんでした');
  return { token: t.token, expiresAt: t.expires_at ?? null, permissions: t.permissions ?? null };
}
export async function ghappCmd(args, out = console.log) {
  const a = [...args], sub = a.shift();
  if (sub !== 'token') { out('usage: node lab.mjs ghapp token <owner/repo> [--perm <name>=read|write ...] [--env <NAME>]   （ワークフローの中で: 変数 APP_ID・秘密 APP_PRIVATE_KEY）'); return sub === 'help' || sub === '--help'; }
  const repo = a.shift(), perms = {}, E = process.env;
  let env = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--perm' && PERM.test(String(a[i + 1]))) { const [k, v] = a[++i].split('='); perms[k] = v; }
    else if (a[i] === '--env' && /^[A-Z_][A-Z0-9_]*$/.test(String(a[i + 1]))) env = a[++i];
    else { out(`ERR ghapp token: 知らない引数 ${a[i]}`); return false; }
  }
  if (!E.APP_ID || !E.APP_PRIVATE_KEY) { out('ERR ghapp token: 変数 APP_ID と秘密 APP_PRIVATE_KEY が要ります（管理パネルの「準備」で App を作ると入ります）'); return false; }
  if (!env || !E.GITHUB_ENV) { out('ERR ghapp token: --env <NAME> と GITHUB_ENV（ワークフローの中）が要ります: トークンは出力に出しません'); return false; }
  try {
    const t = await installationToken({ appId: E.APP_ID, pem: E.APP_PRIVATE_KEY, repo, permissions: Object.keys(perms).length ? perms : null, api: E.GITHUB_API_URL || 'https://api.github.com' });
    out(`::add-mask::${t.token}`);
    fs.appendFileSync(E.GITHUB_ENV, `${env}=${t.token}\n`);
    out(`OK ${repo} の App のトークンを ${env} に（${t.expiresAt ?? '1 時間'} まで・${Object.entries(t.permissions ?? perms).map(([k, v]) => `${k}:${v}`).join(' ') || '既定の権限'}）`);
    return true;
  } catch (e) { out(`ERR ghapp token: ${String(e.message).split('\n')[0]}`); return false; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit((await ghappCmd(process.argv.slice(2))) ? 0 : 1);
