#!/usr/bin/env node
// The skills as prompts (common/skill-forge.mjs): every rubric criterion fails on a broken skill and passes on a fixed one
// (a check never seen failing proves nothing), the router finds a skill from a Japanese request through triggers.txt and
// keeps held-out cases hidden, `skill new` writes a draft in the shared shape, `skill refine` keeps an edit that measures
// better and puts back one that makes anything worse, install adds a per-AI part only for that AI and leaves drafts and
// lab-only skills out, `bench --without` turns a draft into kept, growth shows the skills and rubric layers.
// Works on a copy of skills/ (LAB_SKILLS_DIR) and a temp state folder (LAB_STATE_DIR): the real ones are never written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-forge-')), S = path.join(T, 'skills');
fs.cpSync(path.join(TOP, 'skills'), S, { recursive: true });
const env = { LAB_SKILLS_DIR: S, LAB_STATE_DIR: path.join(T, 'state'), LAB_SKILL_READS: 'off' };
const lab = (args, e = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', timeout: 300000, env: { ...process.env, LAB_DOTENV: 'off', ...env, ...e } }); return { code: r.status, t: (r.stdout ?? '') + (r.stderr ?? '') }; };
const F = await import(path.join(TOP, 'common', 'skill-forge.mjs'));
const rubric = JSON.parse(fs.readFileSync(path.join(TOP, 'skills', 'rubric.json'), 'utf8'));

// the real skills: every one graded, every criterion in the rubric scored, the router sound on the real cases
let r = lab(['skill', 'grade', '--json']);
const G = JSON.parse(r.t.trim().split('\n').at(-1));
ok(G.length >= 15 && G.every((g) => rubric.criteria.every((c) => [0, 1, 2].includes(g.R[c.id]))), 'skill grade: every skill gets 0-2 on every criterion of skills/rubric.json', r.t.slice(0, 400));
ok(rubric.criteria.every((c) => c.id && c.what && c.fix && c.source && ['portable', 'lab'].includes(c.scope)) && new Set(rubric.criteria.map((c) => c.id)).size === rubric.criteria.length, 'every criterion says what it checks, how to fix it, where it comes from, and whether it is portable', '');
r = lab(['skill', 'route', '--eval']);
const dev = /route dev: (\d+)\/(\d+) first/.exec(r.t), held = /held out: (\d+)\/(\d+) first/.exec(r.t);
ok(dev && held && Number(dev[1]) / Number(dev[2]) >= 0.85 && Number(held[1]) / Number(held[2]) >= 0.75 && !/held/.test(r.t.split('\n').slice(1).filter((l) => /✘/.test(l)).join('')), 'skill route --eval: the real router puts the owner first on most cases (dev ≥ 85%, held-out ≥ 75%), held-out failures not listed', r.t);
const cases = JSON.parse(fs.readFileSync(path.join(TOP, 'skills', 'routes.json'), 'utf8')).cases;
const names = fs.readdirSync(path.join(TOP, 'skills')).filter((x) => fs.existsSync(path.join(TOP, 'skills', x, 'SKILL.md')));
ok(cases.every((c) => c.want.every((w) => names.includes(w))) && cases.some((c) => c.set === 'held') && names.filter((x) => !x.endsWith('-master')).every((x) => cases.some((c) => c.want[0] === x && c.set !== 'held')), 'skills/routes.json: every case names real skills, some are held out, every skill owns a dev case', '');

// Japanese words: katakana runs whole, kanji runs with their pairs, hiragana left out
const tk = F.tokens('毎日ログインしたらボーナス 釣り大会を開く getScore throws');
ok(tk.includes('ログイン') && tk.includes('毎日') && tk.includes('大会') && !tk.some((x) => /^[぀-ゟ]+$/.test(x)) && !tk.includes('グイ') && tk.includes('getscore'), 'tokens: katakana words whole (no ログ/グイ pieces), kanji runs and pairs, no hiragana, English lowercased', tk.join(' '));
r = lab(['skill', 'route', '釣り大会を作りたい、制限時間つき']);
ok(/^# skill bds-recipes \(matched: [^)]*大会/.test(r.t) && /bds\/addons\/fishcup/.test(r.t) && !/bds\/addons\/home/.test(r.t) && /more lines like these: node lab\.mjs skill bds-recipes/.test(r.t) && !/^---|rules:begin|<!--/m.test(r.t), 'skill route "<Japanese request>": one clear owner is printed at once (no second call), the reader view, and a catalog skill only with the lines that fit', r.t);
r = lab(['skill', 'route', 'xyzzy plugh']);
ok(/no clear owner/.test(r.t) && /bds-addon-master/.test(r.t), 'skill route: nothing matches → the master router, not a guess', r.t);

// each criterion: a broken skill scores 0 (or less than 2), the same skill fixed scores 2
const mk = (dir, files) => { fs.rmSync(dir, { recursive: true, force: true }); for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); } return dir; };
const good = `---\nname: zz-good\ndescription: Grade a thing so it can be trusted. Use when a thing must be checked before it is handed over.\n---\n\n# Good\n\nNot for building the thing (use \`zz-other\`).\n\n1. \`node lab.mjs skill grade zz-good\` prints each criterion.\n2. \`node lab.mjs skill route "check a thing"\` shows the owner.\n3. Fix what it names, then run it again.\n\n- Never hand a thing over unchecked (when missed: the person finds the bug).\n\nDone when every line is 2. Report: what ran, what passed, and what is not verified (say so).\n${'Filler that makes the size reasonable for a skill read whole every turn. '.repeat(4)}\n`;
const other = `---\nname: zz-other\ndescription: Build a different thing from parts and glue. Use when the request is to build, not to check.\n---\n\n# Other\n\nGlue parts together with clamps and wait for the glue to dry overnight in a warm room.\n`;
const bad = `---\nname: Bad_Name\ndescription: stuff\n---\n\nThings to know about it. Claude Code TodoWrite /home/me/x.\n- You must always do it.\n`;
const R0 = mk(path.join(T, 'ref0'), { 'skills/zz-good/SKILL.md': good, 'skills/zz-other/SKILL.md': other, 'skills/zz-bad/SKILL.md': bad });
const coll = (d) => F.gradeAll(fs.readdirSync(path.join(d, 'skills')).map((x) => { const f = path.join(d, 'skills', x, 'SKILL.md'), t = fs.readFileSync(f, 'utf8'); const m = /^---\n([\s\S]*?)\n---\n?/.exec(t); const meta = Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()])); return { name: meta.name, dir: x, file: f, text: t, meta, body: t.slice(m[0].length), triggers: '', bytes: Buffer.byteLength(t) }; }), { lab: false, entryFile: path.join(d, 'AGENTS.md') });
const gr = coll(R0), gG = gr.find((x) => x.name === 'zz-good'), gB = gr.find((x) => x.name === 'Bad_Name');
const portable = rubric.criteria.filter((c) => c.scope === 'portable').map((c) => c.id).filter((id) => id !== 'focus' && id !== 'no-repeat');
ok(portable.every((id) => gG.R[id] === 2), 'a skill written the way the rubric asks scores 2 on every portable criterion', JSON.stringify(gG.R));
ok(portable.filter((id) => id !== 'rules-why').every((id) => gB.R[id] < 2) && gB.R['rules-why'] === 0 && gB.R.portable === 0 && gB.R.name === 0, 'the broken one scores below 2 on each (bad name, vague description, no hand-off, no steps, no example, a hard rule with no why, no done, no honesty, too small, product names and a home path)', JSON.stringify(gB.R));
// focus and no-repeat: a copy of a sibling, a line from AGENTS.md
const twin = good.replace('zz-good', 'zz-twin');
const entryLine = 'Every rule here comes from a failure seen on the real server and is checked again after each update of the game.';
mk(path.join(T, 'ref1'), { 'skills/zz-good/SKILL.md': good, 'skills/zz-twin/SKILL.md': twin, 'AGENTS.md': `# entry\n${entryLine}\n` });
fs.appendFileSync(path.join(T, 'ref1', 'skills', 'zz-twin', 'SKILL.md'), `\n${entryLine}\n`);
const g1 = coll(path.join(T, 'ref1'));
ok(g1.every((x) => x.R.focus === 0) && g1.find((x) => x.name === 'zz-twin').R['no-repeat'] < 2 && g1.find((x) => x.name === 'zz-good').R['no-repeat'] === 2, 'focus 0 for two skills that say the same; no-repeat below 2 for the one that repeats a line of AGENTS.md', JSON.stringify(g1.map((x) => [x.name, x.R.focus, x.R['no-repeat']])));
// lab criteria on our copy: a command that does not exist and a path that is not here
fs.appendFileSync(path.join(S, 'bds-debug', 'SKILL.md'), '\nAlso `node lab.mjs frobnicate x` and `bds/addons/no_such_unit`.\n');
r = lab(['skill', 'grade', 'bds-debug']);
ok(/grounded [01]: .*not here: node lab\.mjs frobnicate, bds\/addons\/no_such_unit/.test(r.t), 'grounded: a command and a path the lab does not have are named', r.t);
fs.copyFileSync(path.join(TOP, 'skills', 'bds-debug', 'SKILL.md'), path.join(S, 'bds-debug', 'SKILL.md'));

// a reference collection: graded with the portable criteria, and the line that earns its 2 shown where ours is lower
r = lab(['skill', 'grade', 'bds-tests', '--ref', path.join(T, 'ref0')]);
ok(/^ref ref0: 3 skills, portable \d+% \(ours \d+%\)/m.test(r.t) && /not that our skills work better; skill bench decides/.test(r.t) && JSON.parse(fs.readFileSync(path.join(S, 'grades.json'), 'utf8')).ref.ref0, '--ref: a reference collection graded on the portable criteria, recorded, and the caveat that the rubric is ours', r.t);

// new: a draft in the shared shape; a weak description refused
r = lab(['skill', 'new', 'zz-fishing-helper', 'short']);
ok(r.code !== 0 && /Use when/.test(r.t) && !fs.existsSync(path.join(S, 'zz-fishing-helper')), 'skill new: a description without what + "Use when" is refused (it is how an AI finds the skill)', r.t);
r = lab(['skill', 'new', 'zz-fishing-helper', 'Measure bobber drift in still water pools. Use when a request asks for bobber drift numbers.']);
const nf = fs.readFileSync(path.join(S, 'zz-fishing-helper', 'SKILL.md'), 'utf8');
ok(r.code === 0 && /^---\nname: zz-fishing-helper\ndescription: Measure bobber drift/.test(nf) && /<!-- rules:begin/.test(nf) && /Not for/.test(nf) && fs.existsSync(path.join(S, 'zz-fishing-helper', 'triggers.txt')) && JSON.parse(fs.readFileSync(path.join(S, 'grades.json'), 'utf8')).skills['zz-fishing-helper'].status === 'draft' && /closest existing skill: /.test(r.t), 'skill new: SKILL.md from the template (name, description, Not for, steps, rules block), triggers.txt, a draft; names the closest existing skill', r.t);
r = lab(['skill']);
ok(/zz-fishing-helper .*\[draft\]/.test(r.t), 'skill lists a draft as [draft]', r.t);

// refine: the brief, then --done keeps a better edit
r = lab(['skill', 'refine', 'zz-fishing-helper']);
ok(/^refine zz-fishing-helper: \d+% now/.test(r.t) && /- routed/.test(r.t), 'skill refine: a brief of the weak criteria (routed: no master names it yet)', r.t);
r = lab(['skill', 'refine', 'zz-fishing-helper', '--done']);
ok(r.code !== 0 && /REVERTED zz-fishing-helper: .*template lines still to fill/.test(r.t), 'refine --done with the template untouched: reverted, saying what to fill', r.t);
lab(['skill', 'refine', 'zz-fishing-helper']);
fs.writeFileSync(path.join(S, 'zz-fishing-helper', 'SKILL.md'), nf.replace(/Not for: .*\n/, 'Not for the contest itself (use `bds-recipes`, fishcup).\n').replace('1. <first action: a command with real arguments, e.g. `node lab.mjs ...`>', '1. Build a pool ahead of the player: `fill -8 -64 2 8 -61 24 water`.').replace('2. <next action>', '2. Give a rod with lure 3: `enchant A lure 3`, then `@A fish_n 3 30`.').replace('3. <how to check it worked: the command and the line that proves it>', '3. Check the catch count as a range: `js inv(p(\'A\')).length`.').replace('Done when <what proves it>.', 'Done when `go` passes the fishing section twice.'));
fs.writeFileSync(path.join(S, 'zz-fishing-helper', 'triggers.txt'), 'bobber drift, drift numbers\n浮き流れ\n');
r = lab(['skill', 'refine', 'zz-fishing-helper', '--done']);
const gj = JSON.parse(fs.readFileSync(path.join(S, 'grades.json'), 'utf8'));
ok(r.code === 0 && /^KEPT zz-fishing-helper: \d+% → \d+%/m.test(r.t) && gj.refine.at(-1).kept === true && gj.log.at(-1).why === 'refine zz-fishing-helper', 'refine --done: an edit that scores better is kept and logged as a generation', r.t);
// ... and one that makes another skill worse (it steals bds-recipes' requests) is put back
lab(['skill', 'refine', 'zz-fishing-helper']);
const before = fs.readFileSync(path.join(S, 'zz-fishing-helper', 'SKILL.md'), 'utf8');
fs.writeFileSync(path.join(S, 'zz-fishing-helper', 'triggers.txt'), 'daily login bonus, home, sethome, shop, money, coins, wand, cooldown, zone, contest\nログインボーナス, ホーム, ショップ, お金, コイン, 杖, エリア, 大会, 毎日\n'.repeat(3));
r = lab(['skill', 'refine', 'zz-fishing-helper', '--done']);
ok(r.code !== 0 && /REVERTED zz-fishing-helper: .*routing got worse/.test(r.t) && fs.readFileSync(path.join(S, 'zz-fishing-helper', 'triggers.txt'), 'utf8').startsWith('bobber drift') && fs.readFileSync(path.join(S, 'zz-fishing-helper', 'SKILL.md'), 'utf8') === before, 'refine --done: an edit that wins other skills\' requests is reverted, the files put back', r.t);

// install: a per-AI part only for that AI; drafts and lab-only skills stay out unless asked
fs.mkdirSync(path.join(S, 'bds-tests', 'ai'), { recursive: true });
fs.writeFileSync(path.join(S, 'bds-tests', 'ai', 'gemini.md'), 'ZZ only gemini reads this.');
const P = path.join(T, 'project');
r = lab(['skill', 'install', 'claude', 'gemini', '--to', P]);
const cl = fs.readFileSync(path.join(P, '.claude', 'skills', 'bds-tests', 'SKILL.md'), 'utf8'), ge = fs.readFileSync(path.join(P, '.gemini', 'skills', 'bds-tests', 'SKILL.md'), 'utf8');
ok(r.code === 0 && !/ZZ only gemini/.test(cl) && /## Only for gemini\nZZ only gemini reads this\./.test(ge) && !fs.existsSync(path.join(P, '.claude', 'skills', 'zz-fishing-helper')) && !fs.existsSync(path.join(P, '.claude', 'skills', 'skill-forge')) && /bds-lab skills: begin/.test(fs.readFileSync(path.join(P, 'GEMINI.md'), 'utf8')), 'install: skills/<name>/ai/gemini.md reaches Gemini only; the draft and the lab-only skill stay out; GEMINI.md gets the routing block', r.t);
r = lab(['skill', 'install', 'codex', 'agents', '--to', P, '--drafts']);
ok(fs.existsSync(path.join(P, '.agents', 'skills', 'zz-fishing-helper', 'SKILL.md')) && !fs.existsSync(path.join(P, '.agents', 'skills', 'skill-forge')) && /skill route/.test(fs.readFileSync(path.join(P, 'AGENTS.md'), 'utf8')), 'install codex + agents: one .agents/skills (Codex reads it), --drafts adds drafts, never lab-only; AGENTS.md block says how to route', r.t);

// bench --without: a draft that does not make builds worse becomes kept
const stub = path.join(T, 'bench.sh');
fs.writeFileSync(stub, '#!/bin/sh\nif [ "$2" = on ]; then echo \'RESULT {"pass":true,"tokens":100000,"steps":7}\'; else echo \'RESULT {"pass":false,"tokens":90000,"steps":7}\'; fi\n'); fs.chmodSync(stub, 0o755);
r = lab(['skill', 'bench', '--tasks', 'ruby', '--without', 'zz-fishing-helper'], { LAB_SKILL_BENCH_CMD: stub });
const hb = JSON.parse(fs.readFileSync(path.join(S, 'history.json'), 'utf8')).at(-1);
ok(r.code === 0 && /zz-fishing-helper: draft → kept/.test(r.t) && /\(with vs without zz-fishing-helper\)/.test(r.t) && hb.without === 'zz-fishing-helper' && typeof hb.grade === 'number' && JSON.parse(fs.readFileSync(path.join(S, 'grades.json'), 'utf8')).skills['zz-fishing-helper'].status === 'kept', 'bench --without <draft>: with it vs without it; not worse → kept; the bench records the grade (for rubric validity)', r.t);
fs.writeFileSync(stub, '#!/bin/sh\necho "$2" >> ' + path.join(T, 'seen.txt') + '\necho \'RESULT {"pass":true,"tokens":1,"steps":1}\'\n');
lab(['skill', 'bench', '--tasks', 'ruby', '--without', 'bds-tests'], { LAB_SKILL_BENCH_CMD: stub });
ok(fs.readFileSync(path.join(T, 'seen.txt'), 'utf8').split('\n').includes('without:bds-tests'), 'bench --without: the "off" side runs with LAB_SKILLS=without:<name> (bench.mjs removes that skill from the copy)', fs.readFileSync(path.join(T, 'seen.txt'), 'utf8'));
const bm = fs.readFileSync(path.join(TOP, 'bds', 'bench', 'bench.mjs'), 'utf8');
ok(/without:\(\[a-z0-9-\]\+\)/.test(bm) && /rmSync\(path\.join\(dir, 'skills', wo\[1\]\)/.test(bm), 'bds/bench/bench.mjs removes the one skill for LAB_SKILLS=without:<name>', '');

// growth: the rules layer, then skills (grade, routing, refinements) and the rubric (validity; a ceiling raises the bar)
r = lab(['skill', 'growth']);
ok(/L1 rules/.test(r.t) && /L2 skills: grade \d+%/.test(r.t) && /refinements \d+ kept \/ \d+ reverted/.test(r.t) && /L3 rubric v\d+, \d+ criteria/.test(r.t), 'growth: L1 rules, L2 skills (grade, routing, refinements kept / reverted), L3 rubric', r.t);
const g3 = JSON.parse(fs.readFileSync(path.join(S, 'grades.json'), 'utf8'));
g3.log.push({ ...g3.log.at(-1), gen: g3.log.at(-1).gen + 1, mean: 97 }); fs.writeFileSync(path.join(S, 'grades.json'), JSON.stringify(g3));
r = lab(['skill', 'growth']);
ok(/near its ceiling/.test(r.t) && /(bench can raise the bar|rubric mine|rubric adopt)/.test(r.t), 'growth: a grade at the ceiling says to raise the bar (a stricter criterion, then a bench)', r.t);
const hist = JSON.parse(fs.readFileSync(path.join(S, 'history.json'), 'utf8'));
const base = { on: { runs: 2, pass: 1 }, off: { runs: 2, pass: 1 } };
fs.writeFileSync(path.join(S, 'history.json'), JSON.stringify([...hist, { ...base, grade: 80, on: { runs: 2, pass: 2 } }, { ...base, grade: 85, on: { runs: 2, pass: 1 } }, { ...base, grade: 90, on: { runs: 2, pass: 0 } }]));
r = lab(['skill', 'growth']);
ok(/grade and bench moved together in 0\/2 bench pairs — the rubric does not predict results/.test(r.t), 'growth L3: when the grade rises while benches pass less, it says the rubric does not predict results', r.t);

// usage: reading a skill is recorded (unless off), and growth / refine show it
const st = path.join(T, 'state2');
lab(['skill', 'bds-forms'], { LAB_SKILL_READS: 'on', LAB_STATE_DIR: st });
ok(/"skill":"bds-forms"/.test(fs.readFileSync(path.join(st, 'skill-reads.jsonl'), 'utf8')), 'skill <name> records the read (.lab/skill-reads.jsonl) for usage', '');

// ---------- v1.17: one SKILL.md for every AI (only-blocks), no-owner routing, --like, the AI loop, the rubric that grows ----------
// only:<ai> parts: the shared view hides them (portable stays 2), that AI's copy keeps them, an unclosed one is reverted
const ftext = fs.readFileSync(path.join(S, 'bds-debug', 'SKILL.md'), 'utf8');
fs.writeFileSync(path.join(S, 'bds-debug', 'SKILL.md'), ftext.replace('# Debugging\n', '# Debugging\n\n<!-- only:claude -->\nZZ In Claude Code use the TodoWrite tool to list each failure.\n<!-- /only -->\n'));
r = lab(['skill', 'grade', '--json']);
const gd = JSON.parse(r.t.trim().split('\n').at(-1)).find((x) => x.name === 'bds-debug');
r = lab(['skill', 'bds-debug']);
const shared = r.t, forClaude = lab(['skill', 'bds-debug', '--for', 'claude']).t;
const P2 = path.join(T, 'project2');
lab(['skill', 'install', 'claude', 'codex', 'windsurf', 'cline', 'roo', 'kiro', 'opencode', 'aider', '--to', P2]);
ok(gd.R.portable === 2 && !/ZZ In Claude Code/.test(shared) && /ZZ In Claude Code/.test(forClaude) && /ZZ In Claude Code/.test(fs.readFileSync(path.join(P2, '.claude', 'skills', 'bds-debug', 'SKILL.md'), 'utf8')) && !/ZZ In Claude Code|only:claude/.test(fs.readFileSync(path.join(P2, '.agents', 'skills', 'bds-debug', 'SKILL.md'), 'utf8')), '<!-- only:claude --> part: not in the shared view or the grade (portable 2), in `skill <name> --for claude` and in Claude\'s installed copy only', shared.slice(0, 300));
ok(['.windsurf', '.cline', '.roo', '.kiro', '.opencode'].every((d) => fs.existsSync(path.join(P2, d, 'skills', 'bds-tests', 'SKILL.md'))) && /bds-lab skills: begin/.test(fs.readFileSync(path.join(P2, 'CONVENTIONS.md'), 'utf8')), 'install: Windsurf, Cline, Roo, Kiro, OpenCode skill folders; Aider gets the routing block in CONVENTIONS.md', fs.readdirSync(P2).join(' '));
lab(['skill', 'refine', 'bds-debug']);
fs.writeFileSync(path.join(S, 'bds-debug', 'SKILL.md'), ftext.replace('# Debugging\n', '# Debugging\n\n<!-- only:codex -->\nZZ unclosed\n'));
r = lab(['skill', 'refine', 'bds-debug', '--done']);
ok(r.code !== 0 && /not closed with <!-- \/only -->/.test(r.t), 'refine --done: an only-part left open is reverted', r.t);
fs.writeFileSync(path.join(S, 'bds-debug', 'SKILL.md'), ftext);

// routing: a request no skill owns must find none
r = lab(['skill', 'route', 'おすすめのラーメン屋を教えて']);
ok(/no clear owner/.test(r.t), 'route: a request about something else (ramen) names no skill', r.t);
ok(JSON.parse(fs.readFileSync(path.join(TOP, 'skills', 'routes.json'), 'utf8')).cases.filter((c) => !c.want.length).length >= 6, 'routes.json has requests no skill owns (dev and held-out): grabbing them counts as a miss', '');

// new --like: the parts of a skill that works (a reference's) become the draft's sections
const REF = path.join(T, 'srcs', 'zzref');
const ex = (n, withC, extra = '') => `---\nname: ${n}\ndescription: Do ${n} things well for a person. Use when ${n} is asked for by name.\n---\n\n# ${n}\n\n${withC ? '## Checklist\n- the inputs are named\n\n' : ''}1. \`node tool.mjs ${n} --check\` first.\n2. Fix what it prints.\n3. Run it again.\n${extra}\n${'Body text that keeps the size above the small limit for a skill read whole. '.repeat(6)}\n`;
mk(REF, {
  'skills/a/SKILL.md': ex('a', true, '\nNot for b things (use `b`).\nDone when it prints OK. Report: what ran, and what was not verified (say so); never claim a look you did not see.\n- Never skip the check (when missed: the bug ships).\n'),
  'skills/b/SKILL.md': ex('b', true, '\nNot for a things (use `a`).\nDone when it prints OK. Report what ran; say what was not verified.\n'),
  'skills/c/SKILL.md': ex('c', true, '\nDone when it prints OK.\n- Never skip it (when missed: it breaks).\n'),
  'skills/d/SKILL.md': ex('d', false, '\nNot for c things (use `c`).\nDone when it prints OK. Say what was not verified, never claim more.\n'),
  'skills/e/SKILL.md': ex('e', false, '\n- You must always do it.\n'),
  'skills/f/SKILL.md': ex('f', false, '\nReport what ran.\n'),
});
r = lab(['skill', 'new', 'zz-like', 'Check a thing before handing it over. Use when a thing must be checked.', '--like', path.join(REF, 'skills', 'a')]);
ok(r.code === 0 && /## Checklist\n<what this part says for zz-like/.test(fs.readFileSync(path.join(S, 'zz-like', 'SKILL.md'), 'utf8')) && /--like a: its parts Checklist/.test(r.t), 'skill new --like <a reference skill>: its sections become the draft\'s, each to fill', r.t);
r = lab(['skill', 'refine', 'zz-like']); r = lab(['skill', 'refine', 'zz-like', '--done']);
ok(r.code !== 0 && /template lines still to fill/.test(r.t), '--like sections left unfilled are template lines: reverted', r.t);
fs.rmSync(path.join(S, 'zz-like'), { recursive: true, force: true });

// compare and the rubric: mine a part most reference skills have, calibrate it within the repository, adopt it, retire one
r = lab(['skill', 'compare', '--ref', REF]);
ok(/^criterion\s+bds-lab\s+zzref/m.test(r.t) && /^portable\s+\d+%\s+\d+%/m.test(r.t) && /skill bench decides that/.test(r.t), 'skill compare: ours and a reference side by side per portable criterion, with the caveat', r.t);
r = lab(['skill', 'rubric', 'mine', '--ref', REF]);
const rub1 = JSON.parse(fs.readFileSync(path.join(S, 'rubric.json'), 'utf8'));
ok(/\+ pat-checklist: heading:checklist in zzref 50%; ours 0%/.test(r.t) && rub1.candidates.some((c) => c.id === 'pat-checklist' && c.re), 'rubric mine: a heading half the reference skills have and ours lack becomes a pattern candidate', r.t);
r = lab(['skill', 'rubric', 'calibrate', '--ref', REF]);
ok(/^name\s+.*a gate/m.test(r.t) && /candidate pat-checklist: in 3\/6 reference skills; within a repository, skills with it score \+\d+pt on the rest → ADOPTABLE/.test(r.t), 'rubric calibrate: gates named as gates; the candidate\'s lift measured within the repository → adoptable', r.t);
const ver = rub1.version;
r = lab(['skill', 'rubric', 'adopt', 'pat-checklist']);
const rub2 = JSON.parse(fs.readFileSync(path.join(S, 'rubric.json'), 'utf8'));
r = lab(['skill', 'grade', '--json']);
ok(rub2.version === ver + 1 && rub2.criteria.some((c) => c.id === 'pat-checklist' && c.re) && JSON.parse(r.t.trim().split('\n').at(-1)).every((g) => g.R['pat-checklist'] === 0), 'rubric adopt: the candidate becomes a criterion (version + 1), checked as data: our skills (no Checklist) score 0 on it', r.t.slice(0, 200));
r = lab(['skill', 'rubric', 'adopt', 'pat-nothing']);
ok(r.code !== 0, 'rubric adopt of an unknown candidate is refused', r.t);
r = lab(['skill', 'rubric', 'retire', 'pat-checklist', 'test: it says nothing for this lab']);
ok(JSON.parse(fs.readFileSync(path.join(S, 'rubric.json'), 'utf8')).retired?.some((c) => c.id === 'pat-checklist') && /retired/.test(lab(['skill', 'rubric']).t), 'rubric retire: the criterion moves to retired with its reason (version + 1)', r.t);

// one system prompt for any AI: the router, then whole skills in budget, only-parts for that AI
r = lab(['skill', 'prompt', '--for', 'chatgpt', '--budget', '9000']);
ok(/^# Minecraft Bedrock addon skills \(bds-lab\), for chatgpt/.test(r.t) && /## Which skill\n- bds-addon-master: /.test(r.t) && /## Skill: bds-addon-master/.test(r.t) && /Not included for size: /.test(r.t) && Buffer.byteLength(r.t) <= 9000 && !/rules:begin/.test(r.t) && !/## Skill: skill-forge|^- skill-forge:/m.test(r.t), 'skill prompt --for chatgpt: the routing list, the master first, whole skills within the budget, the rest named; no lab-only skill, no markers', r.t.slice(0, 300));

// refine --via: another AI edits (a stand-in here), the gate decides; a revert's reason goes into the next prompt
const stubAI = path.join(T, 'ai.mjs'), seen = path.join(T, 'prompts.txt');
fs.writeFileSync(stubAI, `import fs from 'node:fs';\nconst p = fs.readFileSync(process.argv[2], 'utf8'); fs.appendFileSync(${JSON.stringify(seen)}, p + '\\n=====\\n');\nconst f = /\`\`\`markdown\\n([\\s\\S]*?)\\n\`\`\`\\nskills/.exec(p)[1];\nconst n = (fs.readFileSync(${JSON.stringify(seen)}, 'utf8').match(/=====/g) ?? []).length;\n// round 1: steal other skills' requests (the gate reverts it); round 2: the honest fix\nconst out = n === 1 ? f : f.replace(/\\nDone when/, '\\nLimits: a sandbox run is not proof; say what was not verified.\\nDone when');\nconst trig = n === 1 ? 'shop, money, coins, daily login bonus, home, sethome, wand, zone, contest\\n'.repeat(4) : 'bobber drift log\\n';\nconsole.log('\`\`\`skill\\n' + out + '\\n\`\`\`\\n\`\`\`triggers\\n' + trig + '\`\`\`');\n`);
lab(['skill', 'new', 'zz-ai', 'Log bobber drift readings per pool. Use when a request asks to log bobber drift.']);
fs.writeFileSync(path.join(S, 'zz-ai', 'SKILL.md'), fs.readFileSync(path.join(S, 'zz-ai', 'SKILL.md'), 'utf8').replace(/Not for: .*\n/, 'Not for the contest itself (use `bds-recipes`).\n').replace(/1\. <first action.*\n/, '1. Build a pool: `fill -8 -64 2 8 -61 24 water`.\n').replace('2. <next action>', '2. `@A fish_n 3 30` with a lure 3 rod.').replace(/3\. <how to check.*\n/, '3. Check the count as a range: `js inv(p(\'A\')).length`.\n').replace('Done when <what proves it>.', 'Done when `go` passes it twice.').replace(' Report: what ran, what passed, what is not verified (say so).', ''));
r = lab(['skill', 'refine', 'zz-ai', '--via', 'auto', '--rounds', '3'], { LAB_FORGE_AI_CMD: `node ${stubAI}` });
const prompts = fs.readFileSync(seen, 'utf8').split('=====');
ok(/round 1: REVERTED zz-ai: /.test(r.t) && /round 2: KEPT zz-ai/.test(r.t) && /^FORGE zz-ai: \d+% → \d+% in \d round\(s\), 1 kept \/ \d reverted/m.test(r.t) && /tried .* and reverted: /.test(prompts[1]) && /never invent a consequence/.test(prompts[0]) && /<!-- rules:begin/.test(prompts[0]), 'refine --via: round 1 (nothing gained, other skills\' words) → reverted; its reason is in the round-2 prompt; the honest fix is kept; FORGE totals', r.t);
fs.writeFileSync(stubAI, `import fs from 'node:fs';\nconst p = fs.readFileSync(process.argv[2], 'utf8');\nconst f = /\`\`\`markdown\\n([\\s\\S]*?)\\n\`\`\`\\nskills/.exec(p)[1];\nconsole.log('\`\`\`skill\\n' + f.replace('<!-- rules:end -->', '- A rule the AI made up.\\n<!-- rules:end -->').replace('Done when', 'Done (reworded) when') + '\\n\`\`\`');\n`);
r = lab(['skill', 'refine', 'zz-ai', '--via', 'auto', '--rounds', '1'], { LAB_FORGE_AI_CMD: `node ${stubAI}` });
ok(/REVERTED zz-ai: .*the rules block was edited/.test(r.t) && /no better \(--strict/.test(r.t) && !/made up/.test(fs.readFileSync(path.join(S, 'zz-ai', 'SKILL.md'), 'utf8')), 'refine --via: a rule invented inside the rules block and an edit that raises nothing are both reverted (--strict)', r.t);
// weakest passes over a stuck skill (two reverts in a row) and says when nothing is left
r = lab(['skill', 'refine', 'weakest']);
ok(!/^refine zz-ai/.test(r.t), 'weakest: a skill whose last two refinements were reverted is passed over', r.t);

// the autopilot: a skill under 85% (what an edit can raise) becomes a forge task that runs refine --via
const AR = path.join(T, 'autoroot');
fs.mkdirSync(path.join(AR, 'auto'), { recursive: true }); fs.mkdirSync(path.join(AR, 'skills'), { recursive: true });
fs.writeFileSync(path.join(AR, 'skills', 'grades.json'), JSON.stringify({ log: [{ gen: 1, scores: { 'bds-a': 70, 'bds-b': 95 }, text: { 'bds-a': 70, 'bds-b': 95 }, route: { dev: 90, held: 90 } }] }));
const sp = spawnSync(process.execPath, ['-e', `import('${pathToFileURL(path.join(TOP, 'common', 'auto.mjs')).href}').then((m) => console.log(JSON.stringify(m.sense().filter((t) => t.kind === 'forge'))))`], { encoding: 'utf8', env: { ...process.env, LAB_AUTO_ROOT: AR } });
const ft = JSON.parse(sp.stdout.trim().split('\n').at(-1) || '[]');
ok(ft.length === 1 && ft[0].id === 'forge:bds-a' && ft[0].cmd.join(' ') === 'skill refine bds-a --via auto --rounds 2', 'auto: a skill under 85% → task forge:<skill> running skill refine <skill> --via auto (scope: that skill\'s files and grades.json)', sp.stdout + sp.stderr);

// ---------- v1.18: fewer tokens, nothing lost ----------
r = lab(['skill', 'bds-forms', 'bds-tests']);
ok(/^# skill bds-forms[\s\S]*^# skill bds-tests/m.test(r.t) && !/^---$/m.test(r.t), 'skill a b: two skills in one call (each call re-sends the whole conversation)', r.t.slice(0, 200));
r = lab(['skill', 'route', 'フォームを閉じるとスクリプトが落ちる', '--list']);
ok(/^bds-forms\s/m.test(r.t) && !/^# skill/m.test(r.t), 'route --list: names, no print', r.t);
r = lab(['skill', 'route', 'xyz フォーム スクリプト']);
ok(/close: read the one that fits, or both in one call: node lab\.mjs skill \S+ \S+/.test(r.t) || /^# skill/m.test(r.t), 'route: two close owners → named, with the one call that prints both', r.t);
// a rule AGENTS.md already says leaves the lab's view; if its phrase leaves AGENTS.md, it comes back
const kj = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8'));
ok(kj.rules.filter((x) => x.entry).every((x) => fs.readFileSync(path.join(TOP, 'AGENTS.md'), 'utf8').includes(x.entry)), 'every knowledge.json `entry` phrase is in AGENTS.md (else the rule would show again)', '');
kj.rules.find((x) => x.id === 'test-one-world').entry = 'a phrase AGENTS.md does not have';
fs.writeFileSync(path.join(S, 'knowledge.json'), JSON.stringify(kj));
ok(/ONE world/.test(lab(['skill', 'bds-tests']).t), 'an `entry` phrase gone from AGENTS.md: the rule is printed again', '');
// facts: a shorter text must keep every code span and number
const F2 = await import(path.join(TOP, 'common', 'skill-forge.mjs'));
ok(F2.lostFacts('Run `zz-cmd --flag` 17 times, wait 23 ticks.', 'Run `zz-cmd --flag` 17×; wait 23 ticks.').length === 0 && F2.lostFacts('Run `zz-cmd --flag` 17 times.', 'Run it many times.').join(' ') === '`zz-cmd --flag` 17', 'lostFacts: rewording passes; a dropped code span or number is named (unless AGENTS.md says it)', F2.lostFacts('Run `zz-cmd --flag` 17 times.', 'Run it many times.'));
// --goal shorter: a shorter skill that keeps every fact is kept (reworded rules written back to knowledge.json by id);
// one that loses a fact is reverted, knowledge.json put back
const stubS = path.join(T, 'short.mjs');
fs.writeFileSync(stubS, `import fs from 'node:fs';\nconst p = fs.readFileSync(process.argv[2], 'utf8');\nconst f = /\`\`\`markdown\\n([\\s\\S]*?)\\n\`\`\`/.exec(p)[1];\nconst mode = process.env.ZZ_MODE;\nlet o = f.replace(/^(\\d\\. .*)\\(about 1 s\\); \`go\` decides\\.$/m, '$1(about 1 s); \`go\` decides.').replace('Players: ', 'Players: ').replace(/ in the addon \\(its value only is checked by the lines under it\\)/, ' (checked: its value only)').replace('Give each section what it needs, or wait out a cooldown.', 'Give each section what it needs.');\nif (mode === 'lose') o = o.replace('\`node lab.mjs sim\`', 'sim');\nconsole.log('\`\`\`skill\\n' + o + '\\n\`\`\`');\n`);
fs.copyFileSync(path.join(TOP, 'skills', 'knowledge.json'), path.join(S, 'knowledge.json'));
const k0 = fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8');
r = lab(['skill', 'refine', 'bds-tests', '--via', 'auto', '--goal', 'shorter', '--rounds', '1'], { LAB_FORGE_AI_CMD: `node ${stubS}`, ZZ_MODE: 'lose' });
ok(/REVERTED bds-tests: lost what it said: `node lab\.mjs sim`/.test(r.t) && fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8') === k0, '--goal shorter: dropping a command is reverted (knowledge.json too)', r.t);
r = lab(['skill', 'refine', 'bds-tests', '--via', 'auto', '--goal', 'shorter', '--rounds', '1'], { LAB_FORGE_AI_CMD: `node ${stubS}`, ZZ_MODE: 'keep' });
const k1 = JSON.parse(fs.readFileSync(path.join(S, 'knowledge.json'), 'utf8'));
ok(/(KEPT bds-tests|or cut 5%)/.test(r.t) && /size: \d+ B as read/.test(r.t), '--goal shorter: judged on 5% fewer bytes with every fact kept (the size as read is printed)', r.t);
ok(/KEPT/.test(r.t) ? k1.rules.find((x) => x.id === 'test-one-world').rule.endsWith('Give each section what it needs.') : true, '--goal shorter kept: a reworded rule is written back to knowledge.json by its id', k1.rules.find((x) => x.id === 'test-one-world').rule);

fs.rmSync(T, { recursive: true, force: true });
console.log(`${fails ? 'FAIL' : 'PASS'} forge-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
