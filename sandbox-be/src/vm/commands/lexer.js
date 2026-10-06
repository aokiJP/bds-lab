// 字句

// ---- 字句 -----------------------------------------------------------------

function tokenize(line) {
  const out = [];
  let i = 0;
  const s = line.trim().replace(/^\//, '');
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s[i] === '"') {
      let j = i + 1;
      let v = '';
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\' && j + 1 < s.length) j++; v += s[j]; j++; }
      out.push({ v, quoted: true, start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    // @e[...] や block[...] や {...} は括弧が閉じるまでを 1 語にする
    let j = i;
    let depth = 0;
    while (j < s.length) {
      const c = s[j];
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === '"' && depth > 0) { j++; while (j < s.length && s[j] !== '"') j++; }
      else if (/\s/.test(c) && depth <= 0) break;
      j++;
    }
    out.push({ v: s.slice(i, j), start: i, end: j });
    i = j;
  }
  return out;
}

/** 構文エラー。token は実機のメッセージで >>…<< に入る語 */
class Syntax extends Error {
  constructor(message, token) { super(message); this.token = token; }
}
class Failed extends Error {}
class NotImpl extends Error {}
