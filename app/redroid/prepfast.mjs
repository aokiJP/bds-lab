// prep's own work for a faster start from the prepared /data: what takes the 2 cores right after a boot kept quiet (Google's
// apps off, the background dexopt job off, account sync off) and the game compiled ahead (speed: no JIT, no profile-guided
// compile later). Everything here lands in /data, so every restore of it starts that way. Used by game.mjs's prep only.
const now = () => performance.now();
const secs = (ms) => Math.round(ms / 100) / 10;

// never off: the game's license check (PairIP) goes through Play, Play services and GSF
export const NEVER_OFF = ['com.android.vending', 'com.google.android.gms', 'com.google.android.gsf'];
/** the packages to disable, with Play / Play services / GSF taken out whatever the list says (pure) */
export const quietable = (pkgs) => [...new Set(pkgs)].filter((p) => !NEVER_OFF.includes(p));
// (what runs in the background after a boot and is not a package: the background dexopt job — ART recompiles apps while
// the device is "idle", and a device just booted in a container looks idle —, and account sync, which app/lib's
// quietDevice turns off on the emulator too. Whether `bg-dexopt-job --disable` outlives a reboot is to be measured)
export const QUIET_LINES = [
  ['pm', 'bg-dexopt-job', '--disable'],
  ['settings', 'put', 'global', 'auto_sync', '0'],
];
/** pm disable-user's answer → 'off' | 'none' (no such package on this image) | 'fail' (pure) */
export function disabledAs(out) {
  if (/new state:\s*disabled/i.test(out)) return 'off';
  if (/unknown package|not installed|does not exist|doesn't exist/i.test(out)) return 'none';
  return 'fail';
}
/** the packages off and the background work stopped, on the device → {off, none, fail, lines: ["<command> → <answer>"]} */
export function quiet(adb, pkgs) {
  const res = { off: [], none: [], fail: [], lines: [] };
  for (const p of quietable(pkgs)) {
    const r = adb.shell(['pm', 'disable-user', '--user', '0', p], { timeout: 30_000 });
    res[disabledAs(`${r.stdout}\n${r.stderr}`)].push(p);
  }
  for (const w of QUIET_LINES) {
    const r = adb.shell(w, { timeout: 30_000 });
    res.lines.push(`${w.join(' ')} → ${r.status === 0 ? 'ok' : 'NG'}${`${r.stdout}${r.stderr}`.trim() ? ` ${`${r.stdout}${r.stderr}`.trim().split('\n').pop().slice(0, 80)}` : ''}`);
  }
  return res;
}
/** quiet()'s result as one line for a notice (pure) */
export const quietNote = (q) => `止めたアプリ ${q.off.length} 個${q.none.length ? `（無い ${q.none.length} 個: ${q.none.join(' ')}）` : ''}${q.fail.length ? `（止まらない: ${q.fail.join(' ')}）` : ''}、${q.lines.join('、')}`;

/** the game compiled ahead, all of it (pure: the words) */
export const compileLine = (pkg) => ['cmd', 'package', 'compile', '-m', 'speed', '-f', pkg];
/** the compiler filter Android reports for a package (dumpsys package <pkg>: "[status=speed] [reason=cmdline]") → 'speed' | null (pure) */
export const compiledFilter = (dump) => /\[status=([\w-]+)\]/.exec(dump ?? '')?.[1] ?? null;
/** cmd package compile on the device, timed, and what Android says the game is compiled as after → {ok, s, filter, out} */
export function compileGame(adb, pkg, { timeoutMs = 10 * 60_000 } = {}) {
  const t0 = now(), r = adb.shell(compileLine(pkg), { timeout: timeoutMs });
  const out = `${r.stdout}${r.stderr}`.trim().split('\n').pop()?.slice(0, 120) ?? '';
  const filter = compiledFilter(adb.shell(['dumpsys', 'package', pkg], { timeout: 30_000 }).stdout);
  return { ok: r.status === 0 && /Success/.test(r.stdout), s: secs(now() - t0), filter, out };
}
/** compileGame()'s result as one line for a notice (pure) */
export const compileNote = (c) => `コンパイル（speed）${c.ok ? `${c.s} 秒` : `できません（${c.out || '答えなし'}、${c.s} 秒）`}、状態 ${c.filter ?? '不明'}`;
