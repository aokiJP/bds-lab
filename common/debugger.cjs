'use strict';
// Client for the BDS script debugger (the protocol Mojang's minecraft-debugger speaks): 8 hex digits + '\n' length,
// then one JSON line. BDS connects out to us (script-debugger-auto-attach=connect) at level load, so breakpoints and
// break-on-exception are in place before the addon's first line runs.
const net = require('node:net');
const { EventEmitter } = require('node:events');

class Debugger extends EventEmitter {
  constructor() { super(); this.sock = null; this.seq = 1; this.pending = new Map(); this.version = 0; this.plugins = []; }
  // start listening; resolves with the port. `attached` fires once BDS connected and the protocol was agreed
  listen(port = 0, host = '127.0.0.1') {
    return new Promise((res, rej) => {
      this.server = net.createServer((s) => this.onSocket(s));
      this.server.once('error', rej);
      this.server.listen(port, host, () => res(this.server.address().port));
    });
  }
  onSocket(s) {
    if (this.sock) { s.destroy(); return; }
    this.sock = s;
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 9) {
        const n = parseInt(buf.toString('utf8', 0, 9), 16);
        if (buf.length < 9 + n) break;
        const body = buf.toString('utf8', 9, 9 + n);
        buf = buf.subarray(9 + n);
        let m; try { m = JSON.parse(body); } catch { continue; }
        this.onMessage(m);
      }
    });
    s.on('close', () => { this.sock = null; this.emit('detached'); for (const p of this.pending.values()) p.rej(new Error('debugger detached')); this.pending.clear(); });
    s.on('error', () => {});
  }
  send(o) {
    if (!this.sock) return;
    const j = Buffer.from(JSON.stringify(o));
    const len = ('00000000' + (j.length + 1).toString(16)).slice(-8) + '\n';
    this.sock.write(Buffer.concat([Buffer.from(len), j, Buffer.from('\n')]));
  }
  request(command, args = {}, ms = 5000) {
    const request_seq = this.seq++;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(request_seq); rej(new Error(`debugger ${command} timed out`)); }, ms);
      this.pending.set(request_seq, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.send({ type: 'request', request: { request_seq, command, args } });
    });
  }
  onMessage(m) {
    if (m.type === 'response') {
      const p = this.pending.get(m.request_seq);
      if (!p) return;
      this.pending.delete(m.request_seq);
      if (m.error) p.rej(new Error(m.error)); else p.res(m.body);
      return;
    }
    if (m.type !== 'event') return;
    const e = m.event;
    switch (e.type) {
      case 'ProtocolEvent':
        this.version = e.version; this.plugins = e.plugins ?? [];
        this.emit('protocol', e);
        break;
      case 'StoppedEvent': this.emit('stopped', e); break;
      case 'PrintEvent': this.emit('print', e); break;
      case 'NotificationEvent': this.emit('notification', e); break;
      case 'StatEvent2': this.emit('stat', e); break;
      default: this.emit('other', e);
    }
  }
  // answer the handshake: debug the given script module (uuid) with our protocol version
  attach(targetUuid) { this.send({ type: 'protocol', version: this.version, target_module_uuid: targetUuid }); }
  resume() { this.send({ type: 'resume' }); }
  stopOnException(on) { this.send({ type: 'stopOnException', stopOnException: !!on }); }
  setBreakpoints(file, lines) { return this.request('setBreakpoints', { path: file, breakpoints: lines }); }
  close() { try { this.sock?.destroy(); } catch { /* gone */ } try { this.server?.close(); } catch { /* gone */ } }
}
module.exports = { Debugger };
