import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const ok = (r) => r.status === 0;
const out = (r) => (r.stdout ?? '').trim();
const git = (ROOT, ...a) => run('git', a, { cwd: ROOT });

export const gitReady = (ROOT) => ok(git(ROOT, 'rev-parse', '--is-inside-work-tree'));
export const currentBranch = (ROOT) => out(git(ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'));
export function remoteSlug(ROOT) {
  const url = out(git(ROOT, 'remote', 'get-url', 'origin'));
  return (url.match(/github\.com[:/](.+?)(?:\.git)?$/) ?? [])[1] ?? null;
}

export function conflicted(ROOT) {
  if (!gitReady(ROOT)) return [];
  return out(git(ROOT, 'diff', '--name-only', '--diff-filter=U')).split('\n').filter(Boolean);
}

function ensureIgnore(ROOT, say) {
  const gi = path.join(ROOT, '.gitignore');
  const body = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  // vendor/ だとフォルダごと外れて !vendor/... が効かない（git の決まり）。vendor/* にする
  const lines = body.split('\n');
  const fixed = lines.map((l) => (l.trim() === 'vendor/' ? 'vendor/*' : l));
  const need = ['node_modules/', 'vendor/*', '!vendor/bedrock-server.zip', 'worlds/', 'dist/', '.bds-lab/', '.DS_Store'];
  const missing = need.filter((n) => !fixed.includes(n));
  const next = `${[...fixed, ...missing].join('\n').trimEnd()}\n`;
  if (next !== body) fs.writeFileSync(gi, next);
}

function addBds(ROOT, say) {
  const rel = 'vendor/bedrock-server.zip';
  if (!fs.existsSync(path.join(ROOT, rel))) { say('  BDS の zip がありません。CI は動きません'); return; }
  const mb = Math.round(fs.statSync(path.join(ROOT, rel)).size / 1024 / 1024);
  const lfs = ok(run('git', ['lfs', 'version']));
  if (mb > 45 && lfs) {
    git(ROOT, 'lfs', 'install', '--local');
    git(ROOT, 'lfs', 'track', rel);
    git(ROOT, 'add', '.gitattributes');
    say(`  BDS（${mb}MB）は Git LFS に載せます`);
  } else if (mb > 45) {
    // LFS 無しで載せると GitHub に警告され、履歴から消せない塊が残る（100MB で拒否される）。
    // CI が使えないだけで手元の検証には要らないので、載せずに進める。
    git(ROOT, 'rm', '--cached', '-q', '--ignore-unmatch', rel);
    say(`  BDS（${mb}MB）は載せません。GitHub の上限に近く、履歴から消せなくなるためです`);
    say('    GitHub 上の CI でも動かすなら: brew install git-lfs して、もう一度');
    return;
  }
  git(ROOT, 'add', '-f', rel);
  say(`  BDS（${mb}MB）も一緒に置きます。private なので外には出ません`);
}

const BDS = 'vendor/bedrock-server.zip';

/**
 * 載せないと決めた実機を、コミットから外す。
 * .gitignore の `!vendor/bedrock-server.zip` は info/exclude より強いので、無視の指定では外せない。
 * 45MB を超えていて git-lfs が無いときだけ外す（GitHub の上限に近く、履歴から消せなくなるため）。
 */
function tooBigForGit(ROOT) {
  try {
    if (fs.statSync(path.join(ROOT, BDS)).size <= 45 * 1024 * 1024) return false;
  } catch { return false; }
  return !ok(run('git', ['lfs', 'version']));
}

export function commitAll(ROOT, message, { exclude = [] } = {}) {
  git(ROOT, 'add', '-A');
  for (const e of [...exclude, ...(tooBigForGit(ROOT) ? [BDS] : [])]) git(ROOT, 'reset', '-q', '--', e);
  if (!out(git(ROOT, 'diff', '--cached', '--name-only'))) return false;
  run('git', ['-c', 'user.email=bds-lab@local', '-c', 'user.name=bds-lab', 'commit', '-q', '-m', message], { cwd: ROOT, stdio: 'inherit' });
  return true;
}

function specExclude(ROOT) {
  const dir = path.join(ROOT, 'specs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.spec.mjs') && !f.startsWith('_')).map((f) => `specs/${f}`);
}

const MARK = 'BDS_LAB';

// この道具が作ったリポジトリかどうか。印（variable）か、中身（bin/bds-lab.mjs）で見分ける。
// 印が無い古いものも拾えるようにしてある。同じ名前のリポジトリが増えないための肝。
function isOurs(slug) {
  if (ok(run('gh', ['variable', 'get', MARK, '--repo', slug]))) return true;
  return ok(run('gh', ['api', `repos/${slug}/contents/bin/bds-lab.mjs`, '--jq', '.name']));
}

function claim(slug) {
  run('gh', ['variable', 'set', MARK, '--body', '1', '--repo', slug], { stdio: 'ignore' });
}

function freeName(user, base, say) {
  for (let i = 0; i < 50; i++) {
    const name = i === 0 ? base : `${base}-${i + 1}`;
    const view = run('gh', ['repo', 'view', `${user}/${name}`, '--json', 'isPrivate']);
    if (!ok(view)) return { name, exists: false };
    if (isOurs(`${user}/${name}`)) return { name, exists: true };
    say?.(`  ${user}/${name} は別のものなので使いません`);
  }
  throw new Error('使える名前が見つかりませんでした');
}

// 合流はしない。手元の中身が正で、リモートは写し。衝突を作らないための決めごと。
function push(ROOT, branch, { force = false } = {}) {
  if (force) run('git', ['fetch', 'origin', branch], { cwd: ROOT, stdio: 'ignore' });
  const args = ['push', '-u', 'origin', `HEAD:${branch}`];
  if (force) args.splice(1, 0, '--force');
  const r = run('git', args, { cwd: ROOT, stdio: 'inherit' });
  return ok(r);
}

export const ghAvailable = () => ok(run('gh', ['--version']));

// ローカルの git だけを整える（ネットワークも gh も要らない）。GitHub 連携の前提として毎回通す。
function prepareLocal(ROOT, say) {
  if (!ok(run('git', ['--version']))) throw new Error('git がありません（macOS なら xcode-select --install）');
  if (!gitReady(ROOT)) { git(ROOT, 'init', '-b', 'main'); say('  git リポジトリにしました'); }
  const stuck = conflicted(ROOT);
  if (stuck.length) {
    git(ROOT, 'merge', '--abort');
    git(ROOT, 'rebase', '--abort');
    say('  前回の合流あとを片づけました');
  }
  ensureIgnore(ROOT, say);
  const stray = out(git(ROOT, 'ls-files', 'vendor')).split('\n').filter((f) => f && f !== 'vendor/bedrock-server.zip');
  if (stray.length) git(ROOT, 'rm', '-r', '--cached', '-q', 'vendor');
  addBds(ROOT, say);
  commitAll(ROOT, 'bds-lab: テンプレート', { exclude: ['addons', ...specExclude(ROOT)] });
}

function switchToBranch(ROOT, branch, say) {
  if (!branch || branch === 'main') return;
  if (!ok(git(ROOT, 'rev-parse', '--verify', branch))) git(ROOT, 'branch', branch);
  git(ROOT, 'checkout', branch);
  commitAll(ROOT, `${branch}: アドオンを追加`);
}

// gh も要らない・ネットワークも無い環境向けの結果。手元の git 履歴だけで進める。
function localOnly(ROOT, branch, say, reason) {
  if (reason) say(`  ${reason}`);
  switchToBranch(ROOT, branch, say);
  return { slug: null, url: null, branch: currentBranch(ROOT), local: true };
}

export async function setupRepo({ ROOT, repoName, branch, say = console.log }) {
  prepareLocal(ROOT, say);

  // AI のサンドボックスなど、gh も外向きのネットワークも無い環境がある。
  // その場合は例外で全部止めるのではなく、手元の git だけで先へ進める。
  if (!ghAvailable()) {
    return localOnly(ROOT, branch, say, 'gh（GitHub CLI）が無いので、GitHub 連携は使わず手元の git だけで進めます');
  }

  try {
    if (!ok(run('gh', ['auth', 'status']))) {
      say('  GitHub にサインインします。ブラウザが開きます…');
      if (!ok(run('gh', ['auth', 'login', '-w', '-s', 'repo,workflow'], { stdio: 'inherit', timeout: 120000 }))) throw new Error('サインインできませんでした');
    }
    const user = out(run('gh', ['api', 'user', '--jq', '.login']));
    if (!user) throw new Error('サインイン情報を読めませんでした');

    const chosen = freeName(user, repoName, say);
    const slug = `${user}/${chosen.name}`;
    if (!chosen.exists) {
      if (!ok(run('gh', ['repo', 'create', chosen.name, '--private'], { stdio: 'inherit' }))) throw new Error('リポジトリを作れませんでした');
      say(`  リポジトリを作りました（private）: https://github.com/${slug}`);
    } else {
      say(`  前に作ったリポジトリを使います: https://github.com/${slug}`);
    }
    if (remoteSlug(ROOT) !== slug) {
      git(ROOT, 'remote', 'remove', 'origin');
      git(ROOT, 'remote', 'add', 'origin', `https://github.com/${slug}.git`);
    }
    claim(slug);

    // 手元が正。すでに中身があっても、合流せず上書きする（衝突を作らない）
    if (!push(ROOT, 'main')) {
      say('  main が食い違っているので、手元の内容で揃えます');
      if (!push(ROOT, 'main', { force: true })) {
        throw new Error(`push できませんでした（${slug}）。ネットワークと権限を確かめてください`);
      }
    }

    run('gh', ['repo', 'edit', slug, '--template'], { stdio: 'ignore' });
    run('gh', ['api', '-X', 'PUT', `repos/${slug}/actions/permissions`, '-f', 'enabled=true', '-f', 'allowed_actions=all'], { stdio: 'ignore' });

    if (branch && branch !== 'main') {
      switchToBranch(ROOT, branch, say);
      if (!push(ROOT, branch) && !push(ROOT, branch, { force: true })) throw new Error(`push できませんでした（${branch}）`);
      say(`  作業用の枝: ${branch}（main はテンプレートのままです）`);
    }

    return { slug, url: `https://github.com/${slug}`, branch: currentBranch(ROOT) };
  } catch (e) {
    // ここまで来て失敗しても、実機での作業自体は続けられる。落とさず手元の git に切り替える。
    return localOnly(ROOT, branch, say, `GitHub 連携をあきらめて、手元の git だけで進めます（${String(e.message ?? e)}）`);
  }
}

export function pushCurrent({ ROOT, message, say = console.log }) {
  if (!gitReady(ROOT)) return { branch: null, pushed: false };
  commitAll(ROOT, message);
  const branch = currentBranch(ROOT);
  if (!remoteSlug(ROOT)) return { branch, pushed: false }; // リモートが無い（オフライン運用）。黙って手元だけにする
  const pushed = push(ROOT, branch) || push(ROOT, branch, { force: true });
  if (!pushed) say('  push できませんでした（あとで npm run ship を実行してください）');
  return { branch, pushed };
}
