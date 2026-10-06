// The game's license check on the device. Minecraft carries Google Play's automatic protection (PairIP): at every start it
// asks the Play Store, and Play answers "licensed" only when it can tie the game to an account that bought it; otherwise it
// opens Play's paywall and the game ends. A fresh CI device passed once and then got the paywall run after run, with the
// same account. So this module, never printing a value that identifies the account or the device:
//   facts      what the device knows: who installed the game (installer / initiating package: adb shows as the shell),
//              whether it is registered with Google (GSF id, checkin), which token types the account holds, what Play's
//              library and install records say about the game, the Play / Google services log lines that matter
//   play page  Play's own page for the game: the action it offers (Install / Update / Open / a price = not owned here)
//   play fix   Play installs or updates the game itself (then Play is its real installer, as on a phone)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from './client.mjs';
import { answerDialog, focusOf, FOCUS_SH } from './android.mjs';
import { AppError } from './apk.mjs';

// APP_TIME_SCALE (0..1, tests on the fake device): every fixed pause shorter; deadlines stay in real time
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (Math.min(1, Math.max(0, Number(process.env.APP_TIME_SCALE) || 1)))));
export const VENDING = 'com.android.vending';
export const playUri = (pkg) => `market://details?id=${pkg}`;

/** `dumpsys package <pkg>` → what matters for the license (pure): version, ABI, who installed it, when */
export function packageFacts(text) {
  const t = String(text ?? ''), f = {};
  for (const k of ['versionCode', 'versionName', 'primaryCpuAbi', 'installerPackageName', 'initiatingPackageName', 'originatingPackageName', 'updateOwnerPackageName', 'packageSource', 'firstInstallTime', 'lastUpdateTime']) {
    const m = new RegExp(`^\\s*${k}=(\\S+(?: \\d\\d:\\d\\d:\\d\\d)?)`, 'm').exec(t);
    if (m) f[k] = k === 'versionCode' ? Number(m[1]) : m[1];
  }
  return f;
}
/** installed by Play itself (pure, over packageFacts): Play is the installer and also the one that started the install */
export const byPlay = (f) => f?.installerPackageName === VENDING && f?.initiatingPackageName === VENDING;

/** a uiautomator dump → its nodes with a text or a description (pure): [{text, x, y, clickable, enabled}] */
export function screenNodes(xml) {
  const out = [];
  for (const tag of String(xml ?? '').match(/<node [^>]*>/g) ?? []) {
    const at = (k) => new RegExp(` ${k}="([^"]*)"`).exec(tag)?.[1] ?? '';
    const text = (at('text') || at('content-desc')).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(at('bounds'));
    if (!text || !b) continue;
    out.push({ text, x: Math.round((+b[1] + +b[3]) / 2), y: Math.round((+b[2] + +b[4]) / 2), clickable: at('clickable') === 'true', enabled: at('enabled') !== 'false' });
  }
  return out;
}
// the main button of Play's page for an app, by its label (English and Japanese devices)
const ACTIONS = [
  ['update', /^(Update|更新)$/i], ['install', /^(Install|インストール)$/i], ['open', /^(Open|Play|開く|プレイ)$/i],
  ['buy', /^(Buy|購入)\b|^[$¥￥€£]\s?\d|^\d[\d.,]*\s?[$¥￥€£円]$|^(US|CA|A)?\$\d/i],
  ['unavailable', /not available|isn.t available|ご利用いただけません|互換性がありません|not compatible/i],
];
/** Play's page (pure, over screenNodes or OCR words as nodes) → {action, label, x, y} | null: the first button it offers.
 *  Only a page that has loaded counts (the game's name on it: a sheet still loading shows just "Google Play", whose
 *  "Play" is not the button), and Play / Open only beside Uninstall (an installed game) */
export function playAction(nodes, { title = /minecraft/i } = {}) {
  const ns = nodes ?? [];
  if (!ns.some((x) => title.test(String(x.text)))) return null;
  const installed = ns.some((x) => /^(Uninstall|アンインストール)$/i.test(String(x.text).trim()));
  for (const [action, re] of ACTIONS) {
    if (action === 'open' && !installed) continue;
    const n = ns.find((x) => re.test(String(x.text).trim()) && x.enabled !== false);
    if (n) return { action, label: n.text, x: n.x, y: n.y };
  }
  return null;
}
// Android's own "… isn't responding" / "… keeps stopping" as the layout shows it (it does not always have the focus): its
// Wait (or, for an app that already stopped, Close app)
export function systemDialogButton(nodes) {
  if (!(nodes ?? []).some((n) => /isn.t responding|keeps stopping|応答していません|停止しました/i.test(n.text))) return null;
  return nodes.find((n) => /^(Wait|待機|待つ)$/i.test(n.text)) ?? nodes.find((n) => /^(Close app|アプリを閉じる|OK)$/i.test(n.text)) ?? null;
}
// what a fresh Play Store or Google may put in front of its page: answered with the harmless choice
const PROMPTS = /^(Accept|Agree|Continue|Got it|OK|Not now|No thanks|Skip|Dismiss|同意する|続行|OK|後で|スキップ|閉じる)$/i;
/** a dialog's button to get past it (pure, over screenNodes) → node | null */
export const promptButton = (nodes) => (nodes ?? []).find((n) => PROMPTS.test(n.text) && n.enabled !== false) ?? null;

// ---- the Play Store and Google services lines that say how the license was decided ----
const PLAY_TAGS = /\s(Finsky(?::background)?|GLSUser|Auth|AuthPII|GoogleAuthUtil|TokenRequestor|CheckinService|CheckinTask|Checkin|CheckinRequestProcessor|DroidGuard|LicenseClient|LicenseChecker|AccountManagerService|AccountsDb|GmsCheckin|PlayCommon|PhoneskyHeaders)\s*:/;
const PLAY_WORDS = /pairip|licens|paywall|BadAuthentication|NeedPermission|INVALID_GRANT|ServiceDisabled|DeviceManagementRequired|NeedsBrowser|Unauthorized|AuthenticatorException|checkin|allowed reason|LicenseCheckerCallback/i;
const FINSKY_NOISE = /AIM: AppInfoManager-Perf|SLM: no metadata|ItemStore: Missing some fields|SysCUA:|Heterodyne|ProcessStats|VerifyApps|PlayProtect|Rlz|AppStates|IntegrityService: prefetch/;
/** the lines of a logcat that say what Play and Google's services did about the account, the device and the license (pure) */
export function playLines(logcat, { max = 400 } = {}) {
  const keep = String(logcat ?? '').split(/\r?\n/).filter((l) => (PLAY_TAGS.test(l) || PLAY_WORDS.test(l)) && !FINSKY_NOISE.test(l));
  return keep.length > max ? [...keep.slice(0, 80), `…（${keep.length - max} 行を省略）`, ...keep.slice(-(max - 80))] : keep;
}

// ---- on the device (root: the lab takes it before) ----
const sql = (adb, db, query) => {
  const r = adb.run(['shell', 'sqlite3', db], { input: `${query}\n`, timeout: 30_000 });
  const t = `${r.stdout}${r.stderr}`.trim();
  return r.status === 0 && !/^(Error|Parse error|Runtime error)/m.test(t) ? t : `（読めません: ${t.split('\n').pop()?.slice(0, 160) || r.status}）`;
};
/** what the device knows about the game's license, as report lines. No account name, token or device id is printed:
 *  names of things, counts, versions and times only */
export function licenseFacts(adb, { pkg }) {
  const lines = [];
  const f = packageFacts(adb.shell(['dumpsys', 'package', pkg], { timeout: 30_000 }).stdout);
  lines.push(`ゲーム: ${f.versionName ?? '?'} (${f.versionCode ?? '?'}) ${f.primaryCpuAbi ?? ''}`.trim());
  lines.push(`  入れたもの: installer=${f.installerPackageName ?? '-'} initiating=${f.initiatingPackageName ?? '-'} originating=${f.originatingPackageName ?? '-'}${f.updateOwnerPackageName ? ` updateOwner=${f.updateOwnerPackageName}` : ''}${f.packageSource ? ` source=${f.packageSource}` : ''}（Play 自身が入れた: ${byPlay(f) ? 'はい' : 'いいえ'}）`);
  if (f.firstInstallTime || f.lastUpdateTime) lines.push(`  入れた時刻: ${f.firstInstallTime ?? '?'} / 更新 ${f.lastUpdateTime ?? '?'}`);
  const v = /versionName=(\S+)/.exec(adb.shell(['dumpsys', 'package', VENDING], { timeout: 30_000 }).stdout)?.[1];
  lines.push(`Play ストア: ${v ?? '入っていません'}`);
  // the device registered with Google: GSF's id exists once a checkin succeeded (the id itself is not shown)
  lines.push(`Google への登録（GSF の ID）: ${sql(adb, '/data/data/com.google.android.gsf/databases/gservices.db', "SELECT CASE WHEN count(*) > 0 THEN 'あり' ELSE 'なし' END FROM main WHERE name='android_id';")}`);
  const ck = adb.run(['shell', "cat /data/data/com.google.android.gms/shared_prefs/Checkin.xml 2>/dev/null | grep -o -E 'name=\"[^\"]*(Time|time)[^\"]*\" value=\"[0-9]+\"' | head -8"], { timeout: 20_000 }).stdout.trim();
  if (ck) lines.push(`  checkin: ${ck.split('\n').map((l) => { const m = /name="([^"]+)" value="(\d+)"/.exec(l); return m ? `${m[1]}=${Number(m[2]) > 1e12 ? new Date(Number(m[2])).toISOString().slice(0, 19) : m[2]}` : ''; }).filter(Boolean).join(' ')}`);
  // the account's tokens by type (what Google handed this device for the account; the values are never read)
  lines.push(`アカウントのトークン（種類）: ${sql(adb, '/data/system_ce/0/accounts_ce.db', "SELECT count(*) || ' 個: ' || ifnull(group_concat(substr(type, 1, 60), ', '), '') FROM authtokens WHERE accounts_id IN (SELECT _id FROM accounts WHERE type='com.google');")}`);
  // Play's library: what it knows the account owns (the account is never shown)
  const lib = '/data/data/com.android.vending/databases/library.db';
  lines.push(`Play のライブラリ: ${sql(adb, lib, "SELECT count(*) || ' 件（アプリ ' || sum(CASE WHEN doc_type=1 THEN 1 ELSE 0 END) || '）、アカウント ' || count(DISTINCT account) FROM ownership;").replace(/\n/g, ' ')}`);
  lines.push(`  ${pkg}: ${sql(adb, lib, `SELECT ifnull(group_concat('library ' || library_id || ' type ' || doc_type || ' offer ' || offer_type, '; '), '無し') FROM ownership WHERE doc_id='${pkg}';`).replace(/\n/g, ' ')}`);
  // Play's own record of installing the game (only columns that are states and times)
  const st = '/data/data/com.android.vending/databases/localappstate.db';
  const cols = sql(adb, st, 'PRAGMA table_info(appstate);').split('\n').map((l) => l.split('|')[1]).filter((c) => /^(auto_update|desired_version|last_notified_version|installer_state|first_download_ms|last_update_timestamp_ms|install_reason|persistent_flags|flags|delivery_data_timestamp_ms|external_referrer_timestamp_ms|update_discovered_timestamp_ms)$/.test(c ?? ''));
  lines.push(`Play のインストール記録: ${cols.length ? sql(adb, st, `SELECT ${cols.map((c) => `'${c}=' || ifnull(${c}, '-')`).join(" || ' ' || ")} FROM appstate WHERE package_name='${pkg}';`) || '無し' : '（表が読めません）'}`);
  return { lines, pkg: f };
}

// ---- Play's page for the game ----
function dumpNodes(adb) {
  const r = adb.run(['shell', 'uiautomator dump /data/local/tmp/lab-ui.xml >/dev/null 2>&1; cat /data/local/tmp/lab-ui.xml'], { timeout: 40_000 });
  return /<hierarchy/.test(r.stdout) ? screenNodes(r.stdout) : null;
}
function ocrNodes(png) {
  if (!C.ocrAvailable()) return null;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-play-')), 'p.png');
  try { fs.writeFileSync(f, png); return C.ocrWords(f).map((w) => ({ text: w.text, x: w.left + Math.round(w.width / 2), y: w.top + Math.round(w.height / 2) })); }
  catch { return null; } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
}
/** a system dialog's button to press (pure): Wait, but an app's own window that keeps not answering (the home screen,
 *  3 times and more) is closed instead — it starts again by itself; System UI and system are always waited for */
export function dialogChoice(nodes, seen = 0) {
  const b = systemDialogButton(nodes);
  if (!b) return null;
  const who = nodes.find((n) => /isn.t responding|応答していません/i.test(n.text))?.text ?? '';
  if (seen >= 3 && /launcher/i.test(who) && !/system/i.test(who)) return nodes.find((n) => /^(Close app|アプリを閉じる)$/i.test(n.text)) ?? b;
  return b;
}
/** opens Play's page for the game and reads the action it offers (waits for the page; answers a first-start prompt) →
 *  {action, label, x, y, shot, texts, via} (action null: no known button seen) */
export async function readPlayPage(adb, { pkg, timeoutMs = 180_000, log = () => {}, gone = () => null } = {}) {
  adb.shell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', playUri(pkg), '-p', VENDING], { timeout: 30_000 });
  const end = Date.now() + timeoutMs;
  let last = null, prompts = 0, dialogs = 0;
  while (Date.now() < end) {
    await sleep(4000);
    // Android's own "… isn't responding" over everything (a busy device): Wait, and look again
    const d = focusOf(adb.run(['shell', FOCUS_SH], { timeout: 20_000 }).stdout).dialog;
    if (d) { log(`  Android のダイアログ「${d.proc}」: ${answerDialog(adb, d)}`); continue; }
    let nodes = dumpNodes(adb), via = 'layout', shot = null;
    try { shot = adb.screencap(); } catch { /* busy */ }
    if (!nodes?.length && shot) { nodes = ocrNodes(shot); via = 'OCR'; }
    // neither the layout nor a picture: the emulator may have died under it (gone() → its error, null while it runs)
    if (!nodes) { const g = gone(); if (g) throw g; continue; }
    const sys = dialogChoice(nodes, dialogs);
    if (sys) {
      dialogs++;
      log(`  Android のダイアログ（${nodes.find((n) => /responding|stopping|応答|停止/.test(n.text))?.text ?? ''}）: 「${sys.text}」を押します`);
      adb.shell(['input', 'tap', String(sys.x), String(sys.y)]);
      // (the page was opened behind it: opened again once the dialog is gone)
      if (/close/i.test(sys.text)) { await sleep(3000); adb.shell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', playUri(pkg), '-p', VENDING], { timeout: 30_000 }); }
      continue;
    }
    last = { shot, texts: nodes.map((n) => n.text).slice(0, 40), via };
    const a = playAction(nodes);
    if (a) return { ...a, ...last };
    const p = promptButton(nodes);
    if (p && prompts < 4) { prompts++; log(`  Play の確認「${p.text}」を押します`); adb.shell(['input', 'tap', String(p.x), String(p.y)]); }
  }
  return { action: null, label: null, ...(last ?? { shot: null, texts: [], via: null }) };
}
/** lets Play install or update the game: taps the page's button, then waits until Play is the game's installer (and the
 *  version moved, for an update). Returns the package facts after it, or throws with what it saw */
export async function playInstall(adb, { pkg, page, timeoutMs = Number(process.env.APP_PLAY_INSTALL_MS) || 30 * 60_000, log = () => {}, gone = () => null, poll = Number(process.env.APP_PLAY_POLL_MS) || 5000 } = {}) {
  const before = packageFacts(adb.shell(['dumpsys', 'package', pkg], { timeout: 30_000 }).stdout);
  adb.shell(['input', 'tap', String(page.x), String(page.y)]);
  const t0 = Date.now();
  let said = 0, offered = 0, again = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(poll);
    const f = packageFacts(adb.shell(['dumpsys', 'package', pkg], { timeout: 30_000 }).stdout);
    if (byPlay(f) && (page.action !== 'update' || f.versionCode !== before.versionCode)) return f;
    const d = focusOf(adb.run(['shell', FOCUS_SH], { timeout: 20_000 }).stdout).dialog;
    if (d) { log(`  Android のダイアログ「${d.proc}」: ${answerDialog(adb, d)}`); continue; }
    const nodes = dumpNodes(adb), sys = nodes && systemDialogButton(nodes), p = nodes && !sys && promptButton(nodes);
    if (!nodes) { const g = gone(); if (g) throw g; }
    if (sys) { log(`  Android のダイアログ: 「${sys.text}」を押します`); adb.shell(['input', 'tap', String(sys.x), String(sys.y)]); }
    if (p) { const say = nodes.map((n) => n.text).find((x) => x.length > 30); log(`  Play の確認「${p.text}」を押します${say ? `（${say.slice(0, 160)}）` : ''}`); adb.shell(['input', 'tap', String(p.x), String(p.y)]); }
    // the download failed (HTTP_DATA_ERROR on a slow line: Play's "Got it", then its page offers the button again): pressed
    // again once the page has kept offering it for three looks, up to 3 times
    const a = nodes && !sys && !p ? playAction(nodes) : null;
    if (a && ['install', 'update'].includes(a.action) && !(byPlay(f) && a.action === 'install')) {
      if (++offered >= 3 && again < 3) { again++; offered = 0; log(`  Play のダウンロードが止まりました（ページに「${a.label}」が戻った）: もう一度押します（${again} 回目）`); adb.shell(['input', 'tap', String(a.x), String(a.y)]); }
    } else offered = 0;
    if (Date.now() - said > 60_000) { said = Date.now(); log(`  Play が${page.action === 'update' ? '更新' : 'インストール'}しています（${Math.round((Date.now() - t0) / 1000)} 秒${nodes ? `、画面: ${nodes.map((n) => n.text).filter((x) => x.length < 30).slice(0, 8).join(' / ')}` : ''}）`); }
  }
  throw new AppError(`Play の${page.action === 'update' ? '更新' : 'インストール'}が ${Math.round(timeoutMs / 60_000)} 分で終わりませんでした`, '端末が重すぎて Play が進まないことがあります（host.txt と、落ち着くまでの待ち APP_BASE_SETTLE_MS / APP_SETTLE_MS）。画面（prepare-last*.png）も見てください。');
}
