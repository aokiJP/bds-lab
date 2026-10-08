// app.txt: アプリにさせること。1 行 1 手順（tests.txt と同じ感覚）。`node lab.mjs app help` はこの一覧（行頭が "//   "）を表示する。
//
//   launch                      アプリを起動する                     stop     アプリを止める
//   join                        ラボの BDS に直接参加する（ディープリンク minecraft://connect）
//   wait <ミリ秒>                待つ                                 shot <名前>   画面を撮る → shots/NN-<名前>.png
//   tap <x> <y>                 押す。0〜1 は画面に対する割合（0.5 0.5 = 真ん中）、1 より大きければピクセル
//   swipe <x1> <y1> <x2> <y2> [ミリ秒]   なぞる          key <BACK|ENTER|ESCAPE|TAB|DPAD_UP など|番号>   キーを押す
//   text <文字>                  文字を打つ（英数字と記号だけ。日本語は打てない）
//   do <コマンド>                BDS のコンソールで実行（tests.txt のコマンドがそのまま使える: scriptevent, js, give ...）
//   until joined [ミリ秒]        アプリのプレイヤーがワールドに出るまで待つ
//   until title [ミリ秒]         ゲームのタイトル画面まで待つ（ゲームが前面、Android のダイアログなし、赤い起動画面でも真っ黒でもなく、落ち着いている。
//                                最初の起動の「WELCOME TO MINECRAFT!」などは OCR で読めれば「Maybe later」で抜ける。
//                                準備済みの端末（app prepare）なら、もうそこにいるので数秒）
//   until stable [ミリ秒]        画面が落ち着くまで待つ（6 秒変わらない。真っ黒の間は待ち続ける）
//   until server <正規表現> [ミリ秒]    BDS のログにその行が出るまで待つ
//   until log <正規表現> [ミリ秒]       アプリ（Android）のログにその行が出るまで待つ
//   … ; every <ミリ秒> <手順>    until の後ろに付けると、待つ間その手順を繰り返す（例 until joined 120000 ; every 15000 tap 0.5 0.62）
//   expect server|log <正規表現>   ここまでのログに有れば OK、無ければ失敗     absent server|log <正規表現>   有れば失敗
//   pull <端末のパス> [名前]      端末からファイルを取り出す → pulled/     push <ファイル> <端末のパス>   端末へ送る
//   sh <コマンド>                端末のシェルで実行（出力は do.txt）
// 実機でしかできないこと（ゲームのクライアントの操作と、クライアントにしか出ないエラー）:
//   section <名前>               ここから「名前」の区切り（報告の表、クライアントのエラーをどの画面のものかに分ける）。区切りのある手順は、
//                                失敗してもその区切りを飛ばして次の区切りから続ける（開いている画面は戻るで閉じる）
//   chat <文字>                  チャットを開いて打って送る（/ で始めればクライアントのプレイヤーとしてのコマンド）
//   tap text <正規表現>          画面の文字を読んで（OCR）、その文字を押す（例 tap text (?i)^play$）
//   until text <正規表現> [ミリ秒]   画面にその文字が出るまで待つ（OCR）
//   key <キー>                   キーを押す（A〜Z 0〜9 F1〜F12 ENTER ESCAPE BACK TAB SPACE SLASH UP など、または番号）
//   press <キー>[+<キー>…] [ミリ秒]   キーを押したままにする（例 press W 2000 で歩く、press SHIFT+W 1500）
//   hold <x> <y> [ミリ秒]        長押し                                record start|stop   画面を録画（recordings/*.mp4）
//   perf [ミリ秒]                ゲームのメモリと、その間の毎秒のフレーム数
//   changed [割合]               いまの画面が `shot world` の画面（何も開いていないワールド）と違う（画面が本当に開いた）。既定 3%
//   network delay <ミリ秒|none> / network speed <full|lte|hsdpa|umts|edge|gprs|kbps>   端末の回線を遅くする（読み込み中の画面・切断を試す）
//   size <幅>x<高さ>|reset        ゲームの画面の大きさを変える（横長の向きで。例 size 1024x768 = 4:3 のタブレット、size 2400x1080 = 細長い
//                                スマホ）。JSON UI がその比率・大きさで崩れないかを見る。density <dpi>|reset   画素の細かさ（UI の大きさ）
//   cutout <corner|double|hole|tall|waterfall|none>   スマホの切り欠き（ノッチ・パンチホール）を画面に出す: セーフエリアを試す
//   expect text <正規表現> / absent text <正規表現>   いまの画面にその文字がある / ない（OCR。例 absent text \.name$ = 訳されていないキー）
//   mouse tap|move <x> <y> / mouse scroll <x> <y> <量>   マウスで押す / 乗せる（ホバー: ツールチップ）/ ホイール（スクロールする画面）
//   pad <A|B|X|Y|L1|R1|L2|R2|START|SELECT|UP|DOWN|LEFT|RIGHT>   ゲームコントローラーのボタン（UI のフォーカスの移り方）
//   screen off|on                画面を消す / 点ける（ゲームの一時停止と再開）   background / foreground   ホームへ / ゲームへ戻る
//   trim <RUNNING_CRITICAL|COMPLETE|…>   Android がメモリ不足を知らせる（ゲームの後始末と、戻った後の画面）
//   until clientlog <正規表現> [ミリ秒]   ゲームのコンテンツログ（クライアントだけのエラー: JSON UI など）にその行が出るまで待つ
//   expect clientlog <正規表現> / absent clientlog <正規表現>   ここまでのコンテンツログにある / ない
//   Android の「応答なし」「停止しました」のダイアログには、until・shot・tap などの前にラボが答える（待つ / 閉じる。回数は報告に）
// ゲームを人のように遊ぶ（端末のコントローラー: スティック・トリガー・ボタンを押したまま。lib/play.mjs。ワールドの中で）:
//   walk <forward|back|left|right>… [秒]   歩く（walk forward left 2 で斜め）     sprint [秒]   前へ走る
//   jump [forward|back|left|right] [秒]   跳ぶ / その向きへ跳びながら進む        sneak [秒]   しゃがむ（R3）
//   look <left|right|up|down> [ミリ秒] [強さ%]   視点を回す（右スティック）      stick <L|R> <x%> <y%> [ミリ秒]   好きな向き
//   attack [秒] / mine [秒]     殴る・壊す（RT）       use [秒] / place [秒]   使う・置く・開ける（LT）
//   slot <1〜9|next|prev>       持つものを替える       inventory   持ち物（Y）     drop [回数]   落とす（Q）
//   cmd </コマンド>             プレイヤーとしてコマンド    perspective   視点の切り替え（F5）   pause   ポーズ（START）
//   release                     スティック・トリガー・ボタンを全部はなす
//   move <向き>… | move stop     歩き続ける / 止まる    turn <向き> [強さ%] | turn stop   視点を回し続ける    mine|use on|off   押し続ける
//   where   いる所・向き・体力・手のもの（サーバーに聞く）   items   持ち物の一覧   face <north|south|east|west|角度> [上下]   その向き
//   lookat <x> <y> <z>          その場所を見る            goto <x> <z> [秒]   そこまで歩く（向きを合わせて前へ、を繰り返す）
// 行末の ` # …` はコメント。正規表現の頭に (?i) で大文字小文字を無視。失敗した手順で止まり、その画面を fail-line<行>.png に撮る。
import fs from 'node:fs';
import path from 'node:path';
import { GAME_VERBS, gameStep, playGame, playServer } from './play.mjs';
import { ANDROID_KEYS, androidKey, linuxKey, findText, firstRunButton, titleWords, joinPromptButton, joinRefusal, joinPromptKind, ownWorldListed, loadingScreen, playScreen, backToTitle, buttonFocused, focusRing, lanCardWord, titlePlay, holdScript, inputText, keyboardDevice, meminfoMb, gameLayer, framesIn, recPath } from './client.mjs';

// APP_TIME_SCALE (0..1, tests on the fake device): every fixed pause shorter; deadlines stay in real time
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (Math.min(1, Math.max(0, Number(process.env.APP_TIME_SCALE) || 1)))));
export const DEFAULT_MS = { joined: 300_000, stable: 180_000, title: 600_000, server: 60_000, log: 60_000 };
const STABLE_MS = Number(process.env.APP_STABLE_MS) || 6000;
const TITLE_CALM_MS = Number(process.env.APP_TITLE_CALM_MS) || 4000;
const TITLE_OCR_MS = Number(process.env.APP_TITLE_OCR_MS) || 6000;
const JOIN_OCR_MS = Number(process.env.APP_JOIN_OCR_MS) || 4000;
export const KEYS = ANDROID_KEYS;
const VERBS = new Set(['launch', 'stop', 'join', 'wait', 'shot', 'tap', 'swipe', 'key', 'text', 'do', 'until', 'expect', 'absent', 'pull', 'push', 'sh', 'section', 'chat', 'press', 'hold', 'record', 'perf', 'changed', 'network', 'size', 'density', 'cutout',
  'mouse', 'pad', 'screen', 'background', 'foreground', 'trim', ...GAME_VERBS]);
// a game controller's buttons (Android key names): the game's UI moves its focus with them, a path touch never takes
// steps that leave the game as it is (the rest act on it)
const STILL = new Set(['launch', 'until', 'wait', 'shot', 'section', 'do', 'expect', 'absent', 'changed', 'perf', 'record', 'pull', 'sh', 'where', 'items']);
export const PAD = { A: 'BUTTON_A', B: 'BUTTON_B', X: 'BUTTON_X', Y: 'BUTTON_Y', L1: 'BUTTON_L1', R1: 'BUTTON_R1', L2: 'BUTTON_L2', R2: 'BUTTON_R2', START: 'BUTTON_START', SELECT: 'BUTTON_SELECT',
  THUMBL: 'BUTTON_THUMBL', THUMBR: 'BUTTON_THUMBR', UP: 'DPAD_UP', DOWN: 'DPAD_DOWN', LEFT: 'DPAD_LEFT', RIGHT: 'DPAD_RIGHT' };
// the scenario's names for the controller's buttons → the device controller's words (app/relay/lab-pad.c)
const PAD_WORD = { L1: 'LB', R1: 'RB', L2: 'LT', R2: 'RT', THUMBL: 'L3', THUMBR: 'R3' };
// what Android tells an app when memory runs short (am send-trim-memory)
export const TRIM = ['HIDDEN', 'RUNNING_MODERATE', 'BACKGROUND', 'RUNNING_LOW', 'MODERATE', 'RUNNING_CRITICAL', 'COMPLETE'];
// the phone shapes Android can draw over the screen (a notch, a punch hole...): what the game's safe area has to keep clear of
export const CUTOUTS = ['corner', 'double', 'hole', 'tall', 'waterfall'];
const LOGS = ['server', 'log', 'clientlog', 'text'];

const num = (s) => (s !== undefined && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN);
// a regex written in the file; `(?i)` at the start = ignore case
export function rx(src) { const i = src.startsWith('(?i)'); return new RegExp(i ? src.slice(4) : src, i ? 'i' : ''); }

/** @returns {{steps: Array<{line:number, verb:string, args:string[], raw:string, every?:{ms:number, step:object}}>, errors: string[]}} */
export function parseScenario(text) {
  const steps = [], errors = [];
  String(text).split(/\r?\n/).forEach((raw0, i) => {
    const line = i + 1;
    if (/^\s*#/.test(raw0)) return;
    const raw = raw0.replace(/\s+#\s.*$/, '').trim();   // ` # comment` at the end (a regex keeps a bare #)
    if (!raw) return;
    const [main, extra] = raw.split(/\s;\s/, 2);
    const one = (s) => {
      const verb = s.split(/\s+/)[0], rest = s.slice(verb.length).trim();
      const args = ['do', 'text', 'sh', 'chat', 'cmd'].includes(verb) ? [rest] : ['until', 'expect', 'absent'].includes(verb) ? splitRegexArgs(rest)
        : verb === 'tap' && /^text\s/.test(rest) ? ['text', rest.slice(5).trim()] : rest ? rest.split(/\s+/) : [];
      return { line, verb, args, raw: s };
    };
    const st = one(main);
    const bad = check(st);
    if (bad) { errors.push(`${line}: ${bad}: ${raw}`); return; }
    if (extra !== undefined) {
      const m = /^every\s+(\d+)\s+(.+)$/.exec(extra.trim());
      const sub = m && one(m[2]);
      if (st.verb !== 'until' || !m || check(sub) || ['until', 'wait', 'do'].includes(sub.verb)) { errors.push(`${line}: 「; every」は until の後ろにだけ書けます（書き方: until … ; every <ミリ秒> <tap|key|shot|swipe|text|join>）: ${raw}`); return; }
      st.every = { ms: Number(m[1]), step: sub };
    }
    steps.push(st);
  });
  return { steps, errors };
}
// until server <regex with spaces> [ms]: the last word is a timeout only when it is a number
function splitRegexArgs(rest) {
  const m = /^(\S+)\s*(.*)$/.exec(rest);
  if (!m) return [];
  const [, what, tail] = m;
  if (!LOGS.includes(what)) return [what, ...tail.split(/\s+/).filter(Boolean)];
  const t = /^(.*?)(?:\s+(\d+))?$/.exec(tail);
  return [what, t[1], ...(t[2] ? [t[2]] : [])];
}
function check(s) {
  const a = s.args;
  if (!VERBS.has(s.verb)) return `知らない手順「${s.verb}」です（使えるもの: ${[...VERBS].join(' ')}）`;
  if (s.verb === 'wait' && !(num(a[0]) >= 0)) return '書き方: wait <ミリ秒>';
  if (s.verb === 'shot' && (a.length !== 1 || !/^[\w.-]+$/.test(a[0]))) return '書き方: shot <名前>（名前は英数字と _ . - だけ、空白なし）';
  if (s.verb === 'tap' && a[0] === 'text') { if (!a[1]) return '書き方: tap text <正規表現>'; try { rx(a[1]); } catch (e) { return `正規表現の誤り: ${e.message}`; } }
  else if (s.verb === 'tap' && (a.length !== 2 || a.some((x) => Number.isNaN(num(x))))) return '書き方: tap <x> <y>（例 tap 0.5 0.62） / tap text <正規表現>';
  if (s.verb === 'swipe' && (a.length < 4 || a.slice(0, 5).some((x) => Number.isNaN(num(x))))) return '書き方: swipe <x1> <y1> <x2> <y2> [ミリ秒]';
  if (s.verb === 'key' && !(a[0] && androidKey(a[0]) !== null)) return '書き方: key <A〜Z|0〜9|F1〜F12|ENTER|ESCAPE|BACK|TAB|SPACE|SLASH|UP|DOWN|LEFT|RIGHT など|番号>';
  if (['do', 'text', 'sh', 'chat'].includes(s.verb) && !a[0]) return `${s.verb} の後ろに中身が要ります`;
  if (s.verb === 'section' && (a.length !== 1 || !/^[\w.-]+$/.test(a[0]))) return '書き方: section <名前>（英数字と _ . - だけ）';
  if (s.verb === 'press' && (!a[0] || a[0].split('+').some((k) => linuxKey(k) === null) || (a[1] !== undefined && Number.isNaN(num(a[1]))))) return '書き方: press <キー>[+<キー>…] [ミリ秒]（例 press W 2000）';
  if (s.verb === 'hold' && (a.length < 2 || a.slice(0, 3).some((x) => Number.isNaN(num(x))))) return '書き方: hold <x> <y> [ミリ秒]';
  if (s.verb === 'record' && !['start', 'stop'].includes(a[0])) return '書き方: record start|stop';
  if (s.verb === 'perf' && a[0] !== undefined && Number.isNaN(num(a[0]))) return '書き方: perf [ミリ秒]';
  if (s.verb === 'changed' && a[0] !== undefined && !(num(a[0]) > 0 && num(a[0]) < 1)) return '書き方: changed [0〜1 の割合]（例 changed 0.05）';
  if (s.verb === 'network' && !((a[0] === 'delay' && /^(none|\d+)$/.test(a[1] ?? '')) || (a[0] === 'speed' && /^(full|lte|hsdpa|umts|edge|gprs|\d+)$/.test(a[1] ?? '')))) return '書き方: network delay <ミリ秒|none> / network speed <full|lte|hsdpa|umts|edge|gprs|kbps>';
  if (s.verb === 'size' && !(a.length === 1 && (a[0] === 'reset' || /^\d{3,4}x\d{3,4}$/.test(a[0])))) return '書き方: size <幅>x<高さ>|reset（例 size 1024x768）';
  if (s.verb === 'density' && !(a.length === 1 && (a[0] === 'reset' || (num(a[0]) >= 100 && num(a[0]) <= 800)))) return '書き方: density <dpi>|reset（例 density 320）';
  if (s.verb === 'cutout' && !(a.length === 1 && [...CUTOUTS, 'none'].includes(a[0]))) return `書き方: cutout <${CUTOUTS.join('|')}|none>`;
  if (s.verb === 'mouse' && !((['tap', 'move'].includes(a[0]) && a.length === 3 && a.slice(1).every((x) => !Number.isNaN(num(x)))) || (a[0] === 'scroll' && a.length === 4 && a.slice(1).every((x) => !Number.isNaN(num(x)))))) return '書き方: mouse tap|move <x> <y> / mouse scroll <x> <y> <量（下へ正、上へ負）>';
  if (s.verb === 'pad' && !(a.length === 1 && PAD[String(a[0]).toUpperCase()])) return `書き方: pad <${Object.keys(PAD).join('|')}>`;
  if (s.verb === 'screen' && !(a.length === 1 && ['off', 'on'].includes(a[0]))) return '書き方: screen off|on';
  if ((s.verb === 'background' || s.verb === 'foreground') && a.length) return `書き方: ${s.verb}（引数なし）`;
  if (s.verb === 'trim' && !(a.length === 1 && TRIM.includes(String(a[0]).toUpperCase()))) return `書き方: trim <${TRIM.join('|')}>`;
  if (s.verb === 'until') {
    if (a[0] === 'joined' || a[0] === 'stable' || a[0] === 'title') { if (a[1] !== undefined && Number.isNaN(num(a[1]))) return `書き方: until ${a[0]} [ミリ秒]`; }
    else if (LOGS.includes(a[0])) { if (!a[1]) return `書き方: until ${a[0]} <正規表現> [ミリ秒]`; try { rx(a[1]); } catch (e) { return `正規表現の誤り: ${e.message}`; } }
    else return '書き方: until title|joined|stable|server <正規表現>|log <正規表現>|clientlog <正規表現>|text <正規表現> [ミリ秒]';
  }
  if (s.verb === 'expect' || s.verb === 'absent') {
    if (!['server', 'log', 'clientlog', 'text'].includes(a[0]) || !a[1]) return `書き方: ${s.verb} server|log|clientlog|text <正規表現>`;
    try { rx(a[1]); } catch (e) { return `正規表現の誤り: ${e.message}`; }
  }
  if (GAME_VERBS.has(s.verb)) { const g = gameStep(s.verb, a.filter((x) => x !== '')); if (g.error) return g.error; }
  if (s.verb === 'pull' && !a[0]) return '書き方: pull <端末のパス> [名前]';
  if (s.verb === 'push' && a.length !== 2) return '書き方: push <ファイル> <端末のパス>';
  return null;
}

// ---- screens ----
export function pngSize(buf) { return buf && buf.length > 24 && buf[0] === 0x89 ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null; }
/** the share of sampled pixels that differ (0..1). decode: common/extra.mjs pngDecode */
export function screenDiff(a, b, decode) {
  if (!a || !b) return 1;
  const A = decode(a), B = decode(b);
  if (A.w !== B.w || A.h !== B.h) return 1;
  let n = 0, d = 0;
  for (let y = 0; y < A.h; y += 4) for (let x = 0; x < A.w; x += 4) {
    const o = (y * A.w + x) * 4; n++;
    if (Math.abs(A.data[o] - B.data[o]) + Math.abs(A.data[o + 1] - B.data[o + 1]) + Math.abs(A.data[o + 2] - B.data[o + 2]) > 30) d++;
  }
  return n ? d / n : 1;
}
/** the share of sampled pixels in Mojang's red (the game's first screen, bright or dimmed under a dialog): the splash, not the title */
export function splashRed(buf, decode) {
  const I = decode(buf); let n = 0, red = 0;
  for (let y = 0; y < I.h; y += 8) for (let x = 0; x < I.w; x += 8) { const o = (y * I.w + x) * 4, r = I.data[o], g = I.data[o + 1], b = I.data[o + 2]; n++; if (r > 70 && r > 2.2 * g && r > 2.2 * b) red++; }
  return n ? red / n : 0;
}
/** what the title screen looks like from outside (pure but for decoding): the game's window in front (focus null = not
 *  known), not blank, not the red splash */
export function titleLike(buf, decode, { focus = null, pkg = 'com.mojang.minecraftpe' } = {}) {
  return (!focus || focus.includes(pkg)) && !blankScreen(buf, decode) && splashRed(buf, decode) < 0.5;
}
/** mostly one colour: a black / white screen (the GPU drew nothing) */
export function blankScreen(buf, decode) {
  const I = decode(buf); const seen = new Map(); let n = 0;
  for (let y = 0; y < I.h; y += 8) for (let x = 0; x < I.w; x += 8) { const o = (y * I.w + x) * 4, k = (I.data[o] >> 4) * 256 + (I.data[o + 1] >> 4) * 16 + (I.data[o + 2] >> 4); seen.set(k, (seen.get(k) ?? 0) + 1); n++; }
  return Math.max(...seen.values()) / n > 0.985;
}

// ---- a growing text file read from where we last looked ----
export class Tail {
  constructor(file) { this.file = file; this.pos = 0; this.all = ''; }
  read() {
    try {
      const st = fs.statSync(this.file);
      if (st.size < this.pos) this.pos = 0;
      if (st.size > this.pos) { const fd = fs.openSync(this.file, 'r'); const b = Buffer.alloc(st.size - this.pos); fs.readSync(fd, b, 0, b.length, this.pos); fs.closeSync(fd); this.pos = st.size; this.all += b.toString('utf8'); }
    } catch { /* not yet */ }
    return this.all;
  }
}

/** Android's dialogs met in a run, by process (pure): "system ×3、com.android.systemui ×1" */
export function dialogSummary(dialogs) {
  const by = new Map();
  for (const d of dialogs ?? []) by.set(d.proc, (by.get(d.proc) ?? 0) + 1);
  return [...by].map(([p, n]) => `${p} ×${n}`).join('、');
}

/**
 * Runs the steps. ctx: { adb, server: {do(cmd)->{ok, lines}, joinUri, logFile}, logcatFile, runDir, decode, log, pkg, launch(),
 *   dialog?() → {kind, proc} | null (Android's own dialog with the focus), answer?(dialog) → what was pressed, dialogs?: [],
 *   focus?() → the focused window, clientLog?: ClientLog (lib/client.mjs; null = the content log cannot be read),
 *   ocr?(pngFile) → words (lib/client.mjs ocrWords), recover?() → closes what is open (a section that failed) }
 * @returns {{ok:boolean, results:Array<{line, raw, ok, note, shot?, section?}>, shots:string[], dialogs:Array<{line, kind, proc, how, at}>,
 *   sections:Array<{name, line, ok, ms, client:string[]}>, perf:Array<{line, mem, fps}>, recordings:string[]}}
 */
export async function runScenario(steps, ctx) {
  const { adb, server, runDir, decode, log = () => {} } = ctx;
  const shotsDir = path.join(runDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const srvTail = new Tail(server.logFile), logTail = new Tail(ctx.logcatFile);
  const results = [], shots = [], dialogs = ctx.dialogs ?? [], began = Date.now(), perf = [], recordings = [];
  let n = 0, size = null, last = null, lastLook = 0, recN = 0, kbd, touched = false, ocrLast = null;
  const doLog = path.join(runDir, 'do.txt');
  // the sections (`section <name>`): the client's content log is read at each boundary, so every line it wrote is tied
  // to the section (the screen) that was up when it was written. Lines before the first section go to "(はじめ)"
  const sections = [{ name: '(はじめ)', line: 0, ok: true, t0: Date.now(), client: [] }];
  const cur = () => sections.at(-1);
  const clientAll = [];
  const readClient = () => {
    if (!ctx.clientLog) return [];
    let lines = [];
    try { lines = ctx.clientLog.read(); } catch { /* the device is busy: next time */ }
    cur().client.push(...lines); clientAll.push(...lines);
    return lines;
  };
  // Android's own dialog ("… isn't responding" / "… keeps stopping") over the game: it takes the taps and the screenshots
  // and, being still, would pass for a calm screen. Answered here (Wait / Close app) and noted; `every` = not more often
  const clearDialog = (s, every = 0) => {
    if (!ctx.dialog || Date.now() - lastLook < every) return null;
    lastLook = Date.now();
    const d = ctx.dialog();
    if (!d) return null;
    const how = ctx.answer?.(d) ?? '';
    dialogs.push({ line: s.line, kind: d.kind, proc: d.proc, how, at: Date.now() - began });
    log(`⚠ ${s.line} Android のダイアログ「${d.proc}${d.kind === 'anr' ? ' が応答していません' : d.kind === 'permission' ? '' : ' が停止しました'}」: ${how}`);
    return d;
  };

  const snap = () => { const b = adb.screencap(); size = pngSize(b) ?? size; last = b; return b; };
  const save = (name, buf = snap()) => { n++; const f = path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`); fs.writeFileSync(f, buf); shots.push(f); return path.relative(runDir, f).split(path.sep).join('/'); };
  // a touch on the game, the way that works on this device (lib/android.mjs Adb.tap; a stand-in adb: input tap)
  const tapAt = (x, y) => { ocrLast = null; return adb.tap ? adb.tap(x, y) : adb.shell(['input', 'tap', String(x), String(y)]); };
  const px = (x, y) => { if (!size) snap(); return [x > 1 ? Math.round(x) : Math.round(x * size.w), y > 1 ? Math.round(y) : Math.round(y * size.h)]; };
  // the words on the screen now (OCR): the screenshot goes through a file (tesseract reads files)
  // (a picture that did not change since the last one read keeps its words: tesseract costs seconds on a busy machine. Any
  // press forgets them: a focus that moved changes little of the screen and everything about what to do next)
  const ocrNow = () => {
    const b = snap();
    if (ocrLast && ctx.ocr) { try { if (screenDiff(ocrLast.b, b, decode) < 0.004) return ocrLast.words; } catch { /* undecodable: read it */ } }
    const f = path.join(runDir, '.ocr.png');
    fs.writeFileSync(f, b);
    try { const words = (ctx.ocr ?? (() => { throw new Error('OCR が使えません（tesseract を入れてください: sudo apt-get install tesseract-ocr / brew install tesseract）'); }))(f); ocrLast = { b, words }; return words; } finally { fs.rmSync(f, { force: true }); }
  };
  // the gamepad (Ore UI, 1.26's new screens, takes it where it ignores taps on the emulator)
  // (the device's own controller when it is plugged in — lib/android.mjs startPad — else the shell's key events)
  const padKey = (k) => { ocrLast = null; return adb.pad ? adb.pad(PAD_WORD[k] ?? k) : adb.shell(['input', 'gamepad', 'keyevent', `KEYCODE_${PAD[k]}`]); };
  const padWait = Number(process.env.APP_PAD_WAIT_MS) || 3500;
  // the official app joins a NetherNet server the way it joins a world on the same network: PLAY → Worlds lists the lab's
  // BDS as a "LAN world" (its discovery on UDP 7551 goes through the device's relay; 1.26's BDS takes no other transport
  // from the app, and a server joined by address wants a Microsoft sign-in). A opens PLAY from the title (and goes on past
  // a dialog over it), DOWN brings the focus to the world, A plays it. With OCR each press follows what the screen says:
  // a screen left from before (an error, a disconnect) is backed out of with B; without OCR the three presses in a row
  const joinLan = async (s) => {
    const end = Date.now() + (Number(process.env.APP_LAN_JOIN_MS) || 180_000);
    if (!ctx.ocr) { for (const k of ['A', 'DOWN', 'A']) { padKey(k); await sleep(padWait); } return 'LAN のワールド（ゲームパッド A・DOWN・A。OCR なし）'; }
    let said = '', listed = false, other = 0, moves = 0, sawPlay = false, titleA = 0;
    while (Date.now() < end) {
      if (clearDialog(s)) { await sleep(1000); continue; }
      const ws = ocrNow(), all = ws.map((w) => w.text).join(' '), p = playScreen(ws);
      said = seenWords(ws);
      if (p) {
        other = 0; listed ||= p.lan; sawPlay = true;
        // the player's own world is listed too (lib/world.mjs: a player without one is sent into the new player's flow): the
        // hint "A Play" does not say which card has the focus, its white ring does — A only on the LAN world's
        // (the ring whenever the card's words are read; the hint alone only with no other world on the list)
        const own = ownWorldListed(ws), card = p.lan ? lanCardWord(ws) : null;
        let onLan = p.lan && p.focused && !own && !card;
        if (p.lan && card) { try { onLan = focusRing(decode(last), card) || (p.focused && !own && moves >= 6); } catch { onLan = p.focused && !own; } }
        if (onLan) { padKey('A'); log(`${s.line} PLAY の LAN のワールドを選びます（ゲームパッド A）`); return 'LAN のワールド（PLAY → Worlds）'; }
        // (not listed yet: the discovery takes a moment. Listed: the focus moved on — down the list, back up after a while)
        if (p.lan) { moves++; padKey(moves % 12 <= 7 ? 'DOWN' : 'UP'); }
        await sleep(padWait); continue;
      }
      const play = titlePlay(ws);
      if (backToTitle(ws) !== false || joinRefusal(ws)) { log(`${s.line} 前の画面が残っています（${said.slice(0, 80)}）: B で戻ります`); padKey('B'); }
      // a dialog over the title ("Play your way") before the menu behind it: B closes it (A on its Continue brought it back
      // again and again on the CI device)
      else if (/Play your way|How will you play/i.test(all)) { log(`${s.line} 「Play your way」: Close（B）`); padKey('B'); }
      // the new player's title (Get started / More options): More options is the classic menu. The first press only turns the
      // gamepad's focus on (on Get started — an A there starts the new player's game mode screens): DOWN twice, then A
      else if (findText(ws, /^Get started$/i) && findText(ws, /^More options$/i)) { log(`${s.line} 新しい人向けのタイトル: More options へ（DOWN・DOWN・A）`); padKey('DOWN'); await sleep(padWait); padKey('DOWN'); await sleep(padWait); padKey('A'); }
      // the classic menu: its focus moves by the screen's layout, so Play is pressed once it is the green one (UP until it is,
      // then DOWN: the first press only turns the gamepad's focus on)
      else if (play && titleWords(ws)) {
        let focused = false; try { focused = buttonFocused(decode(last), play); } catch { /* undecodable */ }
        if (focused) { log(`${s.line} タイトルの Play を押します（ゲームパッド A）`); padKey('A'); moves = 0; }
        else { moves++; padKey(moves % 12 <= 5 ? 'UP' : 'DOWN'); await sleep(Math.min(padWait, 1500)); continue; }
      }
      // the classic menu known by its "©Mojang AB" and the skin's name, its buttons' words not read (the CI device): Play has
      // the focus once it is on — A turns it on, A presses it (never B here: B is the menu's Exit)
      else if (titleWords(ws)) { log(`${s.line} タイトル（ボタンの文字は読めず）: ゲームパッド A（Play）`); padKey('A'); titleA++; if (titleA > 6) throw new Error(`タイトルの Play が押せません（A を ${titleA - 1} 回）（画面の文字: ${said}）`); }
      // (an unknown screen: A goes on at first — B once PLAY has been seen, where an A could create a world)
      else if (/\bContinue\b/i.test(all) || (other < 2 && !sawPlay)) { padKey('A'); other++; }
      else { padKey('B'); other = 0; }
      await sleep(padWait);
    }
    throw new Error(`PLAY の LAN のワールドへ進めませんでした（${listed ? 'LAN のワールドに焦点が移らない' : 'LAN のワールドが出ない: 端末の中継（UDP 7551）と BDS の LAN の公開を確かめる'}）（画面の文字: ${said}）`);
  };
  const seenWords = (ws) => ws.map((w) => w.text).join(' ').replace(/\s+/g, ' ').slice(0, 240) || '（文字なし）';
  const joinedRe = /Player Spawned: /;
  const cursor = new Map();
  const consume = (tail, re) => {
    const text = tail.read(); let at = cursor.get(tail) ?? 0;
    while (at < text.length) {
      let nl = text.indexOf('\n', at); if (nl < 0) break;   // only whole lines
      const line = text.slice(at, nl); at = nl + 1;
      if (re.test(line)) { cursor.set(tail, at); return line; }
    }
    return null;
  };
  let clientAt = 0;
  const consumeClient = (re) => { readClient(); for (; clientAt < clientAll.length; clientAt++) if (re.test(clientAll[clientAt])) return clientAll[clientAt++]; return null; };
  const needClient = () => { if (!ctx.clientLog) throw new Error('ゲームのコンテンツログを読めません（端末で root になれない、またはコンテンツログが無効）'); };
  const keyboard = () => {
    if (kbd === undefined) kbd = keyboardDevice(adb.run(['shell', 'getevent -pl 2>/dev/null'], { timeout: 20_000 }).stdout);
    if (!kbd) throw new Error('端末のキーボード（入力デバイス）が見つかりません（getevent -pl に KEY_W のあるデバイスが無い）。AVD の hw.keyboard=yes を確かめてください');
    return kbd;
  };

  const act = async (s) => {
    const a = s.args;
    switch (s.verb) {
      case 'launch': ctx.launch(); ctx.started?.(); return 'started';
      case 'stop': adb.shell(['am', 'force-stop', ctx.pkg]); ctx.stopped?.(); return 'stopped';
      case 'join': {
        ctx.started?.();
        if (server.lan) return await joinLan(s);
        const r = adb.shell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', server.joinUri, ctx.pkg]); if (r.status !== 0 || /Error/.test(r.stdout)) throw new Error(`参加用のリンクを受け付けませんでした: ${(r.stdout + r.stderr).trim().slice(0, 200)}`); return server.joinUri;
      }
      case 'wait': await sleep(num(a[0])); return '';
      case 'section': return '';
      case 'shot': { const d = clearDialog(s); if (d) await sleep(2000); const f = save(a[0]); ctx.shotTaken?.(a[0], last); return '→ ' + f + (d ? `（先に Android のダイアログ「${d.proc}」に答えてから）` : ''); }
      case 'tap': case 'swipe': case 'key': case 'text': case 'chat': case 'press': case 'hold': case 'mouse': case 'pad': if (clearDialog(s)) await sleep(1000); break;
    }
    // the game played by name (walk, look, attack…): the controller's sticks, triggers and buttons (lib/play.mjs)
    if (GAME_VERBS.has(s.verb)) {
      if (clearDialog(s)) await sleep(1000);
      const g = gameStep(s.verb, a.filter((x) => x !== '')), ensurePad = () => Boolean(adb.padReady) || Boolean(ctx.ensurePad?.());
      if (!(g.server === 'where' || g.server === 'items')) ocrLast = null;
      if (!adb.pad && g.server !== 'where' && g.server !== 'items' && g.server !== 'face' && g.server !== 'lookat') throw new Error('この端末ではコントローラーを使えません');
      // (where, face, goto…: the server's word on the player — the lab's BDS of the run)
      return g.server ? await playServer(adb, g, { server, sleep, ensurePad }) : await playGame(adb, g, { ensurePad, sleep });
    }
    switch (s.verb) {
      case 'tap': {
        if (a[0] === 'text') {
          const ws = ocrNow(), hit = findText(ws, rx(a[1]));
          if (!hit) throw new Error(`画面に /${a[1]}/ の文字が見つかりません（読めた文字: ${seenWords(ws)}）`);
          tapAt(hit.x, hit.y);
          return `「${hit.text}」(${hit.x}, ${hit.y})`;
        }
        const [x, y] = px(num(a[0]), num(a[1])); tapAt(x, y); return `(${x}, ${y})`;
      }
      case 'swipe': { const [x1, y1] = px(num(a[0]), num(a[1])), [x2, y2] = px(num(a[2]), num(a[3])); adb.shell(['input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(num(a[4]) || 300)]); return `(${x1}, ${y1}) → (${x2}, ${y2})`; }
      case 'hold': { const [x, y] = px(num(a[0]), num(a[1])), ms = num(a[2]) || 1000; adb.shell(['input', 'swipe', String(x), String(y), String(x), String(y), String(ms)], { timeout: ms + 30_000 }); return `(${x}, ${y}) ${ms}ms`; }
      case 'key': { adb.shell(['input', 'keyevent', String(androidKey(a[0]))]); return ''; }
      case 'text': adb.shell(['input', 'text', inputText(a[0])]); return '';
      case 'chat': {
        // T opens the chat (the device's keyboard), the text goes in, ENTER sends it (a leading / makes it the player's command)
        adb.shell(['input', 'keyevent', String(ANDROID_KEYS.T)]); await sleep(1500);
        adb.shell(['input', 'text', inputText(a[0])]); await sleep(500);
        adb.shell(['input', 'keyevent', String(ANDROID_KEYS.ENTER)]); await sleep(800);
        return a[0];
      }
      case 'press': {
        const ms = num(a[1]) || 100, dev = keyboard();
        const r = adb.run(['shell', holdScript(dev, a[0].split('+').map(linuxKey), ms)], { timeout: ms + 30_000 });
        if (r.status !== 0) throw new Error(`キーを押せませんでした（sendevent ${dev}）: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
        return `${a[0]} ${ms}ms`;
      }
      case 'record': {
        if (a[0] === 'start') {
          recN++;
          adb.run(['shell', `rm -f ${recPath(recN)}; nohup screenrecord --bit-rate 4000000 --time-limit 180 ${recPath(recN)} >/dev/null 2>&1 &`], { timeout: 20_000 });
          return `録画 ${recN}`;
        }
        adb.run(['shell', 'pkill -2 screenrecord'], { timeout: 20_000 }); await sleep(2000);
        if (!recN) throw new Error('record stop の前に record start がありません');
        const dst = path.join(runDir, 'recordings', `rec-${recN}.mp4`);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const r = adb.run(['pull', recPath(recN), dst], { timeout: 120_000 });
        adb.run(['shell', `rm -f ${recPath(recN)}`], { timeout: 20_000 });
        if (r.status !== 0) throw new Error(`録画を取り出せません: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
        recordings.push(dst);
        return '→ ' + path.relative(runDir, dst);
      }
      case 'perf': {
        const ms = num(a[0]) || 3000;
        const mem = meminfoMb(adb.shell(['dumpsys', 'meminfo', ctx.pkg], { timeout: 30_000 }).stdout);
        const layer = gameLayer(adb.shell(['dumpsys', 'SurfaceFlinger', '--list'], { timeout: 30_000 }).stdout, ctx.pkg);
        let fps = null;
        if (layer) {
          adb.shell(['dumpsys', 'SurfaceFlinger', '--latency-clear', layer], { timeout: 30_000 });
          await sleep(ms);
          fps = framesIn(adb.shell(['dumpsys', 'SurfaceFlinger', '--latency', layer], { timeout: 30_000 }).stdout, ms) / (ms / 1000);
        } else await sleep(ms);
        perf.push({ line: s.line, section: cur().name, mem, fps });
        const note = `メモリ ${mem ?? '?'} MB、${fps === null ? '毎秒のフレーム数は不明' : `${fps.toFixed(1)} fps`}`;
        fs.appendFileSync(doLog, `perf [${cur().name}] ${note}\n`);
        return note;
      }
      case 'network': {
        // the emulator's console: latency both ways (min:max ms) or the link's speed
        const v = a[0] === 'delay' && a[1] !== 'none' ? `${a[1]}:${a[1]}` : a[1];
        const r = adb.run(['emu', 'network', a[0], v], { timeout: 20_000 });
        if (r.status !== 0 || /KO/.test(r.stdout)) throw new Error(`回線を変えられませんでした（emu network ${a[0]} ${v}）: ${(r.stdout + r.stderr).trim().slice(0, 200)}`);
        return `${a[0]} ${a[1]}`;
      }
      case 'size': case 'density': {
        // `wm size` takes the device's own (upright) shape; the game runs sideways, so the longer side is the height there
        const v = a[0] === 'reset' ? 'reset' : s.verb === 'density' ? a[0] : (() => { const [w, h] = a[0].split('x').map(Number); return `${Math.min(w, h)}x${Math.max(w, h)}`; })();
        const r = adb.shell(['wm', s.verb, v], { timeout: 20_000 });
        if (r.status !== 0 || /Error|Exception/.test(r.stdout + r.stderr)) throw new Error(`画面を変えられませんでした（wm ${s.verb} ${v}）: ${(r.stdout + r.stderr).trim().slice(0, 200)}`);
        size = null; await sleep(3000);   // (the game lays its screens out again; the next tap measures the new size)
        const now = pngSize(snap());
        return now ? `いま ${now.w}x${now.h}` : '';
      }
      case 'mouse': {
        const [x, y] = px(num(a[1]), num(a[2]));
        if (a[0] === 'tap') { adb.shell(['input', 'mouse', 'tap', String(x), String(y)]); return `(${x}, ${y})`; }
        if (a[0] === 'scroll') { const r = adb.shell(['input', 'mouse', 'scroll', String(x), String(y), '--axis', `VSCROLL,${-num(a[3])}`]); if (/Error|Unknown|usage/i.test(r.stdout + r.stderr)) throw new Error(`ホイールを回せませんでした: ${(r.stdout + r.stderr).trim().slice(0, 200)}`); return `(${x}, ${y}) ${a[3]}`; }
        // the pointer over a spot without a press (hover: tooltips, highlighted buttons); an older Android takes a MOVE
        const r = adb.shell(['input', 'mouse', 'motionevent', 'HOVER_MOVE', String(x), String(y)]);
        if (/Error|Unknown|usage|Invalid/i.test(r.stdout + r.stderr)) adb.shell(['input', 'mouse', 'motionevent', 'MOVE', String(x), String(y)]);
        return `(${x}, ${y})`;
      }
      case 'pad': { const k = String(a[0]).toUpperCase(); padKey(k); return PAD[k]; }
      case 'screen': adb.shell(['input', 'keyevent', a[0] === 'off' ? '223' : '224']); await sleep(1500); return a[0];
      case 'background': adb.shell(['input', 'keyevent', '3']); await sleep(1500); return 'ホーム';
      case 'foreground': ctx.launch(); ctx.started?.(); await sleep(2500); return 'ゲームへ';
      case 'trim': { const r = adb.shell(['am', 'send-trim-memory', ctx.pkg, String(a[0]).toUpperCase()], { timeout: 30_000 }); if (/Error|Exception|Unknown/i.test(r.stdout + r.stderr)) throw new Error(`知らせられませんでした: ${(r.stdout + r.stderr).trim().slice(0, 200)}`); return String(a[0]).toUpperCase(); }
      case 'cutout': {
        const ov = (x) => `com.android.internal.display.cutout.emulation.${x}`;
        const r = a[0] === 'none' ? adb.run(['shell', CUTOUTS.map((x) => `cmd overlay disable ${ov(x)} 2>/dev/null`).join('; ') + '; true'], { timeout: 30_000 })
          : adb.shell(['cmd', 'overlay', 'enable-exclusive', '--category', ov(a[0])], { timeout: 30_000 });
        if (r.status !== 0 || /Error|Exception|Unknown/.test(r.stdout + r.stderr)) throw new Error(`切り欠きを変えられませんでした（${a[0]}）: ${(r.stdout + r.stderr).trim().slice(0, 200)}`);
        await sleep(3000);
        return a[0];
      }
      case 'changed': {
        // the screen that should have opened did: the last picture against the bare world (`shot world`)
        const base = ctx.baseline?.();
        if (!base) return '（比べる `shot world` がありません）';
        const d = screenDiff(base, last ?? snap(), decode), min = num(a[0]) || 0.03;
        if (d < min) throw new Error(`画面が開いていません: ワールドの画面とほぼ同じです（違い ${(d * 100).toFixed(1)}%、要るのは ${(min * 100).toFixed(0)}% 以上）`);
        return `ワールドとの違い ${(d * 100).toFixed(1)}%`;
      }
      case 'do': {
        const r = await server.do(a[0]);
        fs.appendFileSync(doLog, `> ${a[0]}\n${r.lines.join('\n')}\n`);
        if (!r.ok) throw new Error(`サーバーがエラーを返しました: ${r.lines.filter((l) => /^E |FAIL/.test(l)).slice(0, 3).join(' | ') || r.lines.slice(-2).join(' | ')}`);
        return r.lines.filter((l) => l && !/^(OK|> )/.test(l)).slice(0, 3).join(' | ');
      }
      case 'expect': case 'absent': {
        if (a[0] === 'text') {
          // what the screen shows now (OCR), e.g. a translation key the client could not find, printed as is
          const ws = ocrNow(), hit = findText(ws, rx(a[1]));
          if (s.verb === 'expect' && !hit) throw new Error(`画面に /${a[1]}/ の文字がありません（読めた文字: ${seenWords(ws)}）`);
          if (s.verb === 'absent' && hit) throw new Error(`画面にあってはいけない文字があります: 「${hit.text}」(${hit.x}, ${hit.y})`);
          return hit ? `「${hit.text}」` : 'none';
        }
        let text;
        if (a[0] === 'clientlog') {
          needClient(); readClient(); text = clientAll.join('\n');
          // no content log file at all (the game's setting for it off): nothing can be said either way
          // (the setting on and no file: nothing logged — absent holds, expect does not)
          if (!ctx.clientLog.found && !clientAll.length && ctx.clientLog.setting?.() === true) { if (s.verb === 'expect') throw new Error(`ゲームのコンテンツログに /${a[1]}/ がありません（まだ 1 行も出ていません）`); return 'none（コンテンツログはオン、まだ 1 行も出ていない）'; }
          if (!ctx.clientLog.found && !clientAll.length) { if (s.verb === 'expect') throw new Error('ゲームのコンテンツログのファイルがありません（ゲームの設定で出力が無効？）'); return '（コンテンツログのファイルがありません: 読めていません）'; }
        }
        else text = a[0] === 'server' ? srvTail.read() : logTail.read();
        const hit = text.split('\n').find((l) => rx(a[1]).test(l));
        const where = a[0] === 'server' ? 'BDS' : a[0] === 'clientlog' ? 'ゲームのコンテンツログ' : 'アプリ';
        if (s.verb === 'expect' && !hit) throw new Error(`${where}のログに /${a[1]}/ の行がありません`);
        if (s.verb === 'absent' && hit) throw new Error(`あってはいけない行があります（${where}）: ${hit.trim().slice(0, 240)}`);
        return hit ? hit.trim().slice(0, 160) : 'none';
      }
      case 'until': {
        const kind = a[0], ms = num(LOGS.includes(kind) ? a[2] : a[1]) || DEFAULT_MS[kind] || 60_000;
        const end = Date.now() + ms; let nextEvery = s.every ? Date.now() + s.every.ms : Infinity;
        let prev = null, calmSince = Date.now(), blank = false, words = [], prompts = 0, lastOcr = 0, spawned = null, loadingSince = 0;
        const met = dialogs.length;
        if (kind === 'clientlog') needClient();
        while (Date.now() < end) {
          // a line counts once: the search starts after the line the previous `until` of that log matched
          // (not at this step: a `do` just before may already have printed what we wait for)
          if (kind === 'joined') {
            // the server's "Player Spawned" comes while the app may still load (the server's packs, the terrain): joined is the
            // world on the device's screen, read by OCR (without OCR, the server's word)
            if (!spawned) { const hit = consume(srvTail, joinedRe); if (hit) { spawned = hit.trim().slice(0, 160); if (!ctx.ocr) return spawned; lastOcr = 0; } }
            if (spawned && Date.now() - lastOcr >= Math.min(JOIN_OCR_MS, 2000)) {
              lastOcr = Date.now(); words = ocrNow();
              if (!loadingScreen(words) && !joinPromptKind(words)) return loadingSince ? `${spawned}（アプリの読み込み ${((Date.now() - loadingSince) / 1000).toFixed(0)} 秒）` : spawned;
              loadingSince ||= Date.now();
              if (joinPromptKind(words) && server.lan) { log(`${s.line} 参加の確認（${joinPromptKind(words)}）: ゲームパッド A`); padKey('A'); }
            }
            if (spawned) { await sleep(500); continue; }
            clearDialog(s, 5000);
            // the game's own questions on the way in (an unknown server, online play not rated, packs): answered by OCR;
            // the game saying it will not join (a sign-in it wants, a time-out): said now, not after the wait
            if (ctx.ocr && Date.now() - lastOcr >= JOIN_OCR_MS) {
              lastOcr = Date.now(); words = ocrNow();
              // (the LAN way: 1.26's questions take the controller, their button that goes on has its focus already)
              const k = server.lan ? joinPromptKind(words) : null, b = k ? null : joinPromptButton(words, { w: size?.w ?? 0, h: size?.h ?? 0 });
              if (k) { log(`${s.line} 参加の確認（${k}）: ゲームパッド A（${words.slice(0, 8).map((w) => w.text).join(' ')}）`); padKey('A'); }
              else if (b) { log(`${s.line} 参加の確認: 「${b.text}」を押します（${words.slice(0, 8).map((w) => w.text).join(' ')}）`); tapAt(b.x, b.y); }
              else { const no = joinRefusal(words); if (no) throw new Error(`ゲームが参加をやめました: ${no}（画面の文字: ${seenWords(words)}）`); }
            }
          }
          else if (kind === 'server' || kind === 'log') { const hit = consume(kind === 'server' ? srvTail : logTail, rx(a[1])); if (hit) return hit.trim().slice(0, 160); clearDialog(s, 5000); }
          else if (kind === 'clientlog') { const hit = consumeClient(rx(a[1])); if (hit) return hit.trim().slice(0, 160); clearDialog(s, 5000); }
          else if (kind === 'text') {
            if (!clearDialog(s)) { words = ocrNow(); const hit = findText(words, rx(a[1])); if (hit) return `「${hit.text}」(${hit.x}, ${hit.y})`; }
          }
          else if (kind === 'title') {
            // the game in front with its title screen up (the splash and the loading screen do not count). With OCR (every
            // few seconds, as app prepare does): the first-start screens ("WELCOME TO MINECRAFT!": Sign in now / Maybe later)
            // are left by their not-now button, and the title is its Play and Settings — its panorama never holds still.
            // Calm for a moment counts too (three times as long when OCR is there but read neither)
            if (clearDialog(s)) { prev = null; calmSince = Date.now(); }
            else {
              const b = snap(), ok = titleLike(b, decode, { focus: ctx.focus?.() ?? null, pkg: ctx.pkg });
              blank = blankScreen(b, decode);
              // the device came back from its snapshot with the game on its title and nothing has happened since: no need to
              // watch the panorama settle (seconds of screenshots)
              if (ok && !blank && !touched && ctx.atTitle?.()) return 'title（準備済みの端末のタイトル画面のまま）';
              if (ok && ctx.ocr && Date.now() - lastOcr >= TITLE_OCR_MS) {
                lastOcr = Date.now(); words = ocrNow();
                // a screen the last run left (a resident device: an error, a disconnect): back to the title
                const back = backToTitle(words);
                if (back !== false) {
                  log(`${s.line} 前の画面が残っています（${words.slice(0, 8).map((w) => w.text).join(' ')}）: ${back ? `「${back.text}」` : 'B'}で戻ります`);
                  if (back) tapAt(back.x, back.y); else padKey('B');
                  prev = null; calmSince = Date.now(); await sleep(padWait); continue;
                }
                const hit = firstRunButton(words, { w: size?.w ?? 0, h: size?.h ?? 0 });
                // pressed five times and still there (a game that takes no input on it: app prepare kept it so): the game is
                // up — the steps go on from it (a join link may still work)
                // (a device prepare kept on that screen says so in its stamp: no presses spent on it)
                if (hit && (prompts >= 5 || ctx.firstScreen)) return `title（ゲームの最初の画面のまま: 「${hit.text}」が効かない）`;
                if (hit) {
                  prompts++; log(`${s.line} ゲームの最初の画面: 「${hit.text}」を押します`);
                  tapAt(hit.x, hit.y); prev = null; calmSince = Date.now(); await sleep(1500); continue;
                }
                if (titleWords(words)) return 'title（Play と Settings）';
              }
              if (ok && prev && screenDiff(prev, b, decode) < 0.02) { if (Date.now() - calmSince >= (ctx.ocr ? 3 : 1) * TITLE_CALM_MS) return 'title'; }
              else calmSince = Date.now();
              prev = ok ? b : null;
            }
          }
          else if (kind === 'stable') {
            // the same picture for STABLE_MS, not a blank one (a black screen while the app loads is not "ready") and not
            // Android's own dialog (answered; the calm starts over), looked for again just before saying "stable"
            if (clearDialog(s)) { prev = null; calmSince = Date.now(); }
            else {
              const b = snap(); blank = blankScreen(b, decode);
              let again = false;
              if (prev && !blank && screenDiff(prev, b, decode) < 0.004) {
                if (Date.now() - calmSince >= STABLE_MS) { if (!clearDialog(s)) return 'stable'; again = true; }
              } else calmSince = Date.now();
              if (again) { prev = null; calmSince = Date.now(); } else prev = b;
            }
          }
          if (ctx.alive && !ctx.alive()) throw Object.assign(new Error('アプリが動いていません（落ちた？ logcat-minecraft.txt の FATAL を見てください）'), { fatal: true });
          if (Date.now() >= nextEvery) { await act(s.every.step); nextEvery = Date.now() + s.every.ms; }
          await sleep(kind === 'stable' ? 2500 : kind === 'title' || kind === 'clientlog' ? 1000 : kind === 'text' ? 1500 : 250);
        }
        // Android's dialogs kept coming while this step waited: the device was too busy, whatever the step waited for
        const seen = dialogs.slice(met);
        // what the game says on its screen at the end (OCR): a sign-in, a connection error, a pack download to confirm
        let said = '';
        if (ctx.ocr && ['joined', 'title', 'stable'].includes(kind)) { try { said = `（画面の文字: ${seenWords(ocrNow())}）`; } catch { /* no picture */ } }
        const busy = `${said}${seen.length ? `。待つあいだに Android の「応答なし」などのダイアログが ${seen.length} 回出ました（${dialogSummary(seen)}）: 端末の処理が追いついていません` : ''}`;
        if (kind === 'stable' && seen.length) throw new Error(`${ms} ミリ秒待ちました: 画面が落ち着きません${busy}`);
        if (kind === 'title') throw new Error(`${ms} ミリ秒待ちました: タイトル画面になりません（${blank ? '画面が真っ黒のまま' : '起動画面・読み込み中・別の画面のまま'}）${busy}`);
        if (kind === 'text') throw new Error(`${ms} ミリ秒待ちました: 画面に /${a[1]}/ の文字が出ません（最後に読めた文字: ${seenWords(words)}）${busy}`);
        if (kind === 'joined' && spawned) throw new Error(`${ms} ミリ秒待ちました: サーバーはプレイヤーを出しました（${spawned}）が、アプリはまだ読み込み中です（パックや地形。端末が追いついていない）${busy}`);
        if (kind === 'joined' && /Player connected: /.test(srvTail.read())) throw new Error(`${ms} ミリ秒待ちました: サーバーには接続したが、ワールドに出ていません（確認画面やリソースパックのダウンロードで止まっている？ 画面を見てください）${busy}`);
        if (kind === 'joined') throw new Error(`${ms} ミリ秒待ちました: サーバーに接続が来ていません（参加の画面・サインイン・版の違い？ 画面を見てください）${busy}`);
        if (kind === 'stable' && blank) throw new Error(`${ms} ミリ秒待ちました: 画面が真っ黒（か真っ白）のままです（まだ読み込み中か、描画できていない。README「うまくいかないとき」）`);
        throw new Error(`${ms} ミリ秒待ちました（時間切れ）${busy}`);
      }
      case 'pull': { const dst = path.join(runDir, 'pulled', (a[1] ?? path.posix.basename(a[0])).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '_')); fs.mkdirSync(path.dirname(dst), { recursive: true }); const r = adb.run(['pull', a[0], dst], { timeout: 120_000 }); if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().slice(0, 200)); return '→ ' + path.relative(runDir, dst); }
      case 'push': { const r = adb.run(['push', path.resolve(ctx.baseDir ?? '.', a[0]), a[1]], { timeout: 120_000 }); if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().slice(0, 200)); return ''; }
      case 'sh': { const r = adb.run(['shell', a[0]], { timeout: 120_000 }); fs.appendFileSync(doLog, `$ ${a[0]}\n${r.stdout}${r.stderr}\n`); return (r.stdout + r.stderr).trim().split('\n').slice(0, 2).join(' | ').slice(0, 160); }
    }
    return '';
  };

  // with sections, a failure costs only the rest of its section: what was open is closed (ctx.recover) and the next
  // section runs. Without sections, the first failure ends the run (the next steps assume it worked)
  const sectioned = steps.some((s) => s.verb === 'section');
  let ok = true;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], t0 = Date.now();
    // (a step that acts on the game: the title the device came back with is no longer taken on its word)
    if (!STILL.has(s.verb)) { touched = true; ocrLast = null; }
    if (s.verb === 'section') { readClient(); cur().ms = Date.now() - cur().t0; sections.push({ name: s.args[0], line: s.line, ok: true, t0: Date.now(), client: [] }); }
    try {
      const note = await act(s);
      results.push({ line: s.line, verb: s.verb, raw: s.raw + (s.every ? ` ; every ${s.every.ms} ${s.every.step.raw}` : ''), ok: true, note, ms: Date.now() - t0, t0, t1: Date.now(), section: cur().name });
      log(`✔ ${s.line} ${s.raw}${note ? '  ' + note : ''}`);
    } catch (e) {
      ok = false; cur().ok = false;
      let shot;
      try { shot = save(`fail-line${s.line}`); } catch { /* no screen */ }
      results.push({ line: s.line, verb: s.verb, raw: s.raw, ok: false, note: e.message, shot, ms: Date.now() - t0, t0, t1: Date.now(), section: cur().name });
      log(`✘ ${s.line} ${s.raw}\n  ${e.message}${shot ? `\n  screen: ${shot}` : ''}`);
      const next = sectioned && !e.fatal ? steps.findIndex((x, k) => k > i && x.verb === 'section') : -1;
      if (next < 0) break;   // the next steps assume this one worked
      log(`  → 区切り「${cur().name}」の残りを飛ばして、${steps[next].line} 行目の区切り「${steps[next].args[0]}」から続けます`);
      try { await ctx.recover?.(); } catch { /* the next section will tell */ }
      i = next - 1;
    }
  }
  readClient(); cur().ms = Date.now() - cur().t0;
  return { ok, results, shots, dialogs, sections: sections.filter((x, k) => k > 0 || x.client.length).map(({ t0: _t0, ...x }) => x), perf, recordings };
}
