// vault (the browser's side): the live issue's sealed lines opened and written in the panel, the same way app/lib/vault.mjs
// seals them on the runner — HKDF-SHA256 from APP_CACHE_KEY (or GOOGLE_AAS_TOKEN) to an AES-256-GCM key, one line
// `lab-sealed:v1:<base64url(iv ‖ tag ‖ ciphertext)>` with the AAD "bds-lab live v1". WebCrypto only (browsers and Node 22).
// The key never leaves the device: it is typed into the panel's settings and kept in that browser alone.
const enc = new TextEncoder(), dec = new TextDecoder();
export const SEALED = 'lab-sealed:v1:';
const AAD = enc.encode('bds-lab live v1');
const subtle = () => globalThis.crypto.subtle;
const b64url = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0));

/** { cacheKey, aasToken } → the AES-GCM key (a CryptoKey), or null with neither (app/lib/vault.mjs vaultKey) */
export async function vaultKey({ cacheKey, aasToken } = {}) {
  const own = String(cacheKey ?? '').trim(), aas = String(aasToken ?? '').trim();
  if (!own && !aas) return null;
  const base = await subtle().importKey('raw', enc.encode(own || aas), 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('bds-lab vault salt v1'), info: enc.encode(own ? 'app cache key v1' : 'app cache from aas v1') }, base, 256);
  return subtle().importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
/** text → one sealed line (a new random iv every time) */
export async function sealText(text, key) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, enc.encode(String(text))));
  // (WebCrypto gives ciphertext ‖ tag; the line is iv ‖ tag ‖ ciphertext)
  const ct = out.subarray(0, out.length - 16), tag = out.subarray(out.length - 16), all = new Uint8Array(12 + out.length);
  all.set(iv, 0); all.set(tag, 12); all.set(ct, 28);
  return SEALED + b64url(all);
}
/** a sealed line → the text, or null (not ours, another key, cut or altered) */
export async function openText(str, key) {
  const s = String(str ?? '').trim();
  if (!key || !s.startsWith(SEALED)) return null;
  let raw; try { raw = unb64url(s.slice(SEALED.length).split(/\s/)[0]); } catch { return null; }
  if (raw.length < 28) return null;
  const body = new Uint8Array(raw.length - 12);
  body.set(raw.subarray(28), 0); body.set(raw.subarray(12, 28), raw.length - 28);
  try { return dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: AAD, tagLength: 128 }, key, body)); } catch { return null; }
}
