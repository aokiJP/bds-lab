#!/usr/bin/env node
// Offline tests of app/redroid/local.mjs (redroid.yml's preparation on this machine, no Actions): the stages' order, what
// --dry-run prints (and that it runs nothing), the secrets never printed. No binder, no redroid: plan() and local() with
// facts of our own, and the command line with a fake docker / adb / sudo / modprobe first on PATH. node tests/rd-local-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as L from '../app/redroid/local.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(TOP, 'app', 'redroid', 'local.mjs');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-rdlocal-'));
let bad = 0, good = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✔' : '✘'} ${what}${ok || !detail ? '' : '\n    ' + String(detail).trim().split('\n').slice(-12).join('\n    ')}`); ok ? good++ : bad++; };
const isOrdered = (ids) => ids.every((id, i) => i === 0 || L.ORDER.indexOf(ids[i - 1]) < L.ORDER.indexOf(id));

// ---- 1. plan(): which stages, in which order (pure) ----
const all = { platform: 'linux', kernel: '6.8.0', docker: true, dockerd: true, binder: true, overlay: true, sudo: true, adb: true, python3: true, tesseract: true, uinput: true, image: true, prepared: true, account: true, resident: false, sealed: false, key: false, root: true };
const o = L.options(['--data', path.join(T, 'data'), '--file', path.join(T, 'data.bin')], { PATH: '/usr/bin' });
const ids = (f, oo = o) => L.plan({ ...all, ...f }, oo).stages.map((s) => s.id);
check(JSON.stringify(ids({})) === '["doctor"]', 'plan: nothing missing → doctor only', ids({}));
const fresh = { binder: false, image: false, prepared: false, sealed: true, key: true };
check(JSON.stringify(ids(fresh)) === '["doctor","binder","image","open","prep"]', 'plan: everything missing → doctor → binder → image → open → prep', ids(fresh));
check(JSON.stringify(ids(fresh, { ...o, bench: true })) === '["doctor","binder","image","open","prep","bench"]' && isOrdered(ids(fresh, { ...o, bench: true })), 'plan: --bench comes last', ids(fresh, { ...o, bench: true }));
check(JSON.stringify(ids({ prepared: false })) === '["doctor","prep"]', 'plan: no sealed file → prep only (no open)', ids({ prepared: false }));
check(JSON.stringify(ids({ prepared: false, sealed: true, key: false })) === '["doctor","prep"]', 'plan: a sealed file but no key → no open', ids({ prepared: false, sealed: true }));
check(JSON.stringify(ids({ image: false })) === '["doctor","image"]', 'plan: the image only', ids({ image: false }));
const soft = L.plan({ ...all, uinput: false }, o).stages;
check(soft[1]?.id === 'binder' && /uinput/.test(soft[1].say) && !/binder_linux/.test(soft[1].cmds[0].show) && /modprobe uinput/.test(soft[1].cmds[0].show), 'plan: only uinput missing → modprobe uinput, not binder', JSON.stringify(soft[1]));
const bin = L.plan({ ...all, binder: false }, o).stages[1];
check(/^sh -c 'modprobe binder_linux devices=binder,hwbinder,vndbinder \|\| \{ apt-get install -y -qq linux-modules-extra-\$\(uname -r\) && modprobe binder_linux/.test(bin.cmds[0].show), 'plan: binder = modprobe, else linux-modules-extra then modprobe (as root: no sudo)', bin.cmds[0].show);
const user = L.plan({ ...all, root: false, binder: false, prepared: false, sealed: true, key: true }, o).stages;
check(user[1].cmds[0].argv.slice(0, 2).join(' ') === 'sudo -n' && /^sudo -n -E env PATH=\/usr\/bin /.test(user.find((s) => s.id === 'open').cmds[0].argv.join(' ')) && /^sudo -E node /.test(user.find((s) => s.id === 'open').cmds[0].show) && /^sudo -n chown -R /.test(user.find((s) => s.id === 'open').cmds[1].show), 'plan: not root → sudo -n (open keeps the environment: sudo -E), the .lab folder given back', JSON.stringify(user.map((s) => s.cmds.map((c) => c.show))));
check(!L.plan({ ...all, root: false }, o).stages.some((s) => s.cmds.some((c) => /PATH=\//.test(c.show))), 'plan: PATH shown as $PATH');
const noAcct = L.plan({ ...all, prepared: false, account: false }, o);
check(noAcct.blocked.some((b) => b.name === 'Google の認証' && /app token/.test(b.fix)), 'plan: no account and nothing to open → blocked (Google)', JSON.stringify(noAcct.blocked));
check(!L.plan({ ...all, prepared: false, account: false, sealed: true, key: true }, o).blocked.length, 'plan: no account but a sealed file and a key → not blocked (open may do)');
const noDocker = L.plan({ ...all, docker: false, dockerd: false, image: false }, o);
check(noDocker.blocked.map((b) => b.name).join() === 'docker' && /docs\.docker\.com/.test(noDocker.blocked[0].fix), 'plan: no docker → blocked with doctor\'s fix (a person installs it)', JSON.stringify(noDocker.blocked));
check(L.plan({ ...all, platform: 'darwin' }, o).blocked.some((b) => b.name === 'Linux'), 'plan: not Linux → blocked');
check(L.secretsLine({ GOOGLE_EMAIL: 'a@b.c', GOOGLE_AAS_TOKEN: 'aas_et/SECRETVALUE123' }) === 'GOOGLE_EMAIL あり、GOOGLE_AAS_TOKEN あり、APP_CACHE_KEY なし（値は出しません）', 'secretsLine: presence only', L.secretsLine({ GOOGLE_EMAIL: 'a@b.c', GOOGLE_AAS_TOKEN: 'x' }));

// ---- 2. local(): runs in order, judges each stage by the facts after it, stops where it must ----
const run = async (start, after, oo = {}) => {
  let f = { ...all, ...start }; const calls = [], lines = [];
  const r = await L.local({ ...o, ...oo }, { facts: () => ({ ...f }), exec: (argv) => { const s = argv.join(' '); calls.push(s); const fx = after(s, f); if (fx) f = { ...f, ...fx.facts }; return fx?.status ?? 0; }, log: (t) => lines.push(t), notice: (t, m) => lines.push(`${t}: ${m}`) });
  return { ...r, calls, lines };
};
const fixes = (s) => (/binder_linux/.test(s) ? { facts: { binder: true } } : / setup$/.test(s) ? { facts: { image: true } } : / open /.test(s) ? { facts: {} } : / prep /.test(s) ? { facts: { prepared: true } } : null);
let r = await run(fresh, fixes);
check(r.code === 0 && r.ran.join() === 'binder,image,open,prep' && /binder_linux/.test(r.calls[0]) && / setup$/.test(r.calls[1]) && / open /.test(r.calls[2]) && / prep /.test(r.calls[3]), 'local: binder → image → open → prep, each run once', r.calls.join('\n') + '\n' + r.lines.join('\n'));
const says = r.lines.filter((l) => /^→ /.test(l));
check(says.length === 5 && says.every((l, i) => l.startsWith(`→ ${i + 1}/5 ${['doctor', 'binder', 'image', 'open', 'prep'][i]}: `)), 'local: one line before each stage (→ i/n id: what)', says.join('\n'));
check(Object.keys(r.times).join() === 'binder,image,open,prep' && Object.values(r.times).every((s) => typeof s === 'number') && r.lines.filter((l) => /^local: (binder|image|open|prep): [\d.]+ 秒$/.test(l)).length === 4 && r.lines.some((l) => /^local: 合計: [\d.]+ 秒（binder /.test(l)), 'local: every stage timed (one notice each, and the total)', JSON.stringify(r.times) + '\n' + r.lines.join('\n'));
r = await run(fresh, (s) => (/ open /.test(s) ? { facts: { prepared: true } } : fixes(s)));
check(r.code === 0 && r.ran.join() === 'binder,image,open' && r.lines.some((l) => /prep は飛ばします/.test(l)), 'local: open restored it → prep skipped', r.lines.join('\n'));
r = await run(fresh, (s) => (/binder_linux/.test(s) ? { status: 1 } : fixes(s)));
check(r.code === 1 && r.ran.join() === 'binder' && r.calls.length === 1 && r.lines.some((l) => /binder の後も直っていません: sudo modprobe binder_linux/.test(l)), 'local: binder still missing → stops before the image', r.lines.join('\n'));
r = await run(fresh, (s) => (/binder_linux/.test(s) ? { status: 0 } : fixes(s)));
check(r.code === 1 && r.calls.length === 1, 'local: modprobe exits 0 but doctor still sees no binder → stops (facts, not the exit code)', r.lines.join('\n'));
r = await run({ ...fresh, docker: false, dockerd: false }, fixes);
check(r.code === 1 && r.calls.length === 0 && r.lines.some((l) => /✘ docker: .*→ /.test(l)), 'local: blocked (no docker) → nothing run, the fix printed', r.lines.join('\n'));
r = await run({ prepared: false, account: false, sealed: true, key: true }, () => null);
check(r.code === 1 && r.ran.join() === 'open' && r.lines.some((l) => /✘ prep: GOOGLE_EMAIL/.test(l)), 'local: open failed and no account → stops at prep with the fix', r.lines.join('\n'));
r = await run(fresh, fixes, { dryRun: true });
check(r.code === 0 && r.calls.length === 0 && r.lines.filter((l) => /^→ /.test(l)).length === 5 && r.lines.filter((l) => /^ {4}\$ /.test(l)).length === 4, 'local --dry-run: every stage and command printed, nothing run', r.lines.join('\n'));
r = await run({ ...fresh, docker: false, dockerd: false }, fixes, { dryRun: true });
check(r.code === 1 && r.calls.length === 0 && r.lines.filter((l) => /^→ /.test(l)).length === 5, 'local --dry-run when blocked: still the whole plan, exit 1', r.lines.join('\n'));

// ---- 3. the command line: --dry-run with fakes first on PATH (they log every call: nothing may change the machine) ----
const BIN = path.join(T, 'bin'), CALLS = path.join(T, 'calls.txt');
fs.mkdirSync(BIN, { recursive: true });
const fake = (name, body) => { fs.writeFileSync(path.join(BIN, name), `#!/bin/sh\necho "${name} $*" >> "${CALLS}"\n${body}\n`); fs.chmodSync(path.join(BIN, name), 0o755); };
fake('docker', 'case "$1" in --version|info) echo 27.0; exit 0;; esac\nexit 1');
fake('adb', 'case "$1" in version) echo "Android Debug Bridge"; exit 0;; esac\nexit 1');
fake('sudo', 'while [ "${1#-}" != "$1" ]; do shift; done\nexec "$@"');
for (const n of ['modprobe', 'apt-get', 'mount', 'umount', 'chown']) fake(n, 'exit 0');
const ENVF = path.join(T, 'env.local');
const SECRET = 'aas_et/THIS-IS-NOT-A-REAL-TOKEN-0123456789', MAIL = 'someone.private@example.com';
fs.writeFileSync(ENVF, `GOOGLE_EMAIL=${MAIL}\nGOOGLE_AAS_TOKEN="${SECRET}"\n`);
fs.writeFileSync(path.join(T, 'data.bin'), 'sealed');
const env = { ...process.env, PATH: `${BIN}:${process.env.PATH}`, APP_ENV_FILE: ENVF, ADB: path.join(BIN, 'adb'), GITHUB_ACTIONS: '' };
for (const k of ['GOOGLE_EMAIL', 'GOOGLE_AAS_TOKEN', 'APP_CACHE_KEY', 'ANDROID_HOME', 'ANDROID_SDK_ROOT']) delete env[k];
const cli = (args, e = env) => { fs.rmSync(CALLS, { force: true }); const p = spawnSync(process.execPath, [LOCAL, ...args], { cwd: TOP, encoding: 'utf8', env: e, timeout: 120_000 }); return { code: p.status, text: (p.stdout ?? '') + (p.stderr ?? ''), calls: fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8') : '' }; };
let c = cli(['--dry-run', '--data', path.join(T, 'data'), '--file', path.join(T, 'data.bin'), '--bench', '--addon', 'jsonui_demo']);
const got = [...c.text.matchAll(/^→ \d+\/\d+ (\w+): /gm)].map((m) => m[1]);
check(c.code === 0 && got[0] === 'doctor' && isOrdered(got) && ['image', 'open', 'prep', 'bench'].every((id) => got.includes(id)), 'CLI --dry-run: doctor first, the stages in order (image, open, prep, bench)', c.text);
check(/GOOGLE_EMAIL あり、GOOGLE_AAS_TOKEN あり/.test(c.text) && !c.text.includes(SECRET) && !c.text.includes(MAIL), 'CLI: secrets read from the env file (APP_ENV_FILE), never printed', c.text);
check(/\$ node app\/redroid\/redroid\.mjs setup/.test(c.text) && /\$ node app\/redroid\/game\.mjs open --data /.test(c.text) && /\$ node app\/redroid\/game\.mjs prep --data /.test(c.text) && /\$ node app\/redroid\/game\.mjs bench .*--rounds 3/.test(c.text) && /次にやること: node lab\.mjs app run -a jsonui_demo --device redroid/.test(c.text), 'CLI --dry-run: each stage\'s command and the next step', c.text);
check(!/^(modprobe|apt-get|mount|umount|chown) |^docker (pull|build|run|rm)|^sudo (?!-n true$)/m.test(c.calls) && !fs.existsSync(path.join(T, 'data')), 'CLI --dry-run: nothing that changes the machine was called', c.calls);
c = cli(['--dry-run', '--data', path.join(T, 'data'), '--file', path.join(T, 'none.bin')], { ...env, APP_ENV_FILE: path.join(T, 'missing.env'), GOOGLE_EMAIL: '', GOOGLE_AAS_TOKEN: '' });
check(c.code === 1 && /✘ Google の認証: .*→ node lab\.mjs app token/.test(c.text) && /止まります/.test(c.text) && !/→ \d+\/\d+ open:/.test(c.text), 'CLI --dry-run without the secrets or a sealed file: says what stops it, exit 1', c.text);
c = cli(['--help']);
check(c.code === 0 && /--dry-run/.test(c.text) && !c.calls, 'CLI --help: the header, nothing called', c.text);

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
