// The Google account on the emulator, written straight into Android's account databases (plan B): the AAS token is the
// account's master token, so a root-capable Google APIs image can be given the account with no password and no code.
// Not a Google procedure: whether Play's license check then passes is only known by running it.
//   1. Play Store (com.android.vending) as a privileged system app: from --vending / APP_VENDING_APK, APP_VENDING_URL +
//      APP_VENDING_SHA256, or else Google Play itself. Google APIs images have Play services but no Play Store, only
//      LicenseChecker under its name, which fails Minecraft's license check (PairIP): it is taken out first
//   2. the account: system_server stopped, one row in accounts_de.db (name, type) and the same _id in accounts_ce.db
//      (with the token as its password), owner and SELinux label put back, then a whole reboot (a framework-only
//      `start` leaves the emulated storage unmounted on Android 14)
// The token never goes on a command line: it reaches the device on sqlite3's stdin only, every adb output shown is redacted,
// and the email is not printed either (CI logs can be public).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError, apkManifest, apkPermissions, credentialProblems, redact, RENEW_HINT } from './apk.mjs';
import { Adb, avdHome, ensureAvd, startEmulator, stopEmulator, tools, waitBoot } from './android.mjs';

export const VENDING = 'com.android.vending';
export const ACCOUNT_TYPE = 'com.google';
export const DE_DB = '/data/system_de/0/accounts_de.db';
export const CE_DB = '/data/system_ce/0/accounts_ce.db';
export const PRIV_APK = '/system/priv-app/Phonesky/Phonesky.apk';
export const PRIV_XML = '/system/etc/permissions/privapp-permissions-com.android.vending.xml';
// where Google APIs images keep LicenseChecker (package com.android.vending: always "not licensed")
export const STUB_DIRS = ['/product/app/LicenseChecker', '/system/product/app/LicenseChecker', '/system/app/LicenseChecker'];
// APP_TIME_SCALE (0..1, tests on the fake device): every fixed pause shorter; deadlines stay in real time
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (Math.min(1, Math.max(0, Number(process.env.APP_TIME_SCALE) || 1)))));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** the SQL for both databases (pure). de: prints the account's _id; ce: needs that _id */
export function accountSql({ email, aasToken, id }) {
  if (!email || !aasToken || credentialProblems({ email, aasToken }).length) throw new AppError('認証情報の形が正しくありません', RENEW_HINT, 'config');
  const who = `name=${q(email)} AND type=${q(ACCOUNT_TYPE)}`;
  const de = [
    'BEGIN;',
    // (a second run replaces the row: grants and visibility of the old one go with it)
    `DELETE FROM grants WHERE accounts_id IN (SELECT _id FROM accounts WHERE ${who});`,
    `DELETE FROM visibility WHERE accounts_id IN (SELECT _id FROM accounts WHERE ${who});`,
    `DELETE FROM accounts WHERE ${who};`,
    `INSERT INTO accounts (name, type, last_password_entry_time_millis_epoch) VALUES (${q(email)}, ${q(ACCOUNT_TYPE)}, ${Date.now()});`,
    'COMMIT;',
    `SELECT _id FROM accounts WHERE ${who};`,
  ].join('\n') + '\n';
  if (id === undefined) return { de };
  if (!Number.isInteger(id) || id < 1) throw new AppError(`accounts_de.db の _id が読めません（${id}）`);
  const ce = [
    'BEGIN;',
    `DELETE FROM authtokens WHERE accounts_id IN (SELECT _id FROM accounts WHERE ${who} OR _id=${id});`,
    `DELETE FROM extras WHERE accounts_id IN (SELECT _id FROM accounts WHERE ${who} OR _id=${id});`,
    `DELETE FROM accounts WHERE ${who} OR _id=${id};`,
    `INSERT INTO accounts (_id, name, type, password) VALUES (${id}, ${q(email)}, ${q(ACCOUNT_TYPE)}, ${q(aasToken)});`,
    'COMMIT;',
  ].join('\n') + '\n';
  return { de, ce };
}

/** the privapp allowlist for every permission Play Store asks for (pure; non-privileged ones in it are ignored by Android) */
export function privappXml(perms) {
  const list = [...new Set(perms.filter((p) => /^[A-Za-z0-9_.]+$/.test(p)))].sort();
  return ['<?xml version="1.0" encoding="utf-8"?>', '<permissions>', `    <privapp-permissions package="${VENDING}">`,
    ...list.map((p) => `        <permission name="${p}"/>`), '    </privapp-permissions>', '</permissions>', ''].join('\n');
}
/** requested permissions from `dumpsys package` (pure) */
export function requestedPerms(dumpsys) {
  const lines = String(dumpsys).split(/\r?\n/), out = [];
  const i = lines.findIndex((l) => /^\s*requested permissions:\s*$/.test(l));
  if (i < 0) return out;
  const indent = /^\s*/.exec(lines[i + 1] ?? '')[0].length;
  for (const l of lines.slice(i + 1)) {
    if (/^\s*/.exec(l)[0].length !== indent || !l.trim() || /:\s*$/.test(l)) break;   // (the next section: "install permissions:")
    out.push(l.trim().split(/[\s,:]/)[0]);
  }
  return out;
}
/** is the account in `dumpsys account`? (pure) */
export const hasAccount = (dumpsys, email) => dumpsys.includes(`Account {name=${email}, type=${ACCOUNT_TYPE}}`);

/** where the Play Store APK comes from: a file, or a URL with its sha256 (downloaded into labDir, checked) */
export async function vendingApk({ file, url, sha256, labDir, log = () => {}, fetchBuffer = defaultFetch } = {}) {
  if (file) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new AppError(`Play ストアの APK がありません: ${file}`, 'com.android.vending の APK（1 個のファイル）を指定してください。');
    return path.resolve(file);
  }
  if (!url) return null;
  if (!/^https:\/\//.test(url)) throw new AppError('APP_VENDING_URL は https:// で始めてください');
  if (!/^[0-9a-f]{64}$/i.test(sha256 ?? '')) throw new AppError('APP_VENDING_URL には APP_VENDING_SHA256（64 桁）が要ります', '中身を確かめずに system へ置くことはしません。');
  const dst = path.join(labDir, 'vending', `${sha256.toLowerCase()}.apk`);
  if (fs.existsSync(dst)) return dst;
  log('  Play ストアの APK を取得しています');
  const buf = await fetchBuffer(url);
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== sha256.toLowerCase()) throw new AppError('Play ストアの APK のハッシュが一致しません（置きません）', `APP_VENDING_SHA256 を確かめてください（取れたもの: ${got}）`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, buf);
  return dst;
}
async function defaultFetch(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!r.ok) throw new AppError(`Play ストアの APK を取得できません（HTTP ${r.status}）`, 'APP_VENDING_URL を確かめてください。');
  return Buffer.from(await r.arrayBuffer());
}

// ---- on the device ----
async function becomeRoot(adb) {
  adb.run(['root'], { timeout: 20_000 }); await sleep(1500); adb.run(['wait-for-device'], { timeout: 60_000 });
  if (adb.shell(['id', '-u']).stdout.trim() !== '0') throw new AppError('エミュレータで root になれません', 'Google APIs のイメージ（google_apis。google_apis_playstore ではない）を使ってください（APP_SYSIMG）。');
}
async function waitUp(adb, { what, ok, timeoutMs = 5 * 60_000 }) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (ok()) return; await sleep(2000); }
  throw new AppError(`${what}が ${Math.round(timeoutMs / 60000)} 分で戻りませんでした`, 'app/.lab/emulator.log と adb.txt を見てください。');
}
const booted = (adb) => adb.run(['get-state'], { timeout: 5000 }).stdout.trim() === 'device' && adb.prop('sys.boot_completed') === '1';

/** Play Store into /system/priv-app (needs the emulator started with -writable-system). Reboots unless reboot:false
 *  (then the files are in place but not loaded yet: the caller reboots once — e.g. the account injection's reboot —
 *  and verifies with vendingLoaded()). */
export async function installVending(adb, apk, { log = () => {}, reboot = true } = {}) {
  await becomeRoot(adb);
  let r = adb.run(['remount'], { timeout: 120_000 });
  // the first remount on a fresh AVD turns verity off and asks for a reboot
  if (/reboot/i.test(r.stdout + r.stderr) && !/remount succeeded/i.test(r.stdout + r.stderr)) {
    log('  /system を書き込めるようにするため、再起動します');
    adb.run(['reboot'], { timeout: 30_000 }); await sleep(5000);
    await waitUp(adb, { what: 'エミュレータ', ok: () => booted(adb) });
    await becomeRoot(adb);
    r = adb.run(['remount'], { timeout: 120_000 });
  }
  if (r.status !== 0 || /not running with -writable-system|permission denied|failed/i.test(r.stdout + r.stderr)) {
    throw new AppError('/system に書き込めません（adb remount）', 'エミュレータを -writable-system で起動し直してください: node lab.mjs app emu stop → node lab.mjs app emu --writable-system');
  }
  // the image's stand-in: Google APIs images carry LicenseChecker under the same name (com.android.vending), which answers
  // every license check with "not licensed"; the real one cannot take the name while it is there
  const stubs = STUB_DIRS.filter((d) => adb.shell(['ls', '-d', d]).status === 0);
  for (const d of stubs) { log(`  Play ストアの代わりの ${d} を外します`); adb.shell(['rm', '-rf', d]); }
  // the permissions it asks for, from its own manifest (a trial install would clash with the stand-in until a reboot)
  let perms;
  try { perms = apkPermissions(apk); } catch (e) { throw new AppError('Play ストアの APK の権限を読めません', `${e.message}（com.android.vending の APK を指定してください）`); }
  if (!perms.length) throw new AppError('Play ストアの APK に権限が 1 つも書かれていません', 'com.android.vending の APK か確かめてください。');
  log(`  /system/priv-app に置きます（権限 ${perms.length} 個を許可リストに）`);
  const xml = path.join(path.dirname(apk), 'privapp-permissions-com.android.vending.xml');
  fs.writeFileSync(xml, privappXml(perms));
  // (lib/ only from what `app vending` took out: a folder of the person's own may hold anything)
  const privDir = path.posix.dirname(PRIV_APK), lib = /^playstore-\d+$/.test(path.basename(path.dirname(apk))) ? path.join(path.dirname(apk), 'lib') : '';
  try {
    adb.shell(['rm', '-rf', privDir]); adb.shell(['mkdir', '-p', privDir]);
    for (const [src, dst] of [[apk, PRIV_APK], [xml, PRIV_XML]]) {
      if (adb.run(['push', src, dst], { timeout: 5 * 60_000 }).status !== 0) throw new AppError(`${dst} に置けません（adb push）`);
    }
    // its native code beside it, as on the image it came from
    if (lib && fs.existsSync(lib) && adb.run(['push', lib, `${privDir}/`], { timeout: 5 * 60_000 }).status !== 0) throw new AppError(`${privDir}/lib に置けません（adb push）`);
  } finally { fs.rmSync(xml, { force: true }); }
  // owner root, dirs 755, files 644, the SELinux label of /system
  adb.run(['shell', `chown -R root:root ${privDir} ${PRIV_XML} && find ${privDir} -type d -exec chmod 755 {} + && find ${privDir} -type f -exec chmod 644 {} + && chmod 644 ${PRIV_XML} && restorecon -R ${privDir} ${PRIV_XML}`], { timeout: 60_000 });
  // files are in /system now; a reboot loads them. reboot:false lets the account injection's own reboot do it (one less reboot)
  if (!reboot) { log('  Play ストアを /system に置きました（アカウント投入後の再起動で読み込みます）'); return { perms: perms.length, version: null, loaded: false }; }
  log('  再起動して読み込ませます');
  adb.run(['reboot'], { timeout: 30_000 }); await sleep(5000);
  await waitUp(adb, { what: 'エミュレータ', ok: () => booted(adb) });
  const v = vendingLoaded(adb);
  if (!v) throw new AppError('Play ストアが system のアプリとして読み込まれませんでした', 'logcat の PackageManager の行を見てください（権限の許可リストや署名の問題）。');
  return { perms: perms.length, version: v, loaded: true };
}
/** the Play Store's version if it loaded from /system/priv-app, else null (pure read) */
export function vendingLoaded(adb) {
  const v = adb.shell(['dumpsys', 'package', VENDING], { timeout: 30_000 }).stdout;
  return /codePath=\/system\/priv-app\//.test(v) ? (/versionName=(\S+)/.exec(v)?.[1] ?? '?') : null;
}

/** writes the Google account into the account databases; the device reboots. Returns when storage is up and AccountManager lists it. */
export async function injectAccount(adb, { email, aasToken }, { log = () => {}, timeoutMs } = {}) {
  const secrets = [aasToken, email];
  const sqlite = (db, sql) => {
    const r = adb.run(['shell', 'sqlite3', db], { input: sql, timeout: 60_000 });
    const text = redact(`${r.stdout}\n${r.stderr}`, secrets).trim();
    if (r.status !== 0 || /^(Error|Parse error|Runtime error)/m.test(text)) throw new AppError(`${path.posix.basename(db)} に書き込めません`, text.split('\n').slice(-2).join(' ').slice(0, 300) || '（出力なし）');
    return r.stdout;
  };
  accountSql({ email, aasToken });   // (the shape first: nothing is stopped for a token that cannot work)
  await becomeRoot(adb);
  if (adb.shell(['command', '-v', 'sqlite3']).status !== 0) throw new AppError('エミュレータに sqlite3 がありません', 'Google APIs のイメージ（APP_SYSIMG の google_apis）を使ってください。');
  for (const db of [DE_DB, CE_DB]) if (adb.shell(['ls', db]).status !== 0) throw new AppError(`${db} がまだありません`, '起動し終わってから（初回の起動の後）もう一度どうぞ。');
  log('  Android のアカウント管理を止めて、Google アカウントを書き込みます');
  adb.shell(['stop']); await sleep(3000);
  let started = false;
  try {
    const id = Number(sqlite(DE_DB, accountSql({ email, aasToken }).de).trim().split(/\s+/).pop());
    sqlite(CE_DB, accountSql({ email, aasToken, id }).ce);
    // sqlite3 ran as root: the files (and any -wal/-shm it left) go back to system, with their SELinux label
    adb.run(['shell', `chown system:system ${DE_DB}* ${CE_DB}* && chmod 600 ${DE_DB}* ${CE_DB}* && restorecon -F ${DE_DB}* ${CE_DB}*`], { timeout: 30_000 });
    // a whole reboot, not `start`: on Android 14 a framework-only restart leaves /storage/emulated unmounted (the
    // StorageManagerService session times out) and the app dies on its splash screen
    adb.run(['reboot'], { timeout: 30_000 }); started = true;
  } finally { if (!started) adb.shell(['start']); }
  log('  再起動して、読み込まれるのを待っています');
  await sleep(5000);
  await waitUp(adb, { what: 'エミュレータ', timeoutMs, ok: () => booted(adb) && adb.shell(['ls', '-d', '/sdcard/Android'], { timeout: 20_000 }).status === 0 });
  try {
    await waitUp(adb, { what: 'アカウント管理', timeoutMs, ok: () => { const d = adb.shell(['dumpsys', 'account'], { timeout: 20_000 }); return d.status === 0 && hasAccount(d.stdout, email); } });
  } catch {
    throw new AppError('書き込んだアカウントが Android に読み込まれませんでした', 'このイメージでは使えない方法かもしれません（adb.txt と logcat の AccountManagerService の行）。手でサインインするなら: node lab.mjs app emu --window');
  }
}

/** what is on the device now (no values): {account, vending} */
export function accountState(adb, email) {
  const d = adb.shell(['dumpsys', 'account'], { timeout: 20_000 }).stdout;
  const v = adb.shell(['dumpsys', 'package', VENDING], { timeout: 30_000 }).stdout;
  return {
    account: email ? hasAccount(d, email) : new RegExp(`type=${ACCOUNT_TYPE.replace('.', '\\.')}\\}`).test(d),
    vending: /codePath=\/system\/priv-app\//.test(v) ? 'system' : /codePath=\/(system\/)?(product|system)\/app\/LicenseChecker/.test(v) ? 'stub' : /versionName=/.test(v) ? 'user' : null,
  };
}

// ---- the real Play Store from Google's own "Google Play" emulator image ----
// Google Play does not hand out com.android.vending ("details: empty answer"), but Google's google_apis_playstore system
// image carries it (/product/priv-app/Phonesky). A second AVD on that image is booted once, the APK pulled (system APKs
// are world-readable: no root), the AVD stopped. The result is kept in <labDir>/vending/ and used by `--account`.
export const PLAYSTORE_AVD = 'bdslab_playstore';
export const PLAYSTORE_SERIAL = 'emulator-5556';
export const playstoreImage = (env = process.env) => env.APP_VENDING_SYSIMG || `system-images;android-34;google_apis_playstore;${process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'}`;
/** a Play Store APK taken out of the image earlier (newest first), or null */
export function extractedVending(labDir) {
  const d = path.join(labDir, 'vending');
  const f = fs.existsSync(d) ? fs.readdirSync(d).filter((x) => /^playstore-\d+$/.test(x) && fs.existsSync(path.join(d, x, 'Phonesky.apk'))).sort().reverse() : [];
  return f.length ? path.join(d, f[0], 'Phonesky.apk') : null;
}
export async function extractVending({ labDir, env = process.env, log = () => {}, cleanup = false, timeoutMs } = {}) {
  const have = extractedVending(labDir);
  if (have) { log(`  取り出し済み: ${path.basename(have)}`); return have; }
  const img = playstoreImage(env), e = { ...env, APP_SYSIMG: img };
  log(`  Google Play 入りのイメージ（${img}）から Play ストアを取り出します（初回だけ、数分）`);
  const t = tools(env);
  if (!t.adb) throw new AppError('adb がありません', '`node lab.mjs app emu` で Android SDK の部品を入れてください。');
  ensureAvd({ log, env: e, avd: PLAYSTORE_AVD });
  const adb = new Adb({ bin: t.adb, serial: PLAYSTORE_SERIAL });
  startEmulator({ labDir, env: e, log, avd: PLAYSTORE_AVD, serial: PLAYSTORE_SERIAL, name: 'emulator-playstore', wipe: true });
  try {
    await waitBoot(adb, { log, ...(timeoutMs ? { timeoutMs } : {}) });
    const where = /package:(\S+\.apk)/.exec(adb.shell(['pm', 'path', VENDING], { timeout: 30_000 }).stdout)?.[1];
    if (!where) throw new AppError('このイメージに Play ストアがありません（pm path com.android.vending）', `APP_VENDING_SYSIMG で google_apis_playstore のイメージを指定してください（いま ${img}）。`);
    // the APK and, when there is one, its lib/ (a system app's native code is not unpacked at install: it must be there)
    const tmp = path.join(labDir, 'vending', 'pull');
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const apk = path.join(tmp, 'Phonesky.apk'), from = path.posix.dirname(where);
    if (adb.run(['pull', where, apk], { timeout: 5 * 60_000 }).status !== 0 || !fs.existsSync(apk)) throw new AppError(`Play ストアを取り出せません（adb pull ${where}）`);
    if (adb.shell(['ls', '-d', `${from}/lib`]).status === 0 && adb.run(['pull', `${from}/lib`, tmp], { timeout: 5 * 60_000 }).status !== 0) throw new AppError(`Play ストアの lib を取り出せません（adb pull ${from}/lib）`);
    let info;
    try { info = apkManifest(apk); } catch (x) { fs.rmSync(tmp, { recursive: true, force: true }); throw new AppError('取り出したものが APK として読めません', x.message); }
    if (info.package !== VENDING) { fs.rmSync(tmp, { recursive: true, force: true }); throw new AppError(`取り出した APK が Play ストアではありません（${info.package}）`); }
    const dst = path.join(labDir, 'vending', `playstore-${String(info.versionCode ?? 0).padStart(12, '0')}`);
    fs.rmSync(dst, { recursive: true, force: true }); fs.renameSync(tmp, dst);
    log(`  Play ストア ${info.versionName ?? '?'} を取り出しました（${path.basename(dst)}${fs.existsSync(path.join(dst, 'lib')) ? '、lib 付き' : ''}）`);
    return path.join(dst, 'Phonesky.apk');
  } finally {
    await stopEmulator(adb, labDir, 'emulator-playstore', { waitMs: 15_000 });
    if (cleanup && t.sdk) {   // (CI disk: the image and the AVD are not needed again)
      fs.rmSync(path.join(t.sdk, ...img.split(';')), { recursive: true, force: true });
      fs.rmSync(path.join(avdHome(env), `${PLAYSTORE_AVD}.avd`), { recursive: true, force: true });
      fs.rmSync(path.join(avdHome(env), `${PLAYSTORE_AVD}.ini`), { force: true });
    }
  }
}
