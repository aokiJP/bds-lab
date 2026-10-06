// v40: the rest of what a player does, so the real client covers about every action a person has (~1000 with realplayer.cjs's
// primitives and verbs.cjs). Same rule as verbs.cjs: walk up to the thing like a person, pick the tool (hotbar key, or drag it onto
// the selected slot), aim, then only the primitives realplayer.cjs sends (measured on BDS). No verb here adds a packet.
// Mob foods / tame items / what shears remove come from BDS 1.26.51's own vanilla behavior files (entities/*.json).
// Every verb has an entry in common/data/everyday.json (use, args, items, mobs, blocks, ja); tests/realplayer-offline.mjs runs each.
'use strict';

const DIRS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const OPP = { north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up' };
const YAW = { south: 0, west: 90, north: 180, east: -90 };   // Bedrock yaw: 0 looks toward +z
const TIER = ['netherite', 'diamond', 'iron', 'copper', 'stone', 'golden', 'wooden'];
const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];

// ---- what mobs eat and take (vanilla entities/*.json: breedable, healable/ageable, tameable, tamemount, interact) ----
const SEEDS = 'wheat_seeds|beetroot_seeds|melon_seeds|pumpkin_seeds|torchflower_seeds|pitcher_pod';
const MEAT = 'cooked_beef|beef|cooked_porkchop|porkchop|cooked_chicken|chicken|cooked_mutton|mutton|cooked_rabbit|rabbit|rotten_flesh';
const FISH = 'cod|salmon';
const FLOWERS = 'dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|torchflower|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers|cactus_flower|wither_rose';
const HORSE_FEED = 'golden_carrot|golden_apple|enchanted_golden_apple|apple|carrot|sugar|wheat|hay_block';
const SEA_FOOD = 'pufferfish|cod|salmon|tropical_fish|cooked_cod|cooked_salmon|pufferfish_bucket|cod_bucket|salmon_bucket|tropical_fish_bucket';
const BREED = {
  cow: 'wheat', mooshroom: 'wheat', sheep: 'wheat', goat: 'wheat', pig: 'carrot|potato|beetroot', chicken: SEEDS,
  horse: 'golden_carrot|golden_apple|enchanted_golden_apple', donkey: 'golden_carrot|golden_apple|enchanted_golden_apple', llama: 'hay_block', trader_llama: 'hay_block',
  camel: 'cactus', wolf: MEAT, cat: FISH, ocelot: FISH, rabbit: 'dandelion|carrot|golden_carrot', turtle: 'seagrass', panda: 'bamboo', fox: 'sweet_berries|glow_berries',
  bee: FLOWERS, axolotl: 'tropical_fish_bucket', frog: 'slime_ball', hoglin: 'crimson_fungus', strider: 'warped_fungus', sniffer: 'torchflower_seeds', armadillo: 'spider_eye', nautilus: SEA_FOOD,
};
// feeding one: heals it, grows a baby, or is the only thing it takes
const FEED = { ...BREED, horse: HORSE_FEED, donkey: HORSE_FEED, mule: HORSE_FEED, llama: 'wheat|hay_block', trader_llama: 'wheat|hay_block', wolf: MEAT + '|' + FISH,
  zombie_horse: 'red_mushroom', camel_husk: 'rabbit_foot', dolphin: FISH, happy_ghast: 'snowball', tadpole: 'slime_ball', zombie_nautilus: SEA_FOOD };
// tamed by: an item given until the hearts show, or by riding it until it stops bucking (mount)
const TAME = { wolf: 'bone', cat: FISH, ocelot: FISH, parrot: SEEDS, nautilus: 'pufferfish', zombie_nautilus: 'pufferfish',
  horse: 'mount', donkey: 'mount', mule: 'mount', llama: 'mount', trader_llama: 'mount', zombie_horse: 'mount' };
const RIDE = ['horse', 'donkey', 'mule', 'llama', 'trader_llama', 'pig', 'strider', 'camel', 'camel_husk', 'skeleton_horse', 'zombie_horse', 'happy_ghast', 'nautilus', 'zombie_nautilus', 'boat', 'chest_boat', 'minecart', 'cushion'];
const FOODS_EAT = { apple: 36, baked_potato: 36, beef: 36, beetroot: 36, beetroot_soup: 36, bread: 36, carrot: 36, chicken: 36, chorus_fruit: 36, cod: 36, cooked_beef: 36,
  cooked_chicken: 36, cooked_cod: 36, cooked_mutton: 36, cooked_porkchop: 36, cooked_rabbit: 36, cooked_salmon: 36, cookie: 36, dried_kelp: 20, enchanted_golden_apple: 36,
  glow_berries: 36, golden_apple: 36, golden_carrot: 36, melon_slice: 36, mushroom_stew: 36, mutton: 36, poisonous_potato: 36, porkchop: 36, potato: 36, pufferfish: 36,
  pumpkin_pie: 36, rabbit: 36, rabbit_stew: 36, rotten_flesh: 36, salmon: 36, spider_eye: 36, suspicious_stew: 36, sweet_berries: 36, tropical_fish: 36 };

// ---- hostile mobs and how a person fights each (tactic flags) ----
const FOES = {
  zombie: {}, husk: {}, drowned: {}, zombie_villager: {}, zombified_piglin: {}, piglin: {}, piglin_brute: {}, hoglin: {}, zoglin: {}, wither_skeleton: {}, vex: {}, witch: {},
  breeze: {}, guardian: {}, elder_guardian: {}, silverfish: {}, endermite: {}, evoker: {}, wither: {}, ravager: { shield: 1 }, vindicator: { shield: 1 }, pillager: { shield: 1 },
  skeleton: { shield: 1 }, stray: { shield: 1 }, bogged: { shield: 1 }, parched: { shield: 1 }, shulker: { shield: 1 }, spider: { crit: 1 }, cave_spider: { crit: 1 },
  creeper: { back: 14 }, enderman: { low: 1 }, phantom: { up: 1 }, slime: { all: 1 }, magma_cube: { all: 1 }, blaze: { throw: 'snowball' }, ghast: { deflect: 1 },
};

// ---- commands a player types (an operator), and the world settings toggles ----
const CMD = {
  gm_survival: 'gamemode survival', gm_creative: 'gamemode creative', gm_adventure: 'gamemode adventure', gm_spectator: 'gamemode spectator',
  time_day: 'time set day', time_noon: 'time set noon', time_night: 'time set night', time_midnight: 'time set midnight', time_sunrise: 'time set sunrise', time_sunset: 'time set sunset',
  weather_clear: 'weather clear', weather_rain: 'weather rain', weather_thunder: 'weather thunder',
  difficulty_peaceful: 'difficulty peaceful', difficulty_easy: 'difficulty easy', difficulty_normal: 'difficulty normal', difficulty_hard: 'difficulty hard',
  kill_self: 'kill @s', clear_inventory: 'clear @s', clear_effects: 'effect @s clear', heal_cmd: 'effect @s instant_health 1 255 true', feed_cmd: 'effect @s saturation 1 255 true',
  spawnpoint_here: 'spawnpoint @s ~ ~ ~', worldspawn_here: 'setworldspawn ~ ~ ~', daylock_on: 'daylock true', daylock_off: 'daylock false', list_players: 'list',
  camera_reset: 'camera @s clear', hud_hide: 'hud @s hide all', hud_show: 'hud @s reset all',
};
// $1.. = the verb's arguments, ${n:default}, $* = all of them, $*2 = from the 2nd on
const CMDA = {
  give_self: 'give @s $1 ${2:1}', xp_add: 'xp ${1:10} @s', xp_levels: 'xp ${1:5}L @s', effect_self: 'effect @s $1 ${2:30} ${3:0}', enchant_held: 'enchant @s $1 ${2:1}',
  tp_xyz: 'tp @s $1 $2 $3', tp_to: 'tp @s $1', tp_here: 'tp $1 @s', summon_mob: 'summon $1 ^ ^ ^2', setblock_at: 'setblock $1 $2 $3 $4', fill_blocks: 'fill $1 $2 $3 $4 $5 $6 $7',
  locate_structure: 'locate structure $1', locate_biome: 'locate biome $1:ns', say_all: 'say $*', title_self: 'title @s title $*', playsound_self: 'playsound $1 @s', particle_here: 'particle $1 ~ ~1 ~',
  tag_self: 'tag @s add $1', untag_self: 'tag @s remove $1', score_set: 'scoreboard players set @s $1 ${2:0}', score_add: 'scoreboard players add @s $1 ${2:1}',
  run_function: 'function $1', scriptevent_send: 'scriptevent $1 $*2', time_add: 'time add ${1:1000}', kick_player: 'kick $1 $*2', op_player: 'op $1', deop_player: 'deop $1',
};
const RULES = { keep_inventory: 'keepinventory', daylight_cycle: 'dodaylightcycle', weather_cycle: 'doweathercycle', mob_spawning: 'domobspawning', fire_tick: 'dofiretick', mob_griefing: 'mobgriefing',
  show_coordinates: 'showcoordinates', natural_regen: 'naturalregeneration', pvp: 'pvp', tnt_explodes: 'tntexplodes', fall_damage: 'falldamage', fire_damage: 'firedamage', drowning_damage: 'drowningdamage',
  freeze_damage: 'freezedamage', immediate_respawn: 'doimmediaterespawn', insomnia: 'doinsomnia', mob_loot: 'domobloot', tile_drops: 'dotiledrops', entity_drops: 'doentitydrops', death_messages: 'showdeathmessages' };

// ---- crafting goals (the item, or a function of the wood type carried) ----
const MAKE = {
  sticks: 'stick', crafting_table: 'crafting_table', torches: 'torch', chest: 'chest', furnace: 'furnace', bed: 'bed', boat: (w) => `${w}_boat`, bread: 'bread', bucket: 'bucket',
  shield: 'shield', bow: 'bow', arrows: 'arrow', ladder: 'ladder', fence: (w) => `${w}_fence`, fence_gate: (w) => (w === 'oak' ? 'fence_gate' : `${w}_fence_gate`), door: (w) => (w === 'oak' ? 'wooden_door' : `${w}_door`),
  trapdoor: (w) => (w === 'oak' ? 'trapdoor' : `${w}_trapdoor`), sign: (w) => `${w}_sign`, bowl: 'bowl', paper: 'paper', book: 'book', bookshelf: 'bookshelf', enchanting_table: 'enchanting_table',
  anvil: 'anvil', brewing_stand: 'brewing_stand', cauldron: 'cauldron', hopper: 'hopper', piston: 'piston', sticky_piston: 'sticky_piston', rails: 'rail', powered_rail: 'golden_rail', minecart: 'minecart',
  tnt: 'tnt', lantern: 'lantern', campfire: 'campfire', compass: 'compass', clock: 'clock', map: 'empty_map', golden_apple: 'golden_apple', golden_carrot: 'golden_carrot', cake: 'cake', bone_meal: 'bone_meal',
  firework: 'firework_rocket', shears: 'shears', flint_and_steel: 'flint_and_steel', fishing_rod: 'fishing_rod', lead: 'lead', item_frame: 'frame', painting: 'painting', armor_stand: 'armor_stand',
  glass_pane: 'glass_pane', iron_bars: 'iron_bars', barrel: 'barrel', smoker: 'smoker', blast_furnace: 'blast_furnace', composter: 'composter', lectern: 'lectern', loom: 'loom', grindstone: 'grindstone',
  stonecutter: 'stonecutter_block', smithing_table: 'smithing_table', cartography_table: 'cartography_table', jukebox: 'jukebox', noteblock: 'noteblock', beacon: 'beacon', ender_chest: 'ender_chest',
  crossbow: 'crossbow', spyglass: 'spyglass', brush: 'brush', scaffolding: 'scaffolding', redstone_torch: 'redstone_torch', repeater: 'repeater', comparator: 'comparator', lever: 'lever', observer: 'observer',
  dispenser: 'dispenser', dropper: 'dropper', target: 'target', daylight_detector: 'daylight_detector', trapped_chest: 'trapped_chest', pumpkin_pie: 'pumpkin_pie', cookie: 'cookie', sugar: 'sugar',
  mushroom_stew: 'mushroom_stew', carrot_on_a_stick: 'carrot_on_a_stick',
};
// smelting goals: what goes into the furnace
const SMELT = { smelt_iron: 'raw_iron', smelt_gold: 'raw_gold', smelt_copper: 'raw_copper', make_glass: 'sand', make_charcoal: /_log$/, make_stone: 'cobblestone', make_smooth_stone: 'stone',
  make_brick: 'clay_ball', make_dried_kelp: 'kelp', make_green_dye: 'cactus', make_lime_dye: 'sea_pickle', make_popped_chorus: 'chorus_fruit', make_netherite_scrap: 'ancient_debris',
  dry_sponge: 'wet_sponge', make_nether_brick: 'netherrack', make_terracotta: 'clay', make_deepslate: 'cobbled_deepslate' };
// brewing: the ingredients in order, starting from water bottles
const POTIONS = { awkward: ['nether_wart'], swiftness: ['nether_wart', 'sugar'], slowness: ['nether_wart', 'sugar', 'fermented_spider_eye'], leaping: ['nether_wart', 'rabbit_foot'],
  strength: ['nether_wart', 'blaze_powder'], healing: ['nether_wart', 'glistering_melon_slice'], harming: ['nether_wart', 'glistering_melon_slice', 'fermented_spider_eye'], poison: ['nether_wart', 'spider_eye'],
  regeneration: ['nether_wart', 'ghast_tear'], fire_resistance: ['nether_wart', 'magma_cream'], water_breathing: ['nether_wart', 'pufferfish'], night_vision: ['nether_wart', 'golden_carrot'],
  invisibility: ['nether_wart', 'golden_carrot', 'fermented_spider_eye'], slow_falling: ['nether_wart', 'phantom_membrane'], turtle_master: ['nether_wart', 'turtle_helmet'], weakness: ['fermented_spider_eye'],
  wind_charged: ['nether_wart', 'breeze_rod'], weaving: ['nether_wart', 'web'], oozing: ['nether_wart', 'slime'], infested: ['nether_wart', 'stone'] };
const MODS = { brew_longer: 'redstone', brew_stronger: 'glowstone_dust', brew_splash: 'gunpowder', brew_lingering: 'dragon_breath' };
// the cartography table: what goes in its two slots
const MAPS = { map_new: ['paper'], map_locator: ['paper', 'compass'], map_copy: ['filled_map', 'empty_map'], map_zoom: ['filled_map', 'paper'], map_lock: ['filled_map', 'glass_pane'] };

// ---- farming: what each crop is planted from, on which face; when a crop block counts as ripe (BDS block states) ----
const CROPS = { wheat: ['wheat_seeds'], carrot: ['carrot'], potato: ['potato'], beetroot: ['beetroot_seeds'], melon: ['melon_seeds'], pumpkin: ['pumpkin_seeds'], torchflower: ['torchflower_seeds'],
  pitcher: ['pitcher_pod'], nether_wart: ['nether_wart'], sugar_cane: ['sugar_cane'], cactus: ['cactus'], bamboo: ['bamboo'], sweet_berries: ['sweet_berries'], kelp: ['kelp'], sea_pickle: ['sea_pickle'],
  mushroom: [/(^|:)(brown|red)_mushroom$/], fungus: [/(^|:)(crimson|warped)_fungus$/], chorus: ['chorus_flower'], flower: ['FLOWER'], cocoa: ['cocoa_beans', 'side'], glow_berries: ['glow_berries', 'down'] };
const RIPE = { wheat: ['growth', 7], carrots: ['growth', 7], potatoes: ['growth', 7], beetroot: ['growth', 7], nether_wart: ['age', 3], cocoa: ['age', 2], pitcher_crop: ['growth', 4], torchflower: null, melon_block: null, pumpkin: null };
// the blocks whose screen a player opens (the older CLICK verbs chest barrel furnace ... are in verbs.cjs)
const OPEN = { open_trapped_chest: 'trapped_chest', open_hopper: 'hopper', open_dispenser: 'dispenser', open_dropper: 'dropper', open_blast_furnace: 'blast_furnace', open_smoker: 'smoker',
  open_brewing_stand: 'brewing_stand', open_enchanting_table: 'enchanting_table', open_grindstone: 'grindstone', open_stonecutter: 'stonecutter_block', open_cartography_table: 'cartography_table',
  open_smithing_table: 'smithing_table', open_crafter: 'crafter', open_beacon: 'beacon', open_lectern: 'lectern', open_copper_chest: 'copper_chest', open_command_block: 'command_block' };

function moreVerbs(K, H) {
  const { V, nm, re, n, grab, slotOf, useOn, has, firstEmpty } = H;
  const M = {};
  const add = (name, fn) => { if (name in M) throw new Error(`verb ${name} defined twice`); M[name] = fn; };
  const addAll = (o) => { for (const [k, f] of Object.entries(o)) add(k, f); };
  const S = (v) => String(v);
  const say = (v, s) => K.say(`${v}: ${s}`);

  // ---------- helpers: where things are, walking up to them, the right thing in hand ----------
  const eye = () => { const f = K.feet(); return { x: f.x, y: f.y + 1.62, z: f.z }; };
  const dBlock = (x, y, z) => { const e = eye(); return Math.hypot(x + 0.5 - e.x, y + 0.5 - e.y, z + 0.5 - e.z); };
  const dEnt = (e) => { const f = K.feet(); return Math.hypot(e.x - f.x, e.y - f.y, e.z - f.z); };
  const here = () => { const f = K.feet(); return [Math.floor(f.x), Math.floor(f.y + 0.01), Math.floor(f.z)]; };
  const blockAt = (x, y, z) => K.world.block(x, y, z);
  const nameAt = (x, y, z) => (blockAt(x, y, z)?.name ?? '').replace(/^minecraft:/, '');
  const isAir = (b) => !!b && /^minecraft:(air|cave_air|void_air)$/.test(b.name);
  const solid = (b) => !!b && b.shape?.length > 0;
  const nums = (a, i, k) => { const v = a.slice(i, i + k).map(Number); if (v.length < k || v.some((x) => !Number.isFinite(x))) throw new Error(`needs ${k} numbers`); return v; };
  const go = (x, z, max = 200) => K.act('goto', [S(x), S(z), '', S(max)]);
  const yawTo = (x, z) => { const f = K.feet(); return (Math.atan2(-(x - f.x), z - f.z) * 180) / Math.PI; };
  const alts = (list) => (list instanceof RegExp ? [list] : String(list).split('|'));
  // walk toward a point (or a moving one) until done(): the keys a person holds, a hop when stuck against a step
  async function walkToward(target, done, max = 120) {
    let last = K.feet(), still = 0;
    for (let k = 0; k < max && !done(); k++) {
      const [x, z] = target(), f = K.feet(), dx = x - f.x, dz = z - f.z;
      if (Math.hypot(dx, dz) < 0.3) break;
      K.look((Math.atan2(-dx, dz) * 180) / Math.PI, K.pitch()); K.controls.forward = true;
      if (Math.hypot(f.x - last.x, f.z - last.z) < 0.02) { if (++still > 4) { K.controls.jump = true; still = 0; } } else { still = 0; K.controls.jump = false; }
      last = f; await K.ticks(1);
    }
    K.controls.forward = false; K.controls.jump = false;
    return K.ticks(2);
  }
  // stand within reach of a block: the nearest free cell next to it that this client knows, else straight toward it
  async function near(x, y, z, r = 4.5) {
    if (dBlock(x, y, z) <= r) return true;
    const f = K.feet(); let best = null;
    for (const [dx, dz] of RING) for (const dy of [0, -1, 1, -2]) {
      const cx = x + dx, cy = y + dy, cz = z + dz;
      if (K.canStand(cx, cy, cz)) { const d = Math.hypot(cx + 0.5 - f.x, cz + 0.5 - f.z); if (!best || d < best[2]) best = [cx, cz, d]; }
    }
    if (best) await go(best[0] + 0.5, best[1] + 0.5, 200);
    if (dBlock(x, y, z) > r) await walkToward(() => [x + 0.5, z + 0.5], () => dBlock(x, y, z) <= r - 0.5, 160);
    return dBlock(x, y, z) <= r;
  }
  async function nearMob(e, r = 2.5) { if (dEnt(e) <= r) return true; await walkToward(() => [e.x, e.z], () => dEnt(e) <= r, 160); return dEnt(e) <= r; }
  const mob = (type) => K.nearest(type)[0] ?? null;
  // the first of several items that is carried (grab it), else a clear error
  const carried = (list) => alts(list).find((x) => has(x));
  async function grabAny(list, verb) {
    await K.sync();
    const it = carried(list);
    const names = alts(list).map((x) => (x instanceof RegExp ? x.source.replace(/[\\^$()|?:]/g, '').replace(/^_/, '*_') : x));
    if (!it) throw new Error(`${verb}: needs ${names.slice(0, 4).join(' or ')}${names.length > 4 ? ' ...' : ''} (console: give ${K.name} ${names[0].replace(/^\*_/, 'iron_')})`);
    await grab(it, verb);
    return String(it);
  }
  // an empty hand (a free hotbar slot), so a click is a plain click: mounting, taking, opening
  async function emptyHand() {
    await K.sync();
    const s = K.inv.slots;
    if (!s[K.inv.selected]?.network_id) return;
    const i = s.findIndex((it, k) => k < 9 && !it?.network_id);
    if (i >= 0) return K.act('slot', [S(i)]);
    const j = firstEmpty();
    if (j >= 9) return K.act('move', [S(K.inv.selected), S(j)]);
  }
  const count = (what) => { const r = re(what); return K.inv.slots.reduce((c, it) => c + (it?.network_id && r.test(nm(it)) ? it.count : 0), 0); };
  const invSig = () => K.inv.slots.map((it) => (it?.network_id ? nm(it) + '*' + it.count : '')).join();
  const bestOf = (kind) => TIER.map((t) => `${t}_${kind}`).find((x) => has(x)) ?? null;
  async function bestWeapon() { await K.sync(); const w = bestOf('sword') ?? bestOf('axe') ?? carried('mace|trident') ?? bestOf('spear'); if (w) await grab(w, 'weapon'); return w; }
  // which tool a block wants (hand = null)
  function toolKind(name) {
    const b = name.replace(/^minecraft:/, '');
    if (/^(air|water|lava|fire|.*torch|redstone_wire|.*button|lever|.*rail|.*carpet|.*sapling|wheat|carrots|potatoes|beetroot|.*_crop|sugar_cane|kelp.*|seagrass|.*grass|.*fern|deadbush|.*flower.*|poppy|dandelion|.*tulip|allium|azure_bluet|blue_orchid|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|.*mushroom|.*fungus|.*roots|scaffolding|snow_layer)$/.test(b)) return null;
    if (/leaves|hay_block|sponge|sculk|shroomlight|wart_block|^target$|dried_kelp_block|moss/.test(b)) return 'hoe';
    if (/wool|^web$|vine|glow_lichen/.test(b)) return 'shears';
    if (/log$|wood$|stem$|hyphae$|planks|door$|fence|chest$|barrel|crafting_table|bookshelf|lectern|loom|_table$|composter|jukebox|noteblock|beehive|bee_nest|campfire|ladder|sign$|pumpkin|melon_block|cocoa|bamboo|mushroom_block|mushroom_stem|daylight|banner|shelf$|creaking_heart/.test(b) && !/iron|copper|crimson_nylium/.test(b)) return 'axe';
    if (/dirt|grass_block|podzol|mycelium|farmland|grass_path|sand$|gravel|clay$|soul_sand|soul_soil|snow$|concrete_powder|^mud$|muddy|suspicious/.test(b)) return 'shovel';
    return 'pickaxe';
  }
  async function toolFor(x, y, z) {
    const b = blockAt(x, y, z); if (!b) return null;
    const k = toolKind(b.name); if (!k) { await emptyHand(); return 'hand'; }
    // (the client's copy of the inventory can be behind - the tool just broke, lost in a death: then the next best, or the hand)
    for (let k2 = 0; k2 < 2; k2++) {
      const t = k === 'shears' ? carried('shears') : bestOf(k);
      if (!t) return 'hand';
      try { await grab(t, 'tool'); return t; } catch { await K.sync(); }
    }
    return 'hand';
  }
  async function digAt(x, y, z, tool = true) { await near(x, y, z); if (tool) await toolFor(x, y, z); return K.act('dig', [S(x), S(y), S(z)]); }
  // known blocks around (this client's chunks) whose name matches, nearest first
  function scan(test, r = 16, from = here()) {
    const out = [], [cx, cy, cz] = from, t = test instanceof RegExp ? (b) => test.test(b.name) : test;
    for (let y = cy - Math.min(r, 16); y <= cy + Math.min(r, 16); y++) for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      const b = blockAt(x, y, z);
      if (b && !isAir(b) && t(b)) out.push([x, y, z, b, Math.hypot(x - cx, y - cy, z - cz)]);
    }
    return out.sort((p, q) => p[4] - q[4]);
  }
  const blockRe = (w) => new RegExp(`^minecraft:${String(w).replace(/^minecraft:/, '')}$`);
  // put an item at x y z like a person: on the floor (the top of the block below), under a ceiling, or against a wall on one side
  async function putAt(item, x, y, z, mount = 'floor', extra = []) {
    if (item) await grab(item, 'place');
    let s, face;
    if (mount === 'floor' || mount === 'up') { s = [x, y - 1, z]; face = 'up'; }
    else if (mount === 'ceiling' || mount === 'down') { s = [x, y + 1, z]; face = 'down'; }
    else if (DIRS[mount]) { s = [x + DIRS[mount][0], y, z + DIRS[mount][1]]; face = OPP[mount]; }
    else throw new Error(`place: ${mount}? floor|ceiling|north|south|east|west`);
    await near(...s);
    return useOn(s.map(S), face, extra);
  }
  const faceYaw = async (d) => { if (!(d in YAW)) throw new Error('direction: north|south|east|west'); K.look(YAW[d], K.pitch()); return K.ticks(2); };

  // ---------- food: every food by name, held for as long as it takes to eat ----------
  for (const [food, t] of Object.entries(FOODS_EAT)) add('eat_' + food, async (a) => { await grab(food, 'eat_' + food); return K.act('use', [S(n(a[0], t))]); });

  // ---------- animals: breed / feed / tame / ride, each with what that mob really takes ----------
  async function feedOne(type, food, verb, e = mob(type)) {
    if (!e) { await say(verb, `no ${type} in view`); return null; }   // (not what say returns: the caller would report "gave <that>")
    const it = await grabAny(food, verb);
    await nearMob(e);
    // offered again while it does not take it (an ocelot that does not trust you yet, an animal that turned away): what is in hand
    // changes when it is taken (one less, or the bucket emptied)
    const sig = () => { const h = K.inv.slots[K.inv.selected]; return `${h?.network_id ?? 0}:${h?.count ?? 0}`; };
    for (let k = 0; k < 5; k++) {
      const before = sig();
      await K.hit(e, 'interact');
      for (let t = 0; t < 8 && sig() === before; t++) await K.ticks(1);
      if (sig() !== before || !K.all().includes(e)) break;
      await K.ticks(10); await nearMob(e);
    }
    return it;
  }
  for (const [type, food] of Object.entries(BREED)) add('breed_' + type, async (a) => {
    const two = K.nearest(type).slice(0, 2);
    if (two.length < 2) return say('breed_' + type, `fewer than 2 ${type} in view`);
    for (const e of two) { await feedOne(type, food, 'breed_' + type, e); await K.ticks(10); }
    return say('breed_' + type, `fed 2 ${type}`);
  });
  for (const [type, food] of Object.entries(FEED)) add('feed_' + type, async () => { const it = await feedOne(type, food, 'feed_' + type); return it ? say('feed_' + type, `gave ${it}`) : undefined; });
  for (const [type, how] of Object.entries(TAME)) add('tame_' + type, async (a) => {
    const v = 'tame_' + type, e = mob(type);
    if (!e) return say(v, `no ${type} in view`);
    K.clearEntityEvent(e);
    if (how === 'mount') {   // ride it until it stops throwing you off (hearts); an empty hand, or it would eat what you hold
      for (let k = 0; k < n(a[0], 6); k++) {
        await emptyHand(); await nearMob(e); await K.hit(e, 'interact');
        for (let t = 0; t < 10 && !K.riding(); t++) await K.ticks(1);   // on it (the link comes a tick later)
        for (let t = 0; t < n(a[1], 100) && K.riding() && K.entityEvent(e) !== 'tame_success'; t++) await K.ticks(1);
        if (K.entityEvent(e) === 'tame_success' || K.riding()) { if (K.riding()) await K.act('dismount', []); return say(v, 'tamed'); }
        await K.ticks(20);
      }
      return say(v, 'still wild (it keeps bucking: feed it sugar/apples first, or try again)');
    }
    const sneaky = /cat|ocelot/.test(type);   // cats and ocelots run from a person who does not creep up
    if (sneaky) K.controls.sneak = true;
    try {
      for (let k = 0; k < n(a[0], 12); k++) {
        await feedOne(type, how, v, e); await K.ticks(12);
        if (K.entityEvent(e) === 'tame_success') return say(v, `tamed after ${k + 1}`);
        if (!mob(type)) break;
      }
    } finally { if (sneaky) K.controls.sneak = false; }
    return say(v, 'no hearts yet');
  });
  for (const type of RIDE) add('ride_' + type, async () => {
    const v = 'ride_' + type, e = mob(type);
    if (!e) return say(v, `no ${type} in view`);
    await emptyHand(); await nearMob(e); await K.act('interact', [type]);
    for (let t = 0; t < 20 && !K.riding(); t++) await K.ticks(1);
    return say(v, K.riding() ? 'riding' : 'not riding (a pig/strider needs a saddle, a happy ghast a harness; some must be tamed first)');
  });
  // right-click the nearest <type> (or the one named in a[0]) with an item
  const withOn = (v, item, type) => async (a) => { const t = a[0] ?? type, e = mob(t); if (!e) return say(v, `no ${t} in view`); await grabAny(item, v); await nearMob(e); return K.hit(e, 'interact'); };
  addAll({
    unsaddle: withOn('unsaddle', 'shears', 'horse'), unharness: withOn('unharness', 'shears', 'happy_ghast'), unarmor: withOn('unarmor', 'shears', 'horse'),
    harness: async (a) => { const e = mob(a[0] ?? 'happy_ghast'); if (!e) return say('harness', 'no happy_ghast in view'); await grabAny(a[1] ? `${a[1]}_harness` : /_harness$/, 'harness'); await nearMob(e); return K.hit(e, 'interact'); },
    nautilus_armor: withOn('nautilus_armor', /_nautilus_armor$/, 'nautilus'),
    shulker_dye: async (a) => { const e = mob('shulker'); if (!e) return say('shulker_dye', 'no shulker in view'); await grabAny(a[0] ? a[0].replace(/_dye$/, '') + '_dye' : /_dye$/, 'shulker_dye'); await nearMob(e); return K.hit(e, 'interact'); },
    bribe_dolphin: withOn('bribe_dolphin', FISH, 'dolphin'), copper_golem_wax: withOn('copper_golem_wax', 'honeycomb', 'copper_golem'), copper_golem_scrape: withOn('copper_golem_scrape', /_axe$/, 'copper_golem'),
    wolf_armor_repair: withOn('wolf_armor_repair', 'armadillo_scute', 'wolf'), barter_hand: withOn('barter_hand', 'gold_ingot', 'piglin'),
    allay_take: async (a) => { const e = mob(a[0] ?? 'allay'); if (!e) return say('allay_take', 'no allay in view'); await emptyHand(); await nearMob(e); return K.hit(e, 'interact'); },
    lead_mob: async (a) => {   // lead_mob <mob> x z: leash it and walk it there (it follows the lead)
      const e = mob(a[0]); if (!e) return say('lead_mob', `no ${a[0]} in view`);
      await grabAny('lead', 'lead_mob'); await nearMob(e); await K.hit(e, 'interact');
      await go(+a[1], +a[2], 300);
      return say('lead_mob', `${a[0]} ${dEnt(e).toFixed(1)} blocks behind`);
    },
    milk_suspicious: async (a) => {   // a brown mooshroom fed a flower gives suspicious stew into a bowl
      const e = mob('mooshroom'); if (!e) return say('milk_suspicious', 'no mooshroom in view');
      await grabAny(a[0] ?? FLOWERS, 'milk_suspicious'); await nearMob(e); await K.hit(e, 'interact'); await K.ticks(10);
      await grabAny('bowl', 'milk_suspicious'); return K.hit(e, 'interact');
    },
    shoulder_parrot: async () => { const e = mob('parrot'); if (!e) return say('shoulder_parrot', 'no parrot in view'); await walkToward(() => [e.x, e.z], () => dEnt(e) < 0.6, 100); return K.ticks(10); },
    shear_all: async (a) => {
      const t = a[0] ?? 'sheep', list = K.nearest(t).filter((e) => dEnt(e) < n(a[1], 12)); let c = 0;
      for (const e of list) { await grabAny('shears', 'shear_all'); await nearMob(e); await K.hit(e, 'interact'); await K.ticks(6); c++; }
      return say('shear_all', `${c} ${t}`);
    },
    feed_all: async (a) => {
      const t = a[0], list = K.nearest(t).filter((e) => dEnt(e) < n(a[1], 12)); let c = 0;
      if (!FEED[t] && !a[2]) throw new Error(`feed_all <mob> [radius] [food]: no known food for ${t}`);
      for (const e of list) { await feedOne(t, a[2] ?? FEED[t], 'feed_all', e); await K.ticks(6); c++; }
      return say('feed_all', `${c} ${t}`);
    },
    breed_all: async (a) => {
      const t = a[0], list = K.nearest(t).filter((e) => dEnt(e) < n(a[1], 12)); let c = 0;
      if (!BREED[t]) throw new Error(`breed_all <mob>: ${t} does not breed with food`);
      for (const e of list.slice(0, list.length - (list.length % 2))) { await feedOne(t, BREED[t], 'breed_all', e); await K.ticks(8); c++; }
      return say('breed_all', `fed ${c} ${t} (${c / 2} pairs)`);
    },
    trade_buy: async (a) => trading('trade_buy', a[1], [a[0]]),     // trade_buy <item> [villager]: the offer that sells it
    trade_sell: async (a) => trading('trade_sell', a[1], ['pay', a[0]]),   // trade_sell <item>: the first offer that pays with it
    trade_all: async (a) => {   // trade_all [index] [villager]: the same trade until it sells out or you run out
      if (!(await openTrade('trade_all', a[1]))) return;
      let c = 0; for (; c < n(a[2], 12); c++) { const before = invSig(); await K.act('trade', [a[0] ?? '0']); await K.sync(); if (invSig() === before) break; }
      await K.act('close', []); return say('trade_all', `${c} trades`);
    },
    name_mob: async (a) => {   // name_mob <mob> x y z <name...>: write the name on a name tag at the anvil, then use it on the mob
      const [x, y, z] = nums(a, 1, 3), name = a.slice(4).join(' ') || 'Buddy';
      await near(x, y, z); await K.act('open', [S(x), S(y), S(z)]);
      if (K.screen() !== 'anvil') return say('name_mob', 'no anvil opened');
      const i = slotOf('name_tag'); if (i < 0) { await K.act('close', []); throw new Error('name_mob: needs a name_tag'); }
      await K.act('move', [S(i), 'box:0', '1']); await K.act('anvil', name.split(' ')); await K.act('close', []);
      const e = mob(a[0]); if (!e) return say('name_mob', `no ${a[0]} in view`);
      await grab('name_tag', 'name_mob'); await nearMob(e); return K.hit(e, 'interact');
    },
  });
  // the villager screen: walk up, right-click with an empty hand, wait for the offers
  async function openTrade(v, who) {
    const e = mob(who ?? 'villager') ?? mob('wandering_trader');
    if (!e) { say(v, 'no villager in view'); return false; }
    await emptyHand(); await nearMob(e); await K.hit(e, 'interact');
    for (let t = 0; t < 20 && K.screen() !== 'trading'; t++) await K.ticks(1);
    if (K.screen() !== 'trading') { say(v, 'no trade screen (a jobless villager or a baby does not trade)'); return false; }
    return true;
  }
  async function trading(v, who, args) { if (!(await openTrade(v, who))) return; await K.act('trade', args); return K.act('close', []); }

  // ---------- fighting: each hostile the way a person fights it ----------
  // shield raised = sneak with it in the offhand; drop the guard for the swing, raise it again
  async function shieldUp() { await K.sync(); if (!/shield/.test(nm(K.offhand())) && has('shield')) await V.offhand(['shield']); if (/shield/.test(nm(K.offhand()))) { K.controls.sneak = true; await K.ticks(4); return true; } return false; }
  // aim, and click once the crosshair rests on it (a small or moving mob, or a wall edge in the way, needs another look first);
  // true when the click landed on it, false for a swing at the air
  async function swingAt(e, aim) {
    const hs = aim === 'low' ? [0.4, 0.2, 0.9] : aim === 'up' ? [e.bh > 0 ? e.bh / 2 : 0.3, 0.15] : [e.bh > 0 ? e.bh / 2 : 0.8, e.bh > 0 ? e.bh * 0.25 : 0.3, 0.1];   // endermen: never the eyes
    for (const h of hs) {
      K.lookAt(e.x, e.y + h, e.z); await K.ticks(1);
      const c = K.crosshair();
      if (c?.kind === 'entity' && String(c.entity.id) === String(e.id)) { await K.act('attack', []); return true; }
    }
    await K.act('attack', []);   // what the crosshair is on, like a click
    return false;
  }
  async function brawl(v, type, hits, o = {}) {
    await bestWeapon();
    let c = 0;
    for (let k = 0; c < hits && k < hits * 3 + 3; k++) {   // hits that landed (a miss, or a mob that teleported away, is tried again)
      const e = mob(type); if (!e) break;
      if (o.throw && has(o.throw)) { await grab(o.throw, v); K.lookAt(e.x, e.y + 1, e.z); await K.act('use', []); await K.ticks(6); c++; continue; }
      const guard = o.shield ? await shieldUp() : false;
      await nearMob(e, o.up ? 3.5 : 2.6);
      if (guard) { K.controls.sneak = false; await K.ticks(2); }
      if (o.crit) { K.controls.jump = true; await K.ticks(2); K.controls.jump = false; await K.ticks(5); }
      if (await swingAt(e, o.low ? 'low' : o.up ? 'up' : null)) c++;
      if (o.back) { K.look(yawTo(e.x, e.z) + 180, 0); K.controls.forward = true; K.controls.sprint = true; await K.ticks(o.back); K.controls.forward = K.controls.sprint = false; }
      await K.ticks(o.all ? 8 : 12);   // the swing recharges (sword ~0.6 s)
    }
    K.controls.sneak = false;
    return say(v, `${c} hits${mob(type) ? '' : `, no ${type} left`}`);
  }
  for (const [type, o] of Object.entries(FOES)) add('fight_' + type, async (a) => {
    const v = 'fight_' + type;
    if (!o.deflect) return brawl(v, type, n(a[0], 20), o);
    // ghast: hit its fireball back when it comes close; shoot the ghast when a bow is carried
    let c = 0;
    for (let k = 0; k < n(a[0], 20); k++) {
      const fb = mob('fireball'), g = mob(type);
      if (!g) break;
      if (fb && dEnt(fb) < 4) { K.lookAt(fb.x, fb.y + 0.5, fb.z); await K.ticks(1); await K.act('attack', []); c++; }
      else if (has('bow')) { await grab('bow', v); K.lookAt(g.x, g.y + 2 + dEnt(g) * dEnt(g) * 0.003, g.z); await K.act('use', ['20']); c++; }
      else await K.ticks(10);
      await K.ticks(4);
    }
    return say(v, `${c} deflects/shots`);
  });
  const HOSTILE = Object.keys(FOES);
  addAll({
    fight_creaking: async (a) => {   // it cannot be hurt: break its creaking heart (the block that keeps it alive)
      const h = scan(/creaking_heart/, n(a[0], 24))[0];
      if (!h) { const e = mob('creaking'); if (e) K.lookAt(e.x, e.y + 1.2, e.z); return say('fight_creaking', 'no creaking heart known nearby (look at the creaking: it freezes)'); }
      await digAt(h[0], h[1], h[2]); return say('fight_creaking', `broke the heart at ${h[0]} ${h[1]} ${h[2]}`);
    },
    avoid_warden: async (a) => {   // do not fight it: creep away (sneaking makes no vibrations)
      const e = mob('warden'); if (e) K.look(yawTo(e.x, e.z) + 180, 0);
      K.controls.sneak = true; K.controls.forward = true; await K.ticks(n(a[0], 60)); K.controls.forward = K.controls.sneak = false;
      return say('avoid_warden', e ? `${dEnt(e).toFixed(1)} blocks away` : 'no warden in view');
    },
    fight_ender_dragon: async (a) => {   // the end crystals first (shot, or hit from a step away), then the dragon
      let c = 0;
      for (let k = 0; k < n(a[0], 12); k++) {
        const cr = mob('ender_crystal');
        if (cr && has('bow') && has('arrow')) { await grab('bow', 'fight_ender_dragon'); K.lookAt(cr.x, cr.y + 1, cr.z); await K.act('use', ['20']); c++; continue; }
        if (cr && dEnt(cr) < 5) { K.lookAt(cr.x, cr.y + 1, cr.z); await K.act('attack', []); c++; continue; }
        const d = mob('ender_dragon'); if (!d) break;
        if (dEnt(d) < 5) { await bestWeapon(); await swingAt(d); } else if (has('bow')) { await grab('bow', 'fight_ender_dragon'); K.lookAt(d.x, d.y + 2, d.z); await K.act('use', ['20']); } else await K.ticks(20);
        c++; await K.ticks(10);
      }
      return say('fight_ender_dragon', `${c} hits/shots`);
    },
    fight_any: async (a) => { const e = K.all().find((x) => HOSTILE.some((t) => K.isType(x, t))); if (!e) return say('fight_any', 'no hostile mob in view'); const t = HOSTILE.find((q) => K.isType(e, q)); return M['fight_' + t]([S(n(a[0], 20))]); },
    defend: async (a) => {   // stand guard: hit any hostile that comes within reach, for a while
      let c = 0; await bestWeapon();
      for (let k = 0; k < n(a[0], 200); k += 5) {
        const e = K.all().find((x) => HOSTILE.some((t) => K.isType(x, t)) && dEnt(x) < 3.2);
        if (e) { await swingAt(e); c++; await K.ticks(8); } else await K.ticks(5);
      }
      return say('defend', `${c} hits`);
    },
    hunt_food: async (a) => {   // the nearest food animal: kill it and pick up what it drops
      const e = K.all().find((x) => /:(cow|pig|sheep|chicken|rabbit|mooshroom|goat)$/.test(x.type));
      if (!e) return say('hunt_food', 'no food animal in view');
      const t = e.type.replace('minecraft:', '');
      await brawl('hunt_food', t, n(a[0], 10), {});
      return V.collect(['4']);
    },
    // ---- techniques ----
    sprint_hit: async (a) => {   // run at it and hit on arrival: extra knockback
      const e = mob(a[0]); if (!e) return say('sprint_hit', `no ${a[0]} in view`);
      await bestWeapon(); K.controls.sprint = true;
      await walkToward(() => [e.x, e.z], () => dEnt(e) < 2.8, 100); K.controls.sprint = true; K.controls.forward = true;
      await swingAt(e); K.controls.sprint = K.controls.forward = false; return K.ticks(4);
    },
    w_tap: async (a) => {   // hit, let go of forward for a moment, sprint in again: every hit a sprint hit
      const e0 = mob(a[0]); if (!e0) return say('w_tap', `no ${a[0]} in view`);
      await bestWeapon(); let c = 0;
      for (; c < n(a[1], 4); c++) {
        const e = mob(a[0]); if (!e) break;
        K.controls.sprint = true; await walkToward(() => [e.x, e.z], () => dEnt(e) < 2.8, 60); K.controls.forward = true; K.controls.sprint = true;
        await swingAt(e); K.controls.forward = false; K.controls.sprint = false; await K.ticks(3);
      }
      return say('w_tap', `${c} hits`);
    },
    spam_click: async (a) => {   // mash the button: fast swings that do not wait for the recharge (weak hits)
      const e = mob(a[0]); if (!e) return say('spam_click', `no ${a[0]} in view`);
      await nearMob(e, 2.6); let c = 0;
      for (; c < n(a[1], 8) && mob(a[0]); c++) { await swingAt(e); await K.ticks(1); }
      return say('spam_click', `${c} clicks`);
    },
    strafe_fight: async (a) => {   // circle it: strafe left and right between hits
      const e0 = mob(a[0]); if (!e0) return say('strafe_fight', `no ${a[0]} in view`);
      await bestWeapon(); let c = 0;
      for (; c < n(a[1], 6); c++) {
        const e = mob(a[0]); if (!e) break;
        await nearMob(e, 2.6); const side = c % 2 ? 'left' : 'right';
        K.controls[side] = true; K.lookAt(e.x, e.y + 0.8, e.z); await K.ticks(4); await swingAt(e); await K.ticks(6); K.controls[side] = false;
      }
      return say('strafe_fight', `${c} hits`);
    },
    kite: async (a) => {   // bow at range; back off when it gets close
      await grabAny('bow', 'kite'); let c = 0;
      for (; c < n(a[1], 3); c++) {
        const e = mob(a[0]); if (!e) break;
        if (dEnt(e) < 6) { K.lookAt(e.x, e.y + 1, e.z); K.controls.back = true; await K.ticks(12); K.controls.back = false; }
        K.lookAt(e.x, e.y + 1 + dEnt(e) * dEnt(e) * 0.003, e.z); await K.act('use', ['20']);
      }
      return say('kite', `${c} shots`);
    },
    axe_shield: async (a) => {   // an axe blow knocks a raised shield down for 5 s, then the sword
      const e = mob(a[0]); if (!e) return say('axe_shield', `no ${a[0]} in view`);
      const axe = bestOf('axe'); if (!axe) throw new Error(`axe_shield: needs an axe (console: give ${K.name} iron_axe)`);
      await grab(axe, 'axe_shield'); await nearMob(e, 2.6); await swingAt(e); await K.ticks(12);
      if (bestOf('sword')) { await grab(bestOf('sword'), 'axe_shield'); await swingAt(e); }
      return K.ticks(4);
    },
    mace_smash: async (a) => {   // fall onto it with the mace: launched by a wind charge when you have one, else a jump
      const e = mob(a[0]); if (!e) return say('mace_smash', `no ${a[0]} in view`);
      await nearMob(e, 2.2);
      if (has('wind_charge')) { await grab('wind_charge', 'mace_smash'); K.look(K.yaw(), 90); K.controls.jump = true; await K.act('use', []); K.controls.jump = false; }
      else { K.controls.jump = true; await K.ticks(2); K.controls.jump = false; }
      await grabAny('mace', 'mace_smash');
      let top = K.feet().y; for (let t = 0; t < 60; t++) { const y = K.feet().y; if (y < top - 0.3) break; top = Math.max(top, y); await K.ticks(1); }   // wait until falling
      return swingAt(e);
    },
    spear_jab: async (a) => { const e = mob(a[0]); if (!e) return say('spear_jab', `no ${a[0]} in view`); await grabAny(/_spear$/, 'spear_jab'); await nearMob(e, 3.5); return swingAt(e); },
    spear_charge: async (a) => {   // hold use and run at it: the charge hits with the speed you carry
      const e = mob(a[0]); if (!e) return say('spear_charge', `no ${a[0]} in view`);
      await grabAny(/_spear$/, 'spear_charge'); K.lookAt(e.x, e.y + 0.7, e.z);
      await K.act('use', ['hold']); K.controls.forward = K.controls.sprint = true;
      await walkToward(() => [e.x, e.z], () => dEnt(e) < 1.5, n(a[1], 30)); K.controls.forward = K.controls.sprint = true; await K.ticks(4);
      K.controls.forward = K.controls.sprint = false; return K.act('release', []);
    },
    crossbow_shoot: async (a) => { const e = mob(a[0]); if (!e) return say('crossbow_shoot', `no ${a[0]} in view`); await grabAny('crossbow', 'crossbow_shoot'); await K.act('use', ['26']); K.lookAt(e.x, e.y + 1, e.z); return K.act('use', []); },
    snipe: async (a) => {   // a full draw aimed over it, higher the farther it is (arrows drop)
      const e = mob(a[0]); if (!e) return say('snipe', `no ${a[0]} in view`);
      await grabAny('bow', 'snipe'); const d = dEnt(e); K.lookAt(e.x, e.y + 1 + d * d * 0.0028, e.z); return K.act('use', [S(n(a[1], 24))]);
    },
    hook_mob: async (a) => { const e = mob(a[0]); if (!e) return say('hook_mob', `no ${a[0]} in view`); await grabAny('fishing_rod', 'hook_mob'); K.lookAt(e.x, e.y + 1.5, e.z); await K.act('use', []); await K.ticks(n(a[1], 12)); return K.act('use', []); },   // cast at it, then reel: it is pulled in
    pearl_escape: async () => { const e = K.all().find((x) => HOSTILE.some((t) => K.isType(x, t))); await grabAny('ender_pearl', 'pearl_escape'); K.look(e ? yawTo(e.x, e.z) + 180 : K.yaw() + 180, -25); await K.ticks(2); return K.act('use', []); },
    dodge: async (a) => { const side = a[0] === 'left' ? 'left' : 'right'; K.controls[side] = true; K.controls.jump = true; await K.ticks(2); K.controls.jump = false; await K.ticks(4); K.controls[side] = false; return K.ticks(2); },
    shield_walk: async (a) => {   // walk up behind the raised shield, lower it only to swing
      const e = mob(a[0]); if (!e) return say('shield_walk', `no ${a[0]} in view`);
      await shieldUp(); await bestWeapon(); K.controls.sneak = true;
      await walkToward(() => [e.x, e.z], () => dEnt(e) < 2.6, 200);
      K.controls.sneak = false; await K.ticks(2); await swingAt(e); return K.ticks(4);
    },
  });

  // ---------- getting around: keys held like a person, stopping by what the server says the position is ----------
  const KEY = { forward: 'forward', back: 'back', left: 'left', right: 'right' };
  async function keysFor(dir, blocks, extra = {}) {
    const k = KEY[dir]; if (!k) throw new Error('direction: forward|back|left|right');
    const f0 = K.feet(); Object.assign(K.controls, { [k]: true, ...extra });
    for (let t = 0; t < blocks * 6 + 20; t++) { const f = K.feet(); if (Math.hypot(f.x - f0.x, f.z - f0.z) >= blocks - 0.1) break; await K.ticks(1); }
    K.controls[k] = false; for (const q of Object.keys(extra)) K.controls[q] = false;
    return K.ticks(2);
  }
  const hold = async (c, t) => { Object.assign(K.controls, c); await K.ticks(t); for (const q of Object.keys(c)) K.controls[q] = false; return K.ticks(2); };
  const turnTo = (yaw, pitch, t = 8) => { let dy = ((yaw - K.yaw()) % 360 + 540) % 360 - 180; return K.act('turn', [S(dy), S(pitch - K.pitch()), S(t)]); };
  addAll({
    walk_blocks: async (a) => keysFor(a[1] ?? 'forward', n(a[0], 5)),             // walk_blocks <n> [forward|back|left|right]
    jump_n: async (a) => { for (let k = 0; k < n(a[0], 3); k++) await K.act('jump', []); return K.ticks(1); },
    sneak_jump: async () => { K.controls.sneak = true; await K.ticks(3); await K.act('jump', []); K.controls.sneak = false; return K.ticks(3); },
    long_jump: async (a) => {   // long_jump x z: run up and jump across a gap toward it
      const [x, z] = nums(a, 0, 2); K.look(yawTo(x, z), 0); K.controls.forward = K.controls.sprint = true; await K.ticks(n(a[2], 6));
      K.controls.jump = true; await K.ticks(2); K.controls.jump = false;
      for (let t = 0; t < 30; t++) { const f = K.feet(); if (Math.hypot(x - f.x, z - f.z) < 0.8) break; await K.ticks(1); }
      K.controls.forward = K.controls.sprint = false; return K.ticks(4);
    },
    drop_down: async (a) => { const y0 = K.feet().y; K.controls.forward = true; for (let t = 0; t < n(a[0], 60) && K.feet().y > y0 - 0.5; t++) await K.ticks(1); K.controls.forward = false; return K.ticks(10); },   // walk off the edge
    circle: async (a) => { const r = n(a[0], 3), f = K.feet(), cx = f.x - r, cz = f.z; for (let k = 1; k <= 12 * n(a[1], 1); k++) { const th = (k / 12) * 2 * Math.PI, px = cx + r * Math.cos(th), pz = cz + r * Math.sin(th); await walkToward(() => [px, pz], () => Math.hypot(px - K.feet().x, pz - K.feet().z) < 0.6, 30); } return K.ticks(1); },
    square: async (a) => { const s = n(a[0], 4), f = K.feet(); for (let l = 0; l < n(a[1], 1); l++) for (const [dx, dz] of [[s, 0], [s, s], [0, s], [0, 0]]) { const px = f.x + dx, pz = f.z + dz; await walkToward(() => [px, pz], () => Math.hypot(px - K.feet().x, pz - K.feet().z) < 0.5, s * 8); } return K.ticks(1); },
    zigzag: async (a) => { const w = n(a[1], 2), y0 = K.yaw(); for (let k = 0; k < n(a[0], 4); k++) { K.look(y0 + (k % 2 ? 35 : -35), 0); K.controls.forward = true; await K.ticks(w * 5); } K.controls.forward = false; K.look(y0, 0); return K.ticks(2); },
    patrol: async (a) => { const [x1, z1, x2, z2] = nums(a, 0, 4); for (let k = 0; k < n(a[4], 2); k++) { await go(x1, z1); await go(x2, z2); } return K.ticks(1); },
    spin: async (a) => K.act('turn', [S(360 * n(a[0], 1)), '0', S(20 * n(a[0], 1))]),
    look_left: async () => K.act('turn', ['-90', '0', '6']), look_right: async () => K.act('turn', ['90', '0', '6']),
    look_at: async (a) => { const e = mob(a[0] ?? 'player'); if (!e) return say('look_at', `no ${a[0]} in view`); K.lookAt(e.x, e.y + (e.bh > 0 ? e.bh * 0.85 : 1.5), e.z); return K.ticks(2); },
    track: async (a) => { for (let t = 0; t < n(a[1], 40); t++) { const e = mob(a[0]); if (!e) return say('track', `lost ${a[0]}`); K.lookAt(e.x, e.y + (e.bh > 0 ? e.bh * 0.85 : 1.5), e.z); await K.ticks(1); } return K.ticks(1); },
    aim_at: async (a) => {   // aim_at x y z [ticks]: move the mouse onto a point smoothly
      const [x, y, z] = nums(a, 0, 3), e = eye(), dx = x - e.x, dy = y - e.y, dz = z - e.z;
      return turnTo((Math.atan2(-dx, dz) * 180) / Math.PI, (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI, n(a[3], 8));
    },
    climb_down: async (a) => { K.controls.forward = false; K.controls.sneak = false; K.look(K.yaw(), 60); await K.ticks(n(a[0], 40)); return K.ticks(1); },   // on a ladder: let go and slide
    surface: async (a) => {   // swim straight up until the head is out of the water
      K.look(K.yaw(), -60); K.controls.jump = true;
      for (let t = 0; t < n(a[0], 100); t++) { const f = K.feet(), b = blockAt(Math.floor(f.x), Math.floor(f.y + 1.62), Math.floor(f.z)); if (b && !/water/.test(b.name)) break; await K.ticks(1); }
      K.controls.jump = false; K.look(K.yaw(), 0); return K.ticks(2);
    },
    fly_up: async (a) => hold({ jump: true }, n(a[0], 20)), fly_down: async (a) => hold({ sneak: true }, n(a[0], 20)), fly_forward: async (a) => hold({ forward: true, sprint: true }, n(a[0], 20)),
    fly_to: async (a) => {   // fly_to x y z (creative): take off, then steer up/down and forward
      const [x, y, z] = nums(a, 0, 3); await K.act('fly', ['8']);   // (a take-off: a couple of ticks of jump were not one for the server)
      for (let t = 0; t < n(a[3], 400); t++) {
        const f = K.feet(); if (Math.hypot(x - f.x, y - f.y, z - f.z) < 0.8) break;
        K.look(yawTo(x, z), 0); K.controls.forward = Math.hypot(x - f.x, z - f.z) > 0.6; K.controls.jump = f.y < y - 0.4; K.controls.sneak = f.y > y + 0.4; await K.ticks(1);
      }
      Object.assign(K.controls, { forward: false, jump: false, sneak: false }); return K.ticks(2);
    },
    glide_to: async (a) => {   // glide_to x z: while gliding, steer toward it and keep a shallow dive
      const [x, z] = nums(a, 0, 2); let last = K.feet().y, still = 0;
      for (let t = 0; t < n(a[2], 300); t++) { const f = K.feet(); if (Math.hypot(x - f.x, z - f.z) < 2) break; K.look(yawTo(x, z), 15); if (Math.abs(f.y - last) < 0.01) { if (++still > 10) break; } else still = 0; last = f.y; await K.ticks(1); }
      return K.ticks(2);
    },
    elytra_takeoff: async () => { K.controls.jump = true; await K.ticks(2); K.controls.jump = false; await K.ticks(6); await K.act('glide', ['4']); if (has('firework_rocket')) await V.firework(); return K.ticks(2); },
    row_left: async (a) => K.act('walk', ['left', S(n(a[0], 10))]), row_right: async (a) => K.act('walk', ['right', S(n(a[0], 10))]), row_back: async (a) => K.act('walk', ['back', S(n(a[0], 20))]),
    // sail_to x z (in a boat): stop-turn-go. An oar alone turns the boat on the spot about 9 degrees a tick; which way an oar turns
    // it is learned on the water (measured on BDS it was not the same in every state), from the heading before and after the first
    // turn; the heading is read from the way it went over the last strokes
    sail_to: async (a) => {
      const [x, z] = nums(a, 0, 2), max = n(a[2], 600);
      let t = 0, hist = [], flip = null, probe = null;
      const tick = async () => { t++; await K.ticks(1); const f = K.feet(); hist.push(f); if (hist.length > 8) hist.shift(); };
      const heading = () => { const f = K.feet(); return hist.length >= 8 && Math.hypot(f.x - hist[0].x, f.z - hist[0].z) > 0.3 ? (Math.atan2(-(f.x - hist[0].x), f.z - hist[0].z) * 180) / Math.PI : null; };
      const wrap = (d) => ((d % 360) + 540) % 360 - 180;
      while (t < max) {
        const f = K.feet(); if (Math.hypot(x - f.x, z - f.z) < 1.5) break;
        const h = heading(), want = yawTo(x, z), diff = h === null ? 0 : wrap(want - h);
        if (probe && h !== null) { const turned = wrap(h - probe.h); if (Math.abs(turned) > 10) flip = (turned > 0) !== probe.cw; probe = null; }
        if (process.env.LAB_DEBUG) K.say(`dbg sail t=${t} at ${f.x.toFixed(1)},${f.z.toFixed(1)} h=${h === null ? '-' : h.toFixed(0)} want=${want.toFixed(0)} diff=${diff.toFixed(0)} flip=${flip}`);
        if (Math.abs(diff) > 15) {   // on the spot: one oar, then a few strokes straight to read the new heading
          const cw = diff > 0, k = (cw !== (flip ?? false)) ? 'right' : 'left';
          if (flip === null) probe = { h, cw: k === 'right' };   // (the first turn: which way did that oar go)
          K.controls.forward = false; for (let i = 0; i < 8; i++) await tick();   // (let it drift to a near stop: a turn under way is an arc)
          K.controls[k] = true;
          for (let i = 0; i < Math.min(24, Math.max(2, Math.round(Math.abs(diff) / 8))); i++) await tick();
          K.controls[k] = false; hist = [];
        }
        const d = Math.hypot(x - K.feet().x, z - K.feet().z);
        K.controls.forward = true;
        for (let i = 0; i < Math.max(8, Math.min(12, Math.round(d * 3))) && t < max; i++) { await tick(); if (Math.hypot(x - K.feet().x, z - K.feet().z) < 1.5) break; }
      }
      Object.assign(K.controls, { forward: false, left: false, right: false }); return K.ticks(2);
    },
    minecart_go: async (a) => hold({ forward: true }, n(a[0], 60)), horse_gallop: async (a) => hold({ forward: true, sprint: true }, n(a[0], 40)),
    camel_dash: async (a) => { K.controls.jump = true; await K.ticks(n(a[0], 10)); K.controls.jump = false; return K.ticks(10); },   // hold jump on a camel, let go: it dashes
    ghast_up: async (a) => hold({ jump: true }, n(a[0], 20)),   // riding a happy ghast: jump rises
    // (on all fours through a 1-block gap: straight at it, a path finder would want 2 blocks of headroom)
    crawl_through: async (a) => { const [x, z] = nums(a, 0, 2); await K.act('crawl', ['on']); await walkToward(() => [x, z], () => Math.hypot(K.feet().x - x, K.feet().z - z) < 0.3, 300); return K.act('crawl', ['off']); },
    scaffold_up: async (a) => hold({ jump: true }, n(a[0], 20)), scaffold_down: async (a) => hold({ sneak: true }, n(a[0], 20)),
    sneak_to: async (a) => { const [x, z] = nums(a, 0, 2); K.controls.sneak = true; try { await go(x, z, 400); } finally { K.controls.sneak = false; } return K.ticks(2); },
    // (each step read after the server's next word on where it is: the step down into the hole shows a few ticks late)
    dig_to_y: async (a) => { const y = n(a[0], -60); for (let k = 0; k < 64 && K.feet().y > y + 0.5; k++) { const y0 = K.feet().y; await V.stair_down(['1']); await K.ticks(8); if (K.feet().y >= y0) break; } return say('dig_to_y', `at y ${K.feet().y.toFixed(1)}`); },
    pillar_to: async (a) => { const up = Math.ceil(n(a[0], -58) - K.feet().y); if (up > 0) await V.pillar([S(up), ...(a[1] ? [a[1]] : [])]); return say('pillar_to', `at y ${K.feet().y.toFixed(1)}`); },
    explore: async (a) => { const f = K.feet(); K.memo.set('explore', [f.x, f.y, f.z]); const r = (Math.random() * 360 * Math.PI) / 180, d = n(a[0], 32); await go(f.x - Math.sin(r) * d, f.z + Math.cos(r) * d, d * 12); return say('explore', `went ${Math.hypot(K.feet().x - f.x, K.feet().z - f.z).toFixed(0)} blocks (goback explore returns)`); },
    goto_block: async (a) => { const h = scan(blockRe(a[0]), n(a[1], 24))[0]; if (!h) return say('goto_block', `no ${a[0]} known within ${n(a[1], 24)}`); await near(h[0], h[1], h[2], 2.5); return say('goto_block', `${a[0]} at ${h[0]} ${h[1]} ${h[2]}`); },
    return_spawn: async () => { const s = K.spawn(); if (!s) return say('return_spawn', 'spawn point not known'); await go(s.x + 0.5, s.z + 0.5, 800); return say('return_spawn', `${s.x} ${s.y} ${s.z}`); },
    goto_death: async () => { const d = K.lastDeath(); if (!d) return say('goto_death', 'no death yet'); await go(d.x, d.z, 800); return say('goto_death', `${d.x.toFixed(0)} ${d.y.toFixed(0)} ${d.z.toFixed(0)}`); },
    respawn_return: async () => { if (K.dead()) await K.act('respawn', []); return M.goto_death([]); },
    pearl_to: async (a) => {   // pearl_to x y z: throw an ender pearl on an arc that lands there
      const [x, y, z] = nums(a, 0, 3), e = eye(), d = Math.hypot(x + 0.5 - e.x, z + 0.5 - e.z), up = Math.atan2(y - e.y, d);
      await grabAny('ender_pearl', 'pearl_to'); K.look(yawTo(x + 0.5, z + 0.5), (-(0.5 * Math.asin(Math.min(1, 0.0133 * d)) + up) * 180) / Math.PI); await K.ticks(2); return K.act('use', []);
    },
    wind_jump: async () => { await grabAny('wind_charge', 'wind_jump'); K.look(K.yaw(), 90); K.controls.jump = true; await K.act('use', []); K.controls.jump = false; return K.ticks(10); },   // a wind charge at your feet as you jump
  });

  // ---------- commands a player types in chat (an operator): each answered in `cmd:` lines ----------
  for (const [k, c] of Object.entries(CMD)) add(k, () => K.act('cmd', c.split(' ')));
  // $1:ns = the argument with its namespace (a biome must be minecraft:plains, not plains)
  const fillIn = (t, a) => t.replace(/\$(\d):ns/g, (m, x) => { const v = a[+x - 1]; if (v === undefined) throw new Error(`needs argument ${x} (${t})`); return v.includes(':') ? v : `minecraft:${v}`; }).replace(/\$(\*\d?|\{\d:[^}]*\}|\d)/g, (m, x) => {
    if (x[0] === '*') return a.slice((+x.slice(1) || 1) - 1).join(' ');
    if (x[0] === '{') { const [i, d] = x.slice(1, -1).split(':'); return a[+i - 1] ?? d; }
    if (a[+x - 1] === undefined) throw new Error(`needs argument ${x} (${t})`);
    return a[+x - 1];
  }).trim();
  for (const [k, t] of Object.entries(CMDA)) add(k, (a) => K.act('cmd', fillIn(t, a).split(/\s+/)));
  // game rules as the world settings screen changes them (an operator's toggles): rule_<name> [on|off]
  for (const [k, r] of Object.entries(RULES)) add('rule_' + k, (a) => K.act('settings', [r, /^(off|false|0)$/.test(a[0] ?? '') ? 'false' : 'true']));
  add('rule_random_tick_speed', (a) => K.act('settings', ['randomtickspeed', S(n(a[0], 1))]));

  // ---------- people: body language a player uses ----------
  const EMOTES = ['4c8ae710-df2e-47cd-814d-cc7bf21a3d67', '42fde774-37d4-4422-b374-89ff13a6535a', '9a469a61-c83b-4ba9-b507-bdbe64430582', '17428c4c-3813-4ea1-b3a9-d6a32f83afca'];   // the 4 in EmoteList
  addAll({
    bow_head: async () => { const p0 = K.pitch(); await K.act('turn', ['0', S(60 - p0), '6']); await K.ticks(6); return K.act('turn', ['0', S(p0 - 60), '6']); },
    shake_head: async (a) => { for (let k = 0; k < n(a[0], 2); k++) { await K.act('turn', ['-35', '0', '3']); await K.act('turn', ['70', '0', '5']); await K.act('turn', ['-35', '0', '3']); } return K.ticks(1); },
    crouch_spam: async (a) => { for (let k = 0; k < n(a[0], 8); k++) { K.controls.sneak = true; await K.ticks(2); K.controls.sneak = false; await K.ticks(2); } return K.ticks(1); },
    celebrate: async () => { for (let k = 0; k < 2; k++) { K.controls.jump = true; await K.ticks(2); K.controls.jump = false; await K.act('swing', []); await K.ticks(6); } return K.act('emote', [EMOTES[0]]); },
    dance: async (a) => { for (let k = 0; k < n(a[0], 2); k++) { await K.act('turn', ['90', '0', '4']); K.controls.sneak = true; await K.ticks(3); K.controls.sneak = false; await K.act('jump', []); } return K.ticks(1); },
    point_at: async (a) => { await M.aim_at(a); return K.act('swing', []); },
    wave_arm: async (a) => { await M.look_at([a[0] ?? 'player']); for (let k = 0; k < 3; k++) await K.act('swing', []); return K.ticks(1); },
    emote_n: async (a) => K.act('emote', [EMOTES[(Math.max(1, n(a[0], 1)) - 1) % 4]]),
    chat_pos: async () => { const f = K.feet(); return K.act('chat', [`I'm at ${Math.floor(f.x)} ${Math.floor(f.y)} ${Math.floor(f.z)}`]); },
    wait_for: async (a) => {   // wait_for <player|mob> [seconds]: look around until it shows up
      for (let t = 0; t < n(a[1], 30) * 20; t += 5) { const e = mob(a[0]); if (e) { K.lookAt(e.x, e.y + 1.5, e.z); return say('wait_for', `${a[0]} is here`); } await K.ticks(5); }
      return say('wait_for', `${a[0]} did not come`);
    },
  });

  // ---------- staying alive: reflexes ----------
  addAll({
    eat_until_full: async () => {
      for (let k = 0; k < 10; k++) { await K.sync(); const f = K.attrs()['player.hunger']; if (f !== undefined && f >= 20) break; const food = H.FOODS.find((x) => has(x)); if (!food) return say('eat_until_full', 'no food'); await V.eat([food]); }
      return say('eat_until_full', `food ${K.attrs()['player.hunger'] ?? '?'}`);
    },
    escape_water: async () => {   // up for air, then swim to the nearest dry ground this client knows
      await M.surface(['60']);
      const [cx, cy, cz] = here(); let best = null;
      // footing level with the surface, a step up, or a few blocks down (a pool above the ground spills: its bank is lower)
      for (let r = 1; r <= 16 && !best; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const dy of [0, 1, 2, -1, -2, -3]) if (!best && (Math.abs(dx) === r || Math.abs(dz) === r) && K.canStand(cx + dx, cy + dy, cz + dz) && !/water/.test(nameAt(cx + dx, cy + dy, cz + dz))) best = [cx + dx + 0.5, cz + dz + 0.5];
      if (!best) { K.controls.jump = true; await hold({ forward: true, sprint: true }, 40); K.controls.jump = false; return say('escape_water', 'no dry ground known: swam ahead'); }
      K.controls.jump = true; await walkToward(() => best, () => Math.hypot(best[0] - K.feet().x, best[1] - K.feet().z) < 0.6, 200); K.controls.jump = false;
      return say('escape_water', 'ashore');
    },
    escape_lava: async () => {   // jump and get to the nearest safe footing (lava cells never count as one)
      const [cx, cy, cz] = here(); let best = null;
      for (let r = 1; r <= 4 && !best; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const dy of [0, 1]) if (!best && K.canStand(cx + dx, cy + dy, cz + dz)) best = [cx + dx + 0.5, cz + dz + 0.5];
      K.controls.jump = true;
      if (best) await walkToward(() => best, () => Math.hypot(best[0] - K.feet().x, best[1] - K.feet().z) < 0.5, 60);
      else await hold({ back: true }, 20);
      K.controls.jump = false;
      if (has('water_bucket')) await M.put_out_fire([]);
      return say('escape_lava', best ? 'out' : 'no safe footing known: backed off');
    },
    put_out_fire: async () => {   // water at your own feet, then scoop it back up
      const [x, y, z] = here();
      if (!has('water_bucket')) { const w = scan(/water/, 8)[0]; if (!w) return say('put_out_fire', 'no water bucket, no water known'); await go(w[0] + 0.5, w[2] + 0.5, 120); return say('put_out_fire', 'into the water'); }
      await grab('water_bucket', 'put_out_fire'); await useOn([x, y - 1, z].map(S), 'up'); await K.ticks(6);
      if (has('bucket')) { await grab('bucket', 'put_out_fire'); await useOn([x, y - 1, z].map(S), 'up'); }
      return K.ticks(2);
    },
    totem_ready: async () => V.offhand(['totem_of_undying']),
  });

  // ---------- what the player can see, one line each (an AI reads these before deciding) ----------
  const cardinal = () => ['south', 'west', 'north', 'east'][Math.round((((K.yaw() % 360) + 360) % 360) / 90) % 4];
  const DIMS = ['overworld', 'nether', 'the_end'];
  addAll({
    held: async () => { await K.sync(); const it = K.inv.slots[K.inv.selected]; return say('held', it?.network_id ? `${nm(it)}*${it.count} (slot ${K.inv.selected})` : `nothing (slot ${K.inv.selected})`); },
    count: async (a) => { await K.sync(); return say('count', `${a[0]} ${count(a[0])}`); },
    free_slots: async () => { await K.sync(); return say('free_slots', S([...Array(36).keys()].filter((i) => !K.inv.slots[i]?.network_id).length)); },
    worn: async () => { await K.sync(); return say('worn', `${['head', 'chest', 'legs', 'feet'].map((k, i) => `${k}:${nm(K.armor()[i]) || '-'}`).join(' ')} offhand:${nm(K.offhand()) || '-'}`); },
    xp: async () => say('xp', `level ${K.attrs()['player.level'] ?? '?'} progress ${Math.round((K.attrs()['player.experience'] ?? 0) * 100)}%`),
    effects: async () => { const e = K.effects(); return say('effects', e.length ? e.map((x) => `${x.name} ${x.amp + 1} ${x.secs}s`).join(', ') : 'none'); },
    clock: async () => { const t0 = K.time(), t = t0 === null ? null : Number(t0) + (process.env.LAB_WORLD === 'normal' && K.timeTick ? Number(K.tick() - K.timeTick()) : 0); if (t === null) return say('clock', 'time not known yet'); const d = ((t % 24000) + 24000) % 24000; return say('clock', `${d} ${d < 12000 ? 'day' : d < 13000 ? 'sunset' : d < 23000 ? 'night' : 'sunrise'} (day ${Math.floor(t / 24000)})`); },
    sky: async () => say('sky', K.weather()),
    where: async () => { const f = K.feet(); return say('where', `${f.x.toFixed(1)} ${f.y.toFixed(1)} ${f.z.toFixed(1)} ${DIMS[K.dim()] ?? K.dim()} facing ${cardinal()}`); },
    facing: async () => say('facing', `${cardinal()} (yaw ${K.yaw().toFixed(0)} pitch ${K.pitch().toFixed(0)})`),
    ground: async () => { const [x, y, z] = here(); return say('ground', `${nameAt(x, y - 1, z) || 'unknown'} at ${x} ${y - 1} ${z}${nameAt(x, y, z) && nameAt(x, y, z) !== 'air' ? ', standing in ' + nameAt(x, y, z) : ''}`); },
    scan_blocks: async (a) => { const c = new Map(); for (const [, , , b] of scan(() => true, n(a[0], 6))) { const k = b.name.replace('minecraft:', ''); c.set(k, (c.get(k) ?? 0) + 1); } return say('scan_blocks', [...c].sort((p, q) => q[1] - p[1]).slice(0, 20).map(([k, v]) => `${k}*${v}`).join(' ') || 'nothing known'); },
    find: async (a) => { const h = scan(blockRe(a[0]), n(a[1], 24)).slice(0, 3); return say('find', h.length ? h.map(([x, y, z, , d]) => `${a[0]}@${x},${y},${z} (${d.toFixed(0)})`).join(' ') : `no ${a[0]} known within ${n(a[1], 24)}`); },
    find_mob: async (a) => { const e = mob(a[0]); return say('find_mob', e ? `${a[0]}@${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)} (${dEnt(e).toFixed(1)})` : `no ${a[0]} in view`); },
    who: async () => say('who', K.players().join(' ') || 'nobody'),
    screen: async () => say('screen', K.screen() || 'none'),
    hotbar_list: async () => { await K.sync(); return say('hotbar_list', [...Array(9).keys()].map((i) => `${i}${i === K.inv.selected ? '*' : ''}:${nm(K.inv.slots[i]).replace('minecraft:', '') || '-'}`).join(' ')); },
    dimension: async () => say('dimension', DIMS[K.dim()] ?? S(K.dim())),
    recipe: async (a) => {   // what the server's crafting recipe needs (the recipe book, as text)
      const w = (a[0] ?? '').includes(':') ? a[0] : 'minecraft:' + a[0], r = K.recipesFor(w);
      return say('recipe', r.length ? r.slice(0, 3).map((x) => `${x.count} ${a[0]} <- ${x.ings.map((g) => `${g.count} ${g.tag ? '#' + g.tag.replace('minecraft:', '') : String(g.name).replace('minecraft:', '')}`).join(' + ')}${x.w > 2 || x.h > 2 || x.ings.reduce((s, g) => s + g.count, 0) > 4 ? ' (crafting table)' : ''}`).join(' | ') : `no crafting recipe for ${a[0]} known`);
    },
    recipes_all: async (a) => {   // every recipe the server sent, one line each: R <out>*<n>[:meta] <station> <w>x<h> <ingredient>*<n>...  ([word]: only lines with it)
      const all = K.allRecipes(), f = a[0] ? String(a[0]) : null, sh = (x) => String(x ?? '').replace('minecraft:', '');
      let c = 0;
      for (const r of all) {
        const line = `R ${sh(r.out)}*${r.count}${r.meta ? ':' + r.meta : ''} ${r.station} ${r.w}x${r.h} ${r.ings.map((g) => `${g.tag ? '#' + sh(g.tag) : sh(g.name) + (g.meta && g.meta !== 32767 ? ':' + g.meta : '')}*${g.count}`).join(' ')}`;
        if (!f || line.includes(f)) { K.say(line); c++; }
      }
      return say('recipes_all', `${c} of ${all.length} recipes`);
    },
    can_craft: async (a) => {
      await K.sync(); const w = (a[0] ?? '').includes(':') ? a[0] : 'minecraft:' + a[0], r = K.recipesFor(w);
      if (!r.length) return say('can_craft', `no crafting recipe for ${a[0]} known`);
      const miss = r[0].ings.filter((g) => g.name && count(g.name.replace('minecraft:', '')) < g.count * n(a[1], 1)).map((g) => `${g.count * n(a[1], 1) - count(g.name.replace('minecraft:', ''))} ${g.name.replace('minecraft:', '')}`);
      return say('can_craft', miss.length ? `no: missing ${miss.join(', ')}` : `yes${r[0].ings.some((g) => g.tag) ? ' (if the #tag items are there)' : ''}`);
    },
  });

  // ---------- the inventory: what a person does with the E screen and the hotbar ----------
  const armorSlot = (it) => H.ARMOR.find(([r]) => r.test(nm(it)))?.[1];
  addAll({
    drop_item: async (a) => { await K.sync(); const i = slotOf(a[0]); if (i < 0) return say('drop_item', `no ${a[0]}`); const it = K.inv.slots[i]; return K.act('drop', [S(Math.min(n(a[1], it.count), it.count)), S(i)]); },
    drop_everything: async () => {   // empty the whole inventory on the ground, worn things too
      await K.act('open', []); let c = 0;
      for (let i = 0; i < 36; i++) { const it = K.inv.slots[i]; if (it?.network_id) { await K.act('drop', [S(it.count), S(i)]); c++; } }
      for (const [k, i] of [['head', 0], ['chest', 1], ['legs', 2], ['feet', 3]]) if (K.armor()[i]?.network_id) { await K.act('drop', [S(K.armor()[i].count), k]); c++; }
      if (K.offhand()?.network_id) { await K.act('drop', [S(K.offhand().count), 'offhand']); c++; }
      await K.act('close', []); return say('drop_everything', `${c} stacks`);
    },
    keep_only: async (a) => {   // keep_only <item,item,...>: drop every other stack
      const keep = (a[0] ?? '').split(',').filter(Boolean).map(re); await K.sync(); await K.act('open', []); let c = 0;
      for (let i = 0; i < 36; i++) { const it = K.inv.slots[i]; if (it?.network_id && !keep.some((r) => r.test(nm(it)))) { await K.act('drop', [S(it.count), S(i)]); c++; } }
      await K.act('close', []); return say('keep_only', `dropped ${c} stacks`);
    },
    stack_up: async () => {   // merge half stacks of the same item (the fuller one takes the rest)
      await K.sync(); let c = 0;
      for (let i = 0; i < 36; i++) for (let j = i + 1; j < 36; j++) {
        const x = K.inv.slots[i], y = K.inv.slots[j];
        if (x?.network_id && y?.network_id && x.network_id === y.network_id && x.count < 64 && y.count < 64 && (x.extra?.has_nbt ?? 0) === 0) { await K.act('move', [S(j), S(i), S(Math.min(64 - x.count, y.count))]); await K.sync(); c++; }
      }
      return say('stack_up', `${c} merges`);
    },
    hotbar_setup: async (a) => {   // hotbar_setup <item,item,...>: those items into hotbar slots 0,1,2... (swapping out what is there)
      const want = (a[0] ?? '').split(','); let c = 0;
      for (let k = 0; k < Math.min(9, want.length); k++) {
        if (!want[k]) continue; await K.sync();
        const r = re(want[k]); if (r.test(nm(K.inv.slots[k]))) continue;
        const i = K.inv.slots.findIndex((it, q) => q !== k && (q >= want.length || q >= 9 || !re(want[q] || '^$').test(nm(it))) && r.test(nm(it)));
        if (i >= 0) { await K.act('swap', [S(i), S(k)]); c++; }
      }
      return say('hotbar_setup', `${c} moved`);
    },
    hotbar_tidy: async () => {   // the usual layout: weapon, pickaxe, axe, shovel, bow, blocks, water, food, torches
      await K.sync();
      const pick = [bestOf('sword') ?? bestOf('axe'), bestOf('pickaxe'), bestOf('axe'), bestOf('shovel'), carried('bow|crossbow|trident'), carried('cobblestone|dirt|oak_planks|stone|cobbled_deepslate|netherrack'), carried('water_bucket'), H.FOODS.find((x) => has(x)), carried('torch')];
      return M.hotbar_setup([pick.map((x) => x ?? '').join(',')]);
    },
    fill_hotbar: async (a) => { await K.sync(); let c = 0; for (let i = 9; i < 36; i++) { const it = K.inv.slots[i]; if (!it?.network_id || !re(a[0]).test(nm(it))) continue; const k = K.inv.slots.findIndex((x, q) => q < 9 && !x?.network_id); if (k < 0) break; await K.act('move', [S(i), S(k)]); await K.sync(); c++; } return say('fill_hotbar', `${c} stacks`); },
    restock_hand: async (a) => {   // the held stack is running low: top it up from the same item in the inventory
      await K.sync(); const h = K.inv.slots[K.inv.selected]; if (!h?.network_id) return say('restock_hand', 'hand is empty');
      if (h.count >= n(a[0], 16)) return say('restock_hand', `${h.count} in hand`);
      const i = K.inv.slots.findIndex((it, q) => q !== K.inv.selected && it?.network_id === h.network_id); if (i < 0) return say('restock_hand', 'no more of it');
      await K.act('move', [S(i), S(K.inv.selected), S(Math.min(64 - h.count, K.inv.slots[i].count))]); return say('restock_hand', 'topped up');
    },
    swap_hands: async () => {   // what is in the hand goes to the offhand and back (a swap when both hold something)
      await K.sync(); const main = K.inv.slots[K.inv.selected]?.network_id, off = K.offhand()?.network_id;
      if (!main && !off) return say('swap_hands', 'both hands empty');
      return K.act('move', main ? [S(K.inv.selected), 'offhand'] : ['offhand', S(K.inv.selected)]);
    },
    swap_elytra: async () => {   // elytra on for flying, the chestplate back on for fighting
      await K.sync(); const on = nm(K.armor()[1]);
      const other = /elytra/.test(on) ? K.inv.slots.findIndex((it) => /chestplate/.test(nm(it))) : slotOf('elytra');
      if (other < 0) return say('swap_elytra', /elytra/.test(on) ? 'no chestplate carried' : 'no elytra carried');
      return K.act('move', [S(other), 'chest']);
    },
    wear_gold: async () => { await K.sync(); let c = 0; for (let i = 0; i < 36; i++) { const it = K.inv.slots[i]; if (/golden_(helmet|chestplate|leggings|boots)/.test(nm(it))) { await K.act('move', [S(i), armorSlot(it)]); await K.sync(); c++; } } return say('wear_gold', `${c} pieces (piglins leave you alone)`); },
    armor_off: async () => { await K.sync(); let c = 0; for (const [k, i] of [['head', 0], ['chest', 1], ['legs', 2], ['feet', 3]]) if (K.armor()[i]?.network_id) { await V.unequip([k]); c++; } return say('armor_off', `${c} pieces`); },
    best_weapon: async () => { const w = await bestWeapon(); return say('best_weapon', w ?? 'no weapon: fists'); },
    tool_for: async (a) => { const [x, y, z] = nums(a, 0, 3); const t = await toolFor(x, y, z); return say('tool_for', `${nameAt(x, y, z) || 'unknown block'}: ${t ?? 'no idea (block not known)'}`); },
    put_all: async (a) => { const p = nums(a, 0, 3); await near(...p); await K.act('open', p.map(S)); if (!K.box()) return say('put_all', 'nothing opened'); let c = 0; for (let i = 0; i < 36; i++) if (K.inv.slots[i]?.network_id) { await K.act('quick', [S(i)]); c++; } await K.act('close', []); return say('put_all', `${c} stacks`); },
    load_furnace: async (a) => {   // load_furnace x y z <item> [fuel]: fill it and walk away (take_output later)
      const p = nums(a, 0, 3); await near(...p); await K.act('open', p.map(S)); if (!/furnace|smoker/.test(K.screen())) return say('load_furnace', 'no furnace opened');
      const i = slotOf(a[3]); if (i >= 0) await K.act('move', [S(i), 'box:0']);
      const f = a[4] ?? carried(FUEL); if (f && slotOf(f) >= 0) await K.act('move', [S(slotOf(f)), 'box:1']);
      return K.act('close', []);
    },
    bundle_fill: async (a) => { await K.sync(); const b = slotOf('bundle'), i = slotOf(a[0]); if (b < 0 || i < 0) throw new Error(`bundle_fill: needs a bundle and ${a[0]}`); return K.act('move', [S(i), 'bundle:' + b, ...(a[1] ? [a[1]] : [])]); },
    bundle_empty: async () => { await K.sync(); const b = slotOf('bundle'); if (b < 0) throw new Error('bundle_empty: needs a bundle'); for (let k = 0; k < 16; k++) { const f = firstEmpty(); if (f < 0) break; const before = invSig(); await K.act('move', ['bundle:' + b, S(f)]); await K.sync(); if (invSig() === before) break; } return K.ticks(1); },
    wear_quick: async (a) => { await grabAny(a[0] ?? /helmet|chestplate|leggings|boots|elytra|carved_pumpkin/, 'wear_quick'); return K.act('use', []); },   // right-click armor in hand: it goes on
    creative_hotbar: async (a) => { for (const it of (a[0] ?? '').split(',').filter(Boolean).slice(0, 9)) await K.act('creative', [it, S(n(a[1], 1))]); return K.ticks(1); },
    creative_place: async (a) => { await K.act('creative', [a[0], '1']); await K.sync(); if (!has(a[0])) return say('creative_place', `no ${a[0]} from the creative menu (creative mode?)`); return V.place(a); },
  });

  // ---------- crafting from what you carry: intermediates first (planks, sticks ...), a crafting table when the recipe needs 3x3 ----------
  const woodOf = () => { const it = K.inv.slots.find((x) => /_(planks|log|stem|wood|hyphae)$/.test(nm(x))); const m = it && /(?:stripped_)?(\w+?)_(planks|log|stem|wood|hyphae)$/.exec(nm(it).replace('minecraft:', '')); return m ? m[1] : 'oak'; };
  const plankOf = (log) => { const m = /(?:stripped_)?(\w+?)_(log|wood|stem|hyphae)$/.exec(log.replace('minecraft:', '')); return m ? `${m[1]}_planks` : /bamboo_block/.test(log) ? 'bamboo_planks' : null; };
  const bigRecipe = (r) => r.w > 2 || r.h > 2 || r.ings.reduce((s, g) => s + g.count, 0) > 4;
  async function tableNear(v) {   // a crafting table in reach: one this client knows, else the one carried, set down next to you
    if (K.screen() === 'workbench') return true;
    let t = scan(/crafting_table$/, 6)[0];
    if (!t && has('crafting_table')) { const s = spotNextTo(); await putAt('crafting_table', ...s); await K.ticks(4); t = [...s]; }
    if (!t) return false;
    await near(t[0], t[1], t[2]); await K.act('open', [S(t[0]), S(t[1]), S(t[2])]);
    return K.screen() === 'workbench';
  }
  // a free spot beside you with a floor under it (what you would look at to set a block down)
  function spotNextTo() {
    const [x, y, z] = here(), r = (K.yaw() * Math.PI) / 180, fx = Math.round(-Math.sin(r)), fz = fx ? 0 : Math.round(Math.cos(r));
    for (const [dx, dz] of [[fx, fz], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = blockAt(x + dx, y, z + dz), u = blockAt(x + dx, y - 1, z + dz); if ((!b || isAir(b)) && (!u || solid(u))) return [x + dx, y, z + dz]; }
    return [x + fx, y, z + fz];
  }
  async function make(v, want, times = 1, depth = 0) {
    const id = want.includes(':') ? want : 'minecraft:' + want, short = id.replace('minecraft:', '');
    await K.sync(); const before = count(short), rs = K.recipesFor(id);
    if (!rs.length) return false;
    // the recipe to go by: the one with the least missing (a bed from wool and planks, not a white bed dyed black)
    const have = (g) => (g.tag ? (/planks/.test(g.tag) ? count(/_planks$/) : Infinity) : count(String(g.name).replace('minecraft:', '')));
    const missing = (r) => r.ings.reduce((a, g) => a + Math.max(0, g.count * times - have(g)), 0);
    const rs2 = [...rs].sort((p, q) => missing(p) - missing(q) || bigRecipe(p) - bigRecipe(q));
    // in the 2x2 grid when a small recipe will do, else at a table (the one in reach, or the one carried set down)
    const attempt = async () => {
      if (K.screen() !== 'workbench' && !bigRecipe(rs2[0])) { await K.act('craft', [short, S(times)]); await K.sync(); if (count(short) > before) return true; }
      if (!rs2.some(bigRecipe) && K.screen() !== 'workbench') return false;
      if (!(await tableNear(v))) { say(v, `${short} needs a crafting table (carry one, or stand near one)`); return false; }
      await K.act('craft', [short, S(times)]); await K.sync();
      return count(short) > before;
    };
    if (await attempt()) return true;
    if (depth >= 2) return false;
    let made = false;
    for (const g of rs2[0].ings) {   // what is short is often craftable itself: make that first, then try again
      const need = g.count * times;
      if (g.tag) {
        if (/planks/.test(g.tag) && count(/_planks$/) < need) { const log = K.inv.slots.map(nm).find((x) => plankOf(x)); if (log) made = (await make(v, plankOf(log), Math.ceil((need - count(/_planks$/)) / 4), depth + 1)) || made; }
        continue;
      }
      const s = String(g.name).replace('minecraft:', ''), h = count(s);
      if (h < need && K.recipesFor(g.name).length) made = (await make(v, s, Math.ceil((need - h) / (K.recipesFor(g.name)[0].count || 1)), depth + 1)) || made;
    }
    if (!made) return false;
    return attempt();
  }
  async function makeVerb(v, item, times) { const ok = await make(v, item, times); if (K.screen() === 'workbench') await K.act('close', []); return say(v, ok ? `made ${item}` : `could not make ${item} (recipe <item> shows what it needs)`); }
  for (const [k, spec] of Object.entries(MAKE)) add('make_' + k, async (a) => makeVerb('make_' + k, typeof spec === 'function' ? spec(woodOf()) : spec, n(a[0], 1)));
  add('make', async (a) => makeVerb('make', a[0], n(a[1], 1)));
  add('make_planks', async (a) => { await K.sync(); const log = K.inv.slots.map(nm).find((x) => plankOf(x)); if (!log) throw new Error(`make_planks: needs logs (console: give ${K.name} oak_log)`); return makeVerb('make_planks', plankOf(log), n(a[0], 1)); });
  // tools and armor: the best material you carry enough of
  const HEADS = { pickaxe: 3, axe: 3, shovel: 1, sword: 2, hoe: 2, helmet: 5, chestplate: 8, leggings: 7, boots: 4 };
  const MATS = [['diamond', 'diamond'], ['iron', 'iron_ingot'], ['copper', 'copper_ingot'], ['golden', 'gold_ingot'], ['stone', 'cobblestone|cobbled_deepslate|blackstone'], ['wooden', '_planks|_log|_stem'], ['leather', 'leather']];
  // how much of a material is carried, counting logs as the 4 planks they make
  const matCount = (m) => alts(m).reduce((t, x) => t + (x.startsWith('_') ? count(new RegExp(x + '$')) * (x === '_planks' ? 1 : 4) : count(x)), 0);
  const matFor = (kind) => MATS.filter(([t]) => (/helmet|chestplate|leggings|boots/.test(kind) ? !/stone|wooden/.test(t) : t !== 'leather')).find(([, m]) => matCount(m) >= HEADS[kind])?.[0];
  for (const kind of Object.keys(HEADS)) add('make_' + kind, async () => { await K.sync(); const t = matFor(kind); if (!t) return say('make_' + kind, `not enough of any material for a ${kind}`); return makeVerb('make_' + kind, `${t}_${kind}`, 1); });
  const makeSet = async (v, t, kinds) => { const got = []; for (const k of kinds) if (await make(v, `${t}_${k}`, 1)) got.push(k); if (K.screen() === 'workbench') await K.act('close', []); return say(v, got.length ? `made ${t} ${got.join(' ')}` : `made nothing (needs ${t} material and sticks)`); };
  add('make_tools', async (a) => makeSet('make_tools', a[0] ?? 'wooden', ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']));   // make_tools [wooden|stone|copper|iron|golden|diamond]
  add('make_armor', async (a) => makeSet('make_armor', a[0] ?? 'iron', ['helmet', 'chestplate', 'leggings', 'boots']));      // make_armor [leather|copper|iron|golden|diamond]

  // ---------- furnaces: find one (or set yours down), load it, wait, take the result ----------
  const FUEL = 'coal|charcoal|coal_block|blaze_rod|lava_bucket|dried_kelp_block|oak_log|spruce_log|birch_log|jungle_log|acacia_log|dark_oak_log|cherry_log|mangrove_log|oak_planks|spruce_planks|birch_planks|stick|bamboo';
  const BURNS = { coal: 8, charcoal: 8, coal_block: 80, blaze_rod: 12, lava_bucket: 100, dried_kelp_block: 20, stick: 0.5, bamboo: 0.25 };
  async function furnaceAt(v, a, kind = /(^|:)(lit_)?(furnace|smoker|blast_furnace)$/) {   // [x y z] given, a known one within 8, or the one carried set down
    if (a.slice(0, 3).every((x) => /^-?\d+$/.test(x ?? ''))) return a.slice(0, 3).map(Number);
    const f = scan(kind, 8)[0]; if (f) return f.slice(0, 3);
    const c = carried('furnace|smoker|blast_furnace'); if (!c) return null;
    const s = spotNextTo(); await putAt(c, ...s); await K.ticks(4); return s;
  }
  async function cook(v, item, a) {
    const pos = await furnaceAt(v, a); if (!pos) return say(v, 'no furnace known nearby or carried');
    const rest = a.slice(a.slice(0, 3).every((x) => /^-?\d+$/.test(x ?? '')) ? 3 : 0);
    await K.sync(); const si = slotOf(item); if (si < 0) throw new Error(`${v}: needs ${String(item).replace(/[()|^$:\\]/g, '')} (console: give ${K.name} ${typeof item === 'string' ? item : 'oak_log'})`);
    const cnt = Math.min(n(rest[0], 1), K.inv.slots[si].count);
    await near(...pos); await K.act('open', pos.map(S));
    if (!/furnace|smoker/.test(K.screen())) return say(v, 'no furnace opened');
    await K.act('move', [S(si), 'box:0', S(cnt)]);
    if (!K.box()?.slots?.[1]?.network_id) { const f = carried(FUEL); if (f) await K.act('move', [S(slotOf(f)), 'box:1', S(Math.min(64, Math.ceil(cnt / (BURNS[f] ?? 1.5))))]); else say(v, 'no fuel carried'); }
    const per = /blast|smoker/.test(K.screen()) ? 105 : 210;
    for (let t = 0; t < cnt * per + 20 && (K.box()?.slots?.[2]?.count ?? 0) < cnt; t++) await K.ticks(1);
    const got = K.box()?.slots?.[2]?.count ?? 0;
    if (got) await K.act('quick', ['box:2']);
    await K.act('close', []);
    return say(v, `${got} out`);
  }
  for (const [k, item] of Object.entries(SMELT)) add(k, async (a) => cook(k, item, a));
  addAll({
    smelt_ores: async (a) => { await K.sync(); const ores = ['raw_iron', 'raw_gold', 'raw_copper', 'ancient_debris'].filter((x) => has(x)); if (!ores.length) return say('smelt_ores', 'no raw ores carried'); for (const o of ores) await cook('smelt_ores', o, [...a.slice(0, 3), S(count(o))]); return K.ticks(1); },
    cook_meat: async (a) => { await K.sync(); const raw = ['beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon', 'potato', 'kelp'].filter((x) => has(x)); if (!raw.length) return say('cook_meat', 'nothing raw carried'); for (const r of raw) await cook('cook_meat', r, [...a.slice(0, 3), S(count(r))]); return K.ticks(1); },
  });

  // ---------- brewing: water bottles in, each ingredient in turn, the fuel topped up ----------
  async function brewChain(v, steps, a) {
    const pos = a.slice(0, 3).every((x) => /^-?\d+$/.test(x ?? '')) ? a.slice(0, 3).map(Number) : scan(/brewing_stand$/, 8)[0]?.slice(0, 3);
    if (!pos) return say(v, 'no brewing stand known nearby');
    await near(...pos); await K.act('open', pos.map(S));
    if (!/brewing/.test(K.screen())) return say(v, 'no brewing stand opened');
    for (const k of [1, 2, 3]) if (!K.box()?.slots?.[k]?.network_id) { const i = slotOf(/(^|:)(potion|splash_potion|lingering_potion)$/); if (i >= 0) await K.act('move', [S(i), 'box:' + k, '1']); }
    if (!K.box()?.slots?.[4]?.network_id && has('blaze_powder')) await K.act('move', [S(slotOf('blaze_powder')), 'box:4', '1']);
    let done = 0;
    for (const ing of steps) {
      const i = slotOf(ing); if (i < 0) { say(v, `missing ${ing}`); break; }
      await K.act('move', [S(i), 'box:0', '1']);
      for (let t = 0; t < 440 && K.box()?.slots?.[0]?.network_id; t++) await K.ticks(1);   // 20 s a brew; the ingredient is used up at the end
      done++;
    }
    for (const k of [1, 2, 3]) if (K.box()?.slots?.[k]?.network_id) await K.act('quick', ['box:' + k]);
    await K.act('close', []);
    return say(v, `${done}/${steps.length} steps`);
  }
  for (const [k, steps] of Object.entries(POTIONS)) add('brew_' + k, async (a) => brewChain('brew_' + k, steps, a));
  for (const [k, ing] of Object.entries(MODS)) add(k, async (a) => brewChain(k, [ing], a));

  // ---------- workstations: the errand from walking up to closing the screen ----------
  async function openAt(v, a, want) {
    const p = nums(a, 0, 3); await near(...p); await K.act('open', p.map(S));
    if (!want.test(K.screen())) { if (K.screen()) await K.act('close', []); say(v, `no ${want.source.replace(/[\\^$()]/g, '').replace(/\|/g, '/')} screen at ${p.join(' ')}`); return false; }
    return true;
  }
  async function putIn(v, what, to, cnt) { await K.sync(); const i = slotOf(what); if (i < 0) { await K.act('close', []); throw new Error(`${v}: needs ${String(what).replace(/[()|^$:\\]/g, ' ').trim()}`); } return K.act('move', [S(i), to, ...(cnt ? [S(cnt)] : [])]); }
  const REPAIR = [[/netherite_/, 'netherite_ingot'], [/diamond_/, 'diamond'], [/iron_|chainmail_/, 'iron_ingot'], [/golden_/, 'gold_ingot'], [/copper_/, 'copper_ingot'], [/stone_/, 'cobblestone'], [/wooden_|shield/, '_planks'], [/leather_/, 'leather'], [/turtle_helmet/, 'turtle_scute'], [/elytra/, 'phantom_membrane'], [/mace/, 'breeze_rod']];
  addAll({
    enchant_item: async (a) => {   // enchant_item <item> x y z [0-2]: item + lapis on the table, the option (default: the strongest shown)
      if (!(await openAt('enchant_item', a.slice(1), /enchant/))) return;
      await putIn('enchant_item', a[0], 'box:0', 1); if (has('lapis_lazuli')) await putIn('enchant_item', 'lapis_lazuli', 'box:1', Math.min(3, count('lapis_lazuli')));
      for (let t = 0; t < 20 && !K.enchantOptions().length; t++) await K.ticks(1);
      const o = K.enchantOptions(); if (!o.length) { await K.act('close', []); return say('enchant_item', 'no options (needs lapis, levels, and bookshelves for more)'); }
      await K.act('enchant', [S(Math.min(n(a[4], o.length - 1), o.length - 1))]); return K.act('close', []);
    },
    rename_item: async (a) => { if (!(await openAt('rename_item', a.slice(1), /anvil/))) return; await putIn('rename_item', a[0], 'box:0', 1); await K.act('anvil', a.slice(4).length ? a.slice(4) : ['Named']); return K.act('close', []); },
    repair_item: async (a) => {   // repair_item <item> x y z [material]: the material it is made of (iron ingots for iron ...)
      if (!(await openAt('repair_item', a.slice(1), /anvil/))) return;
      const mat = a[4] ?? REPAIR.find(([r]) => r.test(a[0]))?.[1] ?? a[0];
      await putIn('repair_item', a[0], 'box:0', 1); await putIn('repair_item', mat.startsWith('_') ? new RegExp(mat + '$') : mat, 'box:1', Math.min(4, count(mat.startsWith('_') ? new RegExp(mat + '$') : mat)));
      await K.act('anvil', []); return K.act('close', []);
    },
    combine_items: async (a) => { if (!(await openAt('combine_items', a.slice(1), /anvil/))) return; await putIn('combine_items', a[0], 'box:0', 1); await putIn('combine_items', a[0], 'box:1', 1); await K.act('anvil', []); return K.act('close', []); },
    apply_book: async (a) => { if (!(await openAt('apply_book', a.slice(1), /anvil/))) return; await putIn('apply_book', a[0], 'box:0', 1); await putIn('apply_book', 'enchanted_book', 'box:1', 1); await K.act('anvil', []); return K.act('close', []); },
    disenchant: async (a) => { if (!(await openAt('disenchant', a.slice(1), /grindstone/))) return; await putIn('disenchant', a[0], 'box:0', 1); await K.act('grind', []); return K.act('close', []); },
    grind_repair: async (a) => { if (!(await openAt('grind_repair', a.slice(1), /grindstone/))) return; await putIn('grind_repair', a[0], 'box:0', 1); await putIn('grind_repair', a[0], 'box:1', 1); await K.act('grind', []); return K.act('close', []); },
    stonecut: async (a) => { if (!(await openAt('stonecut', a.slice(2), /stonecutter/))) return; await putIn('stonecut', a[0], 'box:0', 1); await K.act('cut', [a[1]]); return K.act('close', []); },   // stonecut <input> <output> x y z
    netherite_upgrade: async (a) => {
      if (!(await openAt('netherite_upgrade', a.slice(1), /smithing/))) return;
      await putIn('netherite_upgrade', a[0], 'box:0', 1); await putIn('netherite_upgrade', 'netherite_ingot', 'box:1', 1); await putIn('netherite_upgrade', 'netherite_upgrade_smithing_template', 'box:2', 1);
      await K.act('smith', []); return K.act('close', []);
    },
    trim_armor: async (a) => {   // trim_armor <armor> <template> <material> x y z
      if (!(await openAt('trim_armor', a.slice(3), /smithing/))) return;
      await putIn('trim_armor', a[0], 'box:0', 1); await putIn('trim_armor', a[2], 'box:1', 1); await putIn('trim_armor', a[1].endsWith('_smithing_template') ? a[1] : `${a[1]}_armor_trim_smithing_template`, 'box:2', 1);
      await K.act('smith', []); return K.act('close', []);
    },
    banner_pattern: async (a) => {   // banner_pattern <pattern id> x y z [dye]: banner + dye on the loom (the pattern item too when it needs one)
      if (!(await openAt('banner_pattern', a.slice(1), /loom/))) return;
      await putIn('banner_pattern', 'banner', 'box:0', 1); await putIn('banner_pattern', a[4] ? a[4].replace(/_dye$/, '') + '_dye' : /_dye$/, 'box:1', 1);
      if (has(/_banner_pattern$/)) await putIn('banner_pattern', /_banner_pattern$/, 'box:2', 1);
      await K.act('loom', [a[0] ?? 'bo']); return K.act('close', []);
    },
    beacon_power: async (a) => {   // beacon_power <effect> x y z [second effect]: pay with an ingot/emerald/diamond
      if (!(await openAt('beacon_power', a.slice(1), /beacon/))) return;
      await putIn('beacon_power', 'iron_ingot|gold_ingot|emerald|diamond|netherite_ingot'.split('|').find((x) => has(x)) ?? 'iron_ingot', 'box:0', 1);
      await K.act('beacon', [a[0] ?? 'speed', ...(a[4] ? [a[4]] : [])]); return K.act('close', []);
    },
    write_book: async (a) => { await grabAny('writable_book', 'write_book'); await K.act('book', ['write', '0', ...(a.slice(1).length ? a.slice(1) : ['...'])]); return K.act('book', ['sign', a[0] ?? 'Notes']); },   // write_book <title> <text...>
    read_lectern: async (a) => { const [x, y, z] = nums(a, 0, 3); await near(x, y, z); await emptyHand(); await useOn([x, y, z].map(S)); for (let p = 1; p < n(a[3], 2); p++) await K.act('lectern', [S(x), S(y), S(z), S(p), S(n(a[3], 2))]); return K.act('close', []); },
    write_sign: async (a) => {   // write_sign <sign item> x y z <text...>: set it on the ground there and write (| = new line)
      const [x, y, z] = nums(a, 1, 3); await putAt(a[0], x, y, z, 'floor');
      for (let t = 0; t < 20 && K.screen() !== 'sign'; t++) await K.ticks(1);
      return K.act('sign', a.slice(4).length ? a.slice(4) : ['Hello']);
    },
    write_hanging_sign: async (a) => { const [x, y, z] = nums(a, 1, 3); await putAt(a[0], x, y, z, 'ceiling'); for (let t = 0; t < 20 && K.screen() !== 'sign'; t++) await K.ticks(1); return K.act('sign', a.slice(4).length ? a.slice(4) : ['Shop']); },
  });
  for (const [k, ins] of Object.entries(MAPS)) add(k, async (a) => {   // the cartography table: what goes in the two slots decides the map
    if (!(await openAt(k, a, /cartography/))) return;
    for (const [i, it] of ins.entries()) await putIn(k, it, 'box:' + i, 1);
    await K.act('carto', []); return K.act('close', []);
  });

  // ---------- farming: plant each crop where it grows, harvest only what is ripe ----------
  const flowerRe = new RegExp(`(^|:)(${FLOWERS})$`);
  for (const [k, [item, how]] of Object.entries(CROPS)) add('plant_' + k, async (a) => {   // plant_<crop> x y z: the block it goes on (the log for cocoa, the ceiling for glow berries)
    const [x, y, z] = nums(a, 0, 3); await grabAny(item === 'FLOWER' ? flowerRe : item, 'plant_' + k); await near(x, y, z);
    return useOn([x, y, z].map(S), how === 'side' ? (a[3] ?? 'north') : how === 'down' ? 'down' : 'up');
  });
  const ripe = (b) => { const k = b.name.replace('minecraft:', ''); if (!(k in RIPE)) return false; const r = RIPE[k]; return !r || (b.states?.[r[0]] ?? 0) >= r[1]; };
  const area = (a, i = 0) => { const [x1, z1, x2, z2] = H.box2(a, i); const out = []; for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push([x, z]); return out; };
  addAll({
    harvest_ripe: async (a) => { const y = n(a[4], -60); let c = 0; for (const [x, z] of area(a)) { const b = blockAt(x, y, z); if (b && ripe(b)) { await digAt(x, y, z); c++; } } return say('harvest_ripe', `${c} ripe`); },   // x1 z1 x2 z2 y
    farm_cycle: async (a) => {   // farm_cycle <seed> x1 z1 x2 z2 y: harvest what is ripe and plant the seed again in its place
      const y = n(a[5], -60); let c = 0;
      for (const [x, z] of area(a, 1)) { const b = blockAt(x, y, z); if (b && ripe(b)) { await digAt(x, y, z); await K.ticks(4); await grabAny(a[0], 'farm_cycle'); await useOn([x, y - 1, z].map(S), 'up'); c++; } }
      return say('farm_cycle', `${c} replanted`);
    },
    harvest_tall: async (a) => { const y = n(a[4], -60); let c = 0; for (const [x, z] of area(a)) if (/reeds|bamboo|cactus|kelp/.test(nameAt(x, y + 1, z))) { await digAt(x, y + 1, z); c++; } return say('harvest_tall', `${c} cut above the base`); },   // sugar cane, bamboo, cactus, kelp: the base stays
    harvest_berries: async (a) => { const y = n(a[4], -60); let c = 0; await emptyHand(); for (const [x, z] of area(a)) { const b = blockAt(x, y, z); if (b && ((/sweet_berry_bush/.test(b.name) && (b.states?.growth ?? 0) >= 2) || /cave_vines_.*with_berries/.test(b.name))) { await near(x, y, z); await useOn([x, y, z].map(S)); c++; } } return say('harvest_berries', `${c} picked`); },
    till_area: async (a) => { const y = n(a[4], -61); let c = 0; for (const [x, z] of area(a)) { await near(x, y, z); await V.till([x, y, z].map(S)); c++; } return say('till_area', `${c} tilled`); },
    bonemeal_area: async (a) => { const y = n(a[4], -60); let c = 0; for (const [x, z] of area(a)) { await K.sync(); if (!has('bone_meal')) break; await near(x, y, z); await V.bonemeal([x, y, z].map(S)); c++; } return say('bonemeal_area', `${c} fed`); },
    fell_tree: async (a) => {   // fell_tree x y z: every log of the tree (connected logs from that one), bottom up, as far as the arm reaches
      const [x0, y0, z0] = nums(a, 0, 3), isLog = (b) => !!b && /_(log|stem)$|mangrove_roots/.test(b.name);
      if (!isLog(blockAt(x0, y0, z0))) { await digAt(x0, y0, z0); return say('fell_tree', 'no log known there: cut the one block'); }
      const seen = new Set([`${x0},${y0},${z0}`]), q = [[x0, y0, z0]], logs = [];
      while (q.length && logs.length < 64) { const [x, y, z] = q.shift(); logs.push([x, y, z]); for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const k = `${x + dx},${y + dy},${z + dz}`; if (!seen.has(k) && Math.abs(x + dx - x0) <= 5 && Math.abs(z + dz - z0) <= 5 && isLog(blockAt(x + dx, y + dy, z + dz))) { seen.add(k); q.push([x + dx, y + dy, z + dz]); } } }
      logs.sort((p, r) => p[1] - r[1]); let c = 0, far = 0;
      for (const [x, y, z] of logs) { await near(x, y, z); if (dBlock(x, y, z) > 5) { far++; continue; } await digAt(x, y, z); c++; }
      return say('fell_tree', `${c} logs${far ? `, ${far} out of reach` : ''}`);
    },
    grow_tree: async (a) => {   // grow_tree <sapling> x y z: plant it on that block and bone-meal it until it is a tree
      const [x, y, z] = nums(a, 1, 3); await V.sapling([a[0], S(x), S(y), S(z)]);
      for (let k = 0; k < 12; k++) { if (/_(log|stem)$/.test(nameAt(x, y + 1, z))) return say('grow_tree', 'grown'); await K.sync(); if (!has('bone_meal')) break; await V.bonemeal([S(x), S(y + 1), S(z)]); await K.ticks(4); }
      return say('grow_tree', /_(log|stem)$/.test(nameAt(x, y + 1, z)) ? 'grown' : 'not grown yet');
    },
    pick_flowers: async (a) => { const y = n(a[4], -60); let c = 0; for (const [x, z] of area(a)) if (flowerRe.test(nameAt(x, y, z))) { await digAt(x, y, z, false); c++; } return say('pick_flowers', `${c} flowers`); },
    mow: async (a) => { const y = n(a[4], -60); let c = 0; for (const [x, z] of area(a)) if (/^(short_grass|tall_grass|fern|large_fern|deadbush|short_dry_grass|tall_dry_grass|bush)$/.test(nameAt(x, y, z))) { await digAt(x, y, z, false); c++; } return say('mow', `${c} cut`); },
  });

  // ---------- mining: the right tool, whole veins, tunnels and shafts ----------
  const ORES = { coal: /(^|:)(deepslate_)?coal_ore$/, iron: /(^|:)(deepslate_)?iron_ore$/, copper: /(^|:)(deepslate_)?copper_ore$/, gold: /(^|:)(deepslate_|nether_)?gold_ore$/, redstone: /(^|:)(lit_)?(deepslate_)?(lit_)?redstone_ore$/,
    lapis: /(^|:)(deepslate_)?lapis_ore$/, diamond: /(^|:)(deepslate_)?diamond_ore$/, emerald: /(^|:)(deepslate_)?emerald_ore$/, quartz: /(^|:)quartz_ore$/, ancient_debris: /(^|:)ancient_debris$/ };
  const anyOre = new RegExp(Object.values(ORES).map((r) => r.source).join('|'));
  async function vein(x0, y0, z0, max = 32) {
    const b0 = blockAt(x0, y0, z0); if (!b0 || isAir(b0)) { await digAt(x0, y0, z0); return 1; }
    const same = (b) => !!b && b.name.replace('lit_', '') === b0.name.replace('lit_', ''), seen = new Set([`${x0},${y0},${z0}`]), q = [[x0, y0, z0]], out = [];
    while (q.length && out.length < max) { const [x, y, z] = q.shift(); out.push([x, y, z]); for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const k = `${x + dx},${y + dy},${z + dz}`; if (!seen.has(k) && same(blockAt(x + dx, y + dy, z + dz))) { seen.add(k); q.push([x + dx, y + dy, z + dz]); } } }
    for (const [x, y, z] of out) await digAt(x, y, z);
    return out.length;
  }
  addAll({
    vein_mine: async (a) => { const [x, y, z] = nums(a, 0, 3); return say('vein_mine', `${await vein(x, y, z)} blocks`); },
    mine_ore: async (a) => { const r = ORES[a[0]] ?? blockRe(a[0]), h = scan(r, n(a[1], 16))[0]; if (!h) return say('mine_ore', `no ${a[0]} ore known within ${n(a[1], 16)}`); return say('mine_ore', `${await vein(h[0], h[1], h[2])} ${a[0]} at ${h[0]} ${h[1]} ${h[2]}`); },
    mine_ores: async (a) => { let c = 0; for (let k = 0; k < n(a[1], 8); k++) { const h = scan(anyOre, n(a[0], 12))[0]; if (!h) break; c += await vein(h[0], h[1], h[2]); } return say('mine_ores', `${c} ore blocks`); },
    mine_nearest: async (a) => { const h = scan(blockRe(a[0]), n(a[1], 16))[0]; if (!h) return say('mine_nearest', `no ${a[0]} known`); await digAt(h[0], h[1], h[2]); return say('mine_nearest', `${a[0]} at ${h[0]} ${h[1]} ${h[2]}`); },
    mine_only: async (a) => {   // mine_only <block> x1 y1 z1 x2 y2 z2: only that block in the box
      const [x1, y1, z1, x2, y2, z2] = nums(a, 1, 6), r = blockRe(a[0]); let c = 0;
      for (let y = Math.max(y1, y2); y >= Math.min(y1, y2); y--) for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) if (r.test(blockAt(x, y, z)?.name ?? '')) { await digAt(x, y, z); c++; }
      return say('mine_only', `${c} ${a[0]}`);
    },
    dig_smart: async (a) => { const [x, y, z] = nums(a, 0, 3); await near(x, y, z); const t = await toolFor(x, y, z); await K.act('dig', [S(x), S(y), S(z)]); return say('dig_smart', `with ${t ?? 'what was in hand'}`); },
    dig_with: async (a) => { const [x, y, z] = nums(a, 1, 3); await grabAny(a[0], 'dig_with'); await near(x, y, z); return K.act('dig', [S(x), S(y), S(z)]); },
    dig_by_hand: async (a) => { const [x, y, z] = nums(a, 0, 3); await emptyHand(); await near(x, y, z); return K.act('dig', [S(x), S(y), S(z)]); },
    mine_3x3: async (a) => {   // a 3x3 tunnel ahead
      const [dx, dz] = H.axis();
      for (let k = 0; k < n(a[0], 2); k++) { const [x, y, z] = here(), fx = x + dx, fz = z + dz; for (const h of [2, 1, 0]) for (const s of [-1, 0, 1]) { const bx = fx + (dz ? s : 0), bz = fz + (dx ? s : 0), b = blockAt(bx, y + h, bz); if (!b || !isAir(b)) await digAt(bx, y + h, bz); } await go(fx + 0.5, fz + 0.5, 40); }
      return K.ticks(2);
    },
    branch_mine: async (a) => {   // a main tunnel with side branches left and right every 3 blocks
      const y0 = K.yaw(); let c = 0;
      for (let b = 0; b < n(a[0], 2); b++) {
        await V.tunnel(['3']); const [x, , z] = here();
        for (const t of [-90, 90]) { K.look(y0 + t, 0); await V.tunnel([S(n(a[1], 6))]); await go(x + 0.5, z + 0.5, 80); c++; }
        K.look(y0, 0);
      }
      return say('branch_mine', `${c} branches`);
    },
    quarry: async (a) => {   // quarry x1 z1 x2 z2 depth: layer by layer down from under your feet
      const [x1, z1, x2, z2] = H.box2(a), y0 = here()[1] - 1; let c = 0;
      for (let d = 0; d < n(a[4], 2); d++) for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) { const b = blockAt(x, y0 - d, z); if (b && isAir(b)) continue; await digAt(x, y0 - d, z); c++; }
      return say('quarry', `${c} blocks`);
    },
    shaft_ladder: async (a) => {   // dig straight down, putting a ladder on the wall behind at each level
      const [dx, dz] = H.axis(), side = dx === 1 ? 'east' : dx === -1 ? 'west' : dz === 1 ? 'south' : 'north'; let c = 0;
      for (let k = 0; k < n(a[0], 3); k++) {
        const [x, y, z] = here(); await digAt(x, y - 1, z); await K.ticks(8);
        if (has('ladder')) await putAt('ladder', x, y - 1, z, side).catch(() => {});
        c++;
      }
      return say('shaft_ladder', `${c} down`);
    },
    gather: async (a) => {   // gather <block> [n] [radius]: dig the nearest ones and pick up what drops
      let c = 0;
      for (; c < n(a[1], 4); c++) { const h = scan(blockRe(a[0]), n(a[2], 16))[0]; if (!h) break; await digAt(h[0], h[1], h[2]); await K.ticks(4); }
      if (c) await V.collect(['4']);
      return say('gather', `${c} ${a[0]}`);
    },
    gather_wood: async (a) => { let c = 0; for (let k = 0; k < n(a[0], 2); k++) { const h = scan(/_(log|stem)$/, n(a[1], 16))[0]; if (!h) break; await M.fell_tree(h.slice(0, 3).map(S)); c++; } if (c) await V.collect(['6']); return say('gather_wood', `${c} trees`); },
  });

  // ---------- building: blocks set down from what is next to them, like a person does ----------
  async function placeAt(item, x, y, z) {
    const cur = blockAt(x, y, z); if (cur && solid(cur)) return false;   // already filled
    let s = [x, y - 1, z], face = 'up';
    for (const [dx, dy, dz, f] of [[0, -1, 0, 'up'], [1, 0, 0, 'west'], [-1, 0, 0, 'east'], [0, 0, 1, 'north'], [0, 0, -1, 'south'], [0, 1, 0, 'down']]) {
      const b = blockAt(x + dx, y + dy, z + dz); if (b && solid(b)) { s = [x + dx, y + dy, z + dz]; face = f; break; }
    }
    await near(...s); await grab(item, 'build'); await useOn(s.map(S), face);
    return true;
  }
  async function build(v, item, cells) { await grabAny(item, v); let c = 0; for (const [x, y, z] of cells) { await K.sync(); if (!has(item)) { say(v, `ran out of ${item}`); break; } if (await placeAt(item, x, y, z)) c++; } return say(v, `${c} placed`); }
  const shell = (x1, y1, z1, x2, y2, z2, walls = true) => { const o = []; for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) { const edge = x === x1 || x === x2 || z === z1 || z === z2; if (y === Math.min(y1, y2) || y === Math.max(y1, y2) || (walls && edge)) o.push([x, y, z]); } return o; };
  function roomCells(x1, z1, x2, z2, y, h) {   // walls with a 1x2 doorway on the side nearest you, then the roof
    const [ax, az, bx, bz] = [Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2)], f = K.feet(), cells = [];
    const door = [[Math.floor((ax + bx) / 2), az], [Math.floor((ax + bx) / 2), bz], [ax, Math.floor((az + bz) / 2)], [bx, Math.floor((az + bz) / 2)]].sort((p, q) => Math.hypot(p[0] - f.x, p[1] - f.z) - Math.hypot(q[0] - f.x, q[1] - f.z))[0];
    for (let yy = y; yy < y + h; yy++) for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) if ((x === ax || x === bx || z === az || z === bz) && !(x === door[0] && z === door[1] && yy < y + 2)) cells.push([x, yy, z]);
    for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) cells.push([x, y + h, z]);
    return cells;
  }
  const disk = (cx, cz, r, y, ring = false) => { const o = []; for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) { const d = Math.hypot(x - cx, z - cz); if (ring ? Math.abs(d - r) < 0.5 : d <= r + 0.3) o.push([x, y, z]); } return o; };
  addAll({
    box: async (a) => { const [x1, y1, z1, x2, y2, z2] = nums(a, 1, 6); return build('box', a[0], shell(x1, y1, z1, x2, y2, z2)); },   // box <item> x1 y1 z1 x2 y2 z2: hollow
    room: async (a) => { const [x1, z1, x2, z2, y] = nums(a, 1, 5); return build('room', a[0], roomCells(x1, z1, x2, z2, y, n(a[6], 3))); },   // room <item> x1 z1 x2 z2 y [h]
    hut: async (a) => {   // hut <item> [x z]: a 5x5 shelter with a doorway and a roof (3 blocks ahead by default)
      const [x, y, z] = here(), [dx, dz] = H.axis(), cx = a[1] !== undefined ? +a[1] : x + dx * 4, cz = a[2] !== undefined ? +a[2] : z + dz * 4;
      return build('hut', a[0], roomCells(cx - 2, cz - 2, cx + 2, cz + 2, y, 3));
    },
    // walled in where you stand: two high on every side, one more on one side to set the roof against (nothing touches the roof cell
    // otherwise: a block cannot go there), then the roof
    bunker: async (a) => { const [x, y, z] = here(), cells = []; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const h of [0, 1]) cells.push([x + dx, y + h, z + dz]); cells.push([x + 1, y + 2, z], [x, y + 2, z]); return build('bunker', a[0] ?? 'cobblestone', cells); },
    roof: async (a) => { const [x1, z1, x2, z2, y] = nums(a, 1, 5), c = []; for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) c.push([x, y, z]); return build('roof', a[0], c); },
    tower: async (a) => { const [x, z] = nums(a, 1, 2), y = here()[1]; return build('tower', a[0], shell(x - 1, y, z - 1, x + 1, y + n(a[3], 6) - 1, z + 1, true).filter(([, yy]) => yy < y + n(a[3], 6))); },
    column: async (a) => { const [x, y, z] = nums(a, 1, 3); return build('column', a[0], Array.from({ length: n(a[4], 4) }, (_, k) => [x, y + k, z])); },
    disk: async (a) => { const [x, z, r, y] = nums(a, 1, 4); return build('disk', a[0], disk(x, z, r, y)); },
    ring: async (a) => { const [x, z, r, y] = nums(a, 1, 4); return build('ring', a[0], disk(x, z, r, y, true)); },
    pyramid: async (a) => { const [x, z, b, y] = nums(a, 1, 4), c = []; for (let l = 0; l <= Math.floor((b - 1) / 2); l++) for (let dx = -Math.floor((b - 1) / 2) + l; dx <= Math.floor((b - 1) / 2) - l; dx++) for (let dz = -Math.floor((b - 1) / 2) + l; dz <= Math.floor((b - 1) / 2) - l; dz++) c.push([x + dx, y + l, z + dz]); return build('pyramid', a[0], c); },
    stairs_line: async (a) => {   // stairs_line <stairs> x y z <dir> [n] [support]: steps going up toward dir, a full block under each
      const [x, y, z] = nums(a, 1, 3), d = DIRS[a[4] ?? 'north']; if (!d) throw new Error('stairs_line: dir north|south|east|west');
      let c = 0;
      for (let k = 0; k < n(a[5], 4); k++) {
        const sx = x + d[0] * k, sy = y + k, sz = z + d[1] * k;
        if (k > 0) await placeAt(a[6] ?? 'cobblestone', sx, sy - 1, sz).catch(() => {});
        await faceYaw(a[4] ?? 'north'); if (await placeAt(a[0], sx, sy, sz)) c++;
      }
      return say('stairs_line', `${c} steps`);
    },
    fence_pen: async (a) => {   // fence_pen <fence> x1 z1 x2 z2 y: a fenced square with a gate in the side nearest you
      const [x1, z1, x2, z2, y] = nums(a, 1, 5), cells = roomCells(x1, z1, x2, z2, y, 1).filter(([, yy]) => yy === y), gate = [];
      const [ax, az, bx, bz] = [Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2)];
      for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) if ((x === ax || x === bx || z === az || z === bz) && !cells.some((q) => q[0] === x && q[2] === z)) gate.push([x, y, z]);
      await build('fence_pen', a[0], cells);
      if (gate[0] && carried(/fence_gate$/)) await placeAt(carried(/fence_gate$/), ...gate[0]);
      return K.ticks(1);
    },
    make_path: async (a) => { const y = n(a[4], -61); let c = 0; for (const [x, z] of area(a)) { await near(x, y, z); await V.flatten([x, y, z].map(S)); c++; } return say('make_path', `${c} blocks`); },   // x1 z1 x2 z2 y: a shovel over the grass
    checker: async (a) => { const [x1, z1, x2, z2, y] = nums(a, 2, 5), c1 = [], c2 = []; for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) ((x + z) % 2 ? c2 : c1).push([x, y, z]); await build('checker', a[0], c1); return build('checker', a[1], c2); },
    replace: async (a) => {   // replace <from> <to> x1 y1 z1 x2 y2 z2: dig each <from> this client knows and set <to> there
      const [x1, y1, z1, x2, y2, z2] = nums(a, 2, 6), r = blockRe(a[0]); let c = 0;
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) if (r.test(blockAt(x, y, z)?.name ?? '')) { await digAt(x, y, z); await K.ticks(2); await placeAt(a[1], x, y, z); c++; }
      return say('replace', `${c} replaced`);
    },
    replace_block: async (a) => { const [x, y, z] = nums(a, 1, 3); await digAt(x, y, z); await K.ticks(2); await grabAny(a[0], 'replace_block'); await placeAt(a[0], x, y, z); return K.ticks(1); },
    level: async (a) => {   // level x1 z1 x2 z2 y [fill item]: clear what sticks up above y, fill the holes at y
      const y = n(a[4], -61); let cut = 0, filled = 0;
      for (const [x, z] of area(a)) {
        for (let h = 4; h >= 1; h--) { const b = blockAt(x, y + h, z); if (b && !isAir(b)) { await digAt(x, y + h, z); cut++; } }
        const b = blockAt(x, y, z); if (a[5] && (!b || isAir(b) || /water|lava/.test(b.name))) { if (await placeAt(a[5], x, y, z)) filled++; }
      }
      return say('level', `${cut} cut, ${filled} filled`);
    },
    dig_pit: async (a) => { const [x1, z1, x2, z2] = H.box2(a), y0 = n(a[5], here()[1] - 1); let c = 0; for (let d = 0; d < n(a[4], 2); d++) for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) { const b = blockAt(x, y0 - d, z); if (b && isAir(b)) continue; await digAt(x, y0 - d, z); c++; } return say('dig_pit', `${c} dug`); },   // x1 z1 x2 z2 depth [top y]
    pool: async (a) => { const [x1, z1, x2, z2] = H.box2(a), y0 = here()[1] - 1, d = n(a[4], 2); await M.dig_pit([S(x1), S(z1), S(x2), S(z2), S(d), S(y0)]); for (const [x, z] of [[x1, z1], [x2, z2]]) { await K.sync(); if (!has('water_bucket')) break; await grab('water_bucket', 'pool'); await near(x, y0 - d, z); await useOn([x, y0 - d, z].map(S), 'up'); } return K.ticks(1); },
    nether_portal: async (a) => {   // nether_portal x y z [x|z]: an obsidian frame (2 wide, 3 tall inside) along that axis, lit inside
      const [x, y, z] = nums(a, 0, 3), ax = a[3] === 'z' ? [0, 1] : [1, 0], per = [ax[1], ax[0]], P = (u, h) => [x + ax[0] * u, y + h, z + ax[1] * u];
      // stand two blocks out in front of it (never in a spot the frame needs), and set every block from there: bottom, the
      // corners (any block: the sides and the top are set against them, nothing floats), the sides upward, the top
      await K.sync();
      const filler = ['cobblestone', 'dirt', 'cobbled_deepslate', 'netherrack', 'stone', 'oak_planks', 'spruce_planks', 'birch_planks'].find((f) => has(f)) ?? 'obsidian';
      await go(x + ax[0] * 1 + per[0] * 2 + 0.5 * (1 - ax[0]) + 0.5 * ax[0], z + ax[1] * 1 + per[1] * 2 + 0.5 * (1 - ax[1]) + 0.5 * ax[1], 200);
      K.controls.sneak = true;   // a click on the placed obsidian must not open anything, and no stepping off
      let c = 0;
      try {
        for (const [item, cells] of [['obsidian', [P(0, 0), P(1, 0)]], [filler, [P(-1, 0), P(2, 0)]], ['obsidian', [P(-1, 1), P(2, 1), P(-1, 2), P(2, 2), P(-1, 3), P(2, 3)]], [filler, [P(-1, 4), P(2, 4)]], ['obsidian', [P(0, 4), P(1, 4)]]]) {
          for (const [cx, cy, cz] of cells) {
            const cur = blockAt(cx, cy, cz); if (cur && solid(cur)) continue;
            await K.sync(); if (!has(item)) return say('nether_portal', `ran out of ${item}`);
            const nb = [[0, -1, 0, 'up'], [-ax[0], 0, -ax[1], ax[0] ? 'east' : 'south'], [ax[0], 0, ax[1], ax[0] ? 'west' : 'north'], [0, 1, 0, 'down']].find(([dx, dy, dz]) => solid(blockAt(cx + dx, cy + dy, cz + dz)));
            if (!nb) return say('nether_portal', `nothing to set the block at ${cx} ${cy} ${cz} against`);
            await grab(item, 'nether_portal'); await useOn([cx + nb[0], cy + nb[1], cz + nb[2]].map(S), nb[3]); await K.ticks(3); c++;
          }
        }
      } finally { K.controls.sneak = false; }
      await grabAny('flint_and_steel|fire_charge', 'nether_portal'); await useOn(P(0, 0).map(S), 'up'); await K.ticks(6);
      return say('nether_portal', `${c} set, lit`);
    },
    end_portal_fill: async (a) => { let c = 0; for (const [x, y, z, b] of scan(/end_portal_frame$/, n(a[0], 8))) { if (b.states?.end_portal_eye_bit) continue; await K.sync(); if (!has('ender_eye')) break; await grab('ender_eye', 'end_portal_fill'); await near(x, y, z); await useOn([x, y, z].map(S), 'up'); c++; } return say('end_portal_fill', `${c} eyes`); },
    beacon_base: async (a) => { const [x, y, z] = nums(a, 1, 3), c = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) c.push([x + dx, y - 1, z + dz]); await build('beacon_base', a[0], c); await grabAny('beacon', 'beacon_base'); await placeAt('beacon', x, y, z); return K.ticks(1); },   // beacon_base <iron_block|gold_block|...> x y z
    build_snow_golem: async (a) => { const [x, y, z] = nums(a, 0, 3); await build('build_snow_golem', 'snow', [[x, y, z], [x, y + 1, z]]); await grabAny('carved_pumpkin', 'build_snow_golem'); await placeAt('carved_pumpkin', x, y + 2, z); return K.ticks(10); },
    build_iron_golem: async (a) => { const [x, y, z] = nums(a, 0, 3), ax = a[3] === 'z' ? [0, 1] : [1, 0]; await build('build_iron_golem', 'iron_block', [[x, y, z], [x, y + 1, z], [x + ax[0], y + 1, z + ax[1]], [x - ax[0], y + 1, z - ax[1]]]); await grabAny('carved_pumpkin', 'build_iron_golem'); await placeAt('carved_pumpkin', x, y + 2, z); return K.ticks(10); },
    build_copper_golem: async (a) => { const [x, y, z] = nums(a, 0, 3); await build('build_copper_golem', 'copper_block', [[x, y, z]]); await grabAny('carved_pumpkin', 'build_copper_golem'); await placeAt('carved_pumpkin', x, y + 1, z); return K.ticks(10); },
    build_wither: async (a) => { const [x, y, z] = nums(a, 0, 3), ax = a[3] === 'z' ? [0, 1] : [1, 0]; await build('build_wither', /soul_(sand|soil)$/, [[x, y, z], [x, y + 1, z], [x + ax[0], y + 1, z + ax[1]], [x - ax[0], y + 1, z - ax[1]]]); for (const u of [-1, 1, 0]) { await grabAny('wither_skeleton_skull', 'build_wither'); await placeAt('wither_skeleton_skull', x + ax[0] * u, y + 2, z + ax[1] * u); } return K.ticks(10); },
    farm_plot: async (a) => {   // farm_plot x z y [r]: water in the middle, the ground around it tilled (water reaches 4 blocks)
      const [x, z, y] = nums(a, 0, 3), r = n(a[3], 4);
      await digAt(x, y, z); await K.sync(); if (has('water_bucket')) { await grab('water_bucket', 'farm_plot'); await useOn([x, y - 1, z].map(S), 'up'); }
      let c = 0; for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx || dz) { await near(x + dx, y, z + dz); await V.till([x + dx, y, z + dz].map(S)); c++; }
      return say('farm_plot', `${c} tilled`);
    },
    lamp_post: async (a) => { const [x, y, z] = nums(a, 0, 3); await build('lamp_post', /fence$/, [[x, y, z], [x, y + 1, z]]); await grabAny('lantern', 'lamp_post'); await placeAt('lantern', x, y + 2, z); return K.ticks(1); },
    scaffold_tower: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('scaffolding', 'scaffold_tower'); await putAt('scaffolding', x, y, z); for (let k = 1; k < n(a[3], 4); k++) { await near(x, y + k - 1, z); await useOn([x, y + k - 1, z].map(S), 'up'); } return K.ticks(2); },
    ladder_column: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('ladder', 'ladder_column'); for (let k = 0; k < n(a[4], 4); k++) await putAt('ladder', x, y + k, z, a[3] ?? 'north'); return K.ticks(1); },   // x y z <wall side> [h]
    bridge_to: async (a) => { const [x, z] = nums(a, 0, 2), f = K.feet(), dx = x - f.x, dz = z - f.z; K.look(Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? -90 : 90) : dz > 0 ? 0 : 180, 0); return V.bridge([S(Math.round(Math.max(Math.abs(dx), Math.abs(dz)))), ...(a[2] ? [a[2]] : [])]); },
    rail_line: async (a) => { const [x1, z1, x2, z2, y] = nums(a, 0, 5), c = []; for (let k = 0, len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1)); k <= len; k++) c.push([x1 + Math.sign(x2 - x1) * (Math.abs(x2 - x1) >= Math.abs(z2 - z1) ? k : 0), y, z1 + Math.sign(z2 - z1) * (Math.abs(z2 - z1) > Math.abs(x2 - x1) ? k : 0)]); let p = 0; for (const [i, [x, yy, z]] of c.entries()) { const it = i % 8 === 7 && carried('golden_rail') ? 'golden_rail' : 'rail'; if (!has(it)) break; if (await placeAt(it, x, yy, z)) p++; } return say('rail_line', `${p} rails`); },
    redstone_line: async (a) => { const [x1, z1, x2, z2, y] = nums(a, 0, 5), c = []; for (let k = 0, len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1)); k <= len; k++) c.push([x1 + Math.sign(x2 - x1) * (Math.abs(x2 - x1) >= Math.abs(z2 - z1) ? k : 0), y, z1 + Math.sign(z2 - z1) * (Math.abs(z2 - z1) > Math.abs(x2 - x1) ? k : 0)]); let p = 0; for (const [i, [x, yy, z]] of c.entries()) { const it = i % 15 === 14 && carried('repeater') ? 'repeater' : 'redstone'; if (!has(it)) break; if (it === 'repeater') K.look(yawTo(x2 + 0.5, z2 + 0.5), 30); if (await placeAt(it, x, yy, z)) p++; } return say('redstone_line', `${p} placed`); },
  });

  // ---------- setting one block down the way it has to go ----------
  const SIDE_PT = { north: [0.5, 0.75, 0], south: [0.5, 0.75, 1], west: [0, 0.75, 0.5], east: [1, 0.75, 0.5] };   // the upper half of a side face
  async function upperHalf(item, x, y, z) {   // a top slab / upside-down stairs: click the upper half of a side, or the underside of the block above
    await grab(item, 'place');
    for (const [d, [dx, dz]] of Object.entries(DIRS)) { const b = blockAt(x + dx, y, z + dz); if (b && solid(b)) { await near(x + dx, y, z + dz); return useOn([x + dx, y, z + dz].map(S), OPP[d], SIDE_PT[OPP[d]].map(S)); } }
    const up = blockAt(x, y + 1, z); if (up && solid(up)) { await near(x, y + 1, z); return useOn([x, y + 1, z].map(S), 'down'); }
    await near(x, y, z + 1); return useOn([x, y, z + 1].map(S), 'north', SIDE_PT.north.map(S));
  }
  async function stackUp(v, item, x, y, z, times) { await putAt(item, x, y, z); for (let k = 1; k < times; k++) { await K.sync(); if (!has(item)) break; await grab(item, v); await useOn([x, y, z].map(S), 'up'); } return K.ticks(2); }
  const clicksOn = async (x, y, z, k) => { await emptyHand(); for (let i = 0; i < k; i++) { await useOn([x, y, z].map(S)); await K.ticks(2); } };
  addAll({
    place_wall: async (a) => { const [x, y, z] = nums(a, 1, 3); return putAt(a[0], x, y, z, a[4] ?? 'north'); },   // place_wall <item> x y z <side the wall is on>
    place_ceiling: async (a) => { const [x, y, z] = nums(a, 1, 3); return putAt(a[0], x, y, z, 'ceiling'); },
    place_top_slab: async (a) => { const [x, y, z] = nums(a, 1, 3); return upperHalf(a[0], x, y, z); },
    place_upside_stairs: async (a) => { const [x, y, z] = nums(a, 1, 3); if (a[4]) await faceYaw(a[4]); return upperHalf(a[0], x, y, z); },
    place_double_slab: async (a) => { const [x, y, z] = nums(a, 1, 3); await putAt(a[0], x, y, z); await grab(a[0], 'place_double_slab'); return useOn([x, y, z].map(S), 'up', ['0.5', '0.5', '0.5']); },
    place_stairs: async (a) => { const [x, y, z] = nums(a, 1, 3); await faceYaw(a[4] ?? 'north'); return putAt(a[0], x, y, z); },   // you walk up them toward <dir>
    place_facing: async (a) => {   // place_facing <item> x y z <dir|up|down>: set it down while looking that way (chests/furnaces then face you, pistons/observers point by your look)
      const [x, y, z] = nums(a, 1, 3), d = a[4] ?? 'north';
      if (d === 'up' || d === 'down') { await putAt(a[0], x, y, z); K.look(K.yaw(), d === 'up' ? -80 : 80); return K.ticks(1); }
      await faceYaw(d); return putAt(a[0], x, y, z);
    },
    place_double_chest: async (a) => { const [x, y, z] = nums(a, 0, 3), d = DIRS[a[3] ?? 'east']; await grabAny('chest', 'place_double_chest'); await putAt('chest', x, y, z); await K.sync(); await grab('chest', 'place_double_chest'); return putAt('chest', x + d[0], y, z + d[1]); },
    place_bed: async (a) => { const [x, y, z] = nums(a, 0, 3); await faceYaw(a[3] ?? 'north'); await grabAny(/(^|:)(\w+_)?bed$/, 'place_bed'); return putAt(null, x, y, z); },   // the head goes the way you face
    place_door: async (a) => { const [x, y, z] = nums(a, 1, 3); await faceYaw(a[4] ?? 'north'); await grab(a[0], 'place_door'); await near(x, y - 1, z); return useOn([x, y - 1, z].map(S), 'up', a[5] === 'left' ? ['0.25', '1', '0.5'] : ['0.75', '1', '0.5']); },   // hinge by the half you click
    place_log: async (a) => {   // place_log <log> x y z <x|y|z>: a log lies along the axis of the face you click
      const [x, y, z] = nums(a, 1, 3), axis = a[4] ?? 'y';
      if (axis === 'y') return putAt(a[0], x, y, z);
      const d = axis === 'x' ? 'east' : 'south', w = DIRS[d], b = blockAt(x + w[0], y, z + w[1]);
      return putAt(a[0], x, y, z, b && solid(b) ? d : OPP[d]);
    },
    place_candles: async (a) => { const [x, y, z] = nums(a, 1, 3); await grabAny(a[0], 'place_candles'); return stackUp('place_candles', a[0], x, y, z, Math.min(4, n(a[4], 4))); },
    place_pickles: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('sea_pickle', 'place_pickles'); return stackUp('place_pickles', 'sea_pickle', x, y, z, Math.min(4, n(a[3], 4))); },
    place_snow_layers: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('snow_layer', 'place_snow_layers'); return stackUp('place_snow_layers', 'snow_layer', x, y, z, Math.min(8, n(a[3], 3))); },
    place_turtle_eggs: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('turtle_egg', 'place_turtle_eggs'); return stackUp('place_turtle_eggs', 'turtle_egg', x, y, z, Math.min(4, n(a[3], 2))); },
    place_end_crystal: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('end_crystal', 'place_end_crystal'); return putAt(null, x, y, z); },   // on obsidian or bedrock
    place_repeater: async (a) => { const [x, y, z] = nums(a, 0, 3); await faceYaw(a[3] ?? 'north'); await grabAny('repeater', 'place_repeater'); await putAt(null, x, y, z); return clicksOn(x, y, z, Math.max(0, n(a[4], 1) - 1)); },   // x y z <dir> [delay 1-4]
    place_comparator: async (a) => { const [x, y, z] = nums(a, 0, 3); await faceYaw(a[3] ?? 'north'); await grabAny('comparator', 'place_comparator'); await putAt(null, x, y, z); if (a[4] === 'subtract') await clicksOn(x, y, z, 1); return K.ticks(1); },
    place_note: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('noteblock', 'place_note'); await putAt(null, x, y, z); return clicksOn(x, y, z, Math.min(24, n(a[3], 0))); },   // a note block tuned to 0-24 clicks
    place_frame_item: async (a) => { const [x, y, z] = nums(a, 1, 3); await grabAny('frame|glow_frame', 'place_frame_item'); await putAt(carried('frame|glow_frame'), x, y, z, a[4] ?? 'north'); await K.ticks(4); await grabAny(a[0], 'place_frame_item'); return useOn([x, y, z].map(S)); },
    place_armor_stand_dressed: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('armor_stand', 'place_armor_stand_dressed'); await putAt(null, x, y, z); await K.ticks(10); for (const it of a.slice(3)) { const e = mob('armor_stand'); if (!e) break; await grabAny(it, 'place_armor_stand_dressed'); await K.hit(e, 'interact'); } return K.ticks(2); },
    waterlog: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('water_bucket', 'waterlog'); await near(x, y, z); return useOn([x, y, z].map(S)); },   // water into a slab / stairs / fence (the block itself)
  });

  // ---------- redstone ----------
  addAll({
    repeater_delay: async (a) => {   // repeater_delay x y z <1-4>: click until it shows that delay
      const [x, y, z] = nums(a, 0, 3), want = Math.max(1, Math.min(4, n(a[3], 1))), b = blockAt(x, y, z), cur = b?.states?.repeater_delay ?? 0;
      await near(x, y, z); await clicksOn(x, y, z, (want - 1 - cur + 4) % 4); return say('repeater_delay', `${want}`);
    },
    note_tune: async (a) => { const [x, y, z] = nums(a, 0, 3); await near(x, y, z); await clicksOn(x, y, z, Math.max(0, Math.min(24, n(a[3], 1)))); return K.ticks(1); },   // clicks raise the note one step each (from where it was)
    step_plate: async (a) => { const [x, , z] = nums(a, 0, 3), f = K.feet(); await go(x + 0.5, z + 0.5, 120); await K.ticks(n(a[3], 20)); await go(f.x, f.z, 120); return K.ticks(2); },   // stand on it, then step back off
    trip_wire: async (a) => { const [x, , z] = nums(a, 0, 3), f = K.feet(), dx = x + 0.5 - f.x, dz = z + 0.5 - f.z, d = Math.hypot(dx, dz) || 1; await go(x + 0.5 + (dx / d) * 2, z + 0.5 + (dz / d) * 2, 160); return K.ticks(2); },   // walk through it
    shoot_target: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('bow', 'shoot_target'); const d = dBlock(x, y, z); K.lookAt(x + 0.5, y + 0.5 + d * d * 0.0028, z + 0.5); return K.act('use', [S(n(a[3], 20))]); },
    lever_pulse: async (a) => { const [x, y, z] = nums(a, 0, 3); await near(x, y, z); await useOn([x, y, z].map(S)); await K.ticks(n(a[3], 20)); return useOn([x, y, z].map(S)); },
    disarm_tripwire: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('shears', 'disarm_tripwire'); await near(x, y, z); return K.act('dig', [S(x), S(y), S(z)]); },   // shears cut the string without setting it off
  });

  // ---------- vehicles, liquids ----------
  addAll({
    break_entity: async (a) => { let c = 0; for (; c < n(a[1], 6); c++) { const e = mob(a[0]); if (!e) break; await nearMob(e, 2.6); await swingAt(e); await K.ticks(6); } return say('break_entity', mob(a[0]) ? `${a[0]} still there after ${c} hits` : `${a[0]} broken (${c} hits)`); },   // boat, minecart, armor stand, painting, end crystal ...
    minecart_trip: async (a) => { await M.ride_minecart([]); if (!K.riding()) return say('minecart_trip', 'could not get in'); await hold({ forward: true }, n(a[0], 100)); return K.act('dismount', []); },
    make_obsidian: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('water_bucket', 'make_obsidian'); await near(x, y, z); await useOn([x, y, z].map(S), 'up'); await K.ticks(20); await K.sync(); if (has('bucket')) { await grab('bucket', 'make_obsidian'); await useOn([x, y, z].map(S), 'up'); } return K.ticks(2); },   // water onto a lava source, then the water back
    infinite_water: async (a) => { const [x, y, z] = nums(a, 0, 3), d = DIRS[a[3] ?? 'east']; for (const k of [0, 2]) { await K.sync(); if (!has('water_bucket')) return say('infinite_water', 'needs 2 water buckets'); await grab('water_bucket', 'infinite_water'); await near(x + d[0] * k, y - 1, z + d[1] * k); await useOn([x + d[0] * k, y - 1, z + d[1] * k].map(S), 'up'); } return say('infinite_water', 'the middle refills itself'); },   // 2 sources with 1 gap, x y z = the first spot
    drain_fill: async (a) => { const [x1, y1, z1, x2, y2, z2] = nums(a, 1, 6); const c = []; for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) if (/water|lava/.test(blockAt(x, y, z)?.name ?? '')) c.push([x, y, z]); return build('drain_fill', a[0], c); },
    make_mud: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('potion', 'make_mud'); await near(x, y, z); return useOn([x, y, z].map(S), 'up'); },   // a water bottle on dirt
  });

  // ---------- decorating and the small interactions blocks have ----------
  function slotPoint(x, y, z, s) {   // the point of a chiseled bookshelf's slot 0-5 (top row 0-2, left to right as you face its front)
    const st = blockAt(x, y, z)?.states?.direction, e = eye(), d = { x: e.x - (x + 0.5), z: e.z - (z + 0.5) };
    const face = st !== undefined ? ['south', 'west', 'north', 'east'][st] : Math.abs(d.x) > Math.abs(d.z) ? (d.x > 0 ? 'east' : 'west') : d.z > 0 ? 'south' : 'north';
    const v = s < 3 ? 0.75 : 0.25, u = { north: [5 / 6, 1 / 2, 1 / 6], south: [1 / 6, 1 / 2, 5 / 6], west: [1 / 6, 1 / 2, 5 / 6], east: [5 / 6, 1 / 2, 1 / 6] }[face][s % 3];
    return [face, (face === 'north' ? [u, v, 0] : face === 'south' ? [u, v, 1] : face === 'west' ? [0, v, u] : [1, v, u]).map((q) => q.toFixed(3))];
  }
  const onBlock = (v, item) => async (a) => { const [x, y, z] = nums(a, item === 'ARG' ? 1 : 0, 3); if (item === 'ARG') await grabAny(a[0], v); else if (item) await grabAny(item, v); else await emptyHand(); await near(x, y, z); return useOn([x, y, z].map(S)); };
  addAll({
    frame_put: onBlock('frame_put', 'ARG'), frame_rotate: async (a) => { const [x, y, z] = nums(a, 0, 3); await near(x, y, z); return clicksOn(x, y, z, n(a[3], 1)); },
    chiseled_put: async (a) => { const [x, y, z] = nums(a, 1, 3); await grabAny(a[0] ?? 'book', 'chiseled_put'); await near(x, y, z); const [face, pt] = slotPoint(x, y, z, n(a[4], 0)); return useOn([x, y, z].map(S), face, pt); },
    chiseled_take: async (a) => { const [x, y, z] = nums(a, 0, 3); await emptyHand(); await near(x, y, z); const [face, pt] = slotPoint(x, y, z, n(a[3], 0)); return useOn([x, y, z].map(S), face, pt); },
    pot_take: onBlock('pot_take', null), banner_mark: onBlock('banner_mark', 'filled_map'), sign_ink: onBlock('sign_ink', 'ink_sac'), candle_cake: onBlock('candle_cake', /(^|:)(\w+_)?candle$/),
    sign_dye: onBlock('sign_dye', 'ARG'), lectern_book: onBlock('lectern_book', 'written_book|writable_book'), cauldron_dye: onBlock('cauldron_dye', 'ARG'), cauldron_potion: onBlock('cauldron_potion', 'potion|splash_potion|lingering_potion'),
    cauldron_arrows: onBlock('cauldron_arrows', 'arrow'), vault_key: onBlock('vault_key', 'trial_key'), vault_ominous: onBlock('vault_ominous', 'ominous_trial_key'), composter_take: onBlock('composter_take', null),
    firework_launch: async (a) => { const [x, y, z] = nums(a, 0, 3); await grabAny('firework_rocket', 'firework_launch'); await near(x, y, z); return useOn([x, y, z].map(S), 'up'); },   // from the ground (in the air it only boosts a glide)
    armor_stand_dress: async (a) => { for (const it of a) { const e = mob('armor_stand'); if (!e) return say('armor_stand_dress', 'no armor stand in view'); await grabAny(it, 'armor_stand_dress'); await nearMob(e); await K.hit(e, 'interact'); } return K.ticks(2); },
  });

  // ---------- in hand ----------
  const useItem = (v, item, pitch, times = 1) => async (a) => { await grabAny(item, v); if (pitch !== null) K.look(K.yaw(), pitch); for (let k = 0; k < n(a[0], times); k++) { await K.act('use', []); await K.ticks(2); } return K.ticks(1); };
  addAll({
    throw_blue_egg: useItem('throw_blue_egg', 'blue_egg', null), throw_brown_egg: useItem('throw_brown_egg', 'brown_egg', null), throw_eye: useItem('throw_eye', 'ender_eye', -20),
    snowball_spam: useItem('snowball_spam', 'snowball', null, 5), xp_bottles: useItem('xp_bottles', 'experience_bottle', 90, 5), splash_self: useItem('splash_self', 'splash_potion', 90),
    cast: useItem('cast', 'fishing_rod', null), reel: useItem('reel', 'fishing_rod', null),
    crossbow_load: async (a) => { await grabAny('crossbow', 'crossbow_load'); return K.act('use', [S(n(a[0], 26))]); },
    crossbow_fire: async () => { await grabAny('crossbow', 'crossbow_fire'); return K.act('use', []); },
    crossbow_firework: async () => { await V.offhand(['firework_rocket']); await grabAny('crossbow', 'crossbow_firework'); await K.act('use', ['26']); return K.act('use', []); },   // rockets in the offhand load instead of arrows
    spawn_mob: async (a) => { const [x, y, z] = nums(a, 1, 3); await grabAny(a[0].endsWith('_spawn_egg') ? a[0] : `${a[0]}_spawn_egg`, 'spawn_mob'); await near(x, y, z); return useOn([x, y, z].map(S), 'up'); },   // spawn_mob <mob> x y z: the egg on the ground
  });

  // ---------- opening each screen (it stays open for move / craft / take ...) ----------
  for (const [k, block] of Object.entries(OPEN)) add(k, async (a) => {
    let p = a.slice(0, 3).every((x) => /^-?\d+$/.test(x ?? '')) ? a.slice(0, 3).map(Number) : null;
    if (!p) { const h = scan(blockRe(block), 8)[0]; if (!h) return say(k, `no ${block} known nearby (give x y z)`); p = h.slice(0, 3); }
    await near(...p); await emptyHand(); await K.act('open', p.map(S));
    return say(k, K.screen() ? `open: ${K.screen()}` : 'nothing opened');
  });
  for (const [k, type] of Object.entries({ open_chest_boat: 'chest_boat', open_chest_minecart: 'chest_minecart', open_hopper_minecart: 'hopper_minecart' })) add(k, async () => {
    const e = mob(type); if (!e) return say(k, `no ${type} in view`);
    await emptyHand(); await nearMob(e);
    if (type === 'chest_boat') { K.controls.sneak = true; await K.ticks(3); }   // a plain click sits in the boat; sneaking opens its chest (the server must see the sneak before the click)
    await K.hit(e, 'interact'); for (let t = 0; t < 20 && !K.screen(); t++) await K.ticks(1);
    K.controls.sneak = false; return say(k, K.screen() ? `open: ${K.screen()}` : 'nothing opened');
  });

  // ---------- goals: get any item from scratch (common/goal.cjs plans, common/goal-exec.cjs does it) ----------
  const GX = require('./goal-exec.cjs').goalVerbs(K, { ...H, M, near, toolFor, emptyHand, walkToward, nearMob, count });
  addAll(GX.M);
  Object.defineProperty(M, '__goal', { value: GX, enumerable: false });   // for the generated goal verbs and challenges
  return M;
}

// the tables are exported for tools that list the verbs (the catalog, the real-server check)
module.exports = { moreVerbs, BREED, FEED, TAME, RIDE, FOODS_EAT, FOES, FLOWERS, CMD, CMDA, RULES, MAKE, SMELT, POTIONS, MODS, MAPS, CROPS, RIPE, OPEN };
