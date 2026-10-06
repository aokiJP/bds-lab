// テープ（tape@1）— 1 tick ごとの入力の列。TAS の土台。
//
// このファイルは import を持たない。実機に入れるビヘイビアパックにもそのまま同梱される
// （tools/live/physics.mjs）ので、実機とサンドボックスが「同じテープの読み方」を共有する。
//
// 書き方: 入力は「変わった tick」だけ書く。書いた欄は、次に書き換えるまで押しっぱなし。
//
//   {
//     "format": "sandbox-be/tape@1",
//     "ticks": 120,                          // 何 tick 流すか（省略時は最後の入力 + 1）
//     "inputs": [
//       { "tick": 0,  "yaw": 0 },
//       { "tick": 3,  "move": { "x": 0, "z": 1 }, "sprint": true },
//       { "tick": 15, "jump": true },
//       { "tick": 16, "jump": false }
//     ]
//   }
//
// 欄はワールドごとに決まる（Minecraft なら move / sprint / jump / yaw、ブラウザのゲームならキー名）。
// テープ自体は欄の意味を知らない。「いつ、何が、どう変わったか」だけを持つ。

export const TAPE_FORMAT = 'sandbox-be/tape@1';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** テープの形を確かめる。おかしければ理由つきで例外 */
export function validateTape(tape) {
  if (!isObj(tape)) throw new Error('テープはオブジェクトです');
  if (tape.format !== undefined && tape.format !== TAPE_FORMAT) throw new Error(`テープの形式が違います: ${tape.format}（${TAPE_FORMAT} を読みます）`);
  if (!Array.isArray(tape.inputs ?? [])) throw new Error('inputs は配列です');
  let last = -1;
  for (const [i, e] of (tape.inputs ?? []).entries()) {
    if (!isObj(e)) throw new Error(`inputs[${i}] がオブジェクトではありません`);
    if (!Number.isInteger(e.tick) || e.tick < 0) throw new Error(`inputs[${i}].tick は 0 以上の整数です`);
    if (e.tick < last) throw new Error(`inputs[${i}].tick（${e.tick}）が前より小さい。tick の順に並べてください`);
    last = e.tick;
  }
  if (tape.ticks !== undefined && (!Number.isInteger(tape.ticks) || tape.ticks < 0)) throw new Error('ticks は 0 以上の整数です');
  return tape;
}

/** 何 tick 流すか */
export function tapeLength(tape) {
  if (Number.isInteger(tape.ticks)) return tape.ticks;
  const inputs = tape.inputs ?? [];
  return inputs.length ? inputs[inputs.length - 1].tick + 1 : 0;
}

/**
 * 1 tick ごとの「押している状態」に展開する。
 * @returns {object[]} 長さ tapeLength。各要素はその tick に効いている入力（欄は押しっぱなし）
 */
export function expandTape(tape, base = {}) {
  const n = tapeLength(tape);
  const out = new Array(n);
  let held = { ...base };
  let k = 0;
  const inputs = tape.inputs ?? [];
  for (let t = 0; t < n; t++) {
    while (k < inputs.length && inputs[k].tick === t) {
      const { tick, ...rest } = inputs[k];
      held = { ...held, ...rest };
      k++;
    }
    out[t] = held;
  }
  return out;
}

/** 1 tick ごとの状態の列から、変わった tick だけのテープに畳む（expandTape の逆） */
export function compressTape(frames, extra = {}) {
  const inputs = [];
  let prev = {};
  for (let t = 0; t < frames.length; t++) {
    const cur = frames[t] ?? {};
    const change = {};
    for (const k of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
      if (!same(prev[k], cur[k])) change[k] = cur[k] === undefined ? null : cur[k];
    }
    if (Object.keys(change).length) inputs.push({ tick: t, ...change });
    prev = cur;
  }
  return { format: TAPE_FORMAT, ...extra, ticks: frames.length, inputs };
}

/** テープの先頭 n tick だけを切り出す */
export function sliceTape(tape, n) {
  return { ...tape, ticks: n, inputs: (tape.inputs ?? []).filter((e) => e.tick < n) };
}
