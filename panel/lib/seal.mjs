// seal: a repository secret encrypted in the browser the way GitHub's API asks for it — libsodium's sealed box
// (crypto_box_seal: an ephemeral X25519 key, nonce = BLAKE2b-192(epk ‖ pk), XSalsa20-Poly1305), so the panel can set a
// secret with the person's own token and nothing in between sees the value. Pure JavaScript (BigInt for the field and
// Poly1305 arithmetic, 32-bit words for Salsa20), no library; checked against libsodium's own output in
// tests/panel-offline.mjs. The ephemeral key comes from crypto.getRandomValues (an injected one only in the tests).

const P25519 = 2n ** 255n - 19n;
const le2big = (b) => { let x = 0n; for (let i = b.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[i]); return x; };
const big2le = (x, n) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; };
const mod = (a, m) => { const r = a % m; return r < 0n ? r + m : r; };
function powmod(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }

/** X25519 (RFC 7748): scalar k (32 bytes) × u-coordinate u (32 bytes) → 32 bytes */
export function x25519(k, u) {
  const kc = Uint8Array.from(k); kc[0] &= 248; kc[31] &= 127; kc[31] |= 64;
  const n = le2big(kc), uc = Uint8Array.from(u); uc[31] &= 127;
  const x1 = le2big(uc) % P25519;
  let x2 = 1n, z2 = 0n, x3 = x1, z3 = 1n, swap = 0n;
  for (let t = 254; t >= 0; t--) {
    const kt = (n >> BigInt(t)) & 1n;
    swap ^= kt;
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    swap = kt;
    const A = mod(x2 + z2, P25519), AA = (A * A) % P25519, B = mod(x2 - z2, P25519), BB = (B * B) % P25519, E = mod(AA - BB, P25519);
    const C = mod(x3 + z3, P25519), D = mod(x3 - z3, P25519), DA = (D * A) % P25519, CB = (C * B) % P25519;
    x3 = mod((DA + CB) ** 2n, P25519); z3 = (x1 * mod((DA - CB) ** 2n, P25519)) % P25519;
    x2 = (AA * BB) % P25519; z2 = (E * mod(AA + 121665n * E, P25519)) % P25519;
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  return big2le((x2 * powmod(z2, P25519 - 2n, P25519)) % P25519, 32);
}
const BASE = (() => { const b = new Uint8Array(32); b[0] = 9; return b; })();
export const x25519Public = (sk) => x25519(sk, BASE);

// ---- Salsa20 / HSalsa20 / XSalsa20 ----
const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];   // "expand 32-byte k"
const rd = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const rotl = (v, c) => ((v << c) | (v >>> (32 - c))) >>> 0;
function rounds(x) {
  for (let i = 0; i < 20; i += 2) {
    x[4] ^= rotl((x[0] + x[12]) >>> 0, 7); x[8] ^= rotl((x[4] + x[0]) >>> 0, 9); x[12] ^= rotl((x[8] + x[4]) >>> 0, 13); x[0] ^= rotl((x[12] + x[8]) >>> 0, 18);
    x[9] ^= rotl((x[5] + x[1]) >>> 0, 7); x[13] ^= rotl((x[9] + x[5]) >>> 0, 9); x[1] ^= rotl((x[13] + x[9]) >>> 0, 13); x[5] ^= rotl((x[1] + x[13]) >>> 0, 18);
    x[14] ^= rotl((x[10] + x[6]) >>> 0, 7); x[2] ^= rotl((x[14] + x[10]) >>> 0, 9); x[6] ^= rotl((x[2] + x[14]) >>> 0, 13); x[10] ^= rotl((x[6] + x[2]) >>> 0, 18);
    x[3] ^= rotl((x[15] + x[11]) >>> 0, 7); x[7] ^= rotl((x[3] + x[15]) >>> 0, 9); x[11] ^= rotl((x[7] + x[3]) >>> 0, 13); x[15] ^= rotl((x[11] + x[7]) >>> 0, 18);
    x[1] ^= rotl((x[0] + x[3]) >>> 0, 7); x[2] ^= rotl((x[1] + x[0]) >>> 0, 9); x[3] ^= rotl((x[2] + x[1]) >>> 0, 13); x[0] ^= rotl((x[3] + x[2]) >>> 0, 18);
    x[6] ^= rotl((x[5] + x[4]) >>> 0, 7); x[7] ^= rotl((x[6] + x[5]) >>> 0, 9); x[4] ^= rotl((x[7] + x[6]) >>> 0, 13); x[5] ^= rotl((x[4] + x[7]) >>> 0, 18);
    x[11] ^= rotl((x[10] + x[9]) >>> 0, 7); x[8] ^= rotl((x[11] + x[10]) >>> 0, 9); x[9] ^= rotl((x[8] + x[11]) >>> 0, 13); x[10] ^= rotl((x[9] + x[8]) >>> 0, 18);
    x[12] ^= rotl((x[15] + x[14]) >>> 0, 7); x[13] ^= rotl((x[12] + x[15]) >>> 0, 9); x[14] ^= rotl((x[13] + x[12]) >>> 0, 13); x[15] ^= rotl((x[14] + x[13]) >>> 0, 18);
    for (let j = 0; j < 16; j++) x[j] >>>= 0;
  }
}
// the state: σ, key, the 16 bytes of input (nonce ‖ counter for Salsa20, the nonce's first half for HSalsa20)
const state = (key, inp) => [SIGMA[0], rd(key, 0), rd(key, 4), rd(key, 8), rd(key, 12), SIGMA[1], rd(inp, 0), rd(inp, 4), rd(inp, 8), rd(inp, 12), SIGMA[2], rd(key, 16), rd(key, 20), rd(key, 24), rd(key, 28), SIGMA[3]];
const wr = (o, i, v) => { o[i] = v & 255; o[i + 1] = (v >>> 8) & 255; o[i + 2] = (v >>> 16) & 255; o[i + 3] = (v >>> 24) & 255; };
/** HSalsa20: key (32) and 16 input bytes → 32 bytes */
export function hsalsa20(key, inp) {
  const x = state(key, inp);
  rounds(x);
  const o = new Uint8Array(32);
  [0, 5, 10, 15, 6, 7, 8, 9].forEach((w, i) => wr(o, i * 4, x[w]));
  return o;
}
/** the Salsa20 keystream: key (32), nonce (8), n bytes (counter from 0) */
function salsa20Stream(key, nonce8, n) {
  const out = new Uint8Array(n), inp = new Uint8Array(16);
  inp.set(nonce8, 0);
  for (let off = 0, ctr = 0; off < n; off += 64, ctr++) {
    let c = ctr; for (let i = 8; i < 16; i++) { inp[i] = c & 255; c = Math.floor(c / 256); }
    const s = state(key, inp), x = s.slice();
    rounds(x);
    const blk = new Uint8Array(64);
    for (let i = 0; i < 16; i++) wr(blk, i * 4, (x[i] + s[i]) >>> 0);
    out.set(blk.subarray(0, Math.min(64, n - off)), off);
  }
  return out;
}

// ---- Poly1305 (BigInt) ----
const P1305 = 2n ** 130n - 5n;
/** Poly1305 of msg with a 32-byte one-time key → 16-byte tag */
export function poly1305(msg, key) {
  const r = le2big(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn, s = le2big(key.subarray(16, 32));
  let acc = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const blk = msg.subarray(i, Math.min(i + 16, msg.length));
    acc = ((acc + le2big(blk) + (1n << BigInt(8 * blk.length))) * r) % P1305;
  }
  return big2le((acc + s) % (1n << 128n), 16);
}

/** crypto_secretbox_easy (XSalsa20-Poly1305): message, nonce (24), key (32) → tag (16) ‖ ciphertext */
export function secretbox(m, nonce, key) {
  const sub = hsalsa20(key, nonce.subarray(0, 16)), stream = salsa20Stream(sub, nonce.subarray(16, 24), 32 + m.length);
  const c = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) c[i] = m[i] ^ stream[32 + i];
  const out = new Uint8Array(16 + m.length);
  out.set(poly1305(c, stream.subarray(0, 32)), 0); out.set(c, 16);
  return out;
}
/** crypto_box_easy: message, nonce (24), their public key, our secret key → tag ‖ ciphertext */
export const box = (m, nonce, pk, sk) => secretbox(m, nonce, hsalsa20(x25519(sk, pk), new Uint8Array(16)));

// ---- BLAKE2b (BigInt words), unkeyed, any output length 1..64 ----
const M64 = (1n << 64n) - 1n;
const IV = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
const SIG = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3], [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4], [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13], [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9], [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11], [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5], [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]];
const rotr64 = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;
function compress(h, block, t, last) {
  const m = Array.from({ length: 16 }, (_, i) => le2big(block.subarray(i * 8, i * 8 + 8)));
  const v = [...h, ...IV];
  v[12] ^= t & M64; v[13] ^= (t >> 64n) & M64;
  if (last) v[14] ^= M64;
  const G = (a, b, c, d, x, y) => {
    v[a] = (v[a] + v[b] + x) & M64; v[d] = rotr64(v[d] ^ v[a], 32);
    v[c] = (v[c] + v[d]) & M64; v[b] = rotr64(v[b] ^ v[c], 24);
    v[a] = (v[a] + v[b] + y) & M64; v[d] = rotr64(v[d] ^ v[a], 16);
    v[c] = (v[c] + v[d]) & M64; v[b] = rotr64(v[b] ^ v[c], 63);
  };
  for (let r = 0; r < 12; r++) {
    const s = SIG[r % 10];
    G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]); G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
    G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]); G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
}
/** BLAKE2b of data, outlen bytes (1..64), no key */
export function blake2b(data, outlen = 64) {
  const h = IV.slice();
  h[0] ^= 0x01010000n ^ BigInt(outlen);
  let t = 0n, i = 0;
  // (every full block but the last one; the last — full or not, or none at all — is compressed with the final flag)
  while (data.length - i > 128) { t += 128n; compress(h, data.subarray(i, i + 128), t, false); i += 128; }
  const last = new Uint8Array(128);
  last.set(data.subarray(i));
  t += BigInt(data.length - i);
  compress(h, last, t, true);
  const out = new Uint8Array(64);
  for (let k = 0; k < 8; k++) out.set(big2le(h[k], 8), k * 8);
  return out.subarray(0, outlen);
}

/** crypto_box_seal: message (Uint8Array or string), the repository's public key (32 bytes, or its base64 as GitHub gives it)
 *  → epk ‖ tag ‖ ciphertext. ephemeral: the 32-byte secret key to use (tests only; otherwise a random one) */
export function sealBox(message, publicKey, { ephemeral } = {}) {
  const pk = typeof publicKey === 'string' ? fromB64(publicKey) : publicKey;
  if (pk.length !== 32) throw new Error('公開鍵は 32 バイトです');
  const m = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const esk = ephemeral ?? globalThis.crypto.getRandomValues(new Uint8Array(32)), epk = x25519Public(esk);
  const both = new Uint8Array(64); both.set(epk, 0); both.set(pk, 32);
  const c = box(m, blake2b(both, 24), pk, esk), out = new Uint8Array(32 + c.length);
  out.set(epk, 0); out.set(c, 32);
  return out;
}
export const fromB64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
export const toB64 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
/** what GitHub's PUT /actions/secrets/{name} takes: { encrypted_value, key_id } from the value and GET …/secrets/public-key's answer */
export const secretPayload = (value, { key, key_id: keyId }, opts) => ({ encrypted_value: toB64(sealBox(value, key, opts)), key_id: keyId });
