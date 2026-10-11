// The fake adb's calls answered in the test's own process (tests/fake/app/adb sends them here when FAKE_ADB_PORT is set): a
// thread of its own — the test waits in spawnSync while the lab it started calls adb — runs adb.mjs's main once per call, one
// call at a time (as the state file's lock had them), with a stand-in process of the call's own: its arguments, folder and
// environment; exit ends the call. A node process per call cost some 50 ms of CPU each, most of app-offline's time.
//   const { fakeAdbServer } = await import('./fake/app/adb-server.mjs'); await fakeAdbServer();   (sets FAKE_ADB_PORT: the
//   commands the test starts with its environment call it; a call that reads its standard input or runs on still gets adb.mjs
//   in a process of its own, the client says which)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ADB = path.join(HERE, 'adb');

/** starts the server thread (once per process); → its port, also in process.env.FAKE_ADB_PORT */
export function fakeAdbServer() {
  if (process.env.FAKE_ADB_PORT && fakeAdbServer.port) return Promise.resolve(fakeAdbServer.port);
  return new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url));
    w.once('message', (port) => { fakeAdbServer.port = port; process.env.FAKE_ADB_PORT = String(port); w.unref(); res(port); });
    w.once('error', rej);
  });
}

/** a request (the client's NUL-ended fields: folder, argument count, arguments, NAME=value..., an empty one) → { cwd, args, env },
 *  or null while it is not all here (pure) */
export function parseRequest(buf) {
  const f = [];
  let at = 0;
  for (;;) {
    const z = buf.indexOf(0, at);
    if (z < 0) return null;
    f.push(buf.subarray(at, z).toString('utf8')); at = z + 1;
    if (f.length >= 2) {
      const n = Number(f[1]);
      if (f.length > n + 2 && f[f.length - 1] === '') break;
    }
  }
  const n = Number(f[1]), env = {};
  for (const kv of f.slice(n + 2, -1)) { const i = kv.indexOf('='); if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1); }
  return { cwd: f[0], args: f.slice(2, n + 2), env };
}

/** bytes → what printf %b prints as those bytes: printable ASCII as it is, the rest (and \) as \0ooo (pure) */
export function percentB(buf) {
  let s = '';
  for (const b of buf) s += b > 0x20 && b < 0x7f && b !== 0x5c ? String.fromCharCode(b) : `\\0${b.toString(8).padStart(3, '0')}`;
  return s;
}

/** the answer: code, stderr, "=" stdout (or "raw" and stdout after) (pure) */
export function answer(code, out, err) {
  const head = `${code}\n${percentB(err)}\n`;
  return out.length > 2048 ? Buffer.concat([Buffer.from(`${head}raw\n`), out]) : Buffer.from(`${head}=${percentB(out)}\n`);
}

class Exit { constructor(code) { this.code = code; } }

if (!isMainThread) {
  const { main } = await import('./adb.mjs');
  // (nothing here may read the test's standard input: a call that would goes to adb.mjs in a process of its own — the client
  // knows which. One it does not know fails here with the reason rather than wait on the test's input)
  const rfs = fs.readFileSync;
  fs.readFileSync = (f, ...r) => { if (f === 0 || f === '/dev/stdin') throw new Error('the fake adb server cannot read standard input: tests/fake/app/adb must send this call to adb.mjs'); return rfs(f, ...r); };
  let n = 0, queue = Promise.resolve();
  const run = async ({ cwd, args, env }) => {
    const out = [], err = [], onExit = [];
    let code = null;
    const proc = {
      argv: [process.execPath, ADB, ...args], env, pid: 4_000_000 + ++n, execPath: process.execPath, platform: process.platform, arch: process.arch,
      exit: (c = 0) => { if (code === null) code = Number(c) || 0; throw new Exit(code); },
      stdout: { write: (d) => { if (code === null) out.push(Buffer.from(d)); return true; } },
      stderr: { write: (d) => { if (code === null) err.push(Buffer.from(d)); return true; } },
      on: (ev, fn) => { if (ev === 'exit') onExit.push(fn); return proc; },
      cwd: () => cwd,
    };
    try { await main(proc); } catch (e) { if (!(e instanceof Exit) && code === null) { err.push(Buffer.from(`${e?.stack ?? e}\n`)); code = 1; } }
    if (code === null) code = 0;
    for (const f of onExit) try { f(code); } catch { /* as a process's exit handler: nothing after it */ }
    return answer(code, Buffer.concat(out), Buffer.concat(err));
  };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0), taken = false;
    sock.on('data', (d) => {
      if (taken) return;
      buf = Buffer.concat([buf, d]);
      const req = parseRequest(buf);
      if (!req) return;
      taken = true;
      queue = queue.then(() => run(req)).then((a) => { sock.end(a); }, (e) => { sock.end(answer(1, Buffer.alloc(0), Buffer.from(`fake adb server: ${e?.stack ?? e}\n`))); });
    });
    sock.on('error', () => { /* the caller went away (its timeout): the call still ran, as a killed process's might have */ });
  });
  server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
}
