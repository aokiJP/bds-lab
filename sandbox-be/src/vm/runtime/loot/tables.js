// ルートテーブル: 旧いアイテム名とクラス

// =========================================================================
// 拡張 3: ルートテーブル（公式のビヘイビアパックから）・ドロップ（実機の分布）・
//         エンティティのプロパティ（公式の定義と、実機で湧いた直後の値）
// =========================================================================
const BEH = VANILLA.behavior ?? { tables: {}, entities: {} };
const pick = (weights) => {
  const total = weights.reduce((n, w) => n + w, 0);
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
  return weights.length - 1;
};
const rint = (lo, hi) => lo + $Math.floor(random() * (hi - lo + 1));
const rangeOf = (v, def = 1) => (v === undefined ? { min: def, max: def } : typeof v === 'number' ? { min: v, max: v } : $Array.isArray(v) ? { min: v[0] ?? def, max: v[1] ?? v[0] ?? def } : { min: v.min ?? 0, max: v.max ?? v.min ?? 0 });
const rollRange = (v, def = 1) => { const r = rangeOf(v, def); return $Number.isInteger(r.min) && $Number.isInteger(r.max) ? rint(r.min, r.max) : r.min + random() * (r.max - r.min); };

// ---- 旧いアイテム名（ルートテーブルに残っている） ---------------------------------------
const LOOT_ALIAS = {
  muttonRaw: 'mutton', wool: 'white_wool', fish: 'cod', clownfish: 'tropical_fish', horsearmoriron: 'iron_horse_armor',
  horsearmorgold: 'golden_horse_armor', horsearmordiamond: 'diamond_horse_armor', appleEnchanted: 'enchanted_golden_apple',
  netherStar: 'nether_star', totem: 'totem_of_undying', speckled_melon: 'glistering_melon_slice', fireball: 'fire_charge',
  sign: 'oak_sign', sapling: 'oak_sapling', map: 'empty_map', chain: 'iron_chain', skull: 'skeleton_skull', dye: 'ink_sac',
};
const DYE_BY_DATA = ['ink_sac', 'red_dye', 'green_dye', 'cocoa_beans', 'lapis_lazuli', 'purple_dye', 'cyan_dye', 'light_gray_dye', 'gray_dye', 'pink_dye', 'lime_dye', 'yellow_dye', 'light_blue_dye', 'magenta_dye', 'orange_dye', 'bone_meal'];
const SKULL_BY_DATA = ['skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'player_head', 'creeper_head', 'dragon_head', 'piglin_head'];
function lootItemId(name, functions = []) {
  if (/^(?!minecraft:)[\w.-]+:/.test($String(name))) return PACK.items?.[$String(name)] || PACK.blocks?.[$String(name)] ? $String(name) : null;   // a pack's own item
  const short = $String(name).replace(/^minecraft:/, '');
  const data = functions.find((f) => fnName(f) === 'set_data')?.data;
  if (short === 'dye' && typeof data === 'number') return `minecraft:${DYE_BY_DATA[data] ?? 'ink_sac'}`;
  if (short === 'skull' && typeof data === 'number') return `minecraft:${SKULL_BY_DATA[data] ?? 'skeleton_skull'}`;
  if (short === 'map' && functions.some((f) => fnName(f) === 'exploration_map')) return 'minecraft:filled_map';
  if (/^record_/.test(short)) return `minecraft:music_disc_${short.slice(7)}`;
  const id = `minecraft:${LOOT_ALIAS[short] ?? short}`;
  return M.items[id] ? id : null;
}
const fnName = (f) => $String(f.function ?? '').replace(/^minecraft:/, '');
const condName = (c) => $String(c.condition ?? '').replace(/^minecraft:/, '');

// ---- LootTable などのクラス（実測の形） ---------------------------------------------
const FN_CLASS = {
  enchant_random_gear: 'EnchantRandomEquipmentFunction', enchant_randomly: 'EnchantRandomlyFunction', enchant_with_levels: 'EnchantWithLevelsFunction',
  exploration_map: 'ExplorationMapFunction', explosion_decay: 'ExplosionDecayFunction', fill_container: 'FillContainerFunction',
  looting_enchant: 'LootingEnchantFunction', random_aux_value: 'RandomAuxValueFunction', random_block_state: 'RandomBlockStateFunction',
  random_dye: 'RandomDyeFunction', set_armor_trim: 'SetArmorTrimFunction', set_banner_details: 'SetBannerDetailsFunction',
  set_book_contents: 'SetBookContentsFunction', set_data_from_color_index: 'SetDataFromColorIndexFunction', set_count: 'SetItemCountFunction',
  set_damage: 'SetItemDamageFunction', set_data: 'SetItemDataFunction', set_lore: 'SetItemLoreFunction', set_name: 'SetItemNameFunction',
  set_ominous_bottle_amplifier: 'SetOminousBottleFunction', set_potion: 'SetPotionFunction', set_actor_id: 'SetSpawnEggFunction',
  set_stew_effect: 'SetStewEffectFunction', furnace_smelt: 'SmeltItemFunction', specific_enchants: 'SpecificEnchantFunction',
};
const COND_CLASS = {
  damaged_by_entity: 'DamagedByEntityCondition', has_mark_variant: 'EntityHasMarkVariantCondition', has_variant: 'EntityHasVariantCondition',
  entity_killed: 'EntityKilledCondition', is_baby: 'IsBabyCondition', killed_by_entity: 'KilledByEntityCondition',
  killed_by_player: 'KilledByPlayerCondition', killed_by_player_or_pets: 'KilledByPlayerOrPetsCondition', match_tool: 'MatchToolCondition',
  passenger_of_entity: 'PassengerOfEntityCondition', random_chance: 'RandomChanceCondition', random_chance_with_looting: 'RandomChanceWithLootingCondition',
  random_difficulty_chance: 'RandomDifficultyChanceCondition', random_regional_difficulty_chance: 'RandomRegionalDifficultyChanceCondition',
};
const nr = (v, def = 0) => { const r = rangeOf(v, def); return { max: r.max, min: r.min }; };
const cls = (name) => (CLASSES[name] ? name : null);
function condObj(c) {
  const n = condName(c);
  const k = cls(COND_CLASS[n]) ?? 'LootItemCondition';
  const data = {};
  if (n === 'random_chance') data.chance = F(c.chance ?? 0);
  if (n === 'random_chance_with_looting') { data.chance = F(c.chance ?? 0); data.lootingMultiplier = F(c.looting_multiplier ?? 0); }
  if (n === 'random_difficulty_chance') data.chances = [c.peaceful, c.easy, c.normal, c.hard].map((x) => F(x ?? c.default_chance ?? 0));
  if (n === 'random_regional_difficulty_chance') data.maxChance = F(c.max_chance ?? 0);
  if (n === 'passenger_of_entity' || n === 'killed_by_entity' || n === 'damaged_by_entity' || n === 'entity_killed') data.entityType = c.entity_type;
  if (n === 'has_variant' || n === 'has_mark_variant') data.value = c.value;
  if (n === 'match_tool') $Object.assign(data, { count: nr(c.count), durability: nr(c.durability), enchantments: [], itemName: c.item ?? '', itemTagsAll: c['minecraft:match_tool_filter_all'] ?? [], itemTagsAny: c['minecraft:match_tool_filter_any'] ?? [], itemTagsNone: c['minecraft:match_tool_filter_none'] ?? [] });
  return inst(k, { data });
}
function fnObj(f) {
  const n = fnName(f);
  const k = cls(FN_CLASS[n]) ?? 'LootItemFunction';
  const data = { conditions: (f.conditions ?? []).map(condObj) };
  if (n === 'set_count' || n === 'looting_enchant') data.count = nr(f.count);
  if (n === 'set_damage') data.damage = nr(f.damage);
  if (n === 'set_data') data.data = nr(f.data);
  if (n === 'enchant_randomly') data.treasure = Boolean(f.treasure);
  if (n === 'enchant_with_levels') { data.levels = nr(f.levels); data.treasure = Boolean(f.treasure); }
  if (n === 'enchant_random_gear') data.chance = F(f.chance ?? 0);
  if (n === 'specific_enchants') data.enchantments = (f.enchants ?? []).map((e) => inst('EnchantInfo', { data: { enchantment: typeof e === 'string' ? e : e.id, range: nr(typeof e === 'string' ? 1 : e.level ?? 1, 1) } }));
  if (n === 'set_potion') data.id = f.id;
  if (n === 'set_name') data.name = f.name;
  if (n === 'set_lore') data.lore = f.lore ?? [];
  if (n === 'exploration_map') data.destination = f.destination;
  return inst(k, { data });
}
function entryObj(e) {
  const base = { quality: e.quality ?? 0, weight: e.weight ?? 1, subTable: undefined };
  if (e.type === 'item') {
    const id = lootItemId(e.name, e.functions);
    return inst('LootItem', { data: { ...base, conditions: (e.conditions ?? []).map(condObj), functions: (e.functions ?? []).map(fnObj), name: id ? itemTypeObj(id) : undefined } });
  }
  if (e.type === 'loot_table') return inst('LootTableReference', { data: { ...base, path: `${e.name}`.replace(/^(?!loot_tables\/)/, '') } });
  if (e.type === 'empty') return inst('EmptyLootItem', { data: base });
  if (e.pools) return inst('LootTableEntry', { data: { ...base, lootTable: tableObj('(inline)', { pools: e.pools }) } });
  return inst('LootPoolEntry', { data: base });
}
function poolObj(p) {
  return inst('LootPool', {
    data: {
      bonusRolls: nr(p.bonus_rolls, 0),
      conditions: (p.conditions ?? []).map(condObj),
      entries: (p.entries ?? []).map(entryObj),
      rolls: nr(p.rolls, 1),
      tiers: p.tiers ? inst('LootPoolTiers', { data: { bonusChance: F(p.tiers.bonus_chance ?? 0), bonusRolls: p.tiers.bonus_rolls ?? 0, initialRange: p.tiers.initial_range ?? 0 } }) : undefined,
    },
  });
}
function tableObj(path, json) {
  return inst('LootTable', { json, data: { path, pools: (json.pools ?? []).map(poolObj) } });
}
