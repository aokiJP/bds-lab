// 実測データ: フォグ・入力・ロケーターバー・ウェイポイント・エイムアシスト

// ---- プレイヤー: フォグ・入力・ロケーターバー・ウェイポイント・エイムアシスト --------------------------
IMPL.Player.get.fogSettings = (h) => once('FogSettings', (h.e._fog ??= { e: h.e, valid: () => h.e.valid, stack: [] }));
IMPL.FogSettings = {
  fns: {
    getStack: (h) => h.stack.map((f) => f.id),
    getTags: (h) => h.stack.map((f) => f.tag),
    push(h, id, tag = '') {
      if (h.stack.length >= 255) throw fail('FogSettingsError', 'Fog stack is full.');
      h.stack.push({ id, tag });
      return h.stack.length - 1;
    },
    pop(h, tag) {
      for (let i = h.stack.length - 1; i >= 0; i--) {
        if (tag === undefined || h.stack[i].tag === tag) return h.stack.splice(i, 1)[0].id;
      }
      return undefined;
    },
    remove(h, tag) { const n = h.stack.length; h.stack = h.stack.filter((f) => tag !== undefined && f.tag !== tag); return h.stack.length !== n; },
    setStack(h, ids, tag = '') { h.stack = ids.map((id) => ({ id, tag })); },
  },
};
IMPL.Player.get.inputInfo = (h) => once('InputInfo', (h.e._input ??= { e: h.e, valid: () => h.e.valid }));
IMPL.InputInfo = {
  fns: {
    getButtonState: (h, b) => h.e.buttons?.[b] ?? 'Released',
    getMovementVector: (h) => ({ y: h.e.movement?.y ?? 0, x: h.e.movement?.x ?? 0 }),
  },
  get: {
    lastInputModeUsed: (h) => h.e.inputMode ?? 'KeyboardAndMouse',
    touchOnlyAffectsHotbar: (h) => Boolean(h.e.touchOnlyAffectsHotbar),
  },
};
IMPL.Player.get.isJumping = (h) => (h.e.buttons?.Jump ?? 'Released') === 'Pressed';
IMPL.Player.get.locatorBar = (h) => once('LocatorBar', (h.e._locator ??= { e: h.e, valid: () => h.e.valid, list: [] }));
const LOCATOR_MAX = W.locatorBarMaxCount ?? 256;   // 実測
IMPL.LocatorBar = {
  fns: {
    addWaypoint(h, w) {
      const wh = H.get(w);
      if (!wh.valid()) throw fail('InvalidWaypointError', 'Waypoint is no longer valid.');
      if (h.list.includes(wh)) throw fail('LocatorBarError', 'Waypoint is already on the locator bar.');
      if (LOCATOR_MAX !== undefined && h.list.length >= LOCATOR_MAX) throw fail('LocatorBarError', 'Locator bar is full.');
      h.list.push(wh);
    },
    getAllWaypoints: (h) => h.list.filter((w) => w.valid()).map((w) => w.obj),
    hasWaypoint: (h, w) => h.list.includes(H.get(w)),
    removeWaypoint(h, w) {
      const i = h.list.indexOf(H.get(w));
      if (i < 0) throw fail('LocatorBarError', 'Waypoint is not on the locator bar.');
      h.list.splice(i, 1);
    },
    removeAllWaypoints: (h) => { h.list.length = 0; },
  },
  get: {
    count: (h) => h.list.filter((w) => w.valid()).length,
    maxCount: () => (LOCATOR_MAX !== undefined ? LOCATOR_MAX : NI('LocatorBar.maxCount（プレイヤーが要るので未測定。world.locatorBarMaxCount で指定できる）')),
  },
};
function waypointHandle(data) {
  const h = { data, removed: false, valid: () => !h.removed && (!data.entity || ent(data.entity)?.valid) };
  return h;
}
const dimLoc = (l) => ({ z: l.z, y: l.y, x: l.x, dimension: l.dimension });
IMPL.Waypoint = {
  fns: {
    getDimensionLocation(h) {
      if (!h.valid()) throw fail('InvalidWaypointError', 'Waypoint is no longer valid.');
      if (h.data.entity) { const e = ent(h.data.entity); return dimLoc({ ...e.loc, dimension: dimObj(e.dim) }); }
      return dimLoc(h.data.location);
    },
    remove(h) { h.removed = true; },
  },
  get: { isValid: (h) => h.valid(), color: (h) => h.data.color, isEnabled: (h) => h.data.isEnabled, textureSelector: (h) => h.data.textureSelector },
  set: { color: (h, v) => { h.data.color = v; }, isEnabled: (h, v) => { h.data.isEnabled = v; }, textureSelector: (h, v) => { h.data.textureSelector = v; } },
};
IMPL.LocationWaypoint = {
  ctor(location, textureSelector, color) { const h = waypointHandle({ location: dimLoc(location), textureSelector, color, isEnabled: true }); return h; },
  fns: { setDimensionLocation: (h, l) => { h.data.location = dimLoc(l); } },
};
IMPL.EntityWaypoint = {
  ctor(entity, textureSelector, entityRules, color) { return waypointHandle({ entity, entityRules, textureSelector, color, isEnabled: true }); },
  get: { entity: (h) => h.data.entity, entityRules: (h) => h.data.entityRules },
};
IMPL.PlayerWaypoint = {
  ctor(player, textureSelector, playerRules, color) { return waypointHandle({ entity: player, playerRules, entityRules: playerRules, textureSelector, color, isEnabled: true }); },
  get: { playerRules: (h) => h.data.playerRules },
};

// エイムアシスト
// 実測: 最初から 3 つ入っている（並びもこの順）
const aimCat = (id) => [id, { identifier: id, defaultBlockPriority: 0, defaultEntityPriority: 0, blocks: {}, blockTags: {}, entities: {}, families: {} }];
const aimCategories = new $Map([aimCat('minecraft:empty_hand'), aimCat('minecraft:default'), aimCat('minecraft:bucket')]);
const aimPresets = new $Map([['minecraft:aim_assist_default', { identifier: 'minecraft:aim_assist_default', excluded: {}, items: {}, liquid: undefined, defaultItemSettings: undefined, handSettings: undefined }]]);
IMPL.World.fns.getAimAssist = () => once('AimAssistRegistry', HW.aim ??= {});
IMPL.AimAssistCategorySettings = {
  ctor(id) { return { data: { identifier: id, defaultBlockPriority: 0, defaultEntityPriority: 1 }, blocks: {}, blockTags: {}, entities: {}, families: {} }; },   // 実測: entity 側の既定は 1
  fns: {
    getBlockPriorities: (h) => ({ ...h.blocks }), setBlockPriorities: (h, m) => { h.blocks = { ...m }; },
    getBlockTagPriorities: (h) => ({ ...h.blockTags }), setBlockTagPriorities: (h, m) => { h.blockTags = { ...m }; },
    getEntityPriorities: (h) => ({ ...h.entities }), setEntityPriorities: (h, m) => { h.entities = { ...m }; },
    getEntityTypeFamilyPriorities: (h) => ({ ...h.families }), setEntityTypeFamilyPriorities: (h, m) => { h.families = { ...m }; },
  },
};
const excluded = (k) => ({ get: (h) => (h.excluded[k] ? [...h.excluded[k]] : undefined), set: (h, v) => { h.excluded[k] = v ? [...v] : undefined; } });
IMPL.AimAssistPresetSettings = {
  ctor(id) { return { data: { identifier: id, defaultItemSettings: undefined, handSettings: undefined }, excluded: {}, items: {}, liquid: undefined }; },
  fns: {
    getExcludedBlockTargets: excluded('blocks').get, setExcludedBlockTargets: excluded('blocks').set,
    getExcludedBlockTagTargets: excluded('blockTags').get, setExcludedBlockTagTargets: excluded('blockTags').set,
    getExcludedEntityTargets: excluded('entities').get, setExcludedEntityTargets: excluded('entities').set,
    getExcludedEntityTypeFamilyTargets: excluded('families').get, setExcludedEntityTypeFamilyTargets: excluded('families').set,
    getItemSettings: (h) => ({ ...h.items }), setItemSettings: (h, m) => { h.items = { ...m }; },
    getLiquidTargetingItems: (h) => (h.liquid ? [...h.liquid] : undefined), setLiquidTargetingItems: (h, v) => { h.liquid = v ? [...v] : undefined; },
  },
};
const aimCategoryObj = (rec) => inst('AimAssistCategory', { rec, data: { identifier: rec.identifier, defaultBlockPriority: rec.defaultBlockPriority, defaultEntityPriority: rec.defaultEntityPriority } });
const aimPresetObj = (rec) => inst('AimAssistPreset', { rec, data: { identifier: rec.identifier, defaultItemSettings: rec.defaultItemSettings, handSettings: rec.handSettings } });
IMPL.AimAssistCategory = {
  fns: {
    getBlockPriorities: (h) => ({ ...h.rec.blocks }), getBlockTagPriorities: (h) => ({ ...h.rec.blockTags }),
    getEntityPriorities: (h) => ({ ...h.rec.entities }), getEntityTypeFamilyPriorities: (h) => ({ ...h.rec.families }),
  },
};
IMPL.AimAssistPreset = {
  fns: {
    getExcludedBlockTargets: (h) => h.rec.excluded.blocks, getExcludedBlockTagTargets: (h) => h.rec.excluded.blockTags,
    getExcludedEntityTargets: (h) => h.rec.excluded.entities, getExcludedEntityTypeFamilyTargets: (h) => h.rec.excluded.families,
    getItemSettings: (h) => ({ ...h.rec.items }), getLiquidTargetingItems: (h) => h.rec.liquid,
  },
};
IMPL.AimAssistRegistry = {
  fns: {
    addCategory(h, settings) {
      const sh = H.get(settings);
      const id = checkNamespace(sh.data.identifier);
      // 実測: 同じ ID をもう一度足しても例外にならず、中身の無いものが返る
      if (aimCategories.has(id)) return inst('AimAssistCategory', { rec: { blocks: {}, blockTags: {}, entities: {}, families: {} }, data: {} });
      const rec = { ...sh.data, blocks: { ...sh.blocks }, blockTags: { ...sh.blockTags }, entities: { ...sh.entities }, families: { ...sh.families } };
      aimCategories.set(id, rec);
      return aimCategoryObj(rec);
    },
    addPreset(h, settings) {
      const sh = H.get(settings);
      const id = checkNamespace(sh.data.identifier);
      if (aimPresets.has(id)) return inst('AimAssistPreset', { rec: { excluded: {}, items: {} }, data: {} });
      const rec = { ...sh.data, excluded: { ...sh.excluded }, items: { ...sh.items }, liquid: sh.liquid };
      aimPresets.set(id, rec);
      return aimPresetObj(rec);
    },
    getCategories: () => [...aimCategories.values()].slice(3).reverse().concat([...aimCategories.values()].slice(0, 3)).map(aimCategoryObj),   // 実測: 後から足したものが先頭
    getCategory: (h, id) => (aimCategories.has(id) ? aimCategoryObj(aimCategories.get(id)) : undefined),
    getPresets: () => [...aimPresets.values()].slice(1).reverse().concat([...aimPresets.values()].slice(0, 1)).map(aimPresetObj),
    getPreset: (h, id) => (aimPresets.has(id) ? aimPresetObj(aimPresets.get(id)) : undefined),
  },
};
IMPL.Player.fns.getAimAssist = (h) => once('PlayerAimAssist', (h.e._aim ??= { e: h.e, valid: () => h.e.valid }));
IMPL.PlayerAimAssist = {
  fns: {
    set(h, settings) {
      if (settings === undefined) { h.e.aimAssist = undefined; return; }
      if (!aimPresets.has(settings.presetId)) throw fail('InvalidArgumentError', `Invalid value passed to argument [0]. Aim assist preset '${settings.presetId}' does not exist.`);
      if (settings.distance !== undefined && (settings.distance < 1 || settings.distance > 16)) throw outOfBounds(0, settings.distance, 1, 16, 'distance');
      h.e.aimAssist = { ...settings };
    },
  },
  get: { settings: (h) => (h.e.aimAssist ? { ...h.e.aimAssist } : undefined) },
};

// 図形（デバッグ表示）
const shapes = [];
const MAX_SHAPES = W.maxPrimitiveShapes;
IMPL.World.get.primitiveShapesManager = () => once('PrimitiveShapesManager', HW.shapes ??= {});
IMPL.PrimitiveShapesManager = {
  fns: {
    addText(h, text, dimension) {
      const th = H.get(text);
      if (MAX_SHAPES !== undefined && shapes.length >= MAX_SHAPES) throw fail('PrimitiveShapeError', 'Too many shapes.');
      if (!shapes.includes(th)) shapes.push(th);
      th.added = true;
      if (dimension) th.dim = H.get(dimension).dim;
      S.effects.push({ tick: S.tick, kind: 'shape', text: th.textValue });
    },
    getShapes: () => shapes.filter((s) => s.added).map((s) => s.obj),
    removeAll: () => { for (const s of shapes) s.added = false; shapes.length = 0; },
    removeText: (h, text) => { const th = H.get(text); th.added = false; shapes.splice(shapes.indexOf(th), 1); },
  },
  get: { maxShapes: () => (MAX_SHAPES !== undefined ? MAX_SHAPES : NI('PrimitiveShapesManager.maxShapes（未測定。world.maxPrimitiveShapes で指定できる）')) },
};
IMPL.TextPrimitive = {
  ctor(location, text) {
    const loc = Vec(location);
    return { textValue: text, dim: location.dimension ? H.get(location.dimension).dim : 'minecraft:overworld', loc, data: { backfaceVisible: false, depthTest: true, textBackfaceVisible: false, useRotation: false, backgroundColorOverride: undefined } };
  },
  fns: { setText: (h, t) => { h.textValue = t; } },
  get: { text: (h) => h.textValue },
};
IMPL.PrimitiveShape = {
  fns: {
    remove: (h) => { h.added = false; const i = shapes.indexOf(h); if (i >= 0) shapes.splice(i, 1); },
    setLocation: (h, l) => { h.loc = Vec(l); if (l.dimension) h.dim = H.get(l.dimension).dim; },
  },
  get: {
    location: (h) => Vec(h.loc),
    dimension: (h) => dimObj(h.dim),
    hasDuration: (h) => h.timeLeft !== undefined,
    timeLeft: (h) => h.timeLeft, totalTimeLeft: (h) => h.totalTimeLeft,
    color: (h) => h.color ?? { alpha: 1, blue: 1, green: 1, red: 1 },
    rotation: (h) => Vec(h.rotation ?? { x: 0, y: 0, z: 0 }),
    scale: (h) => h.scale ?? 1,
    attachedTo: (h) => h.attachedTo, maximumRenderDistance: (h) => h.maxDist, visibleTo: (h) => [...(h.visibleTo ?? [])],
  },
  set: {
    timeLeft: (h, v) => { h.timeLeft = v; h.totalTimeLeft = v; }, color: (h, v) => { h.color = v; }, rotation: (h, v) => { h.rotation = Vec(v); },
    scale: (h, v) => { h.scale = v; }, attachedTo: (h, v) => { h.attachedTo = v; }, maximumRenderDistance: (h, v) => { h.maxDist = v; }, visibleTo: (h, v) => { h.visibleTo = [...v]; },
  },
};
