// 実装: Container / ContainerSlot / ItemStack / Scoreboard

$Object.assign(IMPL, {
  Container: {
    fns: {
      addItem(h, item) {
        const it = H.get(item).it;
        const left = addItem(h.e, it);
        return left > 0 ? itemObj({ ...copyItem(it), amount: left }) : undefined;
      },
      getItem(h, slot) { const s = h.e.inventory[slotIndex(h, slot)]; return s ? itemObj(copyItem(s)) : undefined; },
      setItem(h, slot, item) {
        const i = slotIndex(h, slot);
        h.e.inventory[i] = item ? copyItem(H.get(item).it) : null;
      },
      clearAll(h) { h.e.inventory.fill(null); },
      moveItem(h, from, to, other) {
        const i = slotIndex(h, from);
        const dst = H.get(other);
        const j = slotIndex(dst, to);
        if (dst.e.inventory[j]) throw fail('Error', `移動先のスロット ${to} は空いていません`);
        dst.e.inventory[j] = h.e.inventory[i];
        h.e.inventory[i] = null;
      },
      swapItems(h, a, b, other) {
        const i = slotIndex(h, a);
        const dst = H.get(other);
        const j = slotIndex(dst, b);
        const t = h.e.inventory[i];
        h.e.inventory[i] = dst.e.inventory[j];
        dst.e.inventory[j] = t;
      },
      transferItem(h, from, other) {
        const i = slotIndex(h, from);
        const it = h.e.inventory[i];
        if (!it) return undefined;
        const left = addItem(H.get(other).e, it);
        h.e.inventory[i] = left > 0 ? { ...it, amount: left } : null;
        return left > 0 ? itemObj({ ...it, amount: left }) : undefined;
      },
      getSlot(h, slot) {
        const i = slotIndex(h, slot);
        return inst('ContainerSlot', { e: h.e, i, valid: () => h.e.valid });
      },
      contains(h, item) {
        const it = H.get(item).it;
        const total = h.e.inventory.reduce((n, s) => n + (s && s.typeId === it.typeId ? s.amount : 0), 0);
        return total >= it.amount;
      },
      find(h, item) { const it = H.get(item).it; const i = h.e.inventory.findIndex((s) => s && s.typeId === it.typeId); return i < 0 ? undefined : i; },
      firstEmptySlot(h) { const i = h.e.inventory.findIndex((s) => !s); return i < 0 ? undefined : i; },
      firstItem(h) { const i = h.e.inventory.findIndex((s) => s); return i < 0 ? undefined : i; },
    },
    get: {
      size: (h) => h.e.inventory.length,
      emptySlotsCount: (h) => h.e.inventory.filter((s) => !s).length,
      isValid: (h) => h.e.valid,
      weight: (h) => h.e.inventory.reduce((n, it) => n + itemWeight(it), 0),
      containerRules: () => undefined,
    },
  },
  ContainerSlot: {
    fns: {
      getItem(h) { const s = h.e.inventory[h.i]; return s ? itemObj(copyItem(s)) : undefined; },
      setItem(h, item) { h.e.inventory[h.i] = item ? copyItem(H.get(item).it) : null; },
      hasItem(h) { return Boolean(h.e.inventory[h.i]); },
      getLore(h) { return [...(h.e.inventory[h.i]?.lore ?? [])]; },
      setLore(h, l) { const s = h.e.inventory[h.i]; if (s) s.lore = [...(l ?? [])]; },
    },
    get: {
      typeId: (h) => h.e.inventory[h.i]?.typeId,
      amount: (h) => h.e.inventory[h.i]?.amount ?? 0,
      nameTag: (h) => h.e.inventory[h.i]?.nameTag,
      isValid: (h) => h.e.valid,
    },
    set: {
      amount: (h, v) => { const s = h.e.inventory[h.i]; if (s) s.amount = v; },
      nameTag: (h, v) => { const s = h.e.inventory[h.i]; if (s) s.nameTag = v; },
    },
  },
  ItemStack: {
    ctor(type, amount = 1) {
      const id = typeof type === 'string' ? (itemId(type) ?? (fullId(type) === 'minecraft:written_book' ? 'minecraft:written_book' : null)) : H.get(type)?.id;
      if (!id) throw fail('Error', `Invalid item identifier '${type}'.`);
      // 実機: 1〜255 なら受け、スタック上限を超える分は黙って丸める
      return { it: { typeId: id, amount: $Math.min(amount, ITEM_MAX(id)), lore: [] }, valid: () => true };
    },
    fns: {
      clone(h) { return itemObj(copyItem(h.it)); },
      getLore(h) { return [...h.it.lore]; },
      setLore(h, l) { h.it.lore = [...(l ?? [])]; },
      isStackableWith(h, o) { const b = H.get(o).it; return h.it.typeId === b.typeId && !h.it.nameTag && !b.nameTag && ITEM_MAX(h.it.typeId) > 1; },
      matches(h, id) { return h.it.typeId === itemId(id); },
      getComponent(h, id) { void id; return undefined; },
      getComponents() { return []; },
      hasComponent() { return false; },
      getTags() { return []; },
      hasTag() { return false; },
      getDynamicProperty(h, k) { return h.it.dyn?.[k]; },
      setDynamicProperty(h, k, v) { h.it.dyn ??= {}; h.it.dyn[k] = v; },
      getDynamicPropertyIds(h) { return $Object.keys(h.it.dyn ?? {}); },
      clearDynamicProperties(h) { h.it.dyn = {}; },
      getCanDestroy() { return []; },
      getCanPlaceOn() { return []; },
      setCanDestroy() {},
      setCanPlaceOn() {},
    },
    get: {
      typeId: (h) => h.it.typeId,
      type: (h) => itemTypeObj(h.it.typeId),
      amount: (h) => h.it.amount,
      maxAmount: (h) => ITEM_MAX(h.it.typeId),
      isStackable: (h) => ITEM_MAX(h.it.typeId) > 1,
      nameTag: (h) => h.it.nameTag,
      keepOnDeath: (h) => Boolean(h.it.keepOnDeath),
      lockMode: () => 'none',
      localizationKey: (h) => `item.${h.it.typeId.slice(10)}.name`,
      weight: (h) => itemWeight(h.it),
    },
    set: {
      amount: (h, v) => {
        const max = ITEM_MAX(h.it.typeId);
        // 実機: スタック上限を超える値は黙って丸める（実測: 100 → 64）
        v = $Math.max(1, $Math.min(max, v));
        h.it.amount = v;
      },
      nameTag: (h, v) => { h.it.nameTag = v; },
      keepOnDeath: (h, v) => { h.it.keepOnDeath = v; },
    },
  },
  Scoreboard: {
    fns: {
      addObjective(h, id, name) {
        if (objectives.get(id)?.valid) throw fail('Error', `Failed to add objective '${id}' as it is already being tracked.`);
        const o = { id, displayName: name ?? id, criteria: 'dummy', scores: new $Map(), valid: true };
        objectives.set(id, o);
        return objectiveObj(o);
      },
      getObjective(h, id) { const o = objectives.get(id); return o?.valid ? objectiveObj(o) : undefined; },
      getObjectives() { return [...objectives.values()].filter((o) => o.valid).map(objectiveObj); },
      removeObjective(h, o) {
        const id = typeof o === 'string' ? o : H.get(o).o.id;
        const rec = objectives.get(id);
        if (!rec?.valid) throw fail('Error', 'Failed to find the objective specified.');
        rec.valid = false;
        objectives.delete(id);
        for (const k of $Object.keys(displaySlots)) if (displaySlots[k]?.o?.id === id) delete displaySlots[k];
        return true;
      },
      getParticipants() { return [...identities.values()].map(identityObj); },
      setObjectiveAtDisplaySlot(h, slot, o) {
        // 実測: sortOrder は数の列挙。文字列を渡すと型エラーになる
        if (o?.sortOrder !== undefined && typeof o.sortOrder !== 'number') {
          throw new $TypeError("Native type conversion failed. Interface property ['sortOrder'] expected type: ObjectiveSortOrder | undefined (failed parsing interface to Function argument [1]).");
        }
        const prev = displaySlots[slot] ? objectiveObj(displaySlots[slot].o) : undefined;
        displaySlots[slot] = { o: H.get(o.objective).o, sortOrder: o?.sortOrder };
        return prev;
      },
      getObjectiveAtDisplaySlot(h, slot) {
        const d = displaySlots[slot];
        return d ? { objective: objectiveObj(d.o), sortOrder: d.sortOrder } : undefined;
      },
      clearObjectiveAtDisplaySlot(h, slot) {
        const d = displaySlots[slot];
        delete displaySlots[slot];
        return d ? objectiveObj(d.o) : undefined;
      },
    },
  },
  ScoreboardObjective: {
    fns: {
      addScore(h, p, n) { const i = participant(p); const v = (h.o.scores.get(i.id) ?? 0) + n; h.o.scores.set(i.id, v); return v; },
      setScore(h, p, n) { h.o.scores.set(participant(p).id, n); },
      getScore(h, p) {
        const i = knownParticipant(p);
        if (!i) throw fail('Error', `Failed to resolve identity for '${participantLabel(p)}'.`);
        return h.o.scores.get(i.id);
      },
      getScores(h) {
        return [...h.o.scores].map(([iid, score]) => inst('ScoreboardScoreInfo', { data: { participant: identityObj(identities.get(iid)), score } }));
      },
      getParticipants(h) { return [...h.o.scores.keys()].map((iid) => identityObj(identities.get(iid))); },
      hasParticipant(h, p) {
        const i = knownParticipant(p);
        return Boolean(i && h.o.scores.has(i.id));
      },
      removeParticipant(h, p) {
        const i = knownParticipant(p);
        return Boolean(i && h.o.scores.delete(i.id));
      },
      isValid(h) { return h.o.valid; },
    },
    get: {
      id: (h) => h.o.id,
      displayName: (h) => h.o.displayName,
      isValid: (h) => h.o.valid,
    },
  },
  ScoreboardIdentity: {
    fns: {
      getEntity(h) { const e = h.i.entityId && entities.get(h.i.entityId); return e && e.valid ? entityObj(e) : undefined; },
      isValid() { return true; },
    },
    get: {
      id: (h) => h.i.id,
      displayName: (h) => h.i.name,
      type: (h) => h.i.type,
      isValid: () => true,
    },
  },
});
