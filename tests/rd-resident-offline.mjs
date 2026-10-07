#!/usr/bin/env node
// The resident redroid device (app/app.mjs redroidCmd): off GitHub Actions run / ui leave the device up by default
// (--no-keep = stopped after), and `app redroid warm` wakes the device and leaves the game at its title. No binder here:
// docker and adb are fakes (sh scripts first on PATH), so what is checked is the decision and the words, not the device.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).slice(0, 1500)}`); if (!c) fails++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-resident-')), bin = path.join(tmp, 'bin'), data = path.join(tmp, 'data');
fs.mkdirSync(bin, { recursive: true });
const put = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
// docker: `inspect` says what FAKE_RUNNING says (labels: this data folder and the lab's image); the daemon never answers
// (`info` fails: doctor stops a run before game.mjs, whatever this machine has)
put('docker', `echo "docker $*" >> "${tmp}/calls.txt"
case "$1" in --version) echo "Docker version 0";; inspect) echo "$FAKE_RUNNING|${data}|bdslab/redroid:gapps";; *) exit 1;; esac`);
// adb: a booted device; the game's process only once FAKE_GAME is set or after `am start` (a state file)
put('adb', `echo "adb $*" >> "${tmp}/calls.txt"
case "$*" in
  *connect*) echo "connected to 127.0.0.1:5600";;
  *get-state*) echo device;;
  *boot_completed*) echo 1;;
  *pidof*) if [ -n "$FAKE_GAME" ] || [ -f "${tmp}/started" ]; then echo 4242; fi;;
  *resolve-activity*) echo com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity;;
  *"am start"*) touch "${tmp}/started"; echo "Status: ok";;
  *mCurrentFocus*) if [ -f "${tmp}/started" ]; then echo "  mCurrentFocus=Window{abc u0 com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity}"; fi;;
esac`);
const env = (more = {}) => {
  const e = { ...process.env };
  delete e.GITHUB_ACTIONS; delete e.APP_DEVICE; delete e.APP_SERIAL;
  Object.assign(e, { PATH: `${bin}${path.delimiter}${process.env.PATH}`, ADB: path.join(bin, 'adb'), APP_TESSERACT: path.join(tmp, 'no-tesseract'), FAKE_RUNNING: 'false', REDROID_LOCK: LOCK, ...more });
  for (const [k, v] of Object.entries(more)) if (v === undefined) delete e[k];
  return e;
};
const lab = (args, more) => {
  fs.rmSync(path.join(tmp, 'started'), { force: true });
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', ...args], { encoding: 'utf8', cwd: TOP, env: env(more), timeout: 120_000 });
  return { status: r.status, text: `${r.stdout}${r.stderr}` };
};
const KEPT = /redroid の端末: 終わっても動いたままにします/;
// (its own lock file: tests run side by side, and rd-overlap's `game.mjs debug` takes the lab's one)
const LOCK = path.join(tmp, 'device.lock');

// ---- help ----
{
  const r = lab(['redroid', 'help']);
  ok(r.status === 0 && /^\s+warm\b/m.test(r.text) && /--no-keep/.test(r.text) && /常駐/.test(r.text) && !/run -a <アドオン> \[--keep\]/.test(r.text), 'help: warm and --no-keep are said; run / ui no longer offer --keep as the choice', r.text);
}

// ---- run / ui: kept by default off Actions ----
{
  const r = lab(['run', '-a', 'jsonui_demo', '--device', 'redroid']);
  ok(KEPT.test(r.text), 'run --device redroid (not on Actions): the device is kept, said in one line', r.text);
  // (off Linux the first thing doctor says is the kernel: redroid runs on a Linux kernel only)
  ok(r.status === 1 && (process.platform === 'linux' ? /redroid の端末を使えません: docker/ : /redroid の端末を使えません: Linux /).test(r.text), 'run: doctor still stops a machine that lacks docker (after the line)' + (process.platform === 'linux' ? '' : ' (not Linux: stopped for the kernel)'), r.text);
  const u = lab(['redroid', 'ui', '-a', 'jsonui_demo']);
  ok(KEPT.test(u.text), 'app redroid ui (not on Actions): kept by default too', u.text);
  const nk = lab(['run', '-a', 'jsonui_demo', '--device', 'redroid', '--no-keep']);
  ok(!KEPT.test(nk.text) && !/知らない|--no-keep/.test(nk.text.replace(/毎回止める: --no-keep/g, '')), '--no-keep: not kept, and the flag is not handed on to app run', nk.text);
  const both = lab(['run', '-a', 'jsonui_demo', '--device', 'redroid', '--keep', '--no-keep']);
  ok(!KEPT.test(both.text), '--keep with --no-keep: --no-keep wins', both.text);
  const gha = lab(['run', '-a', 'jsonui_demo', '--device', 'redroid'], { GITHUB_ACTIONS: 'true' });
  ok(!KEPT.test(gha.text), 'on GitHub Actions: not kept unless asked (as before)', gha.text);
  const ghk = lab(['run', '-a', 'jsonui_demo', '--device', 'redroid', '--keep'], { GITHUB_ACTIONS: 'true' });
  ok(KEPT.test(ghk.text), 'on GitHub Actions with --keep: kept', ghk.text);
}

// ---- warm ----
const lockBefore = fs.existsSync(LOCK);
{
  const r = lab(['redroid', 'warm', '--data', data], { FAKE_RUNNING: 'true', FAKE_GAME: '1' });
  ok(r.status === 0 && /常駐の端末（warm）: \{"resident":true,"game":"起動済み"/.test(r.text) && /OK 端末は動いたままです/.test(r.text), 'warm on a resident device with the game running: nothing restored, booted or started', r.text);
  const calls = fs.readFileSync(path.join(tmp, 'calls.txt'), 'utf8');
  ok(!/docker (run|rm)/.test(calls) && !/am start/.test(calls), 'warm (resident, game up): no docker run / rm, no am start', calls);
  fs.rmSync(path.join(tmp, 'calls.txt'), { force: true });
}
{
  const r = lab(['redroid', 'warm', '--data', data], { FAKE_RUNNING: 'true' });
  ok(r.status === 0 && /"resident":true,"game":"起動しました"/.test(r.text) && /"windowS":/.test(r.text) && /"totalS":/.test(r.text), 'warm on a resident device without the game: the game started, its times said (windowS without OCR)', r.text);
  const calls = fs.readFileSync(path.join(tmp, 'calls.txt'), 'utf8');
  ok(/am start/.test(calls) && !/docker (run|rm)/.test(calls), 'warm (resident): the game started, the container not touched', calls);
}
{
  const r = lab(['redroid', 'warm', '--data', data], { FAKE_RUNNING: 'false' });
  ok(r.status === 1 && (process.platform === 'linux' ? /redroid の端末を使えません: docker/ : /redroid の端末を使えません: Linux /).test(r.text), 'warm with no device up on a machine without docker: doctor says what is missing', r.text);
}
ok(fs.existsSync(LOCK) === lockBefore, 'warm releases the device lock (also when it fails)');
if (!lockBefore) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
  try {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    fs.writeFileSync(LOCK, JSON.stringify({ pid: child.pid, what: 'debug' }));
    const r = lab(['redroid', 'warm', '--data', data], { FAKE_RUNNING: 'true', FAKE_GAME: '1' });
    ok(r.status === 1 && /別のコマンドが使っています（debug/.test(r.text), 'warm while another device command runs: refused with who holds it', r.text);
    ok(!/ラボの不具合/.test(r.text), 'warm: the held lock is the user\'s situation, not a lab bug', r.text);
  } finally { child.kill(); fs.rmSync(LOCK, { force: true }); }
}
const bad = lab(['redroid', 'warm', '--bogus']);
ok(bad.status === 1 && /知らないオプション --bogus/.test(bad.text), 'warm: an unknown option is an error', bad.text);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${fails ? 'FAIL' : 'PASS'} ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
