'use strict';
// NetherNet client: the WebRTC transport a real Bedrock client uses when a server runs `transport=nethernet`.
// Follows Mojang's "NetherNet HTTP Signaling — Partner Onboarding Guide" (bedrock-protocol-docs):
//   GET  http://host:port/v1/join             → 2xx + server info JSON (NetherNet supported)
//   POST http://host:port/v1/join/{networkId} → body: the complete SDP offer (full ICE, no trickle), reply: the SDP answer
//   the answer carries a=identity (JWT self-signed with its cpk + a detached JWS over the a=fingerprint lines): verified like
//   the client does (structure, both signatures, exp), then stripped before setRemoteDescription
//   two data channels: ReliableDataChannel (ordered, reliable, fragmented) and UnreliableDataChannel (unordered, 0 retransmits)
//   every message starts with 1 byte = fragments still to come (0 = complete / last)
// Game packets are the same batches as over RakNet without RakNet's 0xfe batch id: stripped when sending, added back when
// receiving, so bedrock-protocol sees exactly what it sees over RakNet. Same shape as raknet.cjs (connect, sendReliable, close,
// onConnected, onEncapsulated, onCloseConnection, ping), so it drops into bedrock-protocol the same way.
// WebRTC itself: node-datachannel (libdatachannel, prebuilt for macOS/Linux/Windows), installed by the lab on first use.
const http = require('node:http');
const https = require('node:https');
const fsx = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const MAX_SEGMENT = 262144 - 1;   // max-message-size (256 KiB) minus the header byte

// where signaling is: server-port over plain HTTP (BDS itself), or a URL (a reverse proxy in front of it; https = TLS)
function endpoint({ host, port, url, ca }) {
  if (!url) return { tls: false, host, port, base: '', ca: null, text: `${host}:${port}` };
  let u; try { u = new URL(url); } catch { throw new Error(`NetherNet signaling=${url}: not a URL (http://host:port or https://host[:port][/path])`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`NetherNet signaling=${url}: http or https only`);
  const tls = u.protocol === 'https:';
  return { tls, host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || (tls ? 443 : 80), base: u.pathname.replace(/\/+$/, ''), ca: ca ? fsx.readFileSync(ca) : null, text: u.origin + u.pathname.replace(/\/+$/, '') };
}
function httpReq(method, ep, path, body, timeoutMs = 30000) {   // the answer waits for the server's full ICE gathering
  return new Promise((resolve, reject) => {
    const { host, port } = ep;
    const r = (ep.tls ? https : http).request({ host, port, path: ep.base + path, method, headers: body ? { 'Content-Type': 'application/sdp', 'Content-Length': Buffer.byteLength(body) } : {}, timeout: timeoutMs, ...(ep.tls ? { servername: /^[\d.:]+$/.test(host) ? undefined : host, ...(ep.ca ? { ca: ep.ca } : {}) } : {}), agent: false }, (res) => {
      let data = '';
      res.setEncoding('utf8').on('data', (d) => (data += d)).on('end', () => resolve({ status: res.statusCode, body: data, type: res.headers['content-type'] ?? '' }));
    });
    r.on('timeout', () => r.destroy(new Error(`NetherNet signaling: no answer from ${ep.text}${path} in ${timeoutMs}ms`)));
    r.on('error', (e) => reject(ep.tls && /certificate|self.signed|CERT_|unable to verify/i.test(e.message) ? new Error(`NetherNet signaling over https: ${e.message} (a real client refuses this certificate; ca=<pem> trusts a test CA)`) : e));
    if (body) r.write(body);
    r.end();
  });
}

// canonical JSON (keys sorted, no whitespace): what both sides sign over the SDP's a=fingerprint lines
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const fingerprintsOf = (sdp) => ({ fingerprint: [...sdp.matchAll(/^a=fingerprint:(\S+) (\S+)\s*$/gm)].map((m) => ({ algorithm: m[1], digest: m[2] })) });
const HASH = { ES256: 'sha256', ES384: 'sha384', ES512: 'sha512', RS256: 'sha256', RS384: 'sha384', RS512: 'sha512', PS256: 'sha256', PS384: 'sha384', PS512: 'sha512', EdDSA: null };
function jwsVerify(alg, key, input, sig) {
  if (!(alg in HASH)) throw new Error(`unsupported alg ${alg}`);
  const opts = { key, ...(alg.startsWith('ES') ? { dsaEncoding: 'ieee-p1363' } : {}), ...(alg.startsWith('PS') ? { padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST } : {}) };
  return crypto.verify(HASH[alg], Buffer.from(input), opts, sig);
}
// the client's check of the server assertion (guide §5.2, steps 1-6). Returns { key, iss, exp } or throws.
function verifyIdentity(sdp) {
  const line = /^a=identity:(\S+)\s*$/m.exec(sdp);
  if (!line) throw new Error('the answer has no a=identity (a real client refuses the connection)');
  const env = JSON.parse(Buffer.from(line[1], 'base64').toString('utf8'));
  const { token, fingerprints } = JSON.parse(env.assertion);
  const [h, p, s] = String(token).split('.');
  const header = JSON.parse(unb64u(h)), claims = JSON.parse(unb64u(p));
  if (!claims.cpk || typeof claims.cpk !== 'object') throw new Error('server identity: the JWT has no cpk (JWK) claim');
  const key = crypto.createPublicKey({ key: claims.cpk, format: 'jwk' });
  if (!jwsVerify(header.alg, key, `${h}.${p}`, unb64u(s))) throw new Error('server identity: the JWT is not self-signed by its cpk');
  const [fh, empty, fs] = String(fingerprints).split('.');
  if (empty !== '') throw new Error('server identity: fingerprints is not a detached JWS');
  const fhead = JSON.parse(unb64u(fh));
  if (!jwsVerify(fhead.alg, key, `${fh}.${b64u(canonical(fingerprintsOf(sdp)))}`, unb64u(fs))) throw new Error('server identity: the signature over the a=fingerprint lines does not verify');
  if (claims.exp && claims.exp * 1000 < Date.now()) throw new Error('server identity: the token has expired');
  const pin = crypto.createHash('sha256').update(canonical(claims.cpk)).digest('hex').slice(0, 16);
  return { pin, iss: claims.iss ?? env.idp?.domain ?? '', alg: header.alg };
}
// the client's own assertion in the offer (guide §5.1): a token whose cpk is this connection's key, plus a detached JWS over the
// offer's a=fingerprint lines. BDS in offline mode (online-mode=false) accepts a self-signed token but refuses an offer without
// one (POST answers 200 with the body "37" instead of an SDP). cpk = base64 DER SPKI, like the login chain (a JWK cpk is refused).
// The key must be the login's key (bedrock-protocol's ecdhKeyPair): BDS derives the game encryption from the offer's cpk, so
// another key ends in "Checksum mismatch" + HostDisconnected right after the handshake.
function clientIdentity(sdp, name = 'player', keyPair = null) {
  const { privateKey, publicKey } = keyPair ?? crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const x5u = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const sign = (input) => b64u(crypto.sign('sha384', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }));
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'ES384', typ: 'JWT', x5u })), p = b64u(JSON.stringify({ cpk: x5u, xname: name, iss: 'bds-lab', iat: now, nbf: now - 60, exp: now + 3600 }));
  const token = `${h}.${p}.${sign(`${h}.${p}`)}`;
  const fh = b64u(JSON.stringify({ alg: 'ES384' }));
  const fingerprints = `${fh}..${sign(`${fh}.${b64u(canonical(fingerprintsOf(sdp)))}`)}`;
  const line = 'a=identity:' + Buffer.from(JSON.stringify({ idp: { domain: 'bds-lab', protocol: 'default' }, assertion: JSON.stringify({ token, fingerprints }) })).toString('base64');
  const L = sdp.split(/\r?\n/).filter((l) => l !== '');
  L.splice(L.findIndex((l) => l.startsWith('m=')), 0, line);
  return L.join('\r\n') + '\r\n';
}
const stripIdentity = (sdp) => sdp.split(/\r?\n/).filter((l) => !/^a=identity:/.test(l)).join('\r\n');

// Trust on first use (guide §5.2): over plain HTTP the operator key is the unit of trust. The game asks the player the first
// time it sees a key, then accepts that key silently everywhere (any address). The lab keeps the pins in a JSON file.
function loadPins(file) { if (!file) return {}; try { return JSON.parse(fsx.readFileSync(file, 'utf8')); } catch { return {}; } }
function savePins(file, pins) { if (!file) return; try { fsx.writeFileSync(file, JSON.stringify(pins, null, 1)); } catch { /* read-only: pins stay in memory */ } }
const IDENTITY_MODES = ['verify', 'strict', 'warn', 'off'];

class NetherNetClient extends EventEmitter {
  // RTC: { RTCPeerConnection } from node-datachannel/polyfill
  // identity: verify (like the game: first use of a key = accepted and pinned) | strict (a key not pinned yet is refused, like a
  // player answering "no" to the first-use prompt) | warn (report, go on) | off. expectKey: the pin this server must present.
  // url/ca: signaling through http(s)://host[:port][/path] instead of host:port (https: TLS is the trust anchor, no pinning).
  constructor({ host = '127.0.0.1', port = 19132, url = null, ca = null, RTC, identity = 'verify', pins = null, expectKey = null, log = () => {}, name = 'player' } = {}) {
    super();
    if (!IDENTITY_MODES.includes(identity)) throw new Error(`NetherNet identity=${identity}: ${IDENTITY_MODES.join('|')}`);
    Object.assign(this, { host, port, RTC, identity, pins, expectKey, log, name });
    this.ep = endpoint({ host, port, url, ca });
    this.connected = false;
    this.onConnected = () => {};
    this.onCloseConnection = () => {};
    this.onEncapsulated = () => {};
    this.networkId = (crypto.randomBytes(8).readBigUInt64BE() & 0x7fffffffffffffffn).toString();
    this.parts = [];
    this.maxSegment = MAX_SEGMENT;
  }

  async info() {
    const r = await httpReq('GET', this.ep, '/v1/join');
    if (r.status < 200 || r.status > 299) throw new Error(`NetherNet not offered at ${this.ep.text} (GET /v1/join → ${r.status}); the server runs transport=raknet?`);
    try { return JSON.parse(r.body); } catch { return {}; }
  }

  async ping() {   // the RakNet-style advertisement bedrock-protocol and the lab read (MCPE;name;protocol;version;players;max;...)
    const i = await this.info();
    const s = ['MCPE', i.name ?? '', i.protocol ?? 0, i.version ?? '', i.players ?? 0, i.maxPlayers ?? 0, this.networkId, i.level ?? '', ['Survival', 'Creative', 'Adventure'][i.gameType] ?? 'Survival', 1, this.port, this.port].join(';') + ';';
    this.emit('pong', s);
    return s;
  }

  // one retry with a fresh peer connection: libdatachannel rarely fails applying the answer ("remote candidate without ICE
  // transport"); a refused identity or a missing server is not retried
  async connect(timeoutMs = 15000) {
    try { return await this._connect(timeoutMs); } catch (e) {
      if (this.connected || !/libdatachannel|ICE|did not open/i.test(e.message)) throw e;
      this.log(`nethernet: retrying once (${e.message})`);
      try { this.pc?.close(); } catch { /* gone */ }
      this.parts = [];
      return this._connect(timeoutMs);
    }
  }

  async _connect(timeoutMs) {
    if (!this.RTC?.RTCPeerConnection) throw new Error('NetherNet needs node-datachannel (the lab installs it on first use)');
    this.server = await this.info();
    const pc = (this.pc = new this.RTC.RTCPeerConnection({ iceServers: [] }));   // host candidates only, like the client
    this.rel = pc.createDataChannel('ReliableDataChannel', { ordered: true });
    this.unrel = pc.createDataChannel('UnreliableDataChannel', { ordered: false, maxRetransmits: 0 });
    for (const dc of [this.rel, this.unrel]) { dc.binaryType = 'arraybuffer'; dc.onmessage = (ev) => this._onMessage(dc, ev.data); }
    pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState) && this.connected) this._closed('NetherNet ' + pc.connectionState); };
    await pc.setLocalDescription(await pc.createOffer());
    // full ICE: every candidate in the one offer (trickle disabled)
    await new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(res, 3000);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } };
      pc.onicecandidate = (e) => { if (!e.candidate) { clearTimeout(t); res(); } };
    });
    const offer = clientIdentity(pc.localDescription.sdp, this.name, this.keyPair);
    const r = await httpReq('POST', this.ep, `/v1/join/${this.networkId}`, offer);
    if (r.status < 200 || r.status > 299) throw new Error(`NetherNet signaling refused: POST /v1/join → ${r.status} ${r.body.slice(0, 200)}`);
    // BDS answers a refused offer with 200 and a bare session-error number (e.g. 37: the offer's identity was declined)
    if (!/^v=0/m.test(r.body)) { pc.close(); throw new Error(`NetherNet: the server declined the offer (session error ${r.body.trim().slice(0, 40) || 'empty'}${r.body.trim() === '37' ? ': client identity refused' : ''})`); }
    const answer = r.body;
    if (this.identity !== 'off') {
      try { this.serverIdentity = verifyIdentity(answer); this._trust(this.serverIdentity); }
      catch (e) { if (this.identity !== 'warn') { pc.close(); throw new Error('NetherNet: ' + e.message); } this.log('nethernet: ' + e.message + ' (identity=warn: going on)'); }
    }
    const mms = /^a=max-message-size:(\d+)/m.exec(answer);
    if (mms && Number(mms[1]) > 1) this.maxSegment = Math.min(MAX_SEGMENT, Number(mms[1]) - 1);
    await pc.setRemoteDescription({ type: 'answer', sdp: stripIdentity(answer) });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`NetherNet: the data channel did not open in ${timeoutMs}ms (ICE/DTLS; in a container check server-udp-ports)`)), timeoutMs);
      const ok = () => { clearTimeout(t); res(); };
      if (this.rel.readyState === 'open') ok(); else this.rel.onopen = ok;
    });
    this.connected = true;
    this.emit('_connected');
    this.onConnected();
    return this;
  }

  // after the signatures: which trust anchor accepts this key (TLS, or the pin store), like the client decides
  _trust(id) {
    const what = `${id.pin} (${id.alg}${id.iss ? ', ' + id.iss : ''})`;
    if (this.expectKey && id.pin !== this.expectKey) throw new Error(`server identity: key ${id.pin} is not the expected ${this.expectKey} (the operator key changed: /serveridentity save keeps it across restarts)`);
    if (this.ep.tls) { id.trust = 'tls'; return this.log(`nethernet: server key ${what} (https: TLS is the trust anchor, not pinned)`); }
    const pins = loadPins(this.pins), known = pins[id.pin];
    if (known) { id.trust = 'pinned'; known.last = new Date().toISOString(); savePins(this.pins, pins); return this.log(`nethernet: server key ${what} known (pinned ${known.first.slice(0, 10)})`); }
    if (this.identity === 'strict') throw new Error(`server identity: key ${id.pin} is not pinned (identity=strict = the player declined the first-use prompt; identity=verify accepts and pins it)`);
    id.trust = 'first-use';
    pins[id.pin] = { first: new Date().toISOString(), where: this.ep.text, iss: id.iss };
    savePins(this.pins, pins);
    this.log(`nethernet: server key ${what} first use: pinned (the game asks the player once here)`);
  }

  _onMessage(dc, data) {
    const b = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    if (!b.length) return;
    const left = b[0];
    if (process.env.LAB_NN_DEBUG) { let t = ''; try { if (b[1] === 0) t = require('node:zlib').inflateRawSync(b.subarray(2)).subarray(0, 1200).toString('latin1'); else if (b[1] === 0xff) t = b.subarray(2, 80).toString('latin1'); } catch {} console.error(`NN< ${dc === this.unrel ? 'U' : 'R'} hdr=${left} len=${b.length} ${b.subarray(1, 17).toString('hex')} ${JSON.stringify(t)}`); }
    if (dc === this.unrel) { if (left === 0) this._deliver(b.subarray(1)); else this.log(`nethernet: dropped a fragment on the unreliable channel (header ${left}; it is never fragmented)`); return; }
    // countdown: the first fragment says how many follow, each next one is one less. A gap means a lost/foreign fragment:
    // drop the partial message instead of handing bedrock-protocol a corrupt batch
    // (the breaking fragment too: it may be the tail of the broken message, and a tail alone is not a batch)
    if (this.parts.length && left !== this.nextLeft) { this.log(`nethernet: fragment order broken (got ${left}, expected ${this.nextLeft}): dropped ${this.parts.length + 1} fragment(s)`); this.parts = []; return; }
    this.parts.push(b.subarray(1));
    this.nextLeft = left - 1;
    if (left !== 0) return;
    const whole = Buffer.concat(this.parts);
    this.parts = [];
    this._deliver(whole);
  }

  _deliver(payload) {   // back into RakNet's shape: 0xfe + batch, in its own ArrayBuffer (bedrock-protocol reads .buffer)
    const copy = Buffer.allocUnsafeSlow(payload.length + 1);
    copy[0] = 0xfe;
    payload.copy(copy, 1);
    this.onEncapsulated(copy, `${this.host}:${this.port}`);
  }

  // segments = [N-1 .. 0] countdown headers, reliable channel only
  static frame(payload, maxSegment = MAX_SEGMENT) {
    const n = Math.max(1, Math.ceil(payload.length / maxSegment));
    if (n > 256) throw new Error(`NetherNet: message of ${payload.length} bytes needs ${n} fragments (max 256)`);
    const out = [];
    for (let i = 0; i < n; i++) out.push(Buffer.concat([Buffer.from([n - 1 - i]), payload.subarray(i * maxSegment, (i + 1) * maxSegment)]));
    return out;
  }

  sendReliable(buffer) {
    if (!this.rel || this.rel.readyState !== 'open') return;
    const payload = buffer[0] === 0xfe ? buffer.subarray(1) : buffer;
    for (const seg of NetherNetClient.frame(payload, this.maxSegment)) this.rel.send(seg);
  }

  _closed(why) { if (!this.connected) return; this.connected = false; this.onCloseConnection(why); }

  close() {
    const was = this.connected;
    this.connected = false;
    for (const dc of [this.rel, this.unrel]) try { dc?.close(); } catch { /* gone */ }
    try { this.pc?.close(); } catch { /* gone */ }
    if (was) this.onCloseConnection('closed');
  }
}

module.exports = { NetherNetClient, verifyIdentity, canonical, fingerprintsOf, stripIdentity };
