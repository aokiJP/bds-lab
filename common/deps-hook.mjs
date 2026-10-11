// verify's recorder: which files a unit's processes looked at (common/deps.mjs reads what this writes and turns it into the
// unit's deps: verify runs a unit again only when one of them changed). Loaded into every node process of the unit by
// NODE_OPTIONS --import=<this file's URL>; does nothing without LAB_DEPS_OUT (the record folders, path.delimiter between: a unit
// recorded inside another one's run writes to both). One file per process and per worker thread, <folder>/<pid>-<random>.txt,
// one line per path, each line once:
//   r <path>   read, opened, stat'ed, a module loaded — and there    m <path>   looked for and not there (ENOENT, ENOTDIR)
//   d <path>   a folder listed                                       x <path>   a file named on a child's command line (a bare
//                                                                               command: the file the child's PATH finds)
//   ! <why>    not everything can be recorded (the unit's deps are then not known: it runs every time)
// What it sees: module.registerHooks (import, import(), require; a relative one not found: m, and its folder listed); node:fs and
// node:fs/promises — readFile, createReadStream, open, stat, lstat, exists, access, readdir, opendir, realpath, the source of
// copyFile and of cp (all of it) — named imports too (module.syncBuiltinESMExports); node:child_process (spawn, spawnSync,
// execFile, execFileSync, fork, exec, execSync): a child given an env of its own gets the recorder back (NODE_OPTIONS keeps its
// value, LAB_DEPS_OUT and LAB_DEPS_ROOT added). A node child under the permission model cannot load this file (it reads only what
// it is allowed to): it starts without it, and what it may read (each --allow-fs-read inside LAB_DEPS_ROOT or the temp folder)
// is recorded here instead. A worker thread records too, whatever env it was given (one given code to evaluate loads the
// recorder first). Recording never breaks the process: every step is in a try, and what could not be patched is a '!' line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import module from 'node:module';
import crypto from 'node:crypto';
import child from 'node:child_process';
import { fileURLToPath } from 'node:url';
import wt, { isMainThread, getEnvironmentData, setEnvironmentData } from 'node:worker_threads';

const ACTIVE = Symbol.for('bds-lab.deps-hook'), SHARED = 'bds-lab.deps-hook';
const HOOK = import.meta.url, IMPORT = `--import=${HOOK}`;
const list = (s) => String(s ?? '').split(path.delimiter).filter(Boolean);
const union = (...xs) => [...new Set(xs.flatMap(list))].join(path.delimiter);
// entries a cp source or a folder a sandboxed child may read can have before it is a '!' instead (the lab: about 1,100 files)
const LIMIT = 200000;
// the originals, taken before anything is patched: the recorder's own reads and writes never record themselves
const O = { openSync: fs.openSync, writeSync: fs.writeSync, statSync: fs.statSync, lstatSync: fs.lstatSync, readdirSync: fs.readdirSync, existsSync: fs.existsSync };

let OUT = process.env.LAB_DEPS_OUT ?? '', ROOT = process.env.LAB_DEPS_ROOT ?? '';
const NAME = `${process.pid}-${crypto.randomBytes(6).toString('hex')}.txt`, fds = new Map(), seen = new Set();
function put(s) {
  // (one line each: a path with a line break in it is no file of a repository — left out; a '!' keeps its reason on one line)
  if (/[\r\n]/.test(s)) { if (!s.startsWith('!')) return; s = s.replace(/[\r\n]+/g, ' '); }
  if (seen.has(s)) return;
  seen.add(s);
  for (const d of list(OUT)) {
    let fd = fds.get(d);
    if (fd === undefined) { try { fd = O.openSync(path.join(d, NAME), 'a'); } catch { fd = -1; } fds.set(d, fd); }
    if (fd >= 0) try { O.writeSync(fd, s + '\n'); } catch { /* the folder went away (the unit ended): nothing more to do */ }
  }
}
const abs = (p) => (typeof p === 'string' ? (p ? path.resolve(p) : null) : Buffer.isBuffer(p) ? path.resolve(p.toString()) : p instanceof URL ? (p.protocol === 'file:' ? fileURLToPath(p) : null) : null);
const gone = (e) => e?.code === 'ENOENT' || e?.code === 'ENOTDIR';
function saw(kind, p, missing = false) {
  try { const a = abs(p); if (a) put(`${missing ? 'm' : kind} ${a}`); } catch { /* never the process's problem */ }
}
const inside = (p, d) => p === d || p.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
const isFile = (f) => { try { return O.statSync(f, { throwIfNoEntry: false })?.isFile() ?? false; } catch { return false; } };

// a folder and all it holds (cp's source, what a sandboxed child may read): its folders listed, its files read; .git/ not
function everything(p) {
  const a = abs(p);
  if (!a) return;
  let n = 0;
  const go = (f) => {
    let st; try { st = O.lstatSync(f); } catch (e) { saw('r', f, gone(e)); return; }
    if (!st.isDirectory()) { put(`r ${f}`); return; }
    put(`d ${f}`);
    if (path.basename(f) === '.git') return;
    let names = []; try { names = O.readdirSync(f); } catch { /* unreadable: listed, nothing under it */ }
    for (const x of names) { if (++n > LIMIT) { put(`! ${a} の中が多すぎて記録しきれない`); return; } go(path.join(f, x)); }
  };
  go(a);
}
// readdir/opendir with recursive: every folder under it is listed too (the ones the result names, the empty ones as Dirents)
function listedUnder(a, r) {
  const o = a[1], base = abs(a[0]);
  if (!o || typeof o !== 'object' || !o.recursive || !base) return;
  if (!Array.isArray(r)) { everything(base); return; }
  for (const e of r) {
    if (e && typeof e === 'object' && !Buffer.isBuffer(e)) {
      const up = path.resolve(e.parentPath ?? e.path ?? base);
      put(`d ${up}`);
      if (e.isDirectory?.()) put(`d ${path.join(up, String(e.name))}`);
    } else put(`d ${path.resolve(base, path.dirname(String(e)))}`);
  }
}

// ---------- patching: a wrapper calls the original once, with the same this and arguments, and notes what came back ----------
const SKIP = new Set(['length', 'name', 'prototype', 'arguments', 'caller']);
function patch(obj, key, make) {
  try {
    const o = obj?.[key];
    if (typeof o !== 'function') return;
    const w = make(o);
    // (what hangs on the original stays: util.promisify.custom on exists, realpathSync.native)
    for (const k of Reflect.ownKeys(o)) if (!SKIP.has(k)) { try { Object.defineProperty(w, k, Object.getOwnPropertyDescriptor(o, k)); } catch { /* keep going */ } }
    Object.defineProperty(w, 'name', { value: o.name, configurable: true });
    Object.defineProperty(w, 'length', { value: o.length, configurable: true });
    obj[key] = w;
  } catch (e) { put(`! ${key} を包めない: ${e?.message ?? e}`); }
}
const first = (a) => [a[0]];
const never = () => false;
// (open for writing only is no read)
const readish = (f) => (f == null ? true : typeof f === 'string' ? /r|\+/.test(f) : typeof f === 'number' ? (f & 3) !== 1 : true);
const opened = (a) => (readish(a[1]) ? [a[0]] : []);
const sync = (kind, { paths = first, miss = never, after } = {}) => (o) => function (...a) {
  let r;
  try { r = Reflect.apply(o, this, a); } catch (e) { for (const p of paths(a)) saw(kind, p, gone(e)); throw e; }
  for (const p of paths(a)) saw(kind, p, miss(r));
  if (after) try { after(a, r); } catch { /* recording only */ }
  return r;
};
const callback = (kind, { paths = first, miss = never, after } = {}) => (o) => function (...a) {
  const k = a.findLastIndex((x) => typeof x === 'function');
  if (k > 0) {
    const cb = a[k], ps = paths(a), args = [...a];
    a[k] = function (e, ...rest) {
      for (const p of ps) saw(kind, p, e ? gone(e) : miss(rest[0]));
      if (!e && after) try { after(args, rest[0]); } catch { /* recording only */ }
      return Reflect.apply(cb, this, [e, ...rest]);
    };
  }
  return Reflect.apply(o, this, a);
};
const promise = (kind, { paths = first, miss = never, after } = {}) => (o) => function (...a) {
  const ps = paths(a), r = Reflect.apply(o, this, a);
  if (!r || typeof r.then !== 'function') return r;
  return r.then((v) => { for (const p of ps) saw(kind, p, miss(v)); if (after) try { after(a, v); } catch { /* recording only */ } return v; },
    (e) => { for (const p of ps) saw(kind, p, gone(e)); throw e; });
};
// cp: its whole source, at the call (before anything is copied)
const whole = (o) => function (...a) { try { everything(a[0]); } catch { /* recording only */ } return Reflect.apply(o, this, a); };

function patchFs() {
  const P = fs.promises;
  for (const k of ['readFile', 'access', 'realpath']) { patch(fs, `${k}Sync`, sync('r')); patch(fs, k, callback('r')); patch(P, k, promise('r')); }
  for (const k of ['stat', 'lstat']) { patch(fs, `${k}Sync`, sync('r', { miss: (r) => r === undefined })); patch(fs, k, callback('r')); patch(P, k, promise('r')); }
  patch(fs, 'openSync', sync('r', { paths: opened })); patch(fs, 'open', callback('r', { paths: opened })); patch(P, 'open', promise('r', { paths: opened }));
  patch(fs, 'copyFileSync', sync('r')); patch(fs, 'copyFile', callback('r')); patch(P, 'copyFile', promise('r'));
  for (const k of ['readdir', 'opendir']) { patch(fs, `${k}Sync`, sync('d', { after: listedUnder })); patch(fs, k, callback('d', { after: listedUnder })); patch(P, k, promise('d', { after: listedUnder })); }
  patch(fs, 'cpSync', whole); patch(fs, 'cp', whole); patch(P, 'cp', whole);
  patch(fs, 'existsSync', sync('r', { miss: (r) => r === false }));
  patch(fs, 'exists', (o) => function (...a) {
    if (typeof a[1] === 'function') { const cb = a[1], p = a[0]; a[1] = function (x) { saw('r', p, !x); return Reflect.apply(cb, this, [x]); }; }
    return Reflect.apply(o, this, a);
  });
  patch(fs, 'createReadStream', (o) => function (...a) { try { saw('r', a[0], !O.existsSync(a[0])); } catch { /* recording only */ } return Reflect.apply(o, this, a); });
  if (typeof fs.realpathSync === 'function') patch(fs.realpathSync, 'native', sync('r'));
  if (typeof fs.realpath === 'function') patch(fs.realpath, 'native', callback('r'));
}

// ---------- child processes ----------
const isOpts = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNode = (c) => c === process.execPath || /^node(js)?(\.exe)?$/i.test(path.basename(String(c ?? '')));
const words = (s) => (String(s).match(/"[^"]*"|'[^']*'|[^\s"']+/g) ?? []).map((w) => w.replace(/^(["'])([\s\S]*)\1$/, '$2'));
function onPath(name, env, cwd) {
  const exts = process.platform === 'win32' ? ['', ...String(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  for (const d of list(env.PATH ?? env.Path)) for (const e of exts) { const f = path.resolve(cwd, d, name + e); if (isFile(f)) return f; }
  return null;
}
// the files on a child's command line: the command (a bare name: where the child's PATH finds it) and each argument (--x=<file>
// too); a shell's line word by word, the word after && || | ; & ( a command again
function ran(toks, env, cwd, lookup) {
  let cmd = lookup;
  for (const t of toks) {
    if (/^(&&|\|\||\||;|&|\()$/.test(t)) { cmd = lookup; continue; }
    if (t && t.length < 4096 && !t.includes('\0')) {
      if (cmd && !/[\\/]/.test(t)) { const f = onPath(t, env, cwd); if (f) put(`x ${f}`); }
      else for (const c of [t, ...(/^-[^=]*=(.+)$/.exec(t)?.slice(1) ?? [])]) { const f = path.resolve(cwd, c); if (isFile(f)) put(`x ${f}`); }
    }
    cmd = false;
  }
}
// a sandboxed node child (--permission): what it may read, recorded from here
function allowed(args, cwd) {
  const vals = [];
  args.forEach((x, k) => { const m = /^--allow-fs-read(?:=(.*))?$/.exec(x); if (m) vals.push(m[1] ?? args[k + 1]); });
  const roots = [...list(ROOT), os.tmpdir()].map((r) => path.resolve(r));
  for (const v of vals) {
    if (v == null) continue;
    for (const one of O.existsSync(path.resolve(cwd, v)) ? [v] : String(v).split(',')) {
      if (one === '*') { put('! --permission の子が何でも読める（--allow-fs-read=*）'); continue; }
      const p = path.resolve(cwd, one);
      if (roots.some((r) => inside(p, r))) everything(p);
      else if (roots.some((r) => inside(r, p))) put(`! --permission の子が ${p} の下をすべて読める（記録しきれない）`);
    }
  }
}
const carries = (env) => String(env.NODE_OPTIONS ?? '').includes(HOOK) && list(OUT).every((d) => list(env.LAB_DEPS_OUT).includes(d)) && list(ROOT).every((d) => list(env.LAB_DEPS_ROOT).includes(d));
const withRecorder = (env) => ({ ...env, NODE_OPTIONS: String(env.NODE_OPTIONS ?? '').includes(HOOK) ? env.NODE_OPTIONS : `${env.NODE_OPTIONS ?? ''} ${IMPORT}`.trim(), LAB_DEPS_OUT: union(env.LAB_DEPS_OUT, OUT), LAB_DEPS_ROOT: union(env.LAB_DEPS_ROOT, ROOT) });
function withoutRecorder(env) {
  const n = String(env.NODE_OPTIONS ?? '');
  if (!/deps-hook\.mjs/.test(n)) return env;
  return { ...env, NODE_OPTIONS: n.split(/\s+/).filter((x) => x && !/^--import=.*deps-hook\.mjs$/.test(x)).join(' ') };
}
// a child_process call's arguments → the same call with the recorder in the child's env (how: spawn | fork | shell)
function forChild(how, a) {
  const i = a.findIndex((x, k) => k >= 1 && isOpts(x));
  const o = i >= 0 ? a[i] : undefined, env = o?.env ?? process.env;
  const cwd = (o?.cwd != null && abs(o.cwd)) || process.cwd();
  const args = how !== 'shell' && Array.isArray(a[1]) ? a[1].map(String) : [];
  const shell = how === 'shell' || !!o?.shell;
  const toks = shell ? words([a[0], ...args].join(' ')) : [String(a[0]), ...args];
  try { ran(toks, env, cwd, how !== 'fork'); } catch { /* recording only */ }
  const nodeArgs = how === 'fork' ? [...(o?.execArgv ?? process.execArgv)].map(String) : isNode(toks[0]) ? toks.slice(1) : [];
  const sandboxed = nodeArgs.some((x) => /^--(experimental-)?permission$/.test(x)) || /--(experimental-)?permission\b/.test(String(env.NODE_OPTIONS ?? ''));
  let next;
  if (sandboxed) { try { allowed(nodeArgs, cwd); } catch { put('! --permission の子の読める場所を記録できない'); } next = withoutRecorder(env); if (next === env) return a; }
  else { if (carries(env)) return a; next = withRecorder(env); }
  const no = { ...(o ?? {}), env: next };
  if (i >= 0) a[i] = no; else a.splice(Array.isArray(a[1]) ? 2 : 1, 0, no);
  return a;
}
function patchChild() {
  for (const [key, how] of [['spawn', 'spawn'], ['spawnSync', 'spawn'], ['execFile', 'spawn'], ['execFileSync', 'spawn'], ['fork', 'fork'], ['exec', 'shell'], ['execSync', 'shell']]) {
    patch(child, key, (o) => function (...a) {
      let b = a;
      try { b = forChild(how, [...a]); } catch { b = a; }
      return Reflect.apply(o, this, b);
    });
  }
}

// a worker runs NODE_OPTIONS' --import from its own env: one given an env of its own gets the recorder there too, as a child
// does. One given code to evaluate (eval: true) runs no --import at all: its code loads the recorder first (after a 'use strict'
// it starts with); where this node cannot do that (no require of an ES module), a '!'
function patchWorker() {
  const W = wt.Worker, file = fileURLToPath(HOOK);
  if (typeof W !== 'function') return;
  const can = typeof process.getBuiltinModule === 'function' && process.features?.require_module === true;
  const load = `process.getBuiltinModule('node:module').createRequire(${JSON.stringify(file)})(${JSON.stringify(file)});\n`;
  wt.Worker = class Worker extends W {
    constructor(what, opts, ...rest) {
      try {
        if (isOpts(opts) && isOpts(opts.env) && !carries(opts.env)) opts = { ...opts, env: withRecorder(opts.env) };
        if (opts?.eval && typeof what === 'string') {
          if (!can) put('! eval の worker に記録を入れられない（require で ES モジュールを読めない node）');
          else { const m = /^\s*(['"])use strict\1;?/.exec(what); what = m ? `${m[0]}\n${load}${what.slice(m[0].length)}` : load + what; }
        }
      } catch { /* as it is */ }
      super(what, opts, ...rest);
    }
  };
}

function start() {
  if (typeof module.registerHooks !== 'function') put(`! module.registerHooks がない（Node ${process.version}）: import と require を記録できない`);
  else {
    module.registerHooks({
      resolve(spec, ctx, next) {
        try { return next(spec, ctx); } catch (e) {
          // (a relative one not there: that file, and its folder's names — a file added there may be the one it looks for)
          try {
            const p = /^\.{1,2}(\/|$)|^\//.test(spec) && String(ctx?.parentURL ?? '').startsWith('file:') ? fileURLToPath(new URL(spec, ctx.parentURL)) : spec.startsWith('file:') ? fileURLToPath(spec) : null;
            if (p) { saw('r', p, true); put(`d ${path.dirname(p)}`); }
          } catch { /* no path in it */ }
          throw e;
        }
      },
      load(url, ctx, next) {
        try { if (String(url).startsWith('file:')) saw('r', fileURLToPath(url)); } catch { /* not a file */ }
        return next(url, ctx);
      },
    });
  }
  patchFs();
  patchChild();
  try { patchWorker(); } catch (e) { put(`! Worker を包めない: ${e?.message ?? e}`); }
  module.syncBuiltinESMExports();
  try { setEnvironmentData(SHARED, { out: OUT, root: ROOT }); } catch { /* no workers then */ }
}

// a worker given an env of its own still records: the thread that started it handed the folders on
if (!OUT && !isMainThread) { try { const d = getEnvironmentData(SHARED); if (d?.out) { OUT = d.out; ROOT = d.root ?? ''; } } catch { /* none */ } }
if (OUT && !globalThis[ACTIVE]) {
  globalThis[ACTIVE] = true;
  try { start(); } catch (e) { put(`! 記録の準備に失敗: ${e?.message ?? e}`); }
}
