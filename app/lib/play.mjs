// play: the game played as a person plays it, by name — walk, look, jump, attack, use, the hotbar, the inventory — turned
// into the device controller's words (app/relay/lab-pad.c: sticks and triggers set and left, buttons held) and the
// keyboard's keys. One table for app.txt (lib/scenario.mjs) and for live (a comment or Discord on the CI device: app.mjs).
// The game's own bindings on a controller (Bedrock, default): left stick moves, right stick turns the camera, A jumps,
// LT uses / places, RT attacks / mines, LB / RB the hotbar, Y the inventory, L3 sprints, R3 sneaks (a toggle), START
// pauses. What a controller has no default for goes by the keyboard: 1〜9 a hotbar slot, Q drops, F5 the camera's view.
// gameStep is pure (the words and keys only); playGame presses them on a device (adb.pad with { wait: true }, key events, chat).
import { ANDROID_KEYS, inputText } from './client.mjs';

/** the controller's words that set a state and leave it (lab-pad.c): a button down / up, a stick or trigger, all back */
export const PAD_SET = /^(?:[+-](?:A|B|X|Y|LB|RB|LT|RT|SELECT|START|HOME|L3|R3|UP|DOWN|LEFT|RIGHT)|(?:LX|LY|RX|RY)=-?\d{1,3}|(?:LT|RT)=\d{1,3}|center)$/;
/** how long the controller takes for its words (pure): a press is held (hold<ms> changes that for the ones after it) and
 *  let go 200 ms, a wait<ms> waits, a state set (PAD_SET) takes no time */
export function padBatchMs(words, hold = 500) {
  let ms = 0, h = hold;
  for (const w of words) {
    if (/^wait\d+$/.test(w)) ms += Number(w.slice(4));
    else if (/^hold\d+$/.test(w)) { const v = Number(w.slice(4)); if (v > 0 && v < 10_000) h = v; }
    else if (!PAD_SET.test(w)) ms += h + 200;
  }
  return ms;
}


/** app.txt / live: the verbs and how to write them (the scenario's help lines are "//   " lines: lib/scenario.mjs) */
export const GAME_HELP = [
  'walk <forward|back|left|right>… [秒]   歩く（左スティック。2 つで斜め: walk forward left 2。既定 1 秒）',
  'sprint [秒]                 前へ走る（左スティック + L3。既定 2 秒）',
  'jump [forward|back|left|right] [秒]   跳ぶ（A）/ 向きと秒があれば、その向きへ跳びながら進む（段差を登る）',
  'look <left|right|up|down> [ミリ秒] [強さ%]   視点を回す（右スティック。既定 300 ミリ秒、100%）',
  'sneak [秒]                  しゃがむ（R3。秒があれば、その間しゃがんで戻す）',
  'attack [秒] / mine [秒]     殴る・壊す（RT を押したまま。既定 attack 0.6 秒、mine 2 秒）',
  'use [秒] / place [秒]       使う・置く・開ける（LT を押したまま。既定 0.6 秒）',
  'slot <1〜9|next|prev>       持つものを替える（数字キー / RB・LB）',
  'inventory                   持ち物を開く（Y。閉じるのは B）',
  'drop [回数]                 持っているものを落とす（Q）',
  'cmd </コマンド>             プレイヤーとしてコマンド（チャットで。/ は省いてもよい）',
  'perspective                 視点を切り替える（F5: 一人称・後ろ・前）',
  'pause                       ポーズの画面（START）',
  'stick <L|R> <x%> <y%> [ミリ秒]   スティックを好きな向きへ（-100〜100。y は負が上・前）',
  'release                     スティック・トリガー・ボタンを全部はなす（動きっぱなしを止める）',
];
export const GAME_VERBS = new Set(['walk', 'sprint', 'jump', 'look', 'sneak', 'attack', 'mine', 'use', 'place', 'slot', 'inventory', 'drop', 'cmd', 'perspective', 'pause', 'stick', 'release']);

// a direction's names (English, short, Japanese) → [stick axis, value]
const MOVE = { forward: ['LY', -100], back: ['LY', 100], left: ['LX', -100], right: ['LX', 100] };
const LOOK = { left: ['RX', -1], right: ['RX', 1], up: ['RY', -1], down: ['RY', 1] };
const ALIAS = { f: 'forward', fwd: 'forward', front: 'forward', 前: 'forward', まえ: 'forward', b: 'back', backward: 'back', backwards: 'back', 後: 'back', 後ろ: 'back', うしろ: 'back',
  l: 'left', 左: 'left', ひだり: 'left', r: 'right', 右: 'right', みぎ: 'right', u: 'up', 上: 'up', うえ: 'up', d: 'down', 下: 'down', した: 'down' };
const dirOf = (w) => { const k = String(w ?? '').toLowerCase(); return ALIAS[k] ?? ALIAS[w] ?? k; };
const isNum = (w) => w !== undefined && /^\d+(\.\d+)?$/.test(String(w));
/** seconds written (2, 0.5) → ms within [min, max]; null when not a number */
const secs = (w, def, max = 60) => (w === undefined ? def * 1000 : isNum(w) ? Math.round(Math.min(Number(w), max) * 1000) : null);
// (the game samples its controller once a frame: on the CI device 4 a second — a press shorter than ~300 ms can be missed)
const MIN_MS = 300;
const held = (on, ms, off) => `${on} wait${Math.max(MIN_MS, ms)} ${off}`;

/** a game verb and its words → { pad?, keys?, chat?, ms, say } or { error } (pure).
 *  pad: the controller's words (lab-pad.c) · keys: Android key names pressed one after another · chat: a line said in chat
 *  · ms: about how long it takes · say: what was done, for the report / the reply */
export function gameStep(verb, args = []) {
  const a = args.map(String);
  switch (verb) {
    case 'walk': {
      const dirs = a.filter((w) => !isNum(w)).map(dirOf), ms = secs(a.find(isNum), 1);
      if (!dirs.length || dirs.some((d) => !MOVE[d]) || ms === null || a.filter(isNum).length > 1) return { error: '書き方: walk <forward|back|left|right>… [秒]（例 walk forward 2、walk forward left 1.5）' };
      const set = new Map(dirs.map((d) => MOVE[d]));
      if (set.size !== dirs.length) return { error: 'walk: 同じ向きの軸を 2 回（forward と back、left と right は一緒にできません）' };
      const on = [...set].map(([ax, v]) => `${ax}=${v}`).join(' '), off = [...set.keys()].map((ax) => `${ax}=0`).join(' ');
      return { pad: held(on, ms, off), ms, say: `${dirs.join('+')} へ ${ms / 1000} 秒歩きました` };
    }
    case 'sprint': {
      const ms = secs(a[0], 2);
      if (ms === null || a.length > 1) return { error: '書き方: sprint [秒]' };
      // (L3 clicked while the stick is forward: sprinting until the stick lets go)
      return { pad: `LY=-100 wait150 +L3 wait300 -L3 wait${Math.max(MIN_MS, ms - 450)} LY=0`, ms, say: `${ms / 1000} 秒走りました` };
    }
    case 'jump': {
      if (!a.length) return { pad: 'A', ms: 700, say: '跳びました' };
      const d = dirOf(a[0]), ms = secs(a[1], 1);
      if (!MOVE[d] || ms === null || a.length > 2) return { error: '書き方: jump [forward|back|left|right] [秒]' };
      const [ax, v] = MOVE[d];
      return { pad: held(`${ax}=${v} +A`, ms, `-A ${ax}=0`), ms, say: `${d} へ跳びながら ${ms / 1000} 秒` };
    }
    case 'look': {
      const d = dirOf(a[0]), ms = a[1] === undefined ? 300 : isNum(a[1]) ? Math.min(Number(a[1]), 10_000) : null, pct = a[2] === undefined ? 100 : isNum(a[2]) ? Math.min(100, Number(a[2])) : null;
      if (!LOOK[d] || ms === null || !ms || pct === null || !pct || a.length > 3) return { error: '書き方: look <left|right|up|down> [ミリ秒] [強さ%]（例 look right 600、look up 300 50）' };
      const [ax, sign] = LOOK[d];
      return { pad: `${ax}=${sign * Math.round(pct)} wait${Math.round(ms)} ${ax}=0`, ms, say: `視点を ${d} へ（${Math.round(ms)} ミリ秒、${Math.round(pct)}%）` };
    }
    case 'sneak': {
      if (!a.length) return { pad: 'R3', ms: 700, say: 'しゃがむ / 立つ（切り替え）' };
      const ms = secs(a[0], 1);
      if (ms === null || a.length > 1) return { error: '書き方: sneak [秒]' };
      return { pad: `R3 wait${ms} R3`, ms: ms + 1400, say: `${ms / 1000} 秒しゃがみました` };
    }
    case 'attack': case 'mine': {
      const ms = secs(a[0], verb === 'mine' ? 2 : 0.6);
      if (ms === null || a.length > 1) return { error: `書き方: ${verb} [秒]` };
      return { pad: held('RT=100', ms, 'RT=0'), ms, say: `${verb === 'mine' ? '壊す' : '殴る'}（RT ${ms / 1000} 秒）` };
    }
    case 'use': case 'place': {
      const ms = secs(a[0], 0.6);
      if (ms === null || a.length > 1) return { error: `書き方: ${verb} [秒]` };
      return { pad: held('LT=100', ms, 'LT=0'), ms, say: `${verb === 'place' ? '置く' : '使う'}（LT ${ms / 1000} 秒）` };
    }
    case 'slot': {
      const w = String(a[0] ?? '').toLowerCase();
      if (/^[1-9]$/.test(w) && a.length === 1) return { keys: [w], ms: 300, say: `スロット ${w}` };
      if ((w === 'next' || w === 'prev') && a.length === 1) return { pad: w === 'next' ? 'RB' : 'LB', ms: 700, say: w === 'next' ? '次のスロット' : '前のスロット' };
      return { error: '書き方: slot <1〜9|next|prev>' };
    }
    case 'inventory': return a.length ? { error: '書き方: inventory（引数なし）' } : { pad: 'Y', ms: 1200, say: '持ち物を開きました（閉じる: pad B）' };
    case 'drop': {
      const n = a[0] === undefined ? 1 : /^\d+$/.test(a[0]) ? Math.min(64, Number(a[0])) : null;
      if (!n || a.length > 1) return { error: '書き方: drop [回数]' };
      return { keys: Array(n).fill('Q'), ms: n * 200, say: `${n} 回落としました` };
    }
    case 'cmd': {
      const t = a.join(' ').trim();
      if (!t) return { error: '書き方: cmd </コマンド>（例 cmd /give @s diamond 3）' };
      return { chat: t.startsWith('/') ? t : `/${t}`, ms: 3000, say: `コマンド ${t.startsWith('/') ? t : `/${t}`}` };
    }
    case 'perspective': return a.length ? { error: '書き方: perspective（引数なし）' } : { keys: ['F5'], ms: 500, say: '視点を切り替えました' };
    case 'pause': return a.length ? { error: '書き方: pause（引数なし）' } : { pad: 'START', ms: 900, say: 'ポーズ（戻る: pad B）' };
    case 'stick': {
      const side = String(a[0] ?? '').toUpperCase(), x = Number(a[1]), y = Number(a[2]), ms = a[3] === undefined ? 500 : isNum(a[3]) ? Math.min(Number(a[3]), 30_000) : null;
      const okv = (v) => Number.isInteger(v) && v >= -100 && v <= 100;
      if (!['L', 'R'].includes(side) || !okv(x) || !okv(y) || ms === null || !/^-?\d+$/.test(a[1] ?? '') || !/^-?\d+$/.test(a[2] ?? '')) return { error: '書き方: stick <L|R> <x%> <y%> [ミリ秒]（-100〜100 の整数。例 stick L 0 -100 1000 = 前へ 1 秒）' };
      return { pad: `${side}X=${x} ${side}Y=${y} wait${Math.round(ms)} ${side}X=0 ${side}Y=0`, ms, say: `${side} スティック (${x}, ${y}) ${Math.round(ms)} ミリ秒` };
    }
    case 'release': return a.length ? { error: '書き方: release（引数なし）' } : { pad: 'center', ms: 0, say: 'スティック・トリガー・ボタンを全部はなしました' };
  }
  return { error: `知らない動き: ${verb}` };
}

/** a line → its game step (pure): "walk forward 2" → gameStep('walk', ['forward', '2']); null when the verb is not a game verb */
export function gameLine(line) {
  const [verb, ...rest] = String(line ?? '').trim().split(/\s+/);
  if (!GAME_VERBS.has(verb)) return null;
  // (cmd keeps its spaces: the command is one string)
  return verb === 'cmd' ? gameStep('cmd', [String(line).trim().slice(3).trim()]) : gameStep(verb, rest);
}

/** a game step done on the device (adb: lib/android.mjs Adb or a stand-in) → what was done. ensurePad(): the controller
 *  plugged in (true) — a stick, a trigger or a held button has no other way in; sleep(ms): the pause between keys */
export async function playGame(adb, step, { ensurePad = () => Boolean(adb.padReady), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (step.error) throw new Error(step.error);
  if (step.pad) {
    if (step.pad.split(/\s+/).some((w) => PAD_SET.test(w)) && !ensurePad()) throw new Error('この動きには端末のコントローラー（lab-pad: root で uinput）が要ります。root の無い端末では walk / look などは使えません（pad A などのボタンと key は使えます）');
    adb.pad(step.pad, { wait: true });
  }
  for (const k of step.keys ?? []) { adb.shell(['input', 'keyevent', String(ANDROID_KEYS[k])]); await sleep(150); }
  if (step.chat !== undefined) {
    // T opens the chat (the device's keyboard), the text goes in, ENTER sends it (lib/scenario.mjs chat, the same way)
    adb.shell(['input', 'keyevent', String(ANDROID_KEYS.T)]); await sleep(1500);
    adb.shell(['input', 'text', inputText(step.chat)]); await sleep(500);
    adb.shell(['input', 'keyevent', String(ANDROID_KEYS.ENTER)]); await sleep(800);
  }
  return step.say;
}
