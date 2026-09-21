import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { moduleData, npmSpec } from '../util/modules.mjs';
import { pickFromTgz } from '../util/tar.mjs';

const MODULES = ['server', 'server-ui', 'server-gametest'];
const which = (b) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [b]).status === 0;

export const LINKS = [
  ['公式のリファレンス', 'https://learn.microsoft.com/minecraft/creator/scriptapi/'],
  ['版ごとの対応表', 'https://learn.microsoft.com/minecraft/creator/documents/scripting/versioning'],
  ['2.x での変更点', 'https://learn.microsoft.com/minecraft/creator/documents/scripting/v2-overview'],
  ['実行環境で使えるもの', 'https://wiki.bedrock.dev/scripting/api-environment'],
  ['版ごとの型定義（非公式のまとめ）', 'https://jaylydev.github.io/scriptapi-docs/'],
];

export function typeDir(ROOT) { return path.join(ROOT, 'types', 'minecraft'); }

export function haveTypes(ROOT) {
  return fs.existsSync(path.join(typeDir(ROOT), 'server.d.ts'));
}

/** 何が悪かったのかを、そのまま読める形で 1 行にする（前は「失敗」としか出なかった） */
export function whyFailed(r) {
  if (r.error) return r.error.code === 'ETIMEDOUT' ? '時間切れ' : String(r.error.message ?? r.error);
  const text = `${r.stderr ?? ''}\n${r.stdout ?? ''}`;
  const line = text.split('\n')
    .map((l) => l.trim())
    .find((l) => /ERR_PNPM|npm error|ERR!|ENOTFOUND|ETARGET|EACCES|E40\d|ECONNREFUSED|ERR_/.test(l));
  return (line ?? text.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '失敗').slice(0, 160);
}

function target(name) {
  const v = moduleData()[name]?.versions?.beta;
  if (!v?.version) return null;
  const url = v.download ?? `https://registry.npmjs.org/@minecraft/${name}/-/${name}-${v.version}.tgz`;
  return { name, version: v.version, url };
}

/** npm も pnpm も通さずに型定義を取りに行く。ワークスペースや lockfile の事情に左右されない */
async function fromRegistry({ ROOT, say }) {
  const dir = typeDir(ROOT);
  fs.mkdirSync(dir, { recursive: true });
  const done = [];
  const failed = [];
  const got = [];
  for (const t of MODULES.map(target).filter(Boolean)) {
    try {
      const res = await fetch(t.url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = pickFromTgz(Buffer.from(await res.arrayBuffer()), 'index.d.ts');
      if (!body) throw new Error('index.d.ts が入っていません');
      fs.writeFileSync(path.join(dir, `${t.name}.d.ts`), body);
      got.push(t);
      done.push(`${t.name}.d.ts（@minecraft/${t.name} ${t.version}）`);
    } catch (e) {
      failed.push(`${t.name}: ${String(e.message ?? e)}`);
    }
  }
  if (got.length) {
    // どの版の型定義なのかを残す。実機の版と食い違ったときに、ここを見れば分かる
    fs.writeFileSync(path.join(dir, 'VERSIONS.md'), [
      '# 同梱している型定義の版',
      '',
      `取り込み: ${new Date().toISOString()}`,
      '',
      '| ファイル | モジュール | 版 |',
      '|---|---|---|',
      ...got.map((t) => `| \`${t.name}.d.ts\` | \`@minecraft/${t.name}\` | ${t.version} |`),
      '',
      'ここに無い API は、この版に無いか、名前が違います。`.bds-lab/api.json`（実機に実在するもの）と突き合わせてください。',
      '',
    ].join('\n'));
  }
  return { done, failed };
}

/** 取りに行けないときの逃げ道。npm を ROOT に固定して入れる（親の pnpm ワークスペースに吸われないため） */
function fromPackageManager({ ROOT, say }) {
  const specs = MODULES.map((n) => npmSpec(n, 'beta')).filter(Boolean);
  if (!specs.length) return null;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (!which('npm')) return null;
  say('  npm で入れ直してみます…');
  const r = spawnSync(npm, [
    'install', '--prefix', ROOT, '--no-save', '--ignore-scripts',
    '--no-audit', '--no-fund', '--loglevel', 'error', ...specs,
  ], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  if (r.status !== 0) { say(`  npm でも入りませんでした（${whyFailed(r)}）`); return null; }
  const dir = typeDir(ROOT);
  fs.mkdirSync(dir, { recursive: true });
  const done = [];
  for (const n of MODULES) {
    const from = path.join(ROOT, 'node_modules', '@minecraft', n, 'index.d.ts');
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(dir, `${n}.d.ts`));
    done.push(`${n}.d.ts`);
  }
  return done.length ? done : null;
}

// 1 回の実行の中で、取れなかったことを覚えておく。
// ensureProject と ensureMaterials の両方から呼ばれるので、覚えないと同じ失敗を 2 度出す。
let gaveUp = false;

/**
 * 公式の型定義を types/minecraft/ に置く。
 * force（npm run docs）のときだけ、registry が駄目でも npm で入れ直しに行く。
 * 普段の呼び出しは HTTP を 3 回叩くだけで、失敗しても足を止めない。
 */
export async function syncTypes({ ROOT, say = console.log, force = false }) {
  if (haveTypes(ROOT) && !force) return typeDir(ROOT);
  if (gaveUp && !force) { say('  公式の型定義はまだありません（npm run docs で入れ直せます）'); return null; }
  say('  公式の型定義（@minecraft/server ほか）を入れています…');

  const { done, failed } = await fromRegistry({ ROOT, say });
  if (done.length) {
    say(`  ${done.join(' / ')}`);
    if (failed.length) say(`  入らなかったもの: ${failed.join(' / ')}`);
    return typeDir(ROOT);
  }

  say(`  取りに行けませんでした（${failed[0] ?? '理由不明'}）`);
  if (force) {
    const fallback = fromPackageManager({ ROOT, say });
    if (fallback) { say(`  ${fallback.join(' / ')}`); return typeDir(ROOT); }
  }

  gaveUp = true;
  say('  型定義は入れられませんでした。ネットワークに出られるところで npm run docs を実行してください');
  say(`  手で入れるなら: ${MODULES.map(target).filter(Boolean)[0]?.url ?? 'https://registry.npmjs.org/@minecraft/server'}`);
  return null;
}
