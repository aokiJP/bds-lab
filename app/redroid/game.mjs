#!/usr/bin/env node
// The real Minecraft on the redroid device: the Google account in, the game installed by Play itself (its license check,
// PairIP, takes only a game Play installed for an account that bought it), and how long a start takes to the title.
// Only reads app/lib (the account's SQL, Play's page and install, OCR). Reached through `node lab.mjs app redroid …`.
//   node app/redroid/game.mjs prep --data <dir> [--image t]   the device made once: account, checkin, Play installs the game,
//                                                              first start to the title, stopped (the data folder is the result)
//   node app/redroid/game.mjs bench --data <dir> [--rounds 3]  starts from it (overlay: nothing copied) → seconds to the title
//   node app/redroid/game.mjs seal|open --data <dir> [--file f]   the prepared device into / out of app's vault (encrypted;
//                                                              in GitHub Actions only for a private repository; as root)
//   node app/redroid/game.mjs launch [--port p]                the game on a running device, timed to its title
//   node app/redroid/game.mjs debug --data <dir> [--addon a] [--mode run|ui] [--keep] [-- <app run / ui の指定>]
//                                                              app/'s own `app run` (or `app ui`) started at once beside it (its
//                                                              BDS comes up while the device does: APP_DEVICE_READY_FILE is the
//                                                              device's word, ready or why not), the device restored → booted →
//                                                              at the title (timed), then taken as it is (APP_SERIAL,
//                                                              APP_LIVE_DEVICE=1); stopped after unless --keep (= app run --device
//                                                              redroid, where --keep is the default off GitHub Actions)
// Secrets: GOOGLE_EMAIL + GOOGLE_AAS_TOKEN (the token reaches the account database on stdin only; neither is printed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from './redroid.mjs';
import { PACE, ocrDue, logSignals, readyRe, prevTitleMs, keepTitle, readPace, writePace } from './pace.mjs';
import * as TL from './timeline.mjs';
import { accountSql, hasAccount } from '../lib/account.mjs';
import { Adb, startPad } from '../lib/android.mjs';
import * as WD from '../lib/world.mjs';
import { PACKAGE, redact } from '../lib/apk.mjs';
import * as L from '../lib/license.mjs';
import * as C from '../lib/client.mjs';
import * as V from '../lib/vault.mjs';
import * as PF from './prepfast.mjs';
import * as RD from './ready.mjs';
import { startBoost, stopBoost } from './boost.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), LAB = path.join(HERE, '.lab');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const secs = (ms) => Math.round(ms / 100) / 10;
const SECRETS = () => [process.env.GOOGLE_AAS_TOKEN, process.env.GOOGLE_EMAIL].filter(Boolean);
const say = (t) => console.log(redact(String(t), SECRETS()));
// what Ctrl+C has to know: a boost still on (its nices put back), the device ready yet (a device that never got to the title is
// not left up even with --keep: the next run would take it as it is)
const live = { boost: null, ready: false };
const adbOf = (port = R.PORT) => new Adb({ bin: process.env.ADB || [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean).map((d) => path.join(d, 'platform-tools', 'adb')).find((p) => fs.existsSync(p)) || 'adb', serial: `127.0.0.1:${port}` });

// ---- the account, written from the host while the device is stopped (its /data is a folder here: no sqlite3 needed on
// the device, no framework restart) ----
const PY = `
import sqlite3, sys
db, sql = sys.argv[1], sys.stdin.read()
lines = sql.strip().split('\\n')
sel = [l for l in lines if l.startswith('SELECT')]
c = sqlite3.connect(db)
c.executescript('\\n'.join(l for l in lines if not l.startswith('SELECT')))
for s in sel:
    for row in c.execute(s): print(row[0])
c.commit(); c.close()
`;
function sqlite(db, sql) {
  const r = R.sh('python3', ['-c', PY, db], { sudo: true, input: sql, quiet: true });
  if (r.status !== 0) throw new Error(`${path.basename(db)} に書き込めません: ${redact(r.stderr, SECRETS()).trim().split('\n').pop()}`);
  return r.stdout;
}
export function injectAccount(data, { email = process.env.GOOGLE_EMAIL, aasToken = process.env.GOOGLE_AAS_TOKEN } = {}) {
  if (!email || !aasToken) throw new Error('GOOGLE_EMAIL と GOOGLE_AAS_TOKEN が要ります');
  const de = path.join(data, 'system_de/0/accounts_de.db'), ce = path.join(data, 'system_ce/0/accounts_ce.db');
  for (const db of [de, ce]) if (R.sh('test', ['-f', db], { sudo: true, quiet: true }).status !== 0) throw new Error(`${db} がありません（初回の起動の後に。CE が暗号化されているなら、この方法は使えません）`);
  const id = Number(sqlite(de, accountSql({ email, aasToken }).de).trim().split(/\s+/).pop());
  sqlite(ce, accountSql({ email, aasToken, id }).ce);
  // (python ran as root: the files and any journal it left go back to system, uid 1000, as Android made them)
  R.sh('sh', ['-c', `chown 1000:1000 ${de}* ${ce}* && chmod 600 ${de}* ${ce}*`], { sudo: true });
  return id;
}
async function waitFor(what, ok, { timeoutMs, every = 2000 } = {}) {
  const t0 = now();
  while (now() - t0 < timeoutMs) { try { if (await ok()) return secs(now() - t0); } catch { /* not yet */ } await sleep(every); }
  throw new Error(`${what}が ${Math.round(timeoutMs / 1000)} 秒で終わりません`);
}
/** the device registered with Google (GSF's android_id exists once a checkin succeeded; the id itself is not read) */
function checkedIn(data) {
  const r = R.sh('python3', ['-c', "import sqlite3,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\nprint(c.execute(\"select count(*) from main where name='android_id'\").fetchone()[0])", path.join(data, 'data/com.google.android.gsf/databases/gservices.db')], { sudo: true, quiet: true });
  return r.status === 0 && Number(r.stdout.trim()) > 0;
}

// ---- the game's start, timed ----
const focus = (adb) => /mCurrentFocus=Window\{\S+ \S+ ([^}\s]+)/.exec(adb.run(['shell', 'dumpsys window displays | grep mCurrentFocus='], { timeout: 15_000 }).stdout)?.[1] ?? '';
function words(adb) {
  if (!C.ocrAvailable()) return null;
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'redroid-')), 's.png');
  try { fs.writeFileSync(f, adb.screencap()); return C.ocrWords(f); } catch { return []; } finally { fs.rmSync(path.dirname(f), { recursive: true, force: true }); }
}
// the title as OCR reads it (the classic menu's buttons are white on green and often unread: "©Mojang AB" and the skin's
// name are read; the new player's title says Get started / More options)
// (app/lib's titleWords, and the new player's title as OCR reads it on this device's screen: "©Mojang AB" — "@iMoJjang AG" —
// with More options, while Get started comes out as "ay" or "Get ey")
export const isTitle = (w) => !/Play Games|account settings/i.test(w.map((x) => x.text).join(' ')) && (C.titleWords(w) || Boolean(C.findText(w, /^Get started$/i)) || (/mo[j]+ang\s*a[bg]\b/i.test(w.map((x) => x.text).join(' ')) && Boolean(C.findText(w, /^More options$/i))));
const screenSize = () => { const m = /^(\d+)x(\d+)/.exec(process.env.REDROID_SIZE || '1560x720'); return { w: Number(m?.[1]) || 1560, h: Number(m?.[2]) || 720 }; };
/** starts the game (cold) and waits for its title → {pidS, windowS, drawnS, titleS, words, license, ocr} seconds from the
 *  launch. The screen is read (OCR) only after the cheap signals (process, window, logcat) and, when earlier starts are kept
 *  (paceFile), from 7/10 of their titleS on, at widening gaps (pace.mjs); ocr = {n, fromS, gate}: how many reads, from when */
export async function launch(adb, { timeoutMs = 240_000, shots = null, paceFile = path.join(LAB, 'title-pace.json'), boost = false } = {}) {
  adb.shell(['am', 'force-stop', PACKAGE]);
  // (REDROID_BOOST=1: the game first while it starts — bench and debug only, never prep: Google's services stay as they are there)
  const bst = boost ? (live.boost = startBoost(adb)) : null;
  const t0 = now(), m = {};
  const kept = readPace(paceFile), prevMs = prevTitleMs(kept), ready = readyRe(), off = process.env.REDROID_OCR_PACE === '0';
  const o = { n: 0, last: null, logAt: null, drawn: false, ready: false };
  m.ocr = { n: 0, fromS: null, gate: null, prevS: prevMs ? secs(prevMs) : null };
  adb.run(['logcat', '-c'], { timeout: 15_000 });
  // (am start -W: its answer says whether the activity started at all, and how long Android took)
  const comp = adb.shell(['cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', PACKAGE], { timeout: 30_000 }).stdout.trim().split('\n').pop();
  const st = adb.shell(['am', 'start', '-W', ...(/\//.test(comp ?? '') ? ['-n', comp] : ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', PACKAGE])], { timeout: 120_000 });
  m.am = `${st.stdout}${st.stderr}`.split('\n').filter((l) => /Status|Error|Warning|Activity|TotalTime|WaitTime/.test(l)).map((l) => l.trim()).join(' | ').slice(0, 300);
  let last = [], n = 0, goneAt = null;
  while (now() - t0 < timeoutMs) {
    // (one pidof a round: it says both "started" and "gone")
    const pid = adb.pid(PACKAGE);
    if (!m.pidS && pid > 0) m.pidS = secs(now() - t0);
    const f = focus(adb);
    if (!m.windowS && f.startsWith(PACKAGE)) m.windowS = secs(now() - t0);
    // Play's paywall or the game gone: the license check said no
    // (gone for 4 s: not the moment between its splash and its main process)
    const gone = m.pidS && pid === 0 ? (goneAt ??= now()) : (goneAt = null);
    if (m.pidS && (/^com\.android\.vending/.test(f) || (gone && now() - gone > 4000))) { m.license = `no（${f || 'ゲームが終わった'}）`; break; }
    // logcat, until what it is read for is seen: Android's "Displayed" (the first frame) and the REDROID_TITLE_LOG line
    if (m.pidS && !off && (!o.drawn || (ready && !o.ready)) && (o.logAt === null || now() - o.logAt >= PACE.logEveryMs)) {
      o.logAt = now();
      const s = logSignals(adb.run(['logcat', '-d', '-v', 'brief'], { timeout: 15_000 }).stdout, { pkg: PACKAGE, readyRe: ready });
      if (s.drawn && !o.drawn) { o.drawn = true; m.drawnS = secs(now() - t0); }
      if (s.ready && !o.ready) { o.ready = true; m.logS = secs(now() - t0); o.n = 0; o.last = null; }
    }
    const due = ocrDue({ atMs: now() - t0, windowSeen: Boolean(m.windowS), readySeen: o.ready, prevTitleMs: prevMs, timeoutMs, lastOcrMs: o.last, n: o.n, off });
    // (no OCR on this machine: said at the window, as before, not at the gate)
    if (m.windowS && !off && (o.can ??= C.ocrAvailable()) === false) { m.titleS = null; m.note = 'OCR なし: タイトルは見ていません'; break; }
    if (due.ocr) {
      m.ocr.fromS ??= secs(now() - t0); m.ocr.gate ??= due.gate;
      o.last = now() - t0; o.n++; m.ocr.n++;
      const w = words(adb);
      if (w === null) { m.titleS = null; m.note = 'OCR なし: タイトルは見ていません'; break; }
      last = w.map((x) => x.text).filter((x) => x.length > 1).slice(0, 30);
      // every screen seen, once (where a start stalls): its time and first words
      const key = last.filter((x) => /^[A-Za-z]{3,}$/.test(x)).slice(0, 8).join(' ');
      if (key && key !== m.trail?.at(-1)?.split(' ').slice(1).join(' ')) (m.trail ??= []).push(`${secs(now() - t0)}s ${key}`);
      if (shots && n++ % 3 === 0) try { fs.writeFileSync(path.join(shots, `launch-${String(n).padStart(3, '0')}.png`), adb.screencap()); } catch { /* busy */ }
      if (isTitle(w)) { m.titleS = secs(now() - t0); m.license = 'ok'; break; }
      // the game's first-start screens (WELCOME: Sign in now / Maybe later …): the button that leaves without signing in
      const b = C.firstRunButton(w, screenSize());
      // (the next screen comes soon after a tap: read again at the first gap)
      if (b && (m.firstRun ?? 0) < 8) { m.firstRun = (m.firstRun ?? 0) + 1; m.license = 'ok'; adb.tap(b.x, b.y, 'hold'); o.n = 0; o.last = null; await sleep(2500); continue; }
    }
    await sleep(500);
  }
  if (bst) { m.boost = await stopBoost(adb, bst); live.boost = null; }
  m.words = last.join(' ').slice(0, 200);
  if (m.trail) m.trail = m.trail.slice(-14);
  if (!m.titleS) m.why = whyNot(adb);
  writePace(paceFile, keepTitle(kept, m));
  return m;
}

// MindTheGapps' apps that only take CPU on this device (prep disables them; Play, Play services and GSF are never on it:
// prepfast's quietable takes them out). onetimeinitializer: its work runs right after a boot
export const QUIET = ['com.google.android.googlequicksearchbox', 'com.google.android.apps.wellbeing', 'com.google.android.feedback',
  'com.google.android.syncadapters.calendar', 'com.google.android.syncadapters.contacts', 'com.google.android.gm.exchange',
  'com.google.android.partnersetup', 'com.google.android.apps.restore', 'com.google.android.projection.gearhead', 'com.google.android.setupwizard',
  'com.google.android.onetimeinitializer'];
/** adbd as root (licenseFacts reads Play's databases): service.adb.root=1 at boot does it; else `adb root` once */
async function root(adb) {
  if (adb.shell(['id', '-u']).stdout.trim() === '0') return true;
  adb.run(['root'], { timeout: 20_000 }); await sleep(1500);
  R.sh(adb.bin, ['connect', adb.serial], { quiet: true, timeout: 10_000 });
  await waitFor('adb の root', () => adb.shell(['id', '-u'], { timeout: 5000 }).stdout.trim() === '0', { timeoutMs: 30_000, every: 1000 }).catch(() => {});
  return adb.shell(['id', '-u']).stdout.trim() === '0';
}

/** why the game did not get to its title, from the device's own record: the crash buffer, the game's and its protection's
 *  log lines, the window in front (no account or device ids in these lines: they are the game's and Android's) */
export function whyNot(adb) {
  const crash = adb.run(['logcat', '-d', '-b', 'crash'], { timeout: 30_000 }).stdout.trim().split('\n').filter((l) => l.trim()).slice(0, 12);
  const lines = adb.run(['logcat', '-d', '-v', 'brief'], { timeout: 30_000 }).stdout.split('\n')
    .filter((l) => /minecraft|mojang|pairip|licens|libc\s*:|DEBUG\s*:|AndroidRuntime|FATAL|ActivityManager: (Start proc|Process .* has died|Killing)|ActivityTaskManager: (START|Displayed)|houdini|nativebridge|ndk_translation/i.test(l))
    .map((l) => redact(l, SECRETS()).trim().slice(0, 220));
  return { focus: focus(adb), pid: adb.pid(PACKAGE), crash, lines: lines.slice(-25) };
}

/** the game's first launch after Play installed it: Android keeps a package frozen for a while after an install ("Package
 *  … is currently frozen": the start fails at once) → tried again until it starts */
async function launchFresh(adb, opts) {
  let r;
  for (let i = 0; i < 4; i++) {
    r = await launch(adb, { ...opts, timeoutMs: i < 3 ? 30_000 : opts.timeoutMs });
    if (r.pidS || r.titleS) return r.titleS ? r : launch(adb, opts);
    // (any start that left no process: the freeze's own log line is often buried under Play's)
    await sleep(15_000);
  }
  return r;
}
/** after the title, once, as app/'s prepare does: the content log to a file, still menus and light drawing (options.txt),
 *  an own world (a player with a world: Play opens the PLAY screen, not the new player's flow), the classic menu (the
 *  device's controller: DOWN DOWN A on the new player's title) → notes */
async function finishGame(adb, { shots } = {}) {
  const notes = [];
  const opts = adb.run(['shell', `cat ${C.OPTIONS(PACKAGE)}`], { timeout: 20_000 }).stdout;
  const sw = C.contentLogSwitches(opts), fast = { ...C.fastUiSwitches(opts), ...C.lightGfxSwitches(opts) };
  adb.shell(['am', 'force-stop', PACKAGE]); await sleep(1500);
  const patch = { ...Object.fromEntries(sw.map((k) => [k, '1'])), ...fast };
  if (Object.keys(patch).length && adb.run(['shell', `cat > ${C.OPTIONS(PACKAGE)}`], { input: C.patchOptions(opts, patch), timeout: 20_000 }).status === 0) notes.push(`options ${Object.keys(patch).length} 項目`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redroid-world-')), from = '/data/local/tmp/lab-world';
  try {
    for (const f of WD.worldFiles()) fs.writeFileSync(path.join(dir, f.path), f.data);
    adb.run(['push', dir, from], { timeout: 60_000 });
    if (/^world /m.test(adb.run(['shell', WD.placeLine({ pkg: PACKAGE, from })], { timeout: 30_000 }).stdout)) notes.push('自分のワールド');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const again = await launch(adb, { shots });
  notes.push(`起動し直して ${again.titleS ?? '?'} 秒でタイトル`);
  const pd = startPad(adb, { labDir: LAB });
  if (pd.ok) {
    const w = words(adb) ?? [];
    if (C.findText(w, /^Get started$/i) && C.findText(w, /^More options$/i)) {
      for (const k of ['DOWN', 'DOWN', 'A']) { adb.pad(k); await sleep(3500); }
      const w2 = words(adb) ?? [];
      notes.push(C.findText(w2, /^Play$/i) && C.findText(w2, /^Settings$/i) ? 'クラシックのメニュー' : `クラシックのメニューにならない（${w2.map((x) => x.text).slice(0, 10).join(' ')}）`);
    } else notes.push(`タイトル: ${w.map((x) => x.text).filter((x) => x.length > 2).slice(0, 10).join(' ')}`);
  } else notes.push(`コントローラーなし: ${pd.note}`);
  return notes;
}

// ---- the device made once ----
export async function prep({ data, img = R.GAPPS_TAG, shots } = {}) {
  const adb = adbOf(), res = {};
  R.sh('rm', ['-rf', data], { sudo: true, quiet: true }); R.sh('mkdir', ['-p', data], { sudo: true });
  res.first = await R.up({ data, image: img });
  R.notice('準備: 初回の起動', JSON.stringify(res.first));
  R.settle();
  await sleep(10_000);
  R.down({ quiet: true });
  const id = injectAccount(data);
  res.second = await R.up({ data, image: img });
  res.root = await root(adb);
  // (MindTheGapps' apps that only take CPU on this device, the background dexopt job, account sync: the game waits on the
  // 2 cores. Not Play, Play services, GSF)
  res.quiet = PF.quiet(adb, QUIET);
  res.accountS = await waitFor('アカウントの読み込み', () => hasAccount(adb.shell(['dumpsys', 'account'], { timeout: 20_000 }).stdout, process.env.GOOGLE_EMAIL), { timeoutMs: 120_000 });
  res.checkinS = await waitFor('Google への登録（checkin）', () => checkedIn(data), { timeoutMs: 15 * 60_000, every: 5000 });
  R.notice('準備: Google', `アカウントを accounts_de.db / accounts_ce.db に（_id ${id}）、読み込み ${res.accountS} 秒、checkin ${res.checkinS} 秒（2 回目の起動から）、${PF.quietNote(res.quiet)}、負荷 ${fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ')}`);
  const t0 = now();
  const page = await L.readPlayPage(adb, { pkg: PACKAGE, log: say, timeoutMs: 6 * 60_000 });
  R.notice('準備: Play のページ', `${page.action ?? 'ボタンなし'}「${page.label ?? ''}」（${page.via}）、画面: ${(page.texts ?? []).slice(0, 15).join(' / ').slice(0, 300)}`);
  if (!['install', 'update', 'open'].includes(page.action)) throw new Error(`Play がゲームのインストールを出しません（${page.action ?? page.label ?? 'ボタンなし'}）`);
  if (page.action !== 'open') await L.playInstall(adb, { pkg: PACKAGE, page, log: say, timeoutMs: 20 * 60_000 });
  res.installS = secs(now() - t0);
  const lf = L.licenseFacts(adb, { pkg: PACKAGE });
  // (compiled ahead, all of it: no JIT and no profile-guided compile in the CPU of every start from this /data. Android may
  // still hold the package frozen just after Play's install: tried again at the end then)
  res.compile = PF.compileGame(adb, PACKAGE);
  R.notice('準備: ゲーム', `Play が入れました（${res.installS} 秒）、${PF.compileNote(res.compile)}: ${lf.lines.slice(0, 3).join(' / ').slice(0, 400)}`);
  adb.shell(['pm', 'grant', PACKAGE, 'android.permission.POST_NOTIFICATIONS']);
  res.firstLaunch = await launchFresh(adb, { timeoutMs: 6 * 60_000, shots });
  const { why, ...fl } = res.firstLaunch;
  R.notice('準備: ゲームの初回の起動', JSON.stringify(fl));
  if (why) { R.notice('準備: タイトルに着かない（画面と端末）', `focus ${why.focus}、pid ${why.pid}、crash: ${why.crash.join(' / ').slice(0, 1500) || 'なし'}`); R.notice('準備: タイトルに着かない（logcat）', why.lines.join(' / ').slice(0, 3500) || 'なし'); }
  if (res.firstLaunch.license?.startsWith('no')) R.notice('準備: ライセンス', lf.lines.join(' / ').slice(0, 900));
  if (res.firstLaunch.titleS || res.firstLaunch.windowS) { res.finish = await finishGame(adb, { shots }); R.notice('準備: 仕上げ', res.finish.join('、')); }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `game_ok=${res.firstLaunch.titleS || res.firstLaunch.windowS ? 'true' : 'false'}\n`);
  await sleep(5000);   // (what the first start writes: options.txt, the content log switches)
  adb.shell(['am', 'force-stop', PACKAGE]);
  if (!res.compile.ok) { res.compile = PF.compileGame(adb, PACKAGE); R.notice('準備: ゲームのコンパイル（もう一度）', PF.compileNote(res.compile)); }
  R.down({ quiet: true });
  return res;
}

/** starts from the prepared folder, timed end to end: restore → boot → the game at its title. Each round's stages go to the
 *  timeline (timeline.jsonl, as they come: a round cut off keeps the ones before it); one table at the end sets this run
 *  against the last one and the median of the runs before */
export async function bench({ data, img = R.GAPPS_TAG, rounds = 3, shots, timeline = TL.FILE } = {}) {
  const adb = adbOf(), work = data + '.run', rows = [], run = new Date().toISOString();
  const load = () => { try { return Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return null; } };
  for (let i = 1; i <= rounds; i++) {
    const t0 = now(), l0 = load();
    const r = R.restore(data, 'overlay', work);
    const m = await R.up({ data: r.data, from: data, image: img, untilBoot: true });
    const g = await launch(adb, { shots: i === 1 ? shots : null, boost: true });
    const { why, ...gg } = g;
    const row = { round: i, restoreS: secs(r.ms), runS: m.runS, adbS: m.adbS, bootS: m.bootS, ...gg, totalS: g.titleS ? secs(now() - t0) : null };
    rows.push(row);
    R.notice(`起動からタイトルまで（${i} 回目）`, JSON.stringify(row));
    // the device kept up: the game alone again (what a second debug run on a resident device costs)
    const { why: _w, ...again } = await launch(adb, { boost: true });
    R.notice(`常駐の端末でゲームだけ起動し直す（${i} 回目）`, JSON.stringify(again));
    rows.push({ round: i, resident: true, ...again });
    TL.append(TL.entriesOf(rows.slice(-2), { run, at: new Date().toISOString(), load: l0 }), timeline);
    R.down({ quiet: true });
  }
  R.sh('umount', [path.join(work, 'merged')], { sudo: true, quiet: true });
  console.log(TL.table(TL.compare(TL.read(timeline), run)));
  return rows;
}

// ---- app/'s own run on this device (nothing of app/ changed: environment only) ----
/** the game's APKs as installed (base + splits) into dir: app run reads its version and CPU from them (never uploaded).
 *  aside: another version than dir's goes there instead, dir left as it is (app run may be reading it: debug swaps after) */
export function pullApks(adb, dir, { aside = null } = {}) {
  // (the same game as last time: what was pulled is still right — a resident device's second run skips the copy)
  const ver = adb.shell(['dumpsys', 'package', PACKAGE], { timeout: 30_000 }).stdout.match(/versionCode=(\d+)/)?.[1] ?? '';
  let mark = path.join(dir, '.version');
  const had = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.apk')) : [];
  if (ver && had.length && fs.existsSync(mark) && fs.readFileSync(mark, 'utf8').trim() === ver) return had;
  if (aside) { dir = aside; mark = path.join(dir, '.version'); }
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const paths = adb.shell(['pm', 'path', PACKAGE], { timeout: 30_000 }).stdout.split('\n').map((l) => /^package:(\S+\.apk)/.exec(l.trim())?.[1]).filter(Boolean);
  for (const p of paths) if (adb.run(['pull', p, path.join(dir, path.basename(p))], { timeout: 600_000 }).status !== 0) throw new Error(`APK を取り出せません: ${p}`);
  if (ver) fs.writeFileSync(mark, ver + '\n');
  return paths.map((p) => path.basename(p));
}
/** the docker bridge's address on the host: what the container reaches the host's BDS by. The game's LAN discovery
 *  broadcast does cross the bridge (seen: 172.17.0.2:7551 → 172.17.255.255:7551 every 2 s) but the BDS does not answer a
 *  broadcast there: app run's own reflector on the device sends it on as unicast to this address, as on the emulator */
export const bridgeIp = () => R.sh('docker', ['network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}'], { quiet: true }).stdout.trim() || '172.17.0.1';
// (app run starts at once, before the device: its BDS gets ready while the device is restored, boots and starts the game.
// It waits for the device's word in APP_DEVICE_READY_FILE (ready.mjs). The APKs pulled last time (apk/.version) tell it the
// game's version before the device can; checked on the device once it is up — another version: pulled aside (apk.new) while
// the first run may still read apk/, swapped in after it ends, app run again on them. APKs without a kept version tell nothing:
// as with none, app run waits for the device (APP_DEVICE_APKS_LATER) and reads them only after they are pulled again)
export async function debug({ data, img = R.GAPPS_TAG, addon = 'jsonui_demo', mode = 'run', shots, args = [], keep = false } = {}) {
  const adb = adbOf(), work = data + '.run', t0 = now();
  const apkDir = path.join(path.dirname(data), 'apk'), early = RD.lastApks(apkDir), readyFile = path.join(path.dirname(data), 'device-ready.json');
  const aside = early ? apkDir + '.new' : null, stale = !early && fs.existsSync(apkDir) && fs.readdirSync(apkDir).some((f) => f.endsWith('.apk'));
  if (aside) fs.rmSync(aside, { recursive: true, force: true });
  const env = { ...process.env, APP_SERIAL: adb.serial, APP_LIVE_DEVICE: '1', APP_APK_DIR: apkDir, APP_HOST: bridgeIp(), APP_SHOT: 'adb', APP_SNAPSHOT: '0' };
  for (const k of Object.keys(env)) if (/^GOOGLE_|^MS_/.test(k) || k === 'APP_DEVICE' || k === 'APP_DEVICE_APKS_LATER') delete env[k];
  // the LAN discovery on the bridge while the run goes (UDP 7551 both ways: does the game's broadcast reach the BDS, does the
  // BDS answer): what `report` tells. Its own process, stopped when the run ends
  const lan = path.join(path.dirname(data), 'lan.txt');
  R.sh('sh', ['-c', `(timeout 2400 tcpdump -lni docker0 -c 60 udp port 7551 > ${lan} 2>&1 &)`], { sudo: true, quiet: true });
  fs.rmSync(readyFile, { force: true });
  let t1 = now();
  // (app run's own lines as they come: its stages, a failing step, its PASS / FAIL line)
  const run = RD.startChild(process.execPath, [path.join(HERE, '..', '..', 'lab.mjs'), 'app', mode, '-a', addon, ...args], { timeoutMs: 40 * 60_000, env: { ...env, APP_DEVICE_READY_FILE: readyFile, ...(early ? {} : { APP_DEVICE_APKS_LATER: '1' }) } });
  say(`app ${mode} を先に始めました（BDS を用意しながら端末を待ちます。APK: ${early ? `前回取り出した版 ${early.version}` : stale ? '前回のものは版が分からないので端末から取り出し直してから' : 'まだ無いので端末から取り出してから'}）`);
  // a device `--keep` left up is used as it is (nothing restored or booted; the game started only when it is not running):
  // the second run on a resident device costs the game's start at most
  let ready, apks = [], failed = null, downOnFail = false;
  try {
    const resident = R.running({ from: data, image: img });
    if (resident) {
      await root(adb);
      // (running is not enough: a game a run left on another screen — a paywall, a stuck start — is started again; no OCR: as it is)
      const w = adb.pid(PACKAGE) > 0 ? words(adb) : [], atTitle = w === null || (w.length > 0 && isTitle(w));
      const g = atTitle ? {} : await launch(adb, { shots, boost: true });
      const { why, ...gg } = g;
      ready = { resident: true, game: atTitle ? '起動済み（タイトル）' : '起動しました', ...gg, totalS: secs(now() - t0) };
      if (!atTitle && !g.titleS && !g.windowS) { downOnFail = true; throw new Error(`常駐の端末でゲームがタイトルまで起動しません（${g.license?.startsWith('no') ? `ライセンス: ${g.license}` : g.words || g.am || '画面なし'}）: 端末を止めます`); }
      R.notice('デバッグできるまで（常駐の端末）', JSON.stringify(ready));
    } else {
      const r = R.restore(data, 'overlay', work);
      const m = await R.up({ data: r.data, from: data, image: img, untilBoot: true });
      await root(adb);
      const g = await launch(adb, { shots, boost: true });
      const { why, ...gg } = g;
      ready = { restoreS: secs(r.ms), bootS: m.bootS, ...gg, totalS: secs(now() - t0) };
      R.notice('デバッグできるまで（戻す → 起動 → タイトル）', JSON.stringify(ready));
      if (!g.titleS && !g.windowS) { downOnFail = true; throw new Error(`ゲームがタイトルまで起動しません（${g.license?.startsWith('no') ? `ライセンス: ${g.license}` : g.words || g.am || '画面なし'}）: node lab.mjs app redroid prep で端末を作り直してください`); }
    }
    live.ready = true;
    apks = pullApks(adb, apkDir, { aside });
  } catch (e) { failed = e; }
  // the device's word to app run: ready, or why not (app run stops its BDS then and ends with that reason). Another version
  // than early's is in apk.new (apk/ untouched while the first run may read it)
  const pulledAside = Boolean(aside && fs.existsSync(aside)), now1 = RD.lastApks(pulledAside ? aside : apkDir), changed = !failed && pulledAside;
  const why = failed ? redact(failed.message, SECRETS()) : changed ? `APK の版が変わりました（${early.version} → ${now1?.version || '?'}）: 取り出し直したもので app ${mode} をやり直します` : '';
  RD.writeReady(readyFile, { serial: adb.serial, ok: !why, why });
  const aheadS = secs(now() - t1);
  if (ready) ready.runAheadS = aheadS;
  if (failed) {
    say(`端末の準備に失敗しました: app ${mode} の終わり（BDS を止める）を待ちます`);
    await run.done;
    if (aside) fs.rmSync(aside, { recursive: true, force: true });
    // (a device that never got to its title is stopped even with --keep: kept, the next run would use it as it is)
    if (downOnFail) { R.down({ quiet: true }); R.sh('umount', [path.join(work, 'merged')], { sudo: true, quiet: true }); }
    throw failed;
  }
  // (another version: the first run ends on the word above; again on the APKs just pulled, the device up — waited as before)
  let res = await run.done;
  // (the first run has ended: nothing reads apk/ now — the APKs just pulled take its place)
  if (changed) {
    fs.rmSync(apkDir, { recursive: true, force: true }); fs.renameSync(aside, apkDir);
    t1 = now(); res = spawnSync(process.execPath, [path.join(HERE, '..', '..', 'lab.mjs'), 'app', mode, '-a', addon, ...args], { timeout: 40 * 60_000, stdio: ['ignore', 'inherit', 'inherit'], env });
  }
  const verdict = res.status === 0 ? 'PASS' : `FAIL（終了コード ${res.status ?? res.signal}）`;
  R.notice(`app ${mode} を redroid で`, `${verdict}（${secs(now() - t1)} 秒、${changed ? 'APK の版が変わったのでやり直し' : `端末の準備より ${aheadS} 秒先に開始（その間に BDS）`}、APK ${apks.length} 個、BDS は ${env.APP_HOST}、LAN の発見は app の中継 --reflect で）`);
  if (keep) say(`端末は動いたままです（${adb.serial}）。止める: node lab.mjs app redroid down`);
  else { R.down({ quiet: true }); R.sh('umount', [path.join(work, 'merged')], { sudo: true, quiet: true }); }
  return { ready, run: { status: res.status ?? 1, verdict, s: secs(now() - t1) } };
}

// ---- the prepared device kept between CI jobs: app's own vault (AES-256-GCM, the key from APP_CACHE_KEY or GOOGLE_AAS_TOKEN;
// in GitHub Actions only for a private repository). Root's work: /data is Android's uids (sudo -E node … seal / open) ----
export const VAULT_TAR = ['--xattrs', '--xattrs-include=*', '--numeric-owner'];
/** data + what prep found (game-prep.json: doctor's "prepared") → one sealed file → {bytes, comp} | {skipped: why} */
export async function sealData({ data, file }) {
  const allowed = V.vaultAllowed(), key = V.vaultKey();
  if (!allowed.ok) return { skipped: allowed.why };
  if (!key) return { skipped: 'APP_CACHE_KEY か GOOGLE_AAS_TOKEN が要ります（鍵）' };
  const prep = path.join(LAB, 'game-prep.json');
  if (!fs.existsSync(prep)) return { skipped: 'まだ prep していません' };
  fs.copyFileSync(prep, path.join(path.dirname(data), 'game-prep.json'));
  return V.seal({ base: path.dirname(data), entries: [path.basename(data), 'game-prep.json'], outFile: file, key, tarArgs: VAULT_TAR });
}
/** the sealed file → data (replaced whole only when all of it decrypted) and game-prep.json back → true | false */
export async function openData({ data, file }) {
  const key = V.vaultKey();
  if (!V.vaultAllowed().ok || !key || !fs.existsSync(file)) return false;
  const dest = path.dirname(data);
  if (!(await V.open({ inFile: file, dest, key, log: say, tarArgs: VAULT_TAR }))) return false;
  const kept = path.join(dest, 'game-prep.json');
  if (fs.existsSync(kept)) { fs.mkdirSync(LAB, { recursive: true }); fs.copyFileSync(kept, path.join(LAB, 'game-prep.json')); }
  return R.sh('test', ['-d', path.join(data, 'app')], { sudo: true, quiet: true }).status === 0;
}

/** the newest app run's report, as notices (a step of its own: GitHub keeps only 10 notices per step, and app run uses most) */
export function report() {
  const runs = path.join(HERE, '..', 'runs'), last = fs.existsSync(runs) ? fs.readdirSync(runs).filter((d) => fs.existsSync(path.join(runs, d, 'report.md'))).sort().pop() : null;
  if (!last) { R.notice('app run の報告', 'ありません'); return null; }
  const md = fs.readFileSync(path.join(runs, last, 'report.md'), 'utf8').split('\n').filter((l) => l.trim());
  const bad = md.filter((l) => /✘|⚠|失敗|FAIL|理由|次:|E /.test(l));
  R.notice('app run の報告（頭）', md.slice(0, 30).join(' / ').slice(0, 3800));
  if (bad.length) R.notice('app run の報告（失敗と注意）', bad.slice(0, 40).join(' / ').slice(0, 3800));
  const lan = process.env.REDROID_LAN_FILE;
  if (lan) { R.sh('pkill', ['tcpdump'], { sudo: true, quiet: true }); const t = R.sh('cat', [lan], { sudo: true, quiet: true }).stdout.trim().split('\n'); R.notice('LAN の発見（ブリッジの UDP 7551）', `${t.filter((l) => /UDP|udp/.test(l)).length} 個: ${t.slice(0, 16).join(' / ').slice(0, 3000) || 'なし'}`); }
  const runTxt = path.join(runs, last, 'run.txt');
  if (fs.existsSync(runTxt)) R.notice('app run の手順（最後）', fs.readFileSync(runTxt, 'utf8').split('\n').filter((l) => l.trim()).slice(-30).join(' / ').slice(0, 3800));
  return last;
}

// (everything after a lone -- goes to app run / app ui as it is: --scenario, --screens, --all, --bds, -v …)
function opts(args) {
  const o = { _: [], pass: [] }, cut = args.indexOf('--');
  if (cut >= 0) { o.pass = args.slice(cut + 1); args = args.slice(0, cut); }
  for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('--')) o._.push(args[i]); else if (args[i + 1] === undefined || args[i + 1].startsWith('--')) o[args[i].slice(2)] = true; else o[args[i].slice(2)] = args[++i]; }
  return o;
}
// (the commands that start or stop the device: one at a time, and stopped cleanly when interrupted — Ctrl+C or the job's end:
// the container down and the overlay unmounted, unless --keep asked the device to stay)
const OWNS_DEVICE = ['prep', 'bench', 'debug'];
async function main([cmd, ...rest]) {
  const o = opts(rest), data = path.resolve(typeof o.data === 'string' ? o.data : path.join(LAB, 'data')), img = typeof o.image === 'string' ? o.image : R.GAPPS_TAG;
  if (OWNS_DEVICE.includes(cmd)) {
    const release = R.lock(cmd);
    process.on('exit', release);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
      // (--keep keeps only a device that got to the game's title: one stopped mid-start would be taken as ready next time)
      const stay = o.keep === true && (cmd !== 'debug' || live.ready);
      say(`止めます（${sig}）${stay ? ': 端末は動いたまま' : ': 端末を止めます'}`);
      if (live.boost) try { adbOf().run(live.boost.plan.restore, { timeout: 15_000 }); } catch { /* the device may be gone */ }
      if (!stay) { R.down({ quiet: true }); R.sh('umount', [path.join(data + '.run', 'merged')], { sudo: true, quiet: true }); }
      release(); process.exit(130);
    });
  }
  const shots = typeof o.shots === 'string' ? path.resolve(o.shots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let res;
  if (cmd === 'prep') res = await prep({ data, img, shots });
  else if (cmd === 'bench') res = await bench({ data, img, rounds: Number(o.rounds) || 3, shots });
  else if (cmd === 'debug') { res = await debug({ data, img, addon: typeof o.addon === 'string' ? o.addon : 'jsonui_demo', mode: o.mode === 'ui' ? 'ui' : 'run', shots, args: o.pass, keep: o.keep === true }); process.exitCode = res.run.status ? 1 : 0; }
  else if (cmd === 'report') res = report();
  else if (cmd === 'seal') { const file = path.resolve(typeof o.file === 'string' ? o.file : path.join(LAB, 'data.bin')); res = await sealData({ data, file }); R.notice('準備済みの端末をキャッシュへ', res.skipped ? `しません: ${res.skipped}` : `${Math.round(res.bytes / 1e6)} MB（${res.comp}、暗号化）`); }
  else if (cmd === 'open') {
    const file = path.resolve(typeof o.file === 'string' ? o.file : path.join(LAB, 'data.bin')), ok = await openData({ data, file });
    res = { opened: ok };
    R.notice('準備済みの端末をキャッシュから', ok ? '戻しました（prep は飛ばします）' : 'ありません・開けません（prep で作ります）');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `opened=${ok}\ngame_ok=${ok}\n`);
  }
  else if (cmd === 'launch') res = await launch(adbOf(Number(o.port) || R.PORT), { shots });
  else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); return; }
  fs.mkdirSync(LAB, { recursive: true });
  fs.writeFileSync(path.join(LAB, `game-${cmd}.json`), JSON.stringify(res, null, 2) + '\n');
  if (cmd !== 'debug') say(JSON.stringify(res, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { const m = redact(e.message, SECRETS()); console.error(`E ${m}`); if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=redroid game::${m.replace(/\r?\n/g, ' ')}`); process.exit(1); });
}
