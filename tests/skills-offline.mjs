#!/usr/bin/env node
// Skills (common/skills.mjs + skills/): SKILL.md rule lines built from knowledge.json (and the check that fails when they
// drift), every skill under the size it is read whole at, each rule with evidence, the install forms for each AI, learning
// candidates from episodes and lessons, promotion only with evidence, verify on an offline test, and the A/B bench verdict.
// Works on a copy of skills/ (LAB_SKILLS_DIR): the real one is never written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const lab = (args, env = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', timeout: 600000, env: { ...process.env, LAB_DOTENV: 'off', LAB_SKILL_READS: 'off', ...env } }); return { code: r.status, t: (r.stdout ?? '') + (r.stderr ?? '') }; };

// the real skills: in step with knowledge.json, small, every rule with evidence and a skill that exists
let r = lab(['skill', 'build', '--check']);
ok(r.code === 0 && /^OK skills match skills\/knowledge\.json/m.test(r.t), 'skills/*/SKILL.md match skills/knowledge.json (node lab.mjs skill build)', r.t);
const K = JSON.parse(fs.readFileSync(path.join(TOP, 'skills', 'knowledge.json'), 'utf8'));
const names = fs.readdirSync(path.join(TOP, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(TOP, 'skills', e.name, 'SKILL.md'))).map((e) => e.name);
ok(K.rules.filter((x) => x.status === 'verified').every((x) => names.includes(x.skill) && ['test', 'probe', 'unit', 'measured', 'source'].includes(x.evidence?.kind) && x.rule.length > 20) && new Set(K.rules.map((x) => x.id)).size === K.rules.length, 'every verified rule: a skill that exists, evidence (test / probe / unit / measured / source), a unique id', JSON.stringify(K.rules.filter((x) => !names.includes(x.skill) || !x.evidence?.kind).map((x) => x.id)));
ok(K.rules.filter((x) => x.evidence?.kind === 'test').every((x) => fs.existsSync(path.join(TOP, x.evidence.ref))) && K.rules.filter((x) => x.evidence?.kind === 'probe').every((x) => fs.existsSync(path.join(TOP, x.evidence.ref, 'tests.txt')) && fs.existsSync(path.join(TOP, x.evidence.ref, 'bp', 'manifest.json'))) && K.rules.filter((x) => x.evidence?.kind === 'unit').every((x) => /^(bds\/addons|end\/plugins|ll\/mods)\/[\w-]+$/.test(x.evidence.ref) && fs.existsSync(path.join(TOP, x.evidence.ref, 'tests.txt'))), 'each test / probe / unit a rule names is there (a probe: bp/manifest.json + tests.txt; a unit: a lab unit with tests.txt)', JSON.stringify(K.rules.filter((x) => x.evidence?.kind === 'unit' && !fs.existsSync(path.join(TOP, x.evidence.ref, 'tests.txt'))).map((x) => x.evidence.ref)));
const sizes = names.map((x) => [x, fs.statSync(path.join(TOP, 'skills', x, 'SKILL.md')).size]);
ok(sizes.every(([, s]) => s <= 3200) && names.every((x) => /^---\nname: [\w-]+\ndescription: .{40,}\n---\n/.test(fs.readFileSync(path.join(TOP, 'skills', x, 'SKILL.md'), 'utf8'))), 'every SKILL.md: name and description up top (Claude Code / Codex format), at most 3.2 KB (it is read whole)', JSON.stringify(sizes));
r = lab(['skill']);
ok(names.every((x) => r.t.includes(x)) && /read one: node lab\.mjs skill <name>/.test(r.t), 'skill lists every skill with when to use it', r.t);
r = lab(['skill', 'bds-tests', '--raw']);
ok(/^---\nname: bds-tests/.test(r.t) && /`test-one-world`/.test(r.t), 'skill <name> --raw prints the file, with its rule lines', r.t);
r = lab(['skill', 'bds-tests']);
ok(/^# tests\.txt/.test(r.t) && /`~` is a regex/.test(r.t) && !/`test-regex`|rules:begin|^name:|ONE world/m.test(r.t), 'skill <name>: the reader view (no front matter, markers or ids; a rule AGENTS.md already says is left out)', r.t);

// a copy to change
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-skills-')), S = path.join(T, 'skills');
fs.cpSync(path.join(TOP, 'skills'), S, { recursive: true });
const env = { LAB_SKILLS_DIR: S };
const k2 = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8'));
k2.rules.push({ id: 'zz-new', skill: 'bds-tests', rule: 'A new rule that the build must put into the skill.', why: 'a test', evidence: { kind: 'measured', ref: 'here' }, status: 'verified' });
fs.writeFileSync(path.join(S, 'knowledge.json'), JSON.stringify(k2));
r = lab(['skill', 'build', '--check'], env);
ok(r.code !== 0 && /E skills out of date with skills\/knowledge\.json: bds-tests/.test(r.t), 'a rule added to knowledge.json and not built: the check fails, naming the skill', r.t);
r = lab(['skill', 'build'], env);
ok(r.code === 0 && /A new rule that the build must put into the skill\. \(when missed: a test\) `zz-new`/.test(fs.readFileSync(path.join(S, 'bds-tests', 'SKILL.md'), 'utf8')), 'skill build writes it into its SKILL.md', r.t);

// install: the form each AI reads
const P = path.join(T, 'project');
r = lab(['skill', 'install', 'all', '--to', P], env);
ok(r.code === 0 && [['.claude', 'skills'], ['.agents', 'skills'], ['.gemini', 'skills'], ['.github', 'skills'], ['.cursor', 'skills']].every((d) => fs.existsSync(path.join(P, ...d, 'bds-tests', 'SKILL.md'))) && !fs.existsSync(path.join(P, '.claude', 'skills', 'skill-forge')), 'install all: SKILL.md folders where each AI looks (Claude Code .claude, Codex / any agent .agents, Gemini .gemini, Copilot .github, Cursor .cursor); a lab-only skill stays out', r.t);
const routes = ['GEMINI.md', path.join('.github', 'copilot-instructions.md'), 'AGENTS.md'].map((f) => fs.readFileSync(path.join(P, f), 'utf8'));
ok(routes.every((x) => /bds-lab skills: begin/.test(x) && /skill <name>/.test(x) && /`bds-fix-addon`/.test(x)), 'Gemini / Copilot / any agent: a routing block naming each skill and how to read it', routes[0]);
fs.writeFileSync(path.join(P, 'AGENTS.md'), '# mine\nkeep this\n\n' + routes[2]);
lab(['skill', 'install', 'agents', '--to', P], env);
const ag = fs.readFileSync(path.join(P, 'AGENTS.md'), 'utf8');
ok(/^# mine\nkeep this/.test(ag) && ag.split('bds-lab skills: begin').length === 2, 'installing again replaces its block and keeps the rest of the file', ag);

// learn: recurring fixed failures and the autopilot's lessons → candidates (not in SKILL.md)
const E = path.join(T, 'bds', 'episodes.jsonl'); fs.mkdirSync(path.dirname(E), { recursive: true });
const ep = (u) => JSON.stringify({ at: 'x', unit: u, fixed: [{ sig: "E TypeError: cannot read property 'foo' of undefined (src/main.ts:12)", hints: ['fix: check the bar before use'] }, { sig: '✘ 4: ## once > @A cmd /x / want ~ ok', hints: [] }] });
fs.writeFileSync(E, [ep('a'), ep('b')].join('\n') + '\n');
const LS = path.join(T, 'LESSONS.md'); fs.writeFileSync(LS, '# Lessons\n- a form opened from a chat word must wait for the chat screen to close\n');
r = lab(['skill', 'learn'], { ...env, LAB_EPISODES: E, LAB_LESSONS: LS });
const k3 = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')), cands = k3.rules.filter((x) => x.status === 'candidate');
ok(r.code === 0 && cands.some((x) => x.rule === 'check the bar before use' && x.evidence.n === 2 && x.evidence.units.length === 2) && cands.some((x) => /chat screen to close/.test(x.rule) && x.evidence.kind === 'lesson') && !fs.readFileSync(path.join(S, 'bds-script-api', 'SKILL.md'), 'utf8').includes('check the bar'), 'learn: a failure fixed in 2 units with a hint and a lesson become candidates; candidates stay out of SKILL.md', r.t);
const cid = cands.find((x) => x.rule === 'check the bar before use').id;
r = lab(['skill', 'promote', cid], env);
ok(r.code !== 0 && /needs evidence first/.test(r.t), 'promote without evidence is refused', r.t);
r = lab(['skill', 'promote', cid, '--evidence', 'test:tests/pytb-offline.mjs'], env);
ok(r.code === 0 && fs.readFileSync(path.join(S, 'bds-script-api', 'SKILL.md'), 'utf8').includes('check the bar before use'), 'promote with evidence: the rule enters its SKILL.md', r.t);
r = lab(['skill', 'verify', cid], env);
ok(r.code === 0 && /✔ cand-/.test(r.t) && JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')).rules.find((x) => x.id === cid).verified?.ok === true, 'verify re-runs its evidence (an offline test here) and records the BDS version and date', r.t);
const k4 = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')); k4.rules.find((x) => x.id === cid).evidence = { kind: 'test', ref: 'tests/no-such-test.mjs' }; fs.writeFileSync(path.join(S, 'knowledge.json'), JSON.stringify(k4));
r = lab(['skill', 'verify', cid], env);
ok(r.code !== 0 && /status disputed/.test(r.t) && !fs.readFileSync(path.join(S, 'bds-script-api', 'SKILL.md'), 'utf8').includes('check the bar before use'), 'evidence that fails: the rule is disputed and leaves SKILL.md', r.t);
r = lab(['skill', 'retire', cid, 'replaced'], env);
ok(r.code === 0 && JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')).rules.find((x) => x.id === cid).status === 'retired', 'retire keeps the rule with why, out of the skills', r.t);

// bench: A/B verdict (a stand-in for the AI runs)
const stub = path.join(T, 'stub.sh');
fs.writeFileSync(stub, '#!/bin/sh\nif [ "$2" = on ]; then echo \'RESULT {"pass":true,"tokens":80000,"steps":5}\'; else if [ "$1" = ruby ]; then echo \'RESULT {"pass":false,"tokens":120000,"steps":9}\'; else echo \'RESULT {"pass":true,"tokens":100000,"steps":7}\'; fi; fi\n'); fs.chmodSync(stub, 0o755);
r = lab(['skill', 'bench', '--tasks', 'ruby,kills'], { ...env, LAB_SKILL_BENCH_CMD: stub });
const h = JSON.parse(fs.readFileSync(path.join(S, 'history.json'), 'utf8')).at(-1);
ok(r.code === 0 && /^KEEP skills \w+: more passes with skills \(2 > 1\)/m.test(r.t) && h.on.pass === 2 && h.off.pass === 1 && h.keep === true, 'bench: with and without skills on each task; more passes with them: KEEP, recorded in history.json', r.t);
fs.writeFileSync(stub, '#!/bin/sh\nif [ "$2" = on ]; then echo \'RESULT {"pass":true,"tokens":150000,"steps":9}\'; else echo \'RESULT {"pass":true,"tokens":100000,"steps":7}\'; fi\n');
r = lab(['skill', 'bench', '--tasks', 'ruby'], { ...env, LAB_SKILL_BENCH_CMD: stub });
ok(r.code !== 0 && /^WORSE skills \w+: same passes, 50% more tokens with skills/m.test(r.t), 'same passes but 50% more tokens with the skills: WORSE (undo or retire)', r.t);

// just in time: a problem line a verified rule's `match` fits gets that rule's one line under it (once), from the real lab
const U = path.join(TOP, 'bds', 'addons', 'zz_skills_jit');
fs.rmSync(U, { recursive: true, force: true });
fs.mkdirSync(path.join(U, 'rp', 'ui'), { recursive: true }); fs.mkdirSync(path.join(U, 'bp'), { recursive: true });
fs.writeFileSync(path.join(U, 'bp', 'manifest.json'), JSON.stringify({ format_version: 2, header: { name: 'jit', description: 'jit', uuid: '3e63aa6c-b9c8-4ccd-bd84-a0054af44900', version: [1, 0, 0], min_engine_version: [1, 26, 0] }, modules: [{ type: 'data', uuid: '3e63aa6c-b9c8-4ccd-bd84-a0054af44901', version: [1, 0, 0] }] }));
fs.writeFileSync(path.join(U, 'rp', 'ui', 'zz.json'), '{"namespace":"zz","root":{"type":"panel"}}');
try {
  r = lab(['bds', 'check', '-a', 'zz_skills_jit']);
  const ls = r.t.split('\n'), i = ls.findIndex((l) => /^W rp\/ui\/zz\.json: not listed in rp\/ui\/_ui_defs\.json/.test(l));
  ok(i >= 0 && /^  rule: A new rp\/ui file is loaded only when listed .*\(`ui-defs`, skill bds-json-ui\)$/.test(ls[i + 1]) && r.t.split('rule:').length === 2, 'check: the W line a verified rule matches gets that rule right under it, once', r.t);
  r = lab(['bds', 'check', '-a', 'zz_skills_jit'], { LAB_RULE_HINTS: 'off' });
  ok(/not listed in rp\/ui\/_ui_defs/.test(r.t) && !/rule:/.test(r.t), 'LAB_RULE_HINTS=off: no rule lines', r.t);
  const kd = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')); kd.rules.find((x) => x.id === 'ui-defs').status = 'disputed'; fs.writeFileSync(path.join(S, 'knowledge.json'), JSON.stringify(kd));
  r = lab(['bds', 'check', '-a', 'zz_skills_jit'], env);
  ok(/not listed/.test(r.t) && !/`ui-defs`/.test(r.t), 'a disputed rule is not shown (only verified ones)', r.t);
  kd.rules.find((x) => x.id === 'ui-defs').status = 'verified'; fs.writeFileSync(path.join(S, 'knowledge.json'), JSON.stringify(kd));
} finally { fs.rmSync(U, { recursive: true, force: true }); }

// misses: the failure a verified rule covers still happened (and got fixed) in units → counted from all episodes, flagged at 3 in 2 units
const ident = (u) => JSON.stringify({ at: 'x', unit: u, fixed: [{ sig: 'E Failed to resolve identity (src/main.ts:4)', hints: [] }] });
fs.writeFileSync(E, [ident('a'), ident('b'), ident('c')].join('\n') + '\n');
r = lab(['skill', 'learn'], { ...env, LAB_EPISODES: E, LAB_LESSONS: LS });
r = lab(['skill', 'learn'], { ...env, LAB_EPISODES: E, LAB_LESSONS: LS });
const mi = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')).rules.find((x) => x.id === 'api-score-identity');
ok(mi.misses?.n === 3 && mi.misses.units.length === 3 && /^! api-score-identity: its failure still happened 3× in 3 units/m.test(r.t) && !JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')).rules.some((x) => x.status === 'candidate' && /resolve identity/.test(x.why)), 'learn: a covered failure seen again counts as a miss of its rule (recounted, not added: run twice = 3), flagged; no duplicate candidate', r.t);

// learn --from: another project's skills → source candidates (hard rules first, nothing it knows, no fragments or repo-tied lines)
const R2 = path.join(T, 'other-skills');
fs.mkdirSync(path.join(R2, 'skills', 'mcbe-json-ui-x'), { recursive: true }); fs.mkdirSync(path.join(R2, 'data'), { recursive: true });
fs.writeFileSync(path.join(R2, 'skills', 'mcbe-json-ui-x', 'SKILL.md'), '---\nname: x\ndescription: y\n---\n- Never put two factory controls with the same control_ids in one screen: the second one is ignored silently.\n- Only texture paths that exist (rp/textures or vanilla); an invented textures/ui path draws nothing.\n- and this line continues the one above it with more words.\n- Run `node tools/thing.mjs --fix(1)` before anything else.\n- Is the control inserted into the right panel?\n');
fs.writeFileSync(path.join(R2, 'data', 'rules.json'), JSON.stringify({ rules: [{ id: '7', rule: '**Bones must have unique names** in one geometry or the later one replaces the earlier.' }] }));
r = lab(['skill', 'learn', '--from', R2], { ...env, LAB_EPISODES: E, LAB_LESSONS: LS });
const k5 = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')), src = k5.rules.filter((x) => x.evidence?.kind === 'source' && x.status === 'candidate');
ok(src.length === 2 && src.some((x) => /^Never put two factory controls/.test(x.rule) && x.skill === 'bds-json-ui' && x.evidence.ref === 'other-skills/skills/mcbe-json-ui-x/SKILL.md') && src.some((x) => /^Bones must have unique names/.test(x.rule) && x.skill === 'bds-models'),
  'learn --from <dir>: its hard rules become source candidates routed to a skill; one the lab already has, a fragment, a repo-tied command and a question are skipped', JSON.stringify(src.map((x) => [x.id, x.skill, x.rule])) + '\n' + r.t);
const sid = src.find((x) => /^Never put two/.test(x.rule)).id;
r = lab(['skill', 'promote', sid, '--evidence', 'source:https://example.com/repo skills/x'], env);
ok(r.code === 0 && new RegExp(`Never put two factory controls.*\`${sid}\` \\[source\\]`).test(fs.readFileSync(path.join(S, 'bds-json-ui', 'SKILL.md'), 'utf8')), 'promote with source evidence: in the skill, marked [source] (a reference says so; not re-run here)', r.t);

// note: a surprise while working → auto/LESSONS.md → learn makes it a candidate
const LS2 = path.join(T, 'LESSONS2.md');
r = lab(['skill', 'note', 'An Endstone py value prints short, a tuple as a list'], { ...env, LAB_LESSONS: LS2 });
const r2 = lab(['skill', 'note', 'An Endstone py value prints short, a tuple as a list'], { ...env, LAB_LESSONS: LS2 });
r = lab(['skill', 'learn'], { ...env, LAB_EPISODES: E, LAB_LESSONS: LS2 });
ok(/^- An Endstone py value prints short, a tuple as a list$/m.test(fs.readFileSync(LS2, 'utf8')) && /already noted/.test(r2.t) && JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')).rules.some((x) => x.status === 'candidate' && /prints short, a tuple/.test(x.rule) && x.skill === 'endstone-plugin'), 'skill note: one line into the lessons (once); learn makes it a candidate routed to its skill', r.t);

// growth: generations and the next rung for each part
r = lab(['skill', 'growth'], { ...env, LAB_EPISODES: E });
const lg = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8')).log;
ok(r.code === 0 && lg.length >= 2 && /^skills generation \d+: \d+ skills, \d+ rules \(\+\d+ since gen 1/m.test(r.t) && /proof: \d+ re-run here .* \d+% re-checkable/.test(r.t) && /experience: 3 episodes, 3 failures fixed in 3 units/.test(r.t) && /next: api-score-identity missed 3×/.test(r.t) && /\[source\] rules: a test or probe/.test(r.t),
  'growth: generation log, proof strength, experience, and next steps (a missed rule first, then candidates, source rules to prove)', r.t);

fs.rmSync(T, { recursive: true, force: true });
console.log(`${fails ? 'FAIL' : 'PASS'} skills-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
