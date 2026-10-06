#!/usr/bin/env node
// redroid: the real Android in a container on the host's own kernel (no VM, no snapshot to restore), as a faster device
// for app/. The goal: from "start" to a device the lab can debug on in under 30 seconds.
// Reached through `node lab.mjs app redroid <cmd>` and `app run|ui --device redroid` (app.mjs hands them here); writes
// nothing outside app/redroid/.lab, its data folder and its own containers (names start with bdslab-redroid).
//   node app/redroid/redroid.mjs doctor              what this machine lacks for a redroid device, and the fix (exit 1 if any)
//   node app/redroid/redroid.mjs setup               gapps + image in one (the build context removed after)
//   node app/redroid/redroid.mjs gapps <dir>        MindTheGapps (Play services + Play Store) laid out as a docker build context
//   node app/redroid/redroid.mjs image [--gapps <dir>] [--tag t]   the image (redroid + GApps on top, or redroid as it is)
//   node app/redroid/redroid.mjs up [--data d] [--restore direct|overlay] [--image t] [--name n] [--port p]
//   node app/redroid/redroid.mjs down [--name n]     node app/redroid/redroid.mjs facts [--port p]
// Knobs: REDROID_IMAGE (redroid/redroid:14.0.0_64only-latest), REDROID_GAPPS_URL (+ REDROID_GAPPS_SHA256), REDROID_SIZE
// (1560x720@280), REDROID_FPS (20), REDROID_ARGS (more boot args / properties), ADB (else $ANDROID_HOME/platform-tools/adb).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { profile, bootLoop, readyLoop, stages, asideName, later, q } from './wait.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.join(HERE, '.lab');
export const BASE_IMAGE = process.env.REDROID_IMAGE || 'redroid/redroid:14.0.0_64only-latest';
export const GAPPS_TAG = 'bdslab/redroid:gapps';
export const NAME = 'bdslab-redroid';
export const PORT = 5600;   // (not 5555: nothing else of the lab's is on it)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();
const secs = (ms) => Math.round(ms / 100) / 10;
const GHA = process.env.GITHUB_ACTIONS === 'true';

// ---- small helpers ----
export function sh(cmd, args, { timeout = 120_000, input, quiet = false, sudo = false, env } = {}) {
  const [c, a] = sudo && process.getuid?.() !== 0 ? ['sudo', ['-n', cmd, ...args]] : [cmd, args];
  const r = spawnSync(c, a, { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 256e6, input, ...(env ? { env } : {}) });
  const o = { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
  if (o.status !== 0 && !quiet) console.error(`  (${cmd} ${args.slice(0, 3).join(' ')} → ${o.status}: ${(o.stderr || o.stdout).trim().split('\n').slice(-2).join(' ').slice(0, 300)})`);
  return o;
}
export function notice(title, msg) {
  console.log(`${title}: ${msg}`);
  if (GHA) console.log(`::notice title=${title.replace(/[,:\n]/g, ' ')}::${String(msg).replace(/\r?\n/g, ' ').replace(/%/g, '%25')}`);
}
const adbBin = () => process.env.ADB || [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean).map((d) => path.join(d, 'platform-tools', 'adb')).find((p) => fs.existsSync(p)) || 'adb';
export function adb(port, args, opts = {}) { return sh(adbBin(), ['-s', `127.0.0.1:${port}`, ...args], { quiet: true, timeout: 30_000, ...opts }); }
const ashell = (port, line, opts) => adb(port, ['shell', line], opts);
const prop = (port, p) => ashell(port, `getprop ${p}`, { timeout: 10_000 }).stdout.trim();

/** the boot args: the screen, software drawing in the container (ANGLE → SwiftShader), no setup wizard, no boot
 *  animation; redroid takes plain `key=value` words as system properties too. REDROID_PROFILE=fast: a smaller screen and
 *  fewer frames (wait.mjs PROFILES; REDROID_SIZE / REDROID_FPS still win; unset = as before) (pure) */
export function bootArgs(env = process.env) {
  const p = profile(env);
  const m = /^(\d+)x(\d+)(?:@(\d+))?$/.exec(env.REDROID_SIZE || p.size || '1560x720@280') ?? [];
  const [w, h, dpi] = [m[1] || '1560', m[2] || '720', m[3] || '280'];
  return [
    'androidboot.redroid_gpu_mode=guest', `androidboot.redroid_width=${w}`, `androidboot.redroid_height=${h}`, `androidboot.redroid_dpi=${dpi}`,
    `androidboot.redroid_fps=${env.REDROID_FPS || p.fps || '20'}`, 'androidboot.use_memfd=1',
    'ro.setupwizard.mode=DISABLED', 'debug.sf.nobootanimation=1', 'ro.hw_timeout_multiplier=5', 'service.adb.root=1',
    ...(env.REDROID_ARGS ? env.REDROID_ARGS.trim().split(/\s+/) : []),
  ].filter((a) => /^[\w.]+=[\w.,:/-]*$/.test(a));
}

// ---- GApps ----
/** MindTheGapps for Android 14 x86_64: the newest release's zip (GitHub's API) unless REDROID_GAPPS_URL names one */
async function gappsUrl() {
  if (process.env.REDROID_GAPPS_URL) return { url: process.env.REDROID_GAPPS_URL, sha256: process.env.REDROID_GAPPS_SHA256 || null };
  for (const repo of (process.env.REDROID_GAPPS_REPOS || 'MindTheGapps/14.0.0-x86_64,s1204IT/MindTheGappsBuilder').split(',')) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, { headers: { 'user-agent': 'bds-lab', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) { console.error(`  (${repo}: HTTP ${r.status})`); continue; }
      for (const rel of await r.json()) {
        const a = rel.assets?.find((x) => /^MindTheGapps-14\.0\.0-x86_64-.*\.zip$/.test(x.name));
        if (a) return { url: a.browser_download_url, sha256: null, name: a.name };
      }
    } catch (e) { console.error(`  (${repo}: ${e.message})`); }
  }
  throw new Error('MindTheGapps 14 x86_64 の zip が見つかりません（REDROID_GAPPS_URL で指定）');
}
/** downloads and lays out <dir>/system/... (what the zip puts under system/) + a Dockerfile that copies it over redroid */
export async function gapps(dir) {
  const t0 = now(), { url, sha256 } = await gappsUrl();
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'gapps.zip');
  const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!r.ok) throw new Error(`GApps を取れません（HTTP ${r.status}）`);
  const buf = Buffer.from(await r.arrayBuffer()), got = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha256 && got !== sha256.toLowerCase()) throw new Error(`GApps のハッシュが違います（${got}）`);
  fs.writeFileSync(zip, buf);
  const x = path.join(dir, 'x');
  fs.rmSync(x, { recursive: true, force: true });
  if (sh('unzip', ['-q', '-o', zip, '-d', x], { timeout: 300_000 }).status !== 0) throw new Error('GApps の zip を開けません');
  // the zip's layout: system/{app,priv-app,etc,framework,product/...} (the flashable script's own files beside it)
  const sys = [path.join(x, 'system'), ...fs.readdirSync(x).map((d) => path.join(x, d, 'system'))].find((d) => fs.existsSync(d));
  if (!sys) throw new Error(`GApps の zip に system/ がありません（中身: ${fs.readdirSync(x).join(' ')}）`);
  const ctx = path.join(dir, 'ctx');
  fs.rmSync(ctx, { recursive: true, force: true }); fs.mkdirSync(ctx, { recursive: true });
  fs.renameSync(sys, path.join(ctx, 'system'));
  fs.writeFileSync(path.join(ctx, 'Dockerfile'), `ARG BASE\nFROM \${BASE}\nCOPY system/ /system/\n`);
  const count = sh('find', [path.join(ctx, 'system'), '-name', '*.apk'], { quiet: true }).stdout.trim().split('\n').filter(Boolean);
  notice('GApps', `${path.basename(url)} ${(buf.length / 1e6).toFixed(0)} MB sha256 ${got.slice(0, 16)}…、APK ${count.length} 個（${count.map((f) => path.basename(f, '.apk')).join(' ')}）、${secs(now() - t0)} 秒`);
  fs.rmSync(zip); fs.rmSync(x, { recursive: true, force: true });
  return ctx;
}
export function image({ ctx, tag = GAPPS_TAG, base = BASE_IMAGE } = {}) {
  const t0 = now();
  if (sh('docker', ['image', 'inspect', base], { quiet: true }).status !== 0 && sh('docker', ['pull', '-q', base], { timeout: 600_000 }).status !== 0) throw new Error(`${base} を取れません`);
  const t1 = now();
  if (!ctx) return { tag: base, pullS: secs(t1 - t0) };
  if (sh('docker', ['build', '-q', '--build-arg', `BASE=${base}`, '-t', tag, ctx], { timeout: 600_000 }).status !== 0) throw new Error('イメージを作れません（docker build）');
  return { tag, pullS: secs(t1 - t0), buildS: secs(now() - t1) };
}

// ---- the data folder and how a run gets its own copy ----
// direct: the folder itself (a second start sees what the first left) · overlay: the prepared folder read-only under a fresh
// writable layer (nothing copied: the start is free)
export function restore(src, mode, work) {
  const t0 = now();
  if (mode === 'direct') { fs.mkdirSync(src, { recursive: true }); return { data: src, ms: 0 }; }
  // the last device killed and its rm, and the last run's folder (its upper layer can be large), left to the background:
  // both moved out of the way first (the container renamed, the folder moved aside), so nothing the new start uses collides
  down({ quiet: true, wait: false });
  unmount(work);
  if (sh('test', ['-e', work], { sudo: true, quiet: true }).status === 0) {
    const old = `${work}.old-${process.pid}-${Date.now()}`, su = process.getuid?.() === 0 ? '' : 'sudo -n ';
    const moved = sh('mv', ['-T', work, old], { sudo: true, quiet: true }).status === 0;
    if (!moved || !later(`${su}rm -rf --one-file-system ${q(old)} >/dev/null 2>&1`)) sh('rm', ['-rf', moved ? old : work], { sudo: true, quiet: true });
  }
  if (mode === 'overlay') {
    for (const d of ['upper', 'work', 'merged']) sh('mkdir', ['-p', path.join(work, d)], { sudo: true });
    const o = `lowerdir=${src},upperdir=${path.join(work, 'upper')},workdir=${path.join(work, 'work')}`;
    if (sh('mount', ['-t', 'overlay', 'overlay', '-o', o, path.join(work, 'merged')], { sudo: true }).status !== 0) throw new Error('overlay を作れません');
    return { data: path.join(work, 'merged'), ms: now() - t0 };
  }
  throw new Error(`restore は direct / overlay（${mode}）`);
}
function unmount(work) { if (work) sh('umount', [path.join(work, 'merged')], { sudo: true, quiet: true }); }

// ---- the container ----
/** stops the device: docker kill (SIGKILL: the port and /data let go at once), then its rm. wait: false = the rm in the
 *  background under another name (asideName: the next `docker run --name` does not collide) */
export function down({ name = NAME, port = PORT, quiet = false, wait = true } = {}) {
  sh(adbBin(), ['disconnect', `127.0.0.1:${port}`], { quiet: true });
  const k = sh('docker', ['kill', name], { quiet: true, timeout: 60_000 });
  let r = k;
  if (!/no such container/i.test(k.stderr)) {
    const aside = wait ? null : asideName(name);
    r = aside && sh('docker', ['rename', name, aside], { quiet: true, timeout: 60_000 }).status === 0 && later(`docker rm -f ${q(aside)} >/dev/null 2>&1`)
      ? { status: 0 } : sh('docker', ['rm', '-f', name], { quiet: true, timeout: 60_000 });
  }
  if (!quiet) console.log(r.status === 0 ? `  ${name} を止めました` : `  ${name} は動いていません`);
}
/** starts the device on a data folder and waits: → {runS, adbS, bootS, readyS} seconds from the start (docker run) + ms:
 *  {run, adb, boot, ready} what each stage took on its own. Waited for without polling from here: adb connect until adbd
 *  takes it, adb wait-for-device, then one loop on the device for boot_completed and one for the launcher (wait.mjs) */
// (from: the prepared folder a restored copy came from — kept on the container as a label, so a resident device is reused only
// for the same prepared device and image)
export async function up({ data, from = data, image: img = GAPPS_TAG, name = NAME, port = PORT, timeoutMs = 240_000, extra = [], untilBoot = false } = {}) {
  down({ name, port, quiet: true });
  const t0 = now(), mark = {}, at = {}, left = () => Math.round(timeoutMs - (now() - t0)), serial = `127.0.0.1:${port}`;
  const run = sh('docker', ['run', '-d', '--privileged', '--name', name, '--label', `bdslab.from=${from ?? ''}`, '--label', `bdslab.image=${img}`, '-p', `127.0.0.1:${port}:5555`, ...(data ? ['-v', `${data}:/data`] : []), img, ...bootArgs(), ...extra], { timeout: 120_000 });
  if (run.status !== 0) throw new Error(`redroid が起きません（docker run）: ${run.stderr.trim().slice(0, 300)}`);
  at.run = now() - t0; mark.runS = secs(at.run);
  // (a step that fails — adbd not listening yet, the connection dropped — is tried again after a second, adb connect first)
  while (left() > 0 && !(untilBoot ? at.boot : at.ready)) {
    if (at.adb == null) {
      if (/connected/.test(sh(adbBin(), ['connect', serial], { quiet: true, timeout: 5000 }).stdout) && adb(port, ['wait-for-device'], { timeout: Math.max(1000, Math.min(15_000, left())) }).status === 0) { at.adb = now() - t0; mark.adbS = secs(at.adb); continue; }
    } else if (at.boot == null) {
      if (/^booted\r?$/m.test(ashell(port, bootLoop(left() / 1000), { timeout: left() + 5000 }).stdout)) { at.boot = now() - t0; mark.bootS = secs(at.boot); continue; }
    // ready = the package manager and the launcher answer (an app can be started)
    } else if (/^ready\r?$/m.test(ashell(port, readyLoop(left() / 1000), { timeout: left() + 5000 }).stdout)) { at.ready = now() - t0; mark.readyS = secs(at.ready); continue; }
    if (left() <= 0) break;
    await sleep(1000);
    if (at.adb != null) sh(adbBin(), ['connect', serial], { quiet: true, timeout: 5000 });
  }
  mark.ms = stages(at);
  if (at.boot != null && at.ready == null && !untilBoot) mark.focus = ashell(port, 'dumpsys window displays | grep mCurrentFocus=', { timeout: 10_000 }).stdout.trim().slice(0, 160);
  if (at.boot == null) {
    const logs = sh('docker', ['logs', '--tail', '30', name], { quiet: true });
    throw new Error(`redroid が ${timeoutMs / 1000} 秒で起動し終わりません（${JSON.stringify(mark)}）: ${(logs.stdout + logs.stderr).split('\n').slice(-8).join(' | ').slice(0, 600)}`);
  }
  notice('redroid の起動（段階ごとの ms）', `${Object.entries(mark.ms).map(([k, v]) => `${k} ${v}`).join(' → ')}（画面: ${process.env.REDROID_PROFILE || '既定'}）`);
  return mark;
}

/** one redroid device per machine (one container name, one adb port): a second command would stop the first one's device.
 *  → a release function; throws with who holds it. A lock whose process is gone is taken over */
export function lock(what, file = path.join(LAB, 'device.lock')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf8'));
    let alive = false; try { process.kill(held.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
    if (alive && held.pid !== process.pid) throw Object.assign(new Error(`redroid の端末は別のコマンドが使っています（${held.what}、pid ${held.pid}）: 終わるのを待つか、そのコマンドを止めてください`), { held: true });
  } catch (e) { if (e.held) throw e; }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, what, at: Date.now() }));
  return () => { try { if (JSON.parse(fs.readFileSync(file, 'utf8')).pid === process.pid) fs.rmSync(file, { force: true }); } catch { /* gone */ } };
}

/** a device already up and booted (the one `--keep` left): the container running, adb connected, boot completed */
export function running({ name = NAME, port = PORT, from, image: img } = {}) {
  const [on, was, of] = sh('docker', ['inspect', '-f', '{{.State.Running}}|{{index .Config.Labels "bdslab.from"}}|{{index .Config.Labels "bdslab.image"}}', name], { quiet: true, timeout: 20_000 }).stdout.trim().split('|');
  if (on !== 'true' || (from && was !== from) || (img && of !== img)) return false;
  sh(adbBin(), ['connect', `127.0.0.1:${port}`], { quiet: true, timeout: 5000 });
  return adb(port, ['get-state'], { timeout: 5000 }).stdout.trim() === 'device' && prop(port, 'sys.boot_completed') === '1';
}

/** what the device is (no account or device ids): versions, drawing, storage encryption, GApps, CPU and memory */
export function facts(port = PORT) {
  const pk = (p) => { const v = ashell(port, `dumpsys package ${p} | grep -m1 -E 'versionName='`, { timeout: 30_000 }).stdout.trim(); return v ? v.replace(/.*versionName=/, '') : '-'; };
  const gl = ashell(port, 'dumpsys SurfaceFlinger | grep -m1 -E "^GLES"', { timeout: 30_000 }).stdout.trim().slice(0, 160);
  return {
    android: prop(port, 'ro.build.version.release'), sdk: prop(port, 'ro.build.version.sdk'), abi: prop(port, 'ro.product.cpu.abilist'),
    crypto: `${prop(port, 'ro.crypto.state') || '-'}/${prop(port, 'ro.crypto.type') || '-'}`, setupwizard: prop(port, 'ro.setupwizard.mode') || '-',
    gms: pk('com.google.android.gms'), vending: pk('com.android.vending'), gsf: pk('com.google.android.gsf'),
    sqlite3: ashell(port, 'command -v sqlite3', { timeout: 10_000 }).stdout.trim() || '-', gles: gl || '-',
    cpus: ashell(port, 'nproc', { timeout: 10_000 }).stdout.trim(), uptime: ashell(port, 'cut -d" " -f1 /proc/uptime', { timeout: 10_000 }).stdout.trim(),
    root: ashell(port, 'id -u', { timeout: 10_000 }).stdout.trim() === '0',
  };
}

/** the first start's leftovers out of the way: setup done, no animations, Google's own first-run screens skipped */
export function settle(port = PORT) {
  const lines = [
    'settings put global device_provisioned 1', 'settings put secure user_setup_complete 1',
    'settings put global window_animation_scale 0', 'settings put global transition_animation_scale 0', 'settings put global animator_duration_scale 0',
    'settings put global package_verifier_enable 0', 'settings put global verifier_verify_adb_installs 0',
    'settings put system screen_off_timeout 2147483647', 'svc power stayon true',
    // (Android's "Viewing full screen" over a game's first full-screen start: it took the focus from the game's first launch)
    'settings put secure immersive_mode_confirmations confirmed',
    'pm disable-user --user 0 com.google.android.setupwizard >/dev/null 2>&1; true',
  ];
  return ashell(port, lines.join('; '), { timeout: 60_000 }).status === 0;
}

// ---- what this machine has for a redroid device, and the fix for what it lacks ----
/** the facts doctor() judges, read from this machine (sudo -n only: never a password prompt) */
export function hostFacts({ data = path.join(LAB, 'data'), image: img = GAPPS_TAG } = {}) {
  const has = (c, a = ['--version']) => sh(c, a, { quiet: true, timeout: 20_000 }).status === 0;
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const docker = has('docker');
  const prep = (() => { try { return JSON.parse(fs.readFileSync(path.join(LAB, 'game-prep.json'), 'utf8')); } catch { return null; } })();
  return {
    platform: process.platform, kernel: os.release(),
    docker, dockerd: docker && sh('docker', ['info', '--format', '{{.ServerVersion}}'], { quiet: true, timeout: 20_000 }).status === 0,
    binder: /\bbinder\b/.test(read('/proc/filesystems')) || /^binder_linux\b/m.test(read('/proc/modules')) || fs.existsSync('/dev/binder') || fs.existsSync('/dev/binderfs'),
    overlay: /\boverlay\b/.test(read('/proc/filesystems')) || /^overlay\b/m.test(read('/proc/modules')),
    sudo: process.getuid?.() === 0 || sh('sudo', ['-n', 'true'], { quiet: true, timeout: 10_000 }).status === 0,
    adb: has(adbBin(), ['version']), python3: has('python3'), tesseract: has('tesseract'), uinput: fs.existsSync('/dev/uinput'),
    image: docker && sh('docker', ['image', 'inspect', img], { quiet: true, timeout: 20_000 }).status === 0,
    prepared: Boolean(prep && (prep.firstLaunch?.titleS || prep.firstLaunch?.windowS)) && sh('test', ['-d', path.join(data, 'app')], { sudo: true, quiet: true }).status === 0,
    account: Boolean(process.env.GOOGLE_EMAIL && process.env.GOOGLE_AAS_TOKEN),
    resident: docker && running(),
  };
}
/** facts → rows {name, ok, soft, detail, fix} in the order they are fixed (pure: tests/app-offline.mjs) */
export function doctor(f) {
  const L = f.platform === 'linux';
  return [
    { name: 'Linux', ok: L, detail: L ? f.kernel : `${f.platform}（redroid はホストの Linux カーネルの上で動きます）`, fix: 'Linux のマシンか、GitHub Actions（node lab.mjs app ci --device redroid）で' },
    { name: 'docker', ok: f.docker && f.dockerd, detail: !f.docker ? '入っていません' : f.dockerd ? '使えます' : 'デーモンにつながりません', fix: f.docker ? 'sudo systemctl start docker（と sudo usermod -aG docker $USER の後にログインし直す）' : 'https://docs.docker.com/engine/install/ から入れる' },
    { name: 'binder', ok: f.binder, detail: f.binder ? '使えます' : 'カーネルの binder がありません', fix: 'sudo modprobe binder_linux devices=binder,hwbinder,vndbinder（Ubuntu で無ければ sudo apt-get install linux-modules-extra-$(uname -r) の後に）' },
    { name: 'overlay', ok: f.overlay, soft: true, detail: f.overlay ? '使えます（準備した /data を 0.1 秒で戻す）' : '無い: 戻すたびに写します', fix: 'sudo modprobe overlay' },
    { name: 'sudo', ok: f.sudo, detail: f.sudo ? 'パスワードなしで使えます' : 'パスワードを聞かれます', fix: '/data は Android の uid のファイル: root で動かすか、sudo をパスワードなしに（visudo）' },
    { name: 'adb', ok: f.adb, detail: f.adb ? '使えます' : '見つかりません', fix: 'sudo apt-get install adb（または ANDROID_HOME の platform-tools / ADB=<パス>）' },
    { name: 'python3', ok: f.python3, detail: f.python3 ? '使えます' : '見つかりません', fix: 'sudo apt-get install python3（アカウントを止めた端末の /data へ書くのに使います）' },
    { name: 'tesseract', ok: f.tesseract, soft: true, detail: f.tesseract ? '使えます' : '無い: タイトル画面を読めません', fix: 'sudo apt-get install tesseract-ocr' },
    { name: 'uinput', ok: f.uinput, soft: true, detail: f.uinput ? '使えます' : '無い: 端末のコントローラーが使えません', fix: 'sudo modprobe uinput' },
    { name: 'イメージ', ok: f.image, detail: f.image ? GAPPS_TAG : 'まだ作っていません', fix: 'node lab.mjs app redroid setup' },
    { name: 'Google の認証', ok: f.account || f.prepared, soft: f.prepared, detail: f.account ? 'あります' : f.prepared ? '（準備済みの端末があるので不要）' : 'GOOGLE_EMAIL / GOOGLE_AAS_TOKEN がありません', fix: 'node lab.mjs app token' },
    { name: '常駐の端末', ok: Boolean(f.resident), soft: true, detail: f.resident ? `動いています（127.0.0.1:${PORT}: 次の run / ui はこれを使います。止める: node lab.mjs app redroid down）` : 'なし（run / ui --keep で残せます）', fix: '' },
    { name: '準備済みの端末', ok: f.prepared, detail: f.prepared ? 'あります（ゲームがタイトルまで起動した /data）' : 'まだ作っていません', fix: 'node lab.mjs app redroid prep（約 8 分、一度だけ）' },
  ];
}

// ---- app run / app ui --device redroid ----
/** `app run|ui … --device redroid` → game.mjs debug's arguments: -a and --keep are its own, the rest goes on to app run / ui
 *  after `--`; what only an emulator has is refused with the reason (pure: tests/app-offline.mjs) → {args} | {error, hint} */
export const EMULATOR_ONLY = ['--wipe', '--window', '--account', '--vending', '--apk', '--no-fetch'];
export function appArgs(mode, argv) {
  const own = [], pass = [];
  let addon = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-a' || a === '--addon') addon = argv[++i];
    else if (a === '--keep') own.push('--keep');
    else if (a === '--data' || a === '--image' || a === '--shots') own.push(a, argv[++i]);
    else if (EMULATOR_ONLY.includes(a)) return { error: `${a} はエミュレータのためのものです（--device redroid では使えません）`, hint: a === '--account' || a === '--vending' ? 'アカウントとゲームは準備済みの端末に入っています（node lab.mjs app redroid prep）' : '外して実行してください' };
    else pass.push(a);
  }
  if (!addon) return { error: '-a <アドオン> が要ります', hint: `node lab.mjs app ${mode} -a <アドオン> --device redroid` };
  return { args: ['debug', '--addon', addon, '--mode', mode, ...own, ...(pass.length ? ['--', ...pass] : [])] };
}
/** --device <x> out of argv (APP_DEVICE when not given; never inside a run redroid itself started: APP_SERIAL is set) */
export function deviceOf(argv, env = process.env) {
  const i = argv.indexOf('--device');
  if (i >= 0) { const d = argv[i + 1]; return { device: d, argv: [...argv.slice(0, i), ...argv.slice(i + 2)] }; }
  return { device: env.APP_SERIAL ? 'emu' : (env.APP_DEVICE || 'emu'), argv };
}

// ---- command line ----
function opts(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) o[args[i].slice(2)] = args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[++i]; else o._.push(args[i]); }
  return o;
}
async function main([cmd, ...rest]) {
  const o = opts(rest), port = Number(o.port) || PORT;
  switch (cmd) {
    case 'doctor': {
      const rows = doctor(hostFacts({ data: o.data && path.resolve(o.data), image: o.image || GAPPS_TAG }));
      const wide = (t) => [...t].reduce((n, c) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(c) ? 2 : 1), 0);
      for (const r of rows) console.log(`  ${r.ok ? '✔' : r.soft ? '・' : '✘'} ${r.name}${' '.repeat(Math.max(1, 16 - wide(r.name)))}${r.detail}`);
      const next = rows.find((r) => !r.ok && !r.soft);
      console.log(next ? `\n次にやること: ${next.fix}` : '\n準備はできています。次にやること: node lab.mjs app run -a <アドオン> --device redroid');
      if (next) process.exitCode = 1;
      break;
    }
    case 'setup': {
      const dir = path.resolve(o._[0] || path.join(LAB, 'gapps'));
      console.log(JSON.stringify(image({ ctx: await gapps(dir), tag: o.tag || GAPPS_TAG })));
      fs.rmSync(dir, { recursive: true, force: true });
      break;
    }
    case 'gapps': console.log(await gapps(path.resolve(o._[0] || path.join(LAB, 'gapps')))); break;
    case 'image': console.log(JSON.stringify(image({ ctx: o.gapps && path.resolve(o.gapps), tag: o.tag || GAPPS_TAG }))); break;
    case 'up': {
      const r = restore(path.resolve(o.data || path.join(LAB, 'data')), o.restore || 'direct', path.resolve((o.data || path.join(LAB, 'data')) + '.run'));
      console.log(JSON.stringify({ restoreS: secs(r.ms), ...(await up({ data: r.data, image: o.image || GAPPS_TAG, name: o.name || NAME, port })) }));
      break;
    }
    case 'down': down({ name: o.name || NAME, port }); break;
    case 'facts': console.log(JSON.stringify(facts(port), null, 2)); break;
    case 'settle': console.log(settle(port) ? 'ok' : 'failed'); break;
    default: console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`E ${e.message}`); if (GHA) console.log(`::error title=redroid::${e.message.replace(/\r?\n/g, ' ')}`); process.exit(1); });
}
