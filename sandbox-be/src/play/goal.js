// 目標（クリアの条件）と、そこまでの「近さ」。ゲームを知らない層（L4）。
//
// 観測（world.observe() の返り値）に対して条件を評価する。条件は JSON で書ける:
//
//   { "path": "player.y", "gte": 3 }                   数の比較（eq ne gt gte lt lte / in / contains / exists）
//   { "region": { "path": "player", "min": { "x": 0, "z": 10 }, "max": { "x": 3, "z": 12 } } }
//   { "all": [ … ] }  { "any": [ … ] }  { "not": { … } }
//   { "<述語名>": 引数 }                                ワールドが用意した述語（例: voxel の standOn）
//
// 目標の全体:
//   {
//     "reach":    条件,       これが真になった tick でクリア
//     "avoid":    条件,       一度でも真になったら失敗（落下死・溶岩・HP 0 …）
//     "deadline": 1200,       この tick までに reach しなければ時間切れ
//     "stuck":    条件        真になったら「詰み」（もう reach できない状態）として打ち切る
//     "toward":   条件        探索の道しるべ（reach が真偽しか言えないとき、近さを測るのに使う。判定には使わない）
//   }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** "a.b.0.c" で深い値を引く */
export function getPath(obj, path) {
  if (path === undefined || path === null || path === '') return obj;
  let cur = obj;
  for (const k of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

const CMP = {
  eq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  ne: (a, b) => JSON.stringify(a) !== JSON.stringify(b),
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  in: (a, b) => Array.isArray(b) && b.some((x) => JSON.stringify(x) === JSON.stringify(a)),
  contains: (a, b) => (Array.isArray(a) ? a.some((x) => JSON.stringify(x) === JSON.stringify(b)) : typeof a === 'string' && a.includes(b)),
  exists: (a, b) => (a !== undefined && a !== null) === Boolean(b),
};

/**
 * 条件を評価する。
 * @param {object} cond
 * @param {object} obs  観測
 * @param {object} [predicates]  ワールドが用意した述語 { 名前: (obs, 引数) => boolean }
 */
export function evaluate(cond, obs, predicates = {}) {
  if (cond === true || cond === undefined || cond === null) return cond !== null && cond !== undefined;
  if (cond === false) return false;
  if (typeof cond === 'function') return Boolean(cond(obs));
  if (!isObj(cond)) throw new Error(`条件の形が読めません: ${JSON.stringify(cond)}`);
  if (cond.all) return cond.all.every((c) => evaluate(c, obs, predicates));
  if (cond.any) return cond.any.some((c) => evaluate(c, obs, predicates));
  if (cond.not) return !evaluate(cond.not, obs, predicates);
  if (cond.region) {
    const r = cond.region;
    const p = getPath(obs, r.path);
    if (!isObj(p)) return false;
    return Object.keys({ ...r.min, ...r.max }).every((k) => (r.min?.[k] === undefined || p[k] >= r.min[k]) && (r.max?.[k] === undefined || p[k] <= r.max[k]));
  }
  if ('path' in cond) {
    const v = getPath(obs, cond.path);
    const ops = Object.keys(cond).filter((k) => k in CMP);
    if (!ops.length) return Boolean(v);
    return ops.every((op) => CMP[op](v, cond[op]));
  }
  const names = Object.keys(cond);
  if (names.length === 1 && typeof predicates[names[0]] === 'function') return Boolean(predicates[names[0]](obs, cond[names[0]]));
  throw new Error(`知らない条件です: ${names.join(', ')}${Object.keys(predicates).length ? `（このワールドの述語: ${Object.keys(predicates).join(', ')}）` : ''}`);
}

/**
 * 条件までの「遠さ」（0 なら満たしている）。探索の向きづけに使う。分からなければ 0 / 1。
 * ワールドの述語に distance があればそれを使う（predicates.distance[名前]）。
 */
export function distance(cond, obs, predicates = {}, distances = {}) {
  if (!isObj(cond)) return evaluate(cond, obs, predicates) ? 0 : 1;
  if (cond.all) return cond.all.reduce((n, c) => n + distance(c, obs, predicates, distances), 0);
  if (cond.any) return Math.min(...cond.any.map((c) => distance(c, obs, predicates, distances)));
  if (cond.not) return evaluate(cond, obs, predicates) ? 0 : 1;
  if (cond.region) {
    const r = cond.region;
    const p = getPath(obs, r.path);
    if (!isObj(p)) return 1e9;
    let d2 = 0;
    for (const k of Object.keys({ ...r.min, ...r.max })) {
      const v = p[k];
      if (r.min?.[k] !== undefined && v < r.min[k]) d2 += (r.min[k] - v) ** 2;
      if (r.max?.[k] !== undefined && v > r.max[k]) d2 += (v - r.max[k]) ** 2;
    }
    return Math.sqrt(d2);
  }
  if ('path' in cond) {
    const v = getPath(obs, cond.path);
    if (typeof v !== 'number') return evaluate(cond, obs, predicates) ? 0 : 1;
    let d = 0;
    if (cond.gte !== undefined && v < cond.gte) d += cond.gte - v;
    if (cond.gt !== undefined && v <= cond.gt) d += cond.gt - v + 1e-9;
    if (cond.lte !== undefined && v > cond.lte) d += v - cond.lte;
    if (cond.lt !== undefined && v >= cond.lt) d += v - cond.lt + 1e-9;
    if (cond.eq !== undefined && typeof cond.eq === 'number') d += Math.abs(v - cond.eq);
    return d;
  }
  const names = Object.keys(cond);
  if (names.length === 1 && typeof distances[names[0]] === 'function') return distances[names[0]](obs, cond[names[0]]);
  return evaluate(cond, obs, predicates) ? 0 : 1;
}

/** 目標を正規化する（reach だけ渡されたら { reach } にする） */
export function normalizeGoal(goal) {
  if (!goal) return null;
  if (isObj(goal) && ('reach' in goal || 'avoid' in goal || 'deadline' in goal || 'stuck' in goal || 'toward' in goal)) return goal;
  return { reach: goal };
}

/**
 * その時点の観測で、目標がどうなっているか。
 * @returns {'cleared'|'failed'|'stuck'|'timeout'|null}
 */
export function judge(goal, obs, tick, predicates = {}) {
  if (!goal) return null;
  if (goal.avoid && evaluate(goal.avoid, obs, predicates)) return 'failed';
  if (goal.reach && evaluate(goal.reach, obs, predicates)) return 'cleared';
  if (goal.stuck && evaluate(goal.stuck, obs, predicates)) return 'stuck';
  if (goal.deadline !== undefined && tick >= goal.deadline) return 'timeout';
  return null;
}
