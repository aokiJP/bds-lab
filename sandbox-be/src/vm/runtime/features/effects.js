// 拡張: 効果

// ---- 効果 -------------------------------------------------------------------
const effectId = (v) => {
  if (typeof v !== 'string') return H.get(v)?.id ?? null;
  const full = v.includes(':') ? v : `minecraft:${v}`;
  return (M.effects.length ? M.effects : VANILLA.effects).includes(full) ? full : null;
};
const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
const titleOf = (id) => id.slice(10).split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
function effectObj(e, id) {
  return inst('Effect', { e, id, valid: () => e.valid && Boolean(e.effects?.get(id)) });
}
IMPL.Effect = {
  get: {
    typeId: (h) => h.id,
    amplifier: (h) => h.e.effects.get(h.id).amplifier,
    duration: (h) => h.e.effects.get(h.id).duration,
    displayName: (h) => `${titleOf(h.id)}${ROMAN[h.e.effects.get(h.id).amplifier] ?? ` ${h.e.effects.get(h.id).amplifier + 1}`}`,
    isValid: (h) => h.valid(),
  },
};
$Object.assign(IMPL.Entity.fns, {
  addEffect(h, type, duration, o) {
    const id = effectId(type);
    if (!id) throw fail('InvalidArgumentError', 'Invalid type passed to argument [0]. Expected type: effectType');
    const amp = o?.amplifier ?? 0;
    if (amp < 0 || amp > 255) throw outOfBounds(2, amp, 0, 255, 'amplifier');
    // 死んでいく途中のエンティティには付かない（実測: undefined、イベントも無し）
    if (h.e.dying !== undefined) return undefined;
    // 実測: before の effectType は ID ではなく表示名（「Regeneration II」など）
    const shown = `${titleOf(id)}${ROMAN[amp] ?? ` ${amp + 1}`}`;
    const data = fireBefore('world.beforeEvents', 'effectAdd', { entity: entityObj(h.e), effectType: shown, duration, cancel: false });
    if (data.cancel) return undefined;
    h.e.effects ??= new $Map();
    const cur = h.e.effects.get(id);
    // バニラ: 強いほう、同じ強さなら長いほうが残る
    if (cur && (cur.amplifier > amp || (cur.amplifier === amp && cur.duration > data.duration))) return effectObj(h.e, id);
    // 即時の効果も Effect を返し、効き目は tick の終わりに出る（実測: 呼んだ直後の体力は変わらない）
    h.e.effects.set(id, { amplifier: amp, duration: data.duration, showParticles: o?.showParticles ?? true, instant: /^minecraft:instant_/.test(id), addedTick: S.tick });
    const ef = effectObj(h.e, id);
    fireAfter('world.afterEvents', 'effectAdd', { entity: entityObj(h.e), effect: ef });
    return ef;
  },
  getEffect(h, type) { const id = effectId(type); return id && h.e.effects?.get(id) ? effectObj(h.e, id) : undefined; },
  getEffects(h) { return [...(h.e.effects?.keys() ?? [])].map((id) => effectObj(h.e, id)); },
  removeEffect(h, type) { const id = effectId(type); return Boolean(id && h.e.effects?.delete(id)); },
  setDynamicProperties(h, m) { for (const [k, v] of $Object.entries(m)) { if (v === undefined) h.e.dyn.delete(k); else h.e.dyn.set(k, typeof v === 'object' ? Vec(v) : v); } },
  getAABB(h) {
    const [w, hh] = h.e.player ? [0.6, 1.8] : [0.6, 1.0];
    return { center: { x: h.e.loc.x, y: h.e.loc.y + hh / 2, z: h.e.loc.z }, extent: { x: w / 2, y: hh / 2, z: w / 2 } };
  },
  // 実機は足元（location）から向きを計算する（実測）
  lookAt(h, t) {
    // 実機の計算に合わせる: 差は float、水平距離も float、ラジアンを float にしてから
    // 度に直す係数 180/PI（float どうしで計算した 57.2957763671875）を掛ける
    const dx = F(F(t.x) - h.e.loc.x);
    const dy = F(F(t.y) - h.e.loc.y);
    const dz = F(F(t.z) - h.e.loc.z);
    const hyp = F($Math.sqrt(F(F(dx * dx) + F(dz * dz))));
    const yaw = dx === 0 && dz === 0 ? 0 : F(-F($Math.atan2(dx, dz)) * DEG_PER_RAD);
    const pitch = F(-F($Math.atan2(dy, hyp)) * DEG_PER_RAD);
    h.e.rot = normRot(pitch, yaw);
  },
  getBlockStandingOn(h) {
    const p = { x: $Math.floor(h.e.loc.x), y: $Math.floor(h.e.loc.y - 0.01), z: $Math.floor(h.e.loc.z) };
    if (!chunkLoaded(h.e.dim, p.x, p.z)) return undefined;
    const d = DIMS[h.e.dim];
    if (p.y < d.min || p.y >= d.max) return undefined;
    return readBlock(h.e.dim, p.x, p.y, p.z).id === 'minecraft:air' ? undefined : blockObj(h.e.dim, p);
  },
  getAllBlocksStandingOn(h) { const b = this.getBlockStandingOn(); return b ? [b] : []; },
  getBlockFromViewDirection(h, o) { return rayBlock(h.e.dim, this.getHeadLocation(), this.getViewDirection(), o); },
  getEntitiesFromViewDirection(h, o) { return rayEntities(h.e.dim, this.getHeadLocation(), this.getViewDirection(), o, h.e); },
  applyImpulse(h, v) { physImpulse(h.e, v); },
  applyKnockback(h, horizontal, verticalStrength) { physKnockback(h.e, horizontal, verticalStrength); },
  clearVelocity(h) { const e = h.e; e.vel = { x: 0, y: 0, z: 0 }; e.rep = { x: 0, y: 0, z: 0 }; },
  getProperty: ni('entity.getProperty（エンティティの定義ファイルが要ります）'),
  setProperty: ni('entity.setProperty（エンティティの定義ファイルが要ります）'),
  resetProperty: ni('entity.resetProperty（エンティティの定義ファイルが要ります）'),
  playAnimation: (h, name, o) => { S.effects.push({ tick: S.tick, kind: 'animation', entity: h.e.id, id: name, options: o }); },
  triggerEvent(h, ev) {
    // 実機: コンポーネントグループの出し入れは次の tick に効く（同じ tick には見えない）
    if (ev === 'minecraft:as_baby' || ev === 'minecraft:entity_born') h.e.pendingBaby = true;
    if (ev === 'minecraft:ageable_grow_up' || ev === 'minecraft:as_adult') h.e.pendingBaby = false;
    S.effects.push({ tick: S.tick, kind: 'entityEvent', entity: h.e.id, event: ev });
    fireAfter('world.afterEvents', 'dataDrivenEntityTrigger', { entity: entityObj(h.e), eventId: ev, _modifiers: [] });
  },
});
IMPL.Entity.get.isSneaking = (h) => Boolean(h.e.sneaking);
IMPL.Entity.set = { ...(IMPL.Entity.set ?? {}), isSneaking: (h, v) => { h.e.sneaking = v; } };
IMPL.Entity.get.nameplateDepthTested = (h) => h.e.nameplateDepthTested ?? false; // 実測の既定値
IMPL.Entity.set.nameplateDepthTested = (h, v) => { h.e.nameplateDepthTested = v; };
IMPL.Entity.get.nameplateRenderDistance = (h) => h.e.nameplateRenderDistance ?? 64; // 実測の既定値
IMPL.Entity.set.nameplateRenderDistance = (h, v) => { h.e.nameplateRenderDistance = v; };
IMPL.DataDrivenEntityTriggerAfterEvent = { fns: { getModifiers: () => [] } };

// コンポーネントは、実機で測った「その種類が持っているもの」に従う
const familiesOf = (e) => famOf(e) ?? [];
IMPL.EntityTypeFamilyComponent = {
  fns: {
    getTypeFamilies: (h) => [...familiesOf(h.e)],
    hasTypeFamily: (h, f) => familiesOf(h.e).includes(f),
  },
  get: { typeId: () => 'minecraft:type_family' },
};
/** getBlockAbove / getBlockBelow の走査（開始地点を含む） */
function scanBlock(dim, loc, step, o) {
  const x = $Math.floor(loc.x), z = $Math.floor(loc.z);
  if (!chunkLoaded(dim, x, z)) return undefined;
  const d = DIMS[dim];
  const y0 = $Math.floor(loc.y);
  const max = o?.maxDistance ?? (step > 0 ? d.max - y0 : y0 - d.min);
  for (let i = 0; i <= max; i++) {
    const y = y0 + i * step;
    if (y < d.min || y >= d.max) break;
    const b = readBlock(dim, x, y, z);
    if (b.id === 'minecraft:air') continue;
    if (o && !blockFilterOk(b, o)) continue;
    return blockObj(dim, { x, y, z });
  }
  return undefined;
}
function blockFilterOk(b, o) {
  const id = b.id;
  const inc = o.includeTypes, exc = o.excludeTypes;
  if (inc && inc.length && !inc.map(fullId).includes(id)) return false;
  if (exc && exc.length && exc.map(fullId).includes(id)) return false;
  if (o.includeTags && o.includeTags.length && !o.includeTags.some((t) => (blockTags(id) ?? []).includes(t))) return false;
  if (o.excludeTags && o.excludeTags.some((t) => (blockTags(id) ?? []).includes(t))) return false;
  return true;
}
function componentOf(e, id) {
  const full = fullId(id);
  const k = full.slice(10);
  const data = entityData(e.typeId, e.baby);
  if (k === 'item') return e.item ? once('EntityItemComponent', (e._item ??= { e, valid: () => e.valid })) : undefined;
  const has = data?.comps ? data.comps.includes(full) || (k === 'inventory' && Boolean(e.inventory)) : null;
  if (has === false) return undefined;
  if (k === 'health') return once('EntityHealthComponent', (e._hp ??= { e, valid: () => e.valid }));
  if (k === 'inventory') return e.inventory ? once('EntityInventoryComponent', (e._inv ??= { e, valid: () => e.valid })) : undefined;
  if (ATTR[k]) return attrObj(e, k);
  if (k === 'type_family') return once('EntityTypeFamilyComponent', (e._fam ??= { e, valid: () => e.valid }));
  if (k === 'equippable') {
    if (!(data?.eq ?? e.player)) return undefined;
    e._eq ??= { e, typeId: 'minecraft:equippable', valid: () => e.valid };
    return once('EntityEquippableComponent', e._eq);
  }
  const known = API.modules['@minecraft/server'].componentMaps.EntityComponentTypeMap;
  // 中身の無い「印」のコンポーネント（typeId だけ）はそのまま返せる
  const cls = known[full];
  const cm = cls && CLASSES[cls]?.__meta;
  const measuredFirst = entityData(e.typeId, e.baby)?.props?.[full];
  if (has === true && cm && !measuredFirst && !$Object.keys(cm.fns).length && $Object.values(cm.props).every((p) => p.v !== undefined)) {
    e._marks ??= {};
    return once(cls, (e._marks[full] ??= { e, typeId: full, valid: () => e.valid }));
  }
  // 実機で測った既定値だけを返す（中身の動き（リード・騎乗など）は再現していない）
  const measured = entityData(e.typeId, e.baby)?.props?.[full];
  if (has === true && cls && CLASSES[cls] && measured) {
    e._generic ??= {};
    if (!e._generic[full]) {
      const data = {};
      for (const [pk, pv] of $Object.entries(measured)) {
        if (pk === 'entity' || pk === 'isValid' || pv === '__object' || (pv && typeof pv === 'object' && pv.error)) continue;
        data[pk] = pv === '__undefined' ? undefined : pv;
      }
      e._generic[full] = { e, typeId: full, data, valid: () => e.valid };
    }
    return once(cls, e._generic[full]);
  }
  if (has === true || known[full] || known[k]) {
    bump(S.unsupported, `Entity.getComponent(${k})`);
    throw new SandboxNotImplemented(`entity.getComponent('${k}')（${e.typeId} は実機でこのコンポーネントを持っていますが、中身は再現していません）`);
  }
  return undefined;
}
IMPL.Entity.fns.getComponent = (h, id) => (componentOfRef.fn ?? componentOf)(h.e, id);
IMPL.Entity.fns.hasComponent = (h, id) => {
  const full = fullId(id);
  const data = entityData(h.e.typeId, h.e.baby);
  if (full === 'minecraft:item') return Boolean(h.e.item);
  if (full === 'minecraft:onfire') return Boolean(h.e.fireTicks);
  if (full === 'minecraft:ender_inventory') return Boolean(h.e.player);
  return data?.comps ? data.comps.includes(full) : ['minecraft:health'].includes(full);
};
IMPL.Entity.fns.getComponents = (h) => {
  const data = entityData(h.e.typeId, h.e.baby);
  const out = [];
  let missing = 0;
  for (const c of data?.comps ?? ['minecraft:health']) {
    try { const o = (componentOfRef.fn ?? componentOf)(h.e, c); if (o) out.push(o); } catch (e) { if (e instanceof SandboxNotImplemented) missing++; else throw e; }
  }
  if (missing) notImplemented(new SandboxNotImplemented(`entity.getComponents()（${h.e.typeId} の ${missing} 個のコンポーネントは再現していません）`));
  return out;
};
// 実測: 頭の位置は「上下」と「前後（+z 向き固定。向きを変えても回らない）」にずれる
IMPL.Entity.fns.getHeadLocation = (h) => {
  const data = entityData(h.e.typeId, h.e.baby);
  const off = M.headOffset?.[h.e.typeId];
  const y = data?.head ?? off?.[0] ?? (h.e.player ? PLAYER_HEAD : 0.5);
  const z = data?.headZ ?? off?.[1] ?? 0;
  return { z: F(h.e.loc.z + z), y: F(h.e.loc.y + y), x: h.e.loc.x };
};
IMPL.Entity.fns.getAABB = (h) => {
  const ext = entityData(h.e.typeId, h.e.baby)?.aabb ?? { z: 0.3, y: 0.5, x: 0.3 };
  return { center: { z: h.e.loc.z, y: F(h.e.loc.y + ext.y), x: h.e.loc.x }, extent: { z: ext.z, y: ext.y, x: ext.x } };
};
const extentOf = (e) => entityData(e.typeId, e.baby)?.aabb ?? { z: 0.3, y: 0.5, x: 0.3 };

/** 矢の進む先にいる生き物（いちばん近いもの）。線分と当たり判定の箱で調べる */
function projectileTarget(e) {
  const v = e.vel;
  const spd = $Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
  if (!spd) return null;
  let best = null;
  let bestT = Infinity;
  for (const t of entities.values()) {
    if (!t.valid || t === e || t.dim !== e.dim || t.id === e.shooter) continue;
    if (!isMobFam(t) || isInanimate(t)) continue;
    const ext = extentOf(t);
    const lo = { x: t.loc.x - ext.x, y: t.loc.y, z: t.loc.z - ext.z };
    const hi = { x: t.loc.x + ext.x, y: t.loc.y + ext.y * 2, z: t.loc.z + ext.z };
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const k of ['x', 'y', 'z']) {
      if (!v[k]) { if (e.loc[k] < lo[k] || e.loc[k] > hi[k]) { ok = false; break; } continue; }
      let a = (lo[k] - e.loc[k]) / v[k];
      let b = (hi[k] - e.loc[k]) / v[k];
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < bestT) { bestT = t0; best = t; }
  }
  return best;
}

/** tryTeleport の checkForBlocks 用：その場所に体が入るか（ブロックでふさがっていないか） */
function canStandAt(e, dim, loc) {
  const ext = extentOf(e);
  const top = loc.y + ext.y * 2;
  const x = $Math.floor(loc.x);
  const z = $Math.floor(loc.z);
  for (let y = $Math.floor(loc.y); y <= $Math.floor(top - 0.0001); y++) {
    const b = readBlock(dim, x, y, z);
    if (!PASSABLE.test(b.id) && !LIQUID.test(b.id)) return false;
  }
  return true;
}
