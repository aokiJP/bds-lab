// The Minecraft APK set: from Google Play with the owner's own account (apkeep, as bedrock-binary does it) or from a folder
// (adb pull). Ported from bedrock-binary src/net/play.js + src/apk/extract.js; the same rules hold:
//   - no password anywhere: GOOGLE_EMAIL + GOOGLE_AAS_TOKEN (made once by `node lab.mjs app token`)
//   - the token never goes on a command line (ps, /proc/<pid>/cmdline): a 0600 ini per run, overwritten and removed after
//   - apkeep's children get no GOOGLE_* variables; its output is redacted before it is shown
//   - apkeep may exit 0 after failing ("Skipping..."): success = the APKs are really there
//   - the APKs stay under app/.lab/apk (git-ignored); CI never uploads them (app guard checks the run folder)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ZipReader } from '../../bedrock-binary/src/apk/zip.js';
import { parseManifest, manifestPermissions } from '../../bedrock-binary/src/apk/axml.js';

export const PACKAGE = 'com.mojang.minecraftpe';
export const APKEEP_VERSION = '1.0.0';
// the official release's SHA-256 (same pins as bedrock-binary). macOS: brew install apkeep
export const APKEEP_ASSETS = {
  'linux-x64': { file: 'apkeep-x86_64-unknown-linux-gnu', sha256: 'a23579a3ba366d25a6d69848189b983d65662f4ecf4b9e11e16510811659de4e' },
  'linux-arm64': { file: 'apkeep-aarch64-unknown-linux-gnu', sha256: '5410acebd1b69427adcf98ccfdda6fa4dd3201e0540e5e2c01037b68e0a84049' },
  'win32-x64': { file: 'apkeep-x86_64-pc-windows-msvc.exe', sha256: '9e321bab9fcc6bab6f6a779ae21d3611dfe6bf3bbecc13ffc9e57aa2db044e7f' },
  'win32-arm64': { file: 'apkeep-x86_64-pc-windows-msvc.exe', sha256: '9e321bab9fcc6bab6f6a779ae21d3611dfe6bf3bbecc13ffc9e57aa2db044e7f' },   // (x64 emulation)
};
// macOS has no official binary, but Homebrew builds one with no dependency beyond the system (libSystem, libiconv):
// its bottle is fetched straight from Homebrew's registry (no Homebrew needed), checked against this pin, and unpacked.
// Built on macOS 14 (Darwin 23); older macOS: Homebrew (brew install apkeep), else cargo (cargo install apkeep).
export const APKEEP_BOTTLES = {
  'darwin-arm64': { sha256: 'e7900765e83e8c263db7346ca8e5d9a810098bdb165494f6c0305833ad5efd22', member: 'apkeep/1.0.0_1/bin/apkeep' },   // arm64_sonoma
  'darwin-x64': { sha256: '1b83813507b5f61fffc83f85f7cd04cd71e304759daa741ea0011977e551a5f9', member: 'apkeep/1.0.0_1/bin/apkeep' },     // sonoma
};
const BOTTLE_URL = (sha) => `https://ghcr.io/v2/homebrew/core/apkeep/blobs/sha256:${sha}`;
const localName = () => `apkeep-${APKEEP_VERSION}${process.platform === 'win32' ? '.exe' : ''}`;

/** the environment for any child process (adb, emulator, BDS, sdkmanager): never the Google secrets */
export function cleanEnv(env = process.env, extra = {}) { const e = { ...env, ...extra }; for (const k of Object.keys(e)) if (/^GOOGLE_/.test(k)) delete e[k]; return e; }

export class AppError extends Error {
  constructor(message, hint, kind = 'error') { super(message); this.name = 'AppError'; this.hint = hint; this.kind = kind; }
}
export const RENEW_HINT = 'AAS トークンを作り直してください: `node lab.mjs app token`（GitHub で使うなら続けて `node lab.mjs app secrets`）';

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const which = (cmd) => { const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null; };

// ---- .env.local (bedrock-binary's format): the local place for the two secrets, never committed ----
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
/** fills only the variables not set yet (CI secrets win). Files: APP_ENV_FILE, <top>/.env.local, <top>/app/.env.local */
export function loadEnv(files, env = process.env) {
  for (const f of files.filter(Boolean)) {
    if (!fs.existsSync(f)) continue;
    for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(f, 'utf8')))) if (env[k] === undefined) env[k] = v;
  }
}

// ---- credentials ----
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function credentialProblems({ email, aasToken }) {
  const out = [];
  if (email && !EMAIL_RE.test(email)) out.push('GOOGLE_EMAIL がメールアドレスの形ではありません');
  if (aasToken) {
    if (/[\s\x00-\x1f]/.test(aasToken)) out.push('GOOGLE_AAS_TOKEN に空白か改行が混ざっています');
    else if (aasToken.length < 20) out.push('GOOGLE_AAS_TOKEN が短すぎます（登録し直してください）');
    else if (/^oauth2_4\//.test(aasToken)) out.push('GOOGLE_AAS_TOKEN に oauth_token（oauth2_4/…）が入っています。AAS トークンに換える前の一度きりの値です');
    else if (/^ya29\./.test(aasToken)) out.push('GOOGLE_AAS_TOKEN に短命の AUTH トークン（ya29.…）が入っています。AAS トークン（aas_et/…）を使ってください');
  }
  return out;
}
export function playCredentials(env = process.env) {
  const email = env.GOOGLE_EMAIL?.trim() || null, aasToken = env.GOOGLE_AAS_TOKEN?.trim() || null;
  const problems = credentialProblems({ email, aasToken });
  return { email, aasToken, problems, partial: Boolean(email) !== Boolean(aasToken), ready: Boolean(email && aasToken) && !problems.length };
}
export function redact(text, secrets) {
  let out = String(text);
  for (const s of secrets.filter((x) => x && x.length >= 6)) out = out.split(s).join('***');
  return out;
}
export function writeApkeepIni(baseDir, { email, aasToken }) {
  if (!email || !aasToken || credentialProblems({ email, aasToken }).length) throw new AppError('認証情報の形が正しくありません', RENEW_HINT, 'config');
  fs.mkdirSync(baseDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(baseDir, '.auth-'));
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'apkeep.ini');
  fs.writeFileSync(file, `[google]\nemail = ${email}\naas_token = ${aasToken}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  const cleanup = () => { try { if (fs.existsSync(file)) fs.writeFileSync(file, '\0'.repeat(64)); } catch { /* removed below */ } fs.rmSync(dir, { recursive: true, force: true }); };
  return { file, cleanup };
}
/** apkeep's output → the failure it means (it can print these and still exit 0) */
export function diagnose(output) {
  const rules = [
    [/Could not log in to Google Play|BadAuthentication|NeedsBrowser|invalid_grant/i, 'auth', 'Google Play にログインできませんでした', `AAS トークンが失効しているか、メールアドレスと組が合っていません。${RENEW_HINT}`],
    [/Terms of Service/i, 'tos', 'Google Play の利用規約に同意していないアカウントです', '一度だけ `node lab.mjs app apk fetch --accept-tos` を実行してください。'],
    [/Invalid app response/i, 'app', 'Play がアプリ情報を返しませんでした', 'このアカウントで Minecraft を購入しているか、端末プロファイル（APP_APK_DEVICE）が合っているか確認してください。'],
    [/Permission denied/i, 'io', '保存先に書き込めませんでした', 'app/.lab の権限を確認してください。'],
    [/Skipping/i, 'download', 'ダウンロードに失敗しました（apkeep が 3 回再試行して諦めました）', '時間を置いてやり直してください。'],
  ];
  for (const [re, kind, reason, hint] of rules) if (re.test(output)) return { reason, hint, kind };
  return null;
}

// ---- apkeep ----
export function findApkeep(toolsDir, env = process.env) {
  if (env.APKEEP_BIN && fs.existsSync(env.APKEEP_BIN)) return env.APKEEP_BIN;
  const onPath = which('apkeep');
  if (onPath) return onPath;
  for (const p of ['/opt/homebrew/bin/apkeep', '/usr/local/bin/apkeep', path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'apkeep.exe' : 'apkeep')]) if (fs.existsSync(p)) return p;
  const asset = APKEEP_ASSETS[`${process.platform}-${process.arch}`];
  const local = path.join(toolsDir, localName());
  if (asset) return fs.existsSync(local) && sha256(local) === asset.sha256 ? local : null;
  // a bottle binary: its own hash was recorded when the pinned bottle was unpacked
  try { return fs.existsSync(local) && sha256(local) === fs.readFileSync(`${local}.sha256`, 'utf8').trim() ? local : null; } catch { return null; }
}
export async function ensureApkeep(toolsDir, { log = console.log, env = process.env, fetchBuffer = defaultFetch, platform = process.platform, arch = process.arch, darwinMajor = Number(os.release().split('.')[0]), bottles = APKEEP_BOTTLES } = {}) {
  const found = findApkeep(toolsDir, env);
  if (found) return found;
  const bottle = platform === 'darwin' && darwinMajor >= 23 ? bottles[`${platform}-${arch}`] : null;
  if (bottle) {
    log('  apkeep を取得しています（初回だけ、5 MB）…');
    const tgz = await fetchBuffer(BOTTLE_URL(bottle.sha256), { authorization: 'Bearer QQ==' });   // (the registry's anonymous token)
    const got = crypto.createHash('sha256').update(tgz).digest('hex');
    if (got !== bottle.sha256) throw new AppError(`apkeep のハッシュが一致しません（期待 ${bottle.sha256.slice(0, 12)}… / 実際 ${got.slice(0, 12)}…）`, '配布物が差し替えられた可能性があります。取得を中止しました。');
    fs.mkdirSync(toolsDir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(toolsDir, '.bottle-'));
    try {
      fs.writeFileSync(path.join(tmp, 'b.tgz'), tgz);
      const x = spawnSync('tar', ['-xzf', path.join(tmp, 'b.tgz'), '-C', tmp, bottle.member], { encoding: 'utf8' });
      const bin = path.join(tmp, ...bottle.member.split('/'));
      if (x.status !== 0 || !fs.existsSync(bin)) throw new AppError('apkeep を展開できません', (x.stderr || '').trim().slice(0, 200));
      const dest = path.join(toolsDir, localName());
      fs.copyFileSync(bin, dest); fs.chmodSync(dest, 0o755);
      fs.writeFileSync(`${dest}.sha256`, sha256(dest));
      if (platform === 'darwin' && process.platform === 'darwin') spawnSync('xattr', ['-d', 'com.apple.quarantine', dest]);
      return dest;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const asset = APKEEP_ASSETS[`${platform}-${arch}`];
  // macOS: no official binary; Homebrew has it (installed here, once, without asking: it is only the downloader)
  if (!asset && process.platform === 'darwin' && !which('brew') && which('cargo')) {
    log('  apkeep を cargo で組み立てています（初回だけ、数分）…');
    spawnSync('cargo', ['install', 'apkeep', '--locked'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60_000, env });
    const got = findApkeep(toolsDir, env);
    if (got) return got;
  }
  if (!asset && process.platform === 'darwin' && which('brew')) {
    log('  apkeep を Homebrew で入れています（初回だけ、1〜2 分）…');
    const r = spawnSync('brew', ['install', 'apkeep'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20 * 60_000, env: { ...env, HOMEBREW_NO_AUTO_UPDATE: '1' } });
    const got = findApkeep(toolsDir, env);
    if (got) return got;
    throw new AppError('apkeep を Homebrew で入れられませんでした', `ターミナルで brew install apkeep を実行してから、もう一度どうぞ。（${(r.stderr || r.stdout || '').trim().split('\n').pop()?.slice(0, 160) ?? ''}）`);
  }
  if (!asset) throw new AppError('APK の取得に使う apkeep が見つかりません', process.platform === 'darwin'
    ? 'Homebrew（https://brew.sh）を入れてから、もう一度どうぞ（apkeep はラボが入れます）。'
    : `https://github.com/EFForg/apkeep/releases/tag/${APKEEP_VERSION} から取り、PATH か APKEEP_BIN に置いてください。`);
  const dest = path.join(toolsDir, localName());
  fs.mkdirSync(toolsDir, { recursive: true });
  const url = `https://github.com/EFForg/apkeep/releases/download/${APKEEP_VERSION}/${asset.file}`;
  log(`  apkeep ${APKEEP_VERSION}: ${url}`);
  fs.writeFileSync(`${dest}.part`, await fetchBuffer(url));
  const got = sha256(`${dest}.part`);
  if (got !== asset.sha256) { fs.rmSync(`${dest}.part`, { force: true }); throw new AppError(`apkeep のハッシュが一致しません（期待 ${asset.sha256.slice(0, 12)}… / 実際 ${got.slice(0, 12)}…）`, '配布物が差し替えられた可能性があります。取得を中止しました。'); }
  fs.renameSync(`${dest}.part`, dest);
  fs.chmodSync(dest, 0o755);
  return dest;
}
async function defaultFetch(url, headers = {}) {
  const r = await fetch(url, { redirect: 'follow', headers, signal: AbortSignal.timeout(10 * 60_000) });
  if (!r.ok) throw new AppError(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** adds/replaces values in a .env.local (0600; other lines kept). The file is git-ignored and never packed by patch/handoff. */
export function saveEnv(file, updates) {
  const cur = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
  const next = { ...cur, ...updates };
  const body = ['# bds-lab app の秘密（Google のメールアドレスと AAS トークン）。git にも zip にも入れないこと', ...Object.entries(next).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`), ''].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

/**
 * The one-time oauth_token (from the Google login page) → a reusable AAS token, through apkeep. No password anywhere.
 * apkeep takes the oauth_token only as an argument: it is one-time and dies in minutes, and this runs on the person's own machine.
 */
export async function exchangeToken({ toolsDir, email, oauthToken, run = spawnSync, log = console.log, env = process.env, fetchBuffer } = {}) {
  if (!EMAIL_RE.test(email ?? '')) throw new AppError('メールアドレスの形ではありません', 'Minecraft を買った Google アカウントのアドレスを入れてください。');
  if (!/^oauth2_4\//.test(oauthToken ?? '')) throw new AppError('oauth_token の形が違います', '`oauth2_4/` で始まる値をそのまま貼ってください（前後の空白や引用符なし）。');
  const bin = await ensureApkeep(toolsDir, { log, env, fetchBuffer });
  const childEnv = { ...env }; delete childEnv.GOOGLE_AAS_TOKEN; delete childEnv.GOOGLE_EMAIL;
  const r = run(bin, ['-e', email, '--oauth-token', oauthToken], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90_000, env: childEnv });
  const m = /AAS Token:\s*(\S+)/.exec(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  if (!m) throw new AppError('AAS トークンを受け取れませんでした', 'oauth_token は一度しか使えず、数分で切れます。ブラウザでログインし直して、新しい値ですぐ試してください。');
  const problems = credentialProblems({ email, aasToken: m[1] });
  if (problems.length) throw new AppError(`受け取った値が AAS トークンの形ではありません: ${problems.join(' / ')}`, 'apkeep の版を確認してください。', 'config');
  return m[1];
}

export function listApks(dir) {
  const out = [];
  const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 3) walk(p, depth + 1); else if (e.isFile() && /\.apk$/i.test(e.name)) out.push(p); } };
  if (fs.existsSync(dir)) walk(dir, 0);
  return out.sort();
}

/**
 * Minecraft from Google Play into <apkDir>/download (emptied first: apkeep does nothing when its folder exists).
 * device: apkeep's device profile. px_9a = arm64-v8a (what bedrock-binary uses); the x86_64 emulator runs it through
 * the image's ARM translation. @returns {{dir, apks}}
 */
// arm64 phones in apkeep's device list (rs-google-play gpapi/device.properties), newest first: Play decides per device whether it
// offers Minecraft, so a silent "nothing saved" on one is tried on the next before giving up
export function findGpdl(toolsDir, env = process.env) {
  if (env.APP_GPDL === '0') return null;
  if (env.GPDL_BIN && fs.existsSync(env.GPDL_BIN)) return env.GPDL_BIN;
  const p = path.join(toolsDir, process.platform === 'win32' ? 'gpdl.exe' : 'gpdl');
  return fs.existsSync(p) ? p : null;
}
/** gpdl prints STEP/INFO/SAVED/FAIL lines. → {dir, apks} when it saved them, else null (logged; `then` is tried next) */
export function runGpdl({ bin, apkDir, cred, device, deviceFile, log = console.log, run = spawnSync, env = process.env, then = 'apkeep で試します' }) {
  const dir = path.join(apkDir, 'download');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ini = writeApkeepIni(apkDir, cred);
  let output;
  try {
    log(`  Google Play から ${PACKAGE} を取得中（gpdl、端末 ${device}）`);
    const childEnv = { ...env }; delete childEnv.GOOGLE_AAS_TOKEN; delete childEnv.GOOGLE_EMAIL;
    const r = run(bin, ['-i', ini.file, '-d', device, ...(deviceFile ? ['--device-file', deviceFile] : []), '-a', PACKAGE, '--accept-tos', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60_000, env: childEnv });
    output = redact(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, [cred.aasToken, cred.email]);
  } finally { ini.cleanup(); }
  const apks = listApks(dir);
  if (apks.length && !/^FAIL /m.test(output)) return { dir, apks };
  try { fs.writeFileSync(path.join(apkDir, 'gpdl.log'), output); } catch { /* best-effort */ }
  const why = (/^FAIL (.*)$/m.exec(output)?.[1] ?? output.trim().split('\n').pop() ?? '').slice(0, 300);
  log(`  gpdl で取れませんでした: ${why}（${then}）`);
  return null;
}
export const FALLBACK_DEVICES =['px_9a', 'sm_s25u', 'nothing_p1', 'sm_s20_plus'];
/** what Google Play offers now for this device profile, without downloading: {code, name} (gpdl --details-only), or null
 *  with the reason logged. The x86_64 profile when the emulator is x86_64 (the build fetchApk takes first) */
export function playVersion({ toolsDir, env = process.env, log = console.log, run = spawnSync }) {
  const cred = playCredentials(env), bin = findGpdl(toolsDir, env);
  if (!cred.ready || !bin) { log(`  Google Play の版を確かめられません（${!bin ? 'gpdl がありません' : 'GOOGLE_EMAIL / GOOGLE_AAS_TOKEN がありません'}）`); return null; }
  const prof = x86ProfileFile(toolsDir), x86 = wantsX86(env) && fs.existsSync(prof);
  const ini = writeApkeepIni(path.join(toolsDir, '..', 'apk'), cred);
  let output;
  try {
    const childEnv = { ...env }; delete childEnv.GOOGLE_AAS_TOKEN; delete childEnv.GOOGLE_EMAIL;
    const r = run(bin, ['-i', ini.file, '-d', x86 ? X86_DEVICE : (env.APP_APK_DEVICE || 'px_9a'), ...(x86 ? ['--device-file', prof] : []), '-a', PACKAGE, '--accept-tos', '--details-only'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, env: childEnv });
    output = redact(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, [cred.aasToken, cred.email]);
  } finally { ini.cleanup(); }
  const m = /^VERSION (\d+) (\S*)/m.exec(output);
  if (m) return { code: Number(m[1]), name: m[2], device: x86 ? X86_DEVICE : (env.APP_APK_DEVICE || 'px_9a') };
  log(`  Google Play の版を確かめられません: ${(/^FAIL (.*)$/m.exec(output)?.[1] ?? output.trim().split('\n').pop() ?? '').slice(0, 200)}`);
  return null;
}

// ---- the x86_64 build of the game: no ARM translation on an x86_64 emulator ----
// Google Play sends the native code for the CPUs of the device profile it is asked with. An arm64 phone (px_9a) gets
// arm64-v8a only, which the x86_64 emulator runs through ARM translation: on GitHub, Android itself stopped answering
// ("System UI isn't responding") before Minecraft got past its splash, run after run. rs-google-play's one x86_64 profile
// is google_kiwi_x86_64 (Google Play Games on PC: Android 14, x86_64 first); without what makes it a PC (its device type,
// Play's HPE feature, the PC input libraries) it reads as an x86_64 tablet, which Play sends Minecraft's x86_64 build.
// app/gpdl/build.sh writes it beside gpdl (gpdl-devices.properties, made there and never kept in this repository: the
// profile is the Calyx Institute's, GPL-3.0-or-later, and keeps its header). Play may not offer it: then the arm64 one.
export const X86_DEVICE = 'bdslab_x86_64';
const PC_ONLY = /^(android\.hardware\.type\.pc|com\.google\.android\.play\.feature\.HPE_EXPERIENCE|app-inputmapping|app-playeventsservice)$/;
/** rs-google-play's device.properties → the bdslab_x86_64 section (pure), or null when google_kiwi_x86_64 is not in it */
export function x86DeviceProfile(deviceProperties) {
  const m = /^\[google_kiwi_x86_64\][^\n]*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(String(deviceProperties).replace(/\r\n/g, '\n'));
  if (!m || !/^Platforms=x86_64/m.test(m[1])) return null;
  const body = m[1].trimEnd().split('\n').map((l) => {
    const kv = /^(Features|SharedLibraries)=(.*)$/.exec(l);
    if (kv) return `${kv[1]}=${kv[2].split(',').filter((x) => !PC_ONLY.test(x.trim())).join(',')}`;
    return /^UserReadableName=/.test(l) ? 'UserReadableName=bds-lab x86_64 (Google Play Games on PC without its PC-only parts)' : l;
  });
  return [`[${X86_DEVICE}]`, "# made by bds-lab (app/gpdl/profile.mjs) from rs-google-play's [google_kiwi_x86_64]: the PC device type,",
    "# Play's HPE feature and the PC input libraries taken out, so that Google Play sees an x86_64 tablet", ...body, ''].join('\n');
}
export const x86ProfileFile = (toolsDir) => path.join(toolsDir, 'gpdl-devices.properties');
/** the x86_64 build first: asked for (APP_APK_X86=1), an x86_64 emulator (APP_SYSIMG, else this machine), no device picked.
 *  Not by default: on the emulator its license check (PairIP) sent the game to Play's purchase page at once, before
 *  asking Play at all (three starts, minutes apart, on CI 2026-10-03), while the arm64 build under ARM translation passed */
export const wantsX86 = (env = process.env) => !env.APP_APK_DEVICE && env.APP_APK_X86 === '1' && (env.APP_SYSIMG ? /x86_64/.test(env.APP_SYSIMG) : process.arch !== 'arm64');
export async function fetchApk({ apkDir, toolsDir, env = process.env, device = env.APP_APK_DEVICE || 'px_9a', acceptTos = false, log = console.log, run = spawnSync, fetchBuffer } = {}) {
  const cred = playCredentials(env);
  if (cred.problems.length) throw new AppError(cred.problems.join(' / '), RENEW_HINT, 'config');
  if (!cred.ready) {
    const missing = [!cred.email && 'GOOGLE_EMAIL', !cred.aasToken && 'GOOGLE_AAS_TOKEN'].filter(Boolean).join(' と ');
    throw new AppError(`APK を取るための認証情報がありません（${missing}）`,
      '`node lab.mjs app token` で作れます（パスワードは使いません）。スマホから取り出した APK を使うなら `node lab.mjs app apk <フォルダ>`。', 'config');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(device)) throw new AppError(`端末プロファイルの形が違います: ${device}`);
  // gpdl first (app/gpdl: asks Play only for the delivery of what the account owns, which a paid app like Minecraft needs;
  // apkeep "purchases" first and gets nothing for it). apkeep stays the fallback when gpdl is not built.
  const gp = findGpdl(toolsDir, env);
  if (gp) {
    // the x86_64 build first on an x86_64 emulator (it runs without ARM translation), else / then the arm64 one
    const prof = x86ProfileFile(toolsDir), src = path.join(path.dirname(toolsDir), 'rs-google-play', 'gpapi', 'device.properties');
    // (a gpdl built before the profile was: made from the source build.sh left)
    if (wantsX86(env) && !fs.existsSync(prof) && fs.existsSync(src)) { const p = x86DeviceProfile(fs.readFileSync(src, 'utf8')); if (p) fs.writeFileSync(prof, p); }
    if (wantsX86(env) && fs.existsSync(prof)) {
      log(`  x86_64 版を先に試します（APP_APK_X86=1。x86_64 の端末で ARM 変換なしに動くが、エミュレータではライセンス確認に止められることがある）`);
      const got = runGpdl({ bin: gp, apkDir, cred, device: X86_DEVICE, deviceFile: prof, log, run, env, then: `arm64 版を端末 ${device} で試します` });
      if (got) {
        try { const i = inspectApks(got.apks); log(`  ${i.abis.join(',')} 版を取れました（端末 ${X86_DEVICE}）`); return got; }
        catch (e) { log(`  端末 ${X86_DEVICE} で取れたものが使えません（${e.message}）: arm64 版を端末 ${device} で試します`); }
      }
    }
    const got = runGpdl({ bin: gp, apkDir, cred, device, log, run, env });
    if (got) return got;
  }
  const bin = await ensureApkeep(toolsDir, { log, env, fetchBuffer });
  const dir = path.join(apkDir, 'download');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const once = (tos) => {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const ini = writeApkeepIni(apkDir, cred);
    try {
      const args = ['-a', PACKAGE, '-d', 'google-play', '-o', `device=${device},split_apk=true`, '-i', ini.file, ...(tos ? ['--accept-tos'] : []), dir];
      log(`  Google Play から ${PACKAGE} を取得中（端末 ${device}${tos ? '、利用規約に同意して' : ''}）`);
      const childEnv = { ...env }; delete childEnv.GOOGLE_AAS_TOKEN; delete childEnv.GOOGLE_EMAIL;
      const r = run(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60_000, env: childEnv });
      return { r, output: redact(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, [cred.aasToken, cred.email]) };
    } finally { ini.cleanup(); }
  };
  let { r, output } = once(acceptTos);
  // apkeep can end with exit 0 having saved nothing and said nothing ("Downloading ..." only): once more, accepting the
  // Play terms (an account that never accepted them gets no download link and, on some builds, no message either)
  const silentNow = () => !r.error && r.status === 0 && !listApks(dir).length && !diagnose(output);
  if (silentNow() && !acceptTos) ({ r, output } = once(true));
  // still nothing: the other device profiles (only when the person did not pick one), with the terms accepted
  const tried = [device];
  if (!env.APP_APK_DEVICE) for (const d of FALLBACK_DEVICES.filter((x) => x !== device)) {
    if (!silentNow()) break;
    device = d; tried.push(d);
    ({ r, output } = once(true));
    if (listApks(dir).length) log(`  端末 ${d} で取れました（次から固定するなら APP_APK_DEVICE=${d}）`);
  }
  const apks = listApks(dir), problem = diagnose(output);
  if (r.error || r.status !== 0 || !apks.length) {
    // the whole (redacted) output stays in a file: the last lines alone are often just "Downloading ..."
    const logf = path.join(apkDir, 'apkeep.log');
    try { fs.writeFileSync(logf, `${bin}\n${(run(bin, ['--version'], { encoding: 'utf8' }).stdout ?? '').trim()}\ndevice ${device}\n\n${output}`); } catch { /* best-effort */ }
    const silent = !r.error && r.status === 0 && !problem;
    const p = problem ?? (silent
      ? { reason: 'apkeep は何も保存せずに終わりました（Google Play がダウンロード先を返していません）', kind: 'download',
        hint: [`よくある原因（記録: ${logf}）:`,
          `  1. この Google アカウント（${cred.email.replace(/^(.).*(@.*)$/, '$1…$2')}）で Minecraft を買っていない → Play ストアで、そのアカウントで「インストール」が出るか確認`,
          '  2. トークンが別のアカウントで作られた → node lab.mjs app token --force（アドレスを入れ直す）',
          `  3. 端末プロファイル: ${tried.join(' / ')} のどれでも Play が配布先を返さなかった（別のを試すなら APP_APK_DEVICE=<名前>）`,
          '     Play ストア（スマホかブラウザの play.google.com）で、そのアカウントの「ライブラリ」に Minecraft があるか確かめるのが一番早い',
          '  4. どうしても取れない → スマホから取り出した APK のフォルダを使う: node lab.mjs app apk <フォルダ>'].join('\n') }
      : { reason: `apkeep が失敗しました（終了コード ${r.status ?? r.error?.code}）`, hint: `${output.trim().split('\n').slice(-3).join('\n')}\n（全文: ${logf}）`, kind: 'download' });
    throw new AppError(p.reason, p.hint, p.kind);
  }
  return { dir, apks };
}

/** an APK's package / versionCode / versionName / split (any app) */
export function apkManifest(file) {
  const z = new ZipReader(file);
  try {
    if (!z.has('AndroidManifest.xml')) throw new AppError(`${path.basename(file)} に AndroidManifest.xml がありません（APK ではない？）`);
    return parseManifest(z.read('AndroidManifest.xml', { maxSize: 16 * 1024 * 1024 }));
  } finally { z.close(); }
}
/** the permissions an APK asks for, read from its manifest (nothing installed) */
export function apkPermissions(file) {
  const z = new ZipReader(file);
  try {
    if (!z.has('AndroidManifest.xml')) throw new AppError(`${path.basename(file)} に AndroidManifest.xml がありません（APK ではない？）`);
    return [...new Set(manifestPermissions(z.read('AndroidManifest.xml', { maxSize: 16 * 1024 * 1024 })))];
  } finally { z.close(); }
}

/**
 * another app (one file, the base APK) from Google Play with the same account (gpdl, then apkeep): the Play Store itself
 * (com.android.vending) for `--account`. → the file, or null with the reason logged (Play may not hand it out)
 */
export async function fetchPlayApp({ pkg, dir, toolsDir, env = process.env, device = env.APP_APK_DEVICE || 'px_9a', log = console.log, run = spawnSync, fetchBuffer } = {}) {
  if (!/^[A-Za-z0-9_.]+$/.test(pkg ?? '')) throw new AppError(`パッケージ名の形が違います: ${pkg}`);
  const cred = playCredentials(env);
  if (!cred.ready) { log(`W ${pkg} を Google Play から取れません（GOOGLE_EMAIL / GOOGLE_AAS_TOKEN が無い）`); return null; }
  const isPkg = (f) => { try { const z = new ZipReader(f); try { const m = parseManifest(z.read('AndroidManifest.xml', { maxSize: 16 * 1024 * 1024 })); return m.package === pkg && !m.split; } finally { z.close(); } } catch { return false; } };
  const childEnv = { ...env }; delete childEnv.GOOGLE_AAS_TOKEN; delete childEnv.GOOGLE_EMAIL;
  // gpdl first (it says why Play refuses: details / purchase / delivery status), then apkeep
  const gp = findGpdl(toolsDir, env);
  if (gp) {
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const ini = writeApkeepIni(path.dirname(dir), cred);
    let out = '';
    try {
      log(`  Google Play から ${pkg} を取得中（gpdl、端末 ${device}）`);
      const r = run(gp, ['-i', ini.file, '-d', device, '-a', pkg, '--accept-tos', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000, env: childEnv });
      out = redact(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, [cred.aasToken, cred.email]);
    } finally { ini.cleanup(); }
    const got = listApks(dir).find(isPkg);
    if (got) return got;
    for (const l of out.split('\n').filter((x) => /^(INFO|FAIL) /.test(x)).slice(-6)) log(`    gpdl: ${l.slice(0, 240)}`);
  }
  const bin = await ensureApkeep(toolsDir, { log, env, fetchBuffer });
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ini = writeApkeepIni(path.dirname(dir), cred);
  let output = '';
  try {
    log(`  Google Play から ${pkg} を取得中（apkeep、端末 ${device}）`);
    const r = run(bin, ['-a', pkg, '-d', 'google-play', '-o', `device=${device},split_apk=false`, '-i', ini.file, '--accept-tos', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000, env: childEnv });
    output = redact(`${r.stdout ?? ''}\n${r.stderr ?? ''}`, [cred.aasToken, cred.email]);
  } finally { ini.cleanup(); }
  const apk = listApks(dir).find(isPkg);
  if (apk) return apk;
  log(`W ${pkg} を Google Play から取れませんでした: ${(diagnose(output)?.reason ?? output.trim().split('\n').pop() ?? '').slice(0, 200)}`);
  return null;
}

/** what a folder of APKs is: version (from the base APK), splits, native ABIs. Nothing is written. */
export function inspectApks(paths) {
  const apks = []; let base = null; const abis = new Set();
  for (const p of paths) {
    const z = new ZipReader(p);
    try {
      const m = z.has('AndroidManifest.xml') ? parseManifest(z.read('AndroidManifest.xml', { maxSize: 16 * 1024 * 1024 })) : null;
      for (const e of z.entries) { const hit = /^lib\/([^/]+)\/libminecraftpe\.so$/.exec(e.name); if (hit) abis.add(hit[1]); }
      apks.push({ path: p, split: m?.split ?? null, package: m?.package ?? null, versionName: m?.versionName ?? null, versionCode: m?.versionCode ?? null });
      if (m && !m.split && !base) base = m;
    } finally { z.close(); }
  }
  if (!base) throw new AppError('base APK（split 属性の無いもの）がありません', 'base.apk（apkeep なら com.mojang.minecraftpe.apk）を同じフォルダに入れてください。');
  if (base.package !== PACKAGE) throw new AppError(`Minecraft の APK ではありません（${base.package}）`);
  const mixed = apks.filter((a) => a.versionCode !== null && a.versionCode !== base.versionCode);
  if (mixed.length) throw new AppError(`版の違う APK が混ざっています: ${mixed.map((a) => path.basename(a.path)).join(' ')}`, '同じ版の一式だけにしてください。');
  if (!abis.size) throw new AppError('libminecraftpe.so がどの APK にもありません', 'split_config.arm64_v8a.apk（か x86_64）を同じフォルダに入れてください。');
  return { versionName: base.versionName, versionCode: base.versionCode, abis: [...abis].sort(), apks };
}

/**
 * BDS builds to try for an app version, best first: 1.26.52.03 → 1.26.52.3 (the same build; tried even when the repo's list
 * does not know it yet: the CDN has it by name), then the newest other 1.26.52.x the list knows. [] = not a version.
 */
export function bdsCandidates(versionName, known) {
  const n = String(versionName ?? '').split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
  if (n.length < 4 || n.some((x) => !Number.isFinite(x))) return [];
  const want = n.slice(0, 4).join('.'), fam = n.slice(0, 3).join('.') + '.';
  const all = [...(known?.versions ?? []), ...(known?.preview_versions ?? [])];
  const same = [...new Set(all.filter((v) => v.startsWith(fam) && v !== want))].sort((a, b) => Number(b.split('.')[3]) - Number(a.split('.')[3]));
  return [want, ...same];
}

