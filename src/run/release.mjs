import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeZip, collect } from '../util/zip.mjs';
import { readAddon } from '../verify/addon.mjs';
import { currentBranch, remoteSlug, gitReady } from './github.mjs';

const MAX_HISTORY = 40;
const gh = (args, opts = {}) => spawnSync('gh', args, { encoding: 'utf8', ...opts });
const ok = (r) => r.status === 0;
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13);

export function tagFor(branch) {
  return branch === 'main' ? 'template' : `addon-${branch.replace(/^addon\//, '')}`;
}

function assets(tag, ROOT) {
  const r = gh(['release', 'view', tag, '--json', 'assets'], { cwd: ROOT });
  if (!ok(r)) return null;
  try { return JSON.parse(r.stdout).assets.map((a) => a.name); } catch { return []; }
}

function ensureRelease({ ROOT, tag, title, notes }) {
  if (!ok(gh(['--version']))) throw new Error('gh（GitHub CLI）がありません。brew install gh で入れてから、もう一度');
  if (!ok(gh(['auth', 'status']))) throw new Error('GitHub にサインインしていません。gh auth login を実行してください');
  if (assets(tag, ROOT)) {
    gh(['release', 'edit', tag, '--title', title, '--notes', notes], { cwd: ROOT, stdio: 'ignore' });
    return false;
  }
  const r = gh(['release', 'create', tag, '--title', title, '--notes', notes], { cwd: ROOT, stdio: 'inherit' });
  if (!ok(r)) throw new Error(`Release ${tag} を作れませんでした`);
  return true;
}

function upload({ ROOT, tag, files }) {
  const r = gh(['release', 'upload', tag, ...files, '--clobber'], { cwd: ROOT, stdio: 'inherit' });
  if (!ok(r)) throw new Error('ファイルを上げられませんでした');
}

function removeAssets({ ROOT, tag, names }) {
  for (const n of names) gh(['release', 'delete-asset', tag, n, '-y'], { cwd: ROOT, stdio: 'ignore' });
}

async function foldIntoHistory({ ROOT, tag, addName, addFile, say }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-hist-'));
  const stage = path.join(tmp, 'past');
  fs.mkdirSync(stage, { recursive: true });

  const have = assets(tag, ROOT) ?? [];
  if (have.includes('history.zip')) {
    if (ok(gh(['release', 'download', tag, '-p', 'history.zip', '-D', tmp], { cwd: ROOT }))) {
      const { extractZip } = await import('../../tools/bds/get.mjs');
      try { extractZip(path.join(tmp, 'history.zip'), stage); } catch { say('  過去ぶんの zip を読めなかったので作り直します'); }
    }
  }

  fs.copyFileSync(addFile, path.join(stage, addName));

  const kept = fs.readdirSync(stage).sort().reverse().slice(0, MAX_HISTORY);
  for (const f of fs.readdirSync(stage)) if (!kept.includes(f)) fs.rmSync(path.join(stage, f));

  const out = path.join(tmp, 'history.zip');
  const { files, size } = writeZip(out, collect(stage));
  say(`  過去ぶん: ${files} 件（${Math.round(size / 1024)} KB）`);
  return { file: out, count: files, names: kept.sort().reverse() };
}

function notesFor({ branch, addon, latest, history, bdsVersion }) {
  const lines = [];
  if (branch === 'main') {
    lines.push('## 使い方', '');
    lines.push('1. 下の `bds-lab-*.zip` を落とす', '2. その zip を AI に渡す', '3. 作りたいものを日本語で伝える', '');
    lines.push('zip の中の `START_HERE.md` に、AI が従う手順が入っています。', '');
    lines.push(`同梱している Bedrock Dedicated Server: **${bdsVersion ?? '不明'}**`, '');
    lines.push('中身: テンプレート一式・検証の仕組み・skills・公式の型定義・BDS 本体。', '');
    lines.push('※ BDS を同梱しているため、private なリポジトリでのみ使ってください。');
    return lines.join('\n');
  }
  lines.push(`\`${addon}\` の最新の成果物です。更新のたびにここを書き換えます。`, '');
  lines.push('| ファイル | 中身 |', '|---|---|');
  lines.push(`| \`${latest}\` | 最新の .mcaddon |`);
  lines.push(`| \`${addon}-source.zip\` | 最新のソース一式 |`);
  if (history.length) lines.push('| `history.zip` | それまでの .mcaddon（新しい順） |');
  if (history.length) {
    lines.push('', '## これまで', '');
    for (const h of history) lines.push(`- ${h}`);
  }
  return lines.join('\n');
}

export async function publish({ ROOT, addonDir, say = console.log, version = null }) {
  if (!gitReady(ROOT)) throw new Error('git リポジトリではありません');
  if (!ok(gh(['--version']))) throw new Error('gh（GitHub CLI）がありません。brew install gh で入れてください');

  const addon = readAddon(addonDir);
  const branch = currentBranch(ROOT);
  const tag = tagFor(branch);
  const ver = version ?? addon.version.join('.');
  const dist = path.join(ROOT, 'dist');
  fs.mkdirSync(dist, { recursive: true });

  const mcaddon = path.join(dist, `${addon.name}-latest.mcaddon`);
  writeZip(mcaddon, collect(addonDir, addon.name, new Set(['.git', 'node_modules', '.DS_Store', 'TASK.md'])));
  const source = path.join(dist, `${addon.name}-source.zip`);
  writeZip(source, [...collect(addonDir, addon.name), ...collect(path.join(ROOT, 'specs'), 'specs')]);

  const before = assets(tag, ROOT) ?? [];
  const title = `${addon.name} ${ver}`;
  ensureRelease({ ROOT, tag, title, notes: `${title} を準備しています…` });

  let history = { count: 0, names: [] };
  if (before.includes(`${addon.name}-latest.mcaddon`)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-prev-'));
    if (ok(gh(['release', 'download', tag, '-p', `${addon.name}-latest.mcaddon`, '-D', tmp], { cwd: ROOT }))) {
      history = await foldIntoHistory({
        ROOT, tag, say,
        addName: `${addon.name}-${stamp()}.mcaddon`,
        addFile: path.join(tmp, `${addon.name}-latest.mcaddon`),
      });
      upload({ ROOT, tag, files: [history.file] });
    }
  }

  upload({ ROOT, tag, files: [mcaddon, source] });
  removeAssets({ ROOT, tag, names: before.filter((n) => ![`${addon.name}-latest.mcaddon`, `${addon.name}-source.zip`, 'history.zip'].includes(n)) });
  gh(['release', 'edit', tag, '--title', title, '--notes',
    notesFor({ branch, addon: addon.name, latest: path.basename(mcaddon), history: history.names ?? [] })], { cwd: ROOT, stdio: 'ignore' });

  const slug = remoteSlug(ROOT);
  say(`Release ${tag} を更新しました${slug ? `: https://github.com/${slug}/releases/tag/${tag}` : ''}`);
  say(`  最新: ${path.basename(mcaddon)} と ${path.basename(source)}`);
  if (history.count) say(`  過去ぶんは history.zip にまとめました（${history.count} 件）`);
  fs.rmSync(dist, { recursive: true, force: true });
  return { tag, mcaddon, source };
}

export async function publishTemplate({ ROOT, zipFile, bdsVersion, say = console.log }) {
  const tag = 'template';
  const title = `作業用 zip — BDS ${bdsVersion} 同梱`;
  const before = assets(tag, ROOT) ?? [];
  if (before.length === 1 && before[0] === path.basename(zipFile)) {
    const cur = gh(['release', 'view', tag, '--json', 'name', '--jq', '.name'], { cwd: ROOT });
    if (ok(cur) && cur.stdout.trim() === title) { say(`Release ${tag} は最新です（BDS ${bdsVersion}）`); return tag; }
  }
  ensureRelease({ ROOT, tag, title, notes: notesFor({ branch: 'main', bdsVersion, history: [] }) });
  upload({ ROOT, tag, files: [zipFile] });
  removeAssets({ ROOT, tag, names: before.filter((n) => n !== path.basename(zipFile)) });
  gh(['release', 'edit', tag, '--title', title, '--notes', notesFor({ branch: 'main', bdsVersion, history: [] })], { cwd: ROOT, stdio: 'ignore' });
  say(`Release ${tag} を更新しました（${path.basename(zipFile)}）`);
  return tag;
}


const BUNDLE_SKIP = new Set(['.git', 'node_modules', '.DS_Store', '.bds-lab', 'dist', 'worlds', 'target', 'addons', 'src-rust']);

export async function fetchBds({ ROOT, say = console.log }) {
  const { ensureBds, findZip } = await import('../../tools/bds/get.mjs');
  const dest = path.join(ROOT, 'vendor', 'bedrock-server.zip');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    const src = findZip();
    if (src && path.resolve(src) !== dest) fs.copyFileSync(src, dest);
    else await ensureBds({ allowDownload: true, quiet: true });
  }
  if (!fs.existsSync(dest)) throw new Error('BDS の zip を用意できませんでした');

  let version = null;
  // 1) 手元の zip の名前（bedrock-server-1.26.51.1.zip）
  for (const d of [path.join(ROOT, 'vendor'), ROOT]) {
    try {
      const hit = fs.readdirSync(d).map((n) => /bedrock[-_]server-(1\.\d+\.\d+\.\d+)\.zip$/i.exec(n)).find(Boolean);
      if (hit) { version = hit[1]; break; }
    } catch { /* 次へ */ }
  }
  // 2) 展開したフォルダの中の記述（IP などを拾わないよう 1.x に限る）
  if (!version) {
    const dir = await ensureBds({ allowDownload: false, quiet: true }).catch(() => null);
    for (const f of ['release-notes.txt', 'bedrock_server_how_to.html']) {
      if (!dir) break;
      try {
        const m = /\b(1\.\d{1,2}\.\d{1,3}\.\d{1,3})\b/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (m) { version = m[1]; break; }
      } catch { /* 次を見る */ }
    }
  }
  // 3) 同梱の一覧
  if (!version) { const { knownVersions } = await import('../../tools/bds/get.mjs'); version = knownVersions().stable; }
  if (!version) version = 'unknown';
  fs.mkdirSync(path.join(ROOT, '.bds-lab'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.bds-lab', 'bds-version.txt'), version);
  say(`BDS ${version}（${Math.round(fs.statSync(dest).size / 1024 / 1024)}MB）`);
  return { version, zip: dest };
}

export async function bundle({ ROOT, say = console.log }) {
  const { syncTypes } = await import('./docs.mjs');
  await syncTypes({ ROOT, say, force: true });
  const version = (() => {
    try { return fs.readFileSync(path.join(ROOT, '.bds-lab', 'bds-version.txt'), 'utf8').trim(); } catch { return 'unknown'; }
  })();
  const zip = path.join(ROOT, 'vendor', 'bedrock-server.zip');
  if (!fs.existsSync(zip)) throw new Error('vendor/bedrock-server.zip がありません（先に fetch-bds）');

  const entries = collect(ROOT, 'bds-lab', BUNDLE_SKIP).filter((e) => !e.name.includes('/vendor/') || e.name.endsWith('/vendor/bedrock-server.zip'));
  const out = path.join(ROOT, 'dist', `bds-lab-${version}.zip`);
  const { files, size } = writeZip(out, entries);
  say(`${path.relative(ROOT, out)}（${files} ファイル / ${Math.round(size / 1024 / 1024)}MB・BDS ${version} 同梱）`);
  return out;
}
