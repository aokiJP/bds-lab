// .data.rel.ro に置かれた「const char* の配列」を復元する。
//
// PIE なので配列の中身はファイル上では 0 で、実際の値は R_X86_64_RELATIVE の
// addend として .rela.dyn に入っている。r_offset が 8 ずつ連続していれば配列 1 本。
//
// なぜ要るか。命令の並びから取った enum の順序は、コンパイラが登録呼び出しを
// 並べ替えると崩れる（実測で版間に順序が総入れ替えになる enum があった）。
// 配列はメモリ配置そのものなので、並び順が定義順から動かない。
// 名前は命令側から、順序は配列側から取るのがいちばん確からしい。

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{1,63}$/;

export const MIN_TABLE = 5;

/**
 * @param {import('./xref.js').XrefIndex} xref
 * @returns {Array<{offset:number, values:string[]}>}
 */
export function extractPointerTables(xref, { minLength = MIN_TABLE } = {}) {
  const tables = [];
  let run = [];
  let prev = null;

  const flush = () => {
    if (run.length >= minLength) {
      tables.push({ offset: run[0].offset, values: run.map((p) => p.value) });
    }
    run = [];
  };

  for (const p of xref.pointers) {
    // 識別子でないものが挟まったら、そこで配列は切れているとみなす
    if (!IDENTIFIER.test(p.value)) {
      flush();
      prev = null;
      continue;
    }
    if (prev !== null && p.offset - prev !== 8) flush();
    run.push(p);
    prev = p.offset;
  }
  flush();
  return tables;
}

/**
 * enum と配列を値の重なりで突き合わせ、一致すれば配列の順序を正とする。
 * 戻り値は enum ごとの {ordered, coverage}。
 */
export function alignWithTables(enums, tables) {
  const index = tables.map((t) => ({ ...t, set: new Set(t.values) }));

  for (const e of enums) {
    const want = new Set(e.values);
    let best = null;
    for (const t of index) {
      let hit = 0;
      for (const v of t.values) if (want.has(v)) hit++;
      if (!hit) continue;
      // 配列側にも enum 側にもよく重なっているものを選ぶ
      const coverage = hit / want.size;
      const purity = hit / t.values.length;
      const score = coverage * purity;
      if (!best || score > best.score) best = { t, score, coverage, purity, hit };
    }

    if (best && best.coverage >= 0.8 && best.purity >= 0.8) {
      // 配列にある値を配列順に、配列に無い値は後ろに残す
      const inTable = best.t.values.filter((v) => want.has(v));
      const extra = e.values.filter((v) => !best.t.set.has(v));
      e.values = [...inTable, ...extra];
      e.ordered = true;
      e.tableOffset = best.t.offset;
      e.coverage = Number(best.coverage.toFixed(3));
    } else {
      e.ordered = false;
    }
  }
  return enums;
}
