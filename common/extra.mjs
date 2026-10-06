// Reference and heavy tools, loaded only when used:
//   doc    Mojang's component / Molang documentation (@minecraft/bedrock-schemas forms) offline
//   proto  Mojang's official network protocol docs (bedrock-protocol-docs) at the BDS version
//   mct    Mojang Creator Tools: deep validation (check --deep) and model rendering (render)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const WIN = process.platform === 'win32';
const exists = (f) => fs.existsSync(f);
const walk = (d, pred, acc = []) => { if (exists(d)) for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, pred, acc); else if (pred(p)) acc.push(p); } return acc; };
const clip = (s, n = 160) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; };
function npmI(dir, specs) {
  fs.mkdirSync(dir, { recursive: true });
  if (!exists(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}\n');
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', ...specs, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', shell: WIN });
  if (r.status !== 0) throw new Error(`npm i ${specs.join(' ')} failed: ${(r.stderr || r.stdout).slice(-400)}`);
}

// ---------- doc ----------
function forms(cache) {
  const dir = path.join(cache, 'schemas');
  const root = path.join(dir, 'node_modules', '@minecraft', 'bedrock-schemas', 'forms');
  if (!exists(root)) npmI(dir, ['@minecraft/bedrock-schemas@beta']);
  const idx = path.join(dir, 'index.json');
  if (exists(idx)) return { root, list: JSON.parse(fs.readFileSync(idx, 'utf8')) };
  const list = [];
  for (const f of walk(root, (x) => x.endsWith('.form.json'))) {
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const cat = path.basename(path.dirname(f));
    const base = path.basename(f, '.form.json');
    const id = j.id ?? (/^minecraft_/.test(base) ? base.replace(/^minecraft_/, 'minecraft:') : base);
    if (!j.fields?.length && !j.description) continue;
    list.push({ id, cat, f: path.relative(root, f), d: clip(j.description ?? j.title, 90) });
  }
  fs.writeFileSync(idx, JSON.stringify(list));
  return { root, list };
}
const sampleOf = (s) => { if (!s || typeof s !== 'object') return null; for (const v of Object.values(s)) if (Array.isArray(v) && v[0]?.content !== undefined) return v[0].content; return null; };
export function doc(cache, args, out) {
  const [q, cat] = args;
  if (!q) throw new Error('usage: node lab.mjs doc <component|molang|?word> [category], e.g. doc minecraft:durability item, doc query.max_durability, doc ?projectile');
  const { root, list } = forms(cache);
  const norm = (s) => s.toLowerCase().replace(/^minecraft:/, '');
  if (q.startsWith('?')) {
    const w = q.slice(1).toLowerCase();
    const hits = [...new Set(list.filter((x) => x.id.toLowerCase().includes(w) && (!cat || x.cat.includes(cat))).map((x) => `${x.id}(${x.cat})`))];
    out(hits.length ? hits.slice(0, 60).join(' ') + (hits.length > 60 ? ` ... +${hits.length - 60}` : '') : 'none');
    return hits.length > 0;
  }
  let hits = list.filter((x) => norm(x.id) === norm(q) && (!cat || x.cat.includes(cat)));
  if (!hits.length) { const near = [...new Set(list.filter((x) => norm(x.id).includes(norm(q))).map((x) => `${x.id}(${x.cat})`))].slice(0, 30); out(`none: ${q}${near.length ? '. similar: ' + near.join(' ') : ''}`); return false; }
  // the same component is documented in several folders (item/, item_components/, misc/): show each distinct text once
  const seen = new Set();
  let n = 0;
  for (const h of hits) {
    const j = JSON.parse(fs.readFileSync(path.join(root, h.f), 'utf8'));
    const key = JSON.stringify(j.fields?.map((x) => x.id)) + j.description;
    if (seen.has(key)) continue;
    seen.add(key);
    if (n++ >= 1) { out(`(also documented in: ${[...new Set(hits.map((x) => x.cat).filter((c) => c !== hits[0].cat))].join(' ')}; add the category to see it)`); break; }
    out(`${j.id ?? h.id} [${h.cat}] ${clip(j.description ?? j.title, 400)}`);
    for (const fl of j.fields ?? []) {
      const t = [fl.dataType, fl.subFormId ? '→' + path.basename(fl.subFormId) : '', fl.choices ? '{' + fl.choices.map((c) => c.id ?? c).slice(0, 12).join('|') + '}' : ''].filter(Boolean).join(' ');
      const def = fl.defaultValue !== undefined ? ' =' + clip(JSON.stringify(fl.defaultValue), 40) : '';
      const rng = fl.minValue !== undefined || fl.maxValue !== undefined ? ` [${fl.minValue ?? ''}..${fl.maxValue ?? ''}]` : '';
      out(`  ${fl.id}${fl.isRequired ? '*' : ''}: ${t}${def}${rng} ${clip(fl.description ?? fl.title)}`);
    }
    const s = sampleOf(j.samples) ?? j.fields?.map((x) => sampleOf(x.samples)).find((x) => x !== null);
    if (s !== null && s !== undefined) out('  e.g. ' + clip(JSON.stringify(s), 240));
  }
  return true;
}

// ---------- proto ----------
function untarAll(tgz, pick) {
  const b = zlib.gunzipSync(tgz), res = new Map();
  let longName = null;
  for (let i = 0; i + 512 <= b.length;) {
    const hdr = b.subarray(i, i + 512);
    if (hdr.every((x) => x === 0)) break;
    let name = hdr.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const prefix = hdr.toString('utf8', 345, 500).replace(/\0.*$/s, '');
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(hdr.toString('utf8', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8), type = String.fromCharCode(hdr[156]);
    const data = b.subarray(i + 512, i + 512 + size);
    if (type === 'L') longName = data.toString('utf8').replace(/\0.*$/s, '');
    else if (type === 'x' || type === 'g') { const m = /\d+ path=(.*)\n/.exec(data.toString('utf8')); if (m && type === 'x') longName = m[1]; }
    else { if (longName) { name = longName; longName = null; } if ((type === '0' || type === '\0') && pick(name)) res.set(name, Buffer.from(data)); }
    i += 512 + Math.ceil(size / 512) * 512;
  }
  return res;
}
export async function protoDir(cache, bv) {
  const dir = path.join(cache, 'proto', bv);
  if (exists(path.join(dir, 'ok'))) return dir;
  let buf = null, tag = null;
  const tags = [`v${bv}`, `v${bv.split('.').slice(0, 2).join('.')}.0`, 'main'];
  for (const t of tags) {
    const r = await fetch(`https://api.github.com/repos/Mojang/bedrock-protocol-docs/tarball/${t}`, { headers: { 'user-agent': 'bds-lab' } }).catch(() => null);
    if (r?.ok) { buf = Buffer.from(await r.arrayBuffer()); tag = t; break; }
    if (r && r.status !== 404) break;   // rate limited / blocked: use git below
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (buf) for (const [n, d] of untarAll(buf, (n) => /\/json\/[^/]+\.json$/.test(n))) fs.writeFileSync(path.join(dir, path.basename(n)), d);
  else {
    // the GitHub API is rate limited per address: a sparse git clone of json/ needs no API
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-proto-'));
    for (const t of tags) {
      const g = (...a) => spawnSync('git', a, { cwd: tmp, encoding: 'utf8' });
      const r = spawnSync('git', ['clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', ...(t === 'main' ? [] : ['--branch', t]), 'https://github.com/Mojang/bedrock-protocol-docs.git', 'r'], { cwd: tmp, encoding: 'utf8' });
      if (r.status !== 0) continue;
      spawnSync('git', ['sparse-checkout', 'set', 'json'], { cwd: path.join(tmp, 'r') });
      for (const f of fs.readdirSync(path.join(tmp, 'r', 'json'))) fs.copyFileSync(path.join(tmp, 'r', 'json', f), path.join(dir, f));
      tag = t; void g; break;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!tag) throw new Error('bedrock-protocol-docs: download failed (GitHub unreachable)');
  }
  fs.writeFileSync(path.join(dir, 'ok'), tag);
  return dir;
}
const pascal = (s) => s.split(/[_\s]+/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join('');
export async function proto(cache, bv, args, out) {
  const q = args[0];
  if (!q) throw new Error('usage: node lab.mjs proto <PacketOrType|snake_packet|?word>   (Mojang bedrock-protocol-docs at this BDS version)');
  const dir = await protoDir(cache, bv);
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  if (q.startsWith('?')) { const w = q.slice(1).toLowerCase(); const h = names.filter((n) => n.toLowerCase().includes(w)); out(h.length ? h.slice(0, 80).join(' ') + (h.length > 80 ? ` ... +${h.length - 80}` : '') : 'none'); return h.length > 0; }
  const cands = [q, q + 'Payload', pascal(q) + 'Packet', pascal(q) + 'PacketPayload', pascal(q)];
  let name = cands.find((c) => names.includes(c + 'Payload')) ? cands.find((c) => names.includes(c + 'Payload')) + 'Payload' : cands.find((c) => names.includes(c));
  if (!name) { const near = names.filter((n) => n.toLowerCase().includes(q.toLowerCase().replace(/_/g, ''))).slice(0, 20); out(`none: ${q}${near.length ? '. similar: ' + near.join(' ') : ''}`); return false; }
  let j = JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
  // a packet file that only points at its payload (odd names like Clientbound_Data_Store_Payload): follow it
  for (let k = 0; k < 3 && !j.properties && !j.enum && !j.oneOf && j.$ref; k++) { const n2 = path.basename(j.$ref, '.json'); if (!exists(path.join(dir, n2 + '.json'))) break; name = n2; j = JSON.parse(fs.readFileSync(path.join(dir, n2 + '.json'), 'utf8')); }
  out(`${name} (${j['x-minecraft-version'] ?? '?'}, protocol ${j['x-protocol-version'] ?? '?'}, from ${fs.readFileSync(path.join(dir, 'ok'), 'utf8')})${j.description ? ' ' + clip(j.description, 200) : ''}`);
  const typeOf = (p) => {
    const ref = p.$ref ? path.basename(p.$ref, '.json') : null;
    const t = [ref ?? p.type, p['x-underlying-type'], ...(p['x-serialization-options'] ?? []).map((o) => o === 'Compression' ? 'varint' : o.toLowerCase()), p.const !== undefined ? '=' + p.const : '', p.minimum !== undefined || p.maximum !== undefined ? `[${p.minimum ?? ''}..${p.maximum ?? ''}]` : ''];
    if (p.type === 'array') t.push('of ' + (p.items?.$ref ? path.basename(p.items.$ref, '.json') : p.items?.oneOf ? 'oneOf(' + p.items.oneOf.map((o) => path.basename(o.$ref ?? '', '.json')).join('|') + ')' : p.items?.type ?? '?'));
    return t.filter(Boolean).join(' ');
  };
  if (j.enum) { out('  enum ' + (j['x-underlying-type'] ?? '') + ': ' + j.enum.map((v, i) => `${i}=${v}`).join(' ')); return true; }
  const props = Object.entries(j.properties ?? {}).sort((a, b) => (a[1]['x-ordinal-index'] ?? 0) - (b[1]['x-ordinal-index'] ?? 0));
  for (const [k, p] of props) out(`  ${p['x-ordinal-index'] ?? '-'} ${k}${(j.required ?? []).includes(k) ? '' : '?'}: ${typeOf(p)}${p.description ? ' — ' + clip(p.description, 120) : ''}`);
  if (j.oneOf) out('  oneOf: ' + j.oneOf.map((o) => path.basename(o.$ref ?? '', '.json')).join(' | '));
  if (!props.length && !j.oneOf) out('  ' + clip(JSON.stringify(j), 400));
  return true;
}

// ---------- Mojang Creator Tools (mct): installed on first use (~300MB) ----------
function mct(cache) {
  const dir = path.join(cache, 'mct');
  const bin = path.join(dir, 'node_modules', '@minecraft', 'creator-tools', 'cli', 'index.mjs');
  if (!exists(bin)) npmI(dir, ['@minecraft/creator-tools@latest']);
  return (args, cwd) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', maxBuffer: 64e6, timeout: 300000 });
}
// validate a copy holding only the packs (tests.txt, src/ ... are not pack files)
export function deepCheck(cache, packs) {
  const run = mct(cache);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-mct-'));
  for (const p of packs) fs.cpSync(p.dir, path.join(tmp, p.kind), { recursive: true, filter: (s) => !path.basename(s).startsWith('.') });
  const r = run(['validate', 'main', '-i', tmp, '-o', path.join(tmp, '.out'), '--json', '-q', '--offline', '--single'], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  let j; try { j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { return { errs: [], warns: ['mct validate gave no report: ' + clip(r.stderr || r.stdout, 300)] }; }
  const errs = [], warns = [];
  // known false alarms for this setup: beta versions are pinned to this BDS (mct compares with the newest preview);
  // vanilla itself writes item_texture "textures" as a string
  const FALSE = [/out of date beta version/, /string value found, but a array is required/, /extraneous file/];
  for (const pr of j.projects ?? []) for (const it of pr.items ?? []) {
    const text = it.message + (it.data && typeof it.data === 'string' && !it.data.startsWith('/') ? ': ' + it.data : '');
    if (FALSE.some((re) => re.test(text))) continue;
    const msg = `mct ${it.generatorId}: ${it.path ? it.path.replace(/^\//, '') + ': ' : ''}${clip(text, 260)}`;
    if (it.type === 'error' || it.type === 'internalProcessingError') errs.push(msg);
    else if (it.type === 'warning') warns.push(msg);
  }
  return { errs: [...new Set(errs)], warns: [...new Set(warns)] };
}
// geometry -> PNG (textures found through the client entity / attachable / block that uses it)
export function render(cache, addon, rp, geo, outFile, size = 256) {
  const run = mct(cache);
  const rel = path.relative(addon, path.resolve(rp, geo)).split(path.sep).join('/');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-render-'));
  for (const k of ['bp', 'rp']) if (exists(path.join(addon, k, 'manifest.json'))) fs.cpSync(path.join(addon, k), path.join(tmp, k), { recursive: true });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = run(['rendermodel', '-i', tmp, '--no-vanilla', '--width', String(size), '--height', String(size), rel, outFile], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!exists(outFile)) throw new Error('render failed: ' + clip((r.stderr || '') + (r.stdout || ''), 500));
  return outFile;
}

// known component names per kind, from the same forms (for the "unknown component" lint: BDS silently ignores those)
export function componentSets(cache) {
  let list;
  try { list = forms(cache).list; } catch { return null; }
  const sets = { item: new Set(), block: new Set(), entity: new Set() };
  for (const x of list) {
    if (!x.id.startsWith('minecraft:')) continue;
    if (x.cat === 'item' || x.cat === 'item_components') sets.item.add(x.id);
    if (x.cat === 'block' || x.cat === 'block_components') sets.block.add(x.id);
    if (x.cat === 'entity') sets.entity.add(x.id);
  }
  return sets;
}
export function nearest(word, set) {
  let best = null, bd = 99;
  const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } } return d[b.length]; };
  for (const c of set) { const k = lev(word, c); if (k < bd) { bd = k; best = c; } }
  return bd <= Math.max(3, Math.floor(word.length / 4)) ? best : null;
}

// ---------- vanilla metadata (Mojang/bedrock-samples metadata/, at the release tag of this BDS) ----------
// git ls-remote + raw files: no GitHub API (rate limited on shared addresses)
const META = { blocks: 'vanilladata_modules/mojang-blocks.json', items: 'vanilladata_modules/mojang-items.json', entities: 'vanilladata_modules/mojang-entities.json',
  commands: 'command_modules/mojang-commands.json', order: 'engine_modules/engine-after-events-ordering.json' };
const vnum = (v) => v.replace(/^v/, '').split(/[.-]/).filter((x) => /^\d+$/.test(x)).map(Number);
const vcmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };
async function metaDir(cache, bdsVer) {
  const root = path.join(cache, 'meta');
  const have = exists(root) ? fs.readdirSync(root).filter((d) => exists(path.join(root, d, 'ok'))) : [];
  const pick0 = have.filter((t) => vcmp(vnum(t), vnum(bdsVer)) <= 0).sort((a, b) => vcmp(vnum(a), vnum(b))).pop();
  if (pick0) return path.join(root, pick0);
  const r = spawnSync('git', ['ls-remote', '--tags', 'https://github.com/Mojang/bedrock-samples.git', 'v*'], { encoding: 'utf8' });
  const tags = (r.stdout ?? '').split('\n').map((l) => l.split('refs/tags/')[1]).filter((t) => t && !/preview|\^\{\}/.test(t));
  const tag = tags.filter((t) => vcmp(vnum(t), vnum(bdsVer)) <= 0).sort((a, b) => vcmp(vnum(a), vnum(b))).pop() ?? 'main';
  const dir = path.join(root, tag);
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, f] of Object.entries(META)) {
    const x = await fetch(`https://raw.githubusercontent.com/Mojang/bedrock-samples/${tag}/metadata/${f}`);
    if (!x.ok) throw new Error(`bedrock-samples ${tag} ${f}: ${x.status}`);
    fs.writeFileSync(path.join(dir, k + '.json'), Buffer.from(await x.arrayBuffer()));
  }
  fs.writeFileSync(path.join(dir, 'ok'), tag);
  return dir;
}
const metaCache = new Map();
const metaGet = (dir, k) => { const f = path.join(dir, k + '.json'); if (!metaCache.has(f)) metaCache.set(f, JSON.parse(fs.readFileSync(f, 'utf8'))); return metaCache.get(f); };
// vanilla answer for doc: /command, block (states), item, entity, `order` (after-event order). null = not vanilla data
export async function vanillaDoc(cache, bdsVer, q, serverVer, out) {
  let dir; try { dir = await metaDir(cache, bdsVer); } catch { return null; }
  const tag = fs.readFileSync(path.join(dir, 'ok'), 'utf8');
  const id = q.includes(':') ? q : 'minecraft:' + q;
  if (q.startsWith('/')) {
    const c = metaGet(dir, 'commands'), name = q.slice(1).toLowerCase();
    const cmd = c.commands.find((x) => x.name === name || (x.aliases ?? []).some((a) => (a.name ?? a) === name));
    if (!cmd) {
      // not in Mojang's command docs: what bedrock-binary found in this BDS (and whether it was tried here); cached, no scan
      try { const h = (await import('./bb.mjs')).hiddenCommand(name, path.join(cache, 'bb'), path.join(cache, 'bds')); if (h) { out(`/${name}: not in Mojang's command docs; the BDS ${h.ver} binary has it${h.text ? ` ("${h.text}")` : ''} — ${h.says}`); return true; } } catch { /* no bedrock-binary */ }
      out(`none: ${q}. commands: ${c.commands.map((x) => x.name).sort().join(' ')}${fs.existsSync(path.join(cache, 'bb')) ? '' : ' (commands the docs leave out: node lab.mjs bb commands)'}`); return false;
    }
    const en = new Map(c.command_enums.map((e) => [e.name.toLowerCase(), e.values.map((v) => v.value)]));
    const ty = (t) => { const vs = en.get(t.name.toLowerCase()); return vs ? (vs.length <= 12 ? vs.join('|') : `${t.name}(${vs.length})`) : t.name.toLowerCase(); };
    out(`/${cmd.name}: ${cmd.description} (permission ${cmd.permission_level}${cmd.requires_cheats ? ', cheats' : ''}; ${tag})`);
    for (const o of cmd.overloads) out(`  /${cmd.name} ${o.params.map((p) => (p.is_optional ? `[${p.name}:${ty(p.type)}]` : `<${p.name}:${ty(p.type)}>`)).join(' ')}`);
    return true;
  }
  if (q === 'order') {
    const o = metaGet(dir, 'order').after_events_order_by_version;
    const srv = o.filter((x) => /^@minecraft\/server \d/.test(x.name) && !/alpha/.test(x.version)).sort((a, b) => vcmp(vnum(a.version), vnum(b.version)));
    const pick = srv.filter((x) => vcmp(vnum(x.version), vnum(serverVer ?? '99')) <= 0).pop() ?? srv.at(-1);
    out(`after-events fire in this order within a tick (${pick.name}): ${pick.event_order.map((e) => e.name.replace(/AfterEvent$/, '')).join(' > ')}`);
    return true;
  }
  const b = metaGet(dir, 'blocks');
  const blk = b.data_items.find((x) => x.name === id);
  if (blk) {
    const props = new Map(b.block_properties.map((p) => [p.name, p]));
    const st = (blk.properties ?? []).map((p) => { const d = props.get(p.name); const vs = (d?.values ?? []).map((v) => v.value); return `${p.name}=${vs.length > 16 ? vs[0] + '..' + vs.at(-1) : vs.join('|')}`; });
    out(`${id} [vanilla block, ${tag}]${st.length ? ' states: ' + st.join(' ') : ' (no states)'}`);
  }
  const it = metaGet(dir, 'items').data_items.find((x) => x.name === id);
  if (it && !blk) out(`${id} [vanilla item, ${tag}]`);
  const en = metaGet(dir, 'entities').data_items.find((x) => x.name === id);
  if (en) out(`${id} [vanilla entity, ${tag}]`);
  return blk || it || en ? true : null;
}
export async function vanillaSearch(cache, bdsVer, w) {
  let dir; try { dir = await metaDir(cache, bdsVer); } catch { return []; }
  const hits = [];
  for (const [k, kind] of [['blocks', 'block'], ['items', 'item'], ['entities', 'entity']]) for (const x of metaGet(dir, k).data_items) if (x.name.includes(w)) hits.push(`${x.name}(${kind})`);
  return hits;
}

// ---------- PNG (8-bit RGB/RGBA, what Chromium writes): decode, shrink, encode - so a render costs the AI few image tokens ----------
function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
export function pngDecode(buf) {
  let i = 8, w = 0, h = 0, ct = 0, bd = 8, pal = null, trns = null;
  const idat = [];
  while (i < buf.length) {
    const n = buf.readUInt32BE(i), t = buf.toString('ascii', i + 4, i + 8), d = buf.subarray(i + 8, i + 8 + n);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error('png: interlaced'); }
    else if (t === 'PLTE') pal = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    i += 12 + n;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!ch || (bd === 16 && ct === 3)) throw new Error(`png: color type ${ct} depth ${bd}`);
  const bitsPx = ch * bd, stride = Math.ceil((w * bitsPx) / 8), bpp = Math.max(1, bitsPx >> 3);   // bytes a filter looks back
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
    // sample k of pixel x (0..255): sub-byte depths unpacked, 16-bit keeps the high byte
    const smp = (x, k) => {
      if (bd === 8) return line[x * ch + k];
      if (bd === 16) return line[(x * ch + k) * 2];
      const bit = (x * ch + k) * bd, v = (line[bit >> 3] >> (8 - bd - (bit & 7))) & ((1 << bd) - 1);
      return ct === 3 ? v : Math.round((v * 255) / ((1 << bd) - 1));
    };
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ct === 3) { const k = smp(x, 0); out[o] = pal[k * 3]; out[o + 1] = pal[k * 3 + 1]; out[o + 2] = pal[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; continue; }
      if (ch >= 3) { out[o] = smp(x, 0); out[o + 1] = smp(x, 1); out[o + 2] = smp(x, 2); } else out[o] = out[o + 1] = out[o + 2] = smp(x, 0);
      out[o + 3] = ch === 4 ? smp(x, 3) : ch === 2 ? smp(x, 1) : 255;
    }
    prev = line;
  }
  return { w, h, data: out };
}
// TGA (what vanilla textures often are): true-color / grey, raw or RLE, 24/32-bit
export function tgaDecode(buf) {
  const idLen = buf[0], type = buf[2], w = buf.readUInt16LE(12), h = buf.readUInt16LE(14), bits = buf[16], desc = buf[17];
  if (![2, 3, 10, 11].includes(type)) throw new Error('tga: type ' + type);
  const px = bits >> 3, out = Buffer.alloc(w * h * 4);
  let i = 18 + idLen + (buf[1] ? buf.readUInt16LE(5) * Math.ceil(buf[7] / 8) : 0), n = 0;
  const put = (at) => { const o = at * 4; if (px === 1) { out[o] = out[o + 1] = out[o + 2] = buf[i]; out[o + 3] = 255; } else { out[o] = buf[i + 2]; out[o + 1] = buf[i + 1]; out[o + 2] = buf[i]; out[o + 3] = px === 4 ? buf[i + 3] : 255; } };
  const total = w * h, rle = type >= 9;
  while (n < total) {
    if (rle) { const c = buf[i++], k = (c & 127) + 1; if (c & 128) { for (let j = 0; j < k; j++) put(n++); i += px; } else for (let j = 0; j < k; j++) { put(n++); i += px; } }
    else { put(n++); i += px; }
  }
  if (!(desc & 0x20)) for (let y = 0; y < h >> 1; y++) { const a = out.subarray(y * w * 4, (y + 1) * w * 4), b = out.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), t = Buffer.from(a); b.copy(a); t.copy(b); }   // bottom-up rows
  return { w, h, data: out };
}
export function pngEncode({ w, h, data }) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function shrink(file, maxW) {
  const img = pngDecode(fs.readFileSync(file));
  const k = Math.ceil(img.w / maxW);
  if (k <= 1) return img;
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k), data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let s = 0; for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += img.data[((y * k + dy) * img.w + x * k + dx) * 4 + c];
    data[(y * w + x) * 4 + c] = Math.round(s / (k * k));
  }
  fs.writeFileSync(file, pngEncode({ w, h, data }));
  return { w, h };
}
// block volume JSON -> .mcstructure (Creator Tools) -> textured PNG render
export function view(cache, volFile, outFile, maxW = 400) {
  const run = mct(cache);
  const dir = path.dirname(volFile), st = path.join(dir, 'view.mcstructure');
  fs.rmSync(st, { force: true });
  let r = run(['buildstructure', volFile, st, '--overwrite'], dir);
  if (!exists(st)) throw new Error('view: buildstructure failed: ' + clip((r.stderr || '') + (r.stdout || ''), 300));
  fs.rmSync(outFile, { force: true });
  r = run(['renderstructure', st, outFile], dir);
  if (!exists(outFile)) throw new Error('view: render failed: ' + clip((r.stderr || '') + (r.stdout || ''), 300));
  return shrink(outFile, maxW);
}

// ---------- example: Mojang's own script samples (how-to gallery, custom commands/components) from the Creator Tools package ----------
async function examplesDir(cache) {
  const dir = path.join(cache, 'examples');
  if (exists(path.join(dir, 'index.json'))) return dir;
  const doc = await (await fetch('https://registry.npmjs.org/@minecraft/creator-tools')).json();
  const tgz = Buffer.from(await (await fetch(doc.versions[doc['dist-tags'].latest].dist.tarball)).arrayBuffer());
  const pre = 'package/res/samples/microsoft/script-samples/';
  const files = untarAll(tgz, (n) => n.startsWith(pre) && /\.(ts|json)$/.test(n) && !/node_modules|\/editor|package(-lock)?\.json|index\.json|tsconfig|\/\.|just\.config|eslint/.test(n));
  const entries = [];
  for (const [n, d] of files) {
    const rel = n.slice(pre.length), text = d.toString('utf8');
    const f = path.join(dir, 'files', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, d);
    if (!rel.endsWith('.ts')) { entries.push({ name: rel, file: rel, doc: 'sample JSON', start: 0, end: text.length }); continue; }
    // one entry per exported function (how-to gallery style), or the whole file
    const re = /(\/\*\*([\s\S]*?)\*\/\s*)?export (?:async )?function (\w+)/g;
    let m, found = false;
    while ((m = re.exec(text))) {
      found = true;
      const open = text.indexOf('{', m.index + m[0].length);
      let depth = 0, k = open;
      for (; k < text.length; k++) { if (text[k] === '{') depth++; else if (text[k] === '}' && --depth === 0) break; }
      const d1 = (m[2] ?? '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).find((l) => l && !l.startsWith('@')) ?? '';
      entries.push({ name: m[3], file: rel, doc: d1, start: m.index + (m[1]?.length ?? 0), end: k + 1 });
    }
    if (!found) entries.push({ name: rel.replace(/\.ts$/, ''), file: rel, doc: 'whole file', start: 0, end: text.length });
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(entries));
  return dir;
}
export async function example(cache, args, out) {
  const q = args[0];
  const dir = await examplesDir(cache);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const text = (e) => fs.readFileSync(path.join(dir, 'files', e.file), 'utf8');
  if (!q || q.startsWith('?')) {
    const w = (q ?? '?').slice(1).toLowerCase();
    const hits = idx.filter((e) => !w || e.name.toLowerCase().includes(w) || e.doc.toLowerCase().includes(w) || text(e).slice(e.start, e.end).toLowerCase().includes(w));
    out(hits.length ? hits.slice(0, 40).map((e) => `${e.name}${e.doc && e.doc !== 'whole file' ? ' — ' + clip(e.doc, 70) : ''}`).join('\n') + (hits.length > 40 ? `\n... +${hits.length - 40} (narrow it)` : '') : 'none');
    return hits.length > 0;
  }
  const e = idx.find((x) => x.name === q) ?? idx.find((x) => x.name.toLowerCase() === q.toLowerCase());
  if (!e) { out(`none: ${q} (list: node lab.mjs example ?word)`); return false; }
  const src = text(e);
  const imports = e.start ? src.split('\n').filter((l) => /^import /.test(l)).join('\n') : '';
  const body = src.slice(e.start, e.end).replace(/\/\*\*[\s\S]*?\*\/\s*/g, '').split('\n').filter((l) => l.trim() && !/^\s*\/\/ /.test(l)).join('\n');
  out(`// Mojang sample ${e.file}${e.doc && e.doc !== 'whole file' ? ': ' + e.doc : ''}\n${imports ? imports + '\n' : ''}${body}`);
  return true;
}
