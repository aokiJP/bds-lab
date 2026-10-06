// プレイヤーの移動を、実機の記録（test/physics/expected.json）と 1 tick ずつ突き合わせる。
//
// 一致の基準（docs/play.md「一致の基準」）:
//   位置      float32 の刻み（ulp）で 2 以内。原点を足した絶対座標で数える
//   速度      位置の刻みの 4 以内（速度は「動いた量」なので、位置 2 つ分ずれうる）
//   接地・走り 完全一致
// 2 ulp を許すのは、座標が 16 を超えたところで 1〜2 ulp ずれる tick が残っているため（原因は未解明。
// docs/progress.md の「残っている差」）。それより大きい差は、どんなに小さくても不一致として出す。
import { createVoxelWorld } from './worlds/voxel.js';
import { expandTape } from './tape.js';

export const ORIGIN = { x: 8, y: -60, z: 8 };
const ulp = (v) => { const a = Math.abs(v); return a < 1e-30 ? 1e-45 : 2 ** (Math.floor(Math.log2(a)) - 23); };

/** 1 本のシナリオを流して、実機の記録と比べる */
export function compareScenario(sc, realRows, profile, { maxPosUlp = 2, maxVelUlp = 4 } = {}) {
  const frames = expandTape(sc.tape);
  const w = createVoxelWorld({ ...sc, origin: ORIGIN, yaw: frames[0]?.yaw ?? 0, profile });
  let worst = 0;
  let first = null;
  for (let t = 0; t < realRows.length; t++) {
    const o = w.observe().player;
    const r = realRows[t];
    let bad = null;
    for (const k of ['x', 'y', 'z']) {
      const u = (Math.abs(o[k] - r[k]) / ulp(r[k] + ORIGIN[k]));
      worst = Math.max(worst, u);
      if (u > maxPosUlp && !bad) bad = `${k} が ${u.toFixed(1)} ulp 違う`;
    }
    for (const k of ['vx', 'vy', 'vz']) {
      const ax = k.slice(1);
      const u = Math.abs(o[k] - r[k]) / ulp(r[ax] + ORIGIN[ax]);
      if (u > maxVelUlp && !bad) bad = `${k} が位置の刻みで ${u.toFixed(1)} 個ぶん違う`;
    }
    if (o.onGround !== r.onGround && !bad) bad = `接地が違う（サンドボックス ${o.onGround} / 実機 ${r.onGround}）`;
    if (o.sprinting !== r.sprinting && !bad) bad = `走りが違う（サンドボックス ${o.sprinting} / 実機 ${r.sprinting}）`;
    if (bad && !first) first = { tick: t, why: bad, sandbox: o, real: r };
    if (t < frames.length) w.step(frames[t]);
  }
  // knownGap: 実機と合わないと分かっている（式が未解明）シナリオ。合わないこと自体は許すが、
  // サンドボックスがそれを issues で申告していること（黙って違う答えを出さないこと）を確かめる
  if (sc.knownGap) return { name: sc.name, ok: w.issues().length > 0, gap: sc.knownGap, matched: !first, ticks: realRows.length, worstUlp: worst, first, issues: w.issues() };
  return { name: sc.name, ok: !first && w.issues().length === 0, ticks: realRows.length, worstUlp: worst, first, issues: w.issues() };
}
