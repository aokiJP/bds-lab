// 全ブロックでないブロックの当たり判定の形（ブロックの中の相対座標 [minX, minY, minZ, maxX, maxY, maxZ]）。
//
// どの形も実機で測ったシナリオ（test/physics/scenarios.js の slab_* / stairs_* / fence_* / carpet_* / soul_sand_* /
// ladder_*）で確かめてあります。測っていない向き・状態・つながり方に出会ったら why を返し、呼ぶ側が issues に積みます
// （推測で形を埋めない）。数はどれも 2 の累乗の分数なので float32 でもちょうど表せます。
//
// data/player-physics.json の blocks[*].shape がこの表の名前です。

const FULL = [[0, 0, 0, 1, 1, 1]];
const HALF_LO = [0, 0, 0, 1, 0.5, 1];
const HALF_HI = [0, 0.5, 0, 1, 1, 1];

/** 階段の上の段（weirdo_direction → 高い側）。0 = +x、1 = −x、2 = +z、3 = −z（実機: stairs_dir0〜3） */
const STAIR_STEP = {
  0: [0.5, 0, 0, 1, 1, 1],
  1: [0, 0, 0, 0.5, 1, 1],
  2: [0, 0, 0.5, 1, 1, 1],
  3: [0, 0, 0, 1, 1, 0.5],
};
/** はしごの板（facing_direction → 張り付いている面）。厚さ 3/16（実機: ladder_climb で z = 2.5125 に止まる） */
const LADDER = {
  2: [0, 0, 13 / 16, 1, 1, 1],
  3: [0, 0, 0, 1, 1, 3 / 16],
  4: [13 / 16, 0, 0, 1, 1, 1],
  5: [0, 0, 0, 3 / 16, 1, 1],
};
const FENCE_POST = [0.375, 0, 0.375, 0.625, 1.5, 0.625];
const FENCE_ARM = { // つながる向き → 腕
  '-x': [0, 0, 0.375, 0.375, 1.5, 0.625],
  '+x': [0.625, 0, 0.375, 1, 1.5, 0.625],
  '-z': [0.375, 0, 0, 0.625, 1.5, 0.375],
  '+z': [0.375, 0, 0.625, 0.625, 1.5, 1],
};

/** 状態に依らない形（ブロックの情報ごとに 1 回だけ作る）。{ boxes } か { boxes: null, why }、つながりで変わるなら { dynamic } */
export function staticShape(info) {
  const st = info.states ?? {};
  switch (info.shape ?? 'full') {
    case 'full': return { boxes: FULL };
    case 'slab': {
      const h = st['minecraft:vertical_half'] ?? 'bottom';
      if (h === 'bottom') return { boxes: [HALF_LO] };
      if (h === 'top') return { boxes: [HALF_HI] };
      return { boxes: FULL, why: `${info.id} の vertical_half=${h} は実機で測っていません` };
    }
    case 'stairs': {
      const d = Number(st.weirdo_direction ?? 0);
      const up = Boolean(st.upside_down_bit);
      const step = STAIR_STEP[d];
      if (!step) return { boxes: FULL, why: `${info.id} の weirdo_direction=${d} は実機で測っていません` };
      const base = up ? HALF_HI : HALF_LO;
      const s = up ? [step[0], 0, step[2], step[3], 0.5, step[5]] : [step[0], 0.5, step[2], step[3], 1, step[5]];
      return { boxes: [base, s], stairs: { d, up } };
    }
    case 'honey': return { boxes: [[0.0625, 0, 0.0625, 0.9375, 1, 0.9375]] }; // 横は 1/16 内側、上は 1（実機: honey_wall_walk で z = 2.7625、honey_walk で y = 1）
    case 'carpet': return { boxes: [[0, 0, 0, 1, 0.0625, 1]] };
    case 'soul_sand': return { boxes: [[0, 0, 0, 1, 0.875, 1]] };
    case 'ladder': {
      const f = Number(st.facing_direction ?? 2);
      if (!LADDER[f]) return { boxes: [], why: `${info.id} の facing_direction=${f} は実機で測っていません` };
      return { boxes: [LADDER[f]] };
    }
    case 'fence': return { boxes: null, dynamic: 'fence' };
    default: return { boxes: FULL, why: `${info.id} の形（${info.shape}）はサンドボックスにありません` };
  }
}

/**
 * 柵の形。つながるのは隣の柵と、隣の全ブロック（実機: fence_line_z_side / fence_to_stone_top）。
 * neighbor(dx, dz) → 隣のブロックの情報（空気は null）
 */
export function fenceBoxes(neighbor) {
  const out = [FENCE_POST];
  for (const [k, dx, dz] of [['-x', -1, 0], ['+x', 1, 0], ['-z', 0, -1], ['+z', 0, 1]]) {
    const n = neighbor(dx, dz);
    if (!n || n.unknown) continue;
    if (n.shape === 'fence' || (n.shape ?? 'full') === 'full') out.push(FENCE_ARM[k]);
  }
  return out;
}

/**
 * 見て分かるコースの形（学習する頭 src/play/agent/map.js が使う。bds-lab では別配布の bds-lab-extras）の表: 種類 → 形の名前。
 * data/player-physics.json の blocks[*].shape と同じ（上流の test/agent.test.js が突き合わせる）。ここに無い種類は全ブロック扱い（物理の側では「測っていない」として inconclusive になる）
 */
export const SHAPE_OF = {
  smooth_stone_slab: 'slab', oak_stairs: 'stairs', oak_fence: 'fence', white_carpet: 'carpet',
  soul_sand: 'soul_sand', honey_block: 'honey', ladder: 'ladder',
};
/** 上に立てる面の高さ（ブロックの底から）。立てないもの（はしご）は null。climbable ははしご */
export function surfaceOf(type, states = {}) {
  const t = String(type).replace(/^minecraft:/, '');
  const sh = SHAPE_OF[t] ?? 'full';
  if (sh === 'ladder') return { h: null, climbable: true, facing: Number(states.facing_direction ?? 2) };
  if (sh === 'fence') return { h: 1.5 };
  if (sh === 'slab') return { h: (states['minecraft:vertical_half'] ?? 'bottom') === 'top' ? 1 : 0.5 };
  if (sh === 'carpet') return { h: 0.0625 };
  if (sh === 'soul_sand') return { h: 0.875 };
  return { h: 1 };
}
