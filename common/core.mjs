// bds-lab shared engine (bds / end / ll). Entry: <project>/lab.mjs (stub). Usage: <project>/AGENTS.md.
process.noDeprecation = true;
import './netenv.mjs';   // first: proxy / CA bundle from the environment (any sandbox)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import dgram from 'node:dgram';
import crypto, { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as B from './build.mjs';
import * as PIX from './pixel.mjs';
import { makeRuntime } from './runtime.mjs';
import os from 'node:os';
import { decls, MEMBER, baseOf, members, findMember } from './dts.mjs';
import { lintTests, literalMiss } from './lint-tests.mjs';
import { compactPyTracebacks } from './pytb.mjs';
import { commandInjection, scanPath, report as scanReport, zipName } from './scan.mjs';
import { lintScript } from './addon-lint.mjs';
import { RUNTIME_HINTS } from './api-hints.mjs';

// One engine, three labs. The lab.mjs that was run names a flavor (bds/flavor.mjs, end/flavor.mjs, ll/flavor.mjs): what a unit
// of work is (addon / Endstone plugin / LeviLamina mod), how its server is installed and launched, and the platform's own commands.
// ROOT = folder of the lab.mjs that was run. CACHE = server, template world, tools (one per flavor, rebuildable).
// ADDON = the unit being worked on: <unitDir>/<name>/ (bp/ rp/ tests.txt TASK.md + the flavor's files), or ROOT itself.
const LIBDIR = path.dirname(fileURLToPath(import.meta.url));
const FLAVOR_URL = globalThis.LAB_FLAVOR ?? process.env.LAB_FLAVOR ?? pathToFileURL(path.join(LIBDIR, '..', 'bds', 'flavor.mjs')).href;
const F = (await import(FLAVOR_URL)).default;
const FDIR = path.dirname(fileURLToPath(FLAVOR_URL));
const TOP = path.dirname(LIBDIR);   // the repository: common/ + bds/ end/ ll/
const ROOT = path.dirname(path.resolve(process.argv[1]));
const ARGV = process.argv.slice(2);
const pickArg = (flags) => { const i = ARGV.findIndex((a) => flags.includes(a)); if (i < 0) return undefined; const v = ARGV[i + 1]; ARGV.splice(i, 2); return v; };
const ADDON_ARG = pickArg(['-a', '--addon']) ?? process.env.LAB_ADDON;
const ADDONS = path.join(ROOT, F.unitDir);
const isUnit = (d) => { try { return F.isUnit(d); } catch { return false; } };
const addonNames = () => (fs.existsSync(ADDONS) ? fs.readdirSync(ADDONS).filter((n) => isUnit(path.join(ADDONS, n))).sort() : []);
const gitBranch = () => { try { const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; } catch { return ''; } };
function resolveAddon() {
  if (ADDON_ARG) return path.join(ADDONS, ADDON_ARG);
  if (isUnit(ROOT)) return ROOT;   // single-unit folder (bench workspaces, docs/coverage)
  const names = addonNames();
  try { const cur = fs.readFileSync(path.join(ROOT, '.lab', 'addon'), 'utf8').trim(); if (names.includes(cur)) return path.join(ADDONS, cur); } catch { /* none chosen */ }
  const b = /^addon\/(.+)$/.exec(gitBranch())?.[1];
  if (b && names.includes(b)) return path.join(ADDONS, b);
  return names.length === 1 ? path.join(ADDONS, names[0]) : null;
}
const ADDON = resolveAddon();
const BP = path.join(ADDON ?? path.join(ADDONS, '_none'), 'bp');
const RP = path.join(ADDON ?? path.join(ADDONS, '_none'), 'rp');
// <unit>/lab.mjs: `node lab.mjs ...` run after a `cd` into the unit works too (the commonest lost turn in bench transcripts: an
// AI cds into its unit, then `node lab.mjs go` there finds no lab.mjs). It is the lab's own lab.mjs, pinned to this unit.
const FWD = "// written by bds-lab: `node lab.mjs ...` works from this folder too (= from the bds-lab folder, for this unit). Not packed.\nimport path from 'node:path';\nimport { fileURLToPath, pathToFileURL } from 'node:url';\nconst here = path.dirname(fileURLToPath(import.meta.url)), top = path.resolve(here, '..', '..', '..');\nconst kind = path.basename(path.dirname(path.dirname(here)));\nif (!process.argv.slice(2).some((a) => a === '-a' || a === '--addon')) process.env.LAB_ADDON ??= path.basename(here);\nif (!['bds', 'end', 'll'].includes(process.argv[2])) process.argv.splice(2, 0, kind);\nprocess.chdir(top);\nawait import(pathToFileURL(path.join(top, 'lab.mjs')).href);\n";
const packFileName = (m) => { let raw = String(m?.header?.name ?? ''); if (/^[\w]+(\.[\w]+)+$/.test(raw)) { try { const hit = fs.readFileSync(path.join(BP, 'texts', 'en_US.lang'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(raw + '=')); if (hit) raw = hit.slice(raw.length + 1).replace(/\s*##.*$/, ''); } catch { /* no lang */ } }   // (a name given as a lang key: pack.name → its English text)
  const n = raw.replace(/§./g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, ''); return /[A-Za-z0-9]/.test(n) ? n : path.basename(ADDON); };
function forwarder(dir) { try { const f = path.join(dir, 'lab.mjs'); if (dir !== ROOT && !fs.existsSync(f) && fs.existsSync(path.join(path.dirname(path.dirname(dir)), 'lab.mjs'))) fs.writeFileSync(f, FWD); } catch { /* read-only */ } }
const needAddon = () => {
  if (ADDON && isUnit(ADDON)) { forwarder(ADDON); return; }
  const names = addonNames(), u = F.unitWord;
  die(ADDON_ARG ? `no ${u} "${ADDON_ARG}" (${F.unitDir}: ${names.join(' ') || 'none'})` : names.length ? `several ${F.unitDir}: node lab.mjs use <name> (${names.join(' ')}) or add -a <name>` : `no ${u} yet: node lab.mjs new <name> "Title"`);
};
const LAB = path.join(ROOT, '.lab');
const CACHE = path.resolve(process.env.LAB_CACHE || path.join(FDIR, '.lab'));
const BDS = path.join(CACHE, 'bds');
// LAB_WORLD=normal: a generated world (LAB_SEED, default 1: trees, animals, caves, villages) instead of the flat test world, for what
// needs nature (the goal planner's `get`, RTAs). Game rules stay the game's own there (day cycle, mob spawns, weather)
const WORLD_KIND = process.env.LAB_WORLD === 'normal' ? 'normal' : 'flat';
const SEED = String(process.env.LAB_SEED ?? '1');
const TEMPLATE = path.join(CACHE, WORLD_KIND === 'normal' ? `world-normal-${SEED.replace(/[^\w-]/g, '_')}` : 'world');
const WIN = process.platform === 'win32';
const EXE = path.join(BDS, F.serverExe?.(WIN) ?? (WIN ? 'bedrock_server.exe' : 'bedrock_server'));
const FALLBACK = '1.26.51.1';
const TEMPLATE_UUID = 'a1b2c3d4-0000-4000-8000-000000000001';
const HELPER_UUID = ['6c0e1a52-8f4b-4c55-9d2e-0a1b2c3d4e51', '6c0e1a52-8f4b-4c55-9d2e-0a1b2c3d4e52'];
const WORLD_SETUP = WORLD_KIND === 'normal' ? ['tickingarea add -16 0 -16 15 0 15 lab', 'gamerule showcoordinates true'] : ['tickingarea add -32 0 -32 31 0 31 lab', 'gamerule domobspawning false', 'gamerule dodaylightcycle false', 'gamerule doweathercycle false', 'time set 6000'];

let printed = 0, firstBad = null;   // (the trace keeps a failed command's first problem line: bench friction reads it)
let OUT_HOOK = null;   // go: captures a step's lines to print only what needs fixing
const out = (s = '') => { if (OUT_HOOK) return OUT_HOOK(String(s)); printed += s.length + 1; if (!firstBad && /^(✘|E |Q |FAIL|ERR)/.test(s)) firstBad = String(s).split('\n').slice(0, 3).join(' | ').slice(0, 200); process.stdout.write(s + '\n'); const h = ruleFor(String(s)); if (h) { printed += h.length + 1; process.stdout.write(h + '\n'); } };
// skills at the moment they are needed: a problem line (E / W / Q / ✘) that a verified rule's `match` fits gets that rule's
// one line under it, once per run (skills/knowledge.json). Reading every skill up front costs tokens on every turn; this
// costs one line when the failure happens. skill learn counts how often each rule's failure still happened (its misses).
let RULES = null; const ruleShown = new Set();
function ruleFor(s) {
  if (process.env.LAB_RULE_HINTS === 'off' || !/^(E |W |Q |✘)/.test(s)) return null;
  if (RULES === null) { try { RULES = JSON.parse(fs.readFileSync(path.join(process.env.LAB_SKILLS_DIR ? path.resolve(process.env.LAB_SKILLS_DIR) : path.join(TOP, 'skills'), 'knowledge.json'), 'utf8')).rules.filter((r) => r.status === 'verified' && r.match).map((r) => { try { return { ...r, re: new RegExp(r.match, 'i') }; } catch { return null; } }).filter(Boolean); } catch { RULES = []; } }
  const first = s.split('\n')[0];
  if (RUNTIME_HINTS.some(([re]) => re.test(first))) return null;   // the lab prints its own hint for that one
  const r = RULES.find((x) => !ruleShown.has(x.id) && x.re.test(first));
  if (!r) return null;
  ruleShown.add(r.id);
  return `  rule: ${r.rule} (\`${r.id}\`, skill ${r.skill})`;
}
class Stop extends Error {}
const die = (s) => { throw new Stop(s); };
// where the server side runs: native (Linux/Windows) or a Linux container (macOS; LAB_RUNTIME=docker): common/runtime.mjs
const RT = makeRuntime({ flavor: F, CACHE, TOP, extraMounts: [ROOT, process.env.LAB_BDS_ZIP && path.dirname(process.env.LAB_BDS_ZIP)], die, say: (x) => out(x) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (f) => fs.existsSync(f);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

function trace(ok) {
  if (process.env.LAB_NOTRACE) return;
  try {
    fs.mkdirSync(LAB, { recursive: true });
    fs.appendFileSync(path.join(LAB, 'trace.jsonl'), JSON.stringify({ t: Date.now(), argv: process.argv.slice(2), chars: printed, ok, ...(ok || !firstBad ? {} : { why: firstBad }) }) + '\n');
  } catch { /* best-effort */ }
}

function files(dir, pred = () => true, acc = []) {
  if (!exists(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, pred, acc); else if (pred(p)) acc.push(p);
  }
  return acc;
}

// Bedrock JSON allows comments
function stripJsonComments(s) {
  let o = '', str = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) { o += c; if (c === '\\') o += s[++i] ?? ''; else if (c === '"') str = false; continue; }
    if (c === '"') { str = true; o += c; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; o += '\n'; continue; }
    if (c === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i + 2); const chunk = s.slice(i, j < 0 ? s.length : j + 2); o += chunk.replace(/[^\n]/g, ' '); i = j < 0 ? s.length : j + 1; continue; }
    o += c;
  }
  return o;
}
const readJson = (f) => JSON.parse(stripJsonComments(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')));
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, a) => `[${a.split(/,\s+/).join(', ')}]`) + '\n'); };

// ---------- download / archives ----------
// GitHub's API allows 60 unauthenticated calls/hour: GITHUB_TOKEN / GH_TOKEN (or `gh auth token`) lifts that
let GH_AUTH;
function ghAuth() {
  if (GH_AUTH !== undefined) return GH_AUTH;
  GH_AUTH = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (!GH_AUTH) try { const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000 }); if (r.status === 0) GH_AUTH = r.stdout.trim(); } catch { /* no gh */ }
  return GH_AUTH;
}
async function get(url) {
  const api = /^https:\/\/api\.github\.com\//.test(url);
  let tok = api ? ghAuth() : '', r;
  for (let i = 0; i < 3; i++) {   // transient network errors and 5xx: retry
    r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', ...(tok ? { authorization: `Bearer ${tok}` } : {}) } }).catch((e) => ({ ok: false, status: 0, statusText: e.cause?.code ?? e.message }));
    if (r.status === 401 && tok) { tok = ''; continue; }   // a stale token: try without
    if (r.ok || (r.status && r.status < 500)) break;
    await sleep(1000 * (i + 1));
  }
  if (!r.ok) {
    // a proxy/firewall answering for the host (x-deny-reason, e.g. host_not_allowed): no code can fix that, a person must open the network
    const deny = r.headers?.get?.('x-deny-reason');
    if (deny) throw new Error(`${r.status} ${url} (blocked by the network proxy: ${deny}. Not fixable in code: ask a person to allow ${new URL(url).host})`);
    const why = /github\.com/.test(url) && (r.status === 403 || r.status === 429)
      ? ` (GitHub refused: rate limit or blocked network${tok ? '' : '; set GITHUB_TOKEN'})` : r.status ? '' : ` (${r.statusText}: network unreachable)`;
    throw new Error(`${r.status || 'ERR'} ${url}${why}`);
  }
  return Buffer.from(await r.arrayBuffer());
}
function unzip(buf, dest) {
  let e = buf.length - 22;
  while (e > 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  let p = buf.readUInt32LE(e + 16);
  for (let n = buf.readUInt16LE(e + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const fl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = zipName(buf.subarray(p + 46, p + 46 + fl), buf.readUInt16LE(p + 8));   // (Shift_JIS from a Japanese Windows too)
    p += 46 + fl + xl + cl;
    if (name.includes('..')) continue;
    const to = path.join(dest, name);
    if (name.endsWith('/')) { fs.mkdirSync(to, { recursive: true }); continue; }
    const at = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(at, at + size);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, method === 8 ? zlib.inflateRawSync(raw) : raw);
  }
}
function untarFile(tgz, want) {
  const b = zlib.gunzipSync(tgz);
  for (let i = 0; i + 512 <= b.length;) {
    const name = b.toString('utf8', i, i + 100).replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(b.toString('utf8', i + 124, i + 136).replace(/\0.*$/s, '').trim() || '0', 8);
    if (name === want) return b.subarray(i + 512, i + 512 + size);
    i += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}
function enableBeta(file) {
  const b = fs.readFileSync(file);
  let i = 8;
  const u8 = () => b[i++], s = () => { const n = b.readUInt16LE(i); i += 2 + n; return b.toString('utf8', i - n, i); };
  const skip = (t) => {
    const sz = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 }[t];
    if (sz) { i += sz; return; }
    if (t === 7) { i += 4 + b.readInt32LE(i); return; }
    if (t === 8) { s(); return; }
    if (t === 9) { const et = u8(), n = b.readInt32LE(i); i += 4; for (let k = 0; k < n; k++) skip(et); return; }
    if (t === 10) { for (let c; (c = u8()) !== 0;) { s(); skip(c); } return; }
    if (t === 11) { i += 4 + 4 * b.readInt32LE(i); return; }
    if (t === 12) { i += 4 + 8 * b.readInt32LE(i); return; }
    throw new Error('nbt ' + t);
  };
  const tag = (t, name, payload) => { const nb = Buffer.from(name); const h = Buffer.alloc(3); h[0] = t; h.writeUInt16LE(nb.length, 1); return Buffer.concat([h, nb, payload]); };
  const byte1 = (name) => tag(1, name, Buffer.from([1]));
  const exp = Buffer.concat([tag(10, 'experiments', Buffer.concat(['gametest', 'experiments_ever_used', 'saved_with_toggled_experiments'].map(byte1).concat(Buffer.from([0]))))]);
  if (u8() !== 10) throw new Error('level.dat');
  s();
  const bodyStart = i;
  let cut = null;
  for (let t; (t = b[i]) !== 0;) {
    const st = i; i++;
    const name = s();
    skip(t);
    if (name === 'experiments') cut = [st, i];
  }
  const end = i; // at root END
  let body = b.subarray(bodyStart, end);
  if (cut) body = Buffer.concat([b.subarray(bodyStart, cut[0]), b.subarray(cut[1], end)]);
  const root = Buffer.concat([b.subarray(8, bodyStart), body, exp, Buffer.from([0])]);
  const head = Buffer.alloc(8);
  head.writeInt32LE(b.readInt32LE(0), 0);
  head.writeInt32LE(root.length, 4);
  fs.writeFileSync(file, Buffer.concat([head, root]));
}

let CRC;
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  CRC ??= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const parts = [], cent = [];
  let off = 0;
  for (const { name, data, store } of entries) {   // store: already compressed (zip inside zip), keep as is
    const nb = Buffer.from(name), comp = store ? data : zlib.deflateRawSync(data), crc = crc32(data), m = store ? 0 : 8;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(m, 8); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(m, 10); c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    cent.push(c, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(cent), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

// ---------- BDS / npm versions ----------
// a download that is not a zip (a captive portal, a proxy's error page, a CDN's HTML): say so instead of a broken unzip later
function mustZip(buf, from) {
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return buf;
  const head = buf.subarray(0, 120).toString('utf8').replace(/\s+/g, ' ').trim();
  throw new Error(`${from} did not return a zip (${buf.length} bytes, starts "${head.slice(0, 80)}"): a proxy or login page? Download it in a browser and set LAB_BDS_ZIP=<file>`);
}
// the CDNs BDS zips live on, tried in order (the official one, then the older Azure one that still serves most builds)
const BDS_CDNS = (k) => [...new Set([k?.cdn_root ?? 'https://www.minecraft.net/bedrockdedicatedserver', ...(k?.cdn_mirrors ?? []), 'https://minecraft.azureedge.net'])];
const bdsUrls = (k, ver, preview) => BDS_CDNS(k).map((r) => `${r}/bin-${WIN ? 'win' : 'linux'}${preview ? '-preview' : ''}/bedrock-server-${ver}.zip`);
// BDS comes from, in order: LAB_BDS_ZIP, vendor/bedrock-server.zip (committed via Git LFS / bundled in the
// template zip), the official download API, data/bds-versions.json (CDN list kept in the repo), FALLBACK.
// A download is kept as vendor/bedrock-server.zip so GitHub, CI and `bundle` carry the exact same server.
const VENDOR_ZIP = path.join(FDIR, 'vendor', 'bedrock-server.zip');
const VENDOR_VER = path.join(FDIR, 'vendor', 'bds-version.txt');
const knownBds = () => { try { return JSON.parse(fs.readFileSync(path.join(LIBDIR, 'data', 'bds-versions.json'), 'utf8')); } catch { return null; } };
async function latestBds(preview = false) {
  const kind = WIN ? 'Windows' : 'Linux';
  try {
    const j = JSON.parse((await get('https://net-secondary.web.minecraft-services.net/api/v1.0/download/links')).toString());
    const url = j.result.links.find((l) => l.downloadType === `serverBedrock${preview ? 'Preview' : ''}${kind}`)?.downloadUrl;
    const ver = /bedrock-server-([\d.]+)\.zip/.exec(url ?? '')?.[1];
    if (url && ver) return { ver, url };
  } catch { /* offline or blocked: use the list in the repo */ }
  const k = knownBds(), ver = k?.[WIN ? 'windows' : 'linux']?.[preview ? 'preview' : 'stable'] ?? FALLBACK;
  return { ver, url: bdsUrls(k, ver, preview)[0] };
}
// the flavor installs its own server (Endstone downloads BDS itself, LeviLamina comes through lip); bds takes the plain BDS zip
async function ensureBds(o = {}) { return F.ensureServer ? F.ensureServer(L(), o) : ensureVanillaBds(o); }
async function ensureVanillaBds({ version, preview = false } = {}) {
  // a version-matrix run (test --bds) pins its own server in its own cache and leaves vendor/ alone
  const pinned = process.env.LAB_BDS_VERSION, noVendor = !!process.env.LAB_NO_VENDOR;
  // (installed = the server and its VERSION, both: a BDS still being unpacked by another lab process is not one)
  const installed = () => exists(EXE) && exists(path.join(BDS, 'VERSION'));
  if (pinned && !version) { if (installed() && bdsVersion() === pinned) return; version = pinned; preview = (knownBds()?.[WIN ? 'windows' : 'linux']?.preview_versions ?? []).includes(pinned); }
  if (installed() && !version) return;
  if (!['linux', 'win32'].includes(RT.serverOS)) die('BDS runs on Linux/Windows: on macOS the lab runs it in a Linux container (unset LAB_RUNTIME, install Docker Desktop / OrbStack / colima)');
  let buf, ver;
  // LAB_BDS_ZIP: a zip on disk or its URL (a mirror, an internal file server): the way in when the official CDN is blocked
  const given = process.env.LAB_BDS_ZIP;
  if (given && !pinned) {
    if (/^https?:\/\//.test(given)) { try { buf = mustZip(await get(given), given); } catch (e) { die(`LAB_BDS_ZIP=${given}: ${e.message}`); } }
    else { if (!exists(given)) die(`LAB_BDS_ZIP=${given}: no such file (the bedrock-server-<version>.zip for ${WIN ? 'Windows' : 'Linux'})`); try { buf = mustZip(fs.readFileSync(given), given); } catch (e) { die(e.message); } }
    ver = /(\d+\.\d+\.\d+\.\d+)/.exec(path.basename(given))?.[1];
  }
  else if (!version && !noVendor && exists(VENDOR_ZIP) && fs.statSync(VENDOR_ZIP).size > 1e6) { buf = fs.readFileSync(VENDOR_ZIP); ver = exists(VENDOR_VER) ? fs.readFileSync(VENDOR_VER, 'utf8').trim() : undefined; }
  else {
    const k = knownBds();
    const pick = version ? { ver: version, url: bdsUrls(k, version, preview)[0] } : await latestBds(preview);
    const tried = [];
    for (const url of [...new Set([pick.url, ...bdsUrls(k, pick.ver, preview)])]) {
      try { buf = mustZip(await get(url), url); break; } catch (e) { tried.push(`  ${url}: ${e.message}`); }
    }
    if (!buf) {
      const blocked = tried.every((t) => /blocked by the network proxy|network unreachable|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(t));
      die([`cannot download BDS ${pick.ver} (${WIN ? 'Windows' : 'Linux'}):`, ...tried,
        blocked ? 'The network is blocked here: no code change fixes that. Ask a person for one of:' : 'Ways in:',
        `  LAB_BDS_ZIP=<path or URL of bedrock-server-${pick.ver}.zip>   (download it where the network is open: ${pick.url})`,
        `  or put that zip at ${rel(VENDOR_ZIP)} (+ ${rel(VENDOR_VER)} with the version)`,
        '  or allow www.minecraft.net (and net-secondary.web.minecraft-services.net for "latest") through the proxy',
        'Check everything the lab downloads at once: node lab.mjs doctor'].join('\n'));
    }
    ver = pick.ver;
    if (!noVendor) {
      fs.mkdirSync(path.dirname(VENDOR_ZIP), { recursive: true });
      fs.writeFileSync(VENDOR_ZIP, buf);
      fs.writeFileSync(VENDOR_VER, ver + '\n');
    }
  }
  // unpacked beside it, then moved in as a whole: another lab process (tests side by side) never sees a server without its
  // VERSION. One that finished first while this one unpacked wins (its server is the same build); this copy goes
  const tmp = `${BDS}.new-${process.pid}`, exe = path.join(tmp, path.relative(BDS, EXE));
  fs.rmSync(tmp, { recursive: true, force: true });
  unzip(buf, tmp);
  if (!exists(exe)) { fs.rmSync(tmp, { recursive: true, force: true }); die(`the BDS zip has no ${path.basename(EXE)} (wrong OS build?)`); }
  if (!WIN) fs.chmodSync(exe, 0o755);
  ver ??= /\b(1\.\d+\.\d+\.\d+)\b/.exec(fs.readFileSync(path.join(tmp, 'release-notes.txt'), 'utf8'))?.[1] ?? FALLBACK;
  fs.writeFileSync(path.join(tmp, 'VERSION'), ver);
  if (!version && !pinned && installed()) { fs.rmSync(tmp, { recursive: true, force: true }); return; }
  const before = exists(path.join(BDS, 'VERSION')) ? fs.readFileSync(path.join(BDS, 'VERSION'), 'utf8').split('\n')[0].trim() : null;
  fs.rmSync(path.join(CACHE, 'run'), { recursive: true, force: true });   // instances link the old files
  fs.rmSync(BDS, { recursive: true, force: true });
  try { fs.renameSync(tmp, BDS); } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); if (!installed()) throw e; }
  // (what is tied to the BDS version goes only when the version changed: a first install or the same build again keeps what
  // other lab processes made meanwhile — they read it while this runs)
  if (before && before !== ver) for (const d of ['world', 'types', 'beta.json', 'samples']) { const p = path.join(CACHE, d); try { if (fs.lstatSync(p).isSymbolicLink()) continue; } catch { continue; } fs.rmSync(p, { recursive: true, force: true }); }   // tied to the BDS version (a shared link stays)
}
let NO_SERVER = false;
const CARRY = path.join(TOP, 'carry', `${F.name}-types.json.gz`);   // types saved by verify, travelling with the folder
const carriedBds = () => { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(CARRY)).toString('utf8')).bds; } catch { return null; } };   // offline (a chat AI's sandbox): commands that only need version numbers use the known BDS list
const bdsVersion = () => { try { return fs.readFileSync(path.join(BDS, 'VERSION'), 'utf8').split('\n')[0].trim(); } catch (e) { if (NO_SERVER) return carriedBds() ?? knownBds()?.linux?.stable ?? '1.26.0.0'; throw e; } };
// ensureBds, or (network blocked) carry on without a server where only versions are needed; say how it gets verified later
async function ensureBdsOrOffline(what) {
  try { await ensureBds(); } catch (e) {
    if (!(e instanceof Stop) || !/network|blocked|LAB_BDS_ZIP|unreachable/i.test(e.message)) throw e;
    NO_SERVER = true;
    out(`W no server here (network blocked): ${what} uses the known BDS ${bdsVersion()}. Not verified yet: where the network is open run \`node lab.mjs verify\` (or double-click verify.cmd / verify.command) and paste its result back`);
  }
}   // line 1 = BDS version, more lines = flavor build (Endstone/LeviLamina)

// ---------- locks and instances ----------
// Every running BDS gets its own folder under .lab/run/ made of hard links to the extracted server (free, instant),
// so `test`, the live server (`up`) and parallel runs never share a world, a port or a config file.
const held = new Set();
process.on('exit', () => { for (const f of held) try { fs.rmSync(f); } catch { /* gone */ } });
function tryLock(f) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  for (let k = 0; k < 3; k++) {
    try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); held.add(f); return true; } catch { /* held */ }
    let pid = 0;
    try { pid = Number(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (pid === process.pid) return true;
    try { process.kill(pid, 0); return false; } catch { fs.rmSync(f, { force: true }); }
  }
  return false;
}
const unlock = (f) => { held.delete(f); fs.rmSync(f, { force: true }); };
async function lock(f = path.join(CACHE, 'lock')) {
  for (let k = 0; k < 1200; k++) { if (tryLock(f)) return () => unlock(f); await sleep(500); }
  die('another lab run holds ' + f);
}
function linkTree(src, dst, top = true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (top && ['worlds', 'profiles', 'diagnostics', 'logs', 'crash_reports', ...(F.noLink ?? [])].includes(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { linkTree(s, d, false); continue; }
    // config, text and data files are written in place by BDS, plugins (a SQLite db) and us: real copies, or the write would reach the
    // pristine install through the link. Big binaries and the vanilla packs (thousands of read-only files) are linked
    const packs = /[\\/](behavior_packs|resource_packs|definitions)[\\/]/.test(d);
    if ((top && fs.statSync(s).size < 1e6) || (!packs && fs.statSync(s).size < 256e3) || /[\\/](config|data|logs|crash_reports)[\\/]/.test(d) || F.copyFile?.(d)) { fs.copyFileSync(s, d); continue; }
    try { fs.linkSync(s, d); } catch { fs.copyFileSync(s, d); }
  }
}
// claim a free instance: base, base1, base2 ... (a second `test` while one runs gets its own server)
async function claim(base) {
  await ensureBds();
  for (let k = 0; k < 16; k++) {
    const name = k ? base + k : base, dir = path.join(CACHE, 'run', name);
    if (!tryLock(dir + '.lock')) continue;
    let v = ''; try { v = fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(); } catch { /* new */ }
    const want = fs.readFileSync(path.join(BDS, 'VERSION'), 'utf8').trim() + ' links2';   // (links2: small files are copies)
    if (v !== want) { fs.rmSync(dir, { recursive: true, force: true }); linkTree(BDS, dir); fs.writeFileSync(path.join(dir, 'VERSION'), want); }
    return { name, dir, exe: path.join(dir, path.basename(EXE)), release: () => unlock(dir + '.lock') };
  }
  die('16 lab servers already running');
}

const npmDocs = new Map();
async function npmVersions(name) {
  if (!npmDocs.has(name)) npmDocs.set(name, JSON.parse((await get(`https://registry.npmjs.org/${name}`)).toString()));
  return npmDocs.get(name);
}

// beta module versions this BDS accepts, e.g. server 2.11.0-beta, gametest 1.0.0-beta
async function betaVersions() {
  const f = path.join(CACHE, 'beta.json');
  if (exists(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const bv = bdsVersion().split('.').slice(0, 3).join('.');
  const r = {};
  for (const n of ['server', 'server-gametest']) {
    // exact build, else the newest earlier build of the same family (npm has no beta for some hotfix builds, e.g. 1.26.45 → 1.26.44)
    const [ma, mi, pa] = bv.split('.').map(Number), all = Object.keys((await npmVersions('@minecraft/' + n)).versions);
    const hit = (b) => { const st = all.filter((v) => v.endsWith(`-beta.${b}-stable`)); return st.length || b !== bv ? st : previewBetas(all, b); };
    let vs = [], used = bv;
    for (let q = pa; q >= Math.floor(pa / 10) * 10 && !vs.length; q--) { used = `${ma}.${mi}.${q}`; vs = hit(used); }
    if (!vs.length) die(`no @minecraft/${n} beta for BDS ${bv}`);
    r[n] = vs.pop().replace(new RegExp(`\\.${used.replace(/\./g, '\\.')}-(stable|preview\\.\\d+)$`), '');
  }
  fs.writeFileSync(f, JSON.stringify(r));
  return r;
}

async function typeFile(name, want) {
  const f = path.join(CACHE, 'types', `${name.slice(11)}@${want}.d.ts`);
  if (exists(f)) return f;
  const carry = B.carryLoad(CARRY, CACHE), cf = carry && path.join(carry.dir, 'node_modules', name, 'index.d.ts');
  if (cf && exists(cf)) { try { const pv = readJson(path.join(carry.dir, 'node_modules', name, 'package.json')).version; if (String(pv).startsWith(want)) return cf; } catch { /* no package.json */ } }
  const doc = await npmVersions(name);
  const bv = bdsVersion().split('.').slice(0, 3).join('.');
  const vs = Object.keys(doc.versions);
  const v = vs.includes(want) ? want : vs.filter((x) => x.startsWith(want + '.') && x.includes(bv)).pop() ?? vs.filter((x) => x.startsWith(want)).pop();
  if (!v) die(`no npm version for ${name}@${want}`);
  const dts = untarFile(await get(doc.versions[v].dist.tarball), 'package/index.d.ts');
  if (!dts) die(`no index.d.ts in ${name}@${v}`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, dts);
  return f;
}

async function ensureTypes() {
  const beta = NO_SERVER ? await betaVersions().catch(() => ({})) : await betaVersions();
  const deps = exists(path.join(BP, 'manifest.json')) ? (readJson(path.join(BP, 'manifest.json')).dependencies ?? []).filter((d) => d.module_name?.startsWith('@minecraft/')) : [];
  // no current addon (a fresh lab, or between units): the modules a new addon gets, not only gametest (`api World` said "none")
  if (!deps.length) for (const m of ['server', 'server-ui']) if (beta[m]) deps.push({ module_name: `@minecraft/${m}`, version: beta[m] });
  if (!deps.some((d) => d.module_name === '@minecraft/server-gametest') && beta['server-gametest']) deps.push({ module_name: '@minecraft/server-gametest', version: beta['server-gametest'] });
  const out = [];
  for (const d of deps) { try { out.push(await typeFile(d.module_name, String(d.version))); } catch (e) { if (!NO_SERVER) throw e; } }   // offline: what carry/ has
  if (NO_SERVER && !out.length) die('api offline needs the types from a first verify (carry/): none here yet');
  return out;
}

// ---------- server ----------
function udpFree(port) {
  return new Promise((res) => {
    const s = dgram.createSocket('udp4');
    s.once('error', () => res(false));
    s.bind(port, '0.0.0.0', () => s.close(() => res(true)));
  });
}

function setProps(inst, props) {
  const f = path.join(inst.dir, 'server.properties');
  let p = exists(f) ? fs.readFileSync(f, 'utf8') : '';
  for (const [k, v] of Object.entries(props)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    p = re.test(p) ? p.replace(re, () => `${k}=${v}`) : `${p.trimEnd()}\n${k}=${v}\n`;
  }
  fs.writeFileSync(f, p);
}

const LOG = [];
const ONLINE = new Set();   // who BDS says is connected (the lab's clients and people who joined from their own Minecraft)
// LAB_TAIL=<file>: every log line also goes to that file as it happens (follow a long run: tail -f)
if (process.env.LAB_TAIL) { const f = process.env.LAB_TAIL, push = LOG.push.bind(LOG); LOG.push = (...xs) => { try { fs.appendFileSync(f, xs.map((l) => String(l).replace(/^\[[\d-]+ [\d:]+ \w+\] /, '')).join('\n') + '\n'); } catch { /* best effort */ } return push(...xs); }; }
let srvPort = 0;

// kernels without IPv6 (common in containers/CI): BDS's RakNet refuses to start, and under Wine NetherNet finds no network
// interface (GetAdaptersAddresses fails without /proc/net/if_inet6): preload a tiny shim (common/ipv6-shim.c)
// LAB_SPEED: gettimeofday on the real clock (common/speed-shim.c), preloaded before libfaketime so RakNet's timeouts stay real
function speedShim() {
  if (process.env.LAB_SPEED_SHIM) return process.env.LAB_SPEED_SHIM === 'off' ? null : process.env.LAB_SPEED_SHIM;   // off | <another .so>
  const src = path.join(LIBDIR, 'speed-shim.c'), so = path.join(CACHE, `speed-shim-${crypto.createHash('md5').update(fs.readFileSync(src)).digest('hex').slice(0, 8)}.so`);
  if (exists(so)) return so;
  for (const cc of ['cc', 'gcc', 'clang']) {
    const r = RT.run(cc, ['-shared', '-fPIC', '-O2', '-o', so, src, '-ldl']);
    if (r.status === 0) return so;
  }
  LOG.push(`[0-0-0 0:0:0 WARN] LAB_SPEED=${SPEED}: no C compiler for the network clock shim (install gcc): above ~10x a busy moment can drop players`);
  return null;
}
function ipv6Shim() {
  if (RT.serverOS !== 'linux') return null;
  if (RT.kind === 'native') { try { if (fs.readFileSync('/proc/net/if_inet6', 'utf8').trim()) return null; } catch { /* no ipv6 */ } }
  else { const r = RT.run('cat', ['/proc/net/if_inet6']); if (r.status === 0 && r.stdout.trim()) return null; }   // containers: IPv6 is off by default
  // named by the source's hash: an updated shim is rebuilt
  const src = path.join(LIBDIR, 'ipv6-shim.c'), so = path.join(CACHE, `ipv6-shim-${crypto.createHash('md5').update(fs.readFileSync(src)).digest('hex').slice(0, 8)}.so`);
  if (exists(so)) return so;
  for (const cc of ['cc', 'gcc', 'clang']) {
    const r = RT.run(cc, ['-shared', '-fPIC', '-O2', '-o', so, path.join(LIBDIR, 'ipv6-shim.c'), '-ldl']);
    if (r.status === 0) return so;
  }
  LOG.push('[0-0-0 0:0:0 WARN] no IPv6 and no C compiler: real players cannot connect (install gcc)');
  return null;
}

// ---------- real players (bedrock-protocol, installed into the cache on first use) ----------
// WebRTC for NetherNet real players: node-datachannel (libdatachannel; prebuilt binaries for macOS/Linux/Windows, fetched by its
// install script, so scripts stay on for this one), next to bedrock-protocol. Only when a NetherNet join happens.
async function rtcDeps() {
  // its own folder: an `npm i` next to bedrock-protocol would re-add and try to compile raknet-native (optional, not used)
  const dir = path.join(CACHE, 'node-rtc');
  const reqd = createRequire(path.join(dir, 'package.json'));
  try { return reqd('node-datachannel/polyfill'); } catch { /* not yet */ }
  fs.mkdirSync(dir, { recursive: true });
  if (!exists(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
  let r;
  for (let i = 0; i < 2; i++) {   // one retry: the prebuilt binary comes from GitHub releases
    r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', 'node-datachannel@latest', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', shell: WIN });
    if (r.status === 0) break;
  }
  if (r.status !== 0) die('npm install node-datachannel (WebRTC for NetherNet) failed (needs github.com for its prebuilt binary):\n' + (r.stderr || r.stdout).slice(-800));
  return reqd('node-datachannel/polyfill');
}
// Xbox sign-in (prismarine-auth) is never used (offline joins); a stub replaces it. Written straight into node_modules
// (npm's `overrides: file:` resolves relative to the dependent on some npm versions and leaves a broken link)
function authStub(dir) {
  const stub = path.join(dir, 'node_modules', 'prismarine-auth');
  if (exists(path.join(stub, 'index.js')) && fs.readFileSync(path.join(stub, 'index.js'), 'utf8').includes('bds-lab')) return;
  fs.rmSync(stub, { recursive: true, force: true });
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'package.json'), '{"name":"prismarine-auth","version":"99.0.0","main":"index.js"}');
  fs.writeFileSync(path.join(stub, 'index.js'), "class Authflow { constructor() {} async getMinecraftBedrockToken() { throw new Error('bds-lab: online sign-in is not used (offline mode)'); } async getMsaToken() { return this.getMinecraftBedrockToken(); } }\nmodule.exports = { Authflow, Titles: new Proxy({}, { get: (_, k) => String(k) }), RelyingParty: new Proxy({}, { get: (_, k) => String(k) }) };\n");
}
// an install that failed once in this process fails again at once (no network: every `@X join` of a QA or a test used to
// run npm again and wait for it to fail, seconds each)
let REAL_DEPS_FAIL = null;
async function realDeps({ loud = false } = {}) {
  const dir = path.join(CACHE, 'node');
  const mod = path.join(dir, 'node_modules', 'bedrock-protocol');
  if (!exists(mod) && REAL_DEPS_FAIL) die(REAL_DEPS_FAIL);
  if (!exists(mod)) {
    fs.mkdirSync(dir, { recursive: true });
    // prismarine-auth pulls a GitHub-hosted package that newer npm refuses (EALLOWGIT): override it with a placeholder, then authStub()
    const ph = path.join(dir, 'stub', 'prismarine-auth');
    fs.mkdirSync(ph, { recursive: true });
    fs.writeFileSync(path.join(ph, 'package.json'), '{"name":"prismarine-auth","version":"99.0.0","main":"index.js"}');
    fs.writeFileSync(path.join(ph, 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ private: true, overrides: { 'prismarine-auth': 'file:' + ph.replace(/\\/g, '/') } }));
    const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', 'bedrock-protocol@latest', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', shell: WIN, env: { ...process.env, npm_config_allow_git: 'all' } });
    if (r.status !== 0) die((REAL_DEPS_FAIL = 'npm install bedrock-protocol failed:\n' + (r.stderr || r.stdout).slice(-800)));
    // keep only the minecraft-data this BDS needs (~430MB -> a few MB)
    try {
      const md = path.join(dir, 'node_modules', 'minecraft-data', 'minecraft-data', 'data');
      // keep the tables of every bedrock version from 1.21 on (a real player can join as an older client: `join version=`),
      // LAB_KEEP_PROTOCOLS=all keeps all; the Java (pc) data never
      const all = JSON.parse(fs.readFileSync(path.join(md, 'dataPaths.json'), 'utf8')).bedrock, want = all[dataVersion(Object.keys(all))];
      if (want) {
        const keep = new Set(Object.entries(all).filter(([v]) => process.env.LAB_KEEP_PROTOCOLS === 'all' || v === dataVersion(Object.keys(all)) || (/^\d+\.\d+\.\d+$/.test(v) && vcmp3(v, '1.21.0') >= 0)).flatMap(([, w]) => Object.values(w)));
        for (const kind of ['bedrock', 'pc']) for (const v of fs.readdirSync(path.join(md, kind))) if (!keep.has(`${kind}/${v}`) && !['common', 'latest'].includes(v)) fs.rmSync(path.join(md, kind, v), { recursive: true, force: true });
      }
      for (const d of ['typescript', 'raknet-native', 'raknet-node']) fs.rmSync(path.join(dir, 'node_modules', d), { recursive: true, force: true });
    } catch { /* pruning is optional */ }
  }
  authStub(dir);
  const req = createRequire(path.join(dir, 'package.json'));
  const { Versions } = req('bedrock-protocol/src/options');
  const ver = dataVersion(Object.keys(Versions)), newest = dataVersion(Object.keys(Versions), '9.9.9');
  const fam = (v) => { const p = v.split('.').map(Number); return p[0] * 1e6 + p[1] * 1e3 + Math.floor(p[2] / 10) * 10; };   // 1.26.60.x is a new protocol family
  const versions = Object.keys(Versions).filter((k) => /^\d+\.\d+\.\d+$/.test(k));
  if (!ver || fam(bdsVersion()) > fam(newest)) {
    // a Minecraft newer than bedrock-protocol (a preview, release day): the players borrow the newest packet data it has and speak
    // the server's own protocol number (read from its RakNet ping at join). Most updates keep the packets that matter, so tests
    // can run on day 0; if the packets did change the joins fail and say so. LAB_BORROW=0: refuse instead, as before
    if (process.env.LAB_BORROW === '0' || !newest) die(`bedrock-protocol does not speak BDS ${bdsVersion()} yet (newest: ${newest}). Try: node lab.mjs setup --update`);
    if (loud) out(`W bedrock-protocol does not speak BDS ${bdsVersion()} yet (newest ${newest}): real players borrow ${newest}'s packets with the server's protocol number (LAB_BORROW=0 refuses)`);
    return { req, ver: newest, versions, borrow: true };
  }
  return { req, ver, versions };
}
// what a borrowed client's own packet code throws when the new server changed a packet it builds or reads
const BORROW_GAP = /SizeOf|Cannot convert .* to a BigInt|Read error|Serializ|is not iterable|of undefined|of null/i;
// borrow: the protocol number this BDS speaks, from its RakNet ping (MCPE;motd;<protocol>;<version>;...), put under the borrowed
// version in bedrock-protocol's table so the handshake says the server's number
async function borrowProtocol(req, ver, port) {
  const sock = dgram.createSocket('udp4'), magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
  const reply = await new Promise((res) => {
    const t = setTimeout(() => res(null), 3000);
    sock.on('message', (m) => { if (m[0] === 0x1c) { clearTimeout(t); res(m); } });
    const b = Buffer.alloc(33); b[0] = 0x01; b.writeBigInt64BE(BigInt(Date.now()), 1); magic.copy(b, 9); b.writeBigInt64BE(7n, 25);
    sock.send(b, port, '127.0.0.1');
  });
  sock.close();
  let proto = Number(reply?.subarray(35).toString('utf8').split(';')[2]) || null;
  // BDS's pong carries no server string here: Mojang's own protocol docs (bedrock-protocol-docs, as `proto` reads them) say the number
  if (!proto) try {
    const dir = await (await X()).protoDir(CACHE, bdsVersion().split('.').slice(0, 3).join('.'));
    proto = Number(JSON.parse(fs.readFileSync(path.join(dir, 'RequestNetworkSettingsPacketPayload.json'), 'utf8'))['x-protocol-version']) || null;
  } catch { /* no docs: the handshake keeps the borrowed number */ }
  if (!proto) return null;
  const O = req('bedrock-protocol/src/options');
  O.Versions[ver] = proto;
  return proto;
}
// the protocol data a BDS build speaks: the newest minecraft-data version not newer than it (BDS 1.26.44.3 -> 1.26.40: one protocol family)
// a regex from a test/until line; a leading (?i) (PCRE/Python habit) means case-insensitive
const rx = (src) => { const m = /^\(\?i\)/.exec(src); return new RegExp(m ? src.slice(4) : src, m ? 'i' : ''); };
const vcmp3 = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
function dataVersion(keys, upTo = bdsVersion()) { return keys.filter((k) => /^\d+\.\d+\.\d+$/.test(k) && vcmp3(k, upTo) <= 0).sort((a, b) => vcmp3(b, a))[0]; }
async function ready(srv) {
  const first = await srv.wait(/LAB_READY|Server started(\.| in \()/, 120000);
  if (!first || /LAB_READY/.test(first)) return first;
  return srv.wait(/LAB_READY/, 20000);
}
// the server's transport: raknet (default: every real player path is measured on it) or nethernet (WebRTC: HTTP signaling on the
// TCP server-port, then UDP per client in the server-udp-ports window; the lab's real players then speak NetherNet too)
// lan: the server runs NetherNet with LAN visibility and the real players join it the way a local world is joined (UDP 7551
// discovery + LAN signaling, through common/nethernet-connect's guard: this machine only)
const TRANSPORT = ['nethernet', 'lan'].includes(process.env.LAB_TRANSPORT) ? process.env.LAB_TRANSPORT : 'raknet';
const SRV_TRANSPORT = TRANSPORT === 'raknet' ? 'raknet' : 'nethernet';
// time acceleration (see boot): the multithreaded libfaketime (BDS runs many threads), native Linux only
let SPEED = Math.max(1, Number(process.env.LAB_SPEED) || 1);   // `speed <x>` changes it (a restart)
// the server's clock as its own ticks say (globalThis.__labSrvClock, read by realplayer.cjs): the tick, when it came (performance.now()),
// and the rate over the last second (ticks a second). The clients in this process follow it instead of a fixed 50/k ms, so a server
// that cannot hold the asked speed slows them down with it rather than falling behind them
const SRV_SAMPLES = [];
function serverClock(tick) {
  const at = performance.now();
  if (SRV_SAMPLES.length && tick < SRV_SAMPLES.at(-1)[0]) SRV_SAMPLES.length = 0;   // (a restarted server counts from 0 again)
  SRV_SAMPLES.push([tick, at]);
  while (SRV_SAMPLES.length > 2 && at - SRV_SAMPLES[0][1] > 1500) SRV_SAMPLES.shift();
  const [t0, a0] = SRV_SAMPLES[0], rate = at - a0 > 200 ? ((tick - t0) * 1000) / (at - a0) : 20 * SPEED;
  globalThis.__labSrvClock = { tick, at, rate: Math.max(1, rate) };
}
if (SPEED > 1 && !process.env.LAB_TICK_MS) process.env.LAB_TICK_MS = String(50 / SPEED);   // fractional is fine: the client's loop keeps the average
let speedLibIn = undefined;   // the container's copy (looked up once)
function speedLib() {
  if (SPEED <= 1) return null;
  if (RT.kind === 'docker') {   // macOS: the lab image carries libfaketime (built with it)
    if (speedLibIn === undefined) { const f = '/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1'; speedLibIn = RT.run('test', ['-f', f]).status === 0 ? f : null; }
    if (!speedLibIn) LOG.push(`[0-0-0 0:0:0 WARN] LAB_SPEED=${SPEED}: the lab image has no libfaketime yet (node lab.mjs setup rebuilds it): running at 1x`);
    return speedLibIn;
  }
  const f = [process.env.LAB_FAKETIME_LIB, '/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1', '/usr/lib/aarch64-linux-gnu/faketime/libfaketimeMT.so.1', '/usr/local/lib/faketime/libfaketimeMT.so.1', '/usr/lib64/faketime/libfaketimeMT.so.1'].find((x) => x && exists(x));
  if (!f || RT.kind !== 'native' || WIN) { LOG.push(`[0-0-0 0:0:0 WARN] LAB_SPEED=${SPEED}: needs libfaketime on Linux (apt install faketime / dnf install libfaketime, or LAB_FAKETIME_LIB=<libfaketimeMT.so.1>; Windows: not available): running at 1x`); return null; }
  return f;
}
const NN_WINDOW = (port) => [port + 100, port + 107];
async function boot(inst) {
  if (TRANSPORT === 'lan' && RT.kind === 'docker') die('LAB_TRANSPORT=lan: the server must run natively (LAN discovery on UDP 7551 does not cross the container); use LAB_TRANSPORT=nethernet here');
  let port = Number(process.env.LAB_PORT) || 19132 + 2 * Math.floor(Math.random() * 400);
  for (let k = 0; k < 50 && !(await udpFree(port) && await udpFree(port + 1)); k++) port += 2;
  setProps(inst, {
    'level-name': 'lab', 'level-type': WORLD_KIND === 'normal' ? 'DEFAULT' : 'FLAT', ...(WORLD_KIND === 'normal' ? { 'level-seed': SEED } : {}), 'online-mode': 'false', 'allow-list': 'false', 'gamemode': 'survival',
    'difficulty': process.env.LAB_DIFFICULTY || 'normal', 'allow-cheats': 'true', 'content-log-console-output-enabled': 'true', 'content-log-file-enabled': 'false',
    'emit-server-telemetry': 'false', 'view-distance': process.env.LAB_VIEW || (WORLD_KIND === 'normal' ? '10' : '5'), 'tick-distance': process.env.LAB_TICK_DISTANCE || '4', 'enable-lan-visibility': TRANSPORT === 'lan' || process.env.LAB_LAN_VISIBLE === '1' ? 'true' : 'false',
    ...(process.env.LAB_MAX_THREADS ? { 'max-threads': process.env.LAB_MAX_THREADS } : {}),
    // LAB_WATCHDOG_MS=<ms>: the script watchdog's hang limit, and a hang neither interrupts the script nor stops the server
    // (a machine an Android emulator keeps busy, the app lab: a script that waited 10 s for the CPU did not hang)
    ...(Number(process.env.LAB_WATCHDOG_MS) > 0 ? { 'script-watchdog-hang-threshold': String(Number(process.env.LAB_WATCHDOG_MS)), 'script-watchdog-hang-exception': 'false', 'script-watchdog-enable-shutdown': 'false' } : {}),
    ...(process.env.LAB_COMPRESSION_THRESHOLD ? { 'compression-threshold': process.env.LAB_COMPRESSION_THRESHOLD } : {}),
    'player-idle-timeout': '0', 'max-players': process.env.LAB_MAX_PLAYERS || '100',   // BDS's own default is 10: races put more on one server
    'server-port': String(port), 'server-portv6': String(port + 1), 'transport': SRV_TRANSPORT,
    // NetherNet: a small UDP window; in a container it is advertised as 127.0.0.1 (the host side of the published ports)
    ...(SRV_TRANSPORT === 'nethernet' ? { 'server-udp-ports': RT.kind === 'docker' ? `127.0.0.1:${NN_WINDOW(port).join('-')}:${NN_WINDOW(port).join('-')}` : NN_WINDOW(port).join('-') } : {}),
    'player-position-acceptance-threshold': '0', 'default-player-permission-level': 'operator',
    // LAB_TEXTUREPACK_REQUIRED=1: clients must take the addon's resource pack (the app lab: a real app has to show the pack's JSON UI)
    'texturepack-required': process.env.LAB_TEXTUREPACK_REQUIRED === '1' ? 'true' : 'false',
    'allow-outbound-script-debugging': 'true', 'allow-inbound-script-debugging': 'true',   // Mojang's minecraft-debugger (`debug`)
    // the lab's own debugger client (trace) is attached at level load, before the addon's first line runs
    'script-debugger-auto-attach': inst.debugPort && !process.env.LAB_NO_DEBUGGER ? 'connect' : 'disabled', 'script-debugger-auto-attach-connect-address': `${RT.serverHost}:${inst.debugPort ?? 19144}`, 'script-debugger-auto-attach-timeout': inst.debugPort ? '5' : '0',
  });
  const la = F.launch ? await F.launch(L(), inst) : { cmd: inst.exe, args: [], env: { LD_LIBRARY_PATH: '.' } };
  const env = { ...la.env };
  const shim = F.ipv6Shim === false ? null : ipv6Shim();
  const pre = RT.kind === 'native' ? process.env.LD_PRELOAD : undefined;
  // NetherNet: no fake IPv6 sockets (BDS falls back to IPv4 by itself; faking would hide that), only the empty IPv6 /proc tables
  // (a Windows server under Wine needs them to see any network interface at all)
  if (shim) { env.LD_PRELOAD = pre ? `${shim}:${pre}` : shim; if (SRV_TRANSPORT === 'nethernet') env.LAB_SHIM_NOSOCK = '1'; }
  // LAB_SPEED=k: the same unmodified BDS on a clock that runs k times as fast (libfaketime: clock_gettime, sleeps and timed waits
  // scaled), so its 20 ticks a second come k times as often; the lab's clients tick at 50/k ms to match (realplayer LAB_TICK_MS)
  const ft = speedLib();
  // (speed-shim first: the network's clock stays real, see speedShim)
  if (ft) { const net = speedShim(), pre2 = net ? `${net}:${ft}` : ft; env.LD_PRELOAD = env.LD_PRELOAD ? `${env.LD_PRELOAD}:${pre2}` : pre2; env.FAKETIME = `+0 x${SPEED}`; env.FAKETIME_DONT_FAKE_MONOTONIC = '0'; env.FAKETIME_NO_CACHE = '1'; }
  // own process group (POSIX) or own container: the Endstone launcher and Wine start children of their own; a kill takes them all
  const child = RT.start(la.cmd, la.args ?? [], { cwd: inst.dir, env, ports: [port, port + 1, ...(SRV_TRANSPORT === 'nethernet' ? [`${port}/tcp`, ...Array.from({ length: 8 }, (_, i) => NN_WINDOW(port)[0] + i)] : [])], tag: inst.name });
  KIDS.add(child); child.on('exit', () => KIDS.delete(child));
  srvPort = port;
  const srv = { waiters: [], exited: false };
  let buf = '';
  const feed = (d) => {
    buf += d;
    for (let n; (n = buf.indexOf('\n')) >= 0;) {
      let line = normLine(buf.slice(0, n).replace(/\r$/, ''));
      if (F.lineHook) line = F.lineHook(L(), line) ?? line;   // the flavor's own rewrite (Endstone: raw packets -> decoded)
      buf = buf.slice(n + 1);
      // the server's tick (helper.js, every 10 ticks): the clock the lab's clients pace themselves by, not a log line
      const st = /LAB_T (\d+)\s*$/.exec(line);
      if (st) { serverClock(Number(st[1])); continue; }
      // a console command's end marker (exec): wakes its waiter, never shown
      if (/LAB_SYNC \d+\s*$/.test(line)) { for (const w of [...srv.waiters]) if (w.re.test(line)) { srv.waiters.splice(srv.waiters.indexOf(w), 1); w.res(line); } continue; }
      const act = /^(\[[^\]]*\] )(?:\[Scripting\] )?lab:action (\{.*\})$/.exec(line);
      if (act) { const t = addonAction(act[2], srv); line = (t.startsWith('ERROR ') ? act[1].replace(/\w+\] $/, 'ERROR] ') + '[Scripting] ' + t.slice(6) : act[1] + '[Scripting] ' + t); }
      const pc = /Player (connected|disconnected): (.+?), xuid/.exec(line);
      if (pc) ONLINE[pc[1] === 'connected' ? 'add' : 'delete'](pc[2]);
      const sp = /Player Spawned: (.+?) xuid/.exec(line);
      if (sp && globalThis.__labOnSpawn) setTimeout(() => globalThis.__labOnSpawn(sp[1]), 1500);   // (serve: a person who joined)
      LOG.push(line);
      // a native crash prints a dump header ("CrashReporter Key: ..."), then the process may hang: fail loudly, stop waiting
      if ((F.crashRe ?? /^CrashReporter Key:/).test(lineText(line)) && !srv.exited) {
        LOG.push('[0-0-0 0:0:0 ERROR] BDS crashed (native crash: the command or script call just before this line triggered it; nothing after it ran)');
        srv.exited = srv.crashed = true; for (const w of srv.waiters.splice(0)) w.res(null);
        setTimeout(() => killTree(child), 2000);
      }
      for (const w of [...srv.waiters]) if (w.re.test(line)) { srv.waiters.splice(srv.waiters.indexOf(w), 1); w.res(line); }
    }
  };
  child.stdout.setEncoding('utf8').on('data', feed);
  child.stderr.setEncoding('utf8').on('data', feed);
  child.on('error', (e) => LOG.push('[0-0-0 0:0:0 ERROR] cannot start the server: ' + e.message + (RT.kind === 'docker' ? ` (${RT.docker})` : '')));
  child.on('exit', () => {
    // a platform that writes its own crash report (LeviLamina: symbolized native stack): its lines right after the crash
    if (srv.crashed && F.crashReport) try { for (const l of F.crashReport(L(), inst) ?? []) LOG.push('[0-0-0 0:0:0 ERROR] ' + l); } catch { /* optional */ }
    srv.exited = true; for (const w of srv.waiters.splice(0)) w.res(null);
  });
  srv.wait = (re, ms) => new Promise((res) => {
    if (srv.exited) return res(null);
    const w = { re, res };
    srv.waiters.push(w);
    setTimeout(() => { const k = srv.waiters.indexOf(w); if (k >= 0) { srv.waiters.splice(k, 1); res(null); } }, ms);
  });
  // (a server that died a moment ago, its exit not seen yet: a write to its stdin fails with EPIPE — the crash is what gets
  // reported, not a lab that fell over on the write)
  child.stdin.on('error', () => {});
  srv.send = (cmd) => { if (!srv.exited && child.stdin.writable) child.stdin.write(cmd + '\n'); };
  srv.stop = async () => {
    srv.send(F.stopCommand ?? 'stop');
    if (!srv.exited) await Promise.race([new Promise((r) => child.once('exit', r)), sleep(F.stopWaitMs ?? 15000)]);
    if (!srv.exited) killTree(child);
    else if (child.labContainer) killTree(child);   // the container is gone with it; make sure
    else if (!WIN) try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
  };
  return srv;
}

const KIDS = new Set();
const killTree = (c) => { if (c.labKill) return c.labKill(); try { if (!WIN && c.pid) process.kill(-c.pid, 'SIGKILL'); else c.kill('SIGKILL'); } catch { try { c.kill('SIGKILL'); } catch { /* gone */ } } };
process.on('exit', () => { for (const c of KIDS) killTree(c); });
// server log lines -> one shape the renderer knows: "[t LEVEL] text", with "[Scripting] " for script output and the unit's own logger.
//   BDS        [2026-09-24 12:00:00:123 INFO] [Scripting] x
//   Endstone   [2026-09-24 12:00:00.123 INFO] [my_plugin] x   (0.11.12+: "INFO] : [my_plugin] x")
//   LeviLamina 12:00:00.123 INFO [MyMod] x
const LEVELS = { WARNING: 'WARN', FATAL: 'ERROR', CRITICAL: 'ERROR', TRACE: 'DEBUG', VERBOSE: 'DEBUG', IFO: 'INFO', WRN: 'WARN', ERR: 'ERROR', DBG: 'DEBUG', FTL: 'ERROR', TRC: 'DEBUG' };   // LeviLamina writes IFO WRN ERR
function normLine(raw) {
  raw = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');   // colored consoles (LeviLamina colorLog, Endstone): plain text
  const m = /^\[?(?:\d{4}-\d\d-\d\d[ T])?\d{1,2}:\d\d:\d\d(?:[:.,]\d+)?\s+([A-Za-z]+)\]?\s?(.*)$/.exec(raw);
  if (!m) return raw;
  const level = LEVELS[m[1].toUpperCase()] ?? m[1].toUpperCase();
  if (!/^(INFO|WARN|ERROR|DEBUG)$/.test(level)) return raw;
  let text = m[2].replace(/^: /, ''), script = false;   // Endstone 0.11.12+: "[t INFO] : text"
  const lg = /^\[([^\]]{1,64})\] ?(.*)$/.exec(text);
  if (lg) {
    const k = lg[1] === 'Scripting' ? 'script' : F.loggerKind?.(lg[1], L()) ?? 'keep';   // keep: "[LeviLamina] ..." stays readable
    if (k === 'script') { script = true; text = lg[2]; } else if (k === 'server') text = lg[2];
  }
  return `[0-0-0 0:0:0 ${level}] ${script ? '[Scripting] ' : ''}${text}`;
}

// an addon talks to the lab through console.warn('lab:action {...}') (addons/*/bp/scripts/lab.js)
function addonAction(json, srv) {
  let a; try { a = JSON.parse(json); } catch { return 'lab:action (unreadable)'; }
  switch (a.op) {
    case 'note': return 'NOTE ' + a.text;
    case 'metric': return `METRIC ${a.key}=${JSON.stringify(a.value)}`;
    case 'fail': return 'ERROR addon fail: ' + a.reason;   // rendered as E: fails the test unless a line expects it
    case 'command': srv.send(a.command); return 'CMD ' + a.command;
    case 'save': {
      const f = path.join(LAB, 'from-addon', path.basename(String(a.name)));
      try { fs.mkdirSync(path.dirname(f), { recursive: true }); if (a.append) { fs.appendFileSync(f, String(a.text)); return 'LAB_PART'; } fs.writeFileSync(f, String(a.text)); return a.text === '' ? 'LAB_PART' : 'SAVED ' + rel(f); } catch (e) { return 'ERROR lab.save: ' + e.message; }
    }
    default: return `NOTE lab.${a.op} is not available here`;
  }
}

async function ensureTemplate() {
  if (exists(path.join(TEMPLATE, 'level.dat'))) return;
  const inst = await claim('tpl');
  const w = path.join(inst.dir, 'worlds', 'lab');
  fs.rmSync(w, { recursive: true, force: true });
  const srv = await boot(inst);
  if (!(await srv.wait(/Server started(\.| in \()/, 120000))) { await srv.stop(); die('BDS did not start:\n' + LOG.slice(-15).join('\n')); }
  for (const c of WORLD_SETUP) { srv.send(c); await srv.wait(/.*/, 5000); }
  await sleep(500);
  await srv.stop();
  enableBeta(path.join(w, 'level.dat'));
  fs.rmSync(TEMPLATE, { recursive: true, force: true });
  fs.cpSync(w, TEMPLATE, { recursive: true });
  inst.release();
  LOG.length = 0;
}

// shared, one process at a time: BDS download, template world, API types
async function setup() {
  if (exists(path.join(TEMPLATE, 'level.dat')) && exists(EXE) && exists(path.join(CACHE, 'beta.json')) && !F.needsSetup?.(L())) return;
  const release = await lock();
  try { await ensureBds(); await ensureTemplate(); await ensureTypes(); await F.setup?.(L()); } finally { release(); }
}
async function setupAll() { await setup(); await realDeps({ loud: true }); ipv6Shim(); }

// ---------- project checks (no BDS needed) ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function packsOf() {
  const list = [];
  for (const [dir, kind] of [[BP, 'bp'], [RP, 'rp']]) if (exists(path.join(dir, 'manifest.json'))) list.push({ dir, kind });
  return list;
}

function lint() {
  const errs = [], warns = [];
  if (!exists(path.join(BP, 'manifest.json'))) return { errs: ['bp/manifest.json missing'], warns };
  const uuids = new Map();
  const packs = [];
  for (const p of packsOf()) {
    for (const f of files(p.dir, (x) => x.endsWith('.json'))) {
      try { readJson(f); } catch (e) { errs.push(`${rel(f)}: ${e.message}`); }
    }
    let m;
    try { m = readJson(path.join(p.dir, 'manifest.json')); } catch { continue; }
    p.m = m;
    packs.push(p);
    const h = m.header ?? {};
    if (!UUID.test(h.uuid ?? '')) errs.push(`${p.kind}/manifest.json: header.uuid invalid`);
    if (!Array.isArray(h.version) && !(m.format_version === 3 && /^\d+\.\d+\.\d+/.test(h.version))) errs.push(`${p.kind}/manifest.json: header.version must be [x,y,z] (format_version 3: "x.y.z")`);
    for (const id of [h.uuid, ...(m.modules ?? []).map((x) => x.uuid)]) {
      if (!id) continue;
      if (uuids.has(id)) errs.push(`${p.kind}/manifest.json: duplicate uuid ${id}`);
      uuids.set(id, p.kind);
    }
    for (const mod of m.modules ?? []) {
      if (!UUID.test(mod.uuid ?? '')) errs.push(`${p.kind}/manifest.json: module uuid invalid`);
      if (mod.type === 'script' && !exists(path.join(p.dir, mod.entry ?? ''))) errs.push(`${p.kind}/manifest.json: entry ${mod.entry} not found`);
    }
  }
  for (const f of files(path.join(BP, 'scripts'), (x) => /\.[cm]?js$/.test(x))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      if (!exists(path.resolve(path.dirname(f), m[1]))) errs.push(`${rel(f)}: import ${m[1]} not found (paths need .js)`);
    }
  }
  // calls that crash BDS itself (a native crash, no script error to read), measured on 1.26.51
  const CRASH = [[/getItem\([^()]*\)\s*\??\.\s*getComponent\(\s*(['"](minecraft:)?inventory['"]|ItemInventoryComponent\.componentId)\s*\)\s*\??\.\s*container/,
    "getItem(i).getComponent('minecraft:inventory').container in one chain crashes BDS: keep the ItemStack in a variable (const s = c.getItem(i); s.getComponent(...).container)"]];
  const srcDir = exists(path.join(ADDON, 'src')) ? path.join(ADDON, 'src') : path.join(BP, 'scripts');
  for (const f of files(srcDir, (x) => /\.[cm]?[jt]s$/.test(x) && !x.endsWith('.d.ts'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { for (const [re, msg] of CRASH) if (re.test(l)) warns.push(`${rel(f)}:${i + 1} ${msg}`); });
  }
  if (!errs.length) lintContent(warns);
  return { errs, warns };
}
// every pack JSON against Mojang's bedrock-schemas, calibrated on vanilla (schema.mjs): E = certain, W = likely (typo keys, ranges)
async function lintSchema(errs, warns) {
  if (process.env.LAB_SCHEMA === 'off') return;
  try {
    const S = await import('./schema.mjs'), root = S.schemaRoot(CACHE);
    if (!root) { warns.push(`schema check skipped: @minecraft/bedrock-schemas@${S.calibration()?.version} could not be installed (offline?)`); return; }
    const r = S.checkPacks(root, packsOf().map((p) => ({ ...p, label: rel(p.dir) })));
    errs.push(...r.errs); warns.push(...r.warns);
  } catch (e) { warns.push(`schema check skipped: ${String(e.message).split('\n')[0]}`); }
}
// entity/attachable geometry: collapsed cubes, z-fighting faces, UVs off the texture, unequal plate faces, duplicates (lib/model.mjs)
async function lintModels(warns) {
  const fl = files(path.join(RP, 'models'), (f) => f.endsWith('.json'));
  if (!fl.length) return;
  const M = await import('./model.mjs');
  for (const f of fl) {
    let geos; try { geos = M.loadGeos(f); } catch { continue; }
    for (const g of geos) { const r = M.lintGeo(g); r.errs.slice(0, 6).forEach((e) => warns.push(`${rel(f)} ${g.id}: ${e}`)); if (r.errs.length > 6) warns.push(`${rel(f)} ${g.id}: ... +${r.errs.length - 6} (node lab.mjs render ${g.id})`); }
  }
}

// the vanilla item atlas names (book_normal, apple ...): an icon may name one of them (Mojang's bedrock-samples, cached)
let VAN_ICONS = null;
function vanillaItemIcons() {
  if (VAN_ICONS) return VAN_ICONS;
  VAN_ICONS = new Set();
  try { const idx = rpSamples(); const e = idx?.get('rp/textures/item_texture.json'); if (e) VAN_ICONS = new Set(Object.keys(JSON.parse(e.read().replace(/^\uFEFF/, '').replace(/^\s*\/\/.*$/gm, '')).texture_data ?? {})); } catch { /* offline: only this pack's names */ }
  return VAN_ICONS;
}
// components Mojang renamed (an old addon's name is ignored without a word): what to write instead
const RENAMED = { 'minecraft:foil': 'minecraft:glint', 'minecraft:creative_category': 'menu_category (in description)', 'minecraft:render_offsets': 'minecraft:icon / attachables', 'minecraft:frame_count': 'minecraft:use_modifiers', 'minecraft:use_duration': 'minecraft:use_modifiers', 'minecraft:unbreakable': 'minecraft:durability' };
// what makes custom content look broken in game: missing textures, names, client entities
function lintContent(warns) {
  const safe = (f) => { try { return readJson(f); } catch { return null; } };
  const defs = (dir, key) => files(path.join(BP, dir), (f) => f.endsWith('.json')).map((f) => ({ f, d: safe(f)?.[key] })).filter((x) => x.d?.description?.identifier);
  const items = defs('items', 'minecraft:item'), blocks = defs('blocks', 'minecraft:block'), ents = defs('entities', 'minecraft:entity');
  if (!items.length && !blocks.length && !ents.length) return;
  // unknown component names do nothing in game (BDS ignores them without a word): check against Mojang's component list
  if (COMPONENTS) for (const [list, kind] of [[items, 'item'], [blocks, 'block'], [ents, 'entity']]) {
    for (const { f, d } of list) {
      const groups = [d.components ?? {}, ...Object.values(d.component_groups ?? {})];
      for (const g of groups) for (const k of Object.keys(g ?? {})) {
        if (!k.startsWith('minecraft:') || COMPONENTS[kind].has(k)) continue;
        const renamed = RENAMED[k], near = renamed && COMPONENTS[kind].has(renamed) ? null : X_nearest(k, COMPONENTS[kind]);
        warns.push(`${rel(f)}: ${k} is not ${kind === 'item' ? 'an' : 'a'} ${kind} component (ignored in game)${renamed ? `: renamed ${renamed}` : near ? `: did you mean ${near}?` : ''}`);
      }
    }
  }
  if (!exists(path.join(RP, 'manifest.json'))) { warns.push('custom items/blocks/entities need rp/ for textures and names: node lab.mjs init <name> --rp'); return; }
  const texKeys = (file) => {
    const j = safe(path.join(RP, 'textures', file));
    const data = j?.texture_data ?? {};
    for (const [k, v] of Object.entries(data)) {
      const t = typeof v === 'string' ? v : v?.textures;
      for (const x of [t].flat().map((y) => (typeof y === 'string' ? y : y?.path)).filter(Boolean)) {
        if (!['.png', '.tga'].some((e) => exists(path.join(RP, x + e)) || exists(path.join(RP, x)))) warns.push(`rp/textures/${file}: ${k} -> ${x}.png missing`);
      }
    }
    return new Set(Object.keys(data));
  };
  const itemTex = texKeys('item_texture.json'), terrainTex = texKeys('terrain_texture.json');
  const lang = new Set();
  for (const f of files(path.join(RP, 'texts'), (x) => x.endsWith('.lang'))) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const k = l.split('=')[0].trim(); if (k && !k.startsWith('#')) lang.add(k); }
  const clientIds = new Set(files(path.join(RP, 'entity'), (f) => f.endsWith('.json')).map((f) => safe(f)?.['minecraft:client_entity']?.description?.identifier).filter(Boolean));
  const named = (c, key) => c?.['minecraft:display_name'] || lang.has(key);
  for (const { f, d } of items) {
    const id = d.description.identifier, c = d.components ?? {}, ic = c['minecraft:icon'];
    const icon = typeof ic === 'string' ? ic : ic?.texture ?? ic?.textures?.default;
    if (!icon) warns.push(`${rel(f)}: ${id} has no minecraft:icon`);
    else if (!itemTex.has(icon) && !vanillaItemIcons().has(icon)) warns.push(`${rel(f)}: icon "${icon}" not in rp/textures/item_texture.json${vanillaItemIcons().size ? ' nor vanilla\'s' : ''}`);
    if (!named(c, `item.${id}.name`) && !named(c, `item.${id}`)) warns.push(`${rel(f)}: ${id} has no name (display_name or rp/texts/en_US.lang item.${id}.name=)`);
  }
  for (const { f, d } of blocks) {
    const id = d.description.identifier, c = d.components ?? {};
    for (const [face, m] of Object.entries(c['minecraft:material_instances'] ?? {})) if (m?.texture && !terrainTex.has(m.texture)) warns.push(`${rel(f)}: ${face} texture "${m.texture}" not in rp/textures/terrain_texture.json`);
    if (!named(c, `tile.${id}.name`)) warns.push(`${rel(f)}: ${id} has no name (rp/texts/en_US.lang tile.${id}.name=)`);
  }
  for (const { f, d } of ents) {
    const id = d.description.identifier;
    if (!clientIds.has(id)) warns.push(`${rel(f)}: ${id} has no rp/entity client definition (invisible in game)`);
    if (!lang.has(`entity.${id}.name`)) warns.push(`${rel(f)}: no rp/texts/en_US.lang entity.${id}.name=`);
  }
}

// scaffold custom content with every file the game needs (bp definition, rp texture entry, name, placeholder texture)
async function add(args) {
  const [kind, id, ...more] = args;
  const opt = (k) => { const i = more.findIndex((x) => x.startsWith(k + '=')); return i < 0 ? undefined : more.splice(i, 1)[0].slice(k.length + 1); };
  const ja = opt('ja'), texSpec = opt('tex'), statesSpec = opt('states'), dropsSpec = opt('drops');
  const sets = more.filter((x) => /^[\w.:]+=/.test(x)), nameParts = more.filter((x) => !sets.includes(x));
  const comps = {};
  for (const x of sets) {
    const i = x.indexOf('='), k = x.slice(0, i), v = x.slice(i + 1); let val; try { val = JSON.parse(v); } catch { val = v; if (/[{}[\]"]/.test(v) || !/^(icon|display_name|.*texture.*|.*_id)$/.test(k.replace(/^minecraft:/, ''))) out(`W ${k}=${v} is not JSON: written as the string "${v}" (an object needs quotes: ${k}='{"value":6}')`); }
    // component='{"minecraft:max_stack_size":16}' / components={...}: a whole object of components
    if (/^components?$/.test(k) && val && typeof val === 'object' && !Array.isArray(val)) { for (const [a, b] of Object.entries(val)) comps[a.includes(':') ? a : 'minecraft:' + a] = b; continue; }
    comps[k.includes(':') ? k : 'minecraft:' + k] = val;
  }
  if (!['item', 'block', 'entity'].includes(kind) || !/^[a-z0-9_]+:[a-z0-9_]+$/.test(id ?? '')) die(`usage: node lab.mjs add item|block|entity <ns:id> ["Name"] [ja=名前] [tex=<shape>[:RRGGBB]] [component=json ...]  shapes: ${PIX.SHAPES.join(' ')}`);
  // a bad texture is found before anything is written (it used to stop half-way: the definition and names written, no texture)
  if (texSpec) try { PIX.pixel(texSpec); } catch (e) { die(`${e.message} (tex=<shape>[:RRGGBB]; nothing written)`); }
  const [ns, short] = id.split(':');
  const name = nameParts.join(' ') || short.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const key = `${ns}_${short}`;
  if (!exists(path.join(RP, 'manifest.json'))) { const m = readJson(path.join(BP, 'manifest.json')); init(m.header.uuid === TEMPLATE_UUID ? (m.header.name === 'addon' ? 'myaddon' : m.header.name) : m.header.name, true); }
  const wrote = [], notes = [];
  const put = (f, v) => { if (exists(f)) return; typeof v === 'string' ? (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, v)) : writeJson(f, v); wrote.push(rel(f)); };
  const merge = (f, base, fn) => { const j = exists(f) ? readJson(f) : base; fn(j); writeJson(f, j); if (!wrote.includes(rel(f))) wrote.push(rel(f)); };
  // every language the pack lists gets the name (ja_JP: ja=<name>, else the English one)
  const lang = (k, v, vja = ja) => {
    put(path.join(RP, 'texts', 'languages.json'), ['en_US']);
    let langs = ['en_US']; try { langs = readJson(path.join(RP, 'texts', 'languages.json')); } catch { /* default */ }
    // ja=… on a pack without ja_JP (an imported one): add it, starting from the en_US names, instead of dropping the name
    if (vja && Array.isArray(langs) && !langs.includes('ja_JP')) {
      langs = [...langs, 'ja_JP']; writeJson(path.join(RP, 'texts', 'languages.json'), langs);
      const en = path.join(RP, 'texts', 'en_US.lang'), jf = path.join(RP, 'texts', 'ja_JP.lang');
      if (!exists(jf)) { fs.writeFileSync(jf, exists(en) ? fs.readFileSync(en, 'utf8') : ''); notes.push('ja_JP added to rp/texts (its other names copied from en_US: translate them)'); }
    }
    for (const l of langs) {
      const f = path.join(RP, 'texts', l + '.lang');
      const lines = exists(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((x) => x && !x.startsWith(k + '=')) : [];
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, [...lines, `${k}=${l === 'ja_JP' && vja ? vja : v}`].join('\n') + '\n');
      if (!wrote.includes(rel(f))) wrote.push(rel(f));
    }
  };
  const tex = (file, w, h, dflt) => {
    const f = path.join(RP, file);
    if (texSpec || dflt) { const p = PIX.pixel(texSpec ?? dflt); png([f, p.pal, ...p.rows], true); wrote.push(rel(f) + ` (${texSpec ?? dflt})`); }
    else if (!exists(f)) { png([f, 'a=7f7f7f b=bfbfbf', ...Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => ((x ^ y) & 2 ? 'a' : 'b')).join(''))], true); wrote.push(rel(f) + ' (placeholder: tex=<shape:RRGGBB> or png)'); }
  };
  if (kind === 'item') {
    put(path.join(BP, 'items', short + '.json'), { format_version: '1.21.90', 'minecraft:item': { description: { identifier: id, menu_category: { category: 'items' } }, components: { 'minecraft:icon': key, 'minecraft:max_stack_size': 64, ...comps } } });
    merge(path.join(RP, 'textures', 'item_texture.json'), { resource_pack_name: ns, texture_name: 'atlas.items', texture_data: {} }, (j) => { j.texture_data[key] = { textures: `textures/items/${short}` }; });
    lang(`item.${id}.name`, name);
    tex(`textures/items/${short}.png`, 16, 16, 'gem');
  } else if (kind === 'block') {
    put(path.join(BP, 'blocks', short + '.json'), { format_version: '1.21.90', 'minecraft:block': { description: { identifier: id, menu_category: { category: 'construction' } }, components: { 'minecraft:geometry': 'minecraft:geometry.full_block', 'minecraft:material_instances': { '*': { texture: key, render_method: 'opaque' } }, 'minecraft:destructible_by_mining': { seconds_to_destroy: 1 }, ...comps } } });
    merge(path.join(RP, 'textures', 'terrain_texture.json'), { resource_pack_name: ns, texture_name: 'atlas.terrain', padding: 8, num_mip_levels: 4, texture_data: {} }, (j) => { j.texture_data[key] = { textures: `textures/blocks/${short}` }; });
    lang(`tile.${id}.name`, name);
    tex(`textures/blocks/${short}.png`, 16, 16, 'block');
  } else {
    put(path.join(BP, 'entities', short + '.json'), { format_version: '1.21.40', 'minecraft:entity': { description: { identifier: id, is_spawnable: true, is_summonable: true }, components: {
      'minecraft:type_family': { family: [short, 'mob'] }, 'minecraft:health': { value: 10, max: 10 }, 'minecraft:physics': {}, 'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
      'minecraft:collision_box': { width: 0.8, height: 0.8 }, 'minecraft:movement': { value: 0.25 }, 'minecraft:movement.basic': {}, 'minecraft:jump.static': {}, 'minecraft:navigation.walk': { can_walk: true, avoid_water: true },
      'minecraft:behavior.random_stroll': { priority: 6, speed_multiplier: 1 }, 'minecraft:behavior.look_at_player': { priority: 7, look_distance: 6 }, 'minecraft:behavior.random_look_around': { priority: 8 }, ...comps } } });
    put(path.join(RP, 'entity', short + '.entity.json'), { format_version: '1.10.0', 'minecraft:client_entity': { description: { identifier: id, materials: { default: 'entity_alphatest' }, textures: { default: `textures/entity/${short}` }, geometry: { default: `geometry.${key}` }, render_controllers: ['controller.render.default'], spawn_egg: { base_color: '#7f7f7f', overlay_color: '#bfbfbf' } } } });
    put(path.join(RP, 'models', 'entity', short + '.geo.json'), { format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: `geometry.${key}`, texture_width: 32, texture_height: 16, visible_bounds_width: 2, visible_bounds_height: 2, visible_bounds_offset: [0, 0.5, 0] }, bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }] }] }] });
    lang(`entity.${id}.name`, name);
    lang(`item.spawn_egg.entity.${id}.name`, `Spawn ${name}`, ja && `${ja}のスポーンエッグ`);
    { const f = path.join(RP, `textures/entity/${short}.png`); if (texSpec || !exists(f)) { const p = PIX.boxSkin(texSpec ?? ''); png([f, p.pal, ...p.rows], true); wrote.push(rel(f) + ` (box skin${texSpec ? ' ' + texSpec : ''})`); } }
  }
  // states='{"ns:lit":[false,true]}' (blocks): description.states; drops=ns:item*1-2,minecraft:bone*0-1: a loot table + minecraft:loot
  const defFile = path.join(BP, kind === 'item' ? 'items' : kind === 'block' ? 'blocks' : 'entities', short + '.json'), defKey = `minecraft:${kind}`;
  // run again on a definition that exists (one of theirs too): the components given are merged into it (it used to say "set" and
  // leave the file as it was); a new texture becomes its icon / material
  if (exists(defFile) && !wrote.includes(rel(defFile)) && (Object.keys(comps).length || texSpec)) {
    const j = readJson(defFile), c = (j[defKey] ??= {}).components ??= {};
    Object.assign(c, comps);
    if (texSpec && kind === 'item') { if (c['minecraft:icon'] !== key && !comps['minecraft:icon']) { c['minecraft:icon'] = key; notes.push(`minecraft:icon → "${key}" (the texture just made)`); } }
    if (texSpec && kind === 'block') { const m = c['minecraft:material_instances']?.['*']; if (m && m.texture !== key) { m.texture = key; notes.push(`material_instances * texture → "${key}"`); } }
    if (kind === 'item' && typeof c['minecraft:icon'] === 'string' && j.format_version && String(j.format_version).split('.').map(Number).reduce((r, v, i) => r || v - [1, 20, 20][i] || 0, 0) < 0) { j.format_version = '1.21.90'; notes.push('format_version → 1.21.90 (an icon as a plain name needs 1.20.20 or later)'); }
    writeJson(defFile, j); wrote.push(rel(defFile));
  }
  if (statesSpec && kind === 'block') { const j = readJson(defFile); try { j[defKey].description.states = { ...(j[defKey].description.states ?? {}), ...JSON.parse(statesSpec) }; } catch (e) { die(`states=: ${e.message} (e.g. states='{"${ns}:lit":[false,true]}')`); } writeJson(defFile, j); }
  if (dropsSpec && kind !== 'item') {
    const entries = dropsSpec.split(',').map((d) => { const m = /^([a-z0-9_]+:[a-z0-9_]+|[a-z0-9_]+)(?:\*(\d+)(?:-(\d+))?)?$/.exec(d.trim()); if (!m) die(`drops=${d}: <item>[*n|*min-max], e.g. drops=${ns}:gel*1-2`); const id = m[1].includes(':') ? m[1] : 'minecraft:' + m[1], lo = Number(m[2] ?? 1), hi = Number(m[3] ?? lo); return { id, lo, hi }; });
    const table = `loot_tables/${kind === 'block' ? 'blocks' : 'entities'}/${short}.json`;
    writeJson(path.join(BP, table), { pools: entries.map((e) => ({ rolls: 1, entries: [{ type: 'item', name: e.id, weight: 1, ...(e.lo !== 1 || e.hi !== 1 ? { functions: [{ function: 'set_count', count: e.lo === e.hi ? e.lo : { min: e.lo, max: e.hi } }] } : {}) }] })) });
    const j = readJson(defFile); j[defKey].components['minecraft:loot'] = { table }; writeJson(defFile, j);
    wrote.push(rel(path.join(BP, table)));
  }
  let addErr = false;
  // the rules that keep a definition from loading on BDS (max_stack_size 1..64, ...): said now, not first at go
  try { const S2 = await import('./schema.mjs'); const id2 = `bp/${kind === 'item' ? 'items' : kind === 'block' ? 'blocks' : 'entities'}/index`; for (const e of S2.bdsRules(id2, readJson(defFile))) { out(`E ${rel(defFile)} ${e.at}: ${e.msg}`); addErr = true; } } catch { /* no rules */ }
  // a component name the game does not know is silently ignored in game: say so now
  try { const x = await import('./extra.mjs'); const cs = x.componentSets(CACHE); for (const k of Object.keys(comps)) if (k.startsWith('minecraft:') && cs?.[kind] && !cs[kind].has(k)) { const n = x.nearest(k, cs[kind]); out(`W ${k} is not ${kind === 'item' ? 'an' : 'a'} ${kind} component (ignored in game)${n ? `: did you mean ${n}?` : ''}`); } } catch { /* component list not downloaded yet: check reports it later */ }
  out(`OK ${kind} ${id}: ${wrote.map((w) => path.relative(ADDON, path.resolve(ROOT, w.split(' ')[0])).split(path.sep).join('/') + (w.includes(' ') ? w.slice(w.indexOf(' ')) : '')).join(' ')}${Object.keys(comps).length ? ' | set ' + Object.keys(comps).map((k) => k.replace(/^minecraft:/, '')).join(' ') : ''}${notes.length ? ' | ' + notes.join(' | ') : ''}`);
  return !addErr;
}

// text pixel art -> RGBA PNG. palette "r=e0115f d=8b0000", '.' = transparent, one string per row
function png(args, quiet = false) {
  if (args.length === 2 && PIX.SHAPES.includes(String(args[1]).split(':')[0])) { const p = PIX.pixel(args[1]); args = [args[0], p.pal, ...p.rows]; }   // png <file> gem:e0115f
  const [file, pal, ...rows] = args;
  if (!file || !pal || !rows.length) die('usage: node lab.mjs png <out.png> "<c=RRGGBB[AA] ...>" <row> <row> ...');
  const colors = { '.': [0, 0, 0, 0] };
  for (const t of pal.split(/\s+/).filter(Boolean)) {
    const m = /^(.)=#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t);
    if (!m) die(`bad palette entry "${t}"`);
    colors[m[1]] = m[2].match(/../g).map((h) => parseInt(h, 16)).concat(m[2].length === 6 ? [255] : []);
  }
  const w = rows[0].length, h = rows.length;
  if (rows.some((r) => r.length !== w)) die('all rows must have the same length');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const c = colors[ch];
    if (!c) die(`row ${y + 1}: "${ch}" not in palette`);
    Buffer.from(c).copy(raw, y * (w * 4 + 1) + 1 + x * 4);
  }));
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  // rp/... is relative to the addon; a path written from the lab folder (addons/<name>/rp/...) works too
  const outFile = ADDON && path.resolve(ROOT, file).startsWith(ADDON + path.sep) ? path.resolve(ROOT, file) : path.resolve(ADDON ?? ROOT, file);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  if (!quiet) out(`OK ${rel(outFile)} ${w}x${h}`);
}

function init(name, withRp) {
  if (!name || !/^[\w -]+$/.test(name)) die('usage: node lab.mjs init <name> [--rp]');
  const mf = path.join(BP, 'manifest.json');
  const m = readJson(mf);
  const ver = m.header.version ?? [1, 0, 0];
  m.header = { ...m.header, name, description: m.header.description ?? name, uuid: randomUUID() };
  for (const mod of m.modules ?? []) mod.uuid = randomUUID();
  if (withRp || exists(path.join(RP, 'manifest.json'))) {
    const rf = path.join(RP, 'manifest.json');
    const r = exists(rf) ? readJson(rf) : { format_version: 2, header: {}, modules: [{ type: 'resources', version: ver }] };
    r.header = { ...r.header, name: name + ' RP', description: name, uuid: randomUUID(), version: r.header.version ?? ver, min_engine_version: r.header.min_engine_version ?? m.header.min_engine_version ?? [1, 21, 0] };
    for (const mod of r.modules) mod.uuid = randomUUID();
    writeJson(rf, r);
    m.dependencies = (m.dependencies ?? []).filter((d) => !d.uuid).concat({ uuid: r.header.uuid, version: r.header.version });
  }
  writeJson(mf, m);
  out(`OK ${name}: new uuids${withRp || exists(path.join(RP, 'manifest.json')) ? ', rp linked' : ''}`);
}

async function pack(args = []) {
  if (!(await preflight())) return false;
  let m = readJson(path.join(BP, 'manifest.json'));
  if (m.header.uuid === TEMPLATE_UUID) { init(m.header.name === 'addon' ? 'myaddon' : m.header.name); m = readJson(path.join(BP, 'manifest.json')); }
  // a person's addon (import): their worlds and players' clients take the new packs only under a new version (same UUID): the
  // first pack after import goes one patch past the version it came with
  const imp = (() => { try { return readJson(path.join(ADDON, 'imported.json')); } catch { return null; } })();
  const vs = (v) => (Array.isArray(v) ? v.join('.') : String(v));
  const autoBump = imp && vs(m.header.version) === vs(imp.bp) && !args.includes('--bump');
  if (autoBump) args = [...args, '--bump'];
  if (args.includes('--bump')) {
    // format_version 3 manifests use "x.y.z" strings
    const bump = (v) => (typeof v === 'string' ? v.replace(/(\d+)(?!.*\d)/, (d) => String(+d + 1)) : [v[0], v[1], v[2] + 1]);
    const rf = path.join(RP, 'manifest.json');
    const r = exists(rf) ? readJson(rf) : null;
    m.header.version = bump(m.header.version);
    for (const x of m.modules ?? []) x.version = m.header.version;
    if (r) {
      r.header.version = bump(r.header.version);
      for (const x of r.modules ?? []) x.version = r.header.version;
      for (const d of m.dependencies ?? []) if (d.uuid === r.header.uuid) d.version = r.header.version;
      writeJson(rf, r);
    }
    writeJson(path.join(BP, 'manifest.json'), m);
    if (autoBump) out(`T version ${vs(imp.bp)} → ${vs(m.header.version)}${r ? ` (rp ${vs(imp.rp ?? '?')} → ${vs(r.header.version)})` : ''}: the same UUIDs, one version up, so the person's worlds and players take this as an update`);
  }
  // the file name from the pack's name; a name with no ASCII letters (好きな色投票 → "_") takes the unit's folder name instead
  const name = packFileName(m);
  // what players download: design/OS files left out, PNGs compressed again losslessly (optimize.mjs; the unit's files unchanged)
  const OPT = await import('./optimize.mjs'), entries = [];
  let junk = 0, saved = 0;
  for (const p of packsOf()) for (const f of files(p.dir, (x) => !path.basename(x).startsWith('.'))) {
    const r = path.relative(p.dir, f).split(path.sep).join('/');
    if (OPT.JUNK.test(r)) { junk++; continue; }
    let data = fs.readFileSync(f);
    if (/\.png$/i.test(r)) { const s = OPT.pngCached(data, path.join(CACHE, 'png')); if (s) { saved += data.length - s.length; data = s; } }
    entries.push({ name: `${name}_${p.kind.toUpperCase()}/${r}`, data });
  }
  const file = path.join(ROOT, 'dist', `${name}.mcaddon`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zip(entries));
  out(`OK ${rel(file)} (${entries.length} files${saved > 1024 ? `, PNG -${Math.round(saved / 1024)} KB` : ''}${junk ? `, ${junk} design/OS file(s) left out` : ''}, v${[m.header.version].flat().join('.')})`);
  return true;
}

// ---------- in-game helper pack: readiness, `js` eval, simulated players ----------
const EVAL_HELPER = fs.readFileSync(path.join(LIBDIR, 'helper.js'), 'utf8');   // injected into the addon copy as scripts/__lab.js
const READY_HELPER = `import{world as w,system as s}from"@minecraft/server";const i=s.runInterval(()=>{try{if(w.getDimension("overworld").getBlock({x:0,y:0,z:0})){s.clearRun(i);console.warn("LAB_READY")}}catch{}},1);`;

// the utility addons (common/data/samples.json "utility": TS REPL ...) go into every live server (`up`, the real app, lan):
// what a person or AI uses by hand. A test run stays the unit alone (its output, QA and perf are the unit's own);
// LAB_UTILITIES=all puts them in tests too, =off nowhere
function utilityPacks(live) {
  const mode = process.env.LAB_UTILITIES ?? 'live';
  if (mode === 'off' || (mode !== 'all' && !live)) return [];
  let names = []; try { names = readJson(path.join(path.dirname(ROOT), 'common', 'data', 'samples.json')).utility?.bds ?? []; } catch { return []; }
  const out = [];
  for (const n of names) {
    const d = path.join(path.dirname(ROOT), 'bds', 'addons', n);
    if (path.resolve(d) === path.resolve(ADDON)) continue;   // (the unit itself is already there)
    for (const kind of ['bp', 'rp']) if (exists(path.join(d, kind, 'manifest.json'))) out.push({ dir: path.join(d, kind), kind, name: n });
  }
  return out;
}
async function writePacks(world, settings = {}, live = false) {
  const beta = await betaVersions();
  const bp = path.join(world, 'behavior_packs'), rp = path.join(world, 'resource_packs');
  fs.rmSync(bp, { recursive: true, force: true });
  fs.rmSync(rp, { recursive: true, force: true });
  const h = path.join(bp, 'lab_ready');
  const host = !exists(path.join(BP, 'manifest.json'));   // no behavior pack (a plugin / mod only): `js` runs in the helper's own context
  writeJson(path.join(h, 'manifest.json'), {
    format_version: 2, header: { name: 'lab_ready', uuid: HELPER_UUID[0], version: [1, 0, 0], min_engine_version: [1, 21, 0] },
    modules: [{ type: 'script', language: 'javascript', uuid: HELPER_UUID[1], version: [1, 0, 0], entry: host ? 'scripts/e.js' : 'scripts/r.js' }],
    dependencies: host ? [{ module_name: '@minecraft/server', version: beta.server }, { module_name: '@minecraft/server-gametest', version: beta['server-gametest'] }] : [{ module_name: '@minecraft/server', version: '2.0.0' }],
    ...(host ? { capabilities: ['script_eval'] } : {}),
  });
  fs.mkdirSync(path.join(h, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(h, 'scripts', 'r.js'), READY_HELPER);
  if (host) { fs.writeFileSync(path.join(h, 'scripts', '__lab.js'), EVAL_HELPER); fs.writeFileSync(path.join(h, 'scripts', 'e.js'), 'import "./__lab.js";import "./r.js";'); }
  const bps = [{ pack_id: HELPER_UUID[0], version: [1, 0, 0] }], rps = [];
  for (const p of packsOf()) {
    const dest = path.join(p.kind === 'bp' ? bp : rp, p.kind);
    fs.cpSync(p.dir, dest, { recursive: true });
    const m = readJson(path.join(dest, 'manifest.json'));
    (p.kind === 'bp' ? bps : rps).push({ pack_id: m.header.uuid, version: typeof m.header.version === 'string' ? m.header.version.split(/[.-]/).slice(0, 3).map(Number) : m.header.version });
    if (p.kind !== 'bp') continue;
    // the eval helper must live in the addon's own script context (other packs see its players as undefined)
    m.modules ??= [];
    m.dependencies ??= [];
    let mod = m.modules.find((x) => x.type === 'script');
    if (!mod) {
      mod = { type: 'script', language: 'javascript', uuid: '6c0e1a52-8f4b-4c55-9d2e-0a1b2c3d4e53', version: [1, 0, 0] };
      m.modules.push(mod);
      m.dependencies.push({ module_name: '@minecraft/server', version: beta.server });
    }
    const entry = mod.entry ? './' + path.posix.relative('scripts', mod.entry) : null;
    fs.mkdirSync(path.join(dest, 'scripts'), { recursive: true });
    const ui = m.dependencies.some((d) => d.module_name === '@minecraft/server-ui');
    fs.writeFileSync(path.join(dest, 'scripts', '__lab.js'), ui ? 'import*as ui from"@minecraft/server-ui";' + EVAL_HELPER.replace('/*UI*/', 'globalThis.ui=ui;wrapForm(ui.ActionFormData,"action");wrapForm(ui.ModalFormData,"modal");wrapForm(ui.MessageFormData,"message");') : EVAL_HELPER);
    fs.writeFileSync(path.join(dest, 'scripts', '__lab_entry.js'), `import "./__lab.js";${entry ? `import ${JSON.stringify(entry)};` : ''}`);
    mod.entry = 'scripts/__lab_entry.js';
    if (!m.dependencies.some((d) => d.module_name === '@minecraft/server-gametest')) m.dependencies.push({ module_name: '@minecraft/server-gametest', version: beta['server-gametest'] });
    m.capabilities = [...new Set([...(m.capabilities ?? []), 'script_eval'])];
    writeJson(path.join(dest, 'manifest.json'), m);
  }
  for (const u of utilityPacks(live)) {   // as they are: no lab helper inside (the unit's script context stays the unit's)
    const dest = path.join(u.kind === 'bp' ? bp : rp, `util_${u.name}`);
    fs.cpSync(u.dir, dest, { recursive: true });
    const m = readJson(path.join(dest, 'manifest.json'));
    (u.kind === 'bp' ? bps : rps).push({ pack_id: m.header.uuid, version: typeof m.header.version === 'string' ? m.header.version.split(/[.-]/).slice(0, 3).map(Number) : m.header.version });
  }
  writeJson(path.join(world, 'world_behavior_packs.json'), bps);
  // BDS loads a script module only when config/default/permissions.json allows it, and its default list leaves out
  // @minecraft/common and @minecraft/server-net: an addon that needs one fails to load ("requesting dependency on module
  // [@minecraft/common] but it is not configured to use it"). This instance allows what the packs ask for (a copy, not the install)
  try {
    const pf = path.join(path.dirname(path.dirname(world)), 'config', 'default', 'permissions.json');
    if (exists(pf)) {
      const want = new Set();
      for (const d of fs.readdirSync(bp)) { try { for (const x of readJson(path.join(bp, d, 'manifest.json')).dependencies ?? []) if (/^@minecraft\//.test(x.module_name ?? '')) want.add(x.module_name); } catch { /* not a pack */ } }
      const j = readJson(pf), have = new Set(j.allowed_modules ?? []), add = [...want].filter((m) => !have.has(m));
      if (add.length) { fs.rmSync(pf, { force: true }); writeJson(pf, { ...j, allowed_modules: [...have, ...add] }); }
    }
  } catch { /* BDS without the file: it allows everything */ }
  // pack settings chosen by the server operator (`packset`): BDS reads them from this world file at load
  // (format found by trial against BDS 1.26.51's own error messages: format_version + settings[{pack_id, values}])
  const ps = path.join(world, 'world_behavior_pack_settings.json');
  const bpId = exists(path.join(BP, 'manifest.json')) ? readJson(path.join(BP, 'manifest.json')).header.uuid : null;
  if (bpId && Object.keys(settings).length) writeJson(ps, { format_version: '1.26.40', 'minecraft:pack_settings': { settings: [{ pack_id: bpId, values: settings }] } });
  else fs.rmSync(ps, { force: true });
  writeJson(path.join(world, 'world_resource_packs.json'), rps);
  return packHash();
}
// what a script-only /reload cannot pick up: everything in the packs except scripts/
function packHash() {
  const h = crypto.createHash('sha1');
  for (const p of packsOf()) for (const f of files(p.dir).sort()) { const r = path.relative(p.dir, f); if (p.kind === 'bp' && r.startsWith('scripts' + path.sep)) continue; h.update(r); h.update(fs.readFileSync(f)); }
  return h.digest('hex');
}

// ---------- engine: one BDS instance, commands in, rendered output out (batch run/test and the live server) ----------
const lineText = (l) => l.replace(/^\[[\d-]+ [\d:]+ \w+\] /, '').replace(/^\[Scripting\] /, '').replace(/§./g, '');
class Engine {
  constructor(inst) { this.inst = inst; this.settings = {}; this.bots = new Map(); this.joins = new Map(); this.srv = null; this.ok = false; this.mark = LOG.length; this.prevMark = LOG.length; }
  get world() { return path.join(this.inst.dir, 'worlds', 'lab'); }
  // ---- debugger (Mojang's script debugger protocol, lib/debugger.cjs) ----
  async initDebugger() {
    const { Debugger } = createRequire(import.meta.url)('./debugger.cjs');
    this.dbg = new Debugger();
    this.traces = new Map();   // "main.js:42" -> { src, exprs, max, hits, names, prev }
    this.errTrace = false;
    this.inst.debugPort = await this.dbg.listen(0, RT.listenHost);
    this.dbg.on('protocol', () => this.onAttach().catch((e) => this.say('E debugger: ' + e.message)));
    this.dbg.on('stopped', (e) => { this.stopQ = (this.stopQ ?? Promise.resolve()).then(() => this.onStop(e)).catch(() => this.dbg.request('continue', { threadId: e.thread }).catch(() => {})); });
    this.dbg.on('detached', () => { this.attached = false; });
  }
  say(l) { for (const x of String(l).split('\n')) LOG.push('[0-0-0 0:0:0 BOT] ' + x); }
  async bootUp() {
    if (this.proxyChild) { killTree(this.proxyChild); this.proxyChild = null; this.proxyPort = null; }   // a new boot has a new port
    await F.deploy?.(L(), this.inst, this);
    this.bootMark = this.jsMark = LOG.length; this.jsWait = false;   // (the addon's script reports in again on this boot)
    this.srv = await boot(this.inst);
    this.ok = !!(await ready(this.srv));
    // a native crash while the server starts, seen once in a few runs with addons that load fine (BDS 1.26.52, 2 CPUs): start
    // again once. A crash that comes back is the addon's (or the world's) and fails as before; one that does not is said
    if (!this.ok && this.srv.crashed && !process.env.LAB_NO_BOOT_RETRY) {
      try { await this.srv.stop?.(); } catch { /* gone */ }
      this.srv = await boot(this.inst);
      this.ok = !!(await ready(this.srv));
      LOG.push(this.ok ? '[0-0-0 0:0:0 INFO] BDS crashed while starting and started the second time (not the addon: the same addon loaded)' : '[0-0-0 0:0:0 ERROR] BDS crashed while starting, twice: the addon (a script at load, a pack file) or the world makes it crash');
    }
    if (this.ok && F.afterReady) this.ok = (await F.afterReady(L(), this)) !== false;
    return this.ok;
  }
  async onAttach() {
    let uuid = null;
    try { uuid = (readJson(path.join(BP, 'manifest.json')).modules ?? []).find((m) => m.type === 'script')?.uuid; } catch { /* no script */ }
    this.dbg.attach(uuid ?? this.dbg.plugins.at(-1)?.module_uuid);
    for (const p of new Set([...this.traces.values()].map((t) => t.path).concat(this.cov ? [...this.cov.left.keys()] : []))) await this.setBps(p);
    this.dbg.stopOnException(this.errTrace);
    this.dbg.resume();
    this.attached = true;
  }
  async setBps(p) {
    const tl = [...this.traces.values()].filter((t) => t.path === p).flatMap((t) => t.lines);
    const cl = this.cov ? [...(this.cov.left.get(p) ?? [])] : [];
    const lines = [...new Set([...tl, ...cl])].sort((a, b) => a - b);
    const r = await this.dbg.setBreakpoints(p, lines);
    const bs = r?.breakpoints ?? [];
    // lines the engine cannot stop at are not code: leave them out of coverage
    if (this.cov && !this.cov.checked.has(p)) { this.cov.checked.add(p); bs.forEach((b, i) => { if (!b.verified && !tl.includes(lines[i])) { this.cov.left.get(p)?.delete(lines[i]); this.cov.dead.add(`${p}:${lines[i]}`); } }); }
    return tl.every((l) => bs[lines.indexOf(l)]?.verified !== false);
  }
  // coverage: a breakpoint on every code line, removed at its first hit; the report lists the source lines that never ran
  covStart() {
    const all = B.codeLines(mapFile(), BP);
    this.cov = { all, left: new Map(), checked: new Set(), dead: new Set(), hit: new Set() };
    for (const c of all) (this.cov.left.get(c.path) ?? this.cov.left.set(c.path, new Set()).get(c.path)).add(c.line);
  }
  covReport() {
    if (!this.cov) return 'COV off (cov on, or run/test --cov)';
    const byFile = new Map();
    const texts = new Map();
    const lineOf = (src, n) => { if (!texts.has(src)) { try { texts.set(src, fs.readFileSync(path.join(ADDON, src), 'utf8').split('\n')); } catch { texts.set(src, []); } } return texts.get(src)[n - 1] ?? ''; };
    for (const c of this.cov.all) {
      if (this.cov.dead.has(`${c.path}:${c.line}`)) continue;
      if (/^\s*([})\];,]\s*)*$|^\s*(import|export \{)/.test(lineOf(c.src, c.srcLine))) continue;   // closing brackets, imports: nothing to run
      const f = byFile.get(c.src) ?? byFile.set(c.src, { n: 0, miss: [], tracked: new Set() }).get(c.src);
      f.n++; f.tracked.add(c.srcLine);
      if (!this.cov.hit.has(`${c.path}:${c.line}`)) f.miss.push(c.srcLine);
    }
    // QuickJS gives a function's last `return `...`` (a template literal, or a constant) no stop of its own (measured on BDS 1.26.52: inside
    // an if-block it stops, as the last statement it does not): such a line ran when the code line above it ran and goes
    // straight on into it (no return / throw / await / branch there)
    for (const [src, f] of byFile) {
      const miss = new Set(f.miss);
      for (const l of f.miss) {
        // (also a constant: `return undefined;` → `return void 0;`, `return;`, 'text', 0, null: measured the same on BDS 1.26.52.3)
        if (!/^\s*return\s*(\(?\s*`|;?\s*(\/\/.*)?$|(undefined|void 0|null|true|false|-?\d[\d.]*|'[^']*'|"[^"]*")\s*;?\s*(\/\/.*)?$)/.test(lineOf(src, l))) continue;
        let k = l - 1; while (k > 0 && !f.tracked.has(k) && !/\b(return|throw|break|continue|await|yield|if|else|case|default|catch|finally)\b|[{}?]\s*$/.test(lineOf(src, k)) && l - k < 4) k--;
        if (f.tracked.has(k) && !miss.has(k) && !/\b(return|throw|break|continue|await|yield)\b|^\s*(if|else|for|while|switch|case|default|do|try|catch|finally)\b|[{]\s*$/.test(lineOf(src, k))) miss.delete(l);
      }
      f.miss = f.miss.filter((l) => miss.has(l));
    }
    const ranges = (ls) => { const u = [...new Set(ls)].sort((a, b) => a - b), r = []; for (const l of u) { const last = r.at(-1); if (last && l === last[1] + 1) last[1] = l; else r.push([l, l]); } return r.map(([a, b]) => (a === b ? a : a + '-' + b)).join(','); };
    let n = 0, m = 0;
    const parts = [...byFile].map(([f, v]) => { n += v.n; m += v.miss.length; return `${f} ${v.n - v.miss.length}/${v.n}${v.miss.length ? ' never ran: ' + ranges(v.miss) : ''}`; });
    return `COV ${n ? Math.round(((n - m) / n) * 100) : 100}% of code lines ran | ${parts.join(' | ')}`;
  }
  async onStop(e) {
    const d = this.dbg, go = () => d.request('continue', { threadId: e.thread }).catch(() => {});
    const st = await d.request('stackTrace', { threadId: e.thread, startFrame: 0, levels: 1 });
    const f = st?.[0];
    if (!f) return go();
    // QuickJS reports an exception's frame one line early (checked against the error's own stack line)
    const here = REMAP(`${f.filename}:${f.line + (e.reason === 'exception' ? 1 : 0)}`);
    const names = async () => {
      const out = [];
      for (const sc of (await d.request('scopes', { frameId: f.id })).filter((x) => !x.expensive)) {
        for (const v of await d.request('variables', { variablesReference: sc.reference })) if (/^[A-Za-z_$][\w$]*$/.test(v.name) && v.type !== 'function' && !out.includes(v.name)) out.push(v.name);
      }
      return out;
    };
    const values = async (list) => {
      if (!list.length) return [];
      const r = await d.request('evaluate', { expression: `__labv([${list.map((n) => `[${JSON.stringify(n)},()=>(${n})]`).join(',')}])`, frameId: f.id, context: 'watch' });
      const txt = String(r?.result ?? '').replace(/^"|"$/g, '');
      return txt ? txt.split(/\u0001|\\u0001/) : [];
    };
    if (e.reason === 'exception') {
      if (!this.errTrace || /__lab|^r\.js/.test(f.filename)) return go();
      const loc = await d.request('scopes', { frameId: f.id }).then((sc) => d.request('variables', { variablesReference: sc[0].reference })).catch(() => []);
      const ex = loc.find((v) => v.name === '<exception>')?.value ?? '?';
      if (ex === this.lastEx) return go();   // the same throw is reported again when it leaves the frame
      this.lastEx = ex;
      this.say(`X ${here} ${ex} | ${(await values(await names())).join(' ')}`);
      return go();
    }
    if (this.cov?.left.get(f.filename)?.has(f.line)) {
      this.cov.left.get(f.filename).delete(f.line);
      this.cov.hit.add(`${f.filename}:${f.line}`);
      // resume first; the shrunk breakpoint list goes out batched (a hot line may stop once more meanwhile: harmless)
      (this.cov.dirty ??= new Set()).add(f.filename);
      this.cov.flush ??= setTimeout(() => { const ps = [...this.cov.dirty]; this.cov.dirty.clear(); this.cov.flush = null; for (const p of ps) this.setBps(p).catch(() => {}); }, 400);   // (not sooner: a list sent while the code runs on can skip the next line once)
    }
    const t = [...this.traces.values()].find((x) => x.path === f.filename && x.lines.includes(f.line));
    if (!t) return go();
    t.hits++;
    t.names ??= t.exprs.length ? t.exprs : await names();
    const vals = await values(t.names);
    // later hits print only what changed since the previous hit
    const cur = new Map(vals.map((kv) => [kv.slice(0, kv.indexOf('=')), kv]));
    const changed = t.prev ? [...cur].filter(([k, v]) => t.prev.get(k) !== v).map(([, v]) => v) : vals;
    t.prev = cur;
    // an unchanged hit prints `(same)`; QuickJS also stops a second time on a line with a call (right after it): that one stays silent
    const now = Date.now(), again = t.at && now - t.at < 150;
    t.at = now;
    if (changed.length) { t.shown = (t.shown ?? 0) + 1; this.say(`T${t.hits} ${t.src} ${changed.join(' ')}`); }
    else if (!again) { t.shown = (t.shown ?? 0) + 1; this.say(`T${t.hits} ${t.src} (same)`); }
    if (t.max && t.hits >= t.max) { this.traces.delete(t.key); await this.setBps(t.path).catch(() => {}); this.say(`trace ${t.src}: ${t.max} hits (${t.max - t.shown} unchanged), removed`); }
    return go();
  }
  async trace(args) {
    if (!this.dbg) return this.say('E trace: no debugger');
    if (args[0] === 'err') { this.errTrace = args[1] !== 'off'; this.dbg.stopOnException(this.errTrace); return this.say(`trace err ${this.errTrace ? 'on (every throw in the addon, caught or not, stops briefly)' : 'off'}`); }
    if (args[0] === 'off') {
      const paths = new Set([...this.traces.values()].map((t) => t.path));
      if (args[1]) { const w = B.locator(mapFile(), ADDON)(args[1]); for (const [k, t] of this.traces) if (t.path === w.path && t.line === w.line) this.traces.delete(k); } else this.traces.clear();
      for (const p of paths) await this.setBps(p).catch(() => {});
      return this.say(`trace off${args[1] ? ' ' + args[1] : ''}`);
    }
    const n = args.find((a) => /^x\d+$/.test(a)), exprs = args.slice(1).filter((a) => a !== n);
    const w = B.locator(mapFile(), ADDON)(args[0] ?? '');
    if (w.err) return this.say('E trace: ' + w.err);
    const key = `${w.path}:${w.line}`;
    this.traces.set(key, { key, path: w.path, line: w.line, lines: w.lines, src: w.src, exprs, max: n ? Number(n.slice(1)) : 20, hits: 0 });
    if (this.attached && !(await this.setBps(w.path))) return this.say(`E trace: ${w.src} has no code the engine can stop at`);
    this.say(`trace ${w.src}${exprs.length ? ' ' + exprs.join(' ') : ''} (up to ${n ? n.slice(1) : 20} hits)`);
  }
  async start({ keep = false, wait = 300, traces = [], cov = false } = {}) {
    this.covWanted = cov;
    this.keep = keep;
    await this.initDebugger();
    if (cov && !F.covOn) this.covStart();
    for (const t of traces) if (!F.startTrace?.(L(), this, t)) await this.trace(t.split(/\s+/));
    if (!keep || !exists(path.join(this.world, 'level.dat'))) {
      fs.rmSync(this.world, { recursive: true, force: true });
      fs.cpSync(TEMPLATE, this.world, { recursive: true, dereference: true });   // a linked cache (bench runs) must never be written through
      // a fresh run forgets the server's lists too (a ban or allowlist entry of the last run would refuse today's players)
      for (const f of ['banned-players.json', 'banned-ips.json', 'allowlist.json', 'whitelist.json']) if (exists(path.join(this.inst.dir, f))) fs.writeFileSync(path.join(this.inst.dir, f), '[]');
    }
    this.packHash = await writePacks(this.world, this.settings, this.inst?.name?.startsWith('live'));
    await this.bootUp();
    if (this.ok) await sleep(wait);
    return this.ok;
  }
  take(cmd) { const seg = { cmd, lines: LOG.slice(this.mark) }; this.prevMark = this.mark; this.mark = LOG.length; return seg; }
  // the server's ticks per real second since the last sample (20 = full speed; LAB_SPEED=k aims at 20k), logged as `tps`
  async tps(last) {
    const n = LOG.length;
    this.srv.send(`scriptevent lab:js #return 'LAB_TICK '+system.currentTick`);
    await this.srv.wait(/LAB_JS_DONE/, 5000);
    const l = LOG.slice(n).find((x) => x.includes('LAB_TICK '));
    for (let i = LOG.length - 1; i >= n; i--) if (/LAB_TICK |LAB_JS_DONE|Script event /.test(LOG[i])) LOG.splice(i, 1);
    const tick = Number(/LAB_TICK (\d+)/.exec(l ?? '')?.[1]), at = Date.now();
    if (!Number.isFinite(tick)) return last;
    if (last) LOG.push(`[0-0-0 0:0:0 BOT] tps ${((tick - last.tick) / ((at - last.at) / 1000)).toFixed(1)} (players ${this.bots.size}, speed x${SPEED})`);
    return { tick, at };
  }
  closeBots() { for (const b of this.bots.values()) b.close(); this.bots.clear(); }
  async stop() { this.closeBots(); if (this.srv) await this.srv.stop(); this.srv = null; this.dbg?.close(); }
  async restart(keepBots = false) {
    const rejoin = keepBots ? [...this.joins] : [];
    this.closeBots();
    await this.srv.stop();
    await this.bootUp();
    for (const [name, args] of this.ok ? rejoin : []) { await this.exec(`@${name} join ${args.join(' ')}`.trim(), 100); LOG.push(`[0-0-0 0:0:0 BOT] @${name} rejoined`); }
    return this.ok;
  }
  // run through the addon's eval helper (the same script context as the addon)
  async js(code) {
    // the script said it is there since this boot or the last /reload (an old line from before a restart or a reload is not it:
    // a script that did not come back used to cost every `js` its whole 30 s wait); just after a /reload, a moment to report in
    const seen = () => LOG.slice(this.jsMark ?? 0).some((l) => l.includes('LAB_JS_READY'));
    if (!seen() && this.jsWait) await this.srv.wait(/LAB_JS_READY/, 10000);
    this.jsWait = false;
    if (!seen()) { LOG.push('[0-0-0 0:0:0 ERROR] js unavailable: the addon script did not load (see errors above)'); return; }
    this.srv.send('scriptevent lab:js #' + code);   // '#' keeps the command parser away from a leading [ or {
    await this.srv.wait(/LAB_JS_DONE/, 30000);
    await sleep(50);
  }
  async bdsFile(cmd, re) {   // BDS command that writes a file and names it in its reply
    const n = LOG.length;
    this.srv.send(cmd);
    await this.srv.wait(re, 10000);
    const hit = LOG.slice(n).map((l) => re.exec(l)).find(Boolean);
    for (let i = LOG.length - 1; i >= n; i--) if (re.test(LOG[i])) LOG.splice(i, 1);
    return hit ? path.join(this.inst.dir, hit[1]) : null;
  }
  // LAB_PROXY="java -jar ouranos.jar --bind 127.0.0.1:{listen} --remote 127.0.0.1:{server}": one per server, its own port
  async proxyFor(cver, sver) {
    if (this.proxyPort) return this.proxyPort;
    let port = srvPort + 2;
    for (let k = 0; k < 50 && !(await udpFree(port)); k++) port += 2;
    const line = process.env.LAB_PROXY.replace(/\{listen\}/g, port).replace(/\{server\}/g, srvPort).replace(/\{version\}/g, cver).replace(/\{serverVersion\}/g, sver);
    const child = spawn(line, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: !WIN });
    KIDS.add(child); child.on('exit', () => KIDS.delete(child)); this.proxyChild = child;
    const feed = (d) => { for (const l of String(d).split('\n').filter((x) => x.trim())) LOG.push('[0-0-0 0:0:0 INFO] [proxy] ' + l.trim()); };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    await sleep(Number(process.env.LAB_PROXY_WAIT) || 3000);
    if (child.exitCode !== null) throw new Error('LAB_PROXY exited: ' + line);
    return (this.proxyPort = port);
  }
  async exec(c, wait = 300, raw = false) {
    const srv = this.srv, bots = this.bots;
    const [w, ...rest] = c.split(' ');
    // the platform's own commands first (py / lse / events / states / trace .py ...); `sapi <cmd>` = the Script API version
    if (w === 'sapi' && !raw) return this.exec(rest.join(' '), wait, true);
    if (F.exec && !raw && !(w.startsWith('@') && w.length > 1)) { const r = await F.exec(L(), this, w, rest, c, wait); if (r !== undefined) return r; }
    if (w.startsWith('@') && w.length > 1) {
      // `@A& <action>`: started and not waited for (many players at once; `waitall [ms]` waits for them)
      const bg = w.endsWith('&') && w.length > 2, name = bg ? w.slice(1, -1) : w.slice(1), [action, ...a] = rest;
      try {
        if (action === 'join') {
          if (bots.has(name)) { LOG.push(`[0-0-0 0:0:0 BOT] @${name} already joined`); await sleep(wait); return; }   // (e.g. after restart, which rejoins players): not an error
          const { req, ver, versions, borrow } = await realDeps();
          const { createRealPlayer } = createRequire(import.meta.url)('./realplayer.cjs');
          if (borrow && !this.borrowed) { this.borrowed = await borrowProtocol(req, ver, srvPort); LOG.push(`[0-0-0 0:0:0 BOT] (borrowed client: ${ver} packets, protocol ${this.borrowed ?? '?'} of BDS ${bdsVersion()})`); }
          // join version=<x.y.z>: connect as a client of that protocol. Without a proxy BDS refuses it like it refuses a real
          // outdated/newer client; with LAB_PROXY (a protocol translator, e.g. Ouranos / go-multiversion) the client goes through it
          const jo = Object.fromEntries(a.map((x) => { const i = x.indexOf('='); return i < 0 ? [x, ''] : [x.slice(0, i), x.slice(i + 1)]; }));   // first '=' only: values may hold '=' (URLs)
          let cver = ver, cport = srvPort;
          if (jo.version) {
            cver = jo.version; delete jo.version;
            if (!versions.includes(cver)) throw new Error(`version=${cver}: this client knows ${versions.filter((v) => vcmp3(v, '1.21.0') >= 0).join(' ')}`);
            if (cver !== ver && process.env.LAB_PROXY) cport = await this.proxyFor(cver, ver);
          }
          // the bot asks the server-side script for block permutations (needed for block clicks)
          const ask = async (code, tag) => {
            const n = LOG.length;
            srv.send(`scriptevent lab:js #${code}`);
            await srv.wait(/LAB_JS_DONE/, 5000);
            const l = LOG.slice(n).find((x) => x.includes(tag + ' '));
            for (let i = LOG.length - 1; i >= n; i--) if (/LAB_BLOCK |LAB_TAGS |LAB_JS_DONE|Script event /.test(LOG[i])) LOG.splice(i, 1);
            try { return JSON.parse(l.slice(l.indexOf(tag + ' ') + tag.length + 1)); } catch { return null; }
          };
          const blockAt = (b) => ask(`const k=dim.getBlock(${JSON.stringify(b)})?.permutation; return "LAB_BLOCK "+JSON.stringify(k?{id:k.type.id,states:k.getAllStates()}:null)`, 'LAB_BLOCK');
          const itemTags = async (names) => (await ask(`return "LAB_TAGS "+JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(x=>{try{return[x,new mc.ItemStack(x).getTags()]}catch{return[x,[]]}})))`, 'LAB_TAGS')) ?? {};
          const packId = exists(path.join(BP, 'manifest.json')) ? readJson(path.join(BP, 'manifest.json')).header.uuid : undefined;
          const packNames = Object.fromEntries(packsOf().map((q) => { try { const h = readJson(path.join(q.dir, 'manifest.json')).header; return [h.uuid, h.name]; } catch { return [null, null]; } }));
          const tj = jo.transport ?? TRANSPORT;
          const wantNN = tj === 'nethernet';
          const rtc = wantNN ? await rtcDeps() : null;
          // transport=lan: the local world way (LAN discovery + signaling), with nethernet-connect's own bedrock-protocol
          let lanJ = null;
          if (tj === 'lan') {
            if (TRANSPORT !== 'lan') throw new Error('join transport=lan: start the server with LAB_TRANSPORT=lan');
            delete jo.transport;
            lanJ = await (await import('./lan.mjs')).labJoin(CACHE, { name });
          }
          let bot; let n0 = LOG.length;
          const mk = () => createRealPlayer({ req: lanJ?.req ?? req, lan: lanJ, port: cport, name, version: cver, transport: lanJ ? 'lan' : TRANSPORT === 'lan' ? 'nethernet' : TRANSPORT, rtc, emit: (l) => LOG.push('[0-0-0 0:0:0 BOT] ' + l), blockAt, itemTags, packId, packNames, opts: jo, nn: { pins: path.join(CACHE, 'nethernet-pins.json') } });
          // a borrowed client whose protocol number is not quite the server's (a later preview build): the server says older or
          // newer, so walk the number that way until it lets the player in (once per server; the found number is kept)
          if (borrow && cver === ver && !this.borrowDone) {
            const O = req('bedrock-protocol/src/options');
            for (let k = 0, dir = 0; k < 60; k++) {
              const m0 = LOG.length;
              try { bot = await mk(); break; } catch (e) {
                const said = LOG.slice(m0).join('\n'), older = /refused: failed_client/.test(said), newer = /refused: failed_server/.test(said);
                if (!older && !newer) throw e;
                const d = older ? 1 : -1;
                if (dir && d !== dir) throw new Error(`borrowed client: BDS ${bdsVersion()} accepts no protocol number near ${O.Versions[ver]} (node lab.mjs setup --update when bedrock-protocol speaks it)`);
                dir = d; O.Versions[ver] += d; LOG.splice(m0);
              }
            }
            this.borrowDone = true;
            if (bot) LOG.push(`[0-0-0 0:0:0 BOT] (borrowed client joined with protocol ${O.Versions[ver]})`);
            n0 = LOG.length;
          }
          try { bot ??= await mk(); } catch (e) {
            // another protocol, no proxy: BDS closes the door like on a real outdated/newer client. That is the expected answer, not an error
            // the server refused the login with a reason (a ban, a whitelist, a full server): that line is the answer, not an error
            if (/closed/.test(e.message) && LOG.slice(n0).some((l) => l.includes(`@${name} disconnected:`))) { await sleep(wait); return; }
            if (cver !== ver && cport === srvPort && /closed|did not spawn/.test(e.message)) { LOG.push(`[0-0-0 0:0:0 BOT] @${name} refused: ${e.message} (client ${cver}, server ${ver}; LAB_PROXY translates)`); await sleep(wait); return; }
            throw e;
          }
          bot.on('gone', () => { if (bots.get(name) === bot) bots.delete(name); });
          bots.set(name, bot);
          this.joins.set(name, a);
          const o0 = LOG.length;
          srv.send('op ' + name);
          await srv.wait(/Opped|op/i, 3000);
          // BDS 1.26.60+ answers "Could not op" when the player is an operator already (default-player-permission-level): not an error
          for (let i = LOG.length - 1; i >= o0; i--) if (new RegExp(`Could not op: ${name}\\s*$`).test(LOG[i])) LOG.splice(i, 1);
          await sleep(300);
        } else {
          const b = bots.get(name);
          if (!b) throw new Error(`not joined (use: @${name} join)`);
          if (bg && action !== 'join') {
            const p = b.act(action, a).catch((e) => LOG.push(`[0-0-0 0:0:0 ERROR] @${name} ${action}: ${e.message}${this.borrowed && BORROW_GAP.test(e.message) ? ' (borrowed client: this action\'s packets changed; not the addon\'s fault)' : ''}`));
            (this.bgActs ??= new Set()).add(p); p.finally(() => this.bgActs.delete(p));
            await sleep(wait); return;
          }
          await b.act(action, a);
          if (action === 'leave') { bots.delete(name); this.joins.delete(name); }
          // a slow server (LeviLamina under Wine) handles a player's packets seconds late: wait until it has done this action's
          // (then a console marker: the log lines of that work are out too)
          else if (F.slowServer?.(L()) && this.sync !== false) { await b.act('__sync', []); const k = (this.syncN = (this.syncN ?? 0) + 1); srv.send(`scriptevent lab:sync ${k}`); await srv.wait(new RegExp(`LAB_SYNC ${k}\\s*$`), 20000); }
        }
      } catch (e) { LOG.push(`[0-0-0 0:0:0 ERROR] @${name} ${action}: ${e.message}${this.borrowed && BORROW_GAP.test(e.message) ? ` (borrowed client: this action's packets changed in BDS ${bdsVersion()}; not the addon's fault, it waits for bedrock-protocol)` : ''}`); }
      await sleep(wait);
    } else if (w === 'wait') await sleep(Number(rest[0]) || 0);
    else if (w === 'template' && rest[0] === 'save') {   // template save: this world (with every chunk generated so far) becomes the seed's template
      srv.send('save hold');
      let files = null;
      for (let k = 0; k < 60 && !files; k++) {
        await sleep(500); const n = LOG.length; srv.send('save query'); await srv.wait(/Data saved|not ready|A previous save/i, 3000);
        const i = LOG.slice(n).findIndex((x) => /Data saved/.test(x));
        if (i >= 0) { const list = LOG.slice(n + i + 1).find((x) => /:\d+/.test(x)); files = list ? lineText(list).split(/,\s*/).map((q) => { const m = /^(.*):(\d+)$/.exec(q.trim()); return m ? [m[1], Number(m[2])] : null; }).filter(Boolean) : []; }
      }
      if (!files) { srv.send('save resume'); LOG.push('[0-0-0 0:0:0 ERROR] template save: the world did not become ready to copy'); return; }
      const tmp = TEMPLATE + '.new';
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const [rel, len] of files) {   // "lab/db/000012.ldb": the level folder is `lab`
        const src = path.join(this.world, rel.replace(/^[^/\\]+[/\\]/, '')), dst = path.join(tmp, rel.replace(/^[^/\\]+[/\\]/, ''));
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const fd = fs.openSync(src, 'r'), buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, 0); fs.closeSync(fd); fs.writeFileSync(dst, buf);
      }
      srv.send('save resume');
      for (const f of ['world_behavior_packs.json', 'world_resource_packs.json']) fs.rmSync(path.join(tmp, f), { force: true });   // the unit's packs are set per run
      fs.rmSync(TEMPLATE, { recursive: true, force: true }); fs.renameSync(tmp, TEMPLATE);
      LOG.push(`[0-0-0 0:0:0 BOT] template saved: ${files.length} files (${path.basename(TEMPLATE)})`);
    }
    else if (w === 'waitall') {   // waitall [ms]: until every `@X& ...` started has finished (or ms passed)
      const ms = Number(rest[0]) || 3600000, t0 = Date.now();
      let last = null, next = Date.now() + 20000;
      while ((this.bgActs?.size ?? 0) > 0 && Date.now() - t0 < ms && !srv.exited) {
        await sleep(200);
        if (Date.now() >= next) { next = Date.now() + 20000; last = await this.tps(last); }
      }
      if (this.bgActs?.size) LOG.push(`[0-0-0 0:0:0 ERROR] waitall: ${this.bgActs.size} still running after ${ms}ms`);
    }
    else if (w === 'until') {
      // until <regex> [ms]: wait for a line (since the previous command started), instead of guessing a wait
      const ms = /^\d+$/.test(rest.at(-1) ?? '') && rest.length > 1 ? Number(rest.pop()) : 10000;
      let re; try { re = rx(rest.join(' ')); } catch (e) { LOG.push(`[0-0-0 0:0:0 ERROR] until: ${e.message}`); return; }
      const seen = () => LOG.slice(this.prevMark).some((l) => re.test(lineText(l)));
      const t0 = Date.now();
      while (!seen() && Date.now() - t0 < ms && !srv.exited) await sleep(50);
      if (!seen()) LOG.push(`[0-0-0 0:0:0 ERROR] until: /${re.source}/ not seen in ${ms}ms`);
    } else if (w === 'speed') {
      // speed <x>: from now on this server's clock runs x times as fast (like Java's /tick rate 20x): the same world is restarted with
      // the new clock and the players rejoin where they were (a live change of a clock's rate makes BDS's clocks jump; a restart
      // does not). speed 1 = normal. Needs libfaketime (see LAB_SPEED)
      const x = Math.max(1, Number(rest[0]) || 1);
      SPEED = x; process.env.LAB_SPEED = String(x); process.env.LAB_TICK_MS = String(50 / x);
      if (x > 1 && !speedLib()) return;
      const rejoin = [...this.joins];
      this.closeBots();
      await this.srv.stop();
      await this.bootUp();
      if (!this.ok) return false;
      for (const [name, a] of rejoin) await this.exec(`@${name} join ${a.join(' ')}`.trim(), 100);
      LOG.push(`[0-0-0 0:0:0 BOT] speed x${x}: ${20 * x} ticks a second (server restarted with the same world${rejoin.length ? `, ${rejoin.length} players rejoined` : ''})`);
      await sleep(wait);
    } else if (w === 'packset') {
      // packset <name>=<value>...: the operator's pack settings (world file), then restart the same world; players rejoin.
      // A client cannot change settings on a dedicated server (BDS ignores ServerboundPackSettingChange), so this is how BDS does it
      for (const kv of rest) { const i = kv.indexOf('='); if (i < 1) { LOG.push('[0-0-0 0:0:0 ERROR] packset name=value ...'); return; } let v = kv.slice(i + 1); try { v = JSON.parse(v); } catch { /* string */ } this.settings[kv.slice(0, i)] = v; }
      const rejoin = [...this.joins];
      this.closeBots();
      await this.srv.stop();
      this.packHash = await writePacks(this.world, this.settings, this.inst?.name?.startsWith('live'));
      await this.bootUp();
      if (!this.ok) return false;
      for (const [name, a] of rejoin) { await this.exec(`@${name} join ${a.join(' ')}`.trim(), 100); LOG.push(`[0-0-0 0:0:0 BOT] @${name} rejoined`); }
      LOG.push(`[0-0-0 0:0:0 BOT] pack settings ${JSON.stringify(this.settings)} (world restarted)`);
      await sleep(wait);
    } else if (w === 'view') {
      // view x1 y1 z1 x2 y2 z2 [width]: the blocks in that box, rendered by Mojang Creator Tools with real textures
      const n = rest.map(Number);
      if (n.length < 6 || n.slice(0, 6).some(Number.isNaN)) { LOG.push('[0-0-0 0:0:0 ERROR] view x1 y1 z1 x2 y2 z2 [width]'); return; }
      const vf = path.join(LAB, 'from-addon', 'view.json');
      fs.rmSync(vf, { force: true });
      await this.js(`return 'VOL '+await __labsave('view.json',__labvol({x:${n[0]},y:${n[1]},z:${n[2]}},{x:${n[3]},y:${n[4]},z:${n[5]}}))`);
      if (!exists(vf) || !fs.statSync(vf).size) return;
      const v = JSON.parse(fs.readFileSync(vf, 'utf8'));
      this.views = (this.views ?? 0) + 1;
      const png = path.join(LAB, 'render', `view${this.views}.png`);
      try { const d = (await X()).view(CACHE, vf, png, n[6] || 400); this.say(`VIEW ${rel(png)} ${d.w}x${d.h}: ${v.solid} blocks, ${v.types} kinds (read the image)`); } catch (e) { LOG.push('[0-0-0 0:0:0 ERROR] ' + e.message); }
      for (let i = LOG.length - 1; i >= 0 && i >= LOG.length - 5; i--) if (/ VOL \d+$|^\S+ \S+ \w+\] (\[Scripting\] )?VOL \d+$/.test(LOG[i])) LOG.splice(i, 1);
    } else if (w === 'cov') {
      if (rest[0] === 'on') { this.covStart(); for (const p of this.cov.left.keys()) await this.setBps(p).catch(() => {}); this.say('cov on'); }
      else this.say(this.covReport());
    } else if (w === 'trace') {
      await this.trace(rest);
      await sleep(50);
    } else if (w === 'restart') {   // the same world again; real players rejoin (as people would), `restart alone` leaves them out
      if (!(await this.restart(rest[0] !== 'alone'))) return false;
      await sleep(wait);
    } else if (w === 'clock') {   // clock +1d | +3h | -30m: the addon's Date (not the game's day/night) runs ahead from now on
      const ms = clockMs(rest[0]);
      if (ms === null) LOG.push('[0-0-0 0:0:0 ERROR] clock: use clock +1d | +3h | +90m | +30s (the addon\'s Date; time set day is the game\'s sky)');
      else await this.js(`__labClock(${ms})`);
    } else if (w === 'js' || w === 'events' || w === 'states') {
      // events/states [on|off] [names...] -> the tap in the addon's own script context
      const on = rest[0] !== 'off';
      await this.js(w === 'js' ? rest.join(' ') : `tap.${w}(${on}, ${JSON.stringify(rest.slice(rest[0] === 'on' || rest[0] === 'off' ? 1 : 0).join(' '))})`);
    } else if (w === 'prof') {
      // prof start | prof stop [n]: the engine's script profiler (what minecraft-debugger shows), summarized
      if (rest[0] !== 'stop') { srv.send('script profiler start'); await srv.wait(/Profiler started|already/i, 3000); return; }
      const f = await this.bdsFile('script profiler stop', /Profile saved to '\.?\/?(.+?)'/);
      for (const l of (f ? profSummary(f, Number(rest[1]) || 8) : 'prof: no profile (prof start first)').split('\n')) LOG.push('[0-0-0 0:0:0 BOT] ' + l);
    } else if (w === 'serverping') {
      // serverping: the server list's view (RakNet unconnected ping), as a client's server list gets it
      const sock = dgram.createSocket('udp4'), magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
      const reply = await new Promise((res) => {
        const t = setTimeout(() => res(null), 3000);
        sock.on('message', (m) => { if (m[0] === 0x1c) { clearTimeout(t); res(m); } });
        const b = Buffer.alloc(33); b[0] = 0x01; b.writeBigInt64BE(BigInt(Date.now()), 1); magic.copy(b, 9); b.writeBigInt64BE(7n, 25);
        sock.send(b, srvPort, '127.0.0.1');
      });
      sock.close();
      if (!reply) LOG.push('[0-0-0 0:0:0 ERROR] serverping: no answer (NetherNet servers do not answer RakNet pings)');
      else { const f = reply.subarray(35).toString('utf8').split(';'); LOG.push(`[0-0-0 0:0:0 BOT] PING motd=${JSON.stringify(f[1] ?? '')} players=${f[4]}/${f[5]} level=${JSON.stringify(f[7] ?? '')} version=${f[3]}`); }
    } else if (w === 'perf') {
      // perf [ms]: diagnostics capture (script/server tick time, script memory, entities)
      srv.send('script diagnostics startcapture');
      await sleep(Number(rest[0]) || 3000);
      const f = await this.bdsFile('script diagnostics stopcapture', /saved to '\.?\/?(.+?)'/);
      LOG.push('[0-0-0 0:0:0 BOT] ' + (f ? perfSummary(f) : 'perf: no capture'));
    } else {
      if (/^reload\b/.test(c)) { this.jsMark = LOG.length; this.jsWait = true; }   // (the script reports in again after it)
      srv.send(c);
      // wait until the server has run it (its reply is out): a marker after it comes back once the command is done. Native BDS
      // answers in a tick; Wine (LeviLamina) can queue console input for seconds, and the next step must not overtake it
      if (this.sync !== false) {
        const k = (this.syncN = (this.syncN ?? 0) + 1);
        srv.send(`scriptevent lab:sync ${k}`);
        const r = await srv.wait(new RegExp(`LAB_SYNC ${k}\\s*$`), this.sync ? 30000 : 8000);
        if (r) this.sync = true; else if (!this.sync) this.sync = false;   // no helper in this world: plain waits from now on
      } else await srv.wait(/.*/, 3000);
      await sleep(wait);
    }
    return true;
  }
}

async function session(cmds, { wait = 300, keep = false, traces = [], cov = false } = {}) {
  await setup();
  const inst = await claim('main');
  const eng = new Engine(inst);
  const segs = [];
  await eng.start({ keep, wait, traces, cov });
  if (cov && eng.ok && F.covOn) await F.covOn(L(), eng);
  segs.push(eng.take(null));
  for (const c of eng.ok ? cmds : []) {
    const r = await eng.exec(c, wait);
    segs.push(eng.take(c));
    if (r === false) break;
  }
  const cr = cov ? (F.covReport ? await F.covReport(L(), eng) : eng.covReport()) : null;
  await eng.stop();
  segs.push(eng.take('stop'));
  inst.release();
  return { ready: eng.ok, segs: render(segs), cov: cr };
}

// cpuprofile -> self time per function, addon frames first (lab's own helper frames dropped)
function profSummary(f, n) {
  let p; try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return 'prof: unreadable ' + f; }
  const self = new Map(), byId = new Map(p.nodes.map((x) => [x.id, x]));
  let total = 0;
  p.samples.forEach((id, i) => { const d = p.timeDeltas[i] ?? 0; total += d; self.set(id, (self.get(id) ?? 0) + d); });
  const agg = new Map();
  for (const [id, t] of self) {
    const cf = byId.get(id)?.callFrame; if (!cf) continue;
    if (/__lab|^<input>$|^r\.js$/.test(cf.url)) continue;
    const fn = cf.functionName.startsWith('function') ? '(native)' : cf.functionName || '(anonymous)';
    const k = `${fn} ${cf.url}${cf.lineNumber >= 0 ? ':' + (cf.lineNumber + 1) : ''}`;
    agg.set(k, (agg.get(k) ?? 0) + t);
  }
  const rows = [...agg].sort((a, b) => b[1] - a[1]).slice(0, n);
  return `PROF ${(total / 1000).toFixed(1)}ms sampled` + (rows.length ? '\n' + rows.map(([k, t]) => `  ${(t / 1000).toFixed(2)}ms ${REMAP(k)}`).join('\n') : ' (no addon frames)');
}
function perfSummary(f) {
  let frames = [];
  try {
    const t = fs.readFileSync(f, 'utf8');
    frames = t.slice(t.indexOf('}') + 1).trim().split('\n').map((l) => JSON.parse(zlib.gunzipSync(Buffer.from(l, 'base64')).toString()));
  } catch { return 'perf: unreadable ' + f; }
  const vals = new Map();
  const walk = (node, p) => { const k = p + node.name; if (node.values) (vals.get(k) ?? vals.set(k, []).get(k)).push(...node.values); for (const c of node.children ?? []) walk(c, k + '/'); };
  for (const fr of frames) for (const s of fr.stats ?? []) walk(s, '');
  const ms = (k) => { const v = vals.get(k); if (!v?.length) return '-'; const avg = v.reduce((a, b) => a + b, 0) / v.length; return `avg ${(avg / 1000).toFixed(2)}ms max ${(Math.max(...v) / 1000).toFixed(2)}ms`; };
  const last = (k) => vals.get(k)?.at(-1) ?? '-';
  return `PERF script_tick ${ms('server_tick_timings/script_tick')} | level_tick ${ms('server_tick_timings/level_tick')} | script_mem ${Math.round(Number(last('scripting_engine/Memory Used (KB)')) || 0)}KB | entities ${last('entities')} | dynprops ${last('dynamic_properties/total_memory_used')}B`;
}

const NOISE = /«TSREPL»\{"id":"lab-warm"|^Debugger (attached|connected|detached|disconnected)|^Debugger connection failed, no plugin found|auto-attach waiting|^Waiting for debugger|Could not op \(already op|Missing id, won't persist permissions|TRANSPORT TYPE ERROR|connection type is not set to NetherNet|set 'transport=nethernet'|reference the included bedrock_server_how_to|^=+$|Players will not be able to connect to your game without NetherNet|Script event .* has been sent|LAB_READY|LAB_JS_READY|LAB_JS_DONE|LAB_PART|^Plugin \[.*ran with error|^\[?lab_helper\]? /;
export const clockMs = (a) => { const m = /^([+-]?)(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(String(a ?? '')); return m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) * { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[3]] : null; };
const PSEUDO = /^(wait|until|restart|packset|js|events|states|prof|perf|serverping|trace|view|cov|clock|@\S+)\b/;
let REMAP = (s) => s;
// the addon's own name in front of its script errors (`[My Addon] TypeError...`) says nothing: only other packs keep theirs
const OWN = (() => { try { const n = JSON.parse(fs.readFileSync(path.join(BP, 'manifest.json'), 'utf8')).header.name; return new RegExp('^\\[' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\] '); } catch { return /^\b$/; } })();
// what an error line usually means and the fix (measured on BDS 1.26.51): printed once per run under the first match
const HINTS = [
  [/cannot be used in early execution/, 'fix: runs before the world is loaded: move it into world.afterEvents.worldLoad or system.run(...)'],
  [/cannot be used in restricted execution/, 'fix: before-events are read-only: do the change in system.run(() => ...)'],
  [/cannot read property '(subscribe|unsubscribe)' of undefined/, 'fix: that event does not exist in this API version: node lab.mjs api world.afterEvents.<name> (beta-only? node lab.mjs mode beta)'],
  [/is not a function/, 'fix: not in this API version or wrong class: node lab.mjs api <Class>.<member> (beta-only? node lab.mjs mode beta)'],
  [/Failed to get property '\w+'/, 'fix: keep the ItemStack in a variable first (const s = c.getItem(i); s.getComponent(...)), a chained getItem() result is invalid'],
  [/not in a chunk currently loaded/, 'fix: that spot is not loaded: the lab world loads x,z -32..31; elsewhere add a ticking area or wait for a player there'],
  [/outside of the world boundaries/, 'fix: overworld y is -64..319'],
  [/Invalid (item|entity|block) identifier/, 'fix: unknown id: node lab.mjs doc <id> (vanilla ids, block states) or define it (node lab.mjs add ...)'],
  [/min_engine_version' has a version of .* too high/, 'fix: this BDS is older than the manifest allows: set header.min_engine_version to the oldest version you support, and module versions that BDS offers (test --bds <ver>)'],
  [/BDS crashed/, "fix: known crash (1.26.51): getItem(i).getComponent('minecraft:inventory').container chained, keep the ItemStack in a variable; else bisect with trace / smaller steps"],
  [/cannot read property '[^']+' of (undefined|null)/, 'fix: a value is undefined there (an empty slot, a missing component, a player who left, a find() with no match): check it before use; node lab.mjs why shows the values where it threw'],
  [/InvalidEntityError|Entity being invalid|has the Entity been removed/, 'fix: that player or entity is gone (left, died, unloaded) by the time the code ran (after an await, a form, a timeout): check .isValid first'],
  [/Unhandled promise rejection/, 'fix: thrown in async code (after an await, in a form or command callback): the error after the colon is the cause; node lab.mjs why shows the values where it threw'],
  [/String length for dynamic property/, 'fix: a dynamic property string holds at most 32767 characters: split it'],
  [/Syntax error: Unexpected/, 'fix: command syntax: node lab.mjs doc /<command>'],
  [/no parser available for version/, 'fix: format_version is newer than this BDS: use the version `add` writes'],
  [/invalid numeric value|expected an? (number|integer|object|array|string)/i, 'fix: wrong value type for that field: node lab.mjs doc <component>'],
];
HINTS.unshift(...(F.hints ?? []));   // the platform's own error lines first
// `requested invalid version [2.10.0] of [@minecraft/server]` + `Available versions:` + one version per line, and the two
// consequences (failed to create context / run failed) -> one line per module
function compactVersionErrors(o) {
  let any = false;
  for (let i = 0; i < o.length; i++) {
    const m = /^E .*requested invalid version \[(.+?)\] of \[(.+?)\]/.exec(o[i]);
    if (!m) continue;
    const vers = []; let j = i + 1;
    for (; j < o.length && /^ {2}\S/.test(o[j]); j++) { const v = /^ {2}(\d[\w.-]*)$/.exec(o[j]); if (v) vers.push(v[1]); }
    const during = / {3}\(during: .*\)$/.exec(o[i])?.[0] ?? '';
    o.splice(i, j - i, `E ${m[2]} ${m[1]} is not in this BDS; it has ${vers.join(' ')}${during}`, ...(any ? [] : ['  fix: use one of those versions in bp/manifest.json (x.y.z-beta = beta APIs of this build only; stable versions carry over)']));
    any = true;
  }
  if (!any) return;
  for (let i = o.length - 1; i >= 0; i--) if (/^E .*(failed to create context|run failed, no runtime or context available)/.test(o[i])) { let j = i + 1; while (j < o.length && /^ {2}\S/.test(o[j]) && !/^ {2}fix:/.test(o[j])) j++; o.splice(i, j - i); }
}
function render(segs) {
  const res = [];
  const hinted = new Set();
  for (const seg of segs) {
    const o = [];
    let keep = false, keepErr = false, prev = null, rep = 0;
    const emit = (s) => { if (s === prev) { rep++; return; } if (rep) o.push(`  (x${rep + 1})`); rep = 0; prev = s; o.push(s); };
    const reply = seg.cmd && seg.cmd !== 'stop' && !PSEUDO.test(seg.cmd) && !F.pseudo?.test(seg.cmd) && !seg.cmd.startsWith('scriptevent');
    // a multi-line message pushed as one entry (npm output inside an error) is one line each: the first keeps the level
    for (const line of seg.lines.flatMap((l) => String(l).split('\n'))) {
      const m = /^\[[\d-]+ [\d:]+ (\w+)\] (.*)$/.exec(line);
      if (!m) {
        if (keep && line.trim() && line.trim() !== 'Quit correctly') {
          const t = REMAP(line.trim()).replace(/^at <anonymous> \((.*)\)$/, 'at $1');
          emit('  ' + t);
          if (keepErr) for (const [re, h] of HINTS) if (re.test(t) && !hinted.has(h)) { hinted.add(h); o.push('  ' + h); break; }   // details on the next lines (pack errors)
        }
        continue;
      }
      keep = false;
      const level = m[1], script = m[2].startsWith('[Scripting]');
      const text = REMAP(m[2].replace(/^\[Scripting\] /, '').replace(/§./g, '').trim()).replace(OWN, '').replace(/ at <anonymous> \(/g, ' (');
      if (!text || NOISE.test(text) || F.noise?.test(text)) continue;
      const content = /^\[[A-Za-z ]+\]\[(error|warning)\]/i.test(text);
      // a set-up command with nothing to do is not a failure (`clear A` on an empty inventory, `kill @e[type=item]` with none)
      const benign = reply && (/^Could not clear the inventory of .+, no items to remove/.test(text) || (/^No targets matched selector/.test(text) && /^(kill|clear|effect|tag)\b/.test(seg.cmd)));
      const err = !benign && (level === 'ERROR' || (script && /^(Uncaught|\[\w+\] \w*Error|\w*Error:)/.test(text)) || /\]\[error\]/i.test(text));
      if (level === 'BOT') { emit(text); keep = false; continue; }
      if (script || err || content || benign || (reply && level === 'INFO') || (level === 'WARN' && (/pack|manifest|script|json|real players/i.test(text) || F.showWarn?.test(text)))) {
        emit((err ? 'E ' : level === 'WARN' && !script ? 'W ' : '') + text.replace(/worlds\/lab\/(behavior|resource)_packs\//g, '').replace(/ {2,}/g, ' '));
        keep = true; keepErr = err || content;
        if (err || content) for (const [re, h] of HINTS) if (re.test(text) && !hinted.has(h)) { hinted.add(h); o.push('  ' + h); break; }
      }
    }
    if (rep) o.push(`  (x${rep + 1})`);
    compactVersionErrors(o);
    compactPyTracebacks(o, (f) => (path.isAbsolute(f) && f.startsWith(TOP) ? rel(f) : f));
    // a broadcast already printed as a plain line: drop each real client's identical echo; after a console command, also the
    // target's own notice of it (`@A %commands.give.successRecipient ...`: the console reply above says the same)
    const plain = new Set(o.filter((l) => !l.startsWith('@')));
    res.push({ cmd: seg.cmd, out: o.filter((l) => !(reply && (/^@\S+ %(commands\.|gameMode\.changed)/.test(l) || /^Title command successfully executed$/.test(l))) && (!/^@\S+ /.test(l) || !plain.has(l.replace(/^@\S+ /, '')))) });
  }
  return res;
}

function parseArgs(args) {
  const o = { wait: 300, keep: false, verbose: false, rest: [], traces: [] };
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '-w') o.wait = Number(args[++k]) || 0;
    else if (args[k] === '-t') o.traces.push(args[++k]);   // trace from the first line (startup code)
    else if (args[k] === '--cov') o.cov = true;
    else if (args[k] === '-k') o.keep = true;
    else if (args[k] === '-v') { o.verbose = true; process.env.LAB_DEBUG = '1'; }
    else o.rest.push(args[k]);
  }
  return o;
}

// build src/ (bundle + type check), then lint. Prints E/W lines; false when there are errors
let TL = null;
const tl = () => (TL ??= B.tools(CACHE));
async function sdkDir() {
  const m = readJson(path.join(BP, 'manifest.json'));
  return B.sdk({ cache: CACHE, bv: bdsVersion().split('.').slice(0, 3).join('.'), deps: m.dependencies ?? [], npmDoc: npmVersions });
}
const mapFile = () => path.join(LAB, 'maps', path.basename(ADDON) + '.json');
async function build({ types = true, jsTypes = false } = {}) {
  const errs = [], warns = [], hints = [];   // hints: type findings in plain JS (T lines: advisory, never fail)
  if (F.sapiBuild === false) return { errs, warns, hints };   // end/ll: src/ belongs to the plugin/mod; bp/scripts stays plain JS
  const src = !!B.entryOf(ADDON);
  const scripts = src || files(path.join(BP, 'scripts'), (x) => /\.[cm]?js$/.test(x)).length > 0;
  if (!scripts || !exists(path.join(BP, 'manifest.json'))) return { errs, warns, hints };
  try {
    await setup();
    const sdk = await sdkDir();
    B.writeTsconfig(ADDON, sdk, !src);
    if (src) {
      const r = await B.bundle({ tl: tl(), addon: ADDON, bp: BP, sdkDir: sdk, mapDir: path.join(LAB, 'maps') });
      errs.push(...r.errs);
      REMAP = B.remapper(mapFile());
    }
    if (!errs.length && src && types) errs.push(...B.typecheck({ tl: tl(), addon: ADDON, cache: CACHE, js: false }));
    // plain JS (often someone else's, often minified): the uses of an API this version does not have come first, all of them;
    // the rest of what a type checker says about untyped JS is mostly noise: three and a count
    if (!errs.length && !src && jsTypes) {
      const all = B.typecheck({ tl: tl(), addon: ADDON, cache: CACHE, js: true, max: 400 }).filter((l) => !/^… \d+ more type errors/.test(l));
      const api = all.filter((l) => API_TS.test(l)), rest = all.filter((l) => !API_TS.test(l));
      hints.push(...api.slice(0, 12), ...rest.slice(0, 3));
      if (api.length > 12 || rest.length > 3) hints.push(`… ${Math.max(0, api.length - 12) + Math.max(0, rest.length - 3)} more type notes${api.length > 12 ? ` (${api.length - 12} of them uses of an API this version lacks: node lab.mjs brief lists them)` : ''}`);
    }
  } catch (e) {
    // no network, or no server to build with here (macOS without docker): build from the TypeScript already on this machine,
    // so the addon still loads and is type checked; the real check comes with verify
    const ts = src && /network|blocked|unreachable|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|E403|403|LAB_BDS_ZIP|npm i|docker` is not working|docker is not working|no BDS build/i.test(String(e.message)) ? B.localTs(CACHE) : null;
    if (ts) {
      const carry = B.carryLoad(CARRY, CACHE);
      const r = B.offlineBuild({ ts, addon: ADDON, bp: BP, realTypes: !!carry });
      errs.push(...r.errs); warns.push(...r.warns.slice(0, 20));
      if (carry && !r.errs.length && (src ? types : jsTypes)) { B.writeTsconfig(ADDON, carry.dir, !src); (src ? errs : hints).push(...B.typecheck({ tl: { ts }, addon: ADDON, cache: CACHE, js: !src })); }
      warns.push(carry ? `offline build (no network): types from carry/ (verified on BDS ${carry.meta.bds}); tests run where the network is open (node lab.mjs verify)` : 'offline build (no network): @minecraft/* types unchecked until the first verify brings them (carry/); verify where the network is open (node lab.mjs verify)');
    } else warns.push('build tools unavailable (' + String(e.message).split('\n')[0] + '): scripts not type checked' + (src ? '; no TypeScript on this machine either: write plain JS (new --js) or verify where the network is open' : ''));
  }
  return { errs, warns, hints };
}
let COMPONENTS = null, X_nearest = null, LAST_W = [];
async function preflight(opts = {}) {
  if (F.name === 'bds' && ADDON && path.dirname(ADDON) === ADDONS && !process.env.LAB_NO_KITSYNC) try {   // an unedited old kit → the newest (build.mjs kitStale; not in bisect/mutate runs)
    const k = B.kitStale(ADDON, BP, path.join(LIBDIR, 'kit'));
    if (k) { const id = (await import('./checkpoint.mjs')).save(F.name, path.basename(ADDON), 'before kit update'); fs.copyFileSync(k.from, k.file); out(`T kit: ${rel(k.file)} brought up to the newest kit (it was the lab's own copy no. ${k.was} of ${k.of}, unedited; back: node lab.mjs undo ${id})`); }
  } catch { /* never in the way of a build */ }
  const fx = F.preflight ? await F.preflight(L(), opts) : { errs: [], warns: [], hints: [] };
  if (ADDON && exists(path.join(BP, 'manifest.json'))) B.writeFeatureModule(ADDON, BP);   // features.json → bp/scripts/lab_features.js (plain JS)
  const b = await build(opts);
  b.errs.unshift(...fx.errs); b.warns.unshift(...fx.warns); b.hints.unshift(...(fx.hints ?? []));
  try { const x = await import('./extra.mjs'); COMPONENTS = x.componentSets(CACHE); X_nearest = x.nearest; } catch { COMPONENTS = null; }
  const { errs, warns } = b.errs.length || !exists(path.join(BP, 'manifest.json')) ? { errs: [], warns: [] } : lint();
  if (!b.errs.length && !errs.length) { await lintSchema(errs, warns); await lintModels(warns); await lintUiPack(warns); }
  // the script's own mistakes no type checker sees (addon-lint.mjs): top-level world calls (E), writes in before-events (W)
  if (F.name === 'bds' && ADDON) for (const [f, t] of scriptSources()) for (const r of lintScript(t)) if (r.kind !== 'review') (r.kind === 'early' ? errs : warns).push(`${path.relative(ADDON, f).split(path.sep).join('/')}:${r.line} ${r.msg}`);
  const E = [...b.errs, ...errs], W = [...b.warns, ...warns];
  const AH = await apiHintsFor(E);
  LAST_W = W.filter((w) => !/^(offline build|build tools unavailable)/.test(w));
  const TYPE_HINTS = [[/BlockStateSuperset|BlockStateArg/, "fix: a custom block state is not in the typings: kit getState(block,'ns:x') / setState(block,'ns:x',v)"], [/is not assignable to parameter of type 'ItemComponentTypeMap|keyof ItemComponentTypeMap/, "fix: custom item component names: kit onItem('ns:x', {...}) and \"ns:x\": {} in the item json"]];
  const hinted = new Set();
  E.forEach((e) => { out('E ' + e); if (AH.has(e) && !hinted.has(AH.get(e))) { hinted.add(AH.get(e)); out('  ' + AH.get(e)); } for (const [re, h] of TYPE_HINTS) if (re.test(e) && !hinted.has(h)) { hinted.add(h); out('  ' + h); } });
  W.slice(0, 20).forEach((e) => out('W ' + e));
  if (W.length > 20) out(`W ... +${W.length - 20}`);
  b.hints.slice(0, 15).forEach((e) => out('T ' + e));
  if (b.hints.length > 15) out(`T ... +${b.hints.length - 15}`);
  if (E.length) out('FAIL');
  return E.length === 0;
}

// the unit's own script sources (TypeScript in src/, else bp/scripts), not the kit, the lab's files or huge bundles
function scriptSources() {
  const d = exists(path.join(ADDON, 'src')) ? path.join(ADDON, 'src') : path.join(BP, 'scripts');
  return files(d, (f) => /\.[cm]?[jt]s$/.test(f) && !/\.d\.ts$|[\\/]kit\.[jt]s$|lab_features\.js$|[\\/]__lab|node_modules/.test(f)).filter((f) => fs.statSync(f).size < 300_000).map((f) => [f, fs.readFileSync(f, 'utf8')]);
}
// a type error about a Minecraft name answered from the declarations (api-hints.mjs): beta-only, on another class, the
// closest members with their signatures. The beta declarations come from npm (cached): offline, that part is left out
async function apiHintsFor(errs) {
  if (F.name !== 'bds' || !errs.some((e) => /TS(2339|2551|2305|2724|2614)\b/.test(e))) return new Map();
  try {
    const sdk = await sdkDir(), mods = ['server', 'server-ui'], rd = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
    const texts = mods.map((n) => rd(path.join(sdk, 'node_modules', '@minecraft', n, 'index.d.ts'))).filter(Boolean);
    let beta = null;
    if (!(readJson(path.join(BP, 'manifest.json')).dependencies ?? []).some((d) => /beta/.test(String(d.version)))) {
      try { const A = await import('./apidiff.mjs'); beta = []; for (const n of mods) { try { beta.push(await A.dtsOf(n, await A.versionFor(n, bdsVersion()))); } catch { /* that module */ } } } catch { beta = null; }
    }
    return (await import('./api-hints.mjs')).apiHints(errs, texts, beta?.length ? beta : null);
  } catch { return new Map(); }
}

// ---------- live server: BDS stays up between commands (up / do / reload / down) ----------
// `up` boots a detached lab process that owns one Engine and answers on 127.0.0.1; `do` sends commands to it.
// Script edits reach the running world with /reload (players stay); pack JSON edits restart it keeping the world, and
// real players rejoin by themselves. The server stops itself after LAB_LIVE_IDLE minutes (30) without a request.
const LIVE = path.join(LAB, 'live.json');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function liveInfo() { try { const j = JSON.parse(fs.readFileSync(LIVE, 'utf8')); return alive(j.pid) ? j : null; } catch { return null; } }
// a command that printed nothing is not echoed (saves tokens; the order of what did print is kept)
const fmtSegs = (segs) => segs.flatMap((s) => [...(s.cmd && s.cmd !== 'stop' && s.out.length ? ['> ' + s.cmd] : []), ...s.out]);
// long output: the head, every E line from the middle, then the tail (the end usually says what happened); LAB_MAX=n
function capLines(lines) {
  const MAX = Number(process.env.LAB_MAX) || 100;
  if (lines.length <= MAX) return lines;
  const head = Math.ceil(MAX * 0.6), tail = MAX - head, mid = lines.slice(head, lines.length - tail), errs = mid.filter((l) => l.startsWith('E '));
  return [...lines.slice(0, head), `... +${mid.length - errs.length} lines (LAB_MAX=${lines.length} shows all)`, ...errs, ...lines.slice(lines.length - tail)];
}
function printLines(lines) {
  capLines(lines).forEach((l) => out(l));
  return !lines.some((l) => l.startsWith('E '));
}
// newest change time of what the server loaded (src, packs)
const addonStamp = () => Math.max(0, ...[path.join(ADDON, 'src'), BP, RP, ...(F.stampDirs?.(L()) ?? [])].flatMap((d) => files(d, (f) => !/node_modules|__pycache__|\.pyc$/.test(f))).map((f) => fs.statSync(f).mtimeMs));

async function serve(args) {
  const o = parseArgs(args);
  const http = await import('node:http');
  await setup();
  const inst = await claim('live');
  const eng = new Engine(inst);
  const meta = { pid: process.pid, addon: path.basename(ADDON), inst: inst.name, loadedAt: addonStamp() };
  const write = (extra) => { Object.assign(meta, extra, { port: srvPort }); fs.writeFileSync(LIVE, JSON.stringify(meta)); };
  REMAP = B.remapper(mapFile());
  // the live server on Minecraft's own port when it is free: a person's server list entry (127.0.0.1 / this PC's address) keeps working
  if (!process.env.LAB_PORT && (await udpFree(19132)) && (await udpFree(19133))) process.env.LAB_PORT = '19132';
  await eng.start({ keep: o.keep, wait: o.wait, traces: o.traces });
  const bootLines = fmtSegs(render([eng.take(null)]));
  if (!eng.ok) { write({ ready: false, lines: [...bootLines, 'E world/addon did not load:', ...LOG.filter((l) => l.trim()).slice(-12)] }); await eng.stop(); inst.release(); return; }
  // TS REPL (a utility here): its TypeScript compiler loads now, not on the first `ts` (~5 s); its answer is never shown
  const tsr = path.basename(ADDON) === 'ts_repl' || utilityPacks(true).some((u) => u.name === 'ts_repl');
  // a person who joins from their own Minecraft (not one of the lab's clients) gets TS REPL as its owner, and its console item
  if (tsr) globalThis.__labOnSpawn = (n) => {
    if (eng.bots.has(n) || eng.joins.has(n) || !/^[^"\\]{1,32}$/.test(n)) return;
    for (const c of [`tag "${n}" add tsrepl.owner`, `tag "${n}" add tsrepl.admin`, `execute as "${n}" unless entity @s[hasitem={item=tsrepl:console}] run give @s tsrepl:console`,
      `tellraw "${n}" {"rawtext":[{"text":"§a[bds-lab]§r TS REPL はあなたのもの：コンソールのアイテムを使う（/function tsrepl_start でも）。PC では node lab.mjs ts watch で動きが見えます"}]}`]) eng.srv.send(c);
  };
  if (tsr) eng.srv.send('scriptevent tsrepl:ai {"id":"lab-warm","kind":"check","code":"0"}');
  let last = Date.now(), queue = Promise.resolve();
  const stopAll = async () => { await eng.stop(); inst.release(); try { fs.rmSync(LIVE); } catch { /* gone */ } process.exit(0); };
  const handle = async (route, body) => {
    last = Date.now();
    if (eng.srv?.exited) return { lines: ['E the live BDS exited (crash?): node lab.mjs up'], down: true };
    const segs = [];
    const pending = eng.take('(since last)');
    if (pending.lines.length) segs.push(pending);
    if (route === '/do') {
      for (const c of body.cmds) { const r = await eng.exec(c.replace(/^\//, ''), body.wait ?? 300); segs.push(eng.take(c)); if (r === false) break; }
    } else if (route === '/peek') {   // the server's lines from a reader's own mark, taking nothing from `do` (ts watch / hot / sync)
      const from = Math.max(0, Math.min(Number.isInteger(body.from) ? body.from : LOG.length, LOG.length));
      return { lines: fmtSegs(render([{ cmd: null, lines: LOG.slice(from) }])), mark: LOG.length };
    } else if (route === '/tsr') {   // TS REPL's bridge (common/ts.mjs): its console lines, then the «TSREPL» answer with that id
      const got = eng.srv.wait(new RegExp(`«TSREPL»\\{"id":"${String(body.id).replace(/[^\w-]/g, '')}"`), Math.min(120000, body.timeout ?? 40000));
      for (const c of body.cmds ?? []) eng.srv.send(c);
      const line = await got;
      segs.push(eng.take(null));
      write({});
      return { reply: line ? lineText(line) : null, lines: fmtSegs(render(segs)) };
    } else if (route === '/reload') {
      REMAP = B.remapper(mapFile());
      if (!body.full && packHash() === eng.packHash) {
        await writePacks(eng.world, eng.settings, true);
        const n = LOG.length;
        if (F.hotReload) await F.hotReload(L(), eng);   // plugin / mod reload in place (Endstone /reload, LeviLamina ll unload+load)
        else {
          eng.srv.send('reload');
          const ok = await eng.srv.wait(/LAB_JS_READY/, 30000);
          await sleep(300);
          LOG.splice(n, 0, `[0-0-0 0:0:0 BOT] reloaded scripts (addon changed)${ok ? '' : ': the addon script did not report back, see errors'}`);
        }
      } else {
        const bots = [...eng.joins];
        eng.closeBots();
        await eng.srv.stop();
        eng.packHash = await writePacks(eng.world, eng.settings, true);
        await eng.bootUp();
        LOG.push(`[0-0-0 0:0:0 BOT] restarted (pack files changed), world kept`);
        for (const [name, a] of eng.ok ? bots : []) { await eng.exec(`@${name} join ${a.join(' ')}`.trim(), 100); LOG.push(`[0-0-0 0:0:0 BOT] @${name} rejoined`); }
      }
      meta.loadedAt = body.stamp ?? Date.now();
      segs.push(eng.take(null));
    }
    write({});
    return { lines: fmtSegs(render(segs)) };
  };
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (d) => { data += d; });
    req.on('end', () => {
      queue = queue.then(async () => {
        let r;
        try { r = req.url === '/down' ? { lines: [] } : await handle(req.url, JSON.parse(data || '{}')); } catch (e) { r = { lines: ['E live: ' + (e?.stack ?? e)] }; }
        res.end(JSON.stringify(r));
        if (req.url === '/down' || r.down) setTimeout(stopAll, 50);
      });
    });
  });
  server.listen(0, '127.0.0.1', () => {
    write({ http: server.address().port, ready: true, lines: bootLines });
  });
  const idle = (Number(process.env.LAB_LIVE_IDLE) || 30) * 60000;
  // idle = no lab command for LAB_LIVE_IDLE minutes and nobody but the lab's own clients on it (a person playing keeps it up)
  setInterval(() => { if ([...ONLINE].some((n) => !eng.bots.has(n) && !eng.joins.has(n))) last = Date.now(); if (Date.now() - last > idle) queue = queue.then(stopAll); }, 10000).unref();
  process.on('SIGTERM', () => { queue = queue.then(stopAll); });
}
async function liveCall(route, body = {}) {
  const j = liveInfo();
  if (!j?.http) die('no live server: node lab.mjs up');
  const r = await fetch(`http://127.0.0.1:${j.http}${route}`, { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}
// where a person's Minecraft finds the live server: this PC, and its address on the local network (a phone, a console)
function joinAddr(port) {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  return `127.0.0.1:${port}${lan ? ` (LAN ${lan}:${port})` : ''}`;
}
async function up(args) {
  if (liveInfo()) await down(true);
  if (!(await preflight())) return false;
  fs.mkdirSync(LAB, { recursive: true });
  fs.rmSync(LIVE, { force: true });
  const log = fs.openSync(path.join(LAB, 'live.log'), 'w');
  const child = spawn(process.execPath, [process.argv[1], '__serve', ...args], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...(ADDON !== ROOT ? { LAB_ADDON: path.basename(ADDON) } : {}), LAB_NOTRACE: '1' }, cwd: process.cwd() });
  child.unref();
  for (let t = 0; t < 1800; t++) {
    await sleep(100);
    let j = null; try { j = JSON.parse(fs.readFileSync(LIVE, 'utf8')); } catch { /* not yet */ }
    if (j && (j.http || j.ready === false)) {
      const ok = printLines(j.lines) && j.ready;
      out(ok ? `OK live (${j.addon}): node lab.mjs do <cmd>... · code in it now, no /reload: node lab.mjs ts "<code>" · join it from your Minecraft: ${joinAddr(j.port)}` : j.ready ? 'FAIL (the live server is up: fix, then `do` reloads by itself)' : 'FAIL');
      return ok;
    }
    if (!alive(child.pid)) { out('E live server exited:\n' + fs.readFileSync(path.join(LAB, 'live.log'), 'utf8').slice(-1500)); return false; }
  }
  die('live server did not start in 180s (see .lab/live.log)');
}
async function reload(args, quiet) {
  const j = liveInfo();
  if (!j) die('no live server: node lab.mjs up');
  if (j.addon !== path.basename(ADDON)) die(`the live server runs ${j.addon}: node lab.mjs down, then up`);
  if (!(await preflight())) return false;
  const stamp = addonStamp();   // after the build: it rewrites bp/scripts, which must not count as a new edit next time
  const r = await liveCall('/reload', { full: args.includes('--full'), stamp });
  if (!quiet) out('> reload');
  return printLines(r.lines);
}
async function doCmd(args) {
  const o = parseArgs(args);
  const j = liveInfo();
  if (!j) die('no live server: node lab.mjs up (or use run)');
  if (j.addon !== path.basename(ADDON)) die(`the live server runs ${j.addon}: node lab.mjs down, then up`);
  let ok = true;
  // edited since the server loaded it: reload first (scripts -> /reload, other pack files -> restart keeping the world)
  if (addonStamp() > (j.loadedAt ?? 0)) { ok = await reload([], true); if (!ok) { out('FAIL'); return false; } }
  const r = await liveCall('/do', { cmds: o.rest, wait: o.wait });
  ok = printLines(r.lines) && ok;
  out(ok ? 'OK' : 'FAIL');
  return ok;
}
async function down(quiet) {
  const j = liveInfo();
  if (!j) { if (!quiet) out('OK (no live server)'); return true; }
  try { await liveCall('/down'); } catch { try { process.kill(j.pid); } catch { /* gone */ } }
  for (let t = 0; t < 200 && alive(j.pid); t++) await sleep(100);
  if (!quiet) out('OK down');
  return true;
}

async function run(args) {
  const o = parseArgs(args);
  if (!(await preflight())) return false;
  const { ready, segs, cov } = await session(o.rest.map((c) => c.replace(/^\//, '')), o);
  const all = fmtSegs(segs);
  const bad = !ready || all.some((l) => l.startsWith('E '));
  capLines(all).forEach((l) => out(l));
  if (o.verbose) for (const l of LOG) { const t = l.replace(/^\[[\d-]+ [\d:]+ /, '[').trim(); if (t && !/LAB_|TELEMETRY|telemetry|=====/.test(t)) out('| ' + t); }
  if (!ready) out('E world/addon did not load:\n' + LOG.filter((l) => l.trim()).slice(-12).join('\n'));
  if (cov) out(cov);
  out(bad ? 'FAIL' : 'OK');
  return !bad;
}

// tests.txt: a command line, then expectations for its output:  = exact line | ~ regex | ! absent substring
// test on other BDS versions (servers lag behind releases): `test --bds 1.26.45.1,1.26.36.1` or `test --matrix` (the newest build of the
// current and the two previous minor families). Each version gets its own cache under .lab/v/<ver> (server, world, protocol data);
// version-free caches (build tools, types, samples) are shared by link.
function bdsFamilies() {
  const list = knownBds()?.[WIN ? 'windows' : 'linux']?.versions ?? [], fam = (v) => v.split('.').slice(0, 2).join('.') + '.' + Math.floor(Number(v.split('.')[2]) / 10);
  const by = new Map(); for (const v of list) by.set(fam(v), v);   // the list is oldest first: the last build of each family wins
  return [...by.values()].reverse();
}
async function testVersions(args, spec) {
  if (F.matrix === false) die(`test --bds/--matrix: bds lab only (${F.title} pins the server its loader supports; see: node lab.mjs server)`);
  const cur = (await ensureBds(), bdsVersion());
  const vers = spec === 'matrix' ? [cur, ...bdsFamilies().filter((v) => vcmp3(v, cur) < 0).slice(0, 2)] : spec.split(',').map((x) => x.trim()).filter(Boolean);
  const bad = vers.filter((v) => !/^\d+\.\d+\.\d+\.\d+$/.test(v));
  if (bad.length) die(`--bds wants full BDS versions (e.g. 1.26.45.1), not ${bad.join(' ')}. Known: node lab.mjs bds --list`);
  const rows = [];
  for (const v of vers) {
    let env = { ...process.env };
    if (v !== cur) {
      const vc = path.join(CACHE, 'v', v);
      fs.mkdirSync(vc, { recursive: true });
      for (const d of ['tool', 'sdk', 'samples', 'mct', 'meta', 'proto', 'schemas', 'examples', 'mcbe-ui', 'tsinfo']) {
        const s = path.join(CACHE, d), t = path.join(vc, d);
        if (exists(s) && !exists(t)) try { fs.symlinkSync(s, t, WIN ? 'junction' : 'dir'); } catch { /* shared cache is an optimisation */ }
      }
      env = { ...env, LAB_CACHE: vc, LAB_BDS_VERSION: v, LAB_NO_VENDOR: '1' };
    }
    out(`== BDS ${v}${v === cur ? ' (current)' : ''}`);
    const r = spawnSync(process.execPath, [process.argv[1], 'test', ...args, ...(ADDON_ARG ? ['-a', ADDON_ARG] : [])], { cwd: process.cwd(), env, encoding: 'utf8', maxBuffer: 256e6 });
    const lines = (r.stdout + r.stderr).trim().split('\n');
    const last = lines.filter((l) => /^(PASS|FAIL|OK|ERR)\b/.test(l)).at(-1) ?? lines.at(-1) ?? 'no output';
    const eIdx = lines.map((l, i) => (/^(E |ERR )/.test(l) ? i : -1)).filter((i) => i >= 0).slice(0, 4);
    const errs = [...eIdx.flatMap((i) => [lines[i], ...lines.slice(i + 1, i + 3).filter((l) => /^  \S/.test(l) && !/^  want/.test(l))]), ...lines.filter((l) => /^(✘|  want)/.test(l)).slice(0, 4)];
    errs.forEach((l) => out(l)); out(last);
    rows.push(`${v} ${/^PASS/.test(last) ? 'PASS' : 'FAIL'}`);
  }
  out(`matrix: ${rows.join(' | ')}`);
  const okAll = rows.every((x) => x.endsWith('PASS'));
  out(okAll ? 'PASS' : 'FAIL');
  return okAll;
}
// ---------- tests.lock: sections an independent AI (the playtester) found; the builder fixes the addon, never these ----------
// tests.txt sections: [{ title, body: significant lines (trimmed; no blanks or comments), start, end (line indexes) }]
function sectionsOf(file) {
  const secs = [];
  let cur = null;
  (exists(file) ? fs.readFileSync(file, 'utf8') : '').split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (l.startsWith('## ')) { cur = { title: l.slice(3).trim(), body: [], start: i, end: i }; secs.push(cur); return; }
    if (!cur) return;
    if (l && !l.startsWith('#')) { cur.body.push(l); cur.end = i; }
  });
  return secs;
}
const lockFile = (dir = ADDON) => path.join(dir, 'tests.lock');
const LOCK_HEAD = '# tests.lock: sections the playtester (another AI) found failing. Make the addon pass them; never edit or remove them here or in tests.txt.\n# One that asks for something the request does not want: node lab.mjs dispute "<title>" "<why>" (the person reads it).\n';
function writeLock(secs, dir = ADDON) {
  if (!secs.length) { fs.rmSync(lockFile(dir), { force: true }); return; }
  fs.writeFileSync(lockFile(dir), LOCK_HEAD + secs.map((x) => `## ${x.title}\n${x.body.join('\n')}\n`).join(''));
}
function lockProblems(file) {
  const locked = sectionsOf(lockFile(path.dirname(file)));
  if (!locked.length) return [];
  const secs = sectionsOf(file), probs = [];
  for (const e of locked) {
    const x = secs.find((q) => q.title === e.title);
    if (!x) probs.push(`E tests.lock: "## ${e.title}" is gone from tests.txt: copy it back from tests.lock (fix the addon; or node lab.mjs dispute "${e.title}" "<why>")`);
    else if (x.body.join('\n') !== e.body.join('\n')) probs.push(`E tests.lock: "## ${e.title}" was changed: put it back as tests.lock has it (fix the addon, not the test)`);
  }
  return probs;
}
// dispute "<title>" "<why>": a locked section that asks for what the request does not want leaves tests.txt, with the reason in TASK.md
function dispute(args) {
  const [title, ...why] = args, reason = why.join(' ').trim();
  if (!title || !reason) die('usage: node lab.mjs dispute "<section title>" "<why the request does not want it>"');
  const locked = sectionsOf(lockFile()), e = locked.find((q) => q.title === title || q.title === title.replace(/^## /, ''));
  if (!e) die(`not in tests.lock: "${title}" (locked: ${locked.map((q) => `"${q.title}"`).join(' ') || 'none'})`);
  const tf = path.join(ADDON, 'tests.txt'), lines = fs.readFileSync(tf, 'utf8').split(/\r?\n/), x = sectionsOf(tf).find((q) => q.title === e.title);
  if (x) { let end = x.end; while (end + 1 < lines.length && !lines[end + 1].trim().startsWith('## ') && !lines[end + 1].trim()) end++; lines.splice(x.start, end - x.start + 1); fs.writeFileSync(tf, lines.join('\n')); }
  writeLock(locked.filter((q) => q !== e));
  fs.appendFileSync(path.join(ADDON, 'tests.disputed'), `## ${e.title}\n# disputed: ${reason}\n${e.body.join('\n')}\n`);
  const tm = path.join(ADDON, 'TASK.md'); let t = exists(tm) ? fs.readFileSync(tm, 'utf8') : '';
  if (!/^## Disputed/m.test(t)) t = t.trimEnd() + '\n\n## Disputed (the playtester and the builder disagree: a person decides; the tests are in tests.disputed)\n';
  fs.writeFileSync(tm, t.trimEnd() + `\n- "${e.title}": ${reason}\n`);
  out(`OK disputed "${e.title}": out of tests.txt and tests.lock, reason in TASK.md (## Disputed), the test kept in tests.disputed`);
}
// unlock "<title>"|--all: for a person at a terminal (an agent's shell has no TTY): the section stays as an ordinary test
function unlockCmd(args) {
  if (!process.stdin.isTTY && !process.env.LAB_UNLOCK_OK) die('unlock is for a person at a terminal. An AI fixes the addon, or: node lab.mjs dispute "<title>" "<why>"');
  const locked = sectionsOf(lockFile()), keep = args.includes('--all') ? [] : locked.filter((q) => !args.includes(q.title));
  writeLock(keep);
  out(`OK unlocked ${locked.length - keep.length} section(s); ${keep.length} still locked`);
}

async function test(args, { built = false } = {}) {
  const bi = args.findIndex((a) => a === '--bds' || a === '--matrix');
  if (bi >= 0) { const spec = args[bi] === '--matrix' ? 'matrix' : args[bi + 1]; return testVersions(args.filter((_, i) => i !== bi && !(args[bi] === '--bds' && i === bi + 1)), spec); }
  const o = parseArgs(args);
  // a file given: from where the person ran the lab (lab.mjs moved into the lab's folder), then the lab, then the unit
  const file = o.rest[0] ? [path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), o.rest[0]), path.resolve(o.rest[0]), path.resolve(ADDON, o.rest[0])].find(exists) ?? path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), o.rest[0]) : path.join(ADDON, 'tests.txt');
  if (!exists(file)) die(`${rel(file)} not found`);
  const locks = path.resolve(file) === path.join(ADDON, 'tests.txt') ? lockProblems(file) : [];
  if (locks.length) { locks.forEach((l) => out(l)); out('FAIL tests.lock'); return false; }
  const lint = F.name === 'bds' ? lintTests(file, rel(file)) : [];   // (end/ll tests have py/lse lines and their own actions)
  if (lint.length) { lint.slice(0, 12).forEach((l) => out('E ' + l)); out(`FAIL tests.txt (${lint.length}: fixed before any server starts)`); return false; }
  if (!built && !(await preflight())) return false;
  // `## title` starts a section: its expectations see everything printed since the section began
  const steps = [];
  let sec = null, skipping = false;
  // sections of a feature switched off in features.json (maintain's limited mode) are not run: the unit works without them
  const fj = B.features(ADDON), offSec = new Map();
  for (const [n, why] of Object.entries(fj?.off ?? {})) for (const t of fj.features?.[n]?.tests ?? []) offSec.set(t, `${n}${why && why !== true ? ': ' + String(why).slice(0, 80) : ''}`);
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (l.startsWith('## ')) { skipping = offSec.has(l.slice(3)); if (skipping) { out(`SKIP ## ${l.slice(3)} (feature off: ${offSec.get(l.slice(3))})`); return; } sec = { title: l.slice(3), from: steps.length }; return; }
    if (skipping) return;
    if (!l || l.startsWith('#')) return;
    const m = /^(!~|[=~!])\s?(.*)$/.exec(l);
    // code over several lines: lines indented by 2+ spaces continue a `py` / `lse` / `js` line (py and lse keep the rest of the indent)
    const last = steps.at(-1);
    if (!m && /^\s{2,}\S/.test(raw) && last && !last.exp.length && (!sec || steps.length > sec.from) && /^(py|lse|js) /.test(last.cmd)) { last.cmd += /^js /.test(last.cmd) ? ' ' + l : '\\n' + raw.replace(/^ {2}|^\t/, ''); return; }
    if (m) { if (!steps.length || (sec && steps.length === sec.from)) die(`${rel(file)}:${i + 1}: expectation before any command`); steps.at(-1).exp.push({ op: m[1], v: m[2], line: i + 1 }); } else steps.push({ cmd: l.replace(/^\//, ''), exp: [], sec });
  });
  // a regex that does not compile fails here, before a server starts (it used to stop the run after the boot, ~1 min later)
  for (const s of steps) for (const e of s.exp) if (e.op === '~' || e.op === '!~') try { rx(e.v); } catch (x) { die(`${rel(file)}:${e.line}: ${x.message} (a JavaScript regex, one line at a time: no (?s) or other inline flags but a leading (?i); for an order across lines check it in a js/py line)`); }
  const { ready, segs } = await session(steps.map((s) => s.cmd), { ...o, cov: false });
  if (process.env.LAB_DUMP) fs.writeFileSync(process.env.LAB_DUMP, segs.map((g) => [`> ${g.cmd}`, ...g.out].join('\n')).join('\n') + '\n');
  if (!ready) { out('E world/addon did not load:\n' + LOG.filter((l) => l.trim()).slice(-12).join('\n') + '\nFAIL'); return false; }
  let pass = 0, total = 0;
  const fails = [];
  const matched = new Set(), secBad = new Set(), secWhy = new Map();   // why a section failed: an expectation, or an E line and its command
  const why = (t, w) => { secBad.add(t); (secWhy.get(t) ?? secWhy.set(t, []).get(t)).push(w); };
  steps.forEach((s, k) => {
    // expectations under a query (js / py / lse) check its value only: `js inv(p('B'))` then `js inv(p('A'))` + `!~ diamond`
    // must not see B's line (a section-wide check there can never pass, or passes on the wrong player's line)
    // (an expectation about what a player saw, `~ @A ...`, still looks at the whole section)
    const query = /^(js|py|lse) /.test(s.cmd);
    const from = s.sec ? s.sec.from : k;
    const all = [];   // [segment index, line index, text]; a section at the very start also sees the boot output
    if (s.sec && from === 0) (segs[0]?.out ?? []).forEach((g, j) => all.push([0, j, g]));
    for (let q = from; q <= k; q++) (segs[q + 1]?.out ?? []).forEach((g, j) => all.push([q + 1, j, g]));
    const mine = all.filter(([q]) => q === k + 1);
    for (const e of s.exp) {
      const got = query && !/^\^?@/.test(e.v) ? mine : all;
      total++;
      let re = null;
      if (e.op !== '=' && e.op !== '!') try { re = rx(e.v); } catch (x) { die(`${rel(file)}:${e.line}: ${x.message}`); }
      const hit = got.filter(([, , g]) => (e.op === '=' ? g === e.v : e.op === '!' ? g.includes(e.v) : re.test(g)));
      const ok = e.op === '!' || e.op === '!~' ? !hit.length : hit.length > 0;
      if (ok && hit.length) matched.add(`${hit[0][0]}:${hit[0][1]}`);
      if (ok) { pass++; if (process.env.LAB_SHOWMATCH) out(`✔ ${e.line}: ${hit[0]?.[2] ?? ''}`); continue; }
      // show the lines that matter: offending ones for absence checks, same-prefix lines for misses
      const key = /^\^?(\w+ [\w.:]+)/.exec(e.v)?.[1];
      const near = e.op.startsWith('!') ? hit : key ? got.filter(([, , g]) => g.startsWith(key)) : [];
      const own = got.filter(([q]) => q === k + 1), pool = near.length ? near : [...own, ...got.filter(([q]) => q !== k + 1)];   // this command's own output first
      const show = squeeze(pool.map(([, , g]) => g)).slice(0, 6);
      if (s.sec) why(s.sec.title, `expect ${e.op} ${e.v}`);
      const lm = literalMiss(e.op, e.v, got.map(([, , g]) => g));
      fails.push(`✘ ${e.line}: ${s.sec ? '## ' + s.sec.title + ' > ' : ''}${s.cmd}\n  want ${e.op} ${e.v}\n  got ${show.length ? show.join(' | ') : '(nothing)'}${lm ? `\n  note: ${lm}` : ''}`);
    }
  });
  // a failure exactly as in the last run (the unit changed in between) is one line: its want/got is already in the reader's
  // context, and one concrete case (the first) is always shown whole
  // (only a recent run the same reader saw: not across sessions, not the lab's own internal runs: LAB_NO_LASTFAIL)
  const last = (() => { try { return readJson(path.join(LAB, 'last-fail', path.basename(ADDON) + '.json')); } catch { return null; } })();
  const prevBlocks = new Set(last && Date.now() - (last.t ?? 0) < 20 * 60_000 && !process.env.LAB_NO_LASTFAIL && !NO_LASTFAIL ? last.blocks ?? [] : []);
  const printed = fails.map((f, i) => (i > 0 && prevBlocks.has(f) ? `${f.split('\n')[0]} (unchanged since the last run)` : f));
  printed.forEach((f) => out(f));
  const seen = printed.join('\n');   // (a fix line a ✘ block above already showed is not repeated under its E line)
  const errs = [];
  // an unexpected E, with its detail lines (the reason, a fix hint) that follow it indented
  segs.forEach((s, k) => s.out.forEach((l, j) => { if (l.startsWith('E ') && !matched.has(`${k}:${j}`)) { if (steps[k - 1]?.sec) why(steps[k - 1].sec.title, `${l} @@ ${s.cmd}`); const more = []; for (let i = j + 1; i < s.out.length && /^  \S/.test(s.out[i]) && more.length < 3; i++) more.push(s.out[i]); errs.push(l + (s.cmd && s.cmd !== 'stop' ? `   (during: ${s.cmd})` : s.cmd === null ? '   (during: boot)' : '') + (more.length ? '\n' + more.join('\n') : '')); } }));
  // the same error from several commands (a loop, every player) is one line with a count: fewer lines to read, same facts
  const grouped = new Map();
  for (const l of errs) { const [head, ...more] = l.split('\n'), m = /^(.*?)   \(during: (.*)\)$/.exec(head), key = (m ? m[1] : head) + '\n' + more.join('\n'); const g = grouped.get(key) ?? grouped.set(key, { dur: [], more }).get(key); if (m) g.dur.push(m[2]); }
  [...grouped].slice(0, 10).forEach(([key, g]) => { const msg = key.split('\n')[0]; out(`${msg}${g.dur.length > 1 ? ` ×${g.dur.length}` : ''}${g.dur.length ? `   (during: ${[...new Set(g.dur)].slice(0, 3).join(', ')}${new Set(g.dur).size > 3 ? ', …' : ''})` : ''}${g.more.filter((x) => !seen.includes(x.trim())).length ? '\n' + g.more.filter((x) => !seen.includes(x.trim())).join('\n') : ''}`); });
  // code lines taken for commands: `py` / `lse` code is one line (\n between statements) or continues on lines indented by 2 spaces
  if (errs.some((l) => /Unknown command: (return|try:|except|import|from|for|if|def|with|print|else:|elif|const|let|await)\b/.test(l))) out('  hint: a py/lse line of code is one line (\\n between statements), or continues on the lines below indented by 2 spaces');
  // the usual Script API runtime errors and what fixes them (saves the reading and guessing an AI would do)
  for (const [re, h] of RUNTIME_HINTS) if (errs.some((l) => re.test(l.split('\n')[0]) && !/\n  fix: /.test(l))) out('  hint: ' + h);   // (not where the lab already said a fix)
  // an `until` is a check too (its pattern must appear, or an E line says it did not): counted, so a test of `until`s does
  // not read "0/0"; and a tests.txt that checks nothing at all fails (it passed vacuously and made `go` say DONE)
  steps.forEach((s, k) => { if (/^until\s+\S/.test(s.cmd)) { total++; if (!(segs[k + 1]?.out ?? []).some((l) => /^E until:/.test(l))) pass++; } });
  if (!total && steps.length) for (const m of ['E tests.txt checks nothing: no `= ~ ! !~` line and no `until` (a test that cannot fail proves nothing): under each command add `~ <regex>` for what the request wants']) { out(m); errs.push(m); }
  const ok = pass === total && !errs.length;
  sameAsLast(ok, [...secBad].sort().join('|') + '#' + errs.map((l) => l.split('\n')[0].replace(/\d+ms|\d+(\.\d+)? ?s\b/g, '')).sort().join('|'), file, fails, [...secBad], errs);
  if (process.env.LAB_SECTIONS) for (const t of new Set(steps.filter((q) => q.sec).map((q) => q.sec.title))) { out(`SECTION ${secBad.has(t) ? 'FAIL' : 'PASS'} ${t}`); for (const w of (secWhy.get(t) ?? []).slice(0, 4)) out(`SECTION WHY ${t} :: ${w}`); }
  if (!NO_LASTFAIL) try {   // (not the lab's own try of the stable modules: status shows the go a person ran)
    const rj = JSON.stringify({ addon: path.basename(ADDON), file: rel(file), bds: bdsVersion(), pass, total, errors: errs.length, ok, at: new Date().toISOString() });
    fs.mkdirSync(path.join(LAB, 'reports'), { recursive: true }); fs.writeFileSync(path.join(LAB, 'report.json'), rj);
    if (path.resolve(file) === path.join(ADDON, 'tests.txt')) fs.writeFileSync(path.join(LAB, 'reports', path.basename(ADDON) + '.json'), rj);   // each unit's last result (ui)
  } catch { /* report is best-effort */ }
  // coverage is a second pass: its pauses change timing, so it never decides PASS/FAIL
  if (o.cov) { LOG.length = 0; const c = await session(steps.map((q) => q.cmd), o); out(c.cov); }
  // progress: the sections that failed in the last run (the same reader, 20 minutes) and pass now, so a fix is seen to work
  const titles = new Set(steps.filter((q) => q.sec).map((q) => q.sec.title)), recent = last && Date.now() - (last.t ?? 0) < 20 * 60_000 && !process.env.LAB_NO_LASTFAIL && !NO_LASTFAIL && path.resolve(file) === path.join(ADDON, 'tests.txt');
  const fixed = recent ? (last.secs ?? []).filter((t) => titles.has(t) && !secBad.has(t)) : [];
  if (fixed.length) out(`fixed since the last run: ${fixed.map((t) => `"${t}"`).join(', ')}${secBad.size ? ` (${secBad.size} section${secBad.size > 1 ? 's' : ''} still failing)` : ''}`);
  out(`${ok ? 'PASS' : 'FAIL'} ${pass}/${total}${errs.length ? ` errors=${errs.length}` : ''}`);
  return ok;
}


// the same failures as the run before, with the unit changed in between: the change did not reach them. Said in one line
// so an AI stops repeating the same kind of edit (the commonest waste of tokens) and looks elsewhere
let NO_LASTFAIL = false;   // (set while go tries the stable modules: that run is the lab's own, nobody reads it)
// got lines: one line repeated (an actionbar every second, a timer) is said once with its count, after the lines that differ,
// so it does not push the line that matters out of view
export function squeeze(lines) {
  const n = new Map(); for (const l of lines) n.set(l, (n.get(l) ?? 0) + 1);
  const seen = new Set(), once = [], many = [];
  for (const l of lines) { if (seen.has(l)) continue; seen.add(l); (n.get(l) >= 3 ? many : once).push(n.get(l) > 1 ? `${l} ×${n.get(l)}` : l); }
  return [...once, ...many];
}
function sameAsLast(ok, sig, file, blocks = [], secs = [], errs = []) {
  if (process.env.LAB_NO_LASTFAIL || NO_LASTFAIL) return;
  try {
    const f = path.join(LAB, 'last-fail', path.basename(ADDON) + '.json'); let prev = null; try { prev = readJson(f); } catch { /* none */ }
    if (path.resolve(file) !== path.join(ADDON, 'tests.txt')) { fs.rmSync(f, { force: true }); return; }
    const h = crypto.createHash('sha1'), gen = B.entryOf(ADDON) ? path.join(BP, 'scripts') : null;
    for (const d of [path.join(ADDON, 'src'), BP, RP]) for (const x of files(d, (y) => !/node_modules|__pycache__|\.pyc$/.test(y) && !(gen && y.startsWith(gen)))) h.update(x).update(fs.readFileSync(x));
    const stamp = h.digest('hex');   // the unit's own files (not the build output): did the AI change anything since?
    // an episode (skills learn from these, no tokens): failures of the run before that the edit since then made go away,
    // with the fix/hint lines the lab printed for them
    const items = (bl, er) => [...(bl ?? []).map((b) => ({ sig: b.split('\n').slice(0, 2).map((x) => x.trim()).join(' / ').replace(/ \(unchanged since the last run\)$/, ''), hints: [] })),
      ...(er ?? []).map((e) => { const [head, ...more] = String(e).split('\n'); return { sig: head.replace(/\s+\(during: .*\)$/, ''), hints: more.map((x) => x.trim()).filter((x) => /^(fix|hint):/.test(x)) }; })];
    if (prev && prev.stamp !== stamp) {
      const now = new Set(items(blocks, errs).map((x) => x.sig)), fixed = items(prev.blocks, prev.errs).filter((x) => !now.has(x.sig));
      if (fixed.length) fs.appendFileSync(path.join(LAB, 'episodes.jsonl'), JSON.stringify({ at: new Date().toISOString(), unit: path.basename(ADDON), fixed: fixed.slice(0, 12), ok: !!ok }) + '\n');
    }
    if (ok) { fs.rmSync(f, { force: true }); return; }
    const n = prev && prev.sig === sig && prev.stamp !== stamp ? prev.n + 1 : 1;
    if (n >= 2) out(`SAME failures as the last ${n - 1 === 1 ? 'run' : n - 1 + ' runs'}, though the unit changed: the edit did not touch the cause. Read the first ✘/E line again; look the API up (api <Class>) instead of guessing; trace src/<file>:<line> shows the values there`);
    writeJson(f, { sig, stamp, n, blocks: blocks.slice(0, 30), errs: errs.slice(0, 20), secs, t: Date.now() });   // (secs: why / shrink start from the first)
  } catch { /* best-effort */ }
}
// ---------- quality: qa (what players would hit that tests.txt did not ask) and go (check+test+qa+pack) ----------
// Q = fails `go` (a player would see it), S = suggestion. Budgets measured on BDS 1.26.52 with an empty addon: script_tick 0.3 ms.
const QA_BUDGET = { avg: Number(process.env.LAB_QA_TICK_MS) || 2, spam: 8 };
function qaStatic() {
  const q = [], srcDir = exists(path.join(ADDON, 'src')) ? path.join(ADDON, 'src') : path.join(BP, 'scripts');
  const src = files(srcDir, (f) => /\.[cm]?[jt]s$/.test(f) && !/kit\.[jt]s$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const safe = (f) => { try { return readJson(f); } catch { return null; } };
  // every language the pack lists has every key the others have
  const langs = safe(path.join(RP, 'texts', 'languages.json'));
  if (Array.isArray(langs) && langs.length > 1) {
    const keys = Object.fromEntries(langs.map((l) => { const f = path.join(RP, 'texts', l + '.lang'); return [l, new Set(exists(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).map((x) => x.split('=')[0].trim()).filter((k) => k && !k.startsWith('#')) : [])]; }));
    const all = new Set(Object.values(keys).flatMap((x) => [...x]));
    for (const l of langs) { const miss = [...all].filter((k) => !keys[l].has(k)); if (miss.length) q.push(['Q', `rp/texts/${l}.lang lacks ${miss.slice(0, 4).join(' ')}${miss.length > 4 ? ` +${miss.length - 4}` : ''} (players with that language see the raw key): node lab.mjs i18n`]); }
  }
  // custom components: used in JSON <-> registered in scripts
  for (const [dir, key] of [['items', 'minecraft:item'], ['blocks', 'minecraft:block']]) for (const f of files(path.join(BP, dir), (x) => x.endsWith('.json'))) {
    const j = safe(f), d = j?.[key]; if (!d) continue;
    const custom = Object.keys(d.components ?? {}).filter((k) => /^[a-z0-9_]+:/.test(k) && !k.startsWith('minecraft:'));
    for (const c of [...custom, ...(d.components?.['minecraft:custom_components'] ?? [])]) if (!src.includes(`'${c}'`) && !src.includes(`"${c}"`)) q.push(['Q', `${rel(f)}: custom component ${c} is never registered (onItem/onBlock('${c}', ...)): it does nothing`]);
    if (custom.length && String(j.format_version ?? '0') < '1.21.90') q.push(['Q', `${rel(f)}: custom components in "components" need format_version 1.21.90+`]);
  }
  // loot: the table a definition names exists, and every custom item it drops is defined here
  const defined = new Set([['items', 'minecraft:item'], ['blocks', 'minecraft:block']].flatMap(([d, k]) => files(path.join(BP, d), (x) => x.endsWith('.json')).map((f) => safe(f)?.[k]?.description?.identifier).filter(Boolean)));
  for (const [dir, key] of [['entities', 'minecraft:entity'], ['blocks', 'minecraft:block']]) for (const f of files(path.join(BP, dir), (x) => x.endsWith('.json'))) {
    const d = safe(f)?.[key]; if (!d) continue;
    for (const g of [d.components ?? {}, ...Object.values(d.component_groups ?? {})]) {
      const t = g['minecraft:loot']?.table; if (!t) continue;
      const lt = safe(path.join(BP, t));
      if (!lt) { q.push(['Q', `${rel(f)}: loot table ${t} is missing: nothing drops`]); continue; }
      for (const n of JSON.stringify(lt).match(/"name":"([a-z0-9_]+:[a-z0-9_]+)"/g) ?? []) { const id = n.slice(8, -1); if (!id.startsWith('minecraft:') && !defined.has(id)) q.push(['Q', `${t}: drops ${id}, which this addon does not define`]); }
    }
  }
  // acceptance lines in TASK.md each have a tests.txt section
  const task = exists(path.join(ADDON, 'TASK.md')) ? fs.readFileSync(path.join(ADDON, 'TASK.md'), 'utf8') : '';
  const acc = (task.split(/^## Acceptance.*$/m)[1] ?? '').split(/^## /m)[0].split('\n').filter((l) => /^- \[[ x]\] \S/.test(l)).length;
  const tt = exists(path.join(ADDON, 'tests.txt')) ? fs.readFileSync(path.join(ADDON, 'tests.txt'), 'utf8') : '';
  const secs = (tt.match(/^## /gm) ?? []).length;
  if (acc > secs) q.push(['Q', `TASK.md has ${acc} acceptance lines but tests.txt only ${secs} sections: test each one`]);
  if (!/^@\w+ /m.test(tt)) q.push(['S', 'tests.txt never uses a real player (@A join, @A cmd /..., @A form 0): players are what break addons']);
  // what the unit adds that no test ever touches: its own commands, items, blocks and entities (an untested one can be broken unseen)
  const cmds = [...new Set([...src.matchAll(/\bcmd(?:Any)?\(\s*['"]([\w-]+:[\w-]+)['"]/g)].map((x) => x[1]))];
  const ids = [['items', 'minecraft:item'], ['blocks', 'minecraft:block'], ['entities', 'minecraft:entity']].flatMap(([d, k]) => files(path.join(BP, d), (x) => x.endsWith('.json')).map((f) => safe(f)?.[k]?.description?.identifier).filter(Boolean));
  const untested = [...cmds.filter((c) => !tt.includes(c)).map((c) => '/' + c), ...ids.filter((i) => !tt.includes(i))];
  if (untested.length) q.push(['S', `no test touches ${untested.slice(0, 6).join(' ')}${untested.length > 6 ? ` +${untested.length - 6}` : ''}: add a section that uses it (e.g. @A cmd /x, give A <id>, summon <id>)`]);
  // what usually goes wrong in addons and no test sees soon (addon-lint.mjs review): one line per kind, with where
  if (F.name === 'bds') { const g = new Map(); for (const [f, t] of scriptSources()) for (const r of lintScript(t)) if (r.kind === 'review') (g.get(r.msg) ?? g.set(r.msg, []).get(r.msg)).push(`${path.relative(ADDON, f).split(path.sep).join('/')}:${r.line}`); for (const [msg, at] of [...g].slice(0, 4)) q.push(['S', `${at.slice(0, 4).join(' ')}${at.length > 4 ? ` +${at.length - 4}` : ''} ${msg}`]); }
  // a command built from a player's name or text (scan.mjs): a name with a space, or "@a" typed into a form, changes what runs
  for (const f of files(srcDir, (x) => /\.[cm]?[jt]s$/.test(x) && !/kit\.[jt]s$/.test(x))) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { const inj = commandInjection(l); if (inj) q.push(['S', `${rel(f)}:${i + 1} ${inj[1]}`]); });
  let m = null; try { m = readJson(path.join(BP, 'manifest.json')); } catch { /* lint reports it */ }
  if (m && (!m.header.description || m.header.description === m.header.name)) q.push(['S', 'bp/manifest.json: header.description = the name: say what the addon does (players see it)']);
  // plugins and mods too: the description is what server owners read in plugin lists
  const pyp = path.join(ADDON, 'pyproject.toml'), llm = safe(path.join(ADDON, 'manifest.json'));
  if (exists(pyp)) { const t = fs.readFileSync(pyp, 'utf8'), d = /^description\s*=\s*"(.*)"/m.exec(t)?.[1] ?? ''; if (!/\s/.test(d)) q.push(['S', 'pyproject.toml: description is only a name: say what the plugin does']); }
  if (llm?.entry && !/\s/.test(llm.description ?? '')) q.push(['S', 'manifest.json: description is only a name: say what the mod does']);
  return q;
}
function fuzzCalls() {
  const dir = exists(path.join(ADDON, 'src')) ? path.join(ADDON, 'src') : path.join(BP, 'scripts');
  const src = files(dir, (f) => /\.[cm]?[jt]s$/.test(f) && !/kit\.[jt]s$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const V = { int: ['0', '-1', '2147483647'], float: ['0', '-1', '1e9'], string: ['""', `"${'x'.repeat(300)}"`, '"@\\u00a7"'], bool: ['false', 'true', 'false'],
    player: ['@s', 'Nobody', '@a'], entity: ['@s', '@e[type=pig]', '@e'], loc: ['~ ~ ~', '0 320 0', '0 -64 0'], item: ['air', 'diamond', 'barrier'], block: ['air', 'stone', 'bedrock'] };
  const calls = [];
  for (const m of src.matchAll(/\bcmd(?:Any)?\(\s*['"]([\w-]+:[\w-]+)['"]\s*,\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*\{([^}]*)\}/g)) {
    const ps = [...m[2].matchAll(/(['"]?)(\w+)(\??)\1\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)].map((x) => ({ opt: !!x[3], t: x[4] }));
    const need = ps.filter((x) => !x.opt), all = [...need, ...ps.filter((x) => x.opt)];   // kit orders mandatory first
    const val = (x, k) => (x.t.startsWith('[') ? ([...x.t.matchAll(/['"]([^'"]*)['"]/g)].map((y) => y[1])[k === 2 ? 1 : 0] ?? '') : V[x.t.slice(1, -1)]?.[k] ?? '0');
    if (!ps.every((x) => x.t.startsWith('[') || V[x.t.slice(1, -1)])) continue;
    for (let k = 0; k < 3; k++) calls.push([m[1], (k === 2 ? all : need).map((x) => val(x, k)).join(' ')]);
  }
  return [...new Map(calls.map((c) => [c.join(" "), c])).values()].slice(0, 12);
}
async function qa({ quiet = false, built = false } = {}) {
  if (!built && !(await preflight())) return { ok: false, q: [] };
  if (built) REMAP = B.remapper(mapFile());   // (go runs QA in its own process after building: errors name src/ lines there too)
  const q = qaStatic();
  // [command, what a player would be doing then]
  const plan = [['@QA join', 'first join'], ['wait 1500', 'first join'], ['@QB join', 'several players'], ['@QC join', 'several players'], ['wait 800', 'several players'],
    ['@QB leave', 'leave'], ['wait 500', 'leave'], ['@QB join', 'rejoin'], ['wait 800', 'rejoin'], ['perf 3000', '3 players online'], ['wait 2500', 'idle'],
    ['reload', '/reload'], ['wait 1500', '/reload'], ['restart', 'server restart'], ['wait 2000', 'after restart']];
  // the script profiler runs while the 3 players idle (after the perf measure, so it does not slow that): when the time is too
  // high, the Q/S line names the functions and lines it goes to, instead of a command the AI would run (another server, more output)
  if (F.name === 'bds') plan.splice(plan.findIndex(([, d]) => d === 'idle'), 1, ['prof start', 'profile'], ['wait 2500', 'idle'], ['prof stop 3', 'profile']);
  // what stays behind: mobs (not items, players, xp) and saved data, before the QA and after it (a probe each)
  const LEAK = "js [world.getDimension('overworld').getEntities({ excludeTypes: ['minecraft:item', 'minecraft:player', 'minecraft:xp_orb'] }).length, world.getDynamicPropertyTotalByteCount()].join(' ')";
  if (F.name === 'bds') { plan.splice(plan.findIndex(([, d]) => d === 'first join') + 2, 0, [LEAK, 'what is there at first']); plan.splice(plan.findIndex(([c]) => c === 'reload'), 0, [LEAK, 'what is there after']); }
  // every kit command a player can type, called with edge values (0, -1, huge, empty, nobody): a script error there is a bug
  const fz = fuzzCalls();
  // what AI playtesters kept finding, checked here for free: a player closes the form a command opened (ask() gives undefined),
  // and a player who rejoins gets the first-join items again. The form probes go before the edge values: a form an edge-value
  // call left open would be the one the next probe closes, and its error would be blamed on that other command
  for (const [c, v] of fz.filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i).slice(0, 6)) plan.splice(plan.findIndex(([x]) => x === 'perf 3000'), 0, [`@QA cmd /${c} ${v}`.trim(), `/${c}: its form closed`], ['@QA form close', `/${c}: its form closed`]);
  for (const [c, v] of fz) plan.splice(plan.findIndex(([x]) => x === 'perf 3000'), 0, [`@QA cmd /${c} ${v}`.trim(), `/${c} ${v}`.trim()]);
  if (F.name === 'bds') {
    plan.splice(plan.findIndex(([x]) => x === '@QB leave'), 0, ["js inv(p('QB'))", 'inventory before rejoin']);
    plan.splice(plan.findIndex(([, d]) => d === 'rejoin') + 2, 0, ["js inv(p('QB'))", 'inventory after rejoin']);
  }
  // is the unit still running after /reload and after the restart? (a plugin that fails to come back says nothing)
  const alive = F.alive ?? ((B.entryOf(ADDON) || files(path.join(BP, 'scripts'), (x) => /\.[cm]?js$/.test(x)).length) ? ['js 6*7', '42'] : null);
  if (alive) { plan.splice(2, 0, [alive[0], 'alive at first']); plan.splice(plan.findIndex(([c]) => c === 'restart'), 0, [alive[0], 'alive after /reload']); plan.push([alive[0], 'alive after restart']); }
  plan.push(...(F.qaLast?.(L()) ?? []));
  const { ready, segs } = await session(plan.map(([c]) => c), { wait: 300 });
  if (!ready) { q.push(['Q', 'world/addon did not load']); }
  let k = 0, aliveOk = false, hot = '', profTotal = 0;
  const perfQ = [];   // the perf lines, completed with the profile below
  const invs = {}, leak = {};   // 'inventory before rejoin' / 'after' → { id: count }; leak: [mobs, saved bytes] before / after
  // no real clients on this machine (their parts could not be installed): judge the server side, say the player part was skipped
  const noPlayers = segs.find((g) => g.cmd === '@QA join')?.out.some((l) => /^E .*(npm install|bedrock-protocol|realplayer)/.test(l));
  if (noPlayers) q.push(['S', 'real players could not start here (their parts did not install): the 3-player checks were skipped']);
  segs.forEach((g) => {
    const during = g.cmd === null ? 'startup' : g.cmd === 'stop' ? 'shutdown' : plan[k++]?.[1] ?? '?';
    for (const l of g.out) {
      if (noPlayers && /^@Q/.test(g.cmd ?? '')) continue;
      if (alive && g.cmd === alive[0] && /^E \S+ unavailable/.test(l)) continue;   // the probe itself; judged below
      if (/ with generated arguments$/.test(during) && l.startsWith('E ') && !/^E FUZZ/.test(l)) continue;   // error replies to bad input are right; FUZZ lines are crashes
      // the probe closes "the form the command opened": a command that opens none is not a bug (the lab's own E line, not the addon's)
      if (/ its form closed$/.test(during) && /^E @\w+ form: none open\b/.test(l)) continue;
      if (l.startsWith('E ') && / its form closed$/.test(during)) q.push(['Q', `${l}   (during: ${during}: a player closed it; ask() then gives undefined)`]);
      else if (l.startsWith('E ')) q.push(['Q', `${l}   (during: ${during})`]);
      else if (l.startsWith('W ')) q.push(['Q', `${l}   (content log, during: ${during})`]);
      const pm = /^PERF script_tick avg ([\d.]+)ms max ([\d.]+)ms/.exec(l);
      if (pm) { const n0 = q.length; perfNote(+pm[1], q); perfQ.push(...q.slice(n0)); }
      if (pm) { const avg = +pm[1], max = +pm[2]; if (avg > QA_BUDGET.avg) perfQ.push(q[q.push(['Q', `script time ${avg}ms per tick with 3 players (budget ${QA_BUDGET.avg}ms; max ${max}ms)`]) - 1]); else if (max > 25) perfQ.push(q[q.push(['S', `script spike ${max}ms in one tick (a tick is 50ms): spread the work over ticks (system.runJob)`]) - 1]); }
      if (during === 'profile' && /^prof stop/.test(g.cmd ?? '')) { const m = /([\d.]+)ms (.+)$/.exec(l); if (/ sampled/.test(l)) profTotal = +m?.[1] || 0; else if (m) hot += `${hot ? ', ' : ''}${m[2].trim()} ${profTotal ? Math.round((100 * m[1]) / profTotal) + '%' : m[1] + 'ms'}`; }
    }
    if (alive && g.cmd === alive[0] && during === 'alive at first') aliveOk = g.out.some((l) => l.trim() === alive[1]);   // (a probe that never answers, e.g. a fake server, judges nothing)
    else if (alive && aliveOk && g.cmd === alive[0] && !g.out.some((l) => l.trim() === alive[1])) q.push(['Q', `not running any more (${during}): \`${alive[0]}\` gave ${g.out.filter((l) => !/^@/.test(l)).slice(0, 2).join(' | ') || 'nothing'}`]);
    if (/^what is there (at first|after)$/.test(during)) { const v = g.out.map((l) => /^(\d+) (\d+)$/.exec(l.trim())).find(Boolean); if (v) leak[during.endsWith('after') ? 'b' : 'a'] = [+v[1], +v[2]]; }
    if (/^inventory (before|after) rejoin$/.test(during)) { const c = {}; for (const m of g.out.join(' ').matchAll(/\d+:([\w:.-]+)\*(\d+)/g)) c[m[1]] = (c[m[1]] ?? 0) + Number(m[2]); invs[during] = c; }
    if (during === 'idle') { const n = g.out.filter((l) => !/^(@|E |W |PERF)/.test(l)).length; if (n > QA_BUDGET.spam) q.push(['S', `logs ${n} lines in 2.5 s of idle: remove debug output (console.warn) or gate it`]); }
  });
  for (const x of perfQ) x[1] = x[1].replace(/ \(node lab\.mjs run "@A join" "prof start".*\)$/, '') + (hot ? `: the time goes to ${hot} (of the script time, profiled with 3 players)` : x[0] === 'Q' || / its best /.test(x[1]) ? ': find it with node lab.mjs run "@A join" "prof start" "wait 3000" "prof stop"' : '');
  if (leak.a && leak.b) {
    if (leak.b[0] - leak.a[0] > 10) q.push(['S', `mobs in the world ${leak.a[0]} → ${leak.b[0]} during QA (items and players aside): something the addon spawns stays: remove it when done (entity.remove()) or cap how many`]);
    if (leak.b[1] - leak.a[1] > 64 * 1024) q.push(['S', `saved dynamic properties ${Math.round(leak.a[1] / 1024)} KB → ${Math.round(leak.b[1] / 1024)} KB during QA: data that only grows (drop old keys, or keep it in memory)`]);
  }
  const [b0, a0] = [invs['inventory before rejoin'], invs['inventory after rejoin']];
  if (b0 && a0) {
    const more = Object.entries(a0).filter(([id, n]) => n > (b0[id] ?? 0)).map(([id, n]) => `${id} ${b0[id] ?? 0}→${n}`);
    // a problem when the request says first join / once; a suggestion otherwise (some servers do give items on every join)
    const firstOnly = /初めて|初回|最初(に|の)?(参加|ログイン|スポーン)|一度だけ|1回だけ|一回だけ|first (time|join|spawn|login)|only once|once per player|new players?/i.test(exists(path.join(ADDON, 'TASK.md')) ? fs.readFileSync(path.join(ADDON, 'TASK.md'), 'utf8').split(/^## Acceptance/m)[0] : '');
    if (more.length) q.push([firstOnly ? 'Q' : 'S', `a player who left and rejoined got items again (${more.join(', ')})${firstOnly ? ', but the request gives them on the first join only' : ''}: give them under once(player, key)${firstOnly ? '' : ' if it means the first join only'}`]);
  }
  const seen = new Set(), uniq = q.filter(([, t]) => !seen.has(t) && seen.add(t)).sort((a, b) => (a[0] === b[0] ? 0 : a[0] === 'Q' ? -1 : 1));
  const bad = uniq.filter(([k]) => k === 'Q').length;
  if (!quiet || bad) uniq.slice(0, 12).forEach(([k, t]) => out(`${k} ${t}`));
  if (!quiet) out(`${bad ? 'FAIL' : 'PASS'} qa ${bad ? `${bad} problem${bad > 1 ? 's' : ''}` : 'clean'}${uniq.length - bad ? `, ${uniq.length - bad} suggestion${uniq.length - bad > 1 ? 's' : ''}` : ''}`);
  return { ok: !bad, q: uniq };
}
// each QA's script time per unit is kept (<lab>/.lab/perf/<unit>.json, newest 30): one that got much slower than its best is
// said (S) even under the budget: a change or a game update made something heavy, before players notice
function perfNote(avg, q) {
  try {
    const f = path.join(LAB, 'perf', path.basename(ADDON) + '.json'); let h = []; try { h = readJson(f); } catch { /* first */ }
    const best = h.length ? Math.min(...h.map((x) => x.avg)) : null;
    if (best !== null && avg > Math.max(best * 2, best + 0.5)) q.push(['S', `script time ${avg}ms per tick, ${(avg / Math.max(best, 0.01)).toFixed(1)}x its best (${best}ms, ${h.find((x) => x.avg === best)?.bds ?? '?'}): something new is heavy (node lab.mjs run "@A join" "prof start" "wait 3000" "prof stop")`]);
    h.push({ avg, bds: bdsVersion(), at: new Date().toISOString().slice(0, 16) }); writeJson(f, h.slice(-30));
  } catch { /* history is best-effort */ }
}
// beta APIs change with every game update; an addon that also compiles and passes its tests on the stable modules ships on
// those (it keeps working after updates). Tried only when the manifest uses beta: types first (seconds), then the tests.
async function tryStable(outer) {
  if (F.name !== 'bds' || !exists(path.join(BP, 'manifest.json'))) return null;
  const mf = path.join(BP, 'manifest.json'), before = fs.readFileSync(mf, 'utf8');
  if (!/-beta/.test(before)) return null;
  const hook = OUT_HOOK, buf = [];
  OUT_HOOK = (l) => buf.push(l);
  try {
    await modeCmd(['stable']);
    NO_LASTFAIL = true;
    const ok = (await preflight()) && (await test([]));
    if (ok) return { moved: 'stable APIs (moved from beta: survives game updates; go --beta keeps beta)' };
    fs.writeFileSync(mf, before);   // needs beta: back as it was
    await preflight({ types: false });
    return { why: B.betaWhy(buf) };
  } catch { fs.writeFileSync(mf, before); return null; } finally { OUT_HOOK = hook; NO_LASTFAIL = false; void outer; }
}
// go: the whole loop in one call. Prints only what needs fixing; the last line is DONE <file> or FAIL.
// The build runs once; then QA (3 players, rejoin, /reload, restart...) runs in a second process on its own server while this
// one runs tests.txt: the time of one, and when the tests fail the QA problems come in the same answer, so an AI fixes both in
// one round instead of two (LAB_GO_SERIAL=1: one after the other, as before; end/ll labs always do). A build that fails still
// gets the QA checks that need no server (languages, components, loot, acceptance ↔ tests).
// the same QA problem in several phases (first join, rejoin, restart...) is one line naming them all
function qMerge(q) {
  const by = new Map();
  for (const [k, t] of q) { const m = /^(.*?)   \(during: (.*)\)$/.exec(t), key = `${k}\u0000${m ? m[1] : t}`; const g = by.get(key) ?? by.set(key, { k, msg: m ? m[1] : t, dur: [] }).get(key); if (m) g.dur.push(m[2]); }
  return [...by.values()].map((g) => [g.k, `${g.msg}${g.dur.length > 1 ? ` ×${g.dur.length}` : ''}${g.dur.length ? `   (during: ${[...new Set(g.dur)].slice(0, 4).join(', ')}${new Set(g.dur).size > 4 ? ', …' : ''})` : ''}`]);
}
async function go(args) {
  const tf = path.join(ADDON, 'tests.txt');
  if (!exists(tf)) die('tests.txt missing');
  const statics = () => { try { return qaStatic().filter(([k]) => k === 'Q'); } catch { return []; } };
  const b0 = [], outer = OUT_HOOK;
  OUT_HOOK = (l) => b0.push(l);
  let built; try { built = await preflight(); } finally { OUT_HOOK = outer; }
  if (!built) { b0.filter((l) => l !== 'FAIL').forEach((l) => out(l)); const q = statics(); q.slice(0, 8).forEach(([k, t]) => out(`${k} ${t}`)); out(`FAIL check${q.length ? `, qa ${q.length} problem(s) found without a server (the Q lines)` : ''}`); return false; }
  b0.filter((l) => /^[WT] /.test(l)).forEach((l) => out(l));
  const noQa = args.includes('--no-qa');
  const par = !noQa && F.name === 'bds' && !process.env.LAB_GO_SERIAL;
  let qaP = null;
  if (par) {
    const jf = path.join(LAB, `qa-${process.pid}.json`);
    qaP = new Promise((res) => {
      const c = spawn(process.execPath, [process.argv[1], 'qa', ...(ADDON_ARG ? ['-a', ADDON_ARG] : ['-a', path.basename(ADDON)])], { cwd: process.cwd(), env: { ...process.env, LAB_QA_BUILT: '1', LAB_QA_JSON: jf, LAB_NOTRACE: '1' }, stdio: 'ignore' });
      c.on('close', () => { let r = null; try { r = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch { /* crashed */ } fs.rmSync(jf, { force: true }); res(r); });
      c.on('error', () => res(null));
    });
  }
  let res = null;
  const buf = [];
  OUT_HOOK = (l) => buf.push(l);
  try { res = await test([], { built: true }); } finally { OUT_HOOK = outer; }
  const rep = (() => { try { return JSON.parse(fs.readFileSync(path.join(LAB, 'report.json'), 'utf8')); } catch { return null; } })();
  const warns = LAST_W.length;
  const ran = buf.find((l) => /^(PASS|FAIL) \d+\/\d+/.test(l));
  if (!res) {
    buf.filter((l) => !/^(PASS|FAIL)/.test(l)).forEach((l) => out(l));
    // the QA problems of the same run (not when the addon did not even load: the same cause twice)
    const loadFail = buf.some((l) => /did not load|is not in this BDS/.test(l));
    const r = qaP ? await qaP : null, q = loadFail ? [] : (r?.q ?? statics()).filter(([k]) => k === 'Q');
    qMerge(q).slice(0, 8).forEach(([k, t]) => out(`${k} ${t}`));
    if (ran && F.name === 'bds' && buf.some((l) => /^(✘ \d+: ## |E )/.test(l))) {
      // no src/ line in what failed: why runs now (one more server run, ~25 s) so the cause comes in this same answer, not
      // after another command; with a src/ line (and its hint) the AI already knows where to look
      const shown = buf.filter((l) => !/^(PASS|FAIL)/.test(l)).join('\n');
      const w = !/\b[\w./-]+\.[cm]?[jt]s:\d+/.test(shown) && !loadFail && !buf.some((l) => /js unavailable: the addon script did not load|is not in this BDS; it has/.test(l)) && process.env.LAB_GO_WHY !== 'off'
        ? spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), F.name, 'why', '-a', ADDON_ARG || path.basename(ADDON)], { cwd: TOP, encoding: 'utf8', env: { ...process.env, LAB_NOTRACE: '1' }, timeout: 300000 }) : null;
      const wl = (w?.stdout ?? '').split('\n').filter((l) => l.trim() && !/^(PASS|FAIL)\b/.test(l));
      if (w && w.status !== null && wl.some((l) => /^next: /.test(l))) wl.filter((l) => !/^✘ /.test(l)).forEach((l) => out(l.replace(/^why ("[^"]*").*$/, 'why $1 (ran for you; its want/got are above):')));
      else out('next: node lab.mjs why   (the first failing section: where it threw, with the values; or the line that printed what came instead)');
    }
    out(`${ran ? `FAIL test ${/\d+\/\d+/.exec(ran)[0]}` : 'FAIL check'}${q.length ? `, qa ${qMerge(q).length} problem(s) (the Q lines: fix them in the same round)` : r ? ', qa clean' : ''}`);
    return false;
  }
  buf.filter((l) => /^[WT] /.test(l) && !b0.includes(l)).slice(0, 10).forEach((l) => out(l));
  const packIt = async (a) => (F.commands?.pack ? (await F.commands.pack(L(), a)) !== false : pack(a));
  if (noQa) { if (warns) { out(`FAIL ${warns} warning(s) above`); return false; } return packIt(args.filter((a) => a === '--bump')); }
  let r = qaP ? await qaP : null;
  if (r) { const bad = qMerge(r.q.filter(([k]) => k === 'Q')); if (bad.length) bad.slice(0, 12).forEach(([k, t]) => out(`${k} ${t}`)); }
  else r = await qa({ quiet: true, built: true });   // serial, or the QA process died
  // (warnings stop go too: say so apart from qa, or "qa 1 problem" sends the AI looking for a qa problem that is not there)
  if (!r.ok || warns) { const nq = qMerge(r.q.filter(([k]) => k === 'Q')).length; out(`FAIL test ${rep.pass}/${rep.total}, ${nq ? `qa ${nq} problem(s)` : 'qa clean'}${warns ? `, ${warns} warning(s): the W line${warns > 1 ? 's' : ''} above` : ''}`); return false; }
  r.q.filter(([k]) => k === 'S').slice(0, 5).forEach(([k, t]) => out(`${k} ${t}`));
  const st = args.includes('--beta') ? null : await tryStable(outer), stable = st?.moved;
  if (st?.why) out(`S stays on beta: ${st.why} (a game update changes beta APIs first; go --beta skips this check)`);
  const pbuf = []; OUT_HOOK = (l) => pbuf.push(l);
  let ok; try { ok = await packIt(args.filter((a) => a === '--bump')); } finally { OUT_HOOK = outer; }
  if (!ok) { pbuf.forEach((l) => out(l)); return false; }
  const f = /^OK (\S+)/.exec(pbuf.find((l) => l.startsWith('OK ')) ?? '')?.[1] ?? pbuf.at(-1);
  out(`DONE ${f} (test ${rep.pass}/${rep.total}, qa clean${stable ? ', ' + stable : ''})`);
  return true;
}

// ---------- api: d.ts signatures without comments ----------
function query(map, q) {
  if (q.startsWith('?')) {
    const w = q.slice(1).toLowerCase(), hits = [];
    for (const [name, body] of map) {
      if (name.toLowerCase().includes(w)) hits.push(name);
      for (const l of members(body)) { const mm = MEMBER.exec(l); if (mm && mm[1].toLowerCase().includes(w) && !/^ \w+ = /.test(l)) hits.push(`${name}.${mm[1]}`); }
    }
    const u = [...new Set(hits)];
    out(u.length ? u.slice(0, 60).join(' ') + (u.length > 60 ? ` ... +${u.length - 60}` : '') : 'none');
    return u.length > 0;
  }
  const ALIAS = { world: 'World', system: 'System', dim: 'Dimension', dimension: 'Dimension', player: 'Player', entity: 'Entity', block: 'Block', item: 'ItemStack', mc: null };
  let parts = q.split('.');
  if (parts[0] in ALIAS) parts = ALIAS[parts[0]] ? [ALIAS[parts[0]], ...parts.slice(1)] : parts.slice(1);
  // walk property types: world.afterEvents.entityDie -> WorldAfterEvents.entityDie
  while (parts.length > 2) {
    const line = findMember(map, parts[0], parts[1]);
    const t = line && /:\s*(\w+)/.exec(line.replace(/\(.*\)/, ''))?.[1];
    if (!t || !map.has(t)) break;
    parts = [t, ...parts.slice(2)];
  }
  const [name, member] = parts;
  if (!map.has(name)) {
    const near = [...map.keys()].filter((k) => k.toLowerCase().includes(name.toLowerCase())).slice(0, 15);
    out(`none: ${name}. similar: ${near.join(' ') || '-'}`);
    return false;
  }
  const head = map.get(name).split('\n')[0];
  if (!member) {
    const body = map.get(name).split('\n');
    const lines = body.slice(0, -1);
    for (let b = baseOf(map, name), seen = new Set(); b && map.has(b) && !seen.has(b); b = baseOf(map, b)) {
      seen.add(b);
      const ms = members(map.get(b));
      if (ms.length <= 15) lines.push(` // from ${b}`, ...ms);
      else lines.push(` // from ${b} (api ${b}.<name>): ${ms.map((l) => MEMBER.exec(l)?.[1]).filter(Boolean).join(' ')}`);
    }
    out([...lines, body.at(-1)].join('\n'));
    return true;
  }
  for (let n = name, seen = new Set(); n && map.has(n) && !seen.has(n); n = baseOf(map, n)) {
    seen.add(n);
    const ls = members(map.get(n)).filter((l) => MEMBER.exec(l)?.[1] === member);
    if (ls.length) {
      out((n === name ? head : `${head} // from ${n}`) + '\n' + ls.join('\n'));
      // event signal: also show the event object the callback receives
      const sig = /:\s*(\w+Signal)\b/.exec(ls[0])?.[1];
      const ev = sig && /subscribe\(callback: \(arg\d?: (\w+)\)/.exec(map.get(sig) ?? '')?.[1];
      if (ev && map.has(ev)) out(map.get(ev));
      return true;
    }
  }
  const all = [];
  for (let n = name, seen = new Set(); n && map.has(n) && !seen.has(n); n = baseOf(map, n)) { seen.add(n); all.push(...members(map.get(n)).map((l) => MEMBER.exec(l)?.[1]).filter(Boolean)); }
  out(`none: ${q}. members: ${[...new Set(all)].join(' ')}`);
  return false;
}

async function api(args) {
  if (!args.length) die('usage: node lab.mjs api <Name|Name.member|?word> ...');
  await ensureBdsOrOffline('api');
  const map = decls(await ensureTypes());
  let ok = true;
  for (const q of args) ok = query(map, q.trim()) && ok;
  return ok;
}

// ---------- sample: vanilla BP files of this exact BDS version (+ RP files from Mojang/bedrock-samples) ----------
const BINARY = /\.(mcstructure|nbt|png|tga|jpg|ogg|fsb|wav|bin|brarchive)$/i;
// Mojang's vanilla resource pack (bedrock-samples): the JSON dirs checked out once (sparse, ~9 MB), other files one blob at a time
function vanillaRp() {
  if (!rpSamples()) return null;
  const dir = path.join(CACHE, 'samples'), git = (...a) => spawnSync('git', a, { cwd: dir, maxBuffer: 64e6 }), root = path.join(dir, 'resource_pack');
  if (!exists(path.join(root, 'ui'))) { git('config', 'gc.auto', '0'); git('sparse-checkout', 'set', '--no-cone', ...['entity', 'models', 'animations', 'attachables', 'ui'].map((d) => 'resource_pack/' + d)); git('checkout', '-q', 'HEAD'); }
  return { root, git, bin: (r) => { const x = git('show', 'HEAD:resource_pack/' + r); return x.status === 0 ? x.stdout : null; },
    // (null when git cannot read it: the cache can be removed under it — a new BDS clears it, another lab process may be installing)
    textures: () => { const x = git('ls-tree', '-r', '--name-only', 'HEAD', 'resource_pack/textures'); return x.status === 0 && x.stdout ? new Set(x.stdout.toString().split('\n').filter(Boolean).map((f) => f.slice(14).replace(/\.(png|tga|jpg|jpeg)$/i, '').toLowerCase())) : null; } };
}
// rp/ui: every @reference, namespace, _ui_defs entry and texture path resolved against this pack + vanilla (lib/jsonui.mjs)
async function lintUiPack(warns) {
  if (!exists(path.join(RP, 'ui'))) return;
  const J = await import('./jsonui.mjs');
  let v = vanillaRp();
  const tex = v?.textures() ?? null;
  if (!tex) v = null;
  const van = v ? J.vanillaUiIndex(path.join(v.root, 'ui'), tex) : null;
  if (!v) warns.push('rp/ui: vanilla UI not checked (needs git + github.com): only this pack\'s own names resolved');
  const w = J.lintUi(RP, van);
  warns.push(...w.slice(0, 25));
  if (w.length > 25) warns.push(`rp/ui: ... +${w.length - 25}`);
}
function rpSamples() {
  const dir = path.join(CACHE, 'samples');
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 64e6 });
  if (!exists(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', '--depth', '1', 'https://github.com/Mojang/bedrock-samples.git', '.'], { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) { fs.rmSync(dir, { recursive: true, force: true }); return null; }
  }
  const ls = git('ls-tree', '-r', 'HEAD', '--name-only');
  if (ls.status !== 0) return null;
  const idx = new Map();
  for (const f of ls.stdout.split('\n')) if (f.startsWith('resource_pack/') && !BINARY.test(f)) idx.set('rp/' + f.slice(14), { git: f, read: () => git('show', 'HEAD:' + f).stdout });
  return idx;
}

function vanillaIndex() {
  const idx = new Map();
  const vkey = (n) => (n === 'vanilla' ? [0] : n.slice(8).split('.').map(Number));
  const cmp = (a, b) => { const x = vkey(a), y = vkey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
  for (const [sub, prefix] of [['behavior_packs', ''], ['resource_packs', 'rp/']]) {
    const base = path.join(BDS, sub);
    if (!exists(base)) continue;
    for (const d of fs.readdirSync(base).filter((n) => /^vanilla(_[\d.]+)?$/.test(n)).sort(cmp)) {
      const root = path.join(base, d);
      for (const f of files(root)) {
        const r = path.relative(root, f).split(path.sep).join('/');
        if (/^manifest|^pack_icon|^contents\.json$|^textures_list/.test(r) || (BINARY.test(r) && !r.endsWith('.brarchive'))) continue;   // (a .brarchive is opened below)
        if (r.startsWith('__brarchive/') && r.endsWith('.brarchive')) {
          const b = fs.readFileSync(f), n = b.readUInt32LE(8), start = 16 + n * 256, dir = path.basename(r, '.brarchive');
          for (let i = 0; i < n; i++) {
            const e = 16 + i * 256;
            idx.set(`${prefix}${dir}/${b.toString('utf8', e + 1, e + 1 + b[e])}`, { f, off: start + b.readUInt32LE(e + 248), len: b.readUInt32LE(e + 252) });
          }
        } else idx.set(prefix + r.replace(/^__brarchive\//, ''), { f });
      }
    }
  }
  return idx;
}

async function sample(args) {
  const [q, keys] = args;
  if (!q) die('usage: node lab.mjs sample <word|path> [key/key]');
  await ensureBds();
  const idx = vanillaIndex();
  if (q.startsWith('rp')) { const r = rpSamples(); if (!r) out('W rp samples need git + github.com'); else for (const [k, v] of r) idx.set(k, v); }
  const hit = idx.get(q);
  if (!hit) {
    const ws = q.toLowerCase().split(/\s+/);
    const m = [...idx.keys()].filter((k) => ws.every((w) => k.toLowerCase().includes(w)));
    out(m.length ? m.slice(0, 40).join(' ') + (m.length > 40 ? ` ... +${m.length - 40} (narrow it)` : '') : 'none (many vanilla items/blocks are hardcoded; for new content use: node lab.mjs add item|block|entity ns:id "Name")');
    return m.length > 0;
  }
  let text;
  if (hit.read) text = hit.read();
  else { const buf = fs.readFileSync(hit.f); text = (hit.len !== undefined ? buf.subarray(hit.off, hit.off + hit.len) : buf).toString('utf8'); }
  let v;
  try { v = JSON.parse(stripJsonComments(text.replace(/^﻿/, ''))); } catch { out(text.slice(0, 6000)); return true; }
  for (const k of keys ? keys.split('/') : []) {
    if (v === null || typeof v !== 'object' || !(k in v)) { out(`none: ${k}. keys: ${v && typeof v === 'object' ? Object.keys(v).join(' ') : '-'}`); return false; }
    v = v[k];
  }
  const s = JSON.stringify(v);
  out(s.length > 6000 ? s.slice(0, 6000) + `... (+${s.length - 6000} chars; drill down with key/key, keys: ${Object.keys(v).join(' ')})` : s);
  return true;
}


// ---------- addons: new / use / import ----------
const modVersion = (name, beta) => { try { const v = JSON.parse(fs.readFileSync(path.join(LIBDIR, 'data', 'minecraft-modules.json'), 'utf8'))[name].versions[beta ? 'beta' : 'stable'].version; const m = /^(\d+\.\d+\.\d+)(-beta)?/.exec(v); return m[1] + (m[2] ?? ''); } catch { return beta ? '2.11.0-beta' : '2.10.0'; } };
// a preview BDS (1.26.60.28) has no -stable beta on npm: its own build (-beta.1.26.60-preview.28), else the newest earlier preview
function previewBetas(all, bv) {
  const build = Number(bdsVersion().split('.')[3] ?? 0), pv = (v) => Number(/-preview\.(\d+)$/.exec(v)?.[1] ?? -1);
  const ps = all.filter((v) => v.includes(`-beta.${bv}-preview.`)).sort((a, b) => pv(a) - pv(b) || semCmp(a, b));
  const own = ps.filter((v) => pv(v) === build), before = ps.filter((v) => pv(v) <= build);
  return own.length ? own : before.length ? [before.at(-1)] : ps.slice(-1);
}
// manifest version of a module for this BDS: beta = the X.Y.Z-beta published for it, stable = newest plain X.Y.Z released with it
const semCmp = (a, b) => { const x = a.split(/[-+]/)[0].split('.').map(Number), y = b.split(/[-+]/)[0].split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
async function moduleVersion(name, beta) {
  try {
    const doc = await npmVersions('@minecraft/' + name), bv = bdsVersion().split('.').slice(0, 3).join('.');
    const all = Object.keys(doc.versions), st = all.filter((v) => v.endsWith(`-beta.${bv}-stable`)).sort((p, q) => semCmp(p, q));
    const b = (st.length ? st : previewBetas(all, bv).sort((p, q) => semCmp(p, q))).pop();
    if (beta) return b ? b.replace(/-beta\..*$/, '-beta') : modVersion(name, true);
    const until = b && doc.time?.[b] ? Date.parse(doc.time[b]) + 3 * 864e5 : Infinity;
    return Object.keys(doc.versions).filter((v) => /^\d+\.\d+\.\d+$/.test(v) && !(Date.parse(doc.time?.[v]) > until)).sort(semCmp).pop() ?? modVersion(name, false);
  } catch { return modVersion(name, beta); }
}
// the request's sentences as the first acceptance lines (rewrite them as checkable lines; "make me X" alone is not one)
// (ASCII . ! ? end a sentence only before an English one or the end: "使うと ZAP! と伝え" is one line, a shouted word is not a stop)
const accOf = (req) => { const xs = String(req).split(/[。．！？\n]+|[.!?]+(?=\s+[A-Z0-9"'(]|\s*$)\s*/).map((x) => x.trim()).filter((x) => x.length >= 4); const ys = xs.length > 1 ? xs.filter((x) => !/(を作って(ください|ほしい|欲しい)?|作成して|^(make|create|build) (me )?(an? )?[\w -]+$)$/i.test(x)) : xs; return ys.slice(0, 8); };
const TASK_MD = (title, req = '') => `# ${title}\n\n## Request\n${req || '<!-- what the person asked, in their words -->'}\n\n## Acceptance (one tests.txt \`## \` section each)\n${(accOf(req).length ? accOf(req) : ['']).map((x) => `- [ ] ${x}`).join('\n')}\n\n## Guessed\n<!-- values decided without asking -->\n`;
function packIcon(file, name) {
  const h = crypto.createHash('md5').update(name).digest('hex');
  const rows = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x === 0 || y === 0 || x === 15 || y === 15 ? 'b' : (x >> 2) + (y >> 2) & 1 ? 'a' : 'c')).join(''));
  png([file, `a=${h.slice(0, 6)} b=${h.slice(6, 12)} c=${h.slice(12, 18)}`, ...rows], true);
}
// new <name> ["Title"]: TypeScript (src/ -> bp/scripts), beta APIs, behavior + resource pack, server-ui
//   --js plain JavaScript in bp/scripts   --stable stable APIs only   --no-rp behavior pack only
async function newAddon(args) {
  const desc = args.find((a) => a.startsWith('desc='))?.slice(5).trim() || null;   // desc="what players read in the pack list"
  const [name, title = name, ...reqParts] = args.filter((a) => !a.startsWith('--') && !a.startsWith('desc='));
  if (!/^[a-z0-9_]+$/.test(name ?? '')) die('usage: node lab.mjs new <name: a-z0-9_> ["Title"] [--js] [--stable] [--no-rp]');
  const dir = path.join(ADDONS, name);
  if (exists(dir)) die(`addons/${name} exists (node lab.mjs use ${name})`);
  await ensureBdsOrOffline('new');   // module versions follow this BDS
  const beta = !args.includes('--stable'), js = args.includes('--js'), rp = !args.includes('--no-rp');
  const eng = bdsVersion().split('.').slice(0, 3).map(Number);
  const deps = [{ module_name: '@minecraft/server', version: await moduleVersion('server', beta) }, { module_name: '@minecraft/server-ui', version: await moduleVersion('server-ui', beta) }];
  const m = { format_version: 2, header: { name: title, description: desc ?? title, uuid: randomUUID(), version: [1, 0, 0], min_engine_version: eng },
    modules: [{ type: 'script', language: 'javascript', uuid: randomUUID(), version: [1, 0, 0], entry: 'scripts/main.js' }], dependencies: deps };
  if (rp) {
    const r = { format_version: 2, header: { name: title + ' RP', description: desc ?? title, uuid: randomUUID(), version: [1, 0, 0], min_engine_version: eng }, modules: [{ type: 'resources', uuid: randomUUID(), version: [1, 0, 0] }] };
    writeJson(path.join(dir, 'rp', 'manifest.json'), r);
    m.dependencies.push({ uuid: r.header.uuid, version: r.header.version });
    fs.mkdirSync(path.join(dir, 'rp', 'texts'), { recursive: true });
    writeJson(path.join(dir, 'rp', 'texts', 'languages.json'), ['en_US', 'ja_JP']);
    for (const l of ['en_US', 'ja_JP']) fs.writeFileSync(path.join(dir, 'rp', 'texts', l + '.lang'), `pack.name=${title}\npack.description=${desc ?? title}\n`);
  }
  writeJson(path.join(dir, 'bp', 'manifest.json'), m);
  const main = `import { world, system } from '@minecraft/server';\nimport { cmd, ask, give, take, count, once, load, save, score, every, cooldown, ready } from './kit';\n`;
  const kit = fs.readFileSync(path.join(LIBDIR, 'kit', 'kit.ts'), 'utf8');
  if (js) {
    fs.mkdirSync(path.join(dir, 'bp', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bp', 'scripts', 'main.js'), main.replace("'./kit'", "'./kit.js'"));
    let kjs; try { await setup(); kjs = tl().ts.transpileModule(kit, { compilerOptions: { target: 99, module: 99 } }).outputText; } catch { kjs = fs.readFileSync(path.join(LIBDIR, 'kit', 'kit.js'), 'utf8'); }   // no TypeScript here: the pre-built copy
    fs.writeFileSync(path.join(dir, 'bp', 'scripts', 'kit.js'), kjs);
  } else { fs.mkdirSync(path.join(dir, 'src'), { recursive: true }); fs.writeFileSync(path.join(dir, 'src', 'main.ts'), main); fs.writeFileSync(path.join(dir, 'src', 'kit.ts'), kit); }
  fs.writeFileSync(path.join(dir, 'tests.txt'), '## loads\n@A join\n~ joined\n');
  fs.writeFileSync(path.join(dir, 'TASK.md'), TASK_MD(title, reqParts.join(' ')));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ntsconfig.json\n');
  useAddon(name, true);
  packIcon(path.join(dir, 'bp', 'pack_icon.png'), name);
  if (rp) packIcon(path.join(dir, 'rp', 'pack_icon.png'), name + 'rp');
  forwarder(dir);
  out(`OK bds/addons/${name}/: write bds/addons/${name}/${js ? 'bp/scripts/main.js' : 'src/main.ts'} (only the imports so far: write it whole) and bds/addons/${name}/tests.txt (paths from this folder) · ${beta ? 'beta' : 'stable'} APIs (${deps.filter((d) => d.module_name).map((d) => d.module_name.slice(11) + ' ' + d.version).join(', ')})${rp ? ' +rp' : ''}; now the current addon`);
}
// mode beta|stable: move every @minecraft/* dependency to the beta or stable version of this BDS
async function modeCmd(args) {
  const beta = args[0] === 'beta';
  if (!['beta', 'stable'].includes(args[0])) die('usage: node lab.mjs mode beta|stable');
  await ensureBdsOrOffline('mode');
  const mf = path.join(BP, 'manifest.json'), m = readJson(mf);
  const ch = [];
  for (const d of m.dependencies ?? []) {
    if (!d.module_name?.startsWith('@minecraft/') || d.module_name === '@minecraft/server-gametest') continue;
    const v = await moduleVersion(d.module_name.slice(11), beta);
    if (v && v !== d.version) { ch.push(`${d.module_name.slice(11)} ${d.version}->${v}`); d.version = v; }
  }
  writeJson(mf, m);
  out(`OK ${args[0]}${ch.length ? ': ' + ch.join(', ') : ' (already)'}`);
}
// lib add|remove <npm package...>: an npm library bundled into the addon (src/ imports it)
function libCmd(args) {
  const [op, ...pk] = args;
  if (!['add', 'remove'].includes(op) || !pk.length) die('usage: node lab.mjs lib add|remove <npm-package[@version]> ...');
  if (!B.entryOf(ADDON)) die('libraries need src/ (bundled): move bp/scripts/*.js to src/ or start with `new` (TypeScript)');
  const pj = path.join(ADDON, 'package.json');
  if (!exists(pj)) fs.writeFileSync(pj, JSON.stringify({ private: true, type: 'module', dependencies: {} }, null, 2) + '\n');
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', [op === 'add' ? 'i' : 'rm', ...pk, '--no-audit', '--no-fund', '--loglevel=error', '--legacy-peer-deps'], { cwd: ADDON, encoding: 'utf8', shell: WIN });
  if (r.status !== 0) die(`npm ${op} failed:\n${(r.stderr || r.stdout).slice(-600)}`);
  const d = JSON.parse(fs.readFileSync(pj, 'utf8')).dependencies ?? {};
  out(`OK libs: ${Object.entries(d).map(([k, v]) => k + '@' + v).join(' ') || 'none'} (Mojang's @minecraft/math, vanilla-data, gameplay-utilities are always available)`);
}
function useAddon(name, quiet) {
  if (!addonNames().includes(name)) die(`no addon "${name}" (addons: ${addonNames().join(' ') || 'none'})`);
  fs.mkdirSync(LAB, { recursive: true });
  fs.writeFileSync(path.join(LAB, 'addon'), name + '\n');
  if (!quiet) out(`OK current addon: ${name}`);
}
// .mcaddon / .mcpack / folder -> addons/<name>/bp + rp (packs are told apart by module type). A person's addon to fix or finish:
// import <file|folder> ["<what they asked>"] keeps the request in TASK.md, writes a draft tests.txt that runs each way into the
// addon once (one go shows every crash) and prints the brief (what it is, its ways in, what breaks on this BDS's APIs)
async function importAddon(args) {
  const pos = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--name');
  const given = pos[0], request = pos.slice(1).join(' ').trim();
  const cands = given ? [path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), given), path.resolve(TOP, given), path.resolve(given)] : [];
  const src = cands.find((c) => exists(c));
  if (!src) die(`usage: node lab.mjs import <file.mcaddon|.mcpack|.zip|folder> ["<what the person asked>"] [--name n]${given ? ` (no ${given} here)` : ''}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-import-'));
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, tmp, { recursive: true }); else unzip(fs.readFileSync(src), tmp);
  // an .mcaddon may hold .mcpack files (zips) instead of folders
  for (const z of files(tmp, (f) => /\.(mcpack|zip)$/i.test(f))) { const d = z.replace(/\.(mcpack|zip)$/i, ''); fs.mkdirSync(d, { recursive: true }); try { unzip(fs.readFileSync(z), d); } catch { /* not a zip */ } }
  const packs = files(tmp, (f) => path.basename(f) === 'manifest.json').map((f) => ({ dir: path.dirname(f), m: readJson(f) }))
    .map((p) => ({ ...p, kind: (p.m.modules ?? []).some((x) => x.type === 'resources') ? 'rp' : 'bp' }));
  const bp = packs.find((p) => p.kind === 'bp'), rp = packs.find((p) => p.kind === 'rp');
  if (!bp) die('no behavior pack (manifest with data/script module) in ' + given);
  const i = args.indexOf('--name');
  const name = (i >= 0 ? args[i + 1] : String(bp.m.header.name)).toLowerCase().replace(/§./g, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'imported';
  const dir = path.join(ADDONS, name);
  if (exists(dir)) die(`addons/${name} exists (use --name <other>)`);
  fs.cpSync(bp.dir, path.join(dir, 'bp'), { recursive: true });
  if (rp) fs.cpSync(rp.dir, path.join(dir, 'rp'), { recursive: true });
  const BR = await import('./brief.mjs'), sur = BR.surface(dir);
  fs.writeFileSync(path.join(dir, 'tests.txt'), BR.draftTests(sur));
  writeJson(path.join(dir, 'imported.json'), { from: path.basename(src), bp: bp.m.header.version, rp: rp?.m.header.version ?? null, request: request || null });
  fs.writeFileSync(path.join(dir, 'TASK.md'), TASK_MD(name, request ? `${request}\n\n(a person's addon, imported from ${path.basename(src)}: keep its pack names and UUIDs, so their worlds update in place)` : `(imported from ${path.basename(src)}: write what the person asked here)`));
  fs.rmSync(tmp, { recursive: true, force: true });
  useAddon(name, true);
  // someone else's addon: what it could do, before it runs on a server (scan.mjs); and packs that would shadow one of yours
  try { scanReport(scanPath(dir), name, out, { notes: false }); } catch (e) { out(`W scan: ${e.message}`); }
  const ids = (d) => { try { const j = readJson(path.join(d, 'manifest.json')); return [j.header.uuid, ...(j.modules ?? []).map((x) => x.uuid)]; } catch { return []; } };
  const mine = new Set([...ids(path.join(dir, 'bp')), ...ids(path.join(dir, 'rp'))]);
  const twin = addonNames().filter((n) => n !== name && [...ids(path.join(ADDONS, n, 'bp')), ...ids(path.join(ADDONS, n, 'rp'))].some((u) => mine.has(u)));
  if (twin.length) out(`W the same pack UUIDs as addons/${twin.join(', addons/')}: a world loads only one of them (node lab.mjs maint --fix gives the newer one its own)`);
  const br = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), F.name, 'brief', '-a', name], { cwd: TOP, encoding: 'utf8', env: { ...process.env, LAB_NOTRACE: '1' }, timeout: 600000 });
  ((br.stdout ?? '') + (br.stderr ?? '')).split('\n').filter((l) => l.trim() && !/^(OK|PASS)$/.test(l.trim())).forEach((l) => out(l));
  out(`OK bds/addons/${name}/ (bp${rp ? ' rp' : ''}), now the current addon; tests.txt: a draft that runs each way in once${request ? '' : '; put the request in TASK.md'}; next: node lab.mjs go`);
}
// brief: the current addon read without running it (also after import): what it is, its ways in, what breaks on this BDS
async function brief(args = [], { sur } = {}) {
  const BR = await import('./brief.mjs'), s = sur ?? BR.surface(ADDON);
  const { mods, lines } = await upgradeAudit().catch((e) => ({ mods: [], lines: [`W audit: ${String(e.message).split('\n')[0]}`] }));
  for (const l of BR.briefLines(ADDON, s, { name: path.basename(ADDON), mods, audit: lines })) out(l);
  // the bugs it has now, found in the source and the pack before any server (the same checks go runs; each names its skill rule):
  // a person's addon usually has several, and seeing them all at once saves a go round per bug
  const LABEL = { early: 'world.* at the top level (api-early)', before: 'a change inside a before-event (api-before-readonly)' };
  const found = new Map();
  for (const [f, t] of scriptSources()) for (const r of lintScript(t)) {
    const label = LABEL[r.kind] ?? (/\((api-[\w-]+)\)$/.exec(r.msg) ? r.msg.replace(/^.*\((api-[\w-]+)\)$/, (_, id) => ({ 'api-score-identity': 'getScore for a new player', 'api-form-cancel': 'a closed form not handled', 'api-state-persist': 'state lost on restart' }[id] ?? id) + ` (${id})`) : null);
    if (!label) continue;
    const k = label; (found.get(k) ?? found.set(k, []).get(k)).push(`${path.basename(f)}:${r.line}`);
  }
  try { if (COMPONENTS === null) { const x = await import('./extra.mjs'); COMPONENTS = x.componentSets(CACHE); X_nearest = x.nearest; } } catch { /* offline */ }
  const cw = []; try { lintContent(cw); } catch { /* pack unreadable: go says */ }
  const bugs = [...found].map(([k, at]) => `${k}: ${[...new Set(at)].slice(0, 5).map((x, i, a) => (i && x.split(':')[0] === a[i - 1].split(':')[0] ? x.split(':')[1] : x)).join(',')}`).concat(cw.filter((w) => /not an? \w+ component|renamed/.test(w)).map((w) => w.replace(/^addons\/[\w-]+\//, '')).slice(0, 4));
  if (bugs.length) out(`bugs found before any server (fix them all in the first round): ${bugs.join(' · ')}`);
  return true;
}
// the code checked against the module versions this BDS has, stable and beta: every use that breaks there, at once (each go
// round would show only the first crash), and which of the two needs fewer changes
const API_TS = /\bTS(2339|2551|2305|2724|2554|2555|2353|2561|2694|2614)\b/;
async function upgradeAudit() {
  const m = readJson(path.join(BP, 'manifest.json')), deps = (m.dependencies ?? []).filter((d) => d.module_name?.startsWith('@minecraft/') && d.module_name !== '@minecraft/server-gametest');
  const src = !!B.entryOf(ADDON), scripts = src || files(path.join(BP, 'scripts'), (x) => /\.[cm]?js$/.test(x)).length > 0;
  if (!deps.length || !scripts) return { mods: [], lines: [] };
  // the module versions this BDS has (npm's list for it, else the lab's own table): known before any server is set up, so
  // the brief says a version this BDS lacks in a lab with no BDS yet too — only the type check below needs the setup
  const want = { stable: {}, beta: {} };
  for (const d of deps) for (const k of ['stable', 'beta']) want[k][d.module_name] = await moduleVersion(d.module_name.slice(11), k === 'beta');
  // stable versions carry over to newer BDS; a beta is only in the BDS it was made for
  const mods = deps.map((d) => ({ name: d.module_name.slice(11), want: d.version, ok: /-/.test(d.version) ? d.version === want.beta[d.module_name] : true, has: [want.stable[d.module_name], want.beta[d.module_name]].filter(Boolean) }));
  try { await setup(); } catch (e) { return { mods, lines: [`W audit: ${String(e.message).split('\n')[0]}`] }; }
  const bv = bdsVersion().split('.').slice(0, 3).join('.'), res = {};
  for (const k of ['stable', 'beta']) {
    const tdeps = (m.dependencies ?? []).map((d) => (want[k][d.module_name] ? { ...d, version: want[k][d.module_name] } : d));
    const sdk = await B.sdk({ cache: CACHE, bv, deps: tdeps, npmDoc: npmVersions });
    const tmp = path.join(LAB, 'audit', path.basename(ADDON));
    fs.rmSync(tmp, { recursive: true, force: true });
    const from = src ? 'src' : path.join('bp', 'scripts');
    fs.cpSync(path.join(ADDON, from), path.join(tmp, from), { recursive: true });
    B.writeTsconfig(tmp, sdk, !src);
    res[k] = B.typecheck({ tl: tl(), addon: tmp, cache: CACHE, js: !src, max: 200 }).filter((l) => API_TS.test(l)).map((l) => l.replace(/^bp\/scripts\//, ''));
  }
  const ver = (k) => deps.map((d) => `${d.module_name.slice(11)} ${want[k][d.module_name]}`).join(', ');
  const lines = [];
  for (const k of ['stable', 'beta']) lines.push(`on ${k} (${ver(k)}): ${res[k].length ? `${res[k].length} use(s) break: ${res[k].slice(0, 6).join(' | ')}${res[k].length > 6 ? ' | …' : ''}` : 'nothing breaks'}`);
  const pick = res.stable.length <= res.beta.length ? 'stable' : 'beta';
  const cur = deps.every((d) => d.version === want[pick][d.module_name]);
  lines.push(`→ ${cur ? `the manifest is on ${pick} already` : `node lab.mjs mode ${pick}`}${res[pick].length ? `, then fix the ${res[pick].length} use(s) above (api <Class> for what replaced them)` : ''}${pick === 'beta' ? ' (beta: only this BDS; stable survives updates)' : ''}`);
  return { mods, lines };
}

// ---------- BDS version / GitHub ----------
async function bdsCmd(args) {
  if (args.includes('--list')) { const f = bdsFamilies(); out(`newest build per family (test --bds <ver>, test --matrix = current + 2 older): ${f.slice(0, 12).join(' ')}${f.length > 12 ? ` ... ${f.at(-1)}` : ''}`); return true; }
  const pin = args.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)), preview = args.includes('--preview');
  if (pin || args.includes('--update')) {
    const want = pin ?? (await latestBds(preview)).ver;
    if (exists(EXE) && bdsVersion() === want) { out(`OK bds ${want} (already)`); return; }
    // the old zip stays until the new one is in: a blocked download (maintain, latest) must not leave the lab without a server
    const bak = VENDOR_ZIP + '.old';
    if (exists(VENDOR_ZIP)) fs.renameSync(VENDOR_ZIP, bak);
    try { await ensureBds({ version: want, preview }); } catch (e) { if (exists(bak) && !exists(VENDOR_ZIP)) fs.renameSync(bak, VENDOR_ZIP); throw e; }
    await setupAll();
    fs.rmSync(bak, { force: true });
  } else await ensureBds();
  out(`OK bds ${bdsVersion()} (${exists(VENDOR_ZIP) ? 'vendor/bedrock-server.zip' : 'cache only'})`);
}
const gh = () => import('./github.mjs');
const GITROOT = ROOT.startsWith(TOP + path.sep) ? TOP : ROOT;
const posixRel = (f) => path.relative(GITROOT, f).split(path.sep).join('/');
const LAYOUT = () => ({ units: posixRel(ADDONS), branch: F.branchPrefix, vendor: posixRel(VENDOR_ZIP),
  allUnits: GITROOT === TOP ? ['bds/addons', 'end/plugins', 'll/mods'] : [posixRel(ADDONS)] });
const X = () => import('./extra.mjs');
// render <entity id | geometry id | rp/models/...geo.json> [size]: PNG of the model with its texture (the AI can look at it)
// render <ns:entity | geometry.id | file.geo.json> [--anim <animation id>[@sec]] [--views a,b,c] [--tex <png>] [--mct]
// drawn the way the game does (x-mirrored, per-face UV incl. converted box UV, bind + animation pose) by lib/model.mjs;
// minecraft:<mob> renders the vanilla model from Mojang's bedrock-samples (look at how vanilla does it first)
async function renderCmd(args) {
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const useMct = args.includes('--mct'); if (useMct) args.splice(args.indexOf('--mct'), 1);
  const anim = opt('--anim'), views = opt('--views'), texOpt = opt('--tex');
  const [q, size] = args;
  if (!q) die('usage: node lab.mjs render <ns:entity | geometry.id | models/x.geo.json> [--anim <animation id>[@sec]] [--views front34,side,rear34,top,front,rear,left,low34] [--tex rp/textures/x.png] [--mct]');
  const M = await import('./model.mjs');
  // a file source: the addon's rp, or (vanilla) the bedrock-samples resource pack through git
  const safe = (t) => { try { return JSON.parse(stripJsonComments(t.replace(/^﻿/, ''))); } catch { return null; } };
  const rpList = () => files(RP, (f) => f.endsWith('.json')).map((f) => path.relative(RP, f).split(path.sep).join('/'));
  let src = { list: rpList, grep: (pre, needle) => rpList().filter((r) => r.startsWith(pre) && fs.readFileSync(path.join(RP, r), 'utf8').includes(needle)), text: (r) => fs.readFileSync(path.join(RP, r), 'utf8'), bin: (r) => (exists(path.join(RP, r)) ? fs.readFileSync(path.join(RP, r)) : null), name: 'rp' };
  const vanilla = () => {
    const v = vanillaRp() ?? die('vanilla models need git + github.com (Mojang/bedrock-samples)');
    const list = () => files(v.root, (f) => f.endsWith('.json')).map((f) => path.relative(v.root, f).split(path.sep).join('/'));
    return { list, grep: (pre, needle) => list().filter((r) => r.startsWith(pre) && fs.readFileSync(path.join(v.root, r), 'utf8').includes(needle)), text: (r) => fs.readFileSync(path.join(v.root, r), 'utf8'), bin: v.bin, name: 'vanilla' };
  };
  const findEntity = (s) => { for (const r of [...s.grep('entity/', `"${q}"`), ...s.grep('attachables/', `"${q}"`)]) { const j = safe(s.text(r)); const d = (j?.['minecraft:client_entity'] ?? j?.['minecraft:attachable'])?.description; if (d?.identifier === q) return d; } return null; };
  let desc = null, file = null, geoId = null;
  if (/\.json$/.test(q)) file = [path.resolve(q), path.resolve(RP, q), path.resolve(ADDON, q)].find(exists);
  if (!file && q.includes(':')) { desc = findEntity(src); if (!desc && q.startsWith('minecraft:')) { src = vanilla(); desc = findEntity(src); } if (!desc) die(`no client entity or attachable ${q} in ${src.name}/entity or attachables`); }
  const pickOne = (v) => (typeof v === 'object' && v ? v.default ?? Object.values(v)[0] : v);
  geoId = file ? null : desc ? pickOne(desc.geometry) : q;
  // the geometry: from the file, or the models/ file that defines geoId
  let geo = null;
  if (file) geo = M.loadGeos(file)[0];
  else for (const r of src.grep('models/', geoId)) {
    const t = src.text(r);
    const tmp = path.join(LAB, 'render', 'src.geo.json'); fs.mkdirSync(path.dirname(tmp), { recursive: true }); fs.writeFileSync(tmp, t);
    try { geo = M.loadGeos(tmp).find((g) => g.id === geoId); } catch { /* not json */ }
    if (geo) break;
  }
  if (!geo) die(`no geometry ${geoId ?? q} in ${src.name}/models (geometries: ${src.list().filter((f) => f.startsWith('models/')).slice(0, 20).join(' ') || 'none'})`);
  if (!desc) for (const r of [...src.grep('entity/', geo.id), ...src.grep('attachables/', geo.id)]) { const j = safe(src.text(r)); const d = (j?.['minecraft:client_entity'] ?? j?.['minecraft:attachable'])?.description; if (d && Object.values(typeof d.geometry === 'object' ? d.geometry : { d: d.geometry }).includes(geo.id)) { desc = d; break; } }
  if (useMct) {
    if (src.name !== 'rp' || file) die('--mct renders the addon\'s own client entities only');
    const f = files(path.join(RP, 'models'), (x) => x.endsWith('.json')).find((x) => fs.readFileSync(x, 'utf8').includes(geo.id));
    const o = path.join(LAB, 'render', geo.id.replace(/^geometry\./, '') + '.mct.png');
    (await X()).render(CACHE, ADDON, RP, path.relative(RP, f), o, Number(size) || 256);
    out(`OK ${rel(o)} (Creator Tools; its x is not mirrored like the game's: trust the default render for sides)`);
    return true;
  }
  // the texture
  let texBuf = null, texName = texOpt;
  if (texOpt) texBuf = fs.readFileSync([path.resolve(texOpt), path.resolve(RP, texOpt), path.resolve(ADDON, texOpt)].find(exists) ?? die(`no ${texOpt}`));
  let texExt = '.png';
  if (!texOpt && desc?.textures) { texName = pickOne(desc.textures); texBuf = src.bin(texName + '.png'); if (!texBuf) { texBuf = src.bin(texName + '.tga'); texExt = '.tga'; } }
  else if (texOpt && /\.tga$/i.test(texOpt)) texExt = '.tga';
  const texFile = texBuf ? path.join(LAB, 'render', 'tex' + texExt) : null;
  if (texBuf) fs.writeFileSync(texFile, texBuf);
  // the pose
  let pose = {};
  if (anim) {
    const [id, at] = anim.split('@');
    let a = null;
    for (const r of src.grep('animations/', `"${id}"`)) { const j = safe(src.text(r)); if (j?.animations?.[id]) { a = j.animations[id]; break; } }
    if (!a) die(`no animation ${id} (${desc ? Object.values(desc.animations ?? {}).filter((n) => n.startsWith('animation.')).slice(0, 30).join(' ') : 'rp/animations'})`);
    pose = M.poseAt(a, at === undefined ? undefined : Number(at));
  }
  const o = path.join(LAB, 'render', (q.replace(/^.*[:/]/, '').replace(/\.geo\.json$|\.json$/, '') || 'model') + (anim ? '.' + anim.replace(/[^\w.@-]+/g, '_') : '') + '.png');
  const vs = (views ?? 'front34,side,rear34,top').split(',');
  try { M.renderModel(geo, texFile, o, { views: vs, pose }); } catch (e) { die(e.message); }
  const lint = M.lintGeo(geo, pose);
  if (src.name === 'rp' || file) { lint.errs.slice(0, 8).forEach((e) => out('W ' + e)); if (lint.errs.length > 8) out(`W ... +${lint.errs.length - 8}`); }   // vanilla models rely on animations: not linted
  const grid = vs.length > 1 ? vs.reduce((acc, v, i) => acc + (i === 0 ? '' : i % 2 ? ' | ' : ' / ') + v, '') : vs[0];
  out(`OK ${rel(o)} ${geo.id} ${lint.cubes} cubes ${texName ? '' : '(no texture: grey) '}views ${grid}${anim ? ' pose ' + anim : ''} (the game's view: x mirrored; read the image)`);
  return true;
}
// ui build <layout.yaml>: a pixel layout (MCBE-UI's IR: elements with anchor/pos/size + symmetry/alignment constraints) solved and
// compiled into rp/ui/<screen>.json by shawtymarco/MCBE-UI's own tools (fetched on first use), registered in _ui_defs, plus a layout preview PNG
async function uiCmd(args) {
  const [sub, file] = args;
  if (sub !== 'build' || !file) die('usage: node lab.mjs ui build <layout.yaml>   (format: node lab.mjs help ui)');
  const src = [path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), file), path.resolve(file), path.resolve(ADDON, file)].find(exists) ?? die(`no ${file}`);
  const kit = path.join(CACHE, 'mcbe-ui');
  if (!exists(path.join(kit, 'node_modules', 'yaml'))) {
    if (!exists(path.join(kit, 'tools'))) { const r = spawnSync('git', ['clone', '-q', '--depth', '1', 'https://github.com/shawtymarco/MCBE-UI.git', kit], { encoding: 'utf8' }); if (r.status !== 0) die('ui build needs git + github.com: ' + (r.stderr || '').trim()); }
    const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: kit, encoding: 'utf8', shell: WIN });
    if (r.status !== 0) die('ui build: npm install failed in ' + rel(kit) + ': ' + (r.stderr || '').trim().slice(0, 300));
  }
  const name = path.basename(src).replace(/\.(ya?ml|json)$/i, '');
  const ws = path.join(kit, 'workspace', `${path.basename(ADDON)}_${name}`);
  fs.rmSync(ws, { recursive: true, force: true }); fs.mkdirSync(ws, { recursive: true });
  fs.copyFileSync(src, path.join(ws, 'ir.yaml'));
  const run = (tool, ...a) => spawnSync(process.execPath, [path.join(kit, 'tools', tool), ...a], { cwd: kit, encoding: 'utf8', env: { ...process.env, MCBEKIT_LOG: 'text' } });
  const r = run('run.mjs', path.join(ws, 'ir.yaml'));
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => /\[(ERR|WARN|FAIL)/.test(l) || /error/i.test(l)).map((l) => l.replace(/\s+/g, ' ').trim()).slice(0, 15);
  if (!exists(path.join(ws, 'ui.json'))) { lines.forEach((l) => out('E ' + l)); die('ui build failed (see docs: .lab/mcbe-ui/docs/41-ir-spec.md)'); }
  lines.forEach((l) => out('W ' + l));
  const ui = JSON.parse(fs.readFileSync(path.join(ws, 'ui.json'), 'utf8'));
  const dst = path.join(RP, 'ui', `${ui.namespace ?? name}.json`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(ui, null, 2) + '\n');
  const defsF = path.join(RP, 'ui', '_ui_defs.json'), defs = exists(defsF) ? readJson(defsF) : { ui_defs: [] }, entry = `ui/${path.basename(dst)}`;
  if (!(defs.ui_defs ??= []).includes(entry)) { defs.ui_defs.push(entry); fs.writeFileSync(defsF, JSON.stringify(defs, null, 2) + '\n'); }
  // the layout preview (boxes and names at their solved places), cropped to what is drawn
  run('render.mjs', path.join(ws, 'ui.json'), path.join(ws, 'solved.json'));
  let prev = '';
  if (exists(path.join(ws, 'preview.png'))) {
    const E = await X(); const img = E.pngDecode(fs.readFileSync(path.join(ws, 'preview.png')));
    const bg = img.data.subarray(0, 4); let x0 = img.w, y0 = img.h, x1 = 0, y1 = 0;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const o = (y * img.w + x) * 4; if (Math.abs(img.data[o] - bg[0]) + Math.abs(img.data[o + 1] - bg[1]) + Math.abs(img.data[o + 2] - bg[2]) > 12) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    if (x1 >= x0) { x0 = Math.max(0, x0 - 8); y0 = Math.max(0, y0 - 8); x1 = Math.min(img.w - 1, x1 + 8); y1 = Math.min(img.h - 1, y1 + 8); const w = x1 - x0 + 1, h = y1 - y0 + 1, d = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) img.data.copy(d, y * w * 4, ((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x1 + 1) * 4); prev = path.join(LAB, 'render', `ui_${name}.png`); fs.mkdirSync(path.dirname(prev), { recursive: true }); fs.writeFileSync(prev, E.pngEncode({ w, h, data: d })); }
  }
  const warns = []; await lintUiPack(warns); warns.filter((w) => w.includes(path.basename(dst))).forEach((w) => out('W ' + w));
  out(`OK ${rel(dst)} (namespace ${ui.namespace}, in _ui_defs.json)${prev ? ` preview ${rel(prev)} (layout boxes, not the game's look)` : ''}`);
  return true;
}
const unitVersion = () => (F.unitVersion ? F.unitVersion(L()) : readJson(path.join(BP, 'manifest.json')).header.version);
async function packFiles() {
  let mcaddon;
  if (F.commands?.pack) { mcaddon = await F.commands.pack(L(), []); if (!mcaddon || mcaddon === true) return null; }
  else { if (!(await pack([]))) return null; mcaddon = path.join(ROOT, 'dist', `${packFileName(readJson(path.join(BP, 'manifest.json')))}.mcaddon`); }
  const src = [];
  for (const f of files(ADDON, (x) => !x.includes(`${path.sep}.lab${path.sep}`) && !x.includes(`${path.sep}node_modules${path.sep}`))) src.push({ name: `${path.basename(ADDON)}/${path.relative(ADDON, f).split(path.sep).join('/')}`, data: fs.readFileSync(f) });
  const source = path.join(ROOT, 'dist', `${path.basename(ADDON)}-source.zip`);
  fs.writeFileSync(source, zip(src));
  return { mcaddon, source, version: unitVersion() };
}

// ---------- doctor: everything the labs fetch or run, checked at once, with the way around each blocked one ----------
// For an AI on a new machine: one command says what works, what is missing (and the command that installs it) and what is
// blocked by the network (not fixable in code: the env var / file that brings it in anyway). Never downloads anything big.
async function probe(url, timeoutMs = 8000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0' } });
    const deny = r.headers.get('x-deny-reason');
    if (deny) return { ok: false, blocked: true, why: `blocked by the network proxy (${deny})` };
    return r.status < 500 && r.status !== 403 && r.status !== 407 ? { ok: true, why: `HTTP ${r.status}` } : { ok: false, blocked: r.status === 403 || r.status === 407, why: `HTTP ${r.status}` };
  } catch (e) { return { ok: false, blocked: true, why: ac.signal.aborted ? `no answer in ${timeoutMs / 1000}s` : (e.cause?.code ?? e.message) }; }
  finally { clearTimeout(t); }
}
// what kind of machine this is, for any AI: OS/CPU, container or not, can it install packages (root / sudo / none), which package manager
function hostInfo(has) {
  const plat = process.platform, arch = process.arch;
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  const sudo = !root && plat !== 'win32' && spawnSync('sudo', ['-n', 'true'], { timeout: 5000 }).status === 0;
  const priv = plat === 'win32' || plat === 'darwin' ? '' : root ? '' : sudo ? 'sudo ' : null;   // null = cannot install system packages
  const pm = plat === 'win32' ? (has('winget') ? 'winget' : null) : plat === 'darwin' ? (has('brew') ? 'brew' : null)
    : ['apt-get', 'dnf', 'apk', 'pacman'].find((c) => spawnSync('sh', ['-c', `command -v ${c}`], { timeout: 5000 }).status === 0)?.replace('-get', '') ?? null;
  let container = '';
  if (plat === 'linux') { try { if (fs.existsSync('/.dockerenv')) container = 'docker'; else { const cg = fs.readFileSync('/proc/1/cgroup', 'utf8'); if (/docker|containerd|kubepods|lxc/.test(cg)) container = 'container'; } } catch { /* ok */ } if (!container && process.env.container) container = process.env.container; }
  let diskGB = null; try { const st = fs.statfsSync(CACHE_ROOT_FOR_DISK()); diskGB = (st.bavail * st.bsize) / 1e9; } catch { /* old node */ }
  const memGB = os.totalmem() / 1e9, cpus = os.cpus().length;
  const cmd = { apt: (p) => `apt-get install -y ${p}`, dnf: (p) => `dnf install -y ${p}`, apk: (p) => `apk add ${p}`, pacman: (p) => `pacman -S --noconfirm ${p}`, brew: (p) => `brew install ${p}`, winget: (p) => `winget install ${p}` };
  const install = (pk) => {
    const p = pk[pm] ?? pk.apt;
    if (!pm || !p) return `install ${Object.values(pk)[0]} with this system's package manager`;
    if (priv === null) return `${cmd[pm](p)} needs root: no root and no passwordless sudo here, so ask a person to run it (or use a machine/image where you are root)`;
    return (pm === 'apt' ? `${priv}apt-get update && ` : '') + priv + cmd[pm](p);
  };
  const summary = `${plat}/${arch}${container ? ' in a ' + container : ''}, ${cpus} CPU, ${memGB.toFixed(1)} GB RAM${diskGB !== null ? `, ${diskGB.toFixed(1)} GB free` : ''} | install: ${pm ?? 'no package manager found'}${priv === null ? ' (no root, no sudo)' : root ? ' (root)' : sudo ? ' (sudo)' : ''}`;
  return { plat, arch, root, sudo, priv, pm, container, diskGB, memGB, cpus, install, summary };
}
const CACHE_ROOT_FOR_DISK = () => { let d = CACHE; while (!fs.existsSync(d)) d = path.dirname(d); return d; };

async function doctor() {
  const rows = [], row = (state, what, detail, fix = '') => rows.push({ state, what, detail, fix });
  const has = (cmd, args = ['--version']) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000 }); return r.status === 0 ? (r.stdout || r.stderr).trim().split('\n')[0] : null; };
  const labs = ['bds', 'end', 'll'];
  // the machine: install hints must be commands this AI can actually run here (root or sudo, which package manager)
  const E = hostInfo(has);
  row('INFO', 'machine', E.summary);
  if (E.diskGB !== null && E.diskGB < 3) row('MISSING', 'disk space', `${E.diskGB.toFixed(1)} GB free here`, 'about 3 GB per lab (server + world + tools): free space, or LAB_CACHE=<a bigger disk>');
  const inst = (pk) => E.install(pk);
  // local tools
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  row(nodeMajor >= 22 ? 'OK' : 'MISSING', 'node', process.version, nodeMajor >= 22 ? '' : 'Node.js 22+ (nodejs.org)');
  row(has(WIN ? 'npm.cmd' : 'npm') ? 'OK' : 'MISSING', 'npm', has(WIN ? 'npm.cmd' : 'npm') ?? 'not found', 'comes with Node.js');
  let v6 = true; if (process.platform === 'linux') try { v6 = !!fs.readFileSync('/proc/net/if_inet6', 'utf8').trim(); } catch { v6 = false; }
  const cc = ['cc', 'gcc', 'clang'].map((c) => has(c)).find(Boolean);
  if (process.platform === 'linux') row(v6 ? 'OK' : cc ? 'OK' : 'MISSING', 'IPv6 / shim', v6 ? 'kernel has IPv6' : `no IPv6: the lab preloads common/ipv6-shim.c${cc ? ` (compiler: ${cc.split(' ')[0]})` : ''}`, v6 || cc ? '' : inst({ apt: 'gcc libc6-dev', dnf: 'gcc', apk: 'gcc musl-dev', pacman: 'gcc' }) + ' (the shim needs a C compiler)');
  const py = ['python3', 'python'].map((c) => { const v = has(c, ['-c', 'import sys;print("%d.%d"%sys.version_info[:2])']); return v ? { c, v } : null; }).find(Boolean);
  const pyOk = py && Number(py.v.split('.')[0]) === 3 && Number(py.v.split('.')[1]) >= 10;
  const portable = ['linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'].includes(`${process.platform}-${process.arch}`);
  row(pyOk || process.platform === 'darwin' ? 'OK' : portable ? 'INFO' : 'MISSING', 'python (end)', py ? `${py.c} ${py.v}` : 'not found', pyOk || process.platform === 'darwin' ? '' : (portable ? 'none needed: setup fetches a portable Python 3.12 (GitHub); or ' : '') + inst({ apt: 'python3 python3-venv', dnf: 'python3', apk: 'python3 py3-virtualenv', pacman: 'python', brew: 'python', winget: 'Python.Python.3.12' }));
  if (process.platform === 'linux') { const w = has('wine64') ?? has('wine'); row(w || process.env.LAB_LL_SERVER ? (w && Number(/wine-(\d+)/.exec(w)?.[1] ?? 10) < 10 && !process.env.LAB_WINE ? 'INFO' : 'OK') : 'MISSING', 'wine (ll)', w ? (Number(/wine-(\d+)/.exec(w)?.[1] ?? 10) < 10 && !process.env.LAB_WINE ? `${w}: too old for BDS (stalls with a player); ll setup fetches a portable Wine 10 into ll/.lab` : w) : (process.env.LAB_LL_SERVER ? 'LAB_LL_SERVER set' : 'not found'), w ? '' : (E.pm === 'apt' && E.priv !== null ? `${E.priv}apt-get update && ${E.priv}apt-get install -y wine winetricks cabextract` : inst({ dnf: 'wine', pacman: 'wine', apk: 'wine' })) + '   (or LAB_RUNTIME=docker, or LAB_LL_SERVER=<a LeviLamina server on Windows>)'); }
  if (process.platform === 'linux') {   // LAB_SPEED (a sped-up server clock) needs it; optional
    const ftl = [process.env.LAB_FAKETIME_LIB, '/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1', '/usr/lib/aarch64-linux-gnu/faketime/libfaketimeMT.so.1', '/usr/local/lib/faketime/libfaketimeMT.so.1', '/usr/lib64/faketime/libfaketimeMT.so.1'].find((x) => x && exists(x));
    row(ftl ? 'OK' : 'INFO', 'libfaketime (LAB_SPEED)', ftl ?? 'not found: the server runs at 1x only', ftl ? '' : inst({ apt: 'faketime', dnf: 'libfaketime', pacman: 'libfaketime', apk: 'libfaketime' }));
  }
  const px = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  row('INFO', 'network proxy', px ? `${px.replace(/\/\/[^@/]*@/, '//***@')} (Node follows it: NODE_USE_ENV_PROXY=${process.env.NODE_USE_ENV_PROXY ?? 'unset'}${process.env.NODE_EXTRA_CA_CERTS ? ', CA ' + process.env.NODE_EXTRA_CA_CERTS : ''})` : 'none (direct)');
  const dk = has('docker', ['version', '--format', '{{.Server.Version}}']);
  row(dk ? 'OK' : process.platform === 'darwin' ? 'MISSING' : 'INFO', 'docker', dk ? `server ${dk}` : 'no daemon', process.platform === 'darwin' ? 'Docker Desktop (Rosetta on) | OrbStack | colima' : 'only for LAB_RUNTIME=docker');
  // the network: what each lab downloads, and the way around each one
  const bdsGiven = process.env.LAB_BDS_ZIP ? `LAB_BDS_ZIP=${process.env.LAB_BDS_ZIP}` : labs.map((l) => path.join(TOP, l, 'vendor', 'bedrock-server.zip')).find((f) => exists(f) && fs.statSync(f).size > 1e6);
  const npmReg = process.env.npm_config_registry || 'https://registry.npmjs.org';
  const pipIdx = process.env.PIP_INDEX_URL || 'https://pypi.org/simple';
  const net = [
    ['BDS latest version', 'bds end', 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links', 'not needed: the version list in common/data/bds-versions.json is used'],
    ['BDS download (CDN)', 'bds end', `${knownBds()?.cdn_root ?? 'https://www.minecraft.net/bedrockdedicatedserver'}/bin-linux/`, bdsGiven ? `already provided: ${rel(String(bdsGiven))}` : 'LAB_BDS_ZIP=<path or URL of bedrock-server-<ver>.zip> (download it where the network is open), or <lab>/vendor/bedrock-server.zip'],
    ['npm registry', 'all', npmReg.replace(/\/?$/, '/bedrock-protocol'), 'npm_config_registry=<an npm mirror>, or copy a working <lab>/.lab/node folder from another machine'],
    ['PyPI (Endstone)', 'end', pipIdx.replace(/\/?$/, '/endstone/'), 'PIP_INDEX_URL=<a PyPI mirror> or pip install endstone==<ver> from a wheel file into end/.lab/py'],
    ...(process.env.LAB_GITHUB_MIRROR ? [['GitHub mirror', 'll', `${process.env.LAB_GITHUB_MIRROR.replace(/\/$/, '')}/https://github.com/futrime/lip/releases/latest`, 'LAB_GITHUB_MIRROR must take a full https://github.com/... URL after it (e.g. https://ghfast.top)']] : [
      ['GitHub API', 'll end', 'https://api.github.com/repos/futrime/lip/releases/latest', 'LAB_GITHUB_MIRROR=<a GitHub mirror, e.g. https://ghfast.top>; GITHUB_TOKEN=<token> if rate-limited; ll: LAB_LIP_URL=<lip win-x64 zip> or LAB_LL_SERVER=<LeviLamina server folder/zip>'],
      ['GitHub downloads', 'll, NetherNet', 'https://github.com/futrime/lip/releases/latest', 'll: LAB_GITHUB_MIRROR=<a GitHub mirror, e.g. https://ghfast.top> or LAB_LL_SERVER; NetherNet players need node-datachannel\'s prebuilt binary from GitHub: copy <lab>/.lab/node-rtc from another machine']]),
  ];
  const res = await Promise.all(net.map(([, , url]) => probe(url)));
  net.forEach(([what, who, url, fix], i) => { const r = res[i]; row(r.ok ? 'OK' : r.blocked ? 'BLOCKED' : 'FAIL', `${what} [${who}]`, `${new URL(url).host}: ${r.why}`, r.ok ? '' : fix); });
  if (res.some((r) => /CERT|certificate/i.test(r.why ?? ''))) row('BLOCKED', 'TLS certificate', 'something on the network re-signs HTTPS (a proxy or antivirus) and Node does not trust its CA', 'SSL_CERT_FILE=<that CA or the system bundle, .pem> (the lab passes it to Node, npm, pip), then doctor again');
  const w = Math.max(...rows.map((r) => r.what.length));
  for (const r of rows) out(`${r.state.padEnd(7)} ${r.what.padEnd(w)}  ${r.detail}${r.fix && r.state !== 'OK' ? `\n${' '.repeat(8 + w + 2)}→ ${r.fix}` : ''}`);
  // per lab: can it set up here?
  const bad = (re) => rows.filter((r) => /BLOCKED|FAIL|MISSING/.test(r.state) && re.test(r.what));
  const need = { bds: bad(/^(node|npm|IPv6|BDS download|npm registry)/), end: bad(/^(node|npm|python|PyPI|BDS download|npm registry)/), ll: bad(/^(node|npm|wine|GitHub|npm registry)/) };
  if (bdsGiven) for (const l of ['bds', 'end']) need[l] = need[l].filter((r) => !/BDS download/.test(r.what));
  for (const l of labs) out(`${l}: ${need[l].length ? 'cannot set up here yet: ' + need[l].map((r) => r.what.replace(/ \[.*/, '')).join(', ') : 'ready to set up'}`);
  const blocked = rows.some((r) => r.state === 'BLOCKED');
  if (blocked) out('BLOCKED items are the network, not the code: ask a person for the → way in, then run doctor again.');
  // --fix: run the install commands of the MISSING rows that this machine can run by itself (root / passwordless sudo), then look again
  if (ARGV.includes('--fix') && !process.env.LAB_DOCTOR_FIXED) {
    const runnable = rows.filter((r) => r.state === 'MISSING' && /^(sudo )?(apt-get|dnf|apk|pacman|brew|winget) /.test(r.fix)).map((r) => [r.what, r.fix.split('   (')[0].split(' (the ')[0]]);
    if (!runnable.length) out('fix: nothing here can be installed by the lab itself (the → lines say what a person does)');
    for (const [what, c] of runnable) { out(`fix: ${what}: ${c}`); const r = spawnSync(c, { shell: true, stdio: 'inherit', timeout: 20 * 60_000 }); out(`fix: ${what}: ${r.status === 0 ? 'OK' : 'FAILED'}`); }
    if (runnable.length) { const r = spawnSync(process.execPath, [process.argv[1], 'doctor'], { stdio: 'inherit', env: { ...process.env, LAB_DOCTOR_FIXED: '1' } }); return r.status === 0; }
  }
  const ok = !Object.values(need).some((x) => x.length);
  if (ARGV.includes('--json')) { const j = JSON.stringify({ ok, machine: { ...E, install: undefined }, rows, labs: Object.fromEntries(labs.map((l) => [l, need[l].map((r) => r.what)])) }); fs.mkdirSync(LAB, { recursive: true }); fs.writeFileSync(path.join(LAB, 'doctor.json'), j + '\n'); out(`json: ${rel(path.join(LAB, 'doctor.json'))}`); }
  out(ok ? 'OK' : 'FAIL');
  return ok;
}

// ---------- selftest: the whole lab on the real server, one report ----------
// setup → a throwaway unit (labselftest) → tests.txt = what every lab shares (real player, verbs, versions) + the flavor's own
// (F.selftest) → report in .lab/selftest.txt. Any AI (or a person) runs it once; the report says what works here.
const SELFTEST_COMMON = (old) => `## real player joins
@A join
~ ^@A joined
## chat reaches the server
@A chat selftest-hello
~ selftest-hello
## a client command
@A cmd say via-client
~ via-client
## verb place: the item is picked from the inventory like a person does
give A dirt 4
@A place dirt 2 -60 2
testforblock 2 -60 2 dirt
~ (?i)successfully found|found the block
## verb till
give A iron_hoe
@A till 3 -61 3
testforblock 3 -61 3 farmland
~ (?i)successfully found|found the block
## verb equip
give A iron_helmet
@A equip iron_helmet
@A inv
~ worn head:minecraft:iron_helmet
${old ? `## an older client (${old}) is refused like a real one
@B join version=${old}
~ @B refused|B .*(did not spawn|closed)
` : ''}`;
async function selftest(rest) {
  const name = 'labselftest', dir = path.join(ADDONS, name), me = process.argv[1], cur = path.join(LAB, 'addon');
  const keepCur = exists(cur) ? fs.readFileSync(cur, 'utf8') : null;
  const env = { ...process.env }; delete env.LAB_ADDON;
  const run = (args, extra = {}) => { const r = spawnSync(process.execPath, [me, ...args], { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8', maxBuffer: 256e6 }); return { ok: r.status === 0, text: ((r.stdout ?? '') + (r.stderr ?? '')).trim() }; };
  const report = [`selftest ${F.name} | ${process.platform}-${os.arch()} | node ${process.version} | server side: ${RT.describe()}`];
  const fin = (ok) => {
    fs.mkdirSync(LAB, { recursive: true }); fs.writeFileSync(path.join(LAB, 'selftest.txt'), report.join('\n') + '\n');
    if (keepCur !== null) fs.writeFileSync(cur, keepCur); else fs.rmSync(cur, { force: true });
    if (!rest.includes('--keep')) fs.rmSync(dir, { recursive: true, force: true });
    out(`report: ${rel(path.join(LAB, 'selftest.txt'))} ${ok ? '' : '(fix: common/ or the flavor, then tests/offline.mjs + selftest again; ../AGENTS.md)'}`);
    out(ok ? 'PASS' : 'FAIL'); return ok;
  };
  out(`selftest ${F.name}: setup (first time: downloads the server)...`);
  let r = run(['setup']); report.push('== setup', r.text);
  // the server is fine but the real client's parts are not (npm): go on without real players, say so
  const noClient = !r.ok && /bedrock-protocol|real player/i.test(r.text);
  if (!r.ok) out(r.text.split('\n').slice(-8).join('\n'));
  if (!r.ok && !noClient) { const hint = 'next: node lab.mjs doctor (what is missing or blocked here, and the way around each)'; report.push(hint); out(hint); return fin(false); }
  if (noClient) out('W real players unavailable (above): the sections without them run; fix that and run selftest again');
  fs.rmSync(dir, { recursive: true, force: true });
  r = run(['new', name, 'Lab Selftest', ...(F.name === 'bds' ? ['--js'] : [])]); report.push('== new', r.text);
  if (!r.ok) { out(r.text); return fin(false); }
  let old = null;
  if (!noClient) try { const d = await realDeps(); old = d.versions.filter((v) => vcmp3(v, '1.21.0') >= 0 && vcmp3(v, d.ver) < 0).sort(vcmp3)[0] ?? null; } catch (e) { report.push('== real player deps', String(e.message)); }
  let spec = SELFTEST_COMMON(old) + (F.selftest ?? '');
  if (noClient) spec = spec.split(/^(?=## )/m).filter((sec) => !/^@/m.test(sec)).join('');
  fs.writeFileSync(path.join(dir, 'tests.txt'), spec);
  out(`selftest ${F.name}: running ${spec.match(/^## /gm).length} sections on the server...`);
  r = run(['test', '-a', name]); report.push('== test', r.text);
  if (noClient) r.ok = false;   // not complete
  // the same server on NetherNet (WebRTC): a real player joins through HTTP signaling + data channels
  const nnSkip = F.netherNetSkip?.(L());   // a platform that cannot do NetherNet here says why
  if (nnSkip && !rest.includes('--no-nethernet')) { report.push('== nethernet', 'skipped: ' + nnSkip); out('nethernet: skipped: ' + nnSkip); }
  if (!noClient && !nnSkip && !rest.includes('--no-nethernet')) {
    fs.writeFileSync(path.join(dir, 'tests-nn.txt'), '## NetherNet: a real player joins over WebRTC\n@N join\n~ ^@N joined\n~ @N nethernet: server key\n## NetherNet: chat reaches the server\n@N chat nn-hello\n~ nn-hello\n');
    out(`selftest ${F.name}: the same server on NetherNet...`);
    const n = run(['test', '-a', name, path.join(dir, 'tests-nn.txt')], { LAB_TRANSPORT: 'nethernet' });
    report.push('== nethernet', n.text);
    n.text.split('\n').filter((l) => /^✘|^(PASS|FAIL) /.test(l)).slice(0, 10).forEach((l) => out('nethernet: ' + l));
    r.ok = r.ok && n.ok;
  }
  const lines = r.text.split('\n');
  lines.filter((l, i) => /^✘|^E |^(PASS|FAIL) /.test(l) || /^✘/.test(lines[i - 1] ?? '')).slice(0, 40).forEach((l) => out(l));
  // the kit every new addon gets (common/kit): its own tests with real players, beta and stable APIs, then go (qa + pack)
  if (F.name === 'bds' && !noClient && !rest.includes('--no-kit')) {
    const kd = path.join(ADDONS, 'labkit'), fx = path.join(LIBDIR, 'kit', 'test');
    fs.rmSync(kd, { recursive: true, force: true });
    const steps = [['new', 'labkit', 'Lab Kit', 'kit selftest'], ...fs.readFileSync(path.join(fx, 'setup.txt'), 'utf8').trim().split('\n').map((l) => l.match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, '')))];
    let k = { ok: true, text: '' };
    for (const a of steps) { k = run(a[0] === 'new' ? a : [...a, '-a', 'labkit']); report.push(`== kit: ${a.join(' ')}`, k.text); if (!k.ok) break; }
    if (k.ok) {
      fs.copyFileSync(path.join(fx, 'main.ts'), path.join(kd, 'src', 'main.ts')); fs.copyFileSync(path.join(fx, 'tests.txt'), path.join(kd, 'tests.txt'));
      const m = readJson(path.join(kd, 'bp', 'manifest.json')); m.header.description = 'bds-lab kit selftest'; writeJson(path.join(kd, 'bp', 'manifest.json'), m);
      out(`selftest ${F.name}: kit (beta, stable, go)...`);
      for (const [label, args] of [['beta', ['test', '-a', 'labkit']], ['stable', null], ['go', ['go', '-a', 'labkit']]]) {
        if (!args) { k = run(['mode', 'stable', '-a', 'labkit']); report.push('== kit: mode stable', k.text); k = run(['test', '-a', 'labkit']); } else k = run(args);
        report.push(`== kit ${label}`, k.text);
        out(`kit ${label}: ${k.text.split('\n').filter((l) => /^(✘|Q |E |PASS|FAIL|DONE)/.test(l)).slice(0, 8).join('\n  ') || k.text.split('\n').at(-1)}`);
        if (!k.ok) break;
      }
    }
    if (!rest.includes('--keep')) fs.rmSync(kd, { recursive: true, force: true });
    r.ok = r.ok && k.ok;
  }
  return fin(r.ok);
}

// ---------- the flavor's view of the engine ----------
let CTX = null;
function L() {
  return (CTX ??= { F, RT, TOP, ROOT, CACHE, LAB, BDS, WIN, ADDONS, get ADDON() { return ADDON; }, BP, RP, LOG,
    out, die, sleep, exists, rel, files, readJson, writeJson, stripJsonComments, zip, unzip, get, crc32, png, packIcon, TASK_MD, B, tl, lineText,
    useAddon, addonNames, isUnit, lock, setup, bdsVersion, realDeps, ipv6Shim, knownBds,
    packsOf, init, pack, preflight, sapi: api, decls, query, render, spawn, spawnSync, randomUUID, crypto,
    killTree, sectionsOf, lockFile, writeLock, get addonArg() { return ADDON_ARG; }, needAddon, setRemap: (fn) => { REMAP = fn; }, X, parseArgs });
}

// ---------- main ----------
const USAGE = 'usage: node lab.mjs new <name> [Title] [--js] [--stable] [--no-rp] | use <name> | up [-k] | do <cmd..> | reload [--full] | down | run [cmd..] [-w ms] [-k] [-v] | test [file] | check [--deep] | build | api <q..> | doc <q> | sample <q> [keys] | proto <q> | render <q> | png <out> <palette> <rows..> | add item|block|entity <ns:id> [Name] | lib add|remove <pkg..> | mode beta|stable | import <mcaddon|dir> | init <name> [--rp] | pack [--bump] | ship | publish [--yes] | github [repo] | bundle [--release] | bds [--update|--preview|<version>] | setup [--update] | help [topic]   (-a <addon> picks the addon)';
const [cmd, ...rest] = ARGV;
let ok = true;
try {
  if (['go', 'brief', 'qa', 'run', 'test', 'up', 'do', 'reload', '__serve', 'render', 'ui', 'debug', 'check', 'build', 'mode', 'lib', 'pack', 'add', 'init', 'ship', 'publish', 'dispute', 'unlock', 'playtest', 'harden'].includes(cmd)) needAddon();
  // commands that rewrite a unit's files take a checkpoint first (node lab.mjs undo), quietly
  try { for (const l of (await import('./checkpoint.mjs')).recoverHolds(F.name)) out(l); } catch { /* best-effort */ }   // a unit a killed mutate left with a planted bug
  if (['mode', 'add', 'lib', 'png'].includes(cmd) && ADDON && exists(ADDON) && !process.env.LAB_NO_CHECKPOINT) try { (await import('./checkpoint.mjs')).save(F.name, path.basename(ADDON), `before ${cmd} ${rest.filter((a) => a !== '-a' && a !== path.basename(ADDON)).join(' ').slice(0, 60)}`); } catch { /* best-effort */ }
  if (F.commands?.[cmd]) ok = (await F.commands[cmd](L(), rest)) !== false;
  else if (cmd === 'run') ok = await run(rest);
  else if (cmd === 'up') ok = await up(rest);
  else if (cmd === 'do') ok = await doCmd(rest);
  else if (cmd === 'reload') { ok = await reload(rest); out(ok ? 'OK' : 'FAIL'); }
  else if (cmd === 'down') ok = await down();
  else if (cmd === '__serve') { await serve(rest); await new Promise(() => {}); }
  else if (cmd === 'test') ok = await test(rest);
  else if (cmd === 'qa') { const r = await qa({ built: !!process.env.LAB_QA_BUILT }); ok = r.ok; if (process.env.LAB_QA_JSON) fs.writeFileSync(process.env.LAB_QA_JSON, JSON.stringify(r)); }
  else if (cmd === 'go') ok = await go(rest);
  else if (cmd === 'make') ok = await (await import('./make.mjs')).make(L(), [...rest], { newAddon, go });
  else if (cmd === 'api') ok = await api(rest);
  else if (cmd === 'sample') ok = await sample(rest);
  else if (cmd === 'init') init(rest.find((a) => a !== '--rp'), rest.includes('--rp'));
  else if (cmd === 'pack') ok = await pack(rest);
  else if (cmd === 'png') png(rest);
  else if (cmd === 'add') ok = (await add(rest)) !== false;
  else if (cmd === 'check') {
    ok = await preflight({ jsTypes: true });   // prints FAIL itself
    if (ok && rest.includes('--deep') && exists(path.join(BP, 'manifest.json'))) { const r = (await X()).deepCheck(CACHE, packsOf()); r.errs.forEach((e) => out('E ' + e)); r.warns.slice(0, 25).forEach((e) => out('W ' + e)); ok = !r.errs.length; if (!ok) out('FAIL'); }
    if (ok) out('OK');
  }
  else if (cmd === 'help') {
    const topics = (f) => (exists(f) ? fs.readFileSync(f, 'utf8').split(/^## /m).filter(Boolean).map((x) => [x.split('\n')[0].trim(), x.slice(x.indexOf('\n') + 1).trim()]) : []);
    const own = topics(path.join(FDIR, 'help.md')), t = [...own, ...topics(path.join(LIBDIR, 'help.md')).filter(([k]) => !own.some(([o]) => o === k))];
    const hit = t.find(([k]) => k === rest[0]);
    if (rest[0] === 'verbs') {   // help verbs [word]: the real client's verbs (hand-written + one per item / block / mob) that match
      const cat = readJson(path.join(LIBDIR, 'data', 'everyday.json')), w = (rest[1] ?? '').toLowerCase();
      const gen = createRequire(import.meta.url)(path.join(LIBDIR, 'verbs-gen.cjs')).genNames(new Set(Object.keys(cat.verbs)));
      if (!w) {
        const by = {}; for (const e of Object.values(cat.verbs)) by[e.cat] = (by[e.cat] ?? 0) + 1;
        out(`${Object.keys(cat.verbs).length + gen.length} verbs: ${Object.keys(cat.verbs).length} by hand (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}) + ${gen.length} generated:`);
        for (const f of Object.values(cat.families ?? {})) out(`  ${f.use.padEnd(22)} ${String(f.count).padStart(5)}  ${f.ja}`);
        out('help verbs <word>: the ones that match (name, syntax or Japanese). Sample args and needed items: common/data/everyday.json');
      } else {
        const hand = Object.entries(cat.verbs).filter(([k, e]) => k.includes(w) || e.use.toLowerCase().includes(w) || e.ja.includes(rest[1]));
        for (const [, e] of hand.slice(0, 60)) out(`${e.use.padEnd(40)} ${e.ja}`);
        if (hand.length > 60) out(`... +${hand.length - 60} more`);
        const g = gen.filter(([v]) => v.includes(w));
        if (g.length) out(`generated (${g.length}): ${g.slice(0, 80).map(([v]) => v).join(' ')}${g.length > 80 ? ` ... +${g.length - 80}` : ''}`);
        if (!hand.length && !g.length) out(`no verb has "${rest[1]}" (help verbs: the families)`);
      }
    } else if (hit && rest[1]) {
      // help <topic> <word>: only the parts of the topic that name the word (a topic is a few long lines of items joined by
      // " | " or " · "; the whole of `help player` is ~3,800 tokens that every later turn re-sends)
      const w = rest.slice(1).join(' ').toLowerCase(), segs = [];
      for (const line of hit[1].split('\n')) { const head = /^[^:|·]{2,40}: /.exec(line)?.[0] ?? ''; for (const sg of line.split(/ \| | · |; (?=[`@a-z])/)) if (sg.toLowerCase().includes(w)) segs.push((head && !sg.startsWith(head) ? head : '') + sg.trim()); }
      if (segs.length) segs.slice(0, 30).forEach((x) => out(x.length > 400 ? x.slice(0, 400) + '…' : x));
      else out(`help ${rest[0]}: nothing about "${rest.slice(1).join(' ')}" (node lab.mjs help ${rest[0]} prints all of it)`);
      if (segs.length > 30) out(`… +${segs.length - 30} more (a narrower word)`);
    } else if (hit) out(hit[1]);
    else {
      // not a topic: the lines of any topic that name it (help i18n → the `node lab.mjs i18n` line), then the topics
      const w = String(rest[0] ?? '').toLowerCase(), wre = new RegExp(`(^|[^\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`), found = w ? t.flatMap(([k, body]) => body.split('\n').filter((l) => wre.test(l.toLowerCase())).map((l) => [k, l])) : [];   // a whole word: help go is not every line with goto
      const best = found.filter(([, l]) => l.toLowerCase().includes(`lab.mjs ${w}`) || l.toLowerCase().includes('`' + w)).concat(found).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4);
      for (const [k, l] of best) out(`(help ${k}) ${l.length > 600 ? l.slice(0, 600) + '…' : l}`);
      out(`topics: ${t.map(([k]) => k).join(' ')} verbs (AGENTS.md has the rest)`);
    }
  }
  else if (cmd === 'debug') {
    // VS Code + Mojang's minecraft-debugger on the live server: a launch config per addon, then BDS connects to it
    const f = path.join(ROOT, '.vscode', 'launch.json');
    let j = { version: '0.2.0', configurations: [] }; try { j = readJson(f); } catch { /* new */ }
    const nm = `bds-lab: ${path.basename(ADDON)}`, r = (x) => '${workspaceFolder}/' + path.relative(ROOT, x).split(path.sep).join('/') + '/';
    const cfg = { type: 'minecraft-js', request: 'attach', name: nm, mode: 'listen', port: 19144, ...(B.entryOf(ADDON) ? { sourceMapRoot: r(path.join(LAB, 'debug', path.basename(ADDON))), generatedSourceRoot: r(path.join(BP, 'scripts')) } : { localRoot: r(BP) }) };
    j.configurations = [...(j.configurations ?? []).filter((c) => c.name !== nm), cfg];
    writeJson(f, j);
    writeJson(path.join(ROOT, '.vscode', 'extensions.json'), { recommendations: ['mojang-studios.minecraft-debugger'] });
    out(`OK .vscode/launch.json "${nm}": start it in VS Code (Run and Debug), then: node lab.mjs do "script debugger connect ${RT.serverHost} 19144"`);
  }
  else if (cmd === 'doc') {
    // vanilla data first (/command, block states, item/entity ids, `order`), then Mojang's component / Molang docs
    const x = await X(), q = rest[0] ?? '';
    // (no word: its usage at once — it used to fetch the BDS first, and with no network said that instead)
    if (!q) x.doc(CACHE, rest, out);
    await ensureBds();
    const sv = (() => { try { return readJson(path.join(BP, 'manifest.json')).dependencies.find((d) => d.module_name === '@minecraft/server')?.version; } catch { return undefined; } })();
    let v = null;
    if (q && !q.startsWith('?') && !/^(query|variable|math|context)\./.test(q)) v = await x.vanillaDoc(CACHE, bdsVersion(), q, sv, out);
    if (v === true && !rest[1]) { const f = x.doc(CACHE, rest, () => {}); ok = true; if (f) out('(component docs too: node lab.mjs doc ' + q + ' <category>)'); }
    else if (v === false) ok = false;
    else {
      const lines = [];
      ok = x.doc(CACHE, rest, (l) => lines.push(l));
      const h = q.startsWith('?') ? await x.vanillaSearch(CACHE, bdsVersion(), q.slice(1).toLowerCase()) : [];
      if (!(h.length && lines.length === 1 && /^none/.test(lines[0]))) lines.forEach((l) => out(l));
      if (h.length) { out('vanilla: ' + h.slice(0, 50).join(' ') + (h.length > 50 ? ` ... +${h.length - 50}` : '')); ok = true; }
    }
  }
  else if (cmd === 'example') ok = await (await X()).example(CACHE, rest, out);
  else if (cmd === 'proto') { await ensureBds(); ok = await (await X()).proto(CACHE, bdsVersion().split('.').slice(0, 3).join('.'), rest, out); }
  else if (cmd === 'render') ok = await renderCmd(rest);
  else if (cmd === 'ui') ok = await uiCmd(rest);
  else if (cmd === 'build') { ok = await preflight({ types: !rest.includes('--fast') }); if (ok) out('OK built'); }
  else if (cmd === 'mode') await modeCmd(rest);
  else if (cmd === 'lib') libCmd(rest);
  else if (cmd === 'new') await newAddon(rest);
  else if (cmd === 'use') useAddon(rest[0]);
  else if (cmd === 'dispute') dispute(rest);
  else if (cmd === 'unlock') unlockCmd(rest);
  else if (cmd === 'playtest') ok = await (await import('./make.mjs')).playtest(L(), [...rest]);
  else if (cmd === 'harden') {   // = make -a <current unit> --harden [n] (the AI adds tests to what mutate and gaps find missing)
    const ni = rest.findIndex((a, i) => /^\d+$/.test(a) && !['--via', '--model', '--turns', '--budget', '-a', '--edit'].includes(rest[i - 1])), n = ni >= 0 ? rest.splice(ni, 1) : [];
    ok = await (await import('./make.mjs')).make(L(), ['--harden', ...n, ...rest, ...(ADDON_ARG || rest.includes('--edit') ? [] : ['--edit', path.basename(ADDON)])], { newAddon, go });
  }
  else if (cmd === 'import') await importAddon(rest);
  else if (cmd === 'brief') ok = await brief(rest);
  else if (cmd === 'bds') { await lock(); await bdsCmd(rest); }
  else if (cmd === 'github') { const G = (await gh()).makeGit(GITROOT, LAYOUT()); G.setup({ repoName: rest.find((a) => !a.startsWith('-')) ?? path.basename(GITROOT), addons: addonNames(), say: out }); }
  // someone else's addon (colony harvest / borrow: imported.json borrowed) never goes out: stopped before anything is written
  else if ((cmd === 'ship' || cmd === 'publish') && (await import('./borrow.mjs')).borrowedAs(ADDON)) { const B = await import('./borrow.mjs'); die(B.refusal(cmd, [{ rel: path.relative(TOP, ADDON).split(path.sep).join('/'), mark: B.borrowedAs(ADDON) }])); }
  else if (cmd === 'ship') { const f = await packFiles(); ok = !!f && (await (await gh()).ship({ ROOT: GITROOT, layout: LAYOUT(), ADDON, name: path.basename(ADDON), ...f, zip, unzip, say: out })); }
  else if (cmd === 'publish') {
    const f = await packFiles();
    let report = null; try { report = JSON.parse(fs.readFileSync(path.join(LAB, 'report.json'), 'utf8')); if (report.addon !== path.basename(ADDON)) report = null; } catch { /* never tested */ }
    ok = !!f && (await (await gh()).publish({ ROOT: GITROOT, layout: LAYOUT(), ADDON, name: path.basename(ADDON), mcaddon: f.mcaddon, version: f.version, report, yes: rest.includes('--yes'), zip, say: out }));
  }
  else if (cmd === 'bundle') {
    if (F.name !== 'bds') die('bundle: bds lab only (the work zip carries the plain BDS)');
    // the work zip carries every unit: a borrowed one stops it (--skip-borrowed: made without them)
    const BU = (await import('./borrow.mjs')).borrowedUnits(GITROOT);
    if (BU.length && !rest.includes('--skip-borrowed')) die(`${(await import('./borrow.mjs')).refusal('bundle', BU)}（除いて作るなら --skip-borrowed）`);
    await ensureBds(); (await gh()).bundle({ ROOT: GITROOT, layout: LAYOUT(), bdsVer: bdsVersion(), zip, release: rest.includes('--release'), exclude: BU.map((u) => u.rel), say: out });
  }
  else if (cmd === 'selftest') ok = await selftest(rest);
  else if (cmd === 'lan') ok = await (await import('./lan.mjs')).lanCmd(CACHE, rest, out);
  else if (cmd === 'doctor') ok = await doctor();
  else if (cmd === 'carry') {   // save this unit's SDK types into <top>/carry/ (verify does it after a real test)
    if (F.sapiBuild === false || !exists(path.join(BP, 'manifest.json'))) { out('OK nothing to carry for this lab'); }
    else { await ensureBds(); const sdk = await sdkDir(); const m = readJson(path.join(BP, 'manifest.json')); const r = B.carrySave(sdk, CARRY, { bds: bdsVersion(), lab: F.name, modules: (m.dependencies ?? []).filter((d) => d.module_name).map((d) => `${d.module_name}@${d.version}`), saved: new Date().toISOString().slice(0, 10) }); out(`OK ${rel(CARRY)} (${r.count} files, ${(r.bytes / 1024).toFixed(0)} KB): types for chat AIs without network`); }
  }
  else if (cmd === 'setup') {
    { const bad = rest.filter((a) => !['--update', '--fix'].includes(a) && !/^\d+(\.\d+){1,3}$/.test(a)); if (bad.length) die(`setup: unknown ${bad.join(' ')} (usage: node lab.mjs setup [--update]; every lab at once: node lab.mjs setup all)`); }
    if (rest.includes('--update')) { for (const d of ['bds', 'world', 'types', 'beta.json', 'samples', 'node', 'run', ...(F.cacheDirs ?? [])]) fs.rmSync(path.join(CACHE, d), { recursive: true, force: true }); if (F.name === 'bds') fs.rmSync(VENDOR_ZIP, { force: true }); }
    await setupAll();
    out(`OK bds ${bdsVersion()} | server side: ${RT.describe()}`);
  }
  else { out(F.usage ?? USAGE); ok = false; }
  // `new <name> "<Title>" "<request>"`: the skill that fits the request comes with it (a separate `skill route` call re-sent the
  // whole conversation once more for the same lines: one turn fewer per addon). LAB_NEW_SKILL=off: not printed
  if (ok && (cmd === 'new' || cmd === 'import') && process.env.LAB_NEW_SKILL !== 'off') {
    const pos = rest.filter((a, i) => !a.startsWith('-') && !/^\w+=/.test(a) && !['-a', '--name'].includes(rest[i - 1]));
    const req = pos.slice(cmd === 'new' ? 2 : 1).join(' ').trim(), sk = path.join(LIBDIR, '..', 'skills');
    if (req && exists(sk) && fs.readdirSync(sk).some((n) => exists(path.join(sk, n, 'SKILL.md')))) try { (await import('./skill-forge.mjs')).route([req, '--print'], out); } catch { /* no skills here */ }
  }
} catch (e) { out(e instanceof Stop || /^usage: /.test(e?.message ?? '') ? 'ERR ' + e.message : 'ERR ' + (e?.stack ?? e)); ok = false; }   // (a usage line needs no stack)
trace(ok);
// exit only after stdout is flushed: process.exit() right away truncates large outputs on pipes
process.stdout.write('', () => process.exit(ok ? 0 : 1));
