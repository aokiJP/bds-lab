// A smaller .mcaddon with nothing lost. pack does the first two by itself; node lab.mjs optimize [-a <unit>] [--apply] [--prune]
// says what it finds and can also change the unit's own files:
//   PNG     compressed again, losslessly (the best filter per row, the best deflate, metadata dropped, an opaque RGBA as RGB);
//           the pixels are checked to be the same by decoding both. --apply writes the smaller files into the unit too
//   junk    design and OS files (psd xcf kra aseprite bbmodel blend, Thumbs.db...): never packed
//   unused  textures nothing names (no JSON, script or UI of the unit, and no vanilla texture of that path they would replace):
//           listed; --prune removes them (a checkpoint first: node lab.mjs undo)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pngDecode } from './extra.mjs';

export const JUNK = /\.(psd|xcf|kra|ase|aseprite|bbmodel|blend\d?|pdn|sai|clip|tmp|bak|orig|log)$|(^|[\\/])(Thumbs\.db|desktop\.ini|\.DS_Store|__MACOSX)([\\/]|$)/i;
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'latin1'), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB', 'gAMA', 'cHRM', 'iCCP', 'acTL', 'fcTL', 'fdAT']);   // color meaning and animation stay
function chunks(buf) { const r = []; for (let i = 8; i + 12 <= buf.length;) { const n = buf.readUInt32BE(i), t = buf.toString('latin1', i + 4, i + 8); r.push({ t, d: buf.subarray(i + 8, i + 8 + n) }); i += 12 + n; } return r; }
function encode(w, h, px, ch) {
  const stride = w * ch, rows = [Buffer.alloc((stride + 1) * h), Buffer.alloc((stride + 1) * h)];
  let prev = Buffer.alloc(stride), line = Buffer.alloc(stride);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) line[x * ch + c] = px[(y * w + x) * 4 + c];
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f]; let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
        const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
        const v = (line[i] - p) & 255; o[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    rows[0][y * (stride + 1)] = best; cand[best].copy(rows[0], y * (stride + 1) + 1);
    line.copy(rows[1], y * (stride + 1) + 1);   // (rows[1]: no filters at all, sometimes smaller for flat pixel art)
    [prev, line] = [line, prev];
  }
  let out = null;
  for (const raw of rows) for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) { const z = zlib.deflateSync(raw, { level: 9, memLevel: 9, strategy }); if (!out || z.length < out.length) out = z; }
  return out;
}
/** a smaller PNG with the same pixels, or null (not smaller, or a kind it leaves alone: 16-bit, interlaced, color-key alpha) */
export function pngSmaller(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;
  const cs = chunks(buf), ih = cs.find((c) => c.t === 'IHDR')?.d;
  if (!ih) return null;
  const extra = cs.filter((c) => KEEP.has(c.t) && !['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(c.t));
  // metadata out, image data as it is: always the same pixels
  let best = Buffer.concat([SIG, ...cs.filter((c) => KEEP.has(c.t)).map((c) => chunk(c.t, c.d))]);
  const bd = ih[8], ct = ih[9], animated = cs.some((c) => c.t === 'acTL');
  if (bd <= 8 && !ih[12] && !animated && !(cs.some((c) => c.t === 'tRNS') && ct !== 3)) {
    try {
      const img = pngDecode(buf), opaque = (() => { for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) return false; return true; })();
      const ch = opaque ? 3 : 4, h2 = Buffer.from(ih); h2[8] = 8; h2[9] = ch === 3 ? 2 : 6; h2[10] = h2[11] = h2[12] = 0;
      const re = Buffer.concat([SIG, chunk('IHDR', h2), ...extra.map((c) => chunk(c.t, c.d)), chunk('IDAT', encode(img.w, img.h, img.data, ch)), chunk('IEND', Buffer.alloc(0))]);
      if (re.length < best.length && pngDecode(re).data.equals(img.data)) best = re;
    } catch { /* a PNG it cannot read: the metadata-only version */ }
  }
  return best.length < buf.length ? best : null;
}
/** pngSmaller with a cache by content (<cache>/<sha1>: the result, or empty = no gain): a pack after the first is instant */
export function pngCached(buf, cache) {
  const f = path.join(cache, crypto.createHash('sha1').update(buf).digest('hex'));
  try { const c = fs.readFileSync(f); return c.length ? c : null; } catch { /* first time */ }
  const r = pngSmaller(buf);
  try { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(f, r ?? Buffer.alloc(0)); } catch { /* read-only */ }
  return r;
}
function walk(d, acc = []) { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|\.lab|dist)$/.test(e.name)) walk(p, acc); } else if (e.isFile()) acc.push(p); } } catch { /* none */ } return acc; }
/** textures of rp/ that nothing names: [{ file, size, sure }] (sure = false when vanilla's texture list is not at hand) */
export function unusedTextures(unit, vanilla = null) {
  const rp = path.join(unit, 'rp'), tex = walk(path.join(rp, 'textures')).filter((f) => /\.(png|tga|jpe?g)$/i.test(f));
  if (!tex.length) return [];
  const refs = new Set();
  for (const f of [...walk(rp), ...walk(path.join(unit, 'bp')), ...walk(path.join(unit, 'src'))]) {
    if (!/\.(json|material|js|ts|mjs|lang|txt|mcfunction)$/i.test(f) || fs.statSync(f).size > 8e6) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/textures\/[\w/.\- ]+?(?=["'`\s,)\]}]|$)/gm)) refs.add(m[0].replace(/\.(png|tga|jpe?g)$/i, '').toLowerCase());
  }
  return tex.map((f) => ({ f, key: path.relative(rp, f).split(path.sep).join('/').replace(/\.(png|tga|jpe?g)$/i, '').toLowerCase() }))
    .filter(({ key }) => !refs.has(key) && !(vanilla && vanilla.has(key.slice(9))) && !/\/(flipbook|atlas)|_mer$|_normal$|_heightmap$/.test(key))   // (texture sets name their layers by suffix)
    .map(({ f, key }) => ({ file: f, size: fs.statSync(f).size, sure: !!vanilla && !key.startsWith('textures/ui/') }));
}
/** vanilla's texture paths (textures/... without extension, lowercase) from the samples the lab keeps, or null */
export function vanillaTextures(labDir) {
  const dir = path.join(labDir, '.lab', 'samples');
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const r = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'resource_pack/textures'], { cwd: dir, encoding: 'utf8', maxBuffer: 64e6 });
  return r.status === 0 ? new Set(r.stdout.split('\n').filter(Boolean).map((f) => f.slice(23).replace(/\.(png|tga|jpe?g)$/i, '').toLowerCase())) : null;
}

export async function optimizeCmd(args, out = console.log) {
  const CP = await import('./checkpoint.mjs');
  const k = CP.labKind(), u = CP.currentUnit(k, args), dir = CP.unitDir(k, u);
  const kb = (n) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  const files = [...walk(path.join(dir, 'bp')), ...walk(path.join(dir, 'rp'))];
  const pngs = files.filter((f) => /\.png$/i.test(f) && !JUNK.test(f));
  let before = 0, after = 0; const better = [];
  for (const f of pngs) { const b = fs.readFileSync(f), s = pngSmaller(b); before += b.length; after += s?.length ?? b.length; if (s) better.push([f, s]); }
  const junk = files.filter((f) => JUNK.test(path.relative(dir, f)));
  const unused = unusedTextures(dir, vanillaTextures(path.join(CP.TOP, k)));
  const r = (f) => path.relative(dir, f).split(path.sep).join('/');
  out(`optimize ${u}:`);
  out(`  PNG ${pngs.length}: ${kb(before)} → ${kb(after)}${before ? ` (-${Math.round((100 * (before - after)) / before)}%)` : ''}, the same pixels; pack does it to the .mcaddon by itself${better.length && !args.includes('--apply') ? ' (--apply: in these files too)' : ''}`);
  if (junk.length) out(`  junk ${junk.length} (never packed): ${junk.slice(0, 6).map((f) => `${r(f)} ${kb(fs.statSync(f).size)}`).join(', ')}${junk.length > 6 ? ' …' : ''}`);
  if (unused.length) out(`  unused ${unused.length} (nothing names them${unused.some((x) => !x.sure) ? '; ? = not sure: vanilla could use that path' : ''}): ${unused.slice(0, 8).map((x) => `${r(x.file)}${x.sure ? '' : '?'} ${kb(x.size)}`).join(', ')}${unused.length > 8 ? ' …' : ''}${args.includes('--prune') ? '' : ' (--prune removes the sure ones)'}`);
  const apply = args.includes('--apply') && better.length, prune = args.includes('--prune') ? unused.filter((x) => x.sure) : [];
  if (apply || prune.length) {
    const id = CP.save(k, u, 'before optimize');
    if (apply) for (const [f, s] of better) fs.writeFileSync(f, s);
    for (const x of prune) fs.rmSync(x.file);
    out(`OK ${apply ? `${better.length} PNG smaller` : ''}${apply && prune.length ? ', ' : ''}${prune.length ? `${prune.length} unused removed` : ''} (back: node lab.mjs undo ${id})`);
  } else out(`OK optimize ${u}: ${better.length || junk.length || unused.length ? 'see above' : 'nothing to make smaller'}`);
  return true;
}
