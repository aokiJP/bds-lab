// bds-lab 管理パネル: the lab's author, its collaborators and the people who lend or borrow GitHub Actions minutes (hosts),
// each with their own GitHub token — what they see and may do is what GitHub lets that token see and do. Several accounts
// can live in one browser (lib/accounts.mjs), each with its own settings: switched at the top. Each repository's own
// settings decide what is offered (its secrets' names, its workflows, its visibility; a host's .lab-host.json), and where a
// job runs is chosen: this lab's own Actions, or a lender's through hostrun.yml. Discord is reached through the repository's
// own workflows and secrets (app hold's controller, secrets' form, notify's news with the run's deliverables).
// The tokens, and the vault key for a public repository's live screen, stay in this browser (localStorage or this tab only).
import { gh } from './lib/gh.mjs';
import * as M from './lib/model.mjs';
import * as LF from './lib/livefmt.mjs';
import { PAGES } from './lib/pages.mjs';
import { vaultKey } from './lib/vault.mjs';
import { accounts, memoryStorage } from './lib/accounts.mjs';
import { h, $, main, toast, act, link } from './ui/dom.mjs';

// ---- the accounts of this browser, each with its own token and settings ----
// (a browser that refuses storage — a private window may — still works for the tab)
const storage = (name) => { try { const s = window[name]; s.setItem('bdslab.probe', '1'); s.removeItem('bdslab.probe'); return s; } catch { return memoryStorage(); } };
const DEFAULT_LAB = M.repoFromLocation(location) ?? 'aokiJP/bds-lab';
const A = accounts({ local: storage('localStorage'), session: storage('sessionStorage'), defaults: { lab: DEFAULT_LAB } });
/** the settings of the account in use (its lab, hosts, refresh, vault key) */
const settings = () => A.cfg(st.login ?? A.active());
const saveSettings = (patch) => A.setCfg(st.login, patch);

// ---- the state of this visit ----
const st = { login: null, api: null, me: null, lab: null, hosts: [], tab: 'overview', timer: null, routed: false, focus: null, prefill: null, target: 'lab' };
const canLab = () => Boolean(st.lab && (st.lab.role === 'admin' || st.lab.role === 'write'));

function tokenLink(owner) {
  // (GitHub's fine-grained token page, the panel's needs written in; GitHub ignores what it does not take)
  const q = new URLSearchParams({ name: 'bds-lab panel', description: 'bds-lab の管理パネル（このブラウザだけ）', target_name: owner, expires_in: '90', metadata: 'read', actions: 'write', contents: 'write', secrets: 'write', variables: 'write', issues: 'write', pull_requests: 'read' });
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}
const CLASSIC = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=bds-lab%20panel';
const tokenHelp = (owner) => h('div', {},
  h('p', {}, link(tokenLink(owner), 'トークンを作る（Fine-grained）'), ' — 対象のリポジトリ: ラボと、貸し借りのホスト。権限: Actions・Contents・Secrets・Variables・Issues は Read and write、Pull requests は Read'),
  h('p', { class: 'muted' }, 'Fine-grained トークンが選べるのは 1 つの持ち主（自分か、入っている組織）のリポジトリだけです。ほかの人の個人アカウントにあるホストを借りるときは ', link(CLASSIC, 'Classic トークン（repo・workflow）'), ' を使ってください。'));

// ---- the top: who, switching accounts, adding one, leaving ----
function renderWho() {
  const list = A.list(), kids = [];
  if (st.me) kids.push(h('img', { src: st.me.avatar_url, alt: '' }));
  if (list.length > 1) kids.push(h('select', { id: 'acct', 'aria-label': 'アカウントを切り替える', onchange: (e) => switchTo(e.target.value) }, list.map((a) => h('option', { value: a.login, selected: a.login === st.login ? 'selected' : null }, `${a.login}${a.remember ? '' : '（このタブだけ）'}`))));
  else if (st.me) kids.push(st.me.login);
  kids.push(h('button', { title: 'アカウントを加える', 'aria-label': 'アカウントを加える', onclick: () => renderSignIn('', { adding: true }) }, '＋'));
  if (st.login) kids.push(h('button', { onclick: signOut }, '出る'));
  $('who').replaceChildren(...kids);
}
function switchTo(login) { if (!A.use(login)) return; st.tab = 'overview'; st.me = null; st.target = 'lab'; history.replaceState(null, '', location.pathname + location.search); connect(); }
/** this account forgotten by this browser (the token stays valid on GitHub until revoked there): the next one, or the door */
function signOut() {
  const next = A.remove(st.login);
  Object.assign(st, { login: null, me: null, lab: null, hosts: [], tab: 'overview' });
  clearInterval(st.timer);
  if (next) return connect();
  renderWho(); renderSignIn();
}

// ---- sign in / add an account / locked ----
function renderSignIn(err = '', { adding = false, login = null } = {}) {
  clearInterval(st.timer);
  if (!adding) renderWho();
  const lab0 = login ? A.cfg(login).lab : adding ? DEFAULT_LAB : settings().lab ?? DEFAULT_LAB, owner = String(lab0).split('/')[0];
  const t = h('input', { type: 'password', id: 'tok', autocomplete: 'off', placeholder: 'github_pat_… / ghp_…' }), lab = h('input', { type: 'text', id: 'lab', value: lab0 }), rem = h('input', { type: 'checkbox', id: 'rem', checked: true });
  main().replaceChildren(h('div', { class: 'card' },
    h('h2', {}, adding ? 'アカウントを加える' : login ? `${login} のトークンを入れ直す` : 'GitHub のトークンで入る'),
    h('p', {}, 'このパネルは、ラボのリポジトリに書き込める人と、GitHub Actions の時間を貸している・借りている人だけが使えます。見えるもの・できることは、あなたのトークンに GitHub が許していることだけです。'),
    h('p', { class: 'muted' }, 'トークンはこのブラウザの中だけに置き、GitHub の API にだけ送ります（このページはほかのどこにも通信できません）。作者・貸し手・借り手など、いくつかのアカウントを加えて上で切り替えられます（それぞれのトークンと設定で）。'),
    tokenHelp(owner),
    h('label', { for: 'tok' }, 'トークン'), t,
    h('label', { for: 'lab' }, 'ラボのリポジトリ（owner/名前）'), lab,
    h('label', {}, rem, ' このブラウザに覚える（共有の端末では外す: このタブを閉じると忘れます）'),
    err ? h('p', { class: 'bad' }, err) : null,
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'go', onclick: async () => {
      const v = t.value.trim(), l = lab.value.trim();
      if (!v) return toast('トークンを入れてください', true);
      if (!M.SLUG.test(l)) return toast('ラボのリポジトリは owner/名前 で', true);
      let me;
      try { me = await gh({ token: v }).me(); } catch (e) { return renderSignIn(e.message, { adding, login }); }
      A.add({ login: me.login, avatar: me.avatar_url, token: v, remember: rem.checked, cfg: { lab: l } });
      st.tab = 'overview'; st.target = 'lab';
      await connect();
    } }, adding ? '加える' : '入る'),
    (adding || login) && A.active() && st.me ? h('button', { onclick: () => render() }, '戻る') : null)));
}
function renderLocked(why) {
  main().replaceChildren(h('div', { class: 'card' }, h('h2', {}, '🔒 使えません'), h('p', {}, why),
    h('p', { class: 'muted' }, `ログイン: ${st.me?.login ?? '?'}。トークンの対象にラボ（${settings().lab}）か自分のホストが入っているか、確かめてください。`),
    h('button', { onclick: () => { A.remove(st.login); Object.assign(st, { login: null, me: null }); renderWho(); renderSignIn(); } }, '別のトークンで入る')));
}

// ---- connecting: who, the lab, the hosts ----
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
  // (an address that names a run — Discord's 「管理パネル」 button — opens with the account whose lab that run is in)
  const want = st.routed ? { tab: null, repo: null, run: null } : M.parseHash(location.hash);
  if (want.repo) { const who = A.list().find((e) => String(A.cfg(e.login).lab).toLowerCase() === want.repo.toLowerCase()); if (who) A.use(who.login); }
  const login = A.active();
  if (!login) { renderWho(); return renderSignIn(); }
  st.login = login; st.me = null;
  const t = A.token(login);
  if (!t) { A.remove(login); return connect(); }
  st.api = gh({ token: t });
  renderWho();
  main().replaceChildren(h('p', { class: 'muted' }, `GitHub に聞いています…（${login}）`));
  try { st.me = await st.api.me(); } catch (e) { return renderSignIn(e.message, { login }); }
  renderWho();
  const s = settings();
  let labRepo = null; try { labRepo = await st.api.repo(s.lab); } catch { /* not visible to this token */ }
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
  if (!st.routed) {
    st.routed = true;
    if (want.tab) st.tab = want.tab;
    if (want.run && (!want.repo || want.repo.toLowerCase() === String(st.lab?.slug).toLowerCase())) st.focus = { run: Number(want.run) };
  }
  render();
}
/** a host: its repository, its .lab-host.json read and checked; one this token cannot see is kept with the reason */
async function loadHost(slug) {
  let repo;
  try { repo = await st.api.repo(slug); } catch (e) { return { slug, error: e.status === 404 ? 'このトークンでは見えません（招待を受けていない・トークンの対象にない。Fine-grained トークンはほかの人の個人アカウントのリポジトリを選べません: Classic トークンを）' : e.message }; }
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
/** a repository's own settings: its secrets' names (null: may not look), its workflows */
async function loadEnv(x) {
  x.secrets = await st.api.secretNames(x.slug).catch(() => null);
  x.workflows = await st.api.workflows(x.slug).catch(() => []);
  x.caps = M.capabilities({ secrets: x.secrets, workflows: x.workflows, visibility: x.repo.visibility });
}
const capsOf = () => Object.fromEntries((st.lab?.caps ?? []).map((c) => [c.key, c]));
const hasWf = (f) => (st.lab?.workflows ?? []).some((w) => String(w.path).endsWith(`/${f}`));

// ---- the frame: tabs ----
const TABS = [['overview', '概要'], ['runs', '進み具合'], ['start', '実行'], ['files', '成果物'], ['discord', 'Discord'], ['secrets', '秘密'], ['live', '端末'], ['hosts', '貸し借り'], ['settings', '設定']];
function render() {
  clearInterval(st.timer);
  renderWho();
  const tabs = TABS.filter(([k]) => canLab() || ['overview', 'hosts', 'settings'].includes(k));
  if (!tabs.some(([k]) => k === st.tab)) st.tab = tabs[0][0];
  const body = h('div', { id: 'tabbody' });
  main().replaceChildren(h('nav', { class: 'tabs' }, tabs.map(([k, label]) => h('button', { class: st.tab === k ? 'on' : '', onclick: () => go(k) }, label))), body);
  ({ overview, runs, start, files, discord, secrets, live, hosts, settings: settingsTab })[st.tab](body);
}
/** another tab (the address follows: a reload or a shared link opens the same tab) */
function go(tab) { st.tab = tab; history.replaceState(null, '', `#${tab}`); render(); }
const every = (fn) => { clearInterval(st.timer); st.timer = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, Math.max(5, settings().refresh) * 1000); };

// ---- 概要 ----
function overview(body) {
  body.append(h('div', { class: 'card' }, h('h2', {}, `${st.me.login} さん`), h('p', {}, 'あなたは: ', st.as.map((r) => h('span', { class: 'chip' }, M.ROLE_NAMES[r])), ' '),
    h('p', { class: 'muted' }, `GitHub の残り回数: ${st.api.state.remaining ?? '?'}`)));
  if (st.lab && st.lab.caps) {
    body.append(h('div', { class: 'card' }, h('h2', {}, st.lab.slug, h('span', { class: 'chip' }, M.ROLE_NAMES[st.lab.role]), h('span', { class: 'chip' }, st.lab.repo.visibility), link(st.lab.repo.html_url, 'GitHub')),
      h('h3', {}, 'このリポジトリの設定でできること'),
      h('ul', { class: 'plain' }, st.lab.caps.map((c) => h('li', {}, c.ok === null ? '❔ ' : c.ok ? '✅ ' : '⚠️ ', c.label, c.need ? h('div', { class: 'muted' }, c.need) : null))),
      h('div', { id: 'ovruns' }, h('p', { class: 'muted' }, '実行を読んでいます…'))));
    act(async () => {
      const [rs, prs] = await Promise.all([st.api.runs(st.lab.slug, { per: 20 }), st.api.pulls(st.lab.slug).catch(() => [])]);
      const going = rs.filter((r) => r.status !== 'completed'), bad = rs.filter((r) => r.conclusion === 'failure');
      $('ovruns')?.replaceChildren(h('h3', {}, '最近'), h('p', {}, `動いている ${going.length}・失敗 ${bad.length}（最近 ${rs.length} 件）・開いている PR ${prs.length}`),
        h('ul', { class: 'plain' }, rs.slice(0, 5).map((r) => h('li', {}, M.STATE_ICON[r.status === 'completed' ? r.conclusion : r.status] ?? '•', ' ', link(r.html_url, r.name), ' ', h('span', { class: 'muted' }, `${r.head_branch} · ${M.ago(r.created_at)}`)))));
    });
  } else if (st.lab) body.append(h('div', { class: 'card' }, h('h2', {}, st.lab.slug), h('p', { class: 'muted' }, `このリポジトリは ${M.ROLE_NAMES[st.lab.role] ?? '見えない'} です: 実行・秘密・端末は、書き込める人だけ`)));
  for (const x of st.hosts) body.append(hostCard(x, true));
  if (!st.hosts.length) body.append(h('div', { class: 'card' }, h('h2', {}, '貸し借り（ホスト）'), h('p', { class: 'muted' }, 'まだありません。「貸し借り」で探すか加えます。')));
  const others = A.list().filter((e) => e.login !== st.login);
  if (others.length) body.append(h('div', { class: 'card' }, h('h2', {}, 'このブラウザのほかのアカウント'),
    h('ul', { class: 'plain' }, others.map((e) => h('li', { class: 'row' }, h('span', { class: 'grow' }, e.login, ' ', h('span', { class: 'muted' }, `${A.cfg(e.login).lab}・ホスト ${A.cfg(e.login).hosts.length}`)), h('button', { onclick: () => switchTo(e.login) }, '切り替える'))))));
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
  const load = () => act(async () => {
    const rs = await st.api.runs(from, { per: 25 });
    for (const r of rs) if (r.status !== 'completed' && !shut.has(r.id)) open.add(r.id);
    list.replaceChildren(...rs.map((r) => {
      const state = r.status === 'completed' ? r.conclusion : r.status, box = h('div', { class: 'jobs' });
      const row = h('div', { class: 'card', 'data-run': r.id },
        h('div', { class: 'row' }, h('strong', {}, `${M.STATE_ICON[state] ?? '•'} ${r.name}`), h('span', { class: 'chip' }, r.event), h('span', { class: 'muted grow' }, `${r.head_branch} · ${r.triggering_actor?.login ?? r.actor?.login ?? ''} · ${M.ago(r.created_at)}`),
          r.status !== 'completed' ? h('button', { class: 'danger', onclick: () => act(() => st.api.cancel(from, r.id), '止めるよう頼みました') }, '止める') : null,
          r.conclusion === 'failure' ? h('button', { onclick: () => act(() => st.api.rerunFailed(from, r.id), '失敗したジョブをやり直します') }, 'やり直す') : null,
          h('button', { onclick: () => { if (open.has(r.id)) { open.delete(r.id); shut.add(r.id); } else { open.add(r.id); shut.delete(r.id); } detail(from, r, box, open.has(r.id)); } }, '詳しく'), link(r.html_url, 'GitHub')),
        box);
      if (open.has(r.id)) detail(from, r, box, true);
      return row;
    }));
    if (focus && isLab) { const c = list.querySelector(`[data-run="${focus.run}"]`); if (c) c.scrollIntoView({ block: 'start' }); else toast(`実行 ${focus.run} は最近の 25 件にありません`, true); }
  });
  const pick = sources.length > 1 ? h('select', { 'aria-label': 'どこの実行', onchange: (e) => { st.runsFrom = e.target.value; render(); } }, sources.map((s) => h('option', { value: s, selected: s === from ? 'selected' : null }, s === st.lab.slug ? `ラボ: ${s}` : `ホスト: ${s}`))) : null;
  body.append(h('div', { class: 'row' }, pick, h('button', { onclick: load }, '読み直す'), h('span', { class: 'muted' }, `（${settings().refresh} 秒ごとに読み直します）`)), list);
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
const sendToDiscord = (runId) => act(() => st.api.dispatch(st.lab.slug, 'notify.yml', st.lab.repo.default_branch, { run: String(runId), message: '' }), `実行 ${runId} を Discord に送ります（notify: 成果物は 10 MB まで添えます）`);

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
    const ok = await act(() => st.api.dispatch(st.lab.slug, 'hostrun.yml', st.lab.repo.default_branch, r.inputs), `${x.slug} で ${r.inputs.job}${r.inputs.unit ? ` -a ${r.inputs.unit}` : ''} を始めました（「進み具合」の hostrun）`);
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
        const ok = await act(() => st.api.dispatch(st.lab.slug, file, ref.value.trim(), M.dispatchBody(d.inputs, values)), `${file} を始めました（「進み具合」で見られます）`);
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
        const ok = await act(() => st.api.putSecret(st.lab.slug, name, val), `${name} を登録しました`);
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
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => act(async () => { await st.api.setVariable(st.lab.slug, 'LAB_NOTIFY', when.value); await st.api.setVariable(st.lab.slug, 'LAB_NOTIFY_FILES', what.value); }, '知らせ方を保存しました') }, '知らせ方を保存'))));
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
    hasWf('notify.yml') ? btn('🔔 試しに送る', 'notify', () => act(() => st.api.dispatch(st.lab.slug, 'notify.yml', st.lab.repo.default_branch, { run: '', message: `bds-lab: ${st.me.login} さんが管理パネルから試しに送りました` }), '送るよう頼みました（数十秒で届きます）')) : null,
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
    const have = await st.api.secrets(st.lab.slug), names = new Set(have.map((s) => s.name));
    list.replaceChildren(h('ul', { class: 'plain' },
      Object.entries(M.KNOWN_SECRETS).map(([n, what]) => h('li', {}, names.has(n) ? '✅ ' : '・ ', h('strong', {}, n), ' ', h('span', { class: 'muted' }, what), names.has(n) ? h('button', { class: 'danger', onclick: () => confirm(`${n} を消しますか`) && act(() => st.api.deleteSecret(st.lab.slug, n), `${n} を消しました`).then(load) }, '消す') : null)),
      have.filter((s) => !M.KNOWN_SECRETS[s.name]).map((s) => h('li', {}, '✅ ', h('strong', {}, s.name), ' ', h('span', { class: 'muted' }, `（${M.ago(s.updated_at)}に更新）`), h('button', { class: 'danger', onclick: () => confirm(`${s.name} を消しますか`) && act(() => st.api.deleteSecret(st.lab.slug, s.name), `${s.name} を消しました`).then(load) }, '消す')))));
  });
  body.append(h('div', { class: 'card' }, h('h2', {}, '秘密を登録する'),
    h('p', { class: 'muted' }, '値はこのブラウザの中でリポジトリの公開鍵で封じてから GitHub に送ります（GitHub の Actions だけが開けます。このパネルも GitHub も値を表示しません）。'),
    h('datalist', { id: 'known' }, Object.keys(M.KNOWN_SECRETS).map((n) => h('option', { value: n }))),
    h('label', {}, '名前'), name, h('label', {}, '値'), value,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => {
      const n = name.value.trim().toUpperCase();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(n) || n.startsWith('GITHUB_')) return toast('名前は英大文字・数字・_（数字から始めない、GITHUB_ で始めない）', true);
      if (!value.value) return toast('値が空です', true);
      const ok = await act(() => st.api.putSecret(st.lab.slug, n, value.value), `${n} を登録しました`);
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
  h('div', { class: 'card' }, h('h2', {}, 'トークン'), h('p', {}, `ログイン ${st.me.login}・残り回数 ${st.api.state.remaining ?? '?'}`), tokenHelp(s.lab.split('/')[0]),
    h('p', { class: 'muted' }, '権限が足りないと、その操作だけ「権限がありません」と出ます（秘密の一覧: Secrets: Read、登録: Read and write、実行: Actions: Read and write、知らせ方: Variables: Read and write、貸す条件: Contents: Read and write、端末: Issues: Read and write）')));
}

connect();
