'use strict';
// 最小の RakNet クライアント（protocol 11）。
// BDS 1.26 は RakNet protocol 11 を要求するため、既存の JS 実装（jsp-raknet: protocol 10）では
// つながらない。bedrock-protocol の RakClient と同じ形にしてあるので、そのまま差し込んで使える。
// The protocol itself (socket, ACKs, resends, splits, ordering) runs in a worker thread of its own: a busy main thread (decoding
// the login's big packets, planning a route) then never delays an ACK. At LAB_SPEED=50 the server's 10 s RakNet timeout is 0.2 s
// of real time, and one 0.37 s stall while the login's crafting data was decoded made BDS drop the connection. LAB_RAK_WORKER=0:
// in this thread as before.
const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const WT = require('node:worker_threads');

const MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
const RAKNET_PROTOCOL = 11;

const ID = {
  ConnectedPing: 0x00,
  UnconnectedPing: 0x01,
  ConnectedPong: 0x03,
  OpenConnectionRequest1: 0x05,
  OpenConnectionReply1: 0x06,
  OpenConnectionRequest2: 0x07,
  OpenConnectionReply2: 0x08,
  ConnectionRequest: 0x09,
  ConnectionRequestAccepted: 0x10,
  NewIncomingConnection: 0x13,
  DisconnectNotification: 0x15,
  IncompatibleProtocol: 0x19,
  UnconnectedPong: 0x1c,
};

const RELIABILITY = { UNRELIABLE: 0, RELIABLE: 2, RELIABLE_ORDERED: 3 };

function writeAddress(host, port) {
  const b = Buffer.alloc(7);
  b[0] = 4;
  const parts = host.split('.').map(Number);
  for (let i = 0; i < 4; i++) b[1 + i] = (~parts[i]) & 0xff;
  b.writeUInt16BE(port, 5);
  return b;
}
const readAddressLength = (buf, off) => (buf[off] === 4 ? 7 : 29);

function writeUInt24LE(buf, value, off) {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
  buf[off + 2] = (value >> 16) & 0xff;
}
const readUInt24LE = (buf, off) => buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);

class RakCore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 19132;
    this.connected = false;
    this.onConnected = () => {};
    this.onCloseConnection = () => {};
    this.onEncapsulated = () => {};

    this.guid = Buffer.from(require('node:crypto').randomBytes(8)).readBigUInt64BE() & 0x7fffffffffffffffn;
    this.mtu = 1400;
    this.sendSeq = 0;
    this.reliableIndex = 0;
    this.orderIndex = 0;
    this.splitId = 0;
    this.splits = new Map();
    this.seenDatagrams = new Set();   // 再送されてきた datagram を 2 度渡さない
    this.seenReliable = new Set();
    this.expectedOrder = 0;           // 順序付きの受信はここで並べ直す
    this.orderBuffer = new Map();
    this.ackQueue = [];
    this.sent = new Map();           // 送った datagram（NAK で送り直す）: seq -> { buf, at }
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg) => { this.heard = Date.now(); this._onMessage(msg); });
    this.socket.on('error', (e) => this.emit('error', e));
    this._closed = false;
    this._ackSoon = false;
    this.heard = Date.now();
  }

  _send(buf) { if (!this._closed) this.socket.send(buf, this.port, this.host); }

  connect(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;
      const timer = setTimeout(() => reject(new Error('RakNet の接続がタイムアウトしました')), timeoutMs);
      this.once('_connected', () => { clearTimeout(timer); resolve(this); });
      this._sendOpenConnectionRequest1();
      this._retry = setInterval(() => { if (!this.connected) this._sendOpenConnectionRequest1(); }, 1000);
      this._tick = setInterval(() => this._timers(), 10);
    });
  }

  // every 10 ms: ACKs not sent yet, reliable datagrams the server has not acknowledged for 0.5 s (lost: sent again), and a server
  // that has sent nothing for LAB_RAK_SILENT ms (default 30 s; it dropped us without a word: BDS times a peer out silently)
  _timers() {
    this._flushAcks();
    const now = Date.now();
    if (process.env.LAB_DEBUG_JOIN) {   // this thread's own stalls, and the server's silences, as the login goes
      if (this._lastT && now - this._lastT > 40) this.emit('dbg', `rak thread stall ${now - this._lastT} ms`);
      if (now - this.heard > 100 && !this._quiet) { this._quiet = true; this.emit('dbg', `rak server quiet since ${now - this.heard} ms`); }
      if (now - this.heard <= 100 && this._quiet) this._quiet = false;
      this._lastT = now;
    }
    if (this.connected) {
      let n = 0;
      for (const [seq, e] of this.sent) {
        if (now - e.at < 500 || n++ >= 16) continue;
        this.sent.delete(seq);
        this._resend(e.buf);
      }
      if (now - this.heard > (Number(process.env.LAB_RAK_SILENT) || 30000)) { this.connected = false; this.onCloseConnection('timeout'); }
    }
  }

  _resend(buf) {
    writeUInt24LE(buf, this.sendSeq++, 1);
    this.sent.set(this.sendSeq - 1, { buf, at: Date.now() });
    this._send(buf);
  }

  _sendOpenConnectionRequest1() {
    const b = Buffer.alloc(1 + 16 + 1 + (this.mtu - 46));
    b[0] = ID.OpenConnectionRequest1;
    MAGIC.copy(b, 1);
    b[17] = RAKNET_PROTOCOL;
    this._send(b);
  }

  _sendOpenConnectionRequest2() {
    const addr = writeAddress(this.host, this.port);
    const b = Buffer.alloc(1 + 16 + addr.length + 2 + 8);
    let o = 0;
    b[o++] = ID.OpenConnectionRequest2;
    MAGIC.copy(b, o); o += 16;
    addr.copy(b, o); o += addr.length;
    b.writeUInt16BE(this.mtu, o); o += 2;
    b.writeBigUInt64BE(this.guid, o);
    this._send(b);
  }

  _sendConnectionRequest() {
    const b = Buffer.alloc(1 + 8 + 8 + 1);
    b[0] = ID.ConnectionRequest;
    b.writeBigUInt64BE(this.guid, 1);
    b.writeBigInt64BE(BigInt(Date.now()), 9);
    b[17] = 0;
    this.sendReliable(b, true);
  }

  _sendNewIncomingConnection(requestTime) {
    const parts = [Buffer.from([ID.NewIncomingConnection]), writeAddress(this.host, this.port)];
    for (let i = 0; i < 20; i++) parts.push(writeAddress('0.0.0.0', 0));
    const tail = Buffer.alloc(16);
    tail.writeBigInt64BE(requestTime, 0);
    tail.writeBigInt64BE(BigInt(Date.now()), 8);
    parts.push(tail);
    this.sendReliable(Buffer.concat(parts), true);
  }

  // ---- 受信 --------------------------------------------------------------

  _onMessage(msg) {
    const id = msg[0];
    if (!this.connected) {
      if (id === ID.OpenConnectionReply1) {
        const mtu = msg.readUInt16BE(1 + 16 + 8 + 1);
        this.mtu = Math.min(mtu, this.mtu);
        this._sendOpenConnectionRequest2();
        return;
      }
      if (id === ID.OpenConnectionReply2) { this._sendConnectionRequest(); return; }
      if (id === ID.IncompatibleProtocol) {
        this.emit('error', new Error('RakNet のプロトコル版が合いません（サーバーは 11 以外を要求しています）'));
        return;
      }
      if (id === ID.UnconnectedPong) {
        const len = msg.length > 35 ? msg.readUInt16BE(33) : 0;
        this.emit('pong', msg.slice(35, 35 + len).toString());
        return;
      }
    }
    if ((id & 0xf0) === 0xc0) return this._onAck(msg);          // ACK
    if ((id & 0xf0) === 0xa0) return this._onNak(msg);          // NAK
    if (id & 0x80) return this._onDatagram(msg);
  }

  _onAck(msg) {
    for (const seq of this._records(msg)) this.sent.delete(seq);
  }

  _onNak(msg) {
    for (const seq of this._records(msg)) {
      const e = this.sent.get(seq);
      if (e) { this.sent.delete(seq); this._resend(e.buf); }
    }
  }

  *_records(msg) {
    const count = msg.readUInt16BE(1);
    let o = 3;
    for (let i = 0; i < count; i++) {
      const single = msg[o++] === 1;
      const start = readUInt24LE(msg, o); o += 3;
      if (single) { yield start; continue; }
      const end = readUInt24LE(msg, o); o += 3;
      for (let s = start; s <= end; s++) yield s;
    }
  }

  _onDatagram(msg) {
    const seq = readUInt24LE(msg, 1);
    this.ackQueue.push(seq);
    // ACK as soon as this burst of datagrams is read (a sped-up server's resend timer is a few real ms)
    if (!this._ackSoon) { this._ackSoon = true; setImmediate(() => { this._ackSoon = false; this._flushAcks(); }); }
    if (this.seenDatagrams.has(seq)) return;   // 重複は ACK だけ返して捨てる
    this.seenDatagrams.add(seq);
    if (this.seenDatagrams.size > 4096) this.seenDatagrams.delete(this.seenDatagrams.values().next().value);
    let o = 4;
    while (o < msg.length) {
      const flags = msg[o++];
      const reliability = (flags & 0xe0) >> 5;
      const split = (flags & 0x10) !== 0;
      const bitLength = msg.readUInt16BE(o); o += 2;
      const length = Math.ceil(bitLength / 8);
      let reliableIndex = null;
      if (reliability >= 2 && reliability !== 5) { reliableIndex = readUInt24LE(msg, o); o += 3; }
      if (reliability === 1 || reliability === 4) o += 3;                   // sequenced index
      let orderIndex = null;
      if (reliability === 1 || reliability === 3 || reliability === 4) { orderIndex = readUInt24LE(msg, o); o += 4; } // order index + channel
      let splitInfo = null;
      if (split) {
        splitInfo = { count: msg.readUInt32BE(o), id: msg.readUInt16BE(o + 4), index: msg.readUInt32BE(o + 6) };
        o += 10;
      }
      const body = msg.slice(o, o + length); o += length;
      if (reliableIndex !== null) {
        if (this.seenReliable.has(reliableIndex)) continue;
        this.seenReliable.add(reliableIndex);
        if (this.seenReliable.size > 8192) this.seenReliable.delete(this.seenReliable.values().next().value);
      }
      if (splitInfo) {
        let box = this.splits.get(splitInfo.id);
        if (!box) { box = { count: splitInfo.count, parts: new Map(), orderIndex }; this.splits.set(splitInfo.id, box); }
        box.parts.set(splitInfo.index, body);
        if (box.parts.size === box.count) {
          this.splits.delete(splitInfo.id);
          const parts = [];
          for (let i = 0; i < box.count; i++) parts.push(box.parts.get(i));
          this._ordered(box.orderIndex, Buffer.concat(parts));
        }
      } else {
        this._ordered(orderIndex, body);
      }
    }
  }

  /** 順序付きで届いたものは、抜けが埋まるまで待ってから順番どおりに渡す。
   *  暗号は連続したストリームなので、1 つでも前後すると以降すべて壊れる。 */
  _ordered(orderIndex, body) {
    if (orderIndex === null || orderIndex === undefined) { this._onEncapsulated(body); return; }
    if (orderIndex < this.expectedOrder) return;
    this.orderBuffer.set(orderIndex, body);
    while (this.orderBuffer.has(this.expectedOrder)) {
      const b = this.orderBuffer.get(this.expectedOrder);
      this.orderBuffer.delete(this.expectedOrder);
      this.expectedOrder++;
      this._onEncapsulated(b);
    }
  }

  _onEncapsulated(buf) {
    const id = buf[0];
    if (id === ID.ConnectionRequestAccepted) {
      let o = 1 + readAddressLength(buf, 1);
      o += 2;                                   // system index
      for (let i = 0; i < 20 && o + 16 < buf.length; i++) o += readAddressLength(buf, o);
      const requestTime = buf.readBigInt64BE(o);
      this._sendNewIncomingConnection(requestTime);
      this.connected = true;
      this.emit('_connected');
      this.onConnected();
      return;
    }
    if (id === ID.ConnectedPing) {
      const b = Buffer.alloc(17);
      b[0] = ID.ConnectedPong;
      buf.copy(b, 1, 1, 9);
      b.writeBigInt64BE(BigInt(Date.now()), 9);
      this.sendReliable(b, true);
      return;
    }
    if (id === ID.DisconnectNotification) { this.connected = false; this.onCloseConnection('disconnect'); return; }
    if (id === 0xfe) {
      // bedrock-protocol は encapsulated.buffer（ArrayBuffer）を直接読むので、
      // プールを共有しない実体を渡す
      const copy = Buffer.allocUnsafeSlow(buf.length);
      buf.copy(copy);
      this.onEncapsulated(copy, `${this.host}:${this.port}`);
      return;
    }
    if (id === ID.ConnectedPong) return;
  }

  _flushAcks() {
    if (!this.ackQueue.length) return;
    const seqs = [...new Set(this.ackQueue)].sort((a, b) => a - b);
    this.ackQueue = [];
    const ranges = [];
    let start = seqs[0]; let prev = seqs[0];
    for (const s of seqs.slice(1)) {
      if (s === prev + 1) { prev = s; continue; }
      ranges.push([start, prev]); start = s; prev = s;
    }
    ranges.push([start, prev]);
    const parts = [];
    const head = Buffer.alloc(3);
    head[0] = 0xc0;
    head.writeUInt16BE(ranges.length, 1);
    parts.push(head);
    for (const [a, b] of ranges) {
      if (a === b) { const r = Buffer.alloc(4); r[0] = 1; writeUInt24LE(r, a, 1); parts.push(r); }
      else { const r = Buffer.alloc(7); r[0] = 0; writeUInt24LE(r, a, 1); writeUInt24LE(r, b, 4); parts.push(r); }
    }
    this._send(Buffer.concat(parts));
  }

  // ---- 送信 --------------------------------------------------------------

  ping() {
    const b = Buffer.alloc(33);
    b[0] = ID.UnconnectedPing;
    b.writeBigUInt64BE(BigInt(Date.now()), 1);
    MAGIC.copy(b, 9);
    b.writeBigUInt64BE(this.guid, 25);
    this._send(b);
  }

  sendReliable(buffer) {
    const maxBody = this.mtu - 60;
    if (buffer.length <= maxBody) { this._sendFrame(buffer, null); return; }
    const count = Math.ceil(buffer.length / maxBody);
    const splitId = this.splitId++ & 0xffff;
    const orderIndex = this.orderIndex++;
    for (let i = 0; i < count; i++) {
      this._sendFrame(buffer.slice(i * maxBody, (i + 1) * maxBody), { count, id: splitId, index: i }, orderIndex);
    }
  }

  _sendFrame(body, split, orderIndex) {
    const header = Buffer.alloc(3 + 3 + 4 + (split ? 10 : 0));
    let o = 0;
    header[o++] = (RELIABILITY.RELIABLE_ORDERED << 5) | (split ? 0x10 : 0);
    header.writeUInt16BE(body.length * 8, o); o += 2;
    writeUInt24LE(header, this.reliableIndex++, o); o += 3;
    writeUInt24LE(header, orderIndex ?? this.orderIndex++, o); o += 3;
    header[o++] = 0;                                    // order channel
    if (split) {
      header.writeUInt32BE(split.count, o); o += 4;
      header.writeUInt16BE(split.id, o); o += 2;
      header.writeUInt32BE(split.index, o); o += 4;
    }
    const datagram = Buffer.concat([Buffer.from([0x84]), Buffer.alloc(3), header.slice(0, o), body]);
    writeUInt24LE(datagram, this.sendSeq++, 1);
    this.sent.set(this.sendSeq - 1, { buf: datagram, at: Date.now() });
    if (this.sent.size > 4096) this.sent.delete(this.sent.keys().next().value);
    this._send(datagram);
  }

  close() {
    if (this._closed) return;
    // tell the server we are leaving (otherwise it only notices after a timeout)
    if (this.connected) { try { this.sendReliable(Buffer.from([ID.DisconnectNotification]), true); } catch {} }
    this.connected = false;
    clearInterval(this._retry);
    setTimeout(() => { this._closed = true; clearInterval(this._tick); try { this.socket.close(); } catch {} }, 100);
  }
}

// ---- the worker: one RakCore, talking to the RakClient below by messages ----
if (!WT.isMainThread && WT.workerData?.labRak) {
  const core = new RakCore(WT.workerData.labRak), port = WT.parentPort;
  core.onConnected = () => port.postMessage({ t: 'connected' });
  core.onCloseConnection = (r) => port.postMessage({ t: 'close', r });
  core.onEncapsulated = (buf) => { port.postMessage({ t: 'enc', b: buf.buffer }, [buf.buffer]); };   // (an unshared copy: moved, not copied)
  core.on('pong', (s) => port.postMessage({ t: 'pong', s }));
  core.on('error', (e) => port.postMessage({ t: 'error', m: String(e?.message ?? e) }));
  core.on('dbg', (m) => port.postMessage({ t: 'dbg', m }));
  port.on('message', (m) => {
    if (m.t === 'send') core.sendReliable(Buffer.from(m.b));
    else if (m.t === 'connect') core.connect(m.ms).catch((e) => port.postMessage({ t: 'error', m: e.message }));
    else if (m.t === 'ping') core.ping();
    else if (m.t === 'close') { core.close(); setTimeout(() => port.close(), 150); }
  });
}

// what bedrock-protocol holds: the same shape as RakCore, the work done in the worker
class RakClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 19132;
    this.connected = false;
    this.onConnected = () => {};
    this.onCloseConnection = () => {};
    this.onEncapsulated = () => {};
    if (process.env.LAB_RAK_WORKER === '0') {   // in this thread
      const c = this.core = new RakCore({ host: this.host, port: this.port });
      c.onConnected = () => { this.connected = true; this.emit('_connected'); this.onConnected(); };
      c.onCloseConnection = (r) => { this.emit('closed', r); this.connected = false; this.onCloseConnection(r); };
      c.onEncapsulated = (b, a) => this.onEncapsulated(b, a);
      c.on('pong', (s) => this.emit('pong', s));
      c.on('error', (e) => this.emit('error', e));
      return;
    }
    this.w = new WT.Worker(__filename, { workerData: { labRak: { host: this.host, port: this.port } } });
    this.w.on('message', (m) => {
      if (m.t === 'enc') this.onEncapsulated(Buffer.from(m.b), `${this.host}:${this.port}`);
      else if (m.t === 'connected') { this.connected = true; this.emit('_connected'); this.onConnected(); }
      else if (m.t === 'close') { this.emit('closed', m.r); if (this.connected) { this.connected = false; this.onCloseConnection(m.r); } }
      else if (m.t === 'pong') this.emit('pong', m.s);
      else if (m.t === 'error') this.emit('error', new Error(m.m));
      else if (m.t === 'dbg') this.emit('dbg', m.m);
    });
    this.w.on('error', (e) => this.emit('error', e));
  }

  connect(timeoutMs = 10000) {
    if (this.core) return this.core.connect(timeoutMs).then(() => this);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('RakNet の接続がタイムアウトしました')), timeoutMs);
      this.once('_connected', () => { clearTimeout(timer); resolve(this); });
      this.w.postMessage({ t: 'connect', ms: timeoutMs });
    });
  }

  ping() { if (this.core) this.core.ping(); else this.w.postMessage({ t: 'ping' }); }

  sendReliable(buffer) {
    if (this.core) return this.core.sendReliable(buffer);
    const ab = new ArrayBuffer(buffer.length);
    new Uint8Array(ab).set(buffer);
    this.w.postMessage({ t: 'send', b: ab }, [ab]);
  }

  close() {
    if (this.core) return this.core.close();
    if (this._closing) return;
    this._closing = true;
    this.connected = false;
    this.w.postMessage({ t: 'close' });
    setTimeout(() => this.w.terminate().catch(() => {}), 1000).unref?.();
  }
}

module.exports = { RakClient, RakCore, ID, MAGIC };
