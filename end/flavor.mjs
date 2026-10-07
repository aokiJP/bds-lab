// end lab: Endstone plugins (Python first, C++ too), verified on a real Endstone server (BDS underneath) with real players.
// What this flavor adds to the shared engine (common/core.mjs):
//   server   a Python venv with `endstone` (pinned to the release that supports this BDS); Endstone downloads BDS itself
//   deploy   no pip install per run: each server instance gets its own entry-point metadata (dist-info) for the plugin under
//            test + the lab's helper plugin, and the plugin's src/ on the path, so edits are live and instances never mix
//   commands py (eval in the server) · events/states (Endstone's own) · trace/cov/prof on Python lines · perf · api (stubs)
//            pack (.whl built here, no build backend needed) · lib add (pip) · new (Python or --cpp)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === 'win32';
// the Endstone release line that runs this lab's BDS (0.11.11 = BDS 1.26.51); LAB_ENDSTONE overrides (e.g. "endstone==0.11.12")
const ENDSTONE = process.env.LAB_ENDSTONE || 'endstone~=0.11.11';
const exists = (f) => fs.existsSync(f);

// ---------------------------------------------------------------- pyproject.toml (the subset plugins use)
export function parseToml(text) {
  const root = {};
  let cur = root;
  const lines = text.replace(/\r/g, '').split('\n');
  const val = (s) => {
    s = s.trim();
    if (s.startsWith('"""')) return s.slice(3, s.lastIndexOf('"""'));
    if (s.startsWith('"')) return JSON.parse(s.slice(0, s.lastIndexOf('"') + 1));
    if (s.startsWith("'")) return s.slice(1, s.lastIndexOf("'"));
    if (s.startsWith('[')) { const inner = s.slice(1, s.lastIndexOf(']')); const out = []; let m; const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([\w.+-]+)/g; while ((m = re.exec(inner))) out.push(m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2] ?? m[3]); return out; }
    if (s.startsWith('{')) { const o = {}; for (const kv of s.slice(1, -1).split(',')) { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i).trim().replace(/^"|"$/g, '')] = val(kv.slice(i + 1)); } return o; }
    if (/^(true|false)$/.test(s)) return s === 'true';
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s.replace(/\s+#.*$/, '');
  };
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    const sec = /^\[([^\]]+)\]$/.exec(l);
    if (sec) { cur = root; for (const k of sec[1].match(/"[^"]*"|[^.]+/g).map((x) => x.trim().replace(/^"|"$/g, ''))) cur = cur[k] ??= {}; continue; }
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const key = l.slice(0, eq).trim().replace(/^"|"$/g, '');
    let v = l.slice(eq + 1).trim();
    if (v.startsWith('[') && !v.includes(']')) { while (++i < lines.length && !lines[i].includes(']')) v += ' ' + lines[i].trim(); v += ' ' + (lines[i] ?? '').trim(); }
    cur[key] = val(v.replace(/(^|[^"'])#[^"']*$/, '$1'));
  }
  return root;
}

// what the lab needs to know about a unit: plugin name, package, class, version (Python), or the C++ plugin's name
const META = new Map();
export function unitMeta(dir) {
  if (!dir) return null;
  const pj = path.join(dir, 'pyproject.toml'), cm = path.join(dir, 'CMakeLists.txt');
  const stamp = [pj, cm].map((f) => (exists(f) ? fs.statSync(f).mtimeMs : 0)).join();
  const hit = META.get(dir);
  if (hit && hit.stamp === stamp) return hit.m;
  let m = null;
  if (exists(pj)) {
    const t = parseToml(fs.readFileSync(pj, 'utf8'));
    const eps = t.project?.['entry-points']?.endstone ?? {};
    const [plugin, target] = Object.entries(eps)[0] ?? [];
    const [pkg, cls] = String(target ?? '').split(':');
    const src = path.join(dir, 'src', pkg ?? '');
    let prefix = null, api = null;
    for (const f of walk(src, (x) => x.endsWith('.py'))) {
      const s = fs.readFileSync(f, 'utf8');
      if (new RegExp(`class\\s+${cls}\\b`).test(s)) { prefix = /^\s+prefix\s*=\s*["']([^"']+)/m.exec(s)?.[1] ?? null; api = /^\s+api_version\s*=\s*["']([^"']+)/m.exec(s)?.[1] ?? null; }
    }
    m = { kind: 'py', dist: t.project?.name, version: String(t.project?.version ?? '0.1.0'), deps: t.project?.dependencies ?? [], plugin, pkg, cls, prefix, api, src: path.join(dir, 'src') };
  } else if (exists(cm)) {
    let plugin = null, version = '0.1.0';
    for (const f of walk(path.join(dir, 'src'), (x) => /\.(cpp|cc|cxx|h|hpp)$/.test(x))) { const r = /ENDSTONE_PLUGIN\(\s*"([^"]+)"\s*,\s*"([^"]+)"/.exec(fs.readFileSync(f, 'utf8')); if (r) { plugin = r[1]; version = r[2]; } }
    const proj = /project\(\s*([\w-]+)/.exec(fs.readFileSync(cm, 'utf8'))?.[1];
    m = { kind: 'cpp', plugin, version, target: proj ?? `endstone_${plugin}`, src: path.join(dir, 'src') };
  }
  META.set(dir, { stamp, m });
  return m;
}
function walk(d, pred = () => true, acc = []) {
  if (!exists(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '__pycache__') walk(p, pred, acc); } else if (pred(p)) acc.push(p); }
  return acc;
}
const pascal = (n) => n.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

// ---------------------------------------------------------------- Python environment (venv in the cache)
const venv = (L) => path.join(L.CACHE, 'py');
const vbin = (L, n) => path.join(venv(L), WIN ? 'Scripts' : 'bin', n + (WIN ? '.exe' : ''));
function findPython(L) {   // L given: the Python the server side has (the container's on macOS); else the host's
  const tries = [process.env.LAB_PYTHON, ...(WIN ? ['py -3.13', 'py -3.12', 'py -3.11', 'python'] : ['python3.13', 'python3.12', 'python3.11', 'python3.14', 'python3', 'python'])].filter(Boolean);
  for (const t of tries) {
    const [cmd, ...a] = t.split(' ');
    const r = L ? L.RT.run(cmd, [...a, '-c', 'import sys;print("%d.%d"%sys.version_info[:2])']) : spawnSync(cmd, [...a, '-c', 'import sys;print("%d.%d"%sys.version_info[:2])'], { encoding: 'utf8' });
    const v = r.status === 0 ? r.stdout.trim() : '';
    if (v && Number(v.split('.')[1]) >= 10 && v.startsWith('3.')) return { cmd, args: a, v };
  }
  return null;
}
function pip(L, args) {
  const r = L.RT.run(vbin(L, 'python'), ['-m', 'pip', ...args, '--disable-pip-version-check', '-q']);
  if (r.status !== 0) {
    const out = (r.stderr || r.stdout).trim();
    // "(from versions: none)" = pip saw no index at all (no network / blocked proxy) or no wheel for this Python/OS; say which to check
    const hint = /from versions: none/.test(out) ? `\n(pip found no versions at all: the network to pypi.org is blocked, or no Endstone wheel exists for Python ${pyOut(L, 'import sys;print("%d.%d"%sys.version_info[:2])') || '?'} on ${process.platform}-${process.arch}. A blocked network is not fixable in code: ask a person)` : '';
    L.die(`pip ${args.join(' ')} failed:\n${out.split('\n').slice(-8).join('\n')}${hint}`);
  }
  return r;
}
const pyOut = (L, code) => { const r = L.RT.run(vbin(L, 'python'), ['-c', code]); return r.status === 0 ? r.stdout.trim() : ''; };
// no usable Python 3.10+ with venv on this machine (Windows without Python, Ubuntu without python3-venv, no root to install it):
// a portable CPython 3.12 (python-build-standalone) once into the cache. Sync: a child node downloads (proxy/CA as the lab's).
function fetchToFile(url, file) {
  const tok = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const r = spawnSync(process.execPath, ['-e', `fetch(process.argv[1],{headers:{'user-agent':'bds-lab',...(process.argv[3]&&/api\\.github\\.com/.test(process.argv[1])?{authorization:'Bearer '+process.argv[3]}:{})}}).then(async(r)=>{if(!r.ok)throw new Error(r.status+' '+(r.headers.get('x-deny-reason')||''));require('fs').writeFileSync(process.argv[2],Buffer.from(await r.arrayBuffer()))}).catch((e)=>{console.error(e.cause?.code||e.message);process.exit(1)})`, url, file, tok], { encoding: 'utf8', env: process.env });
  return r.status === 0 ? null : (r.stderr || 'failed').trim();
}
function portablePython(L) {
  if (L.RT.kind === 'docker' || process.env.LAB_PORTABLE_PYTHON === '0') return null;
  const dir = path.join(L.CACHE, 'pyhome'), exe = WIN ? path.join(dir, 'python', 'python.exe') : path.join(dir, 'python', 'bin', 'python3');
  if (exists(exe)) return { cmd: exe, args: [], v: '3.12', portable: true };
  const triple = { 'linux-x64': 'x86_64-unknown-linux-gnu', 'linux-arm64': 'aarch64-unknown-linux-gnu', 'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc' }[`${process.platform}-${process.arch}`];
  if (!triple) return null;
  L.out('setup: no Python 3.10+ with venv here: fetching a portable Python 3.12 into .lab/pyhome (once, ~30 MB, no admin needed)');
  fs.mkdirSync(dir, { recursive: true });
  const relf = path.join(dir, 'release.json'), tgz = path.join(dir, 'python.tar.gz');
  let err = fetchToFile(process.env.LAB_PYTHON_RELEASE || 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest', relf);
  if (err) { L.out(`W portable Python: GitHub API ${err}`); return null; }
  const a = (JSON.parse(fs.readFileSync(relf, 'utf8')).assets ?? []).find((x) => new RegExp(`^cpython-3\\.12\\.\\d+\\+\\d+-${triple}-install_only\\.tar\\.gz$`).test(x.name));
  if (!a) { L.out(`W portable Python: no 3.12 build for ${triple} in the latest release`); return null; }
  err = fetchToFile(a.browser_download_url, tgz);
  if (err) { L.out(`W portable Python: ${err}`); return null; }
  const t = spawnSync('tar', ['-xzf', tgz, '-C', dir], { encoding: 'utf8' });
  fs.rmSync(tgz, { force: true });
  return t.status === 0 && exists(exe) ? { cmd: exe, args: [], v: '3.12', portable: true } : null;
}
function ensureVenv(L) {
  // a venv belongs to the runtime that made it (host python vs the lab container's): after a LAB_RUNTIME switch it may not run
  // there (its python links to the other side's interpreter, or runs but is another Python version than its lib/pythonX.Y).
  // The stamp only says when to check; a venv that still works here is kept (a rebuild needs PyPI), a broken one is rebuilt
  // Checked every time, not only after a runtime switch: the Python it links to can go while the folder stays (an OS or
  // toolcache update, a restored CI cache from a runner with another 3.x.y) — its python is then a dangling link, which
  // existsSync calls missing, and a venv made again on top of the broken one fails
  const stamp = path.join(venv(L), '.lab-runtime'), want = L.RT.kind === 'docker' ? 'docker:' + L.RT.image : 'native';
  if (exists(venv(L))) {
    const works = L.RT.run(vbin(L, 'python'), ['-c', WIN ? '1' : "import sys,os;assert os.path.isdir(os.path.join(sys.prefix,'lib','python%d.%d'%sys.version_info[:2]))"]).status === 0;
    if (works) { if (!exists(stamp) || fs.readFileSync(stamp, 'utf8') !== want) fs.writeFileSync(stamp, want); }
    else { L.out(`setup: the Python venv does not run here (${want}; its Python is gone or another one): making it again`); fs.rmSync(venv(L), { recursive: true, force: true }); }
  }
  if (exists(vbin(L, 'python')) && exists(vbin(L, 'endstone'))) { if (!exists(stamp)) fs.writeFileSync(stamp, want); return; }
  let py = findPython(L) ?? portablePython(L) ?? L.die('Endstone needs Python 3.10+ (3.11+ recommended): install it (Linux: apt install python3 python3-venv; Windows: python.org; macOS: runs in the lab container, rebuild it: docker rmi ' + L.RT.image + ') or set LAB_PYTHON');
  if (!exists(vbin(L, 'python'))) {
    let r = L.RT.run(py.cmd, [...py.args, '-m', 'venv', venv(L)]);
    // Debian/Ubuntu's python3 without python3-venv (and no root to add it): the portable Python has venv built in
    if (r.status !== 0 && !py.portable) { const pp = portablePython(L); if (pp) { fs.rmSync(venv(L), { recursive: true, force: true }); py = pp; r = L.RT.run(py.cmd, [...py.args, '-m', 'venv', venv(L)]); } }
    if (r.status !== 0) L.die(`python -m venv failed (Debian/Ubuntu: apt install python${py.v}-venv):\n${(r.stderr || r.stdout).slice(-600)}`);
  }
  pip(L, ['install', ENDSTONE]);
  // the lab puts each server instance's plugin + helper on sys.path through LAB_PYPATH (read by this .pth at interpreter start):
  // works even if the embedded interpreter ignores PYTHONPATH
  const site = pyOut(L, 'import sysconfig;print(sysconfig.get_paths()["purelib"])');
  fs.writeFileSync(stamp, want);
  if (site) fs.writeFileSync(path.join(site, 'bdslab_paths.pth'), 'import os, sys; sys.path[0:0] = [p for p in os.environ.get("LAB_PYPATH", "").split(os.pathsep) if p and p not in sys.path]\n');
}
const pyVer = (L) => (/^python(3\.\d+)$/.exec((() => { try { return fs.readdirSync(path.join(venv(L), 'lib')).find((d) => /^python3\.\d+$/.test(d)) ?? ''; } catch { return ''; } })()) ?? [])[1];
const endstoneVersion = (L) => pyOut(L, 'from importlib.metadata import version;print(version("endstone"))');

// Endstone downloads the BDS build it supports into --server-folder on its first start: do that once into the cache, then stop
async function bootstrapServer(L) {
  fs.mkdirSync(L.BDS, { recursive: true });
  // a BDS zip given to the lab (blocked CDN): put it in the server folder first. Endstone uses a folder that already holds
  // the build it supports; if the zip is another build it downloads its own (then the network is needed after all)
  const given = process.env.LAB_BDS_ZIP;
  if (given && !/^https?:/.test(given) && exists(given) && !exists(path.join(L.BDS, WIN ? 'bedrock_server.exe' : 'bedrock_server'))) {
    L.out(`setup: unpacking LAB_BDS_ZIP (${path.basename(given)}) for Endstone`);
    L.unzip(fs.readFileSync(given), L.BDS);
  }
  L.out(`setup: Endstone ${endstoneVersion(L)} is downloading the Bedrock Dedicated Server it supports (first time only)...`);
  const child = L.RT.start(vbin(L, 'endstone'), ['--server-folder', L.BDS, '--no-confirm', '--no-interactive'], { cwd: L.BDS, env: { ENDSTONE_USE_INTERACTIVE_CONSOLE: '0', PYTHONUNBUFFERED: '1' }, tag: 'bootstrap' });
  let log = '', started = false;
  const onData = (d) => { log += d; if (!started && /Server started|LAB_READY/.test(log)) { started = true; child.stdin.write('stop\n'); } };
  child.stdout.setEncoding('utf8').on('data', onData);
  child.stderr.setEncoding('utf8').on('data', onData);
  const code = await new Promise((res) => { child.on('exit', res); setTimeout(() => { L.killTree(child); res('timeout'); }, 20 * 60000); });
  const exe = path.join(L.BDS, WIN ? 'bedrock_server.exe' : 'bedrock_server');
  if (!exists(exe)) L.die(`Endstone did not install BDS into ${L.rel(L.BDS)} (exit ${code}):\n${log.trim().split('\n').slice(-15).join('\n')}`);
  if (!WIN) fs.chmodSync(exe, 0o755);
  let ver = /\b(1\.\d+\.\d+\.\d+)\b/.exec(exists(path.join(L.BDS, 'release-notes.txt')) ? fs.readFileSync(path.join(L.BDS, 'release-notes.txt'), 'utf8') : '')?.[1]
    ?? /Version:?\s*v?(1\.\d+\.\d+\.\d+)/i.exec(log)?.[1] ?? /(1\.\d+\.\d+\.\d+)/.exec(log)?.[1] ?? '1.26.51.1';
  fs.rmSync(path.join(L.BDS, 'worlds'), { recursive: true, force: true });
  fs.writeFileSync(path.join(L.BDS, 'VERSION'), `${ver}\nendstone ${endstoneVersion(L)}\n`);
}

// ---------------------------------------------------------------- deploy: entry-point metadata per instance
function distInfo(dir, dist, version, ep, target, summary = '') {
  const norm = dist.replace(/[-.]+/g, '_');
  const d = path.join(dir, `${norm}-${version}.dist-info`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'METADATA'), `Metadata-Version: 2.1\nName: ${dist}\nVersion: ${version}\n${summary ? `Summary: ${summary}\n` : ''}`);
  fs.writeFileSync(path.join(d, 'entry_points.txt'), `[endstone]\n${ep} = ${target}\n`);
  fs.writeFileSync(path.join(d, 'INSTALLER'), 'bds-lab\n');
}
function cppLib(L, m) {
  const dir = path.join(L.CACHE, 'build', path.basename(L.ADDON));
  return walk(dir, (f) => new RegExp(`${m.target}\\.(so|dll)$`).test(f))[0] ?? null;
}

// ---------------------------------------------------------------- talking to the helper plugin (scriptevent lab:py <base64 json>)
async function py(L, eng, req, waitMs = 30000) {
  if (!eng.srv || eng.srv.exited) return false;
  if (!L.LOG.slice(eng.bootMark ?? 0).some((l) => l.includes('LAB_PY_READY'))) { L.LOG.push('[0-0-0 0:0:0 ERROR] py: the lab helper plugin did not load (errors above)'); return true; }
  const b64 = Buffer.from(JSON.stringify(req)).toString('base64'), parts = b64.match(/.{1,1500}/g) ?? [''];
  const done = eng.srv.wait(/LAB_PY_DONE/, waitMs);
  parts.forEach((p, i) => eng.srv.send(`scriptevent ${i < parts.length - 1 ? 'lab:pyp' : 'lab:py'} ${p}`));
  if (!(await done)) L.LOG.push(`[0-0-0 0:0:0 ERROR] py: no answer in ${waitMs / 1000}s (server busy or crashed?)`);
  await L.sleep(40);
  return true;
}
const hasBpScripts = (L) => walk(path.join(L.BP, 'scripts'), (f) => /\.[cm]?js$/.test(f)).length > 0;
// ---------------------------------------------------------------- packets: raw payloads from Endstone, decoded on the host
// with the same protocol tables the real player uses (bedrock-protocol / minecraft-data for this BDS)
const NOISY = 'level_chunk subchunk move_entity move_entity_delta set_entity_motion set_entity_data update_attributes level_sound_event network_chunk_publisher_update player_auth_input set_time network_stack_latency level_event update_subchunk_blocks biome_definition_list tick_sync';
let PKD = null;
async function pkDecoder(L) {
  if (PKD) return PKD;
  PKD = { names: {}, ids: {}, parse: null };
  if (process.env.LAB_PK_DECODE === '0') return PKD;
  try {
    const { req, ver } = await L.realDeps();
    const md = createRequire(req.resolve('bedrock-protocol'))('minecraft-data')('bedrock_' + ver);
    PKD.names = md.protocol.types.mcpe_packet[1][0].type[1].mappings ?? {};
    for (const [id, n] of Object.entries(PKD.names)) PKD.ids[n.replace(/^packet_/, '')] = Number(id);
    try {
      const d = req('bedrock-protocol/src/transforms/serializer').createDeserializer(ver);
      const vi = (v) => { const b = []; do { let x = v & 0x7f; v >>>= 7; if (v) x |= 0x80; b.push(x); } while (v); return Buffer.from(b); };
      PKD.parse = (id, hex) => d.parsePacketBuffer(Buffer.concat([vi(id), Buffer.from(hex, 'hex')])).data.params;
    } catch { /* names only */ }
  } catch { /* no tables: ids and hex */ }
  return PKD;
}
const pkName = (id) => (PKD?.names?.[id] ?? `#${id}`).replace(/^packet_/, '');
const pkId = (x) => (/^\d+$/.test(x) ? Number(x) : PKD?.ids?.[x.replace(/^packet_/, '')]);
function pkLine(line) {
  const m = /LAB_PK ([<>]) (\S+) (\d+) ([0-9a-f]*)$/.exec(line);
  if (!m) return null;
  const id = Number(m[3]);
  let body = `${m[4].length / 2}B`;
  if (PKD?.parse) try { body = JSON.stringify(PKD.parse(id, m[4]), (k, v) => (typeof v === 'bigint' ? String(v) : v?.type === 'Buffer' ? `<${v.data.length}B>` : v)).slice(0, 300); } catch { body += ' ' + m[4].slice(0, 64); }
  else body += ' ' + m[4].slice(0, 64);
  return line.slice(0, m.index) + `PK ${m[2]}${m[1]} ${pkName(id)} ${body}`;   // A> = from the client, A< = to the client
}

function pyTarget(L, spec) {
  const r = /^(.+\.py):(\d+)$/.exec(spec ?? '');
  if (!r) return null;
  const f = [path.resolve(L.ADDON, r[1]), path.resolve(r[1]), path.resolve(L.ADDON, 'src', r[1])].find(exists);
  return f ? { file: f, line: Number(r[2]) } : { err: `${r[1]} not found (paths are relative to the plugin folder, e.g. src/endstone_x/plugin.py:12)` };
}

// ---------------------------------------------------------------- checks before the server starts
async function pyChecks(L, opts) {
  const errs = [], warns = [], hints = [];
  const m = unitMeta(L.ADDON);
  if (!m) return { errs, warns, hints };
  if (m.kind === 'cpp') return cppBuild(L, m);
  if (!m.dist?.startsWith('endstone-')) warns.push(`pyproject.toml: [project] name should be "endstone-<name>" (Endstone's convention; got ${m.dist})`);
  if (!m.plugin) { errs.push('pyproject.toml: no [project.entry-points."endstone"] entry (name = "endstone_x:ClassName")'); return { errs, warns, hints }; }
  if (!/^[a-z0-9_]+$/.test(m.plugin)) errs.push(`pyproject.toml: plugin name "${m.plugin}" must be lowercase letters, digits and _ (Endstone rejects others)`);
  if (!m.pkg || !exists(path.join(m.src, m.pkg, '__init__.py'))) errs.push(`src/${m.pkg}/__init__.py missing (the entry point imports ${m.pkg})`);
  else if (!new RegExp(`\\b${m.cls}\\b`).test(fs.readFileSync(path.join(m.src, m.pkg, '__init__.py'), 'utf8'))) errs.push(`src/${m.pkg}/__init__.py does not export ${m.cls} (entry point ${m.pkg}:${m.cls})`);
  if (!m.api) errs.push(`${m.cls}: set api_version = "0.11" (Endstone refuses plugins without it)`);
  else if (!/^0\.\d+$/.test(m.api)) warns.push(`${m.cls}: api_version "${m.api}" should be "major.minor" like "0.11"`);
  // things that break at runtime without a word from the type checker
  const RULES = [
    [/\btime\.sleep\(/, 'time.sleep blocks the server thread (every player freezes): self.server.scheduler.run_task(self, fn, delay=ticks)'],
    [/threading\.Thread\(/, 'the Endstone API is not thread-safe: a thread touches only its own data and hands results back with self.server.scheduler.run_task(self, fn) (or use endstone.asyncio). A thread that does so (an HTTP server reading a snapshot): end this line with `# lab: ok (why)`'],
    [/\brequests\.(get|post)\(/, 'a blocking HTTP call on the server thread: run it in endstone.asyncio.submit(...) or a thread, then run_task back (already off the server thread: end this line with `# lab: ok (why)`)'],
    [/def on_command\([^)]*\)\s*(->\s*None)?\s*:/, 'on_command should return True when handled (False prints the usage)'],
  ];
  for (const f of walk(m.src, (x) => x.endsWith('.py'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { for (const [re, msg] of RULES) if (re.test(l) && !/#\s*lab:\s*ok/.test(l)) warns.push(`${L.rel(f)}:${i + 1} ${msg}`); });
  }
  if (errs.length) return { errs, warns, hints };
  // the PyPI packages pyproject declares and the lab venv lacks (a sample, someone else's plugin, a hand-edited pyproject): pip
  // installs them now, once (before, only `lib add` did: the plugin then failed to load with a Python traceback)
  if (m.deps.length && exists(vbin(L, 'python'))) {
    const names = m.deps.map((d) => d.split(/[=<>~! [;]/)[0]).filter(Boolean);
    const have = pyOut(L, `import importlib.metadata as M, json\nr = []\nfor n in ${JSON.stringify(names)}:\n    try: M.version(n); r.append(n)\n    except Exception: pass\nprint(json.dumps(r))`);
    let got = []; try { got = JSON.parse(have || '[]'); } catch { /* none */ }
    const need = m.deps.filter((d, i) => !got.includes(names[i]));
    if (need.length) { pip(L, ['install', ...need]); hints.push(`installed from pyproject: ${need.join(' ')}`); }
  }
  // syntax, then types (pyright against Endstone's own stubs in the lab venv)
  // (a container start costs ~1 s: on macOS the host's own python3 parses when there is one)
  const host = L.RT.kind === 'docker' || !exists(vbin(L, 'python')) ? findPython() : null;
  const pyRun = host ? (a) => spawnSync(host.cmd, [...host.args, ...a], { encoding: 'utf8', maxBuffer: 64e6 }) : exists(vbin(L, 'python')) ? (a) => L.RT.run(vbin(L, 'python'), a) : null;
  if (pyRun) {
    const files = walk(m.src, (x) => x.endsWith('.py'));
    const r = pyRun(['-c', 'import sys,ast,json\nfor f in sys.argv[1:]:\n  try: ast.parse(open(f,encoding="utf-8").read(),f)\n  except SyntaxError as e: print(json.dumps([f,e.lineno,e.msg]))', ...files]);
    for (const l of (r.stdout || '').trim().split('\n').filter(Boolean)) { const [f, ln, msg] = JSON.parse(l); errs.push(`${L.rel(f)}:${ln} SyntaxError: ${msg}`); }
  }
  if (errs.length || opts.types === false || process.env.LAB_PY_TYPES === '0') return { errs, warns, hints };
  try {
    const pr = pyright(L);
    if (pr && exists(vbin(L, 'python'))) {
      // native: pyright asks the venv's python for its paths. Container venv (macOS): pyright cannot run that Linux python,
      // so it reads the venv's site-packages directly (venvPath/venv in a generated config)
      const srcs = walk(m.src, (x) => x.endsWith('.py'));
      let a = ['--outputjson', '--pythonpath', vbin(L, 'python'), ...srcs];
      if (L.RT.kind === 'docker') {
        const cfg = path.join(L.CACHE, 'pytool', `pyright-${path.basename(L.ADDON)}.json`);
        L.writeJson(cfg, { include: [m.src], venvPath: L.CACHE, venv: 'py', pythonPlatform: 'Linux', ...(pyVer(L) ? { pythonVersion: pyVer(L) } : {}) });
        a = ['--outputjson', '-p', cfg];
      }
      const r = spawnSync(process.execPath, [pr, ...a], { encoding: 'utf8', maxBuffer: 64e6, cwd: L.ADDON });
      const j = JSON.parse(r.stdout || '{}');
      for (const d of j.generalDiagnostics ?? []) {
        const line = `${L.rel(d.file)}:${d.range.start.line + 1} ${d.message.replace(/\s+/g, ' ').slice(0, 300)}${d.rule ? ` (${d.rule})` : ''}`;
        if (d.severity === 'error') (process.env.LAB_PY_TYPES === 'warn' ? hints : errs).push(line); else if (d.severity === 'warning') hints.push(line);
      }
    }
  } catch (e) { warns.push('type check unavailable (' + String(e.message).split('\n')[0] + ')'); }
  return { errs, warns, hints };
}
// pyright (npm), installed once into the cache
function pyright(L) {
  const dir = path.join(L.CACHE, 'pytool'), main = path.join(dir, 'node_modules', 'pyright', 'index.js');
  if (exists(main)) return main;
  const fail = path.join(dir, 'failed');
  if (exists(fail) && Date.now() - fs.statSync(fail).mtimeMs < 3600e3) throw new Error('pyright could not be installed (retry in an hour, or delete ' + fail + ')');
  fs.mkdirSync(dir, { recursive: true });
  if (!exists(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['i', 'pyright@1', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, encoding: 'utf8', shell: WIN });
  if (r.status !== 0) { fs.writeFileSync(fail, ''); throw new Error('npm i pyright failed (offline?)'); }
  return main;
}
// C++ plugins: CMake + Endstone's endstone_add_plugin (clang + libc++ on Linux, MSVC on Windows)
function cppBuild(L, m) {
  const errs = [], warns = [], hints = [];
  if (!m.plugin) errs.push('no ENDSTONE_PLUGIN("name", "version", Class) in src/');
  if (!L.RT.has('cmake')) { errs.push('C++ plugins need cmake (and clang + libc++ on Linux, MSVC on Windows). Python plugins need none: node lab.mjs new <name>'); return { errs, warns, hints }; }
  const out = path.join(L.CACHE, 'build', path.basename(L.ADDON));
  const env = {};
  if (!WIN && !process.env.CXX && L.RT.has('clang++')) Object.assign(env, { CC: 'clang', CXX: 'clang++' });
  const gen = L.RT.has('ninja') ? ['-G', 'Ninja'] : [];
  let r = L.RT.run('cmake', ['-S', L.ADDON, '-B', out, ...gen, '-DCMAKE_BUILD_TYPE=Release'], { env });
  if (r.status === 0) r = L.RT.run('cmake', ['--build', out, '--config', 'Release', '-j'], { env });
  if (r.status !== 0) {
    const text = (r.stdout || '') + (r.stderr || '');
    const es = [...text.matchAll(/^(.+?):(\d+):(?:\d+:)?\s*(?:fatal )?error:?\s*(.*)$|^(.+?)\((\d+)(?:,\d+)?\):\s*error\s*\w*:\s*(.*)$/gm)].slice(0, 15).map((x) => `${L.rel(path.resolve(x[1] ?? x[4]))}:${x[2] ?? x[5]} ${x[3] ?? x[6]}`);
    errs.push(...(es.length ? es : ['C++ build failed:\n' + text.trim().split('\n').slice(-12).join('\n')]));
  } else if (!cppLib(L, m)) errs.push(`built, but no ${m.target}.so/.dll in ${L.rel(out)}`);
  return { errs, warns, hints };
}

// ---------------------------------------------------------------- Endstone API lookup from its own stubs (.pyi) in the venv
function pyApi(L, q) {
  const root = pyOut(L, 'import endstone,os;print(os.path.dirname(endstone.__file__))');
  if (!root) L.die('api: the lab venv has no endstone yet: node lab.mjs setup');
  const idx = path.join(L.CACHE, 'pyapi.json');
  let map;
  if (exists(idx) && JSON.parse(fs.readFileSync(idx, 'utf8')).v === endstoneVersion(L) + '+3') map = JSON.parse(fs.readFileSync(idx, 'utf8')).map;
  else {
    map = {};
    for (const f of walk(root, (x) => x.endsWith('.pyi')).concat(walk(root, (x) => x.endsWith('.py') && !x.includes('_internal')))) {
      const mod = ['endstone', ...path.relative(root, f).replace(/\.pyi?$/, '').split(/[\\/]/).filter((x) => x !== '__init__')].join('.');
      const raw = fs.readFileSync(f, 'utf8').replace(/"""[\s\S]*?"""/g, '').split('\n'), lines = [];
      // a signature over several lines (`def create_boss_bar(\n  self, title: str, ...\n) -> BossBar:`) becomes one
      for (let i = 0; i < raw.length; i++) { let l = raw[i]; if (/^\s*def \w+\(/.test(l) && !/\)\s*(->.*)?:\s*(\.\.\.)?\s*$/.test(l)) { while (i + 1 < raw.length && !/\)\s*(->.*)?:\s*(\.\.\.)?\s*$/.test(l)) l += ' ' + raw[++i].trim(); l = l.replace(/\(\s+/, '(').replace(/,?\s+\)/, ')'); } lines.push(l); }
      let cls = null, body = [], deco = '';
      const flush = () => { if (cls && !map[cls.name]) map[cls.name] = { mod, head: cls.head, body }; cls = null; body = []; };
      for (const l of lines) {
        const c = /^class (\w+)(\(.*\))?:/.exec(l);
        if (c) { flush(); if (!c[1].startsWith('_')) cls = { name: c[1], head: `class ${c[1]}${c[2] ?? ''}  # ${mod}` }; continue; }
        if (/^\S/.test(l) && !/^@/.test(l)) flush();
        if (!cls) continue;
        const d = /^ {4}@(\w+(?:\.\w+)?)/.exec(l);
        if (d) { deco = d[1]; continue; }
        const def = /^ {4}def (\w+)\((.*)\)(?:\s*->\s*(.+?))?:/.exec(l);
        if (def && (!def[1].startsWith('_') || def[1] === '__init__')) {
          const args = def[2].replace(/\bself,?\s*/, '').replace(/\s+/g, ' ');
          if (deco === 'property') body.push(`  ${def[1]}: ${def[3] ?? '?'}`);
          else if (!/\.setter$/.test(deco)) body.push(`  ${def[1]}(${args}) -> ${def[3] ?? 'None'}`);
          deco = '';
          continue;
        }
        const attr = /^ {4}(\w+)\s*:\s*(.+?)(\s*=.*)?$/.exec(l) ?? /^ {4}([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/.exec(l);
        if (attr && !attr[1].startsWith('_')) body.push(`  ${attr[1]}: ${attr[2]}`);
      }
      flush();
    }
    fs.writeFileSync(idx, JSON.stringify({ v: endstoneVersion(L) + '+3', map }));
  }
  if (q.startsWith('?')) {
    const w = q.slice(1).toLowerCase(), hits = [];
    for (const [n, c] of Object.entries(map)) { if (n.toLowerCase().includes(w)) hits.push(n); for (const b of c.body) { const k = /^\s+(\w+)/.exec(b)?.[1]; if (k && k.toLowerCase().includes(w)) hits.push(`${n}.${k}`); } }
    L.out(hits.length ? [...new Set(hits)].slice(0, 60).join(' ') : 'none');
    return hits.length > 0;
  }
  const [name, member] = q.split('.');
  const c = map[name];
  if (!c) { L.out(`none: ${name}. similar: ${Object.keys(map).filter((k) => k.toLowerCase().includes(name.toLowerCase())).slice(0, 15).join(' ') || '-'}`); return false; }
  const base = (n) => /\((\w+)/.exec(map[n]?.head ?? '')?.[1];
  if (!member) {
    const out = [c.head, ...new Set(c.body)];
    for (let b = base(name), seen = new Set(); b && map[b] && !seen.has(b); b = base(b)) { seen.add(b); out.push(`  # from ${b}: ${map[b].body.map((x) => /^\s+(\w+)/.exec(x)?.[1]).join(' ')}`); }
    L.out(out.join('\n'));
    return true;
  }
  for (let n = name, seen = new Set(); n && map[n] && !seen.has(n); n = base(n)) {
    seen.add(n);
    const ls = map[n].body.filter((b) => /^\s+(\w+)/.exec(b)?.[1] === member);
    if (ls.length) { L.out(`${c.head}${n !== name ? ` (from ${n})` : ''}\n${ls.join('\n')}`); return true; }
  }
  L.out(`none: ${q}. members: ${c.body.map((b) => /^\s+(\w+)/.exec(b)?.[1]).join(' ')}`);
  return false;
}

// ---------------------------------------------------------------- wheel (.whl) written here: a zip + dist-info with RECORD hashes
function wheel(L, m) {
  const norm = m.dist.replace(/[-.]+/g, '_'), di = `${norm}-${m.version}.dist-info`;
  const entries = [];
  const add = (name, data) => entries.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  for (const f of walk(path.join(m.src, m.pkg), (x) => !/\.pyc$/.test(x))) add(path.relative(m.src, f).split(path.sep).join('/'), fs.readFileSync(f));
  const summary = /description\s*=\s*"([^"]*)"/.exec(fs.readFileSync(path.join(L.ADDON, 'pyproject.toml'), 'utf8'))?.[1] ?? '';
  add(`${di}/METADATA`, `Metadata-Version: 2.1\nName: ${m.dist}\nVersion: ${m.version}\n${summary ? `Summary: ${summary}\n` : ''}Requires-Python: >=3.10\n${m.deps.map((d) => `Requires-Dist: ${d}\n`).join('')}`);
  add(`${di}/WHEEL`, 'Wheel-Version: 1.0\nGenerator: bds-lab\nRoot-Is-Purelib: true\nTag: py3-none-any\n');
  add(`${di}/entry_points.txt`, `[endstone]\n${m.plugin} = ${m.pkg}:${m.cls}\n`);
  const rec = entries.map((e) => `${e.name},sha256=${crypto.createHash('sha256').update(e.data).digest('base64url')},${e.data.length}`);
  add(`${di}/RECORD`, [...rec, `${di}/RECORD,,`].join('\n') + '\n');
  const file = path.join(L.ROOT, 'dist', `${norm}-${m.version}-py3-none-any.whl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, L.zip(entries));
  return file;
}

// ---------------------------------------------------------------- new: a Python plugin (default) or a C++ one
function scaffold(L, args) {
  const desc0 = args.find((a) => a.startsWith('desc='))?.slice(5).trim() || null;   // desc="what server owners read in plugin lists"
  const [name, title0, ...req] = args.filter((a) => !a.startsWith('--') && !a.startsWith('desc='));
  if (!/^[a-z][a-z0-9_]*$/.test(name ?? '')) L.die('usage: node lab.mjs new <name: a-z0-9_> ["Title"] ["<request>"] [desc="<what it does>"] [--cpp] [--bp] [--no-rp]   (the name is the Endstone plugin name)');
  const title = title0 ?? name, dir = path.join(L.ADDONS, name), desc = (desc0 ?? title).replace(/"/g, "'");
  if (exists(dir)) L.die(`plugins/${name} exists (node lab.mjs use ${name})`);
  const Cls = pascal(name), dash = name.replace(/_/g, '-'), put = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  if (args.includes('--cpp')) {
    put('CMakeLists.txt', `cmake_minimum_required(VERSION 3.15)\nproject(endstone_${name} CXX)\nset(CMAKE_CXX_STANDARD 20)\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\n\ninclude(FetchContent)\nFetchContent_Declare(endstone GIT_REPOSITORY https://github.com/EndstoneMC/endstone.git GIT_TAG v0.11.11)\nFetchContent_MakeAvailable(endstone)\n\nendstone_add_plugin(\${PROJECT_NAME} src/${name}.cpp)\n`);
    put(`src/${name}.cpp`, `#include <endstone/endstone.hpp>\n\nclass ${Cls} : public endstone::Plugin {\npublic:\n    void onEnable() override\n    {\n        getLogger().info("${name} enabled");\n        registerEvent(&${Cls}::onPlayerJoin, *this);\n    }\n\n    bool onCommand(endstone::CommandSender &sender, const endstone::Command &command, const std::vector<std::string> &args) override\n    {\n        if (command.getName() == "${name}") {\n            sender.sendMessage("${title} works");\n        }\n        return true;\n    }\n\n    void onPlayerJoin(endstone::PlayerJoinEvent &event)\n    {\n        event.getPlayer().sendMessage("Welcome, " + event.getPlayer().getName());\n    }\n};\n\nENDSTONE_PLUGIN("${name}", "0.1.0", ${Cls})\n{\n    description = "${desc}";\n    command("${name}").description("${title}").usages("/${name}").permissions("${name}.command.${name}");\n    permission("${name}.command.${name}").description("Use /${name}").default_(endstone::PermissionDefault::True);\n}\n`);
    put('.gitignore', 'build/\n');
  } else {
    put('pyproject.toml', `[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n\n[project]\nname = "endstone-${dash}"\nversion = "0.1.0"\ndescription = "${desc}"\nrequires-python = ">=3.10"\ndependencies = []\n\n[project.entry-points."endstone"]\n${name} = "endstone_${name}:${Cls}"\n\n[tool.hatch.build.targets.wheel]\npackages = ["src/endstone_${name}"]\n`);
    put(`src/endstone_${name}/__init__.py`, `from .plugin import ${Cls}\n\n__all__ = ["${Cls}"]\n`);
    put(`src/endstone_${name}/plugin.py`, `from endstone.command import Command, CommandSender\nfrom endstone.event import PlayerJoinEvent, event_handler\nfrom endstone.plugin import Plugin\n\n\nclass ${Cls}(Plugin):\n    api_version = "0.11"\n    prefix = "${Cls}"\n\n    commands = {\n        "${name}": {"description": "${title}", "usages": ["/${name}"], "permissions": ["${name}.command.${name}"]},\n    }\n    permissions = {\n        "${name}.command.${name}": {"description": "Use /${name}", "default": True},\n    }\n\n    def on_enable(self) -> None:\n        self.register_events(self)\n        self.logger.info("${name} enabled")\n\n    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:\n        if command.name == "${name}":\n            sender.send_message("${title} works")\n        return True\n\n    @event_handler\n    def on_player_join(self, event: PlayerJoinEvent) -> None:\n        event.player.send_message(f"Welcome, {event.player.name}")\n`);
    put('.gitignore', '__pycache__/\n*.pyc\n');
  }
  put('tests.txt', `# command, then expectations: = exact line | ~ regex | ! absent | !~ absent regex; '## title' = section\n## loads\n${args.includes('--cpp') ? `py server.plugin_manager.get_plugin('${name}').is_enabled` : 'py plugin.is_enabled'}\n= True\n## the command answers a player\n@A join\n@A cmd ${name}\n~ ^@A .*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} works\n`);
  put('TASK.md', L.TASK_MD(title, req.join(' ')));
  if (args.includes('--bp')) {
    const eng = L.bdsVersion().split('.').slice(0, 3).map(Number), rp = !args.includes('--no-rp');
    const m = { format_version: 2, header: { name: title, description: title, uuid: L.randomUUID(), version: [1, 0, 0], min_engine_version: eng }, modules: [{ type: 'data', uuid: L.randomUUID(), version: [1, 0, 0] }], dependencies: [] };
    if (rp) { const r = { format_version: 2, header: { name: title + ' RP', description: title, uuid: L.randomUUID(), version: [1, 0, 0], min_engine_version: eng }, modules: [{ type: 'resources', uuid: L.randomUUID(), version: [1, 0, 0] }] }; L.writeJson(path.join(dir, 'rp', 'manifest.json'), r); m.dependencies.push({ uuid: r.header.uuid, version: r.header.version }); L.packIcon(path.join(dir, 'rp', 'pack_icon.png'), name + 'rp'); }
    L.writeJson(path.join(dir, 'bp', 'manifest.json'), m);
    L.packIcon(path.join(dir, 'bp', 'pack_icon.png'), name);
  }
  L.useAddon(name, true);
  L.out(`OK end/plugins/${name}/: ${args.includes('--cpp') ? `src/${name}.cpp (C++, CMake)` : `src/endstone_${name}/plugin.py (Python, api 0.11: a template with /${name} and a join greeting, class ${Cls}: rewrite it whole)`}${args.includes('--bp') ? ' + bp' : ''}; now the current plugin`);
}

// ---------------------------------------------------------------- the flavor
export default {
  name: 'end', title: 'Endstone lab', unitDir: 'plugins', unitWord: 'plugin', branchPrefix: 'plugin',
  isUnit: (d) => ['pyproject.toml', 'CMakeLists.txt', path.join('bp', 'manifest.json')].some((f) => exists(path.join(d, f))),
  // macOS (and LAB_RUNTIME=docker): the lab image adds Python (venv for endstone from PyPI) and the C++ plugin toolchain
  dockerfile: `RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip python3-dev git \\
  cmake ninja-build clang lld libc++-dev libc++abi-dev libc++1 libc++abi1 && rm -rf /var/lib/apt/lists/*\n`,
  selftest: `## the plugin loads (py)
py plugin.is_enabled
= True
## Endstone events
events on PlayerChatEvent
@A chat ev-end
~ EV PlayerChatEvent .*ev-end
events off
## packets decoded
packets on text
@A chat pk-end
~ PK A> text .*pk-end
packets off
## packets drop
packets drop text 1 in
@A chat dropped-end
~ PKDROP > A
!~ <A> dropped-end
## fuzz the plugin command
fuzz labselftest 30
~ FUZZ /labselftest 30 runs
## lag and perf
lag 50 20
perf 1500
~ PERF mspt
## watch
py S.v = 1
watch S.v
~ W S\\.v = 1
watch off
`,
  sapiBuild: false, matrix: false, ipv6Shim: false,   // Endstone keeps IPv6 off by default (endstone.toml network.ipv6)
  cacheDirs: ['py', 'pyapi.json', 'pytool', 'build'],
  noise: /LAB_PY_(READY|DONE|WAIT)|^Loading plugin lab_helper|^Enabling lab_helper|lab_helper v0\.0\.0|^purged \d+ module/,
  showWarn: /plugin|endstone|python|deprecat/i,
  pseudo: /^(py|sapi|packets|fuzz|lag|watch)\b/,
  lineHook: (L, line) => (line.includes('LAB_PK ') ? pkLine(line) : null),
  crashRe: /^CrashReporter Key:|crashed|Crash report saved/i,
  hints: [
    [/api[ _]version/i, 'fix: set api_version = "0.11" on the plugin class (the Endstone API this lab runs)'],
    [/No module named '([\w.]+)'/, 'fix: a Python dependency is missing: node lab.mjs lib add <pypi package> (it goes into pyproject too)'],
    [/plugin name|Invalid name/i, 'fix: plugin names are lowercase letters, digits and _ : the entry point key in pyproject.toml'],
    [/has no attribute '(\w+)'/, 'fix: not in this Endstone version or wrong class: node lab.mjs api <Class>.<member> (api ?word searches)'],
    [/asynchronous|async(hronously)? .*event|not on the server thread/i, 'fix: touch the API on the server thread: self.server.scheduler.run_task(self, fn)'],
    [/did not load \(errors above/, 'fix: the lines above say why; also: node lab.mjs check'],
  ],
  usage: 'usage: node lab.mjs new <n> [Title] [--cpp] [--bp] | use <n> | up [-k] | do <cmd..> | reload | down | run [cmd..] [-w ms] [-k] [-v] [-t file.py:line] [--cov] | test [file] [--cov] | check | build | api <Class|Class.member|?word|sapi ..> | py <code> | pack | lib add <pypi pkg> | server [--update|<endstone version>] | help [topic] | (bds-lab tools: doc sample proto render png add ui mode ...)   (-a <plugin> picks the plugin)',

  serverExe: (win) => (win ? 'bedrock_server.exe' : 'bedrock_server'),
  needsSetup: (L) => !exists(vbin(L, 'endstone')),
  async ensureServer(L, o = {}) {
    ensureVenv(L);
    if (exists(path.join(L.BDS, 'VERSION')) && exists(path.join(L.BDS, 'bedrock_server' + (WIN ? '.exe' : ''))) && !o.version) return;
    await bootstrapServer(L);
    fs.rmSync(path.join(L.CACHE, 'run'), { recursive: true, force: true });
    for (const d of ['world', 'types', 'beta.json']) fs.rmSync(path.join(L.CACHE, d), { recursive: true, force: true });
  },
  launch(L, inst) {
    const bin = vbin(L, 'endstone');
    return { cmd: bin, args: ['--server-folder', inst.dir, '--no-confirm', '--no-interactive'],
      env: { ENDSTONE_USE_INTERACTIVE_CONSOLE: '0', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', ...(inst.labEnv ?? {}),
        PYTHONPATH: [inst.labEnv?.LAB_PYPATH, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } };
  },
  loggerKind(name, L) {
    if (name === 'Server') return 'server';
    if (name === 'lab_helper') return 'script';
    const m = unitMeta(L.ADDON);
    return m && [m.plugin, m.prefix, m.cls].includes(name) ? 'script' : 'keep';
  },
  // qa, last: every command of the plugin with generated arguments, from the console and from players (it may kick or ban them)
  qaLast(L) { const src = walk(path.join(L.ADDON, 'src'), (x) => x.endsWith('.py')).map((f) => fs.readFileSync(f, 'utf8')).join('\n'); return [...src.matchAll(/"([\w-]+)"\s*:\s*\{\s*"description"\s*:\s*"[^"]*"\s*,\s*"usages"/g)].map((m) => [`fuzz ${m[1]} 40`, `/${m[1]} with generated arguments`]); },
  alive: ['py plugin.is_enabled', 'True'],   // qa: the plugin is enabled again after /reload and restart
  deploy(L, inst, eng) {
    const site = path.join(inst.dir, 'lab_site');
    fs.rmSync(site, { recursive: true, force: true });
    const hdir = path.join(site, 'helper'), udir = path.join(site, 'unit');
    fs.cpSync(path.join(HERE, 'lib', 'endstone_lab_helper'), path.join(hdir, 'endstone_lab_helper'), { recursive: true });
    distInfo(hdir, 'endstone-lab-helper', '0.0.0', 'lab_helper', 'endstone_lab_helper:LabHelper', 'bds-lab helper');
    const m = unitMeta(L.ADDON);
    // C++ plugins go into plugins/ (the libraries a previous run left there are removed first)
    const pdir = path.join(inst.dir, 'plugins');
    const mark = path.join(inst.dir, 'lab_deployed.json');
    if (exists(mark)) for (const f of JSON.parse(fs.readFileSync(mark, 'utf8'))) fs.rmSync(path.join(pdir, f), { force: true });
    const placed = [];
    if (!eng.keep && !eng.deployedOnce && m?.plugin) fs.rmSync(path.join(pdir, m.plugin), { recursive: true, force: true });   // fresh run: the plugin's data folder too (a `restart` keeps it, like the world)
    eng.deployedOnce = true;
    if (m?.kind === 'py' && m.plugin) distInfo(udir, m.dist ?? `endstone-${m.plugin}`, m.version, m.plugin, `${m.pkg}:${m.cls}`);
    if (m?.kind === 'cpp') { const lib = cppLib(L, m); if (lib) { fs.mkdirSync(pdir, { recursive: true }); fs.copyFileSync(lib, path.join(pdir, path.basename(lib))); placed.push(path.basename(lib)); } }
    fs.writeFileSync(mark, JSON.stringify(placed));
    const conf = path.join(site, 'conf.json');
    L.writeJson(conf, { plugin: m?.plugin ?? null, package: m?.pkg ?? null, src: m?.src ?? L.ADDON, unit: L.ADDON, cov: !!(eng.pyCov || eng.covWanted), covFile: path.join(inst.dir, 'lab_cov.json'), covRun: (eng.covRun ??= `${process.pid}-${Date.now()}`), traces: eng.pyTraces ?? [] });   // (covFile: what ran before a `restart` is kept and merged)
    inst.labEnv = { LAB_PY_CONF: conf, LAB_PYPATH: [hdir, udir, ...(m?.kind === 'py' ? [m.src] : [])].join(path.delimiter) };
  },
  async afterReady(L, eng) {
    const seen = () => L.LOG.slice(eng.bootMark ?? 0).some((l) => l.includes('LAB_PY_READY'));
    for (let t = 0; t < 200 && !seen() && !eng.srv.exited; t++) await L.sleep(50);
    if (!seen()) L.LOG.push('[0-0-0 0:0:0 ERROR] the lab helper plugin did not start (Endstone plugin loading failed: see above)');
    return true;
  },
  async hotReload(L, eng) {
    await py(L, eng, { op: 'purge' });
    const n = L.LOG.length;
    eng.srv.send('reload');
    for (let t = 0; t < 600 && !L.LOG.slice(n).some((l) => l.includes('LAB_PY_READY')) && !eng.srv.exited; t++) await L.sleep(50);
    if (!L.LOG.slice(n).some((l) => l.includes('LAB_PY_READY'))) { L.LOG.push('[0-0-0 0:0:0 BOT] /reload did not come back: restarting (world kept)'); await eng.restart(true); return; }
    await L.sleep(200);
    eng.bootMark = n;
    L.LOG.splice(n, 0, '[0-0-0 0:0:0 BOT] reloaded plugins (Endstone /reload; players stay)');
  },
  startTrace(L, eng, spec) {
    const [loc, ...rest] = spec.split(/\s+/), t = pyTarget(L, loc);
    if (!t) return false;
    if (t.err) { L.LOG.push('[0-0-0 0:0:0 ERROR] trace: ' + t.err); return true; }
    const n = rest.find((a) => /^x\d+$/.test(a));
    (eng.pyTraces ??= []).push({ ...t, exprs: rest.filter((a) => a !== n), max: n ? Number(n.slice(1)) : 20 });
    return true;
  },
  covOn: async (L, eng) => { eng.pyCov = true; await py(L, eng, { op: 'cov', on: true }); },
  async covReport(L, eng) {
    const n = L.LOG.length;
    await py(L, eng, { op: 'cov' });
    const line = L.LOG.slice(n).map(L.lineText).find((l) => l.startsWith('COV '));
    for (let i = L.LOG.length - 1; i >= n; i--) if (L.lineText(L.LOG[i]).startsWith('COV ')) L.LOG.splice(i, 1);
    return line ?? 'COV unavailable (helper did not answer)';
  },
  async exec(L, eng, w, rest, c, wait) {
    const on = rest[0] !== 'off', names = rest.slice(rest[0] === 'on' || rest[0] === 'off' ? 1 : 0).join(' ').split(/[\s,]+/).filter(Boolean);
    switch (w) {
      case 'py': return py(L, eng, { op: 'eval', code: c.slice(3).replace(/\\n/g, '\n') });
      case 'packets': {   // packets on [name|id ...] | off | drop <name|id> [n] [in|out]
        await pkDecoder(L);
        if (rest[0] === 'drop') {
          const id = pkId(rest[1] ?? '');
          if (id === undefined) { L.LOG.push(`[0-0-0 0:0:0 ERROR] packets drop: unknown packet ${rest[1]} (names need the protocol tables: join a real player once, or give the id)`); return true; }
          return py(L, eng, { op: 'packets', drop: id, label: rest[1], n: Number(rest[2]) || 1, dir: rest[3] ?? 'both' });
        }
        const ids = names.map(pkId);
        if (ids.some((x) => x === undefined)) { L.LOG.push(`[0-0-0 0:0:0 ERROR] packets: unknown ${names.filter((x) => pkId(x) === undefined).join(' ')} (names need the protocol tables: join a real player once, or give ids)`); return true; }
        return py(L, eng, { op: 'packets', on, ids, skip: NOISY.split(' ').map(pkId).filter((x) => x !== undefined) });
      }
      case 'fuzz': return py(L, eng, { op: 'fuzz', cmd: rest[0] ?? '', n: Number(rest[1]) || 60, seed: Number(rest[2]) || 1 }, 120000);
      case 'lag': return py(L, eng, { op: 'lag', ms: Number(rest[0]) || 100, ticks: Number(rest[1]) || 40 });
      case 'watch': return py(L, eng, rest[0] === 'off' ? { op: 'watch', off: true } : { op: 'watch', expr: c.slice(6) });
      case 'events': return py(L, eng, { op: 'events', on, names });
      case 'states': return py(L, eng, { op: 'states', on, keys: names });
      case 'prof': return py(L, eng, { op: 'prof', start: rest[0] !== 'stop', n: Number(rest[1]) || 8 });
      case 'perf': { const n = L.LOG.length; await py(L, eng, { op: 'perf', ms: Number(rest[0]) || 3000 }); const t0 = Date.now(); while (!L.LOG.slice(n).some((l) => l.includes('PERF ')) && Date.now() - t0 < (Number(rest[0]) || 3000) + 8000) await L.sleep(50); return true; }
      case 'cov':
        if (rest[0] === 'on') { eng.pyCov = true; return py(L, eng, { op: 'cov', on: true }); }
        return py(L, eng, { op: 'cov' });
      case 'trace': {
        if (rest[0] === 'err' || rest[0] === 'off') { await py(L, eng, { op: 'trace', args: rest }); return hasBpScripts(L) ? undefined : true; }
        const t = pyTarget(L, rest[0]);
        if (!t) return undefined;   // not a .py file: the Script API debugger (bp/scripts)
        if (t.err) { L.LOG.push('[0-0-0 0:0:0 ERROR] trace: ' + t.err); return true; }
        const n = rest.find((a) => /^x\d+$/.test(a));
        return py(L, eng, { op: 'trace', file: t.file, line: t.line, exprs: rest.slice(1).filter((a) => a !== n), max: n ? Number(n.slice(1)) : 20 });
      }
      default: return undefined;
    }
  },
  preflight: (L, opts) => pyChecks(L, opts),
  unitVersion: (L) => unitMeta(L.ADDON)?.version ?? '0.1.0',
  commands: {
    new: (L, a) => scaffold(L, a),
    async api(L, a) {
      if (!a.length) L.die('usage: node lab.mjs api <Class|Class.member|?word> ... (Endstone)   |   api sapi <q> (the Script API, for bp/scripts)');
      if (a[0] === 'sapi') return L.sapi(a.slice(1));
      ensureVenv(L);
      let ok = true;
      for (const q of a) ok = pyApi(L, q) && ok;
      return ok;
    },
    async pack(L, a) {
      if (!(await L.preflight())) return false;
      const m = unitMeta(L.ADDON), made = [];
      if (m?.kind === 'py') made.push(wheel(L, m));
      if (m?.kind === 'cpp') { const lib = cppLib(L, m); if (lib) { const d = path.join(L.ROOT, 'dist', path.basename(lib)); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(lib, d); made.push(d); } }
      if (exists(path.join(L.BP, 'manifest.json'))) await L.pack(a);
      for (const f of made) L.out(`OK ${L.rel(f)}${m?.kind === 'py' ? ' (copy into the server\'s plugins/ folder)' : ''}`);
      return made[0] ?? (exists(path.join(L.BP, 'manifest.json')) ? true : false);
    },
    async lib(L, a) {
      const [op, ...pk] = a;
      if (!['add', 'remove'].includes(op) || !pk.length) L.die('usage: node lab.mjs lib add|remove <pypi package[==version]> ...');
      await L.setup();
      pip(L, op === 'add' ? ['install', ...pk] : ['uninstall', '-y', ...pk.map((p) => p.split(/[=<>~!]/)[0])]);
      const pj = path.join(L.ADDON, 'pyproject.toml');
      if (exists(pj)) {
        let t = fs.readFileSync(pj, 'utf8');
        const cur = parseToml(t).project?.dependencies ?? [];
        const base = (d) => d.split(/[=<>~! [;]/)[0].toLowerCase();
        const next = op === 'add' ? [...cur.filter((d) => !pk.some((p) => base(p) === base(d))), ...pk] : cur.filter((d) => !pk.some((p) => base(p) === base(d)));
        t = t.replace(/^dependencies\s*=\s*\[[^\]]*\]/m, `dependencies = [${next.map((d) => JSON.stringify(d)).join(', ')}]`);
        fs.writeFileSync(pj, t);
        L.out(`OK dependencies: ${next.join(' ') || 'none'} (installed in the lab venv; the .whl declares them)`);
      }
      return true;
    },
    async server(L, a) {
      if (a.includes('--update') || a.some((x) => /^\d+\.\d+/.test(x))) {
        const want = a.find((x) => /^\d+\.\d+/.test(x));
        ensureVenv(L);
        pip(L, ['install', '--upgrade', want ? `endstone==${want}` : ENDSTONE]);
        fs.rmSync(L.BDS, { recursive: true, force: true });
        await L.setup();
      } else { await L.setup(); ensureVenv(L); }   // (setup stops early once the server is here: the venv is checked anyway)
      // (never an OK with blanks: a venv whose Python cannot run says nothing for either)
      const ev = endstoneVersion(L), pv = pyOut(L, 'import platform;print(platform.python_version())');
      if (!ev || !pv) L.die(`the lab venv (${L.rel(venv(L))}) does not answer (Endstone ${ev || '?'}, Python ${pv || '?'}): node lab.mjs server --update`);
      L.out(`OK Endstone ${ev} | BDS ${L.bdsVersion()} | Python ${pv} (${L.rel(venv(L))})`);
      return true;
    },
    bds: (L, a) => L.F.commands.server(L, a),
  },
};
export { portablePython };   // tests/env-offline.mjs
