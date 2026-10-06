#!/usr/bin/env node
// login without GitHub / Google / Microsoft: local fake sign-in pages and a fake gh. The real browser (Playwright, hidden)
// fills the address, password, the TOTP code and gh's device code, presses Authorize; .env parsing, TOTP (RFC 6238 vectors),
// secrets kept out of the environment. Needs a Chromium (LAB_BROWSER, or the one Playwright finds) and npm once for
// playwright-core; without them only the parts without a browser run. node tests/login-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'login-offline-'));
let good = 0, bad = 0;
const check = (c, name, info = '') => { if (c) { good++; console.log(`✔ ${name}`); } else { bad++; console.log(`✘ ${name}\n${String(info).slice(-2500)}`); } };
const S = await import(pathToFileURL(path.join(TOP, 'common', 'secrets.mjs')).href);

// 1. .env: parsing, precedence, secrets stay out of the environment
fs.writeFileSync(path.join(T, '.env'), '# c\nANTHROPIC_API_KEY=from-env-file\nGITHUB_PASSWORD="p w#1"\nLAB_MODEL=m1 # comment\nEMPTY=\nexport GH_TOKEN=\'tok\'\n');
fs.writeFileSync(path.join(T, '.env.local'), 'LAB_MODEL=m2\n');
const env = { ANTHROPIC_API_KEY: '' };
const set = S.loadDotenv(T, env);
check(env.ANTHROPIC_API_KEY === 'from-env-file' && env.LAB_MODEL === 'm2' && env.GH_TOKEN === 'tok' && !('GITHUB_PASSWORD' in env) && !('EMPTY' in env) && !set.includes('GITHUB_PASSWORD'), '.env / .env.local: settings loaded (.env.local wins), passwords not put into the environment', JSON.stringify(env));
check(S.readSecret(T, 'GITHUB_PASSWORD', {}) === 'p w#1' && S.readSecret(T, 'GITHUB_PASSWORD', { GITHUB_PASSWORD: 'ci' }) === 'ci', 'readSecret: the environment (CI) first, then the files', S.readSecret(T, 'GITHUB_PASSWORD', {}));
S.saveLocal(T, { GOOGLE_EMAIL: 'a@b.c', LAB_MODEL: null });
const loc = fs.readFileSync(path.join(T, '.env.local'), 'utf8');
check(/GOOGLE_EMAIL="a@b\.c"/.test(loc) && !/LAB_MODEL/.test(loc) && (process.platform === 'win32' || (fs.statSync(path.join(T, '.env.local')).mode & 0o777) === 0o600), 'saveLocal: adds, removes, 0600', loc);
// RFC 6238 test vectors (SHA-1, 8 digits): secret "12345678901234567890"
const sec = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
check(S.totp(sec, 59000, 30, 8) === '94287082' && S.totp(sec, 1111111109000, 30, 8) === '07081804' && S.totp(sec, 20000000000000, 30, 8) === '65353130', 'TOTP: RFC 6238 vectors');
// lab.mjs loads them for every command (a child sees the key, not the password)
const top2 = path.join(T, 'lab'); fs.mkdirSync(path.join(top2, 'common'), { recursive: true });
for (const f of ['lab.mjs']) fs.copyFileSync(path.join(TOP, f), path.join(top2, f));
for (const f of ['secrets.mjs', 'notify.mjs']) fs.copyFileSync(path.join(TOP, 'common', f), path.join(top2, 'common', f));
fs.writeFileSync(path.join(top2, '.env'), 'LAB_NOTIFY_WEBHOOK=http://127.0.0.1:9/x\nGITHUB_PASSWORD=zzz\n');
const nr = spawnSync(process.execPath, [path.join(top2, 'lab.mjs'), 'notify', 'hi'], { cwd: top2, encoding: 'utf8', env: { ...process.env, LAB_NOTIFY_WEBHOOK: '', LAB_DOTENV: undefined } });   // (.env on, even under a runner that turns it off)
check(/W notify|FAIL 送れませんでした/.test(nr.stdout + nr.stderr), 'lab.mjs: .env reaches the commands (notify tried the webhook from .env)', nr.stdout + nr.stderr);

// 2. notify: Discord / Slack / generic bodies
const got = [];
const hook = http.createServer((q, s) => { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { got.push({ url: q.url, b, h: q.headers }); s.end('ok'); }); });
await new Promise((r) => hook.listen(0, '127.0.0.1', r));
const N = await import(pathToFileURL(path.join(TOP, 'common', 'notify.mjs')).href);
const hu = `http://127.0.0.1:${hook.address().port}`;
await N.notify('maintain: FIXED 1', ['bds/a: FIXED'], { url: hu + '/generic' });
await N.notify('x', [], { url: hu + '/ntfy.sh/topic'.replace('ntfy.sh', 'ntfy.local') });
check(got.length === 2 && JSON.parse(got[0].b).title === 'maintain: FIXED 1' && /✅ maintain/.test(JSON.parse(got[0].b).text), 'notify: a JSON POST with the title and lines', JSON.stringify(got));
hook.close();

// 3. the browser part
const exe = process.env.LAB_BROWSER || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((f) => fs.existsSync(f));
let pwOk = false;
try { const { loadPlaywright } = await import(pathToFileURL(path.join(TOP, 'app', 'lib', 'playwright-login.mjs')).href); loadPlaywright(path.join(TOP, 'app', '.lab', 'browser')); pwOk = Boolean(exe) || true; } catch (e) { console.log(`- browser tests skipped (${e.message})`); }
if (pwOk) {
  // a fake GitHub: login → TOTP → device code (8 boxes) → Authorize; the fake gh waits for that
  const state = { user: null, totp: null, code: null, authorized: false };
  const page = (body, cookie) => [200, { 'content-type': 'text/html; charset=utf-8', ...(cookie ? { 'set-cookie': cookie } : {}) }, `<!doctype html><html><body>${body}</body></html>`];
  const gh = http.createServer((q, s) => {
    let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => {
      const f = Object.fromEntries(new URLSearchParams(b)), ck = q.headers.cookie ?? '', u = new URL(q.url, 'http://x');
      let r;
      if (u.pathname === '/login/device' && q.method === 'GET') r = /logged=1/.test(ck) ? page(`<form method=post action="/login/device">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<input id="user-code-${i}" name="user-code-${i}" maxlength=1 oninput="if(this.value)document.getElementById('user-code-${i + 1}')?.focus()">`).join('')}<input type=submit name=commit value=Continue></form>`) : [302, { location: '/login?return_to=/login/device' }, ''];
      else if (u.pathname === '/login') r = page('<form method=post action="/session"><input id=login_field name=login><input id=password type=password name=password><input type=submit name=commit value="Sign in"></form>');
      else if (u.pathname === '/session') { state.user = `${f.login}:${f.password}`; r = [302, { location: '/sessions/two-factor/app', 'set-cookie': 'step=2; Path=/' }, '']; }
      else if (u.pathname === '/sessions/two-factor/app' && q.method === 'GET') r = page('<form method=post action="/sessions/two-factor"><input id=app_totp name=app_otp autocomplete=one-time-code></form>');
      else if (u.pathname === '/sessions/two-factor') { state.totp = f.app_otp; r = [302, { location: '/login/device', 'set-cookie': 'logged=1; Path=/' }, '']; }
      else if (u.pathname === '/login/device' && q.method === 'POST') { state.code = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => f[`user-code-${i}`] ?? '').join(''); r = page('<form method=post action="/authorize"><p>Authorize GitHub CLI</p><button type=submit name=authorize value="1">Authorize github</button></form>'); }
      else if (u.pathname === '/authorize') { state.authorized = f.authorize === '1'; fs.writeFileSync(path.join(T, 'authed'), '1'); r = page('<p>Congratulations, you are all set!</p>'); }
      else r = [404, {}, 'no'];
      s.writeHead(r[0], r[1]); s.end(r[2]);
    });
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  const bin = path.join(T, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
const fs = require('fs'), a = process.argv.slice(2), A = ${JSON.stringify(path.join(T, 'authed'))};
if (a[0] === '--version') { console.log('gh version 9.9.9'); process.exit(0); }
if (a[0] === 'auth' && a[1] === 'status') process.exit(fs.existsSync(A) ? 0 : 1);
if (a[0] === 'auth' && a[1] === 'setup-git') process.exit(0);
if (a[0] === 'api') { console.log('tester'); process.exit(0); }
if (a[0] === 'auth' && a[1] === 'login' && a.includes('--with-token')) { let t = ''; process.stdin.on('data', (d) => { t += d; }); process.stdin.on('end', () => { if (t.trim() === 'good') { fs.writeFileSync(A, '1'); process.exit(0); } console.error('error validating token'); process.exit(1); }); }
else if (a[0] === 'auth' && a[1] === 'login') { console.error('! First copy your one-time code: WXYZ-1234'); console.error('Open this URL to continue in your web browser: https://github.com/login/device'); const t = setInterval(() => { if (fs.existsSync(A)) { clearInterval(t); console.error('✓ Logged in as tester'); process.exit(0); } }, 200); setTimeout(() => process.exit(1), 60000); }
else process.exit(2);
`, { mode: 0o755 });
  const envL = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, LAB_DOTENV: 'off', DISPLAY: '', WAYLAND_DISPLAY: '', LAB_BROWSER: exe ?? '', LAB_GITHUB_DEVICE_URL: `http://127.0.0.1:${gh.address().port}/login/device`, LAB_LOGIN_TIMEOUT_MS: '25000', LAB_LOGIN_DEBUG: process.env.LAB_LOGIN_DEBUG ?? '',
    GITHUB_USER: 'tester', GITHUB_PASSWORD: 'secret-pw', GITHUB_TOTP_SECRET: sec, GH_TOKEN: '', GITHUB_TOKEN: '', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' };
  const run = (args, e = {}) => new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, env: { ...envL, ...e } }); let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; }); c.on('close', (code) => res({ code, t })); });
  const t0 = Date.now();
  let r = await run(['login', 'github']);
  const want = S.totp(sec, t0), want2 = S.totp(sec, Date.now());
  check(r.code === 0 && /OK GitHub: tester/.test(r.t), 'login github: gh device login finishes by itself (hidden browser)', r.t);
  check(state.user === 'tester:secret-pw', 'the address and password from .env were typed into the sign-in page', JSON.stringify(state));
  check([want, want2].includes(state.totp), 'the 2FA code came from GITHUB_TOTP_SECRET', JSON.stringify(state) + ' want ' + want);
  check(state.code === 'WXYZ1234' && state.authorized, "gh's one-time code typed into the 8 boxes, Authorize pressed", JSON.stringify(state));
  check(!/secret-pw/.test(r.t), 'the password never shows in the output', r.t);
  r = await run(['login', 'github']);
  check(r.code === 0 && /済み/.test(r.t), 'already signed in: nothing opens', r.t);
  fs.rmSync(path.join(T, 'authed'), { force: true });
  r = await run(['login', 'github'], { GH_TOKEN: 'good' });
  check(r.code === 0 && /OK GitHub: tester（GH_TOKEN）/.test(r.t), 'GH_TOKEN in .env: signed in without a browser', r.t);
  gh.close();

  const { playwrightOauthToken } = await import(pathToFileURL(path.join(TOP, 'app', 'lib', 'playwright-login.mjs')).href);
  // a fake Google EmbeddedSetup (the token cookie is taken from google.com only, so the page flow itself is checked):
  // address → Next, password → Next, "I agree"
  const gg2 = []; // (visited paths)
  const g3 = http.createServer((q, s) => { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { gg2.push(q.url + ' ' + b); s.writeHead(200, { 'content-type': 'text/html' }); const u = q.url; s.end(u.startsWith('/EmbeddedSetup') ? '<form method=post action="/pw"><input type=email name=identifier><div id=identifierNext><button type=submit>Next</button></div></form>' : u === '/pw' ? '<form method=post action="/agree"><input type=password name=Passwd><div id=passwordNext><button type=submit>Next</button></div></form>' : u === '/agree' ? '<form method=post action="/done"><button id=signinconsentNext type=submit>I agree</button></form>' : '<p>done</p>'); }); });
  await new Promise((r) => g3.listen(0, '127.0.0.1', r));
  try { await playwrightOauthToken({ cacheDir: path.join(TOP, 'app', '.lab', 'browser'), url: `http://127.0.0.1:${g3.address().port}/EmbeddedSetup`, email: 'me@example.com', password: 'g-pw', headless: true, executablePath: exe, timeoutMs: 8000 }); } catch { /* times out: no google.com cookie */ }
  g3.close();
  check(gg2.some((x) => x.startsWith('/pw identifier=me%40example.com')) && gg2.some((x) => x.startsWith('/agree Passwd=g-pw')) && gg2.some((x) => x.startsWith('/done')), 'google: address → Next, password → Next, "I agree" pressed', gg2.join('\n'));
}
// a prompt after Ctrl-C left the process without its terminal (setRawMode EIO): a clean stop, not "a lab bug" with a stack
{
  const code = `process.stdin.isTTY = true; process.stdin.setRawMode = () => { const e = new Error('setRawMode EIO'); e.code = 'EIO'; throw e; };
    const S = await import(${JSON.stringify(pathToFileURL(path.join(TOP, 'common', 'secrets.mjs')).href)}); await S.ask('q: '); console.log('not reached');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, LAB_ASK_FILE: '' } });
  check(r.status === 130 && /中断しました/.test(r.stderr) && !/not reached|at ReadStream/.test(r.stdout + r.stderr), 'ask: a lost terminal (EIO) stops cleanly with exit 130', r.stdout + r.stderr);
}
fs.rmSync(T, { recursive: true, force: true });
console.log(`${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
