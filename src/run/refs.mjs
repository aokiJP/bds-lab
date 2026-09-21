import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 600000, ...opts });
const ok = (r) => r.status === 0;

export const SOURCES = [
  {
    id: 'samples',
    repo: 'https://github.com/Mojang/bedrock-samples',
    paths: ['metadata'],
    to: 'refs/vanilla',
    what: 'バニラのメタデータ（ブロック・アイテム・エンティティの正式な ID 一覧）',
  },
  {
    id: 'schemas',
    repo: 'https://github.com/Mojang/bedrock-schemas',
    paths: ['source/behavior'],
    to: 'refs/schemas',
    what: 'ビヘイビアパックの JSON スキーマ（entity / item / block / recipe の書き方）',
  },
  {
    id: 'wiki',
    repo: 'https://github.com/Bedrock-OSS/bedrock-wiki',
    branch: 'wiki',
    paths: ['docs/scripting'],
    to: 'refs/wiki',
    what: '有志の解説（実行環境・モジュール・落とし穴）',
  },
  {
    id: 'libs',
    repo: 'https://github.com/Mojang/minecraft-scripting-libraries',
    paths: ['modules/@minecraft/math', 'modules/@minecraft/vanilla-data'],
    to: 'refs/libs',
    what: 'Mojang 公開のライブラリ（ベクトル計算・ID の列挙型）',
  },
  {
    id: 'docs',
    repo: 'https://github.com/MicrosoftDocs/minecraft-creator',
    paths: ['creator/ScriptAPI', 'creator/Documents'],
    to: 'refs/docs',
    what: '公式ドキュメントの原文（ScriptAPI のリファレンスと解説。learn.microsoft.com の元）',
  },
  {
    id: 'samples-script',
    repo: 'https://github.com/microsoft/minecraft-scripting-samples',
    paths: ['ts-starter', 'script-box', 'howto-gallery'],
    to: 'refs/samples',
    what: '公式のサンプル（動く最小構成・書き方の見本）',
  },
  {
    id: 'gametests',
    repo: 'https://github.com/microsoft/minecraft-gametests',
    paths: ['behavior_packs'],
    to: 'refs/gametests',
    what: '公式の GameTest 集（SimulatedPlayer の使い方の実例）',
  },
];

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else if (/\.(json|md|ts|js)$/i.test(e.name) && fs.statSync(a).size < 4 * 1024 * 1024) fs.copyFileSync(a, b);
  }
};

const dirSize = (d) => {
  let n = 0;
  const walk = (x) => {
    for (const e of fs.readdirSync(x, { withFileTypes: true })) {
      const p = path.join(x, e.name);
      if (e.isDirectory()) walk(p); else n += fs.statSync(p).size;
    }
  };
  try { walk(d); } catch { /* 無ければ 0 */ }
  return n;
};

/** 公式と有志の一次資料を取り込む。BP に要るものだけ。ネットと git が要る */
export async function syncRefs({ ROOT, only = null, say = console.log }) {
  if (!ok(run('git', ['--version']))) throw new Error('git がありません');
  const done = [];
  for (const src of SOURCES) {
    if (only && src.id !== only) continue;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `refs-${src.id}-`));
    try {
      say(`  ${src.id}: ${src.what}`);
      const args = ['clone', '--depth', '1', '--filter=blob:none', '--sparse'];
      if (src.branch) args.push('--branch', src.branch);
      args.push(src.repo, tmp);
      if (!ok(run('git', args, { stdio: 'ignore' }))) { say('    取れませんでした（あとで npm run refs）'); continue; }
      if (!ok(run('git', ['sparse-checkout', 'set', ...src.paths], { cwd: tmp, stdio: 'ignore' }))) { say('    中身を絞れませんでした'); continue; }

      const dest = path.join(ROOT, src.to);
      fs.rmSync(dest, { recursive: true, force: true });
      for (const p of src.paths) {
        const from = path.join(tmp, p);
        if (fs.existsSync(from)) copyDir(from, path.join(dest, path.basename(p)));
      }
      const mb = (dirSize(dest) / 1024 / 1024).toFixed(1);
      fs.writeFileSync(path.join(dest, 'SOURCE.txt'), `${src.repo}\n取り込み: ${new Date().toISOString()}\n`);
      say(`    ${src.to}（${mb}MB）`);
      done.push(src.id);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (done.length) {
    const idx = [
      '# refs — 公式と有志の一次資料（ビヘイビアパック用）',
      '',
      'すべて自動で取り込んだものです。編集しないでください（`npm run refs` で入れ直ります）。',
      '',
      '| 場所 | 中身 | 出どころ |',
      '|---|---|---|',
      ...SOURCES.map((s) => `| \`${s.to}\` | ${s.what} | ${s.repo} |`),
      '',
      '## 使いどころ',
      '',
      '- ID を書くとき: `refs/vanilla/metadata/vanilladata_modules/mojang-blocks.json` などに正式な名前がある',
      '- BP の JSON を書くとき: `refs/schemas/behavior/` に書式がある。手で思い出さない',
      '- 挙動が分からないとき: `refs/wiki/scripting/` を引く',
      '- ベクトル計算と ID 列挙: `refs/libs/` に実装がある',
    ].join('\n');
    fs.writeFileSync(path.join(ROOT, 'refs', 'README.md'), `${idx}\n`);
  }
  return done;
}
