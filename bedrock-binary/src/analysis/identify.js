// enum を「名前」ではなく「中身」で見分ける。
//
// なぜ要るか。型名の出どころは cereal のリフレクション文字列だけで、これは release ビルド
// にしか無い。preview と Android クライアントでは型名が 1 つも取れず、
//   - 名前が最初の値になってしまう（LegacyTelemetryEventPacketPayload::Type → Achievement）
//   - その値が値の列から落ちるので、以降の ID が 1 ずつずれる
//   - 名前で引いている WSS のイベント種別やカタログのモジュールが軒並み空になる
// という連鎖が起きていた。
//
// 値の集合そのものは、名前が消えたビルドでも変わらない。そこで型名が取れたビルドから
// 「名前 ↔ 値の集合」の辞書（data/enum-names.json）を作っておき、
// 名前の無い enum に中身で当てる。当たれば名前が戻り、同時に
// 「先頭の識別子が型名だったのか値だったのか」も辞書側の事実で決まる。

/** 辞書の形式。読み書きで食い違ったら気づけるようにしておく */
export const DICTIONARY_FORMAT = 1;

/** これ未満しか重ならないものは同じ enum とみなさない */
export const MIN_SHARED = 5;
/** Jaccard 係数の下限。版が変われば値は増減するので、完全一致は求めない */
export const MIN_SCORE = 0.5;

const norm = (v) => v.toLowerCase();

/** 型名の裏が取れているか。shape（登録関数の形からの推定）だけが「仮」 */
export function nameConfirmed(e) {
  return Boolean(e?.source) && e.source !== 'shape';
}

/** 型名の出どころの表示名 */
export const SOURCE_LABEL = {
  symbols: 'シンボル',
  cereal: 'cereal',
  dictionary: '名前辞書',
  shape: '形から推定',
};

/** enum が持っている識別子の集合（型名の候補も含めた raw 基準） */
export function valueSet(e) {
  return new Set(rawOf(e).map(norm));
}

/** raw があればそれ、無ければ「名前 + 値」で代用する（古いプロファイル互換） */
export function rawOf(e) {
  if (Array.isArray(e.raw) && e.raw.length) return e.raw;
  const provisional = e.source === 'shape' || e.nameProvisional;
  return provisional ? [e.name, ...e.values] : e.values;
}

function jaccard(a, b) {
  let shared = 0;
  for (const v of a) if (b.has(v)) shared++;
  return { shared, score: shared / (a.size + b.size - shared) };
}

/**
 * 型名が取れている enum だけを集めて辞書にする。
 * @param {Array<{profile:object, label:string}>} sources
 */
export function buildDictionary(sources) {
  const entries = new Map();
  for (const { profile, label } of sources) {
    for (const e of profile.enums ?? []) {
      if (e.source !== 'cereal' && e.source !== 'symbols') continue;
      const values = e.values ?? [];
      if (values.length < MIN_SHARED) continue;
      const cur = entries.get(e.name);
      // 同じ名前が複数の版にあるときは、値の多いほうを残す（後の版で増えるのが普通）
      if (!cur || values.length > cur.values.length) {
        entries.set(e.name, { name: e.name, short: e.short ?? e.shortName ?? e.name.split('::').pop(), values, from: label });
      }
    }
  }
  return {
    format: DICTIONARY_FORMAT,
    generatedAt: new Date().toISOString(),
    note: '型名が取れたビルドから作った「名前 ↔ 値」の辞書。型名の無いビルドの enum を中身で見分けるのに使う。',
    sources: sources.map((s) => s.label),
    entries: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * 辞書を当てて、名前と「先頭が型名かどうか」を確定させる。enums を直接書き換える。
 * @param {Array} enums extractEnums の結果（alignWithTables より前に呼ぶ）
 * @param {{entries:Array}} dict
 * @returns {{named:number, headFixed:number, hits:Array}}
 */
export function applyDictionary(enums, dict) {
  const refs = (dict?.entries ?? []).map((r) => ({ ...r, set: new Set(r.values.map(norm)) }));
  if (!refs.length) return { named: 0, headFixed: 0, hits: [] };

  // このビルドで既に確定している型名（シンボル・cereal）は、辞書で別の enum に付けない。
  // 付けると同じ名前の enum が 2 つになり、名前で引く側（diff・WSS・カタログ）が片方を黙って捨てる
  // （実測: release 1.26.52.3 で 12 組。同じ型の登録が 2 か所あるもの、中身が別の enum に名前が付いたもの）
  const taken = new Set(enums.filter((e) => !e.nameProvisional && (e.source === 'cereal' || e.source === 'symbols')).map((e) => e.name));
  // 1 つの名前が複数の enum に当たることがあるので、いちばん似ているものだけに付ける
  const claim = new Map();
  for (const e of enums) {
    if (!e.nameProvisional && (e.source === 'cereal' || e.source === 'symbols')) continue;
    const mine = valueSet(e);
    let best = null;
    for (const r of refs) {
      if (taken.has(r.name)) continue;
      const { shared, score } = jaccard(mine, r.set);
      if (shared < MIN_SHARED || score < MIN_SCORE) continue;
      if (!best || score > best.score) best = { r, score, shared };
    }
    if (!best) continue;
    const cur = claim.get(best.r.name);
    if (!cur || best.score > cur.best.score) claim.set(best.r.name, { e, best });
  }

  let named = 0;
  let headFixed = 0;
  const hits = [];
  for (const [name, { e, best }] of claim) {
    const raw = rawOf(e);
    // 辞書側に無い識別子が頭についていれば、それが型名。ここで初めて根拠つきで落とせる
    let head = 0;
    while (head < raw.length && !best.r.set.has(norm(raw[head]))) head++;
    if (head >= raw.length) continue;
    const values = raw.slice(head);
    if (values.length !== e.values.length) headFixed++;
    e.name = name;
    e.shortName = best.r.short;
    e.source = 'dictionary';
    e.nameProvisional = false;
    e.nameFrom = best.r.from;
    e.nameScore = Number(best.score.toFixed(3));
    e.values = values;
    if (head) e.trimmedHead = raw.slice(0, head);
    named++;
    hits.push({ name, score: e.nameScore, values: values.length });
  }
  return { named, headFixed, hits };
}
