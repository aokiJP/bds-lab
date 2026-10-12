// connect (the 「連携」 tab's pure part): the services the lab can be tied to — what each is for, the official page where the
// person does the part only they can (log in, agree, make a token), the secrets it keeps and the shape each value must have
// before it is sent — how connected each is (from the lab's secret names and what a check said), and the check's answer
// (connect.yml's notice `connect-<service>`, one line of JSON: names, ids and yes/no only — never a value) read for the screen.
// Nothing here touches the network; the run is waited for with the api handed in.
import { runNotice } from './setup.mjs';
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** the only places the panel opens outside itself: GitHub and the services' own pages (the page's links; nothing is fetched) */
export const LINK_HOSTS = Object.freeze(['github.com', 'discord.com', 'dash.cloudflare.com', 'accounts.google.com', 'account.microsoft.com', 'console.anthropic.com', 'platform.openai.com']);
/** an address that may be opened from here: https, one of LINK_HOSTS, no login in it */
export function safeLink(u) {
  try { const x = new URL(String(u ?? '')); return x.protocol === 'https:' && !x.username && !x.password && LINK_HOSTS.includes(x.hostname) ? x.href : null; } catch { return null; }
}
const bare = (v) => !/\s/.test(v);
/** the services, in the order 「全部つなぐ」 goes. A field's check(value) says what is wrong with the shape (words that never
 *  repeat the value) or null; optional: may stay empty (a service needs at least one value or one already kept) */
export const SERVICES = Object.freeze([
  { key: 'discord', name: 'Discord', why: '作ったものや失敗を、Discord に知らせてもらいます（ボットが投稿します）。',
    secrets: ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID'],
    steps: [
      { say: 'Discord の開発者の画面で「New Application」を作り、左の「Bot」→「Reset Token」で出る長い文字列を写します。', link: 'https://discord.com/developers/applications' },
      { say: 'Discord の設定「詳細設定」で「開発者モード」をオンにし、自分の名前を右クリック →「ユーザー ID をコピー」。' }],
    fields: [
      { name: 'DISCORD_BOT_TOKEN', label: 'ボットのトークン', secret: true, check: (v) => (/^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/.test(v) ? null : 'ボットのトークンの形が違います（点で 3 つに分かれた長い文字列）') },
      { name: 'DISCORD_USER_ID', label: 'あなたのユーザー ID', secret: false, check: (v) => (/^\d{17,20}$/.test(v) ? null : 'ユーザー ID は 17〜20 桁の数字です') }] },
  { key: 'cloudflare', name: 'Cloudflare', why: '「GitHub でサインイン」のサービスを無料で置くのに使います。',
    secrets: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
    steps: [
      { say: 'Cloudflare にログインし（なければ「Sign up with GitHub」）、右上の人の形 →「My Profile」→「API Tokens」→「Create Token」→ テンプレート「Edit Cloudflare Workers」で作ります。', link: 'https://dash.cloudflare.com/profile/api-tokens' },
      { say: '「Workers & Pages」の画面の右側にある「Account ID」（32 文字）を写します。', link: 'https://dash.cloudflare.com/' }],
    fields: [
      { name: 'CLOUDFLARE_API_TOKEN', label: 'API トークン', secret: true, check: (v) => (bare(v) && v.length >= 20 ? null : 'API トークンの形が違います（空白のない長い文字列）') },
      { name: 'CLOUDFLARE_ACCOUNT_ID', label: 'アカウント ID', secret: false, check: (v) => (/^[0-9a-f]{32}$/i.test(v) ? null : 'アカウント ID は 32 文字の 16 進数です') }] },
  { key: 'microsoft', name: 'Microsoft', why: 'Microsoft ストアへ出す（Xbox 向けの）手続きに使います。',
    secrets: ['MS_EMAIL', 'MS_PASSWORD'],
    steps: [{ say: '出す先のパートナーセンターに入れる Microsoft アカウントを確かめます。二段階認証がある場合は、確かめの途中で Microsoft が本人確認を求めます（それはあなたが押します）。', link: 'https://account.microsoft.com/' }],
    fields: [
      { name: 'MS_EMAIL', label: 'Microsoft アカウントのメール', secret: false, check: (v) => (EMAIL.test(v) ? null : 'メールアドレスの形が違います') },
      { name: 'MS_PASSWORD', label: 'パスワード', secret: true, check: (v) => (v && !/[\r\n]/.test(v) ? null : 'パスワードが空か、改行が入っています') }] },
  { key: 'google', name: 'Google Play', why: 'Google Play へ出すための鍵を、CI がこの 2 つから作ります（トークンは 1 回だけ使えます）。',
    secrets: ['GOOGLE_EMAIL', 'GOOGLE_OAUTH_TOKEN'],
    steps: [
      { say: 'ブラウザで下の画面を開き、Google にログインして「同意する」まで進めます（画面は真っ白でよい）。', link: 'https://accounts.google.com/EmbeddedSetup' },
      { say: '開発者ツール（F12）→「アプリケーション」→ Cookie → accounts.google.com の「oauth_token」の値（oauth2_4/ で始まる）を写します。' }],
    fields: [
      { name: 'GOOGLE_EMAIL', label: 'Google アカウントのメール', secret: false, check: (v) => (EMAIL.test(v) ? null : 'メールアドレスの形が違います') },
      { name: 'GOOGLE_OAUTH_TOKEN', label: 'oauth_token', secret: true, check: (v) => (/^oauth2_4\/\S{10,}$/.test(v) ? null : 'oauth_token は oauth2_4/ で始まる長い文字列です') }] },
  { key: 'ai', name: 'AI', why: 'アドオンを AI に作らせる・直させるのに使います（どちらか 1 つでよい）。',
    secrets: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
    steps: [
      { say: 'Claude を使うなら、Anthropic の画面で「Create Key」。', link: 'https://console.anthropic.com/settings/keys' },
      { say: 'OpenAI を使うなら、OpenAI の画面で「Create new secret key」。', link: 'https://platform.openai.com/api-keys' }],
    fields: [
      { name: 'ANTHROPIC_API_KEY', label: 'Anthropic の API キー', secret: true, optional: true, check: (v) => (/^sk-ant-\S{20,}$/.test(v) ? null : 'Anthropic のキーは sk-ant- で始まります') },
      { name: 'OPENAI_API_KEY', label: 'OpenAI の API キー', secret: true, optional: true, check: (v) => (/^sk-\S{20,}$/.test(v) ? null : 'OpenAI のキーは sk- で始まります') }] },
]);
export const serviceOf = (key) => SERVICES.find((s) => s.key === key) ?? null;

/** the values as typed → { name: problem } for what is wrong (empty object: send). A kept secret may stay empty; an empty
 *  optional field is not sent; a service needs at least one value or one kept (kept: the secret names already there) */
export function problems(svc, values = {}, kept = []) {
  const out = {};
  for (const f of svc.fields) {
    const v = String(values[f.name] ?? '').trim();
    if (!v) { if (!f.optional && !kept.includes(f.name)) out[f.name] = `「${f.label}」が空です`; continue; }
    const p = f.check(v); if (p) out[f.name] = p;
  }
  if (!Object.keys(out).length && svc.fields.every((f) => !String(values[f.name] ?? '').trim()) && !svc.secrets.some((n) => kept.includes(n))) out[svc.fields[0].name] = '1 つは入れてください';
  return out;
}
/** how each service is tied (pure). secrets: the lab's secret names; checked: { key: parseResult's answer } of checks made
 *  in this visit → [{ key, state: 'ok' | 'bad' | 'unchecked' | 'missing', missing, result }]: ok only after a check said so */
export function status(secrets, checked = {}) {
  const have = new Set(secrets ?? []);
  return SERVICES.map((s) => {
    const required = s.fields.filter((f) => !f.optional).map((f) => f.name), anyOf = s.fields.some((f) => f.optional) ? s.fields.map((f) => f.name) : [];
    const missing = required.filter((n) => !have.has(n)), r = checked[s.key] ?? null;
    const there = missing.length === 0 && (!anyOf.length || anyOf.some((n) => have.has(n)));
    if (!there) return { key: s.key, state: 'missing', missing: anyOf.length && !required.length ? anyOf : missing, result: r };
    return { key: s.key, state: r ? (r.ok ? 'ok' : 'bad') : 'unchecked', missing: [], result: r };
  });
}
/** a notice's message (one line of JSON: { ok, who?, id?, why?, next?: { say, url? } }) → { ok, text, next: { say, url }|null }.
 *  Only names and yes/no are shown; a link is kept only if safeLink allows it; anything else is said as not understood */
export function parseResult(msg) {
  let j = null; try { j = JSON.parse(String(msg ?? '')); } catch { /* not JSON */ }
  if (!j || typeof j !== 'object' || typeof j.ok !== 'boolean') return { ok: false, text: '確かめの答えを読めません（実行の記録を GitHub で見てください）', next: null };
  const who = [j.who, j.id].filter((x) => x !== undefined && x !== null && x !== '').map((x) => String(x).slice(0, 80)).join('・');
  const text = j.ok ? `つながりました${who ? `（${who}）` : ''}` : `つながりません: ${String(j.why ?? '理由は分かりません').slice(0, 200)}`;
  const n = j.next && typeof j.next === 'object' ? { say: String(j.next.say ?? '').slice(0, 200), url: safeLink(j.next.url) } : null;
  return { ok: j.ok, text, next: n && (n.say || n.url) ? n : null };
}
const sleeper = (ms) => new Promise((r) => setTimeout(r, ms));
/** connect.yml started for one service and waited for (as setup's deployAuth waits for its own run: the new run started by
 *  hand on this branch by this person), its notice `connect-<key>` read → parseResult's answer. A run that failed after
 *  leaving its notice still gives the notice (the reason); with none, an error saying so. sleep / every / timeoutMs: tests */
export async function runCheck(api, slug, key, { ref = 'main', me, sleep = sleeper, every = 8_000, timeoutMs = 10 * 60_000, onStep = () => {} } = {}) {
  if (!serviceOf(key)) throw new Error(`知らないサービス: ${key}`);
  if (!LOGIN.test(String(me ?? ''))) throw new Error('始める人（GitHub のログイン名）が分かりません: サインインし直してください');
  const WF = 'connect.yml', before = new Set((await api.runs(slug, { workflow: WF, per: 20 })).map((r) => r.id)), who = String(me).toLowerCase();
  const mine = (r) => !before.has(r.id) && r.event === 'workflow_dispatch' && r.head_branch === ref && [r.actor?.login, r.triggering_actor?.login].some((l) => String(l ?? '').toLowerCase() === who);
  await api.dispatch(slug, WF, ref, { service: key });
  onStep('確かめを始めました: 終わるのを待っています');
  let run = null;
  for (let waited = 0; run?.status !== 'completed'; waited += every) {
    if (waited > timeoutMs) throw new Error('connect.yml が時間内に終わりません（「進み具合」で見てください）');
    await sleep(every);
    run = (await api.runs(slug, { workflow: WF, per: 20 })).find(mine) ?? null;
  }
  const raw = await runNotice(api, slug, run.id, `connect-${key}`);
  if (raw) return parseResult(raw);
  throw new Error(run.conclusion === 'success' ? 'connect.yml が結果（注釈 connect-' + key + '）を残していません' : `connect.yml が ${run.conclusion} で終わりました（「進み具合」で理由を）`);
}
