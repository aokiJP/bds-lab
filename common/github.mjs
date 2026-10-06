// GitHub side of bds-lab: private repo, one branch per unit, Releases, public unit repos, CI template zip.
// The repository holds all three labs (common/ bds/ end/ ll/); `layout` says where this lab keeps its units
// (bds/addons, end/plugins, ll/mods) and how their branches are named (addon/<name>, plugin/<name>, mod/<name>).
// Rules (kept from the original bds-lab):
//  - the local copy is the truth and GitHub is its copy: never merge or rebase; a diverged remote is overwritten
//  - main = the template (no addons); each addon lives on branch addon/<name> = main + addons/<name>.
//    Addon branches are written with git plumbing (a temporary index), so the checkout never switches and
//    no addon folder ever disappears from disk.
//  - repos are private (the BDS zip is not redistributable); a repo is reused only if this tool made it
//  - one Release per branch, updated in place: template = work zip with BDS; addon-<name> = latest .mcaddon,
//    source zip and history.zip (older .mcaddon files, newest 40)
//  - no gh or no network: keep going with local git only
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MARK = 'BDS_LAB';
const VENDOR = 'vendor/bedrock-server.zip';
const HISTORY = 40;
const LFS_OVER = 45 * 1024 * 1024;   // above this, a plain commit is refused/warned by GitHub: needs Git LFS
const IGNORE = ['node_modules/', '.lab/', 'dist/', 'runs/', '.DS_Store', 'vendor/*', '!vendor/bedrock-server.zip', '!vendor/bds-version.txt', 'docs/coverage/last-run.txt', 'docs/coverage/.spec-run.txt', 'docs/verbs/last-run.txt', 'docs/verbs/tsconfig.json', 'github.token'];

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const ok = (r) => r.status === 0;
const txt = (r) => (r.stdout ?? '').trim();

const DEF = { units: 'addons', branch: 'addon', vendor: VENDOR, allUnits: ['addons'] };
export function makeGit(ROOT, layout = DEF) {
  const lay = { ...DEF, ...layout };
  const git = (...a) => sh('git', a, { cwd: ROOT });
  const gh = (a, o = {}) => sh('gh', a, { cwd: ROOT, ...o });
  const isRepo = () => ok(git('rev-parse', '--is-inside-work-tree'));
  const branch = () => txt(git('rev-parse', '--abbrev-ref', 'HEAD'));
  const slug = () => (txt(git('config', '--get', 'remote.origin.url')).match(/github\.com[:/](.+?)(?:\.git)?$/) ?? [])[1] ?? null;
  const hasGh = () => ok(sh('gh', ['--version']));
  const hasLfs = () => ok(sh('git', ['lfs', 'version']));
  const vendorBig = () => { try { return fs.statSync(path.join(ROOT, lay.vendor)).size > LFS_OVER; } catch { return false; } };

  function commitAll(message, exclude = []) {
    git('add', '-A');
    // a BDS zip too big for plain git stays out unless LFS tracks it
    for (const e of [...exclude, ...(vendorBig() && !hasLfs() ? [lay.vendor] : [])]) git('reset', '-q', '--', e);
    if (!txt(git('diff', '--cached', '--name-only'))) return false;
    sh('git', ['-c', 'user.email=bds-lab@local', '-c', 'user.name=bds-lab', 'commit', '-q', '-m', message], { cwd: ROOT });
    return true;
  }

  function prepareLocal(say) {
    if (!ok(sh('git', ['--version']))) throw new Error('git not found');
    if (!isRepo()) { git('init', '-q', '-b', 'main'); say('git: new repo (main)'); }
    if (txt(git('diff', '--name-only', '--diff-filter=U'))) { git('merge', '--abort'); git('rebase', '--abort'); say('git: cleared a leftover merge'); }
    const gi = path.join(ROOT, '.gitignore');
    const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).map((l) => (l.trim() === 'vendor/' ? 'vendor/*' : l)) : [];
    const next = [...have.filter((l, i) => l || i < have.length - 1), ...IGNORE.filter((l) => !have.includes(l))].join('\n').trimEnd() + '\n';
    if (!fs.existsSync(gi) || fs.readFileSync(gi, 'utf8') !== next) fs.writeFileSync(gi, next);
    if (fs.existsSync(path.join(ROOT, lay.vendor)) && vendorBig() && hasLfs()) {
      git('lfs', 'install', '--local'); git('lfs', 'track', lay.vendor); git('add', '.gitattributes');
      say('git: BDS zip goes through Git LFS');
    } else if (vendorBig()) say('git: BDS zip not committed (over 45MB and no git-lfs); CI will download BDS instead');
    // main holds the template only: addons are committed on their own branches
    if (branch() === 'main' || branch() === 'HEAD') commitAll('bds-lab: template', lay.allUnits.filter((u) => fs.existsSync(path.join(ROOT, u))));
  }

  // addon/<name> = tree of main + addons/<name>, committed without touching the working tree or HEAD
  function snapshot(name, message) {
    const ref = `refs/heads/${lay.branch}/${name}`;
    const idx = path.join(os.tmpdir(), `bdslab-index-${process.pid}-${name}`);
    const env = { ...process.env, GIT_INDEX_FILE: idx };
    const g = (...a) => sh('git', a, { cwd: ROOT, env });
    fs.rmSync(idx, { force: true });
    const base = ok(git('rev-parse', '--verify', '-q', 'refs/heads/main')) ? 'refs/heads/main' : null;
    if (base) g('read-tree', base); else g('read-tree', '--empty');
    g('add', '-A', '--', `${lay.units}/${name}`);
    const tree = txt(g('write-tree'));
    fs.rmSync(idx, { force: true });
    if (!tree) throw new Error('git write-tree failed');
    const parent = txt(git('rev-parse', '--verify', '-q', ref));
    if (parent && txt(git('rev-parse', `${parent}^{tree}`)) === tree) return false;
    const c = sh('git', ['-c', 'user.email=bds-lab@local', '-c', 'user.name=bds-lab', 'commit-tree', tree, ...(parent ? ['-p', parent] : base ? ['-p', base] : []), '-m', message], { cwd: ROOT, encoding: 'utf8' });
    if (!ok(c)) throw new Error('git commit-tree failed: ' + c.stderr);
    git('update-ref', ref, txt(c));
    return true;
  }

  // local wins: plain push, and if the remote diverged, overwrite it (never merge)
  function push(b) {
    const spec = `refs/heads/${b}:refs/heads/${b}`;
    if (ok(sh('git', ['push', '-q', 'origin', spec], { cwd: ROOT }))) return true;
    sh('git', ['fetch', '-q', 'origin', b], { cwd: ROOT });
    return ok(sh('git', ['push', '-q', '--force', 'origin', spec], { cwd: ROOT }));
  }

  const isOurs = (s) => ok(gh(['variable', 'get', MARK, '--repo', s])) || ok(gh(['api', `repos/${s}/contents/common/core.mjs`, '--jq', '.name'])) || ok(gh(['api', `repos/${s}/contents/lib/core.mjs`, '--jq', '.name']));

  function ensureRemote(repoName, say) {
    if (!hasGh()) { say('github: gh not installed, local git only (install gh, then: node lab.mjs github)'); return null; }
    if (!ok(gh(['auth', 'status']))) {
      say('github: signing in (browser)...');
      if (!ok(gh(['auth', 'login', '-w', '-s', 'repo,workflow'], { stdio: 'inherit', timeout: 180000 }))) { say('github: not signed in, local git only'); return null; }
    }
    const cur = slug();
    if (cur && isOurs(cur)) return cur;
    const user = txt(gh(['api', 'user', '--jq', '.login']));
    if (!user) { say('github: cannot read the account, local git only'); return null; }
    for (let i = 0; i < 50; i++) {
      const name = i ? `${repoName}-${i + 1}` : repoName, s = `${user}/${name}`;
      if (!ok(gh(['repo', 'view', s, '--json', 'name']))) {
        if (!ok(gh(['repo', 'create', name, '--private'], { stdio: 'ignore' }))) { say(`github: cannot create ${s}, local git only`); return null; }
        say(`github: created private repo https://github.com/${s}`);
      } else if (!isOurs(s)) { say(`github: ${s} is something else, trying another name`); continue; } else say(`github: reusing https://github.com/${s}`);
      gh(['variable', 'set', MARK, '--body', '1', '--repo', s], { stdio: 'ignore' });
      if (cur !== s) { git('remote', 'remove', 'origin'); git('remote', 'add', 'origin', `https://github.com/${s}.git`); }
      return s;
    }
    return null;
  }

  // `node lab.mjs github`: repo + main (template) + one branch per addon, all pushed
  function setup({ repoName = 'bds-lab', addons = [], say }) {
    prepareLocal(say);
    const main = branch() === 'HEAD' ? 'main' : branch();
    for (const a of addons) snapshot(a, `${lay.branch}/${a}: sync`);
    const s = ensureRemote(repoName, say);
    if (s) {
      if (!push(main)) say(`github: push ${main} failed (network/permissions)`);
      gh(['repo', 'edit', s, '--template'], { stdio: 'ignore' });
      gh(['api', '-X', 'PUT', `repos/${s}/actions/permissions`, '-f', 'enabled=true', '-f', 'allowed_actions=all'], { stdio: 'ignore' });
      for (const a of addons) if (!push(`${lay.branch}/${a}`)) say(`github: push ${lay.branch}/${a} failed`);
    }
    say(`github: ${s ? 'https://github.com/' + s : 'local git only'} | ${main} + ${addons.map((a) => `${lay.branch}/${a}`).join(' ') || 'nothing yet'}`);
    return { slug: s };
  }

  const assets = (tag, repo) => { const r = gh(['release', 'view', tag, '--json', 'assets', ...(repo ? ['--repo', repo] : [])]); if (!ok(r)) return null; try { return JSON.parse(r.stdout).assets.map((a) => a.name); } catch { return []; } };
  function release(tag, title, notes, filesToUpload, keep) {
    const before = assets(tag);
    if (before) gh(['release', 'edit', tag, '--title', title, '--notes', notes], { stdio: 'ignore' });
    else if (!ok(gh(['release', 'create', tag, '--title', title, '--notes', notes], { stdio: 'ignore' }))) throw new Error(`cannot create Release ${tag}`);
    if (!ok(gh(['release', 'upload', tag, ...filesToUpload, '--clobber'], { stdio: 'ignore' }))) throw new Error(`upload to Release ${tag} failed`);
    for (const n of before ?? []) if (!keep.includes(n)) gh(['release', 'delete-asset', tag, n, '-y'], { stdio: 'ignore' });
  }

  return { git, gh, isRepo, branch, slug, hasGh, hasLfs, commitAll, prepareLocal, snapshot, push, setup, assets, release, ok, txt, lay };
}

// `node lab.mjs ship`: .mcaddon + source zip to Release addon-<name>; the previous .mcaddon folds into history.zip
export async function ship({ ROOT, layout, ADDON, name, mcaddon, source, version, zip, unzip, say }) {
  const G = makeGit(ROOT, layout);
  const ext = path.extname(mcaddon) || '.mcaddon';
  if (!G.isRepo()) G.prepareLocal(say);
  const b = `${G.lay.branch}/${name}`;
  const changed = G.snapshot(name, `${b}: ship`);
  if (!G.hasGh() || !G.slug()) { say(`ship: committed to ${b} locally${changed ? '' : ' (no change)'}; ${path.relative(ROOT, mcaddon)} (node lab.mjs github to connect GitHub)`); return true; }
  if (!G.push(b)) say(`ship: push ${b} failed`);
  const tag = `${G.lay.branch}-${name}`;
  const latest = `${name}-latest${ext}`, src = `${name}-source.zip`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-'));
  const up = [path.join(tmp, latest), path.join(tmp, src)];
  fs.copyFileSync(mcaddon, up[0]); fs.copyFileSync(source, up[1]);
  const had = G.assets(tag) ?? [];
  let history = [];
  if (had.includes(latest) && G.ok(G.gh(['release', 'download', tag, '-p', latest, '-D', path.join(tmp, 'prev')]))) {
    const past = path.join(tmp, 'past');
    fs.mkdirSync(past, { recursive: true });
    if (had.includes('history.zip') && G.ok(G.gh(['release', 'download', tag, '-p', 'history.zip', '-D', tmp]))) { try { unzip(fs.readFileSync(path.join(tmp, 'history.zip')), past); } catch { /* rebuilt below */ } }
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    let keep = `${name}-${stamp}${ext}`;
    for (let i = 2; fs.existsSync(path.join(past, keep)); i++) keep = `${name}-${stamp}-${i}${ext}`;
    fs.copyFileSync(path.join(tmp, 'prev', latest), path.join(past, keep));
    history = fs.readdirSync(past).sort().reverse();
    for (const f of history.slice(HISTORY)) fs.rmSync(path.join(past, f));
    history = history.slice(0, HISTORY);
    fs.writeFileSync(path.join(tmp, 'history.zip'), zip(history.map((f) => ({ name: f, data: fs.readFileSync(path.join(past, f)), store: true }))));
    up.push(path.join(tmp, 'history.zip'));
  }
  version ??= JSON.parse(fs.readFileSync(path.join(ADDON, 'bp', 'manifest.json'), 'utf8').replace(/^﻿/, '')).header.version;
  const notes = [`\`${name}\` latest build, updated in place.`, '', '| file | |', '|---|---|', `| \`${latest}\` | latest build (${ext}) |`, `| \`${src}\` | source (addon + tests) |`,
    ...(history.length ? [`| \`history.zip\` | earlier ${ext} files, newest first |`, '', ...history.map((h) => `- ${h}`)] : [])].join('\n');
  G.release(tag, `${name} ${[version].flat().join('.')}`, notes, up, [latest, src, 'history.zip']);
  say(`ship: Release ${tag} https://github.com/${G.slug()}/releases/tag/${tag}${history.length ? ` (history ${history.length})` : ''}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  return true;
}

// `node lab.mjs publish`: a public repo holding only the addon (no BDS, no lab), README from TASK.md + test report
export async function publish({ ROOT, layout, ADDON, name, mcaddon, version, report, yes, zip, say }) {
  const G = makeGit(ROOT, layout);
  const ext = path.extname(mcaddon) || '.mcaddon';
  if (!G.hasGh()) throw new Error('publish needs gh (GitHub CLI)');
  if (report && !report.ok && !yes) throw new Error(`last test was ${report.pass}/${report.total}: make it pass or add --yes`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-pub-'));
  const walk = (d, base = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), base + e.name + '/') : [base + e.name]));
  for (const f of walk(ADDON)) {
    // (tsconfig points into the lab cache; the addon's own .lab/ is the lab's — the offline type stand-in when no BDS could be
    // fetched — and was then refused below, stopping the whole publish)
    if (/^(tests\.txt|TASK\.md|tsconfig\.json)$|^(node_modules|build|\.xmake|\.lab)\/|(^|\/)__pycache__\//.test(f)) continue;
    fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
    fs.copyFileSync(path.join(ADDON, f), path.join(tmp, f));
  }
  const task = fs.existsSync(path.join(ADDON, 'TASK.md')) ? fs.readFileSync(path.join(ADDON, 'TASK.md'), 'utf8').replace(/^#.*\n/, '').replace(/## (やってはいけないこと|Do not)[\s\S]*/, '').trim() : '';
  const lines = [`# ${name}`, '', task, '', '## Install', '', `Get \`${name}${ext}\` from the Releases page.`, ''];
  if (report) lines.push('## Verified', '', `Automatically tested on ${report.server ?? 'Bedrock Dedicated Server ' + report.bds}: ${report.pass}/${report.total} checks passed.`, '');
  fs.writeFileSync(path.join(tmp, 'README.md'), lines.join('\n'));
  for (const f of walk(tmp)) if (/bedrock[-_]server|vendor\/|\.lab\//i.test(f) || fs.statSync(path.join(tmp, f)).size > 20 * 1024 * 1024) throw new Error(`refusing to publish ${f}`);
  sh('git', ['init', '-q', '-b', 'main'], { cwd: tmp }); sh('git', ['add', '-A'], { cwd: tmp });
  sh('git', ['-c', 'user.email=bds-lab@local', '-c', 'user.name=bds-lab', 'commit', '-q', '-m', `${name}`], { cwd: tmp });
  const user = G.txt(G.gh(['api', 'user', '--jq', '.login'])), repo = name.replace(/_/g, '-'), s = `${user}/${repo}`;
  if (G.ok(G.gh(['repo', 'view', s, '--json', 'name']))) {
    sh('git', ['remote', 'add', 'origin', `https://github.com/${s}.git`], { cwd: tmp });
    if (!G.ok(sh('git', ['push', '-q', '--force', '-u', 'origin', 'main'], { cwd: tmp }))) throw new Error(`push to ${s} failed`);
  } else if (!G.ok(sh('gh', ['repo', 'create', repo, '--public', '--source', tmp, '--remote', 'origin', '--push'], { cwd: tmp, encoding: 'utf8' }))) throw new Error(`cannot create public repo ${s}`);
  version ??= JSON.parse(fs.readFileSync(path.join(ADDON, 'bp', 'manifest.json'), 'utf8').replace(/^﻿/, '')).header.version;
  const tag = `v${[version].flat().join('.')}`, asset = path.join(tmp, path.basename(mcaddon));
  fs.copyFileSync(mcaddon, asset);
  if (G.ok(G.gh(['release', 'view', tag, '--repo', s]))) G.gh(['release', 'upload', tag, asset, '--clobber', '--repo', s]);
  else G.gh(['release', 'create', tag, asset, '--repo', s, '--title', tag, '--generate-notes']);
  fs.rmSync(tmp, { recursive: true, force: true });
  say(`publish: https://github.com/${s} (${tag}; ${name} only, no server, no lab)`);
  return true;
}

// `node lab.mjs bundle [--release]`: the work zip AI gets (whole lab + addons + vendor BDS, no caches) -> Release "template"
export function bundle({ ROOT, layout = DEF, bdsVer, zip, release, say }) {
  const vend = layout.vendor ?? VENDOR, vdir = path.posix.dirname(vend) + '/';
  const vz = path.join(ROOT, vend);
  if (!fs.existsSync(vz)) throw new Error('no vendor/bedrock-server.zip (node lab.mjs bds first)');
  // the Release already holds this BDS with this tree (a daily schedule that found nothing new): nothing is zipped or uploaded
  // (about 100 MB up each day, and the Actions minutes for it, when nothing changed)
  let key = null;
  if (release) {
    const G0 = makeGit(ROOT), tree = G0.isRepo() ? G0.txt(G0.git('rev-parse', 'HEAD^{tree}')) : '';
    key = tree ? `${bdsVer} ${tree.slice(0, 12)}` : null;
    const cur = key && G0.hasGh() ? G0.gh(['release', 'view', 'template', '--json', 'body']) : null;
    let body = ''; try { body = cur && G0.ok(cur) ? JSON.parse(cur.stdout).body ?? '' : ''; } catch { /* no release yet */ }
    if (key && body.includes(`bundle-key: ${key}`)) { say(`bundle: the Release template is current (BDS ${bdsVer}, tree ${key.split(' ')[1]}): nothing to upload`); return null; }
  }
  const SKIP = /(^|\/)(\.git|node_modules|\.lab|dist|runs|__pycache__|build|\.xmake)(\/|$)|docs\/(coverage|verbs)\/(last-run\.txt|\.spec-run\.txt)$|(^|\/)\.DS_Store$/;
  const entries = [];
  const walk = (d, base = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = base + e.name; if (SKIP.test(r) || (r.startsWith(vdir) && r !== vend && r !== vdir + 'bds-version.txt')) continue; if (e.isDirectory()) walk(path.join(d, e.name), r + '/'); else entries.push({ name: `bds-lab/${r}`, data: fs.readFileSync(path.join(d, e.name)), store: r === vend }); } };   // (the BDS zip is stored as it is: deflating a zip again only costs time)
  walk(ROOT);
  const file = path.join(ROOT, 'dist', `bds-lab-${bdsVer}.zip`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zip(entries));
  say(`bundle: dist/${path.basename(file)} (${entries.length} files, ${Math.round(fs.statSync(file).size / 1048576)}MB, BDS ${bdsVer})`);
  if (!release) return file;
  const G = makeGit(ROOT);
  if (!G.hasGh() || !G.slug()) throw new Error('bundle --release needs gh and a GitHub remote (node lab.mjs github)');
  const notes = ['## Use', '', '1. Download the `bds-lab-*.zip` below', '2. Give it to your AI together with what you want to build', '', `Bundled Bedrock Dedicated Server: **${bdsVer}**. Private use only: BDS may not be redistributed.`].join('\n') + (key ? `\n\n<!-- bundle-key: ${key} -->` : '');
  G.release('template', `work zip — BDS ${bdsVer}`, notes, [file], [path.basename(file)]);
  say('bundle: Release template updated');
  return file;
}
