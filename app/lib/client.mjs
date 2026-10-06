// The game client on the device: what only the real app shows or does, for app.txt (lib/scenario.mjs) and `app ui`.
//   keys      every key of a keyboard by name: Android key codes (`input keyevent`, a press) and Linux input codes (`press`:
//             a key held for a time through the emulator's keyboard device — walking, sneaking, holding a button)
//   OCR       the words on the screen with their boxes (tesseract): tap a button by its text, wait for a text
//   clientLog the game's own content log on the device: the JSON UI / pack / script errors only the client sees, read per
//             section of a run (its size before and after) so each error is tied to the screen that caused it
//   perf      the game's memory and frame rate now
//   record    screenrecord on the device, pulled into the run folder as mp4
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ---- keys ----
const letters = (base) => Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c, i) => [c, base + i]));
/** name → Android key code (KeyEvent) */
export const ANDROID_KEYS = {
  ...letters(29), ...Object.fromEntries([...'0123456789'].map((d, i) => [d, 7 + i])), ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 131 + i])),
  BACK: 4, HOME: 3, MENU: 82, APP_SWITCH: 187, ENTER: 66, ESCAPE: 111, ESC: 111, TAB: 61, SPACE: 62, DEL: 67, BACKSPACE: 67, FORWARD_DEL: 112, DELETE: 112, INSERT: 124,
  DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, DPAD_CENTER: 23, UP: 19, DOWN: 20, LEFT: 21, RIGHT: 22,
  SHIFT: 59, SHIFT_LEFT: 59, SHIFT_RIGHT: 60, CTRL: 113, CTRL_LEFT: 113, CTRL_RIGHT: 114, ALT: 57, ALT_LEFT: 57, ALT_RIGHT: 58, META: 117,
  GRAVE: 68, MINUS: 69, EQUALS: 70, LEFT_BRACKET: 71, RIGHT_BRACKET: 72, BACKSLASH: 73, SEMICOLON: 74, APOSTROPHE: 75, SLASH: 76, COMMA: 55, PERIOD: 56,
  PAGE_UP: 92, PAGE_DOWN: 93, MOVE_HOME: 122, MOVE_END: 123, CAPS_LOCK: 115, VOLUME_UP: 24, VOLUME_DOWN: 25,
};
const LX = 'Q W E R T Y U I O P'.split(' ').map((c, i) => [c, 16 + i]).concat('A S D F G H J K L'.split(' ').map((c, i) => [c, 30 + i]), 'Z X C V B N M'.split(' ').map((c, i) => [c, 44 + i]));
/** name → Linux input event code (for holding a key on the emulator's keyboard device) */
export const LINUX_KEYS = {
  ...Object.fromEntries(LX), ESC: 1, ESCAPE: 1, ...Object.fromEntries([...'123456789'].map((d, i) => [d, 2 + i])), 0: 11, MINUS: 12, EQUALS: 13, BACKSPACE: 14, DEL: 14, TAB: 15,
  LEFT_BRACKET: 26, RIGHT_BRACKET: 27, ENTER: 28, CTRL: 29, CTRL_LEFT: 29, SEMICOLON: 39, APOSTROPHE: 40, GRAVE: 41, SHIFT: 42, SHIFT_LEFT: 42, BACKSLASH: 43,
  COMMA: 51, PERIOD: 52, SLASH: 53, SHIFT_RIGHT: 54, ALT: 56, ALT_LEFT: 56, SPACE: 57, CAPS_LOCK: 58,
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`F${i + 1}`, 59 + i])), F11: 87, F12: 88, CTRL_RIGHT: 97, ALT_RIGHT: 100,
  MOVE_HOME: 102, UP: 103, DPAD_UP: 103, PAGE_UP: 104, LEFT: 105, DPAD_LEFT: 105, RIGHT: 106, DPAD_RIGHT: 106, MOVE_END: 107, DOWN: 108, DPAD_DOWN: 108, PAGE_DOWN: 109, INSERT: 110, DELETE: 111, FORWARD_DEL: 111, BACK: 158,
};
export const androidKey = (name) => (/^\d+$/.test(String(name)) && Number(name) > 9 ? Number(name) : ANDROID_KEYS[String(name).toUpperCase()] ?? null);
export const linuxKey = (name) => LINUX_KEYS[String(name).toUpperCase()] ?? null;

/** the emulator's keyboard among `getevent -pl`'s devices (pure): the device that has KEY_W and KEY_SPACE, or null */
export function keyboardDevice(geteventPl) {
  for (const block of String(geteventPl ?? '').split(/^add device \d+: /m).slice(1)) {
    const dev = /^(\/dev\/input\/event\d+)/.exec(block)?.[1];
    if (dev && /\bKEY_W\b/.test(block) && /\bKEY_SPACE\b/.test(block)) return dev;
  }
  return null;
}
/** the shell line that holds keys down for ms on a device (pure): EV_KEY press, SYN, sleep, release, SYN */
export function holdScript(dev, codes, ms) {
  const ev = (c, v) => `sendevent ${dev} 1 ${c} ${v};sendevent ${dev} 0 0 0`;
  return `${codes.map((c) => ev(c, 1)).join(';')};sleep ${(Math.max(0, ms) / 1000).toFixed(3)};${codes.map((c) => ev(c, 0)).join(';')}`;
}
/** text for `input text` (pure): spaces as %s, and what the device's shell would read otherwise escaped */
export const inputText = (t) => String(t).replace(/%/g, '\\%').replace(/ /g, '%s');

// ---- OCR (tesseract) ----
/** tesseract's TSV → words with their boxes (pure) */
export function parseTsv(tsv) {
  const rows = String(tsv ?? '').split(/\r?\n/), head = rows.shift()?.split('\t') ?? [], at = (k) => head.indexOf(k);
  const words = [];
  for (const r of rows) {
    const c = r.split('\t');
    if (c.length < head.length || c[at('level')] !== '5') continue;
    const text = (c[at('text')] ?? '').trim();
    if (!text) continue;
    words.push({ text, left: +c[at('left')], top: +c[at('top')], width: +c[at('width')], height: +c[at('height')], conf: +c[at('conf')], line: `${c[at('block_num')]}.${c[at('par_num')]}.${c[at('line_num')]}` });
  }
  return words;
}
/** the shortest run of words on one line whose text matches re (pure) → {text, x, y, box} (centre in pixels) | null */
export function findText(words, re) {
  const lines = new Map();
  for (const w of words) { if (!lines.has(w.line)) lines.set(w.line, []); lines.get(w.line).push(w); }
  let best = null;
  for (const ws of lines.values()) {
    ws.sort((a, b) => a.left - b.left);
    for (let i = 0; i < ws.length; i++) for (let j = i; j < ws.length && j < i + 8; j++) {
      const span = ws.slice(i, j + 1), text = span.map((w) => w.text).join(' ');
      if (!re.test(text)) continue;
      if (!best || j - i < best.n || (j - i === best.n && text.length < best.text.length)) {
        const l = Math.min(...span.map((w) => w.left)), t = Math.min(...span.map((w) => w.top)), r = Math.max(...span.map((w) => w.left + w.width)), b = Math.max(...span.map((w) => w.top + w.height));
        best = { n: j - i, text, x: Math.round((l + r) / 2), y: Math.round((t + b) / 2), box: [l, t, r, b] };
      }
      break;   // (the shortest from this start)
    }
  }
  if (!best) return null;
  const { n: _n, ...hit } = best;
  return hit;
}
/** the game's first-start screens, by OCR (pure): the button that leaves one without signing in or buying → findText's hit
 *  | null. The first is "WELCOME TO MINECRAFT!" (Sign in now / Maybe later); its pixel font reads as "Haybe" at times. Maybe
 *  later not read but Sign in now is: the button under it (a button and its gap: 11 % of the screen's height, h). Neither
 *  read, but the panel's plain text is ("Sign in with your Microsoft account …"): where Maybe later is on that screen */
export function firstRunButton(words, { w = 0, h = 0 } = {}) {
  const hit = findText(words, /^([MH][ae][yv]be ?[l1I]ater|Not now|No thanks|Skip|Remind me later|Got it|Dismiss)$/i);
  if (hit || !h) return hit;
  const sign = findText(words, /^Sign in now$/i);
  if (sign) return { text: 'Sign in now の下', x: sign.x, y: Math.round(sign.y + 0.11 * h), box: null };
  if (w && findText(words, /Microsoft account/i) && findText(words, /^(WELCOME|MINECRAFT!?)$/i)) return { text: 'WELCOME の画面の Maybe later の位置', x: Math.round(0.78 * w), y: Math.round(0.84 * h), box: null };
  return null;
}
/** ways to press a game button (lib/android.mjs Adb.tap), and the keys that leave a first-start screen without touching */
export const TAP_WAYS = ['tap', 'hold', 'motion', 'panel'];
export const TAP_WAY_NAMES = { tap: 'タップ', hold: '長めの押し', motion: '押して離す（motionevent）', panel: 'タッチパネルから（sendevent）', back: '戻るキー', keys: '↓ と Enter', pad: 'コントローラー（↓ と A）' };
/** the five ways tried in turn on a first-start screen, APP_TAP's first when it names one (pure) */
// (pad: 1.26's first-start screen is a new one — taps, BACK and ↓ Enter left it alone on the CI device for 3 minutes; the
// controller's ↓ moves the focus from "Sign in now" to "Maybe later", its A held presses it)
export const pressWays = (first) => { const all = ['tap', 'pad', ...TAP_WAYS.slice(1), 'back', 'keys']; return all.includes(first) ? [first, ...all.filter((x) => x !== first)] : all; };
/** the title screen, by OCR (pure): its Play button and Settings; 1.26's classic title (Dressing Room, Profile), or its new
 *  player one (Get started, More options) */
// (the classic menu's white words on its green and grey buttons are often not read on the CI device — 3 minutes waited
// for a calm screen — where its "©Mojang AB" and the skin's name are: "@iMoJjang AB … Alex")
export const titleWords = (words) => { const all = words.map((w) => w.text).join(' '); return Boolean((findText(words, /^Play$/i) && findText(words, /^Settings$/i)) || findText(words, /^Dressing Room$/i) || (findText(words, /^Get started$/i) && findText(words, /^More options$/i)) || (/mo[j]+ang\s*ab\b/i.test(all) && /\b(alex|steve|profile|marketplace|realms|dressing)\b/i.test(all))); };
/** the game's own questions on the way into a server, by OCR (pure): the button that goes on → findText's hit | null.
 *  1.26: "Unknown External Server … Do you still wish to join?" (Continue / Cancel), "Online play is not rated" (Proceed /
 *  Back); a server's resource packs to download. OCR often misses white words on the green button: with the screen's size,
 *  the question read is enough — its button is where 1.26 puts it (measured on a 1560x720 screen; the dialog keeps to the
 *  middle and scales with the height) */
export function joinPromptButton(words, { w = 0, h = 0 } = {}) {
  const all = words.map((x) => x.text).join(' ');
  const at = (hit, name, fy) => hit ?? (w && h ? { text: `${name}（位置から）`, x: Math.round(w / 2), y: Math.round(h * fy) } : null);
  if (/External Server|servers you trust|still wish,? to join/i.test(all)) return at(findText(words, /^Continue$/i), 'Continue', 0.56);
  if (/Online play is not rated|not be suitable for all ages|user generated content/i.test(all)) return at(findText(words, /^Proceed$/i), 'Proceed', 0.69);
  if (/resource packs?/i.test(all)) return findText(words, /^(Download( Everything)?( (&|and) Join)?|Yes|Join)$/i);
  return null;
}
/** which of the game's questions on the way in is on the screen (pure): external | rated | packs | null. Its button that
 *  goes on has the controller's focus already (1.26: Proceed, "Download Everything & Join": seen green on the CI device) */
export function joinPromptKind(words) {
  const all = words.map((x) => x.text).join(' ');
  if (/External Server|servers you trust|still wish,? to join/i.test(all)) return 'external';
  if (/Online play is not rated|not be suitable for all ages|user generated content/i.test(all)) return 'rated';
  if (/Download Resource Packs|requires players to download|resource packs applied/i.test(all)) return 'packs';
  return null;
}
/** the game still loading its way into a world, by OCR (pure): the server has spawned the player while the app shows
 *  "Generating World / Loading Resources" (the server's packs) or builds the terrain — on the CI device a form sent then
 *  never showed */
export const loadingScreen = (words) => /Generating World|Loading Resources|Building terrain|Locating server|Preparing world|Downloading|Loading\.\.\.|Saving|Joining|Connecting/i.test(words.map((w) => w.text).join(' '));
/** the player's own world (lib/world.mjs "own world") on the PLAY screen, by OCR (pure): read as "oun world" too */
export const ownWorldListed = (words) => /\bo[wuv]n world\b/i.test(words.map((w) => w.text).join(' '));
/** the game saying it will not join, by OCR (pure): its words, or null ("You need to authenticate to Microsoft services":
 *  a server not on this device asks for a Microsoft sign-in) */
export function joinRefusal(words) {
  const m = /(You need to authenticate to Microsoft services|Connection timed out|Unable to connect to world|Could not connect|Outdated (client|server)|You were disconnected|Disconnected from server|An error has occurred)[^.]*\.?/i.exec(words.map((w) => w.text).join(' '));
  return m ? m[0] : null;
}
/** 1.26's PLAY screen (Ore UI: Worlds / Realms / Servers), by OCR (pure) → { lan, focused } or null when it is not that
 *  screen. lan: a world of the same network is listed (the lab's BDS: "Dedicated Server's world", "LAN world");
 *  focused: its footer offers "A Play" (the gamepad's focus is on a world card) */
export function playScreen(words) {
  const all = words.map((w) => w.text).join(' ');
  if (!(/\bRealms\b/i.test(all) && /\bServers\b/i.test(all)) && !/Create new world|No worlds here/i.test(all)) return null;
  // (the hint read as "A Flay" on the CI device)
  return { lan: /Dedicated Server'?s world|LAN world/i.test(all), focused: /\bA\s+[PF]lay\b/.test(all) };
}
/** a button has the gamepad's focus when it is drawn green (1.26's classic menus: the focused button green, the others grey;
 *  pure) → is the button under this word (OCR's box) focused. Sampled just above and below the word, inside the button */
export function buttonFocused(img, word) {
  if (!img || !word) return false;
  let green = 0, n = 0;
  for (const y of [word.top - 3, word.top + word.height + 3]) {
    if (y < 0 || y >= img.h) continue;
    for (let x = Math.max(0, word.left); x < Math.min(img.w, word.left + word.width); x += 2) {
      const o = (y * img.w + x) * 4, R = img.data[o], G = img.data[o + 1], B = img.data[o + 2];
      n++; if (G > 90 && G > R * 1.3 && G > B * 1.3) green++;
    }
  }
  return n > 0 && green / n > 0.5;
}
/** 1.26's new screens (Ore UI) draw the controller's focus as a white ring round the focused thing (a tab, a button, a
 *  world's card: seen on the CI device). Is there one round this word (pure): a near-white line unbroken across the word's
 *  width above it and one below it, within reach (a card's ring is far above its name, past its picture). Text is white
 *  too but never a line unbroken across a word; the sky in a world's picture is not near-white */
export function focusRing(img, word, { reach = Math.round((img?.h ?? 0) * 0.35), cover = 0.9 } = {}) {
  if (!img || !word) return false;
  const white = (x, y) => { const o = (y * img.w + x) * 4, R = img.data[o], G = img.data[o + 1], B = img.data[o + 2]; return R > 215 && G > 215 && B > 215 && Math.abs(R - B) < 30; };
  const x0 = Math.max(0, word.left), x1 = Math.min(img.w, word.left + word.width);
  if (x1 <= x0) return false;
  const line = (y) => { let n = 0; for (let x = x0; x < x1; x++) if (white(x, y)) n++; return n / (x1 - x0) >= cover; };
  let up = false, down = false;
  for (let y = word.top - 2; y >= Math.max(0, word.top - reach) && !up; y--) up = line(y);
  for (let y = word.top + word.height + 2; y < Math.min(img.h, word.top + word.height + reach) && !down; y++) down = line(y);
  return up && down;
}
/** the LAN world's card on the PLAY screen, by OCR (pure): the word of its own line that names it ("Dedicated Server's
 *  world" / "LAN world"), or null */
export const lanCardWord = (words) => words.find((w) => /^(Dedicated|LAN)$/i.test(w.text)) ?? null;
/** the classic title's buttons, by OCR (pure): the word "Play" alone on its line (the menu's first button), or null */
export const titlePlay = (words) => words.find((w) => /^Play$/i.test(w.text)) ?? null;
/** a disconnect / error screen of the game, by OCR (pure) → the button that goes back to the title (findText's hit, or
 *  null: then BACK), or false when the screen is not one. A resident device's next run starts where the last left it */
export function backToTitle(words) {
  const all = words.map((w) => w.text).join(' ');
  if (!/You were disconnected|Disconnected from server|Unable to connect|An error has occurred|Connection timed out|Connection (closed|lost)|Server closed|kicked|Back to (menu|title)/i.test(all)) return false;
  return findText(words, /^(Back to (menu|title( screen)?)|OK|Okay)$/i) ?? null;
}
export const ocrAvailable = (bin = process.env.APP_TESSERACT || 'tesseract') => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
// (the words of a picture once read are not read again: a screen that did not change costs nothing)
const OCR_SEEN = new Map();
/** the words on a PNG file (tesseract, sparse text: buttons and labels anywhere on the screen). One thread (OMP_THREAD_LIMIT:
 *  on a 2-core machine shared with the emulator, tesseract's threads only fight it and finish later) */
export function ocrWords(png, { bin = process.env.APP_TESSERACT || 'tesseract', lang = process.env.APP_OCR_LANG || 'eng' } = {}) {
  let key = null;
  try { key = `${bin}|${lang}|${createHash('sha1').update(fs.readFileSync(png)).digest('hex')}`; } catch { /* unreadable: tesseract says so */ }
  if (key && OCR_SEEN.has(key)) return OCR_SEEN.get(key);
  const r = spawnSync(bin, [png, '-', '-l', lang, '--psm', '11', 'tsv'], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32e6, env: { ...process.env, OMP_THREAD_LIMIT: process.env.OMP_THREAD_LIMIT || '1' } });
  if (r.status !== 0) throw new Error(`OCR（tesseract）が失敗しました: ${(r.stderr || '').trim().split('\n').pop()}`);
  const words = parseTsv(r.stdout);
  if (key) { OCR_SEEN.set(key, words); if (OCR_SEEN.size > 64) OCR_SEEN.delete(OCR_SEEN.keys().next().value); }
  return words;
}

// ---- the game's content log on the device ----
export const LOG_DIR = (pkg) => `/data/data/${pkg}/games/com.mojang/logs`;
/** where the game writes its content log, newest place first: 1.26 keeps it in the app's external folder (its private
 *  games/com.mojang has no logs folder), older versions in the private one */
export const LOG_DIRS = (pkg) => [`/sdcard/Android/data/${pkg}/files/games/com.mojang/logs`, LOG_DIR(pkg)];
/** a content log line's level (pure): [2026-10-03 09:00:00:123 ERROR] [UI] … → 'error' | 'warn' | 'info' | null */
export function logLevel(line) { const m = /^\s*\[[^\]]*?\b(ERROR|WARN(?:ING)?|INFO|VERBOSE|INFORM)\]/i.exec(line) ?? /\b(ERROR|WARN(?:ING)?)\b/.exec(line); return m ? (/^ERR/i.test(m[1]) ? 'error' : /^WARN/i.test(m[1]) ? 'warn' : 'info') : null; }
/** the game's own lines in a logcat (-v threadtime): its tag at error or warning level (pure) — what a device without a
 *  readable content log file still says (a hint: the lab does not fail a run on them) */
export const logcatClient = (text) => String(text).split('\n').filter((l) => /^\S+\s+\S+\s+\d+\s+\d+\s+[EW]\s+(MinecraftPE|Minecraft)\s*:/.test(l)).map((l) => l.trim());
/** reads the content log file the game is writing, from where it was last read (root: the app's private folder) */
export class ClientLog {
  constructor(adb, pkg) { this.adb = adb; this.pkg = pkg; this.file = null; this.pos = 0; this.all = []; this.found = false; this.enabled = null; }
  /** the game's own setting (content_log_file in its options.txt) → true | false | null (unreadable). 1.26 makes the file
   *  at its first line: on, and no file, is a client that has logged nothing (seen on the CI device: the folder empty) */
  setting() {
    if (this.enabled === null) { const o = readOptions(this.adb.run(['shell', `cat ${OPTIONS(this.pkg)}`], { timeout: 20_000 }).stdout); this.enabled = 'content_log_file' in o ? o.content_log_file === '1' : null; }
    return this.enabled;
  }
  newest() {
    // (the newest .txt of either place, by time: the external folder first when they tie)
    const r = this.adb.run(['shell', `ls -t ${LOG_DIRS(this.pkg).map((d) => `${d}/*.txt`).join(' ')} 2>/dev/null | head -1`], { timeout: 15_000 });
    const n = r.stdout.trim().split('\n')[0]?.trim();
    return n && n.endsWith('.txt') ? n : null;
  }
  /** a person's device: what the newest content log holds already is an earlier session's, not this run's (read from here) */
  skipExisting() {
    const f = this.newest();
    if (!f) return;
    const n = Number(this.adb.run(['shell', `wc -c < '${f}' 2>/dev/null`], { timeout: 15_000 }).stdout.trim());
    if (Number.isFinite(n) && n > 0) { this.file = f; this.pos = n; }
  }
  /** the lines added since the last read ([] when there is no content log yet) */
  read() {
    const f = this.newest();
    if (!f) return [];
    this.found = true;
    if (f !== this.file) { this.file = f; this.pos = 0; }
    const r = this.adb.run(['exec-out', `tail -c +${this.pos + 1} '${f}' 2>/dev/null`], { binary: true, timeout: 30_000 });
    const b = r.buf ?? Buffer.alloc(0);
    // only whole lines: the rest is read next time
    const cut = b.lastIndexOf(0x0a);
    if (cut < 0) return [];
    this.pos += cut + 1;
    const lines = b.subarray(0, cut).toString('utf8').split(/\r?\n/).filter((l) => l.trim());
    this.all.push(...lines);
    return lines;
  }
}

// ---- the game's own settings (options.txt: "key:value" lines) ----
export const OPTIONS = (pkg) => `/data/data/${pkg}/games/com.mojang/minecraftpe/options.txt`;
/** options.txt with those keys set (pure): a key that is there gets the new value in place, a new one goes at the end */
export function patchOptions(text, patch) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l, i, a) => l !== '' || i < a.length - 1), seen = new Set();
  const out = lines.map((l) => { const k = /^([^:]+):/.exec(l)?.[1]; if (k !== undefined && k in patch) { seen.add(k); return `${k}:${patch[k]}`; } return l; });
  for (const [k, v] of Object.entries(patch)) if (!seen.has(k)) out.push(`${k}:${v}`);
  return out.join('\n') + '\n';
}
/** the game's menus held still and its first-start detours closed (pure): the switches this version has (1.26:
 *  screen_animations, panorama_scroll_speed; has_dismissed_new_player_flow — else a new-player title whose screens take no
 *  input on the emulator; do_not_show_multiplayer_online_safety_warning) that are not set so yet → { key: value } */
export const FAST_UI = { screen_animations: '0', panorama_scroll_speed: '0', has_dismissed_new_player_flow: '1', do_not_show_multiplayer_online_safety_warning: '1' };
export const fastUiSwitches = (text) => { const o = readOptions(text); return Object.fromEntries(Object.entries(FAST_UI).filter(([k, v]) => k in o && o[k].trim() !== v)); };
/** the game's graphics at their lightest that still look like the game (software rendering on a 2-core machine: every chunk,
 *  cloud and smoothed light is CPU the joining and the UI do not get). Keys this version has (1.26 names), changed; the
 *  rest left alone. The UI (what the lab looks at) is not touched */
export const LIGHT_GFX = { gfx_viewdistance: '64', gfx_smoothlighting: '0', gfx_fancyskies: '0', gfx_transparentleaves: '0', gfx_toggleclouds: '0', gfx_viewbobbing: '0', gfx_damagebobbing: '0', gfx_max_framerate: '20', dev_file_watcher: '0' };
export const lightGfxSwitches = (text) => { const o = readOptions(text); return Object.fromEntries(Object.entries(LIGHT_GFX).filter(([k, v]) => k in o && o[k].trim() !== v)); };
/** the switches that send the content log to a file, as this version of the game names them (pure): keys with
 *  "content log" in them that are off, not the on-screen log or its level */
/** the bulk of options.txt that says nothing about a device (pure): key bindings, macros, touch button places, tip counters */
export const OPTIONS_NOISE = /^(ctrl|keyboard|gamepad)_type_\d+_key\.|^command_macro_command_|^gfx_(touch|classic)\w*(X|Y|Scale|Opacity):|^show_\w+_tip_times_remain:|^(do_not_show|DO_NOT_SHOW)_/;
export const contentLogSwitches = (text) => Object.entries(readOptions(text)).filter(([k, v]) => /content_?log/i.test(k) && !/gui|level|console|screen/i.test(k) && /^(0|false)$/i.test(v.trim())).map(([k]) => k);
/** options.txt (pure) → {key: value} */
export const readOptions = (text) => Object.fromEntries(String(text ?? '').split(/\r?\n/).map((l) => /^([^:]+):(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));

// ---- performance ----
/** `dumpsys meminfo <pkg>` → the app's total PSS in MB (pure), or null */
export function meminfoMb(text) { const m = /TOTAL PSS:\s+(\d+)/.exec(String(text)) ?? /^\s*TOTAL\s+(\d+)/m.exec(String(text)); return m ? Math.round(Number(m[1]) / 1024) : null; }
/** SurfaceFlinger's layer list → the game's surface (pure), or null */
export function gameLayer(list, pkg) {
  // (Android 12+: the SurfaceView's buffers are in its "(BLAST)" layer; the plain one is its container and shows no frames)
  const ls = String(list ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes(pkg) && /SurfaceView/.test(l) && !/Background/.test(l));
  return ls.find((l) => /\(BLAST\)/.test(l)) ?? ls[0] ?? null;
}
/** `dumpsys SurfaceFlinger --latency <layer>` → frames shown in the last windowMs (pure) */
export function framesIn(latency, windowMs) {
  const rows = String(latency ?? '').trim().split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length >= 3 && r[1] > 0 && r[1] < 9e18);
  if (!rows.length) return 0;
  const last = Math.max(...rows.map((r) => r[1]));
  return rows.filter((r) => r[1] > last - windowMs * 1e6).length;
}

// ---- what only a screenshot shows ----
/** the share of the screen in the missing-texture colour (pure but for decoding): a texture the client cannot find is drawn
 *  as a magenta and black checkerboard (blocks, items, entities, UI images alike). Magenta: red and blue high, green low */
export function magentaShare(buf, decode, step = 2) {
  const I = decode(buf);
  let n = 0, m = 0;
  for (let y = 0; y < I.h; y += step) for (let x = 0; x < I.w; x += step) {
    const o = (y * I.w + x) * 4, r = I.data[o], g = I.data[o + 1], b = I.data[o + 2];
    n++; if (r > 170 && b > 170 && g < 90 && Math.abs(r - b) < 70) m++;
  }
  return n ? m / n : 0;
}

/** words that look like a translation key the client could not find, printed as is (pure, over OCR words): item.lab:ruby.name,
 *  tile.lab:lamp.name, action.lab.open, entity.lab:slime.name … (an addon's texts/*.lang is missing the line). Lines are
 *  joined so a key split by the OCR into words still shows */
export function rawKeys(words) {
  const lines = new Map();
  for (const w of words ?? []) { if (!lines.has(w.line)) lines.set(w.line, []); lines.get(w.line).push(w); }
  const found = new Set();
  for (const ws of lines.values()) {
    // (a key the OCR cut before its last part: "tile.lab:lamp .name")
    const text = ws.sort((a, b) => a.left - b.left).map((w) => w.text).join(' ').replace(/\s+\.(name|title|text|desc|description|button|label|tooltip)\b/gi, '.$1');
    for (const m of text.matchAll(/\b(?:item|tile|entity|action|container|gui|options|commands|death|chat|effect|enchantment|potion|block|biome|structure|lab|demo|[a-z]{2,}:[a-z0-9_]+)[a-z0-9_:]*(?:\.[a-z0-9_:]+)+\.(?:name|title|text|desc|description|button|label|tooltip|[0-9]+)\b|\b[a-z]{2,}(?:\.[a-z0-9_:]+){2,}\b/gi)) found.add(m[0]);
  }
  return [...found].filter((k) => !/^(www|http|com|net|org)\./i.test(k) && !/\.(png|json|txt|com|net)$/i.test(k));
}

// ---- screen recording ----
export const recPath = (n) => `/sdcard/lab-rec-${n}.mp4`;
