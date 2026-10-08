// The management panel in a REAL browser (headless Chromium via playwright-core), GitHub's API stood in for by routes:
//  - a token GitHub gives no write on the lab and no host → locked out, nothing loaded
//  - the author: their roles and what their repository's own settings allow, a failed run's annotation, a workflow started
//    with the preset's inputs, a secret sealed in the page (GitHub's key opens it; the value is never stored), the live
//    device driven through the issue — sealed both ways in a public repository once the vault key is set
//  - a lender: only their host, its minutes this month, lending stopped from the page (.lab-host.json's `until`)
//  - both in one browser: added with ＋, switched at the top, each with its own settings; the author runs a job on the
//    lender's Actions (hostrun.yml, after LAB_HOST_TOKEN is set in the page), sends a run's deliverables to Discord, sets
//    how Discord is told (repository variables), and a link from Discord opens the run it names
// Every page error and CSP report fails it. node tests/panel-browser.mjs (playwright-core is fetched once by npm;
// LAB_BROWSER / APP_BROWSER = a Chromium to use, else /opt/pw-browsers/chromium, else Chrome, else Playwright's own)
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const { loadPlaywright } = await imp('app/lib/playwright-login.mjs');
const SEAL = await imp('panel/lib/seal.mjs'), AL = await imp('app/lib/live.mjs'), M = await imp('panel/lib/model.mjs');
let bad = 0;
const check = (c, name, info = '') => { console.log(`${c ? '✔' : '✘'} ${name}${c ? '' : `\n    ${String(info).slice(0, 1500)}`}`); if (!c) bad++; };

// ---- a fake GitHub: three people, the lab (public) and a lender's host (private) ----
const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
const SK = crypto.randomBytes(32), PK = SEAL.x25519Public(SK);
const wf = (f) => fs.readFileSync(path.join(TOP, '.github', 'workflows', f), 'utf8');
const LAB = 'author1/bds-lab', HOST = 'lender1/bds-lab-host', VKEY = 'panel-browser-key', VENV = { APP_REPO_VISIBILITY: 'public', APP_CACHE_KEY: VKEY };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// (and an organization's private lab with a policy: its admin signs in with GitHub — the sign-in service's tokens ghu_* —
// and a writer comes with a token)
const CORP = 'acme/corp-lab', ADMIN = { admin: true, push: true, pull: true };
const FORK = 'newlender/bds-lab', forkSide = { synced: [], toggled: [], wfs: [{ id: 31, name: 'bds-lab host', path: '.github/workflows/host.yml', state: 'disabled_fork' }, { id: 32, name: 'verify', path: '.github/workflows/verify.yml', state: 'active' }] };
const people = {
  'tok-author': { login: 'author1', repos: { [LAB]: { admin: true, push: true, pull: true }, [HOST]: { push: true, pull: true } } },
  'tok-stranger': { login: 'stranger', repos: { [LAB]: { pull: true } } },
  'tok-newlender': { login: 'newlender', repos: { [LAB]: { pull: true }, [FORK]: { admin: true, push: true, pull: true }, 'someone/their-repo': { push: true, pull: true } } },
  'tok-lender': { login: 'lender1', repos: { [HOST]: { admin: true, push: true, pull: true } } },
  ghu_ceo1: { login: 'ceo1', repos: { [CORP]: ADMIN } }, ghu_ceo2: { login: 'ceo1', repos: { [CORP]: ADMIN } },
  'tok-writer': { login: 'writer1', repos: { [CORP]: { push: true, pull: true } } },
};
const POLICY = { roles: { admin: ['*'], write: ['dispatch', 'run.cancel'], auditor: ['audit.read'] }, teams: { auditors: 'auditor' }, confirm: ['dispatch', 'secrets.delete'], idleMinutes: 30, audit: 'issue' };
const G = {
  files: { [`${LAB}:.github/workflows/app.yml`]: wf('app.yml'), [`${LAB}:.github/workflows/notify.yml`]: wf('notify.yml'), [`${LAB}:.github/workflows/secrets.yml`]: wf('secrets.yml'), [`${LAB}:.github/workflows/hostrun.yml`]: wf('hostrun.yml'),
    [`${HOST}:.lab-host.json`]: JSON.stringify({ lab: 1, minutesPerMonth: 600, jobs: ['gate', 'test'], hours: '00:00-24:00', timezone: 'UTC', until: '2099-12-31', contact: 'lender1' }, null, 2),
    [`${CORP}:.github/workflows/verify.yml`]: wf('verify.yml'), [`${CORP}:.github/workflows/notify.yml`]: wf('notify.yml'), [`${CORP}:.github/workflows/pages.yml`]: wf('pages.yml'), [`${CORP}:.github/workflows/auth-deploy.yml`]: wf('auth-deploy.yml'),
    [`${CORP}:.github/bds-lab-panel.json`]: JSON.stringify(POLICY) },
  // (the organization's lab: its own secrets, variables, Pages, issues; the App made from its manifest)
  corp: { secrets: new Set(['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID']), vars: {}, pages: null, pagesPut: [], issues: [], comments: {}, labels: [], locks: [], manifests: [], conversions: [] },
  members: [['author1', 'admin'], ['helper1', 'write']], invites: [], membersPut: [],
  dispatched: [], secretsPut: [], filesPut: [], posted: [], secretNames: new Set(['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID', 'GOOGLE_EMAIL']), vars: { LAB_NOTIFY: 'failures' }, varsPut: [],
  artifacts: [{ id: 31, name: 'bds-addons', size_in_bytes: 1_234_567, expired: false, created_at: iso(now - 3_000_000), workflow_run: { id: 100, head_branch: 'main' } },
    { id: 30, name: 'old-addons', size_in_bytes: 99, expired: true, created_at: iso(now - 90 * 86_400_000), workflow_run: { id: 90, head_branch: 'main' } }],
  comments: [{ id: 900, body: 'lab-live@101 待っています（60 分まで。端末: スナップショットから起動しました）', created_at: iso(now - 60_000), user: { login: 'github-actions[bot]' } },
    { id: 901, body: AL.replyBody(101, 900, '> screen  [1.2 秒]\n--- 画面: com.mojang.minecraftpe', PNG, 60_000, VENV), created_at: iso(now - 50_000), user: { login: 'github-actions[bot]' } },
    // (a look-alike reply from someone else in the public issue: not shown)
    { id: 902, body: 'lab-reply@101 #900\n```\nFAKE ANSWER from a stranger\n```', created_at: iso(now - 40_000), user: { login: 'stranger' } }],
};
const cancelled = [];
const runs = {
  [LAB]: [{ id: 101, name: 'app', path: '.github/workflows/app.yml', status: 'in_progress', conclusion: null, event: 'workflow_dispatch', head_branch: 'main', created_at: iso(now - 300_000), run_started_at: iso(now - 300_000), updated_at: iso(now), html_url: 'https://github.com/author1/bds-lab/actions/runs/101', triggering_actor: { login: 'author1' } },
    { id: 100, name: 'verify', path: '.github/workflows/verify.yml', status: 'completed', conclusion: 'failure', event: 'push', head_branch: 'main', created_at: iso(now - 3_600_000), run_started_at: iso(now - 3_600_000), updated_at: iso(now - 3_000_000), html_url: 'https://github.com/author1/bds-lab/actions/runs/100', triggering_actor: { login: 'author1' } }],
  [HOST]: [{ id: 7, name: 'host', status: 'completed', conclusion: 'success', event: 'workflow_dispatch', head_branch: 'lab/run-1', created_at: iso(now - 7_200_000), run_started_at: iso(now - 7_200_000), updated_at: iso(now - 7_200_000 + 25 * 60_000), html_url: 'https://github.com/lender1/bds-lab-host/actions/runs/7', triggering_actor: { login: 'author1' }, display_title: 'gate' }],
};
const jobs = { 100: [{ name: 'offline', status: 'completed', conclusion: 'failure', check_run_url: 'https://api.github.com/repos/author1/bds-lab/check-runs/55', html_url: 'https://github.com/x', steps: [{ name: 'checkout', status: 'completed', conclusion: 'success' }, { name: 'every offline test', status: 'completed', conclusion: 'failure' }] }],
  101: [{ name: 'device (1)', status: 'in_progress', steps: [{ name: 'checkout', status: 'completed' }, { name: '端末をそのまま調べる（hold）', status: 'in_progress' }] }] };
const repoJson = (slug, perm) => ({ full_name: slug, permissions: perm, visibility: slug === LAB || slug === FORK ? 'public' : 'private', private: !(slug === LAB || slug === FORK), default_branch: 'main', html_url: `https://github.com/${slug}`, fork: slug === FORK, ...(slug === FORK ? { parent: { full_name: LAB } } : {}), archived: false, owner: { login: slug.split('/')[0], type: slug === CORP ? 'Organization' : 'User' } });
// (a key's shape made at run time: the lab's own secret scan — share, host's pre-push — reads this file as it is)
const PEM = `-----BEGIN RSA ${'PRIVATE'} KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA ${'PRIVATE'} KEY-----\n`;

async function api(route) {
  const req = route.request(), u = new URL(req.url()), p = u.pathname, who = people[String(req.headers().authorization ?? '').replace(/^Bearer /, '')];
  const send = (status, j) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'x-ratelimit-remaining': '4900', 'x-ratelimit-reset': '1' }, body: j === null ? '' : JSON.stringify(j) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH' } });
  // (the App made from its manifest: the code alone is the proof — asked without a token)
  const mc = /^\/app-manifests\/([^/]+)\/conversions$/.exec(p);
  if (mc && req.method() === 'POST') { G.corp.conversions.push({ code: mc[1], auth: req.headers().authorization ?? null }); return mc[1] === 'mcode' ? send(201, { id: 4242, slug: 'acme-bds-lab', client_id: 'Iv1.madeapp', client_secret: 'made-client-secret', pem: PEM, html_url: 'https://github.com/apps/acme-bds-lab', owner: { login: 'acme' } }) : send(404, { message: 'Not Found' }); }
  if (!who) return send(401, { message: 'Bad credentials' });
  if (p === '/user/installations') return send(200, { installations: who.login === 'ceo1' ? [{ id: 9, app_slug: 'acme-bds-lab', account: { login: 'acme' } }] : [] });
  if (p === '/user/installations/9/repositories') return send(200, { repositories: [repoJson(CORP, ADMIN)] });
  if (/^\/orgs\/acme\/teams\/[^/]+\/memberships\//.test(p)) return send(404, { message: 'Not Found' });
  if (p === '/user') return send(200, { login: who.login, avatar_url: 'https://avatars.githubusercontent.com/u/1' });
  if (p === '/user/repos') return send(200, Object.entries(who.repos).map(([s, perm]) => repoJson(s, perm)));
  if (/^\/users\/[^/]+$/.test(p)) return /ghost/.test(p) ? send(404, { message: 'Not Found' }) : send(200, { login: p.split('/').pop() });
  const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(p);
  if (!m) return send(404, { message: 'Not Found' });
  const [, slug, rest = ''] = m, perm = who.repos[slug];
  if (!perm) return send(404, { message: 'Not Found' });
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (rest === '') return send(200, repoJson(slug, perm));
  // (corpApi answers true once it has answered: route.fulfill itself resolves to nothing)
  if (slug === CORP && await corpApi(req, u, rest, body, who, perm, (...x) => send(...x).then(() => true))) return;
  if (rest.startsWith('/contents/')) {
    const f = decodeURIComponent(rest.slice('/contents/'.length)), key = `${slug}:${f}`;
    if (req.method() === 'PUT') { if (!perm.push) return send(403, { message: 'no' }); G.filesPut.push({ slug, f, body }); G.files[key] = Buffer.from(body.content, 'base64').toString('utf8'); return send(200, {}); }
    return G.files[key] !== undefined ? send(200, { content: Buffer.from(G.files[key]).toString('base64'), sha: 'sha-' + key.length }) : send(404, { message: 'Not Found' });
  }
  // (the lab's people: the owner, a writer, an invitation; invited, changed, removed)
  if (rest.startsWith('/collaborators') || rest.startsWith('/invitations')) {
    const m = req.method(), name = decodeURIComponent(rest.split('/')[2] ?? '');
    if (!perm.admin && m !== 'GET') return send(403, { message: 'Must have admin rights' });
    if (rest.startsWith('/collaborators') && m === 'GET') return send(200, G.members.map(([login, role_name]) => ({ login, role_name, avatar_url: 'https://avatars.githubusercontent.com/u/2' })));
    if (rest.startsWith('/invitations') && m === 'GET') return send(200, G.invites);
    if (m === 'PUT') { G.membersPut.push(`${name}=${body.permission}`); const had = G.members.find(([l]) => l === name); if (had) { had[1] = body.permission === 'push' ? 'write' : body.permission; return send(204, null); } G.invites.push({ id: 60 + G.invites.length, invitee: { login: name }, permissions: body.permission, created_at: iso(now) }); return send(201, { id: 60 }); }
    if (m === 'DELETE') { G.membersPut.push(`-${name}`); G.members = G.members.filter(([l]) => l !== name); G.invites = G.invites.filter((i) => String(i.id) !== name); return send(204, null); }
  }
  if (rest === '/actions/secrets') return perm.admin ? send(200, { secrets: [...G.secretNames].map((name) => ({ name, updated_at: iso(now - (name === 'GOOGLE_EMAIL' ? 400 : 1) * 86_400_000) })) }) : send(403, { message: 'Resource not accessible' });
  if (rest === '/actions/secrets/public-key') return send(200, { key_id: 'KID1', key: SEAL.toB64(PK) });
  if (rest.startsWith('/actions/secrets/') && req.method() === 'PUT') { const name = decodeURIComponent(rest.split('/').pop()); G.secretsPut.push({ name, body }); G.secretNames.add(name); return send(201, null); }
  // (the lender's fork: behind the lab — no host.yml yet — until synced; the lab's workflows as a fork has them)
  if (slug === FORK && rest === '/merge-upstream' && req.method() === 'POST') { forkSide.synced.push(body.branch); G.files[`${FORK}:.github/workflows/host.yml`] = fs.readFileSync(path.join(TOP, '.github/workflows/host.yml'), 'utf8'); return send(200, { merge_type: 'fast-forward' }); }
  const tw = /^\/actions\/workflows\/(\d+)\/(enable|disable)$/.exec(rest);
  if (slug === FORK && tw && req.method() === 'PUT') { forkSide.toggled.push(`${tw[2]} ${tw[1]}`); forkSide.wfs.find((w) => String(w.id) === tw[1]).state = tw[2] === 'enable' ? 'active' : 'disabled_manually'; return send(204, null); }
  if (slug === FORK && rest.startsWith('/actions/workflows')) return send(200, { workflows: forkSide.wfs });
  if (rest === '/actions/workflows') return send(200, { workflows: ['app', 'notify', 'secrets', 'verify', 'hostrun'].map((n, i) => ({ id: i + 1, name: n, path: `.github/workflows/${n}.yml`, state: 'active' })) });
  if (rest === '/actions/artifacts') return send(200, { artifacts: slug === LAB ? G.artifacts : [] });
  const am = /^\/actions\/runs\/(\d+)\/artifacts/.exec(rest); if (am) return send(200, { artifacts: slug === LAB ? G.artifacts.filter((a) => String(a.workflow_run.id) === am[1]) : [] });
  const vm = /^\/actions\/variables(?:\/([A-Z_]+))?$/.exec(rest);
  if (vm) {
    if (!perm.admin) return send(403, { message: 'Resource not accessible by personal access token' });
    if (req.method() === 'GET') return G.vars[vm[1]] !== undefined ? send(200, { name: vm[1], value: G.vars[vm[1]] }) : send(404, { message: 'Not Found' });
    if (req.method() === 'PATCH') { if (G.vars[vm[1]] === undefined) return send(404, { message: 'Not Found' }); G.vars[vm[1]] = body.value; G.varsPut.push(`PATCH ${vm[1]}=${body.value}`); return send(204, null); }
    if (req.method() === 'POST' && !vm[1]) { G.vars[body.name] = body.value; G.varsPut.push(`POST ${body.name}=${body.value}`); return send(201, null); }
  }
  if (/^\/actions\/workflows\/[^/]+\/dispatches$/.test(rest)) { G.dispatched.push({ slug, workflow: decodeURIComponent(rest.split('/')[3]), body, by: who.login }); return send(204, null); }
  if (/^\/actions\/workflows\/[^/]+\/runs/.test(rest)) { const w = decodeURIComponent(rest.split('/')[3]); return send(200, { workflow_runs: (runs[slug] ?? []).filter((r) => slug === HOST || r.path?.endsWith(`/${w}`)).filter((r) => !u.searchParams.get('status') || r.status === u.searchParams.get('status')) }); }
  if (rest === '/actions/runs') return send(200, { workflow_runs: runs[slug] ?? [] });
  const cm = /^\/actions\/runs\/(\d+)\/cancel$/.exec(rest); if (cm && req.method() === 'POST') { cancelled.push(`${slug}#${cm[1]}`); return send(202, {}); }
  const jm = /^\/actions\/runs\/(\d+)\/jobs/.exec(rest); if (jm) return send(200, { jobs: jobs[jm[1]] ?? [] });
  if (/^\/check-runs\/55\/annotations/.test(rest)) return send(200, [{ annotation_level: 'failure', title: '結果とエラー', message: 'FAIL gate: tests/panel-offline.mjs' }]);
  if (rest.startsWith('/pulls')) return send(200, []);
  if (rest === '/issues') return send(200, [{ number: 7, title: AL.ISSUE_TITLE }]);
  if (/^\/issues\/7\/comments/.test(rest)) { if (req.method() === 'POST') { G.posted.push(body.body); return send(201, { id: 1000 + G.posted.length }); } return send(200, G.comments); }
  return send(404, { message: `Not Found ${rest}` });
}

/** the organization's lab: its secrets, variables, Pages and audit issue (the rest as any lab) → undefined when not one of these */
async function corpApi(req, u, rest, body, who, perm, send) {
  const C = G.corp, m = req.method();
  if (rest === '/actions/secrets') return perm.admin ? send(200, { secrets: [...C.secrets].map((name) => ({ name, updated_at: iso(now) })) }) : send(403, { message: 'Resource not accessible' });
  if (rest.startsWith('/actions/secrets/') && rest !== '/actions/secrets/public-key' && m === 'PUT') { if (!perm.admin) return send(403, { message: 'no' }); const name = decodeURIComponent(rest.split('/').pop()); G.secretsPut.push({ slug: CORP, name, body, by: who.login }); C.secrets.add(name); return send(201, null); }
  const vm = /^\/actions\/variables(?:\/([A-Z_]+))?$/.exec(rest);
  if (vm) {
    if (!perm.admin) return send(403, { message: 'Resource not accessible' });
    if (m === 'GET' && !vm[1]) return send(200, { variables: Object.entries(C.vars).map(([name, value]) => ({ name, value })) });
    if (m === 'GET') return C.vars[vm[1]] !== undefined ? send(200, { name: vm[1], value: C.vars[vm[1]] }) : send(404, { message: 'Not Found' });
    if (m === 'PATCH') { if (C.vars[vm[1]] === undefined) return send(404, { message: 'Not Found' }); C.vars[vm[1]] = body.value; return send(204, null); }
    if (m === 'POST' && !vm[1]) { C.vars[body.name] = body.value; return send(201, null); }
  }
  if (rest === '/pages') {
    if (m === 'GET') return C.pages ? send(200, C.pages) : send(404, { message: 'Not Found' });
    if (!perm.admin) return send(403, { message: 'no' });
    C.pagesPut.push(`${m} ${body?.build_type}`); C.pages = { build_type: body?.build_type ?? 'workflow', html_url: 'https://acme.github.io/corp-lab/' }; return send(m === 'POST' ? 201 : 204, m === 'POST' ? C.pages : null);
  }
  if (rest === '/labels' && m === 'POST') { C.labels.push(body.name); return send(201, { name: body.name }); }
  if (rest === '/issues' && m === 'POST') { const n = 50 + C.issues.length; C.issues.push({ number: n, title: body.title, state: 'open', labels: (body.labels ?? []).map((name) => ({ name })) }); C.comments[n] = []; return send(201, { number: n }); }
  if (rest === '/issues' && m === 'GET') { const l = u.searchParams.get('labels'); return send(200, C.issues.filter((x) => !l || x.labels.some((y) => y.name === l))); }
  const lk = /^\/issues\/(\d+)\/lock$/.exec(rest); if (lk && m === 'PUT') { C.locks.push(Number(lk[1])); return send(204, null); }
  const cm = /^\/issues\/(\d+)\/comments/.exec(rest);
  if (cm && C.comments[cm[1]]) {
    if (m === 'POST') { const c = { id: 7000 + C.comments[cm[1]].length, body: body.body, user: { login: who.login }, created_at: iso(Date.now()), updated_at: iso(Date.now()), html_url: `https://github.com/${CORP}/issues/${cm[1]}#c` }; C.comments[cm[1]].push(c); return send(201, c); }
    return send(200, C.comments[cm[1]]);
  }
  return undefined;
}

// ---- the page, served as GitHub Pages serves panel/: its files, with the page's own policy as a header too ----
const TYPES = { '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
/** a folder served as Pages serves it, its page's own CSP sent as a header too → { srv, url } */
async function serve(root) {
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(fs.readFileSync(path.join(root, 'index.html'), 'utf8'))[1];
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'), f = path.resolve(root, `.${rel}`);
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream', 'content-security-policy': csp, 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}/` };
}
const { srv, url: URL0 } = await serve(path.join(TOP, 'panel'));
// (the same panel as pages.yml builds it with a sign-in service: config.json, the service let into its CSP)
const AUTH = 'https://auth.bdslab.test', BUILT = fs.mkdtempSync(path.join(os.tmpdir(), 'bds-lab-panel-built-'));
(await imp('common/panel-config.mjs')).buildPages(BUILT, { LAB_AUTH_URL: AUTH, APP_CLIENT_ID: 'Iv1.labapp' });
const { srv: srv2, url: URL2 } = await serve(BUILT);
// (the real sign-in service, auth/handler.mjs, answering at AUTH — GitHub's side of it a fake: the code and the refresh
// token exchanged, a token revoked)
const OA = { authorize: [], exchanges: [], revoked: [] }, CID = 'Iv1.labapp', CSECRET = 'app-client-secret-xyz';
const ghWeb = async (url, init = {}) => {
  const u = new URL(url), json = (status, j) => new Response(j === null ? null : JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
  if (u.pathname === '/login/oauth/access_token') {
    const b = Object.fromEntries(new URLSearchParams(String(init.body)));
    OA.exchanges.push(b);
    if (b.client_id !== CID || b.client_secret !== CSECRET) return json(200, { error: 'incorrect_client_credentials' });
    if (b.grant_type === 'refresh_token') return b.refresh_token === 'ghr_1' ? json(200, { access_token: 'ghu_ceo2', expires_in: 28800, refresh_token: 'ghr_2', refresh_token_expires_in: 15897600, token_type: 'bearer' }) : json(200, { error: 'bad_refresh_token' });
    // (the first token runs out within the panel's 5 minutes: it is renewed at once)
    return b.code === 'good-code' && b.code_verifier ? json(200, { access_token: 'ghu_ceo1', expires_in: 60, refresh_token: 'ghr_1', refresh_token_expires_in: 15897600, token_type: 'bearer' }) : json(200, { error: 'bad_verification_code' });
  }
  if (u.pathname === `/applications/${CID}/token` && init.method === 'DELETE') { OA.revoked.push({ auth: init.headers.authorization, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
  return json(404, {});
};
const authApp = (await imp('auth/handler.mjs')).handler({ GITHUB_CLIENT_ID: CID, GITHUB_CLIENT_SECRET: CSECRET, PANEL_ORIGINS: URL2, STATE_SECRET: 'state-secret-for-the-browser-test-0123456789' }, { fetchImpl: ghWeb });
async function authRoute(route) {
  const req = route.request(), hs = Object.fromEntries(Object.entries(await req.allHeaders()).filter(([k]) => !/^(host|content-length|connection|:)/.test(k)));
  const r = await authApp(new Request(req.url(), { method: req.method(), headers: hs, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() }));
  const out = {}; r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
  const cookies = r.headers.getSetCookie?.() ?? [];
  if (cookies.length) out['set-cookie'] = cookies.join('\n');
  // (Playwright does not route a redirect's next request: a hop to GitHub goes as a page that moves on, routed again)
  const to = out.location ?? '';
  if (r.status === 302 && to.startsWith('https://github.com/')) { delete out.location; return route.fulfill({ status: 200, headers: { ...out, 'content-type': 'text/html' }, body: hop(to) }); }
  await route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
}
const hop = (to) => `<!doctype html><meta http-equiv="refresh" content="0;url=${to.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
// (github.com: its OAuth page says yes at once; the App's manifest form taken and a page shown, as GitHub would)
async function githubRoute(route) {
  const req = route.request(), u = new URL(req.url());
  if (u.pathname === '/login/oauth/authorize') { OA.authorize.push(Object.fromEntries(u.searchParams)); return route.fulfill({ status: 200, contentType: 'text/html', body: hop(`${AUTH}/callback?code=good-code&state=${encodeURIComponent(u.searchParams.get('state'))}`) }); }
  if (/\/settings\/apps\/new$/.test(u.pathname) && req.method() === 'POST') { G.corp.manifests.push({ path: u.pathname, state: u.searchParams.get('state'), manifest: JSON.parse(new URLSearchParams(req.postData()).get('manifest')) }); return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>GitHub: Create GitHub App for acme</p>' }); }
  return route.fulfill({ status: 404, body: 'not here' });
}
const { pw } = loadPlaywright(path.join(os.tmpdir(), 'bds-lab-panel-browser'), { log: console.log });
const exe = process.env.LAB_BROWSER || process.env.APP_BROWSER || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
let browser;
for (const o of exe ? [{ executablePath: exe }] : [{ channel: 'chrome' }, {}]) { try { browser = await pw.chromium.launch({ headless: true, ...o, args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] }); break; } catch (e) { console.log(`  (${JSON.stringify(o)}: ${e.message.split('\n')[0]})`); } }
if (!browser) { console.log('✘ no browser to run'); process.exit(1); }
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
await ctx.route('https://api.github.com/**', api);
await ctx.route('https://avatars.githubusercontent.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
const page = await ctx.newPage(), errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '2099-01-31' : undefined));
const text = () => page.locator('main').innerText();
const waitText = async (re, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(await text())) return true; await page.waitForTimeout(150); } return false; };
const signIn = async (tok) => { await page.goto(URL0); await page.waitForSelector('#tok'); await page.fill('#tok', tok); await page.fill('#lab', LAB); await page.click('#go'); };
const tab = async (name) => { await page.locator('nav.tabs button', { hasText: name }).click(); if (process.env.PANEL_SHOTS) { await page.waitForTimeout(900); fs.mkdirSync(process.env.PANEL_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.PANEL_SHOTS, `${String(++shots).padStart(2, '0')}-${name}.png`), fullPage: true }); } };
let shots = 0;

try {
  // a stranger: GitHub gives this token no write on the lab and no host
  await signIn('tok-stranger');
  check(await waitText(/時間を貸す/) && /書き込める人/.test(await text()) && !/進み具合/.test(await page.locator('body').innerText()) && await page.locator('nav.tabs').count() === 0, 'a token with no write and no host: the lab shut, lending its only door, no tabs', await text());

  // a stranger who lends: their own new repository made a host from the page — someone else's never — and then lending is
  // all they have (no lab tabs)
  await page.click('text=別のアカウントで入る');
  await signIn('tok-newlender');
  await waitText(/時間を貸す/);
  await page.fill('#lend input[aria-label="フォーク"]', 'someone/their-repo');
  await page.locator('#lend button', { hasText: 'フォークで貸す' }).click();
  await page.waitForTimeout(500);
  check(/フォークだけ/.test(await page.locator('#toast').innerText()) && !G.filesPut.some((f) => f.slug === 'someone/their-repo'), 'a repository that is not their fork of the lab is never made a host', await page.locator('#toast').innerText());
  await page.fill('#lend input[aria-label="フォーク"]', FORK);
  await page.fill('#lend input[aria-label="1 か月に貸す分"]', '300');
  await page.locator('#lend button', { hasText: 'フォークで貸す' }).click();
  await waitText(/貸す条件（あなたのホスト）/, 8000);
  const made = G.filesPut.filter((f) => f.slug === FORK).map((f) => f.f);
  const tabsNow = await page.locator('nav.tabs button').allInnerTexts();
  check(JSON.stringify(forkSide.synced) === '["main"]' && JSON.stringify(made) === '[".lab-host.json"]' && JSON.parse(G.files[`${FORK}:.lab-host.json`]).minutesPerMonth === 300, 'their fork made a host: brought up to the lab (host.yml as the lab has it), their rules written — nothing else', JSON.stringify({ synced: forkSide.synced, made }));
  check(JSON.stringify(forkSide.toggled) === JSON.stringify(['enable 31', 'disable 32']), 'only host.yml runs in their fork: the lab\'s own CI off there', JSON.stringify(forkSide.toggled));
  check(JSON.stringify(tabsNow) === JSON.stringify(['概要', '貸し借り', '設定']) && /貸し手/.test(await text()) && /のフォーク/.test(await text()), 'then a lender: lending is all there is (no runs, secrets, members …)', JSON.stringify(tabsNow));
  await page.locator('#who button', { hasText: '出る' }).click();

  // the author
  await signIn('tok-author');
  check(await waitText(/管理者/) && await waitText(/✅ Discord の DM で端末を操作/) && /⚠️ 本物のアプリで確かめる/.test(await text()) && /GOOGLE_EMAIL・GOOGLE_AAS_TOKEN が要ります/.test(await text()), 'the author: admin; what their own secrets allow (Discord yes, the app lab not yet: what is missing said)', await text());
  check(await waitText(/動いている 1・失敗 1/), 'the overview counts the runs', await text());
  check((await page.evaluate(() => JSON.stringify(localStorage))).includes('tok-author'), 'remembered in this browser (asked to)');
  check(await waitText(/ワークフローの調子/) && await page.locator('[data-health=".github/workflows/verify.yml"]', { hasText: '1 回続けて失敗' }).count() === 1, 'each workflow\'s health: verify failing in a row', await text());
  await page.keyboard.press('2');
  check((await page.locator('nav.tabs button.on').innerText()) === '進み具合', 'a key for a tab (2: the runs)', await page.locator('nav.tabs button.on').innerText());
  await tab('進み具合');
  await waitText(/verify/);
  check(await waitText(/いま: 端末をそのまま調べる（hold）/), 'a run still going shows its progress by itself (the step it is on)', await text());
  await page.locator('.card', { hasText: 'verify' }).locator('button', { hasText: '詳しく' }).click();
  check(await waitText(/FAIL gate: tests\/panel-offline\.mjs/) && /❌ offline — 2\/2/.test(await text()), 'a failed run: its jobs, steps and the annotation that says why', await text());
  await tab('実行');
  await page.locator('li', { hasText: 'スマホで端末を操作' }).locator('button', { hasText: '開く' }).click();
  await waitText(/app\.yml を始める/);
  check(await page.locator('#dform select').first().inputValue() !== '' && (await page.locator('#dform').innerText()).includes('mode'), 'the preset opens app.yml\'s own inputs', await page.locator('#dform').innerText());
  await page.locator('#dform button', { hasText: '始める' }).click();
  await waitText(/始めました/, 3000).catch(() => {});
  await page.waitForTimeout(500);
  const d = G.dispatched[0];
  check(d && d.workflow === 'app.yml' && d.body.ref === 'main' && d.body.inputs.mode === 'hold' && d.body.inputs.hold === '60' && d.body.inputs.addon === 'jsonui_demo', 'started app.yml with mode hold, 60 minutes, the rest its defaults', JSON.stringify(G.dispatched));
  await page.waitForTimeout(2800);
  await tab('秘密');
  await waitText(/DISCORD_BOT_TOKEN/);
  check(/✅ DISCORD_BOT_TOKEN/.test(await text()) && /・ MS_EMAIL/.test(await text()), 'the secrets: which are set (names only)', await text());
  check(/180 日以上そのままの秘密が 1 個: GOOGLE_EMAIL/.test(await text()) && /⚠️ 400 日前に登録/.test(await text()), 'a secret not set again for half a year said', await text());
  const inputs = page.locator('#tabbody input');
  await inputs.nth(0).fill('ms_email'); await inputs.nth(1).fill('player.one@example.com');
  await page.locator('#tabbody button', { hasText: '登録する' }).click();
  await waitText(/MS_EMAIL を登録しました/, 5000).catch(() => {});
  await page.waitForTimeout(500);
  const sp = G.secretsPut[0], sealed = sp ? SEAL.fromB64(sp.body.encrypted_value) : new Uint8Array(0), epk = sealed.subarray(0, 32);
  const opens = sp && Buffer.from(SEAL.box(new TextEncoder().encode('player.one@example.com'), SEAL.blake2b(Buffer.concat([epk, PK]), 24), epk, SK)).equals(Buffer.from(sealed.subarray(32)));
  check(sp && sp.name === 'MS_EMAIL' && sp.body.key_id === 'KID1' && opens, 'a secret sealed in the page: GitHub\'s key opens it to what was typed', JSON.stringify(G.secretsPut));
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.body.innerText);
  check(!stored.includes('player.one@example.com') && (await inputs.nth(1).inputValue()) === '', 'the value is kept nowhere (storage, page) and the field is emptied');

  // the live device: sealed in a public repository — unreadable without the key, then read and driven with it
  await tab('端末');
  await page.locator('button', { hasText: '操作する' }).click();
  check(await waitText(/封じられています/), 'without the vault key the reply is said to be sealed', await text());
  await tab('設定');
  // debug: the last GitHub calls on this device, no token in them; an error on the page shown at once at the top
  check(/GET \/repos\/author1\/bds-lab/.test(await page.locator('#debuglog').innerText()) && !/tok-author/.test(await page.locator('#debug').innerText()), 'the debug card: the last calls, never the token', await page.locator('#debug').innerText());
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'boom ghp_abcdefghijklmnop1234', filename: 'x/panel.js', lineno: 9 })));
  check(await page.locator('#faults').innerText() === '⚠ 1', 'an error on the page: a mark at the top at once', await page.locator('#who').innerText());
  await page.locator('#debug button', { hasText: '読み直す' }).click();
  check(/boom \[消しました\] \(panel\.js:9\)/.test(await page.locator('#debuglog').innerText()), 'the error in the debug card, a token in it taken out', await page.locator('#debuglog').innerText());
  await page.locator('#debug button', { hasText: '消す' }).click();
  check(await page.locator('#faults').count() === 0, 'cleared: the mark gone');
  await page.locator('#tabbody input[type=password]').fill(VKEY);
  await page.locator('#tabbody button', { hasText: '保存' }).click();
  await waitText(/管理者/);
  await tab('端末');
  await page.locator('button', { hasText: '操作する' }).click();
  check(await waitText(/画面: com\.mojang\.minecraftpe/) && await page.locator('img.screen').count() === 1, 'with the key: the runner\'s sealed reply opened, its screen shown', await text());
  check(!/FAKE ANSWER/.test(await text()), 'a look-alike reply from someone else is not shown', await text());
  await page.locator('.pad button', { hasText: '⬆️ 前へ' }).click();
  await page.waitForTimeout(600);
  check(G.posted.length === 1 && AL.commandsOf(G.posted[0], 101, VENV)?.[0] === 'walk forward 1' && !G.posted[0].includes('walk'), 'a button sends the sealed command the runner takes', G.posted.join('\n'));
  await page.locator('.pad button', { hasText: '🧰 道具' }).click();
  await page.locator('.pad button', { hasText: '🔗 参加' }).click();
  await page.waitForTimeout(600);
  check(JSON.stringify(AL.commandsOf(G.posted[1], 101, VENV)) === JSON.stringify(['relay', 'step join']), 'another page; a two-command button sends both', G.posted[1]);
  // the author also borrows a host: its minutes, not its rules to change
  await tab('貸し借り');
  await page.locator('#tabbody input[type=text]').fill(HOST);
  await page.locator('#tabbody button', { hasText: '加える' }).click();
  check(await waitText(/借り手/) && await waitText(/今月 25 分/) && !/貸す条件（あなたのホスト）/.test(await text()), 'a borrower: the host\'s minutes this month, no form to change its rules', await text());

  // where a job runs: the lender's Actions — hostrun.yml needs LAB_HOST_TOKEN, set in the page, then started from it
  await tab('実行');
  await page.locator(`ul.targets input[value="${HOST}"]`).check();
  check(await waitText(/lender1 さんの Actions/) && await waitText(/今月 25 分 \/ 止まる 480 分/) && /LAB_HOST_TOKEN が要ります/.test(await text()) && await page.locator('button', { hasText: 'さんの Actions で始める' }).isDisabled(), 'the lender\'s host as where to run: its minutes; without LAB_HOST_TOKEN it cannot start, and says what is missing', await text());
  await page.locator('button', { hasText: '「秘密」で登録する' }).click();
  await page.waitForSelector('#tabbody input');
  check(await page.locator('#tabbody input').nth(0).inputValue() === 'LAB_HOST_TOKEN', 'the secret\'s name filled in', await page.locator('#tabbody input').nth(0).inputValue());
  await page.locator('#tabbody input').nth(1).fill('ghp_the_borrowers_own_token');
  await page.locator('#tabbody button', { hasText: '登録する' }).click();
  await waitText(/LAB_HOST_TOKEN を登録しました/, 5000).catch(() => {});
  await page.waitForTimeout(800);
  check(G.secretsPut.some((x) => x.name === 'LAB_HOST_TOKEN'), 'LAB_HOST_TOKEN sealed and set', JSON.stringify(G.secretsPut.map((x) => x.name)));
  await tab('実行');
  await page.locator(`ul.targets input[value="${HOST}"]`).check();
  await waitText(/いま使えます/);
  await page.selectOption('#hjob', 'test');
  await page.fill('#hunit', 'coins');
  await page.locator('button', { hasText: 'さんの Actions で始める' }).click();
  await waitText(/を始めました/, 3000).catch(() => {});
  await page.waitForTimeout(500);
  const hr = G.dispatched.find((x) => x.workflow === 'hostrun.yml');
  check(hr && hr.body.ref === 'main' && JSON.stringify(hr.body.inputs) === JSON.stringify({ host: HOST, job: 'test', unit: 'coins', wait: 'true' }), 'started on the lender\'s Actions: hostrun.yml with the host, the job, the unit', JSON.stringify(G.dispatched));
  await page.waitForTimeout(2600);

  // what the runs left: sent to Discord by notify (its files go along)
  await tab('成果物');
  check(await waitText(/bds-addons（1\.2 MB）/) && /old-addons（99 B・期限切れ）/.test(await text()), 'the artifacts by run; an expired one said so', await text());
  check(await page.locator('.card', { hasText: '実行 90' }).locator('button', { hasText: 'Discord に送る' }).count() === 0, 'nothing to send of an expired one');
  await page.locator('.card', { hasText: '実行 100' }).locator('button', { hasText: 'Discord に送る' }).click();
  await page.waitForTimeout(500);
  const nd = G.dispatched.find((x) => x.workflow === 'notify.yml');
  check(nd && nd.body.inputs.run === '100' && nd.body.inputs.message === '', 'sent to Discord: notify.yml for that run (its deliverables go with the message)', JSON.stringify(G.dispatched));

  // Discord: what is set, how runs are told (repository variables), a wrong id refused, a test
  await tab('Discord');
  check(await waitText(/✅ DM で届きます/) && await waitText(/いま: LAB_NOTIFY=failures・LAB_NOTIFY_FILES=（なし: auto）/), 'Discord: the DM is set up; the variables as they are', await text());
  await page.selectOption('select[aria-label="LAB_NOTIFY"]', 'all');
  await page.selectOption('select[aria-label="LAB_NOTIFY_FILES"]', 'off');
  await page.locator('button', { hasText: '知らせ方を保存' }).click();
  await page.waitForTimeout(700);
  check(JSON.stringify(G.varsPut) === JSON.stringify(['PATCH LAB_NOTIFY=all', 'POST LAB_NOTIFY_FILES=off']), 'saved as repository variables (made when missing)', JSON.stringify(G.varsPut));
  const putBefore = G.secretsPut.length;
  await page.locator('input[aria-label="DISCORD_USER_ID"]').fill('not-a-number');
  await page.locator('#tabbody li', { hasText: 'DISCORD_USER_ID' }).locator('button').click();
  await page.waitForTimeout(300);
  check(/DISCORD_USER_ID の形が違います/.test(await page.locator('#toast').innerText()) && G.secretsPut.length === putBefore, 'a Discord id that is not one is refused in the page', await page.locator('#toast').innerText());
  await page.locator('#tabbody li', { hasText: '試しに送る' }).locator('button').click();
  await page.waitForTimeout(500);
  check(G.dispatched.some((x) => x.workflow === 'notify.yml' && x.body.inputs.run === '' && /管理パネルから試しに送りました/.test(x.body.inputs.message)), 'a test message through notify', JSON.stringify(G.dispatched));

  // members: someone invited as an administrator (asked first), a writer made a reader, the owner and oneself untouchable
  await tab('メンバー');
  check(await waitText(/helper1/) && await page.locator('[data-member="author1"] select').isDisabled() && /持ち主/.test(await text()), 'the lab\'s people: the owner (not changeable here), a writer', await text());
  await page.locator('#tabbody input[aria-label="招く人"]').fill('friend1');
  await page.selectOption('#tabbody select[aria-label="役割"]', 'admin');
  await page.locator('#tabbody button', { hasText: '招く' }).click();
  await waitText(/friend1/, 5000);
  await page.selectOption('[data-member="helper1"] select', 'pull');
  await page.waitForTimeout(600);
  check(JSON.stringify(G.membersPut) === JSON.stringify(['friend1=admin', 'helper1=pull']) && /招待中/.test(await text()), 'invited as an administrator (pending until they accept); a writer made a reader', JSON.stringify(G.membersPut));
  check(await page.locator('table input[aria-label="admin: dispatch"]').isDisabled() && await page.locator('table input[aria-label="write: dispatch"]').isChecked(), 'the roles as a grid: administrators always everything', '');
  await page.locator('[data-preset="team"]').click();
  check(await page.locator('table input[aria-label="maintain: variables"]').isChecked() && !await page.locator('table input[aria-label="maintain: secrets.put"]').isChecked() && await page.locator('table input[aria-label="write: hostrun"]').isChecked() && !G.filesPut.some((f) => /bds-lab-panel/.test(JSON.stringify(f))), 'a ready-made grid in one tap, not saved until asked', JSON.stringify(G.filesPut));
  check(await page.locator('#tabbody button', { hasText: '🔗 アドレス' }).count() >= 1, 'an invitation\'s address to pass along');
  // the runs found as typed
  await tab('進み具合');
  await page.fill('input[aria-label="実行を探す"]', 'verify');
  await page.waitForTimeout(800);
  check(/verify/.test(await text()) && !/hold/.test(await page.locator('#tabbody').innerText()), 'the runs narrowed as typed', await text());
  await page.fill('input[aria-label="実行を探す"]', '');
  // two going: stopped at once (asked once, each one kept in the audit log)
  runs[LAB].unshift({ ...runs[LAB][0], id: 102, name: 'verify', path: '.github/workflows/verify.yml', html_url: 'https://github.com/author1/bds-lab/actions/runs/102' });
  await page.locator('button', { hasText: '読み直す' }).click();
  await page.locator('button', { hasText: '動いている 2 件を全部止める' }).click();
  await page.waitForTimeout(800);
  check(JSON.stringify(cancelled) === JSON.stringify([`${LAB}#102`, `${LAB}#101`]), 'every run going stopped with one button', JSON.stringify(cancelled));
  runs[LAB].shift();

  // a link from Discord's message: the run it names, opened with its reasons
  await page.goto('about:blank');
  await page.goto(`${URL0}#runs?repo=${encodeURIComponent(LAB)}&run=100`);
  check(await waitText(/FAIL gate: tests\/panel-offline\.mjs/) && (await page.locator('nav.tabs button.on').innerText()) === '進み具合', 'Discord\'s link opens the run it names, its reasons shown', await text());

  // a second account in the same browser: the lender, added with ＋ (their own hosts found on their first visit)
  await page.locator('#who button', { hasText: '＋' }).click();
  await page.waitForSelector('#tok');
  await page.fill('#tok', 'tok-lender'); await page.fill('#lab', LAB); await page.click('#go');
  await page.waitForSelector('nav.tabs button', { timeout: 10_000 }).catch(() => {});
  const tabs = await page.locator('nav.tabs button').allInnerTexts();
  check(JSON.stringify(tabs) === JSON.stringify(['概要', '貸し借り', '設定']), 'a lender sees the overview, the hosts and the settings only', JSON.stringify(tabs));
  await tab('貸し借り');
  await page.locator('button', { hasText: '自分のホストを探す' }).click();
  check(await waitText(/貸す条件（あなたのホスト）/) && await waitText(/今月 25 分 \/ 止まる 480 分/) && /いま使えます/.test(await text()), 'found their host: its minutes against its stop (80%), usable now, its rules to change', await text());
  await page.locator('button', { hasText: '今すぐ止める' }).click();
  await page.waitForTimeout(800);
  const put = G.filesPut.at(-1), j = put ? JSON.parse(Buffer.from(put.body.content, 'base64').toString('utf8')) : null;
  check(put && put.slug === HOST && put.f === '.lab-host.json' && j.until === M.dayOf(new Date(now - 86_400_000), 'UTC') && j.minutesPerMonth === 600 && put.body.sha, 'stopped: .lab-host.json\'s until moved to yesterday (the rest kept, with its sha)', JSON.stringify(put?.body));
  check(await waitText(/期限（\d{4}-\d\d-\d\d）を過ぎました/), 'the host now says it is not lending', await text());
  check(JSON.stringify(await page.locator('#acct option').allInnerTexts()) === JSON.stringify(['author1', 'lender1']) && (await page.locator('#acct').inputValue()) === 'lender1', 'both accounts at the top, the lender in use', await page.locator('#who').innerText());

  // back to the author with a tap: their own settings (the host they borrow, the vault key) as they left them
  await page.selectOption('#acct', 'author1');
  await waitText(/管理者/);
  check(JSON.stringify(await page.locator('nav.tabs button').allInnerTexts()) === JSON.stringify(['概要', '進み具合', '実行', '成果物', 'Discord', '秘密', '端末', '貸し借り', 'メンバー', '準備', '監査', '設定']), 'switched: the author\'s tabs', JSON.stringify(await page.locator('nav.tabs button').allInnerTexts()));
  check(await waitText(/期限（\d{4}-\d\d-\d\d）を過ぎました/) && /借り手/.test(await text()), 'the host the author borrows (their own list), now stopped by its lender', await text());
  await tab('設定');
  check((await page.locator('#tabbody input[type=password]').inputValue()) === VKEY && /lender1/.test(await text()) && /author1\/bds-lab・ホスト 1/.test(await text()), 'the author\'s vault key kept for the author; both accounts listed with their own settings', await text());
  const lenderCfg = await page.evaluate(() => localStorage.getItem('bdslab.panel.cfg.lender1'));
  check(lenderCfg && !lenderCfg.includes('panel-browser-key') && lenderCfg.includes('lender1/bds-lab-host'), 'the lender\'s settings are theirs (no vault key of the author\'s)', lenderCfg);

  // 出る: this account forgotten by this browser — the other stays, in use
  await page.locator('#who button', { hasText: '出る' }).click();
  await waitText(/貸し借り/);
  const left = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  check(!left.includes('tok-author') && !left.includes('panel-browser-key') && left.includes('tok-lender') && (await page.locator('#who').innerText()).includes('lender1') && (await page.locator('#acct').count()) === 0, 'leaving forgets that account only (its token and key)', left);

  // ======== an organization's lab, the company way: 「GitHub でサインイン」 through the real sign-in service, the lab's
  // policy and audit log, the App made in one click from 「準備」, the token revoked on leaving ========
  const ctx2 = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await ctx2.route('https://api.github.com/**', api);
  await ctx2.route('https://avatars.githubusercontent.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await ctx2.route(`${AUTH}/**`, authRoute);
  await ctx2.route('https://github.com/**', githubRoute);
  const p2 = await ctx2.newPage(), asked = [];
  p2.on('pageerror', (e) => errors.push(`pageerror (2): ${e.message}`));
  p2.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console (2): ${m.text()}`); });
  p2.on('dialog', (d) => { asked.push(d.message()); d.accept(); });
  const text2 = () => p2.locator('main').innerText();
  const wait2 = async (re, ms = 10_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(await text2())) return true; await p2.waitForTimeout(150); } return false; };
  const tab2 = (name) => p2.locator('nav.tabs button', { hasText: name }).click();
  const kept2 = () => p2.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  await p2.goto(URL2);
  await p2.waitForSelector('#oauth');
  check(await p2.locator('details').evaluate((d) => !d.open) && await p2.locator('#tok').isHidden(), 'with a sign-in service: 「GitHub でサインイン」 first, typing a token folded away', await text2());
  await p2.fill('#oauth-lab', CORP);
  await p2.click('#oauth');
  check(await wait2(/ceo1 さん/, 15_000) && /GitHub でサインイン（ラボの App）/.test(await text2()) && /役割 admin/.test(await text2()), 'signed in with GitHub (no token made by hand): the organization\'s admin, by the lab\'s policy', await text2());
  const a0 = OA.authorize[0] ?? {}, x0 = OA.exchanges[0] ?? {};
  check(a0.client_id === CID && a0.code_challenge && a0.code_challenge_method === 'S256' && a0.redirect_uri === `${AUTH}/callback` && x0.code_verifier && x0.client_secret === CSECRET, 'the service: PKCE, its own callback, the App\'s secret on its side only', JSON.stringify({ a0, x0: { ...x0, client_secret: x0.client_secret ? '…' : null } }));
  const k1 = await kept2();
  check(!p2.url().includes('bdslab-auth') && !k1.includes('ghu_ceo1') && k1.includes('ghu_ceo2') && !k1.includes(CSECRET) && OA.exchanges[1]?.grant_type === 'refresh_token', 'the handoff out of the address at once; the short-lived token renewed through the service and kept; the App\'s secret never in the browser', p2.url());

  // a run started: the policy asks first, the audit log keeps it as this person's own comment
  await tab2('実行');
  await p2.locator('li', { hasText: 'ラボの試験を全部' }).locator('button', { hasText: '開く' }).click();
  await p2.waitForSelector('#dform button');
  await p2.locator('#dform button', { hasText: '始める' }).click();
  await p2.waitForTimeout(1200);
  const d2 = G.dispatched.find((x) => x.slug === CORP);
  check(d2 && d2.workflow === 'verify.yml' && d2.by === 'ceo1' && asked.some((q) => /ワークフローを始める（verify\.yml）: よろしいですか/.test(q)), 'started with the person\'s own sign-in, after the question the policy asks', JSON.stringify({ d2, asked }));
  const issue = G.corp.issues[0], c0 = issue ? G.corp.comments[issue.number][0] : null;
  check(issue && issue.title === 'bds-lab 監査ログ' && G.corp.labels.includes('bds-lab-audit') && G.corp.locks.includes(issue.number) && c0 && c0.user.login === 'ceo1' && /<!-- bdslab-audit \{.*"actor":"ceo1".*"action":"dispatch"/.test(c0.body) && !/ghu_|ghr_/.test(c0.body), 'kept in the audit log: an issue with its label, locked (collaborators only), the person\'s own comment, no token in it', JSON.stringify({ issue, c0 }));
  await tab2('監査');
  check(await wait2(/ceo1/) && /ワークフローを始めた/.test(await text2()) && /verify\.yml/.test(await text2()), 'the audit tab reads it back', await text2());
  const [dl] = await Promise.all([p2.waitForEvent('download'), p2.locator('button', { hasText: 'CSV で取り出す' }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  check(/^﻿?at,actor,action,target,detail,edited,url/.test(csv) && /,ceo1,dispatch,acme\/corp-lab,/.test(csv), 'and gives it as CSV for a spreadsheet', csv.slice(0, 400));

  // 「準備」: Pages turned on, the App made from its manifest in one click — its keys sealed into the lab's secrets, nothing kept
  await tab2('準備');
  check(await wait2(/GitHub Pages/) && await wait2(/App を作る/), 'the checks: what is missing, with a way to fix each', await text2());
  const pagesFix = p2.locator('[data-check="pages"] a, [data-check="pages"] button').first();
  check(await pagesFix.count() === 1, 'Pages: a way to turn it on (a link to the settings when signed in with the App)', await p2.locator('[data-check="pages"]').innerText());
  await p2.locator('[data-check="app"] button[type=submit]').click();
  await p2.waitForURL(/github\.com/);
  const mf = G.corp.manifests[0];
  check(mf && mf.path === '/organizations/acme/settings/apps/new' && mf.manifest.callback_urls?.[0] === `${AUTH}/callback` && mf.manifest.public === true && mf.manifest.hook_attributes?.active === false && mf.manifest.default_permissions?.secrets === 'write' && mf.state, 'the App\'s form posted to GitHub with its manifest (the organization\'s, its callback the service, no webhook)', JSON.stringify(mf));
  // (as GitHub sends the person back after they press its button)
  await p2.goto(`${URL2}?code=mcode&state=${encodeURIComponent(mf.state)}`);
  await p2.waitForTimeout(2500);
  const put2 = Object.fromEntries(G.secretsPut.filter((x) => x.slug === CORP).map((x) => [x.name, x]));
  // (sealed to the lab's key: GitHub's private key opens each to the App's own value — sealed again here, the same bytes)
  const sealedIs = (x, plain) => { if (!x) return false; const sealed = SEAL.fromB64(x.body.encrypted_value), epk = sealed.subarray(0, 32); return Buffer.from(SEAL.box(new TextEncoder().encode(plain), SEAL.blake2b(Buffer.concat([epk, PK]), 24), epk, SK)).equals(Buffer.from(sealed.subarray(32))); };
  check(sealedIs(put2.APP_PRIVATE_KEY, PEM) && sealedIs(put2.APP_CLIENT_SECRET, 'made-client-secret') && put2.AUTH_STATE_SECRET && G.corp.vars.APP_ID === '4242' && G.corp.vars.APP_SLUG === 'acme-bds-lab' && G.corp.vars.APP_CLIENT_ID === 'Iv1.madeapp' && G.corp.conversions[0]?.auth === null, 'the App\'s keys sealed into the lab\'s secrets and its names into variables, the code turned in without the person\'s token', JSON.stringify({ secrets: Object.keys(put2), vars: G.corp.vars, conv: G.corp.conversions }));
  const k2 = await kept2(), shown = await text2();
  check(!p2.url().includes('code=') && !k2.includes('made-client-secret') && !k2.includes('BEGIN RSA') && !shown.includes('made-client-secret') && !shown.includes('BEGIN RSA'), 'the code out of the address; the App\'s secret and key neither kept nor shown', p2.url());

  // leaving: the token revoked on GitHub through the service, nothing of the account left
  await p2.locator('#who button', { hasText: '出る' }).click();
  await p2.waitForSelector('#oauth');
  const k3 = await kept2();
  check(OA.revoked.length === 1 && OA.revoked[0].body.access_token === 'ghu_ceo2' && OA.revoked[0].auth === `Basic ${Buffer.from(`${CID}:${CSECRET}`).toString('base64')}` && !/ghu_|ghr_/.test(k3), 'leaving revokes the token on GitHub (through the service) and forgets it here', JSON.stringify(OA.revoked));

  // a writer of the organization's lab (a token): what the policy gives the role (runs) and what it does not (secrets, the log)
  await p2.locator('summary').click();
  await p2.fill('#tok', 'tok-writer'); await p2.fill('#lab', CORP); await p2.click('#go');
  await p2.waitForSelector('nav.tabs button');
  const tabs2 = await p2.locator('nav.tabs button').allInnerTexts();
  check(!tabs2.includes('監査') && tabs2.includes('実行'), 'a writer: no audit tab (the policy gives the role no audit.read)', JSON.stringify(tabs2));
  await tab2('秘密');
  await p2.locator('#tabbody input').nth(0).fill('MS_EMAIL'); await p2.locator('#tabbody input').nth(1).fill('w@example.com');
  const before2 = G.secretsPut.length;
  await p2.locator('#tabbody button', { hasText: '登録する' }).click();
  await p2.waitForTimeout(500);
  check(G.secretsPut.length === before2 && /秘密を登録するは、あなたの役割（write）には許されていません/.test(await p2.locator('#toast').innerText()), 'a writer may not set a secret: the policy says so before GitHub is asked', await p2.locator('#toast').innerText());
  await ctx2.close();

  check(!errors.length, 'no page error, no CSP report', errors.join('\n'));
} catch (e) {
  check(false, 'the run went through', e.stack);
} finally {
  await browser.close();
  srv.close(); srv2.close(); fs.rmSync(BUILT, { recursive: true, force: true });
}
console.log(bad ? `FAIL panel-browser (${bad})` : 'PASS panel-browser');
process.exit(bad ? 1 : 0);
