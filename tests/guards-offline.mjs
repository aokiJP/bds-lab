#!/usr/bin/env node
// Two guards of v1.24.0, no network:
//  1. node lab.mjs share: a test that fails in the release's own check leaves its whole output in <zip>.verify.log (a secret line
//     is ***); all passed: no .verify.log (an earlier one is removed)
//  2. node lab.mjs app run --device <name>: a person's device never reads APP_DEVICE_READY_FILE (that is redroid's: no waiting,
//     no "端末の準備を待っています")
// node tests/guards-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, m, d = '') => { console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guards-offline-'));
const w = (root, r, s) => { const f = path.join(root, r); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// ---- 1. share: .verify.log ----
const X = path.join(tmp, 'lab'), SECRET = 'sk-ant-api03-' + 'Q'.repeat(40);
w(X, 'lab.mjs', "console.log('topics: a b')\n");
w(X, 'common/data/samples.json', JSON.stringify({ bds: [], end: [], ll: [] }));
w(X, 'tests/docs-offline.mjs', "console.log('✔ fine');\n");
const share = (args) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'share', ...args], { cwd: TOP, encoding: 'utf8', timeout: 110_000, env: { ...process.env, LAB_SHARE_ROOT: X, LAB_DOTENV: 'off', LAB_NETENV: 'off' } }); return { status: r.status, t: (r.stdout ?? '') + (r.stderr ?? '') }; };
const zip = path.join(X, 'dist', 'bds-lab-v1.0.0.zip'), vlog = zip + '.verify.log';
// a stale log from an earlier round, and a test that fails with a long output (one line looks like a key; the zip file itself is not one)
fs.mkdirSync(path.dirname(vlog), { recursive: true }); fs.writeFileSync(vlog, 'old\n');
w(X, 'tests/docs-offline.mjs', `console.log('first line');\nfor (let i = 0; i < 30; i++) console.log('detail ' + i);\nconsole.log('key ' + 'sk-ant-api03-' + 'Q'.repeat(40));\nconsole.log('✘ the broken check');\nprocess.exit(1);\n`);
let r = share([]);
const L = fs.existsSync(vlog) ? fs.readFileSync(vlog, 'utf8') : '';
ok(r.status !== 0 && fs.existsSync(vlog) && r.t.includes(vlog) && /FAIL share: the release does not work alone/.test(r.t), 'a failing test: .verify.log next to the zip, its path said, the share fails', r.t);
ok(/tests\/docs-offline\.mjs/.test(L) && /first line/.test(L) && /detail 29/.test(L) && /the broken check/.test(L) && !/^old/.test(L), 'the whole output of the failed test is in it (past what the one-line summary shows)', L);
ok(!L.includes(SECRET) && !r.t.includes(SECRET) && /\*\*\*/.test(L), 'a line the secret scan hits is ***, the key is nowhere', L);
// all passed: none, and the stale one goes
w(X, 'tests/docs-offline.mjs', "console.log('✔ fine');\n");
fs.writeFileSync(vlog, 'stale\n');
r = share(['--bump', 'none']);
const z2 = path.join(X, 'dist', 'bds-lab-v1.0.0.zip');
ok(r.status === 0 && fs.existsSync(z2) && !fs.existsSync(z2 + '.verify.log'), 'nothing failed: no .verify.log (an earlier one is removed)', r.t);

// ---- 2. app run --device <name>: APP_DEVICE_READY_FILE is not read ----
const FAKE = path.join(TOP, 'tests', 'fake', 'app');
fs.chmodSync(path.join(FAKE, 'adb'), 0o755);
const state = path.join(tmp, 'state.json'), labDir = path.join(tmp, 'devlab'), readyFile = path.join(tmp, 'never-made.ready');
fs.writeFileSync(state, JSON.stringify({ phase: 'home' }));
const phone = { serial: 'R58M123ABC', model: 'Pixel_7', maker: 'Google', android: '14', sdk: 34, abi: 'arm64-v8a', hw: 'R58M123ABC', root: null, game: true, addrs: '1: lo    inet 127.0.0.1/8 scope host lo\n3: wlan0    inet 192.168.1.23/24 brd 192.168.1.255 scope global wlan0', settings: { stay_on_while_plugged_in: '0', screen_off_timeout: '60000', zen_mode: '0' } };
const stub = path.join(tmp, 'stub'); fs.writeFileSync(stub, 'stub');
const env = { ...process.env, FAKE_APP_STATE: state, APP_ADB: path.join(FAKE, 'adb'), APP_DEVICES_DIR: labDir, APP_HOST_IFACES: JSON.stringify([{ iface: 'wlp2s0', ip: '192.168.1.10', prefix: 24 }]), FAKE_DEVICES: JSON.stringify([phone]), APP_DEVICE_WAIT_MS: '300',
  APP_BDS_LAB: path.join(FAKE, 'bdslab.mjs'), APP_TIME_SCALE: '0.2', APP_STABLE_MS: '100', APP_PAD_WAIT_MS: '50', APP_TESSERACT: path.join(tmp, 'no-tesseract'), APP_RELAY_BIN: stub, APP_PAD_BIN: stub, APP_UNLOCK_MS: '3000' };
delete env.GITHUB_ACTIONS; delete env.LAB_ASK_FILE; delete env.APP_DEVICE;
const app = (args, extra = {}, timeout = 90_000) => { const q = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', ...args], { cwd: TOP, encoding: 'utf8', timeout, env: { ...env, ...extra } }); return { status: q.status, text: (q.stdout ?? '') + (q.stderr ?? '') }; };
ok(app(['device', 'add', 'phone', '--serial', 'R58M123ABC']).status === 0, 'the fake phone is added');
const t0 = Date.now();
r = app(['run', '-a', 'jsonui_demo', '--device', 'phone', '-v'], { APP_DEVICE_READY_FILE: readyFile, APP_DEVICE_READY_MS: '60000' });
const runDir = /→ (app\/runs\/\S+)/.exec(r.text)?.[1];
ok(r.status === 0 && /PASS app\/runs\//.test(r.text) && !/端末の準備を待っています|端末の準備/.test(r.text) && !fs.existsSync(readyFile) && Date.now() - t0 < 50_000, 'run --device with APP_DEVICE_READY_FILE (never made): does not wait, does not say so, passes', r.text);
// the contrast is rd-overlap-offline's: without --device, that file is waited for
if (runDir) fs.rmSync(path.join(TOP, runDir), { recursive: true, force: true });
fs.rmSync(path.join(TOP, 'app', '.lab', 'run.lock'), { force: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
