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
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const STATE_VERSION = 1;
// Every unit depends on how CI runs it as well (the tools, their versions, the environment): its own job's text in verify.yml,
// a key 'job:<workflow>#<job>' whose value is the sha1 of that job's lines without the comments and blank ones — another job's
// change, a comment, the triggers do not run it again (the whole file used to: any edit of it ran every unit once more)
export const WORKFLOW = '.github/workflows/verify.yml';
/** the job a unit runs in: the real server's parts in bds, the rest (offline tests, the steps) in offline */
export const jobOf = (unit) => (String(unit).startsWith('bds:') ? 'bds' : 'offline');
export const implicitFor = (unit) => [`job:${WORKFLOW}#${jobOf(unit)}`];
/** a job's text in a workflow (pure): from its `  <job>:` line under `jobs:` to the next job or top-level key, the lines that
 *  are only a comment and the blank ones left out; null when there is no such job */
export function jobText(text, job) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n'), top = lines.indexOf('jobs:');
  const at = top < 0 ? -1 : lines.findIndex((l, k) => k > top && l === `  ${job}:`);
  if (at < 0) return null;
  const out = [lines[at]];
  for (let k = at + 1; k < lines.length; k++) {
    const l = lines[k];
    if (/^\s*(#.*)?$/.test(l)) continue;
    if (/^ {0,2}\S/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}
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

/** keys → { key: value } in the tree (pure but for a 'job:' key: its workflow read in root, the checkout of that tree;
 *  without root, or no such file or job, 'absent') */
export function valuesOf(keys, tree, { root = null } = {}) {
  const out = {};
  for (const k of keys) {
    if (k.startsWith('job:')) {
      const i = k.lastIndexOf('#'), file = k.slice(4, i), job = k.slice(i + 1);
      let text = null;
      try { if (root && i > 4) text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { text = null; }
      const jt = text === null ? null : jobText(text, job);
      out[k] = jt === null ? 'absent' : crypto.createHash('sha1').update(jt).digest('hex');
    } else if (k.startsWith('dir:')) {
      const s = tree.dirs.get(dirOf(k));
      out[k] = s ? crypto.createHash('sha1').update([...s].sort().join('\n')).digest('hex') : 'absent';
    } else out[k] = tree.files.get(k) ?? 'absent';
  }
  return out;
}
