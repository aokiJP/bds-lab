// 仮想の世界（ブロック・エンティティ・プレイヤー・スコアボード・区画）

// ---- 仮想の世界 -------------------------------------------------------------

const DIMS = {
  'minecraft:overworld': { min: -64, max: 320, weather: 'Clear' },
  'minecraft:nether': { min: 0, max: 128, weather: 'Clear' },
  'minecraft:the_end': { min: 0, max: 256, weather: 'Clear' },
};
const dimId = (id) => {
  const s = $String(id);
  const full = s.includes(':') ? s : `minecraft:${s}`;
  return DIMS[full] ? full : null;
};

const W = CFG.world ?? {};
const GEN = W.generator ?? 'flat';
const SIM = W.simulationDistance ?? 4;

/** 生成したままの地形 */
function natural(dim, x, y) {
  void x;
  if (GEN !== 'flat' || dim !== 'minecraft:overworld') return 'minecraft:air';
  if (y === -64) return 'minecraft:bedrock';
  if (y === -63 || y === -62) return 'minecraft:dirt';
  if (y === -61) return 'minecraft:grass_block';
  return 'minecraft:air';
}

const blocks = new $Map(); // "dim|x|y|z" → { id, states }
const key = (dim, x, y, z) => `${dim}|${x}|${y}|${z}`;

const fullId = (id) => { const s = $String(id); return s.includes(':') ? s : `minecraft:${s}`; };

// パックが定義した型（blocks/ items/ entities/ の JSON）。実機と同じ材料を、書いてあるぶんだけ使う
const PACK = CFG.definitions ?? { blocks: {}, items: {}, entities: {} };
const packDef = (kind, id) => PACK[kind]?.[fullId(id)] ?? null;
const packComp = (kind, id, name) => packDef(kind, id)?.components?.[name];
/** その種類の type_family。バニラは実測、パックで定義した種類は定義ファイルの minecraft:type_family */
const famOf = (e) => entityData(e.typeId, e.baby)?.fam ?? packComp('entities', e.typeId, 'minecraft:type_family')?.family ?? null;

function blockTypeId(id) {
  const full = fullId(id);
  return M.blocks[full] || VANILLA.blocks[full] || PACK.blocks[full] ? full : null;
}

/** パックのブロック定義に書いてある状態（description.states）。無ければ null */
const packStates = (id) => packDef('blocks', id)?.states ?? null;
/** その状態に使える値。実測 → 公式データ → パックの定義 の順に見る */
const stateValues = (id, k) => M.states[k] ?? VANILLA.blocks[id]?.[k] ?? packStates(id)?.[k] ?? [];

/** 既定の状態。実測があればそれ（公式データに載らない状態も含む）。パックは書いた順の最初の値 */
function defaultStates(id) {
  if (M.blocks[id]?.states) return { ...M.blocks[id].states };
  const def = VANILLA.blocks[id] ?? {};
  const out = {};
  for (const [k, vals] of $Object.entries(def)) if (vals.length) out[k] = vals[0];
  for (const [k, vals] of $Object.entries(packStates(id) ?? {})) if (vals.length && !(k in out)) out[k] = vals[0];
  return out;
}

/** 実機の BlockPermutation.resolve は、知らない状態・範囲外の値を黙って無視する */
function makePerm(id, states, { strict = false } = {}) {
  const s = defaultStates(id);
  if (states) {
    for (const [k, v] of $Object.entries(states)) {
      if (!(k in s)) { if (strict) throw fail('Error', `${id} に状態 ${k} はありません`); continue; }
      const vals = stateValues(id, k);
      if (vals.length && !vals.includes(v)) { if (strict) throw fail('Error', `${id} の ${k} に ${fmt(v)} は使えません`); continue; }
      s[k] = v;
    }
  }
  return { id, states: s };
}
/** 実測: 持ち物の「重さ」= 個数 × 64 ÷ 1 枠の最大個数（積めない品は 1 個で 64） */
const itemWeight = (it) => (it ? it.amount * (64 / (ITEM_MAX(it.typeId) || 1)) : 0);
const blockTags = (id) => M.blocks[id]?.tags ?? packDef('blocks', id)?.tags ?? null;

/** 実測: 次のレベルに要る経験値。0→7、以降 2n+7 / 5n-38 / 9n-158（Java 版と同じ曲線） */
const xpNeeded = (level) => (level >= 31 ? 9 * level - 158 : level >= 16 ? 5 * level - 38 : 2 * level + 7);
/** いまのレベルまでに要った合計 ＋ いまのレベルで貯めたぶん */
const totalXp = (e) => {
  let t = e.xp ?? 0;
  for (let l = 0; l < (e.level ?? 0); l++) t += xpNeeded(l);
  return t;
};

function readBlock(dim, x, y, z) {
  return blocks.get(key(dim, x, y, z)) ?? makePerm(natural(dim, x, y, z));
}

/** 実測: 足元のブロックの上に立っているときだけ true（1 マス浮かせると false） */
const onGround = (e) => {
  if ($Math.abs(e.loc.y - $Math.floor(e.loc.y)) > 1e-6) return false;
  const b = readBlock(e.dim, $Math.floor(e.loc.x), e.loc.y - 1, $Math.floor(e.loc.z));
  return !/^minecraft:(air|water|lava|flowing_water|flowing_lava)$/.test(b.id);
};

// 光の計算は tick の終わりの世界で行う（実測: 置いた直後の空の明るさは古いまま）
const lightPrev = new $Map();
// ブロックが書き換わったときの口。カスタムコンポーネントの onPlace / onBlockStateChange は
// ここ 1 か所から出す（実機も「誰が置いたか」ではなく「置かれたこと」で呼ぶ）。
// features/custom-components.js が fn を入れる。世界の初期配置のときはまだ空なので何も起きない。
const blockChangeRef = {};
function writeBlock(dim, x, y, z, perm) {
  const k = key(dim, x, y, z);
  if (!lightPrev.has(k)) lightPrev.set(k, blocks.get(k));
  const before = blockChangeRef.fn ? readBlock(dim, x, y, z) : null;
  const nat = makePerm(natural(dim, x, y, z));
  if (perm.id === nat.id && $JSON.stringify(perm.states) === $JSON.stringify(nat.states)) blocks.delete(k);
  else blocks.set(k, { id: perm.id, states: { ...perm.states } });
  if (!before) return;
  const after = readBlock(dim, x, y, z);
  if (before.id !== after.id || $JSON.stringify(before.states) !== $JSON.stringify(after.states)) {
    blockChangeRef.fn(dim, { x, y, z }, before, after);
  }
}

// 区画の読み込み
const tickingAreas = (W.tickingAreas ?? []).map((a) => ({ dim: dimId(a.dimension ?? 'overworld'), from: a.from, to: a.to ?? a.from }));
function chunkLoaded(dim, x, z) {
  if (W.loadAll) return true;
  const cx = $Math.floor(x / 16);
  const cz = $Math.floor(z / 16);
  for (const e of entities.values()) {
    if (!e.player || !e.valid || e.dim !== dim) continue;
    const px = $Math.floor(e.loc.x / 16);
    const pz = $Math.floor(e.loc.z / 16);
    if ((px - cx) ** 2 + (pz - cz) ** 2 <= SIM * SIM) return true;
  }
  for (const a of tickingAreas) {
    if (a.dim !== dim) continue;
    const lx = $Math.floor($Math.min(a.from.x, a.to.x) / 16);
    const hx = $Math.floor($Math.max(a.from.x, a.to.x) / 16);
    const lz = $Math.floor($Math.min(a.from.z, a.to.z) / 16);
    const hz = $Math.floor($Math.max(a.from.z, a.to.z) / 16);
    if (cx >= lx && cx <= hx && cz >= lz && cz <= hz) return true;
  }
  return false;
}

// 実機の書式: (0.0, 400.0, 0.0)
const num1 = (n) => ($isInteger(n) ? `${n}.0` : $String(n));
const locText = (l) => `(${num1(l.x)}, ${num1(l.y)}, ${num1(l.z)})`;
const unloadedErr = (l) => fail('LocationInUnloadedChunkError', `Trying to access location ${locText(l)} which is not in a chunk currently loaded and ticking.`);
const outsideErr = (l) => fail('LocationOutOfWorldBoundariesError', `Trying to access location ${locText(l)} which is outside of the world boundaries.`);

/**
 * 位置を確かめる。実機（BDS 1.26.51 で実測）の順序:
 *   未読み込み → 高さの範囲外
 * 高さの範囲外は、読むとき（getBlock）は例外、書くとき（setBlockType）は何もせず戻る。
 *   unloaded: 'throw' | 'undefined'   outside: 'throw' | 'skip'
 */
function checkLoc(dim, loc, { unloaded = 'throw', outside = 'throw' } = {}) {
  const x = $Math.floor(loc.x);
  const y = $Math.floor(loc.y);
  const z = $Math.floor(loc.z);
  const d = DIMS[dim];
  if (!chunkLoaded(dim, x, z)) {
    if (unloaded === 'undefined') return null;
    throw unloadedErr(loc);
  }
  if (y < d.min || y >= d.max) {
    if (outside === 'skip') return null;
    throw outsideErr(loc);
  }
  return { x, y, z };
}

// エンティティ
const entities = new $Map();
let nextEntity = 1;
const ITEM_MAX = (id) => {
  const packMax = packComp('items', id, 'minecraft:max_stack_size');
  if (packMax !== undefined) return typeof packMax === 'object' ? packMax.value : packMax;
  if (M.items[id]?.max) return M.items[id].max;
  if (/(_sword|_pickaxe|_axe|_shovel|_hoe|_helmet|_chestplate|_leggings|_boots|^minecraft:bow$|^minecraft:crossbow$|^minecraft:trident$|^minecraft:shield$|^minecraft:elytra$|_boat$|^minecraft:saddle$|potion$|^minecraft:totem_of_undying$|^minecraft:mace$)/.test(id)) return 1;
  if (/(ender_pearl|snowball|^minecraft:egg$|_sign$|^minecraft:bucket$|banner$|^minecraft:honey_bottle$|^minecraft:armor_stand$)/.test(id)) return 16;
  return 64;
};
const itemId = (id) => {
  const full = fullId(id);
  // パックのブロックにもアイテムの姿がある（実測: give A <パックのブロック> が通る）
  return M.items[full] || VANILLA.items.includes(full) || PACK.items[full] || PACK.blocks?.[full] ? full : null;
};
const entityTypeId = (id) => {
  const full = fullId(id);
  if (full === 'minecraft:item') return full;
  return M.entities[full] || VANILLA.entities.includes(full) || PACK.entities[full] ? full : null;
};
/** 召喚できない種類（実測で is_summonable=false だったもの） */
const summonable = (id) => {
  if (id === 'minecraft:player') return false;
  const pack = packDef('entities', id);
  if (pack) return pack.summonable;   // 定義ファイルの is_summonable をそのまま使う
  return !/is not summonable/.test(M.entities[id]?.error ?? '');
};

/** パックのエンティティ定義に書いてある体力（minecraft:health）。{ value, max } で返す */
function packHealth(typeId) {
  const h = packComp('entities', typeId, 'minecraft:health');
  if (typeof h === 'number') return { value: h, max: h };
  if (!h || typeof h !== 'object') return null;
  const value = typeof h.value === 'number' ? h.value : undefined;
  const max = typeof h.max === 'number' ? h.max : value;
  return value === undefined ? null : { value, max };
}

function newEntity(o) {
  const id = $String(o.id ?? -(4294967295 - nextEntity++) );
  const e = {
    id,
    typeId: o.typeId,
    player: Boolean(o.player),
    name: o.name ?? '',
    nameTag: o.nameTag ?? (o.player ? (o.name ?? '') : ''),
    dim: dimId(o.dimension ?? 'overworld'),
    loc: { x: o.location?.x ?? 0.5, y: o.location?.y ?? -60, z: o.location?.z ?? 0.5 },
    rot: { x: o.rotation?.x ?? 0, y: o.rotation?.y ?? 0 },
    tags: new $Set(o.tags ?? []),
    valid: true,
    health: o.health ?? entityData(o.typeId)?.hp?.[0] ?? packHealth(o.typeId)?.value ?? 20,
    maxHealth: o.maxHealth ?? entityData(o.typeId)?.hp?.[1] ?? packHealth(o.typeId)?.max ?? 20,
    gameMode: o.gameMode ?? 'Survival',
    inventory: o.player ? new Array(36).fill(null) : (entityData(o.typeId)?.inv ? new Array(entityData(o.typeId).inv).fill(null) : null),
    selectedSlot: 0,
    dyn: new $Map($Object.entries(o.dynamicProperties ?? {})),   // (a restart: what the entity had saved)
    op: Boolean(o.op),
    joined: !o.player,
    vel: { x: 0, y: 0, z: 0 },
    rep: { x: 0, y: 0, z: 0 },
    fireTicks: 0,
    physNew: true,
  };
  if (o.inventory) {
    for (const [i, it] of o.inventory.entries()) {
      if (!it) continue;
      const tid = itemId(it.typeId ?? it.id ?? it);
      if (tid) e.inventory[i] = { typeId: tid, amount: it.amount ?? 1, nameTag: it.nameTag, lore: it.lore ?? [] };
    }
  }
  entities.set(id, e);
  return e;
}

// スコアボード
const objectives = new $Map(); // id → { id, displayName, criteria, scores: Map(identityId → n), valid }
const identities = new $Map(); // identityId → { id, type, name, entityId }
let nextIdentity = 1;
const displaySlots = {};
function identityFor(p) {
  if (typeof p === 'string') {
    for (const i of identities.values()) if (i.type === 'FakePlayer' && i.name === p) return i;
    const i = { id: nextIdentity++, type: 'FakePlayer', name: p, entityId: null };
    identities.set(i.id, i);
    return i;
  }
  if (p.entityId !== undefined && p.type) return p; // 内部表現
  for (const i of identities.values()) if (i.entityId === p.id) return i;
  // 実測: プレイヤー以外の参加者の表示名は、スコアボード上の番号そのもの
  const nid = nextIdentity++;
  const i = { id: nid, type: p.player ? 'Player' : 'Entity', name: p.player ? p.name : $String(nid), entityId: p.id };
  identities.set(i.id, i);
  return i;
}

// 世界の値
const G = {
  timeOfDay: W.timeOfDay ?? 0,
  absoluteTime: W.timeOfDay ?? 0,
  difficulty: W.difficulty ?? 'Normal',
  spawn: W.spawn ?? { x: 0, y: 32767, z: 0 }, // 実測: プレイヤーが決めるまで y は 32767
  dyn: new $Map($Object.entries(W.dynamicProperties ?? {})),   // (a restart: the world's saved properties carry over)
  gameRules: { ...(W.gameRules ?? {}) },
  moonPhase: 0,
};

// 最初の状態
for (const b of W.blocks ?? []) {
  const d = dimId(b.dimension ?? 'overworld');
  const id = blockTypeId(b.type ?? b.id);
  if (!d || !id) { log('warn', `初期ブロック ${fmt(b)} を置けません（ID か次元が不明）`); continue; }
  const from = b.at ?? b.from;
  const to = b.to ?? from;
  for (let x = $Math.min(from.x, to.x); x <= $Math.max(from.x, to.x); x++) {
    for (let y = $Math.min(from.y, to.y); y <= $Math.max(from.y, to.y); y++) {
      for (let z = $Math.min(from.z, to.z); z <= $Math.max(from.z, to.z); z++) writeBlock(d, x, y, z, makePerm(id, b.states));
    }
  }
}
for (const o of W.entities ?? []) {
  const t = entityTypeId(o.type ?? o.typeId);
  if (!t) { log('warn', `初期エンティティ ${fmt(o)} の種類が不明です`); continue; }
  newEntity({ ...o, typeId: t });
}
for (const o of W.scores ?? []) {
  let obj = objectives.get(o.objective);
  if (!obj) { obj = { id: o.objective, displayName: o.objective, criteria: 'dummy', scores: new $Map(), valid: true }; objectives.set(o.objective, obj); }
  if (o.participant !== undefined) obj.scores.set(identityFor($String(o.participant)).id, o.score ?? 0);
}
// a restart: the objectives as they were (display name, scores of fake players and of players, by the id they keep), the sidebar
for (const o of W.objectives ?? []) {
  const obj = objectives.get(o.id) ?? { id: o.id, displayName: o.displayName ?? o.id, criteria: 'dummy', scores: new $Map(), valid: true };
  objectives.set(o.id, obj);
  for (const sc of o.scores ?? []) {
    let i = [...identities.values()].find((x) => x.type === sc.type && x.name === sc.name && (sc.type === 'FakePlayer' || x.entityId === sc.entityId));
    if (!i) { i = { id: nextIdentity++, type: sc.type, name: sc.name, entityId: sc.type === 'FakePlayer' ? null : sc.entityId }; identities.set(i.id, i); }
    obj.scores.set(i.id, sc.score);
  }
}
for (const [slot, d] of $Object.entries(W.displaySlots ?? {})) if (objectives.get(d.objective)) displaySlots[slot] = { o: objectives.get(d.objective), sortOrder: d.sortOrder };
const pendingPlayers = [];
{
  const list = CFG.players ?? [{ name: 'Steve' }];
  for (let i = 0; i < list.length; i++) {
    // 実測: 参加したプレイヤーが先に id を取る（1 人目は -4294967295）
    pendingPlayers.push({ id: $String(-(4294967295 - i)), ...list[i], joinTick: list[i].joinTick ?? 0 });
  }
  if (list.length) nextEntity = $Math.max(nextEntity, list.length);
}

function snapshot() {
  const ents = {};
  for (const e of entities.values()) {
    if (!e.valid) continue;
    ents[e.id] = {
      typeId: e.typeId, name: e.player ? e.name : undefined, nameTag: e.nameTag || undefined,
      dimension: e.dim, location: { ...e.loc }, tags: [...e.tags].sort(),
      health: e.health, gameMode: e.player ? e.gameMode : undefined,
      inventory: e.inventory ? e.inventory.map((i) => (i ? `${i.typeId}×${i.amount}` : null)) : undefined,
    };
  }
  const scores = {};
  for (const o of objectives.values()) {
    if (!o.valid) continue;
    scores[o.id] = {};
    for (const [iid, v] of o.scores) {
      const i = identities.get(iid);
      scores[o.id][i.type === 'FakePlayer' ? i.name : `${i.type}:${i.name}`] = v;
    }
  }
  const b = {};
  for (const [k, v] of blocks) b[k] = v;
  return {
    blocks: b, entities: ents, scores,
    world: { timeOfDay: G.timeOfDay, difficulty: G.difficulty, weather: { ...$Object.fromEntries($Object.entries(DIMS).map(([k, d]) => [k, d.weather])) }, dynamicProperties: $Object.fromEntries(G.dyn) },
  };
}
const initial = snapshot();
