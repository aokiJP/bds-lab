// 出力系: docs / report / diff
import { loadProfile } from '../analysis/profile.js';
import { diffProfiles, isEmptyDiff } from '../report/diff.js';
import { renderProfile, renderDiff } from '../report/markdown.js';
import { writeMetadata } from '../report/metadata.js';
import { buildSite } from '../report/site.js';
import { requireFile } from '../lib/preflight.js';
import { str } from '../lib/args.js';
import { writeFileAtomic } from '../lib/store.js';
import path from 'node:path';

export function generateDocs(profile, outDir) {
  const written = writeMetadata(profile, outDir);
  const site = buildSite(profile, outDir);
  return { written, site };
}

export const docs = {
  group: '出力',
  usage: 'docs <プロファイル> [--out DIR]',
  summary: 'metadata/ 一式と検索付きサイトを作る（既定は site/）',
  example: 'docs profiles/release-1.21.124.2.json',
  minArgs: 1,
  run({ args, flags, dirs }) {
    const out = str(flags.out) ?? dirs.site;
    const { written, site } = generateDocs(loadProfile(requireFile(args[0])), out);
    for (const w of written) console.log(`  ${w.path}  (${w.items.toLocaleString()} 件)`);
    console.log(`  ページ ${site.pages} / 検索インデックス ${site.records.toLocaleString()} 件`);
    console.log(`→ ${path.join(out, 'index.html')}`);
  },
};

export const report = {
  group: '出力',
  usage: 'report <プロファイル> [--out FILE]',
  summary: 'プロファイルを Markdown にする',
  minArgs: 1,
  run({ args, flags, dirs }) {
    const p = loadProfile(requireFile(args[0]));
    const out = str(flags.out) ?? path.join(dirs.reports, `${p.channel ?? 'unknown'}-${p.version ?? 'unknown'}.md`);
    writeFileAtomic(out, renderProfile(p));
    console.log(`→ ${out}`);
  },
};

export const diff = {
  group: '出力',
  usage: 'diff <前のプロファイル> <後のプロファイル> [--out FILE]',
  summary: '2 つの版を比べる（サーバーとクライアントの比較も可）',
  example: 'diff profiles/release-A.json profiles/release-B.json',
  minArgs: 2,
  run({ args, flags }) {
    const d = diffProfiles(loadProfile(requireFile(args[0])), loadProfile(requireFile(args[1])));
    const md = renderDiff(d);
    const out = str(flags.out);
    if (out) {
      writeFileAtomic(out, md);
      console.log(`→ ${out}`);
    } else console.log(md);
    if (isEmptyDiff(d)) console.error('（差分なし）');
  },
};
