// node lab.mjs login [github|google|microsoft <name>|ai|status]: every sign-in the lab needs, from one place.
// Where the account comes from, in order: the environment (CI secrets) → .env.local → .env → asked here in the terminal
// (hidden; Enter = type it in the browser instead). Then a real browser opens on the service's own page and the lab fills
// in what it knows (address, password, the 2FA code from *_TOTP_SECRET, the device code) and presses the buttons; whatever
// it cannot fill (a passkey, a CAPTCHA, a phone prompt) the person does in that same window. No screen (a server over SSH,
// CI): the browser runs hidden and the lab asks for the codes here instead.
//   github     gh's own device login (the token is kept by gh, as `gh auth login` would); GH_TOKEN in .env skips the browser;
//              no gh on this machine: a portable one is fetched into .lab-tools/bin once
//   google     the app lab's AAS token (node lab.mjs app token), with the address and password filled in
//   microsoft  an Xbox account for `lan` (node lab.mjs lan account add <name>), with the code, address and password filled in
//   ai         ANTHROPIC_API_KEY / OPENAI_API_KEY (+ OPENAI_BASE_URL) for `make`, checked against the API, saved in .env.local
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readSecret, saveLocal, ask, yes, canAsk, totp } from './secrets.mjs';

export const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WIN = process.platform === 'win32';
const TOOLS = path.join(TOP, '.lab-tools');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c, a, o = {}) => spawnSync(c, a, { encoding: 'utf8', timeout: 20000, ...o });
export const hasDisplay = () => process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

// ---- the browser: Playwright (installed once with the app lab's copy), no automation banner (sign-in pages refuse those) ----
export async function openBrowser({ headless = !hasDisplay(), log = () => {} } = {}) {
  const { loadPlaywright } = await import(pathToFileURL(path.join(TOP, 'app', 'lib', 'playwright-login.mjs')).href);
  const cache = path.join(TOP, 'app', '.lab', 'browser');
  const { pw, dir } = loadPlaywright(cache, { log });
  fs.mkdirSync(cache, { recursive: true });
  const profile = fs.mkdtempSync(path.join(cache, 'login-'));
  const exe = process.env.LAB_BROWSER || process.env.APP_BROWSER;
  const base = { headless, viewport: headless ? { width: 1100, height: 900 } : null, ignoreDefaultArgs: ['--enable-automation'], locale: process.env.LAB_BROWSER_LOCALE || undefined,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])] };
  let ctx = null, last = null;
  for (const t of exe ? [{ executablePath: exe }] : [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try { ctx = await pw.chromium.launchPersistentContext(profile, { ...base, ...t }); break; } catch (e) { last = e; }
  }
  if (!ctx && /Executable doesn't exist|install/i.test(String(last?.message))) {
    log('  Chrome / Edge が無いので Chromium を取得します（初回だけ）…');
    sh(process.execPath, [path.join(dir, 'node_modules', 'playwright-core', 'cli.js'), 'install', 'chromium'], { timeout: 15 * 60_000 });
    ctx = await pw.chromium.launchPersistentContext(profile, base).catch((e) => { last = e; return null; });
  }
  if (!ctx) throw new Error(`ブラウザを起動できません: ${String(last?.message ?? '').split('\n')[0]}（Chrome を入れるか LAB_BROWSER=<場所>）`);
  let closed = false; ctx.on('close', () => { closed = true; });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  return {
    ctx, page, headless, get closed() { return closed; },
    async close() { if (!closed) await ctx.close().catch(() => {}); for (let k = 0; k < 20 && fs.existsSync(profile); k++) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { await sleep(300); } } },
  };
}
/** the first visible element for any of the selectors, or null */
export async function seen(page, sels) {
  for (const s of [].concat(sels)) {
    const l = page.locator(s).first();
    if (await l.isVisible().catch(() => false)) return l;
  }
  return null;
}
const filled = async (l) => ((await l.inputValue().catch(() => '')) || '').length > 0;
/**
 * One pass over every open page: each rule whose field is visible and still empty is filled (value from its getter, which may
 * ask in the terminal when headless) and submitted. A rule acts at most `tries` times per page address (a wrong password is
 * not typed again and again). Returns the names of the rules that acted.
 */
export async function autofill(ctx, rules, memo = new Map()) {
  const acted = [];
  for (const page of ctx.pages()) {
    const url = page.url().split('?')[0];
    for (const r of rules) {
      if (r.url && !r.url.test(page.url())) continue;
      const key = `${r.name} ${url}`;
      if ((memo.get(key) ?? 0) >= (r.tries ?? 1)) continue;
      const el = await seen(page, r.sel);
      if (!el || (r.value && await filled(el))) continue;
      if (r.value) {
        const v = await r.value();
        if (!v) continue;
        memo.set(key, (memo.get(key) ?? 0) + 1);
        await el.click().catch(() => {});
        if (r.type) { await page.keyboard.type(v, { delay: 30 }); } else await el.fill(v).catch(() => {});
        if (r.submit !== false) {
          const b = r.submit ? await seen(page, r.submit) : null;
          await (b ? b.click().catch(() => {}) : el.press('Enter').catch(() => {}));
        }
      } else { memo.set(key, (memo.get(key) ?? 0) + 1); await el.click().catch(() => {}); }
      acted.push(r.name);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
  }
  return acted;
}

// ---- gh: the one on PATH, else a portable copy in .lab-tools/bin (added to PATH by lab.mjs) ----
const ghOk = () => sh('gh', ['--version']).status === 0;
export async function ensureGh(out = console.log) {
  if (ghOk()) return 'gh';
  const bin = path.join(TOOLS, 'bin'), exe = path.join(bin, WIN ? 'gh.exe' : 'gh');
  if (fs.existsSync(exe)) { process.env.PATH = bin + path.delimiter + process.env.PATH; return exe; }
  const plat = { linux: 'linux', darwin: 'macOS', win32: 'windows' }[process.platform], arch = { x64: 'amd64', arm64: 'arm64', ia32: '386' }[process.arch];
  if (!plat || !arch) throw new Error(`gh (GitHub CLI) を自動で入れられない環境です（${process.platform}-${process.arch}）: https://cli.github.com から入れてください`);
  out('  GitHub CLI (gh) が無いので .lab-tools/ に取得します（初回だけ）…');
  const hdr = { 'user-agent': 'bds-lab', ...(process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}` } : {}) };
  let tag = null;
  try { tag = (await (await fetch('https://api.github.com/repos/cli/cli/releases/latest', { headers: hdr, signal: AbortSignal.timeout(20000) })).json()).tag_name; } catch { /* API blocked or rate-limited */ }
  if (!tag) try { tag = /\/tag\/(v[\d.]+)/.exec((await fetch('https://github.com/cli/cli/releases/latest', { redirect: 'manual', signal: AbortSignal.timeout(20000) })).headers.get('location') ?? '')?.[1]; } catch { /* blocked */ }
  if (!tag) throw new Error('gh の最新版が分かりません（GitHub に届かない？）: https://cli.github.com から入れてください');
  const v = tag.replace(/^v/, ''), ext = plat === 'linux' ? 'tar.gz' : 'zip', file = `gh_${v}_${plat}_${arch}.${ext}`;
  const mirror = (process.env.LAB_GITHUB_MIRROR || '').replace(/\/$/, '');
  const url = `${mirror ? mirror + '/' : ''}https://github.com/cli/cli/releases/download/${tag}/${file}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!r.ok) throw new Error(`gh を取得できません（HTTP ${r.status} ${url}）`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-gh-')), arc = path.join(tmp, file);
  fs.writeFileSync(arc, Buffer.from(await r.arrayBuffer()));
  const x = ext === 'zip' ? (WIN ? sh('tar', ['-xf', arc, '-C', tmp]) : sh('unzip', ['-q', arc, '-d', tmp])) : sh('tar', ['-xzf', arc, '-C', tmp]);
  const found = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const f = found(p); if (f) return f; } else if (e.name === (WIN ? 'gh.exe' : 'gh') && path.basename(d) === 'bin') return p; } return null; };
  const got = x.status === 0 ? found(tmp) : null;
  if (!got) throw new Error(`gh を展開できません（${(x.stderr || '').trim().slice(0, 160)}）`);
  fs.mkdirSync(bin, { recursive: true }); fs.copyFileSync(got, exe); if (!WIN) fs.chmodSync(exe, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.env.PATH = bin + path.delimiter + process.env.PATH;
  out(`  OK gh ${v} → .lab-tools/bin/`);
  return exe;
}
export const ghUser = () => { const r = sh('gh', ['api', 'user', '--jq', '.login']); return r.status === 0 ? r.stdout.trim() : null; };

// what the person has not written down yet: asked here (Enter = type it in the browser), offered to be saved once
async function creds(keys, labels, out) {
  const got = {}, fresh = {};
  for (const k of keys) got[k] = readSecret(TOP, k);
  if (!canAsk()) return got;
  for (const k of keys) {
    if (got[k] || !labels[k]) continue;
    const secret = /PASSWORD|SECRET/.test(k);
    got[k] = fresh[k] = await ask(`${labels[k]}${secret ? '（入力は表示されません）' : ''}: `, { secret });
  }
  const toSave = Object.fromEntries(Object.entries(fresh).filter(([, v]) => v));
  if (Object.keys(toSave).length && await yes(`次から聞かないように .env.local（このPCだけ・git や zip には入らない）に保存しますか？`, false)) { saveLocal(TOP, toSave); out('  保存しました: ' + Object.keys(toSave).join(' ')); }
  return got;
}

// ---- GitHub ----
export async function loginGithub({ headless, force = false, out = console.log } = {}) {
  await ensureGh(out);
  const token = readSecret(TOP, 'GH_TOKEN') || readSecret(TOP, 'GITHUB_TOKEN');
  if (!force && sh('gh', ['auth', 'status']).status === 0) { out(`OK GitHub: ${ghUser() ?? '(signed in)'}（済み。やり直すなら login github --force）`); return true; }
  if (token) {   // a token in .env: no browser at all
    const env = { ...process.env }; delete env.GH_TOKEN; delete env.GITHUB_TOKEN;   // (gh refuses to store while one is in its environment)
    const r = sh('gh', ['auth', 'login', '--with-token', '--hostname', 'github.com'], { input: token + '\n', env });
    if (r.status !== 0) { out(`E GH_TOKEN が使えません: ${(r.stderr || r.stdout).trim().split('\n').pop()}`); return false; }
    sh('gh', ['auth', 'setup-git'], { env });
    out(`OK GitHub: ${ghUser() ?? '?'}（GH_TOKEN）`); return true;
  }
  const c = await creds(['GITHUB_USER', 'GITHUB_PASSWORD'], { GITHUB_USER: 'GitHub のユーザー名かメールアドレス（Enter でブラウザで入力）', GITHUB_PASSWORD: 'GitHub のパスワード（Enter でブラウザで入力）' }, out);
  const user = c.GITHUB_USER || readSecret(TOP, 'GITHUB_EMAIL'), pass = c.GITHUB_PASSWORD, otpSecret = readSecret(TOP, 'GITHUB_TOTP_SECRET');
  // gh's device login: it prints a one-time code and waits for GitHub to say yes (not interactive: nothing to press)
  const env = { ...process.env, GH_BROWSER: WIN ? 'cmd /c rem' : 'true', BROWSER: WIN ? 'cmd /c rem' : 'true', GH_PROMPT_DISABLED: '1' }; delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
  const g = spawn('gh', ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--scopes', 'repo,workflow,read:org'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '', exit = null;
  g.stdout.on('data', (d) => { text += d; }); g.stderr.on('data', (d) => { text += d; });
  g.on('close', (code) => { exit = code ?? 1; });
  let code = null;
  for (let k = 0; k < 150 && !code && exit === null; k++) { code = /code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(text)?.[1]; if (!code) await sleep(200); }
  if (!code) { g.kill(); out(`E gh がコードを出しませんでした: ${text.trim().split('\n').slice(-2).join(' / ')}`); return false; }
  try { g.stdin.write('\n'); } catch { /* not waiting */ }
  const url = process.env.LAB_GITHUB_DEVICE_URL || 'https://github.com/login/device';
  out(`  GitHub のコード: ${code}（ブラウザに自動で入れます。止まったら ${url} でこのコードを入れてください）`);
  let b = null;
  try { b = await openBrowser({ headless, log: out }); }
  catch (e) { out(`W ${e.message}`); out(`  手で: ${url} を開いてコード ${code} を入れ、「Authorize」を押してください（待っています）`); }
  const ask2 = (label) => async () => (b?.headless && canAsk() ? ask(label) : '');
  const rules = [
    { name: 'user', sel: ['#login_field', 'input[name=login]'], value: async () => user, submit: false },
    { name: 'password', sel: ['#password', 'input[name=password]'], value: async () => pass || (b.headless && canAsk() ? ask('GitHub のパスワード（入力は表示されません）: ', { secret: true }) : ''), submit: ['input[type=submit][name=commit]', 'button[type=submit]'] },
    { name: 'use-app', url: /two-factor\/(webauthn|mobile)|two-factor$/, sel: ['a[href*="two-factor/app"]'], tries: 1 },
    { name: '2fa', sel: ['#app_totp', 'input[name=app_otp]', 'input[autocomplete=one-time-code][name=otp]'], value: async () => (otpSecret ? totp(otpSecret) : await ask2('GitHub の2段階認証コード（認証アプリの6桁）: ')()), tries: 2 },
    { name: 'device-verify', sel: ['#otp', 'input[name=otp]'], value: ask2('GitHub からメールで届いた確認コード: '), tries: 2 },
    { name: 'code', sel: ['#user-code-0', 'input[name="user-code-0"]'], value: async () => code.replace('-', ''), type: true, submit: ['input[type=submit][name=commit]', 'button[type=submit][name=commit]', 'button:has-text("Continue")'] },
    { name: 'authorize', sel: ['button[name=authorize][value="1"]', '#js-oauth-authorize-btn', 'button:has-text("Authorize")'] },
  ];
  const memo = new Map(), end = Date.now() + Number(process.env.LAB_LOGIN_TIMEOUT_MS || 10 * 60_000);
  try {
    if (b) { await b.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}); if (!b.headless) out('  ブラウザを開きました。自動で入らないところ（パスキー・CAPTCHA など）はその窓で進めてください。'); }
    while (exit === null && Date.now() < end) {
      if (b && !b.closed) { const a = await autofill(b.ctx, rules, memo).catch((e) => { if (process.env.LAB_LOGIN_DEBUG) out('  autofill: ' + e.message); return []; }); if (process.env.LAB_LOGIN_DEBUG) out(`  [${b.ctx.pages().map((p) => p.url()).join(' ')}] ${a.join(' ')}`); }
      await sleep(700);
    }
  } finally { if (b) await b.close(); if (exit === null) g.kill(); }
  if (exit !== 0) { out(`E GitHub にログインできませんでした: ${text.trim().split('\n').slice(-2).join(' / ') || '時間切れ'}`); return false; }
  sh('gh', ['auth', 'setup-git']);
  out(`OK GitHub: ${ghUser() ?? '(signed in)'}`);
  return true;
}

// ---- Microsoft (Xbox) device code: used by lan.mjs `lan account add` ----
export async function autoMicrosoft({ uri, code, headless, out = console.log }) {
  const c = await creds(['MS_EMAIL', 'MS_PASSWORD'], {}, out);   // (the terminal already shows the code; only what is written down is filled)
  let b;
  try { b = await openBrowser({ headless: headless ?? !hasDisplay(), log: out }); } catch (e) { out(`W ${e.message}`); return null; }
  const rules = [
    { name: 'code', sel: ['input[name=otc]', '#otc', 'input[name=code]'], value: async () => code },
    { name: 'email', sel: ['input[type=email]', 'input[name=loginfmt]'], value: async () => c.MS_EMAIL },
    { name: 'password', sel: ['input[type=password]', 'input[name=passwd]'], value: async () => c.MS_PASSWORD || (b.headless && canAsk() ? ask('Microsoft のパスワード（入力は表示されません）: ', { secret: true }) : '') },
    { name: 'stay', sel: ['#acceptButton', 'button:has-text("Yes")', 'button:has-text("はい")', '#idSIButton9:has-text("Yes")'] },
    { name: 'allow', url: /consent|oauth20_authorize/, sel: ['#idBtn_Accept', 'button:has-text("Accept")', 'button:has-text("許可")'] },
  ];
  await b.page.goto(uri, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const memo = new Map();
  let stop = false;
  (async () => { while (!stop && !b.closed) { await autofill(b.ctx, rules, memo).catch(() => {}); await sleep(700); } })();
  return { async close() { stop = true; await b.close(); } };
}

// ---- AI keys ----
async function checkKey(kind, key, base) {
  try {
    const r = kind === 'anthropic'
      ? await fetch(`${(base || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) })
      : await fetch(`${(base || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    return r.ok ? 'ok' : r.status === 401 || r.status === 403 ? 'bad' : `HTTP ${r.status}`;
  } catch (e) { return `unreachable (${e.cause?.code ?? e.message})`; }
}
export async function loginAi({ out = console.log } = {}) {
  const a = readSecret(TOP, 'ANTHROPIC_API_KEY'), o = readSecret(TOP, 'OPENAI_API_KEY'), ob = readSecret(TOP, 'OPENAI_BASE_URL');
  if (a || o || ob) {
    const kind = a ? 'anthropic' : 'openai', r = await checkKey(kind, a || o, kind === 'anthropic' ? process.env.ANTHROPIC_BASE_URL : ob);
    out(`${r === 'ok' ? 'OK' : r === 'bad' ? 'E' : 'W'} AI: ${kind}${r === 'ok' ? '' : ` (${r === 'bad' ? '鍵が違います' : r})`}`);
    if (r !== 'bad') return true;
  }
  const cli = ['claude', 'codex', 'gemini'].find((x) => sh(WIN ? 'where' : 'which', [x]).status === 0);
  if (!canAsk()) { out(cli ? `OK AI: ${cli} CLI` : 'MISSING AI: .env に ANTHROPIC_API_KEY=... （または OPENAI_API_KEY）を書くか、claude / codex / gemini CLI を入れてください'); return Boolean(cli); }
  if (cli && !(await yes(`${cli} CLI があります。API の鍵も登録しますか（make のトークンが一番少ないのは API の鍵）？`, false))) { out(`OK AI: ${cli} CLI`); return true; }
  const which = (await ask('どの AI の鍵？ 1) Anthropic (Claude)  2) OpenAI 互換（ローカル LLM 含む） [1]: ', { fallback: '1' })).startsWith('2') ? 'openai' : 'anthropic';
  const up = {};
  if (which === 'openai') { const base = await ask('OPENAI_BASE_URL（Enter で OpenAI 本家）: '); if (base) up.OPENAI_BASE_URL = base; up.OPENAI_MODEL = await ask('モデル名（例 gpt-5.1）: '); }
  const key = await ask(`${which === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}（入力は表示されません）: `, { secret: true });
  if (!key && !up.OPENAI_BASE_URL) { out('  やめました'); return false; }
  const r = await checkKey(which, key || 'none', which === 'anthropic' ? process.env.ANTHROPIC_BASE_URL : up.OPENAI_BASE_URL);
  if (r === 'bad') { out('E その鍵は使えません（401/403）。保存しません'); return false; }
  up[which === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] = key;
  saveLocal(TOP, Object.fromEntries(Object.entries(up).filter(([, v]) => v)));
  out(`OK AI: ${which}${r === 'ok' ? '' : ` (確認できませんでした: ${r})`} → .env.local`);
  return true;
}

// ---- status ----
export function status() {
  const rows = [];
  const gh = ghOk() || fs.existsSync(path.join(TOOLS, 'bin', WIN ? 'gh.exe' : 'gh'));
  const ghIn = gh && sh('gh', ['auth', 'status']).status === 0;
  rows.push(['github', ghIn ? 'OK' : 'MISSING', ghIn ? ghUser() ?? 'signed in' : readSecret(TOP, 'GH_TOKEN') ? 'GH_TOKEN あり（login github で gh に登録）' : 'node lab.mjs login github'], );
  const ge = readSecret(TOP, 'GOOGLE_EMAIL'), ga = readSecret(TOP, 'GOOGLE_AAS_TOKEN');
  rows.push(['google', ga ? 'OK' : '-', ga ? `${ge}（AAS …${ga.slice(-4)}）` : `app ラボだけで使用: node lab.mjs login google${ge ? `（${ge}）` : ''}`]);
  let ms = []; try { ms = fs.readdirSync(path.join(TOP, 'bds', '.lab', 'nc', 'auth')).filter((f) => !f.startsWith('.')); } catch { /* none */ }
  rows.push(['microsoft', ms.length ? 'OK' : '-', ms.length ? `${ms.length} 件（lan account list）` : 'lan でだけ使用: node lab.mjs login microsoft <名前>']);
  const ai = readSecret(TOP, 'ANTHROPIC_API_KEY') ? 'anthropic' : readSecret(TOP, 'OPENAI_API_KEY') || readSecret(TOP, 'OPENAI_BASE_URL') ? 'openai' : ['claude', 'codex', 'gemini'].find((x) => sh(WIN ? 'where' : 'which', [x]).status === 0);
  rows.push(['ai', ai ? 'OK' : 'MISSING', ai ?? 'node lab.mjs login ai（make・maintain に要る）']);
  const hook = readSecret(TOP, 'LAB_NOTIFY_WEBHOOK');
  rows.push(['notify', hook ? 'OK' : '-', hook ? hook.replace(/^(https?:\/\/[^/]+).*/, '$1/…') : '任意: .env に LAB_NOTIFY_WEBHOOK=<Discord/Slack の Webhook URL>']);
  return rows;
}

export async function loginCmd(args, out = console.log) {
  const [what = '', ...rest] = args, headless = rest.includes('--headless') ? true : rest.includes('--window') ? false : undefined, force = rest.includes('--force');
  if (what === 'status' || what === '') {
    const rows = status();
    for (const [k, s, d] of rows) out(`${s.padEnd(8)}${k.padEnd(10)}${d}`);
    if (what === 'status' || !canAsk()) return rows.every(([, s]) => s !== 'MISSING');
    for (const [k, s] of rows) {
      if (s !== 'MISSING') continue;
      if (!(await yes(`${k} を今設定しますか？`))) continue;
      if (k === 'github') await loginGithub({ headless, out }); else if (k === 'ai') await loginAi({ out });
    }
    return true;
  }
  if (what === 'github') return loginGithub({ headless, force, out });
  if (what === 'ai') return loginAi({ out });
  if (what === 'google') {
    const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'token', ...(headless ? ['--headless'] : [])], { stdio: 'inherit', cwd: TOP });
    return r.status === 0;
  }
  if (what === 'microsoft') {
    const name = rest.find((x) => !x.startsWith('--')) ?? 'bot';
    const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'lan', 'account', 'add', name], { stdio: 'inherit', cwd: TOP });
    return r.status === 0;
  }
  out('usage: node lab.mjs login [status|github|google|microsoft <name>|ai] [--headless|--window] [--force]');
  return false;
}
