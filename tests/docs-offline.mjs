#!/usr/bin/env node
// The docs an AI reads must not send it to things that do not exist: every `node lab.mjs <cmd>` in AGENTS.md / README.md /
// help.md is a command the lab handles, every `help <topic>` a topic some lab has. Static: no server, no network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(TOP, f), 'utf8');
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
// what the lab handles: lab.mjs's own commands, the engine's, each flavor's
const known = new Set(['bds', 'end', 'll', ...all(/A\[0\] === '([\w-]+)'/g, read('lab.mjs')), ...all(/\b([a-z][a-z0-9]*): \['[\w]+\.mjs', '\w+'/g, read('lab.mjs')), ...all(/cmd === '([\w-]+)'/g, read('common/core.mjs'))]);
for (const k of ['bds', 'end', 'll']) { const f = read(`${k}/flavor.mjs`), b = /commands: \{([\s\S]*?)\n {2}\},/.exec(f)?.[1] ?? ''; for (const c of all(/^ {4}(?:async )?([a-z_]+)(?:\(|:)/gm, b)) known.add(c); }
let bad = 0;
const topics = new Set(['verbs']);
for (const f of ['common/help.md', 'bds/help.md', 'end/help.md', 'll/help.md']) if (fs.existsSync(path.join(TOP, f))) for (const t of all(/^## (\S+)/gm, read(f))) topics.add(t);
const docs = fs.existsSync(path.join(TOP, 'docs')) ? fs.readdirSync(path.join(TOP, 'docs'), { recursive: true }).filter((x) => /\.md$/.test(x)).map((x) => `docs/${x.split(path.sep).join('/')}`).sort() : [];
// a relative link in a doc points at a file that is there (the README was split into docs/: a moved file breaks links silently)
for (const f of ['README.md', 'skills/GROWTH.md', ...docs]) {
  const s = read(f), dead = all(/\]\(((?!https?:|#)[^)#\s]+)(?:#[^)]*)?\)/g, s).filter((l) => !fs.existsSync(path.join(TOP, path.dirname(f), l)));
  console.log(`${dead.length ? '✘' : '✔'} links in ${f}${dead.length ? ': ' + dead.join(', ') : ''}`); bad += dead.length;
}
for (const f of ['AGENTS.md', 'end/AGENTS.md', 'll/AGENTS.md', 'README.md', 'common/help.md', 'bds/help.md', 'end/help.md', 'll/help.md', ...docs]) {
  const s = read(f), miss = new Set();
  for (const c of all(/node lab\.mjs\s+(?:(?:bds|end|ll)\s+)?([a-z][\w-]*)/g, s)) if (!known.has(c)) miss.add(`node lab.mjs ${c}`);
  for (const t of all(/`help ([a-z|]+)/g, s).flatMap((x) => x.split('|'))) if (!topics.has(t)) miss.add(`help ${t}`);
  console.log(`${miss.size ? '✘' : '✔'} ${f}${miss.size ? ': ' + [...miss].join(', ') : ''}`);
  bad += miss.size;
}
console.log(`\n${bad ? 'FAIL' : 'PASS'} docs-offline`);
process.exit(bad ? 1 : 0);
