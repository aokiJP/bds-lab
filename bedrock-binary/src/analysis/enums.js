// バイナリから enum を名前つきで取り出す。
//
// 手がかりは 2 つあり、ビルドによってどちらが使えるかが変わる。
//
// 1. cereal のリフレクション文字列
//      Factory<Type> cereal::BasicFactory<MinecraftPacketIds>::scope(std::string_view)
//    __PRETTY_FUNCTION__ 由来で、山括弧の中が名前空間つきの正確な型名。
//    ただし release ビルドにしか無い。preview では消えている。
//
// 2. 登録関数そのものの形
//    enum の登録関数は「型名を 1 個だけ読んで、そのあと値を順番に読む」形に落ちる。
//    つまり参照文字列の並びが [型名, 値, 値, ...] になる。1 が無くてもこれで取れる。
//
// cereal を「名前の正解」、形の検出を「網」として併用する。
//
// 2 の弱点: ids[0] が「型名」なのか「最初の値」なのかは、この関数だけでは決められない。
// 実測では preview ビルドの LegacyTelemetryEventPacketPayload::Type が
// 名前 Achievement・値 Interaction 始まりになり、全 ID が 1 ずれていた。
// そこで raw（読んだ識別子の列そのまま）も残し、identify.js が名前辞書と突き合わせて確定させる。

import { enumTypeFromSymbol } from '../elf/symbols.js';

const FACTORY = /cereal::(?:BasicFactory|internal::TypeSchema)<([A-Za-z_][\w:]*)>/;

/** 名前の確からしさ。シンボル > cereal の文字列 > 形からの推定 */
const RANK = { symbols: 3, cereal: 2, shape: 1 };
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{1,63}$/;

// cereal の内部で使われる定型語。enum の値ではない。
const BOILERPLATE = new Set([
  'newlyCreated', 'scope', 'view', 'Type', 'value', 'std', 'cereal',
  'internal', 'entt', 'string_view', 'id_type', 'meta_type', 'meta_any',
]);

export const MIN_VALUES = 5;

/**
 * @param {import('./xref.js').XrefIndex} xref
 * @param {{minValues?:number, symbolName?:(addr:number)=>string|null}} opts
 *   symbolName: アドレスからシンボル名を引く関数（bedrock_server_symbols.debug があるとき）
 */
export function extractEnums(xref, opts = {}) {
  const minValues = opts.minValues ?? MIN_VALUES;
  const best = new Map();

  for (const [func, list] of xref.byFunction) {
    // 参照文字列を「識別子」と「それ以外」に分ける。
    // それ以外はアサートメッセージやファイルパスで、enum とは関係ない。
    const ids = [];
    for (const s of list) {
      if (IDENTIFIER.test(s) && !BOILERPLATE.has(s)) ids.push(s);
    }
    if (ids.length < minValues + 1) continue;

    // 名前の出どころは 3 つ。確かな順に試す。
    //   1. シンボル表（別ファイルの symbols があるときだけ）
    //   2. cereal のリフレクション文字列（release ビルドのみ）
    //   3. 形からの推定（先頭の識別子を型名とみなす。仮の名前）
    const addr = xref.functions.addressOf(func);
    let qualified = opts.symbolName ? enumTypeFromSymbol(opts.symbolName(addr)) : null;
    let source = qualified ? 'symbols' : null;
    if (!qualified) {
      for (const s of list) {
        const m = s.match(FACTORY);
        if (m) { qualified = m[1]; source = 'cereal'; break; }
      }
    }
    source ??= 'shape';
    const name = qualified ?? ids[0];
    const parts = new Set(name.split('::'));
    const values = ids.filter((v) => !parts.has(v));
    if (values.length < minValues) continue;

    // 同じ enum が複数の関数に散ることがある。
    // cereal 由来を優先し、そのうえで値が多いものを採る。
    const cur = best.get(name);
    const better =
      !cur ||
      RANK[source] > RANK[cur.source] ||
      (RANK[source] === RANK[cur.source] && values.length > cur.values.length);
    if (better) {
      best.set(name, {
        name,
        shortName: name.split('::').pop(),
        source,
        // raw は「この関数が読んだ識別子の列」そのまま。values は型名らしきものを落とした後。
        // cereal が無いビルドでは ids[0] が型名なのか最初の値なのか単独では決められないため、
        // 判断材料を落とさずに両方残す（src/analysis/identify.js が辞書と突き合わせて直す）。
        raw: ids,
        values,
        nameProvisional: source === 'shape',
        func,
        addr,
      });
    }
  }

  // cereal が名前空間つきの名前で登録した enum は、形の検出でも短い名前で
  // もう一度拾われる。同じものが 2 回並ぶので後者を落とす。
  const qualifiedShorts = new Set(
    [...best.values()].filter((e) => e.source !== 'shape').map((e) => e.shortName),
  );
  const out = [...best.values()].filter(
    (e) => !(e.source === 'shape' && qualifiedShorts.has(e.name)),
  );

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 名前で引ける索引。短い名前でも引けるようにする */
export function indexEnums(enums) {
  const idx = new Map();
  for (const e of enums) {
    idx.set(e.name.toLowerCase(), e);
    const short = (e.shortName ?? e.short ?? e.name).toLowerCase();
    if (!idx.has(short)) idx.set(short, e);
  }
  return idx;
}
