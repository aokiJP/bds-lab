// A person's own Android devices (app/lib/device.mjs, `node lab.mjs app device`, `app run --device <name>`) without a device:
// the pieces (adb's lists, networks, the way chosen for root or not × USB or Wi-Fi, the registry, the settings held and put
// back) and the commands end to end against the fake adb (tests/fake/app/adb with FAKE_DEVICES) and the fake BDS lab.
// Also the lab's controller built for a phone's CPU (arm64) when this machine can build it.
// node tests/device-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const Dev = await imp('app/lib/device.mjs');
const D = await imp('app/lib/android.mjs');
const C = await imp('app/lib/client.mjs');

let pass = 0, fail = 0;
const only = process.env.DEVICE_TEST_ONLY ? new RegExp(process.env.DEVICE_TEST_ONLY) : null;
const t = async (name, fn) => { if (only && !only.test(name)) return; try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}\n     ${e.stack?.split('\n')[1] ?? ''}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'device-offline-'));
const FAKE = path.join(TOP, 'tests', 'fake', 'app');
fs.chmodSync(path.join(FAKE, 'adb'), 0o755);

// ---- the devices the fake adb plays ----
const WLAN = '1: lo    inet 127.0.0.1/8 scope host lo\n3: wlan0    inet 192.168.1.23/24 brd 192.168.1.255 scope global wlan0';
const HOST_WIFI = [{ iface: 'wlp2s0', ip: '192.168.1.10', prefix: 24 }];
const HOST_USB = [{ iface: 'wlp2s0', ip: '10.0.0.5', prefix: 24 }, { iface: 'usb0', ip: '192.168.42.100', prefix: 24 }];
const SETTINGS = { stay_on_while_plugged_in: '0', screen_off_timeout: '60000', zen_mode: '0' };
const phone = (o = {}) => ({ serial: 'R58M123ABC', model: 'Pixel_7', maker: 'Google', android: '14', sdk: 34, abi: 'arm64-v8a', hw: 'R58M123ABC', root: null, game: true, addrs: WLAN, settings: SETTINGS, ...o });
const stranger = { serial: 'XYZ999', model: 'Other', android: '13', sdk: 33, abi: 'arm64-v8a', hw: 'XYZ999', game: true, addrs: WLAN };

// one test's world: its own fake state, registry folder and devices
function world(name, devices, { host = HOST_WIFI, env = {} } = {}) {
  const state = path.join(tmp, `${name}.json`), lab = path.join(tmp, `${name}-lab`);
  fs.writeFileSync(state, JSON.stringify({ phase: 'home' }));
  const e = { ...process.env, FAKE_APP_STATE: state, APP_ADB: path.join(FAKE, 'adb'), APP_DEVICES_DIR: lab, APP_HOST_IFACES: JSON.stringify(host), FAKE_DEVICES: JSON.stringify(devices), APP_DEVICE_WAIT_MS: '300', ...env };
  delete e.GITHUB_ACTIONS; delete e.LAB_ASK_FILE; delete e.APP_DEVICE;
  const cli = (args, { input, extra = {} } = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', ...args], { cwd: TOP, encoding: 'utf8', timeout: 90_000, env: { ...e, ...extra }, input }); return { status: r.status, text: (r.stdout ?? '') + (r.stderr ?? '') }; };
  const S = () => JSON.parse(fs.readFileSync(state, 'utf8'));
  return { state, lab, env: e, cli, S };
}
// every file under a folder, as text (the pairing code must be in none)
const allText = (dir) => { if (!fs.existsSync(dir)) return ''; let s = ''; for (const f of fs.readdirSync(dir, { recursive: true })) { const p = path.join(dir, String(f)); if (fs.statSync(p).isFile()) s += fs.readFileSync(p, 'utf8'); } return s; };

// ---- pieces ----
await t('adb devices -l: USB, Wi-Fi (address and mDNS), unauthorized, offline, an emulator, no permissions', () => {
  const l = Dev.parseDevices(['List of devices attached', 'R58M123ABC             device usb:1-1 product:panther model:Pixel_7 device:panther transport_id:3', '192.168.1.23:41234     device product:panther model:Pixel_7 device:panther transport_id:4',
    'adb-R58M123ABC-AbCdEf._adb-tls-connect._tcp device product:panther model:Pixel_7 device:panther transport_id:5', 'ZY22ABC unauthorized usb:1-2 transport_id:6', 'emulator-5554          device product:sdk model:sdk transport_id:1',
    '0123456789ABCDEF       no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-3', 'ABCD offline', ''].join('\n'));
  eq(l.map((d) => [d.serial, d.state, d.link]), [['R58M123ABC', 'device', 'usb'], ['192.168.1.23:41234', 'device', 'wifi'], ['adb-R58M123ABC-AbCdEf._adb-tls-connect._tcp', 'device', 'wifi'], ['ZY22ABC', 'unauthorized', 'usb'], ['emulator-5554', 'device', 'emulator'], ['0123456789ABCDEF', 'no permissions', 'usb'], ['ABCD', 'offline', 'usb']]);
  eq(l[0].model, 'Pixel_7');
  eq(Dev.linkOf('[fe80::1]:5555'), 'wifi');
});
await t('networks: ip addr (no loopback, interface names cleaned), one network by the shorter prefix', () => {
  const a = Dev.parseAddrs(`${WLAN}\n5: rndis0    inet 192.168.42.129/24 brd 192.168.42.255 scope global rndis0\n7: eth0@if12    inet 172.17.0.2/16 scope global eth0`);
  eq(a, [{ iface: 'wlan0', ip: '192.168.1.23', prefix: 24 }, { iface: 'rndis0', ip: '192.168.42.129', prefix: 24 }, { iface: 'eth0', ip: '172.17.0.2', prefix: 16 }]);
  ok(Dev.sameNet({ ip: '192.168.1.23', prefix: 24 }, { ip: '192.168.1.10', prefix: 24 }), 'same /24');
  ok(!Dev.sameNet({ ip: '192.168.1.23', prefix: 24 }, { ip: '192.168.2.10', prefix: 24 }), 'other /24');
  ok(Dev.sameNet({ ip: '10.1.2.3', prefix: 16 }, { ip: '10.1.200.9', prefix: 24 }), 'the shorter prefix decides');
  ok(!Dev.sameNet({ ip: '10.0.0.1', prefix: 0 }, { ip: '10.0.0.2', prefix: 24 }), 'prefix 0: never');
  eq(Dev.parseMdns('List of discovered mdns services\nadb-R58M123ABC-AbCdEf\t_adb-tls-connect._tcp.\t192.168.1.23:37099\nadb-R58M123ABC-AbCdEf\t_adb-tls-pairing._tcp\t192.168.1.23:41001\n'),
    [{ name: 'adb-R58M123ABC-AbCdEf', type: '_adb-tls-connect._tcp', hostPort: '192.168.1.23:37099' }, { name: 'adb-R58M123ABC-AbCdEf', type: '_adb-tls-pairing._tcp', hostPort: '192.168.1.23:41001' }]);
});
await t('the way: root or not × USB or Wi-Fi, the shared network (Wi-Fi, tethering), what is missing and what to do', () => {
  const f = (o) => ({ serial: 'R58M123ABC', link: 'usb', abi: 'arm64-v8a', sdk: 34, root: null, game: { versionName: '1.26.52.04' }, addrs: Dev.parseAddrs(WLAN), ...o });
  let p = Dev.choosePath(f(), HOST_WIFI);
  eq([p.key, p.join, p.via, p.hostIp, p.control, p.logs, p.ok], ['noroot-usb', 'lan', 'wifi', '192.168.1.10', 'input', 'external', true]);
  p = Dev.choosePath(f(), [{ iface: 'eth0', ip: '10.0.0.5', prefix: 24 }]);
  ok(!p.ok && p.join === 'none' && /USB テザリング/.test(p.todo.join()) && /APP_TRANSPORT=raknet APP_HOST=/.test(p.todo.join()), JSON.stringify(p));
  // (the person's own way to the PC — Tailscale, a VPN: APP_TRANSPORT=raknet APP_HOST=<address>) → joined by address
  p = Dev.choosePath(f(), [{ iface: 'eth0', ip: '10.0.0.5', prefix: 24 }], { direct: '100.64.0.5' });
  eq([p.join, p.hostIp, p.ok], ['address', '100.64.0.5', true]); ok(/Microsoft にサインイン/.test(p.why.join()), p.why.join());
  p = Dev.choosePath(f({ addrs: Dev.parseAddrs('5: rndis0    inet 192.168.42.129/24 scope global rndis0') }), HOST_USB);
  eq([p.key, p.via, p.hostIp, p.ok], ['noroot-usb', 'tether', '192.168.42.100', true]);
  p = Dev.choosePath(f({ link: 'wifi', serial: '192.168.1.23:41234', root: 'su' }), HOST_WIFI);
  eq([p.key, p.control, p.logs, p.ok], ['root-wifi', 'pad', 'any', true]);
  ok(/su/.test(p.why.join()), 'su said');
  p = Dev.choosePath(f({ root: 'adb', abi: 'x86_64' }), HOST_WIFI);
  eq([p.key, p.control], ['root-usb', 'pad']);
  p = Dev.choosePath(f({ root: 'su', abi: 'armeabi-v7a' }), HOST_WIFI);
  ok(p.control === 'input' && /armeabi-v7a 用のコントローラーは作れません/.test(p.why.join()), 'an older CPU: the shell\'s input');
  p = Dev.choosePath(f({ game: null }), HOST_WIFI);
  ok(!p.ok && /Play ストア/.test(p.todo[0]), 'no game: Play first');
  p = Dev.choosePath(f({ link: 'wifi' }), [{ iface: 'eth0', ip: '172.20.1.2', prefix: 20 }], { wsl: true });
  ok(/WSL2/.test(p.todo[0]) && /mirrored/.test(p.todo[0]) && /ホットスポット/.test(p.todo.join()), 'WSL: mirrored first, then the network');
  p = Dev.choosePath(f({ link: 'wifi', sdk: 29 }), HOST_WIFI);
  ok(/adb tcpip/.test(p.why.join()), 'Android 10 over Wi-Fi');
  eq(Dev.choosePath({ link: 'emulator' }, HOST_WIFI).key, 'emulator');
});
await t('registry: names, one name per device, by name or serial, a new Wi-Fi port, forget', () => {
  const lab = path.join(tmp, 'reg');
  const facts = { serial: 'R58M123ABC', link: 'usb', hw: 'R58M123ABC', model: 'Pixel_7', android: '14' };
  for (const bad of ['', 'Phone', '-x', 'a'.repeat(33), 'emu', 'redroid', 'a b']) { let threw = false; try { Dev.addDevice(lab, bad, facts); } catch { threw = true; } ok(threw, `name ${JSON.stringify(bad)} refused`); }
  Dev.addDevice(lab, 'phone', facts);
  let threw = ''; try { Dev.addDevice(lab, 'phone2', facts); } catch (e) { threw = e.message; }
  ok(/phone として登録済み/.test(threw), threw);
  eq(Dev.resolve(lab, 'phone').serial, 'R58M123ABC'); eq(Dev.resolve(lab, 'R58M123ABC').name, 'phone'); eq(Dev.resolve(lab, 'nope'), null);
  eq(Dev.readFacts(lab, 'phone').hw, 'R58M123ABC');
  ok(Dev.rebind(lab, 'phone', '192.168.1.23:39999'), 'rebind');
  eq([Dev.resolve(lab, 'phone').serial, Dev.resolve(lab, 'phone').link], ['192.168.1.23:39999', 'wifi']);
  // values still to put back on that phone: not forgotten (they would go to the next phone of that name) unless forced
  Dev.holdDevice(fakeShell(SETTINGS).sh, lab, 'phone', { hw: 'R58M123ABC' });
  threw = ''; try { Dev.forgetDevice(lab, 'phone'); } catch (e) { threw = e.message; }
  ok(/まだ戻していません/.test(threw) && /--force/.test(threw) && Dev.resolve(lab, 'phone'), threw);
  ok(Dev.forgetDevice(lab, 'phone', { force: true }) && !fs.existsSync(path.join(lab, 'devices', 'phone.json')) && !Dev.resolve(lab, 'phone') && !Dev.pendingRestore(lab, 'phone'), 'forgotten with its facts and its values');
  ok(!Dev.forgetDevice(lab, 'phone'), 'twice: nothing');
});
// a device's settings in memory, the way `settings get/put/delete` answer
function fakeShell(start = {}) {
  const set = { ...start }, cmds = [];
  const sh = (c) => {
    cmds.push(c); let m;
    if ((m = /^settings get \w+ (\w+)$/.exec(c))) return { status: 0, out: `${set[m[1]] ?? 'null'}\n` };
    if ((m = /^settings put \w+ (\w+) (\S+)$/.exec(c))) { set[m[1]] = m[2]; return { status: 0, out: '' }; }
    if ((m = /^settings delete \w+ (\w+)$/.exec(c))) { delete set[m[1]]; return { status: 0, out: '' }; }
    if ((m = /^cmd notification set_dnd (\w+)$/.exec(c))) { set.zen_mode = m[1] === 'off' ? '0' : '1'; return { status: 0, out: '' }; }
    if (/dumpsys window/.test(c)) return { status: 0, out: 'mDreamingLockscreen=false\n' };
    return { status: 0, out: '' };
  };
  return { sh, set, cmds };
}
await t('held and put back: the screen on and quiet while used, every setting as it was (unset ones unset), a killed run put right first', () => {
  const lab = path.join(tmp, 'hold');
  const f = fakeShell(SETTINGS);
  const h = Dev.holdDevice(f.sh, lab, 'phone');
  eq(h.locked, false);
  eq([f.set.stay_on_while_plugged_in, f.set.screen_off_timeout, f.set.sysui_demo_allowed, f.set.zen_mode], ['7', '1800000', '1', '1']);
  ok(f.cmds.some((c) => /systemui\.demo -e command enter/.test(c)) && f.cmds.includes('input keyevent KEYCODE_WAKEUP'), 'demo mode, woken');
  ok(Dev.pendingRestore(lab, 'phone'), 'the values before are kept first');
  // a run killed here: the next hold puts them back before it holds again (the values kept are the person's, not the lab's)
  const f2 = fakeShell(f.set);
  Dev.holdDevice(f2.sh, lab, 'phone');
  const back = Dev.releaseDevice(f2.sh, lab, 'phone');
  eq({ ...f2.set }, SETTINGS, 'exactly as before (sysui_demo_allowed unset again)');
  ok(back.done.includes('dnd') && back.done.includes('demo') && !back.failed.length && !Dev.pendingRestore(lab, 'phone'), JSON.stringify(back));
  eq(back.done[0], 'demo', 'demo mode left first, while SystemUI still takes it');
  eq(Dev.releaseDevice(f2.sh, lab, 'phone'), { done: [], failed: [] }, 'nothing left to put back');
  // the person's own Do Not Disturb left alone; APP_DEVICE_QUIET=0 (quiet false): no demo mode, no DND
  const f3 = fakeShell({ ...SETTINGS, zen_mode: '2' });
  Dev.holdDevice(f3.sh, lab, 'p3'); eq(f3.set.zen_mode, '2'); Dev.releaseDevice(f3.sh, lab, 'p3'); eq(f3.set.zen_mode, '2');
  const f4 = fakeShell(SETTINGS);
  Dev.holdDevice(f4.sh, lab, 'p4', { quiet: false });
  ok(!f4.cmds.some((c) => /systemui\.demo|set_dnd|settings put global sysui_demo_allowed/.test(c)), f4.cmds.join(' | '));
  Dev.releaseDevice(f4.sh, lab, 'p4'); eq({ ...f4.set }, SETTINGS);
  // a value that does not read back plainly (an error, the device gone for a moment): left alone, never "restored" to that text
  const f5 = fakeShell(SETTINGS), sh5 = (c) => (/^settings get system screen_off_timeout$/.test(c) ? { status: 255, out: 'java.lang.SecurityException: nope' } : f5.sh(c));
  Dev.holdDevice(sh5, lab, 'p5');
  eq(f5.set.screen_off_timeout, '60000', 'not changed'); ok(!f5.cmds.some((c) => /settings put system screen_off_timeout/.test(c)), 'never put');
  Dev.releaseDevice(sh5, lab, 'p5'); ok(!f5.cmds.some((c) => /SecurityException/.test(c)), 'and never written back as text'); eq({ ...f5.set }, SETTINGS);
  ok(Dev.reaches(() => ({ out: '2 packets transmitted, 2 received, 0% packet loss' }), '1.2.3.4') && !Dev.reaches(() => ({ out: '2 packets transmitted, 0 received, 100% packet loss' }), '1.2.3.4'), 'ping');
  // an empty value (set to nothing) is not a plain value either: left alone
  const f6 = fakeShell({ ...SETTINGS, screen_off_timeout: '' });
  Dev.holdDevice(f6.sh, lab, 'p6');
  ok(!f6.cmds.some((c) => /settings put system screen_off_timeout/.test(c)) && f6.set.screen_off_timeout === '', 'empty: never changed');
  Dev.releaseDevice(f6.sh, lab, 'p6'); eq(f6.set.screen_off_timeout, '', 'and never deleted');
});
await t('put back when it fails: what failed stays for `device restore` (the rest is not done twice); another phone\'s values never applied; a hold refuses while the old values cannot go back', () => {
  const lab = path.join(tmp, 'release-fail');
  const f = fakeShell(SETTINGS);
  Dev.holdDevice(f.sh, lab, 'phone', { hw: 'R58M123ABC' });
  // the Wi-Fi link drops halfway: screen_off_timeout and DND do not go back
  const flaky = (c) => (/screen_off_timeout|set_dnd/.test(c) && !/^settings get/.test(c) ? { status: 1, out: 'error: closed' } : f.sh(c));
  let r = Dev.releaseDevice(flaky, lab, 'phone', { hw: 'R58M123ABC' });
  eq(r.failed, ['screen_off_timeout', 'dnd'], JSON.stringify(r));
  ok(r.done.includes('stay_on_while_plugged_in') && Dev.pendingRestore(lab, 'phone'), 'the rest done, the failed kept');
  const left = JSON.parse(fs.readFileSync(path.join(lab, 'devices', 'phone.restore.json'), 'utf8'));
  eq(left.settings.map((x) => x[1]), ['screen_off_timeout'], 'only what failed is kept');
  // a hold now must put those back first: still failing → it refuses, nothing is changed
  const before = f.cmds.length;
  let threw = ''; try { Dev.holdDevice(flaky, lab, 'phone', { hw: 'R58M123ABC' }); } catch (e) { threw = e.message; }
  ok(/戻せませんでした/.test(threw) && /device restore phone/.test(threw), threw);
  ok(!f.cmds.slice(before).some((c) => /^settings put global stay_on|KEYCODE_WAKEUP|command enter/.test(c)), 'not held again');
  // another phone answering at that address: nothing applied
  r = Dev.releaseDevice(f.sh, lab, 'phone', { hw: 'OTHER1' });
  ok(r.failed.length === 1 && /別の端末/.test(r.failed[0]) && !r.done.length && Dev.pendingRestore(lab, 'phone'), JSON.stringify(r));
  // the right phone again: all back, the file gone
  r = Dev.releaseDevice(f.sh, lab, 'phone', { hw: 'R58M123ABC' });
  ok(!r.failed.length && r.done.includes('screen_off_timeout') && r.done.includes('dnd') && !Dev.pendingRestore(lab, 'phone'), JSON.stringify(r));
  eq({ ...f.set }, SETTINGS, 'as before');
});
await t('logcat: the game\'s own error and warning lines (a device whose content log the lab cannot read)', () => {
  const lines = C.logcatClient('10-06 08:00:00.000  4242  4242 I MinecraftPE: starting\n10-06 08:00:01.000  4242  4250 E MinecraftPE: [UI][error]-ui/x.json | bad\n10-06 08:00:02.000  4242  4250 W MinecraftPE: [Json][warning]-y\n10-06 08:00:03.000   524   600 E ActivityManager: other\n');
  eq(lines.length, 2); ok(/\[UI\]\[error\]/.test(lines[0]), lines[0]);
});

// ---- the commands, end to end with the fake adb ----
await t('device list: what adb sees; nothing runs on a device that is not added', () => {
  const w = world('list', [phone(), stranger], { env: { FAKE_DEVICES_EMU: '1' } });
  const r = w.cli(['device']);
  ok(r.status === 0 && /登録した端末はありません/.test(r.text) && /R58M123ABC\s+device\s+USB/.test(r.text) && /XYZ999/.test(r.text) && /emulator-5554\s+device\s+エミュレータ/.test(r.text), r.text);
  eq(w.S().dev ?? [], [], 'not one command on any device');
});
await t('device add: which device (several → --serial), refusals (unauthorized, emulator, names, twice), the facts and the way', () => {
  const w = world('add', [phone(), stranger, { serial: 'ZY22ABC', state: 'unauthorized' }], { env: { FAKE_DEVICES_EMU: '1' } });
  let r = w.cli(['device', 'add', 'phone']);
  ok(r.status === 1 && /つながっている端末が 2 台あります/.test(r.text) && /--serial/.test(r.text), r.text);
  r = w.cli(['device', 'add', 'z', '--serial', 'ZY22ABC']); ok(r.status === 1 && /許可していません/.test(r.text), r.text);
  r = w.cli(['device', 'add', 'e', '--serial', 'emulator-5554']); ok(r.status === 1 && /エミュレータです/.test(r.text), r.text);
  r = w.cli(['device', 'add', 'Emu!', '--serial', 'R58M123ABC']); ok(r.status === 1 && /使えません/.test(r.text), r.text);
  r = w.cli(['device', 'add', 'phone', '--serial', 'R58M123ABC']);
  ok(r.status === 0 && /OK 登録しました: phone/.test(r.text) && /道: noroot-usb/.test(r.text) && /同じネットワーク/.test(r.text) && /app run -a <アドオン> --device phone/.test(r.text), r.text);
  const facts = JSON.parse(fs.readFileSync(path.join(w.lab, 'devices', 'phone.json'), 'utf8'));
  eq([facts.model, facts.android, facts.abi, facts.root, facts.game.versionName, facts.screen.w, facts.hw], ['Pixel_7', '14', 'arm64-v8a', null, '1.26.52.04', 1080, 'R58M123ABC']);
  r = w.cli(['device', 'add', 'phone', '--serial', 'R58M123ABC']); ok(r.status === 1 && /登録済み/.test(r.text), r.text);
  r = w.cli(['device', 'add', 'again', '--serial', 'R58M123ABC']); ok(r.status === 1 && /phone として登録済み/.test(r.text), r.text);
  ok(!(w.S().dev ?? []).some((c) => /^XYZ999 /.test(c)), 'the other device untouched');
  r = w.cli(['device', 'list']);
  ok(/phone\s+つながっています\s+Pixel_7 Android 14\s+USB R58M123ABC\s+ゲーム 1\.26\.52\.04/.test(r.text) && /XYZ999/.test(r.text), r.text);
  r = w.cli(['device', 'path', 'nope']); ok(r.status === 1 && /登録されていません/.test(r.text), r.text);
  r = w.cli(['device', 'forget', 'phone']); ok(r.status === 0 && !Dev.resolve(w.lab, 'phone'), r.text);
});
await t('device path: no shared network → what to do (exit 1); USB tethering from adb → the same network; refused by the device → the settings', () => {
  const tether = '9: ncm0    inet 192.168.42.129/24 brd 192.168.42.255 scope global ncm0';
  const w = world('path', [phone({ addrs: '1: lo    inet 127.0.0.1/8 scope host lo', tether })], { host: HOST_USB });
  ok(w.cli(['device', 'add', 'phone']).status === 0, 'added');
  let r = w.cli(['device', 'path', 'phone']);
  ok(r.status === 1 && /参加できる道がまだありません/.test(r.text) && /USB テザリング/.test(r.text), r.text);
  r = w.cli(['device', 'tether', 'phone']);
  ok(r.status === 0 && /USB テザリング: 端末の ncm0 192\.168\.42\.129\/24/.test(r.text), r.text);
  r = w.cli(['device', 'path', 'phone']);
  ok(r.status === 0 && /同じネットワーク（USB テザリング）/.test(r.text) && /ping が届きます/.test(r.text), r.text);
  eq(Dev.readFacts(w.lab, 'phone').usbBefore, 'mtp,adb', 'the USB function before, kept');
  r = w.cli(['device', 'tether', 'phone', 'off']); ok(r.status === 0 && /USB の働きを mtp に戻しました/.test(r.text), r.text);
  const n = world('notether', [phone({ addrs: '' })], { host: HOST_USB, env: { FAKE_NO_TETHER: '1' } });
  n.cli(['device', 'add', 'phone']);
  r = n.cli(['device', 'tether', 'phone']); ok(r.status === 1 && /端末の設定 → ネットワーク → テザリング/.test(r.text), r.text);
  r = world('noping', [phone()], { env: { FAKE_NO_PING: '1' } }).cli(['device', 'add', 'phone']);
  ok(r.status === 0, r.text);
});
await t('device pair: the code asked and used once (never in a file or the output), the connection found by mDNS; a wrong code says so; piped in too', () => {
  const CODE = '482916';
  const w = world('pair', [phone({ serial: '192.168.1.23:37099', wifi: '192.168.1.23:37099', hidden: true, mdns: '192.168.1.23:37099' })], { env: { FAKE_PAIR_CODE: CODE } });
  const ans = path.join(tmp, 'pair-answers.txt');
  fs.writeFileSync(ans, '111111\n');
  let r = w.cli(['device', 'pair', '192.168.1.23:41001'], { extra: { LAB_ASK_FILE: ans } });
  ok(r.status === 1 && /ペア設定できません/.test(r.text), r.text);
  fs.writeFileSync(ans, `${CODE}\n`);
  r = w.cli(['device', 'pair', '192.168.1.23:41001'], { extra: { LAB_ASK_FILE: ans } });
  ok(r.status === 0 && /OK ペア設定しました/.test(r.text) && /つながりました: 192\.168\.1\.23:37099/.test(r.text) && /device add <名前> --serial 192\.168\.1\.23:37099/.test(r.text) && /ワイヤレス デバッグ」を切って/.test(r.text), r.text);
  ok(!r.text.includes(CODE), 'the code is not printed');
  ok(!w.S().codeInArgv, 'the code went to adb on its standard input, not on its command line (no process list shows it)');
  fs.rmSync(ans);
  r = w.cli(['device', 'add', 'tab', '--serial', '192.168.1.23:37099']);
  ok(r.status === 0 && /道: noroot-wifi/.test(r.text), r.text);
  ok(!allText(w.lab).includes(CODE), 'the code is in no file the lab keeps');
  // piped (no terminal): the first line of stdin
  const p = world('pairpipe', [phone({ serial: '192.168.1.23:37099', wifi: '192.168.1.23:37099', hidden: true, mdns: '192.168.1.23:37099' })], { env: { FAKE_PAIR_CODE: CODE } });
  r = p.cli(['device', 'pair', '192.168.1.23:41001'], { input: `${CODE}\n` });
  ok(r.status === 0 && /OK ペア設定しました/.test(r.text), r.text);
  r = p.cli(['device', 'pair', '192.168.1.23:41001'], { input: '12ab\n' });
  ok(r.status === 1 && /6 桁/.test(r.text), r.text);
  // another phone's wireless debugging on the same network (connected, announced at its own IP) is never taken for this one
  const o = world('pairother', [phone({ serial: '192.168.1.23:37099', wifi: '192.168.1.23:37099', hidden: true }), { ...stranger, serial: 'adb-XYZ999-AbCdEf._adb-tls-connect._tcp', mdns: '192.168.1.50:40000' }], { env: { FAKE_PAIR_CODE: CODE } });
  r = o.cli(['device', 'pair', '192.168.1.23:41001'], { input: `${CODE}\n` });
  ok(r.status === 0 && /まだつながっていません/.test(r.text) && !/XYZ999/.test(r.text), r.text);
  ok(!(o.S().dev ?? []).some((c) => /XYZ999/.test(c)), 'nothing ran on the other phone');
});
await t('Wi-Fi again: a device back on another port is found by its own serial number (mDNS) and rebound; connect rebinds by serial number too', () => {
  const dev = phone({ serial: '192.168.1.23:39999', wifi: '192.168.1.23:39999', hidden: true, mdns: '192.168.1.23:39999', hw: 'WIFIHW1' });
  const w = world('rebind', [dev]);
  // added when it was on port 41234 (its facts: the serial number WIFIHW1)
  fs.mkdirSync(path.join(w.lab, 'devices'), { recursive: true });
  fs.writeFileSync(path.join(w.lab, 'devices.json'), JSON.stringify({ devices: { tab: { serial: '192.168.1.23:41234', model: 'Pixel_7', android: '14', link: 'wifi' } } }));
  fs.writeFileSync(path.join(w.lab, 'devices', 'tab.json'), JSON.stringify({ hw: 'WIFIHW1', serial: '192.168.1.23:41234' }));
  let r = w.cli(['device', 'path', 'tab']);
  ok(r.status === 0 && /tab は 192\.168\.1\.23:39999 でつながりました（前は 192\.168\.1\.23:41234）/.test(r.text), r.text);
  eq(Dev.resolve(w.lab, 'tab').serial, '192.168.1.23:39999');
  // connect by hand to its next port: the same device (by its serial number) is rebound
  const w2 = world('connect', [phone({ serial: '192.168.1.23:40001', wifi: '192.168.1.23:40001', hidden: true, hw: 'WIFIHW2' })]);
  fs.mkdirSync(path.join(w2.lab, 'devices'), { recursive: true });
  fs.writeFileSync(path.join(w2.lab, 'devices.json'), JSON.stringify({ devices: { tab: { serial: '192.168.1.23:41234', link: 'wifi' } } }));
  fs.writeFileSync(path.join(w2.lab, 'devices', 'tab.json'), JSON.stringify({ hw: 'WIFIHW2' }));
  r = w2.cli(['device', 'connect', '192.168.1.23:40001']);
  ok(r.status === 0 && /tab を 192\.168\.1\.23:40001 につなぎ替えました/.test(r.text), r.text);
  eq((w2.S().dev ?? []).filter((c) => c.startsWith('192.168.1.23:40001 ')), ['192.168.1.23:40001 shell getprop ro.serialno'], 'connect reads its serial number, nothing more');
  // a device adb already knew on USB, now only over USB again (its Wi-Fi gone): found by its serial number and rebound
  const u = world('backusb', [phone()]);
  fs.mkdirSync(path.join(u.lab, 'devices'), { recursive: true });
  fs.writeFileSync(path.join(u.lab, 'devices.json'), JSON.stringify({ devices: { tab: { serial: '192.168.1.23:5555', link: 'wifi' } } }));
  fs.writeFileSync(path.join(u.lab, 'devices', 'tab.json'), JSON.stringify({ hw: 'R58M123ABC' }));
  r = u.cli(['device', 'path', 'tab']);
  ok(r.status === 0 && /tab は R58M123ABC でつながりました（前は 192\.168\.1\.23:5555）/.test(r.text), r.text);
  eq(Dev.resolve(u.lab, 'tab').link, 'usb');
  r = world('connfail', [phone()], { env: { FAKE_CONNECT_FAIL: '1' } }).cli(['device', 'connect', '192.168.1.99:5555']);
  ok(r.status === 1 && /つながりません/.test(r.text) && /device pair/.test(r.text), r.text);
  // gone for good: said, with the way back
  const g = world('gone', [stranger]);
  fs.mkdirSync(g.lab, { recursive: true });
  fs.writeFileSync(path.join(g.lab, 'devices.json'), JSON.stringify({ devices: { tab: { serial: '192.168.1.23:41234', link: 'wifi' } } }));
  r = g.cli(['device', 'path', 'tab']);
  ok(r.status === 1 && /見つかりません/.test(r.text) && /ワイヤレス デバッグ/.test(r.text), r.text);
});
await t('device tcpip (Android 10 and older): over USB to Wi-Fi 5555, the device rebound; not for a Wi-Fi device', () => {
  const w = world('tcpip', [phone({ android: '10', sdk: 29, wifi: '192.168.1.23:5555' })]);
  ok(w.cli(['device', 'add', 'old']).status === 0, 'added');
  let r = w.cli(['device', 'tcpip', 'old']);
  ok(r.status === 0 && /Wi-Fi（192\.168\.1\.23:5555）で使います/.test(r.text) && w.S().tcpip?.R58M123ABC === '5555', r.text);
  eq(Dev.resolve(w.lab, 'old').serial, '192.168.1.23:5555');
  r = w.cli(['device', 'tcpip', 'old']); ok(r.status === 1 && /USB でつながっていません/.test(r.text), r.text);
  r = w.cli(['device', 'restore', 'old', '--wifi-off']);
  ok(r.status === 0 && /USB に戻しました/.test(r.text), r.text);
  eq(Dev.resolve(w.lab, 'old').serial, 'R58M123ABC', 'looked for on USB again');
  r = w.cli(['device', 'list']);
  ok(/old\s+つながっています .* USB R58M123ABC/.test(r.text) && !/192\.168\.1\.23:5555/.test(r.text), r.text);
  // the mobile network only (no Wi-Fi): adbd is not switched to TCP at all
  const c = world('tcpipcell', [phone({ android: '10', sdk: 29, addrs: '1: lo    inet 127.0.0.1/8 scope host lo\n4: rmnet_data0    inet 10.120.5.6/30 scope global rmnet_data0' })]);
  ok(c.cli(['device', 'add', 'old']).status === 0, 'added');
  r = c.cli(['device', 'tcpip', 'old']);
  ok(r.status === 1 && /Wi-Fi のアドレスがありません/.test(r.text) && !c.S().tcpip, r.text);
});

await t('screen / tap --device <name>: the person\'s device (the emulator otherwise); not there or not added: said', () => {
  const w = world('screen', [phone()]);
  ok(w.cli(['device', 'add', 'phone']).status === 0, 'added');
  let r = w.cli(['screen', 'devtest-shot', '--device', 'phone']);
  const shot = path.join(TOP, 'app', '.lab', 'devtest-shot.png'), grid = path.join(TOP, 'app', '.lab', 'devtest-shot-grid.png');
  ok(r.status === 0 && fs.existsSync(shot) && fs.existsSync(grid), r.text);
  fs.rmSync(shot, { force: true }); fs.rmSync(grid, { force: true });
  r = w.cli(['tap', '0.5', '0.5', '--device', 'phone']);
  ok(r.status === 0 && /\(32, 18\) を押しました/.test(r.text) && w.S().dev.some((c) => c === 'R58M123ABC shell input tap 32 18'), r.text);
  r = w.cli(['key', 'BACK', '--device', 'nosuch']);
  ok(r.status === 1 && /--device nosuch は使えません/.test(r.text), r.text);
  const g = world('screengone', [stranger]);
  fs.mkdirSync(g.lab, { recursive: true });
  fs.writeFileSync(path.join(g.lab, 'devices.json'), JSON.stringify({ devices: { phone: { serial: 'R58M123ABC', link: 'usb' } } }));
  r = g.cli(['tap', '0.5', '0.5', '--device', 'phone']);
  ok(r.status === 1 && /つながっていません/.test(r.text), r.text);
});

// ---- app run on a person's device ----
const RELAY_STUB = path.join(tmp, 'lab-relay-stub'); fs.writeFileSync(RELAY_STUB, 'stub');
const PAD_STUB = path.join(tmp, 'lab-pad-stub'); fs.writeFileSync(PAD_STUB, 'stub');
const RUN_ENV = { APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'), APP_TIME_SCALE: '0.2', APP_STABLE_MS: '100', APP_PAD_WAIT_MS: '50', APP_TESSERACT: path.join(tmp, 'no-tesseract'), APP_RELAY_BIN: RELAY_STUB, APP_PAD_BIN: PAD_STUB, APP_UNLOCK_MS: '3000' };
const made = [];
function runOn(w, args = [], extra = {}) {
  const r = w.cli(['run', '-a', 'jsonui_demo', '--device', 'phone', ...args], { extra: { ...RUN_ENV, ...extra } });
  const runDir = /→ (app\/runs\/\S+)/.exec(r.text)?.[1];
  if (runDir) made.push(path.join(TOP, runDir));
  return { ...r, runDir: runDir && path.join(TOP, runDir) };
}
await t('run --device (no root, USB, the same Wi-Fi): PASS; no APK, no root, no relay, no app stopped; long presses; the settings and the game as they were', () => {
  const w = world('run', [phone(), stranger]);
  ok(w.cli(['device', 'add', 'phone', '--serial', 'R58M123ABC']).status === 0, 'added');
  const r = runOn(w);
  ok(r.status === 0 && /PASS app\/runs\/.*report\.md/.test(r.text), r.text);
  const S = w.S(), mine = (S.dev ?? []).filter((c) => c.startsWith('R58M123ABC '));
  ok(!S.calls.some((c) => /^install|pm disable-user|^push .*lab-(pad|relay)|^root$/.test(c)) && !mine.some((c) => / root$| tcpip /.test(c)), `nothing installed, stopped, pushed or rooted:\n${S.calls.filter((c) => /install|disable|push|root/.test(c)).join('\n')}`);
  ok(!(S.dev ?? []).some((c) => /^XYZ999 /.test(c)), 'the other device untouched');
  ok(S.longPresses >= 1 && !S.padUp, `buttons as long presses (${S.longPresses})`);
  eq(S.devSettings.R58M123ABC, SETTINGS, 'the settings as they were');
  eq(S.demo.R58M123ABC.at(0), 'enter'); eq(S.demo.R58M123ABC.at(-1), 'exit');
  ok(S.calls.includes('shell am force-stop com.mojang.minecraftpe') && !S.launched, 'the game stopped: the run started it');
  ok(!Dev.pendingRestore(w.lab, 'phone'), 'nothing left to put back');
  const rep = fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8'), run = fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8');
  ok(/\| 端末 \| Pixel_7（Google）Android 14 \(arm64-v8a\)・phone・USB・root なし \|/.test(rep) && /\| 道 \| noroot-usb: 同じネットワーク（Wi-Fi、PC 192\.168\.1\.10）/.test(rep) && /読んだ場所: logcat/.test(rep), rep.slice(0, 1200));
  ok(/操作: adb の入力（キーとタップ。ボタンは長押し）/.test(run) && /端末の設定を元に戻しました/.test(run) && !/エミュレータ/.test(run.split('\n').slice(0, 12).join('\n')), run.slice(0, 1500));
});
await t('run --device (su root, Wi-Fi): the controller started through su and taken away after; content logs through a copy; adb root never asked', () => {
  const w = world('runsu', [phone({ serial: '192.168.1.23:37099', root: 'su' })]);
  ok(w.cli(['device', 'add', 'phone']).status === 0, 'added');
  const r = runOn(w);
  ok(r.status === 0, r.text);
  const S = w.S(), mine = S.dev.filter((c) => c.startsWith('192.168.1.23:37099 '));
  ok(mine.some((c) => /shell su -c 'umask 000; chmod 755 \/data\/local\/tmp\/lab-pad; setsid nohup \/data\/local\/tmp\/lab-pad /.test(c)), mine.filter((c) => /lab-pad/.test(c)).join('\n'));
  ok(S.viaPad >= 1 && !S.longPresses, 'pressed through the controller');
  ok(mine.some((c) => /su -c 'umask 000; pkill -x lab-relay 2>\/dev\/null; pkill -x lab-pad/.test(c)) && S.cleared?.includes('R58M123ABC'), 'the controller gone after');
  ok(mine.some((c) => /su -c 'umask 000; rm -rf \/data\/local\/tmp\/lab-logs; cp -r \/data\/data\/com\.mojang/.test(c)), 'the private content logs through a copy');
  ok(!mine.some((c) => / root$/.test(c)) && !S.calls.includes('root'), 'adb root never asked');
  ok(/root-wifi/.test(fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8')) && /ワイヤレス デバッグ」を切って/.test(r.text), r.text.slice(-600));
});
await t('run --device: refusals before anything starts (unknown name, emulator flags, steps that change a phone, ui --sizes), and no way yet', () => {
  const w = world('refuse', [phone()]);
  ok(w.cli(['device', 'add', 'phone']).status === 0, 'added');
  let r = w.cli(['run', '-a', 'jsonui_demo', '--device', 'nosuch'], { extra: RUN_ENV });
  ok(r.status === 1 && /--device nosuch は使えません/.test(r.text) && /登録した端末の名前（phone）/.test(r.text), r.text);
  r = w.cli(['run', '-a', 'jsonui_demo', '--device', 'phone', '--wipe', '--account'], { extra: RUN_ENV });
  ok(r.status === 1 && /本物の端末（phone）では使いません: --wipe --account/.test(r.text), r.text);
  const sc = path.join(tmp, 'shape.txt'); fs.writeFileSync(sc, 'launch\nsize 1024x768\ncutout tall\n');
  r = w.cli(['run', '-a', 'jsonui_demo', '--device', 'phone', '--scenario', sc], { extra: RUN_ENV });
  ok(r.status === 1 && /2 行目 size、3 行目 cutout/.test(r.text), r.text);
  r = w.cli(['ui', '-a', 'jsonui_demo', '--device', 'phone', '--sizes', '1024x768'], { extra: RUN_ENV });
  ok(r.status === 1 && /画面の形を変えません/.test(r.text), r.text);
  eq(w.S().devSettings, undefined, 'nothing changed on the device');
  // no shared network: stops at the device with what to do, before the BDS and before holding anything
  const n = world('noway', [phone({ addrs: '' })]);
  ok(n.cli(['device', 'add', 'phone']).status === 0, 'added');
  r = runOn(n);
  ok(r.status === 1 && /端末 phone ではまだ参加できません（noroot-usb）/.test(r.text) && /USB テザリング/.test(r.text) && !/\[3\/5\]/.test(r.text), r.text);
  eq(n.S().devSettings, undefined, 'nothing held');
});
await t('run --device: a lock screen waited for (the person unlocks), one that stays locked stops the run with the settings put back', () => {
  const w = world('lock', [phone({ locked: 3 })]);
  ok(w.cli(['device', 'add', 'phone']).status === 0, 'added');
  let r = runOn(w);
  ok(r.status === 0 && /ロックを解除してください/.test(r.text), r.text);
  const z = world('locked', [phone({ locked: 9999 })]);
  ok(z.cli(['device', 'add', 'phone']).status === 0, 'added');
  r = runOn(z);
  ok(r.status === 1 && /ロックされたままです/.test(r.text), r.text);
  eq(z.S().devSettings.R58M123ABC, SETTINGS, 'put back after the stop');
});
await t('a run killed outright leaves the values before: list warns, restore puts them back (and takes the lab\'s files away)', async () => {
  const w = world('killed', [phone()]);
  ok(w.cli(['device', 'add', 'phone']).status === 0, 'added');
  const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'run', '-a', 'jsonui_demo', '--device', 'phone', '-v'], { cwd: TOP, env: { ...w.env, ...RUN_ENV, APP_TIME_SCALE: '1' } });
  let text = ''; c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
  for (let k = 0; k < 300 && !/画面を点けたまま/.test(text); k++) await new Promise((res) => setTimeout(res, 100));
  c.kill('SIGKILL');
  await new Promise((res) => c.on('exit', res));
  { const d = /→ (app\/runs\/\S+)/.exec(text)?.[1]; if (d) made.push(path.join(TOP, d)); }
  ok(/画面を点けたまま/.test(text), text);
  ok(Dev.pendingRestore(w.lab, 'phone') && w.S().devSettings.R58M123ABC.stay_on_while_plugged_in === '7', 'held, not put back');
  let r = w.cli(['device', 'list']);
  ok(/設定を戻していません/.test(r.text), r.text);
  // forgetting it now would lose the values: refused (--force: the values go too — a phone that is gone for good)
  r = w.cli(['device', 'forget', 'phone']);
  ok(r.status === 1 && /まだ戻していません/.test(r.text) && Dev.resolve(w.lab, 'phone'), r.text);
  // another phone at its serial: nothing is put on it
  const other = world('killedother', [phone({ hw: 'NOTTHIS1' })]);
  fs.mkdirSync(path.join(other.lab, 'devices'), { recursive: true });
  fs.copyFileSync(path.join(w.lab, 'devices.json'), path.join(other.lab, 'devices.json'));
  for (const f of ['phone.json', 'phone.restore.json']) fs.copyFileSync(path.join(w.lab, 'devices', f), path.join(other.lab, 'devices', f));
  r = other.cli(['device', 'restore', 'phone']);
  ok(r.status === 1 && /phone ではありません/.test(r.text), r.text);
  eq((other.S().dev ?? []).filter((c) => !/ (devices|get-state)|getprop ro\.serialno$/.test(c)), [], 'only its serial number read');
  r = w.cli(['device', 'restore', 'phone']);
  ok(r.status === 0 && /OK 戻しました: demo、stay_on_while_plugged_in/.test(r.text), r.text);
  eq(w.S().devSettings.R58M123ABC, SETTINGS);
  ok(!Dev.pendingRestore(w.lab, 'phone'), 'done');
  try { fs.rmSync(path.join(TOP, 'app', '.lab', 'run.lock'), { force: true }); } catch { /* not ours */ }
  spawnSync(process.execPath, [path.join(FAKE, 'bdslab.mjs'), 'down'], { cwd: TOP, env: { ...w.env, ...RUN_ENV } });
});

await t('run --device: the content log as it was before the run is an earlier session\'s (its errors are not this run\'s)', () => {
  const w = world('stalelog', [phone()]);
  ok(w.cli(['device', 'add', 'phone']).status === 0, 'added');
  const clog = path.join(tmp, 'stale-ContentLog.txt');
  fs.writeFileSync(clog, '[2026-10-01 09:00:00:000 ERROR] [UI] old_screen.json | from yesterday\n');
  const r = runOn(w, [], { FAKE_CONTENT_LOG: clog });
  ok(r.status === 0 && /PASS app\/runs\//.test(r.text), r.text.slice(-2500));
  ok(!/from yesterday/.test(fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8')), 'not in the report');
});
await t('run --device (AOSP su: only `su 0 <command>`): the form found when added is the one used', () => {
  const w = world('runsu0', [phone({ root: 'su0' })]);
  ok(w.cli(['device', 'add', 'phone']).status === 0, 'added');
  eq([Dev.readFacts(w.lab, 'phone').root, Dev.readFacts(w.lab, 'phone').su], ['su', '0']);
  const r = runOn(w);
  ok(r.status === 0, r.text.slice(-2000));
  const mine = w.S().dev.filter((c) => c.startsWith('R58M123ABC '));
  ok(mine.some((c) => /shell su 0 sh -c 'umask 000; chmod 755 \/data\/local\/tmp\/lab-pad; setsid nohup /.test(c)) && !mine.some((c) => /shell su -c '/.test(c)), mine.filter((c) => /\bsu\b/.test(c)).join('\n'));
  ok(w.S().viaPad >= 1 && w.S().cleared?.includes('R58M123ABC'), 'the controller used and taken away');
});

// ---- the lab's controller and relay for a phone's CPU ----
await t('lab-uinput.h: every value lab-pad uses equals the kernel\'s <linux/uinput.h> (when this machine has a C compiler)', () => {
  if (spawnSync('cc', ['--version']).status !== 0 || !fs.existsSync('/usr/include/linux/uinput.h')) { console.log('     (no cc or kernel headers here: skipped)'); return; }
  const prog = (inc) => `#include <stdio.h>\n${inc}\nint main(void){printf("%zu %zu %zu %zu %lu %lu %lu %lu %lu %lu %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d %d\\n",sizeof(struct input_event),sizeof(struct uinput_setup),sizeof(struct uinput_abs_setup),sizeof(struct input_absinfo),(unsigned long)UI_DEV_CREATE,(unsigned long)UI_DEV_SETUP,(unsigned long)UI_ABS_SETUP,(unsigned long)UI_SET_EVBIT,(unsigned long)UI_SET_KEYBIT,(unsigned long)UI_SET_ABSBIT,EV_SYN,EV_KEY,EV_ABS,SYN_REPORT,BTN_A,BTN_B,BTN_X,BTN_Y,BTN_TL,BTN_TR,BTN_SELECT,BTN_START,BTN_MODE,BTN_THUMBL,BTN_THUMBR,ABS_X,ABS_Y,ABS_Z,ABS_RX,ABS_RY,ABS_RZ,ABS_HAT0X,ABS_HAT0Y,BUS_USB);return 0;}\n`;
  const outOf = (name, inc) => { const c = path.join(tmp, `${name}.c`), b = path.join(tmp, name); fs.writeFileSync(c, prog(inc)); const r = spawnSync('cc', ['-o', b, c], { encoding: 'utf8' }); ok(r.status === 0, r.stderr); return spawnSync(b, [], { encoding: 'utf8' }).stdout; };
  const kernel = outOf('uref', '#include <linux/uinput.h>'), own = outOf('uown', `#include "${D.PAD_HDR}"`);
  eq(own, kernel);
});
await t('the controller and the relay built for an arm64 phone (NDK, zig, a cross gcc; the controller also with clang + ld.lld), and run when qemu is here', () => {
  const list = D.deviceCompilers('arm64-v8a');
  console.log(`     compilers for arm64: ${list.map((c) => c.name).join(', ') || 'none'}`);
  const lab = path.join(tmp, 'build-arm64');
  const pad = D.padBinary(lab, { abi: 'arm64-v8a' }), relay = D.relayBinary(lab, { abi: 'arm64-v8a' });
  if (!list.length) { ok(typeof pad === 'object' && /NDK/.test(pad.error) && /zig/.test(pad.error), JSON.stringify(pad)); return; }
  ok(typeof pad === 'string', JSON.stringify(pad));
  const elf = fs.readFileSync(pad);
  eq([elf.subarray(0, 4).toString('latin1'), elf[4], elf.readUInt16LE(18)], ['\x7fELF', 2, 183], 'a 64-bit ELF for AArch64 (machine 183)');
  ok(fs.statSync(pad).size < 64 * 1024, `small: ${fs.statSync(pad).size}`);
  eq(D.padBinary(lab, { abi: 'arm64-v8a' }), pad, 'built once');
  if (list.some((c) => c.libc)) ok(typeof relay === 'string' && fs.readFileSync(relay).readUInt16LE(18) === 183, JSON.stringify(relay));
  else ok(typeof relay === 'object' && /NDK/.test(relay.error), 'the relay needs a C library: said what to install');
  const q = spawnSync('qemu-aarch64-static', ['--version']).status === 0 ? 'qemu-aarch64-static' : spawnSync('qemu-aarch64', ['--version']).status === 0 ? 'qemu-aarch64' : null;
  if (!q) { console.log('     (no qemu-aarch64 here: built, not run)'); return; }
  let r = spawnSync(q, [pad], { encoding: 'utf8' });
  ok(r.status === 2 && /usage: lab-pad <fifo>/.test(r.stdout), `${r.status} ${r.stdout}`);
  r = spawnSync(q, [pad, path.join(tmp, 'fifo')], { encoding: 'utf8' });
  ok(r.status === 1 && /\/dev\/uinput/.test(r.stdout), `${r.status} ${r.stdout}`);
  if (typeof relay === 'string') { r = spawnSync(q, [relay], { encoding: 'utf8' }); ok(r.status === 2 && /usage:/.test(r.stderr), `${r.status} ${r.stderr}`); }
  // an older CPU: said plainly
  ok(/x86_64 と arm64-v8a だけ/.test(D.padBinary(lab, { abi: 'armeabi-v7a' }).error), 'armeabi-v7a');
});

for (const d of made) fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? 'FAIL' : 'OK'} device-offline: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
