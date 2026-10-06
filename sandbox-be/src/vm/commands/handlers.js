// 各コマンド

// ---- 各コマンド -------------------------------------------------------------

const gmName = (v) => ({ 0: 'Survival', s: 'Survival', survival: 'Survival', 1: 'Creative', c: 'Creative', creative: 'Creative', 2: 'Adventure', a: 'Adventure', adventure: 'Adventure', spectator: 'Spectator', 5: 'Survival', d: 'Survival', default: 'Survival' })[String(v).toLowerCase()];

// 実測: 独自アイテムは「item.<id>」、独自ブロックは「tile.<id>.name」、バニラは英語名（ここでは id から作る近似）
const giveName = (id) => (id.startsWith('minecraft:') ? id.slice(10).split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : packDef('blocks', id) && !packDef('items', id) ? `tile.${id}.name` : `item.${id}`);

const H = {
  setblock(a, src) {
    const p = pos3(a, 0, src.pos, true);
    const { perm, used } = blockSpec(a[3], a[4]);
    const mode = a[3 + used] ?? 'replace';
    if (!['replace', 'destroy', 'keep'].includes(mode)) throw new Syntax(`setblock の方式 ${mode} は不明です`);
    assertBox(src.dim, p, p);
    const cur = readBlock(src.dim, p.x, p.y, p.z);
    if (mode === 'keep' && cur.id !== 'minecraft:air') throw new Failed('Could not set the block');
    if (samePerm(cur, perm) && Object.keys(cur.states).length === Object.keys(perm.states).length) throw new Failed('Could not set the block');
    writeBlock(src.dim, p.x, p.y, p.z, perm);
    return { message: 'Block placed' };
  },
  fill(a, src) {
    const p1 = pos3(a, 0, src.pos, true);
    const p2 = pos3(a, 3, src.pos, true);
    const { perm, used } = blockSpec(a[6], a[7]);
    const mode = a[6 + used] ?? 'replace';
    if (!['replace', 'destroy', 'keep', 'hollow', 'outline'].includes(mode)) throw new Syntax(`fill の方式 ${mode} は不明です`);
    const box = assertBox(src.dim, p1, p2);
    if (box.count > FILL_LIMIT) throw new Failed(`Too many blocks in the specified area (${box.count} > ${FILL_LIMIT})`);
    let filter = null;
    if (mode === 'replace' && a[6 + used + 1] !== undefined) {
      const f = blockSpec(a[6 + used + 1], a[6 + used + 2]);
      filter = f.perm;
      filter.partial = !String(a[6 + used + 1]).includes('[');
    }
    let n = 0;
    const { lo, hi } = box;
    for (let x = lo.x; x <= hi.x; x++) {
      for (let y = lo.y; y <= hi.y; y++) {
        for (let z = lo.z; z <= hi.z; z++) {
          const edge = x === lo.x || x === hi.x || y === lo.y || y === hi.y || z === lo.z || z === hi.z;
          const cur = readBlock(src.dim, x, y, z);
          let target = perm;
          if (mode === 'hollow' && !edge) target = makePerm('minecraft:air');
          if (mode === 'outline' && !edge) continue;
          if (mode === 'keep' && cur.id !== 'minecraft:air') continue;
          if (filter && (filter.partial ? cur.id !== filter.id : !samePerm(cur, filter))) continue;
          if (cur.id === target.id && JSON.stringify(cur.states) === JSON.stringify(target.states)) continue;
          writeBlock(src.dim, x, y, z, target);
          n++;
        }
      }
    }
    if (n === 0) throw new Failed('0 blocks filled');
    return { successCount: 1, message: `${n} blocks filled` };
  },
  clone(a, src) {
    const p1 = pos3(a, 0, src.pos, true);
    const p2 = pos3(a, 3, src.pos, true);
    const d = pos3(a, 6, src.pos, true);
    const mask = a[9] ?? 'replace';
    const cloneMode = a[10] ?? 'normal';
    if (!['replace', 'masked', 'filtered'].includes(mask)) throw new Syntax(`clone の方式 ${mask} は不明です`);
    if (!['normal', 'force', 'move'].includes(cloneMode)) throw new Syntax(`clone の方式 ${cloneMode} は不明です`);
    const box = assertBox(src.dim, p1, p2);
    if (box.count > FILL_LIMIT) throw new Failed(`Too many blocks in the specified area (${box.count} > ${FILL_LIMIT})`);
    const off = { x: d.x - box.lo.x, y: d.y - box.lo.y, z: d.z - box.lo.z };
    const dst = assertBox(src.dim, d, { x: box.hi.x + off.x, y: box.hi.y + off.y, z: box.hi.z + off.z });
    const overlap = ['x', 'y', 'z'].every((k) => box.lo[k] <= dst.hi[k] && dst.lo[k] <= box.hi[k]);
    if (overlap && cloneMode === 'normal') throw new Failed('Source and destination can not overlap');
    let filter = null;
    if (mask === 'filtered') {
      if (a[11] === undefined) throw new Syntax('filtered にはブロックの指定が要ります');
      filter = blockSpec(a[11], a[12]).perm;
    }
    const copied = [];
    for (let x = box.lo.x; x <= box.hi.x; x++) for (let y = box.lo.y; y <= box.hi.y; y++) for (let z = box.lo.z; z <= box.hi.z; z++) {
      const b = readBlock(src.dim, x, y, z);
      if (mask === 'masked' && b.id === 'minecraft:air') continue;
      if (filter && b.id !== filter.id) continue;
      copied.push([x, y, z, b]);
    }
    if (cloneMode === 'move') for (const [x, y, z] of copied) writeBlock(src.dim, x, y, z, makePerm('minecraft:air'));
    for (const [x, y, z, b] of copied) writeBlock(src.dim, x + off.x, y + off.y, z + off.z, { id: b.id, states: { ...b.states } });
    if (!copied.length) throw new Failed('0 blocks cloned');
    return { successCount: 1, message: `${copied.length} blocks cloned` };
  },
  // ---- ここから 1.6.0 で足したコマンド（実機で挙動を確かめたもの）----
  // 数として読む（整数の文字列だけを受け付ける）
  damage(a, src) {
    const list = select(a[0], src);
    const amount = num(a[1]);
    if (!(amount > 0)) return { successCount: 0, failed: true };
    const cause = a[2] ?? 'entityAttack';
    for (const e of list) hurt(e, amount, { cause });
    return { successCount: list.length };
  },
  effect(a, src) {
    const list = select(a[0], src);
    if (a[1] === 'clear') {
      const id = a[2] ? effectId(a[2]) : null;
      if (a[2] && !id) throw new Syntax(String(a[2]), String(a[2]));
      let n = 0;
      for (const e of list) n += clearEffects(e, id) ? 1 : 0;
      return { successCount: n };
    }
    const id = effectId(a[1]);
    if (!id) throw new Syntax(String(a[1]), String(a[1]));
    const sec = a[2] === undefined ? 30 : num(a[2]);
    const amp = a[3] === undefined ? 0 : num(a[3]);
    const hide = a[4] === 'true';
    if (sec === 0) { let n = 0; for (const e of list) n += clearEffects(e, id) ? 1 : 0; return { successCount: n }; }
    for (const e of list) setEffect(e, id, Math.floor(sec) * 20, Math.floor(amp), !hide);
    return { successCount: list.length };
  },
  event(a, src) {
    if (a[0] !== 'entity') throw new Syntax(String(a[0]));
    const list = select(a[1], src);
    for (const e of list) triggerEntityEvent(e, String(a[2]));
    return { successCount: list.length };
  },
  particle(a, src) {
    const p = pos3(a, 1, src.pos, false);
    S.effects.push({ tick: S.tick, kind: 'particle', id: String(a[0]), dimension: src.dim, location: p });
    return {};
  },
  playsound(a, src) {
    S.effects.push({ tick: S.tick, kind: 'sound', id: String(a[0]), dimension: src.dim, targets: a[1] ? String(a[1]) : '@a' });
    return {};
  },
  music(a) { S.effects.push({ tick: S.tick, kind: 'music', action: String(a[0]), track: a[1] ? String(a[1]) : undefined }); return {}; },
  stopsound(a) { S.effects.push({ tick: S.tick, kind: 'stopsound', targets: a[0] ? String(a[0]) : '@a', sound: a[1] ? String(a[1]) : undefined }); return {}; },
  toggledownfall(a, src) {
    const w = DIMS[src.dim].weather === 'Clear' ? 'Rain' : 'Clear';
    DIMS[src.dim].weather = w;
    return {};
  },
  daylock(a) { G.gameRules.doDayLightCycle = !(a[0] === undefined || a[0] === 'true'); return {}; },
  alwaysday(a) { G.gameRules.doDayLightCycle = !(a[0] === undefined || a[0] === 'true'); return {}; },
  mobevent(a) {
    if (a[0] === undefined) throw new Syntax('', W.custom.END);
    G.mobEvents ??= {};
    if (a[1] !== undefined) G.mobEvents[String(a[0])] = a[1] === 'true';
    return {};
  },
  me(a, src) { say('@a', `* ${src.entity?.name ?? 'Server'} ${a.join(' ')}`); return {}; },
  list() { const ps = [...entities.values()].filter((e) => e.valid && e.player && e.joined); return { message: `There are ${ps.length}/10 players online:\n${ps.map((p) => p.name).join(', ')}` }; },
  save(a) { return { message: a[0] === 'query' ? 'Data saved. Files are now ready to be copied.' : 'Saving...' }; },
  setmaxplayers(a) { const n = num(a[0]); G.maxPlayers = n; return { message: `Set max players to ${n}` }; },
  xp(a, src) {
    const list = select(a[1] ?? '@s', src);
    // 実測: プレイヤー以外を指すと、この文言でそのままエラーになる
    if (list.some((e) => !e.player)) { const err = new Syntax('Selector must be player-type'); err.raw = true; throw err; }
    // 実測: 数字だけなら経験値（たまると繰り上がる）、L つきならレベルそのもの
    const raw = String(a[0]);
    const asLevels = /L$/i.test(raw);
    const n = num(raw.replace(/L$/i, ''));
    const need = (l) => (l >= 31 ? 9 * l - 158 : l >= 16 ? 5 * l - 38 : 2 * l + 7);
    for (const p of list) {
      if (asLevels) { p.level = Math.max(0, (p.level ?? 0) + n); continue; }
      if (n <= 0) continue;
      p.xp = (p.xp ?? 0) + n;
      for (;;) { const k = need(p.level ?? 0); if (p.xp < k) break; p.xp -= k; p.level = (p.level ?? 0) + 1; }
    }
    return { successCount: list.length };
  },
  replaceitem(a, src) {
    if (a[0] === 'entity') {
      const list = select(a[1], src);
      const slot = String(a[2]);
      const idx = num(a[3]);
      const id = itemId(String(a[4]));
      if (!id) throw new Syntax(String(a[4]), String(a[4]));
      const n = a[5] === undefined ? 1 : num(a[5]);
      for (const e of list) {
        if (slot === 'slot.weapon.mainhand') { e.equipment ??= {}; e.equipment.Mainhand = { typeId: id, amount: n, lore: [] }; }
        else { e.inventory ??= []; e.inventory[idx] = { typeId: id, amount: n, lore: [] }; }
      }
      return { successCount: list.length };
    }
    if (a[0] === 'block') {
      const p = pos3(a, 1, src.pos, true);
      const b = readBlock(src.dim, p.x, p.y, p.z);
      void b;
      return { successCount: 1 };
    }
    throw new Syntax(String(a[0]), String(a[0]));
  },
  enchant(a, src) {
    const list = select(a[0], src);
    const name = String(a[1]);
    const lvl = a[2] === undefined ? 1 : num(a[2]);
    let n = 0;
    for (const e of list) {
      const it = e.equipment?.Mainhand ?? e.inventory?.[e.selectedSlot ?? 0];
      if (!it) continue;
      it.enchants ??= {};
      it.enchants[name.includes(':') ? name : `minecraft:${name}`] = lvl;
      n++;
    }
    return { successCount: n };
  },
  spawnpoint(a, src) {
    const list = select(a[0] ?? '@s', src);
    const p = pos3(a, 1, src.pos, true);
    for (const e of list) if (e.player) e.spawnPoint = { ...p, dimension: src.dim };
    return { successCount: list.length };
  },
  clearspawnpoint(a, src) {
    const list = select(a[0] ?? '@s', src);
    for (const e of list) if (e.player) e.spawnPoint = undefined;
    return { successCount: list.length };
  },
  tickingarea(a) { return { message: a[0] === 'list' ? 'There are no ticking areas' : '' }; },
  locate() { return { message: 'The nearest structure is at block ...' }; },
  title(a) { S.effects.push({ tick: S.tick, kind: 'title', targets: String(a[0]), action: String(a[1]), text: a.slice(2).join(' ') }); return {}; },
  titleraw(a) { S.effects.push({ tick: S.tick, kind: 'title', targets: String(a[0]), action: String(a[1]), text: a.slice(2).join(' ') }); return {}; },
  // 実測: /camera は戻り値が {}。プレイヤー以外を指すとセレクターのエラー
  camera(a, src) {
    const list = select(a[0] ?? '@s', src);
    if (list.some((e) => !e.player)) { const err = new Syntax('Selector must be player-type'); err.raw = true; throw err; }
    S.effects.push({ tick: S.tick, kind: 'camera.command', to: list.map((e) => e.name), args: a.slice(1).map(String) });
    return {};
  },
  // ---- 実機で 1 つずつ測って入れたもの（戻り値・構文エラー・副作用） ----------------
  function(a, src) {
    if (a[0] === undefined) throw new Syntax('function に名前がありません', W.custom.END);
    runFunctionFile(String(a[0]), src);
    return {};
  },
  ride(a, src) {
    const SUBS = ['start_riding', 'stop_riding', 'evict_riders', 'summon_rider', 'summon_ride'];
    const sub = String(a[1] ?? '');
    if (!SUBS.includes(sub)) throw new Syntax(`ride の ${sub || '(なし)'} は不明です`, a[1] ?? W.custom.END);
    const targets = select(String(a[0] ?? '@s'), src);
    for (const e of targets) {
      if (sub === 'start_riding') {
        const ride = select(String(a[2] ?? '@e'), src).find((x) => x !== e);
        if (ride) rideAdd(ride, e);
      } else if (sub === 'stop_riding') {
        if (e.ridingOn) rideEject(entities.get(e.ridingOn), e);
      } else if (sub === 'evict_riders') {
        rideEjectAll(e);
      } else if (sub === 'summon_rider' || sub === 'summon_ride') {
        const t = entityTypeId(String(a[2] ?? ''));
        if (!t) continue;
        const born = spawn(t, e.dim, { ...e.loc }, {});
        if (born) { if (sub === 'summon_rider') rideAdd(e, born); else rideAdd(born, e); }
      }
    }
    return {};
  },
  loot(a, src, toks) {
    checkSlashes(toks);                    // 実測: loot テーブルの名前は引用符が要る
    const mode = String(a[0] ?? '');
    if (mode === 'give' && String(a[2] ?? '') === 'kill') {
      const targets = select(String(a[1] ?? '@s'), src).filter((e) => e.player);
      const from = select(String(a[3] ?? '@e'), src);
      for (const victim of from) {
        const items = entityLoot(victim);
        if (items === null) throw new NotImpl(`loot（${victim.typeId} のドロップは未測定）`);
        for (const t of targets) for (const it of items ?? []) addItem(t, { ...it });
      }
      return {};
    }
    throw new NotImpl(`loot ${mode}（この形はまだ測っていません）`);
  },
  schedule(a) {
    if (String(a[0] ?? '') !== 'on_area_loaded') throw new Syntax('schedule の書き方が違います', a[0] ?? W.custom.END);
    S.effects.push({ tick: S.tick, kind: 'schedule', args: a.map(String) });
    // 実測したのは「受け付けて {} を返す」ところまで。実際に走る時機は測っていない
    log('warn', '[sandbox] /schedule: 登録は受け付けますが、実際に走る時機は再現していません', { inconclusive: true });
    S.inconclusive++;
    return {};
  },
  structure(a, src) {
    const sub = String(a[0] ?? '');
    if (!['save', 'load', 'delete'].includes(sub)) throw new Syntax(`structure の ${sub || '(なし)'} は不明です`, a[0] ?? W.custom.END);
    const store = structures();
    const id = String(a[1] ?? '');
    if (sub === 'delete') { const st = store.get(id); if (st) { st.valid = false; store.delete(id); } return {}; }
    if (sub === 'save') {
      const from = pos3(a, 2, src.pos, true);
      const to = pos3(a, 5, src.pos, true);
      const lo = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), z: Math.min(from.z, to.z) };
      const hi = { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y), z: Math.max(from.z, to.z) };
      const st = { id, size: { x: hi.x - lo.x + 1, y: hi.y - lo.y + 1, z: hi.z - lo.z + 1 }, blocks: new Map(), water: new Set(), saveMode: 'World', valid: true };
      for (let x = lo.x; x <= hi.x; x++) for (let y = lo.y; y <= hi.y; y++) for (let z = lo.z; z <= hi.z; z++) {
        st.blocks.set(`${x - lo.x}|${y - lo.y}|${z - lo.z}`, readBlock(src.dim, x, y, z));
      }
      if (a[8] !== undefined) { log('warn', '[sandbox] /structure save の追加の指定（保存先・エンティティの扱いなど）は再現していません', { inconclusive: true }); S.inconclusive++; }
      store.set(id, st);
      return {};
    }
    const st = store.get(id);
    const at = pos3(a, 2, src.pos, true);
    if (!st?.valid) {
      // 実測: 無い名前でもエラーにならず、大きさ 0 の空の構造物がその名前で登録される
      store.set(id, { id, size: { x: 0, y: 0, z: 0 }, blocks: new Map(), water: new Set(), saveMode: 'World', valid: true });
      return {};
    }
    if (a[5] !== undefined) { log('warn', '[sandbox] /structure load の回転・反転・残存率は再現していません', { inconclusive: true }); S.inconclusive++; }
    for (const [k, perm] of st.blocks) {
      const [dx, dy, dz] = k.split('|').map(Number);
      writeBlock(src.dim, at.x + dx, at.y + dy, at.z + dz, perm);
    }
    return {};
  },
  camerashake(a) { S.effects.push({ tick: S.tick, kind: 'camerashake', args: a.map(String) }); return {}; },
  hud(a) { S.effects.push({ tick: S.tick, kind: 'hud', args: a.map(String) }); return {}; },
  fog(a) { S.effects.push({ tick: S.tick, kind: 'fog', args: a.map(String) }); return {}; },
  inputpermission(a) { S.effects.push({ tick: S.tick, kind: 'inputpermission', args: a.map(String) }); return {}; },
  recipe(a) { S.effects.push({ tick: S.tick, kind: 'recipe', args: a.map(String) }); return {}; },
  dialogue(a) { S.effects.push({ tick: S.tick, kind: 'dialogue', args: a.map(String) }); return {}; },
  testfor(a, src) {
    const list = select(a[0], src);
    if (!list.length) throw new Failed('No targets matched selector');
    return { successCount: list.length, message: `Found ${list.length} match(es)` };
  },
  testforblock(a, src) {
    const p = pos3(a, 0, src.pos, true);
    const { perm } = blockSpec(a[3], a[4]);
    assertBox(src.dim, p, p);
    const cur = readBlock(src.dim, p.x, p.y, p.z);
    const exact = String(a[3]).includes('[');
    if (cur.id !== perm.id || (exact && !samePerm(cur, perm))) throw new Failed(`The block at ${p.x},${p.y},${p.z} is ${cur.id} (expected: ${perm.id})`);
    return { message: `Successfully found the block at ${p.x},${p.y},${p.z}.` };
  },
  testforblocks(a, src) {
    const p1 = pos3(a, 0, src.pos, true);
    const p2 = pos3(a, 3, src.pos, true);
    const d = pos3(a, 6, src.pos, true);
    const masked = (a[9] ?? 'all') === 'masked';
    const box = assertBox(src.dim, p1, p2);
    if (box.count > FILL_LIMIT) throw new Failed(`Too many blocks in the specified area (${box.count} > ${FILL_LIMIT})`);
    let n = 0;
    for (let x = box.lo.x; x <= box.hi.x; x++) for (let y = box.lo.y; y <= box.hi.y; y++) for (let z = box.lo.z; z <= box.hi.z; z++) {
      const b = readBlock(src.dim, x, y, z);
      if (masked && b.id === 'minecraft:air') continue;
      const o = readBlock(src.dim, d.x + x - box.lo.x, d.y + y - box.lo.y, d.z + z - box.lo.z);
      if (!samePerm(o, b)) throw new Failed('Source and destination are not identical');
      n++;
    }
    return { successCount: 1, message: `${n} blocks compared` };
  },
  say(a, src) {
    const who = src.entity ? (src.entity.player ? src.entity.name : (src.entity.nameTag || src.entity.typeId)) : 'Server';
    say('@a', `[${who}] ${a.map(String).join(' ')}`);
    return {};
  },
  tell(a, src) {
    const list = targets(a[0], src);
    const who = src.entity ? (src.entity.player ? src.entity.name : src.entity.typeId) : 'Server';
    for (const e of list) say(e.name, `${who} whispers to you: ${a.slice(1).join(' ')}`);
    return { successCount: list.length };
  },
  tellraw(a, src) {
    const list = targets(a[0], src).filter((e) => e.player);
    let json;
    try { json = JSON.parse(a.slice(1).join(' ')); } catch { throw new Syntax('JSON が正しくありません'); }
    if (!json || !Array.isArray(json.rawtext)) throw new Syntax('rawtext が要ります');
    for (const e of list) say(e.name, W.rawText(json));
    return { successCount: list.length };
  },
  tp(a, src) {
    if (a.length === 0) throw new Syntax('tp の引数が足りません');
    let who = src.entity ? [src.entity] : [];
    let rest = a;
    const isCoord = (t) => /^[~^]?-?[\d.]*$/.test(String(t)) && String(t) !== '';
    if (!isCoord(a[0])) {
      const first = targets(a[0], src);
      if (a.length === 1) {
        if (!src.entity) throw new Failed('tp の実行者がいません');
        const dest = first[0];
        src.entity.loc = { ...dest.loc };
        src.entity.dim = dest.dim;
        return { successCount: 1 };
      }
      who = first;
      rest = a.slice(1);
    }
    if (!who.length) throw new Failed('No targets matched selector');
    if (!isCoord(rest[0])) {
      const dest = targets(rest[0], src);
      if (dest.length !== 1) throw new Failed('行き先は 1 体にしてください');
      for (const e of who) { e.loc = { ...dest[0].loc }; e.dim = dest[0].dim; }
      return { successCount: who.length };
    }
    const to = pos3(rest, 0, src.pos, false);
    const d = DIMS[src.dim];
    if (to.y < d.min - 512 || to.y > d.max + 4096) throw new Failed('座標が範囲外です');
    if (rest[3] !== undefined && rest[3] !== 'facing' && rest[3] !== 'true' && rest[3] !== 'false') {
      const ry = coord(rest[3], { y: 0 }, 'y', false);
      const rx = rest[4] !== undefined ? coord(rest[4], { y: 0 }, 'y', false) : 0;
      for (const e of who) e.rot = { x: rx, y: ry };
    }
    for (const e of who) { e.loc = { ...to }; e.dim = src.dim; }
    return { successCount: who.length };
  },
  give(a, src) {
    const list = targets(a[0], src).filter((e) => e.player);
    if (!list.length) throw new Failed('No targets matched selector');
    const id = itemId(a[1]);
    if (!id) throw new Syntax(`Unknown item: ${a[1]}`, a[1]);
    const amount = a[2] !== undefined ? Number(a[2]) : 1;
    if (!Number.isInteger(amount) || amount < 1 || amount > 32767) throw new Syntax('個数は 1〜32767 です');
    if (a[3] !== undefined && Number(a[3]) !== 0) throw new NotImpl('give のデータ値');
    if (a[4] !== undefined) throw new NotImpl('give の components');
    for (const e of list) {
      let left = amount;
      while (left > 0) {
        const n = Math.min(left, ITEM_MAX(id));
        const rest = addItem(e, { typeId: id, amount: n, lore: [] });
        if (rest > 0) {
          // 入りきらない分は足元に落ちる
          const it = spawn('minecraft:item', e.dim, e.loc);
          it.item = { typeId: id, amount: rest, lore: [] };
        }
        left -= n;
      }
      // 実測（BDS 1.26.52）: プレイヤーが打ったコマンド（その中の /function・execute … run も）は、受け取った人に
      // 「%commands.give.successRecipient [<名前><個数>]」と出る。コンソールやスクリプトの runCommand からは誰にも出ない。
      // <名前>: 独自アイテムは「item.<id>」（実測）、バニラは英語名（ここでは id から作る近似）
      if (src.typed) say(e.name, { rawtext: [{ translate: 'commands.give.successRecipient', with: { rawtext: [{ text: giveName(id) }, { text: String(amount) }] } }] });
    }
    return { successCount: list.length };
  },
  clear(a, src) {
    const list = a[0] !== undefined ? targets(a[0], src) : (src.entity ? [src.entity] : []);
    const id = a[1] !== undefined ? itemId(a[1]) : null;
    if (a[1] !== undefined && !id) throw new Syntax(`Unknown item: ${a[1]}`);
    const max = a[3] !== undefined ? Number(a[3]) : -1;
    let total = 0;
    for (const e of list.filter((x) => x.inventory)) {
      let left = max < 0 ? Infinity : max;
      for (let i = 0; i < e.inventory.length && left > 0; i++) {
        const s = e.inventory[i];
        if (!s || (id && s.typeId !== id)) continue;
        const n = Math.min(s.amount, left);
        total += n;
        if (max === 0) continue;
        s.amount -= n;
        left -= n;
        if (s.amount <= 0) e.inventory[i] = null;
      }
    }
    if (!total) throw new Failed('Could not clear the inventory');
    return { successCount: total };
  },
  kill(a, src) {
    const list = a[0] !== undefined ? targets(a[0], src) : (src.entity ? [src.entity] : []);
    let n = 0;
    for (const e of list) {
      if (e.player && (e.gameMode === 'Creative' || e.gameMode === 'Spectator')) continue;
      removeEntity(e, { died: true, cause: 'SelfDestruct' });
      n++;
    }
    if (!n) throw new Failed('No targets matched selector');
    return { successCount: n };
  },
  summon(a, src) {
    const id = entityTypeId(a[0]);
    if (!id) throw new Syntax(`Unknown entity: ${a[0]}`, a[0]);
    if (id === 'minecraft:player') throw new Failed('プレイヤーは召喚できません');
    let at = { ...src.pos };
    let nameTag = '';
    if (a[1] !== undefined && /^[~^\d.-]/.test(String(a[1]))) {
      at = pos3(a, 1, src.pos, false);
      if (a[4] !== undefined && a[5] !== undefined && /^[~\d.-]/.test(String(a[4]))) {
        // yRot xRot
        if (a[6] !== undefined) throw new NotImpl('summon のイベント指定');
      } else if (a[4] !== undefined) {
        if (a[5] !== undefined) nameTag = String(a[5]);
        else throw new NotImpl('summon のイベント指定');
      }
    } else if (a[1] !== undefined) {
      nameTag = String(a[1]);
      if (a[2] !== undefined) at = pos3(a, 2, src.pos, false);
    }
    const p = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
    assertBox(src.dim, p, p);
    const e = spawn(id, src.dim, at, { nameTag });
    void e;
    return { message: 'Object successfully summoned' };
  },
  tag(a, src) {
    const list = targets(a[0], src);
    const op = a[1];
    if (op === 'add' || op === 'remove') {
      const t = a[2];
      if (t === undefined) throw new Syntax('タグの名前が要ります');
      let n = 0;
      for (const e of list) {
        if (op === 'add' ? !e.tags.has(t) : e.tags.has(t)) { op === 'add' ? e.tags.add(t) : e.tags.delete(t); n++; }
      }
      if (!n) throw new Failed(op === 'add' ? 'Unable to add tag' : 'Unable to remove tag');
      return { successCount: n };
    }
    if (op === 'list') return { successCount: list.length, message: list.map((e) => [...e.tags].join(', ')).join('; ') };
    throw new Syntax(`tag の ${op} は不明です`);
  },
  scoreboard(a, src) {
    if (a[0] === 'objectives') {
      const op = a[1];
      if (op === 'add') {
        const [, , name, criteria = 'dummy', ...disp] = a;
        if (criteria !== 'dummy') throw new Syntax(`基準 ${criteria} は使えません（dummy のみ）`, criteria);
        if (disp.length > 1) throw new Syntax('表示名は 1 語か引用符で囲みます', disp[1]);
        if (objectives.has(name)) throw new Failed(`An objective already exists by that name: ${name}`);
        objectives.set(name, { id: name, displayName: disp.length ? disp.join(' ') : name, criteria, scores: new Map(), valid: true });
        return {};
      }
      if (op === 'remove') {
        const o = objectives.get(a[2]);
        if (!o) throw new Failed(`No objective was found by the name '${a[2]}'`);
        o.valid = false;
        objectives.delete(a[2]);
        return {};
      }
      if (op === 'list') return { message: [...objectives.keys()].join(', ') };
      if (op === 'setdisplay') {
        const slot = a[2];
        if (!['list', 'sidebar', 'belowname'].includes(slot)) throw new Syntax(`表示場所 ${slot} は不明です`);
        if (a[3] === undefined) { delete displaySlots[slot]; return {}; }
        const o = objectives.get(a[3]);
        if (!o) throw new Failed(`No objective was found by the name '${a[3]}'`);
        displaySlots[slot] = o;
        return {};
      }
      throw new Syntax(`scoreboard objectives ${op} は不明です`);
    }
    if (a[0] === 'players') {
      const op = a[1];
      const whoTok = a[2];
      const resolve = (tok, allowFake) => {
        if (tok === '*') return [...identities.values()].map((i) => ({ ident: i }));
        if (/^@/.test(tok)) return targets(tok, src).map((e) => ({ ident: identityFor(e), e }));
        const pl = [...entities.values()].find((e) => e.player && e.valid && e.name === tok);
        if (pl) return [{ ident: identityFor(pl), e: pl }];
        if (!allowFake) throw new Failed('No targets matched selector');
        return [{ ident: identityFor(tok) }];
      };
      if (op === 'list') return { message: [...identities.values()].map((i) => i.name).join(', ') };
      if (op === 'reset') {
        const list = resolve(whoTok, true);
        for (const { ident } of list) {
          for (const o of objectives.values()) if (a[3] === undefined || o.id === a[3]) o.scores.delete(ident.id);
          // 点数がひとつも残らない偽プレイヤーは消える（実測: その後 getScore は identity を解決できない）
          if (ident.type === 'FakePlayer' && ![...objectives.values()].some((o) => o.scores.has(ident.id))) identities.delete(ident.id);
        }
        return { successCount: list.length };
      }
      const obj = objectives.get(a[3]);
      if (!obj) throw new Failed(`No objective was found by the name '${a[3]}'`);
      const list = resolve(whoTok, true);
      if (op === 'test') {
        const min = a[4] === '*' ? -Infinity : Number(a[4]);
        const max = a[5] === undefined || a[5] === '*' ? Infinity : Number(a[5]);
        let n = 0;
        for (const { ident } of list) {
          const v = obj.scores.get(ident.id);
          if (v === undefined) throw new Failed(`No score found for ${ident.name}`);
          if (v >= min && v <= max) n++;
        }
        if (!n) throw new Failed('Score is NOT in range');
        return { successCount: n };
      }
      if (op === 'random') {
        const min = Number(a[4]); const max = Number(a[5]);
        if (!(min <= max)) throw new Failed('最小が最大を超えています');
        for (const { ident } of list) obj.scores.set(ident.id, min + Math.floor(random() * (max - min + 1)));
        return { successCount: list.length };
      }
      if (op === 'operation') {
        const [, , , , opr, srcTok, srcObjName] = a;
        const srcObj = objectives.get(srcObjName);
        if (!srcObj) throw new Failed(`No objective was found by the name '${srcObjName}'`);
        const srcs = resolve(srcTok, true);
        for (const { ident } of list) {
          for (const s of srcs) {
            const bv = srcObj.scores.get(s.ident.id);
            if (bv === undefined) throw new Failed(`No score found for ${s.ident.name}`);
            const av = obj.scores.get(ident.id) ?? 0;
            const r = {
              '+=': av + bv, '-=': av - bv, '*=': av * bv,
              '/=': bv === 0 ? av : Math.floor(av / bv),
              '%=': bv === 0 ? av : ((av % bv) + bv) % bv,
              '=': bv, '<': Math.min(av, bv), '>': Math.max(av, bv),
            }[opr];
            if (opr === '><') {
              obj.scores.set(ident.id, bv);
              srcObj.scores.set(s.ident.id, av);
              continue;
            }
            if (r === undefined) throw new Syntax(`演算子 ${opr} は不明です`);
            obj.scores.set(ident.id, r | 0);
          }
        }
        return { successCount: list.length };
      }
      const n = Number(a[4]);
      if (!Number.isInteger(n)) throw new Syntax('数値が要ります');
      for (const { ident } of list) {
        const cur = obj.scores.get(ident.id) ?? 0;
        if (op === 'set') obj.scores.set(ident.id, n | 0);
        else if (op === 'add') obj.scores.set(ident.id, (cur + n) | 0);
        else if (op === 'remove') obj.scores.set(ident.id, (cur - n) | 0);
        else throw new Syntax(`scoreboard players ${op} は不明です`);
      }
      return { successCount: list.length };
    }
    throw new Syntax(`scoreboard ${a[0]} は不明です`);
  },
  time(a) {
    const named = { day: 1000, night: 13000, noon: 6000, midnight: 18000, sunrise: 23000, sunset: 12000 };
    if (a[0] === 'set') {
      const v = named[a[1]] ?? Number(a[1]);
      if (!Number.isInteger(v)) throw new Syntax('時刻が正しくありません');
      G.timeOfDay = ((v % 24000) + 24000) % 24000;
      return {};
    }
    if (a[0] === 'add') {
      const v = Number(a[1]);
      if (!Number.isInteger(v)) throw new Syntax('時刻が正しくありません');
      G.timeOfDay = (((G.timeOfDay + v) % 24000) + 24000) % 24000;
      G.absoluteTime += v;
      return {};
    }
    if (a[0] === 'query') return { message: String(a[1] === 'gametime' ? G.absoluteTime : a[1] === 'day' ? Math.floor(G.absoluteTime / 24000) : G.timeOfDay) };
    throw new Syntax(`time ${a[0]} は不明です`);
  },
  weather(a, src) {
    const w = { clear: 'Clear', rain: 'Rain', thunder: 'Thunder' }[a[0]];
    if (a[0] === 'query') return { message: DIMS[src.dim].weather };
    if (!w) throw new Syntax(`天気 ${a[0]} は不明です`);
    for (const [id, d] of Object.entries(DIMS)) {
      if (d.weather !== w) fireAfter('world.afterEvents', 'weatherChange', { dimension: id, newWeather: w, previousWeather: d.weather });
      d.weather = w;
    }
    return {};
  },
  gamemode(a, src) {
    const gm = gmName(a[0]);
    if (!gm) throw new Syntax(`ゲームモード ${a[0]} は不明です`);
    const list = a[1] !== undefined ? targets(a[1], src).filter((e) => e.player) : (src.entity?.player ? [src.entity] : []);
    if (!list.length) throw new Failed('No targets matched selector');
    for (const e of list) {
      const prev = e.gameMode;
      if (prev === gm) continue;
      e.gameMode = gm;
      fireAfter('world.afterEvents', 'playerGameModeChange', { player: W.entityObj(e), fromGameMode: prev, toGameMode: gm });
    }
    return { successCount: list.length };
  },
  difficulty(a) {
    const d = { 0: 'Peaceful', p: 'Peaceful', peaceful: 'Peaceful', 1: 'Easy', e: 'Easy', easy: 'Easy', 2: 'Normal', n: 'Normal', normal: 'Normal', 3: 'Hard', h: 'Hard', hard: 'Hard' }[String(a[0]).toLowerCase()];
    if (!d) throw new Syntax(`難易度 ${a[0]} は不明です`);
    G.difficulty = d;
    return {};
  },
  scriptevent(a, src) {
    const id = a[0];
    // 実測: 名前空間が無い ID は、エラーにはならず successCount 0 で終わる
    if (!/^[a-z0-9_.-]+:[\w./-]+$/i.test(id ?? '') || id.startsWith('minecraft:')) return { successCount: 0, failed: true };
    fireAfter('system.afterEvents', 'scriptEventReceive', { id, message: a.slice(1).join(' '), sourceType: src.entity ? 'Entity' : 'Server', sourceEntity: src.entity ? W.entityObj(src.entity) : undefined });
    return {};
  },
  gamerule(a) {
    if (a[0] === undefined) return { message: JSON.stringify(G.gameRules) };
    const k = W.rules.map?.[String(a[0]).toLowerCase()];
    if (!k) throw new Syntax(`ゲームルール ${a[0]} は不明です`);
    if (a[1] === undefined) return { message: `${k} = ${G.gameRules[k]}` };
    const cur = G.gameRules[k];
    let v;
    if (typeof cur === 'boolean') {
      if (a[1] !== 'true' && a[1] !== 'false') throw new Syntax(`${k} には true か false を指定します`);
      v = a[1] === 'true';
    } else {
      v = Number(a[1]);
      if (!Number.isInteger(v)) throw new Syntax(`${k} には整数を指定します`);
    }
    W.rules.set(k, v);
    return {};
  },
  setworldspawn(a, src) {
    G.spawn = a.length ? pos3(a, 0, src.pos, true) : { x: Math.floor(src.pos.x), y: Math.floor(src.pos.y), z: Math.floor(src.pos.z) };
    return {};
  },
  execute(a, src, toks) {
    return runExecute(a, src, toks);
  },
};
H.teleport = H.tp;
H.msg = H.tell;
H.w = H.tell;

// execute: as / at / positioned / in / if / unless / run
