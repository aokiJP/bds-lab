// テープを 1 本流して、何が起きたかを返す（L3）。ゲームを知らない。
//
// ワールドの約束（これを満たせば何でも載る — Minecraft でも、ブラウザのゲームでも）:
//
//   world.reset()            最初の状態に戻す
//   world.step(input)        1 tick 進める。input はその tick に押している入力（テープを展開したもの）
//   world.observe()          目標を見るのに要るものを返す（JSON にできる値）
//   world.snapshot() / world.restore(s)   状態を保存・復元する（探索で使う）
//   world.issues?()          再現していないものに触れたら [{ id, why }]。1 つでもあれば結果は inconclusive
//   world.errors?()          ゲームの中で起きた例外 [{ tick, message, stack }]
//   world.predicates?        目標で使える述語 { 名前: (obs, arg) => boolean }
//   world.distances?         その述語の「遠さ」 { 名前: (obs, arg) => number }
//   world.fingerprint?()     同じ状態なら同じ文字列（探索で枝を捨てるのに使う）
import { expandTape, tapeLength, validateTape } from './tape.js';
import { judge, normalizeGoal } from './goal.js';

/**
 * @param {object} world
 * @param {object} tape  tape@1
 * @param {object} [opts]
 *   goal          目標（goal.js）
 *   trace         true なら毎 tick の観測を残す（既定 true）
 *   stopOnResult  目標が決まったらそこで止める（既定 true）
 *   breakpoints   [{ when: 条件, label }]  真になった最初の tick を記録する（RPG のデバッグ用）
 *   watch         ['player.x', …]  毎 tick 残す値を絞る（trace が大きいとき）
 */
export function replay(world, tape, opts = {}) {
  validateTape(tape);
  const goal = normalizeGoal(opts.goal);
  const frames = expandTape(tape);
  const n = Math.max(tapeLength(tape), goal?.deadline ?? 0);
  const keepTrace = opts.trace !== false;
  const predicates = world.predicates ?? {};
  const breakpoints = (opts.breakpoints ?? []).map((b) => ({ ...b, hit: null }));
  const trace = [];
  const pick = (o) => {
    if (!opts.watch) return o;
    const out = { tick: o.tick };
    for (const p of opts.watch) out[p] = p.split('.').reduce((c, k) => (c == null ? c : c[k]), o);
    return out;
  };
  world.reset();
  let result = null;
  let at = null;
  // t = それまでに進めた tick の数。観測 t は「t 回 step したあと」
  const check = (t) => {
    const obs = world.observe();
    if (keepTrace) trace.push(pick(obs));
    for (const b of breakpoints) {
      if (b.hit === null && judge({ reach: b.when }, obs, t, predicates) === 'cleared') b.hit = { tick: t, observe: obs };
    }
    const r = judge(goal, obs, t, predicates);
    if (r && result === null) { result = r; at = t; }
    return obs;
  };
  let last = check(0);
  for (let t = 0; t < n; t++) {
    if (result && opts.stopOnResult !== false) break;
    const errsBefore = world.errors?.().length ?? 0;
    world.step(frames[t] ?? frames[frames.length - 1] ?? {});
    last = check(t + 1);
    if (opts.stopOnError && (world.errors?.().length ?? 0) > errsBefore) break;
  }
  const issues = world.issues?.() ?? [];
  const errors = world.errors?.() ?? [];
  let verdict;
  if (errors.length && !opts.allowErrors) verdict = 'error';
  else if (issues.length) verdict = 'inconclusive';
  else if (!goal) verdict = 'done';
  else verdict = result ?? 'timeout';
  return {
    verdict,
    goal: goal ? { status: result ?? 'timeout', tick: at } : null,
    ticks: world.tick ?? n,
    final: last,
    trace,
    breakpoints: breakpoints.map((b) => ({ label: b.label ?? JSON.stringify(b.when), tick: b.hit?.tick ?? null, observe: b.hit?.observe ?? null })),
    issues,
    errors,
  };
}

/**
 * 同じテープを 2 回流して、毎 tick の観測が完全に同じかを見る（決定論の確認。tape 関門）。
 * @returns {{ deterministic: boolean, firstDifference: object|null, ticks: number }}
 */
export function checkDeterminism(world, tape, { runs = 2, watch } = {}) {
  const first = replay(world, tape, { watch, stopOnResult: false });
  for (let i = 1; i < runs; i++) {
    const again = replay(world, tape, { watch, stopOnResult: false });
    const d = firstDifference(first.trace, again.trace);
    if (d) return { deterministic: false, firstDifference: d, ticks: first.trace.length };
  }
  return { deterministic: true, firstDifference: null, ticks: first.trace.length };
}

/**
 * 途中で保存して戻しても、続きが同じになるかを見る（snapshot/restore の確認）。
 */
export function checkSnapshot(world, tape, { at } = {}) {
  const frames = expandTape(tape);
  const k = at ?? Math.floor(frames.length / 2);
  world.reset();
  for (let t = 0; t < k; t++) world.step(frames[t]);
  const snap = world.snapshot();
  const straight = [];
  for (let t = k; t < frames.length; t++) { world.step(frames[t]); straight.push(world.observe()); }
  // わざと別の入力で荒らしてから戻す
  for (let t = 0; t < 5; t++) world.step({});
  world.restore(snap);
  const again = [];
  for (let t = k; t < frames.length; t++) { world.step(frames[t]); again.push(world.observe()); }
  const d = firstDifference(straight, again);
  return { ok: !d, at: k, firstDifference: d };
}

/** 2 本の観測の列で、最初に違う tick と、違う欄を返す（同じなら null） */
export function firstDifference(a, b, { tolerance } = {}) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i >= a.length || i >= b.length) return { index: i, fields: [{ path: '(長さ)', a: a.length, b: b.length }] };
    const fields = diffValues(a[i], b[i], '', tolerance);
    if (fields.length) return { index: i, tick: a[i]?.tick ?? i, fields };
  }
  return null;
}

/** 値の違う場所の一覧。tolerance は (path, a, b) => boolean で「同じとみなす」を決められる */
export function diffValues(a, b, path = '', tolerance) {
  if (tolerance && typeof a === 'number' && typeof b === 'number' && tolerance(path, a, b)) return [];
  if (Object.is(a, b)) return [];
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return [{ path: path || '(値)', a, b }];
  if (Array.isArray(a) !== Array.isArray(b)) return [{ path: path || '(値)', a, b }];
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out.push(...diffValues(a[k], b[k], path ? `${path}.${k}` : k, tolerance));
  }
  return out;
}
