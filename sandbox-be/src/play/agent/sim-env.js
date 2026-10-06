// サンドボックスの中の「体」— 学習の頭（learner.js）に、実機の本物のクライアントと同じ形の操作口（io）を渡す。
//
// 物理は src/play/worlds/voxel.js（実機で測った値。SimulatedPlayer の記録と 2 ulp 以内、本物のクライアントと 2e-5 以内で一致）。
// 本物のクライアントの自分の予測も同じ voxel.js なので、io.me() は実機のときと同じ計算で出る。
// 仕掛け（triggers）: { when: { standOn: [x, y, z], requires?: [k…] }, set: [{ from, to, type }] } — そのブロックの上に立つと、ブロックが置き換わる
// （requires: 先に k 番の仕掛けが動いていないと、立っても何も起きない。順番のある謎解き）
// （扉が開く・橋が架かる）。{ win: true } なら勝ちの合図（実機ではタイトル「CLEAR」）。実機では tools/live/real-env.mjs が同じ規則で fill を打つ。
import { createVoxelWorld } from '../worlds/voxel.js';
import { mulberry32 } from './learner.js';
import { createControlState } from './controls.js';

export function createSimEnv(course, { profile, jitter = 0, seed = 7, origin, origins } = {}) {
  if (!profile) throw new Error('物理の定数（data/player-physics.json）が要ります');
  const W = course.world ?? course;
  const triggers = W.triggers ?? [];
  const rnd = mulberry32(seed);
  let world; let mask = 0; let blocks = W.blocks; let won = false;
  let controls = { forward: false, sprint: false, jump: false }; let yaw = W.yaw ?? 0;
  let pending = null; // 揺らぎ（jitter）: 操作の切り替えが 1 tick 遅れる
  let ticks = 0;
  const fired = []; // 仕掛けが動いた tick
  let order = []; // この回に動いた仕掛けの順（ブロックを戻すのに使う）
  // 原点: 1 つ（origin）か、順に使う並び（origins。実機のレーンと同じ原点で学ぶため）
  const list = origins?.length ? origins : [origin ?? null];
  let oi = 0; let made = -1; let forced = null;
  // 原点ごとに 1 つずつ世界を作って使い回す。仕掛けで変わったブロックは resetBlocks で元に戻す（作り直さない）
  const worlds = [];
  const make = () => {
    const o = list[oi];
    if (!worlds[oi]) worlds[oi] = createVoxelWorld({ ...W, blocks: W.blocks, profile, ...(o ? { origin: o } : {}) });
    world = worlds[oi]; world.resetBlocks(); made = oi; mask = 0; blocks = W.blocks; won = false; order = [];
  };
  make();

  const ctl = createControlState(); // 走りの掛け金・前の二度押し（本物のクライアントと同じ）
  const input = () => ({ ...ctl.input(controls, { onGround: world.observe().player.onGround }), yaw });
  // 実機で測っていない入力の組み合わせ（触れたら数えて issues に積む。推測で埋めない）:
  //   壁に当たった次の tick に、地面で向きを変えて走る → サーバーはその tick を走りとして扱わないことがある
  //   （壁から向き直して走り跳び: 跳躍の +0.2 が無く加速も歩き／角から向き直して走る: 1 tick 遅れて走り出す。
  //   まっすぐな壁から 180° 向き直して走るだけなら一致する。決まりがまだ分からないので、まとめて「測っていない」とする）。
  //   学習の頭（learner.js）は、これが出た手をその状態では使わない
  const extraIssues = new Map();
  let unmeasured = 0;
  let lastYaw = yaw;
  function tick(n = 1) {
    for (let i = 0; i < n; i++) {
      const before = world.observe().player;
      const inp = input();
      if (before.collidedH && inp.sprint && before.onGround && Math.abs(inp.yaw - lastYaw) > 1e-6) {
        unmeasured++;
        extraIssues.set('input:turn_sprint_after_wall', '壁に当たった次の tick に、地面で向きを変えて走った（実機ではその tick が走りにならないことがある。決まりは未測定）');
      }
      lastYaw = inp.yaw;
      world.step(inp);
      ticks++;
      if (pending) { controls = pending; pending = null; }
      if (triggers.length) {
        const p = world.pose();
        if (p.onGround) {
          const bx = Math.floor(p.x), by = Math.floor(p.y - 0.01), bz = Math.floor(p.z);
          triggers.forEach((t, k) => {
            if (mask & (1 << k)) return;
            const [x, y, z] = t.when.standOn;
            if (t.when.requires && !t.when.requires.every((r) => mask & (1 << r))) return; // 先に動いていないといけない仕掛け
            if (x === bx && y === by && z === bz) { mask |= 1 << k; fired.push({ k, tick: ticks }); order.push(k); if (t.set) { world.edit(t.set); blocks = [...blocks, ...t.set]; } if (t.win) won = true; }
          });
        }
      }
    }
  }
  const setControls = (c) => {
    const next = { ...controls, ...c };
    if (jitter && rnd() < jitter) pending = next; else controls = next;
  };
  const io = {
    place() { if (forced !== null) { oi = forced; forced = null; } else if (list.length > 1) oi = (oi + 1) % list.length; if (mask || won || made !== oi) make(); world.reset(); lastYaw = W.yaw ?? 0; controls = { forward: false, sprint: false, jump: false }; ctl.reset(); pending = null; yaw = W.yaw ?? 0; },
    controls: setControls,
    look(y) { yaw = y; },
    stop() { controls = { forward: false, sprint: false, jump: false }; pending = null; },
    // block の入れ物を作らない軽い写し（1 tick に何度も呼ぶ。中身は前と同じ）
    me() { return world.pose(); },
    world() { return { blocks, mask, won }; },
    unmeasured: () => unmeasured,
  };
  // 丸ごと写す／戻す（先を読む頭 planner.js が使う。サンドボックスだけ。実機は写せないので、実機では使わない）
  function save() {
    return { s: world.snapshot(), oi, mask, won, order: order.slice(), blocks, controls: { ...controls }, pending: pending && { ...pending }, yaw, lastYaw, ctl: ctl.save() };
  }
  function load(x) {
    if (x.oi !== oi) { oi = x.oi; forced = null; make(); }
    if (order.join() !== x.order.join()) { world.resetBlocks(); for (const k of x.order) if (triggers[k].set) world.edit(triggers[k].set); }
    world.restore(x.s); mask = x.mask; won = x.won; order = x.order.slice(); blocks = x.blocks;
    controls = { ...x.controls }; pending = x.pending && { ...x.pending }; yaw = x.yaw; lastYaw = x.lastYaw; ctl.load(x.ctl);
  }
  return { io, tick, save, load, fired, origins: list, useOrigin(i) { forced = i; }, get origin() { return list[oi]; }, issues: () => [...world.issues(), ...[...extraIssues].map(([id, why]) => ({ id, why }))], get ticks() { return ticks; } };
}
