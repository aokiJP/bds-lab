#!/usr/bin/env node
// app/redroid/boost.mjs without a device: the plan (pure), and its shell loop run here by a fake adb (sh -c) on a fake /proc
// with a fake ps and renice first on PATH — the game's threads up, Google's down, new threads taken, Play left alone, every
// thread back to its own nice at the end; nothing at all without REDROID_BOOST=1 or without root.
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
ok(o && o.game === -10 && o.low === 10 && o.everyS === 1 && o.maxS === 300, 'boostOpts: defaults (game -10, Google 10)', JSON.stringify(o));
const o2 = B.boostOpts({ REDROID_BOOST: '1', REDROID_BOOST_GAME: '-5', REDROID_BOOST_LOW: '19', REDROID_BOOST_EVERY_S: '0.5', REDROID_BOOST_MAX_S: 'x' });
ok(o2.game === -5 && o2.low === 19 && o2.everyS === 0.5 && o2.maxS === 300, 'boostOpts: knobs from the environment, junk ignored', JSON.stringify(o2));
const p = B.boostPlan();
ok(p.start[0] === 'shell' && p.stop[0] === 'shell' && p.restore[0] === 'shell' && p.start.length === 2 && /touch \/data\/local\/tmp\/lab-boost\.stop/.test(p.stop[1]), 'boostPlan: start / stop / restore as adb arguments', JSON.stringify(p.stop));
ok(p.start[1].includes(`${PKG}|${PKG}:*) v=-10`) && /com\.google\.android\.gms\.persistent\|com\.google\.android\.gms\.persistent:\*/.test(p.start[1]) && !/vending/.test(p.start[1]), 'boostPlan: the game up, Play services down, Play Store not touched');
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
const thread = (pid, tid, nice, comm = 'thread') => { const d = path.join(proc, String(pid), 'task', String(tid)); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'stat'), `${tid} (${comm}) S ${Array(15).fill(0).join(' ')} ${nice} 20 0\n`); };
const proc0 = (pid, name, threads) => { procs[pid] = name; threads.forEach(([t, n, cm]) => thread(pid, t, n, cm)); fs.writeFileSync(ps, Object.entries(procs).map(([k, v]) => `${k} ${v}`).join('\n') + '\n'); };
const niceOf = (pid, tid) => { const s = fs.readFileSync(path.join(proc, String(pid), 'task', String(tid), 'stat'), 'utf8'); return Number(s.slice(s.lastIndexOf(') ') + 2).trim().split(' ')[16]); };
proc0(100, PKG, [[100, 0, 'minecraftpe'], [101, 0, 'Thread 1 (x)']]);
proc0(200, 'com.google.android.gms.persistent', [[200, 0], [201, 5]]);
proc0(300, 'com.android.vending', [[300, 0]]);
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
ok(niceOf(200, 200) === 10 && niceOf(200, 201) === 10, 'Play services\' threads at nice 10', `${niceOf(200, 200)} ${niceOf(200, 201)}`);
ok(niceOf(300, 300) === 0 && niceOf(400, 400) === 0, 'Play Store and the rest left alone');
// a new thread of the game, the game's second process, and a thread that ends before the stop
thread(100, 102, 0);
proc0(500, `${PKG}:sub`, [[500, 2]]);
await sleep(800);
ok(niceOf(100, 102) === -10 && niceOf(500, 500) === -10, 'threads and processes that come later are taken too', `${niceOf(100, 102)} ${niceOf(500, 500)}`);
const before = fs.readFileSync(path.join(T, 'renice.log'), 'utf8').split('\n').filter(Boolean).length;
await sleep(600);
ok(fs.readFileSync(path.join(T, 'renice.log'), 'utf8').split('\n').filter(Boolean).length === before, 'a thread once seen is not reniced again (the loop stays light)');
fs.rmSync(path.join(proc, '100', 'task', '101'), { recursive: true });
const res = await B.stopBoost(adb, b);
ok(niceOf(100, 100) === 0 && niceOf(100, 102) === 0 && niceOf(500, 500) === 2 && niceOf(200, 200) === 0 && niceOf(200, 201) === 5, 'stopped: every thread back to its own nice', ['100/100', '100/102', '500/500', '200/200', '200/201'].map((k) => `${k}=${niceOf(...k.split('/'))}`).join(' '));
ok(res && res.game === 4 && res.low === 2 && res.restored === 5 && typeof res.s === 'number', 'stopBoost: what it did (game 4, Google 2, back 5: the ended thread not counted)', JSON.stringify(res));
ok(!fs.existsSync(path.join(dir, 'lab-boost.saved')) && !fs.existsSync(path.join(dir, 'lab-boost.stop')), 'nothing left in the device\'s tmp');

// the loop does not answer (its adb lost): killed, and the restore command puts the saved nices back
const plan = B.boostPlan({ dir, proc });
fs.writeFileSync(path.join(dir, 'lab-boost.saved'), '200 201 5\n100 100 0\n');
thread(200, 201, 10); thread(100, 100, -10);
const child = spawn('sleep', ['60']);
const stuck = { plan, opts: o, child, out: '', t0: performance.now(), done: new Promise((r) => child.on('close', r)) };
const r2 = await B.stopBoost(adb, stuck, { timeoutMs: 500 });
ok(child.killed && niceOf(200, 201) === 5 && niceOf(100, 100) === 0 && r2.restored === 2, 'a stuck loop: killed, the nices put back by restore', JSON.stringify(r2));
ok((await B.stopBoost(adb, null)) === null, 'stopBoost(null): nothing (boost was off)');

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} rd-boost-offline`);
process.exit(fails ? 1 : 0);
