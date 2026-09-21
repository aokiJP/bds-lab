// プロジェクト全体を zip にして持ち出す（バックアップ・他の場所に送る用）。
//   node bin/bds-lab.mjs archive
//
// 既定では、消しても作り直せる重いフォルダ（node_modules・展開済みの実機）を先に消してから、
// 残りのプロジェクト全体を zip にする。vendor/bedrock-server.zip（実機の取得元）は消さない。
import fs from 'node:fs';
import path from 'node:path';
import { writeZip, collect, DEFAULT_SKIP, humanSize, dirSize } from '../util/zip.mjs';

// [相対パス, 消してよい理由（作り直し方）]
const CLEANABLE = [
  ['node_modules', 'npm install / pnpm install で戻ります'],
  [path.join('vendor', 'bedrock-server'), 'vendor/bedrock-server.zip があれば npm start が展開し直します。無くても次回の npm start が取得します'],
];

/** 作り直せる重いフォルダを消す。何を・どれだけ消したかを返す。 */
export function clean({ ROOT, say = console.log, targets = CLEANABLE }) {
  const removed = [];
  let freed = 0;
  for (const [rel, why] of targets) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const size = dirSize(abs);
    fs.rmSync(abs, { recursive: true, force: true });
    freed += size;
    removed.push({ rel, size });
    say(`  消しました: ${rel}（${humanSize(size)} 空きました・${why}）`);
  }
  if (!removed.length) say('  消せる大きなフォルダはありませんでした（すでにきれいです）');
  return { removed, freed };
}

function stamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
}

/**
 * プロジェクト全体（node_modules・実機・キャッシュ・refs を除く）を 1 本の zip にする。
 * clean: true なら、zip する前に node_modules と展開済みの実機を消す（既定）。
 * withVendorZip: true なら vendor/bedrock-server.zip（90MB 前後）も同梱する（既定では外す）。
 */
export function archive({ ROOT, say = console.log, clean: doClean = true, withVendorZip = false, out = null }) {
  let freed = 0;
  if (doClean) {
    say('作り直せる重いフォルダを消しています…');
    freed = clean({ ROOT, say }).freed;
    say('');
  }

  const skip = new Set(DEFAULT_SKIP);   // .git / node_modules / .bds-lab / dist / worlds / target / vendor / refs
  const entries = collect(ROOT, '', skip);
  if (withVendorZip) {
    const zipFile = path.join(ROOT, 'vendor', 'bedrock-server.zip');
    if (fs.existsSync(zipFile)) entries.push({ name: 'vendor/bedrock-server.zip', abs: zipFile });
    else say('  vendor/bedrock-server.zip が無いので実機は入れません');
  }

  const dir = out ? path.dirname(path.resolve(out)) : path.join(ROOT, '.bds-lab', 'archive');
  fs.mkdirSync(dir, { recursive: true });
  const zip = out ? path.resolve(out) : path.join(dir, `${path.basename(ROOT)}-src-${stamp()}.zip`);
  const { files, size } = writeZip(zip, entries);

  say(`プロジェクト全体を zip にしました（${files} ファイル / ${humanSize(size)}）`);
  say(`  ${zip}`);
  say('  node_modules・実機（vendor/bedrock-server）・.bds-lab・worlds・refs は入っていません');
  if (!withVendorZip) say('  vendor/bedrock-server.zip も入れるなら --with-vendor を付けてください');
  if (doClean && freed > 0) say(`  ディスクは ${humanSize(freed)} 空きました`);
  return { zip, files, size, freed };
}
