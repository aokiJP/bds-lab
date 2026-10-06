// コマンドをバイナリから取り出す。
//
// CommandRegistry への登録は、翻訳キー `commands.<名前>.description` と
// コマンド名そのものを同じ関数から読む形になる。この 2 つが揃っている関数を探せばいい。
// 同じ関数が読んでいる他の識別子は、そのコマンドが使うパラメータ列挙の型名であることが多い。
//
// 公式メタデータ (mojang-commands.json) には 83 個しか載っていないが、
// バイナリには 95 個ある。差分は表に出ていないコマンド（Edu 系や内部用）。

const DESCRIPTION = /^commands\.([a-z0-9_-]+)\.description$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{1,63}$/;

// 登録関数にはメモリ確保の失敗メッセージなどが混ざる。値ではない。
const NOISE = /[ /(.]|^commands\./;

/**
 * @param {import('./xref.js').XrefIndex} xref
 * @param {string[]} [officialNames] 公式メタデータに載っているコマンド名
 */
export function extractCommands(xref, officialNames = []) {
  const official = new Set(officialNames);
  const found = new Map();

  for (const [func, list] of xref.byFunction) {
    for (const s of list) {
      const m = s.match(DESCRIPTION);
      if (!m) continue;
      const name = m[1];

      // 同じ関数が読んでいる他の識別子。パラメータの列挙型名など
      const related = list.filter(
        (v) => v !== name && !NOISE.test(v) && IDENTIFIER.test(v) && v.length > 2,
      );

      const prev = found.get(name);
      // 同じコマンドが複数の関数から出たら、手がかりの多いほうを採る
      if (!prev || related.length > prev.related.length) {
        found.set(name, {
          name,
          descriptionKey: s,
          related,
          addr: xref.functions.addressOf(func),
          inOfficialMetadata: official.size ? official.has(name) : null,
        });
      }
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 公式メタデータには無いコマンド */
export function undocumentedCommands(commands) {
  return commands.filter((c) => c.inOfficialMetadata === false);
}
