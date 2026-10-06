// node lab.mjs update <bds-lab.zip>: a newer bds-lab written over this folder, in place.
// Why in place: replacing the folder while a terminal is inside it leaves that terminal in a deleted folder, and then every
// command fails before the lab even starts (Node: "process.cwd failed ... uv_cwd"). It also keeps what is yours:
//   .env.local (the Google token), every .lab cache, .lab-kind, each addon / plugin / mod already here, and the autopilot's
//   memory and settings (auto/policy.json, ledger.jsonl, BACKLOG.md, LESSONS.md, STOP) and bench/ranking.json
//   (a sample of the same name in the zip does not overwrite yours; new samples are added; the utility addons — TS REPL — are
//   the lab's tools and are always replaced)
// Everything else (the engine, docs, tests, workflows) is replaced by the zip's version. Deleted: only what an earlier release
// shipped and this one no longer does (common/data/shipped.json: the old list against the new, and the files the new one says
// are gone), and only a copy nobody edited (its sha256 the shipped one) — never a unit, a cache, a secret, the autopilot's memory
// or a file extras.json lists (put back on purpose from bds-lab-extras-<version>.zip, which carries that list).
// The same release again tidies: every file it says is gone goes (an update done by an older lab, which deleted nothing, leaves
// them; `maint` names them as leftovers).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZipReader } from '../bedrock-binary/src/apk/zip.js';

const UNIT = /^(bds\/addons|end\/plugins|ll\/mods)\/([^/]+)\//;
const MINE = /(^|\/)(\.env(\.(?!example(\/|$))[^/]*)?|\.lab|\.lab-node|\.lab-tools)(\/|$)|^\.lab-(kind|base\.json|run\.[a-z]+)$/;
// yours once it exists: the autopilot's memory and settings, the bench history (a release carries fresh ones for a new lab)
const KEEP = /^(auto\/(policy\.json|ledger\.jsonl|BACKLOG\.md|LESSONS\.md|STOP)|bds\/bench\/ranking\.json)$/;
const EXEC = /(\.(sh|command)$|^tests\/fake\/app\/(adb|browser\.mjs)$)/;

/** @returns {{written:number, added:number, kept:string[], skipped:number}} */
const sha12 = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
const readShip = (TOP) => { try { return JSON.parse(fs.readFileSync(path.join(TOP, 'common', 'data', 'shipped.json'), 'utf8')); } catch { return null; } };
// files the person put back on purpose from the extras zip (it carries this list at the lab's top): never a leftover
export const EXTRAS = 'extras.json';
export const extrasOf = (TOP) => { try { return new Set(JSON.parse(fs.readFileSync(path.join(TOP, EXTRAS), 'utf8')).files ?? []); } catch { return new Set(); } };
const never = (r) => MINE.test(r) || KEEP.test(r) || UNIT.test(r) || r === EXTRAS || r.split('/').some((s) => s === '..' || s === '') || path.isAbsolute(r);
/** delete each candidate that is still exactly as a release shipped it (an edited one stays), then the folders left empty */
function removeShipped(TOP, cand) {
  const extras = extrasOf(TOP), dirs = new Set(); let removed = 0, edited = 0;
  for (const [r, shas] of cand) {
    if (never(r) || extras.has(r)) continue;
    const f = path.join(TOP, ...r.split('/'));
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (!st.isFile()) continue;
    if (!shas.includes(sha12(fs.readFileSync(f)))) { edited++; continue; }
    fs.rmSync(f); removed++; dirs.add(path.dirname(f));
  }
  for (let d of [...dirs].sort((a, b) => b.length - a.length)) while (d.startsWith(TOP + path.sep) && fs.existsSync(d) && !fs.readdirSync(d).length) { fs.rmdirSync(d); d = path.dirname(d); }
  return { removed, edited };
}
/** what an earlier release shipped and the installed one says is gone, still here exactly as shipped (an update by an older lab
 *  deleted nothing; `share` would ship it again): [rel] */
export function leftovers(TOP) {
  const ship = readShip(TOP); if (!ship) return [];
  const extras = extrasOf(TOP), out = [];
  for (const [r, g] of Object.entries(ship.gone ?? {})) {
    if (r in (ship.files ?? {}) || never(r) || extras.has(r)) continue;
    const f = path.join(TOP, ...r.split('/'));
    try { if (fs.statSync(f).isFile() && (g.sha ?? []).includes(sha12(fs.readFileSync(f)))) out.push(r); } catch { /* not here */ }
  }
  return out.sort();
}
export function removeLeftovers(TOP, list = leftovers(TOP)) { const gone = readShip(TOP)?.gone ?? {}; return removeShipped(TOP, new Map(list.map((r) => [r, gone[r]?.sha ?? []]))); }
const vlt = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };
export function update(TOP, zipFile, out = console.log) {
  if (!zipFile || !fs.existsSync(zipFile)) throw new Error(`update: ${zipFile ?? '(zip file)'} がありません（使い方: node lab.mjs update <新しい bds-lab.zip>）`);
  // what is installed now (before the new files go over it): its version, and what its release shipped
  const before = (() => { try { return fs.readFileSync(path.join(TOP, 'VERSION'), 'utf8').trim(); } catch { return null; } })();
  const oldShip = readShip(TOP);
  const z = new ZipReader(zipFile);
  try {
    const names = z.entries.map((e) => e.name).filter((n) => !n.endsWith('/'));
    // the zip's own top folder (bds-lab/ or any name) holds lab.mjs
    const root = names.find((n) => /^([^/]+\/)?lab\.mjs$/.test(n))?.replace(/lab\.mjs$/, '');
    if (root === undefined) throw new Error('update: bds-lab の zip ではありません（lab.mjs がありません）');
    const plan = [];
    for (const n of names) {
      if (!n.startsWith(root)) continue;
      const rel = n.slice(root.length);
      if (!rel || rel.split('/').some((s) => s === '..' || s === '') || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) throw new Error(`update: おかしなパスがあります: ${n}`);
      plan.push([n, rel]);
    }
    // the utility addons (samples.json `utility`: TS REPL, which `ts` drives through its patched bridge) are the lab's own tools,
    // not a sample to make your own: the zip's copy always replaces them (keeping an old one broke `ts` after an update)
    let util = new Set();
    try { const sj = names.find((n) => n === root + 'common/data/samples.json'); const u = sj ? JSON.parse(z.read(sj).toString('utf8')).utility ?? {} : {}; util = new Set(Object.entries(u).flatMap(([k, l]) => l.map((x) => `${k === 'bds' ? 'bds/addons' : k === 'end' ? 'end/plugins' : 'll/mods'}/${x}`))); } catch { /* an old zip */ }
    const kept = new Set(); let written = 0, added = 0, skipped = 0;
    for (const [n, rel] of plan) {
      if (MINE.test(rel)) { skipped++; continue; }
      if (KEEP.test(rel) && fs.existsSync(path.join(TOP, ...rel.split('/')))) { kept.add(rel); continue; }
      const u = UNIT.exec(rel);
      if (u && !util.has(`${u[1]}/${u[2]}`) && fs.existsSync(path.join(TOP, u[1], u[2]))) { kept.add(`${u[1]}/${u[2]}`); continue; }
      const dst = path.join(TOP, ...rel.split('/'));
      const isNew = !fs.existsSync(dst);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      // replace by rename: a program reading the old file never sees half of the new one
      const tmp = `${dst}.update-${process.pid}`;
      fs.writeFileSync(tmp, z.read(n));
      if (EXEC.test(rel) && process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, dst);
      written++; if (isNew) added++;
    }
    // what earlier releases shipped and this one no longer does: an unedited copy goes (an edited one stays), then empty folders.
    // The gone list of a release applies to a lab older than it; the same release again tidies all of it (the leftovers of an
    // update an older lab did)
    let removed = 0, edited = 0;
    {
      const inZip = new Set(plan.map(([, rel]) => rel)), cand = new Map();
      for (const [r, h] of Object.entries(oldShip?.files ?? {})) if (!inZip.has(r)) cand.set(r, [h]);
      let newShip = null; try { const n = names.find((x) => x === root + 'common/data/shipped.json'); newShip = n ? JSON.parse(z.read(n).toString('utf8')) : null; } catch { /* an older release: none */ }
      const again = !!before && before === newShip?.version;
      for (const [r, g] of Object.entries(newShip?.gone ?? {})) if (!inZip.has(r) && (!before || again || vlt(before, g.since))) cand.set(r, [...(cand.get(r) ?? []), ...(g.sha ?? [])]);
      ({ removed, edited } = removeShipped(TOP, cand));
    }
    if (removed || edited) out(`古いリリースにだけあったファイル: ${removed} 個を削除${edited ? `、手を入れてあった ${edited} 個は残しました` : ''}`);
    out(`OK 更新しました: ${written} ファイル（新規 ${added}）。そのまま残したもの: .env.local・キャッシュ${kept.size ? `・自分の ${[...kept].filter((k) => !KEEP.test(k)).map((k) => k.split('/').pop()).join(' ')}${[...kept].some((k) => KEEP.test(k)) ? '・自動操縦の記録と設定' : ''}` : ''}`);
    return { written, added, kept: [...kept], skipped, removed };
  } finally { z.close(); }
}
