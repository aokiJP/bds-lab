// verify's shared naming of file contents (common/verify-state.mjs) on a temp git repository: a file is its blob id (the same
// as git hash-object), a folder is the names right under it, what the commit lacks is 'absent'; a file added to a folder
// changes that folder's value and nothing above it; './', a trailing '/' and 'dir:.' name the same folders; a dot-folder keeps
// its dot. node tests/verify-state-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(pathToFileURL(path.join(TOP, 'common', 'verify-state.mjs')).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-vstate-'));
const git = (...a) => { const r = spawnSync('git', a, { cwd: TMP, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const put = (files) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(TMP, f)), { recursive: true }); fs.writeFileSync(path.join(TMP, f), s); } };
const commit = (files, msg) => { put(files); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };

git('init', '-q');
const c1 = commit({ 'a.txt': 'a\n', 'd/b.txt': 'b\n', 'd/e/c.txt': 'c\n', '.github/workflows/verify.yml': 'name: verify\n' }, 'one');

await t('a file is its blob id, a folder the names right under it, what is not there is absent', () => {
  const tree = S.treeAt(TMP, c1);
  eq(tree.files.get('d/e/c.txt'), git('hash-object', 'd/e/c.txt'), 'the blob id');
  eq([...tree.dirs.get('')].sort(), ['.github', 'a.txt', 'd']);
  eq([...tree.dirs.get('d')].sort(), ['b.txt', 'e']);
  const v = S.valuesOf(['a.txt', 'nope.txt', 'dir:d', 'dir:nope', 'dir:.'], tree);
  eq([v['a.txt'], v['nope.txt'], v['dir:nope']], [git('hash-object', 'a.txt'), 'absent', 'absent']);
  ok(/^[0-9a-f]{40}$/.test(v['dir:d']) && /^[0-9a-f]{40}$/.test(v['dir:.']), JSON.stringify(v));
});

await t('the same folder however it is written; a dot-folder keeps its dot', () => {
  eq(['dir:.', 'dir:', 'dir:./', 'dir:d', 'dir:d/', 'dir:./d', 'dir:.github', 'dir:./.github/workflows/'].map(S.dirOf), ['', '', '', 'd', 'd', 'd', '.github', '.github/workflows']);
  const v = S.valuesOf(['dir:d', 'dir:./d/', 'dir:.github'], S.treeAt(TMP, c1));
  eq(v['dir:d'], v['dir:./d/']);
  ok(v['dir:.github'] !== 'absent', 'the dot-folder found');
});

await t('a file added to a folder changes that folder only; an edit changes the file only', () => {
  const keys = ['a.txt', 'd/b.txt', 'dir:.', 'dir:d', 'dir:d/e'];
  const before = S.valuesOf(keys, S.treeAt(TMP, c1));
  const c2 = commit({ 'd/e/new.txt': 'n\n' }, 'two'), mid = S.valuesOf(keys, S.treeAt(TMP, c2));
  eq(keys.filter((k) => before[k] !== mid[k]), ['dir:d/e']);
  const c3 = commit({ 'd/b.txt': 'b2\n' }, 'three'), after = S.valuesOf(keys, S.treeAt(TMP, c3));
  eq(keys.filter((k) => mid[k] !== after[k]), ['d/b.txt']);
  eq(S.valuesOf(keys, S.treeAt(TMP, c1)), before, 'an old commit still reads as it was');
});

await t('the machine a result was made on; verify.yml is everyone\'s; a bad revision says so', () => {
  eq(S.envKey({ platform: 'linux', arch: 'x64', versions: { node: '22.23.3' } }), 'linux-x64 node22');
  eq(S.IMPLICIT, ['.github/workflows/verify.yml']);
  eq(S.STATE_VERSION, 1);
  let msg = ''; try { S.treeAt(TMP, 'no-such-rev'); } catch (e) { msg = e.message; }
  ok(/^git ls-tree no-such-rev: /.test(msg), msg);
  eq(S.parseTree('').files.size, 0, 'nothing: nothing');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
