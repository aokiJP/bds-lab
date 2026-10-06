// 拡張: レイキャスト

// ---- レイキャスト（ブロックは 1 マスの立方体として扱う） --------------------------------
const PASSABLE = /(^minecraft:air$|^minecraft:light_block)/;
// 当たり判定が 1 マスより細いもの（実測: short_grass は x/z が 0.15 内側）。ほかの細い形は 1 マス扱い（近似）
const INSET = { 'minecraft:short_grass': 0.15, 'minecraft:fern': 0.15 };
const LIQUID = /(^|_)(water|lava)$/;
/**
 * ブロックのレイキャスト（BDS で実測した規則）
 *   - 方向が 0 なら undefined
 *   - maxDistance は「始点からブロックの中心まで」と比べる
 *   - 始点がブロックの中にあれば、そのブロックに当たる（面は進行方向の出口）
 *   - faceLocation は当たった点（float32）の小数部
 */
const EXIT = { x: [ 'East', 'West' ], y: ['Up', 'Down'], z: ['South', 'North'] };
const ENTER = { x: ['West', 'East'], y: ['Down', 'Up'], z: ['North', 'South'] };
function rayBlock(dim, from, dir, o = {}) {
  const len = $Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (!len) return undefined;
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const max = o.maxDistance ?? 64;
  let x = $Math.floor(from.x); let y = $Math.floor(from.y); let z = $Math.floor(from.z);
  const step = { x: $Math.sign(d.x), y: $Math.sign(d.y), z: $Math.sign(d.z) };
  const tDelta = { x: d.x ? $Math.abs(1 / d.x) : Infinity, y: d.y ? $Math.abs(1 / d.y) : Infinity, z: d.z ? $Math.abs(1 / d.z) : Infinity };
  const frac = (v, sg) => (sg > 0 ? $Math.floor(v) + 1 - v : v - $Math.floor(v));
  const tMax = { x: d.x ? frac(from.x, step.x) * tDelta.x : Infinity, y: d.y ? frac(from.y, step.y) * tDelta.y : Infinity, z: d.z ? frac(from.z, step.z) * tDelta.z : Infinity };
  const nextAxis = () => (tMax.x < tMax.y && tMax.x < tMax.z ? 'x' : tMax.y < tMax.z ? 'y' : 'z');
  let t = 0;
  let face = null;
  const bounds = DIMS[dim];
  const fracOf = (v) => { const fv = F(v); return F(fv - $Math.floor(fv)); };
  for (let i = 0; i < 4096; i++) {
    const center = $Math.sqrt((x + 0.5 - from.x) ** 2 + (y + 0.5 - from.y) ** 2 + (z + 0.5 - from.z) ** 2);
    if (center > max && i > 0) return undefined;
    if (y < bounds.min || y >= bounds.max || !chunkLoaded(dim, x, z)) return undefined;
    const b = readBlock(dim, x, y, z);
    const liquid = LIQUID.test(b.id);
    const passable = PASSABLE.test(b.id);
    const hit = b.id !== 'minecraft:air' && (!liquid || o.includeLiquidBlocks) && (!passable || o.includePassableBlocks) && matchFilter(b, o);
    let inset = hit ? INSET[b.id] : 0;
    if (hit && inset) {
      // 細い箱との交差を調べる
      const lo = { x: x + inset, y, z: z + inset };
      const hi = { x: x + 1 - inset, y: y + 1, z: z + 1 - inset };
      let t0 = 0; let t1 = Infinity; let ax0 = null;
      for (const k of ['x', 'y', 'z']) {
        if (!d[k]) { if (from[k] < lo[k] || from[k] > hi[k]) { t0 = Infinity; break; } continue; }
        let a1 = (lo[k] - from[k]) / d[k];
        let a2 = (hi[k] - from[k]) / d[k];
        if (a1 > a2) [a1, a2] = [a2, a1];
        if (a1 > t0) { t0 = a1; ax0 = k; }
        t1 = $Math.min(t1, a2);
      }
      if (t0 <= t1 && t0 !== Infinity) {
        const p = { x: from.x + d.x * t0, y: from.y + d.y * t0, z: from.z + d.z * t0 };
        const f = ax0 ? ENTER[ax0][step[ax0] > 0 ? 0 : 1] : face;
        return { block: blockObj(dim, { x, y, z }), face: f, faceLocation: { x: fracOf(p.x), y: fracOf(p.y), z: fracOf(p.z) } };
      }
      inset = -1;
    }
    if (hit && inset !== -1) {
      let tt = t;
      let f = face;
      if (i === 0) { const ax = nextAxis(); tt = tMax[ax]; f = EXIT[ax][step[ax] > 0 ? 0 : 1]; }
      const p = { x: from.x + d.x * tt, y: from.y + d.y * tt, z: from.z + d.z * tt };
      return { block: blockObj(dim, { x, y, z }), face: f, faceLocation: { x: fracOf(p.x), y: fracOf(p.y), z: fracOf(p.z) } };
    }
    const ax = nextAxis();
    if (ax === 'x') { x += step.x; } else if (ax === 'y') { y += step.y; } else { z += step.z; }
    t = tMax[ax];
    tMax[ax] += tDelta[ax];
    face = ENTER[ax][step[ax] > 0 ? 0 : 1];
  }
  return undefined;
}
// エンティティの当たり判定は 0.1 広げ、座標は float32 で比べる（距離の実測値から逆算）
const PICK = 0.1;
function rayEntities(dim, from, dir, o = {}, self = null) {
  const len = $Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (!len) return [];
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const max = o.maxDistance ?? 64;
  let limit = max;
  if (!o.ignoreBlockCollision) {
    const b = rayBlock(dim, from, d, { maxDistance: max, includeLiquidBlocks: o.includeLiquidBlocks, includePassableBlocks: o.includePassableBlocks });
    if (b) {
      const p = H.get(b.block).p;
      const c = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
      limit = $Math.min(limit, $Math.sqrt((c.x - from.x) ** 2 + (c.y - from.y) ** 2 + (c.z - from.z) ** 2));
    }
  }
  const out = [];
  for (const e of query(o, { dim })) {
    if (e === self) continue;
    const ex = extentOf(e);
    const lo = { x: F(e.loc.x - ex.x - PICK), y: F(e.loc.y - PICK), z: F(e.loc.z - ex.z - PICK) };
    const hi = { x: F(e.loc.x + ex.x + PICK), y: F(e.loc.y + ex.y * 2 + PICK), z: F(e.loc.z + ex.z + PICK) };
    let tmin = 0; let tmax = limit;
    let ok = true;
    for (const k of ['x', 'y', 'z']) {
      if ($Math.abs(d[k]) < 1e-12) { if (from[k] < lo[k] || from[k] > hi[k]) { ok = false; break; } continue; }
      let t1 = (lo[k] - from[k]) / d[k];
      let t2 = (hi[k] - from[k]) / d[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = $Math.max(tmin, t1);
      tmax = $Math.min(tmax, t2);
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok) out.push({ entity: entityObj(e), distance: tmin });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
$Object.assign(IMPL.Dimension.fns, {
  getBlockFromRay: (h, loc, dir, o) => rayBlock(h.dim, loc, dir, o),
  getEntitiesFromRay: (h, loc, dir, o) => rayEntities(h.dim, loc, dir, o),
  cloneBlocks(h, a, b, dest, mode, filter) {
    const lo = { x: $Math.min($Math.floor(a.x), $Math.floor(b.x)), y: $Math.min($Math.floor(a.y), $Math.floor(b.y)), z: $Math.min($Math.floor(a.z), $Math.floor(b.z)) };
    const hi = { x: $Math.max($Math.floor(a.x), $Math.floor(b.x)), y: $Math.max($Math.floor(a.y), $Math.floor(b.y)), z: $Math.max($Math.floor(a.z), $Math.floor(b.z)) };
    const off = { x: $Math.floor(dest.x) - lo.x, y: $Math.floor(dest.y) - lo.y, z: $Math.floor(dest.z) - lo.z };
    const pts = [];
    for (let x = lo.x; x <= hi.x; x++) for (let y = lo.y; y <= hi.y; y++) for (let z = lo.z; z <= hi.z; z++) {
      if (!chunkLoaded(h.dim, x, z) || !chunkLoaded(h.dim, x + off.x, z + off.z)) throw fail('UnloadedChunksError', '未読み込みの区画があります');
      const bk = readBlock(h.dim, x, y, z);
      if (filter && !matchFilter(bk, filter)) continue;
      pts.push([x, y, z, bk]);
    }
    const overlap = ['x', 'y', 'z'].every((k) => lo[k] <= hi[k] + off[k] && lo[k] + off[k] <= hi[k]);
    if (overlap && mode === 'Normal') throw fail('Error', '元と先が重なっています（CloneMode.Force を使ってください）');
    if (mode === 'Move') for (const [x, y, z] of pts) writeBlock(h.dim, x, y, z, makePerm('minecraft:air'));
    for (const [x, y, z, bk] of pts) writeBlock(h.dim, x + off.x, y + off.y, z + off.z, bk);
  },
  getBiome(h, loc) {
    checkLoc(h.dim, loc);
    const id = GEN === 'flat' && h.dim === 'minecraft:overworld' ? 'minecraft:plains' : { 'minecraft:nether': 'minecraft:hell', 'minecraft:the_end': 'minecraft:the_end', 'minecraft:overworld': 'minecraft:plains' }[h.dim];
    return biomeObj(id);
  },
  containsBiomes(h, volume, filter) {
    const id = this.getBiome(volumeOf(H.get(volume)).lo ?? { x: 0, y: 0, z: 0 }).id;
    const inc = (filter.includeBiomes ?? []).map((b) => (typeof b === 'string' ? b : b.id));
    const exc = (filter.excludeBiomes ?? []).map((b) => (typeof b === 'string' ? b : b.id));
    return (!inc.length || inc.includes(id)) && !exc.includes(id);
  },
  // 実機で測った結果: 探す場所から x と z をそれぞれ 32 引いた点が返る（5 か所で確認）。
  // その生態系がその世界に無いとき（フラットの平原しか無い世界での海など）と、
  // 生態系の名前が違うときは undefined
  calculateClosestBiomeFromSeed(h, loc, biomeToFind, options) {
    void options;
    const here = GEN === 'flat' && h.dim === 'minecraft:overworld' ? 'minecraft:plains' : { 'minecraft:nether': 'minecraft:hell', 'minecraft:the_end': 'minecraft:the_end', 'minecraft:overworld': 'minecraft:plains' }[h.dim];
    const want = typeof biomeToFind === 'string' ? biomeToFind : biomeToFind?.id;
    if (here !== fullId(want)) return undefined;
    return { z: F(F(loc.z) - 32), y: F(loc.y), x: F(F(loc.x) - 32) };
  },
  // 実機の戻り値とエラーだけを合わせている。サンドボックスには地形生成が無いので、
  // ブロックは実際には置かれない（報告の unsupported に出る）
  placeFeature(h, featureName, location, shouldThrow) {
    void shouldThrow;
    const id = fullId(featureName);
    if (!FEATURES.has(id)) throw fail('InvalidArgumentError', `Invalid value passed to argument [0]. Feature name ${featureName} cannot be found in the registry`);
    checkLoc(h.dim, location);
    bump(S.unsupported, 'Dimension.placeFeature（戻り値だけ実機どおり。ブロックは置かれません）');
    S.effects.push({ tick: S.tick, kind: 'placeFeature', dimension: h.dim, feature: id, location: Vec(location) });
    return true;
  },
  placeFeatureRule(h, featureRuleName, location) {
    const id = fullId(featureRuleName);
    if (!FEATURE_RULES.has(id)) throw fail('InvalidArgumentError', `Invalid value passed to argument [0]. Feature rule ${featureRuleName} cannot be found`);
    checkLoc(h.dim, location);
    S.effects.push({ tick: S.tick, kind: 'placeFeatureRule', dimension: h.dim, rule: id, location: Vec(location) });
    return false; // 実機もフラットな場所では置けずに false
  },
  getLightLevel: ni('dimension.getLightLevel（光の伝播は再現していません）'),
  getSkyLightLevel: ni('dimension.getSkyLightLevel（光の伝播は再現していません）'),
});
$Object.assign(IMPL.Block.fns, {
  getLightLevel: ni('block.getLightLevel（光の伝播は再現していません）'),
  getSkyLightLevel: ni('block.getSkyLightLevel（光の伝播は再現していません）'),
  // 実測: 動力の通っていない世界では undefined（レッドストーンの伝わり方は再現していない）
  getRedstonePower: (h) => { assertLoaded(h); return undefined; },
  getParts: ni('block.getParts'),
  isLiquidBlocking: ni('block.isLiquidBlocking'),
  canContainLiquid: ni('block.canContainLiquid'),
  canBeDestroyedByLiquidSpread: ni('block.canBeDestroyedByLiquidSpread'),
  liquidCanFlowFromDirection: ni('block.liquidCanFlowFromDirection'),
  liquidSpreadCausesSpawn: ni('block.liquidSpreadCausesSpawn'),
});
IMPL.Block.get.redstonePower = ni('block.redstonePower（レッドストーンは再現していません）');
$Object.assign(IMPL.BlockPermutation.fns, {
  isLiquidBlocking: ni('blockPermutation.isLiquidBlocking'),
  canContainLiquid: ni('blockPermutation.canContainLiquid'),
  canBeDestroyedByLiquidSpread: ni('blockPermutation.canBeDestroyedByLiquidSpread'),
  isPartOfLiquidRendering: ni('blockPermutation.isPartOfLiquidRendering'),
  liquidSpreadCausesSpawn: ni('blockPermutation.liquidSpreadCausesSpawn'),
  getTags: (h) => [...(blockTags(h.perm.id) ?? NI(`blockPermutation.getTags（${h.perm.id}）`))],
  hasTag: (h, t) => (blockTags(h.perm.id) ?? NI(`blockPermutation.hasTag（${h.perm.id}）`)).includes(t),
});
const blockOf = (h) => { assertLoaded(h); return readBlock(h.dim, h.p.x, h.p.y, h.p.z); };
IMPL.Block.fns.getTags = (h) => [...(blockTags(blockOf(h).id) ?? NI('block.getTags'))];
IMPL.Block.fns.hasTag = (h, t) => (blockTags(blockOf(h).id) ?? NI('block.hasTag')).includes(t);
const liquid = (id, i) => { const l = M.blocks[id]?.liquid; if (!l || l.error) return NI(`液体の性質（${id}）`); return l[i]; };
$Object.assign(IMPL.BlockPermutation.fns, {
  canContainLiquid: (h) => liquid(h.perm.id, 0),
  isLiquidBlocking: (h) => liquid(h.perm.id, 1),
  canBeDestroyedByLiquidSpread: (h) => liquid(h.perm.id, 2),
});
$Object.assign(IMPL.Block.fns, {
  canContainLiquid: (h) => liquid(blockOf(h).id, 0),
  isLiquidBlocking: (h) => liquid(blockOf(h).id, 1),
  canBeDestroyedByLiquidSpread: (h) => liquid(blockOf(h).id, 2),
});
const tileKey = (id) => M.blocks[id]?.key ?? `tile.${id.slice(10)}.name`;
IMPL.BlockPermutation.get.localizationKey = (h) => M.blocks[h.perm.id]?.pkey ?? tileKey(h.perm.id);
IMPL.BlockType.get.localizationKey = (h) => tileKey(h.id);
IMPL.Block.get.localizationKey = (h) => tileKey(blockOf(h).id);
IMPL.ItemType.get.localizationKey = (h) => M.items[h.id]?.key ?? `item.${h.id.slice(10)}.name`;
IMPL.ItemStack.get.localizationKey = (h) => M.items[h.it.typeId]?.ikey ?? M.items[h.it.typeId]?.key ?? `item.${h.it.typeId.slice(10)}.name`;
IMPL.Entity.get.localizationKey = (h) => M.entities[h.e.typeId]?.key ?? `entity.${h.e.typeId.slice(10)}.name`;
IMPL.BlockVolumeBase.fns.getClosest = (h, count, loc) => [...volumeIter(h)].sort((a, b) => dist2(a, loc) - dist2(b, loc)).slice(0, count);
IMPL.BlockVolumeBase.fns.getFarthest = (h, count, loc) => [...volumeIter(h)].sort((a, b) => dist2(b, loc) - dist2(a, loc)).slice(0, count);
const dist2 = (a, b) => (a.x + 0.5 - b.x) ** 2 + (a.y + 0.5 - b.y) ** 2 + (a.z + 0.5 - b.z) ** 2;
