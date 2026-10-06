// 座標とセレクタ

// ---- 座標 -----------------------------------------------------------------

function coord(tok, base, axis, isBlock) {
  if (tok === undefined) throw new Syntax('座標が足りません', '');
  const t = String(tok);
  if (t.startsWith('^')) throw new NotImpl('^ 座標');
  if (t.startsWith('~')) {
    const r = t.length > 1 ? Number(t.slice(1)) : 0;
    if (!Number.isFinite(r)) throw new Syntax(`座標 ${t} が正しくありません`, t);
    return base[axis] + r;
  }
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Syntax(`座標 ${t} が正しくありません`, t);
  // バニラ: 整数の絶対座標はブロック中心（x/z に +0.5）。ブロック座標では切り捨て
  if (!isBlock && Number.isInteger(n) && axis !== 'y' && !t.includes('.')) return n + 0.5;
  return n;
}
function pos3(args, i, base, isBlock) {
  const p = { x: coord(args[i], base, 'x', isBlock), y: coord(args[i + 1], base, 'y', isBlock), z: coord(args[i + 2], base, 'z', isBlock) };
  if (isBlock) return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
  return p;
}

// ---- セレクタ ---------------------------------------------------------------

function parseArgs(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of body) {
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((kv) => {
    const m = /^\s*([a-z_]+)\s*=\s*(!?)\s*(.*?)\s*$/i.exec(kv);
    if (!m) throw new Syntax(`セレクタの引数 ${kv} が正しくありません`);
    return { k: m[1], neg: m[2] === '!', v: m[3].replace(/^"|"$/g, '') };
  });
}

// hasitem={item=<id>[,quantity=<範囲>][,location=slot.<…>][,slot=<範囲>][,data=0]} か [{…},{…}]（全部を満たす）。
// quantity は当てはまる枠の合計（省略時 1..、!で否定、quantity=0 は「持っていない」）。location 省略時は持ち物と装備の全部
const rangeTest = (s) => {
  const m = /^(!?)(-?\d*)(\.\.)?(-?\d*)$/.exec(String(s).trim());
  if (!m || (m[2] === '' && m[4] === '')) throw new Syntax(`範囲 ${s} が正しくありません`);
  const lo = m[2] === '' ? -Infinity : Number(m[2]), hi = m[3] ? (m[4] === '' ? Infinity : Number(m[4])) : lo;
  return (n) => (n >= lo && n <= hi) !== (m[1] === '!');
};
const ARMOR = { 'slot.armor.head': 'Head', 'slot.armor.chest': 'Chest', 'slot.armor.legs': 'Legs', 'slot.armor.feet': 'Feet', 'slot.weapon.offhand': 'Offhand' };
function itemSlots(e, loc) {
  const inv = e.inventory ?? [], eq = e.equipment ?? {};
  if (loc === undefined) return [...inv, ...Object.values(eq)].map((it, i) => [i, it]);
  if (loc === 'slot.hotbar') return inv.slice(0, 9).map((it, i) => [i, it]);
  if (loc === 'slot.inventory') return inv.slice(9, 36).map((it, i) => [i, it]);
  if (loc === 'slot.weapon.mainhand') return [[0, inv[e.selectedSlot ?? 0]]];
  if (ARMOR[loc]) return [[0, eq[ARMOR[loc]] ?? null]];
  throw new NotImpl(`hasitem の location ${loc}`);
}
function hasItemTest(raw) {
  const groups = String(raw).trim().replace(/^\[|\]$/g, '').match(/\{[^{}]*\}/g);
  if (!groups) throw new Syntax(`hasitem の指定 ${raw} が正しくありません`);
  const tests = groups.map((g) => {
    const o = {};
    for (const part of g.slice(1, -1).split(',').filter((x) => x.trim())) {
      const m = /^\s*(\w+)\s*=\s*(.*?)\s*$/.exec(part);
      if (!m) throw new Syntax(`hasitem の指定 ${part} が正しくありません`);
      o[m[1]] = m[2];
    }
    if (!o.item) throw new Syntax('hasitem には item が要ります');
    const id = itemId(o.item);
    if (!id) throw new Syntax(`Unknown item: ${o.item}`, o.item);
    if (o.data !== undefined && !['0', '-1'].includes(o.data)) throw new NotImpl('hasitem の data');
    const qty = rangeTest(o.quantity ?? '1..'), slot = o.slot !== undefined ? rangeTest(o.slot) : () => true;
    return (e) => { let n = 0; for (const [i, it] of itemSlots(e, o.location)) if (it && it.typeId === id && slot(i)) n += it.amount; return qty(n); };
  });
  return (e) => tests.every((t) => t(e));
}

function select(tok, src) {
  const t = String(tok);
  const m = /^@([aeprsn]|initiator)(?:\[(.*)\])?$/s.exec(t);
  if (!m) {
    // 名前
    const list = [...entities.values()].filter((e) => e.valid && e.player && e.joined && e.name === t);
    return list;
  }
  const kind = m[1];
  const args = m[2] ? parseArgs(m[2]) : [];
  const origin = { ...src.pos };
  let list;
  if (kind === 's') list = src.entity && src.entity.valid ? [src.entity] : [];
  else if (kind === 'e' || kind === 'n') list = [...entities.values()].filter((e) => e.valid && e.dying === undefined && (!e.player || e.joined));
  else if (kind === 'initiator') throw new NotImpl('@initiator');
  else list = [...entities.values()].filter((e) => e.valid && e.player && e.joined);

  // 次元: @s 以外は実行元の次元のみ（距離系の引数があるとき）
  let limit = kind === 'p' ? 1 : kind === 'r' ? 1 : kind === 'n' ? 1 : Infinity;
  let hasPos = false;
  let sort = kind === 'p' || kind === 'n' ? 'nearest' : kind === 'r' ? 'random' : 'none';
  let typeDefault = kind === 'r' ? 'minecraft:player' : null;
  const f = [];
  let r;
  let rm;
  let vol = null;
  for (const a of args) {
    switch (a.k) {
      case 'x': case 'y': case 'z': origin[a.k] = coord(a.v, src.pos, a.k, false) - (Number.isInteger(Number(a.v)) && a.k !== 'y' && !a.v.startsWith('~') ? 0.5 : 0); hasPos = true; break;
      case 'r': r = Number(a.v); hasPos = true; break;
      case 'rm': rm = Number(a.v); hasPos = true; break;
      case 'dx': case 'dy': case 'dz': vol ??= { x: 0, y: 0, z: 0 }; vol[a.k[1]] = Number(a.v); hasPos = true; break;
      case 'c': {
        const n = Number(a.v);
        if (!Number.isInteger(n) || n === 0) throw new Syntax('c は 0 以外の整数です');
        limit = Math.abs(n);
        if (kind !== 'r') sort = n > 0 ? 'nearest' : 'furthest';
        break;
      }
      case 'type': {
        const id = entityTypeId(a.v);
        if (!id) throw new Syntax(`エンティティの種類 ${a.v} はありません`, a.v);
        typeDefault = null;
        f.push((e) => (e.typeId === id) !== a.neg);
        break;
      }
      case 'name': f.push((e) => ((e.player ? e.name : e.nameTag) === a.v) !== a.neg); break;
      case 'tag': f.push((e) => (a.v === '' ? e.tags.size === 0 : e.tags.has(a.v)) !== a.neg); break;
      case 'family': f.push((e) => W.familiesOf(e).includes(a.v) !== a.neg); break;
      case 'm': {
        const gm = { 0: 'Survival', s: 'Survival', survival: 'Survival', 1: 'Creative', c: 'Creative', creative: 'Creative', 2: 'Adventure', a: 'Adventure', adventure: 'Adventure', spectator: 'Spectator' }[a.v.toLowerCase()];
        if (!gm) throw new Syntax(`ゲームモード ${a.v} は正しくありません`);
        f.push((e) => (e.player && e.gameMode === gm) !== a.neg);
        break;
      }
      case 'scores': {
        const body = a.v.replace(/^\{|\}$/g, '');
        for (const part of body.split(',').filter(Boolean)) {
          const mm = /^\s*([^=\s]+)\s*=\s*(!?)\s*(-?\d*)(\.\.)?(-?\d*)\s*$/.exec(part);
          if (!mm) throw new Syntax(`scores の指定 ${part} が正しくありません`);
          const [, obj, neg, lo, dots, hi] = mm;
          const min = lo === '' ? -Infinity : Number(lo);
          const max = dots ? (hi === '' ? Infinity : Number(hi)) : min;
          f.push((e) => {
            const o = objectives.get(obj);
            const i = [...identities.values()].find((x) => x.entityId === e.id);
            const v = o && i ? o.scores.get(i.id) : undefined;
            if (v === undefined) return false;
            return (v >= min && v <= max) !== (neg === '!');
          });
        }
        break;
      }
      case 'hasitem': { const t = hasItemTest(a.v); f.push((e) => t(e) !== a.neg); break; }
      case 'rx': case 'rxm': case 'ry': case 'rym': case 'l': case 'lm': case 'haspermission': case 'has_property':
        throw new NotImpl(`セレクタ引数 ${a.k}`);
      default:
        throw new Syntax(`セレクタの引数 ${a.k} は不明です`);
    }
  }
  if (typeDefault) list = list.filter((e) => e.typeId === typeDefault);
  list = list.filter((e) => f.every((fn) => fn(e)));
  if (hasPos || sort !== 'none') list = list.filter((e) => e.dim === src.dim || kind === 's');
  const d2 = (e) => (e.loc.x - origin.x) ** 2 + (e.loc.y - origin.y) ** 2 + (e.loc.z - origin.z) ** 2;
  if (r !== undefined) list = list.filter((e) => d2(e) <= r * r);
  if (rm !== undefined) list = list.filter((e) => d2(e) >= rm * rm);
  if (vol) {
    const lo = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
    list = list.filter((e) => ['x', 'y', 'z'].every((k) => e.loc[k] >= Math.min(lo[k], lo[k] + vol[k]) && e.loc[k] < Math.max(lo[k], lo[k] + vol[k]) + 1));
  }
  if (sort === 'nearest') list.sort((a, b) => d2(a) - d2(b));
  else if (sort === 'furthest') list.sort((a, b) => d2(b) - d2(a));
  else if (sort === 'random') {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  }
  return list.slice(0, limit);
}

function targets(tok, src, { allowEmpty = false } = {}) {
  if (tok === undefined) throw new Syntax('対象が足りません');
  const list = select(tok, src);
  if (!list.length && !allowEmpty) throw new Failed('No targets matched selector');
  return list;
}
