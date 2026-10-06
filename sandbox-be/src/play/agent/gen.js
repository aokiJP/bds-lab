// いろいろなマップを作る（種から毎回同じものができる）。学習と実機の確かめの「問題集」。
//
//   athletic(seed, { length })  足場を跳び移って金ブロックへ（段差・曲がり角・1×1 の柱・氷・横ずれ）
//   escape(seed, { rooms, trap }) 部屋から出る。床のエメラルドに立つと扉（木の板）が開き、外の金ブロックに立つと「CLEAR」
//                               （部屋が 2 つなら、順番に開けないと出られない。trap: 踏むと外の通路が崩れる罠のダイヤ）
//   hard: true                  長いコース・上りが多い・隙間が広い／部屋 2〜3 と罠
//   extreme: true               足場 18〜26（1×1 と滑る床が多い・高さ 10 まで）／部屋 3〜4・罠・順番の謎解き（先に踏まないと効かないスイッチ・
//                               開いたあとに踏むと扉を閉め直す氷塊）
//   gauntlet(seed)              通し: 脱出（extreme）を抜けた先がアスレチック（extreme）
//   insane: true                物理の限界の近くの跳躍（平ら 3〜4・下り 4〜5・上り 2。1×1 からも）。解けないものが混じりうる
//   mixed(seed)                 全ブロックでないもの: ハーフの段・ソウルサンド・はちみつ・カーペットの足場、はしごで上る壁（スライムは跳ね返りの式が未解明なので使わない）
//                               （どれも 2026-09-20 に実機で測った形と動き。test/physics/scenarios.js の slab_* / ladder_* など）
// ブロックは実機で測った種類だけを使う（data/player-physics.json）。当たり判定・滑りやすさを推測で埋めないため。
import { mulberry32 } from './learner.js';

const pick = (rnd, xs) => xs[Math.floor(rnd() * xs.length)];
const col = (x, z, top, type, w = 1, d = 1) => ({ from: { x, y: 0, z }, to: { x: x + w - 1, y: top, z: z + d - 1 }, type });

/** 足場が重ならない・触れないか（1 マスの隙間を空ける） */
function clear(placed, p) {
  return placed.every((q) => p.x + p.w + 1 <= q.x || q.x + q.w + 1 <= p.x || p.z + p.d + 1 <= q.z || q.z + q.d + 1 <= p.z);
}

export function athletic(seed, { insane = false, extreme = insane, hard = extreme, length = insane ? 16 + (seed % 7) : extreme ? 18 + (seed % 9) : hard ? 10 + (seed % 5) : 6 + (seed % 4) } = {}) {
  const rnd = mulberry32(seed * 2654435761);
  const placed = [{ x: -1, z: -1, w: 3, d: 3, top: 2, type: 'stone' }];
  const dirs = [[0, 1], [1, 0], [-1, 0]]; // 前・右・左（戻らない）
  let dir = [0, 1];
  for (let i = 0; i < length; i++) {
    const last = placed.at(-1);
    const final = i === length - 1;
    let ok = null;
    for (let attempt = 0; attempt < 60 && !ok; attempt++) {
      if (rnd() < 0.3) dir = pick(rnd, dirs);
      const size = final ? pick(rnd, [[1, 1], [2, 2]]) : pick(rnd, extreme ? [[1, 1], [1, 1], [1, 2], [2, 1], [2, 2]] : [[1, 1], [1, 2], [2, 1], [2, 2], [3, 2], [2, 3]]);
      const dy = pick(rnd, insane ? [-3, -2, -1, 0, 1, 1] : hard ? [-1, 0, 1, 1] : [-1, 0, 0, 0, 1]);
      const top = Math.max(1, Math.min(extreme ? 10 : 6, last.top + dy));
      const up = top > last.top;
      // 隙間（端から端）: 上りは 1〜2、平らか下りは 1〜3。1×1 から跳ぶときは少し短く
      // insane: 物理の限界の近く（平ら 3〜4・下り 4〜5・上り 2。1×1 からも）
      const small = last.w * last.d === 1;
      // insane の上限は、実機で測った物理での総当たり（出発の足場・高さの差ごとに、跳べる最大の隙間。docs/fast-learning.md）:
      //   上り +1 → 3、平ら → 4、下り -1 → 4（3×3 以上から 5）、-2 → 5、-3 → 5（3×3 以上から 6）
      const srcBig = Math.min(last.w, last.d) >= 3; const dyv = top - last.top;
      const physMax = dyv > 0 ? 3 : dyv === 0 ? 4 : dyv === -1 ? (srcBig ? 5 : 4) : dyv === -2 ? 5 : (srcBig ? 6 : 5);
      const maxGap = insane ? physMax : up ? (small ? 1 : 2) : (small ? 2 : 3);
      const gap = insane ? Math.max(1, maxGap - (rnd() < 0.7 ? 0 : 1)) : hard ? Math.max(1, maxGap - Math.floor(rnd() * 2)) : 1 + Math.floor(rnd() * maxGap);
      const side = pick(rnd, [-1, 0, 0, 1]); // 横ずれ
      const [w, d] = size;
      let x, z;
      if (dir[1] === 1) { z = last.z + last.d + gap; x = last.x + Math.floor((last.w - w) / 2) + side; }
      else if (dir[0] === 1) { x = last.x + last.w + gap; z = last.z + Math.floor((last.d - d) / 2) + side; }
      else { x = last.x - gap - w; z = last.z + Math.floor((last.d - d) / 2) + side; }
      // 斜め（横ずれあり）のときは隙間を 1 つ詰める（斜めの跳躍は実距離が長い）
      if (side !== 0 && gap === maxGap && gap > 1) { if (dir[1] === 1) z -= 1; else if (dir[0] === 1) x -= 1; else x += 1; }
      const type = final ? 'gold_block' : pick(rnd, extreme ? ['stone', 'cobblestone', 'ice', 'packed_ice', 'blue_ice'] : ['stone', 'stone', 'cobblestone', 'oak_planks', 'ice']);
      const cand = { x, z, w, d, top, type };
      if (clear(placed.slice(0, -1), cand)) ok = cand;
    }
    if (!ok) break;
    placed.push(ok);
  }
  if (placed.at(-1).type !== 'gold_block') placed.at(-1).type = 'gold_block';
  const blocks = placed.map((p) => col(p.x, p.z, p.top, p.type, p.w, p.d));
  const g = placed.at(-1);
  return {
    name: `athletic${insane ? '-insane' : extreme ? '-extreme' : hard ? '-hard' : ''}-${seed}`,
    description: '生成したアスレチック。足場を跳び移って、金ブロックに立てばクリア（勝ちの合図が出る）。落ちたら失敗',
    generated: { kind: insane ? 'athletic-insane' : extreme ? 'athletic-extreme' : hard ? 'athletic-hard' : 'athletic', seed },
    world: {
      kind: 'voxel', spawn: { x: 0.5, y: 3, z: 0.5 }, yaw: 0, blocks,
      triggers: g.w === 1 && g.d === 1 ? [{ when: { standOn: [g.x, g.top, g.z] }, win: true }]
        : [...Array(g.w * g.d)].map((_, k) => ({ when: { standOn: [g.x + (k % g.w), g.top, g.z + Math.floor(k / g.w)] }, win: true })),
    },
    goal: { reach: { standOnAny: [...Array(g.w * g.d)].map((_, k) => [g.x + (k % g.w), g.top, g.z + Math.floor(k / g.w)]) }, avoid: { below: 1.5 } },
  };
}

export function escape(seed, { extreme = false, hard = extreme, rooms = extreme ? 3 + (seed % 2) : hard ? 2 + (seed % 2) : 1 + (seed % 2), trap = hard, order = extreme } = {}) {
  const rnd = mulberry32(seed * 40503 + 17);
  const blocks = []; const triggers = [];
  let z0 = 0; let spawn = null; let doorX = null;
  for (let r = 0; r < rooms; r++) {
    const W = 5 + Math.floor(rnd() * 3), D = 5 + Math.floor(rnd() * 3); // 部屋の外寸（壁を含む）
    const x0 = r === 0 ? -Math.floor(W / 2) : doorX - Math.floor(W / 2);
    // 床（y 0〜1）と壁（床の縁の上 y 2〜4）
    blocks.push({ from: { x: x0, y: 0, z: z0 }, to: { x: x0 + W - 1, y: 1, z: z0 + D - 1 }, type: 'stone' });
    for (const [a, b] of [[[x0, z0], [x0 + W - 1, z0]], [[x0, z0 + D - 1], [x0 + W - 1, z0 + D - 1]], [[x0, z0], [x0, z0 + D - 1]], [[x0 + W - 1, z0], [x0 + W - 1, z0 + D - 1]]]) {
      blocks.push({ from: { x: a[0], y: 2, z: a[1] }, to: { x: b[0], y: 4, z: b[1] }, type: 'glass' });
    }
    // 入口（前の部屋から来るなら、手前の壁に穴）
    if (r > 0) blocks.push({ from: { x: doorX, y: 2, z: z0 }, to: { x: doorX, y: 4, z: z0 }, type: 'air' });
    const inner = []; for (let x = x0 + 1; x <= x0 + W - 2; x++) for (let z = z0 + 1; z <= z0 + D - 2; z++) inner.push({ x, z });
    if (r === 0) { const s = pick(rnd, inner); spawn = { x: s.x + 0.5, y: 2, z: s.z + 0.5 }; }
    // 扉: 奥の壁のどこか（角を除く）
    const dx = x0 + 1 + Math.floor(rnd() * (W - 2));
    const dz = z0 + D - 1;
    blocks.push({ from: { x: dx, y: 2, z: dz }, to: { x: dx, y: 4, z: dz }, type: 'oak_planks' });
    // スイッチ: 扉から 3 マス以上、出発点から 2 マス以上離れた床
    const far = inner.filter((c) => Math.hypot(c.x - dx, c.z - dz) >= 3 && (!spawn || Math.hypot(c.x + 0.5 - spawn.x, c.z + 0.5 - spawn.z) >= 2));
    const sw = pick(rnd, far.length ? far : inner);
    blocks.push({ from: { x: sw.x, y: 1, z: sw.z }, to: { x: sw.x, y: 1, z: sw.z }, type: 'emerald_block' });
    const door = { from: { x: dx, y: 2, z: dz }, to: { x: dx, y: 4, z: dz } };
    if (order && r === rooms - 1) {
      // 順番の謎解き（最後の部屋）: エメラルドが 2 つ。扉のスイッチは、もう 1 つを先に踏んでいないと効かない。
      // 氷塊は扉が開いたあとに踏むと扉を閉め直す（もう開かない＝詰み）
      const rest = inner.filter((c) => (c.x !== sw.x || c.z !== sw.z) && Math.hypot(c.x - sw.x, c.z - sw.z) >= 2 && (!spawn || Math.floor(spawn.x) !== c.x || Math.floor(spawn.z) !== c.z));
      const a = pick(rnd, rest);
      blocks.push({ from: { x: a.x, y: 1, z: a.z }, to: { x: a.x, y: 1, z: a.z }, type: 'emerald_block' });
      const ia = triggers.length; triggers.push({ when: { standOn: [a.x, 1, a.z] } });
      const id = triggers.length; triggers.push({ when: { standOn: [sw.x, 1, sw.z], requires: [ia] }, set: [{ ...door, type: 'air' }] });
      const rest2 = rest.filter((c) => (c.x !== a.x || c.z !== a.z) && Math.hypot(c.x - dx, c.z - dz) >= 2);
      if (rest2.length) {
        const d = pick(rnd, rest2);
        blocks.push({ from: { x: d.x, y: 1, z: d.z }, to: { x: d.x, y: 1, z: d.z }, type: 'packed_ice' });
        triggers.push({ when: { standOn: [d.x, 1, d.z], requires: [id] }, set: [{ ...door, type: 'oak_planks' }] });
      }
    } else triggers.push({ when: { standOn: [sw.x, 1, sw.z] }, set: [{ ...door, type: 'air' }] });
    doorX = dx; z0 = dz + (r < rooms - 1 ? 3 : 1);
    // 部屋と部屋のあいだの通路（長さ 2）
    if (r < rooms - 1) blocks.push({ from: { x: dx, y: 0, z: dz + 1 }, to: { x: dx, y: 1, z: dz + 2 }, type: 'stone' });
  }
  // 外: 通路（1〜3）→ 跳び移り（0〜2 回）→ 金ブロック
  const corridor = 1 + Math.floor(rnd() * 3);
  blocks.push({ from: { x: doorX, y: 0, z: z0 }, to: { x: doorX, y: 1, z: z0 + corridor - 1 }, type: 'stone' });
  let z = z0 + corridor - 1; let x = doorX;
  const hops = Math.floor(rnd() * 3);
  for (let h = 0; h < hops; h++) {
    const gap = 1 + Math.floor(rnd() * 2);
    z += gap + 1; x += pick(rnd, [-1, 0, 1]);
    blocks.push({ from: { x, y: 0, z }, to: { x, y: 1, z }, type: 'cobblestone' });
  }
  const gap = 1 + Math.floor(rnd() * 2);
  let trapAt = null;
  // 罠: 最後の部屋の床に、もう 1 つスイッチ（ダイヤ）。踏むと外の通路と出口が崩れて、もう出られない（詰み）。踏まずに出るのを覚える
  if (trap) {
    const W = 3; const lastRoomFloor = blocks.filter((b) => b.type === 'stone' && b.to.y === 1 && b.to.x - b.from.x >= 4).at(-1);
    const cells = []; for (let cx = lastRoomFloor.from.x + 1; cx <= lastRoomFloor.to.x - 1; cx++) for (let cz = lastRoomFloor.from.z + 1; cz <= lastRoomFloor.to.z - 1; cz++) cells.push({ x: cx, z: cz });
    const used = new Set(blocks.filter((b) => b.type === 'emerald_block' || b.type === 'packed_ice').map((b) => `${b.from.x}|${b.from.z}`));
    const free = cells.filter((c) => !used.has(`${c.x}|${c.z}`) && !(spawn && Math.floor(spawn.x) === c.x && Math.floor(spawn.z) === c.z));
    if (free.length && W) {
      const t = pick(rnd, free);
      blocks.push({ from: { x: t.x, y: 1, z: t.z }, to: { x: t.x, y: 1, z: t.z }, type: 'diamond_block' });
      trapAt = t;
    }
  }
  z += gap + 1;
  if (trapAt) triggers.push({ when: { standOn: [trapAt.x, 1, trapAt.z] }, set: [{ from: { x: doorX, y: 0, z: z0 }, to: { x: doorX, y: 1, z: z0 + corridor - 1 }, type: 'air' }, { from: { x, y: 0, z }, to: { x, y: 1, z }, type: 'air' }] });
  blocks.push({ from: { x, y: 0, z }, to: { x, y: 1, z }, type: 'gold_block' });
  triggers.push({ when: { standOn: [x, 1, z] }, win: true });
  return {
    name: `escape${extreme ? '-extreme' : hard ? '-hard' : ''}-${seed}`,
    description: `生成した脱出マップ（部屋 ${rooms}）。床のエメラルドに立つと扉が開く。外の金ブロックに立つと「CLEAR」。何も教えない`,
    generated: { kind: extreme ? 'escape-extreme' : hard ? 'escape-hard' : 'escape', seed, rooms, trap, order },
    world: { kind: 'voxel', spawn, yaw: 0, blocks, triggers },
    goal: { reach: { standOn: [x, 1, z] }, avoid: { below: 0.5 } },
  };
}

/**
 * 通し（gauntlet）: 脱出（部屋 3〜4・順番の謎解き・閉め直す氷・罠）を抜けた先が、そのままアスレチック（足場 18〜26・滑る床・高さ 10 まで）。
 * 脱出の金ブロックは丸石になり、1 マス空けた先（1 段上）からアスレチックが始まる。勝ちはアスレチックの金ブロックだけ
 */
export function gauntlet(seed) {
  const e = escape(seed, { extreme: true });
  const eW = e.world;
  const winAt = eW.triggers.find((t) => t.win).when.standOn;
  const blocks = eW.blocks.map((b) => (b.type === 'gold_block' ? { ...b, type: 'cobblestone' } : b));
  const triggers = eW.triggers.filter((t) => !t.win); // 勝ちの仕掛けはいちばん最後なので、requires の番号は変わらない
  const a = athletic(seed + 7777, { extreme: true });
  const dx = winAt[0], dz = winAt[2] + 3; // アスレチックの出発の足場（x -1〜1・z -1〜1・高さ 2）を、出口の 1 マス先へ
  const mv = (b) => ({ ...b, from: { ...b.from, x: b.from.x + dx, z: b.from.z + dz }, to: { ...b.to, x: b.to.x + dx, z: b.to.z + dz } });
  for (const b of a.world.blocks) blocks.push(mv(b));
  const wins = a.world.triggers.map((t) => ({ ...t, when: { standOn: [t.when.standOn[0] + dx, t.when.standOn[1], t.when.standOn[2] + dz] } }));
  return {
    name: `gauntlet-${seed}`,
    description: '生成した通し（脱出の部屋 3〜4 → アスレチック）。何も教えない。アスレチックの金ブロックに立てばクリア',
    generated: { kind: 'gauntlet', seed, rooms: e.generated.rooms },
    world: { kind: 'voxel', spawn: eW.spawn, yaw: 0, blocks, triggers: [...triggers, ...wins] },
    goal: { reach: { standOnAny: wins.map((t) => t.when.standOn) }, avoid: { below: 0.5 } },
  };
}

/**
 * 全ブロックでないものを混ぜたアスレチック。足場のてっぺんが
 *   slab（立つ高さ +0.5）・soul_sand（+0.875、走りが遅い）・slime（走りが遅い）・honey_block（跳ぶ力 0.6 倍）・white_carpet（+1.0625）・stone
 * のどれか。上りはハーフの段（歩いて上る）か、はしご（壁を上る）。跳ぶ隙間は足場の種類で変える（はちみつは 1 マス・下りか平らだけ）。
 * 立つ高さの差は跳んで届く 1.0 まで（ハーフから全ブロックへ 1.5 は届かない）
 */
export function mixed(seed, { length = 8 + (seed % 5) } = {}) {
  const rnd = mulberry32(seed * 1103515245 + 12345);
  const H = { stone: 1, slab: 0.5, soul_sand: 0.875, slime: 1, honey_block: 1, carpet: 1.0625 };
  const blocks = [];
  // 足場: { x, z, w, d, top（いちばん上のマスの y）, kind }。立つ高さ = top + H[kind]
  const put = (p) => {
    const topType = p.kind === 'slab' ? 'smooth_stone_slab' : p.kind === 'carpet' ? 'stone' : p.kind === 'stone' ? 'stone' : p.kind;
    const full = p.kind === 'stone' || p.kind === 'carpet' || p.kind === 'gold';
    if (full) blocks.push({ from: { x: p.x, y: 0, z: p.z }, to: { x: p.x + p.w - 1, y: p.top, z: p.z + p.d - 1 }, type: p.kind === 'gold' ? 'gold_block' : 'stone' });
    else if (p.top > 0) blocks.push({ from: { x: p.x, y: 0, z: p.z }, to: { x: p.x + p.w - 1, y: p.top - 1, z: p.z + p.d - 1 }, type: 'stone' });
    if (p.kind === 'slab') blocks.push({ from: { x: p.x, y: p.top, z: p.z }, to: { x: p.x + p.w - 1, y: p.top, z: p.z + p.d - 1 }, type: 'smooth_stone_slab', states: { 'minecraft:vertical_half': 'bottom' } });
    else if (p.kind === 'carpet') blocks.push({ from: { x: p.x, y: p.top + 1, z: p.z }, to: { x: p.x + p.w - 1, y: p.top + 1, z: p.z + p.d - 1 }, type: 'white_carpet' });
    else if (p.kind !== 'stone' && p.kind !== 'gold') blocks.push({ from: { x: p.x, y: p.top, z: p.z }, to: { x: p.x + p.w - 1, y: p.top, z: p.z + p.d - 1 }, type: topType });
  };
  const stand = (p) => p.top + (p.kind === 'gold' ? 1 : H[p.kind]);
  const placed = [{ x: -1, z: -1, w: 3, d: 3, top: 2, kind: 'stone' }];
  let dir = [0, 1]; const dirs = [[0, 1], [1, 0], [-1, 0]];
  const ladders = [];
  for (let i = 0; i < length; i++) {
    const last = placed.at(-1); const final = i === length - 1;
    let ok = null;
    for (let attempt = 0; attempt < 80 && !ok; attempt++) {
      if (rnd() < 0.3) dir = pick(rnd, dirs);
      const move = final ? 'jump' : pick(rnd, ['jump', 'jump', 'jump', 'steps', 'ladder']);
      let w, d, gap, top, kind;
      if (move === 'ladder') {
        // 壁（2〜4 段上）を隙間なしで隣に。はしごは今の足場の縁のマスに立てる（上り口）
        if (last.w < 2 || last.d < 2 || last.kind !== 'stone') continue;
        [w, d] = [2, 2]; gap = 0; top = last.top + 2 + Math.floor(rnd() * 3); kind = 'stone';
      } else if (move === 'steps') {
        // ハーフの段: 隣（隙間なし）に 1 段上の足場。境目の今の足場側のマスにハーフを置いて、歩いて上る
        if (last.kind !== 'stone' || last.w < 2 || last.d < 2) continue;
        [w, d] = pick(rnd, [[2, 2], [3, 2], [2, 3]]); gap = 0; top = last.top + 1; kind = 'stone';
      } else {
        [w, d] = final ? pick(rnd, [[1, 1], [2, 2]]) : pick(rnd, [[1, 1], [2, 2], [2, 2], [3, 2], [2, 3], [3, 3]]);
        // スライムには跳び乗らない: 跳ね上がる高さの式が実機と合っていない（slime_fall）。跳び乗るとサンドボックスは inconclusive を出す
        kind = final ? 'gold' : pick(rnd, ['stone', 'slab', 'soul_sand', 'honey_block', 'carpet']);
        // 出発の足場で届く距離が違う: はちみつは 1・下りか平ら、ソウルサンド・スライムは 2 まで
        // 隙間は余裕を持たせる（限界の跳躍は athletic-insane の役目。ここは形と床の違いを確かめる問題集）:
        //   はちみつは 1・下りか平らだけ、ソウルサンド・スライムは下りか平らで 2・上りは 1、石・ハーフ・カーペットは 1×1 からと上りで 2、広い足場から下りか平らで 3
        const from = last.kind; const small = last.w * last.d === 1;
        const dyTop = pick(rnd, from === 'honey_block' ? [-1, 0] : [-1, 0, 0, 1]);
        top = Math.max(1, Math.min(9, last.top + dyTop));
        const rise = (top + (kind === 'gold' ? 1 : H[kind])) - stand(last);
        if (rise > (from === 'honey_block' ? 0 : 1.0) + 1e-9) continue;
        const maxGap = from === 'honey_block' ? 1 : from === 'soul_sand' || from === 'slime' ? (rise > 0 ? 1 : 2) : (small || rise > 0 ? 2 : 3);
        gap = 1 + Math.floor(rnd() * maxGap);
      }
      let x, z;
      const side = move === 'jump' ? pick(rnd, [-1, 0, 0, 1]) : 0;
      if (dir[1] === 1) { z = last.z + last.d + gap; x = last.x + Math.floor((last.w - w) / 2) + side; }
      else if (dir[0] === 1) { x = last.x + last.w + gap; z = last.z + Math.floor((last.d - d) / 2) + side; }
      else { x = last.x - gap - w; z = last.z + Math.floor((last.d - d) / 2) + side; }
      const cand = { x, z, w, d, top, kind, move, dir: dir.slice() };
      if (!clear(placed.slice(0, -1), cand)) continue;
      if (gap === 0 && !placed.slice(0, -1).every((q) => x + w <= q.x - 1 || q.x + q.w <= x - 1 || z + d <= q.z - 1 || q.z + q.d <= z - 1)) continue;
      ok = cand;
    }
    if (!ok) break;
    placed.push(ok);
  }
  if (placed.at(-1).kind !== 'gold') { const g = placed.at(-1); g.kind = 'gold'; }
  for (const p of placed) put(p);
  // 段とはしご（足場を置いたあとで。はしごは支えの壁が先にないと外れる）
  for (let i = 1; i < placed.length; i++) {
    const p = placed[i], last = placed[i - 1];
    if (p.move !== 'steps' && p.move !== 'ladder') continue;
    // 境目の今の足場側のマス（向きの手前の列の真ん中）
    const [dx, dz] = p.dir;
    const cx = dx === 1 ? last.x + last.w - 1 : dx === -1 ? last.x : Math.max(p.x, last.x) + (Math.min(p.x + p.w, last.x + last.w) - Math.max(p.x, last.x) > 1 ? 1 : 0);
    const cz = dz === 1 ? last.z + last.d - 1 : Math.max(p.z, last.z) + (Math.min(p.z + p.d, last.z + last.d) - Math.max(p.z, last.z) > 1 ? 1 : 0);
    if (p.move === 'steps') blocks.push({ from: { x: cx, y: last.top + 1, z: cz }, to: { x: cx, y: last.top + 1, z: cz }, type: 'smooth_stone_slab', states: { 'minecraft:vertical_half': 'bottom' } });
    else {
      // はしごの面: 壁が +z なら 2、−z なら 3、+x なら 4、−x なら 5
      const facing = dz === 1 ? 2 : dz === -1 ? 3 : dx === 1 ? 4 : 5;
      blocks.push({ from: { x: cx, y: last.top + 1, z: cz }, to: { x: cx, y: p.top, z: cz }, type: 'ladder', states: { facing_direction: facing } });
      ladders.push({ x: cx, z: cz });
    }
  }
  const g = placed.at(-1);
  return {
    name: `mixed-${seed}`,
    description: '生成したアスレチック（ハーフの段・ソウルサンド・スライム・はちみつ・カーペット・はしご）。金ブロックに立てばクリア',
    generated: { kind: 'mixed', seed },
    world: {
      kind: 'voxel', spawn: { x: 0.5, y: 3, z: 0.5 }, yaw: 0, blocks,
      triggers: [...Array(g.w * g.d)].map((_, k) => ({ when: { standOn: [g.x + (k % g.w), g.top, g.z + Math.floor(k / g.w)] }, win: true })),
    },
    goal: { reach: { standOnAny: [...Array(g.w * g.d)].map((_, k) => [g.x + (k % g.w), g.top, g.z + Math.floor(k / g.w)]) }, avoid: { below: 1.5 } },
  };
}

export const KINDS = ['athletic', 'escape', 'athletic-hard', 'escape-hard', 'athletic-extreme', 'escape-extreme', 'gauntlet', 'athletic-insane', 'mixed'];
export function generate(kind, seed, o = {}) {
  if (kind === 'athletic') return athletic(seed, o);
  if (kind === 'escape') return escape(seed, o);
  if (kind === 'athletic-hard') return athletic(seed, { ...o, hard: true });
  if (kind === 'escape-hard') return escape(seed, { ...o, hard: true });
  if (kind === 'athletic-extreme') return athletic(seed, { ...o, extreme: true });
  if (kind === 'escape-extreme') return escape(seed, { ...o, extreme: true });
  if (kind === 'gauntlet') return gauntlet(seed);
  if (kind === 'athletic-insane') return athletic(seed, { ...o, insane: true });
  if (kind === 'mixed') return mixed(seed, o);
  throw new Error(`知らない種類です: ${kind}（${KINDS.join(' | ')}）`);
}
