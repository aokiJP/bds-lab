// 拡張: プレイヤー操作

// ---- プレイヤー操作の追加 --------------------------------------------------------
const heldItem = (p) => (p.inventory?.[p.selectedSlot] ? itemObj(copyItem(p.inventory[p.selectedSlot])) : undefined);
$Object.assign(EXT_ACTIONS, {
  sneak(a, p, po) {
    const v = a.sneaking !== false;
    if (Boolean(p.sneaking) === v) return;
    p.sneaking = v;
    fireAfter('world.afterEvents', v ? 'entityStartSneaking' : 'entityStopSneaking', { entity: po });
  },
  selectSlot(a, p, po) {
    const prev = p.selectedSlot;
    if (a.slot < 0 || a.slot > 8) { log('warn', 'selectSlot: 0〜8 を指定してください'); return; }
    p.selectedSlot = a.slot;
    if (prev !== a.slot) fireAfter('world.afterEvents', 'playerHotbarSelectedSlotChange', { player: po, previousSlotSelected: prev, newSlotSelected: a.slot, itemStack: heldItem(p) });
  },
  emote(a, p, po) { fireAfter('world.afterEvents', 'playerEmote', { player: po, personaPieceId: a.id ?? '' }); },
  swing(a, p, po) { fireAfter('world.afterEvents', 'playerSwingStart', { player: po, heldItemStack: heldItem(p), swingSource: a.source ?? 'Attack' }); },
  attack(a, p, po) {
    const t = entities.get($String(a.target)) ?? [...entities.values()].find((e) => e.valid && (e.name === a.target || e.nameTag === a.target || e.typeId === a.target));
    if (!t) { log('warn', `attack: 対象 ${a.target} がいません`); return; }
    fireAfter('world.afterEvents', 'playerSwingStart', { player: po, heldItemStack: heldItem(p), swingSource: 'Attack' });
    fireAfter('world.afterEvents', 'entityHitEntity', { damagingEntity: po, hitEntity: entityObj(t) });
    if (t.player && G.gameRules.pvp === false) return;
    hurt(t, a.damage ?? 1, { cause: 'entityAttack', damagingEntity: po });
  },
  hitBlock(a, p, po) {
    const at = Vec(a.at);
    fireAfter('world.afterEvents', 'entityHitBlock', { damagingEntity: po, hitBlock: blockObj(p.dim, at), blockFace: a.face ?? 'Up', hitBlockPermutation: permObj(readBlock(p.dim, at.x, at.y, at.z)) });
  },
  startBreaking(a, p, po) {
    const at = Vec(a.at);
    fireAfter('world.afterEvents', 'playerStartBreakingBlock', { player: po, block: blockObj(p.dim, at), dimension: dimObj(p.dim), blockPermutation: permObj(readBlock(p.dim, at.x, at.y, at.z)), face: a.face ?? 'Up', heldItemStack: heldItem(p) });
  },
  cancelBreaking(a, p, po) {
    const at = Vec(a.at);
    fireAfter('world.afterEvents', 'playerCancelBreakingBlock', { player: po, block: blockObj(p.dim, at), dimension: dimObj(p.dim), blockPermutation: permObj(readBlock(p.dim, at.x, at.y, at.z)), face: a.face ?? 'Up', heldItemStack: heldItem(p), breakProgress: a.progress ?? 0.5 });
  },
  interactWithEntity(a, p, po) {
    const t = entities.get($String(a.target)) ?? [...entities.values()].find((e) => e.valid && !e.player && (e.nameTag === a.target || e.typeId === a.target));
    if (!t) { log('warn', `interactWithEntity: 対象 ${a.target} がいません`); return; }
    const data = fireBefore('world.beforeEvents', 'playerInteractWithEntity', { player: po, target: entityObj(t), itemStack: heldItem(p), cancel: false });
    if (data.cancel) return;
    fireAfter('world.afterEvents', 'playerInteractWithEntity', { player: po, target: entityObj(t), itemStack: heldItem(p), beforeItemStack: heldItem(p) });
  },
  startUse(a, p, po) { fireAfter('world.afterEvents', 'itemStartUse', { source: po, itemStack: heldItem(p), useDuration: a.duration ?? 32 }); },
  stopUse(a, p, po) { fireAfter('world.afterEvents', 'itemStopUse', { source: po, itemStack: heldItem(p), useDuration: a.duration ?? 0 }); },
  releaseUse(a, p, po) { fireAfter('world.afterEvents', 'itemReleaseUse', { source: po, itemStack: heldItem(p), useDuration: a.duration ?? 0 }); },
  // what was eaten or drunk leaves the hand (one of the stack)
  useUp(a, p) { const s = p.inventory?.[p.selectedSlot]; if (!s) return; s.amount -= 1; if (s.amount <= 0) p.inventory[p.selectedSlot] = null; },
  completeUse(a, p, po) { fireAfter('world.afterEvents', 'itemCompleteUse', { source: po, itemStack: heldItem(p), useDuration: 0 }); },
  startUseOn(a, p, po) { const at = Vec(a.at); fireAfter('world.afterEvents', 'itemStartUseOn', { source: po, itemStack: heldItem(p), block: blockObj(p.dim, at), blockFace: a.face ?? 'Up' }); },
  stopUseOn(a, p, po) { const at = Vec(a.at); fireAfter('world.afterEvents', 'itemStopUseOn', { source: po, itemStack: heldItem(p), block: blockObj(p.dim, at) }); },
  dropItem(a, p, po) {
    const i = a.slot ?? p.selectedSlot;
    const s = p.inventory[i];
    if (!s) { log('warn', `dropItem: スロット ${i} は空です`); return; }
    const n = $Math.min(a.amount ?? s.amount, s.amount);
    s.amount -= n;
    if (s.amount <= 0) p.inventory[i] = null;
    const it = spawn('minecraft:item', p.dim, { x: p.loc.x, y: p.loc.y + 1.3, z: p.loc.z });
    it.item = { ...s, amount: n, lore: [...(s.lore ?? [])] };
    fireAfter('world.afterEvents', 'entityItemDrop', { entity: po, items: [entityObj(it)] });
  },
  pickup(a, p, po) {
    const it = entities.get($String(a.item)) ?? [...entities.values()].find((e) => e.valid && e.typeId === 'minecraft:item' && e.dim === p.dim);
    if (!it?.item) { log('warn', 'pickup: 拾えるアイテムがありません'); return; }
    const data = fireBefore('world.beforeEvents', 'entityItemPickup', { entity: po, item: entityObj(it), cancel: false });
    if (data.cancel) return;
    const left = addItem(p, it.item);
    if (left >= it.item.amount) return;
    if (left > 0) { it.item.amount = left; } else { removeEntity(it); }
    fireAfter('world.afterEvents', 'entityItemPickup', { entity: po, items: [entityObj(it)] });
  },
  pushButton(a, p, po) {
    const at = Vec(a.at);
    const b = readBlock(p.dim, at.x, at.y, at.z);
    if (!/_button$/.test(b.id)) { log('warn', `pushButton: (${at.x}, ${at.y}, ${at.z}) はボタンではありません`); return; }
    if (b.states.button_pressed_bit) return;
    writeBlock(p.dim, at.x, at.y, at.z, makePerm(b.id, { ...b.states, button_pressed_bit: true }));
    fireAfter('world.afterEvents', 'buttonPush', { block: blockObj(p.dim, at), dimension: dimObj(p.dim), source: po });
    const ticks = /stone|polished_blackstone/.test(b.id) ? 20 : 30;
    waits.push({ due: S.tick + ticks, resolve: () => { const c = readBlock(p.dim, at.x, at.y, at.z); if (c.id === b.id) writeBlock(p.dim, at.x, at.y, at.z, makePerm(b.id, { ...c.states, button_pressed_bit: false })); } });
  },
  pullLever(a, p, po) {
    const at = Vec(a.at);
    const b = readBlock(p.dim, at.x, at.y, at.z);
    if (b.id !== 'minecraft:lever') { log('warn', `pullLever: (${at.x}, ${at.y}, ${at.z}) はレバーではありません`); return; }
    const on = !b.states.open_bit;
    writeBlock(p.dim, at.x, at.y, at.z, makePerm(b.id, { ...b.states, open_bit: on }));
    fireAfter('world.afterEvents', 'leverAction', { block: blockObj(p.dim, at), dimension: dimObj(p.dim), player: po, isPowered: on });
  },
  openContainer(a, p, po) {
    const at = Vec(a.at);
    if (!containerSize(readBlock(p.dim, at.x, at.y, at.z).id)) { log('warn', 'openContainer: コンテナではありません'); return; }
    fireAfter('world.afterEvents', 'blockContainerOpened', { block: blockObj(p.dim, at), dimension: dimObj(p.dim), openSource: po });
  },
  closeContainer(a, p, po) {
    const at = Vec(a.at);
    fireAfter('world.afterEvents', 'blockContainerClosed', { block: blockObj(p.dim, at), dimension: dimObj(p.dim), closeSource: po });
  },
  trigger(a) {
    const e = entities.get($String(a.entity));
    if (!e) { log('warn', `trigger: エンティティ ${a.entity} がいません`); return; }
    fireAfter('world.afterEvents', 'dataDrivenEntityTrigger', { entity: entityObj(e), eventId: a.event });
  },
  heal(a, p) { heal(p, a.amount ?? 1, a.cause ?? 'Regeneration'); },
  effect(a, p, po) { void po; IMPL.Entity.fns.addEffect.call(entityObj(p), hEntity(p), a.effect, a.duration ?? 200, { amplifier: a.amplifier ?? 0 }); },
});
