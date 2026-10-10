#!/usr/bin/env node
// Building from nothing (common/scratch.mjs, skill bds-from-scratch): the lessons are sound (every one has a level, an area,
// skills that exist, a request and hidden tests; the reference solution passes each in the sandbox and the empty template
// fails — several lessons at once with --jobs, the same lines as one at a time), `next`/`show` never print the hidden tests, `check` runs them on a unit and records the attempt, `stats` and `gaps`
// read the records, `probe` refuses to call a sandbox answer evidence without the live world, and the sandbox prints a
// player's chat the way the real client does (`@B chat <A> text`: the gap the lessons found). No server, no AI; the lab's real
// scratch records are never written (LAB_SCRATCH_STATE), nor its backlog (LAB_AUTO_ROOT).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).split('\n').slice(-16).join('\n  ')}`); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-scratch-')), ST = path.join(T, 'state'), AR = path.join(T, 'auto-root');
fs.mkdirSync(path.join(AR, 'auto'), { recursive: true });
const env = { LAB_SCRATCH_STATE: ST, LAB_AUTO_ROOT: AR, LAB_DOTENV: 'off', LAB_SKILL_READS: 'off' };
const lab = (args, e = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', timeout: 900000, env: { ...process.env, ...env, ...e } }); return { code: r.status, t: (r.stdout ?? '') + (r.stderr ?? '') }; };
const S = await import(pathToFileURL(path.join(TOP, 'common', 'scratch.mjs')).href);
const skills = fs.readdirSync(path.join(TOP, 'skills')).filter((x) => fs.existsSync(path.join(TOP, 'skills', x, 'SKILL.md')));

// the lessons
const L = S.lessons();
ok(L.length >= 16 && new Set(L.map((l) => l.id)).size === L.length, `${L.length} lessons, ids unique`, L.map((l) => l.id).join(' '));
ok(L.every((l) => Number.isInteger(l.level) && l.level >= 1 && l.area && l.prompt && l.test.some((x) => /^(=|~|!)/.test(x)) && l.teaches.length && l.teaches.every((s) => skills.includes(s))), 'each lesson: a level, an area, a request, hidden expectations, and the skills it teaches (all of them exist)', JSON.stringify(L.find((l) => !(l.level && l.area && l.teaches.length && l.teaches.every((s) => skills.includes(s))))));
ok(new Set(L.map((l) => l.level)).size >= 5 && L.every((l, i) => !i || L[i - 1].level <= l.level), 'levels 1..n in order (scratch next goes from the easiest)', L.map((l) => `${l.id}:${l.level}`).join(' '));

// list / next / show: the request, never the hidden tests
let r = lab(['scratch']);
ok(r.code === 0 && L.every((l) => r.t.includes(l.id)) && /0\/\d+ lessons passed on the real BDS/.test(r.t), 'scratch: every lesson by level, none passed yet (fresh records)', r.t);
r = lab(['scratch', 'next']);
const first = L.find((l) => l.lab === 'bds');
ok(r.code === 0 && new RegExp(`^lesson ${first.id} \\(level ${first.level}`, 'm').test(r.t) && /scratch check \w+ --real/.test(r.t) && /bds-from-scratch/.test(r.t), 'scratch next: the easiest lesson and the steps (new, look up, sandbox check, real check)', r.t);
const calc = L.find((l) => l.id === 'calc');
r = lab(['scratch', 'show', 'calc']);
ok(r.code === 0 && r.t.includes(calc.prompt) && !calc.test.filter((x) => /^(=|~|!)/.test(x)).some((x) => r.t.includes(x)), 'scratch show: the request without a single hidden expectation', r.t);
r = lab(['scratch', 'check', 'nosuch']); ok(r.code !== 0 && /no lesson "nosuch"/.test(r.t), 'scratch check <unknown>: refused', r.t);

// the lessons are sound: the reference passes each in the sandbox, the empty template fails each (three lessons at once)
const zz = () => fs.readdirSync(path.join(TOP, 'bds', 'addons')).filter((u) => u.startsWith('zz_scratch_'));
r = lab(['scratch', 'selftest', '--jobs', '3']);
ok(r.code === 0 && /^PASS scratch selftest: \d+ lesson/m.test(r.t) && !zz().length, 'scratch selftest --jobs 3 (sandbox): every lesson solvable by the reference, failing on the empty template; temp units and their copies removed', r.t + zz().join(' '));
// one at a time (the default) prints the very same lines, in the lessons' order whatever order they were named in
{
  const table = (t) => t.split('\n').filter((l) => /^[✔✘] /.test(l)).join('\n');
  const one = lab(['scratch', 'selftest', 'sum', 'calc']), two = lab(['scratch', 'selftest', '--jobs', '2', 'calc', 'sum']);
  ok(one.code === 0 && two.code === 0 && table(one.t) === table(two.t) && table(one.t).split('\n').length === 2 && !zz().length, 'scratch selftest: one at a time and --jobs 2 print the same lines in the same order', `${one.t}\n---\n${two.t}`);
}

// check on a unit: one lesson built from nothing (here: by the test), recorded; broken → FAIL, recorded
{
  const u = 'scratch_calc', dir = path.join(TOP, 'bds', 'addons', u), cur = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : null;
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    lab(['bds', 'new', u, 'Calc', '--js']);
    const main = path.join(dir, 'bp', 'scripts', 'main.js');
    fs.writeFileSync(main, "import { cmd } from './kit.js';\ncmd('lab:add', 'Add', { a: 'int', b: 'int' }, (p, x) => '= ' + (x.a + x.b));\n");
    r = lab(['scratch', 'check', 'calc']);
    ok(r.code === 0 && /^PASS lesson calc in the sandbox/m.test(r.t) && /--real/.test(r.t), 'check calc on a right unit: PASS in the sandbox, and it says the verdict is --real', r.t);
    fs.writeFileSync(main, "import { cmd } from './kit.js';\ncmd('lab:add', 'Add', { a: 'int', b: 'int' }, (p, x) => '= ' + (x.a - x.b));\n");
    r = lab(['scratch', 'check', 'calc']);
    ok(r.code !== 0 && /^✘ calc/m.test(r.t) && /^FAIL lesson calc in the sandbox/m.test(r.t) && /never the test/.test(r.t), 'a wrong sum: FAIL, the failing section named', r.t);
    const rows = fs.readFileSync(path.join(ST, 'scratch.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    ok(rows.length === 2 && rows[0].pass && !rows[1].pass && rows[0].hash !== rows[1].hash && rows.every((x) => x.where === 'sim' && x.id === 'calc'), 'both checks recorded (sandbox, pass/fail, the code\'s hash differs)', JSON.stringify(rows));
    r = lab(['scratch', 'stats']);
    ok(r.code === 0 && /checks: 2 \(2 sandbox, 0 real\)/.test(r.t), 'scratch stats: the checks counted', r.t);
    r = lab(['scratch']);
    ok(/sim✔ +calc/.test(r.t), 'scratch: calc shows as passed in the sandbox (not done: the real BDS decides)', r.t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); if (cur0 === null) fs.rmSync(cur, { force: true }); else fs.writeFileSync(cur, cur0); }
}

// gaps: what the sandbox got wrong, and the backlog items for sandbox-be
fs.appendFileSync(path.join(ST, 'scratch-gaps.jsonl'), JSON.stringify({ at: '2026-10-03T00:00:00Z', id: 'filter', section: 'filter: a bad word stops, others pass', sim: 'FAIL', real: 'PASS', bds: '1.26.52.3', why: ['want ~ ^@B .*hi there'] }) + '\n');
r = lab(['scratch', 'gaps', '--backlog']);
const bl = fs.readFileSync(path.join(AR, 'auto', 'BACKLOG.md'), 'utf8');
ok(r.code === 0 && /filter :: filter: a bad word/.test(r.t) && /- \[ \] lab: sandbox-be disagrees with BDS 1\.26\.52\.3 on lesson filter/.test(bl), 'scratch gaps --backlog: the disagreement listed and filed for sandbox-be', r.t + bl);
r = lab(['scratch', 'gaps', '--backlog']);
ok(fs.readFileSync(path.join(AR, 'auto', 'BACKLOG.md'), 'utf8') === bl, 'filing again adds nothing twice', '');

// probe: without a live world the sandbox answer alone is not evidence
r = lab(['scratch', 'probe', '1 + 1'], { LAB_KIND: 'zz' });
ok(r.code !== 0 && /^sandbox: = 2/m.test(r.t) && /no live world/.test(r.t), 'scratch probe without a live server: the sandbox answer, and it refuses to call it evidence', r.t);
r = lab(['scratch', 'probe', '1 + 1', '--rule', 'x']); ok(r.code !== 0 && /--rule needs --skill/.test(r.t), 'probe --rule without --skill: refused', r.t);

// the sandbox gap the lessons found, fixed: a player's chat prints on every player as the real client prints it
{
  const u = path.join(T, 'chatunit');
  fs.mkdirSync(path.join(u, 'bp', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(u, 'bp', 'manifest.json'), JSON.stringify({ format_version: 2, header: { name: 'c', description: '', uuid: '6c1f3a52-9d7e-4c9b-a1f2-0b9e2d3c4a51', version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'script', language: 'javascript', uuid: '0d2e5b8f-3c1a-4e6d-9b7f-2a8c4e6f1b3d', version: [1, 0, 0], entry: 'scripts/main.js' }], dependencies: [{ module_name: '@minecraft/server', version: '2.0.0' }] }));
  fs.writeFileSync(path.join(u, 'bp', 'scripts', 'main.js'), "import { world } from '@minecraft/server';\n");
  fs.writeFileSync(path.join(u, 'tests.txt'), '## chat\n@A join\n@B join\n@A chat hi there\nwait 500\n~ ^@A chat <A> hi there$\n~ ^@B chat <A> hi there$\n!~ ^<A> hi there$\n');
  r = lab(['sim', '-a', u]);
  ok(r.code === 0 && /^PASS sim 1\/1/m.test(r.t), 'sim: `@A chat hi` prints `@A chat <A> hi there` and `@B chat <A> hi there` (it printed one bare line)', r.t);
}

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} scratch-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
