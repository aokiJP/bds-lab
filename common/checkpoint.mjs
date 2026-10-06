// Checkpoints of a unit (addon / plugin / mod): taken by itself before an AI changes it (make, maintain) and by hand.
//   node lab.mjs checkpoint ["label"] [-a <unit>]   keep the unit as it is now
//   node lab.mjs undo [-a <unit>]                    put back the newest checkpoint (what is there now becomes one first: undo is undoable)
//   node lab.mjs undo --list | undo <id>             all checkpoints, or a given one
// Stored in <lab>/.lab/checkpoints/<unit>/<id>/ (a plain copy; builds, node_modules and dist are left out). The newest 20 are kept.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TOP = process.env.LAB_LABS_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // (LAB_LABS_ROOT: tests)
export const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
const KEEP = 20;
const SKIP = /^(node_modules|dist|__pycache__|\.lab|build|\.xmake|tsconfig\.json)$/;

export const labKind = () => { const k = process.env.LAB_KIND || (() => { try { return fs.readFileSync(path.join(TOP, '.lab-kind'), 'utf8').trim(); } catch { return ''; } })(); return UNITS[k] ? k : 'bds'; };
export const unitDir = (k, u) => path.join(TOP, k, UNITS[k], u);
export const unitNames = (k) => { try { return fs.readdirSync(path.join(TOP, k, UNITS[k])).filter((n) => !n.startsWith('.') && fs.statSync(unitDir(k, n)).isDirectory()).sort(); } catch { return []; } };
export function currentUnit(k, args = []) {
  const i = args.indexOf('-a');
  const u = (i >= 0 ? args[i + 1] : null) || process.env.LAB_ADDON || (() => { try { return fs.readFileSync(path.join(TOP, k, '.lab', 'addon'), 'utf8').trim(); } catch { return ''; } })();
  if (!u || !fs.existsSync(unitDir(k, u))) throw new Error(`どのユニットか分かりません: -a <名前>（${unitNames(k).join(' ') || 'なし'}）`);
  return u;
}
const store = (k, u) => path.join(TOP, k, '.lab', 'checkpoints', u);
function copy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.test(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copy(s, d); else if (e.isFile()) fs.copyFileSync(s, d);
  }
}
export function list(k, u) {
  try {
    return fs.readdirSync(store(k, u)).sort().map((id) => { let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(store(k, u), id, '.checkpoint.json'), 'utf8')); } catch { /* bare */ } return { id, ...m }; });
  } catch { return []; }
}
/** keep the unit as it is now; returns the id */
export function save(k, u, label = '', protect = null) {
  // the id sorts by time (ms; never before the newest one there: two in one ms stay in order too)
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.(\d+)Z$/, '$1').replace('T', '-');
  let ms = Date.now(); const last = list(k, u).at(-1)?.id.slice(0, 18) ?? '';
  while (stamp(ms) <= last) ms++;
  const t = new Date(ms), id = stamp(ms) + '-' + Math.random().toString(36).slice(2, 5);
  const d = path.join(store(k, u), id);
  copy(unitDir(k, u), d);
  fs.writeFileSync(path.join(d, '.checkpoint.json'), JSON.stringify({ label, at: t.toISOString() }) + '\n');
  const all = list(k, u);
  for (const x of all.filter((x) => x.id !== protect).slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(store(k, u), x.id), { recursive: true, force: true });   // (protect: the one an undo is about to go back to)
  return id;
}
/** the unit becomes checkpoint `id` again (files added since are removed; builds and caches are left alone) */
export function restore(k, u, id) {
  const src = path.join(store(k, u), id), dst = unitDir(k, u);
  if (!fs.existsSync(src)) throw new Error(`チェックポイント ${id} がありません（undo --list）`);
  const clear = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.test(e.name)) continue; fs.rmSync(path.join(d, e.name), { recursive: true, force: true }); } };
  clear(dst);
  copy(src, dst);
  fs.rmSync(path.join(dst, '.checkpoint.json'), { force: true });
}
export const cpDir = (k, u, id) => path.join(store(k, u), id);
/** the unit as it is now, aside (not a checkpoint: bisect / mutate change it on purpose); back() puts it back exactly */
export function hold(k, u) {
  const d = path.join(TOP, k, '.lab', 'hold', `${u}-${process.pid}`), dst = unitDir(k, u);
  fs.rmSync(d, { recursive: true, force: true }); copy(dst, d);
  let done = false;
  const back = () => { if (done) return; done = true; for (const e of fs.readdirSync(dst, { withFileTypes: true })) if (!SKIP.test(e.name)) fs.rmSync(path.join(dst, e.name), { recursive: true, force: true }); copy(d, dst); fs.rmSync(d, { recursive: true, force: true }); for (const [sig, f] of sigs) process.off(sig, f); process.off('exit', back); };
  // stopped half-way (Ctrl+C, a tool's time limit): the unit goes back before the process ends, never left with a planted bug.
  // A hard kill skips this: recoverHolds puts it back at the next lab command
  const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((sig) => [sig, () => { try { back(); } finally { process.exit(130); } }]);
  for (const [sig, f] of sigs) process.on(sig, f);
  process.on('exit', back);
  return { dir: d, back };
}
/** units a stopped run left changed (a mutate killed half-way): put back from its hold copy. Lines saying what was restored */
export function recoverHolds(k) {
  const base = path.join(TOP, k, '.lab', 'hold'), said = [];
  let es = []; try { es = fs.readdirSync(base); } catch { return said; }
  for (const n of es) {
    const m = /^(.+)-(\d+)$/.exec(n); if (!m) continue;
    let alive = true; try { process.kill(Number(m[2]), 0); } catch { alive = false; }
    if (alive) continue;
    const src = path.join(base, n), dst = unitDir(k, m[1]);
    if (!fs.existsSync(dst)) { fs.rmSync(src, { recursive: true, force: true }); continue; }
    for (const e of fs.readdirSync(dst, { withFileTypes: true })) if (!SKIP.test(e.name)) fs.rmSync(path.join(dst, e.name), { recursive: true, force: true });
    copy(src, dst); fs.rmSync(src, { recursive: true, force: true });
    said.push(`W ${k}/${m[1]}: put back as it was before a mutate/gaps run that was stopped half-way (it had a planted bug in it)`);
  }
  return said;
}
/** what changed from folder a to folder b, as a unified diff (git diff --no-index; no git: the changed files); builds left out */
export function diffDirs(a, b) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-diff-')), keep = (src) => (f) => !/[\\/](node_modules|dist|\.lab|build)$|\.checkpoint\.json$/.test(f) && !(fs.existsSync(path.join(src, 'src')) && /[\\/]bp[\\/]scripts([\\/]|$)/.test(f.slice(src.length)));
  try {
    fs.cpSync(a, path.join(t, 'before'), { recursive: true, filter: keep(a) }); fs.cpSync(b, path.join(t, 'after'), { recursive: true, filter: keep(b) });
    const r = spawnSync('git', ['-c', 'core.quotepath=false', 'diff', '--no-index', '--no-color', '--', 'before', 'after'], { cwd: t, encoding: 'utf8', maxBuffer: 64e6 });
    if (r.error || r.status > 1) return null;
    return r.stdout.replace(/(^|\s)([ab]\/)?(before|after)\//gm, '$1$2');
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
}
/** the files that differ between a checkpoint and the unit now */
export function changed(k, u, id) {
  const a = path.join(store(k, u), id), b = unitDir(k, u), out = [];
  const walk = (d, rel = '') => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } return es.filter((e) => !SKIP.test(e.name) && e.name !== '.checkpoint.json').flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), rel + e.name + '/') : [rel + e.name])); };
  const fa = new Set(walk(a)), fb = new Set(walk(b));
  for (const f of new Set([...fa, ...fb])) {
    if (!fa.has(f)) out.push('+ ' + f); else if (!fb.has(f)) out.push('- ' + f);
    else if (!fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f)))) out.push('M ' + f);
  }
  return out.sort((x, y) => x.slice(2).localeCompare(y.slice(2)));
}

export async function checkpointCmd(args, out = console.log) {
  const [cmd, ...rest] = args, k = labKind(), u = currentUnit(k, rest);
  const pos = rest.filter((x, i) => !x.startsWith('-') && rest[i - 1] !== '-a');
  if (cmd === 'checkpoint') { const id = save(k, u, pos.join(' ') || 'by hand'); out(`OK checkpoint ${id} (${k}/${UNITS[k]}/${u})  戻すとき: node lab.mjs undo`); return true; }
  const all = list(k, u);
  if (rest.includes('--list')) {
    if (!all.length) { out(`${u}: チェックポイントはまだありません（make / maintain の前に自動で取ります）`); return true; }
    for (const x of all.slice().reverse()) out(`${x.id}  ${x.label ?? ''}  (${changed(k, u, x.id).length} files differ from now)`);
    return true;
  }
  const id = pos[0] ?? all.at(-1)?.id;
  if (!id) { out(`${u}: 戻せるチェックポイントがありません`); return false; }
  if (!all.some((x) => x.id === id)) { out(`ERR ${u}: チェックポイント ${id} はありません（node lab.mjs undo --list）`); return false; }
  const diff = changed(k, u, id);
  if (!diff.length) { out(`OK ${u} はもう ${id} と同じです`); return true; }
  const now = save(k, u, `before undo to ${id}`, id);
  restore(k, u, id);
  diff.slice(0, 20).forEach((l) => out('  ' + l.replace(/^M/, '~')));   // + back again, - removed, ~ changed
  out(`OK ${u} を ${id}（${all.find((x) => x.id === id)?.label ?? ''}）に戻しました: ${diff.length} ファイル。やり直す: node lab.mjs undo ${now}`);
  return true;
}
