#!/usr/bin/env node
// app/redroid/boost.mjs without a device: the plan (pure), and its shell loop run here by a fake adb (sh -c) on a fake /proc
// with a fake ps and renice first on PATH — the game's threads up, Google's (not the license check's) down, new threads taken,
// Play / Play services / GSF left alone, every thread (later ones too) back to its process's base nice at the end, a loop that
// does not stop killed by restore; nothing at all without REDROID_BOOST=1 or without root.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const B = await import(path.join(TOP, 'app/redroid/boost.mjs'));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-boost-'));
let fails = 0;
const ok = (c, m, d = '') => { console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PKG = 'com.mojang.minecraftpe';

// ---- pure ----
ok(B.boostOpts({}) === null && B.boostOpts({ REDROID_BOOST: '0' }) === null, 'boostOpts: off unless REDROID_BOOST=1');
const o = B.boostOpts({ REDROID_BOOST: '1' });
ok(o && o.game === -10 && o.low === 10 && o.everyS === 1 && o.maxS === 300 && JSON.stringify(o.names) === JSON.stringify(B.LOW), 'boostOpts: defaults (game -10, Google 10, LOW)', JSON.stringify(o));
const LICENSE = ['com.android.vending', 'com.google.android.gms', 'com.google.android.gms.persistent', 'com.google.android.gms.unstable', 'com.google.process.gservices'];
ok(B.LOW.includes('com.google.android.gms.ui') && B.LOW.includes('com.google.process.gapps') && LICENSE.every((x) => !B.LOW.includes(x)), 'LOW: gms.ui and gapps only, nothing the license check uses (Play, gms, gms.persistent, gms.unstable, GSF)', JSON.stringify(B.LOW));
const o3 = B.boostOpts({ REDROID_BOOST: '1', REDROID_BOOST_LOW_NAMES: 'com.example.a, com.example.b' });
ok(JSON.stringify(o3.names) === '["com.example.a","com.example.b"]' && JSON.stringify(B.boostOpts({ REDROID_BOOST: '1', REDROID_BOOST_LOW_NAMES: '' }).names) === JSON.stringify(B.LOW), 'boostOpts: REDROID_BOOST_LOW_NAMES overrides LOW (empty = LOW)', JSON.stringify(o3.names));
const p3 = B.boostPlan({ names: o3.names });
ok(p3.start[1].includes('com.example.a|com.example.a:*|com.example.b|com.example.b:*) v=10') && !/gapps/.test(p3.start[1]), 'boostPlan: the names from REDROID_BOOST_LOW_NAMES are the ones put down');
const o2 = B.boostOpts({ REDROID_BOOST: '1', REDROID_BOOST_GAME: '-5', REDROID_BOOST_LOW: '19', REDROID_BOOST_EVERY_S: '0.5', REDROID_BOOST_MAX_S: 'x' });
ok(o2.game === -5 && o2.low === 19 && o2.everyS === 0.5 && o2.maxS === 300, 'boostOpts: knobs from the environment, junk ignored', JSON.stringify(o2));
const p = B.boostPlan();
ok(p.start[0] === 'shell' && p.stop[0] === 'shell' && p.restore[0] === 'shell' && p.start.length === 2 && /touch \/data\/local\/tmp\/lab-boost\.stop/.test(p.stop[1]), 'boostPlan: start / stop / restore as adb arguments', JSON.stringify(p.stop));
ok(p.start[1].includes(`${PKG}|${PKG}:*) v=-10`) && p.start[1].includes('com.google.android.gms.ui|com.google.android.gms.ui:*|com.google.process.gapps|com.google.process.gapps:*) v=10') && !/vending|gms\.persistent|gms\.unstable|gservices|gms\|/.test(p.start[1]), 'boostPlan: the game up, gms.ui / gapps down, Play / Play services / GSF not touched');
ok(/echo \$\$ > \$S\.pid/.test(p.start[1]) && /kill -9 \$k/.test(p.restore[1]) && p.restore[1].indexOf('kill -9') < p.restore[1].indexOf('setn ${'.slice(0, 5)), 'boostPlan: the loop writes its pid; restore kills it before it puts anything back');
ok(JSON.stringify(B.boostPlan()) === JSON.stringify(p), 'boostPlan: the same plan for the same input (pure)');
const throws = (f) => { try { f(); return false; } catch { return true; } };
ok(throws(() => B.boostPlan({ pkg: 'a;rm -rf /' })) && throws(() => B.boostPlan({ names: ['x y'] })) && throws(() => B.boostPlan({ game: -21 })) && throws(() => B.boostPlan({ low: 1.5 })) && throws(() => B.boostPlan({ everyS: 0 })), 'boostPlan: refuses names that are not plain words and nice out of -20..19');
for (const [k, s] of [['start', p.start[1]], ['restore', p.restore[1]]]) { const r = spawnSync('sh', ['-n', '-c', s], { encoding: 'utf8' }); ok(r.status === 0, `boostPlan: the ${k} script is valid sh`, r.stderr); }
const c = B.boostCounts('boost game=3 low=2\nboost restored=5\n');
ok(c.game === 3 && c.low === 2 && c.restored === 5 && B.boostCounts('').game === null, 'boostCounts: the loop\'s numbers', JSON.stringify(c));

// ---- the loop on a fake device ----
const bin = path.join(T, 'bin'), proc = path.join(T, 'proc'), dir = path.join(T, 'tmp'), log = path.join(T, 'adb.log');
for (const d of [bin, proc, dir]) fs.mkdirSync(d, { recursive: true });
const ps = path.join(T, 'ps.txt');
const exe = (f, s) => { fs.writeFileSync(path.join(bin, f), s); fs.chmodSync(path.join(bin, f), 0o755); };
// adb: -s <serial> dropped; `shell <words>` run here; FAKE_UID answers id -u
exe('adb', `#!/bin/sh\n[ "$1" = -s ] && shift 2\necho "$*" | head -c 60 >> ${log}; echo >> ${log}\n[ "$1" = shell ] || exit 0\nshift\n[ "$*" = "id -u" ] && { echo "\${FAKE_UID:-0}"; exit 0; }\nexec sh -c "$*"\n`);
exe('ps', `#!/bin/sh\necho "PID NAME"\ncat ${ps}\n`);
// renice -n <delta> -p <tid>: field 19 of that thread's stat (any process's task/<tid>)
exe('renice', `#!${process.execPath}\nconst fs = require('fs'), path = require('path');\nconst a = process.argv.slice(2), d = Number(a[a.indexOf('-n') + 1]), t = a[a.indexOf('-p') + 1];\nfs.appendFileSync(${JSON.stringify(path.join(T, 'renice.log'))}, t + ' ' + d + '\\n');\nfor (const p of fs.readdirSync(${JSON.stringify(proc)})) { const f = path.join(${JSON.stringify(proc)}, p, 'task', t, 'stat'); if (!fs.existsSync(f)) continue;\n  const s = fs.readFileSync(f, 'utf8'), i = s.lastIndexOf(') '), w = s.slice(i + 2).trim().split(' '); w[16] = String(Number(w[16]) + d); fs.writeFileSync(f, s.slice(0, i + 2) + w.join(' ') + '\\n'); process.exit(0); }\nprocess.exit(1);\n`);
const procs = {};
const thread = (pid, tid, nice, comm = 'thread') => { const d = path.join(proc, String(pid), 'task', String(tid)); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'stat'), `${tid} (${comm}) S ${Array(15).fill(0).join(' ')} ${nice} 20 0\n`);
  // (/proc/<pid>/stat is the main thread's, as on the device)
  const m = path.join(proc, String(pid), 'stat'); if (pid === tid && !fs.existsSync(m)) fs.symlinkSync(path.join('task', String(tid), 'stat'), m); };
const proc0 = (pid, name, threads) => { procs[pid] = name; threads.forEach(([t, n, cm]) => thread(pid, t, n, cm)); fs.writeFileSync(ps, Object.entries(procs).map(([k, v]) => `${k} ${v}`).join('\n') + '\n'); };
const niceOf = (pid, tid) => { const s = fs.readFileSync(path.join(proc, String(pid), 'task', String(tid), 'stat'), 'utf8'); return Number(s.slice(s.lastIndexOf(') ') + 2).trim().split(' ')[16]); };
proc0(100, PKG, [[100, 0, 'minecraftpe'], [101, 0, 'Thread 1 (x)']]);
proc0(200, 'com.google.android.gms.ui', [[200, 0], [201, 5]]);
proc0(300, 'com.android.vending', [[300, 0]]);
proc0(310, 'com.google.android.gms.persistent', [[310, 0]]);
proc0(320, 'com.google.android.gms', [[320, 0]]);
proc0(330, 'com.google.process.gservices', [[330, 0]]);
proc0(400, 'com.android.systemui', [[400, 0]]);
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, REDROID_BOOST: '1', REDROID_BOOST_EVERY_S: '0.2' };
const { Adb } = await import(path.join(TOP, 'app/lib/android.mjs'));
const adb = new Adb({ bin: path.join(bin, 'adb'), serial: '127.0.0.1:5600' });
process.env.PATH = env.PATH;   // (spawnSync of adb.run and the spawned loop find the fake ps / renice through it)

fs.writeFileSync(log, '');
ok(B.startBoost(adb, { env: { REDROID_BOOST: '0' }, dir, proc }) === null && fs.readFileSync(log, 'utf8') === '', 'without REDROID_BOOST=1: nothing, not one adb command');
process.env.FAKE_UID = '2000';
ok(B.startBoost(adb, { env, dir, proc }) === null && !/^shell S=/m.test(fs.readFileSync(log, 'utf8')), 'adbd not root: not started (only id -u asked)');
delete process.env.FAKE_UID;

const b = B.startBoost(adb, { env, dir, proc });
ok(b && b.child, 'REDROID_BOOST=1 and root: the loop started on the device');
await sleep(800);
ok(niceOf(100, 100) === -10 && niceOf(100, 101) === -10, 'the game\'s threads at nice -10 (a thread name with spaces and parentheses read right)', `${niceOf(100, 100)} ${niceOf(100, 101)}`);
ok(niceOf(200, 200) === 10 && niceOf(200, 201) === 10, 'gms.ui\'s threads at nice 10', `${niceOf(200, 200)} ${niceOf(200, 201)}`);
ok([300, 310, 320, 330, 400].every((x) => niceOf(x, x) === 0), 'Play Store, Play services (gms, gms.persistent), GSF and the rest left alone');
// a new thread of the game, the game's second process, and a thread that ends before the stop
thread(100, 102, 0);
proc0(500, `${PKG}:sub`, [[500, 2]]);
await sleep(800);
ok(niceOf(100, 102) === -10 && niceOf(500, 500) === -10, 'threads and processes that come later are taken too', `${niceOf(100, 102)} ${niceOf(500, 500)}`);
// threads made after the raise inherit it (the game's -10, gms.ui's 10): their first nice is not the one to go back to
thread(100, 103, -10); thread(200, 202, 10);
await sleep(800);
const before = fs.readFileSync(path.join(T, 'renice.log'), 'utf8').split('\n').filter(Boolean).length;
await sleep(600);
ok(fs.readFileSync(path.join(T, 'renice.log'), 'utf8').split('\n').filter(Boolean).length === before, 'a thread once seen is not reniced again (the loop stays light)');
fs.rmSync(path.join(proc, '100', 'task', '101'), { recursive: true });
const res = await B.stopBoost(adb, b);
const back = ['100/100', '100/102', '100/103', '500/500', '200/200', '200/201', '200/202'];
ok(niceOf(100, 100) === 0 && niceOf(100, 102) === 0 && niceOf(100, 103) === 0 && niceOf(500, 500) === 2 && niceOf(200, 200) === 0 && niceOf(200, 201) === 0 && niceOf(200, 202) === 0, 'stopped: every thread (later ones too) back to its process\'s base nice (the main thread\'s before the boost)', back.map((k) => `${k}=${niceOf(...k.split('/'))}`).join(' '));
ok(res && res.game === 5 && res.low === 3 && res.restored === 7 && typeof res.s === 'number', 'stopBoost: what it did (game 5, Google 3, back 7: the ended thread not counted)', JSON.stringify(res));
ok(['saved', 'stop', 'pid'].every((x) => !fs.existsSync(path.join(dir, `lab-boost.${x}`))), 'nothing left in the device\'s tmp');

// the loop does not answer (its adb lost): killed, and the restore command puts the saved nices back
// the device's loop lives on (the stop file not seen): restore kills it first, then puts every thread back
const plan = B.boostPlan({ dir, proc, names: B.LOW, everyS: 0.2 });
const loop = spawn('sh', ['-c', plan.start[1]], { stdio: 'ignore' });
const loopEnd = new Promise((r) => loop.on('close', r));
await sleep(800);
ok(niceOf(100, 100) === -10 && niceOf(200, 201) === 10 && fs.readFileSync(path.join(dir, 'lab-boost.pid'), 'utf8').trim() === String(loop.pid), 'a device loop up again: its pid in lab-boost.pid', `${niceOf(100, 100)} ${niceOf(200, 201)}`);
const child = spawn('sleep', ['60']);
const stuck = { plan: { ...plan, stop: ['shell', 'true'] }, opts: o, child, out: '', t0: performance.now(), done: new Promise((r) => child.on('close', r)) };
const r2 = await B.stopBoost(adb, stuck, { timeoutMs: 500 });
// (restore checks the loop's pid through /proc/<pid>/cmdline, as the Android device has; a host without /proc (macOS) cannot show it: the loop is killed here instead)
const hostProc = fs.existsSync('/proc/self/cmdline');
if (!hostProc) { console.log('SKIP the device loop killed by restore: this host has no /proc (Linux only)'); loop.kill('SIGKILL'); }
const gone = await Promise.race([loopEnd.then(() => true), sleep(3000).then(() => false)]);
thread(100, 104, 0); thread(200, 203, 0);
await sleep(800);
ok(child.killed && gone && niceOf(100, 104) === 0 && niceOf(200, 203) === 0, 'a stuck loop: the local adb and the device\'s loop killed (a thread made after restore not reniced)', `gone=${gone} ${niceOf(100, 104)} ${niceOf(200, 203)}`);
ok(back.every((k) => niceOf(...k.split('/')) === (k === '500/500' ? 2 : 0)) && r2.restored === 7, 'a stuck loop: every thread put back by restore', JSON.stringify(r2) + ' ' + back.map((k) => `${k}=${niceOf(...k.split('/'))}`).join(' '));
const again = [adb.run(plan.restore, { timeout: 30_000 }).stdout, adb.run(plan.restore, { timeout: 30_000 }).stdout];
ok(again.every((x) => B.boostCounts(x).restored === 0) && back.every((k) => niceOf(...k.split('/')) === (k === '500/500' ? 2 : 0)) && ['saved', 'stop', 'pid'].every((x) => !fs.existsSync(path.join(dir, `lab-boost.${x}`))), 'restore again and again: safe (nothing to do, nothing changed, nothing left)', again.join(' | '));
ok((await B.stopBoost(adb, null)) === null, 'stopBoost(null): nothing (boost was off)');

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} rd-boost-offline`);
process.exit(fails ? 1 : 0);
