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
  'move <forward|back|left|right>… | move stop   歩き続ける（止めるまで。release でも止まる）',
  'turn <left|right|up|down> [強さ%] | turn stop   視点を回し続ける（既定 40%）',
  'mine on|off / use on|off    壊し続ける・使い続ける（トリガーを押したまま / はなす）',
  '--- サーバーに聞いて（ラボの BDS に参加しているとき: live の bds up と join、または run の中）',
  'where                       いる所・向き（方角）・体力・持っているもの',
  'items                       持ち物の一覧（スロット:ID*数）',
  'face <north|south|east|west|角度> [上下の角度]   その向きを向く（北 180・南 0・西 90・東 -90。上下は下が正）',
  'lookat <x> <y> <z>          その場所を見る',
  'goto <x> <z> [秒]           そこまで歩く（向きを合わせて前へ、を繰り返す。段差は跳ぶ。既定 60 秒まで）',
];
export const GAME_VERBS = new Set(['walk', 'sprint', 'jump', 'look', 'sneak', 'attack', 'mine', 'use', 'place', 'slot', 'inventory', 'drop', 'cmd', 'perspective', 'pause', 'stick', 'release',
  'move', 'turn', 'where', 'items', 'face', 'lookat', 'goto']);

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
    case 'move': {
      if (a.length === 1 && a[0] === 'stop') return { pad: 'LX=0 LY=0', ms: 0, say: '止まりました' };
      const dirs = a.map(dirOf);
      if (!dirs.length || dirs.some((d) => !MOVE[d])) return { error: '書き方: move <forward|back|left|right>…（止めるまで歩き続ける） / move stop' };
      const set = new Map(dirs.map((d) => MOVE[d]));
      if (set.size !== dirs.length) return { error: 'move: forward と back、left と right は一緒にできません' };
      // (both axes set: a new move replaces the one before)
      return { pad: `LX=${set.get('LX') ?? 0} LY=${set.get('LY') ?? 0}`, ms: 0, say: `${dirs.join('+')} へ歩き続けます（止める: move stop / release）` };
    }
    case 'turn': {
      if (a.length === 1 && a[0] === 'stop') return { pad: 'RX=0 RY=0', ms: 0, say: '視点を止めました' };
      const d = dirOf(a[0]), pct = a[1] === undefined ? 40 : isNum(a[1]) ? Math.min(100, Math.round(Number(a[1]))) : null;
      if (!LOOK[d] || !pct || a.length > 2) return { error: '書き方: turn <left|right|up|down> [強さ%]（止めるまで回し続ける） / turn stop' };
      const [ax, sign] = LOOK[d];
      return { pad: ax === 'RX' ? `RX=${sign * pct} RY=0` : `RX=0 RY=${sign * pct}`, ms: 0, say: `視点を ${d} へ回し続けます（${pct}%。止める: turn stop）` };
    }
    case 'attack': case 'mine': {
      if (a.length === 1 && (a[0] === 'on' || a[0] === 'off')) return { pad: a[0] === 'on' ? 'RT=100' : 'RT=0', ms: 0, say: a[0] === 'on' ? '押したまま（RT）: 止める mine off' : 'RT をはなしました' };
      const ms = secs(a[0], verb === 'mine' ? 2 : 0.6);
      if (ms === null || a.length > 1) return { error: `書き方: ${verb} [秒]` };
      return { pad: held('RT=100', ms, 'RT=0'), ms, say: `${verb === 'mine' ? '壊す' : '殴る'}（RT ${ms / 1000} 秒）` };
    }
    case 'use': case 'place': {
      if (a.length === 1 && (a[0] === 'on' || a[0] === 'off')) return { pad: a[0] === 'on' ? 'LT=100' : 'LT=0', ms: 0, say: a[0] === 'on' ? '押したまま（LT）: 止める use off' : 'LT をはなしました' };
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
    case 'where': case 'items': return a.length ? { error: `書き方: ${verb}（引数なし）` } : { server: verb, ms: 2000 };
    case 'face': {
      const w = String(a[0] ?? '').toLowerCase(), yaw = COMPASS[w] ?? COMPASS[a[0]] ?? (/^-?\d+(\.\d+)?$/.test(w) ? Number(w) : null), pitch = a[1] === undefined ? 0 : /^-?\d+(\.\d+)?$/.test(a[1]) ? Number(a[1]) : null;
      if (yaw === null || pitch === null || Math.abs(pitch) > 90 || a.length > 2) return { error: '書き方: face <north|south|east|west|角度> [上下の角度]（例 face north、face 45 30。上下は -90〜90、下が正）' };
      return { server: 'face', yaw: normYaw(yaw), pitch, ms: 2000 };
    }
    case 'lookat': {
      const v = a.map(Number);
      if (a.length !== 3 || v.some((x) => !Number.isFinite(x))) return { error: '書き方: lookat <x> <y> <z>' };
      return { server: 'lookat', at: { x: v[0], y: v[1], z: v[2] }, ms: 2000 };
    }
    case 'goto': {
      const x = Number(a[0]), z = Number(a[1]), ms = secs(a[2], 60, 300);
      if (a.length < 2 || a.length > 3 || !Number.isFinite(x) || !Number.isFinite(z) || ms === null) return { error: '書き方: goto <x> <z> [秒]（例 goto 10 -5）' };
      return { server: 'goto', to: { x, z }, limit: ms, ms };
    }
  }
  return { error: `知らない動き: ${verb}` };
}

// ---- what the server knows: the player's place, facing, health, hand (the lab's helper in the addon: js, p(), inv()) ----
// Minecraft's yaw: south 0, west 90, north 180, east -90; pitch: down is positive
export const COMPASS = { south: 0, s: 0, 南: 0, west: 90, w: 90, 西: 90, north: 180, n: 180, 北: 180, east: -90, e: -90, 東: -90 };
const NAMES = ['南', '南西', '西', '北西', '北', '北東', '東', '南東'];
/** a yaw in (-180, 180] (pure) */
export const normYaw = (y) => { let v = ((Number(y) % 360) + 360) % 360; if (v > 180) v -= 360; return Math.round(v * 10) / 10; };
/** the compass word for a yaw (pure): 0 南, 90 西, 180 北, -90 東 and the four between */
export const compassOf = (yaw) => NAMES[((Math.round(normYaw(yaw) / 45) % 8) + 8) % 8];
/** the yaw that faces from one place to another on the ground (pure) */
export const yawTo = (from, to) => normYaw((Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI);
export const distXZ = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
// (one line for the lab's `do js`: no line break; its answer is found by its LAB_… word whatever the line around it)
export const STATE_JS = 'js (q=>{if(!q)return "LAB_STATE {}";const l=q.location,r=q.getRotation();let hp=null,max=null,slot=null,item=null;try{const h=q.getComponent("minecraft:health");hp=h.currentValue;max=h.effectiveMax}catch{}try{slot=q.selectedSlotIndex;const it=q.getComponent("minecraft:inventory").container.getItem(slot);item=it?it.typeId+"*"+it.amount:null}catch{}return "LAB_STATE "+JSON.stringify({name:q.name,x:l.x,y:l.y,z:l.z,yaw:r.y,pitch:r.x,hp,max,slot,item,dim:q.dimension.id})})(p())';
export const ITEMS_JS = 'js (q=>q?"LAB_ITEMS "+JSON.stringify(inv(q)):"LAB_ITEMS null")(p())';
/** the js that turns the player to a yaw and pitch, or to face a place (pure) */
export const faceJs = ({ yaw, pitch, at }) => `js (q=>{if(!q)return "LAB_FACE none";q.teleport(q.location,${at ? `{facingLocation:{x:${Number(at.x)},y:${Number(at.y)},z:${Number(at.z)}}}` : `{rotation:{x:${Number(pitch)},y:${Number(yaw)}}}`});return "LAB_FACE ok"})(p())`;
/** the lab's `do` lines → what the server said after its word (pure): the parsed JSON, null when it did not say it.
 *  The lab echoes each command first ("> js …") and the js itself holds the word: those lines are never the answer */
export function serverSaid(lines, word) {
  for (const l of [...(lines ?? [])].reverse()) {
    const t = String(l);
    if (/^\s*>/.test(t) || t.includes('js (q=>')) continue;
    const m = new RegExp(`(?:^|[\\s\\]])${word} (.*)$`).exec(t);
    if (m) { try { return JSON.parse(m[1]); } catch { return m[1].trim(); } }
  }
  return null;
}
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : '?');
/** the player's state in one line (pure) */
export const describeState = (st) => `${st.name}: (${r1(st.x)}, ${r1(st.y)}, ${r1(st.z)})、向き ${r1(normYaw(st.yaw))}°（${compassOf(st.yaw)}）・上下 ${r1(st.pitch)}°、体力 ${st.hp ?? '?'}/${st.max ?? '?'}、手に ${st.item ?? 'なし'}${st.slot !== null && st.slot !== undefined ? `（スロット ${st.slot + 1}）` : ''}、${String(st.dim ?? '').replace(/^minecraft:/, '')}`;

/** a server verb (where, items, face, lookat, goto) done: server.do(cmd) → { ok, lines } is the lab's BDS (`do`); the walking
 *  of goto goes through playGame like any step → what was done */
export async function playServer(adb, step, { server, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), ensurePad, now = () => Date.now() } = {}) {
  if (!server?.do) throw new Error('サーバーに聞けません（ラボの BDS がありません: live なら bds up と join、app.txt なら run の中で）');
  const ask = async (cmd, word) => {
    const r = await server.do(cmd);
    const v = serverSaid(r?.lines, word);
    if (v === null) throw new Error(`サーバーが答えません（${word}）: ${(r?.lines ?? []).filter((l) => /^E |error|unavailable/i.test(l)).slice(0, 2).join(' | ') || (r?.lines ?? []).slice(-2).join(' | ') || 'BDS が動いていない？'}`);
    return v;
  };
  const state = async () => { const st = await ask(STATE_JS, 'LAB_STATE'); if (!st || st.name === undefined) throw new Error('サーバーにプレイヤーがいません（ゲームが参加していない）'); return st; };
  if (step.server === 'where') return describeState(await state());
  if (step.server === 'items') { const v = await ask(ITEMS_JS, 'LAB_ITEMS'); if (!Array.isArray(v)) throw new Error('サーバーにプレイヤーがいません'); return v.length ? `持ち物 ${v.length} 個: ${v.join('、')}` : '持ち物はありません'; }
  if (step.server === 'face' || step.server === 'lookat') {
    if ((await ask(faceJs(step), 'LAB_FACE')) !== 'ok') throw new Error('サーバーにプレイヤーがいません');
    const st = await state();
    return `向きました: ${describeState(st)}`;
  }
  if (step.server === 'goto') {
    const end = now() + step.limit;
    let st = await state(), last = null, hops = 0;
    while (now() < end) {
      const d = distXZ(st, step.to);
      if (d <= 1.0) return `着きました（${hops} 回）: ${describeState(st)}`;
      await ask(faceJs({ yaw: yawTo(st, step.to), pitch: Math.max(-30, Math.min(30, Number(st.pitch) || 0)) }), 'LAB_FACE');
      // (about 4.3 blocks a second; no headway since the last hop: something in the way — jump while walking)
      const ms = Math.round(Math.max(300, Math.min(2500, (d / 4.3) * 1000))), blocked = last && distXZ(last, st) < 0.3;
      await playGame(adb, { pad: blocked ? `LY=-100 +A wait${ms} -A LY=0` : `LY=-100 wait${ms} LY=0`, say: '' }, { ensurePad, sleep });
      last = st; st = await state(); hops++;
    }
    throw new Error(`${Math.round(step.limit / 1000)} 秒で着けませんでした（あと ${r1(distXZ(st, step.to))} ブロック）: ${describeState(st)}`);
  }
  throw new Error(`知らないサーバーの手順: ${step.server}`);
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
