#!/usr/bin/env node
// bedrock-binary — Bedrock のバイナリから、公式メタデータに無い定義を復元する
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from './commands/index.js';
import { installErrorHandler, requireNode, PreflightError } from './lib/preflight.js';
import { parseArgs } from './lib/args.js';
import { resolveDirs } from './lib/store.js';
import { padDisplay } from './lib/text.js';

installErrorHandler();
requireNode(20);

const [, , cmd, ...rest] = process.argv;
const { args, flags } = parseArgs(rest);

function help() {
  console.log('bedrock-binary — Minecraft Bedrock のバイナリ解析\n');
  console.log('使い方: npm run bb -- <コマンド> [引数]   （または node src/cli.js <コマンド>）\n');
  let group = null;
  for (const c of Object.values(COMMANDS)) {
    if (c.group !== group) {
      group = c.group;
      console.log(`${group}`);
    }
    console.log(`  ${padDisplay(c.usage, 58)} ${c.summary}`);
  }
  console.log('\n共通オプション: --work DIR  --profiles DIR  --reports DIR');
  console.log('詳しい使い方:   npm run bb -- <コマンド> --help');
  console.log('\nまずは:');
  console.log('  npm run doctor     動かす準備ができているか確認');
  console.log('  npm start          最新の BDS を取得して、site/index.html まで作る');
}

function commandHelp(c) {
  console.log(`使い方: npm run bb -- ${c.usage}\n\n  ${c.summary}`);
  if (c.example) console.log(`\n例:\n  npm run bb -- ${c.example}`);
}

/**
 * 大きなバイナリを読むコマンドは、Node の既定のヒープでは足りないことがある。
 * 利用者が node の起動オプションを知らなくても済むよう、必要なら自分を上限つきで起動し直す。
 */
function relaunchWithHeapIfNeeded() {
  const already = process.execArgv.some((a) => a.startsWith('--max-old-space-size')) ||
    /--max-old-space-size/.test(process.env.NODE_OPTIONS ?? '') ||
    process.env.BB_RELAUNCHED === '1';
  if (already) return false;
  const mb = Math.max(2048, Math.min(6144, Math.floor((os.totalmem() / 1024 ** 2) * 0.75)));
  const r = spawnSync(process.execPath, [`--max-old-space-size=${mb}`, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, BB_RELAUNCHED: '1' },
  });
  process.exit(r.status ?? 1);
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  help();
  process.exit(cmd ? 0 : 1);
}

const entry = COMMANDS[cmd];
if (!entry) {
  const near = Object.keys(COMMANDS).filter((k) => k.startsWith(cmd.slice(0, 2)));
  throw new PreflightError(`知らないコマンドです: ${cmd}`, near.length ? `もしかして: ${near.join(', ')}` : '`npm run bb -- help` で一覧を表示します。');
}
if (flags.help) {
  commandHelp(entry);
  process.exit(0);
}
if (args.length < (entry.minArgs ?? 0)) {
  throw new PreflightError('引数が足りません', `使い方: npm run bb -- ${entry.usage}`);
}
if (entry.heavy) relaunchWithHeapIfNeeded();

await entry.run({ args, flags, dirs: resolveDirs(flags) });
