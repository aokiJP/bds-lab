// The goal planner's hands and feet: carries out a plan from goal.cjs in the real world, like a person playing. It walks (A* over
// the blocks this client knows: steps, drops, swimming, and where needed digging through or pillaring up), looks for what it needs
// (what is in sight; LAB_GOAL=xray or `get ... xray`: every block the server sent), mines with the right tool, crafts at a table it
// sets down and picks up again, smelts in its own furnace, fights, milks, shears, fishes, picks up what drops, eats when hungry,
// gets back its things after dying, and plans again whenever the world did not go the way the plan thought.
// Only realplayer.cjs's measured primitives are used (dig, useon, attack/interact, craft, open/move/quick/close, controls).
'use strict';
const G = require('./goal.cjs');

const S = String;
const PASS = /^minecraft:(air|cave_air|void_air|water|flowing_water|light_block.*|structure_void|short_grass|tall_grass|fern|large_fern|deadbush|.*_sapling|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers|leaf_litter|.*_mushroom|snow_layer|seagrass|kelp|kelp_plant|vine|glow_lichen|sweet_berry_bush|.*_carpet|.*torch|redstone_wire|.*rail|.*_button|lever|tripwire|.*pressure_plate|reeds|wheat|carrots|potatoes|beetroot|nether_sprouts|crimson_roots|warped_roots|hanging_roots|cave_vines.*|bush|firefly_bush|short_dry_grass|tall_dry_grass|cactus_flower)$/;
const DANGER = /lava|fire|magma|cactus|sweet_berry_bush|powder_snow|wither_rose|campfire|pointed_dripstone/;
const WATER = /^minecraft:(flowing_)?water$/;
const SEE_THROUGH = /leaves|glass|ice$|water|lava|fence|pane|bars|door|trapdoor|slab|stairs|torch|lantern|leaf_litter|scaffolding|chain|carpet|snow_layer|web|vine/;
const UNBREAKABLE = /^minecraft:(bedrock|barrier|end_portal_frame|command_block|structure_block|jigsaw|end_gateway|end_portal|portal|allow|deny|border_block|reinforced_deepslate|light_block.*)$/;
const COMMON = /^minecraft:(stone|andesite|diorite|granite|tuff|deepslate|dirt|grass_block|netherrack|end_stone|sand|sandstone|gravel)$/;   // known to be there without seeing it (under the ground)
const HOSTILE = /^minecraft:(zombie|husk|drowned|skeleton|stray|bogged|parched|spider|cave_spider|creeper|witch|slime|magma_cube|enderman|zombie_villager_v2|pillager|vindicator|silverfish|endermite|phantom|blaze|wither_skeleton|piglin_brute|hoglin|zoglin|breeze|vex|guardian)$/;
const SCAFFOLD = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack', 'stone', 'andesite', 'diorite', 'granite', 'tuff', 'sand', 'gravel', 'oak_planks', 'spruce_planks', 'birch_planks'];
// block classes (goalVerbs' fl()): 1024 marks a known block, so a known block is never 0
const F_SOLID = 1, F_PASS = 2, F_WATER = 4, F_DANGER = 8, F_FLOOR = 16, F_LAVA = 32, F_WET = 64, F_FALLS = 128, F_OPAQUE = 256, F_UNBREAK = 512;
const FLAG = Symbol('goal.flags');
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);   // Math.hypot without its slow generic path
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DZ8 = [0, 0, 1, -1, 1, -1, 1, -1], DY5 = [0, 1, -1, -2, -3];
const SIX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function goalVerbs(K, H) {
  const { nm, grab: grab0, toolFor, emptyHand } = H;
  // take it in hand; when the client's copy of the inventory was behind (it said "not carried"), read the server's and try again
  const grab = async (it, why) => { try { return await grab0(it, why); } catch (e) { await K.sync(); if ((invMap().get(sh(it)) ?? 0) > 0) return grab0(it, why); throw e; } };
  const say = (v, s) => K.say(`${v}: ${s}`);
  const sh = (x) => S(x ?? '').replace(/^minecraft:/, '');
  const W = K.world;
  const B = (x, y, z) => W.block(x, y, z);
  const bname = (x, y, z) => B(x, y, z)?.name ?? '';
  // every block state is sorted into classes once (bit flags kept on the block table's own object), so walking, digging and
  // seeing test bits instead of running regexes on names; a block not known (not sent yet) is 0
  const flagOf = (b) => {
    const n = b.name, shaped = b.shape?.length > 0, pass = PASS.test(n), sol = shaped && !pass, dang = DANGER.test(n), wat = WATER.test(n);
    return 1024 | (sol ? F_SOLID : 0) | (!sol && !dang ? F_PASS : 0) | (wat ? F_WATER : 0) | (dang ? F_DANGER : 0) | (sol && !dang ? F_FLOOR : 0) | (/lava/.test(n) ? F_LAVA : 0)
      | (/lava|water/.test(n) ? F_WET : 0) | (/sand$|gravel|concrete_powder/.test(n) ? F_FALLS : 0) | (shaped && !pass && !SEE_THROUGH.test(n) ? F_OPAQUE : 0) | (UNBREAKABLE.test(n) || /obsidian/.test(n) ? F_UNBREAK : 0);
  };
  const FLAGS = new WeakMap();
  const fl = (b) => { if (!b) return 0; let f = b[FLAG]; if (f !== undefined) return f; f = FLAGS.get(b); if (f !== undefined) return f; f = flagOf(b); if (Object.isExtensible(b)) b[FLAG] = f; else FLAGS.set(b, f); return f; };
  const fAt = (x, y, z) => fl(W.block(x, y, z));
  const solid = (b) => (fl(b) & F_SOLID) !== 0;
  const isWater = (b) => (fl(b) & F_WATER) !== 0;
  const floorOk = (b) => (fl(b) & F_FLOOR) !== 0;
  // a cell to be in: feet and head free, a floor under it or water to swim in (never with the head under water: no diving)
  const standable = (x, y, z) => {
    const a = fAt(x, y, z); if (!(a & F_PASS)) return false;
    const h = fAt(x, y + 1, z); if (!(h & F_PASS) || (h & F_WATER)) return false;
    return (a & F_WATER) !== 0 || (fAt(x, y - 1, z) & (F_FLOOR | F_WATER)) !== 0;
  };
  const feet = () => { const f = K.feet(); return [Math.floor(f.x), Math.floor(f.y + 0.01), Math.floor(f.z)]; };
  const eye = () => K.eyePos();
  const dist3 = (a, b) => hyp(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const dimName = () => { const d = K.dim(); return typeof d === 'string' ? d.replace(/^minecraft:/, '') : ['overworld', 'nether', 'the_end'][d] ?? 'overworld'; };
  const xray = () => process.env.LAB_GOAL === 'xray' || K.memo.get('goal:xray') === true;
  // (in an RTA each line carries its game time: `get: [12:31] ...`)
  const log = (s) => { if (K.memo.get('goal:quiet') !== true) K.say(`get: ${rtaRun ? `[${G.mmss(Math.round((gnow() - rtaRun.t0) / 1000))}] ` : ''}${s}`); };
  // game time in ms (the client's ticks): RTA times, time limits and waits count game time, so a lagging or sped-up server
  // (LAB_SPEED) still gives the in-game time a speedrun is judged by
  const gnow = () => Number(K.tick()) * 50;
  // an RTA's time is up (its deadline in game time): every long loop (walking legs, digging, waiting out a night or a crop) stops.
  // So does a step that has got nowhere for two and a half minutes (stepGuard, while a step runs): not moved 4 blocks, not 2 up or
  // down, nothing new in the bag - a loop at one spot (a block tried into the player's own cell from every side for five minutes)
  let stepGuard = false, anchor = null, stuckSaid = false, stuckAt = 0, stuckVal = false;
  const stuck = () => {
    if (!stepGuard || K.dead() || sheltering) { anchor = null; return false; }
    if (gnow() - stuckAt < 1000) return stuckVal;
    stuckAt = gnow();
    const f = K.feet(), kinds = new Set(invMap().keys());
    if (!anchor || hyp(f.x - anchor.f.x, f.z - anchor.f.z) > 4 || Math.abs(f.y - anchor.f.y) >= 2 || [...kinds].some((k) => !anchor.kinds.has(k))) { anchor = { f: { ...f }, kinds, at: gnow() }; stuckVal = false; return false; }
    stuckVal = gnow() - anchor.at > 150000;
    if (stuckVal && !stuckSaid) { stuckSaid = true; log('no headway here for two and a half minutes: giving this step up'); }
    return stuckVal;
  };
  const late = () => (!!rtaRun?.deadline && gnow() > rtaRun.deadline) || stuck();
  // wait until cond() holds, at most `ticks` game ticks (or `ms` of game time, the longer). The clients tick with the server's own
  // clock (realplayer: paced by its ticks), so an answer is a few ticks away at any speed; the real-time minimum this had was, at
  // 20x, 200 ticks - ten game seconds - for every wait that did not come true (a fall that did not happen, a block that stayed)
  // (a wait for the server's word: at least three times its usual answer time - on a sped-up server that is 30-50 ticks, not 1-3)
  const until = async (cond, ticks = 10, ms = 500) => { const n = Math.max(ticks, Math.ceil(ms / 50), Math.ceil(3 * (K.lag?.() ?? 0)) + 6); for (let k = 0; !cond() && k < n; k++) await K.ticks(1); return cond(); };

  // ---------------- the inventory ----------------
  const invMap = () => { const m = new Map(); for (const it of K.inv.slots) if (it?.network_id) { const k = sh(nm(it)); m.set(k, (m.get(k) ?? 0) + it.count); } return m; };
  const cnt = (it) => invMap().get(sh(it)) ?? 0;
  const cntRe = (r) => { let c = 0; for (const [k, v] of invMap()) if (r.test(k)) c += v; return c; };
  const bestTool = (req) => { const m = invMap(); return [...G.TOOLS_FOR(req)].reverse().find((t) => (m.get(t) ?? 0) > 0) ?? null; };

  // ---------------- what is in sight ----------------
  // a block is seen when a face of it is open to the air (or water) and nothing opaque stands between the eye and it; once seen it is
  // remembered. xray: every block the server sent counts.
  const seenMem = new Map();
  function lineOfSight(x, y, z) {
    const e = eye(), dx = x + 0.5 - e.x, dy = y + 0.5 - e.y, dz = z + 0.5 - e.z, len = hyp(dx, dy, dz);
    if (len > 96) return false;
    const steps = Math.ceil(len * 3);
    let lx = NaN, ly = NaN, lz = NaN;
    for (let i = 1; i < steps; i++) {
      const px = Math.floor(e.x + (dx * i) / steps), py = Math.floor(e.y + (dy * i) / steps), pz = Math.floor(e.z + (dz * i) / steps);
      if (px === lx && py === ly && pz === lz) continue;
      lx = px; ly = py; lz = pz;
      if (px === x && py === y && pz === z) return true;
      const f = fAt(px, py, pz);
      if (!f || (f & F_OPAQUE)) return false;
    }
    return true;
  }
  const exposed = (x, y, z) => { for (const [a, b, c] of SIX) { const f = fAt(x + a, y + b, z + c); if (f && !(f & F_SOLID)) return true; } return false; };
  // known blocks that match (name regex or test), nearest first; fair = only what a person could have seen from where they were
  function known(test, { max = 24, radius = 96, fair = !xray(), ok = () => true } = {}) {
    const t = test instanceof RegExp ? (b) => test.test(b.name) : test;
    const out = [];
    // (fair: only places open to the air - or seen before, or common rock - are candidates at all, so the nearest ones handed back
    // are ones that could be in sight; the 96 nearest of anything underground were buried and the visible ones never considered)
    const where = fair ? (x, y, z) => seenMem.has(`${x},${y},${z}`) || exposed(x, y, z) || COMMON.test(B(x, y, z)?.name ?? '') : null;
    for (const h of K.findBlocks(t, { max: fair ? max * 8 : max, radius, where })) {
      if (!ok(h)) continue;
      const k = `${h.x},${h.y},${h.z}`;
      if (fair && !COMMON.test(h.block.name) && !seenMem.has(k)) { if (!(exposed(h.x, h.y, h.z) && lineOfSight(h.x, h.y, h.z))) continue; seenMem.set(k, h.block.name); }
      out.push(h);
      if (out.length >= max) break;
    }
    return out;
  }
  const blockTest = (name) => { const r = new RegExp(`^minecraft:(${name})$`); return (b) => r.test(b.name); };
  // a crop is worth breaking for its produce only when grown
  const RIPE = { wheat: ['growth', 7], carrots: ['growth', 7], potatoes: ['growth', 7], beetroot: ['growth', 7], nether_wart: ['age', 3], cocoa: ['age', 2], sweet_berry_bush: ['growth', 3], torchflower_crop: ['growth', 7] };
  const ripeOk = (block) => (h) => { const r = RIPE[block]; return !r || (h.block.states?.[r[0]] ?? 0) >= r[1]; };
  const mobs = (type) => K.nearest(type).filter((e) => !e.gone);

  // ---------------- walking: A* over the known blocks ----------------
  // rough seconds to break with what is carried (for choosing paths); during a search the tools carried are fixed, so what they
  // are and each block's time are worked out once per search (cache)
  let TOOLS = null, DIGC = null, SCAF;
  const toolsNow = () => ({ shovel: !!bestTool({ kind: 'shovel', tier: 1 }), axe: !!bestTool({ kind: 'axe', tier: 1 }), pick: !!bestTool({ kind: 'pickaxe', tier: 1 }) });
  const digSecOf = (b, t) => {
    if (fl(b) & F_UNBREAK) return Infinity;
    const n = b.name;
    if (/leaves|web|vine|glow_lichen|moss_carpet/.test(n)) return 0.4;
    if (/dirt|grass_block|sand|gravel|clay|snow|farmland|mud|mycelium|podzol|soul/.test(n)) return t.shovel ? 0.4 : 0.8;
    if (/log|wood|planks|stem|hyphae|fence|chest|crafting_table|bookshelf|pumpkin|melon/.test(n)) return t.axe ? 1.2 : 3;
    if (!t.pick) return /stone|ore|deepslate|brick|tuff|granite|diorite|andesite|basalt|blackstone|netherrack|terracotta|concrete|iron|copper/.test(n) ? 8 : 1.5;
    return /deepslate/.test(n) ? 1.5 : /netherrack/.test(n) ? 0.2 : 0.8;
  };
  const digSec = (b) => {
    if (!b) return Infinity;
    if (!DIGC) return digSecOf(b, toolsNow());
    let s = DIGC.get(b); if (s === undefined) { s = digSecOf(b, TOOLS); DIGC.set(b, s); }
    return s;
  };
  const scaffoldNow = () => { const m = invMap(); return SCAFFOLD.find((x) => (m.get(x) ?? 0) > 0) ?? null; };
  const scaffoldItem = () => (SCAF !== undefined ? SCAF : scaffoldNow());   // (cached while a found path is walked)
  // neighbours of a standing cell, handed to emit(x, y, z, cost, digs (cells to break first) | null, pillar)
  function moves(x, y, z, o, emit) {
    const swim = (fAt(x, y, z) & F_WATER) !== 0, up2 = fAt(x, y + 2, z);
    for (let d = 0; d < 8; d++) {
      const dx = DX8[d], dz = DZ8[d], nx = x + dx, nz = z + dz, diag = d >= 4;
      if (diag && !(fAt(x + dx, y, z) & fAt(x + dx, y + 1, z) & fAt(x, y, z + dz) & fAt(x, y + 1, z + dz) & F_PASS)) continue;
      let done = false;
      for (let q = 0; q < 5; q++) {
        const dy = DY5[q], ny = y + dy;
        if (dy < -(o.maxDrop ?? 3)) break;   // (running for it: no drop that a knock or the run's speed turns into a fall)
        if (dy === 1 && !(up2 & F_PASS)) continue;
        if (dy < 0 && !(fAt(nx, y, nz) & fAt(nx, y + 1, nz) & F_PASS)) break;
        if (dy < -1 && !(fAt(nx, ny + 1, nz) & F_PASS)) break;
        if (standable(nx, ny, nz)) {
          // (o.dry: not into water at all - running from a zombie, a path over a pond was a swim at a third of the speed, and it
          // caught up: dead in 20 s)
          if (o.dry && ((fAt(nx, ny, nz) | fAt(nx, ny - 1, nz)) & F_WATER)) { done = true; break; }
          const w = fAt(nx, ny, nz) & F_WATER ? 2.5 : 1;
          emit(nx, ny, nz, (diag ? 1.414 : 1) * w + (dy === 1 ? 0.6 : 0) + (dy < 0 ? -dy * 0.3 : 0), null, false);
          done = true; break;
        }
      }
      if (done || diag || !o.dig) continue;
      // dig through (only straight): the wall ahead at feet and head height, or a step up / down cut into it
      tryDig(nx, y, nz, 1, nx, y + 1, nz, nx, y, nz, 0, 0, 0, emit);
      if (up2 & (F_PASS | F_SOLID)) tryDig(nx, y + 1, nz, 1.8, x, y + 2, z, nx, y + 2, nz, nx, y + 1, nz, emit, 3);
      tryDig(nx, y - 1, nz, 1.5, nx, y + 1, nz, nx, y, nz, nx, y - 1, nz, emit, 3);
    }
    if (o.dig) {   // straight down (the floor), or up on a block set under the feet
      const ff = fAt(x, y - 1, z);
      if (ff & F_SOLID) {
        const fb = B(x, y - 1, z), s = digSec(fb), f2 = fAt(x, y - 2, z);
        if (s !== Infinity && (f2 & F_FLOOR) && !(f2 & F_LAVA) && !((fAt(x + 1, y - 1, z) | fAt(x - 1, y - 1, z) | fAt(x, y - 1, z + 1) | fAt(x, y - 1, z - 1)) & F_WET)) emit(x, y - 1, z, 2 + s * 4, [[x, y - 1, z]], false);
      }
      if (o.pillar && !swim && scaffoldItem()) {
        if (up2 & F_PASS) emit(x, y + 1, z, 4, null, true);
        else if (up2 & F_SOLID) { const s = digSec(B(x, y + 2, z)); if (s !== Infinity) emit(x, y + 1, z, 4 + s * 4, [[x, y + 2, z]], true); }
      }
    }
  }
  // one dig-through move: into (nx, ny, nz) after breaking the solid ones of 2 or 3 cells (the third only when n === 3); never opens
  // a way to lava or water, dearer under sand / gravel (it falls)
  function tryDig(nx, ny, nz, c, ax, ay, az, bx, by, bz, cx, cy, cz, emit, n = 2) {
    let digs = null;
    for (let i = 0; i < n; i++) {
      const px = i === 0 ? ax : i === 1 ? bx : cx, py = i === 0 ? ay : i === 1 ? by : cy, pz = i === 0 ? az : i === 1 ? bz : cz;
      const f = fAt(px, py, pz);
      if (!f) return;
      if (!(f & F_SOLID)) { if (f & (F_DANGER | F_WATER)) return; continue; }
      const sec = digSec(B(px, py, pz)); if (sec === Infinity) return;
      if ((fAt(px + 1, py, pz) | fAt(px - 1, py, pz) | fAt(px, py + 1, pz) | fAt(px, py - 1, pz) | fAt(px, py, pz + 1) | fAt(px, py, pz - 1)) & F_LAVA) return;
      if (py === ny + 1 && (fAt(px, py + 1, pz) & F_FALLS)) c += 6;
      c += sec * 4; (digs ??= []).push([px, py, pz]);
    }
    if (!(fAt(nx, ny - 1, nz) & F_FLOOR)) return;
    emit(nx, ny, nz, c, digs, false);
  }
  // a path from where the player stands to a cell where goal(x, y, z) holds (h: a guess of the cost left). Cells are small
  // integers (offsets from the start packed in 24 bits), the open list a binary heap in typed arrays, stale entries skipped.
  function astar(goal, h, o = {}) {
    const [sx, sy, sz] = feet();
    // digging makes every step dearer (a block of stone is ~4 steps of walking), so there the guess is scaled up to match (weighted
    // A*: a way within a few steps of the best, found with a fraction of the nodes)
    const lim = o.nodes ?? 12000, R = Math.min(o.radius ?? 80, 120), wt = o.weight ?? (o.dig ? 2.5 : 1), hw = wt === 1 ? h : (x, y, z) => wt * h(x, y, z);
    const key = (x, y, z) => ((x - sx + 128) << 16) | ((y - sy + 128) << 8) | (z - sz + 128);
    const g = new Map(), prev = new Map(), how = new Map();
    let cap = 4096, hf = new Float64Array(cap), hg = new Float64Array(cap), hk = new Int32Array(cap), size = 0;
    const push = (f, gg, k) => {
      if (size === cap) { cap *= 2; const a = new Float64Array(cap), b = new Float64Array(cap), c = new Int32Array(cap); a.set(hf); b.set(hg); c.set(hk); hf = a; hg = b; hk = c; }
      let i = size++;
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hg[i] = hg[p]; hk[i] = hk[p]; i = p; }
      hf[i] = f; hg[i] = gg; hk[i] = k;
    };
    let popF = 0, popG = 0, popK = 0;
    const pop = () => {
      popF = hf[0]; popG = hg[0]; popK = hk[0];
      const f = hf[--size], gg = hg[size], k = hk[size];
      let i = 0;
      for (;;) { let m = 2 * i + 1; if (m >= size) break; if (m + 1 < size && hf[m + 1] < hf[m]) m++; if (hf[m] >= f) break; hf[i] = hf[m]; hg[i] = hg[m]; hk[i] = hk[m]; i = m; }
      hf[i] = f; hg[i] = gg; hk[i] = k;
    };
    let curK = 0, curG = 0;
    const emit = (nx, ny, nz, c, digs, pil) => {
      if (nx - sx > R || sx - nx > R || nz - sz > R || sz - nz > R || ny - sy > R || sy - ny > R) return;
      const nk = key(nx, ny, nz), ng = curG + c, old = g.get(nk);
      if (old !== undefined && ng >= old) return;
      g.set(nk, ng); prev.set(nk, curK);
      if (digs || pil) how.set(nk, { digs, pil }); else if (how.size) how.delete(nk);
      push(ng + hw(nx, ny, nz), ng, nk);
    };
    TOOLS = toolsNow(); DIGC = new Map(); SCAF = scaffoldItem();
    let end = -1, bestH = Infinity, bestK = -1, n = 0;
    try {
      const k0 = key(sx, sy, sz);
      g.set(k0, 0); push(hw(sx, sy, sz), 0, k0);
      while (size && n < lim) {
        pop();
        if (popG > g.get(popK)) continue;   // a cheaper way here was found after this entry went in
        n++;
        const x = (popK >> 16) - 128 + sx, y = ((popK >> 8) & 255) - 128 + sy, z = (popK & 255) - 128 + sz;
        if (goal(x, y, z)) { end = popK; break; }
        const hv = popF - popG; if (hv < bestH) { bestH = hv; bestK = popK; }
        curK = popK; curG = popG;
        moves(x, y, z, o, emit);
      }
    } finally { TOOLS = null; DIGC = null; SCAF = undefined; }
    const tail = end >= 0 ? end : o.partial && bestK >= 0 ? bestK : -1;
    if (tail < 0) return null;
    const path = [];
    for (let k = tail; k !== undefined; k = prev.get(k)) { const w = how.get(k); path.push({ x: (k >> 16) - 128 + sx, y: ((k >> 8) & 255) - 128 + sy, z: (k & 255) - 128 + sz, ...(w ?? {}) }); }
    path.reverse();
    return { path, complete: end >= 0, nodes: n };
  }
  const stopKeys = () => { Object.assign(K.controls, { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false }); };
  const dug = new Set();   // cells this player broke (its own tunnels are not caves)
  // a cave nearby (open air under the ground that this player did not dig): its walls show what is in them. Dig over to it.
  const cavesTried = new Set();
  async function seekCave(found, depth = null) {
    if (process.env.LAB_CAVES === '0') return false;
    if ((K.attrs().health ?? 20) < 16 || !armed()) return false;   // hurt, or nothing to fight with: not into the dark
    const [, y] = feet(), zone = (h) => `${h.x >> 3},${h.y >> 3},${h.z >> 3}`;
    const air = K.findBlocks((b) => b.name === 'minecraft:air', { max: 600, radius: 28 })
      // (near the depth the ore is common at: a cave 16 below it took an iron run down into the deepslate - slower rock, less iron - for
      // a quarter of an hour)
      .filter((h) => h.y < y + 8 && h.y < 56 && (depth === null || Math.abs(h.y - depth) <= 8) && h.y > -2 && h.d > 5 && !dug.has(`${h.x},${h.y},${h.z}`) && !cavesTried.has(zone(h)) && standable(h.x, h.y, h.z)
        && !K.all().some((e) => HOSTILE.test(e.type) && hyp(e.x - h.x, e.y - h.y, e.z - h.z) < 12));   // not into a cave with a mob in it
    if (!air.length) return false;
    const t = air[0];
    cavesTried.add(zone(t));   // (once: a race dug over to the same cave four times, six minutes)
    log(`a cave at ${t.x} ${t.y} ${t.z}: digging over to it`);
    await travel((a, b, c) => Math.abs(a - t.x) + Math.abs(b - t.y) + Math.abs(c - t.z) <= 2, (a, b, c) => Math.abs(a - t.x) + Math.abs(b - t.y) + Math.abs(c - t.z), { dig: true, radius: 40, legs: 4, nodes: 25000 });
    await K.ticks(4);
    // (in: what is in it looked at first - monsters in sight: the way in shut again, the ore looked for by tunnel instead. A deep
    // cave walked into with a creeper and two zombies in it was a death, the iron tools' pickaxe lost with it)
    if (!found()) await watchBreach();
    return found();
  }
  // a hostile mob right here: deal with it first (called between digs and while walking, not only between steps). busy = the seconds
  // the next thing takes (a log by hand: 3): a zombie that would get here meanwhile is dealt with before, not in the middle of it
  let lastDanger = 0, wetSince = null;
  // up to the air: swim up (the jump key in water) until the head is out, a few blocks of water at most seconds
  async function swimUp(max = 200) {
    for (let t = 0; t < max && !K.dead(); t++) {
      const [x, y, z] = feet(); if (!isWater(B(x, y + 1, z))) break;
      // (a second of swimming up and the head still under: something over the water - the block over it broken if in reach, else
      // over to where the surface is open, or onto land. Drowned under an overhang, twice in a race, 30 s from the air)
      if (t === 20 || t === 90) {
        K.controls.jump = false;
        let top = null; for (let k = 2; k <= 8; k++) { const b = B(x, y + k, z); if (!b) break; if (!isWater(b)) { top = solid(b) ? [x, y + k, z] : null; break; } }
        // (in the water and off the ground a block takes 25 times as long: dirt by hand 19 s. Dug with a dig long enough for that -
        // the usual 10 s dig gave up and began again seven times, and it drowned under the dirt; too long a dig: swum from instead)
        const wetSec = top ? digSec(B(...top)) * 25 : Infinity;
        if (top && hyp(top[0] + 0.5 - eye().x, top[1] + 0.5 - eye().y, top[2] + 0.5 - eye().z) < 4.5 && wetSec < 20) {
          log(`under water with ${sh(bname(...top))} over me: breaking it (${Math.round(wetSec)} s in the water)`);
          try { await toolFor(...top); } catch { /* the hand */ }
          K.controls.jump = true;   // (up against it: the head as high as it goes)
          await K.act('dig', [...top.map(S), S(Math.ceil(wetSec * 26) + 40)]);
          K.controls.jump = false;
        }
        else {
          // the nearest column whose water ends in air, not rock: swim over to it (forward and up)
          let best = null;
          for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
            if (!dx && !dz) continue;
            for (let k = 0; k <= 8; k++) { const b = B(x + dx, y + k, z + dz); if (!b) break; if (!isWater(b)) { if (!solid(b) && (!best || hyp(dx, dz) < best[2])) best = [x + dx, z + dz, hyp(dx, dz)]; break; } }
          }
          if (best) {
            log(`under water with no way up here: over to open water at ${best[0]} ${best[1]}`);
            for (let s = 0; s < 80 && !K.dead() && isWater(B(...feet().map((v, i) => (i === 1 ? v + 1 : v)))); s++) {
              const f = K.feet(); K.look((Math.atan2(-(best[0] + 0.5 - f.x), best[1] + 0.5 - f.z) * 180) / Math.PI, -20);
              K.controls.forward = true; K.controls.jump = true; await K.ticks(1);
            }
            stopKeys();
          }
        }
      }
      K.controls.jump = true; await K.ticks(1);
    }
    K.controls.jump = false;
  }
  // digging in with something at the edge of the hole: fought off first with a sword or a tool (digging on with it hitting was death)
  async function guardHole() {
    if (!armed() && !toolInHand()) return;
    const k = { ...K.controls };
    for (let n = 0; n < 4; n++) {   // (each one at the edge of the hole, hit where it stands: no chasing it off the hole's spot)
      const q = foesNear(3.2).find((x) => MELEE_T.test(x.e.type) || /creeper/.test(x.e.type));
      if (!q || K.dead()) break;
      stopKeys(); await fightOne(q.e, 12, { stay: true });
    }
    Object.assign(K.controls, k);
  }
  let holdStill = false;   // (a place where moving is the danger - the blaze bunker, the dragon's bowl: the watcher below stands down)
  async function danger(busy = 0) {
    if (holdStill) return;
    // (running away and one is at the throat anyway - the way blocked, a pit fallen into: turned on, a blow and its knock-back, then on.
    // A race's runner fell into a pit running from a creeper and stood there while a zombie bit it five times, then the creeper came)
    if (evading && !K.dead() && Number(K.tick()) - lastDanger >= 5) {
      lastDanger = Number(K.tick());
      const q = foesNear(3.2).find((x) => (MELEE_T.test(x.e.type) && x.d < 2.4) || (/creeper/.test(x.e.type) && (x.e.lit || x.d < 3.2)));
      if (q && !cornered) { cornered = true; const k = { ...K.controls }; stopKeys(); try { await fightOne(q.e, 10); } finally { cornered = false; Object.assign(K.controls, k); } }
      return;
    }
    if (evading || Number(K.tick()) - lastDanger < 5) return;
    lastDanger = Number(K.tick());
    const f = K.feet();
    // (keeping away works inside the other reflexes too: on the way back after a death, walking off from a crowd)
    let fight = false;
    if (!K.dead()) { const tp = threatPlan(busy); if (tp?.act === 'evade') { stopKeys(); if ((await evade(tp.why)) && !reflexBusy) { reflexBusy = true; try { await nightHide(); } finally { reflexBusy = false; } } return; } fight = tp?.act === 'fight'; }
    // under water too long (a lake walked into, a pool fallen into): up for air before anything else
    { const [hx, hy, hz] = feet(); if (isWater(B(hx, hy + 1, hz))) { wetSince ??= gnow(); if (gnow() - wetSince > 4000) { stopKeys(); await swimUp(); wetSince = null; } } else wetSince = null; }
    // buried under fallen sand or gravel: out at once (only the reflexes had it, and they run only with monsters near - a race's
    // player suffocated on its stair with none about)
    { const [hx, hy, hz] = feet(); if (GRAVITY.test(bname(hx, hy + 1, hz)) || GRAVITY.test(bname(hx, hy, hz))) { stopKeys(); await digOut(); } }
    if (reflexBusy) { if (sheltering && !K.dead()) await guardHole(); return; }
    if (K.dead() || fight || K.all().some((e) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && hyp(e.x - f.x, e.y - f.y, e.z - f.z) < 5) || (K.attrs()['player.hunger'] ?? 20) <= 14) { const k = { ...K.controls }; stopKeys(); await reflexes(); Object.assign(K.controls, k); }
  }
  // ---------------- keeping out of reach: what a runner does about monsters ----------------
  // one that walks up and hits (a zombie, a spider), one that shoots from afar (a skeleton, a pillager, a witch's potions), a creeper
  const MELEE_T = /:(zombie|zombie_villager_v2|husk|drowned|spider|cave_spider|vindicator|zoglin|hoglin|piglin_brute|silverfish|endermite|slime|magma_cube|wither_skeleton)$/;
  const ARCHER_T = /:(skeleton|stray|bogged|parched|pillager|witch|blaze|breeze)$/;
  // how fast it closes in, blocks a second (a little over the game's own: early rather than late); a baby zombie runs
  // (measured: a zombie chasing covers 2.3 blocks a second; a runner who never dares a 3-second log with one 11 blocks off never gets
  // a sword either - a rainy start ran from zombies for ten minutes)
  const paceOf = (e) => (/vindicator|zoglin|hoglin/.test(e.type) ? 4.5 : /spider/.test(e.type) ? 3.8 : (e.bh ?? 2) < 1.3 && /zombie|husk|drowned/.test(e.type) ? 5.5 : /creeper/.test(e.type) ? 2.5 : 2.7);
  // what a sprinting player (5.6 a second) leaves behind; a baby zombie runs as fast: that one is fought, not run from
  const outrun = (e) => paceOf(e) < 5;
  // a pickaxe, a shovel: a weapon of sorts (2-4 a hit against a fist's 1)
  const TOOLS_AS_WEAPONS = ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'copper_pickaxe', 'golden_pickaxe', 'wooden_pickaxe', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'];
  const toolInHand = () => TOOLS_AS_WEAPONS.some((x) => cnt(x) > 0);
  const SWORDS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'diamond_axe', 'stone_sword', 'copper_sword', 'iron_axe', 'golden_sword', 'wooden_sword', 'stone_axe', 'copper_axe', 'wooden_axe', 'golden_axe'];
  const armed = () => SWORDS.some((x) => cnt(x) > 0);
  // a sword that kills a zombie in three or four blows, not five (stone and up)
  const goodSword = () => SWORDS.slice(0, 7).some((x) => cnt(x) > 0);
  // the monsters within r (not an enderman: left alone it leaves you alone), nearest first; ones far above or below (a cave under
  // the feet, a cliff top) are not counted
  function foesNear(r = 16) {
    const f = K.feet();
    return K.all().filter((e) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && !e.gone).map((e) => ({ e, d: hyp(e.x - f.x, e.y - f.y, e.z - f.z) })).filter((q) => q.d < r && Math.abs(q.e.y - f.y) < 7).sort((p, q) => p.d - q.d);
  }
  const sees = (e) => { const x = eye(); return clear3(x.x, x.y, x.z, Math.floor(e.x), Math.floor(e.y + 1.4), Math.floor(e.z)); };
  // what to do about them now: null (carry on), { act: 'fight' } (here, and a fight worth taking), { act: 'evade', why } (out of
  // reach first). A runner does not trade punches with a zombie: without a sword it keeps away (a zombie walks slower than a player
  // sprints) and works somewhere else; with one, one or two come to it and die; more, or hurt, it keeps away too
  function threatPlan(busy = 0) {
    // (under the ground, one it cannot see is behind rock - the other side of a wall it just shut: not a threat until it shows; a
    // creeper behind the seal had it burrow twenty times in four minutes)
    const under0 = deepUnder(), all = foesNear(18).filter((q) => !under0 || q.d < 2 || sees(q.e)); if (!all.length) return null;
    const a = K.attrs(), hp = a.health ?? 20, food = a['player.hunger'] ?? 20, w = armed(), tool = w || toolInHand();
    const [fx, fy, fz] = feet(), run = food > 6;
    const creep = all.filter((q) => /creeper/.test(q.e.type));
    // (a creeper lights 3.1 from its middle and the sword reaches 3.3: not a fight worth taking - away from it; cornered, the fight
    // (spaceFight) keeps it off and runs when it lights)
    // (with a sword: the runner's way - let it come into reach, hit it, and when it lights run past 6 (it stops there), again until it
    // dies: in the drills never touched, at 1x and 10x. Running from one left it following into the next job - two explosions in
    // a race while "keeping away")
    if (creep.length && creep[0].d < 5.5) return w && hp >= 8 && creep.length === 1 ? { act: 'fight', e: creep[0].e } : run ? { act: 'evade', why: 'a creeper' } : w ? { act: 'fight', e: creep[0].e } : null;
    const melee = all.filter((q) => MELEE_T.test(q.e.type));
    const close = melee.filter((q) => q.d < 6 || (q.d - 1.5) / paceOf(q.e) < 0.6 + busy);   // (here before the next thing is done)
    if (close.length) {
      const fast = close.filter((q) => !outrun(q.e));
      // armed and well: one or two come to the sword; one that cannot be outrun (a baby zombie, a spider on the chase) is fought
      // with whatever is in hand while health lasts; else out of reach, and cornered (nowhere to run, too hungry to) a fight
      // (about to be busy - a log, a block - with it on the way: met first, not taken in the back halfway through)
      // (fought by spacing - kept out of its bite, hit from the edge of reach: in the drills one to three zombies, spiders, drowned
      // never touched the player - so taken on hurt too, and met at 6 blocks, not let in to 4)
      if (w && ((hp >= 6 && close.length <= 2) || (hp >= 10 && close.length <= 3))) return close[0].d < 6 || busy > 0.5 ? { act: 'fight', e: close[0].e } : null;
      // (a pickaxe or a shovel: three or four a blow, and the same spacing - one at a time)
      if (!w && tool && hp >= 8 && close.length === 1 && !/spider/.test(close[0].e.type)) return close[0].d < 6 || busy > 0.5 ? { act: 'fight', e: close[0].e } : null;
      // (bare hands, one or two grown zombies: twenty punches each, but a punch knocks it back like a sword's blow, and spaced it never
      // bites - running from two zombies in the rain for two minutes ended in a death, the logs never cut)
      if (!w && !tool && hp >= 10 && close.length <= 2 && close.every((q) => /zombie|husk|drowned/.test(q.e.type) && !(q.e.bh > 0 && q.e.bh < 1.3)) && !foesNear(14).some((q) => (ARCHER_T.test(q.e.type) && q.d < 12 && sees(q.e)) || (/creeper/.test(q.e.type) && q.d < 8))) return close[0].d < 6 || busy > 0.5 ? { act: 'fight', e: close[0].e } : null;
      // (in a one-wide tunnel or stair under the ground they come one at a time: a sword holds it - running down a dark tunnel
      // with seven behind was death)
      if (w && hp >= 8 && under0) {
        const open = DIRS4.filter(([dx, dz]) => fAt(fx + dx, fy, fz + dz) & F_PASS).length;
        if (open <= 2 && close[0].d < 3.5) return { act: 'fight', e: close[0].e };
      }
      // (hurt, but only one and it is at the throat: two or three blows end it - turning to run shows it the back for a second, and a
      // spider leaps: 4 hp and a stone sword, run from a spider, dead)
      if (w && close.length === 1 && close[0].d < 3 && hp >= 3) return { act: 'fight', e: close[0].e };
      if (fast.length && tool && hp >= 5) return fast[0].d < 4 ? { act: 'fight', e: fast[0].e } : null;
      if (process.env.LAB_GOAL_DEBUG === '2') log(`threat: evade? hp ${hp} w ${w} tool ${tool} close ${close.map((q) => `${sh(q.e.type)} ${q.d.toFixed(1)} bh ${q.e.bh}`).join(',')} others ${foesNear(14).filter((q) => !MELEE_T.test(q.e.type)).map((q) => `${sh(q.e.type)} ${q.d.toFixed(1)}`).join(',')}`);
      if (run && !fast.length) return { act: 'evade', why: `${w ? `hurt (${Math.round(hp)})` : 'no sword'}, ${close.length} ${sh(close[0].e.type).replace(/_v2$/, '')}${close.length > 1 ? ' and more' : ''} ${close[0].d.toFixed(0)} blocks off` };
      return close[0].d < 3.2 ? { act: 'fight', e: close[0].e } : null;
    }
    const shooting = all.filter((q) => ARCHER_T.test(q.e.type) && q.d < 15 && sees(q.e));
    if (shooting.length && !sheltering) {
      // an archer in sight: at it with anything that hits harder than a fist while healthy (it backs off and shoots; standing off
      // is losing); two of them under the ground, or hurt: out of their sight (under the ground: into the rock, see burrow)
      const under = deepUnder();
      if (tool && hp >= 12 && (shooting.length === 1 || (!under && shooting.length <= 2))) return shooting[0].d < 13 ? { act: 'fight', e: shooting[0].e } : null;
      // (one of them right here, already taking blows: finished off - turning away from two archers to dig or run is two archers
      // shooting at the back; a skeleton at 8 health left, the run went for the rock and was shot dead in the doing)
      if (tool && hp >= 8 && shooting[0].d < 4) return { act: 'fight', e: shooting[0].e };
      if ((under || (run && !underway)) && (under || hp < 18)) return { act: 'evade', why: `${shooting.length} ${sh(shooting[0].e.type)} shooting` };
      if (tool && shooting[0].d < 6) return { act: 'fight', e: shooting[0].e };
    }
    return null;
  }
  // out of an archer's sight under the ground: two blocks into the rock beside (away from them), the way in shut behind. A cave's
  // skeletons killed more runs than anything else, and running in a cave runs into the next one. From in there the job goes on (a
  // stair up or a tunnel is dug from anywhere)
  async function burrow(why, moved = false) {
    if (!bestTool({ kind: 'pickaxe', tier: 1 }) || !blockItem()) { if (process.env.LAB_GOAL_DEBUG) log(`burrow: no ${bestTool({ kind: 'pickaxe', tier: 1 }) ? 'blocks' : 'pickaxe'}`); return false; }
    const [x, y, z] = feet(), them = foesNear(24);
    const rock = (cx, cy, cz) => (fAt(cx, cy, cz) & F_SOLID) && !(fAt(cx, cy, cz) & F_UNBREAK) && digSec(B(cx, cy, cz)) < 3;
    const dirsAt = (x, y, z) => {
      const toward = (dx, dz) => them.reduce((sum, q) => sum + ((q.e.x - x - 0.5) * dx + (q.e.z - z - 0.5) * dz) / (q.d || 1), 0);   // lower: away
      return DIRS4.filter(([dx, dz]) => [1, 2].every((k) => rock(x + dx * k, y, z + dz * k) && rock(x + dx * k, y + 1, z + dz * k) && cellsSafe([[x + dx * k, y, z + dz * k], [x + dx * k, y + 1, z + dz * k]]) && (fAt(x + dx * k, y - 1, z + dz * k) & F_FLOOR)))
        .sort((p, q) => toward(...p) - toward(...q));
    };
    const dirs = dirsAt(x, y, z);
    // (none here, the middle of a cave: the nearest wall a few steps off, run to and dug into there - a hole in the floor dug under
    // two skeletons' arrows was a hole never finished: knocked out of it, shot dead)
    if (!dirs.length && !moved) {
      let best = null;
      for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (const dy of [0, -1, 1]) {
        const cx = x + dx, cy = y + dy, cz = z + dz, d = hyp(dx, dz);
        if (d > 6 || (best && d >= best[3]) || !standable(cx, cy, cz) || (fAt(cx, cy, cz) & F_WATER)) continue;
        if (them.some((q) => hyp(q.e.x - cx - 0.5, q.e.z - cz - 0.5) < 3)) continue;   // (not up to one of them)
        if (dirsAt(cx, cy, cz).length) best = [cx, cy, cz, d];
      }
      if (best) {
        log(`${why}: over to the rock wall at ${best[0]} ${best[1]} ${best[2]}`);
        await travel((a, b, c) => a === best[0] && b === best[1] && c === best[2], (a, b, c) => hyp(a - best[0], b - best[1], c - best[2]), { radius: 10, legs: 2, sprint: true, maxDrop: 2, dry: true });
        if (feet().join() === best.slice(0, 3).join()) return burrow(why, true);
      }
    }
    if (!dirs.length) {   // (the middle of a cave: no rock beside - a hole three down with a lid, out when they have gone or it healed)
      if (process.env.LAB_GOAL_DEBUG) log(`burrow: no rock two deep beside ${x} ${y} ${z}: a hole down instead`);
      const t0 = gnow(), heal = canHeal(K.attrs()['player.hunger'] ?? 20);
      const shooting = () => foesNear(20).some((q) => ARCHER_T.test(q.e.type));
      const r = await shelter(false, { why, hold: () => !K.dead() && gnow() - t0 < 45000 && (shooting() || (heal && (K.attrs().health ?? 20) < 14)) });
      return r !== 'failed';
    }
    const [dx, dz] = dirs[0];
    log(`${why}: into the rock, out of their sight`);
    for (const k of [1, 2]) {
      const cx = x + dx * k, cz = z + dz * k;
      for (const cy of [y + 1, y]) if (solid(B(cx, cy, cz)) && !(await breakAt(cx, cy, cz))) return false;
      if (!(await walkInto(cx, y, cz))) return false;
    }
    const shut = (await fillCell([x + dx, y, z + dz])) && (await fillCell([x + dx, y + 1, z + dz]));
    if (shut) { trailAdd(feet()); for (const dy of [0, 1]) walledOff.set([x + dx, y + dy, z + dz].join(), gnow()); }
    log(shut ? `shut in the rock at ${feet().join(' ')}` : 'could not shut the way in');
    return shut;
  }
  // dug into a cave with monsters in it (in sight, 20 blocks): the opening shut at once, before they come - a runner walls off the
  // dark it breaks into when there are eyes in it (the caves' zombies, spiders and witches killed most runs by day). Armed, well
  // and one melee monster: it comes to the sword
  async function watchBreach() {
    if (!deepUnder()) return;
    const foes = foesNear(20).filter((q) => (MELEE_T.test(q.e.type) || ARCHER_T.test(q.e.type) || /creeper/.test(q.e.type)) && sees(q.e));
    if (!foes.length) return;
    if (armed() && (K.attrs().health ?? 20) >= 16 && foes.length === 1 && MELEE_T.test(foes[0].e.type) && !/spider/.test(foes[0].e.type)) return;
    await sealToward(foes);
  }
  // under the ground, in a tunnel or a narrow place: a block into each open cell on their side of the player (feet and head
  // height), a second each - the quickest wall there is (digging into the rock takes four blocks and five seconds; a zombie three
  // blocks off is here in one). Not in the open (more than four cells to shut): false
  async function sealToward(foes) {
    if (!foes.length || !blockItem()) return false;
    const [x, y, z] = feet(), cells = [];
    for (const [dx, dz] of DIRS4) {
      const toward = foes.some((q) => ((q.e.x - (x + 0.5)) * dx + (q.e.z - (z + 0.5)) * dz) / (q.d || 1) > 0.3);
      if (!toward) continue;
      for (const dy of [0, 1]) { const c = [x + dx, y + dy, z + dz]; if (!(fAt(...c) & F_SOLID) && !(fAt(...c) & F_LAVA)) cells.push(c); }
    }
    if (!cells.length || cells.length > 4) return false;
    let n = 0; for (const c of cells) if (await fillCell(c)) { n++; walledOff.set(c.join(), gnow()); }
    log(`${n === cells.length ? 'shut' : 'could not shut'} the way they come (${n}/${cells.length} blocks)`);
    return n === cells.length;
  }
  // out of reach: the way with open ground and none of them in it, sprinting some 20 blocks, again while they still follow
  // close. Several times within a minute (they keep coming, or it keeps walking back into them): away for good (moveAway)
  let evading = false, evades = [], cornered = false;
  async function evade(why) {
    if (evading || sheltering) return false;
    evading = true;
    try {
      evades = evades.filter((t) => gnow() - t < 90000); evades.push(gnow());
      const archersOnly = !foesNear(12).some((q) => MELEE_T.test(q.e.type) || /creeper/.test(q.e.type));
      if (process.env.LAB_GOAL_DEBUG) log(`evade: ${why} (under ${deepUnder()}, archers only ${archersOnly})`);
      // (under the ground: into the rock, the way in shut - an archer cannot see in, a zombie cannot dig; running through caves ran into
      // the next ones: four zombies and a fall, a race's iron run lost)
      // (a tunnel, a narrow passage: a wall on their side first - a second or two; running through the dark ran into the next ones
      // and down a drop: four zombies and a fall)
      // (a creeper too: a block between is most of its blast kept off, and it has spent itself - running from one down a tunnel ran
      // into a skeleton's arrows, or it caught up)
      if (deepUnder() && (await sealToward(foesNear(16).filter((q) => !ARCHER_T.test(q.e.type) || sees(q.e))))) return true;
      if (deepUnder() && !/creeper/.test(why) && !foesNear(2.5).some((q) => MELEE_T.test(q.e.type)) && (await burrow(why))) return true;   // (a creeper: away from it, not a wall between - it blows the wall)
      // (the open floor of a cave, no wall to make: back up this player's own stair a few steps and shut it below - a creeper or a
      // crowd in a cave, run from through the dark, caught up or ran the player into the next ones)
      if (deepUnder() && blockItem() && (await retreat(K.attrs().health ?? 20, false))) return true;
      if (evades.length >= 3) { evades = []; log(`${why}: again and again here - away from this place`); await moveAway(); return true; }
      let ran = false;
      for (let k = 0; k < 4 && !K.dead() && !late(); k++) {
        const foes = foesNear(24), near = foes.filter((q) => (ARCHER_T.test(q.e.type) ? q.d < 16 : q.d < 12));
        if (!near.length) break;
        const f = K.feet();
        const dirs = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);
        // a way towards one of them counts against it, the nearer the more; a way across open ground counts for it
        const against = (ux, uz) => foes.reduce((sum, q) => { const dx = q.e.x - f.x, dz = q.e.z - f.z, dd = hyp(dx, dz) || 1, c = (dx * ux + dz * uz) / dd; return sum + (c > -0.3 ? ((c + 0.3) * 14 * (26 - Math.min(dd, 26))) / 26 : 0); }, 0);
        const ways = dirs.map((u) => { const g = groundAlong(u[0], u[1], 27); return { u, g, v: Math.min(g, 9) * 1.5 - against(u[0], u[1]) + Math.random() * 0.3 }; }).filter((x) => x.g >= 3).sort((p, q) => q.v - p.v);
        if (!ways.length) { if (k === 0) { log(`${why}: nowhere to run`); if (await burrow(why)) return true; } break; }
        const [ux, uz] = ways[0].u, far = 20, tx = f.x + ux * (far + 4), tz = f.z + uz * (far + 4);
        if (k === 0) log(`${why}: keeping away, towards ${Math.round(tx)} ${Math.round(tz)}`);
        else if (process.env.LAB_GOAL_DEBUG) log(`evade ${k}: health ${K.attrs().health}, nearest ${sh(near[0].e.type)} ${near[0].d.toFixed(1)}, towards ${Math.round(tx)} ${Math.round(tz)}`);
        ran = true;
        let tr = null;
        if (process.env.LAB_GOAL_DEBUG) { const t0 = gnow(); tr = setInterval(() => { const g = K.feet(), q = foesNear(24)[0]; log(`evade trace +${((gnow() - t0) / 1000).toFixed(1)}s at ${g.x.toFixed(1)} ${g.y.toFixed(1)} ${g.z.toFixed(1)} yaw ${Math.round(K.yaw())} health ${K.attrs().health} ${q ? `${sh(q.e.type)} ${q.d.toFixed(1)} at ${q.e.x.toFixed(1)} ${q.e.z.toFixed(1)}` : ''} keys ${Object.entries(K.controls).filter(([, v]) => v).map(([k]) => k).join('+')}`); }, 250); }
        // (never ending in water: no sprinting there, no digging in there either - a run ended in a pond and the hole was dug in it)
        try { await travel((x, y, z) => hyp(x + 0.5 - f.x, z + 0.5 - f.z) >= far && !(fAt(x, y, z) & F_WATER), (x, y, z) => hyp(x - tx, z - tz), { radius: 32, legs: 3, sprint: true, maxDrop: 2, dry: !(fAt(...feet()) & F_WATER) }); } finally { if (tr) clearInterval(tr); }
      }
      return ran;
    } finally { evading = false; stopKeys(); }
  }
  async function breakAt(x, y, z) {
    const b = B(x, y, z); if (!b || !solid(b)) return true;
    if (K.dead()) return false;
    // (from under the water a block takes five to twenty-five times as long - stone by hand, minutes of the air it does not have: up
    // for air first, and not dug from under the water at all if it would take more than a few seconds. Two runners drowned in one
    // race digging at stone from a lake, each dig given up after ten seconds and begun again)
    { const [fx, fy, fz] = feet(); if (isWater(B(fx, fy + 1, fz)) && digSec(b) * 25 > 6) { await swimUp(); const [gx, gy, gz] = feet(); if (K.dead() || isWater(B(gx, gy + 1, gz))) return false; } }
    const tb = Date.now();
    await danger(digSec(b));
    if (!solid(B(x, y, z))) return true;
    // (the look round may have moved it - away from a zombie, into the rock: a block out of reach is not dug from there; it was dug
    // at for ten seconds, "stopped before breaking", again and again)
    { const e = eye(); if (hyp(x + 0.5 - e.x, y + 0.5 - e.y, z + 0.5 - e.z) > 5.2) return false; }
    if (process.env.LAB_GOAL_DEBUG && Date.now() - tb > 500) log(`danger check took ${Date.now() - tb} ms`);
    const tt = Date.now();
    await toolFor(x, y, z);
    dug.add(`${x},${y},${z}`);
    // at most 10 s of game time on one block on the way (under water or in the air it is 5-25x slower): then another way. Rock by
    // hand (the pickaxe broke down a mine, no wood for another) is 7.5 s at best and more on a busy server: 30 s, or it never got out
    const byHand = !bestTool({ kind: 'pickaxe', tier: 0 }) && /stone|deepslate|andesite|diorite|granite|tuff|_ore$|netherrack|basalt|blackstone/.test(b.name);
    await K.act('dig', [S(x), S(y), S(z), byHand ? '600' : '200']);
    if (process.env.LAB_GOAL_DEBUG && Date.now() - tt > 1500) log(`dig ${sh(b.name)} took ${Date.now() - tt} ms`);
    await until(() => !solid(B(x, y, z)));
    return !solid(B(x, y, z));
  }
  // one step back along the trail: into the next cell (the head room and the cell dug where a block shut it), or, where the trail
  // goes straight up (a shaft), up on a block set under the feet
  async function stepTo(cx, cy, cz) {
    const [fx, fy, fz] = feet();
    if (cx === fx && cz === fz && cy === fy + 1) {
      if (solid(B(fx, fy + 2, fz)) && !(await breakAt(fx, fy + 2, fz))) return false;
      return pillarUp();
    }
    for (const q of [[fx, fy + 2, fz], [cx, cy + 1, cz], [cx, cy, cz]]) if (solid(B(...q)) && !(await breakAt(...q))) break;
    return walkInto(cx, cy, cz);
  }
  // the top of a jump from feet level y: the feet a block and a fifth up, or over the block and no longer rising (a ceiling cut it
  // short). The server takes the click against where it last had the player - a tick or two behind this client's own count: a
  // click as the feet just clear the block was taken as a block into the player
  async function jumpTop(y) {
    let prev = K.feet().y;
    for (let t = 0; t < 10; t++) {
      await K.ticks(1);
      const fy = K.feet().y;
      if (fy >= y + 1.2 || (fy > y + 1.02 && fy <= prev + 1e-4)) return true;
      if (t >= 3 && fy < y + 0.05) return false;   // (no jump at all: a ceiling, not on the ground)
      prev = fy;
    }
    return false;
  }
  async function pillarUp() {
    const it = scaffoldNow(); if (!it) return false;
    await grab(it, 'pillar');
    const [x, y, z] = feet();
    // (a pickup while the click is on its way changes the stack the click carries: not the stack the server has, and the click was
    // refused - so the drops lying at the feet or falling to them are picked up before the jump)
    { const f0 = K.feet(); let n = 0; for (let t = 0; t < 30 && K.nearest('item').some((e) => hyp(e.x - f0.x, e.z - f0.z) < 1.2 && e.y > f0.y - 1 && e.y < f0.y + 4); t++) { await K.ticks(1); n++; } if (n) await K.ticks(2); }
    // (the middle of the cell first: standing across two columns, the rock over the next one stopped the jump - a shaft out of a
    // trial chamber tried the same jump six times)
    { const f0 = K.feet(); if (Math.abs(f0.x - (x + 0.5)) > 0.2 || Math.abs(f0.z - (z + 0.5)) > 0.2) await centerOn(x, z, 0.15); }
    // (vines, a plant, a cobweb where the feet or the head are: cleared first - in them this client does not see its own jump, and a
    // shaft out of a lush cave stopped at its first block three times)
    for (const dy of [0, 1]) { const b = B(x, y + dy, z); if (b && !/air$/.test(b.name) && !solid(b) && !isWater(b) && !/lava/.test(b.name)) await K.act('dig', [S(x), S(y + dy), S(z), '40']).catch(() => {}); }
    // (the click at the top of the jump, once the feet are over the cell: a click after the landing is a block into the player -
    // in a shaft the rock over the head cuts the jump short, and a click at a fixed 5 ticks came after it)
    K.look(K.yaw(), 90); K.controls.jump = true;
    const top = await jumpTop(y);
    K.controls.jump = false;
    if (!top) { await until(() => Math.abs(K.feet().y - y) < 0.05, 10, 400); return false; }   // (no jump: no click into the player's own cell)
    await K.act('useon', [S(x), S(y - 1), S(z), 'up', 'fast']);
    await until(() => solid(B(x, y, z)), 6);   // (the server's word on the block, lag ticks away at 20x)
    return feet()[1] > y || solid(B(x, y, z));
  }
  // walk a found path; false when the world was not as expected (then plan again)
  // how many cells after path[i] carry on in the same direction on the same level with nothing to dig (a straight run: sprint)
  const straightAhead = (path, i) => {
    const dx = path[i].x - path[i - 1].x, dz = path[i].z - path[i - 1].z;
    let k = i;
    while (k + 1 < path.length) { const a = path[k], b = path[k + 1]; if (b.digs || b.pil || b.y !== a.y || b.x - a.x !== dx || b.z - a.z !== dz) break; k++; }
    return k - i;
  };
  // sprinting costs food (0.1 per block): on a straight run while the food bar is high, or lower with something to eat carried
  const canSprint = () => { const food = K.attrs()['player.hunger'] ?? 20; return food > 12 || (food > 7 && FOOD.some((x) => cnt(x) > 0)); };
  async function follow(path, o = {}) {
    let lastJump = -100;
    const sprintOk = o.sprint ? (K.attrs()['player.hunger'] ?? 20) > 6 : canSprint(), hopFood = (K.attrs()['player.hunger'] ?? 20) > 16;
    let lastHop = -100;
    for (let i = 1; i < path.length; i++) {
      const p = path[i];
      if (p.digs) { stopKeys(); await K.ticks(2); for (const [cx, cy, cz] of p.digs.slice().sort((a, b) => b[1] - a[1])) if (!(await breakAt(cx, cy, cz))) return false; }
      if (p.pil) { stopKeys(); if (!(await pillarUp())) return false; continue; }
      let still = 0, lastPos = K.feet();
      const run = sprintOk && !p.digs && (o.sprint || (p.y === path[i - 1].y && straightAhead(path, i) >= 2));
      // a long straight flat run with room overhead and a full stomach: sprint-jumping (about a quarter faster, twice the hunger)
      const hop = run && hopFood && straightAhead(path, i) >= 4 && path.slice(i, i + 5).every((q) => (fAt(q.x, q.y + 2, q.z) & F_PASS) && !(fAt(q.x, q.y, q.z) & F_WATER));
      for (let t = 0; t < 60; t++) {
        const f = K.feet(), dx = p.x + 0.5 - f.x, dz = p.z + 0.5 - f.z, dh = hyp(dx, dz), fy = Math.floor(f.y + 0.01);
        const next = path[i + 1], turnNext = next && !next.digs && !next.pil && next.y === p.y;
        if ((dh < (turnNext ? 0.6 : 0.3)) && Math.abs(f.y - p.y) < 0.9) break;
        // knocked or carried past this cell (a hit's knockback, a slide down a slope): on from the path cell ahead that it is
        // nearest to, not back to this one (it turned round and walked back into the zombie that had just hit it)
        if (t > 0 && t % 2 === 0) {
          let skip = -1, best = dh;
          for (let j = i + 1; j < Math.min(path.length, i + 6); j++) { const q = path[j]; if (q.digs || q.pil) break; const dq = hyp(q.x + 0.5 - f.x, q.z + 0.5 - f.z); if (Math.abs(q.y - f.y) < 1.2 && dq < best - 0.3) { best = dq; skip = j; } }
          if (skip > 0) { i = skip - 1; break; }
        }
        K.look((Math.atan2(-dx, dz) * 180) / Math.PI, 0);
        if (process.env.LAB_GOAL_DEBUG === '2' && o.sprint) log(`follow t${Number(K.tick())} i=${i}/${path.length} cell ${p.x},${p.y},${p.z} at ${f.x.toFixed(2)},${f.y.toFixed(2)},${f.z.toFixed(2)} dh ${dh.toFixed(2)} yaw ${Math.round(K.yaw())}`);
        K.controls.forward = true;
        K.controls.sprint = run && !isWater(B(Math.floor(f.x), fy, Math.floor(f.z)));
        const inWater = isWater(B(Math.floor(f.x), fy, Math.floor(f.z))) || isWater(B(Math.floor(f.x), fy + 1, Math.floor(f.z)));
        if (inWater) K.controls.jump = true;
        else if (p.y > fy && t - lastJump > 6 && dh < 1.6) { K.controls.jump = true; lastJump = t; }
        else if (hop && dh > 0.8 && Number(K.tick()) - lastHop > 11 && Math.abs(f.y - Math.round(f.y)) < 0.02) { K.controls.jump = true; lastHop = Number(K.tick()); }
        else if (t - lastJump > 2) K.controls.jump = false;
        await K.ticks(1);
        if (t % 10 === 9) await danger();
        const moved = hyp(K.feet().x - lastPos.x, K.feet().z - lastPos.z); lastPos = K.feet();
        if (moved < 0.02) { if (++still > 12) { K.controls.jump = true; await K.ticks(3); K.controls.jump = false; } if (still > 30) { stopKeys(); return false; } } else still = 0;
        if (dh > 6) { stopKeys(); return false; }   // pushed off the way
      }
      K.controls.jump = false;
    }
    stopKeys();
    await K.ticks(2);
    return true;
  }
  // go until goal() holds at the feet cell; long ways in legs (each leg as far as the known world allows)
  async function travel(goal, h, o = {}) {
    let stuck = 0, best = Infinity;
    const deaths0 = K.memo.get('goal:deaths') ?? 0;
    for (let leg = 0; leg < (o.legs ?? 12); leg++) {
      if (late()) return goal(...feet());
      const [x, y, z] = feet();
      if (goal(x, y, z)) return true;
      const hv = h(x, y, z);
      if (hv < best - 0.5) { best = hv; stuck = 0; } else if (++stuck >= 3) { if (process.env.LAB_GOAL_DEBUG) log(`travel: three legs without getting closer at ${x} ${y} ${z} (${hv.toFixed(1)} to go)`); return false; }   // three legs without getting closer: not this way
      await reflexes();
      // died on the way (and came back somewhere else, without the things): the caller decides again, not a walk back down
      // into what killed it
      if ((K.memo.get('goal:deaths') ?? 0) !== deaths0) return false;
      let r = astar(goal, h, { dig: false, partial: true, ...o });
      if (!r || (!r.complete && r.path.length < 3)) r = astar(goal, h, { dig: true, pillar: !!o.pillar, partial: true, nodes: 20000, ...o });
      if (!r || r.path.length < 2) { if (process.env.LAB_GOAL_DEBUG && !goal(...feet())) log(`travel: no way from ${x} ${y} ${z} (${hv.toFixed(1)} to go, ${r ? r.nodes + ' nodes' : 'no path'}; feet ${sh(bname(x, y, z))} head ${sh(bname(x, y + 1, z))} under ${sh(bname(x, y - 1, z))} at ${K.feet().y.toFixed(2)}, unconfirmed ${K.digPending?.()}; 2 under ${sh(bname(x, y - 2, z))} flags ${fAt(x, y - 2, z)} dig ${digSec(B(x, y - 1, z))} wet ${(fAt(x + 1, y - 1, z) | fAt(x - 1, y - 1, z) | fAt(x, y - 1, z + 1) | fAt(x, y - 1, z - 1)) & F_WET})`); return goal(...feet()); }
      if (process.env.LAB_GOAL_DEBUG && o.sprint) log(`path ${r.path.length} (${r.complete ? 'complete' : 'partial'}, ${r.nodes} nodes): ${r.path.slice(0, 24).map((q) => `${q.x},${q.y},${q.z}${q.digs ? 'D' : ''}${q.pil ? 'P' : ''}`).join(' ')}`);
      const ok = await follow(r.path, o);
      if (!ok) { await K.ticks(4); continue; }
      if (r.complete && goal(...feet())) return true;
    }
    return goal(...feet());
  }
  // stand where block x y z is in reach and not hidden behind another block (then it can be mined / clicked)
  const reachOk = (tx, ty, tz, r = 4.2) => (x, y, z) => hyp(x - tx, y + 1.12 - ty, z - tz) <= r && clear3(x + 0.5, y + 1.62, z + 0.5, tx, ty, tz);
  const clearTo = (e, tx, ty, tz) => clear3(e[0], e[1], e[2], tx, ty, tz);
  function clear3(ex, ey, ez, tx, ty, tz) {   // nothing solid between an eye at ex ey ez and the block
    const dx = tx + 0.5 - ex, dy = ty + 0.5 - ey, dz = tz + 0.5 - ez, steps = Math.ceil(hyp(dx, dy, dz) * 4);
    for (let i = 1; i < steps; i++) { const px = Math.floor(ex + (dx * i) / steps), py = Math.floor(ey + (dy * i) / steps), pz = Math.floor(ez + (dz * i) / steps); if (px === tx && py === ty && pz === tz) return true; if (fAt(px, py, pz) & F_SOLID) return false; }
    return true;
  }
  // (standing dry: in water breaking and placing are five times slower and the player drifts)
  async function goToBlock(x, y, z, r = 4.2) {
    const ok = reachOk(x, y, z, r), dry = (a, b, c) => ok(a, b, c) && !(fAt(a, b, c) & F_WATER);
    if (dry(...feet())) return true;
    const h = (a, b, c) => Math.max(0, hyp(a - x, b - y, c - z) - r) * 1.1;
    if (await travel(dry, h, { radius: 96, legs: 6 })) return true;
    return ok(...feet()) || travel(ok, h, { radius: 96 });
  }
  async function goToXZ(x, z, tol = 1.5) { return travel((a, b, c) => hyp(a - x, c - z) <= tol, (a, b, c) => hyp(a - x, c - z), { radius: 96 }); }
  async function goToEntity(e, r = 2.4) {
    for (let k = 0; k < 8; k++) {
      if (e.gone || !K.all().includes(e)) return false;
      const f = K.feet(); if (hyp(e.x - f.x, e.y - f.y, e.z - f.z) <= r) return true;
      const tx = Math.floor(e.x), tz = Math.floor(e.z);
      await travel((a, b, c) => hyp(a + 0.5 - e.x, c + 0.5 - e.z) <= r - 0.6 && Math.abs(b - e.y) < 2.5, (a, b, c) => hyp(a - tx, c - tz), { radius: 64, legs: 1 });
    }
    const f = K.feet(); return hyp(e.x - f.x, e.y - f.y, e.z - f.z) <= r;
  }

  // ---------------- looking for what is not in sight ----------------
  // on the surface: walk out in widening legs (the chunks ahead come in as you go); underground: dig a stair down to the depth
  // where it is common, then a tunnel (its walls are seen as you pass)
  // looking around on the surface: a square spiral around where the search started (the near ground first, like a person who
  // does not want to get lost), each leg a little longer; a leg that is blocked (sea, cliff) is skipped
  const spiral = { at: null, k: 0 };
  const nice = (what) => (/_log\|/.test(what) || /\[a-z_\]\+_log/.test(what) ? 'trees' : String(what).split('|')[0].replace(/_/g, ' '));
  async function exploreSurface(found, what, legs = 10) {
    if (deepUnder()) await toSurface(`look for ${nice(what)}`);   // (trees and animals are not found by walking about under the ground)
    if (deepUnder()) await toSurface(`look for ${nice(what)}`);   // (once more: another way up from where the first try stopped)
    if (deepUnder()) { log(`still under the ground: not looking for ${nice(what)} down here`); return false; }
    const [x0, , z0] = feet();
    // something rare (a village's hay, a pumpkin patch: minutes to find) wants new land in view with every leg, not the same land
    // seen again: legs as long as the ground in view (~64); a tree or grass: short legs close by
    // (trees: no leaves anywhere in view means none near either: long legs too)
    const treeless = /_log|_stem/.test(String(what)) && !known(/^minecraft:[a-z_]*leaves[a-z_0-9]*$/, { max: 1, radius: 96 }).length;
    // (an animal: not a block at all; animals are seen out to ~64, so legs of 48 show new ground each time)
    const w0 = G.wild(String(what).split('|')[0].replace('[a-z_]+', 'oak'));
    const step = treeless || (w0?.[1] ?? 0) >= 400 ? 64 : !w0 ? 48 : 24;
    if (!spiral.at || spiral.step !== step || hyp(spiral.at[0] - x0, spiral.at[1] - z0) > 200 + step * 4) { spiral.at = [x0, z0]; spiral.k = 0; spiral.step = step; }
    const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (let leg = 0; leg < legs && !late(); leg++) {
      if (found()) return true;
      // (the dark on new ground without a real sword: the morning waited for first, dug in - out looking for sheep at night with a
      // wooden one, two spiders, dead, and the shears with it)
      if (nightNow() && process.env.LAB_WORLD === 'normal' && !goodSword() && !sheltering) { log(`night: looking for ${nice(what)} in the morning`); await shelter(); if (K.dead() || late()) break; }
      const k = spiral.k++, side = step * (1 + Math.floor(k / 2));
      // the corner this leg ends at, counted from the spiral's centre
      let cx = spiral.at[0], cz = spiral.at[1];
      for (let i = 0; i <= k; i++) { const s2 = step * (1 + Math.floor(i / 2)); cx += D[i % 4][0] * s2; cz += D[i % 4][1] * s2; }
      log(`looking for ${nice(what)}: walking to ${cx} ${cz}`);
      await travel((q, w, e) => hyp(q - cx, e - cz) <= 6, (q, w, e) => hyp(q - cx, e - cz), { radius: 64, legs: Math.ceil(side / 20) + 1 });
      await K.ticks(6);
    }
    return found();
  }
  // underground moves: never open a way into lava or water; a drop of up to 3 into a cave is fine (a cave shows its walls)
  const wet = (x, y, z) => [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([p, q, r]) => /lava|water/.test(bname(x + p, y + q, z + r)));
  const landing = (x, y, z) => { for (let d = 0; d <= 3; d++) { const b = B(x, y - 1 - d, z); if (!b) return null; if (solid(b)) return /lava|magma/.test(b.name) ? null : y - d; if (/lava/.test(b.name)) return null; } return null; };
  // one step into the next cell by the keys alone (a dug stair or tunnel: nothing to plan), true when the feet are in it
  async function walkInto(nx, ny, nz) {
    for (let t = 0; t < 30; t++) {
      const f = K.feet(), dx = nx + 0.5 - f.x, dz = nz + 0.5 - f.z;
      if (hyp(dx, dz) < 0.3 && Math.floor(f.y + 0.01) <= ny + 0.5) { stopKeys(); if (process.env.LAB_GOAL_DEBUG) log(`walkInto ${nx} ${ny} ${nz}: in after ${t} ticks`); return true; }
      K.look((Math.atan2(-dx, dz) * 180) / Math.PI, 20); K.controls.forward = hyp(dx, dz) > 0.25;
      if (Math.floor(f.y + 0.01) < ny && hyp(dx, dz) < 1.2) K.controls.jump = true; else K.controls.jump = false;
      await K.ticks(1);
      if (t % 10 === 9) await danger();
    }
    stopKeys();
    const [x, , z] = feet();
    if (process.env.LAB_GOAL_DEBUG) log(`walkInto ${nx} ${ny} ${nz}: ended at ${K.feet().x.toFixed(2)} ${K.feet().y.toFixed(2)} ${K.feet().z.toFixed(2)}`);
    return x === nx && z === nz;
  }
  const DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  // the way it dug down (stair and tunnel cells, from the top): walked back up as it came (toSurface), not searched for again
  const trail = () => K.memo.get('goal:trail') ?? [];
  const trailAdd = (c) => { const t = trail(); if (!t.length || t.at(-1).join() !== c.join()) t.push(c); if (t.length > 3000) t.shift(); K.memo.set('goal:trail', t); };
  // (a wall just set against monsters is not dug through again at once: the stair would have opened it the next step)
  const walledOff = new Map();   // "x,y,z" -> game time the block went in
  const cellsSafe = (cells) => !cells.some(([a, b, c]) => wet(a, b, c) || gnow() - (walledOff.get(`${a},${b},${c}`) ?? -1e9) < 90000);
  const lavaNext = (x, y, z) => ((fAt(x + 1, y, z) | fAt(x - 1, y, z) | fAt(x, y + 1, z) | fAt(x, y - 1, z) | fAt(x, y, z + 1) | fAt(x, y, z - 1)) & F_LAVA) !== 0;
  // light in the dark: a torch on the floor behind every 8 blocks of a tunnel or stair (monsters spawn in the dark, and this is where
  // the player comes back through). Torches from coal and a stick when none is carried; coal from an ore beside the tunnel if needed
  let lastTorch = null, torchFailed = -1e9;
  async function lightBehind(back) {
    if (process.env.LAB_WORLD !== 'normal' || !back || underSky()) return;
    const [x, y, z] = feet();
    if (lastTorch && hyp(x - lastTorch[0], y - lastTorch[1], z - lastTorch[2]) < 8) return;
    if (!cnt('torch')) {
      if (!cnt('coal') && !cnt('charcoal') && bestTool({ kind: 'pickaxe', tier: 1 })) {   // coal ore in reach: take it
        const h = known(/^minecraft:(deepslate_)?coal_ore$/, { max: 1, radius: 5 })[0];
        if (h && !lavaNext(h.x, h.y, h.z) && reachOk(h.x, h.y, h.z)(x, y, z)) { await breakAt(h.x, h.y, h.z); await collect({ x: h.x + 0.5, y: h.y, z: h.z + 0.5 }, 3, /coal/); }
      }
      if ((!cnt('coal') && !cnt('charcoal')) || !cnt('stick') || gnow() - torchFailed < 60000) return;
      await closeScreen(); await K.act('craft', ['torch', '1']); await K.sync();
      if (!cnt('torch')) { torchFailed = gnow(); return; }   // (refused: not again at every step)
    }
    const [bx, by, bz] = back;
    if (!(fAt(bx, by, bz) & F_PASS) || !(fAt(bx, by - 1, bz) & F_FLOOR) || (fAt(bx, by, bz) & F_WATER)) return;
    try { await grab('torch', 'light'); } catch { return; }
    K.lookAt(bx + 0.5, by, bz + 0.5);
    await K.act('useon', [S(bx), S(by - 1), S(bz), 'up']);
    await K.ticks(2);
    if (/torch/.test(bname(bx, by, bz))) lastTorch = [bx, by, bz];
  }
  // water beside the cells about to be dug: a block into each water cell next to them (a runner plugs an aquifer rather than walk
  // away from it: a stair turned back by water at y=51 five times, six minutes of a race). Lava is not plugged: that way is left
  let plugged = 0, plugTries = 0;
  async function plugWater(cells) {
    if (plugged > 40 || plugTries > 80 || !blockItem()) return false;
    const inWay = new Set(cells.map((c) => c.join()));
    // (never the cells the player stands in: a block does not go there - one was tried from every side for five minutes, water
    // flowing back, until the night came and a zombie with it)
    const [fx, fy, fz] = feet(), mine = new Set([[fx, fy, fz].join(), [fx, fy + 1, fz].join()]);
    for (let pass = 0; pass < 2; pass++) {
      const wetCells = [];
      for (const [a, b, c] of cells) for (const [p, q, r] of [[0, 0, 0], ...SIX]) {
        const w = [a + p, b + q, c + r], f = fAt(...w);
        if (f & F_LAVA) return false;
        if ((f & F_WATER) && !mine.has(w.join()) && !wetCells.some((x) => x.join() === w.join())) wetCells.push(w);
      }
      if (!wetCells.length) return true;
      if (wetCells.length > 8) return false;   // (a lake, not a leak)
      for (const w of wetCells) { if (inWay.has(w.join())) continue; plugTries++; if (await fillCell(w)) plugged++; }
      // (the ones in the way itself: a block there, then dug out again with the rest - water only flows in from an open side)
      for (const w of wetCells) if (inWay.has(w.join())) { plugTries++; if (await fillCell(w)) plugged++; }
      await K.ticks(4);
    }
    return cellsSafe(cells);
  }
  // the column under the feet whole rock for four blocks (a shaft can go down it): solid, breakable in a few seconds, nothing that
  // falls, no water or lava beside the next two
  const shaftOk = (x, y, z) => {
    for (let k = 1; k <= 4; k++) { const f = fAt(x, y - k, z); if (!(f & F_SOLID) || (f & (F_UNBREAK | F_FALLS | F_WET)) || digSec(B(x, y - k, z)) > 3) return false; }
    for (const k of [1, 2]) for (const [dx, dz] of DIRS4) if (fAt(x + dx, y - k, z + dz) & (F_WET | F_LAVA)) return false;
    return !(fAt(x, y + 2, z) & F_FALLS);
  };
  // digging these cells would open into a cave or a dungeon with monsters in it (air beside them that this player did not dig, a
  // monster within 12 of it - heard through the rock, like the groans a player hears; a spawner): that way is not taken (a stair
  // opened into a room of seven zombies)
  const breachRisk = (cells) => {
    const mine = new Set(cells.map((c) => c.join())), [fx, fy, fz] = feet();
    for (const [a, b, c] of cells) for (const [p, q, r] of SIX) {
      const n = [a + p, b + q, c + r], k = n.join();
      if (mine.has(k) || dug.has(k) || (n[0] === fx && n[2] === fz && (n[1] === fy || n[1] === fy + 1))) continue;
      const bl = B(...n); if (!bl || bl.name !== 'minecraft:air' && bl.name !== 'minecraft:cave_air') continue;
      if (K.all().some((e) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && hyp(e.x - n[0], e.y - n[1], e.z - n[2]) < 12)) return true;
    }
    return known(/^minecraft:mob_spawner$/, { max: 1, radius: 8, fair: false }).length > 0;
  };
  // a stair straight down, like a person digs one: the next cell ahead one lower, head room cleared; turns away from lava, water and
  // deep holes
  async function stairDown(targetY, found) {
    underway++;
    try { return await stairDown0(targetY, found); } finally { underway--; }
  }
  async function stairDown0(targetY, found) {
    let d = Math.floor(Math.random() * 4), stuck = 0, steps = 0, sealed = false;
    { const t = trail(), f = feet(); if (!t.length || hyp(t.at(-1)[0] - f[0], t.at(-1)[1] - f[1], t.at(-1)[2] - f[2]) > 3) K.memo.set('goal:trail', [f]); }   // (a new way down: a new trail)
    const why = new Map();   // what stopped each way (said when it gives up: water, a drop, a block that would not break, a step it could not take)
    const no = (r) => why.set(r, (why.get(r) ?? 0) + 1);
    for (let k = 0; k < 200 && stuck < 12 && !late(); k++) {
      if (found()) return true;
      if (!bestTool({ kind: 'pickaxe', tier: 1 }) && !(await newPickaxe())) { log('no pickaxe (broken, or lost in a death)'); return false; }
      const [x, y, z] = feet();
      if (y <= targetY) return found();
      let moved = false, drop = false;
      // straight down, a block at a time, where the rock under is whole for three more (no cave, no water or lava beside, nothing
      // that falls): a stair digs three blocks for each level down, this one - the stair from y=68 to 16 was three and a half
      // minutes of an iron run. The way back up is a pillar (toSurface: the trail goes straight up there). At night the shaft is
      // shut over the head three blocks down (nothing drops in after the player)
      if (!process.env.LAB_NO_SHAFT && y - 1 > targetY && shaftOk(x, y, z) && scaffoldNow() && !breachRisk([[x, y - 1, z]])) {
        if (await breakAt(x, y - 1, z)) {
          await until(() => feet()[1] < y, 12, 400);
          if (feet()[1] < y) {
            moved = true; stuck = 0; steps++; trailAdd(feet());
            if (!sealed && steps >= 3 && nightNow()) { const [cx, cy, cz] = feet(); sealed = await fillCell([cx, cy + 2, cz]); if (sealed) log(`night: the shaft shut over me at y=${cy}`); }
            await watchBreach();
          }
        }
      }
      for (let t = 0; t < 4 && !moved; t++) {
        const dd = (d + t) % 4, [dx, dz] = DIRS4[dd], nx = x + dx, nz = z + dz;
        // (a step down walks in at head height and drops: the cell over the current head is not in the way - it was a quarter of
        // every stair's digging)
        const cells = [[nx, y + 1, nz], [nx, y, nz], [nx, y - 1, nz]];
        if (!cellsSafe(cells) && !(await plugWater(cells))) { no('water or lava'); continue; }
        if (breachRisk(cells)) { no('monsters behind the rock'); continue; }
        // (sand or gravel over the step: it comes down into the stair, onto the head - a race's player suffocated at y=21)
        if (fAt(nx, y + 2, nz) & F_FALLS) { no('sand or gravel over it'); continue; }
        if (landing(nx, y - 1, nz) === null) { if (B(nx, y - 2, nz)) { no('a drop'); drop = true; } else no('not loaded'); continue; }
        let ok = true;
        for (const [a, b, c] of cells) if (solid(B(a, b, c)) && !(await breakAt(a, b, c))) { ok = false; no(`${sh(bname(a, b, c))} would not break`); break; }
        if (!ok) continue;
        if (await walkInto(nx, y - 1, nz)) { moved = true; d = dd; } else no('could not step in');
      }
      if (moved && feet()[0] === x && feet()[2] === z) { /* (a shaft step: counted above) */ } else if (moved) {
        stuck = 0; steps++; trailAdd(feet());
        // night: three steps down, the way behind shut (the cell stepped out of and the one over the head): nothing follows down
        if (!sealed && steps >= 3 && nightNow() && blockItem()) {
          const [cx, cy, cz] = feet();
          sealed = (await fillCell([x, y, z])) && (await fillCell([cx, cy + 2, cz]));
          if (sealed) log(`night: the stair shut behind me at y=${cy}`);
        }
        if (!sealed || !nightNow()) await lightBehind([x, y, z]);
        await watchBreach();
      } else {   // water or lava all around, or a drop: move over a few blocks at this level and try again from there
        stuck++; d = (d + 1) % 4;
        // a cave under the stair (a drop that way): down into it the way the path finder climbs (steps, short drops, a block dug)
        const quiet = () => !K.all().some((e) => HOSTILE.test(e.type) && hyp(e.x - K.feet().x, e.y - K.feet().y, e.z - K.feet().z) < 16);   // (not down among monsters)
        if (drop && stuck % 3 === 1 && quiet()) {
          const y0 = y, lo = Math.max(targetY, y0 - 6);
          if (await travel((a, b) => b <= lo, (a, b) => Math.max(0, b - lo) * 1.5, { dig: true, radius: 24, legs: 3, nodes: 20000 })) { log(`stair down: climbed down into a cave to y=${feet()[1]}`); stuck = 0; continue; }
        }
        if (stuck % 2 === 0) { const [dx, dz] = DIRS4[d]; for (let i = 0; i < 5; i++) { const [a, b, c] = feet(), nx = a + dx, nz = c + dz, cells = [[nx, b + 1, nz], [nx, b, nz]]; if (!cellsSafe(cells) || landing(nx, b, nz) === null) break; let ok = true; for (const q of cells) if (solid(B(...q)) && !(await breakAt(...q))) { ok = false; break; } if (!ok || !(await walkInto(nx, b, nz))) break; } }
      }
      await reflexes();
      if (k % 10 === 9) log(`stair down: y=${feet()[1]} (to ${targetY})`);
    }
    if (stuck >= 12) log(`stair down stopped at y=${feet()[1]}: ${[...why].map(([r, n]) => `${r} x${n}`).join(', ')}`);
    return found();
  }
  // a stair straight up, like a person digs out of a mine: the cell ahead one higher and the head room over it cleared, a block set
  // under it where there is no floor; never into water, lava or under sand and gravel. Until open sky over the head (or y)
  async function stairUp(targetY) {
    let d = Math.floor(Math.random() * 4), stuck = 0;
    const why = new Map(), no = (r) => why.set(r, (why.get(r) ?? 0) + 1);
    underway++;
    try {
      for (let k = 0; k < 220 && stuck < 12 && !late(); k++) {
        const [x, y, z] = feet();
        if (skyOver() || y >= targetY + 8) return true;   // (leaves over the head are the sky too: a forest)
        if (!bestTool({ kind: 'pickaxe', tier: 1 }) && !(await newPickaxe())) { log(`stair up: no pickaxe at y=${y}`); return false; }
        let moved = false;
        for (let t = 0; t < 4 && !moved; t++) {
          const dd = (d + t) % 4, [dx, dz] = DIRS4[dd], nx = x + dx, nz = z + dz;
          const cells = [[x, y + 2, z], [nx, y + 1, nz], [nx, y + 2, nz]];
          if (!cellsSafe(cells)) { no('water or lava'); continue; }
          if (fAt(x, y + 3, z) & F_FALLS) { no('sand or gravel over my head'); continue; }
          if (!(fAt(nx, y, nz) & F_FLOOR) && !(await fillCell([nx, y, nz]))) { no('no floor'); continue; }
          let ok = true;
          // (sand or gravel over the next cell falls into it as it is dug: dug again until it stays open)
          for (let r = 0; r < 8 && ok && cells.some((q) => solid(B(...q))); r++) {
            for (const [a, b, c] of cells) if (solid(B(a, b, c)) && !(await breakAt(a, b, c))) { ok = false; no(`${sh(bname(a, b, c))} would not break`); break; }
            if (ok && (fAt(nx, y + 3, nz) & F_FALLS)) await K.ticks(6);
          }
          if (!ok || cells.some((q) => solid(B(...q)))) { if (ok) no('sand or gravel kept falling'); continue; }
          if (await walkInto(nx, y + 1, nz)) { await until(() => feet()[1] > y, 6, 300); if (feet()[1] > y) { moved = true; d = dd; } else no('could not step up'); } else no('could not step in');
        }
        if (moved) stuck = 0;
        else {   // water or lava all round (an aquifer), sand over it: a few blocks over at this level, then up again from there
          stuck++; d = (d + 1) % 4;
          if (stuck % 2 === 0) { const [dx, dz] = DIRS4[d]; for (let i = 0; i < 4; i++) { const [a, b, c] = feet(), nx = a + dx, nz = c + dz, cells = [[nx, b + 1, nz], [nx, b, nz]]; if (!cellsSafe(cells) || !(fAt(nx, b - 1, nz) & F_FLOOR)) break; let ok = true; for (const q of cells) if (solid(B(...q)) && !(await breakAt(...q))) { ok = false; break; } if (!ok || !(await walkInto(nx, b, nz))) break; } }
        }
        await reflexes();
        if (k % 10 === 9) log(`stair up: y=${feet()[1]} (to ${targetY})`);
      }
      if (stuck >= 12) log(`stair up stopped at y=${feet()[1]}: ${[...why].map(([r, n]) => `${r} x${n}`).join(', ')}`);
      return skyOver();
    } finally { underway--; }
  }
  // straight up through the rock, the way a runner leaves a mine: the block over the head dug, a jump, the block set under the
  // feet - one dig a level where a stair digs three (a stair up from y=7 to a start on a mountain at y=106 took five minutes and
  // two pickaxes and did not get there). Never under water, lava, sand or gravel (it would come down the shaft onto the head): a
  // step aside through the rock and up from there
  async function shaftUp(targetY) {
    let side = 0, d = Math.floor(Math.random() * 4), why = '', digFails = 0;
    const y0 = feet()[1], t0 = gnow();
    underway++;
    try {
      for (let k = 0; k < 400 && !late() && !K.dead(); k++) {
        const [x, y, z] = feet();
        if (skyOver() || y >= targetY + 8) break;
        if (!bestTool({ kind: 'pickaxe', tier: 1 }) && !(await newPickaxe())) { why = 'no pickaxe'; break; }
        if (!scaffoldNow()) { why = 'nothing to stand on'; break; }
        // (two cells over the head kept open: a whole jump - under a ceiling one block up the jump is cut short and the click at its
        // top has a tick or two to land in)
        const c = [x, y + 2, z], c2 = [x, y + 3, z], over = [c, c2];
        const clear = !cellsSafe(over) ? 'water or lava over it' : (fAt(x, y + 3, z) | fAt(x, y + 4, z)) & F_FALLS ? 'sand or gravel over it' : (fAt(...c) | fAt(...c2)) & F_UNBREAK ? 'bedrock' : over.some((q) => (fAt(...q) & F_SOLID) && digSec(B(...q)) >= 4) ? 'too hard' : breachRisk(over) ? 'monsters behind the rock' : '';
        if (clear) {   // (a step aside at this level: two cells of rock, the floor under them whole, the column over that one tried next)
          if (++side > 8) { why = clear; break; }
          let moved = false;
          for (let t = 0; t < 4 && !moved; t++) {
            const [dx, dz] = DIRS4[(d + t) % 4], nx = x + dx, nz = z + dz, cells = [[nx, y + 1, nz], [nx, y, nz]];
            if (!cellsSafe(cells) || !(fAt(nx, y - 1, nz) & F_FLOOR) || (fAt(nx, y + 2, nz) & F_FALLS) || breachRisk(cells)) continue;
            let ok = true;
            for (const q of cells) if (solid(B(...q)) && !(await breakAt(...q))) { ok = false; break; }
            if (ok && (await walkInto(nx, y, nz))) { moved = true; d = (d + t) % 4; }
          }
          if (!moved) { why = `${clear}, no way aside`; break; }
          if (process.env.LAB_GOAL_DEBUG) log(`shaft up: ${clear} at y=${y}: a step aside to ${feet().join(' ')}`);
          continue;
        }
        let open = true;
        for (const q of over) {
          if ((fAt(...q) & F_SOLID) && !(await breakAt(...q))) { why = `${sh(bname(...q))} over the head would not break`; open = false; break; }
          await until(() => !(fAt(...q) & F_SOLID), 6, 300);
          if (fAt(...q) & F_SOLID) { why = `${sh(bname(...q))} over the head still there`; open = false; break; }
        }
        // (a dig let go for a monster - the look round before it fought or stepped away - is dug again from where it stands now,
        // three times: the shaft was given up at the first, and the stair beside it ran into water)
        if (!open) { if (++digFails > 3) break; continue; }
        // (the drop of the block just dug picked up first: jumping at once was quicker by the jump, and a click in four came as the
        // drop was taken and was refused - slower in all. A click refused all the same: again)
        let up = false;
        for (let r = 0; r < 3 && !up && !K.dead(); r++) {
          if (!(await pillarUp())) { why = 'the pillar block did not go down'; continue; }
          await until(() => feet()[1] > y, 8, 400);
          up = feet()[1] > y;
          if (!up) why = 'did not get up onto the block';
        }
        if (!up) break;
        if (k % 4 === 3) await reflexes();
        if (k % 16 === 15) log(`shaft up: y=${feet()[1]} (to ${targetY})`);
      }
      const up = feet()[1] - y0;
      log(`shaft up: ${up} blocks in ${Math.round((gnow() - t0) / 1000)} s${skyOver() ? ', out' : `, stopped at y=${feet()[1]}${why ? `: ${why}` : ''}`}`);
      return skyOver();
    } finally { underway--; }
  }
  // a 1x2 tunnel at this depth; its walls are what gets seen; a branch now and then
  async function tunnel(len, found, depth = null) {
    let d = Math.floor(Math.random() * 4), stuck = 0, dist = 0;
    const triedCave = new Set(), walked = new Set();
    if (await seekCave(found, depth)) return true;
    for (let k = 0; dist < len && k < len * 2 && stuck < 8 && !late(); k++) {
      if (found()) return true;
      if (!bestTool({ kind: 'pickaxe', tier: 1 }) && !(await newPickaxe())) { log('no pickaxe (broken, or lost in a death)'); return false; }
      if (dist && dist % 16 === 0 && !triedCave.has(dist)) { triedCave.add(dist); if (await seekCave(found, depth)) return true; }
      const [x, y, z] = feet();
      let moved = false;
      for (const t of [0, 1, 3]) {   // ahead, else a side; never back along the tunnel (that only walks it again)
        if (moved) break;
        const dd = (d + t) % 4, [dx, dz] = DIRS4[dd], nx = x + dx, nz = z + dz;
        const cells = [[nx, y + 1, nz], [nx, y, nz]];
        if (!cellsSafe(cells) || landing(nx, y, nz) === null || breachRisk(cells)) continue;
        let ok = true;
        for (const [a, b, c] of cells) if (solid(B(a, b, c)) && !(await breakAt(a, b, c))) { ok = false; if (process.env.LAB_GOAL_DEBUG) log(`tunnel: ${sh(bname(a, b, c))} at ${a} ${b} ${c} would not break`); break; }
        if (ok && (await walkInto(nx, y, nz))) { moved = true; d = dd; }
      }
      if (moved) await lightBehind([x, y, z]);
      if (moved) trailAdd(feet());
      if (moved) await watchBreach();
      const cell = feet().join(',');
      if (moved && !walked.has(cell)) { walked.add(cell); dist++; stuck = 0; if (dist % 24 === 0) d = (d + 1) % 4; } else { stuck++; d = (d + 1) % 4; }
      await reflexes();
      if (k % 20 === 19) log(`tunnel: ${dist} blocks, at ${feet().join(' ')}`);
    }
    return found();
  }
  // find (and walk up to reach) a block matching `name`; explores when none is in sight
  // blocks walked at and not got to (a tree on a ledge, behind a village wall), with the rest of that trunk: not the target again for
  // three minutes, in this step or the next
  const unreach = new Map();
  const unreachable = (q) => gnow() - (unreach.get(`${q.x},${q.y},${q.z}`) ?? -1e9) < 180000;
  const markUnreachable = (h, names) => {
    const t = gnow(); unreach.set(`${h.x},${h.y},${h.z}`, t);
    if (/_log|_stem/.test(names)) for (const q of known(blockTest(names), { max: 64, radius: 24, fair: false })) if (hyp(q.x - h.x, q.z - h.z) <= 1.5 && Math.abs(q.y - h.y) <= 8) unreach.set(`${q.x},${q.y},${q.z}`, t);
  };
  async function findBlock(name, o = {}) {
    const test = blockTest(name), ok = o.ok ?? (() => true), skip = o.skip ?? new Set();
    // (while weak - no sword, or hurt - not a block with monsters beside it: another one, else looked for elsewhere)
    const weak = !armed() || (K.attrs().health ?? 20) < 12, foes = weak ? foesNear(64).filter((q) => !ARCHER_T.test(q.e.type)) : [];
    const guarded = (h) => foes.some((q) => hyp(q.e.x - h.x, q.e.z - h.z) < 9 && Math.abs(q.e.y - h.y) < 6);
    const pick = () => known(test, { max: 12, ok: (h) => ok(h) && !skip.has(`${h.x},${h.y},${h.z}`) && !guarded(h) })[0] ?? null;
    let h = pick();
    if (!h) {
      const first = name.split('|')[0].replace('[a-z_]+', 'oak'), w = G.wild(first);
      if (!w || (w[2] ?? 'overworld') !== dimName()) return null;
      if (w[3] !== undefined && !COMMON.test('minecraft:' + first)) {   // an ore: down to its depth, then tunnel
        log(`${name} not in sight: digging down to y=${w[3]}`);
        underway++;   // (on the way under: at night no hiding on the surface, the stair shuts itself)
        try {
          if (!nightNow()) await provision();   // (not at night: no walking about among the monsters for it)
          let top = feet();   // where this way down started
          K.memo.set('goal:stairTop', top);   // (the way back up: toSurface)
          for (let tries = 0; tries < 4 && !pick(); tries++) {
            if (tries && feet()[1] > w[3] + 8) {   // stopped high above the depth (water or lava all round down there): back up the stair and off somewhere else
              const a = Math.random() * Math.PI * 2, tx = Math.round(top[0] + Math.cos(a) * 40), tz = Math.round(top[2] + Math.sin(a) * 40), t0 = top;
              log(`blocked at y=${feet()[1]}: back up and over to ${tx} ${tz}`);
              if (feet()[1] < t0[1] - 3) await travel((q, r, t) => Math.abs(q - t0[0]) + Math.abs(r - t0[1]) + Math.abs(t - t0[2]) <= 2, (q, r, t) => Math.abs(q - t0[0]) + Math.abs(r - t0[1]) + Math.abs(t - t0[2]), { dig: true, pillar: true, radius: 64, legs: 8, nodes: 20000 });
              await travel((q, r, t) => hyp(q - tx, t - tz) <= 3, (q, r, t) => hyp(q - tx, t - tz), { radius: 64, legs: 6 });
              top = feet(); K.memo.set('goal:stairTop', top);
            } else if (tries) {   // at the depth and nothing along the tunnel: dig over to somewhere else at this depth, then again
              const [x0, y0, z0] = feet(), a = Math.random() * Math.PI * 2, tx = Math.round(x0 + Math.cos(a) * 20), tz = Math.round(z0 + Math.sin(a) * 20);
              log(`nothing here: moving over to ${tx} ${tz}`);
              await travel((q, r, t) => hyp(q - tx, t - tz) <= 3, (q, r, t) => hyp(q - tx, t - tz) + Math.abs(r - y0), { dig: true, radius: 40, legs: 4, nodes: 20000 });
            }
            if (!bestTool({ kind: 'pickaxe', tier: 1 }) && !(await newPickaxe())) break;
            await stairDown(w[3], () => !!pick());
            if (!pick()) await tunnel(o.tunnel ?? 120, () => !!pick(), w[3]);
          }
        } finally { underway--; }
      } else {
        if (/_log|_stem/.test(name)) {   // a tree's logs hide under its leaves; the leaves are seen from far off
          // (not the same leaves again: the ones left hanging over a tree already cut down, or over logs it cannot reach)
          const seen = K.memo.get('goal:leavesSeen') ?? new Set(), cell = (q) => `${Math.floor(q.x / 8)},${Math.floor(q.z / 8)}`;
          K.memo.set('goal:leavesSeen', seen);
          const lv = known(/^minecraft:[a-z_]*leaves[a-z_0-9]*$/, { max: 24, radius: 96 }).filter((q) => q.d > 5 && !seen.has(cell(q)));
          for (const l of lv.filter((q, i) => lv.findIndex((r) => cell(r) === cell(q)) === i).slice(0, 3)) {
            if (pick()) break;
            seen.add(cell(l));
            log(`leaves at ${l.x} ${l.y} ${l.z}: a tree under them`);
            await travel((a, b, c) => hyp(a - l.x, c - l.z) <= 4, (a, b, c) => hyp(a - l.x, c - l.z), { radius: 96, legs: 6 });
          }
        }
        if (!pick()) await exploreSurface(() => !!pick(), name, o.legs ?? 10);
      }
      h = pick();
    }
    return h;
  }

  // ---------------- picking up what dropped ----------------
  // where it died and left its things (monsters round them, or dead there twice): not walked back into for them while they last
  // (five minutes) - a plan's "pick up the sword lying nearby" was the way back into the crowd that had just killed it
  const deathZones = [];
  const inDeathZone = (q) => deathZones.some((z) => gnow() - z.t < 300000 && hyp(q.x - z.x, q.y - z.y, q.z - z.z) < 12);
  async function collect(around, r = 6, want = null) {
    // (blocks gone by this client's own count: what they drop shows up with the server's answer, a few ticks later on a sped-up server)
    for (let t = 0; t < 80 && K.digPending?.() > 0; t++) await K.ticks(1);
    await K.ticks(6);
    // (one that could not be got to, or was stood by and not taken - in the leaves, on a ledge: not tried again; the same log in a
    // tree top was walked at twelve times a pickup, the pickups of one tree took two and a half minutes)
    for (let k = 0; k < 12; k++) {
      const f = K.feet();
      const items = K.nearest('item').filter((e) => !e.gone && hyp(e.x - (around?.x ?? f.x), e.z - (around?.z ?? f.z)) <= r && Math.abs(e.y - (around?.y ?? f.y)) < 6 && (!want || want.test(e.item ?? '')) && !inDeathZone(e));
      if (!items.length) return;
      const e = items[0];
      const reached = await travel((a, b, c) => hyp(a + 0.5 - e.x, c + 0.5 - e.z) <= 0.9 && Math.abs(b - e.y) <= 1.5, (a, b, c) => hyp(a - e.x, c - e.z), { radius: 24, legs: 2 });
      for (let t = 0; t < 10 && K.all().includes(e); t++) await K.ticks(1);
      if (K.all().includes(e)) { e.gone = true; if (process.env.LAB_GOAL_DEBUG) log(`collect: ${sh(e.item ?? '?')} at ${e.x.toFixed(1)} ${e.y.toFixed(1)} ${e.z.toFixed(1)} ${reached ? 'not taken' : 'out of reach'}: left`); await K.ticks(2); }
    }
  }

  // ---------------- staying alive ----------------
  const FOOD = ['golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'cooked_chicken', 'cooked_cod', 'bread', 'baked_potato', 'cooked_rabbit', 'pumpkin_pie', 'apple', 'carrot', 'melon_slice', 'sweet_berries', 'beef', 'porkchop', 'mutton', 'cookie', 'potato', 'beetroot', 'dried_kelp', 'chicken', 'rabbit', 'cod', 'salmon'];
  let reflexBusy = false, lastHide = -1e9, lastPillar = -1e9, lastProvision = -1e9;
  // health comes back only with 18+ on the food bar: already there, or enough carried to eat up to it (a bite or two is not)
  const canHeal = (food) => food >= 18 || FOOD.filter(edible).reduce((a, x) => a + cnt(x), 0) >= 3;
  // food the quest itself needs (the steak to eat at the end) is not eaten on the way, unless starving
  let questKeep = new Set();
  const edible = (x) => cnt(x) > 0 && (!questKeep.has(x) || (K.attrs()['player.hunger'] ?? 20) <= 6);
  // buried: gravel or sand came down on the head or into the feet (dug up into a pocket of it): out at once, the head first - each
  // half second in it hurts (a player dug at the gravel above it for seven minutes while the column kept coming down on it)
  const GRAVITY = /^minecraft:(gravel|sand|red_sand|suspicious_sand|suspicious_gravel|\w+_concrete_powder)$/;
  async function digOut() {
    for (let k = 0; k < 8 && !K.dead(); k++) {
      const [x, y, z] = feet(), c = [1, 0].map((dy) => [x, y + dy, z]).find((q) => GRAVITY.test(B(...q)?.name ?? ''));
      if (!c) return;
      log(`buried in ${sh(B(...c).name)} at ${c.join(' ')}: digging out`);
      try { await toolFor(...c); } catch { /* the hand */ }
      await K.act('dig', c.map(S));
    }
  }
  async function reflexes() {
    if (reflexBusy) return;
    reflexBusy = true;
    try {
      if (K.dead()) await afterDeath();
      await digOut();
      const a = K.attrs(), hp = a.health ?? 20, food = a['player.hunger'] ?? 20;
      if ((food <= 14 || (hp < 18 && food < 18) || (hp < 12 && food < 20)) && K.screen() === '') {   // health only comes back with 18+ food
        let f = FOOD.find((x) => edible(x) && (x !== 'chicken' || food <= 6));
        const foesNear = K.all().some((q) => HOSTILE.test(q.type) && !/enderman/.test(q.type) && hyp(q.x - K.feet().x, q.y - K.feet().y, q.z - K.feet().z) < (ARCHER_T.test(q.type) || hp <= 10 ? 20 : 12));   // (an archer's reach; hurt: wider)
        if (!f && (food <= 8 || (hp <= 10 && food < 18)) && (!foesNear || food <= 6) && (food <= 6 || !(nightNow() || storm()) || !skyOver())) {   // (not out hunting in the dark unless starving)   // (not into the monsters for it, unless starving)   // (not earlier: a hunt is a detour, and a low food bar only stops sprinting)   // nothing to eat: an animal nearby is dinner (raw meat will do); hurt: health comes back only with 18+ food
          const e = K.all().filter((q) => /:(cow|pig|chicken|sheep|rabbit|mooshroom)$/.test(q.type) && !q.huntFailed && hyp(q.x - K.feet().x, q.z - K.feet().z) < (food <= 8 ? 32 : 16)).sort((p, q) => hyp(p.x - K.feet().x, p.z - K.feet().z) - hyp(q.x - K.feet().x, q.z - K.feet().z))[0];
          if (e) {
            log(`hungry (${food}): hunting a ${sh(e.type)}`); const at = { x: e.x, y: e.y, z: e.z };
            if (await goToEntity(e, 2.6)) { await fightOne(e, food <= 6 ? 120 : 60); await collect({ x: e.x, y: e.y, z: e.z }, 6); await collect(at, 6); }
            if (K.all().includes(e)) e.huntFailed = true;   // out of reach (water, a cliff): another one next time, not this one again
            f = FOOD.find(edible);
          }
        }
        if (f) { stopKeys(); await grab(f, 'eat'); await K.act('use', ['36']); }
      }
      const [x, y, z] = feet();
      if (/lava|fire/.test(bname(x, y, z)) || /lava|fire/.test(bname(x, y + 1, z))) { log('in fire: out'); await H.M?.escape_lava?.([]); }
      const near = (e, r) => hyp(e.x - K.feet().x, e.y - K.feet().y, e.z - K.feet().z) < r;
      // out of their reach first when that is the answer (no sword, hurt, too many, a creeper): digging in or climbing a pillar
      // with a zombie two blocks off is the time it needs to kill (a hole takes seconds)
      if (evading) return;   // (on the run: no stopping to trade blows)
      { const tp = K.dead() ? null : threatPlan(); if (tp?.act === 'evade' && (await evade(tp.why))) { await nightHide(); return; } }
      // (under the ground, one behind rock - the far side of a wall just shut, a drowned in the next cave - is no threat until it
      // shows: counted as one, it had a hurt player with nothing to eat back up its stair and up a pillar again and again, eleven
      // minutes at the same health)
      const under0 = deepUnder(), about = (e, r) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && near(e, r) && (!under0 || near(e, 2) || sees(e));
      // badly hurt with enemies about: up on a pillar out of their reach, eat, wait for the hearts to come back
      // down a mine, hurt, a monster in the cave: back up its own stair a few steps and shut the way below with blocks, out of
      // sight of an archer and out of reach, then heal (walling in on a cave floor needs blocks all round and was shot down)
      if (hp <= 10 && !sheltering && gnow() - lastHide > 60000 && feet()[1] < (rtaRun?.start?.y ?? 64) - 16 && K.all().some((e) => about(e, 16)) && blockItem()) {
        const ok = await retreat(hp, canHeal(food)); lastHide = gnow();
        if (ok) return;
      }
      // (on a pillar an archer still shoots it down: with a skeleton about, or nothing to climb on, a hole with a lid instead)
      const archers = K.all().some((e) => /skeleton|stray|bogged|pillager/.test(e.type) && near(e, 24));
      // (health comes back only with a full food bar: with nothing to eat, a hole only waits for the monsters to go, and not
      // again at once - four times in a row a minute and a half each, at the same health)
      if (hp <= 8 && !sheltering && gnow() - lastHide > 60000 && K.all().some((e) => !/creeper/.test(e.type) && about(e, 12)) && (archers || !scaffoldNow())
        && !foesNear(6).some((q) => MELEE_T.test(q.e.type))) {   // (not with one on top of us: the hole takes the seconds it needs to kill)
        const th = gnow(), heal = canHeal(food);
        const foesNear = () => K.all().some((e) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && hyp(e.x - K.feet().x, e.y - K.feet().y, e.z - K.feet().z) < 16);
        const r = await shelter(false, { why: `hurt (${Math.round(hp)})${archers ? ', an archer about' : ''}${heal ? '' : ', nothing to eat'}`, hold: () => !K.dead() && (heal ? (K.attrs().health ?? 20) < 16 && gnow() - th < 90000 : foesNear() && gnow() - th < 30000) });
        lastHide = gnow();
        if (r !== 'failed') return;
      }
      // (a pillar in the open only: under a roof it goes up one block into the ceiling and down again, again and again)
      if (hp <= 8 && K.all().some((e) => !/creeper|skeleton|stray|bogged|pillager/.test(e.type) && about(e, 8)) && scaffoldNow() && underSky() && gnow() - lastPillar > 45000) {
        lastPillar = gnow();
        log(`hurt (${hp}): up out of reach`);
        stopKeys(); await pillarUp(); await pillarUp(); await pillarUp();
        const f = FOOD.find(edible); if (f) { await grab(f, 'eat'); await K.act('use', ['36']); }
        for (let t = 0; t < 30 && (K.attrs().health ?? 20) < 16 && !K.dead(); t++) await K.ticks(20);
      }
      if (hp <= 6 && !scaffoldNow()) {   // badly hurt, no blocks to climb on: run from them, then eat
        const f = K.feet(), foes = K.all().filter((e) => HOSTILE.test(e.type) && !/creeper/.test(e.type) && hyp(e.x - f.x, e.y - f.y, e.z - f.z) < 6);
        if (foes.length) {
          const mx = foes.reduce((a, e) => a + e.x, 0) / foes.length, mz = foes.reduce((a, e) => a + e.z, 0) / foes.length;
          log(`hurt (${hp}): running from ${foes.length} ${foes.length > 1 ? 'monsters' : sh(foes[0].type)}`);
          K.look((Math.atan2(-(f.x - mx), f.z - mz) * 180) / Math.PI, 0); K.controls.forward = K.controls.sprint = true; K.controls.jump = true; await K.ticks(40); stopKeys();
          const fd = FOOD.find(edible); if (fd) { await grab(fd, 'eat'); await K.act('use', ['36']); }
        }
      }
      const [hx, hy, hz] = feet();
      if (isWater(B(hx, hy + 1, hz))) { K.controls.jump = true; await K.ticks(10); K.controls.jump = false; }   // under water: up for air
      // out of their reach first when that is the better answer (no sword, hurt, too many, a creeper)
      // armed: meet a zombie / spider before it reaches (5 blocks), charge a skeleton while healthy (10); unarmed: only what is on top
      // of us (cornered: nowhere to run, or too hungry to); an enderman only when it is already fighting (looking at it provokes it)
      const sword = armed(), tp2 = K.dead() ? null : threatPlan();
      const reach = (t) => (/creeper/.test(t) ? 7 : /enderman/.test(t) ? 3 : /skeleton|stray|bogged|pillager/.test(t) ? (sword && hp > 10 ? 10 : 3.5) : sword ? 5 : 3.5);
      const foe = tp2?.act === 'fight' ? tp2.e : K.all().filter((e) => HOSTILE.test(e.type) && near(e, reach(e.type))).sort((p, q) => hyp(p.x - K.feet().x, p.z - K.feet().z) - hyp(q.x - K.feet().x, q.z - K.feet().z))[0];
      if (foe) {
        if (/creeper/.test(foe.type) && (!sword || !near(foe, 3))) {   // a creeper: keep away from it (it blows up a second and a half after it gets close); hit it only when it is already here
          const f = K.feet(); K.look((Math.atan2(-(f.x - foe.x), f.z - foe.z) * 180) / Math.PI, 0); K.controls.forward = K.controls.sprint = true; K.controls.jump = true; await K.ticks(30); stopKeys();
        } else {
          await fightOne(foe, /creeper/.test(foe.type) ? 12 : SPACED(foe) ? 40 : 8);   // (spaced: to the end - broken off every 5 s, each break a tick or two without the spacing)
          // the next one that is already here too, before the job goes on (a zombie and a spider came together while the first
          // fight ended and a craft began: killed from 13 in five seconds)
          for (let k = 0; k < 6 && !K.dead(); k++) {
            const tn = threatPlan();
            if (tn?.act === 'evade') { await evade(tn.why); break; }
            if (tn?.act !== 'fight' || !tn.e) break;
            await fightOne(tn.e, SPACED(tn.e) ? 40 : 8);
          }
        }
      }
      // (after the fight: the one that is already here first, then dig in before the next ones come)
      await nightHide();
    } catch (e) { log(`reflex: ${e.message}`); } finally { reflexBusy = false; }
  }
  // night on the surface (a forest's leaves over the head count as the sky) with monsters coming: dig in until morning - not on the way
  // down a stair (that shuts itself), not armed and well against one or two (they come to the sword: a hole costs the rest of the
  // night), never with one of them already on top (out of reach or the fight first: the hole takes seconds). Also right after
  // getting away from them (evade): the gap it made is the time to dig
  async function nightHide() {
    const a = K.attrs(), hp = a.health ?? 20;
    const shelterOk = gnow() - shelterFailed > 20000 || hp <= 8;   // (a failed try not again at once: the same ground, the same missing blocks)
    if (sheltering || underway || !shelterOk || late() || K.dead() || !(nightNow() || storm()) || !skyOver()) return;
    const fs = foesNear(24), mel = fs.filter((q) => MELEE_T.test(q.e.type)), shooters = fs.filter((q) => ARCHER_T.test(q.e.type) && q.d < 16);
    // (whole health and a sword: three are fought too - the hole takes four or five seconds, and one that came meanwhile stood
    // over it: the lid would not go in, and it bit down into the hole)
    // (a wooden sword is four blows a zombie: one at a time only, whole, and no spiders - two spiders at night killed a runner with
    // one, out looking for sheep)
    const strong = armed() && (goodSword() ? (hp >= 14 && mel.length <= 2) || (hp >= 18 && mel.length <= 3) : hp >= 16 && mel.length <= 1 && !mel.some((q) => /spider/.test(q.e.type)))
      && shooters.length <= 1 && !fs.some((q) => /creeper/.test(q.e.type) && q.d < 10);
    const onTop = fs.some((q) => (MELEE_T.test(q.e.type) || /creeper/.test(q.e.type)) && q.d < 11);
    // (armed and well: on with the job, the ones that come are fought - a hole costs the rest of the night, eight minutes of a race.
    // It used to hide from any monster in sight after a death, armed or not: a whole night in a hole, again and again)
    if (((fs.length && !strong) || hp <= 12) && !onTop) await shelter();
  }
  // to the middle of the block the feet are on (small sneaking steps at the end: no overshoot)
  async function centerOn(x, z, tol = 0.2) {
    for (let t = 0; t < 30 && !K.dead(); t++) {
      const f = K.feet(), dx = x + 0.5 - f.x, dz = z + 0.5 - f.z, d = hyp(dx, dz);
      if (d <= tol) break;
      K.look((Math.atan2(-dx, dz) * 180) / Math.PI, 0);
      K.controls.forward = true; K.controls.sneak = d < 0.7;
      await K.ticks(1);
    }
    stopKeys();
  }
  // the time of day: the last time the server sent, moved on by the ticks since (a day is 24000 ticks; monsters 13000-23000)
  // (the server sends the time now and then; the client's tick when it came moves it on). Only a generated world has days and nights
  const dayTime = () => { const t = K.time?.(); if (t === null || t === undefined) return null; const at = K.timeTick?.() ?? K.tick(); return (Number(t) + Number(K.tick() - at)) % 24000; };
  const nightNow = () => { if (process.env.LAB_WORLD !== 'normal') return false; const t = dayTime(); return t !== null && t >= 12900; };
  // a thunderstorm is dark enough for monsters to spawn by day, and in rain the sun does not burn them: both kept like the night
  const storm = () => process.env.LAB_WORLD === 'normal' && K.weather?.() === 'thunder';
  const dusk = () => { if (process.env.LAB_WORLD !== 'normal') return false; const t = dayTime(); return t !== null && t >= 12200 && t < 12900; };   // sunset: the light going, none spawned yet   // to the end of the day (24000 = sunrise: zombies and skeletons burn from then)
  const deepBlock = (b) => { const w = b && G.wild(b); return !!w && w[3] !== undefined && !COMMON.test('minecraft:' + b) && w[3] < feet()[1] - 12; };   // found by digging down to it
  // up out of the mine (the stair it came down, or a new one dug up, blocks set under it where needed) to open sky
  async function toSurface(why, topY) {
    // (the ground's top over here: the highest block of the column over the head that shuts out the sky, else where the run began -
    // a run begun down in a cave had "the surface" at the cave's floor, and looked for trees down there for minutes)
    const [sx0, sy0, sz0] = feet();
    let roof = null; for (let k = 2; k < 200; k++) { const f = fAt(sx0, sy0 + k, sz0); if (!f) break; if (f & F_OPAQUE) roof = sy0 + k; }
    const top = topY ?? (roof !== null ? roof + 1 : rtaRun?.start?.y ?? 64), [, y0] = feet();
    log(`up to the surface${why ? ` (next: ${why})` : ''} from y=${y0}`);
    const open = (a, b, c) => { for (let k = 2; k < 24; k++) if (fAt(a, b + k, c) & F_OPAQUE) return false; return true; };
    // back the way it came down (the trail: tunnel and stair cells, walked in reverse; a block that shut it at night dug again)
    const t = trail();
    if (t.length > 1) {
      const [px, py, pz] = feet();
      let bi = -1, bd = 1e9; t.forEach((c, i) => { const dd = hyp(c[0] - px, c[1] - py, c[2] - pz); if (dd < bd) { bd = dd; bi = i; } });
      if (bd <= 10) {
        if (bd > 1) await travel((a, b, c) => a === t[bi][0] && b === t[bi][1] && c === t[bi][2], (a, b, c) => hyp(a - t[bi][0], b - t[bi][1], c - t[bi][2]), { dig: true, radius: 16, legs: 3 });
        let fails = 0;
        for (let i = bi - 1; i >= 0 && !skyOver() && !late() && !K.dead() && fails < 3; i--) {
          const [cx, cy, cz] = t[i], [fx, fy, fz] = feet();
          if (fx === cx && fy === cy && fz === cz) continue;
          if (await stepTo(cx, cy, cz)) { await until(() => feet()[1] >= cy, 6, 300); fails = 0; } else { fails++; i++; await K.ticks(4); }
          if (i % 12 === 0) await reflexes();
        }
        if (skyOver()) { log(`back up the way I came: y=${feet()[1]}`); stopKeys(); K.memo.set('goal:trail', []); return; }
      }
    }
    // back up the stair it dug on the way down (open all the way, but for the two blocks that shut it at night)
    const st = K.memo.get('goal:stairTop'), [x0, , z0] = feet();
    if (st && hyp(st[0] - x0, st[2] - z0) < 64) {
      const md = (a, b, c) => Math.abs(a - st[0]) + Math.abs(b - st[1]) + Math.abs(c - st[2]);
      await travel((a, b, c) => md(a, b, c) <= 2, md, { dig: true, pillar: true, radius: 64, legs: 4, nodes: 25000 });
    }
    // else (or that way is gone): straight up through the rock on a pillar, else a new stair up, dug like the one down
    if (!skyOver() && !(fAt(...feet()) & F_WATER) && !process.env.LAB_NO_SHAFT && bestTool({ kind: 'pickaxe', tier: 1 })) await shaftUp(top);
    if (!skyOver() && bestTool({ kind: 'pickaxe', tier: 1 })) await stairUp(top + 4);
    if (deepUnder()) await travel((a, b, c) => b >= top - 12 && open(a, b, c), (a, b, c) => Math.max(0, top - b), { dig: true, pillar: true, radius: 32, legs: 6, nodes: 25000 });
    stopKeys();
    if (deepUnder()) log(`still under the ground at y=${feet()[1]}`);
  }
  // nothing that shuts out the light over the head (air, leaves, glass): out of the ground
  // (water over the head is no sky: the bottom of a lake let "up to the surface" stop at y=25, and the next step walked at the trees
  // along the lake floor among the drowned)
  // (the whole column up, to where the world is not known: the roof of a big cave under a mountain is more than 32 blocks up - "back
  // up the way I came: y=20", and the sheep were looked for down there, and it died at y=-1)
  const skyOver = () => { const [x, y, z] = feet(); for (let k = 2; k < 320; k++) { if (!B(x, y + k, z)) break; const f = fAt(x, y + k, z); if ((f & F_OPAQUE) || (k < 12 && (f & F_WATER))) return false; } return true; };
  // down in a mine: rock over the head and well below where the run started (not a quarry cut into a hill: the path finder walks
  // out of that by itself)
  const inMine = () => deepUnder() && (feet()[1] < (rtaRun?.start?.y ?? 64) - 16 || feet()[1] < 50);
  // well under the ground: four blocks of rock (or more) over the head
  const deepUnder = () => { const [x, y, z] = feet(); let n = 0; for (let k = 2; k < 48 && n < 4; k++) if (fAt(x, y + k, z) & F_OPAQUE) n++; return n >= 4; };
  // a step done up on the surface: a tree, sand, a flower; an animal; a farm, a chest
  const UNDERGROUND = /stone|deepslate|andesite|diorite|granite|tuff|_ore$|gravel|dirt|clay|calcite|amethyst|dripstone|moss|obsidian|lava|water/;
  // (a block of that kind already in sight down here - a torch it set on the way, a flower in a lush cave - is no reason to go up)
  const surfaceStep = (st) => (st.do === 'mine' ? (st.anyWood || !UNDERGROUND.test(st.block ?? '')) && !(st.block && known(new RegExp(`^minecraft:${st.block}$`), { max: 1, radius: 24 }).length) : !['craft', 'smelt', 'pickup', 'strip', 'harden'].includes(st.do));
  const underSky = () => { const [x, y, z] = feet(); for (let k = 2; k < 24; k++) if (fAt(x, y + k, z) & F_SOLID) return false; return true; };
  // a hole two deep with a block over it: nothing gets in, nothing shoots in. Wait there for the morning, eating when hungry
  let sheltering = false, underway = 0, shelterFailed = -1e9;
  // blocks to build with: what is carried for pillars first, else wood, stone, dirt
  const blockItem = () => scaffoldNow() ?? [...invMap().keys()].find((k) => /_(log|planks|wood|stem)$|^(cobblestone|cobbled_deepslate|dirt|grass_block|stone|sand|gravel|netherrack|coarse_dirt|mud|andesite|diorite|granite|tuff|deepslate)$/.test(k)) ?? null;
  // a block into an empty cell, set against any solid neighbour of it
  const FACES = [[0, -1, 0, 'up'], [1, 0, 0, 'west'], [-1, 0, 0, 'east'], [0, 0, 1, 'north'], [0, 0, -1, 'south'], [0, 1, 0, 'down']];
  async function fillCell(at) {
    if (fAt(...at) & F_SOLID) return true;
    { const [fx, fy, fz] = feet(); if (at[0] === fx && at[2] === fz && (at[1] === fy || at[1] === fy + 1)) return false; }   // (the player's own cells)
    for (const [dx, dy, dz, face] of FACES) {
      const c = [at[0] + dx, at[1] + dy, at[2] + dz];
      if (!(fAt(...c) & F_SOLID)) continue;
      const it = blockItem(); if (!it) return false;
      try { await grab(it, 'fill'); } catch { return false; }
      K.lookAt(at[0] + 0.5, at[1] + 0.5, at[2] + 0.5);
      await K.act('useon', [S(c[0]), S(c[1]), S(c[2]), face]);
      await until(() => (fAt(...at) & F_SOLID) !== 0, 4, 300);
      if (fAt(...at) & F_SOLID) return true;
    }
    return false;
  }
  // o.why / o.hold: dug in by day for a while (to heal, or while a crowd is about) instead of until the morning
  async function shelter(moved = false, o = {}) {
    sheltering = true;
    try {
      const r = await shelter0(moved, o);
      if (r === 'failed') shelterFailed = gnow();
      return r;
    } finally { sheltering = false; }
  }
  async function shelter0(moved, o = {}) {
    stopKeys();
    const tS = gnow(), slow = () => gnow() - tS > 90000;   // (building it has a minute and a half: past that, not a shelter for this night)
    if (cnt('bed') > 0 && !o.hold && nightNow()) {   // a bed carried: set it down and sleep the night away (a speedrunner's way; not with monsters right here)
      const b = spotBeside();
      if (b) {
        await grab('bed', 'sleep'); K.lookAt(b[0] + 0.5, b[1], b[2] + 0.5); await K.act('useon', [S(b[0]), S(b[1] - 1), S(b[2]), 'up']); await K.ticks(6);
        if (/bed/.test(bname(...b))) {
          log('night: sleeping it away');
          await K.act('sleep', b.map(S));
          for (let t = 0; t < 30 && nightNow(); t++) await K.ticks(20);
          await K.act('wake', []).catch(() => {});
          const slept = !nightNow();
          await breakAt(...b); await collect({ x: b[0] + 0.5, y: b[1], z: b[2] + 0.5 }, 4, /bed/);
          if (slept) { log('morning (slept)'); return 'slept'; }
        }
      }
    }
    log(o.why ? `${o.why}: digging in` : 'night, monsters about: digging in until morning');
    // (one that gets here while the hole is dug is fought off first, with a sword or a tool: digging on with it hitting was death)
    const guard = guardHole;
    let dug = 0, perched = false;
    // the hole's column, kept: a hit knocks the player off it (back in, not a new hole where it landed), and the middle of the block
    // first - from an edge the neighbour carries the player over the hole dug under it (a dig-in stood over its first hole 10 s)
    const [hx0, y0h, hz0] = feet();
    await centerOn(hx0, hz0);
    for (let k = 0; k < 3 && !slow() && !K.dead(); k++) {   // three down: the lid then sits in the ground's own layer, with ground on every side to set it against
      await guard();
      if (feet()[0] !== hx0 || feet()[2] !== hz0) { if (!(await walkInto(hx0, feet()[1], hz0))) break; }
      await centerOn(hx0, hz0);
      const [x, y, z] = feet(), fb = fAt(x, y - 1, z), f2 = fAt(x, y - 2, z);
      if (process.env.LAB_GOAL_DEBUG) log(`dig in: at ${x} ${y} ${z} (${K.feet().y.toFixed(2)}) under ${bname(x, y - 1, z)} ${bname(x, y - 2, z)}`);
      if (!(fb & F_SOLID) || (fb & F_UNBREAK) || (f2 & (F_WET | F_DANGER)) || !(f2 & F_SOLID)) break;
      if (/stone|deepslate|ore|andesite|diorite|granite|tuff|terracotta|sandstone/.test(bname(x, y - 1, z)) && !bestTool({ kind: 'pickaxe', tier: 1 })) break;
      if (!(await breakAt(x, y - 1, z))) break;
      dug++;
      await until(() => feet()[1] < y, 12, 400);
    }
    if (K.dead()) return 'failed';   // (killed while digging: the rest - gathering, walls, a lid - is for the living)
    // at the bottom of it before the lid is worked out: an arrow's knock, or a fall not finished, left the player a block or two up
    // and the lid went up there too, into the open air of a cave with nothing to set it against ("not placed", shot dead)
    if (dug) {
      const yb = y0h - dug;
      for (let t = 0; t < 40 && !K.dead() && (feet()[1] > yb || feet()[0] !== hx0 || feet()[2] !== hz0); t++) {
        if (feet()[0] !== hx0 || feet()[2] !== hz0) { if (!(await walkInto(hx0, feet()[1], hz0))) break; } else await K.ticks(1);
      }
    }
    await guard();
    // (what was dug drops into the hole and is picked up where it lies after its half second: no walking after it - collect() had
    // walked out of the hole to a block that popped out onto the grass, and there was no hole any more)
    await K.ticks(12); await K.sync();
    { const [hx, , hz] = feet(); for (const e of K.nearest('item').filter((q) => Math.floor(q.x) === hx && Math.floor(q.z) === hz)) { for (let t = 0; t < 10 && K.all().includes(e); t++) await K.ticks(1); } await K.sync(); }
    // then shut in: every side at feet and head height and the cell over the head solid (the ground where it is there, blocks
    // where it is not: after a shallow hole or none, walls are built up from the ground, the lid set against one raised side)
    const blocksHeld = () => { const m = invMap(); let n = 0; for (const [k, v] of m) if (SCAFFOLD.includes(k) || /_(log|planks|wood|stem)$|^(grass_block|coarse_dirt|mud)$/.test(k)) n += v; return n; };
    const SIDES = [[1, 0, 'west'], [-1, 0, 'east'], [0, 1, 'north'], [0, -1, 'south']];
    const [x, y, z] = feet(), lid = [x, y + 2, z];
    const put = async (cx, cy, cz, face, at) => { const it = blockItem(); if (!it) return false; try { await grab(it, 'shelter'); } catch { return false; } K.lookAt(at[0] + 0.5, at[1] + 0.5, at[2] + 0.5); await K.act('useon', [S(cx), S(cy), S(cz), face]); await until(() => (fAt(...at) & F_SOLID) !== 0, 4, 300); const ok = (fAt(...at) & F_SOLID) !== 0; if (!ok && process.env.LAB_GOAL_DEBUG) log(`shelter: ${it} on ${cx} ${cy} ${cz} ${face} for ${at.join(' ')}: not placed (there: ${sh(bname(...at))}, feet ${feet().join(' ')})`); return ok; };
    const open = () => [...[0, 1].flatMap((h) => SIDES.map(([dx, dz]) => [x + dx, y + h, z + dz])).filter((c) => !(fAt(...c) & F_SOLID)), ...((fAt(...lid) & F_SOLID) ? [] : [lid])];
    // not enough blocks for the gaps: soft ground a little way off (dirt, sand: by hand) comes along
    for (let k = 0; k < 12 && blocksHeld() < open().length + 1 && !slow() && !K.dead(); k++) {
      const h = known(/^minecraft:(dirt|grass_block|sand|gravel|coarse_dirt|mud|podzol|mycelium)$/, { max: 12, radius: 5, fair: false })
        .find((q) => Math.max(Math.abs(q.x - x), Math.abs(q.z - z)) >= 2 && Math.abs(q.y - y) <= 2 && reachOk(q.x, q.y, q.z)(x, y, z) && exposed(q.x, q.y, q.z));
      if (!h) break;
      await breakAt(h.x, h.y, h.z); await collect({ x: h.x + 0.5, y: h.y, z: h.z + 0.5 }, 3);
      if (hyp(...[feet()[0] - x, feet()[2] - z]) > 0.5 || feet()[1] !== y) break;   // pulled off the spot (a fall, a hit): stop gathering
    }
    if (K.dead()) return 'failed';
    await guard();
    for (const [dx, dz] of SIDES) for (const hgt of [0, 1]) { const c = [x + dx, y + hgt, z + dz]; if (!(fAt(...c) & F_SOLID) && (fAt(c[0], c[1] - 1, c[2]) & F_SOLID)) await put(c[0], c[1] - 1, c[2], 'up', c); }
    if (!(fAt(...lid) & F_SOLID)) {
      let side = SIDES.find(([dx, dz]) => fAt(x + dx, y + 2, z + dz) & F_SOLID);
      if (!side) for (const sd of SIDES) { if ((fAt(x + sd[0], y + 1, z + sd[1]) & F_SOLID) && (await put(x + sd[0], y + 1, z + sd[1], 'up', [x + sd[0], y + 2, z + sd[1]]))) { side = sd; break; } }
      // (one standing over the hole keeps the lid out: hit from below, then the lid again)
      for (let t = 0; side && t < 3 && !(fAt(...lid) & F_SOLID) && !K.dead(); t++) { if (t) await guard(); await put(x + side[0], y + 2, z + side[1], side[2], lid); }
    }
    if (!slow()) for (const c of open()) await fillCell(c);   // (what is left: set against any solid neighbour, not only the floor or a raised side)
    if (K.dead()) return 'failed';
    const gaps = open();
    if (gaps.length) {   // could not shut in: two or three blocks up on a pillar is out of a zombie's reach
      if (blocksHeld() >= 3 && (await pillarUp()) && (await pillarUp()) && (await pillarUp())) { log(`could not shut myself in (dug ${dug}, ${gaps.length} gaps): waiting up on a pillar`); perched = true; }
      else if (!moved && dug < 2) {   // rock underfoot, nothing to build with: over to soft ground (dirt with dirt under it) and again there
        const soft = known(/^minecraft:(dirt|grass_block|coarse_dirt|podzol|mycelium|sand)$/, { max: 40, radius: 20, fair: false })
          .filter((q) => [1, 2].every((d) => /dirt|grass|podzol|mycelium|sand|gravel|clay|mud/.test(bname(q.x, q.y - d, q.z))) && standable(q.x, q.y + 1, q.z) && hyp(q.x - x, q.z - z) >= 3)
          .sort((p, q) => hyp(p.x - x, p.z - z) - hyp(q.x - x, q.z - z))[0];   // three soft layers: a hole deep enough for a lid
        if (soft) {
          log(`rock here (dug ${dug}): over to soft ground at ${soft.x} ${soft.y + 1} ${soft.z}`);
          await travel((a, b, c) => a === soft.x && c === soft.z && b === soft.y + 1, (a, b, c) => hyp(a - soft.x, b - soft.y - 1, c - soft.z), { radius: 32, legs: 3 });
          return shelter0(true, o);   // (still sheltering: no reflex starts another one on the way)
        }
        log(`could not shut myself in (dug ${dug}, ${gaps.length} gaps, ${blocksHeld()} blocks, no soft ground near): carrying on`); return 'failed';
      } else { log(`could not shut myself in (dug ${dug}, ${gaps.length} gaps, ${blocksHeld()} blocks): carrying on`); return 'failed'; }
    }
    if (!o.hold && !perched && nightNow() && !armed()) { try { await swordHere(); } catch (e) { log(`sword in the hole: ${e.message}`); } }
    const t0 = gnow(), home = feet().join(), hp0 = K.attrs().health ?? 20;
    // out a little after sunrise (the first 20 s of the day: the sun is up and they are burning), and not while a zombie or skeleton
    // still stands right outside (half a minute more at most: under a tree one does not burn)
    // (rain: they do not burn, but waiting on does not make them go either - out with the day, keeping away from them)
    const dark = () => nightNow() || dusk() || (dayTime() ?? 2000) < 1200 || storm();
    let light = null;
    // (the morning: out once none is about - the burning ones burn in the sun, a creeper, a spider, a witch do not and wander off - at
    // most two and a half minutes into the day: in shade or rain they stay. Out at once into the crowd the night left was two deaths)
    const waiting = o.hold ?? (() => { if (dark()) return true; light ??= gnow(); return gnow() - light < 150000 && K.all().some((e) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && hyp(e.x - K.feet().x, e.z - K.feet().z) < 24); });
    let lowest = hp0;
    while (waiting() && gnow() - t0 < 12 * 60000 && !K.dead() && !late()) {
      await K.ticks(40);
      // (knocked out of it, or losing health in it - an arrow through a gap: 13 to 3 in a "shelter" - it is no shelter: out and deal
      // with it, not wait on)
      const hpNow = K.attrs().health ?? 20; lowest = Math.min(lowest, hpNow);
      if (!perched && feet().join() !== home) { log(`shelter: pushed out of it (${feet().join(' ')})`); break; }
      if (hpNow <= lowest && hpNow < hp0 - 4 && foesNear(16).length) { log(`shelter: hurt in it (health ${Math.round(hpNow)}): out`); break; }
      const a = K.attrs(), food = a['player.hunger'] ?? 20, hp = a.health ?? 20;
      if ((food <= 14 || hp < 16) && K.screen() === '') { const f = FOOD.find(edible); if (f) { await grab(f, 'eat'); await K.act('use', ['36']); } }
      // the night's shelter, armed, healed and fed, with no crowd outside: out and on with the run, like a runner with a sword (the
      // monsters that come are fought one or two at a time); a crowd, a creeper, an archer about - on waiting
      // (with a wooden sword: the morning - out at once with one, looking for sheep, two zombies and a spider came, and it died)
      if (!o.hold && !perched && goodSword() && hp >= 16 && food >= 10 && gnow() - t0 > 15000) {
        const fs = foesNear(20), mel = fs.filter((q) => MELEE_T.test(q.e.type)).length;
        if (mel <= 1 && !fs.some((q) => /creeper/.test(q.e.type) || (ARCHER_T.test(q.e.type) && q.d < 16))) { log(`shelter: armed and well, ${mel ? 'one about' : 'none about'} - out and on with it`); break; }
      }
    }
    log(o.why ? `${o.why}: out again after ${Math.round((gnow() - t0) / 1000)} s (health ${K.attrs().health ?? '?'})` : nightNow() ? `out again after ${Math.round((gnow() - t0) / 1000)} s of the night (armed, health ${K.attrs().health ?? '?'})` : `morning (waited ${Math.round((gnow() - t0) / 1000)} s, time of day ${dayTime() ?? '?'}): out again`);
    if (!perched) await breakAt(...lid);
    K.memo.set('goal:deaths', 0);
    return perched ? 'perched' : `shut in (dug ${dug})`;
  }
  // heal: health comes back (a full food bar or something to eat); else only until the monster is gone (20 s): the blocks keep it off
  async function retreat(hp, heal) {
    const t = trail(), [px, py, pz] = feet();
    let bi = -1, bd = 1e9; t.forEach((c, i) => { const dd = hyp(c[0] - px, c[1] - py, c[2] - pz); if (dd < bd) { bd = dd; bi = i; } });
    if (bi < 2 || bd > 6) return false;   // (no own way back near here: dig in instead)
    // (not back up into the one that came down after the player: a creeper following down the stair was walked into, and blew)
    const upWay = t.slice(Math.max(0, bi - 6), bi + 1);
    if (foesNear(16).some((q) => upWay.some((c) => hyp(q.e.x - c[0] - 0.5, q.e.y - c[1], q.e.z - c[2] - 0.5) < 3))) { if (process.env.LAB_GOAL_DEBUG) log('retreat: one of them is on my way back up'); return false; }
    log(`hurt (${Math.round(hp)}) down here with a monster about: back up my stair and shut it below`);
    sheltering = true;
    try {
      if (bd > 1) await travel((a, b, c) => a === t[bi][0] && b === t[bi][1] && c === t[bi][2], (a, b, c) => hyp(a - t[bi][0], b - t[bi][1], c - t[bi][2]), { dig: true, radius: 10, legs: 1 });
      if (K.dead()) return false;
      let at = bi;
      for (let i = bi - 1; i >= Math.max(0, bi - 6) && !K.dead(); i--) {
        const [cx, cy, cz] = t[i], [fx, fy, fz] = feet();
        if (fx === cx && fy === cy && fz === cz) { at = i; continue; }
        if (!(await stepTo(cx, cy, cz))) break;
        await until(() => feet()[1] >= cy, 6, 300); at = i;
      }
      if (K.dead() || at === bi) return false;
      const below = t[at + 1], [fx, fy, fz] = feet();
      const shut = (await fillCell([below[0], below[1], below[2]])) && (await fillCell([below[0], below[1] + 1, below[2]]));
      if (!shut) { log('could not shut the stair below'); return false; }
      fillCell([fx, fy + 2, fz]).catch(() => {});   // (and over the head, where the stair is open to a cave above)
      const t0 = gnow(), foesNear = () => K.all().some((e) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && hyp(e.x - K.feet().x, e.y - K.feet().y, e.z - K.feet().z) < 16);
      while ((heal ? (K.attrs().health ?? 20) < 16 && gnow() - t0 < 90000 : foesNear() && gnow() - t0 < 20000) && !K.dead() && !late()) {
        await K.ticks(40);
        const a = K.attrs(); if (((a['player.hunger'] ?? 20) < 20 || (a.health ?? 20) < 16) && K.screen() === '') { const f = FOOD.find(edible); if (f) { await grab(f, 'eat'); await K.act('use', ['36']); } }
      }
      log(`${heal ? `healed to ${Math.round(K.attrs().health ?? 0)}` : 'waited for it to go'} in ${Math.round((gnow() - t0) / 1000)} s behind the blocks`);
      return true;
    } finally { sheltering = false; }
  }
  async function afterDeath() {
    const d = K.lastDeath(), at = d ? ` at ${Math.floor(d.x)} ${Math.floor(d.y)} ${Math.floor(d.z)}` : '';
    K.memo.set('goal:deaths', (K.memo.get('goal:deaths') ?? 0) + 1);
    const recent = (K.memo.get('goal:deathTimes') ?? []).filter((t) => gnow() - t < 180000);
    recent.push(gnow()); K.memo.set('goal:deathTimes', recent);
    // killed in the dark: back now is back with nothing among the monsters gathered round the spot (in the races: death after
    // death, a dozen of them waiting there). A person waits on the death screen and comes back when the sun is up and they burn
    // (the first death of a night: back at once, and under the ground where it comes back - nightHide after the reflexes - instead of
    // the rest of the night on the death screen: ten minutes of a forty-minute race)
    // (again the same night, but not killed where it comes back - the last one came well after the respawn, out at the job: the spot
    // is not theirs, and seven minutes on the death screen are a sixth of a race. Killed right after coming back: it is theirs)
    const camped = gnow() - (K.memo.get('goal:respawnAt') ?? -1e9) < 60000;
    if ((nightNow() || storm()) && (recent.length < 2 || (recent.length < 3 && !camped))) {
      log(`died ${storm() && !nightNow() ? 'in a thunderstorm' : 'at night'}${at}${recent.length > 1 ? ' again' : ''}: back now, dug in where I come back`);
      // (the things stay theirs until the morning: not planned back into)
      if (d && K.all().some((e) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && hyp(e.x - d.x, e.y - d.y, e.z - d.z) < 10)) deathZones.push({ x: d.x, y: d.y, z: d.z, t: gnow() });
      await K.act('respawn', []); await K.ticks(20); K.memo.set('goal:respawnAt', gnow());
      const tn = threatPlan(); if (tn?.act === 'evade') await evade(tn.why);
      // (the second time with nothing: dug in whatever is in sight - the job is for the morning)
      if (recent.length > 1 && !armed()) await shelter(); else await nightHide();   // (dug in only with monsters about; none about: on with the job - a sword first)
      return;
    }
    if (nightNow() || storm()) {
      log(`died ${storm() && !nightNow() ? 'in a thunderstorm' : 'at night'}${at} again: back at sunrise (until then the spot is theirs)`);
      const t0 = gnow();
      while ((nightNow() || storm() || (dayTime() ?? 2000) < 1500) && !late() && gnow() - t0 < 13 * 60000) await K.ticks(40);   // (75 s into the day: the ones about the spot have burned by then)
      await K.act('respawn', []); await K.ticks(20); K.memo.set('goal:respawnAt', gnow());
      K.memo.set('goal:deathTimes', []);
      log(`morning (waited ${Math.round((gnow() - t0) / 1000)} s dead): starting over from here`);
      return;
    }
    if (recent.length >= 2 && d) {   // died there twice in three minutes: whatever killed it is still there
      log(`died again${at} (${recent.length} times in 3 min): leaving the things, starting over from here`);
      deathZones.push({ x: d.x, y: d.y, z: d.z, t: gnow() });
      // a third time: the crowd waits at the respawn point itself. Staying on the death screen a minute lets it lose interest and
      // wander off (back at once, it was death after death: 15 in 20 minutes)
      if (recent.length >= 3) { const tw = gnow(); log('dead a minute first: the ones about the spot wander off'); while (gnow() - tw < 60000 && !late()) await K.ticks(40); }
      await K.act('respawn', []); await K.ticks(20); K.memo.set('goal:respawnAt', gnow());
      // a crowd about the spot (what the night left, in shade): dug in first for a minute while the sun deals with them, then away
      const f1 = K.feet();
      // (a minute at most: in shade they do not burn, and a hole is no place to wait out a day)
      const crowd = () => K.all().filter((e) => HOSTILE.test(e.type) && hyp(e.x - K.feet().x, e.z - K.feet().z) < 12).length;
      if (K.all().filter((e) => HOSTILE.test(e.type) && hyp(e.x - f1.x, e.z - f1.z) < 16).length >= 4) { const tc = gnow(); await shelter(false, { why: 'a crowd of them here', hold: () => gnow() - tc < 60000 && crowd() >= 2 }); }
      // killed twice where it comes back by day (a dark forest: its shade keeps the monsters alive all day; a skeleton on the hill
      // over the spot): away from there onto open soft ground, and come back there from now on
      await moveAway();
      return;
    }
    // what killed it is still there with others round it: the things are not worth a second death
    const guards = d ? K.all().filter((e) => HOSTILE.test(e.type) && !/enderman/.test(e.type) && hyp(e.x - d.x, e.y - d.y, e.z - d.z) < 10).length : 0;
    if (guards >= 2) { log(`died${at} with ${guards} monsters round it: not going back for the things`); deathZones.push({ x: d.x, y: d.y, z: d.z, t: gnow() }); await K.act('respawn', []); await K.ticks(20); K.memo.set('goal:respawnAt', gnow()); return; }
    log(`died${at}: respawning and going back for the things`);
    if (d) for (let i = deathZones.length - 1; i >= 0; i--) if (hyp(deathZones[i].x - d.x, deathZones[i].y - d.y, deathZones[i].z - d.z) < 12) deathZones.splice(i, 1);
    await K.act('respawn', []);
    await K.ticks(20); K.memo.set('goal:respawnAt', gnow());
    const f = K.feet();
    if (d && hyp(d.x - f.x, d.z - f.z) < 40 && d.y > f.y - 8) { await travel((a, b, c) => hyp(a - d.x, c - d.z) < 3 && Math.abs(b - d.y) < 3, (a, b, c) => hyp(a - d.x, b - d.y, c - d.z), { radius: 64, legs: 6 }); await collect({ x: d.x, y: d.y, z: d.z }, 8); }
    else log('too far or too deep to go back: starting over from here');
  }
  // the dry walkable ground in view along a direction (no sea, no cliffs): steps of 3 blocks, soft ground (dirt, sand) counting more
  const SOFT = /^minecraft:(dirt|grass_block|coarse_dirt|podzol|mycelium|sand|red_sand|gravel)$/;
  function groundAlong(ux, uz, max = 90) {
    const [x0, y0, z0] = feet(); let n = 0, y = y0;
    for (let d = 4; d <= max; d += 3) {
      const x = Math.floor(x0 + ux * d), z = Math.floor(z0 + uz * d); let f = -1;
      for (let dy = 3; dy >= -4; dy--) if (standable(x, y + dy, z) && !(fAt(x, y + dy, z) & F_WATER)) { f = y + dy; break; }
      if (f < 0) break;
      n += SOFT.test(bname(x, f - 1, z)) ? 1.5 : 1; y = f;
    }
    return n;
  }
  async function moveAway() {
    // (down in the caves: up to the open first - "away" through the dark is into the next crowd)
    if (deepUnder()) { await toSurface('away from the monsters down here'); if (K.dead()) return; }
    const f = K.feet(), foes = K.all().filter((e) => HOSTILE.test(e.type) && hyp(e.x - f.x, e.z - f.z) < 32);
    const dirs = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);
    // a monster on the way counts against a way, the nearer the more
    const against = (ux, uz) => foes.reduce((s, e) => { const dx = e.x - f.x, dz = e.z - f.z, dd = hyp(dx, dz) || 1, c = (dx * ux + dz * uz) / dd; return s + (c > 0.2 ? 6 + (12 * c * (32 - Math.min(dd, 32))) / 32 : 0); }, 0);
    const [ux, uz] = dirs.map((u) => [u, groundAlong(u[0], u[1], 60) - against(u[0], u[1]) + Math.random()]).sort((p, q) => q[1] - p[1])[0][0];
    const far = 56, tx = f.x + ux * (far + 8), tz = f.z + uz * (far + 8);
    log(`moving away from here (${foes.length} monsters about): towards ${Math.round(tx)} ${Math.round(tz)}`);
    await travel((x, y, z) => hyp(x + 0.5 - f.x, z + 0.5 - f.z) >= far && !(fAt(x, y, z) & F_WATER), (x, y, z) => hyp(x - tx, z - tz), { radius: 64, legs: 5, sprint: true, dry: !(fAt(...feet()) & F_WATER) });
    stopKeys();
    if (K.dead()) return;
    const g = K.feet();
    // (the new place to come back to only on open ground: set down in a cave, a race's player came back to it sixteen times into a
    // crowd of twenty-five in the deep dark)
    const open = skyOver() && !deepUnder() && !(fAt(...feet()) & F_WATER);
    log(`${Math.round(hyp(g.x - f.x, g.z - f.z))} blocks away${process.env.LAB_RTA_SPAWNPOINT === '1' && open ? ': coming back here from now on' : ''}`);
    if (process.env.LAB_RTA_SPAWNPOINT === '1' && open) await K.act('cmd', ['spawnpoint', '@s']);
    K.memo.set('goal:deathTimes', []);
  }
  // what hits hardest of what is carried (a pickaxe or shovel still beats a fist)
  // before going underground with nothing to eat: an animal in sight becomes food for the trip
  // (only when the food bar is already down: a full one lasts a few minutes' trip, and a chicken hunt before the stair down took
  // 84 s of a race. Not a chicken or a rabbit - they flap and hop away - and not far)
  // force: whatever the food bar says (the night ahead, or hurt: health comes back only on a full bar - a player came out of the
  // night at 9 health with nothing to eat, and was killed in the morning)
  async function provision(force = false) {
    if (FOOD.some((x) => cnt(x) > 0) || (!force && (K.attrs()['player.hunger'] ?? 20) > 14)) return;
    const e = K.all().filter((q) => /:(cow|pig|sheep|mooshroom)$/.test(q.type)).find((q) => hyp(q.x - K.feet().x, q.z - K.feet().z) < 20 && Math.abs(q.y - K.feet().y) < 5);
    if (!e) return;
    log(`food for the trip: a ${sh(e.type)}`);
    const at = { x: e.x, y: e.y, z: e.z };
    if (await goToEntity(e, 2.6)) { await fightOne(e, 30); await collect(at, 6); }
  }
  const WEAPONS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'diamond_axe', 'stone_sword', 'copper_sword', 'iron_axe', 'golden_sword', 'wooden_sword', 'stone_axe', 'copper_axe', 'wooden_axe', 'golden_axe',
    'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'copper_pickaxe', 'wooden_pickaxe', 'golden_pickaxe', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'];
  // ---------------- fighting like a runner: reach and spacing ----------------
  // A monster bites when its box, grown by 0.83 each way, touches the player's - measured on BDS 1.26: a husk's first bite came at 1.36
  // blocks centre to centre along an axis and at 1.90 on the diagonal (a square box: the larger of |dx| and |dz| is what counts), a
  // spider's at 1.75. The sword reaches 3 blocks from the eye to the monster's box (a zombie 3.3 off along an axis). So a runner keeps
  // it in between: hits it as it comes into reach, steps back while it cannot be hurt again (10 ticks after a hit), and never lets it
  // into its own reach - the old way stood still and traded (a lone zombie took 3 of 20 every second on its way in).
  const halfW = (e) => (e.bw > 0 ? e.bw / 2 : /cave_spider/.test(e.type) ? 0.35 : /spider/.test(e.type) ? 0.7 : 0.3);
  const biteAt = (e) => e._bite ?? halfW(e) + 0.3 + 0.83;   // per axis, centre to centre (_bite: an add-on mob's own reach, set by duel_mob)
  // the eye (feet at fx fy fz) to the monster's box standing at x z
  const boxGap = (e, x, z, fx, fy, fz) => {
    const w = halfW(e), hh = e.bh > 0 ? e.bh : 1.9, ey = fy + 1.62;
    const cx = Math.max(x - w, Math.min(fx, x + w)), cy = Math.max(e.y, Math.min(ey, e.y + hh)), cz = Math.max(z - w, Math.min(fz, z + w));
    return hyp(cx - fx, cy - ey, cz - fz);
  };
  // the keys for a move along ux uz (world) while looking where the eyes are: forward/back/left/right from the yaw (the client's own
  // walk: forward is (-sin yaw, cos yaw), left is (cos yaw, sin yaw))
  const keysFor = (ux, uz, sprint = false) => {
    const r = (K.yaw() * Math.PI) / 180, mz = -Math.sin(r) * ux + Math.cos(r) * uz, mx = Math.cos(r) * ux + Math.sin(r) * uz;
    K.controls.forward = mz > 0.38; K.controls.back = mz < -0.38; K.controls.left = mx > 0.38; K.controls.right = mx < -0.38;
    K.controls.sprint = sprint && K.controls.forward;
  };
  // a way to step: from the directions round the wanted one, the first with ground to stand on a block along it (no drop of more than
  // one, no lava, fire, water or cliff edge; not into another monster's bite) - backing off a zombie into a lava pool is no spacing
  const stepWay = (ux, uz, foes = []) => {
    const f = K.feet(), [, fy] = feet(), base = Math.atan2(uz, ux);
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.1, -2.1]) {
      const a = base + off, vx = Math.cos(a), vz = Math.sin(a);
      let ok = true;
      for (const s of [0.7, 1.3]) {
        const cx = Math.floor(f.x + vx * s), cz = Math.floor(f.z + vz * s);
        if ((fAt(cx, fy, cz) | fAt(cx, fy + 1, cz)) & (F_LAVA | F_DANGER | F_WATER)) { ok = false; break; }
        const flat = standable(cx, fy, cz) && (fAt(cx, fy - 1, cz) & F_FLOOR), down = !flat && standable(cx, fy - 1, cz) && (fAt(cx, fy - 2, cz) & F_FLOOR);
        if (!flat && !down) { ok = false; break; }
        if ((fAt(cx, fy - 1, cz) | fAt(cx, fy - 2, cz)) & F_LAVA) { ok = false; break; }
      }
      if (ok && foes.some((q) => { const nx = f.x + vx * 1.2, nz = f.z + vz * 1.2; return Math.max(Math.abs(q.x - nx), Math.abs(q.z - nz)) < biteAt(q) + 0.3; })) ok = false;
      if (ok) return [vx, vz];
    }
    return null;
  };
  // each monster's walk as this client saw it, tick by tick (kept on the entity): where it will be a few ticks on
  const track = (m, now) => {
    if (m._t === undefined) { m._t = now; m._px = m.x; m._pz = m.z; m._py = m.y; m._vx = 0; m._vz = 0; m._vy = 0; return; }
    if (now > m._t) { const k = now - m._t; m._vx = m._vx * 0.5 + ((m.x - m._px) / k) * 0.5; m._vz = m._vz * 0.5 + ((m.z - m._pz) / k) * 0.5; m._vy = (m.y - m._py) / k; m._px = m.x; m._pz = m.z; m._py = m.y; m._t = now; }
  };
  const DUEL_MOBS = new Set();   // (types fought with duel_mob: spaced like a monster)
  const SPACED = (q) => DUEL_MOBS.has(q.type) || HOSTILE.test(q.type) && !/enderman|slime|magma_cube|ghast|phantom|blaze|breeze|guardian|warden|ravager|vex/.test(q.type);
  // the fight with e and whatever else comes while it lasts (a second zombie bit from behind while the first was being spaced): every
  // one of them kept out of its bite, the blow for the most pressing one in reach, until e is dead and none is near
  async function spaceFight(e, max = 30, o = {}) {
    const reachOf = (m) => (K.reach?.('entity') ?? 3) - (/creeper/.test(m.type) ? 0.12 : 0.25);   // (a margin: where the server has the two of us)
    let hits = 0, zig = 1, zigT = 0, hurtBy = 0, far = 0, away2 = 0;
    const hp0 = K.attrs().health ?? 20, t0 = Number(K.tick());
    for (let t = 0; t < max * 12 && !K.dead() && !late(); t++) {
      const now = Number(K.tick()), f = K.feet(), alive = K.all().includes(e);
      // (what this client sees of them is half a round trip old, and the next step takes a tick: judged where they will be by then)
      const L = Math.min(10, Math.round((K.lag?.() ?? 0) / 2) + 2);
      const near = K.all().filter((q) => SPACED(q) && !q.gone && Math.abs(q.y - f.y) < 3 && hyp(q.x - f.x, q.z - f.z) < 8);
      if (alive && !near.includes(e)) near.push(e);
      if (!alive && !near.some((q) => MELEE_T.test(q.type) || /creeper/.test(q.type))) break;   // (the one fought is dead and none other comes)
      // an archer's arrows: a new one just off it is its shot - the next comes its reload later (3 s; 2 on hard), and that is the
      // time to close in; with the next one due, sideways to its line (at close range an arrow is there in two ticks: no dodging it)
      for (const a of K.all()) if (!a._seen && !HOSTILE.test(a.type) && !/player|item$/.test(a.type)) {
        a._seen = now;
        const src = near.filter((m) => ARCHER_T.test(m.type)).sort((p2, q2) => hyp(a.x - p2.x, a.z - p2.z) - hyp(a.x - q2.x, a.z - q2.z))[0];
        if (process.env.LAB_FIGHT_TRACE) log(`ft new ${a.type} at ${hyp(a.x - f.x, a.z - f.z).toFixed(1)} from me${src ? `, ${hyp(a.x - src.x, a.z - src.z).toFixed(1)} from the ${sh(src.type)}` : ''}`);
        if (src && /arrow|trident|projectile/.test(a.type) && hyp(a.x - src.x, a.y - (src.y + 1.5), a.z - src.z) < 6) src._shotAt = now;
      }
      for (const m of near) {
        track(m, now);
        m._ex = m.x + m._vx * L; m._ez = m.z + m._vz * L;
        const dx = m._ex - f.x, dz = m._ez - f.z; m._d = hyp(dx, dz) || 0.01; m._ux = dx / m._d; m._uz = dz / m._d;
        m._cheb = Math.max(Math.abs(dx), Math.abs(dz)); m._gap = boxGap(m, m.x, m.z, f.x, f.y, f.z);
        // (ready to be hurt again: 10 ticks after its hurt flash as the server had it - the flash is seen half a round trip late and the
        // blow lands half a round trip after it is sent, so the blow goes a round trip early and lands on the tenth tick exactly: PvP's
        // "0.5 s exactly". Before a flash is seen, 10 ticks from the blow sent)
        const lagT = Math.round(K.lag?.() ?? 0);
        m._ready = m.hurtAt !== undefined && m.hurtAt >= (m._hitAt ?? -99) ? now - m.hurtAt + lagT >= 10 : now - (m._hitAt ?? -99) >= 10;
        m._coming = (m._vx * -m._ux + m._vz * -m._uz) > 0.04;
        // (a spider leaps, and its box is wide: more room)
        // (a creeper lights when the gap between its box and the player's is under 2.5 - measured: a frozen one went off with the player
        // 3.0 from its middle, not at 3.3 - and the sword reaches its box from 3.3: a window of 0.2 blocks, less than it walks in the
        // two ticks a blow takes to land. So it is let come into reach and hit whether it lights or not (the blow throws it back two
        // blocks), and when it lights, away past 6 at a run - its fuse is 30 ticks, and it stops at 6. While it cannot be hurt again it
        // is kept off)
        m._keep = /creeper/.test(m.type) ? (m._ready ? 2.9 : 3.8) : ARCHER_T.test(m.type) && !MELEE_T.test(m.type) ? 1.8 : biteAt(m) + (m._ready ? 0.3 : 0.75) + (/spider/.test(m.type) ? 0.35 : 0);
        m._due = m._shotAt === undefined ? null : m._shotAt + 60 - now;
        m._depth = (/creeper/.test(m.type) ? m._keep - m._d : m._keep + (m._coming && !m._ready ? 0.35 : 0) - m._cheb);
      }
      if (o.stay && alive && e._gap > 3.5 && !near.some((m) => m !== e && m._depth > -0.5)) break;
      // a creeper swelling (it flashes: the server's flag, half a round trip late; or inside 2.95 - lit by now for sure): nothing
      // else matters - the blow at it if one is due (thrown back two blocks), then away
      const lit = near.find((m) => /creeper/.test(m.type) && (m.lit || hyp(m.x - f.x, m.z - f.z) < 2.95) && hyp(m.x - f.x, m.z - f.z) < 7.5);
      // the blow: of those in reach and past their 10 ticks, the one nearest its bite
      const tgt = near.filter((m) => m._ready && m._gap <= reachOf(m) && Math.abs(m.y - f.y) < 2.6 && (!lit || m === lit)).sort((a, b) => a._cheb - b._cheb)[0];
      // (o.crit - duel_mob: an add-on PvP mob that heals itself back from low health - MPVPBOT's mafia takes instant health III, +27,
      // on a 60% roll every 10 ticks once it is at 8 or under: blows of 5 gave it two rolls on the way from 12 to 0 and it lived through 75
      // blows. Every blow a crit (x1.5, jumped and struck on the way down, ~12 ticks a blow): from 15 it dies in two, one roll)
      // (only from outside its bite: crits jumped with it at 0.95 and 1.04 - well inside its 2.35 - were where its blows and its fire
      // aspect came in; closer than that the plain blow and its W-tap throw it back out first)
      if (tgt && o.crit && tgt === e && !lit && hyp(e.x - f.x, e.z - f.z) >= (e._bite ?? 2.4) + 0.2) {
        const [cx, cy, cz] = feet();
        if (!(fAt(cx, cy, cz) & F_WATER) && (fAt(cx, cy + 2, cz) & F_PASS) && (fAt(cx, cy - 1, cz) & F_FLOOR)) {
          stopKeys(); K.controls.jump = true; await K.ticks(1); K.controls.jump = false;
          let py = K.feet().y, struck = false;
          for (let k = 0; k < 14 && K.all().includes(e) && !K.dead(); k++) {
            await K.ticks(1);
            const g = K.feet(), gap = boxGap(e, e.x, e.z, g.x, g.y, g.z);
            K.lookAt(e.x, e.y + Math.min(1.5, (e.bh > 0 ? e.bh : 1.9) * 0.62), e.z);
            // (kept at the edge of reach on the way up: its bite is shorter than the sword's)
            if (gap < reachOf(e) - 0.6) { const ux = (g.x - e.x) / (hyp(g.x - e.x, g.z - e.z) || 1), uz = (g.z - e.z) / (hyp(g.x - e.x, g.z - e.z) || 1); keysFor(ux, uz, false); } else stopKeys();
            if (g.y < py - 0.01 && g.y > cy + 0.1 && gap <= reachOf(e)) {
              if (process.env.LAB_GOAL_DEBUG) log(`fight ${sh(e.type)} at ${hyp(e.x - g.x, e.z - g.z).toFixed(2)} (reach ${gap.toFixed(2)}, crit) with ${sh(nm(K.inv.slots[K.inv.selected] ?? {}) || 'hand')}, health ${Math.round(K.attrs().health ?? 0)}`);
              await K.hit(e, 'attack', true); e._hitAt = Number(K.tick()); hits++; struck = true; break;
            }
            py = g.y;
          }
          stopKeys();
          if (struck) continue;
        }
      }
      if (tgt) {
        if (process.env.LAB_GOAL_DEBUG) log(`fight ${sh(tgt.type)} at ${hyp(tgt.x - f.x, tgt.z - f.z).toFixed(2)} (reach ${tgt._gap.toFixed(2)}) with ${sh(nm(K.inv.slots[K.inv.selected] ?? {}) || 'hand')}, health ${Math.round(K.attrs().health ?? 0)}`);
        // the W-tap: a sprint for the tick before the blow (the server throws a monster hit by a sprinting player 2.2 blocks, not 1.6 -
        // measured on a husk), let go after it (sprinting on would run into it); not in water, not hungry, not with an archer's
        // (thrown further, it shoots from there); only while the server answers within a tick or two (the drills at 20x, where what is
        // seen is 5-10 ticks old, lost two of four with it: the lunge went into a bite) and with a weapon (a fist throws little)
        const [wx, wy, wz] = feet(), tap = !process.env.LAB_NO_WTAP && !(fAt(wx, wy, wz) & F_WATER) && (K.attrs()['player.hunger'] ?? 20) > 6 && !ARCHER_T.test(tgt.type) && !/spider/.test(tgt.type) && !K.controls.sprint && L <= 3 && WEAPONS.includes(sh(nm(K.inv.slots[K.inv.selected] ?? {}) || ''));   // (a spider leaps back at once: no lunge at it)
        if (tap) { K.lookAt(tgt.x, tgt.y + Math.min(1.5, (tgt.bh > 0 ? tgt.bh : 1.9) * 0.62), tgt.z); K.controls.back = K.controls.left = K.controls.right = false; K.controls.forward = K.controls.sprint = true; await K.ticks(1); }
        await K.hit(tgt, 'attack', true); tgt._hitAt = Number(K.tick()); if (tgt === e) hits++;
        if (tap) { K.controls.forward = K.controls.sprint = false; K.controls.back = true; }   // (and the S-tap: the run's momentum taken off)
        continue;
      }
      const main = alive ? e : near.sort((a, b) => a._cheb - b._cheb)[0];
      if (!main) break;
      K.lookAt(main.x, main.y + Math.min(1.5, (main.bh > 0 ? main.bh : 1.9) * 0.62), main.z);
      // a critical hit (x1.5: a stone sword's zombie in three blows, not four): jump as it walks in, strike on the way down when it
      // comes into reach - one monster, nothing else near, open level ground, room overhead, not in water, not a creeper or an archer
      // (while in the air there is no stepping back: only when it will still be outside its bite at the blow)
      if (!process.env.LAB_NO_CRIT && !lit && alive && main === e && e._ready && e._coming && !/creeper/.test(e.type) && !ARCHER_T.test(e.type) && near.every((m) => m === e || m._cheb > 6)
        && e._gap > reachOf(e) + 0.15 && e._gap < reachOf(e) + 0.9 && e._cheb - 0.11 * 9 > biteAt(e) + 0.4) {
        const [cx, cy, cz] = feet();
        const open = !(fAt(cx, cy, cz) & F_WATER) && (fAt(cx, cy + 2, cz) & F_PASS) && (fAt(cx, cy - 1, cz) & F_FLOOR) && !K.moving?.();
        if (open) {
          stopKeys(); K.controls.jump = true; await K.ticks(1); K.controls.jump = false;
          let py = K.feet().y, struck = false;
          for (let k = 0; k < 14 && K.all().includes(e) && !K.dead(); k++) {
            await K.ticks(1);
            const g = K.feet(), fy = g.y, gap = boxGap(e, e.x, e.z, g.x, g.y, g.z);
            K.lookAt(e.x, e.y + Math.min(1.5, (e.bh > 0 ? e.bh : 1.9) * 0.62), e.z);
            if (fy < py - 0.01 && fy > cy + 0.1 && gap <= reachOf(e)) {
              if (process.env.LAB_GOAL_DEBUG) log(`fight ${sh(e.type)} at ${hyp(e.x - g.x, e.z - g.z).toFixed(2)} (reach ${gap.toFixed(2)}, crit) with ${sh(nm(K.inv.slots[K.inv.selected] ?? {}) || 'hand')}, health ${Math.round(K.attrs().health ?? 0)}`);
              await K.hit(e, 'attack', true); e._hitAt = Number(K.tick()); hits++; struck = true; break;
            }
            if (fy <= cy + 0.01 && k > 2) break;   // (down again without the blow)
            py = fy;
          }
          if (!struck && process.env.LAB_FIGHT_TRACE) log('ft crit: landed without the blow');
          continue;
        }
      }
      // a creeper lit: out past 6 at a run (its fuse is 30 ticks and stops when the player is 6 off), facing away, not backwards;
      // until the flash stops (the server's flag) or 7.5 off
      if (lit) {
        const w = stepWay(-lit._ux, -lit._uz, near.filter((m) => m !== lit)) ?? stepWay(lit._uz, -lit._ux, []) ?? stepWay(-lit._uz, lit._ux, []);
        // nowhere to run, or too close to outrun it: a block between (measured, lit at 2.8: 15 damage in the open; one block at the feet
        // on its side, 1; one at head height, none - it lost sight of the player and its fuse stopped)
        if ((!w || hyp(lit.x - f.x, lit.z - f.z) < 2.6) && blockItem() && now - (lit._walled ?? -99) > 40) {
          lit._walled = now;
          const n = await wallToward(lit);
          if (process.env.LAB_GOAL_DEBUG) log(`fight: the creeper lit ${hyp(lit.x - f.x, lit.z - f.z).toFixed(1)} off ${w ? 'too close to outrun' : 'with nowhere to run'}: ${n} block(s) put between`);
          if (n) { const wp = WEAPONS.find((x) => cnt(x) > 0); if (wp) await grab(wp, 'fight'); await K.ticks(1); continue; }
        }
        if (w) {
          if (process.env.LAB_GOAL_DEBUG) log(`fight: the creeper lit ${hyp(lit.x - f.x, lit.z - f.z).toFixed(1)} off${lit.lit ? '' : ' (by distance)'}: away at a run`);
          K.look((Math.atan2(-w[0], w[1]) * 180) / Math.PI, 0); K.controls.forward = true; K.controls.sprint = true; K.controls.back = K.controls.left = K.controls.right = false;
          for (let k = 0; k < 40 && K.all().includes(lit) && !K.dead(); k++) {
            await K.ticks(1);
            const g = K.feet(), dd = hyp(lit.x - g.x, lit.z - g.z);
            if (dd > 7.5 || (!lit.lit && dd > 6.4)) break;
            if (k % 5 === 4) { const w2 = stepWay(g.x - lit.x, g.z - lit.z, near.filter((m) => m !== lit)) ?? stepWay(g.x - lit.x, g.z - lit.z, []); if (w2) K.look((Math.atan2(-w2[0], w2[1]) * 180) / Math.PI, 0); }
          }
          stopKeys(); continue;
        }
      }
      // the shield (Bedrock: raised while sneaking, 5 ticks to come up): up when an archer in sight is about to shoot (its reload
      // counted from the last arrow), down to strike and to move at pace
      if (shieldUp()) {
        const aim = near.find((m) => ARCHER_T.test(m.type) && !MELEE_T.test(m.type) && m._gap < 15 && sees(m) && (m._due === null || m._due <= 8));
        if (aim && !near.some((m) => m !== aim && m._depth > -0.3)) { K.lookAt(aim.x, aim.y + 1.2, aim.z); stopKeys(); K.controls.sneak = true; if (process.env.LAB_FIGHT_TRACE) log(`ft shield up at the ${sh(aim.type)} (due ${aim._due})`); await K.ticks(1); continue; }
        K.controls.sneak = false;
      }
      // two coming from two sides: a wall of two blocks on the second one's side - it has to walk round, and they come one at a time
      // (a 1-on-1 made of a crowd); not a creeper (it is not fought close), not while one is at the throat
      if (!o.stay && L <= 3 && blockItem() && now - (spaceFight.walled ?? -99) > 60 && !near.some((m) => m._d < 4.5)) {   // (a block is a few ticks each: only with none of them close, and a server that answers at once)
        const melee = near.filter((m) => MELEE_T.test(m.type) && m._coming).sort((a, b) => a._d - b._d);
        if (melee.length >= 2 && melee[0]._d > 4.5) {   // (the nearer one far enough that the two blocks are set before it is here)
          const [a1, b1] = melee, cos = a1._ux * b1._ux + a1._uz * b1._uz;
          if (cos < 0.35 && b1._d < 6 && b1._d > 3) {
            spaceFight.walled = now; stopKeys();
            const n = await wallToward(b1);
            if (process.env.LAB_GOAL_DEBUG) log(`fight: two from two sides (${sh(a1.type)} ${a1._d.toFixed(1)}, ${sh(b1.type)} ${b1._d.toFixed(1)}): ${n} blocks on the second one's side`);
            const wp = WEAPONS.find((x) => cnt(x) > 0); if (wp) await grab(wp, 'fight');
            continue;
          }
        }
      }
      // where to be: out of every bite with room to spare, the more so while one cannot be hurt again; away from the lot of them,
      // the nearer and deeper in the more
      let ax = 0, az = 0;
      for (const m of near) if (m._depth > 0) { ax -= m._ux * (m._depth + 0.25); az -= m._uz * (m._depth + 0.25); }
      if (ax || az) {
        const n = hyp(ax, az), w = stepWay(ax / n, az / n, near);
        if (w) keysFor(w[0], w[1]); else stopKeys();
      } else if (alive && e._gap > reachOf(e) + 3 && !o.stay && (e._gap > 14 || !sees(e) || !stepWay(e._ux, e._uz, near.filter((m) => m !== e)))) {
        // (far, out of sight, or round a corner: the path finder takes it to a few blocks off, the rest is done here)
        stopKeys(); if (++far > 3 || !(await goToEntity(e, reachOf(e) + 2.5))) { if (process.env.LAB_GOAL_DEBUG) log(`fight: could not get near the ${sh(e.type)} (${e._gap.toFixed(1)} off, in sight ${sees(e)}, way ${!!stepWay(e._ux, e._uz, [])})`); break; } continue;
      } else if (alive && e._gap > reachOf(e) - 0.05 && !(/spider/.test(e.type) && e._gap < reachOf(e) + 1.0) && (e._ready || now - (e._hitAt ?? -99) >= 7 || (ARCHER_T.test(e.type) && e._due !== null && e._due > 14)) && (!e._coming || ARCHER_T.test(e.type) || e._gap > reachOf(e) + 1.2)
        && !near.some((m) => m !== e && m._depth > -0.6)) {
        // in to meet it: an archer in zigzags (its arrows go where the player was), the rest straight; a sprint only from afar
        const archer = ARCHER_T.test(e.type), rush = archer && e._due !== null && e._due > 14;   // (just shot: 45 ticks to be at it)
        if (archer && now - zigT > 12) { zig = -zig; zigT = now; }
        const side = archer && !rush ? 0.8 : 0, sx = e._ux - e._uz * side * zig, sz = e._uz + e._ux * side * zig, n = hyp(sx, sz) || 1;
        const w = stepWay(sx / n, sz / n, near.filter((m) => m !== e)) ?? stepWay(e._ux, e._uz, near.filter((m) => m !== e));
        if (w) keysFor(w[0], w[1], e._gap > reachOf(e) + (rush ? 0.8 : 3)); else { stopKeys(); if (e._gap > reachOf(e) + 2) break; }
        if (!archer && e._gap > reachOf(e) + 6 && !e._coming) { if (++away2 > 60) break; } else away2 = 0;   // (it ran off: let it go after 3 s)
      } else if (near.some((m) => ARCHER_T.test(m.type) && !MELEE_T.test(m.type) && m._gap > 1.5 && m._gap < 16 && sees(m) && (m._due === null || m._due <= 14))) {
        // (an archer about and nothing to do this tick: never still - sideways to its line, turn about every 12 ticks; standing to
        // wait out its 10 ticks after a blow, two arrows in)
        const a = near.find((m) => ARCHER_T.test(m.type) && !MELEE_T.test(m.type));
        if (now - zigT > 12) { zig = -zig; zigT = now; }
        const w = stepWay(-a._uz * zig, a._ux * zig, near.filter((m) => m !== a)) ?? stepWay(a._uz * zig, -a._ux * zig, near.filter((m) => m !== a));
        if (w) keysFor(w[0], w[1]); else stopKeys();
      } else stopKeys();
      if (process.env.LAB_FIGHT_TRACE) log(`ft t${now} L${L} ${near.map((m) => `${sh(m.type)} d${hyp(m.x - f.x, m.z - f.z).toFixed(2)}>${m._d.toFixed(2)} ch${m._cheb.toFixed(2)} g${m._gap.toFixed(2)} dep${m._depth.toFixed(2)}${m._ready ? '' : '*'}${m._due !== null && m._due !== undefined ? ` due${m._due}` : ''}`).join(' | ')} keys ${Object.entries(K.controls).filter(([, v]) => v).map(([k]) => k).join('+')}`);
      const hp = K.attrs().health ?? 20; if (hp < hp0 - hurtBy - 0.5) { hurtBy = hp0 - hp; if (process.env.LAB_GOAL_DEBUG) log(`fight: hit (health ${Math.round(hp)}) - ${near.map((m) => `${sh(m.type)} ${m._cheb.toFixed(2)}${m._ready ? '' : '*'}`).join(', ')}`); }
      if (o.stay) { K.controls.forward = K.controls.back = K.controls.left = K.controls.right = false; }
      await K.ticks(1);
    }
    stopKeys();
    if (process.env.LAB_GOAL_DEBUG) log(`fight ${sh(e.type)}: ${K.all().includes(e) ? 'broken off' : 'dead'} after ${hits} blows in ${((Number(K.tick()) - t0) / 20).toFixed(1)} s, ${hurtBy ? `lost ${hurtBy.toFixed(1)} health` : 'not touched'}`);
    return !K.all().includes(e);
  }
  // a shield carried goes to the off hand before a fight (raised by sneaking: it stops an arrow and a creeper's blast from the front)
  const shieldUp = () => sh(nm(K.offhand?.() ?? {}) || '') === 'shield';
  // ---------------- block technique in a fight ----------------
  // a drop of 3 or more in the cell next to the feet along ux uz (where a blow would throw the player): [x, y, z] of the cell to fill
  const dropAt = (ux, uz) => {
    const f = K.feet(), [fx, fy, fz] = feet();
    if (!(fAt(fx, fy - 1, fz) & F_FLOOR) || Math.abs(f.y - fy) > 0.05) return null;   // (only standing on the ground: in the air the feet's cell says nothing)
    for (const s of [0.9, 1.5]) {
      const cx = Math.floor(f.x + ux * s), cz = Math.floor(f.z + uz * s);
      if (cx === fx && cz === fz) continue;
      if (fAt(cx, fy - 1, cz) & F_FLOOR) return null;
      if (!(fAt(cx, fy, cz) & F_PASS)) return null;
      let drop = 1; while (drop < 5 && !(fAt(cx, fy - 1 - drop, cz) & (F_FLOOR | F_WATER))) drop++;
      return drop >= 3 ? [cx, fy - 1, cz] : null;
    }
    return null;
  };
  // the edge behind the player, on the side a blow comes from, filled before the blow (knocked off a ledge mid-combo is the combo's
  // end: PvP players block the edge behind them)
  const edgeFilled = new Map();
  async function guardEdge(foe) {
    const f = K.feet(), dx = f.x - foe.x, dz = f.z - foe.z, n = hyp(dx, dz) || 1;
    for (const [ux, uz] of [[dx / n, dz / n], [dx / n - dz / n * 0.7, dz / n + dx / n * 0.7], [dx / n + dz / n * 0.7, dz / n - dx / n * 0.7]]) {
      const c = dropAt(ux, uz); if (!c || !blockItem()) continue;
      const k = c.join(); if (Number(K.tick()) - (edgeFilled.get(k) ?? -99) < 40) continue; edgeFilled.set(k, Number(K.tick()));
      const ok = await fillCell(c);
      if (process.env.LAB_GOAL_DEBUG) log(`fight: the edge behind me at ${k} ${ok ? 'blocked' : 'could not be blocked'}`);
      return ok;
    }
    return null;   // (nothing tried)
  }
  // the block clutch: thrown off an edge anyway (a blow, a combo), a block set under the body before it drops below the ledge - judged
  // inside every tick (K.everyTick: the loop's own ticks can come late) with a block already on the hotbar: its key, the click on the
  // side of the ledge block, the weapon's key again three ticks on. Installed for a fight; returns the off switch
  const BLOCKISH = /_(log|planks|wood|stem)$|^(cobblestone|cobbled_deepslate|dirt|grass_block|stone|sand|netherrack|coarse_dirt|mud|andesite|diorite|granite|tuff|deepslate|oak_planks)$/;
  function clutchGuard() {
    if (!K.everyTick) return () => {};
    let ground = null, last = -99, back = null;
    return K.everyTick(() => {
      const now = Number(K.tick());
      if (back && now >= back.at) { K.act('slot', [String(back.slot)]).catch(() => {}); back = null; }
      const f = K.feet(), fx = Math.floor(f.x), fy = Math.floor(f.y + 0.01), fz = Math.floor(f.z);
      if ((fAt(fx, fy - 1, fz) & (F_FLOOR | F_WATER)) && f.y - fy < 0.02) { ground = fy; return; }
      if (ground === null || f.y < ground - 0.45 || f.y > ground + 1.4 || now - last < 8) return;
      const sy = ground - 1;
      if (fAt(fx, sy, fz) & (F_SOLID | F_WATER)) return;
      let drop = 0; while (drop < 4 && !(fAt(fx, sy - drop, fz) & (F_FLOOR | F_WATER | F_SOLID))) drop++;
      if (drop < 3) return;
      const hb = K.inv.slots.slice(0, 9).findIndex((it) => it?.network_id && BLOCKISH.test(sh(nm(it))));
      if (hb < 0) return;
      const nb = FACES.find(([dx, dy, dz]) => dy <= 0 && (fAt(fx + dx, sy + dy, fz + dz) & F_SOLID));
      if (!nb) return;
      last = now; const was = K.inv.selected;
      if (was !== hb) K.act('slot', [String(hb)]).catch(() => {});
      K.act('useon', [S(fx + nb[0]), S(sy + nb[1]), S(fz + nb[2]), nb[3], 'fast']).catch(() => {});
      if (was !== hb) back = { at: now + 3, slot: was };
      if (process.env.LAB_GOAL_DEBUG) K.say(`get: clutch: a block under me at ${fx} ${sy} ${fz} (thrown off the edge, ${drop}+ down)`);
    });
  }
  // a wall of two between the player and one of them (feet and head height, the cell next to the player on its side): a creeper's
  // blast mostly stopped (it counts the rays from it that reach the player), a second zombie sent round (a 1-on-1 made of a crowd)
  async function wallToward(m) {
    const [fx, fy, fz] = feet(), dx = m.x - (fx + 0.5), dz = m.z - (fz + 0.5);
    const [sx, sz] = Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
    let n = 0; for (const dy of [0, 1]) if (await fillCell([fx + sx, fy + dy, fz + sz])) n++;
    return n;
  }
  // ---------------- the ender dragon (rebuilt from the lost session's notes: training/RTA_NOTES.md) ----------------
  // Measured on BDS 1.26: the exit fountain is round (0.5, 60, 0.5); the dragon perches over it at (0±2, 64.5-65.8, 0±2) for up to
  // ~50 s, every blow on it is damage/4 + 1 (a diamond sword 3, a crit 4), the server takes a blow only from near its middle (eye to
  // its position under ~5.9). Sitting, its breath lands as a cloud 5 round a point ~9 out past its head: within 3 of its middle is
  // out of it. Flying, its body hurts (swoops, charges): away from the fountain, 10-13 out on the side away from it, out of clouds.
  async function endFight(maxSec = 600) {
    const hs0 = holdStill, rb0 = reflexBusy; holdStill = true; reflexBusy = true;
    try { return await endFight0(maxSec); } finally { holdStill = hs0; reflexBusy = rb0; }
  }
  async function endFight0(maxSec) {
    const t0 = Number(K.tick()), dbg = !!process.env.LAB_GOAL_DEBUG;
    if (offName() !== 'shield' && cnt('shield') > 0) { try { await duelOffhand(); } catch {} }
    const w = WEAPONS.find((x) => cnt(x) > 0); if (w) await grab(w, 'fight');
    endFight.hp = undefined; endFight.burns = []; endFight.retreat = null;
    let hits = 0, perches = 0, sat = false, ateAt = -99, hitAt = -99, saidT = -99;
    for (;;) {
      const now = Number(K.tick());
      if ((now - t0) / 20 > maxSec || K.dead()) break;
      const d = K.all().find((q) => q.type === 'minecraft:ender_dragon');
      if (!d || d.dead) { await K.ticks(20); if (!K.all().some((q) => q.type === 'minecraft:ender_dragon')) break; continue; }
      track(d, now);
      const f = K.feet(), hp = K.attrs().health ?? 20;
      const perched = hyp(d.x - 0.5, d.z - 0.5) < 3.2 && d.y < 67 && Math.abs(d._vy ?? 0) < 0.15;
      if (perched && !sat) { perches++; if (dbg) log(`dragon: sits (perch ${perches}) at ${d.x.toFixed(1)} ${d.y.toFixed(1)} ${d.z.toFixed(1)}`); }
      if (!perched && sat && dbg) log(`dragon: up again`);
      sat = perched;
      if ((hp < 13 || (K.attrs()['player.hunger'] ?? 20) < 16) && !perched && (hyp(d.x - K.feet().x, d.z - K.feet().z) > 20 || hp < 7) && !K.all().some((q) => /area_effect_cloud/.test(q.type) && hyp(q.x - K.feet().x, q.z - K.feet().z) < (q.radius ?? 5) + 1) && now - ateAt > 45 && FOOD.some((x) => cnt(x) > 0)) { ateAt = now; stopKeys(); try { await grab(FOOD.find((x) => cnt(x) > 0), 'eat'); await K.act('use', ['36']); } catch {} if (w) { try { await grab(w, 'fight'); } catch {} } continue; }
      // Where to be (the lost session's last design, training/RTA_NOTES.md m397/m399): while it flies, down in the fountain's bowl by
      // the pillar on the side away from it (its swoops and charges went through a player on the ring 13 out; in the bowl its box
      // stays 63.1 and up) with the shield raised toward it while it is low and near; out only for its breath and its fireballs'
      // puddles (a puddle 6 round for 6 s where a fireball meets the ground, 3 a second: its landing point from its flight)
      // (its size now: the radius it came with and its change each tick - they grow - and gone once its time is up)
      const clouds = K.all().filter((q) => /area_effect_cloud/.test(q.type)).map((q) => { const age = now - Number(q.cloudT0 ?? now); return { x: q.x, y: q.y, z: q.z, radius: Math.max(0, (q.radius ?? 5) + (Number.isFinite(q.cloudRate) ? q.cloudRate * age : 0)), gone: Number.isFinite(q.cloudDur) && q.cloudDur > 0 && age > q.cloudDur + 10 }; }).filter((q) => !q.gone && q.radius > 0.3);
      // (and where it burned: health lost with neither the dragon's body nor an enderman near is a cloud there, whatever the clouds
      // the server described say - their radius as sent stayed 5-6 while the player burned 7 out - kept 10 s, 3.5 round)
      { const lastHp = endFight.hp ?? hp; endFight.hp = hp;
        if (hp < lastHp - 0.5 && hyp(d.x - f.x, d.y - f.y, d.z - f.z) > 7 && !K.all().some((q) => q.type === 'minecraft:enderman' && hyp(q.x - f.x, q.z - f.z) < 4)) (endFight.burns ??= []).push({ x: f.x, z: f.z, t: now }); }
      endFight.burns = (endFight.burns ?? []).filter((b) => now - b.t < 200);
      const inCloud = (x, z) => clouds.some((q) => hyp(q.x - x, q.z - z) < (q.radius ?? 5) + 1.3) || endFight.burns.some((b) => hyp(b.x - x, b.z - z) < 3.5);
      const balls = K.all().filter((q) => /dragon_fireball/.test(q.type));
      const lands = balls.map((q) => { track(q, now); let x = q.x, y = q.y, z = q.z; for (let k = 0; k < 60 && y > 61; k++) { x += q._vx; y += q._vy ?? -1; z += q._vz; } return { x, z }; });
      const hot = (x, z) => inCloud(x, z) || lands.some((l) => hyp(l.x - x, l.z - z) < 4.2);
      let tx, tz, why = '';
      const low = hp < 7 && FOOD.some((x) => cnt(x) > 0);
      if (!low) endFight.retreat = null;
      if (low && !perched) { if (!endFight.retreat || hot(...endFight.retreat)) { const k = hyp(f.x - 0.5, f.z - 0.5) || 1, c = [...Array(16).keys()].map((q) => [0.5 + Math.cos(Math.atan2(f.z - 0.5, f.x - 0.5) + (q - 8) * 0.2) * 20, 0.5 + Math.sin(Math.atan2(f.z - 0.5, f.x - 0.5) + (q - 8) * 0.2) * 20]).filter(([x, z]) => !hot(x, z)).sort((p1, p2) => hyp(p1[0] - f.x, p1[1] - f.z) - hyp(p2[0] - f.x, p2[1] - f.z)); endFight.retreat = c[0] ?? [0.5 + ((f.x - 0.5) / k) * 20, 0.5 + ((f.z - 0.5) / k) * 20]; }
        [tx, tz] = endFight.retreat; why = 'it, low: to eat far out'; }
      else if (perched && !hot(d.x, d.z)) { tx = d.x; tz = d.z; }   // under its belly
      else if (perched) {   // its belly in a cloud (the breath comes down on the fountain too): the nearest spot out of it, to go in after
        const sp = [4, 6, 8, 10].flatMap((r) => [...Array(12).keys()].map((k) => [d.x + Math.cos(k * Math.PI / 6) * r, d.z + Math.sin(k * Math.PI / 6) * r])).filter(([x, z]) => !hot(x, z)).sort((p1, p2) => hyp(p1[0] - f.x, p1[1] - f.z) - hyp(p2[0] - f.x, p2[1] - f.z))[0] ?? [f.x, f.z];
        [tx, tz] = sp; why = 'a cloud under it';
      }   // (under the belly: the breath lands 8 out past its head, whichever way it turns)
      else {
        // round the pillar: the spot 2.3 from its middle away from the dragon, else the other bowl spots, else out of the fire
        const base = Math.atan2(0.5 - d.z, 0.5 - d.x), spots = [0, 1.2, -1.2, 2.4, -2.4, Math.PI].map((o) => [0.5 + Math.cos(base + o) * 2.3, 0.5 + Math.sin(base + o) * 2.3]);
        const ok = spots.find(([x, z]) => !hot(x, z));
        if (ok) [tx, tz] = ok;
        else { const far = [5, 7, 9, 12].flatMap((r) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => [0.5 + Math.cos(base + k * Math.PI / 6) * r, 0.5 + Math.sin(base + k * Math.PI / 6) * r])).filter(([x, z]) => !hot(x, z)).sort((p1, p2) => hyp(p1[0] - f.x, p1[1] - f.z) - hyp(p2[0] - f.x, p2[1] - f.z))[0] ?? [f.x, f.z]; [tx, tz] = far; why = 'the bowl is on fire'; }
      }
      if (hot(f.x, f.z)) why ||= 'a cloud or a fireball';
      if (why && dbg && now - saidT > 20) { saidT = now; log(`dragon: away from ${why} at ${f.x.toFixed(1)} ${f.y.toFixed(1)} ${f.z.toFixed(1)} to ${tx.toFixed(1)} ${tz.toFixed(1)}; clouds ${clouds.map((q) => `${q.x.toFixed(0)},${q.y.toFixed(0)},${q.z.toFixed(0)} r${(q.radius ?? -1).toFixed(1)}`).join(' ')}; lands ${lands.map((l) => `${l.x.toFixed(0)},${l.z.toFixed(0)}`).join(' ')}`); }
      // the shield toward it while it is near and low and moving (its body: 5-10 and a knock)
      const guard = !perched && offName() === 'shield' && hyp(d.x - f.x, d.y - f.y, d.z - f.z) < 14 && !why;
      // an enderman at the player (looked in the face it comes, 3.8-7 a bite, 40 health: five blows): fought where it stands, never
      // chased past 6 (one that teleported off was followed through the breath for 20 s and the player died; one let bite while the
      // loop only swung when it happened to be in reach killed another run)
      { const en = K.all().find((q) => q.type === 'minecraft:enderman' && !q.dead && hyp(q.x - f.x, q.y - f.y, q.z - f.z) < 4.5);
        const burning = (endFight.burns ?? []).some((b) => now - b.t < 30 && hyp(b.x - f.x, b.z - f.z) < 3.5);   // (out of the fire first)
        if (en && !burning) {
          if (dbg) log(`dragon: an enderman on me (health ${Math.round(hp)})`);
          for (let t = 0; t < 400 && !K.dead() && K.all().includes(en) && !en.dead; t++) {
            const g = K.feet(), dn = hyp(en.x - g.x, en.z - g.z), n2 = Number(K.tick());
            if (dn > 6) break;
            K.lookAt(en.x, en.y + 1.4, en.z);
            if (boxGap(en, en.x, en.z, g.x, g.y, g.z) <= 2.9 && n2 - (en._hitAt ?? -99) >= 10) { stopKeys(); await K.hit(en, 'attack', true); en._hitAt = n2; }
            else if (dn > 2.2) keysFor((en.x - g.x) / dn, (en.z - g.z) / dn, false); else stopKeys();
            await K.ticks(1);
          }
          stopKeys(); continue;
        } }
      // the eyes never on an enderman's face (within 8 degrees of one's head): lower, at the ground in front, until it is out of the way
      { const ex = f.x, ey = f.y + 1.62, ez = f.z, lx = d.x - ex, ly = d.y + (perched ? 1 : 2) - ey, lz = d.z - ez, ll = hyp(lx, ly, lz) || 1;
        const stare = K.all().some((q) => q.type === 'minecraft:enderman' && (() => { const hx = q.x - ex, hy = q.y + 2.6 - ey, hz = q.z - ez, hl = hyp(hx, hy, hz) || 1; return hl < 64 && (hx * lx + hy * ly + hz * lz) / (hl * ll) > 0.965; })());
        if (stare && !(perched && hyp(d.x - f.x, d.z - f.z) < 4)) K.lookAt(d.x, f.y - 1, d.z); else K.lookAt(d.x, d.y + (perched ? 1 : 2), d.z); }
      const eyeD = hyp(d.x - f.x, d.y - (f.y + 1.62), d.z - f.z);
      if (perched && eyeD < 5.6 && now - hitAt >= 10 && !(hot(f.x, f.z) && hp < 10)) {
        stopKeys(); K.controls.jump = false; await K.hit(d, 'attack', true); hitAt = now; hits++;
        if (dbg && hits % 10 === 0) log(`dragon: blow ${hits} at ${eyeD.toFixed(1)}`);
        await K.ticks(1); continue;
      }
      const dx = tx - f.x, dz = tz - f.z, dd = hyp(dx, dz);
      if (dd > 0.6) { const way = stepWay(dx / dd, dz / dd, []) ?? [dx / dd, dz / dd]; keysFor(way[0], way[1], dd > 3 || !!why); K.controls.jump = perched && eyeD < 7 && now - hitAt >= 6 && now - hitAt <= 7; }
      else { stopKeys(); if (perched && now - hitAt >= 6 && now - hitAt <= 7) K.controls.jump = true; }   // (the jump so the blow lands on the way down: a crit)
      if (guard) K.controls.sneak = true, K.controls.sprint = false; else K.controls.sneak = false;
      await K.ticks(1); K.controls.jump = false;
    }
    stopKeys();
    const dead = !K.dead() && !K.all().some((q) => q.type === 'minecraft:ender_dragon');
    log(`dragon: ${dead ? 'dead' : K.dead() ? 'it killed me' : 'not dead'} after ${hits} blows, ${perches} perches in ${((Number(K.tick()) - t0) / 20).toFixed(0)} s`);
    return dead;
  }
  // end_run: from the portal's platform (100 east of the island's middle at y=48, under the rim) to the fountain - dug and pillared
  // as the path finder needs - the dragon, then its exit portal in the fountain's bowl once it has opened (after the death throes)
  async function endRun(maxSec = 900) {
    const t0 = Number(K.tick()), dbg = !!process.env.LAB_GOAL_DEBUG, dimNow = () => dimName();
    if (dimNow() !== 'the_end') return 'not in the End';
    await travel((x, y, z) => hyp(x - 0.5, z - 0.5) <= 9 && y >= 59, (x, y, z) => hyp(x - 0.5, z - 0.5) + Math.max(0, 60 - y), { radius: 128, dig: true, pillar: true, legs: 30 });
    if (dbg) log(`end: at the fountain after ${((Number(K.tick()) - t0) / 20).toFixed(0)} s`);
    if (!(await endFight(Math.max(60, maxSec - (Number(K.tick()) - t0) / 20)))) return K.dead() ? 'killed' : 'the dragon still lives';
    if (dbg) log(`end: the dragon is dead after ${((Number(K.tick()) - t0) / 20).toFixed(0)} s`);
    for (let k = 0; k < 60; k++) {   // its exit portal: end_portal blocks in the bowl
      let cell = null;
      for (let dx = -4; dx <= 4 && !cell; dx++) for (let dz = -4; dz <= 4 && !cell; dz++) for (let y = 56; y <= 64 && !cell; y++) if (/end_portal$/.test(bname(dx, y, dz))) cell = [dx, y, dz];
      if (cell) {
        await travel((x, y, z) => x === cell[0] && z === cell[2] && Math.abs(y - cell[1]) <= 1, (x, y, z) => hyp(x - cell[0], y - cell[1], z - cell[2]), { radius: 32, dig: true, legs: 6 });
        for (let t = 0; t < 100 && dimNow() === 'the_end'; t++) await K.ticks(1);
        if (dimNow() !== 'the_end') { if (dbg) log(`end: out through the portal after ${((Number(K.tick()) - t0) / 20).toFixed(0)} s`); return 'done'; }
      }
      await K.ticks(20);
    }
    return 'no way out found';
  }
  // ---------------- the nether: a fortress and its blazes (rebuilt from training/RTA_NOTES.md m3199-m3363) ----------------
  // a fortress: its nether bricks among the blocks the server has sent (a whole view distance); none: on in straight legs of 48, the
  // same way while it keeps going, dug and pillared as the path finder needs, until some are
  async function netherSeek(maxSec = 600) {
    const t0 = Number(K.tick()), dbg = !!process.env.LAB_GOAL_DEBUG;
    let dir = Math.random() * Math.PI * 2;
    for (let leg = 0; (Number(K.tick()) - t0) / 20 < maxSec && !K.dead(); leg++) {
      const f = K.feet();
      const bricks = K.findBlocks((b) => /^minecraft:(nether_brick|nether_brick_fence|red_nether_brick)$/.test(b.name) || b.name === 'minecraft:nether_bricks', { max: 8, radius: 160, from: f }) ?? [];
      if (bricks.length) {
        const b = bricks[0], bx = b.x ?? b[0], by = b.y ?? b[1], bz = b.z ?? b[2];
        if (dbg) log(`nether: a fortress's bricks at ${bx} ${by} ${bz} (${hyp(bx - f.x, bz - f.z).toFixed(0)} off) after ${((Number(K.tick()) - t0) / 20).toFixed(0)} s`);
        const ok = await travel((x, y, z) => hyp(x - bx, y - by, z - bz) <= 4, (x, y, z) => hyp(x - bx, y - by, z - bz), { radius: 180, dig: true, pillar: true, legs: 30 });
        if (ok) return { x: bx, y: by, z: bz };
        dir += 1.2; continue;
      }
      const tx = f.x + Math.cos(dir) * 48, tz = f.z + Math.sin(dir) * 48;
      if (dbg) log(`nether: no fortress in sight at ${f.x.toFixed(0)} ${f.y.toFixed(0)} ${f.z.toFixed(0)}: a leg toward ${tx.toFixed(0)} ${tz.toFixed(0)}`);
      await travel((x, y, z) => hyp(x - tx, z - tz) <= 4, (x, y, z) => hyp(x - tx, z - tz), { radius: 96, dig: true, pillar: true, legs: 8 });
      const g = K.feet(); if (hyp(g.x - f.x, g.z - f.z) < 12) dir += 0.9;   // (blocked that way: turned)
    }
    return null;
  }
  // blazes, by their spawner: the shield raised toward them (sneaking) - it takes their small fireballs whole - lowered only for
  // the blow at one in reach whose window is open; hurt and none close: eat; their rods picked up when it goes quiet
  // The blaze bunker (training/RTA_NOTES.md m3307-m3363): every cell round the feet and the head filled (the corners too: a mob in
  // a corner reaches through the gap), a roof, and one way out at head height only - the cell in front open at the head, shut under
  // it and over it: a slit nothing two high comes through. A blaze outside is in the sword's reach through it; its fireballs come in
  // through the slit alone, in front of the shield raised facing out. Hurt: the slit shut, eat, open. Rods fetched when it is quiet.
  // a fire block put out as a person does: a click on the face of the block it burns on (under it, else beside it)
  async function fireOut(c) {
    const faces = [[0, -1, 0, 1], [1, 0, 0, 4], [-1, 0, 0, 5], [0, 0, 1, 2], [0, 0, -1, 3]];
    for (const [dx, dy, dz, face] of faces) { const s1 = [c[0] + dx, c[1] + dy, c[2] + dz]; if (fAt(...s1) & F_SOLID) { try { await K.act('punch', [...s1.map(String), String(face)]); } catch {} if (!/fire$/.test(bname(...c))) return true; } }
    return !/fire$/.test(bname(...c));
  }
  async function blazeBunker(sp, want, maxSec) {
    // (the reflexes stand down in here: their evade dug the player out of the closed box into the fortress, twice, to its death)
    const rb0 = reflexBusy, hs0 = holdStill; reflexBusy = true; holdStill = true;
    try { return await blazeBunker0(sp, want, maxSec); } finally { reflexBusy = rb0; holdStill = hs0; }
  }
  async function blazeBunker0(sp, want, maxSec) {
    const t0 = Number(K.tick()), dbg = !!process.env.LAB_GOAL_DEBUG, w = WEAPONS.find((q) => cnt(q) > 0);
    const [x, y, z] = feet(), ax = sp.x + 0.5 - (x + 0.5), az = sp.z + 0.5 - (z + 0.5);
    const [dx, dz] = Math.abs(ax) >= Math.abs(az) ? [Math.sign(ax) || 1, 0] : [0, Math.sign(az) || 1];
    const slit = [x + dx, y + 1, z + dz], door = [x + dx, y, z + dz], home = [x, y, z];
    const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const cells = [...ring.map(([a, b]) => [x + a, y, z + b]), ...ring.map(([a, b]) => [x + a, y + 1, z + b]).filter((c) => !(c[0] === slit[0] && c[2] === slit[2])), [x - dx, y + 2, z - dz], [x, y + 2, z], [x + dx, y + 2, z + dz]];   // (the roof needs a block beside it at its height first: one over the back wall)
    const rawDig = async (c) => { try { await K.act('dig', c.map(String)); } catch {} await until(() => !(fAt(...c) & F_SOLID), 4, 400); };   // (not breakAt: its reflexes' fight walked the player out of the bunker)
    const repair = async () => { for (const c of cells) if (!(fAt(...c) & F_SOLID)) await fillCell(c); };
    // (the shield toward the blaze that can shoot in - the nearest one out in front of the slit - not straight out: of 85 health lost in a
    // run of 500 s, 65 was burning - set alight by 8 fireballs that got through and by the fires they lit - and 17 the fireballs
    // themselves; a fireball stopped on the shield sets nothing alight)
    const faceOut = () => {
      const f = K.feet(), front = K.all().filter((q) => q.type === 'minecraft:blaze' && !q.dead && (q.x - (slit[0] + 0.5)) * dx + (q.z - (slit[2] + 0.5)) * dz > 0 && hyp(q.x - f.x, q.z - f.z) < 20).sort((p2, q2) => hyp(p2.x - f.x, p2.y - f.y, p2.z - f.z) - hyp(q2.x - f.x, q2.y - f.y, q2.z - f.z))[0];
      if (front) K.lookAt(front.x, front.y + 0.9, front.z); else K.lookAt(slit[0] + 0.5 + dx * 2, slit[1] + 0.6, slit[2] + 0.5 + dz * 2);
    };
    const shield = () => { K.controls.sneak = offName() === 'shield'; };
    // up, a block at a time, the shield out between blocks
    for (let pass = 0; pass < 3; pass++) for (const c of cells) { if (!(fAt(...c) & F_SOLID)) { await fillCell(c); faceOut(); shield(); await K.ticks(1); } }   // (again: a block set later is the neighbour an earlier one lacked)
    { const op = cells.filter((c) => !(fAt(...c) & F_SOLID)); if (op.length && dbg) log(`blaze: bunker cells still open: ${op.map((c) => `${c.join(',')}=${bname(...c).replace('minecraft:', '')}`).join(' ')}; blocks ${blockItem() ?? 'none'}`); }
    if (fAt(...slit) & F_SOLID) await rawDig(slit);
    if (w) { try { await grab(w, 'fight'); } catch {} }
    if (dbg) log(`blaze: the bunker is up at ${x} ${y} ${z} in ${((Number(K.tick()) - t0) / 20).toFixed(0)} s, the slit toward ${dx} ${dz} (${cells.filter((c) => !(fAt(...c) & F_SOLID)).length} cells open)`);
    let quietT = Number(K.tick()), blows = 0;
    const deaths0 = K.memo.get('goal:deaths') ?? 0;
    // every cell the player's box is in, feet and head (its box is 0.6 wide: 0.2 off the middle of its cell it reaches into the next
    // one - measured at -342.3 80.3, a fire in the cell beside kept lighting it, 18 health burned away in the closed box with the
    // fire in its own two cells looked for and none there)
    const touching = () => { const f = K.feet(), fy = Math.floor(f.y + 0.01), out = []; for (const x of new Set([Math.floor(f.x - 0.31), Math.floor(f.x + 0.31)])) for (const z of new Set([Math.floor(f.z - 0.31), Math.floor(f.z + 0.31)])) for (const y of [fy, fy + 1]) out.push([x, y, z]); return out; };
    const fireNear = () => touching().find((c) => /fire$/.test(bname(...c)));
    const centred = () => { const f = K.feet(); return Math.abs(f.x - (home[0] + 0.5)) <= 0.15 && Math.abs(f.z - (home[2] + 0.5)) <= 0.15; };
    const centre = async () => { for (let k = 0; k < 10 && !centred(); k++) { const f = K.feet(), hx = home[0] + 0.5 - f.x, hz = home[2] + 0.5 - f.z, hl = hyp(hx, hz) || 1; K.controls.sneak = true; keysFor(hx / hl, hz / hl, false); await K.ticks(1); stopKeys(); } };
    for (;;) {
      const now = Number(K.tick());
      if ((now - t0) / 20 > maxSec || K.dead() || (K.memo.get('goal:deaths') ?? 0) !== deaths0) break;
      const f = K.feet(), hp = K.attrs().health ?? 20;
      // fire in the player's own two cells: out at once (a fire in the next cell never burned one standing in the middle of its own)
      // (where it went when it left its cell: the last thing done, and where it is - a run at 534 s was found out on the fortress at
      // 75.0 two cells from home right after 'open again')
      { const [hx, hy, hz] = feet(); if (dbg && (hx !== home[0] || hz !== home[2] || hy !== home[1]) && now - (blazeBunker0.offSaid ?? -99) > 40) { blazeBunker0.offSaid = now; log(`blaze: off home ${home.join(' ')}: at ${f.x.toFixed(2)} ${f.y.toFixed(2)} ${f.z.toFixed(2)} after ${blazeBunker0.last ?? '?'}; cells round ${[[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => bname(home[0] + a, home[1], home[2] + b).replace('minecraft:', '')).join(',')} under ${bname(home[0], home[1] - 1, home[2]).replace('minecraft:', '')}`); } }
      { const fire = fireNear();
        if (fire) { if (dbg && now - (blazeBunker0.fireSaid ?? -99) > 20) { blazeBunker0.fireSaid = now; log(`blaze: fire at ${fire.join(' ')} by me - out`); } blazeBunker0.last = `fireOut ${fire.join(' ')}`; await fireOut(fire); continue; }
        if (!centred()) { stopKeys(); blazeBunker0.last = 'centre'; await centre(); faceOut(); shield(); continue; } }
      // hurt: the slit shut (a closed box), eat and heal, open again
      if (hp < 12 && FOOD.some((q) => cnt(q) > 0)) {
        if (dbg) log(`blaze: hurt (${Math.round(hp)}) - shut in to heal`);
        stopKeys(); blazeBunker0.last = 'shutting the slit'; await fillCell(slit);
        for (let k = 0; k < 12 && (K.attrs().health ?? 20) < 18 && !K.dead(); k++) {
          { const fire = fireNear(); if (fire) { await fireOut(fire); continue; } }
          if (!centred()) await centre();
          if ((K.attrs()['player.hunger'] ?? 20) < 20 && FOOD.some((q) => cnt(q) > 0)) { try { await grab(FOOD.find((q) => cnt(q) > 0), 'eat'); await K.act('use', ['36']); } catch {} }
          else { for (let t = 0; t < 40; t++) { const fire = fireNear(); if (fire) await fireOut(fire); shield(); await K.ticks(1); } }
          if (!(fAt(...slit) & F_SOLID)) await fillCell(slit);
        }
        if (dbg) log(`blaze: healed to ${Math.round(K.attrs().health ?? 0)}, open again (walls ${cells.filter((c) => fAt(...c) & F_SOLID).length}/${cells.length}, slit ${fAt(...slit) & F_SOLID ? 'shut' : 'open'})`);
        blazeBunker0.last = 'repair'; await repair(); blazeBunker0.last = 'opening the slit'; await rawDig(slit); blazeBunker0.last = 'open again'; if (w) { try { await grab(w, 'fight'); } catch {} } continue;
      }
      const bl = K.all().filter((q) => q.type === 'minecraft:blaze' && !q.dead && hyp(q.x - f.x, q.y - f.y, q.z - f.z) < 16);
      if (bl.length) quietT = now;
      const inFront = (q) => ((q.x - (x + 0.5)) * dx + (q.z - (z + 0.5)) * dz) > 0.6;
      const e = bl.filter(inFront).find((q) => boxGap(q, q.x, q.z, f.x, f.y, f.z) <= (K.reach?.('entity') ?? 3) && now - (q._hitAt ?? -99) >= 10);
      if (e) {   // the shield down for the blow's tick alone
        K.lookAt(e.x, e.y + 0.9, e.z); K.controls.sneak = false; blazeBunker0.last = 'a blow'; await K.hit(e, 'attack', true); e._hitAt = now; blows++;
        if (dbg && blows % 5 === 0) log(`blaze: ${blows} blows through the slit, health ${Math.round(hp)}`);
        faceOut(); shield(); await K.ticks(1); continue;
      }
      // rods: enough (counted with those lying near), or quiet with rods lying about - out through the door for them and back
      const lying = K.nearest('item').filter((q) => /blaze_rod/.test(q.item ?? '') && hyp(q.x - f.x, q.z - f.z) < 12 && Math.abs(q.y - f.y) < 5);
      { const all = K.nearest('item').filter((q) => /blaze_rod/.test(q.item ?? '')); if (dbg && all.length !== (blazeBunker0.rodsSeen ?? 0)) { blazeBunker0.rodsSeen = all.length; log(`blaze: rods on the ground ${all.length}: ${all.slice(0, 6).map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)} ${q.z.toFixed(1)}`).join(' | ')} (${lying.length} counted near)`); } }
      // (or a few lying just outside the door with no blaze near: out for them now - by a spawner it is never quiet for 5 s: two runs
      // of 530 s killed 11 and 15 blazes, left 4 rods lying 2-3 out of the door the whole time, and went out for them only when the
      // time was up - among the blazes, to its death)
      const close = lying.filter((q) => hyp(q.x - (door[0] + 0.5), q.z - (door[2] + 0.5)) < 5 && Math.abs(q.y - f.y) < 3);
      // (not waiting for the blazes to go: measured, with health 14 and none within 7 it never went in 500 s - it is hurt and healing most
      // of the time, and the rods do not wait: fire from the fireballs burned them where they lay, 3 lying went to 1. Out as soon as one
      // is down by the door and the nearest blaze is 4.5 off)
      // (measured on seed 1's fortress, 500 s a run: with the nearest blaze 4.5 off and health 10, 8, 1 and 2 rods and no death in three
      // runs; with 3 off and health 8 it went out twice, met a blaze's fists out there and died at 261 s with none)
      const clear = !bl.some((q) => hyp(q.x - f.x, q.y - f.y, q.z - f.z) < 4.5);
      const quick = close.length && clear && hp >= 10 && now - (blazeBunker0.outAt ?? -999) > 60;
      if ((lying.length && now - quietT > 100) || (cnt('blaze_rod') + lying.length >= want && now - quietT > 20) || quick) {
        blazeBunker0.outAt = now; blazeBunker0.last = quick ? 'out for the rods by the door' : 'out for the rods';
        if (dbg) log(`blaze: ${lying.length} rods lying out${quick ? ` (${close.length} by the door, no blaze within 4.5)` : ''} - out through the door`);
        stopKeys(); await rawDig(door);
        try { await collect(f, quick ? 6 : 12, /blaze_rod/); } catch {}
        await travel((a, b, c) => a === home[0] && b === home[1] && c === home[2], (a, b, c) => hyp(a - home[0], b - home[1], c - home[2]), { radius: 24, legs: 3 });
        await fillCell(door); await repair(); if (w) { try { await grab(w, 'fight'); } catch {} }
        if (cnt('blaze_rod') >= want) break;
        quietT = Number(K.tick()); continue;
      }
      faceOut(); shield();
      await K.ticks(1);
    }
    stopKeys();
    return cnt('blaze_rod') >= want;
  }
  async function blazeRods(want = 6, maxSec = 400) {
    const t0 = Number(K.tick()), dbg = !!process.env.LAB_GOAL_DEBUG;
    const w = WEAPONS.find((x) => cnt(x) > 0); if (w) await grab(w, 'fight');
    if (offName() !== 'shield' && cnt('shield') > 0) { try { await duelOffhand(); } catch {} }
    let sp = null, ateAt = -99, quietT = Number(K.tick());
    const deaths0 = K.memo.get('goal:deaths') ?? 0;
    for (;;) {
      const now = Number(K.tick()); if ((now - t0) / 20 > maxSec || K.dead() || cnt('blaze_rod') >= want || (K.memo.get('goal:deaths') ?? 0) !== deaths0) break;
      const f = K.feet(), hp = K.attrs().health ?? 20;
      if (!sp) { const s1 = K.findBlocks((b) => /mob_spawner/.test(b.name), { max: 4, radius: 64, from: f }) ?? []; if (s1[0]) { sp = { x: s1[0].x ?? s1[0][0], y: s1[0].y ?? s1[0][1], z: s1[0].z ?? s1[0][2] }; if (dbg) log(`blaze: a spawner at ${sp.x} ${sp.y} ${sp.z}`); } }
      // fire in the player's own cells (a fireball lit the floor: the last run burned to death standing in it, 12 health in 12 s):
      // punched out at once, the cells round it too while nothing is in reach
      { const [fx, fy, fz] = feet(); let fire = null;
        for (const [dx, dy, dz] of [[0, 0, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) if (!fire && /fire$/.test(bname(fx + dx, fy + dy, fz + dz))) fire = [fx + dx, fy + dy, fz + dz];
        if (fire) { stopKeys(); if (dbg && now - (blazeRods.fireSaid ?? -99) > 20) { blazeRods.fireSaid = now; log(`blaze: fire at ${fire.join(' ')} - out`); } await fireOut(fire); await K.ticks(1); continue; } }
      if (hp < 10 && now - ateAt > 45 && FOOD.some((x) => cnt(x) > 0) && !K.all().some((q) => q.type === 'minecraft:blaze' && hyp(q.x - f.x, q.y - f.y, q.z - f.z) < 5)) { ateAt = now; stopKeys(); try { await grab(FOOD.find((x) => cnt(x) > 0), 'eat'); await K.act('use', ['36']); } catch {} if (w) { try { await grab(w, 'fight'); } catch {} } continue; }
      // a small fireball on its way in: the eyes on it and the shield up (sneaking) until it has burst or gone by - inside the tick
      // (the blows and the walking let three in a row through: 2.5 each and the burning)
      if (offName() === 'shield') { const fb = K.all().filter((q) => /small_fireball|fireball/.test(q.type) && hyp(q.x - f.x, q.y - f.y - 1, q.z - f.z) < 12).find((q) => { track(q, now); const tx = f.x - q.x, ty = f.y + 1 - q.y, tz = f.z - q.z, l = hyp(tx, ty, tz) || 1, v = hyp(q._vx ?? 0, q._vy ?? 0, q._vz ?? 0); return v < 0.05 || ((q._vx ?? 0) * tx + (q._vy ?? 0) * ty + (q._vz ?? 0) * tz) / (l * v) > 0.8; });
        if (fb) { stopKeys(); K.lookAt(fb.x, fb.y, fb.z); K.controls.sneak = true; await K.ticks(1); continue; } }
      { const o2 = K.all().find((q) => q.type !== 'minecraft:blaze' && (HOSTILE.test(q.type) || /hoglin|piglin_brute/.test(q.type)) && !q.dead && hyp(q.x - f.x, q.y - f.y, q.z - f.z) < 4);
        if (o2) { if (dbg) log(`blaze: a ${sh(o2.type)} at me - fought`); stopKeys(); K.controls.sneak = false; try { await fightOne(o2, 20); } catch {} if (w) { try { await grab(w, 'fight'); } catch {} } continue; } }
      if (sp && hyp(sp.x + 0.5 - f.x, sp.z + 0.5 - f.z) <= 8 && Math.abs(sp.y - f.y) <= 3 && !process.env.LAB_NO_BUNKER) { stopKeys(); await blazeBunker(sp, want, maxSec - (now - t0) / 20); break; }
      const bl = K.all().filter((q) => q.type === 'minecraft:blaze' && !q.dead && hyp(q.x - f.x, q.y - f.y, q.z - f.z) < 24).sort((p1, p2) => hyp(p1.x - f.x, p1.y - f.y, p1.z - f.z) - hyp(p2.x - f.x, p2.y - f.y, p2.z - f.z));
      const e = bl[0];
      if (!e || hyp(e.x - f.x, e.z - f.z) > 16) {
        if (hp < 16 && now - ateAt > 45 && FOOD.some((x) => cnt(x) > 0)) { ateAt = now; stopKeys(); try { await grab(FOOD.find((x) => cnt(x) > 0), 'eat'); await K.act('use', ['36']); } catch {} if (w) { try { await grab(w, 'fight'); } catch {} } continue; }
        if (now - quietT > 60) { quietT = now; try { await collect(f, 12, /blaze_rod/); } catch {} }
      } else quietT = now;
      if (!e) { if (sp && hyp(sp.x + 0.5 - f.x, sp.z + 0.5 - f.z) > 6) { stopKeys(); await travel((x, y, z) => hyp(x - sp.x, y - sp.y, z - sp.z) <= 5, (x, y, z) => hyp(x - sp.x, y - sp.y, z - sp.z), { radius: 64, dig: true, legs: 1 }); await K.ticks(2); } else { K.controls.sneak = offName() === 'shield'; await K.ticks(5); } continue; }
      track(e, now);
      K.lookAt(e.x, e.y + 0.9, e.z);
      const reach = K.reach?.('entity') ?? 3, g = boxGap(e, e.x, e.z, f.x, f.y, f.z);
      if (g <= reach && now - (e._hitAt ?? -99) >= 10) { K.controls.sneak = false; await K.hit(e, 'attack', true); e._hitAt = now; if (e._hits = (e._hits ?? 0) + 1, dbg) log(`blaze: a blow at ${g.toFixed(2)} (${e._hits} on it, health ${Math.round(hp)})`); await K.ticks(1); continue; }
      // (to it while it is low enough to reach; one hanging high is waited for under the shield)
      const dh = hyp(e.x - f.x, e.z - f.z);
      if (e.y - f.y < 3.5 && dh > 2.2) { const way = stepWay((e.x - f.x) / dh, (e.z - f.z) / dh, []); if (way) keysFor(way[0], way[1], false); else stopKeys(); } else stopKeys();
      K.controls.sneak = offName() === 'shield';
      await K.ticks(1);
    }
    stopKeys();
    // (the last pick-up only where no blaze is near: two runs walked out among them when the time was up, and died there)
    if (!K.dead() && !K.all().some((q) => q.type === 'minecraft:blaze' && !q.dead && hyp(q.x - K.feet().x, q.y - K.feet().y, q.z - K.feet().z) < 8)) { try { await collect(K.feet(), 6, /blaze_rod/); } catch {} }
    if (dbg) log(`blaze: ${cnt('blaze_rod')} rods after ${((Number(K.tick()) - t0) / 20).toFixed(0)} s, health ${Math.round(K.attrs().health ?? 0)}`);
    return cnt('blaze_rod') >= want;
  }
  // ---------------- the stronghold: eyes of ender (rebuilt from training/RTA_NOTES.md m3107-m3160) ----------------
  // An eye thrown flies some 12 blocks toward the stronghold - rising while it is far, sinking within ~12 of it - and falls as an item
  // (4 in 5) or breaks. Its flight is the bearing. Followed 150 at a time on land, a throw each time; once one sinks (or the frames
  // are among the blocks the server has sent within 48), down to the portal room: its frames filled, and in.
  async function throwEye() {
    try { await grab('ender_eye', 'use'); } catch { return null; }
    const f0 = K.feet(); K.look(K.yaw(), -20); await K.act('use', []);
    let e = null, first = null, last = null;
    for (let t = 0; t < 80; t++) {
      e = e && K.all().includes(e) ? e : K.all().find((q) => /eye_of_ender|ender_eye/.test(q.type) && q.type !== 'minecraft:item' && hyp(q.x - f0.x, q.z - f0.z) < 6);
      if (e) { first ??= { x: e.x, y: e.y, z: e.z }; last = { x: e.x, y: e.y, z: e.z }; }
      else if (first) break;
      await K.ticks(1);
    }
    if (!first || !last || hyp(last.x - first.x, last.z - first.z) < 0.5) return null;
    try { await collect(last, 6, /ender_eye/); } catch {}
    return { ang: Math.atan2(last.z - first.z, last.x - first.x), sank: last.y < first.y - 0.3, at: last };
  }
  async function findStronghold(maxSec = 900) {
    const t0 = Number(K.tick()), dbg = !!process.env.LAB_GOAL_DEBUG;
    for (let k = 0; (Number(K.tick()) - t0) / 20 < maxSec && !K.dead() && cnt('ender_eye') > 0; k++) {
      const fr = K.findBlocks((b) => /end_portal_frame/.test(b.name), { max: 1, radius: 48, from: K.feet() });
      if (fr.length) { if (dbg) log(`stronghold: its frames at ${fr[0].slice(0, 3).join(' ')}`); return { x: fr[0][0], y: fr[0][1], z: fr[0][2] }; }
      const r = await throwEye();
      if (!r) { if (dbg) log('stronghold: the eye went nowhere (broke?)'); continue; }
      const f = K.feet();
      if (dbg) log(`stronghold: throw ${k + 1} at ${f.x.toFixed(0)} ${f.z.toFixed(0)}: bearing ${Math.round((r.ang * 180) / Math.PI)}${r.sank ? ', it sank - close' : ''}`);
      const step = r.sank ? 12 : 150, tx = f.x + Math.cos(r.ang) * step, tz = f.z + Math.sin(r.ang) * step;
      if (r.sank) {   // under the spot it sank at: the frames within 48 below, found from the blocks sent - dug down toward them
        const fr2 = K.findBlocks((b) => /end_portal_frame/.test(b.name), { max: 1, radius: 64, from: { x: r.at.x, y: f.y - 30, z: r.at.z } });
        if (fr2.length) return { x: fr2[0][0], y: fr2[0][1], z: fr2[0][2] };
      }
      await travel((x, y, z) => hyp(x - tx, z - tz) <= 6, (x, y, z) => hyp(x - tx, z - tz), { radius: 180, dig: true, pillar: true, legs: 30, sprint: true });
    }
    return null;
  }
  // to the portal room's frames, each filled with an eye, then into the portal
  async function intoEndPortal(fr, maxSec = 600) {
    const t0 = Number(K.tick()), dbg = !!process.env.LAB_GOAL_DEBUG;
    await travel((x, y, z) => hyp(x - fr.x, y - fr.y, z - fr.z) <= 3.5, (x, y, z) => hyp(x - fr.x, y - fr.y, z - fr.z), { radius: 200, dig: true, pillar: true, legs: 40 });
    const frames = () => K.findBlocks((b) => /end_portal_frame/.test(b.name), { max: 12, radius: 12, from: K.feet() });
    for (const [x, y, z] of frames()) {
      const b = B(x, y, z); if (b?.states?.end_portal_eye_bit === 1 || b?.states?.end_portal_eye_bit === true) continue;
      if (cnt('ender_eye') < 1) break;
      await goToBlock(x, y, z, 4);
      try { await grab('ender_eye', 'use'); await K.act('useon', [String(x), String(y), String(z), '1']); } catch {}
      await K.ticks(3);
    }
    await K.ticks(10);
    const pc = K.findBlocks((b) => b.name === 'minecraft:end_portal', { max: 1, radius: 12, from: K.feet() });
    if (!pc.length) { if (dbg) log(`stronghold: the portal did not open (${frames().filter(([x, y, z]) => !B(x, y, z)?.states?.end_portal_eye_bit).length} frames empty)`); return false; }
    const [px, py, pz] = pc[0];
    await travel((x, y, z) => x === px && z === pz && Math.abs(y - py) <= 1, (x, y, z) => hyp(x - px, y - py, z - pz), { radius: 24, dig: true, legs: 6 });
    for (let t = 0; t < 100 && dimName() !== 'the_end'; t++) await K.ticks(1);
    if (dbg) log(`stronghold: ${dimName() === 'the_end' ? 'in the End' : 'not through'} after ${((Number(K.tick()) - t0) / 20).toFixed(0)} s`);
    return dimName() === 'the_end';
  }
  // ---------------- a duel with a player (PvP) ----------------
  // Both have the same reach, so the fight is timing: its 10 ticks of not being hurt again are read from its hurt flash, and the blow
  // is sent a round trip early so it lands on the tick they end; sprint in for that tick and W-tap (the blow throws it 2.2, not 1.6 -
  // out of its own reach), S-tap after. While the blow is not due, out of its reach (it can hit whenever this player can be hurt);
  // a jump crit when walking in from just outside; the edge behind filled before a combo throws the player off it
  // the totem refilled inside the tick (a blast pops it while the player is walking a path or eating - the loop is not there to see it)
  function totemGuard() {
    if (!K.everyTick) return () => {};
    let pendingT = -99;
    return K.everyTick((t) => {
      const now = Number(t);
      if (offName() || now - pendingT < 4) return;
      const i = K.inv.slots.findIndex((it) => it?.network_id && sh(nm(it)) === 'totem_of_undying');
      if (i < 0) return;
      pendingT = now; K.act('move', [String(i), 'offhand']).catch(() => {});
    });
  }
  async function pvpFight(e, max = 120) {
    const off = clutchGuard(), off2 = totemGuard();
    try { return await pvpFight0(e, max); } finally { off(); off2(); }
  }
  // the off hand for a duel: a shield (it stops a mace falling on the player, arrows, a sword from the front) - or a totem where the
  // fight is explosions (crystals, anchors, TNT carts: a shield does not save from those, a totem does)
  const offName = () => sh(nm(K.offhand?.() ?? {}) || '');
  async function duelOffhand() {
    const boom = cnt('end_crystal') > 0 || cnt('tnt_minecart') > 0 || cnt('respawn_anchor') > 0;
    // (a totem already there stays: the mace's fall and the harming potions go through a shield, not through a totem)
    if (offName() === 'totem_of_undying' || offName() === 'shield') return false;
    const want = boom && cnt('totem_of_undying') > 0 ? 'totem_of_undying' : cnt('totem_of_undying') > 0 && cnt('mace') + cnt('wind_charge') > 0 ? 'totem_of_undying' : cnt('shield') > 0 ? 'shield' : cnt('totem_of_undying') > 0 ? 'totem_of_undying' : null;
    if (!want) return false;
    const i = K.inv.slots.findIndex((it) => it?.network_id && sh(nm(it)) === want);
    if (i < 0) return false;
    try { await K.act('move', [String(i), 'offhand']); } catch { return false; }
    if (process.env.LAB_GOAL_DEBUG) log(`duel: ${want} in the off hand`);
    return true;
  }
  // splash potions on the player itself (look straight down, throw): strength II (+6 a blow - through diamond armour the difference
  // between 1.7 and 3.3 a hit), swiftness II (the spacing is won on feet); again when they run out. Potion ids (the item's aux value)
  const POTS = { strength: [33, 32, 31], speed: [16, 15, 14], fire_resistance: [13, 12], healing: [22, 21], regeneration: [30, 29, 28] };
  const hasEffect = (k, secs = 3) => (K.effects?.() ?? []).some((x) => x.name === k && x.secs > secs);
  async function throwSelf(kind) {
    const ids = POTS[kind], slots = K.inv.slots;
    let i = -1; for (const id of ids) { i = slots.findIndex((it) => it?.network_id && sh(nm(it)) === 'splash_potion' && it.metadata === id); if (i >= 0) break; }
    if (i < 0) return false;
    let hb = i;
    if (i > 8) { hb = slots.slice(0, 9).findIndex((it) => !it?.network_id); if (hb < 0) hb = 8; try { await K.act('move', [String(i), String(hb)]); } catch { return false; } }
    await K.act('slot', [String(hb)]);
    const yaw = K.yaw(); K.look(yaw, 89);
    await K.act('use', []);
    if (process.env.LAB_GOAL_DEBUG) log(`duel: a splash of ${kind} on myself`);
    return true;
  }
  async function duelBuffs(weapon) {
    let n = 0;
    for (const k of ['strength', 'speed', 'fire_resistance']) if (!hasEffect(k) && (k !== 'fire_resistance' || cnt('tnt_minecart') + cnt('flint_and_steel') > 0) && (await throwSelf(k))) n++;
    if (n && weapon) { try { await grab(weapon, 'fight'); } catch {} }
    return n;
  }
  // a golden apple while there is time (32 ticks of eating): hurt, and the other out of reach or far
  async function duelEat(e, weapon) {
    if (cnt('golden_apple') + cnt('enchanted_golden_apple') === 0) return false;
    const it = cnt('enchanted_golden_apple') > 0 ? 'enchanted_golden_apple' : 'golden_apple';
    if (process.env.LAB_GOAL_DEBUG) log(`duel: eating a ${it} at health ${Math.round(K.attrs().health ?? 0)}`);
    try { await grab(it, 'eat'); } catch { return false; }
    // (backing off while eating, away from it; the keys stay down through the eating)
    const f = K.feet(), dx = f.x - e.x, dz = f.z - e.z, n = hyp(dx, dz) || 1, way = stepWay(dx / n, dz / n, []);
    stopKeys(); if (way) { K.lookAt(e.x, e.y + 1.2, e.z); keysFor(way[0], way[1]); }
    try { await K.act('use', ['34']); } catch {}
    stopKeys();
    if (weapon) { try { await grab(weapon, 'fight'); } catch {} }
    return true;
  }
  // two blocks (feet and head) in the cell next to the player on the crystal's side, clicked this tick without waiting on the server:
  // the hotbar's key, the click on the floor's top, the click on the new block's top, the weapon's key
  // ---- an end crystal's blast, reckoned as the game does: the share of points on a body's box that a straight line from the blast's
  // centre reaches without going through a block, times how near (power 6: nothing past 12). Used to set this player's own crystals
  // where the blast takes the other and not the player: the impossible crystal bot's own crystals did 188 of the 313 it lost in a
  // duel and this player 188.7 (walls of one or two blocks let 0.8-9.6 through); this player set none.
  let blastSolid = null, blastAir = null;   // (cells taken as solid while a wall is weighed before it is set; the anchor's own cell as air - it is gone when it goes off)
  const rayOpen = (ax, ay, az, bx, by, bz) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az, n = Math.max(2, Math.ceil(Math.hypot(dx, dy, dz) / 0.15));
    for (let i = 1; i < n; i++) { const t = i / n, x = Math.floor(ax + dx * t), y = Math.floor(ay + dy * t), z = Math.floor(az + dz * t); const key = `${x},${y},${z}`; if (blastAir?.has(key)) continue; if (fAt(x, y, z) & F_SOLID || blastSolid?.has(key)) return false; }
    return true;
  };
  const seenShare = (cx, cy, cz, px, py, pz, w = 0.6, h = 1.8) => {
    const sx = 1 / (w * 2 + 1), sy = 1 / (h * 2 + 1), off = (1 - Math.floor(1 / sx) * sx) / 2;
    let seen = 0, all = 0;
    for (let a = 0; a <= 1; a += sx) for (let b = 0; b <= 1; b += sy) for (let c = 0; c <= 1; c += sx) { all++; if (rayOpen(px - w / 2 + w * a + off, py + h * b, pz - w / 2 + w * c + off, cx, cy, cz)) seen++; }
    return all ? seen / all : 0;
  };
  // the blast's hurt before armour (what a body standing at px py pz takes from a crystal whose centre is cx cy cz)
  const blastRaw = (cx, cy, cz, px, py, pz) => { const d = Math.hypot(px - cx, py - cy, pz - cz) / 12; if (d >= 1) return 0; const im = (1 - d) * seenShare(cx, cy, cz, px, py, pz); return im > 0 ? ((im * im + im) / 2) * 7 * 12 + 1 : 0; };
  // a crystal of this player's own by the other: obsidian on the floor beside it (or on the block it stands on the edge of), the crystal on
  // top, struck - only where the blast reaches it and not this player (the player's hurt from it under 4 before armour, a fifth of it)
  async function crystalHit(e, weapon) {
    if (cnt('end_crystal') === 0 || process.env.LAB_NO_CRYSTAL) return false;
    const f = K.feet(), ex = Math.floor(e.x), ey = Math.floor(e.y + 0.01), ez = Math.floor(e.z), reachB = 4.5;
    const eye = { x: f.x, y: f.y + 1.62, z: f.z };
    let best = null;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const dy of [-1, 0]) {
      const x = ex + dx, y = ey + dy, z = ez + dz;   // (x y z: the obsidian's cell; the crystal stands on it, its centre at y + 1)
      const base = bname(x, y, z), have = /obsidian|bedrock/.test(base);
      if (!have && (dy !== 0 || cnt('obsidian') === 0 || !(fAt(x, y, z) & F_PASS) || !(fAt(x, y - 1, z) & F_SOLID))) continue;
      if (!(fAt(x, y + 1, z) & F_PASS) || !(fAt(x, y + 2, z) & F_PASS)) continue;
      // (not in a cell a body stands in: the block, or the crystal, would not go in)
      const inBody = (q, yy) => Math.abs(q.x - (x + 0.5)) < 0.8 && Math.abs(q.z - (z + 0.5)) < 0.8 && q.y < yy + 1 && q.y + 1.8 > yy;
      if ((!have && (inBody(f, y) || inBody(e, y))) || inBody(f, y + 1) || inBody(e, y + 1)) continue;
      if (Math.hypot(x + 0.5 - eye.x, y + 1 - eye.y, z + 0.5 - eye.z) > reachB) continue;
      const cx = x + 0.5, cy = y + 1, cz = z + 0.5, mine = blastRaw(cx, cy, cz, f.x, f.y, f.z), its = blastRaw(cx, cy, cz, e.x, e.y, e.z);
      // (in the surround the ring takes the blast off the legs: a crystal that costs this player up to a third of what it does to the
      // other is set - measured, with the strict 4 none was set in 300 s from inside the ring and the duel was a draw)
      const inRing = !!process.env.LAB_SURROUND && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => fAt(Math.floor(f.x) + a, Math.floor(f.y + 0.01), Math.floor(f.z) + b) & F_SOLID);
      if (inRing ? (mine > 10 || its < 25 || its < mine * 3) : (mine > 4 || its < 30)) continue;
      const score = its - mine * 3 - (have ? 0 : 5);
      if (!best || score > best.score) best = { x, y, z, have, mine, its, score };
    }
    if (!best) return false;
    const { x, y, z } = best;
    if (!best.have) { try { await grab('obsidian', 'fight'); } catch { return false; } K.act('useon', [S(x), S(y - 1), S(z), 'up', 'fast']).catch(() => {}); await K.ticks(1); }
    try { await grab('end_crystal', 'fight'); } catch { return false; }
    K.act('useon', [S(x), S(y), S(z), 'up', 'fast']).catch(() => {});
    let cr = null;
    for (let k = 0; k < 6 && !cr; k++) { await K.ticks(1); cr = K.all().find((q) => /ender_crystal|end_crystal/.test(q.type) && Math.abs(q.x - (x + 0.5)) < 0.6 && Math.abs(q.z - (z + 0.5)) < 0.6); }
    if (cr) { cr._walled = true; cr._mine = true; K.lookAt(cr.x, cr.y + 0.5, cr.z); await K.hit(cr, 'attack', true); }
    if (process.env.LAB_GOAL_DEBUG) log(`duel: my crystal at ${x} ${y + 1} ${z}${best.have ? '' : ' (obsidian set)'}: its blast ${best.its.toFixed(0)}, mine ${best.mine.toFixed(1)} before armour${cr ? '' : ' - not seen, not struck'}`);
    if (weapon) { try { await grab(weapon, 'fight'); } catch {} }
    return !!cr;
  }
  // the wall weighed: of the cells round the player (feet and head height, the 8 beside it) the ones that take the most of the blast
  // that reaches it, reckoned ray by ray, up to three; null when there is nothing to set (the old one-cell wall then)
  async function crystalWall2(cr, weapon) {
    // (a respawn anchor: its blast from the middle of its block, and its block no cover - measured, walls weighed with the anchor's own
    // block in the way came out at 0 and the blast still did 7.2 through them)
    const f = K.feet(), [fx, fy, fz] = feet(), cx = cr.x, cy = cr.k ? cr.y + 0.5 : cr.y, cz = cr.z;
    blastAir = cr.k ? new Set([cr.k]) : null;
    try { return await crystalWall3(cr, weapon, f, fx, fy, fz, cx, cy, cz); } finally { blastAir = null; }
  }
  async function crystalWall3(cr, weapon, f, fx, fy, fz, cx, cy, cz, stepped = false) {
    const now0 = blastRaw(cx, cy, cz, f.x, f.y, f.z);
    if (now0 < 2) return false;
    // (right beside the player - an anchor set against it, a crystal in the next cell - there is no cell between to wall: first a
    // step or two away from it, then the wall weighed from there. Measured, the hits that got through the weighed walls were 3-8 each,
    // 63 of them in a duel, most from anchors set next to the player)
    const near = Math.max(Math.abs(Math.floor(cx) - fx), Math.abs(Math.floor(cz) - fz)) <= 1 && Math.abs(Math.floor(cy) - fy) <= 1;
    // (opt-in, LAB_STEP_AWAY=1: three duels with it took 149-196, no better than without)
    if (near && !stepped && process.env.LAB_STEP_AWAY) {
      const ux = f.x - cx, uz = f.z - cz, ul = hyp(ux, uz) || 1;
      const way = stepWay(ux / ul, uz / ul, []) ?? stepWay(ux / ul * 0.7 - uz / ul * 0.7, uz / ul * 0.7 + ux / ul * 0.7, []) ?? stepWay(ux / ul * 0.7 + uz / ul * 0.7, uz / ul * 0.7 - ux / ul * 0.7, []);
      if (way) {
        stopKeys(); K.controls.sneak = false;
        K.look((Math.atan2(-way[0], way[1]) * 180) / Math.PI, 0); K.controls.forward = K.controls.sprint = true;
        for (let k = 0; k < 5; k++) { await K.ticks(1); if (hyp(K.feet().x - cx, K.feet().z - cz) > 2.6) break; }
        stopKeys();
        const g = K.feet(), [gx, gy, gz] = feet();
        if (process.env.LAB_GOAL_DEBUG) log(`duel: ${cr.k ? 'an anchor' : 'a crystal'} beside me - a step away (${hyp(g.x - cx, g.z - cz).toFixed(1)} off now)`);
        return crystalWall3(cr, weapon, g, gx, gy, gz, cx, cy, cz, true);
      }
    }
    const ORDER = ['obsidian', 'cobblestone', 'oak_planks', 'dirt', 'oak_log', 'stone', 'glowstone'];
    const item = ORDER.find((x) => cnt(x) > 0);
    if (!item) return null;
    const cand = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [0, 1]) {
      if (!dx && !dz) continue;
      const x = fx + dx, y = fy + dy, z = fz + dz;
      if (!(fAt(x, y, z) & F_PASS)) continue;
      if (Math.floor(cr.x) === x && Math.floor(cr.z) === z && Math.abs(Math.floor(cr.y) - y) <= 1) continue;
      if (!((fAt(x, y - 1, z) & F_SOLID) || dy === 1 && (fAt(x, y - 1, z) & F_SOLID))) { if (dy === 0) continue; }
      cand.push([x, y, z]);
    }
    const chosen = [];
    blastSolid = new Set();
    try {
      for (let k = 0; k < 3; k++) {
        let best = null;
        for (const c of cand) { if (chosen.includes(c)) continue; const key = c.join(','); blastSolid.add(key); const v = blastRaw(cx, cy, cz, f.x, f.y, f.z); blastSolid.delete(key); if (!best || v < best.v) best = { c, v }; }
        if (!best) break;
        const before = chosen.length ? blastRaw(cx, cy, cz, f.x, f.y, f.z) : now0;
        if (before - best.v < 1) break;
        chosen.push(best.c); blastSolid.add(best.c.join(','));
        if (best.v < 1.5) break;
      }
    } finally { blastSolid = null; }
    if (!chosen.length) return null;
    try { await grab(item, 'wall'); } catch { return null; }
    // (the head-height ones need the feet-height one under them first, or a side to go on: set lowest first)
    chosen.sort((a, b) => a[1] - b[1]);
    for (const [x, y, z] of chosen) { K.act('useon', [S(x), S(y - 1), S(z), 'up', 'fast']).catch(() => {}); await K.ticks(1); }
    if (process.env.LAB_GOAL_DEBUG) log(`duel: ${cr.k ? 'an anchor' : 'a crystal'} ${hyp(cr.x - f.x, cr.z - f.z).toFixed(1)} off: ${chosen.length} blocks weighed in (its blast on me ${now0.toFixed(0)} -> ${(() => { blastSolid = new Set(chosen.map((c) => c.join(','))); const v = blastRaw(cx, cy, cz, f.x, f.y, f.z); blastSolid = null; return v.toFixed(0); })()} before armour)`);
    if (weapon) { try { await grab(weapon, 'fight'); } catch {} }
    return true;
  }
  async function crystalWall(cr, weapon) {
    if (!process.env.LAB_OLD_WALL) { const r = await crystalWall2(cr, weapon); if (r !== null) return r; }
    const [fx, fy, fz] = feet(), dx = cr.x - (fx + 0.5), dz = cr.z - (fz + 0.5);
    const [sx, sz] = Math.abs(dx) >= Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1];
    const cx = fx + sx, cz = fz + sz;
    if (Math.floor(cr.x) === cx && Math.floor(cr.z) === cz) return false;   // (it stands in that very cell)
    // (glowstone first: it takes the blast and the blast takes it - the way is open again for the other's next crystal, which hurts it
    // more than the player; an obsidian wall stayed, and the other stopped crystalling and ate its apples: a 300 s draw)
    const ORDER = ['glowstone', 'cobblestone', 'oak_planks', 'dirt', 'oak_log', 'stone', 'obsidian'];
    const hbs = K.inv.slots.slice(0, 9).map((it, i) => [i, it?.network_id ? sh(nm(it)) : '']).filter(([, n]) => ORDER.includes(n)).sort((a, b) => ORDER.indexOf(a[1]) - ORDER.indexOf(b[1]));
    const best = ORDER.find((x) => cnt(x) > 0);
    if (!best) return false;
    if (hbs.length && hbs[0][1] === best) await K.act('slot', [String(hbs[0][0])]);
    else { try { await grab(best, 'wall'); } catch { return false; } }
    let n = 0;
    if (fAt(cx, fy, cz) & F_PASS && fAt(cx, fy - 1, cz) & F_SOLID) { K.act('useon', [S(cx), S(fy - 1), S(cz), 'up', 'fast']).catch(() => {}); n++; }
    await K.ticks(1);
    if (fAt(cx, fy + 1, cz) & F_PASS) { K.act('useon', [S(cx), S(fy), S(cz), 'up', 'fast']).catch(() => {}); n++; }
    await K.ticks(1);
    if (process.env.LAB_GOAL_DEBUG) log(`duel: a crystal ${hyp(cr.x - K.feet().x, cr.z - K.feet().z).toFixed(1)} off: ${n} blocks between`);
    if (weapon) { try { await grab(weapon, 'fight'); } catch {} }
    return n > 0;
  }
  // up on a wind charge thrown at the feet, the mace in hand on the way, steered over e, the blow on the way down within reach
  // a wind charge at the ground just before landing from a height: its burst takes the fall away (the fall counted from where it throws
  // the player, a little way up) - measured against the AshBlast bot, 47 of the 125 health lost in a won duel was this player's own
  // falls: 17 after its mace blows' wind burst threw it up again with nothing under it to hit, 14.6 from its pearls
  const groundUnder = (f) => { const x = Math.floor(f.x), z = Math.floor(f.z); for (let y = Math.floor(f.y); y > Math.floor(f.y) - 24; y--) if (fAt(x, y - 1, z) & F_SOLID) return y; return null; };
  async function cushion(tag) {
    // (opt-in, LAB_CUSHION=1: measured against the AshBlast bot, 46 of these in a duel kept this player in the air - each burst threw it
    // up again - and the bot's mace came down on it 54 times: lost with 12 totems gone, where the duel without them was won with 1)
    if (cnt('wind_charge') === 0 || !process.env.LAB_CUSHION) return false;
    const held = sh(nm(K.inv.slots[K.inv.selected] ?? {}) || '');
    try { await grab('wind_charge', 'fight'); } catch { return false; }
    K.look(K.yaw?.() ?? 0, 90);
    await K.act('use', []);
    if (process.env.LAB_GOAL_DEBUG) log(`duel: a wind charge under the fall (${tag})`);
    if (held && held !== 'wind_charge') { try { await grab(held, 'fight'); } catch {} }
    return true;
  }
  async function maceSmash(e) {
    try { await grab('wind_charge', 'fight'); } catch { return 'no wind charge in hand'; }
    const f0 = K.feet(); K.look(K.yaw(), 90); K.controls.jump = true;
    await K.act('use', []); K.controls.jump = false;
    try { await grab('mace', 'fight'); } catch {}
    let prevY = K.feet().y, up = false, hit = false, top = prevY, flee = false, cushioned = false;
    for (let t = 0; t < 50 && !K.dead(); t++) {
      const f = K.feet(), vy = f.y - prevY; prevY = f.y; top = Math.max(top, f.y);
      if (f.y > f0.y + 1.5) up = true;
      if (!K.all().includes(e)) break;
      track(e, Number(K.tick()));
      // (it went up too - its own wind charge, or this one's burst caught it: measured, it then rose past this player at the top of the
      // arc, took a blow of 2 there (no fall, no smash) and came down on the player from 7 up four ticks after it landed, 22 a time.
      // So no blow at the top: away from under it on the way down, the keys steering in the air)
      // (a launch, not a jump: a jump starts at 0.42 a tick and tops out 1.25 up; a wind charge throws it at 0.9-1.6)
      if (!hit && !flee && ((e._vy ?? 0) > 0.6 || (e.y > f0.y + 2.2 && (e._vy ?? 0) > 0))) flee = true;
      const ex = e.x + (e._vx ?? 0) * 3, ez = e.z + (e._vz ?? 0) * 3, dx = ex - f.x, dz = ez - f.z, dh = hyp(dx, dz);
      K.lookAt(e.x, e.y + 1, e.z);
      if (flee) { if (dh > 0.01) keysFor(-dx / dh, -dz / dh, false); else stopKeys(); }
      else if (dh > 0.4) keysFor(dx / dh, dz / dh, false); else stopKeys();
      const reach = K.reach?.('entity') ?? 3, g = boxGap(e, e.x, e.z, f.x, f.y, f.z);
      // (the blow only once it is a fall: a mace's smash needs 1.5 of it - struck at the top of the arc it did 1-2)
      if (!flee && up && vy < -0.05 && top - f.y >= 1.6 && g <= reach) { await K.hit(e, 'attack', true); e._hitAt = Number(K.tick()); hit = true; break; }
      { const gy = groundUnder(f); if (up && !cushioned && vy < -0.45 && gy !== null && f.y - gy < 5.5 && f.y - gy > 1.5 && top - gy > 4 && g > reach + 1.2) { cushioned = true; await cushion('missed it'); } }
      if (up && vy === 0 && t > 5) break;   // landed without it
      await K.ticks(1);
    }
    if (flee) { stopKeys(); return `it went up too: away from under it (up ${(top - f0.y).toFixed(1)})`; }
    let fall = hit ? top - K.feet().y : 0, more = 0;
    // (measured against the AshBlast bot: a fall from 9 up took it from 20 to 2, then it flew off on its elytra, ate its apples 50 out
    // and came back whole. The mace's wind burst throws this player up again after every blow that lands: the next fall is on it before
    // it can get away - a second and third blow from the burst's height, while it is still in the knock of the first)
    for (let k = 0; hit && k < 2 && !K.dead() && K.all().includes(e); k++) {
      let rose = false, peak = K.feet().y, prev = K.feet().y, again = false;
      for (let t = 0; t < 45 && !K.dead() && K.all().includes(e); t++) {
        await K.ticks(1);
        const f = K.feet(), vy = f.y - prev; prev = f.y; peak = Math.max(peak, f.y);
        if (vy > 0.05) rose = true;
        if (!rose && t > 4) break;   // (no burst: nothing to fall from)
        track(e, Number(K.tick()));
        const tl = Math.max(1, Math.round((f.y - e.y) / 1.2)), ex = e.x + (e._vx ?? 0) * tl, ez = e.z + (e._vz ?? 0) * tl, dx = ex - f.x, dz = ez - f.z, dh = hyp(dx, dz);
        K.lookAt(e.x, e.y + 1, e.z);
        if (dh > 0.4) keysFor(dx / dh, dz / dh, false); else stopKeys();
        const g = boxGap(e, e.x, e.z, f.x, f.y, f.z);
        if (rose && vy < -0.05 && peak - f.y > 1.5 && g <= (K.reach?.('entity') ?? 3)) { await K.hit(e, 'attack', true); e._hitAt = Number(K.tick()); again = true; more++; fall = Math.max(fall, peak - K.feet().y); break; }
        if (rose && vy === 0) break;   // landed
        { const gy = groundUnder(f); if (process.env.LAB_CUSHION && rose && vy < -0.45 && gy !== null && f.y - gy < 5.5 && f.y - gy > 1.5 && peak - gy > 4 && g > (K.reach?.('entity') ?? 3) + 1.2) { if (await cushion('after the burst')) break; } }
        // (thrown too far by the burst to steer back onto it - it eats its apples 7-9 off while this player hangs 13 up: a pearl down on
        // it from the top of the arc, the blow once there)
        if (rose && vy < 0.05 && hyp(e.x - f.x, e.z - f.z) > 5 && cnt('ender_pearl') > 0) { if (await pearlTo(e)) break; }
      }
      stopKeys();
      if (!again) break;
    }
    stopKeys();
    return up ? (hit ? `hit from ${fall.toFixed(1)} up${more ? ` and ${more} more on the burst` : ''}` : `missed (up ${(top - f0.y).toFixed(1)})`) : 'no lift';
  }
  // an ender pearl thrown to land by e (fleeing on its elytra, or eating its apples far off): the pitch found by flying the pearl
  // (1.5 a tick, 0.03 down a tick, 1% drag) to the one that comes down nearest to where it will be when the pearl lands
  async function pearlTo(e) {
    if (cnt('ender_pearl') === 0) return false;
    const f = K.feet(), ey = f.y + 1.62;
    let best = null;
    for (let pitch = -40; pitch <= 20; pitch += 1) {
      const r = (pitch * Math.PI) / 180; let x = 0, y = 0, vh = Math.cos(r) * 1.5, vy = -Math.sin(r) * 1.5;
      for (let t = 1; t < 80; t++) {
        x += vh; y += vy; vh *= 0.99; vy = (vy - 0.03) * 0.99;
        const tx = e.x + (e._vx ?? 0) * t - f.x, tz = e.z + (e._vz ?? 0) * t - f.z, d = hyp(tx, tz);
        if (vy < 0 && y + ey <= e.y + 0.5) { const miss = Math.abs(x - d); if (!best || miss < best.miss) best = { pitch, miss, t, tx, tz }; break; }
      }
    }
    if (!best || best.miss > 3) return false;
    try { await grab('ender_pearl', 'fight'); } catch { return false; }
    K.look((Math.atan2(-best.tx, best.tz) * 180) / Math.PI, best.pitch);
    await K.act('use', []);
    if (process.env.LAB_GOAL_DEBUG) log(`duel: a pearl after it (${hyp(best.tx, best.tz).toFixed(1)} off, lands in ${best.t} ticks)`);
    return true;
  }
  async function pvpFight0(e, max) {
    pvpFight.anchors = new Set();
    // (everything one duel kept about itself starts afresh: a second duel in the same run otherwise walked back to the first one's hole)
    for (const k of ['hole', 'holeTries', 'holeStuck', 'holeSaid', 'smashAt', 'pearlAt', 'crystalAt', 'buffAt', 'wallAt', 'surrAt', 'groundY', 'blasts', 'pathAt']) delete pvpFight[k];
    // (a kit duel: the other has what this player has - a mace kit's opponent is a mace player before it is ever seen with one)
    if (cnt('mace') + cnt('wind_charge') > 0) e._maceUser = true;
    await duelOffhand();
    const w = [...WEAPONS.slice(0, 2), 'diamond_sword', 'mace', ...WEAPONS.slice(2)].find((x) => cnt(x) > 0);
    await duelBuffs(w);
    // (an enchanted golden apple before it comes, if it is not here yet: resistance and fire resistance for five minutes, 16 more hearts' worth
    // of absorption - the crystal fight's blasts and fires)
    if (cnt('enchanted_golden_apple') > 0 && !hasEffect('fire_resistance') && hyp(e.x - K.feet().x, e.z - K.feet().z) > 5) await duelEat(e, w);
    { const bi = blockItem(); if (bi) { try { await grab(bi, 'fight'); } catch {} } }   // (blocks on the hotbar: the clutch has no time to fetch them)
    if (w) await grab(w, 'fight'); else await emptyHand();
    const reach = K.reach?.('entity') ?? 3;   // (all of it: an opponent with the same reach and no margin swings first otherwise)
    let hits = 0, zig = 1, zigT = 0, prevY = K.feet().y, jumpT = -99;
    const hp0 = K.attrs().health ?? 20, t0 = Number(K.tick());
    let lost = 0;
    for (let t = 0; t < max * 20 && !K.dead() && !late(); t++) {
      // (a player the server sends again - a respawn, out of view and back - is a new entity with the same name)
      if (!K.all().includes(e)) { const again = K.all().find((q) => q.type === 'minecraft:player' && q.name && q.name === e.name); if (again) { again.hurtAt ??= e.hurtAt; again._hitAt ??= e._hitAt; again._maceUser ??= e._maceUser; e = again; } else if (e.dead || ++lost > (e._maceUser ? 1200 : 10)) { if (process.env.LAB_GOAL_DEBUG) log(`duel: ${e.name} out of view`); break; } else {
        // (out of view - the AshBlast bot flies off on its elytra to eat, 60 out and more, and comes back whole: after it, to where it was
        // last seen and on the way it went; the duel is not over until it is dead)
        if (lost === 11 && process.env.LAB_GOAL_DEBUG) log(`duel: ${e.name} out of view: after it`);
        if (lost > 10) { const f = K.feet(), tx = e.x + (e._vx ?? 0) * 20, tz = e.z + (e._vz ?? 0) * 20, d = hyp(tx - f.x, tz - f.z); if (d > 3) { const w2 = stepWay((tx - f.x) / d, (tz - f.z) / d, []); if (w2) { stopKeys(); K.look((Math.atan2(-w2[0], w2[1]) * 180) / Math.PI, 0); K.controls.forward = K.controls.sprint = true; } else stopKeys(); } else stopKeys(); }
        await K.ticks(1); continue; } }
      lost = 0;
      // the totem popped: the next one into the off hand before anything else (the second blast comes a few ticks after the first)
      if (offName() !== 'totem_of_undying' && offName() !== 'shield' && cnt('totem_of_undying') > 0) { await duelOffhand(); continue; }
      const now = Number(K.tick()), f = K.feet(), lagT = Math.round(K.lag?.() ?? 0), L = Math.min(10, Math.round(lagT / 2) + 1);
      track(e, now);
      // (LAB_BLAST_LOG: each crystal or anchor near that goes off, with the hurt reckoned for it on this player's box as it stood - to
      // set against what the server says it did: walls weighed to 0 still let 3-8 through, so the reckoning is checked, not trusted)
      if (process.env.LAB_BLAST_LOG) {
        const B = (pvpFight.blasts ??= new Map()), f0 = K.feet(), seen = new Set();
        for (const q of K.all()) if (/ender_crystal|end_crystal/.test(q.type) && hyp(q.x - f0.x, q.y - f0.y, q.z - f0.z) < 12) { const k = 'c' + q.id; seen.add(k); B.set(k, { x: q.x, y: q.y, z: q.z, raw: blastRaw(q.x, q.y, q.z, f0.x, f0.y, f0.z), sh: seenShare(q.x, q.y, q.z, f0.x, f0.y, f0.z), d: Math.hypot(q.x - f0.x, q.y - f0.y, q.z - f0.z) }); }
        { const [ax, ay, az] = feet(); for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -2; dy <= 3; dy++) { const x = ax + dx, y = ay + dy, z = az + dz; if (!/respawn_anchor/.test(bname(x, y, z))) continue; const k = `a${x},${y},${z}`; seen.add(k); blastAir = new Set([`${x},${y},${z}`]); try { B.set(k, { x: x + 0.5, y: y + 0.5, z: z + 0.5, raw: blastRaw(x + 0.5, y + 0.5, z + 0.5, f0.x, f0.y, f0.z), sh: seenShare(x + 0.5, y + 0.5, z + 0.5, f0.x, f0.y, f0.z), d: Math.hypot(x + 0.5 - f0.x, y + 0.5 - f0.y, z + 0.5 - f0.z) }); } finally { blastAir = null; } } }
        const ring = () => { const [ax, ay, az] = feet(); let r = ''; for (const dy of [0, 1]) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) r += (fAt(ax + dx, ay + dy, az + dz) & F_SOLID) ? '#' : '.'; return `${ax} ${ay} ${az} ${r}`; };
        for (const [k, v] of B) if (!seen.has(k)) { B.delete(k); log(`blast ${k[0] === 'c' ? 'crystal' : 'anchor'} at ${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.z.toFixed(1)}: ${v.d.toFixed(1)} off, seen ${(v.sh * 100).toFixed(0)}%, reckoned ${v.raw.toFixed(1)} before armour; ring ${ring()}`); }
      }
      const gap = boxGap(e, e.x, e.z, f.x, f.y, f.z), ex = e.x + e._vx * L, ez = e.z + e._vz * L, gapP = boxGap(e, ex, ez, f.x, f.y, f.z);
      const since = e.hurtAt !== undefined && e.hurtAt >= (e._hitAt ?? -99) ? now - e.hurtAt + lagT : now - (e._hitAt ?? -99);
      const opensIn = 10 - since, vy = f.y - prevY; prevY = f.y;
      const safeFor = 10 - (now - (K.hurtAt?.() ?? -99)) - Math.round(lagT / 2);   // ticks this player cannot be hurt still
      K.lookAt(e.x, e.y + 1.2, e.z);
      // (first of all: a mace coming down from high up is out-run from its first ticks - anything else this loop starts, a buff, an
      // apple, costs the ten ticks it needed)
      if (vy === 0) pvpFight.groundY = f.y;
      const gy = pvpFight.groundY ?? f.y, airborne = e.y > gy + 0.45;
      if (airborne && !e._up) { e._up = true; e._launchT = now; } else if (!airborne) { if (e._up) e._landT = now; e._up = false; }
      // (and on the ground with a mace or a wind charge in hand: not within 4.4 of it unless the blow is due now - its launch and fall take
      // four ticks, too quick to run from once seen; kept off, its jump is wasted, and its 15 ticks without a blow after it are for hitting)
      if (/mace|wind_charge/.test(e.held ?? '')) e._maceUser = true;   // (seen once with one: a mace player - it switches to an apple and back in a tick)
      if (!airborne && e._maceUser && !(now - (e._launchT ?? -99) + lagT < 14) && !(now - (e._landT ?? -99) < (Number(process.env.LAB_MACE_LAND) || 12)) && gap < 4.4 && !(opensIn <= 0 && gap <= reach + 0.2)) {
        const ux2 = (f.x - e.x) / (hyp(f.x - e.x, f.z - e.z) || 1), uz2 = (f.z - e.z) / (hyp(f.x - e.x, f.z - e.z) || 1), way = stepWay(ux2, uz2, []) ?? stepWay(-uz2, ux2, []) ?? stepWay(uz2, -ux2, []);
        if (way) { stopKeys(); keysFor(way[0], way[1]); if (process.env.LAB_FIGHT_TRACE) log(`duel t${now} off its mace (${e.held}) at ${gap.toFixed(2)}`); await K.ticks(1); continue; }
      }
      if (airborne && (e._maceUser || cnt('wind_charge') > 0)) {
        // (where it will be when this player's step lands: its fall is fast, what is seen of it a tick or two old)
        const ahead = lagT + 2, py = e.y + Math.min(0, (e._vy ?? 0) * ahead - 0.04 * ahead * ahead);
        const inLock = now - (e._launchT ?? -99) + lagT < 12 && (e._vy ?? 0) > -0.2, d3 = hyp(e.x + e._vx * ahead - f.x, Math.max(0, py - gy - 1), e.z + e._vz * ahead - f.z);
        // a mace dive from high up (a wind charge, then the mace's wind burst after every blow: 17 up, a blow of 25-35 each time it comes
        // down, measured against the AshBlast bot - it steers 0.1-0.2 a tick in the air, this player sprint-jumps 0.3): its ticks until
        // its feet are 3.6 over this player's (the blow's height) from its speed and the fall (0.08 a tick, 2% drag), and whether it can
        // steer onto this player by then; if so, away now - waiting until it is low left two or three ticks, it landed every time
        let T = 0; { let y = e.y - f.y, v = e._vy ?? 0; while (y > 3.6 && T < 80) { v = (v - 0.08) * 0.98; y += v; T++; } }
        const hz = hyp(e.x - f.x, e.z - f.z), high = e.y - f.y > 2.2;
        const dive = high && hz < 3.9 + 0.22 * (T + lagT);
        if (dive && !(inLock && gap <= reach && opensIn <= 0) || (!inLock && d3 < 5.4)) {
          let ux2 = (f.x - e.x) / (hz || 1), uz2 = (f.z - e.z) / (hz || 1);
          if (hz < 0.4) { const yaw = ((K.yaw() ?? 0) * Math.PI) / 180; ux2 = -Math.sin(yaw); uz2 = Math.cos(yaw); }   // (straight over: on the way it faces)
          // (in the air - its fall after this player's own, a knock - there is no step to check: the keys steer the fall away all the same;
          // waiting to land left four ticks, and its blow came in them)
          const way = stepWay(ux2, uz2, []) ?? stepWay(ux2 * 0.7 - uz2 * 0.7, uz2 * 0.7 + ux2 * 0.7, []) ?? stepWay(ux2 * 0.7 + uz2 * 0.7, uz2 * 0.7 - ux2 * 0.7, []) ?? stepWay(-uz2, ux2, []) ?? stepWay(uz2, -ux2, []) ?? (vy !== 0 ? [ux2, uz2] : null);
          stopKeys(); K.controls.sneak = false;
          if (way) { K.look((Math.atan2(-way[0], way[1]) * 180) / Math.PI, 0); K.controls.forward = true; K.controls.sprint = true; if (vy === 0 && (K.attrs()['player.hunger'] ?? 20) > 6) K.controls.jump = true; }
          e._dodged = now;
          if (process.env.LAB_FIGHT_TRACE) log(`duel t${now} out from under it: ${(e.y - f.y).toFixed(1)} above, ${hz.toFixed(1)} off, ${T} ticks to its blow, way ${way ? way.map((q) => q.toFixed(2)).join(' ') : 'none'} at ${f.x.toFixed(2)} ${f.y.toFixed(2)} ${f.z.toFixed(2)} keys ${Object.entries(K.controls).filter(([, v]) => v).map(([k]) => k).join('+')}`);
          await K.ticks(1); K.controls.jump = false; continue;
        }
      }
      // an end crystal set down near this player (it goes off a few ticks later): a block wall between at once - its blast counts the rays
      // that reach the player (measured with a creeper: one block at the feet on its side took 15 to 1, one at the head to 0)
      // this player's own crystal on it, where its blast takes the other and not the player (a few ticks between: the crystal is gone)
      if (cnt('end_crystal') > 0 && gap < (process.env.LAB_SURROUND ? 6.5 : 5.5) && now - (pvpFight.crystalAt ?? -99) > (process.env.LAB_SURROUND ? 6 : 10) && !(e._maceUser && e.y > (pvpFight.groundY ?? f.y) + 2)) { pvpFight.crystalAt = now; if (await crystalHit(e, w)) continue; }
      // every crystal and anchor about, weighed each tick for what its blast would do to the player where it stands now - the worst one
      // walled against (again after the player has moved: a wall set once is behind it a step later). Measured with the server's own
      // blocks round the player at each blast: most of the hits (5-7) came with no wall at all - anchors 3-5 off (only 2 off were
      // looked at) and crystals walled once, from where the player had been
      // (opt-in, LAB_THREAT_WALL=1: two duels with it took 137 and 179, lowest health 1.0 both - no better than one wall per crystal)
      if (process.env.LAB_THREAT_WALL) {
        if (now - (pvpFight.wallAt ?? -99) >= 3) {
          let worst = null;
          for (const q of K.all()) if (/ender_crystal|end_crystal/.test(q.type) && !q._mine && hyp(q.x - f.x, q.y - f.y, q.z - f.z) < 8) { const v = blastRaw(q.x, q.y, q.z, f.x, f.y, f.z); if (!worst || v > worst.v) worst = { v, t: q }; }
          { const [ax, ay, az] = feet(); for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -2; dy <= 3; dy++) { const x = ax + dx, y = ay + dy, z = az + dz; if (!/respawn_anchor/.test(bname(x, y, z))) continue; const k = `${x},${y},${z}`; blastAir = new Set([k]); let v = 0; try { v = blastRaw(x + 0.5, y + 0.5, z + 0.5, f.x, f.y, f.z); } finally { blastAir = null; } if (!worst || v > worst.v) worst = { v, t: { x: x + 0.5, y, z: z + 0.5, k } }; } }
          if (worst && worst.v >= 8) { pvpFight.wallAt = now; if (await crystalWall(worst.t, w)) continue; }
        }
      } else {
      { const cr = K.all().find((q) => /ender_crystal|end_crystal/.test(q.type) && !q._walled && hyp(q.x - f.x, q.y - f.y, q.z - f.z) < 7);
        if (cr) { cr._walled = true; if (await crystalWall(cr, w)) continue; } }
      // a respawn anchor set down beside this player (charged and set off by the other: a blast of 5): a wall the same way
      { const [ax, ay, az] = feet(); let an = null;
        for (let dx = -2; dx <= 2 && !an; dx++) for (let dz = -2; dz <= 2 && !an; dz++) for (let dy = -1; dy <= 2 && !an; dy++) if (/respawn_anchor/.test(bname(ax + dx, ay + dy, az + dz)) && !pvpFight.anchors?.has(`${ax + dx},${ay + dy},${az + dz}`)) an = { x: ax + dx + 0.5, y: ay + dy, z: az + dz + 0.5, k: `${ax + dx},${ay + dy},${az + dz}` };
        if (an) { (pvpFight.anchors ??= new Set()).add(an.k); if (await crystalWall(an, w)) continue; } }
      }
      // the surround (a crystal duel): obsidian in the four cells beside the player's feet, and the player kept in the middle of its cell -
      // the other can set no anchor or crystal against its feet, only up on the ring, where the ring itself stands between the blast and
      // the player's legs. Measured without it: 130-180 health a duel from blasts, most of them set right beside the player
      const surr = !!process.env.LAB_SURROUND && cnt('end_crystal') > 0 && cnt('obsidian') >= 4 && vy === 0 && !airborne;
      if (surr) {
        const [sx0, sy0, sz0] = feet();
        const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [sx0 + a, sy0, sz0 + b]).filter(([x, y, z]) => (fAt(x, y, z) & F_PASS) && (fAt(x, y - 1, z) & F_SOLID) && !(Math.abs(e.x - (x + 0.5)) < 0.8 && Math.abs(e.z - (z + 0.5)) < 0.8 && Math.abs(e.y - y) < 1.5));
        const mid = Math.abs(f.x - (sx0 + 0.5)) < 0.2 && Math.abs(f.z - (sz0 + 0.5)) < 0.2;
        if (!mid && open.length) { const hx = sx0 + 0.5 - f.x, hz = sz0 + 0.5 - f.z, hl = hyp(hx, hz) || 1; stopKeys(); K.controls.sneak = true; keysFor(hx / hl, hz / hl, false); await K.ticks(1); stopKeys(); continue; }
        if (open.length && now - (pvpFight.surrAt ?? -99) > 4) {
          pvpFight.surrAt = now; stopKeys();
          try { await grab('obsidian', 'wall'); } catch {}
          for (const [x, y, z] of open) { K.act('useon', [S(x), S(y - 1), S(z), 'up', 'fast']).catch(() => {}); await K.ticks(1); }
          if (process.env.LAB_GOAL_DEBUG) log(`duel: the surround at ${sx0} ${sy0} ${sz0}: ${open.length} set`);
          if (w) { try { await grab(w, 'fight'); } catch {} }
          continue;
        }
      }
      // lava or fire on the player (the UHC bot pours lava on it: in 8 UHC duels it landed no blow at all, and every bit of the 0-10 taken
      // was lava and burning): the water bucket poured at the feet - it puts the fire out and turns the lava to stone - and taken back up
      if (process.env.LAB_WATER && cnt('water_bucket') > 0 && vy === 0) {   // (opt-in: 8 UHC duels with it 5.1 taken on average, without 3.9)
        const [wx, wy, wz] = feet(), hot = [[wx, wy, wz], [wx, wy + 1, wz]].some((c) => /lava|fire/.test(bname(...c)));
        if (hot || (K.onFire?.() && now - (pvpFight.waterAt ?? -99) > 20)) {
          pvpFight.waterAt = now; stopKeys(); K.controls.sneak = false;
          try {
            await grab('water_bucket', 'fight'); K.look(K.yaw?.() ?? 0, 90);
            await K.act('useon', [S(wx), S(wy - 1), S(wz), 'up']);
            if (process.env.LAB_GOAL_DEBUG) log(`duel: water at my feet (${hot ? 'lava or fire in my cell' : 'on fire'})`);
            await K.ticks(4);
            if (cnt('bucket') > 0 && /water/.test(bname(wx, wy, wz))) { await grab('bucket', 'fight'); await K.act('useon', [S(wx), S(wy - 1), S(wz), 'up']); }
          } catch {}
          if (w) { try { await grab(w, 'fight'); } catch {} }
          continue;
        }
      }
      // (no buff throw with a mace player up over this one: the throw is ticks of standing under its fall)
      // (not with it coming in: a splash thrown on the player's own feet is ticks of looking down, not at it - the impossible mace bot's
      // blow of 6.7 came in one; 6 off and not coming, or 9 off coming)
      // (14 off from a mace player - its launch closes 9 - was tried and was worse: without the speed the duels dragged, 4.5-63.3 taken)
      if (gap > (e._coming2 ? 9 : 6) && now - (pvpFight.buffAt ?? -99) > 40 && !(e._maceUser && e.y > (pvpFight.groundY ?? f.y) + 2) && (!hasEffect('strength', 2) || !hasEffect('speed', 2))) { pvpFight.buffAt = now; if (await duelBuffs(w)) continue; }
      // hurt and it is not on top of the player: a golden apple (the regeneration outlasts the blows)
      // (not with it close: 32 ticks of eating in its reach were four blows and a mace fall - a race lost eating; low and close, away first
      // at a run, then the apple)
      { const hp = K.attrs().health ?? 20;
        // (a mace player reaches 4 from the air and flies at the player: eating only 8 off with it on the ground)
        const safeGap = e._maceUser ? (e.y > (pvpFight.groundY ?? f.y) + 0.45 ? 99 : 8) : 4.6;
        if (hp <= 13 && gap > safeGap && now - (pvpFight.ateAt ?? -99) > 45 && cnt('golden_apple') + cnt('enchanted_golden_apple') > 0) { pvpFight.ateAt = now; if (await duelEat(e, w)) continue; }
        if (hp <= 7 && gap <= safeGap && opensIn > 2 && cnt('golden_apple') + cnt('enchanted_golden_apple') > 0) {
          const ux2 = (f.x - e.x) / (hyp(f.x - e.x, f.z - e.z) || 1), uz2 = (f.z - e.z) / (hyp(f.x - e.x, f.z - e.z) || 1), way = stepWay(ux2, uz2, []) ?? stepWay(-uz2, ux2, []) ?? stepWay(uz2, -ux2, []);
          if (way) { stopKeys(); K.look((Math.atan2(-way[0], way[1]) * 180) / Math.PI, 0); K.controls.forward = K.controls.sprint = true; if (process.env.LAB_FIGHT_TRACE) log(`duel t${now} low (${hp.toFixed(1)}): away to eat`); await K.ticks(1); continue; }
        }
      }
      // it is in the air above (a mace's fall, a wind charge's jump) and coming down: the shield up to it, still (Bedrock: a sneak raises
      // it) - the mace's fall blow is the heaviest in the game, a raised shield takes all of it
      // a mace player's cycle (a wind charge at its feet, up, down on the player with the mace): measured, a raised shield does not stop
      // the blow from above, and it reaches 4 from up there. Its launch is its own 15 ticks without a blow: those are the ticks to hit it
      // (it rises within reach); after them, out past 4.6 from it until it has landed
      // this player's own mace fall (the kit's wind charge at its feet: up some 7, then the mace down on it - density and the fall's
      // height; a blow landed launches this player again, the wind burst): against a mace player on the ground a few blocks off, the
      // only blows that count through its armour (a mace swung on the ground did 2-3 on the AshBlast bot, its totems outlasted them)
      // (not with it inside the charge's burst: 16 times in one duel the charge at this player's feet threw the AshBlast bot up as well,
      // and its fall came down on the player - 22 a time; 3 out, the burst leaves it on the ground)
      if (!process.env.LAB_NO_SMASH && !airborne && vy === 0 && cnt('mace') > 0 && cnt('wind_charge') > 0 && hyp(e.x - f.x, e.z - f.z) >= (Number(process.env.LAB_SMASH_MIN) || 3.2) && gap < 6.5 && now - (pvpFight.smashAt ?? -99) > 30 && (K.attrs().health ?? 20) > 6) {
        pvpFight.smashAt = now; stopKeys();
        const ok = await maceSmash(e);
        if (process.env.LAB_GOAL_DEBUG) log(`duel: a mace fall from a wind charge: ${ok}`);
        if (w) { try { await grab(w, 'fight'); } catch {} }
        continue;
      }
      // the shield held up the whole fight while the other has no axe (an axe takes it out for five seconds): down only for the blow and
      // for eating - Bedrock raises it while sneaking; measured, the impossible sword bot hit a raised shield for 4 s and did nothing
      const turtle = offName() === 'shield' && !/axe/.test(e.held ?? '') && !process.env.LAB_NO_TURTLE;
      K.controls.sneak = turtle;
      const air = vy !== 0 || now - jumpT < 12;
      // (LAB_HOLE=1, a trial: a hole one deep dug under the player's feet and the fight from in it, not moving. One block lower, the
      // player's eye is level with the other's body - its reach is all of the 3 across - while the other's eye looks down on the
      // player's: its reach across is ~0.1 less. Every blow the other got in on the sword kit came back in the same moment as the
      // player's own, both in reach: from the hole the blow is struck in the tick it comes within the player's reach and not yet its own)
      // (on by default for a bare sword kit - no shield, bow, mace, crystals or carts: 4 duels, 1.7-9.9 taken, 5.5 on average, against
      // 8-10 the old way; LAB_HOLE=1 turns it on for any kit, LAB_NO_HOLE=1 off)
      const holeKit = !!process.env.LAB_HOLE || (!process.env.LAB_NO_HOLE && ['shield', 'mace', 'end_crystal', 'bow', 'crossbow', 'tnt_minecart', 'respawn_anchor', 'wind_charge'].every((q) => cnt(q) === 0 && offName() !== q));
      if (holeKit && !e._maceUser && vy === 0) {
        const [hx, hy, hz] = feet();
        // (the hole in the cell behind the player, away from it: the player does not stand on the block being dug, so its blows during
        // the digging do not throw the player off the spot - they throw it back, toward the hole; one step back then drops it in.
        // Measured, dug under the feet: once in the hole the bot did not land one blow in six, but it hit 4-8 times while the player dug
        // and was thrown off the spot and walked back)
        const bx0 = f.x - e.x, bz0 = f.z - e.z;
        const [cx, cz] = Math.abs(bx0) >= Math.abs(bz0) ? [hx + Math.sign(bx0 || 1), hz] : [hx, hz + Math.sign(bz0 || 1)];
        if (!pvpFight.hole && gap > 2.2 && (fAt(cx, hy - 1, cz) & F_SOLID) && (fAt(cx, hy - 2, cz) & F_SOLID) && (fAt(cx, hy, cz) & F_PASS) && (fAt(cx, hy + 1, cz) & F_PASS)) {
          stopKeys(); K.controls.sneak = false;
          for (let tr = 0; tr < 2 && (fAt(cx, hy - 1, cz) & F_SOLID); tr++) { try { await K.act('dig', [S(cx), S(hy - 1), S(cz)]); } catch {} for (let k = 0; k < 6 && (fAt(cx, hy - 1, cz) & F_SOLID); k++) await K.ticks(1); }
          if (fAt(cx, hy - 1, cz) & F_SOLID) { pvpFight.holeTries = (pvpFight.holeTries ?? 0) + 1; if (pvpFight.holeTries >= 3) pvpFight.hole = 'none'; continue; }
          pvpFight.hole = [cx, hy - 1, cz];
          if (process.env.LAB_GOAL_DEBUG) log(`duel: a hole dug behind me at ${cx} ${hy - 1} ${cz}`);
          if (w) { try { await grab(w, 'fight'); } catch {} }
          continue;
        }
        // (the other fell into it: now it is the lower one, with the reach - measured, the player walked back at it seven times and took
        // seven blows. The hole is left to it and another dug behind the player)
        if (Array.isArray(pvpFight.hole) && Math.floor(e.x) === pvpFight.hole[0] && Math.floor(e.z) === pvpFight.hole[2] && e.y < pvpFight.hole[1] + 0.6) {
          if (process.env.LAB_GOAL_DEBUG) log(`duel: ${e.name ?? 'it'} is in my hole - another`);
          pvpFight.hole = (pvpFight.holeTries ?? 0) < 3 ? null : 'none';
        }
        // (knocked out of it: back in - a step toward it drops the player in - while its blow is not due; the edge of the hole is a cliff
        // of one, walked off at a sprint)
        // (only while it cannot hit: just struck - thrown back and not to be hurt for 10 ticks, the steps in are ~6 - or still far off;
        // otherwise the fight goes on as without a hole, facing it. Measured over 8 duels: 17 of the 29 blows taken came between the hole
        // dug and the first blow from it - the player walking to the hole with its back to the bot)
        // (and once started, carried through: cut off after 4 ticks it stopped half way and the fight's own steps took it off again)
        const safeIn = process.env.LAB_HOLE_ANYTIME || now - (e._hitAt ?? -99) <= 4 || gap > 4.2 || now - (pvpFight.enteringAt ?? -99) < 12;
        if (safeIn && Array.isArray(pvpFight.hole) && now - (pvpFight.enteringAt ?? -99) >= 12) pvpFight.enteringAt = now;
        if (safeIn && Array.isArray(pvpFight.hole) && !(hx === pvpFight.hole[0] && hy === pvpFight.hole[1] && hz === pvpFight.hole[2]) && hy === pvpFight.hole[1] + 1 && Math.max(Math.abs(hx - pvpFight.hole[0]), Math.abs(hz - pvpFight.hole[2])) <= 2 && !(fAt(...pvpFight.hole) & F_SOLID)) {
          // (walked in face first; backing in with the eyes on it and the blow ready - LAB_HOLE_BACK=1 - measured no better: 4 duels
          // 8.5/3.4/13.0/3.4 taken against 9.9/3.4/6.8/1.7)
          const dx = pvpFight.hole[0] + 0.5 - f.x, dz = pvpFight.hole[2] + 0.5 - f.z, dl = hyp(dx, dz) || 1;
          stopKeys(); K.controls.sneak = false;
          // (standing right over it and not falling: the block is still there on the server - the dig this client counted as done was cut
          // off by the other's blow. Measured twice: 0.1 and 0.3 off the hole's middle, not in it, 15-19 taken. Dug again from on top)
          if (dl < 0.35) { pvpFight.holeStuck = (pvpFight.holeStuck ?? 0) + 1; if (pvpFight.holeStuck > 5) { pvpFight.holeStuck = 0; if (process.env.LAB_GOAL_DEBUG) log('duel: the hole is not there on the server - dug again from on top'); try { await K.act('dig', pvpFight.hole.map(S)); } catch {} for (let k = 0; k < 8 && K.feet().y > pvpFight.hole[1] + 0.2; k++) await K.ticks(1); continue; } } else pvpFight.holeStuck = 0;
          if (process.env.LAB_HOLE_BACK) { K.lookAt(e.x, e.y + 1.2, e.z); keysFor(dx / dl, dz / dl, false); if (opensIn <= 0 && gap <= reach) { await K.hit(e, 'attack', true); e._hitAt = Number(K.tick()); hits++; } }
          else { K.look((Math.atan2(-dx, dz) * 180) / Math.PI, 0); K.controls.forward = true; if (dl > 0.4 && (K.attrs()['player.hunger'] ?? 20) > 6) K.controls.sprint = true; }
          if (process.env.LAB_GOAL_DEBUG && now - (pvpFight.holeSaid ?? -99) > 20) { pvpFight.holeSaid = now; log(`duel: back into the hole (${dl.toFixed(1)} off)`); }
          await K.ticks(1); continue;
        }
        if (Array.isArray(pvpFight.hole) && hx === pvpFight.hole[0] && hy === pvpFight.hole[1] && hz === pvpFight.hole[2]) {
          stopKeys(); K.controls.sneak = false;
          K.lookAt(e.x, e.y + Math.min(1.5, (e.bh > 0 ? e.bh : 1.8) * 0.8), e.z);
          const gapN = boxGap(e, e.x + (e._vx ?? 0) * (lagT + 1), e.z + (e._vz ?? 0) * (lagT + 1), f.x, f.y, f.z);
          if (opensIn <= 0 && (gap <= reach || gapN <= reach)) {
            await K.hit(e, 'attack', true); e._hitAt = Number(K.tick()); hits++;
            if (process.env.LAB_GOAL_DEBUG) log(`duel: blow ${hits} at ${gap.toFixed(2)} from the hole, ${e.name ?? 'it'} window ${since}`);
          }
          await K.ticks(1); continue;
        }
      }
      // the blow: its window open by the time it lands, in reach; in the air on the way up it waits for the way down (the crit)
      // (the swing started as it walks in: in reach now, or on the next tick by its own walk - a player clicks as the other comes into the
      // crosshair; waiting to see it inside lost the first exchange to one that walked in at a sprint)
      const gap1 = boxGap(e, e.x + e._vx, e.z + e._vz, f.x, f.y, f.z);
      e._coming2 = (e._vx * (f.x - e.x) + e._vz * (f.z - e.z)) / (hyp(f.x - e.x, f.z - e.z) || 1) > 0.1;   // (walking in at it: where it will be when the blow lands is what counts - a round trip and two and a half ticks on (what is seen is a tick old, the swing takes one), so it lands inside its reach, not after its own swing)
      if (opensIn <= 0 && (gap <= reach || gap1 <= reach || (e._coming2 && boxGap(e, e.x + e._vx * (lagT + 2.5), e.z + e._vz * (lagT + 2.5), f.x, f.y, f.z) <= reach)) && !(air && vy > 0.01 && gapP <= reach - 0.3)) {
        // (the W-tap's sprint tick only while it cannot hit back this tick: in an even race for the first blow the tick is the race;
        // already sprinting, the blow is a sprint blow anyway)
        const [wx, wy, wz] = feet(), tap = !K.controls.sprint && safeFor > 1 && !(fAt(wx, wy, wz) & F_WATER) && (K.attrs()['player.hunger'] ?? 20) > 6 && !air && WEAPONS.includes(sh(nm(K.inv.slots[K.inv.selected] ?? {}) || ''));
        if (tap) { K.controls.back = K.controls.left = K.controls.right = false; K.controls.forward = K.controls.sprint = true; await K.ticks(1); }
        await K.hit(e, 'attack', true); e._hitAt = Number(K.tick()); hits++;
        if (process.env.LAB_GOAL_DEBUG) log(`duel: blow ${hits} at ${gap.toFixed(2)}${air && vy < 0 ? ' (crit)' : ''}${tap ? ' (W-tap)' : K.controls.sprint ? ' (sprinting)' : ''}, ${e.name ?? 'it'} window ${since}`);
        K.controls.forward = K.controls.sprint = false; K.controls.back = true;
        continue;
      }
      // the edge behind, while it cannot hit (its blow comes when this player can be hurt and is in its reach)
      if (gap > 3.6 && blockItem() && dropAt((f.x - e.x) / (hyp(f.x - e.x, f.z - e.z) || 1), (f.z - e.z) / (hyp(f.x - e.x, f.z - e.z) || 1))) { stopKeys(); const r = await guardEdge(e); if (r !== null) { if (w) await grab(w, 'fight'); await K.ticks(1); continue; } }
      if (surr && gap < 12) { stopKeys(); K.controls.sneak = false; K.lookAt(e.x, e.y + 1.2, e.z); await K.ticks(1); continue; }
      // where to be: in to the edge of reach when the blow comes due (or while this player cannot be hurt), else just out of its reach
      const pressIn = opensIn <= L + 2 || safeFor > 3;
      const want = pressIn ? reach - 0.15 : 3.35;
      const ux = (e.x - f.x) / (hyp(e.x - f.x, e.z - f.z) || 1), uz = (e.z - f.z) / (hyp(e.x - f.x, e.z - f.z) || 1);
      if (now - zigT > 15) { zig = -zig; zigT = now; }
      let mx = 0, mz = 0;
      // (it charges in and the blow is due: let it come - standing, the swing timed on where it will be, its charge is the only closing
      // speed to guess; charging back doubled it and its swing came a tick first)
      const charge = e._coming2 && opensIn <= 0 && safeFor <= 0 && gap < 5.5 && hyp(e._vx, e._vz) > 0.15;
      if (charge) { /* hold */ } else if (gapP > want + 0.1) { mx = ux; mz = uz; } else if (gapP < want - 0.25) { mx = -ux; mz = -uz; }
      if (!charge) { mx += -uz * zig * 0.5; mz += ux * zig * 0.5; }   // (and round it: its blows aimed at where the player was)
      const n = hyp(mx, mz) || 1, way = stepWay(mx / n, mz / n, []);
      // (far off, or no step towards it - craters from the crystals, a pearl away, a wall: the path finder takes this player to it)
      // (not into a crystal field: there it comes to the player - walking a path among its crystals and anchors was two deaths)
      // (it got away - on its elytra, a pearl - to eat its apples out of reach: a pearl after it, on the ground, not while it is up with
      // a mace over this player; the path finder walked there at 4 a second while it healed to full)
      // (each pearl's landing costs ~1.1 of fall: 13 pearls, 14.6 health in one duel - LAB_PEARL_STRICT=1 only after one far off that is
      // eating or standing; not the default: the duel with it (and the cushions) was lost)
      if (vy === 0 && !airborne && gap > (process.env.LAB_PEARL_STRICT ? 18 : 14) && gap < 60 && (!process.env.LAB_PEARL_STRICT || /golden_apple|potion/.test(e.held ?? '') || hyp(e._vx ?? 0, e._vz ?? 0) < 0.12) && cnt('ender_pearl') > 0 && now - (pvpFight.pearlAt ?? -99) > (process.env.LAB_PEARL_STRICT ? 80 : 50) && (K.attrs().health ?? 20) > 8) {
        pvpFight.pearlAt = now; stopKeys(); K.controls.sneak = false;
        if (await pearlTo(e)) { if (w) { try { await grab(w, 'fight'); } catch {} } for (let k = 0; k < 30 && K.feet().y === f.y && hyp(K.feet().x - f.x, K.feet().z - f.z) < 1; k++) await K.ticks(1); continue; }
      }
      // (up in the air - the burst after a blow - no path: steer on the way down; the path finder in the air gave up 'no way' eight times)
      if (vy !== 0 && gap > 8) { const d = hyp(e.x - f.x, e.z - f.z) || 1; keysFor((e.x - f.x) / d, (e.z - f.z) / d, false); await K.ticks(1); continue; }
      // (a mace player is never walked to on a path: the path finder has the keys for seconds at a time and the eyes off it - measured,
      // the AshBlast bot's wind charge and 12-high fall came down on a player walking a path to it, eleven times in one duel; straight at
      // it at a sprint instead, the loop above watching every tick)
      if (e._maceUser && gap > 8) { const d = hyp(e.x - f.x, e.z - f.z) || 1, w2 = stepWay((e.x - f.x) / d, (e.z - f.z) / d, []); K.controls.sneak = false; if (w2) { K.look((Math.atan2(-w2[0], w2[1]) * 180) / Math.PI, 0); stopKeys(); K.controls.forward = K.controls.sprint = true; } else stopKeys(); await K.ticks(1); continue; }
      if (gap > (cnt('end_crystal') > 0 || pvpFight.anchors?.size ? 16 : 8) && (!way || gap > 12 || Math.abs(e.y - f.y) > 1.5) && now - (pvpFight.pathAt ?? -99) > 40) {
        pvpFight.pathAt = now; stopKeys(); K.controls.sneak = false;
        if (process.env.LAB_GOAL_DEBUG) log(`duel: ${gap.toFixed(1)} off${way ? '' : ', no straight way'}: going to it`);
        try { await goToEntity(e, 2.8); } catch {}
        continue;
      }
      if (charge) stopKeys(); else if (way) keysFor(way[0], way[1], !turtle && (pressIn ? gapP > want - 0.3 : gapP > want + 1.2)); else stopKeys();
      K.controls.sneak = turtle;   // (pressing in at a sprint to the blow: it lands as a sprint blow)
      // a crit jump: walking in from just outside, the blow due in about the jump's rise
      // (and against a charge: the jump timed so the way down meets it - its counter-blow comes at once and in the air it is a crit, 10.5
      // against 7: the trade is only even if this player's blows are crits too)
      const closing = Math.max(0.05, (e._vx * (f.x - e.x) + e._vz * (f.z - e.z)) / (hyp(f.x - e.x, f.z - e.z) || 1)), meetIn = (gap - reach) / closing - lagT;
      const critCharge = charge && meetIn >= 5 && meetIn <= 8;
      if (!process.env.LAB_NO_CRIT && !air && ((pressIn && gap > reach + 0.2 && gap < reach + 1.1 && opensIn >= 3 && opensIn <= 7) || critCharge)) { K.controls.jump = true; jumpT = now; } else K.controls.jump = false;
      if (process.env.LAB_FIGHT_TRACE) log(`duel t${now} held ${e.held}/${e.offhand} gap ${gap.toFixed(2)}>${gapP.toFixed(2)} opens ${opensIn} safe ${safeFor} want ${want.toFixed(2)} vy ${vy.toFixed(2)} keys ${Object.entries(K.controls).filter(([, v]) => v).map(([k]) => k).join('+')}`);
      await K.ticks(1);
    }
    stopKeys();
    // (won: seen to die, or gone from the world while near; one that flew or pearled out of view far off is not beaten - the AshBlast
    // bot left on its elytra at 40 out and the duel said won)
    const lastD = hyp(e.x - K.feet().x, e.z - K.feet().z);
    const won = !K.dead() && (e.dead || (lastD < 24 && !K.all().some((q) => q === e || (q.type === 'minecraft:player' && q.name === e.name))));
    log(`duel with ${e.name ?? sh(e.type)}: ${K.dead() ? 'lost' : won ? 'won' : 'broken off'} after ${hits} blows in ${((Number(K.tick()) - t0) / 20).toFixed(1)} s, health ${Math.round(K.attrs().health ?? 0)} (from ${Math.round(hp0)})`);
    return won;
  }
  async function fightOne(e, max = 30, o = {}) {
    if (e.type === 'minecraft:player') return pvpFight(e, max);
    const w = WEAPONS.find((x) => cnt(x) > 0);
    if (!shieldUp() && cnt('shield') > 0) { const i = K.inv.slots.findIndex((it) => it?.network_id && sh(nm(it)) === 'shield'); if (i >= 0) { try { await K.act('move', [String(i), 'offhand']); } catch {} } }
    if (w) await grab(w, 'fight'); else await emptyHand();
    if (SPACED(e) && !process.env.LAB_OLD_FIGHT) { const off = o.stay ? () => {} : clutchGuard(); try { return await spaceFight(e, max, o); } finally { off(); } }
    let best = Infinity, slow = 0, hits = 0, chase = 0;
    const hostile = HOSTILE.test(e.type);
    for (let k = 0; k < max && K.all().includes(e) && !K.dead(); k++) {
      const f = K.feet(), d = hyp(e.x - f.x, e.y - f.y, e.z - f.z);
      if (d > 2.8 && o.stay) break;   // (holding a spot - a hole being dug: what backs off is let go)
      // a fight with monsters is with the one at the throat: another one closer that bites (a spider, a zombie) is the one now - a
      // skeleton that backs off while shooting was chased for nine seconds with a spider and a zombie at the back (20 to 4)
      if (hostile && k % 2 === 1) {
        const other = foesNear(5).find((q) => q.e !== e && MELEE_T.test(q.e.type) && q.d < 2.6);
        if (other && (!MELEE_T.test(e.type) || other.d < d - 1)) break;
      }
      // (a monster that keeps out of reach - backing off, shooting - is not run after for more than four seconds)
      if (hostile) { if (d > 2.8) { if (++chase > 20) break; } else chase = 0; }
      if (d > 2.8) {
        // (not closing in - a tree, a bush, a step in the way of a fleeing cow: round it on a path)
        if (d < best - 0.4) { best = d; slow = 0; } else if (++slow >= 3) { slow = 0; best = Infinity; stopKeys(); if (!(await goToEntity(e, 2.6))) break; continue; }
        K.lookAt(e.x, e.y + 0.8, e.z);
        const [fx, fy, fz] = feet(), r = (K.yaw() * Math.PI) / 180, ax = Math.floor(f.x - Math.sin(r) * 0.8), az = Math.floor(f.z + Math.cos(r) * 0.8);
        // (the cell ahead: lava or fire in it or under it, or a drop of more than 2 - a pig hunt walked into a lava pool)
        const hazard = ((fAt(ax, fy, az) | fAt(ax, fy - 1, az) | fAt(ax, fy + 1, az)) & (F_LAVA | F_DANGER)) || (!(fAt(ax, fy - 1, az) & (F_FLOOR | F_WATER)) && !(fAt(ax, fy - 2, az) & (F_FLOOR | F_WATER)) && !(fAt(ax, fy - 3, az) & F_FLOOR));
        if (hazard) { stopKeys(); slow = 0; best = Infinity; if (!(await goToEntity(e, 2.6))) break; continue; }
        K.controls.forward = true; K.controls.sprint = true;
        if ((fAt(ax, fy, az) & F_SOLID) && (fAt(ax, fy + 1, az) & F_PASS) && (fAt(fx, fy + 2, fz) & F_PASS)) { K.controls.jump = true; await K.ticks(2); K.controls.jump = false; }   // a step up: jump it
        await K.ticks(4); stopKeys(); continue;
      }
      stopKeys();
      // a critical hit (x1.5): jump and hit on the way down; not in water, with room over the head, not at a creeper (hit and away)
      const [fx, fy, fz] = feet();
      // (not the first blow on one that is already at the throat: that one lands now - its knock-back keeps its bite off - and the
      // crits come after)
      const crit = !/creeper/.test(e.type) && !(hits === 0 && d < 2.2 && HOSTILE.test(e.type)) && !(fAt(fx, fy, fz) & F_WATER) && (fAt(fx, fy + 2, fz) & F_PASS) !== 0 && (fAt(fx, fy - 1, fz) & F_FLOOR) !== 0;
      if (crit) { K.controls.jump = true; await K.ticks(1); K.controls.jump = false; await K.ticks(6); if (!K.all().includes(e)) break; K.lookAt(e.x, e.y + 0.8, e.z); }
      if (process.env.LAB_GOAL_DEBUG) log(`fight ${sh(e.type)} at ${hyp(e.x - K.feet().x, e.y - K.feet().y, e.z - K.feet().z).toFixed(1)}${crit ? ' (crit)' : ''} with ${sh(nm(K.inv.slots[K.inv.selected] ?? {}) || 'hand')}, health ${K.attrs().health}`);
      await K.hit(e, 'attack', true); hits++;   // (the weapon was checked with the server by grab, before the fight)
      await K.ticks(crit ? 3 : 10);   // a mob takes no damage for 10 ticks after a hit: one hit per 10-11 ticks, no wasted swings
    }
    stopKeys();
    return !K.all().includes(e);
  }

  // ---------------- stations: a crafting table / furnace in reach (one known nearby, else set down the one carried) ----------------
  const placed = new Map();   // station -> [x, y, z] this player set down (picked up again later)
  // a flat open place for a 4x5 portal frame near here: [x, y, z, axis] (frame bottom at y, on the ground)
  function portalSite() {
    const [x0, y0, z0] = feet();
    for (let r = 2; r <= 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const dy of [0, -1, 1, 2]) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = x0 + dx, y = y0 + dy, z = z0 + dz;
      for (const [ax, az, name] of [[1, 0, 'x'], [0, 1, 'z']]) {
        let ok = true;
        for (let u = -1; u <= 2 && ok; u++) for (let h = 0; h <= 4 && ok; h++) { const b = B(x + ax * u, y + h, z + az * u); if (!b || solid(b) || isWater(b) || DANGER.test(b.name)) ok = false; }
        for (let u = 0; u <= 1 && ok; u++) if (!floorOk(B(x + ax * u, y - 1, z + az * u))) ok = false;
        // not where the player stands; and a spot to build it from, two out in front
        if (ok && [-1, 0, 1, 2].some((u) => x + ax * u === x0 && z + az * u === z0)) ok = false;
        if (ok && !standable(x + ax + az * 2, y, z + az + ax * 2)) ok = false;
        if (ok) return [x, y, z, name];
      }
    }
    return null;
  }
  // a free cell with a floor, in reach and in plain view, not where the player stands: where a block can be set down
  const REPLACEABLE = /^minecraft:(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|snow_layer|deadbush|short_dry_grass|tall_dry_grass|seagrass|leaf_litter|vine|glow_lichen)$/;
  const CLICKY = /chest|barrel|shulker_box|furnace|smoker|crafting_table|door|trapdoor|fence_gate|bed$|lectern|anvil|enchanting_table|brewing_stand|hopper|dispenser|dropper|loom|grindstone|cartography|smithing|stonecutter|beacon|jukebox|noteblock|lever|button|cake|composter|campfire|bell|vault|crafter|decorated_pot/;
  function spotBeside() {
    const [x, y, z] = feet(), e = eye(), out = [];
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -2; dy <= 1; dy++) {
      if (!dx && !dz) continue;
      const cx = x + dx, cy = y + dy, cz = z + dz, b = B(cx, cy, cz), u = B(cx, cy - 1, cz);
      if (!b || solid(b) || isWater(b) || DANGER.test(b.name) || !floorOk(u)) continue;
      if (!REPLACEABLE.test(b.name)) continue;   // (a torch, a flower pot, a rail there: a block does not go in)
      if (CLICKY.test(u.name)) continue;   // (a click on a chest, a barrel, a door opens it: nothing is set down on top)
      const d = hyp(cx + 0.5 - e.x, cy - e.y, cz + 0.5 - e.z);   // the top face of the floor block is what gets clicked
      // (not into the player's own box, with a margin: the server's idea of where the player stands can be a tenth off, and a
      // block set into the player there was taken back - and the table with it)
      if (d > 4.3 || (Math.abs(K.feet().x - (cx + 0.5)) < 0.95 && Math.abs(K.feet().z - (cz + 0.5)) < 0.95 && cy + 1 > K.feet().y && cy < K.feet().y + 1.8)) continue;
      if (!clearTo([e.x, e.y, e.z], cx, cy - 1, cz)) continue;
      out.push([d + (dy ? 0.5 : 0), cx, cy, cz]);
    }
    out.sort((p, q) => p[0] - q[0]);
    return out.length ? out[0].slice(1) : null;
  }
  async function stationAt(kind) {
    const re = kind === 'furnace' ? /^minecraft:(lit_)?furnace$/ : /^minecraft:crafting_table$/;
    const h = known((b) => re.test(b.name), { max: 6, radius: 12, fair: false }).find((q) => !isBad(q));
    if (h) return [h.x, h.y, h.z];
    if (cnt(kind) < 1) { log(`no ${kind} carried or near`); return null; }
    for (let tries = 0; tries < 3; tries++) {
      let s = spotBeside();
      if (!s && !stayPut) {   // hemmed in (a tree, a tunnel): a few steps to open ground
        const [x, , z] = feet();
        await travel((a, b, c) => { const q = [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dz]) => standable(a + dx, b, c + dz) && floorOk(B(a + dx, b - 1, c + dz))); return q && (a !== x || c !== z); }, () => 1, { legs: 1, radius: 8 });
        s = spotBeside();
      }
      if (!s) {   // still hemmed in (leaves, a narrow tunnel): clear a cell beside at foot level to set it in
        const [x, y, z] = feet();
        const c = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [x + dx, y, z + dz]).find((q) => (fAt(...q) & F_SOLID) && !(fAt(...q) & F_UNBREAK) && (fAt(q[0], q[1] - 1, q[2]) & F_FLOOR) && !(fAt(q[0], q[1] + 1, q[2]) & F_WET));
        if (c && (await breakAt(...c))) s = spotBeside();
      }
      if (!s) { log(`no free spot beside me for the ${kind}`); return null; }
      await grab(kind, 'place');
      stopKeys(); for (let k = 0; k < 10 && K.moving?.(); k++) await K.ticks(1);   // (still: a slide after walking moves the box into the spot)
      K.lookAt(s[0] + 0.5, s[1], s[2] + 0.5); await K.ticks(2);
      const had = cnt(kind);
      await K.act('useon', [S(s[0]), S(s[1] - 1), S(s[2]), 'up']);
      await until(() => re.test(bname(...s)));
      if (!re.test(bname(...s))) await until(() => re.test(bname(...s)), 40);   // (a late answer, a lag spike: 37 ticks at 20x once)
      if (re.test(bname(...s))) { placed.set(kind, s); return s; }
      log(`the ${kind} did not go down at ${s.join(' ')} (there: ${sh(bname(...s))}, under: ${sh(bname(s[0], s[1] - 1, s[2]))})`);
      // gone from the hand all the same (set down and taken back: it drops): picked up again
      await K.sync(); if (cnt(kind) < had) await collect({ x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 }, 4, new RegExp(kind));
      if (!cnt(kind)) { const h = known((b) => re.test(b.name), { max: 1, radius: 6, fair: false })[0]; if (h) return [h.x, h.y, h.z]; }
      const f = K.feet(); K.controls.back = true; await K.ticks(4); K.controls.back = false; await K.ticks(2);   // step back and try again
      if (hyp(K.feet().x - f.x, K.feet().z - f.z) < 0.1) { K.controls.left = true; await K.ticks(4); K.controls.left = false; }
    }
    return null;
  }
  async function pickUp(kind) {   // break the station this player set down and take it along
    const s = placed.get(kind); if (!s) return;
    placed.delete(kind);
    if (!/crafting_table|furnace/.test(bname(...s))) return;
    if (kind === 'furnace' && !bestTool({ kind: 'pickaxe', tier: 1 })) return;   // a furnace breaks into nothing by hand: leave it
    if (!(await goToBlock(...s))) return;
    await breakAt(...s);
    await collect({ x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 }, 4, new RegExp(kind));
  }
  // the pickaxe broke (or is lost) down in the mine: a stone one on the spot, like a person who carries the table, from the
  // cobblestone dug on the way and a stick (made from planks or a log carried); false when something for it is missing
  async function newPickaxe() {
    if (bestTool({ kind: 'pickaxe', tier: 1 })) return true;
    if (cnt('cobblestone') + cnt('cobbled_deepslate') + cnt('blackstone') < 3) return false;
    const planksN = () => [...invMap()].filter(([k]) => /_planks$/.test(k)).reduce((a, [, v]) => a + v, 0);
    const needPlanks = (cnt('stick') >= 2 ? 0 : 2) + (cnt('crafting_table') || known((b) => b.name === 'minecraft:crafting_table', { max: 1, radius: 12, fair: false }).length ? 0 : 4);
    if (planksN() < needPlanks) {   // planks from a log carried
      const lg = [...invMap()].find(([k]) => /_(log|stem)$/.test(k));
      if (!lg) return false;
      const sp = /^(\w+?)_(log|stem)$/.exec(lg[0])[1].replace(/^stripped_/, '');
      await closeScreen(); await K.act('craft', [`${sp}_planks`, S(Math.min(lg[1], Math.ceil((needPlanks - planksN()) / 4)))]); await K.sync();
      if (planksN() < needPlanks) return false;
    }
    if (cnt('stick') < 2) { await closeScreen(); await K.act('craft', ['stick', '1']); await K.sync(); if (cnt('stick') < 2) return false; }
    if (!cnt('crafting_table') && !known((b) => b.name === 'minecraft:crafting_table', { max: 1, radius: 12, fair: false }).length) { await closeScreen(); await K.act('craft', ['crafting_table', '1']); await K.sync(); }
    if (!(await openStation('crafting_table'))) return false;
    await K.act('craft', ['stone_pickaxe', '1']); await K.sync(); await closeScreen();
    await pickUp('crafting_table');
    const ok = !!bestTool({ kind: 'pickaxe', tier: 1 });
    log(ok ? 'the pickaxe broke: made a new stone one here' : 'the pickaxe broke: could not make a new one here');
    return ok;
  }
  // a sword made on the spot from what is carried (planks or a log, a stick, cobblestone for a stone one): shut in a hole for the
  // night, its first minute gives the run a weapon - and with it, well and fed, the run goes on - instead of eight minutes of
  // waiting bare-handed (the table set into the wall beside, then taken along again)
  async function swordHere() {
    if (armed()) return true;
    const planksN = () => [...invMap()].filter(([k]) => /_planks$/.test(k)).reduce((a, [, v]) => a + v, 0);
    const stone = cnt('cobblestone') + cnt('cobbled_deepslate') + cnt('blackstone') >= 2, kind = stone ? 'stone_sword' : 'wooden_sword';
    const table = () => cnt('crafting_table') > 0 || known((b) => b.name === 'minecraft:crafting_table', { max: 1, radius: 4, fair: false }).length > 0;
    const needPlanks = (stone ? 0 : 2) + (cnt('stick') >= 1 ? 0 : 2) + (table() ? 0 : 4);
    if (planksN() < needPlanks) {
      const lg = [...invMap()].find(([k]) => /_(log|stem)$/.test(k));
      if (!lg) return false;
      const sp = /^(\w+?)_(log|stem)$/.exec(lg[0])[1].replace(/^stripped_/, '');
      await closeScreen(); await K.act('craft', [`${sp}_planks`, S(Math.min(lg[1], Math.ceil((needPlanks - planksN()) / 4)))]); await K.sync();
      if (planksN() < needPlanks) return false;
    }
    if (cnt('stick') < 1) { await closeScreen(); await K.act('craft', ['stick', '1']); await K.sync(); if (cnt('stick') < 1) return false; }
    if (!table()) { await closeScreen(); await K.act('craft', ['crafting_table', '1']); await K.sync(); }
    stayPut = true;
    try { if (!(await openStation('crafting_table'))) return false; } finally { stayPut = false; }
    await K.act('craft', [kind, '1']); await K.sync(); await closeScreen();
    stayPut = true; try { await pickUp('crafting_table'); } finally { stayPut = false; }
    const ok = armed();
    log(ok ? `a ${sh(kind).replace('_', ' ')} made here in the hole` : `could not make a ${sh(kind).replace('_', ' ')} here`);
    return ok;
  }
  let stayPut = false;   // (in a hole for the night: a station goes into the wall beside, no walking out to open ground for it)
  let lastStation = null;   // where the station last opened stands
  // one that would not open or could not be reached (behind a ruin's wall, in a village house): not that one again; the next one
  // known, or the one carried set down (the run stopped at "no crafting table to use" with a table in the bag)
  const badStation = new Map();   // "x,y,z" -> game time it failed (tried again after a minute: a screen that opened late)
  const isBad = (q) => { const t = badStation.get(`${q.x},${q.y},${q.z}`); return t !== undefined && gnow() - t < 60000; };
  async function openStation(kind, again = false) {
    const want = kind === 'furnace' ? /furnace/ : /workbench/;
    if (want.test(K.screen())) return true;
    const s = await stationAt(kind); if (!s) return false;
    lastStation = s;
    const fail = (why) => { log(why); badStation.set(s.join(), gnow()); if (placed.get(kind)?.join() === s.join()) placed.delete(kind); return again ? false : openStation(kind, true); };
    if (!(await goToBlock(...s))) return fail(`could not get to the ${kind} at ${s.join(' ')}`);
    await emptyHand();
    await K.act('open', s.map(S));
    if (!want.test(K.screen())) return fail(`the ${kind} at ${s.join(' ')} did not open (screen: ${K.screen() || 'none'})`);
    return true;
  }
  const closeScreen = async () => { if (K.screen()) await K.act('close', []); };

  // ---------------- the furnace working while the player does something else ----------------
  const GATHER = new Set(['mine', 'kill', 'milk', 'shear', 'scoop', 'bottle', 'fish', 'eggs', 'pickup', 'loot']);   // steps that use no furnace output
  let oven = null;   // { at, item, n, before, fuel }: a furnace left cooking
  const slotOfItem = (r) => K.inv.slots.findIndex((it) => it?.network_id && r.test(sh(nm(it))));
  const fuelOf = (f) => new RegExp(`^(${f}|coal|charcoal|[a-z_]+_planks|[a-z_]+_log)$`);
  // with the furnace screen open: until n are cooked (more fuel when it runs out). 'done', 'dead', or 'left' (walked off from it and
  // not back: it cooks on by itself). A monster coming meanwhile: the screen shut, it fought or kept away from, then back to the
  // furnace (a race lost three players in one night standing at the furnace with its screen open while a creeper walked up, a
  // zombie, a skeleton's arrows - and the step waited on over the dead body for twenty seconds more)
  async function waitOven(n, fuelRe, at = lastStation) {
    const box = () => K.box()?.slots ?? [];
    let away = 0;
    for (let t = 0; t < n * 210 + 60 && (box()[2]?.count ?? 0) < n; t++) {
      await K.ticks(1);
      if (K.dead()) return 'dead';
      if (t % 5 === 4) {
        const tp = threatPlan();
        if (tp) {
          const q = foesNear(20)[0];
          log(`at the furnace: ${tp.act === 'fight' ? `${sh(tp.e.type)} ${q ? q.d.toFixed(0) + ' blocks off' : 'here'}, at it` : tp.why} (it cooks meanwhile)`);
          await closeScreen(); await danger();
          if (K.dead()) return 'dead';
          if (++away > 4 || !at || !/furnace/.test(bname(...at)) || !(await goToBlock(...at))) return 'left';
          await emptyHand(); await K.act('open', at.map(S));
          if (!/furnace/.test(K.screen())) return 'left';
          await K.sync(); continue;
        }
      }
      if (t % 40 === 39 && !box()[1]?.network_id && (box()[0]?.count ?? 0) > 0) { const fi = slotOfItem(fuelRe); if (fi >= 0) await K.act('move', [S(fi), 'box:1', '1']); }
      if (t % 100 === 99 && !box()[0]?.network_id) break;   // nothing left to cook
    }
    return 'done';
  }
  // back to the furnace left cooking, wait for the rest, take it all out
  async function finishOven() {
    const o = oven; if (!o) return true;
    oven = null;
    if (!/furnace/.test(bname(...o.at))) { log(`the furnace at ${o.at.join(' ')} is gone`); return false; }
    log(`back to the furnace for the ${o.item}`);
    if (!(await goToBlock(...o.at))) { log(`could not get back to the furnace at ${o.at.join(' ')}`); return false; }
    await emptyHand();
    await K.act('open', o.at.map(S));
    if (!/furnace/.test(K.screen())) return false;
    await K.sync();
    const w = await waitOven(o.n, o.fuel, o.at);
    if (w === 'left' && (o.tries = (o.tries ?? 0) + 1) < 3) { oven = o; return false; }   // (driven off it again: fetched later)
    if (w === 'dead') return false;
    if (K.box()?.slots?.[2]?.network_id) await K.act('quick', ['box:2']);
    await K.sync(); await closeScreen();
    placed.set('furnace', o.at);
    return cnt(o.item) > o.before;
  }

  // ---------------- the steps ----------------
  const RUN = {
    async mine(st) {
      // how high a log is over the ground its trunk stands on (a branch in the air: out of reach)
      const trunkHeight = (q) => { let n = 0; while (n < 8 && /_(log|stem|wood|hyphae)$/.test(bname(q.x, q.y - n - 1, q.z))) n++; const g = B(q.x, q.y - n - 1, q.z); return g && solid(g) ? n : 99; };
      const target = cnt(st.item) + st.n, skip = new Set();
      const names = st.anyWood ? '[a-z_]+_log|[a-z_]+_stem' : st.block === 'stone' ? 'stone|cobblestone' : st.block.replace(/^(deepslate_)?(\w+_ore)$/, '$2|deepslate_$2');
      const want = st.anyWood ? /_(log|stem)$/ : new RegExp(`^${st.item}$`);
      let fails = 0, descended = false;
      const wetVein = (q) => SIX.some(([a, b, c]) => fAt(q.x + a, q.y + b, q.z + c) & F_WATER);
      // what was dug but not yet picked up: picked up every few blocks, or before walking off from where it lies, not after each one
      // (a walk to each drop and back was three and a half seconds of every block: 14 stone took a minute)
      let drops = [];
      const have = () => (st.anyWood ? cntRe(/_(log|stem)$/) : cnt(st.item)) + drops.length, goal = st.anyWood ? st.logTarget : target;
      const pickUpDrops = async () => { const ds = drops; drops = []; for (const d of ds) if (K.nearest('item').some((q) => !q.gone && hyp(q.x - d.x, q.y - d.y, q.z - d.z) < 5 && want.test(q.item ?? ''))) await collect(d, 5, want); };
      for (let k = 0; k < st.breaks * 3 + 12; k++) {
        if (have() >= goal) { await pickUpDrops(); if (have() >= goal) break; continue; }
        if (st.req && !bestTool(st.req)) { if (!K.dead()) await pickUpDrops(); return `no ${G.reqName(st.req)} for ${st.block}`; }
        if (late()) { await pickUpDrops(); return 'out of time'; }
        // (a log: within reach from the ground it stands on, wherever that is, up a hill too; anything else: not high over the player)
        // (not one with water beside it: dug from in the water, a block takes five times as long - twenty-five off the ground -
        // and a race's player drowned at its stone, twice)
        const wetBy = (q) => !/clay|sand|gravel|sugar_cane|kelp|seagrass|lily|coral|sponge|prismarine|pickle|dirt|mud/.test(q.block.name) && wetVein(q);
        const h = await findBlock(names, { skip, ok: (q) => ripeOk(sh(q.block.name))(q) && (st.anyWood ? trunkHeight(q) <= 4 : q.y <= feet()[1] + 5) && !lavaNext(q.x, q.y, q.z) && !wetBy(q) && !unreachable(q) });
        if (drops.length && (!h || hyp(h.x - drops[0].x, h.y - drops[0].y, h.z - drops[0].z) > 7)) { await pickUpDrops(); continue; }   // (before walking off)
        // (a death on the way loses the pickaxe: not back down to the ore without one)
        if (st.req && !bestTool(st.req)) { if (!K.dead()) await pickUpDrops(); return `no ${G.reqName(st.req)} for ${st.block}`; }
        // (not found while still stuck under the ground: that is no reason to think there is none - "no tree found" in a cave had the
        // plan give up on wood altogether)
        if (!h) { await pickUpDrops(); return have() >= goal ? true : deepUnder() && surfaceStep(st) ? 'could not get out of the ground to look' : `no ${st.anyWood ? 'tree' : st.block} found`; }
        // an ore known far below (seen on the way down before a death): down to its level first, by the shaft or the stair - walked
        // at from up on the surface, the path finder dug at it through thirty blocks of rock and gave up, seven ores in a row, and
        // the run ended at "could not get to iron_ore"
        if (/_ore$/.test(st.block ?? '') && h.y < feet()[1] - 10 && !descended && bestTool({ kind: 'pickaxe', tier: 1 })) {
          descended = true;
          log(`${st.block} known at ${h.x} ${h.y} ${h.z}, ${feet()[1] - h.y} blocks down: down to it first`);
          await pickUpDrops();
          K.memo.set('goal:stairTop', feet());
          await stairDown(h.y + 1, () => known(blockTest(names), { max: 4, radius: 10, ok: (q) => Math.abs(q.y - feet()[1]) <= 4 && !skip.has(`${q.x},${q.y},${q.z}`) && !unreachable(q) && !lavaNext(q.x, q.y, q.z) }).length > 0);
          continue;
        }
        if (!(await goToBlock(h.x, h.y, h.z))) {
          // (not got to: the rest of that trunk or that face of rock neither, for three minutes - the next try, and the next step's,
          // walked at the same tree for two and a half minutes each, a run ended there)
          skip.add(`${h.x},${h.y},${h.z}`); markUnreachable(h, names);
          if (++fails > 6) { await pickUpDrops(); return `could not get to ${st.block}`; }
          continue;
        }
        if (st.req && !bestTool(st.req)) { if (!K.dead()) await pickUpDrops(); return `no ${G.reqName(st.req)} for ${st.block}`; }
        // (a log by hand is 3 seconds with the back to whatever comes: what gets here meanwhile is dealt with first)
        { const was = feet(); await danger(digSec(h.block)); if (dist3(was, feet()) > 2) continue; }
        // (the head under water: up for air, and this one left if it would be slow from there - see breakAt)
        { const [fx, fy, fz] = feet(); if (isWater(B(fx, fy + 1, fz)) && digSec(h.block) * 25 > 6) { await swimUp(); skip.add(`${h.x},${h.y},${h.z}`); if (++fails > 6) { await pickUpDrops(); return `${st.block} only under water here`; } continue; } }
        if (st.req) { const t = bestTool(st.req); if (t) await grab(t, 'mine'); } else await toolFor(h.x, h.y, h.z);
        await K.act('dig', [S(h.x), S(h.y), S(h.z)]);
        await until(() => B(h.x, h.y, h.z)?.name !== h.block.name, 4, 300);
        if (solid(B(h.x, h.y, h.z)) && B(h.x, h.y, h.z)?.name === h.block.name) { skip.add(`${h.x},${h.y},${h.z}`); if (++fails > 6) { await pickUpDrops(); return `${st.block} would not break`; } continue; }
        drops.push({ x: h.x + 0.5, y: h.y, z: h.z + 0.5 });
        if (drops.length >= 5) await pickUpDrops();
        await reflexes();
      }
      // an ore's vein: the rest of it in reach is dug too, like a person does (the iron tools challenge dug one iron ore for the
      // shovel, walked off from the other four of the vein, and searched the caves for ten minutes for the sword's next two)
      if (/_ore$/.test(st.block ?? '') && !st.anyWood && (st.anyWood ? cntRe(/_(log|stem)$/) >= st.logTarget : cnt(st.item) >= target)) {
        for (let extra = 0; extra < 8 && !late() && !K.dead(); extra++) {
          const e = eye(), q = known(blockTest(names), { max: 4, radius: 6, ok: (h) => !skip.has(`${h.x},${h.y},${h.z}`) && !lavaNext(h.x, h.y, h.z) && !wetVein(h) }).find((h) => hyp(h.x + 0.5 - e.x, h.y + 0.5 - e.y, h.z + 0.5 - e.z) < 4.5 && reachOk(h.x, h.y, h.z, 4.5)(...feet()));
          if (!q) break;
          if (st.req && !bestTool(st.req)) break;
          await danger(digSec(q.block));
          if (st.req) { const t = bestTool(st.req); if (t) await grab(t, 'mine'); }
          await K.act('dig', [S(q.x), S(q.y), S(q.z)]);
          await until(() => B(q.x, q.y, q.z)?.name !== q.block.name, 4, 300);
          if (B(q.x, q.y, q.z)?.name === q.block.name) { skip.add(`${q.x},${q.y},${q.z}`); continue; }
          drops.push({ x: q.x + 0.5, y: q.y, z: q.z + 0.5 });
        }
        if (drops.length) log(`the rest of the vein too: ${drops.length} more`);
        // what the other parts of the run will want of this same ore (the iron tools: eleven iron, asked for two or three at a time):
        // the ones in sight near here, a few steps off, dug now - each search for the next two was minutes of tunnels
        if (st.bonus > 0) {
          const want2 = target + st.bonus;
          let dug2 = 0;
          for (let k2 = 0; k2 < st.bonus * 2 + 4 && cnt(st.item) + drops.length < want2 && !late() && !K.dead(); k2++) {
            if (st.req && !bestTool(st.req)) break;
            const q = known(blockTest(names), { max: 6, radius: 12, ok: (h) => !skip.has(`${h.x},${h.y},${h.z}`) && !lavaNext(h.x, h.y, h.z) && !wetVein(h) && !unreachable(h) && Math.abs(h.y - feet()[1]) <= 6 })[0];
            if (!q) break;
            if (!(await goToBlock(q.x, q.y, q.z))) { skip.add(`${q.x},${q.y},${q.z}`); markUnreachable(q, names); continue; }
            await danger(digSec(q.block));
            if (st.req) { const t = bestTool(st.req); if (t) await grab(t, 'mine'); }
            await K.act('dig', [S(q.x), S(q.y), S(q.z)]);
            await until(() => B(q.x, q.y, q.z)?.name !== q.block.name, 4, 300);
            if (B(q.x, q.y, q.z)?.name === q.block.name) { skip.add(`${q.x},${q.y},${q.z}`); continue; }
            drops.push({ x: q.x + 0.5, y: q.y, z: q.z + 0.5 }); dug2++;
            if (drops.length >= 5 && hyp(q.x - drops[0].x, q.z - drops[0].z) > 6) await pickUpDrops();
          }
          if (dug2) log(`and ${dug2} more near here for the rest of the run (${st.bonus} wanted)`);
        }
      }
      await pickUpDrops();
      return (st.anyWood ? cntRe(/_(log|stem)$/) >= st.logTarget : cnt(st.item) >= target) ? true : `got ${cnt(st.item)} of ${target} ${st.item}`;
    },
    async craft(st) {
      let item = st.item, times = st.times;
      if (st.anyWood && /_planks$/.test(item)) {   // planks from whichever logs are carried
        // (stripped ones too: a stripped log makes the same planks - a race ended at "could not make planks" with three of them)
        const m = invMap(), logs = [...m].filter(([k]) => /_(log|stem|wood|hyphae)$/.test(k)).sort((a, b) => b[1] - a[1]);
        let left = times;
        for (const [log, have] of logs) {
          if (left <= 0) break;
          const sp = (/^(\w+?)_(log|wood)$/.exec(log)?.[1] ?? /^(\w+?)_(stem|hyphae)$/.exec(log)?.[1])?.replace(/^stripped_/, '');
          const pl = `${sp}_planks`, k2 = Math.min(left, have), before = cnt(pl);
          await K.act('craft', [pl, S(k2)]); await K.sync();
          if (cnt(pl) > before) left -= Math.round((cnt(pl) - before) / 4);
        }
        return left <= 0 ? true : 'could not make planks from the logs carried';
      }
      const before = cnt(item);
      // (a table screen is seconds with the back turned: what is on its way is dealt with first)
      if (st.big) await danger(3);
      if (st.big && !(await openStation('crafting_table'))) return 'no crafting table to use';
      // monsters about (the night, or one in sight) and nothing to fight with: the wooden sword first (two planks and a stick; the
      // plan makes again what it took). Two runs were killed at the table making the pickaxe, the sword next in line
      const unarmed = () => !WEAPONS.slice(0, 13).some((x) => cnt(x) > 0);
      const risky = () => nightNow() || dusk() || foesNear(24).some((q) => MELEE_T.test(q.e.type) || ARCHER_T.test(q.e.type));
      if (st.big && process.env.LAB_WORLD === 'normal' && item !== 'wooden_sword' && unarmed() && risky() && cntRe(/_planks$/) >= 2 && cnt('stick') >= 1 && /workbench/.test(K.screen())) {
        await K.act('craft', ['wooden_sword', '1']); await K.sync(); if (cnt('wooden_sword')) log('monsters about: a wooden sword first');
      }
      // the result slot holds one stack: tools and other unstackable things one craft at a time
      const per = Math.max(1, Math.floor((G.KB.items[item]?.[2] || 64) / Math.max(1, st.count / times)));
      let per2 = per;   // a craft that made nothing is tried again smaller (fewer at once: less of one kind of plank needed per cell)
      for (let left = times, tries = 0; left > 0 && tries < times + 3; tries++) {
        // one of them at the table: the screen shut and it dealt with, then on
        if (foesNear(5).some((q) => MELEE_T.test(q.e.type) || /creeper/.test(q.e.type))) { await closeScreen(); await danger(); if (st.big && !(await openStation('crafting_table'))) return 'no crafting table to use'; }
        const k = Math.min(left, per2), b0 = cnt(item);
        await K.act('craft', [item, S(k)]); await K.sync();
        if (cnt(item) > b0) left -= k;
        else { per2 = Math.max(1, Math.floor(k / 2)); await closeScreen(); await K.sync(); if (st.big && !(await openStation('crafting_table'))) return 'no crafting table to use'; }
      }
      // at the table with nothing to fight with: a wooden sword while here (two planks and a stick, a second of work; in a world with
      // monsters the run is lost without one). The plan counts again from what is carried, so what it used is made again if needed
      if (cnt(item) > before && st.big && process.env.LAB_WORLD === 'normal' && item !== 'wooden_sword' && !WEAPONS.slice(0, 13).some((x) => cnt(x) > 0)) {
        const planks = [...invMap()].filter(([k]) => /_planks$/.test(k)).reduce((a, [, v]) => a + v, 0);
        if (planks >= 2 && cnt('stick') >= 1 && /workbench/.test(K.screen())) { await K.act('craft', ['wooden_sword', '1']); await K.sync(); if (cnt('wooden_sword')) log('a wooden sword while at the table'); }
      }
      return cnt(item) > before ? true : `craft ${item} did not work (${[...invMap()].map(([k, v]) => k + '*' + v).join(' ')})`;
    },
    async smelt(st) {
      if (oven) { await finishOven(); if (oven) return 'the furnace is still cooking the last lot (driven off it)'; }   // one furnace: what is in it comes out first
      const before = cnt(st.item);
      if (!(await openStation('furnace'))) return 'no furnace to use';
      const box = () => K.box()?.slots ?? [];
      await K.sync();
      const inRe = st.input.startsWith('#') ? new RegExp(`^(${G.TAG(st.input.slice(1)).join('|')})$`) : new RegExp(`^${st.input}$`);   // a tag: any of its items
      let si = slotOfItem(inRe); if (si < 0) { await closeScreen(); return `no ${st.input} to smelt`; }
      await K.act('move', [S(si), 'box:0', S(Math.min(st.n, K.inv.slots[si].count))]);
      const fuelRe = fuelOf(st.fuel);
      if (!box()[1]?.network_id) { const fi = slotOfItem(fuelRe); if (fi >= 0) await K.act('move', [S(fi), 'box:1', S(Math.min(K.inv.slots[fi].count, st.fueln + 1))]); }
      // the furnace cooks by itself (10 s an item): when the next step does not need what comes out of it, go and do that meanwhile
      // and take the output later (before a step that needs it, or at the end)
      const next = st.next;
      if (next && st.n * 10 >= 15 && GATHER.has(next.do) && lastStation) {
        oven = { at: lastStation, item: st.item, n: st.n, before, fuel: fuelRe };
        log(`the furnace cooks ${st.n} ${st.input} by itself: meanwhile ${G.describe(next)}`);
        await closeScreen();
        return true;
      }
      const at = lastStation, w = await waitOven(st.n, fuelRe, at);
      if (w === 'dead') return 'died at the furnace';
      // (driven off and not back: it cooks on by itself, fetched before a step that needs it - as if left on purpose)
      if (w === 'left' && at) { oven = { at, item: st.item, n: st.n, before, fuel: fuelRe, tries: 1 }; log(`the furnace at ${at.join(' ')} left cooking: fetched later`); return true; }
      if (box()[2]?.network_id) await K.act('quick', ['box:2']);
      await K.sync(); await closeScreen();
      return cnt(st.item) > before ? true : `${st.input} did not smelt`;
    },
    async kill(st) {
      const target = cnt(st.item) + st.n;
      for (let k = 0; k < st.kills * 3 + 6 && cnt(st.item) < target; k++) {
        let e = mobs(st.mob)[0];
        if (!e) { await exploreSurface(() => !!mobs(st.mob)[0], st.mob, 8); e = mobs(st.mob)[0]; }
        if (!e) return `no ${st.mob} found`;
        if (!(SPACED(e) && hyp(e.x - K.feet().x, e.z - K.feet().z) < 16 && sees(e)) && !(await goToEntity(e, HOSTILE.test(e.type) ? 5.5 : 2.6))) { e.gone = true; continue; }
        const at = { x: e.x, y: e.y, z: e.z };
        await fightOne(e, 40);
        await collect(at, 6);
      }
      return cnt(st.item) >= target ? true : `got ${cnt(st.item)} of ${target} ${st.item}`;
    },
    async milk(st) {
      const target = cnt(st.item) + st.n;
      for (let k = 0; k < st.n * 3 + 3 && cnt(st.item) < target; k++) {
        let e = st.mobs.flatMap(mobs)[0];
        if (!e) { await exploreSurface(() => !!st.mobs.flatMap(mobs)[0], st.mobs[0], 8); e = st.mobs.flatMap(mobs)[0]; }
        if (!e) return `no ${st.mobs[0]} found`;
        if (!(await goToEntity(e, 2.4))) { e.gone = true; continue; }
        await grab(st.use, 'milk');
        await K.hit(e, 'interact'); await K.ticks(6); await K.sync();
      }
      return cnt(st.item) >= target ? true : `milked ${cnt(st.item)} of ${target}`;
    },
    async shear(st) {
      const target = cnt(st.item) + st.n;
      const done = new Set();
      for (let k = 0; k < st.n * 3 + 4 && cnt(st.item) < target; k++) {
        let e = st.mobs.flatMap(mobs).find((q) => !done.has(q.id));
        if (!e) { await exploreSurface(() => !!st.mobs.flatMap(mobs).find((q) => !done.has(q.id)), st.mobs[0], 8); e = st.mobs.flatMap(mobs).find((q) => !done.has(q.id)); }
        if (!e) return `no ${st.mobs[0]} found`;
        if (!(await goToEntity(e, 2.4))) { done.add(e.id); continue; }
        await grab('shears', 'shear'); await K.hit(e, 'interact'); done.add(e.id);
        await collect({ x: e.x, y: e.y, z: e.z }, 5, /wool/);
      }
      return cnt(st.item) >= target ? true : `sheared ${cnt(st.item)} of ${target}`;
    },
    async scoop(st) {
      const target = cnt(st.item) + st.n;
      const test = st.block === 'water' ? 'water' : st.block === 'lava' ? 'lava' : st.block;
      for (let k = 0; k < st.n * 3 + 3 && cnt(st.item) < target; k++) {
        const h = await findBlock(test, { ok: (q) => (q.block.states?.liquid_depth ?? 0) === 0 });
        if (!h) return `no ${st.block} found`;
        if (!(await goToBlock(h.x, h.y, h.z, 4))) continue;
        await grab(st.use, 'scoop');
        await K.act('useon', [S(h.x), S(h.y), S(h.z), 'up']); await K.ticks(4); await K.sync();
      }
      return cnt(st.item) >= target ? true : `filled ${cnt(st.item)} of ${target}`;
    },
    async bottle(st) { return RUN.scoop(st); },
    async eggs(st) {
      const target = cnt('egg') + st.n, t0 = gnow();
      let e = mobs('chicken')[0];
      if (!e) { await exploreSurface(() => !!mobs('chicken')[0], 'chicken', 8); e = mobs('chicken')[0]; }
      if (!e) return 'no chicken found';
      log('waiting by the chickens for an egg');
      while (cnt('egg') < target && gnow() - t0 < 12 * 60 * 1000 && !late()) {
        anchor = null;   // (waiting on the chickens is the job: no "no headway")
        const egg = K.nearest('item').find((q) => /egg$/.test(q.item ?? '') && hyp(q.x - K.feet().x, q.z - K.feet().z) < 24);
        if (egg) await collect({ x: egg.x, y: egg.y, z: egg.z }, 2, /egg$/);
        else { const c = mobs('chicken')[0]; if (c && hyp(c.x - K.feet().x, c.z - K.feet().z) > 6) await goToEntity(c, 3); await K.ticks(40); }
        await reflexes();
      }
      return cntRe(/egg$/) >= target ? true : 'no egg came';
    },
    async fish(st) {
      const target = cnt(st.item) + st.n;
      const h = await findBlock('water', { ok: (q) => (q.block.states?.liquid_depth ?? 0) === 0 && isWater(B(q.x, q.y - 1, q.z)) });
      if (!h) return 'no water found';
      if (!(await goToBlock(h.x, h.y, h.z, 3.5))) return 'could not get to the water';
      await grab('fishing_rod', 'fish');
      K.lookAt(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      for (let k = 0; k < st.n * 10 && cnt(st.item) < target; k++) { await K.act('fish', ['30']); await collect(null, 4); }
      return cnt(st.item) >= target ? true : `caught ${cnt(st.item)} of ${target}`;
    },
    async farm(st) {
      const target = cnt(st.item) + st.n;
      const first = await findBlock('water|flowing_water', { legs: 8 });
      // soil within 4 of some water in sight, at its level or one below (moist), else one above (dry: slower), open above
      const soilAt = (w, ys, r = 4) => { const out = []; for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (const y of ys) { const x = w.x + dx, z = w.z + dz, soil = B(x, y, z), above = B(x, y + 1, z); if (/^minecraft:(dirt|grass_block|farmland)$/.test(soil?.name ?? '') && above && !solid(above) && !isWater(above)) out.push([x, y, z]); } return out; };
      let water = first, spots = [];
      if (first) {
        const waters = [first, ...known(/^minecraft:water$/, { max: 40, radius: 48 }).filter((h, i, all) => all.findIndex((q) => hyp(q.x - h.x, q.z - h.z) < 6) === i)].slice(0, 8);
        for (const ys of [[0, -1], [1]]) { for (const w of waters) { const sp = soilAt(w, ys.map((d) => w.y + d)); if (sp.length >= Math.min(3, st.plants)) { water = w; spots = sp; break; } } if (spots.length) break; }
        if (!spots.length && process.env.LAB_GOAL_DEBUG) log(`farm: waters ${waters.map((w) => `${w.x},${w.y},${w.z}:${sh(w.block?.name)}`).join(' ')}; around the first: ${[-1, 0, 1].map((d) => sh(bname(first.x + 1, first.y + d, first.z))).join('/')}`);
      }
      if (!spots.length) {   // no soil by water (or no water): dry farmland right here; the crop still grows, only slower
        const [fx, fy, fz] = feet();
        water = { x: fx, y: fy, z: fz };
        spots = soilAt(water, [fy - 1, fy, fy - 2], 6);
        if (!spots.length) return first ? 'nowhere to plant by the water or here' : 'no water found and no soil here';
        log(`farm: no soil by water: planting on dry ground here (slower)`);
      } else if (!(await goToBlock(water.x, water.y, water.z, 5))) return 'could not get to the water';
      spots.sort((p, q) => hyp(p[0] - water.x, p[2] - water.z) - hyp(q[0] - water.x, q[2] - water.z));
      const beds = [];
      for (const [x, y, z] of spots) {
        if (beds.length >= st.plants || cnt(st.seed) < 1) break;
        if (!(await goToBlock(x, y, z, 4))) continue;
        if (!/farmland/.test(bname(x, y, z))) { const hoe = bestTool({ kind: 'hoe', tier: 1 }); if (!hoe) return 'no hoe'; await grab(hoe, 'till'); await K.act('useon', [S(x), S(y), S(z), 'up']); await K.ticks(4); }
        if (!/farmland/.test(bname(x, y, z))) continue;
        await grab(st.seed, 'plant'); await K.act('useon', [S(x), S(y), S(z), 'up']); await K.ticks(4);
        if (new RegExp(`:${st.crop}$`).test(bname(x, y + 1, z))) beds.push([x, y + 1, z]);
      }
      if (!beds.length) return 'nowhere to plant by the water';
      log(`${beds.length} ${st.crop} planted: waiting for them to grow`);
      const ripe = (b) => (B(...b)?.states?.growth ?? 0) >= 7;
      const t0 = gnow(), wait = (Number(process.env.LAB_FARM_MINUTES) || 40) * 60000;
      while (gnow() - t0 < wait && !late() && beds.filter(ripe).length < Math.min(beds.length, Math.ceil(st.n / 1))) {
        anchor = null;   // (waiting on the crop is the job)
        if (cnt('bone_meal') > 0) { const b = beds.find((q) => !ripe(q)); if (b && (await goToBlock(...b, 4))) { await grab('bone_meal', 'grow'); await K.act('useon', [S(b[0]), S(b[1]), S(b[2]), 'up']); await K.ticks(4); continue; } }
        await K.ticks(100); await reflexes();
      }
      for (const b of beds.filter(ripe)) { if (await goToBlock(...b)) { await K.act('dig', b.map(S)); await collect({ x: b[0] + 0.5, y: b[1], z: b[2] + 0.5 }, 4); } }
      return cnt(st.item) >= target ? true : `harvested ${cnt(st.item)} of ${target}`;
    },
    async loot(st) {   // open the chests / barrels in sight, one after another, and take the item out of them
      const target = cnt(st.item) + st.n;
      for (let k = 0; k < 8 && cnt(st.item) < target; k++) {
        const h = known(/^minecraft:(chest|barrel|trapped_chest)$/, { max: 12, radius: 48 }).find((q) => !looted.has(`${q.x},${q.y},${q.z}`));
        if (!h) return cnt(st.item) > target - st.n ? `took ${cnt(st.item) - (target - st.n)} of ${st.n}` : `no chest found with ${st.item}`;
        looted.add(`${h.x},${h.y},${h.z}`);
        if (!(await goToBlock(h.x, h.y, h.z))) continue;
        await emptyHand();
        await K.act('open', [S(h.x), S(h.y), S(h.z)]);
        if (!K.box()) continue;
        const slots = K.box().slots ?? [];
        for (let i = 0; i < slots.length; i++) if (slots[i]?.network_id && sh(nm(slots[i])) === st.item) await K.act('quick', ['box:' + i]);
        await closeScreen(); await K.sync();
      }
      return cnt(st.item) >= target ? true : `no chest had enough ${st.item}`;
    },
    // the nether: a portal known nearby, else one built here from 10 obsidian and lit; then through it
    async portal(st) {
      if (dimName() === 'nether') return true;
      let h = known(/^minecraft:portal$/, { max: 1, radius: 64, fair: false })[0];
      if (!h) {
        if (cnt('obsidian') < 10) return `a portal takes 10 obsidian (have ${cnt('obsidian')})`;
        if (!cnt('flint_and_steel') && !cnt('fire_charge')) return 'no flint and steel to light it';
        const site = portalSite(); if (!site) return 'no flat open place for a portal';
        log(`building the portal at ${site.slice(0, 3).join(' ')}`);
        await H.M.nether_portal([...site.slice(0, 3).map(S), site[3]]);
        await K.ticks(10);
        h = known(/^minecraft:portal$/, { max: 1, radius: 16, fair: false })[0];
        if (!h) return 'the portal did not light (frame not closed?)';
      }
      // into the lowest portal block (the frame's bottom is a step up), then stand in it
      let [px, py, pz] = [h.x, h.y, h.z];
      while (/portal/.test(bname(px, py - 1, pz))) py--;
      await travel((a, b, c) => a === px && c === pz && b === py, (a, b, c) => hyp(a - px, b - py, c - pz), { radius: 64, legs: 8 });
      for (let t = 0; t < 300 && dimName() !== 'nether'; t++) {   // into the purple and wait (4 s in it)
        const f = K.feet(); const dx = px + 0.5 - f.x, dz = pz + 0.5 - f.z;
        if (hyp(dx, dz) > 0.3) { K.look((Math.atan2(-dx, dz) * 180) / Math.PI, 0); K.controls.forward = true; } else K.controls.forward = false;
        await K.ticks(1);
      }
      stopKeys();
      await K.ticks(40);
      return dimName() === 'nether' ? true : 'went into the portal but nothing happened';
    },
    async pickup(st) {
      const before = cnt(st.item);
      await collect(null, 32, new RegExp(`^${st.item}$`));
      if (cnt(st.item) > before) return true;
      noPickup.add(st.item);
      return `no ${st.item} to pick up`;
    },
  };

  // ---------------- a goal: plan, carry out, plan again when the world disagrees ----------------
  const banned = new Set();   // what was looked for in this `get` and not found: plan around it
  const noPickup = new Set();   // lying about but could not be picked up (in water, on a ledge, taken by someone else): not planned on again
  const looted = new Set();   // chests opened already
  // things found together: when one is not found around here, the others will not be either
  const GROUPS = [['hay_block', 'wheat', 'carrots', 'potatoes', 'beetroot', 'bell', 'composter', 'bed', 'chest', 'barrel', 'lectern', 'smithing_table', 'cartography_table', 'fletching_table', 'loom', 'grindstone', 'stonecutter_block', 'brewing_stand']];
  let lastSplits = [];   // [step, seconds since the start] of the last `get` (rta_ prints them)
  const envNow = () => {
    const f = K.feet();
    const cache = new Map();
    return {
      inventory: (() => {   // what the furnace is cooking counts; what an RTA already got for its other parts is not to be used up
        const m = invMap(); if (oven) m.set(oven.item, (m.get(oven.item) ?? 0) + oven.n);
        for (const [it, k] of reserved) if (m.has(it)) m.set(it, Math.max(0, m.get(it) - k));
        return m;
      })(), dim: dimName(), y: f.y, surfaceY: rtaRun?.start?.y, banned, portalKnown: dimName() === 'overworld' && !!known(/^minecraft:portal$/, { max: 1, radius: 64, fair: false })[0],
      // (not one that would not open or could not be reached: the plan counted on it, the step could not use it - twice, the end)
      stations: new Set([...['crafting_table', 'furnace'].filter((s) => known(new RegExp(`^minecraft:${s === 'furnace' ? '(lit_)?furnace' : s}$`), { max: 6, radius: 12, fair: false }).some((q) => !isBad(q)))]),
      near: (b) => { if (cache.has(b)) return cache.get(b); const h = known(blockTest(b === 'stone' ? 'stone|cobblestone' : b), { max: 1, radius: 96, ok: ripeOk(b) })[0]; const d = h ? h.d : null; cache.set(b, d); return d; },
      mob: (m) => { const e = mobs(m)[0]; return e ? hyp(e.x - f.x, e.y - f.y, e.z - f.z) : null; },
      container: () => { const h = known(/^minecraft:(chest|barrel|trapped_chest)$/, { max: 12, radius: 48 }).find((q) => !looted.has(`${q.x},${q.y},${q.z}`)); return h ? h.d : null; },
      drop: (it) => { if (noPickup.has(it)) return null; const e = K.nearest('item').find((q) => q.item === it && Math.abs(q.y - f.y) < 6 && !q.gone && !inDeathZone(q)); return e ? hyp(e.x - f.x, e.y - f.y, e.z - f.z) : null; },
    };
  };
  const planNow = (item, n) => G.plan(item, n, envNow());
  let reserved = new Map();   // item -> count kept back from planning (the other parts of a challenge)
  async function obtain(item, n, v = 'get', o = {}) {
    const keepBack = reserved; reserved = o.reserve ?? new Map();
    try { return await obtain1(item, n, v, o); } finally { reserved = keepBack; }
  }
  let swordNoted = false, swordFailed = -1e9;
  const swordFirst = (item) => process.env.LAB_WORLD === 'normal' && item !== 'wooden_sword' && !armed() && (nightNow() || dusk() || foesNear(32).some((q) => MELEE_T.test(q.e.type) || ARCHER_T.test(q.e.type)));
  async function obtain1(item, n, v = 'get', o = {}) {
    const t0 = gnow(), budget = (o.minutes ?? 90) * 60 * 1000;
    swordNoted = false;
    banned.clear(); noPickup.clear();
    for (const x of [...(o.avoid ?? []), ...String(process.env.LAB_GOAL_AVOID ?? '').split(',')].filter(Boolean)) banned.add(sh(x));   // avoid=: routes not to take (a run's rules)
    item = sh(item);
    if (!G.KB.items[item]) return { ok: false, why: `no item ${item} (${G.KB.items[item + '_item'] ? 'try ' + item + '_item' : 'see kb.json'})` };
    const goal = cnt(item) + 0 >= n ? 0 : n;
    if (!goal) return { ok: true, steps: 0 };
    let done = 0, replans = 0, last = '', fresh = false;
    const failed = new Map(), splits = [];
    lastSplits = splits;
    while (cnt(item) < n) {
      if (gnow() - t0 > budget || (rtaRun?.deadline && gnow() > rtaRun.deadline)) return { ok: false, why: `out of time (${rtaRun?.deadline ? minutes() : o.minutes ?? 90} min)`, steps: done };
      if (K.dead()) await reflexes();   // (killed in the last step: back first - a plan made from a dead player's bag is no plan)
      await K.sync();
      const p = planNow(item, n);
      if (!p.ok) return { ok: false, why: p.problems.join('; ') || 'no plan', steps: done };
      if ((done === 0 && replans === 0) || fresh || o.verbose) log(`plan for ${n} ${item}: ${p.steps.length} steps, about ${G.mmss(p.sec)}${replans ? ' (planned again)' : ''}`);
      fresh = false;
      let st = p.steps[0];
      if (!st) { if (oven) { await finishOven(); continue; } break; }
      // monsters about (or the night) and nothing to fight with: the wooden sword's steps first (a log or two, planks, a table,
      // sticks: under a minute) - running from a zombie for minutes, or dying at the table, cost more
      let forSword = false;
      if (swordFirst(item) && gnow() - swordFailed > 120000) { const ps = planNow('wooden_sword', 1); if (ps.ok && ps.steps[0] && ps.sec < 90) { if (!swordNoted) { log('monsters about and nothing to fight with: a wooden sword first'); swordNoted = true; } st = ps.steps[0]; p.steps = [st, ...p.steps]; forSword = true; } }
      st.next = p.steps[1];
      if (oven && !GATHER.has(st.do)) {   // the furnace is still cooking: some gathering of the plan that can be done now first, else fetch the output
        const alt = p.steps.find((x) => GATHER.has(x.do) && (!x.req || bestTool(x.req)) && (!x.use || cnt(x.use) >= (/^(milk|scoop|bottle)$/.test(x.do) ? x.n : 1)));
        if (alt) st = alt; else await finishOven();
      }
      // night on the surface: what the plan has underground (ore under the ground, with the pickaxe for it) first, like a
      // speedrunner who spends the night in the mine instead of among the monsters
      if ((nightNow() || dusk()) && skyOver() && !(st.do === 'mine' && deepBlock(st.block))) {
        const alt = p.steps.find((x) => x.do === 'mine' && deepBlock(x.block) && (!x.req || bestTool(x.req)));
        if (alt) { if (alt !== st) log(`night: the mine first (${G.describe(alt)})`); st = alt; }
      }
      // night, down in the mine, and this step is up on the surface (a tree, an animal): with nothing to fight with, or hurt, the
      // night waited out down here, shut in (climbing out into the dark with bare hands is where the runs died); armed and well, up
      // and on with it like a runner (the wait was 8-12 minutes of the race, for one log)
      if (nightNow() && inMine() && surfaceStep(st)) {
        const hp = K.attrs().health ?? 20, food = K.attrs()['player.hunger'] ?? 20;
        if (!armed() || hp < 14 || food < 7 || (!goodSword() && hp < 18)) { log(`night: waiting down here for the morning (next: ${G.describe(st)})`); await shelter(); }
        else log(`night, but armed and well: up for it (next: ${G.describe(st)})`);
      }
      // (animals, trees: not looked for down in the mine - nor from a pit or a cave under a hill, with rock over the head: the path
      // finder walked at trees from a gravel pit 7 blocks down for four minutes)
      if ((inMine() || deepUnder()) && surfaceStep(st)) await toSurface(G.describe(st));
      // (and two over, with ore to dig later in the plan: a wooden sword made at the table, a table set down again, a furnace's fuel -
      // planks the plan did not count - had a runner climb out of the mine for one log, into the night, and die with the iron)
      if (st.do === 'mine' && st.anyWood) st.logTarget = cntRe(/_(log|stem)$/) + st.n + Math.min(6, o.bonus?.get('anyWood') ?? 0) + (p.steps.some((x) => x.do === 'mine' && x.block && deepBlock(x.block)) ? 2 : 0);
      if (st.do === 'mine' && !st.anyWood && o.bonus?.get(st.block)) st.bonus = o.bonus.get(st.block);
      const desc = G.describe(st);
      // a table / furnace set down earlier goes along before walking off to do something else
      if (!(st.do === 'craft' && st.big)) await pickUp('crafting_table');
      if (st.do !== 'smelt' && !oven) await pickUp('furnace');
      log(`${desc}`);
      if (rtaRun?.hud) hud(desc);
      await danger();   // (each step starts with a look round: a craft or a smelt does not watch its back)
      // nothing to eat, and the night coming (or hurt): an animal in sight is taken along now, while it is light
      if (process.env.LAB_WORLD === 'normal' && (((dayTime() ?? 0) >= 10500 && (dayTime() ?? 0) < 12900) || (K.attrs().health ?? 20) < 12) && skyOver() && !FOOD.some((x) => cnt(x) > 0) && gnow() - lastProvision > 120000) { lastProvision = gnow(); await provision(true); }
      let r;
      stepGuard = true; anchor = null; stuckSaid = false; stuckVal = false; stuckAt = 0;
      const deaths0 = K.memo.get('goal:deaths') ?? 0;
      try { r = await RUN[st.do](st); } catch (e) { r = e.message; } finally { stepGuard = false; }
      if (r !== true && stuckSaid) r = `no headway (${r})`;
      await closeScreen().catch(() => {});
      if (r === true) { done++; last = ''; failed.clear(); splits.push([desc, Math.round((gnow() - t0) / 1000)]); split(desc); continue; }   // progress: old failures are forgiven
      log(`step failed: ${r}`);
      if (forSword) { swordFailed = gnow(); continue; }   // (the sword's own step: the goal goes on without it for two minutes)
      if (/^no (\w+) found$/.test(String(r))) {
        const what = /^no (\w+) found$/.exec(r)[1], b = what === 'tree' ? 'oak_log' : st.block ?? what;
        banned.add(b); if (st.mob) banned.add(st.mob); if (st.mobs) for (const m of st.mobs) banned.add(m);
        const grp = GROUPS.find((g) => g.includes(b)); if (grp) for (const x of grp) banned.add(x);   // no village here: none of a village's things either
      }
      // (died during it: the things are gone, the plan is a new one - not a step that failed twice; a run ended at "no stone+
      // pickaxe for iron_ore" one death in)
      if ((K.memo.get('goal:deaths') ?? 0) !== deaths0 || K.dead()) { last = ''; failed.delete(desc); replans++; fresh = true; continue; }
      const f = (failed.get(desc) ?? 0) + 1; failed.set(desc, f);
      if (f >= 3 || (last === desc && /found|no /.test(String(r)))) return { ok: false, why: `${desc}: ${r}`, steps: done };
      last = desc; replans++; fresh = true;
    }
    await closeScreen().catch(() => {}); if (oven) await finishOven(); await pickUp('crafting_table'); await pickUp('furnace');
    return { ok: true, steps: done, sec: Math.round((gnow() - t0) / 1000), splits };
  }

  // ---------------- whole jobs for the generated verbs (mine_<block>, kill_<mob> ...) ----------------
  async function mineBlocks(name, n = 1) {
    const skip = new Set(); let c = 0, fails = 0;
    const row = G.KB.blocks[name], req = row?.[5] && row[5] !== 'hand' ? G.toolReq(row[5]) : null;
    if (req && !bestTool(req)) return { ok: false, why: `${name} gives nothing without a ${G.reqName(req)} (get_${G.TOOLS_FOR(req)[0]})` };
    for (let k = 0; c < n && k < n * 3 + 6; k++) {
      const h = await findBlock(name, { skip, legs: 6, ok: (q) => ripeOk(name)(q) && !lavaNext(q.x, q.y, q.z) });
      if (!h) return c ? { ok: true, n: c } : { ok: false, why: `no ${name} found` };
      if (!(await goToBlock(h.x, h.y, h.z))) { skip.add(`${h.x},${h.y},${h.z}`); if (++fails > 5) break; continue; }
      { const was = feet(); await danger(digSec(h.block)); if (dist3(was, feet()) > 2) continue; }
      if (req) await grab(bestTool(req), 'mine'); else await toolFor(h.x, h.y, h.z);
      await K.act('dig', [S(h.x), S(h.y), S(h.z)]);
      if (B(h.x, h.y, h.z)?.name === h.block.name) { skip.add(`${h.x},${h.y},${h.z}`); if (++fails > 5) break; continue; }
      c++;
      await collect({ x: h.x + 0.5, y: h.y, z: h.z + 0.5 }, 5);
    }
    return c ? { ok: true, n: c } : { ok: false, why: `could not break any ${name}` };
  }
  async function killMobs(type, n = 1) {
    let c = 0;
    for (let k = 0; c < n && k < n * 3 + 4; k++) {
      let e = mobs(type)[0];
      if (!e) { await exploreSurface(() => !!mobs(type)[0], type, 6); e = mobs(type)[0]; }
      if (!e) return c ? { ok: true, n: c } : { ok: false, why: `no ${type} found` };
      if (process.env.LAB_GOAL_DEBUG) log(`kill: to the ${sh(e.type)} at ${hyp(e.x - K.feet().x, e.y - K.feet().y, e.z - K.feet().z).toFixed(1)}, t=${K.tick()}, health ${K.attrs().health}`);
      // (a monster: to within a few blocks only - the last steps are the fight's own, to the edge of the sword's reach; walked right up
      // to 2.6, a zombie had bitten before the first blow)
      // (in sight and near: the fight walks up itself; a path walked at a sprint met a zombie coming the other way inside its bite)
      const inSight = SPACED(e) && hyp(e.x - K.feet().x, e.z - K.feet().z) < 16 && sees(e);
      if (!inSight && !(await goToEntity(e, HOSTILE.test(e.type) ? 5.5 : 2.6))) { e.gone = true; continue; }
      const at = { x: e.x, y: e.y, z: e.z };
      if (process.env.LAB_GOAL_DEBUG) log(`kill: at it, t=${K.tick()}, health ${K.attrs().health}`);
      if (await fightOne(e, 60)) { c++; await collect(at, 6); }
    }
    return c ? { ok: true, n: c } : { ok: false, why: `could not kill a ${type}` };
  }
  function spotAhead() {   // the free spot with a floor right in front (else beside)
    const [x, y, z] = feet(), r = (K.yaw() * Math.PI) / 180, fx = Math.round(-Math.sin(r)), fz = fx ? 0 : Math.round(Math.cos(r));
    const b = B(x + fx, y, z + fz), u = B(x + fx, y - 1, z + fz);
    if (b && !solid(b) && !isWater(b) && floorOk(u)) return [x + fx, y, z + fz];
    return spotBeside();
  }
  async function closeAll() { await closeScreen(); if (oven) await finishOven(); await pickUp('crafting_table'); await pickUp('furnace'); }

  const M = {};
  M.get = async (a) => {   // get <item> [n] [xray] [avoid=a,b]: obtain it from whatever is around, like a speedrunner
    if (a.includes('xray')) K.memo.set('goal:xray', true);
    const item = a[0], n = Number(a.find((x, i) => i > 0 && /^\d+$/.test(x)) ?? 1), avoid = (a.find((x) => x.startsWith('avoid='))?.slice(6) ?? '').split(',').filter(Boolean);
    if (!item) return say('get', 'get <item> [n] [xray] [avoid=block|mob,...]');
    const t0 = gnow();
    const r = await obtain(item, n, 'get', { avoid });
    K.memo.delete('goal:xray');
    const sec = Math.round((gnow() - t0) / 1000);
    return say('get', r.ok ? `got ${n} ${sh(item)} in ${G.mmss(sec)} (${r.steps} steps)` : `could not get ${sh(item)}: ${r.why}`);
  };
  // ---------------- RTA: timed runs, splits, the best run so far, challenges and quests ----------------
  // a run's splits are compared with the best run on this world (LAB_WORLD=normal: kept in .lab/rta-pb.json, or LAB_RTA_PB=<file>);
  // `hud` (or LAB_RTA_HUD=1) shows the timer and the step on the actionbar for whoever watches
  const CH = require('./challenges.cjs');
  let rtaRun = null;
  const fs = require('fs'), path = require('path');
  const pbFile = () => process.env.LAB_RTA_PB || (process.env.LAB_WORLD === 'normal' ? path.join(process.cwd(), '.lab', 'rta-pb.json') : null);
  const pbAll = () => { const f = pbFile(); if (!f) return {}; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  const now = () => Math.round((gnow() - rtaRun.t0) / 1000);
  function split(desc) { if (rtaRun) rtaRun.all.push([desc, now()]); }
  function hud(desc) { if (rtaRun) K.act('cmd', ['title', '@s', 'actionbar', `${rtaRun.name} ${G.mmss(now())} ${desc}`.slice(0, 120)]).catch(() => {}); }
  const short = (d) => d.replace(/ \(.*?\)| from .*$/g, '');
  // run body() as a timed race called `name`: an empty inventory first (unless keep), then the splits, the time and how it compares
  // the ground around loaded (after a teleport, a fresh far-off area is still being generated and sent): the timer starts after it,
  // like a run's timer starts when the world is there
  async function waitWorld(r = 32, ms = 90000, quiet = false) {
    const t0 = Date.now();
    for (;;) {
      const [x, y, z] = feet(); let known = 0, all = 0;
      for (let dx = -r; dx <= r; dx += 8) for (let dz = -r; dz <= r; dz += 8) { if (dx * dx + dz * dz > r * r) continue; all++; if (W.column ? W.column((x + dx) >> 4, (z + dz) >> 4) : B(x + dx, y, z + dz) !== null) known++; }   // a circle, like the view distance
      if (known >= all * 0.95 || Date.now() - t0 > ms) { if (Date.now() - t0 > 2000 && !quiet) log(`waited ${Math.round((Date.now() - t0) / 1000)} s for the ground around to load (${known}/${all})`); return known / all; }
      const [hx, hy, hz] = feet();
      K.controls.jump = isWater(B(hx, hy + 1, hz)) || isWater(B(hx, hy, hz));   // in water meanwhile: swim up for air
      await K.ticks(10);
      if (!quiet) await danger();   // a monster meanwhile: fight it (a run's wait is not a safe zone)
    }
  }
  // set down in water or somewhere it cannot stand (a race spot is picked blind): to the nearest dry ground before the timer starts
  async function toLand() {
    await swimUp();
    const [x, y, z] = feet();
    if (standable(x, y, z) && !(fAt(x, y, z) & F_WATER)) return;
    const ok = (a, b, c) => standable(a, b, c) && !(fAt(a, b, c) & F_WATER) && !(fAt(a, b - 1, c) & F_WATER);
    await travel(ok, () => 1, { radius: 64, legs: 6, nodes: 20000 });
    stopKeys();
    if (!ok(...feet())) log('no dry ground found near the start');
  }
  async function timed(name, a, body) {
    if (process.env.LAB_WORLD === 'normal') { await waitWorld(); stopKeys(); await toLand(); }   // (the flat world is there at once)
    if (process.env.LAB_RTA_SPAWNPOINT === '1') await K.act('cmd', ['spawnpoint', '@s']);   // races: dying brings the player back to its own start, not to the crowded world spawn
    if (!a.includes('keep')) { await K.act('cmd', ['clear', '@s']); await K.ticks(10); }
    if (a.includes('xray')) K.memo.set('goal:xray', true);
    await K.sync();
    K.memo.set('goal:deaths', 0); K.memo.delete('goal:deathTimes'); K.memo.delete('goal:leavesSeen'); K.memo.delete('goal:trail');
    const f = K.feet();
    rtaRun = { name, t0: gnow(), deadline: gnow() + minutes() * 60000, all: [], hud: a.includes('hud') || process.env.LAB_RTA_HUD === '1', start: { x: f.x, y: f.y, z: f.z } };
    K.say(`${name}: start`);
    let r;
    try { r = await body(); } catch (e) { r = { ok: false, why: e.message }; }
    const run = rtaRun; rtaRun = null;
    K.memo.delete('goal:xray');
    const sec = Math.round((gnow() - run.t0) / 1000);
    const key = `${process.env.LAB_SEED ?? '1'}:${name}`, all = pbAll(), pb = all[key];
    const delta = (d, t, i) => { const q = pb?.splits?.[i]?.[0] === d ? pb.splits[i] : pb?.splits?.find((x) => x[0] === d); if (!q) return ''; const x = t - q[1]; return ` (${x > 0 ? '+' : x < 0 ? '-' : '±'}${Math.abs(x)}s)`; };
    if (run.all.length) K.say(`${name} splits: ${run.all.map(([d, t], i) => `${G.mmss(t)} ${short(d)}${delta(d, t, i)}`).join(' | ')}`);
    if (!r.ok) return say(name, `stopped after ${G.mmss(sec)}: ${r.why}`);
    let note = '';
    if (pb?.sec) note = sec < pb.sec ? ` — new best (was ${G.mmss(pb.sec)}, -${pb.sec - sec}s)` : ` — best ${G.mmss(pb.sec)} (+${sec - pb.sec}s)`;
    if (pbFile() && (!pb?.sec || sec < pb.sec)) { all[key] = { sec, splits: run.all, at: new Date().toISOString().slice(0, 16) }; try { fs.mkdirSync(path.dirname(pbFile()), { recursive: true }); fs.writeFileSync(pbFile(), JSON.stringify(all, null, 1) + '\n'); } catch { /* read-only: no record kept */ } }
    if (run.hud) K.act('cmd', ['title', '@s', 'title', `${G.mmss(sec)}`]).catch(() => {});
    return say(name, `done in ${G.mmss(sec)}${r.steps !== undefined ? ` (${r.steps} steps)` : ''}${r.what ? ` (${r.what})` : ''}${note}`);
  }
  const minutes = () => Number(process.env.LAB_RTA_MINUTES) || 90;
  const avoidOf = (a) => (a.find((x) => x.startsWith('avoid='))?.slice(6) ?? '').split(',').filter(Boolean);
  // several things, each kept once got (not used up for the next); a second round for what a later craft took after all
  async function gather(get, a) {
    let steps = 0;
    for (let round = 0; round < 3; round++) {
      let missing = false;
      const done = new Set();
      for (;;) {   // the cheapest from here next (what one needs, like a pickaxe, makes the others cheaper)
        const left = get.filter(([it, n]) => !done.has(it) && cnt(it) < n);
        if (!left.length) break;
        let pick = left[0];
        if (left.length > 1) {
          let best = Infinity;
          for (const g of left) { const keepBack = reserved; reserved = new Map(get.filter(([j]) => j !== g[0])); const p = planNow(g[0], g[1]); reserved = keepBack; const c = p.ok ? p.sec : Infinity; if (c < best) { best = c; pick = g; } }
        }
        const [it, n] = pick;
        done.add(it);
        missing = true;
        // what the others will want of the same ores: dug with this one's while they are in sight (RUN.mine, st.bonus) - the iron tools
        // asked for two or three iron at a time, and each next two was a search of minutes
        const bonus = new Map();
        for (const [j, nj] of get) {
          if (j === it || cnt(j) >= nj) continue;
          const keepBack = reserved; reserved = new Map(get.filter(([x]) => x !== j)); const pj = planNow(j, nj); reserved = keepBack;
          // (and logs: the next part's sticks from a log carried, not from a walk to the trees - at night that walk was the run's end)
          if (pj.ok) for (const s of pj.steps) if (s.do === 'mine' && (s.anyWood || /_ore$/.test(s.block ?? ''))) { const k = s.anyWood ? 'anyWood' : s.block; bonus.set(k, (bonus.get(k) ?? 0) + s.n); }
        }
        const r = await obtain(it, n, 'rta', { minutes: minutes(), avoid: avoidOf(a), reserve: new Map(get.filter(([j]) => j !== it)), bonus });
        steps += r.steps ?? 0;
        if (!r.ok) return { ok: false, why: `at ${it}: ${r.why}`, steps };
      }
      if (!missing) break;
    }
    const short2 = get.filter(([it, n]) => cnt(it) < n);
    return short2.length ? { ok: false, why: `lost again: ${short2.map(([i, n]) => `${i} ${cnt(i)}/${n}`).join(', ')}`, steps } : { ok: true, steps };
  }
  // a verb the challenge ends with (its name, then arguments)
  async function thenDo(v, args) {
    if (v === 'place_cake_eat') {   // set the cake down and take a slice
      await K.act('place_cake', []);
      const h = known(/^minecraft:cake$/, { max: 1, radius: 6, fair: false })[0];
      if (h) { await emptyHand(); await K.act('useon', [S(h.x), S(h.y), S(h.z), 'up']); }
      split('eat cake'); return;
    }
    await K.act(v, args); split(v);
  }
  const randomItem = () => {   // an item with a route from nothing here (a few tries)
    const env = { inventory: new Map(), stations: [], near: () => null, mob: () => null, drop: () => null, dim: dimName(), y: K.feet().y };
    const pool = [...CH.EASY, ...Object.keys(G.KB.items).filter((i) => G.routesOf(i).length)];
    for (let k = 0; k < 40; k++) { const it = pool[Math.floor(Math.random() * (k < 10 ? CH.EASY.length : pool.length))]; const p = G.plan(it, 1, env); if (p.ok && p.steps.length <= 30) return it; }
    return 'crafting_table';
  };
  async function runChallenge(spec, a) {
    let get = spec.get, what = null;
    if (spec.kind === 'random') { const it = randomItem(); what = `${it} ${G.ja(it)}`; K.say(`rta: the item is ${it} (${G.ja(it)})`); get = [[it, 1]]; }
    const g = await gather(get, a);
    if (!g.ok) return g;
    if (spec.kind === 'depth') {   // down a stair to that height (a new pickaxe when the old one wears out)
      for (let k = 0; k < 4 && feet()[1] > spec.arg + 1; k++) {
        if (!bestTool({ kind: 'pickaxe', tier: 1 })) { const r = await obtain('stone_pickaxe', 1, 'rta', { minutes: minutes() }); if (!r.ok) return { ok: false, why: `pickaxe: ${r.why}`, steps: g.steps }; }
        await stairDown(spec.arg, () => feet()[1] <= spec.arg + 1);
      }
      if (feet()[1] > spec.arg + 1) return { ok: false, why: `got down to y=${feet()[1]} only`, steps: g.steps };
      split(`down to y=${feet()[1]}`);
    } else if (spec.kind === 'up') {   // enough dirt to stand on, then up on it
      const need = Math.max(0, spec.arg - feet()[1]) + 3;
      const r = await obtain('dirt', need, 'rta', { minutes: minutes() }); if (!r.ok) return { ok: false, why: `dirt: ${r.why}`, steps: g.steps };
      await K.act('pillar_to', [S(spec.arg), 'dirt']);
      if (feet()[1] < spec.arg - 1) return { ok: false, why: `got up to y=${feet()[1]} only`, steps: g.steps };
      split(`up to y=${feet()[1]}`);
    } else if (spec.kind === 'far') {   // away from where it started, any way the ground allows
      let s0 = rtaRun.start;
      const far = (x, z) => hyp(x + 0.5 - s0.x, z + 0.5 - s0.z);
      // one way out: the direction with the most dry walkable ground in view (groundAlong), then straight at a point past the line
      const dirs = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);
      let deaths0 = K.memo.get('goal:deaths') ?? 0;
      for (let k = 0; k < 12 && far(feet()[0], feet()[2]) < spec.arg && !late(); k++) {
        if ((K.memo.get('goal:deaths') ?? 0) !== deaths0) { deaths0 = K.memo.get('goal:deaths') ?? 0; const f = K.feet(); s0 = { x: f.x, y: f.y, z: f.z }; log('died on the way: walking again from where I came back'); split('died, walking again'); }
        const [ux, uz] = dirs.map((u) => [u, groundAlong(...u) + Math.random()]).sort((p, q) => q[1] - p[1])[0][0];
        const [x0, , z0] = feet(), left = spec.arg - far(x0, z0) + 8, tx = x0 + ux * left, tz = z0 + uz * left;
        await travel((x, y, z) => far(x, z) >= spec.arg, (x, y, z) => hyp(x - tx, z - tz), { radius: 64, legs: Math.ceil(left / 40) + 4 });
      }
      const d = Math.round(far(feet()[0], feet()[2]));
      if ((K.memo.get('goal:deaths') ?? 0) !== deaths0) return { ok: false, why: 'died at the end of the way (a respawn is not walking)', steps: g.steps };
      if (d < spec.arg) return { ok: false, why: `got ${d} blocks away only`, steps: g.steps };
      split(`${d} blocks away`);
    } else if (spec.kind === 'portal') {
      const r = await RUN.portal({}); if (r !== true) return { ok: false, why: r, steps: g.steps };
      split('in the nether');
    }
    for (const [v, ...args] of spec.then ?? []) await thenDo(v, args);
    return { ok: true, steps: g.steps, what };
  }
  // a hand-written verb as a race: get its things, find its animals, set down its blocks (coordinates of the catalog's flat test
  // world are taken as offsets from where the player stands), then do it
  async function runQuest(v, q, a) {
    questKeep = new Set(q.get.map(([it]) => it));
    try { return await runQuest0(v, q, a); } finally { questKeep = new Set(); }
  }
  async function runQuest0(v, q, a) {
    let g;
    for (let round = 0; round < 3; round++) {   // (a death on the way to the animals takes what was got: got again, then on)
      g = await gather(q.get, a);
      if (!g.ok) return g;
      const deaths0 = K.memo.get('goal:deaths') ?? 0;
      const need = new Map(); for (const m of q.mobs) need.set(m, (need.get(m) ?? 0) + 1);
      for (const [m, k] of need) {
        if (inMine()) { if (nightNow()) { log('night: waiting down here for the morning'); await shelter(); } await toSurface(`find ${m}`); }
        const near = () => mobs(m).filter((e) => hyp(e.x - K.feet().x, e.z - K.feet().z) < 24);
        if (near().length < k) await exploreSurface(() => mobs(m).length >= k, m, 10);
        const e = mobs(m)[0]; if (!e) return { ok: false, why: `no ${m} found`, steps: g.steps };
        await goToEntity(e, 3); split(`found ${m}`);
      }
      // (missing now, however it went - a death on the way, or one while the things were still being got, counted before the walk
      // to the animals began: "lost shears on the way" ended a run that had 17 minutes left): got again
      if (q.get.every(([it, n]) => cnt(it) >= n) || late()) break;
      log(`${(K.memo.get('goal:deaths') ?? 0) !== deaths0 ? 'died on the way' : 'the things are gone'}: getting them again`);
    }
    const lost = q.get.filter(([it, n]) => cnt(it) < n && !/^(beef|porkchop|mutton|chicken|cod|salmon|rabbit)$/.test(it));
    if (lost.length) return { ok: false, why: late() ? 'out of time' : `lost ${lost.map(([it]) => it).join(', ')} on the way`, steps: g.steps };
    const [bx, by, bz] = feet(), base = { x: bx, y: by, z: bz };
    for (const [x, y, z, b] of q.blocks) {   // the block it works on: set down beside
      const it = CH.placeOf(b), p = [base.x + x, base.y + (y + 60), base.z + z];
      if (solid(B(...p))) await breakAt(...p);
      if (!(await goToBlock(p[0], p[1] - 1, p[2], 4))) continue;
      await grab(it, 'quest'); await K.act('useon', [S(p[0]), S(p[1] - 1), S(p[2]), 'up']); await K.ticks(4);
    }
    await K.act(v, CH.mapArgs(q.use, q.args, base));
    split(v);
    return { ok: true, steps: g.steps };
  }
  M.rta = async (a) => {   // rta <item[+item*n...]|challenge|verb|list [word]> [keep] [avoid=a,b] [xray] [hud]: a timed run from an empty inventory
    const what = a[0];
    if (!what) return say('rta', `rta <item>[+<item>*n...] | <challenge> | <verb> | list [word]   [keep] [avoid=a,b] [xray] [hud]  (${Object.keys(CH.CHALLENGES).length} challenges, ${Object.keys(CH.QUESTS).length} verbs as quests)`);
    if (what === 'list') { const w = a[1] ?? ''; const names = Object.keys(CH.CHALLENGES).filter((k) => k.includes(w)); names.slice(0, 200).forEach((k) => K.say(`rta ${k}: ${CH.CHALLENGES[k].ja}`)); return say('rta list', `${names.length} challenges${w ? ` with "${w}"` : ''}; any verb too: rta <verb> (${Object.keys(CH.QUESTS).length})`); }
    const ch = CH.CHALLENGES[what];
    if (ch) return timed('rta ' + what, a, () => runChallenge(ch, a));
    if (CH.QUESTS[what] && !G.KB.items[what]) return timed('rta ' + what, a, () => runQuest(what, CH.QUESTS[what], a));
    const goals = what.split('+').map((x) => { const m = /^(\w+?)(?:\*(\d+))?$/.exec(x); return [sh(m?.[1] ?? x), Number(m?.[2] ?? 1)]; });
    const bad = goals.filter(([it]) => !G.KB.items[it]); if (bad.length) return say('rta', `no item or challenge ${bad.map(([i]) => i).join(', ')} (rta list)`);
    return timed('rta ' + what, a, () => gather(goals, a));
  };
  const runRta = (name, a, body) => timed(name, a, body);
  M.end_run = async (a) => K.say(`end_run: ${await endRun(Number(a[0]) || 900)}`);
  M.nether_seek = async (a) => { const r = await netherSeek(Number(a[0]) || 600); return K.say(`nether_seek: ${r ? `fortress at ${r.x} ${r.y} ${r.z}` : 'none found'}`); };
  M.blaze_rods = async (a) => K.say(`blaze_rods: ${(await blazeRods(Number(a[0]) || 6, Number(a[1]) || 400)) ? 'got them' : `only ${cnt('blaze_rod')}`}`);
  M.stronghold = async (a) => { const fr = await findStronghold(Number(a[0]) || 900); if (!fr) return K.say('stronghold: not found'); return K.say(`stronghold: ${(await intoEndPortal(fr)) ? 'in the End' : 'not in'}`); };
  M.end_fight = async (a) => K.say(`end_fight: ${(await endFight(Number(a[0]) || 600)) ? 'the dragon is dead' : 'not dead'}`);
  M.duel_mob = async (a) => {   // duel_mob <type> [seconds]: a mob fought like a PvP duel (kept out of its reach, the blow on its tenth tick, crits, W-tap) - add-on PvP bots that are mobs (MPVPBOT's armies)
    // (bite: how far its blow reaches, centre to centre - an add-on's melee_attack reach_multiplier r on a 0.6-wide mob reaches
    // sqrt((0.6 r)^2 + 0.6): MPVPBOT's diamond mafia (r 3.7) 2.35, where a zombie (r 2) reaches 1.43)
    const want = String(a[0] ?? '').toLowerCase(), max = Number(a[1]) || 120, bite = Number(a[2]) || null;
    const pick = () => K.all().filter((q) => q.type !== 'minecraft:player' && !/item$|xp_orb|arrow|projectile|pearl/.test(q.type) && (q.type === want || q.type.endsWith(':' + want) || q.type.includes(want))).sort((p2, q2) => hyp(p2.x - K.feet().x, p2.z - K.feet().z) - hyp(q2.x - K.feet().x, q2.z - K.feet().z))[0];
    let e = null;
    for (let k = 0; k < 200 && !e; k++) { e = pick(); if (!e) await K.ticks(1); }
    if (!e) return K.say(`duel_mob: no ${a[0]} in view`);
    const w = WEAPONS.find((x) => cnt(x) > 0);
    if (!shieldUp() && cnt('shield') > 0) { const i = K.inv.slots.findIndex((it) => it?.network_id && sh(nm(it)) === 'shield'); if (i >= 0) { try { await K.act('move', [String(i), 'offhand']); } catch {} } }
    if (w) await grab(w, 'fight'); else await emptyHand();
    const t0 = Number(K.tick()), hp0 = K.attrs().health ?? 20;
    DUEL_MOBS.add(e.type);
    const setBite = (q) => { if (bite) q._bite = bite; else if (!q.type.startsWith('minecraft:')) q._bite ??= 2.4; };
    setBite(e);
    let won = false;
    const off = clutchGuard();
    try {
      // (it pearls off and comes back, heals out of reach: fought again while it is about, until it is dead or the time is up)
      while (!K.dead() && (Number(K.tick()) - t0) / 20 < max) {
        if (!K.all().includes(e)) { const again = pick(); if (!again) { won = !!e.dead || hyp(e.x - K.feet().x, e.z - K.feet().z) < 24; break; } e = again; setBite(e); }
        // (in slices of a few seconds: between them an apple when hurt - a fight of 67 s in one piece burned the player down from its
        // fire-aspect sword with 16 apples untouched)
        await spaceFight(e, Math.min(4, Math.max(1, max - (Number(K.tick()) - t0) / 20)), { crit: true });
        if (!K.all().includes(e) && !pick()) { won = true; break; }
        if ((K.attrs().health ?? 20) < 13 && cnt('golden_apple') > 0 && Number(K.tick()) - (M.duel_mob.ateAt ?? -99) > 60) { M.duel_mob.ateAt = Number(K.tick()); try { await grab('golden_apple', 'eat'); await K.act('use', ['34']); } catch {} if (w) { try { await grab(w, 'fight'); } catch {} } }
        if (hyp(e.x - K.feet().x, e.z - K.feet().z) > 4) { try { await goToEntity(e, 2.8); } catch {} } else await K.ticks(1);
      }
    } finally { off(); DUEL_MOBS.delete(e.type); }
    log(`duel_mob with ${sh(e.type)}: ${K.dead() ? 'lost' : won ? 'won' : 'not finished'} in ${((Number(K.tick()) - t0) / 20).toFixed(1)} s, health ${Math.round(K.attrs().health ?? 0)} (from ${Math.round(hp0)})`);
    return K.say(`duel_mob: ${won && !K.dead() ? 'won' : K.dead() ? 'lost' : 'not finished'}`);
  };
  M.duel = async (a) => {   // duel <player> [seconds]: fight that player like a PvP player (reach timing, W-tap, crits, edges blocked)
    // (the name as shown, colour codes dropped; exact, else the one whose name holds it - waiting up to 10 s for one to come)
    const want = String(a[0] ?? '').toLowerCase(), plain = (q) => (q.name ?? '').replace(/§./g, '').toLowerCase();
    let e = null;
    for (let k = 0; k < 200 && !e; k++) { const ps = K.all().filter((q) => q.type === 'minecraft:player'); e = ps.find((q) => plain(q) === want) ?? ps.find((q) => plain(q).includes(want)) ?? null; if (!e) await K.ticks(1); }
    if (!e) return K.say(`duel: no player ${a[0]} in view`);
    const r = await pvpFight(e, Number(a[1]) || 120);
    return K.say(`duel: ${r ? 'won' : K.dead() ? 'lost' : 'not finished'}`);
  };
  M.dig_out = async (a) => {   // dig_out [y]: up out of the ground: back up its own stair, else a stair dug up, until open sky (or y)
    const y0 = feet()[1];
    if (skyOver()) return say('dig_out', `already under the open sky at y=${y0}`);
    await toSurface('', a[0] !== undefined ? Number(a[0]) : undefined);
    return say('dig_out', skyOver() ? `out at y=${feet()[1]} (from y=${y0})` : `still under the ground at y=${feet()[1]} (from y=${y0})`);
  };
  M.dig_in = async () => {   // dig_in: shut in for the night where it stands (a hole with a lid, or walls and a lid, or up on a pillar), out in the morning
    const r = await shelter();
    return say('dig_in', r ?? 'done');
  };
  // ---- a fair start: where a run can begin (a runner resets a spawn in the sea or in a dark forest) ----
  // the ground under a column near height y: [y of the top solid block, water on top?], leaves and logs looked through
  const groundAt = (x, z, y0) => { for (let y = y0 + 24; y >= y0 - 24; y--) { const b = B(x, y, z); if (!b) continue; if (isWater(b)) return [y, true]; if (solid(b) && !/_(log|leaves)$|leaves/.test(b.name)) return [y, false]; } return null; };
  // (a closed canopy is shade: zombies and skeletons do not burn under it in the morning, and a dark forest spawns them by day)
  const canopyAt = (x, z, y0) => { for (let y = y0 + 24; y >= y0 - 8; y--) { const b = B(x, y, z); if (!b || /air/.test(b.name)) continue; return /leaves|_log$/.test(b.name); } return false; };
  function startScore(cx, cz, cy, logs) {
    let land = 0, all = 0, shade = 0;
    for (let dx = -24; dx <= 24; dx += 6) for (let dz = -24; dz <= 24; dz += 6) { if (dx * dx + dz * dz > 24 * 24) continue; const g = groundAt(cx + dx, cz + dz, cy); if (!g) continue; all++; if (!g[1] && Math.abs(g[0] - cy) <= 10) land++; if (canopyAt(cx + dx, cz + dz, g[0])) shade++; }
    const near = logs.filter((h) => hyp(h.x - cx, h.z - cz) <= 32 && Math.abs(h.y - cy) <= 14), wide = logs.filter((h) => hyp(h.x - cx, h.z - cz) <= 64 && Math.abs(h.y - cy) <= 20);
    const trees = new Set(near.map((h) => `${h.x},${h.z}`)).size, trees64 = new Set(wide.map((h) => `${h.x},${h.z}`)).size;
    const dark = new Set(wide.filter((h) => /dark_oak|pale_oak/.test(h.block?.name ?? '')).map((h) => `${h.x},${h.z}`)).size;   // dark forest trees within 64
    const animals = K.all().filter((e) => /:(cow|pig|sheep|chicken)$/.test(e.type) && hyp(e.x - cx, e.z - cz) < 48).length;
    const foes = K.all().filter((e) => HOSTILE.test(e.type) && hyp(e.x - cx, e.z - cz) < 48 && Math.abs(e.y - cy) < 12).length;   // about by day: shade or caves
    const landFrac = all ? land / all : 0, shadeFrac = all ? shade / all : 0, g0 = groundAt(cx, cz, cy);
    const dry = !!g0 && !g0[1];
    // (a start with a handful of trees in reach spent 6-8 minutes looking for the next ones: 20 within 64 is a wood to live off)
    const score = (dry ? 0 : -50) + Math.min(trees, 10) + 0.5 * Math.min(trees64, 30) + 12 * landFrac + Math.min(animals, 4) - (dark > 1 ? 20 : 0) - (Math.abs(cy - 68) > 20 ? 6 : 0) - (trees64 < 12 ? 10 : 0)
      - (shadeFrac > 0.35 ? 15 * shadeFrac : 0) - 3 * Math.min(foes, 5);
    return { x: cx, z: cz, y: g0?.[0] ?? cy, trees, trees64, dark, landFrac, shadeFrac, animals, foes, dry, score, good: dry && trees >= 5 && trees64 >= 20 && landFrac >= 0.75 && dark <= 1 && shadeFrac <= 0.35 && foes === 0 };
  }
  function bestStartHere() {
    const [x, y, z] = feet();
    const logs = K.findBlocks((b) => /_log$/.test(b.name) && !/stripped/.test(b.name), { max: 600, radius: 100 });
    const cands = [[0, 0], ...[32, 64].flatMap((r) => Array.from({ length: 8 }, (_, i) => [Math.round(Math.cos((i * Math.PI) / 4) * r), Math.round(Math.sin((i * Math.PI) / 4) * r)]))];
    const out = [];
    for (const [dx, dz] of cands) { const g = groundAt(x + dx, z + dz, y); if (!g) continue; out.push(startScore(x + dx, z + dz, g[0] + 1, logs)); }
    out.sort((p, q) => (q.good - p.good) || (q.score - p.score) - (hyp(p.x - x, p.z - z) - hyp(q.x - x, q.z - z)) * 0.02);
    return out[0] ?? null;
  }
  M.pick_start = async (a) => {   // pick_start [r]: a fair place to start a run near here (trees, dry land, animals; not the sea, not a dark forest), moved to
    const r = Math.max(64, Number(a[0]) || 160), [x0, , z0] = feet();
    const put = async (x, z) => {
      const f = K.feet(); if (hyp(f.x - (x + 0.5), f.z - (z + 0.5)) < 1) return;   // (already there)
      await K.act('cmd', ['spreadplayers', S(x + 0.5), S(z + 0.5), '0', '1', '@s']); await K.ticks(10);
      if (process.env.LAB_WORLD === 'normal') { await waitWorld(64, 90000, true); await K.act('cmd', ['spreadplayers', S(x + 0.5), S(z + 0.5), '0', '1', '@s']); }
      await K.ticks(40);
    };
    let best = bestStartHere(), tried = 1;
    // nothing good in view: further off (the land there is generated as the player gets there), first good one (a flat world has
    // no trees anywhere: the best in view is all there is)
    for (let i = 0; i < 16 && !(best?.good) && process.env.LAB_WORLD === 'normal'; i++) {
      const ang = (i * Math.PI) / 4 + (i >= 8 ? Math.PI / 8 : 0), rr = i >= 8 ? r * 1.5 : r, tx = Math.round(x0 + Math.cos(ang) * rr), tz = Math.round(z0 + Math.sin(ang) * rr);
      await put(tx, tz); tried++;
      const b = bestStartHere(); if (b && (!best || b.score > best.score)) best = b;
    }
    if (!best) return say('pick_start', `nothing to stand on near ${x0} ${z0}`);
    await put(best.x, best.z);
    const f = K.feet();
    return say('pick_start', `at ${Math.floor(f.x)} ${Math.floor(f.z)} (${best.good ? 'good' : 'best found'}: ${best.trees} trees (${best.trees64} within 64), ${Math.round(best.landFrac * 100)}% dry land, ${best.animals} animals, ${Math.round(best.shadeFrac * 100)}% shade${best.dark > 1 ? ', dark forest' : ''}${best.foes ? `, ${best.foes} monsters` : ''}; ${tried} places looked at)`);
  };
  M.wait_world = async (a) => {   // wait_world [radius] [seconds]: until the ground around is loaded (after a teleport, while far-off land is generated)
    const r = Math.max(8, Number(a[0]) || 48), sec = Number(a[1]) || 120, t0 = Date.now();
    const f = await waitWorld(r, sec * 1000, true);
    return say('wait_world', `${Math.round(f * 100)}% of the ground within ${r} known after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  };
  M.plan = async (a) => {   // plan <item> [n]: what `get` would do from here, step by step (nothing is done)
    const item = sh(a[0]), n = Number(a[1] ?? 1);
    if (!item) return say('plan', 'plan <item> [n]');
    if (!G.KB.items[item]) return say('plan', `no item ${item}`);
    await K.sync();
    const p = planNow(item, n);
    if (!p.ok) return say('plan', `no way to ${item} from here: ${p.problems.join('; ')}`);
    say('plan', `${n} ${item} (${G.ja(item)}): ${p.steps.length} steps, about ${G.mmss(p.sec)}`);
    p.steps.forEach((s, i) => K.say(`plan ${i + 1}. ${G.describe(s)}`));
    return undefined;
  };
  // LAB_GOAL_TRACE=1: what the player is busy with, for a run that stalls without a word - these said as they start (=2: the look
  // round and the reflexes too), and each one that took over a second when it ends
  if (process.env.LAB_GOAL_TRACE) {
    const show = (v) => (typeof v === 'function' ? 'fn' : Array.isArray(v) ? `[${v.join(',')}]` : v && typeof v === 'object' ? '{..}' : String(v));
    const wrap = (name, fn, loud) => async (...a) => {
      const t0 = gnow(), [x, y, z] = feet();
      if (loud) log(`> ${name}(${a.map(show).join(', ')}) at ${x} ${y} ${z}`);
      let r;
      try { r = await fn(...a); return r; } finally { const d = gnow() - t0; if (d > 1000) log(`< ${name}(${a.map(show).join(', ')}) ${(d / 1000).toFixed(1)} s -> ${show(r)} at ${feet().join(' ')}`); }
    };
    const loud = process.env.LAB_GOAL_TRACE === '2';
    travel = wrap('travel', travel, true); follow = wrap('follow', follow, loud); breakAt = wrap('breakAt', breakAt, true); pillarUp = wrap('pillarUp', pillarUp, true);
    collect = wrap('collect', collect, true); findBlock = wrap('findBlock', findBlock, true); goToBlock = wrap('goToBlock', goToBlock, true); walkInto = wrap('walkInto', walkInto, loud);
    danger = wrap('danger', danger, loud); reflexes = wrap('reflexes', reflexes, loud); exploreSurface = wrap('exploreSurface', exploreSurface, true); fightOne = wrap('fightOne', fightOne, true);
  }
  return { M, splits: () => lastSplits, runRta, runChallenge, runQuest, CH, obtain, planNow, travel, goToBlock, goToXZ, goToEntity, findBlock, known, collect, reflexes, fightOne, openStation, pickUp, RUN, invMap, cnt, cntRe, exploreSurface, stairDown, tunnel, astar, stationAt, mineBlocks, killMobs, spotAhead, closeAll };
}

module.exports = { goalVerbs };
