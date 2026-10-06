// 先を読む頭 — 実機と同じ物理のサンドボックスを写して戻しながら、選択肢の列を探す（学習なしでも、見たことのないマップを 1 回で解く）。
// 学ぶ頭（learner.js）と同じ見え方・同じ選択肢（options.js）を使うので、見つけた列はそのまま本物のプレイヤーが実機で流せる。
//
//   const r = plan(course, { profile, origins, budget, prior })
//   r.plan = [{ s, a, act }]   選択肢の列（policy の plan として verify-policy.mjs で実機に流す）
//
// 探し方: 最良優先。キューに入るのは「状態 × まだ試していない選択肢」。優先度 = その状態の進み具合（動いた仕掛け・立った場所の数）
//   ＋ 選択肢のうまくいきそうな度合い（prior.js のモデル。無ければ一様）。試したら写しから戻す（最初から流し直さない）。
//   同じ状態（場所・0.5 ブロックの升目・勢い・仕掛け）には 2 回入らない。
//   実機で並べる原点が複数あれば、どの原点でも同じ結果になる選択肢だけを使う（float32 の丸めの違いで結果が変わる手を避ける）。
// 実機で測っていない操作の組み合わせになった選択肢は使わない（learner.js と同じ）。
import { createLearner, runSync } from './learner.js';
import { createSimEnv } from './sim-env.js';
import { runOption, startEpisode } from './options.js';
import { features } from './prior.js';
import { cellsOf } from './map.js';

const k3 = (x, y, z) => `${x}|${y}|${z}`;
/**
 * まだ勝てるか（楽観的に見積もる）。マップの決まり（triggers）を知っている先読みだから分かる。
 *   ・仕掛けは 1 回しか動かない。まだ動いていない仕掛けが消すブロックは「通れる」、置くブロックは「立てる」とみなす
 *   ・動ける範囲は実機より広く取る: 同じ高さか下へは中心どうし 4.6 まで、1 段上へは 3.6 まで（走り跳びは約 4）。落ちるのは何段でも
 *   ・その間の体の通り道（高い方の足場の 1〜2 段上）は、今か将来に空いているマスだけ
 * これでも勝ちの足場に届かないなら、どう動いても勝てない（扉を閉め直す氷・出口を崩す罠を踏んだあと など）。
 * 見積もりは実機より甘い側なので、勝てる状態を捨てることはない（捨てすぎたら先読みの成績で分かる: bench.mjs）
 */
export function winReachable(W, blocks, mask, fromTops) {
  const trig = W.triggers ?? [];
  const winCells = trig.filter((t) => t.win).map((t) => t.when.standOn);
  if (!winCells.length) return true;
  const cells = cellsOf(blocks);
  const openable = new Set(); const addable = new Set();
  trig.forEach((t, k) => {
    if (mask & (1 << k)) return;
    for (const b of t.set ?? []) {
      const from = b.from ?? b.at; const to = b.to ?? from; const air = String(b.type).replace(/^minecraft:/, '') === 'air';
      for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) (air ? openable : addable).add(k3(x, y, z));
    }
  });
  const pass = (x, y, z) => !cells.has(k3(x, y, z)) || openable.has(k3(x, y, z));
  const tops = [];
  for (const key of new Set([...cells.keys(), ...addable])) {
    const [x, y, z] = key.split('|').map(Number);
    if (pass(x, y + 1, z) && pass(x, y + 2, z)) tops.push({ x, y, z, key });
  }
  const goal = new Set(winCells.map(([x, y, z]) => k3(x, y, z)));
  const clear = (a, b) => {
    const top = Math.max(a.y, b.y); const dx = b.x - a.x, dz = b.z - a.z; const n = Math.ceil(Math.hypot(dx, dz) * 4);
    for (let i = 1; i < n; i++) { const px = Math.floor(a.x + 0.5 + (dx * i) / n), pz = Math.floor(a.z + 0.5 + (dz * i) / n); if (!pass(px, top + 1, pz) || !pass(px, top + 2, pz)) return false; }
    return true;
  };
  const seen = new Set(); const q = [];
  for (const t of fromTops) { const key = k3(t.x, t.y, t.z); const n = tops.find((u) => u.key === key); if (n && !seen.has(key)) { seen.add(key); q.push(n); } }
  for (let i = 0; i < q.length; i++) {
    const a = q[i]; if (goal.has(a.key)) return true;
    for (const b of tops) {
      if (seen.has(b.key) || b.y > a.y + 1) continue;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d > (b.y > a.y ? 3.6 : 4.6)) continue;
      if (!clear(a, b)) continue;
      seen.add(b.key); q.push(b);
    }
  }
  return false;
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].pri >= a[i].pri) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].pri > a[m].pri) m = l; if (r < a.length && a[r].pri > a[m].pri) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
}

export function plan(course, { profile, origins = [undefined], budget = 20000, prior = null, options = {}, onSample = null, onNode = null, maxDepth = 120, perCell = 4 } = {}) {
  const W = course.world ?? course;
  const L = createLearner({ course, seed: 1, options: { avoid: true, momentum: true, ...options } });
  const { mapFor, actionsFor, stateKey, hasWinSignal } = L.parts;
  const goalKey = L.parts.goalKey;
  const envs = origins.map((o) => createSimEnv(course, { profile, ...(o ? { origin: o } : {}) }));
  for (const e of envs) runSync(startEpisode(e.io, W), e.tick);
  const t0 = Date.now();
  const look = (e) => { const world = e.io.world(); const m = mapFor(world); return { world, m, me: e.io.me(), region: m.regionAt(e.io.me()) }; };
  const v0 = look(envs[0]);
  if (!v0.region) return { plan: null, reason: '出発点が立てる場所の上にない', sims: 0, ms: 0 };
  const seen = new Map();
  const heap = new Heap();
  let sims = 0; let ticks = 0; let nodes = 0; let pruned = 0;
  const progress = (n) => n.masks.size + n.visited.size;
  // 詰み: 勝ちの合図のブロックが全部消えた（罠で出口が崩れた など）。マップの決まり（triggers）を知っている先読みだから分かる
  const winCells = (W.triggers ?? []).filter((t) => t.win).map((t) => t.when.standOn);
  const dead = (m) => winCells.length > 0 && winCells.every(([x, y, z]) => !m.tops.some((t) => t.x === x && t.y === y && t.z === z));
  // 仕掛けの状態が変わったら（順番まで同じなら結果も同じなので覚えておく）、まだ勝てるかを楽観的に見積もる
  const alive = new Map();
  const stillWinnable = (e, v) => {
    const order = e.save().order.join(',');
    const key = `${order}|${v.region.key}`;
    if (!alive.has(key)) alive.set(key, winReachable(W, v.world.blocks, v.world.mask, v.region.tops));
    return alive.get(key);
  };
  // 同じ粗い状態（場所・0.5 の升目・勢い・仕掛け）には、細かく違う状態（位置 0.02・1 tick の動き）を perCell 個まで入れる。
  // 粗い升目だけで 1 つにすると、着地点のわずかな違いで届く／届かないが分かれる跳躍を見落とした（escape-hard-15）
  const fineKey = (n) => `${Math.round(n.me.x * 50)},${Math.round(n.me.y * 50)},${Math.round(n.me.z * 50)},${Math.round(n.me.vx * 50)},${Math.round(n.me.vz * 50)}`;
  const addNode = (n) => {
    const key = stateKey(n.region, n.me, n.moving, n.mask);
    let fines = seen.get(key);
    if (!fines) { fines = new Set(); seen.set(key, fines); }
    const fk = fineKey(n);
    if (fines.has(fk) || fines.size >= perCell) return false;
    fines.add(fk); nodes++;
    if (onNode) onNode(n);
    const repeat = fines.size - 1;
    const acts = actionsFor(n.m, n.region, n.mask);
    const base = progress(n) - 0.01 * n.path.length - 0.75 * repeat;
    acts.forEach((act, a) => {
      const target = n.m.regions.find((r) => r.key === act.target);
      let p = 0.5;
      if (prior) p = prior.predict(features(act, { region: n.region, target, me: n.me, moving: n.moving }));
      const novel = n.visited.has(act.target) ? 0 : 1;
      heap.push({ pri: base + novel * 0.5 + Math.log(Math.max(1e-4, p)) * 0.5 - (act.dense ? 3 : 0), node: n, a, act, s: key }); // 細かい勢いの跳躍は最後に
    });
    return true;
  };
  addNode({ snaps: envs.map((e) => e.save()), region: v0.region, m: v0.m, me: v0.me, moving: false, mask: v0.world.mask, visited: new Set([v0.region.key]), masks: new Set([v0.world.mask]), path: [] });
  while (heap.size && sims < budget) {
    const { node, a, act, s } = heap.pop();
    if (node.path.length >= maxDepth) continue;
    const target = node.m.regions.find((r) => r.key === act.target);
    const outs = [];
    for (let i = 0; i < envs.length; i++) {
      const e = envs[i]; e.load(node.snaps[i]);
      const u0 = e.io.unmeasured(); const tk0 = e.ticks;
      const res = runSync(runOption(e.io, { m: node.m, region: node.region, act, target, moving: node.moving, hasWinSignal, triggers: L.options.avoid ? W.triggers : null }), e.tick);
      ticks += e.ticks - tk0; sims++;
      const v = look(e);
      const won = hasWinSignal ? v.world.won : Boolean(v.region && goalKey && v.region.key === goalKey);
      outs.push({ res, v, won, bad: e.io.unmeasured() > u0, snap: e.save() });
    }
    const o = outs[0];
    if (onSample) onSample({ act, region: node.region, target, me: node.me, moving: node.moving, mask: node.mask, depth: node.path.length, success: Boolean(!o.res.fell && o.v.region && o.v.region.key === act.target), fell: o.res.fell, landed: o.v.region?.key ?? null, newMask: o.v.world.mask });
    if (outs.some((x) => x.bad || x.res.fell)) continue;
    // どの原点でも同じ結果（同じ状態）になること
    const keyOf = (x) => (x.v.region ? stateKey(x.v.region, x.v.me, x.res.moving, x.v.world.mask) : 'none');
    const k0 = keyOf(o);
    if (outs.some((x) => keyOf(x) !== k0 || x.won !== o.won)) continue;
    const path = [...node.path, { s, a, act }];
    if (o.won) return { plan: path, sims, ticks, nodes, pruned, ms: Date.now() - t0, goalKey: hasWinSignal ? o.v.region?.key ?? null : goalKey, options: L.options };
    if (!o.v.region || dead(o.v.m)) continue;
    if (o.v.world.mask !== node.mask && !stillWinnable(envs[0], o.v)) { pruned++; continue; }
    addNode({ snaps: outs.map((x) => x.snap), region: o.v.region, m: o.v.m, me: o.v.me, moving: o.res.moving, mask: o.v.world.mask,
      visited: new Set([...node.visited, o.v.region.key]), masks: new Set([...node.masks, o.v.world.mask]), path });
  }
  return { plan: null, reason: sims >= budget ? `予算（${budget} 回）を使い切った` : '試せる選択肢が無くなった（届かない？）', sims, ticks, nodes, pruned, ms: Date.now() - t0 };
}
