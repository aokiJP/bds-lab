// verify's record of what a unit read: a unit run with the recorder (common/deps-hook.mjs in every node process it starts), and
// what that wrote turned into the unit's deps — the repository's files and folders it looked at, each with its value in the
// commit (common/verify-state.mjs: the one way a file's content is named) — and its result line { unit, ok, ms, deps, sha, env }.
// A record that is not whole (a '!' line, or nothing recorded at all) is deps null: not known, the unit runs again next time.
//   node common/deps.mjs run <unit> --results <file> [--cwd <dir>] -- <cmd...>
//        the command with the recorder: its output as it is, its exit code; one result line appended
//   node common/deps.mjs each --results <file> --jobs <n> --unit <unit, {} the name> --names "<a b c>" [--cwd <dir>] -- <cmd, {} the name...>
//        a unit per name, n at a time; each one's output held and printed whole when it ends (::group::<name> … ::endgroup::, a
//        failure also ::error title=<unit>::<its last 30 lines>) and its result line appended right then (a run cancelled keeps
//        what ended); after all of them, exit 1 if any failed
// A recorded path → a key: inside the repository its path; under the temp folder the longest tail of 2 parts or more that the
// repository has (a copy of the lab run there is read as the lab: more keys than needed is fine; looked for and not there, a
// tail whose folder the repository has); anything else is not the repository's. Kept: a file of HEAD's tree, a folder of it as
// 'dir:<path>' ('dir:.' the top), and what the tree lacks but git does not ignore (its value 'absent': once such a file is
// committed the unit runs again; looked for and not there, as a file and as a folder). Never .git/, never what git ignores.
// IMPLICIT always. Tested by tests/deps-offline.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { treeAt, valuesOf, envKey, IMPLICIT } from './verify-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.dirname(HERE);
export const HOOK = pathToFileURL(path.join(HERE, 'deps-hook.mjs')).href;
const list = (s) => String(s ?? '').split(path.delimiter).filter(Boolean);
const git = (cwd, args, o = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const topOf = (dir) => { const r = git(dir, ['rev-parse', '--show-toplevel']); return r.status === 0 && r.stdout.trim() ? path.resolve(r.stdout.trim()) : null; };
const headOf = (dir) => { const r = git(dir, ['rev-parse', 'HEAD']); return r.status === 0 ? r.stdout.trim() : null; };
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const inside = (p, d) => p === d || p.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** what a child's env needs on top of base to be recorded into dir: NODE_OPTIONS keeps base's options and loads the recorder;
 *  a recording already going on (base's LAB_DEPS_OUT) keeps getting the lines too; root: the repository (pure) */
export function recordEnv(dir, base = process.env, root = REPO) {
  const opts = String(base.NODE_OPTIONS ?? '');
  return {
    NODE_OPTIONS: opts.includes(HOOK) ? opts : `${opts} --import=${HOOK}`.trim(),
    LAB_DEPS_OUT: [...new Set([dir, ...list(base.LAB_DEPS_OUT)])].join(path.delimiter),
    LAB_DEPS_ROOT: [...new Set([root, ...list(base.LAB_DEPS_ROOT)])].join(path.delimiter),
  };
}

// the record's lines → Map(path → Set of kinds), or null when it is not whole ('!' anywhere, or no process recorded anything)
function readRecord(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')); } catch { return null; }
  if (!files.length) return null;
  const seen = new Map();
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; }
    for (const l of text.split('\n')) {
      if (l.startsWith('!')) return null;
      const k = l[0], p = l.slice(2);
      if (l[1] !== ' ' || !'rmdx'.includes(k || '?') || !path.isAbsolute(p)) continue;
      let s = seen.get(p);
      if (!s) seen.set(p, (s = new Set()));
      s.add(k);
    }
  }
  return seen;
}

// the paths git ignores among rels (a folder asked with its trailing '/'); git unable to tell: none (kept: more is fine)
function ignoredOf(top, rels) {
  if (!rels.length) return new Set();
  const asked = rels.map((r) => (isDir(path.join(top, r)) ? `${r}/` : r));
  const r = git(top, ['check-ignore', '--stdin', '-z'], { input: asked.join('\0') + '\0' });
  if (r.status !== 0 && r.status !== 1) return new Set();
  return new Set(r.stdout.split('\0').filter(Boolean).map((x) => x.replace(/\/$/, '')));
}

/** a record folder → the unit's deps { key: value } (keys sorted, values of root's HEAD), or null when not known */
export function collect(dir, root) {
  const seen = readRecord(dir);
  if (!seen) return null;
  const top = topOf(root);
  if (!top) return null;
  let tree;
  try { tree = treeAt(top, 'HEAD'); } catch { return null; }
  const tops = [...new Set([top, real(top)])], tmps = [...new Set([os.tmpdir(), real(os.tmpdir())].map((p) => path.resolve(p)))];
  const has = (rel) => tree.files.has(rel) || tree.dirs.has(rel) || fs.existsSync(path.join(top, rel));
  const keyPath = (p, kinds) => {
    for (const t of tops) if (inside(p, t)) return path.relative(t, p).split(path.sep).join('/');
    for (const t of tmps) {
      if (!inside(p, t)) continue;
      const parts = path.relative(t, p).split(path.sep).filter(Boolean);
      for (let i = 0; i + 2 <= parts.length; i++) { const rel = parts.slice(i).join('/'); if (has(rel)) return rel; }
      if (kinds.has('m')) for (let i = 0; i + 2 <= parts.length; i++) { const up = parts.slice(i, -1).join('/'); if (tree.dirs.has(up) || isDir(path.join(top, up))) return parts.slice(i).join('/'); }
      return null;
    }
    return null;
  };
  const keys = new Set(IMPLICIT), rest = new Map();   // rest: rel → kinds, what the tree lacks
  for (const [p, kinds] of seen) {
    const rel = keyPath(path.resolve(p), kinds);
    if (rel == null || rel.split('/').includes('.git')) continue;
    if (tree.files.has(rel)) keys.add(rel);
    else if (rel === '' || tree.dirs.has(rel)) keys.add(`dir:${rel || '.'}`);
    else rest.set(rel, new Set([...(rest.get(rel) ?? []), ...kinds]));
  }
  const ignored = ignoredOf(top, [...rest.keys()]);
  for (const [rel, kinds] of rest) {
    if (ignored.has(rel)) continue;
    if (kinds.has('d') || isDir(path.join(top, rel))) { keys.add(`dir:${rel}`); continue; }
    keys.add(rel);
    if (kinds.has('m')) keys.add(`dir:${rel}`);
  }
  return valuesOf([...keys].sort(), tree);
}

/** run-tests' wrap: a unit about to run → the env its process needs to be recorded, and finish({ ok, ms }) → what its result
 *  line carries: { deps, sha, env } (deps only for a pass: a failure is not remembered anyway). The record folder is in the temp
 *  folder; finish takes it away (and says the same again if called twice) */
export function prepare(unit, { root = REPO, env = process.env } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-deps-'));
  let done = null;
  return {
    dir,
    env: recordEnv(dir, env, root),
    finish({ ok } = {}) {
      if (done) return done;
      let deps = null;
      try { if (ok !== false) deps = collect(dir, root); } catch { deps = null; }
      done = { deps, sha: headOf(root), env: envKey() };
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the temp folder's cleaner takes it */ }
      return done;
    },
  };
}

// ---------- the command line ----------
const append = (file, row) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(row) + '\n'); };
// (GitHub's workflow commands: a property and the message escaped as its toolkit does)
const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const secs = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
const live = new Set();   // { c, p }: what a signal must stop and clean
// one unit: the command with the recorder; its result line appended as soon as it ends → { ok, code, ms, text }
function runUnit(unit, cmd, { cwd, results, capture }) {
  const p = prepare(unit, { root: topOf(cwd) ?? cwd }), t0 = Date.now();
  return new Promise((res) => {
    let text = '', done = false, c;
    const end = (code) => {
      if (done) return;
      done = true; live.delete(x);
      const ms = Date.now() - t0, ok = code === 0;
      append(results, { unit, ok, ms, ...p.finish({ ok, ms }) });
      res({ ok, code, ms, text });
    };
    const x = { p, get c() { return c; } };
    live.add(x);
    try { c = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...p.env }, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: process.platform === 'win32' }); } catch (e) { text += `✘ ${e.message}\n`; if (!capture) console.error(`✘ ${e.message}`); end(127); return; }
    if (capture) { const add = (d) => { text += d; if (text.length > 64e6) text = text.slice(-32e6); }; c.stdout.on('data', add); c.stderr.on('data', add); }
    c.on('error', (e) => { text += `✘ ${e.message}\n`; if (!capture) console.error(`✘ ${e.message}`); end(e.code === 'ENOENT' ? 127 : 1); });
    c.on('close', (code, signal) => end(code ?? 128 + (os.constants.signals[signal] ?? 0)));
  });
}
const usage = () => {
  console.error('使い方: node common/deps.mjs run <unit> --results <file> [--cwd <dir>] -- <cmd...>\n'
    + '        node common/deps.mjs each --results <file> --jobs <n> --unit <unit、{} が名前> --names "<a b c>" [--cwd <dir>] -- <cmd、{} が名前...>');
  process.exit(2);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), dash = a.indexOf('--'), opt = dash >= 0 ? a.slice(0, dash) : a, cmd = dash >= 0 ? a.slice(dash + 1) : [];
  const flag = (k) => { const i = opt.indexOf(k); return i >= 0 ? opt[i + 1] : undefined; };
  const sub = opt[0], results = flag('--results') && path.resolve(flag('--results')), cwd = path.resolve(flag('--cwd') ?? '.');
  if (!['run', 'each'].includes(sub) || !results || !cmd.length) usage();
  // cancelled (a person's Ctrl-C, a cancelled CI run): the units running stop, no line for them, their record folders go
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(s, () => {
      for (const x of live) { try { x.c?.kill(s); } catch { /* gone */ } try { x.p.finish({ ok: false }); } catch { /* gone */ } }
      process.exit(128 + (os.constants.signals[s] ?? 0));
    });
  }
  if (sub === 'run') {
    const unit = opt[1];
    if (!unit || unit.startsWith('--')) usage();
    process.exitCode = (await runUnit(unit, cmd, { cwd, results, capture: false })).code;
  } else {
    const names = String(flag('--names') ?? '').split(/\s+/).filter(Boolean), type = flag('--unit'), jobs = Math.max(1, Number(flag('--jobs')) || 1);
    if (!type) usage();
    const fill = (s, n) => String(s).split('{}').join(n), bad = [];
    let i = 0;
    const worker = async () => {
      while (i < names.length) {
        const n = names[i++], unit = fill(type, n);
        const r = await runUnit(unit, cmd.map((x) => fill(x, n)), { cwd, results, capture: true });
        const body = r.text.replace(/\s+$/, ''), tail = body.split('\n').slice(-30).join('\n');
        process.stdout.write(`::group::${n}\n${body ? body + '\n' : ''}${r.ok ? `✔ ${unit}（${secs(r.ms)}）` : `✘ ${unit}: 終了コード ${r.code}（${secs(r.ms)}）`}\n::endgroup::\n`
          + (r.ok ? '' : `::error title=${escProp(unit)}::${escData(tail || `終了コード ${r.code}`)}\n`));
        if (!r.ok) bad.push(unit);
      }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, names.length) }, worker));
    console.log(bad.length ? `✘ ${names.length} 個のうち ${bad.length} 個が落ちた: ${bad.join(' ')}` : `✔ ${names.length} 個すべて通った`);
    process.exitCode = bad.length ? 1 : 0;
  }
}
