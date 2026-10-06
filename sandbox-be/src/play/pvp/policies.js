// 戦い方（観測 → 操作）。サンドボックスでも、本物のクライアントでも、同じ関数を 1 tick に 1 回呼ぶ。
//
//   human(opts)   人に近い相手（反応が 4 tick 遅れる・1 秒に 8 回くらいクリック・前へ走って叩く・ときどき横へ動く）
//   clicker()     毎 tick 叩く・前へ走る（単純だが強い基準）
//   critter()     相手の痛みが明ける 2 tick 前に跳んで会心を狙う（1 tick の時機の技）
//   mlp(weights)  小さな神経網（観測 42 → 隠れ 24 → 操作 7。何 tick 前かは 1 tick ごとの印）。進化戦略で自分どうし戦わせて育てる（tools/pvp/train.mjs）
// どれも「ふつうのクライアントにできる操作」だけ: 移動キー・走る・跳ぶ・叩く（届くのは目から 3 ブロック）。
import { mulberry32 } from '../agent/learner.js';

export function human({ seed = 1, reaction = 4, cps = 8 } = {}) {
  const rnd = mulberry32(seed); const buf = []; let strafe = 0; let strafeT = 0;
  return (o) => {
    buf.push(o); const d = buf.length > reaction ? buf.shift() : buf[0];
    if (--strafeT <= 0) { strafe = rnd() < 0.5 ? 0 : rnd() < 0.5 ? -1 : 1; strafeT = 10 + Math.floor(rnd() * 20); }
    return { forward: d.dist > 1.2, sprint: d.dist > 1.2, left: strafe > 0, right: strafe < 0, jump: false, attack: d.reach <= 3.2 && rnd() < cps / 20 };
  };
}

export function clicker() { return (o) => ({ forward: true, sprint: true, attack: o.reach <= 3 }); }

/** 会心の時機を狙う相手: 相手の痛みが明ける少し前に跳び、落ちている最中に叩く（1.5 倍）。サンドボックスで毎 tick 叩く相手に 7 割勝つ */
export function critter({ jumpAt = 2 } = {}) { return (o) => ({ forward: o.dist > 1.0, sprint: o.dist > 1.0, jump: o.ground === 1 && o.sinceOppHurt === jumpAt && o.dist < 3.5, attack: o.reach <= 3 }); }

// 実際の PvP で知られた技を、ふつうのクライアントの操作だけで書いたもの（調べた資料: docs/libraries.md。どれも決まりは実機で測ったもの）
/** W タップ: 当てた直後に前を 1〜2 tick 離して走りを掛け直す（次の叩きを走り叩きにする） */
export function wtapper({ tap = 2 } = {}) { return (o) => { const tapping = o.sinceOppHurt < tap; return { forward: !tapping, sprint: !tapping, attack: o.reach <= 3 }; }; }
/** 横移動しながら詰める（左右を period tick ごとに入れ替える） */
export function strafer({ period = 15 } = {}) { return (o) => { const left = Math.floor(o.tick / period) % 2 === 0; return { forward: true, sprint: true, left, right: !left, attack: o.reach <= 3 }; }; }
/**
 * ななめのジグザグ: 前＋走り＋左か右（ななめ）で詰め、左右を 3〜8 tick のばらばらな間で切り替える（読まれにくい横移動）。
 * 統合版は入力を長さ 1 に揃えるので、ななめでも速くはならない（実機で確かめた）が、切り替えの所で相手の狙いがずれる
 */
export function zigzag({ seed = 1, min = 3, max = 8 } = {}) {
  const rnd = mulberry32(seed); let side = 1; let t = 0;
  return (o) => {
    if (--t <= 0) { side = rnd() < 0.5 ? -1 : 1; t = min + Math.floor(rnd() * (max - min + 1)); }
    return { forward: true, sprint: true, left: side > 0, right: side < 0, attack: o.reach <= 3 };
  };
}
/** 引き撃ち: 当てた直後（keep tick の間）はななめ後ろへ下がりながら、届けば叩く。それ以外は前へ走って詰める */
export function kiter({ keep = 6 } = {}) {
  return (o) => (o.sinceOppHurt < keep ? { back: true, left: true, attack: o.reach <= 3 } : { forward: true, sprint: true, attack: o.reach <= 3 });
}
/** ジャンプリセット: 叩かれた tick に跳ぶ（空中の摩擦で、自分の速度がノックバックに多く残る） */
export function jumpResetter() { return (o) => ({ forward: true, sprint: true, jump: o.ground === 1 && o.sinceMyHurt <= 1, attack: o.reach <= 3 }); }

export const MLP_IN = 42, MLP_H = 24, MLP_OUT = 7;
export const MLP_SIZE = MLP_IN * MLP_H + MLP_H + MLP_H * MLP_OUT + MLP_OUT;
/** 観測 → 神経網の入り口（42 本）。x に詰める（1 tick ごとに配列を作らない。中身は前と同じ）。
 *  16 本目までが数、そのあとは「何 tick 前か」を 1 tick ごとの印にしたもの（0〜11 と 12 以上）×2 —
 *  1 tick の違いで勝ち負けが変わる技（会心の跳躍の時機）を覚えられるように */
export function fillDense(x, o) {
  x[0] = o.dist / 4; x[1] = o.dy; x[2] = o.vf * 3; x[3] = o.vl * 3; x[4] = o.vy * 2; x[5] = o.of * 3; x[6] = o.ol * 3;
  x[7] = o.ground; x[8] = o.oground; x[9] = o.sprinting;
  x[10] = Math.min(o.myEdge, 6) / 3; x[11] = Math.min(o.oppEdge, 6) / 3; x[12] = Math.min(o.sinceOppHurt, 20) / 10;
  x[13] = Math.min(o.sinceMyHurt, 20) / 10; x[14] = o.reach / 3; x[15] = 1;
  return x;
}
/** 42 本ぜんぶ（外へ見せる形。学ぶ側・突き合わせ用） */
export function fillFeatures(x, o) {
  fillDense(x, o);
  const a = Math.round(o.sinceOppHurt), b = Math.round(o.sinceMyHurt);
  for (let i = 0; i < 13; i++) x[16 + i] = i < 12 ? (a === i ? 1 : 0) : (a >= 12 ? 1 : 0);
  for (let i = 0; i < 13; i++) x[29 + i] = i < 12 ? (b === i ? 1 : 0) : (b >= 12 ? 1 : 0);
  return x;
}
export function features(o) { return Array.from(fillFeatures(new Float64Array(MLP_IN), o)); }
export const DENSE_IN = 16; // 17 本目からは「何 tick 前か」の印（13 本 ×2。どれか 1 本だけが 1 で、あとは 0）
/**
 * 観測 → 操作。入り口 42 本のうち 26 本は印（1 本だけ 1、あとは 0）なので、
 * 掛け算は前の 16 本だけにして、印の分は「その 1 本ぶんの重み」を足すだけにしてある。
 * 足す順は前とまったく同じ（0 を足しても値は変わらないので、答えは 1 bit も同じ）。掛け算は 1008 回 → 384 回
 */
export function mlp(w) {
  const h = new Float64Array(MLP_H); const x = new Float64Array(DENSE_IN); const out = new Float64Array(MLP_OUT);
  // 重みを使いやすい形に写す（試合の前に 1 回だけ）
  const wd = new Float64Array(MLP_H * DENSE_IN);   // 前の 16 本ぶん
  const wa = new Float64Array(MLP_H * 13), wb = new Float64Array(MLP_H * 13); // 印 1 本ぶん
  const b1 = new Float64Array(MLP_H), wo = new Float64Array(MLP_OUT * MLP_H), b2 = new Float64Array(MLP_OUT);
  for (let j = 0; j < MLP_H; j++) {
    for (let i = 0; i < DENSE_IN; i++) wd[j * DENSE_IN + i] = w[j * MLP_IN + i];
    for (let i = 0; i < 13; i++) { wa[j * 13 + i] = w[j * MLP_IN + 16 + i]; wb[j * 13 + i] = w[j * MLP_IN + 29 + i]; }
    b1[j] = w[MLP_IN * MLP_H + j];
  }
  for (let q = 0; q < MLP_OUT; q++) {
    for (let j = 0; j < MLP_H; j++) wo[q * MLP_H + j] = w[MLP_IN * MLP_H + MLP_H + q * MLP_H + j];
    b2[q] = w[MLP_IN * MLP_H + MLP_H + MLP_H * MLP_OUT + q];
  }
  return (o) => {
    fillDense(x, o);
    const ra = Math.round(o.sinceOppHurt), rb = Math.round(o.sinceMyHurt);
    const ia = ra >= 12 ? 12 : (ra >= 0 && ra < 12 ? ra : -1); // どの印が 1 か（0〜11・12 以上。それ以外は全部 0）
    const ib = rb >= 12 ? 12 : (rb >= 0 && rb < 12 ? rb : -1);
    for (let j = 0; j < MLP_H; j++) {
      const d = j * DENSE_IN; let s = 0;
      for (let i = 0; i < DENSE_IN; i++) s += wd[d + i] * x[i];
      if (ia >= 0) s += wa[j * 13 + ia];
      if (ib >= 0) s += wb[j * 13 + ib];
      h[j] = Math.tanh(s + b1[j]);
    }
    for (let q = 0; q < MLP_OUT; q++) { const d = q * MLP_H; let s = 0; for (let j = 0; j < MLP_H; j++) s += wo[d + j] * h[j]; out[q] = s + b2[q]; }
    return { forward: out[0] > 0, back: out[1] > 0, left: out[2] > 0, right: out[3] > 0, sprint: out[4] > 0, jump: out[5] > 0, attack: out[6] > 0 && o.reach <= 3 };
  };
}

export function makePolicy(spec, seed = 1) {
  if (spec.kind === 'human') return human({ seed, ...(spec.opts ?? {}) });
  if (spec.kind === 'clicker') return clicker();
  if (spec.kind === 'critter') return critter(spec.opts ?? {});
  if (spec.kind === 'wtap') return wtapper(spec.opts ?? {});
  if (spec.kind === 'strafer') return strafer(spec.opts ?? {});
  if (spec.kind === 'jumpreset') return jumpResetter();
  if (spec.kind === 'zigzag') return zigzag({ seed, ...(spec.opts ?? {}) });
  if (spec.kind === 'kiter') return kiter(spec.opts ?? {});
  if (spec.kind === 'mlp') return mlp(Float64Array.from(spec.w));
  throw new Error(`知らない戦い方です: ${spec.kind}`);
}

// 同じ設定の試合は、台（ブロックの格子）と体を使い回す（試合ごとに作り直すと、格子を建て直す分だけ無駄。
// 種を入れ直して reset するので、作り直したのと 1 bit も同じ）。使い回しを切るなら fresh: true
const duelCache = new Map();
/** 1 試合（サンドボックス）。戻りは 0 の人から見た点（勝ち 1・引き分け 0.5・負け 0）と結果 */
export function playMatch(createDuel, profile, specA, specB, { mode = 'sumo', seed = 1, duel = {}, fresh = false } = {}) {
  let d;
  if (fresh) d = createDuel({ profile, mode, seed, ...duel });
  else {
    const key = `${mode}|${JSON.stringify(duel)}`;
    const hit = duelCache.get(key);
    if (hit && hit.profile === profile) { d = hit.d; d.reseed(seed); } else { d = createDuel({ profile, mode, seed, ...duel }); duelCache.set(key, { d, profile }); }
  }
  d.reset();
  const pa = makePolicy(specA, seed * 2 + 1), pb = makePolicy(specB, seed * 2 + 2);
  while (!d.done) d.step(pa(d.observe(0)), pb(d.observe(1)));
  const r = d.result;
  return { score: r.winner === 0 ? 1 : r.winner === 1 ? 0 : 0.5, ...r };
}
