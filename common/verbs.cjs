// Everyday player actions, each made the way a person does it: pick the tool (hotbar key, or drag it from the inventory onto the
// selected slot), aim, then the same click / hold / key press the primitive actions in realplayer.cjs send (those are measured on
// BDS). So a verb adds no new packet: it adds the human's sequence. K = the client's internals (see realplayer.cjs).
'use strict';
const FACES = ['down', 'up', 'north', 'south', 'west', 'east'];
const ARMOR = [[/helmet|_cap$|_skull$|_head$|carved_pumpkin|turtle_helmet/, 'head'], [/chestplate|elytra/, 'chest'], [/leggings/, 'legs'], [/boots/, 'feet'], [/shield|totem/, 'offhand']];

function makeVerbs(K) {
  const nm = (it) => (it?.network_id ? K.itemNames.get(it.network_id) ?? '' : '');
  const re = (x) => (x instanceof RegExp ? x : new RegExp(`(^|:)${String(x).replace(/^minecraft:/, '')}$`));
  const n = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const xyz = (a, i = 0) => { if (!(a.length >= i + 3) || a.slice(i, i + 3).some((v) => !/^-?\d+(\.\d+)?$/.test(v))) throw new Error('needs x y z'); return a.slice(i, i + 3); };
  // hold item `what` in the main hand: hotbar key if it is there, else drag it into the hotbar - an empty slot, else the one used
  // longest ago - and press its key. (Into the selected slot each time, two things taken in turns - a pickaxe and the blocks to
  // stand on, up a shaft - were swapped in and out of the same slot: two trips to the server for every block, 65 ticks a level)
  const lastUse = new Array(9).fill(-1);
  let useN = 0;
  async function grab(what, verb) {
    const r = re(what);
    // (already in hand: no round trip to the server first - at 20x each one was 10+ ticks, before every blow of a fight)
    if (r.test(nm(K.inv.slots[K.inv.selected])) && (K.inv.slots[K.inv.selected]?.count ?? 0) > 0) { lastUse[K.inv.selected] = ++useN; return; }
    // (the bag's word only when it is not where this client sees it: a hotbar key needs none)
    let s = K.inv.slots;
    // (an item just given can take a moment to reach the client, seconds on a slow server under Wine: ask again for up to 3 s)
    for (let t0 = Date.now(); !s.some((it) => r.test(nm(it))) && Date.now() - t0 < Math.max(3000, Number(process.env.LAB_CMD_WAIT_MS) || 0);) { await K.sync(); s = K.inv.slots; }
    if (r.test(nm(s[K.inv.selected])) && (s[K.inv.selected]?.count ?? 0) > 0) { lastUse[K.inv.selected] = ++useN; return; }
    let i = s.findIndex((it, k) => k < 9 && r.test(nm(it)));
    if (i >= 0) { lastUse[i] = ++useN; return K.act('slot', [String(i)]); }
    i = s.findIndex((it, k) => k >= 9 && r.test(nm(it)));
    if (i < 0) throw new Error(`${verb}: no ${String(what).replace(/^\(\^\|:\)|\$$/g, '')} in the inventory (console: give ${K.name} <item>)`);
    let t = [...Array(9).keys()].find((k) => !s[k]?.network_id);
    if (t === undefined) t = [...Array(9).keys()].sort((a, b) => lastUse[a] - lastUse[b])[0];
    await K.act('move', [String(i), String(t)]);
    lastUse[t] = ++useN;
    if (K.inv.selected !== t) await K.act('slot', [String(t)]);
  }
  const slotOf = (what) => { const r = re(what); const i = K.inv.slots.findIndex((it) => r.test(nm(it))); return i; };
  const useOn = (a, face, extra = []) => K.act('useon', [...xyz(a), ...(face ? [face] : []), ...extra]);
  // 'side': the side of the block facing the player, as a person clicks it (a ladder, a painting or cocoa beans hang on a side,
  // never on top)
  const sideToward = (a) => { const [x, , z] = xyz(a).map(Number), f = K.feet(), dx = f.x - (x + 0.5), dz = f.z - (z + 0.5); return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north'; };
  const tool = (item, face) => async (a) => { await grab(item, 'tool'); return useOn(a, face === 'side' ? sideToward(a) : face); };
  const onEntity = (item) => async (a) => { if (item) await grab(item, 'item'); return K.act('interact', a.slice(0, 1)); };
  const firstEmpty = () => { const i = K.inv.slots.findIndex((it, k) => k >= 9 && !it?.network_id); return i >= 0 ? i : K.inv.slots.findIndex((it) => !it?.network_id); };

  const V = {
    // ---- items in hand (right click / hold) ----
    eat: async (a) => { if (a[0] && !/^\d+$/.test(a[0])) await grab(a[0], 'eat'); return K.act('use', [String(n(a.find((x) => /^\d+$/.test(x)), 36))]); },   // 32 ticks to finish
    drink: async (a) => V.eat(a),
    bow: async (a) => { await grab('bow', 'bow'); return K.act('use', [String(n(a[0], 20))]); },   // 20 ticks = full draw
    crossbow: async (a) => { await grab('crossbow', 'crossbow'); await K.act('use', [String(n(a[0], 26))]); return K.act('use', []); },   // load, then shoot
    trident: async (a) => { await grab('trident', 'trident'); return K.act('use', [String(n(a[0], 12))]); },
    throw: async (a) => { if (a[0]) await grab(a[0], 'throw'); return K.act('use', []); },   // snowball egg ender_pearl splash_potion wind_charge ...
    pearl: async () => V.throw(['ender_pearl']),
    spyglass: async (a) => { await grab('spyglass', 'spyglass'); return K.act('use', [String(n(a[0], 40))]); },
    horn: async () => { await grab('goat_horn', 'horn'); return K.act('use', []); },
    firework: async () => { await grab('firework_rocket', 'firework'); return K.act('use', []); },   // while gliding: a boost
    map: async () => { await grab('empty_map', 'map'); return K.act('use', []); },
    shield: async (a) => {   // raise the shield: sneaking with it in the offhand, or holding right click with it in hand
      if (a[0] === 'off') { K.controls.sneak = false; return K.act('release', []); }
      if (/shield/.test(nm(K.inv.offhand[0]))) { K.controls.sneak = true; return K.ticks(6); }
      await grab('shield', 'shield'); return K.act('use', ['hold']);
    },
    // ---- tools on blocks ----
    till: tool(/_hoe$/, 'up'), flatten: tool(/_shovel$/, 'up'), strip: tool(/_axe$/), scrape: tool(/_axe$/), wax: tool('honeycomb'),
    bonemeal: tool('bone_meal'), light: tool(/flint_and_steel|fire_charge/, 'up'), scoop: tool('bucket'), charge: tool('glowstone'),
    plant: async (a) => { await grab(a[0], 'plant'); return useOn(a.slice(1), 'up'); },   // plant <seed> x y z (the farmland / dirt)
    pour: async (a) => { await grab(a[0], 'pour'); return useOn(a.slice(1), 'up'); },     // pour water_bucket|lava_bucket|powder_snow_bucket x y z
    disc: async (a) => { await grab(a[0], 'disc'); return useOn(a.slice(1)); },          // disc music_disc_cat x y z (jukebox)
    pot: async (a) => { await grab(a[0], 'pot'); return useOn(a.slice(1)); },            // flower pot, decorated pot, chiseled bookshelf, shelf
    compost: async (a) => { if (a[3]) await grab(a[3], 'compost'); return useOn(a); },
    brush: async (a) => { await grab('brush', 'brush'); await useOn(a, null, ['hold']); await K.ticks(n(a[3], 100)); return K.act('release', []); },
    toggle: (a) => useOn(a), tune: (a) => useOn(a), bell: (a) => useOn(a), cake: (a) => useOn(a),   // doors levers buttons trapdoors gates repeaters, note blocks, bells, cake
    play: (a) => K.act('dig', [...xyz(a), '1']),   // hit a note block
    harvest: (a) => K.act('dig', xyz(a)),
    place: async (a) => {   // place <item> x y z: like a person, click the top of the block below that spot
      await grab(a[0], 'place'); const [x, y, z] = xyz(a, 1).map(Number); return useOn([x, y - 1, z].map(String), 'up');
    },
    mine: async (a) => {   // mine x1 y1 z1 x2 y2 z2: every non-air block in the box, top layer first
      const [x1, y1, z1, x2, y2, z2] = a.map(Number); let c = 0;
      for (let y = Math.max(y1, y2); y >= Math.min(y1, y2); y--) for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
        const b = K.world.block(x, y, z); if (b && b.name === 'minecraft:air') continue;
        await K.act('dig', [x, y, z].map(String)); c++;
      }
      return K.say(`mined ${c}`);
    },
    pillar: async (a) => {   // pillar [n]: look down, jump, place under the feet at the top of the jump
      if (a[1]) await grab(a[1], 'pillar');
      for (let k = 0; k < n(a[0], 1); k++) {
        const f = K.feet(), x = Math.floor(f.x), y = Math.floor(f.y), z = Math.floor(f.z);
        // (clicked at the top of the jump, this tick, without waiting on the inventory: at a fixed tick count after an inventory round
        // trip the click came after the landing on a sped-up server; the server takes it against where it last had the player)
        K.look(K.yaw(), 90); K.controls.jump = true;
        for (let t = 0, prev = f.y; t < 10; t++) { await K.ticks(1); const fy = K.feet().y; if (fy >= y + 1.2 || (fy > y + 1.02 && fy <= prev + 1e-4)) break; prev = fy; }
        K.controls.jump = false;
        await useOn([x, y - 1, z].map(String), 'up', ['fast']); await K.ticks(6);
      }
      return K.ticks(2);
    },
    bridge: async (a) => {   // bridge [n]: sneak to the edge and place against the side of the block below, facing the yaw's axis
      if (a[1]) await grab(a[1], 'bridge');
      const r = (K.yaw() * Math.PI) / 180, dx = Math.round(-Math.sin(r)), dz = dx ? 0 : Math.round(Math.cos(r));
      const face = dx === 1 ? 'east' : dx === -1 ? 'west' : dz === 1 ? 'south' : 'north';
      K.controls.sneak = true;
      try {
        for (let k = 0; k < n(a[0], 1); k++) {
          const f = K.feet(), bx = Math.floor(f.x), by = Math.floor(f.y) - 1, bz = Math.floor(f.z);
          await useOn([bx, by, bz].map(String), face);
          await K.act('goto', [String(bx + dx + 0.5), String(bz + dz + 0.5)]);
        }
      } finally { K.controls.sneak = false; }
      return K.ticks(2);
    },
    // speed_bridge [n] [item]: a runner's bridge (Bedrock's fast bridging, the Hypixel speed bridge's aim): walking on without sneaking,
    // the next block set against the front of the one underfoot while the feet are still on it - 4.3 blocks a second, the sneaking
    // bridge's 1.3. (The feet stay up while the middle is less than 0.3 past the edge: the block is clicked 0.45 before the edge; if
    // it has not come by the edge itself, a sneak holds there until it does - the old sneak bridge as the safety net)
    speed_bridge: async (a) => {
      if (a[1]) await grab(a[1], 'speed_bridge');
      const r = (K.yaw() * Math.PI) / 180, ax = -Math.sin(r), az = Math.cos(r);
      const [dx, dz] = Math.abs(ax) > Math.abs(az) ? [Math.sign(ax), 0] : [0, Math.sign(az)];
      const face = dx === 1 ? 'east' : dx === -1 ? 'west' : dz === 1 ? 'south' : 'north', yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
      const want = n(a[0], 1), by = Math.floor(K.feet().y + 0.01) - 1, clicked = new Map(), t0 = Number(K.tick());
      const air = (x, z) => { const b = K.world.block(x, by, z); return !b || /:(air|water|flowing_water|short_grass|tall_grass|fern|snow_layer)$/.test(b.name); };
      let placed = 0;
      // (clicked at the face itself, not the block's middle: looking at the middle, once past it, turned the player round for a tick
      // and it walked back)
      const pt = dx ? [dx > 0 ? '1' : '0', '0.9', '0.5'] : ['0.5', '0.9', dz > 0 ? '1' : '0'];
      const run = (K.attrs()['player.hunger'] ?? 20) > 6 && !a.includes('walk');
      K.look(yaw, 72); K.controls.forward = true; K.controls.sprint = run;
      try {
        // the tip: the last block of the bridge (clicked on its far face; the cell under the feet is air once the middle is past an edge).
        // Judged every tick inside the tick (K.everyTick), not from a loop that may miss a burst of them
        let tx = Math.floor(K.feet().x), tz = Math.floor(K.feet().z), done = false, lastSid = null, lastAt = -99;
        const off = K.everyTick(() => {
          if (done) return;
          while (!air(tx + dx, tz + dz) && Math.abs(tx - Math.floor(K.feet().x)) + Math.abs(tz - Math.floor(K.feet().z)) < 3) { tx += dx; tz += dz; }
          const f = K.feet(), toEdge = dx ? (dx > 0 ? tx + 1 - f.x : f.x - tx) : (dz > 0 ? tz + 1 - f.z : f.z - tz);   // the middle to the tip's far edge
          // (and to the far edge of the last block the server has said yes to: a sped-up server answers ticks later, and a block it
          // turned down was walked onto and fallen through - the feet wait at that edge for its answer)
          let sx = tx, sz = tz; while ((sx !== Math.floor(f.x) || sz !== Math.floor(f.z)) && K.pending?.(sx, by, sz)) { sx -= dx; sz -= dz; }
          const sure = dx ? (dx > 0 ? sx + 1 - f.x : f.x - sx) : (dz > 0 ? sz + 1 - f.z : f.z - sz);
          if (placed >= want) { if (toEdge < 1.3) { K.controls.forward = K.controls.sprint = false; K.controls.sneak = true; done = true; } return; }
          const k = `${tx + dx},${tz + dz}`, sid = JSON.stringify(K.inv.slots[K.inv.selected]?.stack_id ?? null);
          // (one click per answer: the click names the held stack, and the server's new name for it comes back with the answer - a
          // second click on the old name, on a sped-up server, was turned down and the bridge had a hole)
          if (toEdge < (run ? 0.75 : 0.5) && Number(K.tick()) - (clicked.get(k) ?? -99) > 8 && (sid !== lastSid || Number(K.tick()) - lastAt > 12)) {
            if (!clicked.has(k)) placed++;
            clicked.set(k, Number(K.tick())); lastSid = sid; lastAt = Number(K.tick());
            useOn([tx, by, tz].map(String), face, [...pt, 'fast']).catch(() => {}); K.look(yaw, 72);
          }
          if (process.env.LAB_DEBUG_BRIDGE) K.say(`dbg bridge t${K.tick()} y${f.y.toFixed(2)} ${(dx ? f.x : f.z).toFixed(2)} tip ${dx ? tx : tz} edge ${toEdge.toFixed(2)} placed ${placed} sure ${sure.toFixed(2)}`);
          K.controls.sneak = toEdge < 0.12 || sure < 0.15; K.controls.sprint = run && !K.controls.sneak;   // (not come yet: the edge holds)
        });
        try { for (let t = 0; t < want * 40 + 40 && !done && !K.dead(); t++) await K.ticks(1); if (done) await K.ticks(6); } finally { off(); }
      } finally { K.controls.forward = K.controls.sneak = K.controls.sprint = false; }
      K.say(`speed_bridge: ${placed} blocks in ${((Number(K.tick()) - t0) / 20).toFixed(1)} s`);
      return K.ticks(2);
    },
    climb: async (a) => { Object.assign(K.controls, { forward: true, jump: true }); await K.ticks(n(a[0], 40)); K.controls.forward = K.controls.jump = false; return K.ticks(2); },
    sprintjump: async (a) => { Object.assign(K.controls, { forward: true, sprint: true }); for (let k = 0; k < n(a[0], 3); k++) { K.controls.jump = true; await K.ticks(2); K.controls.jump = false; await K.ticks(10); } K.controls.forward = K.controls.sprint = false; return K.ticks(2); },
    // ---- animals and other entities (right click with an item) ----
    feed: async (a) => { if (a[1]) await grab(a[1], 'feed'); return K.act('interact', [a[0]]); },
    breed: async (a) => {   // breed <type> [food]: feed the two nearest of that type
      if (a[1]) await grab(a[1], 'breed');
      const two = K.nearest(a[0]).slice(0, 2);
      if (two.length < 2) return K.say(`breed: fewer than 2 ${a[0]} in view`);
      for (const e of two) { await K.hit(e, 'interact'); await K.ticks(10); }
      return K.ticks(4);
    },
    tame: async (a) => { if (a[1]) await grab(a[1], 'tame'); for (let k = 0; k < n(a[2], 8); k++) { await K.act('interact', [a[0]]); await K.ticks(10); } return K.ticks(2); },
    shear: onEntity('shears'), milk: onEntity('bucket'), saddle: onEntity('saddle'), leash: onEntity('lead'), nametag: onEntity('name_tag'), unleash: onEntity(null),
    dye: async (a) => { await grab(a[1], 'dye'); return K.act('interact', [a[0]]); },
    pose: async (a) => { K.controls.sneak = true; await K.ticks(4); await K.act('interact', [a[0] ?? 'armor_stand']); K.controls.sneak = false; return K.ticks(2); },   // armor stand pose
    hjump: async (a) => { K.controls.jump = true; await K.ticks(n(a[0], 10)); K.controls.jump = false; return K.ticks(10); },   // horse: longer hold = higher
    // ---- equipment and the hotbar ----
    select: async (a) => grab(a[0], 'select'),
    equip: async (a) => {   // equip <slot|item>: onto the armor slot it belongs to (shield/totem: offhand)
      await K.sync();
      for (let t0 = Date.now(); !/^\d+$/.test(a[0]) && slotOf(a[0]) < 0 && Date.now() - t0 < Math.max(3000, Number(process.env.LAB_CMD_WAIT_MS) || 0);) await K.sync();   // just given: a moment to arrive
      const i = /^\d+$/.test(a[0]) ? +a[0] : slotOf(a[0]);
      if (i < 0 || !K.inv.slots[i]?.network_id) throw new Error(`equip: no ${a[0]} in the inventory`);
      const to = ARMOR.find(([r]) => r.test(nm(K.inv.slots[i])))?.[1];
      if (!to) throw new Error(`equip: ${nm(K.inv.slots[i])} is not worn`);
      return K.act('move', [String(i), to]);
    },
    unequip: async (a) => { await K.sync(); const i = firstEmpty(); if (i < 0) return K.say('unequip: inventory full'); return K.act('move', [a[0], String(i)]); },
    offhand: async (a) => { await K.sync(); const i = /^\d+$/.test(a[0]) ? +a[0] : slotOf(a[0]); if (i < 0) throw new Error(`offhand: no ${a[0]}`); return K.act('move', [String(i), 'offhand']); },
    // ---- longer errands ----
    smelt: async (a) => {   // smelt <item> x y z [fuel] [n]: open the furnace, put item + fuel in, wait for the output, take it
      const [x, y, z] = xyz(a, 1), fuel = a[4] ?? 'coal', cnt = n(a[5], 1);
      await K.sync();
      const si = slotOf(a[0]), fi = slotOf(fuel);
      if (si < 0 || fi < 0) throw new Error(`smelt: needs ${si < 0 ? a[0] : fuel} in the inventory`);
      await K.act('open', [x, y, z]);
      if (!K.box()) return K.say('smelt: the furnace did not open');
      await K.act('move', [String(si), 'box:0', String(cnt)]);
      await K.act('move', [String(fi), 'box:1', '1']);
      for (let k = 0; k < cnt * 220 && !((K.box()?.slots?.[2]?.count ?? 0) >= cnt); k++) await K.ticks(1);   // 200 ticks per item
      if (!K.box()?.slots?.[2]?.network_id) { await K.act('close', []); return K.say('smelt: nothing came out'); }
      await K.act('move', ['box:2', String(firstEmpty())]);
      return K.act('close', []);
    },
    follow: async (a) => { for (let k = 0; k < n(a[1], 100); k += 20) { const e = K.nearest(a[0])[0]; if (!e) return K.say(`follow: no ${a[0]} in view`); await K.act('goto', [String(Math.floor(e.x)), String(Math.floor(e.z))]); await K.ticks(20); } return K.ticks(1); },
    collect: async (a) => {   // walk over the dropped items in view (the server picks them up)
      let c = 0;
      for (let k = 0; k < n(a[0], 8); k++) { const e = K.nearest('item')[0]; if (!e) break; await K.act('goto', [e.x.toFixed(2), e.z.toFixed(2)]); await K.ticks(10); c++; }
      return K.say(`collect: visited ${c}`);
    },
    portal: async (a) => {   // portal x y z: walk into a portal and wait for the dimension change (the client acks it)
      const d0 = K.dim(); const [x, y, z] = xyz(a).map(Number);
      await K.act('goto', [String(x), String(z)]);   // (as near as the path finder goes: it does not step into the portal itself)
      // the last steps by the keys, into the portal's cell, and stand in it (a survival player waits 4 s in a portal); pushed out or
      // not quite in (the position seen is a few ticks old while walking), step in again
      const inPortal = () => { const f = K.feet(); return /portal/.test(K.world.block(Math.floor(f.x), Math.floor(f.y + 0.01), Math.floor(f.z))?.name ?? ''); };
      const near = () => { const f = K.feet(); return Math.abs(f.x - (x + 0.5)) < 0.3 && Math.abs(f.z - (z + 0.5)) < 0.3 && Math.floor(f.y + 0.01) >= y; };
      for (let k = 0; k < 360 && K.dim() === d0; k++) {
        if (inPortal() || near()) { K.controls.forward = K.controls.jump = false; await K.ticks(1); continue; }
        const f = K.feet(); K.look((Math.atan2(-(x + 0.5 - f.x), z + 0.5 - f.z) * 180) / Math.PI, 0); K.controls.forward = true; K.controls.jump = y > Math.floor(f.y + 0.01);
        await K.ticks(1);
      }
      K.controls.forward = K.controls.jump = false;
      return K.dim() === d0 ? K.say('portal: no dimension change') : K.ticks(20);
    },
    tell: (a) => K.act('cmd', ['tell', ...a]),
    me: (a) => K.act('cmd', ['me', ...a]),
  };

  // ---- the same mechanisms, named for what a player means (a table keeps them honest and short) ----
  // on a block with an item:  name: [item, face?]      (x y z after the name)
  const ON_BLOCK = {
    fill_bottle: ['glass_bottle'], honey: ['glass_bottle'], honeycomb: ['shears'], carve: ['shears'], cocoa: ['cocoa_beans', 'side'],
    torch: ['torch', 'up'], lantern: ['lantern'], end_eye: ['ender_eye', 'up'], lodestone: ['compass'], campfire_out: [/_shovel$/, 'up'],
    tnt: ['flint_and_steel'], portal_light: ['flint_and_steel', 'up'], candle: ['flint_and_steel'], glow_sign: ['glow_ink_sac'], wax_sign: ['honeycomb'],
    minecart: ['minecart', 'up'], boat: [/(^|:)\w*boat$/, 'up'], armor_stand: ['armor_stand', 'up'], rail: ['rail', 'up'], ladder: ['ladder', 'side'],
    painting: ['painting', 'side'], item_frame: [/(^|:)(glow_)?frame$|item_frame/], lily_pad: ['waterlily', 'up'], spawner: [/_spawn_egg$/],
    water: ['water_bucket', 'up'], lava: ['lava_bucket', 'up'], snow: ['powder_snow_bucket', 'up'], path: [/_shovel$/, 'up'], farmland: [/_hoe$/, 'up'],
  };
  // on a block with an empty or current hand (the block reacts): doors, switches, food blocks ...
  const CLICK = ['door', 'trapdoor', 'gate', 'lever', 'button', 'repeater', 'comparator', 'daylight', 'berries', 'glow_berries', 'jukebox_eject',
    'candle_out', 'spawnpoint', 'crafting_table', 'chest', 'barrel', 'ender_chest', 'shulker', 'furnace', 'anvil_open', 'loom_open', 'bed', 'dragon_egg', 'sign_read', 'vault'];
  // on a mob with an item: name: [item]                (mob type/name after the name)
  const ON_MOB = {
    bucket_fish: ['water_bucket'], bowl: ['bowl'], stew: [/_flower$|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley/], armor: [/horse_armor|wolf_armor|carpet$/],
    chest_on: ['chest'], brush_mob: ['brush'], allay_give: [], repair: ['iron_ingot'], ignite: ['flint_and_steel'], cure: ['golden_apple'],
    wolf_bone: ['bone'], cat_fish: [/cod$|salmon$/], parrot_seed: ['wheat_seeds'], horse_food: [/golden_apple|golden_carrot|apple|sugar|wheat|hay_block/],
    sit: [], pet: [], mount_chest: [], spawn_baby: [/_spawn_egg$/],
  };
  // in hand, right click (a hold time where it has one)
  const IN_HAND = { potion: ['potion', 36], splash: ['splash_potion', 0], lingering: ['lingering_potion', 0], snowball: ['snowball', 0], egg: ['egg', 0],
    wind_charge: ['wind_charge', 0], xp_bottle: ['experience_bottle', 0], fishing_rod: ['fishing_rod', 0], read: [/(^|:)(written|writable)_book$/, 0], compass_read: ['compass', 0],
    totem: ['totem_of_undying', 0], milk_drink: ['milk_bucket', 36], honey_drink: ['honey_bottle', 44], steer: [/carrot_on_a_stick|warped_fungus_on_a_stick/, 0],
    elytra_boost: ['firework_rocket', 0], goat_horn: ['goat_horn', 0], bundle_open: ['bundle', 0], ominous: ['ominous_bottle', 36] };
  for (const [k, [item, face]] of Object.entries(ON_BLOCK)) V[k] ??= tool(item, face);
  for (const k of CLICK) V[k] ??= (a) => useOn(a);
  for (const [k, [item]] of Object.entries(ON_MOB)) V[k] ??= async (a) => { if (item) await grab(item, k); else if (a[1]) await grab(a[1], k); return K.act('interact', [a[0]]); };
  for (const [k, [item, t]] of Object.entries(IN_HAND)) V[k] ??= async (a) => { await grab(item, k); return K.act('use', t ? [String(n(a[0], t))] : []); };

  // movement a player does with keys (held for ticks)
  const keys = (c) => async (a) => { Object.assign(K.controls, c); await K.ticks(n(a[0], 20)); for (const q of Object.keys(c)) K.controls[q] = false; return K.ticks(2); };
  Object.assign(V, {
    swim_up: keys({ jump: true }), dive: keys({ sneak: true }), descend: keys({ sneak: true }), crouch_walk: keys({ sneak: true, forward: true }),
    backpedal: keys({ back: true }), strafe_left: keys({ left: true }), strafe_right: keys({ right: true }), jump_over: keys({ forward: true, jump: true }),
    run: keys({ forward: true, sprint: true }), wave: (a) => K.act('emote', a),
    drop_all: async (a) => { await K.sync(); const s = /^\d+$/.test(a[0] ?? '') ? +a[0] : K.inv.selected; const it = K.inv.slots[s]; if (!it?.network_id) return K.say('drop_all: empty'); return K.act('drop', [String(it.count), ...(s === K.inv.selected ? [] : [String(s)])]); },
    barter: async () => { await grab('gold_ingot', 'barter'); return K.act('drop', ['1']); },   // near a piglin: it picks up the gold
    cure_villager: async (a) => { await V.throw(['splash_potion']); await K.ticks(10); await grab('golden_apple', 'cure'); return K.act('interact', [a[0] ?? 'zombie_villager']); },
    mountinv: () => K.act('open', []),   // while riding: the mount's inventory (horse armor, saddle, chest)
    store: async (a) => {   // store <item> x y z: open the container and shift-click the item in
      await K.act('open', xyz(a, 1)); if (!K.box()) return K.say('store: nothing opened');
      const i = slotOf(a[0]); if (i < 0) { await K.act('close', []); return K.say(`store: no ${a[0]}`); }
      await K.act('quick', [String(i)]); return K.act('close', []);
    },
    retrieve: async (a) => {   // retrieve <item> x y z: open the container and shift-click the item out
      await K.act('open', xyz(a, 1)); const b = K.box(); if (!b) return K.say('retrieve: nothing opened');
      const r = re(a[0]), i = (b.slots ?? []).findIndex((it) => r.test(nm(it)));
      if (i < 0) { await K.act('close', []); return K.say(`retrieve: no ${a[0]} inside`); }
      await K.act('quick', ['box:' + i]); return K.act('close', []);
    },
    brew: async (a) => {   // brew <ingredient> x y z: bottles into the three slots, ingredient on top, blaze powder as fuel, wait, take
      await K.act('open', xyz(a, 1)); if (!K.box()) return K.say('brew: the stand did not open');
      for (const [what, to] of [[a[0], 'box:0'], ['blaze_powder', 'box:4']]) { const i = slotOf(what); if (i >= 0) await K.act('move', [String(i), to, '1']); }
      for (const k of [1, 2, 3]) { const i = slotOf(/potion$/); if (i >= 0) await K.act('move', [String(i), 'box:' + k, '1']); }
      await K.ticks(n(a[4], 420));
      for (const k of [1, 2, 3]) if (K.box()?.slots?.[k]?.network_id) await K.act('quick', ['box:' + k]);
      return K.act('close', []);
    },
    chop: async (a) => {   // chop x y z: the log column from there up (a tree trunk)
      let [x, y, z] = xyz(a).map(Number), c = 0;
      for (; c < 16; y++) { const b = K.world.block(x, y, z); if (!b || !/log|stem|wood/.test(b.name)) break; await K.act('dig', [x, y, z].map(String)); c++; }
      return K.say(`chop: ${c} logs`);
    },
    dig_down: async (a) => { for (let k = 0; k < n(a[0], 3); k++) { const f = K.feet(); await K.act('dig', [Math.floor(f.x), Math.floor(f.y) - 1, Math.floor(f.z)].map(String)); await K.ticks(8); } return K.ticks(2); },
    tunnel: async (a) => {   // tunnel [n]: 2 blocks high, straight ahead along the yaw's axis, walking into it
      const r = (K.yaw() * Math.PI) / 180, dx = Math.round(-Math.sin(r)), dz = dx ? 0 : Math.round(Math.cos(r));
      for (let k = 0; k < n(a[0], 3); k++) { const f = K.feet(), x = Math.floor(f.x) + dx, y = Math.floor(f.y), z = Math.floor(f.z) + dz; for (const h of [1, 0]) { const b = K.world.block(x, y + h, z); if (!b || b.name !== 'minecraft:air') await K.act('dig', [x, y + h, z].map(String)); } await K.act('goto', [String(x + 0.5), String(z + 0.5)]); }
      return K.ticks(2);
    },
    farm: async (a) => {   // farm <seed> x1 z1 x2 z2 y: till the dirt/grass at y and plant the seed on it
      const [x1, z1, x2, z2, y] = a.slice(1).map(Number); let c = 0;
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) { await V.till([x, y, z].map(String)); await V.plant([a[0], x, y, z].map(String)); c++; }
      return K.say(`farm: ${c} planted`);
    },
    fill: async (a) => {   // fill <item> x1 y1 z1 x2 y2 z2: place the item in every air spot of the box, bottom layer first
      const [x1, y1, z1, x2, y2, z2] = a.slice(1).map(Number); let c = 0;
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
        const b = K.world.block(x, y, z); if (b && b.name !== 'minecraft:air') continue;
        // looked at again after a moment and tried once more if it did not go down (the block clicked had changed under the click:
        // dirt set a moment ago had turned to grass, and the server refused the click)
        for (let tr = 0; tr < 2; tr++) { await V.place([a[0], x, y, z].map(String)); for (let k = 0; k < 6 && (K.world.block(x, y, z)?.name ?? 'minecraft:air') === 'minecraft:air'; k++) await K.ticks(1); if ((K.world.block(x, y, z)?.name ?? 'minecraft:air') !== 'minecraft:air') { c++; break; } }
      }
      return K.say(`fill: ${c} placed`);
    },
    hang: async (a) => { await grab(a[0], 'hang'); return useOn(a.slice(1, 4), a[4] ?? 'north'); },   // hang <item> x y z <face>: on a wall side
  });

  // ---- v37: the rest of a player's day. Same rule: pick the tool like a person, then only the measured primitives. ----
  const axis = () => { const r = (K.yaw() * Math.PI) / 180, dx = Math.round(-Math.sin(r)); return [dx, dx ? 0 : Math.round(Math.cos(r))]; };
  const here = () => { const f = K.feet(); return [Math.floor(f.x), Math.floor(f.y), Math.floor(f.z)]; };
  const box2 = (a, i = 0) => { const v = a.slice(i, i + 4).map(Number); if (v.length < 4 || v.some((x) => !Number.isFinite(x))) throw new Error('needs x1 z1 x2 z2'); const [x1, z1, x2, z2] = v; return [Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2)]; };
  const has = (what) => slotOf(what) >= 0;
  const aimAt = (e) => K.lookAt(e.x, e.y + (e.bh > 0 ? e.bh / 2 : 0.8), e.z);
  const FOODS = ['golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'cooked_chicken', 'cooked_cod', 'rabbit_stew', 'mushroom_stew', 'baked_potato', 'bread', 'cooked_rabbit', 'pumpkin_pie', 'apple', 'carrot', 'melon_slice', 'sweet_berries', 'cookie', 'beetroot', 'potato', 'beef', 'porkchop', 'chicken', 'mutton', 'dried_kelp'];
  const WORN = /helmet|chestplate|leggings|boots|elytra|turtle_helmet/;
  Object.assign(V, {
    // combat
    fight: async (a) => {   // fight <mob> [hits]: face it and hit when the swing has recharged, walking in when it is out of reach
      let c = 0;
      for (; c < n(a[1], 10); c++) {
        const e = K.nearest(a[0])[0]; if (!e) break;
        const f = K.feet(); if (Math.hypot(e.x - f.x, e.z - f.z) > 3) await K.act('goto', [String(Math.floor(e.x)), String(Math.floor(e.z)), '', '40']);
        aimAt(e); await K.act('attack', [a[0]]); await K.ticks(10);
      }
      return K.say(`fight: ${c} hits`);
    },
    crit: async (a) => { const e = K.nearest(a[0])[0]; if (!e) return K.say(`crit: no ${a[0]} in view`); aimAt(e); K.controls.jump = true; await K.ticks(2); K.controls.jump = false; await K.ticks(5); return K.act('attack', [a[0]]); },   // hit while falling
    shoot: async (a) => { await grab('bow', 'shoot'); const e = K.nearest(a[0])[0]; if (!e) return K.say(`shoot: no ${a[0]} in view`); K.lookAt(e.x, e.y + 1.5, e.z); return K.act('use', [String(n(a[1], 20))]); },
    throw_at: async (a) => { await grab(a[0], 'throw_at'); const e = K.nearest(a[1])[0]; if (!e) return K.say(`throw_at: no ${a[1]} in view`); K.lookAt(e.x, e.y + 1.2, e.z); return K.act('use', []); },
    flee: async (a) => { const e = (a[0] ? K.nearest(a[0]) : K.all())[0]; if (e) { const f = K.feet(); K.look((Math.atan2(f.x - e.x, e.z - f.z) * 180) / Math.PI, 0); } return V.run([String(n(a[1], 40))]); },
    hunt: async (a) => { await V.follow([a[0], '40']); return V.fight([a[0], a[1] ?? '10']); },
    shield_block: async (a) => { await V.shield([]); await K.ticks(n(a[0], 40)); return V.shield(['off']); },
    // staying alive
    heal: async () => V.eat(['golden_apple']),
    eat_best: async (a) => {   // eat_best [always]: the most filling food carried, only when hungry (like a person glancing at the bar)
      await K.sync(); const food = K.attrs()['player.hunger'];
      if (a[0] !== 'always' && food !== undefined && food >= 20) return K.say('eat_best: not hungry');
      const f = FOODS.find(has); if (!f) return K.say('eat_best: no food'); return V.eat([f]);
    },
    armor_up: async () => { await K.sync(); let c = 0; for (let i = 0; i < 36; i++) { const it = K.inv.slots[i]; if (it?.network_id && WORN.test(nm(it))) { await V.equip([String(i)]); c++; } } return K.say(`armor_up: ${c} worn`); },
    clutch: async () => {   // water bucket clutch: look straight down, pour on the ground just before landing, scoop it back
      await grab('water_bucket', 'clutch'); K.look(K.yaw(), 90);
      const [x, y0, z] = here(); let g = y0 - 1; for (; g > y0 - 64; g--) { const b = K.world.block(x, g, z); if (b && b.name !== 'minecraft:air') break; }
      // pour when the landing is at most ~2 ticks away at the speed seen (slow falls: 3 blocks), never beyond reach (4 blocks)
      for (let k = 0, prev = K.feet().y; k < 100; k++) { const y = K.feet().y, v = Math.max(0, prev - y); prev = y; if (process.env.LAB_DEBUG) K.say(`dbg clutch ms=${Date.now() % 100000} y=${y.toFixed(2)} v=${v.toFixed(2)} g=${g}`); if (y - (g + 1) <= Math.min(4, Math.max(3, v * 2.5 + 0.5))) break; await K.ticks(1); }
      await useOn([x, g, z].map(String), 'up'); await K.ticks(10); await grab('bucket', 'clutch'); return useOn([x, g, z].map(String), 'up');
    },
    extinguish: (a) => K.act('dig', xyz(a)),   // punch the fire
    sleep_night: async (a) => { await K.act('sleep', xyz(a)); await K.ticks(n(a[3], 120)); return K.act('wake', []); },
    // nature and farming
    harvest_area: async (a) => { const [x1, z1, x2, z2] = box2(a), y = n(a[4], 0); let c = 0; for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) { const b = K.world.block(x, y, z); if (b && b.name === 'minecraft:air') continue; await K.act('dig', [x, y, z].map(String)); c++; } return K.say(`harvest_area: ${c}`); },
    replant: async (a) => { const [x1, z1, x2, z2] = box2(a, 1), y = n(a[5], 0); let c = 0; for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) { await K.act('dig', [x, y, z].map(String)); await K.ticks(4); await V.plant([a[0], x, y - 1, z].map(String)); c++; } return K.say(`replant: ${c}`); },   // replant <seed> x1 z1 x2 z2 y(crop)
    sapling: async (a) => { await grab(a[0] ?? /_sapling$|propagule/, 'sapling'); return useOn(a.slice(1), 'up'); },
    grow: async (a) => { for (let k = 0; k < n(a[3], 3); k++) { await V.bonemeal(a); await K.ticks(6); } return K.ticks(1); },
    pick_flower: (a) => K.act('dig', xyz(a)),
    fill_cauldron: tool('water_bucket'), cauldron_bottle: tool('glass_bottle'),
    wash: async (a) => { await grab(a[0], 'wash'); return useOn(a.slice(1)); },   // wash <leather armor|banner|shulker> x y z (cauldron)
    campfire_cook: async (a) => { await grab(a[0], 'campfire_cook'); return useOn(a.slice(1)); },
    fish_n: async (a) => { await grab('fishing_rod', 'fish_n'); for (let k = 0; k < n(a[0], 3); k++) await K.act('fish', [String(n(a[1], 30))]); return K.ticks(1); },
    compost_all: async (a) => { let c = 0; for (; c < 64 && has(a[3]); c++) { await V.compost(a); await K.ticks(4); await K.sync(); } return K.say(`compost_all: ${c}`); },
    herd: async (a) => { await grab(a[0], 'herd'); await K.act('goto', a.slice(1, 3)); return K.ticks(20); },   // herd <food> x z: animals follow the food in hand
    tie: tool('lead'),   // tie x y z: a leashed mob onto the fence
    // chests and the inventory
    unload: async (a) => {   // unload x y z: shift-click everything except tools, weapons, armor and food into the container
      await K.act('open', xyz(a)); if (!K.box()) return K.say('unload: nothing opened');
      let c = 0; for (let i = 9; i < 36; i++) { const it = K.inv.slots[i]; if (!it?.network_id || /_(sword|pickaxe|axe|shovel|hoe)$|bow|shield|trident|mace/.test(nm(it)) || WORN.test(nm(it)) || FOODS.some((f) => nm(it).endsWith(f))) continue; await K.act('quick', [String(i)]); c++; }
      await K.act('close', []); return K.say(`unload: ${c} stacks`);
    },
    loot: async (a) => { await K.act('open', xyz(a)); const b = K.box(); if (!b) return K.say('loot: nothing opened'); let c = 0; for (let i = 0; i < (b.slots ?? []).length; i++) if (b.slots[i]?.network_id) { await K.act('quick', ['box:' + i]); c++; } await K.act('close', []); return K.say(`loot: ${c} stacks`); },
    sort: async () => {   // sort the main inventory by item name with swaps (the hotbar stays where the hands expect it)
      await K.sync(); const s = K.inv.slots; let c = 0;
      for (let i = 9; i < 36; i++) { let best = i; for (let j = i + 1; j < 36; j++) { const a1 = nm(s[j]) || '~', b1 = nm(s[best]) || '~'; if (a1 < b1) best = j; } if (best !== i) { await K.act('swap', [String(i), String(best)]); [s[i], s[best]] = [s[best], s[i]]; c++; } }
      return K.say(`sort: ${c} swaps`);
    },
    discard: async (a) => { await K.sync(); await K.act('open', []); let c = 0; for (let i = 0; i < 36; i++) { const it = K.inv.slots[i]; if (it?.network_id && re(a[0]).test(nm(it))) { await K.act('drop', [String(it.count), String(i)]); c++; } } await K.act('close', []); return K.say(`discard: ${c} stacks`); },
    give_to: async (a) => { const e = K.nearest(a[0])[0]; if (!e) return K.say(`give_to: no ${a[0]} in view`); await K.act('goto', [String(Math.floor(e.x)), String(Math.floor(e.z)), '', '60']); aimAt(e); await grab(a[1], 'give_to'); return K.act('drop', [String(n(a[2], 1))]); },
    craft_at: async (a) => { await K.act('open', xyz(a)); if (!K.box()) return K.say('craft_at: the table did not open'); await K.act('craft', [a[3], a[4] ?? '1']); return K.act('close', []); },   // craft_at x y z <item> [n]
    cook: async (a) => V.smelt(a), blast: async (a) => V.smelt(a),   // smoker / blast furnace: the same screen as a furnace
    refuel: async (a) => { const [x, y, z] = xyz(a); await K.act('open', [x, y, z]); if (!K.box()) return K.say('refuel: nothing opened'); const i = slotOf(a[3] ?? 'coal'); if (i >= 0) await K.act('move', [String(i), 'box:1']); return K.act('close', []); },
    take_output: async (a) => { await K.act('open', xyz(a)); if (!K.box()) return K.say('take_output: nothing opened'); if (K.box()?.slots?.[2]?.network_id) await K.act('quick', ['box:2']); return K.act('close', []); },
    // building
    floor: async (a) => { const [x1, z1, x2, z2] = box2(a, 1), y = n(a[5], 0); return V.fill([a[0], x1, y, z1, x2, y, z2].map(String)); },     // floor <item> x1 z1 x2 z2 y
    wall: async (a) => { const [x1, z1, x2, z2] = box2(a, 1), y = n(a[5], 0); return V.fill([a[0], x1, y, z1, x2, y + n(a[6], 3) - 1, z2].map(String)); },   // wall <item> x1 z1 x2 z2 y [h]
    line: async (a) => { const [x1, z1, x2, z2] = box2(a, 1), y = n(a[5], 0); return V.fill([a[0], x1, y, z1, x1 === x2 ? x1 : x2, y, x1 === x2 ? z2 : z1].map(String)); },
    sneak_place: async (a) => { await grab(a[0], 'sneak_place'); K.controls.sneak = true; await K.ticks(4); try { await useOn(a.slice(1, 4), a[4] ?? 'up'); } finally { K.controls.sneak = false; } return K.ticks(2); },   // against a chest / door without opening it
    light_up: async (a) => { const [x1, z1, x2, z2] = box2(a), y = n(a[4], 0), st = n(a[5], 6); let c = 0; for (let x = x1; x <= x2; x += st) for (let z = z1; z <= z2; z += st) { const f = K.feet(); if (Math.hypot(x + 0.5 - f.x, z + 0.5 - f.z) > 3.5) await K.act('goto', [String(x + 1.5), String(z + 0.5)]); await V.torch([x, y - 1, z].map(String)); c++; } return K.say(`light_up: ${c} torches`); },   // walks within reach of each spot
    stair_down: async (a) => { const [dx, dz] = axis(); for (let k = 0; k < n(a[0], 3); k++) { const [x, y, z] = here(); for (const h of [1, 0, -1]) await K.act('dig', [x + dx, y + h, z + dz].map(String)); await K.act('goto', [String(x + dx + 0.5), String(z + dz + 0.5)]); } return K.ticks(2); },
    stair_up: async (a) => { const [dx, dz] = axis(); for (let k = 0; k < n(a[0], 3); k++) { const [x, y, z] = here(); for (const h of [2, 1]) await K.act('dig', [x, y + h, z].map(String)); for (const h of [2, 1]) await K.act('dig', [x + dx, y + h, z + dz].map(String)); K.controls.forward = K.controls.jump = true; await K.ticks(6); K.controls.forward = K.controls.jump = false; await K.ticks(4); } return K.ticks(2); },
    strip_mine: async (a) => { const [dx, dz] = axis(); for (let k = 1; k <= n(a[0], 16); k++) { await V.tunnel(['1']); if (k % 8 === 0 && has('torch')) { const [x, y, z] = here(); await V.hang(['torch', x - dz, y + 1, z + dx, dz ? (dz > 0 ? 'east' : 'west') : (dx > 0 ? 'south' : 'north')].map(String)).catch(() => {}); } } return K.ticks(2); },
    // getting around
    wander: async (a) => { for (let k = 0; k < n(a[0], 3); k++) { K.look(K.yaw() + (Math.random() * 180 - 90), 0); K.controls.forward = true; await K.ticks(20); K.controls.forward = false; await K.ticks(5); } return K.ticks(1); },
    look_around: async () => K.act('turn', ['360', '0', '40']),
    turn_around: async () => K.act('turn', ['180', '0', '8']),
    face: async (a) => { const Y = { south: 0, west: 90, north: 180, east: -90 }; if (a[0] === 'up' || a[0] === 'down') { K.look(K.yaw(), a[0] === 'up' ? -90 : 90); return K.ticks(2); } if (!(a[0] in Y)) throw new Error('face north|south|east|west|up|down'); K.look(Y[a[0]], 0); return K.ticks(2); },
    sprint_to: async (a) => { K.controls.sprint = true; try { return await K.act('goto', a); } finally { K.controls.sprint = false; } },
    swim_to: async (a) => { const f = K.feet(), tx = +a[0], tz = +a[1]; K.look((Math.atan2(f.x - tx, tz - f.z) * 180) / Math.PI, 0); await K.act('swim', [String(Math.max(10, Math.round(Math.hypot(tx - f.x, tz - f.z) * 4)))]); return K.act('goto', a); },
    mark: async (a) => { const f = K.feet(); K.memo.set(a[0] ?? 'home', [f.x, f.y, f.z]); return K.say(`mark ${a[0] ?? 'home'} ${f.x.toFixed(1)} ${f.y.toFixed(1)} ${f.z.toFixed(1)}`); },
    goback: async (a) => { const p = K.memo.get(a[0] ?? 'home'); if (!p) return K.say(`goback: no mark ${a[0] ?? 'home'} (mark it first)`); return K.act('goto', [String(Math.floor(p[0])), String(Math.floor(p[2]))]); },
    row: keys({ forward: true }),   // in a boat: both paddles
    ride_to: async (a) => { await K.act('ride', [a[0]]); await K.act('goto', a.slice(1, 3)); return K.act('dismount', []); },   // ride_to <mount> x z
    elytra_fly: async (a) => { K.controls.jump = true; await K.ticks(2); K.controls.jump = false; await K.ticks(6); await K.act('glide', ['10']); for (let k = 0; k < n(a[0], 2); k++) { if (has('firework_rocket')) await V.firework(); await K.ticks(40); } return K.ticks(1); },
    riptide: async (a) => { await grab('trident', 'riptide'); return K.act('use', [String(n(a[0], 12))]); },
    peek: async (a) => { K.controls.sneak = true; K.controls.forward = true; await K.ticks(n(a[0], 10)); K.controls.forward = false; K.look(K.yaw(), 70); await K.ticks(20); K.controls.sneak = false; return K.ticks(2); },
    afk: async (a) => { for (let k = 0; k < n(a[0], 3); k++) { await K.ticks(60); K.look(K.yaw() + 15, K.pitch()); await K.ticks(2); K.look(K.yaw() - 15, K.pitch()); } return K.ticks(1); },
    // people
    look_player: async (a) => { const e = K.nearest(a[0] ?? 'player')[0] ?? K.nearest('minecraft:player')[0]; if (!e) return K.say('look_player: nobody in view'); K.lookAt(e.x, e.y + 1.6, e.z); return K.ticks(2); },
    greet: async (a) => { await V.look_player(a.slice(0, 1)); await K.act('chat', [a[1] ?? 'hi']); return K.act('emote', []); },
    nod: async (a) => { for (let k = 0; k < n(a[0], 2); k++) { K.controls.sneak = true; await K.ticks(4); K.controls.sneak = false; await K.ticks(4); } return K.ticks(1); },
    trade_with: async (a) => { await K.act('interact', [a[0] ?? 'villager']); if (!K.box()) return K.say('trade_with: no trade screen'); await K.act('trade', [a[1] ?? '0']); return K.act('close', []); },
    report: async () => { await K.act('status', []); await K.act('target', []); return K.act('near', []); },   // one line each: what an AI checks before deciding
  });

  // ---- v40: everything else a player does (common/verbs-more.cjs), on the same helpers and the same rule ----
  const more = require('./verbs-more.cjs').moreVerbs(K, { V, nm, re, n, xyz, grab, slotOf, useOn, keys, has, aimAt, axis, here, box2, firstEmpty, FOODS, WORN, ARMOR });
  for (const [k, f] of Object.entries(more)) { if (k in V) throw new Error(`verb ${k} is defined twice`); V[k] = f; }
  // ---- v41: a verb for every item, block and mob (common/verbs-gen.cjs: get_ rta_ craft_ smelt_ mine_ find_ place_ hold_ drop_ kill_ goto_) ----
  const gen = require('./verbs-gen.cjs').genVerbs(K, { V, nm, re, n, grab, has, slotOf, firstEmpty }, more.__goal, new Set(Object.keys(V)));
  for (const [k, f] of Object.entries(gen)) V[k] = f;
  return V;
}
module.exports = { makeVerbs, FACES };
