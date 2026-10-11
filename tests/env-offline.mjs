#!/usr/bin/env node
// Offline tests of the environment layer (no network, no Minecraft): proxy/CA hand-off to Node, doctor's machine line and
// --json, bg/wait/stop, setup all's per-lab report, cache export/import, lab.sh. node tests/env-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-env-'));
const REPO = path.join(T, 'repo');
for (const d of ['common', 'bds', 'end', 'll']) fs.cpSync(path.join(TOP, d), path.join(REPO, d), { recursive: true, filter: (s) => !/[\\/](\.lab|dist|runs|node_modules)$/.test(s) });
for (const f of ['lab.mjs', 'lab.sh', 'AGENTS.md']) fs.copyFileSync(path.join(TOP, f), path.join(REPO, f));
fs.chmodSync(path.join(REPO, 'lab.sh'), 0o755);
let bad = 0, good = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✔' : '✘'} ${what}${ok || !detail ? '' : '\n    ' + String(detail).trim().split('\n').slice(-6).join('\n    ')}`); ok ? good++ : bad++; };
const clean = { ...process.env }; for (const k of Object.keys(clean)) if (/proxy|CA_|CERT|NODE_USE_ENV_PROXY|LAB_NETENV/i.test(k)) delete clean[k];
const lab = (args, env = {}, timeout = 120000) => { const r = spawnSync(process.execPath, [path.join(REPO, 'lab.mjs'), ...args], { cwd: REPO, encoding: 'utf8', timeout, env: { ...clean, ...env } }); return { code: r.status, text: (r.stdout ?? '') + (r.stderr ?? '') }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ENV_TEST_PART=1|2: only sections 1–5 or only 6–8 (common/run-tests.mjs runs the file as these two parts side by side;
// each part has its own copy of the lab, and no section of the second half reads what the first one left)
const PART = Number(process.env.ENV_TEST_PART) || 0, part = (n) => !PART || PART === n;
let r;
if (part(1)) {
// 1. HTTPS_PROXY reaches Node's fetch (every download goes through the proxy; it answers 403 + x-deny-reason like a sandbox's)
const seen = [];
const px = http.createServer((q, s) => { seen.push(q.url); s.writeHead(403, { 'x-deny-reason': 'host_not_allowed' }).end(); });
px.on('connect', (q, sock) => { seen.push(q.url); sock.end('HTTP/1.1 403 Forbidden\r\nx-deny-reason: host_not_allowed\r\n\r\n'); });
await new Promise((r) => px.listen(0, '127.0.0.1', r));
const purl = `http://127.0.0.1:${px.address().port}`;
const d = await new Promise((res) => { const c = spawn(process.execPath, [path.join(REPO, 'lab.mjs'), 'doctor', '--json'], { cwd: REPO, env: { ...clean, HTTPS_PROXY: purl, HTTP_PROXY: purl } }); let t = ''; c.stdout.on('data', (b) => { t += b; }); c.stderr.on('data', (b) => { t += b; }); c.on('close', (code) => res({ code, text: t })); });
px.close();
check(seen.some((u) => /minecraft\.net/.test(u)) && seen.some((u) => /registry\.npmjs\.org/.test(u)), 'HTTPS_PROXY: Node downloads go through the proxy', seen.join(' ') + '\n' + d.text);
check(/network proxy\s+http:\/\/127\.0\.0\.1:\d+ \(Node follows it: NODE_USE_ENV_PROXY=1/.test(d.text), 'doctor shows the proxy it follows', d.text);
check(/BLOCKED .*BDS download/.test(d.text) && !/Warning|ExperimentalWarning/.test(d.text), 'a denied host is BLOCKED, no Node warnings leak', d.text);
check(/^INFO\s+machine\s+\S+\/\S+.*\| install: /m.test(d.text), 'doctor: machine line (OS/CPU, install ability)', d.text);
let j = null; try { j = JSON.parse(fs.readFileSync(path.join(REPO, 'bds', '.lab', 'doctor.json'), 'utf8')); } catch { /* checked */ }
check(j && Array.isArray(j.rows) && j.machine?.plat && j.labs?.bds, 'doctor --json writes .lab/doctor.json', JSON.stringify(j)?.slice(0, 300));

// 2. a CA from the environment reaches Node (NODE_EXTRA_CA_CERTS) and pip (PIP_CERT); LAB_NETENV=off leaves it alone
const pem = path.join(T, 'ca.pem'); fs.writeFileSync(pem, '');
fs.writeFileSync(path.join(REPO, 'common', 'envprobe.mjs'), "import './netenv.mjs'; console.log('ENV', process.env.NODE_EXTRA_CA_CERTS, process.env.PIP_CERT);\n");
const pr = (env) => spawnSync(process.execPath, [path.join(REPO, 'common', 'envprobe.mjs')], { encoding: 'utf8', env: { ...clean, ...env } }).stdout;
check(pr({ SSL_CERT_FILE: pem }).includes(`ENV ${pem} ${pem}`), 'SSL_CERT_FILE → NODE_EXTRA_CA_CERTS and PIP_CERT', pr({ SSL_CERT_FILE: pem }));
check(pr({ SSL_CERT_FILE: pem, LAB_NETENV: 'off' }).includes('ENV undefined undefined'), 'LAB_NETENV=off leaves the environment alone');

// 3. bg / wait / stop
r = lab(['bg', 'bds', 'help']);
check(/started: bds help/.test(r.text), 'bg starts a job', r.text);
for (let i = 0; i < 20 && !/DONE exit/.test(r.text); i++) r = lab(['wait', '5']);
check(/topics:/.test(r.text) && /DONE exit=0/.test(r.text), 'wait prints the output, then DONE exit=0', r.text);
r = lab(['wait', '1']);
check(!/topics:/.test(r.text) && /DONE exit=0/.test(r.text), 'wait again prints only what is new', r.text);
// a long job: a sleeper registered as the bg job (the same record bg writes)
const sl = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { detached: true, stdio: 'ignore' }); sl.unref();
fs.writeFileSync(path.join(REPO, '.lab-run.json'), JSON.stringify({ pid: sl.pid, cmd: 'sleeper', start: Date.now(), seen: 0 })); fs.writeFileSync(path.join(REPO, '.lab-run.txt'), '');
const long = { status: 0 };
r = lab(['wait', '1']);
check(long.status === 0 && /RUNNING \d+s: sleeper/.test(r.text), 'wait returns RUNNING while the job runs', r.text);
r = lab(['bg', 'bds', 'help']);
check(/ERR a bg job is running/.test(r.text), 'one bg job at a time', r.text);
r = lab(['stop']); const r2 = lab(['wait', '1']);
check(/stopped: sleeper/.test(r.text) && /DONE exit=stopped/.test(r2.text), 'stop ends the job', r.text + r2.text);

// 4. setup all reports each lab on one line (here: no BDS, no network → each fails with its reason)
r = lab(['setup', 'all'], { LAB_BDS_ZIP: path.join(T, 'nope.zip'), LAB_LL_SERVER: path.join(T, 'nope') }, 300000);
check(/^bds: .+/m.test(r.text) && /^end: .+/m.test(r.text) && /^ll: .+/m.test(r.text) && /^(OK|FAIL)/m.test(r.text.trim().split('\n').at(-1)), 'setup all: one line per lab, then OK/FAIL', r.text);

// 5. cache export → import
fs.mkdirSync(path.join(REPO, 'bds', '.lab', 'bds'), { recursive: true }); fs.writeFileSync(path.join(REPO, 'bds', '.lab', 'bds', 'VERSION'), '1.2.3');
fs.mkdirSync(path.join(REPO, 'bds', '.lab', 'run', 'x'), { recursive: true });
const tgz = path.join(T, 'c.tgz');
r = lab(['cache', 'export', tgz]);
const list = spawnSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).stdout ?? '';
check(r.code === 0 && /bds\/\.lab\/bds\/VERSION/.test(list) && !/\.lab\/run\//.test(list), 'cache export: servers/tools in, instances out', r.text + list);
fs.rmSync(path.join(REPO, 'bds', '.lab'), { recursive: true, force: true });
r = lab(['cache', 'import', tgz]);
check(r.code === 0 && fs.readFileSync(path.join(REPO, 'bds', '.lab', 'bds', 'VERSION'), 'utf8') === '1.2.3' && /OK imported/.test(r.text), 'cache import restores it', r.text);

}
if (part(2)) {
// 6. the chat relay: handoff (zip for the person, keeps the current unit) → verify (paste-ready block) on a (fake) server
{
  const cache = path.join(T, 'cache-bds'), bds = path.join(cache, 'bds');
  fs.mkdirSync(bds, { recursive: true }); fs.writeFileSync(path.join(bds, 'VERSION'), '1.26.51.1\n'); fs.writeFileSync(path.join(bds, 'server.properties'), 'server-name=fake\n');
  fs.writeFileSync(path.join(bds, 'bedrock_server'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(TOP, 'tests', 'fake', 'fake_server.cjs')}" bds\n`); fs.chmodSync(path.join(bds, 'bedrock_server'), 0o755);
  fs.mkdirSync(path.join(cache, 'world'), { recursive: true }); fs.writeFileSync(path.join(cache, 'world', 'level.dat'), Buffer.alloc(16));
  fs.writeFileSync(path.join(cache, 'beta.json'), JSON.stringify({ server: '2.8.0-beta', 'server-gametest': '1.0.0-beta' }));
  const env = { LAB_CACHE: cache, LAB_RUNTIME: 'native', LAB_NOTRACE: '1', LAB_TYPES: '0', NO_COLOR: '1', npm_config_registry: 'http://127.0.0.1:9/', npm_config_fetch_retries: '0', npm_config_fetch_timeout: '2000' };
  r = lab(['bds', 'new', 'relay', 'Relay', '--js'], env);
  fs.writeFileSync(path.join(REPO, 'bds', 'addons', 'relay', 'tests.txt'), '## says hello\nsay relay-hello\n~ relay-hello\n');
  const outDir = path.join(T, 'handoff');
  // vendored code keeps its dist/ (what `lan` runs); a lab's dist/ (built .mcaddon) does not travel
  const vend = path.join(REPO, 'common', 'nethernet-connect', 'dist', 'src', 'index.js'), hadVend = fs.existsSync(vend);
  if (!hadVend) { fs.mkdirSync(path.dirname(vend), { recursive: true }); fs.writeFileSync(vend, 'export {};\n'); }
  fs.mkdirSync(path.join(REPO, 'bds', 'dist'), { recursive: true }); fs.writeFileSync(path.join(REPO, 'bds', 'dist', 'Old.mcaddon'), 'x');
  r = lab(['handoff', outDir], env);
  const z = path.join(outDir, 'bds-lab-bds-relay.zip'), names = fs.existsSync(z) ? spawnSync('unzip', ['-Z1', z], { encoding: 'utf8' }).stdout ?? '' : '';
  check(/OK .*bds-lab-bds-relay\.zip/.test(r.text) && /bds-lab\/bds\/\.lab\/addon/.test(names) && !/\.lab\/(bds|run|world)\//.test(names) && /bds-lab\/bds\/addons\/relay\/bp\/manifest\.json/.test(names), 'handoff: one zip, no caches, the current unit kept', r.text + names.slice(0, 400));
  check(/^bds-lab\/common\/nethernet-connect\/dist\/src\/index\.js$/m.test(names) && !/^bds-lab\/bds\/dist\//m.test(names), 'handoff: vendored common/nethernet-connect/dist kept, the lab\'s dist/ left out', names.split('\n').filter((l) => /dist\//.test(l)).join(' '));
  if (!hadVend) fs.rmSync(path.join(REPO, 'common', 'nethernet-connect', 'dist'), { recursive: true, force: true });
  fs.rmSync(path.join(REPO, 'bds', 'dist'), { recursive: true, force: true });
  r = lab(['verify'], env, 300000);
  check(/===== bds-lab verify/.test(r.text) && /unit relay/.test(r.text) && /^test: PASS/m.test(r.text) && /^pack: OK/m.test(r.text) && fs.existsSync(path.join(REPO, 'verify-result.txt')), 'verify: check + test + pack as one paste-ready block', r.text);
  fs.writeFileSync(path.join(REPO, 'bds', 'addons', 'relay', 'tests.txt'), '## wrong\nsay one\n~ two\n');
  r = lab(['verify'], env, 300000);
  check(/^test: FAILED/m.test(r.text) && /✘|FAIL|wrong/.test(r.text) && r.code === 1, 'verify: a failing test shows what failed', r.text);
  // --watch: stays open; a patch copied later is applied and verified by itself, the result replaces it on the clipboard
  const clip = path.join(T, 'clipboard.txt'); fs.writeFileSync(clip, 'something else');
  const w = spawn(process.execPath, [path.join(REPO, 'lab.mjs'), 'verify', '--watch'], { cwd: REPO, env: { ...clean, ...env, LAB_CLIPBOARD_FILE: clip, LAB_WATCH_POLLS: '120' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let wout = ''; w.stdout.on('data', (b) => { wout += b; }); w.stderr.on('data', (b) => { wout += b; });
  for (let i = 0; i < 1200 && !/watching the clipboard/.test(wout); i++) await sleep(250);   // (verify runs QA too: minutes)
  fs.writeFileSync(clip, 'AI: here is the fix\n~~~~\n===== bds-lab patch w1 (1 files) =====\n@@@ file bds/addons/relay/tests.txt was=?\n## fixed\nsay fixed\n~ fixed\n===== end patch w1 =====\n~~~~\n');
  for (let i = 0; i < 1200 && !/patch w1 applied/.test(fs.readFileSync(clip, 'utf8')); i++) await sleep(250);
  const got = fs.readFileSync(clip, 'utf8');
  w.kill();
  check(/patch w1 applied/.test(got) && /^test: PASS/m.test(got) && /watching the clipboard/.test(wout), 'verify --watch: a copied patch is applied, verified and the result copied back by itself', wout.slice(-1500) + '\n--clip--\n' + got);
}

// 6b. patches: the chat copy's changes as one text block → another copy (the person's PC) gets the same files
{
  const PC = path.join(T, 'pc');
  fs.cpSync(REPO, PC, { recursive: true, filter: (x) => !/[\\/](\.lab|\.lab-base\.json)$/.test(x) });
  fs.rmSync(path.join(REPO, '.lab-base.json'), { force: true });
  lab(['doctor'], {}, 120000);   // the first command here records the starting point
  const U = path.join(REPO, 'bds', 'addons', 'relay');
  fs.writeFileSync(path.join(U, 'tests.txt'), '## patched\nsay patched\n~ patched\n');
  fs.writeFileSync(path.join(U, 'rp', 'extra.bin'), Buffer.from([0, 1, 2, 255]));
  fs.writeFileSync(path.join(REPO, 'bds', 'lab.mjs'), fs.readFileSync(path.join(REPO, 'bds', 'lab.mjs')));   // unchanged content: not in the patch
  fs.rmSync(path.join(REPO, 'bds', 'README.md'));
  r = lab(['patch']);
  const pf = path.join(REPO, '.lab-patch.txt');
  check(/===== bds-lab patch \w+ \(3 files\) =====/.test(r.text) && /@@@ meta lab=bds unit=relay/.test(r.text) && /@@@ b64 bds\/addons\/relay\/rp\/extra\.bin/.test(r.text) && /@@@ delete bds\/README\.md/.test(r.text), 'patch: changed, binary and deleted files, with the lab and unit', r.text);
  const wrapped = path.join(T, 'wrapped.txt');
  fs.writeFileSync(wrapped, ('Here is the fix:\n```\n' + fs.readFileSync(pf, 'utf8') + '```\nThanks').replace(/\n/g, '\r\n'));   // as copied from a chat
  const pr = spawnSync(process.execPath, [path.join(PC, 'lab.mjs'), 'apply', wrapped], { cwd: PC, encoding: 'utf8', env: clean });
  const same = (rel) => fs.readFileSync(path.join(PC, rel)).equals(fs.readFileSync(path.join(REPO, rel)));
  check(/OK patch \w+: 3 of 3/.test(pr.stdout) && same('bds/addons/relay/tests.txt') && same('bds/addons/relay/rp/extra.bin') && !fs.existsSync(path.join(PC, 'bds', 'README.md')), 'apply: the other copy ends up with the same files (CRLF, code fences, prose around it)', pr.stdout + pr.stderr);
  const pr2 = spawnSync(process.execPath, [path.join(PC, 'lab.mjs'), 'apply', wrapped], { cwd: PC, encoding: 'utf8', env: clean });
  check(/0 of 3/.test(pr2.stdout), 'apply again: nothing to do (patches are cumulative, safe to repeat)', pr2.stdout);
  // a one-line fix in a big file travels as a line edit, not the whole file; the newest patch alone catches a copy up
  const big = 'bds/addons/relay/big.js', lines = Array.from({ length: 400 }, (_, i) => `const v${i} = ${i};`);
  fs.writeFileSync(path.join(REPO, big), lines.join('\n') + '\n'); fs.writeFileSync(path.join(PC, big), lines.join('\n') + '\n');
  const rebase = (dir) => { const b = JSON.parse(fs.readFileSync(path.join(dir, '.lab-base.json'), 'utf8')); b[big] = spawnSync(process.execPath, ['-e', `process.stdout.write(require('crypto').createHash('sha1').update(require('fs').readFileSync(process.argv[1])).digest('hex').slice(0,12))`, path.join(dir, big)], { encoding: 'utf8' }).stdout; fs.writeFileSync(path.join(dir, '.lab-base.json'), JSON.stringify(b)); fs.mkdirSync(path.dirname(path.join(dir, '.lab', 'base', big)), { recursive: true }); fs.copyFileSync(path.join(dir, big), path.join(dir, '.lab', 'base', big)); };
  rebase(REPO); lab(['bds', 'help']); spawnSync(process.execPath, [path.join(PC, 'lab.mjs'), 'bds', 'help'], { cwd: PC, env: clean }); rebase(PC);
  lines[199] = 'const v199 = "fixed";'; fs.writeFileSync(path.join(REPO, big), lines.join('\n') + '\n');
  r = lab(['patch']);
  const edit = r.text.match(/@@@ edit bds\/addons\/relay\/big\.js was=\w+ now=\w+\n@ 200 1\n\+const v199 = "fixed";\n/);
  check(edit && r.text.length < 12000, 'patch: a one-line fix in a 400-line file is sent as a line edit', r.text.slice(0, 800));
  lines.push('const extra = 1;'); fs.writeFileSync(path.join(REPO, big), lines.join('\n') + '\n');
  lab(['patch']);   // the second patch (cumulative); the person never applied the one above
  const p2 = path.join(T, 'p2.txt'); fs.copyFileSync(path.join(REPO, '.lab-patch.txt'), p2);
  let ap = spawnSync(process.execPath, [path.join(PC, 'lab.mjs'), 'apply', p2], { cwd: PC, encoding: 'utf8', env: clean });
  check(/^OK patch/m.test(ap.stdout) && fs.readFileSync(path.join(PC, big)).equals(fs.readFileSync(path.join(REPO, big))), 'apply: the newest patch alone brings a copy up to date (edits start from the base copy)', ap.stdout + ap.stderr);
  // a slip while copying (one character) is caught; nothing at all is written
  lines[10] = 'const v10 = "again";'; fs.writeFileSync(path.join(REPO, big), lines.join('\n') + '\n'); lab(['patch']);
  const garbled = fs.readFileSync(path.join(REPO, '.lab-patch.txt'), 'utf8').replace('"again"', '"agian"'), gf = path.join(T, 'garbled.txt'); fs.writeFileSync(gf, garbled);
  const before = fs.readFileSync(path.join(PC, big));
  ap = spawnSync(process.execPath, [path.join(PC, 'lab.mjs'), 'apply', gf], { cwd: PC, encoding: 'utf8', env: clean });
  check(ap.status === 1 && /garbled in the copy/.test(ap.stdout) && fs.readFileSync(path.join(PC, big)).equals(before), 'apply: a garbled copy is caught by checksum and nothing is written', ap.stdout);
  const vr = spawnSync(process.execPath, [path.join(PC, 'lab.mjs'), 'verify', gf], { cwd: PC, encoding: 'utf8', env: clean });
  check(vr.status === 1 && /NOT APPLIED/.test(vr.stdout) && /garbled/.test(vr.stdout) && /patch --full/.test(vr.stdout), 'verify <patch.txt>: a garbled patch is reported for the chat instead of testing old files', vr.stdout);
  fs.rmSync(path.join(REPO, big)); fs.rmSync(path.join(PC, big));
  const hand = path.join(T, 'hand.txt');   // a patch written by an AI that cannot run commands
  fs.writeFileSync(hand, '===== bds-lab patch hand1 (1 files) =====\n@@@ file bds/addons/relay/src/note.ts was=?\nexport const note = 1;\n===== end patch hand1 =====\n');
  const pr3 = spawnSync(process.execPath, [path.join(PC, 'lab.mjs'), 'apply', hand], { cwd: PC, encoding: 'utf8', env: clean });
  check(/1 of 1/.test(pr3.stdout) && fs.readFileSync(path.join(PC, 'bds/addons/relay/src/note.ts'), 'utf8') === 'export const note = 1;\n', 'apply: a hand-written patch (was=?) works', pr3.stdout);
  const evil = path.join(T, 'evil.txt');
  fs.writeFileSync(evil, '===== bds-lab patch e1 (1 files) =====\n@@@ file ../outside.txt was=?\nx\n===== end patch e1 =====\n');
  const pr4 = spawnSync(process.execPath, [path.join(PC, 'lab.mjs'), 'apply', evil], { cwd: PC, encoding: 'utf8', env: clean });
  check(!fs.existsSync(path.join(T, 'outside.txt')) && /skipped/.test(pr4.stdout), 'apply: nothing outside the folder is written', pr4.stdout);
  fs.rmSync(path.join(REPO, 'bds', 'addons', 'relay', 'rp', 'extra.bin'), { force: true });
  fs.rmSync(path.join(REPO, 'bds', 'addons', 'relay', 'src'), { recursive: true, force: true });
  fs.writeFileSync(path.join(REPO, 'bds', 'README.md'), '# bds\n');
}

// 7. offline build: TypeScript already on the machine turns src/ into bp/scripts without the network
{
  const U = path.join(REPO, 'bds', 'addons', 'relay');
  fs.mkdirSync(path.join(U, 'src'), { recursive: true });
  fs.writeFileSync(path.join(U, 'src', 'util.ts'), 'export const twice = (n: number): number => n * 2;\n');
  fs.writeFileSync(path.join(U, 'src', 'main.ts'), "import { world } from '@minecraft/server';\nimport { twice } from './util';\nconsole.warn(twice(2), world);\n");
  const noNet = { LAB_CACHE: path.join(T, 'cache-empty'), LAB_BDS_ZIP: '', npm_config_registry: 'http://127.0.0.1:9/', npm_config_fetch_retries: '0', npm_config_fetch_timeout: '2000' };
  r = lab(['bds', 'check'], noNet, 200000);
  const main = path.join(U, 'bp', 'scripts', 'main.js');
  const hasTs = /offline build/.test(r.text);
  if (hasTs) check(fs.existsSync(main) && /from '\.\/util\.js'/.test(fs.readFileSync(main, 'utf8')) && fs.existsSync(path.join(U, 'bp', 'scripts', 'util.js')), 'offline build: src/*.ts → bp/scripts/*.js with .js imports', r.text);
  else check(/no TypeScript on this machine|build tools unavailable/.test(r.text), 'offline build: without TypeScript it says what to do', r.text);
}

// 7a. carry: types saved by verify make the offline check real (a wrong API call is an E line, a right one passes)
{
  const U = path.join(REPO, 'bds', 'addons', 'relay'), sdk = path.join(T, 'fake-sdk'), nm = path.join(sdk, 'node_modules');
  const put = (rel, t) => { fs.mkdirSync(path.dirname(path.join(nm, rel)), { recursive: true }); fs.writeFileSync(path.join(nm, rel), t); };
  put('@minecraft/server/package.json', '{"name":"@minecraft/server","version":"2.11.0-beta.1.26.51-stable","types":"index.d.ts"}');
  put('@minecraft/server/index.d.ts', 'export declare class World { sendMessage(m: string): void; }\nexport declare const world: World;\n');
  put('@bedrock-apis/env-types/package.json', '{"name":"@bedrock-apis/env-types","version":"1.1.0","types":"index.d.ts"}');
  put('@bedrock-apis/env-types/index.d.ts', 'declare var console: { warn(...a: any[]): void; log(...a: any[]): void };\ninterface Array<T> { length: number; [n: number]: T } interface Boolean {} interface Function {} interface IArguments {} interface Number {} interface Object {} interface RegExp {} interface String {} interface CallableFunction {} interface NewableFunction {}\n');
  const { carrySave } = await import(new URL('../common/build.mjs', import.meta.url).href);
  const cr = carrySave(sdk, path.join(REPO, 'carry', 'bds-types.json.gz'), { bds: '1.26.51.1', lab: 'bds', modules: [] });
  const noNet = { LAB_CACHE: path.join(T, 'cache-carry'), npm_config_registry: 'http://127.0.0.1:9/', npm_config_fetch_retries: '0', npm_config_fetch_timeout: '2000' };
  fs.writeFileSync(path.join(U, 'src', 'main.ts'), "import { world } from '@minecraft/server';\nexport function hi() { world.sendMesage('x'); }\n");
  r = lab(['bds', 'check'], noNet, 200000);
  // (off Linux there is no BDS build and no docker: "scripts not type checked" and OK, as it should: no type check to catch a call with)
  if (process.platform !== 'linux' && /^W build tools unavailable/m.test(r.text) && /not type checked/.test(r.text)) console.log('SKIP carry: offline check catches a wrong @minecraft API call: no type check on this machine (Linux with docker only)');
  else check(cr.count === 4 && /^E src\/main\.ts:2 .*sendMesage/m.test(r.text) && /types from carry\//.test(r.text), 'carry: offline check catches a wrong @minecraft API call', r.text);
  fs.writeFileSync(path.join(U, 'src', 'main.ts'), "import { world } from '@minecraft/server';\nexport function hi() { world.sendMessage('x'); }\n");   // (in a function: world.* at the top level is an E of its own)
  r = lab(['bds', 'check'], noNet, 200000);
  check(r.code === 0 && !/^E /m.test(r.text), 'carry: the right call passes offline', r.text);
  r = lab(['bds', 'api', 'World'], noNet, 120000);
  check(/sendMessage/.test(r.text), 'carry: api answers offline from the carried types', r.text);
  fs.rmSync(path.join(REPO, 'carry'), { recursive: true, force: true });
}

// 7b. ll offline: one bundled script (LSE loads a single file) that runs, with relative imports
{
  const noNet = { LAB_CACHE: path.join(T, 'cache-ll-empty'), npm_config_registry: 'http://127.0.0.1:9/', npm_config_fetch_retries: '0', npm_config_fetch_timeout: '2000' };
  r = lab(['ll', 'new', 'offmod', 'OffMod'], noNet, 120000);
  const M = path.join(REPO, 'll', 'mods', 'offmod');
  if (fs.existsSync(path.join(M, 'src', 'main.ts'))) {
    fs.writeFileSync(path.join(M, 'src', 'util.ts'), 'export const add = (a: number, b: number) => a + b;\n');
    fs.writeFileSync(path.join(M, 'src', 'main.ts'), 'import { add } from "./util";\nglobalThis.__labOut = add(2, 3);\n');
    r = lab(['ll', 'pack'], noNet, 200000);
    const js = spawnSync('sh', ['-c', `unzip -p "${path.join(REPO, 'll', 'dist')}"/offmod-*.zip "offmod/offmod.js"`], { encoding: 'utf8' }).stdout ?? '';
    let v = null; try { v = new Function(`${js}\nreturn globalThis.__labOut;`)(); } catch (e) { v = e.message; }
    if (/offline build/.test(r.text)) check(v === 5, 'll offline: one bundled script that runs (relative imports)', r.text + ' → ' + v);
    else check(/no TypeScript/.test(r.text), 'll offline: without TypeScript it says what to do', r.text);
  } else check(false, 'll offline: new works without network', r.text);
}

// 7c. end: a portable Python when the machine has none usable (release list + tarball served locally like GitHub would)
if (process.platform === 'linux' && process.arch === 'x64') {
  const web = path.join(T, 'web'); fs.mkdirSync(path.join(web, 'python', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(web, 'python', 'bin', 'python3'), '#!/bin/sh\necho portable\n'); fs.chmodSync(path.join(web, 'python', 'bin', 'python3'), 0o755);
  const name = 'cpython-3.12.9+20250317-x86_64-unknown-linux-gnu-install_only.tar.gz';
  spawnSync('tar', ['-czf', path.join(web, name), '-C', web, 'python']);
  // a separate process: the download runs in a sync child, which would deadlock a server in this process
  const srv = spawn(process.execPath, ['-e', `const fs=require('fs'),path=require('path');const s=require('http').createServer((q,r)=>{const f=path.join(process.argv[1],decodeURIComponent(q.url.slice(1)));if(fs.existsSync(f)&&fs.statSync(f).isFile())r.end(fs.readFileSync(f));else{r.writeHead(404);r.end()}});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))`, web], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((res) => srv.stdout.once('data', (b) => res(String(b).trim())));
  const base = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(web, 'release.json'), JSON.stringify({ assets: [{ name: 'cpython-3.11.1+x-x86_64-unknown-linux-gnu-install_only.tar.gz', browser_download_url: base + '/nope' }, { name, browser_download_url: `${base}/${encodeURIComponent(name)}` }] }));
  process.env.LAB_PYTHON_RELEASE = `${base}/release.json`;
  const { portablePython } = await import(new URL('../end/flavor.mjs', import.meta.url).href);
  const said = [], cache = path.join(T, 'cache-py');
  const py = await new Promise((res) => setImmediate(() => res(portablePython({ RT: { kind: 'native' }, CACHE: cache, out: (x) => said.push(x) }))));
  srv.kill(); delete process.env.LAB_PYTHON_RELEASE;
  const ran = py && spawnSync(py.cmd, [], { encoding: 'utf8' }).stdout.trim();
  check(py?.portable && ran === 'portable' && /portable Python 3\.12/.test(said.join(' ')), 'end: portable Python 3.12 fetched when none is usable', JSON.stringify(py) + said.join(' '));
}

// 8. lab.sh runs the lab with the Node it finds (22+)
if (process.platform !== 'win32') {
  const s = spawnSync('sh', [path.join(REPO, 'lab.sh'), 'bds', 'help'], { cwd: REPO, encoding: 'utf8', env: clean });
  check(s.status === 0 && /topics:/.test(s.stdout), 'lab.sh runs the lab', s.stdout + s.stderr);
}

}
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
