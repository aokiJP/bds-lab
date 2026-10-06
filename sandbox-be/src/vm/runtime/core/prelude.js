// 凍結した組み込み・実機の三角関数表・データの読み込み

// 検証対象が組み込みを書き換えても、こちらの集計が壊れないよう先に握っておく
const $JSON = { stringify: JSON.stringify, parse: JSON.parse };
const $Object = { keys: Object.keys, values: Object.values, entries: Object.entries, fromEntries: Object.fromEntries, defineProperty: Object.defineProperty, freeze: Object.freeze, create: Object.create, getPrototypeOf: Object.getPrototypeOf, assign: Object.assign };
const $Array = { isArray: Array.isArray, from: Array.from };
const $Math = { floor: Math.floor, ceil: Math.ceil, sqrt: Math.sqrt, min: Math.min, max: Math.max, abs: Math.abs, round: Math.round, trunc: Math.trunc, sign: Math.sign, sin: Math.sin, cos: Math.cos, atan2: Math.atan2, fround: Math.fround, imul: Math.imul, PI: Math.PI };
// 実機の三角関数（BDS の値から逆算: float32 の π で作った 65536 要素の表を引く）
// 実機（BDS 1.26.51.1）の向きを一周 65536 通り読み取って割り出した:
//   表は sin(i / 10430.378f)、cos は 16384 を足してから切り捨てる（Java 版と同じ）
const SIN_TABLE = new Float32Array(65536);
for (let i = 0; i < 65536; i++) SIN_TABLE[i] = Math.sin(Math.fround(i / Math.fround(10430.378)));
const TBL_K = Math.fround(10430.378);
const mceSin = (x) => SIN_TABLE[Math.trunc(Math.fround(x * TBL_K)) & 65535];
const mceCos = (x) => SIN_TABLE[Math.trunc(Math.fround(Math.fround(x * TBL_K) + 16384)) & 65535];
const F = Math.fround;
const F_DEG = F(Math.PI / 180);
const F_PI = F(Math.PI);
const $Date = Date;
const $dateNow = Date.now;
const $Map = Map;
const $Set = Set;
const $WeakMap = WeakMap;
const $Promise = Promise;
const $Error = Error;
const $TypeError = TypeError;
const $Uint8Array = Uint8Array;
const $ReferenceError = ReferenceError;
const $String = String;
const $Number = Number;
const $Symbol = Symbol;
const $apply = Reflect.apply;
const OBJ_PROTO = Object.prototype;
const $isFinite = Number.isFinite;
const $isInteger = Number.isInteger;

const API = $JSON.parse(apiJson);
const VANILLA = $JSON.parse(vanillaJson);
const CFG = $JSON.parse(configJson);
// 実機（BDS）から測った値。無ければ公式メタデータだけで動く
const M = VANILLA.measured ?? { blocks: {}, items: {}, entities: {}, states: {}, effects: [], enchantments: {}, biomes: {}, dimensions: {}, gamerules: {} };
// 実測: プレイヤーの頭の高さ（実機にプレイヤーをつないで測った float32 の値）
const PLAYER_HEAD = 1.5200119018554688;
const PLAYER_DATA = { hp: [20, 20, 20], fam: ['player'], move: 0.1, inv: 36, eq: true, aabb: { z: 0.3000030517578125, y: 0.8999996185302734, x: 0.3000030517578125 }, head: 1.5200119018554688, comps: ['minecraft:health', 'minecraft:inventory', 'minecraft:equippable', 'minecraft:movement', 'minecraft:underwater_movement', 'minecraft:lava_movement', 'minecraft:type_family', 'minecraft:breathable', 'minecraft:rideable', 'minecraft:is_hidden_when_invisible', 'minecraft:can_climb'] };
// 実測のエンティティは、たまたま子どもで湧いたものもある。サンドボックスでは大人を既定にし、
// 子どもだけが持つもの（is_baby / ageable / baby_ ファミリー）は e.baby のときだけ付ける
const adultCache = new Map();
const BABY_ONLY = ['minecraft:is_baby', 'minecraft:ageable'];
const entityDataRaw = (id) => (id === 'minecraft:player' ? PLAYER_DATA : M.entities[id] ?? null);
// 子どもは実機で測ったもの（大きさ・頭の位置・当たり判定・持っているコンポーネント）に差し替える
const babyCache = new Map();
const entityData = (id, baby = false) => {
  const d = entityDataRaw(id);
  if (d && baby && id !== 'minecraft:player') {
    const b = M.babies?.[id];
    if (!b) return d;
    if (!babyCache.has(id)) {
      const props = { ...(d.props ?? {}) };
      if (b.scale !== null && b.scale !== undefined) props['minecraft:scale'] = { ...(props['minecraft:scale'] ?? {}), value: b.scale };
      if (b.ageable) {
        props['minecraft:ageable'] = { duration: b.ageable.duration, transformToItem: b.ageable.transformToItem, growUp: '__object' };
        // babies の feed は [item, growth, resultItem] の並びで持っている。使う側は { item, growth, resultItem }
        const feedObj = (f) => (Array.isArray(f) ? { item: f[0], growth: f[1], resultItem: f[2] } : f);
        props['minecraft:ageable#calls'] = { growUp: b.ageable.growUp, drop: b.ageable.drop, feed: (b.ageable.feed ?? []).map(feedObj) };
      }
      babyCache.set(id, { ...d, comps: b.comps, props, aabb: { z: b.aabb.x, y: b.aabb.y, x: b.aabb.x }, head: b.head[0], headZ: b.head[1] });
    }
    return babyCache.get(id);
  }
  if (!d || baby || id === 'minecraft:player') return d;
  if (!adultCache.has(id)) {
    adultCache.set(id, { ...d, comps: d.comps && !d.comps.error ? d.comps.filter((c) => !BABY_ONLY.includes(c)) : d.comps, fam: $Array.isArray(d.fam) ? d.fam.filter((f) => !/^baby_/.test(f)) : d.fam });
  }
  return adultCache.get(id);
};

// 地物・地物ルールの登録名（BDS の behavior_packs から取り出したもの）
const FEATURES = new Set(M.features ?? []);
const FEATURE_RULES = new Set(M.featureRules ?? []);
