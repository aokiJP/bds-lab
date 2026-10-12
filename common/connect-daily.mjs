// connect-daily: the panel's 「🔗 連携」 checked again every day in GitHub's Actions (connect.yml on a schedule):
//   node lab.mjs connect-daily [--no-notify]
// Only the services whose secrets are there are asked (common/connect.mjs's own checks: the same questions as 「封じて登録して
// 確かめる」), every secret hidden in the run's log first (::add-mask::). What it found is one annotation the panel reads
// (panel/lib/connectdaily.mjs) — names, yes/no and the words of what is wrong only, never a value:
//   ::notice title=connect-daily::{"ok":false,"at":"…","checked":[…],"bad":[…],"services":{"discord":{"ok":false,…}}}
// and one warning annotation for each that is broken. When one is broken and LAB_NOTIFY_WEBHOOK is there (LAB_NOTIFY not
// 'off'), one message to Discord (common/notify.mjs). Google's one-time oauth_token is never spent here (that is the panel's
// own check): only the AAS token made from it is looked at.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as C from './connect.mjs';
import { notify } from './notify.mjs';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
export const NAMES = { discord: 'Discord', cloudflare: 'Cloudflare', microsoft: 'Microsoft', google: 'Google Play', ai: 'AI' };
const val = (env, k) => String(env[k] ?? '').trim();

/** the services whose secrets are there (pure), in connect.mjs's order (AI: OPENAI_BASE_URL alone is a model server too) */
export const configured = (env = {}) => C.SERVICES.filter((s) => C.SECRETS[s].some((k) => val(env, k)) || (s === 'ai' && val(env, 'OPENAI_BASE_URL')));

/** one check's answer kept small (pure): ok, verified (false: the form only), and the words — what is wrong, the next step —
 *  each one line of at most 200 characters; nothing else of it (an id, an invite) goes into the daily notice */
export function brief(r) {
  const line = (x) => (typeof x === 'string' && x.trim() ? x.replace(/\s+/g, ' ').trim().slice(0, 200) : undefined);
  const ai = ['anthropic', 'openai'].map((k) => r?.[k]?.problem).find(Boolean);
  const o = { ok: r?.ok === true };
  if (r?.verified === false) o.verified = false;
  const problem = line(r?.problem) ?? line(ai), next = line(typeof r?.next === 'string' ? r.next : r?.next?.say);
  if (!o.ok) o.problem = problem ?? '理由は分かりません';
  if (next) o.next = next;
  return o;
}

/** the day's answers → the notice's object (pure). results: { service: brief() }; at: an ISO time */
export function summary(results, at) {
  const checked = C.SERVICES.filter((s) => results[s]), bad = checked.filter((s) => !results[s].ok);
  return { ok: bad.length === 0, at, checked, bad, services: Object.fromEntries(checked.map((s) => [s, results[s]])) };
}

/** the Discord message of a day with something broken (pure) → { title, lines } (names and words only) */
export function message(sum, { runUrl = '' } = {}) {
  const lines = sum.bad.map((s) => `・${NAMES[s]}: ${sum.services[s].problem}${sum.services[s].next ? `（${sum.services[s].next}）` : ''}`);
  lines.push('管理パネルの「🔗 連携」で、値を入れ直して確かめられます。');
  if (/^https:\/\/github\.com\//.test(runUrl)) lines.push(runUrl);
  return { title: `連携の毎日の確認: ${sum.bad.map((s) => NAMES[s]).join('・')} がつながりません`, lines };
}

// (a workflow command's title: % , : CR LF are the runner's own and are written escaped)
const prop = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');
const data = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** one service asked as the panel's check asks it (connect.mjs), without spending Google's one-time value */
async function checkOne(service, { env, fetchImpl }) {
  if (service === 'discord') return C.checkDiscord({ env, fetchImpl });
  if (service === 'cloudflare') return C.checkCloudflare({ env, fetchImpl });
  if (service === 'microsoft') return C.checkMicrosoft({ env });
  if (service === 'ai') return C.checkAi({ env, fetchImpl });
  // (Google: the AAS token's form; an oauth_token still there means the panel's check never made the AAS token)
  if (!val(env, 'GOOGLE_AAS_TOKEN') && val(env, 'GOOGLE_OAUTH_TOKEN')) return { ok: false, problem: 'oauth_token がまだ AAS トークンになっていません（一度きりの値で、数分で切れます）', next: '「🔗 連携」の Google Play で、新しい oauth_token を入れて確かめてください' };
  return C.checkGoogle({ env: { ...env, GOOGLE_OAUTH_TOKEN: '' } });
}

/** connect-daily: the services that are there checked, the notice and a warning for each broken one, Discord told when one is
 *  → true when none is broken (none there: true, said so). opts: env, out, fetchImpl (the services), notifyImpl
 *  (common/notify.mjs notify), now (tests) */
export async function dailyCmd(args = [], { env = process.env, out = console.log, fetchImpl = fetch, notifyImpl = notify, now = () => new Date() } = {}) {
  if (args.some((a) => a !== '--no-notify')) { out('使い方: node lab.mjs connect-daily [--no-notify]（GitHub の Actions の connect.yml で毎日。結果は注釈 connect-daily）'); return false; }
  const inCi = env.GITHUB_ACTIONS === 'true';
  // (every secret of every service, and the webhook's address, hidden before anything is asked)
  const secrets = [...Object.values(C.SECRETS).flat(), 'LAB_NOTIFY_WEBHOOK'].map((k) => String(env[k] ?? '')).filter(Boolean);
  if (inCi) { const SF = await imp('app/lib/secretform.mjs'); for (const v of secrets) for (const l of SF.maskLines(v)) out(l); }
  const services = configured(env), results = {};
  for (const s of services) {
    let r;
    try { r = await checkOne(s, { env, fetchImpl }); } catch (e) { r = { ok: false, problem: `確かめられません（${e.cause?.code ?? e.message}）` }; }
    results[s] = brief(r);
  }
  const sum = C.scrub(summary(results, now().toISOString()), secrets);
  out(C.noticeLine('daily', sum));
  for (const s of sum.bad) out(`::warning title=${prop(`連携の不調 ${NAMES[s]}`)}::${data(sum.services[s].problem)}`);
  if (!services.length) out('OK connect-daily: 連携の秘密がまだ 1 つも入っていません（確かめるものはありません）');
  for (const s of sum.checked) out(`${sum.services[s].ok ? 'OK' : 'E'} connect-daily ${s}${sum.services[s].ok ? '' : `: ${sum.services[s].problem}`}`);
  if (sum.bad.length && !args.includes('--no-notify') && env.LAB_NOTIFY_WEBHOOK && String(env.LAB_NOTIFY ?? '').toLowerCase() !== 'off') {
    const runUrl = env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';
    const m = message(sum, { runUrl });
    const sent = await notifyImpl(m.title, m.lines, { ok: false, url: env.LAB_NOTIFY_WEBHOOK, out });
    out(sent ? 'OK connect-daily: Discord に知らせました' : 'W connect-daily: Discord に知らせられませんでした');
  }
  return sum.ok;
}
