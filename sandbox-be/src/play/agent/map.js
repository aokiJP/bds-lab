// プレイヤーが「見て分かる」コースの形（本物のプレイヤーも、サンドボックスの中のプレイヤーも同じものを使う）。
//
//   readMap(blocks, { spawn })  ブロックの一覧（原点からの相対 { from, to, type }）から
//     regions   立てる面（上に 2 マス空きがあるブロックの上面）を「同じ高さ・同じ種類・4 方向につながる」でまとめた場所
//     goal      目標の推定（ヒントなし・学習なし）: いちばん珍しい種類の場所。同数なら出発点からいちばん遠いもの
//     lowestTop いちばん低い立てる面。これより 0.5 下へ落ちたら戻れない（落下）
//     walkPath  同じ高さの立てる面の上を歩いて行く道（マス目の幅優先探索。mineflayer の pathfinder と同じ役目）。avoid のマスは通らない
//
// 場所の名前（key）は「種類@いちばん小さいマス」。扉が開いて面が変わっても、同じ形なら同じ名前になる。

import { surfaceOf } from '../worlds/shapes.js';

const k3 = (x, y, z) => `${x}|${y}|${z}`;
/** 段差として歩いて上り下りできる高さ（実機: slab_walk_up。物理の STEP 0.5625） */
export const STEP_UP = 0.5625;

/** { from, to, type, states } の一覧 → "x|y|z" → 状態（states があるものだけ） */
export function statesOf(blocks) {
  const out = new Map();
  for (const b of blocks) {
    const from = b.from ?? b.at; const to = b.to ?? from;
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++)
      for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++)
        for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) {
          if (b.states) out.set(k3(x, y, z), b.states); else out.delete(k3(x, y, z));
        }
  }
  return out;
}

/** { from, to, type } の一覧 → "x|y|z" → 種類 */
export function cellsOf(blocks) {
  const cells = new Map();
  for (const b of blocks) {
    const from = b.from ?? b.at; const to = b.to ?? from;
    const type = String(b.type ?? b.id).replace(/^minecraft:/, '');
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++)
      for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++)
        for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) {
          if (type === 'air') cells.delete(k3(x, y, z)); else cells.set(k3(x, y, z), type);
        }
  }
  return cells;
}

export function readMap(blocks, { spawn = { x: 0.5, y: 0, z: 0.5 } } = {}) {
  const cells = cellsOf(blocks);
  const states = statesOf(blocks);
  const surf = (key, type) => surfaceOf(type, states.get(key));
  // 頭の上を塞ぐか（はしごは細いので塞がない）
  const blocksHead = (x, y, z) => { const t = cells.get(k3(x, y, z)); return t !== undefined && !surf(k3(x, y, z), t).climbable; };
  const tops = []; // 立てるマス（top = 立つ高さ。全ブロックなら y + 1、ハーフなら y + 0.5）
  const topSet = new Map(); // "x|y|z" → top
  const ladderCells = [];
  for (const [key, type] of cells) {
    const [x, y, z] = key.split('|').map(Number);
    const sf = surf(key, type);
    if (sf.climbable) { ladderCells.push({ x, y, z, facing: sf.facing }); continue; }
    if (sf.h === null) continue;
    const top = y + sf.h;
    let ok = true; for (let yy = y + 1; yy <= Math.floor(top + 1.8 - 1e-9); yy++) if (blocksHead(x, yy, z)) { ok = false; break; }
    if (!ok) continue;
    const t = { x, y, z, type, top };
    tops.push(t); topSet.set(key, t);
  }
  // はしご: 同じ x・z・向きで縦につながるものを 1 本に。張り付いている面（壁）の向き → 上る向き（yaw）
  const WALL = { 2: [0, 1, 0], 3: [0, -1, 180], 4: [1, 0, -90], 5: [-1, 0, 90] };
  const ladders = [];
  { const seen = new Set();
    for (const c of ladderCells.sort((a, b) => a.y - b.y)) {
      const key = k3(c.x, c.y, c.z); if (seen.has(key)) continue;
      let y1 = c.y; seen.add(key);
      while (ladderCells.some((d) => d.x === c.x && d.z === c.z && d.y === y1 + 1 && d.facing === c.facing)) { y1++; seen.add(k3(c.x, y1, c.z)); }
      const w = WALL[c.facing]; if (!w) continue;
      ladders.push({ x: c.x, z: c.z, y0: c.y, y1, facing: c.facing, wall: { dx: w[0], dz: w[1] }, yaw: w[2] });
    } }
  // 同じ高さ・同じ種類・4 方向につながる → 1 つの場所
  const regions = [];
  const regionOfTop = new Map();
  const sorted = tops.slice().sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  for (const t of sorted) {
    const key0 = k3(t.x, t.y, t.z);
    if (regionOfTop.has(key0)) continue;
    const group = []; const stack = [t]; regionOfTop.set(key0, -1);
    while (stack.length) {
      const q = stack.pop(); group.push(q);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = k3(q.x + dx, q.y, q.z + dz); const n = topSet.get(nk);
        if (n && n.type === t.type && n.top === t.top && !regionOfTop.has(nk)) { regionOfTop.set(nk, -1); stack.push(n); }
      }
    }
    group.sort((a, b) => a.x - b.x || a.z - b.z);
    const id = regions.length;
    for (const q of group) regionOfTop.set(k3(q.x, q.y, q.z), id);
    const cx = group.reduce((m, q) => m + q.x + 0.5, 0) / group.length, cz = group.reduce((m, q) => m + q.z + 0.5, 0) / group.length;
    regions.push({ id, key: `${t.type}@${group[0].x},${t.y},${group[0].z}`, type: t.type, y: t.y, top: t.top, tops: group, cx, cz });
  }
  // 目標の推定: いちばん珍しい種類（ブロックの数で数える）。同数なら出発点からいちばん遠いもの
  const count = new Map();
  for (const type of cells.values()) count.set(type, (count.get(type) ?? 0) + 1);
  const counts = [...count.values()];
  const min = Math.min(...counts), max = Math.max(...counts);
  let goal = null; let reason = '全部同じ種類なので、目標は決めない（新しい場所へ行くほど良い）';
  if (regions.length && min < max) {
    const rare = regions.filter((r) => count.get(r.type) === min);
    if (rare.length) {
      goal = rare.reduce((a, b) => (Math.hypot(b.cx - spawn.x, b.cz - spawn.z) > Math.hypot(a.cx - spawn.x, a.cz - spawn.z) ? b : a));
      reason = `いちばん珍しいブロック（${goal.type}、${min} 個）の場所${rare.length > 1 ? `。同じ数の場所が ${rare.length} つあるので、出発点からいちばん遠いもの` : ''}`;
    }
  }
  const lowestTop = tops.length ? Math.min(...tops.map((t) => t.top)) : 0;

  /** 足の位置（相対）から、立っている場所。空中や場所の外なら null */
  function regionAt(p) {
    if (!p.onGround) return null;
    const by = Math.floor(p.y - 0.01);
    // 立つ高さが合うマス（柵のように 1 より高い面は、1 つ下のマスのもの）
    const find = (x, z) => {
      for (const y of [by, by - 1]) { const key = k3(x, y, z); const t = topSet.get(key); if (t && Math.abs(t.top - p.y) < 0.01) return regionOfTop.get(key); }
      return undefined;
    };
    let id = find(Math.floor(p.x), Math.floor(p.z));
    if (id === undefined) {
      // 箱（幅 0.6）の端だけで乗っているとき: 足もとの 4 隅で探す
      for (const [a, b] of [[-0.3, -0.3], [-0.3, 0.3], [0.3, -0.3], [0.3, 0.3]]) {
        id = find(Math.floor(p.x + a), Math.floor(p.z + b));
        if (id !== undefined) break;
      }
    }
    return id === undefined ? null : regions[id];
  }

  /** 同じ高さの立てるマスの上を歩く道（マス目の中心の列）。無ければ null */
  // 歩ける隣: 同じ高さか、段差（STEP_UP 以下）で上り下りできる面。全ブロックだけのコースなら「同じ y」と同じ
  function walkPath(from, target, { limit = 4000, avoid = null } = {}) {
    const sx = Math.floor(from.x), sz = Math.floor(from.z);
    // 出発のマス: 足の高さが分かればそれに合うもの、無ければ的と同じ y（前と同じ）
    let start = null;
    if (from.y !== undefined) { for (const y of [Math.floor(from.y - 0.01), Math.floor(from.y - 0.01) - 1]) { const t = topSet.get(k3(sx, y, sz)); if (t && Math.abs(t.top - from.y) < 0.6) { start = t; break; } } }
    if (!start) start = topSet.get(k3(sx, target.y, sz)) ?? null;
    if (!start) return null;
    const goalSet = new Set(target.tops.map((t) => k3(t.x, t.y, t.z)));
    const sk = k3(start.x, start.y, start.z);
    const prev = new Map([[sk, null]]);
    const queue = [start];
    for (let i = 0; i < queue.length && i < limit; i++) {
      const c = queue[i]; const ck = k3(c.x, c.y, c.z);
      if (goalSet.has(ck)) {
        const out = []; let k = ck;
        while (k) { const [px, , pz] = k.split('|').map(Number); out.push({ x: px + 0.5, z: pz + 0.5 }); k = prev.get(k); }
        return out.reverse();
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const dy of [0, 1, -1]) {
          const nk = k3(c.x + dx, c.y + dy, c.z + dz); const n = topSet.get(nk);
          if (!n || prev.has(nk) || Math.abs(n.top - c.top) > STEP_UP) continue;
          if (avoid && avoid.has(nk) && !goalSet.has(nk)) continue; // 踏みたくないスイッチ（的のマスは踏んでよい）
          prev.set(nk, ck); queue.push(n);
        }
      }
    }
    return null;
  }

  // はしごの上り口と上がった先: 上り口 = はしごの足もとのマス（か、その手前）の場所。上がった先 = 壁のてっぺん（か、はしごの上の面）の場所
  for (const L of ladders) {
    const at = (x, y, z) => { const id = regionOfTop.get(k3(x, y, z)); return id === undefined ? null : regions[id]; };
    L.from = at(L.x, L.y0 - 1, L.z) ?? at(L.x - L.wall.dx, L.y0 - 1, L.z - L.wall.dz);
    L.to = at(L.x + L.wall.dx, L.y1, L.z + L.wall.dz) ?? at(L.x + L.wall.dx, L.y1 - 1, L.z + L.wall.dz);
  }
  return { cells, tops, regions, regionAt, goal, reason, lowestTop, walkPath, count, ladders };
}
