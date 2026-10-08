// The Android side: SDK tools, one emulator (AVD "bdslab_app"), adb.
// Host x86_64 → an x86_64 Google APIs image (Android 11+ images translate ARM code, so the arm64 APK from Play runs);
// host arm64 (Apple Silicon, arm Linux) → the arm64 image, native. APP_SYSIMG overrides.
// Google APIs images (not "playstore") allow `adb root`: the app's internal files (its content logs) can be pulled.
// Every tool path can be replaced (APP_ADB, APP_EMULATOR, APP_SDKMANAGER, APP_AVDMANAGER): the offline test uses fakes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppError, PACKAGE, cleanEnv } from './apk.mjs';
import { PAD_SET, padBatchMs } from './play.mjs';

export const AVD = process.env.APP_AVD || 'bdslab_app';
export const SERIAL = process.env.APP_SERIAL || 'emulator-5554';
// APP_TIME_SCALE (0..1, tests on the fake device): every fixed pause shorter; deadlines stay in real time
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * (Math.min(1, Math.max(0, Number(process.env.APP_TIME_SCALE) || 1)))));
const WIN = process.platform === 'win32';

export function sdkRoot(env = process.env) {
  const c = [env.ANDROID_SDK_ROOT, env.ANDROID_HOME, path.join(os.homedir(), 'Android', 'Sdk'), path.join(os.homedir(), 'Library', 'Android', 'sdk'), WIN && env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Android', 'Sdk')];
  return c.find((d) => d && fs.existsSync(d)) ?? null;
}
const exe = (p) => (WIN ? (fs.existsSync(p + '.exe') ? p + '.exe' : p + '.bat') : p);
export function tools(env = process.env) {
  const sdk = sdkRoot(env);
  const pick = (over, ...rel) => over || (sdk ? rel.map((r) => exe(path.join(sdk, ...r))).find((p) => fs.existsSync(p)) ?? null : null);
  return {
    sdk,
    adb: pick(env.APP_ADB, ['platform-tools', 'adb']),
    emulator: pick(env.APP_EMULATOR, ['emulator', 'emulator']),
    sdkmanager: pick(env.APP_SDKMANAGER, ['cmdline-tools', 'latest', 'bin', 'sdkmanager'], ['tools', 'bin', 'sdkmanager']),
    avdmanager: pick(env.APP_AVDMANAGER, ['cmdline-tools', 'latest', 'bin', 'avdmanager'], ['tools', 'bin', 'avdmanager']),
  };
}
export const sysImage = (env = process.env) => env.APP_SYSIMG || `system-images;android-34;google_apis;${process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'}`;
export const kvmOk = () => process.platform !== 'linux' || (() => { try { fs.accessSync('/dev/kvm', fs.constants.R_OK | fs.constants.W_OK); return true; } catch { return false; } })();

export class Adb {
  constructor({ bin, serial = SERIAL, log = () => {} }) { this.bin = bin; this.serial = serial; this.log = log; }
  /** @returns {{status:number, stdout:string, stderr:string, buf?:Buffer}} */
  run(args, { timeout = 60_000, binary = false, input } = {}) {
    // (SIGKILL at the deadline: adb outlives a SIGTERM while the device's command goes on — `nc` that never ends, an `echo`
    // into a FIFO nobody reads — and spawnSync then waits for it: a live session once hung there for good)
    const r = spawnSync(this.bin, ['-s', this.serial, ...args], { encoding: binary ? 'buffer' : 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 512e6, input, env: cleanEnv() });
    // (stopped by a signal — Ctrl+C reaches adb too — is a failure: its empty output is no answer)
    const o = { status: r.status ?? (r.error || r.signal ? 1 : 0), stdout: binary ? '' : (r.stdout ?? ''), stderr: String(r.stderr ?? ''), buf: binary ? r.stdout : undefined, error: r.error };
    if (o.status !== 0) this.log(`adb ${args.slice(0, 4).join(' ')} → ${o.status} ${(o.stderr || o.stdout).trim().slice(0, 200)}`);
    return o;
  }
  // `adb shell a b c` joins its words into one line for the device's sh: quote each word
  shell(words, opts) { return this.run(['shell', ...words.map((w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${String(w).replace(/'/g, `'\\''`)}'`))], opts); }
  /** a touch on the game. 'tap': input tap (down and up at once); 'hold': pressed for APP_TAP_MS (250) — a game drawing a few
   *  frames a second may read down and up in one frame as no press at all; 'motion': motionevent DOWN, a pause, UP.
   *  tapHow: the way that worked on this device (app prepare finds it on the game's first screen; the stamp keeps it) */
  tap(x, y, how = this.tapHow ?? process.env.APP_TAP ?? 'tap') {
    const [X, Y] = [String(Math.round(x)), String(Math.round(y))];
    if (how === 'hold') return this.shell(['input', 'swipe', X, Y, X, Y, String(Number(process.env.APP_TAP_MS) || 250)]);
    if (how === 'motion') return this.run(['shell', `input motionevent DOWN ${X} ${Y}; sleep 0.3; input motionevent UP ${X} ${Y}`]);
    if (how === 'panel') {
      // the emulator's own touchscreen (root, sendevent): a touch from a real input device, as a finger makes it — not the
      // shell's injected one. Its device and ranges, and the display's turn, read once
      this._panel ??= { ts: touchscreenOf(this.run(['shell', 'getevent -pl 2>/dev/null'], { timeout: 20_000 }).stdout) };
      const vp = viewportOf(this.run(['shell', 'dumpsys input'], { timeout: 30_000 }).stdout);
      if (!this._panel.ts || !vp) return this.shell(['input', 'tap', X, Y]);
      return this.run(['shell', panelTapScript(this._panel.ts.dev, panelPoint(Number(X), Number(Y), vp, this._panel.ts))]);
    }
    return this.shell(['input', 'tap', X, Y]);
  }
  /** controller presses ("A", "DOWN A", "wait500"…), as the CI device showed they are taken at 4 frames a second: a
   *  direction as a key event (queued: never missed — the controller's D-pad is a state the game samples once a frame, and
   *  its short presses were lost), a button through the device's controller, held (startPad; APP_PAD_HOLD_MS) — the
   *  shell's injected button is a state too, and too short. Without the controller every press is the shell's.
   *  The controller's other words (sticks, triggers, a button held: LY=-100 +A -A center — lab-pad.c) go to it alone.
   *  { wait: true }: back only when the controller has done them all (a walk of 2 s, then the screen it ends on) */
  pad(keys, { wait = false } = {}) {
    const words = String(keys).trim().split(/\s+/).filter(Boolean), dir = (w) => /^(UP|DOWN|LEFT|RIGHT)$/.test(w) && process.env.APP_PAD_DPAD !== 'hat';
    const hold = Number(process.env.APP_PAD_HOLD_MS) || 500;
    let batch = [];
    const flush = (next) => {
      if (!batch.length) return;
      const all = [...(process.env.APP_PAD_HOLD_MS ? [`hold${hold}`] : []), ...batch];
      this.run(['shell', `echo '${all.join(' ')}' > ${PAD_FIFO}`], { timeout: 30_000 });
      // (the controller presses them in its own time: a key event after them waits for them)
      if (next || wait) spawnSync('sleep', [String(padBatchMs(all, hold) / 1000)]);
      batch = [];
    };
    for (const w of words) {
      if (this.padReady && !dir(w) && (/^wait\d+$/.test(w) ? batch.length : /^\w+$/.test(w) || PAD_SET.test(w))) { batch.push(w); continue; }
      flush(true);
      if (/^wait\d+$/.test(w)) { spawnSync('sleep', [String(Number(w.slice(4)) / 1000)]); continue; }
      // (padLong — a real device without the controller: a button as the shell's long press, down … up ~0.5 s later, as the
      // controller holds it; a direction stays one quick key event)
      if (PAD_KEYCODE[w]) this.shell(['input', 'gamepad', 'keyevent', ...(this.padLong && !dir(w) ? ['--longpress'] : []), `KEYCODE_${PAD_KEYCODE[w]}`]);
    }
    flush(false);
    return { status: 0, stdout: '', stderr: '' };
  }
  prop(name) { return this.shell(['getprop', name]).stdout.trim(); }
  booted() { return this.run(['get-state'], { timeout: 5000 }).stdout.trim() === 'device' && this.prop('sys.boot_completed') === '1'; }
  // shotVia 'emu': every picture from the emulator's own view of its display (APP_SHOT=emu, or set once a black screencap
  // was seen beside an emulator picture that shows the game: the device's screencap may leave the game's GL surface out)
  screencap() {
    if (this.shotVia === 'emu' || process.env.APP_SHOT === 'emu') { const e = this.emuScreencap(); if (e) return e; }
    const r = this.run(['exec-out', 'screencap', '-p'], { binary: true, timeout: 30_000 });
    if (r.status !== 0 || !r.buf || r.buf.length < 8 || r.buf[0] !== 0x89) throw new AppError('スクリーンショットが撮れません（screencap）', (r.stderr || '').trim());
    return r.buf;
  }
  /** the emulator's own picture of its display (its console: screenrecord screenshot), from the host side: what the
   *  device really shows even when the device's screencap comes out black. A PNG buffer, or null */
  emuScreencap(dir = os.tmpdir()) {
    const d = fs.mkdtempSync(path.join(dir, 'lab-emushot-'));
    try {
      const r = this.run(['emu', 'screenrecord', 'screenshot', d], { timeout: 30_000 });
      const f = fs.readdirSync(d).find((x) => /\.png$/i.test(x));
      return r.status === 0 && f ? fs.readFileSync(path.join(d, f)) : null;
    } catch { return null; } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
  pid(pkg = PACKAGE) { const t = this.shell(['pidof', pkg]).stdout.trim(); return t ? Number(t.split(/\s+/)[0]) : 0; }
  /** the window with the input focus: {window, dialog} (focusOf). A device too busy to answer gives {window: null} */
  focus() { return focusOf(this.run(['shell', FOCUS_SH], { timeout: 20_000 }).stdout); }
  installed(pkg = PACKAGE) {
    const t = this.shell(['dumpsys', 'package', pkg], { timeout: 30_000 }).stdout;
    const name = /versionName=(\S+)/.exec(t)?.[1], code = /versionCode=(\d+)/.exec(t)?.[1];
    return name ? { versionName: name, versionCode: Number(code) } : null;
  }
  install(apks) {
    // -r replace, -d allow a downgrade, -g grant runtime permissions (no permission dialog over the game),
    // -i com.android.vending: installed as Google Play would (the app's license check looks at who installed it);
    // a device that refuses that installer name gets a plain install
    let r = this.run(['install-multiple', '-r', '-d', '-g', '-i', 'com.android.vending', ...apks], { timeout: 20 * 60_000 });
    if (!/Success/.test(r.stdout + r.stderr) && /INSTALLER|installer/.test(r.stdout + r.stderr)) r = this.run(['install-multiple', '-r', '-d', '-g', ...apks], { timeout: 20 * 60_000 });
    if (r.status !== 0 || !/Success/.test(r.stdout + r.stderr)) throw new AppError('APK を入れられませんでした（adb install-multiple）', (r.stdout + r.stderr).trim().split('\n').slice(-4).join('\n'));
  }
}

// Android's own dialogs: "<process> isn't responding" (ANR) and "<app> keeps stopping" are system windows titled
// "Application Not Responding: <process>" / "Application Error: <process>". In CI they sat over the game for whole runs
// (the device too busy: system, System UI) and, being still, passed for a calm title screen. So the scenario asks which
// window has the focus and answers the dialog: "Wait" for an ANR (never "Close app": for system / System UI that restarts
// Android itself), "Close app" for a crash (the app is gone already).
// ---- the join through a relay on the device ----
// The game asks for a Microsoft sign-in before it joins an external server ("You need to authenticate to Microsoft
// services", Guardian) — but not for one on 127.0.0.1. So the lab runs a small UDP relay on the device (app/relay):
// the game joins 127.0.0.1:<listen>, the relay sends the session on to the lab's BDS on the machine (10.0.2.2:<port>).
// ---- the lab's two small programs for a device (app/relay): built here for the device's CPU, never committed ----
const RELAY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'relay');
export const RELAY_SRC = path.join(RELAY_DIR, 'lab-relay.c');
export const PAD_SRC = path.join(RELAY_DIR, 'lab-pad.c'), PAD_HDR = path.join(RELAY_DIR, 'lab-uinput.h');
export const RELAY_ON_DEVICE = '/data/local/tmp/lab-relay';
const answers = (bin, args) => { try { return spawnSync(bin, args, { encoding: 'utf8', timeout: 30_000 }).status === 0; } catch { return false; } };
const byVersionDesc = (a, b) => { const x = a.split(/\D+/).map(Number), y = b.split(/\D+/).map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0); return 0; };
/** the C compilers that make programs for a device's CPU, in the order they are tried (only those on this machine).
 *  x86_64: cc (on a Linux x86_64 machine). arm64-v8a (phones): the Android NDK's clang (APP_NDK, ANDROID_NDK_HOME /
 *  ANDROID_NDK_ROOT, <sdk>/ndk/<newest>: sdkmanager "ndk;<version>"), zig (APP_ZIG / zig, or python3 -m ziglang: pip install
 *  ziglang), a cross gcc, and — lab-pad only, it needs no C library — clang with ld.lld
 *  → [{ name, cmd: [bin, ...args], libc, flavor: gcc | ndk | zig | clang }] */
export function deviceCompilers(abi, env = process.env, { has = answers } = {}) {
  const out = [];
  if (abi === 'x86_64') {
    const cc = env.CC || 'cc';
    if (process.platform === 'linux' && process.arch === 'x64' && has(cc, ['--version'])) out.push({ name: cc, cmd: [cc], libc: true, flavor: 'gcc' });
    return out;
  }
  if (abi !== 'arm64-v8a') return out;
  const sdk = sdkRoot(env), host = WIN ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  let ndks = [env.APP_NDK, env.ANDROID_NDK_HOME, env.ANDROID_NDK_ROOT];
  try { if (sdk) ndks.push(...fs.readdirSync(path.join(sdk, 'ndk')).sort(byVersionDesc).map((v) => path.join(sdk, 'ndk', v))); } catch { /* no NDK in the SDK */ }
  ndks = ndks.filter(Boolean);
  // (the NDK's own clang with the Android target — not its aarch64-…-clang wrapper: on Windows that is a .cmd, which Node
  // does not start without a shell)
  for (const n of ndks) {
    const c = path.join(n, 'toolchains', 'llvm', 'prebuilt', host, 'bin', `clang${WIN ? '.exe' : ''}`);
    if (fs.existsSync(c)) { out.push({ name: `NDK ${path.basename(n)}`, cmd: [c, '--target=aarch64-linux-android24'], libc: true, flavor: 'ndk' }); break; }
  }
  const zig = env.APP_ZIG || 'zig';
  if (has(zig, ['version'])) out.push({ name: 'zig', cmd: [zig, 'cc', '-target', 'aarch64-linux-musl'], libc: true, flavor: 'zig' });
  else if (has('python3', ['-m', 'ziglang', 'version'])) out.push({ name: 'zig（python3 -m ziglang）', cmd: ['python3', '-m', 'ziglang', 'cc', '-target', 'aarch64-linux-musl'], libc: true, flavor: 'zig' });
  for (const g of ['aarch64-linux-gnu-gcc', 'aarch64-linux-musl-gcc']) if (has(g, ['--version'])) { out.push({ name: g, cmd: [g], libc: true, flavor: 'gcc' }); break; }
  if (has('clang', ['--version']) && has('ld.lld', ['--version'])) out.push({ name: 'clang + ld.lld', cmd: ['clang', '--target=aarch64-linux-gnu', '-fuse-ld=lld'], libc: false, flavor: 'clang' });
  return out;
}
// lab-pad: no C library (a static program of its own system calls); lab-relay: static (the NDK: against the device's own
// C library, which every Android has)
const buildFlags = (kind, flavor) => (kind === 'pad'
  ? ['-static', '-nostdlib', '-ffreestanding', '-fno-builtin', '-fno-stack-protector', '-fno-pie', '-no-pie', '-Os', '-s', ...(flavor === 'gcc' ? ['-fno-tree-loop-distribute-patterns'] : ['-Wno-unused-command-line-argument'])]
  : [...(flavor === 'ndk' ? [] : ['-static']), '-Os', '-s']);
export const abiTag = (abi) => (abi === 'arm64-v8a' ? 'arm64' : abi);
/** lab-relay or lab-pad for a device's CPU, built once on this machine (again when its source changed) → its path, or
 *  { error } saying why not and what would make it */
export function deviceBinary(labDir, kind, { abi = 'x86_64', env = process.env, compilers } = {}) {
  const src = kind === 'pad' ? PAD_SRC : RELAY_SRC, deps = kind === 'pad' ? [PAD_SRC, PAD_HDR] : [RELAY_SRC], what = kind === 'pad' ? 'コントローラー' : '中継';
  const out = path.join(labDir, 'tools', `lab-${kind}-${abiTag(abi)}`);
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= Math.max(...deps.map((f) => fs.statSync(f).mtimeMs))) return out;
  if (!['x86_64', 'arm64-v8a'].includes(abi)) return { error: `${abi} の端末用の${what}は作れません（x86_64 と arm64-v8a だけ）` };
  const list = (compilers ?? deviceCompilers(abi, env)).filter((c) => kind === 'pad' || c.libc);
  if (!list.length) return { error: abi === 'x86_64' ? `このパソコン（Linux x86_64 で cc があるもの以外）では${what}を作れません` : `arm64 の端末用の${what}を作るコンパイラがありません: Android NDK（sdkmanager "ndk;27.2.12479018"）か zig（pip install ziglang）を入れてください${kind === 'pad' ? '（clang と ld.lld でも作れます）' : ''}` };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const errs = [];
  for (const c of list) {
    const r = spawnSync(c.cmd[0], [...c.cmd.slice(1), ...buildFlags(kind, c.flavor), '-o', out, src], { encoding: 'utf8', timeout: 600_000 });
    if (r.status === 0 && fs.existsSync(out)) return out;
    fs.rmSync(out, { force: true });
    errs.push(`${c.name}: ${(r.stderr || r.error?.message || '').trim().split('\n').filter((l) => /error|Error/.test(l)).pop()?.slice(0, 140) || r.status}`);
  }
  return { error: `${what}（${abi}）を作れません（${errs.join(' / ')}）` };
}
/** the relay for a device's CPU (x86_64 by default) → its path, or { error } */
export const relayBinary = (labDir, { cc, abi = 'x86_64' } = {}) => deviceBinary(labDir, 'relay', { abi, env: cc ? { ...process.env, CC: cc } : process.env });
/** a start command on the device as root: adbd itself (the emulator) or su (a rooted phone: Magisk and the like). umask 0:
 *  what it makes (the controller's FIFO) stays writable for adb's shell, which sends it the presses */
export const asRoot = (adb, cmd) => {
  if (!adb.su) return cmd;
  const q = `'${`umask 000; ${cmd}`.replace(/'/g, `'\\''`)}'`;
  // (the form the device's su answered when it was looked at: `su -c`, or AOSP's own `su 0 sh -c`)
  return adb.su === '0' ? `su 0 sh -c ${q}` : `su -c ${q}`;
};
/** the relays started on the device: 127.0.0.1:listen → host:port, each [listen, port] of `also`, and each port of `reflect`
 *  (a broadcast port the game holds itself — NetherNet's LAN discovery, 7551: its broadcasts sent on to host:port as the
 *  game's own packets) — the old ones stopped first. abi: the device's CPU (adb.abi, else x86_64) → { ok, note } */
export function startRelay(adb, { labDir, listen = 19132, host = '10.0.2.2', port, also = [], reflect = [], abi = adb.abi ?? 'x86_64' }) {
  const bin = process.env.APP_RELAY_BIN || relayBinary(labDir, { abi });
  if (typeof bin !== 'string') return { ok: false, note: bin.error };
  const p = adb.run(['push', bin, RELAY_ON_DEVICE], { timeout: 60_000 });
  if (p.status !== 0) return { ok: false, note: `中継を端末へ送れません: ${(p.stderr || p.stdout).trim().slice(0, 160)}` };
  // (pkill -x: by its name — `pkill -f lab-relay` matched this very shell line and killed it before the relay started.
  // setsid + nohup + no stdin: it lives on after adb's shell ends. The first one logs to lab-relay.log, the others beside it)
  // (listen null: no relay for the game's session — a reflector alone, for a device on the same network as the BDS)
  const all = listen ? [[listen, port], ...also] : also;
  const starts = [...all.map(([l, pt], i) => `setsid nohup ${RELAY_ON_DEVICE} ${l} ${host} ${pt} > /data/local/tmp/lab-relay${i ? `-${l}` : ''}.log 2>&1 < /dev/null &`),
    ...reflect.map((pt) => `setsid nohup ${RELAY_ON_DEVICE} --reflect ${pt} ${host} ${pt} > /data/local/tmp/lab-relay-reflect-${pt}.log 2>&1 < /dev/null &`)].join(' ');
  adb.run(['shell', asRoot(adb, `chmod 755 ${RELAY_ON_DEVICE}; pkill -x lab-relay 2>/dev/null; ${starts} sleep 1`)], { timeout: 20_000 });
  const pids = adb.run(['shell', 'pidof lab-relay || true'], { timeout: 15_000 }).stdout.trim().split(/\s+/).filter(Boolean);
  const what = [...all.map(([l, pt]) => `127.0.0.1:${l} → ${host}:${pt}`), ...reflect.map((pt) => `放送 :${pt} → ${host}:${pt}`)].join('、');
  return pids.length ? { ok: true, note: `端末の中継 ${what}（pid ${pids.join(' ')}）` } : { ok: false, note: `中継が動きません: ${adb.run(['shell', 'cat /data/local/tmp/lab-relay.log'], { timeout: 15_000 }).stdout.trim().slice(0, 160)}` };
}

// ---- a game controller on the device (app/relay/lab-pad.c: the kernel's uinput) ----
// 1.26's new screens (Ore UI) take a controller where they ignore taps on the emulator; the shell's injected key events
// (`input gamepad`, device -1) reach them unevenly — on CI they did not leave a screen a real controller's B left at once
export const PAD_ON_DEVICE = '/data/local/tmp/lab-pad', PAD_FIFO = '/data/local/tmp/lab-pad.fifo';
/** the controller for a device's CPU (x86_64 by default; no C library: a few kilobytes) → its path, or { error } */
export const padBinary = (labDir, { cc, abi = 'x86_64' } = {}) => deviceBinary(labDir, 'pad', { abi, env: cc ? { ...process.env, CC: cc } : process.env });
/** the controller plugged into the device (root: /dev/uinput), once: → { ok, note }. adb.pad() uses it from then on */
export function startPad(adb, { labDir, abi = adb.abi ?? 'x86_64' }) {
  if (adb.run(['shell', 'pidof lab-pad || true'], { timeout: 15_000 }).stdout.trim()) { adb.padReady = true; return { ok: true, note: 'コントローラーはつながっています' }; }
  const bin = process.env.APP_PAD_BIN || padBinary(labDir, { abi });
  if (typeof bin !== 'string') return { ok: false, note: bin.error };
  const p = adb.run(['push', bin, PAD_ON_DEVICE], { timeout: 60_000 });
  if (p.status !== 0) return { ok: false, note: `コントローラーを端末へ送れません: ${(p.stderr || p.stdout).trim().slice(0, 160)}` };
  adb.run(['shell', asRoot(adb, `chmod 755 ${PAD_ON_DEVICE}; setsid nohup ${PAD_ON_DEVICE} ${PAD_FIFO} > /data/local/tmp/lab-pad.log 2>&1 < /dev/null & sleep 1`)], { timeout: 20_000 });
  const pid = adb.run(['shell', 'pidof lab-pad || true'], { timeout: 15_000 }).stdout.trim();
  adb.padReady = Boolean(pid);
  return pid ? { ok: true, note: `コントローラー（Xbox Wireless Controller、uinput）をつなぎました（pid ${pid}）` } : { ok: false, note: `コントローラーが動きません: ${adb.run(['shell', 'cat /data/local/tmp/lab-pad.log'], { timeout: 15_000 }).stdout.trim().slice(0, 160)}` };
}
/** what the lab put on a person's device, gone: its relay and controller stopped (as root when they ran as root: the copy of
 *  the content logs too), then every file the lab may have left removed as the shell (it owns /data/local/tmp: a file a root
 *  process made there goes too) — the programs, their logs and FIFO, the layout dumps, a recording a stopped run left */
export function clearDevice(adb) {
  if (adb.su) adb.run(['shell', asRoot(adb, 'pkill -x lab-relay 2>/dev/null; pkill -x lab-pad 2>/dev/null; rm -rf /data/local/tmp/lab-logs; true')], { timeout: 20_000 });
  else adb.run(['shell', 'pkill -x lab-relay 2>/dev/null; pkill -x lab-pad 2>/dev/null; true'], { timeout: 20_000 });
  return adb.run(['shell', 'rm -rf /data/local/tmp/lab-relay /data/local/tmp/lab-relay*.log /data/local/tmp/lab-pad /data/local/tmp/lab-pad.fifo /data/local/tmp/lab-pad.log /data/local/tmp/lab-ui.xml /data/local/tmp/lab-logs /sdcard/lab-rec-*.mp4 2>/dev/null; true'], { timeout: 20_000 });
}
// the shell's key codes of the same buttons (when there is no controller: input gamepad keyevent)
const PAD_KEYCODE = { A: 'BUTTON_A', B: 'BUTTON_B', X: 'BUTTON_X', Y: 'BUTTON_Y', LB: 'BUTTON_L1', RB: 'BUTTON_R1', LT: 'BUTTON_L2', RT: 'BUTTON_R2', SELECT: 'BUTTON_SELECT', START: 'BUTTON_START', HOME: 'BUTTON_MODE', L3: 'BUTTON_THUMBL', R3: 'BUTTON_THUMBR', UP: 'DPAD_UP', DOWN: 'DPAD_DOWN', LEFT: 'DPAD_LEFT', RIGHT: 'DPAD_RIGHT' };
export const PAD_WORDS = Object.keys(PAD_KEYCODE);
// (the controller's words that set a state, and how long its words take: lib/play.mjs)
export { PAD_SET, padBatchMs };

/** the touchscreen in `getevent -pl` (pure): { dev, maxX, maxY } of the device with ABS_MT_POSITION_X/Y, or null */
export function touchscreenOf(text) {
  // (the emulator has one per possible display, virtio_input_multi_touch_1..10: the first display's is _1)
  const all = [];
  for (const block of String(text ?? '').split(/^add device \d+: /m)) {
    const dev = /^(\/dev\/input\/event\d+)/.exec(block)?.[1], name = /name:\s*"([^"]*)"/.exec(block)?.[1] ?? '';
    const x = /ABS_MT_POSITION_X\s*:[^\n]*?max (\d+)/.exec(block), y = /ABS_MT_POSITION_Y\s*:[^\n]*?max (\d+)/.exec(block);
    if (dev && x && y) all.push({ dev, name, maxX: Number(x[1]), maxY: Number(y[1]) });
  }
  const t = all.find((d) => /_1$/.test(d.name)) ?? all[0];
  return t ? { dev: t.dev, maxX: t.maxX, maxY: t.maxY } : null;
}
/** the display's turn and its panel's own size, from `dumpsys input` (pure): { orientation 0-3, w, h } or null */
export function viewportOf(text) {
  // (display 0's own line; its deviceSize is as shown, turned: the panel's is the other way round when turned 90° / 270°)
  const m = /Viewport INTERNAL: displayId=0,[^\n]*?orientation=(\d)[^\n]*?deviceSize=\[(\d+), (\d+)\]/.exec(String(text ?? ''));
  if (!m) return null;
  const o = Number(m[1]), [a, b] = [Number(m[2]), Number(m[3])];
  return { orientation: o, w: o % 2 ? b : a, h: o % 2 ? a : b };
}
/** a point on the screen as shown (turned) → the panel's own coordinates in the touchscreen's range (pure). Turned 90°:
 *  the panel's (x, y) shows at (y, w - x); 270°: at (h - y, x) */
export function panelPoint(x, y, vp, ts) {
  const { orientation: o, w, h } = vp;
  const [nx, ny] = o === 1 ? [w - y, x] : o === 2 ? [w - x, h - y] : o === 3 ? [y, h - x] : [x, y];
  return [Math.round((nx * (ts.maxX + 1)) / w), Math.round((ny * (ts.maxY + 1)) / h)];
}
/** a finger down and up on that touchscreen (multi-touch protocol B), as one device shell line (pure) */
export function panelTapScript(dev, [x, y], ms = Number(process.env.APP_TAP_MS) || 150) {
  const e = (t, c, v) => `sendevent ${dev} ${t} ${c} ${v}`;
  return [e(3, 47, 0), e(3, 57, 4242), e(3, 53, x), e(3, 54, y), e(3, 58, 50), e(1, 330, 1), e(0, 0, 0), `sleep ${(ms / 1000).toFixed(2)}`, e(3, 57, 4294967295), e(1, 330, 0), e(0, 0, 0)].join('; ');
}
/** the focused window now, as a shell line. Its displays section: since Android 10 the focus is printed per display, not
 *  with the window list — and the whole `dumpsys window` starts with the state saved at the last ANR (kept 2 hours), whose
 *  focus came first: after "Pixel Launcher isn't responding" the launcher read as focused for good, the game in front */
export const FOCUS_SH = 'dumpsys window displays | grep -E mCurrentFocus= || true';
/** the focused window in `dumpsys window displays` text (pure): {window, dialog: {kind: 'anr'|'crash', proc} | null} */
export function focusOf(text) {
  const window = /mCurrentFocus=Window\{\S+ (?:u\d+ )?([^}]*)\}/.exec(String(text ?? ''))?.[1]?.replace(/ EXITING$/, '').trim() || null;
  const anr = window && /^Application Not Responding: (.+)$/.exec(window), crash = window && /^Application Error: (.+)$/.exec(window);
  return { window, dialog: anr ? { kind: 'anr', proc: anr[1].trim() } : crash ? { kind: 'crash', proc: crash[1].trim() } : isPermissionDialog(window) ? { kind: 'permission', proc: '権限の確認' } : null };
}
/** the centre of the node with that resource-id in a uiautomator dump (pure), or null */
export function nodeCenter(xml, id) {
  const tag = new RegExp(`<node [^>]*resource-id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`).exec(String(xml ?? ''))?.[0];
  const b = tag && /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
  return b ? [Math.round((Number(b[1]) + Number(b[3])) / 2), Math.round((Number(b[2]) + Number(b[4])) / 2)] : null;
}
/** answers a dialog from focusOf; returns what it pressed */
export function answerDialog(adb, dialog) {
  if (dialog.kind === 'permission') return answerPermission(adb);
  const anr = dialog.kind === 'anr', id = anr ? 'android:id/aerr_wait' : 'android:id/aerr_close', label = anr ? '「待つ」' : '「アプリを閉じる」';
  const ui = adb.run(['shell', 'uiautomator dump /data/local/tmp/lab-ui.xml >/dev/null 2>&1; cat /data/local/tmp/lab-ui.xml'], { timeout: 30_000 });
  const at = nodeCenter(ui.stdout, id);
  if (at) { adb.shell(['input', 'tap', String(at[0]), String(at[1])]); return `${label}を押しました`; }
  // no layout (uiautomator waits for an idle screen, which a busy device may not have): keys. On a touch screen the first
  // DOWN only brings the focus to the top button ("Close app") and the second moves it to "Wait"; with the focus already
  // there, the second DOWN has nowhere further to go. ENTER presses it. A crash dialog: BACK
  for (const k of anr ? [20, 20, 66] : [4]) adb.shell(['input', 'keyevent', String(k)]);
  return `${label}をキーで押しました（画面の構成が読めないため）`;
}

// Google apps that come with the image and only cost CPU here (once a Google account is on the device they start syncing,
// and with the game's ARM translation on top the system stops answering: "System UI isn't responding"). Play services,
// Services Framework and the Play Store are not touched. APP_KEEP_APPS=1 leaves them all.
export const QUIET_APPS = ['com.google.android.youtube', 'com.google.android.apps.youtube.music', 'com.google.android.gm', 'com.google.android.apps.photos',
  'com.google.android.apps.docs', 'com.google.android.calendar', 'com.google.android.apps.messaging', 'com.google.android.apps.maps',
  'com.google.android.apps.tachyon', 'com.google.android.videos', 'com.google.android.apps.wellbeing', 'com.google.android.apps.subscriptions.red',
  // (what Play would update first once the account is in, or what works in the background on its own: a disabled app is
  // left alone. Not the Google app: the home screen's search bar is it)
  'com.android.chrome', 'com.google.android.apps.turbo', 'com.google.ar.core',
  'com.google.android.projection.gearhead', 'com.google.android.apps.restore', 'com.google.android.apps.safetyhub'];
// never off: the home screen (Pixel Launcher) waits on Android System Intelligence for its predictions — with it disabled
// the launcher stopped answering every few seconds —, and the game asks Speech Services (its narrator) over and over
// without it (23 000 log lines in 20 minutes). A device made while they were on this list gets them back
export const KEEP_APPS = ['com.google.android.as', 'com.google.android.tts'];
export function quietDevice(adb, { env = process.env } = {}) {
  if (env.APP_KEEP_APPS === '1') return [];
  // stop background work that starves the game once a Google account lands: account sync (the big one), app auto-updates,
  // and package verification. Not GMS/Finsky/GSF themselves (the license check needs them).
  // (immersive_mode_confirmations: Android's "Viewing full screen — swipe down from the top" sat over the game's first
  // start, its black screen behind it, for 20 minutes: taken as already seen)
  for (const [ns, k, v] of [['global', 'auto_sync', '0'], ['secure', 'user_setup_complete', '1'], ['global', 'verifier_verify_adb_installs', '0'], ['global', 'package_verifier_enable', '0'], ['secure', 'immersive_mode_confirmations', 'confirmed']]) {
    adb.shell(['settings', 'put', ns, k, v], { timeout: 15_000 });
  }
  adb.shell(['cmd', 'jobscheduler', 'reset-execution-quota', '-u', '0', 'com.android.vending'], { timeout: 15_000 });
  for (const p of KEEP_APPS) adb.shell(['pm', 'enable', '--user', '0', p], { timeout: 30_000 });
  return QUIET_APPS.filter((p) => /disabled/i.test(adb.shell(['pm', 'disable-user', '--user', '0', p], { timeout: 30_000 }).stdout));
}

// Android's own permission question ("Allow Minecraft to send you notifications?"): a game Play installed gets no
// permissions up front (adb install -g does), and on its first start the question sits over the game
export const isPermissionDialog = (window) => /permissioncontroller\/.*GrantPermissionsActivity/.test(String(window ?? ''));
/** answers it: Allow (the layout's button), else ENTER; returns what it pressed */
export function answerPermission(adb) {
  const ui = adb.run(['shell', 'uiautomator dump /data/local/tmp/lab-ui.xml >/dev/null 2>&1; cat /data/local/tmp/lab-ui.xml'], { timeout: 30_000 });
  for (const id of ['com.android.permissioncontroller:id/permission_allow_button', 'com.android.permissioncontroller:id/permission_allow_foreground_only_button', 'com.android.permissioncontroller:id/permission_allow_one_time_button']) {
    const at = nodeCenter(ui.stdout, id);
    if (at) { adb.shell(['input', 'tap', String(at[0]), String(at[1])]); return '「許可」を押しました'; }
  }
  adb.shell(['input', 'keyevent', '66']);
  return '「許可」をキーで押しました（画面の構成が読めないため）';
}
/** grants every runtime permission the app asks for (what adb install -g does), so no question comes up; returns them */
export function grantAll(adb, pkg, requested) {
  return requested.filter((p) => adb.shell(['pm', 'grant', pkg, p], { timeout: 20_000 }).status === 0);
}

/** the game's GL through ANGLE (Android's GLES on Vulkan) instead of the emulator's own EGL, which refuses a context the
 *  game asks for (eglCreateContext: EGL_BAD_ATTRIBUTE, and the game draws nothing). Android's per-app driver choice
 *  (developer settings, kept in the snapshot). Returns where ANGLE is on this device ('' = not found) */
export function useAngle(adb, pkg, on = true) {
  adb.shell(['settings', 'put', 'global', 'angle_gl_driver_selection_pkgs', on ? pkg : '""'], { timeout: 20_000 });
  adb.shell(['settings', 'put', 'global', 'angle_gl_driver_selection_values', on ? 'angle' : '""'], { timeout: 20_000 });
  const pk = adb.shell(['pm', 'list', 'packages'], { timeout: 30_000 }).stdout.split('\n').map((l) => l.replace(/^package:/, '').trim()).filter((p) => /angle/i.test(p));
  const lib = adb.run(['shell', 'ls /system/lib64/libEGL_angle.so /vendor/lib64/egl/libEGL_angle.so 2>/dev/null'], { timeout: 20_000 }).stdout.trim().split('\n').filter(Boolean);
  return [...pk, ...lib].join(' ');
}

/** the data partition's freed blocks handed back (fstrim): a deleted download otherwise stays in the disk image and in
 *  every cache of it. (Not zeros written over the free space: /data is encrypted on the disk, so zeros land as random
 *  bytes — a base grew from 4.8 to 8.0 GB that way.) Whether the emulator's disk passes it on shows in the image's size */
/** the device's free space on /data written over with zeros (all but 256 MB, so nothing on the device runs out), then
 *  deleted: the blocks deleted files left behind are zeros in the disk image from then on. → df's line for /data */
export function zeroFree(adb, { timeout = 20 * 60_000 } = {}) {
  const r = adb.run(['shell', 'f=/data/local/tmp/lab-zero; a=$(df -k /data | tail -1 | awk \'{print $4}\'); n=$(( (a - 262144) / 4096 )); [ "$n" -gt 0 ] && dd if=/dev/zero of=$f bs=4194304 count=$n 2>/dev/null; sync; rm -f $f; sync; df -h /data | tail -1'], { timeout });
  return (r.stdout + r.stderr).trim().split('\n').pop()?.replace(/\s+/g, ' ').slice(0, 120) ?? '';
}
/** Android's framework started again with these system properties (a service such as SurfaceFlinger reads its own only when
 *  it starts): → how long until a window was in front again, or null when they were already so */
export async function frameworkWith(adb, props, { timeout = 300_000 } = {}) {
  const want = Object.entries(props).filter(([k, v]) => adb.prop(k) !== v);
  if (!want.length) return null;
  const t0 = Date.now();
  adb.run(['shell', `${want.map(([k, v]) => `setprop ${k} ${v}`).join('; ')}; stop; start`], { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, Number(process.env.APP_RESTART_SETTLE_MS) || 10_000));
  while (Date.now() - t0 < timeout) { if (adb.focus().window) break; await new Promise((r) => setTimeout(r, 3000)); }
  return Date.now() - t0;
}
export function trimFree(adb) {
  const r = adb.run(['shell', 'fstrim -v /data 2>&1; true'], { timeout: 120_000 });
  return (r.stdout + r.stderr).trim().split('\n').pop()?.slice(0, 120) ?? '';
}

/** toybox `top -b -o %CPU,ARGS` (any number of looks) → "dex2oat64 98%" for the n busiest processes at 5 % or more in its
 *  last look, busiest first (pure). Sorted here: top's own order follows its default field list, not these two columns */
export function busiest(text, n = 5) {
  const lines = String(text ?? '').split('\n'), head = lines.findLastIndex((x) => /^\s*%CPU\s/.test(x));
  return lines.slice(head + 1).map((x) => /^\s*([\d.]+)\s+(\S+)/.exec(x)).filter((m) => m && Number(m[1]) >= 5)
    .sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, n).map((m) => `${m[2].split('/').pop().slice(0, 48)} ${Math.round(Number(m[1]))}%`);
}

// where the AVD lives, passed to avdmanager and emulator alike: left to themselves they can disagree (avdmanager wrote it
// elsewhere on GitHub's runner and the emulator answered "Unknown AVD name")
export const avdHome = (env = process.env) => env.ANDROID_AVD_HOME || path.join(env.ANDROID_USER_HOME || path.join(os.homedir(), '.android'), 'avd');
const avdEnv = (env) => cleanEnv(process.env, { ANDROID_AVD_HOME: avdHome(env) });

/** installs what the emulator needs (sdkmanager: emulator, platform-tools, the system image). Idempotent. */
export function ensureSdk({ log = console.log, env = process.env } = {}) {
  const t = tools(env);
  if (!t.sdk && !env.APP_EMULATOR) throw new AppError('Android SDK がありません', 'Android Studio か commandline-tools を入れ、ANDROID_HOME を設定してください（GitHub の ubuntu-latest には入っています）。');
  const img = sysImage(env);
  const need = [];
  if (!t.emulator) need.push('emulator');
  if (!t.adb) need.push('platform-tools');
  if (t.sdk && !fs.existsSync(path.join(t.sdk, ...img.split(';')))) need.push(img);
  if (need.length) {
    if (!t.sdkmanager) throw new AppError(`sdkmanager が無いので ${need.join(' ')} を入れられません`, 'Android SDK の cmdline-tools を入れてください。');
    log(`  sdkmanager: ${need.join(' ')}`);
    spawnSync(t.sdkmanager, ['--licenses'], { input: 'y\n'.repeat(20), encoding: 'utf8', timeout: 120_000, shell: WIN, env: cleanEnv() });
    const r = spawnSync(t.sdkmanager, need, { input: 'y\n'.repeat(5), encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 64e6, shell: WIN, env: cleanEnv() });
    if (r.status !== 0) throw new AppError(`sdkmanager が失敗しました: ${need.join(' ')}`, (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join('\n'));
  }
  return { image: img };
}
/** ensureSdk, then the AVD (made once; its config set again each time). Idempotent. */
export function ensureAvd({ log = console.log, env = process.env, gpu, avd = AVD } = {}) {
  const { image: img } = ensureSdk({ log, env });
  const avdDir = path.join(avdHome(env), `${avd}.avd`);
  // an AVD made from another image (the default moved from API 30: Minecraft 1.26 needs API 32+) is made again
  const madeFrom = fs.existsSync(path.join(avdDir, 'config.ini')) ? /^image\.sysdir\.1\s*=\s*(.*)$/m.exec(fs.readFileSync(path.join(avdDir, 'config.ini'), 'utf8'))?.[1]?.trim() : null;
  const stale = madeFrom && !madeFrom.replace(/[\\/]+$/, '').endsWith(img.split(';').slice(1).join('/'));
  if (!fs.existsSync(path.join(avdDir, 'config.ini')) || stale) {
    const t2 = tools(env);
    if (!t2.avdmanager) throw new AppError('avdmanager がありません', 'Android SDK の cmdline-tools を入れてください。');
    log(`  AVD ${avd} を作成（${img}）`);
    fs.mkdirSync(avdHome(env), { recursive: true });
    const r = spawnSync(t2.avdmanager, ['create', 'avd', '-n', avd, '-k', img, '-d', 'pixel_5', '--force'], { input: 'no\n', encoding: 'utf8', timeout: 120_000, shell: WIN, env: avdEnv(env) });
    if (r.status !== 0) throw new AppError('AVD を作れませんでした', (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join('\n'));
  }
  // Minecraft (minSdk 32 since 1.26) needs room (the install alone is > 1 GB) and a hardware keyboard (so `text` does not pop up the soft one)
  const cfg = path.join(avdDir, 'config.ini');
  if (fs.existsSync(cfg)) {
    let s = fs.readFileSync(cfg, 'utf8');
    const set = (k, v) => { const re = new RegExp(`^${k.replace(/\./g, '\\.')}\\s*=.*$`, 'm'); s = re.test(s) ? s.replace(re, `${k}=${v}`) : `${s.trimEnd()}\n${k}=${v}\n`; };
    const fit = deviceFit(env);
    set('hw.ramSize', String(fit.ram)); set('disk.dataPartition.size', env.APP_DISK || '8192M'); set('hw.keyboard', 'yes');
    set('hw.cpu.ncore', String(fit.cores));
    set('hw.gpu.enabled', 'yes'); set('hw.gpu.mode', gpu || gpuMode(env)); set('hw.audioInput', 'no'); set('hw.audioOutput', 'no');
    // a smaller screen (APP_SCREEN=720x1560): with software rendering every pixel the game draws costs host CPU.
    // Without it, the pixel_5's own (a screen set by an earlier run does not stay)
    const scr = screenSize(env) ?? { w: 1080, h: 2340, density: 440 };
    set('hw.lcd.width', String(scr.w)); set('hw.lcd.height', String(scr.h)); set('hw.lcd.density', String(scr.density));
    // a skin named "<w>x<h>" sets the size by itself: it must say the same (a device frame stays unless a size is asked for)
    if (screenSize(env) || /^skin\.name\s*=\s*\d+x\d+\s*$/m.test(s)) { set('skin.name', `${scr.w}x${scr.h}`); set('skin.path', '_no_skin'); }
    fs.writeFileSync(cfg, s);
  }
  return { avdDir, image: img };
}
/** the emulator's cores and RAM (MB) for this machine (pure given its numbers): no more cores than the host has (more
 *  only queue on the same CPUs, and the host still runs the software GPU, the BDS and adb), and RAM that leaves the host
 *  room (a 7 GB CI runner whose emulator took 4 GB plus the GPU's buffers was stopped mid-run). APP_CORES / APP_RAM win */
export function deviceFit(env = process.env, { cpus = os.cpus().length || 2, mem = os.totalmem() } = {}) {
  const gb = mem / 2 ** 30;
  const cores = Number(env.APP_CORES) || Math.max(2, Math.min(4, cpus));
  const ram = Number(env.APP_RAM) || (gb >= 14 ? 4096 : gb >= 9 ? 3584 : 3072);
  return { cores, ram };
}
/** the emulator's GPU mode (APP_GPU). swangle_indirect (ANGLE over SwiftShader's Vulkan, on the host): the only software
 *  mode the game draws in — under swiftshader_indirect it runs past its license and presents frames, all of them black */
export const gpuMode = (env = process.env) => env.APP_GPU || 'swangle_indirect';
// the densities the emulator takes; the default AVD (pixel_5) is 1080x2340 at 440
const DENSITIES = [160, 213, 240, 280, 320, 360, 400, 420, 440, 480, 560, 640];
/** APP_SCREEN ("720x1560", either order: the shorter side is the width of the upright phone) → {w, h, density} | null (pure).
 *  The density keeps the pixel_5's physical size (440 at 1080 wide) unless APP_DENSITY says */
export function screenSize(env = process.env) {
  const m = /^\s*(\d{3,4})\s*[x×*]\s*(\d{3,4})\s*$/i.exec(env.APP_SCREEN ?? '');
  if (!m) return null;
  const [w, h] = [Number(m[1]), Number(m[2])].sort((a, b) => a - b);
  const want = Number(env.APP_DENSITY) || (440 * w) / 1080;
  return { w, h, density: DENSITIES.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) };
}

/** starts the emulator in the background (returns at once). window: show it (local sign-in etc.), wipe: fresh data,
 *  writableSystem: /system can be changed (Play Store as a system app: app account --vending) */
/** snapshot: start from that snapshot of the AVD (lib/warm.mjs: the game already on its title screen); never saved over */
export function startEmulator({ labDir, window = false, wipe = false, writableSystem = false, gpu, snapshot, env = process.env, log = console.log, avd = AVD, serial = SERIAL, name = 'emulator' } = {}) {
  const t = tools(env);
  if (!t.emulator) throw new AppError('emulator がありません', '`node lab.mjs app emu` が sdkmanager で入れます。');
  if (process.platform === 'linux' && !kvmOk() && !env.APP_EMULATOR) log('W /dev/kvm が使えません: エミュレータはとても遅くなります（GitHub では app.yml が KVM を有効にします）');
  ensureAdbKey(t.adb, env);
  const port = Number(/emulator-(\d+)/.exec(serial)?.[1] ?? 5554);
  const args = ['-avd', avd, '-port', String(port), '-no-audio', '-no-boot-anim', '-no-metrics', '-gpu', gpu || gpuMode(env), '-no-snapshot-save', ...(snapshot && !wipe ? ['-snapshot', snapshot] : ['-no-snapshot-load']), ...(window ? [] : ['-no-window']), ...(wipe ? ['-wipe-data'] : []), ...(writableSystem ? ['-writable-system'] : []), ...(env.APP_EMU_ARGS ? env.APP_EMU_ARGS.split(/\s+/).filter(Boolean) : [])];
  fs.mkdirSync(labDir, { recursive: true });
  const logFd = fs.openSync(path.join(labDir, `${name}.log`), 'w');
  // Linux: the emulator yields the CPU to the rest (the CI runner itself, the BDS, adb) and, if memory runs out, is what
  // the kernel takes first, not them (a CI run whose runner was stopped mid-step left nothing to read). APP_EMU_NICE=0: as is
  const [cmd, argv] = process.platform === 'linux' && env.APP_EMU_NICE !== '0'
    ? ['/bin/sh', ['-c', 'echo 500 > /proc/self/oom_score_adj 2>/dev/null; command -v nice >/dev/null && exec nice -n 5 "$@"; exec "$@"', 'emulator', t.emulator, ...args]] : [t.emulator, args];
  const c = spawn(cmd, argv, { detached: true, stdio: ['ignore', logFd, logFd], windowsHide: !window, env: avdEnv(env) });
  fs.closeSync(logFd);
  c.unref();
  fs.writeFileSync(path.join(labDir, `${name}.json`), JSON.stringify({ pid: c.pid, serial, started: Date.now(), args }));
  return c.pid;
}

// The emulator hands the host's adb public key to the device when it starts. Images built as "user" (google_apis_playstore)
// accept only that key: if ~/.android/adbkey did not exist yet (a fresh CI runner where adb never ran), the device stays
// "unauthorized" for good. So the key is made first (the adb server makes it on start; `adb keygen` if not).
export const adbKeyDir = (env = process.env) => env.APP_ADBKEY_DIR || env.ANDROID_USER_HOME || path.join(os.homedir(), '.android');
export function ensureAdbKey(adbBin, env = process.env) {
  const dir = adbKeyDir(env), pub = path.join(dir, 'adbkey.pub');
  if (!adbBin || fs.existsSync(pub)) return fs.existsSync(pub);
  spawnSync(adbBin, ['start-server'], { timeout: 30_000, env: cleanEnv() });
  if (!fs.existsSync(pub)) { fs.mkdirSync(dir, { recursive: true }); spawnSync(adbBin, ['keygen', path.join(dir, 'adbkey')], { timeout: 30_000, env: cleanEnv() }); }
  return fs.existsSync(pub);
}

/** warm: started from a snapshot (lib/warm.mjs): the settings are in it already and the game has the screen (no MENU key) */
export async function waitBoot(adb, { timeoutMs = Number(process.env.APP_BOOT_TIMEOUT) || 15 * 60_000, log = console.log, unauthorizedMs = Number(process.env.APP_UNAUTHORIZED_MS) || 120_000, warm = false } = {}) {
  const end = Date.now() + timeoutMs;
  let shown = 0, unauthorizedSince = 0;
  while (Date.now() < end) {
    // "unauthorized" that does not go away: the key was not there when the emulator started (see ensureAdbKey)
    const st = adb.run(['get-state'], { timeout: 5000 });
    if (/unauthorized/.test(st.stderr + st.stdout)) {
      unauthorizedSince ||= Date.now();
      if (Date.now() - unauthorizedSince > unauthorizedMs) throw new AppError('エミュレータの adb が「未認証」のままです（device unauthorized）', `adb の鍵（${path.join(adbKeyDir(), 'adbkey.pub')}）がエミュレータの起動より後にできたか、違う鍵です。エミュレータを止めて、もう一度起動してください（ラボは起動の前に鍵を作ります）。`);
    } else unauthorizedSince = 0;
    if (adb.booted()) {
      if (warm) return true;
      // quieter, faster screens: no animations, stay awake, unlocked
      for (const k of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) adb.shell(['settings', 'put', 'global', k, '0']);
      adb.shell(['svc', 'power', 'stayon', 'true']); adb.shell(['input', 'keyevent', '82']);
      return true;
    }
    if (Date.now() - shown > 60_000) { shown = Date.now(); log(`  起動待ち… (${Math.round((timeoutMs - (end - Date.now())) / 1000)}s)`); }
    await sleep(warm ? 300 : 3000);
  }
  throw new AppError(`エミュレータが ${Math.round(timeoutMs / 60000)} 分で起動しませんでした`, 'app/.lab/emulator.log を見てください（KVM が無い、ディスクが足りない、など）。');
}

/** stops it the clean way first (the console's kill closes the disk images: an AVD that is kept, with its snapshot, must
 *  not be cut off mid-write), then by signal if it has not gone within waitMs. The signal goes to the whole process group
 *  (started detached: the launcher and its qemu child share it): killing the launcher alone left qemu running on GitHub —
 *  a second emulator taking half the memory of a 2-core runner for the rest of the run */
export async function stopEmulator(adb, labDir, name = 'emulator', { waitMs = 60_000 } = {}) {
  let pid = 0;
  try { pid = JSON.parse(fs.readFileSync(path.join(labDir, `${name}.json`), 'utf8')).pid; } catch { /* not ours */ }
  const alive = () => { if (!pid) return false; for (const p of WIN ? [pid] : [-pid, pid]) { try { process.kill(p, 0); return true; } catch { /* not this one */ } } return false; };
  if (adb) adb.run(['emu', 'kill'], { timeout: 15_000 });
  for (const end = Date.now() + waitMs; alive() && Date.now() < end;) await sleep(500);
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    if (!alive()) break;
    for (const p of WIN ? [pid] : [-pid, pid]) try { process.kill(p, sig); } catch { /* gone */ }
    for (const end = Date.now() + 10_000; alive() && Date.now() < end;) await sleep(250);
  }
  fs.rmSync(path.join(labDir, `${name}.json`), { force: true });
}
