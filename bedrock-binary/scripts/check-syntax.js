#!/usr/bin/env node
// すべての .js を node --check にかける。依存パッケージなしでできる最低限の静的検査。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = ['src', 'scripts', 'test'];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.js')) yield p;
  }
}

let failed = 0;
let count = 0;
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    count++;
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      failed++;
      console.error(`✗ ${file}\n${r.stderr}`);
    }
  }
}
if (failed) {
  console.error(`${failed} / ${count} ファイルに構文エラーがあります`);
  process.exit(1);
}
console.log(`✓ ${count} ファイルの構文は正常です`);
