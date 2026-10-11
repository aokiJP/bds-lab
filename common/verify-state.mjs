// verify's memory of what passed: the shapes common/deps.mjs writes (a unit's result) and common/verify-plan.mjs reads (the
// state, to pick what to run), and the one way a file's content is named — so a result recorded on one runner and the plan's
// view of a commit agree to the byte. Nothing else names a file's content for verify.
//   key     a repository path ('common/core.mjs'), or 'dir:<path>' — a folder's listing, the names right under it ('dir:.' is
//           the top): a test that listed a folder sees a file added there or taken away
//   value   the git blob id of the file in the commit ('absent' when the commit has no such file); for 'dir:' the sha1 of the
//           sorted names joined by '\n' ('absent' when there is no such folder)
//   result  one JSON line per unit run: { unit, ok, ms, deps: {key: value} | null, sha, env } — deps null: not known (the
//           unit runs again next time)
//   state   { v: STATE_VERSION, at, units: { <unit>: { deps, ms, sha, at, env } } } — passes only: a failure removes the unit
// A unit: an offline test ('tests/x-offline.mjs'), a workflow step ('step:eslint'), a part of the real server ('bds:bench',
// 'bds:addon:<name>'). Tested by tests/verify-state-offline.mjs.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const STATE_VERSION = 1;
/** every unit depends on these as well: how CI runs it (the tools, their versions, the environment) is written there */
export const IMPLICIT = ['.github/workflows/verify.yml'];
/** the machine a result was made on: another one is another result (pure) */
export const envKey = (p = process) => `${p.platform}-${p.arch} node${String(p.versions?.node ?? '').split('.')[0]}`;

/** `git ls-tree -r -z` output → { files: Map(path → blob id), dirs: Map(folder → Set(names right under it)) }, '' the top
 *  (pure) */
export function parseTree(text) {
  const files = new Map(), dirs = new Map();
  const add = (d, n) => { let s = dirs.get(d); if (!s) dirs.set(d, (s = new Set())); s.add(n); };
  for (const rec of String(text).split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [, type, id] = rec.slice(0, tab).split(' '), p = rec.slice(tab + 1);
    if (type !== 'blob' && type !== 'commit') continue;
    files.set(p, id);
    const parts = p.split('/');
    for (let i = 0; i < parts.length; i++) add(parts.slice(0, i).join('/'), parts[i]);
  }
  return { files, dirs };
}

/** a commit's tree (git ls-tree: no file contents needed, a blob:none clone is enough) */
export function treeAt(root, rev = 'HEAD') {
  const r = spawnSync('git', ['ls-tree', '-r', '-z', '--full-tree', rev], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ls-tree ${rev}: ${String(r.stderr || r.error?.message || r.status).trim().split('\n')[0]}`);
  return parseTree(r.stdout);
}

/** a 'dir:' key's folder as the tree names it: '' the top; a leading './' and a trailing '/' do not count (pure) */
export function dirOf(key) {
  let d = String(key).slice(4).replace(/\/+$/, '');
  if (d.startsWith('./')) d = d.slice(2);
  return d === '.' ? '' : d;
}

/** keys → { key: value } in the tree (pure) */
export function valuesOf(keys, tree) {
  const out = {};
  for (const k of keys) {
    if (k.startsWith('dir:')) {
      const s = tree.dirs.get(dirOf(k));
      out[k] = s ? crypto.createHash('sha1').update([...s].sort().join('\n')).digest('hex') : 'absent';
    } else out[k] = tree.files.get(k) ?? 'absent';
  }
  return out;
}
