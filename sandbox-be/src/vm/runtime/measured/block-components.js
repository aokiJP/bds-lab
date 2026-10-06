// 実測データ: ブロックのコンポーネント

// =========================================================================
// 拡張 2: 実機で測ったデータ（ブロックのコンポーネント・エンチャント・ポーション）と、
//         ゲーム本体が要らないデータ構造（本・Molang・スプライン・フォグ・ウェイポイント・
//         入力・エイムアシスト・図形・騎乗・リード・テイム・新しい UI）
// =========================================================================

// ---- ブロックのコンポーネント（実測で「その種類が持つ」ものだけ） ------------------------------
const BLOCK_COMP_CLASS = API.modules['@minecraft/server'].componentMaps.BlockComponentTypeMap;
const measuredBlockComps = (id) => M.blockComponents?.[id]?.comps ?? null;
const prevBlockGetComponent = IMPL.Block.fns.getComponent;
const cleanMeasured = (vals, skip = []) => {
  const out = {};
  for (const [k, v] of $Object.entries(vals ?? {})) {
    if (k === 'isValid' || k === 'error' || skip.includes(k) || v === '__object' || (v && typeof v === 'object' && v.error)) continue;
    out[k] = v === '__undefined' ? undefined : v;
  }
  return out;
};
function blockComponentOf(h, full) {
  const bid = readBlock(h.dim, h.p.x, h.p.y, h.p.z).id;
  const mc = measuredBlockComps(bid);
  if (mc && !mc[full]) return undefined;
  const k = full.slice(10);
  if (k === 'inventory' || k === 'sign') return $apply(prevBlockGetComponent, this, [h, full]);
  if (!mc) return $apply(prevBlockGetComponent, this, [h, full]);
  const cls = BLOCK_COMP_CLASS[full];
  const d = bdata(h.dim, h.p);
  d.comps ??= {};
  if (!d.comps[full]) {
    const base = cleanMeasured(mc[full], ['faces', 'strong', 'fluidType', 'attached', 'Up', 'Down', 'North', 'fillLevel', 'fluidColor', 'accumulatesSnow', 'isSnowLoggable', 'obstructsRain', 'isPlaying', 'record', 'size', 'text', 'dye', 'waxed']);
    d.comps[full] = { dim: h.dim, p: h.p, typeId: full, data: base, measured: mc[full], valid: () => readBlock(h.dim, h.p.x, h.p.y, h.p.z).id === bid };
    if (k === 'fluid_container') d.comps[full].data.fluidColor = mc[full].fluidColor;
    if (k === 'record_player') d.comps[full].record = null;
  }
  return once(cls, d.comps[full]);
}
IMPL.Block.fns.getComponent = function getComponent(h, id) { assertLoaded(h); return blockComponentOf.call(this, h, fullId(id)); };
IMPL.Block.fns.hasComponent = function hasComponent(h, id) {
  assertLoaded(h);
  const mc = measuredBlockComps(readBlock(h.dim, h.p.x, h.p.y, h.p.z).id);
  return mc ? Boolean(mc[fullId(id)]) : this.getComponent(id) !== undefined;
};
IMPL.Block.fns.getComponents = function getComponents(h) {
  assertLoaded(h);
  const mc = measuredBlockComps(readBlock(h.dim, h.p.x, h.p.y, h.p.z).id);
  return (mc ? $Object.keys(mc) : ['minecraft:inventory', 'minecraft:sign']).map((c) => this.getComponent(c)).filter(Boolean);
};
IMPL.BlockPrecipitationInteractionsComponent = {
  fns: {
    accumulatesSnow: (h) => h.measured.accumulatesSnow,
    isSnowLoggable: (h) => h.measured.isSnowLoggable,
    obstructsRain: (h) => h.measured.obstructsRain,
  },
};
IMPL.BlockRedstoneProducerComponent = {
  fns: {
    getConnectedFaces: (h) => [...(h.measured.faces ?? [])],
    getStronglyPoweredFace: (h) => h.measured.strong ?? undefined,
  },
};
IMPL.BlockPistonComponent = {
  fns: {
    getAttachedBlocks: () => [],
    getAttachedBlocksLocations: () => [],
  },
};
// 大釜: fillLevel と液体の種類はブロックの状態そのもの（実測）
const LIQUID_STATE = { Water: 'water', Lava: 'lava', PowderSnow: 'powder_snow' };
const LIQUID_TYPE = { water: 'Water', lava: 'Lava', powder_snow: 'PowderSnow' };
const cauldronState = (h) => readBlock(h.dim, h.p.x, h.p.y, h.p.z);
const setCauldron = (h, states) => { const b = cauldronState(h); writeBlock(h.dim, h.p.x, h.p.y, h.p.z, makePerm(b.id, { ...b.states, ...states })); };
IMPL.BlockFluidContainerComponent = {
  fns: {
    getFluidType: (h) => (h.potionType ? 'Potion' : LIQUID_TYPE[cauldronState(h).states.cauldron_liquid] ?? 'Water'),
    setFluidType(h, t) {
      if (t === 'Potion') { h.potionType = true; setCauldron(h, { cauldron_liquid: 'water' }); return; }
      h.potionType = false;
      setCauldron(h, { cauldron_liquid: LIQUID_STATE[t] });
    },
    setPotion: (h, item) => { h.potionType = true; h.potion = copyItem(H.get(item).it); },
    addDye: ni('BlockFluidContainerComponent.addDye（染料の混ざり方は再現していません）'),
  },
  get: {
    fillLevel: (h) => $Number(cauldronState(h).states.fill_level ?? 0),
    fluidColor: (h) => ({ ...(h.color ?? h.data.fluidColor) }),
  },
  set: {
    fillLevel(h, v) {
      if (v > 6) throw fail('Error', 'Cannot set fillLevel property above 6.');
      if (v < 0) throw fail('Error', 'Cannot set fillLevel property below 0.');
      if (v === 0) { h.potionType = false; setCauldron(h, { fill_level: 0, cauldron_liquid: 'water' }); return; }
      setCauldron(h, { fill_level: v });
    },
    fluidColor: (h, c) => { h.color = { ...c }; },
  },
};
IMPL.BlockRecordPlayerComponent = {
  fns: {
    getRecord: (h) => (h.record ? itemObj({ typeId: h.record, amount: 1, lore: [] }) : undefined),
    isPlaying: (h) => Boolean(h.record && h.playing),
    setRecord(h, type, start = true) {
      if (type === undefined) { h.record = null; h.playing = false; return; }
      // 実測: 文字列は名前空間まで含めて完全に一致しないと見つからない
      const id = typeof type === 'string' ? (M.items[type] ? type : null) : H.get(type)?.id;
      if (!id) throw fail('Error', `Failed to getItem '${type}'.`);
      if (!(M.items[id]?.tags ?? []).includes('minecraft:music_disc')) throw fail('Error', 'Item is not a record.');
      h.record = id;
      h.playing = Boolean(start);
    },
    playRecord: (h) => { if (h.record) h.playing = true; },
    pauseRecord: (h) => { h.playing = false; },
    ejectRecord(h) {
      if (!h.record) return;
      const it = spawn('minecraft:item', h.dim, { x: h.p.x + 0.5, y: h.p.y + 1, z: h.p.z + 0.5 });
      it.item = { typeId: h.record, amount: 1, lore: [] };
      h.record = null;
      h.playing = false;
    },
  },
};
IMPL.BlockInstrumentComponent = {
  fns: {
    // 実測: 上と下の面だけ値がある。ほかの面は InvalidArgumentError
    getInstrumentName(h, face) {
      const m = h.measured ?? {};
      const v = face === 'Up' || face === 'Down' ? m[face] : m.North;
      if (v && typeof v === 'object' && v.error) throw fail('InvalidArgumentError', v.error.replace(/^\w+: /, ''));
      if (typeof v !== 'string') return NI(`getInstrumentName（${face}）`);
      return v;
    },
    playInstrumentSound: ni('BlockInstrumentComponent.playInstrumentSound'),
  },
};
