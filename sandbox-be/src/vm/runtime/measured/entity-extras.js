// 実測データ: Molang・スプライン・騎乗・リード・テイム

// ---- Molang・スプライン・トリガー（ただの入れ物） ---------------------------------------
IMPL.MolangVariableMap = {
  ctor() { return { vars: {} }; },
  fns: {
    setFloat: (h, k, v) => { h.vars[k] = { float: v }; },
    setVector3: (h, k, v) => { h.vars[k] = { vector: Vec(v) }; },
    setColorRGB: (h, k, c) => { h.vars[k] = { rgb: { ...c } }; },
    setColorRGBA: (h, k, c) => { h.vars[k] = { rgba: { ...c } }; },
    setSpeedAndDirection: (h, k, sp, dir) => { h.vars[k] = { speed: sp, direction: Vec(dir) }; },
  },
};
const molangOf = (v) => (v ? $JSON.parse($JSON.stringify(H.get(v)?.vars ?? {})) : undefined);
IMPL.Dimension.fns.spawnParticle = (h, id, loc, vars) => { checkLoc(h.dim, loc); S.effects.push({ tick: S.tick, kind: 'particle', id, dimension: h.dim, location: Vec(loc), molang: molangOf(vars) }); };
IMPL.Player.fns.spawnParticle = (h, id, loc, vars) => { S.effects.push({ tick: S.tick, kind: 'particle', to: h.e.name, id, location: Vec(loc), molang: molangOf(vars) }); };
// 実測: controlPoints はいつも同じ配列を返し、代入は効かない（push は効く）
const splineImpl = { ctor() { const points = []; LIVE.add(points); return { points }; }, get: { controlPoints: (h) => h.points }, set: { controlPoints: () => {} } };
IMPL.CatmullRomSpline = splineImpl;
IMPL.LinearSpline = splineImpl;
IMPL.Trigger = { ctor(name) { return { data: { eventName: name } }; } };

// ---- エンティティ: 騎乗・リード・テイム・カーソル・持ち物 --------------------------------------
const ent = (o) => H.get(o)?.e;
// 子どものぶんは entityData が babies から差し替えて持っている（M.entities を直に見ると大人の値になる）
const callsOf = (e, comp) => entityData(e.typeId, e.baby)?.props?.[`${comp}#calls`];
/** 実測: 装備の枠に無い名前を渡すと TypeError（列挙は文字列だが値は検査される） */
const EQUIP_SLOTS = ['Chest', 'Feet', 'Head', 'Legs', 'Mainhand', 'Offhand'];
const equipCheck = (slot) => {
  if (!EQUIP_SLOTS.includes(slot)) throw new $TypeError('Native type conversion failed. Function argument [0] expected type: EquipmentSlot');
};

const rideCalls = (e) => callsOf(e, 'minecraft:rideable');
IMPL.EntityRideableComponent = {
  fns: {
    getRiders: (h) => [...(h.e.riders ?? [])].map((id) => entities.get(id)).filter((r) => r?.valid).map(entityObj),
    addRider(h, rider) {
      const r = ent(rider);
      if (!r || r === h.e || !r.valid) return false;
      // 実測: 乗れるファミリーが決まっている（豚は baby_undead だけ）
      const fams = rideCalls(h.e)?.families;
      if (fams && fams.length && !familiesOf(r).some((f) => fams.includes(f))) return false;
      h.e.riders ??= [];
      if (h.e.riders.includes(r.id)) return true;
      if (h.e.riders.length >= (h.data.seatCount ?? 1)) return false;
      if (r.ridingOn) IMPL.EntityRideableComponent.fns.ejectRider({ e: entities.get(r.ridingOn) }, rider);
      h.e.riders.push(r.id);
      r.ridingOn = h.e.id;
      r.loc = { ...h.e.loc };
      return true;
    },
    ejectRider(h, rider) {
      const r = ent(rider);
      if (!r || !h.e.riders) return;
      h.e.riders = h.e.riders.filter((id) => id !== r.id);
      if (r.ridingOn === h.e.id) delete r.ridingOn;
    },
    ejectRiders(h) { for (const id of h.e.riders ?? []) { const r = entities.get(id); if (r) delete r.ridingOn; } h.e.riders = []; },
    getSeats: (h) => (rideCalls(h.e)?.seats ?? NI('EntityRideableComponent.getSeats')).map((x) => inst('Seat', { data: { ...x, position: Vec(x.position) } })),
    getFamilyTypes: (h) => [...(rideCalls(h.e)?.families ?? NI('EntityRideableComponent.getFamilyTypes'))],
  },
};
IMPL.EntityRidingComponent = { get: { typeId: () => 'minecraft:riding', entityRidingOn: (h) => { const m = entities.get(h.e.ridingOn); return m?.valid ? entityObj(m) : undefined; } } };
IMPL.EntityLeashableComponent = {
  fns: {
    leashTo(h, holder) { const t = ent(holder); if (!t || t === h.e) return; h.e.leash = t.id; },
    unleash(h) { delete h.e.leash; },
  },
  get: {
    isLeashed: (h) => Boolean(h.e.leash && entities.get(h.e.leash)?.valid),
    leashHolder: (h) => { const t = entities.get(h.e.leash); return t?.valid ? entityObj(t) : undefined; },
    // 実測（BDS 1.26.51）: 名前に反して、相手の ID ではなく相手の種類 ID を返す
    leashHolderEntityId: (h) => { const t = entities.get(h.e.leash); return t?.valid ? t.typeId : undefined; },
  },
};
function tameEntity(e, player) {
  if (e.tamedTo) return false;
  const data = fireBefore('world.beforeEvents', 'entityTamed', { entity: entityObj(e), tamingEntity: entityObj(player), cancel: false });
  if (data.cancel) return false;
  e.tamedTo = player.id;
  fireAfter('world.afterEvents', 'entityTamed', { entity: entityObj(e), tamingEntity: entityObj(player) });
  return true;
}
IMPL.EntityTameableComponent = {
  fns: { tame: (h, player) => tameEntity(h.e, ent(player)) },
  get: {
    isTamed: (h) => Boolean(h.e.tamedTo),
    tamedToPlayer: (h) => { const p = entities.get(h.e.tamedTo); return p?.valid ? entityObj(p) : undefined; },
    tamedToPlayerId: (h) => h.e.tamedTo,
    getTameItems: (h) => (callsOf(h.e, 'minecraft:tameable')?.tameItems ?? NI('EntityTameableComponent.getTameItems')).map((id) => itemObj({ typeId: id, amount: 1, lore: [] })),
  },
};
IMPL.EntityTameMountComponent = {
  fns: {
    tame(h) { h.e.mountTamed = true; },
    tameToPlayer(h, particles, player) { const ok = tameEntity(h.e, ent(player)); if (ok) h.e.mountTamed = true; return ok; },
  },
  get: {
    isTamed: (h) => Boolean(h.e.mountTamed),
    isTamedToPlayer: (h) => Boolean(h.e.tamedTo),
    tamedToPlayer: (h) => { const p = entities.get(h.e.tamedTo); return p?.valid ? entityObj(p) : undefined; },
    tamedToPlayerId: (h) => h.e.tamedTo,
  },
};
IMPL.EntityBreathableComponent = {
  fns: {
    getBreatheBlocks: (h) => (callsOf(h.e, 'minecraft:breathable')?.breathe ?? NI('getBreatheBlocks')).map((id) => permObj(makePerm(id))),
    getNonBreatheBlocks: (h) => (callsOf(h.e, 'minecraft:breathable')?.nonBreathe ?? NI('getNonBreatheBlocks')).map((id) => permObj(makePerm(id))),
  },
};
IMPL.EntityAgeableComponent = {
  fns: {
    getDropItems: (h) => [...(callsOf(h.e, 'minecraft:ageable')?.drop ?? NI('getDropItems'))],
    getFeedItems: (h) => (callsOf(h.e, 'minecraft:ageable')?.feed ?? NI('getFeedItems')).map((f) => ({ ...f, resultItem: f.resultItem ?? undefined })),
  },
  get: { growUp: (h) => { const ev = callsOf(h.e, 'minecraft:ageable')?.growUp; return ev ? inst('Trigger', { data: { eventName: ev } }) : NI('growUp'); } },
};
IMPL.EntityHealableComponent = {
  fns: {
    getFeedItems: (h) => (callsOf(h.e, 'minecraft:healable')?.feed ?? NI('getFeedItems')).map((f) => inst('FeedItem', { data: { item: f.item, healAmount: f.healAmount, resultItem: f.resultItem ?? undefined }, effects: f.effects })),
  },
};
IMPL.FeedItem = { fns: { getEffects: (h) => h.effects.map((x) => ({ ...x })) } };
IMPL.EntityOnFireComponent = { get: { onFireTicksRemaining: (h) => h.e.fireTicks } };
IMPL.EntityEnderInventoryComponent = { get: { typeId: () => 'minecraft:ender_inventory', container: (h) => containerObj(h.box) } };
IMPL.EntityProjectileComponent = {
  fns: {
    shoot(h, velocity, options) {
      void options;
      const e = h.e;
      e.vel = shootVector(velocity);
      e.rep = { ...e.vel };
    },
  },
};
IMPL.PlayerCursorInventoryComponent = {
  fns: { clear: (h) => { h.e.cursor = null; } },
  get: { typeId: () => 'minecraft:cursor_inventory', item: (h) => (h.e.cursor ? itemObj(copyItem(h.e.cursor)) : undefined) },
};
IMPL.Entity.fns.addItem = (h, item) => {
  if (!h.e.inventory) throw fail('InvalidEntityComponentError', 'Attempting to access invalid entity component minecraft:inventory.');
  const it = copyItem(H.get(item).it);
  const left = addItem(h.e, it);
  return left > 0 ? itemObj({ ...it, amount: left }) : undefined;
};
// 乗っている間だけ riding コンポーネントがある
const prevComponentOf = componentOfRef.fn ?? componentOf;
componentOfRef.fn = (e, id) => {
  const full = fullId(id);
  // 燃えている間だけ onfire コンポーネントがある（消した直後の -1 の 1 tick も含む）
  if (full === 'minecraft:onfire') return e.fireTicks ? once('EntityOnFireComponent', (e._onfire ??= { e, typeId: full, valid: () => e.valid && Boolean(e.fireTicks) })) : undefined;
  if (full === 'minecraft:riding') return e.ridingOn ? once('EntityRidingComponent', (e._riding ??= { e, typeId: full, valid: () => e.valid && Boolean(e.ridingOn) })) : undefined;
  // エンダーチェスト（実機ではプレイヤーだけが持つ。27 枠）
  if (full === 'minecraft:ender_inventory') {
    if (!e.player) return undefined;
    e._ender ??= { e, typeId: full, valid: () => e.valid, box: { inventory: new Array(27).fill(null), valid: () => e.valid, typeId: e.typeId } };
    return once('EntityEnderInventoryComponent', e._ender);
  }
  if (full === 'minecraft:cursor_inventory' && e.player) return once('PlayerCursorInventoryComponent', (e._cursor ??= { e, typeId: full, valid: () => e.valid }));
  return prevComponentOf(e, id);
};
