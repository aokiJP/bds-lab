// Minecraft のプレイヤーの移動を 1 tick ずつ再現するワールド（L2）。
//
// 数字はすべて実機（BDS 1.26.51.1）で SimulatedPlayer にテープを流して測った値から来ています
// （test/physics/expected.json。測り方は tools/live/physics.mjs）。定数は data/player-physics.json にあり、
// そこに無いもの（測っていないブロック・水・はしご・しゃがみ…）に触れたら inconclusive を立てて
// 「その先は実機と違うかもしれない」と申告します。推測では埋めません。
//
// 1 tick の順番（実機の記録と同じ数え方）:
//   observe() = t 回動いたあとの状態。step(input) で t → t+1 に進む。
//
// 座標は float32 で持つ（実機がそうなので、絶対座標の大きさで丸めが変わる）。

import { staticShape, fenceBoxes } from './shapes.js';

const F = Math.fround;
const copyState = (s) => {
  const o = { ...s, box: s.box ? s.box.slice() : null, prev: { ...s.prev } };
  if (s.prev?.move) o.prev.move = { ...s.prev.move };
  for (const k of Object.keys(o.prev)) if (o.prev[k] === undefined) delete o.prev[k];
  return o;
};
const KNOWN_INPUTS = new Set(['move', 'sprint', 'jump', 'yaw', 'jumpBoost']);
const EPS = 0; // 箱どうしは「面が触れているだけ」なら重ならない（実機: 壁の面に止まった箱で、その壁の上に乗らない）

/** ブロックの表を引く。測っていないブロックは null */
function blockInfo(profile, id, states) {
  const key = String(id).includes(':') ? String(id) : `minecraft:${id}`;
  const b = profile.blocks[key];
  if (!b) return null;
  const info = { ...b, id: key };
  if (states && Object.keys(states).length) info.states = states;
  // 形（相対の箱の列）。柵のようにつながりで変わるものは dynamic
  const sh = staticShape(info);
  info.boxes = sh.boxes; if (sh.why) info.shapeWhy = sh.why; if (sh.dynamic) info.dynamic = sh.dynamic; if (sh.stairs) info.stairs = sh.stairs;
  info.fullCube = (info.shape ?? 'full') === 'full';
  return info;
}

/**
 * @param {object} spec
 *   origin   絶対座標の原点（既定 { x: 8, y: -60, z: 8 }。実機の較正と同じ場所）
 *   ground   'flat'（y < 原点.y が地面）| 'void'
 *   blocks   [{ from, to, type }]  原点からの相対
 *   spawn    { x, y, z }  原点からの相対
 *   yaw      最初の向き（度）
 *   profile  data/player-physics.json の中身
 */
export function createVoxelWorld(spec) {
  const profile = spec.profile;
  if (!profile) throw new Error('voxel ワールドには物理の定数（data/player-physics.json）が要ります');
  const P = profile.player;
  const origin = spec.origin ?? { x: 8, y: -60, z: 8 };
  const solid = new Map(); // "x|y|z" → ブロックの情報
  const unknownTypes = new Set();
  const groundType = profile.ground?.type ?? 'minecraft:grass_block';
  const flat = (spec.ground ?? 'flat') === 'flat';
  const minY = origin.y - 4; // 平らな世界の岩盤（-64）の下は奈落

  // ブロックの表は 2 通りで持つ: 置いた順の記録（solid。"x|y|z" → 情報）と、それを詰めた格子（grid。速く引くため）。
  // 格子は置いたブロックを囲む箱で、外は「平らな地面か空気」。格子の外に置かれたら作り直す。
  // 速さのためだけのもので、どのブロックが返るかは solid と同じ（test/agent.test.js が元の引き方と突き合わせる）
  let dirty = false; // 最初のブロックから変わったか
  let version = 0;   // ブロックが変わるたびに 1 つ進む（箱の覚えを捨てる印）
  const infos = [undefined, null]; // 格子の値 → 情報。0 = 置いていない、1 = 空気を置いた
  const infoIndex = new Map();
  let gx0 = 0, gy0 = 0, gz0 = 0, gnx = 0, gny = 0, gnz = 0, grid = new Uint16Array(0);
  const idxOf = (info) => {
    if (info === null) return 1;
    const key = info.unknown ? `?${info.unknown}` : (info.states ? `${info.id}${JSON.stringify(info.states)}` : info.id);
    let k = infoIndex.get(key);
    if (k === undefined) { k = infos.length; infos.push(info); infoIndex.set(key, k); }
    return k;
  };
  function rebuildGrid() {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const k of solid.keys()) {
      const [x, y, z] = k.split('|').map(Number);
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
      if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    if (x0 === Infinity) { gnx = gny = gnz = 0; grid = new Uint16Array(0); return; }
    const M = 4;
    gx0 = x0 - M; gy0 = y0 - M; gz0 = z0 - M; gnx = x1 - x0 + 1 + 2 * M; gny = y1 - y0 + 1 + 2 * M; gnz = z1 - z0 + 1 + 2 * M;
    grid = new Uint16Array(gnx * gny * gnz);
    for (const [k, v] of solid) {
      const [x, y, z] = k.split('|').map(Number);
      grid[((x - gx0) * gny + (y - gy0)) * gnz + (z - gz0)] = idxOf(v);
    }
  }
  const inGrid = (x, y, z) => x >= gx0 && y >= gy0 && z >= gz0 && x < gx0 + gnx && y < gy0 + gny && z < gz0 + gnz;

  const groundInfo = blockInfo(profile, groundType);

  // 世界にどんなブロックがあるか（速さのためだけ。無ければその処理をまるごと飛ばす — 答えは同じ）。
  // 消しても下がらない（多めに立つ）ので、遅くなることはあっても違う答えにはならない。resetBlocks で数え直す
  let anySticky = false, anyBounce = false, anyHoney = false, anyClimb = false;
  function noteFlags(v) {
    if (!v) return;
    if (v.stickyWalk) anySticky = true;
    if (v.bounce) anyBounce = true;
    if (v.honey) anyHoney = true;
    if (v.climbable) anyClimb = true;
  }
  function recomputeFlags() {
    anySticky = anyBounce = anyHoney = anyClimb = false;
    if (flat) noteFlags(groundInfo);
    for (const v of solid.values()) noteFlags(v);
  }

  /** ブロックを置き換える（{ from, to, type } 原点からの相対。type が air なら消す）。プレイヤーの状態はそのまま */
  function edit(list, { rebuild = true } = {}) {
    let outside = false; dirty = true;
    for (const b of list ?? []) {
      const from = b.from ?? b.at;
      const to = b.to ?? from;
      const type = String(b.type ?? b.id).includes(':') ? String(b.type ?? b.id) : `minecraft:${b.type ?? b.id}`;
      const info = type === 'minecraft:air' ? 'air' : blockInfo(profile, type, b.states);
      if (!info) unknownTypes.add(type);
      const v = info === 'air' ? null : (info ?? { unknown: type });
      noteFlags(v);
      for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++)
        for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++)
          for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++) {
            const ax = x + origin.x, ay = y + origin.y, az = z + origin.z;
            solid.set(`${ax}|${ay}|${az}`, v);
            if (inGrid(ax, ay, az)) grid[((ax - gx0) * gny + (ay - gy0)) * gnz + (az - gz0)] = idxOf(v);
            else outside = true;
          }
    }
    version++;
    if (outside && rebuild) rebuildGrid();
  }
  edit(spec.blocks, { rebuild: false });
  rebuildGrid();
  recomputeFlags();
  // 最初のブロックの写し（resetBlocks で、置き換えたブロックを 1 つ残らず元に戻す）
  const initial = { solid: new Map(solid), grid: grid.slice(), dims: [gx0, gy0, gz0, gnx, gny, gnz] };
  dirty = false;
  function resetBlocks() {
    if (!dirty) return;
    solid.clear(); for (const [k, v] of initial.solid) solid.set(k, v);
    [gx0, gy0, gz0, gnx, gny, gnz] = initial.dims; grid = initial.grid.slice();
    recomputeFlags();
    version++;
    dirty = false;
  }

  /** 絶対座標のブロック。null は空気 */
  function at(x, y, z) {
    if (x >= gx0 && y >= gy0 && z >= gz0 && x < gx0 + gnx && y < gy0 + gny && z < gz0 + gnz) {
      const k = grid[((x - gx0) * gny + (y - gy0)) * gnz + (z - gz0)];
      if (k !== 0) return infos[k];
    }
    if (flat && y < origin.y && y >= minY) return groundInfo;
    return null;
  }

  const spawn = spec.spawn ?? { x: 0.5, y: 0, z: 0.5 };
  let s;
  const issues = new Map(); // 再現していないものに触れた → 理由

  function reset() {
    s = {
      tick: 0,
      x: F(origin.x + spawn.x), y: F(origin.y + spawn.y), z: F(origin.z + spawn.z),
      vx: 0, vy: 0, vz: 0,
      dx: 0, dy: 0, dz: 0,
      onGround: false,
      sprinting: false,
      yaw: spec.yaw ?? 0,
      box: null,
      f: 1,
      prev: {},
      fallDistance: 0,
      jumped: false,
      bouncePending: false,
    };
    issues.clear();
    for (const t of unknownTypes) issues.set(`block:${t}`, `${t} の当たり判定・滑りやすさは実機で測っていません`);
  }
  reset();

  // ---- 当たり判定。周りの箱は使い回しの配列に絶対座標で入れる（1 tick ごとに配列を作らない） ----------
  // 全ブロックは 1×1×1、それ以外は src/play/worlds/shapes.js の形。測っていない形・向きは issues に積む
  let boxBuf = new Float64Array(6 * 64); let boxN = 0;
  const pushBox = (x0, y0, z0, x1, y1, z1) => {
    if (boxN * 6 >= boxBuf.length) { const nb = new Float64Array(boxBuf.length * 2); nb.set(boxBuf); boxBuf = nb; }
    const o = boxN * 6; boxBuf[o] = x0; boxBuf[o + 1] = y0; boxBuf[o + 2] = z0; boxBuf[o + 3] = x1; boxBuf[o + 4] = y1; boxBuf[o + 5] = z1; boxN++;
  };
  const flagShape = (b, x, y, z) => {
    if (b.shapeWhy) issues.set(`shape:${b.id}`, b.shapeWhy);
    if (b.stairs) {
      // 隣に向きの違う階段があると角の形になる（測っていない）
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = at(x + dx, y, z + dz);
        if (n?.stairs && (n.stairs.d !== b.stairs.d || n.stairs.up !== b.stairs.up)) issues.set(`shape:${b.id}:corner`, `向きの違う階段が隣り合った角の形は実機で測っていません`);
      }
    }
  };
  // 1 tick に 1 回、いちばん多く回るところ。格子の引き方をその場に開いて（at を呼ばずに）、
  // 全ブロックだけの世界（PvP の台・ふつうのアスレチック）は箱を 1×1×1 で積むだけにしてある。返る箱の並びは前と同じ
  // 前に集めた範囲（同じなら集め直さない）。申告（issues）が出るブロックに触れた回は覚えない —
  // 申告は「あとから書いた方が残る」決まりなので、飛ばすと申告の文が変わってしまう
  let cXa = 1, cXb = 0, cYa = 0, cYb = 0, cZa = 0, cZb = 0, cVer = -1, cClean = false;
  function boxesAround(minX, minY2, minZ, maxX, maxY, maxZ) {
    const xa = Math.floor(minX) - 1, xb = Math.floor(maxX) + 1, ya = Math.floor(minY2) - 1, yb = Math.floor(maxY) + 1, za = Math.floor(minZ) - 1, zb = Math.floor(maxZ) + 1;
    // 同じマスの範囲を、ブロックが変わらないまま見に来たら、前の箱をそのまま使う（歩いている間はたいてい同じ）
    // 覚えてある範囲が、今ほしい範囲を丸ごと含んでいれば、そのまま使う。
    // 外にはみ出した箱があっても答えは変わらない（進む向きの箱は「進みたい分」より遠いので最短にならず、
    // 横にずれた箱は重なりの判定で落ちる。段差の箱も、ほしい範囲（掃いた跡 ±1 マス）の中に収まる）
    if (cClean && cVer === version && cXa <= xa && cXb >= xb && cYa <= ya && cYb >= yb && cZa <= za && cZb >= zb) return;
    cClean = true; cVer = version;
    // 少し広めに集めておく（1 マス動いても覚えが効くように）
    cXa = xa - 1; cXb = xb + 1; cYa = ya - 1; cYb = yb; cZa = za - 1; cZb = zb + 1;
    boxN = 0;
    const bxa = cXa, bxb = cXb, bya = cYa, byb = cYb, bza = cZa, bzb = cZb;
    const need = (bxb - bxa + 1) * (byb - bya + 1) * (bzb - bza + 1) * 6;
    if (boxBuf.length < need) boxBuf = new Float64Array(need);
    let runZ0 = 0;
    const gx1 = gx0 + gnx, gy1 = gy0 + gny, gz1 = gz0 + gnz;
    const zlo = bza > gz0 ? bza : gz0, zhi = bzb < gz1 - 1 ? bzb : gz1 - 1;
    for (let x = bxa; x <= bxb; x++) {
      const inX = x >= gx0 && x < gx1;
      for (let y = bya; y <= byb; y++) {
        const row = inX && y >= gy0 && y < gy1 ? ((x - gx0) * gny + (y - gy0)) * gnz - gz0 : -1;
        const ground = flat && y < origin.y && y >= minY ? groundInfo : null;
        let run = 0; // 並んだ全ブロックは 1 つの箱にまとめる（面がそろっているので、ぶつかる所も重なりも同じ。箱が減る分だけ速い）
        for (let z = bza; z <= bzb; z++) {
          let b = ground;
          if (row >= 0 && z >= zlo && z <= zhi) { const k = grid[row + z]; if (k !== 0) b = infos[k]; }
          if (b && b.fullCube) { if (run === 0) runZ0 = z; run++; continue; }
          if (run) { const o = boxN * 6; boxBuf[o] = x; boxBuf[o + 1] = y; boxBuf[o + 2] = runZ0; boxBuf[o + 3] = x + 1; boxBuf[o + 4] = y + 1; boxBuf[o + 5] = runZ0 + run; boxN++; run = 0; }
          if (!b) continue;
          if (b.unknown) { cClean = false; issues.set(`block:${b.unknown}`, `${b.unknown} の当たり判定・滑りやすさは実機で測っていません`); pushBox(x, y, z, x + 1, y + 1, z + 1); continue; }
          if (b.shapeWhy || b.stairs) { cClean = false; flagShape(b, x, y, z); }
          const list = b.dynamic === 'fence' ? fenceBoxes((dx, dz) => at(x + dx, y, z + dz)) : b.boxes;
          for (const r of list) pushBox(x + r[0], y + r[1], z + r[2], x + r[3], y + r[4], z + r[5]);
        }
        if (run) { const o = boxN * 6; boxBuf[o] = x; boxBuf[o + 1] = y; boxBuf[o + 2] = runZ0; boxBuf[o + 3] = x + 1; boxBuf[o + 4] = y + 1; boxBuf[o + 5] = runZ0 + run; boxN++; }
      }
    }
  }

  function clipAxis(box, axis, d, minYBelow = Infinity) {
    // box: [minX,minY,minZ,maxX,maxY,maxZ]。周りの箱 i は boxBuf[6i .. 6i+5]。minYBelow: 底がこれより下の箱だけ使う（段差）
    const a = axis, o1 = (a + 1) % 3, o2 = (a + 2) % 3;
    for (let i = 0; i < boxN; i++) {
      const o = i * 6;
      if (!(boxBuf[o + 1] < minYBelow)) continue;
      if (box[o1 + 3] <= boxBuf[o + o1] + EPS || box[o1] >= boxBuf[o + o1 + 3] - EPS) continue;
      if (box[o2 + 3] <= boxBuf[o + o2] + EPS || box[o2] >= boxBuf[o + o2 + 3] - EPS) continue;
      if (d > 0 && box[a + 3] <= boxBuf[o + a] + EPS) d = Math.min(d, boxBuf[o + a] - box[a + 3]);
      else if (d < 0 && box[a] >= boxBuf[o + a + 3] - EPS) d = Math.max(d, boxBuf[o + a + 3] - box[a]);
    }
    return d;
  }
  /** 箱が周りのどれかと重なっているか（面が触れているだけは重ならない） */
  function overlapsAny(bx) {
    for (let i = 0; i < boxN; i++) {
      const o = i * 6;
      if (bx[3] > boxBuf[o] && bx[0] < boxBuf[o + 3] && bx[4] > boxBuf[o + 1] && bx[1] < boxBuf[o + 4] && bx[5] > boxBuf[o + 2] && bx[2] < boxBuf[o + 5]) return true;
    }
    return false;
  }

  /** 当たり判定の箱（float32）。実機はこの箱が本体で、位置は箱の中心（横）と底（縦）から出す */
  function box() {
    if (!s.box) {
      const hw = F(P.width / 2);
      const mnx = F(s.x - hw), mnz = F(s.z - hw);
      // 最大の角は「位置 + 幅/2」（「最小 + 幅」ではない）。実機の位置と 1 ulp 違う tick が 37 → 9 に減った（2026-09-20、全シナリオで数えた）
      s.box = [mnx, s.y, mnz, F(s.x + hw), F(s.y + F(P.height)), F(s.z + hw)];
    }
    return s.box;
  }

  const ORDER = (P.collisionOrder ?? 'yxz').split('').map((c) => 'xyz'.indexOf(c));
  const STEP = F(P.stepHeight ?? 0.5625);
  /**
   * 箱を動かす。ぶつかる軸は手前で止める。戻り値は実際に動いた量 [dx, dy, dz]。
   * 地面にいて（または着地して）横にぶつかったら段差を上る: 上へ STEP → x → z → 下へ戻す、で横に進めた方が遠ければそちら
   * （実機: slab_walk_up で 0.5 の段を 1 tick で上り、横の速さは落ちない。手順は bedsim の calculateAutoStep と同じ）
   */
  const want = [0, 0, 0], got = [0, 0, 0], sb = [0, 0, 0, 0, 0, 0]; // 使い回し（move は入れ子で呼ばれない）
  function move(dx, dy, dz, ground = false) {
    const bx = box();
    const ox0 = bx[0], oy0 = bx[1], oz0 = bx[2], ox1 = bx[3], oy1 = bx[4], oz1 = bx[5];
    boxesAround(Math.min(bx[0], bx[0] + dx), Math.min(bx[1], bx[1] + dy), Math.min(bx[2], bx[2] + dz),
      Math.max(bx[3], bx[3] + dx), Math.max(bx[4], bx[4] + dy), Math.max(bx[5], bx[5] + dz));
    want[0] = dx; want[1] = dy; want[2] = dz;
    got[0] = 0; got[1] = 0; got[2] = 0;
    for (let oi = 0; oi < 3; oi++) {
      const axis = ORDER[oi];
      if (want[axis] === 0) continue;
      const d = F(clipAxis(bx, axis, want[axis]));
      got[axis] = d;
      bx[axis] = F(bx[axis] + d);
      bx[axis + 3] = F(bx[axis + 3] + d);
    }
    const hitH = Math.abs(got[0] - dx) > 1e-9 || Math.abs(got[2] - dz) > 1e-9;
    const hitDown = Math.abs(got[1] - dy) > 1e-9 && dy < 0;
    if (hitH && (ground || hitDown)) {
      sb[0] = ox0; sb[1] = oy0; sb[2] = oz0; sb[3] = ox1; sb[4] = oy1; sb[5] = oz1;
      const lim = oy1; // 足もとより上に底がある箱は段差の計算に使わない
      const up = F(clipAxis(sb, 1, STEP, lim)); sb[1] = F(sb[1] + up); sb[4] = F(sb[4] + up);
      const sx = dx === 0 ? 0 : F(clipAxis(sb, 0, dx, lim)); sb[0] = F(sb[0] + sx); sb[3] = F(sb[3] + sx);
      const sz = dz === 0 ? 0 : F(clipAxis(sb, 2, dz, lim)); sb[2] = F(sb[2] + sz); sb[5] = F(sb[5] + sz);
      const down = F(clipAxis(sb, 1, -up, lim)); sb[1] = F(sb[1] + down); sb[4] = F(sb[4] + down);
      const sy = F(up + down);
      if (!overlapsAny(sb) && F(F(got[0] * got[0]) + F(got[2] * got[2])) < F(F(sx * sx) + F(sz * sz))) {
        for (let i = 0; i < 6; i++) bx[i] = sb[i];
        got[0] = sx; got[1] = sy; got[2] = sz;
      }
    }
    return got;
  }

  function blockBelow() {
    const b = at(Math.floor(s.x), Math.floor(s.y - 0.5000001), Math.floor(s.z));
    if (b?.unknown) issues.set(`block:${b.unknown}`, `${b.unknown} の滑りやすさは実機で測っていません`);
    return b;
  }
  /** 乗っているブロック（着地・歩いたときの効果に使う）。箱の底を少し下げて重なるもののうち、足の真下のセルにいちばん近いもの */
  function supportingBlock() {
    const bx = box();
    const q = [bx[0], F(bx[1] - F(0.001)), bx[2], bx[3], bx[1], bx[5]];
    const cx = Math.floor(s.x) + 0.5, cy = Math.floor(s.y) + 0.5, cz = Math.floor(s.z) + 0.5;
    let best = null, bd = Infinity;
    for (let x = Math.floor(q[0]); x <= Math.floor(q[3]); x++)
      for (let y = Math.floor(q[1]) - 1; y <= Math.floor(q[4]); y++)
        for (let z = Math.floor(q[2]); z <= Math.floor(q[5]); z++) {
          const b = at(x, y, z);
          if (!b || b.unknown) continue;
          const list = b.fullCube ? null : (b.dynamic === 'fence' ? fenceBoxes((dx, dz) => at(x + dx, y, z + dz)) : b.boxes);
          const hit = (r) => q[3] > x + r[0] && q[0] < x + r[3] && q[4] > y + r[1] && q[1] < y + r[4] && q[5] > z + r[2] && q[2] < z + r[5];
          if (list ? !list.some(hit) : !hit([0, 0, 0, 1, 1, 1])) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
          if (d < bd) { bd = d; best = b; }
        }
    return best;
  }

  // ---- 1 tick ------------------------------------------------------------------
  function step(input = {}) {
    const inp = input ?? {};
    for (const k in inp) {
      if (!KNOWN_INPUTS.has(k) && inp[k] !== undefined && inp[k] !== null && inp[k] !== false) {
        issues.set(`input:${k}`, `入力 ${k} は実機で測っていません`);
      }
    }
    // 入力は「押しっぱなし」の状態で渡る。走りは変わったときだけ切り替わる（実機の driver と同じ）
    if (Boolean(inp.sprint) !== Boolean(s.prev.sprint)) s.sprinting = Boolean(inp.sprint);
    if (inp.yaw !== undefined && inp.yaw !== null) s.yaw = inp.yaw;
    const mv = inp.move ?? { x: 0, z: 0 };
    s.prev = inp;

    const yawR = F(F(s.yaw) * F(Math.PI / 180));
    // 移動の向きは本物の sin/cos（向きの計算の sin の表ではない — 表にすると 30° で 420 ulp ずれるのを確かめた）
    const sin = F(Math.sin(yawR)), cos = F(Math.cos(yawR));
    // 速度は「前の tick の動き × 摩擦」から始まる。実機は掛け算と足し算を 1 回の丸めで済ませる（FMA）
    // — 走りで 1 ulp ずれる tick があり、FMA にすると全部合う（test/physics/expected.json）
    const fPrev = s.f ?? 1;
    let vy = s.vy;
    // スライム・はちみつの上では、前の tick の横の速さが ×(0.4 + |縦|×0.2)（縦が 0.1 未満のとき。縦は前の tick の終わりの速さ）。
    // 着地した次の tick にも効く（実機: slime_walk / honey_walk で 0.3026 = 0.41568 × 0.728、honey_sprint_jump の着地の次）
    let bvx = s.vx, bvz = s.vz;
    if (anySticky && s.onGround && Math.abs(vy) < 0.1) {
      const sup = supportingBlock();
      if (sup?.stickyWalk) { const m = F(F(0.4) + F(F(Math.abs(vy)) * F(0.2))); bvx = F(bvx * m); bvz = F(bvz * m); }
    }
    let hx = bvx * fPrev, hz = bvz * fPrev; // まだ丸めない（FMA の途中）

    // はしご: 足のセルがはしごなら、落ちるのは 0.2 まで。跳んでいるか横にぶつかっていたら（前の tick）0.2 で上る
    // （実機: ladder_climb で毎 tick +0.2、離すと落ちる速さが 0.2 で止まる）。
    // 「跳んでいる」は地面で跳ぶ tick と、その次の 1 tick だけ（SimulatedPlayer の jump() は空中では効かない。
    // 実機: ladder_jump_hold で、跳んだ次の tick だけ 0.2 になり、押しっぱなしでも上り続けない）。
    // 地面で跳ぶ tick は、はしごの 0.2 よりジャンプの 0.42 が勝つ（上の処理が先、ジャンプが後）
    const climbing = anyClimb && Boolean(at(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))?.climbable);
    const jumpedLast = s.jumped; s.jumped = false;
    const bounced = s.bouncePending; s.bouncePending = false;
    if (climbing) {
      const cs = F(P.climbSpeed ?? 0.2);
      if (vy < -cs) vy = -cs;
      if ((inp.jump && (s.onGround || jumpedLast)) || s.collidedH) vy = cs;
    }

    // ジャンプ（地面にいるときだけ。押しっぱなしなら着地した tick にまた跳ぶ — 実機で確認）
    let bouncedOverridden = false;
    if (inp.jump && s.onGround) {
      s.jumped = true;
      // はちみつの中・真下なら 0.6 倍（実機: honey_jump で 0.252）
      const honeyJump = anyHoney && (at(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))?.honey || at(Math.floor(s.x), Math.floor(F(s.y - F(0.1))), Math.floor(s.z))?.honey);
      const jv = honeyJump ? F(F(P.jumpVelocity) * F(0.6)) : F(P.jumpVelocity);
      if (bounced && jv >= vy) bouncedOverridden = true;
      vy = Math.max(jv, vy); // 上向きに速いとき（スライムで跳ねた直後）はそのまま（bedsim の JumpImpulse と同じ）
      if (s.sprinting && inp.jumpBoost !== false) { // 走り跳びは向いている方へ 0.2（jumpBoost: false は controls.js が決める）
        hx = F(hx) - F(sin * F(P.sprintJumpBoost));
        hz = F(hz) + F(cos * F(P.sprintJumpBoost));
      }
    }

    if (bounced && !bouncedOverridden) issues.set('bounce:slime', 'スライムで跳ね上がる高さの式は実機と合っていません（slime_fall で 2〜15% 低い）');
    const under = s.onGround ? blockBelow() : null;
    const slip = F(under?.unknown ? P.defaultSlip : (under?.slip ?? P.defaultSlip));
    const f = s.onGround ? F(slip * F(P.airDrag)) : F(P.airDrag);
    // 地面の加速は滑りやすさで変わる: ×（ふつうの床の摩擦³ ÷ この床の摩擦³）。ふつうの床ではちょうど 1
    // （実機: 氷の上の 1 tick 目が 0.1274 ではなく 0.0292 = 0.1274 × (0.546 / 0.8918)³）
    // ソウルサンドは加速にだけ効く摩擦が 1.225 倍（実機: soul_sand_walk。減り方は 0.546 のまま）
    const fa = under?.accelFriction ? F(F(slip * F(under.accelFriction)) * F(P.airDrag)) : f;
    const fStd = F(F(P.defaultSlip) * F(P.airDrag));
    const k = s.onGround ? F((fStd * fStd * fStd) / (fa * fa * fa)) : 1; // 途中で丸めない（青氷で確かめた）
    const speed = s.onGround
      ? F(F(s.sprinting ? P.sprintSpeed : P.walkSpeed) * k)
      : F(s.sprinting ? P.airSprintSpeed : P.airSpeed);

    // 入力は長さ 1 に揃えてから 0.98 を掛ける（斜めで √2 倍にならない — 実機で確認）
    let ix = F(mv.x ?? 0), iz = F(mv.z ?? 0);
    const len = F(Math.sqrt(F(F(ix * ix) + F(iz * iz))));
    if (len > 1) { ix = F(ix / len); iz = F(iz / len); }
    let ax = 0, az = 0;
    if (ix !== 0 || iz !== 0) {
      const sx = F(F(ix * F(P.inputScale)) * speed), sz = F(F(iz * F(P.inputScale)) * speed);
      ax = F(F(sx * cos) - F(sz * sin)); az = F(F(sz * cos) + F(sx * sin));
    }
    let vx = F(hx + ax), vz = F(hz + az); // FMA: 摩擦を掛けた値を丸めずに足す

    const wasGround = s.onGround;
    const vyPre = vy;
    const [dx, dy, dz] = move(vx, vy, vz, wasGround);
    const bb = box();
    const nx = F(F(bb[0] + bb[3]) / 2), ny = bb[1], nz = F(F(bb[2] + bb[5]) / 2);
    const hitX = Math.abs(dx - vx) > 1e-9, hitY = Math.abs(dy - vy) > 1e-9, hitZ = Math.abs(dz - vz) > 1e-9;
    s.dx = F(nx - s.x); s.dy = F(ny - s.y); s.dz = F(nz - s.z);
    s.x = nx; s.y = ny; s.z = nz;
    // 接地: 下向きに動こうとしてぶつかったときだけ。置いた直後の 1 tick は空中扱い（実機: 空中の加速 0.0196 で動く）
    s.onGround = hitY && vy < 0;
    s.collidedH = hitX || hitZ; // 横にぶつかった（壁を押している）
    // 乗っているブロックの効果（bedsim の walkOnBlock / landOnBlock と同じ順）
    const sup = (anyBounce && hitY && !wasGround && vyPre < 0) ? supportingBlock() : null;
    if (hitX) vx = 0;
    if (hitZ) vz = 0;
    if (hitY) vy = 0;
    // スライムに空中から落ちると跳ね返る。式は bedsim と同じ「当たる前の速さを反転」。
    // 地面に置いた直後のような小さな跳ね（0.08 以下で浮かない）と、次の tick のジャンプで上書きされる跳ねは実機と一致する
    // （slime_walk / slime_sprint_jump）。本当に跳ね上がると、実機（slime_fall）はこれより 2〜15% 高く、式が分かっていない
    // → そのときは inconclusive（次の tick に、ジャンプで上書きされなかったら積む）
    if (sup?.bounce === 'slime') {
      vy = F(-vyPre); if (Math.abs(vy) < 1e-4) vy = 0;
      if (vy > F(P.gravity)) s.bouncePending = true;
    }
    if (s.onGround || climbing) s.fallDistance = 0; else if (dy < 0) s.fallDistance -= dy;

    vy = F(F(vy - F(P.gravity)) * F(P.verticalDrag));
    // はちみつのマス（1×1×1）に体が入っていたら（横の 1/16 の隙間）、1 マスごとに横 ×0.4・落ちる速さは 0.12 まで
    // （bedsim の applyHoneyWallSlide。ただし面が触れているだけでは効かない — 実機: honey_wall_fall。honey_side_walk / honey_jump_side_hit）
    // 摩擦はふだん次の tick の頭で掛ける（FMA）が、ここでは bedsim と同じく「摩擦 → ×0.4」の順に丸める（1 ulp 合わせ）
    let fNext = f;
    if (anyHoney) {
      const bb = box();
      for (let x = Math.floor(bb[0]); x < Math.ceil(bb[3]); x++)
        for (let y = Math.floor(bb[1]); y < Math.ceil(bb[4]); y++)
          for (let z = Math.floor(bb[2]); z < Math.ceil(bb[5]); z++) {
            if (!at(x, y, z)?.honey) continue;
            if (!(bb[3] > x && bb[0] < x + 1 && bb[4] > y && bb[1] < y + 1 && bb[5] > z && bb[2] < z + 1)) continue;
            if (fNext !== 1) { vx = F(vx * f); vz = F(vz * f); fNext = 1; }
            vx = F(vx * F(0.4)); vz = F(vz * F(0.4)); if (vy < F(-0.12)) vy = F(-0.12);
          }
    }
    // 横の摩擦は次の tick の頭で掛ける（FMA のため）。どの摩擦を使うかは「動く前に接地していたか」で決まる
    s.vx = vx; s.vy = vy; s.vz = vz; s.f = fNext;
    if (s.y < minY - 64) issues.set('void', '奈落より下に落ちました（実機では死にます。死は再現していません）');
    s.tick++;
  }

  function observePlayer() {
    return {
      x: s.x - origin.x, y: s.y - origin.y, z: s.z - origin.z,
      vx: s.dx, vy: s.dy, vz: s.dz,
      onGround: s.onGround, sprinting: s.sprinting, yaw: s.yaw, collidedH: Boolean(s.collidedH),
      block: { x: Math.floor(s.x) - origin.x, y: Math.floor(s.y + 1e-6) - origin.y, z: Math.floor(s.z) - origin.z },
      fallDistance: s.fallDistance,
    };
  }
  function observe() { return { tick: s.tick, player: observePlayer() }; }
  /** 位置と速さだけ（block の入れ物を作らない軽い写し。戦いのサンドボックスが 1 tick に何度も呼ぶ）。
   *  poseInto は入れ物を渡す形（使い回して、1 tick ごとに作らないため） */
  function poseInto(p) {
    p.x = s.x - origin.x; p.y = s.y - origin.y; p.z = s.z - origin.z;
    p.vx = s.dx; p.vy = s.dy; p.vz = s.dz;
    p.onGround = s.onGround; p.sprinting = s.sprinting; p.yaw = s.yaw; p.collidedH = Boolean(s.collidedH);
    return p;
  }
  function pose() { return poseInto({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, sprinting: false, yaw: 0, collidedH: false }); }

  // ---- 目標に使える述語と、探索の候補 -------------------------------------------------
  /** 立っているブロック（足の真下）。空中なら null */
  const standing = (o) => (o.player.onGround
    ? { x: Math.floor(o.player.x + origin.x) - origin.x, y: Math.floor(o.player.y + origin.y - 0.001) - origin.y, z: Math.floor(o.player.z + origin.z) - origin.z }
    : null);
  const asVec = (a) => (Array.isArray(a) ? { x: a[0], y: a[1], z: a[2] } : a);
  const predicates = {
    /** { standOn: [x, y, z] } そのブロックの上に立っている */
    standOn: (o, a) => { const b = standing(o); const v = asVec(a); return Boolean(b && b.x === v.x && b.y === v.y && b.z === v.z); },
    /** { standOnAny: [[x,y,z], …] } */
    standOnAny: (o, list) => list.some((a) => predicates.standOn(o, a)),
    /** { below: y } 足が y より下（落ちた） */
    below: (o, y) => o.player.y < y,
  };
  const distances = {
    standOn: (o, a) => {
      const v = asVec(a);
      const dx = o.player.x - (v.x + 0.5), dz = o.player.z - (v.z + 0.5), dy = o.player.y - (v.y + 1);
      return Math.hypot(dx, dz) + Math.abs(dy) * 0.5 + (predicates.standOn(o, a) ? 0 : 0.01);
    },
    standOnAny: (o, list) => Math.min(...list.map((a) => distances.standOn(o, a))),
  };
  /** 目標の場所（向きを決めるのに使う） */
  function targetOf(cond) {
    if (!cond || typeof cond !== 'object') return null;
    if (cond.standOn) { const v = asVec(cond.standOn); return { x: v.x + 0.5, z: v.z + 0.5 }; }
    if (cond.region) { const r = cond.region; return { x: ((r.min?.x ?? r.max?.x) + (r.max?.x ?? r.min?.x)) / 2, z: ((r.min?.z ?? r.max?.z) + (r.max?.z ?? r.min?.z)) / 2 }; }
    for (const k of ['all', 'any']) if (cond[k]) for (const c of cond[k]) { const t = targetOf(c); if (t) return t; }
    return null;
  }
  const yawTo = (o, t) => Math.round((Math.atan2(-(t.x - o.player.x), t.z - o.player.z) * 180) / Math.PI);
  /**
   * 探索の候補。向き（目標の方角 ± いくつか・東西南北）× 歩く/走る/止まる × 跳ぶ/跳ばない × 何 tick。
   * 向きは整数の度にする（テープに書けて、実機にそのまま渡せる）。
   */
  function actions(o, goal, { holds = [1, 2, 4, 8], spread = [0, -8, 8, -20, 20, -40, 40, -90, 90, 180] } = {}) {
    const t = targetOf(goal?.reach);
    // 目標が無いとき（discover）は 16 方位を同じように試す
    const yaws = new Set(t ? [0, 90, 180, -90] : [0, 22, 45, 67, 90, 112, 135, 157, 180, -22, -45, -67, -90, -112, -135, -157]);
    if (t) for (const d of spread) { let y = yawTo(o, t) + d; while (y > 180) y -= 360; while (y <= -180) y += 360; yaws.add(y); }
    const out = [];
    const landed = { path: 'player.onGround', eq: true };
    for (const yaw of yaws) {
      if (o.player.onGround) {
        // 地面で位置を合わせる（歩く・走る・止まる）
        for (const sprint of [true, false]) for (const hold of holds) out.push({ input: { yaw, move: { x: 0, z: 1 }, sprint, jump: false }, hold });
        // 跳んで、着地するまで同じ向きに押し続ける（走り跳び・歩き跳び・その場跳び）
        for (const sprint of [true, false]) out.push({ input: { yaw, move: { x: 0, z: 1 }, sprint, jump: true }, then: { yaw, move: { x: 0, z: 1 }, sprint, jump: false }, until: landed, min: 2, max: 80 });
        out.push({ input: { yaw, move: { x: 0, z: 0 }, sprint: false, jump: false }, hold: 2 });
      } else {
        // 空中（ふつうは着地まで待つ行動の中で過ぎるので、ここに来るのは落ちている最中）
        out.push({ input: { yaw, move: { x: 0, z: 1 }, sprint: o.player.sprinting, jump: false }, until: landed, max: 80 });
      }
    }
    return out;
  }
  // ---- 目標を教えられないとき（discover.js）--------------------------------------------
  /** 区画: 0.5 ブロックの升目 ＋ 接地（空中は縦 1 ブロック） */
  const cell = (o) => `${Math.floor(o.player.x * 2)},${Math.floor(o.player.y * (o.player.onGround ? 4 : 1))},${Math.floor(o.player.z * 2)},${o.player.onGround ? 1 : 0}`;

  /** コースのブロックを、つながった塊（足場）に分ける（地面は含めない） */
  function platforms() {
    const cells = [...solid.entries()].filter(([, v]) => v).map(([k, v]) => { const [x, y, z] = k.split('|').map(Number); return { x: x - origin.x, y: y - origin.y, z: z - origin.z, type: v.unknown ?? v.id ?? v.type }; });
    const key = (b) => `${b.x}|${b.y}|${b.z}`;
    const byKey = new Map(cells.map((b) => [key(b), b]));
    const seen = new Set();
    const out = [];
    for (const b of cells) {
      if (seen.has(key(b))) continue;
      const group = [];
      const stack = [b];
      seen.add(key(b));
      while (stack.length) {
        const c = stack.pop();
        group.push(c);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const n = byKey.get(`${c.x + dx}|${c.y + dy}|${c.z + dz}`);
          if (n && !seen.has(key(n))) { seen.add(key(n)); stack.push(n); }
        }
      }
      // 上に立てる面 = 真上が空いているブロック
      const tops = group.filter((c) => !byKey.has(`${c.x}|${c.y + 1}|${c.z}`) && !byKey.has(`${c.x}|${c.y + 2}|${c.z}`));
      out.push({ blocks: group, tops, types: [...new Set(group.map((c) => c.type))] });
    }
    return out;
  }

  /**
   * discover の結果から、目標の候補を出す（規則だけ。学習なし）。
   *   ・立てた足場のうち、いちばん珍しい種類のブロックを持つもの／いちばん遅く（遠く）たどり着いたもの → 勝ちの候補
   *   ・足場から地面へ落ちること → 負けの候補（出発点が地面より高いとき）
   *   ・一度も立てなかった足場 → 「届かない足場」として報告（アスレチックの不具合の手がかり）
   */
  function goalCandidates(all, tapeOf) {
    const plats = platforms();
    if (!plats.length) return [];
    const typeCount = new Map();
    for (const p of plats) for (const b of p.blocks) typeCount.set(b.type, (typeCount.get(b.type) ?? 0) + 1);
    const stoodAt = new Map(); // "x|y|z" → いちばん早く立った区画
    for (const c of all) {
      const b = standing(c.obs);
      if (!b) continue;
      const k = `${b.x}|${b.y}|${b.z}`;
      if (!stoodAt.has(k) || stoodAt.get(k).tick > c.tick) stoodAt.set(k, c);
    }
    const spawnKey = (() => { const s0 = { player: { x: spawn.x, y: spawn.y, z: spawn.z, onGround: true } }; const b = standing(s0); return b && `${b.x}|${b.y}|${b.z}`; })();
    const out = [];
    const reached = [];
    for (const p of plats) {
      const hits = p.tops.map((t) => stoodAt.get(`${t.x}|${t.y}|${t.z}`)).filter(Boolean);
      const isStart = p.tops.some((t) => `${t.x}|${t.y}|${t.z}` === spawnKey);
      if (!hits.length) {
        out.push({ kind: 'unreached', score: -10, condition: { standOnAny: p.tops.map((t) => [t.x, t.y, t.z]) }, tick: null, tape: null, reasons: [`この足場（${p.types.join(', ')}、${p.tops.length} 面）には一度も立てなかった`] });
        continue;
      }
      const first = hits.reduce((m, c) => (c.tick < m.tick ? c : m));
      reached.push({ p, first, isStart });
    }
    if (!reached.length) return out;
    const lastTick = Math.max(...reached.map((r) => r.first.tick));
    const minCount = Math.min(...reached.flatMap((r) => r.p.types.map((t) => typeCount.get(t))));
    const majority = Math.max(...typeCount.values());
    for (const r of reached) {
      if (r.isStart) continue;
      const reasons = [];
      let score = 0;
      const rare = r.p.types.filter((t) => typeCount.get(t) === minCount && minCount < majority);
      if (rare.length) { score += 3; reasons.push(`珍しいブロック（${rare.join(', ')}）でできた足場`); }
      if (r.first.tick === lastTick) { score += 2; reasons.push('たどり着いた足場の中でいちばん遠い（最後に届いた）'); }
      const dist = Math.hypot(r.p.tops[0].x - spawn.x, r.p.tops[0].z - spawn.z);
      reasons.push(`出発点から ${dist.toFixed(1)} ブロック、最初に立てたのは tick ${r.first.tick}`);
      out.push({ kind: score >= 2 ? 'win' : 'reached', score, condition: { standOnAny: r.p.tops.map((t) => [t.x, t.y, t.z]) }, tick: r.first.tick, tape: tapeOf(r.first), reasons });
    }
    // 負け: 出発点が地面より高いなら、地面に落ちること
    if (spawn.y > 0.5) {
      const lowest = Math.min(...reached.map((r) => Math.min(...r.p.tops.map((t) => t.y + 1))));
      out.push({ kind: 'lose', score: -3, condition: { below: lowest - 0.5 }, tick: null, tape: null, reasons: [`出発点が地面より高い。立てた足場でいちばん低い面（y=${lowest}）より下へ落ちたら戻れない`] });
    }
    return out;
  }

  /** 終わった状態か（discover が広げない）。出発点が地面より高いコースで、どの足場よりも下に落ちたら終わり */
  let lowestTopCache;
  const terminal = (o) => {
    if (!(spawn.y > 0.5)) return false;
    if (lowestTopCache === undefined) { const ps = platforms(); lowestTopCache = ps.length ? Math.min(...ps.flatMap((p) => p.tops.map((t) => t.y + 1))) : -Infinity; }
    return o.player.y < lowestTopCache - 0.5;
  };

  /** 実機で同じテープを流すための 1 件（tools/live/bds-tape.mjs の jobs） */
  const toJob = (name, tape) => ({ name, spawn, blocks: spec.blocks ?? [], tape });

  /**
   * 状態を外から合わせる（本物のクライアントがサーバーの訂正・テレポートを受けたとき）。
   * pos は足の位置（原点からの相対）、vel は 1 tick の動き。当たり判定の箱も作り直す
   */
  function setState({ pos, vel, onGround, yaw } = {}) {
    if (pos) { s.x = F(origin.x + pos.x); s.y = F(origin.y + pos.y); s.z = F(origin.z + pos.z); s.box = null; }
    if (vel) { s.vx = F(vel.x); s.vy = F(vel.y); s.vz = F(vel.z); s.f = 1; }
    if (onGround !== undefined) s.onGround = onGround;
    if (yaw !== undefined) s.yaw = yaw;
  }

  return {
    kind: 'voxel',
    setState,
    predicates,
    distances,
    actions,
    cell,
    goalCandidates,
    terminal,
    toJob,
    origin,
    /** 入力の欄（ソルバが組み合わせを作るのに使う） */
    inputs: { move: 'vec2', sprint: 'bool', jump: 'bool', yaw: 'number' },
    reset,
    step,
    edit,
    observePlayer,
    pose,
    poseInto,
    resetBlocks,
    observe,
    // 状態の写し（ブロックは入らない。ブロックは edit / resetBlocks で）。JSON を通すのと同じ中身を、速く写す
    snapshot: () => copyState(s),
    restore: (snap) => { s = copyState(snap); },
    fingerprint: (q = 200) => `${Math.round(s.x * q)}|${Math.round(s.y * q)}|${Math.round(s.z * q)}|${Math.round(s.vx * q)}|${Math.round(s.vy * q)}|${Math.round(s.vz * q)}|${s.onGround ? 1 : 0}|${s.sprinting ? 1 : 0}|${s.yaw}`,
    /** 再現していないものに触れたか。触れていたら結果は inconclusive */
    issues: () => [...issues.entries()].map(([id, why]) => ({ id, why })),
    get tick() { return s.tick; },
  };
}
