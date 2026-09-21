import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { setupRepo, gitReady, remoteSlug, currentBranch, conflicted, ghAvailable } from './github.mjs';
import { dependencies as deps } from '../util/modules.mjs';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const which = (bin) => run(process.platform === 'win32' ? 'where' : 'which', [bin]).status === 0;
const snake = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** アドオンの入れ物かどうか。雛形（manifest.json 直置き）と、取り込んだ形（behavior_pack/）の両方を見る */
export function isAddonDir(dir) {
  return fs.existsSync(path.join(dir, 'manifest.json'))
    || ['behavior_pack', 'behavior', 'bp'].some((n) => fs.existsSync(path.join(dir, n, 'manifest.json')));
}

export function listAddons(ROOT) {
  const dir = path.join(ROOT, 'addons');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => !n.startsWith('_') && isAddonDir(path.join(dir, n)));
}

export function scaffold({ ROOT, name, description = '', say = console.log, bds = null, preview = false, beta = true }) {
  const id = snake(name);
  if (!id) throw new Error('名前は英数字で指定してください（例: free_camera）');
  const addonDir = path.join(ROOT, 'addons', id);
  if (fs.existsSync(addonDir)) return { id, addonDir, existed: true };

  const vars = {
    __NAME__: name,
    __DESCRIPTION__: description || name,
    __UUID1__: crypto.randomUUID(),
    __UUID2__: crypto.randomUUID(),
    __NS__: id.slice(0, 12),
    __TAG__: id.toUpperCase().slice(0, 12),
  };
  const fill = (s) => Object.entries(vars).reduce((a, [k, v]) => a.split(k).join(v), s);
  const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, fill(fs.readFileSync(from, 'utf8'))); };

  const T = path.join(ROOT, 'templates');
  for (const rel of ['manifest.json', 'lab.json', 'scripts/main.js', 'scripts/config.js', 'scripts/lab.js']) copy(path.join(T, 'addon', rel), path.join(addonDir, rel));
  {
    const f = path.join(addonDir, 'manifest.json');
    const mf = JSON.parse(fs.readFileSync(f, 'utf8'));
    mf.dependencies = deps({ beta, ui: true, gametest: false });
    fs.writeFileSync(f, `${JSON.stringify(mf, null, 2)}\n`);
  }
  copy(path.join(T, 'specs', 'example.spec.mjs'), path.join(ROOT, 'specs', `${id}.spec.mjs`));
  copy(path.join(T, 'TASK.md'), path.join(addonDir, 'TASK.md'));
  if (bds || preview) {
    const f = path.join(addonDir, 'lab.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (bds) j.bds = bds;
    j.preview = Boolean(preview);
    j.beta = Boolean(beta);
    fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
  }
  say(`  雛形を作りました: addons/${id}/ と specs/${id}.spec.mjs`);
  return { id, addonDir, existed: false };
}

export async function ensureBdsZip({ ROOT, say = console.log }) {
  const dest = path.join(ROOT, 'vendor', 'bedrock-server.zip');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024 * 1024) return dest;

  const { findZip, zipKind, ensureBds } = await import('../../tools/bds/get.mjs');
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const src = findZip();
  if (src && path.resolve(src) !== dest) {
    say(`  BDS の zip をリポジトリに置きます（${path.basename(src)}）…`);
    fs.copyFileSync(src, dest);
    return dest;
  }
  if (!fs.existsSync(dest)) {
    say('  BDS の zip が手元に無いので取ってきます…');
    await ensureBds({ allowDownload: true, quiet: true });
  }
  if (!fs.existsSync(dest)) { say('  BDS の zip を用意できませんでした（CI は動かせません）'); return null; }
  if (zipKind(dest) && zipKind(dest) !== 'linux') say('  置いた zip が Linux 版ではありません。CI では Linux 版が要ります');
  return dest;
}

function pinnedVersion(ROOT, name) {
  const id = name ? snake(name) : listAddons(ROOT)[0];
  if (!id) return null;
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'addons', id, 'lab.json'), 'utf8')); } catch { return null; }
}

export async function ensureProject({ ROOT, name = null, description = '', say = console.log, github = true, bdsPin = null, preview = false }) {
  const steps = [];

  const { ensureBds, ensureBdsVersion, knownVersions } = await import('../../tools/bds/get.mjs');
  const wanted = pinnedVersion(ROOT, name);
  let bds;
  if (wanted && wanted.bds !== 'stable') {
    const known = knownVersions();
    const ver = wanted.bds === 'preview' ? known.preview : wanted.bds;
    if (!ver) throw new Error('その版が分かりません（lab.json の bds を確かめてください）');
    bds = await ensureBdsVersion({ root: ROOT, version: ver, preview: wanted.preview || wanted.bds === 'preview', say });
    steps.push(`BDS: ${ver}（指定）`);
  } else {
    bds = await ensureBds({ allowDownload: true });
    if (!bds) throw new Error('BDS を用意できませんでした。bedrock-server-*.zip を ~/Downloads に置いて、もう一度実行してください');
    steps.push(`BDS: ${bds}`);
  }

  const zip = await ensureBdsZip({ ROOT, say });
  if (zip) steps.push(`同梱: vendor/bedrock-server.zip（${Math.round(fs.statSync(zip).size / 1024 / 1024)}MB）`);

  const { syncTypes, haveTypes } = await import('./docs.mjs');
  await syncTypes({ ROOT, say });
  if (haveTypes(ROOT)) steps.push('公式の型定義: types/minecraft/');

  const existing = listAddons(ROOT);
  const target = name ? snake(name) : existing[0];
  if (!target) throw new Error('アドオンがありません。名前を付けて作ってください: node bin/bds-lab.mjs init <名前>');
  const project = scaffold({ ROOT, name: name ?? target, description, say, bds: bdsPin, preview });
  steps.push(`アドオン: addons/${project.id}`);

  let repo = null;
  if (github) {
    const repoName = path.basename(ROOT);
    const branch = `addon/${project.id}`;
    const already = gitReady(ROOT) && currentBranch(ROOT) === branch;
    if (already && remoteSlug(ROOT)) {
      repo = { slug: remoteSlug(ROOT), url: `https://github.com/${remoteSlug(ROOT)}`, branch };
    } else if (already && !ghAvailable()) {
      // gh が無いオフライン環境。前回すでに手元の git だけで枝を切ってあるので、毎回 setupRepo をやり直さない
      repo = { slug: null, url: null, branch, local: true };
    } else {
      repo = await setupRepo({ ROOT, repoName, branch, say });
    }
    steps.push(repo.url ? `GitHub: ${repo.url}（枝 ${repo.branch}）` : 'GitHub: 使いません（gh かネットワークが無いので、手元の git だけで進めます）');
  }

  return { ...project, bds, repo, steps };
}

export async function init({ ROOT, name, description, say, github = true, bdsPin = null, preview = false }) {
  say('用意しています…');
  const r = await ensureProject({ ROOT, name, description, say, github, bdsPin, preview });
  say('');
  for (const s of r.steps) say(`  ✓ ${s}`);
  say('');
  say('次にすること');
  say(`  1. addons/${r.id}/TASK.md に「できた」と言える条件を書く`);
  say(`  2. node bin/bds-lab.mjs dev        実機を上げたまま、保存のたびに検証する`);
  say(`  3. node bin/bds-lab.mjs ship       できたら .mcaddon にして Release に上げる`);
  return r;
}


async function ask(question, fallback = '') {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim() || fallback; }
  catch { return fallback; }
  finally { rl.close(); }
}

const TASK_TEMPLATE = (name, want) => `# 依頼書 — ${name}

## 作るもの

${want}

## 受け入れ条件

- [ ] （AI がここを、実機で確かめられる形に書き直します）

## やってはいけないこと

- 仕様書（specs/）を、通すために緩めること
`;

function taskIsEmpty(body) {
  return !body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#.*$/gm, '')
    .replace(/^- \[ \].*$/gm, '')
    .trim();
}

export async function start({ ROOT, say, github = true, run, want: givenWant = null, name: givenName = null, bdsPin = null, preview = false }) {
  const stuck = gitReady(ROOT) ? conflicted(ROOT) : [];
  if (stuck.length) {
    say('前回の合流あとが残っていたので、片づけます。');
    spawnSync('git', ['merge', '--abort'], { cwd: ROOT });
    spawnSync('git', ['rebase', '--abort'], { cwd: ROOT });
    spawnSync('git', ['checkout', '--', '.'], { cwd: ROOT });
  }

  let addons = listAddons(ROOT);
  let id = addons[0];

  if (!id) {
    say('はじめまして。これから、あなたのアドオンを AI が作ります。');
    say('');
    const want = givenWant ?? await ask('何を作りますか（日本語でどうぞ）> ', '');
    if (!want) { say('何を作るか教えてください: npm start -- --want "スペクテイターで自由に飛べるカメラ"'); return { done: false }; }
    const suggested = want.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase().slice(0, 16).replace(/^_|_$/g, '') || 'my_addon';
    const name = givenName ?? await ask(`名前（英数字。Enter で ${suggested}）> `, suggested);
    const project = await init({ ROOT, name, description: want, say, github, bdsPin, preview });
    fs.writeFileSync(path.join(project.addonDir, 'TASK.md'), TASK_TEMPLATE(project.id, want));
    id = project.id;
    say('');
    say(`やりたいことを addons/${id}/TASK.md に書きました。ここから先は自動です。`);
  } else {
    const task = path.join(ROOT, 'addons', id, 'TASK.md');
    const body = fs.existsSync(task) ? fs.readFileSync(task, 'utf8') : '';
    if (taskIsEmpty(body)) {
      const want = givenWant ?? await ask('何を作りますか（日本語でどうぞ）> ', '');
      if (!want) { say(`${path.relative(ROOT, task)} に書いてから、もう一度 npm start を実行してください。`); return { done: false }; }
      fs.writeFileSync(task, TASK_TEMPLATE(id, want));
    }
  }

  say('');
  say(`${id} を作ります。AI が書き、実機で確かめ、直します。通るまで繰り返します。`);
  return run(id);
}

export async function doctor({ ROOT, say }) {
  const line = (good, label, hint) => say(`${good ? '✓' : '×'} ${label}${!good && hint ? ` → ${hint}` : ''}`);
  line(Number(process.versions.node.split('.')[0]) >= 20, `Node ${process.versions.node}`, '20 以上にしてください');

  const { chooseRuntime, diagnose } = await import('../../tools/bds/launch.mjs');
  for (const d of diagnose().checks) line(d.ok, d.label, d.hint);

  const zip = path.join(ROOT, 'vendor', 'bedrock-server.zip');
  line(fs.existsSync(zip), `BDS の zip${fs.existsSync(zip) ? `（${Math.round(fs.statSync(zip).size / 1024 / 1024)}MB）` : ''}`, 'npm start で用意します');
  const { haveTypes } = await import('./docs.mjs');
  const types = haveTypes(ROOT);
  line(types, `公式の型定義（types/minecraft/）${types ? '' : '（AI が API を記憶で書かないために要ります）'}`, 'npm run docs');
  const realDep = fs.existsSync(path.join(ROOT, 'node_modules', 'bedrock-protocol'));
  line(realDep, `bedrock-protocol${realDep ? '' : '（real のときだけ要ります。無ければ real は飛ばします）'}`, null);
  line(which('git'), 'git', 'xcode-select --install');
  line(which('gh'), 'gh（GitHub CLI）', 'brew install gh');
  const ai = ['claude', 'codex', 'gemini'].filter(which);
  line(ai.length > 0, `AI の CLI${ai.length ? `: ${ai.join(' / ')}` : ''}`, 'auto を使うときだけ要ります');
  const addons = listAddons(ROOT);
  line(addons.length > 0, `アドオン${addons.length ? `: ${addons.join(' / ')}` : ''}`, 'npm start で作ります');
  const lfs = which('git-lfs') || spawnSync('git', ['lfs', 'version']).status === 0;
  const zipMb = fs.existsSync(zip) ? fs.statSync(zip).size / 1024 / 1024 : 0;
  if (zipMb > 45) line(lfs, 'git-lfs（45MB を超える実機を GitHub に載せるのに要ります）', 'brew install git-lfs（無ければ実機は載せず、手元の検証だけになります）');
  const stuck = gitReady(ROOT) ? conflicted(ROOT) : [];
  line(stuck.length === 0, '合流あとの残り', 'npm start が片づけます');
  const age = (f) => { try { return Math.floor((Date.now() - fs.statSync(path.join(ROOT, 'data', f)).mtimeMs) / 86400000); } catch { return null; } };
  const days = Math.max(age('minecraft-modules.json') ?? 0, age('bds-versions.json') ?? 0);
  line(days < 30, `版の一覧（${days} 日前）`, 'npm run update で取り直せます');
  say(`  起動方法: ${chooseRuntime()}`);
  say('  実機なしの自己点検: npm run selftest');
}
