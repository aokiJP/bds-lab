// 1 対 1 の戦い（サンドボックス）。2 人とも実機で測った移動（voxel.js・controls.js）で動き、戦いの決まりは combat.js（実機で測った）。
// 本物のクライアント 2 人で実機で戦わせる道具（tools/live/pvp-real.mjs）と、同じ「観測 → 操作」の口を使う。
//
//   const d = createDuel({ profile, mode: 'sumo' | 'duel', seed })
//   d.reset(); while (!d.done) d.step(actA, actB)     act = { forward, back, left, right, sprint, jump, attack }（向きは自動で相手へ）
//   d.observe(0 | 1) → 観測（自分から見た数）。d.result → { winner, reason, ticks, hits }
//
// 実機に合わせたこと:
//   ・ノックバックが効く時機: 実戦（2 人とも自分の tick ごとに決める）で測って、叩いた tick の動きの前に入るのが 114 回中 100 回、あとが 14 回（kbPre）
//   ・痛がるのが見える時機（実戦 114 回ずつ）: 叩いた次の観測で「痛がってから 1 tick」になるのが、遅い位相は叩いた人・叩かれた人とも 114/114、
//     早い位相は叩いた人 70/114・叩かれた人 92/114（残りは 0 tick）。seenOpp1・seenSelf1。止まった相手を叩く測り方では 1 tick 後に見えた（16/16）
//   ・叩かれた人に自分へのノックバックが届くのは、クライアントの位相しだいで 1 tick 遅れる（遅い位相 70/76・早い位相 13/57。selfLate）。その tick の自分の予測はノックバック無しのまま
//   ・同じ tick に 2 人が叩いたら、早い位相の方が先に受け付けられる（同時に倒れる打ち合いで 18/20。earlyFirst）。倒れた人の叩きは効かない
//   ・持っている物（items: 素手・剣・斧）でダメージが変わる（ノックバックは同じ。実機で測った weapon_*）
//   ・痛みの時間の中でも、前より強い叩き（ふつうのあとの会心）は効く: 差のダメージ・ふつうのノックバック・痛みの時間を数え直す（window_*）
//   ・走り叩きかどうかは、サーバーの「走っている」（前＋後ろの間は落ちる）の 2 つ前の入力のときの値（175/185。sprintLag2）
//   ・叩くかどうかは、クライアントが知っていること（自分の予測・遅れて見える相手）で決める
//   ・相手の位置は少し遅れて見える（実機ではネットワーク越し。observeDelay tick 前の位置）
//   ・ノックバックの向きに使う叩いた人の位置は、0〜2 tick 前のどれか（実機で測った割合で揺らす。posLag）
//   ・届く距離は目から 3 ブロック（ふつうのクライアント）。向きは相手の当たり判定の中心へ（マウスで正確に狙うのと同じ）
//   ・プレイヤーどうしはすり抜ける
import { createVoxelWorld } from '../worlds/voxel.js';
import { createControlState } from '../agent/controls.js';
import { COMBAT, knockback, reachDistance, damageOf } from './combat.js';
import { mulberry32 } from '../agent/learner.js';

/** 土俵: sumo は 9×9 の台（落ちたら負け）、duel は 25×25 の平らな床（体力 0 で負け） */
export function arenaBlocks(mode) {
  if (mode === 'sumo') return { blocks: [{ from: { x: -4, y: 0, z: -4 }, to: { x: 4, y: 3, z: 4 }, type: 'stone' }], top: 4, half: 4.5 };
  return { blocks: [{ from: { x: -12, y: 0, z: -12 }, to: { x: 12, y: 1, z: 12 }, type: 'stone' }], top: 2, half: 12.5 };
}

export const yawTo = (from, to) => (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;

/**
 * 観測（サンドボックスでも本物のクライアントでも同じ計算）。s = 自分（足の位置・1 tick の動き vx/vy/vz・接地）、
 * o = 見えている相手（同じ形）。extra = { sprinting, sinceOppHurt, sinceMyHurt, health, half, tick }
 */
export function observation(s, o, { sprinting, sinceOppHurt, sinceMyHurt, health, half, tick = 0 }) {
  const yaw = yawTo(s, o) * Math.PI / 180; const c = Math.cos(yaw), sn = Math.sin(yaw);
  // 向き（相手の方）を前とする座標: 前 = (-sin, cos)、左 = (cos, sin)
  const toF = (x, z) => [x * -sn + z * c, x * c + z * sn];
  const [rf, rl] = toF(o.x - s.x, o.z - s.z);
  const [vf, vl] = toF(s.vx, s.vz); const [of, ol] = toF(o.vx, o.vz);
  const edge = (p) => half - Math.max(Math.abs(p.x - 0.5), Math.abs(p.z - 0.5));
  const [cf, cl] = toF(0.5 - s.x, 0.5 - s.z);
  return {
    dist: Math.hypot(rf, rl), dy: o.y - s.y, vf, vl, vy: s.vy, of, ol, ovy: o.vy,
    ground: s.onGround ? 1 : 0, oground: o.onGround ? 1 : 0, sprinting: sprinting ? 1 : 0,
    myEdge: edge(s), oppEdge: edge(o),
    sinceOppHurt: Math.min(40, sinceOppHurt), sinceMyHurt: Math.min(40, sinceMyHurt), health,
    reach: reachDistance({ x: s.x, y: s.y + COMBAT.eye, z: s.z }, o), cf, cl, tick,
  };
}

export function createDuel({ profile, mode = 'sumo', seed = 1, origin = { x: 20, y: -60, z: 20 }, maxTicks = mode === 'sumo' ? 600 : 1200, kbPre = 100 / 114, posLag = [19 / 52, 8 / 52], observeDelay = 1, spread = 5, phases = null, selfLate = { late: 70 / 76, early: 13 / 57 }, earlyFirst = 18 / 20, sprintLag2 = 175 / 185, seenOpp1 = { late: 114 / 114, early: 70 / 114 }, seenSelf1 = { late: 114 / 114, early: 92 / 114 }, randomize = false, items = ['hand', 'hand'], keepLog = true } = {}) {
  const A = arenaBlocks(mode);
  let rnd = mulberry32(seed);
  // ネットワークの時機（測った割合）。randomize なら試合ごとに測った値のまわりの広い幅から引く（育てるときだけ。
  // 細かい時機に頼った技は実機で通じなかった: duel で毎 tick 叩く相手に、サンドボックス 96% → 実機 6/10）
  let kbP = kbPre, sl = { ...selfLate }, ef = earlyFirst, s2 = sprintLag2, so1 = { ...seenOpp1 }, ss1 = { ...seenSelf1 }, od = observeDelay;
  const bodies = [0, 1].map(() => ({ w: createVoxelWorld({ origin, blocks: A.blocks, spawn: { x: 0.5, y: A.top, z: 0.5 }, profile }), ctl: createControlState() }));
  let tick = 0; let pending = []; const history = []; const posHist = [[], []]; const log = [];
  // 1 tick ごとに作り直さない入れ物（中身は毎 tick 上書き。外へ持ち出さない）
  const acts = [null, null]; const inputs = [null, null]; const eyeBuf = { x: 0, y: 0, z: 0 }; const ctlArg = { onGround: true };
  // 位置の写しの入れ物（1 tick ごとに作らない）。history は 8 tick ぶんしか残らないので、10 組を順に使い回せば上書きは起きない
  const mkPose = () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, sprinting: false, yaw: 0, collidedH: false });
  const histPool = Array.from({ length: 10 }, () => [mkPose(), mkPose()]); let histAt = 0;
  const posPool = [Array.from({ length: 6 }, () => ({ x: 0, z: 0 })), Array.from({ length: 6 }, () => ({ x: 0, z: 0 }))]; const posAt = [0, 0];
  const scratch = [mkPose(), mkPose()]; const selfBuf = mkPose(); // その tick のあいだだけ使う（中身はすぐ読まれる）
  const ctlEnv = (g) => { ctlArg.onGround = g; return ctlArg; };
  const obsArg = { sprinting: false, sinceOppHurt: 0, sinceMyHurt: 0, health: 1, half: 0, tick: 0 };
  const state = { done: false, result: null };
  const me = (i) => bodies[i].w.pose(); // 位置・速さ・接地だけ（block の入れ物は作らない）
  function reset() {
    tick = 0; pending = []; history.length = 0; log.length = 0; posHist[0].length = 0; posHist[1].length = 0; state.done = false; state.result = null;
    od = observeDelay;
    if (randomize) {
      kbP = 0.6 + 0.4 * rnd(); sl = { late: 0.5 + 0.5 * rnd(), early: 0.5 * rnd() }; ef = 0.5 + 0.5 * rnd(); s2 = 0.75 + 0.25 * rnd();
      so1 = { late: 0.6 + 0.4 * rnd(), early: 0.3 + 0.7 * rnd() }; ss1 = { late: 0.6 + 0.4 * rnd(), early: 0.5 + 0.5 * rnd() };
      // 相手が見える遅れ: 手元の実機では 1 tick だが、ネット越しのサーバーでは 1〜3 tick（50〜150ms）遅れて見えることがある。試合ごとに引く
      od = 1 + Math.floor(3 * rnd());
    }
    const ang = rnd() * Math.PI * 2; const r = spread / 2;
    const pts = [{ x: Math.round(Math.sin(ang) * r), z: Math.round(Math.cos(ang) * r) }, { x: -Math.round(Math.sin(ang) * r), z: -Math.round(Math.cos(ang) * r) }]; // 整数 ＋ 0.5（実機の tp は整数を 0.5 にずらすので、はじめから真ん中に置く）
    bodies.forEach((b, i) => {
      b.w.reset(); b.w.setState({ pos: { x: pts[i].x + 0.5, y: A.top, z: pts[i].z + 0.5 }, vel: { x: 0, y: 0, z: 0 }, onGround: true, yaw: 0 });
      for (let k = 0; k < 5; k++) b.w.step({});
      b.ctl.reset(); b.health = COMBAT.health; b.lastDamageTick = -1000; b.lastDamageAmount = 0; b.hurtSeen = -1000; b.hurtSelf = -1000; b.ghost = null; b.srvSprint = []; b.phase = phases ? phases[i] : (rnd() < 0.5 ? 'late' : 'early'); b.hits = 0; b.landed = 0; b.yaw = 0;
    });
    history.push([me(0), me(1)]);
    for (const i of [0, 1]) { const p = me(i); posHist[i].push({ x: p.x, z: p.z }); }
  }
  /** i のクライアントが知っている自分（予測）と相手（ネットワーク越しに遅れて届いた位置）。
   *  自分へのノックバックが 1 tick 遅れて届いた tick は、ノックバックの無い予測のまま（本物のクライアントは次の tick に巻き戻して入れる） */
  /** i のクライアントが知っている自分（予測） */
  function seenSelf(i) { const g = bodies[i].ghost; return g && g.tick === tick ? g.obs : bodies[i].w.poseInto(selfBuf); }
  /** i に見えている相手（ネットワーク越しに遅れて届いた位置） */
  function seenOpp(i) { return (history[Math.max(0, history.length - 1 - od)] ?? history[history.length - 1])[1 - i]; }
  /** i から見た観測。相手は observeDelay tick 前の位置（ネットワークの遅れ）。痛がったのが見えるのはノックバックが入った tick */
  function observe(i) {
    const j = 1 - i;
    obsArg.sprinting = bodies[i].ctl.sprinting; obsArg.sinceOppHurt = tick - bodies[j].hurtSeen; obsArg.sinceMyHurt = tick - bodies[i].hurtSelf;
    obsArg.health = bodies[i].health / COMBAT.health; obsArg.half = A.half; obsArg.tick = tick;
    return observation(seenSelf(i), seenOpp(i), obsArg);
  }
  /** ノックバックとダメージを入れる（痛みの時間の中なら何もしない） */
  // 同じ tick の叩きをサーバーが受け取る順: 早い位相のクライアント（自分へのノックバックが遅れずに届く方）が先（実機で、同時に倒れる打ち合い 20 回中 18 回、早い方が勝った）。
  // 先に倒れた人の叩きは効かない
  function order(list) {
    if (list.length < 2) return list;
    const ph = (p) => bodies[p.attacker].phase;
    const firstEarly = ph(list[0]) === ph(list[1]) ? rnd() < 0.5 : rnd() < ef;
    return [...list].sort((a, b) => (ph(a) === ph(b) ? 0 : (ph(a) === 'early') === firstEarly ? -1 : 1));
  }
  /** ノックバックとダメージを入れる（痛みの時間の中なら何もしない）。pre = この tick の動きの前に入る */
  function applyHits(list, pre) {
    for (const p of order(list)) {
      const v = bodies[1 - p.attacker];
      if (bodies[p.attacker].health <= 0) continue; // 叩いた人が先に倒れた
      // 痛みの時間（10 tick）の中は、前より強い叩き（会心が、ふつうのあと）だけが効く: 差のダメージ・ふつうのノックバック・痛みの時間を数え直す
      // （実機で測った: window_crit_after_normal_*・window_after_upgrade_*。sumo で 2 回続けて飛ばされて落ちたのはこれ）
      const amt = p.dmg.amount ?? 0; const within = p.hitTick - v.lastDamageTick < COMBAT.hurtTicks;
      if (within && !(amt > v.lastDamageAmount)) continue;
      const dealt = within ? amt - v.lastDamageAmount : amt;
      // 自分へのノックバック（と痛み）が届くのが 1 tick 遅れるか（クライアントの位相で決まる。実機: 遅い位相 70/76・早い位相 13/57）
      const late = rnd() < sl[v.phase];
      v.lastDamageTick = p.hitTick; v.lastDamageAmount = amt; v.hurtSeen = p.hitTick + (rnd() < so1[bodies[p.attacker].phase] ? 0 : 1); v.hurtSelf = p.hitTick + (rnd() < ss1[v.phase] ? 0 : 1); v.health -= dealt; bodies[p.attacker].landed++; // 叩いた次の観測で「痛がってから 1 tick」か「0 tick」（位相しだい。実戦で測った: seenOpp1・seenSelf1）
      if (keepLog) log.push({ t: tick, type: 'land', who: p.attacker, crit: p.dmg.crit, sprint: p.sprint });
      const vs = v.w.snapshot(); const vp = v.w.pose();
      if (late) v.ghost = { tick: tick + 1, before: vs, pre, obs: pre ? null : vp };
      const k = knockback(vs, p.from, { x: vp.x, z: vp.z }, p.sprint);
      v.w.setState({ vel: k });
    }
  }
  function step(actA, actB) {
    if (state.done) return;
    acts[0] = actA; acts[1] = actB;
    // 叩く（叩いた瞬間の位置・状態で決まる。当たるのは目から 3 ブロック以内）
    for (let i = 0; i < 2; i++) {
      const a = acts[i]; if (!a?.attack) continue;
      const sc = seenSelf(i), o = seenOpp(i); const s = bodies[i].w.poseInto(scratch[0]); // 叩くかどうかは、クライアントが知っていること（自分の予測・遅れて見える相手）で決まる
      eyeBuf.x = sc.x; eyeBuf.y = sc.y + COMBAT.eye; eyeBuf.z = sc.z;
      if (reachDistance(eyeBuf, o) > COMBAT.reach) continue;
      const st = bodies[i].w.snapshot();
      bodies[i].hits++;
      if (keepLog) log.push({ t: tick, type: 'swing', who: i, sinceOppHurtEnd: tick - bodies[1 - i].lastDamageTick - COMBAT.hurtTicks, sprint: bodies[i].srvSprint.at(-2) ?? false, air: !st.onGround });
      // サーバーが使う叩いた人の位置は、叩いた tick の 0〜2 tick 前（実機の 52 回の叩きで: 0 tick 19 回・1 tick 8 回・2 tick 23 回・1 tick 先 2 回）
      const u = rnd(); const lagPos = u < posLag[0] ? 0 : u < posLag[0] + posLag[1] ? 1 : 2;
      const from = posHist[i][Math.max(0, posHist[i].length - 1 - lagPos)] ?? { x: s.x, z: s.z };
      // いつ効くか（実戦で測った。叩かれた人の時計で、叩いた人が叩いた tick の 1 つ前: 114 回中 100 回 → この tick の動きの前に入る。
      // 0: 14 回 → この tick の動きのあとに入る）。叩かれた人のクライアントは巻き戻して入れるので、前の tick の分から効く
      // 走り叩きかどうかは、サーバーの「走っている」で決まる。前＋後ろを押している間は落ち、離すと戻る（controls の走りの続きはそのまま）。
      // 叩きに使われるのは 2 つ前の入力のときの値（実戦 185 回中 175 回。残りは 1 つ前）
      const sh = bodies[i].srvSprint; const lagS = rnd() < s2 ? 2 : 1;
      const sprintHit = sh[sh.length - lagS] ?? false;
      pending.push({ at: rnd() < kbP ? -1 : 0, attacker: i, from, sprint: sprintHit, dmg: damageOf({ onGround: st.onGround, dy: s.vy, sprinting: sprintHit }, items[i]), hitTick: tick });
    }
    // この tick の動きの前に入るノックバック
    if (pending.length) { applyHits(pending.filter((p) => p.at === -1), true); pending = pending.filter((p) => p.at !== -1); }
    // 動く（向きは相手へ）
    for (let i = 0; i < 2; i++) {
      const s = bodies[i].w.poseInto(scratch[0]), o = bodies[1 - i].w.poseInto(scratch[1]); const b = bodies[i]; const a = acts[i] ?? {};
      b.yaw = yawTo(s, o);
      const inp = b.ctl.input(a, ctlEnv(s.onGround)); inp.yaw = b.yaw; inputs[i] = inp;
      b.srvSprint.push(b.ctl.sprinting && !!a.forward && !a.back); if (b.srvSprint.length > 4) b.srvSprint.shift(); // サーバーの「走っている」（実機で測った: 前＋後ろの間だけ落ちる）
      b.w.step(inputs[i]);
    }
    // 自分へのノックバックが遅れて届く人: この tick の予測は、ノックバックの無いまま動いた位置
    for (let i = 0; i < 2; i++) {
      const g = bodies[i].ghost; if (!g || g.tick !== tick + 1 || !g.pre) continue;
      const real = bodies[i].w.snapshot(); bodies[i].w.restore(g.before); bodies[i].w.step(inputs[i]); g.obs = me(i); bodies[i].w.restore(real);
    }
    // ノックバックとダメージ（叩いた tick ＋ 遅れ のあと）
    if (pending.length) { applyHits(pending, false); pending.length = 0; }
    tick++;
    const last = histPool[histAt]; histAt = (histAt + 1) % histPool.length;
    bodies[0].w.poseInto(last[0]); bodies[1].w.poseInto(last[1]);
    history.push(last); if (history.length > 8) history.shift();
    for (let i = 0; i < 2; i++) {
      const p = last[i]; const q = posPool[i][posAt[i]]; posAt[i] = (posAt[i] + 1) % 6;
      q.x = p.x; q.z = p.z; posHist[i].push(q); if (posHist[i].length > 4) posHist[i].shift();
    }
    // 勝ち負け
    const fallen = [last[0].y < A.top - 1, last[1].y < A.top - 1];
    const lost = [bodies[0].health <= 0 || fallen[0], bodies[1].health <= 0 || fallen[1]]; // 体力 0（実機では死ぬ）か落ちたら負け。sumo でも体力は減る
    if (lost[0] || lost[1] || tick >= maxTicks) {
      state.done = true;
      const winner = lost[0] && !lost[1] ? 1 : lost[1] && !lost[0] ? 0 : tick >= maxTicks ? (bodies[0].health === bodies[1].health ? null : bodies[0].health > bodies[1].health ? 0 : 1) : null;
      state.result = { winner, reason: lost[0] || lost[1] ? (fallen[0] || fallen[1] ? '落ちた' : '体力') : '時間切れ', ticks: tick, hits: bodies.map((b) => b.hits), landed: bodies.map((b) => b.landed), health: bodies.map((b) => b.health) };
    }
  }
  const starts = () => bodies.map((b) => { const p = b.w.observe().player; return { x: p.x, y: p.y, z: p.z }; });
  /** 種を入れ直す（同じ台・同じ体を使い回して次の試合へ。createDuel し直したのと 1 bit も同じ） */
  const reseed = (n) => { rnd = mulberry32(n); };
  return { reset, reseed, step, observe, starts, log, get done() { return state.done; }, get result() { return state.result; }, get tick() { return tick; }, me, bodies, arena: A };
}
