// 実測データ: プレイヤー操作のイベント

// ---- プレイヤー操作の追加（イベント） ------------------------------------------------------
const redstoneOf = (b) => $Number(b.states.redstone_signal ?? 0);
$Object.assign(EXT_ACTIONS, {
  button(a, p, po) {
    p.buttons ??= {};
    const state = a.state ?? 'Pressed';
    if ((p.buttons[a.button] ?? 'Released') === state) return;
    p.buttons[a.button] = state;
    if (a.button === 'Sneak') EXT_ACTIONS.sneak({ sneaking: state === 'Pressed' }, p, po);
    fireAfter('world.afterEvents', 'playerButtonInput', { player: po, button: a.button, newButtonState: state });
  },
  moveInput(a, p) { p.movement = { x: a.x ?? 0, y: a.y ?? 0 }; },
  inputMode(a, p, po) {
    const prev = p.inputMode ?? 'KeyboardAndMouse';
    if (prev === a.mode) return;
    p.inputMode = a.mode;
    fireAfter('world.afterEvents', 'playerInputModeChange', { player: po, previousInputModeUsed: prev, newInputModeUsed: a.mode });
  },
  stepOn(a, p, po) {
    const at = Vec(a.at);
    const b = readBlock(p.dim, at.x, at.y, at.z);
    if (!/_pressure_plate$/.test(b.id)) { log('warn', `stepOn: (${at.x}, ${at.y}, ${at.z}) は感圧板ではありません`); return; }
    const prev = redstoneOf(b);
    const power = /heavy_weighted/.test(b.id) ? $Math.min(15, $Math.ceil((a.count ?? 1) / 10)) : /light_weighted/.test(b.id) ? $Math.min(15, a.count ?? 1) : 15;
    if (power === prev) return;
    writeBlock(p.dim, at.x, at.y, at.z, makePerm(b.id, { ...b.states, redstone_signal: power }));
    fireAfter('world.afterEvents', 'pressurePlatePush', { block: blockObj(p.dim, at), dimension: dimObj(p.dim), source: po, previousRedstonePower: prev, redstonePower: power });
  },
  stepOff(a, p) {
    const at = Vec(a.at);
    const b = readBlock(p.dim, at.x, at.y, at.z);
    if (!/_pressure_plate$/.test(b.id) || !redstoneOf(b)) return;
    const prev = redstoneOf(b);
    writeBlock(p.dim, at.x, at.y, at.z, makePerm(b.id, { ...b.states, redstone_signal: 0 }));
    fireAfter('world.afterEvents', 'pressurePlatePop', { block: blockObj(p.dim, at), dimension: dimObj(p.dim), previousRedstonePower: prev, redstonePower: 0 });
  },
  tripWire(a, p, po) {
    const at = Vec(a.at);
    const b = readBlock(p.dim, at.x, at.y, at.z);
    if (b.id !== 'minecraft:trip_wire' && b.id !== 'minecraft:tripwire') { log('warn', 'tripWire: トリップワイヤーではありません'); return; }
    const on = a.powered !== false;
    writeBlock(p.dim, at.x, at.y, at.z, makePerm(b.id, { ...b.states, powered_bit: on }));
    fireAfter('world.afterEvents', 'tripWireTrip', { block: blockObj(p.dim, at), dimension: dimObj(p.dim), isPowered: on, sources: [po] });
  },
  projectileHit(a, p, po) {
    const proj = spawn(a.projectile ?? 'minecraft:arrow', p.dim, a.at ?? p.loc);
    const projObj = entityObj(proj);
    const hitVector = Vec(a.hitVector ?? { x: 0, y: 0, z: 1 });
    if (a.target) {
      const t = entities.get($String(a.target)) ?? [...entities.values()].find((e) => e.valid && (e.name === a.target || e.nameTag === a.target || e.typeId === a.target));
      if (!t) { log('warn', `projectileHit: 対象 ${a.target} がいません`); return; }
      fireAfter('world.afterEvents', 'projectileHitEntity', { dimension: dimObj(p.dim), hitVector, location: Vec(t.loc), projectile: projObj, source: po, _hit: { entity: entityObj(t) } });
      if (a.damage) hurt(t, a.damage, { cause: 'projectile', damagingEntity: po });
      return;
    }
    const at = Vec(a.block);
    const b = readBlock(p.dim, at.x, at.y, at.z);
    fireAfter('world.afterEvents', 'projectileHitBlock', { dimension: dimObj(p.dim), hitVector, location: Vec(a.at ?? at), projectile: projObj, source: po, _hit: { block: blockObj(p.dim, at), face: a.face ?? 'Up', faceLocation: Vec(a.faceLocation ?? { x: 0.5, y: 1, z: 0.5 }) } });
    if (b.id === 'minecraft:target') {
      const power = a.power ?? 8;
      fireAfter('world.afterEvents', 'targetBlockHit', { block: blockObj(p.dim, at), dimension: dimObj(p.dim), hitVector, previousRedstonePower: 0, redstonePower: power, source: projObj });
    }
  },
  piston(a, p) {
    const at = Vec(a.at);
    const b = readBlock(p.dim, at.x, at.y, at.z);
    if (!/piston$/.test(b.id)) { log('warn', 'piston: ピストンではありません'); return; }
    const blk = blockObj(p.dim, at);
    fireAfter('world.afterEvents', 'pistonActivate', { block: blk, dimension: dimObj(p.dim), isExpanding: a.expanding !== false, piston: blk.getComponent('minecraft:piston') });
  },
  tame(a, p) {
    const t = entities.get($String(a.entity)) ?? [...entities.values()].find((e) => e.valid && !e.player && (e.nameTag === a.entity || e.typeId === a.entity));
    if (!t) { log('warn', `tame: 対象 ${a.entity} がいません`); return; }
    tameEntity(t, p);
  },
  openEntityContainer(a, p, po) {
    const t = entities.get($String(a.entity)) ?? [...entities.values()].find((e) => e.valid && !e.player && (e.nameTag === a.entity || e.typeId === a.entity));
    if (!t?.inventory) { log('warn', 'openEntityContainer: 持ち物のあるエンティティがいません'); return; }
    fireAfter('world.afterEvents', 'entityContainerOpened', { entity: entityObj(t), openSource: po });
  },
  closeEntityContainer(a, p, po) {
    const t = entities.get($String(a.entity)) ?? [...entities.values()].find((e) => e.valid && !e.player && (e.nameTag === a.entity || e.typeId === a.entity));
    if (!t) return;
    fireAfter('world.afterEvents', 'entityContainerClosed', { entity: entityObj(t), closeSource: po });
  },
});
// 実測: コマンドから送ったときは sourceBlock は付かない
IMPL.ScriptEventCommandMessageAfterEvent = { get: { sourceBlock: () => undefined, initiator: () => undefined } };
IMPL.ProjectileHitBlockAfterEvent = { fns: { getBlockHit: function getBlockHit() { return { ...H.get(this).data._hit }; } } };
IMPL.ProjectileHitEntityAfterEvent = { fns: { getEntityHit: function getEntityHit() { return { ...H.get(this).data._hit }; } } };
// 最初から世界にいるエンティティは、読み込まれたときに entityLoad が起きる
for (const e of entities.values()) {
  if (!e.player && e.valid) fireAfter('world.afterEvents', 'entityLoad', { entity: entityObj(e) });
}

[
  'world.afterEvents.playerButtonInput', 'world.afterEvents.playerInputModeChange', 'world.afterEvents.pressurePlatePush',
  'world.afterEvents.pressurePlatePop', 'world.afterEvents.tripWireTrip', 'world.afterEvents.projectileHitBlock',
  'world.afterEvents.projectileHitEntity', 'world.afterEvents.targetBlockHit', 'world.afterEvents.pistonActivate',
  'world.afterEvents.entityTamed', 'world.beforeEvents.entityTamed', 'world.afterEvents.entityContainerOpened',
  'world.afterEvents.entityContainerClosed', 'world.afterEvents.entityLoad',
].forEach((x) => FIRED.add(x));
