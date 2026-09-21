import * as MC from '@minecraft/server';
import { world, system, GameMode, InputButton } from '@minecraft/server';
import * as gt from '@minecraft/server-gametest';

const LOAD_ID = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const dim = () => world.getDimension('overworld');
// getAllPlayers() は undefined を混ぜて返すことがある（1.26.51.1 で実測）。必ず弾いてから使う
const players = () => world.getAllPlayers().filter(Boolean);
const reply = (id, ok, p) => console.warn(`LAB ${id} ${ok ? 'ok' : 'err'} ${typeof p === 'string' ? p : JSON.stringify(p ?? null)}`);
const num = (n) => Number(Number(n).toFixed(6));
const vec = (v) => ({ x: num(v.x), y: num(v.y), z: num(v.z) });

let sim = null;
let target = null;
let live = null;
let src = [];

function need() {
  if (target) {
    const p = players().find((x) => x.name === target);
    if (!p) throw new Error(`${target} が居ません`);
    sim = p;
    return;
  }
  if (!sim || !sim.isValid) throw new Error('プレイヤーが居ません（先に spawn か attach）');
}

function release() {
  if (!live) return 0;
  let n = 0;
  for (const s of live.subs) { try { s.signal.unsubscribe(s.handle); n++; } catch { /* 外れていればよい */ } }
  for (const id of live.runs) { try { system.clearRun(id); n++; } catch { /* 同上 */ } }
  live = null;
  return n;
}

const keysOf = (o) => {
  const out = [];
  const seen = new Set();
  let at = o;
  while (at && at !== Object.prototype) {
    let names = [];
    try { names = Object.getOwnPropertyNames(at); } catch { names = []; }
    for (const k of names) { if (k === 'constructor' || seen.has(k)) continue; seen.add(k); out.push(k); }
    at = Object.getPrototypeOf(at);
  }
  return out;
};

const wrapSignal = (sig, reg) => ({
  subscribe(cb, ...rest) { const h = sig.subscribe(cb, ...rest); reg.subs.push({ signal: sig, handle: h === undefined ? cb : h }); return h; },
  unsubscribe(h) { reg.subs = reg.subs.filter((x) => !(x.signal === sig && x.handle === h)); return sig.unsubscribe(h); },
});

function wrapEvents(source, reg) {
  const out = Object.create(null);
  if (!source) return out;
  for (const k of keysOf(source)) {
    let sig;
    try { sig = source[k]; } catch { continue; }
    if (sig && typeof sig.subscribe === 'function') out[k] = wrapSignal(sig, reg);
  }
  return out;
}

const bindTo = (v, t) => (typeof v === 'function' ? v.bind(t) : v);

// Proxy は実機が弾く（proxy: inconsistent get）。素の入れ物に写して包む。
function shim(base, overrides) {
  const out = Object.create(null);
  for (const k of keysOf(base)) {
    if (k in overrides) continue;
    let v;
    try { v = base[k]; } catch { continue; }
    out[k] = bindTo(v, base);
  }
  Object.assign(out, overrides);
  return out;
}

function wrapWorld(reg) {
  return shim(world, {
    afterEvents: wrapEvents(world.afterEvents, reg),
    beforeEvents: wrapEvents(world.beforeEvents, reg),
  });
}

function wrapSystem(reg) {
  const keep = (name) => (...a) => { const id = system[name](...a); reg.runs.push(id); return id; };
  return shim(system, {
    afterEvents: wrapEvents(system.afterEvents, reg),
    beforeEvents: wrapEvents(system.beforeEvents, reg),
    run: keep('run'),
    runTimeout: keep('runTimeout'),
    runInterval: keep('runInterval'),
    clearRun: (id) => { reg.runs = reg.runs.filter((x) => x !== id); return system.clearRun(id); },
  });
}

const OPS = {
  ping: () => ({ tick: system.currentTick, loadId: LOAD_ID }),

  evalSupported: () => {
    try { return { ok: new Function('return 1')() === 1 }; }
    catch (e) { return { ok: false, reason: String(e?.message ?? e) }; }
  },

  srcBegin: () => { src = []; return { ok: true }; },
  srcChunk: ({ text }) => { src.push(text); return { n: src.length }; },

  evalLoad: () => {
    const cleared = release();
    const source = src.join('');
    src = [];
    const reg = { subs: [], runs: [] };
    const mc = Object.create(null);
    Object.assign(mc, MC);
    mc.world = wrapWorld(reg);
    mc.system = wrapSystem(reg);
    const fn = new Function('__outside', source);
    live = reg;
    fn({ '@minecraft/server': mc });
    return { cleared, chars: source.length, subs: reg.subs.length, runs: reg.runs.length };
  },

  evalUnload: () => ({ cleared: release() }),

  // ネットワーク越しに入っている本物のプレイヤーを操作対象にする
  attach: ({ name }) => {
    const p = players().find((x) => x.name === name);
    if (!p) return { attached: false, players: players().map((x) => x.name) };
    target = name;
    sim = p;
    return { attached: true, name: p.name };
  },

  detach: () => { target = null; sim = null; return { detached: true }; },

  spawn: ({ at = { x: 8, y: -59, z: 8 }, name = 'Sim', gameMode = 'Creative' } = {}) => {
    target = null;
    if (sim) { try { sim.disconnect(); } catch { try { sim.remove(); } catch { /* 片付けだけ */ } } }
    sim = gt.spawnSimulatedPlayer({ dimension: dim(), ...at }, name, gameMode);
    return { name: sim.name };
  },

  despawn: () => {
    if (target) { target = null; sim = null; return { removed: false, detached: true }; }
    if (!sim) return { removed: false };
    try { sim.disconnect(); } catch { sim.remove(); }
    sim = null;
    return { removed: true };
  },

  gamemode: ({ mode }) => { need(); sim.setGameMode(GameMode[mode] ?? mode); return { mode: sim.getGameMode() }; },
  tp: ({ at, rotation }) => { need(); sim.teleport(at, rotation ? { rotation } : undefined); return vec(sim.location); },
  look: ({ yaw = 0, pitch = 0 }) => { need(); sim.setRotation({ x: pitch, y: yaw }); return { yaw, pitch }; },
  move: ({ x = 0, y = 0 }) => { need(); sim.moveRelative(x, y); return { x, y }; },
  stop: () => { need(); sim.stopMoving(); return {}; },
  jump: () => { need(); return { jumped: sim.jump() }; },
  sneak: ({ on }) => { need(); sim.isSneaking = Boolean(on); return { sneaking: sim.isSneaking }; },

  button: ({ button, state }) => { need(); return { button, state, note: '届き方は real で確かめること' }; },

  read: ({ what }) => {
    need();
    switch (what) {
      case 'location': return vec(sim.location);
      case 'rotation': { const r = sim.getRotation(); return { yaw: num(r.y), pitch: num(r.x) }; }
      case 'view': return vec(sim.getViewDirection());
      case 'velocity': return vec(sim.getVelocity());
      case 'gamemode': return { mode: sim.getGameMode() };
      case 'movementVector': { const v = sim.inputInfo.getMovementVector(); return { x: num(v.x), y: num(v.y) }; }
      case 'buttons': return { Jump: sim.inputInfo.getButtonState(InputButton.Jump), Sneak: sim.inputInfo.getButtonState(InputButton.Sneak) };
      case 'permissions': return { lateral: sim.inputPermissions.isPermissionCategoryEnabled(4), movement: sim.inputPermissions.isPermissionCategoryEnabled(2) };
      default: throw new Error(`知らない read: ${what}`);
    }
  },

  component: ({ id }) => {
    need();
    const c = sim.getComponent(id);
    if (!c) return { present: false };
    const out = { present: true };
    for (const k of ['value', 'currentValue', 'defaultValue', 'effectiveMax', 'effectiveMin']) {
      if (typeof c[k] === 'number') out[k] = num(c[k]);
    }
    return out;
  },

  api: ({ path: p }) => {
    need();
    let cur = sim;
    for (const seg of p.split('.')) { if (cur == null) return { exists: false }; cur = cur[seg]; }
    return { exists: cur !== undefined, type: typeof cur };
  },

  reflect: ({ depth = 2 } = {}) => {
    const seen = new Set();
    const walk = (obj, d) => {
      if (obj == null || d > depth) return undefined;
      const t = typeof obj;
      if (t !== 'object' && t !== 'function') return t;
      if (seen.has(obj)) return '(循環)';
      seen.add(obj);
      const out = {};
      let at = obj;
      const done = new Set();
      while (at && at !== Object.prototype && at !== Function.prototype) {
        for (const k of Object.getOwnPropertyNames(at)) {
          if (done.has(k) || k === 'constructor' || k.startsWith('_')) continue;
          done.add(k);
          const desc = Object.getOwnPropertyDescriptor(at, k);
          if (!desc) continue;
          if (typeof desc.value === 'function') { out[k] = `fn(${desc.value.length})`; continue; }
          if (desc.get) { out[k] = 'get'; continue; }
          out[k] = d < depth ? walk(desc.value, d + 1) ?? typeof desc.value : typeof desc.value;
        }
        at = Object.getPrototypeOf(at);
      }
      return out;
    };
    const out = {};
    for (const [k, v] of Object.entries(MC)) {
      if (v && (typeof v === 'function') && v.prototype) out[k] = walk(v.prototype, 1);
      else if (v && typeof v === 'object') out[k] = walk(v, 1);
      else out[k] = typeof v;
    }
    return out;
  },

  // --- sim と real の両方から同じ名前で呼ぶもの（値はいつも実機の中の本当の値） ---

  /** 近くの生き物を、近い順に返す。アドオンが湧かせたものを確かめるのに使う */
  entities: ({ type = null, radius = 32, at = null } = {}) => {
    const center = at ?? (sim && sim.isValid ? sim.location : { x: 0, y: -59, z: 0 });
    const opts = { location: center, maxDistance: radius };
    if (type) opts.type = String(type).includes(':') ? type : `minecraft:${type}`;
    return dim().getEntities(opts).filter(Boolean).map((e) => ({
      typeId: e.typeId,
      name: e.nameTag || e.typeId,
      location: vec(e.location),
      health: (() => { try { return num(e.getComponent('minecraft:health')?.currentValue ?? -1); } catch { return -1; } })(),
    }));
  },

  /** 持ち物を渡す（sim でも real でも同じ。コマンド経由なので本物のプレイヤーにも効く） */
  give: ({ item, count = 1, slot = null }) => {
    need();
    const r = sim.runCommand(`give @s ${item} ${count}`);
    if (slot !== null) { try { sim.selectedSlotIndex = slot; } catch { /* real では選べないことがある */ } }
    return { successCount: r.successCount };
  },

  /** 足場や的を建てる。仕様書から場面を作るのに使う */
  setBlock: ({ at, block = 'minecraft:stone' }) => {
    dim().setBlockType(at, block);
    return { at: vec(at), block };
  },

  health: () => { need(); const c = sim.getComponent('minecraft:health'); return { current: num(c?.currentValue ?? -1), max: num(c?.effectiveMax ?? -1) }; },

  /** SimulatedPlayer だけ。本物のクライアントはクライアント側から叩く（real-ctx がやる） */
  attackNearest: ({ type = null, radius = 8 }) => {
    need();
    if (typeof sim.attackEntity !== 'function') throw new Error('この相手は attackEntity を持ちません（本物のクライアントでは real 側から叩いてください）');
    const opts = { location: sim.location, maxDistance: radius, excludeTypes: ['minecraft:player'] };
    if (type) opts.type = String(type).includes(':') ? type : `minecraft:${type}`;
    const target = dim().getEntities(opts).filter(Boolean)[0];
    if (!target) return { hit: false };
    sim.lookAtEntity?.(target);
    return { hit: sim.attackEntity(target), typeId: target.typeId };
  },

  use: () => { need(); if (typeof sim.useItemInSlot !== 'function') throw new Error('useItemInSlot がありません'); return { used: sim.useItemInSlot(sim.selectedSlotIndex ?? 0) }; },

  breakBlock: ({ at }) => { need(); if (typeof sim.breakBlock !== 'function') throw new Error('breakBlock がありません'); return { started: sim.breakBlock(at) }; },

  send: ({ id, message = '' }) => { system.sendScriptEvent(id, message); return { sent: id }; },
  cmd: ({ command }) => { need(); return { successCount: sim.runCommand(command).successCount }; },
};

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== 'lab:do') return;
  let req;
  try { req = JSON.parse(ev.message); } catch { return reply('?', false, 'JSON として読めません'); }
  const fn = OPS[req.op];
  if (!fn) return reply(req.id, false, `知らない op: ${req.op}`);
  system.run(() => {
    try { reply(req.id, true, fn(req.args ?? {})); }
    catch (e) { reply(req.id, false, String(e?.message ?? e)); }
  });
}, { namespaces: ['lab'] });

system.runInterval(() => console.warn(`LABTICK ${system.currentTick}`), 1);

console.warn(`LAB ready ${LOAD_ID}`);
