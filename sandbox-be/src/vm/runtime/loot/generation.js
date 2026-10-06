// ルートテーブル: 生成・道具の分類・LootTableManager

// ---- 生成 ------------------------------------------------------------------
const toolInfo = (tool) => {
  if (!tool) return { looting: 0, silk: false, fortune: 0 };
  const ench = tool.ench ?? {};
  return { looting: ench.looting ?? 0, silk: Boolean(ench.silk_touch), fortune: ench.fortune ?? 0, it: tool };
};
function condOk(c, ctx) {
  const n = condName(c);
  switch (n) {
    case 'random_chance': return random() < (c.chance ?? 0);
    case 'random_chance_with_looting': return random() < (c.chance ?? 0) + (c.looting_multiplier ?? 0) * ctx.tool.looting;
    // 表から直接作るときは、倒した者も倒された者もいない（実測: ゾンビの鉄インゴットは出ない）
    case 'killed_by_player': case 'killed_by_player_or_pets': case 'killed_by_entity': case 'damaged_by_entity':
    case 'entity_killed': case 'passenger_of_entity': case 'is_baby': case 'has_variant': case 'has_mark_variant':
    case 'bool_property': case 'entity_properties':
      return ctx.entity ? entityCond(n, c, ctx.entity) : false;
    case 'match_tool': {
      if (!ctx.tool.it) return false;
      if (c.item && fullId(c.item) !== ctx.tool.it.typeId) return false;
      const tags = M.items[ctx.tool.it.typeId]?.tags ?? [];
      if ((c['minecraft:match_tool_filter_any'] ?? []).length && !c['minecraft:match_tool_filter_any'].some((t) => tags.includes(t))) return false;
      if ((c['minecraft:match_tool_filter_all'] ?? []).some((t) => !tags.includes(t))) return false;
      if ((c['minecraft:match_tool_filter_none'] ?? []).some((t) => tags.includes(t))) return false;
      return true;
    }
    default:
      ctx.unknown.add(`条件 ${n}`);
      return false;
  }
}
function entityCond(n, c, e) {
  if (n === 'is_baby') return Boolean(e.baby);
  ctx0Unknown(`条件 ${n}`);
  return false;
}
let lootUnknown = null;
const ctx0Unknown = (k) => lootUnknown?.add(k);
function applyFn(f, stack, ctx) {
  if ((f.conditions ?? []).length && !(f.conditions).every((c) => condOk(c, ctx))) return stack;
  const n = fnName(f);
  switch (n) {
    case 'set_count': stack.amount = $Math.floor(rollRange(f.count)); break;
    case 'looting_enchant': if (ctx.tool.looting) stack.amount += $Math.floor(rollRange(f.count) * ctx.tool.looting); break;
    case 'set_damage': { const dur = M.items[stack.typeId]?.dur; if (dur) stack.damage = $Math.floor(dur * (1 - rollRange(f.damage))); break; }
    case 'set_name': stack.nameTag = f.name; break;
    case 'set_lore': stack.lore = [...(f.lore ?? [])]; break;
    case 'specific_enchants': stack.ench = { ...(stack.ench ?? {}) }; for (const e of f.enchants ?? []) { const id = typeof e === 'string' ? e : e.id; stack.ench[enchShort(id)] = typeof e === 'string' ? 1 : $Math.floor(rollRange(e.level ?? 1)); } break;
    case 'enchant_randomly': case 'enchant_with_levels': case 'enchant_book_for_trading': case 'enchant_random_gear': {
      if (n === 'enchant_random_gear' && random() >= (f.chance ?? 0)) break;
      if (stack.typeId === 'minecraft:book') stack.typeId = 'minecraft:enchanted_book';
      const ok = M.enchantable[stack.typeId]?.ok ?? (stack.typeId === 'minecraft:enchanted_book' ? $Object.keys(M.enchantments) : []);
      if (ok.length) { const e = ok[rint(0, ok.length - 1)]; stack.ench = { [e]: rint(1, enchMax(e)) }; }
      break;
    }
    case 'set_potion': stack.potion = { effect: fullId(f.id), delivery: DEFAULT_DELIVERY[stack.typeId] ?? 'Consume' }; break;
    case 'set_data': case 'set_data_from_color_index': case 'random_aux_value': case 'explosion_decay': case 'furnace_smelt':
    case 'exploration_map': case 'set_ominous_bottle_amplifier': case 'set_armor_trim': case 'set_banner_details': case 'set_stew_effect':
    case 'random_dye': case 'random_block_state': case 'fill_container': case 'set_book_contents': case 'set_actor_id':
      // 見た目・中身の細部（色・データ値・地図の行き先など）は再現しない。アイテムの種類と数は変わらない
      break;
    default:
      ctx.unknown.add(`関数 ${n}`);
  }
  return stack;
}
function genTable(json, ctx, depth = 0) {
  const out = [];
  if (depth > 8) return out;
  for (const p of json.pools ?? []) {
    if (!(p.conditions ?? []).every((c) => condOk(c, ctx))) continue;
    if (p.tiers) { ctx.unknown.add('tiers'); continue; }
    const rolls = $Math.floor(rollRange(p.rolls, 1)) + $Math.floor(rollRange(p.bonus_rolls, 0));
    const entries = p.entries ?? [];
    for (let r = 0; r < rolls; r++) {
      const ok = entries.filter((e) => (e.conditions ?? []).every((c) => condOk(c, ctx)));
      if (!ok.length) continue;
      const e = ok[pick(ok.map((x) => $Math.max(0, (x.weight ?? 1) + (x.quality ?? 0) * 0)))];
      if (e.type === 'empty') continue;
      if (e.type === 'loot_table') {
        const sub = BEH.tables[e.name.endsWith('.json') ? e.name : `${e.name}.json`];
        if (!sub) { ctx.unknown.add(`テーブル ${e.name}`); continue; }
        out.push(...genTable(sub, ctx, depth + 1));
        continue;
      }
      if (e.pools) { out.push(...genTable({ pools: e.pools }, ctx, depth + 1)); continue; }
      const id = lootItemId(e.name, e.functions);
      if (!id) { ctx.unknown.add(`アイテム ${e.name}`); continue; }
      let stack = { typeId: id, amount: 1, lore: [] };
      for (const f of e.functions ?? []) stack = applyFn(f, stack, ctx);
      if (stack.amount <= 0) continue;
      const max = ITEM_MAX(stack.typeId);
      while (stack.amount > max) { out.push({ ...stack, amount: max }); stack.amount -= max; }
      out.push(stack);
    }
  }
  return out;
}
function runLoot(json, tool, entity) {
  const ctx = { tool: toolInfo(tool), entity, unknown: new $Set() };
  lootUnknown = ctx.unknown;
  const r = genTable(json, ctx);
  lootUnknown = null;
  if (ctx.unknown.size) notImplemented(new SandboxNotImplemented(`ルートテーブルの一部（${[...ctx.unknown].join('、')}）`));
  return r.map((s) => itemObj(s));
}
// 実機で測った分布から 1 つ選ぶ（'U' は undefined、'' は空）
function sampleMeasured(dist) {
  const keys = $Object.keys(dist);
  const k = keys[pick(keys.map((x) => dist[x]))];
  if (k === 'U') return undefined;
  if (k === '') return [];
  return k.split(',').map((part) => { const [id, n] = part.split('*'); return itemObj({ typeId: id, amount: $Number(n), lore: [] }); });
}

// ---- 道具の分類（測ったのはダイヤの道具・ハサミ・剣・シルクタッチ・各素材のツルハシ・棒） ----------------
function toolCategory(tool) {
  if (!tool) return 'none';
  const id = tool.typeId;
  const tags = M.items[id]?.tags ?? [];
  if (tool.ench?.silk_touch) return 'silk';
  if (tool.ench?.fortune) return null;
  if (id === 'minecraft:shears') return 'shears';
  if (tags.includes('minecraft:is_pickaxe')) {
    const tier = /^minecraft:(wooden|stone|iron|golden)_pickaxe$/.exec(id)?.[1];
    if (tier) return `${tier}_pickaxe`;
    return /^minecraft:(diamond|netherite)_pickaxe$/.test(id) ? 'pickaxe' : null;
  }
  if (tags.includes('minecraft:is_axe')) return /diamond|netherite/.test(id) ? 'axe' : null;
  if (tags.includes('minecraft:is_shovel')) return /diamond|netherite/.test(id) ? 'shovel' : null;
  if (tags.includes('minecraft:is_hoe')) return /diamond|netherite/.test(id) ? 'hoe' : null;
  if (tags.includes('minecraft:is_sword')) return /diamond|netherite/.test(id) ? 'sword' : null;
  if (tags.includes('minecraft:is_tool')) return null;
  return 'stick';
}
const DROP_STATE_KEYS = ['growth', 'age', 'candles', 'cluster_count', 'turtle_egg_count', 'height', 'upper_block_bit', 'head_piece_bit', 'propagule_stage', 'kelp_age', 'composter_fill_level', 'bite_counter', 'multi_face_direction_bits', 'dead_bit', 'extinguished'];
function blockLoot(id, states, tool) {
  const byTool = M.blockLoot?.[id];
  if (!byTool) return NI(`generateLootFromBlock（${id} は未測定）`);
  const def = defaultStates(id);
  const diff = states ? $Object.keys(def).filter((k) => def[k] !== states[k]) : [];
  const cat = toolCategory(tool ? H.get(tool).it : undefined);
  let table = byTool;
  if (diff.length) {
    // ドロップに関わる状態が 1 つだけ違うなら、その値で測った分布を使う。関わらない状態（向きなど）は無視する
    const byState = M.blockLootByState?.[id] ?? {};
    const relevant = diff.filter((k) => $Object.keys(byState).some((x) => x.startsWith(`${k}=`)) || DROP_STATE_KEYS.includes(k));
    if (relevant.length > 1) return NI(`generateLootFromBlockPermutation（${id} の状態の組み合わせは未測定）`);
    if (relevant.length === 1) {
      table = byState[`${relevant[0]}=${states[relevant[0]]}`];
      if (!table) return NI(`generateLootFromBlockPermutation（${id} の ${relevant[0]}=${states[relevant[0]]} は未測定）`);
    }
  }
  if (!cat || !table[cat] || table[cat].error) return NI(`generateLootFromBlock（道具 ${tool ? H.get(tool).it.typeId : 'なし'} は未測定）`);
  return sampleMeasured(table[cat]);
}

// ---- LootTableManager ---------------------------------------------------------
IMPL.World.fns.getLootTableManager = () => once('LootTableManager', HW.loot ??= {});
const toolItem = (tool) => (tool ? H.get(tool).it : undefined);
IMPL.LootTableManager = {
  fns: {
    // 実測: 'entities/zombie' の形だけ受け付け、呼ぶたびに新しいオブジェクトを返す
    getLootTable(h, p) {
      const key = `loot_tables/${p}.json`;
      if (/^loot_tables\/|\.json$|:/.test(p) || !BEH.tables[key]) return undefined;
      return tableObj(key, BEH.tables[key]);
    },
    generateLootFromTable(h, table, tool) {
      const th = H.get(table);
      if (!th?.json) throw fail('InvalidArgumentError', 'Invalid type passed to argument [0]. Expected type: LootTable');
      return runLoot(th.json, toolItem(tool));
    },
    generateLootFromEntityType(h, type) {
      const id = H.get(type)?.data?.id;
      const k = M.entities[id]?.typeLoot;
      if (k === undefined || (typeof k === 'object' && k?.error)) return NI(`generateLootFromEntityType（${id} は未測定）`);
      if (k === 'U') return undefined;
      const beh = BEH.entities[id];
      if (k === '') return beh?.loot ? runLoot(BEH.tables[beh.loot] ?? { pools: [] }) : [];
      return beh?.loot && BEH.tables[beh.loot] ? runLoot(BEH.tables[beh.loot]) : sampleMeasured({ [k]: 1 });
    },
    generateLootFromEntity(h, entity) {
      const e = H.get(entity)?.e;
      if (!e?.valid) throw fail('InvalidEntityError', "Failed to call function 'generateLootFromEntity' due to Entity being invalid (has the Entity been removed?).");
      if (e.baby) return undefined;
      const dist = M.entities[e.typeId]?.loot;
      if (!dist || dist.error) return NI(`generateLootFromEntity（${e.typeId} は未測定）`);
      return sampleMeasured(dist);
    },
    generateLootFromBlockType(h, type, tool) {
      const id = H.get(type)?.id;
      if (!id) throw fail('InvalidArgumentError', 'Invalid type passed to argument [0]. Expected type: BlockType');
      return blockLoot(id, null, tool);
    },
    generateLootFromBlockPermutation(h, perm, tool) {
      const p = H.get(perm).perm;
      return blockLoot(p.id, p.states, tool);
    },
    generateLootFromBlock(h, block, tool) {
      const bh = H.get(block);
      checkLoc(bh.dim, bh.p);
      const b = readBlock(bh.dim, bh.p.x, bh.p.y, bh.p.z);
      return blockLoot(b.id, b.states, tool);
    },
  },
};
// 死んだ Mob のドロップ（実測の分布から）
DEATH_DROPS.fn = (e) => {
  if (e.player || e.baby || G.gameRules.doMobLoot === false) return;
  const dist = M.entities[e.typeId]?.loot;
  // a pack's own mob: its minecraft:loot table from the pack (a vanilla mob: the drops measured on BDS)
  const own = !dist && PACK.entities?.[e.typeId]?.components?.['minecraft:loot']?.table;
  const table = own && PACK.lootTables?.[String(own).replace(/^\/+/, '')];
  if (!table && (!dist || dist.error)) return;
  const items = table ? runLoot(table, undefined, e) : sampleMeasured(dist) ?? [];
  for (const io of items) {
    const it = spawn('minecraft:item', e.dim, { x: e.loc.x, y: e.loc.y + 0.5, z: e.loc.z });
    it.item = copyItem(H.get(io).it);
  }
};
