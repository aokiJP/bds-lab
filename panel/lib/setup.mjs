// setup: what the lab's repository needs for signing in with GitHub and for permissions that follow the App's installation,
// checked and set up from the panel itself — the lab's GitHub App made in one click from a manifest (its keys sealed into
// the repository's secrets on the spot, its id and names into variables: nothing kept in the browser, nothing shown), GitHub
// Pages turned on, the sign-in service put on Cloudflare (auth-deploy.yml) or the address of one's own, the workflows using
// the App instead of a person's token, and the link a lender opens to put the App on their host. Each check says what it
// found (ok: true / false / null = cannot tell with this sign-in), what is missing in words (need) and how to fix it (fix:
// { label, run(values) } with its inputs, { label, link }, or { label, manifest: true } for the App's form; a fix that changes
// the lab names what it does in the policy's words, needs, for the screen to ask lib/policy.mjs). GitHub stays the gate: a
// fix this person may not do fails with GitHub's own answer. No DOM and no node: (Node 22, browsers and Workers alike); its
// screen is ui/setup.mjs.
import { SLUG } from './model.mjs';

/** the App's permissions on the repositories it is put on: the least the panel and the workflows use (the keys are GitHub's
 *  names for an App's permissions — 要実測 on GitHub: this is the one place to change them). members: read is the
 *  organization's (its teams, for the policy's teams: without it a person signed in with the App cannot be told in a team,
 *  and gets the narrowest role); not used when the App is on a personal account — 要実測 */
export const APP_PERMISSIONS = Object.freeze({ actions: 'write', contents: 'write', secrets: 'write', actions_variables: 'write', issues: 'write', workflows: 'write', pages: 'write', pull_requests: 'read', metadata: 'read', members: 'read' });
/** what keeping the App's keys in the lab does, in the policy's words (storeApp: secrets sealed, variables set) */
export const APP_NEEDS = Object.freeze(['secrets.put', 'variables']);
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const APP_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
/** the address of a sign-in service as the lab keeps it (pure): https, the root of an origin only (the service answers at
 *  its origin's /: auth/README.md) — no path, query or fragment, no trailing slash; else null */
export function cleanAuthUrl(u) {
  const s = String(u ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(s) ? s : null;
}
const strip = (u) => String(u ?? '').replace(/#.*$/, '');

/** the App's manifest (pure): GitHub makes the App from it — public, so a lender can put it on their own account; no
 *  webhook, no events; its user sign-in comes back to the sign-in service (callback_urls: none yet when there is no service:
 *  set in the App's settings later, the check 'callback' says so) */
export function appManifest({ owner, repo, panelUrl, authUrl, name } = {}) {
  const url = strip(panelUrl), auth = cleanAuthUrl(authUrl);
  // (GitHub's names for an App: unique on GitHub, 34 characters at most — the lab and its owner, letters, digits and -)
  const named = String(name ?? `${repo || 'bds-lab'}-${owner ?? ''}`).replace(/[^A-Za-z0-9 _.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34);
  return {
    name: named, url, hook_attributes: { active: false }, redirect_url: `${url}#setup`, callback_urls: auth ? [`${auth}/callback`] : [], setup_url: `${url}#setup`,
    public: true, default_permissions: { ...APP_PERMISSIONS }, default_events: [], request_oauth_on_install: false,
  };
}
/** where the manifest's form goes (pure): the person's own account's new App, or an organization's */
export function manifestAction(owner, isOrg, state) {
  const q = `?state=${encodeURIComponent(String(state ?? ''))}`;
  if (!isOrg) return `https://github.com/settings/apps/new${q}`;
  if (!LOGIN.test(String(owner ?? ''))) throw new Error('組織の名前が正しくありません');
  return `https://github.com/organizations/${owner}/settings/apps/new${q}`;
}
/** a state for the manifest's round trip: 16 random bytes in hex (random: tests only) */
export const newState = (random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) => Array.from(random(16), (b) => b.toString(16).padStart(2, '0')).join('');
/** GitHub's way back (?code=…&state=…, in the address's query or after #setup?) → { code, state }; null when there is no
 *  code or its state is not the one this tab sent (pure) */
export function takeManifestCode(search, wantState) {
  const s = String(search ?? ''), i = s.indexOf('?'), p = new URLSearchParams(i >= 0 ? s.slice(i + 1) : '');
  const code = p.get('code'), state = p.get('state');
  if (!code || !/^[A-Za-z0-9_-]{1,200}$/.test(code) || !wantState || state !== String(wantState)) return null;
  return { code, state };
}
const b64url = (b) => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

/** the App GitHub just made (appFromManifest's answer) kept in the lab: its private key, its client secret and a new state
 *  secret for the sign-in service (48 random bytes made here) sealed into secrets, its id, slug and client id into variables.
 *  The answer's keys are wiped from it as soon as they are sealed (also when GitHub refuses one): nothing is kept, nothing
 *  shown → { id, slug, clientId, owner, url, secrets: [names], variables: [names] } (random: tests only) */
export async function storeApp(api, lab, conv, { random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)) } = {}) {
  const slug = typeof lab === 'string' ? lab : lab?.slug;
  if (!SLUG.test(String(slug ?? ''))) throw new Error('ラボのリポジトリは owner/名前 で');
  const wipe = () => { for (const k of ['pem', 'client_secret', 'webhook_secret']) if (conv && k in conv) conv[k] = undefined; };
  if (!conv?.id || !APP_SLUG.test(String(conv.slug ?? '')) || !conv.client_id || !conv.pem || !conv.client_secret) { wipe(); throw new Error('GitHub の答えに App の鍵がありません（code は 1 時間で切れます: もう一度「App を作る」から）'); }
  const r = random(48);
  if (!(r instanceof Uint8Array) || r.length !== 48) { wipe(); throw new Error('乱数を作れません'); }
  const done = { secrets: [], variables: [] }, info = { id: conv.id, slug: conv.slug, clientId: conv.client_id, owner: conv.owner?.login ?? null, url: /^https:\/\//.test(String(conv.html_url ?? '')) ? conv.html_url : null };
  try {
    for (const [n, v] of [['APP_PRIVATE_KEY', conv.pem], ['APP_CLIENT_SECRET', conv.client_secret], ['AUTH_STATE_SECRET', b64url(r)]]) { await api.putSecret(slug, n, v); done.secrets.push(n); }
    for (const [n, v] of [['APP_ID', String(conv.id)], ['APP_SLUG', conv.slug], ['APP_CLIENT_ID', String(conv.client_id)]]) { await api.setVariable(slug, n, v); done.variables.push(n); }
  } catch (e) {
    throw new Error(`${e.message} — App ${info.slug} はできています（登録できたもの: ${[...done.secrets, ...done.variables].join('・') || 'なし'}）。鍵は App の設定で作り直し、「秘密」で APP_PRIVATE_KEY・APP_CLIENT_SECRET に`);
  } finally { wipe(); r.fill(0); }
  return { ...info, ...done };
}

/** the link that puts the App on an account's repositories (the lab's owner, or a lender for their host); null for a slug
 *  GitHub would not give */
export const installUrl = (appSlug) => (APP_SLUG.test(String(appSlug ?? '')) ? `https://github.com/apps/${appSlug}/installations/new` : null);
/** the App's own settings on GitHub (its callback URL, a new private key) */
export const appSettingsUrl = (appSlug, owner, isOrg) => (!APP_SLUG.test(String(appSlug ?? '')) ? null : isOrg && LOGIN.test(String(owner ?? '')) ? `https://github.com/organizations/${owner}/settings/apps/${appSlug}` : `https://github.com/settings/apps/${appSlug}`);
/** the Apps of an account on GitHub (an organization's, or the person's own): where an App made but not kept here is found */
export const appsUrl = (owner, isOrg) => (isOrg && LOGIN.test(String(owner ?? '')) ? `https://github.com/organizations/${owner}/settings/apps` : 'https://github.com/settings/apps');
/** the repositories (owner/repo, lower case) the App is on that this person may see → a Set (an App's user token only) */
export async function installedRepos(api, appSlug) {
  const set = new Set();
  for (const i of (await api.userInstallations()).filter((x) => !appSlug || x.app_slug === appSlug)) for (const r of await api.installationRepos(i.id)) set.add(String(r.full_name).toLowerCase());
  return set;
}
const list = (x) => (Array.isArray(x) ? x.map(String) : String(x ?? '').split(',').map((y) => y.trim()).filter(Boolean));
/** the sign-in service's /health → { ok, why, clientId, origins, panels } — panels: the panels' addresses it allows (each the
 *  head of one, path and all), null when it does not say (never throws: an answer that is not ok says why) */
export async function health(authUrl, fetchImpl = (...a) => globalThis.fetch(...a)) {
  try {
    const r = await fetchImpl(`${authUrl}/health`, { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}`, clientId: null, origins: [], panels: null };
    const j = await r.json();
    return { ok: j?.ok === true, why: j?.ok === true ? '' : 'ok と答えません', clientId: j?.clientId ? String(j.clientId) : null, origins: list(j?.origins), panels: j?.panels === undefined || j?.panels === null ? null : list(j.panels) };
  } catch { return { ok: false, why: 'つながりません（URL か、サービスの CORS か、このページの connect-src）', clientId: null, origins: [], panels: null }; }
}
/** a run's annotation of level notice with that title (`::notice title=<title>::<message>`) → its message, null without */
export async function runNotice(api, slug, runId, title) {
  for (const j of await api.jobs(slug, runId)) {
    const id = String(j.check_run_url ?? '').split('/').pop();
    if (!/^\d+$/.test(id)) continue;
    const a = (await api.annotations(slug, id) ?? []).find((x) => x.annotation_level === 'notice' && x.title === title);
    if (a) return String(a.message ?? '').trim();
  }
  return null;
}
const sleeper = (ms) => new Promise((r) => setTimeout(r, ms));
/** the sign-in service put on Cloudflare by the lab's own workflow: Cloudflare's token and account id sealed into secrets
 *  (when given), auth-deploy.yml started and waited for, the address its run left (the notice 「auth-url」, the root of an
 *  https origin only) kept in the variable LAB_AUTH_URL, and pages.yml started so the page learns it → the address. me: the
 *  login of the person starting it (the run waited for is theirs). sleep / every / timeoutMs: tests */
export async function deployAuth(api, slug, { ref = 'main', cf = null, me, sleep = sleeper, every = 10_000, timeoutMs = 15 * 60_000, onStep = () => {} } = {}) {
  if (!LOGIN.test(String(me ?? ''))) throw new Error('始める人（GitHub のログイン名）が分かりません: サインインし直してください');
  if (cf) {
    if (!String(cf.token ?? '') || /\s/.test(cf.token) || String(cf.token).length < 20) throw new Error('Cloudflare の API トークンの形が違います');
    if (!/^[0-9a-f]{32}$/i.test(String(cf.account ?? ''))) throw new Error('Cloudflare のアカウント ID は 32 文字の 16 進数です');
    await api.putSecret(slug, 'CLOUDFLARE_API_TOKEN', cf.token);
    await api.putSecret(slug, 'CLOUDFLARE_ACCOUNT_ID', cf.account);
    onStep('Cloudflare の秘密を封じて登録しました');
  }
  // (the new run is the one that was not there before — no clock of this device is trusted to tell it — started by hand on
  // this branch by this person: not a pull request's run from a fork, nor someone else's, whose notice could say anything)
  const before = new Set((await api.runs(slug, { workflow: 'auth-deploy.yml', per: 20 })).map((r) => r.id)), who = String(me).toLowerCase();
  const mine = (r) => !before.has(r.id) && r.event === 'workflow_dispatch' && r.head_branch === ref && [r.actor?.login, r.triggering_actor?.login].some((l) => String(l ?? '').toLowerCase() === who);
  await api.dispatch(slug, 'auth-deploy.yml', ref, {});
  onStep('auth-deploy.yml を始めました: 置き終わるのを待っています');
  let run = null;
  for (let waited = 0; !(run?.status === 'completed'); waited += every) {
    if (waited > timeoutMs) throw new Error('auth-deploy.yml が時間内に終わりません（「進み具合」で見てください）');
    await sleep(every);
    run = (await api.runs(slug, { workflow: 'auth-deploy.yml', per: 20 })).find(mine) ?? null;
  }
  if (run.conclusion !== 'success') throw new Error(`auth-deploy.yml が ${run.conclusion} で終わりました（「進み具合」で理由を）`);
  const raw = await runNotice(api, slug, run.id, 'auth-url'), url = cleanAuthUrl(raw);
  if (!url) throw new Error('auth-deploy.yml がサービスの URL（注釈 auth-url: https の origin の根）を残していません');
  await api.setVariable(slug, 'LAB_AUTH_URL', url);
  await api.dispatch(slug, 'pages.yml', ref, {});
  onStep(`${url} に置きました: pages.yml でページに渡します`);
  return url;
}
/** variables read → { NAME: value | null (not set) | undefined (this token may not read them) } */
async function readVars(api, slug, names) {
  const out = {};
  for (const n of names) { try { out[n] = await api.variable(slug, n); } catch { out[n] = undefined; } }
  return out;
}

/** the lab's checks → [{ key, label, ok, need, fix }] in the order to do them; a fix that changes the lab says what it does
 *  in the policy's words (fix.needs: ['secrets.put', 'variables', 'dispatch'] …, for the screen to ask the policy). ctx: { api,
 *  lab: { slug, repo, role, secrets, workflows }, me: { login }, hosts: [{ slug }], config: { authUrl, appSlug, appClientId },
 *  panelUrl, signedInWithApp, fetchImpl (the service's /health), wait: deployAuth's sleep / every / timeoutMs (tests) } */
export async function checks(ctx) {
  const { api, lab, hosts = [], config = {}, signedInWithApp = false } = ctx;
  const slug = lab.slug, ref = lab.repo?.default_branch ?? 'main', owner = lab.repo?.owner?.login ?? slug.split('/')[0], isOrg = lab.repo?.owner?.type === 'Organization';
  const secrets = Array.isArray(lab.secrets) ? lab.secrets : null, has = (n) => Boolean(secrets?.includes(n));
  const wf = (f) => (lab.workflows ?? []).some((w) => String(w.path ?? w).endsWith(`/${f}`));
  const v = await readVars(api, slug, ['APP_ID', 'APP_SLUG', 'APP_CLIENT_ID', 'LAB_AUTH_URL']);
  const appSlug = v.APP_SLUG || config.appSlug || null, clientId = v.APP_CLIENT_ID || config.appClientId || null, authUrl = cleanAuthUrl(config.authUrl);
  const out = [], c = (key, label, ok, need = '', fix = null) => out.push({ key, label, ok, need: ok === true ? '' : need, fix });
  const pagesYml = async () => { if (wf('pages.yml')) await api.dispatch(slug, 'pages.yml', ref, {}); }, PY = wf('pages.yml') ? ['dispatch'] : [];

  // ---- GitHub Pages: where this panel is served from (built by pages.yml) ----
  let pages; try { pages = await api.pages(slug); } catch (e) { pages = e; }
  // (signed in with the App: turning Pages on asks the repository's administration, which the App is not given — GitHub's own
  // page instead; a person's token: the button)
  const pagesLink = { label: 'Pages の設定で Source を GitHub Actions に（GitHub へ）', link: `https://github.com/${slug}/settings/pages` };
  const pagesFix = (update) => (signedInWithApp ? pagesLink : { label: update ? 'Source を GitHub Actions に' : 'Pages を有効に（GitHub Actions で）', needs: PY, run: async () => { await api.enablePages(slug, { update }); await pagesYml(); return `Pages を有効にしました${wf('pages.yml') ? '（pages.yml を始めました）' : ''}`; } });
  const onGitHub = signedInWithApp ? ': GitHub の Pages の設定で Source を「GitHub Actions」に（App でのサインインでは、ここからは変えられません）' : '';
  if (pages instanceof Error) c('pages', 'GitHub Pages（このパネルを置く）', null, `Pages の設定を読めません（${pages.message}）`);
  else if (!pages) c('pages', 'GitHub Pages（このパネルを置く）', false, `Pages が有効ではありません${onGitHub}`, pagesFix(false));
  else if (pages.build_type !== 'workflow') c('pages', 'GitHub Pages（このパネルを置く）', false, `Pages の Source が「GitHub Actions」ではありません（pages.yml で置けません）${onGitHub}`, pagesFix(true));
  else c('pages', 'GitHub Pages（このパネルを置く）', true);

  // ---- the App: made from the manifest, its id and slug in variables ----
  const appLabel = appSlug ? `GitHub App（${appSlug}: サインインと許可）` : 'GitHub App（サインインと許可）', makeApp = { label: 'App を作る（GitHub へ）', manifest: true, needs: [...APP_NEEDS] };
  if (v.APP_ID === undefined && !config.appSlug) c('app', appLabel, null, '変数を読めません（このトークンに Variables: Read が要ります）');
  else if ((v.APP_ID || v.APP_ID === undefined) && appSlug) c('app', appLabel, true);
  else c('app', appLabel, false, 'まだありません: 1 回のクリックで作れます（鍵は秘密に、id は変数に、ここで自動で入ります）', makeApp);

  // ---- the App on the lab: what decides who may do what, without anyone's personal token ----
  let inst = null, instWhy = '';
  if (signedInWithApp && appSlug) { try { inst = await installedRepos(api, appSlug); } catch (e) { instWhy = e.message; } }
  const putOn = installUrl(appSlug) ? { label: 'App を入れる（GitHub へ）', link: installUrl(appSlug) } : null;
  if (!appSlug) c('installed', 'App がラボに入っている', false, 'まず App を作ります');
  else if (!signedInWithApp) c('installed', 'App がラボに入っている', null, 'App でサインインすると分かります', putOn);
  else if (!inst) c('installed', 'App がラボに入っている', null, `App の入り先を読めません（${instWhy}）`, putOn);
  else c('installed', 'App がラボに入っている', inst.has(slug.toLowerCase()), `${slug} に App が入っていません: 入れると、ラボの人はサインインするだけで使えます（許可は App の導入と GitHub の権限で決まります）`, putOn);

  // ---- the sign-in service: answering, with this App's client id, for this panel ----
  const urlFix = { label: '自分のサーバーの URL を入れる', inputs: [{ name: 'url', label: 'サインインのサービスの URL（https://… の origin だけ: パスなし）', placeholder: 'https://…' }], needs: ['variables', ...PY], run: async ({ url } = {}) => {
    const u = cleanAuthUrl(url);
    if (!u) throw new Error('https:// で始まる origin の根を入れてください（パス・?・# のないもの）: サービスは origin の / に（auth/README.md）');
    await api.setVariable(slug, 'LAB_AUTH_URL', u); await pagesYml();
    return `LAB_AUTH_URL を ${u} にしました${wf('pages.yml') ? '（pages.yml でページに渡します）' : ''}`;
  } };
  const cfReady = has('CLOUDFLARE_API_TOKEN') && has('CLOUDFLARE_ACCOUNT_ID') && wf('auth-deploy.yml');
  const wait = ctx.wait ?? {}, deploy = (cf) => async (_v, { onStep } = {}) => `サインインのサービスを ${await deployAuth(api, slug, { ref, cf, me: ctx.me?.login, onStep, ...wait })} に置きました（LAB_AUTH_URL に入れ、pages.yml でページに渡します）`;
  const deployNeeds = (cf) => [...(cf ? ['secrets.put'] : []), 'dispatch', 'variables'];
  const redeploy = cfReady ? { label: 'auth-deploy.yml でもう一度置く', needs: deployNeeds(false), run: deploy(null) } : urlFix, varAuth = cleanAuthUrl(v.LAB_AUTH_URL);
  const rebuild = wf('pages.yml') ? { label: 'pages.yml を始める', needs: ['dispatch'], run: async () => { await pagesYml(); return 'pages.yml を始めました（数分でページが新しくなります）'; } } : null;
  if (!authUrl && varAuth) c('auth', 'サインインのサービス', false, `変数 LAB_AUTH_URL（${varAuth}）はありますが、このページの設定にまだありません: pages.yml をもう一度`, rebuild);
  else if (!authUrl && String(config.authUrl ?? '').trim()) c('auth', 'サインインのサービス', false, `このページの設定のサービスの URL（${String(config.authUrl).trim()}）が https の origin の根ではありません: サービスは origin の / に（auth/README.md）`, urlFix);
  else if (!authUrl) c('auth', 'サインインのサービス', false, 'まだありません: Cloudflare に置く（下の「置く準備」）か、自分のサーバーに置いて URL を入れます。サービスは origin の / に（auth/README.md）', urlFix);
  else {
    const hl = await health(authUrl, ctx.fetchImpl), here = strip(ctx.panelUrl);
    const origin = (() => { try { return new URL(here).origin; } catch { return null; } })();
    if (!hl.ok) c('auth', 'サインインのサービス', false, `${authUrl} が答えません（${hl.why}）`, redeploy);
    else if (!clientId) c('auth', 'サインインのサービス', false, 'App の client ID（変数 APP_CLIENT_ID）がありません: まず App を作ります');
    else if (hl.clientId !== clientId) c('auth', 'サインインのサービス', false, `サービスの client ID（${hl.clientId ?? 'なし'}）が App のもの（APP_CLIENT_ID ${clientId}）と違います: サービスの GITHUB_CLIENT_ID・GITHUB_CLIENT_SECRET を App のものに（auth-deploy.yml なら、もう一度置くだけ）`, redeploy);
    // (a service that names the panels' addresses: this panel's, path and all, must begin with one of them; else its origins)
    else if (origin && hl.panels && !hl.panels.some((p) => p && here.startsWith(p))) c('auth', 'サインインのサービス', false, `サービスの PANEL_ORIGINS にこのパネルのアドレス（パス付き: ${here}）を入れてください（今は ${hl.panels.join('・') || 'なし'}）`, redeploy);
    else if (origin && !hl.panels && !hl.origins.includes(origin)) c('auth', 'サインインのサービス', false, `サービスの PANEL_ORIGINS にこのパネル（${origin}）がありません`, redeploy);
    else if (varAuth && varAuth !== authUrl) c('auth', 'サインインのサービス', false, `変数 LAB_AUTH_URL（${varAuth}）が、このページの設定（${authUrl}）と違います: pages.yml をもう一度`, rebuild);
    else c('auth', `サインインのサービス（${authUrl}）`, true);
  }
  // (GitHub shows an App's callback URL to no token: right when signing in with the App works)
  if (appSlug && authUrl) c('callback', 'App の Callback URL がサインインのサービスを指す', signedInWithApp ? true : null, `App の設定の「Callback URL」が ${authUrl}/callback か確かめてください（App でサインインできれば合っています）`, appSettingsUrl(appSlug, owner, isOrg) ? { label: 'App の設定（GitHub へ）', link: appSettingsUrl(appSlug, owner, isOrg) } : null);

  // ---- putting the service on Cloudflare: its token and account in secrets, then auth-deploy.yml ----
  if (!authUrl && !varAuth) {
    const label = 'サインインのサービスを Cloudflare に置く準備', appReady = has('APP_CLIENT_SECRET') && has('AUTH_STATE_SECRET') && Boolean(clientId);
    const cfFix = { label: '封じて登録し、置く', inputs: [{ name: 'token', label: 'CLOUDFLARE_API_TOKEN（Workers を編集できる API トークン）', secret: true }, { name: 'account', label: 'CLOUDFLARE_ACCOUNT_ID（32 文字）', placeholder: '0123456789abcdef0123456789abcdef' }], needs: deployNeeds(true),
      run: (vals = {}, opts) => deploy({ token: String(vals.token ?? '').trim(), account: String(vals.account ?? '').trim() })(vals, opts) };
    if (!wf('auth-deploy.yml')) c('deploy', label, false, 'auth-deploy.yml がありません（ラボを新しくしてください）');
    else if (!secrets) c('deploy', label, null, '秘密の名前を見られません（このトークンに Secrets: Read が要ります）', cfFix);
    else if (!appReady) c('deploy', label, false, 'まず App を作ります（サービスは App の client ID と秘密で動きます）');
    else if (cfReady) c('deploy', label, true, '', { label: 'Cloudflare に置く（auth-deploy.yml）', needs: deployNeeds(false), run: deploy(null) });
    else c('deploy', label, false, 'Cloudflare の API トークンとアカウント ID を入れると、ここで封じて登録し、auth-deploy.yml で置き、その URL を LAB_AUTH_URL に入れて pages.yml でページに渡します', cfFix);
  }

  // ---- the workflows: the App's own token instead of a person's (hostrun, secrets) ----
  const wfLabel = 'ワークフローが App のトークンを使う（hostrun・secrets に個人のトークンは要りません）';
  if (!secrets || v.APP_ID === undefined) c('workflows', wfLabel, null, '秘密の名前か変数を見られません');
  else if (v.APP_ID && has('APP_PRIVATE_KEY')) c('workflows', wfLabel, true);
  else c('workflows', wfLabel, false, `${[!v.APP_ID && 'APP_ID（変数）', !has('APP_PRIVATE_KEY') && 'APP_PRIVATE_KEY（秘密）'].filter(Boolean).join('・')} があれば、hostrun・secrets は App のトークンで動き、LAB_HOST_TOKEN・LAB_SECRETS_TOKEN は要りません${v.APP_ID ? '（鍵は App の設定で作り直し、「秘密」で APP_PRIVATE_KEY に）' : '（App を作ると両方入ります）'}`,
    v.APP_ID && appSettingsUrl(appSlug, owner, isOrg) ? { label: 'App の設定（GitHub へ）', link: appSettingsUrl(appSlug, owner, isOrg) } : null);

  // ---- each host: the link its lender opens to put the App on it (the App asks the same permissions everywhere it is put:
  // the lender chooses the host alone) ----
  const onlyHost = '「Only select repositories」でホストのリポジトリだけを選んでもらいます（App の権限はラボと同じ: secrets・variables・issues・pages の write も及びます。ホストで使うのは contents・actions・workflows だけ（hostrun））';
  for (const x of hosts) {
    if (!SLUG.test(String(x?.slug ?? ''))) continue;
    const key = `host:${x.slug}`, label = `${x.slug}: 貸し手（${x.slug.split('/')[0]} さん）に App を入れてもらう`;
    if (!appSlug) { c(key, label, false, 'まず App を作ります'); continue; }
    const give = { label: '貸し手に渡すリンク', link: installUrl(appSlug) };
    if (inst) c(key, label, inst.has(x.slug.toLowerCase()), `このリンクを貸し手に渡し、ホストのリポジトリに App を入れてもらいます（その人の Actions を、あなたのトークンなしで使えるように）。${onlyHost}`, give);
    else c(key, label, null, `このリンクを貸し手に渡します（入ったかどうかは App でサインインすると分かります）。${onlyHost}`, give);
  }
  return out;
}
