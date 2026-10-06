// 探索（L5）。目標に届くテープを自分で見つける／詰みを見つける。ゲームを知らない。
//
//   solve(world, { goal, actions })     最良優先の探索。届くテープを 1 本返す（アスレチック向き）
//   explore(world, { goal, actions })   届く状態を全部たどる。クリアの可否・詰み（戻れない地点）を返す（RPG 向き）
//
// 行動（actions）は「何 tick 何を押すか」の並び:
//   { input: { move: { x: 0, z: 1 }, sprint: true }, hold: 4 }   同じ入力を 4 tick
//   { frames: [{ key: 'ArrowUp' }, {}] }                        押して離す、など tick ごとに違うもの
// ワールドが world.actions(obs, goal) を持っていれば、その場で候補を作らせることもできる。
import { compressTape, TAPE_FORMAT } from './tape.js';
import { distance, evaluate, judge, normalizeGoal } from './goal.js';

/**
 * 行動を 1 tick ずつ流す。until があれば「条件が真になるまで（min 〜 max tick）」押し続ける。
 *   { input: {…}, until: { path: 'player.onGround', eq: true }, min: 2, max: 60 }   跳んで、着地するまで前を押す
 * onStep(frame) → その tick の結果（'stop' を返せば打ち切り）
 */
function runAction(world, a, predicates, onStep) {
  if (a.frames) { for (const f of a.frames) { world.step(f); if (onStep(f) === 'stop') return; } return; }
  const input = a.input ?? {};
  if (!a.until) { for (let i = 0; i < (a.hold ?? 1); i++) { world.step(input); if (onStep(input) === 'stop') return; } return; }
  const max = a.max ?? 100;
  const after = a.then ?? input; // 1 tick 目のあと（跳ぶのは 1 回だけ、など）
  for (let i = 0; i < max; i++) {
    const f = i === 0 ? input : after;
    world.step(f);
    if (onStep(f) === 'stop') return;
    if (i + 1 >= (a.min ?? 1) && evaluate(a.until, world.observe(), predicates)) return;
  }
}

/** 小さな二分ヒープ（score が小さいほど先） */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].score <= a[i].score) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].score < a[m].score) m = l;
        if (r < a.length && a[r].score < a[m].score) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  /** 悪いほうから捨てて n 件にする */
  trim(n) { if (this.a.length > n * 2) { this.a.sort((x, y) => x.score - y.score); this.a.length = n; } }
}

function pathFrames(node) {
  const chunks = [];
  for (let n = node; n && n.parent; n = n.parent) chunks.push(n.frames);
  return chunks.reverse().flat();
}

function defaultFingerprint(world) {
  if (world.fingerprint) return () => world.fingerprint();
  return () => JSON.stringify(world.observe());
}

/**
 * 最良優先の探索。目標までの「遠さ」が小さい状態から広げる。
 * @param {object} world  run.js の約束を満たすもの
 * @param {object} opts
 *   goal        目標（goal.js）。deadline を入れておくと、その tick を超える枝は捨てる
 *   actions     行動の並び（または (obs) => 行動の並び）
 *   budget      進める tick の総数の上限（既定 400000）
 *   frontier    覚えておく候補の上限（既定 5000）
 *   timeWeight  「早く着く」をどれだけ重んじるか（既定 0.02 / tick）
 *   fingerprint 状態の指紋（既定 world.fingerprint）
 * @returns {{ status: 'cleared'|'exhausted'|'budget', tape?, tick?, best, expanded, visited }}
 */
export function solve(world, opts) {
  const goal = normalizeGoal(opts.goal);
  if (!goal?.reach) throw new Error('solve には goal.reach が要ります');
  const predicates = world.predicates ?? {};
  const distances = world.distances ?? {};
  const budget = opts.budget ?? 400000;
  const cap = opts.frontier ?? 5000;
  const tw = opts.timeWeight ?? 0.02;
  const fp = opts.fingerprint ?? defaultFingerprint(world);
  const actionsAt = typeof opts.actions === 'function' ? opts.actions : (world.actions && !opts.actions ? (o) => world.actions(o, goal) : () => opts.actions);
  const deadline = goal.deadline ?? Infinity;
  const guide = goal.toward ?? goal.reach; // 「どちらへ行けば近いか」。reach が真偽しか言えないときは toward で道しるべを渡す
  const bugs = [];

  world.reset();
  const rootObs = world.observe();
  const root = { parent: null, frames: [], tick: 0, snap: world.snapshot(), obs: rootObs, dist: distance(guide, rootObs, predicates, distances) };
  root.score = root.dist;
  if (judge(goal, rootObs, 0, predicates) === 'cleared') return { status: 'cleared', tape: compressTape([]), tick: 0, expanded: 0, visited: 1, best: root };
  const open = new Heap();
  open.push(root);
  const seen = new Set([fp()]);
  let best = root;
  let steps = 0;
  let expanded = 0;
  const deaths = [];

  while (open.size && steps < budget) {
    const node = open.pop();
    expanded++;
    for (const a of actionsAt(node.obs, node) ?? []) {
      world.restore(node.snap);
      const e0 = world.errors?.().length ?? 0;
      let status = null;
      let tick = node.tick;
      let obs = node.obs;
      const taken = [];
      runAction(world, a, predicates, (f) => {
        steps++;
        tick++;
        taken.push(f);
        obs = world.observe();
        status = judge(goal, obs, tick, predicates);
        if (status) return 'stop';
        if (tick >= deadline) { status = 'timeout'; return 'stop'; }
        return null;
      });
      const errs = world.errors?.() ?? [];
      if (errs.length > e0 && bugs.length < 20) bugs.push({ tick, tape: compressTape(pathFrames({ parent: node, frames: taken })), errors: errs.slice(e0) });
      if (status === 'cleared') {
        const child = { parent: node, frames: taken, tick };
        const frs = pathFrames(child);
        return { status: 'cleared', tape: compressTape(frs, { format: TAPE_FORMAT }), tick, expanded, visited: seen.size, steps, bugs, best: { tick, obs } };
      }
      if (status === 'failed' || status === 'stuck') { if (deaths.length < 20) deaths.push({ tick, status, obs }); continue; }
      if (status === 'timeout') continue;
      const key = fp();
      if (seen.has(key)) continue;
      seen.add(key);
      const dist = distance(guide, obs, predicates, distances);
      const child = { parent: node, frames: taken, tick, snap: world.snapshot(), obs, dist, score: dist + tw * tick };
      if (dist < best.dist || (dist === best.dist && tick < best.tick)) best = child;
      open.push(child);
    }
    open.trim(cap);
  }
  const bestFrames = best.parent ? pathFrames(best) : [];
  return {
    status: open.size ? 'budget' : 'exhausted',
    expanded,
    visited: seen.size,
    steps,
    deaths,
    bugs,
    best: { tick: best.tick, dist: best.dist, obs: best.obs, tape: compressTape(bestFrames) },
  };
}

/**
 * 届く状態を全部たどる（幅優先）。状態が有限のゲーム（RPG・パズル）向け。
 *
 * 返すもの:
 *   clearable   目標に届く状態があったか
 *   shortest    いちばん短いクリアのテープ
 *   softlocks   「ここに来たらもう目標に届かない」状態のうち、入口（直前はまだ届いた）になっているもの。
 *               入口までのテープつき。RPG の「この操作をしたら詰む」がこれ
 *   deaths      avoid に触れた（ゲームオーバー）状態の例
 *   complete    全部たどり切ったか（false なら、詰みの判定は「たどった範囲では」）
 */
export function explore(world, opts) {
  const goal = normalizeGoal(opts.goal);
  const predicates = world.predicates ?? {};
  const maxStates = opts.maxStates ?? 200000;
  const maxDepth = opts.maxDepth ?? Infinity;
  const fp = opts.fingerprint ?? defaultFingerprint(world);
  const actionsAt = typeof opts.actions === 'function' ? opts.actions : (world.actions && !opts.actions ? (o) => world.actions(o, goal) : () => opts.actions);

  world.reset();
  const rootKey = fp();
  const nodes = new Map(); // key → { key, parent, frames, depth, tick, status, obs, out: Set }
  const root = { key: rootKey, parent: null, frames: [], depth: 0, tick: 0, status: judge(goal, world.observe(), 0, predicates), obs: world.observe(), out: new Set(), snap: world.snapshot() };
  nodes.set(rootKey, root);
  const queue = [root];
  const bugs = new Map(); // 例外の中身 → 最初に起こしたテープ
  const tapeOfPath = (n, extra) => { const fr = [...extra]; for (let x = n; x && x.parent; x = x.parent) fr.unshift(...x.frames); return compressTape(fr); };
  let truncated = false;
  let head = 0;
  while (head < queue.length) {
    const node = queue[head++];
    if (node.status || node.depth >= maxDepth) { if (!node.status) truncated = true; continue; }
    for (const a of actionsAt(node.obs, node) ?? []) {
      world.restore(node.snap);
      const e0 = world.errors?.().length ?? 0;
      let tick = node.tick;
      let status = null;
      const taken = [];
      runAction(world, a, predicates, (f) => {
        tick++;
        taken.push(f);
        status = judge(goal, world.observe(), tick, predicates);
        return status ? 'stop' : null;
      });
      const errs = world.errors?.() ?? [];
      if (errs.length > e0) {
        const sig = errs.slice(e0).map((e) => `${e.name}: ${e.message}`).join(' / ');
        if (!bugs.has(sig)) bugs.set(sig, { tick, tape: tapeOfPath(node, taken), errors: errs.slice(e0) });
      }
      const key = fp();
      node.out.add(key);
      if (nodes.has(key)) continue;
      if (nodes.size >= maxStates) { truncated = true; continue; }
      const obs = world.observe();
      const child = { key, parent: node, frames: taken, depth: node.depth + 1, tick, status, obs, out: new Set(), snap: status ? null : world.snapshot() };
      nodes.set(key, child);
      queue.push(child);
    }
    node.snap = null; // 広げ終わったら要らない（メモリを空ける）
  }

  // 目標に届く状態（逆向きにたどる）
  const incoming = new Map();
  for (const n of nodes.values()) for (const k of n.out) { if (!incoming.has(k)) incoming.set(k, []); incoming.get(k).push(n.key); }
  const canWin = new Set();
  const stack = [...nodes.values()].filter((n) => n.status === 'cleared').map((n) => n.key);
  for (const k of stack) canWin.add(k);
  while (stack.length) {
    const k = stack.pop();
    for (const p of incoming.get(k) ?? []) if (!canWin.has(p)) { canWin.add(p); stack.push(p); }
  }
  const tapeOf = (n) => { const fr = []; for (let x = n; x && x.parent; x = x.parent) fr.unshift(...x.frames); return compressTape(fr); };
  const cleared = [...nodes.values()].filter((n) => n.status === 'cleared').sort((a, b) => a.tick - b.tick);
  // 詰み: 広げ切った（終わりでも打ち切りでもない）のに、目標に届かない状態。入口 = 親はまだ届いた
  const expandedFully = (n) => !n.status && n.depth < maxDepth;
  const dead = [...nodes.values()].filter((n) => expandedFully(n) && !canWin.has(n.key));
  const entries = dead.filter((n) => n.parent && canWin.has(n.parent.key));
  const uniq = new Map();
  for (const e of entries.sort((a, b) => a.tick - b.tick)) {
    const why = JSON.stringify(e.obs).slice(0, 400);
    if (!uniq.has(why)) uniq.set(why, e);
  }
  return {
    clearable: cleared.length > 0,
    shortest: cleared.length ? { tick: cleared[0].tick, tape: tapeOf(cleared[0]), obs: cleared[0].obs } : null,
    softlocks: [...uniq.values()].slice(0, opts.maxReports ?? 20).map((n) => ({ tick: n.tick, tape: tapeOf(n), obs: n.obs, lastInput: n.frames[0] ?? null })),
    softlockStates: truncated ? null : dead.length,
    deaths: [...nodes.values()].filter((n) => n.status === 'failed').slice(0, 10).map((n) => ({ tick: n.tick, tape: tapeOf(n), obs: n.obs })),
    bugs: [...bugs.values()],
    states: nodes.size,
    complete: !truncated,
    rootCanWin: canWin.has(rootKey),
  };
}
