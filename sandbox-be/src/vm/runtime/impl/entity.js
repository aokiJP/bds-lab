// 実装: Entity / Player / Camera / エンティティのコンポーネント

$Object.assign(IMPL, {
  Entity: {
    fns: {
      addTag(h, t) {
        if (t.length > 255) throw outOfBounds(0, t.length, undefined, 255, 'tag length');
        if (h.e.tags.has(t)) return false;
        h.e.tags.add(t);
        return true;
      },
      removeTag(h, t) { return h.e.tags.delete(t); },
      hasTag(h, t) { return h.e.tags.has(t); },
      getTags(h) { return [...h.e.tags]; },
      teleport(h, loc, o) {
        const dim = o?.dimension ? H.get(o.dimension).dim : h.e.dim;
        if (o?.checkForBlocks) {
          const b = readBlock(dim, $Math.floor(loc.x), $Math.floor(loc.y), $Math.floor(loc.z));
          if (b.id !== 'minecraft:air') return;
        }
        const prevDim = h.e.dim;
        h.e.loc = Vec(loc);
        h.e.dim = dim;
        if (o?.rotation) h.e.rot = { x: o.rotation.x, y: o.rotation.y };
        if (h.e.player && prevDim !== dim) fireAfter('world.afterEvents', 'playerDimensionChange', { player: entityObj(h.e), fromDimension: dimObj(prevDim), toDimension: dimObj(dim), fromLocation: null, toLocation: Vec(loc) });
      },
      tryTeleport(h, loc, o) {
        // 実測: checkForBlocks を付けると、置けない場所では動かずに false を返す
        if (o?.checkForBlocks && !canStandAt(h.e, o?.dimension ? (H.get(o.dimension)?.dim ?? h.e.dim) : h.e.dim, loc)) return false;
        this.teleport(loc, o);
        return true;
      },
      kill(h) {
        if (h.e.player && (h.e.gameMode === 'Creative' || h.e.gameMode === 'Spectator')) return false;
        if (h.e.dying !== undefined) return true;
        // 実測: kill は「今の体力ぶんの selfDestruct ダメージ」として入り、hurt のイベントも起きる
        h.e.lastHurt = undefined;
        hurt(h.e, h.e.health, { cause: 'selfDestruct' });
        if (h.e.valid && h.e.dying === undefined) { setHealth(h.e, 0); removeEntity(h.e, { died: true, cause: 'selfDestruct' }); }
        return true;
      },
      remove(h) {
        if (h.e.player) throw fail('Error', 'プレイヤーは remove できません');
        removeEntity(h.e);
      },
      applyDamage(h, amount, o) {
        if (h.e.player && (h.e.gameMode === 'Creative' || h.e.gameMode === 'Spectator')) return false;
        h.e.health = $Math.max(0, h.e.health - amount);
        fireAfter('world.afterEvents', 'entityHurt', { hurtEntity: entityObj(h.e), damage: amount, damageSource: { cause: o?.cause ?? 'none' } });
        if (h.e.health <= 0) removeEntity(h.e, { died: true, cause: o?.cause ?? 'none' });
        return true;
      },
      getComponent(h, id) {
        const k = $String(id).replace(/^minecraft:/, '');
        if (k === 'inventory' && h.e.inventory) return once('EntityInventoryComponent', (h.e._inv ??= { e: h.e, valid: () => h.e.valid }));
        if (k === 'health') return once('EntityHealthComponent', (h.e._hp ??= { e: h.e, valid: () => h.e.valid }));
        if (k === 'item' && h.e.item) return once('EntityItemComponent', (h.e._item ??= { e: h.e, valid: () => h.e.valid }));
        bump(S.unsupported, `Entity.getComponent(${k})`);
        throw new SandboxNotImplemented(`entity.getComponent('${k}')`);
      },
      hasComponent(h, id) {
        const k = $String(id).replace(/^minecraft:/, '');
        return (k === 'inventory' && Boolean(h.e.inventory)) || k === 'health';
      },
      getComponents(h) {
        const out = [this.getComponent('health')];
        if (h.e.inventory) out.push(this.getComponent('inventory'));
        return out;
      },
      getRotation(h) { return { y: h.e.rot.y, x: h.e.rot.x }; },
      setRotation(h, r) { h.e.rot = normRot(r.x, r.y); },
      getHeadLocation(h) { return { x: h.e.loc.x, y: F(h.e.loc.y + (h.e.player ? PLAYER_HEAD : 0.5)), z: h.e.loc.z }; },
      getVelocity(h) { return physVelocity(h.e); },
      getViewDirection(h) { return viewDir(h.e.rot); },
      runCommand(h, cmd) { return runCommand({ dim: h.e.dim, pos: Vec(h.e.loc), entity: h.e }, cmd); },
      getDynamicProperty(h, k) { return h.e.dyn.get(k); },
      setDynamicProperty(h, k, v) { dynCheck(k, v); if (v === undefined) h.e.dyn.delete(k); else h.e.dyn.set(k, typeof v === 'object' ? Vec(v) : v); },
      getDynamicPropertyIds(h) { return [...h.e.dyn.keys()]; },
      clearDynamicProperties(h) { h.e.dyn.clear(); },
      getDynamicPropertyTotalByteCount(h) { return dynBytes(h.e.dyn); },
      matches(h, o) { return query(o, { dim: h.e.dim }).includes(h.e); },
      isValid(h) { return h.e.valid; },
      getEffects() { return []; },
      getEffect() { return undefined; },
      addEffect(h, type, dur, o) { S.effects.push({ tick: S.tick, kind: 'effect', entity: h.e.id, type: typeof type === 'string' ? type : 'effect', duration: dur, options: o }); return undefined; },
      removeEffect() { return false; },
      // 実機: 消すと残り時間が -1 になり、次の tick でコンポーネントごと消える。戻り値はいつも true
      extinguishFire(h) { h.e.fireTicks = -1; return true; },
      setOnFire(h, seconds, useEffects) {
        // 実機: 秒は切り捨てて × 20 tick。0 以下なら false。
        // 今燃えている残り時間より短いときは true を返すが、短くはならない。
        // useEffects（既定 true）で水の中にいるときは火がつかず false（実測）
        const t = $Math.floor($Number(seconds) || 0) * 20;
        if (t <= 0) return false;
        if (useEffects !== false && (inWater(h.e) || inRain(h.e))) return false;
        if (t > (h.e.fireTicks > 0 ? h.e.fireTicks : 0)) h.e.fireTicks = t;
        return true;
      },
      triggerEvent(h, ev) {
    if (ev === 'minecraft:as_baby' || ev === 'minecraft:entity_born') h.e.baby = true;
    if (ev === 'minecraft:ageable_grow_up' || ev === 'minecraft:as_adult') h.e.baby = false; S.effects.push({ tick: S.tick, kind: 'entityEvent', entity: h.e.id, event: ev }); },
    },
    get: {
      id: (h) => h.e.id,
      typeId: (h) => h.e.typeId,
      location: (h) => Vec(h.e.loc),
      dimension: (h) => dimObj(h.e.dim),
      nameTag: (h) => h.e.nameTag,
      isValid: (h) => h.e.valid,
      isSneaking: () => false,
      isOnGround: (h) => onGround(h.e),
      isInWater: (h) => inWater(h.e),
      isSleeping: () => false,
      isSprinting: () => false,
      isSwimming: () => false,
      isFalling: () => false,
      isClimbing: () => false,
      localizationKey: (h) => `entity.${h.e.typeId.slice(10)}.name`,
      scoreboardIdentity: (h) => {
        const i = [...identities.values()].find((x) => x.entityId === h.e.id);
        return i ? identityObj(i) : undefined;
      },
      target: () => undefined,
    },
    set: {
      nameTag: (h, v) => { h.e.nameTag = v; },
    },
  },
  Player: {
    fns: {
      sendMessage(h, m) { say(h.e.name, m); },
      getGameMode(h) { return h.e.gameMode; },
      setGameMode(h, m) {
        const prev = h.e.gameMode;
        const next = m ?? 'Survival';
        // 実測: 同じモードを指定しても before は起きる
        fireBefore('world.beforeEvents', 'playerGameModeChange', { player: entityObj(h.e), fromGameMode: prev, toGameMode: next, cancel: false });
        h.e.gameMode = next;
        fireAfter('world.afterEvents', 'playerGameModeChange', { player: entityObj(h.e), fromGameMode: prev, toGameMode: next });
      },
      playSound(h, id, o) { S.effects.push({ tick: S.tick, kind: 'sound', to: h.e.name, id, options: o }); },
      isOp(h) { return h.e.op; },
      setOp(h, v) { h.e.op = v; },
      getSpawnPoint(h) {
        const s = h.e.spawnPoint;
        return s ? { x: s.x, y: s.y, z: s.z, dimension: dimObj(s.dim) } : undefined;
      },
      setSpawnPoint(h, p) {
        if (p === undefined) { h.e.spawnPoint = undefined; return; }
        h.e.spawnPoint = { x: $Math.floor(p.x), y: $Math.floor(p.y), z: $Math.floor(p.z), dim: p.dimension ? H.get(p.dimension).dim : h.e.dim };
      },
      addExperience(h, n) {
        // 実測: 負の値は何も起きない。足したぶんは順に繰り上がる
        if (n > 0) {
          h.e.xp = (h.e.xp ?? 0) + n;
          for (;;) {
            const need = xpNeeded(h.e.level ?? 0);
            if (h.e.xp < need) break;
            h.e.xp -= need;
            h.e.level = (h.e.level ?? 0) + 1;
          }
        }
        return totalXp(h.e);
      },
      addLevels(h, n) { h.e.level = $Math.max(0, (h.e.level ?? 0) + n); return h.e.level; },
      getTotalXp(h) { return totalXp(h.e); },
      resetLevel(h) { h.e.level = 0; h.e.xp = 0; },
      spawnParticle(h, id, loc) { S.effects.push({ tick: S.tick, kind: 'particle', to: h.e.name, id, location: Vec(loc) }); },
      startItemCooldown() {},
      getItemCooldown() { return 0; },
      eatItem() {},
      clearPropertyOverridesForEntity() {},
    },
    get: {
      name: (h) => h.e.name,
      onScreenDisplay: (h) => once('ScreenDisplay', (h.e._sd ??= { e: h.e, valid: () => h.e.valid })),
      camera: (h) => once('Camera', (h.e._cam ??= { e: h.e, valid: () => h.e.valid })),
      selectedSlotIndex: (h) => h.e.selectedSlot,
      level: (h) => h.e.level ?? 0,
      totalXpNeededForNextLevel: (h) => xpNeeded(h.e.level ?? 0),
      xpEarnedAtCurrentLevel: (h) => h.e.xp ?? 0,
      isEmoting: () => false,
      isFlying: () => false,
      isGliding: () => false,
      isJumping: () => false,
      commandPermissionLevel: (h) => h.e.cmdPerm ?? (h.e.op ? 1 : 0),   // 実測: op で 1（GameDirectors）。代入した値はそのまま返る
      playerPermissionLevel: (h) => (h.e.op ? 2 : 1),    // 実測: op で 2（Operator）
      graphicsMode: () => 'Fancy',
      clientSystemInfo: (h) => inst('ClientSystemInfo', { e: h.e }),
      inputInfo: () => { bump(S.unsupported, 'Player.inputInfo'); throw new SandboxNotImplemented('player.inputInfo'); },
    },
    set: {
      selectedSlotIndex: (h, v) => { h.e.selectedSlot = v; },
      // 実測（BDS 1.26.52.3、bds-lab の js）: op のプレイヤーに 0 / 2 / 4 / 1 を代入 → 読むとその値。playerPermissionLevel は 2 のまま
      commandPermissionLevel: (h, v) => { h.e.cmdPerm = v; },
    },
  },
  ScreenDisplay: {
    fns: {
      setActionBar(h, t) { S.effects.push({ tick: S.tick, kind: 'actionbar', to: h.e.name, text: rawText(t) }); },
      setTitle(h, t, o) { S.effects.push({ tick: S.tick, kind: 'title', to: h.e.name, text: rawText(t), subtitle: o?.subtitle !== undefined ? rawText(o.subtitle) : undefined }); },
      updateSubtitle(h, t) { S.effects.push({ tick: S.tick, kind: 'subtitle', to: h.e.name, text: rawText(t) }); },
      // 実測: resetHudElements() では隠した状態は戻らない（戻すのは resetHudElementsVisibility）
      resetHudElements() {},
      hideAllExcept(h, keep) { hudHide(h.e, HUD_ELEMENTS.filter((el) => !(keep ?? []).includes(el))); },
      isForcedHidden(h, el) { return (h.e.hiddenHud ?? []).includes(el); },
    },
    get: { isValid: (h) => h.e.valid },
  },
  Camera: {
    fns: {
      clear(h) { S.effects.push({ tick: S.tick, kind: 'camera.clear', to: h.e.name }); },
      setCamera(h, preset, o) {
        // 実測: 無い名前を渡すと Error: Invalid camera preset.
        if (!CAMERA_PRESETS.has(preset)) throw new $Error('Invalid camera preset.');   // 実測: 'free' のように名前空間を省くとエラー
        S.effects.push({ tick: S.tick, kind: 'camera', to: h.e.name, preset, options: o });
      },
      fade(h, o) { S.effects.push({ tick: S.tick, kind: 'camera.fade', to: h.e.name, options: o }); },
      playAnimation() {},
      setDefaultCamera() {},
      setFov() {},
      resetFov() {},
    },
    get: { isValid: (h) => h.e.valid },
  },
  EntityComponent: { get: { entity: (h) => entityObj(h.e), isValid: (h) => h.e.valid } },
  Component: { get: { isValid: (h) => (typeof h.valid === 'function' ? h.valid() : h.e ? h.e.valid : true) } },
  EntityInventoryComponent: {
    get: {
      typeId: () => 'minecraft:inventory',
      container: (h) => containerObj(h.e),
      inventorySize: (h) => h.e.inventory.length,
      additionalSlotsPerStrength: () => 0,
      canBeSiphonedFrom: () => false,
      containerType: (h) => (h.e.player ? 'inventory' : 'none'),   // 実測: プレイヤーは inventory
      private: () => false,
      restrictToOwner: (h) => Boolean(h.e.player),                 // 実測: プレイヤーは true
    },
  },
  EntityHealthComponent: {
    fns: {
      setCurrentValue(h, v) { if (v < 0 || v > h.e.maxHealth) return false; h.e.health = v; return true; },
      resetToMaxValue(h) { h.e.health = h.e.maxHealth; },
      resetToDefaultValue(h) { h.e.health = h.e.maxHealth; },
      resetToMinValue(h) { h.e.health = 0; },
    },
    get: {
      typeId: () => 'minecraft:health',
      currentValue: (h) => $Math.max(0, h.e.health),
      effectiveMax: (h) => h.e.maxHealth,
      effectiveMin: () => 0,
      defaultValue: (h) => h.e.maxHealth,
    },
  },
  EntityItemComponent: {
    get: { typeId: () => 'minecraft:item', itemStack: (h) => itemObj(copyItem(h.e.item)) },
  },
});
