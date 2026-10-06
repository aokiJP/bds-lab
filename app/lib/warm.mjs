// The device kept ready: an AVD whose snapshot "lab-title" holds Minecraft already started, past its license check, on the
// title screen. `app prepare` makes it once (the slow part: first boot, install, account, the game's first start) and
// `app run` / `app emu` start from it, so a run is the snapshot's load and the join. A stamp beside the snapshot says
// what it was made from; any difference (another APK, emulator, system image, cores, RAM, screen, GPU, account mode,
// FORMAT) and the snapshot is not used: the emulator would refuse it, or worse, run an old game.
// Between CI runs the AVD travels only through the private cache (lib/vault.mjs): it holds the APK and the account.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { AVD, avdHome, deviceFit, gpuMode, screenSize, sysImage, tools } from './android.mjs';

export const SNAPSHOT = 'lab-title';
export const FORMAT = 1;
export const avdDir = (env = process.env) => path.join(avdHome(env), `${AVD}.avd`);
const stampFile = (env) => path.join(avdDir(env), 'lab-ready.json');

/** Pkg.Revision of an SDK package folder (source.properties), or null */
export function revision(dir) {
  try { return /^Pkg\.Revision\s*=\s*(\S+)/m.exec(fs.readFileSync(path.join(dir, 'source.properties'), 'utf8'))?.[1] ?? null; } catch { return null; }
}
export function sdkRevisions(env = process.env) {
  const t = tools(env);
  return { emulator: t.sdk ? revision(path.join(t.sdk, 'emulator')) : null, sysimg: t.sdk ? revision(path.join(t.sdk, ...sysImage(env).split(';'))) : null };
}
/** what a snapshot made now would be (the hardware part must match for the emulator to load it at all) */
export function wantStamp({ apkCode, account, env = process.env, rev = sdkRevisions(env) }) {
  const fit = deviceFit(env), scr = screenSize(env);
  return { format: FORMAT, apk: Number(apkCode) || null, sysimg: sysImage(env), sysimgRev: rev.sysimg, emulatorRev: rev.emulator, cores: fit.cores, ram: fit.ram,
    screen: scr ? `${scr.w}x${scr.h}@${scr.density}` : 'default', gpu: gpuMode(env), account: Boolean(account), ...(seedWanted(env) ? { world: WORLD_FORMAT } : {}), ...(signinWanted(env) ? { signin: true } : {}) };
}
/** the player's own world put on the device when it is prepared (lib/world.mjs: 1.26 sends a player without worlds into
 *  its new player's flow, not to the PLAY screen): a key of the stamp, so a device made before it is made again once.
 *  APP_SEED_WORLD=0: none (and a device made without it fits) */
export const WORLD_FORMAT = 1;
export const seedWanted = (env = process.env) => env.APP_SEED_WORLD !== '0';
/** a device signed in to a Microsoft account is wanted (MS_EMAIL here, or the workflow's APP_SIGNIN_WANTED from its
 *  secrets — the flag only, never the address). Only then is it a key of the stamp: devices made before stay usable */
export const signinWanted = (env = process.env) => env.APP_SIGNIN !== '0' && (env.APP_SIGNIN_WANTED === 'true' || Boolean(env.MS_EMAIL));
/** the keys where a stamp differs from what is wanted (pure); [] = usable. A null apk in `want` = any APK */
export function stampDiff(have, want) {
  if (!have) return ['（スナップショットがありません）'];
  return Object.keys(want).filter((k) => !(k === 'apk' && want.apk === null) && JSON.stringify(have[k] ?? null) !== JSON.stringify(want[k] ?? null));
}
/** the stamp of the snapshot on disk (null when there is no snapshot or no stamp) */
export function readStamp(env = process.env) {
  if (!fs.existsSync(path.join(avdDir(env), 'snapshots', SNAPSHOT))) return null;
  try { return JSON.parse(fs.readFileSync(stampFile(env), 'utf8')); } catch { return null; }
}
export function writeStamp(stamp, extra = {}, env = process.env) { fs.writeFileSync(stampFile(env), JSON.stringify({ ...stamp, ...extra, cpu: hostCpu(), made: new Date().toISOString() }, null, 1)); }
/** this machine's CPU model (a snapshot carries the CPU it was made on: noted, not compared) */
export function hostCpu() { try { return /^model name\s*:\s*(.+)$/m.exec(fs.readFileSync('/proc/cpuinfo', 'utf8'))?.[1]?.trim() ?? null; } catch { return null; } }
export function dropStamp(env = process.env) { fs.rmSync(stampFile(env), { force: true }); }

// ---- the base: the device before the game (Play Store in /system, the account written, Google's first-boot work done),
// kept apart from the title snapshot. When Minecraft updates, the device is made from it (a cold boot of a device that is
// already set up) instead of from nothing, and it keeps the same Google registration (no new device for the account)
// (2: no zeros written over the free space — /data is encrypted on the disk, they landed as 5.8 GB of random bytes)
export const BASE_FORMAT = 2;
const baseFile = (env) => path.join(avdDir(env), 'lab-base.json');
/** what a base made now would be (pure): the system image and the account mode. A base is cold-booted (no snapshot),
 *  so the GPU mode, cores, RAM and screen of the device made from it are free to differ (one base serves them all) */
export function wantBase({ account, env = process.env, rev = sdkRevisions(env) }) {
  return { base: BASE_FORMAT, sysimg: sysImage(env), sysimgRev: rev.sysimg, account: Boolean(account) };
}
/** the base stamp of the AVD on disk (null when there is no AVD or it was not kept as a base) */
export function readBase(env = process.env) {
  if (!fs.existsSync(path.join(avdDir(env), 'config.ini'))) return null;
  try { return JSON.parse(fs.readFileSync(baseFile(env), 'utf8')); } catch { return null; }
}
export function writeBase(stamp, extra = {}, env = process.env) { fs.writeFileSync(baseFile(env), JSON.stringify({ ...stamp, ...extra, cpu: hostCpu(), made: new Date().toISOString() }, null, 1)); }
/** a short name for the stamp, for a cache key (pure) */
export const stampKey = (s) => `${s.apk ?? 'x'}-${crypto.createHash('sha256').update(JSON.stringify({ ...s, apk: undefined })).digest('hex').slice(0, 12)}`;

/** bytes a folder takes on disk (allocated blocks: sparse files count what they hold) */
export function duBytes(dir) {
  let n = 0;
  const walk = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const f = path.join(d, e.name); try { if (e.isDirectory()) walk(f); else { const st = fs.lstatSync(f); n += st.blocks ? st.blocks * 512 : st.size; } } catch { /* gone */ } } };
  walk(dir);
  return n;
}
// the emulator's leftovers that must not travel with the AVD (a stale lock reads as "already running")
/** the zeros inside the AVD's big files (its disk images after zeroFree, its RAM) turned into holes (`fallocate --dig-holes`:
 *  the same bytes when read, none on the disk): the private cache carries and writes back only what is there. Linux; →
 *  { before, after } bytes on disk, or null where there is no fallocate */
export function digHoles(dir, { min = 64 * 2 ** 20 } = {}) {
  if (process.platform !== 'linux' || spawnSync('fallocate', ['--help'], { stdio: 'ignore' }).status !== 0) return null;
  let before = 0, after = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) { const st = fs.statSync(f); if (st.size < min) continue; before += st.blocks * 512; spawnSync('fallocate', ['--dig-holes', f], { stdio: 'ignore', timeout: 30 * 60_000 }); after += fs.statSync(f).blocks * 512; } } };
  try { walk(dir); } catch { return null; }
  return { before, after };
}
export function cleanAvd(env = process.env) {
  const d = avdDir(env);
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d)) if (/\.lock$|^tmpAdbCmds$|^emu-launch-params\.txt$/.test(e)) fs.rmSync(path.join(d, e), { recursive: true, force: true });
  fs.rmSync(path.join(d, 'snapshots', 'default_boot'), { recursive: true, force: true });
}

// ---- the parts kept in the private cache: what each holds and where it opens to ----
/** {name: {what, base, entries()}} for this checkout (top = the repository folder; bdsCache = the bds lab's .lab) */
export function parts(top, { env = process.env, bdsCache = path.join(top, 'bds', '.lab') } = {}) {
  const lab = path.join(top, 'app', '.lab');
  return {
    apk: { what: 'Minecraft の APK', base: path.join(lab, 'apk'), entries: () => ['download'] },
    vending: { what: 'Play ストア', base: lab, entries: () => ['vending'] },
    // the server and what the lab makes from it once (template world, API types); not the running instances or their state
    bds: { what: 'BDS', base: bdsCache, entries: () => (fs.existsSync(bdsCache) ? fs.readdirSync(bdsCache).filter((e) => !/^(run|live\.json|addon|logs?|.*\.lock|lock|tmp)$/.test(e)) : []) },
    avd: { what: '端末（タイトル画面のスナップショット）', base: avdHome(env), entries: () => [`${AVD}.avd`, `${AVD}.ini`] },
    // (the same folder, kept before the game went on it)
    base: { what: '端末の土台（Play ストアとアカウント入り、ゲームなし）', base: avdHome(env), entries: () => [`${AVD}.avd`, `${AVD}.ini`] },
  };
}
export const vaultDir = (top, env = process.env) => env.APP_VAULT_DIR || path.join(top, 'app', '.lab', 'vault');
export const vaultFile = (top, name, env = process.env) => path.join(vaultDir(top, env), `${name}.bin`);

/** the plan (pure): caches [{key, size_in_bytes}], keep: keys in use, incoming: [{key, bytes}] about to be saved
 *  → { drop: [keys], skipBase: bool, total } */
export function tidyPlan(caches, { keep = [], incoming = [], limit = 10 * 2 ** 30 } = {}) {
  const k = new Set(keep.filter(Boolean)), drop = [];
  const ours = (c) => /^app-(avd|base|bds|apk|vending)-/.test(c.key);
  let left = caches.filter((c) => { if (ours(c) && !k.has(c.key)) { drop.push(c.key); return false; } return true; });
  const have = new Set(left.map((c) => c.key));
  const inc = incoming.filter((x) => x.key && !have.has(x.key) && x.bytes > 0);
  const sum = () => left.reduce((n, c) => n + c.size_in_bytes, 0) + inc.reduce((n, x) => n + x.bytes, 0);
  let skipBase = false;
  // (room for the rest first: the base about to be saved is left out, then the base in the cache, then an APK set)
  if (sum() > limit && inc.some((x) => /^app-base-/.test(x.key))) { skipBase = true; inc.splice(inc.findIndex((x) => /^app-base-/.test(x.key)), 1); }
  for (const re of [/^app-base-/, /^app-apk-/]) for (const c of [...left]) if (sum() > limit && re.test(c.key)) { drop.push(c.key); left = left.filter((x) => x !== c); }
  return { drop, skipBase, total: sum() };
}
