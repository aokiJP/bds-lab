// 拡張: 物理（実機で 1 tick ずつ測ったもの）

// ---- 物理（実機 BDS で 1 tick ずつ測って合わせたもの） -----------------------------
//
// 実機で分かったこと（--bds で測った値が正）:
//   矢・投げ物: 毎 tick  pos += v; v.xz ×= 0.99; v.y = v.y×0.99 − g（矢 0.05 / 投げ物 0.03）
//               getVelocity はその場で今の v を返す
//   生き物:     毎 tick  d = (v.x, v.y − 0.0784, v.z); pos += d; v = (d.x×0.91, d.y×0.98, d.z×0.91)
//               getVelocity は「直前の tick に動いた量 d」を返す（1 tick 遅れて見える）
//               湧いた tick は動かない
//   ボート・トロッコ・TNT・経験値はレールや浮力や湧き時の乱数が絡むので再現していない
const DRAG_H = F(0.99), DRAG_MOB_H = F(0.91), DRAG_MOB_V = F(0.98);
const G_ARROW = F(0.05), G_THROWN = F(0.03), G_MOB = F(F(0.08) * F(0.98)); // 0.0784
/** その型を物理で動かすか。'arrow' | 'thrown' | 'mob' | null */
function physKind(e) {
  if (e.player) return null;
  const fam = famOf(e);
  if (!$Array.isArray(fam)) return null;
  if (fam.includes('projectile')) return fam.includes('arrow') ? 'arrow' : 'thrown';
  if (fam.includes('mob')) return 'mob';
  return null;
}
const isMobFam = (e) => $Array.isArray(famOf(e)) && famOf(e).includes('mob');
/** 実機: 生き物でも「動かないもの」（armor_stand）には効かない */
const isInanimate = (e) => $Array.isArray(famOf(e)) && famOf(e).includes('inanimate');
function physVelocity(e) {
  const v = physKind(e) === 'mob' ? e.rep : e.vel;
  return v ? { z: v.z, y: v.y, x: v.x } : { z: 0, y: 0, x: 0 };
}
function physImpulse(e, v) {
  e.vel = { x: F(e.vel.x + F(v?.x ?? 0)), y: F(e.vel.y + F(v?.y ?? 0)), z: F(e.vel.z + F(v?.z ?? 0)) };
  if (physKind(e) !== 'mob') e.rep = { ...e.vel };
}
function physKnockback(e, h, vertical) {
  if (!isMobFam(e)) throw fail('UnsupportedFunctionalityError', 'Unsupported functionality: applyKnockback is not supported for this entity.');
  if (isInanimate(e)) return; // 実機: armor_stand は例外も出ないが動かない
  // 実機: 横は「今の横速度の半分 ＋ 指定した向き ×0.4」、上下は指定値がそのまま次の 1 tick の動く量になる
  e.vel = {
    x: F(F(e.vel.x / 2) + F(F(h?.x ?? 0) * F(0.4))),
    y: F(F(vertical ?? 0) + G_MOB),
    z: F(F(e.vel.z / 2) + F(F(h?.z ?? 0) * F(0.4))),
  };
}
/** 実機の shoot: 向きを正規化してから、元の長さを掛け直す（float32 で計算するので 1 ulp ずれる） */
function shootVector(v) {
  const x = F(v?.x ?? 0), y = F(v?.y ?? 0), z = F(v?.z ?? 0);
  const len = F($Math.sqrt(F(F(F(x * x) + F(y * y)) + F(z * z))));
  if (!len) return { x: 0, y: 0, z: 0 };
  return { x: F(F(x / len) * len), y: F(F(y / len) * len), z: F(F(z / len) * len) };
}
/** 足場の上面で止める。動いた先が固いブロックの中なら、その上に乗せて上下の動きを止める */
function physGround(e, y) {
  const x = $Math.floor(e.loc.x), z = $Math.floor(e.loc.z);
  if (!chunkLoaded(e.dim, x, z)) return null;
  const d = DIMS[e.dim];
  const by = $Math.floor(y);
  if (by < d.min || by >= d.max) return null;
  const id = readBlock(e.dim, x, by, z).id;
  if (id === 'minecraft:air' || id === 'minecraft:water' || id === 'minecraft:flowing_water') return null;
  return by + 1;
}
/** 雨に当たっているか（屋根が無く、その次元が雨か雷雨） */
function inRain(e) {
  const w = DIMS[e.dim]?.weather;
  if (w !== 'Rain' && w !== 'Thunder') return false;
  const x = $Math.floor(e.loc.x), z = $Math.floor(e.loc.z);
  if (!chunkLoaded(e.dim, x, z)) return false;
  const d = DIMS[e.dim];
  for (let y = $Math.floor(e.loc.y) + 1; y < d.max; y++) {
    if (readBlock(e.dim, x, y, z).id !== 'minecraft:air') return false; // 屋根がある
  }
  return true;
}
/** 足元のブロックが水か（火がつくかの判定に使う） */
function inWater(e) {
  const x = $Math.floor(e.loc.x), y = $Math.floor(e.loc.y), z = $Math.floor(e.loc.z);
  if (!chunkLoaded(e.dim, x, z)) return false;
  const d = DIMS[e.dim];
  if (y < d.min || y >= d.max) return false;
  const b = readBlock(e.dim, x, y, z);
  return b.id === 'minecraft:water' || b.id === 'minecraft:flowing_water';
}
END_HOOKS.push(() => {
  for (const e of entities.values()) {
    if (!e.valid) continue;
    if (e.pendingBaby !== undefined) { e.baby = e.pendingBaby; e.pendingBaby = undefined; }
    // 火（実機: 1 tick に 1 ずつ減る。消したときの -1 は次の tick で消える。
    //     水の中や、屋根のないところで雨に当たると消える）
    if (e.fireTicks > 0) e.fireTicks = inWater(e) || inRain(e) ? -1 : e.fireTicks - 1;
    else if (e.fireTicks < 0) e.fireTicks = 0;
    const k = physKind(e);
    if (!k) continue;
    if (k === 'mob') {
      if (e.physNew) { e.physNew = false; continue; }
      const d = { x: e.vel.x, y: F(e.vel.y - G_MOB), z: e.vel.z };
      const before = e.loc;
      let ny = F(before.y + d.y);
      const g = d.y < 0 ? physGround(e, ny) : null;
      if (g !== null && ny < g) { ny = g; d.y = 0; e.vel.y = 0; }
      e.loc = { x: F(before.x + d.x), y: ny, z: F(before.z + d.z) };
      // 実機の getVelocity は座標の差（float32）なので、同じ丸めを通す
      e.rep = { x: F(e.loc.x - before.x), y: F(e.loc.y - before.y), z: F(e.loc.z - before.z) };
      e.vel = { x: F(d.x * DRAG_MOB_H), y: F(d.y * DRAG_MOB_V), z: F(d.z * DRAG_MOB_H) };
    } else {
      if (e.stuck) continue; // 刺さった矢はもう動かない
      // 実測: 進む先に生き物がいると、矢は消えて projectileHitEntity が起き、相手はダメージを受ける
      const tgt = projectileTarget(e);
      if (tgt) {
        fireAfter('world.afterEvents', 'projectileHitEntity', {
          dimension: dimObj(e.dim),
          hitVector: { x: e.vel.x, y: e.vel.y, z: e.vel.z },
          location: Vec(e.loc),
          projectile: entityObj(e),
          source: e.shooter ? entityObj(entities.get(e.shooter)) : undefined,
          _hit: { entity: entityObj(tgt) },
        });
        hurt(tgt, 2, { cause: 'projectile', damagingEntity: e.shooter ? entities.get(e.shooter) : undefined });
        removeEntity(e);
        continue;
      }
      // 実測: 進む先にブロックがあると、そこで止まって projectileHitBlock が起きる
      const spd = $Math.sqrt(e.vel.x ** 2 + e.vel.y ** 2 + e.vel.z ** 2);
      if (spd > 0) {
        const hit = rayBlock(e.dim, e.loc, e.vel, { maxDistance: spd + 0.5 });
        if (hit) {
          const bh = H.get(hit.block);
          e.loc = { x: F(e.loc.x + e.vel.x), y: F(e.loc.y + e.vel.y), z: F(e.loc.z + e.vel.z) };
          e.vel = { x: 0, y: 0, z: 0 };
          e.rep = { x: 0, y: 0, z: 0 };
          e.stuck = true;
          fireAfter('world.afterEvents', 'projectileHitBlock', {
            dimension: dimObj(e.dim),
            hitVector: { x: 0, y: 0, z: 0 },
            location: Vec(e.loc),
            projectile: entityObj(e),
            source: e.shooter ? entityObj(entities.get(e.shooter)) : undefined,
            _hit: { block: hit.block, face: hit.face, faceLocation: hit.faceLocation },
          });
          void bh;
          continue;
        }
      }
      let ny = F(e.loc.y + e.vel.y);
      const g = e.vel.y < 0 ? physGround(e, ny) : null;
      if (g !== null && ny < g) { ny = g; e.vel = { ...e.vel, y: 0 }; }
      e.loc = { x: F(e.loc.x + e.vel.x), y: ny, z: F(e.loc.z + e.vel.z) };
      e.vel = {
        x: F(e.vel.x * DRAG_H),
        y: F(F(e.vel.y * DRAG_H) - (k === 'arrow' ? G_ARROW : G_THROWN)),
        z: F(e.vel.z * DRAG_H),
      };
      e.rep = { ...e.vel };
    }
  }
});
