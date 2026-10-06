// 拡張: tick の終わりに起こすもの

// ---- tick の終わりに起こすもの（効果の時間・持ち物の変化） ---------------------------------
const lastInv = new $Map();
END_HOOKS.push(() => {
  for (const e of entities.values()) {
    if (!e.valid) continue;
    if (e.effects) {
      for (const [id, ef] of e.effects) {
        if (ef.instant) {
          e.effects.delete(id);
          if (id === 'minecraft:instant_health') heal(e, 4 << ef.amplifier, 'Heal');
          else hurt(e, 6 << ef.amplifier, { cause: 'magic' });
          continue;
        }
        if (ef.addedTick === S.tick) continue; // 実測: 付けた tick では減らない
        ef.duration--;
        if (id === 'minecraft:regeneration' && ef.duration % $Math.max(1, 50 >> ef.amplifier) === 0) heal(e, 1, 'Regeneration');
        if (id === 'minecraft:poison' && ef.duration % $Math.max(1, 25 >> ef.amplifier) === 0 && e.health > 1) hurt(e, 1, { cause: 'magic' });
        if (id === 'minecraft:wither' && ef.duration % $Math.max(1, 40 >> ef.amplifier) === 0) hurt(e, 1, { cause: 'wither' });
        if (ef.duration <= 0) e.effects.delete(id);
      }
    }
    if (e.player && e.inventory) syncInv(e);
    if (e.player) syncSlot(e);
  }
});

[
  'world.afterEvents.entityHealthChanged', 'world.afterEvents.entityHeal', 'world.beforeEvents.entityHeal', 'world.beforeEvents.entityHurt',
  'world.afterEvents.effectAdd', 'world.beforeEvents.effectAdd', 'world.afterEvents.gameRuleChange', 'world.beforeEvents.weatherChange',
  'world.afterEvents.explosion', 'world.beforeEvents.explosion', 'world.afterEvents.blockExplode', 'world.afterEvents.dataDrivenEntityTrigger',
  'world.afterEvents.entityStartSneaking', 'world.afterEvents.entityStopSneaking', 'world.afterEvents.playerHotbarSelectedSlotChange',
  'world.afterEvents.playerEmote', 'world.afterEvents.playerSwingStart', 'world.afterEvents.entityHitEntity', 'world.afterEvents.entityHitBlock',
  'world.afterEvents.playerStartBreakingBlock', 'world.afterEvents.playerCancelBreakingBlock', 'world.afterEvents.playerInteractWithEntity',
  'world.beforeEvents.playerInteractWithEntity', 'world.afterEvents.itemStartUse', 'world.afterEvents.itemStopUse', 'world.afterEvents.itemReleaseUse',
  'world.afterEvents.itemCompleteUse', 'world.afterEvents.itemStartUseOn', 'world.afterEvents.itemStopUseOn', 'world.afterEvents.entityItemDrop',
  'world.afterEvents.entityItemPickup', 'world.beforeEvents.entityItemPickup', 'world.afterEvents.buttonPush', 'world.afterEvents.leverAction',
  'world.afterEvents.blockContainerOpened', 'world.afterEvents.blockContainerClosed', 'world.afterEvents.playerInventoryItemChange',
  'world.afterEvents.playerInputPermissionCategoryChange', 'system.beforeEvents.shutdown',
].forEach((x) => FIRED.add(x));
