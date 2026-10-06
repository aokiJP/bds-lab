// Real Android devices (a person's own phone or tablet), next to the emulator and redroid: what a device is (how adb reaches
// it, its Android, root, the game, its networks) and the way the lab can use it — one of four, root or not × USB or Wi-Fi.
//
//   the game's network (how it finds the lab's BDS) and adb's link are two different things:
//     - same network as this machine (Wi-Fi, or USB tethering, or the phone's hotspot): the game's own LAN discovery reaches
//       the BDS as it is, no relay and no root
//     - no shared network: adb carries TCP only (forward / reverse) and the game speaks UDP, so a relay over adb would be
//       needed (not built yet), or the person shares a network (tethering, hotspot), or joins by address (Microsoft sign-in)
//   control: root → the lab's controller (uinput, lab-pad); no root → the shell's key events and taps (adb input)
//   logs: root → the game's private folder too; no root → its external folder (Android/data/…, readable over adb on many
//   devices: measured per device) and logcat
//
// Only devices the person added (`app device add`) are touched: `scan` lists what adb sees and runs nothing on them.
// A pairing code is used at once and never written anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanEnv } from './apk.mjs';

export const PACKAGE = 'com.mojang.minecraftpe';
export const EXTERNAL_LOGS = `/sdcard/Android/data/${PACKAGE}/files/games/com.mojang/logs`;
const TETHER_IFACE = /^(rndis\d*|usb\d+|ncm\d*|eth\d+)$/;

/** `adb devices -l` (pure) → [{ serial, state, link, model, product, device, transport }] */
export function parseDevices(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^(\S+)\s+(device|unauthorized|offline|recovery|sideload|bootloader|no permissions[^\n]*?|authorizing|connecting)(\s+.*)?$/.exec(line.trim());
    if (!m || /^List of devices/.test(line)) continue;
    const kv = Object.fromEntries([...String(m[3] ?? '').matchAll(/(\w+):(\S+)/g)].map((x) => [x[1], x[2]]));
    out.push({ serial: m[1], state: m[2].startsWith('no permissions') ? 'no permissions' : m[2], link: linkOf(m[1]), model: kv.model ?? null, product: kv.product ?? null, device: kv.device ?? null, transport: kv.transport_id ?? null });
  }
  return out;
}
/** how adb reaches a device, from its serial (pure): an IP and port or an mDNS name = Wi-Fi; emulator-NNNN = an emulator */
export function linkOf(serial) {
  const s = String(serial);
  if (/^emulator-\d+$/.test(s)) return 'emulator';
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s) || /^\[[0-9a-f:]+\]:\d+$/i.test(s) || /\._adb-tls-(connect|pairing)\._tcp/.test(s)) return 'wifi';
  return 'usb';
}
/** `ip -o -4 addr show` (pure) → [{ iface, ip, prefix }] without loopback */
export function parseAddrs(text) {
  const out = [];
  for (const m of String(text).matchAll(/^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/gm)) if (m[1] !== 'lo') out.push({ iface: m[1].replace(/@.*$/, ''), ip: m[2], prefix: Number(m[3]) });
  return out;
}
const ipNum = (ip) => ip.split('.').reduce((n, x) => (n << 8) + Number(x), 0) >>> 0;
/** two IPv4 addresses on one network: the shorter of their prefixes decides (pure) */
export function sameNet(a, b) {
  const p = Math.min(a.prefix, b.prefix);
  if (!(p > 0 && p <= 32)) return false;
  const mask = p === 32 ? 0xffffffff : (~((1 << (32 - p)) - 1)) >>> 0;
  return ((ipNum(a.ip) & mask) >>> 0) === ((ipNum(b.ip) & mask) >>> 0);
}
/** this machine's IPv4 networks → [{ iface, ip, prefix }] (APP_HOST_IFACES: JSON, for tests) */
export function hostAddrs(env = process.env) {
  if (env.APP_HOST_IFACES) { try { return JSON.parse(env.APP_HOST_IFACES); } catch { return []; } }
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) for (const a of list ?? []) {
    if (a.family !== 'IPv4' && a.family !== 4) continue;
    if (a.internal) continue;
    const prefix = a.cidr ? Number(a.cidr.split('/')[1]) : 24;
    out.push({ iface, ip: a.address, prefix });
  }
  return out;
}

// (adb gets no secret: cleanEnv, as every other child of the app lab. A child stopped by a signal — Ctrl+C reaches it too —
// failed: its empty output is no answer)
const run = (bin, args, { timeout = 30_000, input } = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', input, env: cleanEnv() });
  return { status: r.status ?? 1, out: String(r.stdout ?? ''), err: String(r.stderr ?? '') };
};
export const listDevices = (adbBin) => parseDevices(run(adbBin, ['devices', '-l']).out);

/** `adb mdns services` (pure) → [{ name, type, hostPort }]: wireless debugging announces itself as adb-<serial>-<random> */
export function parseMdns(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^(\S+)\s+(_adb(?:-tls-connect|-tls-pairing)?\._tcp)\.?\s+(\S+:\d+)\s*$/.exec(line.trim());
    if (m) out.push({ name: m[1], type: m[2], hostPort: m[3] });
  }
  return out;
}

/** what a device is (runs a few read-only shell commands on it): its link, Android, CPU, root, the game, screen, networks */
export function probe(adbBin, serial, { timeout = 20_000 } = {}) {
  const sh = (cmd, t = timeout) => run(adbBin, ['-s', serial, 'shell', cmd], { timeout: t });
  const prop = (k) => sh(`getprop ${k}`).out.trim();
  // (hw: the device's own serial number, the same over USB and Wi-Fi — how a device that came back on another port is found)
  const facts = { serial, link: linkOf(serial), hw: prop('ro.serialno') || null, model: prop('ro.product.model') || null, maker: prop('ro.product.manufacturer') || null, android: prop('ro.build.version.release') || null, sdk: Number(prop('ro.build.version.sdk')) || null, abi: prop('ro.product.cpu.abi') || null, root: null, game: null, screen: null, addrs: [] };
  // root: adbd itself as root (an emulator, a userdebug build), else su (Magisk and the like: the first time it may ask on
  // the device's screen, so a short wait and no retry)
  // (su: which form answers is kept — Magisk and the like take `su -c`, AOSP's own su only `su 0 sh -c`)
  if (/^0\s*$/.test(sh('id -u').out)) facts.root = 'adb';
  else if (/uid=0\b/.test(sh('su -c id 2>/dev/null || true', 12_000).out)) { facts.root = 'su'; facts.su = '-c'; }
  else if (/uid=0\b/.test(sh('su 0 id 2>/dev/null || true', 12_000).out)) { facts.root = 'su'; facts.su = '0'; }
  const pkg = sh(`dumpsys package ${PACKAGE}`, 30_000).out;
  const v = /versionName=(\S+)/.exec(pkg)?.[1];
  if (v) facts.game = { versionName: v, versionCode: Number(/versionCode=(\d+)/.exec(pkg)?.[1]) || null };
  const wm = /(?:Override|Physical) size:\s*(\d+)x(\d+)/.exec(sh('wm size').out);
  if (wm) facts.screen = { w: Number(wm[1]), h: Number(wm[2]) };
  facts.addrs = parseAddrs(sh('ip -o -4 addr show 2>/dev/null || true').out);
  return facts;
}

/** the way to use a device (pure): { key, link, root, join, via, hostIp, control, logs, ok, why: [..], todo: [..] }
 *  key = root-usb | root-wifi | noroot-usb | noroot-wifi. join: lan (the game finds the BDS itself) | none (nothing shared:
 *  todo says what to do). via: the device's network that the BDS shares (wifi, tether). control: pad (the lab's controller,
 *  root on a CPU the lab builds it for) | input (the shell's key events and taps). wsl: this machine is WSL (its own NAT
 *  network unless mirrored) */
export function choosePath(facts, host = [], { wsl = false, direct = null } = {}) {
  const root = Boolean(facts.root), link = facts.link === 'wifi' ? 'wifi' : 'usb';
  const key = `${root ? 'root' : 'noroot'}-${link}`, why = [], todo = [];
  if (facts.link === 'emulator') return { key: 'emulator', ok: false, why: ['エミュレータです'], todo: ['エミュレータは --device emu（既定）で使います'] };
  let shared = null;
  for (const d of facts.addrs ?? []) for (const h of host) if (!shared && sameNet(d, h)) shared = { device: d, host: h, via: TETHER_IFACE.test(d.iface) ? 'tether' : 'wifi' };
  // (direct: an address the game reaches some other way — Tailscale, a VPN — given as APP_TRANSPORT=raknet APP_HOST=<it>)
  const join = shared ? 'lan' : direct ? 'address' : 'none';
  if (shared) why.push(`端末の ${shared.device.iface}（${shared.device.ip}）とこの PC の ${shared.host.iface}（${shared.host.ip}）が同じネットワーク: ゲームの LAN の放送がそのまま届くので、中継は要りません`);
  else if (direct) why.push(`同じネットワークではないので、PC のアドレス ${direct} へアドレスで参加します（APP_TRANSPORT=raknet: ゲームで Microsoft にサインインしていること、端末から ${direct} へ届くこと）`);
  else {
    why.push('端末とこの PC が同じネットワークにいません（adb の転送は TCP だけで、ゲームの UDP は運べません）');
    if (wsl) todo.push('この PC は WSL2 です（既定は Windows と別の NAT のネットワーク）: Windows の %UserProfile%\\.wslconfig の [wsl2] に networkingMode=mirrored を書いて wsl --shutdown（Windows 11 22H2 以降）');
    if (link === 'usb') todo.push('端末の設定で USB テザリングを入れる（PC と端末が同じネットワークになります。node lab.mjs app device tether <名前> で adb から試せます）', 'または、端末と PC を同じ Wi-Fi につなぐ');
    else todo.push('端末と PC を同じ Wi-Fi のネットワークにする（ゲスト用の Wi-Fi は端末同士を隔離していることがあります: そのときは端末のホットスポットに PC をつなぐ）');
    todo.push('端末から別の道で PC に届くなら（Tailscale・VPN など）、ゲームで Microsoft にサインインして APP_TRANSPORT=raknet APP_HOST=<届く PC のアドレス>（アドレスで参加）');
  }
  const pad = root && /^(x86_64|arm64-v8a)$/.test(facts.abi ?? '');
  why.push(root ? `root あり（${facts.root === 'adb' ? 'adbd が root' : 'su'}）: ${pad ? '操作はラボのコントローラー（uinput）、' : `操作は adb の入力（${facts.abi ?? '?'} 用のコントローラーは作れません）、`}ゲームのコンテンツログは内側の保存先からも` : 'root なし: 操作は adb の入力（キーとタップ）、コンテンツログは外部の保存先か logcat から');
  if (!facts.game) todo.unshift('端末に Minecraft を Play ストアから入れる（ラボは端末へ APK を入れません）');
  if (link === 'wifi' && facts.sdk && facts.sdk < 30) why.push('Android 10 以下: Wi-Fi の adb は USB から adb tcpip で入れたものです');
  return { key, link, root, join, via: shared?.via ?? null, hostIp: shared?.host.ip ?? direct ?? null, control: pad ? 'pad' : 'input', logs: root ? 'any' : 'external', ok: Boolean((shared || direct) && facts.game), why, todo };
}
/** this machine runs under WSL (Linux on Windows) */
export function isWsl() { try { return /microsoft/i.test(fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8')); } catch { return false; } }

// ---- the devices the person added: app/.lab/devices.json { devices: { name: { serial, model, android, added } } } ----
export const registryFile = (labDir) => path.join(labDir, 'devices.json');
export function registry(labDir) { try { return JSON.parse(fs.readFileSync(registryFile(labDir), 'utf8')); } catch { return { devices: {} }; } }
function saveRegistry(labDir, reg) { fs.mkdirSync(labDir, { recursive: true }); const f = registryFile(labDir), t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(reg, null, 1) + '\n'); fs.renameSync(t, f); }
export const validName = (n) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(String(n ?? ''));
/** a name (or the serial of an added device) → { name, serial, ... } or null */
export function resolve(labDir, nameOrSerial) {
  const reg = registry(labDir);
  if (reg.devices[nameOrSerial]) return { name: nameOrSerial, ...reg.devices[nameOrSerial] };
  const hit = Object.entries(reg.devices).find(([, d]) => d.serial === nameOrSerial);
  return hit ? { name: hit[0], ...hit[1] } : null;
}
export function addDevice(labDir, name, facts) {
  if (!validName(name)) throw new Error(`名前 ${name} は使えません（英小文字・数字・- _、32 文字まで）`);
  if (['emu', 'redroid'].includes(name)) throw new Error(`名前 ${name} はラボの端末の名前です（別の名前に）`);
  const reg = registry(labDir);
  const other = Object.entries(reg.devices).find(([n, d]) => d.serial === facts.serial && n !== name);
  if (other) throw new Error(`この端末（${facts.serial}）は ${other[0]} として登録済みです`);
  reg.devices[name] = { serial: facts.serial, model: facts.model, android: facts.android, link: facts.link, added: new Date().toISOString() };
  saveRegistry(labDir, reg);
  writeFacts(labDir, name, facts);
  return reg.devices[name];
}
export function forgetDevice(labDir, name, { force = false } = {}) {
  const reg = registry(labDir);
  if (!reg.devices[name]) return false;
  // (values still to put back belong to that phone: forgetting it first would apply them to the next one of that name)
  if (pendingRestore(labDir, name) && !force) throw new Error(`${name} の設定をまだ戻していません: 先に node lab.mjs app device restore ${name}（その端末が無いなら --force で、戻す値ごと消します）`);
  delete reg.devices[name];
  saveRegistry(labDir, reg);
  fs.rmSync(path.join(labDir, 'devices', `${name}.json`), { force: true });
  fs.rmSync(restoreFile(labDir, name), { force: true });
  return true;
}
/** a device reached over Wi-Fi may come back on another port (wireless debugging picks one each time): its new serial */
export function rebind(labDir, name, serial) {
  const reg = registry(labDir);
  if (!reg.devices[name]) return false;
  reg.devices[name].serial = serial; reg.devices[name].link = linkOf(serial);
  saveRegistry(labDir, reg);
  return true;
}

// ---- Wi-Fi: pairing (Android 11+: the code the device shows), connecting, and adb tcpip (Android 10 and older, over USB first) ----
export function pair(adbBin, hostPort, code) {
  if (!/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(hostPort)) return { ok: false, note: `${hostPort} は「IP:ポート」ではありません（端末の「ペア設定コードによるデバイスのペア設定」に出る IP とポート）` };
  if (!/^\d{6}$/.test(String(code ?? '').trim())) return { ok: false, note: 'ペア設定コードは 6 桁の数字です' };
  // (the code goes to adb on its standard input — adb pair asks for it when it is not on the command line — so it is in no
  // process list either; it is not printed or kept)
  const r = run(adbBin, ['pair', hostPort], { timeout: 60_000, input: `${String(code).trim()}\n` });
  const ok = r.status === 0 && /Successfully paired/i.test(r.out + r.err);
  return { ok, note: ok ? `ペア設定しました（${hostPort}）` : `ペア設定できません: ${(r.err || r.out).trim().split('\n').pop()?.slice(0, 160) ?? r.status}` };
}
export function connect(adbBin, hostPort) {
  const r = run(adbBin, ['connect', hostPort], { timeout: 30_000 });
  const ok = r.status === 0 && /connected to|already connected/i.test(r.out) && !/failed|cannot|unable/i.test(r.out);
  // (the serial adb itself reports: an address given without a port is :5555 there)
  const serial = ok ? (/(?:already )?connected to (\S+)/i.exec(r.out)?.[1] ?? (/:\d+$/.test(hostPort) ? hostPort : `${hostPort}:5555`)) : null;
  return { ok, serial, note: ok ? `つながりました（${serial}）` : `つながりません: ${(r.out || r.err).trim().split('\n').pop()?.slice(0, 160) ?? r.status}` };
}
/** Android 10 and older: adb over USB switches the device to TCP 5555, then a connect to its Wi-Fi address */
export function tcpip(adbBin, serial, { port = 5555 } = {}) {
  const facts = { addrs: parseAddrs(run(adbBin, ['-s', serial, 'shell', 'ip -o -4 addr show 2>/dev/null || true']).out) };
  // (Wi-Fi or the phone's own hotspot only — never the mobile network, a VPN or a tunnel — and decided before adbd is switched
  // to TCP: switched and then not reachable, it would stay so until the device restarts)
  const wlan = facts.addrs.find((a) => /^(wlan|swlan|ap)\d*$/.test(a.iface));
  if (!wlan) return { ok: false, note: '端末の Wi-Fi のアドレスがありません（端末を Wi-Fi につないでから。モバイル回線・VPN には切り替えません）' };
  const t = run(adbBin, ['-s', serial, 'tcpip', String(port)], { timeout: 30_000 });
  if (t.status !== 0) return { ok: false, note: `adb tcpip が失敗しました: ${(t.err || t.out).trim().slice(0, 160)}` };
  return connect(adbBin, `${wlan.ip}:${port}`);
}
/** a wireless-debugging device by its own serial number in adb's mDNS list → its connect address, or null */
export function mdnsAddress(adbBin, hw) {
  if (!hw) return null;
  return parseMdns(run(adbBin, ['mdns', 'services'], { timeout: 15_000 }).out).find((s) => s.type === '_adb-tls-connect._tcp' && s.name.startsWith(`adb-${hw}-`))?.hostPort ?? null;
}
/** an added device, online: as it was, else (Wi-Fi) adb connect to its last address, else its new address from mDNS
 *  (wireless debugging picks another port each time), else waiting for Android's own reconnect (ADB Wi-Fi 2.0, Android
 *  17+: the device comes back by itself on a trusted network) → { ok, serial, note } (a new serial is rebound) */
export async function online(adbBin, labDir, dev, { waitMs = Number(process.env.APP_DEVICE_WAIT_MS) || 20_000, poll = 2000 } = {}) {
  const facts = readFacts(labDir, dev.name) ?? {};
  const hw = facts.hw ?? null;
  const seen = () => listDevices(adbBin);
  // (the registered serial first; then the same device by its own serial number: wireless debugging's mDNS name has it, and
  // over USB the serial IS it — a device moved to Wi-Fi and plugged in again is found there)
  const isUp = (list) => { const up = list.filter((d) => d.state === 'device'); return up.find((d) => d.serial === dev.serial) ?? (hw ? up.find((d) => d.serial.startsWith(`adb-${hw}-`)) ?? up.find((d) => d.serial === hw) : undefined); };
  let up = isUp(seen());
  const tried = [];
  if (!up && linkOf(dev.serial) === 'wifi' && /:\d+$/.test(dev.serial) && !dev.serial.includes('_adb-tls')) { const c = connect(adbBin, dev.serial); tried.push(c.note); if (c.ok) up = isUp(seen()); }
  if (!up && hw) { const a = mdnsAddress(adbBin, hw); if (a) { const c = connect(adbBin, a); tried.push(c.note); if (c.ok) up = { serial: a }; } }
  for (const t0 = Date.now(); !up && Date.now() - t0 < waitMs;) { await new Promise((r) => setTimeout(r, poll)); up = isUp(seen()); }
  if (!up) {
    const unauth = seen().find((d) => d.serial === dev.serial && d.state === 'unauthorized');
    return { ok: false, serial: null, note: unauth ? `端末 ${dev.name} が adb を許可していません（端末の画面の「USB デバッグを許可しますか？」で許可）` : `端末 ${dev.name}（${dev.serial}）が見つかりません${tried.length ? `（${tried.join('、')}）` : ''}` };
  }
  if (up.serial !== dev.serial) rebind(labDir, dev.name, up.serial);
  return { ok: true, serial: up.serial, note: up.serial !== dev.serial ? `端末 ${dev.name} は ${up.serial} でつながりました（前は ${dev.serial}）` : '' };
}
export function readFacts(labDir, name) { try { return JSON.parse(fs.readFileSync(path.join(labDir, 'devices', `${name}.json`), 'utf8')); } catch { return null; } }
// (what a new look cannot see again is kept from the last one: the USB function before tethering)
const KEPT = ['usbBefore'];
export function writeFacts(labDir, name, facts) {
  const was = readFacts(labDir, name) ?? {};
  fs.mkdirSync(path.join(labDir, 'devices'), { recursive: true });
  fs.writeFileSync(path.join(labDir, 'devices', `${name}.json`), JSON.stringify({ ...Object.fromEntries(KEPT.filter((k) => was[k] !== undefined).map((k) => [k, was[k]])), ...facts, checked: new Date().toISOString() }, null, 1) + '\n');
}

// ---- while the lab uses a person's device: the screen on, notifications quiet; everything put back afterwards ----
// The values before are written first (devices/<name>.restore.json), so a run that was killed is put right by the next one
// or by `app device restore <name>`. Nothing else on the device is changed: no app is stopped or disabled, nothing installed
const restoreFile = (labDir, name) => path.join(labDir, 'devices', `${name}.restore.json`);
const SETTINGS = [['global', 'stay_on_while_plugged_in', '7'], ['system', 'screen_off_timeout', '1800000'], ['global', 'sysui_demo_allowed', '1']];
/** sh(cmd) → { status, out }: the screen kept on (plugged in or not: 30 minutes), woken, unlocked when it has no lock;
 *  quiet (APP_DEVICE_QUIET=0: not): the status bar in demo mode (no notification icons in the pictures) and Do Not Disturb
 *  (no heads-up over the game) → { locked } (a lock screen the lab cannot pass: the person unlocks it). hw: the device's own
 *  serial number, kept with the values (they are never put on another phone). Values left from a killed run are put back
 *  first; if that fails, nothing is changed (throws) */
export function holdDevice(sh, labDir, name, { quiet = process.env.APP_DEVICE_QUIET !== '0', hw = null } = {}) {
  if (fs.existsSync(restoreFile(labDir, name))) {
    const r = releaseDevice(sh, labDir, name, { hw });
    if (r.failed.length) throw new Error(`前の run の設定を戻せませんでした（${r.failed.join('、')}）: node lab.mjs app device restore ${name}`);
  }
  // (a value read back as anything but a plain value — an error, nothing, a device gone for a moment — is left alone:
  // neither changed nor "restored" to that text)
  const read = (ns, k) => { const r = sh(`settings get ${ns} ${k}`), v = String(r.out ?? '').trim(); return r.status === 0 && /^[\w.:-]+$/.test(v) ? v : undefined; };
  const before = { hw, settings: SETTINGS.map(([ns, k]) => [ns, k, read(ns, k)]).filter(([, , v]) => v !== undefined), zen: read('global', 'zen_mode') ?? '?', quiet };
  fs.mkdirSync(path.dirname(restoreFile(labDir, name)), { recursive: true });
  fs.writeFileSync(restoreFile(labDir, name), JSON.stringify(before, null, 1) + '\n');
  for (const [ns, k, v] of SETTINGS) if (before.settings.some((x) => x[1] === k) && (quiet || k !== 'sysui_demo_allowed')) sh(`settings put ${ns} ${k} ${v}`);
  sh('input keyevent KEYCODE_WAKEUP'); sh('wm dismiss-keyguard');
  if (quiet) {
    const demo = (args) => sh(`am broadcast -a com.android.systemui.demo -e command ${args}`);
    demo('enter'); demo('notifications -e visible false'); demo('clock -e hhmm 1200'); demo('battery -e level 100 -e plugged false');
    if (zenOff(before.zen)) sh('cmd notification set_dnd priority');
  }
  return { locked: isLocked(sh) };
}
const zenOff = (z) => z === '0' || z === 'null';
/** the device's lock screen is up (the person unlocks it: the lab never types a PIN) */
export const isLocked = (sh) => /(mDreamingLockscreen|KeyguardShowing|mShowingLockscreen)=true/i.test(sh('dumpsys window 2>/dev/null | grep -i -E "lockscreen|keyguardshowing" || true').out);
/** the settings as they were before holdDevice put back → { done: [..], failed: [..] }. Each command must succeed: what did
 *  not (the device gone, a Wi-Fi link dropped) stays in the file for `device restore`; the file goes only when all is back.
 *  hw: the device's own serial number — values kept for another phone are not put on this one (failed) */
export function releaseDevice(sh, labDir, name, { hw = null } = {}) {
  const f = restoreFile(labDir, name);
  let before; try { before = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { done: [], failed: [] }; }
  if (before.hw && hw && before.hw !== hw) return { done: [], failed: [`別の端末（${before.hw}）の値です`] };
  const done = [], failed = [], left = { ...before, settings: [], quiet: false, zen: '?' };
  const ok = (r) => r.status === 0 && !/Exception|Error|error:/.test(String(r.out ?? ''));
  // (demo mode left first, while SystemUI still takes demo commands: it ignores them once sysui_demo_allowed is back to 0)
  if (before.quiet) {
    if (ok(sh('am broadcast -a com.android.systemui.demo -e command exit'))) done.push('demo'); else { failed.push('demo'); left.quiet = true; }
  }
  for (const [ns, k, v] of before.settings ?? []) {
    if (!before.quiet && k === 'sysui_demo_allowed') continue;
    if (ok(sh(!v || v === 'null' ? `settings delete ${ns} ${k}` : `settings put ${ns} ${k} ${v}`))) done.push(k); else { failed.push(k); left.settings.push([ns, k, v]); }
  }
  if (before.quiet && zenOff(before.zen)) {
    if (ok(sh('cmd notification set_dnd off'))) done.push('dnd'); else { failed.push('dnd'); left.quiet = true; left.zen = before.zen; }
  }
  if (failed.length) fs.writeFileSync(f, JSON.stringify(left, null, 1) + '\n'); else fs.rmSync(f, { force: true });
  return { done, failed };
}
export const pendingRestore = (labDir, name) => fs.existsSync(restoreFile(labDir, name));

/** the device reaches this machine (ping from the device; a firewall here may drop pings: a hint, not a verdict) */
export function reaches(sh, ip) { return /\b[1-9]\d* (packets )?received\b/.test(sh(`ping -c 2 -W 2 ${ip} 2>&1 || true`).out); }

/** USB tethering from adb (works on some devices only: measured by trying) → { ok, note, addrs }. off: the USB function the
 *  device had before (sys.usb.config, kept in the device's facts) */
export async function tether(adbBin, serial, { on = true, before = null, waitMs = 15_000 } = {}) {
  const sh = (cmd, t = 20_000) => run(adbBin, ['-s', serial, 'shell', cmd], { timeout: t });
  const was = sh('getprop sys.usb.config').out.trim();
  const fn = on ? (Number(sh('getprop ro.build.version.sdk').out.trim()) >= 30 ? 'ncm' : 'rndis') : String(before ?? 'mtp').split(',').filter((x) => x !== 'adb').join(',') || 'mtp';
  const r = sh(`svc usb setFunctions ${fn} 2>&1 || true`);
  if (/Exception|not allowed|denied|Unknown|usage:/i.test(r.out)) return { ok: false, was, note: `adb からは切り替えられません（${r.out.trim().split('\n')[0].slice(0, 120)}）: 端末の設定 → ネットワーク → テザリング → USB テザリング` };
  // (the USB link goes away for a moment while the device changes its functions: wait for adb to see it again)
  run(adbBin, ['-s', serial, 'wait-for-device'], { timeout: waitMs });
  let addrs = [];
  for (const t0 = Date.now(); Date.now() - t0 < waitMs;) {
    addrs = parseAddrs(sh('ip -o -4 addr show 2>/dev/null || true').out);
    if (!on || addrs.some((a) => TETHER_IFACE.test(a.iface))) break;
    await new Promise((r2) => setTimeout(r2, 1500));
  }
  const t = addrs.find((a) => TETHER_IFACE.test(a.iface));
  if (on && !t) return { ok: false, was, addrs, note: `USB の働きを ${fn} にしましたが、テザリングのアドレスが出ません: 端末の設定 → ネットワーク → テザリング → USB テザリング を入れてください` };
  return { ok: true, was, addrs, note: on ? `USB テザリング: 端末の ${t.iface} ${t.ip}/${t.prefix}` : `USB の働きを ${fn} に戻しました` };
}
