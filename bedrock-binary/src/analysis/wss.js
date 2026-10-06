// WebSocket まわりをバイナリから取り出す。
//
// 前提として、`/connect` で張る WebSocket の購読処理はクライアント側にある。
// BDS のバイナリには購読ハンドラも、よく出回っている 158 語のイベント名表も無い。
// それでもサーバー側には次の 3 つが残っていて、これが確かな足場になる。
//
//  1. メッセージ封筒のキー（header / body / messagePurpose / requestId / eventName ...）
//  2. LegacyTelemetryEventPacket が運ぶイベント種別の enum。サーバーが実際に扱うもの
//  3. イベント名の文字列が「参照されているか」。参照が無ければサーバーでは発火しない
//
// 2 は preview と Android で長く空になっていた。原因は WSS 側ではなく enum の名前で、
// 型名（cereal 由来）が無いビルドでは目的の enum が別名で登録され、名前で引く経路が必ず外れる。
// 今は 2 段構えにしてある。
//   a. 名前で引く（identify.js の辞書で preview / Android でも型名が戻る）
//   b. 値の並びで引く（辞書にも無いときの最後の砦。名前に一切依存しない）

// 封筒のキーはこの関数に固まっている
const ENVELOPE_ANCHOR = 'messagePurpose';

// 封筒のキーとして採る語の形。lowerCamel の短い語だけ
const ENVELOPE_KEY = /^[a-z][A-Za-z]{2,20}$/;

// サーバー側のイベント種別を持つ enum。
// 名前が取れないビルド向けに「先頭の値」も持たせ、名前が外れても中身で拾えるようにする。
const EVENT_ENUMS = [
  { name: 'LegacyTelemetryEventPacketPayload::Type', anchors: ['Achievement', 'Interaction', 'PortalCreated'] },
  { name: 'LegacyTelemetryEventPacketPayload::Achievement', anchors: ['Interaction', 'PortalCreated', 'PortalUsed'] },
];

/** 名前の末尾についている廃止マーカー */
const OBSOLETE = /_OBSOLETE$/;

/** 名前空間の有無を無視して引く */
function byName(enums, name) {
  const short = name.split('::').pop();
  return (
    enums.find((e) => e.name === name) ??
    enums.find((e) => e.name.endsWith(`::${name}`)) ??
    enums.find((e) => (e.short ?? e.shortName) === short)
  );
}

/** enum の先頭に落とした型名を戻した列（形から推定した名前は最初の値であることがある） */
function candidates(e) {
  const head = e.trimmedHead ?? (e.nameProvisional || e.source === 'shape' ? [e.name] : []);
  return head.length ? [e.values, [...head, ...e.values]] : [e.values];
}

/** 値の列が anchors で始まる enum を探す。名前には一切頼らない */
function byAnchors(enums, anchors) {
  const starts = (values) => anchors.every((a, i) => values[i] === a);
  for (const e of enums) {
    for (const c of candidates(e)) {
      for (let skip = 0; skip <= 2 && skip < c.length; skip++) {
        if (starts(c.slice(skip))) return { e, values: c.slice(skip) };
      }
    }
  }
  return null;
}

/**
 * @param {import('./xref.js').XrefIndex} xref
 * @param {Array} enums extractEnums の結果
 * @param {string[]} [knownEventNames] 出回っているテレメトリ名の一覧（あれば突き合わせる）
 */
export function extractWss(xref, enums, knownEventNames = [], { side = 'server' } = {}) {
  // 封筒を読む関数は 1 つとは限らない（送る側と受ける側で分かれる）。
  // 最初の 1 つで打ち切ると、購読処理を持つクライアント側でキーを取りこぼす。
  const envelope = new Set();
  let envelopeFunctions = 0;
  for (const list of xref.byFunction.values()) {
    if (!list.includes(ENVELOPE_ANCHOR)) continue;
    envelopeFunctions++;
    for (const s of list) if (ENVELOPE_KEY.test(s)) envelope.add(s);
  }

  const eventTypes = [];
  // ::Type と ::Achievement は値がほとんど重なるので、中身だけでは区別できない。
  // 同じ enum を 2 回採らないよう、採用済みを覚えておく。
  const used = new Set();
  for (const def of EVENT_ENUMS) {
    let via = 'name';
    let e = byName(enums, def.name);
    let values = e?.values;
    // 型名の裏が取れている名前（cereal / 辞書 / シンボル）はそのまま信じる。
    // 形から推定しただけの名前は当てにならないので、中身が合っているときだけ採る。
    const trusted = e && !e.nameProvisional && e.source !== 'shape';
    if (!e || !(trusted || def.anchors.every((a) => values.includes(a)))) {
      const hit = byAnchors(enums, def.anchors);
      if (!hit) continue;
      e = hit.e;
      values = hit.values;
      via = 'anchors';
    }
    const id = e.addr ?? e.name;
    if (used.has(id)) continue;
    used.add(id);
    eventTypes.push({
      enum: def.name,
      foundAs: e.name,
      via,
      orderVerified: Boolean(e.ordered),
      values: values.map((v, id) => ({
        id,
        name: v.replace(OBSOLETE, ''),
        obsolete: OBSOLETE.test(v),
      })),
    });
  }

  // 出回っているイベント名を、バイナリの事実と突き合わせる。
  // present だが referenced でないものは、文字列が残っているだけでサーバーでは動かない。
  const strings = new Set();
  for (const { value } of xref.strings.entries()) strings.add(value);
  const known = knownEventNames.map((name) => ({
    name,
    present: strings.has(name),
    referenced: xref.referenced.has(name),
  }));

  return {
    side,
    note:
      side === 'client'
        ? 'クライアント (libminecraftpe.so) の解析。/connect の購読ハンドラはこちら側にある。'
        : '購読ハンドラはクライアント側にあり、BDS のバイナリには含まれない。',
    envelope: [...envelope].sort(),
    envelopeFunctions,
    eventTypes,
    knownNames: known,
    summary: {
      knownTotal: known.length,
      presentInBinary: known.filter((k) => k.present).length,
      referencedInBinary: known.filter((k) => k.referenced).length,
      eventTypeValues: eventTypes.reduce((a, e) => a + e.values.length, 0),
    },
  };
}
