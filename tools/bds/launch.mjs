import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const DEFAULT_IMAGE = 'ubuntu:24.04';
export const CONTAINER_PLATFORM = 'linux/amd64'; // BDS は x86_64 だけ

export function chooseRuntime({ platform = process.platform, env = process.env } = {}) {
  const want = env.SANDBOX_BE_BDS_RUNTIME;
  if (want === 'native' || want === 'container') return want;
  if (want) throw new Error(`SANDBOX_BE_BDS_RUNTIME は native か container です（${want}）`);
  return platform === 'darwin' ? 'container' : 'native';
}

export function wantedKind({ platform = process.platform, env = process.env } = {}) {
  return chooseRuntime({ platform, env }) === 'container' || platform !== 'win32' ? 'linux' : 'windows';
}

const which = (bin) => {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n')[0].trim() : null;
};

export function findContainerCli(env = process.env) {
  if (env.SANDBOX_BE_CONTAINER_CLI) return env.SANDBOX_BE_CONTAINER_CLI;
  for (const bin of ['docker', 'podman']) if (which(bin)) return bin;
  if (process.platform === 'darwin') {
    for (const p of ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', path.join(os.homedir(), '.orbstack', 'bin', 'docker'), '/Applications/Docker.app/Contents/Resources/bin/docker', '/opt/homebrew/bin/podman']) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export function containerRunArgs({ dir, ports, name, image = DEFAULT_IMAGE, lan = false, user = null, ipv6Sysctl = true }) {
  const bind = lan ? '' : '127.0.0.1:';
  return [
    'run', '--rm', '-i', '--init',
    '--name', name,
    '--platform', CONTAINER_PLATFORM,
    ...(ipv6Sysctl ? ['--sysctl', 'net.ipv6.conf.all.disable_ipv6=0'] : []),
    ...[...new Set(ports)].flatMap((p) => ['-p', `${bind}${p}:${p}/udp`]),
    '-v', `${path.resolve(dir)}:/bds`,
    '-w', '/bds',
    '-e', 'LD_LIBRARY_PATH=.',
    ...(user ? ['--user', user] : []),
    image,
    './bedrock_server',
  ];
}

const run = (cli, args, timeout = 60000) => spawnSync(cli, args, { encoding: 'utf8', timeout });

export function containerUp(cli) {
  return spawnSync(cli, ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 20000 }).status === 0;
}

const MAC_APPS = { docker: 'OrbStack', podman: 'Podman Desktop' };

export function ensureContainerRuntime({ env = process.env, say = () => {}, waitMs = 90000 } = {}) {
  const cli = findContainerCli(env);
  if (!cli) return { ok: false, cli: null, reason: HINT_INSTALL };
  if (containerUp(cli)) return { ok: true, cli };
  if (process.platform !== 'darwin') return { ok: false, cli, reason: 'コンテナの実行環境が動いていません（docker info が失敗）。Docker Desktop / OrbStack を開くか colima start を実行してください' };

  const apps = ['OrbStack', 'Docker', MAC_APPS[path.basename(cli)]].filter(Boolean);
  let opened = null;
  for (const app of apps) {
    if (!fs.existsSync(`/Applications/${app}.app`)) continue;
    if (spawnSync('open', ['-ga', app], { timeout: 20000 }).status === 0) { opened = app; break; }
  }
  if (!opened && which('colima') && spawnSync('colima', ['start', '--vm-type', 'vz', '--vz-rosetta'], { stdio: 'ignore', timeout: waitMs }).status === 0) opened = 'Colima';
  if (!opened) return { ok: false, cli, reason: 'コンテナの実行環境が動いていません。Docker Desktop / OrbStack を開くか colima start を実行してください' };

  say(`${opened} を起動しています（初回は少し待ちます）…`);
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (containerUp(cli)) return { ok: true, cli, started: true };
    spawnSync('sleep', ['2']);
  }
  return { ok: false, cli, reason: `${opened} の起動を待ちましたが、まだ使えません。アプリの画面を確かめてからもう一度実行してください` };
}

export function isAppleSilicon() {
  if (process.platform !== 'darwin') return false;
  if (process.arch === 'arm64') return true;
  const r = spawnSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' });
  return r.stdout?.trim() === '1';
}

const HINT_INSTALL = 'macOS では Linux 版 BDS をコンテナで動かします。次のどれかを入れて起動してください:\n'
  + '    OrbStack（おすすめ・軽い）  https://orbstack.dev   または  brew install orbstack\n'
  + '    Docker Desktop              https://www.docker.com/products/docker-desktop/\n'
  + '    Colima                      brew install colima docker && colima start --arch x86_64 もしくは --vm-type vz --vz-rosetta';
export const HINT_ROSETTA = 'Apple Silicon では Rosetta で x86_64 を動かします。Docker Desktop なら Settings → General →「Use Rosetta for x86_64/amd64 emulation」を有効に。'
  + 'OrbStack は既定で有効。Colima は colima start --vm-type vz --vz-rosetta';

export function diagnose({ dir = null, image = process.env.SANDBOX_BE_BDS_IMAGE ?? DEFAULT_IMAGE, env = process.env } = {}) {
  const checks = [];
  const add = (ok, label, hint, warn = false) => { checks.push({ ok, label, ...(hint ? { hint } : {}), ...(warn ? { warn } : {}) }); return ok; };
  const runtime = chooseRuntime({ env });
  add(true, `起動方法: ${runtime}（${process.platform}/${process.arch}${isAppleSilicon() ? '・Apple Silicon' : ''}）`);

  if (dir) {
    const kind = bdsKind(dir);
    const want = wantedKind({ env });
    add(kind === want, `BDS のフォルダ: ${dir}（${kind ?? '見つからない'}）`,
      kind === 'windows' ? 'Windows 版の BDS です。macOS / Linux では Linux 版を使います: node tools/bds/get.mjs --download'
        : kind ? undefined : 'node tools/bds/get.mjs --download（または --zip <Linux 版の zip>）で用意してください');
  }

  if (runtime === 'native') return { ok: checks.every((c) => c.ok || c.warn), checks, runtime };

  const cli = findContainerCli(env);
  if (!add(!!cli, `コンテナの CLI: ${cli ?? '無し'}`, HINT_INSTALL)) return { ok: false, checks, runtime };
  const info = run(cli, ['info', '--format', '{{.Architecture}} {{.OperatingSystem}}'], 20000);
  if (!add(info.status === 0, `コンテナの実行環境: ${info.status === 0 ? info.stdout.trim() : '動いていない'}`,
    'Docker Desktop / OrbStack のアプリを開くか、colima start で起動してください')) return { ok: false, checks, runtime };
  if (isAppleSilicon()) add(true, 'Apple Silicon: x86_64 のコンテナは Rosetta で動かします', HINT_ROSETTA, true);
  const img = run(cli, ['image', 'inspect', '--format', '{{.Architecture}}', image], 20000);
  add(img.status === 0, `イメージ ${image}: ${img.status === 0 ? `取得済み（${img.stdout.trim()}）` : '未取得（初回の起動で自動で取ります）'}`, undefined, img.status !== 0);
  if (dir) {
    const home = os.homedir();
    const under = path.resolve(dir).startsWith(home + path.sep);
    add(under || !/colima/.test(info.stdout + (env.DOCKER_HOST ?? '')), `マウント: ${path.resolve(dir)}`,
      'Colima は既定でホームフォルダの下しか共有しません。BDS をホームの下に置くか、colima の mounts に足してください', !under);
  }
  return { ok: checks.every((c) => c.ok || c.warn), checks, runtime };
}

export function bdsKind(dir) {
  try {
    if (!fs.existsSync(path.join(dir, 'server.properties'))) return null;
    const elf = path.join(dir, 'bedrock_server');
    if (fs.existsSync(elf)) {
      const fd = fs.openSync(elf, 'r');
      const head = Buffer.alloc(4);
      fs.readSync(fd, head, 0, 4, 0);
      fs.closeSync(fd);
      if (head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'linux';
    }
    if (fs.existsSync(path.join(dir, 'bedrock_server.exe'))) return 'windows';
    return null;
  } catch { return null; }
}

export function hasIpv6() {
  if (process.platform !== 'linux') return true;
  return fs.existsSync('/proc/net/if_inet6') || fs.existsSync('/proc/sys/net/ipv6');
}

export function buildIpv6Shim(outDir = path.join(os.tmpdir(), 'sandbox-be-shim')) {
  if (hasIpv6()) return null;
  const packed = path.join(ROOT, 'vendor', 'ipv6-shim.so'); // 梱包済みなら cc が無くても動く
  if (fs.existsSync(packed)) return packed;
  const so = path.join(outDir, 'ipv6-shim.so');
  if (fs.existsSync(so)) return so;
  fs.mkdirSync(outDir, { recursive: true });
  for (const cc of ['cc', 'gcc']) {
    const r = spawnSync(cc, ['-shared', '-fPIC', '-O2', '-o', so, path.join(HERE, 'ipv6-shim.c'), '-ldl'], { encoding: 'utf8' });
    if (r.status === 0) return so;
  }
  throw new Error('IPv6 が無い環境です。BDS を起動するには cc か gcc が要ります（tools/bds/ipv6-shim.c を組みます）');
}

const live = new Set(); // 後始末が要るコンテナ
let hooked = false;
function hookCleanup(cli) {
  if (hooked) return;
  hooked = true;
  const clean = () => { for (const name of live) spawnSync(cli, ['rm', '-f', name], { stdio: 'ignore', timeout: 15000 }); live.clear(); };
  process.on('exit', clean);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { if (process.listenerCount(sig) === 1) { clean(); process.exit(128 + (os.constants.signals[sig] ?? 2)); } });
  }
}

export function launchBds({ dir, ports = [19132, 19133], lan = false, say = (m) => process.stderr.write(`${m}\n`), env = process.env } = {}) {
  const abs = path.resolve(dir);
  const runtime = chooseRuntime({ env });
  const kind = bdsKind(abs);
  const want = wantedKind({ env });
  if (kind !== want) {
    if (kind === 'windows') throw new Error(`${abs} は Windows 版の BDS です。${process.platform === 'darwin' ? 'macOS では Linux 版を' : 'ここでは Linux 版を'}使います（node tools/bds/get.mjs --download で用意できます）`);
    throw new Error(`${abs} に ${want === 'windows' ? 'bedrock_server.exe' : 'Linux 版の bedrock_server'} と server.properties がありません（BDS を展開したフォルダを指定してください）`);
  }

  if (runtime === 'native') {
    const childEnv = { ...env, LD_LIBRARY_PATH: '.' };
    const shim = buildIpv6Shim();
    if (shim) childEnv.LD_PRELOAD = shim;
    const exe = process.platform === 'win32' ? 'bedrock_server.exe' : './bedrock_server';
    const wrapper = env.BDS_LAB_WRAPPER;
    if (wrapper && fs.existsSync(wrapper)) {
      const child = spawn(wrapper, [abs, path.basename(exe)], { cwd: abs, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      return { child, runtime, describe: `native+enhancer: ${wrapper}`, kill: () => child.kill('SIGKILL') };
    }
    const child = spawn(exe, [], { cwd: abs, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    return { child, runtime, describe: `native: ${path.join(abs, exe)}`, kill: () => child.kill('SIGKILL') };
  }

  const cli = findContainerCli(env);
  if (!cli) throw new Error(`コンテナの CLI（docker / podman）が見つかりません。\n${HINT_INSTALL}`);
  const up = spawnSync(cli, ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 20000 });
  if (up.status !== 0) throw new Error(`コンテナの実行環境が動いていません（${cli} info が失敗）。Docker Desktop / OrbStack を開くか colima start を実行してください。\n${(up.stderr ?? '').trim()}`);
  const image = env.SANDBOX_BE_BDS_IMAGE ?? DEFAULT_IMAGE;
  if (spawnSync(cli, ['image', 'inspect', image], { stdio: 'ignore', timeout: 20000 }).status !== 0) {
    say(`コンテナのイメージ ${image}（${CONTAINER_PLATFORM}）を取得しています（初回だけ）…`);
    const pull = spawnSync(cli, ['pull', '--platform', CONTAINER_PLATFORM, image], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 10 * 60000 });
    if (pull.status !== 0) throw new Error(`イメージ ${image} を取得できませんでした（ネットにつながっているか確かめてください）`);
  }
  const name = `sandbox-be-bds-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const user = process.platform === 'linux' && process.getuid ? `${process.getuid()}:${process.getgid()}` : null;
  const ipv6Sysctl = env.SANDBOX_BE_CONTAINER_IPV6 !== '0';
  const args = containerRunArgs({ dir: abs, ports, name, image, lan, user, ipv6Sysctl });
  hookCleanup(cli);
  live.add(name);
  const child = spawn(cli, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
  child.on('close', () => live.delete(name));
  const kill = () => {
    spawnSync(cli, ['rm', '-f', name], { stdio: 'ignore', timeout: 15000 });
    live.delete(name);
    child.kill('SIGKILL');
  };
  return { child, runtime, describe: `container: ${cli} ${image} (${name})`, kill };
}

