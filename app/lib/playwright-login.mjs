// The Google oauth_token the openAdapter way: Playwright drives a real, visible browser with a persistent (here: temporary)
// profile; the person signs in on Google's own page; the lab reads the cookie and the address typed, then closes it.
// Playwright (playwright-core, no bundled browsers) is installed once into app/.lab/browser/pw. Browser order: the installed
// Google Chrome → Microsoft Edge → Playwright's Chromium (downloaded once). No automation banner / navigator.webdriver:
// Google refuses sign-in in browsers that announce automation.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { AppError, cleanEnv } from './apk.mjs';
import { LOGIN_URL, pickOauthToken, canShowWindow } from './login.mjs';

export const PW_VERSION = '1.63.0';
const WIN = process.platform === 'win32';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** playwright-core from app/.lab/browser/pw (npm install once) */
export function loadPlaywright(cacheDir, { log = () => {} } = {}) {
  const dir = path.join(cacheDir, 'pw');
  const has = () => fs.existsSync(path.join(dir, 'node_modules', 'playwright-core', 'package.json'));
  if (!has()) {
    log('  Playwright を入れています（初回だけ、1 分ほど）…');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ private: true, dependencies: { 'playwright-core': PW_VERSION } }));
    const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', shell: WIN, env: cleanEnv() });
    if (r.status !== 0 || !has()) throw new AppError('Playwright を入れられませんでした', `ネットワークと npm を確認してください。（${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').pop()?.slice(0, 160) ?? ''}）`);
  }
  return { pw: createRequire(path.join(dir, 'package.json'))('playwright-core'), dir };
}

const LAUNCH = {
  headless: false, viewport: null,
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
};
async function launch(pw, profile, dir, { log, executablePath, headless = false }) {
  const tries = executablePath ? [{ executablePath }] : [{ channel: 'chrome' }, { channel: 'msedge' }, {}];
  let last = null;
  for (const t of tries) {
    try { return await pw.chromium.launchPersistentContext(profile, { ...LAUNCH, headless, ...(headless ? { viewport: { width: 1100, height: 900 } } : {}), ...t, env: cleanEnv() }); }
    catch (e) {
      last = e;
      if (!Object.keys(t).length && /Executable doesn't exist|install/i.test(e.message)) {
        // no Chrome, no Edge: Playwright's own Chromium, once
        log('  Chrome / Edge が無いので、Chromium を取得します（初回だけ、150 MB ほど）…');
        const r = spawnSync(process.execPath, [path.join(dir, 'node_modules', 'playwright-core', 'cli.js'), 'install', 'chromium'], { encoding: 'utf8', env: cleanEnv() });
        if (r.status !== 0) throw new AppError('Chromium を取得できませんでした', 'Google Chrome を入れてから、もう一度どうぞ。');
        return pw.chromium.launchPersistentContext(profile, { ...LAUNCH, headless, env: cleanEnv() });
      }
    }
  }
  throw new AppError('ブラウザを起動できませんでした', `Google Chrome を入れるか、APP_BROWSER=<場所> で指定してください。（${String(last?.message ?? '').split('\n')[0].slice(0, 160)}）`);
}

/**
 * Opens Google's page in a visible browser; returns { oauthToken, email } once Google sets the cookie.
 * onContext (tests): called with the browser context before the page opens.
 */
export async function playwrightOauthToken({ cacheDir, log = () => {}, timeoutMs = 15 * 60_000, url = LOGIN_URL, executablePath = process.env.APP_BROWSER || process.env.LAB_BROWSER, onContext, email: email0 = '', password = '', totpSecret = '', headless = false, askCode } = {}) {
  if (!headless && !canShowWindow()) throw new AppError('ここではブラウザの窓を出せません（画面の無い Linux）', 'デスクトップのあるコンピュータで node lab.mjs app token を実行し、できた .env.local をここの bds-lab 直下へコピーしてください。手で貼る方法: node lab.mjs app token --manual');
  const { pw, dir } = loadPlaywright(cacheDir, { log });
  fs.mkdirSync(cacheDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(cacheDir, 'login-'));
  let ctx = null, closed = false;
  try {
    log('  ブラウザを起動しています…');
    ctx = await launch(pw, profile, dir, { log, executablePath, headless });
    ctx.on('close', () => { closed = true; });
    await onContext?.(ctx);
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await page.bringToFront().catch(() => {});
    log(email0 && password ? '  ログインしています（自動）…' : `  ブラウザを開きました。${email0 ? 'パスワードを入れて' : 'ログインして'}ください。ボタン押しと受け取りは自動です（この画面はそのままで）。`);
    let typed = null;
    const t0 = Date.now(), end = t0 + timeoutMs;
    // what the person wrote down (.env / asked in the terminal) is typed into Google's own fields; the buttons after it
    // (the consent "I agree" / 同意する, and the "not now" of the interstitials Google puts in: passkeys, recovery info,
    // a new sign-in method) are pressed by the lab, whatever the page calls them, in either language
    const { autofill } = await import('../../common/auth.mjs'), { totp } = await import('../../common/secrets.mjs');
    const rules = [
      { name: 'email', sel: ['input[type=email]', '#identifierId'], value: async () => email0, submit: ['#identifierNext button', '#identifierNext'] },
      { name: 'password', sel: ['input[type=password][name=Passwd]', 'input[type=password]'], value: async () => password || (headless && askCode ? askCode('Google のパスワード（入力は表示されません）: ', true) : ''), submit: ['#passwordNext button', '#passwordNext'] },
      { name: '2fa', sel: ['input[name=totpPin]', 'input#totpPin', 'input[type=tel][name=Pin]', 'input[name=idvPin]'], value: async () => (totpSecret ? totp(totpSecret) : headless && askCode ? askCode('Google の確認コード: ') : ''), tries: 2 },
      { name: 'agree', sel: ['#signinconsentNext', 'button:has-text("I agree")', 'button:has-text("同意する")'] },
    ];
    const memo = new Map();
    let revisits = 0, lastUrl = '', still = t0, reported = 0;
    while (Date.now() < end) {
      if (closed) throw new AppError('ログインの前にブラウザが閉じられました', 'もう一度 node lab.mjs app token を実行し、終わるまで窓を開いたままにしてください。');
      await autofill(ctx, rules, memo).catch(() => {});
      for (const p of ctx.pages()) {
        // the address the person typed (for apkeep), and the buttons after sign-in, found by their text
        const st = await p.evaluate(({ AGREE, LATER }) => {
          const vis = (e) => e && e.offsetParent !== null && !e.disabled;
          const texts = [...document.querySelectorAll('button, [role=button], input[type=submit], a[role=link]')].filter(vis).map((e) => ({ e, t: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim() }));
          const hit = texts.find((x) => new RegExp(AGREE, 'i').test(x.t)) ?? texts.find((x) => new RegExp(LATER, 'i').test(x.t));
          if (hit && !hit.e.dataset.labClicked) { hit.e.dataset.labClicked = '1'; hit.e.click(); }
          return { email: document.querySelector('input[type=email]')?.value || '', title: document.title, buttons: texts.map((x) => x.t).filter(Boolean).slice(0, 8), clicked: hit?.t ?? null };
        }, { AGREE: '^(i agree|agree|accept|同意する|同意|承諾する|承諾)$', LATER: '^(not now|later|remind me later|skip|no thanks|今はしない|後で|あとで|スキップ|今はスキップ|利用しない)$' }).catch(() => ({}));
        if (EMAIL_RE.test(st.email ?? '')) typed = st.email.trim();
        if (st.clicked && process.env.APP_LOGIN_DEBUG) log(`  (押しました: ${st.clicked})`);
        p.__lab = st;
      }
      const cookies = await ctx.cookies().catch(() => []);
      const tok = pickOauthToken(cookies);
      if (tok) return { oauthToken: tok, email: email0 || typed };
      // no progress for a while: signed in but no token yet → open the setup page again (signed in, Google goes straight to
      // the consent or hands the token over); and say where it stands, with a picture, so a stall is never silent
      const cur = ctx.pages().at(-1), u = cur?.url() ?? '';
      if (u !== lastUrl) { lastUrl = u; still = Date.now(); }
      const signedIn = cookies.some((c) => /^(SID|__Secure-1PSID|__Secure-3PSID)$/.test(c.name));
      if (signedIn && Date.now() - still > 20_000 && revisits < 2) { revisits++; still = Date.now(); log('  ログイン済み: トークンの画面をもう一度開きます…'); await cur?.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {}); }
      else if (Date.now() - still > 45_000 && Date.now() - reported > 45_000) {
        reported = Date.now();
        const shot = path.join(cacheDir, `stall-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
        await cur?.screenshot({ path: shot }).catch(() => {});
        log(`  W 進みません。今の画面: 「${cur?.__lab?.title ?? '?'}」(${u ? new URL(u).host + new URL(u).pathname : '?'}) ボタン: ${(cur?.__lab?.buttons ?? []).map((x) => `[${x}]`).join(' ') || 'なし'}${signedIn ? '（ログインはできています）' : ''}`);
        log(`    画面の写真: ${shot}（中身を見て、足りない操作があればその窓で。送るときはアドレス以外が写っていないか確認）`);
      }
      await sleep(1000);
    }
    throw new AppError(`${Math.max(1, Math.round(timeoutMs / 60000))} 分待ちましたが、ログインが終わりませんでした`, 'もう一度 node lab.mjs app token を実行してください。');
  } finally {
    if (ctx && !closed) await ctx.close().catch(() => {});
    // the profile held a Google session: never left on disk
    for (let k = 0; k < 20 && fs.existsSync(profile); k++) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { await sleep(300); } }
  }
}
