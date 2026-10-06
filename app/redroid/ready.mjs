// app redroid debug and its app run at once: debug starts app run first and gets the device ready meanwhile (restore → boot →
// the game at its title); app run gets its BDS up and then waits for the device's word in a file (APP_DEVICE_READY_FILE:
// {serial, ok, why}, written whole by debug). Only read by game.mjs (debug) and app.mjs (runCmd)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** a ready file's text → {ok, serial, why} | null while there is none or only part of it (pure) */
export function parseReady(text) {
  if (!text) return null;
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object' || typeof j.ok !== 'boolean') return null;
  return { ok: j.ok, serial: typeof j.serial === 'string' ? j.serial : '', why: typeof j.why === 'string' ? j.why : '' };
}
export function readReady(file) {
  try { return parseReady(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
/** written whole and renamed into place: app run never reads half of it */
export function writeReady(file, { serial = '', ok, why = '' }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(t, JSON.stringify({ serial, ok: Boolean(ok), why, at: Date.now() }) + '\n');
  fs.renameSync(t, file);
}
/** waits for the ready file → {ok, serial, why, ms}. Not ok when the time is up or the one who writes it is gone
 *  (debug stopped from outside: app run must not wait for nothing with its BDS up) */
export async function waitReady(file, { timeoutMs = 20 * 60_000, every = 250, gone = () => false } = {}) {
  const t0 = Date.now();
  for (;;) {
    const r = readReady(file);
    if (r) return { ...r, ms: Date.now() - t0 };
    if (gone()) return { ok: false, serial: '', why: '端末を用意していたコマンド（app redroid debug）が終わっています', ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { ok: false, serial: '', why: `端末の準備が ${Math.round(timeoutMs / 1000)} 秒で終わりません（APP_DEVICE_READY_MS）`, ms: Date.now() - t0 };
    await sleep(every);
  }
}

/** the version written beside the APKs pulled last time (apk/.version) (pure) */
export const versionOf = (text) => String(text ?? '').trim();
/** the APKs pulled last time and their version → {files, version} | null (none, or no version kept with them): what app run
 *  starts with before the device is up — checked against the device once it is */
export function lastApks(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.apk')), version = versionOf(fs.readFileSync(path.join(dir, '.version'), 'utf8'));
    return files.length && version ? { files, version } : null;
  } catch { return null; }
}

/** a child with the terminal's output, waited for without blocking this process: {child, done: Promise<{status, signal}>}
 *  (timeoutMs: SIGTERM then, as spawnSync's timeout did) */
export function startChild(bin, args, { env, timeoutMs = 0 } = {}) {
  const child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'], env });
  const timer = timeoutMs ? setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* gone */ } }, timeoutMs) : null;
  const done = new Promise((res) => {
    child.on('error', () => { if (timer) clearTimeout(timer); res({ status: 1, signal: null }); });
    child.on('exit', (status, signal) => { if (timer) clearTimeout(timer); res({ status, signal }); });
  });
  return { child, done };
}
