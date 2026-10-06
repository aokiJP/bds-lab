// The one-time Google `oauth_token`, taken automatically (the idea of openAdapter: a real local browser drives the login,
// the tool reads the result from it). No npm package and no browser automation flags:
//   1. an installed Chromium-family browser (Chrome, Edge, Chromium, Brave; else Chrome for Testing, downloaded once) is
//      started as a normal window with a fresh, temporary profile and a DevTools port on 127.0.0.1 only
//   2. the person signs in on Google's own page and presses "I agree" (the password goes to Google only, never to the lab)
//   3. the lab reads the `oauth_token` cookie through the DevTools protocol (Storage.getCookies), closes the browser and
//      deletes the profile: nothing of the Google session stays on disk
// Works on macOS, Windows and Linux (Linux needs a desktop: DISPLAY or WAYLAND_DISPLAY). APP_BROWSER=<path> picks the browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { AppError, cleanEnv } from './apk.mjs';

export const LOGIN_URL = 'https://accounts.google.com/EmbeddedSetup';
// APP_TIME_SCALE (0..1, tests on the fake device): every fixed pause shorter; deadlines stay in real time
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (Math.min(1, Math.max(0, Number(process.env.APP_TIME_SCALE) || 1)))));

/** candidate browser executables for a platform, best first (pure: `exists` and `which` are injected for tests) */
export function browserCandidates({ platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync, which = whichCmd } = {}) {
  const out = [];
  const add = (p) => { if (p && !out.includes(p) && exists(p)) out.push(p); };
  if (env.APP_BROWSER) add(env.APP_BROWSER);
  if (platform === 'darwin') {
    for (const root of ['/Applications', path.join(home, 'Applications')]) {
      for (const [app, bin] of [['Google Chrome', 'Google Chrome'], ['Microsoft Edge', 'Microsoft Edge'], ['Chromium', 'Chromium'], ['Brave Browser', 'Brave Browser'], ['Google Chrome Canary', 'Google Chrome Canary']]) add(path.join(root, `${app}.app`, 'Contents', 'MacOS', bin));
    }
  } else if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) for (const rel of [['Google', 'Chrome', 'Application', 'chrome.exe'], ['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'], ['Chromium', 'Application', 'chrome.exe']]) add(path.win32.join(r, ...rel));
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']) add(which(n));
    add('/snap/bin/chromium');
  }
  return out;
}
function whichCmd(cmd) { const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null; }

/** can a window be shown here? (a Linux server over SSH cannot) */
export function canShowWindow({ platform = process.platform, env = process.env } = {}) {
  return platform !== 'linux' || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

// ---- Chrome for Testing: when no Chromium-family browser is installed (downloaded once into the lab cache) ----
const CFT_PLATFORM = { 'darwin-arm64': 'mac-arm64', 'darwin-x64': 'mac-x64', 'linux-x64': 'linux64', 'win32-x64': 'win64', 'win32-ia32': 'win32', 'win32-arm64': 'win64' };
export function cftExecutable(dir, plat) {
  return plat.startsWith('mac') ? path.join(dir, `chrome-${plat}`, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    : plat.startsWith('win') ? path.join(dir, `chrome-${plat}`, 'chrome.exe') : path.join(dir, `chrome-${plat}`, 'chrome');
}
export async function ensureChromeForTesting(cacheDir, { log = () => {} } = {}) {
  const plat = CFT_PLATFORM[`${process.platform}-${process.arch}`];
  if (!plat) throw new AppError('このコンピュータ用の Chrome が用意できません', 'Google Chrome か Microsoft Edge を入れてから、もう一度どうぞ（APP_BROWSER=<場所> でも指定できます）。');
  const dir = path.join(cacheDir, 'chrome-for-testing');
  const exe = cftExecutable(dir, plat);
  if (fs.existsSync(exe)) return exe;
  log('  ブラウザが見つからないので、Chrome for Testing を取得します（初回だけ、150 MB ほど）…');
  const j = await (await fetch('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json', { signal: AbortSignal.timeout(30000) })).json();
  const url = j.channels.Stable.downloads.chrome.find((d) => d.platform === plat)?.url;
  if (!url) throw new AppError('Chrome for Testing の配布先が分かりません', 'Google Chrome を入れてから、もう一度どうぞ。');
  const r = await fetch(url, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok) throw new AppError(`Chrome for Testing を取得できません（HTTP ${r.status}）`, 'Google Chrome を入れてから、もう一度どうぞ。');
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'chrome.zip');
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  // the system's own unzip keeps the app bundle's links (macOS) and file modes; Windows 10+ has bsdtar as tar.exe
  const x = process.platform === 'win32' ? spawnSync('tar', ['-xf', zip, '-C', dir], { encoding: 'utf8' }) : spawnSync('unzip', ['-q', '-o', zip, '-d', dir], { encoding: 'utf8' });
  fs.rmSync(zip, { force: true });
  if (x.status !== 0 || !fs.existsSync(exe)) throw new AppError('Chrome for Testing を展開できません', (x.stderr || x.error?.message || '').trim().slice(0, 200) || 'unzip / tar が要ります。');
  if (process.platform === 'darwin') spawnSync('xattr', ['-dr', 'com.apple.quarantine', path.join(dir, `chrome-${plat}`)]);   // (a downloaded app would ask first)
  return exe;
}

// ---- the DevTools protocol: just enough of it ----
export function readDevToolsPort(profile) {
  try { const [port, p] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/); return Number(port) > 0 ? { port: Number(port), path: p } : null; } catch { return null; }
}
// (the value may come percent-encoded: oauth2_4%2F…)
const dec = (v) => { try { return decodeURIComponent(v ?? ''); } catch { return String(v ?? ''); } };
export function pickOauthToken(cookies) {
  const c = (cookies ?? []).find((x) => x.name === 'oauth_token' && /(^|\.)google\.com$/.test(String(x.domain).replace(/^\./, '')) && /^oauth2_4\//.test(dec(x.value)));
  return c ? dec(c.value) : null;
}
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.wait = new Map(); }
  open() {
    return new Promise((res, rej) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => res(this);
      ws.onerror = () => rej(new Error('DevTools に接続できません'));
      ws.onclose = () => { for (const [, w] of this.wait) w.rej(new Error('closed')); this.wait.clear(); this.closed = true; };
      ws.onmessage = (m) => { let j; try { j = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString()); } catch { return; } const w = this.wait.get(j.id); if (w) { this.wait.delete(j.id); j.error ? w.rej(new Error(j.error.message)) : w.res(j.result); } };
    });
  }
  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('closed'));
    const id = ++this.id;
    return new Promise((res, rej) => { this.wait.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.wait.delete(id)) rej(new Error(`${method}: no answer`)); }, 10000); });
  }
  close() { try { this.ws.close(); } catch { /* gone */ } }
}

/**
 * Opens the login page in a real browser window and returns the oauth_token once Google sets it.
 * @returns {Promise<string>} oauth2_4/...
 */
export async function autoOauthToken({ cacheDir, log = () => {}, timeoutMs = 15 * 60_000, browser, url = LOGIN_URL } = {}) {
  if (!canShowWindow()) throw new AppError('ここではブラウザの窓を出せません（画面の無い Linux）', 'デスクトップのあるコンピュータで node lab.mjs app token を実行し、できた .env.local をここの bds-lab 直下へコピーしてください。手で貼る方法: node lab.mjs app token --manual');
  if (typeof WebSocket !== 'function') throw new AppError('この Node.js には WebSocket がありません', 'Node.js 22 以降にしてください。');
  const exe = browser ?? browserCandidates()[0] ?? await ensureChromeForTesting(cacheDir, { log });
  fs.mkdirSync(cacheDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(cacheDir, 'login-'));
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', '--disable-sync', '--new-window',
    ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),   // (Chrome refuses root without it: containers)
    url];
  log(`  ブラウザ: ${exe}`);
  const child = spawn(exe, args, { stdio: 'ignore', env: cleanEnv(), detached: process.platform !== 'win32' });
  let exited = false; child.on('exit', () => { exited = true; }); child.on('error', () => { exited = true; });
  let cdp = null;
  const end = Date.now() + timeoutMs;
  try {
    // the browser writes its DevTools port into the profile once it is up
    let dt = null;
    while (!dt && Date.now() < end && !exited) { dt = readDevToolsPort(profile); if (!dt) await sleep(250); }
    if (!dt) throw new AppError(exited ? 'ブラウザがすぐに終了しました' : 'ブラウザが起動しませんでした', `別のブラウザを APP_BROWSER=<場所> で指定するか、node lab.mjs app token --manual で手で貼ってください。（${exe}）`);
    cdp = await new Cdp(`ws://127.0.0.1:${dt.port}${dt.path}`).open();
    while (Date.now() < end) {
      if (exited || cdp.closed) throw new AppError('ログインの前にブラウザが閉じられました', 'もう一度 node lab.mjs app token を実行し、「同意する」を押すまで窓を開いたままにしてください。');
      let got = null;
      try { got = pickOauthToken((await cdp.send('Storage.getCookies')).cookies); } catch { /* the browser is busy navigating */ }
      if (got) return got;
      await sleep(1500);
    }
    throw new AppError(`${Math.max(1, Math.round(timeoutMs / 60000))} 分待ちましたが、ログインが終わりませんでした`, 'もう一度 node lab.mjs app token を実行してください。');
  } finally {
    if (cdp && !cdp.closed) { try { await cdp.send('Browser.close'); } catch { /* already closing */ } cdp.close(); }
    await sleep(500);
    if (!exited) { try { process.platform === 'win32' ? spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']) : process.kill(-child.pid); } catch { /* gone */ } }
    // the profile held a Google session: never leave it on disk (the browser may still hold files for a moment)
    for (let k = 0; k < 20 && fs.existsSync(profile); k++) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { await sleep(300); } }
  }
}
