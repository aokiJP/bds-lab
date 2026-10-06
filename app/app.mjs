// app lab: the real Minecraft app (the APK from Google Play) on an Android emulator, joined straight into the lab's own BDS
// running an addon; screenshots of what the app draws (the addon's JSON UI) + logs. Everything lives in this repository.
// Entry: node lab.mjs app <cmd>. Usage: app/README.md (people), app/AGENTS.md (AIs), `node lab.mjs app help`.
//
// Design rules
//   - one command does it all (`run`); every other command is a piece of it, for when a person wants to go step by step
//   - every failure says what happened AND the next thing to do (AppError(message, hint)); nothing ends in a stack trace
//   - `run` always cleans up (logcat, the BDS, the emulator it started) and always writes a report, even when it stops early
//     or is interrupted (Ctrl+C)
//   - the Google secrets are read from the environment or .env.local and handed to apkeep only (0600 ini); no child
//     process (adb, emulator, BDS, sdkmanager) gets them; the run folder is checked (guard) before anything uploads it.
//     The one exception, asked for by name (`account`, `run --account`): the token goes onto the emulator itself, on
//     sqlite3's stdin (never a command line), as the account's password in Android's account database (lib/account.mjs)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as K from './lib/apk.mjs';
import * as D from './lib/android.mjs';
import { parseScenario, runScenario, dialogSummary, KEYS, pngSize, screenDiff, titleLike, blankScreen } from './lib/scenario.mjs';
import { startMonitor, fmtStats, hostNotes, hostStats } from './lib/host.mjs';
import { annotations, deathExcerpt, ghEscape, guard, logcatDigest, writeReport } from './lib/report.mjs';
import * as A from './lib/account.mjs';
import * as G from './lib/ghresults.mjs';
import * as V from './lib/vault.mjs';
import * as W from './lib/warm.mjs';
import * as C from './lib/client.mjs';
import * as U from './lib/uicatalog.mjs';
import * as L from './lib/license.mjs';
import * as Live from './lib/live.mjs';
import * as SI from './lib/signin.mjs';
import * as WD from './lib/world.mjs';
import { gridOverlay } from './lib/screen.mjs';
import { autoOauthToken, browserCandidates, canShowWindow } from './lib/login.mjs';
import { playwrightOauthToken } from './lib/playwright-login.mjs';

const APPDIR = path.dirname(fileURLToPath(import.meta.url)), TOP = path.dirname(APPDIR);
const LAB = path.join(APPDIR, '.lab'), APKDIR = path.join(LAB, 'apk'), RUNS = path.join(APPDIR, 'runs');
const ENV_FILE = path.join(TOP, '.env.local');
const BDS_LAB = process.env.APP_BDS_LAB || path.join(TOP, 'bds', 'lab.mjs');
const BDS_DIR = path.dirname(BDS_LAB), BDS_LIVE = path.join(BDS_DIR, '.lab', 'live.json');
const ADDONS = path.join(TOP, 'bds', 'addons');
const MEMO = path.join(LAB, 'apk.json'), LOCK = path.join(LAB, 'run.lock'), PREP_LOG = path.join(LAB, 'prepare.txt');

K.loadEnv([process.env.APP_ENV_FILE, ENV_FILE, path.join(APPDIR, '.env.local'), path.join(TOP, '.env')]);

// (the last lines said are kept: in GitHub Actions a failing command puts them in an annotation, readable through the API)
const SAID = [];
let TEE = null;   // (prepare: every line also into app/.lab/prepare.txt, which the next run's report carries)
let PREP_MON = null;   // (prepare: the machine sampled into app/.lab/prepare-host.txt while the device is made)
const out = (s = '') => { SAID.push(String(s)); if (SAID.length > 60) SAID.shift(); process.stdout.write(s + '\n'); TEE?.(String(s)); };
// APP_TIME_SCALE (0..1, tests on the fake device): every fixed pause shorter; deadlines stay in real time
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (Math.min(1, Math.max(0, Number(process.env.APP_TIME_SCALE) || 1)))));
const rel = (f) => { try { return path.relative(process.cwd(), f).split(path.sep).join('/') || '.'; } catch { return f; } };
const fail = (message, hint) => { throw new K.AppError(message, hint); };
const alivePid = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// ---- arguments: known flags and options only (a typo is an error, not silently ignored) ----
// (multi: options that may come more than once, each value kept in o.multi[name])
function parse(args, { flags = [], opts = [], multi = [] } = {}) {
  const o = { flags: new Set(), opts: {}, multi: {}, rest: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (flags.includes(a)) o.flags.add(a);
    else if (opts.includes(a) || multi.includes(a)) { const v = args[++i]; if (v === undefined || (v.startsWith('-') && !/^-?\d/.test(v))) fail(`${a} の後ろに値が要ります`, `例: ${a} ${a === '-a' ? 'jsonui_demo' : '…'}`); if (multi.includes(a)) (o.multi[a] ??= []).push(v); else o.opts[a] = v; }
    else if (a.startsWith('-') && !/^-?\d/.test(a)) fail(`知らないオプション ${a}`, `使えるもの: ${[...flags, ...opts, ...multi].join(' ') || 'なし'}（node lab.mjs app help）`);
    else o.rest.push(a);
  }
  return o;
}

const SCENARIO_HELP = fs.readFileSync(path.join(APPDIR, 'lib', 'scenario.mjs'), 'utf8').split('\n').filter((l) => /^\/\/ {3}/.test(l)).map((l) => '  ' + l.slice(5)).join('\n');
const HELP = `app: 本物の Minecraft アプリをエミュレータで動かし、ラボの BDS に参加させて、画面（JSON UI）とログを残す

はじめて:     node lab.mjs app            いまの状態と、次にやることを表示
              node lab.mjs app setup      足りないものを順に用意（対話）
いつも:       node lab.mjs app run -a <アドオン>
              → app/runs/<日時>-<アドオン>/index.html（スクショ）と report.md

  run [-a <アドオン>] [--scenario <ファイル>] [--apk <フォルダ>] [--bds auto|keep|<版>] [--no-fetch] [--wipe] [--window] [--keep] [-v]
      [--account [--vending <apk>]]
        全部: APK → エミュレータ → インストール → BDS → 参加 → 撮影 → 報告
        --account: インストールの後に Google アカウントをエミュレータへ書き込む（下の account）
        --keep: 終わっても BDS とエミュレータを動かしたまま（続けて screen / tap で調べるとき）  -v: 各手順も画面に（普段は run.txt だけ）
  ui -a <アドオン> [--all] [--screens <id,id>] [--shard k/n] [--sizes 1024x768,…] [--cutouts tall,…] [--list] [--allow-client-errors]
        JSON UI の画面を本物のアプリで全部開いて撮る（アドオンの rp/ui → それを描く画面。--all = ラボが開ける画面すべて）。画面ごとに
        ゲームのコンテンツログ（クライアントだけのエラー）を読み、ERROR があれば失敗。--sizes / --cutouts: ほかの画面の形（比率・
        ノッチ）でも全部もう一度（GitHub ではつまみ APP_UI_SIZES / APP_UI_CUTOUTS）
  prepare [--account] [--force] [--no-device] [--no-bds]   準備済みの端末（ゲームがタイトル画面で起動済みのスナップショット）を作る /
        キャッシュから戻す。ライセンス確認で止まったら、端末が知っていることを license.txt に書き、Play のページを読んで入れ直させる
  keys [--account]           （ワークフローの中で）Play がいま配っている版と、キャッシュの名前
  init -a <アドオン>          そのアドオンに app.txt（手順）の雛形を作る
  token [--email <アドレス>] [--manual] [--headless]   ブラウザでログインするだけで AAS トークンを自動で作り .env.local に保存（一度だけ。
        GOOGLE_EMAIL / GOOGLE_PASSWORD が .env にあれば自動で入力。node lab.mjs login google と同じ）
  apk fetch [--accept-tos]   Google Play から APK を取る          apk <フォルダ>   スマホから取り出した APK を使う
  apk info                   手元の APK の版
  emu [--window] [--wipe] [--no-wait] [--writable-system] [--gpu host]   エミュレータを起動            emu stop   止める
        重いとき（「応答なし」が出る）: APP_SCREEN=720x1560（画面を小さく）、APP_CORES、APP_RAM。x86_64 版の APK（apk fetch が先に試す）
  account [--vending <apk>]   AAS トークンを Google アカウントとして、起動中のエミュレータのアカウント情報へ直接書き込む（root、
        Google の公式の手順ではない）。--vending（APP_VENDING_APK、または APP_VENDING_URL + APP_VENDING_SHA256）: Play ストアを
        system のアプリとして先に入れる（emu --writable-system で起動しておく）     account check   いまの状態（値は出さない）
  screen [名前]              いまの画面を撮り、tap の位置を読む格子付きの画像も作る
  tap <x> <y> | key <キー> | text <文字>   いまの画面を操作（位置を試すとき）
  install                    起動中のエミュレータに APK を入れる
  secrets [--repo <owner/名前>] [--env <Environment>] [--from <.env.local>]   GitHub に Google の認証を登録（gh）
  guard [フォルダ]           そのフォルダに APK・.so・トークンが無いか
  run / ui … --device redroid   エミュレータの代わりに redroid（コンテナの Android、VM なし）で。準備: node lab.mjs app redroid help
  redroid doctor|setup|prep|run|ui|up|down|bench|report   redroid の端末（Linux: docker と binder）
  ci … --device redroid [--mode run|ui] [--bench] [--keep] [--fresh] [--wait]   GitHub の redroid ワークフローで（private なら準備済みの
        端末を暗号化キャッシュから。--keep: 作った端末をキャッシュへ、--fresh: 作り直す）。ci watch|fetch <番号> --device redroid
  ci [-a <アドオン>] [--ref <枝>] [--account] [--scenario <ファイル>] [--bds <版>] [--screen <幅x高さ>]
        GitHub の app ワークフローを起動して、待たずに戻る（実行はいくつでも同時に走る）。--wait: 終わるまで待って、結果を
        app/runs/gh-<番号>/ に取ってくる（報告・ログ・スクショ。成果物を開けなくても API だけで読める。実行ごと止められて成果物が
        無いときは、どこで・どう止まったかを explain.txt に）。ci watch <番号> = 待って取る、ci fetch <番号> = 取るだけ（gh が要る）。
        --mode run|ui|ui-all --devices 1-8|auto（auto: ui / ui-all は 4 台で画面を分ける）--fresh
        --knobs "APP_X=1 APP_Y=b": ラボの設定。--try "APP_X=1" --try "APP_X=2" …: 設定違いを 1 本ずつ、同時に（8 本まで）
        --lane <名前>: 同じ名前の実行は順番に（既定は 1 本ずつ別の列: 並行）
        --hold <分>: 端末を作った後（失敗しても）・確かめた後、端末を動かしたまま命令を待つ（下の live）
  live [--run <番号>] "<コマンド>" …   --hold で待っている CI の端末を、コードを変えずにその場でさわる（返事と画面が数秒で
        戻る。画面は app/runs/live/）。--wait: 待つ状態になるまで待つ。コマンド: live help（screen tap key text sh logcat
        input windows fps gpu launch kill options title seal stop）。seal: いまの状態を準備済みの端末としてキャッシュへ
  hold [--minutes <分>]      （ワークフローの中で）端末を動かしたまま live の命令を待つ
  checks [--artifact <名前>]  （ワークフローの中で）実行の結果をチェック（check run）として出す。--print で中身の大きさだけ
  vending [--cleanup]         本物の Play ストアを、Google の「Google Play 入り」エミュレータイメージから取り出す（2 台目の AVD を一度だけ
        起動、root 不要）。app/.lab/vending/ に置き、--account が使う。--cleanup: 使ったイメージと AVD を消す（CI のディスク）
  annotate [フォルダ]        いちばん新しい実行を GitHub の注釈として出す（報告・run.txt・logcat の要約・画面の文字。成果物を開けなくても API で読める）

app.txt の手順（アドオンの app.txt、無ければ app/scenarios/default.txt）:
${SCENARIO_HELP}`;

// ---- small interactive prompt (hidden input for secrets): common/secrets.mjs ask, which also stops cleanly after Ctrl-C ----
async function ask(q, opts = {}) {
  if (!process.stdin.isTTY && !process.env.LAB_ASK_FILE) fail('ここでは入力を受け取れません（端末から実行してください）', 'CI では Secrets に GOOGLE_EMAIL / GOOGLE_AAS_TOKEN を置きます（node lab.mjs app secrets）。');
  return (await import('../common/secrets.mjs')).ask(q, opts);
}
const yes = async (q) => /^(y|yes|はい|)$/i.test(await ask(`${q} [Y/n] `));

// ---- the APK set ----
function apkPaths() {
  let dir = process.env.APP_APK_DIR || readJson(MEMO)?.dir;
  if (!dir && fs.existsSync(path.join(APKDIR, 'download'))) dir = path.join(APKDIR, 'download');
  if (!dir || !fs.existsSync(dir)) return null;
  const list = fs.statSync(dir).isFile() ? [dir] : K.listApks(dir);
  return list.length ? list : null;
}
function apkUse(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) fail(`${p} がありません`, 'APK の入ったフォルダを指定してください（base.apk と split_config.arm64_v8a.apk など）。');
  const list = fs.statSync(abs).isFile() ? [abs] : K.listApks(abs);
  if (!list.length) fail(`${p} に .apk がありません`, 'スマホからの取り出し方は app/README.md の「APK を用意する」にあります。');
  const info = K.inspectApks(list);
  fs.mkdirSync(LAB, { recursive: true }); fs.writeFileSync(MEMO, JSON.stringify({ dir: abs, at: Date.now() }));
  return info;
}
async function apkFetch({ acceptTos = false } = {}) {
  const r = await K.fetchApk({ apkDir: APKDIR, toolsDir: path.join(LAB, 'tools'), acceptTos });
  fs.mkdirSync(LAB, { recursive: true }); fs.writeFileSync(MEMO, JSON.stringify({ dir: r.dir, at: Date.now() }));
  return { ...K.inspectApks(r.apks), dir: r.dir };
}
async function apkCmd(args) {
  const o = parse(args, { flags: ['--accept-tos'] });
  const sub = o.rest[0];
  if (sub === 'fetch') {
    out('Google Play から Minecraft を取得します（1 GB 前後、数分かかります）');
    const info = await apkFetch({ acceptTos: o.flags.has('--accept-tos') });
    out(`OK ${info.versionName} (${info.versionCode}) → ${rel(info.dir)}`);
    out('   APK は git にも zip にも入りません（app/.lab は管理外）。次: node lab.mjs app run -a <アドオン>');
    return;
  }
  if (!sub || sub === 'info') {
    const list = apkPaths() ?? fail('APK がまだありません', '`node lab.mjs app apk fetch`（Google Play から）か `node lab.mjs app apk <フォルダ>`（スマホから取り出したもの）');
    const info = K.inspectApks(list);
    for (const a of info.apks) out(`  ${path.basename(a.path).padEnd(40)} ${a.split ? `分割 ${a.split}` : '本体'}`);
    out(`OK ${info.versionName} (${info.versionCode}) ABI ${info.abis.join(',')}`);
    return;
  }
  const info = apkUse(sub);
  out(`OK ${info.versionName} (${info.versionCode}) ABI ${info.abis.join(',')} — 次から ${rel(path.resolve(sub))} を使います`);
}

// ---- token: the one-time Google login value → an AAS token in .env.local ----
async function tokenCmd(args) {
  const o = parse(args, { flags: ['--manual', '--headless', '--force'], opts: ['--email'] });
  const cur = K.playCredentials();
  if (cur.ready && !o.flags.has('--force')) { out(`OK もう作ってあります（${cur.email}）。作り直すなら --force`); return; }
  let email = o.opts['--email'] || process.env.APP_TOKEN_EMAIL || cur.email || '';
  // the address and password written down in .env / .env.local (or asked here once) are typed into Google's page for the person
  const S = await import('../common/secrets.mjs');
  const headless = o.flags.has('--headless') || (!canShowWindow() && process.env.APP_LOGIN_HEADLESS !== '0');
  let password = S.readSecret(TOP, 'GOOGLE_PASSWORD');
  email ||= S.readSecret(TOP, 'GOOGLE_EMAIL');
  if (!o.flags.has('--manual') && S.canAsk() && !(email && password)) {
    // the address first: the password alone cannot be typed in for the person (Google asks for the address first), so it is
    // asked only once there is an address; a typo in the address is caught here, not on Google's page
    out('Minecraft を買った Google アカウントで、ラボがログイン画面に入力します（このPCのブラウザの中だけ。ほかへは送りません）。');
    if (!email) out('  アドレスを Enter だけにすると、ブラウザで自分で入力します。');
    for (let n = 0; !email && n < 3; n++) {
      const a = (await S.ask('  メールアドレス: ')).trim();
      if (!a) break;
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) email = a; else out(`  「${a}」はメールアドレスの形ではありません（例 name@gmail.com）`);
    }
    if (email && !password) password = await S.ask(`  ${email} のパスワード（表示されません。Enter でブラウザで入力）: `, { secret: true });
    if (email && await S.yes(`  次から聞かないように .env.local（このPCだけ。git・zip に入らない）に保存しますか？（${password ? 'アドレスとパスワード' : 'アドレス'}）`, false)) S.saveLocal(TOP, { GOOGLE_EMAIL: email, ...(password ? { GOOGLE_PASSWORD: password } : {}) });
  }
  let oauthToken = null;
  const manual = o.flags.has('--manual') || process.env.APP_TOKEN_MANUAL === '1';
  // no screen, no address+password and nobody at the keyboard: a hidden browser would wait for a sign-in no one can type
  if (!manual && headless && !(email && password) && !process.stdin.isTTY) fail('画面も端末も無く、GOOGLE_EMAIL と GOOGLE_PASSWORD も無いので、ログインできる人がいません', '.env に GOOGLE_EMAIL / GOOGLE_PASSWORD を書くか、ブラウザを開ける PC で node lab.mjs app token（または --manual）');
  const onInt = () => { out('\n中断しました（node lab.mjs app token でやり直せます）'); process.exit(130); };
  process.on('SIGINT', onInt);
  if (!manual) {
    // the openAdapter way: a visible browser driven by Playwright; the person only signs in (lib/playwright-login.mjs).
    // Without Playwright (no npm / network): the installed browser over its DevTools port (lib/login.mjs)
    out(email && password ? 'Google にログインしてトークンを受け取ります（全自動。確認コードを聞かれたときだけ、その画面か、ここで答えてください）。'
      : 'ブラウザで Google のログイン画面を開きます。ログインだけしてください。ボタン押しと受け取りは自動で、終わるとブラウザを閉じます（記録も消します）。');
    const cacheDir = path.join(LAB, 'browser');
    // (APP_LOGIN=cdp: straight to the installed browser over DevTools, no Playwright; the offline tests use it)
    try { if (process.env.APP_LOGIN === 'cdp') throw new K.AppError('APP_LOGIN=cdp'); const r = await playwrightOauthToken({ cacheDir, log: out, email, password, totpSecret: S.readSecret(TOP, 'GOOGLE_TOTP_SECRET'), headless, askCode: (q, secret) => S.ask(q, { secret }) }); oauthToken = r.oauthToken; email ||= r.email ?? ''; }
    catch (e) {
      if (!(e instanceof K.AppError)) throw e;
      if (/窓を出せません|閉じられました|待ちましたが/.test(e.message)) { if (!process.stdin.isTTY) throw e; out(`W ${e.message}`); }
      else {
        out(`W Playwright では開けませんでした: ${e.message}。インストール済みのブラウザで試します`);
        try { oauthToken = await autoOauthToken({ cacheDir, log: out }); }
        catch (e2) { if (!(e2 instanceof K.AppError) || !process.stdin.isTTY) throw e2; out(`W 自動では受け取れませんでした: ${e2.message}`); }
      }
    }
    if (!oauthToken) out('  手で貼る方法に切り替えます。');
  }
  if (!oauthToken) {
    out([
      '',
      '  1. ブラウザで https://accounts.google.com/EmbeddedSetup を開く',
      '  2. 開発者ツールを開く（Windows / Linux: F12 / Mac: ⌥⌘I）',
      '  3. Minecraft を買った Google アカウントでログインし、「同意する」を押す',
      '  4. 開発者ツールの「アプリケーション」（Application）→ Cookie → accounts.google.com の oauth_token の値をコピー',
      '     （oauth2_4/ で始まる長い文字列。一度しか使えず、数分で切れます）',
      '',
    ].join('\n'));
    oauthToken = await ask('oauth_token（貼っても表示されません）: ', { secret: true });
  }
  process.off('SIGINT', onInt);
  if (!email) email = await ask(`ログインした Google アカウントのメールアドレス${cur.email ? `（Enter で ${cur.email}）` : ''}: `, { fallback: cur.email ?? '' });
  out('  トークンに換えています…');
  const aas = await K.exchangeToken({ toolsDir: path.join(LAB, 'tools'), email, oauthToken, log: (s) => out(s) });
  K.saveEnv(ENV_FILE, { GOOGLE_EMAIL: email, GOOGLE_AAS_TOKEN: aas });
  process.env.GOOGLE_EMAIL = email; process.env.GOOGLE_AAS_TOKEN = aas;
  out(`OK ${rel(ENV_FILE)} に保存しました（自分だけが読める設定。git にも zip にも入りません）`);
  out('   次: node lab.mjs app apk fetch      GitHub でも使うなら: node lab.mjs app secrets');
}

// ---- the emulator ----
function emulatorRunning() { const j = readJson(path.join(LAB, 'emulator.json')); return Boolean(j?.pid && alivePid(j.pid)); }
function adbReady() { const t = D.tools(); return t.adb ? new D.Adb({ bin: t.adb }) : null; }
/** the emulator's process ended (a crash, or the machine's kernel took it for memory): an error that says what the emulator
 *  and the machine said last; null while it runs */
function emulatorGone(adb) {
  if (adb?.run(['get-state'], { timeout: 5000 }).stdout.trim() === 'device' || !readJson(path.join(LAB, 'emulator.json')) || emulatorRunning()) return null;
  let tail = ''; try { tail = fs.readFileSync(path.join(LAB, 'emulator.log'), 'utf8').trim().split('\n').slice(-6).join('\n'); } catch { /* none */ }
  const oom = process.platform === 'linux' ? (spawnSync('sh', ['-c', 'sudo -n dmesg 2>/dev/null | grep -i -E "out of memory|oom-kill|killed process" | tail -3'], { encoding: 'utf8', timeout: 10_000 }).stdout ?? '').trim() : '';
  return new K.AppError('エミュレータが止まりました（プロセスが終わっています）', [oom ? `カーネルのメモリ不足の記録: ${oom}（APP_RAM を減らす・APP_SCREEN を小さく）` : 'カーネルにメモリ不足の記録はありません（エミュレータ自身が落ちた？）', `いまのパソコン: ${fmtStats(hostStats({ dir: LAB }))}`, tail ? `emulator.log の最後:\n${tail}` : ''].filter(Boolean).join('\n'));
}
// the snapshot `app prepare` made (the game on its title screen: lib/warm.mjs), when it fits: the same APK (Play's
// current one in CI: APP_PLAY_CODE, else the local APK), emulator, system image, cores, RAM, screen, GPU, account mode.
// → {stamp, diff}: diff [] = usable. null = there is none, or it is not wanted (--wipe, APP_SNAPSHOT=0)
function readySnapshot({ list = apkPaths(), account = false, wipe = false } = {}) {
  if (wipe || process.env.APP_SNAPSHOT === '0') return null;
  const stamp = W.readStamp();
  if (!stamp) return null;
  let code = Number(process.env.APP_PLAY_CODE) || null;
  if (!code && list) try { code = K.inspectApks(list).versionCode; } catch { /* unreadable: any */ }
  return { stamp, diff: W.stampDiff(stamp, W.wantStamp({ apkCode: code, account: account || stamp.account })) };
}
const vendingOn = () => process.env.APP_VENDING !== '0';
// the running emulator was started from the snapshot (by this run or by `app emu --no-wait` before it)
const fromSnapshot = () => (readJson(path.join(LAB, 'emulator.json'))?.args ?? []).includes('-snapshot');
// started = this call started it (so `run` stops it at the end); noWait = start and return (app.yml starts it while the BDS
// gets ready). ready: readySnapshot() → start from that snapshot (seconds, the game already up) instead of booting
async function ensureEmulator({ window = false, wipe = false, writableSystem = false, gpu, noWait = false, ready = null, log = out } = {}) {
  const a0 = adbReady();
  if (a0?.booted()) return { adb: a0, started: false, warm: fromSnapshot() };
  let started = false, warm = false;
  if (!emulatorRunning()) {
    if (process.platform === 'linux' && !D.kvmOk() && !process.env.APP_EMULATOR) log('W /dev/kvm が使えません: エミュレータがとても遅くなります（直し方: node lab.mjs app）');
    D.ensureAvd({ log, gpu });
    warm = Boolean(ready && !ready.diff.length);
    if (ready?.diff.length) log(`  準備済みの状態は使えません（違い: ${ready.diff.join(', ')}）: 普通に起動します（作り直すなら node lab.mjs app prepare）`);
    const ws = warm ? Boolean(ready.stamp.writable) : writableSystem;
    log(warm ? `エミュレータを準備済みの状態（${W.SNAPSHOT}: Minecraft ${ready.stamp.versionName ?? ''} のタイトル画面）から起動します`
      : `エミュレータを起動します（${D.sysImage()}${window ? '、画面あり' : ''}${ws ? '、/system 書き込み可' : ''}）`);
    D.startEmulator({ labDir: LAB, window, wipe: warm ? false : wipe, writableSystem: ws, gpu, snapshot: warm ? W.SNAPSHOT : null, log });
    started = true;
  } else warm = fromSnapshot();
  const a = adbReady() ?? fail('adb がありません', 'node lab.mjs app emu がもう一度 Android SDK の platform-tools を入れます。');
  if (noWait) return { adb: a, started, warm };
  spawnSync(a.bin, ['start-server'], { timeout: 30_000, env: K.cleanEnv() });
  log(warm ? '戻るのを待っています' : '起動を待っています（初回は 5〜10 分かかることがあります）');
  await D.waitBoot(a, { log, warm });
  return { adb: a, started, warm };
}
async function emuCmd(args) {
  const o = parse(args, { flags: ['--window', '--wipe', '--no-wait', '--writable-system'], opts: ['--gpu'] });
  if (o.rest[0] === 'stop') { await D.stopEmulator(adbReady(), LAB); out('OK 止めました'); return; }
  if (o.rest.length) fail(`知らない指定 ${o.rest.join(' ')}`, 'node lab.mjs app emu [--window] [--wipe] [--no-wait]  /  node lab.mjs app emu stop');
  const r = await ensureEmulator({ window: o.flags.has('--window'), wipe: o.flags.has('--wipe'), writableSystem: o.flags.has('--writable-system'), noWait: o.flags.has('--no-wait'), gpu: o.opts['--gpu'] });
  if (o.flags.has('--no-wait')) { out('OK 裏で起動中です（app run が起動を待ちます）'); return; }
  out(`OK ${r.adb.serial} Android ${r.adb.prop('ro.build.version.release')}（${r.adb.prop('ro.product.cpu.abilist')}）  止める: node lab.mjs app emu stop`);
}
function install(adb, list, info, log = out) {
  const cur = adb.installed();
  if (cur && cur.versionCode === info.versionCode) { log(`インストール済み ${cur.versionName}`); return false; }
  const abis = adb.prop('ro.product.cpu.abilist').split(',').filter(Boolean);
  if (abis.length && !info.abis.some((a) => abis.includes(a))) log(`W この端末の ABI（${abis.join(',')}）に APK の ABI（${info.abis.join(',')}）がありません。入らないときは APP_SYSIMG で Android 11 以降の Google APIs イメージを使ってください`);
  log(`インストールしています ${info.versionName}（${list.length} 個、数分かかります）`);
  adb.install(list);
  return true;
}
// ---- account: the AAS token as the emulator's Google account (lib/account.mjs) ----
// the Play Store goes in with the account unless APP_VENDING=0 (a given APK, or else Google Play's own): /system must be writable
const vendingWanted = (file) => Boolean(file || process.env.APP_VENDING_APK || process.env.APP_VENDING_URL) || process.env.APP_VENDING !== '0';
async function setupAccount(adb, { vending, log = out } = {}) {
  const c = K.playCredentials();
  if (!c.ready) fail(c.problems.join(' / ') || 'GOOGLE_EMAIL / GOOGLE_AAS_TOKEN がありません', 'まず node lab.mjs app token（GitHub では Secrets と、ワークフローの入力 account）');
  let apk = await A.vendingApk({ file: vending || process.env.APP_VENDING_APK, url: process.env.APP_VENDING_URL, sha256: process.env.APP_VENDING_SHA256, labDir: LAB, log });
  // one taken out of Google's "Google Play" image earlier (node lab.mjs app vending)
  if (!apk && process.env.APP_VENDING !== '0') { apk = A.extractedVending(LAB); if (apk) log(`  Play ストア: ${path.basename(apk)}（Google Play 入りのイメージから取り出したもの）`); }
  const now = A.accountState(adb, c.email);
  // none given: the Play Store from Google Play itself, with the same account (Minecraft's license check needs the real one)
  if (!apk && now.vending !== 'system' && process.env.APP_VENDING !== '0') apk = await K.fetchPlayApp({ pkg: A.VENDING, dir: path.join(LAB, 'vending', 'play'), toolsDir: path.join(LAB, 'tools'), log });
  // when the account will be written too, defer the Play Store's load-reboot onto the account reboot (one less reboot)
  const willInject = !now.account, installing = apk && now.vending !== 'system';
  let deferred = false;
  if (installing) {
    const v = await A.installVending(adb, apk, { log, reboot: !willInject });
    if (v.loaded) log(`Play ストア ${v.version} を system のアプリとして入れました`);
    else deferred = true;
  } else if (now.vending === 'system') log('Play ストアは system のアプリとして入っています');
  else log(`W Play ストアを入れられません（${process.env.APP_VENDING === '0' ? 'APP_VENDING=0' : 'Google Play から取れず、取り出したもの（node lab.mjs app vending）も --vending / APP_VENDING_APK / APP_VENDING_URL も無い'}）: ${now.vending === 'stub' ? 'イメージの LicenseChecker が「ライセンスなし」と答えるので、Minecraft は起動直後に終わります' : '購入の確認ができないかもしれません'}`);
  if (!willInject) { log('Google アカウントは書き込み済みです'); return; }
  await A.injectAccount(adb, c, { log, timeoutMs: Number(process.env.APP_ACCOUNT_TIMEOUT) || undefined });
  log('Google アカウントを書き込みました（Google の公式の手順ではありません。ライセンスの確認が通るかは run の報告で見てください）');
  // the account reboot also loaded the deferred Play Store: confirm it
  if (deferred) { const v = A.vendingLoaded(adb); if (v) log(`Play ストア ${v} を system のアプリとして入れました`); else log('W Play ストアが system のアプリとして読み込まれませんでした（署名や権限の問題かもしれません）'); }
}
async function accountCmd(args) {
  const o = parse(args, { opts: ['--vending'] });
  const adb = liveAdb();
  if (o.rest[0] === 'check') {
    const s = A.accountState(adb, K.playCredentials().email);
    out(`  ${s.account ? '✔' : '✘'} Google アカウント      ${s.account ? 'あります' : 'ありません（node lab.mjs app account）'}`);
    out(`  ${s.vending === 'system' ? '✔' : '✘'} Play ストア           ${s.vending === 'system' ? 'system のアプリ' : s.vending === 'stub' ? 'イメージの LicenseChecker だけ（ライセンス確認は通りません。node lab.mjs app account）' : s.vending === 'user' ? '普通のアプリとして入っています（system ではない）' : '入っていません（node lab.mjs app account）'}`);
    return;
  }
  if (o.rest.length) fail(`知らない指定 ${o.rest.join(' ')}`, 'node lab.mjs app account [--vending <apk>]  /  node lab.mjs app account check');
  await setupAccount(adb, { vending: o.opts['--vending'] });
  out('OK');
}

function liveAdb() {
  const a = adbReady();
  if (!a?.booted()) fail('エミュレータが動いていません', '`node lab.mjs app emu`（画面を見ながらなら --window）か、`node lab.mjs app run -a <アドオン> --keep` の後で使います。');
  return a;
}
async function screenCmd(args) {
  const name = (parse(args).rest[0] ?? 'screen').replace(/[^\w.-]+/g, '_');
  const adb = liveAdb(), buf = adb.screencap();
  const { pngDecode, pngEncode } = await import(pathToFileURL(path.join(TOP, 'common', 'extra.mjs')).href);
  fs.mkdirSync(LAB, { recursive: true });
  const raw = path.join(LAB, `${name}.png`), grid = path.join(LAB, `${name}-grid.png`);
  fs.writeFileSync(raw, buf); fs.writeFileSync(grid, pngEncode(gridOverlay(pngDecode(buf))));
  const sz = pngSize(buf);
  out(`OK ${rel(raw)}（${sz.w}x${sz.h}）と ${rel(grid)}`);
  out('   格子の線は 10% ごと（黄色が真ん中）。押したい所の数字を読んで app.txt に「tap <横> <縦>」と書きます（例 tap 0.5 0.62）');
}
function liveInput(verb, args) {
  const adb = liveAdb();
  if (verb === 'tap') {
    const [x, y] = args.map(Number);
    if (args.length !== 2 || [x, y].some((v) => !Number.isFinite(v) || v < 0)) fail('書き方: node lab.mjs app tap <x> <y>', '0〜1 は画面に対する割合（0.5 0.5 = 真ん中）');
    const sz = pngSize(adb.screencap());
    const px = [x > 1 ? Math.round(x) : Math.round(x * sz.w), y > 1 ? Math.round(y) : Math.round(y * sz.h)];
    adb.tap(px[0], px[1], W.readStamp()?.tap);
    out(`OK (${px[0]}, ${px[1]}) を押しました。結果を見る: node lab.mjs app screen`);
  } else if (verb === 'key') {
    const k = KEYS[String(args[0] ?? '').toUpperCase()] ?? (/^\d+$/.test(args[0] ?? '') ? Number(args[0]) : null);
    if (k === null) fail('書き方: node lab.mjs app key <キー>', `キー: ${Object.keys(KEYS).join(' ')} か番号`);
    adb.shell(['input', 'keyevent', String(k)]); out('OK');
  } else {
    const t = args.join(' ');
    if (!t || /[^\x20-\x7e]/.test(t)) fail('英数字と記号だけ打てます', '日本語は input text で打てません。');
    adb.shell(['input', 'text', t.replace(/ /g, '%s')]); out('OK');
  }
}

// ---- the lab's BDS (bds/lab.mjs up / do / down, as child processes) ----
function bds(args, env = {}, timeout = 15 * 60_000) {
  const r = spawnSync(process.execPath, [BDS_LAB, ...args], { cwd: BDS_DIR, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 64e6, env: K.cleanEnv(process.env, env) });
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter((l) => l !== '');
  if (r.error?.code === 'ETIMEDOUT') lines.push(`E 時間切れ（${Math.round(timeout / 1000)} 秒）: node bds/lab.mjs ${args.join(' ')}`);
  return { ok: r.status === 0, lines };
}
/** node bds/lab.mjs <args> without blocking (live commands): done when it exits; past the deadline it is stopped and what
 *  it said so far is the answer, with the end of the server's own log — a live command never holds the device's session
 *  (a `bds up` once waited past the whole hold) */
function bdsAsync(args, env = {}, timeout = Number(process.env.APP_LIVE_BDS_MS) || 6 * 60_000) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [BDS_LAB, ...args], { cwd: BDS_DIR, env: K.cleanEnv(process.env, env), detached: true });
    let text = '', done = false;
    c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
    const finish = (status) => {
      if (done) return; done = true; clearTimeout(timer);
      const lines = text.split('\n').filter((l) => l !== '');
      if (status === null) {
        const f = path.join(BDS_DIR, '.lab', 'live.log'), tail = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-8) : [];
        lines.push(`E 時間切れ（${Math.round(timeout / 1000)} 秒）: node bds/lab.mjs ${args.join(' ')}（止めました）`, ...(tail.length ? ['bds/.lab/live.log の最後:', ...tail] : []));
      }
      resolve({ ok: status === 0, lines });
    };
    // (its own process group: stopped whole at the deadline; a server it started lives in a session of its own)
    const timer = setTimeout(() => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } finish(null); }, timeout);
    c.on('error', (e) => { text += `\nE ${e.message}`; finish(1); });
    c.on('exit', (code) => setTimeout(() => finish(code ?? 1), 100));
  });
}
// how the app reaches the lab's BDS. lan (the default): NetherNet with LAN discovery, joined from PLAY's Worlds like a world on
// the same network — 1.26's BDS takes only NetherNet from the app, and a server joined by its address wants a Microsoft
// sign-in. raknet: the old way (a join link to an address; APP_TRANSPORT=raknet)
const appTransport = () => (process.env.APP_TRANSPORT === 'raknet' ? 'raknet' : 'lan');
/** the BDS settings every app run uses: the transport; LAN visibility (its name and version in the answer to a ping); the
 *  script watchdog that does not take a machine the emulator keeps busy for a hang (APP_WATCHDOG_MS); no script debugger
 *  attached (traces and coverage are the BDS lab's; here it is only load — APP_DEBUGGER=1 keeps it) */
function bdsForApp() {
  return { LAB_LAN_VISIBLE: '1', LAB_WATCHDOG_MS: process.env.APP_WATCHDOG_MS ?? '60000', ...(appTransport() === 'lan' ? { LAB_TRANSPORT: 'lan' } : {}), ...(process.env.APP_DEBUGGER === '1' ? {} : { LAB_NO_DEBUGGER: '1' }) };
}
function knownBds() { return readJson(path.join(TOP, 'common', 'data', 'bds-versions.json'))?.linux ?? null; }
function currentAddon(a) {
  if (a) return a;
  if (process.env.LAB_ADDON) return process.env.LAB_ADDON;
  try { return fs.readFileSync(path.join(TOP, 'bds', '.lab', 'addon'), 'utf8').trim() || null; } catch { return null; }
}
const addonNames = () => { try { return fs.readdirSync(ADDONS).filter((n) => fs.existsSync(path.join(ADDONS, n, 'bp', 'manifest.json'))).sort(); } catch { return []; } };
function needAddon(name) {
  const a = currentAddon(name);
  const names = addonNames();
  if (!a) fail('どのアドオンで試すか指定してください', `-a <名前>（bds/addons にあるもの: ${names.join(' ') || 'なし'}）`);
  if (!process.env.APP_BDS_LAB && !names.includes(a)) fail(`bds/addons/${a} がありません`, `あるもの: ${names.join(' ') || 'なし'}。新しく作るなら node lab.mjs bds new ${a} "タイトル"`);
  return a;
}

// ---- init: app.txt for an addon ----
function initCmd(args) {
  const o = parse(args, { opts: ['-a', '--addon'] });
  const addon = needAddon(o.opts['-a'] ?? o.opts['--addon']);
  const f = path.join(ADDONS, addon, 'app.txt');
  if (fs.existsSync(f)) fail(`${rel(f)} はもうあります`, '書き直すなら、そのファイルを直接編集してください。');
  fs.writeFileSync(f, `# ${addon} を本物のアプリで確かめる手順。実行: node lab.mjs app run -a ${addon}
# 1 行 1 手順。一覧: node lab.mjs app help   押す位置の測り方: node lab.mjs app screen
launch                       # アプリを起動（準備済みの端末なら、もうタイトル画面で起動済み）
until title 600000           # タイトル画面まで待つ（初めての起動はとても重いので長めに）
shot title
join                         # ラボの BDS に直接参加
until joined 300000          # ワールドに出るまで待つ
until stable 120000
shot world
# ここから、アドオンの UI を出して撮る。例:
# do scriptevent my:open     # BDS のコンソールで実行（サーバーからフォームなどを出す）
# until stable 30000
# shot my-ui                 # ← JSON UI の成果
# key BACK                   # 閉じる
`);
  out(`OK ${rel(f)} を作りました。「ここから」の下に、UI を出す手順を書いてください。`);
}

// root on the device (Google APIs images): the game's private folder (its content log) and the input devices. adbd restarts
// for it unless it is root already (a prepared device is: its snapshot was taken as root). true = root now
function takeRoot(adb) {
  if (adb.shell(['id', '-u'], { timeout: 15_000 }).stdout.trim() === '0') return true;
  adb.run(['root'], { timeout: 20_000 });
  for (let k = 0; k < 20; k++) {
    adb.run(['wait-for-device'], { timeout: 30_000 });
    if (adb.shell(['id', '-u'], { timeout: 15_000 }).stdout.trim() === '0') return true;
    spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', ['1']);
  }
  return false;
}
/** waits (up to maxMs) until the device is calm: its load under the number of its cores for three looks in a row */
async function settle(adb, { maxMs = Number(process.env.APP_SETTLE_MS ?? 180_000), log = out } = {}) {
  const cores = Number(adb.shell(['nproc'], { timeout: 15_000 }).stdout.trim()) || 2, t0 = Date.now(), seen = [];
  let calm = 0, lastTop = 0, busiest = null;
  while (Date.now() - t0 < maxMs) {
    const l = Number(adb.shell(['cat', '/proc/loadavg'], { timeout: 15_000 }).stdout.trim().split(/\s+/)[0]);
    if (Number.isFinite(l)) seen.push(l.toFixed(1));
    else { const g = emulatorGone(adb); if (g) throw g; }
    calm = Number.isFinite(l) && l < cores ? calm + 1 : 0;
    if (calm >= 3) break;
    // who keeps it busy (every 30 s; the busiest look is reported): the next fix is named by this
    if (Date.now() - lastTop > 30_000) { lastTop = Date.now(); const t = topProcs(adb); if (t.length && (!busiest || l > busiest.load)) busiest = { load: l, procs: t }; }
    await sleep(Number(process.env.APP_SETTLE_POLL_MS) || 5000);
  }
  if (seen.length) log(`  端末が落ち着くのを待ちました（${Math.round((Date.now() - t0) / 1000)} 秒、負荷 ${seen.slice(-6).join(' → ')}、CPU ${cores} 個）${calm >= 3 ? '' : ' — 落ち着かないまま時間切れ'}`);
  if (busiest && (calm < 3 || Date.now() - t0 > 60_000)) log(`    いちばん忙しかったとき（負荷 ${busiest.load.toFixed(1)}）: ${busiest.procs.join('、')}`);
}
/** the device's busiest processes now ("dex2oat64 98%", …): toybox top, one look */
function topProcs(adb, n = 5) {
  // (two looks a second apart, the second one kept: a single look has no interval to measure the CPU over, and shows top.
  // All processes with the headers, sorted by D.busiest: with -m, top cut its list in its own order and kept idle ones)
  return D.busiest(adb.shell(['top', '-b', '-d', '1', '-n', '2', '-o', '%CPU,ARGS'], { timeout: 30_000 }).stdout, n).filter((x) => !/^top /.test(x));
}
/** the content log's lines by section → errors and warnings (pure) */
function clientErrors(sections = [], { readable = true } = {}) {
  const errors = [], warnings = [];
  for (const sec of sections) for (const line of sec.client ?? []) {
    const lv = C.logLevel(line);
    if (lv === 'error') errors.push({ section: sec.name, line: line.trim() });
    else if (lv === 'warn') warnings.push({ section: sec.name, line: line.trim() });
  }
  return { readable, errors, warnings, lines: sections.reduce((n, x) => n + (x.client?.length ?? 0), 0) };
}

// ---- run: everything, always ending in a report ----
function stampLocal(d = new Date()) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
function takeLock() {
  fs.mkdirSync(LAB, { recursive: true });
  const j = readJson(LOCK);
  if (j?.pid && j.pid !== process.pid && alivePid(j.pid)) fail(`別の app run が動いています（pid ${j.pid}）`, '終わるのを待つか、そのウィンドウで Ctrl+C で止めてください。');
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }));
  return () => { if (readJson(LOCK)?.pid === process.pid) fs.rmSync(LOCK, { force: true }); };
}
function advise(st) {
  if (st.ok) return ['index.html を開いて、スクショ（shots/）に JSON UI が思った通りに出ているか見る', '見た目を直したら（rp/ui/*.json）、同じコマンドでもう一度'];
  const n = [];
  const bad = st.results.find((r) => !r.ok);
  if (st.fatal) n.push('上の「途中で止まりました」の → の通りにして、もう一度');
  else if (bad) {
    n.push(`index.html で、失敗した手順（${bad.line} 行目）の画面 ${bad.shot ?? '（撮れませんでした）'} を見る`);
    const v = bad.raw.split(/\s+/);
    if (v[0] === 'until' && v[1] === 'joined') n.push('確認画面が出ているなら、ボタンの位置を測って（--keep を付けて実行 → node lab.mjs app screen）、その until の後ろに「; every 15000 tap <x> <y>」を足す');
    else if (v[0] === 'until' && v[1] === 'stable') n.push('ずっと動いている画面なら until stable の代わりに wait <ミリ秒> を使う。真っ黒なら README の「うまくいかないとき」');
    else if (v[0] === 'do') n.push(`サーバー側だけ確かめる: node lab.mjs bds run "${bad.raw.slice(3)}"`);
    else if (v[0] === 'absent' || v[0] === 'expect') n.push('logcat-minecraft.txt / server.log のその行を見て、rp/ui などを直す');
    else n.push('logcat-minecraft.txt と server.log も見る');
  }
  if (st.notes.some((x) => /ライセンス/.test(x))) n.push('ライセンスの画面なら README の「うまくいかないとき」');
  // Android itself not answering: the device is too slow for the game, whatever step it showed in
  if (st.dialogs?.length || st.translated) n.push(`端末を軽くする: ${st.translated ? 'x86_64 版の APK（node lab.mjs app apk fetch。gpdl があれば先に試します）、' : ''}APP_SCREEN=720x1560（画面を小さく）、APP_CORES（コア数）`);
  return n;
}
async function runCmd(args) {
  const o = parse(args, { flags: ['--no-fetch', '--wipe', '--window', '--keep', '-v', '--account', '--allow-client-errors'], opts: ['-a', '--addon', '--scenario', '--apk', '--bds', '--vending'] });
  const verbose = o.flags.has('-v') || !!process.env.APP_VERBOSE;
  if (o.rest.length) fail(`知らない指定 ${o.rest.join(' ')}`, 'node lab.mjs app run -a <アドオン> [--scenario <ファイル>] …（node lab.mjs app help）');
  const account = o.flags.has('--account') || process.env.APP_ACCOUNT === '1';
  if (o.opts['--vending'] && !account) fail('--vending は --account と一緒に使います', 'node lab.mjs app run -a <アドオン> --account --vending <apk>');
  const addon = needAddon(o.opts['-a'] ?? o.opts['--addon']);
  // automatic upkeep first (temp folders, stale locks, login leftovers, disk): quiet unless it repaired something
  try { const M = await import(pathToFileURL(path.join(TOP, 'common', 'maint.mjs')).href); const q = await M.maint({ top: TOP, fix: true, only: M.QUICK }); q.lines.forEach((l) => out(l)); } catch { /* upkeep never blocks a run */ }
  const bdsWant = o.opts['--bds'] ?? 'auto';
  if (!/^(auto|keep|\d+\.\d+\.\d+\.\d+)$/.test(bdsWant)) fail(`--bds ${bdsWant} は使えません`, '--bds auto（アプリに合わせる）/ keep（いまのまま）/ 1.26.52.3 のような版');
  const keep = o.flags.has('--keep');
  const scenarioFile = path.resolve(o.opts['--scenario'] ?? [path.join(ADDONS, addon, 'app.txt'), path.join(APPDIR, 'scenarios', 'default.txt')].find((f) => fs.existsSync(f)));
  if (!fs.existsSync(scenarioFile)) fail(`${o.opts['--scenario']} がありません`);
  const { steps, errors } = parseScenario(fs.readFileSync(scenarioFile, 'utf8'));
  if (errors.length) { errors.forEach((e) => out(`E ${rel(scenarioFile)}:${e}`)); fail('手順の書き方に誤りがあります（上の行）', '書き方の一覧: node lab.mjs app help'); }
  if (!steps.length) fail(`${rel(scenarioFile)} に手順がありません`, 'node lab.mjs app init -a ' + addon);
  const unlock = takeLock();

  const st = { ok: false, addon, app: null, bds: null, device: null, scenario: rel(scenarioFile), results: [], shots: [], notes: [], dialogs: [], fatal: null, next: [], started: Date.now(), ended: 0, timing: {} };
  const runDir = path.join(RUNS, `${stampLocal()}-${addon}`);
  fs.mkdirSync(runDir, { recursive: true });
  // the screen gets the stages, a failing step and the result; every line goes to run.txt (-v: the screen too)
  const log = (s, show = true) => { if (show || verbose) out(s); fs.appendFileSync(path.join(runDir, 'run.txt'), s + '\n'); };
  const serverLog = path.join(runDir, 'server.log'), logcatFile = path.join(runDir, 'logcat.txt');
  fs.writeFileSync(serverLog, '');
  fs.copyFileSync(scenarioFile, path.join(runDir, 'scenario.txt'));
  // what `app prepare` did just before (this machine), or how the prepared device was made (it carries its own log, on CI
  // from the prep job's machine): the log, the game's settings and the screens go with this run's report
  {
    const kept = path.join(W.avdDir(), 'lab-prepare'), fresh = fs.existsSync(PREP_LOG) && Date.now() - fs.statSync(PREP_LOG).mtimeMs < 6 * 3600_000;
    const from = fresh ? LAB : fs.existsSync(path.join(kept, 'prepare.txt')) ? kept : null;
    if (from) for (const f of fs.readdirSync(from).filter((x) => /^prepare(\.txt|-.*\.(png|txt))$/.test(x) && x !== 'prepare-logcat.txt')) {
      if (/\.png$/.test(f)) { fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true }); fs.copyFileSync(path.join(from, f), path.join(runDir, 'shots', `00-${f}`)); }
      else if (f === 'prepare-options.txt') fs.writeFileSync(path.join(runDir, 'game-options.txt'), fs.readFileSync(path.join(from, f), 'utf8').split('\n').filter((l) => !C.OPTIONS_NOISE.test(l)).join('\n'));
      else fs.copyFileSync(path.join(from, f), path.join(runDir, f));
    }
  }
  // the machine's load, memory and disk all along (host.txt). In GitHub Actions each stage, and every few minutes of a
  // long one, is also a notice with them: a job stopped from outside (exit 143, no artifact) still says how far it got
  // and what the machine looked like (`app ci fetch` reads notices through the API). GitHub keeps 10 notices a step
  const gha = process.env.GITHUB_ACTIONS === 'true';
  const elapsed = () => { const s = Math.round((Date.now() - st.started) / 1000); return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; };
  let notices = 0, lastNotice = Date.now(), stageNow = '';
  const notice = (title, h) => { if (!gha || notices >= 9) return; notices++; lastNotice = Date.now(); process.stdout.write(`::notice title=${ghEscape(soften(`app ${title}`)).replace(/[:,]/g, ' ').slice(0, 90)}::${ghEscape(`+${elapsed()} ${h ? fmtStats(h) : ''}`)}\n`); };
  const mon = startMonitor(path.join(runDir, 'host.txt'), { dir: LAB });
  const beat = setInterval(() => { if (Date.now() - lastNotice > 4 * 60_000) notice(`経過（${stageNow}）`, mon.last()); }, 30_000); beat.unref();
  const stage = (s) => { stageNow = s.slice(0, 40); log(s); notice(s, mon.now()); };
  let adb = null, emu = null, serverUp = false, lc = null, lcFd = null, launched = false, finished = false;

  const finish = async () => {
    if (finished) return; finished = true;
    // the end state and what the app left behind (each part may fail on its own: keep going)
    const tryDo = async (f) => { try { await f(); } catch (e) { log(`W ${e.message}`); } };
    if (adb && launched) await tryDo(() => { const b = adb.screencap(); const f = path.join(runDir, 'shots', '99-final.png'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); st.shots.push(f); });
    const alive = adb && launched ? adb.pid() > 0 : true;
    // let logcat flush what it has (a slow start writes nothing for a moment), then stop it
    if (lc) { await sleep(1500); for (let k = 0; k < 50 && !(fs.statSync(logcatFile, { throwIfNoEntry: false })?.size > 0); k++) await sleep(100); try { lc.kill(); } catch { /* gone */ } }
    if (lcFd !== null) try { fs.closeSync(lcFd); } catch { /* closed */ }
    const lct = fs.existsSync(logcatFile) ? fs.readFileSync(logcatFile, 'utf8') : '';
    if (lct) fs.writeFileSync(path.join(runDir, 'logcat-minecraft.txt'), lct.split('\n').filter((l) => /minecraft|mojang|AndroidRuntime|FATAL|\bDEBUG\s*:|\blibc\s*:/i.test(l)).join('\n') + '\n');
    // the lines to read first when it fails (also the GitHub annotation): the app's start/end, FATAL, license, account
    if (lct) fs.writeFileSync(path.join(runDir, 'logcat-digest.txt'), logcatDigest(lct, K.PACKAGE).join('\n') + '\n');
    { const d = lct ? deathExcerpt(lct, K.PACKAGE) : []; if (d.length) fs.writeFileSync(path.join(runDir, 'logcat-death.txt'), d.join('\n') + '\n'); }
    if (launched && !alive) st.notes.push('最後にアプリが動いていませんでした（落ちた？ logcat-minecraft.txt の FATAL を見てください）');
    const licLines = lct.split('\n').filter((l) => /licen[cs]e/i.test(l));
    // Minecraft's own license check (Google Play's PairIP): its screen means Play said no, and the app quits right after
    if (/com\.pairip\.licensecheck\.LicenseActivity/.test(lct)) st.notes.push(`Google Play のライセンス確認（PairIP）で止められました（LicenseActivity の後にアプリが終了）: 本物の Play ストアと、Minecraft を買ったアカウントが要ります。${account ? 'run.txt の Play ストアの行を見てください（入らなかったなら APP_VENDING_URL / --vending）' : '--account で試してください（GitHub では入力 account）'}`);
    else if (licLines.some((l) => /(fail|denied|error|unable|not.?licensed)/i.test(l))) st.notes.push('ライセンス確認に失敗したらしい行が logcat にあります（README「うまくいかないとき」）');
    // died at graphics init (EGL), not licensing: software rendering or the device being too busy (ANR / high load)
    else if (/eglCreateContext.*EGL_BAD|EGL_BAD_ALLOC|graphics context was lost|BufferQueue has been abandoned/.test(lct)) {
      const anr = /ANR in |Input dispatching timed out|not responding/.test(lct);
      st.notes.push(`グラフィックス初期化の直後にアプリが終了しました（EGL エラー）: ${anr ? '端末が過負荷で（ANR 多発）、ゲームの描画面が奪われた可能性が高いです。コア数・RAM を増やす、同梱アプリや同期をさらに止める' : 'ソフトウェア描画の限界かもしれません（APP_GPU を変える、別のイメージ）'}。`);
    }
    // Android's own "isn't responding" dialogs the scenario answered, the game's code under ARM translation, the machine
    if (st.dialogs.length) st.notes.push(`Android 自体の「応答なし」などのダイアログが ${st.dialogs.length} 回出ました（${dialogSummary(st.dialogs)}）。そのたびラボが答えて続けましたが、端末の処理が追いついていません（画面がダイアログのままだと、スクショもそれになります）`);
    if (st.translated) st.notes.push(`Minecraft の ${st.app.abis.join(',')} 版を ${st.deviceAbis[0]} の端末で、ARM 変換して動かしています。とても重く、Android ごと応答しなくなる元です（x86_64 版の APK なら変換なしで動きます: node lab.mjs app apk fetch）`);
    clearInterval(beat); mon.stop();
    st.notes.push(...hostNotes(mon.worst));
    const sl = fs.readFileSync(serverLog, 'utf8');
    if (st.results.some((r) => r.raw === 'join' && r.ok)) {
      if (/Player connected: /.test(sl) && !/Player Spawned: /.test(sl)) st.notes.push('サーバーには接続したが、ワールドに出ていません（確認画面やパックのダウンロードで止まった？）');
      if (!/Player connected: /.test(sl)) st.notes.push('サーバーに接続が来ていません（参加用リンクが効かない / サインインを求められている / 版の違い。画面を見てください）');
    }
    // Android's own crash records (app crash / native crash / ANR, system_server crash / watchdog): they survive a noisy logcat
    if (adb && launched && !(st.results.length === steps.length && st.results.every((r) => r.ok))) await tryDo(() => {
      const parts = ['system_server_crash', 'system_server_native_crash', 'system_server_watchdog', 'data_app_crash', 'data_app_native_crash', 'data_app_anr'].map((tag) => {
        const t = String(adb.shell(['dumpsys', 'dropbox', '--print', tag], { timeout: 30_000 }).stdout ?? '').trim();
        return /^(Process|Subject|Cmd line|Build|pid): /m.test(t) ? `== ${tag} ==\n${t.split('\n').filter((l) => l.trim() && !/^\s+(at |#\d\d )/.test(l) || /^\s+#0[0-5] /.test(l)).slice(0, 60).join('\n')}` : '';
      }).filter(Boolean);
      if (parts.length) fs.writeFileSync(path.join(runDir, 'dropbox.txt'), parts.join('\n\n') + '\n');
    });
    // the game's own content logs (JSON UI errors go there when the content log is on): adb root works on Google APIs images
    if (adb && launched) await tryDo(async () => {
      adb.run(['root'], { timeout: 20_000 }); await sleep(1500); adb.run(['wait-for-device'], { timeout: 30_000 });
      for (const [dev, name] of [[`/data/data/${K.PACKAGE}/games/com.mojang/logs`, 'logs-internal'], [`/sdcard/Android/data/${K.PACKAGE}/files/games/com.mojang/logs`, 'logs-external']]) {
        if (adb.shell(['ls', dev]).status === 0) { const dst = path.join(runDir, 'pulled', name); fs.mkdirSync(path.dirname(dst), { recursive: true }); adb.run(['pull', dev, dst], { timeout: 60_000 }); }
      }
    });
    if (fs.existsSync(path.join(LAB, 'emulator.log'))) await tryDo(() => { const b = fs.readFileSync(path.join(LAB, 'emulator.log')); fs.writeFileSync(path.join(runDir, 'emulator.log'), b.subarray(Math.max(0, b.length - 2e6))); });
    // stop what this run started
    if (serverUp && !keep) await tryDo(() => bds(['down'], { LAB_ADDON: addon }, 60_000));
    if (emu?.started && !keep) await tryDo(() => D.stopEmulator(adb, LAB));
    st.ok = !st.fatal && !st.clientFail && st.results.every((r) => r.ok) && (st.results.length === steps.length || Boolean(st.sections?.length)) && alive;
    st.next = advise(st);
    st.ended = Date.now();
    const md = writeReport(runDir, st);
    const bad = guard(runDir, [process.env.GOOGLE_AAS_TOKEN, process.env.GOOGLE_PASSWORD, (await import('../common/secrets.mjs')).readSecret(TOP, 'GOOGLE_PASSWORD')].filter(Boolean));
    if (bad.length) { bad.forEach((b) => log(`E guard: ${b}`)); st.ok = false; log('E 結果のフォルダに入れてはいけないものがありました（アップロードしないでください）'); }
    if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* not ours */ }
    log('');
    if (st.fatal) log(`E 途中で止まりました: ${st.fatal}`);
    st.notes.forEach((n) => log(`W ${n}`));
    log(`${st.ok ? 'PASS' : 'FAIL'} ${rel(path.join(runDir, 'report.md'))}`);
    log(`     画面: ${rel(path.join(runDir, 'index.html'))}（${st.shots.length} 枚）`);
    st.next.forEach((n) => log(`     次: ${n}`));
    if (keep) log('     BDS とエミュレータは動いたままです。止める: node lab.mjs bds down / node lab.mjs app emu stop');
    unlock();
  };
  const onSignal = () => { st.fatal ??= '中断しました（Ctrl+C）'; finish().finally(() => process.exit(130)); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);

  try {
    log(`app run ${addon} → ${rel(runDir)}`);
    // 1. the APK set (not needed when the prepared snapshot already has the game: `app prepare`, lib/warm.mjs)
    if (o.opts['--apk']) apkUse(o.opts['--apk']);
    let list = apkPaths();
    // (app redroid debug: this run starts before its device is up — APP_DEVICE_READY_FILE says when the device is ready, or why
    // it will not be; the BDS gets ready meanwhile. Without the APKs pulled last time, the device first: they come from it)
    const readyFile = process.env.APP_DEVICE_READY_FILE || null, ppid = process.ppid;
    const RD = readyFile ? await import('./redroid/ready.mjs') : null;
    let deviceWord = null;
    const deviceReady = async () => {
      if (!readyFile || deviceWord) return;
      log(`      端末の準備を待っています（app redroid debug: ${rel(readyFile)}）`);
      deviceWord = await RD.waitReady(readyFile, { timeoutMs: Number(process.env.APP_DEVICE_READY_MS) || 20 * 60_000, gone: () => process.ppid !== ppid });
      st.timing.deviceWait = deviceWord.ms;
      if (!deviceWord.ok) fail(`端末の準備に失敗しました: ${deviceWord.why || '理由は書かれていません'}`, '端末の側（app redroid debug）の行を見てください（この run の BDS は止めます）');
      if (deviceWord.serial && deviceWord.serial !== D.SERIAL) fail(`準備ができた端末（${deviceWord.serial}）が、この run の端末（${D.SERIAL}）と違います`, 'APP_SERIAL を確かめてください');
      log(`      端末の準備ができました（${(deviceWord.ms / 1000).toFixed(1)} 秒待ちました）`);
    };
    if (readyFile && !list) { await deviceReady(); list = apkPaths(); }
    const ready = readySnapshot({ list, account, wipe: o.flags.has('--wipe') });
    const warmOk = Boolean(ready && !ready.diff.length);
    if (!list && !warmOk) {
      if (o.flags.has('--no-fetch')) fail('APK がありません', '`node lab.mjs app apk fetch` か `--apk <フォルダ>`（準備済みの端末なら node lab.mjs app prepare）');
      if (!K.playCredentials().ready) {
        if (!process.stdin.isTTY && !((await import('../common/secrets.mjs')).readSecret(TOP, 'GOOGLE_EMAIL') && (await import('../common/secrets.mjs')).readSecret(TOP, 'GOOGLE_PASSWORD'))) fail('APK がまだありません', '端末で `node lab.mjs app token` を一度実行するか（Google Play から取る）、`--apk <フォルダ>`（スマホから取り出したもの）');
        log('[1/5] APK がまだありません。Google Play から取るための準備（一度だけ）をします');
        await tokenCmd([]);
      }
      log('[1/5] APK: Google Play から取得します（1 GB 前後）');
      await apkFetch();
      list = apkPaths();
    }
    const info = list ? K.inspectApks(list) : { versionName: ready.stamp.versionName, versionCode: ready.stamp.installedCode ?? ready.stamp.apk, abis: ready.stamp.abis ?? [] };
    st.app = { versionName: info.versionName, versionCode: info.versionCode, abis: info.abis };
    stage(`[1/5] APK ${info.versionName} (${info.versionCode}) ${info.abis.join(',')}${list ? '' : '（準備済みの端末に入っているもの）'}`);

    // 2. the emulator: started now, waited for after the BDS is up (both get ready at once)
    stage(readyFile ? '[2/5] 端末（app redroid debug が用意しています。BDS を先に）' : `[2/5] エミュレータ${warmOk ? `（準備済みの状態 ${W.SNAPSHOT} から）` : ''}`);
    const elog = (s) => log('      ' + s, /^W /.test(s));
    emu = readyFile ? { adb: adbReady() ?? fail('adb がありません', 'ANDROID_HOME の platform-tools か APP_ADB'), started: false, warm: false } : await ensureEmulator({ window: o.flags.has('--window'), wipe: o.flags.has('--wipe'), writableSystem: account && vendingWanted(o.opts['--vending']), ready, noWait: true, log: elog });
    adb = emu.adb; adb.log = (s) => fs.appendFileSync(path.join(runDir, 'adb.txt'), s + '\n');
    // (a device whose screencap leaves the game out: its pictures from the emulator, as prepare found)
    if (emu.warm && ready?.stamp?.shot === 'emu') adb.shotVia = 'emu';
    // (the way of pressing the game's buttons that prepare found working on this device: a held press on a slow one)
    if (ready?.stamp?.tap && ready.stamp.tap !== 'tap') adb.tapHow = ready.stamp.tap;
    const emuStarted = readJson(path.join(LAB, 'emulator.json'))?.started ?? Date.now();
    const deviceUp = async () => {
      spawnSync(adb.bin, ['start-server'], { timeout: 30_000, env: K.cleanEnv() });
      if (!emu.warm) elog('起動を待っています（初回は 5〜10 分かかることがあります）');
      await D.waitBoot(adb, { log: elog, warm: emu.warm });
      st.deviceAbis = adb.prop('ro.product.cpu.abilist').split(',').filter(Boolean);
      st.device = `${adb.prop('ro.product.model')} Android ${adb.prop('ro.build.version.release')} (${st.deviceAbis.join(',')})`;
      // the game's native code for another CPU than the device's own (arm64 on x86_64): it runs through ARM translation
      st.translated = Boolean(st.deviceAbis[0] && info.abis.length && !info.abis.includes(st.deviceAbis[0]));
      // the device a live session holds (app hold → `run`): used as it is, the game running or not
      if (process.env.APP_LIVE_DEVICE === '1' && !emu.started) {
        if (adb.pid() > 0) launched = true;
        log(`      動いている端末をそのまま使います（Minecraft ${launched ? '起動済み' : 'は止まっています: 手順の launch / join が起動します'}）`);
        return;
      }
      if (emu.warm) {
        // a snapshot that did not load is an ordinary boot of the same disk: the game is installed but not running
        st.timing.device = Date.now() - emuStarted;
        const made = ready?.stamp?.cpu, here = W.hostCpu();
        if (made && here && made !== here) elog(`  スナップショットは別の CPU で作られました（${made} → いまは ${here}）`);
        if (adb.pid() > 0) { launched = true; elog(`準備済みの状態に戻りました（${(st.timing.device / 1000).toFixed(1)} 秒。Minecraft は起動済み）`); }
        else { st.notes.push(`準備済みの状態（${W.SNAPSHOT}）から戻れず、普通に起動しました（このマシンでは読み込めないスナップショット？ emulator.log）。node lab.mjs app prepare --force で作り直せます`); elog('W スナップショットから戻れませんでした: 普通に起動しました'); }
        return;
      }
      log(`      ${st.device}${st.translated ? `（Minecraft は ${info.abis.join(',')} 版: ARM 変換で動かします）` : ''}`, false);
      install(adb, list, info, elog);
      { const q = D.quietDevice(adb); if (q.length) log(`      同梱の Google アプリ ${q.length} 個を止めました（CPU を空ける。APP_KEEP_APPS=1 で止めない）`, false); }
      if (account) {
        stage('[2/5] Google アカウントをエミュレータへ書き込みます（--account）');
        await setupAccount(adb, { vending: o.opts['--vending'], log: (s) => { log('      ' + s, /^W /.test(s)); if (/^W /.test(s)) st.notes.push(s.slice(2)); } });
      }
    };
    // (a cold boot is minutes: the device first, as before; from the snapshot or app redroid debug's device: the BDS starts
    // while it comes back)
    if (!emu.warm && !readyFile) await deviceUp();

    // 3. the BDS build for this app version (another protocol = "outdated" and no join)
    if (readyFile && RD.readReady(readyFile)?.ok === false) await deviceReady();   // (the device failed already: no BDS for it)
    if (bdsWant === 'keep') stage('[3/5] BDS: いまのまま');
    else {
      const cands = bdsWant === 'auto' ? K.bdsCandidates(info.versionName, knownBds()) : [bdsWant];
      for (const v of cands) {
        const r = bds(['bds', v]);
        if (r.ok) { st.bds = { version: v, exact: v === cands[0] }; break; }
        log(`      BDS ${v} は用意できません: ${r.lines.filter((l) => /ERR|cannot|E /.test(l)).slice(0, 1).join('') || r.lines.at(-1) || '?'}`);
      }
      if (!st.bds) st.notes.push(`アプリ ${info.versionName} に合う BDS を用意できませんでした。いまの BDS で試しました（版が違うと参加できません。--bds <版> で指定できます）`);
      else if (!st.bds.exact) st.notes.push(`BDS ${cands[0]} が無いので、同じ系列の ${st.bds.version} を使いました`);
      stage(`[3/5] BDS ${st.bds?.version ?? '（いまのまま）'}${st.bds && !st.bds.exact ? '（同じ系列）' : ''}`);
    }
    if (!st.bds) { const v = /bds (\d+\.\d+\.\d+\.\d+)/.exec(bds(['bds']).lines.join('\n'))?.[1]; st.bds = { version: v ?? '?', exact: false }; }

    // 4. the BDS with the addon; resource packs required so the app must take the addon's UI
    stage('[4/5] BDS を起動（アドオン入り、リソースパック必須）');
    if (readJson(BDS_LIVE)) log('      動いていた BDS（node lab.mjs bds up）を止めて、起動し直します');
    bds(['down'], { LAB_ADDON: addon }, 60_000);
    const wantPort = Number(process.env.APP_PORT) || 19132;
    // (LAN visibility: the server answers the game's ping with its name and version — without them, a pong that says nothing,
    // the game does not even start to connect: "Unable to connect to world", seen through the device's relay)
    // (the script watchdog: the emulator keeps this machine busy — a script that waits for the CPU is not the addon hanging,
    // and a "hang" must not stop the server under the game: APP_WATCHDOG_MS, 0 = BDS's own 10 s)
    const up = bds(['up'], { LAB_ADDON: addon, LAB_PORT: String(wantPort), LAB_TAIL: serverLog, LAB_TEXTUREPACK_REQUIRED: '1', LAB_LIVE_IDLE: '240', ...bdsForApp() });
    serverUp = true;
    if (!up.ok) { up.lines.slice(-8).forEach((l) => log('      ' + l)); fail('BDS が起動しませんでした（上の行）', `アドオンの誤りなら、まず node lab.mjs bds go -a ${addon} を通してください。`); }
    // the port BDS really took (the lab moves on when 19132 is busy): the deep link must point there
    const port = Number(readJson(BDS_LIVE)?.port) || wantPort;
    if (port !== wantPort) st.notes.push(`ポート ${wantPort} が使用中だったので、${port} で起動しました`);
    const host = process.env.APP_HOST || '10.0.2.2', lan = appTransport() === 'lan';
    const joinTo = (h, p) => (process.env.APP_JOIN_URI || 'minecraft://connect/?serverUrl={host}&serverPort={port}').replaceAll('{host}', h).replaceAll('{port}', String(p));
    let joinUri = joinTo(host, port);

    await deviceReady();
    if (emu.warm || readyFile) await deviceUp();

    // 5. root on the device (the game's content log is in its private folder; held keys go through the input device): before
    // logcat, since adbd restarts for it. Then logcat from here on, and the steps
    const rooted = takeRoot(adb);
    // the join through the device's own relay (127.0.0.1 → the BDS here): the game asks a Microsoft sign-in for any other
    // server. APP_JOIN_VIA=direct: straight to APP_HOST (a signed-in game)
    // a controller plugged into the device (1.26's new screens take it, not taps): every press of the steps goes through it
    { const pd = D.startPad(adb, { labDir: LAB }); log(`      ${pd.note}`, !pd.ok); }
    // (NetherNet over LAN, the default: the game finds the server by its discovery broadcasts on UDP 7551 — carried by the
    // reflector, the game holds that port itself)
    if (process.env.APP_JOIN_VIA !== 'direct' && !process.env.APP_JOIN_URI) {
      // (7551 is the game's own: its LAN discovery broadcasts are caught and sent on, not listened for — lab-relay --reflect)
      const listen = Number(process.env.APP_RELAY_PORT) || 19132, r = D.startRelay(adb, { labDir: LAB, listen, host, port, reflect: lan ? [7551] : [] });
      if (r.ok) { joinUri = joinTo('127.0.0.1', listen); log(`      ${r.note}`, false); }
      else st.notes.push(`端末の中継を使えません（${r.note}）: ${lan ? 'ゲームから LAN のワールドとして見えません' : `${host} へ直接参加します（ゲームが Microsoft のサインインを求めることがあります）`}`);
    }
    adb.run(['logcat', '-c']);
    lcFd = fs.openSync(logcatFile, 'w');
    lc = spawn(adb.bin, ['-s', adb.serial, 'logcat', '-v', 'threadtime'], { stdio: ['ignore', lcFd, lcFd], env: K.cleanEnv() });
    stage(`[5/5] 手順 ${rel(scenarioFile)}（${steps.length} 個）`);
    const { pngDecode } = await import(pathToFileURL(path.join(TOP, 'common', 'extra.mjs')).href);
    // where the pictures come from (APP_SHOT=auto, the default): the emulator's own view of its display when it shows the
    // same picture — the host makes that PNG, while the device's screencap costs the game seconds of CPU each (2.5 s on the
    // CI device) — else the device's. Both timed once, here
    if (!process.env.APP_SHOT || process.env.APP_SHOT === 'auto') log(`      画面の撮り方: ${pickShot(adb, pngDecode).note}`);
    const clientLog = rooted ? new C.ClientLog(adb, K.PACKAGE) : null;
    if (!rooted) st.notes.push('端末で root になれないので、ゲームのコンテンツログ（クライアントだけのエラー）を読めませんでした（Google APIs のイメージで動かしてください）');
    let baseline = null;   // the world with nothing open (`shot world`): what `recover` brings the screen back to
    const res = await runScenario(steps, {
      adb, runDir, decode: pngDecode, pkg: K.PACKAGE, baseDir: path.dirname(scenarioFile), logcatFile, clientLog,
      log: (s) => log('      ' + s.replace(/\n/g, '\n      '), /^[✘⚠]/.test(s)),
      launch: () => adb.shell(['monkey', '-p', K.PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']),
      started: () => { launched = true; },    // launch, or join (the deep link starts the app too)
      stopped: () => { launched = false; },   // stop: not running is expected until the next launch
      alive: () => !launched || adb.pid() > 0,
      // Android's own "isn't responding" / "keeps stopping" dialog over the game: answered (lib/android.mjs), counted in st
      dialog: () => adb.focus().dialog, answer: (d) => D.answerDialog(adb, d), dialogs: st.dialogs, focus: () => adb.focus().window,
      ocr: C.ocrAvailable() ? (f) => C.ocrWords(f) : null, firstScreen: emu.warm ? ready?.stamp?.firstScreen ?? null : null,
      shotTaken: (name, buf) => {
        if (/^(ui-)?world(--[\w.-]+)?$/.test(name)) baseline = buf;
        // a texture the client could not find: only the picture shows it (no log line on the server, often none in the client's)
        try {
          const m = C.magentaShare(buf, pngDecode);
          if (m > Number(process.env.APP_MAGENTA_SHARE ?? 0.0005)) st.notes.push(`画面 ${name} の ${(m * 100).toFixed(2)}% が紫（マゼンタ）: テクスチャが見つからないときの紫と黒の市松模様かもしれません（missing texture。パスと textures/ の中身を確かめる）`);
        } catch { /* unreadable picture */ }
      },
      baseline: () => baseline,
      // a section failed: close whatever it left open (BACK until the screen is the world again; BACK on the bare world
      // opens the pause screen, which the next BACK closes)
      recover: async () => {
        for (let k = 0; k < 4; k++) {
          const d = adb.focus().dialog;
          if (d) { D.answerDialog(adb, d); await sleep(1500); continue; }
          if (!baseline) return;
          let b; try { b = adb.screencap(); } catch { return; }
          if (screenDiff(baseline, b, pngDecode) < 0.15) return;
          adb.shell(['input', 'keyevent', '4']); await sleep(1800);
        }
      },
      // (the device came back from its snapshot with the game on its title: `until title` takes it as it is)
      atTitle: () => Boolean(emu.warm && launched && !process.env.APP_LIVE_DEVICE && ready?.stamp && !ready.stamp.firstScreen),
      server: { joinUri, lan, logFile: serverLog, do: async (c) => bds(['do', c], { LAB_ADDON: addon }, 5 * 60_000) },
    });
    st.results = res.results; st.shots = res.shots; st.sections = res.sections; st.perf = res.perf; st.recordings = res.recordings.map((f) => rel(f));
    // the screens' own words: a translation key the client could not find shows as is (an addon's .lang missing a line).
    // Only the screens' pictures (shot ui-…, jsonui-…), read once the steps are done (OCR takes a moment a picture)
    if (C.ocrAvailable() && process.env.APP_OCR_KEYS !== '0') {
      for (const f of st.shots.filter((x) => /-(ui|jsonui)-[\w.-]+\.png$/.test(x))) {
        try { const k = C.rawKeys(C.ocrWords(f)); if (k.length) st.notes.push(`画面 ${path.basename(f, '.png').replace(/^\d+-/, '')} に、訳されていないキーらしい文字: ${k.slice(0, 6).join('、')}（texts/*.lang に行が無い？）`); } catch { /* unreadable */ }
      }
    }
    // the client's own errors (the game's content log: JSON UI, packs, scripts on the client), by section
    // (no file with the game's setting on: the client logged nothing — the game makes the file at its first line)
    st.client = { ...clientErrors(res.sections, { readable: Boolean(clientLog) }), found: Boolean(clientLog?.found), enabled: clientLog ? clientLog.setting() : null };
    if (clientLog && !clientLog.found && st.client.enabled !== true) st.notes.push(`ゲームのコンテンツログのファイルがありませんでした（${st.client.enabled === false ? 'ゲームの設定 content_log_file:0' : 'ゲームの設定を読めません'}）: クライアントのエラーは読めていません`);
    if (st.client.errors.length) {
      const allow = o.flags.has('--allow-client-errors') || process.env.APP_CLIENT_ERRORS === 'allow';
      st.notes.push(`ゲームのコンテンツログにエラーが ${st.client.errors.length} 行あります（クライアントにしか出ないエラー。報告の「クライアントのエラー」）${allow ? '（--allow-client-errors: 失敗にはしません）' : ''}`);
      if (!allow) st.clientFail = true;
    }
    // how long the join took: the join link → the player in the world (BDS: Player Spawned), and from the emulator's start
    const j = st.results.findIndex((r) => r.verb === 'join' && r.ok);
    const sp = j >= 0 ? st.results.slice(j).find((r) => r.verb === 'until' && /^until joined\b/.test(r.raw) && r.ok) : null;
    if (sp) {
      st.timing.join = sp.t1 - st.results[j].t0; st.timing.fromStart = sp.t1 - emuStarted;
      const target = Number(process.env.APP_JOIN_TARGET_MS) || 30_000;
      log(`      参加: ${(st.timing.join / 1000).toFixed(1)} 秒（参加リンク → ワールド）、端末の起動から ${(st.timing.fromStart / 1000).toFixed(1)} 秒`);
      if (st.timing.join > target) st.notes.push(`参加に ${(st.timing.join / 1000).toFixed(1)} 秒かかりました（目標 ${target / 1000} 秒）${emu.warm ? '' : ': 準備済みの端末（node lab.mjs app prepare）なら、起動済みのゲームから参加します'}`);
    }
  } catch (e) {
    if (!(e instanceof K.AppError)) { st.fatal = `ラボの不具合かもしれません: ${e.stack ?? e}`; }
    else st.fatal = e.message + (e.hint ? ` → ${e.hint}` : '');
  }
  await finish();
  process.exit(st.ok ? 0 : 1);
}

// ---- the private cache (lib/vault.mjs) and the prepared device (lib/warm.mjs) ----
// keys: what this run looks for in the cache (GitHub step outputs; on a terminal, printed). Asks Play which build it
// offers now (no download), so a cached APK / device is used only while it is still the current one
function setOutputs(o) {
  for (const [k, v] of Object.entries(o)) out(`  ${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${v}\n`).join(''));
}
function vaultState() {
  const allowed = V.vaultAllowed(), key = allowed.ok ? V.vaultKey() : null;
  return { allowed, key, on: Boolean(key) };
}
async function keysCmd(args) {
  const o = parse(args, { flags: ['--account'] });
  const account = o.flags.has('--account') || process.env.APP_ACCOUNT === '1';
  const vs = vaultState();
  if (!vs.allowed.ok) out(`W 非公開のキャッシュは使いません: ${vs.allowed.why}`);
  else if (!vs.key) out('W 非公開のキャッシュは使いません: 鍵の元（APP_CACHE_KEY か GOOGLE_AAS_TOKEN）がありません');
  // the emulator and system image the device is made from: named by the SDK cache that carries them (APP_SDK_KEY: the
  // workflow restores that cache later, in the jobs that need it), else read from this machine's SDK
  const sdkKey = process.env.APP_SDK_KEY;
  const rev = sdkKey ? { emulator: sdkKey, sysimg: sdkKey } : (D.ensureSdk({ log: out }), W.sdkRevisions());
  const play = K.playVersion({ toolsDir: path.join(LAB, 'tools'), log: out });
  if (play) out(`Google Play: Minecraft ${play.name} (${play.code}、端末 ${play.device})`);
  const id = vs.key?.id ?? 'none', stamp = W.wantStamp({ apkCode: play?.code ?? null, account, rev });
  const bdsV = (play && K.bdsCandidates(play.name, knownBds())[0]) || 'auto';
  setOutputs({
    vault: vs.on ? 'true' : 'false', play_code: play?.code ?? '', play_name: play?.name ?? '', bds: bdsV,
    key_avd: `app-avd-${id}-${W.stampKey(stamp)}`, key_base: `app-base-${id}-${W.stampKey(W.wantBase({ account, rev }))}`, key_apk: `app-apk-${id}-${play?.code ?? 'unknown'}`, key_bds: `app-bds-${id}-${bdsV}`,
    key_vending: `app-vending-${id}-${A.playstoreImage().replace(/[^\w.-]+/g, '_')}`, sdk: D.tools().sdk ?? '',
  });
}

/** the device's GPU as Android and the game see it (GLES version and renderer, Vulkan, the EGL driver), the frames the game
 *  presented, and the tail of the game's own log files: for a game that runs but shows nothing */
/** the frames a second the game's own surface showed over the last 10 s (SurfaceFlinger's latency of its layer), or null */
function gameFps(adb) {
  try {
    const layer = C.gameLayer(adb.shell(['dumpsys', 'SurfaceFlinger', '--list'], { timeout: 20_000 }).stdout, K.PACKAGE);
    return layer ? C.framesIn(adb.shell(['dumpsys', 'SurfaceFlinger', '--latency', layer], { timeout: 20_000 }).stdout, 10_000) / 10 : null;
  } catch { return null; }
}
function gpuFacts(adb) {
  const sh = (c) => adb.run(['shell', c], { timeout: 30_000 }).stdout.trim();
  const fps = gameFps(adb);
  return [`== ゲームの描画の速さ（SurfaceFlinger、直近 10 秒）==\n${fps === null ? 'ゲームの面が見つかりません' : `毎秒 ${fps.toFixed(1)} 枚`}`, '== GLES（SurfaceFlinger）==', sh('dumpsys SurfaceFlinger 2>/dev/null | grep -E "^GLES|EGL implementation|EGL_VERSION|^ *GL_VERSION" | head -6'),
    '== プロパティ ==', sh('getprop | grep -E "vulkan|egl|opengles|gfxstream|ro.kernel.qemu.gles|hwui.renderer|angle" | head -20'),
    '== ゲームのフレーム（gfxinfo）==', sh(`dumpsys gfxinfo ${K.PACKAGE} 2>/dev/null | grep -E "Total frames|Janky|percentile|Number" | head -8`),
    '== ゲーム自身のログ（games/com.mojang/logs、新しいものから）==', sh(`for f in $(ls -t /data/data/${K.PACKAGE}/games/com.mojang/logs/* 2>/dev/null | head -3); do echo "--- $f"; tail -c 6000 "$f"; done`)].join('\n') + '\n';
}

/** starts the game from its launcher icon; when no process shows up within 30 s, once more through am start (its answer is
 *  logged: a device that refuses says why). The game being there is waitTitle's to see */
async function launchGame(adb, { log = out } = {}) {
  adb.shell(['monkey', '-p', K.PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']);
  for (let k = 0; k < 15; k++) { if (adb.pid() > 0) return; await sleep(2000); }
  const comp = adb.shell(['cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', K.PACKAGE], { timeout: 30_000 }).stdout.trim().split('\n').pop();
  const r = adb.shell(['am', 'start', '-W', ...(/\//.test(comp ?? '') ? ['-n', comp] : ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', K.PACKAGE])], { timeout: 120_000 });
  log(`  ゲームが 30 秒で現れないので am start で起動します: ${(r.stdout + r.stderr).trim().split('\n').filter((l) => /Status|Error|Warning|Activity|TotalTime/.test(l)).slice(0, 4).join(' | ') || r.status}`);
}

/** the new player's title (Get started / More options) → the classic menu (Play, Settings…) by its More options. 1.26's
 *  new screens take the gamepad, and its first press only turns the focus on (on Get started — whose game mode screens B
 *  and ESC do not leave): DOWN, DOWN, A, read back by OCR. → 'classic' | 'as-is' (no OCR, or not that title) |
 *  'relaunched' (it did not get there: the game started again, its title as the game shows it) */
async function toClassicMenu(adb, { log = out, wait = Number(process.env.APP_PAD_WAIT_MS) || 3500 } = {}) {
  const look = () => { try { return ocrBuf(adb.screencap()) ?? []; } catch { return []; } };
  let w = look();
  if (!(C.findText(w, /^Get started$/i) && C.findText(w, /^More options$/i))) return 'as-is';
  for (const k of ['DOWN', 'DOWN', 'A']) { adb.pad(k); await sleep(wait); }
  for (let i = 0; i < 6; i++) {
    w = look();
    if (C.findText(w, /^Play$/i) && C.findText(w, /^Settings$/i)) { log('  クラシックのメニューにしました（More options: Play・Settings。実行の LAN の参加は A から）'); return 'classic'; }
    await sleep(wait);
  }
  log(`  W クラシックのメニューになりません（画面の文字: ${w.slice(0, 12).map((x) => x.text).join(' ')}）: ゲームを起動し直し、新しい人向けのタイトルのままにします`);
  adb.shell(['am', 'force-stop', K.PACKAGE]); await sleep(1500); await launchGame(adb, { log });
  return 'relaunched';
}
/** the player's own world on the device (lib/world.mjs; root): pushed, then put in the game's private com.mojang folder,
 *  owned by the game. The game lists it at its next start → { ok, note } */
function seedWorld(adb) {
  takeRoot(adb);
  const dir = fs.mkdtempSync(path.join(LAB, 'world-')), from = '/data/local/tmp/lab-world';
  try {
    for (const f of WD.worldFiles()) fs.writeFileSync(path.join(dir, f.path), f.data);
    adb.shell(['rm', '-rf', from]);
    const p = adb.run(['push', dir, from], { timeout: 60_000 });
    if (p.status !== 0) return { ok: false, note: `W 自分のワールドを置けません（push: ${(p.stderr || p.stdout).trim().slice(0, 160)}）` };
    const r = adb.run(['shell', WD.placeLine({ pkg: K.PACKAGE, from })], { timeout: 30_000 });
    const at = r.stdout.split('\n').filter((l) => l.startsWith('world ')).map((l) => l.slice(6).trim());
    return at.length ? { ok: true, note: `自分のワールド「${WD.WORLD_NAME}」を置きました（${at.join('、')}）: 新しい人として扱われず、Play が PLAY の画面を開く` }
      : { ok: false, note: `W 自分のワールドを置けません（ゲームの com.mojang のフォルダがありません: ${(r.stdout + r.stderr).trim().slice(0, 160)}）` };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/** the gamepad's focus brought onto the button with these words (1.26's menus move it by their layout: each direction tried
 *  in turn, the screen read after each press, the button green when it has the focus) → true when it got there */
async function focusOnWord(adb, re, { decode, tries = 14, wait = Number(process.env.APP_PAD_WAIT_MS) || 900 } = {}) {
  const order = ['UP', 'UP', 'UP', 'LEFT', 'LEFT', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'RIGHT', 'RIGHT', 'UP', 'LEFT', 'DOWN'];
  for (let i = 0; i <= tries; i++) {
    const b = adb.screencap(), words = ocrBuf(b) ?? [], w = words.find((x) => re.test(x.text));
    if (w) { try { if (C.buttonFocused(decode(b), w)) return true; } catch { /* undecodable: press on */ } }
    if (i === tries) break;
    adb.pad(order[i % order.length]); await sleep(wait);
  }
  return false;
}
/** the game signed in to the account of MS_EMAIL: from its menu's Sign In (the device's controller) into the Xbox library's
 *  WebView, page by page (lib/signin.mjs) — the e-mail and MS_PASSWORD typed through stdin, never a command line.
 *  Two-step verification: tell() says what a person must do (the number to approve; a code to send back, nextCode()).
 *  → { ok, note } */
async function signIn(adb, { decode, log = out, tell = async () => {}, nextCode = async () => null, timeoutMs = Number(process.env.APP_SIGNIN_MS) || 10 * 60_000 } = {}) {
  const S = await import('../common/secrets.mjs');
  const email = process.env.MS_EMAIL || S.readSecret(TOP, 'MS_EMAIL'), password = process.env.MS_PASSWORD || S.readSecret(TOP, 'MS_PASSWORD');
  if (!email) return { ok: false, note: 'サインインするアカウントがありません（MS_EMAIL: GitHub の secrets か .env.local に。MS_PASSWORD もあれば全部自動）' };
  if (!adb.padReady) { takeRoot(adb); D.startPad(adb, { labDir: LAB }); }
  const t0 = Date.now(), told = new Set(), enter = () => adb.shell(['input', 'keyevent', '66']), beat = Number(process.env.APP_PAD_WAIT_MS) || 800;
  // (the value from stdin into the WebView's field: not on this machine's command lines, not in any log)
  const type = (v) => adb.run(['shell', 'read -r v; input text "$v"'], { input: `${C.inputText(v)}\n`, timeout: 30_000 });
  const tellOnce = async (k, msg) => { if (told.has(k)) return; told.add(k); log(`  サインイン: ${msg}`); await tell(msg); };
  const tapWord = (words, re) => { const h = C.findText(words, re); if (h) adb.tap(h.x, h.y, 'tap'); return Boolean(h); };
  let began = false, lastKind = '';
  while (Date.now() - t0 < timeoutMs) {
    let b; try { b = adb.screencap(); } catch { await sleep(2000); continue; }
    const web = /com\.microsoft\.xal\.browser/.test(adb.focus().window ?? ''), words = ocrBuf(b) ?? [], p = SI.signinPage(words, { web });
    if (p.kind !== lastKind) log(`  サインイン: ${p.kind}${p.kind === 'approve' && p.number ? `（${p.number}）` : ''}`);
    lastKind = p.kind;
    // back in the game after the pages: signed in when its menu has no Sign In any more
    if (began && !web && p.kind !== 'title') {
      await sleep(Number(process.env.APP_SIGNIN_SETTLE_MS) || 4000);
      const again = ocrBuf(adb.screencap()) ?? [];
      if (!SI.signedOut(again)) return { ok: true, note: `サインインしました（${Math.round((Date.now() - t0) / 1000)} 秒）` };
    }
    switch (p.kind) {
      case 'title': {
        if (began) return { ok: false, note: 'サインインの画面から戻りましたが、まだ Sign In があります（取り消された？）' };
        if (!(await focusOnWord(adb, /^Sign$/i, { decode })) && !(await focusOnWord(adb, /^In$/i, { decode }))) log('  W Sign In に焦点を合わせられません: A を押してみます');
        adb.pad('A'); break;
      }
      case 'start': began = true; if (!tapWord(words, SI.SIGNIN_BUTTONS.start)) { const sz = pngSize(b); adb.tap(Math.round(sz.w / 2), Math.round(sz.h * 0.92), 'tap'); } break;
      case 'email': began = true; type(email); await sleep(beat); enter(); break;
      case 'password':
        if (password) { type(password); await sleep(beat); enter(); }
        else if (!tapWord(words, SI.SIGNIN_BUTTONS.otherWays)) await tellOnce('password', 'パスワードを聞かれています: MS_PASSWORD を secrets に入れるか、アカウントをパスワードなし（Authenticator）にしてください');
        break;
      case 'approve': await tellOnce(`approve${p.number}`, `スマホの Microsoft Authenticator でサインインを承認してください${p.number ? `（番号 ${p.number}）` : ''}`); break;
      case 'code': {
        await tellOnce('code', 'メールかスマホに届いたコードを送ってください: node lab.mjs app live "code 123456"');
        const c = await nextCode();
        if (c) { type(c); await sleep(beat); enter(); told.delete('code'); }
        break;
      }
      case 'stay': if (!tapWord(words, SI.SIGNIN_BUTTONS.stay)) enter(); break;
      case 'profile': if (!tapWord(words, SI.SIGNIN_BUTTONS.profile)) enter(); break;
      case 'error': return { ok: false, note: `サインインできません: ${p.message}` };
      default: if (!began) { const w2 = words.map((x) => x.text).join(' '); if (/Get started/.test(w2) && /More options/.test(w2)) { adb.pad('DOWN'); await sleep(beat); adb.pad('DOWN'); await sleep(beat); adb.pad('A'); } }
    }
    await sleep(Number(process.env.APP_SIGNIN_POLL_MS) || 3000);
  }
  return { ok: false, note: `${Math.round(timeoutMs / 60_000)} 分でサインインが終わりませんでした（最後の画面: ${lastKind}）` };
}
/** the faster of the two ways to picture the screen, of those that show the same thing → { via, note } (adb.shotVia) */
function pickShot(adb, decode) {
  if (adb.shotVia === 'emu') return { via: 'emu', note: 'エミュレータの画像（準備で決めたもの）' };
  const t0 = Date.now(), e = adb.emuScreencap(), te = Date.now() - t0, t1 = Date.now();
  let d = null; try { d = adb.screencap(); } catch { /* busy: the emulator's, if it has one */ }
  const td = Date.now() - t1, se = e ? pngSize(e) : null, sd = d ? pngSize(d) : null, black = Boolean(e && blankScreen(e, decode));
  if (e && se && (!sd || (se.w === sd.w && se.h === sd.h)) && !black) { adb.shotVia = 'emu'; return { via: 'emu', note: `エミュレータの画像（${te} ms。端末の screencap は ${td} ms）` }; }
  return { via: 'adb', note: `端末の screencap（${td} ms）${e ? `（エミュレータの画像: ${se ? `${se.w}x${se.h}` : '読めない'}${sd ? `、端末は ${sd.w}x${sd.h}` : ''}${black ? '、真っ黒' : ''}）` : '（エミュレータの画像は撮れません）'}` };
}
/** the words on a picture (tesseract), or null: no OCR on this machine, or it failed */
let OCR_OK = null;
function ocrBuf(png) {
  if (!png || !(OCR_OK ??= C.ocrAvailable())) return null;
  const f = path.join(LAB, `ocr-${process.pid}.png`);
  try { fs.writeFileSync(f, png); return C.ocrWords(f); } catch { return null; } finally { fs.rmSync(f, { force: true }); }
}
// the game on its title screen, ready to be kept (pure checks over what the device says; lib/warm.mjs uses it once per AVD)
async function waitTitle(adb, { decode, timeoutMs = Number(process.env.APP_TITLE_TIMEOUT) || 20 * 60_000, log = out, poll = Number(process.env.APP_TITLE_POLL_MS) || 3000, calmN = 5, settleMs = Number(process.env.APP_TITLE_SETTLE_MS ?? 20_000), blackMs = Number(process.env.APP_BLACK_MS) || 6 * 60_000 } = {}) {
  const t0 = Date.now(), end = t0 + timeoutMs;
  let prev = null, calm = 0, lastSay = 0, dialogs = 0, seen = false, blackSince = 0, useEmu = process.env.APP_SHOT === 'emu', emuTried = false, prompts = 0, lastOcr = 0, lastWords = null;
  // how a first-start screen's button is pressed: a different way at each try until one leaves the screen (that way is the
  // device's: adb.tapHow, kept in the stamp). Keys last: BACK closes such a screen, DOWN + ENTER moves to its second button
  let tried = null, goneLooks = 0, front = 0, away = 0;
  const ocrMs = Number(process.env.APP_TITLE_OCR_MS) || Math.min(8000, poll * 3);
  while (Date.now() < end) {
    const f = adb.focus();
    if (f.dialog) { dialogs++; log(`  Android のダイアログ「${f.dialog.proc}」: ${D.answerDialog(adb, f.dialog)}`); prev = null; calm = 0; await sleep(poll); continue; }
    // the game's license check (PairIP) said no: its own screen, then Play's purchase page. Starting again does not help
    if (/pairip\.licensecheck\.LicenseActivity|com\.android\.vending\/.*(MainActivity|Paywall)/.test(f.window ?? '')) {
      throw new K.AppError(`Minecraft のライセンス確認（Google Play）で止められました（画面: ${f.window}）`, 'Google アカウント（--account）と Play ストアが要ります。x86_64 版（APP_APK_X86=1）はエミュレータで止められることがあります: arm64 版で作り直してください（app prepare --force）。');
    }
    // the game sent behind (a BACK too many, a tap on Android's own bar): brought to the front again after 30 s
    if ((f.window ?? '').includes(K.PACKAGE)) { front = Date.now(); away = 0; }
    else if (front && !f.dialog && adb.pid() > 0) {
      if (!away) away = Date.now();
      else if (Date.now() - away > 30_000) { log(`  ゲームが前にいません（画面 ${f.window ?? '?'}）: 前に戻します`); adb.shell(['monkey', '-p', K.PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1']); away = 0; }
    }
    // (the process takes a moment to appear after the launch; gone after it was there = it ended)
    if (adb.pid() > 0) seen = true;
    else if (seen || Date.now() - t0 > 120_000) throw emulatorGone(adb) ?? (seen ? new K.AppError('Minecraft が起動の途中で終わりました', 'logcat の FATAL / ライセンスの行を見てください（--account が要ることがあります）。')
      : new K.AppError('Minecraft が起動しませんでした（2 分待ってもプロセスが現れない）', '端末が重すぎるか、描画（GPU）が壊れているかもしれません。画面（prepare-last*.png）と host.txt を見てください。'));
    let b = null; try { b = useEmu ? adb.emuScreencap() : adb.screencap(); } catch { /* busy */ }
    // the game running and the screen black all along: its drawing never started (the emulator's GPU refused what it
    // asks: EGL_BAD_ATTRIBUTE in the log). Said after blackMs, with the frames SurfaceFlinger saw from it, not 20 minutes later
    // a black screencap for a minute: the emulator's own picture of the display is asked once — if it shows something,
    // the device's screencap is what is black, and the emulator's picture is used from then on (APP_SHOT=emu from the start)
    if (seen && b && blankScreen(b, decode) && !useEmu && Date.now() - (blackSince || Date.now()) > 60_000 && !emuTried) {
      emuTried = true;
      const e = adb.emuScreencap();
      if (e && !blankScreen(e, decode)) { useEmu = true; adb.shotVia = 'emu'; log('  端末の screencap は黒いのに、エミュレータの画像には絵があります: これからはエミュレータの画像で見ます'); fs.writeFileSync(path.join(LAB, 'prepare-emushot.png'), e); b = e; }
    }
    if (seen && b && blankScreen(b, decode)) {
      if (!blackSince) blackSince = Date.now();
      else if (Date.now() - blackSince > blackMs) {
        try { const e = adb.emuScreencap(); if (e) fs.writeFileSync(path.join(LAB, 'prepare-emushot.png'), e); } catch { /* none */ }
        const layer = C.gameLayer(adb.shell(['dumpsys', 'SurfaceFlinger', '--list'], { timeout: 30_000 }).stdout, K.PACKAGE);
        const egl = adb.run(['shell', `logcat -d -t 400 2>/dev/null | grep -E "eglCreateContext|Vulkan|vk[A-Z]" | tail -3`], { timeout: 30_000 }).stdout.trim();
        // what the device's GPU is, and what the game itself wrote (its own log files): kept for the report
        try { fs.writeFileSync(path.join(LAB, 'prepare-gpu.txt'), gpuFacts(adb)); } catch { /* none */ }
        throw new K.AppError(`Minecraft は動いていますが、画面が ${Math.round(blackMs / 60_000)} 分真っ黒のままです（描画が始まらない。ゲームの面: ${layer ? 'ある' : '無い'}）`,
          `エミュレータの GPU（APP_GPU: いまは ${D.gpuMode()}）がゲームの求めるものを断っている形です${egl ? `: ${egl.split('\n').pop().slice(0, 200)}` : ''}。別の GPU の形（APP_GPU=swangle_indirect が既定で、ゲームが描ける形。手元なら host）か、ゲームの GL を ANGLE に（APP_GAME_GL=angle）して試してください。`);
      }
    } else blackSince = 0;
    // the title (not the red splash, not blank, the game in front). With OCR (every ocrMs): the game's first-start screens
    // ("WELCOME TO MINECRAFT!": Sign in now / Maybe later, …) are left by their not-now button, and the title is its Play
    // and Settings — its panorama never holds still, so a calm picture may never come. Without OCR: calm for calmN looks.
    // Then a moment more for what it loads behind it (the snapshot keeps whatever is still going on)
    if (b && (f.window ?? '').includes(K.PACKAGE) && titleLike(b, decode)) {
      const words = Date.now() - lastOcr >= ocrMs ? (lastOcr = Date.now(), ocrBuf(b)) : null;
      if (words) {
        // a dialog over the title the game shows a new player once ("Play your way": Continue). A new screen: it takes the
        // gamepad, not taps (the snapshot is kept without it)
        if (/Play your way|How will you play/i.test(words.map((w) => w.text).join(' '))) {
          // (B: Close. A on its Continue brought it back again and again on the CI device — the new player's way on)
          log('  「Play your way」を閉じます（ゲームパッドの B: Close）'); adb.pad('B');
          prev = null; calm = 0; await sleep(Number(process.env.APP_PRESS_WAIT_MS) || Math.max(poll, 2000)); continue;
        }
        const I = decode(b), hit = C.firstRunButton(words, { w: I.w, h: I.h });
        // every way tried twice and the screen still there: the game is up, drawn and licensed, on its first screen. Kept as
        // it is (a join link may still work from it: the run tries), with what the device knows about the game written down
        if (hit && prompts >= 2 * C.pressWays().length) {
          log(`  W ゲームの最初の画面から抜けられません（「${hit.text}」を${C.pressWays().map((w) => C.TAP_WAY_NAMES[w]).join('・')}で ${prompts} 回。画面の文字: ${words.slice(0, 12).map((w) => w.text).join(' ')}）: この画面のまま進みます`);
          try { fs.writeFileSync(path.join(LAB, 'prepare-gpu.txt'), gpuFacts(adb)); fs.writeFileSync(path.join(LAB, 'prepare-stuck.png'), b); } catch { /* none */ }
          return { ms: Date.now() - t0, dialogs, prompts, shot: b, stuck: hit.text };
        }
        // the last try left the screen (two looks without it: OCR misses words at times): that way works on this device
        if (!hit && tried && ++goneLooks >= 2) {
          if (C.TAP_WAYS.includes(tried)) { adb.tapHow = tried; log(`  ゲームの画面は「${C.TAP_WAY_NAMES[tried]}」で押せました（これからの押し方）`); }
          else log(`  ゲームの最初の画面は「${C.TAP_WAY_NAMES[tried]}」で抜けました`);
          tried = null;
        }
        if (hit) {
          goneLooks = 0;
          const ways = C.pressWays(process.env.APP_TAP), how = ways[prompts % ways.length];
          prompts++; prev = null; calm = 0; tried = how;
          log(`  ゲームの最初の画面（${words.slice(0, 6).map((w) => w.text).join(' ')}）: 「${hit.text}」を${C.TAP_WAY_NAMES[how]}で押します`);
          if (how === 'pad') { if (!adb.padReady) { takeRoot(adb); D.startPad(adb, { labDir: LAB }); } adb.pad('DOWN'); await sleep(Math.min(800, Number(process.env.APP_PRESS_WAIT_MS) || 800)); adb.pad('A'); }
          else if (how === 'back') adb.shell(['input', 'keyevent', '4']);
          else if (how === 'keys') { adb.shell(['input', 'keyevent', '20']); await sleep(Math.min(800, Number(process.env.APP_PRESS_WAIT_MS) || 800)); adb.shell(['input', 'keyevent', '66']); }
          else adb.tap(hit.x, hit.y, how);
          await sleep(Number(process.env.APP_PRESS_WAIT_MS) || Math.max(poll, 2000)); continue;
        }
        if (C.titleWords(words)) {
          if (tried && C.TAP_WAYS.includes(tried)) { adb.tapHow = tried; log(`  ゲームの画面は「${C.TAP_WAY_NAMES[tried]}」で押せました（これからの押し方）`); }
          log('  タイトル画面です（Play と Settings が読めました）'); await sleep(settleMs); return { ms: Date.now() - t0, dialogs, prompts, shot: adb.screencap() };
        }
        lastWords = words;
      }
      const d = prev ? screenDiff(prev, b, decode) : 1;
      calm = d < 0.02 ? calm + 1 : 0;
      // (with OCR, a calm screen it could not place is taken after three times as long, and its words said)
      if (calm >= (OCR_OK ? calmN * 3 : calmN)) {
        if (OCR_OK) log(`  タイトル画面とします（落ち着いた画面。Play と Settings は読めませんでした。文字: ${(lastWords ?? []).slice(0, 10).map((w) => w.text).join(' ') || 'なし'}）`);
        await sleep(settleMs); return { ms: Date.now() - t0, dialogs, prompts, shot: adb.screencap() };
      }
      prev = b;
    } else { prev = null; calm = 0; }
    if (Date.now() - lastSay > 60_000) { lastSay = Date.now(); const fps = seen ? gameFps(adb) : null; log(`  タイトル画面を待っています（${Math.round((Date.now() - t0) / 1000)} 秒、画面 ${f.window ?? '?'}${fps !== null ? `、ゲームの描画 毎秒 ${fps.toFixed(1)} 枚` : ''}${lastWords ? `、文字: ${lastWords.slice(0, 10).map((w) => w.text).join(' ')}` : ''}）`); }
    await sleep(poll);
  }
  try { fs.writeFileSync(path.join(LAB, 'prepare-gpu.txt'), gpuFacts(adb)); } catch { /* none */ }
  throw new K.AppError(`Minecraft が ${Math.round(timeoutMs / 60000)} 分でタイトル画面になりませんでした`, 'app/.lab/prepare-*.png（最後の画面）、gpu.txt（描画の速さとゲーム自身のログ）と emulator.log を見てください。');
}

// prepare: the device ready to join in seconds, kept for the next runs. From the private cache when it is there and still
// fits (the same APK as Play offers, emulator, image, hardware); else made once: a fresh device, the game installed, the
// account (--account), the game started to its title screen, the snapshot taken, the emulator stopped cleanly, sealed.
// The BDS for that game version too (--bds <版>, else the one that fits the app). GitHub step outputs: sealed=<parts>
async function prepareCmd(args) {
  const o = parse(args, { flags: ['--account', '--force', '--no-bds', '--no-device'], opts: ['--vending', '--bds'] });
  const account = o.flags.has('--account') || process.env.APP_ACCOUNT === '1';
  const t0 = Date.now(), secs = () => `${Math.round((Date.now() - t0) / 1000)} 秒`;
  const vs = vaultState(), P = W.parts(TOP, { bdsCache: path.join(BDS_DIR, '.lab') }), sealed = [];
  fs.mkdirSync(LAB, { recursive: true });
  for (const f of fs.readdirSync(LAB).filter((x) => /^prepare(\.txt|-.*\.(png|txt))$/.test(x))) fs.rmSync(path.join(LAB, f), { force: true });
  TEE = (l) => fs.appendFileSync(PREP_LOG, `${new Date().toISOString().slice(11, 19)} ${l}\n`);
  if (!vs.allowed.ok) out(`W 非公開のキャッシュは使いません: ${vs.allowed.why}`);
  const openPart = async (name) => {
    const f = W.vaultFile(TOP, name);
    if (!vs.key || !fs.existsSync(f)) return false;
    const ok = await V.open({ inFile: f, dest: P[name].base, key: vs.key, log: out });
    if (ok) out(`  キャッシュから${P[name].what}を戻しました（${secs()}）`);
    fs.rmSync(f, { force: true });   // (the disk: opened, or not ours)
    return ok;
  };
  const sealPart = async (name) => {
    if (!vs.key) return;
    const r = await V.seal({ base: P[name].base, entries: P[name].entries(), outFile: W.vaultFile(TOP, name), key: vs.key });
    sealed.push(name);
    out(`  ${P[name].what}を非公開のキャッシュに入れました（暗号化 ${(r.bytes / 2 ** 20).toFixed(1)} MB、${secs()}）`);
  };
  try {
    // 1. the device (--no-device: only the BDS, the device is cached already)
    let list = apkPaths();
    if (o.flags.has('--no-device')) out('  端末はキャッシュにあるので、ここでは作りません（--no-device）');
    else {
      if (emulatorRunning() || adbReady()?.booted()) { out('  動いているエミュレータを止めます（準備はエミュレータを止めて行います）'); await D.stopEmulator(adbReady(), LAB); }
      await openPart('avd'); W.cleanAvd();
      const playCode = Number(process.env.APP_PLAY_CODE) || null;
      const listCode = () => { try { return list ? K.inspectApks(list).versionCode : null; } catch { return null; } };
      const want = (code) => W.wantStamp({ apkCode: code, account });
      const have = W.readStamp(), diff = W.stampDiff(have, want(playCode ?? listCode()));
      if (!diff.length && !o.flags.has('--force')) out(`OK 端末は準備できています: Minecraft ${have.versionName} がタイトル画面で起動済み（${W.SNAPSHOT}、${secs()}）`);
      else {
        out(`端末を準備します（${have ? `違い: ${diff.join(', ')}` : '初めて'}）。初回は 10〜30 分かかります。次からはキャッシュから数十秒です`);
        PREP_MON = startMonitor(path.join(LAB, 'prepare-host.txt'), { dir: LAB });
        // a. the APK Play offers now. With the account Play installs the game on the device itself (the game's license
        //    check passes only for a game Play installed: one adb installed gets Play's paywall, even for the buying
        //    account) and no APK is needed; APP_INSTALL_VIA=adb installs ours instead (no account: always adb)
        const viaPlay = (process.env.APP_INSTALL_VIA || (account ? 'play' : 'adb')) === 'play';
        if (viaPlay && !account) fail('APP_INSTALL_VIA=play には --account が要ります', 'Play がゲームを入れるには、買ったアカウントが端末に要ります。');
        if (!viaPlay && (!list || (playCode && listCode() !== playCode))) { await openPart('apk'); list = apkPaths(); }
        if (!viaPlay && (!list || (playCode && listCode() !== playCode))) {
          out('  APK を Google Play から取ります');
          await apkFetch({ acceptTos: true }); list = apkPaths();
          await sealPart('apk');
        }
        let info = viaPlay ? null : K.inspectApks(list);
        if (viaPlay) fs.rmSync(W.vaultFile(TOP, 'apk'), { force: true });   // (the disk: a cached APK is not needed)
        // b. the Play Store for the license check (--account): from the cache, else taken out of Google's image once
        if (account && vendingOn() && !o.opts['--vending'] && !process.env.APP_VENDING_APK && !process.env.APP_VENDING_URL && !A.extractedVending(LAB)) {
          if (!(await openPart('vending')) || !A.extractedVending(LAB)) {
            await A.extractVending({ labDir: LAB, log: out, cleanup: true });
            await sealPart('vending');
          }
        }
        // c. the device. With the account: its base from the cache when it fits (Play Store in /system, the account written,
        //    Google's first-boot work done, no game: a cold boot, and the same Google registration as before), else a fresh
        //    one, set up, then kept as the base before the game goes on it. The game's first start up to its title follows
        const writable = account && vendingOn(), wantB = W.wantBase({ account }), adb = adbReady(), baseOn = account && process.env.APP_BASE !== '0';
        const boot = async (how) => {
          out(`  エミュレータを起動します（${how}${writable ? '、/system 書き込み可' : ''}）`);
          D.startEmulator({ labDir: LAB, wipe: how === '新しいデータ', writableSystem: writable, log: out });
          spawnSync(adb.bin, ['start-server'], { timeout: 30_000, env: K.cleanEnv() });
          await D.waitBoot(adb, { log: out });
          out(`  起動しました（${secs()}）`);
        };
        let fromBase = false;
        if (baseOn && !o.flags.has('--force') && await openPart('base')) {
          const d = W.stampDiff(W.readBase(), wantB);
          if (!d.length) fromBase = true; else out(`  端末の土台は使えません（違い: ${d.join(', ')}）: 新しく作ります`);
        }
        if (fromBase) {
          // (a base carries no title snapshot of its own; a stale one would only cost disk)
          W.cleanAvd(); W.dropStamp(); fs.rmSync(path.join(W.avdDir(), 'snapshots'), { recursive: true, force: true });
          D.ensureAvd({ log: out });
          await boot('端末の土台から: Play ストアとアカウント入り、ゲームなし');
          D.quietDevice(adb);
          await settle(adb, { log: out, maxMs: Number(process.env.APP_SETTLE_MS ?? 480_000) });
        } else {
          fs.rmSync(W.avdDir(), { recursive: true, force: true }); fs.rmSync(path.join(D.avdHome(), `${D.AVD}.ini`), { force: true });
          D.ensureAvd({ log: out });
          await boot('新しいデータ');
          // a first boot keeps the CPU busy for minutes (Google's apps compiled, set up): installing and starting the game
          // into that left Android itself not answering on a 2-core CI runner. The rest waits until it is calm
          D.quietDevice(adb);
          await settle(adb, { log: out, maxMs: Number(process.env.APP_SETTLE_MS ?? 480_000) });
          if (account) {
            await setupAccount(adb, { vending: o.opts['--vending'], log: out });
            // after the account Google's services set up and Play updates itself and the apps: on 2 cores that is a storm
            // of 10+ minutes in which nothing answers (System UI, Play's page). Waited out here, once: the base keeps the
            // calm device (APP_BASE_SETTLE_MS, else 25 minutes)
            await settle(adb, { log: out, maxMs: Number(process.env.APP_BASE_SETTLE_MS ?? (baseOn ? 1_500_000 : Number(process.env.APP_SETTLE_MS ?? 480_000))) });
            if (baseOn && vs.key) {
              out('  ここまで（Play ストアとアカウント入り、ゲームなし）を端末の土台としてキャッシュに入れます（次に Minecraft が更新されたら、ここから）');
              // (deleted downloads handed back first: the base is kept smaller), then Android shut down the proper way (its
              // files written out: the account, Play's state), then the emulator
              { const before = W.duBytes(W.avdDir()), t = D.trimFree(adb); out(`  消したファイルの領域を返しました（fstrim: ${t || '?'}。端末のファイル ${(before / 2 ** 30).toFixed(1)} → ${(W.duBytes(W.avdDir()) / 2 ** 30).toFixed(1)} GB）`); }
              adb.run(['shell', 'sync; reboot -p'], { timeout: 60_000 });
              for (const end = Date.now() + 90_000; emulatorRunning() && Date.now() < end;) await sleep(1000);
              await D.stopEmulator(adb, LAB); W.cleanAvd();
              W.writeBase(wantB, { writable });
              await sealPart('base');
              await boot('土台から起動し直し');
              await settle(adb, { log: out, maxMs: 240_000 });
            }
          }
        }
        if (!viaPlay) install(adb, list, info);
        // (CI disk: the game is on the device now and the APK in the cache; this machine keeps its own)
        if (list && process.env.GITHUB_ACTIONS === 'true' && list.every((f) => f.startsWith(APKDIR))) { fs.rmSync(path.join(APKDIR, 'download'), { recursive: true, force: true }); list = null; }
        // root first (adbd restarts for it, which would cut the log below): what the device knows about the license is in
        // files only root reads (the snapshot is taken as root anyway)
        takeRoot(adb);
        // from here everything the device logs is kept, the buffer since the account's reboot included: how Google's
        // services registered the device and the account, what Play synced, how the game's license was decided
        const lcFile = path.join(LAB, 'prepare-logcat.txt');
        const lcFd = fs.openSync(lcFile, 'w'), lc = spawn(adb.bin, ['-s', adb.serial, 'logcat', '-v', 'threadtime'], { stdio: ['ignore', lcFd, lcFd], env: K.cleanEnv() });
        const lcEnd = (n) => { try { lc.kill(); } catch { /* gone */ } try { fs.closeSync(lcFd); } catch { /* closed */ } const t = fs.readFileSync(lcFile, 'utf8'); return { t, game: t.split('\n').filter((l) => / I Minecraft: /.test(l)).slice(-n).map((l) => l.replace(/^.*? I Minecraft: /, '')) }; };
        const { pngDecode } = await import(pathToFileURL(path.join(TOP, 'common', 'extra.mjs')).href);
        // (a game just installed is compiled in the background: calm again before its first start)
        if (!viaPlay) await settle(adb, { log: out, maxMs: 240_000 });
        // the game straight from Play (APP_INSTALL_VIA=play): Play's page for it, its Install button, Play installs it
        if (viaPlay) {
          const page = await L.readPlayPage(adb, { pkg: K.PACKAGE, log: out, gone: () => emulatorGone(adb) });
          if (page.shot) fs.writeFileSync(path.join(LAB, 'prepare-play-0.png'), page.shot);
          out(`  Play のページ: ${page.action ? `「${page.label}」` : '分かりません'}（${page.via ?? '読めず'}: ${page.texts.slice(0, 12).join(' / ')}）`);
          if (!['install', 'update'].includes(page.action)) fail(`Play がゲームを入れられる状態ではありません（${page.action ?? '画面が読めません'}）`, page.action === 'buy' ? 'Play はこのアカウントが Minecraft を持っていないと見ています（値段が出ている）: アカウントと購入を確かめてください。' : 'app/.lab/prepare-play-0.png を見てください。');
          const f = await L.playInstall(adb, { pkg: K.PACKAGE, page, log: out, gone: () => emulatorGone(adb) });
          info = { versionName: f.versionName, versionCode: f.versionCode, abis: f.primaryCpuAbi ? [f.primaryCpuAbi] : [] };
          out(`  Play が Minecraft ${f.versionName} (${f.versionCode}${f.primaryCpuAbi ? `、${f.primaryCpuAbi}` : ''}) を入れました（${secs()}）`);
          // (Play grants nothing up front: the permission questions would sit over the game's first start)
          const granted = D.grantAll(adb, K.PACKAGE, A.requestedPerms(adb.shell(['dumpsys', 'package', K.PACKAGE], { timeout: 30_000 }).stdout));
          if (granted.length) out(`  ゲームの権限を先に許可しました（${granted.length} 個）`);
          // Play's page (pictures, a video) costs the software GPU and memory: closed before the game starts, and the device
          // let calm down (an install compiles the game: minutes of CPU on 2 cores)
          adb.shell(['input', 'keyevent', '3']); adb.shell(['am', 'force-stop', L.VENDING]);
          await settle(adb, { log: out, maxMs: Number(process.env.APP_SETTLE_MS ?? 480_000) });
        }
        // (Play's download of the game and the like, deleted but still in the disk image: handed back before the game starts)
        { const before = W.duBytes(W.avdDir()), t = D.trimFree(adb); out(`  消したファイルの領域を返しました（fstrim: ${t || '?'}。端末のファイル ${(before / 2 ** 30).toFixed(1)} → ${(W.duBytes(W.avdDir()) / 2 ** 30).toFixed(1)} GB）`); }
        // SurfaceFlinger latching frames whose rendering has not finished: a frame the software GPU takes seconds to draw is no
        // GPU hang ("Buffer processing hung up due to stuck fence" stopped the game at its join on CI). It reads that once,
        // at its start: the framework started again with it (once, before the game; the snapshot keeps it). APP_LATCH_UNSIGNALED=0: not
        // and Android's own knob for a slow device (ro.hw_timeout_multiplier, as Cuttlefish sets it): every ANR deadline times
        // N (input 5 s → 25 s). On 2 CPUs the game and Android's own UI thread missed 5 s again and again: "isn't responding"
        // over the PLAY screen. A ro. property is set once, while unset; both are read when the framework starts again
        // (APP_TIMEOUT_MULTIPLIER=1: as it is. Not hide_error_dialogs: with the dialogs hidden Android kills the app at an ANR)
        const fw = {}, mult = process.env.APP_TIMEOUT_MULTIPLIER ?? '5';
        if (process.env.APP_LATCH_UNSIGNALED !== '0') fw['debug.sf.latch_unsignaled'] = '1';
        if (/^\d+$/.test(mult) && Number(mult) > 1 && !adb.prop('ro.hw_timeout_multiplier')) fw['ro.hw_timeout_multiplier'] = mult;
        if (Object.keys(fw).length) {
          const ms = await D.frameworkWith(adb, fw);
          if (ms !== null) out(`  Android の枠組みを起動し直しました（${[fw['debug.sf.latch_unsignaled'] ? '画面合成は描き終わらない絵も待たない' : '', fw['ro.hw_timeout_multiplier'] ? `応答なしの判定を ${mult} 倍待つ（${adb.prop('ro.hw_timeout_multiplier') || '?'}）` : ''].filter(Boolean).join('、')}、${(ms / 1000).toFixed(0)} 秒）`);
        }
        // APP_GAME_GL=angle: the game's GL through ANGLE (the emulator's own EGL refused a context the game asks for)
        if (process.env.APP_GAME_GL === 'angle') { const where = D.useAngle(adb, K.PACKAGE); out(`  ゲームの GL を ANGLE にします（${where || 'ANGLE が見当たりません: 効かないかもしれません'}）`); }
        out(`  Minecraft を起動して、タイトル画面を待ちます（${secs()}）`);
        // up to 3 starts. One the license check stops: what the device knows is written down (prepare-license-<n>.txt),
        // then the fixes, one per failed start (APP_LICENSE_FIX, in order): page = open Play's page for the game (Play looks
        // at the account's library again; its button says whether Play thinks the account owns the game), play = when
        // that page offers Install / Update, let Play do it (Play is then the game's real installer, as on a phone)
        const fixes = (process.env.APP_LICENSE_FIX ?? 'page,play').split(',').map((x) => x.trim()).filter(Boolean), tried = new Set();
        let title;
        for (let attempt = 1; ; attempt++) {
          // (from the home screen: what an earlier start left on top, the Play Store's page included, does not count)
          adb.shell(['input', 'keyevent', '3']); await sleep(1500);
          const since = fs.existsSync(lcFile) ? fs.statSync(lcFile).size : 0;
          await launchGame(adb, { log: out });
          try { title = await waitTitle(adb, { decode: pngDecode }); break; }
          catch (e) {
            try { fs.writeFileSync(path.join(LAB, `prepare-last${attempt}.png`), adb.screencap()); } catch { /* none */ }
            // what the license check did this time (the game asks the Play Store; the Play Store answers from the library)
            const t = fs.existsSync(lcFile) ? fs.readFileSync(lcFile).subarray(since).toString('utf8') : '';
            out(`  ライセンス確認: ${/Calling checkLicense on service|Sending request to licensing service/.test(t) ? 'Play ストアに問い合わせた' : '問い合わせる前に止まった'}${/License check succeeded|allowed reason: LICENSED/.test(t) ? '、通った（LICENSED）' : ''}${/library ownership/.test(t) ? '、購入済みと分かった' : ''}${/LicenseActivity/.test(t) ? '、ライセンスの画面が出た' : ''}${/paywall/i.test(t) ? '、Play の購入ページへ' : ''}${/Scheduling install request package_name=com\.mojang/.test(t) ? '（Play が Minecraft を更新しようとしていた）' : ''}`);
            const again = /起動の途中で終わりました|起動しませんでした|ライセンス確認/.test(e.message) && !emulatorGone(adb);
            if (again) {
              adb.shell(['am', 'force-stop', K.PACKAGE]);
              const facts = L.licenseFacts(adb, { pkg: K.PACKAGE });
              facts.lines.forEach((x) => out(`    ${x}`));
              const all = fs.existsSync(lcFile) ? fs.readFileSync(lcFile, 'utf8') : '';
              fs.writeFileSync(path.join(LAB, `prepare-license-${attempt}.txt`), [...facts.lines, '', '--- Play・Google のサービスのログ（アカウントの登録・同期・ライセンスの判断）---', ...L.playLines(all)].join('\n') + '\n');
              const fix = fixes.find((x) => !tried.has(x) && ['page', 'play'].includes(x));
              if (attempt < 3 && fix) {
                tried.add('page');
                const page = await L.readPlayPage(adb, { pkg: K.PACKAGE, log: out, gone: () => emulatorGone(adb) });
                if (page.shot) fs.writeFileSync(path.join(LAB, `prepare-play-${attempt}.png`), page.shot);
                out(`  Play のページ: ${page.action ? `「${page.label}」` : '分かりません'}（${page.via ?? '読めず'}: ${page.texts.slice(0, 12).join(' / ')}）`);
                if (fixes.includes('play') && !tried.has('play') && ['install', 'update'].includes(page.action)) {
                  tried.add('play');
                  out(`  Play に${page.action === 'update' ? '更新' : 'インストール'}させます（Play がゲームを入れたことになる）`);
                  try {
                    const f = await L.playInstall(adb, { pkg: K.PACKAGE, page, log: out, gone: () => emulatorGone(adb) });
                    info = { versionName: f.versionName, versionCode: f.versionCode, abis: f.primaryCpuAbi ? [f.primaryCpuAbi] : info?.abis ?? [] };
                    out(`  Play が Minecraft ${f.versionName} (${f.versionCode}) を入れました`);
                    D.grantAll(adb, K.PACKAGE, A.requestedPerms(adb.shell(['dumpsys', 'package', K.PACKAGE], { timeout: 30_000 }).stdout));
                  } catch (x) { out(`  W ${x.message}`); }
                }
                adb.shell(['input', 'keyevent', '3']); adb.shell(['am', 'force-stop', L.VENDING]);
                await settle(adb, { log: out, maxMs: 240_000 });
                out(`  ${attempt} 回目は失敗しました。Play のページを見た後で、もう一度起動します`);
                continue;
              }
              if (attempt < 3) { out(`  ${attempt} 回目は失敗しました。少し待って、もう一度起動します`); await sleep(Number(process.env.APP_RETRY_WAIT_MS ?? 30_000)); await settle(adb, { log: out, maxMs: 240_000 }); continue; }
            }
            lcEnd(0);   // (the log stays in prepare-logcat.txt; the report makes its digest and the lines around the end)
            // the game's settings as far as it got (which switches this version has: graphics, rendering threads, the
            // content log) go with the report
            try { const o = adb.run(['shell', `cat ${C.OPTIONS(K.PACKAGE)}`], { timeout: 20_000 }).stdout; if (o.trim()) fs.writeFileSync(path.join(LAB, 'prepare-options.txt'), o); } catch { /* none yet */ }
            throw e;
          }
        }
        const l = lcEnd(12);
        fs.writeFileSync(path.join(LAB, 'prepare-title.png'), title.shot);
        // the game's own settings as it wrote them on its first start (which switches exist on this version: graphics, the
        // content log): kept beside the log of this prepare
        const opts = adb.run(['shell', `cat /data/data/${K.PACKAGE}/games/com.mojang/minecraftpe/options.txt`], { timeout: 20_000 }).stdout;
        if (opts.trim()) { fs.writeFileSync(path.join(LAB, 'prepare-options.txt'), opts); out(`  ゲームの設定（options.txt）: ${opts.trim().split('\n').length} 項目 → app/.lab/prepare-options.txt`); }
        out(`  ${title.stuck ? `ゲームは最初の画面（「${title.stuck}」が効かない）のまま準備を続けます` : 'タイトル画面になりました'}（起動から ${(title.ms / 1000).toFixed(0)} 秒${title.dialogs ? `、Android のダイアログ ${title.dialogs} 回` : ''}、${secs()}）`);
        if (l.game.length) { out('  ゲームが最後に言ったこと:'); l.game.forEach((x) => out(`    ${x.slice(0, 200)}`)); }
        // the content log to a file (the client's own errors: JSON UI, packs, scripts): whatever this version calls that
        // switch (a key with "content log" in it, not the on-screen one) turned on, and the game started once more so it
        // takes it; the snapshot keeps it. APP_CONTENT_LOG=0: left as it is
        const sw = process.env.APP_CONTENT_LOG === '0' ? [] : C.contentLogSwitches(opts);
        if (!sw.length && opts.trim() && process.env.APP_CONTENT_LOG !== '0') out(`  コンテンツログのスイッチ（content log を名前に持つキー）は options.txt にありません（log を含むキー: ${Object.keys(C.readOptions(opts)).filter((k) => /log/i.test(k)).slice(0, 12).join(', ') || 'なし'}）`);
        // and the menus still (no screen animations, no panorama scrolling): less to draw for a software GPU, and a screen
        // that holds still once drawn (APP_FAST_UI=0: as the game set them)
        // and the world drawn as lightly as it still looks like the game (APP_LIGHT_GFX=0: as the game set it)
        const fast = { ...(process.env.APP_FAST_UI === '0' ? {} : C.fastUiSwitches(opts)), ...(process.env.APP_LIGHT_GFX === '0' ? {} : C.lightGfxSwitches(opts)) };
        // and a world of the player's own (lib/world.mjs), put in while the game is stopped: the next start sees a player
        // with a world, whose Play opens the PLAY screen (APP_SEED_WORLD=0: none)
        const seed = W.seedWanted();
        if (sw.length || Object.keys(fast).length || seed) {
          const what = [...sw.map((k) => `${k}:1`), ...Object.entries(fast).map(([k, v]) => `${k}:${v}`)];
          if (what.length) out(`  ゲームの設定を変えて起動し直します（${what.join(', ')}: ${sw.length ? 'コンテンツログをファイルに、' : ''}${Object.keys(fast).length ? 'メニューの動きを止め、新しい人向けの画面を閉じ、描画を軽く' : ''}）`);
          adb.shell(['am', 'force-stop', K.PACKAGE]); await sleep(1500);
          if (what.length) {
            const w = adb.run(['shell', `cat > ${C.OPTIONS(K.PACKAGE)}`], { input: C.patchOptions(opts, { ...Object.fromEntries(sw.map((k) => [k, '1'])), ...fast }), timeout: 20_000 });
            if (w.status !== 0) out(`  W options.txt に書けませんでした: ${(w.stderr || w.stdout).trim().slice(0, 160)}`);
          }
          if (seed) out(`  ${seedWorld(adb).note}`);
          await launchGame(adb, { log: out });
          title = await waitTitle(adb, { decode: pngDecode });
          fs.writeFileSync(path.join(LAB, 'prepare-title.png'), title.shot);
          out(`  起動し直して、${title.stuck ? '最初の画面に戻りました' : 'タイトル画面に戻りました'}（${(title.ms / 1000).toFixed(0)} 秒）`);
        }
        // the classic menu kept in the snapshot, not the new player's title: a run's LAN join then starts with A on its Play
        // (APP_CLASSIC_MENU=0: as the game shows it). Through the device's controller (root: uinput)
        if (process.env.APP_CLASSIC_MENU !== '0') {
          takeRoot(adb); { const pd = D.startPad(adb, { labDir: LAB }); out(`  ${pd.note}`); }
          const m = await toClassicMenu(adb);
          if (m === 'relaunched') { title = await waitTitle(adb, { decode: pngDecode }); fs.writeFileSync(path.join(LAB, 'prepare-title.png'), title.shot); }
          else if (m === 'classic') { title = { ...title, stuck: null, shot: adb.screencap() }; fs.writeFileSync(path.join(LAB, 'prepare-title.png'), title.shot); }
        }
        // the account signed in (MS_EMAIL; MS_PASSWORD or a person's approval on the live issue): friends' worlds and servers
        // joined by address take it, and the snapshot keeps the session for every run after
        if (W.signinWanted()) {
          const r = await signIn(adb, { decode: pngDecode, ...liveChannel({ secrets: SI.secretsOf() }) });
          if (!r.ok) fail(r.note, 'MS_EMAIL / MS_PASSWORD（GitHub の secrets）を確かめるか、二段階の確認ならライブの issue の指示どおりに。サインインなしで作るなら APP_SIGNIN=0');
          out(`  ${r.note}`);
        }
        // d. kept: the snapshot (the RAM with the game in it), the stamp, a clean stop. The emulator writes the whole RAM:
        // it refuses without that much room ("Not enough disk space": a 14 GB CI runner ran out here)
        const hostFree = (() => { try { const f = fs.statfsSync(D.avdHome()); return f.bavail * f.bsize; } catch { return null; } })();
        const guest = adb.shell(['df', '-k', '/data'], { timeout: 20_000 }).stdout.trim().split('\n').pop()?.trim().split(/\s+/) ?? [];
        out(`  ディスク: このパソコンの空き ${hostFree === null ? '?' : (hostFree / 2 ** 30).toFixed(1)} GB、端末の /data 使用 ${guest[2] ? (Number(guest[2]) / 2 ** 20).toFixed(1) : '?'} GB、AVD ${(W.duBytes(W.avdDir()) / 2 ** 30).toFixed(1)} GB`);
        // root now, so a run from the snapshot is root at once (its content log, held keys) with no adbd restart
        takeRoot(adb);
        // APP_ZERO_FREE=1: the device's free space written over with zeros (what deleted files left in the disk image is let go
        // below). Off by default: the emulator's /data is encrypted under the file system (dm-crypt), so the zeros reach the
        // disk image as ciphertext — on CI it grew the image by 1.4 GB instead of freeing 3.4 GB
        if (process.env.APP_ZERO_FREE === '1') { const t = Date.now(), z = D.zeroFree(adb); out(`  端末の空きをゼロで埋めました（${z || '?'}、${((Date.now() - t) / 1000).toFixed(0)} 秒）`); }
        const r = adb.run(['emu', 'avd', 'snapshot', 'save', W.SNAPSHOT], { timeout: 15 * 60_000 });
        if (r.status !== 0 || !/^OK/m.test(r.stdout)) fail('スナップショットを保存できませんでした', (r.stdout + r.stderr).trim().slice(0, 300));
        // (the version Play offers, as the cache's name says: a game Play updated on the device is still that offer's)
        W.writeStamp(want(playCode ?? info.versionCode), { versionName: info.versionName, abis: info.abis, writable, installedCode: info.versionCode, shot: adb.shotVia ?? 'adb', tap: adb.tapHow ?? 'tap', ...(title.stuck ? { firstScreen: title.stuck } : {}) });
        out(`  スナップショット ${W.SNAPSHOT} を保存しました（${secs()}）`);
        await D.stopEmulator(adb, LAB);
        W.cleanAvd();
        // (the zeros in the disk image and the RAM as holes: nothing for the cache to carry, nothing to write back on a restore)
        { const h = W.digHoles(W.avdDir()); if (h) out(`  端末のファイルの中のゼロを穴にしました（ディスク上 ${(h.before / 2 ** 30).toFixed(1)} → ${(h.after / 2 ** 30).toFixed(1)} GB）`); }
        // how this device was made travels with it (the runs that start from it, on other machines, show it)
        const keep = path.join(W.avdDir(), 'lab-prepare');
        fs.rmSync(keep, { recursive: true, force: true }); fs.mkdirSync(keep, { recursive: true });
        for (const f of fs.readdirSync(LAB).filter((x) => /^prepare(\.txt|-.*\.(png|txt))$/.test(x) && x !== 'prepare-logcat.txt')) fs.copyFileSync(path.join(LAB, f), path.join(keep, f));
        await sealPart('avd');
      }
    }
    // 2. the BDS for this game version
    if (!o.flags.has('--no-bds')) {
      const stamp = W.readStamp();
      const vName = stamp?.versionName ?? (list ? K.inspectApks(list).versionName : null) ?? (process.env.APP_PLAY_NAME || null);
      const cands = o.opts['--bds'] ? [o.opts['--bds']] : K.bdsCandidates(vName, knownBds());
      if (!cands.length) out('W BDS の版を決められません（アプリの版が分かりません）');
      else {
        const now = () => { try { return fs.readFileSync(path.join(BDS_DIR, '.lab', 'bds', 'VERSION'), 'utf8').trim(); } catch { return null; } };
        if (!cands.includes(now())) await openPart('bds');
        let got = null, fetched = false;
        for (const v of cands) {
          const r = bds(['bds', v]);
          if (r.ok) { got = v; fetched = !r.lines.some((l) => /\(already\)/.test(l)); break; }
          out(`  BDS ${v} は用意できません: ${r.lines.filter((l) => /ERR|cannot|E /.test(l)).slice(0, 1).join('') || r.lines.at(-1) || '?'}`);
        }
        if (!got) fail('BDS を用意できませんでした', `--bds <版> で指定できます（アプリ ${vName}）`);
        const setup = bds(['setup']);
        if (!setup.ok) fail('BDS の準備（テンプレートのワールドなど）に失敗しました', setup.lines.slice(-3).join('\n'));
        if (fetched) await sealPart('bds');
        out(`OK BDS ${got}${fetched ? '' : '（用意済み）'}（${secs()}）`);
      }
    }
  } catch (e) {
    // a failed prepare still leaves a run folder (the workflow uploads app/runs/, the report job posts it): its log, the
    // last screen, the game's logcat digest, the emulator's log
    const known = e instanceof K.AppError;
    TEE?.(`ERR ${known ? e.message : `ラボの不具合かもしれません: ${e?.stack ?? e}`}${known && e.hint ? `\n  → ${e.hint}` : ''}`);
    TEE = null;
    try { out(`  準備の記録: ${rel(prepareReport(e))}/（report.md・license.txt・shots）`); } catch { /* the error itself is what matters */ }
    throw e;
  } finally {
    TEE = null;
    PREP_MON?.stop(); PREP_MON = null;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `sealed=${sealed.join(' ')}\n${sealed.map((n) => `sealed_${n}=true\n`).join('')}`);
  }
}
function prepareReport(e) {
  const dir = path.join(RUNS, `${stampLocal()}-prepare`);
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  const logTxt = fs.existsSync(PREP_LOG) ? fs.readFileSync(PREP_LOG, 'utf8') : '';
  fs.writeFileSync(path.join(dir, 'run.txt'), logTxt);
  let k = 0;
  for (const f of fs.readdirSync(LAB).filter((x) => /^prepare-.*\.png$/.test(x))) fs.copyFileSync(path.join(LAB, f), path.join(dir, 'shots', `${String(++k).padStart(2, '0')}-${f}`));
  const lcf = path.join(LAB, 'prepare-logcat.txt');
  if (fs.existsSync(lcf)) {
    const t = fs.readFileSync(lcf, 'utf8'), d = deathExcerpt(t, K.PACKAGE);
    fs.writeFileSync(path.join(dir, 'logcat.txt'), t); fs.writeFileSync(path.join(dir, 'logcat-digest.txt'), logcatDigest(t, K.PACKAGE).join('\n') + '\n');
    if (d.length) fs.writeFileSync(path.join(dir, 'logcat-death.txt'), d.join('\n') + '\n');
  }
  if (fs.existsSync(path.join(LAB, 'emulator.log'))) { const b = fs.readFileSync(path.join(LAB, 'emulator.log')); fs.writeFileSync(path.join(dir, 'emulator.log'), b.subarray(Math.max(0, b.length - 2e6))); }
  // the machine while the device was made (every 15 s): memory, load, disk, the biggest processes
  PREP_MON?.now();
  if (fs.existsSync(path.join(LAB, 'prepare-host.txt'))) fs.copyFileSync(path.join(LAB, 'prepare-host.txt'), path.join(dir, 'host.txt'));
  const machine = PREP_MON ? hostNotes(PREP_MON.worst) : [];
  // what the device knew about the license at each failed start, and Play's / Google's own lines
  // (facts of every failed start in license.txt; Play's and the services' lines, as of the last one, in license-log.txt)
  const lic = fs.readdirSync(LAB).filter((x) => /^prepare-license-\d+\.txt$/.test(x)).sort(), split = (f) => { const t = fs.readFileSync(path.join(LAB, f), 'utf8'), i = t.indexOf('\n--- '); return i < 0 ? [t.trim(), ''] : [t.slice(0, i).trim(), t.slice(i + 1).trim()]; };
  if (lic.length) {
    fs.writeFileSync(path.join(dir, 'license.txt'), lic.map((f) => `===== ${f.replace(/^prepare-license-(\d+)\.txt$/, '$1 回目の起動の後')} =====\n${split(f)[0]}\n`).join('\n'));
    fs.writeFileSync(path.join(dir, 'license-log.txt'), `${split(lic.at(-1))[1]}\n`);
  }
  const facts = lic.length ? split(lic.at(-1))[0].split('\n') : [];
  // (the game's settings without its key bindings, touch button places and tip counters: those are most of the file and
  // say nothing here; the rest fits the report whole)
  if (fs.existsSync(path.join(LAB, 'prepare-options.txt'))) fs.writeFileSync(path.join(dir, 'game-options.txt'), fs.readFileSync(path.join(LAB, 'prepare-options.txt'), 'utf8').split('\n').filter((l) => !C.OPTIONS_NOISE.test(l)).join('\n'));
  if (fs.existsSync(path.join(LAB, 'prepare-gpu.txt'))) fs.copyFileSync(path.join(LAB, 'prepare-gpu.txt'), path.join(dir, 'gpu.txt'));
  const msg = e instanceof K.AppError ? `${e.message}${e.hint ? ` → ${e.hint}` : ''}` : `ラボの不具合かもしれません: ${e?.stack ?? e}`;
  fs.writeFileSync(path.join(dir, 'report.md'), ['# app: FAIL — prepare（端末の準備）', '', '## 途中で止まりました', '', `- ${msg}`, '',
    ...(machine.length ? ['## このパソコン（いちばん苦しかったとき。host.txt に 15 秒ごと）', '', ...machine.map((x) => `- ${x}`), ''] : []),
    ...(facts.length ? ['## ライセンス: 端末が知っていること（最後に失敗した起動の後。license.txt に全部）', '', '```', ...facts, '```', ''] : []),
    '## 準備の記録（最後の 60 行）', '', '```', ...logTxt.trim().split('\n').slice(-60), '```', ''].join('\n'));
  return dir;
}

// ---- hold / live: the CI device kept up and driven through the comments of one issue (lib/live.mjs) ----
/** one live command on the device → the text of its answer (the screen goes with every reply: holdCmd) */
async function liveExec(adb, line, ctx) {
  const c = Live.parseCommand(line);
  if (c.error) return c.error;
  const { verb, args: a, tail } = c;
  const px = (x, y) => { const s = x <= 1 || y <= 1 ? pngSize(adb.screencap()) : null; return [x <= 1 ? Math.round(x * s.w) : Math.round(x), y <= 1 ? Math.round(y * s.h) : Math.round(y)]; };
  const sh = (cmd, timeout = 60_000) => { const r = adb.run(['shell', cmd], { timeout }); return `${r.stdout}${r.stderr}`.trim(); };
  switch (verb) {
    case 'help': return Live.HELP;
    case 'screen': return '';
    case 'tap': { if (a.length < 2 || [a[0], a[1]].some((v) => !Number.isFinite(Number(v)))) return '書き方: tap <x> <y> [tap|hold|motion|panel]'; const [x, y] = px(Number(a[0]), Number(a[1])); adb.tap(x, y, C.TAP_WAYS.includes(a[2]) ? a[2] : undefined); return `押しました (${x}, ${y})${a[2] ? `、${a[2]}` : ''}`; }
    case 'swipe': { if (a.length < 4) return '書き方: swipe <x1> <y1> <x2> <y2> [ミリ秒]'; const [x1, y1] = px(Number(a[0]), Number(a[1])), [x2, y2] = px(Number(a[2]), Number(a[3])); adb.shell(['input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(Number(a[4]) || 300)]); return `なぞりました (${x1}, ${y1}) → (${x2}, ${y2})`; }
    case 'pad': {
      // one press or several ("pad DOWN A", "pad UP wait500 A"), through the device's controller (plugged in on first use)
      const words = a.map((w) => String(w).toUpperCase().replace(/^WAIT/, 'wait'));
      if (!words.length || words.some((w) => !D.PAD_WORDS.includes(w) && !/^wait\d+$/.test(w))) return `書き方: pad <${D.PAD_WORDS.join('|')}|wait<ミリ秒>> …`;
      if (!adb.padReady) { takeRoot(adb); const pd = D.startPad(adb, { labDir: LAB }); if (!pd.ok) ctx.said.push(`（${pd.note}: シェルのキーで押します）`); }
      // (a button is held — lab-pad: 500 ms, then 200 ms — the screen after it is what it did)
      adb.pad(words.join(' ')); await sleep(words.reduce((t, w) => t + (/^wait\d+$/.test(w) ? 0 : /^(UP|DOWN|LEFT|RIGHT)$/.test(w) ? 300 : (Number(process.env.APP_PAD_HOLD_MS) || 500) + 300), 0));
      return `${adb.padReady ? 'コントローラー' : 'シェルのキー'}: ${words.join(' ')}`;
    }
    case 'key': { const k = KEYS[String(a[0] ?? '').toUpperCase()] ?? (/^\d+$/.test(a[0] ?? '') ? Number(a[0]) : null); if (k === null) return `知らないキー ${a[0]}（${Object.keys(KEYS).slice(0, 30).join(' ')} …か番号）`; adb.shell(['input', 'keyevent', String(k)]); return `キー ${a[0]}（${k}）`; }
    case 'text': adb.shell(['input', 'text', C.inputText(tail)]); return `打ちました: ${tail}`;
    case 'wait': await sleep(Math.min(Number(a[0]) || 1000, 300_000)); return `${Number(a[0]) || 1000} ミリ秒待ちました`;
    case 'sh': return sh(tail, 120_000).slice(-12_000) || '（出力なし）';
    case 'logcat': { const n = Math.min(Number(a[0]) || 300, 5000), re = a.length > 1 ? new RegExp(a.slice(1).join(' ').replace(/^\(\?i\)/, ''), 'i') : null; return sh(`logcat -d -t ${n}`, 60_000).split('\n').filter((l) => !re || re.test(l)).join('\n').slice(-12_000) || '（該当なし）'; }
    case 'input': return sh('dumpsys input').split('\n').filter((l) => /Focused|TouchState|touchedWindows|name='|touchableRegion|inputConfig|PendingEvent|Last |InboundQueue|RecentQueue|Dispatch|Monitor/i.test(l)).join('\n').slice(0, 12_000);
    case 'windows': return sh('dumpsys window windows').split('\n').filter((l) => /Window #|mAttrs=|isVisible|mHasSurface|touchable|mOwnerUid|isOnScreen|mViewVisibility|ty=|fl=/.test(l)).join('\n').slice(0, 12_000);
    case 'fps': { const f = gameFps(adb); return f === null ? 'ゲームの面が見つかりません' : `ゲームの描画 毎秒 ${f.toFixed(1)} 枚（直近 10 秒）`; }
    case 'gpu': return gpuFacts(adb);
    case 'files': {
      // what the device is made of on the runner (the AVD's files, what the cache carries) and on the device (/data)
      const list = [];
      const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, path.join(rel, e.name)); else { const st = fs.statSync(p); list.push([path.join(rel, e.name), st.size, st.blocks * 512]); } } };
      try { walk(W.avdDir()); } catch (e) { return `AVD を読めません: ${e.message}`; }
      list.sort((x, y) => y[2] - x[2]);
      const gb = (n) => `${(n / 2 ** 30).toFixed(2)} GB`;
      return [`AVD ${W.avdDir()}: 見かけ ${gb(list.reduce((n, x) => n + x[1], 0))}、ディスク上 ${gb(list.reduce((n, x) => n + x[2], 0))}`, ...list.slice(0, 25).map(([f, sz, used]) => `  ${gb(used).padStart(9)}（見かけ ${gb(sz)}） ${f}`),
        '--- 端末の /data', sh('du -sh /data/app /data/data /data/user_de /data/dalvik-cache /data/media /data/misc /data/system /data/local/tmp 2>/dev/null; df -h /data | tail -1', 120_000)].join('\n');
    }
    case 'launch': await launchGame(adb, { log: (x) => ctx.said.push(x) }); return `起動しました（pid ${adb.pid()}）`;
    case 'kill': adb.shell(['am', 'force-stop', K.PACKAGE]); return '止めました';
    case 'options': {
      const now = adb.run(['shell', `cat ${C.OPTIONS(K.PACKAGE)}`], { timeout: 20_000 }).stdout;
      if (a[0] === 'set') {
        const patch = Object.fromEntries(a.slice(1).map((kv) => /^([^=:\s]+)[=:](.*)$/.exec(kv)).filter(Boolean).map((m) => [m[1], m[2]]));
        if (!Object.keys(patch).length) return '書き方: options set <キー>=<値> …（次の起動から効きます: kill → launch）';
        const w = adb.run(['shell', `cat > ${C.OPTIONS(K.PACKAGE)}`], { input: C.patchOptions(now, patch), timeout: 20_000 });
        return w.status === 0 ? `書きました: ${Object.entries(patch).map(([k, v]) => `${k}:${v}`).join(', ')}（kill → launch で効きます）` : `書けません: ${(w.stderr || w.stdout).trim()}`;
      }
      const re = a[0] ? new RegExp(a.join(' '), 'i') : null;
      return now.split('\n').filter((l) => (re ? re.test(l) : !C.OPTIONS_NOISE.test(l))).join('\n').slice(0, 12_000) || '（該当なし）';
    }
    case 'title': {
      const { pngDecode } = await import(pathToFileURL(path.join(TOP, 'common', 'extra.mjs')).href);
      const t = await waitTitle(adb, { decode: pngDecode, timeoutMs: Math.min(Number(a[0]) || 5, 30) * 60_000, log: (x) => ctx.said.push(x) });
      if (t.stuck) ctx.stuck = t.stuck;
      return `${t.stuck ? `最初の画面のまま（「${t.stuck}」が効かない）` : 'タイトル画面です'}（${Math.round(t.ms / 1000)} 秒${adb.tapHow ? `、押し方 ${adb.tapHow}` : ''}）`;
    }
    case 'relay': { const r = D.startRelay(adb, { labDir: LAB, listen: Number(a[1]) || 19132, host: process.env.APP_HOST || '10.0.2.2', port: Number(a[0]) || 19132, reflect: appTransport() === 'lan' ? [7551] : [] }); return r.note; }
    case 'join': {
      // the game to a server through the device's relay (relay first), or straight to <host> <port>
      const [h, p2] = a.length >= 2 ? [a[0], a[1]] : ['127.0.0.1', a[0] || '19132'];
      const r = adb.shell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', `minecraft://connect/?serverUrl=${h}&serverPort=${p2}`, K.PACKAGE]);
      return `参加のリンク ${h}:${p2}: ${(r.stdout + r.stderr).trim().split('\n').pop()}`;
    }
    case 'bds': {
      // the lab's BDS on this machine, with the run's addon: up / down / do <command> (the lab's own commands, nothing else)
      const addon = process.env.ADDON || 'jsonui_demo', sub = a[0];
      if (sub === 'up') { fs.mkdirSync(path.join(LAB, 'live'), { recursive: true }); const r = await bdsAsync(['up'], { LAB_ADDON: addon, LAB_PORT: a[1] || '19132', LAB_TEXTUREPACK_REQUIRED: '1', LAB_LIVE_IDLE: '3600', LAB_TAIL: path.join(LAB, 'live', 'bds.log'), ...bdsForApp() }); return r.lines.slice(-14).join('\n'); }
      if (sub === 'down') return (await bdsAsync(['down'], { LAB_ADDON: addon }, 60_000)).lines.slice(-3).join('\n');
      if (sub === 'do' && tail.slice(2).trim()) return (await bdsAsync(['do', tail.slice(2).trim()], { LAB_ADDON: addon }, 3 * 60_000)).lines.slice(-30).join('\n');
      return '書き方: bds up [ポート] | bds down | bds do <コマンド>';
    }
    case 'bdslog': {
      // the lab's BDS on this runner: what the live one (bds up) wrote, its own process log, the newest run's server.log
      const n = Math.min(Number(a[0]) || 60, 2000), re = a.length > 1 ? new RegExp(a.slice(1).join(' ').replace(/^\(\?i\)/, ''), 'i') : null, last = newestRun(RUNS);
      const files = [path.join(LAB, 'live', 'bds.log'), path.join(BDS_DIR, '.lab', 'live.log'), ...(last ? [path.join(last, 'server.log')] : [])].filter((f) => fs.existsSync(f));
      return files.map((f) => `== ${rel(f)}\n${fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() && (!re || re.test(l))).slice(-n).join('\n')}`).join('\n').slice(-12_000) || 'BDS のログがありません';
    }
    case 'answer': { const d = adb.focus().dialog; return d ? D.answerDialog(adb, d) : 'Android のダイアログは出ていません'; }
    case 'signin': {
      // the game signed in (MS_EMAIL / MS_PASSWORD from the run's secrets), then `seal` keeps it for the next runs
      const { pngDecode } = await import(pathToFileURL(path.join(TOP, 'common', 'extra.mjs')).href);
      const ch = liveChannel({ secrets: SI.secretsOf() });
      const r = await signIn(adb, { decode: pngDecode, log: (x) => ctx.said.push(x), tell: ch.tell, nextCode: ch.nextCode });
      if (r.ok) ctx.signedIn = true;
      return `${r.note}${r.ok ? '。この状態を次の実行に: seal' : ''}`;
    }
    case 'code': return 'サインインは待っていません（コードは signin の途中に送ります）';
    case 'world': {
      // the player's own world put on the device now; `world restart`: the game started again so it lists it
      const r = seedWorld(adb);
      if (r.ok && a[0] === 'restart') { adb.shell(['am', 'force-stop', K.PACKAGE]); await sleep(1500); await launchGame(adb, { log: (x) => ctx.said.push(x) }); return `${r.note}。ゲームを起動し直しました（pid ${adb.pid()}）`; }
      return r.note;
    }
    case 'run': case 'ui': return liveRun(verb, tail, ctx);
    case 'pull': return livePull(a[0]);
    case 'last': return liveLast(tail, ctx);
    case 'seal': return sealDevice(adb, ctx);
    case 'stop': ctx.stop = true; return '終わります';
  }
  return '';
}
// what `run` / `ui` take from a comment (the rest is refused: the runner's own files and tools are not the comment's)
const LIVE_RUN_OPTS = { run: { flags: ['--allow-client-errors', '-v'], opts: ['--scenario'] }, ui: { flags: ['--all', '--allow-client-errors', '-v'], opts: ['--screens', '--sizes', '--cutouts', '--shard'] } };
/** `run` / `ui` on the device the session holds: a whole `app run` / `app ui` (its own process, its run folder, its report)
 *  on the game as it is — no restore, no new workflow run. The scenario: the comment's own lines (run <<), a file of the
 *  repository (--scenario), or the addon's app.txt. → its result lines; the screen of the first failure (else the last) */
async function liveRun(verb, tail, ctx) {
  const addon = process.env.ADDON || 'jsonui_demo', h = Live.heredoc(tail), spec = LIVE_RUN_OPTS[verb];
  const words = (h ? h.head : tail).split(/\s+/).filter(Boolean), args = [verb, '-a', addon, '--no-fetch', '--bds', 'keep'];
  if (['1', 'true'].includes(process.env.APP_ACCOUNT ?? '')) args.push('--account');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (spec.flags.includes(w)) { args.push(w); continue; }
    if (!spec.opts.includes(w) || words[i + 1] === undefined) return `${verb} では使えない指定: ${w}（${[...spec.flags, ...spec.opts.map((x) => `${x} <値>`)].join(' ')}${verb === 'run' ? '、run <<' : ''}）`;
    const v = words[++i];
    // (a scenario of the repository's addons or app/scenarios: no other file of the runner is read into a reply)
    if (w === '--scenario') { const f = path.resolve(TOP, v); if (![ADDONS, path.join(APPDIR, 'scenarios')].some((d) => f.startsWith(d + path.sep)) || !f.endsWith('.txt') || !fs.existsSync(f)) return `--scenario ${v}: bds/addons/ か app/scenarios/ の .txt を（例 bds/addons/${addon}/app.txt）`; args.push(w, f); }
    else if (!/^[A-Za-z0-9_.:,/x-]{1,200}$/.test(v)) return `${w} ${v}: 英数字と _ . : , / - だけ`;
    else args.push(w, v);
  }
  if (h) {
    if (verb !== 'run') return 'ui には手順を渡せません（run << を使ってください）';
    if (!h.text.trim()) return 'run << の後に手順の行を（最後に EOF の行）';
    const f = path.join(LAB, 'live', `scenario-${Date.now()}.txt`);
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, h.text);
    args.push('--scenario', f);
  }
  // (the run's own process, as on a terminal; the session's token and secrets are not passed on)
  const { GITHUB_TOKEN, LIVE_USER, ...env } = process.env;
  const t0 = Date.now(), lines = [];
  const code = await new Promise((resolve) => {
    const ch = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', ...args], { cwd: TOP, env: { ...env, APP_LIVE_DEVICE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    const take = (d) => { buf += d; const parts = buf.split('\n'); buf = parts.pop(); for (const l of parts) { lines.push(l); out(`  run| ${l}`); } };
    ch.stdout.on('data', take); ch.stderr.on('data', take);
    const kill = setTimeout(() => ch.kill('SIGTERM'), (Number(process.env.APP_LIVE_RUN_MIN) || 90) * 60_000);
    ch.on('close', (c) => { clearTimeout(kill); if (buf) lines.push(buf); resolve(c); });
  });
  const res = /^(PASS|FAIL) (\S+report\.md)/m.exec(lines.join('\n'));
  const dir = res ? path.dirname(path.resolve(TOP, res[2])) : null;
  ctx.lastRun = dir;
  const shot = dir ? liveShot(dir, null) : null;
  if (shot) ctx.png = fs.readFileSync(shot);
  // (what a run prints is already its summary: stages, failing steps, notes, the result, what next; the rest is in its folder)
  const keep = lines.filter((l) => l.trim());
  return [...keep.slice(-80), `--- ${verb} ${code === 0 ? '通りました' : `だめでした（終了 ${code}）`}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）${shot ? `、画像: ${path.basename(shot)}` : ''}。報告と他の画面: last / last list / last <名前>`].join('\n');
}
/** a run folder's screen: the one whose name matches (a regex), else the first failing step's, else the last one taken */
function liveShot(dir, want) {
  const d = path.join(dir, 'shots');
  const all = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort() : [];
  if (want) { let re; try { re = new RegExp(want, 'i'); } catch { return null; } return all.find((f) => re.test(f)) ? path.join(d, all.find((f) => re.test(f))) : null; }
  const failed = all.find((f) => /fail|✘|error/i.test(f));
  return all.length ? path.join(d, failed ?? all.at(-1)) : null;
}
/** `last`: the report of the newest run on this device (a `run` / `ui` of this session, else any), and one of its screens */
function liveLast(tail, ctx) {
  const dir = ctx.lastRun ?? newestRun(RUNS);
  if (!dir || !fs.existsSync(dir)) return 'まだ run / ui がありません';
  const shots = fs.existsSync(path.join(dir, 'shots')) ? fs.readdirSync(path.join(dir, 'shots')).filter((f) => f.endsWith('.png')).sort() : [];
  if (tail.trim() === 'list') return [`${rel(dir)} の画面（last <名前> で見る）:`, ...shots].join('\n');
  const shot = liveShot(dir, tail.trim() || null);
  if (tail.trim() && !shot) return `/${tail.trim()}/ の画面がありません（last list で一覧）`;
  if (shot) ctx.png = fs.readFileSync(shot);
  const md = fs.existsSync(path.join(dir, 'report.md')) ? fs.readFileSync(path.join(dir, 'report.md'), 'utf8') : '（report.md がありません）';
  return `${rel(dir)}${shot ? `、画像: ${path.basename(shot)}` : ''}\n${md.slice(0, 20_000)}`;
}
/** `pull <branch>`: the addon's files from that branch (GitHub's REST API with the run's token: what git tracks there, the
 *  files the build makes here stay), for the next `run`. Push a change, pull it, run it: the device stays as it is */
async function livePull(ref) {
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token } = process.env, base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const addon = process.env.ADDON || 'jsonui_demo';
  if (!ref || !/^[A-Za-z0-9._/-]{1,120}$/.test(ref) || ref.includes('..')) return '書き方: pull <枝 か コミット>（アドオンのファイルをそこから取り直す）';
  if (!repo || !token) return 'pull は GitHub Actions の中で使います（GITHUB_REPOSITORY・GITHUB_TOKEN）';
  const call = async (p) => { const r = await fetch(`${base}/repos/${repo}${p}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'bds-lab' }, signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new K.AppError(`GitHub ${p.split('?')[0]}: ${r.status}`); return r.json(); };
  const commit = await call(`/commits/${ref}`);
  // the addon's own tree: down from the root (bds → addons → <addon>), then all of it at once
  let sha = commit.commit.tree.sha;
  for (const part of ['bds', 'addons', addon]) {
    const t = await call(`/git/trees/${sha}`), e = t.tree.find((x) => x.path === part && x.type === 'tree');
    if (!e) return `${ref} に bds/addons/${addon} がありません`;
    sha = e.sha;
  }
  const tree = await call(`/git/trees/${sha}?recursive=1`);
  if (tree.truncated) return 'アドオンのファイルが多すぎます（GitHub の一覧が途中で切れました）';
  const files = tree.tree.filter((x) => x.type === 'blob');
  if (files.some((x) => x.mode === '120000' || x.path.split('/').includes('..'))) return 'シンボリックリンクや .. を含むパスは受け付けません';
  const dir = path.join(ADDONS, addon), got = new Set();
  for (const f of files) {
    const b = await call(`/git/blobs/${f.sha}`), dst = path.join(dir, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, Buffer.from(b.content, b.encoding === 'base64' ? 'base64' : 'utf8'));
    got.add(f.path);
  }
  // what git tracks here and the branch no longer has: removed (files the build made stay)
  const tracked = spawnSync('git', ['ls-files', '-z', '--', `bds/addons/${addon}`], { cwd: TOP, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  const gone = tracked.map((f) => f.slice(`bds/addons/${addon}/`.length)).filter((f) => f && !got.has(f));
  for (const f of gone) fs.rmSync(path.join(dir, ...f.split('/')), { force: true });
  return `アドオン ${addon} を ${ref}（${commit.sha.slice(0, 7)}「${String(commit.commit.message).split('\n')[0].slice(0, 70)}」）から取りました: ${files.length} ファイル${gone.length ? `、${gone.length} 個を消した` : ''}。次: run`;
}
/** the device as it is now kept as the prepared device: its snapshot, the stamp, a clean stop, sealed into the private
 *  cache (the workflow saves it: GITHUB_OUTPUT sealed_avd=true). From a live session: a device someone got to its title */
async function sealDevice(adb, ctx) {
  const vs = vaultState();
  if (!vs.key) return '非公開のキャッシュの鍵がありません（APP_CACHE_KEY）: 入れられません';
  const f = L.packageFacts(adb.shell(['dumpsys', 'package', K.PACKAGE], { timeout: 30_000 }).stdout);
  if (!f.versionCode) return 'Minecraft が入っていません';
  const account = ['1', 'true'].includes(process.env.APP_ACCOUNT ?? ''), playCode = Number(process.env.APP_PLAY_CODE) || null;
  // a signed-in device is wanted (MS_EMAIL): not kept while the game's menu still offers its Sign In (the stamp would say so)
  if (W.signinWanted() && !ctx.signedIn) {
    const words = ocrBuf((() => { try { return adb.screencap(); } catch { return null; } })());
    if (words && SI.signedOut(words)) return 'まだサインインしていません（画面に Sign In）: 先に signin（サインインなしで残すなら APP_SIGNIN=0 の実行で）';
  }
  takeRoot(adb);
  const r = adb.run(['emu', 'avd', 'snapshot', 'save', W.SNAPSHOT], { timeout: 15 * 60_000 });
  if (r.status !== 0 || !/^OK/m.test(r.stdout)) return `スナップショットを保存できません: ${(r.stdout + r.stderr).trim().slice(0, 300)}`;
  W.writeStamp(W.wantStamp({ apkCode: playCode ?? f.versionCode, account }), { versionName: f.versionName, abis: f.primaryCpuAbi ? [f.primaryCpuAbi] : [], writable: account && vendingOn(), installedCode: f.versionCode, shot: adb.shotVia ?? 'adb', tap: adb.tapHow ?? 'tap', ...(ctx.stuck ? { firstScreen: ctx.stuck } : {}), live: true });
  await D.stopEmulator(adb, LAB);
  W.cleanAvd();
  const P = W.parts(TOP, { bdsCache: path.join(BDS_DIR, '.lab') });
  const s = await V.seal({ base: P.avd.base, entries: P.avd.entries(), outFile: W.vaultFile(TOP, 'avd'), key: vs.key });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'sealed_avd=true\n');
  ctx.stop = true;
  return `準備済みの端末として入れました（Minecraft ${f.versionName}、暗号化 ${(s.bytes / 2 ** 20).toFixed(0)} MB）。ジョブの残りがキャッシュに保存します。終わります`;
}
/** where a step that needs a person speaks (a sign-in's number to approve, a code to send back): the live issue in a
 *  workflow (GITHUB_*: the run's own comments, only the run's user's answers), else this terminal → { tell, nextCode } */
const CODES_TAKEN = new Set();   // (the comments a sign-in took its code from: not commands for the hold after it)
function liveChannel({ secrets = [] } = {}) {
  const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run, GITHUB_TOKEN: token } = process.env, user = process.env.LIVE_USER || process.env.GITHUB_ACTOR || null;
  if (!repo || !run || !token) {
    return { tell: async (m) => out(`  ▶ ${m}`), nextCode: async () => (process.stdin.isTTY ? (await ask('  コード: ')).trim() || null : null) };
  }
  const api = Live.api({ base: process.env.GITHUB_API_URL || 'https://api.github.com', repo, token });
  let issue = null, since = new Date(Date.now() - 60_000).toISOString();
  const seen = new Set();
  return {
    tell: async (m) => { try { issue ??= await api.issue(); await api.comment(issue, `lab-live@${run} ${G.anonymize(m, secrets)}`); } catch (e) { out(`W ${e.message}`); } },
    // a `lab@<run> code 123456` from the run's user, waited for up to 3 minutes at a call
    nextCode: async () => {
      issue ??= await api.issue();
      for (const end = Date.now() + 180_000; Date.now() < end;) {
        let list = []; try { list = await api.comments(issue, since); } catch { /* next time */ }
        for (const c of list) {
          if (seen.has(c.id) || (user && c.user?.login !== user)) continue;
          seen.add(c.id);
          const m = /^lab@\d+\s+code\s+(\d{4,10})\b/.exec(String(c.body ?? '').trim());
          if (m && String(c.body).startsWith(`lab@${run}`)) { CODES_TAKEN.add(c.id); return m[1]; }
        }
        await sleep(Number(process.env.APP_LIVE_POLL_MS) || 3000);
      }
      return null;
    },
  };
}
// app hold: in a workflow (input hold), the device kept up (still up after a failed prepare; else started from its AVD,
// the snapshot when it fits) and the comments of the live issue run as commands for this run, until `stop`, `seal` or
// the minutes are over
async function holdCmd(args) {
  const o = parse(args, { opts: ['--minutes'] });
  const minutes = Math.max(1, Math.min(Number(o.opts['--minutes'] ?? 30) || 30, 300));
  const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run, GITHUB_TOKEN: token } = process.env;
  if (!repo || !run || !token) fail('hold は GitHub Actions の中で使います（GITHUB_REPOSITORY・GITHUB_RUN_ID・GITHUB_TOKEN）', '手元では端末を直接: node lab.mjs app screen / tap / key');
  const user = process.env.LIVE_USER || null, secrets = [token, process.env.APP_CACHE_KEY, process.env.GOOGLE_AAS_TOKEN, process.env.GOOGLE_EMAIL, ...SI.secretsOf()].filter(Boolean);
  const api = Live.api({ base: process.env.GITHUB_API_URL || 'https://api.github.com', repo, token });
  const issue = await api.issue();
  let adb = adbReady(), how = '動いていた端末（準備のまま）';
  if (!adb?.booted()) {
    if (!fs.existsSync(W.avdDir())) fail('端末（AVD）がありません', 'hold は端末を作ったジョブ（または端末を戻したジョブ）で使います');
    const t = Date.now(), r = await ensureEmulator({ ready: readySnapshot({ account: ['1', 'true'].includes(process.env.APP_ACCOUNT ?? '') }), log: out });
    adb = r.adb; how = `${r.warm ? 'スナップショットから' : '普通に'}起動しました（${((Date.now() - t) / 1000).toFixed(1)} 秒）`;
  }
  const stamp = W.readStamp();
  if (stamp?.tap && stamp.tap !== 'tap') adb.tapHow = stamp.tap;
  const t0 = Date.now(), seen = new Set(), ctx = { stop: false, said: [], stuck: null };
  let since = new Date(t0 - 60_000).toISOString();
  await api.comment(issue, `lab-live@${run} 待っています（${minutes} 分まで。端末: ${how}）。命令は \`lab@${run} <コマンド>\`（node lab.mjs app live --run ${run} "<コマンド>"）\n\`\`\`\n${Live.HELP}\n\`\`\``);
  out(`  live: issue #${issue} で命令を待ちます（${minutes} 分、端末: ${how}）`);
  while (!ctx.stop && Date.now() - t0 < minutes * 60_000) {
    let list = [];
    try { list = await api.comments(issue, since); } catch (e) { out(`W ${e.message}`); }
    for (const c of list) {
      if (seen.has(c.id) || CODES_TAKEN.has(c.id)) continue;
      seen.add(c.id);
      if (Date.parse(c.created_at) > Date.parse(since)) since = new Date(Date.parse(c.created_at) - 1000).toISOString();
      const cmds = Live.commandsOf(c.body, run);
      if (!cmds || (user && c.user?.login !== user)) continue;
      const lines = [];
      ctx.png = null;
      for (const line of cmds) {
        const head = line.split('\n')[0], more = line.split('\n').length - 1;
        out(`  live> ${head}${more ? `（と ${more} 行）` : ''}`);
        ctx.said = [];
        const t1 = Date.now();
        let r; try { r = await liveExec(adb, line, ctx); } catch (e) { r = `ERR ${e instanceof K.AppError ? `${e.message}${e.hint ? ` → ${e.hint}` : ''}` : e.message}`; }
        // (each command's time: what the device costs, measured where it runs)
        lines.push(`> ${head}${more ? `（と ${more} 行）` : ''}  [${((Date.now() - t1) / 1000).toFixed(1)} 秒]`, ...ctx.said, ...(r ? [String(r)] : []));
        if (ctx.stop) break;
      }
      let png = null;
      if (!(ctx.stop && /seal/.test(cmds.join(' ')))) {
        try {
          // (run / ui / last: the picture they chose — a failing step's — else the screen now)
          const b = ctx.png ?? adb.screencap(), words = ctx.png ? null : ocrBuf(b);
          png = G.thumbPng(b, { maxBytes: 36_000 }).png;
          if (!ctx.png) lines.push(`--- 画面: ${adb.focus().window ?? '?'}、描画 毎秒 ${gameFps(adb)?.toFixed(1) ?? '?'} 枚${words ? `、文字: ${words.map((w) => w.text).join(' ').slice(0, 800)}` : ''}`);
        } catch (e) { lines.push(`--- 画面を撮れません: ${e.message}`); }
      }
      try { await api.comment(issue, Live.replyBody(run, c.id, G.anonymize(lines.join('\n'), secrets), png)); } catch (e) { out(`W 返事を書けません: ${e.message}`); }
    }
    if (!ctx.stop) await sleep(Number(process.env.APP_LIVE_POLL_MS) || 3000);
  }
  await api.comment(issue, `lab-live@${run} 終わりました（${Math.round((Date.now() - t0) / 60_000)} 分）`).catch(() => {});
  out(`OK live: 終わりました（${ctx.stop ? '命令で' : '時間切れ'}）`);
}
// app live: a command to the device a CI run holds (workflow input hold), its answer printed and its screen saved
async function liveCmd(args) {
  const o = parse(args, { flags: ['--wait', '--no-wait'], opts: ['--run', '--repo', '--timeout', '--steps', '--reply'] });
  if (gh(['--version']).status !== 0) fail('GitHub CLI（gh）がありません');
  const repo = ciRepo(o);
  const run = o.opts['--run'] ?? (ghJson([`repos/${repo}/actions/workflows/app.yml/runs?status=in_progress&per_page=5`]).workflow_runs ?? [])[0]?.id ?? fail('動いている app の実行がありません', 'node lab.mjs app ci --mode hold');
  // --steps <file>: a scenario of this machine run on the device as it is (run <<: nothing to commit)
  if (o.opts['--steps']) {
    const f = path.resolve(o.opts['--steps']);
    if (!fs.existsSync(f)) fail(`${o.opts['--steps']} がありません`);
    const text = fs.readFileSync(f, 'utf8'), { errors } = parseScenario(text);
    if (errors.length) { errors.forEach((e) => out(`E ${rel(f)}:${e}`)); fail('手順の書き方に誤りがあります（上の行）', '書き方の一覧: node lab.mjs app help'); }
    o.rest.push(`run <<\n${text.replace(/\s+$/, '')}\nEOF`);
  }
  // (a whole run on the device takes minutes: waited for longer)
  const long = o.rest.some((c) => Live.LONG.has(String(c).trim().split(/\s+/)[0]));
  const timeout = (Number(o.opts['--timeout']) || (long ? 90 * 60 : 300)) * 1000, t0 = Date.now();
  const issueNo = () => (ghJson([`repos/${repo}/issues?state=open&per_page=100`]) ?? []).find((x) => x.title === Live.ISSUE_TITLE && !x.pull_request)?.number;
  let issue = issueNo();
  // --wait: until the run says it is holding (its first comment for this run)
  if (o.flags.has('--wait') || !issue) {
    for (;;) {
      issue ??= issueNo();
      // (the newest first, across the repository: the live issue gets more than a page of comments a day)
      const ready = issue && (ghJson([`repos/${repo}/issues/comments?sort=created&direction=desc&per_page=100&since=${new Date(t0 - 6 * 3600_000).toISOString()}`]) ?? []).find((c) => String(c.body).startsWith(`lab-live@${run} 待っています`));
      if (ready) { out(String(ready.body).split('\n')[0]); break; }
      if (Date.now() - t0 > Math.max(timeout, 3 * 3600_000)) fail('実行が待つ状態になりません', `node lab.mjs app ci watch ${run}`);
      await sleep(15_000);
    }
    if (!o.rest.length) return;
  }
  let posted;
  if (o.opts['--reply']) {
    // the answer to a command sent before (--no-wait)
    posted = ghJson([`repos/${repo}/issues/comments/${o.opts['--reply']}`]);
  } else {
    if (!o.rest.length) fail('書き方: node lab.mjs app live [--run <番号>] "<コマンド>" ["<コマンド>" …]（--steps <ファイル>: その手順をこの端末で）', Live.HELP);
    const r = gh(['api', '-X', 'POST', `repos/${repo}/issues/${issue}/comments`, '-f', `body=lab@${run} ${o.rest.join('\n')}`]);
    if (r.status !== 0) fail('命令を書けません', (r.stderr || r.stdout).trim().split('\n')[0]);
    posted = JSON.parse(r.stdout);
    if (o.flags.has('--no-wait')) { out(`送りました（#${posted.id}）。返事: node lab.mjs app live --run ${run} --reply ${posted.id}`); return; }
  }
  for (;;) {
    await sleep(3000);
    const list = ghJson([`repos/${repo}/issues/${issue}/comments?per_page=100&since=${encodeURIComponent(posted.created_at)}`]) ?? [];
    const rep = list.map((c) => Live.replyParts(c.body, run)).find((x) => x && x.id === posted.id);
    if (rep) {
      out(rep.text);
      if (rep.png) { const d = path.join(RUNS, 'live'); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, `${run}-${posted.id}.png`); fs.writeFileSync(f, rep.png); out(`画面: ${rel(f)}`); }
      return;
    }
    if (list.some((c) => String(c.body).startsWith(`lab-live@${run} 終わりました`))) fail('実行はもう待っていません（hold が終わった）');
    if (Date.now() - t0 > timeout) fail(`${timeout / 1000} 秒で返事がありません`, `実行 ${run} がまだ待っているか: node lab.mjs app live --run ${run} --wait`);
  }
}

// ---- open: the private cache's parts put back in place now (the device job runs it in the background while it restores
// the next cache: the decryption and the download overlap; app prepare then finds the device there) ----
async function openCmd(args) {
  const o = parse(args);
  const vs = vaultState(), P = W.parts(TOP, { bdsCache: path.join(BDS_DIR, '.lab') });
  if (!vs.key) fail('非公開のキャッシュの鍵がありません', 'APP_CACHE_KEY（または GOOGLE_AAS_TOKEN）');
  const bad = o.rest.filter((x) => !P[x]);
  if (!o.rest.length || bad.length) fail(`書き方: node lab.mjs app open <${Object.keys(P).join('|')}> …`);
  await Promise.all(o.rest.map(async (name) => {
    const f = W.vaultFile(TOP, name), t = Date.now();
    if (!fs.existsSync(f)) { out(`  ${P[name].what}: キャッシュのファイルがありません`); return; }
    const ok = await V.open({ inFile: f, dest: P[name].base, key: vs.key, log: out });
    fs.rmSync(f, { force: true });
    out(`${ok ? 'OK' : 'W'} ${P[name].what}を${ok ? '戻しました' : '戻せません'}（${((Date.now() - t) / 1000).toFixed(0)} 秒）`);
  }));
}

// ---- tidy: the repository's cache kept under GitHub's limit the lab's way (in a workflow, before saving) ----
// Over the limit GitHub drops what was used least recently — on a run that made a device, the emulator and system image
// (restored first) went, and the next run could not start the device it had just made. So, before saving: what an older
// version of a part left goes first; then, if the parts about to be saved still do not fit, the device base (only needed
// to make a device again) is not saved, then dropped. The emulator / system image and the prepared device stay
async function tidyCmd(args) {
  const o = parse(args, { opts: ['--limit-gb'], multi: ['--keep', '--incoming'] });
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token } = process.env, base = process.env.GITHUB_API_URL || 'https://api.github.com';
  if (!repo || !token) fail('tidy は GitHub Actions の中で使います（GITHUB_REPOSITORY・GITHUB_TOKEN）');
  const call = async (method, p) => { const r = await fetch(`${base}/repos/${repo}${p}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'bds-lab' }, signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new K.AppError(`GitHub ${method} ${p}: ${r.status}`); return r.status === 204 ? null : r.json(); };
  const caches = [];
  for (let page = 1; page <= 10; page++) { const r = await call('GET', `/actions/caches?per_page=100&page=${page}`); caches.push(...(r.actions_caches ?? [])); if ((r.actions_caches ?? []).length < 100) break; }
  // --incoming <key>=<file>: a part this job is about to save (its sealed file's size)
  const incoming = (o.multi['--incoming'] ?? []).map((x) => { const i = x.indexOf('='), f = x.slice(i + 1); return { key: x.slice(0, i), bytes: i > 0 && fs.existsSync(f) ? fs.statSync(f).size : 0 }; });
  const limit = (Number(o.opts['--limit-gb']) || 10) * 2 ** 30 * 0.97;
  const plan = W.tidyPlan(caches, { keep: (o.multi['--keep'] ?? []).flatMap((x) => x.split(/\s+/)), incoming, limit });
  const gb = (n) => `${(n / 2 ** 30).toFixed(1)} GB`;
  for (const key of plan.drop) { try { await call('DELETE', `/actions/caches?key=${encodeURIComponent(key)}`); out(`  キャッシュから外しました: ${key.replace(/-[0-9a-f]{16}-/, '-…-')}`); } catch (e) { out(`W ${e.message}`); } }
  if (plan.skipBase) out('  端末の土台は保存しません（準備済みの端末とエミュレータを残すため。上限を超える）');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip_base=${plan.skipBase}\n`);
  out(`OK キャッシュ: 保存した後 ${gb(plan.total)}（上限 ${gb(limit)}）${plan.drop.length ? `、${plan.drop.length} 個を外した` : ''}`);
}

// ---- ui: every JSON UI screen of an addon in the real app (lib/uicatalog.mjs) ----
// the addon's rp/ui files → the screens that draw them → one app.txt with a section per screen (open, picture, close),
// run like `app run`. --all: every screen the lab knows. --shard k/n: this device's share (the workflow runs n at once)
async function uiCmd(args) {
  const o = parse(args, { flags: ['--all', '--list', '--no-fetch', '--wipe', '--window', '--keep', '-v', '--account', '--allow-client-errors'], opts: ['-a', '--addon', '--screens', '--shard', '--apk', '--bds', '--vending', '--sizes', '--cutouts'] });
  if (o.rest.length) fail(`知らない指定 ${o.rest.join(' ')}`, 'node lab.mjs app ui -a <アドオン> [--all] [--screens <id,id>] [--shard k/n] [--list]');
  const addon = needAddon(o.opts['-a'] ?? o.opts['--addon']);
  const dir = path.join(ADDONS, addon), files = U.addonUiFiles(dir);
  const plan = U.screensFor(files);
  let screens = plan.screens, start = plan.start;
  if (o.flags.has('--all')) { screens = U.SCREENS; start = true; }
  if (o.opts['--screens']) {
    const want = o.opts['--screens'].split(',').map((x) => x.trim()).filter(Boolean), bad = want.filter((x) => !U.SCREENS.some((s) => s.id === x) && x !== 'start');
    if (bad.length) fail(`知らない画面: ${bad.join(' ')}`, `使えるもの: start ${U.SCREENS.map((s) => s.id).join(' ')}`);
    screens = U.SCREENS.filter((s) => want.includes(s.id)); start = want.includes('start');
  }
  const m = /^(\d+)\/(\d+)$/.exec(o.opts['--shard'] ?? '1/1');
  if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) fail(`--shard ${o.opts['--shard']} は k/n の形で（例 2/3）`);
  const [k, n] = [Number(m[1]), Number(m[2])], mine = U.shard(screens, k, n);
  let serverUi = false;
  try { serverUi = (JSON.parse(fs.readFileSync(path.join(dir, 'bp', 'manifest.json'), 'utf8')).dependencies ?? []).some((d) => d.module_name === '@minecraft/server-ui'); } catch { /* no bp */ }
  const head = [
    `# app ui -a ${addon}${n > 1 ? `（${k}/${n} 台目）` : ''}: ${files.length ? `rp/ui ${files.length} ファイル` : 'rp/ui はありません'}`,
    ...files.map((f) => { const sc = U.SCREENS.filter((x) => x.files.includes(path.posix.basename(f))).map((x) => x.id); const st = U.START.files.includes(path.posix.basename(f)); return `#   ${f} → ${[...(st ? ['start'] : []), ...sc].join(' ') || (plan.own.includes(f) ? '（アドオン自身の部品: どの画面でもコンテンツログを見る）' : '（開き方を知らない画面: コンテンツログだけ見る）')}`; }),
    `# この台の画面: ${[...(start && k === 1 ? ['start'] : []), ...mine.map((x) => x.id)].join(' ') || '（なし: 参加してワールドとコンテンツログだけ）'}`,
  ];
  // other shapes (--sizes 1024x768,2400x1080 / --cutouts tall,hole; on GitHub the knobs APP_UI_SIZES / APP_UI_CUTOUTS)
  let vars = [];
  try { vars = U.variants({ sizes: o.opts['--sizes'] ?? process.env.APP_UI_SIZES ?? '', cutouts: o.opts['--cutouts'] ?? process.env.APP_UI_CUTOUTS ?? '' }); } catch (e) { fail(e.message, 'node lab.mjs app ui -a <アドオン> --sizes 1024x768,2400x1080 --cutouts tall,hole'); }
  if (vars.length) head.push(`# ほかの形でも全部: ${vars.map((v) => v.id).join(' ')}`);
  const text = head.join('\n') + '\n' + U.suiteScenario({ screens: mine, start: start && k === 1, serverUi, vars });
  if (o.flags.has('--list')) { out(text); return; }
  fs.mkdirSync(LAB, { recursive: true });
  const file = path.join(LAB, `ui-${addon}-${k}of${n}.txt`);
  fs.writeFileSync(file, text);
  out(head.join('\n'));
  const pass = args.filter((x, i) => !['--all', '--list'].includes(x) && !['--screens', '--shard', '--sizes', '--cutouts'].includes(x) && !['--screens', '--shard', '--sizes', '--cutouts'].includes(args[i - 1]));
  await runCmd([...pass, '--scenario', file]);
}

// ---- status (no arguments): what is ready, and the one next thing to do ----
function checks() {
  const t = D.tools(), c = K.playCredentials(), list = apkPaths();
  const osHint = process.platform === 'darwin' ? 'Android Studio を入れる（https://developer.android.com/studio）。入れた後、ターミナルで export ANDROID_HOME=~/Library/Android/sdk'
    : process.platform === 'win32' ? 'Android Studio を入れる（https://developer.android.com/studio）。入れた後、環境変数 ANDROID_HOME に %LOCALAPPDATA%\\Android\\Sdk を設定'
      : 'Android Studio か commandline-tools を入れ、ANDROID_HOME を設定（例 export ANDROID_HOME=~/Android/Sdk）';
  const bdsReady = fs.existsSync(path.join(BDS_DIR, '.lab', 'bds', 'VERSION'));
  const rows = [
    { name: 'Android SDK', ok: Boolean(t.sdk || process.env.APP_EMULATOR), detail: t.sdk ?? '見つかりません', fix: osHint },
    (() => {   // the emulator's hardware acceleration: KVM (Linux), WHPX (Windows), Hypervisor.framework (macOS: always there)
      if (process.platform === 'linux') return { name: 'エミュレータの高速化', ok: D.kvmOk(), detail: D.kvmOk() ? 'KVM 使えます' : '/dev/kvm が使えません', fix: 'sudo usermod -aG kvm $USER の後にログインし直す（BIOS の仮想化が無効なら有効に）' };
      if (process.platform === 'darwin') return { name: 'エミュレータの高速化', ok: true, detail: 'Hypervisor.framework（macOS 標準）', fix: '' };
      const r = t.emulator ? spawnSync(t.emulator, ['-accel-check'], { encoding: 'utf8', timeout: 20_000 }) : null;
      const okA = r ? /is installed and usable|usable/i.test(`${r.stdout}${r.stderr}`) && r.status === 0 : true;
      return { name: 'エミュレータの高速化', ok: okA, soft: !r, detail: r ? (okA ? 'WHPX 使えます' : 'WHPX が使えません') : '（エミュレータを入れた後に確かめます）', fix: '「Windows の機能の有効化または無効化」で「Windows ハイパーバイザー プラットフォーム」を有効にして再起動' };
    })(),
    { name: 'エミュレータ', ok: Boolean(t.emulator && t.adb), detail: t.emulator && t.adb ? '入っています' : '部品がまだです', fix: 'node lab.mjs app emu（必要な部品を入れて起動します）' },
    { name: 'APK', ok: Boolean(list), detail: list ? (() => { try { const i = K.inspectApks(list); return `${i.versionName}（${rel(path.dirname(list[0]))}）`; } catch (e) { return `読めません: ${e.message}`; } })() : 'まだありません',
      fix: c.ready ? 'node lab.mjs app apk fetch' : 'node lab.mjs app token → node lab.mjs app apk fetch（スマホから取り出したものなら node lab.mjs app apk <フォルダ>）' },
    { name: 'Google の認証', ok: c.ready || Boolean(list), soft: true, detail: c.ready ? `${c.email}（…${c.aasToken.slice(-4)}）` : c.problems.join(' / ') || '未設定（APK が手元にあれば不要）', fix: 'node lab.mjs app token' },
    { name: 'ログイン用ブラウザ', ok: true, soft: true, detail: !canShowWindow() ? '画面の無い環境（token は別のコンピュータで作って .env.local をコピー）' : (browserCandidates()[0] ?? '見つからない（token のとき Chrome for Testing を自動で取得）'), fix: '' },
    { name: 'BDS', ok: bdsReady || Boolean(process.env.APP_BDS_LAB), detail: bdsReady ? fs.readFileSync(path.join(BDS_DIR, '.lab', 'bds', 'VERSION'), 'utf8').trim() : 'まだ用意していません', fix: 'node lab.mjs bds setup' },
  ];
  return rows;
}
function statusCmd() {
  const rows = checks();
  out('app ラボ: 本物のアプリで JSON UI を確かめる\n');
  const wide = (t) => [...t].reduce((n, c) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(c) ? 2 : 1), 0);
  for (const r of rows) out(`  ${r.ok && !r.soft ? '✔' : r.soft ? '・' : '✘'} ${r.name}${' '.repeat(Math.max(1, 24 - wide(r.name)))}${r.detail}`);
  const next = rows.find((r) => !r.ok && !r.soft);
  const names = addonNames(), withApp = names.filter((n) => fs.existsSync(path.join(ADDONS, n, 'app.txt')));
  out('');
  if (next) { out(`次にやること: ${next.fix}`); out('（まとめて対話で進めるなら: node lab.mjs app setup）'); }
  else {
    out(`準備はできています。次にやること: node lab.mjs app run -a ${withApp[0] ?? names[0] ?? '<アドオン>'}`);
    if (withApp.length) out(`  app.txt のあるアドオン: ${withApp.join(' ')}`);
    const noApp = names.filter((n) => !withApp.includes(n));
    if (noApp.length) out(`  手順を作る: node lab.mjs app init -a <名前>（${noApp.slice(0, 6).join(' ')}${noApp.length > 6 ? ' …' : ''}）`);
  }
  if (process.platform === 'linux') out('\nエミュレータの代わりに redroid（コンテナの Android、VM なし）も: node lab.mjs app redroid doctor');
}
async function setupCmd(args) {
  parse(args);
  statusCmd();
  if (!process.stdin.isTTY) { out('\n（対話できないので、ここまで。上の「次にやること」を実行してください）'); return; }
  const rows = checks(), get = (n) => rows.find((r) => r.name === n);
  if (!get('Android SDK').ok) { out(`\nまず Android SDK が要ります。${get('Android SDK').fix}\n入れたら、もう一度 node lab.mjs app setup`); return; }
  if (!get('エミュレータの高速化').ok) out(`\n注意: ${get('エミュレータの高速化').fix}（このままでも進められますが、とても遅くなります）`);
  if (!get('BDS').ok && await yes('\nBDS（サーバー）を用意しますか？')) { out('用意しています（数分）…'); const r = bds(['setup']); r.lines.slice(-2).forEach((l) => out('  ' + l)); if (!r.ok) fail('BDS を用意できませんでした', 'node lab.mjs doctor で原因を確かめてください。'); }
  if (!apkPaths()) {
    out('\nAPK（Minecraft 本体）の用意の仕方を選びます。');
    out('  1) Google Play から取る（Minecraft を買った Google アカウントで。おすすめ）');
    out('  2) スマホから取り出した APK のフォルダを使う');
    const pick = await ask('番号: ', { fallback: '1' });
    if (pick === '2') { const d = await ask('フォルダの場所: '); const i = apkUse(d); out(`OK ${i.versionName}`); }
    else {
      if (!K.playCredentials().ready) await tokenCmd([]);
      out('APK を取得しています（1 GB 前後、数分）…');
      const i = await apkFetch({ acceptTos: true }); out(`OK ${i.versionName}`);
    }
  }
  if (await yes('\nエミュレータを起動して確かめますか？（初回は 5〜10 分）')) await emuCmd([]);
  out('');
  statusCmd();
}

// ---- secrets: the Google credentials into GitHub (gh reads the value from stdin: never on a command line) ----
async function secretsCmd(args) {
  const o = parse(args, { opts: ['--repo', '--env', '--from'] });
  if (o.opts['--from']) { const f = path.resolve(o.opts['--from']); if (!fs.existsSync(f)) fail(`${o.opts['--from']} がありません`); K.loadEnv([f]); }
  let c = K.playCredentials();
  if (!c.ready && process.stdin.isTTY && !c.problems.length) { out('まず Google の AAS トークンを作ります（一度だけ）。'); await tokenCmd([]); c = K.playCredentials(); }
  if (!c.ready) fail(c.problems.join(' / ') || 'GOOGLE_EMAIL / GOOGLE_AAS_TOKEN がありません', 'まず node lab.mjs app token（端末で）');
  if (spawnSync('gh', ['--version'], { encoding: 'utf8' }).status !== 0) fail('GitHub CLI（gh）がありません', 'https://cli.github.com から入れて、gh auth login でログインしてください。');
  const envName = o.opts['--env'];
  // which repository: --repo owner/name; a bare name gets the signed-in account (gh secret needs owner/name, gh repo view
  // did not); no --repo outside a git folder → <account>/<this folder's name> (bds-lab), said in one line
  let repo = o.opts['--repo'];
  const login = () => spawnSync('gh', ['api', 'user', '-q', '.login'], { encoding: 'utf8' }).stdout?.trim() || '';
  if (repo && !repo.includes('/')) { const me = login(); if (me) repo = `${me}/${repo}`; }
  if (!repo && spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: TOP, encoding: 'utf8' }).status !== 0) {
    const me = login(), guess = me && `${me}/${path.basename(TOP)}`;
    if (guess && spawnSync('gh', ['repo', 'view', guess, '--json', 'name'], { encoding: 'utf8' }).status === 0) { repo = guess; out(`リポジトリ: ${repo}（このフォルダの名前から。違うなら --repo <owner/名前>）`); }
  }
  const vis = spawnSync('gh', ['repo', 'view', ...(repo ? [repo] : []), '--json', 'visibility', '-q', '.visibility'], { encoding: 'utf8' });
  if (vis.status !== 0 && repo && /Could not resolve to a Repository/i.test(vis.stderr ?? '')) fail(`GitHub に ${repo} がありません`,
    'secrets は GitHub Actions（ai-make / app ワークフロー）で APK を取るときだけ要ります。このPCで使うだけなら不要（.env.local にもうあります）。\n'
    + `  Actions でも使うなら、先にリポジトリを作る: git init && git add -A && git commit -m init && gh repo create ${repo} --private --source . --push\n  そのあと: node lab.mjs app secrets --repo ${repo}`);
  if (vis.status !== 0) { const me = login(); fail('リポジトリが分かりません', `--repo ${me || '<owner>'}/<リポジトリ名> を付けてください（例: node lab.mjs app secrets --repo ${me || '<owner>'}/bds-lab）。` + (vis.stderr ? `（${vis.stderr.trim().slice(0, 120)}）` : '')); }
  if (vis.stdout.trim() === 'PUBLIC') out('W 公開リポジトリです。スクショは Actions の成果物として、ログインした誰でも見られます（APK とトークンは出ません）');
  for (const [k, v] of [['GOOGLE_EMAIL', c.email], ['GOOGLE_AAS_TOKEN', c.aasToken]]) {
    const r = spawnSync('gh', ['secret', 'set', k, ...(repo ? ['--repo', repo] : []), ...(envName ? ['--env', envName] : [])], { input: v, encoding: 'utf8' });
    if (r.status !== 0) fail(`gh secret set ${k} が失敗しました`, (r.stderr || '').trim().slice(0, 200));
    out(`OK ${k}${envName ? `（Environment ${envName}）` : ''}`);
  }
  if (envName) {
    const r = spawnSync('gh', ['variable', 'set', 'BB_PLAY_ENV', ...(repo ? ['--repo', repo] : [])], { input: envName, encoding: 'utf8' });
    if (r.status !== 0) fail('変数 BB_PLAY_ENV を設定できませんでした', (r.stderr || '').trim().slice(0, 200));
    out(`OK 変数 BB_PLAY_ENV=${envName}（app.yml はこの Environment から読みます）`);
  }
  out('次: GitHub の Actions → app → Run workflow');
}

// ---- checks / ci: a run through the GitHub API alone (lib/ghresults.mjs) ----
// (gh-<run> folders are results fetched by `app ci`, not runs of this machine)
const newestRun = (dir) => { const r = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('gh-') && e.name !== 'live').map((e) => e.name).sort() : []; return r.length ? path.join(dir, r.at(-1)) : null; };
async function ghFetch(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5 * 60_000) });
  if (!r.ok) fail(`GitHub API ${method} ${url.replace(/^https:\/\/[^/]+/, '')}: HTTP ${r.status}`, (await r.text()).slice(0, 300));
  return r.json();
}
/** (in the workflow's second job) the run folder → check runs on the commit; --artifact <name> takes it from this run's artifact */
async function checksCmd(args) {
  const o = parse(args, { flags: ['--print'], opts: ['--artifact', '--devices'] });
  const api = process.env.GITHUB_API_URL || 'https://api.github.com', repo = process.env.GITHUB_REPOSITORY, runId = process.env.GITHUB_RUN_ID;
  const secrets = [process.env.GOOGLE_AAS_TOKEN, process.env.GOOGLE_EMAIL].filter(Boolean), full = process.env.APP_FULL_LOGS === '1';
  // the run folder(s): this machine's newest run, or (in the workflow) each device's artifact: <name> for one device,
  // <name>-<k>of<n> for n devices run at once, each posted with "[k/n]" in its checks
  const n = Math.max(1, Number(o.opts['--devices']) || 1), payload = [];
  const fromDir = (dir, shard) => {
    const runDir = newestRun(dir), tag = shard ? ` [${shard}]` : '';
    return runDir ? G.checksPayload(runDir, { pkg: K.PACKAGE, full, secrets, shard })
      : [{ name: `${G.CHECK_PREFIX}結果${tag}`, title: `FAIL${tag} 実行の記録がありません`, summary: `${rel(dir)} に実行の記録がありません`, text: '' }];
  };
  if (!o.opts['--artifact']) payload.push(...fromDir(path.resolve(o.rest[0] ?? RUNS), null));
  else {
    if (!process.env.GITHUB_TOKEN || !repo || !runId) fail('--artifact は GitHub Actions の中で使います（GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_RUN_ID）');
    let jobs = null;
    for (let k = 1; k <= n; k++) {
      const name = n > 1 ? `${o.opts['--artifact']}-${k}of${n}` : o.opts['--artifact'], shard = n > 1 ? `${k}/${n}` : null, tag = shard ? ` [${shard}]` : '';
      const a = (await ghFetch(`${api}/repos/${repo}/actions/runs/${runId}/artifacts?name=${encodeURIComponent(name)}`)).artifacts?.[0];
      if (!a) {
        // no run folder: what that device's job still says (stopped from outside? how far it got?)
        let ex = null;
        try {
          jobs ??= (await ghFetch(`${api}/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`)).jobs ?? [];
          const job = jobs.find((j) => j.status === 'completed' && (!shard || String(j.name).includes(shard)) && (j.steps ?? []).some((x) => x.conclusion === 'failure' || x.conclusion === 'cancelled'));
          if (job) ex = G.explainJob(job, await ghFetch(`${api}/repos/${repo}/check-runs/${job.id}/annotations`));
        } catch (e) { out(`W ジョブの記録を読めません: ${e.message}`); }
        payload.push({ name: `${G.CHECK_PREFIX}結果${tag}`, title: `${ex?.title ?? 'FAIL 成果物がありません'}${tag}`, summary: `${ex ? `${ex.summary}\n\n` : ''}成果物 ${name} がありません（アプリのジョブが途中で止まったか、guard が止めた）。注釈を見てください。`, text: '' });
        continue;
      }
      const dir = path.join(LAB, n > 1 ? `artifact-${k}` : 'artifact');
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const zip = path.join(LAB, `artifact-${k}.zip`);
      // the API answers with a redirect to storage: follow it without the token
      const r1 = await fetch(a.archive_download_url, { redirect: 'manual', headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(60_000) });
      const loc = r1.headers.get('location');
      const r2 = loc ? await fetch(loc, { signal: AbortSignal.timeout(10 * 60_000) }) : r1;
      if (!r2.ok) fail(`成果物を取得できません（HTTP ${r2.status}）`);
      fs.writeFileSync(zip, Buffer.from(await r2.arrayBuffer()));
      const u = spawnSync('unzip', ['-q', '-o', zip, '-d', dir], { encoding: 'utf8' });
      fs.rmSync(zip, { force: true });
      if (u.status !== 0) fail('成果物を展開できません（unzip）', (u.stderr || '').slice(0, 200));
      payload.push(...fromDir(dir, shard));
    }
  }
  if (o.flags.has('--print')) { payload.forEach((p) => out(`${p.name}\t${p.title}\tsummary ${p.summary.length}\ttext ${p.text.length}`)); return; }
  if (!process.env.GITHUB_TOKEN || !repo || !process.env.GITHUB_SHA) fail('GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_SHA がありません', 'ワークフローの中で使います（手元で中身を見るなら --print）');
  for (const p of payload) {
    await ghFetch(`${api}/repos/${repo}/check-runs`, { method: 'POST', body: { name: p.name, head_sha: process.env.GITHUB_SHA, external_id: String(runId ?? ''), status: 'completed', conclusion: 'neutral', output: { title: p.title.slice(0, 250), summary: p.summary || '-', ...(p.text ? { text: p.text } : {}) } } });
    out(`OK ${p.name}（${p.title}）`);
  }
}

/** gh with its output (never a secret on a command line here) */
const gh = (args, opts = {}) => spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 256e6, ...opts });
const ghJson = (args) => { const r = gh(['api', ...args]); if (r.status !== 0) fail(`gh api ${args[0]}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`, 'gh auth status を確かめてください。'); return JSON.parse(r.stdout); };
const ghLines = (args) => { const r = gh(['api', ...args]); if (r.status !== 0) fail(`gh api ${args[0]}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`); return r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)); };
function ciRepo(o) {
  if (o.opts['--repo']) return o.opts['--repo'];
  const u = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: TOP, encoding: 'utf8' }).stdout ?? '';
  const m = /github\.com[:/]([^/]+\/[^/\s]+?)(\.git)?\s*$/.exec(u.trim());
  return m?.[1] ?? fail('どのリポジトリか分かりません', '--repo <owner/名前>');
}
/** the results of a workflow run (check runs + annotations) → app/runs/gh-<run>/ */
// soften the wording that should not stand out on a stream (device / store / license), on what is shown live or written
// as a label. Errors keep their words (they go through anonymize only).
const soften = (s) => String(s)
  .replace(/エミュレータ[ー]?/g, '端末')
  .replace(/Play ストア/g, '必要な部品')
  .replace(/ライセンス確認（PairIP）|ライセンス確認|ライセンス/g, '起動時チェック')
  .replace(/Google の公式の手順ではありません[^。\n]*。?/g, '')
  .replace(/\broot\b/gi, '');
function ciFetch(repo, id, { full = false } = {}) {
  const run = ghJson([`repos/${repo}/actions/runs/${id}`]);
  const dir = path.join(RUNS, `gh-${id}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const cr = ghLines([`repos/${repo}/commits/${run.head_sha}/check-runs?per_page=100&filter=all`, '--paginate', '--jq', '.check_runs[] | {name, external_id, output}'])
    .filter((c) => c.external_id === String(id) && String(c.name).startsWith(G.CHECK_PREFIX));
  const files = G.unpackChecks(cr, dir);
  // the checks are already anonymized on the posting side; anonymize again here is cheap and covers older runs
  for (const f of files) if (/\.(md|txt)$/.test(f)) { const p = path.join(dir, f); fs.writeFileSync(p, G.anonymize(fs.readFileSync(p, 'utf8'))); }
  // the annotations and the step list from the job API (anonymized; step names softened — they are labels, not errors)
  const jobs = ghJson([`repos/${repo}/actions/runs/${id}/jobs`]).jobs ?? [];
  const ann = [], steps = [];
  let explain = null;
  for (const j of jobs) {
    steps.push(`${soften(j.name)}: ${j.conclusion ?? j.status}`, ...(j.steps ?? []).map((s) => `  ${s.conclusion ?? s.status}  ${soften(s.name)}`));
    const list = ghJson([`repos/${repo}/check-runs/${j.id}/annotations`]);
    for (const a of list) ann.push(`#### ${a.annotation_level} ${a.title ?? ''}\n${a.message}`);
    // the job that failed: how and how far (read when there is no report: the job was stopped before it could upload)
    if (!explain && (j.steps ?? []).some((s) => s.conclusion === 'failure' || s.conclusion === 'cancelled')) explain = G.explainJob({ ...j, steps: (j.steps ?? []).map((s) => ({ ...s, name: soften(s.name) })) }, list);
  }
  fs.writeFileSync(path.join(dir, 'steps.txt'), G.anonymize(steps.join('\n')) + '\n');
  fs.writeFileSync(path.join(dir, 'annotations.txt'), G.anonymize(ann.join('\n\n')) + '\n');
  if (explain) fs.writeFileSync(path.join(dir, 'explain.txt'), G.anonymize(`${explain.title}\n${explain.summary}`) + '\n');
  return { dir, run, files: [...files, 'steps.txt', 'annotations.txt', ...(explain ? ['explain.txt'] : [])], checks: cr.length, explain };
}
async function ciCmd(args) {
  const sub = ['fetch', 'watch'].includes(args[0]) ? args.shift() : 'run';
  const o = parse(args, { flags: ['--account', '--no-account', '--no-wait', '--wait', '--full', '--fresh', '--bench', '--keep'], opts: ['-a', '--addon', '--ref', '--scenario', '--bds', '--repo', '--screen', '--mode', '--devices', '--lane', '--knobs', '--hold', '--device'], multi: ['--try'] });
  const full = o.flags.has('--full') || process.env.APP_FULL_LOGS === '1';
  if (gh(['--version']).status !== 0) fail('GitHub CLI（gh）がありません', 'https://cli.github.com から入れて、gh auth login でログインしてください。');
  const repo = ciRepo(o);
  let id = sub === 'run' ? null : (o.rest[0] ?? fail(`node lab.mjs app ci ${sub} <run の番号>`));
  if (sub !== 'run' && o.opts['--device'] === 'redroid') return redroidCiWatch(repo, id, { wait: sub === 'watch' });
  if (sub === 'run') {
    if (o.rest.length) fail(`知らない指定 ${o.rest.join(' ')}`, 'node lab.mjs app ci [-a <アドオン>] [--ref <枝>] [--account] [--scenario <ファイル>] [--bds <版>] [--screen <幅x高さ>] [--try "<APP_…=…>"]…');
    const ref = o.opts['--ref'] ?? spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: TOP, encoding: 'utf8' }).stdout.trim();
    if (o.opts['--device'] && !['emu', 'redroid'].includes(o.opts['--device'])) fail(`--device ${o.opts['--device']} は使えません`, '--device emu（app ワークフロー、既定）/ redroid（redroid ワークフロー）');
    // the redroid device: its own workflow (the device made in the job, then app run / ui on it). Its runs: gh run list --workflow redroid.yml
    if (o.opts['--device'] === 'redroid') {
      const mode = o.opts['--mode'] ?? 'run';
      if (!['run', 'ui'].includes(mode)) fail(`--mode ${mode} は --device redroid では使えません`, '--mode run / ui');
      const f = [['addon', o.opts['-a'] ?? o.opts['--addon'] ?? 'jsonui_demo'], ['mode', mode], ...['bench', 'keep', 'fresh'].map((k) => [k, o.flags.has(`--${k}`) ? 'true' : 'false'])];
      const since = Date.now() - 5000;
      const r = gh(['workflow', 'run', 'redroid.yml', '--repo', repo, '--ref', ref, ...f.flatMap(([k, v]) => ['-f', `${k}=${v}`])]);
      if (r.status !== 0) fail('redroid ワークフローを起動できません', (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' '));
      let rid = /runs\/(\d+)/.exec(r.stdout + r.stderr)?.[1];
      for (let k = 0; !rid && k < 20; k++) {
        await sleep(3000);
        rid = (ghJson([`repos/${repo}/actions/workflows/redroid.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=10`]).workflow_runs ?? []).find((x) => Date.parse(x.created_at) >= since)?.id;
      }
      out(`起動しました: ${rid ? `https://github.com/${repo}/actions/runs/${rid}` : 'redroid ワークフロー'}（${f.map(([k, v]) => `${k}=${v}`).join(' ')}、枝 ${ref}）`);
      if (!rid) fail('起動した実行が見つかりません', `gh run list --repo ${repo} --workflow redroid.yml`);
      if (!o.flags.has('--wait')) { out(`待たずに戻ります。結果: node lab.mjs app ci watch ${rid} --device redroid`); return; }
      return redroidCiWatch(repo, rid);
    }
    if (o.opts['--mode'] && !['run', 'ui', 'ui-all', 'hold'].includes(o.opts['--mode'])) fail(`--mode ${o.opts['--mode']} は使えません`, '--mode run（app.txt）/ ui（アドオンの JSON UI の画面すべて）/ ui-all（ラボが開ける画面すべて）/ hold（端末を常駐: node lab.mjs app live の run / ui で何度でも）');
    if (o.opts['--devices'] && !/^([1-8]|auto)$/.test(o.opts['--devices'])) fail('--devices は 1〜8 か auto（同時に動かす端末の数。auto: run は 1 台、ui / ui-all は 4 台）');
    if (o.opts['--hold'] && !(/^\d+$/.test(o.opts['--hold']) && Number(o.opts['--hold']) <= 300)) fail('--hold は分（0〜300）: 端末を動かしたまま、node lab.mjs app live の命令を待つ');
    // (account is on by default now: the license check needs it; --no-account turns it off)
    // runs are parallel by default: each gets a lane of its own (its own queue, its name in the run's title), so any number
    // start at once and each is found again. --lane <name>: runs of that name queue one after another
    // --knobs "APP_X=1 APP_Y=b": the lab's settings for every run; --try "<knobs>" (again and again): one run each, at once
    const knobs = o.opts['--knobs'] ?? '', tries = o.multi['--try'] ?? [''];
    const lane0 = o.opts['--lane'] ?? '';
    if (lane0 && !/^[a-z0-9-]{1,30}$/.test(lane0)) fail(`--lane ${lane0}: 英小文字・数字・- で 30 文字まで`);
    for (const kv of [knobs, ...tries].join(' ').split(/\s+/).filter(Boolean)) if (!/^APP_[A-Z0-9_]+=[A-Za-z0-9_.:,x-]*$/.test(kv)) fail(`--knobs / --try の ${kv} は APP_名前=値 の形で（値は英数字と _ . : , - だけ）`);
    if (tries.length > 8) fail('--try は 8 個まで（同時に走る実行の数）');
    const tag = Date.now().toString(36).slice(-5), started = [];
    for (const [i, t] of tries.entries()) {
      const lane = lane0 || `p${tag}${tries.length > 1 ? `-${i + 1}` : ''}`, kn = [knobs, t].join(' ').trim().split(/\s+/).filter(Boolean).join(' ');
      const f = [['addon', o.opts['-a'] ?? o.opts['--addon'] ?? 'jsonui_demo'], ['account', o.flags.has('--no-account') ? 'false' : 'true'], ...(o.opts['--scenario'] ? [['scenario', o.opts['--scenario']]] : []), ...(o.opts['--bds'] ? [['bds', o.opts['--bds']]] : []), ...(o.opts['--screen'] ? [['screen', o.opts['--screen']]] : []),
        ...(o.opts['--mode'] ? [['mode', o.opts['--mode']]] : []), ...(o.opts['--devices'] ? [['devices', o.opts['--devices']]] : []), ...(o.flags.has('--fresh') ? [['fresh', 'true']] : []),
        ['lane', lane], ...(kn ? [['knobs', kn]] : []), ...(o.opts['--hold'] ? [['hold', o.opts['--hold']]] : [])];
      const since = Date.now() - 5000;
      const r = gh(['workflow', 'run', 'app.yml', '--repo', repo, '--ref', ref, ...f.flatMap(([k, v]) => ['-f', `${k}=${v}`])]);
      if (r.status !== 0) fail('ワークフローを起動できません', (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' '));
      let rid = /runs\/(\d+)/.exec(r.stdout + r.stderr)?.[1];
      for (let k = 0; !rid && k < 20; k++) {
        await sleep(3000);
        const runs = ghJson([`repos/${repo}/actions/workflows/app.yml/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=30`]).workflow_runs ?? [];
        rid = runs.find((x) => Date.parse(x.created_at) >= since && String(x.display_title ?? '').endsWith(`[${lane}]`))?.id;
      }
      if (!rid) fail('起動した実行が見つかりません', `gh run list --repo ${repo} --workflow app.yml`);
      started.push(rid);
      out(`起動しました: https://github.com/${repo}/actions/runs/${rid}（${f.map(([k, v]) => `${k}=${v}`).join(' ')}、枝 ${ref}）`);
    }
    // not waited for unless asked: start more, look at others, drive a held device meanwhile
    if (!o.flags.has('--wait')) {
      out(`待たずに戻ります。結果: ${started.map((x) => `node lab.mjs app ci watch ${x}`).join(' / ')}`);
      if (Number(o.opts['--hold']) || o.opts['--mode'] === 'hold') out(`さわる: ${started.map((x) => `node lab.mjs app live --run ${x} "screen"`).join(' / ')}（待つ状態になるまでは --wait。試す: "run" / --steps <ファイル> / "pull <枝>"）`);
      return;
    }
    if (started.length > 1) {
      for (const x of started) { const sp = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'ci', 'watch', String(x), '--repo', repo, ...(full ? ['--full'] : [])], { stdio: 'inherit' }); if (sp.status) process.exitCode = sp.status; }
      return;
    }
    id = started[0];
  }
  if (sub !== 'fetch') {
    const end = Date.now() + 150 * 60_000, seen = new Set();
    for (;;) {
      const run = ghJson([`repos/${repo}/actions/runs/${id}`]);
      for (const j of ghJson([`repos/${repo}/actions/runs/${id}/jobs`]).jobs ?? []) for (const s of j.steps ?? []) {
        const k = `${j.id}/${s.number}/${s.status}`;
        if (s.status !== 'queued' && !seen.has(k)) { seen.add(k); if (s.status === 'completed') out(`  ${s.conclusion === 'success' ? '✔' : s.conclusion === 'skipped' ? '-' : '✘'} ${soften(s.name)}`); }
      }
      if (run.status === 'completed') break;
      if (Date.now() > end) fail('150 分で終わりませんでした', `node lab.mjs app ci watch ${id}`);
      await sleep(20_000);
    }
  }
  const r = ciFetch(repo, id, { full });
  // one device: report.md here; several: shard-<k>/report.md each
  const shardDirs = fs.readdirSync(r.dir).filter((x) => /^shard-\d+$/.test(x)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  const rep = shardDirs.length ? shardDirs.map((d) => `## ${d}\n${fs.existsSync(path.join(r.dir, d, 'report.md')) ? fs.readFileSync(path.join(r.dir, d, 'report.md'), 'utf8') : ''}`).join('\n')
    : fs.existsSync(path.join(r.dir, 'report.md')) ? fs.readFileSync(path.join(r.dir, 'report.md'), 'utf8') : '';
  out(`${r.run.conclusion === 'success' ? 'PASS' : 'FAIL'} ${rel(r.dir)}（実行 ${r.run.conclusion}、チェック ${r.checks} 個）`);
  out(`     ${r.files.join(' ')}`);
  // result + error lines only, already anonymized; errors keep their wording
  for (const l of rep.split('\n').filter((l) => /^## shard-|^\| (結果|参加|準備済みの端末) \|/.test(l) || /^- (✘|次|.*次にやること)/.test(l) || /^- [^✔]/.test(l)).slice(0, 8 + 4 * shardDirs.length)) out(`     ${l}`);
  // no report from the run itself (the job stopped before it could upload): what the job says
  if (!/^# app: /m.test(rep) && r.explain) { out(`     ${r.explain.title}`); r.explain.lines.forEach((l) => out(`     - ${G.anonymize(l)}`)); }
  if (!r.checks) out('     チェックがありません（2 つ目のジョブが動いていない？）。annotations.txt を見てください');
  out(`     読む: ${rel(path.join(r.dir, 'report.md'))} → details.txt（結果とエラー）→ shots/*.png${full ? ' → logcat-wide.txt' : '（全ログは --full）'}`);
}

// ---- annotate: the newest run as GitHub annotations (readable through the API where artifacts are not) ----
function annotateCmd(args) {
  const dir = path.resolve(parse(args).rest[0] ?? RUNS);
  const runDir = newestRun(dir);
  if (!runDir) { out(`::notice title=app の結果::${rel(dir)} に実行の記録がありません`); return; }
  // (the same tesseract the run used: APP_TESSERACT, else the one on PATH)
  const TESS = process.env.APP_TESSERACT || 'tesseract', tess = C.ocrAvailable(TESS);
  const ocr = tess ? (png) => { const r = spawnSync(TESS, [png, '-', '--psm', '11'], { encoding: 'utf8', timeout: 60_000 }); return r.status === 0 ? r.stdout : '（OCR 失敗）'; } : null;
  const secrets = [process.env.GOOGLE_AAS_TOKEN, process.env.GOOGLE_EMAIL, process.env.GOOGLE_PASSWORD].filter(Boolean);
  for (const a of annotations(runDir, { ocr, secrets })) out(`::notice title=${ghEscape(a.title).replace(/[:,]/g, ' ')}::${ghEscape(a.body)}`);
  if (!tess) out('::notice title=画面の文字::tesseract が無いので、スクリーンショットの文字は読んでいません');
}

// ---- redroid: the real Android in a container (app/redroid/): no VM, a prepared /data restored in 0.1 s ----
/** a redroid workflow run: waited for (gh run watch), its artifacts into app/runs/gh-<id>/, the verdict and report's head */
function redroidCiWatch(repo, id, { wait = true } = {}) {
  if (wait) spawnSync('gh', ['run', 'watch', String(id), '--repo', repo, '--interval', '30'], { stdio: 'inherit' });
  const run = ghJson([`repos/${repo}/actions/runs/${id}`]);
  if (run.status !== 'completed') { out(`まだ終わっていません（${run.status}）: node lab.mjs app ci watch ${id} --device redroid`); return; }
  const dir = path.join(RUNS, `gh-${id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const d = gh(['run', 'download', String(id), '--repo', repo, '-D', dir]);
  if (d.status !== 0) out(`W 成果物を取れません（${(d.stderr || d.stdout).trim().split('\n').pop()}）: 注釈だけ読みます`);
  // the notices the scripts left (seconds to the title, app run's verdict, why it stopped): readable without the artifacts
  const notes = [];
  for (const j of ghJson([`repos/${repo}/actions/runs/${id}/jobs`]).jobs ?? []) {
    for (const a of ghJson([`repos/${repo}/check-runs/${j.id}/annotations`])) notes.push(`${a.annotation_level === 'failure' ? '✘' : a.annotation_level === 'warning' ? '⚠' : '・'} ${a.title ?? ''}: ${String(a.message ?? '').slice(0, 400)}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notices.txt'), G.anonymize(notes.join('\n'), [process.env.GOOGLE_AAS_TOKEN, process.env.GOOGLE_EMAIL].filter(Boolean)) + '\n');
  const report = [path.join(dir, 'redroid-game', 'report.md'), path.join(dir, 'report.md')].find((f) => fs.existsSync(f));
  out(`${run.conclusion === 'success' ? 'PASS' : 'FAIL'} redroid ${run.conclusion}（https://github.com/${repo}/actions/runs/${id}）`);
  notes.filter((l) => /^✘|app (run|ui) を redroid で|デバッグできるまで/.test(l)).slice(0, 8).forEach((l) => out('  ' + l));
  if (report) fs.readFileSync(report, 'utf8').split('\n').filter((l) => l.trim()).slice(0, 12).forEach((l) => out('  ' + l));
  out(`結果: ${rel(dir)}/（notices.txt${report ? `、${rel(report)}` : ''}）`);
  if (run.conclusion !== 'success') process.exitCode = 1;
}
const REDROID = path.join(APPDIR, 'redroid');
const redroidMod = () => import(pathToFileURL(path.join(REDROID, 'redroid.mjs')).href);
// (its own processes, the output as it comes: the scripts print their own stages and say E … with the reason)
function redroidRun(script, args) {
  const r = spawnSync(process.execPath, [path.join(REDROID, script), ...args], { cwd: TOP, stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
}
const REDROID_HELP = `app redroid: 本物の Minecraft を redroid（コンテナの Android、VM なし）で。準備した /data を戻して起動 → タイトルまで約 50 秒
  doctor                     このマシンに足りないものと直し方（docker・binder・sudo・adb・イメージ・準備済みの端末）
  setup                      端末のイメージを作る（redroid + MindTheGapps: Play ストアと Play 開発者サービス。約 1 分）
  prep [--data <dir>]        準備済みの端末を作る（一度だけ、約 8 分）: アカウント → checkin → Play がゲームを入れる → タイトル
  run -a <アドオン> [--keep] [app run の指定 …]   = node lab.mjs app run -a <アドオン> --device redroid
  ui -a <アドオン> [--keep] [app ui の指定 …]     = node lab.mjs app ui -a <アドオン> --device redroid
  up [--restore overlay|direct] / down / facts / launch   端末だけ起こす・止める・中身・ゲームだけ起動してタイトルまで計る
  bench [--rounds 3]         戻す → 起動 → タイトル の秒数（と常駐の端末でゲームだけ）       report   いちばん新しい実行の報告
  seal / open [--file f]     準備済みの端末を暗号化して 1 つのファイルに / そこから戻す（鍵: APP_CACHE_KEY か GOOGLE_AAS_TOKEN。root で）
  （--keep で残した端末があれば、次の run / ui は戻さず起動もせずにそれを使います: 2 回目からはゲームの起動だけ）
  （Linux だけ: binder のカーネルモジュールと docker が要ります。GitHub Actions: node lab.mjs app ci --device redroid）`;
async function redroidCmd(args) {
  const sub = args.shift();
  const R = await redroidMod();
  if (!sub || sub === 'help' || sub === '--help') return out(REDROID_HELP);
  if (sub === 'doctor' || sub === 'setup' || sub === 'up' || sub === 'down' || sub === 'facts' || sub === 'settle') return redroidRun('redroid.mjs', [sub, ...args]);
  if (sub === 'prep' || sub === 'bench' || sub === 'launch' || sub === 'report') return redroidRun('game.mjs', [sub, ...args]);
  // (the prepared device into / out of the encrypted vault: Android's uids, so as root)
  if (sub === 'seal' || sub === 'open') return redroidRun('game.mjs', [sub, ...args]);
  if (sub === 'run' || sub === 'ui') {
    const a = R.appArgs(sub, args);
    if (a.error) fail(a.error, a.hint);
    const at = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    const f = R.doctor(R.hostFacts({ data: at('--data') && path.resolve(at('--data')), image: at('--image') })), miss = f.find((r) => !r.ok && !r.soft);
    if (miss) fail(`redroid の端末を使えません: ${miss.name} ${miss.detail}`, `${miss.fix}（全部: node lab.mjs app redroid doctor）`);
    return redroidRun('game.mjs', a.args);
  }
  fail(`知らない redroid のコマンド ${sub}`, 'node lab.mjs app redroid help');
}

// ---- main ----
const argv0 = process.argv.slice(2);
const cmd = argv0.shift();
// run / ui on the redroid device: --device redroid (or APP_DEVICE=redroid), handed to app/redroid as a whole
let argv = argv0, onRedroid = false, badDevice = null;
if (cmd === 'run' || cmd === 'ui') {
  const d = (await redroidMod()).deviceOf(argv0);
  if (!['emu', 'redroid'].includes(d.device)) badDevice = String(d.device);
  argv = d.argv;
  onRedroid = d.device === 'redroid';
}
try {
  if (badDevice) fail(`--device ${badDevice} は使えません`, '--device emu（エミュレータ、既定）/ redroid（コンテナの Android: node lab.mjs app redroid help）');
  if (onRedroid) await redroidCmd([cmd, ...argv]);
  else if (!cmd || cmd === 'status' || cmd === 'doctor') statusCmd();
  else if (cmd === 'help' || cmd === '--help' || cmd === '-h') out(HELP);
  else if (cmd === 'setup') await setupCmd(argv);
  else if (cmd === 'token') await tokenCmd(argv);
  else if (cmd === 'apk') await apkCmd(argv);
  else if (cmd === 'emu') await emuCmd(argv);
  else if (cmd === 'account') await accountCmd(argv);
  else if (cmd === 'screen') await screenCmd(argv);
  else if (cmd === 'tap' || cmd === 'key' || cmd === 'text') liveInput(cmd, argv);
  else if (cmd === 'install') { parse(argv); const list = apkPaths() ?? fail('APK がありません', 'node lab.mjs app apk fetch'); const { adb } = await ensureEmulator(); out(install(adb, list, K.inspectApks(list)) ? 'OK 入れました' : 'OK'); }
  else if (cmd === 'init') initCmd(argv);
  else if (cmd === 'run') await runCmd(argv);
  else if (cmd === 'secrets') await secretsCmd(argv);
  else if (cmd === 'annotate') annotateCmd(argv);
  else if (cmd === 'checks') await checksCmd(argv);
  else if (cmd === 'vending') {
    const o = parse(argv, { flags: ['--cleanup'] });
    if (o.rest.length) fail(`知らない指定 ${o.rest.join(' ')}`, 'node lab.mjs app vending [--cleanup]');
    const f = await A.extractVending({ labDir: LAB, log: (x) => out(x), cleanup: o.flags.has('--cleanup') });
    out(`OK ${rel(f)}（--account が使います）`);
    // this APK is what makes every later run skip the whole extraction (a second emulator): host it once and the CI run is minutes shorter
    const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    out(`   sha256 ${sha}`);
    out('   毎回の取り出し（2 台目のエミュレータ）を省くには: 手元で --vending でこのファイルを渡す、または URL に置いて');
    out('   変数 APP_VENDING_URL（この URL）と APP_VENDING_SHA256（上の値）を設定します。');
  }
  else if (cmd === 'ci') await ciCmd(argv);
  else if (cmd === 'redroid') await redroidCmd(argv);
  else if (cmd === 'hold') await holdCmd(argv);
  else if (cmd === 'tidy') await tidyCmd(argv);
  else if (cmd === 'open') await openCmd(argv);
  else if (cmd === 'live') await liveCmd(argv);
  else if (cmd === 'prepare') await prepareCmd(argv);
  else if (cmd === 'ui') await uiCmd(argv);
  else if (cmd === 'keys') await keysCmd(argv);
  else if (cmd === 'guard') { const d = path.resolve(parse(argv).rest[0] ?? RUNS); const bad = guard(d, [process.env.GOOGLE_AAS_TOKEN]); bad.forEach((b) => out(`E ${b}`)); out(bad.length ? 'FAIL 入れてはいけないものがあります' : `OK ${rel(d)}: スクショとログだけです`); process.exit(bad.length ? 1 : 0); }
  else fail(`知らないコマンド: app ${cmd}`, 'node lab.mjs app help');
  process.exit(process.exitCode ?? 0);
} catch (e) {
  const known = e instanceof K.AppError;
  if (known) { out(`ERR ${e.message}`); if (e.hint) out(`  → ${e.hint}`); }
  else { out(`ERR ラボの不具合かもしれません: ${e?.stack ?? e}`); out('  → この出力を添えて報告してください（node tests/app-offline.mjs で試験できます）'); }
  if (process.env.GITHUB_ACTIONS === 'true') {
    // no failing step stays silent: what it said, and the emulator log it was working with
    const logf = path.join(LAB, cmd === 'vending' ? 'emulator-playstore.log' : 'emulator.log');
    const emu = fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8').split('\n').filter((l) => l.trim() && !/\|   /.test(l)).slice(-15) : [];
    const body = G.anonymize([...SAID.slice(-40), ...(emu.length ? [`--- ${path.basename(logf)} ---`, ...emu] : [])].join('\n'), [process.env.GOOGLE_AAS_TOKEN, process.env.GOOGLE_EMAIL].filter(Boolean));
    process.stdout.write(`::error title=node lab.mjs app ${cmd} が失敗::${ghEscape(G.tailFit(body, 1800))}\n`);
  }
  process.exit(known ? 1 : 2);
}
