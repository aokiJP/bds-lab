// bds-lab 管理パネル: the lab's author, its collaborators and the people who lend or borrow GitHub Actions minutes (hosts),
// each signed in as themselves — 「GitHub でサインイン」 through the lab's GitHub App (lib/session.mjs and the small service in
// auth/), or a token typed in — and what they see and may do is what GitHub lets them. The lab's policy
// (.github/bds-lab-panel.json: lib/policy.mjs) narrows what the panel offers by role, asks again before what it names, signs
// out after idle minutes and keeps what was done in the lab's audit log (lib/audit.mjs). Several accounts can live in one
// browser (lib/accounts.mjs), each with its own settings: switched at the top. Each repository's own settings decide what is
// offered (its secrets' names, variables and workflows, its visibility; a host's .lab-host.json), and where a job runs is
// chosen: this lab's own Actions, or a lender's through hostrun.yml. 「準備」 (ui/setup.mjs) makes the App, the sign-in service
// and Pages ready from here. Discord is reached through the repository's own workflows and secrets.
// The tokens, and the vault key for a public repository's live screen, stay in this browser (localStorage or this tab only).
import { gh } from './lib/gh.mjs';
import * as M from './lib/model.mjs';
import * as LF from './lib/livefmt.mjs';
import { PAGES } from './lib/pages.mjs';
import { vaultKey } from './lib/vault.mjs';
import { accounts, memoryStorage } from './lib/accounts.mjs';
import * as S from './lib/session.mjs';
import * as P from './lib/policy.mjs';
import * as AU from './lib/audit.mjs';
import { h, $, main, toast, act, link } from './ui/dom.mjs';
import { signInCard, tokenHelp } from './ui/signin.mjs';
import { setupTab, takeAppReturn } from './ui/setup.mjs';
import { auditTab } from './ui/audit.mjs';
import { membersTab } from './ui/members.mjs';
import * as DBG from './lib/debug.mjs';
import { lendStart } from './ui/lend.mjs';

// ---- the browser's storage (one that refuses it — a private window may — still works for the tab) ----
const storage = (name) => { try { const s = window[name]; s.setItem('bdslab.probe', '1'); s.removeItem('bdslab.probe'); return s; } catch { return memoryStorage(); } };
const LOCAL = storage('localStorage'), TAB = storage('sessionStorage');

// ---- never inside another page's frame: a click there would be this person's own (GitHub Pages sends no frame-ancestors
// header, and a meta CSP cannot say it) — the panel then does nothing at all ----
const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();

// ---- first of all: GitHub's ways back, out of the address at once (not in the history, a bookmark or a shared link) ----
// (the App made in 「準備」: ?code=; a sign-in: #bdslab-auth= — taken only when this tab began it: its nonce)
const APP_RETURN = FRAMED ? null : takeAppReturn({ storage: TAB });
const SIGNIN = 'bdslab.panel.signin';
const PENDING = (() => { try { const p = JSON.parse(TAB.getItem(SIGNIN) ?? 'null'); return p && Date.now() - Number(p.at) < 15 * 60_000 ? p : null; } catch { return null; } })();
const HANDOFF = FRAMED ? null : S.takeHandoff(location.hash, { nonce: PENDING?.nonce ?? null });
if (HANDOFF) { history.replaceState(null, '', location.pathname + location.search + HANDOFF.rest); TAB.removeItem(SIGNIN); }

// ---- the page's own config (pages.yml writes it from the lab's variables: common/panel-config.mjs) ----
const RAW = await fetch('./config.json', { cache: 'no-store', credentials: 'omit' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
const CONFIG = { version: /^[0-9a-f]{40}$/.test(String(RAW?.version ?? '')) ? RAW.version : null, authUrl: S.authBase(RAW?.authUrl), appSlug: /^[a-z0-9][a-z0-9-]{0,62}$/.test(String(RAW?.appSlug ?? '')) ? RAW.appSlug : null, appClientId: /^[A-Za-z0-9._-]{1,64}$/.test(String(RAW?.appClientId ?? '')) ? RAW.appClientId : null };

// ---- debug: the last GitHub calls and the page's errors on this device (lib/debug.mjs; 「設定」→「デバッグ」) ----
const LOG = DBG.debugLog();
const loud = () => LOG.errors().filter((e) => e.kind === 'error' || e.status === 0 || e.status >= 500).length;
const fault = (message, where) => { LOG.add({ kind: 'error', message: DBG.redact(message), where: DBG.redact(where ?? '') }); try { if (st.login) renderWho(); } catch { /* before the page is up */ } };
window.addEventListener('error', (e) => fault(e.message ?? String(e.error), e.filename ? `${String(e.filename).split('/').pop()}:${e.lineno}` : ''));
window.addEventListener('unhandledrejection', (e) => fault(e.reason?.message ?? String(e.reason), e.reason?.path ?? ''));

// ---- the accounts of this browser, each with its own token and settings ----
const DEFAULT_LAB = M.repoFromLocation(location) ?? 'aokiJP/bds-lab';
const A = accounts({ local: LOCAL, session: TAB, defaults: { lab: DEFAULT_LAB } });
/** the settings of the account in use (its lab, hosts, refresh, vault key) */
const settings = () => A.cfg(st.login ?? A.active());
const saveSettings = (patch) => A.setCfg(st.login, patch);

// ---- the state of this visit ----
const st = { login: null, api: null, me: null, lab: null, hosts: [], tab: 'overview', timer: null, routed: false, focus: null, prefill: null, target: 'lab',
  policy: P.DEFAULT_POLICY, policyErrors: [], role: null, audit: 'off', lastActive: Date.now(), handed: false, signinErr: HANDOFF?.error ? S.explainAuth(HANDOFF.error) : null };
const canLab = () => Boolean(st.lab && (st.lab.role === 'admin' || st.lab.role === 'write'));

// ---- the lab's policy: may this person do this here (GitHub's role first, then the policy: never wider than GitHub) ----
const may = (action) => Boolean(st.lab) && P.can(st.policy, st.role ?? st.lab.role, action);
const roleName = () => st.role?.name ?? st.role?.names?.join('・') ?? st.lab?.role ?? '?';
const notMine = (action) => `${P.ACTION_WORDS[action] ?? action}は、あなたの役割（${roleName()}）には許されていません（${P.POLICY_FILE}）`;
/** a button's attributes for an action the policy may not allow this role */
const gate = (action) => (may(action) ? {} : { disabled: true, title: notMine(action) });
/** an action on the lab as the policy says: allowed for this role, asked again when it wants, kept in the audit log once
 *  it went through → what fn gave, undefined when it was not done */
async function guarded(action, detail, fn, done) {
  if (!may(action)) { toast(notMine(action), true); return undefined; }
  if (P.needsConfirm(st.policy, action) && !confirm(`${P.ACTION_WORDS[action] ?? action}${detail?.name ? `（${detail.name}）` : detail?.workflow ? `（${detail.workflow}）` : ''}: よろしいですか`)) return undefined;
  const r = await act(fn, done);
  if (r !== undefined) record(action, detail);
  return r;
}
/** what was done, kept as this person's own comment on the audit issue (GitHub says who wrote it) — when the policy keeps it */
function record(action, detail = {}, slug = st.lab?.slug, mode = st.audit) {
  if (!slug || mode !== 'issue' || !st.me) return;
  AU.record(st.api, slug, { actor: st.me.login, action, target: slug, detail }).then((r) => { if (r?.why) toast(`監査ログ: ${r.why}`, true); }).catch((e) => toast(`監査ログに書けません: ${e.message}`, true));
}

// ---- the sign-in kept good: a token from 「GitHub でサインイン」 renewed before it runs out; idle too long: signed out ----
/** → true while the account may go on (an 'oauth' token renewed through the service when its time is near). GitHub gives a
 *  new refresh token each time and the old one stops: one tab renews at a time (a lock shared by this browser's tabs), each
 *  reading the account again first — another tab may have just renewed it */
async function freshen(login = st.login) {
  if (A.session(login)?.kind !== 'oauth') return true;
  const once = async () => {
    const s = A.session(login);
    if (s?.kind !== 'oauth') return true;
    if (S.needsRefresh(s)) {
      try { A.setTokens(login, await S.refresh(CONFIG.authUrl, s.refresh)); }
      catch (e) {
        // (refused, but renewed meanwhile by another tab of this browser: that one stands)
        const again = A.session(login);
        if (again?.refresh && again.refresh !== s.refresh && !S.expired(again)) return true;
        if (!S.expired(s)) return true;
        st.signinErr = e.message; return false;
      }
    } else if (S.expired(s)) { st.signinErr = S.explainAuth('refresh'); return false; }
    return true;
  };
  const ok = globalThis.navigator?.locks ? await navigator.locks.request(`bdslab-refresh-${login}`, once) : await once();
  if (ok && login === st.login) useToken(A.token(login));
  return ok;
}
/** the GitHub client for the account in use, made again only when its token changed */
function useToken(t) {
  if (t && t !== st.apiToken) { st.api = gh({ token: t, onCall: (c) => LOG.add(c) }); st.apiToken = t; }
}
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { st.lastActive = Date.now(); }, { passive: true });
setInterval(async () => {
  if (!st.login || !st.me) return;
  const idle = P.idleMinutes(st.policy);
  if (S.idleOut(st.lastActive, Date.now(), idle)) return signOut({ why: `${idle} 分のあいだ操作がなかったので、サインアウトしました（${P.POLICY_FILE} の idleMinutes）` });
  if (!(await freshen())) renderSignIn(st.signinErr, { login: st.login });
}, 30_000);

// ---- the top: who, switching accounts, adding one, leaving ----
function renderWho() {
  const list = A.list(), kids = [];
  if (st.me) kids.push(h('img', { src: st.me.avatar_url, alt: '' }));
  if (list.length > 1) kids.push(h('select', { id: 'acct', 'aria-label': 'アカウントを切り替える', onchange: (e) => switchTo(e.target.value) }, list.map((a) => h('option', { value: a.login, selected: a.login === st.login ? 'selected' : null }, `${a.login}${a.remember ? '' : '（このタブだけ）'}`))));
  else if (st.me) kids.push(st.me.login);
  kids.push(h('button', { title: 'アカウントを加える', 'aria-label': 'アカウントを加える', onclick: () => renderSignIn('', { adding: true }) }, '＋'));
  if (st.login) kids.push(h('button', { onclick: () => signOut() }, '出る'));
  // (an error on this page or GitHub not answering: shown at once, a tap to what happened)
  const n = loud(); if (n && st.login) kids.unshift(h('button', { class: 'danger', id: 'faults', title: 'このページで起きたこと（設定 → デバッグ）', onclick: () => { st.tab = 'settings'; go('settings'); $('debug')?.scrollIntoView({ block: 'start' }); } }, `⚠ ${n}`));
  $('who').replaceChildren(...kids);
}
function switchTo(login) { if (!A.use(login)) return; st.tab = 'overview'; st.me = null; st.target = 'lab'; history.replaceState(null, '', location.pathname + location.search); connect(); }
/** this account forgotten by this browser — a signed-in one's token revoked on GitHub first (a typed one stays valid on
 *  GitHub until revoked there): the next account, or the door (with why, when the panel did it) */
async function signOut({ why = '' } = {}) {
  const login = st.login, s = A.session(login), tok = A.token(login);
  if (s?.kind === 'oauth' && tok && CONFIG.authUrl) await S.logout(CONFIG.authUrl, tok);
  const next = A.remove(login);
  Object.assign(st, { login: null, me: null, lab: null, hosts: [], tab: 'overview', role: null, policy: P.DEFAULT_POLICY, audit: 'off' });
  clearInterval(st.timer);
  if (why) { renderWho(); return renderSignIn(why, { login }); }
  if (next) return connect();
  renderWho(); renderSignIn();
}

// ---- sign in / add an account / locked ----
function renderSignIn(err = '', { adding = false, login = null } = {}) {
  clearInterval(st.timer);
  if (!adding) renderWho();
  const lab0 = (login && A.get(login) ? A.cfg(login).lab : null) ?? (adding ? DEFAULT_LAB : settings().lab ?? DEFAULT_LAB);
  main().replaceChildren(signInCard({ authUrl: CONFIG.authUrl, err: err || st.signinErr || '', adding, login, lab: lab0,
    // (to GitHub through the service; this tab keeps the nonce it expects back, how to keep the account, and the lab)
    onOAuth: ({ remember, lab }) => {
      const nonce = S.newNonce();
      TAB.setItem(SIGNIN, JSON.stringify({ nonce, remember, lab, at: Date.now() }));
      location.assign(S.loginUrl(CONFIG.authUrl, { returnTo: location.href, select: adding, login, nonce }));
    },
    onToken: async ({ token, lab, remember }) => {
      let me;
      try { me = await gh({ token }).me(); } catch (e) { return renderSignIn(e.message, { adding, login }); }
      A.add({ login: me.login, avatar: me.avatar_url, token, remember, cfg: { lab } });
      st.tab = 'overview'; st.target = 'lab';
      await connect();
    },
    back: (adding || login) && A.active() && st.me ? () => render() : null }));
  st.signinErr = null;
}
function renderLocked(why) {
  // (someone the lab's owner did not invite: the one thing offered is to lend their own Actions minutes — ui/lend.mjs)
  if (st.me) return main().replaceChildren(h('p', { class: 'muted' }, why), lendStart({ api: st.api, me: st.me, labSlug: settings().lab, oauth: A.session(st.login)?.kind === 'oauth', appSlug: CONFIG.appSlug,
    onReady: (slug) => { saveSettings({ hosts: [...new Set([...settings().hosts, slug])] }); st.tab = 'hosts'; st.routed = true; connect(); },
    other: () => { A.remove(st.login); Object.assign(st, { login: null, me: null }); renderWho(); renderSignIn(); } }));
  main().replaceChildren(h('div', { class: 'card' }, h('h2', {}, '🔒 使えません'), h('p', {}, why),
    h('button', { onclick: () => { A.remove(st.login); Object.assign(st, { login: null, me: null }); renderWho(); renderSignIn(); } }, '別のアカウントで入る')));
}

// ---- connecting: who, the lab, its policy, the hosts ----
async function connect() {
  clearInterval(st.timer);
  // (the panel of before accounts: one token, no login — it becomes this browser's first account)
  if (!A.list().length) {
    const old = A.legacy();
    if (old) {
      try { const me = await gh({ token: old.token }).me(); A.add({ login: me.login, avatar: me.avatar_url, token: old.token, remember: old.remember, cfg: old.cfg }); } catch { /* a token GitHub no longer takes */ }
      A.dropLegacy();
    }
  }
  // (a sign-in just handed back: the account it is — kept as this tab asked when it began)
  if (HANDOFF?.tokens && !st.handed) {
    st.handed = true;
    const t = S.fromHandoff(HANDOFF.tokens);
    try { const me = await gh({ token: t.token }).me(); A.add({ login: me.login, avatar: me.avatar_url, ...t, kind: 'oauth', remember: PENDING?.remember !== false, cfg: M.SLUG.test(String(PENDING?.lab ?? '')) ? { lab: PENDING.lab } : null }); }
    catch (e) { st.signinErr = e.message; }
  }
  // (an address that names a run — Discord's 「管理パネル」 button — opens with the account whose lab that run is in)
  const want = st.routed ? { tab: null, repo: null, run: null } : M.parseHash(location.hash);
  if (want.repo) { const who = A.list().find((e) => String(A.cfg(e.login).lab).toLowerCase() === want.repo.toLowerCase()); if (who) A.use(who.login); }
  const login = A.active();
  if (!login) { renderWho(); return renderSignIn(); }
  if (st.signinErr) { toast(st.signinErr, true); st.signinErr = null; }
  st.login = login; st.me = null;
  if (!A.token(login)) { A.remove(login); return connect(); }
  if (!(await freshen(login))) return renderSignIn(st.signinErr, { login });
  st.apiToken = null; useToken(A.token(login));
  renderWho();
  main().replaceChildren(h('p', { class: 'muted' }, `GitHub に聞いています…（${login}）`));
  try { st.me = await st.api.me(); } catch (e) { return renderSignIn(e.message, { login }); }
  st.lastActive = Date.now();
  renderWho();
  const s = settings();
  let labRepo = null; try { labRepo = await st.api.repo(s.lab); } catch { /* not visible to this account */ }
  st.lab = labRepo ? { slug: s.lab, repo: labRepo, role: M.roleOf(labRepo.permissions) } : null;
  st.hosts = await loadHosts(s.hosts);
  let a = M.access({ lab: labRepo, hosts: st.hosts.filter((x) => x.repo).map((x) => x.repo) });
  // (a lender's first visit: no host in this account's settings yet — their own hosts looked for before the door shuts)
  if (!a.ok && !s.hosts.length) {
    main().replaceChildren(h('p', { class: 'muted' }, '貸し借りのホストを探しています…'));
    const found = await findHosts().catch(() => []);
    if (found.length) { saveSettings({ hosts: found }); st.hosts = await loadHosts(found); a = M.access({ lab: labRepo, hosts: st.hosts.filter((x) => x.repo).map((x) => x.repo) }); }
  }
  st.as = a.as;
  if (!a.ok) return renderLocked(a.why);
  if (canLab()) await loadEnv(st.lab);
  await loadPolicy();
  if (!st.routed) {
    st.routed = true;
    if (want.tab) st.tab = want.tab;
    if (want.run && (!want.repo || want.repo.toLowerCase() === String(st.lab?.slug).toLowerCase())) st.focus = { run: Number(want.run) };
  }
  render();
}
/** the lab's policy and this person's role in it (the organization's teams it names, when GitHub lets this account read
 *  them: else every role they might have counts, and only what all of them allow is offered) */
async function loadPolicy() {
  if (!st.lab) { Object.assign(st, { policy: P.DEFAULT_POLICY, policyErrors: [], role: null, audit: 'off' }); return; }
  const pol = await P.loadPolicy(st.api, st.lab.slug), org = st.lab.repo.owner?.type === 'Organization' ? st.lab.repo.owner.login : null;
  const teams = org && Object.keys(pol.policy.teams ?? {}).length ? await P.teamsOf(st.api, org, st.me.login, pol.policy) : [];
  Object.assign(st, { policy: pol.policy, policyErrors: pol.errors, role: P.roleFor({ repoRole: st.lab.repo.permissions, teams, policy: pol.policy }), audit: P.auditMode(pol.policy, st.lab.repo.visibility) });
}
/** a host: its repository, its .lab-host.json read and checked; one this account cannot see is kept with the reason */
async function loadHost(slug) {
  let repo;
  try { repo = await st.api.repo(slug); } catch (e) { return { slug, error: e.status === 404 ? (A.session(st.login)?.kind === 'oauth' ? 'このアカウントでは見えません（招待を受けていないか、貸し手がラボの GitHub App をこのホストに入れていません: 「準備」のリンクを貸し手に）' : 'このトークンでは見えません（招待を受けていない・トークンの対象にない。Fine-grained トークンはほかの人の個人アカウントのリポジトリを選べません: 「GitHub でサインイン」か Classic トークンを）') : e.message }; }
  const f = await st.api.file(slug, '.lab-host.json').catch(() => null);
  let json = null, parsed = { rules: null, errors: ['.lab-host.json がありません'] };
  if (f) { try { json = JSON.parse(f.text); parsed = M.checkRules(json); } catch { parsed = { rules: null, errors: ['.lab-host.json が JSON ではありません'] }; } }
  return { slug, repo, file: f, json, ...parsed, role: M.roleOf(repo.permissions) === 'admin' ? 'lender' : M.roleOf(repo.permissions) === 'write' ? 'borrower' : 'read' };
}
async function loadHosts(list) { const out = []; for (const slug of list) out.push(await loadHost(slug)); return out; }
/** this account's hosts: its repositories (owned or as a collaborator, the 40 pushed last) with a .lab-host.json */
async function findHosts() {
  const found = [];
  for (const r of (await st.api.myRepos()).filter((x) => !x.fork && !x.archived).slice(0, 40)) if (await st.api.file(r.full_name, '.lab-host.json').catch(() => null)) found.push(r.full_name);
  return found;
}
/** a host now: its runs this month (GitHub's count, everyone's), what it allows now (cached for a minute) */
async function hostUse(x) {
  if (x.use && Date.now() - x.use.at < 60_000) return x.use;
  const tz = x.rules.timezone, month = M.monthOf(new Date(), tz), from = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const rs = await st.api.runs(x.slug, { workflow: 'host.yml', created: `>=${from}`, per: 100 }).catch(() => []);
  const used = M.monthMinutes(rs, month, tz);
  x.use = { at: Date.now(), rs, used, month, now: M.hostNow(x.rules, used, new Date(), rs.some((r) => r.status !== 'completed')) };
  return x.use;
}
/** a repository's own settings: its secrets' and variables' names (null: may not look), its workflows */
async function loadEnv(x) {
  x.secrets = await st.api.secretNames(x.slug).catch(() => null);
  x.vars = await st.api.variableNames(x.slug).catch(() => null);
  x.workflows = await st.api.workflows(x.slug).catch(() => []);
  x.caps = M.capabilities({ secrets: x.secrets, workflows: x.workflows, visibility: x.repo.visibility, vars: x.vars });
}
const capsOf = () => Object.fromEntries((st.lab?.caps ?? []).map((c) => [c.key, c]));
const hasWf = (f) => (st.lab?.workflows ?? []).some((w) => String(w.path).endsWith(`/${f}`));

// ---- the frame: tabs ----
const TABS = [['overview', '概要'], ['runs', '進み具合'], ['start', '実行'], ['files', '成果物'], ['discord', 'Discord'], ['secrets', '秘密'], ['live', '端末'], ['hosts', '貸し借り'], ['members', 'メンバー'], ['setup', '準備'], ['audit', '監査'], ['settings', '設定']];
function render() {
  clearInterval(st.timer);
  renderWho();
  const tabs = TABS.filter(([k]) => (k === 'audit' ? may('audit.read') : canLab() || ['overview', 'hosts', 'settings'].includes(k)));
  if (!tabs.some(([k]) => k === st.tab)) st.tab = tabs[0][0];
  const body = h('div', { id: 'tabbody' });
  main().replaceChildren(h('nav', { class: 'tabs' }, tabs.map(([k, label], i) => h('button', { class: st.tab === k ? 'on' : '', 'data-tab': k, title: i < 10 ? `キー ${(i + 1) % 10}` : null, onclick: () => go(k) }, label))), body);
  ({ overview, runs, start, files, discord, secrets, live, hosts, members, setup, audit, settings: settingsTab })[st.tab](body);
}
/** another tab (the address follows: a reload or a shared link opens the same tab) */
function go(tab) { st.tab = tab; history.replaceState(null, '', `#${tab}`); render(); }
const every = (fn) => { clearInterval(st.timer); st.timer = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, Math.max(5, settings().refresh) * 1000); };

// ---- 準備 (ui/setup.mjs) and 監査 (ui/audit.mjs) ----
function setup(body) {
  setupTab(body, { api: st.api, lab: { slug: st.lab.slug, repo: st.lab.repo, role: st.lab.role, secrets: st.lab.secrets, workflows: st.lab.workflows }, hosts: st.hosts, me: st.me, config: CONFIG,
    panelUrl: `${location.origin}${location.pathname}`, signedInWithApp: A.session(st.login)?.kind === 'oauth', storage: TAB, appReturn: APP_RETURN, policy: st.policy, role: st.role,
    reload: async () => { await loadEnv(st.lab); if (st.tab === 'setup') render(); }, record: (action, detail) => record(action, detail) });
}
function audit(body) { auditTab(body, { api: st.api, lab: st.lab, policy: st.policy, role: st.role }); }
function members(body) { membersTab(body, { api: st.api, lab: st.lab, me: st.me, policy: st.policy, role: st.role, policyErrors: st.policyErrors, may, guarded, reload: async () => { await loadPolicy(); render(); } }); }

// ---- runs that end while the panel is open: told on this device (a notification when allowed, else a toast) and counted
// in the tab's title — opt-in in 「設定」, kept per browser ----
const NOTIFY_KEY = 'bdslab.panel.notify', BASE_TITLE = document.title, watched = new Map();
const notifyOn = () => LOCAL.getItem(NOTIFY_KEY) === '1';
setInterval(async () => {
  if (!st.lab || !st.api || !canLab() || document.hidden && !notifyOn()) return;
  let rs; try { rs = await st.api.runs(st.lab.slug, { per: 20 }); } catch { return; }
  const ended = watched.size ? M.endedSince(watched, rs) : [];
  watched.clear(); for (const r of rs) watched.set(r.id, r.status);
  const going = rs.filter((r) => r.status !== 'completed').length;
  document.title = going ? `(${going}) ${BASE_TITLE}` : BASE_TITLE;
  for (const r of ended) {
    const say = `${M.STATE_ICON[r.conclusion] ?? '•'} ${r.name}: ${r.conclusion}（${r.head_branch}）`;
    if (notifyOn() && globalThis.Notification?.permission === 'granted') {
      try { const n = new globalThis.Notification('bds-lab', { body: say, tag: `run-${r.id}` }); n.onclick = () => { window.focus(); st.focus = { run: r.id }; go('runs'); }; continue; } catch { /* a phone's browser makes them only from a service worker */ }
    }
    toast(say, r.conclusion !== 'success');
  }
}, 45_000);

// ---- is this page the newest the lab published? (config.json's version against pages.yml's last run) — a change pushed
// is said when it is live, with a way to read it again ----
st.version = DBG.versionState(CONFIG.version, []);
async function checkVersion() {
  if (!st.lab || !st.api || !CONFIG.version) return st.version;
  let rs; try { rs = await st.api.runs(st.lab.slug, { per: 1, workflow: 'pages.yml' }); } catch { return st.version; }
  const was = st.version.state, v = DBG.versionState(CONFIG.version, rs);
  st.version = v;
  if (v.state !== was && (v.state === 'newer' || v.state === 'failed')) toast(v.say, v.state === 'failed');
  return v;
}
setInterval(() => { if (document.visibilityState === 'visible') checkVersion(); }, 120_000);

// ---- keys (outside a text box): 1–9, 0 the tabs shown, / search the runs, r read again, ? which keys ----
const shownTabs = () => [...document.querySelectorAll('nav.tabs button')].map((b) => b.dataset.tab);
const KEYS_HELP = '1〜9・0: タブ　/: 実行を探す　r: 読み直す　?: この知らせ';
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || !st.lab || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable) return;
  const k = M.shortcut(e.key, shownTabs()); if (!k) return;
  e.preventDefault();
  if (k.tab) go(k.tab);
  else if (k.reload) render();
  else if (k.help) toast(KEYS_HELP);
  else if (k.search) { if (st.tab !== 'runs') go('runs'); document.querySelector('input[type=search]')?.focus(); }
});

// ---- 概要 ----
function overview(body) {
  const ses = A.session(st.login);
  body.append(h('div', { class: 'card' }, h('h2', {}, `${st.me.login} さん`), h('p', {}, 'あなたは: ', st.as.map((r) => h('span', { class: 'chip' }, M.ROLE_NAMES[r])), ' ',
      st.lab ? h('span', { class: 'chip' }, `役割 ${roleName()}`) : null),
    h('p', { class: 'muted' }, ses?.kind === 'oauth' ? `GitHub でサインイン（ラボの App）${ses.expiresAt ? `・${new Date(ses.expiresAt).toLocaleTimeString()} まで（自動で更新）` : ''}` : 'トークンで入っています', `・GitHub の残り回数: ${st.api.state.remaining ?? '?'}`),
    // (the lab's policy as it was read: a broken one allows nothing — said, with what is wrong, to whoever can fix it)
    st.policyErrors.length ? h('div', { class: 'bad' }, `${P.POLICY_FILE} が正しくありません: パネルは何も許しません（直すまで）`, h('ul', {}, st.policyErrors.map((e) => h('li', {}, e)))) : null,
    h('div', { id: 'version' }),
    !CONFIG.authUrl && st.lab?.role === 'admin' ? h('p', { class: 'warn' }, '「GitHub でサインイン」はまだ使えません: ', h('button', { onclick: () => go('setup') }, '「準備」で整える'), '（App・サインインのサービス・Pages）') : null));
  checkVersion().then((v) => $('version')?.replaceChildren(...(v.state === 'newer' ? [h('p', { class: 'warn' }, v.say, ' ', h('button', { onclick: () => location.reload() }, '読み直す'))] : v.state === 'deploying' || v.state === 'failed' ? [h('p', { class: v.state === 'failed' ? 'bad' : 'muted' }, v.say)] : [])));
  if (st.lab && st.lab.caps) {
    body.append(h('div', { class: 'card' }, h('h2', {}, st.lab.slug, h('span', { class: 'chip' }, M.ROLE_NAMES[st.lab.role]), h('span', { class: 'chip' }, st.lab.repo.visibility), link(st.lab.repo.html_url, 'GitHub')),
      h('h3', {}, 'このリポジトリの設定でできること'),
      h('ul', { class: 'plain' }, st.lab.caps.map((c) => h('li', {}, c.ok === null ? '❔ ' : c.ok ? '✅ ' : '⚠️ ', c.label, c.need ? h('div', { class: 'muted' }, c.need) : null))),
      h('div', { id: 'ovruns' }, h('p', { class: 'muted' }, '実行を読んでいます…'))));
    act(async () => {
      const [all, prs] = await Promise.all([st.api.runs(st.lab.slug, { per: 50 }), st.api.pulls(st.lab.slug).catch(() => [])]), rs = all.slice(0, 20);
      const going = rs.filter((r) => r.status !== 'completed'), bad = rs.filter((r) => r.conclusion === 'failure');
      const last = bad[0];
      $('ovruns')?.replaceChildren(h('h3', {}, '最近'), h('p', {}, `動いている ${going.length}・失敗 ${bad.length}（最近 ${rs.length} 件）・開いている PR ${prs.length}`),
        // (one tap for what is wanted most: the last failure again, what runs now, what failed)
        h('div', { class: 'row' }, last ? h('button', { ...gate('dispatch'), onclick: () => guarded('dispatch', { run: String(last.id), workflow: String(last.path ?? '').split('/').pop() }, () => st.api.rerunFailed(st.lab.slug, last.id), `${last.name} の落ちたジョブをやり直します`) }, `🔁 ${last.name} をやり直す`) : null,
          going.length ? h('button', { onclick: () => { st.runsShow = 'going'; go('runs'); } }, `🔄 動いている ${going.length} 件を見る`) : null,
          bad.length ? h('button', { onclick: () => { st.runsShow = 'failed'; go('runs'); } }, '❌ 落ちたものを見る') : null),
        h('ul', { class: 'plain' }, rs.slice(0, 5).map((r) => h('li', {}, M.STATE_ICON[r.status === 'completed' ? r.conclusion : r.status] ?? '•', ' ', link(r.html_url, r.name), ' ', h('span', { class: 'muted' }, `${r.head_branch} · ${M.ago(r.created_at)}`)))),
        healthTable(M.workflowHealth(all), all.length));
    });
  } else if (st.lab) body.append(h('div', { class: 'card' }, h('h2', {}, st.lab.slug), h('p', { class: 'muted' }, `このリポジトリは ${M.ROLE_NAMES[st.lab.role] ?? '見えない'} です: 実行・秘密・端末は、書き込める人だけ`)));
  for (const x of st.hosts) body.append(hostCard(x, true));
  if (!st.hosts.length) body.append(h('div', { class: 'card' }, h('h2', {}, '貸し借り（ホスト）'), h('p', { class: 'muted' }, 'まだありません。「貸し借り」で探すか加えます。')));
  const others = A.list().filter((e) => e.login !== st.login);
  if (others.length) body.append(h('div', { class: 'card' }, h('h2', {}, 'このブラウザのほかのアカウント'),
    h('ul', { class: 'plain' }, others.map((e) => h('li', { class: 'row' }, h('span', { class: 'grow' }, e.login, ' ', h('span', { class: 'muted' }, `${A.cfg(e.login).lab}・ホスト ${A.cfg(e.login).hosts.length}`)), h('button', { onclick: () => switchTo(e.login) }, '切り替える'))))));
}

/** each workflow over the last runs: how often it passes, how long it takes, failing in a row — a tap shows its runs */
function healthTable(hs, n) {
  if (!hs.length) return null;
  return h('div', { id: 'health' }, h('h3', {}, `ワークフローの調子（最近 ${n} 件）`), h('table', {}, h('thead', {}, h('tr', {}, ['', '通った', 'かかる', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, hs.map((x) => h('tr', { 'data-health': x.path },
      h('td', {}, x.streak ? '❌ ' : x.rate === 1 ? '✅ ' : '➖ ', h('button', { class: 'linkish', onclick: () => { st.runsQ = x.name; st.runsShow = 'all'; go('runs'); } }, x.name)),
      h('td', {}, x.rate === null ? '—' : `${Math.round(x.rate * 100)}%（${x.ok}/${x.ok + x.bad}）`), h('td', {}, x.ms ? M.fmtMs(x.ms) : '—'),
      h('td', {}, x.streak ? h('span', { class: 'chip bad' }, `${x.streak} 回続けて失敗`) : null))))));
}

// ---- 進み具合 (the lab's runs, or a host's: where the jobs ran) ----
function runs(body) {
  // (a run still going shows its progress by itself, until it is closed by hand)
  const sources = [st.lab.slug, ...st.hosts.filter((x) => x.repo).map((x) => x.slug)];
  if (!sources.includes(st.runsFrom)) st.runsFrom = st.lab.slug;
  const from = st.runsFrom, isLab = from === st.lab.slug;
  const list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…')), open = new Set(), shut = new Set();
  const focus = st.focus; st.focus = null;
  if (focus && isLab) open.add(focus.run);
  // (narrowed as typed: a word in its name, title, branch or who started it; failed, going or mine)
  const q = h('input', { type: 'search', placeholder: '探す（名前・枝・人）', value: st.runsQ ?? '', 'aria-label': '実行を探す', oninput: () => { st.runsQ = q.value; load(); } });
  const show = h('select', { 'aria-label': 'どの実行', onchange: () => { st.runsShow = show.value; load(); } }, [['all', 'すべて'], ['failed', '落ちたもの'], ['going', '動いているもの'], ['mine', '自分の']].map(([v, t]) => h('option', { value: v, selected: v === (st.runsShow ?? 'all') ? 'selected' : null }, t)));
  const stopAll = h('button', { class: 'danger', hidden: true, ...gate('run.cancel') });
  const load = () => act(async () => {
    const all = await st.api.runs(from, { per: 50 }), rs = M.filterRuns(all, { q: q.value, show: show.value, me: st.me.login });
    for (const r of rs) if (r.status !== 'completed' && !shut.has(r.id)) open.add(r.id);
    const going = rs.filter((r) => r.status !== 'completed');
    stopAll.hidden = !isLab || going.length < 2; stopAll.textContent = `⏹ 動いている ${going.length} 件を全部止める`;
    // (asked once for all of them; each one kept in the audit log as its own; one that ended meanwhile is no error: 409)
    stopAll.onclick = async () => {
      if (!may('run.cancel')) return toast(notMine('run.cancel'), true);
      if (!confirm(`動いている ${going.length} 件を全部止めますか`)) return;
      for (const r of going) if (await act(() => st.api.cancel(from, r.id).then(() => true, (e) => { if (e.status !== 409) throw e; return true; }))) record('run.cancel', { run: String(r.id), workflow: String(r.path ?? '').split('/').pop() });
      toast(`${going.length} 件を止めるよう頼みました`); load();
    };
    if (!rs.length) list.replaceChildren(h('p', { class: 'muted' }, all.length ? '当てはまる実行がありません（最近の 50 件）' : 'まだ実行がありません'));
    else list.replaceChildren(...rs.map((r) => {
      const state = r.status === 'completed' ? r.conclusion : r.status, box = h('div', { class: 'jobs' });
      const row = h('div', { class: 'card', 'data-run': r.id },
        h('div', { class: 'row' }, h('strong', {}, `${M.STATE_ICON[state] ?? '•'} ${r.name}`), h('span', { class: 'chip' }, r.event), h('span', { class: 'muted grow' }, `${r.head_branch} · ${r.triggering_actor?.login ?? r.actor?.login ?? ''} · ${M.ago(r.created_at)}`),
          r.status !== 'completed' ? h('button', { class: 'danger', ...(isLab ? gate('run.cancel') : {}), onclick: () => (isLab ? guarded('run.cancel', { run: String(r.id), workflow: String(r.path ?? '').split('/').pop() }, () => st.api.cancel(from, r.id), '止めるよう頼みました') : act(() => st.api.cancel(from, r.id), '止めるよう頼みました')) }, '止める') : null,
          r.conclusion === 'failure' ? h('button', { ...(isLab ? gate('dispatch') : {}), onclick: () => (isLab ? guarded('dispatch', { run: String(r.id), workflow: String(r.path ?? '').split('/').pop() }, () => st.api.rerunFailed(from, r.id), '失敗したジョブをやり直します') : act(() => st.api.rerunFailed(from, r.id), '失敗したジョブをやり直します')) }, 'やり直す') : null,
          h('button', { onclick: () => { if (open.has(r.id)) { open.delete(r.id); shut.add(r.id); } else { open.add(r.id); shut.delete(r.id); } detail(from, r, box, open.has(r.id)); } }, '詳しく'), link(r.html_url, 'GitHub')),
        box);
      if (open.has(r.id)) detail(from, r, box, true);
      return row;
    }));
    if (focus && isLab) { const c = list.querySelector(`[data-run="${focus.run}"]`); if (c) c.scrollIntoView({ block: 'start' }); else toast(`実行 ${focus.run} は最近の 25 件にありません`, true); }
  });
  const pick = sources.length > 1 ? h('select', { 'aria-label': 'どこの実行', onchange: (e) => { st.runsFrom = e.target.value; render(); } }, sources.map((s) => h('option', { value: s, selected: s === from ? 'selected' : null }, s === st.lab.slug ? `ラボ: ${s}` : `ホスト: ${s}`))) : null;
  body.append(h('div', { class: 'row' }, pick, q, show, h('button', { onclick: load }, '読み直す'), h('span', { class: 'muted' }, `（${settings().refresh} 秒ごと）`), stopAll), list);
  load(); every(load);
}
async function detail(slug, r, box, show) {
  if (!show) return box.replaceChildren();
  box.replaceChildren(h('span', { class: 'muted' }, '…'));
  await act(async () => {
    const [jobs, arts] = await Promise.all([st.api.jobs(slug, r.id), r.status === 'completed' ? st.api.artifacts(slug, { run: r.id }).catch(() => []) : []]);
    const p = M.progress(r, jobs);
    const parts = [h('div', { class: 'bar' + (p.state === 'failure' ? ' bad' : '') }, h('i', { style: { width: `${p.pct}%` } })), h('div', { class: 'muted' }, `${p.done}/${p.total} 段 · ${M.fmtMs(p.ms)}${p.now ? ` · いま: ${p.now}` : ''}`)];
    for (const j of p.jobs) parts.push(h('div', {}, `${M.STATE_ICON[j.state] ?? '•'} ${j.name} — ${j.done}/${j.total}${j.now ? `（${j.now}）` : ''}`));
    // (a failed job's own words: its check run's annotations)
    for (const j of jobs.filter((x) => x.conclusion === 'failure').slice(0, 3)) {
      const id = String(j.check_run_url ?? '').split('/').pop();
      const an = id ? await st.api.annotations(slug, id).catch(() => []) : [];
      if (an.length) parts.push(h('pre', {}, an.slice(0, 8).map((a) => `${a.annotation_level}: ${a.title ? a.title + ' — ' : ''}${a.message}`).join('\n')));
    }
    if (arts.length) parts.push(artifactList(slug, r.id, arts, r.html_url));
    box.replaceChildren(...parts);
  });
}
/** a run's artifacts: names and sizes, GitHub's page to take them, and (the lab's runs) sent to Discord by notify */
function artifactList(slug, runId, arts, runUrl) {
  const c = capsOf().notify, live = arts.filter((a) => !a.expired), mine = slug === st.lab?.slug && hasWf('notify.yml');
  return h('div', { class: 'files' }, h('div', {}, '📦 成果物: ', arts.map((a) => h('span', { class: 'chip' }, `${a.name}（${M.fmtBytes(a.size_in_bytes ?? 0)}${a.expired ? '・期限切れ' : ''}）`))),
    h('div', { class: 'row' }, live.length ? link(`${runUrl ?? `https://github.com/${slug}/actions/runs/${runId}`}#artifacts`, 'GitHub で取る') : null,
      mine && live.length ? h('button', { disabled: c?.ok === false, title: c?.ok === false ? c.need : null, onclick: () => sendToDiscord(runId) }, '📨 Discord に送る') : null));
}
/** notify.yml started for a run: its message and its deliverables (.mcaddon …) to the person's Discord, LAB_NOTIFY aside */
const sendToDiscord = (runId) => guarded('dispatch', { workflow: 'notify.yml', run: String(runId) }, () => st.api.dispatch(st.lab.slug, 'notify.yml', st.lab.repo.default_branch, { run: String(runId), message: '' }), `実行 ${runId} を Discord に送ります（notify: 成果物は 10 MB まで添えます）`);

// ---- 実行 (where: this lab's own Actions, or a lender's host) ----
function start(body) {
  const caps = capsOf(), hosts = st.hosts.filter((x) => x.rules && (x.role === 'borrower' || x.role === 'lender'));
  if (!hosts.some((x) => x.slug === st.target)) st.target = 'lab';
  const where = h('div', { class: 'card' }, h('h2', {}, 'どこの Actions で走らせる'),
    h('ul', { class: 'plain targets' }, [
      h('li', {}, h('label', {}, h('input', { type: 'radio', name: 'target', value: 'lab', checked: st.target === 'lab', onchange: () => { st.target = 'lab'; render(); } }), h('span', { class: 'grow' }, h('strong', {}, 'このラボ'), ` ${st.lab.slug}（${st.lab.repo.owner?.login ?? st.lab.slug.split('/')[0]} の Actions）`))),
      ...hosts.map((x) => { const s = h('span', { class: 'muted' }, ' …'); hostUse(x).then((u) => s.replaceChildren(u.now.ok ? ` ✅ 今月 ${u.used}/${u.now.stopAt} 分` : ` ⏸ ${u.now.why[0]}`)).catch(() => s.replaceChildren(' ❔'));
        return h('li', {}, h('label', {}, h('input', { type: 'radio', name: 'target', value: x.slug, checked: st.target === x.slug, onchange: () => { st.target = x.slug; render(); } }), h('span', { class: 'grow' }, h('strong', {}, `${x.slug.split('/')[0]} さんの Actions`), ` ${x.slug}`, s))); }),
    ]),
    hosts.length ? null : h('p', { class: 'muted' }, '貸し手のホストは「貸し借り」で加えると、ここで選べます（その人の Actions の分で走ります）。'));
  body.append(where);
  if (st.target !== 'lab') return body.append(hostForm(hosts.find((x) => x.slug === st.target), caps), h('div', { id: 'dform' }));
  body.append(h('div', { class: 'card' }, h('h2', {}, 'すぐ始める'), h('ul', { class: 'plain' }, M.PRESETS.filter((p) => hasWf(p.workflow)).map((p) => {
    const c = p.needs ? caps[p.needs] : null, ok = !c || c.ok !== false;
    return h('li', {}, h('div', { class: 'row' }, h('span', { class: 'grow' }, p.label), h('button', { class: 'primary', disabled: !ok, onclick: () => dispatchForm(body, p.workflow, p.inputs) }, '開く')), ok ? null : h('div', { class: 'warn' }, c.need));
  }))));
  const sel = h('select', {}, (st.lab.workflows ?? []).filter((w) => w.state === 'active').map((w) => h('option', { value: w.path }, `${w.name}（${w.path.split('/').pop()}）`)));
  body.append(h('div', { class: 'card' }, h('h2', {}, 'ワークフローを選んで'), sel, h('div', { class: 'row' }, h('button', { onclick: () => dispatchForm(body, sel.value.split('/').pop(), {}) }, '入力を開く'))), h('div', { id: 'dform' }));
}
/** a job on a lender's host: the jobs their .lab-host.json allows, a unit for test / go / sim, started through hostrun.yml */
function hostForm(x, caps) {
  const c = caps.hostrun, ready = c?.ok !== false;
  const job = h('select', { id: 'hjob' }, x.rules.jobs.map((j) => h('option', { value: j }, M.HOST_JOB_WORDS[j] ?? j)));
  const unit = h('input', { type: 'text', id: 'hunit', placeholder: 'coins（bds/addons/<名前>）' }), wait = h('input', { type: 'checkbox', id: 'hwait', checked: true });
  const unitRow = h('div', {}, h('label', { for: 'hunit' }, 'ユニット'), unit), state = h('div', { class: 'muted' }, '今月の分を数えています…');
  const sync = () => { unitRow.hidden = !M.HOST_UNIT_JOBS.includes(job.value); };
  job.addEventListener('change', sync); sync();
  const btn = h('button', { class: 'primary', disabled: !ready, onclick: async () => {
    const r = M.hostRunInputs({ host: x.slug, job: job.value, unit: unit.value, wait: wait.checked, rules: x.rules });
    if (r.error) return toast(r.error, true);
    const ok = await guarded('hostrun', { host: x.slug, job: r.inputs.job, unit: r.inputs.unit || undefined }, () => st.api.dispatch(st.lab.slug, 'hostrun.yml', st.lab.repo.default_branch, r.inputs), `${x.slug} で ${r.inputs.job}${r.inputs.unit ? ` -a ${r.inputs.unit}` : ''} を始めました（「進み具合」の hostrun）`);
    if (ok !== undefined) { st.runsFrom = st.lab.slug; setTimeout(() => go('runs'), 2500); }
  } }, `${x.slug.split('/')[0]} さんの Actions で始める`);
  hostUse(x).then((u) => {
    state.replaceChildren(h('div', { class: 'bar' + (u.used >= u.now.stopAt ? ' bad' : '') }, h('i', { style: { width: `${Math.min(100, Math.round((u.used / Math.max(1, u.now.stopAt)) * 100))}%` } })),
      `今月 ${u.used} 分 / 止まる ${u.now.stopAt} 分（${x.rules.hours} ${x.rules.timezone}${x.rules.until ? `・${x.rules.until} まで` : ''}）`, u.now.ok ? h('div', { class: 'ok' }, '✅ いま使えます') : h('div', { class: 'warn' }, u.now.why.map((w) => `⏸ ${w}`).join(' / ')));
    if (!u.now.ok) btn.disabled = true;
  }).catch((e) => state.replaceChildren(e.message));
  return h('div', { class: 'card' }, h('h2', {}, `${x.slug} で走らせる`, h('span', { class: 'chip' }, M.ROLE_NAMES[x.role])),
    h('p', { class: 'muted' }, `ラボ（${st.lab.slug}）の hostrun が、あなたのトークン（LAB_HOST_TOKEN）でラボを ${x.slug} に送り、そこで仕事を走らせます。分は持ち主（${x.slug.split('/')[0]} さん）のもの、貸す条件の中だけ。`), state,
    ready ? null : h('div', { class: 'warn' }, c.need, ' ', h('button', { onclick: () => { st.prefill = 'LAB_HOST_TOKEN'; go('secrets'); } }, '「秘密」で登録する')),
    h('label', { for: 'hjob' }, '仕事'), job, unitRow, h('label', {}, wait, ' 結果を待つ（この実行の結果・Discord の知らせ・成果物になる。待たなければ結果は「進み具合」のホストで）'),
    h('div', { class: 'row' }, btn));
}
async function dispatchForm(body, file, preset) {
  const box = $('dform') ?? body;
  box.replaceChildren(h('p', { class: 'muted' }, `${file} を読んでいます…`));
  await act(async () => {
    const f = await st.api.file(st.lab.slug, `.github/workflows/${file}`), d = M.dispatchInputs(f?.text ?? '');
    if (!d.dispatch) return box.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'warn' }, `${file} は手で始められません（workflow_dispatch がありません）`)));
    const fields = {}, ref = h('input', { type: 'text', value: st.lab.repo.default_branch });
    const rows = d.inputs.map((i) => {
      const v = preset[i.name] ?? i.default;
      const el = i.options.length ? h('select', {}, i.options.map((o) => h('option', { value: o, selected: String(o) === String(v) ? 'selected' : null }, o)))
        : i.type === 'boolean' ? h('input', { type: 'checkbox', checked: String(v) === 'true' }) : h('input', { type: 'text', value: v });
      fields[i.name] = el;
      return h('div', {}, h('label', {}, `${i.name}${i.description ? ` — ${i.description}` : ''}`), el);
    });
    box.replaceChildren(h('div', { class: 'card' }, h('h2', {}, `${file} を始める`), h('label', {}, '枝（ref）'), ref, rows,
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => {
        const values = Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.type === 'checkbox' ? el.checked : el.value]));
        const body = M.dispatchBody(d.inputs, values);
        const ok = await guarded('dispatch', { workflow: file, ref: ref.value.trim(), inputs: Object.keys(body) }, () => st.api.dispatch(st.lab.slug, file, ref.value.trim(), body), `${file} を始めました（「進み具合」で見られます）`);
        if (ok !== undefined) { st.tab = 'runs'; setTimeout(render, 2500); }
      } }, '始める'))));
    box.scrollIntoView?.({ block: 'nearest' });
  });
}

// ---- 成果物 ----
function files(body) {
  const list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…'));
  body.append(h('div', { class: 'card' }, h('h2', {}, '成果物（実行が残したもの）'),
    h('p', { class: 'muted' }, 'アドオンの .mcaddon などは、実行の成果物（GitHub が 7〜90 日とっておきます）にあります。「Discord に送る」で、その実行の知らせと一緒に Discord の DM（か Webhook）へ 10 MB まで添えます。')), list);
  act(async () => {
    const arts = await st.api.artifacts(st.lab.slug, { per: 50 }), byRun = new Map();
    for (const a of arts) { const id = a.workflow_run?.id ?? 0; if (!byRun.has(id)) byRun.set(id, []); byRun.get(id).push(a); }
    if (!byRun.size) return list.replaceChildren(h('p', { class: 'muted' }, 'まだありません。'));
    list.replaceChildren(...[...byRun].map(([id, as]) => h('div', { class: 'card' }, h('h2', {}, `実行 ${id}`, h('span', { class: 'muted' }, `${as[0].workflow_run?.head_branch ?? ''} · ${M.ago(as[0].created_at)}`)), artifactList(st.lab.slug, id, as, `https://github.com/${st.lab.slug}/actions/runs/${id}`))));
  });
}

// ---- Discord: where the news goes, what goes along, and what Discord can do from here ----
function discord(body) {
  const names = new Set(st.lab.secrets ?? []), known = Array.isArray(st.lab.secrets), caps = capsOf();
  const row = (name, what, check, ph) => {
    const v = h('input', { type: 'password', autocomplete: 'off', placeholder: ph, 'aria-label': name });
    return h('li', {}, h('div', {}, known ? (names.has(name) ? '✅ ' : '・ ') : '❔ ', h('strong', {}, name), ' ', h('span', { class: 'muted' }, what)),
      h('div', { class: 'row' }, v, h('button', { onclick: async () => {
        const val = v.value.trim();
        if (!val) return toast('値が空です', true);
        if (check && !check(val)) return toast(`${name} の形が違います`, true);
        const ok = await guarded('secrets.put', { name }, () => st.api.putSecret(st.lab.slug, name, val), `${name} を登録しました`);
        if (ok !== undefined) { v.value = ''; await loadEnv(st.lab); render(); }
      } }, names.has(name) ? '入れ替える' : '登録')));
  };
  body.append(h('div', { class: 'card' }, h('h2', {}, `Discord とつなぐ（${st.lab.slug}）`),
    h('p', { class: 'muted' }, '自分のボット（Discord Developer Portal → New Application → Bot → Reset Token）を自分のサーバーに招き、そのサーバーで「メンバーからの DM」を許すと、ボットが DM で知らせ・端末の画面とボタン・秘密のフォームを送ります。ボットなしなら Webhook（チャンネルの設定 → 連携サービス → ウェブフック）でも知らせと成果物は届きます。値はこのブラウザで封じて送ります。'),
    h('ul', { class: 'plain' },
      row('DISCORD_BOT_TOKEN', 'ボットのトークン', (x) => x.length > 30 && !/\s/.test(x), 'MTA…'),
      row('DISCORD_USER_ID', 'あなたの Discord のユーザー ID（設定 → 詳細設定 → 開発者モード → プロフィールで ID をコピー）', (x) => M.DISCORD_ID.test(x), '123456789012345678'),
      row('LAB_NOTIFY_WEBHOOK', 'ボットのかわりに: Webhook の URL', (x) => /^https:\/\//.test(x), 'https://…/api/webhooks/…')),
    h('p', {}, caps.discord?.ok ? '✅ DM で届きます' : caps.notify?.ok ? '✅ Webhook で届きます（端末の操作・秘密のフォームはボットが要ります）' : '⚠️ まだ届きません（上のどちらか）')));
  const when = h('select', { 'aria-label': 'LAB_NOTIFY' }, Object.entries(M.NOTIFY_WHEN).map(([k, v]) => h('option', { value: k }, `${k}: ${v}`)));
  const what = h('select', { 'aria-label': 'LAB_NOTIFY_FILES' }, Object.entries(M.NOTIFY_FILES).map(([k, v]) => h('option', { value: k }, `${k}: ${v}`)));
  const note = h('p', { class: 'muted' }, 'リポジトリの変数を読んでいます…');
  body.append(h('div', { class: 'card' }, h('h2', {}, '知らせる実行と、添えるもの'),
    h('label', {}, 'どの実行を知らせる（変数 LAB_NOTIFY）'), when, h('label', {}, '添える成果物（変数 LAB_NOTIFY_FILES）'), what, note,
    h('div', { class: 'row' }, h('button', { class: 'primary', ...gate('variables'), onclick: () => guarded('variables', { name: 'LAB_NOTIFY' }, async () => { await st.api.setVariable(st.lab.slug, 'LAB_NOTIFY', when.value); await st.api.setVariable(st.lab.slug, 'LAB_NOTIFY_FILES', what.value); return true; }, '知らせ方を保存しました') }, '知らせ方を保存'))));
  act(async () => {
    try {
      const [w, f] = await Promise.all([st.api.variable(st.lab.slug, 'LAB_NOTIFY'), st.api.variable(st.lab.slug, 'LAB_NOTIFY_FILES')]);
      when.value = M.NOTIFY_WHEN[w] ? w : 'auto'; what.value = M.NOTIFY_FILES[f] ? f : 'auto';
      note.replaceChildren(`いま: LAB_NOTIFY=${w ?? '（なし: auto）'}・LAB_NOTIFY_FILES=${f ?? '（なし: auto）'}`);
    } catch (e) { note.replaceChildren(`変数を読めません（トークンに Variables: Read and write が要ります）: ${e.message}`); }
  });
  const go2 = (file, preset) => { st.tab = 'start'; st.target = 'lab'; render(); dispatchForm(main(), file, preset); };
  const btn = (label, cap, fn) => { const c = caps[cap]; return h('li', {}, h('div', { class: 'row' }, h('span', { class: 'grow' }, label), h('button', { disabled: c?.ok === false, onclick: fn }, '始める')), c?.ok === false ? h('div', { class: 'warn' }, c.need) : null); };
  body.append(h('div', { class: 'card' }, h('h2', {}, 'Discord で'), h('ul', { class: 'plain' },
    hasWf('notify.yml') ? btn('🔔 試しに送る', 'notify', () => guarded('dispatch', { workflow: 'notify.yml' }, () => st.api.dispatch(st.lab.slug, 'notify.yml', st.lab.repo.default_branch, { run: '', message: `bds-lab: ${st.me.login} さんが管理パネルから試しに送りました` }), '送るよう頼みました（数十秒で届きます）')) : null,
    hasWf('notify.yml') ? btn('📦 いちばん新しい成果物を送る', 'notify', () => act(async () => {
      const a = (await st.api.artifacts(st.lab.slug, { per: 20 })).find((x) => !x.expired && x.workflow_run?.id);
      if (!a) throw new Error('送れる成果物がありません');
      await sendToDiscord(a.workflow_run.id);
    })) : null,
    hasWf('app.yml') ? btn('🎮 スマホで端末を操作（DM に画面とボタン）', 'discord', () => go2('app.yml', { mode: 'hold', hold: '60' })) : null,
    hasWf('secrets.yml') ? btn('🔑 秘密を Discord のフォームで登録', 'secretsForm', () => go2('secrets.yml', { names: 'MS_EMAIL,MS_PASSWORD' })) : null)));
}

// ---- 秘密 ----
function secrets(body) {
  const list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…'));
  const name = h('input', { type: 'text', list: 'known', placeholder: 'MS_EMAIL', autocapitalize: 'characters', value: st.prefill ?? '' }), value = h('input', { type: 'password', autocomplete: 'new-password' });
  st.prefill = null;
  const load = () => act(async () => {
    const have = await st.api.secrets(st.lab.slug), names = new Set(have.map((s) => s.name)), at = new Map(have.map((s) => [s.name, s.updated_at]));
    // (when each was set: one not set again for half a year is said — a key or a password worth renewing)
    const age = (n) => { const a = M.secretAge(at.get(n)); return a.days === null ? null : h('span', { class: a.stale ? 'warn' : 'muted' }, a.stale ? ` ⚠️ ${a.days} 日前に登録（新しくするとよい）` : `（${M.ago(at.get(n))}に更新）`); };
    const stale = have.filter((s) => M.secretAge(s.updated_at).stale);
    list.replaceChildren(stale.length ? h('p', { class: 'warn' }, `${M.STALE_DAYS} 日以上そのままの秘密が ${stale.length} 個: ${stale.map((s) => s.name).join('・')}（上で同じ名前で登録し直すと新しくなります）`) : '', h('ul', { class: 'plain' },
      Object.entries(M.KNOWN_SECRETS).map(([n, what]) => h('li', {}, names.has(n) ? '✅ ' : '・ ', h('strong', {}, n), ' ', h('span', { class: 'muted' }, what), names.has(n) ? age(n) : null, names.has(n) ? h('button', { class: 'danger', ...gate('secrets.delete'), onclick: () => guarded('secrets.delete', { name: n }, () => st.api.deleteSecret(st.lab.slug, n), `${n} を消しました`).then(load) }, '消す') : null)),
      have.filter((s) => !M.KNOWN_SECRETS[s.name]).map((s) => h('li', {}, '✅ ', h('strong', {}, s.name), ' ', age(s.name), h('button', { class: 'danger', ...gate('secrets.delete'), onclick: () => guarded('secrets.delete', { name: s.name }, () => st.api.deleteSecret(st.lab.slug, s.name), `${s.name} を消しました`).then(load) }, '消す')))));
  });
  body.append(h('div', { class: 'card' }, h('h2', {}, '秘密を登録する'),
    h('p', { class: 'muted' }, '値はこのブラウザの中でリポジトリの公開鍵で封じてから GitHub に送ります（GitHub の Actions だけが開けます。このパネルも GitHub も値を表示しません）。'),
    h('datalist', { id: 'known' }, Object.keys(M.KNOWN_SECRETS).map((n) => h('option', { value: n }))),
    h('label', {}, '名前'), name, h('label', {}, '値'), value,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => {
      const n = name.value.trim().toUpperCase();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(n) || n.startsWith('GITHUB_')) return toast('名前は英大文字・数字・_（数字から始めない、GITHUB_ で始めない）', true);
      if (!value.value) return toast('値が空です', true);
      const ok = await guarded('secrets.put', { name: n }, () => st.api.putSecret(st.lab.slug, n, value.value), `${n} を登録しました`);
      if (ok !== undefined) { value.value = ''; load(); loadEnv(st.lab); }
    } }, '登録する'))),
  h('div', { class: 'card' }, h('h2', {}, 'このリポジトリの秘密'), list));
  if (name.value) value.focus();
  load();
}

// ---- 端末（ライブ） ----
function live(body) {
  const box = h('div', {}, h('p', { class: 'muted' }, '常駐している端末（app の mode hold）を探しています…'));
  body.append(box);
  act(async () => {
    const rs = (await st.api.runs(st.lab.slug, { workflow: 'app.yml', status: 'in_progress', per: 10 }));
    if (!rs.length) return box.replaceChildren(h('div', { class: 'card' }, h('p', {}, '動いている端末がありません。'), h('button', { class: 'primary', onclick: () => { st.tab = 'start'; st.target = 'lab'; render(); setTimeout(() => dispatchForm(main(), 'app.yml', { mode: 'hold', hold: '60' }), 50); } }, '端末を立てる（mode hold）')));
    box.replaceChildren(h('div', { class: 'card' }, h('h2', {}, '動いている端末'), h('ul', { class: 'plain' }, rs.map((r) => h('li', { class: 'row' }, h('span', { class: 'grow' }, `#${r.id} ${r.triggering_actor?.login ?? r.actor?.login} · ${M.ago(r.created_at)}`), h('button', { class: 'primary', onclick: () => controller(body, r) }, '操作する'))))));
  });
}
async function controller(body, run) {
  const starter = run.triggering_actor?.login ?? run.actor?.login, mine = starter === st.me.login, isPublic = st.lab.repo.visibility !== 'private';
  const key = await vaultKey({ cacheKey: settings().vault }).catch(() => null);
  const issues = await act(() => st.api.issues(st.lab.slug)), issue = LF.liveIssue(issues);
  const log = h('div', {}), shot = h('div', {}), since = new Date(Date.now() - 10 * 60_000).toISOString(), seen = new Set();
  let page = 'play';
  const send = async (text) => {
    if (!mine) return toast(`この端末を動かせるのは、実行を始めた ${starter} さんだけです`, true);
    if (!issue) return toast('ライブの issue がまだありません（端末が待つ状態になると作られます）', true);
    const b = await LF.commandBody(run.id, text, { isPublic, key });
    if (b === null) return toast('公開リポジトリです: 設定に APP_CACHE_KEY（Secrets と同じ鍵）を入れると、命令を封じて送れます', true);
    await act(() => st.api.comment(st.lab.slug, issue, b), `送りました: ${text.split('\n')[0]}`);
  };
  const pad = h('div', {});
  const drawPad = () => pad.replaceChildren(h('div', { class: 'pad' }, PAGES[page].flat().map(([label, cmd, style = 2]) => h('button', { class: `s${style}`, onclick: async () => {
    const to = /^#page:(\w+)$/.exec(cmd)?.[1];
    if (to) { page = to; return drawPad(); }
    if (cmd === '#chat') { const t = prompt('チャット（/ で始めればコマンド）'); if (t) send(`chat ${t}`); return; }
    if (cmd === '#cmd') { cmdBox.focus(); return; }
    send(cmd.split(' && ').join('\n'));
  } }, label))));
  const cmdBox = h('textarea', { placeholder: 'walk forward 2\nlook right 600\nwhere' });
  const poll = () => act(async () => {
    if (!issue) return;
    const cs = await st.api.comments(st.lab.slug, issue, since);
    for (const c of cs) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      // (the issue may be public: only what the run itself wrote — GitHub's Actions bot — is its answer, not a look-alike)
      if (c.user?.login !== 'github-actions[bot]') continue;
      const r = await LF.replyParts(c.body, run.id, { isPublic, key }), t = r ? null : await LF.tellText(c.body, run.id, { isPublic, key });
      if (r) {
        log.prepend(h('pre', {}, r.text ?? '（封じられています: 設定に APP_CACHE_KEY を入れると読めます）'));
        if (r.png) shot.replaceChildren(h('img', { class: 'screen', alt: '端末の画面', src: `data:image/png;base64,${r.png}` }));
      } else if (t) log.prepend(h('p', { class: 'muted' }, t));
    }
  });
  body.replaceChildren(h('div', { class: 'card' }, h('h2', {}, `端末 #${run.id}`, h('span', { class: 'chip' }, starter), link(run.html_url, 'GitHub')),
    mine ? null : h('p', { class: 'warn' }, `命令が効くのは、この実行を始めた ${starter} さんのものだけです（見るのはできます）`),
    isPublic && !key ? h('p', { class: 'warn' }, '公開リポジトリ: 命令と返事は封じられます。設定に APP_CACHE_KEY を入れてください') : null,
    shot, pad, h('label', {}, '命令（1 行 1 つ）'), cmdBox, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { if (cmdBox.value.trim()) { send(cmdBox.value.trim()); cmdBox.value = ''; } } }, '送る'), h('button', { onclick: () => send('screen') }, '📷 画面'), h('button', { class: 'danger', onclick: () => confirm('端末を終わらせますか') && send('stop') }, '終わる'))),
  h('div', { class: 'card' }, h('h2', {}, '返事'), log));
  drawPad(); poll();
  clearInterval(st.timer); st.timer = setInterval(() => { if (document.visibilityState === 'visible' && st.tab === 'live') poll(); }, 4000);
}

// ---- 貸し借り ----
function hostCard(x, brief = false) {
  if (x.error) return h('div', { class: 'card' }, h('h2', {}, x.slug), h('p', { class: 'bad' }, x.error));
  const card = h('div', { class: 'card' }, h('h2', {}, x.slug, h('span', { class: 'chip' }, M.ROLE_NAMES[x.role] ?? '見るだけ'), h('span', { class: 'chip' }, x.repo.visibility), link(x.repo.html_url, 'GitHub')));
  if (!x.rules) { card.append(h('p', { class: 'bad' }, x.errors.join(' / '))); return card; }
  const use = h('div', {}, h('p', { class: 'muted' }, '今月の分を数えています…'));
  card.append(h('p', {}, `1 か月 ${x.rules.minutesPerMonth} 分（${Math.floor(x.rules.minutesPerMonth * M.STOP_AT)} 分で止まる）・仕事 ${x.rules.jobs.join(' ')}・${x.rules.hours} ${x.rules.timezone}${x.rules.until ? `・${x.rules.until} まで` : ''}`), use);
  act(async () => {
    const { rs, used, month, now } = await hostUse(x);
    const pct = Math.min(100, Math.round((used / Math.max(1, now.stopAt)) * 100));
    use.replaceChildren(h('div', { class: 'bar' + (pct >= 100 ? ' bad' : pct >= 75 ? ' warn' : '') }, h('i', { style: { width: `${pct}%` } })),
      h('div', {}, `今月 ${used} 分 / 止まる ${now.stopAt} 分（${month}）`), now.ok ? h('div', { class: 'ok' }, '✅ いま使えます') : h('div', { class: 'warn' }, now.why.map((w) => `⏸ ${w}`).join(' / ')),
      brief ? null : h('ul', { class: 'plain' }, rs.slice(0, 6).map((r) => h('li', {}, M.STATE_ICON[r.status === 'completed' ? r.conclusion : r.status] ?? '•', ' ', link(r.html_url, r.display_title || r.name), ' ', h('span', { class: 'muted' }, `${r.triggering_actor?.login ?? ''} · ${M.ago(r.created_at)}`)))),
      !brief && x.role === 'borrower' && canLab() ? h('div', { class: 'row' }, h('button', { onclick: () => { st.target = x.slug; go('start'); } }, `${x.slug.split('/')[0]} さんの Actions で走らせる`)) : null);
  });
  if (!brief && x.role === 'lender') card.append(lenderForm(x));
  return card;
}
function lenderForm(x) {
  const j = x.json, f = {
    minutes: h('input', { type: 'number', min: 1, max: 50000, value: j.minutesPerMonth }), hours: h('input', { type: 'text', value: j.hours ?? '00:00-24:00' }),
    tz: h('input', { type: 'text', value: j.timezone ?? 'UTC' }), until: h('input', { type: 'date', value: j.until ?? '' }), contact: h('input', { type: 'text', value: j.contact ?? '' }),
    jobs: Object.fromEntries(M.HOST_JOBS.map((n) => [n, h('input', { type: 'checkbox', checked: (j.jobs ?? []).includes(n) })])),
  };
  const save = async (next, done) => {
    const c = M.checkRules(next);
    if (c.errors.length) return toast(c.errors.join(' / '), true);
    const ok = await act(() => st.api.putFile(x.slug, '.lab-host.json', JSON.stringify(next, null, 2) + '\n', x.file?.sha, 'panel: 貸す条件を変える'), done);
    // (the lender's own repository: their change kept there, as the lab's policy keeps its own)
    if (ok !== undefined) record('lend', { host: x.slug, until: next.until }, x.slug, P.auditMode(st.policy, x.repo.visibility));
    if (ok !== undefined) { const i = st.hosts.findIndex((y) => y.slug === x.slug); st.hosts[i] = await loadHost(x.slug); render(); }
  };
  const read = () => ({ ...j, minutesPerMonth: Number(f.minutes.value), hours: f.hours.value.trim(), timezone: f.tz.value.trim(), ...(f.until.value ? { until: f.until.value } : { until: undefined }), contact: f.contact.value, jobs: M.HOST_JOBS.filter((n) => f.jobs[n].checked) });
  return h('div', {}, h('h3', {}, '貸す条件（あなたのホスト）'),
    h('label', {}, '1 か月に貸す分'), f.minutes, h('label', {}, '時間帯（HH:MM-HH:MM）'), f.hours, h('label', {}, '時間帯の地域（例 Asia/Tokyo）'), f.tz, h('label', {}, '最後の日'), f.until, h('label', {}, '連絡先'), f.contact,
    h('label', {}, '許す仕事'), h('div', { class: 'row' }, M.HOST_JOBS.map((n) => h('label', {}, f.jobs[n], ` ${n}`))),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => save(read(), '貸す条件を変えました') }, '変える'),
      h('button', { class: 'danger', onclick: () => confirm('貸すのを今すぐ止めますか（最後の日を昨日にします）') && save(M.pauseRules(j, new Date(), j.timezone ?? 'UTC'), '止めました') }, '今すぐ止める'),
      h('button', { onclick: () => { const d = prompt('いつまで貸しますか（YYYY-MM-DD）', M.dayOf(new Date(Date.now() + 30 * 86_400_000), j.timezone ?? 'UTC')); if (d) save(M.resumeRules(j, d), `${d} まで貸します`); } }, '再開する')));
}
function hosts(body) {
  const add = h('input', { type: 'text', placeholder: 'owner/bds-lab-host' });
  const reload = async () => { st.hosts = await loadHosts(settings().hosts); render(); };
  body.append(h('div', { class: 'card' }, h('h2', {}, '貸し借り（ホスト）'),
    h('p', { class: 'muted' }, 'ホスト = GitHub Actions の時間を貸してくれる人のリポジトリ（.lab-host.json と host.yml）。貸し手は自分の条件を変えられ、借り手は残りの分と結果を見て、「実行」からその人の Actions で走らせられます。一覧はこのアカウントの設定です（アカウントごとに別）。'),
    h('div', { class: 'row' }, h('button', { onclick: () => act(async () => {
      const found = await findHosts();
      saveSettings({ hosts: [...settings().hosts, ...found] }); await reload();
      toast(found.length ? `${found.length} 個見つけました` : '見つかりませんでした（最近の 40 個を見ました）');
    }) }, '自分のホストを探す'), add, h('button', { onclick: async () => { const v = add.value.trim(); if (!M.SLUG.test(v)) return toast('owner/名前 で', true); saveSettings({ hosts: [...settings().hosts, v] }); await reload(); } }, '加える'))));
  for (const x of st.hosts) body.append(hostCard(x), h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => { saveSettings({ hosts: settings().hosts.filter((s) => s !== x.slug) }); st.hosts = st.hosts.filter((y) => y.slug !== x.slug); render(); } }, `${x.slug} を一覧から外す`)));
}

// ---- 設定 (this account's, in this browser) ----
function settingsTab(body) {
  const s = settings(), lab = h('input', { type: 'text', value: s.lab }), refresh = h('input', { type: 'number', min: 5, max: 600, value: s.refresh }), vault = h('input', { type: 'password', value: s.vault, autocomplete: 'off' });
  body.append(h('div', { class: 'card' }, h('h2', {}, `${st.login} の設定（このブラウザ）`),
    h('label', {}, 'ラボのリポジトリ'), lab, h('label', {}, '読み直す間隔（秒）'), refresh,
    h('label', {}, 'APP_CACHE_KEY（公開リポジトリの端末の命令と返事を封じる・開く。Secrets と同じ値。このブラウザだけに置きます）'), vault,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { if (!M.SLUG.test(lab.value.trim())) return toast('owner/名前 で', true); saveSettings({ lab: lab.value.trim(), refresh: Number(refresh.value) || 20, vault: vault.value }); toast('保存しました'); connect(); } }, '保存'),
      h('button', { class: 'danger', onclick: () => confirm(`${st.login} のトークンと鍵をこのブラウザから消しますか`) && signOut() }, 'このアカウントをこのブラウザから消す'))),
  h('div', { class: 'card' }, h('h2', {}, 'このブラウザのアカウント'), h('ul', { class: 'plain' }, A.list().map((e) => h('li', { class: 'row' },
    h('span', { class: 'grow' }, h('strong', {}, e.login), e.login === st.login ? h('span', { class: 'chip' }, 'いま') : null, ' ', h('span', { class: 'muted' }, `${A.cfg(e.login).lab}・ホスト ${A.cfg(e.login).hosts.length}${e.remember ? '' : '・このタブだけ'}`)),
    e.login === st.login ? null : h('button', { onclick: () => switchTo(e.login) }, '切り替える')))),
  h('div', { class: 'row' }, h('button', { onclick: () => renderSignIn('', { adding: true }) }, '＋ アカウントを加える'))),
  h('div', { class: 'card' }, h('h2', {}, A.session(st.login)?.kind === 'oauth' ? 'サインイン' : 'トークン'), h('p', {}, `ログイン ${st.me.login}・残り回数 ${st.api.state.remaining ?? '?'}`),
    A.session(st.login)?.kind === 'oauth' ? h('p', { class: 'muted' }, 'ラボの GitHub App でサインインしています: できることは、App が入っているリポジトリで GitHub があなたに許すことだけです。「出る」でこのトークンを GitHub で取り消します。') : tokenHelp(s.lab.split('/')[0]),
    st.lab ? h('p', { class: 'muted' }, `役割: ${roleName()}（${P.POLICY_FILE}${st.policyErrors.length ? ': 正しくありません' : ''}）・できること: ${P.ACTIONS.filter((x) => may(x)).map((x) => P.ACTION_WORDS[x]).join('・') || 'なし'}${P.idleMinutes(st.policy) ? `・${P.idleMinutes(st.policy)} 分操作がないとサインアウト` : ''}・監査ログ: ${st.audit === 'issue' ? '残す' : '残さない'}`) : null,
    h('p', { class: 'muted' }, '権限が足りないと、その操作だけ「権限がありません」と出ます（秘密の一覧: Secrets: Read、登録: Read and write、実行: Actions: Read and write、知らせ方: Variables: Read and write、貸す条件: Contents: Read and write、端末: Issues: Read and write）')));
  // (this device: a notification when a run of the lab ends while the panel is open)
  const on = h('input', { type: 'checkbox', checked: notifyOn() });
  on.addEventListener('change', async () => {
    if (on.checked && globalThis.Notification && globalThis.Notification.permission !== 'granted') { const p = await globalThis.Notification.requestPermission().catch(() => 'denied'); if (p !== 'granted') toast('ブラウザが知らせを許していません（パネルの中の知らせだけになります）', true); }
    if (on.checked) LOCAL.setItem(NOTIFY_KEY, '1'); else LOCAL.removeItem(NOTIFY_KEY);
  });
  body.append(h('div', { class: 'card' }, h('h2', {}, 'この端末'), h('label', {}, on, ' 実行が終わったら知らせる（パネルを開いている間。タブの題に動いている数）'),
    h('p', { class: 'muted' }, 'スマホではブラウザのメニューの「ホーム画面に追加」で、アプリのように開けます。'), h('p', { class: 'muted' }, `キー: ${KEYS_HELP}`)));
  body.append(debugCard());
}
/** 「デバッグ」: this page's version, its errors and the last GitHub calls; a report to paste (tokens taken out) */
function debugCard() {
  const ver = h('p', { class: 'muted' }, st.version.say), list = h('pre', { id: 'debuglog' });
  const show = () => { const r = report(); list.textContent = r.split('\n').slice(r.split('\n').indexOf('エラー:')).join('\n'); };
  const report = () => DBG.report({ version: CONFIG.version, versionSay: st.version.say, url: location.href, agent: navigator.userAgent, login: st.login, kind: A.session(st.login)?.kind, lab: st.lab?.slug, role: roleName(), tab: st.tab, remaining: st.api?.state.remaining, log: LOG });
  checkVersion().then((v) => { ver.textContent = v.say; show(); });
  show();
  return h('div', { class: 'card', id: 'debug' }, h('h2', {}, 'デバッグ'), ver,
    h('p', { class: 'muted' }, 'このページで起きたエラーと、最近の GitHub への呼び出し（このブラウザの中だけ。トークン・中身は入りません）。おかしいときは「写す」で貼ってください。'),
    h('div', { class: 'row' }, h('button', { onclick: () => { const r = report(); (navigator.clipboard?.writeText(r) ?? Promise.reject(new Error())).then(() => toast('写しました（トークンは入っていません）'), () => prompt('写してください', r)); } }, '📋 写す'),
      h('button', { onclick: show }, '読み直す'), h('button', { onclick: () => { LOG.clear(); show(); renderWho(); } }, '消す'),
      CONFIG.version ? link(`https://github.com/${st.lab?.slug ?? DEFAULT_LAB}/commit/${CONFIG.version}`, 'この版のコミット') : null,
      link(`https://github.com/${st.lab?.slug ?? DEFAULT_LAB}/actions/workflows/pages.yml`, 'pages.yml')),
    list);
}

if (FRAMED) main().replaceChildren(h('p', { class: 'bad' }, 'このパネルは、ほかのページの中では開きません（そのページのアドレスではなく、パネルのアドレスで開いてください）。'));
else connect();
