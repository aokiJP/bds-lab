#!/usr/bin/env node
// app/lib/vault.mjs for a public repository too: vaultAllowed (Actions × visibility × key) and sealText / openText.
import { vaultAllowed, vaultKey, sealText, openText } from '../app/lib/vault.mjs';
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };
const A = { GITHUB_ACTIONS: 'true' }, K = { APP_CACHE_KEY: 'test-only-key-1' };
for (const vis of ['public', 'private', 'internal', undefined]) {
  const w = vaultAllowed({ ...A, ...K, ...(vis ? { APP_REPO_VISIBILITY: vis } : {}) });
  ok(w.ok === true && /AES-256-GCM/.test(w.why), `Actions ${vis ?? '(none)'} with key: allowed`);
  const n = vaultAllowed({ ...A, ...(vis ? { APP_REPO_VISIBILITY: vis } : {}) });
  ok(n.ok === false && /鍵/.test(n.why), `Actions ${vis ?? '(none)'} without key: refused, says why`);
}
ok(vaultAllowed({ ...A, GOOGLE_AAS_TOKEN: 'x', APP_REPO_VISIBILITY: 'public' }).ok, 'the AAS token alone is a key');
ok(vaultAllowed({}).ok && vaultAllowed({ APP_REPO_VISIBILITY: 'public' }).ok, 'local: always allowed');
const key = vaultKey(K), other = vaultKey({ APP_CACHE_KEY: 'test-only-key-2' }), text = 'コード 1234 secret-answer';
const s = sealText(text, key);
ok(!s.includes('\n') && s.startsWith('lab-sealed:v1:'), 'one line with the prefix');
ok(openText(s, key) === text, 'round trip');
ok(openText(s, key.key) === text, 'a raw key buffer works too');
ok(openText(s, other) === null, 'another key: null');
const raw = Buffer.from(s.slice('lab-sealed:v1:'.length), 'base64url');
let allNull = true;
for (const i of [0, 12, 28, raw.length - 1]) { const b = Buffer.from(raw); b[i] ^= 1; if (openText('lab-sealed:v1:' + b.toString('base64url'), key) !== null) allNull = false; }
ok(allNull, 'one byte changed (iv, tag, ciphertext): null');
ok(openText(s.slice(0, -4), key) === null && openText('', key) === null && openText('plain', key) === null && openText(null, key) === null, 'cut / empty / foreign: null');
ok(sealText(text, key) !== s, 'a new output every time');
ok(!s.includes('secret-answer') && !raw.includes(Buffer.from('secret-answer')), 'the plain text is not in the output');
ok(openText(sealText('', key), key) === '', 'empty text round trips');
let threw = false; try { sealText('x', null); } catch { threw = true; }
ok(threw, 'no key: sealText throws');
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
