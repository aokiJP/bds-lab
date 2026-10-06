// 生成したサイトの内部リンクとアンカー、検索インデックスの参照先を検査する。
// 壊れたリンクは静かに増えるので CI で落とす。
import fs from 'node:fs';
import path from 'node:path';
import { installErrorHandler } from '../lib/preflight.js';

installErrorHandler();
const OUT = process.argv[2] ?? 'site';

if (!fs.existsSync(OUT)) {
  console.error(`✗ ${OUT}/ がありません。先に npm start か docs コマンドを実行してください。`);
  process.exit(1);
}

const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
};

const pages = walk(OUT);
const ids = new Map();
for (const p of pages) {
  const html = fs.readFileSync(p, 'utf8');
  ids.set(path.relative(OUT, p), new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}

const problems = [];
let checked = 0;
for (const p of pages) {
  const rel = path.relative(OUT, p);
  for (const m of fs.readFileSync(p, 'utf8').matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#$)/.test(href)) continue;
    checked++;
    const [target, frag] = href.split('#');
    const targetRel = target ? path.normalize(path.join(path.dirname(rel), target)) : rel;
    if (target && !fs.existsSync(path.join(OUT, targetRel))) {
      problems.push(`${rel}: リンク先が無い → ${href}`);
      continue;
    }
    if (frag && ids.has(targetRel) && !ids.get(targetRel).has(frag)) {
      problems.push(`${rel}: アンカーが無い → ${href}`);
    }
  }
}

const index = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8'));
const bad = new Map();
for (const r of index) {
  const [target, frag] = r.r.split('#');
  if (!fs.existsSync(path.join(OUT, target))) bad.set(r.r, 'ファイルが無い');
  else if (frag && !ids.get(target)?.has(frag)) bad.set(r.r, 'アンカーが無い');
}
for (const [ref, why] of bad) problems.push(`index.json: ${why} → ${ref}`);

console.log(`ページ ${pages.length} / リンク ${checked} / インデックス ${index.length} 件を検査`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} 件`);
  for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
  process.exit(1);
}
console.log('✓ 内部リンクはすべて有効です');
