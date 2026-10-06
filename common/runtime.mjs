// Where the server side runs: the host itself, or a Linux x86-64 container.
//   native  Linux / Windows: BDS, Endstone (Python venv) and LeviLamina (Windows; Wine on Linux) run as host processes.
//   docker  macOS (default there) or LAB_RUNTIME=docker anywhere. BDS has no macOS build, Endstone ships no macOS wheels and
//           LeviLamina is a Windows program, so the server, the venv, lip and Wine live in a small Linux image per lab. The lab
//           itself (node: build, type check, real players, debugger, tests) stays on the host.
// Every path the lab hands to the server side (cache, instances, venv, Wine prefix, the unit's sources) is bind-mounted at the
// same absolute path, so a path means the same file inside and outside the container; the server's UDP ports are published on
// 127.0.0.1, and the server reaches the lab's debugger listener as host.docker.internal.
// Works with any docker-compatible CLI: Docker Desktop, OrbStack, colima, Rancher Desktop (LAB_DOCKER=podman|nerdctl too).
// Apple Silicon: amd64 images run through Rosetta (Docker Desktop: Settings > General > "Use Rosetta"; OrbStack: always;
// colima: `colima start --vm-type vz --vz-rosetta`); without Rosetta QEMU also works, only slower.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const BASE = `FROM --platform=linux/amd64 ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libcurl4 unzip gcc libc6-dev libfaketime \\
  && rm -rf /var/lib/apt/lists/*
`;

export function makeRuntime({ flavor, CACHE, TOP, extraMounts = [], die, say = () => {} }) {
  const want = (process.env.LAB_RUNTIME || '').toLowerCase();
  const kind = want === 'docker' || want === 'native' ? want : process.platform === 'darwin' ? 'docker' : 'native';
  const docker = process.env.LAB_DOCKER || 'docker';
  const dockerfile = BASE + (flavor.dockerfile ?? '');
  const image = `bds-lab-${flavor.name}:${crypto.createHash('sha1').update(dockerfile).digest('hex').slice(0, 10)}`;
  const HOME = path.join(CACHE, 'home');
  let checked = false;

  const mountList = () => {
    const ds = [TOP, CACHE, ...extraMounts, ...(process.env.LAB_DOCKER_MOUNTS ?? '').split(path.delimiter)]
      .filter(Boolean).map((d) => path.resolve(d)).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
    const uniq = [...new Set(ds)].sort((a, b) => a.length - b.length);
    return uniq.filter((d, i) => !uniq.slice(0, i).some((p) => d === p || d.startsWith(p + path.sep)));
  };

  function ensure() {
    if (kind !== 'docker' || checked) return;
    const v = spawnSync(docker, ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
    if (v.error || v.status !== 0) {
      die([`${flavor.title ?? flavor.name}: the server runs in a Linux container here (${process.platform === 'darwin' ? 'macOS has no BDS build' : 'LAB_RUNTIME=docker'}), and \`${docker}\` is not working:`,
        `  ${(v.error?.message ?? v.stderr ?? '').trim().split('\n')[0] || 'no answer from the docker daemon'}`,
        'fix (macOS, pick one): Docker Desktop (enable "Use Rosetta for x86_64/amd64 emulation") | OrbStack | `brew install colima docker && colima start --vm-type vz --vz-rosetta`',
        '     then: node lab.mjs setup   (first run builds the lab image, a few minutes)'].join('\n'));
    }
    if (spawnSync(docker, ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
      say(`setup: building the ${flavor.name} lab image ${image} (linux/amd64, first time only)...`);
      const b = spawnSync(docker, ['build', '--platform', 'linux/amd64', '-t', image, '-'], { input: dockerfile, encoding: 'utf8', maxBuffer: 256e6 });
      if (b.status !== 0) die(`docker build failed:\n${((b.stderr || '') + (b.stdout || '')).trim().split('\n').slice(-15).join('\n')}`);
    }
    fs.mkdirSync(HOME, { recursive: true });
    checked = true;
  }

  // `docker run` for one program: same paths, host user, HOME in the cache (pip, Wine, winetricks keep their files there)
  function dockerArgs(cmd, args, { cwd = process.cwd(), env = {}, ports = [], name, interactive = false } = {}) {
    const a = ['run', '--rm', '--init', '--platform', 'linux/amd64'];
    if (interactive) a.push('-i');
    if (name) a.push('--name', name);
    if (typeof process.getuid === 'function') a.push('--user', `${process.getuid()}:${process.getgid()}`);
    a.push('--add-host', 'host.docker.internal:host-gateway', '-e', `HOME=${HOME}`);
    // the host's network setup follows the program in: a custom CA bundle (TLS-inspecting proxies) and a non-loopback proxy
    // (a loopback proxy means nothing inside the container). Without this pip in the container fails CERTIFICATE_VERIFY_FAILED
    const ca = ['SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'PIP_CERT', 'CURL_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS'].map((k) => process.env[k]).find((f) => f && fs.existsSync(f));
    if (ca) { a.push('-v', `${ca}:${ca}:ro`); for (const k of ['SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'PIP_CERT', 'CURL_CA_BUNDLE']) a.push('-e', `${k}=${ca}`); }
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy']) { const v = process.env[k]; if (v && !/\/\/(127\.|localhost|\[::1\])/.test(v)) a.push('-e', `${k}=${v}`); }
    for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== null) a.push('-e', `${k}=${v}`);
    for (const m of mountList()) a.push('-v', `${m}:${m}`);
    const w = path.resolve(cwd);
    if (!mountList().some((m) => w === m || w.startsWith(m + path.sep))) a.push('-v', `${w}:${w}`);
    a.push('-w', w);
    for (const p of ports) { const [n, proto = 'udp'] = String(p).split('/'); a.push('-p', `127.0.0.1:${n}:${n}/${proto}`); }   // UDP by default; 'N/tcp' for NetherNet signaling
    a.push(image, cmd, ...args);
    return a;
  }

  // spawnSync on the server side. opts.env = only the variables the program needs (the host's own env stays on the host)
  function run(cmd, args = [], opts = {}) {
    if (kind === 'native') return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256e6, ...opts, env: { ...process.env, ...(opts.env ?? {}) } });
    ensure();
    return spawnSync(docker, dockerArgs(cmd, args, { cwd: opts.cwd, env: opts.env }), { encoding: 'utf8', maxBuffer: 256e6, timeout: opts.timeout, input: opts.input, stdio: opts.stdio });
  }
  const has = (cmd, args = ['--version']) => { const r = run(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); return !r.error && r.status === 0; };

  // a long-running server-side process with piped stdio. child.labKill() ends it for sure (the container too)
  let seq = 0;
  function start(cmd, args = [], { cwd, env = {}, ports = [], tag = 'srv' } = {}) {
    if (kind === 'native') {
      // LAB_SERVER_NICE=n: the server's threads at a lower priority than the lab's clients (a sped-up server takes every core it
      // can get; a client thread that waits for a core longer than the server's RakNet timeout, 0.2 s at 50x, is dropped)
      const nice = process.platform === 'linux' && /^-?\d+$/.test(process.env.LAB_SERVER_NICE ?? '') && fs.existsSync('/usr/bin/nice');
      if (nice) { args = ['-n', process.env.LAB_SERVER_NICE, cmd, ...args]; cmd = '/usr/bin/nice'; }
      const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
      child.labKill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
      return child;
    }
    ensure();
    const name = `bdslab-${flavor.name}-${tag}-${process.pid}-${++seq}`.replace(/[^\w.-]/g, '_');
    const child = spawn(docker, dockerArgs(cmd, args, { cwd, env, ports, name, interactive: true }), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.labContainer = name;
    child.labKill = () => { spawnSync(docker, ['rm', '-f', name], { stdio: 'ignore', timeout: 20000 }); try { child.kill('SIGKILL'); } catch { /* gone */ } };
    return child;
  }

  return {
    kind, image, docker,
    serverOS: kind === 'docker' ? 'linux' : process.platform,   // the OS the server programs see
    serverHost: kind === 'docker' ? 'host.docker.internal' : '127.0.0.1',   // how the server reaches a lab listener
    listenHost: kind === 'docker' ? '0.0.0.0' : '127.0.0.1',   // where lab listeners bind so the server can reach them
    ensure, run, has, start, dockerArgs,
    describe: () => (kind === 'docker' ? `docker ${image} (${os.arch() === 'arm64' ? 'amd64 via Rosetta/QEMU' : 'amd64'})` : `native ${process.platform}-${os.arch()}`),
  };
}
