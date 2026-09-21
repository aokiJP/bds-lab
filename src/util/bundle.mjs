import path from 'node:path';

const OUTSIDE = new Set(['@minecraft/server', '@minecraft/server-ui', '@minecraft/server-gametest']);

function transform(rel, src, resolve) {
  const problems = [];
  let out = src;

  if (/\bimport\s*\(/.test(out)) problems.push('動的 import() は差し替えに載せられません');
  if (/^\s*export\s+\*/m.test(out)) problems.push('export * は差し替えに載せられません');

  const req = (spec) => {
    if (OUTSIDE.has(spec)) return `__require(${JSON.stringify(spec)})`;
    const abs = resolve(rel, spec);
    if (!abs) { problems.push(`読めない import: ${spec}（${rel}）`); return 'null'; }
    return `__require(${JSON.stringify(abs)})`;
  };

  // 先に副作用だけの import（import "./x.js";）を畳む。
  // 後回しにすると、下の from 付きの正規表現が行をまたいでこの行ごと飲み込んでしまう。
  out = out.replace(/^[ \t]*import\s*['"]([^'"]+)['"];?[ \t]*$/gm, (_m, spec) => `${req(spec)};`);

  // what は引用符とセミコロンを含まない。{ } が複数行に渡るのは許すが、別の import 文は越えない
  out = out.replace(/^[ \t]*import\s+([^'";]*?)\s+from\s*['"]([^'"]+)['"];?[ \t]*$/gm, (_m, what, spec) => {
    const r = req(spec);
    const w = what.trim();
    let m = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(w);
    if (m) return `const ${m[1]} = ${r};`;
    m = /^([A-Za-z_$][\w$]*)\s*,\s*\{([\s\S]*)\}$/.exec(w);
    if (m) return `const ${m[1]} = (${r}).default; const {${m[2]}} = ${r};`;
    m = /^\{([\s\S]*)\}$/.exec(w);
    if (m) return `const {${m[1].replace(/\bas\b/g, ':')}} = ${r};`;
    m = /^([A-Za-z_$][\w$]*)$/.exec(w);
    if (m) return `const ${m[1]} = (${r}).default;`;
    problems.push(`読めない import の形: ${w}`);
    return '';
  });

  out = out.replace(/^[ \t]*export\s+default\s+/gm, '__exports.default = ');

  const named = [];
  out = out.replace(/^[ \t]*export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind, name) => {
    named.push(name);
    return `${kind} ${name}`;
  });
  if (/^[ \t]*export\s+(const|let|var)\s*[[{]/m.test(src)) problems.push('分割代入の export は差し替えに載せられません');

  out = out.replace(/^[ \t]*export\s*\{([^}]*)\};?[ \t]*$/gm, (_m, list) => list.split(',').map((piece) => {
    const [from, to] = piece.split(/\s+as\s+/).map((s) => s.trim());
    if (!from) return '';
    return `__exports[${JSON.stringify(to ?? from)}] = ${from};`;
  }).join(' '));

  const tail = named.map((n) => `__exports[${JSON.stringify(n)}] = ${n};`).join('\n');
  return { code: `${out}\n${tail}\n`, problems };
}

export function bundle({ files, entry }) {
  const resolve = (fromRel, spec) => {
    if (!spec.startsWith('.')) return null;
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
    for (const cand of [abs, `${abs}.js`, `${abs}/index.js`]) if (files[cand] !== undefined) return cand;
    return null;
  };

  const parts = [];
  const problems = [];
  for (const [rel, src] of Object.entries(files)) {
    if (!rel.endsWith('.js')) continue;
    const t = transform(rel, src, resolve);
    problems.push(...t.problems);
    parts.push(`__modules[${JSON.stringify(rel)}] = function (__exports, __require) {\n${t.code}\n};`);
  }
  if (!files[entry]) problems.push(`入口がありません: ${entry}`);
  if (problems.length) return { error: problems.join(' / ') };

  const source = [
    '"use strict";',
    'const __modules = {}; const __cache = {};',
    ...parts,
    'function __require(id) {',
    '  if (__outside[id]) return __outside[id];',
    '  if (__cache[id]) return __cache[id];',
    '  const f = __modules[id];',
    '  if (!f) throw new Error("見つからないモジュール: " + id);',
    '  const e = {}; __cache[id] = e; f(e, __require); return e;',
    '}',
    `__require(${JSON.stringify(entry)});`,
  ].join('\n');

  return { source, modules: Object.keys(files).filter((f) => f.endsWith('.js')) };
}
