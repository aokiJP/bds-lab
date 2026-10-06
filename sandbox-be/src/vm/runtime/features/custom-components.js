// パックで付けたカスタムコンポーネント（blocks/*.json・items/*.json の minecraft: 以外の名前）。
//
// ここで再現するのは「定義に書いた名前とパラメータが getComponent から読める」ところまで。
// 登録した処理（onPlayerBreak・onUse など）を実際に呼ぶのはまだ再現していないので、
// registerCustomComponent の側で未再現の印を付けている（structures-commands.js）。
// 実機とパラメータの渡り方（凍結するか・配列の扱い）は較正で確かめる。

// 型と定義そのものは state.js の PACK が持つ。ここはそのカスタムコンポーネントの部分だけを見る
// カスタムの名前は必ず名前空間付き（'demo:thing'）。'inventory' のような省略形はバニラ側
const isCustomName = (n) => n.includes(':') && !n.startsWith('minecraft:');
const customDefsFor = (kind, id) => packDef(kind, id)?.custom ?? null;

/** パラメータは読み取り専用で渡す（実機でも書き換えは効かない）。同じ定義には同じオブジェクトを返す */
const paramsCache = new $Map();
function frozenParams(key, value) {
  if (!paramsCache.has(key)) {
    const deepFreeze = (v) => {
      if (!v || typeof v !== 'object') return v;
      for (const k of $Object.keys(v)) deepFreeze(v[k]);
      return $Object.freeze(v);
    };
    paramsCache.set(key, deepFreeze($JSON.parse($JSON.stringify(value ?? {}))));
  }
  return paramsCache.get(key);
}

IMPL.CustomComponentParameters = { get: { params: (h) => h.params } };
const paramsObj = (key, value) => once('CustomComponentParameters', (paramHandles[key] ??= { params: frozenParams(key, value) }));
const paramHandles = {};

IMPL.BlockCustomComponentInstance = {
  get: { customComponentParameters: (h) => paramsObj(`block:${h.blockId}:${h.typeId}`, h.params) },
};
IMPL.ItemCustomComponentInstance = {
  get: { customComponentParameters: (h) => paramsObj(`item:${h.itemId}:${h.typeId}`, h.params) },
};

// ---- ブロック側 ---------------------------------------------------------------------
const prevBlockComponentCustom = IMPL.Block.fns.getComponent;
IMPL.Block.fns.getComponent = function getComponent(h, id) {
  const name = $String(id);
  if (isCustomName(name)) {
    assertLoaded(h);
    const blockId = readBlock(h.dim, h.p.x, h.p.y, h.p.z).id;
    const defs = customDefsFor('blocks', blockId);
    if (defs && name in defs) {
      const d = bdata(h.dim, h.p);
      d.custom ??= {};
      d.custom[name] ??= { dim: h.dim, p: h.p, typeId: name, blockId, params: defs[name], valid: () => readBlock(h.dim, h.p.x, h.p.y, h.p.z).id === blockId };
      return once('BlockCustomComponentInstance', d.custom[name]);
    }
    return undefined;
  }
  return $apply(prevBlockComponentCustom, this, [h, id]);
};
const prevBlockComponentsCustom = IMPL.Block.fns.getComponents;
IMPL.Block.fns.getComponents = function getComponents(h) {
  const list = $apply(prevBlockComponentsCustom, this, [h]);
  const defs = customDefsFor('blocks', readBlock(h.dim, h.p.x, h.p.y, h.p.z).id);
  for (const name of $Object.keys(defs ?? {})) list.push(this.getComponent(name));
  return list.filter(Boolean);
};

// ---- アイテム側 ---------------------------------------------------------------------
const ITEM_COMPONENT_MAP = API.modules['@minecraft/server'].componentMaps.ItemComponentTypeMap;
/** パックで定義した品なら、script から見えるコンポーネントの名前。バニラなら null */
function packItemComponents(typeId) {
  const def = packDef('items', typeId);
  if (!def) return null;
  return $Object.keys(def.components ?? {}).filter((c) => c in ITEM_COMPONENT_MAP);
}
/**
 * 定義ファイルから中身をそのまま作れるアイテムのコンポーネント。
 * 値の対応が 1 対 1 に決まるものだけ（決まらないものは未再現として知らせる）。
 */
const PACK_ITEM_COMPONENTS = {
  // クールダウン: category はそのまま、duration は秒なので tick に直す
  'minecraft:cooldown': { props: ['cooldownCategory', 'cooldownTicks'], make: (raw) => ({ data: { cooldownCategory: $String(raw?.category ?? ''), cooldownTicks: $Math.round($Number(raw?.duration ?? 0) * 20) } }) },
  'minecraft:compostable': { props: ['compostingChance'], make: (raw) => (typeof raw?.composting_chance === 'number' ? { data: { compostingChance: raw.composting_chance } } : null) },
};

const prevItemComponentCustom = itemComponentRef.fn ?? itemComponent;
itemComponentRef.fn = (h, id) => {
  const name = $String(id);
  if (isCustomName(name)) {
    const defs = customDefsFor('items', h.it.typeId);
    if (defs && name in defs) {
      h.it._custom ??= {};
      h.it._custom[name] ??= { it: h.it, typeId: name, itemId: h.it.typeId, params: defs[name], valid: () => true };
      return once('ItemCustomComponentInstance', h.it._custom[name]);
    }
    return undefined;
  }
  const list = packItemComponents(h.it.typeId);
  if (!list) return prevItemComponentCustom(h, id);
  // パックで定義した品。実機と同じく、持っているかどうかは定義ファイルが決める
  const full = fullId(name);
  if (!list.includes(full)) return undefined;
  // 定義からそのまま作れるものは作る
  const build = PACK_ITEM_COMPONENTS[full];
  if (build) {
    const made = build.make(packComp('items', h.it.typeId, full));
    if (made) {
      h.it._packComps ??= {};
      h.it._packComps[full] ??= { it: h.it, typeId: full, ...made, valid: () => true };
      return once(ITEM_COMPONENT_MAP[full], h.it._packComps[full]);
    }
  }
  if (isMarkComponent(ITEM_COMPONENT_MAP[full])) {
    h.it._packMarks ??= {};
    return once(ITEM_COMPONENT_MAP[full], (h.it._packMarks[full] ??= { it: h.it, typeId: full, valid: () => true }));
  }
  const got = prevItemComponentCustom(h, id);
  if (got !== undefined) return got;
  softNI(`itemStack.getComponent('${full}')（パックで定義した ${h.it.typeId}。中身は実機で測っていません）`);
  return undefined;
};
const prevItemHasComponent = IMPL.ItemStack.fns.hasComponent;
IMPL.ItemStack.fns.hasComponent = function hasComponent(h, id) {
  const list = packItemComponents(h.it.typeId);
  if (!list) return $apply(prevItemHasComponent, this, [h, id]);
  const name = $String(id);
  if (isCustomName(name)) return Boolean(customDefsFor('items', h.it.typeId)?.[name]);
  return list.includes(fullId(name));
};
const prevItemGetComponents = IMPL.ItemStack.fns.getComponents;
IMPL.ItemStack.fns.getComponents = function getComponents(h) {
  const list = packItemComponents(h.it.typeId);
  if (!list) return $apply(prevItemGetComponents, this, [h]);
  const out = [];
  let missing = 0;
  for (const c of list) {
    try { const o = itemComponentRef.fn(h, c); if (o) out.push(o); } catch (err) { if (err instanceof SandboxNotImplemented) missing++; else throw err; }
  }
  for (const name of $Object.keys(customDefsFor('items', h.it.typeId) ?? {})) {
    const o = itemComponentRef.fn(h, name);
    if (o) out.push(o);
  }
  if (missing) notImplemented(new SandboxNotImplemented(`itemStack.getComponents()（${h.it.typeId} の ${missing} 個のコンポーネントは再現していません）`));
  return out;
};

// ---- パックで定義したエンティティのコンポーネント ---------------------------------------
//
// バニラのエンティティは実測データから返している（effects.js）。パックで定義した種類は
// 実測が無いので、定義ファイルに書いてある値をそのまま返す。実機もこの JSON を読む。
// 変換は「定義の鍵 → API のプロパティ」の対応だけ。書いていない値は足さない（既定値の推測はしない）。
const PACK_ENTITY_COMPONENTS = {
  'minecraft:addrider': { cls: 'EntityAddRiderComponent', map: { entity_type: 'entityType', spawn_event: 'spawnEvent' } },
};
// 実機が script に見せるコンポーネントの一覧（公式メタデータ）。定義ファイルに書いてあっても
// この一覧に無いもの（minecraft:collision_box など）は hasComponent でも false になる。
const ENTITY_COMPONENT_MAP = API.modules['@minecraft/server'].componentMaps.EntityComponentTypeMap;
/** パックで定義した種類なら、script から見えるコンポーネントの名前。バニラなら null */
function packEntityComponents(typeId) {
  const def = packDef('entities', typeId);
  if (!def) return null;
  return $Object.keys(def.components ?? {}).filter((c) => c in ENTITY_COMPONENT_MAP);
}
// 親クラスから中身を受け継いでいない（＝そのクラスに書いてあるものが全部）ことの目印。
// 例: EntityMovementComponent は EntityAttributeComponent を継ぐので、自分の props が空でも「印」ではない
const PLAIN_BASES = ['EntityComponent', 'ItemComponent', 'BlockComponent'];
/** そのクラスに書いてあるプロパティ（componentId のような決め打ちと、共通のものを除く） */
function ownProps(cm) {
  return $Object.keys(cm.props).filter((pn) => cm.props[pn].v === undefined && !['typeId', 'entity', 'isValid'].includes(pn));
}
/** 中身が無い「印」だけのコンポーネントか（親を継がず、関数が無く、プロパティが全部決め打ち） */
function isMarkComponent(cls) {
  const cm = cls && CLASSES[cls]?.__meta;
  if (!cm || !PLAIN_BASES.includes(cm.base)) return false;
  return !$Object.keys(cm.fns).length && ownProps(cm).length === 0;
}

// 「value ひとつだけ」のコンポーネント（minecraft:scale・variant・color など）は、
// 定義ファイルの value がそのまま API の value になる。どれがそうかは公式メタデータから拾う
// （関数が無く、決め打ちでないプロパティが value だけのクラス）。手で並べて間違えないように。
// クラスは使われた時点で作られるので、判定も使うときに行う（結果は覚えておく）。
function isValueOnlyComponent(cls) {
  const cm = cls && CLASSES[cls]?.__meta;
  if (!cm || !PLAIN_BASES.includes(cm.base) || $Object.keys(cm.fns).length) return false;
  const props = ownProps(cm);
  return props.length === 1 && props[0] === 'value';
}

const prevEntityComponentCustom = componentOfRef.fn ?? componentOf;
componentOfRef.fn = (e, id) => {
  const full = fullId(id);
  const spec = PACK_ENTITY_COMPONENTS[full];
  const raw = spec && packComp('entities', e.typeId, full);
  if (spec && raw && typeof raw === 'object') {
    const data = {};
    for (const [from, to] of $Object.entries(spec.map)) if (raw[from] !== undefined) data[to] = raw[from];
    e._packComps ??= {};
    e._packComps[full] ??= { e, typeId: full, data, valid: () => e.valid };
    return once(spec.cls, e._packComps[full]);
  }
  const list = packEntityComponents(e.typeId);
  if (!list) return prevEntityComponentCustom(e, id);
  if (list.includes(full) && isValueOnlyComponent(ENTITY_COMPONENT_MAP[full])) {
    const rawV = packComp('entities', e.typeId, full);
    const v = rawV !== null && typeof rawV === 'object' ? rawV.value : rawV;
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
      e._packComps ??= {};
      e._packComps[full] ??= { e, typeId: full, data: { value: v }, valid: () => e.valid };
      return once(ENTITY_COMPONENT_MAP[full], e._packComps[full]);
    }
  }
  // ここから下はパックで定義した種類。持っているかどうかは定義ファイルが決める
  // （体力だけは実機でも必ず持つので、書いていなくても既定のまま返す）
  if (!list.includes(full)) return full === 'minecraft:health' ? prevEntityComponentCustom(e, id) : undefined;
  // 中身が無い「印」だけのコンポーネントは、定義に書いてあればそのまま返せる。
  // 先に見るのは、元の実装が「実機は持っています」と数えてから例外を投げるため
  // （再現できているのに未再現として数えられてしまう）
  if (isMarkComponent(ENTITY_COMPONENT_MAP[full])) {
    e._packMarks ??= {};
    return once(ENTITY_COMPONENT_MAP[full], (e._packMarks[full] ??= { e, typeId: full, valid: () => e.valid }));
  }
  let got;
  try {
    got = prevEntityComponentCustom(e, id);
  } catch (err) {
    if (!(err instanceof SandboxNotImplemented)) throw err;
    throw err;
  }
  if (got !== undefined) return got;
  // 定義には書いてあるが、中身をどう見せるかを実機で測っていない。黙って undefined を返さず知らせる
  softNI(`entity.getComponent('${full}')（パックで定義した ${e.typeId}。中身は実機で測っていません）`);
  return undefined;
};
const prevHasComponentCustom = IMPL.Entity.fns.hasComponent;
IMPL.Entity.fns.hasComponent = function hasComponent(h, id) {
  const list = packEntityComponents(h.e.typeId);
  if (!list) return $apply(prevHasComponentCustom, this, [h, id]);
  const full = fullId(id);
  return list.includes(full) || full === 'minecraft:health';
};
const prevGetComponentsCustom = IMPL.Entity.fns.getComponents;
IMPL.Entity.fns.getComponents = function getComponents(h) {
  const list = packEntityComponents(h.e.typeId);
  if (!list) return $apply(prevGetComponentsCustom, this, [h]);
  const names = list.includes('minecraft:health') ? list : ['minecraft:health', ...list];
  const out = [];
  let missing = 0;
  for (const c of names) {
    try { const o = componentOfRef.fn(h.e, c); if (o) out.push(o); } catch (err) { if (err instanceof SandboxNotImplemented) missing++; else throw err; }
  }
  if (missing) notImplemented(new SandboxNotImplemented(`entity.getComponents()（${h.e.typeId} の ${missing} 個のコンポーネントは再現していません）`));
  return out;
};

// ---- 登録した処理を呼ぶ -----------------------------------------------------------
//
// 実機は、定義ファイルでその名前を付けたブロック・アイテムに対して、登録した処理を呼ぶ。
// 発火の条件は公式ドキュメント（Microsoft Learn / scriptapi-docs）の記述に合わせている:
//
//   ブロック
//     beforeOnPlayerPlace  プレイヤーが置く直前（cancel で取り消せる）
//     onPlace              置かれたあと（previousBlock はその前の並び）
//     onPlayerBreak        プレイヤーが壊したとき
//     onBreak              プレイヤー以外で壊れたとき（爆発など。blockDestructionSource が付く）
//     onPlayerInteract     プレイヤーが正しく触ったとき
//     onStepOn / onStepOff エンティティがそのブロックに乗った・降りたとき
//     onEntityFallOn       エンティティが落ちて着いたとき（fallDistance 付き）
//     onTick               ブロックが tick したとき（定義の minecraft:queued_ticking の間隔）
//     onRandomTick         ランダム tick（定義の minecraft:random_ticking。頻度は randomTickSpeed）
//   アイテム
//     onUse                プレイヤーが使ったとき
//     onUseOn              ブロックに対して使ったとき
//     onMineBlock          そのアイテムでブロックを壊したとき
//     onHitEntity          そのアイテムでエンティティを殴ったとき
//     onBeforeDurabilityDamage  殴って耐久が減る直前
//     onConsume            食べられたとき
//     onCompleteUse        使い切ったとき
//
// まだ呼べないのは onRedstoneUpdate（レッドストーンの伝播が要る）・onEntity・onBlockStateChange。
// 登録時にその名前を挙げて未再現だと知らせる。
// 世界のイベント（playerBreakBlock など）との前後関係は実機でまだ測っていない。
const DISPATCHED_BLOCK = ['beforeOnPlayerPlace', 'onPlace', 'onPlayerBreak', 'onBreak', 'onPlayerInteract', 'onStepOn', 'onStepOff', 'onEntityFallOn', 'onTick', 'onRandomTick', 'onBlockStateChange', 'onRedstoneUpdate', 'onEntity'];
const DISPATCHED_ITEM = ['onUse', 'onUseOn', 'onMineBlock', 'onHitEntity', 'onBeforeDurabilityDamage', 'onConsume', 'onCompleteUse'];

/** そのブロック・アイテムに付いているカスタムコンポーネントを、定義に書いてある順に返す */
function attachedCustom(kind, typeId, handler) {
  const defs = customDefsFor(kind, typeId);
  if (!defs) return [];
  const reg = kind === 'blocks' ? CUSTOM.blockComps : CUSTOM.itemComps;
  const out = [];
  for (const [name, params] of $Object.entries(defs)) {
    const comp = reg.get(name);
    if (comp && typeof comp[handler] === 'function') out.push({ name, params, fn: comp[handler] });
  }
  return out;
}

/** ブロック側を呼ぶ。data はイベントのプロパティそのまま */
function fireBlockCustom(handler, cls, { dim, p, blockId, data }) {
  const list = attachedCustom('blocks', blockId, handler);
  for (const c of list) {
    const ev = inst(cls, { dim, p, data: { block: blockObj(dim, p), dimension: dimObj(dim), ...data } });
    call(`customComponent:${c.name}.${handler}`, c.fn, [ev, paramsObj(`block:${blockId}:${c.name}`, c.params)]);
  }
  return list.length > 0;
}

/** アイテム側を呼ぶ */
function fireItemCustom(handler, cls, { itemId: id, data }) {
  for (const c of attachedCustom('items', id, handler)) {
    const ev = inst(cls, { data });
    call(`customComponent:${c.name}.${handler}`, c.fn, [ev, paramsObj(`item:${id}:${c.name}`, c.params)]);
  }
}

customDispatchRef.fn = (kind, ctx) => {
  switch (kind) {
    case 'blockPlace': return fireBlockCustom('onPlace', 'BlockComponentOnPlaceEvent', ctx);
    case 'blockPlayerBreak': return fireBlockCustom('onPlayerBreak', 'BlockComponentPlayerBreakEvent', ctx);
    case 'blockBreak': return fireBlockCustom('onBreak', 'BlockComponentBlockBreakEvent', ctx);
    case 'blockPlayerInteract': return fireBlockCustom('onPlayerInteract', 'BlockComponentPlayerInteractEvent', ctx);
    case 'blockStepOn': return fireBlockCustom('onStepOn', 'BlockComponentStepOnEvent', ctx);
    case 'blockStepOff': return fireBlockCustom('onStepOff', 'BlockComponentStepOffEvent', ctx);
    case 'blockEntityFallOn': return fireBlockCustom('onEntityFallOn', 'BlockComponentEntityFallOnEvent', ctx);
    case 'blockTick': return fireBlockCustom('onTick', 'BlockComponentTickEvent', ctx);
    case 'blockStateChange': return fireBlockCustom('onBlockStateChange', 'BlockComponentBlockStateChangeEvent', ctx);
    case 'blockRedstone': return fireBlockCustom('onRedstoneUpdate', 'BlockComponentRedstoneUpdateEvent', ctx);
    case 'blockEntityEvent': return fireBlockCustom('onEntity', 'BlockComponentEntityEvent', ctx);
    case 'blockRandomTick': return fireBlockCustom('onRandomTick', 'BlockComponentRandomTickEvent', ctx);
    case 'itemUse': return fireItemCustom('onUse', 'ItemComponentUseEvent', ctx);
    case 'itemUseOn': return fireItemCustom('onUseOn', 'ItemComponentUseOnEvent', ctx);
    case 'itemMineBlock': return fireItemCustom('onMineBlock', 'ItemComponentMineBlockEvent', ctx);
    case 'itemHitEntity': return fireItemCustom('onHitEntity', 'ItemComponentHitEntityEvent', ctx);
    case 'itemDurability': return fireItemCustom('onBeforeDurabilityDamage', 'ItemComponentBeforeDurabilityDamageEvent', ctx);
    case 'itemConsume': return fireItemCustom('onConsume', 'ItemComponentConsumeEvent', ctx);
    case 'itemCompleteUse': return fireItemCustom('onCompleteUse', 'ItemComponentCompleteUseEvent', ctx);
    default: return false;
  }
};

/** 置く直前に呼ぶ（cancel を見るので、ほかと違って戻り値を使う） */
customDispatchRef.beforePlace = (dim, p, blockId, data) => {
  const list = attachedCustom('blocks', blockId, 'beforeOnPlayerPlace');
  if (!list.length) return false;
  const shared = { cancel: false, block: blockObj(dim, p), dimension: dimObj(dim), ...data };
  for (const c of list) {
    const ev = inst('BlockComponentPlayerPlaceBeforeEvent', { dim, p, data: shared });
    call(`customComponent:${c.name}.beforeOnPlayerPlace`, c.fn, [ev, paramsObj(`block:${blockId}:${c.name}`, c.params)]);
  }
  return shared.cancel === true;
};

// ---- ブロックの tick と、乗った・降りた・落ちてきた -------------------------------------
//
// 置いてあるブロック（世界に書き込まれたぶん）だけを見る。自然地形にカスタムブロックは無い。
const tickState = new $Map();   // "dim|x|y|z" → 次に onTick を呼ぶ tick
const numOf = (v, fallback) => (typeof v === 'number' ? v : fallback);

function queuedInterval(blockId) {
  // 公式は minecraft:tick。古い書き方（minecraft:queued_ticking）も受ける
  const q = packComp('blocks', blockId, 'minecraft:tick') ?? packComp('blocks', blockId, 'minecraft:queued_ticking');
  if (!q) return null;
  const range = q.interval_range ?? [10, 10];
  const lo = numOf(range[0], 10);
  const hi = numOf(range[1], lo);
  return { lo, hi, looping: q.looping !== false };
}

// カスタムコンポーネントの付いたブロックだけの索引。毎 tick 世界じゅうのブロックを
// 見に行かずに済む（置いたブロックが増えても tick の重さが変わらない）。
// 世界に書き込む口は writeBlock 1 つなので、そこから来る変化だけで最新に保てる。
const customBlocks = new $Map(); // "dim|x|y|z" → { dim, p, id }
function indexCustomBlock(k, dim, p, id) {
  if (customDefsFor('blocks', id)) customBlocks.set(k, { dim, p, id });
  else customBlocks.delete(k);
}
for (const [k, perm] of blocks) {   // 世界の初期配置ぶん
  const i = k.indexOf('|');
  const [x, y, z] = k.slice(i + 1).split('|').map($Number);
  indexCustomBlock(k, k.slice(0, i), { x, y, z }, perm.id);
}

END_HOOKS.push(() => {
  // --- ブロックの tick（minecraft:tick / minecraft:random_ticking）とレッドストーン
  const speed = numOf(G.gameRules.randomTickSpeed, 1);
  for (const { dim, p, id } of [...customBlocks.values()]) {
    const k = `${dim}|${p.x}|${p.y}|${p.z}`;
    const perm = { id };
    const q = queuedInterval(perm.id);
    if (q) {
      let next = tickState.get(k);
      if (next === undefined) { next = S.tick + q.lo + $Math.floor(random() * (q.hi - q.lo + 1)); tickState.set(k, next); }
      if (S.tick >= next) {
        customDispatchRef.fn('blockTick', { dim, p, blockId: perm.id, data: {} });
        tickState.set(k, q.looping ? S.tick + q.lo + $Math.floor(random() * (q.hi - q.lo + 1)) : Infinity);
      }
    }
    // バニラと同じ割合: 1 tick・1 チャンク区画（4096 ブロック）あたり 3 回 × randomTickSpeed
    if (packComp('blocks', perm.id, 'minecraft:random_ticking') && speed > 0 && random() < (3 * speed) / 4096) {
      customDispatchRef.fn('blockRandomTick', { dim, p, blockId: perm.id, data: {} });
    }
    // レッドストーン: 隣の minecraft:redstone_producer から拾った強さが変わったとき
    const consumer = packComp('blocks', perm.id, 'minecraft:redstone_consumer');
    if (consumer) {
      const power = redstonePowerAt(dim, p);
      const before = redstoneState.get(k) ?? 0;
      if (power !== before) {
        redstoneState.set(k, power);
        if (power >= numOf(consumer.min_power, 0)) {
          customDispatchRef.fn('blockRedstone', { dim, p, blockId: perm.id, data: { powerLevel: power, previousPowerLevel: before } });
        }
      }
    }
  }

  // --- 乗った・降りた・落ちて着いた
  //
  // 「乗った・降りた」は足元のブロックが変わったとき。「落ちて着いた」はそれとは別で、
  // 空中から地面に着いた tick（実機の fallDistance と同じく、落ち始めてからの最高点との差）。
  // 落ちている途中でブロックの真上に入るのは着地の 1 tick 前なので、同じ判定にまとめると取り逃す。
  for (const e of entities.values()) {
    if (!e.valid) continue;
    const under = { x: $Math.floor(e.loc.x), y: $Math.floor(e.loc.y) - 1, z: $Math.floor(e.loc.z) };
    const nowKey = `${e.dim}|${under.x}|${under.y}|${under.z}`;
    const grounded = onGround(e);
    if (!grounded) e._fallPeak = $Math.max(e._fallPeak ?? e.loc.y, e.loc.y);

    const prev = e._standOn;
    const id = readBlock(e.dim, under.x, under.y, under.z).id;
    if (prev?.key !== nowKey) {
      if (prev) customDispatchRef.fn('blockStepOff', { dim: prev.dim, p: prev.p, blockId: prev.id, data: { entity: entityObj(e) } });
      e._standOn = { key: nowKey, dim: e.dim, p: under, id };
      if (id !== 'minecraft:air') {
        customDispatchRef.fn('blockStepOn', { dim: e.dim, p: under, blockId: id, data: { entity: entityObj(e) } });
      }
    }

    // 空中 → 地面。実機は minecraft:entity_fall_on を持つブロックだけ、min_fall_distance は既定 1
    if (grounded && e._airborne === true && id !== 'minecraft:air') {
      const fallOn = packComp('blocks', id, 'minecraft:entity_fall_on');
      const fell = $Math.max(0, (e._fallPeak ?? e.loc.y) - e.loc.y);
      if (fallOn && fell >= numOf(fallOn.min_fall_distance, 1)) {
        customDispatchRef.fn('blockEntityFallOn', { dim: e.dim, p: under, blockId: id, data: { entity: entityObj(e), fallDistance: fell } });
      }
    }
    e._airborne = !grounded;
    if (grounded) e._fallPeak = e.loc.y;
  }
});

// ---- ブロックの動的プロパティ（minecraft:block_entity の dynamic_properties） -------------
//
// 実機では、定義に minecraft:block_entity: { dynamic_properties: true } を書いたブロックだけが
// script から minecraft:dynamic_properties コンポーネントを持つ（バニラのブロックは 1 つも持たない。
// 1477 ブロックを実測して確認済み）。中身の規則はエンティティ・アイテム側と同じ。
const hasBlockEntityDyn = (blockId) => {
  const be = packComp('blocks', blockId, 'minecraft:block_entity');
  return Boolean(be && be.dynamic_properties === true);
};
IMPL.BlockDynamicPropertiesComponent = {
  fns: {
    get: (h, k) => { const v = bdata(h.dim, h.p).bdyn?.[k]; return v && typeof v === 'object' ? { z: v.z, y: v.y, x: v.x } : v; },
    set(h, k, v) {
      const d = bdata(h.dim, h.p);
      if (v === undefined) { if (d.bdyn) delete d.bdyn[k]; return; }
      if (typeof v === 'object' && (v === null || typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number')) throw new $TypeError('Native variant type conversion failed.');
      dynCheck(k, v);
      (d.bdyn ??= {})[k] = typeof v === 'object' ? { x: v.x, y: v.y, z: v.z } : v;
    },
    totalByteCount: (h) => dynBytes($Object.entries(bdata(h.dim, h.p).bdyn ?? {})),
  },
};
const prevBlockComponentDyn = IMPL.Block.fns.getComponent;
IMPL.Block.fns.getComponent = function getComponent(h, id) {
  if (fullId(id) === 'minecraft:dynamic_properties') {
    assertLoaded(h);
    const blockId = readBlock(h.dim, h.p.x, h.p.y, h.p.z).id;
    if (!hasBlockEntityDyn(blockId)) return undefined;
    const d = bdata(h.dim, h.p);
    d._dynH ??= { dim: h.dim, p: h.p, typeId: 'minecraft:dynamic_properties', valid: () => readBlock(h.dim, h.p.x, h.p.y, h.p.z).id === blockId };
    return once('BlockDynamicPropertiesComponent', d._dynH);
  }
  return $apply(prevBlockComponentDyn, this, [h, id]);
};

// ---- パックで定義したブロックのコンポーネント ------------------------------------------
//
// エンティティ・アイテムと同じ考え方。パックがそのブロックを定義しているなら、実機は
// バニラの中身ではなく定義ファイルを読む。持っているかどうかは定義が決める。
const BLOCK_COMPONENT_MAP = API.modules['@minecraft/server'].componentMaps.BlockComponentTypeMap;
/** パックで定義したブロックなら、script から見えるコンポーネントの名前。バニラなら null */
function packBlockComponents(blockId) {
  const def = packDef('blocks', blockId);
  if (!def) return null;
  const names = $Object.keys(def.components ?? {}).filter((c) => c in BLOCK_COMPONENT_MAP);
  const be = def.components?.['minecraft:block_entity'];
  if (be?.container?.slot_count) names.push('minecraft:inventory');
  if (be?.dynamic_properties === true) names.push('minecraft:dynamic_properties');
  return [...new $Set(names)];
}
/**
 * 定義ファイルの値（snake_case）を、公式メタデータの列挙のどれかに当てる。
 * 下線と大文字小文字を無視してちょうど 1 つに当たったときだけ返す（当てずっぽうはしない）。
 */
function toEnum(enumName, raw) {
  if (typeof raw !== 'string') return undefined;
  const want = raw.replace(/_/g, '').toLowerCase();
  const hit = $Object.keys(API.modules['@minecraft/server'].enums[enumName] ?? {}).filter((v) => v.toLowerCase() === want);
  return hit.length === 1 ? hit[0] : undefined;
}
/**
 * 定義ファイルから中身をそのまま作れるブロックのコンポーネント。
 * 値の対応が 1 対 1 に決まるものだけ（決まらないものは今までどおり未再現として知らせる）。
 */
const PACK_BLOCK_COMPONENTS = {
  'minecraft:movable': { props: ['movementType', 'stickyType'], make: (raw) => {
    const movementType = toEnum('MovementType', raw?.movement_type);
    if (!movementType) return null;
    return { data: { movementType, stickyType: toEnum('StickyType', raw?.sticky_type) ?? 'None' } };
  } },
  'minecraft:redstone_producer': { props: ['power'], make: (raw) => {
    if (typeof raw?.power !== 'number') return null;
    const faces = ($Array.isArray(raw.connected_faces) ? raw.connected_faces : []).map((f) => toEnum('Direction', f));
    if (faces.some((f) => f === undefined)) return null;
    const strong = raw.strongly_powered_face === undefined ? undefined : toEnum('Direction', raw.strongly_powered_face);
    if (raw.strongly_powered_face !== undefined && !strong) return null;
    return { data: { power: raw.power }, measured: { faces, strong } };
  } },
};

const blockIdAt = (h) => readBlock(h.dim, h.p.x, h.p.y, h.p.z).id;
const prevBlockGetComponentPack = IMPL.Block.fns.getComponent;
IMPL.Block.fns.getComponent = function getComponent(h, id) {
  const name = $String(id);
  if (isCustomName(name)) return $apply(prevBlockGetComponentPack, this, [h, id]);
  assertLoaded(h);
  const bid = blockIdAt(h);
  const list = packBlockComponents(bid);
  // 定義に書いていない＝実機も持たない。例外を投げずに undefined を返す
  const full = fullId(name);
  if (list && !list.includes(full)) return undefined;
  // 定義からそのまま作れるものは作る
  const build = list && PACK_BLOCK_COMPONENTS[full];
  if (build) {
    const made = build.make(packComp('blocks', bid, full));
    if (made) {
      const d = bdata(h.dim, h.p);
      d.packComps ??= {};
      d.packComps[full] ??= { dim: h.dim, p: h.p, typeId: full, ...made, valid: () => blockIdAt(h) === bid };
      return once(BLOCK_COMPONENT_MAP[full], d.packComps[full]);
    }
  }
  return $apply(prevBlockGetComponentPack, this, [h, id]);
};
const prevBlockHasComponentPack = IMPL.Block.fns.hasComponent;
IMPL.Block.fns.hasComponent = function hasComponent(h, id) {
  assertLoaded(h);
  const bid = blockIdAt(h);
  const name = $String(id);
  if (isCustomName(name)) return Boolean(customDefsFor('blocks', bid)?.[name]);
  const list = packBlockComponents(bid);
  if (!list) return $apply(prevBlockHasComponentPack, this, [h, id]);
  return list.includes(fullId(name));
};
const prevBlockGetComponentsPack = IMPL.Block.fns.getComponents;
IMPL.Block.fns.getComponents = function getComponents(h) {
  assertLoaded(h);
  const bid = blockIdAt(h);
  const list = packBlockComponents(bid);
  if (!list) return $apply(prevBlockGetComponentsPack, this, [h]);
  const out = [];
  let missing = 0;
  for (const c of list) {
    try { const o = this.getComponent(c); if (o) out.push(o); } catch (err) { if (err instanceof SandboxNotImplemented) missing++; else throw err; }
  }
  for (const name of $Object.keys(customDefsFor('blocks', bid) ?? {})) {
    const o = this.getComponent(name);
    if (o) out.push(o);
  }
  if (missing) notImplemented(new SandboxNotImplemented(`block.getComponents()（${bid} の ${missing} 個のコンポーネントは再現していません）`));
  return out;
};

// ---- ブロックが書き換わったとき（onPlace / onBlockStateChange） -------------------------
//
// 実機の onPlace は「そのブロックが置かれたとき」で、誰が置いたかは問わない（プレイヤー専用の
// 処理は beforeOnPlayerPlace・onPlayerBreak のほうに分かれている）。なので世界に書き込む口
// （writeBlock）1 か所から出す。Dimension.setBlockType・fillBlocks・/setblock・構造物の配置・
// クローンも、これで実機と同じように呼ばれる。
//   同じ種類のまま状態だけ変わったとき → onBlockStateChange
//   別の種類になったとき               → 新しいほうの onPlace
// 壊れたほうの onBreak は、実機で「置き換え」が破壊として数えられるかを測っていないので出さない
// （爆発のぶんだけ world-misc.js から出している）。
let changeDepth = 0;
blockChangeRef.fn = (dim, p, before, after) => {
  const k = `${dim}|${p.x}|${p.y}|${p.z}`;
  if (before.id !== after.id) { tickState.delete(k); redstoneState.delete(k); indexCustomBlock(k, dim, p, after.id); }
  // 処理の中でまた書き換えたとき、無限に潜らないようにする
  if (changeDepth >= 16) { log('warn', `カスタムコンポーネントがブロックを書き換え続けています: (${p.x}, ${p.y}, ${p.z})`); return; }
  changeDepth++;
  try {
    if (before.id === after.id) {
      customDispatchRef.fn('blockStateChange', { dim, p, blockId: after.id, data: { previousPermutation: permObj(before) } });
      return;
    }
    customDispatchRef.fn('blockPlace', { dim, p, blockId: after.id, data: { previousBlock: permObj(before) } });
    // 公式: レッドストーンの update は「設置・区画の読み込み・強さの変化」で来る。
    // 置かれた直後のぶんをここで出す（強さの変化は END_HOOKS のほう）
    const consumer = packComp('blocks', after.id, 'minecraft:redstone_consumer');
    if (consumer) {
      const power = redstonePowerAt(dim, p);
      redstoneState.set(k, power);
      if (power >= numOf(consumer.min_power, 0)) {
        customDispatchRef.fn('blockRedstone', { dim, p, blockId: after.id, data: { powerLevel: power, previousPowerLevel: 0 } });
      }
    }
  } finally { changeDepth--; }
};

// ---- レッドストーン（minecraft:redstone_consumer / minecraft:redstone_producer） -----------
//
// 実機は minecraft:redstone_consumer を持つブロックに、信号の強さが min_power 以上のとき
// onRedstoneUpdate を送る（公式: update が来るのは「設置・区画の読み込み・強さの変化」）。
// サンドボックスが見るのは隣り合う 6 マスだけ。電源として数えるのは
//   - パックの minecraft:redstone_producer（power）
//   - バニラのうち「向きに関係なく、その場の状態だけで強さが決まる」もの（下の表）
// で、レッドストーンダスト・リピーター・コンパレーター・オブザーバーのように
// 伝播や向きが要るものは再現していない。隣にそれがあるときは黙って 0 にせず、
// 未再現として印を付ける（判定が inconclusive になる。黙って素通りさせない）。
const redstoneState = new $Map();
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** バニラの電源。関われないブロックは null */
function vanillaPower(b) {
  const st = b.states ?? {};
  if (b.id === 'minecraft:redstone_block') return 15;
  if (b.id === 'minecraft:lever') return st.open_bit ? 15 : 0;
  if (b.id === 'minecraft:redstone_torch') return 15;
  if (b.id === 'minecraft:unlit_redstone_torch') return 0;
  if (/_button$/.test(b.id)) return st.button_pressed_bit ? 15 : 0;
  if (b.id === 'minecraft:trip_wire' || b.id === 'minecraft:tripwire') return st.powered_bit ? 15 : 0;
  // redstone_signal はその場の強さそのもの（感圧板・ダスト・日照センサー）
  if (typeof st.redstone_signal === 'number') return st.redstone_signal;
  return null;
}
/** 伝播や向きが要るもの（再現していない） */
const NEEDS_WIRING = /^minecraft:(redstone_wire|(powered_|unpowered_)?(repeater|comparator)|observer|daylight_detector(_inverted)?|detector_rail|target|lectern|(calibrated_)?sculk_sensor)$/;
let wiringWarned = false;

function redstonePowerAt(dim, p) {
  let power = 0;
  for (const [dx, dy, dz] of NEIGHBORS) {
    const n = readBlock(dim, p.x + dx, p.y + dy, p.z + dz);
    const prod = packComp('blocks', n.id, 'minecraft:redstone_producer');
    if (prod) { power = $Math.max(power, numOf(prod.power, 0)); continue; }
    const v = vanillaPower(n);
    if (typeof v === 'number') power = $Math.max(power, v);
    if (NEEDS_WIRING.test(n.id) && !wiringWarned) {
      wiringWarned = true;
      softNI('レッドストーンの伝播（ダスト・リピーター・コンパレーター・オブザーバー。隣り合う電源しか見ていません）');
    }
  }
  return power;
}
