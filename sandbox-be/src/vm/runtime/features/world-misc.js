// 拡張: 種類の一覧・GameRules・天気・爆発・ティッキングエリア

// ---- 種類の一覧 ----------------------------------------------------------------
const typeCache = {};
const typed = (cls, id) => { typeCache[`${cls}|${id}`] ??= { id }; return once(cls, typeCache[`${cls}|${id}`]); };
const biomeObj = (id) => typed('BiomeType', id);
const ENCH_MAX = {
  protection: 4, fire_protection: 4, feather_falling: 4, blast_protection: 4, projectile_protection: 4, thorns: 3, respiration: 3,
  depth_strider: 3, aqua_affinity: 1, sharpness: 5, smite: 5, bane_of_arthropods: 5, knockback: 2, fire_aspect: 2, looting: 3,
  efficiency: 5, silk_touch: 1, unbreaking: 3, fortune: 3, power: 5, punch: 2, flame: 1, infinity: 1, luck_of_the_sea: 3, lure: 3,
  frost_walker: 2, mending: 1, binding: 1, vanishing: 1, impaling: 5, riptide: 3, loyalty: 3, channeling: 1, multishot: 1,
  piercing: 4, quick_charge: 3, soul_speed: 3, swift_sneak: 3, wind_burst: 3, density: 5, breach: 4, lunge: 3,
};
const enchId = (v) => { const sh = $String(v).replace(/^minecraft:/, ''); return VANILLA.enchantments.includes(`minecraft:${sh}`) || M.enchantments[sh] !== undefined ? sh : null; };
const STATE_VALUES = (() => {
  const m = {};
  for (const def of $Object.values(VANILLA.blocks)) for (const [k, vals] of $Object.entries(def)) { m[k] ??= new $Set(); for (const v of vals) m[k].add(v); }
  // 実測の状態一覧（1.26.51.1）。メタデータ（1.26.50.4）より新しいので、こちらを優先する
  for (const [k, vals] of $Object.entries(M.states ?? {})) { m[k] = new $Set(vals); }
  return m;
})();
$Object.assign(IMPL, {
  DimensionTypes: { static: { get: (h, id) => { const d = dimId(id); return d ? typed('DimensionType', d) : undefined; }, getAll: () => $Object.keys(DIMS).map((d) => typed('DimensionType', d)) } },
  DimensionType: { get: { typeId: (h) => h.id } },
  EffectTypes: { static: { get: (h, id) => { const e = effectId(id); return e ? typed('EffectType', e) : undefined; }, getAll: () => (M.effects.length ? M.effects : VANILLA.effects).map((e) => typed('EffectType', e)) } },
  EffectType: { fns: { getName: (h) => h.id } },
  EnchantmentTypes: { static: { get: (h, id) => { const e = enchId(id); return e ? typed('EnchantmentType', e) : undefined; }, getAll: () => ($Object.keys(M.enchantments).length ? $Object.keys(M.enchantments) : VANILLA.enchantments.map((e) => e.slice(10))).map((e) => typed('EnchantmentType', e)) } },
  EnchantmentType: {
    ctor(id) { const e = enchId(id); if (!e) throw fail('EnchantmentTypeUnknownIdError', `エンチャント ${id} はありません`); return { id: e }; },
    get: { id: (h) => h.id, maxLevel: (h) => M.enchantments[h.id.slice(10)] ?? M.enchantments[h.id] ?? ENCH_MAX[h.id.slice(10)] ?? NI(`EnchantmentType.maxLevel（${h.id}）`) },
  },
  BiomeTypes: { static: { get: (h, id) => { const f = $String(id).includes(':') ? $String(id) : `minecraft:${id}`; return VANILLA.biomes.includes(f) ? biomeObj(f) : undefined; }, getAll: () => VANILLA.biomes.map(biomeObj) } },
  BiomeType: {
    get: { id: (h) => h.id },
    fns: {
      getTags: (h) => [...(M.biomes[h.id] ?? NI(`biomeType.getTags（${h.id}）`))],
      hasTags: (h, tags) => { const own = M.biomes[h.id] ?? NI(`biomeType.hasTags（${h.id}）`); return tags.every((t) => own.includes(t)); },
    },
  },
  BlockStates: { static: { get: (h, n) => (STATE_VALUES[n] ? typed('BlockStateType', n) : undefined), getAll: () => $Object.keys(STATE_VALUES).map((n) => typed('BlockStateType', n)) } },
  BlockStateType: { get: { id: (h) => h.id, validValues: (h) => [...STATE_VALUES[h.id]] } },
  EntityType: { get: { id: (h) => h.data.id, localizationKey: (h) => `entity.${h.data.id.slice(10)}.name` } },
});

// ---- GameRules ---------------------------------------------------------------
const RULE_DEFAULTS = {
  commandBlockOutput: true, commandBlocksEnabled: true, doDayLightCycle: true, doEntityDrops: true, doFireTick: true,
  doImmediateRespawn: false, doInsomnia: true, doLimitedCrafting: false, doMobLoot: true, doMobSpawning: true, doTileDrops: true,
  doWeatherCycle: true, drowningDamage: true, fallDamage: true, fireDamage: true, freezeDamage: true, functionCommandLimit: 10000,
  keepInventory: false, locatorBar: true, maxCommandChainLength: 65535, mobGriefing: true, naturalRegeneration: true,
  playersSleepingPercentage: 100, projectilesCanBreakBlocks: true, pvp: true, randomTickSpeed: 1, recipesUnlock: true,
  respawnBlocksExplode: true, sendCommandFeedback: true, showBorderEffect: true, showCoordinates: false, showDaysPlayed: false,
  showDeathMessages: true, showRecipeMessages: true, showTags: true, spawnRadius: 10, tntExplodes: true, tntExplosionDropDecay: false,
};
$Object.assign(RULE_DEFAULTS, M.gamerules ?? {});
for (const [k, v] of $Object.entries(RULE_DEFAULTS)) if (G.gameRules[k] === undefined) G.gameRules[k] = v;
function setRule(k, v) {
  if (G.gameRules[k] === v) return;
  G.gameRules[k] = v;
  fireAfter('world.afterEvents', 'gameRuleChange', { rule: k, value: v });
}
IMPL.GameRules = { get: {}, set: {} };
for (const k of $Object.keys(API.modules['@minecraft/server'].classes.GameRules.props)) {
  IMPL.GameRules.get[k] = () => G.gameRules[k] ?? RULE_DEFAULTS[k];
  IMPL.GameRules.set[k] = (h, v) => setRule(k, v);
}
RULES_BY_LOWER.map = $Object.fromEntries($Object.keys(API.modules['@minecraft/server'].classes.GameRules.props).map((k) => [k.toLowerCase(), k]));
RULES_BY_LOWER.set = setRule;

// ---- World / Player / Camera の残り --------------------------------------------
$Object.assign(IMPL.World.fns, {
  // 実測: 負の値もそのまま入る（日数は切り捨て、月は 8 で割った余り）。小数は 0 方向に切り捨て
  setAbsoluteTime(h, t) { const v = $Math.trunc(t); G.absoluteTime = v; G.timeOfDay = ((v % 24000) + 24000) % 24000; },
  setDynamicProperties(h, m) { for (const [k, v] of $Object.entries(m)) { if (v === undefined) G.dyn.delete(k); else G.dyn.set(k, typeof v === 'object' ? Vec(v) : v); } },
  getPackSettings() { return { ...(W.packSettings ?? {}) }; },
  getAimAssist: ni('world.getAimAssist'),
  getLootTableManager: ni('world.getLootTableManager（ルートテーブルの定義が要ります）'),
});
$Object.assign(IMPL.World.get, {
  seed: () => $String(W.seed ?? '0'),
  isHardcore: () => Boolean(W.hardcore),
  tickingAreaManager: () => once('TickingAreaManager', HW.ticking),
  structureManager: () => once('StructureManager', HW.structures),
  primitiveShapesManager: ni('world.primitiveShapesManager'),
  soundDefinitionRegistry: ni('world.soundDefinitionRegistry（サウンド定義が要ります）'),
});
HW.ticking = {};
HW.structures = {};
$Object.assign(IMPL.Player.fns, {
  playMusic(h, id, o) { S.effects.push({ tick: S.tick, kind: 'music', to: h.e.name, id, options: o }); },
  queueMusic(h, id, o) { S.effects.push({ tick: S.tick, kind: 'music.queue', to: h.e.name, id, options: o }); },
  stopMusic(h) { S.effects.push({ tick: S.tick, kind: 'music.stop', to: h.e.name }); },
  getControlScheme: (h) => h.e.controlScheme ?? 'LockedPlayerRelativeStrafe',   // 実測の既定
  setControlScheme: (h, v) => { h.e.controlScheme = v; },
  getAimAssist: ni('player.getAimAssist'),
  setPropertyOverrideForEntity: ni('player.setPropertyOverrideForEntity（エンティティの定義ファイルが要ります）'),
  removePropertyOverrideForEntity: ni('player.removePropertyOverrideForEntity'),
});
IMPL.Player.get.inputPermissions = (h) => once('PlayerInputPermissions', (h.e._ip ??= { e: h.e, valid: () => h.e.valid }));
/** 実測: 文字列を渡すと、この TypeError になる（列挙は数値） */
const inputCat = (c) => {
  if (typeof c !== 'number') throw new $TypeError('Native type conversion failed. Function argument [0] expected type: InputPermissionCategory');
  return c;
};
IMPL.PlayerInputPermissions = {
  fns: {
    isPermissionCategoryEnabled: (h, c) => { inputCat(c); return h.e.inputPerm?.[c] ?? true; },
    setPermissionCategory: (h, c, v) => {
      inputCat(c);
      h.e.inputPerm ??= {};
      const prev = h.e.inputPerm[c] ?? true;
      h.e.inputPerm[c] = v;
      if (prev !== v) fireAfter('world.afterEvents', 'playerInputPermissionCategoryChange', { player: entityObj(h.e), category: c, enabled: v });
    },
  },
};
$Object.assign(IMPL.Camera.fns, {
  addShake(h, o) { S.effects.push({ tick: S.tick, kind: 'camera.shake', to: h.e.name, options: o }); },
  stopShaking(h) { S.effects.push({ tick: S.tick, kind: 'camera.shake.stop', to: h.e.name }); },
  attachToEntity(h, e, o) { void o; S.effects.push({ tick: S.tick, kind: 'camera.attach', to: h.e.name, entity: H.get(e)?.e?.id }); },
});
$Object.assign(IMPL.ScreenDisplay.fns, {
  getHiddenHudElements: (h) => [...(h.e.hiddenHud ?? [])].sort((a, b) => a - b),
  resetHudElementsVisibility: (h) => { h.e.hiddenHud = []; },
  setHudVisibility: (h, vis, els) => {
    // 実測: 要素を指定せずに Hide すると 13 個すべてが隠れる。Reset は指定したぶんだけ戻る
    const hide = vis === 0 || vis === 'Hide';
    const list = els && els.length ? [...els] : HUD_ELEMENTS;
    if (hide) hudHide(h.e, list);
    else h.e.hiddenHud = (h.e.hiddenHud ?? []).filter((el) => !list.includes(el));
  },
});
// HUD の要素は 0〜12 の 13 個（実測）
const HUD_ELEMENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const hudHide = (e, list) => {
  e.hiddenHud ??= [];
  for (const el of list) if (!e.hiddenHud.includes(el)) e.hiddenHud.push(el);
};
// 実測: つないだクライアントが自己申告する値。BDS は受け取ったものをそのまま返す
//（較正に使う headless のクライアントは 0 を申告するので、既定はその値。players[].client で変えられる）
IMPL.ClientSystemInfo = {
  get: {
    maxRenderDistance: (h) => h.e?.client?.maxRenderDistance ?? 0,
    platformType: (h) => h.e?.client?.platformType ?? 'Desktop',
    memoryTier: (h) => h.e?.client?.memoryTier ?? 0,
    locale: (h) => h.e?.client?.locale ?? W.locale ?? 'ja_JP',
  },
};
IMPL.SystemInfo = { get: { memoryTier: () => 2 } };   // 実測: サーバー側は 2

// ---- ScoreboardScoreInfo などの「値だけのクラス」 -------------------------------------
IMPL.ScoreboardScoreInfo = { get: { participant: (h) => h.data.participant, score: (h) => h.data.score } };
IMPL.CommandResult = { get: { successCount: (h) => h.data.successCount } };
IMPL.Component.get.typeId = (h) => h.typeId ?? h.data?.typeId ?? NI('component.typeId');

// ---- 天気の before イベント ------------------------------------------------------
const setWeatherPrev = IMPL.Dimension.fns.setWeather;
IMPL.Dimension.fns.setWeather = function setWeather(h, w, dur) {
  const prev = DIMS[h.dim].weather;
  if (prev === w) { $apply(setWeatherPrev, this, [h, w, dur]); return; } // 実測: 同じ天気ならイベントは起きない
  const data = fireBefore('world.beforeEvents', 'weatherChange', { previousWeather: prev, newWeather: w, duration: dur ?? 12000, cancel: false });
  if (data.cancel) return;
  $apply(setWeatherPrev, this, [h, data.newWeather, data.duration]);
};

// ---- 爆発 ----------------------------------------------------------------------
IMPL.Dimension.fns.createExplosion = function createExplosion(h, loc, radius, o) {
  checkLoc(h.dim, loc);
  S.effects.push({ tick: S.tick, kind: 'explosion', dimension: h.dim, location: Vec(loc), radius, options: o });
  const impacted = [];
  if (o?.breaksBlocks !== false) {
    const r = $Math.ceil(radius);
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      if (x * x + y * y + z * z > radius * radius) continue;
      const p = { x: $Math.floor(loc.x) + x, y: $Math.floor(loc.y) + y, z: $Math.floor(loc.z) + z };
      const d = DIMS[h.dim];
      if (p.y < d.min || p.y >= d.max || !chunkLoaded(h.dim, p.x, p.z)) continue;
      const cur = readBlock(h.dim, p.x, p.y, p.z).id;
      if (cur === 'minecraft:air' || /bedrock|obsidian|barrier|command_block|end_portal|end_gateway|reinforced_deepslate|structure_block|jigsaw|border_block|allow|deny/.test(cur)) continue;
      impacted.push(p);
    }
  }
  const source = o?.source;
  const data = fireBefore('world.beforeEvents', 'explosion', { dimension: dimObj(h.dim), source, cancel: false, _blocks: impacted });
  if (data.cancel) return false;
  for (const p of data._blocks) {
    const before = readBlock(h.dim, p.x, p.y, p.z);
    fireBefore('world.beforeEvents', 'blockExplode', {});
    writeBlock(h.dim, p.x, p.y, p.z, makePerm('minecraft:air'));
    fireAfter('world.afterEvents', 'blockExplode', { block: blockObj(h.dim, p), dimension: dimObj(h.dim), explodedBlockPermutation: permObj(before), source });
    // プレイヤー以外で壊れたときは onBreak（爆発なので blockDestructionSource は Explosion）
    customDispatchRef.fn?.('blockBreak', { dim: h.dim, p, blockId: before.id, data: { brokenBlockPermutation: permObj(before), blockDestructionSource: 'Explosion', entitySource: source } });
  }
  fireAfter('world.afterEvents', 'explosion', { dimension: dimObj(h.dim), source, _blocks: data._blocks });
  // 範囲内のエンティティにダメージ（バニラの式を簡略化: 距離に比例して減る）
  for (const e of query({ location: loc, maxDistance: radius * 2 }, { dim: h.dim })) {
    if (e.typeId === 'minecraft:item') { removeEntity(e); continue; }
    const dist = $Math.sqrt((e.loc.x - loc.x) ** 2 + (e.loc.y - loc.y) ** 2 + (e.loc.z - loc.z) ** 2) / (radius * 2);
    const impact = 1 - dist;
    hurt(e, $Math.floor((impact * impact + impact) / 2 * 7 * radius * 2 + 1), { cause: source ? 'entityExplosion' : 'blockExplosion', damagingEntity: source });
  }
  return true;
};
IMPL.ExplosionAfterEvent = { fns: { getImpactedBlocks: function getImpactedBlocks(h) { const d = H.get(this).data; const dim = H.get(d.dimension).dim; return d._blocks.map((p) => blockObj(dim, p)); } } };
IMPL.ExplosionBeforeEvent = { fns: { setImpactedBlocks: function setImpactedBlocks(h, blocks) { h.data._blocks = blocks.map((b) => Vec(H.get(b).p)); } } };

// ---- ティッキングエリア -------------------------------------------------------------
const MAX_TICKING_CHUNKS = W.maxTickingAreaChunks ?? 300; // 実測
const tickingNamed = new $Map();
const areaChunks = (o) => ($Math.abs($Math.floor(o.to.x / 16) - $Math.floor(o.from.x / 16)) + 1) * ($Math.abs($Math.floor(o.to.z / 16) - $Math.floor(o.from.z / 16)) + 1);
const usedChunks = () => [...tickingNamed.values()].reduce((n, a) => n + a.chunks, 0);
function areaView(a) {
  return {
    identifier: a.id,
    dimension: dimObj(a.dim),
    boundingBox: { min: { x: $Math.min(a.from.x, a.to.x), y: DIMS[a.dim].min, z: $Math.min(a.from.z, a.to.z) }, max: { x: $Math.max(a.from.x, a.to.x), y: DIMS[a.dim].max - 1, z: $Math.max(a.from.z, a.to.z) } },
    chunkCount: a.chunks,
    isFullyLoaded: S.tick > a.createdAt,
  };
}
IMPL.TickingAreaManager = {
  fns: {
    createTickingArea(h, id, o) {
      if (tickingNamed.has(id)) throw fail('TickingAreaError', `Identifier '${id}' already exists.`);
      const chunks = areaChunks(o);
      if (usedChunks() + chunks > MAX_TICKING_CHUNKS) throw fail('TickingAreaError', `区画数の上限（${MAX_TICKING_CHUNKS}）を超えます`);
      const a = { id, dim: H.get(o.dimension).dim, from: Vec(o.from), to: Vec(o.to), chunks, createdAt: S.tick };
      tickingNamed.set(id, a);
      tickingAreas.push(a);
      // 型は Promise<void>（実測でも undefined で解決する）
      return new $Promise((resolve) => { waits.push({ due: S.tick + 1, resolve: () => resolve(undefined) }); });
    },
    getAllTickingAreas: () => [...tickingNamed.values()].map(areaView),
    getTickingArea: (h, id) => { const a = tickingNamed.get(typeof id === 'string' ? id : id.identifier); return a ? areaView(a) : undefined; },
    hasCapacity: (h, o) => usedChunks() + areaChunks(o) <= MAX_TICKING_CHUNKS,
    hasTickingArea: (h, id) => tickingNamed.has(id),
    removeTickingArea(h, id) {
      const k = typeof id === 'string' ? id : id.identifier;
      const a = tickingNamed.get(k);
      if (!a) throw fail('TickingAreaError', `Unknown identifier '${k}'.`);
      tickingNamed.delete(k);
      tickingAreas.splice(tickingAreas.indexOf(a), 1);
    },
    removeAllTickingAreas() { for (const a of tickingNamed.values()) tickingAreas.splice(tickingAreas.indexOf(a), 1); tickingNamed.clear(); },
  },
  get: { chunkCount: () => usedChunks(), maxChunkCount: () => MAX_TICKING_CHUNKS },
};
