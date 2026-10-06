// プロファイル 2 本を比べる。
//
// 単なる集合差分では足りない。enum は「値が増えた」だけでなく
// 「途中に挿入されて以降の番号が全部ずれた」ことがあり、
// 後者はプロトコル実装を静かに壊す。位置の変化まで出す。

export function diffProfiles(before, after) {
  return {
    from: side(before),
    to: side(after),
    // サーバー (x86-64) とクライアント (aarch64) を比べると、識別子の差は
    // 「版の変化」ではなく「片側にしか無いコード」を意味する。レポートで区別する
    crossBinary:
      side(before).machine !== side(after).machine ||
      (before.channel === 'android') !== (after.channel === 'android'),
    packets: diffPackets(before.packets, after.packets),
    enums: diffEnums(before.enums, after.enums),
    identifiers: {
      live: diffList(before.identifiers.live, after.identifiers.live),
      dead: diffList(before.identifiers.dead, after.identifiers.dead),
    },
    stats: diffStats(before.stats, after.stats),
  };
}

function side(p) {
  return { version: p.version, channel: p.channel ?? null, machine: p.binary?.machine ?? null, buildId: p.binary?.buildId ?? null };
}

export function diffList(before, after) {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((x) => !b.has(x)),
    removed: before.filter((x) => !a.has(x)),
  };
}

/**
 * パケットの増減と番号の変化。番号はどちらも各パケットクラスの getId() から読んだもの（src/analysis/packets.js）。
 * 古いプロファイル（packets が無い・読めなかった）が片方でもあれば null: 列挙子の並びの差では番号を語らない
 */
export function diffPackets(before, after) {
  if (before?.basis !== 'getId' || after?.basis !== 'getId') return null;
  const b = new Map(before.list.map((p) => [p.class, p.id]));
  const a = new Map(after.list.map((p) => [p.class, p.id]));
  const pick = ({ id, class: c, name }) => ({ id, class: c, name: name ?? null });
  let added = after.list.filter((p) => !b.has(p.class)).map(pick);
  let removed = before.list.filter((p) => !a.has(p.class)).map(pick);
  // the same id under a new class name is a rename, not a packet gone and another new (1.21.124.2 → 1.26.51.1: 330
  // DataStoreSyncPacket → ClientboundDataStorePacket)
  const goneById = new Map(removed.map((p) => [p.id, p]));
  const renamed = added.filter((p) => goneById.has(p.id)).map((p) => ({ id: p.id, from: goneById.get(p.id).class, to: p.class }));
  const re = new Set(renamed.map((r) => r.id));
  added = added.filter((p) => !re.has(p.id));
  removed = removed.filter((p) => !re.has(p.id));
  return {
    added,
    removed,
    renamed,
    renumbered: after.list.filter((p) => b.has(p.class) && b.get(p.class) !== p.id).map((p) => ({ class: p.class, from: b.get(p.class), to: p.id })),
  };
}
const packetChanges = (p) => Boolean(p && (p.added.length || p.removed.length || p.renumbered.length || p.renamed?.length));

function diffEnums(before, after) {
  const b = new Map(before.map((e) => [e.name, e]));
  const a = new Map(after.map((e) => [e.name, e]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [name, e] of a) {
    if (!b.has(name)) {
      added.push({ name, short: e.short, count: e.values.length });
      continue;
    }
    const d = diffEnumValues(b.get(name).values, e.values);
    // 並びが配列で裏取りできていない enum は、番号のずれを「壊れる変更」として扱わない。
    // 命令順は登録呼び出しの並べ替えで簡単に動くので、誤報の温床になる。
    if (d) changed.push({ name, short: e.short, ordered: Boolean(e.ordered && b.get(name).ordered), ...d });
  }
  for (const [name, e] of b) {
    if (!a.has(name)) removed.push({ name, short: e.short, count: e.values.length });
  }

  // 名前だけが変わったもの（形からの仮の名前 → 辞書や cereal の型名、またはその逆）は増減ではない。
  // 値の 8 割以上が同じ相手を 1 対 1 で組にして「名前の変化」に移す（実測: 1.26.51.1 → 1.26.52.3 で
  // 削除 13 / 追加 1 と出ていたものが、すべて名前が付いただけだった）
  const renamed = [];
  const vals = (m, n) => new Set((m.get(n)?.values ?? []).map((v) => v.toLowerCase()));
  for (const r of [...removed]) {
    const rs = vals(b, r.name);
    let best = null;
    for (const x of added) {
      const xs = vals(a, x.name);
      let shared = 0; for (const v of rs) if (xs.has(v)) shared++;
      const score = shared / Math.max(rs.size, xs.size, 1);
      if (shared >= 3 && score >= 0.8 && (!best || score > best.score)) best = { x, score };   // (1〜2 値の enum は似ていて当然: 組にしない)
    }
    if (!best) continue;
    removed.splice(removed.indexOf(r), 1);
    added.splice(added.indexOf(best.x), 1);
    const d = diffEnumValues(b.get(r.name).values, a.get(best.x.name).values);
    renamed.push({ from: r.name, to: best.x.name, count: best.x.count, same: !d, added: d?.added.length ?? 0, removed: d?.removed.length ?? 0 });
  }

  return { added, removed, changed, renamed };
}

/** 値の増減と、番号がずれた範囲を返す。差が無ければ null */
export function diffEnumValues(before, after) {
  const b = new Set(before);
  const a = new Set(after);
  const added = after.map((v, i) => ({ value: v, id: i })).filter((x) => !b.has(x.value));
  const removed = before.map((v, i) => ({ value: v, id: i })).filter((x) => !a.has(x.value));

  // 番号がずれた最初の位置。ここ以降は既存の値も別の番号になっている。
  let shiftedFrom = null;
  const common = Math.min(before.length, after.length);
  for (let i = 0; i < common; i++) {
    if (before[i] !== after[i]) {
      shiftedFrom = i;
      break;
    }
  }
  if (shiftedFrom === null && before.length !== after.length) shiftedFrom = common;

  if (!added.length && !removed.length && shiftedFrom === null) return null;

  const renumbered = [];
  if (shiftedFrom !== null) {
    const aIndex = new Map(after.map((v, i) => [v, i]));
    for (let i = shiftedFrom; i < before.length; i++) {
      const to = aIndex.get(before[i]);
      if (to !== undefined && to !== i) renumbered.push({ value: before[i], from: i, to });
    }
  }
  return { added, removed, shiftedFrom, renumbered };
}

function diffStats(before, after) {
  const keys = ['strings', 'referenced', 'functions', 'identifiersLive', 'identifiersDead'];
  const out = {};
  for (const k of keys) {
    const b = before?.[k] ?? 0;
    const a = after?.[k] ?? 0;
    out[k] = { before: b, after: a, delta: a - b };
  }
  return out;
}

/** 差分が実質的に空かどうか */
export function isEmptyDiff(d) {
  return (
    !packetChanges(d.packets) &&
    !d.enums.added.length &&
    !d.enums.removed.length &&
    !d.enums.changed.length &&
    !d.enums.renamed?.length &&
    !d.identifiers.live.added.length &&
    !d.identifiers.live.removed.length
  );
}
