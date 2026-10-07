#!/usr/bin/env node
// app/redroid: waiting for the device's boot (redroid.mjs up/down/restore/bootArgs + wait.mjs) with a fake docker and a
// fake adb first on PATH (no binder here: redroid itself cannot run). adb's `shell` runs the line for real in sh with a
// fake getprop / pm / dumpsys, so the loops on the device are the ones up() sends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(100); } return f(); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-boot-'));
const bin = path.join(tmp, 'bin'), dev = path.join(tmp, 'dev'), st = path.join(tmp, 'state'), log = path.join(tmp, 'log.txt');
for (const d of [bin, dev, st]) fs.mkdirSync(d, { recursive: true });
const put = (dir, f, body) => { fs.writeFileSync(path.join(dir, f), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(dir, f), 0o755); };
const count = (f) => `c=$(cat "$S/${f}" 2>/dev/null || echo 0); c=$((c+1)); echo $c > "$S/${f}"`;
// docker: containers are files in $S/c/<name>; rm sleeps FAKE_RM_SLEEP (a large container's layer)
put(bin, 'docker', `S=${st}; mkdir -p "$S/c"; echo "docker $*" >> ${log}
case "$1" in
  run) for a; do [ "$p" = --name ] && n=$a; p=$a; done; [ -e "$S/c/$n" ] && { echo "Conflict. The container name \\"/$n\\" is already in use" >&2; exit 125; }; echo "$*" > "$S/c/$n"; echo 0123abcd;;
  kill) [ -e "$S/c/$2" ] || { echo "Error response from daemon: No such container: $2" >&2; exit 1; }; echo "$2";;
  rename) [ -e "$S/c/$2" ] && mv "$S/c/$2" "$S/c/$3";;
  rm) shift; [ "$1" = -f ] && shift; e=0; for n; do [ -e "$S/c/$n" ] || { echo "Error: No such container: $n" >&2; e=1; continue; }; sleep \${FAKE_RM_SLEEP:-0}; rm -f "$S/c/$n"; echo "docker rm done $n" >> ${log}; done; exit $e;;
  ps) for a; do case "$a" in name=*) re=\${a#name=}; re=\${re#^/?};; esac; done; ls "$S/c" | grep -E "^$re";;
  inspect) for n; do :; done; [ -e "$S/c/$n" ] || { echo "Error: No such object: $n" >&2; exit 1; }; tr ' ' '\\n' < "$S/c/$n" | sed -n 's/^bdslab\\.from=//p';;
  logs) echo 'init: boot stuck (fake)';;
esac`);
// adb: connect fails FAKE_CONNECT_FAILS times (adbd not up yet), then connects; shell runs the line with the device's tools
put(bin, 'adb', `S=${st}; echo "adb $*" >> ${log}
[ "$1" = -s ] && shift 2
case "$1" in
  connect) ${count('connects')}; if [ $c -le \${FAKE_CONNECT_FAILS:-0} ]; then echo "failed to connect to '$2': Connection refused"; else echo "connected to $2"; fi;;
  disconnect) echo "disconnected $2";;
  wait-for-device) ${count('wfds')}; [ $c -le \${FAKE_WFD_HANG:-0} ] && exec sleep 30; exit 0;;
  shell) shift; PATH=${dev}:$PATH exec sh -c "$*";;
esac`);
// the device: boot_completed after FAKE_BOOT_AFTER getprops (never when 0), a launcher in focus
put(dev, 'getprop', `S=${st}; ${count('getprops')}; [ "\${FAKE_BOOT_AFTER:-1}" != 0 ] && [ $c -ge \${FAKE_BOOT_AFTER:-1} ] && echo 1 || echo 0`);
put(dev, 'pm', 'echo package:/system/framework/framework-res.apk');
put(dev, 'dumpsys', "echo '  mCurrentFocus=Window{1 u0 com.android.launcher3/com.android.launcher3.uioverride.QuickstepLauncher}'");
// root's tools for restore(): mount / umount faked (nothing mounted here), sudo as itself
put(bin, 'mount', `echo "mount $*" >> ${log}`);
put(bin, 'umount', `echo "umount $*" >> ${log}; exit 32`);
put(bin, 'sudo', '[ "$1" = -n ] && shift; exec "$@"');
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.ADB = path.join(bin, 'adb');
delete process.env.REDROID_PROFILE; delete process.env.REDROID_SIZE; delete process.env.REDROID_FPS; delete process.env.REDROID_ARGS;
const reset = (env = {}) => {
  fs.writeFileSync(log, ''); for (const f of ['connects', 'getprops', 'wfds']) fs.rmSync(path.join(st, f), { force: true });
  for (const k of ['FAKE_CONNECT_FAILS', 'FAKE_BOOT_AFTER', 'FAKE_RM_SLEEP', 'FAKE_WFD_HANG']) delete process.env[k];
  Object.assign(process.env, env);
};
const lines = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
const R = await import(pathToFileURL(path.join(TOP, 'app', 'redroid', 'redroid.mjs')).href);
const W = await import(pathToFileURL(path.join(TOP, 'app', 'redroid', 'wait.mjs')).href);

// ---- rmFlags: --one-file-system (a run folder's removal never crosses into a mount) on Linux; BSD's rm has no such option ----
ok(W.rmFlags('linux') === '-rf --one-file-system' && W.rmFlags('darwin') === '-rf' && W.rmFlags() === W.rmFlags(process.platform), 'rmFlags: --one-file-system on Linux only (BSD rm lacks it)', `${W.rmFlags('linux')} | ${W.rmFlags('darwin')}`);

// ---- bootArgs: unchanged by default; REDROID_PROFILE=fast smaller and slower; REDROID_SIZE / REDROID_FPS still win ----
const BEFORE = ['androidboot.redroid_gpu_mode=guest', 'androidboot.redroid_width=1560', 'androidboot.redroid_height=720', 'androidboot.redroid_dpi=280',
  'androidboot.redroid_fps=20', 'androidboot.use_memfd=1', 'ro.setupwizard.mode=DISABLED', 'debug.sf.nobootanimation=1', 'ro.hw_timeout_multiplier=5', 'service.adb.root=1',
  // (added when the lanes were brought together: no background dexopt right after a boot — prep's ask)
  'pm.dexopt.disable_bg_dexopt=true'];
ok(JSON.stringify(R.bootArgs({})) === JSON.stringify(BEFORE) && JSON.stringify(R.bootArgs({ REDROID_PROFILE: 'nope' })) === JSON.stringify(BEFORE), 'bootArgs: no profile (or an unknown one) = exactly as before', R.bootArgs({}).join(' '));
const fast = R.bootArgs({ REDROID_PROFILE: 'fast' }), num = (a, k) => Number(a.find((x) => x.startsWith(`androidboot.redroid_${k}=`))?.split('=')[1]);
ok(num(fast, 'width') < 1560 && num(fast, 'height') < 720 && num(fast, 'fps') < 20 && Math.abs(num(fast, 'width') / num(fast, 'height') - 1560 / 720) < 0.01 && fast.includes('ro.setupwizard.mode=DISABLED'),
  'bootArgs: REDROID_PROFILE=fast = a smaller screen of the same shape and fewer frames', fast.join(' '));
const over = R.bootArgs({ REDROID_PROFILE: 'fast', REDROID_SIZE: '1280x720@240', REDROID_FPS: '30' });
ok(num(over, 'width') === 1280 && num(over, 'dpi') === 240 && num(over, 'fps') === 30, 'bootArgs: REDROID_SIZE / REDROID_FPS win over the profile', over.join(' '));

// ---- the pure helpers ----
ok(JSON.stringify(W.stages({ run: 300, adb: 1300, boot: 9800, ready: 12000 })) === JSON.stringify({ run: 300, adb: 1000, boot: 8500, ready: 2200 }) && JSON.stringify(W.stages({ run: 250.4, boot: 9 })) === JSON.stringify({ run: 250 }),
  'stages: each stage on its own in ms, only the ones reached in order');
const an = W.asideName('bdslab-redroid', 5, 7);
ok(an.startsWith('bdslab-redroid') && an !== 'bdslab-redroid' && an !== W.asideName('bdslab-redroid', 6, 7), 'asideName: under the lab prefix, never the name itself, different each time', an);
ok(/\$\(getprop sys\.boot_completed\)/.test(W.bootLoop(10)) && /-ge 50 /.test(W.bootLoop(10)) && /pm path android/.test(W.readyLoop(10)) && /mCurrentFocus/.test(W.readyLoop(10)), 'bootLoop / readyLoop: one device-side loop each, bounded by the time left');

// ---- up(): adb connect until adbd takes it, then wait-for-device, then one shell for the boot and one for the launcher ----
reset({ FAKE_CONNECT_FAILS: '2', FAKE_BOOT_AFTER: '6' });
let t = Date.now(), m = await R.up({ data: path.join(tmp, 'data'), image: 'img:t', name: 'bdslab-redroid-t', port: 5699, timeoutMs: 30_000 });
let L = lines(), shells = L.filter((l) => / shell /.test(l));
ok(['runS', 'adbS', 'bootS', 'readyS'].every((k) => typeof m[k] === 'number') && m.runS <= m.adbS && m.adbS <= m.bootS && m.bootS <= m.readyS, 'up: {runS, adbS, bootS, readyS} as before, in order', JSON.stringify(m));
ok(m.ms && ['run', 'adb', 'boot', 'ready'].every((k) => Number.isInteger(m.ms[k]) && m.ms[k] >= 0) && m.ms.boot >= 800, 'up: ms per stage (the boot took the device 6 getprops ≈ 1 s)', JSON.stringify(m.ms));
ok(L.filter((l) => / connect /.test(l)).length === 3 && L.filter((l) => /wait-for-device/.test(l)).length === 1 && shells.length === 2 && !L.some((l) => /get-state|shell getprop/.test(l)),
  'up: 3 connects (2 refused), 1 wait-for-device, 2 shells — not a connect + getprop every 250 ms', L.join('\n'));
ok(/-ge 100 /.test(shells[0]) && /-ge 40 /.test(shells[1]) && /timeout: Math\.max\(1000, Math\.min\(ADB_WAIT_MS/.test(fs.readFileSync(path.join(TOP, 'app', 'redroid', 'redroid.mjs'), 'utf8')) && W.ADB_WAIT_MS === 3000 && W.SLICE_MS === 20_000,
  'up: each device-side loop a 20 s slice even with 30 s left; wait-for-device at most 3 s', shells.join('\n'));
ok(L.findIndex((l) => /^docker kill bdslab-redroid-t$/.test(l)) < L.findIndex((l) => /^docker run /.test(l)) && /--name bdslab-redroid-t/.test(L.find((l) => /^docker run /.test(l))), 'up: the old one stopped (kill) before docker run');

// untilBoot: stops at boot_completed (no launcher shell)
reset({ FAKE_BOOT_AFTER: '1' });
fs.rmSync(path.join(st, 'c', 'bdslab-redroid-t'), { force: true });
m = await R.up({ name: 'bdslab-redroid-t', port: 5699, timeoutMs: 30_000, untilBoot: true });
ok(m.bootS != null && m.readyS == null && JSON.stringify(Object.keys(m.ms)) === JSON.stringify(['run', 'adb', 'boot']) && lines().filter((l) => / shell /.test(l)).length === 1, 'up untilBoot: boot only, one shell', JSON.stringify(m));

// connect says "connected" but the transport is offline (docker-proxy before adbd): wait-for-device given up after 3 s,
// the transport dropped, and connect again at once (no 1 s pause, not 15 s)
reset({ FAKE_WFD_HANG: '1', FAKE_BOOT_AFTER: '1' });
fs.rmSync(path.join(st, 'c', 'bdslab-redroid-t'), { force: true });
m = await R.up({ name: 'bdslab-redroid-t', port: 5699, timeoutMs: 30_000, untilBoot: true });
L = lines();
const wfd = L.map((l, i) => /wait-for-device/.test(l) ? i : -1).filter((i) => i >= 0);
ok(m.bootS != null && wfd.length === 2 && /^adb disconnect /.test(L[wfd[0] + 1]) && /^adb connect /.test(L[wfd[0] + 2]) && m.adbS >= 2.9 && m.adbS < 3.9,
  `up: a hung wait-for-device → given up at 3 s, disconnect, connect again at once (adb at ${m.adbS} s)`, L.join('\n'));

// the device-side loops are sliced (sliceMs) and run again until the time is out; SIGTERM's handler runs between slices
reset({ FAKE_BOOT_AFTER: '0' });
fs.rmSync(path.join(st, 'c', 'bdslab-redroid-t'), { force: true });
let termAt = null; const onTerm = () => { termAt = Date.now(); };
process.on('SIGTERM', onTerm); setTimeout(() => process.kill(process.pid, 'SIGTERM'), 300);
t = Date.now();
try { await R.up({ name: 'bdslab-redroid-t', port: 5699, timeoutMs: 4000, sliceMs: 1000 }); } catch { /* never boots */ }
const end = Date.now(); process.off('SIGTERM', onTerm);
shells = lines().filter((l) => / shell /.test(l));
const geN = shells.map((l) => Number(/-ge (\d+) /.exec(l)?.[1]));
ok(geN.filter((x) => x === 5).length >= 3 && geN.every((x) => x >= 1 && x <= 5) && end - t >= 3500, `up: boot waited for in 1 s slices (the last ones cut to the time left) until the time is out (${shells.length} slices, ${end - t} ms)`, shells.join('\n'));
ok(termAt != null && termAt - t < 2600 && end - termAt > 1000, `up: SIGTERM handled between slices, not after the whole wait (${termAt == null ? 'never' : termAt - t} ms of ${end - t})`);

// never boots: an error within the timeout, with what was reached and the container's log
reset({ FAKE_BOOT_AFTER: '0' });
t = Date.now();
let err = null; try { await R.up({ name: 'bdslab-redroid-t', port: 5699, timeoutMs: 3000 }); } catch (e) { err = e; }
ok(err && /3 秒で起動し終わりません/.test(err.message) && /adbS/.test(err.message) && /boot stuck/.test(err.message) && Date.now() - t < 15_000, 'up: a boot that never completes → the error at the timeout (adb reached, the log)', err?.message ?? 'no error');

// ---- down(): kill, then rm; wait: false = the rm in the background under another name ----
reset({ FAKE_RM_SLEEP: '2' });
const live = path.join(st, 'c', 'bdslab-redroid-t');
fs.writeFileSync(live, 'x');
t = Date.now(); R.down({ name: 'bdslab-redroid-t', port: 5699, quiet: true });
L = lines();
ok(Date.now() - t >= 1900 && L.findIndex((l) => /^docker kill /.test(l)) < L.findIndex((l) => /^docker rm -f bdslab-redroid-t$/.test(l)) && !fs.existsSync(live), 'down: docker kill, then docker rm (waited for)', L.join('\n'));
reset({ FAKE_RM_SLEEP: '2' });
fs.writeFileSync(live, 'x');
t = Date.now(); R.down({ name: 'bdslab-redroid-t', port: 5699, quiet: true, wait: false });
const took = Date.now() - t, aside = fs.readdirSync(path.join(st, 'c')).find((f) => f.startsWith('bdslab-redroid-t-old-'));
ok(took < 1500 && !fs.existsSync(live) && aside, `down wait:false: back at once (${took} ms), the name free, the old one renamed (${aside})`, lines().join('\n'));
m = await R.up({ name: 'bdslab-redroid-t', port: 5699, timeoutMs: 30_000, untilBoot: true });
ok(m.bootS != null, 'down wait:false: the next up() under the same name starts while the old rm still runs');
ok(await until(() => !fs.readdirSync(path.join(st, 'c')).some((f) => f.includes('-old-'))) && lines().some((l) => /docker rm done bdslab-redroid-t-old-/.test(l)), 'down wait:false: the old one removed in the background');
reset();
R.down({ name: 'bdslab-redroid-none', port: 5699, quiet: true });
ok(!lines().some((l) => /^docker rm -f bdslab-redroid-none/.test(l)) && !lines().some((l) => /^umount /.test(l)), 'down: no such container → no rm, no umount');

// down(): the overlay of the device's own prepared folder (label bdslab.from) unmounted after the kill, before the rm
reset();
fs.rmSync(path.join(st, 'c', 'bdslab-redroid-t'), { force: true });
const prepA = path.join(tmp, 'prepA');
await R.up({ data: path.join(prepA + '.run', 'merged'), from: prepA, name: 'bdslab-redroid-t', port: 5699, timeoutMs: 30_000, untilBoot: true });
reset();
R.down({ name: 'bdslab-redroid-t', port: 5699, quiet: true });
L = lines();
const um = L.findIndex((l) => l === `umount ${prepA}.run/merged`);
ok(um > L.findIndex((l) => /^docker kill bdslab-redroid-t$/.test(l)) && um < L.findIndex((l) => /^docker rm -f bdslab-redroid-t$/.test(l)) && !fs.existsSync(path.join(st, 'c', 'bdslab-redroid-t')),
  'down: the overlay from the label (bdslab.from + .run/merged) unmounted before the rm; a failed umount does not stop it', L.join('\n'));

// down(): containers an earlier rm left (<name>-old-…) removed in the background; other names left alone
reset({ FAKE_RM_SLEEP: '2' });
for (const f of ['bdslab-redroid-t-old-1-1', 'bdslab-redroid-t-old-2-2', 'bdslab-redroid-tx-old-1', 'other-old-1']) fs.writeFileSync(path.join(st, 'c', f), 'x');
t = Date.now(); R.down({ name: 'bdslab-redroid-t', port: 5699, quiet: true });
const sweepTook = Date.now() - t;
ok(sweepTook < 1500 && await until(() => !fs.readdirSync(path.join(st, 'c')).some((f) => f.startsWith('bdslab-redroid-t-old-'))) && ['bdslab-redroid-tx-old-1', 'other-old-1'].every((f) => fs.existsSync(path.join(st, 'c', f))),
  `down: leftover <name>-old-* containers removed in the background (back in ${sweepTook} ms), others kept`, `${fs.readdirSync(path.join(st, 'c')).join(' ')}\n${lines().join('\n')}`);
for (const f of ['bdslab-redroid-tx-old-1', 'other-old-1']) fs.rmSync(path.join(st, 'c', f), { force: true });

// ---- restore(overlay): the old container and the last run's folder out of the way at once, removed in the background ----
reset({ FAKE_RM_SLEEP: '2' });
const src = path.join(tmp, 'data'), work = path.join(tmp, 'data.run');
fs.mkdirSync(src, { recursive: true }); fs.mkdirSync(path.join(work, 'upper', 'deep'), { recursive: true }); fs.writeFileSync(path.join(work, 'upper', 'deep', 'big'), 'x'.repeat(1000));
fs.writeFileSync(path.join(st, 'c', 'bdslab-redroid'), 'x');
const stale = path.join(tmp, 'data.run.old-1-1'); fs.mkdirSync(path.join(stale, 'deep'), { recursive: true });
t = Date.now(); const r = R.restore(src, 'overlay', work);
L = lines();
ok(Date.now() - t < 1500 && r.data === path.join(work, 'merged') && fs.existsSync(path.join(work, 'upper')) && !fs.existsSync(path.join(work, 'upper', 'deep')) && L.some((l) => /^mount -t overlay overlay -o lowerdir=/.test(l)),
  `restore overlay: a fresh run folder at once (${Date.now() - t} ms), the old container's rm not waited for`, L.join('\n'));
ok(await until(() => !fs.readdirSync(tmp).some((f) => f.startsWith('data.run.old-')) && !fs.readdirSync(path.join(st, 'c')).some((f) => f.startsWith('bdslab-redroid-old-') || f === 'bdslab-redroid')), 'restore overlay: the old folder and the old container removed in the background', `${fs.readdirSync(tmp).join(' ')} / ${fs.readdirSync(path.join(st, 'c')).join(' ')}`);
ok(!fs.existsSync(stale), 'restore: a run folder an earlier rm left (<work>.old-*) removed too');
const staleD = path.join(tmp, 'direct.run.old-5-5'); fs.mkdirSync(path.join(staleD, 'x'), { recursive: true });
const d = R.restore(path.join(tmp, 'direct'), 'direct', path.join(tmp, 'direct.run'));
ok(d.data === path.join(tmp, 'direct') && d.ms === 0, 'restore direct: as before');
ok(await until(() => !fs.existsSync(staleD)) && fs.existsSync(path.join(tmp, 'direct')), 'restore direct: leftover <work>.old-* removed in the background at the start');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `FAIL rd-boot-offline ${n - fails}/${n}` : `PASS rd-boot-offline ${n}/${n}`);
process.exit(fails ? 1 : 0);
