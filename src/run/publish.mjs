import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readAddon } from '../verify/addon.mjs';
import { writeZip, collect } from '../util/zip.mjs';
import { currentBranch, gitReady } from './github.mjs';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const ok = (r) => r.status === 0;
const out = (r) => (r.stdout ?? '').trim();

const FORBIDDEN = [/bedrock[-_]server/i, /vendor\//, /bds[-_]?lab/i];

function report(ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.bds-lab', 'report.json'), 'utf8')); } catch { return null; }
}

function readme({ addon, task, rep }) {
  const lines = [`# ${addon.name}`, '', addon.manifest.header.description ?? '', ''];
  if (task) {
    const body = task.replace(/^#.*$/m, '').replace(/## やってはいけないこと[\s\S]*/, '').trim();
    if (body) lines.push(body, '');
  }
  lines.push('## 入れ方', '', '`.mcaddon` を開くか、ワールドの `behavior_packs/` に入れてください。', '');
  const dep = addon.manifest.dependencies ?? [];
  if (dep.length) {
    lines.push('## 必要なもの', '');
    for (const d of dep) lines.push(`- ${d.module_name} ${d.version}`);
    if (dep.some((d) => String(d.version).includes('beta'))) lines.push('- ワールド設定で Beta APIs を有効にしてください');
    lines.push('');
  }
  if (rep?.results?.length) {
    lines.push('## 実機で確かめたこと', '');
    lines.push(`Bedrock Dedicated Server ${rep.version ?? ''} で ${rep.passed}/${rep.total} 項目を自動検証しています。`, '');
    for (const r of rep.results) lines.push(`- ${r.ok ? '✓' : '×'} ${r.name}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function publish({ ROOT, addonDir, say = console.log, name = null, yes = false }) {
  if (!gitReady(ROOT)) throw new Error('git リポジトリではありません');
  if (!ok(run('gh', ['--version']))) throw new Error('gh（GitHub CLI）がありません。brew install gh で入れてください');

  const addon = readAddon(addonDir);
  const branch = currentBranch(ROOT);
  const repoName = name ?? addon.name.replace(/_/g, '-');
  const rep = report(ROOT);

  if (rep && !rep.ok && !yes) {
    throw new Error(`実機の検証が ${rep.passed}/${rep.total} です。通してから公開するか、--yes を付けてください`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-pub-'));
  const packDir = path.join(tmp, addon.name);
  fs.mkdirSync(packDir, { recursive: true });
  for (const [rel, body] of Object.entries(addon.files)) {
    if (rel === 'TASK.md' || rel === 'lab.json') continue;
    const p = path.join(packDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }

  const taskFile = path.join(addonDir, 'TASK.md');
  fs.writeFileSync(path.join(tmp, 'README.md'), readme({
    addon, rep,
    task: fs.existsSync(taskFile) ? fs.readFileSync(taskFile, 'utf8') : null,
  }));
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'dist/\n');
  writeZip(path.join(tmp, `${addon.name}.mcaddon`), collect(packDir, addon.name));

  // 公開してはいけないものが紛れていないか、名前と中身の両方で確かめる
  const files = collect(tmp);
  for (const f of files) {
    if (FORBIDDEN.some((re) => re.test(f.name))) throw new Error(`公開できないものが入っています: ${f.name}`);
    if (fs.statSync(f.abs).size > 20 * 1024 * 1024) throw new Error(`大きすぎるファイルがあります: ${f.name}`);
  }
  say(`公開する中身: ${files.length} ファイル（BDS は入っていません）`);

  run('git', ['init', '-b', 'main'], { cwd: tmp });
  run('git', ['add', '-A'], { cwd: tmp });
  run('git', ['-c', 'user.email=bds-lab@local', '-c', 'user.name=bds-lab', 'commit', '-q', '-m', `${addon.name} を公開`], { cwd: tmp });

  const user = out(run('gh', ['api', 'user', '--jq', '.login']));
  const slug = `${user}/${repoName}`;
  if (ok(run('gh', ['repo', 'view', slug]))) {
    run('git', ['remote', 'add', 'origin', `https://github.com/${slug}.git`], { cwd: tmp });
    if (!ok(run('git', ['push', '--force-with-lease', '-u', 'origin', 'main'], { cwd: tmp, stdio: 'inherit' }))) {
      throw new Error(`${slug} に push できませんでした`);
    }
    say(`すでにある公開リポジトリを更新しました: https://github.com/${slug}`);
  } else {
    if (!ok(run('gh', ['repo', 'create', repoName, '--public', '--source', tmp, '--remote', 'origin', '--push'], { cwd: tmp, stdio: 'inherit' }))) {
      throw new Error('公開リポジトリを作れませんでした');
    }
    say(`公開しました: https://github.com/${slug}`);
  }

  const asset = path.join(tmp, `${addon.name}.mcaddon`);
  const tag = `v${addon.version.join('.')}`;
  if (ok(run('gh', ['release', 'view', tag, '--repo', slug]))) {
    run('gh', ['release', 'upload', tag, asset, '--clobber', '--repo', slug], { stdio: 'inherit' });
  } else {
    run('gh', ['release', 'create', tag, asset, '--repo', slug, '--title', tag, '--generate-notes'], { stdio: 'inherit' });
  }

  say(`  枝 ${branch} の中身だけを出しました。BDS も検証の仕組みも入っていません`);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { slug, url: `https://github.com/${slug}` };
}
