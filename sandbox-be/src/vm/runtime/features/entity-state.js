// 拡張: 体力・属性・装備・ContainerSlot・ブロックの付随データ

// =========================================================================
// 拡張: 公式メタデータに出てくるメンバーのうち、仮想の世界で意味が決まるものを埋める
// （物理・光・地形生成・レッドストーン・AI のように「ゲームそのもの」が要るものは、
//   偽の値を返さず SandboxNotImplemented のままにしてある）
// =========================================================================

const NI = (what) => { throw new SandboxNotImplemented(what); };
/** 再現していないことを示す実装（再現度の集計では「未実装」に数える） */
const ni = (what) => { const f = () => NI(what); f.notImplemented = true; return f; };

// ---- 体力（変化したら entityHealthChanged） --------------------------------
const HURT_TICKS = 10;
function setHealth(e, v) {
  const old = e.health;
  // 実機: イベントの newValue は負にもなる（-89 を実測）。currentValue は 0 で止まる
  const nv = $Math.min(e.maxHealth, v);
  if (nv === old) return;
  e.health = nv;
  fireAfter('world.afterEvents', 'entityHealthChanged', { entity: entityObj(e), oldValue: old, newValue: nv });
}
function hurt(e, amount, source = {}) {
  if (!e.valid) return false;
  if (e.player && (e.gameMode === 'Creative' || e.gameMode === 'Spectator') && source.cause !== 'selfDestruct' && source.cause !== 'void') return false;
  if (e.dying !== undefined) return true;
  const ds = { cause: source.cause ?? 'none', damagingEntity: source.damagingEntity };
  // 無敵時間（実測）: 10 tick 以内は、前より強いダメージの差分だけが入る。返り値は true のまま
  let amt = amount;
  if (e.lastHurt && S.tick - e.lastHurt.tick < HURT_TICKS) {
    if (amount <= e.lastHurt.amount) return true;
    amt = amount - e.lastHurt.amount;
    e.lastHurt.amount = amount;
  } else {
    e.lastHurt = { tick: S.tick, amount };
  }
  const data = fireBefore('world.beforeEvents', 'entityHurt', { hurtEntity: entityObj(e), damageSource: ds, damage: amt, cancel: false });
  if (data.cancel) return false;
  const dmg = typeof data.damage === 'number' ? data.damage : amt;
  // 実測: entityHurt が先に配られ、そのあとに entityHealthChanged が来る
  fireAfter('world.afterEvents', 'entityHurt', { hurtEntity: entityObj(e), damage: dmg, damageSource: ds });
  setHealth(e, e.health - dmg);
  if (e.health <= 0) removeEntity(e, { died: true, cause: ds.cause, damagingEntity: ds.damagingEntity });
  return true;
}
function heal(e, amount, cause = 'Regeneration') {
  if (e.dying !== undefined || !e.valid) return; // 死んでいく途中は回復しない
  if (e.health >= e.maxHealth) return; // 実測: 満タンのときは before も after も起きない
  const data = fireBefore('world.beforeEvents', 'entityHeal', { healedEntity: entityObj(e), healing: amount, healSource: { cause }, cancel: false });
  if (data.cancel) return;
  const before = e.health;
  setHealth(e, e.health + (data.healing ?? amount));
  if (e.health !== before) fireAfter('world.afterEvents', 'entityHeal', { healedEntity: entityObj(e), healing: e.health - before, healSource: { cause } });
}
IMPL.Entity.fns.applyDamage = function applyDamage(h, amount, o) {
  // 実測（BDS 1.26.51.1・クライアントを 1 人つないだ状態）: プレイヤーに applyDamage を
  // 呼ぶと必ず false が返り、体力は減らない（3/30・cause 指定・防具なし の 4 通りで確認。
  // 同じ tick で豚には通る）。実クライアントでは違う可能性があるため、
  // world.playerDamageable: true で従来どおり通すこともできる。
  if (h.e.player && !W.playerDamageable) return false;
  return hurt(h.e, amount, { cause: o?.cause ?? 'none', damagingEntity: o?.damagingEntity });
};
IMPL.EntityHealthComponent.fns.setCurrentValue = (h, v) => { if (v < 0 || v > h.e.maxHealth) return false; setHealth(h.e, v); return true; };
IMPL.EntityHealthComponent.fns.resetToMaxValue = (h) => setHealth(h.e, h.e.maxHealth);
IMPL.EntityHealthComponent.fns.resetToDefaultValue = (h) => setHealth(h.e, h.e.maxHealth);
IMPL.EntityHealthComponent.fns.resetToMinValue = (h) => setHealth(h.e, 0);

// ---- 属性（移動速度など）----------------------------------------------------
const ATTR = {
  movement: { def: (e) => entityData(e.typeId)?.move ?? packComp('entities', e.typeId, 'minecraft:movement')?.value ?? (e.player ? 0.1 : 0.25), min: 0, max: 3.4028234663852886e38 },
  underwater_movement: { def: () => 0.02, min: 0, max: 3.4028234663852886e38 },
  lava_movement: { def: () => 0.02, min: 0, max: 3.4028234663852886e38 },
};
const ATTR_CLASS = { movement: 'EntityMovementComponent', underwater_movement: 'EntityUnderwaterMovementComponent', lava_movement: 'EntityLavaMovementComponent' };
function attrObj(e, k) {
  e._attr ??= {};
  e._attrH ??= {};
  if (e._attr[k] === undefined) e._attr[k] = ATTR[k].def(e);
  e._attrH[k] ??= { e, k, typeId: `minecraft:${k}`, valid: () => e.valid };
  return once(ATTR_CLASS[k], e._attrH[k]);
}
IMPL.EntityAttributeComponent = {
  fns: {
    setCurrentValue(h, v) { if (h.k === undefined) return NI('EntityAttributeComponent'); const a = ATTR[h.k]; if (v < a.min || v > a.max) return false; h.e._attr[h.k] = v; return true; },
    resetToDefaultValue(h) { h.e._attr[h.k] = ATTR[h.k].def(h.e); },
    resetToMaxValue(h) { h.e._attr[h.k] = ATTR[h.k].max; },
    resetToMinValue(h) { h.e._attr[h.k] = ATTR[h.k].min; },
  },
  get: {
    currentValue: (h) => h.e._attr[h.k],
    defaultValue: (h) => ATTR[h.k].def(h.e),
    effectiveMax: (h) => ATTR[h.k].max,
    effectiveMin: (h) => ATTR[h.k].min,
  },
};

// ---- 装備 -------------------------------------------------------------------
const ARMOR = {
  leather: [1, 3, 2, 1, 0], chainmail: [2, 5, 4, 1, 0], iron: [2, 6, 5, 2, 0], golden: [2, 5, 3, 1, 0],
  diamond: [3, 8, 6, 3, 2], netherite: [3, 8, 6, 3, 3], copper: [2, 4, 3, 1, 0],
};
const SLOT_OF = { Head: 0, Chest: 1, Legs: 2, Feet: 3 };
const slotAccepts = (slot, id) => {
  if (slot === 'Mainhand' || slot === 'Offhand') return true;
  const n = id.slice(10);
  if (slot === 'Head') return /_helmet$|^turtle_helmet$|^carved_pumpkin$|_head$|_skull$/.test(n);
  if (slot === 'Chest') return /_chestplate$|^elytra$/.test(n);
  if (slot === 'Legs') return /_leggings$/.test(n);
  if (slot === 'Feet') return /_boots$/.test(n);
  return false;
};
function equipSlot(e, slot) {
  e.equipment ??= { Head: null, Chest: null, Legs: null, Feet: null, Offhand: null };
  if (slot === 'Mainhand' && e.inventory) {
    return { get: () => e.inventory[e.selectedSlot], set: (v) => { e.inventory[e.selectedSlot] = v; }, valid: () => e.valid };
  }
  return { get: () => e.equipment[slot], set: (v) => { e.equipment[slot] = v; }, valid: () => e.valid };
}
IMPL.EntityEquippableComponent = {
  fns: {
    getEquipment(h, slot) { equipCheck(slot); const s = equipSlot(h.e, slot).get(); return s ? itemObj(copyItem(s)) : undefined; },
    getEquipmentSlot(h, slot) { equipCheck(slot); return inst('ContainerSlot', equipSlot(h.e, slot)); },
    setEquipment(h, slot, item) {
      const it = item ? H.get(item).it : null;
      if (it && !slotAccepts(slot, it.typeId)) return false;
      equipSlot(h.e, slot).set(it ? copyItem(it) : null);
      return true;
    },
  },
  get: {
    totalArmor: (h) => {
      let n = 0;
      for (const [slot, i] of $Object.entries(SLOT_OF)) {
        const it = h.e.equipment?.[slot];
        if (!it) continue;
        const m = /^minecraft:(\w+?)_(helmet|chestplate|leggings|boots)$/.exec(it.typeId);
        if (m && ARMOR[m[1]]) n += ARMOR[m[1]][i];
        else if (it.typeId === 'minecraft:turtle_helmet' && slot === 'Head') n += 2;
      }
      return n;
    },
    totalToughness: (h) => {
      let n = 0;
      for (const slot of $Object.keys(SLOT_OF)) {
        const m = /^minecraft:(\w+?)_(helmet|chestplate|leggings|boots)$/.exec(h.e.equipment?.[slot]?.typeId ?? '');
        if (m && ARMOR[m[1]]) n += ARMOR[m[1]][4];
      }
      return n;
    },
  },
};

// ---- ContainerSlot（持ち物・装備の両方で使う） ----------------------------------
function slotHandle(e, i) {
  return { get: () => e.inventory[i], set: (v) => { e.inventory[i] = v; }, valid: () => e.valid, e, i };
}
IMPL.Container.fns.getSlot = (h, slot) => inst('ContainerSlot', slotHandle(h.e, slotIndex(h, slot)));
IMPL.Container.fns.findLast = (h, item) => {
  const it = H.get(item).it;
  for (let i = h.e.inventory.length - 1; i >= 0; i--) if (h.e.inventory[i]?.typeId === it.typeId) return i;
  return undefined;
};
const needItem = (h) => {
  const s = h.get();
  if (!s) throw fail('InvalidContainerSlotError', 'The container slot is either empty or is no longer loaded.');
  return s;
};
IMPL.ContainerSlot = {
  fns: {
    getItem: (h) => { const s = h.get(); return s ? itemObj(copyItem(s)) : undefined; },
    setItem: (h, item) => h.set(item ? copyItem(H.get(item).it) : null),
    hasItem: (h) => Boolean(h.get()),
    getLore: (h) => [...(needItem(h).lore ?? [])],
    getRawLore: (h) => (needItem(h).lore ?? []).map((t) => ({ text: t })),
    setLore: (h, l) => { needItem(h).lore = (l ?? []).map((x) => rawText(x)); },
    getTags: (h) => [...itemTags(needItem(h).typeId)],
    hasTag: (h, t) => itemTags(needItem(h).typeId).includes(t),
    isStackableWith: (h, o) => { const a = needItem(h); const b = H.get(o).it; return a.typeId === b.typeId && a.nameTag === b.nameTag && ITEM_MAX(a.typeId) > 1; },
    getCanDestroy: (h) => [...(needItem(h).canDestroy ?? [])],
    getCanPlaceOn: (h) => [...(needItem(h).canPlaceOn ?? [])],
    setCanDestroy: (h, l) => { needItem(h).canDestroy = validBlocks(l); },
    setCanPlaceOn: (h, l) => { needItem(h).canPlaceOn = validBlocks(l); },
    getDynamicProperty: (h, k) => needItem(h).dyn?.[k],
    setDynamicProperty: (h, k, v) => { const s = needItem(h); dynSet(s, k, v); },
    setDynamicProperties: (h, m) => { const s = needItem(h); for (const [k, v] of $Object.entries(m)) dynSet(s, k, v); },
    getDynamicPropertyIds: (h) => $Object.keys(needItem(h).dyn ?? {}),
    getDynamicPropertyTotalByteCount: (h) => dynBytes($Object.entries(needItem(h).dyn ?? {})),
    clearDynamicProperties: (h) => { needItem(h).dyn = {}; },
  },
  get: {
    typeId: (h) => needItem(h).typeId,
    type: (h) => itemTypeObj(needItem(h).typeId),
    amount: (h) => needItem(h).amount,
    maxAmount: (h) => ITEM_MAX(needItem(h).typeId),
    isStackable: (h) => ITEM_MAX(needItem(h).typeId) > 1,
    nameTag: (h) => needItem(h).nameTag,
    keepOnDeath: (h) => Boolean(needItem(h).keepOnDeath),
    lockMode: (h) => needItem(h).lockMode ?? 'none',
    isValid: (h) => h.valid(),
  },
  set: {
    amount: (h, v) => { const s = needItem(h); const max = ITEM_MAX(s.typeId); s.amount = $Math.max(1, $Math.min(max, v)); },
    nameTag: (h, v) => { needItem(h).nameTag = v; },
    keepOnDeath: (h, v) => { needItem(h).keepOnDeath = v; },
    lockMode: (h, v) => { needItem(h).lockMode = v; },
  },
};
function validBlocks(list) {
  const out = [];
  for (const id of list ?? []) {
    const full = blockTypeId(id);
    if (!full) throw fail('Error', `ブロック ${id} はありません`);
    // 実機は「minecraft:」を外し、旧版で 1 つの ID を分け合っていたブロックにまで広げる（全 1477 種を実測）
    for (const x of (M.canDestroyExpand ?? {})[full] ?? [full.slice(10)]) if (!out.includes(x)) out.push(x);
  }
  return out;
}
function dynSet(obj, k, v) {
  if (obj.typeId && obj.amount !== undefined && ITEM_MAX(obj.typeId) > 1) {
    throw fail('UnsupportedFunctionalityError', 'Unsupported functionality: Cannot set dynamic properties on stackable items.');
  }
  obj.dyn ??= {};
  if (v === undefined) delete obj.dyn[k];
  else obj.dyn[k] = typeof v === 'object' ? Vec(v) : v;
}
$Object.assign(IMPL.ItemStack.fns, {
  getRawLore: (h) => h.it.lore.map((t) => ({ text: t })),
  setLore: (h, l) => { h.it.lore = (l ?? []).map((x) => rawText(x)); },
  setDynamicProperty: (h, k, v) => dynSet(h.it, k, v),
  setDynamicProperties: (h, m) => { for (const [k, v] of $Object.entries(m)) dynSet(h.it, k, v); },
  getDynamicPropertyTotalByteCount: (h) => dynBytes($Object.entries(h.it.dyn ?? {})),
  getCanDestroy: (h) => [...(h.it.canDestroy ?? [])],
  getCanPlaceOn: (h) => [...(h.it.canPlaceOn ?? [])],
  setCanDestroy: (h, l) => { h.it.canDestroy = validBlocks(l); },
  setCanPlaceOn: (h, l) => { h.it.canPlaceOn = validBlocks(l); },
  getTags: (h) => [...itemTags(h.it.typeId)],
  hasTag: (h, t) => itemTags(h.it.typeId).includes(t),
  getComponents: (h) => (M.items[h.it.typeId]?.comps ?? []).map((c) => { try { return (itemComponentRef.fn ?? itemComponent)(h, c); } catch { return undefined; } }).filter(Boolean),
  hasComponent: (h, id) => (M.items[h.it.typeId]?.comps ?? []).includes(fullId(id)),
  getComponent: (h, id) => (itemComponentRef.fn ?? itemComponent)(h, id),
  _oldGetComponent: (h, id) => {
    const k = $String(id).replace(/^minecraft:/, '');
    if (k === 'durability' || k === 'enchantable' || k === 'food' || k === 'cooldown' || k === 'potion' || k === 'book' || k === 'dyeable' || k === 'inventory' || k === 'compostable') return NI(`itemStack.getComponent('${k}')`);
    return undefined;
  },
});
const itemTags = (id) => M.items[id]?.tags ?? packDef('items', id)?.tags ?? [];
/** アイテムのコンポーネント。実測で「その種類が持つ」とわかったものだけ返す */
function itemComponent(h, id) {
  const full = fullId(id);
  const k = full.slice(10);
  const data = M.items[h.it.typeId];
  if (data && !data.comps?.includes(full)) return undefined;
  if (k === 'durability') return once('ItemDurabilityComponent', (h.it._dur ??= { it: h.it, typeId: full, valid: () => true }));
  if (k === 'food' && data?.food) return once('ItemFoodComponent', (h.it._food ??= { it: h.it, typeId: full, valid: () => true }));
  if (!data && k !== 'durability' && k !== 'food') return undefined;
  const icls = API.modules['@minecraft/server'].componentMaps.ItemComponentTypeMap[full];
  const measured = data?.props?.[full];
  if (icls && CLASSES[icls] && measured) {
    h.it._generic ??= {};
    if (!h.it._generic[full]) {
      const d2 = {};
      for (const [pk, pv] of $Object.entries(measured)) {
        if (pk === 'isValid' || pv === '__object' || (pv && typeof pv === 'object' && pv.error)) continue;
        d2[pk] = pv === '__undefined' ? undefined : pv;
      }
      h.it._generic[full] = { it: h.it, typeId: full, data: d2, valid: () => true };
    }
    return once(icls, h.it._generic[full]);
  }
  bump(S.unsupported, `ItemStack.getComponent(${k})`);
  throw new SandboxNotImplemented(`itemStack.getComponent('${k}')（${h.it.typeId} は実機でこのコンポーネントを持っていますが、中身は再現していません）`);
}
IMPL.ItemDurabilityComponent = {
  fns: {
    // バニラ: 耐久力 Lv の道具は 1/(Lv+1) の確率でしか減らない
    getDamageChance: (h, lv = 0) => $Math.round(100 / (lv + 1)),
    // 実測: 1.26.51 ではこの呼び出しは失敗する
    getDamageChanceRange: () => { throw fail('Error', "Failed to get property 'damageRange'."); },
  },
  get: {
    typeId: () => 'minecraft:durability',
    maxDurability: (h) => M.items[h.it.typeId]?.dur ?? packComp('items', h.it.typeId, 'minecraft:durability')?.max_durability ?? NI(`maxDurability（${h.it.typeId}）`),
    damage: (h) => h.it.damage ?? 0,
    unbreakable: (h) => Boolean(h.it.unbreakable),
  },
  set: {
    damage: (h, v) => {
      const max = M.items[h.it.typeId]?.dur ?? 0;
      if (v < 0) throw fail('Error', `Invalid damage value '${v}' set on item '${h.it.typeId}'. Damage values cannot be negative.`);
      if (v > max) throw fail('Error', `Invalid damage value '${v}' set on item '${h.it.typeId}'. Damage values cannot be greater than maxDurability.`);
      h.it.damage = v;
    },
  },
};
IMPL.ItemFoodComponent = {
  get: {
    typeId: () => 'minecraft:food',
    nutrition: (h) => M.items[h.it.typeId].food[0],
    saturationModifier: (h) => M.items[h.it.typeId].food[1],
    canAlwaysEat: (h) => M.items[h.it.typeId].food[2],
    usingConvertsTo: (h) => M.items[h.it.typeId]?.props?.['minecraft:food']?.usingConvertsTo ?? NI('ItemFoodComponent.usingConvertsTo（この品は未測定）'),
  },
};
IMPL.ItemStack.get.lockMode = (h) => h.it.lockMode ?? 'none';
IMPL.ItemStack.set.lockMode = (h, v) => { h.it.lockMode = v; };
// コンテナの操作で動的プロパティなどを落とさない
const copyItemFull = (it) => ({ ...it, lore: [...(it.lore ?? [])], dyn: it.dyn ? { ...it.dyn } : undefined });
// eslint-disable-next-line no-func-assign
copyItemRef.fn = copyItemFull;

// ---- ブロックの付随データ（看板・コンテナ・水没） ------------------------------------
const blockData = new $Map();
const CONTAINER_SIZE = {
  chest: 27, trapped_chest: 27, barrel: 27, hopper: 5, dispenser: 9, dropper: 9,
  furnace: 3, blast_furnace: 3, smoker: 3, lit_furnace: 3, lit_blast_furnace: 3, lit_smoker: 3, brewing_stand: 5, crafter: 9,
};
const containerSize = (id) => {
  // パックの定義（minecraft:block_entity の container.slot_count）が最優先。実機もこれを読む
  const packSlots = packComp('blocks', id, 'minecraft:block_entity')?.container?.slot_count;
  if (typeof packSlots === 'number' && packSlots > 0) return packSlots;
  const measured = M.blockComponents?.[id]?.comps?.['minecraft:inventory']?.size;
  if (measured) return measured;
  const n = id.slice(10);
  if (/shulker_box$/.test(n)) return 27;
  return CONTAINER_SIZE[n];
};
const isSign = (id) => /_sign$|^minecraft:(standing|wall)_sign$/.test(id);
function bdata(dim, p, create = true) {
  const k = key(dim, p.x, p.y, p.z);
  let d = blockData.get(k);
  const id = readBlock(dim, p.x, p.y, p.z).id;
  if (d && d.id !== id) { blockData.delete(k); d = undefined; }
  if (!d && create) { d = { id }; blockData.set(k, d); }
  return d;
}
IMPL.Block.fns.getComponent = (h, id) => {
  assertLoaded(h);
  const k = $String(id).replace(/^minecraft:/, '');
  const bid = readBlock(h.dim, h.p.x, h.p.y, h.p.z).id;
  if (k === 'inventory') {
    const size = containerSize(bid);
    if (!size) return undefined;
    const d = bdata(h.dim, h.p);
    d.inventory ??= new Array(size).fill(null);
    const pseudo = { inventory: d.inventory, blockContainer: true, get valid() { return readBlock(h.dim, h.p.x, h.p.y, h.p.z).id === bid && chunkLoaded(h.dim, h.p.x, h.p.z); } };
    return inst('BlockInventoryComponent', { dim: h.dim, p: h.p, pseudo, typeId: 'minecraft:inventory', valid: () => pseudo.valid });
  }
  if (k === 'sign') {
    if (!isSign(bid)) return undefined;
    const d = bdata(h.dim, h.p);
    d.sign ??= { Front: { text: '', dye: undefined }, Back: { text: '', dye: undefined }, waxed: false };
    return inst('BlockSignComponent', { dim: h.dim, p: h.p, sign: d.sign, typeId: 'minecraft:sign', valid: () => readBlock(h.dim, h.p.x, h.p.y, h.p.z).id === bid });
  }
  if (VANILLA_BLOCK_COMPONENTS.has(k)) return NI(`block.getComponent('${k}')`);
  return undefined;
};
const VANILLA_BLOCK_COMPONENTS = new $Set(['fluid_container', 'instrument_sound', 'map_color', 'movable', 'piston', 'precipitation_interactions', 'record_player', 'redstone_producer', 'dynamic_properties']);
IMPL.Block.fns.hasComponent = function hasComponent(h, id) { return this.getComponent(id) !== undefined; };
IMPL.Block.fns.getComponents = function getComponents(h) {
  return ['inventory', 'sign'].map((k) => this.getComponent(k)).filter(Boolean);
};
IMPL.Block.fns.setWaterlogged = (h, v) => {
  assertLoaded(h);
  const id = readBlock(h.dim, h.p.x, h.p.y, h.p.z).id;
  if (id === 'minecraft:air') throw fail('Error', '空気は水没させられません');
  bdata(h.dim, h.p).waterlogged = Boolean(v);
};
IMPL.Block.get.isWaterlogged = (h) => Boolean(bdata(h.dim, h.p, false)?.waterlogged);
IMPL.BlockComponent = { get: { block: (h) => blockObj(h.dim, h.p) } };
// ブロックのコンテナが消えたあとは、理由の無い短い文言になる（実測）
IMPL.BlockInventoryComponent = { get: { container: (h) => { h.pseudo._c ??= { e: h.pseudo, valid: () => h.pseudo.valid, invalidError: (what) => fail('Error', `Failed to ${what}.`) }; return once('Container', h.pseudo._c); } } };
IMPL.BlockSignComponent = {
  fns: {
    // 実測: RawMessage を入れると getText は undefined、getRawText はそのまま返る
    getText: (h, side = 'Front') => (h.sign[side].raw ? undefined : h.sign[side].text),
    getRawText: (h, side = 'Front') => (h.sign[side].raw ? $JSON.parse($JSON.stringify(h.sign[side].raw)) : { rawtext: [{ text: h.sign[side].text }] }),
    setText: (h, m, side = 'Front') => {
      if (typeof m === 'string') { h.sign[side].text = m; h.sign[side].raw = null; return; }
      h.sign[side].raw = $JSON.parse($JSON.stringify(m));
      h.sign[side].text = rawText(m);
    },
    getTextDyeColor: (h, side = 'Front') => h.sign[side].dye,
    setTextDyeColor: (h, c, side = 'Front') => { h.sign[side].dye = c ?? undefined; },
    setWaxed: (h, v) => { h.sign.waxed = Boolean(v); },
  },
  get: { isWaxed: (h) => h.sign.waxed },
};
