#!/usr/bin/env node
// ゲームのバイナリをリポジトリに入れないための検査。
// 拡張子だけでなく中身（ELF / APK のマジック）も見る。名前を変えただけのものも止める。
//
//   node scripts/guard-binaries.js            git の追跡対象を検査
//   node scripts/guard-binaries.js a b ...    指定したファイルを検査
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FORBIDDEN_EXT = /\.(apk|apks|xapk|aab|so|zip|mcpack)$/i;
const FORBIDDEN_NAME = /(^|\/)(bedrock_server|libminecraftpe[^/]*)$/;
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

// git 管理外の置き場所。zip で受け取った場合など、git が使えないときに飛ばす
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'work', 'site']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('site-')) yield* walk(path.join(dir, e.name));
    } else yield path.join(dir, e.name).split(path.sep).join('/');
  }
}

function files() {
  const argv = process.argv.slice(2);
  if (argv.length) return argv;
  try {
    return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0')
      .filter(Boolean);
  } catch {
    // git リポジトリでない（zip で受け取った等）。作業ツリーを直接見る
    return [...walk('.')].map((f) => f.replace(/^\.\//, ''));
  }
}

function head(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(4);
    const n = fs.readSync(fd, b, 0, 4, 0);
    return b.subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const problems = [];
for (const f of files()) {
  if (FORBIDDEN_EXT.test(f)) problems.push(`${f}: 拡張子`);
  else if (FORBIDDEN_NAME.test(f)) problems.push(`${f}: ファイル名`);
  else {
    const h = head(f);
    if (h.equals(ELF)) problems.push(`${f}: 中身が ELF`);
    else if (h.equals(ZIP)) problems.push(`${f}: 中身が ZIP/APK`);
  }
}

if (problems.length) {
  console.error('✗ ゲームのバイナリらしきファイルがあります。リポジトリには解析結果（JSON / Markdown）だけを置いてください。');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('✓ バイナリは含まれていません');
