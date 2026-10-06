// 持ち物

// ---- 持ち物 ----------------------------------------------------------------

function addItem(e, it) {
  const inv = e.inventory;
  let left = it.amount;
  const max = ITEM_MAX(it.typeId);
  for (let i = 0; i < inv.length && left > 0; i++) {
    const s = inv[i];
    if (s && s.typeId === it.typeId && !s.nameTag && !it.nameTag && s.amount < max) {
      const n = $Math.min(max - s.amount, left);
      s.amount += n;
      left -= n;
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (!inv[i]) {
      const n = $Math.min(max, left);
      inv[i] = { typeId: it.typeId, amount: n, nameTag: it.nameTag, lore: [...(it.lore ?? [])] };
      left -= n;
    }
  }
  return left;
}

const itemObj = (it) => inst('ItemStack', { it, valid: () => true });
const copyItem = (it) => (copyItemRef.fn ? copyItemRef.fn(it) : { typeId: it.typeId, amount: it.amount, nameTag: it.nameTag, lore: [...(it.lore ?? [])] });

/** 持ち物の差分を見て playerInventoryItemChange を出す。
 *  実測: 操作ごとに届く（clearAll と addItem を同じ tick でやっても 2 つに分かれる）。 */
function syncInv(e) {
  if (!e.player || !e.inventory) return;
  const prev = lastInv.get(e.id);
  const now = e.inventory.map((s) => (s ? `${s.typeId}|${s.amount}|${s.nameTag ?? ''}` : ''));
  if (prev) {
    for (let i = 0; i < now.length; i++) {
      if (now[i] === prev.keys[i]) continue;
      fireAfter('world.afterEvents', 'playerInventoryItemChange', {
        player: entityObj(e), slot: i, inventoryType: i < 9 ? 'Hotbar' : 'Inventory',   // 実測: 0〜8 は Hotbar
        itemStack: e.inventory[i] ? itemObj(copyItem(e.inventory[i])) : undefined,
        beforeItemStack: prev.items[i] ? itemObj(prev.items[i]) : undefined,
      });
    }
  }
  lastInv.set(e.id, { keys: now, items: e.inventory.map((s) => (s ? copyItem(s) : null)) });
}
/** 実測: 選択枠の変化は、その tick の持ち物の通知より後に届く */
function syncSlot(e) {
  const prev = lastSlot.get(e.id);
  const now = e.selectedSlot ?? 0;
  if (prev !== undefined && prev !== now) {
    fireAfter('world.afterEvents', 'playerHotbarSelectedSlotChange', {
      player: entityObj(e), previousSlotSelected: prev, newSlotSelected: now,
      itemStack: e.inventory?.[now] ? itemObj(copyItem(e.inventory[now])) : undefined,
    });
  }
  lastSlot.set(e.id, now);
}
const lastSlot = new $Map();

function containerObj(e) {
  e._c ??= { e, valid: () => e.valid };
  return once('Container', e._c);
}

function slotIndex(h, slot) {
  const inv = h.e.inventory;
  if (!$isInteger(slot) || slot < 0 || slot >= inv.length) throw fail('Error', `Invalid container slot provided '${slot}'. Maximum slot is '${inv.length - 1}'.`);
  return slot;
}
