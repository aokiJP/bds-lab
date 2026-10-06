#!/usr/bin/env node
// Builds common/data/kb.json: what the world is made of and how each thing is obtained, from BDS's own data (the goal planner in
// common/goal.cjs reads it; crafting recipes the real client also takes live from the server's crafting_data).
//   items   id -> [ja, en, maxStack, tags, food]
//   blocks  id -> [ja, en, the item that places it, tags, drops by tool, least tool]
//              drops by tool: { hand: {item: [min, max, share of breaks]}, <tool>: {...} only where it differs from the bare hand }
//   mobs    id -> [ja, en, drops {item: [min, max, chance]}]          (entity definitions -> their loot tables)
//   smelt   output -> [[input, stations...]]                          (furnace / blast_furnace / smoker / campfire recipes)
//   craft   output -> [[count, station, w, h, [[item|#tag, n]...]]]   (recipe files, legacy data values mapped to today's ids)
//   tags    #tag -> [items]                                           (item tags, from the server)
//   fish    item -> chance of one cast                                (fishing loot tables)
//   chests  item -> [chest loot tables it is in]                     (structures: only by exploring)
// Needs the bds lab set up (node lab.mjs bds setup). Runs one short server session for the Script API dumps (names, tags,
// block -> item, the loot each block gives to each tool, simulated with the game's own LootTableManager).
//   node common/kb-build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BDS = path.join(TOP, 'bds', '.lab', 'bds'), SAVED = path.join(TOP, 'bds', 'docs', 'verbs', '.lab', 'from-addon'), UNIT = path.join(TOP, 'bds', 'docs', 'verbs', 'lab.mjs');
if (!fs.existsSync(path.join(BDS, 'VERSION'))) { console.log('ERR no BDS: node lab.mjs bds setup first'); process.exit(1); }

// ---- 1. Script API dumps on the server ----
// (the js command goes through /scriptevent: no `>=` in the code; __labsave sends the text in small tick-paced chunks)
const TOOLS = ['', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_hoe', 'shears', 'wooden_sword'];
const js = (code) => `js ${code.replace(/\s*\n\s*/g, ' ')}`;
const cmds = [
  js(`const o={};for(const t of mc.ItemTypes.getAll()){const id=t.id.replace('minecraft:','');try{const s=new mc.ItemStack(t.id);const f=s.getComponent('minecraft:food');
    o[id]=[t.localizationKey,s.maxAmount,s.getTags().map(x=>x.replace('minecraft:','')),f?f.nutrition:0];}catch(e){o[id]=[t.localizationKey,0,[],0];}}
    return 'KB items '+(await __labsave('kb-items.json',JSON.stringify(o)))`),
  js(`const o={};for(const t of mc.BlockTypes.getAll()){const id=t.id.replace('minecraft:','');try{const p=mc.BlockPermutation.resolve(t.id);
    o[id]=[t.localizationKey,p.getItemStack(1)?.typeId?.replace('minecraft:','')??null,p.getTags()];}catch(e){o[id]=[t.localizationKey,null,[]];}}
    return 'KB blocks '+(await __labsave('kb-blocks.json',JSON.stringify(o)))`),
];
// drops: each block (crops at their last growth stage) broken by each tool; a block whose loot varies is broken many more times,
// so rare drops (seeds from grass, flint from gravel, saplings from leaves) show with their share
const SLICE = 100;
for (let s = 0; s < 1700; s += SLICE) cmds.push(js(`const ids=mc.BlockTypes.getAll().map(t=>t.id).sort().slice(${s},${s + SLICE});if(!ids.length)return 'KB drops none';
  const lm=world.getLootTableManager(),T=${JSON.stringify(TOOLS)},o={};
  const roll=(p,tool,n,d)=>{let k=0;for(let i=0;i<n;i++){let l;try{l=lm.generateLootFromBlockPermutation(p,tool?new mc.ItemStack(tool):undefined);}catch(e){return k;}if(!l)return k;k++;
    const seen=new Map();for(const s of l)seen.set(s.typeId,(seen.get(s.typeId)??0)+s.amount);
    for(const[i2,c]of seen){const x=(d[i2.replace('minecraft:','')]??=[99,0,0]);x[0]=Math.min(x[0],c);x[1]=Math.max(x[1],c);x[2]++;}}return k;};
  for(const id of ids){let p;try{p=mc.BlockPermutation.resolve(id);}catch(e){continue;}const st=p.getAllStates();
    for(const k of ['growth','age'])if(k in st)for(let v=15;v>0;v--){try{p=p.withState(k,v);break;}catch(e){}}
    const r={};for(const tool of T){const d={};let n=roll(p,tool,8,d);if(!n)continue;
      const vary=!Object.keys(d).length||Object.values(d).some(x=>x[2]<n||x[0]!==x[1]);
      if(vary)n+=roll(p,tool,tool?30:60,d);
      for(const x of Object.values(d))x[2]=Math.round(100*x[2]/n)/100;r[tool||'hand']=d;}
    o[id.replace('minecraft:','')]=r;}
  return 'KB drops '+(await __labsave('kb-drops-${s}.json',JSON.stringify(o)))`));
if (!process.argv.includes('--reuse') || !fs.existsSync(path.join(SAVED, 'kb-items.json'))) {   // --reuse: the last dumps again
  fs.rmSync(SAVED, { recursive: true, force: true });
  console.log(`server dump: ${cmds.length} steps, then a real client's recipe book...`);
  // the crafting recipes as the server sends them to a client (crafting_data): the only complete list (beds, dyes, wool ... are
  // not in the recipe files)
  const r = spawnSync(process.execPath, [UNIT, 'run', ...cmds, '@A join', 'wait 1500', '@A recipes_all', '-w', '300'], { cwd: path.dirname(UNIT), encoding: 'utf8', maxBuffer: 256e6, env: { ...process.env, LAB_MAX: '100000000' } });
  const said = (r.stdout.match(/KB \w+ \d+|KB drops none/g) ?? []);
  if (said.length < cmds.length) { console.log(r.stdout.slice(-3000)); console.log(`ERR only ${said.length} of ${cmds.length} dumps came back`); process.exit(1); }
  const book = r.stdout.split('\n').filter((l) => l.startsWith('@A R '));
  if (book.length < 500) { console.log(r.stdout.slice(-2000)); console.log(`ERR the client listed only ${book.length} recipes`); process.exit(1); }
  fs.writeFileSync(path.join(SAVED, 'kb-recipes.txt'), book.join('\n') + '\n');
}
const read = (f) => JSON.parse(fs.readFileSync(path.join(SAVED, f), 'utf8'));
const ITEMS = read('kb-items.json');

// ---- 2. names: the game's own language files (the localization keys the API reported) ----
const lang = (f) => { const m = new Map(); for (const l of fs.readFileSync(path.join(BDS, 'resource_packs', 'vanilla', 'texts', f), 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) m.set(l.slice(0, i).trim(), l.slice(i + 1).replace(/\t*#.*$/, '').trim()); } return m; };
const JA = lang('ja_JP.lang'), EN = lang('en_US.lang');
const nameOf = (key, id) => { const k = key && (JA.has(key) ? key : JA.has(key + '.name') ? key + '.name' : null); return [k ? JA.get(k) : id, k ? EN.get(k) ?? id : id]; };

// ---- 3. vanilla behavior pack files by path (plain files and __brarchive bundles); the newest pack version wins ----
const PACKS = path.join(BDS, 'behavior_packs');
const ver = (n) => (n === 'vanilla' ? [0] : n.slice(8).split('.').map(Number));
const packs = fs.readdirSync(PACKS).filter((n) => /^vanilla(_[\d.]+)?$/.test(n)).sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; });
const FILES = new Map();
const unbundle = (file, prefix) => {
  const b = fs.readFileSync(file), n = b.readUInt32LE(8), start = 16 + n * 256;
  for (let i = 0; i < n; i++) { const e = 16 + i * 256; FILES.set(prefix + b.toString('utf8', e + 1, e + 1 + b[e]), b.subarray(start + b.readUInt32LE(e + 248), start + b.readUInt32LE(e + 248) + b.readUInt32LE(e + 252)).toString('utf8')); }
};
const walk = (dir, rel, fn) => { for (const d of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, d.name), q = rel ? rel + '/' + d.name : d.name; if (d.isDirectory()) walk(p, q, fn); else fn(p, q); } };
for (const d of packs) walk(path.join(PACKS, d), '', (p, q) => {
  if (q.startsWith('__brarchive/')) { if (q.endsWith('.brarchive')) unbundle(p, q.slice(12, -10) + '/'); }
  else if (q.endsWith('.json')) FILES.set(q, fs.readFileSync(p, 'utf8'));
});
const strip = (x) => x.replace(/\/\/[^\n]*/g, '');
const parse = (t) => { try { return JSON.parse(t); } catch { try { return JSON.parse(strip(t)); } catch { return null; } } };

// ---- 4. recipes (legacy data values mapped to today's ids) ----
const DYE = ['ink_sac', 'red_dye', 'green_dye', 'cocoa_beans', 'lapis_lazuli', 'purple_dye', 'cyan_dye', 'light_gray_dye', 'gray_dye', 'pink_dye', 'lime_dye', 'yellow_dye', 'light_blue_dye', 'magenta_dye', 'orange_dye', 'bone_meal', 'black_dye', 'brown_dye', 'blue_dye', 'white_dye'];
const COLOR = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const BUCKET = { 0: 'bucket', 1: 'milk_bucket', 2: 'cod_bucket', 3: 'salmon_bucket', 4: 'tropical_fish_bucket', 5: 'pufferfish_bucket', 8: 'water_bucket', 10: 'lava_bucket', 11: 'powder_snow_bucket', 12: 'axolotl_bucket', 13: 'tadpole_bucket' };
const WOOD = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
// old names (recipe files, loot tables) -> today's item ids
const ALIAS = { reeds: 'sugar_cane', muttonRaw: 'mutton', muttonCooked: 'cooked_mutton', fish: 'cod', cooked_fish: 'cooked_cod', clownfish: 'tropical_fish', chorus_fruit_popped: 'popped_chorus_fruit',
  netherstar: 'nether_star', totem: 'totem_of_undying', appleEnchanted: 'enchanted_golden_apple', fireball: 'fire_charge', carrotOnAStick: 'carrot_on_a_stick', lodestonecompass: 'lodestone_compass',
  sealantern: 'sea_lantern', turtle_shell_piece: 'turtle_scute', scute: 'turtle_scute', melon: 'melon_slice', map: 'empty_map', emptymap: 'empty_map', boat: 'oak_boat', red_flower: 'poppy',
  yellow_flower: 'dandelion', sapling: 'oak_sapling', log: 'oak_log', log2: 'acacia_log', planks: 'oak_planks', wool: 'white_wool', carpet: 'white_carpet', stained_glass: 'white_stained_glass',
  concrete: 'white_concrete', skull: 'skeleton_skull', dye: 'ink_sac', speckled_melon: 'glistering_melon_slice', cobweb: 'web', lily_pad: 'waterlily', dead_bush: 'deadbush', terracotta: 'hardened_clay',
  appleenchanted: 'enchanted_golden_apple', carrotonastick: 'carrot_on_a_stick', netherStar: 'nether_star', darkoak_sign: 'dark_oak_sign', sign: 'oak_sign', chain: 'iron_chain', wood: 'oak_wood',
  chest_boat: 'oak_chest_boat', empty_locator_map: 'empty_map', banner_pattern: 'creeper_banner_pattern', horsearmorgold: 'golden_horse_armor', horsearmoriron: 'iron_horse_armor',
  horsearmordiamond: 'diamond_horse_armor', horsearmorleather: 'leather_horse_armor' };
const UNKNOWN = new Map();
const norm = (raw, data, where = '') => {   // today's item id for a name written the old way (<id>, <id>:<data>, <id> + data)
  let s = String(raw?.item ?? raw).replace(/^minecraft:/, '');
  const m = /^(.*):(\d+)$/.exec(s); if (m) { s = m[1]; data = Number(m[2]); }
  if (data) {
    if (s === 'dye') s = DYE[data] ?? s;
    else if (s === 'bucket') s = BUCKET[data] ?? s;
    else if (s === 'coal' && data === 1) s = 'charcoal';
    else if (/^(wool|carpet|concrete|concrete_powder|stained_glass|stained_glass_pane|stained_hardened_clay|shulker_box|bed|banner)$/.test(s) && COLOR[data]) s = s === 'stained_hardened_clay' ? `${COLOR[data]}_terracotta` : s === 'bed' || s === 'banner' ? s : `${COLOR[data]}_${s}`;
    else if (/^(log|planks|sapling|leaves|wooden_slab|fence)$/.test(s) && WOOD[data]) s = `${WOOD[data]}_${s === 'wooden_slab' ? 'slab' : s}`;
    else if (s === 'log2') s = ['acacia_log', 'dark_oak_log'][data] ?? s;
    else if (s === 'emptymap') s = data === 2 ? 'empty_locator_map' : 'empty_map';
    else if (s === 'quartz_block') s = data === 2 ? 'quartz_pillar' : data === 1 ? 'chiseled_quartz_block' : s;
    else if (s === 'skull') s = ['skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'player_head', 'creeper_head', 'dragon_head', 'piglin_head'][data] ?? s;
    else if (s === 'red_flower') s = ['poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'][data] ?? s;
  }
  if (ITEMS[s]) return s;
  if (ALIAS[s] && ITEMS[ALIAS[s]]) return ALIAS[s];
  if (/^record_/.test(s) && ITEMS['music_disc_' + s.slice(7)]) return 'music_disc_' + s.slice(7);
  if (/^horsearmor/.test(s) && ITEMS[s.slice(10) + '_horse_armor']) return s.slice(10) + '_horse_armor';
  if (!UNKNOWN.has(s)) UNKNOWN.set(s, where);
  return s;   // boats, banners, stews, patterns: the id alone is close enough for planning
};
const LEGACY = (id, data) => norm(id, data);
const craft = {}, smelt = {};
// the client's recipe book: R <out>*<n>[:meta] <station> <w>x<h> <ingredient>[:meta]*<n> ... (#tag for a tag)
const BOOK = fs.existsSync(path.join(SAVED, 'kb-recipes.txt')) ? fs.readFileSync(path.join(SAVED, 'kb-recipes.txt'), 'utf8').split('\n').filter(Boolean) : [];
const seenRecipe = new Set();
for (const l of BOOK) {
  const m = /^@A R (\S+?)\*(\d+)(?::\d+)? (\S+) (\d+)x(\d+) ?(.*)$/.exec(l); if (!m) continue;
  const need = new Map();
  for (const g of m[6].split(' ').filter(Boolean)) { const q = /^(.+)\*(\d+)$/.exec(g); if (!q) continue; const [nameMeta, k] = [q[1], +q[2]]; const id = nameMeta.startsWith('#') ? nameMeta : norm(nameMeta.split(':')[0], +(nameMeta.split(':')[1] ?? 0), 'recipe for ' + m[1]); need.set(id, (need.get(id) ?? 0) + k); }
  const out = norm(m[1], 0, 'recipe book'), rec = [+m[2], m[3], +m[4], +m[5], [...need]], key = out + JSON.stringify(rec);
  if (seenRecipe.has(key)) continue;
  seenRecipe.add(key);
  (craft[out] ??= []).push(rec);
}
const ingOf = (g) => (g.tag ? '#' + g.tag.replace('minecraft:', '') : LEGACY(g.item ?? g, g.data));
for (const [f, text] of FILES) {
  if (!f.startsWith('recipes/')) continue;
  const j = parse(text); if (!j) continue;
  for (const [k, rc] of Object.entries(j)) {
    if (k === 'format_version' || !rc || (rc.tags ?? []).includes('deprecated')) continue;
    const st = (rc.tags ?? []).filter((t) => t !== 'deprecated');
    if (k === 'minecraft:recipe_furnace') { const out = LEGACY(rc.output?.item ?? rc.output, rc.output?.data); (smelt[out] ??= []).push([ingOf(rc.input), ...st]); continue; }
    if (k === 'minecraft:recipe_smithing_transform') { if (!BOOK.length) (craft[LEGACY(rc.result)] ??= []).push([1, 'smithing_table', 0, 0, [rc.template, rc.base, rc.addition].filter(Boolean).map((g) => [ingOf(g), 1])]); continue; }
    if (k !== 'minecraft:recipe_shaped' && k !== 'minecraft:recipe_shapeless') continue;
    if (BOOK.length) continue;   // the client's recipe book has these (and more)
    const res = [].concat(rc.result ?? [])[0]; if (!res) continue;
    const out = LEGACY(res.item ?? res, res.data), cnt = res.count ?? 1, need = new Map();
    if (k === 'minecraft:recipe_shaped') { for (const row of rc.pattern) for (const ch of row) if (ch !== ' ' && rc.key[ch]) { const g = ingOf(rc.key[ch]); need.set(g, (need.get(g) ?? 0) + (rc.key[ch].count ?? 1)); } }
    else for (const g0 of rc.ingredients ?? []) { const g = ingOf(g0); need.set(g, (need.get(g) ?? 0) + (g0.count ?? 1)); }
    const w = k === 'minecraft:recipe_shaped' ? Math.max(...rc.pattern.map((x) => x.length)) : 0, h = k === 'minecraft:recipe_shaped' ? rc.pattern.length : 0;
    (craft[out] ??= []).push([cnt, st[0] ?? 'crafting_table', w, h, [...need]]);
  }
}

// ---- 5. loot tables: what an item can come out of ----
const range = (c) => (typeof c === 'number' ? [c, c] : c && typeof c === 'object' ? [c.min ?? 0, c.max ?? c.min ?? 1] : [1, 1]);
const lootOf = (file, seen = new Set()) => {   // item -> [min, max, chance]
  const out = {}, j = parse(FILES.get(file) ?? ''); if (!j || seen.has(file)) return out;
  seen.add(file);
  for (const pool of j.pools ?? []) {
    const entries = pool.entries ?? [], total = entries.reduce((a, e) => a + (e.weight ?? 1), 0) || 1;
    const rolls = range(pool.rolls ?? 1)[1];
    let gate = 1; for (const c of pool.conditions ?? []) if (/random_chance/.test(c.condition)) gate *= c.chance ?? c.default_chance ?? 1;
    for (const e of entries) {
      let p = gate * (e.weight ?? 1) / total * Math.max(1, rolls);
      for (const c of e.conditions ?? []) if (/random_chance/.test(c.condition)) p *= c.chance ?? c.default_chance ?? 1;
      if (e.type === 'loot_table' && e.name) { for (const [i, x] of Object.entries(lootOf(e.name.replace(/^\//, ''), seen))) out[i] ??= [x[0], x[1], Math.round(100 * Math.min(1, x[2] * p)) / 100]; continue; }
      if (e.type !== 'item' || !e.name) continue;
      let [lo, hi] = [1, 1];
      for (const fn of e.functions ?? []) if (/set_count/.test(fn.function)) [lo, hi] = range(fn.count);
      const id = norm(e.name, (e.functions ?? []).find((fn) => fn.function === 'set_data')?.data, file);
      const x = (out[id] ??= [lo, hi, 0]); x[0] = Math.min(x[0], lo); x[1] = Math.max(x[1], hi); x[2] = Math.round(100 * Math.min(1, x[2] + p)) / 100;
    }
  }
  return out;
};
const mobLoot = {};
for (const [f, text] of FILES) {
  if (!/^entities\/[^/]+\.json$/.test(f)) continue;
  const id = /"identifier"\s*:\s*"minecraft:([^"]+)"/.exec(text)?.[1]; if (!id) continue;
  const tables = [...new Set([...text.matchAll(/"minecraft:loot"\s*:\s*\{\s*"table"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))];
  const d = {};
  for (const t of tables) for (const [i, x] of Object.entries(lootOf(t))) { const y = (d[i] ??= [...x]); y[0] = Math.min(y[0], x[0]); y[1] = Math.max(y[1], x[1]); y[2] = Math.max(y[2], x[2]); }
  mobLoot[id] = d;
}
// the entities some drops belong to but that no definition file names (the game gives them in code)
for (const [id, extra] of Object.entries({ ender_dragon: { dragon_egg: [1, 1, 1] }, wither: { nether_star: [1, 1, 1] }, chicken: { egg: [1, 1, 1] } })) Object.assign(mobLoot[id] ??= {}, extra);
const fish = {};
for (const t of ['loot_tables/gameplay/fishing/fish.json', 'loot_tables/gameplay/fishing/junk.json', 'loot_tables/gameplay/fishing/treasure.json']) {
  const share = /fish\.json$/.test(t) ? 0.85 : /junk/.test(t) ? 0.1 : 0.05;
  for (const [i, x] of Object.entries(lootOf(t))) fish[i] = Math.round(1000 * Math.min(1, (fish[i] ?? 0) + x[2] * share)) / 1000;
}
const chests = {};
for (const f of FILES.keys()) if (/^loot_tables\/chests\/.*\.json$/.test(f)) for (const i of Object.keys(lootOf(f))) (chests[i] ??= []).push(f.slice(19, -5));

// ---- 6. assemble ----
const items = {}, blocks = {}, mobs = {}, tags = {};
for (const [id, [key, max, tg, food]] of Object.entries(ITEMS)) { items[id] = [...nameOf(key, id), max, tg, food]; for (const t of tg) (tags[t] ??= []).push(id); }
const drops = {}; for (const f of fs.readdirSync(SAVED).filter((x) => /^kb-drops-\d+\.json$/.test(x))) Object.assign(drops, read(f));
const TIERS = ['hand', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'];
const same = (a, b) => JSON.stringify(Object.keys(a ?? {}).sort()) === JSON.stringify(Object.keys(b ?? {}).sort());
for (const [id, [key, item, tg]] of Object.entries(read('kb-blocks.json'))) {
  const d = drops[id] ?? {}, keep = {};
  for (const [t, x] of Object.entries(d)) if (Object.keys(x).length && (t === 'hand' || !same(x, d.hand))) keep[t] = Object.fromEntries(Object.entries(x).map(([i, v]) => [ITEMS[i] ? i : ALIAS[i] ?? i, v]).filter(([i]) => ITEMS[i]));
    for (const t of Object.keys(keep)) if (!Object.keys(keep[t]).length) delete keep[t];
  // the least a player needs for it to drop anything: bare hand, else the first pickaxe tier that yields, else another tool kind
  const min = TIERS.find((t) => keep[t]) ?? ['wooden_axe', 'wooden_shovel', 'wooden_hoe', 'shears', 'wooden_sword'].find((t) => keep[t]) ?? null;
  blocks[id] = [...nameOf(key, id), item, tg, keep, min];
}
for (const [id, d] of Object.entries(mobLoot)) { const key = `entity.${id}.name`; mobs[id] = [...nameOf(key, id), d]; }
const version = fs.readFileSync(path.join(BDS, 'VERSION'), 'utf8').trim();
const kb = { items, blocks, mobs, smelt, craft, tags, fish, chests };
const about = `How each thing in BDS ${version} is obtained (node common/kb-build.mjs). items: [ja, en, maxStack, tags, food]; blocks: [ja, en, placing item, tags, drops by tool {tool: {item: [min, max, share]}} (other tools only where they differ from the hand), least tool]; mobs: [ja, en, drops {item: [min, max, chance]}]; smelt: out -> [[input, stations...]]; craft: out -> [[count, station, w, h, [[item|#tag, n]...]]]; tags: tag -> items; fish: item -> chance per cast; chests: item -> chest loot tables`;
const line = (o) => '{\n' + Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n }';
fs.writeFileSync(path.join(TOP, 'common', 'data', 'kb.json'), `{\n "about": ${JSON.stringify(about)},\n "version": ${JSON.stringify(version)},\n` + Object.keys(kb).map((k) => ` ${JSON.stringify(k)}: ${line(kb[k])}`).join(',\n') + '\n}\n');
if (UNKNOWN.size) console.log(`W names that are no item today (kept as written): ${[...UNKNOWN].map(([k, w]) => `${k} (${w})`).join(', ')}`);
console.log(`OK common/data/kb.json: ${Object.keys(items).length} items, ${Object.keys(blocks).length} blocks (${Object.values(blocks).filter((b) => Object.keys(b[4]).length).length} with drops), ${Object.keys(mobs).length} mobs (${Object.values(mobs).filter((m) => Object.keys(m[2]).length).length} with drops), ${Object.keys(smelt).length} smelted, ${Object.keys(craft).length} crafted, ${Object.keys(tags).length} tags, ${Object.keys(fish).length} fished, ${Object.keys(chests).length} in chests`);
