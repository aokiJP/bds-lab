// setup (the 「準備」 tab): the lab's checks (lib/setup.mjs) as a list — what is there, what is missing and why — with the
// buttons that fix it for the lab's administrators whose role the policy lets do what each fix does (anyone else sees the
// list and why not: GitHub would refuse them anyway), the GitHub App made by a real form posted to GitHub (its manifest in a
// hidden field; the page's CSP lets a form go to github.com alone), and the way back: GitHub's ?code= taken once, checked
// against the state this tab sent, removed from the address at once, and — only when this lab, this person and the policy
// may keep it — turned into the App's keys and sealed into the lab's secrets (storeApp: nothing kept, nothing shown). A
// secret typed into a fix's field is sealed and sent, and the field emptied (the browser is not asked to remember it).
import { h, toast, act, link } from './dom.mjs';
import * as S from '../lib/setup.mjs';
import * as P from '../lib/policy.mjs';

const STATE_KEY = 'bdslab.setup.manifest';
const ICON = (ok) => (ok === null ? '❔ ' : ok ? '✅ ' : '⚠️ ');

/** the 「準備」 tab. ctx: { api, lab: { slug, repo, role, secrets, workflows }, hosts, me, config: { authUrl, appSlug,
 *  appClientId }, panelUrl, signedInWithApp, policy (lib/policy.mjs), role (policy.roleFor's answer; else lab.role), reload,
 *  record(action, detail)? (the audit log), appReturn? (takeAppReturn's answer, when panel.js took it first) } — location,
 *  history and sessionStorage are the page's (ctx.location / ctx.history / ctx.storage: tests only). → a promise of the
 *  checks drawn */
export function setupTab(body, ctx) {
  const admin = ctx.lab?.role === 'admin', back = h('div', {}), list = h('ul', { class: 'plain' }, h('li', { class: 'muted' }, '確かめています…'));
  body.append(h('div', { class: 'card' }, h('h2', {}, `準備と診断（${ctx.lab.slug}）`),
    h('p', { class: 'muted' }, admin ? 'サインインと許可の準備を、上から順に確かめます。⚠️ の行のボタンで、このパネルから直せます（秘密はこのブラウザで封じてから GitHub へ。値は残しません）。'
      : '見るだけです: 直すのはラボの管理者です（GitHub が管理者にだけ許します）。貸し手に渡すリンクは誰でも使えます。'),
    back, list));
  const draw = () => act(async () => { const cs = await S.checks(ctx); list.replaceChildren(...cs.map((c) => row(ctx, c))); return cs; });
  return comeBack(ctx, back).then(draw);
}

const roleName = (r) => (typeof r === 'string' ? r : r?.name ?? (r?.names?.length ? `${r.names.join(' か ')}（チームが読めません）` : 'なし'));
/** why this person may not use a fix (words), null when they may: the lab's administrator on GitHub, and the policy's role
 *  allows each thing the fix does (its needs) */
function notAllowed(ctx, f) {
  if (ctx.lab?.role !== 'admin') return 'ラボの管理者が直せます（GitHub でこのラボの admin の人）';
  const policy = ctx.policy ?? P.DEFAULT_POLICY, role = ctx.role ?? ctx.lab.role;
  const no = (f?.needs ?? []).filter((a) => !P.can(policy, role, a));
  return no.length ? `役割「${roleName(role)}」には、ポリシー（${P.POLICY_FILE} の roles）が「${no.map((a) => P.ACTION_WORDS[a] ?? a).join('・')}」を許していません` : null;
}

/** one check: what it found, what is missing, and its fix (a link for anyone; a button, an input or the App's form for the
 *  lab's administrators the policy lets do it; why not for anyone else) */
function row(ctx, c) {
  return h('li', { 'data-check': c.key }, h('div', {}, ICON(c.ok), h('strong', {}, c.label)), c.need ? h('div', { class: 'muted' }, c.need) : null, fixOf(ctx, c));
}
function fixOf(ctx, c) {
  const f = c.fix;
  if (!f) return null;
  if (f.link) return h('div', { class: 'row' }, link(f.link, f.label), h('button', { onclick: () => act(() => globalThis.navigator.clipboard.writeText(f.link), 'リンクをコピーしました') }, 'コピー'));
  const no = notAllowed(ctx, f);
  if (no) return c.ok === true ? null : h('div', { class: 'muted' }, `（${no}）`);
  if (f.manifest) return appForm(ctx);
  // (a secret's field: not offered to the browser's password manager)
  const fields = (f.inputs ?? []).map((i) => [i, h('input', { type: i.secret ? 'password' : 'text', autocomplete: 'off', placeholder: i.placeholder ?? null, 'aria-label': i.label })]);
  const step = h('div', { class: 'muted' });
  const btn = h('button', { class: c.ok === true ? null : 'primary', onclick: async () => {
    const values = Object.fromEntries(fields.map(([i, el]) => [i.name, el.value.trim()]));
    if (fields.some(([, el]) => !el.value.trim())) return toast('空の欄があります', true);
    btn.disabled = true;
    const msg = await act(() => f.run(values, { onStep: (t) => step.replaceChildren(t) }));
    // (what was typed leaves the page: sealed and sent, or refused)
    for (const [, el] of fields) el.value = '';
    btn.disabled = false;
    if (msg === undefined) return;
    toast(msg); step.replaceChildren(msg);
    ctx.record?.(`setup.${c.key.split(':')[0]}`, {});
    ctx.reload?.();
  } }, f.label);
  return h('div', {}, fields.map(([i, el]) => [h('label', {}, i.label), el]), h('div', { class: 'row' }, btn), step);
}

/** the App's form: posted to GitHub with its manifest; the state it carries kept in this tab to know the way back */
function appForm(ctx) {
  const owner = ctx.lab.repo?.owner?.login ?? ctx.lab.slug.split('/')[0], isOrg = ctx.lab.repo?.owner?.type === 'Organization', state = S.newState();
  const manifest = S.appManifest({ owner, repo: ctx.lab.slug.split('/')[1], panelUrl: ctx.panelUrl, authUrl: ctx.config?.authUrl });
  const store = ctx.storage ?? globalThis.sessionStorage;
  return h('form', { method: 'post', action: S.manifestAction(owner, isOrg, state), onsubmit: () => store.setItem(STATE_KEY, JSON.stringify({ state, lab: ctx.lab.slug, owner, isOrg, at: Date.now() })) },
    h('input', { type: 'hidden', name: 'manifest', value: JSON.stringify(manifest) }),
    h('p', { class: 'muted' }, isOrg ? `組織 ${owner} の App として作ります（組織の管理者だけが作れます）。` : `あなた（${ctx.me?.login ?? owner}）のアカウントの App として作ります。`,
      `名前「${manifest.name}」は GitHub の画面で変えられます。権限: ${Object.entries(S.APP_PERMISSIONS).map(([k, v]) => `${k}=${v}`).join(' ')}`),
    h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'App を作る（GitHub へ）')));
}

/** GitHub's way back from making the App, taken out of the address at once (panel.js may call it first thing, before any
 *  request, and hand its answer to setupTab as ctx.appReturn): the state kept by this tab's form used once → { code, lab,
 *  owner, isOrg } (whose App it is), { error } (not this tab's, or older than GitHub's hour), or null when the address has
 *  no code */
export function takeAppReturn({ location: loc = globalThis.location, history: hist = globalThis.history, storage: store = globalThis.sessionStorage } = {}) {
  if (!/[?&]code=/.test(String(loc?.search ?? '')) && !/[?&]code=/.test(String(loc?.hash ?? ''))) return null;
  let saved = null;
  try { saved = JSON.parse(store.getItem(STATE_KEY) ?? 'null'); } catch { /* not ours */ }
  store.removeItem(STATE_KEY);
  const got = S.takeManifestCode(loc.search, saved?.state) ?? S.takeManifestCode(loc.hash, saved?.state);
  // (out of the address at once: not in the history, a bookmark or a shared link)
  hist.replaceState(null, '', `${loc.pathname}#setup`);
  if (!got || !(Date.now() - Number(saved?.at) < 3_600_000)) return { error: '戻ってきた App の code は、このタブで始めたものではないか古いので使いません（もう一度「App を作る」から）' };
  return { code: got.code, lab: saved.lab, owner: /^[A-Za-z0-9-]{1,39}$/.test(String(saved.owner ?? '')) ? saved.owner : null, isOrg: saved.isOrg === true };
}

/** the way back used (once): this lab, its administrator and the policy looked at first — the code is turned into the App's
 *  keys only when they can be kept here, sealed into the lab's secrets; else what to do with the App GitHub already made */
async function comeBack(ctx, box) {
  const ret = ctx.appReturn !== undefined ? ctx.appReturn : takeAppReturn({ location: ctx.location, history: ctx.history, storage: ctx.storage });
  if (!ret || ret.used) return;
  ret.used = true;
  if (ret.error) return box.replaceChildren(h('p', { class: 'bad' }, ret.error));
  const no = ret.lab !== ctx.lab.slug ? `別のラボ（${ret.lab}）のものです` : notAllowed(ctx, { needs: S.APP_NEEDS });
  if (no) {
    return box.replaceChildren(h('p', { class: 'bad' }, `戻ってきた App の code は使いません: ${no}。`),
      h('p', { class: 'muted' }, `App は GitHub にできています: App の設定で鍵（private key・client secret）を作り直し、ラボ（${ret.lab}）の管理者が「秘密」で APP_PRIVATE_KEY・APP_CLIENT_SECRET に（App の id・slug・client ID は「変数」の APP_ID・APP_SLUG・APP_CLIENT_ID に）入れるか、要らなければ App を消してください（消せば、もう一度「App を作る」から）。`),
      link(S.appsUrl(ret.owner, ret.isOrg), 'App の設定（GitHub へ）'));
  }
  box.replaceChildren(h('p', { class: 'muted' }, 'GitHub から App の鍵を受け取り、ラボの秘密に封じています…'));
  const r = await act(async () => S.storeApp(ctx.api, ctx.lab.slug, await ctx.api.appFromManifest(ret.code)));
  if (!r) return box.replaceChildren(h('p', { class: 'bad' }, 'App を入れられませんでした（上の知らせ）'));
  box.replaceChildren(h('p', { class: 'ok' }, `✅ App ${r.slug} を作り、秘密 ${r.secrets.join('・')} と変数 ${r.variables.join('・')} を入れました。次は「App を入れる」です。`), r.url ? link(r.url, 'App のページ（GitHub）') : null);
  ctx.record?.('setup.app', { app: r.slug });
  ctx.reload?.();
}
