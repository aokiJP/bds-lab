// Speedrun (RTA) challenges beyond "get one item": sets of things, then something to do with them. Pure data (no client):
// goal-exec.cjs runs them (`rta <name>`, `challenge_<name>`, `quest_<verb>`), verbs-gen.cjs makes a verb of each.
//   CHALLENGES  name -> { ja, get: [[item, n]...], then: [[verb, ...args]...], kind?, arg? }
//     kind: 'depth' (dig down to y=arg), 'far' (get arg blocks away from the start), 'up' (pillar up to y=arg),
//           'random' (one item picked at random when it starts), 'portal' (build and light a portal, go through)
//   QUESTS      verb -> { ja, get: [[item, n]...], mobs: [...], blocks: [[x, y, z, block]...], args, cat }: any hand-written verb as
//               a race: from nothing, get what it needs (from its entry in data/everyday.json), find the animals it is done to, set
//               down the blocks it works on, then do it
'use strict';
const G = require('./goal.cjs');
const CAT = require('./data/everyday.json');

const KB = G.KB;
const has = (i) => !!KB.items[i] && G.routesOf(i).length > 0;
const stack = (i) => KB.items[i]?.[2] || 64;
const C = {};
const add = (name, spec) => { if (!C[name] && spec.get.every(([i]) => has(i))) C[name] = spec; };

// ---- hand-picked ----
const TOOLS = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'], ARMOR = ['helmet', 'chestplate', 'leggings', 'boots'];
const one = (list) => list.map((i) => [i, 1]);
add('wooden_tools', { ja: '木の道具 5 種', get: one(TOOLS.map((k) => `wooden_${k}`)) });
add('stone_tools', { ja: '石の道具 5 種', get: one(TOOLS.map((k) => `stone_${k}`)) });
add('iron_tools', { ja: '鉄の道具 5 種', get: one(TOOLS.map((k) => `iron_${k}`)) });
add('iron_armor', { ja: '鉄の防具一式を着る', get: one(ARMOR.map((k) => `iron_${k}`)), then: [['armor_up']] });
add('leather_armor', { ja: '革の防具一式を着る', get: one(ARMOR.map((k) => `leather_${k}`)), then: [['armor_up']] });
add('nether', { ja: 'ネザーに入る（黒曜石を集めてポータルを作る）', get: [['netherrack', 1]] });
add('eat_cake', { ja: 'ケーキを作って置いて食べる', get: [['cake', 1]], then: [['place_cake_eat']] });
add('bread_eat', { ja: 'パンを作って食べる', get: [['bread', 1]], then: [['eat_bread']] });
add('tame_wolf', { ja: 'オオカミを手なずける（骨から）', get: [['bone', 4]], then: [['tame_wolf', '12']] });
add('shield_up', { ja: '盾を作って構える', get: [['shield', 1]], then: [['shield']] });
add('bucket_water', { ja: '水入りバケツ', get: [['water_bucket', 1]] });
add('torches_16', { ja: '松明 16 本', get: [['torch', 16]] });
add('furnace_food', { ja: '焼いた肉', get: [['cooked_beef', 1]] });
add('full_iron', { ja: '鉄の道具と防具を全部（着る）', get: one([...TOOLS.map((k) => `iron_${k}`), ...ARMOR.map((k) => `iron_${k}`)]), then: [['armor_up']] });
add('full_diamond', { ja: 'ダイヤの道具と防具を全部（着る）', get: one([...TOOLS.map((k) => `diamond_${k}`), ...ARMOR.map((k) => `diamond_${k}`)]), then: [['armor_up']] });
add('kitchen', { ja: '台所: パン・ステーキ・焼き鳥・クッキー・パンプキンパイ', get: one(['bread', 'cooked_beef', 'cooked_chicken', 'cookie', 'pumpkin_pie']) });
add('farmer', { ja: '農家: 小麦 16・ニンジン 8・ジャガイモ 8', get: [['wheat', 16], ['carrot', 8], ['potato', 8]] });
add('miner', { ja: '鉱夫: 石炭 16・鉄 8・金 4・レッドストーン 8・ラピス 8・ダイヤ 1', get: [['coal', 16], ['iron_ingot', 8], ['gold_ingot', 4], ['redstone', 8], ['lapis_lazuli', 8], ['diamond', 1]] });
add('survivor', { ja: '一晩越す支度: ベッド・松明 16・ステーキ 8・盾・鉄の剣（盾を構える）', get: [['bed', 1], ['torch', 16], ['cooked_beef', 8], ['shield', 1], ['iron_sword', 1]], then: [['shield']] });
add('monster_hunter', { ja: '夜の敵の落とし物: 腐った肉・骨・糸・火薬', get: [['rotten_flesh', 2], ['bone', 2], ['string', 2], ['gunpowder', 1]] });
add('redstone_starter', { ja: 'レッドストーン入門: ピストン・レッドストーントーチ・レバー・リピーター・ホッパー', get: one(['piston', 'redstone_torch', 'lever', 'repeater', 'hopper']) });
add('enchanter', { ja: 'エンチャントテーブルと本棚 4', get: [['enchanting_table', 1], ['bookshelf', 4]] });
add('eyes', { ja: 'エンダーアイ 1（ネザーでブレイズ、エンダーマン）', get: [['ender_eye', 1]] });
add('portal', { ja: 'ネザーポータルを作って火をつけてくぐる', get: [['obsidian', 10], ['flint_and_steel', 1]], kind: 'portal' });
add('random', { ja: 'ランダムな 1 品（始まったときに決まる）のRTA', get: [], kind: 'random' });
for (const m of ['wooden', 'stone', 'iron', 'golden', 'diamond', 'copper']) add(`tools_${m}`, { ja: `${m} の道具 5 種`, get: one(TOOLS.map((k) => `${m}_${k}`)) });
for (const m of ['leather', 'iron', 'golden', 'diamond', 'copper']) add(`armor_${m}`, { ja: `${m} の防具一式を着る`, get: one(ARMOR.map((k) => `${m}_${k}`)), then: [['armor_up']] });

// ---- collect every one of a kind (up to 24) ----
const ITEMS = Object.keys(KB.items);
const SETS = { saplings: /_sapling$/, logs: /^(?!stripped_)\w+_log$/, dyes: /_dye$/, concrete: /_concrete$/, concrete_powder: /_concrete_powder$/, wool: /_wool$/, carpets: /_carpet$/,
  stained_glass: /_stained_glass$/, stained_glass_panes: /_stained_glass_pane$/, candles: /_candle$/, glazed_terracotta: /_glazed_terracotta$/, boats: /_boat$/, doors: /_door$/, fences: /_fence$/,
  fence_gates: /_fence_gate$/, buttons: /_button$/, pressure_plates: /_pressure_plate$/, signs: /(?<!hanging)_sign$/, trapdoors: /_trapdoor$/, planks: /_planks$/, leaves: /_leaves$/, seeds: /_seeds$/,
  tulips: /_tulip$/, cooked: /^cooked_/, raw_metals: /^raw_(iron|gold|copper)$/, ingots: /^(iron|gold|copper)_ingot$/, swords: /_sword$/, pickaxes: /_pickaxe$/, helmets: /_helmet$/, horse_armor: /_horse_armor$/ };
for (const [k, re] of Object.entries(SETS)) {
  const m = ITEMS.filter((i) => re.test(i) && has(i)).sort();
  if (m.length >= 2 && m.length <= 24) add(`all_${k}`, { ja: `${k} を全種類（${m.length}）`, get: one(m) });
}
for (const t of ['is_meat', 'is_fish', 'stone_bricks', 'wooden_slabs', 'coals', 'mushrooms_for_stew']) {
  const m = G.TAG(t).filter(has);
  if (m.length >= 2 && m.length <= 24) add(`all_${t.replace(/^is_/, '')}`, { ja: `#${t} を全種類（${m.length}）`, get: one(m) });
}
// ---- a full stack ----
for (const i of ['cobblestone', 'dirt', 'oak_log', 'oak_planks', 'stick', 'torch', 'coal', 'iron_ingot', 'sand', 'gravel', 'glass', 'wheat', 'sugar_cane', 'bone', 'string', 'redstone', 'copper_ingot', 'charcoal', 'ladder', 'bread', 'stone', 'smooth_stone', 'bricks', 'paper'])
  if (has(i) && stack(i) === 64) add(`stack_${i}`, { ja: `${G.ja(i)} を 1 スタック（64）`, get: [[i, 64]] });
// ---- places: down, up, away ----
// a stair wears out a stone pickaxe in about 40 steps down: deeper ones take spares, and sticks and the table to make more with the
// cobblestone the stair gives
for (const [n, y] of [['sea_level', 62], ['y32', 32], ['y0', 0], ['deepslate', -8], ['diamond_level', -58]]) {
  const picks = y >= 32 ? 1 : y >= -8 ? 2 : 3;
  add(`depth_${n}`, { ja: `y=${y} まで掘って下りる`, get: [['stone_pickaxe', picks], ...(y < 32 ? [['stick', 4], ['crafting_table', 1]] : [])], kind: 'depth', arg: y });
}
for (const y of [100, 150, 200, 319]) add(`sky_${y}`, { ja: `y=${y} まで足元に積んで登る`, get: [], kind: 'up', arg: y });
for (const d of [100, 250, 500, 1000]) add(`walk_${d}`, { ja: `スタートから ${d} ブロック離れる`, get: [], kind: 'far', arg: d });
// ---- bingo cards: 5 easy things each, the same card for everyone (numbered) ----
const EASY = ['crafting_table', 'stick', 'torch', 'furnace', 'chest', 'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'white_wool', 'bed', 'ladder', 'oak_boat', 'bowl', 'wooden_pickaxe',
  'stone_pickaxe', 'stone_sword', 'stone_axe', 'iron_ingot', 'iron_pickaxe', 'bucket', 'water_bucket', 'milk_bucket', 'shears', 'flint', 'flint_and_steel', 'arrow', 'bow', 'fishing_rod', 'string', 'bone', 'bone_meal',
  'white_dye', 'red_dye', 'yellow_dye', 'paper', 'sugar', 'book', 'glass', 'glass_bottle', 'charcoal', 'coal', 'campfire', 'smoker', 'barrel', 'composter', 'lever', 'oak_door', 'oak_fence', 'oak_sign', 'painting',
  'item_frame', 'leather', 'feather', 'egg', 'apple', 'wheat_seeds', 'sweet_berries', 'shield', 'iron_sword', 'compass', 'clock', 'rail', 'minecart', 'hopper', 'cauldron', 'anvil', 'lantern', 'chain', 'copper_ingot'].filter(has);
let seed = 20260926;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let b = 1; b <= 30; b++) {
  const pick = new Set(); while (pick.size < 5) pick.add(EASY[Math.floor(rnd() * EASY.length)]);
  add(`bingo_${b}`, { ja: `ビンゴ ${b}: ${[...pick].map(G.ja).join('・')}`, get: one([...pick]) });
}

// ---- quests: every hand-written verb whose needs can be had in the wild ----
const WORLD_CATS = new Set(['animal', 'food', 'build', 'farm', 'life', 'hand', 'place', 'craft', 'furnace', 'brew', 'combat', 'mob', 'deco', 'fluid', 'redstone', 'vehicle', 'block', 'click', 'mine', 'open', 'errand', 'move']);
const wildMob = (m) => !!G.MOBS[m] && (G.MOB_DIM[m] ?? 'overworld') === 'overworld';
const baseBlock = (s) => String(s).replace(/\[.*$/, '');
const placeOf = (b) => { const it = KB.blocks[b]?.[2]; return it && has(it) ? it : has(b) ? b : null; };
// how many of each thing a verb uses up, from what it is and its sample arguments (the catalog's test gifts are generous: 16 of
// everything). make_<x>: the ingredients of one craft of x. Building: the blocks its shape takes. Else one each (two for breeding)
const argsBy = (use, args) => { const names = String(use ?? '').split(/\s+/).slice(1).map((t) => t.replace(/[[\]<>]/g, '')).filter(Boolean); const o = {}; (args ?? []).forEach((a, i) => { o[names[i] ?? i] = a; }); return o; };
const num = (x, d) => (Number.isFinite(Number(x)) && x !== '' && x !== undefined ? Number(x) : d);
const span = (a, b) => Math.abs(num(a, 0) - num(b, 0)) + 1;
const SHAPES = {   // blocks of the main (first) item a building verb takes, from its arguments
  place: () => 1, hang: () => 1, sneak_place: () => 1, replace_block: () => 1, bunker: () => 30, hut: () => 80,
  pillar: (o) => num(o.n, 5), column: (o) => num(o.h, 3), ladder_column: (o) => num(o.h, 3), scaffold_tower: (o) => num(o.h, 3),
  fill: (o) => span(o.x1, o.x2) * span(o.y1, o.y2) * span(o.z1, o.z2), replace: (o) => span(o.x1, o.x2) * span(o.y1, o.y2) * span(o.z1, o.z2),
  box: (o) => { const a = span(o.x1, o.x2), b = span(o.y1, o.y2), c = span(o.z1, o.z2); return 2 * (a * b + b * c + a * c); },
  floor: (o) => span(o.x1, o.x2) * span(o.z1, o.z2), roof: (o) => span(o.x1, o.x2) * span(o.z1, o.z2), level: (o) => span(o.x1, o.x2) * span(o.z1, o.z2),
  checker: (o) => Math.ceil((span(o.x1, o.x2) * span(o.z1, o.z2)) / 2),
  wall: (o) => Math.max(span(o.x1, o.x2), span(o.z1, o.z2)) * num(o.h, 3), room: (o) => 2 * (span(o.x1, o.x2) + span(o.z1, o.z2)) * num(o.h, 3),
  line: (o) => Math.max(span(o.x1, o.x2), span(o.z1, o.z2)), rail_line: (o) => Math.max(span(o.x1, o.x2), span(o.z1, o.z2)), redstone_line: (o) => Math.max(span(o.x1, o.x2), span(o.z1, o.z2)),
  fence_pen: (o) => 2 * (span(o.x1, o.x2) + span(o.z1, o.z2)), stairs_line: (o) => num(o.n, 2), tower: (o) => 8 * num(o.h, 3),
  disk: (o) => Math.ceil(Math.PI * (num(o.r, 1) + 0.5) ** 2), ring: (o) => Math.ceil(2 * Math.PI * num(o.r, 2)) + 4,
  pyramid: (o) => { let n = 0; for (let b = num(o.base, 3); b > 0; b -= 2) n += b * b; return n; },
  light_up: (o) => (Math.floor(span(o.x1, o.x2) / num(o.step, 6)) + 1) * (Math.floor(span(o.z1, o.z2) / num(o.step, 6)) + 1),
  lamp_post: () => 3,
};
const FIXED = { build_iron_golem: { iron_block: 4, carved_pumpkin: 1 }, build_snow_golem: { snow: 2, carved_pumpkin: 1 }, build_copper_golem: { copper_block: 1, carved_pumpkin: 1 },
  nether_portal: { obsidian: 10, flint_and_steel: 1 }, beacon_base: { iron_block: 9, beacon: 1 }, fence_pen: { fence_gate: 1 }, lamp_post: { lantern: 1 } };
let COSTS = null;   // seconds to get each item from nothing, as the planner reckons them (worked out once, when first needed)
const unitCost = (it) => { COSTS ??= G.makeCosts({ inventory: new Map(), stations: new Set(), near: () => null, mob: () => null, drop: () => null, dim: 'overworld', y: 64, have: () => 0, tool: () => false, container: () => null, banned: new Set() }); const c = COSTS.unit(it); return Number.isFinite(c) ? c : 1e6; };
const tagPick = (g) => { if (!g.startsWith('#')) return g; const m = G.TAG(g.slice(1)).filter(has); return m.find((x) => /^oak_/.test(x)) ?? m.find((x) => x === g.slice(1)) ?? m.filter((x) => !/(crimson|warped|bamboo|mangrove|cherry|pale_oak)/.test(x)).sort((a, b) => a.length - b.length)[0] ?? m[0] ?? null; };   // oak, else the plainest (shortest) name: coal before charcoal
function recipeNeeds(item) {   // one craft's ingredients (tags as their commonest member), the plainest recipe first
  const rs = G.routesOf(item).filter((r) => r.kind === 'craft').map((r) => r.ings.map(([g, k]) => [tagPick(g), k])).filter((ings) => ings.every(([g]) => g && has(g)));
  const cost = (ings) => ings.reduce((a, [g, k]) => a + k * unitCost(g), 0);   // the cheapest from nothing (coal before charcoal ...)
  rs.sort((a, b) => cost(a) - cost(b));
  return rs[0] ?? null;
}
function needsOf(v, e, items) {
  const m = /^make_(\w+)$/.exec(v);
  if (m) {   // make_<x> crafts x once: its ingredients (and the table, which the verb sets down)
    const it = [m[1], m[1].replace(/s$/, ''), m[1].replace(/es$/, '')].find((x) => KB.items[x] && G.routesOf(x).some((r) => r.kind === 'craft'));
    const ings = it && recipeNeeds(it);
    if (ings) return [...ings.map(([g, k]) => [g, k]), ...(items.includes('crafting_table') ? [['crafting_table', 1]] : [])];
  }
  const fixed = FIXED[v] ?? {}, shape = SHAPES[v], o = argsBy(e.use, e.args);
  return items.map((it, i) => [it, Math.min(256, Math.max(1, fixed[it] ?? (i === 0 && shape ? shape(o) : /^(breed|feed)/.test(v) ? 2 : 1)))]);
}
const Q = {};
for (const [v, e] of Object.entries(CAT.verbs)) {
  if (!WORLD_CATS.has(e.cat) || /^(get|plan|rta|recipes_all)$/.test(v)) continue;
  const setup = e.real?.setup ?? [];
  if (setup.some((s) => !/^(js .*player\.(hunger|saturation)|wait \d+)/.test(s))) continue;   // needs the world set up by commands (night, weather, effects ...)
  const items = (e.items ?? []).map(baseBlock);
  if (!items.every(has)) continue;
  const mobs = e.mobs ?? [];
  if (!mobs.every(wildMob)) continue;
  const blocks = Object.entries(e.blocks ?? {}).map(([p, b]) => [...p.split(' ').map(Number), baseBlock(b)]);
  if (!blocks.every((b) => placeOf(b[3]))) continue;
  if (!items.length && !mobs.length && !blocks.length) continue;   // nothing to get ready: not a race
  const get = needsOf(v, e, [...new Set(items)]);
  if (!get) continue;
  for (const b of blocks) { const it = placeOf(b[3]); const g = get.find(([i]) => i === it); if (g) g[1]++; else get.push([it, 1]); }
  Q[v] = { ja: `${e.ja}（持ち物ゼロから、要る物を集めて）`, get, mobs, blocks, args: e.args ?? [], use: e.use, cat: e.cat };
}

// a catalog entry's sample arguments for the flat test world (player at 0 -60 0, ground -61) turned into the same place around
// base (the cell the player stands in): x.. and z.. are offsets, y.. is height over the feet
function mapArgs(use, args, base) {
  const names = String(use ?? '').split(/\s+/).slice(1).map((t) => t.replace(/[[\]<>]/g, '')).filter(Boolean);
  return (args ?? []).map((v, i) => {
    const n = names[i] ?? '', x = Number(v);
    if (!/^-?\d+$/.test(String(v))) return String(v);
    if (/^x\d?$/.test(n)) return String(base.x + x);
    if (/^z\d?$/.test(n)) return String(base.z + x);
    if (/^y\d?$/.test(n)) return String(base.y + (x + 60));
    return String(v);
  });
}
module.exports = { CHALLENGES: C, QUESTS: Q, EASY, placeOf, mapArgs };
