// 1 tick の進行

// ---- 1 tick ----------------------------------------------------------------

const JOB_STEPS = CFG.limits?.jobStepsPerTick ?? 1000;

function joinPlayers() {
  for (let i = pendingPlayers.length - 1; i >= 0; i--) {
    const p = pendingPlayers[i];
    if (p.joinTick > S.tick) continue;
    pendingPlayers.splice(i, 1);
    const e = newEntity({ ...p, typeId: 'minecraft:player', player: true, id: p.id });
    e.joined = true;
    fireAfter('world.afterEvents', 'playerJoin', { playerId: e.id, playerName: e.name });
    fireAfter('world.afterEvents', 'playerSpawn', { player: entityObj(e), initialSpawn: true });
  }
}

function playerByName(n) {
  for (const e of entities.values()) if (e.player && e.valid && e.name === n) return e;
  return null;
}

/** リクエストで与えた「プレイヤーの操作」を世界に起こす */
function applyAction(a) {
  // a player who left comes back (BDS keeps what they had: inventory, saved properties, tags, where they stood)
  if (a.type === 'join') {
    if (playerByName(a.player)) return;
    let back = null; for (const e of entities.values()) if (e.player && !e.valid && e.name === a.player) back = e;
    if (!back) { log('warn', `操作 join: プレイヤー ${a.player} は参加したことがありません`); return; }
    back.valid = true; back.joined = true;
    fireAfter('world.afterEvents', 'playerJoin', { playerId: back.id, playerName: back.name });
    fireAfter('world.afterEvents', 'playerSpawn', { player: entityObj(back), initialSpawn: true });
    return;
  }
  const p = a.player ? playerByName(a.player) : null;
  if (a.player && !p) { log('warn', `操作 ${a.type}: プレイヤー ${a.player} がいません`); return; }
  const po = p ? entityObj(p) : undefined;
  switch (a.type) {
    case 'chat': {
      // ベータの Script API には chatSend がある（安定版には無い: 購読が無ければ何も起きない）。before で cancel されたら誰にも届かない
      const msg = a.message ?? '';
      const d = fireBefore('world.beforeEvents', 'chatSend', { message: msg, sender: po, cancel: false });
      if (d.cancel) break;
      S.chat.push({ tick: S.tick, to: '@a', text: `<${p.name}> ${msg}`, chat: p.name });   // a player's chat: every client gets it as chat (bds-lab: `@X chat <A> msg` per player, as the real client prints it)
      fireAfter('world.afterEvents', 'chatSend', { message: msg, sender: po });
      break;
    }
    case 'leave': {
      fireBefore('world.beforeEvents', 'playerLeave', { player: po });
      p.valid = false;
      fireAfter('world.afterEvents', 'playerLeave', { playerId: p.id, playerName: p.name });
      break;
    }
    case 'clock':   // the scripts' Date runs ahead by a.by ms from now on (not the game's time of day)
      S.clockShift = (S.clockShift ?? 0) + Number(a.by ?? 0);
      break;
    case 'move': {
      const prevDim = p.dim;
      // by: relative (a walk); to without y: stays on its height (goto x z)
      p.loc = a.by ? Vec({ x: p.loc.x + (a.by.x ?? 0), y: p.loc.y + (a.by.y ?? 0), z: p.loc.z + (a.by.z ?? 0) }) : Vec({ x: a.to.x, y: a.to.y ?? p.loc.y, z: a.to.z });
      if (a.dimension) p.dim = dimId(a.dimension);
      if (p.dim !== prevDim) fireAfter('world.afterEvents', 'playerDimensionChange', { player: po, fromDimension: dimObj(prevDim), toDimension: dimObj(p.dim), toLocation: Vec(p.loc) });
      break;
    }
    case 'scriptEvent':
      fireAfter('system.afterEvents', 'scriptEventReceive', { id: a.id, message: a.message ?? '', sourceType: p ? 'Entity' : 'Server', sourceEntity: po });
      break;
    case 'breakBlock': {
      const at = Vec(a.at);
      const cur = readBlock(p.dim, at.x, at.y, at.z);
      if (!chunkLoaded(p.dim, at.x, at.z)) { log('warn', `breakBlock: (${at.x}, ${at.z}) が未読み込み`); break; }
      const data = fireBefore('world.beforeEvents', 'playerBreakBlock', { player: po, block: blockObj(p.dim, at), dimension: dimObj(p.dim), cancel: false });
      if (data.cancel) { log('info', `breakBlock: (${at.x}, ${at.y}, ${at.z}) は取り消されました`); break; }
      writeBlock(p.dim, at.x, at.y, at.z, makePerm('minecraft:air'));
      fireAfter('world.afterEvents', 'playerBreakBlock', { player: po, block: blockObj(p.dim, at), dimension: dimObj(p.dim), brokenBlockPermutation: permObj(cur) });
      customDispatchRef.fn?.('blockPlayerBreak', { dim: p.dim, p: at, blockId: cur.id, data: { block: blockObj(p.dim, at), brokenBlockPermutation: permObj(cur), player: po, dimension: dimObj(p.dim) } });
      // 手に持っていたアイテムのカスタムコンポーネント（そのアイテムで掘った）
      const tool = a.item ?? p.inventory?.[p.selectedSlot]?.typeId;
      if (tool && itemId(tool)) {
        customDispatchRef.fn?.('itemMineBlock', { itemId: itemId(tool), data: { block: blockObj(p.dim, at), itemStack: itemObj({ typeId: itemId(tool), amount: 1, lore: [] }), minedBlockPermutation: permObj(cur), source: po } });
      }
      break;
    }
    case 'placeBlock': {
      const at = Vec(a.at);
      const id = blockTypeId(a.block);
      if (!id) { log('warn', `placeBlock: ${a.block} は不明`); break; }
      if (customDispatchRef.beforePlace?.(p.dim, at, id, { player: po, face: a.face ?? 'Up', permutationToPlace: permObj(makePerm(id, a.states)), dimension: dimObj(p.dim) })) {
        log('info', `placeBlock: (${at.x}, ${at.y}, ${at.z}) はカスタムコンポーネントに取り消されました`);
        break;
      }
      // onPlace は writeBlock から出る（置く口がどれでも同じように呼ばれる）
      writeBlock(p.dim, at.x, at.y, at.z, makePerm(id, a.states));
      // 実測（BDS 1.26.52, サバイバル）: 置くと持ち物から 1 つ減る（持っている枠があれば。手に持つ枠を先に）。クリエイティブは減らない
      if (p.inventory && p.gameMode !== 'Creative') {
        const sel = p.inventory[p.selectedSlot]?.typeId === id ? p.selectedSlot : p.inventory.findIndex((s) => s?.typeId === id);
        if (sel >= 0) { const s = p.inventory[sel]; s.amount -= 1; if (s.amount <= 0) p.inventory[sel] = null; }
      }
      fireAfter('world.afterEvents', 'playerPlaceBlock', { player: po, block: blockObj(p.dim, at), dimension: dimObj(p.dim) });
      break;
    }
    case 'useItem': {
      const id = itemId(a.item ?? p.inventory?.[p.selectedSlot]?.typeId ?? '');
      if (!id) { log('warn', 'useItem: 手に持つアイテムがありません'); break; }
      const item = itemObj({ typeId: id, amount: 1, lore: [] });
      const data = fireBefore('world.beforeEvents', 'itemUse', { source: po, itemStack: item, cancel: false });
      if (data.cancel) break;
      fireAfter('world.afterEvents', 'itemUse', { source: po, itemStack: item });
      customDispatchRef.fn?.('itemUse', { itemId: id, data: { itemStack: item, source: po } });
      break;
    }
    case 'entityEventToBlock': {
      // エンティティがブロックへイベントを送る（実機の onEntity）。デバッグ用の口
      const at = Vec(a.at);
      const cur = readBlock(p?.dim ?? 'minecraft:overworld', at.x, at.y, at.z);
      const e = a.entity ? entities.get($String(a.entity)) : p;
      customDispatchRef.fn?.('blockEntityEvent', { dim: e?.dim ?? 'minecraft:overworld', p: at, blockId: cur.id, data: { blockPermutation: permObj(cur), entitySource: e ? entityObj(e) : undefined, name: a.name ?? '' } });
      break;
    }
    case 'useItemOn': {
      // アイテムをブロックに対して使う（実機の「ブロックに向かって右クリック」）
      const at = Vec(a.at);
      const id = itemId(a.item ?? p.inventory?.[p.selectedSlot]?.typeId ?? '');
      // 手が空なら、ブロックに触れるだけ（実機: 空の手でもブロックの onPlayerInteract は呼ばれる）
      if (!id) { applyAction({ ...a, type: 'interactWithBlock' }); break; }
      const usedOn = readBlock(p.dim, at.x, at.y, at.z);
      customDispatchRef.fn?.('itemUseOn', { itemId: id, data: { source: po, itemStack: itemObj({ typeId: id, amount: 1, lore: [] }), usedOnBlockPermutation: permObj(usedOn), block: blockObj(p.dim, at), blockFace: a.face ?? 'Up' } });
      customDispatchRef.fn?.('blockPlayerInteract', { dim: p.dim, p: at, blockId: usedOn.id, data: { block: blockObj(p.dim, at), face: a.face ?? 'Up', faceLocation: { x: 0.5, y: 0.5, z: 0.5 }, player: po, dimension: dimObj(p.dim) } });
      break;
    }
    case 'attackEntity': {
      const target = a.entity ? entities.get($String(a.entity)) : null;
      if (!target) { log('warn', 'attackEntity: 相手がいません'); break; }
      const id = itemId(a.item ?? p?.inventory?.[p.selectedSlot]?.typeId ?? '');
      if (!id) { log('warn', 'attackEntity: 手に持つアイテムがありません'); break; }
      const stack = itemObj({ typeId: id, amount: 1, lore: [] });
      customDispatchRef.fn?.('itemHitEntity', { itemId: id, data: { attackingEntity: po, hitEntity: entityObj(target), itemStack: stack, hadEffect: a.hadEffect ?? true } });
      customDispatchRef.fn?.('itemDurability', { itemId: id, data: { attackingEntity: po, hitEntity: entityObj(target), itemStack: stack, durabilityDamage: a.durabilityDamage ?? 1 } });
      if (a.damage) hurt(target, a.damage, { cause: 'entityAttack', damagingEntity: p });
      break;
    }
    case 'consumeItem': {
      const id = itemId(a.item ?? p.inventory?.[p.selectedSlot]?.typeId ?? '');
      if (!id) { log('warn', 'consumeItem: 手に持つアイテムがありません'); break; }
      const stack = itemObj({ typeId: id, amount: 1, lore: [] });
      customDispatchRef.fn?.('itemConsume', { itemId: id, data: { source: po, itemStack: stack } });
      customDispatchRef.fn?.('itemCompleteUse', { itemId: id, data: { source: po, itemStack: stack } });
      break;
    }
    case 'interactWithBlock': {
      const at = Vec(a.at);
      const data = fireBefore('world.beforeEvents', 'playerInteractWithBlock', { player: po, block: blockObj(p.dim, at), blockFace: a.face ?? 'Up', faceLocation: { x: 0.5, y: 0.5, z: 0.5 }, isFirstEvent: true, itemStack: undefined, cancel: false });
      if (!data.cancel) {
        fireAfter('world.afterEvents', 'playerInteractWithBlock', { player: po, block: blockObj(p.dim, at), blockFace: a.face ?? 'Up', faceLocation: { x: 0.5, y: 0.5, z: 0.5 }, isFirstEvent: true, beforeItemStack: undefined, itemStack: undefined });
        customDispatchRef.fn?.('blockPlayerInteract', { dim: p.dim, p: at, blockId: readBlock(p.dim, at.x, at.y, at.z).id, data: { block: blockObj(p.dim, at), face: a.face ?? 'Up', faceLocation: { x: 0.5, y: 0.5, z: 0.5 }, player: po, dimension: dimObj(p.dim) } });
      }
      break;
    }
    case 'damage': {
      const e = a.entity ? entities.get($String(a.entity)) : p;
      if (!e) break;
      e.health = $Math.max(0, e.health - (a.amount ?? 1));
      fireAfter('world.afterEvents', 'entityHurt', { hurtEntity: entityObj(e), damage: a.amount ?? 1, damageSource: { cause: a.cause ?? 'none' } });
      if (e.health <= 0) removeEntity(e, { died: true, cause: a.cause ?? 'none' });
      break;
    }
    case 'command': {
      try {
        runCommand({ dim: p?.dim ?? 'minecraft:overworld', pos: p ? Vec(p.loc) : { x: 0, y: 0, z: 0 }, entity: p, typed: !!p }, a.command);   // typed: a player typed it (chat feedback)
        const last = S.commands[S.commands.length - 1]?.result;
        if (last?.failed) log('warn', `command ${a.command}: ${last.failed}`);
      } catch (e) { log('warn', `command ${a.command}: ${errInfo(e).message}`); }
      break;
    }
    case 'setGameMode': {
      const prev = p.gameMode;
      p.gameMode = a.gameMode;
      fireAfter('world.afterEvents', 'playerGameModeChange', { player: po, fromGameMode: prev, toGameMode: a.gameMode });
      break;
    }
    default:
      if (EXT_ACTIONS[a.type]) { if (!p && a.player !== undefined) break; EXT_ACTIONS[a.type](a, p, po); break; }
      log('warn', `未知の操作 ${a.type}`);
  }
}

const actions = [...(CFG.actions ?? [])].sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));

// tick は「1 回の呼び出し = コールバック 1 つ」に割って進める。
// ホストが呼ぶたびに vm の評価が終わり、Promise の続き（await の後）がその場で流れる。
// 実機も、コールバックを 1 つ呼ぶたびに保留中のジョブを流している。
// スクリプトを 1 つも呼ばず Promise も解かない段（段の切り替え、購読の無いイベント、何も無い tick の操作）は、流す続きが
// 無いので次の段と同じ呼び出しで進める（ホストの 1 回の呼び出しは時間切れの見張りつきで重い: 1 回の実行で 3,500 回 → 数百回）
let phase = null;
let queue = [];
const PURE = 'pure';   // stepOnce: no script code ran, no promise settled

function beginTick() {
  phase = 'actions';
  queue = [];
}

function step() {
  for (;;) { const r = stepOnce(); if (r !== PURE) return r; }
}

function stepOnce() {
  switch (phase) {
    // tick の中の順番（BDS 1.26.51 で実測）:
    //   プレイヤーの操作 → after イベント → system.run 系 → runJob → waitTicks の続き
    case 'actions': {
      const joining = pendingPlayers.length;
      joinPlayers();
      let did = pendingPlayers.length !== joining;
      while (actions.length && (actions[0].tick ?? 0) <= S.tick) {
        const a = actions.shift();
        did = true;
        try { withMode('normal', () => applyAction(a)); } catch (e) { log('warn', `操作 ${a.type} が失敗: ${errInfo(e).message}`); }
      }
      phase = 'events';
      queue = [];
      return did ? true : PURE;
    }
    case 'events': {
      if (!queue.length) {
        if (!afterQueue.length) {
          phase = 'runs';
          queue = [...runs.keys()].filter((id) => runs.get(id).due <= S.tick);
          return PURE;
        }
        afterQueue.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
        const { owner, name, data } = afterQueue.shift();
        const signal = `${owner}.${name}`;
        const list = handlers.get(signal);
        if (!list?.length) return PURE;
        const cls = eventClassOf(signal);
        const ev = cls ? inst(cls, { data }) : data;
        for (const { fn, opts } of list) {
          if (opts && !filterOk(opts, data)) continue;
          queue.push({ signal, fn, ev });
        }
        return PURE;
      }
      const h = queue.shift();
      call(h.signal, h.fn, [h.ev]);
      return true;
    }
    case 'runs': {
      if (!queue.length) {
        phase = 'jobs';
        // その tick に作られたジョブは次の tick から動く（実測）
        queue = [...jobs.keys()].filter((id) => jobs.get(id).created < S.tick);
        return PURE;
      }
      const id = queue.shift();
      const r = runs.get(id);
      if (!r) return PURE;
      if (r.every) r.due = S.tick + r.every;
      else runs.delete(id);
      call(`${r.label}#${id}`, r.fn, []);
      return true;
    }
    case 'jobs': {
      if (!queue.length) { phase = 'waits'; return PURE; }
      const id = queue.shift();
      const job = jobs.get(id);
      if (!job) return PURE;
      S.running = `system.runJob#${id}`;
      try {
        withMode('normal', () => {
          for (let n = 0; n < JOB_STEPS; n++) {
            const r = job.gen.next();
            if (r.done) { jobs.delete(id); break; }
          }
        });
      } catch (e) {
        jobs.delete(id);
        if (e instanceof SandboxNotImplemented) notImplemented(e);
        else { S.uncaught++; log('error', `system.runJob#${id}: ${errInfo(e).name}: ${errInfo(e).message}`, { error: errInfo(e) }); }
      } finally { S.running = null; }
      return true;
    }
    case 'waits': {
      let settled = false;
      for (let i = 0; i < waits.length; i++) {
        if (waits[i].due <= S.tick) { const w = waits.splice(i, 1)[0]; i--; w.resolve(); settled = true; }
      }
      phase = 'end';
      return settled ? true : PURE;
    }
    case 'end':
      for (const f of END_HOOKS) f();
      // 実測: 昼夜サイクルが動いているあいだは、通算の時刻が 1 tick に 1 ずつ増え、時刻はその余り
      if (G.gameRules.doDayLightCycle !== false) {
        G.absoluteTime++;
        G.timeOfDay = ((G.absoluteTime % 24000) + 24000) % 24000;
      }
      S.tick++;
      phase = null;
      return false;
    default:
      return false;
  }
}
