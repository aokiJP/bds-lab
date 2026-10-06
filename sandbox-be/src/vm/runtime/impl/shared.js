// 実装が共通で使う小道具と、持ち物を変えたあとの通知の差し込み

const hEntityType = {};

function assertLoaded(h) {
  if (!chunkLoaded(h.dim, h.p.x, h.p.z)) throw fail('LocationInUnloadedChunkError', `(${h.p.x}, ${h.p.y}, ${h.p.z}) の区画は読み込まれていません`);
}
function offsetBlock(h, dx, dy, dz) {
  const p = checkLoc(h.dim, { x: h.p.x + dx, y: h.p.y + dy, z: h.p.z + dz }, { unloaded: 'undefined' });
  return p ? blockObj(h.dim, p) : undefined;
}
function matchFilter(perm, f) {
  if (!f) return true;
  const ids = (list) => (list ?? []).map((x) => (typeof x === 'string' ? blockTypeId(x) : H.get(x)?.perm?.id ?? H.get(x)?.id));
  if (f.includeTypes && !ids(f.includeTypes).includes(perm.id)) return false;
  if (f.excludeTypes && ids(f.excludeTypes).includes(perm.id)) return false;
  if (f.includePermutations && !f.includePermutations.some((p) => samePerm(H.get(p).perm, perm))) return false;
  if (f.excludePermutations && f.excludePermutations.some((p) => samePerm(H.get(p).perm, perm))) return false;
  if (f.includeTags?.length) return false;
  return true;
}
const samePerm = (a, b) => a.id === b.id && $Object.entries(a.states).every(([k, v]) => b.states[k] === v);
const minOf = (l) => Vec(l.length ? { x: $Math.min(...l.map((p) => p.x)), y: $Math.min(...l.map((p) => p.y)), z: $Math.min(...l.map((p) => p.z)) } : { x: 0, y: 0, z: 0 });
const maxOf = (l) => Vec(l.length ? { x: $Math.max(...l.map((p) => p.x)), y: $Math.max(...l.map((p) => p.y)), z: $Math.max(...l.map((p) => p.z)) } : { x: 0, y: 0, z: 0 });

// 実測: 持ち物をいじるたびに通知が出る。操作のあとで毎回見に行く
for (const fn of ['setItem', 'addItem', 'clearAll', 'clearSlot', 'swapItems', 'transferItem', 'moveItem']) {
  const prev = IMPL.Container?.fns?.[fn];
  if (!prev) continue;
  IMPL.Container.fns[fn] = function wrapped(h, ...a) {
    const r = $apply(prev, this, [h, ...a]);
    if (h?.e?.player) syncInv(h.e);
    return r;
  };
}

/** vanilla のカメラプリセット。無い名前は実機で Error: Invalid camera preset. になる */
const CAMERA_PRESETS = new $Set([
  'minecraft:first_person', 'minecraft:third_person', 'minecraft:third_person_front',
  'minecraft:free', 'minecraft:follow_orbit', 'minecraft:fixed_boom',
]);
