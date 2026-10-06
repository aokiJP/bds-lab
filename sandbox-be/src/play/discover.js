// 目標を教えられずに、ゲームの「終わり」を自分で見つける（ヒントなし・学習なし）。
//
// 人工知能（学習した重み・言語モデル）は使いません。やっていることは 2 つだけで、どちらも決まった手順です:
//
//   1. 目標なしで広く遊ぶ（Go-Explore と同じ考え方の探索）
//      見たことのある状態を「区画」にまとめて覚えておき、あまり訪れていない区画へ戻って（snapshot/restore）
//      そこから入力を試す。新しい区画に入ったら覚える。これを予算まで繰り返す。
//      区画の分け方は観測から自動で決める（数の欄はウォームアップで見た幅を 12 等分、真偽・文字はそのまま）。
//
//   2. 集めた状態から「終わり」を規則で見つけて、勝ち／負けを見分ける
//      ・入力が効かなくなった状態（どの入力を試しても同じ区画のまま）＝ゲームが終わった
//      ・そのとき、ふだんと違う値になっている欄（例: won が true、dead が true）＝終わりの原因
//      ・そのとき画面・DOM・console・alert に出た文字（「CLEAR!」「クリア」「GAME OVER」…）
//      ・欄の名前（won / clear / goal … と dead / over / lose …）
//      ・どれだけ珍しく、どれだけ深い（遅い）か
//      を点数にして並べる。勝ちの候補の 1 番を「推定した目標」として返す。根拠も全部返す。
//
// Minecraft（voxel）のように「終わり」が画面に出ないワールドは、world.goalCandidates(archive) を持っていれば
// それを使う（voxel は「立てた足場の中で、いちばん珍しいブロック・いちばん遠い足場」を候補にする）。
import { compressTape, expandTape } from './tape.js';
import { solve } from './solve.js';

const WIN_WORDS = /(clear|cleared|win|won|victory|goal|complete|completed|congrat|success|finish|finished|you did it|stage clear|level up|クリア|ゴール|勝|成功|おめでとう|完了|達成)/i;
const LOSE_WORDS = /(game ?over|dead|death|died|die|lose|lost|fail|failed|defeat|killed|ゲームオーバー|死|負け|失敗|やられ)/i;
const IGNORE = new Set(['tick', 'errors']);
const oneLine = (t) => String(t).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 60);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 観測を「欄の道 → 値」の平らな表にする */
export function flatten(obs, prefix = '', out = {}) {
  if (obs === null || typeof obs !== 'object') { out[prefix || '(値)'] = obs; return out; }
  for (const [k, v] of Object.entries(obs)) {
    if (!prefix && IGNORE.has(k)) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') flatten(v, p, out); else out[p] = v;
  }
  return out;
}

/** 区画の分け方を、ウォームアップで見た値の幅から決める */
function makeCellOf(samples, bins) {
  const range = {};
  for (const s of samples) for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const r = (range[k] ??= { min: v, max: v, ints: true });
    r.min = Math.min(r.min, v); r.max = Math.max(r.max, v);
    if (!Number.isInteger(v)) r.ints = false;
  }
  const scale = {};
  for (const [k, r] of Object.entries(range)) {
    const w = r.max - r.min;
    scale[k] = w === 0 ? (r.ints ? 1 : 1e-3) : (r.ints && w <= bins ? 1 : w / bins);
  }
  return (flat) => {
    const parts = [];
    for (const k of Object.keys(flat).sort()) {
      const v = flat[k];
      if (typeof v === 'number') parts.push(`${k}=${Number.isFinite(v) ? Math.floor(v / (scale[k] ?? 1)) : String(v)}`);
      else parts.push(`${k}=${JSON.stringify(v)}`);
    }
    return parts.join('|');
  };
}

/**
 * 目標なしで遊んで、ゲームの終わり（勝ち／負け）を見つける。
 * @param {object} world  run.js の約束を満たすもの（signals() があれば画面の文字も使う）
 * @param {object} [opts]
 *   budget     進める tick の総数（既定 60000）
 *   warmup     区画の分け方を決めるためにでたらめに遊ぶ tick 数（既定 400）
 *   bins       数の欄を何等分するか（既定 12）
 *   seed       探索の乱数の種（既定 1。同じ種なら同じ結果）
 *   actions    行動の候補（無ければ world.actions(obs, null)）
 *   frozenTries  「入力が効かない」と言うのに試す行動の数（既定 6）
 */
export function discover(world, opts = {}) {
  const budget = opts.budget ?? 60000;
  const bins = opts.bins ?? 12;
  const rnd = mulberry32(opts.seed ?? 1);
  const frozenTries = opts.frozenTries ?? 6;
  const actionsAt = opts.actions ? (typeof opts.actions === 'function' ? opts.actions : () => opts.actions) : (o) => world.actions?.(o, null) ?? [{ input: {}, hold: 1 }];
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const signalsNow = () => (world.signals ? world.signals() : []);
  let steps = 0;

  // ---- ウォームアップ: でたらめに遊んで、欄の幅を見る --------------------------------
  world.reset();
  const samples = [flatten(world.observe())];
  const warm = opts.warmup ?? 400;
  while (steps < warm) {
    const a = pick(actionsAt(world.observe()));
    const frames = a.frames ?? Array.from({ length: a.hold ?? 1 }, (_, i) => (i === 0 ? a.input : (a.then ?? a.input)) ?? {});
    for (const f of frames.slice(0, a.until ? 20 : frames.length)) { world.step(f); steps++; samples.push(flatten(world.observe())); }
  }
  const cellOf = opts.cellOf ?? (world.cell ? (flat, obs) => world.cell(obs) : makeCellOf(samples, bins));

  // ---- 本番: 区画を覚えて、あまり訪れていない区画から広げる ----------------------------
  world.reset();
  const archive = new Map();
  // 欄ごとの珍しさ: 「その欄がその値（区画）になった区画の数」。少ないほど珍しい
  const dimCount = new Map();
  const dimsOf = (key) => key.split('|');
  let lastNew = 0;
  const add = (obs, parent, frames, tick, snap, sig) => {
    const flat = flatten(obs);
    const key = cellOf(flat, obs);
    const cur = archive.get(key);
    if (cur && cur.tick <= tick) return { cell: cur, isNew: false };
    const cell = { key, obs, flat, tick, parent, frames, snap, visits: cur?.visits ?? 0, tries: cur?.tries ?? 0, outcomes: cur?.outcomes ?? new Set(), signals: sig, born: archive.size };
    archive.set(key, cell);
    if (!cur) { lastNew = steps; for (const d of dimsOf(key)) dimCount.set(d, (dimCount.get(d) ?? 0) + 1); }
    return { cell, isNew: !cur };
  };
  const rootObs = world.observe();
  add(rootObs, null, [], 0, world.snapshot(), signalsNow());
  const errorsBefore = () => world.errors?.().length ?? 0;
  const bugs = new Map();

  const patience = opts.patience ?? 10000; // これだけ進めても新しい区画が 1 つも増えなければ、たどり切ったとみなす
  while (steps < budget && archive.size && steps - lastNew < patience) {
    // 選び方: 訪れた回数が少ないほど、新しいほど選ばれやすい（重みつき抽選）
    const cells = [...archive.values()].filter((c) => c.snap);
    if (!cells.length) break;
    let total = 0;
    // 重み = 珍しさ（どこかの欄が珍しい値なら高い）× 訪れた回数の少なさ。まだ入力を試し切っていない区画は少し優先
    const w = cells.map((c) => {
      let rare = 0;
      for (const d of dimsOf(c.key)) rare = Math.max(rare, 1 / Math.sqrt(dimCount.get(d) ?? 1));
      const x = (rare + 0.1) / Math.sqrt(c.visits + 1) + (c.tries < frozenTries ? 0.3 : 0);
      total += x;
      return x;
    });
    let r = rnd() * total;
    let cell = cells[cells.length - 1];
    for (let i = 0; i < cells.length; i++) { r -= w[i]; if (r <= 0) { cell = cells[i]; break; } }
    cell.visits++;

    world.restore(cell.snap);
    const e0 = errorsBefore();
    const a = pick(actionsAt(cell.obs));
    const frames = [];
    let obs = cell.obs;
    const runFrame = (f) => { world.step(f); steps++; frames.push(f); obs = world.observe(); };
    if (a.frames) for (const f of a.frames) runFrame(f);
    else if (a.until) {
      for (let i = 0; i < (a.max ?? 60); i++) {
        runFrame(i === 0 ? a.input : (a.then ?? a.input));
        const flat = flatten(obs);
        if (i + 1 >= (a.min ?? 1) && a.until.path && flat[a.until.path] === a.until.eq) break;
      }
    } else for (let i = 0; i < (a.hold ?? 1); i++) runFrame(a.input ?? {});
    const tick = cell.tick + frames.length;
    const ended = world.terminal?.(obs) === true; // ワールドが「終わり」と言う状態（落ちた等）は広げない
    const { cell: next } = add(obs, cell, frames, tick, ended ? null : world.snapshot(), signalsNow());
    cell.tries++;
    cell.outcomes.add(next.key);
    const errs = world.errors?.() ?? [];
    if (errs.length > e0) {
      const sig = errs.slice(e0).map((e) => `${e.name}: ${e.message}`).join(' / ');
      if (!bugs.has(sig)) bugs.set(sig, { tick, from: cell, frames: frames.slice(), errors: errs.slice(e0) });
    }
  }

  const tapeOf = (c) => { const fr = []; for (let x = c; x && x.parent; x = x.parent) fr.unshift(...x.frames); return compressTape(fr); };
  // 例外の再現テープ = 出発した区画までの道 ＋ そのとき押した入力（行き先の区画の道ではない）
  for (const b of bugs.values()) { b.tape = tapeOf({ parent: b.from, frames: b.frames }); delete b.from; delete b.frames; }

  // ---- まだ届いていないところへ、狙って届かせる（届かない足場など。ワールドの形から出た的で、ヒントではない）----
  // ワールドが 'unreached' の候補を出したら、それを的にして solve を回し、届いたらその道を区画に足す。
  if (typeof world.goalCandidates === 'function') {
    for (let round = 0; round < (opts.frontierRounds ?? 8); round++) {
      const pending = world.goalCandidates([...archive.values()], () => null).filter((c) => c.kind === 'unreached');
      if (!pending.length) break;
      const loseConds = world.goalCandidates([...archive.values()], () => null).filter((c) => c.kind === 'lose').map((c) => c.condition);
      let progressed = false;
      for (const target of pending) {
        const r = solve(world, { goal: { reach: target.condition, ...(loseConds.length ? { avoid: { any: loseConds } } : {}) }, budget: opts.frontierBudget ?? 60000 });
        steps += r.steps ?? 0;
        if (r.status !== 'cleared') continue;
        // 見つけた道を 1 tick ずつ流して、区画として覚える
        world.reset();
        let parent = archive.values().next().value;
        const frames = expandTape(r.tape);
        for (let t = 0; t < frames.length; t++) {
          world.step(frames[t]);
          const { cell } = add(world.observe(), parent, [frames[t]], t + 1, world.snapshot(), signalsNow());
          // 既にある区画（別の道で来た、少し違う状態）に乗り換えると、テープが繋がらなくなる。
          // 自分の道で入った区画でなければ、覚えない節（parent だけ持つ）で道を続ける
          parent = cell.parent === parent && cell.frames[0] === frames[t] ? cell : { parent, frames: [frames[t]], tick: t + 1 };
        }
        progressed = true;
      }
      if (!progressed) break;
    }
  }

  // ---- 終わりを見つける ------------------------------------------------------------
  const all = [...archive.values()];
  const frozen = all.filter((c) => c.tries >= frozenTries && c.outcomes.size === 1 && c.outcomes.has(c.key));
  const live = all.filter((c) => !frozen.includes(c));
  // ふだんの値（入力が効く状態で多数派の値）
  const usual = {};
  for (const c of live) for (const [k, v] of Object.entries(c.flat)) {
    const m = (usual[k] ??= new Map());
    const key = JSON.stringify(v);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  const common = (k, v) => {
    const m = usual[k];
    if (!m) return false;
    const n = [...m.values()].reduce((x, y) => x + y, 0);
    return (m.get(JSON.stringify(v)) ?? 0) / n > 0.02;
  };
  // 終わった区画を「原因の欄と値」でまとめる
  const groups = new Map();
  for (const c of frozen) {
    const causes = Object.entries(c.flat).filter(([k, v]) => typeof v !== 'number' && !common(k, v));
    if (!causes.length) continue;
    for (const [k, v] of causes) {
      const id = `${k}=${JSON.stringify(v)}`;
      const g = groups.get(id) ?? { path: k, value: v, cells: [], texts: new Set() };
      g.cells.push(c);
      for (const s of c.signals ?? []) if (s.tick >= (c.tick - 60)) g.texts.add(s.text);
      groups.set(id, g);
    }
  }
  const candidates = [];
  for (const g of groups.values()) {
    const first = g.cells.reduce((m, c) => (c.tick < m.tick ? c : m));
    const texts = [...g.texts];
    const reasons = [];
    let win = 0;
    let lose = 0;
    reasons.push(`入力が効かなくなった状態が ${g.cells.length} 区画（ゲームが終わった）`);
    reasons.push(`そのとき ${g.path} が ${JSON.stringify(g.value)}（ふだんは ${[...(usual[g.path]?.keys() ?? [])].slice(0, 3).join(' / ') || '無い'}）`);
    const winText = texts.find((t) => WIN_WORDS.test(t));
    const loseText = texts.find((t) => LOSE_WORDS.test(t));
    if (winText) { win += 3; reasons.push(`画面に「${oneLine(winText)}」が出た`); }
    if (loseText) { lose += 3; reasons.push(`画面に「${oneLine(loseText)}」が出た`); }
    const name = g.path.split('.').pop();
    const truthy = g.value === true || (typeof g.value === 'string' && g.value.length > 0);
    if (WIN_WORDS.test(name) && truthy) { win += 2; reasons.push(`欄の名前 ${name} が「勝ち」を表す`); }
    if (LOSE_WORDS.test(name) && truthy) { lose += 2; reasons.push(`欄の名前 ${name} が「負け」を表す`); }
    if (typeof g.value === 'string' && WIN_WORDS.test(g.value)) { win += 2; reasons.push(`値「${g.value}」が勝ちを表す`); }
    if (typeof g.value === 'string' && LOSE_WORDS.test(g.value)) { lose += 2; reasons.push(`値「${g.value}」が負けを表す`); }
    // 珍しさと深さ: 勝ちはふつう「なかなか届かない・遅い」、負けは「すぐ・何度も」
    const depthRank = all.filter((c) => c.tick < first.tick).length / Math.max(1, all.length);
    if (depthRank > 0.5) { win += 1; reasons.push(`届いたのが遅い（全区画の ${Math.round(depthRank * 100)}% より後）`); }
    if (g.cells.length > Math.max(3, frozen.length * 0.5)) { lose += 1; reasons.push('終わり方の多数派（負けに多い）'); }
    const kind = win > lose ? 'win' : lose > win ? 'lose' : 'unknown';
    candidates.push({
      kind, score: win - lose,
      condition: { path: g.path, eq: g.value },
      tick: first.tick,
      tape: tapeOf(first),
      reasons,
      texts: texts.slice(0, 5),
    });
  }
  // ワールド固有の候補（voxel の足場など）
  if (typeof world.goalCandidates === 'function') candidates.push(...world.goalCandidates(all, tapeOf));
  candidates.sort((x, y) => (y.kind === 'win') - (x.kind === 'win') || y.score - x.score || x.tick - y.tick);
  const goal = candidates.find((c) => c.kind === 'win') ?? null;
  const loses = candidates.filter((c) => c.kind === 'lose');
  return {
    goal: goal ? { reach: goal.condition, ...(loses.length ? { avoid: loses.length === 1 ? loses[0].condition : { any: loses.map((l) => l.condition) } } : {}) } : null,
    candidates,
    bugs: [...bugs.values()],
    cells: archive.size,
    frozen: frozen.length,
    steps,
    saturated: steps < budget,
  };
}
