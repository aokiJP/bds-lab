// bds-lab 管理パネル: the lab's author, its collaborators and the people who lend or borrow GitHub Actions minutes (hosts),
// each with their own GitHub token — what they see and may do is what GitHub lets that token see and do. Each repository's
// own settings decide what is offered (its secrets' names, its workflows, its visibility; a host's .lab-host.json). Discord
// is reached through the repository's own workflows and secrets (app hold's controller, secrets' form, notify's news).
// The token, and the vault key for a public repository's live screen, stay in this browser (localStorage or this tab only).
import { gh } from './lib/gh.mjs';
import * as M from './lib/model.mjs';
import * as LF from './lib/livefmt.mjs';
import { PAGES } from './lib/pages.mjs';
import { vaultKey } from './lib/vault.mjs';

// ---- small helpers: the DOM built by hand (text is always text: never parsed as HTML) ----
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = Boolean(v);
    // (styles through the CSSOM: the page's CSP allows no inline style attribute)
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};
const $ = (id) => document.getElementById(id);
const main = () => $('main');
const toast = (text, bad = false) => { const d = h('div', { class: bad ? 'bad' : '' }, text); $('toast').append(d); setTimeout(() => d.remove(), bad ? 9000 : 4500); };
const act = async (fn, done) => { try { const r = await fn(); if (done) toast(done); return r; } catch (e) { toast(e.message ?? String(e), true); return undefined; } };
// (an address from GitHub's answers: only https:// ones become links, anything else stays words)
const link = (href, text) => (/^https:\/\//.test(String(href ?? '')) ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text) : h('span', {}, text));

// ---- settings, this browser's alone ----
const K = 'bdslab.panel.';
const S = {
  get: (k, d = null) => { try { const v = localStorage.getItem(K + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => localStorage.setItem(K + k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(K + k),
};
const token = {
  get: () => sessionStorage.getItem(K + 'token') ?? S.get('token'),
  set: (t, remember) => { sessionStorage.setItem(K + 'token', t); if (remember) S.set('token', t); else S.del('token'); },
  clear: () => { sessionStorage.removeItem(K + 'token'); S.del('token'); },
};
const settings = () => ({ lab: S.get('lab') ?? M.repoFromLocation(location) ?? 'aokiJP/bds-lab', hosts: S.get('hosts', []), refresh: S.get('refresh', 20), vault: S.get('vault', '') });

// ---- the state of this visit ----
const st = { api: null, me: null, lab: null, hosts: [], tab: 'overview', timer: null, live: null };

function tokenLink(owner) {
  // (GitHub's fine-grained token page, the panel's needs written in; GitHub ignores what it does not take)
  const q = new URLSearchParams({ name: 'bds-lab panel', description: 'bds-lab の管理パネル（このブラウザだけ）', target_name: owner, expires_in: '90', metadata: 'read', actions: 'write', contents: 'write', secrets: 'write', issues: 'write', pull_requests: 'read' });
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}

// ---- sign in / locked ----
function renderSignIn(err = '') {
  clearInterval(st.timer);
  $('who').replaceChildren();
  const s = settings(), owner = s.lab.split('/')[0];
  const t = h('input', { type: 'password', id: 'tok', autocomplete: 'off', placeholder: 'github_pat_…' }), lab = h('input', { type: 'text', id: 'lab', value: s.lab }), rem = h('input', { type: 'checkbox', id: 'rem', checked: true });
  main().replaceChildren(h('div', { class: 'card' },
    h('h2', {}, 'GitHub のトークンで入る'),
    h('p', {}, 'このパネルは、ラボのリポジトリに書き込める人と、GitHub Actions の時間を貸している・借りている人だけが使えます。見えるもの・できることは、あなたのトークンに GitHub が許していることだけです。'),
    h('p', { class: 'muted' }, 'トークンはこのブラウザの中だけに置き、GitHub の API にだけ送ります（このページはほかのどこにも通信できません）。'),
    h('p', {}, link(tokenLink(owner), 'トークンを作る（Fine-grained）'), ' — 対象のリポジトリ: ラボと、貸し借りのホスト。権限: Actions・Contents・Secrets・Issues は Read and write、Pull requests は Read'),
    h('label', { for: 'tok' }, 'トークン'), t,
    h('label', { for: 'lab' }, 'ラボのリポジトリ（owner/名前）'), lab,
    h('label', {}, rem, ' このブラウザに覚える（共有の端末では外す）'),
    err ? h('p', { class: 'bad' }, err) : null,
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'go', onclick: async () => {
      const v = t.value.trim(), l = lab.value.trim();
      if (!v) return toast('トークンを入れてください', true);
      if (!M.SLUG.test(l)) return toast('ラボのリポジトリは owner/名前 で', true);
      S.set('lab', l); token.set(v, rem.checked); await connect();
    } }, '入る'))));
}
function renderLocked(why) {
  main().replaceChildren(h('div', { class: 'card' }, h('h2', {}, '🔒 使えません'), h('p', {}, why),
    h('p', { class: 'muted' }, `ログイン: ${st.me?.login ?? '?'}。トークンの対象にラボ（${settings().lab}）か自分のホストが入っているか、確かめてください。`),
    h('button', { onclick: () => { token.clear(); renderSignIn(); } }, '別のトークンで入る')));
}

// ---- connecting: who, the lab, the hosts ----
async function connect() {
  const t = token.get();
  if (!t) return renderSignIn();
  st.api = gh({ token: t });
  main().replaceChildren(h('p', { class: 'muted' }, 'GitHub に聞いています…'));
  try { st.me = await st.api.me(); } catch (e) { token.clear(); return renderSignIn(e.message); }
  $('who').replaceChildren(h('img', { src: st.me.avatar_url, alt: '' }), st.me.login, h('button', { onclick: () => { token.clear(); location.reload(); } }, '出る'));
  const s = settings();
  let labRepo = null; try { labRepo = await st.api.repo(s.lab); } catch { /* not visible to this token */ }
  st.lab = labRepo ? { slug: s.lab, repo: labRepo, role: M.roleOf(labRepo.permissions) } : null;
  st.hosts = await loadHosts(s.hosts);
  const a = M.access({ lab: labRepo, hosts: st.hosts.map((x) => x.repo) });
  st.as = a.as;
  if (!a.ok) return renderLocked(a.why);
  if (st.lab && (st.lab.role === 'admin' || st.lab.role === 'write')) await loadEnv(st.lab);
  render();
}
/** a host: its repository, its .lab-host.json read and checked, its runs of this month */
async function loadHost(slug) {
  const repo = await st.api.repo(slug);
  const f = await st.api.file(slug, '.lab-host.json').catch(() => null);
  let json = null, parsed = { rules: null, errors: ['.lab-host.json がありません'] };
  if (f) { try { json = JSON.parse(f.text); parsed = M.checkRules(json); } catch { parsed = { rules: null, errors: ['.lab-host.json が JSON ではありません'] }; } }
  return { slug, repo, file: f, json, ...parsed, role: M.roleOf(repo.permissions) === 'admin' ? 'lender' : 'borrower' };
}
async function loadHosts(list) { const out = []; for (const slug of list) { try { out.push(await loadHost(slug)); } catch { /* gone or not visible: left out */ } } return out; }
/** a repository's own settings: its secrets' names (null: may not look), its workflows */
async function loadEnv(x) {
  x.secrets = await st.api.secretNames(x.slug).catch(() => null);
  x.workflows = await st.api.workflows(x.slug).catch(() => []);
  x.caps = M.capabilities({ secrets: x.secrets, workflows: x.workflows, visibility: x.repo.visibility });
}

// ---- the frame: tabs ----
const TABS = [['overview', '概要'], ['runs', '進み具合'], ['start', '実行'], ['secrets', '秘密'], ['live', '端末'], ['hosts', '貸し借り'], ['settings', '設定']];
function render() {
  clearInterval(st.timer);
  const canLab = st.lab && (st.lab.role === 'admin' || st.lab.role === 'write');
  const tabs = TABS.filter(([k]) => canLab || ['overview', 'hosts', 'settings'].includes(k));
  if (!tabs.some(([k]) => k === st.tab)) st.tab = tabs[0][0];
  const body = h('div', { id: 'tabbody' });
  main().replaceChildren(h('nav', { class: 'tabs' }, tabs.map(([k, label]) => h('button', { class: st.tab === k ? 'on' : '', onclick: () => { st.tab = k; render(); } }, label))), body);
  ({ overview, runs, start, secrets, live, hosts, settings: settingsTab })[st.tab](body);
}
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
}

// ---- 進み具合 ----
function runs(body) {
  // (a run still going shows its progress by itself, until it is closed by hand)
  const list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…')), open = new Set(), shut = new Set();
  const load = () => act(async () => {
    const rs = await st.api.runs(st.lab.slug, { per: 25 });
    for (const r of rs) if (r.status !== 'completed' && !shut.has(r.id)) open.add(r.id);
    list.replaceChildren(...rs.map((r) => {
      const state = r.status === 'completed' ? r.conclusion : r.status, box = h('div', { class: 'jobs' });
      const row = h('div', { class: 'card' },
        h('div', { class: 'row' }, h('strong', {}, `${M.STATE_ICON[state] ?? '•'} ${r.name}`), h('span', { class: 'chip' }, r.event), h('span', { class: 'muted grow' }, `${r.head_branch} · ${r.triggering_actor?.login ?? r.actor?.login ?? ''} · ${M.ago(r.created_at)}`),
          r.status !== 'completed' ? h('button', { class: 'danger', onclick: () => act(() => st.api.cancel(st.lab.slug, r.id), '止めるよう頼みました') }, '止める') : null,
          r.conclusion === 'failure' ? h('button', { onclick: () => act(() => st.api.rerunFailed(st.lab.slug, r.id), '失敗したジョブをやり直します') }, 'やり直す') : null,
          h('button', { onclick: () => { if (open.has(r.id)) { open.delete(r.id); shut.add(r.id); } else { open.add(r.id); shut.delete(r.id); } detail(r, box, open.has(r.id)); } }, '詳しく'), link(r.html_url, 'GitHub')),
        box);
      if (open.has(r.id)) detail(r, box, true);
      return row;
    }));
  });
  body.append(h('div', { class: 'row' }, h('button', { onclick: load }, '読み直す'), h('span', { class: 'muted' }, `（${settings().refresh} 秒ごとに読み直します）`)), list);
  load(); every(load);
}
async function detail(r, box, show) {
  if (!show) return box.replaceChildren();
  box.replaceChildren(h('span', { class: 'muted' }, '…'));
  await act(async () => {
    const jobs = await st.api.jobs(st.lab.slug, r.id), p = M.progress(r, jobs);
    const parts = [h('div', { class: 'bar' + (p.state === 'failure' ? ' bad' : '') }, h('i', { style: { width: `${p.pct}%` } })), h('div', { class: 'muted' }, `${p.done}/${p.total} 段 · ${M.fmtMs(p.ms)}${p.now ? ` · いま: ${p.now}` : ''}`)];
    for (const j of p.jobs) parts.push(h('div', {}, `${M.STATE_ICON[j.state] ?? '•'} ${j.name} — ${j.done}/${j.total}${j.now ? `（${j.now}）` : ''}`));
    // (a failed job's own words: its check run's annotations)
    for (const j of jobs.filter((x) => x.conclusion === 'failure').slice(0, 3)) {
      const id = String(j.check_run_url ?? '').split('/').pop();
      const an = id ? await st.api.annotations(st.lab.slug, id).catch(() => []) : [];
      if (an.length) parts.push(h('pre', {}, an.slice(0, 8).map((a) => `${a.annotation_level}: ${a.title ? a.title + ' — ' : ''}${a.message}`).join('\n')));
    }
    box.replaceChildren(...parts);
  });
}

// ---- 実行 ----
function start(body) {
  const caps = Object.fromEntries((st.lab.caps ?? []).map((c) => [c.key, c]));
  const hasWf = (f) => (st.lab.workflows ?? []).some((w) => w.path.endsWith(`/${f}`));
  body.append(h('div', { class: 'card' }, h('h2', {}, 'すぐ始める'), h('ul', { class: 'plain' }, M.PRESETS.filter((p) => hasWf(p.workflow)).map((p) => {
    const c = p.needs ? caps[p.needs] : null, ok = !c || c.ok !== false;
    return h('li', {}, h('div', { class: 'row' }, h('span', { class: 'grow' }, p.label), h('button', { class: 'primary', disabled: !ok, onclick: () => dispatchForm(body, p.workflow, p.inputs) }, '開く')), ok ? null : h('div', { class: 'warn' }, c.need));
  }))));
  const sel = h('select', {}, (st.lab.workflows ?? []).filter((w) => w.state === 'active').map((w) => h('option', { value: w.path }, `${w.name}（${w.path.split('/').pop()}）`)));
  body.append(h('div', { class: 'card' }, h('h2', {}, 'ワークフローを選んで'), sel, h('div', { class: 'row' }, h('button', { onclick: () => dispatchForm(body, sel.value.split('/').pop(), {}) }, '入力を開く'))), h('div', { id: 'dform' }));
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
  });
}

// ---- 秘密 ----
function secrets(body) {
  const list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…'));
  const name = h('input', { type: 'text', list: 'known', placeholder: 'MS_EMAIL', autocapitalize: 'characters' }), value = h('input', { type: 'password', autocomplete: 'new-password' });
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
      if (ok !== undefined) { value.value = ''; load(); }
    } }, '登録する'))),
  h('div', { class: 'card' }, h('h2', {}, 'このリポジトリの秘密'), list));
  load();
}

// ---- 端末（ライブ） ----
function live(body) {
  const box = h('div', {}, h('p', { class: 'muted' }, '常駐している端末（app の mode hold）を探しています…'));
  body.append(box);
  act(async () => {
    const rs = (await st.api.runs(st.lab.slug, { workflow: 'app.yml', status: 'in_progress', per: 10 }));
    if (!rs.length) return box.replaceChildren(h('div', { class: 'card' }, h('p', {}, '動いている端末がありません。'), h('button', { class: 'primary', onclick: () => { st.tab = 'start'; render(); setTimeout(() => dispatchForm(main(), 'app.yml', { mode: 'hold', hold: '60' }), 50); } }, '端末を立てる（mode hold）')));
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
  const card = h('div', { class: 'card' }, h('h2', {}, x.slug, h('span', { class: 'chip' }, M.ROLE_NAMES[x.role]), h('span', { class: 'chip' }, x.repo.visibility), link(x.repo.html_url, 'GitHub')));
  if (!x.rules) { card.append(h('p', { class: 'bad' }, x.errors.join(' / '))); return card; }
  const use = h('div', {}, h('p', { class: 'muted' }, '今月の分を数えています…'));
  card.append(h('p', {}, `1 か月 ${x.rules.minutesPerMonth} 分（${Math.floor(x.rules.minutesPerMonth * M.STOP_AT)} 分で止まる）・仕事 ${x.rules.jobs.join(' ')}・${x.rules.hours} ${x.rules.timezone}${x.rules.until ? `・${x.rules.until} まで` : ''}`), use);
  act(async () => {
    const tz = x.rules.timezone, month = M.monthOf(new Date(), tz), from = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const rs = await st.api.runs(x.slug, { workflow: 'host.yml', created: `>=${from}`, per: 100 }).catch(() => []);
    const used = M.monthMinutes(rs, month, tz), now = M.hostNow(x.rules, used, new Date(), rs.some((r) => r.status !== 'completed'));
    const pct = Math.min(100, Math.round((used / Math.max(1, now.stopAt)) * 100));
    use.replaceChildren(h('div', { class: 'bar' + (pct >= 100 ? ' bad' : pct >= 75 ? ' warn' : '') }, h('i', { style: { width: `${pct}%` } })),
      h('div', {}, `今月 ${used} 分 / 止まる ${now.stopAt} 分（${month}）`), now.ok ? h('div', { class: 'ok' }, '✅ いま使えます') : h('div', { class: 'warn' }, now.why.map((w) => `⏸ ${w}`).join(' / ')),
      brief ? null : h('ul', { class: 'plain' }, rs.slice(0, 6).map((r) => h('li', {}, M.STATE_ICON[r.status === 'completed' ? r.conclusion : r.status] ?? '•', ' ', link(r.html_url, r.display_title || r.name), ' ', h('span', { class: 'muted' }, `${r.triggering_actor?.login ?? ''} · ${M.ago(r.created_at)}`)))));
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
  body.append(h('div', { class: 'card' }, h('h2', {}, '貸し借り（ホスト）'),
    h('p', { class: 'muted' }, 'ホスト = GitHub Actions の時間を貸してくれる人のリポジトリ（.lab-host.json と host.yml）。貸し手は自分の条件を変えられ、借り手は残りの分と結果を見られます。'),
    h('div', { class: 'row' }, h('button', { onclick: () => act(async () => {
      const mine = await st.api.myRepos(), found = [];
      for (const r of mine.filter((x) => !x.fork && !x.archived).slice(0, 40)) if (await st.api.file(r.full_name, '.lab-host.json').catch(() => null)) found.push(r.full_name);
      S.set('hosts', [...new Set([...settings().hosts, ...found])]); st.hosts = await loadHosts(settings().hosts); render();
      toast(found.length ? `${found.length} 個見つけました` : '見つかりませんでした（最近の 40 個を見ました）');
    }) }, '自分のホストを探す'), add, h('button', { onclick: async () => { const v = add.value.trim(); if (!M.SLUG.test(v)) return toast('owner/名前 で', true); S.set('hosts', [...new Set([...settings().hosts, v])]); st.hosts = await loadHosts(settings().hosts); render(); } }, '加える'))));
  for (const x of st.hosts) body.append(hostCard(x), h('div', { class: 'row' }, h('button', { class: 'danger', onclick: () => { S.set('hosts', settings().hosts.filter((s) => s !== x.slug)); st.hosts = st.hosts.filter((y) => y.slug !== x.slug); render(); } }, `${x.slug} を一覧から外す`)));
}

// ---- 設定 ----
function settingsTab(body) {
  const s = settings(), lab = h('input', { type: 'text', value: s.lab }), refresh = h('input', { type: 'number', min: 5, max: 600, value: s.refresh }), vault = h('input', { type: 'password', value: s.vault, autocomplete: 'off' });
  body.append(h('div', { class: 'card' }, h('h2', {}, 'このブラウザの設定'),
    h('label', {}, 'ラボのリポジトリ'), lab, h('label', {}, '読み直す間隔（秒）'), refresh,
    h('label', {}, 'APP_CACHE_KEY（公開リポジトリの端末の命令と返事を封じる・開く。Secrets と同じ値。このブラウザだけに置きます）'), vault,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { if (!M.SLUG.test(lab.value.trim())) return toast('owner/名前 で', true); S.set('lab', lab.value.trim()); S.set('refresh', Number(refresh.value) || 20); S.set('vault', vault.value); toast('保存しました'); connect(); } }, '保存'),
      h('button', { class: 'danger', onclick: () => { token.clear(); S.del('vault'); renderSignIn(); } }, 'トークンと鍵を消して出る'))),
  h('div', { class: 'card' }, h('h2', {}, 'トークン'), h('p', {}, `ログイン ${st.me.login}・残り回数 ${st.api.state.remaining ?? '?'}`), h('p', {}, link(tokenLink(s.lab.split('/')[0]), '新しいトークンを作る')),
    h('p', { class: 'muted' }, '権限が足りないと、その操作だけ「権限がありません」と出ます（秘密の一覧: Secrets: Read、登録: Read and write、実行: Actions: Read and write、貸す条件: Contents: Read and write、端末: Issues: Read and write）')));
}

connect();
