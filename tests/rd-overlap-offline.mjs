// app redroid debug with app run at once (app/redroid/ready.mjs): app run gets its BDS up while the device boots, and waits
// for the device's word in APP_DEVICE_READY_FILE. Without docker, binder or a device: the ready file written late or with a
// failure by the test itself, then `node app/redroid/game.mjs debug` whole against a fake docker / adb (sh scripts first on
// PATH, made here) and the fake adb + bds lab of tests/fake/app for the app run it starts.
// node tests/rd-overlap-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const RD = await imp('app/redroid/ready.mjs');
const K = await imp('app/lib/apk.mjs');
const { crc32 } = await imp('bedrock-binary/src/apk/zip.js');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}\n     ${e.stack?.split('\n')[1] ?? ''}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-overlap-'));

// ---- a fake APK set (as tests/app-offline.mjs makes it: a base with the version, a split with the game's .so) ----
function buildZip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, data, method = 8 } of entries) {
    const nb = Buffer.from(name), body = method === 8 ? zlib.deflateRawSync(data) : data, crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, body);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nb); offset += 30 + nb.length + body.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
const chunk = (type, hs, body) => { const h = Buffer.alloc(8); h.writeUInt16LE(type, 0); h.writeUInt16LE(hs, 2); h.writeUInt32LE(8 + body.length, 4); return Buffer.concat([h, body]); };
function stringPool(strings) {
  const offs = [], data = []; let pos = 0;
  for (const s of strings) { offs.push(pos); const b = Buffer.from(s); const e = Buffer.concat([Buffer.from([s.length, b.length]), b, Buffer.from([0])]); data.push(e); pos += e.length; }
  let body = Buffer.concat(data); if (body.length % 4) body = Buffer.concat([body, Buffer.alloc(4 - (body.length % 4))]);
  const hdr = Buffer.alloc(20); hdr.writeUInt32LE(strings.length, 0); hdr.writeUInt32LE(0x100, 8); hdr.writeUInt32LE(28 + strings.length * 4, 12);
  const o = Buffer.alloc(strings.length * 4); offs.forEach((x, i) => o.writeUInt32LE(x, i * 4));
  return chunk(0x0001, 28, Buffer.concat([hdr, o, body]));
}
function buildManifest({ pkg, versionCode, versionName, split }) {
  const strings = ['versionCode', 'versionName', 'package', 'split', 'manifest', pkg, versionName ?? '', split ?? ''];
  const resMap = Buffer.alloc(8); resMap.writeUInt32LE(0x0101021b, 0); resMap.writeUInt32LE(0x0101021c, 4);
  const attrs = [];
  const attr = (name, raw, type, data) => { const a = Buffer.alloc(20); a.writeUInt32LE(0xffffffff, 0); a.writeUInt32LE(name, 4); a.writeUInt32LE(raw, 8); a.writeUInt16LE(8, 12); a[15] = type; a.writeUInt32LE(data >>> 0, 16); attrs.push(a); };
  attr(2, 5, 0x03, 5);
  if (versionCode !== undefined) attr(0, 0xffffffff, 0x10, versionCode);
  if (versionName !== undefined) attr(1, 6, 0x03, 6);
  if (split !== undefined) attr(3, 7, 0x03, 7);
  const node = Buffer.alloc(8); node.writeUInt32LE(1, 0); node.writeUInt32LE(0xffffffff, 4);
  const ext = Buffer.alloc(20); ext.writeUInt32LE(0xffffffff, 0); ext.writeUInt32LE(4, 4); ext.writeUInt16LE(20, 8); ext.writeUInt16LE(20, 10); ext.writeUInt16LE(attrs.length, 12);
  return chunk(0x0003, 8, Buffer.concat([stringPool(strings), chunk(0x0180, 8, resMap), chunk(0x0102, 16, Buffer.concat([node, ext, ...attrs]))]));
}
const VC = 912605203;
// (the device's own copies: what the fake adb's pull hands out)
const DEVICE_APKS = path.join(tmp, 'device-apks');
fs.mkdirSync(DEVICE_APKS, { recursive: true });
fs.writeFileSync(path.join(DEVICE_APKS, 'base.apk'), buildZip([{ name: 'AndroidManifest.xml', data: buildManifest({ pkg: K.PACKAGE, versionCode: VC, versionName: '1.26.52.03' }) }]));
fs.writeFileSync(path.join(DEVICE_APKS, 'split_config.arm64_v8a.apk'), buildZip([
  { name: 'AndroidManifest.xml', data: buildManifest({ pkg: K.PACKAGE, versionCode: VC, split: 'config.arm64_v8a' }) },
  { name: 'lib/arm64-v8a/libminecraftpe.so', data: Buffer.from('\x7fELF fake'), method: 0 },
]));
/** the APKs "pulled last time" into dir, with the version kept beside them */
const lastPull = (dir, version = String(VC)) => { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); for (const f of fs.readdirSync(DEVICE_APKS)) fs.copyFileSync(path.join(DEVICE_APKS, f), path.join(dir, f)); fs.writeFileSync(path.join(dir, '.version'), version + '\n'); };

// ---- pieces ----
await t('parseReady: only a whole word with ok true/false counts (pure)', () => {
  eq(RD.parseReady('{"serial":"127.0.0.1:5600","ok":true,"why":""}'), { ok: true, serial: '127.0.0.1:5600', why: '' });
  eq(RD.parseReady('{"ok":false,"why":"redroid が起きません"}'), { ok: false, serial: '', why: 'redroid が起きません' });
  eq([RD.parseReady(''), RD.parseReady('{"serial":"x"'), RD.parseReady('{"serial":"x"}'), RD.parseReady('null')], [null, null, null, null]);
});
await t('writeReady / waitReady: written late → seen; the time up or the writer gone → not ok with why', async () => {
  const f = path.join(tmp, 'w', 'ready.json');
  setTimeout(() => RD.writeReady(f, { serial: 's', ok: true }), 300);
  const r = await RD.waitReady(f, { timeoutMs: 5000, every: 50 });
  ok(r.ok && r.serial === 's' && r.ms >= 250, JSON.stringify(r));
  ok(!fs.readdirSync(path.dirname(f)).some((x) => x.endsWith('.tmp')), 'no half-written file left');
  const late = await RD.waitReady(path.join(tmp, 'none.json'), { timeoutMs: 200, every: 50 });
  ok(!late.ok && /APP_DEVICE_READY_MS/.test(late.why), JSON.stringify(late));
  const gone = await RD.waitReady(path.join(tmp, 'none.json'), { timeoutMs: 5000, every: 50, gone: () => true });
  ok(!gone.ok && /app redroid debug/.test(gone.why), JSON.stringify(gone));
});
await t('lastApks: the APKs with their kept version; none without .version or without APKs', () => {
  const d = path.join(tmp, 'last');
  eq(RD.lastApks(d), null);
  lastPull(d);
  eq(RD.lastApks(d), { files: ['base.apk', 'split_config.arm64_v8a.apk'], version: String(VC) });
  fs.rmSync(path.join(d, '.version')); eq(RD.lastApks(d), null);
});

// ---- app run with APP_DEVICE_READY_FILE (tests/fake/app: a fake adb whose device is off until the test powers it) ----
const FAKE = path.join(TOP, 'tests', 'fake', 'app');
for (const f of ['adb', 'tesseract', 'avdmanager']) fs.chmodSync(path.join(FAKE, f), 0o755);
const RELAY_STUB = path.join(tmp, 'lab-relay-stub'); fs.writeFileSync(RELAY_STUB, 'stub');
const PAD_STUB = path.join(tmp, 'lab-pad-stub'); fs.writeFileSync(PAD_STUB, 'stub');
function appEnv(name, extra = {}) {
  const state = path.join(tmp, `${name}.json`), sdk = path.join(tmp, `sdk-${name}`);
  fs.writeFileSync(state, JSON.stringify({ phase: 'home' }));
  fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', 'x86_64'), { recursive: true });
  const env = { ...process.env, FAKE_APP_STATE: state, FAKE_EMU_POWER: '1', APP_ADB: path.join(FAKE, 'adb'), APP_EMULATOR: path.join(FAKE, 'adb'), APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk,
    APP_STABLE_MS: '100', APP_ADBKEY_DIR: path.join(tmp, 'adbkey'), APP_RELAY_BIN: RELAY_STUB, APP_PAD_BIN: PAD_STUB, APP_PAD_WAIT_MS: '50', APP_TIME_SCALE: '0.2', APP_TESSERACT: path.join(tmp, 'no-tesseract'), ...extra };
  for (const k of Object.keys(env)) if (/^GOOGLE_|^MS_|^GITHUB_/.test(k) || k === 'APP_DEVICE') delete env[k];
  return { env, state, S: () => JSON.parse(fs.readFileSync(state, 'utf8')) };
}
function start(bin, args, env) {
  const c = spawn(bin, args, { cwd: TOP, env });
  let text = ''; c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
  return { c, text: () => text, done: new Promise((res) => c.on('exit', (code) => res(code))) };
}
async function until(what, f, ms = 60_000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return; await sleep(100); } throw new Error(`${what}: ${ms / 1000} 秒で来ません`); }
const bdsUp = (S) => (S.bds ?? []).some((l) => /^up\b/.test(l));
const runs = [];
const runDirOf = (text) => { const m = /→ (app\/runs\/\S+)/.exec(text); return m ? path.join(TOP, m[1]) : null; };

await t('app run: the BDS up while the device is not, the device untouched until its word; then the run on it → PASS', async () => {
  const apk = path.join(tmp, 'apk-a'); lastPull(apk);
  const ready = path.join(tmp, 'ready-a.json');
  const { env, state, S } = appEnv('late', { APP_DEVICE_READY_FILE: ready, APP_SERIAL: '127.0.0.1:5600', APP_LIVE_DEVICE: '1', APP_APK_DIR: apk, APP_SHOT: 'adb', APP_SNAPSHOT: '0' });
  const r = start(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'run', '-a', 'jsonui_demo', '--no-fetch'], env);
  await until('BDS の up', () => bdsUp(S()));
  await sleep(1500);
  const before = S();
  ok(!before.calls?.length, `nothing asked of the device before its word: ${JSON.stringify(before.calls)}`);
  ok(r.c.exitCode === null && /端末の準備を待っています/.test(r.text()), `waiting for the device:\n${r.text()}`);
  // the device "booted" and the game's side ready: the word
  fs.writeFileSync(`${state}.power`, 'on');
  RD.writeReady(ready, { serial: '127.0.0.1:5600', ok: true });
  const code = await r.done; runs.push(runDirOf(r.text()));
  ok(code === 0 && /^PASS /m.test(r.text()) && /端末の準備ができました/.test(r.text()), `exit ${code}\n${r.text()}`);
  ok(!S().calls.some((c) => /^-avd/.test(c)) && !/エミュレータを起動します/.test(r.text()), 'no emulator started');
});

await t('app run: the device\'s word says it failed → the BDS stopped, the reason said, exit 1', async () => {
  const apk = path.join(tmp, 'apk-b'); lastPull(apk);
  const ready = path.join(tmp, 'ready-b.json');
  const { env, S } = appEnv('fail', { APP_DEVICE_READY_FILE: ready, APP_SERIAL: '127.0.0.1:5600', APP_LIVE_DEVICE: '1', APP_APK_DIR: apk, APP_SHOT: 'adb', APP_SNAPSHOT: '0' });
  const r = start(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'run', '-a', 'jsonui_demo', '--no-fetch'], env);
  await until('BDS の up', () => bdsUp(S()));
  RD.writeReady(ready, { serial: '127.0.0.1:5600', ok: false, why: 'redroid が起きません（テスト）' });
  const code = await r.done; runs.push(runDirOf(r.text()));
  ok(code === 1 && /端末の準備に失敗しました: redroid が起きません（テスト）/.test(r.text()) && /^FAIL /m.test(r.text()), `exit ${code}\n${r.text()}`);
  const b = S().bds;
  ok(/^down\b/.test(b.at(-1)) && b.findIndex((l) => /^up\b/.test(l)) < b.length - 1, `the BDS stopped last: ${JSON.stringify(b)}`);
  ok(!(S().calls ?? []).some((c) => /^-avd/.test(c)), 'no emulator started');
});

await t('app run: no APKs pulled yet → the device first (they come from it), then the BDS', async () => {
  const apk = path.join(tmp, 'apk-c'), ready = path.join(tmp, 'ready-c.json');
  const { env, state, S } = appEnv('noapk', { APP_DEVICE_READY_FILE: ready, APP_SERIAL: '127.0.0.1:5600', APP_LIVE_DEVICE: '1', APP_APK_DIR: apk, APP_SHOT: 'adb', APP_SNAPSHOT: '0' });
  const r = start(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'run', '-a', 'jsonui_demo', '--no-fetch'], env);
  await until('待ち', () => /端末の準備を待っています/.test(r.text()));
  await sleep(1000);
  ok(!bdsUp(S()), 'no BDS before the APKs are there');
  lastPull(apk); fs.writeFileSync(`${state}.power`, 'on');
  RD.writeReady(ready, { serial: '127.0.0.1:5600', ok: true });
  const code = await r.done; runs.push(runDirOf(r.text()));
  ok(code === 0 && /^PASS /m.test(r.text()), `exit ${code}\n${r.text()}`);
});

// ---- game.mjs debug whole: a fake docker / adb (sh, first on PATH) for the device, the app run it starts against
// tests/fake/app. The fake device's boot ends once the BDS is up (or after ~20 s): whether the BDS was already up then is
// what it writes down ----
const BIN = path.join(tmp, 'bin');
fs.mkdirSync(BIN, { recursive: true });
const shFile = (name, body) => { fs.writeFileSync(path.join(BIN, name), `#!/bin/sh\n${body}`); fs.chmodSync(path.join(BIN, name), 0o755); };
shFile('docker', `echo "docker $*" >> "$FAKE_RD/calls"
case "$1" in
  inspect) exit 1;;
  network) echo 172.17.0.1;;
  run) if [ -n "$FAKE_RUN_FAIL" ]; then i=0; while [ $i -lt 200 ] && ! grep -q '"up ' "$FAKE_APP_STATE"; do sleep 0.1; i=$((i+1)); done; echo "binder がありません" >&2; exit 1; fi; echo cid;;
esac
exit 0
`);
shFile('adb', `echo "adb $*" >> "$FAKE_RD/calls"
[ "$1" = "-s" ] && shift 2
case "$1" in
  connect) echo "connected to $2"; exit 0;;
  get-state) echo device; exit 0;;
  pull) cp "$FAKE_DEVICE_APKS/$(basename "$2")" "$3"; exit $?;;
  shell) shift;;
  *) exit 0;;
esac
line="$*"
case "$line" in
  "getprop sys.boot_completed")
    if [ -f "$FAKE_RD/booted" ]; then echo 1; exit 0; fi
    n=$(cat "$FAKE_RD/polls" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$FAKE_RD/polls"
    if grep -q '"up ' "$FAKE_APP_STATE" 2>/dev/null; then echo yes > "$FAKE_RD/bds-before-boot"; elif [ $n -lt 80 ]; then exit 0; else echo no > "$FAKE_RD/bds-before-boot"; fi
    touch "$FAKE_RD/booted"; printf on > "$FAKE_APP_STATE.power"; echo 1;;
  "id -u") echo 0;;
  "pidof com.mojang.minecraftpe") echo 4242;;
  "cmd package resolve-activity"*) echo "com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity";;
  "am start"*) echo "Status: ok";;
  "dumpsys window displays | grep mCurrentFocus=") if [ -n "$FAKE_PAYWALL" ]; then echo "  mCurrentFocus=Window{9 u0 com.android.vending/com.google.android.finsky.activities.MainActivity}"; else echo "  mCurrentFocus=Window{9 u0 com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity}"; fi;;
  "dumpsys package com.mojang.minecraftpe") echo "    versionCode=${VC} minSdk=26 targetSdk=34";;
  "pm path com.mojang.minecraftpe") echo "package:/data/app/x/base.apk"; echo "package:/data/app/x/split_config.arm64_v8a.apk";;
esac
exit 0
`);
for (const c of ['mount', 'umount', 'tcpdump']) shFile(c, `echo "${c} $*" >> "$FAKE_RD/calls"\nexit 0\n`);
shFile('sudo', '[ "$1" = "-n" ] && shift\nexec "$@"\n');

function debugRun(name, { args = [], extra = {}, apkVersion = String(VC) } = {}) {
  const rd = path.join(tmp, `rd-${name}`), data = path.join(rd, 'data');
  fs.mkdirSync(data, { recursive: true });
  if (apkVersion) lastPull(path.join(rd, 'apk'), apkVersion);
  const { env, S } = appEnv(`debug-${name}`, { FAKE_RD: rd, FAKE_DEVICE_APKS: DEVICE_APKS, PATH: `${BIN}:${process.env.PATH}`, ...extra });
  delete env.ADB;
  const r = spawnSync(process.execPath, [path.join(TOP, 'app', 'redroid', 'game.mjs'), 'debug', '--data', data, ...args, '--', '--no-fetch'], { cwd: TOP, env, encoding: 'utf8', timeout: 240_000 });
  const text = r.stdout + r.stderr;
  for (const m of text.matchAll(/→ (app\/runs\/\S+)/g)) runs.push(path.join(TOP, m[1]));
  const calls = fs.existsSync(path.join(rd, 'calls')) ? fs.readFileSync(path.join(rd, 'calls'), 'utf8').trim().split('\n') : [];
  const before = fs.existsSync(path.join(rd, 'bds-before-boot')) ? fs.readFileSync(path.join(rd, 'bds-before-boot'), 'utf8').trim() : null;
  return { status: r.status, text, S: S(), calls, before, rd };
}
const afterRun = (calls) => calls.slice(calls.findIndex((c) => /^docker run /.test(c)) + 1);

await t('debug: app run starts at once — the BDS up before the device has booted; the device ready → PASS, then stopped', () => {
  const r = debugRun('ok');
  ok(r.status === 0 && /app run を redroid で: PASS/.test(r.text) && /^PASS /m.test(r.text), `exit ${r.status}\n${r.text}`);
  eq(r.before, 'yes', 'the BDS was up when the device finished booting');
  ok(/前回取り出した版 912605203/.test(r.text) && /端末の準備より [\d.]+ 秒先に開始/.test(r.text), r.text);
  ok(!r.calls.some((c) => /^adb .*pull /.test(c)), 'the same version as last time: nothing pulled');
  ok(afterRun(r.calls).some((c) => /^docker rm -f/.test(c)) && r.calls.some((c) => /^umount /.test(c)), `the device stopped after: ${r.calls.join(' | ')}`);
  ok(/^down\b/.test(r.S.bds.at(-1)), JSON.stringify(r.S.bds));
});

await t('debug: the device does not start (docker run fails after the BDS is up) → app run stops its BDS, the reason said, exit 1', () => {
  const r = debugRun('fail', { extra: { FAKE_RUN_FAIL: '1' } });
  ok(r.status === 1 && /E redroid が起きません（docker run）: binder がありません/.test(r.text), `exit ${r.status}\n${r.text}`);
  ok(/端末の準備に失敗しました: redroid が起きません/.test(r.text) && /^FAIL /m.test(r.text), r.text);
  ok(r.S.bds.some((l) => /^up\b/.test(l)) && /^down\b/.test(r.S.bds.at(-1)), `the BDS was up, then stopped: ${JSON.stringify(r.S.bds)}`);
});

await t('debug: the game stops at Play\'s paywall → app run ends with the reason, the device stopped; --keep leaves it up', () => {
  const r = debugRun('paywall', { extra: { FAKE_PAYWALL: '1' } });
  ok(r.status === 1 && /ゲームがタイトルまで起動しません（ライセンス: no/.test(r.text) && /端末の準備に失敗しました: ゲームがタイトルまで/.test(r.text), `exit ${r.status}\n${r.text}`);
  ok(/^down\b/.test(r.S.bds.at(-1)), JSON.stringify(r.S.bds));
  ok(afterRun(r.calls).some((c) => /^docker rm -f/.test(c)), `stopped: ${r.calls.join(' | ')}`);
  const k = debugRun('paywall-keep', { args: ['--keep'], extra: { FAKE_PAYWALL: '1' } });
  ok(k.status === 1 && /端末の準備に失敗しました/.test(k.text), `exit ${k.status}\n${k.text}`);
  ok(!afterRun(k.calls).some((c) => /^docker rm/.test(c)), `--keep: the device left up: ${k.calls.join(' | ')}`);
  ok(/^down\b/.test(k.S.bds.at(-1)), 'the BDS stopped all the same: ' + JSON.stringify(k.S.bds));
});

await t('debug: the device has another version than the APKs pulled last time → pulled again, the first run told, app run again → PASS', () => {
  const r = debugRun('newver', { apkVersion: '1' });
  ok(r.status === 0 && /APK の版が変わりました（1 → 912605203）/.test(r.text) && /app run を redroid で: PASS/.test(r.text), `exit ${r.status}\n${r.text}`);
  ok(r.calls.filter((c) => /^adb .*pull /.test(c)).length === 2, 'base + split pulled');
  eq(fs.readFileSync(path.join(r.rd, 'apk', '.version'), 'utf8').trim(), String(VC));
  ok((r.text.match(/^(PASS|FAIL)(?= app\/runs)/mg) ?? []).join(',') === 'FAIL,PASS', 'the first run ends on the word, the second passes');
});

await t('debug: no APKs pulled yet → app run waits for the device first, pulled from it → PASS', () => {
  const r = debugRun('first', { apkVersion: null });
  ok(r.status === 0 && /まだ無いので端末から取り出してから/.test(r.text) && /app run を redroid で: PASS/.test(r.text), `exit ${r.status}\n${r.text}`);
  eq(r.before, 'no', 'nothing to start the BDS with before the device');
});

for (const d of runs.filter(Boolean)) fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
