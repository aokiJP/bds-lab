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
const people = {
  'tok-author': { login: 'author1', repos: { [LAB]: { admin: true, push: true, pull: true }, [HOST]: { push: true, pull: true } } },
  'tok-stranger': { login: 'stranger', repos: { [LAB]: { pull: true } } },
  'tok-lender': { login: 'lender1', repos: { [HOST]: { admin: true, push: true, pull: true } } },
};
const G = {
  files: { [`${LAB}:.github/workflows/app.yml`]: wf('app.yml'), [`${LAB}:.github/workflows/notify.yml`]: wf('notify.yml'), [`${LAB}:.github/workflows/secrets.yml`]: wf('secrets.yml'), [`${LAB}:.github/workflows/hostrun.yml`]: wf('hostrun.yml'),
    [`${HOST}:.lab-host.json`]: JSON.stringify({ lab: 1, minutesPerMonth: 600, jobs: ['gate', 'test'], hours: '00:00-24:00', timezone: 'UTC', until: '2099-12-31', contact: 'lender1' }, null, 2) },
  dispatched: [], secretsPut: [], filesPut: [], posted: [], secretNames: new Set(['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID', 'GOOGLE_EMAIL']), vars: { LAB_NOTIFY: 'failures' }, varsPut: [],
  artifacts: [{ id: 31, name: 'bds-addons', size_in_bytes: 1_234_567, expired: false, created_at: iso(now - 3_000_000), workflow_run: { id: 100, head_branch: 'main' } },
    { id: 30, name: 'old-addons', size_in_bytes: 99, expired: true, created_at: iso(now - 90 * 86_400_000), workflow_run: { id: 90, head_branch: 'main' } }],
  comments: [{ id: 900, body: 'lab-live@101 待っています（60 分まで。端末: スナップショットから起動しました）', created_at: iso(now - 60_000), user: { login: 'github-actions[bot]' } },
    { id: 901, body: AL.replyBody(101, 900, '> screen  [1.2 秒]\n--- 画面: com.mojang.minecraftpe', PNG, 60_000, VENV), created_at: iso(now - 50_000), user: { login: 'github-actions[bot]' } },
    // (a look-alike reply from someone else in the public issue: not shown)
    { id: 902, body: 'lab-reply@101 #900\n```\nFAKE ANSWER from a stranger\n```', created_at: iso(now - 40_000), user: { login: 'stranger' } }],
};
const runs = {
  [LAB]: [{ id: 101, name: 'app', path: '.github/workflows/app.yml', status: 'in_progress', conclusion: null, event: 'workflow_dispatch', head_branch: 'main', created_at: iso(now - 300_000), run_started_at: iso(now - 300_000), updated_at: iso(now), html_url: 'https://github.com/author1/bds-lab/actions/runs/101', triggering_actor: { login: 'author1' } },
    { id: 100, name: 'verify', path: '.github/workflows/verify.yml', status: 'completed', conclusion: 'failure', event: 'push', head_branch: 'main', created_at: iso(now - 3_600_000), run_started_at: iso(now - 3_600_000), updated_at: iso(now - 3_000_000), html_url: 'https://github.com/author1/bds-lab/actions/runs/100', triggering_actor: { login: 'author1' } }],
  [HOST]: [{ id: 7, name: 'host', status: 'completed', conclusion: 'success', event: 'workflow_dispatch', head_branch: 'lab/run-1', created_at: iso(now - 7_200_000), run_started_at: iso(now - 7_200_000), updated_at: iso(now - 7_200_000 + 25 * 60_000), html_url: 'https://github.com/lender1/bds-lab-host/actions/runs/7', triggering_actor: { login: 'author1' }, display_title: 'gate' }],
};
const jobs = { 100: [{ name: 'offline', status: 'completed', conclusion: 'failure', check_run_url: 'https://api.github.com/repos/author1/bds-lab/check-runs/55', html_url: 'https://github.com/x', steps: [{ name: 'checkout', status: 'completed', conclusion: 'success' }, { name: 'every offline test', status: 'completed', conclusion: 'failure' }] }],
  101: [{ name: 'device (1)', status: 'in_progress', steps: [{ name: 'checkout', status: 'completed' }, { name: '端末をそのまま調べる（hold）', status: 'in_progress' }] }] };
const repoJson = (slug, perm) => ({ full_name: slug, permissions: perm, visibility: slug === LAB ? 'public' : 'private', default_branch: 'main', html_url: `https://github.com/${slug}`, fork: false, archived: false });

async function api(route) {
  const req = route.request(), u = new URL(req.url()), p = u.pathname, who = people[String(req.headers().authorization ?? '').replace(/^Bearer /, '')];
  const send = (status, j) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'x-ratelimit-remaining': '4900', 'x-ratelimit-reset': '1' }, body: j === null ? '' : JSON.stringify(j) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH' } });
  if (!who) return send(401, { message: 'Bad credentials' });
  if (p === '/user') return send(200, { login: who.login, avatar_url: 'https://avatars.githubusercontent.com/u/1' });
  if (p === '/user/repos') return send(200, Object.entries(who.repos).map(([s, perm]) => repoJson(s, perm)));
  const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(p);
  if (!m) return send(404, { message: 'Not Found' });
  const [, slug, rest = ''] = m, perm = who.repos[slug];
  if (!perm) return send(404, { message: 'Not Found' });
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  if (rest === '') return send(200, repoJson(slug, perm));
  if (rest.startsWith('/contents/')) {
    const f = decodeURIComponent(rest.slice('/contents/'.length)), key = `${slug}:${f}`;
    if (req.method() === 'PUT') { if (!perm.push) return send(403, { message: 'no' }); G.filesPut.push({ slug, f, body }); G.files[key] = Buffer.from(body.content, 'base64').toString('utf8'); return send(200, {}); }
    return G.files[key] !== undefined ? send(200, { content: Buffer.from(G.files[key]).toString('base64'), sha: 'sha-' + key.length }) : send(404, { message: 'Not Found' });
  }
  if (rest === '/actions/secrets') return perm.admin ? send(200, { secrets: [...G.secretNames].map((name) => ({ name, updated_at: iso(now - 86_400_000) })) }) : send(403, { message: 'Resource not accessible' });
  if (rest === '/actions/secrets/public-key') return send(200, { key_id: 'KID1', key: SEAL.toB64(PK) });
  if (rest.startsWith('/actions/secrets/') && req.method() === 'PUT') { const name = decodeURIComponent(rest.split('/').pop()); G.secretsPut.push({ name, body }); G.secretNames.add(name); return send(201, null); }
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
  if (/^\/actions\/workflows\/[^/]+\/dispatches$/.test(rest)) { G.dispatched.push({ workflow: decodeURIComponent(rest.split('/')[3]), body }); return send(204, null); }
  if (/^\/actions\/workflows\/[^/]+\/runs/.test(rest)) { const w = decodeURIComponent(rest.split('/')[3]); return send(200, { workflow_runs: (runs[slug] ?? []).filter((r) => slug === HOST || r.path?.endsWith(`/${w}`)).filter((r) => !u.searchParams.get('status') || r.status === u.searchParams.get('status')) }); }
  if (rest === '/actions/runs') return send(200, { workflow_runs: runs[slug] ?? [] });
  const jm = /^\/actions\/runs\/(\d+)\/jobs/.exec(rest); if (jm) return send(200, { jobs: jobs[jm[1]] ?? [] });
  if (/^\/check-runs\/55\/annotations/.test(rest)) return send(200, [{ annotation_level: 'failure', title: '結果とエラー', message: 'FAIL gate: tests/panel-offline.mjs' }]);
  if (rest.startsWith('/pulls')) return send(200, []);
  if (rest === '/issues') return send(200, [{ number: 7, title: AL.ISSUE_TITLE }]);
  if (/^\/issues\/7\/comments/.test(rest)) { if (req.method() === 'POST') { G.posted.push(body.body); return send(201, { id: 1000 + G.posted.length }); } return send(200, G.comments); }
  return send(404, { message: `Not Found ${rest}` });
}

// ---- the page, served as GitHub Pages serves panel/: its files, with the page's own policy as a header too ----
const ROOT = path.join(TOP, 'panel'), CSP = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'), f = path.resolve(ROOT, `.${rel}`);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;
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
  check(await waitText(/使えません/) && /書き込める人/.test(await text()) && !/進み具合/.test(await page.locator('body').innerText()), 'a token with no write and no host: locked out, no tabs', await text());

  // the author
  await page.click('text=別のトークンで入る');
  await signIn('tok-author');
  check(await waitText(/管理者/) && await waitText(/✅ Discord の DM で端末を操作/) && /⚠️ 本物のアプリで確かめる/.test(await text()) && /GOOGLE_EMAIL・GOOGLE_AAS_TOKEN が要ります/.test(await text()), 'the author: admin; what their own secrets allow (Discord yes, the app lab not yet: what is missing said)', await text());
  check(await waitText(/動いている 1・失敗 1/), 'the overview counts the runs', await text());
  check((await page.evaluate(() => JSON.stringify(localStorage))).includes('tok-author'), 'remembered in this browser (asked to)');
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
  check(JSON.stringify(await page.locator('nav.tabs button').allInnerTexts()) === JSON.stringify(['概要', '進み具合', '実行', '成果物', 'Discord', '秘密', '端末', '貸し借り', '設定']), 'switched: the author\'s tabs', JSON.stringify(await page.locator('nav.tabs button').allInnerTexts()));
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
  check(!errors.length, 'no page error, no CSP report', errors.join('\n'));
} catch (e) {
  check(false, 'the run went through', e.stack);
} finally {
  await browser.close();
  srv.close();
}
console.log(bad ? `FAIL panel-browser (${bad})` : 'PASS panel-browser');
process.exit(bad ? 1 : 0);
