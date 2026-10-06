// The goal planner: get any item from what the world offers, the way a speedrunner does it, and challenges (RTA) built on it.
// Knowledge is BDS's own (common/data/kb.json, from common/kb-build.mjs): recipes, smelting, what each block drops to which tool,
// what each mob drops. A plan is a list of the steps a person takes (mine with the right tool, craft at a table, smelt in a furnace,
// kill, milk, shear, fish, pick up); goal-exec.cjs carries them out with realplayer.cjs's measured primitives only.
// This file is pure (no client): the offline test and `plan` use it as it is.
'use strict';
const KB = require('./data/kb.json');

const sid = (x) => String(x ?? '').replace(/^minecraft:/, '');
const TIER = { wooden: 1, golden: 1, stone: 2, copper: 2, iron: 3, diamond: 4, netherite: 5 };
// a drop column of kb.blocks (the tool the loot was simulated with) -> what a person must hold for it
function toolReq(key) {
  if (!key || key === 'hand') return null;
  if (key === 'shears') return { kind: 'shears', tier: 0 };
  const m = /^(\w+?)_(pickaxe|axe|shovel|hoe|sword)$/.exec(key);
  return m ? { kind: m[2], tier: m[2] === 'pickaxe' ? TIER[m[1]] ?? 1 : 1 } : null;
}
// does item `it` do the job of requirement `req`
function fits(it, req) {
  if (!req) return true;
  if (req.kind === 'shears') return it === 'shears';
  const m = /^(\w+?)_(pickaxe|axe|shovel|hoe|sword)$/.exec(it);
  return !!m && m[2] === req.kind && (TIER[m[1]] ?? 0) >= req.tier;
}
const TOOLS_MEMO = new Map();   // (lookups below are memoized: the planner asks the same questions thousands of times)
const TOOLS_FOR = (req) => { const k = req.kind + req.tier; let v = TOOLS_MEMO.get(k); if (!v) { v = req.kind === 'shears' ? ['shears'] : Object.keys(TIER).filter((t) => TIER[t] >= req.tier).map((t) => `${t}_${req.kind}`).filter((x) => KB.items[x]); TOOLS_MEMO.set(k, v); } return v; };
const reqName = (req) => (!req ? 'hand' : req.kind === 'shears' ? 'shears' : req.kind === 'pickaxe' ? `${Object.keys(TIER).find((t) => TIER[t] === req.tier)}+ pickaxe` : `any ${req.kind}`);

// ---- where things are found: how long a person searches for one that is not in sight (seconds), and where ----
// [block regex, seconds, dimension, the depth to dig to (ores: the y where they are most common), how far round that depth it is
// just as common (coal: all through the stone above y=0)]
const WILD = [
  [/^(oak|birch|spruce|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|poplar)_log$/, 45], [/^(oak|birch|spruce|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(wood)$/, 3000], [/_leaves$/, 45], [/^(short_grass|tall_grass|fern|large_fern)$/, 20],
  [/^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt)$/, 5], [/^(stone|andesite|diorite|granite|tuff)$/, 20, 'overworld', 50], [/^deepslate$/, 90, 'overworld', -8],
  [/^(sand)$/, 120], [/^red_sand$/, 900], [/^gravel$/, 90], [/^clay$/, 200], [/^reeds$/, 150], [/^(water)$/, 40], [/^(lava)$/, 300], [/^(snow|snow_layer|ice|packed_ice|powder_snow)$/, 900],
  [/^coal_ore$/, 90, 'overworld', 48, 48], [/^deepslate_coal_ore$/, 600, 'overworld', -4], [/^iron_ore$/, 200, 'overworld', 16], [/^deepslate_iron_ore$/, 300, 'overworld', -8],
  [/^copper_ore$/, 200, 'overworld', 48], [/^deepslate_copper_ore$/, 500, 'overworld', -8], [/^(deepslate_)?gold_ore$/, 500, 'overworld', -16], [/^(deepslate_)?redstone_ore$/, 450, 'overworld', -58],
  [/^(deepslate_)?lapis_ore$/, 500, 'overworld', 0], [/^(deepslate_)?diamond_ore$/, 900, 'overworld', -58], [/^(deepslate_)?emerald_ore$/, 2400, 'overworld', 100],
  [/^(pumpkin)$/, 400], [/^melon_block$/, 700], [/^(dandelion|poppy|azure_bluet|oxeye_daisy|cornflower|red_tulip|orange_tulip|white_tulip|pink_tulip|allium|blue_orchid|lily_of_the_valley|sunflower|lilac|rose_bush|peony)$/, 90],
  [/^(brown|red)_mushroom$/, 300], [/^cactus$/, 600], [/^sweet_berry_bush$/, 500], [/^bamboo$/, 1200], [/^cocoa$/, 1200], [/^(kelp|seagrass|sea_pickle)$/, 300], [/^obsidian$/, 1200],
  [/^(wheat|carrots|potatoes|beetroot|hay_block)$/, 600], [/^(bee_nest)$/, 900], [/^web$/, 900], [/^(vine|glow_lichen|moss_block|azalea|flowering_azalea|dripstone_block|pointed_dripstone)$/, 600],
  [/^(amethyst_block|budding_amethyst|amethyst_cluster|calcite|smooth_basalt)$/, 900, 'overworld', 20], [/^(sculk|sculk_vein|sculk_sensor|sculk_catalyst|sculk_shrieker)$/, 1500, 'overworld', -50],
  [/^(cave_vines_body_with_berries|cave_vines_head_with_berries|spore_blossom|moss_carpet|big_dripleaf|small_dripleaf_block)$/, 900, 'overworld', 20], [/^(mud|mangrove_roots|muddy_mangrove_roots)$/, 1200],
  [/^(packed_ice|blue_ice)$/, 1500], [/^(\w+_terracotta|hardened_clay|red_sandstone)$/, 1500], [/^(sandstone)$/, 150], [/^(\w+_coral(_block|_fan)?)$/, 1500], [/^waterlily$/, 600],
  [/^(pale_moss_block|pale_hanging_moss|pale_moss_carpet|creaking_heart)$/, 1800], [/^(red_mushroom_block|brown_mushroom_block|mushroom_stem)$/, 1500], [/^(deadbush|cactus_flower)$/, 400],
  [/^(bamboo)$/, 1200], [/^(melon_stem|pumpkin_stem)$/, 1500], [/^(mossy_cobblestone|mossy_stone_bricks|cobweb)$/, 1200], [/^(suspicious_sand|suspicious_gravel)$/, 2400],
  [/^(netherrack|nether_gold_ore|quartz_ore|glowstone|soul_sand|soul_soil|basalt|blackstone|magma|crimson_stem|warped_stem|nether_wart|shroomlight|crimson_nylium|warped_nylium|gravel_nether)$/, 120, 'nether'],
  [/^ancient_debris$/, 1500, 'nether', 15], [/^(end_stone|chorus_plant|chorus_flower)$/, 120, 'the_end'],
];
const MOBS = {   // seconds to find one, and where
  cow: 60, pig: 60, sheep: 60, chicken: 60, rabbit: 200, horse: 300, donkey: 400, llama: 500, goat: 600, mooshroom: 3600, fox: 400, wolf: 300, bee: 600, turtle: 900, cod: 120, salmon: 200, squid: 120,
  glow_squid: 400, tropicalfish: 400, pufferfish: 400, dolphin: 400, polar_bear: 1200, panda: 1800, parrot: 1200, cat: 900, ocelot: 1200, frog: 900, axolotl: 1500, armadillo: 900, camel: 1200,
  zombie: 150, skeleton: 150, spider: 150, creeper: 150, enderman: 400, slime: 900, witch: 900, drowned: 400, husk: 900, stray: 900, cave_spider: 900, phantom: 1500, silverfish: 1200,
  blaze: 900, ghast: 600, wither_skeleton: 1200, zombie_pigman: 200, piglin: 300, magma_cube: 600, hoglin: 600, strider: 400, enderman_nether: 900, shulker: 1800, endermite: 3000,
};
const MOB_DIM = { blaze: 'nether', ghast: 'nether', wither_skeleton: 'nether', zombie_pigman: 'nether', piglin: 'nether', piglin_brute: 'nether', magma_cube: 'nether', hoglin: 'nether', strider: 'nether', shulker: 'the_end', ender_dragon: 'the_end' };
const WILD_MEMO = new Map();
const wild = (block) => { let w = WILD_MEMO.get(block); if (w === undefined) { w = WILD.find(([r]) => r.test(block)) ?? null; WILD_MEMO.set(block, w); } return w ?? undefined; };
const TOO_STRONG = /^(iron_golem|warden|ravager|polar_bear|elder_guardian|ender_dragon|wither)$/;
const PEACEFUL = /^(cow|pig|sheep|chicken|rabbit|horse|donkey|mule|llama|goat|mooshroom|cod|salmon|squid|glow_squid|tropicalfish|pufferfish|turtle|bat|fox|frog|armadillo|camel|panda|polar_bear|sniffer|strider)$/;

// ---- the recipe graph, indexed once ----
const MINE = new Map(), KILL = new Map();
for (const [b, row] of Object.entries(KB.blocks)) {
  const drops = row[4] ?? {};
  const best = new Map();   // item -> the least requirement that gets it from this block
  const order = (k) => (k === 'hand' ? 0 : /pickaxe/.test(k) ? TIER[k.split('_')[0]] ?? 5 : k === 'shears' ? 2 : 1.5);
  for (const [tool, d] of Object.entries(drops)) for (const [it, [lo, hi, share]] of Object.entries(d)) {
    if (!KB.items[it]) continue;
    const per = ((lo + hi) / 2) * share, cur = best.get(it);
    if (per > 0 && (!cur || order(tool) < order(cur.tool) || (order(tool) === order(cur.tool) && per > cur.per))) best.set(it, { block: b, tool, req: toolReq(tool), per });
  }
  for (const [it, r] of best) (MINE.get(it) ?? MINE.set(it, []).get(it)).push(r);
}
for (const [m, row] of Object.entries(KB.mobs)) for (const [it, [lo, hi, ch]] of Object.entries(row[2] ?? {})) {
  const per = ((lo + hi) / 2) * ch;
  if (per >= 0.05 && KB.items[it] && !/^(egg|saddle|music_disc_|record_)/.test(it)) (KILL.get(it) ?? KILL.set(it, []).get(it)).push({ mob: m, per });   // not the one-in-a-hundred drops (a zombie's iron)
}
const TAG_MEMO = new Map();
const TAG = (t) => TAG_MEMO.get(t) ?? TAG_MEMO.set(t, (KB.tags[t] ?? []).filter((x) => KB.items[x])).get(t);
// what else is got by doing something to a mob or a block (not a drop, not a recipe)
const SPECIAL = {
  milk_bucket: [{ kind: 'milk', mobs: ['cow', 'mooshroom', 'goat'], use: 'bucket' }],
  water_bucket: [{ kind: 'scoop', block: 'water', use: 'bucket' }],
  lava_bucket: [{ kind: 'scoop', block: 'lava', use: 'bucket' }],
  powder_snow_bucket: [{ kind: 'scoop', block: 'powder_snow', use: 'bucket' }],
  egg: [{ kind: 'eggs', mobs: ['chicken'] }],
  white_wool: [{ kind: 'shear', mobs: ['sheep'], use: 'shears', per: 2 }],
  cod: [{ kind: 'fish', per: 0.6, use: 'fishing_rod' }], salmon: [{ kind: 'fish', per: 0.25, use: 'fishing_rod' }],
  glass_bottle: [], potion: [{ kind: 'bottle', block: 'water', use: 'glass_bottle' }],
  mushroom_stew: [{ kind: 'milk', mobs: ['mooshroom'], use: 'bowl' }],
  bone_meal: [{ kind: 'compost', per: 0.2 }],
};
// crops a person grows from what they carry: item -> [what is planted, the crop block, how many one plant gives]
const FARM = { wheat: ['wheat_seeds', 'wheat', 1], carrot: ['carrot', 'carrots', 2], potato: ['potato', 'potatoes', 2], beetroot: ['beetroot_seeds', 'beetroot', 1] };
const CRAFT_OK = /^(crafting_table|stonecutter)$/;   // stations the planner uses (the smithing table and the rest: their own verbs)

// the ways to get one item, with what each needs (no costs yet)
function routesOf(it) {
  const out = [];
  for (const r of KB.craft[it] ?? []) {
    const [count, station, w, h, ings] = r;
    if (!CRAFT_OK.test(station)) continue;
    const total = ings.reduce((a, [, k]) => a + k, 0);
    out.push({ kind: 'craft', item: it, count, station, big: station === 'crafting_table' && (w > 2 || h > 2 || (w === 0 && total > 4)), ings });
  }
  // (not melting tools and armor back into nuggets: a person keeps the pickaxe they need)
  for (const [input, ...st] of KB.smelt[it] ?? []) if (st.includes('furnace') && !/_(pickaxe|axe|shovel|hoe|sword|spear|helmet|chestplate|leggings|boots|horse_armor|nautilus_armor)$/.test(input)) out.push({ kind: 'smelt', item: it, input, count: 1 });
  for (const m of MINE.get(it) ?? []) out.push({ kind: 'mine', item: it, block: m.block, tool: m.tool, req: m.req, per: m.per });
  for (const k of KILL.get(it) ?? []) out.push({ kind: 'kill', item: it, mob: k.mob, per: k.per });
  for (const s of SPECIAL[it] ?? []) out.push({ ...s, item: it, per: s.per ?? 1 });
  const fm = FARM[it];   // grow it: till by water, plant, wait (bone meal speeds it up)
  if (fm) out.push({ kind: 'farm', item: it, seed: fm[0], crop: fm[1], per: fm[2], req: { kind: 'hoe', tier: 1 } });
  const st = /^stripped_(\w+?)_(log|wood|stem|hyphae)$/.exec(it);   // an axe on the log (or wood) takes the bark off
  if (st && KB.items[`${st[1]}_${st[2]}`]) out.push({ kind: 'strip', item: it, input: `${st[1]}_${st[2]}`, per: 1, req: { kind: 'axe', tier: 1 } });
  if (/_concrete$/.test(it) && KB.items[it + '_powder']) out.push({ kind: 'harden', item: it, input: it + '_powder', per: 1, req: { kind: 'pickaxe', tier: 1 } });   // powder set down in water
  if (KB.fish[it] && !SPECIAL[it]) out.push({ kind: 'fish', item: it, per: KB.fish[it], use: 'fishing_rod' });
  // chests of villages, ruins and the like hold it sometimes: worth a look when one is in sight
  if ((KB.chests[it] ?? []).some((c) => /^(village|spawn_bonus|abandoned_mineshaft|simple_dungeon|shipwreck|ruined_portal|igloo|pillager_outpost|desert_pyramid|jungle_temple|buried_treasure|underwater_ruin)/.test(c))) out.push({ kind: 'loot', item: it, per: 0.25 });
  return out;
}

// ---- costs: seconds a person needs, given what is carried and what is in sight (env) ----
// env: { have(item) -> count, near(block) -> distance | null (seen), mob(type) -> distance | null, drop(item) -> distance | null,
//        stations: Set of placed stations in reach ('crafting_table', 'furnace'), dim: 'overworld' | 'nether' | 'the_end', y }
const DIG_MEMO = new Map();
const DIG = (block, tool) => { const k = tool ? block + '|t' : block; let v = DIG_MEMO.get(k); if (v === undefined) { v = dig0(block, tool); DIG_MEMO.set(k, v); } return v; };
const dig0 = (block, tool) => {   // seconds to break one with the best of what is carried (rough)
  if (/_leaves$|^web$/.test(block)) return 0.4;
  if (/log$|wood$|planks|stem$|_block$/.test(block) && !/stone|ore|iron|gold|diamond/.test(block)) return tool ? 1.3 : 3;
  if (/dirt|grass|sand|gravel|clay|snow|farmland|mud/.test(block)) return 0.7;
  if (/obsidian/.test(block)) return 9.5;
  if (/deepslate/.test(block)) return 2;
  return 1.2;
};
const ALL_ROUTES = new Map();   // item -> its routes (computed once)
const routes = (it) => ALL_ROUTES.get(it) ?? ALL_ROUTES.set(it, routesOf(it)).get(it);
const RELEVANT = [...new Set([...Object.keys(KB.items), ...Object.keys(KB.craft), ...Object.keys(KB.smelt)])];
// everything a goal could depend on (ingredients, tag members, tools, stations, fuels, buckets ...): costs are worked out over this
// set only, so a plan takes milliseconds
const DEPS = new Map();
function closure(goal) {
  if (DEPS.has(goal)) return DEPS.get(goal);
  const seen = new Set(), q = [goal];
  const push = (x) => { if (!x) return; if (x.startsWith('#')) { for (const m of TAG(x.slice(1))) push(m); return; } if (!seen.has(x)) { seen.add(x); q.push(x); } };
  seen.add(goal);
  while (q.length) {
    const it = q.pop();
    for (const r of routes(it)) {
      if (r.kind === 'craft') { for (const [g] of r.ings) push(g); if (r.big) push('crafting_table'); if (r.station === 'stonecutter') push('stonecutter_block'); }
      if (r.kind === 'smelt') { push(r.input); push('furnace'); push('coal'); push('charcoal'); push('#planks'); push('#logs'); }
      if ((r.kind === 'mine' || r.kind === 'strip' || r.kind === 'harden') && r.req) for (const t of TOOLS_FOR(r.req)) push(t);
      if ((r.kind === 'mine' && (wild(r.block)?.[2] ?? 'overworld') === 'nether') || (r.kind === 'kill' && MOB_DIM[r.mob] === 'nether')) { push('obsidian'); push('flint_and_steel'); }
      if (r.kind === 'strip' || r.kind === 'harden') push(r.input);
      if (r.kind === 'farm') { push(r.seed); for (const t of TOOLS_FOR(r.req)) push(t); }
      if (r.use) push(r.use);
    }
  }
  const out = [...seen];
  DEPS.set(goal, out);
  return out;
}
// the dependency graph of a closure, compiled once: item index, and for each item the items whose cost depends on it
const GRAPHS = new WeakMap();
const FUEL = ['coal', 'charcoal'];
function depsOf(it) {
  const d = new Set(), add = (x) => { if (!x) return; if (x.startsWith('#')) { for (const m of TAG(x.slice(1))) d.add(m); } else d.add(x); };
  for (const r of routes(it)) {
    if (r.kind === 'craft') { for (const [g] of r.ings) add(g); if (r.big) add('crafting_table'); if (r.station === 'stonecutter') add('stonecutter_block'); }
    if (r.kind === 'smelt') { add(r.input); add('furnace'); FUEL.forEach(add); add('#planks'); add('#logs'); }
    if (r.req) for (const t of TOOLS_FOR(r.req)) add(t);
    if ((r.kind === 'mine' && (wild(r.block)?.[2] ?? 'overworld') === 'nether') || (r.kind === 'kill' && MOB_DIM[r.mob] === 'nether')) { add('obsidian'); add('flint_and_steel'); }
    if (r.kind === 'strip' || r.kind === 'harden') add(r.input);
    if (r.kind === 'farm') add(r.seed);
    if (r.use) add(r.use);
  }
  return d;
}
function graph(list) {
  let g = GRAPHS.get(list);
  if (g) return g;
  const index = new Map(list.map((x, i) => [x, i])), rdeps = list.map(() => []);
  list.forEach((it, i) => { for (const d of depsOf(it)) { const j = index.get(d); if (j !== undefined && j !== i) rdeps[j].push(i); } });
  g = { list, index, rdeps, routes: list.map((it) => routes(it)) };
  GRAPHS.set(list, g);
  return g;
}
const RELEVANT_LIST = RELEVANT;
function makeCosts(env, only) {
  const dim = env.dim ?? 'overworld';
  const G0 = graph(only ?? RELEVANT_LIST), n = G0.list.length, cost = new Float64Array(n).fill(Infinity);
  const unit = (it) => { const i = G0.index.get(it); return i === undefined ? Infinity : cost[i]; };
  // what depends on the world, asked once per block / mob / requirement in this table
  const blockMemo = new Map(), mobMemo = new Map(), toolMemo = new Map();
  // down in the mine, what grows or lives on the surface (a tree, sand, an animal) is the way up first away (2.5 s a level: a stair):
  // there coal from the rock beats a log for fuel. Dirt, gravel, water, the rocks: found down there too
  const climb = (b) => (env.y !== undefined && env.y < (env.surfaceY ?? 64) - 14 && !/^(dirt|coarse_dirt|gravel|clay|water|lava|stone|andesite|diorite|granite|tuff|deepslate|obsidian|cobblestone)$/.test(b) ? ((env.surfaceY ?? 64) - env.y) * 2.5 : 0);
  const findBlock = (b) => {   // seconds to get to one: in sight = walk; else the search the kind of place takes (or never)
    if (env.carriedOnly) return Infinity;   // craft_<item>: only from what is carried
    let v = blockMemo.get(b);
    if (v !== undefined) return typeof v === 'function' ? v() : v;
    const d = env.near(b), w = wild(b);
    // looked for it this time and found none: only if nothing else will do (one remembered far off, or a torch it set itself and
    // left behind, did not help either: the plan came back to it and the run stopped)
    if (env.banned?.has(b)) v = w ? 900 + w[1] * 10 : Infinity;
    else if (d !== null && d !== undefined) v = 3 + d / 4;
    else if (!w) v = Infinity;
    else {
      const wd = w[2] ?? 'overworld';
      if (wd !== dim) v = wd === 'nether' && dim === 'overworld' ? () => portalCost() + w[1] : Infinity;   // the nether: through a portal first
      else v = w[1] + (w[3] !== undefined ? Math.max(0, Math.abs((env.y ?? 64) - w[3]) - (w[4] ?? 0)) * 1.5 : climb(b));
    }
    blockMemo.set(b, v);
    return typeof v === 'function' ? v() : v;
  };
  const portalCost = () => (env.portalKnown ? 20 : 10 * unit('obsidian') + unit('flint_and_steel') + 60);
  const findMob = (m) => {
    if (env.carriedOnly) return Infinity;
    let v = mobMemo.get(m);
    if (v !== undefined) return typeof v === 'function' ? v() : v;
    const d = env.mob(m), md = MOB_DIM[m] ?? 'overworld';
    if (env.banned?.has(m) && (d === null || d === undefined)) v = MOBS[m] ? 900 + MOBS[m] * 10 : Infinity;
    else if (d !== null && d !== undefined) v = 2 + d / 4;
    else if (md !== dim) v = md === 'nether' && dim === 'overworld' && MOBS[m] ? () => portalCost() + MOBS[m] : Infinity;
    else v = (MOBS[m] ?? Infinity) + (md === 'overworld' ? climb('') : 0);
    mobMemo.set(m, v);
    return typeof v === 'function' ? v() : v;
  };
  const toolCost = (req) => {
    if (!req) return 0;
    const k = req.kind + req.tier;
    let has = toolMemo.get(k); if (has === undefined) { has = !!env.tool(req); toolMemo.set(k, has); }
    if (has) return 0;
    let best = Infinity; for (const t of TOOLS_FOR(req)) { const c = unit(t); if (c < best) best = c; }
    return best;
  };
  const haveMemo = new Map(), have = (it) => { let v = haveMemo.get(it); if (v === undefined) { v = env.have(it); haveMemo.set(it, v); } return v; };
  const station = (st) => (env.stations.has(st) || have(st) > 0 ? 0 : unit(st));
  const minOf = (list) => { let b = Infinity; for (const x of list) { const c = unit(x); if (c < b) b = c; } return b; };
  const ingCost = (g) => (g.charCodeAt(0) === 35 ? minOf(TAG(g.slice(1))) : unit(g));
  const fuelUnit = () => Math.min(unit('coal') / 8, unit('charcoal') / 8, minOf(TAG('planks')) / 1.5, minOf(TAG('logs')) / 1.5);
  const peaceful = (m) => PEACE_MEMO.get(m) ?? PEACE_MEMO.set(m, PEACEFUL.test(m)).get(m);
  function routeCost(r) {
    switch (r.kind) {
      case 'craft': { let a = 1.5; for (const [g, k] of r.ings) a += k * ingCost(g); return a / r.count + (r.big ? station('crafting_table') : 0) + (r.station === 'stonecutter' ? station('stonecutter_block') : 0); }
      case 'smelt': return ingCost(r.input) + 10 + fuelUnit() + station('furnace');
      case 'mine': return (findBlock(r.block) + DIG(r.block, r.req)) / r.per + toolCost(r.req);
      // (a fight no runner takes on for loot while another way exists: an iron golem for its iron - 100 health, 20 a blow - killed a
      // race's player at 9 minutes; a warden, a ravager, a polar bear, the bosses: dearer than any other way, the only way still)
      case 'kill': return (findMob(r.mob) + (peaceful(r.mob) ? 3 : 10)) / r.per + (peaceful(r.mob) ? 0 : 20) + (TOO_STRONG.test(r.mob) ? 3600 : 0);
      case 'milk': { let b = Infinity; for (const m of r.mobs) b = Math.min(b, findMob(m)); return b + 2 + (have(r.use) ? 0 : unit(r.use)); }
      case 'scoop': case 'bottle': return findBlock(r.block) + 2 + (have(r.use) ? 0 : unit(r.use));
      case 'eggs': return findMob('chicken') + 200;
      case 'farm': return (r.item === r.seed ? 0 : ingCost(r.seed)) / r.per + findBlock('water') + 1500 / 3 + toolCost(r.req);
      case 'shear': { let b = Infinity; for (const m of r.mobs) b = Math.min(b, findMob(m)); return b / r.per + 2 + (have(r.use) ? 0 : unit(r.use)); }
      case 'fish': return 25 / r.per + findBlock('water') + (have(r.use) ? 0 : unit(r.use));
      case 'strip': return ingCost(r.input) + 3 + toolCost(r.req);
      case 'loot': { const d = env.container?.(); return d === null || d === undefined ? Infinity : (3 + d / 4 + 5) / r.per; }
      case 'harden': return ingCost(r.input) + 6 + findBlock('water') / 4 + toolCost(r.req);
      default: return Infinity;
    }
  }
  // cheapest costs over the closure: a worklist (label-correcting shortest paths on the AND/OR recipe graph). An item is looked at
  // again only when something it is made from got cheaper; cycles like iron_ingot <-> iron_block settle by themselves
  const { list, rdeps } = G0, rts = G0.routes;
  const queue = new Int32Array(n * 8 + 16), inQ = new Uint8Array(n);
  let head = 0, tail = 0;
  const push = (i) => { if (!inQ[i]) { inQ[i] = 1; queue[tail] = i; tail = (tail + 1) % queue.length; } };
  for (let i = 0; i < n; i++) {
    const it = list[i];
    if (have(it) > 0) cost[i] = 0;
    else { const d = env.drop(it); if (d !== null && d !== undefined) cost[i] = 2 + d / 4; }
    push(i);
  }
  let evals = 0;
  while (head !== tail && evals < n * 60) {
    const i = queue[head]; head = (head + 1) % queue.length; inQ[i] = 0; evals++;
    let best = cost[i];
    if (best === 0) continue;
    for (const r of rts[i]) { const c = routeCost(r); if (c < best) best = c; }
    if (best < cost[i] - 1e-9) { cost[i] = best; for (const j of rdeps[i]) push(j); }
  }
  return { unit, routeCost, findBlock, findMob, ingCost, evals };
}
const PEACE_MEMO = new Map();

// ---- the plan: steps in order, what each uses up and makes, on a copy of the inventory ----
const WOODY = /_(planks|log|wood|stem|hyphae)$/;
const WOOD_TAGS = new Set(['#planks', '#logs', '#logs_that_burn']);
function plan(goal, n, env0, opts = {}) {
  const inv = new Map();   // the inventory as the plan goes
  const start = env0.inventory ?? new Map();
  for (const [k, v] of start) inv.set(k, v);
  const stations = new Set(env0.stations ?? []);
  const env = { ...env0, have: (it) => inv.get(it) ?? 0, stations, tool: (req) => [...inv.keys()].some((it) => inv.get(it) > 0 && fits(it, req)) };
  const steps = [], problems = [], found = new Set(), making = new Set();
  let depth = 0;
  const add = (it, k) => inv.set(it, (inv.get(it) ?? 0) + k);
  const take = (it, k) => { const h = inv.get(it) ?? 0; inv.set(it, h - Math.min(h, k)); return Math.min(h, k); };
  const bestTool = (req) => [...inv.keys()].find((it) => inv.get(it) > 0 && fits(it, req));
  let costs = null;
  const scope = closure(goal);
  const costNow = () => (costs ??= makeCosts(env, scope));
  const KEEPS = /_(pickaxe|axe|shovel|hoe|sword)$|^(shears|crafting_table|furnace|bucket|fishing_rod|stonecutter_block)$/;
  // a search counts once per kind of thing (the second log of a tree is right there)
  const findOnce = (key, sec) => { if (found.has(key)) return Math.min(sec, 5); found.add(key); return sec; };
  // have `k` of it (made if missing) and keep them: tools and stations are not used up
  function ensure(it, k = 1) { if ((inv.get(it) ?? 0) >= k) return true; const ok = get(it, k - (inv.get(it) ?? 0), true); if (ok && KEEPS.test(it)) costs = null; return ok; }
  // get k more of it into the plan's inventory; keep=false: then use them up. anyWood: any tree will do (planks for a #planks recipe)
  function get(it, k, keep = false, anyWood = false) {
    if (k <= 0) return true;
    if (it.startsWith('#')) {   // a tag: what is carried, else the member that is cheapest now
      const C = costNow(), mem = TAG(it.slice(1)).sort((a, b) => (inv.get(b) ?? 0) - (inv.get(a) ?? 0) || C.unit(a) - C.unit(b) || (a.startsWith('oak_') ? -1 : b.startsWith('oak_') ? 1 : 0));
      const wood = WOOD_TAGS.has(it);
      if (wood) {   // wood: every species together (a person counts planks, not oak planks)
        const have = mem.reduce((a, m) => a + (inv.get(m) ?? 0), 0);
        if (have >= k) { if (!keep) { let left = k; for (const m of mem) left -= take(m, left); } return true; }
      }
      const have = mem.find((m) => (inv.get(m) ?? 0) >= k);
      if (have) { if (!keep) take(have, k); return true; }
      if (!mem.length) { problems.push(`nothing is tagged ${it}`); return false; }
      return get(mem[0], k, keep, wood);
    }
    // being made further up and short of it: what is held of it is spoken for there. Taken here, 2 iron ingots of a bucket's 3 made
    // "1 ingot -> 9 nuggets -> 1 ingot" (no ingot gained) and the run crafted nuggets out of its ingots
    if (making.has(it)) { problems.push(`${it}: goes round in a circle`); return false; }
    const have = inv.get(it) ?? 0;
    if (have >= k) { if (!keep) take(it, k); return true; }
    if (anyWood && WOODY.test(it)) {   // planks / logs of another species count too
      const kind = /_(planks)$/.test(it) ? /_planks$/ : /_(log|wood|stem|hyphae)$/;
      const all = [...inv.keys()].filter((x) => kind.test(x) && (inv.get(x) ?? 0) > 0), sum = all.reduce((a, x) => a + inv.get(x), 0);
      if (sum >= k) { if (!keep) { let left = k; for (const x of all) left -= take(x, left); } return true; }
    }
    if (depth > 24) { problems.push(`${it}: too deep`); return false; }
    if (making.has(it)) { problems.push(`${it}: goes round in a circle`); return false; }   // iron_ingot -> iron_nugget -> iron_ingot: not this way
    const need = k - have;
    const C = costNow();
    const dropped = env.drop(it);
    const rs = routes(it).map((r) => ({ r, c: C.routeCost(r) })).filter((x) => Number.isFinite(x.c)).sort((a, b) => a.c - b.c);
    if (dropped !== null && dropped !== undefined && (!rs.length || 2 + dropped / 4 < rs[0].c)) {
      steps.push({ do: 'pickup', item: it, n: need, sec: 3 + dropped / 4 }); add(it, need);
      if (!keep) take(it, k); return true;
    }
    if (!rs.length) { problems.push(`${it}: no way to get it from here${routesOf(it).length ? ` (${[...new Set(routesOf(it).map((r) => r.kind + ' ' + (r.block ?? r.mob ?? r.input ?? r.ings?.map((g) => g[0]).join('+') ?? '')))].slice(0, 3).join(', ')} ... none possible here)` : ''}`); return false; }
    depth++; making.add(it);
    let ok = false;
    for (const { r } of rs) {   // the cheapest first; a way whose own needs cannot be met gives way to the next
      const mark = steps.length, snap = new Map(inv), probs = problems.length, fsnap = new Set(found);
      if (expand(r, need, anyWood)) { ok = true; break; }
      steps.length = mark; inv.clear(); for (const [a, b] of snap) inv.set(a, b); problems.length = probs; found.clear(); for (const f of fsnap) found.add(f);
      if (opts.firstOnly) break;
    }
    depth--; making.delete(it);
    if (!ok) { problems.push(`${it}: every way needs something that cannot be had`); return false; }
    if (!keep) take(it, k);
    return true;
  }
  function expand(r, need, anyWood) {
    const C = costNow();
    switch (r.kind) {
      case 'craft': {
        const times = Math.ceil(need / r.count);
        if (r.big && !stations.has('crafting_table') && !ensure('crafting_table')) return false;
        if (r.station === 'stonecutter' && !stations.has('stonecutter_block') && !ensure('stonecutter_block')) return false;
        const used = [];
        const woodRecipe = anyWood && WOODY.test(r.item);
        for (const [g, k] of r.ings) {
          if (!get(g, k * times, false, woodRecipe && WOODY.test(g))) return false;
          used.push([g, k * times]);
        }
        steps.push({ do: 'craft', item: r.item, times, count: r.count * times, big: r.big, station: r.station, uses: used, anyWood: woodRecipe || undefined, sec: 2 * Math.ceil(times / 64) + (r.big ? 2 : 0) });
        add(r.item, r.count * times);
        return true;
      }
      case 'smelt': {
        if (!stations.has('furnace') && !ensure('furnace')) return false;
        if (!get(r.input, need)) return false;
        const fuel = pickFuel(need); if (!fuel) return false;
        steps.push({ do: 'smelt', item: r.item, input: r.input, n: need, fuel: fuel[0], fueln: fuel[1], sec: 6 + 10 * need });
        add(r.item, need);
        return true;
      }
      case 'mine': {
        if (!toDim(wild(r.block)?.[2] ?? 'overworld')) return false;
        const deep = (() => { const w1 = wild(r.block); return !!w1 && w1[3] !== undefined && w1[3] < (env.y ?? 64) - 16 && env.near(r.block) === null; })();
        if (r.req && !bestTool(r.req)) { const t = TOOLS_FOR(r.req).sort((a, b) => C.unit(a) - C.unit(b))[0]; if (!t || !ensure(t, deep && /^(wooden|stone|golden)_/.test(t) ? 2 : 1)) return false; }   // a long dig wears a cheap pickaxe out: a spare
        // going underground for it (not in sight, deep): a sword first, the dark is full of zombies and skeletons
        const w0 = wild(r.block);
        if (w0 && w0[3] !== undefined && w0[3] < (env.y ?? 64) - 16 && env.near(r.block) === null && !bestTool({ kind: 'sword', tier: 1 }) && !opts.noSword) {
          const sw = ['stone_sword', 'wooden_sword'].sort((a, b) => C.unit(a) - C.unit(b))[0];
          if (Number.isFinite(C.unit(sw))) ensure(sw);
        }
        // and spare sticks: a pickaxe worn out down there is remade from cobblestone at the table carried
        // (on the way down only: already down there, a climb to a tree for them costs more than they save)
        if (w0 && w0[3] !== undefined && w0[3] < (env.y ?? 64) - 16 && env.near(r.block) === null && !opts.noSword && (inv.get('stick') ?? 0) < 2) ensure('stick', 2);
        const breaks = Math.ceil(need / r.per), wood = anyWood && /_(log|stem)$/.test(r.block);
        steps.push({ do: 'mine', item: r.item, block: r.block, anyWood: wood || undefined, tool: r.req ? bestTool(r.req) : null, req: r.req, n: need, breaks,
          sec: findOnce(wood ? 'LOG' : r.block, C.findBlock(r.block)) + breaks * (DIG(r.block, r.req) + 2) });
        add(r.item, Math.max(need, Math.floor(breaks * r.per)));
        return true;
      }
      case 'kill': {
        if (!toDim(MOB_DIM[r.mob] ?? 'overworld')) return false;
        const kills = Math.ceil(need / r.per);
        const w = ['diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'].find((x) => (inv.get(x) ?? 0) > 0) ?? null;
        steps.push({ do: 'kill', item: r.item, mob: r.mob, n: need, kills, weapon: w, sec: findOnce(r.mob, C.findMob(r.mob)) + kills * (PEACEFUL.test(r.mob) ? 5 : 12) });
        add(r.item, need);
        return true;
      }
      case 'milk': case 'shear': case 'scoop': case 'bottle': case 'fish': {
        if (r.use && !ensure(r.use, r.kind === 'milk' || r.kind === 'scoop' || r.kind === 'bottle' ? need : 1)) return false;
        if (r.kind === 'milk' || r.kind === 'scoop' || r.kind === 'bottle') take(r.use, need);   // each bucket / bowl / bottle becomes one
        const find = r.mobs ? findOnce(r.mobs[0], Math.min(...r.mobs.map(C.findMob))) : findOnce(r.block ?? 'water', C.findBlock(r.block ?? 'water'));
        steps.push({ do: r.kind, item: r.item, n: need, mobs: r.mobs, block: r.block, use: r.use, sec: find + (r.kind === 'fish' ? 25 / r.per : 4) * (r.kind === 'shear' ? Math.ceil(need / r.per) : need) });
        add(r.item, need);
        return true;
      }
      case 'eggs': steps.push({ do: 'eggs', item: r.item, n: need, mobs: r.mobs, sec: findOnce('chicken', C.findMob('chicken')) + 200 * need }); add(r.item, need); return true;
      case 'loot': steps.push({ do: 'loot', item: r.item, n: need, sec: 20 }); add(r.item, need); return true;
      case 'farm': {   // plants: one seed each (a seed crop needs one kept back to plant), then wait by them
        if (!bestTool(r.req)) { const t = TOOLS_FOR(r.req).sort((a, b) => C.unit(a) - C.unit(b))[0]; if (!t || !ensure(t)) return false; }
        const plants = Math.max(1, Math.ceil(need / r.per));
        if (r.item === r.seed ? !ensure(r.seed, 1) : !get(r.seed, plants)) return false;
        steps.push({ do: 'farm', item: r.item, seed: r.seed, crop: r.crop, plants, n: need, sec: findOnce('water', C.findBlock('water')) + 15 + plants * 3 + 1500 });
        add(r.item, need);
        return true;
      }
      case 'strip': case 'harden': {   // set the block down, work it (axe / water), break it again
        if (!bestTool(r.req)) { const t = TOOLS_FOR(r.req).sort((a, b) => C.unit(a) - C.unit(b))[0]; if (!t || !ensure(t)) return false; }
        if (!get(r.input, need)) return false;
        steps.push({ do: r.kind, item: r.item, input: r.input, n: need, tool: bestTool(r.req), req: r.req, sec: need * (r.kind === 'strip' ? 4 : 8) + (r.kind === 'harden' ? findOnce('water', C.findBlock('water')) : 0) });
        add(r.item, need);
        return true;
      }
      default: return false;
    }
  }
  // be in dimension d for the next step: the nether is reached by building a portal (10 obsidian, lit with flint and steel)
  function toDim(d) {
    if ((env.dim ?? 'overworld') === d) return true;
    if (d !== 'nether' || (env.dim ?? 'overworld') !== 'overworld') return false;
    if (!env0.portalKnown) { if (!ensure('obsidian', 10) || !ensure('flint_and_steel')) return false; take('obsidian', 10); }
    steps.push({ do: 'portal', item: 'obsidian', n: 0, to: 'nether', sec: env0.portalKnown ? 20 : 90 });
    env.dim = 'nether'; costs = null;
    return true;
  }
  function pickFuel(items) {
    const C = costNow();
    const opts2 = [['coal', 8], ['charcoal', 8], ...TAG('planks').map((p) => [p, 1.5]), ...TAG('logs').map((p) => [p, 1.5])];
    const have = opts2.find(([f, per]) => (inv.get(f) ?? 0) >= Math.ceil(items / per));
    if (have) { const k = Math.ceil(items / have[1]); take(have[0], k); return [have[0], k]; }
    const best = opts2.map(([f, per]) => [f, per, (C.unit(f) * Math.ceil(items / per))]).filter((x) => Number.isFinite(x[2])).sort((a, b) => a[2] - b[2] || (a[0].startsWith('oak_') ? -1 : 1))[0];
    if (!best) { problems.push('no fuel to be had'); return null; }
    const k = Math.ceil(items / best[1]);
    if (!get(best[0], k, false, WOODY.test(best[0]))) return null;
    return [best[0], k];
  }
  const ok = get(goal, n, true);
  const out = compress(steps, start);
  return { ok, goal, n, steps: out, problems: [...new Set(problems)], sec: out.reduce((a, x) => a + (x.sec ?? 0), 0), left: inv };
}

// fewer trips: every later dig of the same block (same tool) joins the first one; the same craft right after another joins it; a
// craft moves up to an earlier one of the same item when what it needs is there by then (checked by replaying the inventory)
function compress(steps0, start) {
  const steps = steps0.map((x) => ({ ...x }));
  const key = (x) => (x.do === 'mine' ? `mine|${x.anyWood ? 'LOG' : x.block}|${x.req ? reqName(x.req) : 'hand'}|${x.item}` : null);
  for (let j = 0; j < steps.length; j++) {
    const k = key(steps[j]); if (!k) continue;
    const i = steps.findIndex((x, q) => q < j && key(x) === k);
    if (i >= 0) { steps[i].breaks += steps[j].breaks; steps[i].n += steps[j].n; steps[i].sec += steps[j].sec - (steps[j].sec > 30 ? steps[j].sec - steps[j].breaks * 3 : 0); steps.splice(j, 1); j--; }
  }
  const replay = (list) => {   // false if some step would use what is not there yet
    const inv = new Map(start);
    const take = (g, k) => {
      if (g.startsWith('#')) { const mem = TAG(g.slice(1)); for (const m of mem) { const h = inv.get(m) ?? 0, t = Math.min(h, k); inv.set(m, h - t); k -= t; if (!k) break; } return k === 0; }
      const h = inv.get(g) ?? 0; if (h < k) { if (WOODY.test(g)) { const kind = /_planks$/.test(g) ? /_planks$/ : /_(log|wood|stem|hyphae)$/; for (const [m, v] of inv) if (kind.test(m) && v > 0) { const t = Math.min(v, k - h); inv.set(m, v - t); k -= t; } } }
      const h2 = inv.get(g) ?? 0; if (h2 < k) return false; inv.set(g, h2 - k); return true;
    };
    const add = (g, k) => inv.set(g, (inv.get(g) ?? 0) + k);
    for (const x of list) {
      if (x.do === 'craft') { for (const [g, k] of x.uses) if (!take(g, k)) return false; add(x.item, x.count); }
      else if (x.do === 'smelt') { if (!take(x.input, x.n) || !take(x.fuel, x.fueln)) return false; add(x.item, x.n); }
      else if (x.do === 'milk' || x.do === 'scoop' || x.do === 'bottle') { if (!take(x.use, x.n)) return false; add(x.item, x.n); }
      else if (x.do === 'portal') { if (!take('obsidian', 10)) return false; }
      else {   // gathering: the tool it needs has to be there by then
        if (x.do === 'mine' && x.req && ![...inv].some(([it, v]) => v > 0 && fits(it, x.req))) return false;
        if ((x.do === 'shear' || x.do === 'fish') && x.use && !((inv.get(x.use) ?? 0) > 0)) return false;
        add(x.item, x.n);
      }
    }
    return true;
  };
  for (let j = 0; j < steps.length; j++) {
    if (steps[j].do !== 'craft') continue;
    const i = steps.findIndex((x, q) => q < j && x.do === 'craft' && x.item === steps[j].item && x.big === steps[j].big);
    if (i < 0) continue;
    const tryList = steps.map((x) => ({ ...x }));
    const a = tryList[i], b = tryList[j];
    a.times += b.times; a.count += b.count; a.uses = a.uses.map(([g, k]) => [g, k + (b.uses.find(([h]) => h === g)?.[1] ?? 0)]);
    tryList.splice(j, 1);
    if (replay(tryList)) { steps.splice(0, steps.length, ...tryList); j--; }
  }
  // a furnace cooks by itself (10 s an item): gathering that does not need what it makes moves up to right after the smelt, and is
  // done while it cooks (goal-exec leaves the furnace working)
  if (replay(steps)) {
    for (let i = 0; i < steps.length - 2; i++) {
      if (steps[i].do !== 'smelt' || steps[i].n < 2) continue;
      let at = i + 1;   // where the next one moved up goes (after those already there)
      while (at < steps.length && GATHER_STEPS.has(steps[at].do)) at++;
      for (let j = at + 1; j < steps.length; j++) {
        if (!GATHER_STEPS.has(steps[j].do)) continue;
        const tryList = steps.slice(), [g] = tryList.splice(j, 1);
        tryList.splice(at, 0, g);
        if (replay(tryList)) { steps.splice(0, steps.length, ...tryList); at++; }
      }
    }
  }
  return steps;
}
const GATHER_STEPS = new Set(['mine', 'kill', 'milk', 'shear', 'scoop', 'bottle', 'fish', 'eggs', 'pickup', 'loot']);

// the plan in words, one line per step (what `plan` prints and `get` announces)
function describe(s) {
  switch (s.do) {
    case 'mine': return `mine ${s.anyWood ? 'any tree' : s.block}${s.breaks > 1 ? ' x' + s.breaks : ''} (${s.req ? reqName(s.req) : 'hand'}) -> ${s.n} ${s.anyWood ? 'logs' : s.item}`;
    case 'craft': return `craft ${s.item}${s.count > 1 ? ' x' + s.count : ''}${s.big ? ' (table)' : ''} from ${s.uses.map(([g, k]) => `${k} ${g}`).join(' + ')}`;
    case 'smelt': return `smelt ${s.n} ${s.input} -> ${s.item} (fuel ${s.fueln} ${s.fuel})`;
    case 'kill': return `kill ${s.mob}${s.kills > 1 ? ' x' + s.kills : ''} -> ${s.n} ${s.item}`;
    case 'milk': return `milk a ${s.mobs[0]} with a ${s.use}${s.n > 1 ? ' x' + s.n : ''} -> ${s.item}`;
    case 'scoop': return `scoop ${s.block} with a bucket${s.n > 1 ? ' x' + s.n : ''}`;
    case 'bottle': return `fill a glass bottle at ${s.block}${s.n > 1 ? ' x' + s.n : ''}`;
    case 'shear': return `shear ${s.mobs[0]} -> ${s.n} ${s.item}`;
    case 'fish': return `fish -> ${s.n} ${s.item}`;
    case 'eggs': return `wait by chickens for ${s.n} egg`;
    case 'pickup': return `pick up ${s.n} ${s.item} lying nearby`;
    case 'strip': return `strip ${s.n} ${s.input} with an axe -> ${s.item}`;
    case 'farm': return `farm: till by water, plant ${s.plants} ${s.seed}, wait for them -> ${s.n} ${s.item}`;
    case 'loot': return `look in the chests in sight for ${s.n} ${s.item}`;
    case 'portal': return `build a nether portal (10 obsidian), light it and go through`;
    case 'harden': return `set ${s.n} ${s.input} in water -> ${s.item}`;
    default: return s.do;
  }
}
const mmss = (sec) => (Number.isFinite(sec) ? `${Math.floor(sec / 60)}m${String(Math.round(sec % 60)).padStart(2, '0')}s` : '?');

// ---- names: every item / block / mob id, and the Japanese name the game uses ----
const ja = (id) => KB.items[id]?.[0] ?? KB.blocks[id]?.[0] ?? KB.mobs[id]?.[0] ?? id;
// the items a player can get by the planner's means (some route exists), for the generated verbs
const OBTAINABLE = Object.keys(KB.items).filter((it) => routesOf(it).length > 0 || KB.items[it] === undefined);

module.exports = { KB, plan, compress, closure, describe, routesOf, makeCosts, toolReq, fits, TOOLS_FOR, reqName, WILD, MOBS, MOB_DIM, wild, MINE, KILL, SPECIAL, TAG, ja, mmss, OBTAINABLE, sid, TIER };
