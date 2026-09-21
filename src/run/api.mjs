// API を索引から引く。d.ts 全文（25 万 token）を読ませないための口。
//   npm run api -- InputInfo
//   npm run api -- InputInfo.getMovementVector
//   npm run api -- --find 入力
//   npm run api -- InputInfo --raw
import fs from 'node:fs';
import path from 'node:path';

const MODULES = {
  'server.d.ts': '@minecraft/server',
  'server-ui.d.ts': '@minecraft/server-ui',
  'server-gametest.d.ts': '@minecraft/server-gametest',
};

const strip = (s) => s.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\r/g, '');
const squeeze = (s) => s.replace(/\s+/g, ' ').trim();

function blocks(src, file) {
  const out = [];
  const re = /^export (?:declare )?(class|interface|enum) (\w+)[^\n{]*\{/gm;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth += 1; else if (c === '}') depth -= 1;
      i += 1;
    }
    out.push({ kind: m[1], name: m[2], body: src.slice(re.lastIndex, i - 1), file });
  }
  const re2 = /^export (?:declare )?(function|const|type|enum) (\w+)([^\n;]*);/gm;
  while ((m = re2.exec(src))) out.push({ kind: m[1], name: m[2], body: '', sig: squeeze(m[0]), file });
  return out;
}

let cache = null;

export function index(ROOT) {
  if (cache) return cache;
  const dir = path.join(ROOT, 'types', 'minecraft');
  const all = new Map();
  for (const [file, mod] of Object.entries(MODULES)) {
    let src;
    try { src = fs.readFileSync(path.join(dir, file), 'utf8'); } catch { continue; }
    for (const b of blocks(src, mod)) if (!all.has(b.name)) all.set(b.name, b);
  }
  cache = all;
  return all;
}

/** この実機に実在するか（.bds-lab/api.json が正。無ければ同梱の api.json） */
export function live(ROOT) {
  for (const p of [path.join(ROOT, '.bds-lab', 'api.json'), path.join(ROOT, 'api.json')]) {
    try {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { version: doc.version ?? '?', api: doc.api ?? {} };
    } catch { /* 次へ */ }
  }
  return null;
}

export function members(block) {
  if (!block.body) return [];
  const out = [];
  let buf = '', doc = '', inDoc = false;
  for (const raw of block.body.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('/**')) { doc = ''; inDoc = true; }
    if (inDoc) {
      doc += ` ${line.replace(/^\/\*\*|\*\/$|^\*/g, '').trim()}`;
      if (line.endsWith('*/')) inDoc = false;
      continue;
    }
    if (line.startsWith('//') || line === 'private constructor();') continue;
    buf += (buf ? ' ' : '') + line;
    if ((buf.match(/\(/g) ?? []).length !== (buf.match(/\)/g) ?? []).length) continue;
    const text = squeeze(buf.replace(/[,;]$/, ''));
    buf = '';
    const name = /^(?:readonly )?(\w+)/.exec(text)?.[1];
    if (name) out.push({ name, text, doc: squeeze(doc) });
    doc = '';
  }
  return out;
}

const distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const t = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return row[b.length];
};

const near = (want, names) => names
  .map((n) => {
    const a = n.toLowerCase(), b = want.toLowerCase();
    return { n, score: a.includes(b) ? -100 + Math.abs(a.length - b.length) : distance(a, b) };
  })
  .sort((x, y) => x.score - y.score).slice(0, 3).map((x) => x.n);

const mark = (ok) => (ok === null ? '' : ok ? ' ✓' : ' ✘この実機に無い');

function liveHas(runtime, cls, member) {
  if (!runtime) return null;
  const bag = runtime.api?.[cls];
  if (bag === undefined) return false;
  if (!member) return true;
  return Object.prototype.hasOwnProperty.call(bag, member);
}

export function lookup({ ROOT, query, raw = false, find = null, max = 25 }) {
  const all = index(ROOT);
  const runtime = live(ROOT);
  const out = [];
  const say = (s) => { if (out.length < max) out.push(s); };

  if (!all.size) return ['types/minecraft/*.d.ts がありません → npm run docs'];

  if (find) {
    const q = find.toLowerCase();
    const hits = [];
    for (const b of all.values()) {
      if (b.name.toLowerCase().includes(q)) hits.push(`${b.name}  ${b.kind}`);
      else for (const m of members(b)) if (m.name.toLowerCase().includes(q)) { hits.push(`${b.name}.${m.name}`); break; }
      if (hits.length >= max - 2) break;
    }
    if (!hits.length) return [`「${find}」に当たるものはありません`];
    say(`「${find}」に当たるもの ${hits.length} 件`);
    for (const h of hits) say(`  ${h}`);
    return out;
  }

  const [clsName, memberName] = String(query).split('.');
  const key = all.has(clsName) ? clsName : [...all.keys()].find((k) => k.toLowerCase() === clsName.toLowerCase());
  const block = key ? all.get(key) : null;
  if (!block) return [`${clsName} はありません。近いもの: ${near(clsName, [...all.keys()]).join(' / ')}`];

  if (raw) return [`// ${block.file}`, block.sig ?? `export ${block.kind} ${block.name} {${block.body}}`];

  const list = members(block);
  if (memberName) {
    const m = list.find((x) => x.name === memberName) ?? list.find((x) => x.name.toLowerCase() === memberName.toLowerCase());
    if (!m) return [`${block.name}.${memberName} はありません。近いもの: ${near(memberName, list.map((x) => x.name)).join(' / ')}`];
    say(`${block.name}.${m.text}${mark(liveHas(runtime, block.name, m.name))}`);
    say(`  ${block.file}  ${block.kind}${runtime ? `  実機 ${runtime.version}` : ''}`);
    const throws = [...(m.doc ?? '').matchAll(/\{@link ([\w.]*Error)\}/g)].map((x) => x[1]);
    const note = squeeze((m.doc ?? '').replace(/@remarks|@throws|@privilege[^.]*\.|\{@link [^}]*\}|This (?:function|property) can throw[^.]*\./g, '')).slice(0, 180);
    if (note) say(`  ${note}`);
    if (throws.length) say(`  例外: ${[...new Set(throws)].slice(0, 4).join(' / ')}`);
    return out;
  }

  say(`${block.name}  ${block.kind}  ${block.file}${mark(liveHas(runtime, block.name))}`);
  if (block.sig) { say(`  ${block.sig}`); return out; }
  const shown = list.slice(0, max - 3);
  for (const m of shown) say(`  ${m.text}${mark(liveHas(runtime, block.name, m.name))}`);
  if (list.length > shown.length) say(`  … ほか ${list.length - shown.length} 件（npm run api -- ${block.name} --raw）`);
  return out;
}

export function api({ ROOT, query, raw = false, find = null, say = console.log }) {
  for (const line of lookup({ ROOT, query, raw, find })) say(line);
}
