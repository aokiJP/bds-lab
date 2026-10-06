// node lab.mjs deploy <your BDS folder> [<unit> ...] [--world <name>] [--undo] [--dry]: put addons on a real Bedrock Dedicated
// Server of your own, with the server's settings changed so they work — the same things the lab does for its test servers:
//   packs       the utility addons (common/data/samples.json "utility": TS REPL ...) and the units named, as world packs
//               (worlds/<level>/behavior_packs|resource_packs + world_behavior_packs.json / world_resource_packs.json)
//   modules     config/default/permissions.json allows every @minecraft/* module the packs ask for (BDS leaves out
//               @minecraft/common and @minecraft/server-net: such an addon does not load)
//   beta APIs   a pack on beta modules (or "beta"): the world's level.dat gets the Beta APIs experiment, other experiments kept
// Everything changed is backed up first (<BDS>/.bdslab-backup/<time>/); --undo puts the last deploy back. Stop the server
// first: it rewrites level.dat when it stops. --dry: what it would change, nothing written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);

// ---- level.dat (Bedrock: 8-byte header + little-endian NBT): the experiments compound, other tags untouched ----
export function withBetaApis(buf) {
  const b = buf; let i = 8;
  const u8 = () => b[i++], str = () => { const n = b.readUInt16LE(i); i += 2 + n; return b.toString('utf8', i - n, i); };
  const skip = (t) => {
    const sz = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 }[t]; if (sz) { i += sz; return; }
    if (t === 7) { i += 4 + b.readInt32LE(i); return; } if (t === 8) { str(); return; }
    if (t === 9) { const et = u8(), n = b.readInt32LE(i); i += 4; for (let k = 0; k < n; k++) skip(et); return; }
    if (t === 10) { for (let c; (c = u8()) !== 0;) { str(); skip(c); } return; }
    if (t === 11) { i += 4 + 4 * b.readInt32LE(i); return; } if (t === 12) { i += 4 + 8 * b.readInt32LE(i); return; }
    throw new Error(`level.dat: unknown NBT tag ${t}`);
  };
  const tag = (t, name, payload) => { const nb = Buffer.from(name), h = Buffer.alloc(3); h[0] = t; h.writeUInt16LE(nb.length, 1); return Buffer.concat([h, nb, payload]); };
  if (u8() !== 10) throw new Error('level.dat: not a Bedrock level.dat (no root compound)');
  str();
  const bodyStart = i; let exp = null;
  for (let t; (t = b[i]) !== 0;) { const st = i; i++; const name = str(); const ps = i; skip(t); if (name === 'experiments' && t === 10) exp = { st, ps, end: i }; }
  const end = i;
  // the children of experiments that are there now (kept), then the three the Beta APIs toggle needs
  const kids = new Map();
  if (exp) { let j = exp.ps; i = j; for (let c; (c = b[i]) !== 0;) { const s0 = i; i++; const n = str(); skip(c); kids.set(n, b.subarray(s0, i)); } }
  let changed = false;
  for (const n of ['gametest', 'experiments_ever_used', 'saved_with_toggled_experiments']) { const cur = kids.get(n); if (!cur || cur[0] !== 1 || cur.at(-1) !== 1) { kids.set(n, tag(1, n, Buffer.from([1]))); changed = true; } }
  if (!changed) return { buf, changed: false };
  const expTag = tag(10, 'experiments', Buffer.concat([...kids.values(), Buffer.from([0])]));
  const body = exp ? Buffer.concat([b.subarray(bodyStart, exp.st), b.subarray(exp.end, end)]) : b.subarray(bodyStart, end);
  const root = Buffer.concat([b.subarray(8, bodyStart), body, expTag, Buffer.from([0])]);
  const head = Buffer.alloc(8); head.writeInt32LE(b.readInt32LE(0), 0); head.writeInt32LE(root.length, 4);
  return { buf: Buffer.concat([head, root]), changed: true };
}
export function hasBetaApis(buf) { try { return !withBetaApis(buf).changed; } catch { return false; } }

function packsOf(names) {
  const s = (() => { try { return readJson(path.join(TOP, 'common', 'data', 'samples.json')); } catch { return {}; } })();
  const want = [...new Set([...(s.utility?.bds ?? []), ...names])];
  const out = [], missing = [];
  for (const n of want) {
    const [k, u] = n.includes('/') ? n.split('/') : ['bds', n];
    const d = path.join(TOP, k, UNITS[k] ?? 'addons', u);
    let any = false;
    for (const kind of ['bp', 'rp']) { const m = path.join(d, kind, 'manifest.json'); if (fs.existsSync(m)) { out.push({ unit: u, kind, dir: path.join(d, kind), m: readJson(m) }); any = true; } }
    if (!any) missing.push(n);
  }
  return { packs: out, missing };
}
const levelName = (bdsDir) => { try { return /^level-name=(.*)$/m.exec(fs.readFileSync(path.join(bdsDir, 'server.properties'), 'utf8'))?.[1]?.trim() || 'Bedrock level'; } catch { return 'Bedrock level'; } };

export async function deployCmd(args, out = console.log) {
  const a = [...args], flag = (k) => { const i = a.indexOf(k); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const world0 = flag('--world'), undo = a.includes('--undo'), dry = a.includes('--dry');
  const rest = a.filter((x) => !x.startsWith('--')), bds = rest[0] && path.resolve(rest[0]);
  if (!bds || !fs.existsSync(bds)) { out('usage: node lab.mjs deploy <your BDS folder> [<unit> ...] [--world <name>] [--dry] [--undo]   (the utility addons always; stop the server first)'); return false; }
  if (!fs.existsSync(path.join(bds, 'server.properties'))) { out(`ERR ${bds}: no server.properties (the folder bedrock_server is in)`); return false; }
  const BK = path.join(bds, '.bdslab-backup');
  if (undo) {
    const last = fs.existsSync(BK) ? fs.readdirSync(BK).sort().at(-1) : null;
    if (!last) { out('OK nothing to undo (no deploy was made here)'); return true; }
    const dir = path.join(BK, last), plan = readJson(path.join(dir, 'plan.json'));
    for (const r of plan.changed) { const f = path.join(bds, r), b = path.join(dir, 'files', r); if (fs.existsSync(b)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(b, f); } else fs.rmSync(f, { force: true }); }
    for (const r of plan.added) { fs.rmSync(path.join(bds, r), { recursive: true, force: true }); for (let d = path.dirname(path.join(bds, r)); d.startsWith(path.join(bds, 'worlds') + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { break; } } }   // (and the pack folders it made, once empty)
    for (const r of plan.replaced ?? []) { fs.rmSync(path.join(bds, r), { recursive: true, force: true }); fs.cpSync(path.join(dir, 'dirs', r), path.join(bds, r), { recursive: true }); }
    fs.rmSync(dir, { recursive: true, force: true });
    out(`OK put back the deploy of ${last} (${plan.changed.length} file(s) restored, ${plan.added.length} pack folder(s) removed, ${(plan.replaced ?? []).length} older pack(s) back)`);
    return true;
  }
  const level = world0 ?? levelName(bds), wd = path.join(bds, 'worlds', level);
  const { packs, missing } = packsOf(rest.slice(1));
  if (missing.length) { out(`ERR no such unit: ${missing.join(' ')} (bds/addons/<name>, end/plugins/<name>, ...)`); return false; }
  const changed = new Set(), added = [], replaced = [], lines = [];
  let bkDir = path.join(BK, stamp()); for (let k = 2; fs.existsSync(bkDir); k++) bkDir = path.join(BK, `${stamp()}-${k}`);   // (two deploys in one moment: two backups)
  const keep = (r) => { if (changed.has(r)) return; changed.add(r); const f = path.join(bds, r); if (!dry && fs.existsSync(f)) { const b = path.join(bkDir, 'files', r); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(f, b); } };
  const write = (r, data) => { keep(r); if (!dry) { fs.mkdirSync(path.dirname(path.join(bds, r)), { recursive: true }); fs.writeFileSync(path.join(bds, r), data); } };
  const rel = (f) => path.relative(bds, f).split(path.sep).join('/');
  // 1. the packs, as world packs (a pack already there with the same uuid is replaced: an update)
  const lists = { bp: [], rp: [] };
  for (const p of packs) {
    const destRel = rel(path.join(wd, p.kind === 'bp' ? 'behavior_packs' : 'resource_packs', `${p.unit}_${p.kind.toUpperCase()}`));
    const d = path.join(bds, destRel);
    // the same pack under another folder name (installed by hand as "My Addon BP"): two packs with one uuid in a world make
    // BDS load one of them at random, so that copy goes too (kept whole for --undo, as an older copy of ours is)
    const pdir = path.dirname(d);
    let same = []; try { same = fs.readdirSync(pdir).map((n) => path.join(pdir, n)).filter((x) => x !== d && (() => { try { return readJson(path.join(x, 'manifest.json')).header?.uuid === p.m.header.uuid; } catch { return false; } })()); } catch { /* no packs yet */ }
    for (const x of same) { const xr = rel(x); replaced.push(xr); lines.push(`pack ${p.unit} ${p.kind}: the same pack (uuid) at ${xr} replaced`); if (!dry) { fs.cpSync(x, path.join(bkDir, 'dirs', xr), { recursive: true }); fs.rmSync(x, { recursive: true, force: true }); } }
    if (fs.existsSync(d)) { replaced.push(destRel); if (!dry) { fs.cpSync(d, path.join(bkDir, 'dirs', destRel), { recursive: true }); fs.rmSync(d, { recursive: true, force: true }); } }   // (an older copy: kept whole for --undo)
    else added.push(destRel);
    if (!dry) fs.cpSync(p.dir, d, { recursive: true, filter: (f) => !/[\\/](\.DS_Store|Thumbs\.db)$/.test(f) });
    const v = typeof p.m.header.version === 'string' ? p.m.header.version.split(/[.-]/).slice(0, 3).map(Number) : p.m.header.version;
    lists[p.kind].push({ pack_id: p.m.header.uuid, version: v });
    lines.push(`pack ${p.unit} ${p.kind} v${v.join('.')} → ${destRel}`);
  }
  for (const [kind, file] of [['bp', 'world_behavior_packs.json'], ['rp', 'world_resource_packs.json']]) {
    const r = rel(path.join(wd, file)); let cur = []; try { cur = readJson(path.join(bds, r)); } catch { /* none yet */ }
    const ids = new Set(lists[kind].map((x) => x.pack_id)), next = [...cur.filter((x) => !ids.has(x.pack_id)), ...lists[kind]];
    if (JSON.stringify(next) !== JSON.stringify(cur)) { write(r, JSON.stringify(next, null, 2) + '\n'); lines.push(`${file}: ${lists[kind].length} pack(s) on`); }
  }
  // 2. the script modules the packs ask for
  const pf = path.join(bds, 'config', 'default', 'permissions.json');
  const want = [...new Set(packs.flatMap((p) => (p.m.dependencies ?? []).map((d) => d.module_name).filter((m) => /^@minecraft\//.test(m ?? ''))))];
  let perm = { allowed_modules: ['@minecraft/server-gametest', '@minecraft/server', '@minecraft/server-ui', '@minecraft/server-admin', '@minecraft/server-editor', '@minecraft/debug-utilities'] };
  try { perm = readJson(pf); } catch { /* BDS's own list (1.26) */ }
  const addMods = want.filter((m) => !(perm.allowed_modules ?? []).includes(m));
  if (addMods.length) { write(rel(pf), JSON.stringify({ ...perm, allowed_modules: [...(perm.allowed_modules ?? []), ...addMods] }, null, 2) + '\n'); lines.push(`permissions.json: allowed ${addMods.join(' ')}`); }
  // 3. the Beta APIs experiment for packs on beta modules
  const beta = packs.filter((p) => (p.m.dependencies ?? []).some((d) => /beta/.test(String(d.version ?? ''))));
  if (beta.length) {
    const ld = path.join(wd, 'level.dat');
    if (!fs.existsSync(ld)) lines.push(`W ${[...new Set(beta.map((p) => p.unit))].join(' ')} use beta APIs, and the world "${level}" has no level.dat yet: start the server once, stop it, and deploy again (or turn on Beta APIs when you make the world)`);
    else { const r = withBetaApis(fs.readFileSync(ld)); if (r.changed) { write(rel(ld), r.buf); lines.push(`level.dat: Beta APIs on (for ${[...new Set(beta.map((p) => p.unit))].join(' ')}; other experiments kept)`); } }
  }
  if (!dry) { fs.mkdirSync(bkDir, { recursive: true }); fs.writeFileSync(path.join(bkDir, 'plan.json'), JSON.stringify({ at: new Date().toISOString(), level, changed: [...changed], added, replaced }, null, 1)); }
  lines.forEach((l) => out((l.startsWith('W ') ? '' : '  ') + l));
  out(dry ? `DRY deploy to ${bds} (world "${level}"): nothing written` : `OK deployed to ${bds} (world "${level}"). Start the server; to put it back: node lab.mjs deploy "${rest[0]}" --undo`);
  return true;
}
