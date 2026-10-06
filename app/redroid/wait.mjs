// redroid.mjs's waiting and cleaning up, kept apart: the boot waited for with one adb wait-for-device and one loop on the
// device (not an adb connect + getprop started again every 250 ms), the screen profile, and the old container / run folder
// removed in the background so the next start does not wait for them.
import { spawn } from 'node:child_process';

/** REDROID_PROFILE → the screen and frame rate it stands for (REDROID_SIZE / REDROID_FPS still win). fast = a third fewer
 *  pixels each way, the same shape (the game's taps are screen fractions), half the frames: less drawing for SwiftShader on
 *  the host's CPU while the game starts (what it saves: 要実測) (pure) */
export const PROFILES = { fast: { size: '1040x480@187', fps: '10' } };
export function profile(env = process.env) { return PROFILES[env.REDROID_PROFILE] ?? {}; }

/** the device's own loop until sys.boot_completed is 1: one adb shell for the whole boot. Prints "booted"; exits 1 after
 *  limitS seconds (pure) */
export function bootLoop(limitS) {
  const n = Math.max(1, Math.ceil(limitS * 5));
  return `i=0; while [ "$(getprop sys.boot_completed)" != 1 ]; do i=$((i+1)); [ $i -ge ${n} ] && exit 1; sleep 0.2; done; echo booted`;
}
/** the device's own loop until the package manager and the launcher answer (an app can be started): one adb shell. Prints
 *  "ready"; exits 1 after limitS seconds (pure) */
export function readyLoop(limitS) {
  const n = Math.max(1, Math.ceil(limitS * 2));
  return `i=0; until pm path android 2>/dev/null | grep -q package: && dumpsys window displays | grep mCurrentFocus= | grep -qE '(Launcher|launcher|Quickstep)'; do i=$((i+1)); [ $i -ge ${n} ] && exit 1; sleep 0.5; done; echo ready`;
}

/** marks in seconds from the start → the ms each stage took on its own: run (docker run), adb (the device answers adb),
 *  boot (boot completed), ready (the launcher) — only the stages reached (pure) */
export function stages(ms) {
  const out = {}, order = ['run', 'adb', 'boot', 'ready'];
  let prev = 0;
  for (const k of order) { if (ms[k] == null) break; out[k] = Math.round(ms[k] - prev); prev = ms[k]; }
  return out;
}

/** a name for a container on its way out: still under the lab's prefix, never the next one's name (pure) */
export function asideName(name, t = Date.now(), pid = process.pid) { return `${name}-old-${pid}-${t}`; }

/** runs a shell line detached and forgets it (the old container's rm, the old run folder's umount + rm): nothing waits
 *  on it, and it outlives this process */
export function later(line) {
  try { const c = spawn('sh', ['-c', line], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); return true; } catch { return false; }
}
/** a word for sh (pure) */
export const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** adb wait-for-device's limit after a connect that said "connected": docker-proxy takes 127.0.0.1:<port> before adbd does,
 *  so "connected" can leave a transport that is offline or gone, and wait-for-device then hangs. Short, then connect again */
export const ADB_WAIT_MS = 3000;
/** one device-side loop (bootLoop / readyLoop) at most this long: spawnSync blocks the event loop, so SIGTERM's clean-up
 *  only runs between slices. up() runs slices until its own time is out */
export const SLICE_MS = 20_000;
/** the next slice: at most sliceMs, never more than the time left (pure) */
export const slice = (leftMs, sliceMs = SLICE_MS) => Math.max(0, Math.min(sliceMs, leftMs));
/** gives timers and signal handlers (SIGTERM) their turn between blocking steps */
export const breath = () => new Promise((r) => setImmediate(r));

/** a shell line removing every `<work>.old-*` (run folders an earlier background rm failed on or never finished) (pure) */
export function oldRunsLine(work, sudo = false) {
  return `${sudo ? 'sudo -n ' : ''}rm -rf --one-file-system ${q(work)}.old-* >/dev/null 2>&1`;
}
/** a shell line removing every container named `<name>-old-…` (asideName's, left by an rm that failed or was stopped) (pure) */
export function oldContainersLine(name) {
  const re = `name=^/?${String(name).replace(/[.^$*+?()[\]{}|\\]/g, '\\$&')}-old-`;
  return `docker ps -aq --filter ${q(re)} | xargs -r docker rm -f >/dev/null 2>&1`;
}
/** the overlay a device started from a prepared folder ran on (its label bdslab.from) → the path to umount, or null (pure) */
export function overlayOf(from) {
  const f = String(from ?? '').trim();
  return f && f !== '<no value>' ? `${f}.run/merged` : null;
}
