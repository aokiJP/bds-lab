// ブロック指定と範囲

// ---- ブロック指定 -----------------------------------------------------------

function blockSpec(tok, next) {
  let t = String(tok);
  // "oak_log ["pillar_axis"="x"]" のように空白を挟んでもよい
  if (next !== undefined && /^\[.*\]$/s.test(String(next)) && !t.includes('[')) { t += String(next); blockSpec.joined = true; } else blockSpec.joined = false;
  const m = /^([a-z0-9_:.]+)(\[(.*)\])?$/i.exec(t);
  if (!m) throw new Syntax(`ブロック ${t} が正しくありません`, t);
  const id = blockTypeId(m[1]) ?? blockTypeId(LEGACY[String(m[1]).replace(/^minecraft:/, '')] ?? '');
  if (!id) throw new Syntax(`Unknown block: ${m[1]}`, m[1]);
  let states;
  let used = 1;
  const body = m[3];
  if (body !== undefined) {
    states = {};
    for (const part of body.split(',').filter((x) => x.trim())) {
      // 状態の名前は、引用符で囲めば名前空間付き（"demo:level"）も書ける
      const kv = /^\s*(?:"([^"]+)"|([^"=:]+))\s*[=:]\s*(.+?)\s*$/.exec(part);
      if (!kv) throw new Syntax(`状態 ${part} が正しくありません`);
      let v = kv[3];
      if (/^".*"$/.test(v)) v = v.slice(1, -1);
      else if (v === 'true' || v === 'false') v = v === 'true';
      else if (/^-?\d+$/.test(v)) v = Number(v);
      states[(kv[1] ?? kv[2]).trim()] = v;
    }
  } else if (next !== undefined && /^-?\d+$/.test(String(next))) {
    // 旧式のデータ値。0 だけは受ける（既定の状態）
    if (Number(next) !== 0) throw new NotImpl('ブロックのデータ値');
    used = 2;
  }
  let perm;
  // 実測: 状態の値が不正でも構文エラーではなく「置けなかった」扱い
  try { perm = makePerm(id, states, { strict: true }); } catch (e) { throw new Failed(e.message); }
  if (blockSpec.joined) used = 2;
  return { perm, used };
}

// コマンドだけが受ける旧名（実機で planks が oak_planks になるのを確認）
const LEGACY = {
  planks: 'oak_planks', log: 'oak_log', log2: 'acacia_log', wool: 'white_wool', carpet: 'white_carpet',
  stained_glass: 'white_stained_glass', stained_glass_pane: 'white_stained_glass_pane', concrete: 'white_concrete',
  concrete_powder: 'white_concrete_powder', stained_hardened_clay: 'white_terracotta', hardened_clay: 'terracotta',
  leaves: 'oak_leaves', leaves2: 'acacia_leaves', sapling: 'oak_sapling', red_flower: 'poppy', yellow_flower: 'dandelion',
  tallgrass: 'short_grass', wooden_slab: 'oak_slab', stonebrick: 'stone_bricks', fence: 'oak_fence', grass: 'grass_block',
  monster_egg: 'infested_stone', coral_block: 'tube_coral_block', double_plant: 'sunflower',
};

const samePerm = (a, b) => a.id === b.id && Object.keys(b.states).every((k) => a.states[k] === b.states[k]);

function assertBox(dim, a, b) {
  const d = DIMS[dim];
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
  const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
  if (lo.y < d.min || hi.y >= d.max) throw new Failed('Cannot place blocks outside of the world');
  for (let cx = Math.floor(lo.x / 16); cx <= Math.floor(hi.x / 16); cx++) {
    for (let cz = Math.floor(lo.z / 16); cz <= Math.floor(hi.z / 16); cz++) {
      if (!chunkLoaded(dim, cx * 16, cz * 16)) throw new Failed('Cannot access blocks outside of the world');
    }
  }
  return { lo, hi, count: (hi.x - lo.x + 1) * (hi.y - lo.y + 1) * (hi.z - lo.z + 1) };
}
