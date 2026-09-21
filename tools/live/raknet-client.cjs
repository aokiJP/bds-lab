'use strict';
// 最小の RakNet クライアント（protocol 11）。
// BDS 1.26 は RakNet protocol 11 を要求するため、既存の JS 実装（jsp-raknet: protocol 10）では
// つながらない。bedrock-protocol の RakClient と同じ形にしてあるので、そのまま差し込んで使える。
const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');

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

class RakClient extends EventEmitter {
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
    this.sent = new Map();           // 送った datagram（NAK で送り直す）
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg) => this._onMessage(msg));
    this.socket.on('error', (e) => this.emit('error', e));
    this._closed = false;
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
      this._tick = setInterval(() => this._flushAcks(), 10);
    });
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
      const buf = this.sent.get(seq);
      if (buf) { writeUInt24LE(buf, this.sendSeq++, 1); this._send(buf); }
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
    this.sent.set(this.sendSeq - 1, datagram);
    if (this.sent.size > 512) this.sent.delete(this.sent.keys().next().value);
    this._send(datagram);
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    clearInterval(this._retry);
    clearInterval(this._tick);
    try { this.socket.close(); } catch {}
    this.connected = false;
  }
}

module.exports = { RakClient, ID, MAGIC };
