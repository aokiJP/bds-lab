// カスタム次元・複数ブロック・液体・大釜・音・動的プロパティ・向きの戻り

// ==== カスタム次元 ================================================================
// 実測: 登録は startup の中だけ。名前の検査と文言
IMPL.StartupEvent.get.dimensionRegistry = () => once('DimensionRegistry', (HS.dimreg ??= {}));
IMPL.DimensionRegistry = {
  fns: {
    registerCustomDimension(h, typeId) {
      if (S.mode !== 'early') throw fail('CustomDimensionInvalidRegistryError', 'Custom dimensions can only be registered during startup.');
      const id = checkNamespace(typeId);
      if (DIMS[id]) throw fail('CustomDimensionAlreadyRegisteredError', `Custom dimension '${id}' was already registered.`);
      if (!/^[a-z0-9_.\-]+:[a-z0-9_.\-/]+$/.test(id)) throw fail('CustomDimensionNameError', `Custom dimension '${id}' has invalid characters.`);
      // 実測: 高さは -64〜320
      DIMS[id] = { min: -64, max: 320, weather: 'Clear', custom: true };
    },
  },
};

// ==== 複数ブロックでできたもの・液体 ================================================
const partnerOf = (id, st, p) => {
  if (/door$/.test(id) && 'upper_block_bit' in st) {
    const dy = st.upper_block_bit ? -1 : 1;
    return { at: { x: p.x, y: p.y + dy, z: p.z }, ok: (o) => o.id === id && o.states.upper_block_bit === !st.upper_block_bit, measured: true };
  }
  if ('upper_block_bit' in st && /tall_grass|large_fern|sunflower|lilac|rose_bush|peony|pitcher_plant|double_plant|small_dripleaf/.test(id)) {
    const dy = st.upper_block_bit ? -1 : 1;
    return { at: { x: p.x, y: p.y + dy, z: p.z }, ok: (o) => o.id === id && o.states.upper_block_bit === !st.upper_block_bit };
  }
  if ('head_piece_bit' in st && /bed$/.test(id)) {
    const dir = st.direction ?? 0; // 0 南 1 西 2 北 3 東
    const v = [[0, 1], [-1, 0], [0, -1], [1, 0]][dir] ?? [0, 1];
    const s = st.head_piece_bit ? -1 : 1;
    return { at: { x: p.x + v[0] * s, y: p.y, z: p.z + v[1] * s }, ok: (o) => o.id === id && o.states.head_piece_bit === !st.head_piece_bit };
  }
  return null;
};
IMPL.Block.fns.getParts = (h) => {
  const b = blockOf(h);
  const pt = partnerOf(b.id, b.states, h.p);
  if (!pt) return undefined;
  const other = readBlock(h.dim, pt.at.x, pt.at.y, pt.at.z);
  if (!pt.ok(other)) {
    if (!pt.measured) softNI(`block.getParts（${b.id}）`);
    return [];
  }
  softNI(`block.getParts（${b.id} がそろっているとき）`);
  return [blockObj(h.dim, { ...h.p }), blockObj(h.dim, pt.at)];
};
const LIQUID_SPAWN_MEASURED = new $Set(['minecraft:stone', 'minecraft:torch']);
const spawnByLiquid = (id) => {
  if (!LIQUID_SPAWN_MEASURED.has(id)) softNI(`liquidSpreadCausesSpawn（${id}）`);
  return M.blocks[id]?.liquid ? !M.blocks[id].liquid[1] : false;
};
IMPL.Block.fns.liquidSpreadCausesSpawn = (h) => spawnByLiquid(blockOf(h).id);
IMPL.BlockPermutation.fns.liquidSpreadCausesSpawn = (h) => spawnByLiquid(h.perm.id);
// 実測: 石も松明も全方向 true。水を含めるブロックは向きで違いうるので未確定
IMPL.Block.fns.liquidCanFlowFromDirection = (h) => {
  const b = blockOf(h);
  if (M.blocks[b.id]?.liquid?.[0]) softNI(`liquidCanFlowFromDirection（${b.id}）`);
  return true;
};

// ==== 大釜の染料 ====================================================================
// 実測: 最初の染料はその色になり、その後は「今の色と染料の色の平均（切り捨て）」。
// 空（fillLevel 0）でも混ざる。染料でないものは何も起きない。白は F0F0F0。
const DYE_RGB = {
  white: 0xf0f0f0, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f,
  pink: 0xf38baa, gray: 0x474f52, light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
  brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};
const DYE_MEASURED = new $Set(['red', 'blue', 'white']);
const rgbColor = ([r, g, b]) => ({ green: F(g / 255), red: F(r / 255), blue: F(b / 255), alpha: 1 });
IMPL.BlockFluidContainerComponent.fns.addDye = (h, dye) => {
  const id = H.get(dye)?.id ?? $String(dye);
  const m = /^minecraft:(\w+?)_dye$/.exec(id);
  if (!m || DYE_RGB[m[1]] === undefined) {
    if (/^minecraft:(ink_sac|bone_meal|lapis_lazuli|cocoa_beans)$/.test(id)) softNI(`addDye（${id}）`);
    return;
  }
  if (!DYE_MEASURED.has(m[1])) softNI(`addDye（${id} の色）`);
  const liquidType = IMPL.BlockFluidContainerComponent.fns.getFluidType(h);
  if (liquidType !== 'Water') { softNI(`addDye（${liquidType} の大釜）`); return; }
  const c = DYE_RGB[m[1]];
  const add = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  if (!h.dyeRGB && h.color) softNI('addDye（fluidColor を直接設定した大釜）');
  h.dyeRGB = h.dyeRGB ? h.dyeRGB.map((v, i) => $Math.floor((v + add[i]) / 2)) : add;
  h.color = rgbColor(h.dyeRGB);
};
const prevColorSet = IMPL.BlockFluidContainerComponent.set.fluidColor;
IMPL.BlockFluidContainerComponent.set.fluidColor = (h, c) => { h.dyeRGB = null; prevColorSet(h, c); };

// ==== 音 ============================================================================
// 実測: BDS にはサウンド定義が無いので getDefinitions は常に空。
// 鳴らすと SoundInstance が返り、id は通し番号の文字列
let soundSeq = 0;
const soundInst = (id, recipient) => inst('SoundInstance', { id: $String(++soundSeq), soundEventId: $String(typeof id === 'string' ? id : H.get(id)?.soundEventId ?? id), recipient, stopped: false, valid: () => true });
IMPL.SoundInstance = {
  get: {
    id: (h) => h.id,
    soundEventId: (h) => h.soundEventId,
    durationInfo: () => undefined,
    recipient: (h) => (h.recipient ? entityObj(h.recipient) : undefined),
  },
  fns: {
    stop(h) { if (!h.stopped) { h.stopped = true; S.effects.push({ tick: S.tick, kind: 'soundStop', id: h.id }); } },
  },
};
IMPL.SoundDefinitionRegistry = { fns: { getDefinitions: () => [] } };
IMPL.World.get.soundDefinitionRegistry = () => once('SoundDefinitionRegistry', (HS.sounds ??= {}));
const prevDimSound = IMPL.Dimension.fns.playSound;
IMPL.Dimension.fns.playSound = function playSound(h, id, loc, o) { $apply(prevDimSound, this, [h, id, loc, o]); return soundInst(id, null); };
const prevPlayerSound = IMPL.Player.fns.playSound;
IMPL.Player.fns.playSound = function playSound(h, id, o) { $apply(prevPlayerSound, this, [h, id, o]); return soundInst(id, h.e); };
IMPL.BlockInstrumentComponent ??= { fns: {} };
IMPL.BlockInstrumentComponent.fns ??= {};
IMPL.BlockInstrumentComponent.fns.playInstrumentSound = (h, face, o) => {
  // 実機では、この後の dimension.playSound の id が "3" だった（成功 1 回・失敗 1 回のあと）。
  // 失敗しても番号を 1 つ使う、と読んだ（この 1 点からの推定）
  soundSeq++;
  const snd = h.measured?.[face];
  if (typeof snd !== 'string') throw fail('InvalidArgumentError', 'Invalid value passed to argument [0]. Value did not match one of the supported values.');
  S.effects.push({ tick: S.tick, kind: 'sound', id: snd, dimension: h.dim, location: { x: h.p.x + 0.5, y: h.p.y + 0.5, z: h.p.z + 0.5 }, options: o });
};

// ==== アイテムに入れておくブロックの動的プロパティ ==================================
const prevItemComponent2 = itemComponentRef.fn;
itemComponentRef.fn = (h, id) => {
  const full = fullId(id);
  if (full === 'minecraft:block_actor_dynamic_properties' && M.items[h.it.typeId]?.comps?.includes(full)) {
    return once('ItemBlockDynamicPropertiesComponent', (h.it._bdynH ??= { it: h.it, typeId: full, valid: () => true }));
  }
  return prevItemComponent2(h, id);
};
IMPL.ItemBlockDynamicPropertiesComponent = {
  fns: {
    get: (h, k) => { const v = h.it.bdyn?.[k]; return v && typeof v === 'object' ? { z: v.z, y: v.y, x: v.x } : v; },
    set(h, k, v) {
      if (v === undefined) { if (h.it.bdyn) delete h.it.bdyn[k]; return; }
      if (typeof v === 'object' && (v === null || typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number')) throw new $TypeError('Native variant type conversion failed.');
      dynCheck(k, v);
      (h.it.bdyn ??= {})[k] = typeof v === 'object' ? { x: v.x, y: v.y, z: v.z } : v;
    },
    totalByteCount: (h) => { softNI('ItemBlockDynamicPropertiesComponent.totalByteCount（測っていません）'); return dynBytes($Object.entries(h.it.bdyn ?? {})); },
  },
};
const prevCopy = copyItemRef.fn;
copyItemRef.fn = (it) => {
  const c = prevCopy ? prevCopy(it) : { typeId: it.typeId, amount: it.amount, nameTag: it.nameTag, lore: [...(it.lore ?? [])] };
  delete c._bdynH;
  c.bdyn = it.bdyn ? $Object.fromEntries($Object.entries(it.bdyn).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v } : v])) : undefined;
  return c;
};

// ==== 向きの戻り ====================================================================
// 実測（BDS 1.26.51.1）: 生き物の上下の向きは 1 tick に 10 度ずつ 0 に戻る（防具立て・牛・鶏など）。
// トロッコはすぐ 0、ボートはそのまま。AI で首を動かす Mob（ゾンビ等）の動きまでは再現しない。
const NO_PITCH_DECAY = /^minecraft:(player|item|xp_orb|(chest_)?boat|arrow|snowball|egg|ender_pearl|splash_potion|lingering_potion|thrown_trident|fireball|small_fireball|dragon_fireball|wither_skull|wither_skull_dangerous|shulker_bullet|llama_spit|wind_charge_projectile|breeze_wind_charge_projectile|fishing_hook|ender_crystal|painting|leash_knot|tnt|falling_block|lightning_bolt|area_effect_cloud|eye_of_ender_signal|fireworks_rocket|xp_bottle|evocation_fang|agent|npc|tripod_camera)$/;
END_HOOKS.push(() => {
  for (const e of entities.values()) {
    if (!e.valid || e.player || !e.rot || NO_PITCH_DECAY.test(e.typeId)) continue;
    const x = e.rot.x;
    if (x === 0) continue;
    const nx = /minecart$/.test(e.typeId) ? 0 : $Math.abs(x) <= 10 ? 0 : F(x - $Math.sign(x) * 10);
    e.rot = { x: nx, y: e.rot.y };
  }
});
