// app lab without a network, an emulator or a real APK: the pieces (scenario, APK reading, apkeep handling, BDS version
// choice, guard) and `node lab.mjs app run` end to end against a fake adb and a fake bds lab (tests/fake/app).
// node tests/app-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const K = await imp('app/lib/apk.mjs');
const S = await imp('app/lib/scenario.mjs');
const R = await imp('app/lib/report.mjs');
const { QUIET_APPS } = await imp('app/lib/android.mjs');
const WARM = await imp('app/lib/warm.mjs');
const { crc32 } = await imp('bedrock-binary/src/apk/zip.js');
const { pngEncode, pngDecode } = await imp('common/extra.mjs');

let pass = 0, fail = 0;
// APP_TEST_ONLY=<regex>: only the tests whose name matches (the rest are not run, not counted)
const only = process.env.APP_TEST_ONLY ? new RegExp(process.env.APP_TEST_ONLY) : null;
const t = async (name, fn) => { if (only && !only.test(name)) return; try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}\n     ${e.stack?.split('\n')[1] ?? ''}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-offline-'));
// no OCR unless a test asks for the fake one: a tesseract installed on this machine would read the fake screens (garbage
// words like "Wf") and steer the joins that the tests drive by the gamepad alone
if (!process.env.APP_TESSERACT_REAL) process.env.APP_TESSERACT = path.join(tmp, 'no-tesseract');
// the fake device answers at once: the lab's fixed pauses (made for a real emulator) a fifth as long — the suite in half the time
process.env.APP_TIME_SCALE ??= '0.2';
fs.writeFileSync(path.join(tmp, 'joinonly.txt'), 'launch\njoin\nuntil joined 5000\nshot world\n');


// ---- a fake APK set (the AndroidManifest builder is bedrock-binary's test/helpers-android.js) ----
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
function buildManifest({ pkg, versionCode, versionName, split, perms = [] }) {
  const strings = ['versionCode', 'versionName', 'package', 'split', 'manifest', pkg, versionName ?? '', split ?? '', 'uses-permission', 'name', ...perms];
  const resMap = Buffer.alloc(8); resMap.writeUInt32LE(0x0101021b, 0); resMap.writeUInt32LE(0x0101021c, 4);
  const attrs = [];
  const attr = (name, raw, type, data) => { const a = Buffer.alloc(20); a.writeUInt32LE(0xffffffff, 0); a.writeUInt32LE(name, 4); a.writeUInt32LE(raw, 8); a.writeUInt16LE(8, 12); a[15] = type; a.writeUInt32LE(data >>> 0, 16); attrs.push(a); };
  attr(2, 5, 0x03, 5);
  if (versionCode !== undefined) attr(0, 0xffffffff, 0x10, versionCode);
  if (versionName !== undefined) attr(1, 6, 0x03, 6);
  if (split !== undefined) attr(3, 7, 0x03, 7);
  const node = Buffer.alloc(8); node.writeUInt32LE(1, 0); node.writeUInt32LE(0xffffffff, 4);
  const ext = Buffer.alloc(20); ext.writeUInt32LE(0xffffffff, 0); ext.writeUInt32LE(4, 4); ext.writeUInt16LE(20, 8); ext.writeUInt16LE(20, 10); ext.writeUInt16LE(attrs.length, 12);
  // <uses-permission android:name="…"/> children (name found by its string: the resource map covers versionCode/Name only)
  const kids = perms.map((_, i) => {
    const a = Buffer.alloc(20); a.writeUInt32LE(0xffffffff, 0); a.writeUInt32LE(9, 4); a.writeUInt32LE(10 + i, 8); a.writeUInt16LE(8, 12); a[15] = 0x03; a.writeUInt32LE(10 + i, 16);
    const e = Buffer.alloc(20); e.writeUInt32LE(0xffffffff, 0); e.writeUInt32LE(8, 4); e.writeUInt16LE(20, 8); e.writeUInt16LE(20, 10); e.writeUInt16LE(1, 12);
    return chunk(0x0102, 16, Buffer.concat([node, e, a]));
  });
  return chunk(0x0003, 8, Buffer.concat([stringPool(strings), chunk(0x0180, 8, resMap), chunk(0x0102, 16, Buffer.concat([node, ext, ...attrs])), ...kids]));
}
const apkDir = path.join(tmp, 'apk', 'com.mojang.minecraftpe');
fs.mkdirSync(apkDir, { recursive: true });
const VC = 912605203;
const FAKE_EMAIL_G = 'someone@example.com';
fs.writeFileSync(path.join(apkDir, 'com.mojang.minecraftpe.apk'), buildZip([{ name: 'AndroidManifest.xml', data: buildManifest({ pkg: K.PACKAGE, versionCode: VC, versionName: '1.26.52.03' }) }]));
fs.writeFileSync(path.join(apkDir, 'config.arm64_v8a.apk'), buildZip([
  { name: 'AndroidManifest.xml', data: buildManifest({ pkg: K.PACKAGE, versionCode: VC, split: 'config.arm64_v8a' }) },
  { name: 'lib/arm64-v8a/libminecraftpe.so', data: Buffer.from('\x7fELF fake'), method: 0 },
]));

// ---- pieces ----
await t('scenario: every step parses; errors name the line', () => {
  const r = S.parseScenario('launch\n# c\nuntil stable 1000   # wait\nshot a-1\ntap 0.5 0.5\nswipe 0 0 1 1 200\nkey back\ntext hi there\njoin\ndo scriptevent x:y a b\nuntil joined\nuntil server DEMO .* picked (x|y) 3000\nuntil log (?i)minecraft\nexpect server Player\nabsent log (?i)error parse\npull /sdcard/x y\npush a.txt /sdcard/a.txt\nsh ls /sdcard\nuntil joined 5000 ; every 1000 tap 0.5 0.62\nstop\nwait 10');
  eq(r.errors, []);
  eq(r.steps.length, 20);
  eq(r.steps.find((s) => s.line === 12).args, ['server', 'DEMO .* picked (x|y)', '3000']);
  eq(r.steps.find((s) => s.line === 10).args, ['scriptevent x:y a b']);
  eq(r.steps.find((s) => s.every).every.ms, 1000);
  const bad = S.parseScenario('tap 1\nfly\nuntil server\nuntil joined x\nshot a b/c\nuntil stable ; every 10 wait 5\nexpect nothing x');
  eq(bad.errors.map((e) => e.split(':')[0]), ['1', '2', '3', '4', '5', '6', '7']);
});
await t('scenario: screens (stable, blank)', () => {
  const img = (f) => { const w = 32, h = 32, d = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { const c = f(i % w, Math.floor(i / w)); d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; } return pngEncode({ w, h, data: d }); };
  const a = img((x) => [x * 8, 0, 0]), b = img((x) => [x * 8, 0, 0]), c = img((x) => [255 - x * 8, 50, 0]);
  eq(S.screenDiff(a, b, pngDecode), 0);
  ok(S.screenDiff(a, c, pngDecode) > 0.5, 'different screens differ');
  ok(S.blankScreen(img(() => [0, 0, 0]), pngDecode), 'black is blank');
  ok(!S.blankScreen(a, pngDecode), 'a gradient is not blank');
  eq(S.pngSize(a), { w: 32, h: 32 });
});
await t('apk: reads the version from the base APK and the ABI from the split (bedrock-binary\'s reader)', () => {
  const info = K.inspectApks(K.listApks(path.join(tmp, 'apk')));
  eq([info.versionName, info.versionCode, info.abis], ['1.26.52.03', VC, ['arm64-v8a']]);
});
await t('apk: a mixed or incomplete set is refused', () => {
  const d = path.join(tmp, 'mixed'); fs.mkdirSync(d);
  fs.copyFileSync(path.join(apkDir, 'com.mojang.minecraftpe.apk'), path.join(d, 'base.apk'));
  let e = null; try { K.inspectApks(K.listApks(d)); } catch (x) { e = x; } ok(/libminecraftpe/.test(e?.message), 'no .so → ' + e?.message);
  fs.writeFileSync(path.join(d, 'split.apk'), buildZip([{ name: 'AndroidManifest.xml', data: buildManifest({ pkg: K.PACKAGE, versionCode: 1, split: 'config.arm64_v8a' }) }, { name: 'lib/arm64-v8a/libminecraftpe.so', data: Buffer.from('x'), method: 0 }]));
  e = null; try { K.inspectApks(K.listApks(d)); } catch (x) { e = x; } ok(/版の違う/.test(e?.message), 'mixed → ' + e?.message);
});
await t('bds: the server build for an app version', () => {
  const known = { versions: ['1.26.51.1', '1.26.52.1', '1.26.52.3', '1.26.60.2'], preview_versions: ['1.26.70.20'] };
  eq(K.bdsCandidates('1.26.52.03', known), ['1.26.52.3', '1.26.52.1']);
  eq(K.bdsCandidates('1.26.52.05', known), ['1.26.52.5', '1.26.52.3', '1.26.52.1']);
  eq(K.bdsCandidates('1.26.70.20', known), ['1.26.70.20']);
  eq(K.bdsCandidates('1.27.0.1', known), ['1.27.0.1']);
  eq(K.bdsCandidates('beta', known), []);
});
await t('credentials: the same checks as bedrock-binary (no oauth_token, no ya29, no newline)', () => {
  eq(K.credentialProblems({ email: 'a@b.co', aasToken: 'aas_et/' + 'x'.repeat(40) }), []);
  ok(K.credentialProblems({ aasToken: 'oauth2_4/' + 'x'.repeat(30) })[0].includes('oauth_token'), 'oauth2_4');
  ok(K.credentialProblems({ aasToken: 'ya29.' + 'x'.repeat(30) })[0].includes('ya29'), 'ya29');
  ok(K.credentialProblems({ aasToken: 'aas_et/abc\nemail = x' + 'y'.repeat(20) })[0].includes('改行'), 'newline');
  eq(K.redact('token aas_et/SECRET123 for me@x.com', ['aas_et/SECRET123', 'me@x.com']), 'token *** for ***');
  eq(K.parseEnv('# c\nGOOGLE_EMAIL="a@b.co"\nexport GOOGLE_AAS_TOKEN=\'t\'\n'), { GOOGLE_EMAIL: 'a@b.co', GOOGLE_AAS_TOKEN: 't' });
});
await t('apkeep: the token goes in a 0600 ini (never argv), is wiped after; exit 0 without APKs is a failure', async () => {
  const token = 'aas_et/' + 'Z'.repeat(40), env = { GOOGLE_EMAIL: 'me@example.com', GOOGLE_AAS_TOKEN: token, APKEEP_BIN: process.execPath, PATH: process.env.PATH };
  let seen = null;
  const run = (bin, args, o) => {
    const ini = args[args.indexOf('-i') + 1];
    seen = { args, mode: fs.statSync(ini).mode & 0o777, ini: fs.readFileSync(ini, 'utf8'), childEnv: Object.keys(o.env).filter((k) => k.startsWith('GOOGLE')), iniPath: ini };
    const dst = args.at(-1); fs.mkdirSync(path.join(dst, K.PACKAGE), { recursive: true }); fs.writeFileSync(path.join(dst, K.PACKAGE, 'base.apk'), 'x');
    return { status: 0, stdout: `logged in as ${env.GOOGLE_EMAIL}`, stderr: '' };
  };
  const r = await K.fetchApk({ apkDir: path.join(tmp, 'f1'), toolsDir: path.join(tmp, 'tools'), env, run, log: () => {} });
  eq(r.apks.length, 1);
  ok(!seen.args.join(' ').includes(token), 'token not on the command line');
  eq(seen.mode, 0o600); ok(seen.ini.includes(token), 'ini has it'); eq(seen.childEnv, []);
  ok(!fs.existsSync(seen.iniPath), 'ini removed');
  ok(seen.args.includes('device=px_9a,split_apk=true'), 'split APKs, arm64 device');
  let e = null;
  try { await K.fetchApk({ apkDir: path.join(tmp, 'f2'), toolsDir: path.join(tmp, 'tools'), env, run: () => ({ status: 0, stdout: 'Skipping...', stderr: '' }), log: () => {} }); } catch (x) { e = x; }
  eq(e?.kind, 'download');
  e = null;
  try { await K.fetchApk({ apkDir: path.join(tmp, 'f3'), toolsDir: path.join(tmp, 'tools'), env, run: () => ({ status: 1, stdout: '', stderr: `BadAuthentication for ${token}` }), log: () => {} }); } catch (x) { e = x; }
  eq(e?.kind, 'auth'); ok(!String(e.hint + e.message).includes(token), 'token not in the error');
  e = null;
  try { await K.fetchApk({ apkDir: path.join(tmp, 'f4'), toolsDir: path.join(tmp, 'tools'), env: { GOOGLE_EMAIL: 'me@example.com' }, log: () => {} }); } catch (x) { e = x; }
  eq(e?.kind, 'config');
  // apkeep 1.0.0 seen on a Mac: exit 0, only "Downloading ...", nothing saved → once more with --accept-tos, then the causes
  const calls = [];
  e = null;
  try { await K.fetchApk({ apkDir: path.join(tmp, 'f5'), toolsDir: path.join(tmp, 'tools'), env, run: (b, a) => { calls.push(a); return { status: 0, stdout: `Downloading ${K.PACKAGE}...`, stderr: '' }; }, log: () => {} }); } catch (x) { e = x; }
  const runs = calls.filter((a) => a.includes('-a')), devs = runs.map((a) => /device=(\w+)/.exec(a.join(' '))?.[1]);
  ok(runs[1]?.includes('--accept-tos') && JSON.stringify(devs) === JSON.stringify(['px_9a', ...K.FALLBACK_DEVICES]) && runs.slice(1).every((a) => a.includes('--accept-tos')),
    'silent exit 0: once more accepting the terms, then each other arm64 device profile', JSON.stringify(devs));
  ok(/px_9a \/ sm_s25u/.test(e?.hint ?? ''), 'the hint names the profiles tried', e?.hint);
  // a later profile works: its APKs are used and it is named; a profile the person set is the only one tried
  const c2 = [];
  const r2 = await K.fetchApk({ apkDir: path.join(tmp, 'f6'), toolsDir: path.join(tmp, 'tools'), env, run: (b, a) => { if (!a.includes('-a')) return { status: 0, stdout: '' }; c2.push(a);
    if (a.join(' ').includes('device=sm_s25u')) { const d = a.at(-1); fs.mkdirSync(path.join(d, K.PACKAGE), { recursive: true }); fs.writeFileSync(path.join(d, K.PACKAGE, 'base.apk'), 'x'); } return { status: 0, stdout: 'Downloading', stderr: '' }; }, log: () => {} });
  ok(r2.apks.length === 1 && c2.length === 3, 'a later device profile that works is used', JSON.stringify(c2.map((a) => a.join(' ').match(/device=\w+/)?.[0])));
  const c3 = []; e = null;
  try { await K.fetchApk({ apkDir: path.join(tmp, 'f7'), toolsDir: path.join(tmp, 'tools'), env: { ...env, APP_APK_DEVICE: 'poco_f1' }, run: (b, a) => { if (a.includes('-a')) c3.push(a); return { status: 0, stdout: 'Downloading', stderr: '' }; }, log: () => {} }); } catch (x) { e = x; }
  ok(c3.length === 2 && c3.every((a) => a.join(' ').includes('device=poco_f1')), 'APP_APK_DEVICE set: only that profile');
  ok(/何も保存せずに/.test(e?.message ?? '') && /Minecraft を買っていない/.test(e?.hint ?? '') && /app apk <フォルダ>/.test(e?.hint ?? '') && fs.existsSync(path.join(tmp, 'f5', 'apkeep.log')) && !String(e.hint).includes(token), 'then: what it means, the causes, the full log in a file', e?.message + ' ' + e?.hint);
});
await t('guard: a run folder with an APK, a .so, a renamed zip or a token is refused', () => {
  const d = path.join(tmp, 'g'); fs.mkdirSync(path.join(d, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(d, 'shots', '01-a.png'), pngEncode({ w: 1, h: 1, data: Buffer.from([1, 2, 3, 255]) }));
  fs.writeFileSync(path.join(d, 'logcat.txt'), 'hello');
  eq(R.guard(d), []);
  fs.writeFileSync(path.join(d, 'x.apk'), 'a'); fs.writeFileSync(path.join(d, 'lib.bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]));
  fs.writeFileSync(path.join(d, 'pack.png'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0])); fs.writeFileSync(path.join(d, 'l.txt'), 'aas_et/' + 'k'.repeat(30));
  fs.writeFileSync(path.join(d, 'm.log'), 'the secret is SECRETSECRETSECRET');
  eq(R.guard(d, ['SECRETSECRETSECRET']).map((x) => x.split(':')[0]).sort(), ['l.txt', 'lib.bin', 'm.log', 'pack.png', 'x.apk']);
});

// ---- end to end: node lab.mjs app run against the fakes ----
const FAKE = path.join(TOP, 'tests', 'fake', 'app');
// the fake SDK's system image: the one the code asks for on this machine (android.mjs sysImage: arm64-v8a on an arm64
// host such as an Apple Silicon Mac, x86_64 elsewhere)
const HOST_ABI = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
for (const f of ['adb', 'apkeep', 'gh', 'gpdl', 'tesseract', 'avdmanager']) fs.chmodSync(path.join(FAKE, f), 0o755);
// (the device's relay: a stand-in file pushed by the fake adb; the real one is built in its own test)
const RELAY_STUB = path.join(tmp, 'lab-relay-stub'); fs.writeFileSync(RELAY_STUB, 'stub');
const PAD_STUB = path.join(tmp, 'lab-pad-stub'); fs.writeFileSync(PAD_STUB, 'stub');
function e2e(name, extraEnv = {}, args = []) {
  const state = path.join(tmp, `${name}.json`);
  fs.writeFileSync(state, JSON.stringify({ phase: 'home' }));
  const sdk = path.join(tmp, `sdk-${name}`);
  fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI), { recursive: true });
  const env = { ...process.env, FAKE_APP_STATE: state, APP_ADB: path.join(FAKE, 'adb'), APP_EMULATOR: path.join(FAKE, 'adb'), APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, APP_APK_DIR: apkDir, GITHUB_STEP_SUMMARY: path.join(tmp, `${name}-summary.md`), APP_STABLE_MS: '100', APP_ADBKEY_DIR: path.join(tmp, 'adbkey-e2e'), APP_RELAY_BIN: RELAY_STUB, APP_PAD_BIN: PAD_STUB, APP_PAD_WAIT_MS: '50', ...extraEnv };
  delete env.GOOGLE_AAS_TOKEN; delete env.GOOGLE_EMAIL;
  if (!('GITHUB_ACTIONS' in extraEnv)) delete env.GITHUB_ACTIONS;   // (the tests run in Actions too: notices only when asked)
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'run', '-a', 'jsonui_demo', '--no-fetch', ...args], { cwd: TOP, env, encoding: 'utf8', timeout: 120_000 });
  const text = r.stdout + r.stderr;
  const runDir = path.join(TOP, 'app', /→ (app\/runs\/\S+)/.exec(text)?.[1]?.replace(/^app\//, '') ?? 'none');
  return { status: r.status, text, runDir, state: JSON.parse(fs.readFileSync(state, 'utf8')) };
}
const made = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the same, started in the background (to interrupt it)
function e2eStart(name, extraEnv = {}, args = []) {
  const state = path.join(tmp, `${name}.json`);
  fs.writeFileSync(state, JSON.stringify({ phase: 'home' }));
  const sdk = path.join(tmp, `sdk-${name}`);
  fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI), { recursive: true });
  const env = { ...process.env, FAKE_APP_STATE: state, APP_ADB: path.join(FAKE, 'adb'), APP_EMULATOR: path.join(FAKE, 'adb'), APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, APP_APK_DIR: apkDir, APP_STABLE_MS: '100', APP_ADBKEY_DIR: path.join(tmp, 'adbkey-e2e'), APP_PAD_WAIT_MS: '50', ...extraEnv };
  delete env.GITHUB_STEP_SUMMARY;
  if (!('GITHUB_ACTIONS' in extraEnv)) delete env.GITHUB_ACTIONS;
  env.APP_VERBOSE = '1';   // (every step on the screen: the test waits for one)
  const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'run', '-a', 'jsonui_demo', '--no-fetch', ...args], { cwd: TOP, env });
  let text = ''; c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
  return { c, state, text: () => text, done: new Promise((res) => c.on('exit', (code) => res(code))) };
}
const cli = (args, env = {}) => { const e = { ...process.env, APP_ADB: path.join(FAKE, 'adb'), APP_ADBKEY_DIR: path.join(tmp, 'adbkey-cli'), ...env }; if (!('GITHUB_ACTIONS' in env)) delete e.GITHUB_ACTIONS; const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', ...args], { cwd: TOP, encoding: 'utf8', timeout: 60_000, env: e }); return { status: r.status, text: r.stdout + r.stderr }; };
await t('run: jsonui_demo/app.txt end to end → PASS, screenshots, logs, report', () => {
  const r = e2e('pass', { APP_PORT: '19132' });
  made.push(r.runDir);
  ok(r.status === 0, `exit ${r.status}\n${r.text}`);
  ok(/PASS app\/runs\/.*report\.md/.test(r.text), r.text);
  const shots = fs.readdirSync(path.join(r.runDir, 'shots')).sort();
  eq(shots, ['01-title.png', '02-world.png', '03-jsonui-form.png', '04-closed.png', '99-final.png']);
  // the form screenshot is the form phase's colour (taken after the server said the form was shown)
  const px = pngDecode(fs.readFileSync(path.join(r.runDir, 'shots', '03-jsonui-form.png'))).data;
  eq([px[0], px[1]], [230, 180]);
  for (const f of ['report.md', 'index.html', 'steps.txt', 'result.json', 'logcat.txt', 'logcat-minecraft.txt', 'server.log', 'do.txt']) ok(fs.existsSync(path.join(r.runDir, f)), f);
  ok(/Player Spawned: Steve/.test(fs.readFileSync(path.join(r.runDir, 'server.log'), 'utf8')), 'server log');
  ok(/MinecraftPE/.test(fs.readFileSync(path.join(r.runDir, 'logcat-minecraft.txt'), 'utf8')), 'logcat');
  // the join as a world on the same network (NetherNet LAN, 1.26's only transport for the app): PLAY → the LAN world, by the
  // gamepad (no OCR here: A, DOWN, A), the discovery carried by a second relay on UDP 7551
  ok(r.state.uri === 'lan' && JSON.stringify(r.state.pads) === JSON.stringify(['BUTTON_A', 'DPAD_DOWN', 'BUTTON_A']), `the LAN world joined from PLAY: ${r.state.uri} ${JSON.stringify(r.state.pads)}`);
  // through the device's own controller (uinput), not the shell's injected keys
  // (buttons through it, held; a direction as a key event — the game samples the controller's D-pad once a frame)
  ok(r.state.calls.includes(`push ${PAD_STUB} /data/local/tmp/lab-pad`) && r.state.padUp === true && r.state.viaPad === 2 && r.state.calls.includes('shell input gamepad keyevent KEYCODE_DPAD_DOWN') && !r.state.calls.some((c) => /input gamepad keyevent KEYCODE_BUTTON/.test(c)), `the controller plugged in and pressed: up ${r.state.padUp} via ${r.state.viaPad}`);
  ok(r.state.calls.includes(`push ${RELAY_STUB} /data/local/tmp/lab-relay`) && JSON.stringify(r.state.relays) === JSON.stringify(['/data/local/tmp/lab-relay 19132 10.0.2.2 19132', '/data/local/tmp/lab-relay --reflect 7551 10.0.2.2 7551']), 'the relay (19132) and the reflector of the LAN discovery broadcasts (7551: the game holds that port) started: ' + JSON.stringify(r.state.relays));
  ok(r.state.bds.some((c) => c === 'up [packs required] [lan visible] [port 19132] [watchdog 60000] [transport lan] [no debugger]'), 'BDS up with required packs, NetherNet over LAN, answering pings with its name and version, on the fixed port, a busy machine not taken for a script hang, no script debugger: ' + r.state.bds.join(' / '));
  ok(r.state.bds.includes('bds 1.26.52.3'), 'BDS pinned to the app version');
  ok(r.state.calls.includes('install-multiple -r -d -g -i com.android.vending ' + K.listApks(apkDir).join(' ')), 'installed the whole split set');
  ok(r.state.calls.includes('shell pm disable-user --user 0 com.google.android.youtube') && !r.state.calls.some((c) => /disable-user .*(com\.google\.android\.gms|com\.android\.vending|com\.google\.android\.gsf)\b/.test(c)) && new RegExp(`Google アプリ ${QUIET_APPS.length} 個を止めました`).test(fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8')), 'the bundled Google apps are stopped, never Play services / GSF / Play Store');
  ok((r.state.settings ?? []).includes('global auto_sync 0'), 'account sync turned off so it does not starve the game: ' + (r.state.settings ?? []).join(', '));
  ok(/# app: PASS/.test(fs.readFileSync(path.join(tmp, 'pass-summary.md'), 'utf8')), 'job summary');
  eq(R.guard(r.runDir), []);
});
fs.writeFileSync(path.join(tmp, 'short.txt'), 'launch\njoin\nuntil joined 3000\nshot never\n');
// ---- the results through the GitHub API alone (app/lib/ghresults.mjs, app checks, app ci) ----
const GR = await imp('app/lib/ghresults.mjs');
await t('checks: a run folder → check runs (default = result + errors only + screenshots; --full adds the wide logcat) → back into files', () => {
  const runDir = made[0], pay = GR.checksPayload(runDir, { pkg: 'com.mojang.minecraftpe' });
  // default: no verbose logcat check, no run/BDS dumps — only result + errors (safe to show on a stream)
  eq(pay.map((x) => x.name), ['app: 結果', 'app: 画面 01-title.png', 'app: 画面 02-world.png', 'app: 画面 03-jsonui-form.png', 'app: 画面 04-closed.png', 'app: 画面 99-final.png']);
  ok(/^PASS /.test(pay[0].title) && /# app: PASS/.test(pay[0].summary) && !/===== run \(run\.txt\)/.test(pay[0].text) && !/===== BDS/.test(pay[0].text), 'errors-only text: ' + pay[0].text.slice(0, 200));
  const full = GR.checksPayload(runDir, { pkg: 'com.mojang.minecraftpe', full: true });
  ok(full.some((x) => x.name === 'app: logcat') && full.find((x) => x.name === 'app: 結果').text.includes('===== run (run.txt)'), 'full has the logcat check and run dump');
  ok(pay.every((x) => x.summary.length <= GR.LIMIT && x.text.length <= GR.LIMIT && x.summary.length > 0), 'sizes');
  const dir = path.join(tmp, 'unpacked');
  const files = GR.unpackChecks(full.map((x) => ({ name: x.name, output: { title: x.title, summary: x.summary, text: x.text } })), dir);
  ok(files.includes('report.md') && files.includes('details.txt') && files.includes('logcat-wide.txt') && files.includes(path.join('shots', '03-jsonui-form.png')), files.join(' '));
  const px = pngDecode(fs.readFileSync(path.join(dir, 'shots', '03-jsonui-form.png')));
  ok(px.w === 64 && Math.abs(px.data[0] - 230) <= 8 && Math.abs(px.data[1] - 180) <= 8, `the form colour survives: ${px.w}x${px.h} ${px.data[0]},${px.data[1]}`);
  // a big screen shrinks to fit a check run's text
  const w = 1080, h = 2340, data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = (i * 7) & 255; data[i * 4 + 1] = (i >> 9) & 255; data[i * 4 + 2] = i % 1080 > 540 ? 200 : 20; data[i * 4 + 3] = 255; }
  const th = GR.thumbPng(pngEncode({ w, h, data }));
  ok(th.png.toString('base64').length <= GR.LIMIT && th.w >= 120 && Math.abs(th.h / th.w - h / w) < 0.02, `${th.w}x${th.h} ${th.png.length} bytes`);
  // the wide logcat keeps stack frames and the time, drops other apps' chatter and the CPU table
  const L = (pid, lv, tag, msg) => `10-03 00:40:00.000  ${pid}  ${pid} ${lv} ${tag}: ${msg}`;
  const wide = GR.logcatWide([L(500, 'I', 'ActivityManager', 'Start proc 7:com.mojang.minecraftpe/u0a1 for x'), L(7, 'E', 'AndroidRuntime', 'java.lang.Error: x'), L(7, 'E', 'AndroidRuntime', '\tat a.b(C.java:1)'), L(9, 'E', 'Other', 'noise'), L(500, 'E', 'ActivityManager', '12% 8/x: 1% user'), L(7, 'I', 'Minecraft', 'info')].join('\n'), 'com.mojang.minecraftpe');
  eq(GR.logcatWide(L(7, 'E', 'emuglGLESv2_enc', 'GL error 0x500') + '\n' + L(500, 'I', 'ActivityManager', 'Start proc 7:com.mojang.minecraftpe/u0a1 for x'), 'com.mojang.minecraftpe').length, 1, 'GL driver noise dropped');
  eq(wide.length, 3, wide.join('\n')); ok(wide.some((l) => /\tat a\.b/.test(l)) && !wide.some((l) => /noise|% user|info/.test(l)), wide.join('\n'));
  // masked
  ok(GR.checksPayload(runDir, { secrets: ['jsonui_demo'] })[0].summary.includes('<secret>'), 'secrets masked');
});
await t('anonymize: tokens, e-mails, account name, device/android ids and home paths are scrubbed; errorLines keeps only results and errors', () => {
  const s = "me@example.com signed in; Account {name=me@example.com, type=com.google}; aas_et/" + 'Q'.repeat(30) + "; setCachedDeviceId(02fdecb97f764084881f5e1ded7f4fdb); android_id=1a2b3c4d5e6f7a8b; /home/alice/bds-lab/x; /Users/bob/y";
  const a = GR.anonymize(s, ['TOPSECRETvalue']);
  ok(!/example\.com/.test(a) && (a.match(/<email>/g) || []).length >= 2, 'emails: ' + a);
  ok(/<token>/.test(a) && /setCachedDeviceId\(<id>\)/.test(a) && /android_id=<id>/.test(a) && a.includes('/home/<user>/bds-lab') && a.includes('/Users/<user>/y'), a);
  ok(GR.anonymize('x TOPSECRETvalue y', ['TOPSECRETvalue']).includes('<secret>'), 'passed secrets');
  const txt = ['[1/5] 端末', '      ふつうの進捗', '✔ 2: launch — ok', '✘ 6: until joined — timed out', 'W 最後にアプリが動いていません', 'E something broke', '===== 空の見出し =====', '===== エラー =====', 'java.lang.Error: boom'].join('\n');
  const e = GR.errorLines(txt);
  ok(/✘ 6/.test(e) && /W 最後に/.test(e) && /E something/.test(e) && /java\.lang\.Error/.test(e), 'keeps errors: ' + e);
  ok(!/\[1\/5\]/.test(e) && !/ふつうの進捗/.test(e) && !/✔ 2/.test(e) && !/空の見出し/.test(e), 'drops progress and empty headers: ' + e);
});
await t('checks --print / ci: the workflow posts, `app ci` starts, waits and reads it all back (fake gh)', () => {
  fs.mkdirSync(path.join(path.dirname(made[0]), 'gh-999999'), { recursive: true }); made.push(path.join(path.dirname(made[0]), 'gh-999999'));   // (fetched results are not runs)
  const r0 = cli(['checks', '--print', path.dirname(made[0])]);
  ok(r0.status === 0 && /^app: 結果\t(PASS|FAIL) \d{8}-/m.test(r0.text) && /app: 画面 99-final\.png/.test(r0.text), r0.text);
  const r1 = cli(['checks', path.dirname(made[0])], { GITHUB_TOKEN: '', GITHUB_REPOSITORY: '', GITHUB_SHA: '' });
  ok(r1.status === 1 && /GITHUB_TOKEN/.test(r1.text), 'outside Actions it says so: ' + r1.text);
  const bin = path.join(tmp, 'ghbin'); fs.mkdirSync(bin, { recursive: true }); fs.copyFileSync(path.join(FAKE, 'gh'), path.join(bin, 'gh')); fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const checks = path.join(tmp, 'checks.json'), log = path.join(tmp, 'gh.log');
  const pay = GR.checksPayload(made[0]);
  fs.writeFileSync(checks, JSON.stringify([...pay.map((x) => ({ name: x.name, external_id: '123', output: { title: x.title, summary: x.summary, text: x.text } })), { name: 'app: 結果', external_id: '999', output: { title: 'older run', summary: 'OLD', text: '' } }, { name: 'other', external_id: '123', output: {} }]));
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_CHECKS: checks, FAKE_GH_LOG: log };
  const r = cli(['ci', '--repo', 'o/r', '--ref', 'my-branch', '--account', '-a', 'jsonui_demo', '--wait'], env);
  const dir = path.join(TOP, 'app', 'runs', 'gh-123'); made.push(dir);
  ok(r.status === 0 && /起動しました: https:\/\/github\.com\/o\/r\/actions\/runs\/123/.test(r.text) && /^FAIL app\/runs\/gh-123/m.test(r.text) && /チェック 6 個/.test(r.text), r.text);
  ok(/workflow run app\.yml --repo o\/r --ref my-branch -f addon=jsonui_demo -f account=true/.test(fs.readFileSync(log, 'utf8')), fs.readFileSync(log, 'utf8'));
  ok(/# app: PASS/.test(fs.readFileSync(path.join(dir, 'report.md'), 'utf8')) && !/OLD/.test(fs.readFileSync(path.join(dir, 'report.md'), 'utf8')), 'this run only');
  ok(fs.readdirSync(path.join(dir, 'shots')).length === 5 && /✘ 3 until stable/.test(fs.readFileSync(path.join(dir, 'annotations.txt'), 'utf8')) && /failure  アプリで確かめる/.test(fs.readFileSync(path.join(dir, 'steps.txt'), 'utf8')), fs.readdirSync(dir).join(' '));
  // parallel by default: no waiting, a lane of its own each; --try: several at once, each with its settings
  fs.writeFileSync(log, '');
  const rp = cli(['ci', '--repo', 'o/r', '--ref', 'my-branch', '--knobs', 'APP_GPU=swangle_indirect', '--try', 'APP_TAP=hold', '--try', 'APP_TAP=motion APP_FAST_UI=0', '--hold', '30'], env);
  const disp = fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('workflow run'));
  ok(rp.status === 0 && disp.length === 2 && /待たずに戻ります/.test(rp.text) && /app live --run 123 "screen"/.test(rp.text), rp.text);
  ok(/-f lane=p[0-9a-z]{5}-1 -f knobs=APP_GPU=swangle_indirect APP_TAP=hold -f hold=30/.test(disp[0]) && /-f lane=p[0-9a-z]{5}-2 -f knobs=APP_GPU=swangle_indirect APP_TAP=motion APP_FAST_UI=0/.test(disp[1]), disp.join('\n'));
  ok(cli(['ci', '--repo', 'o/r', '--try', 'rm=-rf'], env).status === 1, 'a try is knobs too');
  const rf = cli(['ci', 'fetch', '123', '--repo', 'o/r'], env);
  ok(rf.status === 0 && /^FAIL app\/runs\/gh-123/m.test(rf.text), rf.text);
  ok(cli(['ci', 'fetch', '--repo', 'o/r'], env).status === 1, 'fetch needs a run number');
});
// (a private repository's comments, in the clear — these tests run in GitHub Actions too, where an unsaid visibility is public)
const asPrivate = (fn) => async () => { const was = process.env.APP_REPO_VISIBILITY; process.env.APP_REPO_VISIBILITY = 'private'; try { await fn(); } finally { if (was === undefined) delete process.env.APP_REPO_VISIBILITY; else process.env.APP_REPO_VISIBILITY = was; } };
await t('live: comments → commands for this run only, replies with the text and the screen (pure)', asPrivate(async () => {
  const LV = await imp('app/lib/live.mjs');
  eq(LV.commandsOf('lab@123 screen\ntap 0.5 0.5\n# a note\n', 123), ['screen', 'tap 0.5 0.5']);
  eq(LV.commandsOf('lab@123 screen\n\n---\n_Generated by a bot_', 123), ['screen'], 'not what is added under the comment');
  eq(LV.commandsOf('lab@124 screen', 123), null, 'another run'); eq(LV.commandsOf('please lab@123 screen', 123), null, 'only at the start');
  eq(LV.parseCommand('sh ls -l /data'), { verb: 'sh', args: ['ls', '-l', '/data'], tail: 'ls -l /data' }); ok(/知らないコマンド/.test(LV.parseCommand('rm -rf /').error));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9]);
  const b = LV.replyBody(123, 77, 'line\n```inner```', png), back = LV.replyParts(b, 123);
  eq([back.id, back.text, back.png.equals(png)], [77, "line\n'''inner'''", true]);
  eq(LV.replyParts(b, 124), null);
  const big = LV.replyBody(1, 2, 'x'.repeat(100_000), png, 5000);
  ok(big.length < 5200 && /…（前を省略）/.test(big), 'kept within a comment');
  // a scenario in the comment: the lines after "<<" as they are (its "## section" lines too), up to EOF
  eq(LV.commandsOf('lab@123 screen\nrun <<\n## form\njoin\n  until joined\nEOF\nlast', 123), ['screen', 'run <<\n## form\njoin\n  until joined', 'last']);
  eq(LV.commandsOf('lab@123 run <<\nshot a\n---\n_bot_', 123), ['run <<\nshot a'], 'to the end (not what is added under it)');
  eq(LV.heredoc(LV.parseCommand('run <<\n## a\nshot a').tail), { head: '', text: '## a\nshot a\n' }); eq(LV.heredoc('--all'), null); eq(LV.heredoc('-v <<'), { head: '-v', text: '' });
  ok(LV.LONG.has('run') && LV.LONG.has('ui') && !LV.LONG.has('screen'), 'a run is waited for longer');
}));
await t('app hold: the device kept up, the live issue made, commands from the run\'s user run on the device and answered with the screen; others ignored; stop ends it (fake GitHub + fake device)', asPrivate(async () => {
  const http = await import('node:http');
  // the user's comments, one after each answer: commands on the device; a run's refusals; a run of the comment's own steps;
  // that run's report and screens; a branch's addon pulled and its app.txt run; stop
  const st = { issues: [], comments: [], posted: [], next: ['lab@123 run --apk /tmp/x\nui <<\nshot a\nEOF\nrun --scenario /etc/passwd\npull ../x',
    'lab@123 run <<\nsection quick\nshot live-a\nEOF', 'lab@123 last list\nlast live-a\nlast nope', 'lab@123 pull my-branch\nrun', 'lab@123 stop'] };
  let nextId = 500;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.headers.authorization !== 'Bearer tok') return send(401, {});
      if (req.method === 'GET' && u.pathname === '/repos/o/r/issues') return send(200, st.issues);
      if (req.method === 'POST' && u.pathname === '/repos/o/r/issues') { const i = { number: 7, title: JSON.parse(body).title }; st.issues.push(i); return send(201, i); }
      if (req.method === 'GET' && u.pathname === '/repos/o/r/issues/7/comments') return send(200, st.comments);
      if (req.method === 'POST' && u.pathname === '/repos/o/r/issues/7/comments') {
        const c = { id: nextId++, body: JSON.parse(body).body, created_at: new Date().toISOString(), user: { login: 'github-actions[bot]' } };
        st.comments.push(c); st.posted.push(c.body);
        // the user's commands once the run says it waits: one from someone else, then the user's
        if (/^lab-live@123 待っています/.test(c.body)) {
          st.comments.push({ id: nextId++, body: 'lab@123 kill', created_at: new Date().toISOString(), user: { login: 'stranger' } });
          st.comments.push({ id: nextId++, body: 'lab@123 sh echo hello\ntap 0.5 0.5 hold\nkey BACK\noptions set screen_animations=0\nnope', created_at: new Date().toISOString(), user: { login: 'me' } });
        }
        if (/^lab-reply@123 /.test(c.body) && st.next.length) st.comments.push({ id: nextId++, body: st.next.shift(), created_at: new Date().toISOString(), user: { login: 'me' } });
        return send(201, c);
      }
      // `pull`: the addon's files on a branch (commit → trees down to the addon → its blobs)
      const T = { root: [{ path: 'bds', type: 'tree', sha: 't-bds' }], 't-bds': [{ path: 'addons', type: 'tree', sha: 't-addons' }], 't-addons': [{ path: 'livetest', type: 'tree', sha: 't-addon' }],
        't-addon': [{ path: 'bp', type: 'tree', sha: 't-bp' }, { path: 'bp/manifest.json', type: 'blob', mode: '100644', sha: 'b1' }, { path: 'app.txt', type: 'blob', mode: '100644', sha: 'b2' }] };
      const B = { b1: '{"format_version":2}', b2: 'section pulled\nshot pulled-one\n' };
      if (u.pathname === '/repos/o/r/commits/my-branch') return send(200, { sha: 'abcdef1234', commit: { tree: { sha: 'root' }, message: 'the form, bigger\nmore' } });
      const tm = /^\/repos\/o\/r\/git\/trees\/([\w-]+)$/.exec(u.pathname); if (tm && T[tm[1]]) return send(200, { tree: tm[1] === 't-addon' || u.searchParams.get('recursive') !== '1' ? T[tm[1]] : [], truncated: false });
      const bm = /^\/repos\/o\/r\/git\/blobs\/(\w+)$/.exec(u.pathname); if (bm && B[bm[1]]) return send(200, { content: Buffer.from(B[bm[1]]).toString('base64'), encoding: 'base64' });
      send(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const state = path.join(tmp, 'hold.json'); fs.writeFileSync(state, JSON.stringify({ phase: 'title', launched: true }));
  // (the addon of the run: one the test makes by `pull`; the run on the device against the fake BDS, with the fake APKs)
  const sdk = path.join(tmp, 'sdk-hold'); fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI), { recursive: true });
  const env = { ...process.env, FAKE_APP_STATE: state, APP_ADB: path.join(FAKE, 'adb'), APP_EMULATOR: path.join(FAKE, 'adb'), APP_ADBKEY_DIR: path.join(tmp, 'adbkey-hold'), GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '123', GITHUB_TOKEN: 'tok', LIVE_USER: 'me', APP_LIVE_POLL_MS: '50', APP_TESSERACT: path.join(FAKE, 'tesseract'),
    ADDON: 'livetest', APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, APP_APK_DIR: apkDir, APP_STABLE_MS: '100', APP_RELAY_BIN: RELAY_STUB, APP_PAD_BIN: PAD_STUB, APP_PAD_WAIT_MS: '50' };
  delete env.GITHUB_ACTIONS; delete env.GITHUB_OUTPUT; delete env.GITHUB_STEP_SUMMARY; delete env.GOOGLE_AAS_TOKEN; delete env.GOOGLE_EMAIL;
  const addonDir = path.join(TOP, 'bds', 'addons', 'livetest'); made.push(addonDir);
  const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'hold', '--minutes', '2'], { cwd: TOP, env });
  let text = ''; c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
  const code = await new Promise((r) => c.on('exit', r));
  server.close();
  for (const m of text.matchAll(/(app\/runs\/\d{8}-\d{6}-livetest)/g)) made.push(path.join(TOP, m[1]));
  ok(code === 0 && /live: issue #7 で命令を待ちます/.test(text) && /OK live: 終わりました（命令で）/.test(text), `exit ${code}\n${text}`);
  const LV = await imp('app/lib/live.mjs'), replies = st.posted.map((b) => LV.replyParts(b, 123)).filter(Boolean);
  const reply = st.posted.find((b) => /^lab-reply@123 #50\d/.test(b)), parts = reply && LV.replyParts(reply, 123);
  ok(parts && /> sh echo hello  \[\d+\.\d 秒\]/.test(parts.text) && /押しました \(32, 18\)、hold/.test(parts.text) && /キー BACK（4）/.test(parts.text) && /書きました: screen_animations:0/.test(parts.text) && /知らないコマンド: nope/.test(parts.text) && /--- 画面: com\.mojang\.minecraftpe/.test(parts.text) && parts.png?.subarray(1, 4).toString() === 'PNG', parts?.text ?? st.posted.join('\n---\n'));
  const calls = JSON.parse(fs.readFileSync(state, 'utf8')).calls ?? [];
  ok(calls.includes('shell input swipe 32 18 32 18 250') && calls.includes('shell input keyevent 4') && !calls.some((x) => /force-stop/.test(x)), 'the user\'s commands ran, the stranger\'s kill did not: ' + calls.slice(-12).join(' | '));
  ok(st.posted.some((b) => /^lab-live@123 終わりました/.test(b)) && !st.posted.join('\n').includes('tok'), 'ends with a note, no token in what was posted');
  // a run takes only what is its own: no other options, no file outside the repository, no scenario for ui, a plain branch
  const [refuse, ran, last, pulled] = replies.slice(1);
  if (process.env.APP_TEST_DUMP) fs.writeFileSync(process.env.APP_TEST_DUMP, replies.map((r) => `#${r.id}\n${r.text}`).join("\n=====\n"));
  ok(/run では使えない指定: --apk/.test(refuse?.text) && /ui には手順を渡せません/.test(refuse?.text) && /--scenario \/etc\/passwd: bds\/addons\/ か app\/scenarios\/ の \.txt を/.test(refuse?.text) && /書き方: pull <枝/.test(refuse?.text), refuse?.text);
  // the comment's own steps, run on the device as it is: no new emulator, the result, the run's own picture
  ok(/> run <<（と 2 行）/.test(ran?.text) && /動いている端末をそのまま使います/.test(ran?.text) && /^PASS app\/runs\/\S+-livetest\/report\.md/m.test(ran?.text) && /--- run 通りました（\d+ 秒）、画像: 99-final\.png/.test(ran?.text) && ran.png?.subarray(1, 4).toString() === 'PNG', ran?.text);
  ok(/01-live-a\.png/.test(last?.text) && /画像: 01-live-a\.png/.test(last?.text) && /# app: /.test(last?.text) && /\/nope\/ の画面がありません/.test(last?.text), last?.text);
  // pushed, pulled, run: the branch's files in the addon, its app.txt the steps
  ok(/アドオン livetest を my-branch（abcdef1「the form, bigger」）から取りました: 2 ファイル/.test(pulled?.text) && fs.readFileSync(path.join(addonDir, 'app.txt'), 'utf8') === 'section pulled\nshot pulled-one\n', pulled?.text);
  ok(/^PASS app\/runs\/\S+-livetest\/report\.md/m.test(pulled?.text) && /--- run 通りました/.test(pulled?.text), pulled?.text);
  const st2 = JSON.parse(fs.readFileSync(state, 'utf8'));
  ok(!(st2.calls ?? []).some((x) => /emu kill|-avd /.test(x)) && (st2.bds ?? []).filter((x) => /^up /.test(x)).length === 2, 'the device stayed, a BDS for each run: ' + (st2.bds ?? []).join(' | '));
}));
await t('app live: posts the command for the run, waits for its answer, prints it and keeps the screen (fake gh)', () => {
  const bin = path.join(tmp, 'ghbin-live'); fs.mkdirSync(bin, { recursive: true }); fs.copyFileSync(path.join(FAKE, 'gh'), path.join(bin, 'gh')); fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const lv = path.join(tmp, 'live.json'); fs.writeFileSync(lv, JSON.stringify({ issues: [{ number: 7, title: 'app live: 実機をそのまま調べる（ラボが使います）' }], comments: [{ id: 1, body: 'lab-live@123 待っています（30 分まで）', created_at: new Date().toISOString() }] }));
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_LIVE: lv };
  const r = cli(['live', '--repo', 'o/r', 'screen'], env);
  ok(r.status === 0 && /> screen\nfake answer/.test(r.text) && /画面: app\/runs\/live\/123-100\d\.png/.test(r.text), r.text);
  const f = /画面: (app\/runs\/live\/\S+\.png)/.exec(r.text)?.[1]; made.push(path.join(TOP, 'app', 'runs', 'live'));
  ok(f && fs.readFileSync(path.join(TOP, f)).subarray(1, 4).toString() === 'PNG', 'the screen kept');
  ok(JSON.parse(fs.readFileSync(lv, 'utf8')).comments.some((c) => c.body === 'lab@123 screen'), 'the command posted for the run in progress');
  const w = cli(['live', '--repo', 'o/r', '--run', '123', '--wait'], env);
  ok(w.status === 0 && /lab-live@123 待っています/.test(w.text), w.text);
  const s2 = cli(['live', '--repo', 'o/r', '--timeout', '4', 'screen'], { ...env, FAKE_GH_LIVE_SILENT: '1' });
  ok(s2.status === 1 && /4 秒で返事がありません/.test(s2.text), s2.text);
  // --steps: a scenario of this machine run on the held device as it is (nothing committed); a wrong one never leaves
  const sf = path.join(tmp, 'live-steps.txt'); fs.writeFileSync(sf, 'section form\nshot a\n');
  const r3 = cli(['live', '--repo', 'o/r', '--run', '123', '--steps', sf], env);
  ok(r3.status === 0 && /> run <<\nfake answer/.test(r3.text) && JSON.parse(fs.readFileSync(lv, 'utf8')).comments.some((c) => c.body === 'lab@123 run <<\nsection form\nshot a\nEOF'), r3.text);
  fs.writeFileSync(sf, 'section form\nfly away\n'); const n0 = JSON.parse(fs.readFileSync(lv, 'utf8')).comments.length;
  const r4 = cli(['live', '--repo', 'o/r', '--run', '123', '--steps', sf], env);
  ok(r4.status === 1 && /live-steps\.txt:2/.test(r4.text) && JSON.parse(fs.readFileSync(lv, 'utf8')).comments.length === n0, r4.text);
  // --no-wait: sent, back at once with how to read the answer; --reply: that answer
  const r5 = cli(['live', '--repo', 'o/r', '--run', '123', '--no-wait', 'fps'], env), id = /送りました（#(\d+)）/.exec(r5.text)?.[1];
  ok(r5.status === 0 && id && new RegExp(`app live --run 123 --reply ${id}`).test(r5.text), r5.text);
  const r6 = cli(['live', '--repo', 'o/r', '--run', '123', '--reply', id], env);
  ok(r6.status === 0 && /> fps\nfake answer/.test(r6.text), r6.text);
  // a public repository: no key → nothing posted (a command in the clear is never written); a key → the command sealed
  const n1 = JSON.parse(fs.readFileSync(lv, 'utf8')).comments.length;
  const p1 = cli(['live', '--repo', 'o/r', '--run', '123', '--no-wait', 'code 123456'], { ...env, FAKE_GH_VISIBILITY: 'PUBLIC' });
  ok(p1.status === 1 && /鍵がありません/.test(p1.text) && JSON.parse(fs.readFileSync(lv, 'utf8')).comments.length === n1, p1.text);
  const p2 = cli(['live', '--repo', 'o/r', '--run', '123', '--no-wait', 'code 123456'], { ...env, FAKE_GH_VISIBILITY: 'PUBLIC', APP_CACHE_KEY: 'test-key-one' });
  const last = JSON.parse(fs.readFileSync(lv, 'utf8')).comments.slice(n1).find((c) => c.body.startsWith('lab@123 '))?.body ?? '';
  ok(p2.status === 0 && last.startsWith('lab@123 lab-sealed:v1:') && !/123456/.test(last), `${p2.text}\n${last}`);
});
await t('run: until title leaves the game\'s first-start screen ("WELCOME TO MINECRAFT!") by its Maybe later (OCR), then joins', () => {
  const r = e2e('welcome-run', { APP_PORT: '19132', FAKE_WELCOME: '1', FAKE_OCR_TITLE: '1', APP_TESSERACT: path.join(FAKE, 'tesseract') });
  made.push(r.runDir);
  ok(r.status === 0 && r.state.welcomed === true, `exit ${r.status} welcomed ${r.state.welcomed}\n${r.text.slice(-1500)}`);
  const run = fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8');
  ok(/ゲームの最初の画面: 「Haybe later」を押します/.test(run) && r.state.calls.includes('shell input tap 50 30') && /until title .*title（Play と Settings）/.test(run), 'the not-now button tapped where OCR read it, the title by its words:\n' + run.slice(-1200));
});
await t('run: the join answers the game\'s own questions (Unknown External Server → Continue, Online play is not rated → Proceed) by OCR; a game that wants a Microsoft sign-in is said at once', async () => {
  const r = e2e('joinq', { APP_PORT: '19132', APP_TRANSPORT: 'raknet', FAKE_JOIN_PROMPTS: '1', APP_TESSERACT: path.join(FAKE, 'tesseract'), APP_JOIN_OCR_MS: '50' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(r.runDir);
  const run = fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8');
  ok(r.status === 0 && /参加の確認: 「Continue」を押します（Unknown External Server/.test(run) && /参加の確認: 「Proceed」を押します（Online play is not rated/.test(run), `exit ${r.status}\n${run.slice(-1500)}`);
  ok(r.state.calls.includes('shell input tap 30 22') && r.state.calls.includes('shell input tap 30 26'), 'each button tapped where OCR read it');
  // OCR reads the question but not the white words on the green button (the CI emulator): pressed where 1.26 puts it
  const nb = e2e('joinq-nobutton', { APP_PORT: '19132', APP_TRANSPORT: 'raknet', FAKE_JOIN_PROMPTS: '1', FAKE_OCR_NO_BUTTONS: '1', APP_TESSERACT: path.join(FAKE, 'tesseract'), APP_JOIN_OCR_MS: '50' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(nb.runDir);
  const nbRun = fs.readFileSync(path.join(nb.runDir, 'run.txt'), 'utf8');
  ok(nb.status === 0 && /参加の確認: 「Continue（位置から）」を押します/.test(nbRun) && /参加の確認: 「Proceed（位置から）」を押します/.test(nbRun) && nb.state.calls.includes('shell input tap 32 20') && nb.state.calls.includes('shell input tap 32 25'), `exit ${nb.status}\n${nbRun.slice(-1500)}`);
  const CL2 = await imp('app/lib/client.mjs'), W2 = (t) => t.split(' ').map((x, i) => ({ text: x, x: i * 10, y: 5, w: 8, h: 3 }));
  eq(CL2.joinPromptButton(W2('Online play is not rated')), null, 'no size, no guess');
  eq(CL2.joinRefusal(W2('An error has occurred. Back to menu Show details')), 'An error has occurred.');
  // the white ring round a focused thing (1.26's new screens): a line unbroken across the word above it and below it
  const ringImg = { w: 40, h: 30, data: Buffer.alloc(40 * 30 * 4, 30) };
  for (const y of [8, 20]) for (let x = 5; x < 30; x++) ringImg.data.fill(250, (y * 40 + x) * 4, (y * 40 + x) * 4 + 3);
  ok(CL2.focusRing(ringImg, { left: 8, top: 12, width: 15, height: 4 }) && !CL2.focusRing(ringImg, { left: 31, top: 12, width: 6, height: 4 }), 'ring round the word, none beside it');
  for (let x = 8; x < 23; x += 2) ringImg.data.fill(250, (5 * 40 + x) * 4, (5 * 40 + x) * 4 + 3);
  ok(!CL2.focusRing({ ...ringImg, data: Buffer.alloc(40 * 30 * 4, 30) }, { left: 8, top: 12, width: 15, height: 4 }), 'no ring on a dark screen');
  eq(CL2.lanCardWord(W2("Survival lab Dedicated Server's world")).text, 'Dedicated');
  eq(['Online play is not rated During online play', 'Download Resource Packs? The owner of this world requires players to download', 'Unknown External Server', 'Settings Play'].map((t) => CL2.joinPromptKind(W2(t))), ['rated', 'packs', 'external', null]);
  ok(CL2.loadingScreen(W2('Generating World Loading Resources')) && !CL2.loadingScreen(W2('Resume Game Settings')), 'loading screens');
  ok(CL2.ownWorldListed(W2('Survival Creative lab oun world')) && !CL2.ownWorldListed(W2("Dedicated Server's world")), 'the own world read loosely');
  ok(CL2.titleWords(W2('P rare SAA FES @iMoJjang AB Alex, 1')) && !CL2.titleWords(W2('Mojang Studios loading')), 'the classic menu by its Mojang AB and the skin');
  const t0 = Date.now(), n = e2e('joinno', { APP_PORT: '19132', APP_TRANSPORT: 'raknet', FAKE_JOIN_REFUSE: '1', APP_TESSERACT: path.join(FAKE, 'tesseract'), APP_JOIN_OCR_MS: '50' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(n.runDir);
  ok(n.status === 1 && /ゲームが参加をやめました: You need to authenticate to Microsoft services\./.test(n.text) && Date.now() - t0 < 60_000, n.text.slice(-1200));
});
await t('run: the LAN join reads the screen (OCR): the title → A, PLAY without focus → DOWN, its LAN world focused → A; a LAN world that never shows is said with what to check', () => {
  const r = e2e('lanocr', { APP_PORT: '19132', APP_TESSERACT: path.join(FAKE, 'tesseract') }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(r.runDir);
  const run = fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8');
  ok(r.status === 0 && r.state.uri === 'lan' && JSON.stringify(r.state.pads) === JSON.stringify(['BUTTON_A', 'DPAD_DOWN', 'BUTTON_A']) && /PLAY の LAN のワールドを選びます/.test(run), `exit ${r.status} ${JSON.stringify(r.state.pads)}\n${run.slice(-1200)}`);
  // the classic title (Play / Settings): its Play pressed once it is the green one (the first move turns the focus on)
  const c = e2e('lanclassic', { APP_PORT: '19132', APP_TESSERACT: path.join(FAKE, 'tesseract'), FAKE_OCR_TITLE: '1' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(c.runDir);
  ok(c.status === 0 && JSON.stringify(c.state.pads) === JSON.stringify(['DPAD_UP', 'BUTTON_A', 'DPAD_DOWN', 'BUTTON_A']) && /タイトルの Play を押します/.test(fs.readFileSync(path.join(c.runDir, 'run.txt'), 'utf8')), `exit ${c.status} ${JSON.stringify(c.state.pads)}`);
  // the player's own world listed too (prepare puts one there): "A Play" shows on its card as well — A only once the LAN
  // world's card has the focus's white ring
  const o = e2e('lanown', { APP_PORT: '19132', APP_TESSERACT: path.join(FAKE, 'tesseract'), FAKE_OWN_WORLD: '1' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(o.runDir);
  ok(o.status === 0 && o.state.uri === 'lan' && !o.state.openedOwn && JSON.stringify(o.state.pads) === JSON.stringify(['BUTTON_A', 'DPAD_DOWN', 'DPAD_DOWN', 'BUTTON_A']), `exit ${o.status} ${JSON.stringify(o.state.pads)} own ${o.state.openedOwn}`);
  // the classic menu whose buttons' words OCR does not read (the CI device: only "©Mojang AB" and the skin): A, never B
  const m = e2e('lanmojang', { APP_PORT: '19132', APP_TESSERACT: path.join(FAKE, 'tesseract'), FAKE_OCR_MOJANG: '1' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(m.runDir);
  ok(m.status === 0 && m.state.uri === 'lan' && m.state.pads[0] === 'BUTTON_A' && !m.state.pads.includes('BUTTON_B') && /タイトル（ボタンの文字は読めず）: ゲームパッド A/.test(fs.readFileSync(path.join(m.runDir, 'run.txt'), 'utf8')), `exit ${m.status} ${JSON.stringify(m.state.pads)}`);
  // the server spawns the player while the app still loads (the server's packs): joined is the world on the device's screen
  const ld = e2e('lanloading', { APP_PORT: '19132', APP_TESSERACT: path.join(FAKE, 'tesseract'), FAKE_LOADING: '3', APP_JOIN_OCR_MS: '50' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(ld.runDir);
  const ldRun = fs.readFileSync(path.join(ld.runDir, 'run.txt'), 'utf8');
  ok(ld.status === 0 && /Player Spawned: Steve.*（アプリの読み込み \d+ 秒）/.test(ldRun) && ld.state.phase === 'world', `exit ${ld.status} phase ${ld.state.phase}\n${ldRun.slice(-800)}`);
  // the LAN way's questions (as on the CI device: "Online play is not rated", then "Download Resource Packs?") go on with
  // the controller's A — their button that goes on has its focus — not a tap
  const q = e2e('lanprompts', { APP_PORT: '19132', APP_TESSERACT: path.join(FAKE, 'tesseract'), FAKE_LAN_PROMPTS: '1', APP_JOIN_OCR_MS: '50' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(q.runDir);
  const qRun = fs.readFileSync(path.join(q.runDir, 'run.txt'), 'utf8');
  ok(q.status === 0 && /参加の確認（rated）: ゲームパッド A/.test(qRun) && /参加の確認（packs）: ゲームパッド A/.test(qRun) && !q.state.calls.some((c) => /^shell input tap/.test(c)), `exit ${q.status} ${JSON.stringify(q.state.pads)}\n${qRun.slice(-1200)}`);
  const n = e2e('lannone', { APP_PORT: '19132', APP_TESSERACT: path.join(FAKE, 'tesseract'), FAKE_LAN_NONE: '1', APP_LAN_JOIN_MS: '1500' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(n.runDir);
  ok(n.status === 1 && /LAN のワールドが出ない: 端末の中継（UDP 7551）と BDS の LAN の公開を確かめる/.test(n.text), n.text.slice(-1500));
});
await t('run: the content log on and no file yet (the game makes it at its first line) is a client that logged nothing: absent passes, the report says none', () => {
  const sc = path.join(tmp, 'cl-none.txt'); fs.writeFileSync(sc, 'launch\njoin\nuntil joined 5000\nabsent clientlog ERROR\n');
  const r = e2e('clnone', { APP_PORT: '19132', FAKE_OPTIONS: 'content_log_file:1\\nscreen_animations:0' }, ['--scenario', sc]);
  made.push(r.runDir);
  const rep = fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8'), run = fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8');
  ok(r.status === 0 && /none（コンテンツログはオン、まだ 1 行も出ていない）/.test(run) && /- なし（コンテンツログはオン。/.test(rep) && !/ファイルがありませんでした/.test(rep), `exit ${r.status}\n${rep.slice(0, 1500)}`);
  // the setting off: said as it is
  const o = e2e('cloff', { APP_PORT: '19132', FAKE_OPTIONS: 'content_log_file:0' }, ['--scenario', sc]);
  made.push(o.runDir);
  ok(/ゲームのコンテンツログのファイルがありませんでした（ゲームの設定 content_log_file:0）/.test(fs.readFileSync(path.join(o.runDir, 'report.md'), 'utf8')), 'off: said');
});
await t('run: pictures from the emulator (the host makes them) when it shows the same as the device\'s screencap; timed once', () => {
  const r = e2e('emushot', { APP_PORT: '19132', FAKE_EMU_SHOT: '1' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(r.runDir);
  const run = fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8');
  ok(r.status === 0 && /画面の撮り方: エミュレータの画像（\d+ ms。端末の screencap は \d+ ms）/.test(run) && r.state.adbShots === 1 && r.state.emuShots >= 2, `exit ${r.status} adb ${r.state.adbShots} emu ${r.state.emuShots}\n${run.slice(-800)}`);
  const n = e2e('adbshot', { APP_PORT: '19132' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(n.runDir);
  ok(n.status === 0 && /画面の撮り方: 端末の screencap（\d+ ms）（エミュレータの画像は撮れません）/.test(fs.readFileSync(path.join(n.runDir, 'run.txt'), 'utf8')), 'no picture from the emulator: the device\'s');
});
await t('relay: built from app/relay (a static binary) and it relays: each peer its own session, the answers back (on a Linux x86_64 machine with cc)', async () => {
  const D3 = await imp('app/lib/android.mjs');
  // the device's controller (uinput): no C library, a few kilobytes, it says how it is used
  if (process.platform === 'linux' && process.arch === 'x64' && spawnSync('cc', ['--version']).status === 0) {
    const pad = D3.padBinary(path.join(tmp, 'pad-lab'));
    const u = typeof pad === 'string' ? spawnSync(pad, [], { encoding: 'utf8' }) : null;
    ok(typeof pad === 'string' && fs.statSync(pad).size < 64 * 1024 && u.status === 2 && /usage: lab-pad <fifo>/.test(u.stdout), JSON.stringify(pad) + (u ? u.stdout : ''));
  }
  if (process.platform !== 'linux' || process.arch !== 'x64' || spawnSync('cc', ['--version']).status !== 0) { ok(typeof D3.relayBinary(path.join(tmp, 'relay-none')) === 'object', 'elsewhere it says why'); return; }
  const bin = D3.relayBinary(path.join(tmp, 'relay-lab'));
  ok(typeof bin === 'string' && fs.existsSync(bin), JSON.stringify(bin));
  const dgram = await import('node:dgram');
  const echo = dgram.createSocket('udp4'); echo.on('message', (m, r) => echo.send(Buffer.concat([Buffer.from('echo:'), m]), r.port, r.address));
  await new Promise((res) => echo.bind(0, '127.0.0.1', res));
  const lp = 40000 + Math.floor(Math.random() * 20000), relay = spawn(bin, [String(lp), '127.0.0.1', String(echo.address().port)], { stdio: 'ignore' });
  await sleep(300);
  const ask = (tag) => new Promise((res) => { const c = dgram.createSocket('udp4'); c.on('message', (m) => { c.close(); res(String(m)); }); c.send(tag, lp, '127.0.0.1'); setTimeout(() => { try { c.close(); } catch { /* closed */ } res('timeout'); }, 3000); });
  const got = await Promise.all([ask('a'), ask('b')]);
  relay.kill(); echo.close();
  eq(got.sort(), ['echo:a', 'echo:b']);
  eq(D3.relayBinary(path.join(tmp, 'relay-lab')), bin, 'built once');
  // --reflect (root: packet and raw sockets): a broadcast leaving this machine to the port comes to the target as a unicast
  // from the sender's own address and port — the same datagram once (each network's copy). Packets leaving the machine
  // reach only a packet socket of all protocols: one for IPv4 alone saw none on the CI device
  if (process.getuid?.() === 0) {
    const rx = dgram.createSocket('udp4'), got2 = [];
    rx.on('message', (m, r) => got2.push(`${r.port}:${m.length}`));
    await new Promise((res) => rx.bind(0, '127.0.0.1', res));
    const bp = 40000 + Math.floor(Math.random() * 20000), rf = spawn(bin, ['--reflect', String(bp), '127.0.0.1', String(rx.address().port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let said = ''; rf.stdout.on('data', (d) => { said += d; });
    await sleep(400);
    const tx = dgram.createSocket('udp4');
    await new Promise((res) => tx.bind(bp, res)); tx.setBroadcast(true);
    await new Promise((res) => tx.send(Buffer.alloc(64, 7), bp, '255.255.255.255', res));
    await sleep(800);
    rf.kill(); tx.close(); rx.close();
    eq(got2, [`${bp}:64`], `reflected (${said.trim()})`);
    ok(/reflected #1 64 bytes from \S+:\d+/.test(said), said);
  }
});
await t('run: the player never spawns → FAIL at that line, with its screen and a note', () => {
  const r = e2e('nojoin', { FAKE_NOJOIN: '1', APP_TESSERACT: path.join(FAKE, 'tesseract') }, ['--scenario', path.join(tmp, 'short.txt')]);
  made.push(r.runDir);
  ok(r.status === 1, `exit ${r.status}\n${r.text}`);
  ok(/✘ 3 until joined 3000/.test(r.text) && /ワールドに出ていません/.test(r.text), r.text);
  ok(/（画面の文字: Resume Game Settings Respawn）/.test(r.text), 'what the game says on its screen, read at the end: ' + r.text.slice(-800));
  ok(fs.existsSync(path.join(r.runDir, 'shots', '01-fail-line3.png')), 'fail screenshot');
  const rep = fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8');
  ok(/ワールドに出ていません/.test(rep) && /## 次にやること/.test(rep) && /; every 15000 tap/.test(rep), 'note + next step in the report:\n' + rep);
  ok(r.state.bds.includes('down'), 'the BDS was stopped: ' + r.state.bds.join(' / '));
  const db = fs.readFileSync(path.join(r.runDir, 'dropbox.txt'), 'utf8');
  ok(/^== data_app_crash ==\n/.test(db) && /Process: com\.mojang\.minecraftpe/.test(db) && /IllegalStateException: boom/.test(db) && !/\tat |system_server_crash/.test(db), 'dropbox.txt: the crash record, no stack frames:\n' + db);
});
await t('run: installed as Google Play would (-i com.android.vending); a device that refuses it gets a plain install', () => {
  const r = e2e('noinst', { FAKE_NO_INSTALLER: '1', APP_PORT: '19132' });
  made.push(r.runDir);
  const ins = r.state.calls.filter((x) => /^install-multiple/.test(x));
  ok(r.status === 0 && ins.length === 2 && /-i com\.android\.vending/.test(ins[0]) && !/-i /.test(ins[1]), ins.join('\n') + '\n' + r.text);
});
await t('run: the PairIP license screen is named in the report, with what it needs', () => {
  const r = e2e('pairip', { FAKE_PAIRIP: '1', APP_PORT: '19132' });
  made.push(r.runDir);
  const rep = fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8');
  ok(/ライセンス確認（PairIP）で止められました/.test(rep) && /--account で試してください/.test(rep), rep);
});
await t('emulator: the adb key exists before it starts; a device that stays "unauthorized" stops the wait with the reason', async () => {
  const D = await imp('app/lib/android.mjs');
  const kd = path.join(tmp, 'keys2'), st = path.join(tmp, 'unauth.json'); fs.writeFileSync(st, JSON.stringify({}));
  process.env.FAKE_APP_STATE = st;   // (the fake adb keeps its state there)
  ok(D.ensureAdbKey(path.join(FAKE, 'adb'), { APP_ADBKEY_DIR: kd }) && fs.existsSync(path.join(kd, 'adbkey.pub')), 'made with adb keygen when the server did not make it');
  ok(D.ensureAdbKey('/nonexistent-adb', { APP_ADBKEY_DIR: kd }), 'an existing key is left alone');
  process.env.FAKE_UNAUTHORIZED = '1';
  let e = null, t0 = Date.now();
  try { await D.waitBoot(new D.Adb({ bin: path.join(FAKE, 'adb') }), { timeoutMs: 20_000, unauthorizedMs: 500, log: () => {} }); } catch (x) { e = x; }
  delete process.env.FAKE_UNAUTHORIZED; delete process.env.FAKE_APP_STATE;
  ok(/未認証/.test(e?.message ?? '') && /adbkey\.pub/.test(e?.hint ?? '') && Date.now() - t0 < 15_000, 'fails fast with the reason: ' + e?.message);
});
await t('in GitHub Actions a failing command leaves an annotation (private: what it said, masked; else: that it failed), never silence', () => {
  const r = cli(['vending', '--frob'], { GITHUB_ACTIONS: 'true', APP_REPO_VISIBILITY: 'private', GOOGLE_EMAIL: FAKE_EMAIL_G });
  const ann = r.text.split('\n').find((l) => l.startsWith('::error title=node lab.mjs app vending が失敗::'));
  ok(r.status === 1 && ann && /知らないオプション/.test(decodeURIComponent(ann.replace(/%0A/g, '\n'))), r.text);
  const pub = cli(['vending', '--frob'], { GITHUB_ACTIONS: 'true', APP_REPO_VISIBILITY: 'public', GOOGLE_EMAIL: FAKE_EMAIL_G, GITHUB_RUN_ID: '42' });
  const pa = pub.text.split('\n').find((l) => l.startsWith('::error title=node lab.mjs app vending が失敗::'));
  ok(pub.status === 1 && pa && !/知らないオプション/.test(pa) && /app ci watch 42/.test(pa), pub.text);
  const q = cli(['vending', '--frob']);
  ok(!/::error/.test(q.text), 'not outside Actions');
});
await t('run: a server command that fails stops the run', () => {
  fs.writeFileSync(path.join(tmp, 'boom.txt'), 'launch\ndo boom\nshot never\n');
  const r = e2e('boom', {}, ['--scenario', path.join(tmp, 'boom.txt')]);
  made.push(r.runDir);
  ok(r.status === 1 && /✘ 2 do boom/.test(r.text) && /unknown command/.test(r.text), r.text);
});
await t('run: 19132 busy → the deep link follows the port the BDS really took', () => {
  const r = e2e('port', { FAKE_PORT_TAKEN: '19140', APP_TRANSPORT: 'raknet' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(r.runDir);
  ok(r.status === 0, `exit ${r.status}\n${r.text}`);
  // (through the device's relay the game always joins 127.0.0.1:19132; the relay goes on to the port the BDS took)
  ok(r.state.uri.includes('serverUrl=127.0.0.1&serverPort=19132') && /lab-relay 19132 10\.0\.2\.2 19140/.test(r.state.relay ?? ''), `${r.state.uri} / ${r.state.relay}`);
  ok(/19140 で起動しました/.test(fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8')), 'said so');
  // straight to the BDS (APP_JOIN_VIA=direct): the link itself follows the port
  const d = e2e('port-direct', { FAKE_PORT_TAKEN: '19140', APP_TRANSPORT: 'raknet', APP_JOIN_VIA: 'direct' }, ['--scenario', path.join(tmp, 'joinonly.txt')]);
  made.push(d.runDir);
  ok(d.status === 0 && d.state.uri.includes('serverUrl=10.0.2.2&serverPort=19140'), `exit ${d.status} ${d.state.uri}`);
});
await t('run: the BDS does not start → a report anyway, next step named, exit 1', () => {
  const r = e2e('upfail', { FAKE_UP_FAIL: '1' });
  made.push(r.runDir);
  ok(r.status === 1 && /途中で止まりました: BDS が起動しませんでした/.test(r.text) && /bds go -a jsonui_demo/.test(r.text), r.text);
  ok(fs.existsSync(path.join(r.runDir, 'report.md')) && fs.existsSync(path.join(r.runDir, 'index.html')), 'report written');
});
await t('run: interrupted (SIGTERM) → cleans up (logcat, BDS) and still writes the report', async () => {
  fs.writeFileSync(path.join(tmp, 'long.txt'), 'launch\njoin\nuntil joined 20000\nwait 60000\nshot never\n');
  const p = e2eStart('sig', {}, ['--scenario', path.join(tmp, 'long.txt')]);
  for (let i = 0; i < 200 && !/✔ 3 until joined/.test(p.text()); i++) await new Promise((r) => setTimeout(r, 100));
  p.c.kill('SIGTERM');
  const code = await p.done;
  const runDir = path.join(TOP, 'app', /→ (app\/runs\/\S+)/.exec(p.text())?.[1]?.replace(/^app\//, '') ?? 'none');
  made.push(runDir);
  const st = JSON.parse(fs.readFileSync(p.state, 'utf8'));
  ok(code === 130 && /中断しました/.test(p.text()), `exit ${code}\n${p.text()}`);
  ok(st.bds.includes('down') && fs.existsSync(path.join(runDir, 'report.md')), 'down + report');
  ok(!fs.existsSync(path.join(TOP, 'app', '.lab', 'run.lock')), 'lock released');
});
await t('run: a second run while one is going is refused', () => {
  fs.mkdirSync(path.join(TOP, 'app', '.lab'), { recursive: true });
  const holder = spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)']);
  fs.writeFileSync(path.join(TOP, 'app', '.lab', 'run.lock'), JSON.stringify({ pid: holder.pid }));
  const r = cli(['run', '-a', 'jsonui_demo', '--no-fetch']);
  holder.kill(); fs.rmSync(path.join(TOP, 'app', '.lab', 'run.lock'), { force: true });
  ok(r.status === 1 && /別の app run が動いています/.test(r.text), r.text);
});
await t('cli: typos and missing values are errors with the fix, not ignored', () => {
  let r = cli(['run', '-a', 'jsonui_demo', '--nofetch']); ok(r.status === 1 && /知らないオプション --nofetch/.test(r.text), r.text);
  r = cli(['run', '-a']); ok(r.status === 1 && /-a の後ろに値が要ります/.test(r.text), r.text);
  r = cli(['run', '-a', 'no_such_addon']); ok(r.status === 1 && /bds\/addons\/no_such_addon がありません/.test(r.text) && /jsonui_demo/.test(r.text), r.text);
  r = cli(['run', '-a', 'jsonui_demo', '--bds', 'latest']); ok(r.status === 1 && /--bds latest は使えません/.test(r.text), r.text);
  r = cli(['frobnicate']); ok(r.status === 1 && /知らないコマンド/.test(r.text), r.text);
  fs.writeFileSync(path.join(tmp, 'bad.txt'), 'launch\ntap 0.5\n');
  r = cli(['run', '-a', 'jsonui_demo', '--scenario', path.join(tmp, 'bad.txt')]); ok(r.status === 1 && /bad\.txt:2: 書き方: tap/.test(r.text), r.text);
  r = cli(['tap', '0.5', '0.5'], { FAKE_APP_STATE: path.join(tmp, 'none.json'), APP_ADB: '/nonexistent/adb' }); ok(r.status === 1 && /エミュレータが動いていません/.test(r.text), r.text);
});
await t('self-contained: no APK and no Google token → the fix is a bds-lab command (never another project)', () => {
  const r = cli(['run', '-a', 'jsonui_demo'], { APP_APK_DIR: '', GOOGLE_EMAIL: '', GOOGLE_AAS_TOKEN: '', APP_ENV_FILE: path.join(tmp, 'none.env'), HOME: tmp });
  ok(r.status === 1 && /node lab\.mjs app token/.test(r.text) && !/bedrock-binary/.test(r.text), r.text);
  const s = cli(['secrets'], { GOOGLE_EMAIL: '', GOOGLE_AAS_TOKEN: '', APP_ENV_FILE: path.join(tmp, 'none.env') });
  ok(s.status === 1 && /app token/.test(s.text) && !/bedrock-binary/.test(s.text), s.text);
  // no message a person sees names another project (comments may credit it; an import of the lab's own bundled copy is no message)
  for (const f of ['app/app.mjs', 'app/lib/apk.mjs', 'app/lib/android.mjs', 'app/lib/scenario.mjs', 'app/lib/report.mjs']) {
    const code = fs.readFileSync(path.join(TOP, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^import .* from '[^']+';$/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
    ok(!/bedrock-binary/.test(code), `${f} tells people about bedrock-binary`);
  }
});
await t('login: browsers found per OS, the oauth_token cookie picked, no window on a bare Linux', async () => {
  const L = await imp('app/lib/login.mjs');
  const has = (set) => (p) => set.includes(p);
  const mac = L.browserCandidates({ platform: 'darwin', env: {}, home: '/Users/a', exists: has(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']), which: () => null });
  eq(mac, ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Users/a/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
  const win = L.browserCandidates({ platform: 'win32', env: { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, exists: has(['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']), which: () => null });
  eq(win, ['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']);
  const lin = L.browserCandidates({ platform: 'linux', env: { APP_BROWSER: '/opt/b' }, exists: has(['/opt/b', '/usr/bin/chromium']), which: (n) => (n === 'chromium' ? '/usr/bin/chromium' : null) });
  eq(lin, ['/opt/b', '/usr/bin/chromium']);
  eq([L.canShowWindow({ platform: 'linux', env: {} }), L.canShowWindow({ platform: 'linux', env: { WAYLAND_DISPLAY: 'w' } }), L.canShowWindow({ platform: 'darwin', env: {} }), L.canShowWindow({ platform: 'win32', env: {} })], [false, true, true, true]);
  eq(L.pickOauthToken([{ name: 'oauth_token', domain: 'evil.com', value: 'oauth2_4/x' }, { name: 'oauth_token', domain: 'accounts.google.com', value: 'nope' }]), null);
  eq(L.pickOauthToken([{ name: 'oauth_token', domain: '.accounts.google.com', value: 'oauth2_4/ok' }]), 'oauth2_4/ok');
  eq(L.cftExecutable('/c', 'mac-arm64'), '/c/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
});
await t('login: the browser signs in → the token is picked up, the browser closed and its profile deleted', async () => {
  const L = await imp('app/lib/login.mjs');
  const cache = path.join(tmp, 'login-cache'), argsFile = path.join(tmp, 'bargs.json');
  process.env.FAKE_LOGIN_AFTER = '3'; process.env.FAKE_BROWSER_ARGS = argsFile; process.env.DISPLAY ??= ':0';
  const tok = await L.autoOauthToken({ cacheDir: cache, browser: path.join(FAKE, 'browser.mjs'), timeoutMs: 20000 });
  eq(tok, 'oauth2_4/fake-login-token');
  eq(fs.readdirSync(cache).filter((n) => n.startsWith('login-')), []);
  const a = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  ok(a.includes('--remote-debugging-port=0') && a.includes(L.LOGIN_URL) && !a.some((x) => /enable-automation|headless/.test(x)), 'a normal window: ' + a.join(' '));
  process.env.FAKE_BROWSER_QUIT = '1';
  let e = null; try { await L.autoOauthToken({ cacheDir: cache, browser: path.join(FAKE, 'browser.mjs'), timeoutMs: 20000 }); } catch (x) { e = x; }
  delete process.env.FAKE_BROWSER_QUIT; delete process.env.FAKE_LOGIN_AFTER; delete process.env.FAKE_BROWSER_ARGS;
  ok(/閉じられました/.test(e?.message), 'closed early: ' + e?.message);
  eq(fs.readdirSync(cache).filter((n) => n.startsWith('login-')), []);
});
await t('token: automatic from the browser to .env.local, no manual step', () => {
  const home = path.join(tmp, 'tokhome'); fs.mkdirSync(home, { recursive: true });
  const fakeApkeep = path.join(tmp, 'apkeep-fake.mjs');
  fs.writeFileSync(fakeApkeep, "#!/usr/bin/env node\nconst a=process.argv; if (a.includes('--oauth-token') && a[a.indexOf('--oauth-token')+1]==='oauth2_4/fake-login-token') console.log('AAS Token: aas_et/' + 'Z'.repeat(60)); else process.exit(1);\n"); fs.chmodSync(fakeApkeep, 0o755);
  const envFile = path.join(TOP, '.env.local'), had = fs.existsSync(envFile) ? fs.readFileSync(envFile) : null;
  try {
    const r = cli(['token', '--email', 'me@example.com'], { APP_LOGIN: 'cdp', APP_BROWSER: path.join(FAKE, 'browser.mjs'), APKEEP_BIN: fakeApkeep, DISPLAY: ':0', GOOGLE_EMAIL: '', GOOGLE_AAS_TOKEN: '', FAKE_LOGIN_AFTER: '2' });
    ok(r.status === 0 && /保存しました/.test(r.text) && !/oauth_token（貼っても/.test(r.text), r.text);
    const saved = K.parseEnv(fs.readFileSync(envFile, 'utf8'));
    ok(saved.GOOGLE_EMAIL === 'me@example.com' && /^aas_et\/Z+$/.test(saved.GOOGLE_AAS_TOKEN), JSON.stringify(saved));
    ok(!r.text.includes('Z'.repeat(20)), 'the token is not printed');
  } finally { if (had) fs.writeFileSync(envFile, had); else fs.rmSync(envFile, { force: true }); }
});
await t('apkeep on macOS: the pinned Homebrew bottle, no Homebrew needed; a changed bottle is refused', async () => {
  const d = path.join(tmp, 'bottle'); fs.mkdirSync(path.join(d, 'apkeep', '1.0.0_1', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(d, 'apkeep', '1.0.0_1', 'bin', 'apkeep'), '#!/bin/sh\necho apkeep\n');
  spawnSync('tar', ['-czf', path.join(tmp, 'b.tgz'), '-C', d, 'apkeep']);
  const tgz = fs.readFileSync(path.join(tmp, 'b.tgz')), sha = crypto.createHash('sha256').update(tgz).digest('hex');
  const bottles = { 'darwin-arm64': { sha256: sha, member: 'apkeep/1.0.0_1/bin/apkeep' } };
  let asked = null;
  const tools = path.join(tmp, 'mac-tools');
  const bin = await K.ensureApkeep(tools, { platform: 'darwin', arch: 'arm64', darwinMajor: 24, bottles, env: { PATH: '/nonexistent' }, log: () => {}, fetchBuffer: async (u, h) => { asked = { u, h }; return tgz; } });
  ok(asked.u.endsWith(`sha256:${sha}`) && asked.h.authorization === 'Bearer QQ==', JSON.stringify(asked));
  ok(fs.readFileSync(bin, 'utf8').includes('echo apkeep') && (fs.statSync(bin).mode & 0o111) !== 0, 'unpacked, runnable');
  ok(fs.readdirSync(tools).every((n) => !n.startsWith('.bottle-')), 'no temp left');
  let e = null;
  try { await K.ensureApkeep(path.join(tmp, 'mac-tools2'), { platform: 'darwin', arch: 'arm64', darwinMajor: 24, bottles, env: { PATH: '/nonexistent' }, log: () => {}, fetchBuffer: async () => Buffer.concat([tgz, Buffer.from('x')]) }); } catch (x) { e = x; }
  ok(/ハッシュが一致しません/.test(e?.message) && !fs.existsSync(path.join(tmp, 'mac-tools2', 'apkeep-1.0.0')), 'tampered → refused, nothing kept: ' + e?.message);
  eq(Object.keys(K.APKEEP_BOTTLES).sort(), ['darwin-arm64', 'darwin-x64']);
});
await t('cli: status names the one next thing; help lists every step', () => {
  const r = cli([], { ANDROID_HOME: '', ANDROID_SDK_ROOT: '', APP_ADB: '', HOME: tmp, APP_APK_DIR: '' });
  ok(r.status === 0 && /✘ Android SDK/.test(r.text) && /次にやること: Android Studio/.test(r.text), r.text);
  const h = cli(['help']);
  for (const w of ['launch', 'join', 'until joined', 'until stable', 'shot', 'tap', 'do <コマンド>', '; every', 'absent']) ok(h.text.includes(w), 'help: ' + w);
});
await t('cli: init writes an app.txt that parses; refuses to overwrite', () => {
  const d = path.join(TOP, 'bds', 'addons', '_apptest');
  fs.mkdirSync(path.join(d, 'bp'), { recursive: true }); fs.writeFileSync(path.join(d, 'bp', 'manifest.json'), '{}');
  try {
    let r = cli(['init', '-a', '_apptest']); ok(r.status === 0, r.text);
    const p = S.parseScenario(fs.readFileSync(path.join(d, 'app.txt'), 'utf8')); eq(p.errors, []); ok(p.steps.some((x) => x.verb === 'join'), 'joins');
    r = cli(['init', '-a', '_apptest']); ok(r.status === 1 && /もうあります/.test(r.text), r.text);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
await t('screen: the grid overlay marks every 10 % and keeps the size', async () => {
  const { gridOverlay } = await imp('app/lib/screen.mjs');
  const w = 400, h = 200, img = { w, h, data: Buffer.alloc(w * h * 4, 255) };
  const g = gridOverlay(img);
  eq([g.w, g.h], [w, h]);
  const at = (x, y) => [...g.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
  ok(at(200, 150)[2] < 100, 'the 50 % line is yellow ' + at(200, 150));
  ok(at(40, 150)[1] < 200, 'a 10 % line is drawn ' + at(40, 150));
  eq(at(55, 150), [255, 255, 255]);
});
await t('token: oauth_token → AAS token through apkeep; bad input refused before anything runs', async () => {
  const aas = 'aas_et/' + 'Q'.repeat(60);
  let args = null;
  const got = await K.exchangeToken({ toolsDir: path.join(tmp, 'tools'), email: 'me@example.com', oauthToken: 'oauth2_4/abc', env: { APKEEP_BIN: process.execPath, GOOGLE_AAS_TOKEN: 'old' }, run: (b, a, o) => { args = { a, env: o.env }; return { status: 0, stdout: `AAS Token: ${aas}\n`, stderr: '' }; }, log: () => {} });
  eq(got, aas); eq(args.a, ['-e', 'me@example.com', '--oauth-token', 'oauth2_4/abc']); ok(!('GOOGLE_AAS_TOKEN' in args.env), 'no old secret in the child');
  let e = null; try { await K.exchangeToken({ toolsDir: tmp, email: 'me@example.com', oauthToken: 'ya29.x', run: () => { throw new Error('ran'); } }); } catch (x) { e = x; } ok(/oauth_token の形/.test(e?.message), e?.message);
  e = null; try { await K.exchangeToken({ toolsDir: tmp, email: 'nope', oauthToken: 'oauth2_4/x', run: () => { throw new Error('ran'); } }); } catch (x) { e = x; } ok(/メールアドレス/.test(e?.message), e?.message);
  const f = path.join(tmp, 'env', '.env.local'); K.saveEnv(f, { GOOGLE_EMAIL: 'me@example.com', GOOGLE_AAS_TOKEN: aas }); K.saveEnv(f, { OTHER: '1' });
  eq((fs.statSync(f).mode & 0o777).toString(8), '600'); eq(K.parseEnv(fs.readFileSync(f, 'utf8')), { GOOGLE_EMAIL: 'me@example.com', GOOGLE_AAS_TOKEN: aas, OTHER: '1' });
  eq(Object.keys(K.cleanEnv({ A: '1', GOOGLE_EMAIL: 'x', GOOGLE_AAS_TOKEN: 'y' })), ['A']);
});
await t('scenario: until stable waits through a black screen; until joined counts each spawn once', async () => {
  const black = pngEncode({ w: 16, h: 16, data: Buffer.alloc(16 * 16 * 4, 0).fill(255, 0, 0) });
  const dir = path.join(tmp, 'unit'); fs.mkdirSync(dir, { recursive: true });
  const slog = path.join(dir, 'server.log'); fs.writeFileSync(slog, 'Player Spawned: A xuid: 1\n');
  const img = (() => { const w = 16, h = 16, d = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = (i * 37) & 255; d[i * 4 + 1] = (i * 11) & 255; d[i * 4 + 2] = 90; d[i * 4 + 3] = 255; } return pngEncode({ w, h, data: d }); })();
  let n = 0;
  const adb = { screencap: () => (n++ < 3 ? black : img), shell: () => ({ status: 0, stdout: '', stderr: '' }), run: () => ({ status: 0 }), pid: () => 1 };
  const ctx = { adb, runDir: dir, decode: pngDecode, pkg: K.PACKAGE, logcatFile: path.join(dir, 'lc.txt'), server: { logFile: slog, joinUri: 'x', do: async () => ({ ok: true, lines: [] }) }, launch() {} };
  const { steps } = S.parseScenario('until stable 20000\nuntil joined 3000\nuntil joined 1500');
  const r = await S.runScenario(steps, ctx);
  ok(r.results[0].ok && n > 3, 'stable only after the black frames: ' + JSON.stringify(r.results[0]));
  ok(r.results[1].ok, 'first spawn'); ok(!r.results[2].ok && /接続が来ていません|ワールドに出ていません/.test(r.results[2].note), 'the same spawn does not count twice: ' + r.results[2].note);
  const { steps: s2 } = S.parseScenario('pull /sdcard/x ../../etc');
  const r2 = await S.runScenario(s2, { ...ctx, adb: { ...adb, run: (a) => { ctx.pulled = a[2]; return { status: 0 }; } } });
  ok(r2.ok && ctx.pulled.startsWith(path.join(dir, 'pulled') + path.sep), 'pull stays inside the run: ' + ctx.pulled);
});
await t('logcat digest: the app start/end and exception headlines, no stack frames, repeats folded, secrets masked', () => {
  const L = (pid, lv, tag, msg) => `10-02 23:48:34.157  ${pid}  ${pid + 1} ${lv} ${tag}: ${msg}`;
  const lc = [
    L(500, 'I', 'ActivityManager', 'Start proc 7716:com.mojang.minecraftpe/u0a150 for top-activity {com.mojang.minecraftpe/.MainActivity}'),
    L(7716, 'I', 'A       ', 'android.accounts.AuthenticatorException: bind failure'),
    L(7716, 'E', 'A       ', '\tat android.accounts.AccountManager.convertErrorToException(AccountManager.java:2631)'),
    L(7716, 'E', 'A       ', '\t... 12 more'),
    L(7716, 'I', 'A       ', 'android.accounts.AuthenticatorException: bind failure'),
    L(7716, 'W', 'MinecraftPlatform', 'licence check: NOT_LICENSED for me@example.com aas_et/' + 'Q'.repeat(40)),
    L(900, 'E', 'SomethingElse', 'java.lang.IllegalStateException: unrelated'),
    L(326, 'I', 'Zygote  ', 'Process 4304 exited due to signal 9 (Killed)'),
    L(500, 'I', 'ActivityManager', 'Process com.mojang.minecraftpe (pid 7716) has died: fg  TOP'),
    'garbage line',
  ].join('\n');
  const d = R.logcatDigest(lc + '\n' + L(500, 'E', 'ActivityManager', '12% 8256/com.google.android.inputmethod.latin: 10% user + 1.9% kernel') + '\n' + L(500, 'E', 'ActivityManager', '+0% 8771/Okio Watchdog: 0% user + 0% kernel') + '\n' + L(500, 'E', 'ActivityManager', '100% TOTAL: 34% user + 62% kernel'), 'com.mojang.minecraftpe');
  eq(d.length, 6, d.join('\n'));
  ok(/Start proc 7716/.test(d[0]) && /has died/.test(d[1]), 'start and end first: ' + d.join('\n'));
  ok(/アプリ自身/.test(d[2]) && /NOT_LICENSED for <email> <token>$/.test(d[3]), d[3]);
  ok(/そのほか/.test(d[4]) && d[5] === '7716 I A: android.accounts.AuthenticatorException: bind failure (×2)', d[5]);
  ok(!d.some((l) => /落ちた跡|% user|TOTAL/.test(l)), 'no CPU table, no Okio "Watchdog": ' + d.join('\n'));
});
await t('logcat digest: Android itself dying comes first; apps killed only by that are one line', () => {
  const L = (pid, lv, tag, msg) => `10-03 00:40:00.000  ${pid}  ${pid} ${lv} ${tag}: ${msg}`;
  const lc = [
    L(6422, 'I', 'ActivityManager', 'Start proc 7432:com.mojang.minecraftpe/u0a192 for next-top-activity'),
    L(6422, 'E', 'AccountManagerService', 'getAuthToken failed: java.lang.NullPointerException'),
    L(6422, 'D', 'AccountManagerService', 'chatty debug line'),
    L(6422, 'E', 'AndroidRuntime', '*** FATAL EXCEPTION IN SYSTEM PROCESS: AccountManagerService'),
    L(6422, 'E', 'AndroidRuntime', 'java.lang.IllegalStateException: bad row'),
    L(6422, 'E', 'AndroidRuntime', '\tat com.android.server.accounts.AccountsDb.x(AccountsDb.java:1)'),
    ...[[7105, 'com.google.android.as'], [7210, 'com.google.android.gms']].flatMap(([pid, p]) => [
      L(pid, 'E', 'AndroidRuntime', 'FATAL EXCEPTION: main'), L(pid, 'E', 'AndroidRuntime', `Process: ${p}, PID: ${pid}`),
      L(pid, 'E', 'AndroidRuntime', 'DeadSystemException: The system died; earlier logs will point to the root cause')]),
  ].join('\n');
  const d = R.logcatDigest(lc, 'com.mojang.minecraftpe');
  ok(/落ちた跡/.test(d[0]) && /FATAL EXCEPTION IN SYSTEM PROCESS/.test(d[1]), d.join('\n'));
  ok(/巻き添え.*2 個: com\.google\.android\.as, com\.google\.android\.gms/.test(d[2]), d[2]);
  ok(/Start proc 7432/.test(d[3]), d[3]);
  ok(d.some((l) => /6422 E AccountManagerService: getAuthToken failed/.test(l)) && d.some((l) => /IllegalStateException: bad row/.test(l)), 'system_server errors kept');
  ok(!d.some((l) => /chatty|\tat |DeadSystemException: The system died|Process: com\.google/.test(l)), d.join('\n'));
  // the app's own lines: numbers-only differences fold, and the last lines before it died are kept
  const many = [L(500, 'I', 'ActivityManager', 'Start proc 3145:com.mojang.minecraftpe/u0a1 for x'), ...Array.from({ length: 40 }, (_, i) => L(3145, 'W', 'Minecraft', `INPUT device id ${i} is Crete Controller: false`)), ...Array.from({ length: 40 }, (_, i) => L(3145, 'W', 'Minecraft', `step ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? 'x' : ''} done`)), L(3145, 'E', 'Minecraft', 'the last word before dying')].join('\n');
  const m = R.logcatDigest(many, 'com.mojang.minecraftpe');
  ok(m.some((l) => /INPUT device id 0 is Crete Controller: false \(×40\)/.test(l)) && /the last word before dying/.test(m.at(-1)) && m.some((l) => /行省略/.test(l)), m.join('\n'));
});
await t('annotate: a run folder as GitHub annotations (report, run.txt, digest, dropbox, OCR of each shot), masked and escaped', () => {
  const d = path.join(tmp, 'ann', '20261003-000000-x'); fs.mkdirSync(path.join(d, 'shots'), { recursive: true });
  fs.writeFileSync(path.join(d, 'report.md'), '# app: FAIL — x\n- ✘ 6: `until joined` — 100% stuck\n');
  fs.writeFileSync(path.join(d, 'run.txt'), 'line a\n\nline b me@example.com SECRETVALUE1\n');
  fs.writeFileSync(path.join(d, 'logcat-digest.txt'), '7716 E A: boom aas_et/' + 'Q'.repeat(30) + '\n');
  fs.writeFileSync(path.join(d, 'shots', '02-fail-line6.png'), 'x'); fs.writeFileSync(path.join(d, 'shots', '01-start.png'), 'x');
  const a = R.annotations(d, { ocr: (f) => (/01-/.test(f) ? 'Play\n\nSign in ' : ''), secrets: ['SECRETVALUE1'] });
  eq(a.map((x) => x.title.replace(/（[^（]*）$/, '')), ['報告', 'run.txt', 'logcat の要約', '画面の文字（OCR）']);
  ok(a[1].body === 'line a\nline b <email> <secret>', a[1].body);
  ok(a[2].body === '7716 E A: boom <token>', a[2].body);
  ok(a[3].body === '[01-start.png] Play / Sign in\n[02-fail-line6.png] （文字なし）', a[3].body);
  eq(R.ghEscape('100%\r\nx'), '100%25%0D%0Ax');
  fs.writeFileSync(path.join(d, 'logcat-digest.txt'), Array.from({ length: 200 }, (_, i) => `${i} E T: ` + 'あ'.repeat(40)).join('\n'));
  const parts = R.annotations(d).filter((x) => x.title.startsWith('logcat'));
  ok(parts.length === 3 && parts.every((x) => Buffer.byteLength(x.body) <= 3800 + 30) && /1\/3/.test(parts[0].title) && /以下略）$/.test(parts[2].body), parts.map((x) => x.title + ' ' + Buffer.byteLength(x.body)).join(', '));
  eq(R.annotations(d).length, 5, 'no OCR without tesseract');
  const r = spawnSync(process.execPath, [path.join(TOP, 'app', 'app.mjs'), 'annotate', path.dirname(d)], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', APP_REPO_VISIBILITY: 'private' } });
  const lines = r.stdout.trim().split('\n');
  ok(r.status === 0 && lines.every((l) => /^::notice title=[^:,\n]+::/.test(l)) && lines.length === 6 && /tesseract が無い/.test(lines[5]), r.stdout + r.stderr);
  // a repository that is not private, in GitHub Actions: one notice, nothing of the run (the screen text stays sealed)
  const pub = spawnSync(process.execPath, [path.join(TOP, 'app', 'app.mjs'), 'annotate', path.dirname(d)], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', GITHUB_ACTIONS: 'true', APP_REPO_VISIBILITY: 'public' } });
  ok(pub.status === 0 && pub.stdout.trim().split('\n').length === 1 && !/line a|Play|7716|example/.test(pub.stdout), pub.stdout + pub.stderr);
});
// ---- plan B: the AAS token as the emulator's Google account (app/lib/account.mjs). Every value here is a fake ----
const AC = await imp('app/lib/account.mjs');
const FAKE_TOKEN = 'aas_et/' + 'Q'.repeat(60), FAKE_EMAIL = 'me@example.com';
await t('account: the SQL for both databases (same _id, quotes escaped, token only in accounts_ce)', () => {
  const { de } = AC.accountSql({ email: FAKE_EMAIL, aasToken: FAKE_TOKEN });
  ok(!de.includes(FAKE_TOKEN) && /INSERT INTO accounts \(name, type,/.test(de) && /SELECT _id FROM accounts/.test(de), de);
  const { ce } = AC.accountSql({ email: FAKE_EMAIL, aasToken: FAKE_TOKEN, id: 7 });
  ok(ce.includes(`VALUES (7, '${FAKE_EMAIL}', 'com.google', '${FAKE_TOKEN}')`) && /^BEGIN;/.test(ce) && /COMMIT;\n$/.test(ce), ce);
  ok(AC.accountSql({ email: "o'neil@example.com", aasToken: FAKE_TOKEN, id: 1 }).ce.includes("'o''neil@example.com'"), 'quote escaped');
  for (const bad of [{ email: FAKE_EMAIL, aasToken: 'oauth2_4/' + 'x'.repeat(40) }, { email: 'nope', aasToken: FAKE_TOKEN }, { email: FAKE_EMAIL, aasToken: FAKE_TOKEN + "'; DROP" }]) {
    let e = null; try { AC.accountSql(bad); } catch (x) { e = x; } ok(e && !String(e.message + e.hint).includes(bad.aasToken), 'refused without the value: ' + e?.message);
  }
  let e = null; try { AC.accountSql({ email: FAKE_EMAIL, aasToken: FAKE_TOKEN, id: 0 }); } catch (x) { e = x; } ok(/_id/.test(e?.message), 'bad _id');
});
await t('account: Play Store permissions from dumpsys → the privapp allowlist', () => {
  const d = '    requested permissions:\n      android.permission.INTERNET\n      android.permission.INSTALL_PACKAGES, restricted=true\n    install permissions:\n      android.permission.INTERNET: granted=true\n';
  eq(AC.requestedPerms(d), ['android.permission.INTERNET', 'android.permission.INSTALL_PACKAGES']);
  eq(AC.requestedPerms('nothing'), []);
  const x = AC.privappXml(['b.B', 'a.A', 'a.A', 'bad"x']);
  ok(/<privapp-permissions package="com\.android\.vending">/.test(x) && x.indexOf('a.A') < x.indexOf('b.B') && x.split('a.A').length === 2 && !x.includes('bad'), x);
});
await t('account: Play Store APK from a URL only with its sha256, checked before it is kept', async () => {
  const buf = Buffer.from('fake vending apk'), sha = crypto.createHash('sha256').update(buf).digest('hex'), labDir = path.join(tmp, 'vlab');
  let e = null; try { await AC.vendingApk({ url: 'https://example.com/v.apk', labDir }); } catch (x) { e = x; } ok(/APP_VENDING_SHA256/.test(e?.message), 'no sha → ' + e?.message);
  e = null; try { await AC.vendingApk({ url: 'http://example.com/v.apk', sha256: sha, labDir }); } catch (x) { e = x; } ok(/https/.test(e?.message), 'http → ' + e?.message);
  e = null; try { await AC.vendingApk({ url: 'https://example.com/v.apk', sha256: 'a'.repeat(64), labDir, fetchBuffer: async () => buf }); } catch (x) { e = x; } ok(/一致しません/.test(e?.message) && !fs.existsSync(path.join(labDir, 'vending', 'a'.repeat(64) + '.apk')), 'tampered → ' + e?.message);
  const f = await AC.vendingApk({ url: 'https://example.com/v.apk', sha256: sha, labDir, fetchBuffer: async () => buf });
  ok(fs.readFileSync(f).equals(buf), 'kept'); eq(await AC.vendingApk({}), null);
});
// a Play Store APK whose manifest asks for permissions (what the allowlist is made from)
const VENDING_APK = path.join(tmp, 'Phonesky.apk');
fs.writeFileSync(VENDING_APK, buildZip([{ name: 'AndroidManifest.xml', data: buildManifest({ pkg: 'com.android.vending', versionCode: 84102100, versionName: '41.2.21-31', perms: ['android.permission.INTERNET', 'android.permission.INSTALL_PACKAGES', 'android.permission.DELETE_PACKAGES'] }) }]));
const acct = (name, env = {}, args = [], init = {}) => {
  const state = path.join(tmp, `acct-${name}.json`);
  fs.writeFileSync(state, JSON.stringify({ phase: 'home', system: 'running', ...init }));
  const r = cli(['account', ...args], { FAKE_APP_STATE: state, GOOGLE_EMAIL: FAKE_EMAIL, GOOGLE_AAS_TOKEN: FAKE_TOKEN, APP_ACCOUNT_TIMEOUT: '3000', APKEEP_BIN: path.join(FAKE, 'apkeep'), ...env });
  return { ...r, state: JSON.parse(fs.readFileSync(state, 'utf8')) };
};
const noSecretIn = (r) => { ok(!r.text.includes(FAKE_TOKEN) && !r.text.includes(FAKE_EMAIL), 'the token or email was printed:\n' + r.text); ok(!(r.state.calls ?? []).some((c) => c.includes(FAKE_TOKEN)), 'the token was on an adb command line:\n' + r.state.calls.join('\n')); };
await t('account: written on stdin with system_server stopped, then AccountManager lists it', () => {
  const r = acct('ok');
  ok(r.status === 0 && /アカウントを書き込みました/.test(r.text) && /Play ストアを入れられません（Google Play から取れず/.test(r.text) && /com\.android\.vending を Google Play から取れませんでした/.test(r.text), r.text);
  noSecretIn(r);
  const c = r.state.calls, at = (re) => c.findIndex((x) => re.test(x));
  ok(at(/^root$/) >= 0 && at(/^shell stop$/) < at(/sqlite3 \/data\/system_de/) && at(/sqlite3 \/data\/system_de/) < at(/sqlite3 \/data\/system_ce/) && at(/sqlite3 \/data\/system_ce/) < at(/chown system:system .*restorecon/) && at(/restorecon/) < at(/^reboot$/) && at(/^reboot$/) < at(/^shell ls -d \/sdcard\/Android$/) && at(/^shell ls -d \/sdcard\/Android$/) < c.lastIndexOf('shell dumpsys account') && !c.includes('shell start'), 'order (a whole reboot, storage up before the account check):\n' + c.join('\n'));
  ok(!r.state.sql['/data/system_de/0/accounts_de.db'].includes(FAKE_TOKEN) && r.state.sql['/data/system_ce/0/accounts_ce.db'].includes(`VALUES (7, '${FAKE_EMAIL}'`), 'the _id from accounts_de went to accounts_ce');
  const s = cli(['account', 'check'], { FAKE_APP_STATE: path.join(tmp, 'acct-ok.json'), GOOGLE_EMAIL: FAKE_EMAIL, GOOGLE_AAS_TOKEN: FAKE_TOKEN });
  ok(/✔ Google アカウント/.test(s.text) && /✘ Play ストア/.test(s.text) && !s.text.includes(FAKE_EMAIL), s.text);
});
await t('account --vending: the image LicenseChecker out, Play Store into /system/priv-app with an allowlist from its manifest, then the account', () => {
  const r = acct('vending', {}, ['--vending', VENDING_APK], { vending: 'stub' });
  ok(r.status === 0 && /LicenseChecker を外します/.test(r.text) && /権限 3 個/.test(r.text) && /system のアプリとして入れました/.test(r.text) && /アカウントを書き込みました/.test(r.text), r.text);
  noSecretIn(r);
  ok(r.state.stubRemoved && r.state.vending === 'system' && /INSTALL_PACKAGES/.test(r.state.privXml) && /DELETE_PACKAGES/.test(r.state.privXml), r.state.privXml);
  ok(!r.state.calls.some((x) => /pm install/.test(x)) && !fs.existsSync(path.join(tmp, 'privapp-permissions-com.android.vending.xml')), 'no trial install; the xml is not left behind');
  const bad = path.join(tmp, 'notapk.apk'); fs.writeFileSync(bad, 'fake');
  const b = acct('vendingbad', {}, ['--vending', bad]);
  ok(b.status === 1 && /権限を読めません/.test(b.text) && !b.state.calls.includes('shell stop'), b.text);
  const e = acct('noremount', { FAKE_NOREMOUNT: '1' }, ['--vending', VENDING_APK]);
  ok(e.status === 1 && /\/system に書き込めません/.test(e.text) && /--writable-system/.test(e.text) && !e.state.calls.includes('shell stop'), e.text);
  const c = cli(['account', 'check'], { FAKE_APP_STATE: path.join(tmp, 'acct-vendingbad.json'), GOOGLE_EMAIL: FAKE_EMAIL, GOOGLE_AAS_TOKEN: FAKE_TOKEN });
  ok(/Play ストア/.test(c.text), c.text);
});
await t('account: no Play Store given → the real one from Google Play with the same account (the stand-in fails the license check)', () => {
  const log = path.join(tmp, 'apkeep.log');
  const r = acct('fromplay', { FAKE_VENDING_APK: VENDING_APK, FAKE_APKEEP_LOG: log }, [], { vending: 'stub' });
  ok(r.status === 0 && /Google Play から com\.android\.vending を取得中/.test(r.text) && /system のアプリとして入れました/.test(r.text) && r.state.vending === 'system' && r.state.stubRemoved, r.text);
  noSecretIn(r);
  ok(/-a com\.android\.vending -d google-play/.test(fs.readFileSync(log, 'utf8')) && !fs.readFileSync(log, 'utf8').includes(FAKE_TOKEN), 'apkeep asked for the Play Store, the token only in its ini');
  fs.writeFileSync(path.join(tmp, 'acct-x.json'), JSON.stringify({ vending: 'stub', system: 'running' }));
  const s0 = cli(['account', 'check'], { FAKE_APP_STATE: path.join(tmp, 'acct-x.json'), GOOGLE_EMAIL: FAKE_EMAIL, GOOGLE_AAS_TOKEN: FAKE_TOKEN });
  ok(/LicenseChecker だけ/.test(s0.text), s0.text);
  // gpdl first: it hands out the Play Store, or says why Play would not
  const g = acct('gpdl', { GPDL_BIN: path.join(FAKE, 'gpdl'), FAKE_GPDL_APK: VENDING_APK }, [], { vending: 'stub' });
  ok(g.status === 0 && /com\.android\.vending を取得中（gpdl/.test(g.text) && !/apkeep、/.test(g.text) && g.state.vending === 'system', g.text);
  const gn = acct('gpdlno', { GPDL_BIN: path.join(FAKE, 'gpdl') }, [], { vending: 'stub' });
  ok(gn.status === 0 && /gpdl: INFO delivery status=Some\(3\) \(not purchased/.test(gn.text) && /gpdl: FAIL refused/.test(gn.text) && /（apkeep、/.test(gn.text) && /Play ストアを入れられません/.test(gn.text), gn.text);
  // the Play Store taken out of Google's "Google Play" image (app vending), then used by --account
  const sdk = path.join(tmp, 'sdk-ps'), avds = path.join(tmp, 'avd-ps'), img = AC.playstoreImage();
  fs.mkdirSync(path.join(sdk, ...img.split(';')), { recursive: true });
  fs.mkdirSync(path.join(avds, `${AC.PLAYSTORE_AVD}.avd`), { recursive: true });
  fs.writeFileSync(path.join(avds, `${AC.PLAYSTORE_AVD}.avd`, 'config.ini'), `image.sysdir.1=${img.split(';').slice(1).join('/')}/\n`);
  const keys = path.join(tmp, 'adbkeys');
  const venv = { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_AVD_HOME: avds, APP_EMULATOR: path.join(FAKE, 'adb'), FAKE_PLAYSTORE_APK: VENDING_APK, FAKE_PLAYSTORE_LIB: '1', FAKE_APP_STATE: path.join(tmp, 'ps.json'), APP_ADBKEY_DIR: keys };
  fs.writeFileSync(venv.FAKE_APP_STATE, JSON.stringify({ phase: 'home' }));
  fs.rmSync(path.join(TOP, 'app', '.lab', 'vending'), { recursive: true, force: true });
  const v = cli(['vending', '--cleanup'], venv);
  const kept = path.join(TOP, 'app', '.lab', 'vending', 'playstore-000084102100', 'Phonesky.apk');
  ok(fs.existsSync(path.join(keys, 'adbkey.pub')), 'the adb key was made before the emulator started (a "user" image accepts only it)');
  ok(fs.existsSync(path.join(path.dirname(kept), 'lib', 'x86_64', 'libfake.so')) && /lib 付き/.test(v.text), 'lib/ came with it: ' + v.text);
  ok(v.status === 0 && /Play ストア 41\.2\.21-31 を取り出しました/.test(v.text) && fs.existsSync(kept) && !fs.existsSync(path.join(sdk, ...img.split(';'))) && !fs.existsSync(path.join(avds, `${AC.PLAYSTORE_AVD}.avd`)), v.text);
  const calls = JSON.parse(fs.readFileSync(venv.FAKE_APP_STATE, 'utf8')).calls;
  ok(calls.includes('shell pm path com.android.vending') && calls.some((c) => /^pull \/product\/priv-app\/Phonesky\/Phonesky\.apk /.test(c)) && calls.includes('emu kill'), calls.join('\n'));
  const again = cli(['vending'], venv);
  ok(/取り出し済み/.test(again.text) && /sha256 [0-9a-f]{64}/.test(again.text) && /APP_VENDING_SHA256/.test(again.text), 'kept, and prints the sha + how to skip extraction next time: ' + again.text);
  const u = acct('extracted', {}, [], { vending: 'stub' });
  ok(u.status === 0 && /Google Play 入りのイメージから取り出したもの/.test(u.text) && u.state.vending === 'system' && !/Google Play から com\.android\.vending を取得中/.test(u.text), u.text);
  ok(u.state.privLib && u.state.calls.some((c) => /chown -R root:root \/system\/priv-app\/Phonesky .*restorecon -R/.test(c)), 'its lib/ pushed beside it, owners and labels put right:\n' + u.state.calls.join('\n'));
  // the Play Store's load-reboot rides the account reboot: one reboot, not two (and the Play Store is confirmed after it)
  ok(u.state.calls.filter((c) => c === 'reboot').length === 1 && /置きました（アカウント投入後の再起動で読み込みます）/.test(u.text) && /system のアプリとして入れました/.test(u.text), 'one reboot for both:\n' + u.state.calls.join('\n'));
  fs.writeFileSync(venv.FAKE_APP_STATE, JSON.stringify({ phase: 'home' }));
  fs.rmSync(path.join(TOP, 'app', '.lab', 'vending'), { recursive: true, force: true });
  fs.mkdirSync(path.join(sdk, ...img.split(';')), { recursive: true });   // (--cleanup took it)
  fs.mkdirSync(path.join(avds, `${AC.PLAYSTORE_AVD}.avd`), { recursive: true });
  fs.writeFileSync(path.join(avds, `${AC.PLAYSTORE_AVD}.avd`, 'config.ini'), `image.sysdir.1=${img.split(';').slice(1).join('/')}/\n`);
  const nv = cli(['vending'], { ...venv, FAKE_PLAYSTORE_APK: '' });
  ok(nv.status === 1 && /Play ストアがありません/.test(nv.text) && JSON.parse(fs.readFileSync(venv.FAKE_APP_STATE, 'utf8')).calls.includes('emu kill'), 'no Play Store in the image: said, and the emulator stopped: ' + nv.text);
  fs.rmSync(path.join(TOP, 'app', '.lab', 'vending'), { recursive: true, force: true }); fs.rmSync(path.join(TOP, 'app', '.lab', 'emulator-playstore.log'), { force: true });
  const off = acct('vendingoff', { APP_VENDING: '0', FAKE_VENDING_APK: VENDING_APK }, [], { vending: 'stub' });
  ok(off.status === 0 && /APP_VENDING=0/.test(off.text) && /起動直後に終わります/.test(off.text) && !off.state.stubRemoved, off.text);
});
await t('account: every way it can stop says what next, never shows a value, and never leaves Android stopped', () => {
  let r = acct('noroot', { FAKE_NOROOT: '1' }); ok(r.status === 1 && /root になれません/.test(r.text) && /google_apis/.test(r.text), r.text); noSecretIn(r);
  r = acct('nosqlite', { FAKE_NOSQLITE: '1' }); ok(r.status === 1 && /sqlite3 がありません/.test(r.text) && !r.state.calls.includes('shell stop'), r.text); noSecretIn(r);
  r = acct('ignored', { FAKE_ACCOUNT_IGNORED: '1' }); ok(r.status === 1 && /読み込まれませんでした/.test(r.text) && r.state.system === 'running', r.text); noSecretIn(r);
  r = acct('nostorage', { FAKE_NOSTORAGE: '1' }); ok(r.status === 1 && /エミュレータが .* 分で戻りませんでした/.test(r.text) && r.state.system === 'running', r.text); noSecretIn(r);
  r = acct('badtoken', { GOOGLE_AAS_TOKEN: 'oauth2_4/' + 'x'.repeat(40) }); ok(r.status === 1 && /oauth_token/.test(r.text) && !(r.state.calls ?? []).includes('shell stop') && !r.text.includes('x'.repeat(40)), r.text);
  r = acct('nocred', { GOOGLE_EMAIL: '', GOOGLE_AAS_TOKEN: '' }); ok(r.status === 1 && /app token/.test(r.text), r.text);
  r = acct('typo', {}, ['frob']); ok(r.status === 1 && /知らない指定 frob/.test(r.text), r.text);
  r = cli(['run', '-a', 'jsonui_demo', '--vending', 'x.apk']); ok(r.status === 1 && /--account と一緒に/.test(r.text), r.text);
});
await t('run --account: end to end, the account written after install, the run folder clean (guard)', () => {
  const envFile = path.join(tmp, 'acct.env'); fs.writeFileSync(envFile, `GOOGLE_EMAIL="${FAKE_EMAIL}"\nGOOGLE_AAS_TOKEN="${FAKE_TOKEN}"\n`, { mode: 0o600 });
  const r = e2e('runacct', { APP_ENV_FILE: envFile, APP_PORT: '19132', APKEEP_BIN: path.join(FAKE, 'apkeep') }, ['--account']);
  made.push(r.runDir);
  ok(r.status === 0 && /PASS app\/runs\//.test(r.text) && /アカウントを書き込みました/.test(fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8')), r.text);
  ok(!fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8').includes(FAKE_EMAIL), 'no email in run.txt');
  noSecretIn(r);
  ok(r.state.calls.findIndex((x) => /^install-multiple/.test(x)) < r.state.calls.findIndex((x) => /sqlite3/.test(x)), 'after the install');
  ok(R.guard(r.runDir, [FAKE_TOKEN]).length === 0 && /Play ストアを入れられません/.test(fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8')), 'guard clean; the missing Play Store is in the report');
});
// ---- a busy device: Android's own "isn't responding" dialogs (every CI screenshot so far was one), the x86_64 build,
// the machine's state, and a job stopped from outside ----
const D = await imp('app/lib/android.mjs');
const H = await imp('app/lib/host.mjs');
await t('android: the focused window and Android\'s own dialogs; the Wait button from the layout, else keys; APP_SCREEN', () => {
  eq(D.focusOf('  mCurrentFocus=Window{5a3c0e1 u0 Application Not Responding: com.android.systemui}\n').dialog, { kind: 'anr', proc: 'com.android.systemui' });
  eq(D.focusOf('mCurrentFocus=Window{1 u0 Application Not Responding: system}').dialog, { kind: 'anr', proc: 'system' });
  eq(D.focusOf('mCurrentFocus=Window{2 u0 Application Error: com.mojang.minecraftpe}').dialog, { kind: 'crash', proc: 'com.mojang.minecraftpe' });
  const g = D.focusOf('  mCurrentFocus=Window{8e8b9f5 u0 com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity}');
  eq([g.window, g.dialog], ['com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity', null]);
  eq(D.focusOf('mCurrentFocus=null'), { window: null, dialog: null }); eq(D.focusOf(''), { window: null, dialog: null });
  eq(D.focusOf('  mCurrentFocus=Window{9 u0 com.google.android.permissioncontroller/com.android.permissioncontroller.permission.ui.GrantPermissionsActivity}').dialog, { kind: 'permission', proc: '権限の確認' });
  const pc = [], permAdb = { run: () => ({ stdout: '<hierarchy><node text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button" bounds="[100,900][620,980]" /></hierarchy>' }), shell: (w) => { pc.push(w.join(' ')); return { status: 0, stdout: '' }; } };
  ok(/許可/.test(D.answerDialog(permAdb, { kind: 'permission' })) && pc.pop() === 'input tap 360 940', 'Allow tapped');
  eq(D.grantAll({ shell: (w) => ({ status: /CAMERA/.test(w[3]) ? 1 : 0 }) }, 'p', ['android.permission.POST_NOTIFICATIONS', 'android.permission.CAMERA']), ['android.permission.POST_NOTIFICATIONS'], 'the ones Android grants (not install-time ones)');
  const xml = '<hierarchy><node index="0" text="Close app" resource-id="android:id/aerr_close" bounds="[700,440][1640,520]" /><node index="1" text="Wait" resource-id="android:id/aerr_wait" class="android.widget.Button" bounds="[700,560][1640,640]" /></hierarchy>';
  eq(D.nodeCenter(xml, 'android:id/aerr_wait'), [1170, 600]); eq(D.nodeCenter(xml, 'android:id/aerr_report'), null); eq(D.nodeCenter('ERROR: could not get idle state.', 'android:id/aerr_wait'), null);
  const calls = [], fakeAdb = (ui) => ({ run: () => ({ stdout: ui }), shell: (w) => { calls.push(w.join(' ')); return { status: 0, stdout: '' }; } });
  ok(/「待つ」を押しました/.test(D.answerDialog(fakeAdb(xml), { kind: 'anr', proc: 'system' })) && calls.pop() === 'input tap 1170 600', 'tapped Wait: ' + calls);
  calls.length = 0; ok(/キーで/.test(D.answerDialog(fakeAdb('ERROR: could not get idle state.'), { kind: 'anr', proc: 'system' })), 'keys');
  eq(calls, ['input keyevent 20', 'input keyevent 20', 'input keyevent 66'], 'DOWN DOWN ENTER: never "Close app" for system');
  calls.length = 0; D.answerDialog(fakeAdb(xml), { kind: 'crash', proc: 'x' }); eq(calls, ['input tap 1170 480'], 'a crash: Close app');
  eq(D.busiest(' 98.3 /apex/com.android.art/bin/dex2oat64\n 41.0 com.android.vending\n  3.1 system_server\n'), ['dex2oat64 98%', 'com.android.vending 41%'], 'the busy ones, by name');
  // toybox's own batch output: two looks with their headers, the processes in top's order — the last look, busiest first
  const look = (rows) => `Tasks: 403 total,   1 running, 402 sleeping,   0 stopped,   0 zombie\n  Mem:  3.8G total,  3.6G used\n400%cpu  10%user 380%idle\n  %CPU ARGS\n${rows}`;
  eq(D.busiest(look('  0.0 init\n 12.0 com.google.android.gms.persistent\n 99.0 dex2oat64\n') + look('  0.0 init\n  6.0 com.google.android.gms.persistent\n 77.0 /system/bin/surfaceflinger\n 88.0 com.android.vending:background\n'), 2),
    ['com.android.vending:background 88%', 'surfaceflinger 77%'], 'the last look only, busiest first, n of them');
  eq(D.screenSize({ APP_SCREEN: '720x1560' }), { w: 720, h: 1560, density: 280 }); eq(D.screenSize({ APP_SCREEN: '1560x720' }), { w: 720, h: 1560, density: 280 });
  eq(D.screenSize({ APP_SCREEN: '1080x2340' }).density, 440); eq(D.screenSize({ APP_SCREEN: '720x1560', APP_DENSITY: '320' }).density, 320);
  eq(D.screenSize({ APP_SCREEN: 'big' }), null); eq(D.screenSize({}), null);
  // the AVD: the size in hw.lcd.* and in a size-named skin; back to the pixel_5's without APP_SCREEN; a device frame stays
  const sdk = path.join(tmp, 'sdk-screen'), avds = path.join(tmp, 'avd-screen'), img = 'system-images;android-34;google_apis;x86_64';
  fs.mkdirSync(path.join(sdk, ...img.split(';')), { recursive: true }); fs.mkdirSync(path.join(avds, 'scr.avd'), { recursive: true });
  const cfg = path.join(avds, 'scr.avd', 'config.ini'), env = { ANDROID_HOME: sdk, ANDROID_AVD_HOME: avds, APP_SYSIMG: img, APP_EMULATOR: path.join(FAKE, 'adb'), APP_ADB: path.join(FAKE, 'adb') };
  const conf = (k) => new RegExp(`^${k.replace(/\./g, '\\.')}=(.*)$`, 'm').exec(fs.readFileSync(cfg, 'utf8'))?.[1];
  fs.writeFileSync(cfg, 'image.sysdir.1=system-images/android-34/google_apis/x86_64/\nhw.lcd.width=1080\nhw.lcd.height=2340\nhw.lcd.density=440\nskin.name=1080x2340\n');
  D.ensureAvd({ env: { ...env, APP_SCREEN: '720x1560' }, avd: 'scr', log: () => {} });
  eq(['hw.lcd.width', 'hw.lcd.height', 'hw.lcd.density', 'skin.name', 'skin.path'].map(conf), ['720', '1560', '280', '720x1560', '_no_skin']);
  D.ensureAvd({ env, avd: 'scr', log: () => {} });
  eq(['hw.lcd.width', 'hw.lcd.height', 'hw.lcd.density', 'skin.name'].map(conf), ['1080', '2340', '440', '1080x2340'], 'back to the pixel_5');
  fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(/^skin\.name=.*$/m, 'skin.name=pixel_5'));
  D.ensureAvd({ env, avd: 'scr', log: () => {} }); eq(conf('skin.name'), 'pixel_5', 'a device frame stays');
});
await t('scenario: Android\'s "isn\'t responding" dialog is answered, never taken for a calm screen; one that keeps coming fails the wait with the count', async () => {
  const dir = path.join(tmp, 'anrunit'); fs.mkdirSync(dir, { recursive: true });
  const pic = (c) => { const w = 16, h = 16, d = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { d[i * 4] = c; d[i * 4 + 1] = (i * 11) & 255; d[i * 4 + 2] = 90; d[i * 4 + 3] = 255; } return pngEncode({ w, h, data: d }); };
  const dialogPic = pic(240), titlePic = pic(60);
  let up = 1;
  const adb = { screencap: () => (up > 0 ? dialogPic : titlePic), shell: () => ({ status: 0, stdout: '', stderr: '' }), run: () => ({ status: 0 }), pid: () => 1 };
  const ctx = { adb, runDir: dir, decode: pngDecode, pkg: K.PACKAGE, logcatFile: path.join(dir, 'lc.txt'), server: { logFile: path.join(dir, 's.log'), joinUri: 'x', do: async () => ({ ok: true, lines: [] }) }, launch() {},
    dialog: () => (up > 0 ? { kind: 'anr', proc: 'system' } : null), answer: () => { up--; return '「待つ」を押しました'; } };
  fs.writeFileSync(ctx.server.logFile, '');
  const r = await S.runScenario(S.parseScenario('until stable 30000\nshot title').steps, ctx);
  ok(r.ok && r.dialogs.length === 1 && r.dialogs[0].proc === 'system' && r.dialogs[0].line === 1, JSON.stringify(r));
  eq(pngDecode(fs.readFileSync(r.shots[0])).data[0], 60, 'the shot is the game, not the dialog');
  up = 1; const r1 = await S.runScenario(S.parseScenario('shot again').steps, ctx);
  ok(/先に Android のダイアログ「system」に答えてから/.test(r1.results[0].note) && pngDecode(fs.readFileSync(r1.shots[0])).data[0] === 60, r1.results[0].note);
  up = Infinity; const r2 = await S.runScenario(S.parseScenario('until stable 3000').steps, ctx);
  ok(!r2.ok && /画面が落ち着きません/.test(r2.results[0].note) && /system ×\d+/.test(r2.results[0].note) && /処理が追いついていません/.test(r2.results[0].note), r2.results[0].note);
  eq(S.dialogSummary([{ proc: 'system' }, { proc: 'com.android.systemui' }, { proc: 'system' }]), 'system ×2、com.android.systemui ×1');
});
await t('run: ANR dialogs over the game are answered with Wait (by the layout, else keys), counted in the report, the shots are the game; translation and the machine noted; stage notices in Actions', () => {
  const r = e2e('anr', { FAKE_ANR: '2', APP_PORT: '19132', GITHUB_ACTIONS: 'true' });
  made.push(r.runDir);
  ok(r.status === 0 && r.state.waited === 2 && r.state.calls.filter((c) => c === 'shell input tap 1170 600').length === 2, `exit ${r.status} waited ${r.state.waited}\n${r.text}`);
  const rep = fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8'), run = fs.readFileSync(path.join(r.runDir, 'run.txt'), 'utf8');
  ok(/「応答なし」などのダイアログが 2 回出ました（system ×2）/.test(rep) && (run.match(/⚠ 5 Android のダイアログ「system が応答していません」: 「待つ」を押しました/g) ?? []).length === 2, rep + '\n' + run);
  eq([...pngDecode(fs.readFileSync(path.join(r.runDir, 'shots', '01-title.png'))).data.subarray(0, 2)], [60, 120], 'the title shot is the game');
  ok(/arm64-v8a 版を x86_64 の端末で、ARM 変換して動かしています/.test(rep), 'the ARM translation is said: ' + rep);
  const host = fs.readFileSync(path.join(r.runDir, 'host.txt'), 'utf8');
  ok(/^\d\d:\d\d:\d\d load \d+\.\d\/\d+ · mem \d+\.\d\/\d+\.\d GB 空き/m.test(host), 'host.txt: ' + host);
  const notes = r.text.split('\n').filter((l) => l.startsWith('::notice title=app '));
  ok(notes.length >= 5 && notes.length <= 9 && notes.some((l) => /^::notice title=app \[1\/5\] APK 1\.26\.52\.03 \(912605203\) arm64-v8a::\+0m\d\ds load /.test(l)) && notes.every((l) => !/エミュレータ/.test(l)), 'stage notices with the machine, softened: ' + notes.join('\n'));
  const k = e2e('anrkeys', { FAKE_ANR: '1', FAKE_NO_UIAUTOMATOR: '1', APP_PORT: '19132' });
  made.push(k.runDir);
  ok(k.status === 0 && k.state.waited === 1 && /キーで押しました/.test(fs.readFileSync(path.join(k.runDir, 'run.txt'), 'utf8')) && !k.text.includes('::notice'), `keys when the layout cannot be read; no notices outside Actions\n${k.text}`);
});
await t('apk: the x86_64 build first when asked (APP_APK_X86=1: bdslab_x86_64, gpdl --device-file), the arm64 one when Play does not send it or by default', async () => {
  const fixture = ['[px_9a]', 'Platforms=arm64-v8a', 'Features=a,b', '[google_kiwi_x86_64]', '#', '# SPDX-License-Identifier: GPL-3.0-or-later', 'UserReadableName=Google Play Games on PC', 'Platforms=x86_64,x86,arm64-v8a',
    'Features=android.hardware.touchscreen,android.hardware.type.pc,com.google.android.play.feature.HPE_EXPERIENCE,android.software.webview', 'SharedLibraries=android.test.base,app-inputmapping,app-playeventsservice,com.android.location.provider', 'Build.PRODUCT=kiwi_x86_64', '', '[hw_mate20]', 'Platforms=arm64-v8a', ''].join('\n');
  const prof = K.x86DeviceProfile(fixture);
  ok(prof.startsWith('[bdslab_x86_64]\n') && /^Features=android\.hardware\.touchscreen,android\.software\.webview$/m.test(prof) && /^SharedLibraries=android\.test\.base,com\.android\.location\.provider$/m.test(prof), prof);
  ok(/SPDX-License-Identifier: GPL-3\.0-or-later/.test(prof) && /^Platforms=x86_64,x86,arm64-v8a$/m.test(prof) && !/hw_mate20|Platforms=arm64-v8a\n|HPE_EXPERIENCE|type\.pc|app-inputmapping|Google Play Games on PC$/m.test(prof), 'only that section, its header kept: ' + prof);
  eq(K.x86DeviceProfile('[px_9a]\nPlatforms=arm64-v8a\n'), null);
  const fx = path.join(tmp, 'device.properties'), out = path.join(tmp, 'gpdl-devices.properties'); fs.writeFileSync(fx, fixture);
  const c = spawnSync(process.execPath, [path.join(TOP, 'app', 'gpdl', 'profile.mjs'), fx, out], { encoding: 'utf8' });
  ok(c.status === 0 && fs.readFileSync(out, 'utf8') === prof, 'build.sh\'s step: ' + c.stderr);
  fs.writeFileSync(fx, '[px_9a]\n'); ok(spawnSync(process.execPath, [path.join(TOP, 'app', 'gpdl', 'profile.mjs'), fx, out + '2'], { encoding: 'utf8' }).status === 1 && !fs.existsSync(out + '2'), 'no x86_64 profile: says so, writes nothing');
  // the order Play is asked in, with a fake gpdl (run): x86_64 first, then the arm64 phone
  const set = (dir, abi) => {
    const d = path.join(dir, K.PACKAGE); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `${K.PACKAGE}.apk`), buildZip([{ name: 'AndroidManifest.xml', data: buildManifest({ pkg: K.PACKAGE, versionCode: VC, versionName: '1.26.52.03' }) }]));
    fs.writeFileSync(path.join(d, `${K.PACKAGE}.config.${abi.replace('-', '_')}.apk`), buildZip([{ name: 'AndroidManifest.xml', data: buildManifest({ pkg: K.PACKAGE, versionCode: VC, split: `config.${abi.replace('-', '_')}` }) }, { name: `lib/${abi}/libminecraftpe.so`, data: Buffer.from('\x7fELF fake'), method: 0 }]));
  };
  const tools = path.join(tmp, 'x86tools'); fs.mkdirSync(tools, { recursive: true }); fs.writeFileSync(path.join(tools, 'gpdl'), ''); fs.copyFileSync(out, K.x86ProfileFile(tools));
  const fetchWith = async (x86, extra = {}) => {
    const asked = [];
    const run = (bin, args) => {
      const dev = args[args.indexOf('-d') + 1], file = args.includes('--device-file') ? args[args.indexOf('--device-file') + 1] : null;
      asked.push(file ? `${dev} ${path.basename(file)}` : dev);
      if (dev === 'bdslab_x86_64' && x86 === 'refused') return { status: 4, stdout: 'STEP details com.mojang.minecraftpe\nFAIL refused details: no version code (not offered for this device)\n', stderr: '' };
      set(args.at(-1), dev === 'bdslab_x86_64' ? 'x86_64' : 'arm64-v8a');
      return { status: 0, stdout: 'SAVED x\n', stderr: '' };
    };
    const lines = [];
    const got = await K.fetchApk({ apkDir: path.join(tmp, `x86apk-${x86}`), toolsDir: tools, env: { GOOGLE_EMAIL: FAKE_EMAIL, GOOGLE_AAS_TOKEN: FAKE_TOKEN, APP_SYSIMG: 'system-images;android-34;google_apis;x86_64', APP_APK_X86: '1', ...extra }, run, log: (s) => lines.push(s) });
    return { asked, abis: K.inspectApks(got.apks).abis, lines };
  };
  let f = await fetchWith('ok');
  ok(JSON.stringify(f.asked) === JSON.stringify(['bdslab_x86_64 gpdl-devices.properties']) && JSON.stringify(f.abis) === '["x86_64"]' && f.lines.some((l) => /x86_64 版を取れました/.test(l)), JSON.stringify(f));
  f = await fetchWith('refused');
  ok(JSON.stringify(f.asked) === JSON.stringify(['bdslab_x86_64 gpdl-devices.properties', 'px_9a']) && JSON.stringify(f.abis) === '["arm64-v8a"]' && f.lines.some((l) => /arm64 版を端末 px_9a で試します/.test(l)), JSON.stringify(f));
  // not asked for (the default: its license check failed on the emulator), turned off, a device picked, an arm64 image
  for (const [extra, want] of [[{ APP_APK_X86: '' }, ['px_9a']], [{ APP_APK_X86: '0' }, ['px_9a']], [{ APP_APK_DEVICE: 'sm_s25u' }, ['sm_s25u']], [{ APP_SYSIMG: 'system-images;android-34;google_apis;arm64-v8a' }, ['px_9a']]]) {
    f = await fetchWith('ok', extra); eq(f.asked, want, JSON.stringify(extra));
  }
});
await t('host: the machine\'s load / memory / swap / disk / biggest processes, sampled into a file; the worst moment as report notes', () => {
  const s = H.hostStats({ dir: tmp });
  ok(s.cpus >= 1 && s.memTotal > 0 && s.memAvail > 0 && s.memAvail <= s.memTotal && s.load1 >= 0 && (s.diskFree === null || s.diskFree > 0), JSON.stringify(s));
  if (process.platform === 'linux') ok(s.memExact && s.top.length > 0 && s.top[0].rss > 0 && s.swapUsed !== null, 'Linux: MemAvailable, processes and swap: ' + JSON.stringify(s.top));
  const G = 2 ** 30;
  eq(H.fmtStats({ cpus: 4, load1: 7.94, memTotal: 16 * G, memAvail: 2.1 * G, swapUsed: 1.2 * G, diskFree: 12 * G, top: [{ name: 'qemu-system-x86', rss: 5.1 * G }, { name: 'java', rss: 0.8 * G }] }),
    'load 7.9/4 · mem 2.1/16.0 GB 空き · swap 1.2 GB · disk 12.0 GB 空き · qemu-system-x86 5.1, java 0.8 GB');
  const notes = H.hostNotes({ cpus: 4, load1: 9.5, memAvail: 0.4 * G, memExact: true, diskFree: 1 * G });
  eq(H.hostNotes({ cpus: 4, load1: 1, memAvail: 0.4 * G, memExact: false, diskFree: 40 * G }), [], 'macOS free memory (no cache) is not warned on');
  ok(notes.length === 3 && /メモリの空きが 0\.4 GB/.test(notes[0]) && /ディスクの空きが 1\.0 GB/.test(notes[1]) && /負荷が 9\.5（CPU 4 個）/.test(notes[2]), notes.join('\n'));
  eq(H.hostNotes({ cpus: 4, load1: 3, memAvail: 8 * G, diskFree: 40 * G }), []);
  const f = path.join(tmp, 'host.txt');
  let n = 0;
  const m = H.startMonitor(f, { everyMs: 60_000, sample: () => ({ at: Date.UTC(2026, 9, 3, 6, 14, 39 + n), cpus: 4, load1: [2, 9, 4][n], memTotal: 16 * G, memAvail: [9, 1, 5][n++] * G, memExact: true, swapUsed: 0, diskFree: 20 * G, top: [] }) });
  m.now(); m.stop();
  eq(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.slice(0, 22)), ['06:14:39 load 2.0/4 · ', '06:14:40 load 9.0/4 · ', '06:14:41 load 4.0/4 · ']);
  ok(m.worst.load1 === 9 && m.worst.memAvail === 1 * G && m.worst.memExact && m.worst.diskFree === 20 * G && /メモリの空きが 1\.0 GB/.test(H.hostNotes(m.worst)[0]), JSON.stringify(m.worst));
});
// the run that started all this: "アプリで確かめる" SIGTERM'd after 7m39s, every later step (always() and Post too) skipped
const JOB143 = { id: 5, name: 'アプリで確かめる', status: 'completed', conclusion: 'failure', steps: [
  { name: 'APK を取得', conclusion: 'success', started_at: '2026-10-03T06:14:14Z', completed_at: '2026-10-03T06:14:39Z' },
  { name: 'アプリで確かめる', conclusion: 'failure', started_at: '2026-10-03T06:14:39Z', completed_at: '2026-10-03T06:22:18Z' },
  { name: '結果に APK やトークンが無いことを確認', conclusion: 'skipped' }, { name: 'Post Run actions/checkout@3d3c', conclusion: 'skipped' }, { name: 'Complete job', conclusion: 'success' }] };
const ANN143 = [{ annotation_level: 'failure', title: '', message: 'Process completed with exit code 143.' },
  { annotation_level: 'notice', title: 'app [1/5] APK 1.26.52.03 (912605203) x86_64', message: '+0m05s load 1.0/4 · mem 9.0/15.6 GB 空き' },
  { annotation_level: 'notice', title: 'app [5/5] 手順 bds/addons/jsonui_demo/app.txt（16 個）', message: '+6m10s load 9.9/4 · mem 0.3/15.6 GB 空き' }];
await t('checks: a job stopped from outside (exit 143, every later step skipped) is told as such, with how far it got; an ordinary failure is not', () => {
  const ex = GR.explainJob(JOB143, ANN143);
  ok(ex.stopped && ex.title === 'FAIL 実行ごと止められました（アプリで確かめる、7 分 39 秒で exit 143）', ex.title);
  ok(/SIGTERM/.test(ex.lines[0]) && /always\(\) のものも Post も全部 skipped/.test(ex.lines[1]) && ex.lines.some((l) => /^最後の進行: app \[5\/5\] 手順 .*mem 0\.3\/15\.6 GB 空き/.test(l)) && ex.lines.some((l) => /^最初の進行: app \[1\/5\]/.test(l)), ex.summary);
  const plain = GR.explainJob({ ...JOB143, steps: JOB143.steps.map((s) => (s.conclusion === 'skipped' ? { ...s, conclusion: 'success' } : s)) }, [{ annotation_level: 'failure', title: '結果とエラー', message: 'FAIL app/runs/x/report.md\n次: …' }, { annotation_level: 'failure', message: 'Process completed with exit code 1.' }]);
  ok(!plain.stopped && /^FAIL 成果物がありません（アプリで確かめる、7 分 39 秒で exit 1）$/.test(plain.title) && plain.lines.some((l) => l === 'エラー: 結果とエラー: FAIL app/runs/x/report.md'), plain.summary);
  ok(!GR.explainJob(JOB143, ANN143.slice(0, 1)).lines.some((l) => /最後の進行/.test(l)) && GR.explainJob(JOB143, ANN143.slice(0, 1)).lines.some((l) => /進行の notice がありません/.test(l)), 'no notices: said');
});
await t('checks --artifact: no artifact (the job was stopped) → the result check says how and how far, from the job API (a local fake GitHub)', async () => {
  const http = await import('node:http');
  const posted = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      const u = req.url.replace(/\?per_page=\d+$/, ''), send = (x) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(x)); };
      if (req.headers.authorization !== 'Bearer t0k') { res.statusCode = 401; return send({}); }
      if (u.startsWith('/repos/o/r/actions/runs/77/artifacts')) return send({ artifacts: [] });
      if (u === '/repos/o/r/actions/runs/77/jobs') return send({ jobs: [JOB143, { id: 6, name: '結果をチェックに出す', status: 'in_progress', steps: [] }] });
      if (u === '/repos/o/r/check-runs/5/annotations') return send(ANN143);
      if (u === '/repos/o/r/check-runs' && req.method === 'POST') { posted.push(JSON.parse(body)); return send({ id: 1 }); }
      res.statusCode = 404; send({ message: u });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const env = { ...process.env, GITHUB_TOKEN: 't0k', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '77', GITHUB_SHA: 'abc', GITHUB_API_URL: `http://127.0.0.1:${srv.address().port}` };
  const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'checks', '--artifact', 'app-jsonui_demo-77'], { cwd: TOP, env });
  let text = ''; c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
  const code = await new Promise((r) => c.on('exit', r));
  srv.close();
  ok(code === 0 && posted.length === 1 && posted[0].name === 'app: 結果' && posted[0].output.title === 'FAIL 実行ごと止められました（アプリで確かめる、7 分 39 秒で exit 143）', `exit ${code}\n${text}\n${JSON.stringify(posted)}`);
  ok(/最後の進行: app \[5\/5\]/.test(posted[0].output.summary) && /成果物 app-jsonui_demo-77 がありません/.test(posted[0].output.summary) && posted[0].head_sha === 'abc', posted[0].output.summary);
});
// ---- the private cache (app/lib/vault.mjs) and the prepared device (app/lib/warm.mjs, app prepare) ----
const V = await imp('app/lib/vault.mjs');
const W = await imp('app/lib/warm.mjs');
await t('app open: a sealed part put back in place by itself (the device job opens the device while the next cache downloads)', async () => {
  const avds = path.join(tmp, 'open-avd'), vault = path.join(tmp, 'open-vault');
  fs.mkdirSync(path.join(avds, 'bdslab_app.avd'), { recursive: true }); fs.writeFileSync(path.join(avds, 'bdslab_app.avd', 'userdata.img'), 'DATA'); fs.writeFileSync(path.join(avds, 'bdslab_app.ini'), 'path=x');
  const key = V.vaultKey({ APP_CACHE_KEY: 'open-key' });
  await V.seal({ base: avds, entries: ['bdslab_app.avd', 'bdslab_app.ini'], outFile: path.join(vault, 'avd.bin'), key });
  fs.rmSync(path.join(avds, 'bdslab_app.avd'), { recursive: true });
  const env = { ANDROID_AVD_HOME: avds, APP_VAULT_DIR: vault, APP_CACHE_KEY: 'open-key', GITHUB_ACTIONS: '' };
  const r = cli(['open', 'avd', 'bds'], env);
  ok(r.status === 0 && /OK 端末（タイトル画面のスナップショット）を戻しました/.test(r.text) && /BDS: キャッシュのファイルがありません/.test(r.text), r.text);
  eq(fs.readFileSync(path.join(avds, 'bdslab_app.avd', 'userdata.img'), 'utf8'), 'DATA'); ok(!fs.existsSync(path.join(vault, 'avd.bin')), 'the sealed file is gone once opened');
  ok(cli(['open', 'nope'], env).status === 1, 'an unknown part is refused');
});
await t('vault: sealed (tar → zstd/gzip → AES-256-GCM), opened only whole and only with the same key; in Actions only with a key (public too)', async () => {
  const src = path.join(tmp, 'vsrc'), out = path.join(tmp, 'vout');
  fs.mkdirSync(path.join(src, 'part', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'part', 'sub', 'a.txt'), 'SECRET-LOOKING-PLAINTEXT');
  fs.writeFileSync(path.join(src, 'part', 'big.bin'), crypto.randomBytes(200_000));
  const k = V.vaultKey({ APP_CACHE_KEY: 'k1' }), f = path.join(tmp, 'v', 'part.bin');
  ok(k && k.key.length === 32 && /^[0-9a-f]{16}$/.test(k.id), 'a 256-bit key and a 16-hex id');
  ok(V.vaultKey({ GOOGLE_AAS_TOKEN: 'aas_et/xyz' }).id !== V.vaultKey({ APP_CACHE_KEY: 'aas_et/xyz' }).id && V.vaultKey({}) === null, 'from the token or its own secret (not the same key), none without either');
  await V.seal({ base: src, entries: ['part'], outFile: f, key: k });
  ok(!fs.readFileSync(f).includes(Buffer.from('SECRET-LOOKING')), 'nothing readable in the sealed file');
  ok(await V.open({ inFile: f, dest: out, key: k }) && fs.readFileSync(path.join(out, 'part', 'sub', 'a.txt'), 'utf8') === 'SECRET-LOOKING-PLAINTEXT', 'opens back');
  const said = [];
  ok(!(await V.open({ inFile: f, dest: path.join(tmp, 'vout2'), key: V.vaultKey({ APP_CACHE_KEY: 'k2' }), log: (x) => said.push(x) })) && !fs.existsSync(path.join(tmp, 'vout2', 'part')) && /別の鍵/.test(said.join()), 'another key: a miss, nothing written');
  const b = fs.readFileSync(f); b[b.length - 40] ^= 1; fs.writeFileSync(f + '.x', b);
  ok(!(await V.open({ inFile: f + '.x', dest: path.join(tmp, 'vout3'), key: k, log: (x) => said.push(x) })) && !fs.existsSync(path.join(tmp, 'vout3', 'part')), 'one changed byte: a miss, nothing written (not half a tree)');
  for (const v of ['private', 'public', 'internal', '']) {
    eq(V.vaultAllowed({ GITHUB_ACTIONS: 'true', APP_REPO_VISIBILITY: v, APP_CACHE_KEY: 'k1' }).ok, true, `${v} with a key`);
    eq(V.vaultAllowed({ GITHUB_ACTIONS: 'true', APP_REPO_VISIBILITY: v }).ok, false, `${v} without a key`);
  }
  eq(V.vaultAllowed({}).ok, true, 'this machine');
});
await t('tidy: before saving, the lab\'s old caches go, then the device base if the rest does not fit; the emulator and the device stay (pure)', () => {
  const G = 2 ** 30, c = (key, gb) => ({ key, size_in_bytes: gb * G });
  const cs = [c('app-sdk-v1-Linux', 1.7), c('app-base-k-x-new', 4.8), c('app-base-k-x-old', 8), c('app-avd-k-old', 5), c('auto-Linux-x', 1), c('app-vending-k-1', 0.03)];
  const keep = ['app-sdk-v1-Linux', 'app-base-k-x-new', 'app-avd-k-new', 'app-vending-k-1'];
  const p = WARM.tidyPlan(cs, { keep, incoming: [{ key: 'app-avd-k-new', bytes: 5.5 * G }], limit: 9.7 * G });
  eq(p.drop, ['app-base-k-x-old', 'app-avd-k-old', 'app-base-k-x-new']); ok(!p.skipBase && p.total < 9.7 * G, JSON.stringify(p));
  // a device and its base made in the same run: the base is not saved when both do not fit
  const q = WARM.tidyPlan([c('app-sdk-v1-Linux', 1.7)], { keep, incoming: [{ key: 'app-avd-k-new', bytes: 5.5 * G }, { key: 'app-base-k-x-new', bytes: 4.8 * G }], limit: 9.7 * G });
  eq([q.drop, q.skipBase], [[], true]);
  const r = WARM.tidyPlan([c('app-sdk-v1-Linux', 1.7), c('app-base-k-x-new', 4.8)], { keep, incoming: [{ key: 'app-bds-k-1', bytes: 0.1 * G }], limit: 9.7 * G });
  eq([r.drop, r.skipBase], [[], false], 'room enough: nothing goes');
});
await t('warm: the snapshot is used only when it was made from the same APK, emulator, image, cores, RAM, screen, GPU, account mode', async () => {
  const D = { APP_CORES: '2', APP_RAM: '3072', APP_SCREEN: '720x1560' };
  const rev = { emulator: '36.1.9', sysimg: '14' }, a = W.wantStamp({ apkCode: 982605203, account: true, env: D, rev });
  eq(W.stampDiff(a, a), []);
  eq(W.stampDiff(a, W.wantStamp({ apkCode: null, account: true, env: D, rev })), [], 'no APK asked for: any');
  eq(W.stampDiff(a, W.wantStamp({ apkCode: 982605300, account: true, env: D, rev })), ['apk']);
  eq(W.stampDiff(a, W.wantStamp({ apkCode: 982605203, account: true, env: { ...D, APP_RAM: '4096' }, rev: { ...rev, emulator: '36.2.1' } })), ['emulatorRev', 'ram']);
  eq(W.stampDiff(null, a), ['（スナップショットがありません）']);
  ok(W.stampKey(a) !== W.stampKey({ ...a, ram: 4096 }) && W.stampKey(a).startsWith('982605203-'), 'the cache name follows the stamp');
  const DA = await imp('app/lib/android.mjs');
  eq(DA.deviceFit({}, { cpus: 2, mem: 7 * 2 ** 30 }), { cores: 2, ram: 3072 }, '2 cores, 7 GB (a private repo runner)');
  eq(DA.deviceFit({}, { cpus: 4, mem: 16 * 2 ** 30 }), { cores: 4, ram: 4096 });
  eq(DA.deviceFit({ APP_CORES: '3', APP_RAM: '2048' }, { cpus: 16, mem: 64 * 2 ** 30 }), { cores: 3, ram: 2048 });
});
await t('prepare → run: the device made once (fresh AVD, game installed, started to its title, snapshot, clean stop, sealed); the next run starts from it and joins, timed', async () => {
  const state = path.join(tmp, 'warm.json'), sdk = path.join(tmp, 'sdk-warm'), avds = path.join(tmp, 'avd-warm'), vault = path.join(tmp, 'vault-warm');
  fs.writeFileSync(state, JSON.stringify({ phase: 'home' })); fs.writeFileSync(state + '.power', 'off');
  fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI), { recursive: true });
  fs.writeFileSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI, 'source.properties'), 'Pkg.Revision=14\n');
  fs.mkdirSync(path.join(sdk, 'emulator'), { recursive: true }); fs.writeFileSync(path.join(sdk, 'emulator', 'source.properties'), 'Pkg.Revision=36.1.9\n');
  const env = { ...process.env, FAKE_APP_STATE: state, FAKE_EMU_POWER: '1', APP_ADB: path.join(FAKE, 'adb'), APP_EMULATOR: path.join(FAKE, 'adb'), APP_AVDMANAGER: path.join(FAKE, 'avdmanager'), APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'),
    ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_AVD_HOME: avds, APP_APK_DIR: apkDir, APP_STABLE_MS: '100', APP_TITLE_POLL_MS: '50', APP_ADBKEY_DIR: path.join(tmp, 'adbkey-e2e'),
    APP_CACHE_KEY: 'test-cache-key', APP_VAULT_DIR: vault, APP_CORES: '2', APP_RAM: '3072', APP_EMU_NICE: '0', APP_RESTART_SETTLE_MS: '20', APP_PAD_WAIT_MS: '50', APP_RELAY_BIN: RELAY_STUB, APP_PAD_BIN: PAD_STUB };
  delete env.GOOGLE_AAS_TOKEN; delete env.GOOGLE_EMAIL; delete env.GITHUB_ACTIONS; delete env.GITHUB_OUTPUT;
  const lab = (args, extra = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', ...args], { cwd: TOP, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120_000 }); return { status: r.status, text: r.stdout + r.stderr, state: JSON.parse(fs.readFileSync(state, 'utf8')) }; };
  // 1. cold: made from nothing
  fs.chmodSync(path.join(FAKE, 'avdmanager'), 0o755);
  const p1 = lab(['prepare', '--no-bds']);
  ok(p1.status === 0, `exit ${p1.status}\n${p1.text}`);
  ok(/端末を準備します（初めて）/.test(p1.text) && /タイトル画面になりました/.test(p1.text) && /スナップショット lab-title を保存しました/.test(p1.text), p1.text);
  ok(/-wipe-data/.test(p1.state.calls.find((c) => c.startsWith('-avd')) ?? '') && p1.state.calls.some((c) => c.startsWith('install-multiple')), 'a fresh device, the game installed');
  ok(p1.state.calls.indexOf('emu avd snapshot save lab-title') < p1.state.calls.lastIndexOf('emu kill') && fs.readFileSync(state + '.power', 'utf8') === 'off', 'saved, then stopped the clean way');
  // the framework started again with SurfaceFlinger latching unfinished frames (before the game's first start), the free space
  // zeroed just before the snapshot (what deleted files left in the disk image is not carried by the cache)
  // (the free space is not zeroed by default: the emulator's /data is encrypted, the zeros reach the image as ciphertext)
  // and Android's ANR deadlines 5 times as long (ro.hw_timeout_multiplier: Android's own knob for a slow device)
  const restart = p1.state.calls.findIndex((c) => /setprop debug\.sf\.latch_unsignaled 1; setprop ro\.hw_timeout_multiplier 5; stop; start/.test(c)), launch1 = p1.state.calls.findIndex((c) => /monkey -p com\.mojang\.minecraftpe/.test(c));
  ok(restart >= 0 && restart < launch1 && /画面合成は描き終わらない絵も待たない、応答なしの判定を 5 倍待つ（5）/.test(p1.text) && !p1.state.calls.some((c) => /dev\/zero/.test(c)), `restart ${restart} launch ${launch1}\n${p1.text.slice(-1200)}`);
  ok(p1.state.props?.['ro.hw_timeout_multiplier'] === '5' && p1.state.calls.filter((c) => /stop; start/.test(c)).length === 1, 'one restart of the framework');
  const stamp = JSON.parse(fs.readFileSync(path.join(avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8'));
  ok(stamp.apk === 912605203 && stamp.emulatorRev === '36.1.9' && stamp.sysimgRev === '14' && stamp.versionName === '1.26.52.03' && stamp.cores === 2 && stamp.ram === 3072, JSON.stringify(stamp));
  ok(fs.existsSync(path.join(vault, 'avd.bin')) && /端末（タイトル画面のスナップショット）を非公開のキャッシュに入れました/.test(p1.text), 'sealed into the private cache\n' + p1.text.slice(-1500));
  // 2. the cache alone (a new machine): opened, nothing made again
  fs.rmSync(avds, { recursive: true, force: true });
  const calls = p1.state.calls.length;
  const p2 = lab(['prepare', '--no-bds']);
  ok(p2.status === 0 && /キャッシュから端末/.test(p2.text) && /端末は準備できています/.test(p2.text) && !p2.state.calls.slice(calls).some((c) => c.startsWith('install-multiple') || c.startsWith('-avd')), p2.text);
  ok(!fs.existsSync(path.join(vault, 'avd.bin')), 'the opened file is removed (disk)');
  // 3. the run: from the snapshot (the game already on its title screen), the BDS up meanwhile, the join timed
  const r = lab(['run', '-a', 'jsonui_demo', '--no-fetch']);
  made.push(path.join(TOP, 'app', /→ (app\/runs\/\S+)/.exec(r.text)?.[1]?.replace(/^app\//, '') ?? 'none'));
  ok(r.status === 0, `exit ${r.status}\n${r.text}\n${r.state.calls.slice(-30).join('\n')}\n${fs.existsSync(made.at(-1)) ? fs.readFileSync(path.join(made.at(-1), 'run.txt'), 'utf8') : ''}`);
  const start = r.state.calls.filter((c) => c.startsWith('-avd')).at(-1);
  ok(/-snapshot lab-title/.test(start) && !/-wipe-data/.test(start) && r.state.restored === 'lab-title', 'started from the snapshot: ' + start + '\n' + r.text.slice(0, 1500));
  const after = r.state.calls.slice(r.state.calls.lastIndexOf(start));
  ok(!after.some((c) => /^install-multiple|disable-user/.test(c)), 'nothing installed or set up again');
  const rep = fs.readFileSync(path.join(made.at(-1), 'report.md'), 'utf8');
  ok(/\| 参加 \| [\d.]+ 秒（参加リンク → ワールドに出るまで）。端末の起動から [\d.]+ 秒 \|/.test(rep) && /\| 準備済みの端末 \| [\d.]+ 秒で戻りました/.test(rep), rep);
  ok(/端末は準備できています/.test(fs.readFileSync(path.join(made.at(-1), 'prepare.txt'), 'utf8')), 'what prepare did travels with the run');
  // 4. another APK than the snapshot's: not used (made again by prepare; a plain run boots as before)
  const p4 = lab(['prepare', '--no-bds'], { APP_PLAY_CODE: '912605300' });
  ok(p4.status !== 0 && /違い: apk/.test(p4.text), 'a newer game on Play: made again (the fake APK is the old one, so the fetch fails here): ' + p4.text.slice(-600));
  for (const f of fs.readdirSync(path.join(TOP, 'app', '.lab')).filter((x) => /^prepare/.test(x))) fs.rmSync(path.join(TOP, 'app', '.lab', f), { force: true });
});
// ---- the game's license on a fresh device (app/lib/license.mjs): what the device knows, Play's page, Play installing it ----
const LI = await imp('app/lib/license.mjs');
await t('license: the package facts (who installed it), Play\'s page and its button, the prompts, Play\'s and Google\'s lines (pure)', () => {
  const dp = '    primaryCpuAbi=arm64-v8a\n    versionCode=972605203 minSdk=24 targetSdk=35\n    versionName=1.26.52.3\n    firstInstallTime=2026-10-03 11:57:47\n    lastUpdateTime=2026-10-03 11:57:47\n    installerPackageName=com.android.vending\n    installerPackageUid=-1\n    initiatingPackageName=com.android.shell\n    originatingPackageName=null\n';
  const f = LI.packageFacts(dp);
  eq([f.versionCode, f.versionName, f.primaryCpuAbi, f.installerPackageName, f.initiatingPackageName, f.originatingPackageName, f.firstInstallTime], [972605203, '1.26.52.3', 'arm64-v8a', 'com.android.vending', 'com.android.shell', 'null', '2026-10-03 11:57:47']);
  eq([LI.byPlay(f), LI.byPlay({ installerPackageName: 'com.android.vending', initiatingPackageName: 'com.android.vending' }), LI.byPlay(null)], [false, true, false]);
  const xml = '<hierarchy><node text="Minecraft" bounds="[0,0][10,10]" /><node text="" content-desc="Update" clickable="true" enabled="true" bounds="[100,500][400,580]" /><node text="Uninstall" bounds="[500,500][800,580]" /><node text="" bounds="[1,1][2,2]" /></hierarchy>';
  const nodes = LI.screenNodes(xml);
  eq(nodes.map((n) => n.text), ['Minecraft', 'Update', 'Uninstall']);
  eq(LI.playAction(nodes), { action: 'update', label: 'Update', x: 250, y: 540 });
  const MC = { text: 'Minecraft: Dream it, Build it!', x: 0, y: 0 }, UN = { text: 'Uninstall', x: 9, y: 9 };
  eq(LI.playAction([MC, { text: 'Install', x: 1, y: 2 }]).action, 'install'); eq(LI.playAction([MC, UN, { text: 'Open', x: 1, y: 2 }]).action, 'open');
  eq(['$6.99', '¥1,000', '1,000円', 'US$6.99', 'Buy'].map((x) => LI.playAction([MC, { text: x, x: 0, y: 0 }])?.action), ['buy', 'buy', 'buy', 'buy', 'buy']);
  eq(LI.playAction([MC, { text: "This app isn't available for your device", x: 0, y: 0 }]).action, 'unavailable');
  eq(LI.playAction([MC, { text: 'インストール', x: 0, y: 0 }]).action, 'install'); eq(LI.playAction([MC]), null);
  eq(LI.playAction([MC, { text: 'Update', x: 0, y: 0, enabled: false }]), null, 'a disabled button is not offered');
  eq(LI.playAction([{ text: '2:58' }, { text: 'Google' }, { text: 'Play' }]), null, 'a sheet still loading (its header says Google Play) is not the page');
  eq(LI.playAction([MC, { text: 'Google' }, { text: 'Play' }]), null, '"Play" without Uninstall is not the installed game\'s button');
  eq(LI.promptButton([{ text: 'Minecraft' }, { text: 'Accept', x: 5, y: 6 }])?.x, 5); eq(LI.promptButton([{ text: 'Install' }]), null);
  eq(LI.systemDialogButton([{ text: "Pixel Launcher isn't responding" }, { text: 'Close app', x: 1, y: 1 }, { text: 'Wait', x: 2, y: 2 }])?.text, 'Wait', 'an ANR seen in the layout: Wait');
  eq(LI.systemDialogButton([{ text: 'Install' }, { text: 'Wait' }]), null, 'no dialog, no Wait');
  const anr = (who) => [{ text: `${who} isn't responding` }, { text: 'Close app', x: 1, y: 1 }, { text: 'Wait', x: 2, y: 2 }];
  eq([LI.dialogChoice(anr('Pixel Launcher'), 0)?.text, LI.dialogChoice(anr('Pixel Launcher'), 3)?.text, LI.dialogChoice(anr('System UI'), 9)?.text, LI.dialogChoice(anr('Process system'), 9)?.text], ['Wait', 'Close app', 'Wait', 'Wait'], 'the home screen closed after 3, the system always waited for');
  const lc = ['10-03 12:07:46.297  4400  4400 I Finsky  : [2] Successfully fetched Play Pass paywall for package com.mojang.minecraftpe',
    '10-03 12:07:09.805  4400  4459 I Finsky  : [54] AIM: AppInfoManager-Perf > ItemModel > CacheSize=30', '10-03 12:00:00.000   900   901 W GLSUser : [GLSUser] getToken() -> BAD_AUTHENTICATION',
    '10-03 12:00:01.000   523   550 W WindowManager: nothing', '10-03 12:00:02.000   523   550 I ActivityTaskManager: START u0 {cmp=com.mojang.minecraftpe/com.pairip.licensecheck.LicenseActivity}'].join('\n');
  eq(LI.playLines(lc).map((l) => /\s[VDIWEF]\s+(\S+)\s*:/.exec(l)?.[1]), ['Finsky', 'GLSUser', 'ActivityTaskManager'], 'Play / Google / license lines, not the noise');
  eq(LI.playLines(Array.from({ length: 500 }, (_, i) => `x Finsky : line ${i}`).join('\n'), { max: 100 }).length, 101, 'the start and the end of a long log');
});
const prepEnv = (name) => {
  const state = path.join(tmp, `${name}.json`), sdk = path.join(tmp, `sdk-${name}`), avds = path.join(tmp, `avd-${name}`), vault = path.join(tmp, `vault-${name}`);
  fs.writeFileSync(state, JSON.stringify({ phase: 'home' })); fs.writeFileSync(state + '.power', 'off');
  fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI), { recursive: true });
  fs.writeFileSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI, 'source.properties'), 'Pkg.Revision=14\n');
  fs.mkdirSync(path.join(sdk, 'emulator'), { recursive: true }); fs.writeFileSync(path.join(sdk, 'emulator', 'source.properties'), 'Pkg.Revision=36.1.9\n');
  const envFile = path.join(tmp, `${name}.env`); fs.writeFileSync(envFile, `GOOGLE_EMAIL="${FAKE_EMAIL}"\nGOOGLE_AAS_TOKEN="${FAKE_TOKEN}"\n`, { mode: 0o600 });
  const env = { ...process.env, FAKE_APP_STATE: state, FAKE_EMU_POWER: '1', APP_ADB: path.join(FAKE, 'adb'), APP_EMULATOR: path.join(FAKE, 'adb'), APP_AVDMANAGER: path.join(FAKE, 'avdmanager'), APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'),
    ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_AVD_HOME: avds, APP_APK_DIR: apkDir, APP_STABLE_MS: '100', APP_TITLE_POLL_MS: '50', APP_TITLE_SETTLE_MS: '10', APP_SETTLE_POLL_MS: '10', APP_RETRY_WAIT_MS: '10', APP_PLAY_POLL_MS: '20', APP_PRESS_WAIT_MS: '30', APP_ADBKEY_DIR: path.join(tmp, `adbkey-${name}`),
    APP_CACHE_KEY: 'test-cache-key', APP_VAULT_DIR: vault, APP_CORES: '2', APP_RAM: '3072', APP_EMU_NICE: '0', APP_ENV_FILE: envFile, APP_VENDING: '0', APP_TESSERACT: path.join(tmp, 'no-tesseract'), APP_RESTART_SETTLE_MS: '20', APP_PAD_BIN: PAD_STUB };
  delete env.GOOGLE_AAS_TOKEN; delete env.GOOGLE_EMAIL; delete env.GITHUB_ACTIONS; delete env.GITHUB_OUTPUT;
  const lab = (args, extra = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', ...args], { cwd: TOP, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120_000 }); return { status: r.status, text: r.stdout + r.stderr, state: JSON.parse(fs.readFileSync(state, 'utf8')) }; };
  fs.chmodSync(path.join(FAKE, 'avdmanager'), 0o755);
  return { lab, avds, state, env, cleanup: () => { for (const f of fs.readdirSync(path.join(TOP, 'app', '.lab')).filter((x) => /^prepare/.test(x))) fs.rmSync(path.join(TOP, 'app', '.lab', f), { force: true }); } };
};
await t('prepare: the new player\'s title (Get started / More options) left for the classic menu by DOWN, DOWN, A before the snapshot (the first press only turns the focus on)', () => {
  const P = prepEnv('newtitle');
  try {
    const r = P.lab(['prepare', '--no-bds'], { FAKE_NEWTITLE: '1', APP_TESSERACT: path.join(FAKE, 'tesseract'), APP_PAD_WAIT_MS: '30' });
    ok(r.status === 0 && /クラシックのメニューにしました/.test(r.text), `exit ${r.status} pads ${JSON.stringify(r.state.pads)} downs ${r.state.newDowns} classic ${r.state.classic} phase ${r.state.phase}\n${r.text.slice(-600)}`);
    // (through the device's controller: its presses go into its FIFO, before the snapshot)
    const fifo = r.state.calls.map((c, i) => [c, i]).filter(([c]) => /lab-pad\.fifo$/.test(c)), save = r.state.calls.indexOf('emu avd snapshot save lab-title');
    ok(r.state.classic === true && r.state.padUp === true && JSON.stringify((r.state.pads ?? []).slice(-3)) === JSON.stringify(['DPAD_DOWN', 'DPAD_DOWN', 'BUTTON_A']) && fifo.length >= 1 && fifo.at(-1)[1] < save && r.state.calls.filter((c) => c === 'shell input gamepad keyevent KEYCODE_DPAD_DOWN').length === 2, `classic ${r.state.classic} pad ${r.state.padUp} ${JSON.stringify(r.state.pads)} fifo ${fifo.length} save ${save}`);
    ok(!JSON.parse(fs.readFileSync(path.join(P.avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8')).firstScreen, 'the stamp: no first screen kept');
  } finally { P.cleanup(); }
});
await t('world: the player\'s own world (level.dat as little-endian NBT, its name) and the shell line that puts it in the game\'s folders', async () => {
  const WD = await imp('app/lib/world.mjs');
  const b = WD.levelDat({ now: 1_790_000_000_000 });
  eq([b.readInt32LE(0), b.readInt32LE(4)], [10, b.length - 8], 'the header: storage version, length');
  // (a little-endian NBT reader, enough for it)
  let i = 8;
  const str = () => { const n = b.readUInt16LE(i); i += 2 + n; return b.toString('utf8', i - n, i); };
  const val = (t) => {
    if (t === 1) return b[i++];
    if (t === 3) { i += 4; return b.readInt32LE(i - 4); }
    if (t === 4) { i += 8; return Number(b.readBigInt64LE(i - 8)); }
    if (t === 8) return str();
    if (t === 9) { const et = b[i++], n = b.readInt32LE(i); i += 4; return Array.from({ length: n }, () => val(et)); }
    if (t === 10) { const o = {}; for (let c; (c = b[i++]) !== 0;) { const k = str(); o[k] = val(c); } return o; }
    throw new Error('tag ' + t);
  };
  eq(b[i++], 10); eq(str(), ''); const root = val(10);
  eq(i, b.length, 'nothing after the root');
  ok(root.LevelName === 'own world' && root.GameType === 1 && root.Generator === 2 && root.StorageVersion === 10 && root.LastPlayed === 1_790_000_000 && root.SpawnY === 32767 && JSON.stringify(root.lastOpenedWithVersion) === '[1,21,0,0,0]', JSON.stringify(root));
  ok(JSON.parse(root.FlatWorldLayers).block_layers.length === 3, root.FlatWorldLayers);
  eq(WD.worldFiles().map((f) => f.path), ['level.dat', 'levelname.txt']);
  const line = WD.placeLine({ pkg: 'com.mojang.minecraftpe', from: '/data/local/tmp/lab-world' });
  ok(/if \[ -d \/data\/data\/com\.mojang\.minecraftpe\/games\/com\.mojang \]/.test(line) && !/\/sdcard\//.test(line) && /chown -R \$\(stat -c %u:%g \/data\/data\/com\.mojang\.minecraftpe\)/.test(line) && /restorecon -R/.test(line) && /rm -rf \/data\/local\/tmp\/lab-world$/.test(line), line);
});
await t('prepare: the player\'s own world put on the device while the game is stopped, before its next start (the stamp says so); APP_SEED_WORLD=0: none', () => {
  const P = prepEnv('world');
  try {
    const r = P.lab(['prepare', '--no-bds']);
    ok(r.status === 0 && /自分のワールド「own world」を置きました（\/data\/data\/com\.mojang\.minecraftpe\/games\/com\.mojang\/minecraftWorlds\/lab-ready）/.test(r.text) && r.state.world === true, `exit ${r.status}\n${r.text.slice(-1500)}`);
    ok(Buffer.from(r.state.worldPushed['levelname.txt'], 'base64').toString() === 'own world' && Buffer.from(r.state.worldPushed['level.dat'], 'base64').readInt32LE(0) === 10, Object.keys(r.state.worldPushed ?? {}).join(','));
    const placed = r.state.calls.findIndex((c) => /minecraftWorlds\/lab-ready/.test(c)), stop = r.state.calls.lastIndexOf('shell am force-stop com.mojang.minecraftpe', placed);
    const start = r.state.calls.findIndex((c, k) => k > placed && /monkey -p com\.mojang\.minecraftpe|am start .*com\.mojang\.minecraftpe/.test(c));
    ok(placed > 0 && stop >= 0 && stop < placed && start > placed && r.state.calls.indexOf('emu avd snapshot save lab-title') > start, `stopped ${stop}, placed ${placed}, started ${start}`);
    eq(JSON.parse(fs.readFileSync(path.join(P.avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8')).world, 1, 'the stamp');
  } finally { P.cleanup(); }
  const P2 = prepEnv('world-off');
  try {
    const r = P2.lab(['prepare', '--no-bds'], { APP_SEED_WORLD: '0' });
    ok(r.status === 0 && !r.state.world && !r.state.calls.some((c) => /lab-world/.test(c)) && !('world' in JSON.parse(fs.readFileSync(path.join(P2.avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8'))), `exit ${r.status}\n${r.text.slice(-800)}`);
  } finally { P2.cleanup(); }
});
await t('signin: the pages of the game\'s Microsoft sign-in told apart by their words; the values never to show', async () => {
  const SI = await imp('app/lib/signin.mjs'), W = (t, y = 5) => t.split(' ').map((x, i) => ({ text: x, left: i * 10, top: y, width: 8, height: 3, line: 1 }));
  eq(SI.signinPage(W('Play Settings Sign In Marketplace')).kind, 'title');
  eq(SI.signinPage(W('Microsoft SIGN IN'), { web: true }).kind, 'start', 'the WebView: its own SIGN IN (capitals)');
  eq(SI.signinPage(W('Sign In'), { web: true }).kind, 'other', 'not the game menu\'s Sign In');
  eq(SI.signinPage(W("Let's get you signed in SIGN IN"), { web: true }).kind, 'start');
  eq(SI.signinPage(W('Sign in to continue to Minecraft Email, phone, or Skype Next'), { web: true }).kind, 'email');
  eq(SI.signinPage(W('Enter password Forgot password? Sign in'), { web: true }).kind, 'password');
  eq(SI.signinPage(W('Enter code We sent a code to ab***@example.com'), { web: true }).kind, 'code');
  eq(SI.signinPage(W('Approve sign in request 42 Open your Authenticator app'), { web: true }), { kind: 'approve', number: '42' });
  eq(SI.signinPage(W('Stay signed in? Do this to reduce the number of times No Yes'), { web: true }).kind, 'stay');
  eq(SI.signinPage(W('Your account or password is incorrect. Forgot password?'), { web: true }), { kind: 'error', message: 'Your account or password is incorrect' });
  eq(SI.signinPage(W('Settings Play Profile')).kind, 'other', 'signed in: no Sign In on the menu');
  ok(SI.signedOut(W('Play Sign In')) && !SI.signedOut(W('Play Settings')), 'signedOut');
  eq(SI.secretsOf({ MS_EMAIL: 'lab.player@example.com', MS_PASSWORD: 'pw' }), ['lab.player@example.com', 'lab.player', 'pw']);
  eq(SI.secretsOf({ MS_EMAIL: 'ab@x.io' }), ['ab@x.io'], 'a short local part is not masked alone (it would hide ordinary words)');
});
const SIGNIN_MS = { MS_EMAIL: 'lab.player@example.com', MS_PASSWORD: 'pw-Sekret-123' };
const signinFast = { APP_TESSERACT: path.join(FAKE, 'tesseract'), APP_PAD_WAIT_MS: '30', APP_SIGNIN_POLL_MS: '30', APP_SIGNIN_SETTLE_MS: '30' };
const noAccountIn = (text, calls) => { const all = text + JSON.stringify(calls ?? []); ok(!all.includes(SIGNIN_MS.MS_PASSWORD) && !all.includes(SIGNIN_MS.MS_EMAIL) && !all.includes('lab.player'), 'an account value on a command line or in what was printed'); };
await t('prepare with MS_EMAIL: the game signed in before the snapshot (the menu\'s Sign In by the controller, the WebView\'s pages by their words, the values typed through stdin); the stamp says so; a wrong password stops it with the page\'s words', () => {
  const P = prepEnv('signin');
  try {
    const r = P.lab(['prepare', '--no-bds'], { ...signinFast, ...SIGNIN_MS, FAKE_SIGNIN: 'password' });
    ok(r.status === 0 && /サインインしました（\d+ 秒）/.test(r.text) && r.state.signedIn === true, `exit ${r.status} phase ${r.state.phase} pads ${JSON.stringify(r.state.pads)}\n${r.text.slice(-1500)}`);
    ok(/サインイン: title/.test(r.text) && /サインイン: start/.test(r.text) && /サインイン: email/.test(r.text) && /サインイン: password/.test(r.text) && /サインイン: stay/.test(r.text), r.text);
    // (the menu's Sign In reached by the controller: LEFT from Play; A there)
    ok(r.state.pads.includes('DPAD_LEFT') && r.state.pads.at(-1) === 'BUTTON_A' && r.state.viaPad >= 1 && r.state.calls.includes('shell input gamepad keyevent KEYCODE_DPAD_LEFT'), JSON.stringify(r.state.pads));
    eq(r.state.typed, [SIGNIN_MS.MS_EMAIL, SIGNIN_MS.MS_PASSWORD], 'typed from stdin');
    noAccountIn(r.text, r.state.calls);
    const save = r.state.calls.indexOf('emu avd snapshot save lab-title'), lastEnter = r.state.calls.lastIndexOf('shell input keyevent 66');
    ok(save > lastEnter && lastEnter > 0, `the snapshot after the sign-in: save ${save} enter ${lastEnter}`);
    const stamp = JSON.parse(fs.readFileSync(path.join(P.avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8'));
    ok(stamp.signin === true, JSON.stringify(stamp));
  } finally { P.cleanup(); }
  const P2 = prepEnv('signin-wrong');
  try {
    const r = P2.lab(['prepare', '--no-bds'], { ...signinFast, ...SIGNIN_MS, FAKE_SIGNIN: 'wrong' });
    ok(r.status !== 0 && /サインインできません: Your account or password is incorrect/.test(r.text) && /APP_SIGNIN=0/.test(r.text) && !r.state.calls.includes('emu avd snapshot save lab-title'), `exit ${r.status}\n${r.text.slice(-1200)}`);
    noAccountIn(r.text, r.state.calls);
  } finally { P2.cleanup(); }
});
await t('prepare with MS_EMAIL in a workflow: two-step verification said on the live issue (the number to approve; a code asked for and taken only from the run\'s user), the account never in a comment (fake GitHub)', async () => {
  const http = await import('node:http');
  const st = { comments: [], posted: [] };
  let nextId = 900;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.headers.authorization !== 'Bearer tok') return send(401, {});
      if (req.method === 'GET' && u.pathname === '/repos/o/r/issues') return send(200, [{ number: 7, title: 'app live: 実機をそのまま調べる（ラボが使います）' }]);
      if (req.method === 'GET' && u.pathname === '/repos/o/r/issues/7/comments') return send(200, st.comments);
      if (req.method === 'POST' && u.pathname === '/repos/o/r/issues/7/comments') {
        const c = { id: nextId++, body: JSON.parse(body).body, created_at: new Date().toISOString(), user: { login: 'github-actions[bot]' } };
        st.comments.push(c); st.posted.push(c.body);
        // asked for a code: a stranger's first, then the run's user's
        if (/^lab-live@555 .*コードを送って/.test(c.body)) {
          st.comments.push({ id: nextId++, body: 'lab@555 code 999999', created_at: new Date().toISOString(), user: { login: 'stranger' } });
          st.comments.push({ id: nextId++, body: 'lab@555 code 123456', created_at: new Date().toISOString(), user: { login: 'me' } });
        }
        return send(201, c);
      }
      send(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const gh = { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '555', GITHUB_TOKEN: 'tok', LIVE_USER: 'me', APP_LIVE_POLL_MS: '30' };
  const labAsync = (P, extra) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'prepare', '--no-bds'], { cwd: TOP, env: { ...P.env, ...extra } });
    let text = ''; c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
    c.on('exit', (status) => resolve({ status, text, state: JSON.parse(fs.readFileSync(P.state, 'utf8')) }));
  });
  try {
    const P = prepEnv('signin-code');
    try {
      const r = await labAsync(P, { ...signinFast, ...SIGNIN_MS, ...gh, FAKE_SIGNIN: 'code' });
      ok(r.status === 0 && r.state.signedIn === true && /サインイン: code/.test(r.text), `exit ${r.status} phase ${r.state.phase}\n${r.text.slice(-1500)}`);
      eq(r.state.typed, [SIGNIN_MS.MS_EMAIL, SIGNIN_MS.MS_PASSWORD, '123456'], 'the run\'s user\'s code typed, the stranger\'s not');
      ok(st.posted.some((b) => /^lab-live@555 メールかスマホに届いたコードを送ってください/.test(b)), st.posted.join('\n'));
      noAccountIn(st.posted.join('\n') + r.text, r.state.calls);
    } finally { P.cleanup(); }
    const P2 = prepEnv('signin-approve');
    try {
      const r = await labAsync(P2, { ...signinFast, ...SIGNIN_MS, ...gh, FAKE_SIGNIN: 'approve' });
      ok(r.status === 0 && r.state.signedIn === true && /サインイン: approve（42）/.test(r.text), `exit ${r.status} phase ${r.state.phase}\n${r.text.slice(-1500)}`);
      ok(st.posted.filter((b) => /^lab-live@555 スマホの Microsoft Authenticator でサインインを承認してください（番号 42）/.test(b)).length === 1, 'the number said once: ' + st.posted.join('\n'));
      noAccountIn(st.posted.join('\n') + r.text, r.state.calls);
    } finally { P2.cleanup(); }
  } finally { server.close(); }
});
await t('prepare --account: the license check says no → what the device knows is written down, Play\'s page read, Play updates the game, the next start reaches the title', () => {
  const P = prepEnv('lic-fix');
  try {
    const r = P.lab(['prepare', '--no-bds', '--account'], { APP_INSTALL_VIA: 'adb', FAKE_PAIRIP_UNTIL_PLAY: '1' });
    ok(r.status === 0, `exit ${r.status}\n${r.text}`);
    ok(/入れたもの: installer=com\.android\.vending initiating=com\.android\.shell .*Play 自身が入れた: いいえ/.test(r.text) && /Google への登録（GSF の ID）: あり/.test(r.text) && /Play のライブラリ: 12 件/.test(r.text), 'the facts: ' + r.text);
    ok(/Play のページ: 「Update」（layout: Minecraft \/ Mojang \/ Update \/ Uninstall）/.test(r.text) && /Play に更新させます/.test(r.text) && /Play が Minecraft 1\.26\.52\.04 \(912605300\) を入れました/.test(r.text), r.text);
    ok(/タイトル画面になりました/.test(r.text) && /スナップショット lab-title を保存しました/.test(r.text), r.text);
    const stamp = JSON.parse(fs.readFileSync(path.join(P.avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8'));
    ok(stamp.apk === 912605300 && stamp.installedCode === 912605300 && stamp.versionName === '1.26.52.04' && stamp.account === true, JSON.stringify(stamp));
    const kept = path.join(P.avds, 'bdslab_app.avd', 'lab-prepare', 'prepare-license-1.txt');
    ok(fs.existsSync(kept) && /Play 自身が入れた: いいえ/.test(fs.readFileSync(kept, 'utf8')), 'how it was made travels with the device');
    noSecretIn(r);
    ok(!fs.readFileSync(kept, 'utf8').includes(FAKE_EMAIL) && !fs.readFileSync(kept, 'utf8').includes(FAKE_TOKEN), 'no secret in the facts');
  } finally { P.cleanup(); }
});
await t('prepare --account: Play shows a price (the account does not own the game on this device) → three starts, then a report that says what the device knew', () => {
  const P = prepEnv('lic-price');
  try {
    const r = P.lab(['prepare', '--no-bds', '--account'], { APP_INSTALL_VIA: 'adb', FAKE_PAIRIP_ALWAYS: '1', FAKE_NOT_OWNED: '1' });
    ok(r.status !== 0 && /ライセンス確認（Google Play）で止められました/.test(r.text), `exit ${r.status}\n${r.text}`);
    ok(/Play のページ: 「\$6\.99」/.test(r.text) && !/Play に更新させます|Play にインストールさせます/.test(r.text) && (r.text.match(/回目は失敗しました/g) ?? []).length === 2, r.text);
    const dir = path.join(TOP, /準備の記録: (app\/runs\/\S+-prepare)\//.exec(r.text)?.[1] ?? 'none');
    made.push(dir);
    ok(fs.existsSync(dir), 'the run folder is named: ' + r.text.slice(-400));
    const rep = fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), lic = fs.readFileSync(path.join(dir, 'license.txt'), 'utf8');
    ok(/## ライセンス: 端末が知っていること/.test(rep) && /Play 自身が入れた: いいえ/.test(rep), rep);
    ok(/1 回目の起動の後/.test(lic) && /3 回目の起動の後/.test(lic) && /com\.mojang\.minecraftpe: 無し/.test(lic), lic);
    ok(fs.existsSync(path.join(dir, 'license-log.txt')), 'Play\'s and the services\' lines');
    ok(R.guard(dir, [FAKE_TOKEN]).length === 0, 'guard clean');
    for (const f of ['report.md', 'license.txt', 'license-log.txt', 'run.txt']) ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(FAKE_EMAIL), `no email in ${f}`);
    noSecretIn(r);
  } finally { P.cleanup(); }
});
await t('prepare APP_INSTALL_VIA=play: no adb install; Play installs the game from its own page, the game starts to its title', () => {
  const P = prepEnv('lic-via');
  try {
    const r = P.lab(['prepare', '--no-bds', '--account'], { APP_INSTALL_VIA: 'play', FAKE_PAIRIP_UNTIL_PLAY: '1', FAKE_OPTIONS: 'gfx_viewdistance:96\\ncontent_log_file:0\\ncontent_log_gui:0\\nscreen_animations:1\\npanorama_scroll_speed:1\\n' });
    ok(r.status === 0, `exit ${r.status}\n${r.text}`);
    ok(!r.state.calls.some((c) => c.startsWith('install-multiple')), 'no adb install');
    ok(/Play のページ: 「Install」/.test(r.text) && /Play が Minecraft 1\.26\.52\.04 \(912605300、x86_64\) を入れました/.test(r.text) && /タイトル画面になりました/.test(r.text) && !/ライセンス確認:/.test(r.text), r.text);
    ok(/ゲームの設定を変えて起動し直します（content_log_file:1, screen_animations:0, panorama_scroll_speed:0, gfx_viewdistance:64: コンテンツログをファイルに、メニューの動きを止め、新しい人向けの画面を閉じ、描画を軽く）/.test(r.text) && /起動し直して、タイトル画面に戻りました/.test(r.text) && /^content_log_file:1$/m.test(r.state.options ?? '') && /^screen_animations:0$/m.test(r.state.options ?? '') && /^panorama_scroll_speed:0$/m.test(r.state.options ?? '') && /^gfx_viewdistance:64$/m.test(r.state.options ?? ''), 'the content log on, the menus still and the world lighter before the snapshot: ' + (r.state.options ?? '(none)') + r.text.slice(-600));
    const p3 = P.lab(['prepare', '--no-bds', '--account', '--force'], { FAKE_PAIRIP_UNTIL_PLAY: '1' });
    ok(p3.status === 0 && /Play のページ: 「(Install|Update)」/.test(p3.text) && !p3.state.calls.slice(r.state.calls.length).some((c) => c.startsWith('install-multiple')), 'with the account Play installs the game by default: ' + p3.text.slice(-800));
    // a download that fails (a slow line): the page offers Install again, which is pressed again
    const pf = P.lab(['prepare', '--no-bds', '--account', '--force'], { APP_INSTALL_VIA: 'play', FAKE_PAIRIP_UNTIL_PLAY: '1', FAKE_PLAY_FAIL: '1' });
    ok(pf.status === 0 && /Play のダウンロードが止まりました（ページに「(Install|Update)」が戻った）: もう一度押します（1 回目）/.test(pf.text) && pf.state.playFailed === 1, pf.text.slice(-1500));
    const p2 = P.lab(['prepare', '--no-bds'], { APP_INSTALL_VIA: 'play' });
    ok(p2.status !== 0 && /APP_INSTALL_VIA=play には --account が要ります/.test(p2.text), 'without the account: refused\n' + p2.text);
    noSecretIn(r);
  } finally { P.cleanup(); }
});
await t('prepare: a game that runs but never draws (a black screen) is said within minutes, with the GPU mode to change', () => {
  const P = prepEnv('black');
  try {
    const r = P.lab(['prepare', '--no-bds'], { FAKE_BLACK: '1', APP_BLACK_MS: '300', APP_TITLE_TIMEOUT: '60000' });
    ok(r.status !== 0 && /Minecraft は動いていますが、画面が \d+ 分真っ黒のままです/.test(r.text) && /APP_GAME_GL=angle/.test(r.text), r.text.slice(-1200));
  } finally { P.cleanup(); }
});
await t('prepare: the game\'s first start ("WELCOME TO MINECRAFT!": Sign in now / Maybe later) is left by its Maybe later, read by OCR; the focus is read from the displays, not from the state Android saved at the last ANR', async () => {
  const P = prepEnv('welcome'), C = await imp('app/lib/client.mjs');
  try {
    // (no own world: its restart would bring the fake's next ANR — this is about the first start)
    const r = P.lab(['prepare', '--no-bds'], { FAKE_WELCOME: '1', FAKE_ANR: '1', FAKE_OCR_TITLE: '1', APP_TESSERACT: path.join(FAKE, 'tesseract'), APP_SEED_WORLD: '0' });
    ok(r.status === 0 && r.state.welcomed === true && r.state.waited === 1, `exit ${r.status} welcomed ${r.state.welcomed} waited ${r.state.waited}\n${r.text.slice(-1500)}`);
    ok(/ゲームの最初の画面（WELCOME TO MINECRAFT! Sign in now）: 「Haybe later」をタップで押します/.test(r.text) && /ゲームの画面は「タップ」で押せました/.test(r.text) && /タイトル画面です（Play と Settings が読めました）/.test(r.text) && /タイトル画面になりました/.test(r.text), r.text.slice(-1500));
    // a game too slow for a tap: the next way (a held press) leaves the screen, and is kept for the runs
    fs.writeFileSync(P.state, JSON.stringify({ ...JSON.parse(fs.readFileSync(P.state, 'utf8')), welcomed: false }));
    const sl = P.lab(['prepare', '--no-bds', '--force'], { FAKE_WELCOME: '1', FAKE_SLOW_TAP: '1', FAKE_OCR_TITLE: '1', APP_TESSERACT: path.join(FAKE, 'tesseract') });
    ok(sl.status === 0 && /「Haybe later」をタップで押します/.test(sl.text) && /「Haybe later」を長めの押しで押します/.test(sl.text) && /ゲームの画面は「長めの押し」で押せました/.test(sl.text), sl.text.slice(-1500));
    eq(JSON.parse(fs.readFileSync(path.join(P.avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8')).tap, 'hold');
    ok(sl.state.calls.includes('shell input swipe 50 30 50 30 250'), 'held where OCR read it');
    // a first screen that takes no input at all: every way tried twice, then the device is kept on it (the run tries the join)
    fs.writeFileSync(P.state, JSON.stringify({ ...JSON.parse(fs.readFileSync(P.state, 'utf8')), welcomed: false }));
    const deaf = P.lab(['prepare', '--no-bds', '--force'], { FAKE_WELCOME: '1', FAKE_DEAF: '1', APP_TESSERACT: path.join(FAKE, 'tesseract') });
    ok(deaf.status === 0 && /W ゲームの最初の画面から抜けられません（「Haybe later」をタップ・コントローラー（↓ と A）・長めの押し・押して離す（motionevent）・タッチパネルから（sendevent）・戻るキー・↓ と Enterで 14 回/.test(deaf.text) && /ゲームは最初の画面（「Haybe later」が効かない）のまま準備を続けます/.test(deaf.text), deaf.text.slice(-1500));
    eq(JSON.parse(fs.readFileSync(path.join(P.avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8')).firstScreen, 'Haybe later');
    ok(deaf.state.calls.includes('shell input keyevent 4') && deaf.state.calls.includes('shell input motionevent DOWN 50 30; sleep 0.3; input motionevent UP 50 30') && deaf.state.calls.includes("shell echo 'A' > /data/local/tmp/lab-pad.fifo"), 'BACK, motionevent and the controller tried too');
    // a title OCR cannot place: taken once it has been calm three times as long, its words said
    const q = P.lab(['prepare', '--no-bds', '--force'], { APP_TESSERACT: path.join(FAKE, 'tesseract') });
    ok(q.status === 0 && /タイトル画面とします（落ち着いた画面。Play と Settings は読めませんでした。文字: Resume Game Settings Respawn）/.test(q.text), q.text.slice(-1200));
    ok(r.state.calls.includes('shell input tap 50 30') && r.state.calls.some((c) => /dumpsys window displays/.test(c)) && !r.state.calls.some((c) => /dumpsys window \|/.test(c)), 'Maybe later tapped where OCR saw it; the focus from the displays only');
    // the words as OCR gives them (pure): Maybe later misread, or not read at all (then under Sign in now)
    const w = (rows) => rows.map(([text, left, top, line]) => ({ text, left, top, width: 40, height: 20, conf: 90, line: `1.1.${line}` }));
    eq(C.firstRunButton(w([['Mavbe', 1100, 590, 3], ['Later', 1150, 590, 3]]))?.text, 'Mavbe Later');
    eq(C.firstRunButton(w([['Sign', 1100, 513, 2], ['in', 1150, 513, 2], ['now', 1200, 513, 2]]), { h: 720 }), { text: 'Sign in now の下', x: 1170, y: 602, box: null });
    eq(C.firstRunButton(w([['Sign', 1100, 513, 2], ['in', 1150, 513, 2], ['now', 1200, 513, 2]])), null, 'without the height: nothing guessed');
    eq(C.firstRunButton(w([['WELCOME', 100, 50, 1], ['Microsoft', 900, 60, 2], ['account', 960, 60, 2]]), { w: 1560, h: 720 }), { text: 'WELCOME の画面の Maybe later の位置', x: 1217, y: 605, box: null }, 'only its plain text read: where Maybe later is');
    eq(C.pressWays(), ['tap', 'pad', 'hold', 'motion', 'panel', 'back', 'keys']); eq(C.pressWays('motion'), ['motion', 'tap', 'pad', 'hold', 'panel', 'back', 'keys']); eq(C.pressWays('nope'), ['tap', 'pad', 'hold', 'motion', 'panel', 'back', 'keys']);
    // the touchscreen's own events (the panel way): its device, the display's turn, the point in the panel's terms
    const D2 = await imp('app/lib/android.mjs');
    const ge = 'add device 1: /dev/input/event3\n  name:     "qwerty2"\n  events:\n    KEY (0001): KEY_ESC\nadd device 2: /dev/input/event1\n  name:     "virtio_input_multi_touch_1"\n  events:\n    ABS (0003): ABS_MT_SLOT           : value 0, min 0, max 9, fuzz 0, flat 0, resolution 0\n                ABS_MT_POSITION_X     : value 0, min 0, max 32767, fuzz 0, flat 0, resolution 0\n                ABS_MT_POSITION_Y     : value 0, min 0, max 32767, fuzz 0, flat 0, resolution 0\n';
    const ts = D2.touchscreenOf(ge); eq(ts, { dev: '/dev/input/event1', maxX: 32767, maxY: 32767 }); eq(D2.touchscreenOf('add device 1: /dev/input/event3\n  name: "qwerty2"\n'), null);
    // (as a GitHub runner's emulator printed it: display -1 first, display 0's size as shown, turned)
    const vp = D2.viewportOf('  Viewports:\n    Viewport INTERNAL: displayId=-1, uniqueId=, port=<none>, orientation=0, logicalFrame=[0, 0, 0, 0], physicalFrame=[0, 0, 0, 0], deviceSize=[0, 0], isActive=[0]\n    Viewport INTERNAL: displayId=0, uniqueId=local:4619827259835644672, port=0, orientation=1, logicalFrame=[0, 0, 1560, 720], physicalFrame=[0, 0, 1560, 720], deviceSize=[1560, 720], isActive=[1]\n');
    eq(vp, { orientation: 1, w: 720, h: 1560 });
    eq(D2.touchscreenOf('add device 9: /dev/input/event5\n  name:     "virtio_input_multi_touch_4"\n    ABS_MT_POSITION_X     : value 0, min 0, max 32767\n    ABS_MT_POSITION_Y     : value 0, min 0, max 32767\nadd device 12: /dev/input/event2\n  name:     "virtio_input_multi_touch_1"\n    ABS_MT_POSITION_X     : value 0, min 0, max 32767\n    ABS_MT_POSITION_Y     : value 0, min 0, max 32767\n').dev, '/dev/input/event2', 'the first display\'s touchscreen');
    eq(D2.panelPoint(1217, 605, vp, { maxX: 719, maxY: 1559 }), [115, 1217], 'turned 90°: the panel\'s x from the bottom, its y from the left');
    eq(D2.panelPoint(100, 50, { orientation: 0, w: 720, h: 1560 }, { maxX: 32767, maxY: 32767 }), [4551, 1050]);
    ok(/^sendevent \/dev\/input\/event1 3 47 0; .*3 53 115; .*3 54 1217; .*1 330 1; .*sleep 0\.15; .*3 57 4294967295; .*0 0 0$/.test(D2.panelTapScript('/dev/input/event1', [115, 1217])), 'down, a moment, up');
    ok(C.titleWords(w([['Play', 600, 300, 1], ['Settings', 600, 400, 2]])) && !C.titleWords(w([['Play', 600, 300, 1]])), 'the title: Play and Settings');
  } finally { P.cleanup(); }
});
await t('prepare --account: the device base (Play Store and account in, no game) is kept apart; a new Minecraft is made from it: no account step, no new device', () => {
  const P = prepEnv('base');
  try {
    const a = P.lab(['prepare', '--no-bds', '--account'], { APP_INSTALL_VIA: 'play' });
    ok(a.status === 0, `exit ${a.status}\n${a.text}`);
    ok(/端末の土台としてキャッシュに入れます/.test(a.text) && /端末の土台（Play ストアとアカウント入り、ゲームなし）を非公開のキャッシュに入れました/.test(a.text) && /土台から起動し直し/.test(a.text), a.text);
    ok(a.state.calls.includes('shell sync; reboot -p'), 'Android shut down the proper way before the base is kept');
    const vault = path.join(tmp, 'vault-base'), base = JSON.parse(fs.readFileSync(path.join(P.avds, 'bdslab_app.avd', 'lab-base.json'), 'utf8'));
    ok(fs.existsSync(path.join(vault, 'base.bin')) && fs.existsSync(path.join(vault, 'avd.bin')) && base.base === WARM.BASE_FORMAT && base.account === true && base.writable === false && !('apk' in base), JSON.stringify(base));
    // a new Minecraft on another machine: the title device is gone, the base is in the cache
    fs.rmSync(P.avds, { recursive: true, force: true }); fs.rmSync(path.join(vault, 'avd.bin'), { force: true });
    const state = path.join(tmp, 'base.json'); fs.writeFileSync(state, JSON.stringify({ phase: 'home' })); fs.writeFileSync(state + '.power', 'off');
    const b = P.lab(['prepare', '--no-bds', '--account'], { APP_INSTALL_VIA: 'play', APP_PLAY_CODE: '912605301' });
    ok(b.status === 0, `exit ${b.status}\n${b.text}`);
    ok(/キャッシュから端末の土台（Play ストアとアカウント入り、ゲームなし）を戻しました/.test(b.text) && /端末の土台から: Play ストアとアカウント入り、ゲームなし/.test(b.text), b.text);
    ok(!b.state.calls.some((c) => /sqlite3|^reboot$/.test(c)) && !/アカウントを書き込みました/.test(b.text), 'the account is not written again (the same device)');
    ok(!b.state.calls.find((c) => c.startsWith('-avd'))?.includes('-wipe-data'), 'its data kept');
    const stamp = JSON.parse(fs.readFileSync(path.join(P.avds, 'bdslab_app.avd', 'lab-ready.json'), 'utf8'));
    ok(stamp.apk === 912605301 && /タイトル画面になりました/.test(b.text), JSON.stringify(stamp));
    noSecretIn(a); noSecretIn(b);
  } finally { P.cleanup(); }
});
await t('keys: Play\'s current build (no download) → the cache names; no cache key without a secret, a public repository too only with a key', () => {
  const sdk = path.join(tmp, 'sdk-keys'); fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI), { recursive: true });
  const outF = path.join(tmp, 'keys-out.txt');
  const run = (extra) => { fs.writeFileSync(outF, ''); const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'keys', '--account'], { cwd: TOP, encoding: 'utf8', env: { ...process.env, APP_EMULATOR: path.join(FAKE, 'adb'), APP_ADB: path.join(FAKE, 'adb'), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, GPDL_BIN: path.join(FAKE, 'gpdl'), GOOGLE_EMAIL: 'someone@example.com', GOOGLE_AAS_TOKEN: 'aas_et/' + 'k'.repeat(40), GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: outF, ...extra } }); return { status: r.status, text: r.stdout + r.stderr, out: Object.fromEntries(fs.readFileSync(outF, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2))) }; };
  const a = run({ APP_REPO_VISIBILITY: 'private', FAKE_GPDL_VERSION: '982605203 1.26.52.3' });
  ok(a.status === 0 && a.out.vault === 'true' && a.out.play_code === '982605203' && a.out.bds === '1.26.52.3', a.text);
  ok(/^app-avd-[0-9a-f]{16}-982605203-[0-9a-f]{12}$/.test(a.out.key_avd) && /^app-apk-[0-9a-f]{16}-982605203$/.test(a.out.key_apk) && /^app-bds-[0-9a-f]{16}-1\.26\.52\.3$/.test(a.out.key_bds), JSON.stringify(a.out));
  ok(!a.text.includes('k'.repeat(40)) && !a.text.includes('someone@example.com') && !fs.readFileSync(outF, 'utf8').includes('someone'), 'no secret printed');
  const b = run({ APP_REPO_VISIBILITY: 'public', FAKE_GPDL_VERSION: '982605203 1.26.52.3' });
  ok(b.status === 0 && b.out.vault === 'true' && b.out.key_avd === a.out.key_avd, 'public with a key: the same cache (sealed)\n' + b.text);
  const nb = run({ APP_REPO_VISIBILITY: 'public', GOOGLE_AAS_TOKEN: '', APP_CACHE_KEY: '', FAKE_GPDL_VERSION: '982605203 1.26.52.3' });
  ok(nb.out.vault === 'false' && /鍵/.test(nb.text), 'public without a key: no cache\n' + nb.text);
  const c = run({ APP_REPO_VISIBILITY: 'private' });
  ok(c.status === 0 && c.out.play_code === '' && /Google Play の版を確かめられません/.test(c.text), 'Play did not answer: said, and the run goes on\n' + c.text);
});
// ---- the real-device debug suite: client ops (app/lib/client.mjs), sections, the UI catalog (app/lib/uicatalog.mjs) ----
const CL = await imp('app/lib/client.mjs');
const UC = await imp('app/lib/uicatalog.mjs');
await t('client: keys by name (Android codes / Linux codes for holding), the keyboard device, OCR words → a tap target, content log levels, memory, frames', () => {
  eq([CL.androidKey('a'), CL.androidKey('T'), CL.androidKey('0'), CL.androidKey('F1'), CL.androidKey('ESCAPE'), CL.androidKey('slash'), CL.androidKey('66'), CL.androidKey('nope')], [29, 48, 7, 131, 111, 76, 66, null]);
  eq([CL.linuxKey('W'), CL.linuxKey('a'), CL.linuxKey('SPACE'), CL.linuxKey('SHIFT'), CL.linuxKey('1'), CL.linuxKey('0'), CL.linuxKey('?')], [17, 30, 57, 42, 2, 11, null]);
  const ge = 'add device 1: /dev/input/event0\n  name:     "Power Button"\n  events:\n    KEY (0001): KEY_POWER\nadd device 2: /dev/input/event2\n  name:     "qwerty2"\n  events:\n    KEY (0001): KEY_ESC KEY_1 KEY_W KEY_SPACE\n';
  eq(CL.keyboardDevice(ge), '/dev/input/event2'); eq(CL.keyboardDevice(''), null);
  eq(CL.holdScript('/dev/input/event2', [42, 17], 1500), 'sendevent /dev/input/event2 1 42 1;sendevent /dev/input/event2 0 0 0;sendevent /dev/input/event2 1 17 1;sendevent /dev/input/event2 0 0 0;sleep 1.500;sendevent /dev/input/event2 1 42 0;sendevent /dev/input/event2 0 0 0;sendevent /dev/input/event2 1 17 0;sendevent /dev/input/event2 0 0 0');
  eq(CL.inputText('/say 100% ok'), '/say%s100\\%%sok');
  const tsv = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t100\t200\t60\t20\t91\tResume\n5\t1\t1\t1\t1\t2\t170\t200\t50\t20\t90\tGame\n5\t1\t2\t1\t1\t1\t100\t300\t80\t20\t88\tSettings\n4\t1\t2\t1\t1\t0\t100\t300\t80\t20\t-1\t\n';
  const ws = CL.parseTsv(tsv);
  eq(ws.map((w) => w.text), ['Resume', 'Game', 'Settings']);
  eq(CL.findText(ws, /^settings$/i), { text: 'Settings', x: 140, y: 310, box: [100, 300, 180, 320] });
  eq(CL.findText(ws, /resume game/i)?.x, 160, 'two words on a line'); eq(CL.findText(ws, /quit/i), null);
  eq(['[2026-10-03 09:00:00:123 ERROR] [UI] bad', '[2026-10-03 09:00:00:123 WARN] [UI] meh', '[2026-10-03 09:00:00:123 INFO] fine', 'plain'].map(CL.logLevel), ['error', 'warn', 'info', null]);
  eq(CL.meminfoMb('  TOTAL PSS:   824320            TOTAL RSS: 1'), 805); eq(CL.meminfoMb('nothing'), null);
  eq(CL.contentLogSwitches('gfx_viewdistance:96\ncontent_log_file:0\ncontent_log_gui:0\ncontent_log_gui_level:2\ndev_contentlog_enabled:false\nmp_username:Steve\n'), ['content_log_file', 'dev_contentlog_enabled'], 'the file switches, not the on-screen one');
  eq(CL.contentLogSwitches('content_log_file:1\n'), [], 'already on');
  eq(CL.fastUiSwitches('screen_animations:1\npanorama_scroll_speed:0\ngfx_viewdistance:96\n'), { screen_animations: '0' }, 'only what this version has and is not off yet');
  eq(CL.lightGfxSwitches('gfx_viewdistance:96\ngfx_smoothlighting:0\ngfx_toggleclouds:1\ngfx_max_framerate:0\nscreen_animations:1\n'), { gfx_viewdistance: '64', gfx_toggleclouds: '0', gfx_max_framerate: '20' }, 'the world drawn lighter: only keys this version has, not the UI');
  const PW = (t) => t.split(' ').map((x, i) => ({ text: x, x: i * 10, y: 5, w: 8, h: 3 }));
  eq(CL.playScreen(PW("Worlds (1) Realms Servers Survival lab Dedicated Server's world B Back")), { lan: true, focused: false });
  eq(CL.playScreen(PW("F Worlds ¢13 © Realms ® Servers te Survival lab Dedicated Server's world B Back A Play")), { lan: true, focused: true }, 'as OCR read it on the CI device');
  eq(CL.playScreen(PW('Resume Game Settings')), null);
  // the gamepad's focus: the button drawn green around its word
  const btn = { w: 20, h: 10, data: Buffer.alloc(20 * 10 * 4, 120) }, word = { text: 'Play', left: 4, top: 4, width: 8, height: 2 };
  ok(!CL.buttonFocused(btn, word), 'grey: not focused');
  for (let y = 0; y < 10; y++) for (let x = 2; x < 14; x++) { const o = (y * 20 + x) * 4; btn.data[o] = 60; btn.data[o + 1] = 133; btn.data[o + 2] = 39; }
  ok(CL.buttonFocused(btn, word), 'green: focused');
  eq(['ctrl_type_0_key.jump:1', 'keyboard_type_1_key.use:69', 'command_macro_command_3:', 'gfx_touchButton4Opacity:0.5', 'gfx_classicButton1X:0.9', 'show_jump_tip_times_remain:3', 'do_not_show_storage_low_warning:0', 'DO_NOT_SHOW_PARTIES_NOT_SUPPORTED_WARNING:0', 'gfx_viewdistance:96', 'content_log_file:0', 'graphics_mode_switch:0', 'gfx_touchDpadScale:1.2'].filter((l) => !CL.OPTIONS_NOISE.test(l)),
    ['gfx_viewdistance:96', 'content_log_file:0', 'graphics_mode_switch:0'], 'the report keeps the settings, not the bindings, button places and tip counters');
  eq(CL.gameLayer('Wallpaper\nSurfaceView[com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity]#12\nSurfaceView[com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity](BLAST)#13', 'com.mojang.minecraftpe'), 'SurfaceView[com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity](BLAST)#13', 'the layer with the frames (on a runner the container showed none)');
  eq(CL.framesIn('16666666\n1 1000000000 1\n1 1500000000 1\n1 2000000000 1\n1 9223372036854775807 1\n', 1200), 3);
  const W2 = (t, line, left) => ({ text: t, line, left, top: 0, width: 10, height: 10 });
  eq(CL.rawKeys([W2('item.lab:ruby.name', '1.1.1', 0), W2('Resume', '1.1.2', 0), W2('tile.lab:lamp', '1.1.3', 0), W2('.name', '1.1.3', 20), W2('www.example.com', '1.1.4', 0), W2('action.interact.open', '1.1.5', 0)]), ['item.lab:ruby.name', 'tile.lab:lamp.name', 'action.interact.open'], 'keys, one the OCR cut in two too');
  eq(CL.rawKeys([W2('Resume', '1', 0), W2('Game', '1', 20), W2('www.example.com', '2', 0), W2('Settings', '3', 0)]), [], 'ordinary words and a web address are not keys');
  const dec = (img) => img, img = (px) => ({ w: 10, h: 10, data: Buffer.from(Array.from({ length: 100 }, (_, i) => px(i)).flat()) });
  eq(CL.magentaShare(img(() => [40, 40, 40, 255]), dec, 1), 0); eq(CL.magentaShare(img((i) => (i < 25 ? [248, 0, 248, 255] : [40, 40, 40, 255])), dec, 1), 0.25, 'a quarter in the missing-texture magenta');
  eq(CL.magentaShare(img(() => [200, 40, 60, 255]), dec, 1), 0, 'red is not magenta');
});
await t('scenario: the client verbs read and checked (section, chat, tap text, until text, press, hold, record, perf, clientlog), with line-numbered mistakes', () => {
  const { steps, errors } = S.parseScenario('section hud\nchat /say hi there\ntap text (?i)^settings$\nuntil text Respawn 30000\npress SHIFT+W 1500\nhold 0.5 0.5 800\nrecord start\nrecord stop\nperf 2000\nuntil clientlog (?i)error 5000\nexpect clientlog UI\nabsent clientlog (?i)failed to parse\nkey T\nkey F3\nchanged 0.05\nnetwork delay 300\nnetwork speed edge\n');
  eq(errors, []);
  eq(steps.map((x) => x.verb), ['section', 'chat', 'tap', 'until', 'press', 'hold', 'record', 'record', 'perf', 'until', 'expect', 'absent', 'key', 'key', 'changed', 'network', 'network']);
  eq(steps[1].args, ['/say hi there']); eq(steps[2].args, ['text', '(?i)^settings$']); eq(steps[3].args, ['text', 'Respawn', '30000']); eq(steps[9].args, ['clientlog', '(?i)error', '5000']);
  const bad = S.parseScenario('section two words\npress Q? 100\nhold 0.5\nrecord pause\nperf soon\ntap text\nkey NOPE\nuntil text\nexpect clientlog\nchanged 2\nnetwork delay slow\n').errors;
  eq(bad.length, 11, bad.join('\n'));
  ok(bad.every((e, i) => e.startsWith(`${i + 1}: `)), bad.join('\n'));
});
await t('scenario: with sections a failure costs only its section (the screen is closed, the next section runs); the content log is tied to the section that wrote it', async () => {
  const dir = path.join(tmp, 'sec'); fs.mkdirSync(dir, { recursive: true });
  const srv = path.join(dir, 'server.log'); fs.writeFileSync(srv, ''); fs.writeFileSync(path.join(dir, 'logcat.txt'), '');
  const shot = pngEncode({ w: 8, h: 8, data: Buffer.alloc(8 * 8 * 4, 120) }), calls = [];
  const adb = { screencap: () => shot, shell: (w) => { calls.push(w.join(' ')); return { status: 0, stdout: '', stderr: '' }; }, run: (a) => { calls.push(a.join(' ')); return { status: 0, stdout: '', stderr: '' }; } };
  // the content log grows as the steps go: what each read (at every section boundary, and at the end) finds new
  const chunks = [[], ['[2026-10-03 09:00:00:000 INFO] pack loaded'], ['[2026-10-03 09:00:01:000 ERROR] [UI] hud_screen.json: unknown control'], [], ['[2026-10-03 09:00:02:000 WARN] [UI] chat']];
  const clientLog = { read: () => chunks.shift() ?? [] };
  let recovered = 0;
  const { steps } = S.parseScenario('section join\nwait 1\nsection hud\nwait 1\nsection broken\nexpect server never-there\nshot never\nsection chat\nkey T\nshot chat\n');
  const r = await S.runScenario(steps, { adb, runDir: dir, decode: pngDecode, pkg: 'x', logcatFile: path.join(dir, 'logcat.txt'), server: { logFile: srv, joinUri: 'u', do: async () => ({ ok: true, lines: [] }) }, clientLog, recover: async () => { recovered++; } });
  ok(!r.ok && recovered === 1, 'failed once, recovered once');
  eq(r.results.map((x) => `${x.section}:${x.raw}:${x.ok ? 'ok' : 'NG'}`), ['join:section join:ok', 'join:wait 1:ok', 'hud:section hud:ok', 'hud:wait 1:ok', 'broken:section broken:ok', 'broken:expect server never-there:NG', 'chat:section chat:ok', 'chat:key T:ok', 'chat:shot chat:ok']);
  eq(r.sections.map((x) => [x.name, x.ok, x.client.length]), [['join', true, 1], ['hud', true, 1], ['broken', false, 0], ['chat', true, 1]]);
  ok(r.sections[1].client[0].includes('unknown control'), 'the UI error is the hud section\'s');
  ok(calls.includes('input keyevent 48'), 'key T');
});
await t('ui catalog: an addon\'s rp/ui files → the screens that draw them, dealt to devices; the suite reads as a scenario', () => {
  eq(UC.addonUiFiles(path.join(TOP, 'bds', 'addons', 'jsonui_demo')), ['ui/server_form.json']);
  const p = UC.screensFor(['ui/server_form.json', 'ui/hud_screen.json', 'ui/_ui_defs.json', 'ui/my_common.json', 'ui/weird_screen.json', 'ui/start_screen.json']);
  eq(p.screens.map((x) => x.id), ['hud', 'form-action', 'form-modal', 'form-message']); eq(p.start, true); eq(p.own, ['ui/my_common.json']); eq(p.unknown, ['ui/weird_screen.json']);
  const ids = UC.SCREENS.map((x) => x.id);
  eq(new Set(ids).size, ids.length, 'ids are unique');
  const all = [1, 2, 3].flatMap((k) => UC.shard(UC.SCREENS, k, 3).map((x) => x.id));
  eq([...all].sort(), [...ids].sort(), 'every screen on exactly one device');
  eq(UC.shard(UC.SCREENS, 1, 1).slice(-2).map((x) => x.id), ['death', 'disconnect'], 'the screens that end the session last');
  const sc = UC.suiteScenario({ screens: UC.SCREENS });
  const parsed = S.parseScenario(sc);
  eq(parsed.errors, []);
  ok(parsed.steps.filter((x) => x.verb === 'section').length === UC.SCREENS.length + 2, 'a section per screen, plus start and join');
  ok(/^shot world$/m.test(sc) && /^until joined 300000$/m.test(sc), 'the world baseline after the join');
  ok(!/form-action/.test(UC.suiteScenario({ screens: p.screens, serverUi: false }).split('\n').filter((l) => !l.startsWith('#')).join('\n')), 'no forms without server-ui');
});
await t('scenario + ui: other shapes (size, density, cutout), words that must or must not be on the screen (OCR); every screen again on each shape', () => {
  const { steps, errors } = S.parseScenario('size 1024x768\nsize reset\ndensity 320\ndensity reset\ncutout tall\ncutout none\nexpect text (?i)^settings$\nabsent text \\.name$\n');
  eq(errors, []); eq(steps.map((x) => x.verb), ['size', 'size', 'density', 'density', 'cutout', 'cutout', 'expect', 'absent']);
  eq(steps[6].args, ['text', '(?i)^settings$']); eq(steps[7].args, ['text', '\\.name$']);
  const bad = S.parseScenario('size big\ndensity 5000\ncutout banana\nexpect text\nsize 1024x768 2\n').errors;
  eq(bad.length, 5, bad.join('\n'));
  const more = S.parseScenario('mouse tap 0.5 0.5\nmouse move 100 200\nmouse scroll 0.5 0.5 -3\npad a\npad START\nscreen off\nscreen on\nbackground\nforeground\ntrim running_critical\n');
  eq(more.errors, []); eq(more.steps.map((x) => x.verb), ['mouse', 'mouse', 'mouse', 'pad', 'pad', 'screen', 'screen', 'background', 'foreground', 'trim']);
  eq(S.parseScenario('mouse jump 1 2\nmouse tap 1\npad Z\nscreen dim\nbackground now\ntrim LOW\n').errors.length, 6);
  const v = UC.variants({ sizes: '1024x768, 2400x1080', cutouts: 'tall' });
  eq(v.map((x) => x.id), ['1024x768', '2400x1080', 'cutout-tall']);
  let threw = ''; try { UC.variants({ sizes: '1024' }); } catch (e) { threw = e.message; } ok(/幅x高さ/.test(threw), threw);
  threw = ''; try { UC.variants({ cutouts: 'round' }); } catch (e) { threw = e.message; } ok(/corner/.test(threw), threw);
  const chest = UC.SCREENS.find((x) => x.id === 'chest'), death = UC.SCREENS.find((x) => x.id === 'death');
  const sc = UC.suiteScenario({ screens: [chest, death], vars: [v[0], v[2]] }), p = S.parseScenario(sc);
  eq(p.errors, []);
  eq(p.steps.filter((x) => x.verb === 'section').map((x) => x.args[0]), ['start', 'join', 'chest', 'shape--1024x768', 'chest--1024x768', 'shape-off--1024x768', 'shape--cutout-tall', 'chest--cutout-tall', 'shape-off--cutout-tall', 'death'], 'each shape: its own baseline, every screen, then back; death last of all');
  ok(/^shot ui-chest--1024x768$/m.test(sc) && /^shot world--cutout-tall$/m.test(sc) && /^size 1024x768$/m.test(sc) && /^cutout none$/m.test(sc), sc);
});
await t('run: the device\'s own inputs — mouse (press, hover, wheel), a game controller, the screen off and on, home and back, a memory warning', () => {
  const sc = path.join(tmp, 'inputs.txt');
  fs.writeFileSync(sc, 'launch\nuntil title 60000\njoin\nuntil joined 60000\nshot world\nmouse tap 0.5 0.5\nmouse move 0.25 0.25\nmouse scroll 0.5 0.5 3\npad A\npad up\nscreen off\nscreen on\nbackground\nforeground\ntrim RUNNING_CRITICAL\n');
  const r = e2e('inputs', { APP_TITLE_CALM_MS: '100' }, ['--scenario', sc]);
  made.push(r.runDir);
  ok(r.status === 0, `exit ${r.status}\n${r.text.slice(-2500)}`);
  const c = r.state.calls;
  // (a button through the device's own controller, plugged in by the run: its FIFO; a direction as a key event)
  for (const want of ['shell input mouse tap 32 18', 'shell input mouse motionevent HOVER_MOVE 16 9', 'shell input mouse scroll 32 18 --axis VSCROLL,-3', "shell echo 'A' > /data/local/tmp/lab-pad.fifo", 'shell input gamepad keyevent KEYCODE_DPAD_UP',
    'shell input keyevent 223', 'shell input keyevent 224', 'shell input keyevent 3', 'shell am send-trim-memory com.mojang.minecraftpe RUNNING_CRITICAL']) ok(c.includes(want), `${want}\n${c.slice(-40).join('\n')}`);
  ok(c.filter((x) => /^shell monkey -p com\.mojang\.minecraftpe/.test(x)).length >= 2, 'foreground starts the game again');
});
await t('app ui --sizes/--cutouts: every screen again on a 4:3 tablet and under a notch, the shape put back after each', () => {
  const state = path.join(tmp, 'ui-shapes.json'); fs.writeFileSync(state, JSON.stringify({ phase: 'home' }));
  const sdk = path.join(tmp, 'sdk-ui'); fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI), { recursive: true });
  const env = { ...process.env, FAKE_APP_STATE: state, APP_ADB: path.join(FAKE, 'adb'), APP_EMULATOR: path.join(FAKE, 'adb'), APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, APP_APK_DIR: apkDir, APP_STABLE_MS: '100', APP_TITLE_CALM_MS: '100', APP_ADBKEY_DIR: path.join(tmp, 'adbkey-e2e'), APP_TESSERACT: path.join(FAKE, 'tesseract'), APP_UI_CUTOUTS: 'tall', FAKE_MAGENTA: '1', FAKE_OCR_RAWKEY: '1' };
  delete env.GOOGLE_AAS_TOKEN; delete env.GOOGLE_EMAIL; delete env.GITHUB_ACTIONS; delete env.GITHUB_STEP_SUMMARY;
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'ui', '-a', 'jsonui_demo', '--no-fetch', '--screens', 'chest', '--sizes', '1024x768'], { cwd: TOP, env, encoding: 'utf8', timeout: 600_000 });
  const text = r.stdout + r.stderr, runDir = path.join(TOP, 'app', /→ (app\/runs\/\S+)/.exec(text)?.[1]?.replace(/^app\//, '') ?? 'none');
  made.push(runDir);
  ok(r.status === 0, `exit ${r.status}\n${text.slice(-2500)}`);
  const st = JSON.parse(fs.readFileSync(state, 'utf8'));
  eq(st.shape, ['wm size 768x1024', 'wm size reset', 'cmd overlay enable-exclusive --category com.android.internal.display.cutout.emulation.tall', st.shape?.[3]], 'the tablet (the device upright: 768 wide), back, the notch (the knob APP_UI_CUTOUTS), back');
  ok(/^cmd overlay disable com\.android\.internal\.display\.cutout\.emulation\.corner/.test(st.shape?.[3] ?? ''), st.shape?.[3]);
  const rep = fs.readFileSync(path.join(runDir, 'report.md'), 'utf8');
  ok(/\| chest--1024x768 \| ✔ \|/.test(rep) && /\| chest--cutout-tall \| ✔ \|/.test(rep), rep.slice(0, 2500));
  ok(fs.readdirSync(path.join(runDir, 'shots')).some((f) => /-ui-chest--1024x768\.png$/.test(f)), 'its picture, named after the shape');
  ok(/画面 ui-chest の [\d.]+% が紫（マゼンタ）: テクスチャが見つからない/.test(rep) && !/画面 world の/.test(rep), 'a missing texture seen in the picture: ' + rep.slice(0, 3000));
  ok(/画面 ui-chest に、訳されていないキーらしい文字: item\.lab:ruby\.name/.test(rep) && !/画面 world に、訳されていない/.test(rep), 'a raw translation key read on a screen\'s picture: ' + rep.slice(0, 3000));
});
await t('app ui --all: every screen as a section on the device (keys, forms by js, blocks tapped, OCR buttons), the content log\'s errors fail it and are listed by screen', () => {
  const clog = path.join(tmp, 'ContentLog.txt');
  fs.writeFileSync(clog, '[2026-10-03 09:00:00:000 INFO] [Packs] loaded\n[2026-10-03 09:00:01:000 ERROR] [UI] server_form.json | demo_form | binding #nope not found\n');
  const run = (extra, args) => {
    const state = path.join(tmp, `ui-${args.length}.json`); fs.writeFileSync(state, JSON.stringify({ phase: 'home' }));
    const sdk = path.join(tmp, 'sdk-ui'); fs.mkdirSync(path.join(sdk, 'system-images', 'android-34', 'google_apis', HOST_ABI), { recursive: true });
    const env = { ...process.env, FAKE_APP_STATE: state, APP_ADB: path.join(FAKE, 'adb'), APP_EMULATOR: path.join(FAKE, 'adb'), APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'), ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, APP_APK_DIR: apkDir, APP_STABLE_MS: '100', APP_TITLE_CALM_MS: '100', APP_ADBKEY_DIR: path.join(tmp, 'adbkey-e2e'), APP_TESSERACT: path.join(FAKE, 'tesseract'), FAKE_CONTENT_LOG: clog, ...extra };
    delete env.GOOGLE_AAS_TOKEN; delete env.GOOGLE_EMAIL; delete env.GITHUB_ACTIONS; delete env.GITHUB_STEP_SUMMARY;
    const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'ui', '-a', 'jsonui_demo', '--no-fetch', ...args], { cwd: TOP, env, encoding: 'utf8', timeout: 600_000 });
    const text = r.stdout + r.stderr, runDir = path.join(TOP, 'app', /→ (app\/runs\/\S+)/.exec(text)?.[1]?.replace(/^app\//, '') ?? 'none');
    made.push(runDir);
    return { status: r.status, text, runDir, state: JSON.parse(fs.readFileSync(state, 'utf8')) };
  };
  const r = run({}, ['--all', '--shard', '1/2']);
  const rep = fs.existsSync(path.join(r.runDir, 'report.md')) ? fs.readFileSync(path.join(r.runDir, 'report.md'), 'utf8') : '';
  ok(r.status === 1 && /# app: FAIL/.test(rep), `the content log's ERROR fails it\n${r.text.slice(-3000)}`);
  ok(/## 画面ごと（section）/.test(rep) && UC.shard(UC.SCREENS, 1, 2).every((x) => new RegExp(`\\| ${x.id} \\| ✔ \\|`).test(rep)), 'a row per screen, each opened\n' + rep.slice(0, 3000));
  ok(/## クライアントのエラー（ゲームのコンテンツログ）/.test(rep) && /✘ \[\(はじめ\)\] .*binding #nope not found/.test(rep), 'the error, with the section it came in');
  const mine = UC.shard(UC.SCREENS, 1, 2).map((x) => x.id), sections = [...rep.matchAll(/^\| ([\w.-]+) \| [✔✘] \|/gm)].map((m) => m[1]);
  eq(sections.filter((x) => !['start', 'join'].includes(x)), mine, 'this device\'s half of the screens, in order');
  const sc = fs.readFileSync(path.join(r.runDir, 'scenario.txt'), 'utf8');
  ok(/^shot ui-start$/m.test(sc) && /^# この台の画面: start /m.test(sc), 'the title screen on device 1');
  ok(r.state.calls.includes('shell input keyevent 33') || !mine.includes('inventory'), 'E for the inventory');
  ok(r.state.calls.some((c) => /^shell input tap 395 312$/.test(c)) || !mine.includes('settings'), 'Settings tapped where the OCR saw it: ' + r.state.calls.filter((c) => /input tap/.test(c)).join(' | '));
  ok(r.state.bds.some((c) => /^do js \(\(\) => \{ const q = world\.getAllPlayers\(\)\[0\]; new ui\.ActionFormData\(\)/.test(c)) || !mine.includes('form-action'), 'the form shown through js');
  const r2 = run({}, ['--screens', 'pause,chest', '--allow-client-errors']);
  const rep2 = fs.readFileSync(path.join(r2.runDir, 'report.md'), 'utf8');
  ok(r2.status === 0 && /# app: PASS/.test(rep2) && /--allow-client-errors/.test(rep2), 'allowed: listed, not failed\n' + r2.text.slice(-2000));
  ok(r2.state.bds.includes('do setblock 0 -60 2 chest') && r2.state.calls.includes('shell input tap 32 18'), 'the chest placed in front and the centre tapped');
  const plan = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'ui', '-a', 'jsonui_demo', '--list'], { cwd: TOP, encoding: 'utf8' });
  ok(plan.status === 0 && /ui\/server_form\.json → form-action form-modal form-message/.test(plan.stdout), plan.stdout.slice(0, 500));
  const bad = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'ui', '-a', 'jsonui_demo', '--screens', 'nope'], { cwd: TOP, encoding: 'utf8' });
  ok(bad.status === 1 && /知らない画面: nope/.test(bad.stdout + bad.stderr), bad.stdout + bad.stderr);
});
// --real: the same run on the real BDS (bds/lab.mjs up/do/down, LAB_TAIL, packs required, fixed port); the lab's own real
// Bedrock client joins in the app's place when the fake app follows the deep link. Needs `node lab.mjs bds setup` first.
if (process.argv.includes('--real')) await t('run --real: the real live BDS, a real client joining in the app\'s place', () => {
  const r = e2e('real', { FAKE_REAL_JOIN: '1', APP_BDS_LAB: '', APP_TRANSPORT: 'raknet' }, ['--bds', 'keep']);
  made.push(r.runDir);
  ok(r.status === 0, `exit ${r.status}\n${r.text}`);
  const sl = fs.readFileSync(path.join(r.runDir, 'server.log'), 'utf8');
  ok(/Player Spawned: Steve/.test(sl) && /DEMO shown to 1/.test(sl) && /DEMO Steve picked closed/.test(sl), sl.slice(-1500));
  ok(/texturepack-required=true/.test(fs.readFileSync(path.join(TOP, 'bds', '.lab', 'run', 'live', 'server.properties'), 'utf8')), 'packs required on the live server');
});
// ---- redroid (app/redroid): the pieces that need no docker, binder or device ----
{
  const RD = await imp('app/redroid/redroid.mjs');
  const facts = { platform: 'linux', kernel: '6.17', docker: true, dockerd: true, binder: true, overlay: true, sudo: true, adb: true, python3: true, tesseract: true, uinput: true, image: true, prepared: true, account: false };
  await t('redroid doctor: all there → nothing to fix (the account not needed once the device is prepared)', () => {
    const rows = RD.doctor(facts);
    eq(rows.filter((r) => !r.ok && !r.soft).map((r) => r.name), []);
  });
  await t('redroid doctor: the first missing piece is the next step, in the order they are fixed', () => {
    const first = (f) => RD.doctor({ ...facts, ...f }).find((r) => !r.ok && !r.soft);
    eq(first({ binder: false, image: false }).name, 'binder');
    ok(/modprobe binder_linux/.test(first({ binder: false }).fix), 'binder fix names modprobe');
    eq(first({ dockerd: false }).name, 'docker');
    eq(first({ platform: 'darwin' }).name, 'Linux');
    eq(first({ prepared: false }).name, 'Google の認証');
    eq(first({ prepared: false, account: true }).name, '準備済みの端末');
    ok(/app redroid prep/.test(first({ prepared: false, account: true }).fix), 'prep is the fix');
    eq(first({ tesseract: false, uinput: false, overlay: false }), undefined, 'soft rows never block');
  });
  await t('redroid appArgs: -a / --keep its own, the rest to app run after --, emulator-only flags refused', () => {
    eq(RD.appArgs('run', ['-a', 'demo']).args, ['debug', '--addon', 'demo', '--mode', 'run']);
    eq(RD.appArgs('ui', ['--addon', 'demo', '--keep', '--all', '--screens', 'start,chat']).args, ['debug', '--addon', 'demo', '--mode', 'ui', '--keep', '--', '--all', '--screens', 'start,chat']);
    eq(RD.appArgs('run', ['-a', 'demo', '--data', '/d', '--scenario', 'x.txt']).args, ['debug', '--addon', 'demo', '--mode', 'run', '--data', '/d', '--', '--scenario', 'x.txt']);
    ok(/-a/.test(RD.appArgs('run', []).error), 'no addon');
    for (const f of RD.EMULATOR_ONLY) ok(RD.appArgs('run', ['-a', 'demo', f]).error?.includes(f), `${f} refused`);
  });
  await t('redroid deviceOf: --device taken out; APP_DEVICE when not given; never inside a run redroid started', () => {
    eq(RD.deviceOf(['-a', 'x', '--device', 'redroid'], {}), { device: 'redroid', argv: ['-a', 'x'] });
    eq(RD.deviceOf(['-a', 'x'], {}).device, 'emu');
    eq(RD.deviceOf(['-a', 'x'], { APP_DEVICE: 'redroid' }).device, 'redroid');
    eq(RD.deviceOf(['-a', 'x'], { APP_DEVICE: 'redroid', APP_SERIAL: '127.0.0.1:5600' }).device, 'emu');
  });
  await t('redroid bootArgs: the screen from REDROID_SIZE, no setup wizard, only key=value words kept', () => {
    const a = RD.bootArgs({ REDROID_SIZE: '1280x720@240', REDROID_ARGS: 'ro.x=1 bad;rm' });
    ok(a.includes('androidboot.redroid_width=1280') && a.includes('androidboot.redroid_dpi=240') && a.includes('ro.setupwizard.mode=DISABLED') && a.includes('ro.x=1'), a.join(' '));
    ok(!a.some((x) => /;/.test(x)), 'nothing shell-like');
  });
  await t('app ci --device redroid --wait: dispatches redroid.yml with its inputs, waits, fetches the artifacts and the notices (fake gh)', () => {
    const bin = path.join(tmp, 'ghbin-redroid'), log = path.join(tmp, 'gh-redroid.log'); fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n');
const j = (o) => console.log(JSON.stringify(o));
if (a[0] === '--version') console.log('gh version 2');
else if (a[0] === 'workflow') console.log('https://github.com/o/r/actions/runs/42');
else if (a[0] === 'run' && a[1] === 'watch') {}
else if (a[0] === 'run' && a[1] === 'download') { const d = path.join(a[a.indexOf('-D') + 1], 'redroid-game'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'report.md'), '# PASS jsonui_demo\\n参加 ✔\\n'); }
else if (a[0] === 'api' && /runs\\/42$/.test(a[1])) j({ status: 'completed', conclusion: 'success' });
else if (a[0] === 'api' && /runs\\/42\\/jobs$/.test(a[1])) j({ jobs: [{ id: 7 }] });
else if (a[0] === 'api' && /check-runs\\/7\\/annotations$/.test(a[1])) j([{ annotation_level: 'notice', title: 'app run を redroid で', message: 'PASS（120 秒）' }, { annotation_level: 'notice', title: 'デバッグできるまで', message: '{"totalS":48}' }]);
else { console.error('unknown ' + a.join(' ')); process.exit(1); }
`); fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'ci', '--device', 'redroid', '-a', 'jsonui_demo', '--mode', 'ui', '--keep', '--wait', '--repo', 'o/r', '--ref', 'main'], { encoding: 'utf8', cwd: TOP, env });
    const said = fs.readFileSync(log, 'utf8');
    eq(r.status, 0, r.stdout + r.stderr);
    ok(/workflow run redroid\.yml --repo o\/r --ref main -f addon=jsonui_demo -f mode=ui -f bench=false -f keep=true -f fresh=false/.test(said), said);
    ok(/run watch 42/.test(said) && /run download 42/.test(said), said);
    ok(/^PASS redroid success/m.test(r.stdout) && /app run を redroid で: PASS/.test(r.stdout) && /# PASS jsonui_demo/.test(r.stdout), r.stdout);
    const dir = path.join(TOP, 'app', 'runs', 'gh-42'); made.push(dir);
    ok(/デバッグできるまで/.test(fs.readFileSync(path.join(dir, 'notices.txt'), 'utf8')), 'notices kept');
    const m = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'ci', '--device', 'redroid', '--mode', 'ui-all', '--repo', 'o/r'], { encoding: 'utf8', cwd: TOP, env });
    eq(m.status, 1); ok(/ui-all/.test(m.stdout), m.stdout);
  });
  await t('redroid vault: the prepared /data sealed and opened again with its Android uids and modes (VAULT_TAR)', async () => {
    if (process.getuid?.() !== 0) return;   // (chown to an Android uid needs root, as the workflow's sudo does)
    const V = await imp('app/lib/vault.mjs'), { VAULT_TAR } = await imp('app/redroid/game.mjs');
    const base = path.join(tmp, 'rd'), data = path.join(base, 'data'), f = path.join(data, 'data', 'com.x', 'a.db');
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'db'); fs.chownSync(f, 10123, 10123); fs.chmodSync(f, 0o600);
    const key = V.vaultKey({ APP_CACHE_KEY: 'k' }), bin = path.join(tmp, 'rd.bin');
    await V.seal({ base, entries: ['data'], outFile: bin, key, tarArgs: VAULT_TAR });
    fs.rmSync(data, { recursive: true });
    ok(await V.open({ inFile: bin, dest: base, key, tarArgs: VAULT_TAR }), 'opened');
    const st = fs.statSync(f);
    eq([st.uid, st.gid, st.mode & 0o777, fs.readFileSync(f, 'utf8')], [10123, 10123, 0o600, 'db']);
    ok(!(await V.open({ inFile: bin, dest: base, key: V.vaultKey({ APP_CACHE_KEY: 'other' }) })), 'another key opens nothing');
  });
  await t('redroid running: a device --keep left up is found (container running, adb device, boot completed); else not', async () => {
    const bin = path.join(tmp, 'rdbin'); fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\necho "$FAKE_RUNNING|/p/data|bdslab/redroid:gapps"\n'); fs.chmodSync(path.join(bin, 'docker'), 0o755);
    fs.writeFileSync(path.join(bin, 'adb'), '#!/bin/sh\ncase "$*" in *connect*) echo "connected to x";; *get-state*) echo device;; *boot_completed*) echo "$FAKE_BOOTED";; esac\n'); fs.chmodSync(path.join(bin, 'adb'), 0o755);
    const was = { PATH: process.env.PATH, ADB: process.env.ADB };
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`; process.env.ADB = path.join(bin, 'adb');
    try {
      const RD = await imp('app/redroid/redroid.mjs'), at = (run, boot) => { process.env.FAKE_RUNNING = run; process.env.FAKE_BOOTED = boot; return RD.running(); };
      eq([at('true', '1'), at('false', '1'), at('true', '')], [true, false, false]);
      // (reused only for the same prepared device and image)
      process.env.FAKE_RUNNING = 'true'; process.env.FAKE_BOOTED = '1';
      eq([RD.running({ from: '/p/data', image: 'bdslab/redroid:gapps' }), RD.running({ from: '/other/data' }), RD.running({ image: 'x' })], [true, false, false]);
    } finally { process.env.PATH = was.PATH; if (was.ADB === undefined) delete process.env.ADB; else process.env.ADB = was.ADB; }
  });
  await t('redroid lock: one device command at a time; a lock left by a process that is gone is taken over', async () => {
    const RD = await imp('app/redroid/redroid.mjs'), f = path.join(tmp, 'device.lock');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']);
    try {
      fs.writeFileSync(f, JSON.stringify({ pid: child.pid, what: 'debug' }));
      let e = null; try { RD.lock('prep', f); } catch (x) { e = x; }
      ok(e && /debug/.test(e.message) && new RegExp(String(child.pid)).test(e.message), String(e?.message));
    } finally { child.kill(); }
    await new Promise((r) => child.on('exit', r));
    const release = RD.lock('prep', f);
    eq(JSON.parse(fs.readFileSync(f, 'utf8')).pid, process.pid);
    release(); ok(!fs.existsSync(f), 'released');
  });
  await t('redroid doctor: a resident device is said, never a blocker', async () => {
    const RD = await imp('app/redroid/redroid.mjs'), base = { platform: 'linux', docker: true, dockerd: true, binder: true, sudo: true, adb: true, python3: true, image: true, prepared: true };
    const row = (resident) => RD.doctor({ ...base, resident }).find((r) => r.name === '常駐の端末');
    ok(row(true).ok && /redroid down/.test(row(true).detail) && !row(false).ok && row(false).soft, JSON.stringify([row(true), row(false)]));
  });
  await t('app run --device: an unknown device is an error with the choices; --account refused on redroid', () => {
    const r1 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'run', '-a', 'x', '--device', 'foo'], { encoding: 'utf8', cwd: TOP });
    eq(r1.status, 1); ok(/--device foo/.test(r1.stdout) && /redroid/.test(r1.stdout), r1.stdout);
    const r2 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'run', '-a', 'x', '--device', 'redroid', '--account'], { encoding: 'utf8', cwd: TOP });
    eq(r2.status, 1); ok(/--account/.test(r2.stdout), r2.stdout);
    const r3 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'redroid', 'help'], { encoding: 'utf8', cwd: TOP });
    eq(r3.status, 0); ok(/doctor/.test(r3.stdout) && /prep/.test(r3.stdout), r3.stdout);
  });
}
// (APP_TEST_KEEP=1: the run folders stay, to read a failure)
if (!process.env.APP_TEST_KEEP) for (const d of made) fs.rmSync(d, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(path.join(FAKE, '.lab'), { recursive: true, force: true });
console.log(`${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
