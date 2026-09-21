// 本物のプレイヤー — ネットワーク越しに実機（BDS 1.26.51 / プロトコル 2193）へ入り、ふつうのクライアントと同じ入力で操作する。
//
// サーバーの中に作る SimulatedPlayer と違い、これは本物のゲームクライアントと同じ道を通る:
// ログイン → リソースパック → ワールドの開始 → 湧き直しの合図 → 読み込み画面の終わり → 毎 tick の入力（PlayerAuthInput）。
// サーバーは「サーバー権威の移動」でこの入力からプレイヤーを動かし、こちらの予測とずれたら訂正を送ってくる。
//
// 操作が効くために要ったもの（実機で 1 つずつ確かめた。docs/progress.md の 2-7）:
//   1. プロトコル 2193 の定義（tools/live/protocol-2193.cjs）。特に PlayerAuthInput の Input Data は option で包まない
//   2. respawn の state=1（準備できた）に state=2（クライアント準備完了）で答える
//   3. 湧いたあと ServerboundLoadingScreen の「終わり」を送る。送らないとサーバーはプレイヤーを動かさない
//   4. 位置は自分で予測して送る（予測には実機で測った物理 src/play/worlds/voxel.js を使う）。
//      ずれたら correct_player_move_prediction が来るので、その tick に戻して入力を流し直す（Mojang の移動の仕組みどおり）
//
//   const bot = await createRealPlayer({ port, name: 'Bot', world: { origin, blocks } })
//   bot.setControls({ forward: true, sprint: true, jump: false }); bot.look(yaw)
//   await bot.ticks(20)          20 tick 進むのを待つ
//   bot.chat('hi'); await bot.command('say hello')
//   bot.close()
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVoxelWorld } from '../../src/play/worlds/voxel.js';
import { loadPlayerPhysics } from '../../src/play/load.js';
import { createControlState } from '../../src/play/agent/controls.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const F = Math.fround;
const EYE = 1.62; // 送る位置は目の高さ（湧き直しの位置 -58.38 = 足 -60 + 1.62 を実機で確かめた）

/**
 * ブロックのネットワーク上の番号（この版ではハッシュ）。{ name, states } をリトルエンディアンの NBT にして FNV-1a 32。
 * 実機で確かめた: 土のアイテムが持っていた block_runtime_id（-2108756090）とこの計算が一致する
 */
export function blockHash(name, states = {}) {
  const nbt = require(require.resolve('prismarine-nbt', { paths: [ROOT] }));
  const st = {};
  for (const k of Object.keys(states).sort()) {
    const v = states[k];
    st[k] = typeof v === 'string' ? { type: 'string', value: v } : typeof v === 'boolean' ? { type: 'byte', value: v ? 1 : 0 } : { type: 'int', value: v };
  }
  const id = String(name).includes(':') ? String(name) : `minecraft:${name}`;
  const buf = nbt.writeUncompressed({ type: 'compound', name: '', value: { name: { type: 'string', value: id }, states: { type: 'compound', value: st } } }, 'little');
  let h = 0x811c9dc5;
  for (const b of buf) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h | 0;
}

const bigintSafe = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? String(v) : v)));

export async function createRealPlayer({ host = '127.0.0.1', port = 19132, name = 'Bot', world, verbose = false, spawnTimeoutMs = 60000, timeoutMs = null } = {}) {
  spawnTimeoutMs = timeoutMs ?? spawnTimeoutMs;   // 呼ぶ側は timeoutMs で渡してくることがある
  require(path.join(ROOT, 'tools/live/protocol-2193.cjs')).ensureProtocol();
  const { injectRaknet } = require(path.join(ROOT, 'tools/live/player.cjs'));
  injectRaknet();
  const bp = require(require.resolve('bedrock-protocol', { paths: [ROOT] }));
  const client = bp.createClient({ host, port, username: name, offline: true, skipPing: true, version: '1.26.51', followPort: false, conLog: null });
  const bot = new EventEmitter();
  const log = (...a) => { if (verbose) process.stderr.write(`[${name}] ${a.join(' ')}\n`); };
  bot.client = client;
  bot.name = name;
  bot.errors = [];
  client.on('error', (e) => { bot.errors.push(String(e.message).slice(0, 300)); log('error', e.message); });
  // 読めなかったパケットの生のバイトを残す（定義のずれを見つけるため。bot.failedPackets）
  bot.failedPackets = [];
  const wrapDeserializer = () => {
    const d = client.deserializer;
    if (!d || d.__sbWrapped) return;
    d.__sbWrapped = true;
    const orig = d.parsePacketBuffer.bind(d);
    d.parsePacketBuffer = (buf) => {
      try { return orig(buf); } catch (e) {
        let id = 0, sh = 0, i = 0, b;
        do { b = buf[i++]; id |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80 && i < 5);
        if (bot.failedPackets.length < 50) bot.failedPackets.push({ id, hex: buf.toString('hex'), error: String(e.message).slice(0, 200) });
        throw e;
      }
    };
  };
  wrapDeserializer();

  // ---- 予測（実機で測った物理） ------------------------------------------------------
  const origin = world?.origin ?? { x: 0, y: -60, z: 0 };
  const profile = loadPlayerPhysics();
  let physics = createVoxelWorld({ origin, blocks: world?.blocks ?? [], spawn: { x: 0.5, y: 0, z: 0.5 }, profile });
  const rel = (abs) => ({ x: abs.x - origin.x, y: abs.y - origin.y, z: abs.z - origin.z });

  let runtimeId = null;
  let tick = 0n;
  let ready = false;
  let pendingTeleportAck = false;
  const controls = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, sneak: false };
  let yaw = 0;
  let pitch = 0;
  let prevHeld = { jump: false, sprint: false, sneak: false };
  const history = new Map(); // tick → 入力（訂正が来たら、そこから流し直す）
  const snaps = new Map(); // tick → その tick を動いたあとの物理の状態（ノックバックの巻き戻し用）
  const inventory = { slots: [], selected: 0 };
  let digging = null; // { pos, face, phase, ticks, resolve }
  const blockActionsOnce = []; // 次の入力に 1 回だけ載せる PlayerBlockAction
  bot.corrections = 0;
  bot.correctionLog = []; // 訂正の中身（どの tick に、サーバーはどこだと言ったか）

  // 走りは掛け金（前を離すまで続く）と前の二度押し（src/play/agent/controls.js）。サーバーもそう扱う（実機で確かめた）
  const ctl = createControlState();
  const physicsInput = () => ({ ...ctl.input(controls, { onGround: physics.observe().player.onGround }), yaw });

  client.on('start_game', (p) => { runtimeId = p.runtime_entity_id; log('start_game', runtimeId); });
  // ほかのプレイヤー（名前 → 番号）。叩く（hitEntity）ときに使う
  bot.players = new Map();
  client.on('add_player', (p) => { bot.players.set(p.username, p.runtime_id); bot.emit('playerAdded', p.username); });
  // プレイヤー以外の生き物（アドオンが湧かせたものを含む）。叩く・見るのに要る
  bot.entities = new Map();   // 番号（文字列） → { id, type, x, y, z }
  client.on('add_entity', (p) => {
    const id = String(p.runtime_entity_id ?? p.runtime_id ?? '');
    if (!id) return;
    bot.entities.set(id, { id, type: String(p.entity_type ?? ''), x: p.position?.x ?? 0, y: p.position?.y ?? 0, z: p.position?.z ?? 0 });
    bot.emit('entityAdded', bot.entities.get(id));
  });
  client.on('remove_entity', (p) => { bot.entities.delete(String(p.entity_id_self ?? p.runtime_entity_id ?? '')); });
  client.on('move_entity_absolute', (p) => {
    const e = bot.entities.get(String(p.runtime_entity_id ?? ''));
    if (e && p.position) { e.x = p.position.x; e.y = p.position.y; e.z = p.position.z; }
  });
  // ほかのプレイヤーの見え方（本物のクライアントと同じく、届いた移動のパケットだけで知る）。位置は足の位置（パケットは目の高さ）
  bot.others = new Map(); // 番号（文字列） → { x, y, z, vx, vy, vz, onGround, yaw, tick（こちらの tick）, hurtTick }
  const seeOther = (id, pos, onGround, yaw) => {
    const k = String(id); const prev = bot.others.get(k);
    const cur = { x: pos.x, y: pos.y - EYE, z: pos.z, onGround, yaw, tick: Number(tick), vx: 0, vy: 0, vz: 0, hurtTick: prev?.hurtTick ?? -1e9 };
    if (prev && cur.tick > prev.tick) { const dt = cur.tick - prev.tick; cur.vx = (cur.x - prev.x) / dt; cur.vy = (cur.y - prev.y) / dt; cur.vz = (cur.z - prev.z) / dt; }
    else if (prev) { cur.vx = prev.vx; cur.vy = prev.vy; cur.vz = prev.vz; }
    bot.others.set(k, cur);
  };
  client.on('move_player', (p) => { if (runtimeId !== null && BigInt(p.runtime_id) !== BigInt(runtimeId)) seeOther(p.runtime_id, p.position, p.on_ground, p.yaw); });
  client.on('entity_event', (p) => {
    if (p.event_id !== 'hurt_animation') return;
    if (runtimeId !== null && BigInt(p.runtime_entity_id) === BigInt(runtimeId)) { bot.hurtTick = Number(tick); return; }
    const o = bot.others.get(String(p.runtime_entity_id)); if (o) o.hurtTick = Number(tick);
  });
  bot.hurtTick = -1e9;
  // 受け取ったパケットを見る（調べもの用。bot.onPacket = (name, params) => …）
  bot.onPacket = null;
  client.on('packet', (pk) => { if (bot.onPacket) try { bot.onPacket(pk.data?.name, pk.data?.params); } catch { /* 調べものの失敗で止めない */ } });
  // 倒れたら、本物のクライアントと同じく「生き返る」を送る（送らないと、倒れたまま入力が効かない — 実機の PvP で起きた）
  bot.dead = false;
  // 生き返りの頼み方（実機 1.26.51 で確かめた）: PlayerAction の respawn だけではサーバーは何も返さなかった。
  // Respawn（state 2 = クライアントの準備ができた）を送ると、生き返って体力が戻り、動けた
  const requestRespawn = () => {
    client.queue('player_action', { runtime_entity_id: runtimeId, action: 'respawn', position: { x: 0, y: 0, z: 0 }, result_position: { x: 0, y: 0, z: 0 }, face: -1 });
    client.queue('respawn', { position: { x: 0, y: 0, z: 0 }, state: 2, runtime_entity_id: runtimeId });
  };
  client.on('respawn', (p) => {
    if (p.state === 0 && bot.dead) requestRespawn();
    if (p.state === 1) {
      bot.dead = false;
      physics.setState({ pos: rel({ x: p.position.x, y: p.position.y - EYE, z: p.position.z }), vel: { x: 0, y: 0, z: 0 }, onGround: false });
      client.queue('respawn', { position: p.position, state: 2, runtime_entity_id: p.runtime_entity_id });
    }
  });
  client.on('move_player', (p) => {
    if (runtimeId === null || BigInt(p.runtime_id) !== BigInt(runtimeId)) return;
    physics.setState({ pos: rel({ x: p.position.x, y: p.position.y - EYE, z: p.position.z }), vel: { x: 0, y: 0, z: 0 }, onGround: p.on_ground, yaw: p.yaw });
    yaw = p.yaw;
    pendingTeleportAck = p.mode === 'teleport' || p.mode === 'reset';
    history.clear();
    bot.emit('teleported', p.position);
  });
  client.on('correct_player_move_prediction', (p) => {
    if (p.prediction_type !== 'player') return;
    bot.corrections++;
    const at = BigInt(p.tick);
    { const o = physics.observe().player; bot.correctionLog.push({ tick: String(at), now: String(tick), server: rel({ x: p.position.x, y: p.position.y - EYE, z: p.position.z }), ours: { x: o.x, y: o.y, z: o.z }, onGround: p.on_ground }); if (bot.correctionLog.length > 50) bot.correctionLog.shift(); }
    physics.setState({ pos: rel({ x: p.position.x, y: p.position.y - EYE, z: p.position.z }), vel: p.delta, onGround: p.on_ground });
    // その tick より後の入力を流し直す（巻き戻し）
    snaps.set(at, physics.snapshot());
    for (let t = at + 1n; t <= tick; t++) { const inp = history.get(t); if (inp) physics.step(inp); snaps.set(t, physics.snapshot()); }
    log('correct', JSON.stringify(p.position), 'tick', String(at), 'now', String(tick));
  });
  // 体の状態（体力・満腹度など）。サーバーが update_attributes で知らせてくる
  bot.attributes = {};
  // 叩かれたときのノックバック: サーバーが SetActorMotion（その tick の番号つき）で自分の速度を送ってくる。
  // 本物のクライアントと同じく、その tick の状態に戻して速度を入れ、その後の入力を流し直す（巻き戻し）。
  // 入れないと、サーバーはこちらの位置を 0.5 ブロックまで受け入れてから訂正し、動きが実機の決まりと違ってしまう（実機で確かめた）
  bot.motions = [];
  client.on('set_entity_motion', (p) => {
    if (runtimeId === null || BigInt(p.runtime_entity_id) !== BigInt(runtimeId)) return;
    const at = p.tick !== undefined ? BigInt(p.tick) : tick;
    const snap = snaps.get(at);
    if (snap) physics.restore(snap);
    bot.motions.push({ tick: String(at), now: String(tick), velocity: p.velocity, before: physics.snapshot() });
    physics.setState({ vel: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z } });
    for (let t = at + 1n; t <= tick; t++) { const inp = history.get(t); if (inp) physics.step(inp); snaps.set(t, physics.snapshot()); }
    bot.emit('knockback', p.velocity);
  });
  client.on('update_attributes', (p) => {
    if (runtimeId !== null && BigInt(p.runtime_entity_id) !== BigInt(runtimeId)) return;
    for (const a of p.attributes ?? []) bot.attributes[a.name] = a.current;
    if ((bot.attributes['minecraft:health'] ?? 20) <= 0 && !bot.dead) { bot.dead = true; bot.emit('died'); }
    else if (bot.dead && (bot.attributes['minecraft:health'] ?? 0) > 0) bot.dead = false;
  });
  client.on('inventory_content', (p) => { if (p.window_id === 'inventory') inventory.slots = p.input; });
  client.on('inventory_slot', (p) => { if (p.window_id === 'inventory') inventory.slots[p.slot] = p.item; });
  client.on('update_block', (p) => {
    const q = p.position;
    bot.emit('blockUpdate', { x: q.x, y: q.y, z: q.z, runtimeId: p.block_runtime_id });
    if (digging && q.x === digging.pos.x && q.y === digging.pos.y && q.z === digging.pos.z) digging.broken = true;
  });
  client.on('text', (p) => bot.emit('text', bigintSafe(p)));
  client.on('set_title', (p) => bot.emit('title', bigintSafe(p)));
  client.on('disconnect', (p) => { log('disconnect', JSON.stringify(p)); bot.emit('disconnect', p); });
  const pendingCommands = new Map();
  client.on('command_output', (p) => {
    const cb = pendingCommands.get(p.origin?.uuid);
    if (cb) { pendingCommands.delete(p.origin.uuid); cb(bigintSafe(p)); }
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name}: 湧きませんでした`)), spawnTimeoutMs);
    client.once('spawn', () => { clearTimeout(t); resolve(); });
  });
  // 読み込み画面の終わり。これを送るまでサーバーはプレイヤーの入力で動かさない（実機で確かめた）
  client.queue('serverbound_loading_screen', { type: 1, loading_screen_id: undefined });
  client.queue('serverbound_loading_screen', { type: 2, loading_screen_id: undefined });
  ready = true;

  // ---- 毎 tick の入力 ---------------------------------------------------------------
  const flagsFor = () => {
    const f = [];
    const c = controls;
    if (c.forward && c.left) f.push('up_left'); else if (c.forward && c.right) f.push('up_right');
    else if (c.back && c.left) f.push('down_left'); else if (c.back && c.right) f.push('down_right');
    if (c.forward) f.push('up'); if (c.back) f.push('down'); if (c.left) f.push('left'); if (c.right) f.push('right');
    if (c.jump) { f.push('jump_down', 'jump_current_raw', 'want_up'); if (!prevHeld.jump) f.push('jump_pressed_raw'); }
    else if (prevHeld.jump) f.push('jump_released_raw');
    if (c.jump && physics.observe().player.onGround) f.push('start_jumping', 'jumping');
    const sprinting = ctl.sprinting;
    if (c.sprint) f.push('sprint_down');
    if (sprinting) { f.push('sprinting'); if (!prevHeld.sprint) f.push('start_sprinting'); } else if (prevHeld.sprint) f.push('stop_sprinting');
    if (c.sneak) { f.push('sneak_down', 'sneaking', 'sneak_current_raw'); if (!prevHeld.sneak) f.push('start_sneaking', 'sneak_pressed_raw'); }
    else if (prevHeld.sneak) f.push('stop_sneaking', 'sneak_released_raw');
    if (pendingTeleportAck) { f.push('handled_teleport'); pendingTeleportAck = false; }
    if (blockActionsOnce.length) f.push('block_action');
    prevHeld = { jump: c.jump, sprint: sprinting, sneak: c.sneak };
    return [...new Set(f)];
  };

  const loop = setInterval(() => {
    if (!ready) return;
    tick++;
    const input = physicsInput();
    if (digging) {
      const d = digging;
      const at = { x: d.pos.x, y: d.pos.y, z: d.pos.z };
      if (d.phase === 'start') { blockActionsOnce.push({ action: 'start_break', position: at, face: d.face }); d.phase = 'continue'; }
      else if (d.phase === 'continue') {
        d.ticks++;
        if (d.broken || d.ticks >= d.max) {
          if (d.broken) blockActionsOnce.push({ action: 'predict_break', position: at, face: d.face });
          blockActionsOnce.push({ action: 'stop_break', position: { x: 0, y: 0, z: 0 }, face: 0 });
          digging = null;
          d.resolve({ broken: Boolean(d.broken), ticks: d.ticks });
        } else blockActionsOnce.push({ action: 'continue_break', position: at, face: d.face });
      }
    }
    const flags = flagsFor();
    physics.step(input);
    history.set(tick, input);
    snaps.set(tick, physics.snapshot());
    if (history.size > 200) history.delete(tick - 200n);
    if (snaps.size > 200) snaps.delete(tick - 200n);
    const o = physics.observe().player;
    const mv = { x: input.move.x, z: input.move.z };
    const rad = (yaw * Math.PI) / 180;
    client.queue('player_auth_input', {
      pitch, yaw, position: { x: F(o.x + origin.x), y: F(o.y + origin.y + EYE), z: F(o.z + origin.z) },
      move_vector: mv, head_yaw: yaw, input_data: flags, input_mode: 'mouse', play_mode: 'normal', interaction_model: 'crosshair',
      interact_rotation: { x: pitch, z: yaw }, tick, delta: { x: o.vx, y: o.vy, z: o.vz },
      block_action: blockActionsOnce.length ? blockActionsOnce.splice(0) : undefined,
      analogue_move_vector: mv, camera_orientation: { x: -Math.sin(rad), y: 0, z: Math.cos(rad) }, raw_move_vector: mv,
    });
    bot.emit('tick', tick);
  }, 50);

  // getter（tick・runtimeId）を値に固めないよう、Object.assign ではなく記述子ごと写す
  Object.defineProperties(bot, Object.getOwnPropertyDescriptors({
    get tick() { return tick; },
    get runtimeId() { return runtimeId; },
    /** 下のネットワークのクライアント（調べもの用） */
    get client() { return client; },
    /** 予測している自分の状態（足の位置・原点からの相対は world.origin 基準） */
    predicted: () => { const o = physics.observe().player; return { x: o.x + origin.x, y: o.y + origin.y, z: o.z + origin.z, vx: o.vx, vy: o.vy, vz: o.vz, onGround: o.onGround, collidedH: o.collidedH }; },
    setControls(c) { Object.assign(controls, c); },
    /**
     * 予測に使うブロックを差し替える（本物のクライアントがチャンクで周りを知っているのと同じ役目）。
     * 予測がずれると、サーバーは 0.5 ブロック以内ならこちらの位置を受け入れてしまう（player-position-acceptance-threshold）ので、
     * 周りのブロックを知らないまま動くと、実機の動きそのものが変わる。コースを建てたら必ずここにも渡す
     */
    setWorld(blocks) {
      const o = physics.observe().player;
      physics = createVoxelWorld({ origin, blocks, spawn: { x: 0.5, y: 0, z: 0.5 }, profile });
      physics.setState({ pos: { x: o.x, y: o.y, z: o.z }, vel: { x: o.vx, y: o.vy, z: o.vz }, onGround: o.onGround, yaw });
    },
    /** 倒れていたら生き返る（戻りは生き返ったか） */
    async respawn(timeoutMs = 5000) {
      if (!bot.dead) return true;
      requestRespawn();
      const t0 = Date.now();
      while (bot.dead && Date.now() - t0 < timeoutMs) { await new Promise((r) => setTimeout(r, 100)); if (bot.dead && Date.now() - t0 > 1000) requestRespawn(); }
      return !bot.dead;
    },
    /** 走りの掛け金が立っているか（src/play/agent/controls.js） */
    get sprinting() { return ctl.sprinting; },
    /** 自分の予測の物理の状態（速度・摩擦・接地・走り。PvP の会心・ノックバックの計算に使う） */
    physicsState() { return physics.snapshot(); },
    /** 予測に使うブロックの一部を置き換える（扉が開いた など）。動きの状態はそのまま */
    editWorld(list) { physics.edit(list); },
    stop() { for (const k of Object.keys(controls)) controls[k] = false; },
    look(y, p = 0) { yaw = y; pitch = p; },
    /** ブロックの中心を見る（サーバーは「見ている向きと操作の向き」が大きくずれると操作を認めない） */
    lookAt(target) {
      const me = bot.predicted();
      const dx = target.x - me.x, dy = target.y - (me.y + EYE), dz = target.z - me.z;
      yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
      pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    },
    get inventory() { return inventory; },
    heldItem() { return inventory.slots[inventory.selected] ?? { network_id: 0 }; },
    /** 持つ場所（ホットバー 0〜8）を選ぶ */
    selectSlot(i) {
      inventory.selected = i;
      client.queue('mob_equipment', { runtime_entity_id: runtimeId, item: inventory.slots[i] ?? { network_id: 0 }, slot: i, selected_slot: i, window_id: 'inventory' });
    },
    /**
     * ブロックを掘る（サバイバルのサーバー権威の掘り方: start → 毎 tick continue → 壊れたら predict と stop）。
     * サーバーが壊したら update_block が来る。戻りは { broken, ticks }
     */
    dig(pos, { face = 1, maxTicks = 400 } = {}) {
      bot.lookAt({ x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
      return new Promise((resolve) => { digging = { pos, face, phase: 'start', ticks: 0, max: maxTicks, broken: false, resolve }; });
    },
    /** 手に持っている物を、ブロックの面に使う（ブロックを置く・レバーを倒す・扉を開ける など） */
    useOn(pos, { face = 1, clickPos = { x: 0.5, y: 1, z: 0.5 }, target } = {}) {
      bot.lookAt({ x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
      const me = bot.predicted();
      client.queue('inventory_transaction', { transaction: {
        legacy: { legacy_request_id: 0 }, transaction_type: 'item_use', actions: [],
        transaction_data: { action_type: 'click_block', trigger_type: 'player_input', block_position: pos, face, hotbar_slot: inventory.selected, hand: 'main_hand',
          held_item: bot.heldItem(), player_pos: { x: me.x, y: me.y + EYE, z: me.z }, click_pos: clickPos, block_runtime_id: target ? blockHash(target.name ?? target, target.states ?? {}) >>> 0 : 0, client_prediction: 'success', client_cooldown_state: 'off' },
      } });
    },
    /** 手に持っている物を空中で使う（食べる・投げる・弓を引く など） */
    useItem() {
      const me = bot.predicted();
      client.queue('inventory_transaction', { transaction: {
        legacy: { legacy_request_id: 0 }, transaction_type: 'item_use', actions: [],
        transaction_data: { action_type: 'click_air', trigger_type: 'player_input', block_position: { x: 0, y: 0, z: 0 }, face: 255, hotbar_slot: inventory.selected, hand: 'main_hand',
          held_item: bot.heldItem(), player_pos: { x: me.x, y: me.y + EYE, z: me.z }, click_pos: { x: 0, y: 0, z: 0 }, block_runtime_id: 0, client_prediction: 'success', client_cooldown_state: 'off' },
      } });
    },
    /** 生き物を叩く（attack）・触る（interact） */
    hitEntity(runtimeEntityId, { interact = false } = {}) {
      const me = bot.predicted();
      client.queue('inventory_transaction', { transaction: {
        legacy: { legacy_request_id: 0 }, transaction_type: 'item_use_on_entity', actions: [],
        transaction_data: { entity_runtime_id: runtimeEntityId, action_type: interact ? 'interact' : 'attack', hotbar_slot: inventory.selected, held_item: bot.heldItem(), player_pos: { x: me.x, y: me.y + EYE, z: me.z }, click_pos: { x: 0, y: 0, z: 0 } },
      } });
    },
    ticks(n) { return new Promise((r) => { const end = tick + BigInt(n); const on = (t) => { if (t >= end) { bot.off('tick', on); r(); } }; bot.on('tick', on); }); },
    /** 近くの生き物を、近い順に返す（type で絞れる）。add_entity で見えたものだけ */
    nearby({ type = null, radius = 16 } = {}) {
      const me = bot.predicted();
      return [...bot.entities.values()]
        .filter((e) => !type || e.type === type || e.type === `minecraft:${type}`)
        .map((e) => ({ ...e, distance: Math.hypot(e.x - me.x, e.y - me.y, e.z - me.z) }))
        .filter((e) => e.distance <= radius)
        .sort((a, b) => a.distance - b.distance);
    },
    chat(message) {
      client.queue('text', { needs_translation: false, category: 'authored', type: 'chat', source_name: name, message, xuid: '', platform_chat_id: '', has_filtered_message: false });
    },
    /** コマンドを打つ（プレイヤーとして。権限が要るものはサーバーの default-player-permission-level 次第） */
    command(cmd, timeoutMs = 5000) {
      const uuid = require('node:crypto').randomUUID();
      return new Promise((resolve) => {
        const t = setTimeout(() => { pendingCommands.delete(uuid); resolve(null); }, timeoutMs);
        pendingCommands.set(uuid, (p) => { clearTimeout(t); resolve(p); });
        client.queue('command_request', { command: cmd.startsWith('/') ? cmd : `/${cmd}`, origin: { type: 'player', uuid, request_id: '', player_entity_id: 0n }, internal: false, version: 'latest' });
      });
    },
    close() { clearInterval(loop); try { client.close(); } catch { /* 閉じ済み */ } },
  }));
  return bot;
}
