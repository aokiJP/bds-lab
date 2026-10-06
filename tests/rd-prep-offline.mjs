#!/usr/bin/env node
// app/redroid prep's quiet start (app/redroid/prepfast.mjs): Google's apps off but never Play / Play services / GSF, the
// background dexopt job and account sync off, the game compiled with speed — the adb commands in their order, recorded by a
// fake adb first on PATH (a sh script; no docker, binder or device), and the pure pieces. Nothing of the emulator's path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const X = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-rdprep-')), bin = path.join(X, 'bin'), log = path.join(X, 'adb.log');
fs.mkdirSync(bin);
// the fake adb: every call's words after `-s <serial>` one line in the log; answers as Android 14's (FAKE_COMPILE=fail: a
// frozen package's answer)
fs.writeFileSync(path.join(bin, 'adb'), `#!/bin/sh
[ "$1" = "-s" ] && shift 2
echo "$*" >> "${log}"
case "$*" in
  "shell pm disable-user --user 0 com.example.gone") echo "Exception occurred while executing 'disable-user':" >&2; echo "java.lang.IllegalArgumentException: Unknown package: com.example.gone" >&2; exit 255 ;;
  "shell pm disable-user --user 0 "*) echo "Package \${6} new state: disabled-user" ;;
  "shell pm bg-dexopt-job --disable") echo "Success" ;;
  "shell settings put global auto_sync 0") ;;
  "shell cmd package compile -m speed -f "*) if [ "$FAKE_COMPILE" = fail ]; then echo "Failure: package is frozen"; exit 1; fi; echo "Success" ;;
  "shell dumpsys package "*) printf 'Dexopt state:\\n  [com.mojang.minecraftpe]\\n    path: /data/app/x/base.apk\\n      x86_64: [status=%s] [reason=cmdline]\\n' "\${FAKE_STATUS:-speed}" ;;
  *) echo "fake adb: $*" >&2; exit 1 ;;
esac
`);
fs.chmodSync(path.join(bin, 'adb'), 0o755);
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
const PF = await import(path.join(REPO, 'app/redroid/prepfast.mjs'));
const { Adb } = await import(path.join(REPO, 'app/lib/android.mjs'));
const adb = new Adb({ bin: 'adb', serial: '127.0.0.1:5600' });
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
const fresh = () => fs.rmSync(log, { force: true });

// ---- pure ----
ok(JSON.stringify(PF.quietable(['a.b', 'com.android.vending', 'com.google.android.gms', 'com.google.android.gsf', 'a.b'])) === '["a.b"]', 'quietable: Play, Play services and GSF taken out whatever the list says; each package once');
ok(PF.disabledAs('Package x new state: disabled-user') === 'off' && PF.disabledAs('java.lang.IllegalArgumentException: Unknown package: x') === 'none' && PF.disabledAs('Error: java.lang.SecurityException') === 'fail', 'disabledAs: off / no such package / failed, from pm\'s answer');
ok(PF.compiledFilter('x86_64: [status=speed] [reason=cmdline]') === 'speed' && PF.compiledFilter('[status=speed-profile] [reason=bg-dexopt]') === 'speed-profile' && PF.compiledFilter('') === null && PF.compiledFilter(undefined) === null, 'compiledFilter: the filter Android reports, else null');
ok(PF.compileLine('com.mojang.minecraftpe').join(' ') === 'cmd package compile -m speed -f com.mojang.minecraftpe', 'compileLine: speed, forced');
ok(/コンパイル（speed）12\.3 秒、状態 speed/.test(PF.compileNote({ ok: true, s: 12.3, filter: 'speed' })) && /できません（Failure: frozen、0\.2 秒）、状態 不明/.test(PF.compileNote({ ok: false, s: 0.2, filter: null, out: 'Failure: frozen' })), 'compileNote: seconds and the state, or why not');

// ---- game.mjs: QUIET never holds what the license check needs; prep uses these pieces ----
const G = await import(path.join(REPO, 'app/redroid/game.mjs'));
ok(Array.isArray(G.QUIET) && !G.QUIET.some((p) => PF.NEVER_OFF.includes(p)) && G.QUIET.includes('com.google.android.setupwizard'), 'QUIET: no Play, Play services or GSF in it', G.QUIET);
const src = fs.readFileSync(path.join(REPO, 'app/redroid/game.mjs'), 'utf8'), prepSrc = src.slice(src.indexOf('export async function prep('), src.indexOf('export async function bench('));
ok(/PF\.quiet\(adb, QUIET\)/.test(prepSrc) && /PF\.compileGame\(adb, PACKAGE\)/.test(prepSrc) && /PF\.compileNote/.test(prepSrc) && /PF\.quietNote/.test(prepSrc) && !/pm', 'disable-user/.test(prepSrc), 'prep: quiet and the compile through prepfast, their results in notices', prepSrc.slice(0, 400));
ok(prepSrc.indexOf('PF.compileGame') > prepSrc.indexOf('L.playInstall') && prepSrc.indexOf('PF.compileGame') < prepSrc.indexOf('launchFresh('), 'prep: compiled after Play\'s install, before the first start');
ok(!/PF\./.test(src.slice(src.indexOf('export async function bench('))), 'bench / debug / launch untouched (nothing of prepfast on every start)');

// ---- the adb commands, in order (fake adb) ----
fresh();
const q = PF.quiet(adb, ['com.google.android.feedback', 'com.android.vending', 'com.example.gone', 'com.google.android.gms', 'com.google.android.setupwizard']);
const want = ['shell pm disable-user --user 0 com.google.android.feedback', 'shell pm disable-user --user 0 com.example.gone', 'shell pm disable-user --user 0 com.google.android.setupwizard', 'shell pm bg-dexopt-job --disable', 'shell settings put global auto_sync 0'];
ok(JSON.stringify(calls()) === JSON.stringify(want), 'quiet: the apps off one by one, then the background dexopt job and account sync — in this order', calls().join('\n'));
ok(!calls().some((c) => /com\.android\.vending|com\.google\.android\.gms|com\.google\.android\.gsf/.test(c)), 'quiet: never a command on Play, Play services or GSF');
ok(JSON.stringify(q.off) === '["com.google.android.feedback","com.google.android.setupwizard"]' && JSON.stringify(q.none) === '["com.example.gone"]' && !q.fail.length, 'quiet: what went off and what the image does not have', JSON.stringify(q));
ok(/止めたアプリ 2 個（無い 1 個: com\.example\.gone）、pm bg-dexopt-job --disable → ok Success、settings put global auto_sync 0 → ok/.test(PF.quietNote(q)), 'quietNote: one line', PF.quietNote(q));
fresh();
let c = PF.compileGame(adb, 'com.mojang.minecraftpe');
ok(JSON.stringify(calls()) === JSON.stringify(['shell cmd package compile -m speed -f com.mojang.minecraftpe', 'shell dumpsys package com.mojang.minecraftpe']), 'compileGame: cmd package compile -m speed -f, then the state read back', calls().join('\n'));
ok(c.ok && c.filter === 'speed' && typeof c.s === 'number' && c.out === 'Success', 'compileGame: ok, timed, the state speed', JSON.stringify(c));
fresh(); process.env.FAKE_COMPILE = 'fail'; process.env.FAKE_STATUS = 'verify';
c = PF.compileGame(adb, 'com.mojang.minecraftpe');
ok(!c.ok && c.filter === 'verify' && /frozen/.test(c.out) && /できません（Failure: package is frozen/.test(PF.compileNote(c)), 'compileGame: a refused compile is said with Android\'s answer (prep tries again at its end)', JSON.stringify(c));
delete process.env.FAKE_COMPILE; delete process.env.FAKE_STATUS;

const chk = spawnSync(process.execPath, ['--check', path.join(REPO, 'app/redroid/game.mjs')], { encoding: 'utf8' });
ok(chk.status === 0, 'node --check app/redroid/game.mjs', chk.stderr);
fs.rmSync(X, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} rd-prep-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
