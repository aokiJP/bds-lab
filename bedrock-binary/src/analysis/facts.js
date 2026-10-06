// バイナリにしか無い事実を、取りこぼさずに拾う。
//
// これまで拾っていたのは enum とコマンドと WSS の 3 つだけだった。
// .rodata にはほかにも、公式メタデータには出てこない形の文字列がまとまって入っている。
//
//   minecraft:zombie           名前空間つき識別子（アクター・ブロック・アイテム・コンポーネント）
//   query.is_baby              Molang
//   commands.give.description  翻訳キー
//   @minecraft/server 1.19.0   スクリプト API のモジュールと、受け付ける版
//
// どれも「バイナリにあるか」だけでなく「参照されているか」まで分かるのが要点で、
// そこがパック配布物（bedrock-samples）を読むのとの違いになる。
// 参照が無いものは、文字列だけ残っていて実際には動かない。

const NAMESPACED = /^[a-z][a-z0-9_]*:[a-z0-9_][a-z0-9_.\-/]*$/;
const MOLANG = /^(query|variable|context|math|temp|geometry|material|texture|array)\.[a-z0-9_]+(\.[a-z0-9_]+)*$/i;
const SCRIPT_MODULE = /^@minecraft\/[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(-(beta|rc|alpha|internal)(\.[\w.]+)?)?$/;

// 翻訳キーはここに挙げた頭でだけ拾う。`.` を含む文字列すべてを拾うと
// ファイル名やクラス名まで混ざって使い物にならない。
const TEXT_KEY = new RegExp(
  '^(commands|death|item|tile|entity|block|gui|options|accessibility|createWorld|selectWorld|' +
    'multiplayer|chat|permissions|action|achievement|tips|effect|enchantment|potion|attribute|' +
    'record|subtitles|soundCategory|dimension|difficulty|gameMode|generator|feature|editor|' +
    'authentication|disconnectionScreen|playscreen|store|xbox|error|warning)\\.[A-Za-z0-9_+%\\-]+(\\.[A-Za-z0-9_+%\\-]+)*$',
);

/** 名前空間つき識別子を、名前の形でざっくり分ける（当てにしすぎないための目安） */
function kindOf(id) {
  const local = id.split(':')[1];
  if (/_component$|^has_|^is_/.test(local)) return 'component';
  if (/\./.test(local)) return 'event';
  return 'identifier';
}

function group(values, referenced) {
  const live = [];
  const dead = [];
  for (const v of values) (referenced.has(v) ? live : dead).push(v);
  live.sort();
  dead.sort();
  return { total: live.length + dead.length, referenced: live.length, live, dead };
}

/**
 * @param {import('../elf/strings.js').StringTable} strings
 * @param {import('./xref.js').XrefIndex} xref
 * @param {{maxPerGroup?:number}} opts 大きくなりすぎる群の上限（参照ありを優先して残す）
 */
export function extractFacts(strings, xref, opts = {}) {
  const max = opts.maxPerGroup ?? 4000;
  const seen = new Set();
  const namespaced = new Map(); // 名前空間 → 値
  const molang = [];
  const textKeys = [];
  const scriptModules = new Set();

  for (const { value } of strings.entries()) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (value.length > 128) continue;

    if (SCRIPT_MODULE.test(value)) {
      scriptModules.add(value);
      continue;
    }
    if (NAMESPACED.test(value)) {
      const ns = value.slice(0, value.indexOf(':'));
      if (!namespaced.has(ns)) namespaced.set(ns, []);
      namespaced.get(ns).push(value);
      continue;
    }
    if (MOLANG.test(value)) {
      molang.push(value);
      continue;
    }
    if (TEXT_KEY.test(value)) textKeys.push(value);
  }

  // スクリプト API は「モジュール名を読む関数が、同時にどの版を読んでいるか」で版が分かる
  const modules = new Map();
  for (const list of xref.byFunction.values()) {
    const mods = list.filter((s) => SCRIPT_MODULE.test(s));
    if (!mods.length) continue;
    const versions = list.filter((s) => SEMVER.test(s));
    for (const m of mods) {
      if (!modules.has(m)) modules.set(m, new Set());
      for (const v of versions) modules.get(m).add(v);
    }
  }
  for (const m of scriptModules) if (!modules.has(m)) modules.set(m, new Set());

  const cap = (g) => {
    if (g.total <= max) return g;
    // 参照ありを優先して残す。落とした件数は数として残す
    const live = g.live.slice(0, max);
    const dead = g.dead.slice(0, Math.max(0, max - live.length));
    return { ...g, live, dead, truncated: g.total - live.length - dead.length };
  };

  const byNamespace = {};
  for (const [ns, values] of [...namespaced].sort((a, b) => b[1].length - a[1].length)) {
    byNamespace[ns] = cap(group(values, xref.referenced));
  }

  return {
    namespaced: {
      namespaces: Object.keys(byNamespace),
      byNamespace,
      // 形での分類は目安。ID の意味づけはバイナリからは取れない
      kinds: countBy([...namespaced.values()].flat(), kindOf),
    },
    molang: cap(group(molang, xref.referenced)),
    textKeys: cap(group(textKeys, xref.referenced)),
    scriptModules: [...modules]
      .map(([name, versions]) => ({
        name,
        referenced: xref.referenced.has(name),
        versions: [...versions].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function countBy(values, fn) {
  const out = {};
  for (const v of values) {
    const k = fn(v);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** ログ 1 行分の要約 */
export function summarizeFacts(f) {
  const ns = Object.entries(f.namespaced.byNamespace)
    .slice(0, 3)
    .map(([k, g]) => `${k} ${g.referenced}/${g.total}`)
    .join(' / ');
  return (
    `名前空間つき識別子 ${Object.values(f.namespaced.byNamespace).reduce((a, g) => a + g.total, 0).toLocaleString()} 件` +
    `（${ns}） Molang ${f.molang.total} / 翻訳キー ${f.textKeys.total} / スクリプト API ${f.scriptModules.length} モジュール`
  );
}
