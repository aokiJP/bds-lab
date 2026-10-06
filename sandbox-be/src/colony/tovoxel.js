// .mcworld の地形を voxel ワールド（src/play/worlds/voxel.js）が食える形に直す。
//
//   .mcworld → db/ を LevelDB として読む → サブチャンクを解く
//   → スポーン周りを切り出す → 同じブロックが続くところを箱にまとめる
//   → course.json の world.blocks
//
// 物理の表（data/player-physics.json）に無いブロックは voxel 側が inconclusive を
// 立てるので、ここでは勝手に置き換えない。何がいくつ未測定かだけ数えて返す。
// 「推測では埋めない」という本体の方針に合わせる。

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as Z from './zip.js';
import { openDb, parseChunkKey, TAG } from './leveldb.js';
import { decodeSubchunk, indexOf } from './subchunk.js';
import { parseLevelDat, summarize } from './nbt.js';

const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

/** .mcworld を一時ディレクトリに展開して db/ の場所を返す */
async function unpack(file) {
  const buf = await fs.readFile(file);
  const entries = Z.listEntries(buf);
  const lvl = entries.find((e) => /(^|\/)level\.dat$/i.test(e.name));
  if (!lvl) throw new Error('level.dat が無い');
  const root = lvl.name.slice(0, lvl.name.length - 'level.dat'.length);
  if (entries.some((e) => e.name.startsWith(root + 'region/'))) {
    throw new Error('Java版ワールド。先に colony convert で統合版にして');
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-world-'));
  try {
    // 地形に要るのは level.dat と db/ だけ（同梱パックや画像は展開しない）
    for (const e of entries) {
      if (e.dir || !e.name.startsWith(root)) continue;
      const rel = e.name.slice(root.length);
      if (rel !== 'level.dat' && !rel.startsWith('db/')) continue;
      const dest = Z.safeJoin(dir, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Z.readEntry(buf, e));
    }
    const level = summarize(parseLevelDat(await fs.readFile(path.join(dir, 'level.dat'))));
    return { dir, level };
  } catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw e; }
}

/** 切り出す範囲のチャンクのキーだけを覚える（大きなワールドでも、要る分だけ読む） */
const chunkKeep = ({ cx0, cx1, cz0, cz1, dimension }) => (key) => {
  const k = parseChunkKey(key.toString('hex'));
  return !!k && k.tag === TAG.SUBCHUNK && k.dim === dimension && k.x >= cx0 && k.x <= cx1 && k.z >= cz0 && k.z <= cz1;
};

/**
 * (x, z) の地面の高さ（いちばん上の空気でないブロックの 1 つ上）。level.dat の SpawnY が 32767（「地面に立たせる」の印）のとき使う。
 * そのチャンクが保存されていなければ null
 */
export function surfaceY(db, x, z, dimension = 0) {
  return surfaceOf(db, x, z, dimension);
}
/** (x, z) の地面。そのチャンクが保存されていなければ、保存されているいちばん近いチャンクの、(x, z) にいちばん近い列で → { y, x, z } */
export function surfaceNear(db, x, z, dimension = 0) {
  const own = surfaceOf(db, x, z, dimension);
  if (own != null) return { y: own, x, z };
  const cols = new Map();
  for (const hex of db.map.keys()) {
    const k = parseChunkKey(hex);
    if (k && k.tag === TAG.SUBCHUNK && k.dim === dimension) cols.set(`${k.x},${k.z}`, [k.x, k.z]);
  }
  const near = [...cols.values()].map(([cx, cz]) => {
    const px = Math.min(Math.max(x, cx * 16), cx * 16 + 15), pz = Math.min(Math.max(z, cz * 16), cz * 16 + 15);
    return { px, pz, d: Math.hypot(px - x, pz - z) };
  }).sort((a, b) => a.d - b.d);
  for (const c of near) { const y = surfaceOf(db, c.px, c.pz, dimension); if (y != null) return { y, x: c.px, z: c.pz }; }
  return null;
}
function surfaceOf(db, x, z, dimension) {
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16), lx = ((x % 16) + 16) % 16, lz = ((z % 16) + 16) % 16;
  const subs = [];
  for (const [hex, val] of db.map) {
    const k = parseChunkKey(hex);
    if (k && k.tag === TAG.SUBCHUNK && k.dim === dimension && k.x === cx && k.z === cz) subs.push([k.subY ?? 0, val]);
  }
  subs.sort((a, b) => b[0] - a[0]);
  for (const [subIdx, val] of subs) {
    let sc; try { sc = decodeSubchunk(val); } catch { continue; }
    const sy = (sc.yIndex ?? subIdx) * 16;
    if (sc.uniform) { if (!AIR.has(sc.uniform)) return sy + 16; continue; }
    if (!sc.blocks) continue;
    for (let ly = 15; ly >= 0; ly--) if (!AIR.has(sc.blocks[indexOf(lx, ly, lz)])) return sy + ly + 1;
  }
  return null;
}
const SPAWN_ON_SURFACE = (y) => y == null || y >= 32767 || y < -64 || y > 320;

/**
 * ワールドを読んでブロックの辞書を作る。
 *   center  切り出しの中心（既定はスポーン）
 *   radius  水平の半径（ブロック）
 *   height  上下の幅（中心から ±height/2）
 * → { blocks: Map<"x,y,z", {name,states}>, bounds, stats }
 */
export async function readRegion(dir, { center, radius = 48, height = 48, dimension = 0, db: given = null } = {}) {
  const cx0 = Math.floor((center.x - radius) / 16), cx1 = Math.floor((center.x + radius) / 16);
  const cz0 = Math.floor((center.z - radius) / 16), cz1 = Math.floor((center.z + radius) / 16);
  const db = given ?? await openDb(path.join(dir, 'db'), { keep: chunkKeep({ cx0, cx1, cz0, cz1, dimension }) });
  const y0 = Math.floor(center.y - height / 2), y1 = Math.floor(center.y + height / 2);

  const blocks = new Map();
  const stats = { subchunks: 0, decoded: 0, failed: 0, solid: 0, names: new Map(), errors: [] };

  for (const [hex, val] of db.map) {
    const k = parseChunkKey(hex);
    if (!k || k.tag !== TAG.SUBCHUNK || k.dim !== dimension) continue;
    if (k.x < cx0 || k.x > cx1 || k.z < cz0 || k.z > cz1) continue;
    stats.subchunks++;

    let sc;
    try { sc = decodeSubchunk(val); stats.decoded++; }
    catch (e) {
      stats.failed++;
      if (stats.errors.length < 5) stats.errors.push(e.message);
      continue;
    }

    const subY = (sc.yIndex ?? k.subY ?? 0) * 16;
    if (subY + 15 < y0 || subY > y1) continue;

    if (sc.uniform) {
      if (AIR.has(sc.uniform)) continue;
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) for (let ly = 0; ly < 16; ly++) {
        const x = k.x * 16 + lx, y = subY + ly, z = k.z * 16 + lz;
        if (y < y0 || y > y1) continue;
        if (Math.abs(x - center.x) > radius || Math.abs(z - center.z) > radius) continue;
        blocks.set(`${x},${y},${z}`, { name: sc.uniform, states: null });
        stats.solid++;
        stats.names.set(sc.uniform, (stats.names.get(sc.uniform) ?? 0) + 1);
      }
      continue;
    }
    if (!sc.blocks) continue;

    for (let lx = 0; lx < 16; lx++) {
      const x = k.x * 16 + lx;
      if (Math.abs(x - center.x) > radius) continue;
      for (let lz = 0; lz < 16; lz++) {
        const z = k.z * 16 + lz;
        if (Math.abs(z - center.z) > radius) continue;
        for (let ly = 0; ly < 16; ly++) {
          const y = subY + ly;
          if (y < y0 || y > y1) continue;
          const name = sc.blocks[indexOf(lx, ly, lz)];
          if (!name || AIR.has(name)) continue;
          blocks.set(`${x},${y},${z}`, { name, states: sc.states?.[indexOf(lx, ly, lz)] ?? null });
          stats.solid++;
          stats.names.set(name, (stats.names.get(name) ?? 0) + 1);
        }
      }
    }
  }

  return {
    blocks,
    bounds: { x: [center.x - radius, center.x + radius], y: [y0, y1], z: [center.z - radius, center.z + radius] },
    stats, db: { tables: db.tables, logs: db.logs, entries: db.entries, problems: db.problems },
  };
}

/**
 * ブロックの辞書を [{from,to,type}] に畳む。
 * x → z → y の順に同じ種類が続くところを 1 本の箱にする（素直な走査で十分縮む）。
 */
export function toRuns(blocks, origin) {
  const key = (x, y, z) => `${x},${y},${z}`;
  const used = new Set();
  const runs = [];
  const sorted = [...blocks.keys()].map((k) => k.split(',').map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);

  for (const [x, y, z] of sorted) {
    const k = key(x, y, z);
    if (used.has(k)) continue;
    const b = blocks.get(k);
    const same = (kk) => { const o = blocks.get(kk); return o && o.name === b.name
      && JSON.stringify(o.states ?? null) === JSON.stringify(b.states ?? null) && !used.has(kk); };

    // x 方向に伸ばす
    let x1 = x;
    while (same(key(x1 + 1, y, z))) x1++;
    // その帯を z 方向に伸ばせるだけ伸ばす
    let z1 = z;
    outer: for (;;) {
      for (let xx = x; xx <= x1; xx++) if (!same(key(xx, y, z1 + 1))) break outer;
      z1++;
    }
    // さらに y 方向
    let y1 = y;
    outer2: for (;;) {
      for (let xx = x; xx <= x1; xx++) for (let zz = z; zz <= z1; zz++) if (!same(key(xx, y1 + 1, zz))) break outer2;
      y1++;
    }
    for (let xx = x; xx <= x1; xx++) for (let yy = y; yy <= y1; yy++) for (let zz = z; zz <= z1; zz++) used.add(key(xx, yy, zz));

    const run = {
      from: { x: x - origin.x, y: y - origin.y, z: z - origin.z },
      to: { x: x1 - origin.x, y: y1 - origin.y, z: z1 - origin.z },
      type: b.name,
    };
    if (b.states) run.states = b.states;
    runs.push(run);
  }
  return runs;
}

/** 物理の表にあるブロックか調べ、未測定のものを数える */
export function checkKnown(names, profile) {
  const known = [], unknown = [];
  for (const [name, count] of names) {
    const key = name.includes(':') ? name : `minecraft:${name}`;
    (profile.blocks?.[key] ? known : unknown).push([name, count]);
  }
  unknown.sort((a, b) => b[1] - a[1]);
  known.sort((a, b) => b[1] - a[1]);
  return { known, unknown };
}

/**
 * クリア条件の候補を探す。
 * 配布ワールドのゴールは目立つブロックで作られていることが多い。
 * 見つけたものを「候補」として出すだけで、勝手に goal.reach にはしない。
 */
const GOAL_HINTS = [
  'minecraft:gold_block', 'minecraft:diamond_block', 'minecraft:emerald_block',
  'minecraft:beacon', 'minecraft:end_portal', 'minecraft:end_portal_frame',
  'minecraft:lodestone', 'minecraft:bell', 'minecraft:respawn_anchor',
];
export function findGoalCandidates(blocks, origin, center) {
  const found = [];
  for (const [k, b] of blocks) {
    if (!GOAL_HINTS.includes(b.name)) continue;
    const [x, y, z] = k.split(',').map(Number);
    found.push({
      type: b.name,
      at: { x, y, z },
      rel: { x: x - origin.x, y: y - origin.y, z: z - origin.z },
      dist: Math.hypot(x - center.x, y - center.y, z - center.z),
    });
  }
  found.sort((a, b) => b.dist - a.dist);   // 遠いものほどゴールらしい
  return found.slice(0, 12);
}

/**
 * .mcworld → course.json（world.blocks 入り）
 */
export async function buildCourse(file, {
  radius = 48, height = 48, dimension = 0, profile, post = null, packs = [], name,
} = {}) {
  const { dir, level } = await unpack(file);
  try {
    const spawn = {
      x: level.spawn?.[0] ?? 0,
      y: level.spawn?.[1] ?? 64,
      z: level.spawn?.[2] ?? 0,
    };
    const cx0 = Math.floor((spawn.x - radius) / 16), cx1 = Math.floor((spawn.x + radius) / 16);
    const cz0 = Math.floor((spawn.z - radius) / 16), cz1 = Math.floor((spawn.z + radius) / 16);
    const db = await openDb(path.join(dir, 'db'), { keep: chunkKeep({ cx0, cx1, cz0, cz1, dimension }) });
    // SpawnY 32767 は「地面の上に立たせる」の印: 本当の高さを地形から読む
    let spawnNote = null;
    if (SPAWN_ON_SURFACE(spawn.y)) {
      const s = surfaceNear(db, spawn.x, spawn.z, dimension);
      spawnNote = { levelDat: spawn.y, y: s?.y ?? null, column: s ? { x: s.x, z: s.z } : null };   // 32767: 「地面の上に立たせる」の印
      spawn.y = s?.y ?? 64;
    }
    const region = await readRegion(dir, { center: spawn, radius, height, dimension, db });

    // 原点はスポーンの足元。voxel の既定（8,-60,8）に合わせず、実際の座標を使う
    const origin = { x: spawn.x, y: spawn.y, z: spawn.z };
    const runs = toRuns(region.blocks, origin);
    const { known, unknown } = profile ? checkKnown(region.stats.names, profile) : { known: [], unknown: [] };
    const goals = findGoalCandidates(region.blocks, origin, spawn);

    const course = {
      name: name ?? level.name ?? path.basename(file),
      description: `${path.basename(file)} から取り込んだ地形（スポーン中心 半径${radius} 高さ${height}）`,
      source: post ? { site: 'minecraft-mcworld.com', post: post.id, url: post.url, author: post.author?.name ?? null } : { file },
      world: {
        kind: 'voxel',
        origin,
        ground: 'void',              // 切り出した外は空。落ちたら失敗になる
        spawn: { x: 0.5, y: 1, z: 0.5 },
        yaw: 0,
        blocks: runs,
      },
      packs: packs.filter((p) => p.kind === 'behavior').map((p) => ({ name: p.name, dir: p.dir, entry: p.entry })),
      goal: {
        avoid: { path: 'player.y', lt: -Math.floor(height / 2) + 1 },   // 切り出しの下に落ちたら失敗
        deadline: null,
        reach: null,
      },
      import: {
        level,
        radius, height, dimension,
        blocks: region.stats.solid,
        runs: runs.length,
        subchunks: { total: region.stats.subchunks, decoded: region.stats.decoded, failed: region.stats.failed },
        db: region.db,
        unknownBlocks: unknown.slice(0, 30),
        knownTop: known.slice(0, 10),
        goalCandidates: goals,
        errors: region.stats.errors,
        ...(spawnNote ? { spawn: spawnNote } : {}),
      },
      _note: 'goal.reach は未設定。import.goalCandidates から選ぶか、自分で条件を書く。',
    };
    return course;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
