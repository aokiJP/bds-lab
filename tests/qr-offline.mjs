// the panel's QR code (panel/lib/qr.mjs, panel/ui/qr.mjs) without a browser: the published values it must give (ISO/IEC
// 18004's HELLO WORLD 1-M error correction codewords, the format bits of M with mask 0, the version bits of version 7, the
// byte capacities of level M), then every code it makes read back by a decoder written here on its own — the fixed patterns
// where they belong, the format and version information, each block's Reed–Solomon check, the text — for short and long
// texts, Japanese, every version 1–10 and every mask; a text too long told in words; and the card on a small fake DOM: an
// SVG (no style attribute) whose squares are the code, the link, the copy button, the empty and too long states.
// node tests/qr-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const Q = await imp('panel/lib/qr.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ---- a decoder of its own (the standard's tables copied here, not imported) ----
// level M: [ec codewords a block, blocks, data codewords, blocks, data codewords]; alignment centres
const M_TABLE = { 1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0], 6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
// the 8 format words of level M (ISO/IEC 18004 table C.1), mask 0–7
const FORMAT_M = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
// the version words 7–10 (table D.1)
const VERSION = { 7: '000111110010010100', 8: '001000010110111100', 9: '001001101010011001', 10: '001010010011010011' };
const MASK = [(i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0, (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0, (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0]; // (i row, j column)
const exp = [], log = [];
for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x = (x << 1) ^ (x & 0x80 ? 0x11d : 0); x &= 0xff; }
const mul = (a, b) => (a && b ? exp[(log[a] + log[b]) % 255] : 0);

function decode(modules) {
  const n = modules.length, v = (n - 17) / 4, at = (r, c) => modules[r][c];
  ok(Number.isInteger(v) && v >= 1 && v <= 10 && modules.every((row) => row.length === n), `a square of a version: ${n}`);
  const func = modules.map((row) => row.map(() => false)), mark = (r, c) => { func[r][c] = true; };
  // finders (7×7: dark ring, light ring, dark 3×3) and their separators
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const R = r0 + r, C = c0 + c; if (R < 0 || C < 0 || R >= n || C >= n) continue;
      mark(R, C);
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6, want = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      ok(at(R, C) === want, `finder at ${R},${C}`);
    }
  }
  for (let i = 8; i < n - 8; i++) { ok(at(6, i) === (i % 2 === 0) && at(i, 6) === (i % 2 === 0), `timing ${i}`); mark(6, i); mark(i, 6); }
  for (const r of ALIGN[v]) for (const c of ALIGN[v]) {
    if ((r < 9 && c < 9) || (r < 9 && c > n - 9) || (r > n - 9 && c < 9)) continue; // (none where a finder is)
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { ok(at(r + dr, c + dc) === (Math.max(Math.abs(dr), Math.abs(dc)) !== 1), `alignment ${r},${c}`); mark(r + dr, c + dc); }
  }
  ok(at(n - 8, 8), 'the dark module'); mark(n - 8, 8);
  // format: around the top-left finder (bit 14 first), and split between the other two
  const f1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const f2 = [...Array.from({ length: 7 }, (_, k) => [n - 1 - k, 8]), ...Array.from({ length: 8 }, (_, k) => [8, n - 8 + k])];
  for (const [r, c] of [...f1, ...f2]) mark(r, c);
  const fmt1 = f1.map(([r, c]) => (at(r, c) ? 1 : 0)).join(''), fmt2 = f2.map(([r, c]) => (at(r, c) ? 1 : 0)).join('');
  ok(fmt1 === fmt2, `the two copies of the format: ${fmt1} ${fmt2}`);
  const mask = FORMAT_M.indexOf(fmt1);
  ok(mask >= 0, `a format word of level M: ${fmt1}`);
  if (v >= 7) {
    let a = '', b = '';
    for (let k = 17; k >= 0; k--) { const r = Math.floor(k / 3), c = n - 11 + (k % 3); a += at(r, c) ? 1 : 0; b += at(c, r) ? 1 : 0; mark(r, c); mark(c, r); }
    ok(a === VERSION[v] && b === VERSION[v], `version information ${v}: ${a} ${b}`);
  }
  // the codewords: two columns at a time from the bottom right, up then down, column 6 skipped; unmasked
  const bits = [];
  for (let c = n - 1, up = true; c > 0; c -= 2, up = !up) {
    if (c === 6) c = 5;
    for (let k = 0; k < n; k++) { const r = up ? n - 1 - k : k; for (const cc of [c, c - 1]) if (!func[r][cc]) bits.push(at(r, cc) !== MASK[mask](r, cc) ? 1 : 0); }
  }
  const [ec, n1, k1, n2, k2] = M_TABLE[v], nb = n1 + n2, lens = Array.from({ length: nb }, (_, i) => (i < n1 ? k1 : k2)), total = lens.reduce((a, b) => a + b, 0) + ec * nb;
  const cw = []; for (let i = 0; i < total * 8; i += 8) cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  const blocks = lens.map(() => ({ d: [], e: [] }));
  let p = 0;
  for (let i = 0; i < Math.max(k1, k2); i++) for (let b = 0; b < nb; b++) if (i < lens[b]) blocks[b].d.push(cw[p++]);
  for (let i = 0; i < ec; i++) for (let b = 0; b < nb; b++) blocks[b].e.push(cw[p++]);
  // each block: its polynomial is 0 at α^0 … α^(ec−1) (no error)
  for (const [b, { d, e }] of blocks.entries()) {
    const all = [...d, ...e];
    for (let k = 0; k < ec; k++) { let s = 0; for (const x of all) s = mul(s, exp[k]) ^ x; ok(s === 0, `block ${b}: syndrome ${k} is ${s}`); }
  }
  const data = blocks.flatMap((b) => b.d), dbits = data.flatMap((x) => Array.from({ length: 8 }, (_, k) => (x >> (7 - k)) & 1));
  const read = (from, len) => dbits.slice(from, from + len).reduce((a, b) => (a << 1) | b, 0);
  eq(read(0, 4), 4, 'byte mode');
  const cb = v < 10 ? 8 : 16, len = read(4, cb), bytes = Array.from({ length: len }, (_, k) => read(4 + cb + 8 * k, 8));
  let q = 4 + cb + 8 * len;
  ok(read(q, Math.min(4, dbits.length - q)) === 0, 'the end');
  q = Math.ceil((q + 4) / 8);
  for (let k = q; k < data.length; k++) eq(data[k], (k - q) % 2 ? 0x11 : 0xec, `padding ${k}`);
  return { version: v, mask, text: new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)) };
}

await t('the published values: HELLO WORLD 1-M\'s error correction (ISO/IEC 18004 annex I), the format words of level M (table C.1), the version words 7–10 (table D.1), the byte capacities of level M', () => {
  eq(Q.rsEcc([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  eq(Array.from({ length: 8 }, (_, k) => Q.formatBits(k).toString(2).padStart(15, '0')), FORMAT_M);
  for (const v of [7, 8, 9, 10]) eq(Q.versionBits(v).toString(2).padStart(18, '0'), VERSION[v], `version ${v}`);
  eq(Array.from({ length: 10 }, (_, k) => Q.capacity(k + 1)), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  eq(Q.MAX_BYTES, 213);
});

await t('read back by the decoder here: a release link, an invite, Japanese, 1 byte, every capacity edge (versions 1–10), the smallest version each time', () => {
  const texts = ['https://github.com/o/lab/releases/download/addon-coins/Coins.mcaddon', 'https://github.com/o/lab/invitations', 'コインのアドオン 🪙', 'a', '01234567', 'HELLO WORLD'];
  for (let v = 1; v <= 10; v++) texts.push('x'.repeat(Q.capacity(v)), 'y'.repeat(Q.capacity(v) - 1));
  for (const s of texts) {
    const r = Q.encode(s), d = decode(r.modules), bytes = new TextEncoder().encode(s).length;
    eq(d.text, s, 'the text');
    eq([r.size, d.version, d.mask], [17 + 4 * r.version, r.version, r.mask], s.slice(0, 20));
    ok(bytes <= Q.capacity(r.version) && (r.version === 1 || bytes > Q.capacity(r.version - 1)), `the smallest version for ${bytes} bytes: ${r.version}`);
  }
});

await t('every mask reads back (forced), and the chosen one has the lowest penalty', () => {
  for (const s of ['https://github.com/o/r', 'z'.repeat(150)]) {
    const ps = [];
    for (let k = 0; k < 8; k++) { const r = Q.encode(s, { mask: k }); eq([r.mask, decode(r.modules).text], [k, s], `mask ${k}`); ps.push(Q.penalty(r.modules)); }
    eq(Q.penalty(Q.encode(s).modules), Math.min(...ps), 'the lowest penalty');
  }
});

await t('random texts of every length read back; a module flipped in the data is caught by the decoder (it really checks)', () => {
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let len = 1; len <= Q.MAX_BYTES; len += 3) {
    const s = Array.from({ length: len }, () => String.fromCharCode(32 + Math.floor(rnd() * 95))).join('');
    eq(decode(Q.encode(s).modules).text, s, `length ${len}`);
  }
  const m = Q.encode('https://github.com/o/r').modules;
  m[m.length - 1][m.length - 1] = !m[m.length - 1][m.length - 1];
  let e = null; try { decode(m); } catch (x) { e = x; }
  ok(e && /syndrome/.test(e.message), 'the flipped module noticed');
});

await t('a text too long or empty: an Error in words (how long, the most, what to do), nothing half made', () => {
  let e = null; try { Q.encode('x'.repeat(214)); } catch (x) { e = x; }
  ok(e && /長すぎて QR コードにできません（214 バイト。ここで作れるのは 213 バイトまで）。短いリンクにしてください/.test(e.message), e?.message);
  e = null; try { Q.encode('あ'.repeat(72)); } catch (x) { e = x; } // (3 bytes each: 216)
  ok(e && /216 バイト/.test(e.message), 'counted in UTF-8 bytes');
  eq(decode(Q.encode('あ'.repeat(71)).modules).text, 'あ'.repeat(71));
  for (const s of ['', null, undefined]) { e = null; try { Q.encode(s); } catch (x) { e = x; } ok(e && /QR にする文字がありません/.test(e.message), String(s)); }
  eq(Q.versionFor('x'.repeat(214)), 0);
});

// ---- a small DOM: enough for panel/ui/dom.mjs's h, SVG elements and the card ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag, ns = null) { super(); Object.assign(this, { tagName: ns ? tag : tag.toUpperCase(), ns, kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createElementNS: (ns, tag) => new E(tag, ns), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
/** a path's d (M x y h w v1 h-w z, each a run of dark modules) back into the grid, the quiet zone taken off */
function gridOf(d, n, quiet = 4) {
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) for (let k = 0; k < Number(w); k++) m[Number(y) - quiet][Number(x) - quiet + k] = true;
  ok(d.replace(/M(\d+) (\d+)h(\d+)v1h-\3z/g, '') === '', 'nothing else in the path');
  return m;
}
const LINK = 'https://github.com/o/lab/releases/download/addon-coins/Coins.mcaddon';

await t('the card: an SVG (its namespace, a viewBox with the quiet zone, white under black, no style attribute) whose squares are the code, the words, the link opening GitHub in a new tab, 「リンクを写す」 copying it', async () => {
  const { E, toast } = fakeDom(), UI = await imp('panel/ui/qr.mjs');
  const copied = [], nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (s) => { copied.push(s); } } }, configurable: true });
  try {
    for (const c of [UI.qrCard({ lab: { slug: 'o/lab' } }, LINK, 'Coins v1.2 をスマホで受け取る'), UI.qrCard(LINK, 'Coins v1.2 をスマホで受け取る')]) {
      ok(c instanceof E && /Coins v1\.2 をスマホで受け取る/.test(c.textContent) && /カメラ/.test(c.textContent), c.textContent);
      const [s] = c.all((e) => e.tagName === 'svg'), r = Q.encode(LINK), n = r.size + 8;
      ok(s && s.ns === ['http:', '', 'www.w3.org', '2000', 'svg'].join('/') && s.attrs.viewBox === `0 0 ${n} ${n}` && s.attrs.role === 'img' && /QR コード/.test(s.attrs['aria-label']), JSON.stringify(s?.attrs));
      const rect = s.all((e) => e.tagName === 'rect')[0], p = s.all((e) => e.tagName === 'path')[0];
      eq([rect.attrs.width, rect.attrs.fill, p.attrs.fill], [String(n), '#ffffff', '#000000']);
      const m = gridOf(p.attrs.d, r.size);
      eq(m, r.modules, 'the squares are the code');
      eq(decode(m).text, LINK, 'and read back');
      ok(c.all(() => true).every((e) => !('style' in e.attrs)), 'no style attribute (CSP)');
      const a = c.all((e) => e.tagName === 'A');
      eq(a.map((x) => [x.attrs.href, x.attrs.target, x.attrs.rel]), [[LINK, '_blank', 'noopener noreferrer']]);
      await c.all((e) => e.tagName === 'BUTTON' && /リンクを写す/.test(e.textContent))[0].click();
    }
    eq(copied, [LINK, LINK]);
    ok(/リンクを写しました/.test(toast.textContent), toast.textContent);
  } finally { if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; }
});

await t('the card when it cannot be a code: too long → the words in place (role alert) and the link still to copy; empty → how it gets one; not https → words, not a link', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/qr.mjs');
  const long = `https://github.com/o/lab/releases/download/${'a'.repeat(250)}/X.mcaddon`;
  const c = UI.qrCard(long, '受け取る');
  ok(!c.all((e) => e.tagName === 'svg').length, 'no code drawn');
  const bad = c.all((e) => e.attrs.role === 'alert')[0];
  ok(bad && /長すぎて QR コードにできません/.test(bad.textContent) && /短いリンクにしてください/.test(bad.textContent), bad?.textContent);
  ok(c.all((e) => e.tagName === 'A' && e.attrs.href === long).length === 1 && c.all((e) => e.tagName === 'BUTTON' && /リンクを写す/.test(e.textContent)).length === 1, 'the link and its copy button stay');
  for (const x of ['', '   ', null]) {
    const e = UI.qrCard({}, x);
    ok(!e.all((k) => k.tagName === 'svg' || k.tagName === 'BUTTON').length && /まだ QR にするリンクがありません/.test(e.textContent) && /リリースを作ると/.test(e.textContent), e.textContent);
  }
  const w = UI.qrCard('not a link');
  ok(w.all((e) => e.tagName === 'svg').length === 1 && !w.all((e) => e.tagName === 'A').length && /not a link/.test(w.textContent), 'words, not a link');
  eq(toast.textContent, '');
});

await t('pathOf: a run of dark modules is one rectangle, light ones nothing (pure)', async () => {
  fakeDom();
  const UI = await imp('panel/ui/qr.mjs');
  eq(UI.pathOf([[true, true, false, true], [false, false, false, false]], 0), 'M0 0h2v1h-2zM3 0h1v1h-1z');
  eq(UI.pathOf([[false]]), '');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
