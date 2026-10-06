#!/usr/bin/env node
// One entry for every lab: node lab.mjs [bds|end|ll] <cmd> ... (the lab is remembered in .lab-kind; first time: bds).
// It becomes that lab's own lab.mjs (same process, cwd = the lab), so everything <lab>/AGENTS.md says holds unchanged.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.dirname(fileURLToPath(import.meta.url)), MEM = path.join(TOP, '.lab-kind'), KINDS = ['bds', 'end', 'll'];
const A = process.argv.slice(2);
// `<command> [sub] --help` (or -h): that command's help, never the command itself (an AI asking `skill verify --help` started
// every probe on a real server; `skill bench --help` a paid AI run). `help` finds the topic, or the lines that name it.
if (A.includes('--help') || A.includes('-h')) {
  if (KINDS.includes(A[0])) process.env.LAB_KIND = A.shift();   // (that lab's help, without making it the remembered lab)
  const words = A.filter((a) => a !== '--help' && a !== '-h' && !a.startsWith('-'));
  const w = words[0] === 'help' ? words.slice(1) : words;
  A.splice(0, A.length, 'help', ...(w.length >= 2 && /^[a-z][\w-]*$/.test(w[1]) ? [`${w[0]} ${w[1]}`] : w.slice(0, 1)));
  process.argv.splice(2, process.argv.length, ...A);
}
// the person's settings: .env (by hand, .env.example lists them) and .env.local (written by `login`); passwords stay out of the
// environment (common/secrets.mjs). Tools the lab fetched for the person (gh) live in .lab-tools/bin.
if (process.env.LAB_DOTENV !== 'off') try { (await import('./common/secrets.mjs')).loadDotenv(TOP); } catch { /* an older copy without it (update) */ }
{ const tb = path.join(TOP, '.lab-tools', 'bin'); if (fs.existsSync(tb) && !(process.env.PATH ?? '').includes(tb)) process.env.PATH = tb + path.delimiter + (process.env.PATH ?? ''); }
const top = async (m, fn, ...a) => { try { const r = await (await import(pathToFileURL(path.join(TOP, 'common', m)).href))[fn](...a); process.stdout.write('', () => process.exit(r === false ? 1 : 0)); } catch (e) { console.log(`ERR ${e.message}`); process.exit(1); } };
// ---- for AIs whose tool cuts a command off after N seconds (or kills it on return), on any OS ----
// bg <args>: run `node lab.mjs <args>` detached, output → .lab-run.txt. wait [s]: print what is new, up to s seconds (default 45);
// the last line is `RUNNING (bg)` until it ends, then `DONE exit=<n>`. Only one bg job at a time.
const RUN = path.join(TOP, '.lab-run.txt'), RUNX = path.join(TOP, '.lab-run.json');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const job = () => { try { return JSON.parse(fs.readFileSync(RUNX, 'utf8')); } catch { return null; } };
if (A[0] === '__bgrun') {   // the detached wrapper: runs the command, records its exit code
  const { spawnSync } = await import('node:child_process');
  const fd = fs.openSync(RUN, 'a');
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...A.slice(1)], { cwd: TOP, stdio: ['ignore', fd, fd] });
  const j = job() ?? {}; j.exit = r.status ?? 1; j.end = Date.now(); fs.writeFileSync(RUNX, JSON.stringify(j));
  process.exit(0);
}
if (A[0] === 'bg') {
  const j = job();
  if (j && j.exit === undefined && alive(j.pid)) { console.log(`ERR a bg job is running: ${j.cmd} (node lab.mjs wait | node lab.mjs stop)`); process.exit(1); }
  if (!A[1]) { console.log('usage: node lab.mjs bg <lab command...>   then: node lab.mjs wait [seconds]'); process.exit(1); }
  const { spawn } = await import('node:child_process');
  fs.writeFileSync(RUN, '');
  const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), '__bgrun', ...A.slice(1)], { cwd: TOP, detached: true, stdio: 'ignore', windowsHide: true });
  fs.writeFileSync(RUNX, JSON.stringify({ pid: c.pid, cmd: A.slice(1).join(' '), start: Date.now(), seen: 0 }));
  c.unref();
  console.log(`started: ${A.slice(1).join(' ')}\nnext: node lab.mjs wait   (repeat until DONE)`);
  process.exit(0);
}
if (A[0] === 'wait' || A[0] === 'stop') {
  let j = job();
  if (!j) { console.log('no bg job (start one: node lab.mjs bg <command>)'); process.exit(1); }
  if (A[0] === 'stop') { try { process.kill(process.platform === 'win32' ? j.pid : -j.pid); } catch { try { process.kill(j.pid); } catch { /* gone */ } } j.exit = 'stopped'; j.end = Date.now(); fs.writeFileSync(RUNX, JSON.stringify(j)); console.log(`stopped: ${j.cmd}`); process.exit(0); }
  const until = Date.now() + 1000 * (Number(A[1]) || 45);
  const done = () => (j = job() ?? j).exit !== undefined || !alive(j.pid);
  while (!done() && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  const text = fs.readFileSync(RUN, 'utf8'), fresh = text.slice(j.seen ?? 0);
  j.seen = text.length; fs.writeFileSync(RUNX, JSON.stringify(j));
  if (fresh.trim()) process.stdout.write(fresh.endsWith('\n') ? fresh : fresh + '\n');
  const secs = Math.round(((j.end ?? Date.now()) - j.start) / 1000);
  if (j.exit !== undefined) { console.log(`DONE exit=${j.exit} (${secs}s: ${j.cmd})`); process.exit(typeof j.exit === 'number' ? j.exit : 1); }
  if (!alive(j.pid)) { console.log(`DONE exit=? (the job vanished: killed with its sandbox? ${j.cmd})`); process.exit(1); }
  console.log(`RUNNING ${secs}s: ${j.cmd}  (again: node lab.mjs wait)`); process.exit(0);
}
// ---- setup all: every lab's server and tools now (e.g. in a setup phase that has network, before it is cut) ----
if (A[0] === 'setup' && A[1] === 'all') {
  const { spawnSync } = await import('node:child_process');
  let ok = true;
  for (const k of ['bds', 'end', 'll']) {
    const r = spawnSync(process.execPath, [path.join(TOP, k, 'lab.mjs'), 'setup', ...A.slice(2)], { cwd: path.join(TOP, k), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256e6 });
    const t = ((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n');
    ok = ok && r.status === 0;
    console.log(`${k}: ${r.status === 0 ? t.at(-1) : t.filter((l) => /^ERR|→/.test(l)).slice(-3).join(' | ') || t.at(-1)}`);
  }
  console.log(ok ? 'OK' : 'FAIL (node lab.mjs doctor says why; a lab you do not use can stay failed)');
  process.exit(ok ? 0 : 1);
}
// ---- cache export/import: carry the downloaded servers and tools to a machine without network (same OS and CPU) ----
if (A[0] === 'cache' && (A[1] === 'export' || A[1] === 'import')) {
  const { spawnSync } = await import('node:child_process');
  const f = path.resolve(A[2] ?? 'bds-lab-cache.tgz');
  const tag = `${process.platform}-${process.arch}`;
  if (A[1] === 'export') {
    const have = KINDS.filter((k) => fs.existsSync(path.join(TOP, k, '.lab')));
    if (!have.length) { console.log('ERR nothing to export: run node lab.mjs setup all first'); process.exit(1); }
    fs.writeFileSync(path.join(TOP, '.lab-cache-for'), tag + '\n');
    const r = spawnSync('tar', ['-czf', f, '--exclude=*/.lab/run', '--exclude=*/.lab/runs', '--exclude=*.log', '.lab-cache-for', ...have.map((k) => `${k}/.lab`)], { cwd: TOP, stdio: 'inherit' });
    fs.rmSync(path.join(TOP, '.lab-cache-for'), { force: true });
    if (r.status !== 0) process.exit(1);
    console.log(`OK ${f} (${(fs.statSync(f).size / 1e6).toFixed(0)} MB; ${have.join(' ')}; for ${tag}). There: node lab.mjs cache import <file>`);
  } else {
    if (!fs.existsSync(f)) { console.log(`ERR no such file: ${f}`); process.exit(1); }
    const r = spawnSync('tar', ['-xzf', f], { cwd: TOP, stdio: 'inherit' });
    let from = '?'; try { from = fs.readFileSync(path.join(TOP, '.lab-cache-for'), 'utf8').trim(); fs.rmSync(path.join(TOP, '.lab-cache-for')); } catch { /* old */ }
    if (r.status !== 0) process.exit(1);
    console.log(from !== tag ? `W made on ${from}, this is ${tag}: servers/tools may not run; setup replaces what it can` : `OK imported (${from}). Check: node lab.mjs selftest all`);
  }
  process.exit(0);
}
// ---- patches: the chat loop without zip downloads (and for chat AIs that cannot return files at all) ----
// .lab-base.json = the hash of every work file when this folder arrived (made by the first command run here). `patch` prints
// every change since then as one text block (cumulative: the newest patch alone brings a copy up to date). `apply` (and verify,
// from the clipboard) writes it into this folder: only files inside it, never caches.
const BASE = path.join(TOP, '.lab-base.json');
// (dist/: what go and share build again — except vendored code under common/, e.g. common/nethernet-connect/dist, which `lan` runs)
const isOutDist = (r) => /(^|\/)dist(\/|$)/.test(r) && !/^common\/[^/]+\/dist(\/|$)/.test(r);
const workSkip = (r) => /(^|\/)(\.lab|\.lab-node|\.lab-node\.tmp|\.lab-tools|node_modules|runs|\.git)(\/|$)/.test(r) || isOutDist(r) || /^(\.lab-run\.|\.lab-base\.json|\.lab-patch\.txt|verify-result\.txt|\.lab-kind$|carry\/)/.test(r) || /\.(tgz|zip|mcaddon|mcpack|whl)$/.test(r)
  || /(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(r) || /\.(apk|apks|xapk|so)$/i.test(r) || /^auto\/(\.work|\.lease\.json|\.scheduled\.log|\.lock)/.test(r);   // app lab: secrets and game binaries never travel in a patch or handoff
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
function workFiles() {
  const outp = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = path.relative(TOP, p).split(path.sep).join('/'); if (workSkip(r + (e.isDirectory() ? '/' : ''))) continue; if (e.isDirectory()) walk(p); else if (e.isFile()) outp[r] = p; } };
  walk(TOP); return outp;
}
// the starting point: hashes (.lab-base.json, travels with the folder) + the contents (.lab/base/, so edits can be sent as line changes)
const BASEDIR = path.join(TOP, '.lab', 'base');
if (!fs.existsSync(BASE) && !['__bgrun', 'wait', 'stop'].includes(A[0])) {
  try {
    const snap = {};
    // copies only of the text files a patch may send as line edits (a big or binary file goes whole anyway): the base was a
    // second copy of the whole folder (TS-REPL's 8 MB blob, sandbox-be's data) for nothing
    for (const [r, p] of Object.entries(workFiles())) { const b = fs.readFileSync(p); snap[r] = sha(b); if (b.length > 256e3 || b.subarray(0, 8000).includes(0)) continue; const d = path.join(BASEDIR, r); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, b); }
    fs.writeFileSync(BASE, JSON.stringify(snap) + '\n');
  } catch { /* read-only folder */ }
}
const isText = (b) => !b.includes(0) && b.toString('utf8').indexOf('\ufffd') < 0;
const baseCopy = (r, want) => { try { const b = fs.readFileSync(path.join(BASEDIR, r)); return sha(b) === want ? b : null; } catch { return null; } };
// line changes old → new: [[oldLine (1-based), deleteCount, [inserted lines]], ...] (common prefix/suffix trimmed, LCS in between)
function lineEdits(a, b) {
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const A2 = a.slice(p, a.length - q), B2 = b.slice(p, b.length - q), n = A2.length, m = B2.length;
  if (n * m > 4e6) return [[p + 1, n, B2]];   // too big to align: replace the middle
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A2[i] === B2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ed = []; let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { ed.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && A2[i] === B2[j]) { flush(); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { cur ??= [p + i + 1, 0, []]; cur[2].push(B2[j++]); }
    else { cur ??= [p + i + 1, 0, []]; cur[1]++; i++; }
  }
  flush();
  return ed;
}
const splitLines = (t) => (t.endsWith('\n') ? t.slice(0, -1) : t).split('\n');
if (A[0] === 'patch') {
  let base = {}; try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch { /* none */ }
  const full = A.includes('--full');
  const now = workFiles(), lines = [], changed = [];
  for (const [r, p] of Object.entries(now).sort()) {
    const b = fs.readFileSync(p), h = sha(b);
    if (base[r] === h) continue;
    changed.push(r);
    const t = isText(b) ? b.toString('utf8') : null, old = !full && t !== null && base[r] ? baseCopy(r, base[r]) : null;
    if (old && isText(old) && old.toString('utf8').endsWith('\n') === t.endsWith('\n')) {
      // an edit of a file the person has: only the changed lines (smaller to send, less for the AI to copy)
      const ed = lineEdits(splitLines(old.toString('utf8')), splitLines(t));
      const body = ed.flatMap(([at, del, ins]) => [`@ ${at} ${del}`, ...ins.map((x) => '+' + x)]);
      if (body.join('\n').length < t.length * 0.7) { lines.push(`@@@ edit ${r} was=${base[r]} now=${h}`, ...body); continue; }
    }
    if (t !== null && !/^@@@ /m.test(t)) lines.push(`@@@ file ${r} was=${base[r] ?? 'new'} now=${h}${t.endsWith('\n') || !t ? '' : ' nl=0'}`, ...(t ? splitLines(t) : []));
    else lines.push(`@@@ b64 ${r} was=${base[r] ?? 'new'} now=${h}`, ...(b.toString('base64').match(/.{1,120}/g) ?? ['']));
  }
  for (const r of Object.keys(base).sort()) if (!now[r]) { changed.push(r); lines.push(`@@@ delete ${r} was=${base[r]}`); }
  if (!changed.length) { console.log('OK no changes since this folder arrived (nothing to patch)'); process.exit(0); }
  let k0 = 'bds'; try { const x = fs.readFileSync(MEM, 'utf8').trim(); if (KINDS.includes(x)) k0 = x; } catch { /* default */ }
  let u0 = ''; try { u0 = fs.readFileSync(path.join(TOP, k0, '.lab', 'addon'), 'utf8').trim(); } catch { /* none */ }
  lines.unshift(`@@@ meta lab=${k0}${u0 ? ' unit=' + u0 : ''}`);
  const body = lines.join('\n'), id = sha(body);
  const block = `===== bds-lab patch ${id} (${changed.length} files) =====\n${body}\n===== end patch ${id} =====`;
  fs.writeFileSync(path.join(TOP, '.lab-patch.txt'), block + '\n');
  console.log(block);
  console.error(`\n${changed.length} files, ${(block.length / 1024).toFixed(1)} KB (also in .lab-patch.txt). Copy it EXACTLY, whole, into ONE code block of your reply (fence: ~~~~); every file carries a checksum, so a slip is caught on their side.${block.length > 40000 ? ' Large: if your reply may get cut off, attach .lab-patch.txt as a file, or `node lab.mjs handoff`.' : ''}`);
  process.exit(0);
}
function readClipboard() {
  if (process.env.LAB_CLIPBOARD_FILE) { try { return fs.readFileSync(process.env.LAB_CLIPBOARD_FILE, 'utf8'); } catch { return ''; } }   // tests
  const { spawnSync } = globalThis.__cp;
  const tries = process.platform === 'darwin' ? [['pbpaste']] : process.platform === 'win32' ? [['powershell', '-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw']] : [['wl-paste', '-n'], ['xclip', '-o', '-selection', 'clipboard'], ['xsel', '-b', '-o']];
  const env = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };   // pbpaste follows the locale (not always UTF-8)
  for (const [c, ...a] of tries) { const r = spawnSync(c, a, { encoding: 'utf8', timeout: 5000, maxBuffer: 64e6, env }); if (r.status === 0 && r.stdout) return r.stdout; }
  return '';
}
// apply: every op is checked (was= the file it starts from, now= what must come out); a garbled copy writes nothing for that file
function applyPatch(text) {
  const m = text.replace(/\r\n/g, '\n').match(/===== bds-lab patch (\w+)[^\n]*=====\n([\s\S]*?)\n===== end patch \1 =====/);
  if (!m) return null;
  const [, id, body] = m, lines = body.split('\n'), notes = [], ops = [], bad = [];
  let base = {}; try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch { /* none */ }
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^@@@ (file|b64|delete|edit) (\S+) was=(\S+)(?: now=(\S+))?( nl=0)?\s*$/);
    if (!h) continue;
    const [, kind, r, was, want, nl0] = h, content = [];
    while (i + 1 < lines.length && !/^@@@ (file|b64|delete|edit|meta) /.test(lines[i + 1])) content.push(lines[++i]);
    const dest = path.resolve(TOP, r);
    if (!dest.startsWith(TOP + path.sep) || workSkip(r)) { notes.push(`skipped ${r} (outside the work files)`); continue; }
    let data = null;
    if (kind === 'b64') data = Buffer.from(content.join('').replace(/\s+/g, ''), 'base64');
    else if (kind === 'file') { while (content.length && content.at(-1) === '' && want === '?') content.pop(); data = Buffer.from(content.join('\n') + (nl0 || !content.length ? '' : '\n')); }
    else if (kind === 'edit') {
      // start from the base copy or this file, whichever is the version the AI edited (was=)
      const cur = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
      const src = baseCopy(r, was) ?? (cur && sha(cur) === was ? cur : null);
      if (!src) { bad.push(`${r}: the version this edit starts from is not here`); continue; }
      const t = src.toString('utf8'), arr = splitLines(t), hunks = [];
      for (let k = 0; k < content.length; k++) { const hm = content[k].match(/^@ (\d+) (\d+)$/); if (!hm) continue; const ins = []; while (k + 1 < content.length && content[k + 1].startsWith('+')) ins.push(content[++k].slice(1)); hunks.push([Number(hm[1]), Number(hm[2]), ins]); }
      for (const [at, del, ins] of hunks.sort((x, y) => y[0] - x[0])) arr.splice(at - 1, del, ...ins);
      data = Buffer.from(arr.join('\n') + (t.endsWith('\n') ? '\n' : ''));
    }
    if (data && want && want !== '?' && sha(data) !== want) { bad.push(`${r}: garbled in the copy (checksum ${sha(data)} ≠ ${want})`); continue; }
    ops.push({ kind, r, was, dest, data });
  }
  if (bad.length) return { id, n: 0, total: ops.length + bad.length, notes, bad };   // all or nothing: never half a patch
  const meta = body.match(/^@@@ meta lab=(\w+)(?: unit=([\w-]+))?$/m);
  if (meta && KINDS.includes(meta[1])) {   // the lab and unit the AI worked on become current here too
    fs.writeFileSync(MEM, meta[1] + '\n');
    if (meta[2]) { fs.mkdirSync(path.join(TOP, meta[1], '.lab'), { recursive: true }); fs.writeFileSync(path.join(TOP, meta[1], '.lab', 'addon'), meta[2] + '\n'); }
  }
  const bak = path.join(TOP, '.lab', 'patch-backup', id); let n = 0;
  for (const o of ops) {
    const cur = fs.existsSync(o.dest) ? fs.readFileSync(o.dest) : null;
    if (o.data && cur && cur.equals(o.data)) continue;   // already applied (patches are cumulative)
    if (o.kind === 'delete' && !cur) continue;
    if (cur && o.kind !== 'edit' && !['new', '?'].includes(o.was) && sha(cur) !== o.was && sha(cur) !== base[o.r]) notes.push(`${o.r} had changed here since the AI's copy: replaced (old one in .lab/patch-backup/${id}/)`);
    if (cur) { fs.mkdirSync(path.dirname(path.join(bak, o.r)), { recursive: true }); fs.writeFileSync(path.join(bak, o.r), cur); }
    if (o.kind === 'delete') fs.rmSync(o.dest, { force: true });
    else { fs.mkdirSync(path.dirname(o.dest), { recursive: true }); fs.writeFileSync(o.dest, o.data); }
    n++;
  }
  return { id, n, total: ops.length + bad.length, notes, bad };
}
if (A[0] === 'apply') {
  globalThis.__cp = await import('node:child_process');
  const pf = A[1] && A[1] !== '-' ? path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), A[1]) : null;
  if (pf && !fs.existsSync(pf)) { console.log(`ERR no such file: ${A[1]} (usage: node lab.mjs apply [<patch file> | - for stdin]; no argument: the clipboard)`); process.exit(1); }
  const text = A[1] ? fs.readFileSync(A[1] === '-' ? 0 : pf, 'utf8') : readClipboard();
  const r = applyPatch(text);
  if (!r) { console.log(`ERR no bds-lab patch ${A[1] ? 'in ' + A[1] : 'on the clipboard'} (copy the AI's whole block, from ===== bds-lab patch to ===== end patch)`); process.exit(1); }
  for (const x of r.notes) console.log('W ' + x);
  for (const x of r.bad) console.log('E ' + x);
  if (r.bad.length) { console.log(`FAIL patch ${r.id}: ${r.bad.length} file(s) not written: ask the AI to send the patch again (\`node lab.mjs patch --full\`, or as a file)`); process.exit(1); }
  console.log(`OK patch ${r.id}: ${r.n} of ${r.total} files written${r.n < r.total ? ' (the rest were already up to date)' : ''}`);
  process.exit(0);
}
// ---- chat relay: a chat AI (no network) builds, hands the folder back; a person verifies on their PC and pastes the result ----
const labKind = () => { try { const k = fs.readFileSync(MEM, 'utf8').trim(); return KINDS.includes(k) ? k : 'bds'; } catch { return 'bds'; } };
const unitOf = (k) => { try { return fs.readFileSync(path.join(TOP, k, '.lab', 'addon'), 'utf8').trim(); } catch { return ''; } };   // the lab's current unit
function zipDir(root, prefix, skip) {   // a small zip writer (deflate), no tools needed
  const zlib = globalThis.__zlib, crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const parts = [], cen = []; let off = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = path.relative(root, p).split(path.sep).join('/'); if (skip(r, e)) continue; if (e.isDirectory()) walk(p); else if (e.isFile()) add(prefix + r, fs.readFileSync(p), fs.statSync(p).mode & 0o777); } };
  const add = (name, data, mode = 0o644) => {
    const n = Buffer.from(name), z = zlib.deflateRawSync(data), c = crc(data), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(c, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const ce = Buffer.alloc(46); ce.writeUInt32LE(0x02014b50, 0); ce.writeUInt16LE((3 << 8) | 20, 4); ce.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); ce.writeUInt16LE(20, 6); ce.writeUInt16LE(0x800, 8); ce.writeUInt16LE(8, 10); ce.writeUInt32LE(c, 16); ce.writeUInt32LE(z.length, 20); ce.writeUInt32LE(data.length, 24); ce.writeUInt16LE(n.length, 28); ce.writeUInt32LE(off, 42);
    parts.push(h, n, z); cen.push(ce, n); off += 30 + n.length + z.length;
  };
  walk(root);
  const cd = Buffer.concat(cen), end = Buffer.alloc(22), cnt = cen.length / 2;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cnt, 8); end.writeUInt16LE(cnt, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return { buf: Buffer.concat([...parts, cd, end]), count: cnt };
}
// handoff [dir]: the whole folder (no caches) as one zip where the chat shows files, plus what to tell the person
if (A[0] === 'handoff') {
  globalThis.__zlib = (await import('node:zlib')).default;
  const k = labKind(), unit = unitOf(k);
  const dir = A[1] ?? ['/mnt/user-data/outputs', '/mnt/data', path.join(os.homedir(), 'outputs')].find((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } }) ?? path.dirname(TOP);
  const name = `bds-lab-${k}${unit ? '-' + unit : ''}.zip`;
  // no caches (servers, tools, worlds: they are fetched again) and no dist/ (go builds it again); keep each lab's current-unit
  // marker (<lab>/.lab/addon)
  const skip = (r) => { if (/^(bds|end|ll)\/\.lab$/.test(r)) return false; if (/^(bds|end|ll)\/\.lab\//.test(r)) return !/^(bds|end|ll)\/\.lab\/addon$/.test(r);
    return /(^|\/)(\.lab|\.lab-node|\.lab-node\.tmp|\.lab-tools|node_modules|runs|\.git|\.logs)$/.test(r) || (/(^|\/)dist$/.test(r) && isOutDist(r)) || /^(\.lab-run\.|verify-result|\.lab-base\.json$|\.lab-patch\.txt$)/.test(r) || /\.tgz$/.test(r)
      || /(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(r) || /\.(apk|apks|xapk)$/i.test(r) || /^auto\/(\.work|\.lease\.json|\.scheduled\.log|\.lock)/.test(r); };   // (.env*: the app lab's Google secrets)   // (.logs: race logs)
  const { buf, count } = zipDir(TOP, 'bds-lab/', skip);
  fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, buf);
  console.log(`OK ${f} (${count} files, ${(buf.length / 1e6).toFixed(1)} MB; lab ${k}${unit ? ', unit ' + unit : ''})`);
  console.log(`tell the person: download it, unzip, then double-click verify.command (Mac) / verify.cmd (Windows), or run ./lab.sh verify (Linux), and paste what it prints into this chat.`);
  process.exit(0);
}
// verify [unit]: on a machine with network — setup if needed, check, test (fresh world, tests.txt), qa, pack; one paste-ready block
if (A[0] === 'verify') {
  globalThis.__cp = await import('node:child_process');
  const { spawnSync } = globalThis.__cp;
  const watch = A.includes('--watch');
  const pfile = A.find((x, i) => i > 0 && /\.txt$/.test(x) && fs.existsSync(x));   // verify <patch.txt>: from a file (no clipboard tool, or saved from the chat)
  if (pfile) A.splice(A.indexOf(pfile), 1);
  const argK = KINDS.includes(A[1]) ? A.splice(1, 1)[0] : null, argUnit = A.filter((x) => !x.startsWith('--'))[1] ?? null;
  { const k0 = argK ?? labKind(), dirOf = { bds: 'addons', end: 'plugins', ll: 'mods' }[k0];
    if (argUnit && !fs.existsSync(path.join(TOP, k0, dirOf, argUnit))) { console.log(`ERR verify: no ${k0} unit "${argUnit}" (${k0}/${dirOf}/); usage: node lab.mjs verify [bds|end|ll] [<unit>] [<patch.txt>] [--watch] [--no-apply]`); process.exit(1); } }
  const copy = (block) => {
    if (process.env.LAB_CLIPBOARD_FILE) { fs.writeFileSync(process.env.LAB_CLIPBOARD_FILE, block); return true; }   // tests
    if (process.platform === 'win32') {   // clip.exe reads the console code page: go through a UTF-8 file instead
      const f = path.join(os.tmpdir(), `bds-lab-clip-${process.pid}.txt`); fs.writeFileSync(f, block);
      const r = spawnSync('powershell', ['-NoProfile', '-Command', `Get-Content -Raw -Encoding UTF8 -LiteralPath '${f.replace(/'/g, "''")}' | Set-Clipboard`]);
      fs.rmSync(f, { force: true }); return r.status === 0;
    }
    for (const c of process.platform === 'darwin' ? ['pbcopy'] : ['wl-copy', 'xclip -selection clipboard', 'xsel -b']) { const [cmd, ...a] = c.split(' '); if (spawnSync(cmd, a, { input: block, env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } }).status === 0) return true; }
    return false;
  };
  const done = (block, code) => {
    fs.writeFileSync(path.join(TOP, 'verify-result.txt'), block + '\n');
    console.log(block);
    console.log(copy(block) ? '(copied to the clipboard: just paste it into the chat)' : '(copy it from here, or from verify-result.txt)');
    return code;
  };
  // one round: the AI's patch (clipboard or file) applied first, then check, test on a real server, pack; a paste-ready block
  const once = (patchText) => {
    const pt = patchText ? applyPatch(patchText) : null;
    if (pt) { console.error(`applied patch ${pt.id}: ${pt.n} of ${pt.total} files written`); for (const x of pt.notes) console.error('W ' + x); }
    if (pt?.bad.length) return done([`===== bds-lab verify (paste all of this into the chat) =====`, `patch ${pt.id}: NOT APPLIED, ${pt.bad.length} file(s) came through garbled:`, ...pt.bad.map((x) => '  ' + x), 'send it again: `node lab.mjs patch --full` in one code block, or attach .lab-patch.txt', '===== end ====='].join('\n'), 1);
    const k = argK ?? labKind(), unit = argUnit ?? unitOf(k);   // after the patch: it may have switched the lab or unit
    const run = (args) => { const r = spawnSync(process.execPath, [path.join(TOP, k, 'lab.mjs'), ...args, ...(unit ? ['-a', unit] : [])], { cwd: path.join(TOP, k), encoding: 'utf8', maxBuffer: 256e6, env: { ...process.env, FORCE_COLOR: '0' } }); return { ok: r.status === 0, lines: ((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n').filter(Boolean) }; };
    const keep = (lines, n) => { const imp = lines.filter((l) => /^(E|W|T|Q|S|✘|FAIL|ERR|PASS|OK|##|  |expected|got|@)/.test(l)); const x = (imp.length ? imp : lines); return x.length > n ? [...x.slice(0, n - 1), `… ${x.length - n + 1} more lines (full: ${k}/.lab/verify-full.txt)`] : x; };
    const res = [], full = [];
    console.error(`verifying ${k}${unit ? '/' + unit : ''}: check, test on a real server (the first time downloads it: a few minutes), pack ...`);
    for (const [label, args, n] of [['check', ['check'], 25], ['test', ['test'], 60], ['qa', ['qa'], 15], ['pack', ['pack'], 4]]) {
      const r = run(args); full.push(`== ${label}`, ...r.lines);
      res.push(`${label}: ${r.ok ? (r.lines.at(-1) ?? 'OK') : 'FAILED'}`);
      if (!r.ok || label === 'test' || label === 'check' || label === 'qa') res.push(...keep(r.lines.slice(0, -1), n).map((l) => '  ' + l));
      if (!r.ok && r.lines.some((l) => /network is blocked|cannot download|BLOCKED|unreachable|MISSING/.test(l))) { const d = spawnSync(process.execPath, [path.join(TOP, k, 'lab.mjs'), 'doctor'], { cwd: path.join(TOP, k), encoding: 'utf8' }); const dl = (d.stdout ?? '').trim().split('\n'); res.push('  doctor:', ...dl.filter((l, i) => /^(MISSING|BLOCKED|FAIL)/.test(l) || (/^\s+→/.test(l) && /^(MISSING|BLOCKED|FAIL)/.test(dl[i - 1] ?? '')) || /^(bds|end|ll): /.test(l)).map((l) => '  ' + l.replace(/\s{6,}/g, '  '))); break; }
    }
    // the types travel with the folder: the next chat AI (no network) type checks against the real API
    if (!res.some((l) => /^check: FAILED/.test(l))) {
      const cf = path.join(TOP, 'carry', `${k}-types.json.gz`), before = fs.existsSync(cf) ? sha(fs.readFileSync(cf)) : '';
      const c = run(['carry']);
      if (c.ok && fs.existsSync(cf) && sha(fs.readFileSync(cf)) !== before) res.push(`types: new API types saved: attach bds-lab/carry/${k}-types.json.gz to your next message once (the AI then checks against the real API)`);
    }
    fs.mkdirSync(path.join(TOP, k, '.lab'), { recursive: true }); fs.writeFileSync(path.join(TOP, k, '.lab', 'verify-full.txt'), full.join('\n') + '\n');
    return done([`===== bds-lab verify (paste all of this into the chat) =====`, `lab ${k} | unit ${unit || '(folder)'} | ${process.platform}-${process.arch} | node ${process.version}${pt ? ` | patch ${pt.id} applied` : ''}`, ...res, '===== end ====='].join('\n'), res.some((l) => /: FAILED/.test(l)) ? 1 : 0);
  };
  const patchId = (t) => { const m = (t ?? '').replace(/\r\n/g, '\n').match(/===== bds-lab patch (\w+)[^\n]*=====\n[\s\S]*?\n===== end patch \1 =====/); return m ? m[1] : null; };
  const first = pfile ? fs.readFileSync(pfile, 'utf8') : A.includes('--no-apply') ? '' : readClipboard();
  const code = once(first);
  if (!watch) process.exit(code);
  // --watch: stay open; each new patch copied from the chat is applied and verified by itself, the result lands on the clipboard.
  // The loop becomes: copy the AI's patch → wait → paste the result.
  const seen = new Set([patchId(first)]);
  const notify = (msg) => {
    process.stdout.write('\x07');
    if (process.platform === 'darwin') spawnSync('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "bds-lab"`]);
    else if (process.platform === 'linux') spawnSync('notify-send', ['bds-lab', msg]);
  };
  notify(code === 0 ? 'verify: PASS (result copied)' : 'verify: result copied: paste it into the chat');
  console.log(`\nwatching the clipboard: copy the AI's next patch and the result will be copied back here by itself (Ctrl+C to stop)`);
  let polls = Number(process.env.LAB_WATCH_POLLS || 0);   // tests: stop after this many polls
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    if (polls && --polls === 0) process.exit(0);
    const t = readClipboard(), id = patchId(t);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    console.log(`\n---- new patch ${id} ----`);
    const c = once(t);
    notify(c === 0 ? `patch ${id}: PASS (result copied)` : `patch ${id}: result copied: paste it into the chat`);
    console.log(`\nwatching the clipboard for the next patch (Ctrl+C to stop)`);
  }
}
// selftest all: each lab's selftest on its real server, one line each (reports in <lab>/.lab/selftest.txt)
if (A[0] === 'selftest' && A[1] === 'all') {
  const { spawnSync } = await import('node:child_process');
  let ok = true;
  for (const k of KINDS) {
    const r = spawnSync(process.execPath, [path.join(TOP, k, 'lab.mjs'), 'selftest'], { cwd: path.join(TOP, k), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256e6 });
    const t = ((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n');
    ok = ok && r.status === 0;
    console.log(`${k}: ${t.filter((l) => /^(PASS|FAIL) \d/.test(l)).at(-1) ?? t.at(-1)}${r.status === 0 ? '' : ' → ' + k + '/.lab/selftest.txt'}`);
  }
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}
// update <zip>: a newer bds-lab over this folder in place (keeps .env.local, caches and your units; never deletes the folder)
if (A[0] === 'update') { try { (await import(pathToFileURL(path.join(TOP, 'common', 'update.mjs')).href)).update(TOP, A[1] && path.resolve(A[1])); process.exit(0); } catch (e) { console.log(`ERR ${e.message}`); process.exit(1); } }
// maint [--fix] [--online]: ten health checks (temp folders, old runs, stale locks, login profiles, disk, secrets, leaks, scripts, token, new releases)
if (A[0] === 'maint') { process.exit((await (await import(pathToFileURL(path.join(TOP, 'common', 'maint.mjs')).href)).maintCmd(TOP, A.slice(1))) ? 0 : 1); }
// ---- for the person and the AI: sign-ins, first start, upkeep, the browser page, finding causes (common/<name>.mjs of each) ----
{
  if (!A.length && process.stdin.isTTY && process.stdout.isTTY) A.push('start');   // lab.cmd double-clicked, or `node lab.mjs` typed by a person
  const TABLE = { login: ['auth.mjs', 'loginCmd'], start: ['start.mjs', 'startCmd'], maintain: ['maintain.mjs', 'maintainCmd'], apidiff: ['apidiff.mjs', 'apidiffCmd'],
    undo: ['checkpoint.mjs', 'checkpointCmd', true], checkpoint: ['checkpoint.mjs', 'checkpointCmd', true], notify: ['notify.mjs', 'notifyCmd'], watch: ['watch.mjs', 'watchCmd'], ui: ['ui.mjs', 'uiCmd'], flaky: ['flaky.mjs', 'flakyCmd'], release: ['release.mjs', 'releaseCmd'],
    bisect: ['bisect.mjs', 'bisectCmd'], mutate: ['mutate.mjs', 'mutateCmd'], scan: ['scan.mjs', 'scanCmd'], i18n: ['i18n.mjs', 'i18nCmd'], optimize: ['optimize.mjs', 'optimizeCmd'],
    why: ['why.mjs', 'whyCmd'], colony: ['colony.mjs', 'colonyCmd'], host: ['hosts.mjs', 'hostCmd'], skill: ['skills.mjs', 'skillCmd'], skills: ['skills.mjs', 'skillCmd'], auto: ['auto.mjs', 'autoCmd'], share: ['share.mjs', 'shareCmd'], sim: ['sim.mjs', 'simCmd'], status: ['status.mjs', 'statusCmd'], clean: ['status.mjs', 'cleanCmd'], deploy: ['deploy.mjs', 'deployCmd'], c2s: ['c2s.mjs', 'c2sCmd'], ts: ['ts.mjs', 'tsCmd'], bb: ['bb.mjs', 'bbCmd'], upkeep: ['upkeep.mjs', 'upkeepCmd'], record: ['record.mjs', 'recordCmd'], chaos: ['chaos.mjs', 'chaosCmd'], shrink: ['chaos.mjs', 'shrinkCmd'], gaps: ['gaps.mjs', 'gapsCmd'], scratch: ['scratch.mjs', 'scratchCmd'] };
  // `node lab.mjs end maintain` / `end status`: any of these after a lab's name runs for that lab (status, sim, ... used to fall
  // through to the lab's own commands and print its usage)
  const Tn = KINDS.includes(A[0]) && A[1] !== 'ui' && TABLE[A[1]];   // (`<lab> ui` is that lab's JSON UI command)
  if (Tn) { process.env.LAB_KIND = A[0]; try { fs.writeFileSync(MEM, A[0] + '\n'); } catch { /* read-only */ } A.shift(); }
  const T = A[0] === 'ui' && A[1] === 'build' ? null : TABLE[A[0]];   // (`ui build <layout.yaml>` is the lab's JSON UI builder; `ui` alone the browser page)
  if (T) { await top(T[0], T[1], T[2] ? A : A.slice(1)); await new Promise(() => {}); }
}
// app: the real Minecraft app (APK) on an Android emulator joins the lab's BDS; screenshots of the addon's JSON UI + logs (app/AGENTS.md)
if (A[0] === 'app') { process.argv.splice(2, 1); await import(pathToFileURL(path.join(TOP, 'app', 'app.mjs')).href); await new Promise(() => {}); }
// `node lab.mjs bds 1.26.60.29` / `bds --update|--preview|--list`: the bds command of the bds lab (not "switch to the bds lab")
if (A[0] === 'bds' && /^(\d+\.\d+\.\d+\.\d+|--(update|preview|list))$/.test(A[1] ?? '')) process.argv.splice(3, 0, 'bds');
let kind = process.env.LAB_KIND;
if (KINDS.includes(process.argv[2])) { kind = process.argv.splice(2, 1)[0]; process.env.LAB_KIND_NAMED = kind; try { fs.writeFileSync(MEM, kind + '\n'); } catch { /* read-only */ } }
kind ??= (() => { try { const k = fs.readFileSync(MEM, 'utf8').trim(); return KINDS.includes(k) ? k : null; } catch { return null; } })() ?? 'bds';
const dir = path.join(TOP, kind);
process.env.LAB_CALLER_CWD ??= process.cwd();   // (paths a person gives, e.g. import <file>, are from where they ran the lab)
process.chdir(dir);
process.argv[1] = path.join(dir, 'lab.mjs');
globalThis.LAB_FLAVOR = pathToFileURL(path.join(dir, 'flavor.mjs')).href;
await import(pathToFileURL(path.join(TOP, 'common', 'core.mjs')).href);
