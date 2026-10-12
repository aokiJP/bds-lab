// packdiff: two versions of an addon side by side — what is in each .mcaddon (or .mcpack, .zip): the files added, removed and
// changed, their sizes, and for a JSON file (a manifest, an item, a block) the keys whose values differ. The zip is read here
// (its central directory, each local header; stored and deflate — the browser's DecompressionStream('deflate-raw')), and the
// .mcpack files inside an .mcaddon are opened once more (one level, no deeper). Pure apart from the inflate given (default:
// the browser's) and fetchAsset (through the api, lib/gh.mjs). No DOM, no node:.

/** the largest file taken (a pack bigger than this is refused before it is read) */
export const MAX_BYTES = 50 * 1024 * 1024;
/** all that one pack may hold once opened (a zip bomb stops here): four times the largest file */
export const MAX_OPENED = 4 * MAX_BYTES;
const MAX_ENTRIES = 20000;
/** the JSON keys listed for one file at most (the rest counted: jsonMore) */
export const MAX_KEYS = 100;

export class PackError extends Error {}
const dec = new TextDecoder();

// (CRC-32 as zip writes it: each file checked once it is opened)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** the browser's raw deflate (DecompressionStream) → the bytes */
export async function inflateRaw(u8, limit = Infinity) {
  if (typeof DecompressionStream !== 'function') throw new PackError('このブラウザは圧縮されたファイルを開けません（DecompressionStream がありません）: 新しいブラウザで開いてください');
  // (read as it comes and stopped the moment it is more than the directory said: a file that lies small is not opened to the end)
  const reader = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) { await reader.cancel().catch(() => {}); throw new PackError('中身が目次と合いません（目次より大きい）: 壊れているか、開くと膨らむように作られた zip です'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const u8of = (x) => (x instanceof Uint8Array ? x : x instanceof ArrayBuffer ? new Uint8Array(x) : ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : null);

/** a zip's files → Map(path → Uint8Array), in the zip's order; folders left out. Refused (PackError, in words): not a zip, over
 *  MAX_BYTES, encrypted, Zip64, a way of packing other than stored and deflate, a file whose size or CRC is not what the
 *  directory says, more than MAX_OPENED in all. opts: { inflate (default inflateRaw), budget ({ left }: shared by a pack and
 *  the packs inside it) } */
export async function readZip(bytes, { inflate = inflateRaw, budget = { left: MAX_OPENED } } = {}) {
  const b = u8of(bytes);
  if (!b) throw new PackError('ファイルが読めませんでした');
  if (b.length > MAX_BYTES) throw new PackError(`大きすぎます（${Math.round(b.length / 1048576)} MB）: 50 MB までのファイルを比べられます`);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // (the end of the central directory: the last 22 bytes, or up to 64 KB before them when the zip has a comment)
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new PackError('zip ではありません（.mcaddon・.mcpack は zip のはずです）: 壊れているか、別の種類のファイルです');
  const count = v.getUint16(end + 10, true), cdSize = v.getUint32(end + 12, true), cdAt = v.getUint32(end + 16, true);
  if (count === 0xffff || cdAt === 0xffffffff) throw new PackError('Zip64 の zip は開けません');
  if (count > MAX_ENTRIES) throw new PackError(`ファイルが多すぎます（${count} 個）`);
  if (cdAt + cdSize > end) throw new PackError('zip の目次が壊れています');
  const out = new Map();
  let p = cdAt;
  for (let n = 0; n < count; n++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50) throw new PackError('zip の目次が壊れています');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), at = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new PackError(`鍵のかかった zip は開けません（${name}）`);
    if (csize === 0xffffffff || usize === 0xffffffff || at === 0xffffffff) throw new PackError('Zip64 の zip は開けません');
    if (method !== 0 && method !== 8) throw new PackError(`開けない詰め方です（${name}: 方式 ${method}）`);
    if ((budget.left -= usize) < 0) throw new PackError('開くと大きすぎます（合わせて 200 MB 超）: 比べられません');
    // (the local header: its own name and extra lengths, then the data)
    if (at + 30 > b.length || v.getUint32(at, true) !== 0x04034b50) throw new PackError(`zip が壊れています（${name}）`);
    const from = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    if (from + csize > b.length) throw new PackError(`zip が途中で切れています（${name}）`);
    const raw = b.subarray(from, from + csize);
    let data;
    try { data = method === 0 ? raw : await inflate(raw, usize); } catch (e) { throw e instanceof PackError ? e : new PackError(`開けませんでした（${name}）: 壊れています`); }
    if (data.length !== usize || crc32(data) !== crc) throw new PackError(`中身が目次と合いません（${name}）: 壊れています`);
    out.set(name, data);
  }
  return out;
}

const isInnerPack = (p) => /\.(mcpack|zip)$/i.test(p);
/** a pack's files → Map(path → Uint8Array): an .mcaddon's .mcpack (and .zip) opened one level — their files as
 *  "<the pack's name>/<path>"; a pack inside that is left a file. One that does not open stays a file as it is */
export async function openPack(bytes, opts = {}) {
  const budget = opts.budget ?? { left: MAX_OPENED }, top = await readZip(bytes, { ...opts, budget }), out = new Map();
  for (const [p, data] of top) {
    if (!isInnerPack(p)) { out.set(p, data); continue; }
    let inner = null;
    try { inner = await readZip(data, { ...opts, budget }); } catch (e) { if (/大きすぎ/.test(e.message)) throw e; }
    if (!inner) { out.set(p, data); continue; }
    for (const [q, d] of inner) out.set(`${p}/${q}`, d);
  }
  return out;
}

/** Bedrock's JSON (comments, a BOM, trailing commas allowed) → the value; undefined when it is not JSON (pure) */
export function parseJsonLoose(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  try { return JSON.parse(s); } catch { /* comments, trailing commas: below */ }
  let o = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') { let j = i + 1; while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1; o += s.slice(i, j + 1); i = j + 1; }
    else if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; }
    else if (c === '/' && s[i + 1] === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; }
    else { o += c; i++; }
  }
  try { return JSON.parse(o.replace(/,(\s*[}\]])/g, '$1')); } catch { return undefined; }
}

/** a JSON value → [[key, leaf]] (pure): "header.version", "modules[0].uuid"; an empty object or array is a leaf of its own */
export function flatJson(x, key = '', out = []) {
  if (Array.isArray(x) && x.length) x.forEach((y, i) => flatJson(y, `${key}[${i}]`, out));
  else if (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length) for (const [k, y] of Object.entries(x)) flatJson(y, key ? `${key}.${/^[\w:-]+$/.test(k) ? k : JSON.stringify(k)}` : (/^[\w:-]+$/.test(k) ? k : JSON.stringify(k)), out);
  else out.push([key, x]);
  return out;
}

/** two JSON values → [{ key, a, b }] where they differ (pure; a or b undefined: that side has no such key) */
export function jsonChanges(a, b) {
  const A = new Map(flatJson(a)), B = new Map(flatJson(b)), out = [];
  for (const [k, x] of A) if (!B.has(k)) out.push({ key: k, a: x, b: undefined }); else if (JSON.stringify(x) !== JSON.stringify(B.get(k))) out.push({ key: k, a: x, b: B.get(k) });
  for (const [k, y] of B) if (!A.has(k)) out.push({ key: k, a: undefined, b: y });
  return out;
}

const same = (x, y) => { if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
const byPath = (x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
/** two packs' files (Map(path → bytes), openPack) → { added: [{ path, size }], removed: [{ path, size }], changed: [{ path,
 *  sizeA, sizeB, json?: [{ key, a, b }], jsonMore? }], same (how many alike), sizeA, sizeB (all their bytes) } (pure; each list
 *  by path). json: a .json file both sides read as JSON — its keys that differ (MAX_KEYS at most; jsonMore: the rest) */
export function diff(a, b) {
  const added = [], removed = [], changed = [];
  let alike = 0, sizeA = 0, sizeB = 0;
  for (const [path, x] of a) {
    sizeA += x.length;
    const y = b.get(path);
    if (!y) { removed.push({ path, size: x.length }); continue; }
    if (same(x, y)) { alike++; continue; }
    const c = { path, sizeA: x.length, sizeB: y.length };
    if (/\.json$/i.test(path)) {
      const ja = parseJsonLoose(dec.decode(x)), jb = parseJsonLoose(dec.decode(y));
      if (ja !== undefined && jb !== undefined) { const j = jsonChanges(ja, jb); c.json = j.slice(0, MAX_KEYS); if (j.length > MAX_KEYS) c.jsonMore = j.length - MAX_KEYS; }
    }
    changed.push(c);
  }
  for (const [path, y] of b) { sizeB += y.length; if (!a.has(path)) added.push({ path, size: y.length }); }
  return { added: added.sort(byPath), removed: removed.sort(byPath), changed: changed.sort(byPath), same: alike, sizeA, sizeB };
}

/** the packs in the releases to choose from → [{ id, tag, name, size, label, release }] (pure; newest release first as given;
 *  drafts too: the person may write) */
export function packOptions(releases) {
  return (releases ?? []).flatMap((r) => (r?.assets ?? []).filter((a) => /\.(mcaddon|mcpack|zip)$/i.test(String(a?.name ?? '')) && a.id !== undefined && a.id !== null)
    .map((a) => ({ id: a.id, tag: String(r.tag_name ?? ''), name: String(a.name), size: Number(a.size) || 0, label: `${r.tag_name ?? '?'} — ${a.name}`, release: r })));
}

/** a release's file, its bytes, through the api (lib/gh.mjs: api.assetBytes(slug, id) → ArrayBuffer). Refused before asking:
 *  over MAX_BYTES, or an api that cannot fetch a file */
export async function fetchAsset(api, slug, asset) {
  if (Number(asset?.size) > MAX_BYTES) throw new PackError(`${asset.name} は大きすぎます（${Math.round(asset.size / 1048576)} MB）: 50 MB までのファイルを比べられます`);
  if (typeof api?.assetBytes !== 'function') throw new PackError('このパネルは、まだリリースのファイルを直接読めません: 「手元のファイル」で、ダウンロードした 2 つを選んでください');
  return u8of(await api.assetBytes(slug, asset.id)) ?? new Uint8Array(0);
}

/** two packs' bytes → their diff (openPack both, then diff) */
export async function comparePacks(a, b, opts = {}) {
  const [x, y] = await Promise.all([openPack(a, opts), openPack(b, opts)]);
  return diff(x, y);
}
