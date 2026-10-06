// Generated verbs: one per item, block and mob the game has (BDS's own lists in common/data/kb.json), each a real action a player
// takes with that thing. They run on the goal planner (goal.cjs / goal-exec.cjs) and the same measured primitives as every verb.
//   get_<item> [n]      obtain it from whatever is around (materials first, like a speedrunner)
//   rta_<item> [keep]   the speedrun of it: from an empty inventory (keep: from what you carry), timed
//   craft_<item> [n]    craft it from what is carried (the parts first: planks, sticks ...), at a table when it needs one
//   smelt_<item> [n]    smelt what turns into it (a furnace nearby, or the one carried set down)
//   mine_<block> [n]    break the nearest ones with the right tool and pick up what drops
//   find_<block>        walk up to the nearest one (looking around when none is in sight)
//   place_<block>       set one down in front (the item that places it, from the inventory)
//   hold_<item>         take it in hand (hotbar key, or dragged from the inventory)
//   drop_<item> [n]     throw it on the ground (all of it by default)
//   kill_<mob> [n]      fight the nearest ones and pick up the drops
//   goto_<mob>          walk up to the nearest one
//   challenge_<name>    a timed challenge (common/challenges.cjs): sets of things (tools, armor, every dye, a stack, a bingo card),
//                       then something to do with them (wear, eat, tame ...), or a place to reach (a depth, a height, far away)
//   quest_<verb>        a hand-written verb as a race: from nothing, get what it needs, find its animals, then do it
// `dry` as the last argument (or LAB_GOAL_DRY=1): say what it would do and do nothing (tests run every generated verb this way).
'use strict';
const G = require('./goal.cjs');
const CH = require('./challenges.cjs');

const KB = G.KB;
const ITEMS = Object.keys(KB.items).filter((i) => !/^(element_\d+|air|unknown|info_update\d?|reserved6|structure_void|barrier|light_block_\d+|debug_stick)$/.test(i)).sort();
const BLOCKS = Object.keys(KB.blocks).filter((b) => !/^(air|element_\d+|unknown|info_update\d?|reserved6|structure_void|barrier|light_block(_\d+)?|client_request_placeholder_block|moving_block|piston_arm_collision|sticky_piston_arm_collision|movingBlock|portal|end_portal|end_gateway|fire|soul_fire|water|lava|flowing_water|flowing_lava|bubble_column|border_block|allow|deny|camera|glowingobsidian|netherreactor|stonecutter|chemistry_table|compound_creator|material_reducer|element_constructor|lab_table|hard_\w+|colored_torch_\w+|underwater_torch|chemical_heat|deprecated_\w+)$/.test(b)).sort();
const LIVING = Object.keys(KB.mobs).filter((m) => !/^(agent|area_effect_cloud|armor_stand|arrow|boat|chest_boat|chest_minecart|command_block_minecart|dragon_fireball|egg|ender_crystal|ender_pearl|eye_of_ender_signal|fireball|fireworks_rocket|fishing_hook|hopper_minecart|lightning_bolt|lingering_potion|llama_spit|minecart|npc|player|shulker_bullet|small_fireball|snowball|splash_potion|thrown_trident|tnt|tnt_minecart|tripod_camera|wither_skull|wither_skull_dangerous|xp_bottle|xp_orb|breeze_wind_charge_projectile|ominous_item_spawner|wind_charge_projectile|villager|zombie_villager|cushion|sulfur_cube)$/.test(m)).sort();
const obtainable = (i) => G.routesOf(i).length > 0;
const craftable = (i) => (KB.craft[i] ?? []).some((r) => /^(crafting_table|stonecutter)$/.test(r[1]));
const placeItem = (b) => { const it = KB.blocks[b]?.[2]; return it && KB.items[it] ? it : null; };
const hasDrops = (b) => Object.keys(KB.blocks[b]?.[4] ?? {}).length > 0;
// the families: prefix, the ids, how to call it, what it does in Japanese
const FAMILIES = [
  { prefix: 'get_', ids: ITEMS.filter(obtainable), use: (id) => `get_${id} [n] [avoid=a,b] [xray]`, ja: (id) => `${G.ja(id)}を手に入れる（無ければ材料集めから自動で）` },
  { prefix: 'rta_', ids: ITEMS.filter(obtainable), use: (id) => `rta_${id} [keep] [avoid=a,b] [xray]`, ja: (id) => `${G.ja(id)}のRTA（持ち物を空にしてから入手するまでの時間を計る）` },
  { prefix: 'craft_', ids: ITEMS.filter(craftable), use: (id) => `craft_${id} [n]`, ja: (id) => `持ち物から${G.ja(id)}を作る（部品から、要れば作業台で）` },
  { prefix: 'smelt_', ids: ITEMS.filter((i) => KB.smelt[i]), use: (id) => `smelt_${id} [n]`, ja: (id) => `かまどで焼いて${G.ja(id)}にする` },
  { prefix: 'mine_', ids: BLOCKS.filter(hasDrops), use: (id) => `mine_${id} [n]`, ja: (id) => `近くの${G.ja(id)}を合う道具で掘って拾う` },
  { prefix: 'find_', ids: BLOCKS.filter((b) => hasDrops(b) || placeItem(b)), use: (id) => `find_${id}`, ja: (id) => `一番近い${G.ja(id)}のところへ行く（見当たらなければ探す）` },
  { prefix: 'place_', ids: BLOCKS.filter(placeItem), use: (id) => `place_${id}`, ja: (id) => `${G.ja(id)}を目の前に置く` },
  { prefix: 'hold_', ids: ITEMS, use: (id) => `hold_${id}`, ja: (id) => `${G.ja(id)}を手に持つ` },
  { prefix: 'drop_', ids: ITEMS, use: (id) => `drop_${id} [n]`, ja: (id) => `${G.ja(id)}を捨てる` },
  { prefix: 'kill_', ids: LIVING, use: (id) => `kill_${id} [n]`, ja: (id) => `近くの${G.ja(id)}を倒してドロップを拾う` },
  { prefix: 'goto_', ids: LIVING, use: (id) => `goto_${id}`, ja: (id) => `一番近い${G.ja(id)}のところへ行く` },
  { prefix: 'challenge_', ids: Object.keys(CH.CHALLENGES), use: (id) => `challenge_${id} [keep] [avoid=a,b] [xray] [hud]`, ja: (id) => `RTA 企画: ${CH.CHALLENGES[id].ja}` },
  { prefix: 'quest_', ids: Object.keys(CH.QUESTS), use: (id) => `quest_${id} [keep] [hud]`, ja: (id) => `RTA: ${CH.QUESTS[id].ja}` },
];
// every generated name (hand-written verbs of the same name win: they were there first)
function genNames(skip = new Set()) {
  const out = [];
  for (const f of FAMILIES) for (const id of f.ids) { const v = f.prefix + id; if (!skip.has(v)) out.push([v, f, id]); }
  return out;
}

function genVerbs(K, H, GX, skip) {
  const S = String;
  const say = (v, s) => K.say(`${v}: ${s}`);
  const dry = (a) => a.at(-1) === 'dry' || process.env.LAB_GOAL_DRY === '1';
  const num = (a, d = 1) => { const x = a.find((q) => /^\d+$/.test(q)); return x ? Number(x) : d; };
  const { grab, has } = H;
  const mmss = G.mmss;
  // one verb per family, bound to the thing it is about
  const make = {
    get_: (id) => async (a) => {
      if (dry(a)) { await K.sync(); const p = GX.planNow(id, num(a)); return say('get_' + id, p.ok ? `would take ${p.steps.length} steps (about ${mmss(p.sec)}): ${p.steps.slice(0, 4).map(G.describe).join(' | ')}${p.steps.length > 4 ? ' ...' : ''}` : `no way from here: ${p.problems[0] ?? '?'}`); }
      return GX.M.get([id, S(num(a)), ...a.filter((x) => /^(avoid=|xray$)/.test(x))]);
    },
    rta_: (id) => async (a) => {
      if (dry(a)) { const p = G.plan(id, 1, { inventory: new Map(), stations: [], near: () => null, mob: () => null, drop: () => null, dim: ['overworld', 'nether', 'the_end'][K.dim()] ?? 'overworld', y: K.feet().y }); return say('rta_' + id, p.ok ? `route from nothing: ${p.steps.length} steps, about ${mmss(p.sec)}` : `no route from nothing here: ${p.problems[0] ?? '?'}`); }
      return GX.runRta('rta_' + id, a, () => GX.obtain(id, 1, 'rta_' + id, { minutes: Number(process.env.LAB_RTA_MINUTES) || 90, avoid: (a.find((x) => x.startsWith('avoid='))?.slice(6) ?? '').split(',').filter(Boolean) }));
    },
    challenge_: (id) => async (a) => {
      const ch = CH.CHALLENGES[id];
      if (dry(a)) {
        const env = { inventory: new Map(), stations: [], near: () => null, mob: () => null, drop: () => null, dim: 'overworld', y: K.feet().y };
        let steps = 0, sec = 0; const bad = [];
        for (const [it, n] of ch.get) { const p = G.plan(it, n, env); if (p.ok) { steps += p.steps.length; sec += p.sec; } else bad.push(it); }
        return say('challenge_' + id, `${ch.ja}: ${ch.get.length} things${ch.kind ? ` + ${ch.kind} ${ch.arg ?? ''}` : ''}${ch.then ? ` then ${ch.then.map((t) => t[0]).join(', ')}` : ''}; from nothing about ${steps} steps, ${mmss(sec)}${bad.length ? `; no route here for ${bad.join(', ')}` : ''}`);
      }
      return GX.runRta('challenge_' + id, a, () => GX.runChallenge(ch, a));
    },
    quest_: (id) => async (a) => {
      const q = CH.QUESTS[id];
      if (dry(a)) return say('quest_' + id, `would get ${q.get.map(([i, n]) => `${n} ${i}`).join(', ')}${q.mobs.length ? `, find ${q.mobs.join(' + ')}` : ''}${q.blocks.length ? `, set down ${q.blocks.map((b) => b[3]).join(', ')}` : ''}, then ${id} ${q.args.join(' ')}`);
      return GX.runRta('quest_' + id, a, () => GX.runQuest(id, q, a));
    },
    craft_: (id) => async (a) => {
      await K.sync();
      const n = num(a), env = { inventory: GX.invMap(), stations: [], near: () => null, mob: () => null, drop: () => null, dim: 'overworld', y: 64, carriedOnly: true };
      const p = G.plan(id, (GX.cnt(id)) + n, env, { carriedOnly: true });
      if (!p.ok) return say('craft_' + id, `cannot make ${id} from what is carried: ${p.problems[0] ?? '?'}`);
      if (dry(a)) return say('craft_' + id, `would ${p.steps.map(G.describe).join(' | ') || 'do nothing (carried)'}`);
      for (const st of p.steps) { const r = await GX.RUN[st.do](st); if (r !== true) return say('craft_' + id, `stopped at ${G.describe(st)}: ${r}`); }
      await GX.closeAll();
      return say('craft_' + id, `made ${n} ${id} (${p.steps.length} steps)`);
    },
    smelt_: (id) => async (a) => {
      await K.sync();
      const n = num(a), inputs = (KB.smelt[id] ?? []).map((r) => r[0]).filter((x) => !x.startsWith('#'));
      const input = inputs.find((x) => GX.cnt(x) > 0);
      if (!input) return say('smelt_' + id, `needs ${inputs.slice(0, 3).join(' or ')} in the inventory`);
      const fuel = ['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks', 'oak_log'].find((x) => GX.cnt(x) > 0) ?? [...GX.invMap().keys()].find((x) => /_(planks|log)$/.test(x));
      if (!fuel) return say('smelt_' + id, 'no fuel carried (coal, charcoal, planks, logs)');
      if (dry(a)) return say('smelt_' + id, `would smelt ${Math.min(n, GX.cnt(input))} ${input} with ${fuel}`);
      const r = await GX.RUN.smelt({ item: id, input, n: Math.min(n, GX.cnt(input)), fuel, fueln: Math.ceil(n / 1.5) });
      await GX.pickUp('furnace');
      return say('smelt_' + id, r === true ? `${GX.cnt(id)} ${id} now` : r);
    },
    mine_: (id) => async (a) => {
      const n = num(a);
      if (dry(a)) { const d = KB.blocks[id]?.[4] ?? {}, t = KB.blocks[id]?.[5]; return say('mine_' + id, `would break ${n} ${id} with ${t ?? 'hand'} for ${Object.keys(d[t] ?? d.hand ?? {}).join(', ') || 'nothing'}`); }
      const r = await GX.mineBlocks(id, n);
      return say('mine_' + id, r.ok ? `broke ${r.n} ${id}` : r.why);
    },
    find_: (id) => async (a) => {
      if (dry(a)) { const h = GX.known(new RegExp(`^minecraft:${id}$`), { max: 1 })[0]; return say('find_' + id, h ? `would walk to ${h.x} ${h.y} ${h.z} (${h.d.toFixed(0)} away)` : `none in sight: would look around (${G.wild(id) ? 'it grows / lies in the wild' : 'only where someone set one down'})`); }
      const h = await GX.findBlock(id, { legs: 6 });
      if (!h) return say('find_' + id, `no ${id} found`);
      const ok = await GX.goToBlock(h.x, h.y, h.z, 3);
      return say('find_' + id, ok ? `at ${h.x} ${h.y} ${h.z}` : `saw one at ${h.x} ${h.y} ${h.z} but could not get there`);
    },
    place_: (id) => async (a) => {
      const it = placeItem(id);
      await K.sync();
      if (!has(it)) return say('place_' + id, `needs ${it} in the inventory (get_${it})`);
      if (dry(a)) return say('place_' + id, `would set ${it} down in front`);
      const s = GX.spotAhead(); if (!s) return say('place_' + id, 'no free spot with a floor in front');
      await grab(it, 'place_' + id);
      await K.act('useon', [S(s[0]), S(s[1] - 1), S(s[2]), 'up']);
      await K.ticks(4);
      return say('place_' + id, `${it} set at ${s.join(' ')}`);
    },
    hold_: (id) => async (a) => {
      await K.sync();
      if (!has(id)) return say('hold_' + id, `no ${id} carried`);
      if (dry(a)) return say('hold_' + id, `would take ${id} in hand`);
      await grab(id, 'hold_' + id);
      return say('hold_' + id, `holding ${id}`);
    },
    drop_: (id) => async (a) => {
      await K.sync();
      if (!has(id)) return say('drop_' + id, `no ${id} carried`);
      if (dry(a)) return say('drop_' + id, `would drop ${a.find((q) => /^\d+$/.test(q)) ?? 'all'} ${id}`);
      let left = a.find((q) => /^\d+$/.test(q)) ? num(a) : GX.cnt(id);
      for (let k = 0; k < 40 && left > 0 && has(id); k++) { await grab(id, 'drop_' + id); const it = K.inv.slots[K.inv.selected]; const d = Math.min(left, it?.count ?? 0); if (!d) break; await K.act('drop', [S(d)]); left -= d; await K.sync(); }
      return say('drop_' + id, `dropped; ${GX.cnt(id)} left`);
    },
    kill_: (id) => async (a) => {
      const n = num(a);
      if (dry(a)) { const e = K.nearest(id)[0]; return say('kill_' + id, e ? `would fight the ${id} at ${e.x.toFixed(0)} ${e.y.toFixed(0)} ${e.z.toFixed(0)}` : `no ${id} in view: would look around`); }
      const r = await GX.killMobs(id, n);
      return say('kill_' + id, r.ok ? `killed ${r.n} ${id}` : r.why);
    },
    goto_: (id) => async (a) => {
      let e = K.nearest(id)[0];
      if (dry(a)) return say('goto_' + id, e ? `would walk to the ${id} ${e.x.toFixed(0)} ${e.z.toFixed(0)}` : `no ${id} in view: would look around`);
      if (!e) { await GX.exploreSurface(() => !!K.nearest(id)[0], id, 6); e = K.nearest(id)[0]; }
      if (!e) return say('goto_' + id, `no ${id} found`);
      const ok = await GX.goToEntity(e, 2.5);
      return say('goto_' + id, ok ? `next to the ${id}` : `could not reach the ${id}`);
    },
  };
  const out = {};
  for (const [v, f, id] of genNames(skip)) out[v] = make[f.prefix](id);
  return out;
}

module.exports = { genVerbs, genNames, FAMILIES, ITEMS, BLOCKS, LIVING };
