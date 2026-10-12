// qr: a QR code made in the page, without a library — a release's .mcaddon link (or an invite) as squares a phone's camera
// reads. Byte mode (the text as UTF-8), error correction M (about 15% of it may be lost), the smallest of versions 1–10 it
// fits in (213 bytes at most), the mask with the lowest penalty (ISO/IEC 18004 §7.8.3), its format and version information.
// Pure: no DOM, no network.

/** level M of each version: [error correction codewords a block, blocks in group 1, data codewords each, group 2, each] */
const BLOCKS_M = [null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
/** where the alignment patterns' centres are, each version (rows and columns alike) */
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const MAX_VERSION = 10;
/** M's two bits in the format information (L 01, M 00, Q 11, H 10) */
const LEVEL_M = 0;

const dataCodewords = (v) => { const [, n1, k1, n2, k2] = BLOCKS_M[v]; return n1 * k1 + n2 * k2; };
const countBits = (v) => (v < 10 ? 8 : 16);
/** how many bytes of text a version holds in byte mode at level M (pure) */
export const capacity = (v) => Math.floor((dataCodewords(v) * 8 - 4 - countBits(v)) / 8);
/** the most a QR code here holds (bytes of UTF-8) */
export const MAX_BYTES = capacity(MAX_VERSION);

// ---- Reed–Solomon over GF(256), x^8 + x^4 + x^3 + x^2 + 1 ----
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
/** a × b in GF(256) (pure) */
export const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
/** the error correction codewords of `data` (n of them: the remainder by the generator (x−α⁰)…(x−αⁿ⁻¹)) (pure) */
export function rsEcc(data, n) {
  let gen = [1];
  for (let i = 0; i < n; i++) { const next = new Array(gen.length + 1).fill(0); gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= gfMul(g, EXP[i]); }); gen = next; }
  const rem = new Array(n).fill(0);
  for (const d of data) { const f = d ^ rem.shift(); rem.push(0); for (let j = 0; j < n; j++) rem[j] ^= gfMul(gen[j + 1], f); }
  return rem;
}

/** the 15 bits of format information for level M and a mask: BCH(15,5), then XOR 101010000010010 (pure) */
export function formatBits(mask) {
  const data = (LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
/** the 18 bits of version information (versions 7 and up): BCH(18,6) (pure) */
export function versionBits(v) {
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (v << 12) | rem;
}

/** the masks, x the column and y the row (ISO/IEC 18004 table 10) */
export const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];

/** the codewords to place: the text's bits (mode 0100, its length, its bytes, the end, the padding), cut into blocks, each
 *  block's error correction, then all of them interleaved (pure) */
function codewords(bytes, v) {
  const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, countBits(v)); for (const b of bytes) put(b, 8);
  const cap = dataCodewords(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCodewords(v); pad ^= 0xec ^ 0x11) data.push(pad);
  const [ec, n1, k1, n2, k2] = BLOCKS_M[v], blocks = [];
  let at = 0;
  for (let i = 0; i < n1 + n2; i++) { const k = i < n1 ? k1 : k2; const d = data.slice(at, at + k); at += k; blocks.push({ d, e: rsEcc(d, ec) }); }
  const out = [];
  for (let i = 0; i < Math.max(k1, k2); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

/** a version's grid with its fixed patterns: { size, dark[y][x], fixed[y][x] } (format areas reserved, not yet written) */
function grid(v) {
  const size = 17 + 4 * v, dark = Array.from({ length: size }, () => new Array(size).fill(false)), fixed = dark.map((r) => r.map(() => false));
  const set = (x, y, on) => { dark[y][x] = on; fixed[y][x] = true; };
  // (finders with their light separators, at three corners)
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  // (timing: row 6 and column 6)
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  // (alignment, except where a finder is)
  const al = ALIGN[v], last = al.length - 1;
  al.forEach((cy, i) => al.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  // (format and version areas kept for later, and the one dark module)
  drawFormat(set, size, 0);
  if (v >= 7) drawVersion(set, size, v);
  return { size, dark, fixed };
}
function drawFormat(set, size, mask) {
  const bits = formatBits(mask), b = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, b(i));
  set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
  set(8, size - 8, true);
}
function drawVersion(set, size, v) {
  const bits = versionBits(v);
  for (let i = 0; i < 18; i++) { const on = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, on); set(c, a, on); }
}

/** the penalty of a finished grid (ISO/IEC 18004 §7.8.3: runs, 2×2 blocks, finder-like patterns, the share of dark) */
export function penalty(m) {
  const n = m.length;
  let score = 0, darkCount = 0;
  const lines = [];
  for (let i = 0; i < n; i++) { lines.push(m[i]); lines.push(m.map((row) => row[i])); }
  for (const line of lines) {
    for (let j = 0, run = 1; j < n; j++) {
      if (j + 1 < n && line[j + 1] === line[j]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    for (let j = 0; j + 11 <= n; j++) {
      const w = line.slice(j, j + 11).map((x) => (x ? 1 : 0)).join('');
      if (w === '10111010000' || w === '00001011101') score += 40;
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) darkCount++;
    if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  const total = n * n;
  return score + 10 * (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1);
}

/** the text's UTF-8 bytes */
const utf8 = (text) => new TextEncoder().encode(String(text ?? ''));
/** the smallest version the text fits in, 0 when none (pure) */
export const versionFor = (text) => { const n = utf8(text).length; for (let v = 1; v <= MAX_VERSION; v++) if (n <= capacity(v)) return v; return 0; };

/** text → { version, size, mask, modules: boolean[][] } (pure): modules[y][x], true for a dark module, without the quiet zone
 *  (4 modules of light around it: the drawing adds them). Empty or longer than MAX_BYTES bytes → an Error in words.
 *  mask: a mask to use (0–7) rather than the one with the lowest penalty */
export function encode(text, { mask: forced } = {}) {
  const bytes = utf8(text);
  if (!bytes.length) throw new Error('QR にする文字がありません');
  const v = versionFor(text);
  if (!v) throw new Error(`長すぎて QR コードにできません（${bytes.length} バイト。ここで作れるのは ${MAX_BYTES} バイトまで）。短いリンクにしてください`);
  const cw = codewords(bytes, v), { size, dark, fixed } = grid(v);
  // (the codewords two columns at a time from the bottom right, up and down in turn, column 6 skipped)
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (fixed[y][x]) continue;
      dark[y][x] = i < cw.length * 8 && ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
      i++;
    }
  }
  const masked = (k) => {
    const m = dark.map((row, y) => row.map((on, x) => (fixed[y][x] ? on : on !== MASKS[k](x, y))));
    drawFormat((x, y, on) => { m[y][x] = on; }, size, k);
    return m;
  };
  let best = null;
  for (let k = 0; k < 8; k++) {
    if (forced !== undefined && k !== forced) continue;
    const m = masked(k), p = penalty(m);
    if (!best || p < best.p) best = { k, m, p };
  }
  return { version: v, size, mask: best.k, modules: best.m };
}
