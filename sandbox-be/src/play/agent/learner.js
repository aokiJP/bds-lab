// 遊んで覚えるプレイヤーの「頭」。実機（本物のクライアント）でも、サンドボックス（実機と同じ物理）でも、同じこのコードが動く。
//
//   const L = createLearner({ course, seed })
//   const g = L.episode(io, { greedy })   ジェネレータ。yield n は「n tick 進めて」の意味
//     io.place()            出発点に置く（実機: tp。サンドボックス: 置き直す）
//     io.controls({ forward, sprint, jump }) / io.look(yaw) / io.stop()
//     io.me()               自分の状態（足の位置・1 tick の動き・接地。原点からの相対）。本物のクライアントなら自分の予測
//     io.world()            { blocks, mask }  いま見えているブロック（扉が開くと変わる）と、動いた仕掛けのビット
//     io.refill?()          回の始めに体の状態を戻す（実機だけ）
//   サンドボックスでは yield を同期で回す（1 秒に何千回）。実機では await bot.ticks(n)（1 tick = 50ms）。
//   どちらも同じ入力の列を送るので、同じ結果になる（物理が実機と一致していることは test/physics・realcheck で確かめてある）。
//
// 学び方（表で覚える Q 学習 ＋ Go-Explore ＋ 選択肢（options）。重みを学ぶ神経網や言語モデルは使わない）:
//   状態   立っている場所・着地の勢いが残っているか・動いた仕掛け
//   行動   選択肢 1 つ = 何 tick にもわたる操作のまとまり（Sutton ら 1999 の options）:
//            跳ぶ   見えている場所へ（狙いのずらし × 助走 0/3/6・端で跳ぶ・勢いのまま跳ぶ・少し歩く）
//            歩く   同じ高さでつながった場所へ、マス目の道をたどって歩く（壁をよける）
//   報酬   新しい場所 +1 / 新しく仕掛けが動いた +1 / 落下 −1（おしまい）/ 目標 +10（おしまい）/ 1 手 −0.05
//          ＋ 推定した目標への近さ（potential-based shaping。最適な方策は変わらない — Ng ら 1999）
//   探索   Go-Explore（Ecoffet ら 2021）: たどり着いた状態とそこまでの手を覚え、遠くまで来た状態ほど選んで戻ってから探す
import { readMap } from './map.js';
import { optionsFor, runOption, startEpisode } from './options.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const DEFAULTS = {
  alpha: 0.3, alphaMin: 0.05, gamma: 0.95, stepCost: 0.05, init: 1.0, reach: 7, maxSteps: 40,
  offsets: [-12, 0, 12], runups: [0, 3, 6], explore: 'go', goal: 'infer', cell: 0.5,
  momentum: false, // true: 勢いの跳躍（角から斜めに走って早めに跳び、足場の上でもう一度跳ぶ）の選択肢を足す（planner は true）
  avoid: false, // true: 歩く道でほかのスイッチ・罠を踏まない（planner は true。方策の options に残るので、実機でも同じ道を選ぶ）
};

const FORBIDDEN = -1e9; // 使わない手の Q
/**
 * @param {object} o
 *   course   コースの JSON（world.blocks・spawn・yaw・triggers）
 *   seed     乱数の種
 *   options  DEFAULTS の上書き
 *   state    書き出した学習（toJSON）から続ける
 */
export function createLearner({ course, seed = 1, options = {}, state = null } = {}) {
  const W = course.world ?? course;
  const opt = { ...DEFAULTS, ...options };
  const rnd = mulberry32(seed);
  const Q = new Map(state?.q ? Object.entries(state.q).map(([k, v]) => [k, Float64Array.from(v)]) : []);
  const visits = new Map();
  const counts = new Map(); // (状態, 手) → 試した回数
  // 実機で測っていない操作になった手（状態 → 手の番号）。覚えた方策に入れない
  const forbidden = new Map(state?.forbidden ? Object.entries(state.forbidden).map(([k, v]) => [k, new Set(v)]) : []);
  const archive = new Map(state?.archive ? Object.entries(state.archive) : []);
  const maps = new Map(); // 仕掛けのビット → 読んだコース
  const actionCache = new Map();

  const mapFor = (world) => {
    let m = maps.get(world.mask);
    if (!m) { m = readMap(world.blocks, { spawn: W.spawn }); maps.set(world.mask, m); }
    return m;
  };
  const map0 = readMap(W.blocks, { spawn: W.spawn });
  // 目標: 既定は推定（ヒントなし）。--goal given のときだけコースに書かれた目標を使う
  // 勝ちの合図（world.triggers の win）があるマップでは、目標は推定しない: 合図が出た場所を経験から覚える
  const hasWinSignal = (W.triggers ?? []).some((t) => t.win);
  let goalKey = hasWinSignal ? (state?.goalKey ?? null) : (map0.goal?.key ?? null);
  let goalReason = hasWinSignal ? (goalKey ? '勝ちの合図が出た場所（経験から覚えた）' : 'まだ分からない（勝ちの合図が出たら、その場所を覚える）') : map0.reason;
  if (opt.goal === 'given' && course.goal?.reach?.standOn) {
    const [gx, gy, gz] = course.goal.reach.standOn;
    const gt = map0.tops.find((t) => t.x === gx && t.y === gy && t.z === gz);
    const r = map0.regionAt({ x: gx + 0.5, y: gt ? gt.top : gy + 1, z: gz + 0.5, onGround: true });
    if (r) { goalKey = r.key; goalReason = 'コースに書かれた目標'; }
  }
  const goalIn = (m) => (goalKey ? m.regions.find((r) => r.key === goalKey) ?? null : null);

  /** 状態 s（場所・仕掛け）で選べる選択肢の一覧（場所と仕掛けが同じなら、いつも同じ並び） */
  function actionsFor(m, region, mask) {
    const ck = `${region.key}|${mask}`;
    if (actionCache.has(ck)) return actionCache.get(ck);
    const out = optionsFor(m, region, opt, opt.avoid ? { triggers: W.triggers, mask } : {});
    actionCache.set(ck, out);
    return out;
  }

  // 状態の名前: 場所・（場所の中の）どのあたりか・勢い・仕掛け。どのあたりかは opt.cell ブロックの升目（0 なら入れない）。
  // 実機だけで学んでいたときは升目を入れると遅すぎたが、サンドボックスでは何千回も走れるので、細かく見分けられる
  const stateKey = (region, p, moving, mask) => {
    const c = opt.cell ? `${Math.floor(p.x / opt.cell)},${Math.floor(p.z / opt.cell)}` : '';
    return `${region.key}|${c}|${moving ? 'm' : 's'}|${mask}`;
  };
  const remember = (s, pathTo, depth) => {
    const cur = archive.get(s);
    if (!cur || depth > cur.depth || (depth === cur.depth && pathTo.length < cur.path.length)) archive.set(s, { path: pathTo, depth, picks: cur?.picks ?? 0 });
  };
  const pickFromArchive = () => {
    if (!archive.size || rnd() < 0.2) return null; // ときどきは最初から
    const items = [...archive.values()];
    const maxDepth = Math.max(...items.map((x) => x.depth));
    const w = items.map((x) => (1 + x.depth) / (1 + maxDepth) / Math.sqrt(x.picks + 1));
    let r = rnd() * w.reduce((m, x) => m + x, 0);
    for (let k = 0; k < items.length; k++) { r -= w[k]; if (r <= 0) { items[k].picks++; return items[k].path; } }
    return items.at(-1).path;
  };

  /** 1 回走る。yield n = n tick 進める。戻り値は結果 */
  function* episode(io, { greedy = false, choose = null } = {}) {
    const hungerBefore = yield* startEpisode(io, W);
    let world = io.world(); let m = mapFor(world);
    const visited = new Set(); const masks = new Set([world.mask]);
    let region = m.regionAt(io.me());
    if (region) visited.add(region.key);
    let total = 0; const trace = []; let outcome = 'steps';
    let moving = false;
    const replay = !greedy && opt.explore === 'go' ? pickFromArchive() : null;
    const pathSoFar = [];
    for (let step = 0; step < opt.maxSteps; step++) {
      if (!region) break;
      const s = stateKey(region, io.me(), moving, world.mask);
      const acts = actionsFor(m, region, world.mask);
      if (!acts.length) { outcome = 'stuck'; break; }
      if (!Q.has(s) || Q.get(s).length !== acts.length) Q.set(s, new Float64Array(acts.length).fill(opt.init));
      const qs = Q.get(s);
      for (const k of forbidden.get(s) ?? []) qs[k] = FORBIDDEN;
      const n = visits.get(s) ?? 0; visits.set(s, n + 1);
      const eps = greedy ? 0 : Math.max(0.05, 0.5 * Math.pow(0.97, n));
      // choose: 'yield' なら、外（tools/sim/gym.mjs など）に手を決めてもらう: yield { decide } に次の next(手) で答える
      let a = choose === 'yield' ? yield { decide: { step, s, acts, q: [...qs], region: region.key, me: io.me(), world: { mask: world.mask, won: world.won }, prevReward: trace.at(-1)?.reward ?? 0 } } : choose ? choose(step, s, acts, qs) : undefined;
      if (a === null) { outcome = 'stopped'; break; } // 外から止めた
      if (a !== undefined) { /* 外から決めた手（調べもの・テープの再生） */ }
      else if (replay && step < replay.length && replay[step].s === s && replay[step].a < qs.length) a = replay[step].a;
      else if (!greedy && rnd() < (replay && step >= replay.length ? Math.max(eps, 0.5) : eps)) { const ok = [...qs.keys()].filter((k) => qs[k] !== FORBIDDEN); a = ok.length ? ok[Math.floor(rnd() * ok.length)] : 0; }
      else { let best = -Infinity; for (let k = 0; k < qs.length; k++) if (qs[k] > best || (qs[k] === best && !greedy && rnd() < 0.5)) { best = qs[k]; a = k; } }
      const act = acts[a];
      const target = m.regions.find((r) => r.key === act.target);
      const before = io.me();
      trace.push({ step, s, a, act, from: { x: before.x, y: before.y, z: before.z } });
      pathSoFar.push({ s, a });
      // 実行しながら、勝ちの合図が出たらすぐやめる（実機では合図が数 tick 遅れて届く。届いた所で止まれば、どちらも同じ結果）
      const unmeasured0 = io.unmeasured?.() ?? 0;
      const res = yield* runOption(io, { m, region, act, target, moving, hasWinSignal, triggers: opt.avoid ? W.triggers : null });
      const fell = res.fell; moving = res.moving;
      // 実機で測っていない操作の組み合わせが出た（サンドボックスが申告した）: この手はこの状態では使わない。この回はここまで
      // （学んだ方策が、測って一致を確かめた操作だけでできているようにする）
      if ((io.unmeasured?.() ?? 0) > unmeasured0) {
        if (!forbidden.has(s)) forbidden.set(s, new Set());
        forbidden.get(s).add(a); qs[a] = FORBIDDEN;
        outcome = 'unmeasured'; break;
      }
      world = io.world(); m = mapFor(world);
      const me = io.me();
      const next = fell ? null : m.regionAt(me);
      let reward = -opt.stepCost; let done = false;
      const goal = goalIn(m);
      if (goal) {
        const gd = (p) => Math.min(...goal.tops.map((t) => Math.hypot(t.x + 0.5 - p.x, t.z + 0.5 - p.z)));
        reward += opt.gamma * (fell ? 0 : -gd(me) * 0.1) - (-gd(before) * 0.1);
      }
      if (!masks.has(world.mask)) { masks.add(world.mask); reward += 1; }
      if (fell) { reward += -1; done = true; outcome = 'fell'; }
      else if (hasWinSignal ? world.won : (next && goalKey && next.key === goalKey)) {
        reward += 10; done = true; outcome = 'goal';
        if (hasWinSignal && next && goalKey !== next.key) { goalKey = next.key; goalReason = '勝ちの合図が出た場所（経験から覚えた）'; }
      }
      else if (!next) { done = true; outcome = 'lost'; } // 場所の外（壁の途中など）に止まった
      else if (!visited.has(next.key)) { reward += 1; visited.add(next.key); }
      const s2 = next ? stateKey(next, me, moving, world.mask) : 'end';
      if (!greedy) {
        const q2 = Q.get(s2);
        const target2 = done ? reward : reward + opt.gamma * (q2 ? Math.max(...q2) : opt.init);
        // 歩幅: その手を試した回数の逆数（標本平均。決まった動きの世界ではこれで収まる）。下限 alphaMin
        const nk = `${s}#${a}`; const nsa = (counts.get(nk) ?? 0) + 1; counts.set(nk, nsa);
        const lr = opt.alpha === 'avg' ? Math.max(opt.alphaMin, 1 / nsa) : Math.max(opt.alphaMin, Math.min(opt.alpha, 1 / nsa));
        qs[a] += lr * (target2 - qs[a]);
      }
      total += reward;
      trace.at(-1).reward = reward; trace.at(-1).done = done; trace.at(-1).outcome = done ? outcome : null;
      region = next;
      if (!greedy && next && !done) remember(s2, pathSoFar.slice(), visited.size + 2 * (masks.size - 1));
      if (done) break;
    }
    io.stop();
    return { total, outcome, reached: visited.size, masks: masks.size, trace, hungerBefore };
  }

  return {
    options: opt,
    get goalKey() { return goalKey; }, get goalReason() { return goalReason; }, map: map0,
    // 先を読む頭（planner.js）が同じ見え方・同じ選択肢を使うための口
    parts: { mapFor, actionsFor, stateKey, hasWinSignal, get goalKey() { return goalKey; } },
    episode,
    get states() { return Q.size; },
    get archiveSize() { return archive.size; },
    toJSON: () => ({
      options: opt, goalKey, goalReason,
      q: Object.fromEntries([...Q.entries()].map(([k, v]) => [k, [...v].map((x) => Number(x.toFixed(5)))])),
      archive: Object.fromEntries(archive.entries()),
      forbidden: Object.fromEntries([...forbidden.entries()].map(([k, v]) => [k, [...v]])),
    }),
  };
}

/**
 * サンドボックスで学ぶ（同期・速い）。ときどき「覚えたとおりに走る」試験をして、いちばん良かった覚え方を取っておく
 * （学習の途中で成績が上下しても、クリアできた方策を失わない）。試験に patience 回続けて通ったら止める。
 */
export function trainSync(learner, env, { episodes = 20000, evalEvery = 250, patience = 3, log = null } = {}) {
  const curve = []; let best = null; let streak = 0; let goals = 0; let firstGoal = null;
  const t0 = Date.now();
  for (let e = 1; e <= episodes; e++) {
    const r = runSync(learner.episode(env.io), env.tick);
    if (r.outcome === 'goal') { goals++; firstGoal ??= e; }
    if (e % evalEvery === 0 || e === episodes) {
      // 試験は、学んでいる原点すべてで通ること（env.origins が 2 つ以上なら、どの原点でも同じ手でクリアできるか）
      const n = env.origins?.length ?? 1;
      const exams = [];
      for (let k = 0; k < n; k++) { env.useOrigin?.(k); exams.push(runSync(learner.episode(env.io, { greedy: true }), env.tick)); }
      const ex = exams.find((x) => x.outcome !== 'goal') ?? exams[0];
      const row = { episode: e, goals, examOutcome: ex.outcome, examReward: Number(ex.total.toFixed(3)), states: learner.states, ms: Date.now() - t0 };
      curve.push(row);
      if (log) log(row);
      if (ex.outcome === 'goal' && (!best || ex.total >= best.exam.total)) best = { episode: e, exam: ex, state: learner.toJSON() };
      streak = ex.outcome === 'goal' ? streak + 1 : 0;
      if (patience && streak >= patience) break;
    }
  }
  return { curve, best, goals, firstGoal, ms: Date.now() - t0, episodes: curve.at(-1)?.episode ?? 0 };
}

/** ジェネレータを同期で回す（サンドボックス用）。tick(n) は n tick 進める関数 */
export function runSync(gen, tick) {
  let r = gen.next();
  while (!r.done) { if (typeof r.value === 'number') tick(r.value); r = gen.next(); }
  return r.value;
}

/** ジェネレータを非同期で回す（実機用）。tick(n) は Promise を返す */
export async function runAsync(gen, tick) {
  let r = gen.next();
  while (!r.done) { await tick(r.value); r = gen.next(); }
  return r.value;
}
