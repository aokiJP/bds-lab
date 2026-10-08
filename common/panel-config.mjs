// node common/panel-config.mjs <out>: the management panel as GitHub Pages serves it (pages.yml) — panel/ copied to <out> with
// its config.json (the sign-in service's address and the GitHub App: repository variables LAB_AUTH_URL, APP_SLUG,
// APP_CLIENT_ID) and the page's CSP letting it talk to that one service besides GitHub's API. What the page cannot learn
// before anyone signs in has to be written here: a variable is not readable without a token. The source is never changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const CSP_CONNECT = "connect-src 'self' https://api.github.com";
/** the variables → { config, origin, errors } (pure): an https:// address with no user or password, a slug, a client id */
export function panelConfig(env = {}) {
  const errors = [], u = String(env.LAB_AUTH_URL ?? '').trim();
  let authUrl = null, origin = null;
  if (u) {
    // (the service answers at its root: /login, /callback, /refresh — panel/lib/session.mjs authBase)
    try { const x = new URL(u); if (x.protocol !== 'https:' || x.username || x.password || x.search || x.hash || x.pathname !== '/') throw new Error(); authUrl = x.origin; origin = x.origin; }
    catch { errors.push('LAB_AUTH_URL: https:// のアドレス（その根: パス・利用者・パスワード・? と # なし）'); }
  }
  const slug = String(env.APP_SLUG ?? '').trim(), cid = String(env.APP_CLIENT_ID ?? '').trim();
  if (slug && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) errors.push('APP_SLUG: App の短い名前（英小文字・数字・-）');
  if (cid && !/^[A-Za-z0-9._-]{1,64}$/.test(cid)) errors.push('APP_CLIENT_ID: App の Client ID');
  return { config: { authUrl, appSlug: slug && !errors.some((e) => e.startsWith('APP_SLUG')) ? slug : null, appClientId: cid && !errors.some((e) => e.startsWith('APP_CLIENT_ID')) ? cid : null }, origin, errors };
}
/** the page's HTML with the service's origin allowed to be fetched (pure; the policy otherwise as it is) */
export function withOrigin(html, origin) {
  if (!origin) return html;
  if (!html.includes(CSP_CONNECT)) throw new Error(`index.html の CSP に「${CSP_CONNECT}」がありません`);
  return html.replace(CSP_CONNECT, `${CSP_CONNECT} ${origin}`);
}
/** panel/ → <out>, with config.json and the CSP → { config, errors } */
export function buildPages(out, env = process.env, src = path.join(TOP, 'panel')) {
  const r = panelConfig(env);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(src, out, { recursive: true });
  fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify(r.config, null, 1) + '\n');
  const f = path.join(out, 'index.html');
  fs.writeFileSync(f, withOrigin(fs.readFileSync(f, 'utf8'), r.origin));
  return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.log('usage: node common/panel-config.mjs <out>'); process.exit(1); }
  const r = buildPages(path.resolve(out));
  for (const e of r.errors) console.log(`::warning title=panel config::${e}`);
  console.log(`OK ${out}: サインイン ${r.config.authUrl ?? '（なし: トークンで入る）'}・App ${r.config.appSlug ?? '（なし）'}`);
}
