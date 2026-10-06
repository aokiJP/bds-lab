#!/usr/bin/env node
// NetherNet client (common/nethernet.cjs) against a signaling server written from Mojang's onboarding guide: a real HTTP server
// (GET /v1/join, POST /v1/join/{id}), an answer with a genuinely signed a=identity (ES384 keypair, self-signed JWT with cpk,
// detached JWS over the canonical a=fingerprint JSON). Only the WebRTC stack is a stand-in (an in-memory pair of data channels):
// node-datachannel is not needed. Checks: signaling, the client's own offer identity (checked like BDS 1.26.51), server identity verification (good / tampered / missing / expired),
// a=identity stripped before setRemoteDescription, 1-byte countdown framing both ways, 0xfe batch id removed/added.
//   node tests/nethernet-offline.mjs
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { NetherNetClient, verifyIdentity, canonical, fingerprintsOf } = createRequire(import.meta.url)(path.join(TOP, 'common', 'nethernet.cjs'));
let good = 0, bad = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✔' : '✘'} ${what}${ok || !detail ? '' : '\n    ' + String(detail).slice(0, 400)}`); ok ? good++ : bad++; };

// ---- the server's long-lived operator key and its assertion (guide §5.2)
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' });
const cpk = publicKey.export({ format: 'jwk' });
const b64u = (x) => Buffer.from(x).toString('base64url');
const sign = (input, key = privateKey) => crypto.sign('sha384', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
function assertion(sdp, { tamper = false, exp = Math.floor(Date.now() / 1000) + 3600, key = privateKey } = {}) {
  const h = b64u(JSON.stringify({ alg: 'ES384', typ: 'JWT' })), p = b64u(JSON.stringify({ cpk, iss: 'bds-lab test', iat: Math.floor(Date.now() / 1000), exp }));
  const token = `${h}.${p}.${b64u(sign(`${h}.${p}`, key))}`;
  const fh = b64u(JSON.stringify({ alg: 'ES384' }));
  const fpSdp = tamper ? sdp.replace(/(a=fingerprint:sha-256 )(\w\w)/, '$1FF') : sdp;
  const fps = `${fh}..${b64u(sign(`${fh}.${b64u(canonical(fingerprintsOf(fpSdp)))}`, key))}`;
  return Buffer.from(JSON.stringify({ idp: { domain: 'lab.test', protocol: 'default' }, assertion: JSON.stringify({ token, fingerprints: fps }) })).toString('base64');
}
const ANSWER = (mode) => {
  const base = ['v=0', 'o=- 987654321 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00'];
  const tail = ['m=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=ice-ufrag:wxyz', 'a=ice-pwd:zyxwvutsrqponmlkjihgfedcb', 'a=setup:active', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:1000', 'a=candidate:1 1 udp 2130706431 127.0.0.1 23456 typ host', 'a=end-of-candidates'];
  const sdp0 = [...base, ...tail].join('\r\n');
  if (mode === 'none') return sdp0 + '\r\n';
  const id = assertion(sdp0, { tamper: mode === 'tamper', exp: mode === 'expired' ? 1000 : undefined, key: mode === 'otherkey' ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey : privateKey });
  return [...base, `a=identity:${id}`, ...tail].join('\r\n') + '\r\n';
};

// what BDS 1.26.51 checks in the offer (offline mode): a=identity whose token is self-signed by its cpk (base64 DER SPKI, like the
// login chain) and a detached JWS over the offer's a=fingerprint lines. Anything else: 200 with the body "37" (no SDP)
let lastCpk = null;
function offerOk(sdp) {
  try {
    const line = /^a=identity:(\S+)\s*$/m.exec(sdp); if (!line) return false;
    const { token, fingerprints } = JSON.parse(JSON.parse(Buffer.from(line[1], 'base64').toString()).assertion);
    const [h, p, sg] = token.split('.'); const claims = JSON.parse(Buffer.from(p, 'base64url'));
    if (typeof claims.cpk !== 'string') return false;
    const key = crypto.createPublicKey({ key: Buffer.from(claims.cpk, 'base64'), format: 'der', type: 'spki' });
    const ok = (input, sig) => crypto.verify('sha384', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
    const [fh, , fs] = fingerprints.split('.');
    lastCpk = claims.cpk;
    return ok(`${h}.${p}`, sg) && ok(`${fh}.${Buffer.from(canonical(fingerprintsOf(sdp))).toString('base64url')}`, fs);
  } catch { return false; }
}
// ---- signaling server per the guide
let mode = 'good', lastOffer = null, lastId = null;
const srv = http.createServer((q, r) => {
  if (q.method === 'GET' && q.url === '/v1/join') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ name: 'Lab', protocol: 2193, version: '1.26.51', level: 'lab', players: 0, maxPlayers: 10, gameType: 0 })); }
  const m = /^\/v1\/join\/(\S+)$/.exec(q.url);
  if (q.method === 'POST' && m) { let b = ''; q.on('data', (d) => (b += d)).on('end', () => { lastOffer = b; lastId = m[1]; r.writeHead(200, { 'Content-Type': 'application/sdp' }); r.end(offerOk(b) ? ANSWER(mode) : '37'); }); return; }
  r.writeHead(404); r.end();
});
await new Promise((res) => srv.listen(0, '127.0.0.1', res));
const port = srv.address().port;

// ---- an in-memory WebRTC stand-in with the standard API shape (node-datachannel/polyfill's)
const wire = { toServer: [], remoteSdp: null };
class DC { constructor(label, o) { Object.assign(this, { label, o, readyState: 'connecting', sent: [] }); } send(b) { this.sent.push(Buffer.from(b)); wire.toServer.push([this.label, Buffer.from(b)]); } close() { this.readyState = 'closed'; } }
class PC {
  constructor(cfg) { this.cfg = cfg; this.dcs = []; this.iceGatheringState = 'new'; this.connectionState = 'new'; }
  createDataChannel(l, o) { const d = new DC(l, o); this.dcs.push(d); return d; }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 AA:BB\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=candidate:1 1 udp 2130706431 127.0.0.1 12345 typ host\r\na=end-of-candidates\r\n' }; }
  async setLocalDescription(d) { this.localDescription = d; setTimeout(() => { this.iceGatheringState = 'complete'; this.onicegatheringstatechange?.(); }, 5); }
  async setRemoteDescription(d) { wire.remoteSdp = d.sdp; setTimeout(() => { for (const c of this.dcs) { c.readyState = 'open'; c.onopen?.(); } this.connectionState = 'connected'; }, 5); }
  close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
}
const RTC = { RTCPeerConnection: PC };

// 1. signaling + identity + framing
{
  const got = [];
  const c = new NetherNetClient({ host: '127.0.0.1', port, RTC, log: (l) => got.push(l) });
  let connected = false; c.onConnected = () => (connected = true);
  const recv = []; c.onEncapsulated = (b) => recv.push(b);
  const pong = await c.ping();
  check(/^MCPE;Lab;2193;1\.26\.51;0;10;/.test(pong), 'GET /v1/join: server info → RakNet-style advertisement', pong);
  await c.connect(2000);
  check(connected && lastId === c.networkId && /^\d+$/.test(lastId), 'POST /v1/join/{networkId}: one request with the NetworkID (decimal)', lastId);
  check(/a=end-of-candidates/.test(lastOffer) && /a=candidate:/.test(lastOffer), 'the offer is sent after ICE gathering (full ICE: candidates inside)', lastOffer);
  const pc = c.pc;
  check(pc.cfg.iceServers.length === 0 && pc.dcs[0].label === 'ReliableDataChannel' && pc.dcs[0].o.ordered === true && pc.dcs[1].label === 'UnreliableDataChannel' && pc.dcs[1].o.ordered === false && pc.dcs[1].o.maxRetransmits === 0,
    'peer config like the client: no STUN/TURN, Reliable (ordered) + Unreliable (unordered, 0 retransmits)', JSON.stringify(pc.dcs.map((d) => [d.label, d.o])));
  check(!/a=identity/.test(wire.remoteSdp) && /a=fingerprint/.test(wire.remoteSdp), 'a=identity is stripped before setRemoteDescription', wire.remoteSdp);
  check(/^a=identity:/m.test(lastOffer) && offerOk(lastOffer) && lastOffer.indexOf('a=identity:') < lastOffer.indexOf('m='), 'the offer carries the client a=identity (self-signed, cpk = DER key, JWS over its fingerprints) before m=', lastOffer);
  check(got.some((l) => /nethernet: server key [0-9a-f]{16} \(ES384, bds-lab test\)/.test(l)), 'server identity verified (self-signed JWT with cpk + JWS over fingerprints)', got.join('\n'));
  // send: bedrock-protocol hands 0xfe + batch; NetherNet carries the batch with countdown headers (max-message-size 1000 → 999)
  wire.toServer.length = 0;
  const batch = crypto.randomBytes(2500);
  c.sendReliable(Buffer.concat([Buffer.from([0xfe]), batch]));
  const segs = wire.toServer.map(([, b]) => b);
  check(segs.length === 3 && segs.map((b) => b[0]).join() === '2,1,0' && Buffer.concat(segs.map((b) => b.subarray(1))).equals(batch) && wire.toServer.every(([l]) => l === 'ReliableDataChannel'),
    'send: 0xfe removed, split into 3 fragments with countdown 2,1,0 on the reliable channel', segs.map((b) => `${b[0]}:${b.length}`).join(' '));
  // receive: fragments reassembled, 0xfe put back, own ArrayBuffer
  const msg = crypto.randomBytes(1500);
  pc.dcs[0].onmessage({ data: Buffer.concat([Buffer.from([1]), msg.subarray(0, 800)]) });
  pc.dcs[0].onmessage({ data: Uint8Array.from(Buffer.concat([Buffer.from([0]), msg.subarray(800)])).buffer });
  check(recv.length === 1 && recv[0][0] === 0xfe && recv[0].subarray(1).equals(msg) && recv[0].byteOffset === 0, 'receive: fragments 1,0 reassembled, handed on as 0xfe + batch', recv.map((b) => b.length).join());
  pc.dcs[1].onmessage({ data: Buffer.from([0, 7, 7]) });
  check(recv.length === 2 && recv[1].equals(Buffer.from([0xfe, 7, 7])), 'unreliable channel: header 0, delivered as is', '');
  let why = null; c.onCloseConnection = (w) => (why = w);
  c.close();
  check(why === 'closed' && !c.connected, 'close: channels and peer closed, bedrock-protocol told', why);
}
// 2. the client refuses what a real client refuses
for (const [m, re] of [['tamper', /fingerprint/], ['none', /no a=identity/], ['expired', /expired/], ['otherkey', /not self-signed/]]) {
  mode = m;
  const c = new NetherNetClient({ host: '127.0.0.1', port, RTC });
  let err = null; try { await c.connect(1000); } catch (e) { err = e.message; }
  check(re.test(err ?? ''), `identity ${m}: connection refused (${(err ?? 'none').slice(0, 70)})`, err);
}
mode = 'none';
{ const got = []; const c = new NetherNetClient({ host: '127.0.0.1', port, RTC, identity: 'warn', log: (l) => got.push(l) }); await c.connect(1000);
  check(c.connected && got.some((l) => /identity=warn: going on/.test(l)), 'identity=warn: reported, connection goes on (to test servers without it)', got.join('\n')); c.close(); }
// 2b. the login's key signs the offer (BDS derives the session from it), and a declined offer is named
{ const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' });
  mode = 'good'; const c = new NetherNetClient({ host: '127.0.0.1', port, RTC }); c.keyPair = kp; await c.connect(1000);
  check(lastCpk === kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), 'keyPair set (bedrock-protocol ecdhKeyPair): the offer cpk is that key', lastCpk); c.close(); }
{ const s3 = http.createServer((q, r) => { if (q.method === 'GET') { r.writeHead(200); return r.end(''); } q.resume().on('end', () => { r.writeHead(200, { 'Content-Type': 'application/sdp' }); r.end('37'); }); });
  await new Promise((res) => s3.listen(0, '127.0.0.1', res));
  const c = new NetherNetClient({ host: '127.0.0.1', port: s3.address().port, RTC });
  let err = null; try { await c.connect(1000); } catch (e) { err = e.message; }
  check(/declined the offer \(session error 37: client identity refused\)/.test(err ?? ''), 'BDS answers "37": "the server declined the offer (client identity refused)"', err); s3.close(); }
// 3. no NetherNet on the server: a clear line
{ const s2 = http.createServer((q, r) => { r.writeHead(404); r.end(); }); await new Promise((res) => s2.listen(0, '127.0.0.1', res));
  const c = new NetherNetClient({ host: '127.0.0.1', port: s2.address().port, RTC });
  let err = null; try { await c.connect(1000); } catch (e) { err = e.message; }
  check(/NetherNet not offered .*404.*transport=raknet/.test(err ?? ''), 'GET /v1/join 404: "NetherNet not offered (transport=raknet?)"', err); s2.close(); }
// 4. verifyIdentity on its own (what the lab and a partner server would share)
mode = 'good';
check((() => { try { return verifyIdentity(ANSWER('good')).pin.length === 16; } catch { return false; } })(), 'verifyIdentity: a good answer gives the key pin', '');
check(NetherNetClient.frame(Buffer.alloc(10)).length === 1 && NetherNetClient.frame(Buffer.alloc(10))[0][0] === 0, 'frame: a small message is one segment with header 0', '');
// 5. trust on first use (guide §5.2): the key is pinned once, then known; strict refuses an unknown key; key= insists on one
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-offline-'));
const pinFile = path.join(TMP, 'pins.json');
mode = 'good';
{ const got = [];
  const c1 = new NetherNetClient({ host: '127.0.0.1', port, RTC, pins: pinFile, identity: 'strict', log: (l) => got.push(l) });
  let err = null; try { await c1.connect(1000); } catch (e) { err = e.message; }
  check(/is not pinned \(identity=strict/.test(err ?? '') && !fs.existsSync(pinFile), 'identity=strict, key never seen: refused, nothing pinned (a player declining the first-use prompt)', err);
  const c2 = new NetherNetClient({ host: '127.0.0.1', port, RTC, pins: pinFile, log: (l) => got.push(l) }); await c2.connect(1000); c2.close();
  const pin = c2.serverIdentity.pin, stored = JSON.parse(fs.readFileSync(pinFile, 'utf8'));
  check(got.some((l) => /server key [0-9a-f]{16} \(ES384, bds-lab test\) first use: pinned/.test(l)) && stored[pin]?.where === `127.0.0.1:${port}` && c2.serverIdentity.trust === 'first-use', 'identity=verify, first time: accepted and pinned in the store (like the game after the prompt)', got.join('\n'));
  got.length = 0;
  const c3 = new NetherNetClient({ host: '127.0.0.1', port, RTC, pins: pinFile, identity: 'strict', log: (l) => got.push(l) }); await c3.connect(1000); c3.close();
  check(c3.connected === false && c3.serverIdentity.trust === 'pinned' && got.some((l) => / known \(pinned \d{4}-\d\d-\d\d\)/.test(l)), 'the same key again (even strict): accepted silently as known', got.join('\n'));
  const c4 = new NetherNetClient({ host: '127.0.0.1', port, RTC, expectKey: pin }); await c4.connect(1000); c4.close();
  const c5 = new NetherNetClient({ host: '127.0.0.1', port, RTC, expectKey: '0123456789abcdef' });
  err = null; try { await c5.connect(1000); } catch (e) { err = e.message; }
  check(c4.serverIdentity.pin === pin && /key [0-9a-f]{16} is not the expected 0123456789abcdef/.test(err ?? ''), 'key=<pin>: the right key connects, another one is refused (operator key changed)', err);
  err = null; try { new NetherNetClient({ host: '127.0.0.1', port, RTC, identity: 'maybe' }); } catch (e) { err = e.message; }
  check(/identity=maybe: verify\|strict\|warn\|off/.test(err ?? ''), 'identity=<typo>: refused with the valid values', err);
}
// 6. signaling through an https reverse proxy (TLS is the trust anchor): a test CA via ca=, an untrusted certificate refused
{
  const k = path.join(TMP, 'k.pem'), crt = path.join(TMP, 'c.pem');
  let tlsOk = true;
  try { execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', k, '-out', crt, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' }); } catch { tlsOk = false; }
  if (!tlsOk) check(true, 'https signaling: skipped (no openssl to make a test certificate)');
  else {
    const hs = https.createServer({ key: fs.readFileSync(k), cert: fs.readFileSync(crt) }, (q, r) => {
      const u = q.url.replace(/^\/mc/, '');   // the proxy serves NetherNet under /mc
      if (q.method === 'GET' && u === '/v1/join') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end('{}'); }
      if (q.method === 'POST' && /^\/v1\/join\/\d+$/.test(u)) { let b = ''; q.on('data', (d) => (b += d)).on('end', () => { r.writeHead(200, { 'Content-Type': 'application/sdp' }); r.end(offerOk(b) ? ANSWER('good') : '37'); }); return; }
      r.writeHead(404); r.end();
    });
    await new Promise((res) => hs.listen(0, '127.0.0.1', res));
    const url = `https://localhost:${hs.address().port}/mc/`, got = [];
    const c = new NetherNetClient({ url, ca: crt, RTC, pins: pinFile, identity: 'strict', log: (l) => got.push(l) });
    await c.connect(1000); c.close();
    check(c.serverIdentity.trust === 'tls' && got.some((l) => /https: TLS is the trust anchor, not pinned/.test(l)), 'signaling=https://…/mc + ca=: joins; TLS is the anchor (strict does not ask for a pin)', got.join('\n'));
    const c2 = new NetherNetClient({ url, RTC });
    let err = null; try { await c2.connect(1000); } catch (e) { err = e.message; }
    check(/over https: .*certificate.*ca=<pem>/.test(err ?? ''), 'https with an untrusted certificate: refused, says ca= trusts a test CA', err);
    err = null; try { new NetherNetClient({ url: 'ftp://x', RTC }); } catch (e) { err = e.message; }
    check(/http or https only/.test(err ?? ''), 'signaling=ftp://…: refused', err);
    hs.close();
  }
}
// 7. receiving: a broken fragment countdown is dropped, not handed on corrupt; unreliable fragments are dropped
{
  const got = [], recv = [];
  const c = new NetherNetClient({ host: '127.0.0.1', port, RTC, log: (l) => got.push(l) }); await c.connect(1000);
  c.onEncapsulated = (b) => recv.push(b);
  const R = c.pc.dcs[0], U = c.pc.dcs[1];
  R.onmessage({ data: Buffer.from([2, 1, 1]) }); R.onmessage({ data: Buffer.from([0, 9, 9]) });   // 1 went missing
  R.onmessage({ data: Buffer.from([1, 5]) }); R.onmessage({ data: Buffer.from([0, 6]) });          // then a good pair
  U.onmessage({ data: Buffer.from([1, 4]) });
  check(recv.length === 1 && recv[0].equals(Buffer.from([0xfe, 5, 6])) && got.some((l) => /fragment order broken \(got 0, expected 1\)/.test(l)), 'receive: a gap in the countdown drops that message, the next one arrives whole', got.join('\n') + ' ' + recv.map((b) => b.toString('hex')).join());
  check(got.some((l) => /dropped a fragment on the unreliable channel/.test(l)), 'receive: a fragment on the unreliable channel is dropped (never fragmented)', got.join('\n'));
  c.close();
}
fs.rmSync(TMP, { recursive: true, force: true });
srv.close();
console.log(`\n${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
