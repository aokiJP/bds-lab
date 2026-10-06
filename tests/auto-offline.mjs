#!/usr/bin/env node
// The autopilot (common/auto.mjs) on a fake bds-lab folder (its lab.mjs only records what it was asked and answers from a
// script) with a fake Anthropic server and a real git repo pushing to a bare remote: it senses work, the AI picks, the lab
// acts, the reviewer approves or the change is put back, it commits and pushes, failures become lessons and wait, the engine
// agent's change is gated and never touches the floor, the kill switch and the token cap stop everything, next/done for an
// agent. No BDS, no network.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-auto-')), X = path.join(T, 'lab'), BARE = path.join(T, 'remote.git');
const w = (r, s) => { const f = path.join(X, r); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const rd = (r) => { try { return fs.readFileSync(path.join(X, r), 'utf8'); } catch { return null; } };
const git = (...a) => spawnSync('git', a, { cwd: X, encoding: 'utf8' });

// ---- the fake lab: lab.mjs answers from fake.json ({ "<regex on argv>": { exit, lines, write: {path: text} } }) ----
w('lab.mjs', `import fs from 'node:fs'; import path from 'node:path';
const D = path.dirname(new URL(import.meta.url).pathname), a = process.argv.slice(2).join(' ');
fs.appendFileSync(path.join(D, '.calls.jsonl'), JSON.stringify({ a, budget: process.env.LAB_TOKEN_BUDGET, ctx: process.env.LAB_MAKE_CONTEXT, ctxText: process.env.LAB_MAKE_CONTEXT && fs.existsSync(process.env.LAB_MAKE_CONTEXT) ? fs.readFileSync(process.env.LAB_MAKE_CONTEXT, 'utf8') : null, agent: process.env.LAB_AUTO_AGENT }) + '\\n');
const S = JSON.parse(fs.readFileSync(path.join(D, '.fake.json'), 'utf8'));
const k = Object.keys(S).find((re) => new RegExp(re).test(a)); const s = k ? S[k] : { exit: 0, lines: ['OK'] };
for (const [f, t] of Object.entries(s.write ?? {})) { fs.mkdirSync(path.dirname(path.join(D, f)), { recursive: true }); fs.writeFileSync(path.join(D, f), t); }
console.log((s.lines ?? []).join('\\n')); process.exit(s.exit ?? 0);
`);
const fake = (o) => fs.writeFileSync(path.join(X, '.fake.json'), JSON.stringify(o));
const calls = () => (rd('.calls.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
fake({});
w('common/auto-guard.mjs', fs.readFileSync(path.join(REPO, 'common', 'auto-guard.mjs'), 'utf8'));
w('common/engine.txt', 'engine v1\n');
w('tests/gate-a.mjs', `import fs from 'node:fs'; const t = fs.readFileSync(new URL('../common/engine.txt', import.meta.url), 'utf8'); console.log(t.includes('BROKEN') ? '✘ engine broken' : '✔ engine fine'); process.exit(t.includes('BROKEN') ? 1 : 0);\n`);
w('auto/policy.json', JSON.stringify({ gate: ['tests/gate-a.mjs'], dailyTokens: 100000, taskTokens: 5000, upkeepHours: 1e9, reflectEvery: 100, kinds: { playtest: false, harden: false, issue: false } }));
w('auto/BACKLOG.md', '# Backlog\n- [ ] ルビーのお店\n- [ ] ログインボーナス\n- [ ] 釣り大会\n');
w('bds/addons/u1/TASK.md', '# u1\n\n## Changes\n- 2026-10-01 ルビーを5個に\n');
w('bds/addons/u1/src/main.ts', 'main v1\n');
w('bds/addons/u2/TASK.md', '# u2\n'); w('bds/addons/u2/src/main.ts', 'u2 v1\n');
w('bds/.lab/last-fail/u2.json', '{}');
w('.gitignore', '.lab/\nauto/.work/\nauto/.lease.json\n.calls.jsonl\n.fake.json\n');
spawnSync('git', ['init', '-q', '--bare', BARE]);
git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('add', '-A'); git('commit', '-q', '-m', 'init'); git('remote', 'add', 'origin', BARE); git('push', '-q', 'origin', 'main');
// (a ledger row as old as an upkeep: upkeep is not due; the ledger starts empty otherwise)
fs.writeFileSync(path.join(X, 'auto', 'ledger.jsonl'), JSON.stringify({ id: 'upkeep', at: new Date().toISOString(), kind: 'upkeep', ok: true, tokens: 0 }) + '\n');

// ---- the fake AI: answers by what is asked ----
const AI = { pick: null, review: 'APPROVE: fine', engine: [], seen: [] };
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
  const j = JSON.parse(b), last = j.messages.at(-1), text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  AI.seen.push({ text, tools: !!j.tools, sys: JSON.stringify(j.system ?? '') });
  let reply;
  if (j.tools) {   // the engine agent: the scripted steps, then a summary
    const step = AI.engine.shift();
    reply = step ? { content: step.map((c, i) => ({ type: 'tool_use', id: `t${AI.seen.length}_${i}`, name: c.name, input: c.input })), stop_reason: 'tool_use' } : { content: [{ type: 'text', text: 'changed the engine' }], stop_reason: 'end_turn' };
  } else {
    let t = 'ok';
    if (/Pick the ONE task/.test(text)) t = JSON.stringify({ pick: AI.pick, why: 'the test says so' });
    else if (/You are the reviewer/.test(text)) { if (AI.review === null) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"down"}'); return; } t = AI.review; }
    else if (/failed\. Write ONE line/.test(text)) t = 'Read the failing line with why before editing.';
    else if (/Propose 3 NEW/.test(text)) t = '```json\n["新しいアイデアA","新しいアイデアB","ルビーのお店"]\n```';
    else if (/Reread what you did/.test(text)) t = JSON.stringify({ add: ['lab: make why print the hook line'], drop: ['釣り大会'], lessons: ['one condensed lesson'] });
    reply = { content: [{ type: 'text', text: t }], stop_reason: 'end_turn' };
  }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...reply, usage: { input_tokens: 100, output_tokens: 20 } }));
}); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ENV = { LAB_AUTO_ROOT: X, ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}`, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', LAB_NOTIFY_WEBHOOK: '', LAB_NETENV: 'off', LAB_DOTENV: 'off' };
const auto = (args, env = {}) => new Promise((res) => { const c = spawn(process.execPath, [path.join(REPO, 'lab.mjs'), 'auto', ...args], { cwd: REPO, env: { ...process.env, ...ENV, ...env } }); let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; }); c.on('close', (status) => res({ status, t })); });
const rows = () => (rd('auto/ledger.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const head = () => git('log', '-1', '--format=%s').stdout.trim(), remoteHead = () => spawnSync('git', ['--git-dir', BARE, 'log', '-1', '--format=%s', 'main'], { encoding: 'utf8' }).stdout.trim();

// 1. sense, no tokens
let r = await auto([]);
ok(/repair:bds\/u2/.test(r.t) && /release:bds\/u1/.test(r.t) && /backlog:/.test(r.t) && !/playtest:/.test(r.t) && !/^\s+[\d.]+\s+upkeep/m.test(r.t), 'status: the queue from the units, the backlog and the policy (kinds switched off are not there)', r.t);
ok(r.t.indexOf('repair:bds/u2') < r.t.indexOf('release:bds/u1') && !AI.seen.length, 'repair ranks first; the status asks no AI', r.t);

// 2. a clear lead needs no question; a close call: the AI picks (not the best score), nothing runs, nothing is written
r = await auto(['run', '--dry', '--via', 'anthropic']);
ok(/auto: repair:bds\/u2/.test(r.t) && /a clear lead .*no AI asked/.test(r.t) && !AI.seen.length, 'a broken unit far ahead: picked without asking the AI', r.t);
const polFull = rd('auto/policy.json');
w('auto/policy.json', JSON.stringify({ ...JSON.parse(polFull), kinds: { ...JSON.parse(polFull).kinds, repair: false } }));
AI.pick = 'release:bds/u1';
r = await auto(['run', '--dry', '--via', 'anthropic']);
ok(/auto: release:bds\/u1/.test(r.t) && /why: the test says so/.test(r.t) && /DRY node lab\.mjs bds release -a u1/.test(r.t) && rows().length === 1 && !calls().length, 'run --dry: the AI\'s pick and reason, the command, nothing done', r.t);
const pickAsk = AI.seen.find((s) => /Pick the ONE task/.test(s.text));
ok(pickAsk && /release:bds\/u1 \| release/.test(pickAsk.text) && /Lessons:/.test(pickAsk.text), 'the AI is shown the ranked candidates, the ledger and the lessons');
AI.pick = 'nope:x';
r = await auto(['run', '--dry', '--via', 'anthropic']);
ok(/not a candidate/.test(r.t) && /auto: release:bds\/u1/.test(r.t), 'a pick that is not a candidate: the best score instead', r.t);

// 3. the kill switch
r = await auto(['stop', 'testing']); AI.seen.length = 0;
r = await auto(['run', '--via', 'anthropic']);
ok(/^STOP auto\/STOP: testing/m.test(r.t) && !AI.seen.length && !calls().length, 'auto/STOP: nothing runs, not even a question to the AI', r.t);
r = await auto(['resume'], { LAB_AUTO_AGENT: '1' });
ok(r.status !== 0 && fs.existsSync(path.join(X, 'auto', 'STOP')), 'an AI (LAB_AUTO_AGENT) cannot resume it', r.t);
r = await auto(['resume']);
ok(r.status === 0 && !fs.existsSync(path.join(X, 'auto', 'STOP')), 'the person resumes it');

// 4. a release: the lab acts, the reviewer approves, committed and pushed to main
AI.pick = 'release:bds/u1';
fake({ 'bds release -a u1': { exit: 0, lines: ['OK released u1 v1.0.1'], write: { 'bds/addons/u1/CHANGELOG.md': '# u1\n\n## 1.0.1\n- ルビーを5個に\n' } } });
r = await auto(['run', '--via', 'anthropic']);
let c = calls().at(-1);
ok(/^OK release:bds\/u1/m.test(r.t) && c?.a === 'bds release -a u1' && c.agent === '1' && Number(c.budget) > 0 && Number(c.budget) <= 5000, 'the lab ran release, as an agent (LAB_AUTO_AGENT), with the task budget', r.t + JSON.stringify(c));
ok(/review: APPROVE: mechanical/.test(r.t) && !AI.seen.some((s) => /You are the reviewer/.test(s.text)), 'a release (version and notes only) needs no reviewer', r.t);
ok(/^auto\(release\)/.test(head()) && head() === remoteHead() && git('show', '--stat', 'HEAD').stdout.includes('auto/ledger.jsonl'), `committed with its ledger row and pushed to main (${head()})`, r.t);
ok(rows().at(-1).ok === true && rows().at(-1).why === 'the test says so' && rows().at(-1).tokens > 0, 'the ledger row: ok, the reason, the tokens');
r = await auto([]);
ok(!/release:bds\/u1/.test(r.t), 'released: no longer in the queue', r.t);

// 5. a failure: put back, a lesson, cooling down
w('auto/policy.json', polFull);
AI.pick = 'repair:bds/u2';
fake({ 'maintain --lab bds -a u2': { exit: 1, lines: ['BROKEN u2: tests still fail'] } });   // (maintain puts a BROKEN unit back itself)
r = await auto(['run', '--via', 'anthropic']);
ok(/^FAIL repair:bds\/u2/m.test(r.t) && rd('bds/addons/u2/src/main.ts') === 'u2 v1\n', 'a failed repair: FAIL, the unit as it was', r.t);
ok(/\[repair\] Read the failing line with why/.test(rd('auto/LESSONS.md') ?? ''), 'the failure became a lesson in auto/LESSONS.md');
ok(/failed, ledger only/.test(head()) && git('show', '--stat', 'HEAD').stdout.includes('auto/LESSONS.md') && !git('show', '--stat', 'HEAD').stdout.includes('main.ts'), 'only the memory of the failure is committed', head());
r = await auto([]);
ok(!/repair:bds\/u2/.test(r.t), 'the failed target waits (backoff) before it is tried again', r.t);

// 5b. upkeep that fixed one unit and not another: maintain kept the fix, so it stays and is merged (partly); a failed make is put back
fs.appendFileSync(path.join(X, 'auto', 'ledger.jsonl'), JSON.stringify({ id: 'upkeep', at: '2020-01-01T00:00:00Z', kind: 'upkeep', ok: true, tokens: 0 }) + '\n');
w('auto/policy.json', JSON.stringify({ ...JSON.parse(polFull), upkeepHours: 1 }));
AI.pick = 'upkeep';
fake({ '^upkeep$': { exit: 1, lines: ['🔧 bds/u1: FIXED — autofix', '✘ bds/u2: BROKEN', 'FAIL maintain: FIXED 1, BROKEN 1'], write: { 'bds/addons/u1/src/main.ts': 'main v2 (fixed)\n' } } });
r = await auto(['run', '--via', 'anthropic']);
ok(/^FAIL upkeep/m.test(r.t) && rd('bds/addons/u1/src/main.ts') === 'main v2 (fixed)\n' && /: partly: /.test(head()) && head() === remoteHead(), 'upkeep partly done: the fixed unit stays and is merged', r.t + head());
w('auto/policy.json', polFull);
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] 壊れる依頼\n');
AI.pick = (await auto([])).t.match(/backlog:\w+/)?.[0];
fake({ 'make ': { exit: 1, lines: ['NOT DONE addons/half via anthropic: 900 tokens'], write: { 'bds/addons/half/src/main.ts': 'half\n' } } });
r = await auto(['run', '--via', 'anthropic']);
ok(/^FAIL backlog/m.test(r.t) && !fs.existsSync(path.join(X, 'bds/addons/half')), 'a make that did not finish: the half-built unit is removed', r.t);
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] はみ出す依頼\n');
AI.pick = (await auto([])).t.match(/backlog:\w+/)?.[0];
fake({ 'make ': { exit: 0, lines: ['MADE addons/wide via anthropic: 900 tokens'], write: { 'bds/addons/wide/src/main.ts': 'wide\n', 'common/engine.txt': 'sneaky\n' } } });
r = await auto(['run', '--via', 'anthropic']);
ok(/^OK backlog/m.test(r.t) && rd('common/engine.txt') === 'engine v1\n' && rd('bds/addons/wide/src/main.ts') === 'wide\n' && /outside backlog's scope put back: common\/engine\.txt/.test(r.t), 'a build that also edits the engine: the unit stays, the engine edit is put back', r.t);
fake({ 'make ': { exit: 0, lines: ['MADE addons/wide via anthropic: 900 tokens'], write: { 'bds/addons/wide/src/main.ts': 'wide2\n', 'auto/policy.json': '{"dailyTokens":1e15}' } } });
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] 床に触る依頼\n');
AI.pick = (await auto([])).t.match(/backlog:\w+/)?.[0];
r = await auto(['run', '--via', 'anthropic']);
ok(/^FAIL backlog/m.test(r.t) && /touched the floor/.test(r.t) && JSON.parse(rd('auto/policy.json')).dailyTokens !== 1e15 && rd('bds/addons/wide/src/main.ts') === 'wide\n', 'a build that touches the policy: FAIL, all of it put back', r.t);
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] ルビーのお店\n- [ ] ログインボーナス\n- [ ] 釣り大会\n');
r = await auto([]);

// 6. the lessons reach every make; the reviewer rejects → put back
AI.pick = (r.t.match(/backlog:\w+/) ?? [])[0]; AI.review = 'REJECT: it deletes a test';
fake({ 'make ': { exit: 0, lines: ['MADE addons/ruby via anthropic: 1,234 tokens'], write: { 'bds/addons/ruby/src/main.ts': 'ruby\n' } } });
r = await auto(['run', '--via', 'anthropic']);
c = calls().at(-1);
ok(/^make .*--playtest$/.test(c?.a ?? '') && /Read the failing line with why/.test(c.ctxText ?? '') && c.ctxText.length <= 1600 && !/\d{4}-\d\d-\d\d/.test(c.ctxText), 'a backlog item → make "<request>" --playtest with LAB_MAKE_CONTEXT = the newest lessons, short', JSON.stringify(c));
ok(/rejected by review: REJECT: it deletes a test/.test(r.t) && !fs.existsSync(path.join(X, 'bds/addons/ruby')) && /\(tried 1×\)/.test(rd('auto/BACKLOG.md')), 'REJECT: the new unit is put back, the item counts the try', r.t);
ok(rows().at(-1).tokens >= 1234, 'the make\'s own tokens are counted', JSON.stringify(rows().at(-1)));
// 6b. the reviewer cannot be asked (its API answers an error): nothing is merged unread (it used to merge "on the checks alone")
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] 見てもらえない依頼\n');
AI.pick = (await auto([])).t.match(/backlog:\w+/)?.[0]; AI.review = null;
fake({ 'make ': { exit: 0, lines: ['MADE addons/unread via anthropic: 100 tokens'], write: { 'bds/addons/unread/src/main.ts': 'unread\n' } } });
r = await auto(['run', '--via', 'anthropic']);
ok(/not merged/.test(r.t) && /REJECT: the reviewer could not be asked/.test(r.t) && !fs.existsSync(path.join(X, 'bds/addons/unread')), 'the reviewer could not be asked: not merged, put back (fails closed)', r.t);
AI.review = 'APPROVE: fine';

// 7. the engine agent: changes the lab itself; the floor refuses; the gate keeps or puts back
AI.pick = null;
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] lab: say v2\n');
let lid = (await auto([])).t.match(/lab:\w+/)?.[0]; AI.pick = lid;
AI.engine = [[{ name: 'write', input: { path: 'auto/policy.json', content: '{"dailyTokens":1e12}' } }, { name: 'read', input: { path: '.env' } }, { name: 'run', input: { command: 'node lab.mjs auto resume' } }], [{ name: 'edit', input: { path: 'common/engine.txt', old: 'v1', new: 'v2' } }]];
r = await auto(['run', '--via', 'anthropic']);
const tr = AI.seen.filter((s) => s.tools).map((s) => s.text).join('\n');
ok(/the person's \(common\/auto-guard\.mjs\)/.test(tr) && /a secret: never/.test(tr) && /not from here: lab\.mjs auto/.test(tr) && JSON.parse(rd('auto/policy.json')).dailyTokens === 100000, 'the engine agent cannot write the policy, read a secret, or run auto', tr.slice(-600));
ok(AI.seen.some((s) => /You are the reviewer/.test(s.text) && /-engine v1/.test(s.text) && /\+engine v2/.test(s.text)), 'an engine change: the reviewer is shown the diff');
ok(/^OK lab:/m.test(r.t) && rd('common/engine.txt') === 'engine v2\n' && /gate ✔ tests\/gate-a\.mjs/.test(r.t) && /^auto\(lab\)/.test(head()) && head() === remoteHead(), 'its change passed the gate and was merged', r.t);
ok(/\[x\] lab: say v2/.test(rd('auto/BACKLOG.md')), 'the item is checked off');
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] lab: break it\n');
lid = (await auto([])).t.match(/lab:\w+/)?.[0]; AI.pick = lid;
AI.engine = [[{ name: 'write', input: { path: 'common/engine.txt', content: 'BROKEN\n' } }]];
r = await auto(['run', '--via', 'anthropic']);
ok(/^FAIL lab:/m.test(r.t) && /broke tests\/gate-a\.mjs/.test(r.t) && rd('common/engine.txt') === 'engine v2\n', 'a change that breaks a gate test that passed before: put back', r.t);

r = await auto([]);
ok(/^\s+[\d.]+\s+share\s+share bds-lab itself: 1 engine change/m.test(r.t), 'the lab itself changed: sharing a new release of it is queued', r.t);
fs.appendFileSync(path.join(X, 'auto', 'ledger.jsonl'), JSON.stringify({ id: 'share:v1.0.0', at: new Date().toISOString(), kind: 'share', ok: true, tokens: 0 }) + '\n');
ok(!/share bds-lab itself/.test((await auto([])).t), 'after a share: not queued again');

// 8. invent and reflect: the AI writes its own backlog
AI.pick = 'invent'; fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] ルビーのお店\n');
r = await auto(['run', '--via', 'anthropic']);
const bl = rd('auto/BACKLOG.md');
ok(/^OK invent/m.test(r.t) && /- \[ \] 新しいアイデアA/.test(bl) && /- \[ \] 新しいアイデアB/.test(bl) && bl.split('ルビーのお店').length === 2, 'invent: new ideas into the backlog (no duplicate)', r.t + bl);
fs.appendFileSync(path.join(X, 'auto', 'BACKLOG.md'), '- [ ] 釣り大会\n'); AI.pick = 'reflect';
w('auto/policy.json', JSON.stringify({ ...JSON.parse(rd('auto/policy.json')), reflectEvery: 1 }));
r = await auto(['run', '--via', 'anthropic']);
ok(/^OK reflect/m.test(r.t) && /- \[-\] 釣り大会 \(dropped/.test(rd('auto/BACKLOG.md')) && /- \[ \] lab: make why print the hook line/.test(rd('auto/BACKLOG.md')) && /^- one condensed lesson$/m.test(rd('auto/LESSONS.md')), 'reflect: drops, adds a lab change, condenses the lessons', r.t + rd('auto/BACKLOG.md'));

// 9. the token cap
fs.appendFileSync(path.join(X, 'auto', 'ledger.jsonl'), JSON.stringify({ id: 'x', at: new Date().toISOString(), kind: 'backlog', ok: true, tokens: 200000 }) + '\n');
AI.seen.length = 0; r = await auto(['run', '--via', 'anthropic']);
ok(/^PAUSE today's tokens/m.test(r.t) && !AI.seen.length, 'dailyTokens reached: PAUSE, no AI', r.t);
r = await auto(['next']);
ok(/^PAUSE/m.test(r.t), 'next pauses too');
w('auto/policy.json', JSON.stringify({ ...JSON.parse(rd('auto/policy.json')), dailyTokens: 1e9 }));

// 10. next/done: the agent is the AI; the floor is checked, an engine task gated
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] lab: agent edit\n');
w('auto/policy.json', JSON.stringify({ ...JSON.parse(rd('auto/policy.json')), kinds: { playtest: false, harden: false, issue: false, repair: false, release: false, invent: false, reflect: false } }));
r = await auto(['next']);
const tid = /^TASK (\S+)/m.exec(r.t)?.[1];
ok(tid?.startsWith('lab:') && /then: node lab\.mjs auto done/.test(r.t) && /never: auto\/policy\.json/.test(r.t), 'next: one task, how, and the floor', r.t);
fs.writeFileSync(path.join(X, 'common', 'engine.txt'), 'BROKEN\n');
r = await auto(['done', tid, 'ok']);
ok(r.status !== 0 && /broke tests\/gate-a\.mjs/.test(r.t) && rd('common/engine.txt') === 'engine v2\n', 'done ok on an engine task that breaks the gate: FAIL, put back', r.t);
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] lab: agent edit 2\n');
r = await auto(['next']); const tid2 = /^TASK (\S+)/m.exec(r.t)?.[1];
fs.writeFileSync(path.join(X, 'common', 'engine.txt'), 'engine v3\n'); w('auto/policy.json', rd('auto/policy.json').replace('1000000000', '1000000001'));
r = await auto(['done', tid2, 'ok']);
ok(r.status !== 0 && /touched the floor/.test(r.t) && rd('common/engine.txt') === 'engine v2\n' && !rd('auto/policy.json').includes('1000000001'), 'done after touching the policy: everything put back', r.t);
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] lab: agent edit 3\n');
r = await auto(['next']); const tid3 = /^TASK (\S+)/m.exec(r.t)?.[1];
fs.writeFileSync(path.join(X, 'common', 'engine.txt'), 'engine v3\n');
r = await auto(['done', tid3, 'ok']);
ok(r.status === 0 && /merged/.test(r.t) && rd('common/engine.txt') === 'engine v3\n' && rows().at(-1).via === 'agent', 'done ok, gate passed: merged, the ledger says the agent did it', r.t);

// 11. issues labeled for the autopilot: built, answered, closed
w('auto/policy.json', JSON.stringify({ ...JSON.parse(rd('auto/policy.json')), kinds: { playtest: false, harden: false, repair: false, release: false, invent: false, reflect: false, lab: false, backlog: false } }));
fs.writeFileSync(path.join(T, 'issues.json'), JSON.stringify([{ number: 9, title: 'make: 雪玉で敵を凍らせる', body: '3秒' }]));
fake({ 'make ': { exit: 0, lines: ['MADE addons/snow via anthropic: 900 tokens'] } });
r = await auto(['run', '--via', 'anthropic'], { LAB_AUTO_ISSUES: path.join(T, 'issues.json'), LAB_CI_DRY: '1' });
ok(/^OK issue:#9/m.test(r.t) && /^make 雪玉で敵を凍らせる\s+3秒 --playtest$/.test(calls().at(-1)?.a ?? '') && /DRY gh issue comment 9/.test(r.t) && /DRY gh issue close 9/.test(r.t) && /addons\/snow/.test(r.t), 'an issue: make from its text, a comment, closed', r.t);
r = await auto([], { LAB_AUTO_ISSUES: path.join(T, 'issues.json') });
ok(!/issue:#9/.test(r.t), 'a done issue is not taken again', r.t);

// 12. policy: set by the person, refused to an AI; four failures give up
r = await auto(['policy', 'merge=local', 'kinds.issue=false']);
ok(r.status === 0 && JSON.parse(rd('auto/policy.json')).merge === 'local' && JSON.parse(rd('auto/policy.json')).kinds.issue === false && JSON.parse(rd('auto/policy.json')).kinds.lab === false, 'auto policy key=value (nested keys kept)', r.t);
r = await auto(['policy', 'merge=auto'], { LAB_AUTO_AGENT: '1' });
ok(r.status !== 0 && JSON.parse(rd('auto/policy.json')).merge === 'local', 'an AI cannot change the policy');
const { rank } = await import(path.join(REPO, 'common', 'auto.mjs'));
const old = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const t4 = [{ id: 'backlog:z', kind: 'backlog' }], pol = { taskTokens: 1000 };
ok(rank(t4, pol, [1, 2, 3, 4].map((i) => ({ id: 'backlog:z', kind: 'backlog', ok: false, at: old(100 + i) }))).length === 0, 'four failures in a row: given up');
ok(rank(t4, pol, [{ id: 'backlog:z', kind: 'backlog', ok: false, at: old(1) }]).length === 0 && rank(t4, pol, [{ id: 'backlog:z', kind: 'backlog', ok: false, at: old(3) }]).length === 1, 'one failure waits 2 hours');
const good = rank([{ id: 'a', kind: 'harden' }], pol, [{ id: 'q', kind: 'harden', ok: true, tokens: 10, at: old(50) }, { id: 'q', kind: 'harden', ok: true, tokens: 10, at: old(40) }])[0].score;
const bad = rank([{ id: 'a', kind: 'harden' }], pol, [{ id: 'q', kind: 'harden', ok: false, tokens: 5000, at: old(50) }, { id: 'q2', kind: 'harden', ok: false, tokens: 5000, at: old(40) }])[0].score;
ok(good > bad * 3, `the ledger teaches the ranking: a kind that works cheaply scores higher (${good} vs ${bad})`);
// upkeep follows Minecraft: never given up, but each failure doubles its wait (a run takes minutes: an account's Actions minutes)
const up = [{ id: 'upkeep', kind: 'upkeep' }], upPol = { taskTokens: 1000, upkeepHours: 24 }, upFails = (n, h) => Array.from({ length: n }, (_, i) => ({ id: 'upkeep', kind: 'upkeep', ok: false, at: old(h + n - 1 - i) }));
ok(rank(up, upPol, upFails(5, 24 * 8)).length === 1 && rank(up, upPol, upFails(1, 23)).length === 0 && rank(up, upPol, upFails(1, 25)).length === 1 && rank(up, upPol, upFails(2, 30)).length === 0 && rank(up, upPol, upFails(2, 49)).length === 1,
  'upkeep is never given up; after f failures it waits its period × 2^(f-1) (a day, two days, … a week at most)');

// 13. the guards around a run: no AI → only what the lab does alone; no autopilot inside its own task; one at a time
w('auto/policy.json', JSON.stringify({ ...JSON.parse(rd('auto/policy.json')), kinds: {} }));
fs.writeFileSync(path.join(X, 'auto', 'BACKLOG.md'), '# Backlog\n- [ ] lab: x\n- [ ] something\n');
const noAI = { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OPENAI_BASE_URL: '', PATH: path.dirname(process.execPath) };
r = await auto(['run', '--dry'], noAI);
ok(/no AI/.test(r.t) && !/auto: (lab|backlog|invent|reflect|playtest|harden)/.test(r.t), 'no AI: lab/backlog/invent/reflect/playtest/harden are not picked (harden asks an AI for what it adds)', r.t);
// plan: what a schedule asks before its costly set-up (auto.yml): work or not, and the labs it may touch
const gho = path.join(T, 'gh-output.txt');
r = await auto(['plan'], { ...noAI, GITHUB_OUTPUT: gho });
ok(r.status === 0 && /^WORK \S+ first \(\d+ candidate\(s\), labs [a-z,]+\)/m.test(r.t) && /^work=yes$/m.test(fs.readFileSync(gho, 'utf8')) && /^labs=.*bds/m.test(fs.readFileSync(gho, 'utf8')), 'auto plan: work this hour, and the labs it may need (the set-up is chosen from it)', r.t + fs.readFileSync(gho, 'utf8'));
fs.writeFileSync(path.join(X, 'auto', 'STOP'), 'paused by a person\n'); fs.rmSync(gho, { force: true });
r = await auto(['plan'], { ...noAI, GITHUB_OUTPUT: gho });
ok(r.status === 0 && /^IDLE stopped: paused by a person/m.test(r.t) && /^work=no$/m.test(fs.readFileSync(gho, 'utf8')), 'auto plan when stopped: IDLE, work=no (the run ends before any set-up)', r.t);
fs.rmSync(path.join(X, 'auto', 'STOP'), { force: true });
r = await auto(['run'], { LAB_AUTO_AGENT: '1' });
ok(r.status !== 0 && /already running/.test(r.t), 'an AI the autopilot started cannot start another autopilot', r.t);
const sleeper = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)']);
fs.writeFileSync(path.join(X, 'auto', '.lock'), JSON.stringify({ pid: sleeper.pid, at: Date.now() }));
r = await auto(['run', '--dry', '--via', 'anthropic']);
ok(/^BUSY another autopilot/m.test(r.t), 'a second autopilot on the same folder waits (BUSY)', r.t);
sleeper.kill(); await new Promise((z) => setTimeout(z, 200));
r = await auto(['run', '--dry', '--via', 'anthropic']);
ok(!/BUSY/.test(r.t) && !fs.existsSync(path.join(X, 'auto', '.lock')), 'a stale lock is taken over, and released at the end', r.t);

srv.close();
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} auto-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
