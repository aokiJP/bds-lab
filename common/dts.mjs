// @minecraft/* declaration files (index.d.ts) as a map: name → its declaration block (members one per line, doc-comment flags
// kept as `// no-before early beta`). Used by `api` (core.mjs) and `apidiff` (apidiff.mjs).
import fs from 'node:fs';

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l) && l.trim() && !/private constructor\(\);/.test(l)).join('\n');
}
function joinParens(src) {
  let d = 0, o = '';
  for (const ch of src) {
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') d--;
    if (ch === '\n' && d > 0) { o += ' '; continue; }
    o += ch;
  }
  return o.replace(/[ \t]+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/,\s*\)/g, ')');
}
export function decls(list) {
  const map = new Map();
  for (const f of list) {
    // doc comments -> short flags on the member line: no-before (restricted execution: not inside beforeEvents, defer
    // with system.run), early (allowed during startup / early execution), beta. (@throws is on nearly every native member: left out)
    const flagged = (typeof f === 'string' ? fs.readFileSync(f, 'utf8') : f.text).replace(/\r/g, '').replace(/\/\*\*([\s\S]*?)\*\//g, (_, c) => {
      const fl = [/no-restricted-execution|can't be (called|edited) in restricted-execution/.test(c) && 'no-before', /early-execution/.test(c) && !/can't be called in early-execution/.test(c) && 'early', /@beta\b/.test(c) && 'beta'].filter(Boolean);
      return fl.length ? '\u0001' + fl.join(' ') + '\u0001' : '';
    });
    const lines0 = joinParens(stripComments(flagged)).split('\n'), lines = [];
    let pend = null;
    for (const l of lines0) { const m = /^\s*\u0001(.*)\u0001\s*$/.exec(l); if (m) { pend = m[1]; continue; } lines.push(pend ? l + ' // ' + pend : l); pend = null; }
    for (let i = 0; i < lines.length; i++) {
      const m = /^export (?:declare )?(?:abstract )?(class|interface|enum|type|function|const) (\w+)/.exec(lines[i]);
      if (!m) continue;
      let j = i;
      if (/\{\s*(\/\/.*)?$/.test(lines[i])) while (j < lines.length && lines[j] !== '}') j++;
      else while (j < lines.length && !/;\s*$/.test(lines[j])) j++;
      const block = lines.slice(i, j + 1).map((l) => l.replace(/^\s+/, ' ').replace(/^export (declare )?/, '').replace(/\bminecraft\w+\./g, ''));
      map.set(m[2], (map.has(m[2]) ? map.get(m[2]) + '\n' : '') + block.join('\n'));
    }
  }
  return map;
}
export const MEMBER = /^ (?:readonly |static )*'?(\w+)'?\??[(:<]/;
export const baseOf = (map, n) => /extends (\w+)/.exec(map.get(n)?.split('\n')[0] ?? '')?.[1];
export const members = (body) => body.split('\n').slice(1).filter((l) => l !== '}' && !/^ constructor/.test(l));
export function findMember(map, name, member) {
  for (let n = name, seen = new Set(); n && map.has(n) && !seen.has(n); n = baseOf(map, n)) {
    seen.add(n);
    const l = members(map.get(n)).find((x) => MEMBER.exec(x)?.[1] === member);
    if (l) return l;
  }
  return null;
}

