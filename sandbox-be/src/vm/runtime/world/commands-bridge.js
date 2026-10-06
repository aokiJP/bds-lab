// コマンドの実行（commands/ への橋渡し）

// ---- コマンドの実行（vcommands.js） ----------------------------------------

const CMD = SB_COMMANDS({
  S, G, DIMS, entities, objectives, identities, identityFor, displaySlots,
  readBlock, writeBlock, makePerm, blockTypeId, itemId, entityTypeId, dimId, chunkLoaded,
  query, spawn, removeEntity, say, rawText, fireAfter, fireBefore, entityObj, log,
  fail, ITEM_MAX, random, fmt, packDef,
  addItem: (e, it) => addItem(e, it),
  custom: CUSTOM,
  rules: RULES_BY_LOWER,
  familiesOf: (e) => famOf(e) ?? [],
  hurt: (e, amount, src) => hurt(e, amount, src),
  setEffect: (e, id, ticks, amp, show) => { e.effects ??= new $Map(); e.effects.set(id, { amplifier: amp, duration: ticks, showParticles: show, instant: /^minecraft:instant_/.test(id), addedTick: S.tick }); },
  clearEffects: (e, id) => { if (!e.effects) return 0; if (!id) { const n = e.effects.size; e.effects.clear(); return n; } return e.effects.delete(id) ? 1 : 0; },
  triggerEntityEvent: (e, ev) => {
    if (ev === 'minecraft:as_baby' || ev === 'minecraft:entity_born') e.baby = true;
    if (ev === 'minecraft:ageable_grow_up' || ev === 'minecraft:as_adult') e.baby = false;
    S.effects.push({ tick: S.tick, kind: 'entityEvent', entity: e.id, event: ev });
  },
  effectId: (name) => { const f = fullId($String(name)); return (M.effects ?? []).includes(f) ? f : null; },
  structures: () => structures,
  itemStackObj: (it) => itemObj(it),
  functions: CFG.functions ?? {},
  // /ride のための、乗り降りの手当て（Script API の rideable と同じ規則）
  rideAdd: (ride, rider) => {
    if (!ride || !rider || ride === rider || !rider.valid || !ride.valid) return false;
    const calls = rideCalls(ride);
    const fams = calls?.families;
    if (fams && fams.length && !(famOf(rider) ?? []).some((f) => fams.includes(f))) return false;
    ride.riders ??= [];
    if (ride.riders.includes(rider.id)) return true;
    if (ride.riders.length >= (calls?.seats?.length ?? 1)) return false;
    if (rider.ridingOn) {
      const prev = entities.get(rider.ridingOn);
      if (prev) prev.riders = (prev.riders ?? []).filter((x) => x !== rider.id);
    }
    ride.riders.push(rider.id);
    rider.ridingOn = ride.id;
    rider.loc = { ...ride.loc };
    return true;
  },
  rideEject: (ride, rider) => {
    if (!ride || !rider) return;
    ride.riders = (ride.riders ?? []).filter((x) => x !== rider.id);
    if (rider.ridingOn === ride.id) delete rider.ridingOn;
  },
  rideEjectAll: (ride) => {
    for (const id of ride?.riders ?? []) { const r = entities.get(id); if (r) delete r.ridingOn; }
    if (ride) ride.riders = [];
  },
  /** 実測の分布からドロップを選ぶ（未測定なら null、落とさないなら undefined） */
  entityLoot: (e) => {
    if (e.baby) return undefined;
    const dist = M.entities[e.typeId]?.loot;
    if (!dist || dist.error) return null;
    const keys = $Object.keys(dist);
    const k = keys[pick(keys.map((x) => dist[x]))];
    if (k === 'U') return undefined;
    if (k === '') return [];
    return k.split(',').map((part) => { const [id, n] = part.split('*'); return { typeId: id, amount: $Number(n), lore: [] }; });
  },
});

function runCommand(src, cmd) {
  S.commands.push({ tick: S.tick, source: src.entity ? (src.entity.player ? src.entity.name : src.entity.typeId) : 'server', command: cmd });
  const r = CMD.run(cmd, src);
  if (r.notImplemented) { bump(S.unsupported, `/${r.notImplemented}`); throw new SandboxNotImplemented(`/${r.notImplemented}`); }
  // 実機: 例外になるのは構文エラーだけ。実行して 0 件なら successCount が 0 になるだけ
  if (!r.ok) throw fail('CommandError', r.message);
  S.commands[S.commands.length - 1].result = r.failed ? { successCount: 0, failed: r.failed } : { successCount: r.successCount };
  return inst('CommandResult', { data: { successCount: r.successCount ?? 1 } });
}
