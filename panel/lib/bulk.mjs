// bulk: many secrets at once from a pasted .env — the text read into the names and values to register. Lines are
// KEY=VALUE (also `export KEY=VALUE`, spaces round the =); a value is bare (up to a # that follows a space), 'single-quoted'
// (as it is) or "double-quoted" (\n \r \t \" \\ understood); a quoted value may run over several lines (a private key); lines
// beginning with # and blank lines are skipped. A name is what GitHub takes for a secret — capitals, digits and _, not
// beginning with a digit, not with GITHUB_ — and a value is never empty. A name given twice: the later one is used, with a
// warning. What is wrong is said by line number; no value is ever put into an error or a warning (a name only when it has the
// right form: a stray pasted token must not come out in a message). No DOM, no fetch, no node:.

/** what GitHub takes as a secret's name */
export const SECRET_NAME = /^[A-Z_][A-Z0-9_]*$/;
/** the most a repository keeps, and the most one secret holds (GitHub's) */
export const MAX_SECRETS = 100;
export const MAX_BYTES = 48 * 1024;
const ESCAPES = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };
// (a value this long may be over the limit in bytes: only then is it counted)
const tooBig = (v) => v.length > MAX_BYTES / 3 && new TextEncoder().encode(v).length > MAX_BYTES;

/** a .env text → { items: [{ name, value }], errors, warnings } (pure): the secrets to register, each name once in the order it
 *  first appears (the later value when it is given twice), and what is wrong in words ("3 行目: …"). Anything in errors means
 *  nothing should be registered yet */
export function parseEnv(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), n = s.length;
  const errors = [], warnings = [], found = new Map();
  const lineEnd = (p) => { const k = s.indexOf('\n', p); return k < 0 ? n : k; };
  const newlines = (a, b) => { let c = 0; for (let k = a; k < b; k++) if (s[k] === '\n') c++; return c; };
  let i = 0, line = 1;
  while (i < n) {
    const end = lineEnd(i), row = s.slice(i, end), first = line;
    if (!row.trim() || row.trim().startsWith('#')) { i = end + 1; line++; continue; }
    const head = /^[ \t]*(?:export[ \t]+)?([^\s=]+)[ \t]*=/.exec(row);
    if (!head) { errors.push(`${line} 行目: KEY=VALUE の形ではありません`); i = end + 1; line++; continue; }
    const name = head[1], from = i + head[0].length;
    let at = from, value, stop, problem = null;
    while (s[at] === ' ' || s[at] === '\t') at++;
    const q = s[at];
    if (q === '"' || q === "'") {
      let k = at + 1, v = '';
      for (; k < n && s[k] !== q; k++) {
        if (q === '"' && s[k] === '\\' && ESCAPES[s[k + 1]] !== undefined) { v += ESCAPES[s[k + 1]]; k++; } else v += s[k];
      }
      if (k >= n) { errors.push(`${first} 行目: 引用符 ${q} が閉じていません`); break; }
      stop = lineEnd(k + 1);
      if (!/^[ \t]*(?:#.*)?$/.test(s.slice(k + 1, stop))) problem = `引用符のあとに余計な文字があります（${first + newlines(i, k)} 行目）`;
      value = v;
    } else {
      const rest = s.slice(from, end), c = /[ \t]#/.exec(rest);
      value = (c ? rest.slice(0, c.index) : rest).trim();
      stop = end;
    }
    line = first + newlines(i, stop) + 1;
    i = stop + 1;
    problem ??= !SECRET_NAME.test(name) ? '名前は英大文字・数字・_ だけです（数字から始めません）'
      : name.startsWith('GITHUB_') ? `${name} は GITHUB_ で始まる名前にできません`
      : !value.trim() ? `${name} の値が空です（空の秘密は登録できません）`
      : tooBig(value) ? `${name} が大きすぎます（${MAX_BYTES / 1024} KB まで）` : null;
    if (problem) { errors.push(`${first} 行目: ${problem}`); continue; }
    if (found.has(name)) warnings.push(`${name} が ${found.get(name).line} 行目と ${first} 行目にあります: 後のものを使います`);
    found.set(name, { value, line: first });
  }
  if (found.size > MAX_SECRETS) errors.push(`秘密は ${MAX_SECRETS} 個までです（GitHub の上限）: 貼られたのは ${found.size} 個`);
  return { items: [...found].map(([name, x]) => ({ name, value: x.value })), errors, warnings };
}
