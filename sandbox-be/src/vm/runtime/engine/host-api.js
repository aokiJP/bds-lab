// ホストから呼ぶもの（報告・再現度）

// ---- 外（ホスト）から呼ぶもの --------------------------------------------------

function setVersions(v) { $Object.assign(targetVersion, v); }

function startup() {
  // モジュールの評価（early execution）の後に呼ぶ
  withMode('early', () => {
    const list = handlers.get('system.beforeEvents.startup');
    if (list?.length) {
      const ev = inst('StartupEvent', { data: {}, valid: () => true });
      CUSTOM.open(true);
      try {
        for (const { fn } of [...list]) call('system.beforeEvents.startup', fn, [ev], 'early');
      } finally { CUSTOM.open(false); }
    }
  });
  S.mode = 'normal';
  fireAfter('world.afterEvents', 'worldLoad', {});
  joinPlayers();
}

function diff() {
  const end = snapshot();
  const out = { blocks: [], entities: { added: [], removed: [], changed: [] }, scores: [], world: [] };
  const keys = new $Set([...$Object.keys(initial.blocks), ...$Object.keys(end.blocks)]);
  for (const k of keys) {
    const [dim, x, y, z] = k.split('|');
    const before = initial.blocks[k] ?? { id: natural(dim, +x, +y, +z), states: {} };
    const after = end.blocks[k] ?? { id: natural(dim, +x, +y, +z), states: {} };
    if (before.id === after.id && $JSON.stringify(before.states) === $JSON.stringify(after.states)) continue;
    out.blocks.push({ dimension: dim, at: { x: +x, y: +y, z: +z }, before: before.id, after: after.id, states: $Object.keys(after.states).length ? after.states : undefined });
  }
  out.blocks.sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y || a.at.z - b.at.z);
  const MAXD = CFG.limits?.maxDiffBlocks ?? 5000;
  out.blockCount = out.blocks.length;
  if (out.blocks.length > MAXD) { out.blocks = out.blocks.slice(0, MAXD); out.blocksTruncated = true; }
  for (const [id, e] of $Object.entries(end.entities)) {
    const b = initial.entities[id];
    if (!b) { out.entities.added.push({ id, ...e }); continue; }
    const changes = {};
    for (const k of $Object.keys(e)) if ($JSON.stringify(e[k]) !== $JSON.stringify(b[k])) changes[k] = { before: b[k], after: e[k] };
    if ($Object.keys(changes).length) out.entities.changed.push({ id, typeId: e.typeId, name: e.name, changes });
  }
  for (const [id, b] of $Object.entries(initial.entities)) if (!end.entities[id]) out.entities.removed.push({ id, typeId: b.typeId, name: b.name });
  const objs = new $Set([...$Object.keys(initial.scores), ...$Object.keys(end.scores)]);
  for (const o of objs) {
    const a = initial.scores[o] ?? {};
    const b = end.scores[o] ?? {};
    if (!initial.scores[o]) out.scores.push({ objective: o, change: 'added' });
    if (!end.scores[o]) out.scores.push({ objective: o, change: 'removed' });
    for (const who of new $Set([...$Object.keys(a), ...$Object.keys(b)])) {
      if (a[who] !== b[who]) out.scores.push({ objective: o, participant: who, before: a[who], after: b[who] });
    }
  }
  for (const k of $Object.keys(end.world)) {
    if ($JSON.stringify(end.world[k]) !== $JSON.stringify(initial.world[k])) out.world.push({ key: k, before: initial.world[k], after: end.world[k] });
  }
  const { blocks: _b, ...rest } = end;
  void _b;
  rest.blockOverrides = $Object.keys(end.blocks).length;
  return { diff: out, final: rest };
}

// what a server restart keeps (CFG.carry): the next run takes it as its world (sim's `restart`). Players by name, with the id
// they keep; scripts and what they held in memory are gone
function carry() {
  const plain = (m) => $Object.fromEntries([...m].map(([k, v]) => [k, v && typeof v === 'object' ? { ...v } : v]));
  const players = {}, mobs = [], bl = [];
  for (const e of entities.values()) {
    if (!e.valid) continue;
    const base = { location: { ...e.loc }, rotation: { ...e.rot }, dimension: e.dim, tags: [...e.tags], health: e.health, nameTag: e.nameTag || undefined, dynamicProperties: plain(e.dyn) };
    if (e.player) players[e.name] = { ...base, id: e.id, gameMode: e.gameMode, selectedSlot: e.selectedSlot, inventory: e.inventory.map((i) => (i ? { typeId: i.typeId, amount: i.amount, nameTag: i.nameTag, lore: i.lore } : null)) };
    else mobs.push({ ...base, type: e.typeId });
  }
  for (const [k, v] of blocks) { const [dim, x, y, z] = k.split('|'); bl.push({ dimension: dim, at: { x: +x, y: +y, z: +z }, id: v.id, states: v.states }); }
  const objs = [...objectives.values()].filter((o) => o.valid).map((o) => ({ id: o.id, displayName: o.displayName, scores: [...o.scores].map(([iid, score]) => { const i = identities.get(iid); return { type: i.type, name: i.name, entityId: i.entityId, score }; }).filter((x) => x.type !== 'Entity') }));
  const slots = {}; for (const [k, d] of $Object.entries(displaySlots)) if (d?.o?.valid) slots[k] = { objective: d.o.id, sortOrder: d.sortOrder };
  return { clock: new $Date(now()).toISOString(), world: { timeOfDay: G.timeOfDay, difficulty: G.difficulty, gameRules: { ...G.gameRules }, dynamicProperties: plain(G.dyn), blocks: bl, entities: mobs, objectives: objs, displaySlots: slots }, players };
}

function report() {
  const d = diff();
  return $JSON.stringify({
    ticks: S.tick,
    log: S.log,
    chat: S.chat,
    effects: S.effects,
    forms,
    commands: S.commands,
    diff: d.diff,
    final: d.final,
    carry: CFG.carry ? carry() : undefined,
    usage: $Object.fromEntries([...S.usage].sort((a, b) => b[1] - a[1])),
    unsupported: $Object.fromEntries(S.unsupported),
    uncaught: S.uncaught,
    inconclusive: S.inconclusive,
    pending: { runs: runs.size, jobs: jobs.size, waits: waits.length, actions: actions.length },
  });
}

// どの after/before イベントを実際に起こせるか
const FIRED = new $Set([
  'world.afterEvents.worldLoad', 'world.afterEvents.playerJoin', 'world.afterEvents.playerSpawn',
  'world.afterEvents.playerLeave', 'world.beforeEvents.playerLeave', 'world.afterEvents.entitySpawn',
  'world.afterEvents.entityDie', 'world.afterEvents.entityRemove', 'world.beforeEvents.entityRemove',
  'world.afterEvents.entityHurt', 'world.afterEvents.weatherChange', 'world.afterEvents.playerDimensionChange',
  'world.afterEvents.playerGameModeChange', 'world.beforeEvents.playerGameModeChange',
  'world.afterEvents.playerBreakBlock', 'world.beforeEvents.playerBreakBlock', 'world.afterEvents.playerPlaceBlock',
  'world.afterEvents.itemUse', 'world.beforeEvents.itemUse', 'world.afterEvents.playerInteractWithBlock',
  'world.beforeEvents.playerInteractWithBlock', 'system.afterEvents.scriptEventReceive', 'system.beforeEvents.startup',
]);

// 値そのものを持って作るクラス（実測・公式データ・引数から）。プロパティは h.data から返る
const DATA_BACKED = new $Set([
  'Seat', 'FeedItem', 'PotionEffectType', 'PotionDeliveryType', 'AimAssistCategory', 'AimAssistPreset',
  'AimAssistCategorySettings', 'AimAssistPresetSettings', 'Trigger', 'TextPrimitive', 'CustomCommandOrigin',
  'LootTable', 'LootPool', 'LootPoolEntry', 'LootPoolTiers', 'LootItem', 'LootTableReference', 'LootTableEntry',
  'LootItemFunction', 'LootItemCondition', 'EnchantInfo', 'EntityHealSource',
  'EntityDefinitionFeedItem', 'FeedItemEffect',
]);
const LOOT_BASES = ['LootItemFunction', 'LootItemCondition', 'LootPoolEntry'];
/** 実機で測ったコンポーネントの既定値として返せるプロパティか */
function dataBackedProp(cn, pn) {
  if (DATA_BACKED.has(cn)) return true;
  // パックの定義ファイルから返せるもの（カスタムの型で実際に読める）
  const packSpec = $Object.values(PACK_ENTITY_COMPONENTS).find((sp) => sp.cls === cn);
  if (packSpec && $Object.values(packSpec.map).includes(pn)) return true;
  // 「value ひとつだけ」のコンポーネントと、定義から作る表に書いたもの
  if (pn === 'value' && isValueOnlyComponent(cn)) return true;
  for (const [mapName, table] of [['ItemComponentTypeMap', PACK_ITEM_COMPONENTS], ['BlockComponentTypeMap', PACK_BLOCK_COMPONENTS]]) {
    const name = $Object.entries(API.modules['@minecraft/server'].componentMaps[mapName] ?? {}).find(([, c]) => c === cn)?.[0];
    if (name && table[name]?.props.includes(pn)) return true;
  }
  const base = API.modules['@minecraft/server'].classes[cn]?.base;
  if (LOOT_BASES.includes(base)) return true;
  const maps = API.modules['@minecraft/server'].componentMaps;
  const ent = $Object.entries(maps.EntityComponentTypeMap ?? {}).find(([, c]) => c === cn)?.[0];
  if (ent) return $Object.values(M.entities).some((e) => e.props?.[ent] && pn in e.props[ent]);
  const blk = $Object.entries(maps.BlockComponentTypeMap ?? {}).find(([, c]) => c === cn)?.[0];
  if (blk) return $Object.values(M.blockComponents ?? {}).some((b) => b.comps?.[blk] && pn in b.comps[blk]);
  const itm = $Object.entries(maps.ItemComponentTypeMap ?? {}).find(([, c]) => c === cn)?.[0];
  if (itm) return $Object.values(M.items).some((i) => i.props?.[itm] && pn in i.props[itm]);
  // 基底クラス（EntityNavigationComponent など）の値は、派生クラスの実測データから返る
  return $Object.entries(API.modules['@minecraft/server'].classes).some(([sub, c]) => c.base === cn && sub !== cn && dataBackedProp(sub, pn));
}

/** 振る舞いまで再現している割合（形はすべて実機どおり） */
function coverage() {
  const out = {};
  for (const [mn, mod] of $Object.entries(API.modules)) {
    if (mn === '@minecraft/common') continue;
    const version = targetVersion[mn] ?? (mod.versions.filter((v) => !/-beta$/.test(v)).at(-1) ?? mod.versions.at(-1));
    const fns = { total: 0, done: 0, missing: [] };
    const props = { total: 0, done: 0, missing: [] };
    const events = { total: 0, done: 0, missing: [] };
    for (const [cn, c] of $Object.entries(mod.classes)) {
      if (!verLE(c.since ?? '0.0.0', version)) continue;
      const owner = { WorldAfterEvents: 'world.afterEvents', WorldBeforeEvents: 'world.beforeEvents', SystemAfterEvents: 'system.afterEvents', SystemBeforeEvents: 'system.beforeEvents' }[cn];
      const isEvent = /(After|Before)Event$|^StartupEvent$|Event$/.test(cn) && !/Signal$/.test(cn);
      for (const [fn, f] of $Object.entries(c.fns)) {
        if (!verLE(f.since ?? '0.0.0', version)) continue;
        if (/EventSignal$/.test(cn)) continue;
        fns.total++;
        const impl = findImpl(cn, f.st ? 'static' : 'fns', fn);
        const ok = Boolean(impl) && !impl.notImplemented;
        if (ok) fns.done++; else fns.missing.push(`${cn}.${fn}`);
      }
      if (c.ctor) { fns.total++; if (IMPL[cn]?.ctor) fns.done++; else fns.missing.push(`new ${cn}`); }
      for (const [pn, p] of $Object.entries(c.props)) {
        if (!verLE(p.since ?? '0.0.0', version) || p.v !== undefined) continue;
        if (owner) {
          events.total++;
          if (FIRED.has(`${owner}.${pn}`)) events.done++; else events.missing.push(`${owner}.${pn}`);
          continue;
        }
        if (isEvent) continue; // イベントの中身は、起こせるイベントの側で数える
        props.total++;
        const g = findImpl(cn, p.st ? 'staticGet' : 'get', pn);
        if ((g && !g.notImplemented) || dataBackedProp(cn, pn)) props.done++; else props.missing.push(`${cn}.${pn}`);
      }
    }
    const pct = (x) => (x.total ? $Math.round((x.done / x.total) * 1000) / 10 : 100);
    out[mn] = {
      version,
      functions: { ...fns, percent: pct(fns) },
      properties: { ...props, percent: pct(props) },
      events: { ...events, percent: pct(events) },
    };
  }
  return $JSON.stringify(out);
}
