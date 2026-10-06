// The game first while it starts (REDROID_BOOST=1 only): from just before `am start` until its title, every thread of the
// game's processes at a higher priority (nice -10) and Google's background work the license check does not use (LOW) at a
// lower one (nice 10), then every thread of those processes back to its process's own nice. Only the redroid device
// (game.mjs); the emulator's path never.
// How: one shell loop on the device (as root: another app's priority needs it) that every REDROID_BOOST_EVERY_S seconds
// lists the processes (one `ps`), renices only the threads it has not seen yet (new threads, a new process: the game's splash
// and its main process are two). Before it first touches a process it writes that process's base nice down once (its main
// thread's, /proc/$p/stat): a thread made later inherits the raised nice, so a thread's own first nice is not the one to go
// back to. A stop file (or its own deadline) ends it and it puts every thread of each process back to that base. Its pid is
// in lab-boost.pid: restore (alone, any number of times: at the end and on Ctrl+C) kills a loop still running first.
// Its numbers come out in one line (R.notice「起動の優先」): what it did, never whether it helped (要実測).
// Play Store (com.android.vending), Play services (com.google.android.gms, .persistent, .unstable) and GSF
// (com.google.process.gservices) are left as they are: the game's license check (PairIP) goes through Play to them.
import { spawn } from 'node:child_process';
import * as R from './redroid.mjs';
import { PACKAGE, cleanEnv } from '../lib/apk.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const secs = (ms) => Math.round(ms / 100) / 10;

/** the processes put back while the game starts (their `name:sub` processes too): only those the license check does not use
 *  (REDROID_BOOST_LOW_NAMES=a,b overrides) */
export const LOW = ['com.google.android.gms.ui', 'com.google.process.gapps'];

/** REDROID_BOOST=1 → the knobs; else null (pure) */
export function boostOpts(env = process.env) {
  if (env.REDROID_BOOST !== '1') return null;
  const n = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  const names = String(env.REDROID_BOOST_LOW_NAMES ?? '').split(/[\s,]+/).filter(Boolean);
  return { game: n(env.REDROID_BOOST_GAME, -10), low: n(env.REDROID_BOOST_LOW, 10), names: names.length ? names : LOW, everyS: n(env.REDROID_BOOST_EVERY_S, 1), maxS: n(env.REDROID_BOOST_MAX_S, 300) };
}

/** the device's commands → {start, stop, restore}, each the arguments after `adb -s <serial>` (pure: tests/rd-boost-offline.mjs).
 *  start runs until stop (or maxS) and then restores; restore alone (a start whose adb was lost, the end, Ctrl+C) kills a loop
 *  still running and puts everything back, as often as it is called.
 *  dir/proc are the device's /data/local/tmp and /proc (another only in the test) */
export function boostPlan({ pkg = PACKAGE, game = -10, low = 10, names = LOW, everyS = 1, maxS = 300, dir = '/data/local/tmp', proc = '/proc' } = {}) {
  const word = /^[\w.:/-]+$/;
  for (const w of [pkg, ...names, dir, proc]) if (!word.test(w)) throw new Error(`起動の優先: 使えない名前です（${w}）`);
  for (const [k, v] of Object.entries({ game, low })) if (!Number.isInteger(v) || v < -20 || v > 19) throw new Error(`起動の優先: ${k} の nice は -20〜19 の整数です（${v}）`);
  if (!names.length) throw new Error('起動の優先: 下げるプロセスの名前がありません');
  if (!(everyS > 0) || !(maxS > 0)) throw new Error('起動の優先: everyS と maxS は正の数です');
  const S = `${dir}/lab-boost`;
  // (a thread's nice is field 19 of its stat: after "(comm) " it is the 17th; toybox renice -n is relative)
  const fns = [
    `S=${S}`,
    `nice_of() { sed 's/.*) //' "$1" 2>/dev/null | cut -d' ' -f17; }`,
    `setn() { c=$(nice_of "$1"); [ -n "$c" ] || return 1; [ "$c" = "$3" ] && return 0; renice -n $(($3 - c)) -p "$2" >/dev/null 2>&1; }`,
  ];
  // restore: a loop still running (not this shell; its pid checked to be that loop's sh: a pid can be reused) killed first, then
  // every thread of each saved process to that process's base; safe again and again (nothing saved → nothing done)
  const restore = [
    `k=$(cat $S.pid 2>/dev/null); if [ -n "$k" ] && [ "$k" != "$$" ] && grep -q lab-boost /proc/$k/cmdline 2>/dev/null; then kill -9 $k 2>/dev/null; i=0; while [ -d /proc/$k ] && [ $i -lt 20 ]; do sleep 0.1; i=$((i + 1)); done; fi`,
    `r=0; if [ -f $S.saved ]; then while read p base; do [ -d ${proc}/$p/task ] || continue; for t in ${proc}/$p/task/*; do t=\${t##*/}; setn ${proc}/$p/task/$t/stat $t $base && r=$((r + 1)); done; done < $S.saved; fi`,
    `echo "boost restored=$r"; rm -f $S.saved $S.stop $S.pid`,
  ];
  const lowCase = names.flatMap((x) => [x, `${x}:*`]).join('|');
  const start = [
    ...fns,
    `rm -f $S.stop; : > $S.saved; echo $$ > $S.pid; seen=' '; seenp=' '; ng=0; nl=0; end=$(($(date +%s) + ${Math.ceil(maxS)}))`,
    `while [ ! -e $S.stop ] && [ $(date +%s) -lt $end ]; do`,
    `  set -- $(ps -A -o PID,NAME 2>/dev/null)`,
    `  while [ $# -ge 2 ]; do p=$1; n=$2; shift 2`,
    `    case $n in ${pkg}|${pkg}:*) v=${game}; k=g;; ${lowCase}) v=${low}; k=l;; *) continue;; esac`,
    `    case $seenp in *" $p "*) ;; *) b=$(nice_of ${proc}/$p/stat); [ -n "$b" ] || continue; seenp="$seenp$p "; echo "$p $b" >> $S.saved;; esac`,
    `    for t in ${proc}/$p/task/*; do t=\${t##*/}`,
    `      case $seen in *" $t "*) continue;; esac`,
    `      seen="$seen$t "`,
    `      if setn ${proc}/$p/task/$t/stat $t $v; then if [ $k = g ]; then ng=$((ng + 1)); else nl=$((nl + 1)); fi; fi`,
    `    done`,
    `  done`,
    `  sleep ${everyS}`,
    `done`,
    `echo "boost game=$ng low=$nl"`,
    ...restore,
  ].join('\n');
  return { start: ['shell', start], stop: ['shell', `touch ${S}.stop`], restore: ['shell', [...fns, ...restore].join('\n')] };
}

/** the loop's lines → {game, low, restored} thread counts (pure) */
export function boostCounts(out) {
  const v = (k) => { const m = new RegExp(`\\b${k}=(\\d+)`).exec(out ?? ''); return m ? Number(m[1]) : null; };
  return { game: v('game'), low: v('low'), restored: v('restored') };
}

/** starts the loop on the device (before `am start`) → a handle for stopBoost, or null (REDROID_BOOST not 1, adbd not root) */
export function startBoost(adb, { pkg = PACKAGE, env = process.env, ...more } = {}) {
  const o = boostOpts(env);
  if (!o) return null;
  if (adb.shell(['id', '-u'], { timeout: 10_000 }).stdout.trim() !== '0') { R.notice('起動の優先', 'しません: adb が root ではありません（他のアプリの優先度は root でしか変えられません）'); return null; }
  const plan = boostPlan({ pkg, ...o, ...more });
  const child = spawn(adb.bin, ['-s', adb.serial, ...plan.start], { stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv() });
  const b = { plan, opts: o, child, out: '', t0: now() };
  child.stdout.on('data', (d) => { b.out += d; });
  child.stderr.on('data', (d) => { b.out += d; });
  b.done = new Promise((r) => { child.on('close', r); child.on('error', r); });
  return b;
}

/** ends it (at the title, or when the start gave up): the stop file, the loop puts every thread back → {game, low, restored, s} */
export async function stopBoost(adb, b, { timeoutMs = 20_000 } = {}) {
  if (!b) return null;
  adb.run(b.plan.stop, { timeout: 15_000 });
  const ended = await Promise.race([b.done.then(() => true), sleep(timeoutMs).then(() => false)]);
  let out = b.out;
  // (the loop did not answer: its adb is gone or stuck → the saved nices put back by a command of their own)
  if (!ended) { b.child.kill('SIGKILL'); out += adb.run(b.plan.restore, { timeout: 30_000 }).stdout; }
  const res = { ...boostCounts(out), s: secs(now() - b.t0) };
  R.notice('起動の優先', `ゲーム ${res.game ?? '?'} スレッドを nice ${b.opts.game}、Google ${res.low ?? '?'} スレッドを nice ${b.opts.low}、${res.s} 秒、戻した ${res.restored ?? '?'} スレッド${ended ? '' : '（ループが止まらず、別に戻しました）'}`);
  return res;
}
