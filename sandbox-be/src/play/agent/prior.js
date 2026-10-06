// 選択肢の「うまくいきそうか」を、見えている形だけから当てる小さなモデル（ロジスティック回帰。依存なし）。
// たくさんのマップで先読み（planner.js）した結果（その選択肢で的の場所に着いたか）から学び、
// **見たことのないマップ**で、どの選択肢から試すかを決めるのに使う（AlphaZero の「方策の事前分布」と同じ役目。
// 探索そのものは実機と同じ物理のサンドボックスでするので、当て外れても答えが間違うことはない — 遅くなるだけ）。
import { nearestTop } from './options.js';

const RUNUPS = [0, 2, 3, 6, 'edge'];

/** 特徴: 距離・高さ・広さ・勢い・選択肢の種類 */
export function features(act, { region, target, me, moving }) {
  let gap = Infinity;
  for (const a of region.tops) for (const b of target.tops) { const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < gap) gap = d; }
  const dMe = nearestTop(target, me).d;
  const dy = target.y - region.y;
  const f = [
    1,
    gap / 4, (gap / 4) ** 2, dMe / 6, dy, dy * gap / 4,
    Math.log2(1 + target.tops.length) / 4, Math.log2(1 + region.tops.length) / 4,
    moving ? 1 : 0,
    act.kind === 'goto' ? 1 : 0,
    act.jump ? 1 : 0, act.sprint ? 1 : 0, act.hop ? 1 : 0, act.steer ? 1 : 0, act.back ? 1 : 0, act.reaim ? 1 : 0,
    Math.abs(act.off ?? 0) / 45,
    ...RUNUPS.map((r) => (act.runup === r ? 1 : 0)),
  ];
  // 相互作用（跳び方 × 距離・高さ）
  const g = gap / 4;
  f.push(act.sprint && act.jump ? g : 0, act.steer ? g : 0, act.runup === 'edge' ? g : 0, act.hop ? g : 0, moving && act.hop ? 1 : 0, act.jump ? dy : 0);
  return f;
}

export function createPrior(weights = null) {
  const n = features({ kind: 'goto' }, { region: { tops: [{ x: 0, z: 0 }], y: 0 }, target: { tops: [{ x: 1, z: 0 }], y: 0 }, me: { x: 0.5, z: 0.5 }, moving: false }).length;
  const w = weights ? Float64Array.from(weights) : new Float64Array(n);
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const dot = (x) => { let z = 0; for (let i = 0; i < n; i++) z += w[i] * x[i]; return z; };
  return {
    predict: (x) => sig(dot(x)),
    /** 1 件ずつ学ぶ（確率的勾配降下法・L2） */
    learn(x, y, lr = 0.05, l2 = 1e-4) { const e = sig(dot(x)) - y; for (let i = 0; i < n; i++) w[i] -= lr * (e * x[i] + l2 * w[i]); },
    toJSON: () => ({ format: 'sandbox-be/prior@1', features: n, weights: [...w].map((v) => Number(v.toFixed(6))) }),
  };
}
