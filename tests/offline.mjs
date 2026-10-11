#!/usr/bin/env node
// Offline end-to-end tests of the three labs against fake servers (tests/fake): no network, no Minecraft.
// What they prove: flavor loading, unit discovery, scaffolds, checks, per-instance deploy, launch, log normalisation, the
// helper plugins (Endstone Python / LSE JS) and their commands, test runner + coverage, live reload, packaging.
// What they cannot prove: real Endstone / LeviLamina / BDS behaviour and real players (CI runs those: .github/workflows).
//   node tests/offline.mjs [bds|end|ll ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = path.join(TOP, 'tests', 'fake');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-offline-'));
const REPO = path.join(T, 'repo');
for (const d of ['common', 'bds', 'end', 'll']) fs.cpSync(path.join(TOP, d), path.join(REPO, d), { recursive: true, filter: (s) => !/[\\/](\.lab|dist|runs|node_modules)$/.test(s) });
for (const f of ['lab.mjs', 'AGENTS.md']) fs.copyFileSync(path.join(TOP, f), path.join(REPO, f));
for (const d of ['bds/addons', 'end/plugins', 'll/mods']) { fs.rmSync(path.join(REPO, d), { recursive: true, force: true }); fs.mkdirSync(path.join(REPO, d)); }
fs.rmSync(path.join(REPO, 'bds', '.lab-current'), { force: true });

let bad = 0, good = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✔' : '✘'} ${what}${ok || !detail ? '' : '\n    ' + String(detail).trim().split('\n').slice(-25).join('\n    ')}`); if (ok) good++; else bad++; };

// a cache that looks set up: server + template world + beta versions + build tools (the sandbox's own esbuild/typescript)
function npmRoot() { try { return execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { return ''; } }
function findPkg(name) {
  const g = npmRoot();
  for (const c of [path.join(g, name), path.join(g, 'tsx', 'node_modules', name), path.join(TOP, 'node_modules', name)]) if (fs.existsSync(path.join(c, 'package.json'))) return c;
  return null;
}
function seed(cache, { exe, version }) {
  const bds = path.join(cache, 'bds');
  fs.mkdirSync(bds, { recursive: true });
  fs.writeFileSync(path.join(bds, 'VERSION'), version);
  fs.writeFileSync(path.join(bds, 'server.properties'), 'server-name=fake\n');
  if (exe) { fs.writeFileSync(path.join(bds, exe.name), exe.body); fs.chmodSync(path.join(bds, exe.name), 0o755); }
  fs.mkdirSync(path.join(cache, 'world'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'world', 'level.dat'), Buffer.alloc(16));
  fs.writeFileSync(path.join(cache, 'beta.json'), JSON.stringify({ server: '2.8.0-beta', 'server-gametest': '1.0.0-beta' }));
  const tool = path.join(cache, 'tool', 'node_modules');
  fs.mkdirSync(tool, { recursive: true });
  for (const n of ['esbuild', 'typescript']) { const p = findPkg(n); if (p) fs.symlinkSync(p, path.join(tool, n), 'dir'); }
  fs.writeFileSync(path.join(cache, 'tool', 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(cache, 'tool', 'stamp'), JSON.stringify({ esbuild: '^0.28.0', typescript: '~6.0.3' }));
}
const CACHES = { bds: path.join(T, 'cache-bds'), end: path.join(T, 'cache-end'), ll: path.join(T, 'cache-ll') };
// native runtime unless a section asks for docker (macOS would default to docker; the fakes run on the host)
const baseEnv = { ...process.env, LAB_NOTRACE: '1', LAB_PY_TYPES: '0', LAB_TYPES: '0', NO_COLOR: '1', LAB_RUNTIME: 'native', LAB_PK_DECODE: '0',
  // really offline: npm never reaches a registry (the real client stays uninstalled even on a networked machine)
  npm_config_registry: 'http://127.0.0.1:9/', npm_config_fetch_retries: '0', npm_config_fetch_timeout: '2000', npm_config_offline: 'false', npm_config_prefer_online: 'true' };
function lab(flavor, args, extra = {}) {
  const r = spawnSync(process.execPath, [path.join(REPO, flavor, 'lab.mjs'), ...args], { cwd: path.join(REPO, flavor), env: { ...baseEnv, LAB_CACHE: CACHES[flavor], ...extra }, encoding: 'utf8', timeout: 180000 });
  return { code: r.status, out: ((r.stdout ?? '') + (r.stderr ?? '')).trim() };
}
const want = process.argv.slice(2);
const on = (f) => !want.length || want.includes(f);

// ------------------------------------------------------------------------------------------------ bds
if (on('bds')) {
  console.log('\n== bds (addons on plain BDS)');
  seed(CACHES.bds, { version: '1.26.51.1\n', exe: { name: 'bedrock_server', body: `#!/bin/sh\nexec "${process.execPath}" "${path.join(FAKE, 'fake_server.cjs')}" bds\n` } });
  let r = lab('bds', ['new', 'demo', 'Demo', '--js']);
  check(r.code === 0 && fs.existsSync(path.join(REPO, 'bds', 'addons', 'demo', 'bp', 'manifest.json')), 'bds: new demo --js', r.out);
  r = lab('bds', ['run', 'say hello bds']);
  check(/hello bds/.test(r.out), 'bds: run boots the (fake) BDS, output rendered', r.out);
  r = lab('bds', ['run', 'fakecrash']);
  check(/crash/i.test(r.out), 'bds: a crash is reported', r.out);
  r = lab('bds', ['py', '1']);
  check(r.code !== 0, 'bds: platform commands of other labs are not here');
  fs.writeFileSync(path.join(REPO, 'bds', 'addons', 'demo', 'tests.txt'), '## order\nsay a\n~ (?s)a.*b\n');
  r = lab('bds', ['test']);
  check(r.code !== 0 && /tests\.txt:3: .*Invalid regular expression/.test(r.out) && /before any server starts/.test(r.out), 'bds: a regex that does not compile stops test before any server starts', r.out);
}

// ------------------------------------------------------------------------------------------------ end
if (on('end')) {
  console.log('\n== end (Endstone plugins)');
  const py = spawnSync('python3', ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
  seed(CACHES.end, { version: '1.26.51.1\nendstone 0.11.11 (fake)\n', exe: { name: 'bedrock_server', body: '#!/bin/sh\nexit 1\n' } });
  const vb = path.join(CACHES.end, 'py', 'bin');
  fs.mkdirSync(vb, { recursive: true });
  fs.symlinkSync(py, path.join(vb, 'python'));
  fs.writeFileSync(path.join(vb, 'endstone'), `#!/bin/sh\nexec "${py}" "${path.join(FAKE, 'fake_endstone.py')}" "$@"\n`);
  fs.chmodSync(path.join(vb, 'endstone'), 0o755);
  const P = path.join(REPO, 'end', 'plugins', 'hello');
  let r = lab('end', ['new', 'hello', 'Hello']);
  check(r.code === 0 && fs.existsSync(path.join(P, 'src', 'endstone_hello', 'plugin.py')), 'end: new hello (Python plugin scaffold)', r.out);
  r = lab('end', ['check']);
  check(r.code === 0, 'end: check passes on the scaffold', r.out);
  const plugin = path.join(P, 'src', 'endstone_hello', 'plugin.py');
  const src0 = fs.readFileSync(plugin, 'utf8');
  fs.writeFileSync(plugin, src0.replace('api_version = "0.11"\n', ''));
  r = lab('end', ['check']);
  check(r.code !== 0 && /api_version/.test(r.out), 'end: check catches a missing api_version before boot', r.out);
  fs.writeFileSync(plugin, src0.replace('        return True', '        return True +'));
  r = lab('end', ['check']);
  check(r.code !== 0 && /plugin\.py:\d+ SyntaxError/.test(r.out), 'end: check reports a Python syntax error with file:line', r.out);
  fs.writeFileSync(plugin, src0);
  r = lab('end', ['run', 'py plugin.is_enabled', 'py 1+2', 'py S.x = 5\\nreturn S.x * 2', 'fakejoin Steve']);
  check(/^= True$/m.test(r.out) || /\bTrue\b/.test(r.out), 'end: py sees the plugin under test (loaded through its entry point)', r.out);
  check(/\b3\b/.test(r.out) && /\b10\b/.test(r.out), 'end: py evaluates expressions and statement blocks with return', r.out);
  check(/Welcome, Steve/.test(r.out), 'end: the plugin handles PlayerJoinEvent', r.out);
  r = lab('end', ['run', 'events on PlayerJoinEvent', 'fakejoin Alex']);
  check(/EV PlayerJoinEvent .*player=Alex/.test(r.out), 'end: events on taps Endstone events with fields', r.out);
  r = lab('end', ['run', 'states on', 'fakejoin Alex', 'wait 200']);
  check(/ST Alex init .*location=0,64,0/.test(r.out), 'end: states on prints player properties', r.out);
  const ln = src0.split('\n').findIndex((l) => l.includes('Welcome')) + 1;
  r = lab('end', ['run', '-t', `src/endstone_hello/plugin.py:${ln}`, 'fakejoin Bob']);
  check(new RegExp(`T1 src/endstone_hello/plugin.py:${ln} .*event=`).test(r.out), 'end: -t file.py:line traces locals from startup', r.out);
  r = lab('end', ['run', 'py 1/0']);
  check(/ZeroDivisionError/.test(r.out) && /^E /m.test(r.out), 'end: a Python error is an E line', r.out);
  r = lab('end', ['run', 'perf 500']);
  check(/PERF mspt/.test(r.out), 'end: perf measures tick time', r.out);
  r = lab('end', ['run', 'prof start', 'fakejoin Z', 'prof stop']);
  check(/PROF .*ms/.test(r.out), 'end: prof profiles the server thread', r.out);
  // the one entry at the top: picks the lab, remembers it
  const top = (args) => { const q = spawnSync(process.execPath, [path.join(REPO, 'lab.mjs'), ...args], { cwd: REPO, env: { ...baseEnv, LAB_CACHE: CACHES.end }, encoding: 'utf8', timeout: 180000 }); return { code: q.status, out: (q.stdout ?? '') + (q.stderr ?? '') }; };
  r = top(['end', 'run', 'py 6*7']);
  check(r.code === 0 && /\b42\b/.test(r.out) && fs.readFileSync(path.join(REPO, '.lab-kind'), 'utf8').trim() === 'end', 'top: node lab.mjs end <cmd> runs the Endstone lab and remembers it', r.out);
  r = top(['run', 'py 2+3']);
  check(r.code === 0 && /\b5\b/.test(r.out), 'top: a plain node lab.mjs <cmd> goes to the remembered lab', r.out);
  fs.rmSync(path.join(REPO, '.lab-kind'), { force: true });
  // selftest: the lab on this machine in one command (here without the real client: npm is offline, those sections are left out)
  r = lab('end', ['selftest']);
  const rep = path.join(REPO, 'end', '.lab', 'selftest.txt');
  check(/real players unavailable/.test(r.out) && /PASS 4\/4/.test(r.out) && fs.existsSync(rep) && /== test/.test(fs.readFileSync(rep, 'utf8')) && !fs.existsSync(path.join(REPO, 'end', 'plugins', 'labselftest')),
    'end: selftest runs the platform sections, writes the report, removes its plugin', r.out);
  // Endstone-only tools: packets (tap + drop), fuzz, lag, watch
  r = lab('end', ['run', 'fakejoin Steve', 'packets on', 'fakepacket in Steve 144 0a0b', 'fakepacket out Steve 58 ff', 'packets drop 144 1 in', 'fakepacket in Steve 144 0a0b', 'fakepacket in Steve 144 0c', 'packets off']);
  check(/PK Steve> #144 2B 0a0b/.test(r.out) && /PK Steve< #58 1B ff/.test(r.out), 'end: packets on shows both directions (raw id + payload when no tables)', r.out);
  check(/PKDROP > Steve 144/.test(r.out) && /packet 144 dropped/.test(r.out) && /packet 144 delivered/.test(r.out), 'end: packets drop cancels exactly the next matching packet', r.out);
  const fz = src0.replace('"usages": ["/hello"]', '"usages": ["/hello <n: int> [who: str]"]').replace('        if command.name == "hello":\n', '        if command.name == "hello":\n            n = int(args[0])\n            sender.send_message(str(100 // n))\n');
  fs.writeFileSync(plugin, fz);
  r = lab('end', ['run', 'fuzz hello 80']);
  check(/E FUZZ ValueError: .*plugin\.py:\d+/.test(r.out) && /E FUZZ ZeroDivisionError/.test(r.out) && /FUZZ \/hello 80 runs, [2-9] distinct/.test(r.out), 'end: fuzz finds the crashing inputs of a command (file:line + the input)', r.out);
  fs.writeFileSync(plugin, src0);
  r = lab('end', ['run', 'lag 30 5', 'wait 600']);
  check(/lag 30ms x 5 ticks/.test(r.out) && /lag done/.test(r.out), 'end: lag stalls the server thread for n ticks', r.out);
  r = lab('end', ['run', 'py S.hp = 20', 'watch S.hp', 'py S.hp = 7', 'wait 200', 'watch off']);
  check(/W S\.hp = 20/.test(r.out) && /W S\.hp = 7/.test(r.out), 'end: watch prints an expression each time it changes', r.out);
  fs.writeFileSync(path.join(P, 'tests.txt'), '## loads\npy plugin.is_enabled\n= True\n## joins\nfakejoin Steve\n~ Welcome, Steve\n');
  fs.writeFileSync(path.join(P, 'tests.txt'), '## order\npy 1\n~ (?s)1.*2\n');
  r = lab('end', ['test']);
  check(r.code !== 0 && /tests\.txt:3: Invalid regular expression.*a JavaScript regex, one line at a time/.test(r.out) && !/LAB_PY_READY/.test(r.out), 'end: a regex that does not compile stops test before the server starts (the hint names the workaround)', r.out);
  fs.writeFileSync(path.join(P, 'tests.txt'), '## loads\npy plugin.is_enabled\n= True\n## joins\nfakejoin Steve\n~ Welcome, Steve\n');
  r = lab('end', ['test', '--cov']);
  check(r.code === 0 && /2\/2|PASS/.test(r.out), 'end: test passes', r.out);
  check(/COV \d+% .*plugin\.py/.test(r.out), 'end: test --cov reports Python line coverage', r.out);
  // live: up, edit, do (hot reload through /reload), down
  r = lab('end', ['up']);
  check(r.code === 0, 'end: up', r.out);
  fs.writeFileSync(plugin, src0.replace('f"Welcome, {event.player.name}"', 'f"Hi again, {event.player.name}"'));
  r = lab('end', ['do', 'fakejoin Eve']);
  check(/reloaded plugins/.test(r.out) && /Hi again, Eve/.test(r.out), 'end: do after an edit reloads the plugin in place (purge + /reload)', r.out);
  r = lab('end', ['down']);
  check(r.code === 0, 'end: down', r.out);
  r = lab('end', ['pack']);
  const whl = path.join(REPO, 'end', 'dist', 'endstone_hello-0.1.0-py3-none-any.whl');
  check(r.code === 0 && fs.existsSync(whl), 'end: pack writes a .whl', r.out);
  if (fs.existsSync(whl)) {
    const v = spawnSync('python3', ['-c', `import zipfile,hashlib,base64,sys
z=zipfile.ZipFile(sys.argv[1]);names=z.namelist()
rec=[l.split(',') for l in z.read([n for n in names if n.endswith('RECORD')][0]).decode().splitlines()]
bad=[p for p,h,s in rec if h and 'sha256='+base64.urlsafe_b64encode(hashlib.sha256(z.read(p)).digest()).rstrip(b'=').decode()!=h]
ep=z.read([n for n in names if n.endswith('entry_points.txt')][0]).decode()
print('OK' if not bad and 'hello = endstone_hello:Hello' in ep and 'endstone_hello/plugin.py' in names else 'BAD %s %s'%(bad,ep))`, whl], { encoding: 'utf8' });
    check(/OK/.test(v.stdout), 'end: .whl has valid RECORD hashes and the endstone entry point', v.stdout + v.stderr);
  }
}

// ------------------------------------------------------------------------------------------------ ll
if (on('ll')) {
  console.log('\n== ll (LeviLamina mods)');
  seed(CACHES.ll, { version: '1.26.51.1\nlevilamina 26.51.5 (fake)\n', exe: { name: 'bedrock_server_mod.exe', body: 'fake' } });
  const eng = path.join(CACHES.ll, 'bds', 'plugins', 'legacy-script-engine-quickjs');
  fs.mkdirSync(eng, { recursive: true });
  fs.writeFileSync(path.join(eng, 'manifest.json'), '{"name":"legacy-script-engine-quickjs","version":"0.22.1"}');
  const env = { LAB_LL_LAUNCH: `${process.execPath} ${path.join(FAKE, 'fake_server.cjs')} ll` };
  const M = path.join(REPO, 'll', 'mods', 'greet');
  let r = lab('ll', ['new', 'greet', 'Greet'], env);
  check(r.code === 0 && fs.existsSync(path.join(M, 'src', 'main.ts')), 'll: new greet (LSE TypeScript scaffold)', r.out);
  r = lab('ll', ['check'], env);
  check(r.code === 0, 'll: check bundles the mod (esbuild)', r.out);
  r = lab('ll', ['run', 'll list', 'lse 1+2', 'lse typeof mc.listen', 'fakejoin Steve'], env);
  check(/greet/.test(r.out) && /\b3\b/.test(r.out) && /function/.test(r.out), 'll: the mod loads; lse evaluates in its context', r.out);
  check(/Welcome, Steve/.test(r.out), 'll: the mod handles onJoin', r.out);
  check(!/labjs/.test(r.out), 'll: helper console lines never leak', r.out);
  r = lab('ll', ['run', 'events on', 'fakejoin Alex', 'states on', 'wait 200'], env);
  check(/EV onJoin Alex/.test(r.out), 'll: events on taps LSE events', r.out);
  check(/ST Alex init .*pos=0,64,0/.test(r.out), 'll: states on prints player properties', r.out);
  r = lab('ll', ['run', 'lse null.x'], env);
  check(/^E .*lse:/m.test(r.out), 'll: an eval error is an E line', r.out);
  const main = path.join(M, 'src', 'main.ts'), src0 = fs.readFileSync(main, 'utf8');
  fs.writeFileSync(main, src0 + "\nfunction boom(): never { throw new Error('boom here'); }\nboom();\n");
  r = lab('ll', ['run'], env);
  const boomLine = (src0 + "\nfunction boom").split('\n').length;   // the line with `throw`
  check(/boom here/.test(r.out) && new RegExp(`src/main\\.ts:${boomLine}\\b`).test(r.out), `ll: a script error points at the exact source line (src/main.ts:${boomLine}, source map)`, r.out);
  fs.writeFileSync(main, src0);
  fs.writeFileSync(path.join(M, 'tests.txt'), '## loads\nll list\n~ greet\n## greets\nfakejoin Steve\n~ Welcome, Steve\n');
  r = lab('ll', ['test'], env);
  check(r.code === 0, 'll: test passes', r.out);
  r = lab('ll', ['up'], env);
  check(r.code === 0, 'll: up', r.out);
  fs.writeFileSync(main, src0.replace('Welcome, ', 'Hello again, '));
  r = lab('ll', ['do', 'fakejoin Eve'], env);
  check(/reloaded greet/.test(r.out) && /Hello again, Eve/.test(r.out), 'll: do after an edit reloads the mod in place (ll unload/load)', r.out);
  r = lab('ll', ['down'], env);
  check(r.code === 0, 'll: down', r.out);
  r = lab('ll', ['pack'], env);
  const z = path.join(REPO, 'll', 'dist', 'greet-0.1.0.zip');
  check(r.code === 0 && fs.existsSync(z), 'll: pack writes the mod zip', r.out);
  if (fs.existsSync(z)) {
    const list = spawnSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print("\\n".join(z.namelist()));print("HELPER" if b"LAB_LSE_READY" in z.read("greet/greet.js") else "")', z], { encoding: 'utf8' }).stdout;
    check(/greet\/manifest\.json/.test(list) && /greet\/greet\.js/.test(list) && !/HELPER/.test(list), 'll: the packed mod has no lab helper inside', list);
  }
  // LeviLamina-only tools: simulated players, watch, lag, the CrashLogger's native stack
  r = lab('ll', ['run', 'bots 5 walk', 'lse mc.getOnlinePlayers().length', 'bots off', 'lse mc.getOnlinePlayers().length'], env);
  check(/BOTS 5 online \(walking\)/.test(r.out) && /^5$/m.test(r.out) && /BOTS 0 online/.test(r.out) && /^0$/m.test(r.out), 'll: bots spawns / removes LeviLamina simulated players', r.out);
  r = lab('ll', ['run', 'lse globalThis.hp = 20', 'watch globalThis.hp', 'lse globalThis.hp = 3', 'wait 200', 'watch off'], env);
  check(/W globalThis\.hp = 20/.test(r.out) && /W globalThis\.hp = 3/.test(r.out), 'll: watch prints an expression in the mod context when it changes', r.out);
  r = lab('ll', ['run', 'lag 20 4', 'wait 500'], env);
  check(/lag done/.test(r.out), 'll: lag stalls the server thread', r.out);
  r = lab('ll', ['run', 'fakellcrash'], env);
  check(/crash report trace_.*\(1 frame\(s\) in greet\)/.test(r.out) && /greet\.dll!Greet::onUse/.test(r.out), 'll: a crash shows the CrashLogger frames of the mod', r.out);
  r = lab('ll', ['run', 'trace src/main.ts:3'], env);
  check(/no debugger/.test(r.out), 'll: trace explains what to use instead', r.out);
}

// ------------------------------------------------------------------------------------------------ docker (macOS path)
// The macOS way (and LAB_RUNTIME=docker): the server side runs in a linux/amd64 container. A fake docker CLI checks every
// argument the lab builds and runs the program on the host, so the whole flow (image build, same-path mounts, ports, stdin,
// stop, kill of the container) is exercised without a daemon. Real Docker Desktop / OrbStack / colima: not here (CI note).
if (on('docker')) {
  console.log('\n== docker runtime (the macOS path, fake docker CLI)');
  const DLOG = path.join(T, 'docker.log'), DSTATE = path.join(T, 'docker-state');
  const denv = { LAB_RUNTIME: 'docker', LAB_DOCKER: path.join(FAKE, 'docker'), FAKE_DOCKER_LOG: DLOG, FAKE_DOCKER_STATE: DSTATE };
  const calls = () => (fs.existsSync(DLOG) ? fs.readFileSync(DLOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const leftovers = () => (fs.existsSync(DSTATE) ? fs.readdirSync(DSTATE).filter((f) => f.endsWith('.pid')) : []);
  // bds (seed again if only this part runs)
  if (!fs.existsSync(path.join(CACHES.bds, 'bds', 'bedrock_server'))) seed(CACHES.bds, { version: '1.26.51.1\n', exe: { name: 'bedrock_server', body: `#!/bin/sh\nexec "${process.execPath}" "${path.join(FAKE, 'fake_server.cjs')}" bds\n` } });
  if (!fs.existsSync(path.join(REPO, 'bds', 'addons', 'demo'))) lab('bds', ['new', 'demo', 'Demo', '--js']);
  let r = lab('bds', ['run', 'say hello from the container'], denv);
  const c = calls(), errs = c.filter((x) => x.error);
  check(/hello from the container/.test(r.out) && !errs.length, 'docker: bds boots inside the (fake) container, output rendered', r.out + JSON.stringify(errs));
  check(c.some((x) => x.build && /^bds-lab-bds:/.test(x.build)), 'docker: the lab image is built once, pinned to linux/amd64', JSON.stringify(c.slice(0, 3)));
  const srv = c.find((x) => x.run && x.run.flags.includes('-i'));
  check(!!srv && srv.run.ports.length === 2 && srv.run.cwd.startsWith(CACHES.bds) && !!srv.run.name, 'docker: server container = stdin + 2 UDP ports on 127.0.0.1 + instance dir as cwd', JSON.stringify(srv));
  check(!leftovers().length, 'docker: no container left after the run', leftovers().join(' '));
  r = lab('bds', ['up'], denv);
  check(r.code === 0, 'docker: up (live server in a container)', r.out);
  r = lab('bds', ['do', 'say live in docker'], denv);
  check(/live in docker/.test(r.out), 'docker: do talks to the containerized live server', r.out);
  r = lab('bds', ['down'], denv);
  check(r.code === 0 && !leftovers().length, 'docker: down stops the container', r.out + leftovers().join(' '));
  // end: venv python, Endstone launcher, py helper through the container
  if (fs.existsSync(path.join(CACHES.end, 'py', 'bin', 'endstone')) && fs.existsSync(path.join(REPO, 'end', 'plugins', 'hello'))) {
    r = lab('end', ['check'], denv);
    check(r.code === 0, 'docker: end check (syntax by host python, venv on the server side)', r.out);
    r = lab('end', ['run', 'py 1+2', 'fakejoin Mac'], denv);
    check(/\b3\b/.test(r.out) && /(Welcome|Hi again), Mac/.test(r.out), 'docker: end plugin runs under Endstone in the container', r.out);
    check(calls().some((x) => x.run && /endstone$/.test(x.run.cmd) && x.run.env.LAB_PYPATH), 'docker: the Endstone launch carries the lab paths as -e variables', '');
  }
  // ll: the server command through the container
  if (fs.existsSync(path.join(REPO, 'll', 'mods', 'greet'))) {
    r = lab('ll', ['run', 'lse 40+2', 'fakejoin Mac'], { ...denv, LAB_LL_LAUNCH: `${process.execPath} ${path.join(FAKE, 'fake_server.cjs')} ll` });
    check(/\b42\b/.test(r.out) && /(Welcome|Hello again), Mac/.test(r.out), 'docker: ll mod runs in the container', r.out);
  }
  // NetherNet server: transport + a UDP window advertised as 127.0.0.1, signaling TCP + window UDP published
  fs.writeFileSync(DLOG, '');
  r = lab('bds', ['run', '-v', 'say nn'], { ...denv, LAB_TRANSPORT: 'nethernet' });
  const nn = calls().find((x) => x.run && x.run.flags.includes('-i'));
  check(/transport nethernet udp 127\.0\.0\.1:(\d+)-(\d+):\1-\2/.test(r.out) && nn?.run.ports.some((p) => /\/tcp$/.test(p)) && nn.run.ports.filter((p) => /\/udp$/.test(p)).length === 10,
    'docker: LAB_TRANSPORT=nethernet → transport=nethernet, server-udp-ports advertised as 127.0.0.1, TCP signaling + UDP window published', r.out.split('\n').filter((l) => /transport/.test(l)).join(' ') + JSON.stringify(nn?.run.ports));
  check(!leftovers().length, 'docker: every container removed', leftovers().join(' '));
  // no docker at all: one clear line on what to install
  r = lab('bds', ['run', 'say x'], { ...denv, LAB_DOCKER: path.join(T, 'no-such-docker') });
  check(r.code !== 0 && /OrbStack|Docker Desktop/.test(r.out) && /colima/.test(r.out), 'docker: missing docker says what to install on macOS', r.out);
}

console.log(`\n${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
if (!process.env.KEEP) fs.rmSync(T, { recursive: true, force: true }); else console.log('kept ' + T);
process.exit(bad ? 1 : 0);
