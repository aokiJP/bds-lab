#!/usr/bin/env node
// GitHub flows without network or credentials: a fake `gh` (bench/fake-gh) + git url.insteadOf pointing
// https://github.com/ at local bare repos. Checks: github (private repo, main without addons, addon/<name> branch),
// ship x2 (Release latest + source + history.zip), publish (public, addon only), working tree never loses an addon.
// The repository is the whole monorepo (common/ bds/ end/ ll/): addons live in bds/addons.
//   node bds/bench/github-smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-gh-'));
const S = path.join(T, 'github'), HOME = path.join(T, 'home'), BIN = path.join(T, 'bin'), R = path.join(T, 'lab'), W = path.join(R, 'bds');
for (const d of [S, HOME, BIN, W]) fs.mkdirSync(d, { recursive: true });
fs.copyFileSync(path.join(LAB, 'bench', 'fake-gh'), path.join(BIN, 'gh'));
fs.chmodSync(path.join(BIN, 'gh'), 0o755);
fs.cpSync(path.join(LAB, '..', 'common'), path.join(R, 'common'), { recursive: true });
// (the bds lab's own files; its AGENTS.md became help.md and README.md long ago, and copying it stopped this test at once)
for (const f of ['lab.mjs', 'flavor.mjs', 'help.md', 'README.md']) if (fs.existsSync(path.join(LAB, f))) fs.cpSync(path.join(LAB, f), path.join(W, f), { recursive: true });
if (process.env.LAB_CACHE === undefined) process.env.LAB_CACHE = path.join(LAB, '.lab');   // reuse this lab's BDS
const env = { ...process.env, HOME, FAKEGH: S, PATH: `${BIN}${path.delimiter}${process.env.PATH}`, LAB_NOTRACE: '1', GIT_CONFIG_NOSYSTEM: '1' };
const sh = (cmd, args, cwd = W) => spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
sh('git', ['config', '--global', `url.${S}/.insteadOf`, 'https://github.com/']);
sh('git', ['config', '--global', 'init.defaultBranch', 'main']);
const lab = (...a) => { const r = sh(process.execPath, ['lab.mjs', ...a]); return (r.stdout + r.stderr).trim(); };
let bad = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✔' : '✘'} ${what}${ok || !detail ? '' : '\n  ' + detail}`); if (!ok) bad++; };

for (const o of [lab('new', 'demo', 'Demo'), lab('new', 'other', 'Other', '--js', '--stable')]) {
  console.log(o);
  // `new` needs the BDS cache (types, vanilla files): without it every later check fails for the same reason, so say that once
  if (/cannot download BDS/.test(o)) { console.log('\nSKIP needs BDS in the cache (network blocked?): run `node lab.mjs bds setup` once with network, then again'); fs.rmSync(T, { recursive: true, force: true }); process.exit(2); }
}
let o = lab('github', 'mylab');
check(fs.existsSync(path.join(S, 'tester', 'mylab.git')), 'github: private repo created', o);
check(fs.readFileSync(path.join(S, 'tester', 'mylab.git', 'visibility'), 'utf8') === 'private', 'github: repo is private');
const tree = (ref) => sh('git', ['--git-dir', path.join(S, 'tester', 'mylab.git'), 'ls-tree', '-r', '--name-only', ref]).stdout;
check(!/^bds\/addons\//m.test(tree('main')) && /^common\/core\.mjs$/m.test(tree('main')), 'github: main = template without addons');
check(/^bds\/addons\/demo\/bp\/manifest\.json$/m.test(tree('addon/demo')) && !/^bds\/addons\/other\//m.test(tree('addon/demo')), 'github: addon/demo holds only that addon');
check(fs.existsSync(path.join(W, 'addons', 'demo')) && fs.existsSync(path.join(W, 'addons', 'other')), 'github: both addon folders still on disk');
const rel = path.join(S, 'releases', 'tester__mylab', 'addon-demo');
o = lab('ship', '-a', 'demo');
check(fs.existsSync(path.join(rel, 'demo-latest.mcaddon')) && fs.existsSync(path.join(rel, 'demo-source.zip')), 'ship: Release has latest .mcaddon + source', o);
fs.appendFileSync(path.join(W, 'addons', 'demo', 'src', 'main.ts'), "console.warn('v2');\n");   // TypeScript addon: src/ is built into bp/scripts by ship
o = lab('ship', '-a', 'demo');
check(fs.existsSync(path.join(rel, 'history.zip')) && /history 1/.test(o), 'ship: previous build folded into history.zip', o);
const shown = (f) => sh('git', ['--git-dir', path.join(S, 'tester', 'mylab.git'), 'show', 'addon/demo:bds/addons/demo/' + f]).stdout;
check(/v2/.test(shown('src/main.ts')) && /v2/.test(shown('bp/scripts/main.js')), 'ship: branch pushed with the change (src and its build)');
o = lab('publish', '-a', 'demo', '--yes');
const pub = path.join(S, 'tester', 'demo.git');
check(fs.existsSync(pub) && fs.readFileSync(path.join(pub, 'visibility'), 'utf8') === 'public', 'publish: public repo', o);
const ptree = sh('git', ['--git-dir', pub, 'ls-tree', '-r', '--name-only', 'main']).stdout;
check(/^bp\/manifest\.json$/m.test(ptree) && /^README\.md$/m.test(ptree) && !/common\/|vendor|bedrock/i.test(ptree), 'publish: addon + README only (no lab, no BDS)');
check(fs.existsSync(path.join(W, 'addons', 'other', 'bp', 'manifest.json')), 'end: no addon folder was lost');
// bundle --release (the daily template): uploaded once; the same BDS and tree again → nothing zipped or uploaded
{
  fs.mkdirSync(path.join(W, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(W, 'vendor', 'bedrock-server.zip'), 'PK fake'); fs.writeFileSync(path.join(W, 'vendor', 'bds-version.txt'), '1.2.3\n');
  Object.assign(process.env, { HOME, FAKEGH: S, PATH: env.PATH, GIT_CONFIG_NOSYSTEM: '1' });
  const GH = await import(pathToFileURL(path.join(R, 'common', 'github.mjs')).href), said = [];
  const run = () => GH.bundle({ ROOT: R, layout: { vendor: 'bds/vendor/bedrock-server.zip' }, bdsVer: '1.2.3', zip: (es) => Buffer.concat(es.map((x) => Buffer.from(x.name + '\n'))), release: true, say: (l) => said.push(l) });
  const first = run(), second = run();
  check(first && fs.existsSync(path.join(S, 'releases', 'tester__mylab', 'template', 'bds-lab-1.2.3.zip')) && second === null && /template is current \(BDS 1\.2\.3, tree [0-9a-f]{12}\)/.test(said.at(-1)), 'bundle --release: once per BDS and tree (the daily run with nothing new uploads nothing)', said.join(' | '));
}
fs.rmSync(T, { recursive: true, force: true });
console.log(bad ? `FAIL ${bad}` : 'PASS github smoke');
process.exit(bad ? 1 : 0);
