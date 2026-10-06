#!/usr/bin/env node
// a fake Chromium for tests/app-offline.mjs: --user-data-dir gets DevToolsActivePort, a DevTools WebSocket on 127.0.0.1
// answers Storage.getCookies (the oauth_token appears on the FAKE_LOGIN_AFTER-th call) and Browser.close (exits).
// FAKE_BROWSER_QUIT=1: the person closes the window before signing in.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
const dir = process.argv.find((a) => a.startsWith('--user-data-dir='))?.slice(16);
fs.writeFileSync(path.join(dir, 'Cookies'), 'session');   // (the profile must be deleted afterwards)
if (process.env.FAKE_BROWSER_ARGS) fs.writeFileSync(process.env.FAKE_BROWSER_ARGS, JSON.stringify(process.argv.slice(2)));
let calls = 0;
const frame = (s) => { const b = Buffer.from(s); const h = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); return Buffer.concat([h, b]); };
const srv = http.createServer();
srv.on('upgrade', (req, sock) => {
  const key = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 6) {
      let len = buf[1] & 127, off = 2;
      if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len)).map((b, i) => b ^ mask[i % 4]);
      const op = buf[0] & 15; buf = buf.subarray(off + 4 + len);
      if (op === 8) { sock.end(); return; }
      const m = JSON.parse(Buffer.from(data).toString());
      if (m.method === 'Storage.getCookies') {
        calls++;
        const cookies = [{ name: 'SID', domain: '.google.com', value: 'x' }];
        if (calls >= Number(process.env.FAKE_LOGIN_AFTER || 2)) cookies.push({ name: 'oauth_token', domain: 'accounts.google.com', value: 'oauth2_4/fake-login-token' });
        sock.write(frame(JSON.stringify({ id: m.id, result: { cookies } })));
      } else if (m.method === 'Browser.close') { sock.write(frame(JSON.stringify({ id: m.id, result: {} }))); setTimeout(() => process.exit(0), 50); }
    }
  });
});
srv.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), `${srv.address().port}\n/devtools/browser/fake\n`);
  if (process.env.FAKE_BROWSER_QUIT) setTimeout(() => process.exit(0), 300);
});
