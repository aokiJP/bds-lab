#!/usr/bin/env node
// Token-efficiency benchmark: an AI builds an addon with bds-lab; hidden tests decide pass, transcripts decide rank.
// A run gets a whole copy of the lab (caches shared, no addons), exactly what a person hands an AI.
//   node bench/bench.mjs run <task|all> [--via claude]   start, let the claude CLI do it, end: one command
//   node bench/bench.mjs start <agent> <task|all>        (then run any AI in the printed folder with the printed prompt)
//   node bench/bench.mjs end <id> [--claude|--codex|--transcript f|--tokens N --steps N] [--keep]   (the workspace is removed
//                                        afterwards: its row, <id>.json and <id>.trace.jsonl stay; --keep / LAB_BENCH_KEEP=1 keeps it)
//   node bench/bench.mjs rank [task]      node bench/bench.mjs selftest
//   node bench/bench.mjs friction [n|all|<transcript.jsonl>...]   where the AIs lost steps and tokens (friction.mjs)
//   node bench/bench.mjs playtest [<case>] [--via claude]   planted bugs: how many the AI playtest + fix loop removes (playbench.mjs)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE), TOP = path.dirname(ROOT);
const RUNS = path.join(ROOT, 'runs');
const RANK = path.join(HERE, 'ranking.json');
const TASKS = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks.json'), 'utf8'));
const tok = (chars) => Math.ceil(chars / 4);

function taskOf(id) {
  const ks = id === 'all' ? Object.keys(TASKS).filter((k) => !TASKS[k].lab) : [id];
  for (const k of ks) if (!TASKS[k]) throw new Error(`unknown task ${k}. tasks: ${Object.keys(TASKS).join(' ')} all`);
  return {
    prompt: ks.map((k) => '- ' + TASKS[k].prompt).join('\n'),
    test: ks.flatMap((k) => TASKS[k].test),
    clean: ks.some((k) => TASKS[k].clean),
    guards: ks.flatMap((k) => TASKS[k].guards ?? []),   // expectations that hold on the empty template by design (they catch overdoing it)
    lab: TASKS[ks[0]].lab,   // end/ll tasks are run one at a time
  };
}

// node <lab>/lab.mjs from the run's bds folder
function lab(dir, args, env = {}, k = 'bds') {
  const r = spawnSync(process.execPath, [path.join(dir, k, 'lab.mjs'), ...args], { cwd: path.join(dir, k), encoding: 'utf8', env: { ...process.env, LAB_NOTRACE: '1', ...env }, timeout: 900000 });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
// the same, not waited for (selftest's three runs on their own servers at once)
function labAsync(dir, args, env = {}, k = 'bds') {
  return new Promise((res) => {
    const c = spawn(process.execPath, [path.join(dir, k, 'lab.mjs'), ...args], { cwd: path.join(dir, k), env: { ...process.env, LAB_NOTRACE: '1', ...env } });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), 900000);
    c.on('close', (code) => { clearTimeout(t); res({ code, out }); });
  });
}

// the lab as a person hands it over: every file but caches, runs and units; the caches are linked (server, tools, types)
const SKIP = new Set(['.git', 'runs', '.lab', 'dist', 'node_modules', '.lab-node', 'verify-result.txt', '.lab-run.txt', '.lab-run.json']);
const PER_RUN = new Set(['addon', 'report.json', 'maps', 'render', 'debug', 'trace.jsonl', 'live.json', 'selftest.txt', 'verify-full.txt', 'patch-backup']);
function makeWorkspace(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const f = path.join(from, e.name), t = path.join(to, e.name), r = path.relative(TOP, f).split(path.sep).join('/');
      if (/^bds\/addons\/./.test(r)) continue;   // (end/ll samples stay: help ideas points at them)
      if (r === 'bds/vendor/bedrock-server.zip') { fs.symlinkSync(f, t); continue; }
      if (e.isDirectory()) copy(f, t); else fs.copyFileSync(f, t);
    }
  };
  copy(TOP, dir);
  for (const k of ['bds', 'end', 'll']) {
    const c = path.join(TOP, k, '.lab'); if (!fs.existsSync(c)) continue;
    fs.mkdirSync(path.join(dir, k, '.lab'), { recursive: true });
    for (const e of fs.readdirSync(c)) {
      if (PER_RUN.has(e) || e === 'run' || e.endsWith('.lock')) continue;   // server instances hold worlds: each run makes its own
      if (/^world/.test(e)) fs.cpSync(path.join(c, e), path.join(dir, k, '.lab', e), { recursive: true });   // templates: copied, never shared
      else fs.symlinkSync(path.join(c, e), path.join(dir, k, '.lab', e));
    }
  }
  fs.writeFileSync(path.join(dir, '.lab-kind'), 'bds\n');
  // A/B for skills (node lab.mjs skill bench): the same lab without them (the folder, and the AGENTS.md line that names them)
  if (process.env.LAB_SKILLS === 'off') {
    fs.rmSync(path.join(dir, 'skills'), { recursive: true, force: true });
    const a = path.join(dir, 'AGENTS.md'); fs.writeFileSync(a, fs.readFileSync(a, 'utf8').split('\n').filter((l) => !/^Skills\b/.test(l)).join('\n'));
  }
  // ... or without one skill (skill bench --without <name>): does that one earn the tokens it costs?
  const wo = /^without:([a-z0-9-]+)$/.exec(process.env.LAB_SKILLS ?? '');
  if (wo) fs.rmSync(path.join(dir, 'skills', wo[1]), { recursive: true, force: true });
}
// the unit the AI made: bds addons/ (bp/manifest.json), end plugins/ (pyproject.toml), ll mods/ (manifest.json)
const UNITS = { bds: ['addons', 'bp/manifest.json'], end: ['plugins', 'pyproject.toml'], ll: ['mods', 'manifest.json'] };
const newestAddon = (dir, k = 'bds') => { const a = path.join(dir, k, UNITS[k][0]); return fs.existsSync(a) ? fs.readdirSync(a).filter((n) => fs.existsSync(path.join(a, n, UNITS[k][1]))).sort((x, y) => fs.statSync(path.join(a, y)).mtimeMs - fs.statSync(path.join(a, x)).mtimeMs)[0] : null; };

// hidden verification: task tests (outside the workspace) on the addon the AI made + optional "no warnings" for content tasks
// (name: that unit, else the newest one; run: lab or labAsync)
let hiddenN = 0;
function verify(dir, t, name = null, run = lab) {
  const k = t.lab ?? 'bds', total = t.test.filter((l) => /^[=~!]/.test(l)).length;
  name ??= newestAddon(dir, k);
  const done = (r, c) => {
    const m = /(PASS|FAIL) (\d+)\/(\d+)/.exec(r.out);
    const notes = r.out.split('\n').filter((l) => /^(✘|E |  want|  got)/.test(l));
    let clean = true;
    if (c) {
      const w = c.out.split('\n').filter((l) => /^[EW] /.test(l));
      clean = c.code === 0 && !w.length;
      notes.push(...w.map((l) => 'check: ' + l));
    }
    return { passed: m ? Number(m[2]) : 0, total: m ? Number(m[3]) : total, ok: m?.[1] === 'PASS' && clean, clean, notes, out: r.out };
  };
  if (!name) { const none = { passed: 0, total, ok: false, clean: false, notes: ['no addon made'], out: '' }; return run === lab ? none : Promise.resolve(none); }
  const hidden = path.join(os.tmpdir(), `bdslab-hidden-${process.pid}-${Date.now()}-${++hiddenN}.txt`);
  fs.writeFileSync(hidden, t.test.join('\n') + '\n');
  if (run === lab) {
    const r = lab(dir, ['test', hidden, '-a', name], {}, k);
    fs.rmSync(hidden, { force: true });
    return done(r, t.clean ? lab(dir, ['check', '-a', name], {}, k) : null);
  }
  return run(dir, ['test', hidden, '-a', name], {}, k).then(async (r) => { fs.rmSync(hidden, { force: true }); return done(r, t.clean ? await run(dir, ['check', '-a', name], {}, k) : null); });
}
// ---------- transcripts ----------
function lines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function claude(file, since) {
  const msgs = new Map(), tools = new Set();
  for (const e of lines(file)) {
    if (e.type !== 'assistant' || !e.message?.usage) continue;
    if (e.timestamp && Date.parse(e.timestamp) < since) continue;
    const u = e.message.usage;
    msgs.set(e.message.id ?? e.uuid, u);
    for (const c of e.message.content ?? []) if (c.type === 'tool_use') tools.add(c.id);
  }
  let total = 0, fresh = 0, output = 0;
  for (const u of msgs.values()) {
    const f = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    fresh += f + (u.output_tokens ?? 0);
    total += f + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
    output += u.output_tokens ?? 0;
  }
  return { tokens: total, fresh, output, steps: tools.size, turns: msgs.size, src: 'claude' };
}

function codex(file) {
  let last = null, steps = 0;
  for (const e of lines(file)) {
    const p = e.payload ?? e;
    if (p?.type === 'token_count' && p.info?.total_token_usage) last = p.info.total_token_usage;
    if (['function_call', 'local_shell_call', 'custom_tool_call'].includes(p?.type)) steps++;
  }
  if (!last) throw new Error('no token_count in ' + file);
  return { tokens: last.total_tokens ?? (last.input_tokens + last.output_tokens), fresh: (last.input_tokens ?? 0) - (last.cached_input_tokens ?? 0) + (last.output_tokens ?? 0), output: last.output_tokens ?? 0, steps, src: 'codex' };
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out); else if (d.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function findTranscript(kind, runDir, since) {
  const base = kind === 'claude' ? path.join(os.homedir(), '.claude', 'projects') : path.join(os.homedir(), '.codex', 'sessions');
  const esc = JSON.stringify(runDir).slice(1, -1);
  const recent = walk(base).filter((f) => fs.statSync(f).mtimeMs >= since).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const text = new Map(recent.map((f) => [f, fs.readFileSync(f, 'utf8')]));
  // the session whose working directory is the run folder; else the only one that mentions it
  const own = recent.filter((f) => text.get(f).includes(`"cwd":"${esc}"`));
  const ment = recent.filter((f) => text.get(f).includes(esc));
  const hit = own[0] ?? (ment.length === 1 ? ment[0] : null);
  if (!hit) throw new Error(`transcript not found (${ment.length} files mention ${runDir}); pass --transcript <file>`);
  console.log('transcript: ' + hit);
  return hit;
}

// ---------- commands ----------
function start(agent, task = 'all') {
  if (!agent) throw new Error('usage: start <agent> <task|all>');
  const t = taskOf(task);
  const r0 = spawnSync(process.execPath, [path.join(ROOT, 'lab.mjs'), 'setup'], { cwd: ROOT, encoding: 'utf8' });
  if (r0.status !== 0) throw new Error('setup failed:\n' + r0.stdout + r0.stderr);
  const id = `${agent.replace(/\W+/g, '_')}-${task}-${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}`;
  const dir = path.join(RUNS, id);
  makeWorkspace(dir);
  const prompt = t.lab === 'end' ? `Make this Endstone plugin:\n${t.prompt}` : t.lab === 'll' ? `Make this LeviLamina mod:\n${t.prompt}` : `Make this Minecraft Bedrock addon:\n${t.prompt}`;
  fs.writeFileSync(path.join(RUNS, `${id}.json`), JSON.stringify({ id, agent, task, start: Date.now(), prompt }));
  console.log(`workspace: ${dir}\nrun your AI with cwd = that folder and this prompt:\n-----\n${prompt}\n-----\nthen: node bench/bench.mjs end ${id} [--claude|--codex|--transcript <file>|--tokens N --steps N]`);
  return { id, dir, prompt };
}

// run: start + the claude CLI + end, usage straight from its JSON
function runTask(task, flags) {
  const via = flags.includes('--via') ? flags[flags.indexOf('--via') + 1] : 'claude';
  if (via !== 'claude') throw new Error('run: --via claude only (other AIs: start + end)');
  const { id, dir, prompt } = start('claude-cli', task);
  // its own session: run from inside an agent, the parent's session id would be inherited
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE_CODE_SESSION_ID|CLAUDE_CODE_CHILD_SESSION|CLAUDE_PID|CLAUDE_AFTER_LAST_COMPACT)$/.test(k))), IS_SANDBOX: process.env.IS_SANDBOX ?? '1' };
  const r = spawnSync('claude', ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'], { cwd: dir, env, encoding: 'utf8', input: '', maxBuffer: 64e6, timeout: 3600000 });
  let j; try { j = JSON.parse(r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1)); } catch { throw new Error('claude gave no JSON: ' + (r.stderr || r.stdout).slice(-400)); }
  const u = j.usage ?? {}, fresh = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
  end(id, ['--tokens', String(fresh + (u.cache_read_input_tokens ?? 0)), '--steps', String(j.num_turns ?? 0), '--fresh', String(fresh), ...(j.session_id ? ['--session', j.session_id] : [])]);
}

function end(id, flags) {
  if (!id) throw new Error('usage: end <id> [...]');
  const dir = path.join(RUNS, id);
  const meta = JSON.parse(fs.readFileSync(path.join(RUNS, `${id}.json`), 'utf8'));
  const endAt = Date.now();
  const v = verify(dir, taskOf(meta.task));

  const trf = path.join(dir, 'bds', '.lab', 'trace.jsonl');
  const tr = fs.existsSync(trf) ? lines(trf) : [];
  const labCalls = tr.length, labOut = tr.reduce((s, x) => s + (x.chars ?? 0), 0);
  const size = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
  const dirChars = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? dirChars(path.join(d, e.name)) : /\.(png|tga)$/.test(e.name) ? 0 : size(path.join(d, e.name))), 0) : 0);

  let m;
  const k = flags.indexOf('--transcript');
  if (flags.includes('--claude')) m = claude(findTranscript('claude', dir, meta.start), meta.start);
  else if (flags.includes('--codex')) m = codex(findTranscript('codex', dir, meta.start));
  else if (k >= 0) { const f = flags[k + 1]; m = /codex|rollout/.test(f) ? codex(f) : claude(f, meta.start); }
  else if (flags.includes('--tokens')) m = { tokens: Number(flags[flags.indexOf('--tokens') + 1]), steps: Number(flags[flags.indexOf('--steps') + 1] ?? labCalls), fresh: flags.includes('--fresh') ? Number(flags[flags.indexOf('--fresh') + 1]) : null, src: 'manual' };
  else { const ad = path.join(dir, 'bds', 'addons', newestAddon(dir) ?? '_'); m = { tokens: tok(meta.prompt.length + size(path.join(dir, 'AGENTS.md')) + labOut + dirChars(path.join(ad, 'src')) + dirChars(path.join(ad, 'bp')) + dirChars(path.join(ad, 'rp'))), steps: labCalls + 2, src: 'est' }; }

  const row = {
    id, agent: meta.agent, task: meta.task, pass: v.ok, checks: `${v.passed}/${v.total}${v.clean ? '' : ' +warn'}`,
    tokens: m.tokens, fresh: m.fresh ?? null, steps: m.steps, labCalls, labOutTok: tok(labOut), sec: Math.round((endAt - meta.start) / 1000), src: m.src, at: new Date(endAt).toISOString(),
    ...(flags.includes('--session') ? { session: flags[flags.indexOf('--session') + 1] } : {}),
  };
  const all = fs.existsSync(RANK) ? JSON.parse(fs.readFileSync(RANK, 'utf8')).filter((r) => r.id !== id) : [];
  all.push(row);
  fs.writeFileSync(RANK, JSON.stringify(all, null, 1) + '\n');
  v.notes.slice(0, 12).forEach((l) => console.log(l));
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.checks} tokens=${row.tokens} steps=${row.steps} lab=${labCalls} (${row.src})\n`);
  console.log(`RESULT ${JSON.stringify({ pass: row.pass, tokens: row.tokens, steps: row.steps, skills: process.env.LAB_SKILLS ?? 'on' })}`);   // (skill bench reads this)
  rank(meta.task);
  // the workspace is a whole copy of the lab (hundreds of MB): the row, its meta and the lab's trace are kept, the folder is not
  if (!flags.includes('--keep') && !process.env.LAB_BENCH_KEEP) {
    try { if (fs.existsSync(trf)) fs.copyFileSync(trf, path.join(RUNS, `${id}.trace.jsonl`)); fs.rmSync(dir, { recursive: true, force: true }); } catch { /* maint --fix cleans it later */ }
  }
}

function rank(task) {
  const all = fs.existsSync(RANK) ? JSON.parse(fs.readFileSync(RANK, 'utf8')) : [];
  const rows = all.filter((r) => !task || r.task === task).sort((a, b) => (b.pass - a.pass) || (a.tokens - b.tokens) || (a.steps - b.steps) || (a.sec - b.sec));
  if (!rows.length) return console.log('no results');
  console.log('| # | agent | task | pass | tokens | fresh | steps | lab | lab out | sec | src |\n|---|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach((r, i) => console.log(`| ${r.pass ? i + 1 : '-'} | ${r.agent} | ${r.task} | ${r.pass ? '✔' : '✘ ' + r.checks} | ${r.tokens.toLocaleString()} | ${r.fresh?.toLocaleString() ?? ''} | ${r.steps} | ${r.labCalls} | ${r.labOutTok} | ${r.sec} | ${r.src} |`));
}

// the reference solution (bds/bench/solution.mjs): every hidden test is solvable; the empty template and broken code must fail
import { SOLUTION, SOLUTION_ADD, SOLUTION_JSON } from './solution.mjs';

// The three runs on a real server (the empty template, the solution, the solution with a thrown error) are three units of their
// own, run at once on three servers: about a third of the time of one after another
async function selftest() {
  const dir = path.join(RUNS, '_selftest');
  const r0 = spawnSync(process.execPath, [path.join(ROOT, 'lab.mjs'), 'setup'], { cwd: ROOT, encoding: 'utf8' });
  if (r0.status !== 0) throw new Error('setup failed:\n' + r0.stdout + r0.stderr);
  makeWorkspace(dir);
  const t = taskOf('all');
  const none = verify(dir, t);
  lab(dir, ['new', 'bench', 'Bench Solution', '--js']);
  const units = path.join(dir, 'bds', 'addons'), ad = path.join(units, 'bench');
  fs.cpSync(ad, path.join(units, 'bench_empty'), { recursive: true });   // the template as `new` made it
  for (const a of SOLUTION_ADD) { const r = lab(dir, [...a, '-a', 'bench']); if (r.code !== 0) console.log(r.out); }   // (several units now: named)
  for (const [f, body] of Object.entries(SOLUTION)) { if (body === null) continue; fs.mkdirSync(path.dirname(path.join(ad, f)), { recursive: true }); fs.writeFileSync(path.join(ad, f), body); }
  for (const [f, fn] of Object.entries(SOLUTION_JSON)) { const j = JSON.parse(fs.readFileSync(path.join(ad, f), 'utf8')); fn(j); fs.writeFileSync(path.join(ad, f), JSON.stringify(j, null, 2)); }
  fs.cpSync(ad, path.join(units, 'bench_broken'), { recursive: true });
  fs.appendFileSync(path.join(units, 'bench_broken', 'bp/scripts/main.js'), '\nsystem.run(() => { throw new Error("x"); });\n');
  // (the pack after the solution's own run: the same unit's build, not at the same time)
  const [empty, [good, pk], broken] = await Promise.all([verify(dir, t, 'bench_empty', labAsync), verify(dir, t, 'bench', labAsync).then(async (g) => [g, await labAsync(dir, ['pack', '-a', 'bench'])]), verify(dir, t, 'bench_broken', labAsync)]);
  if (!process.env.KEEP) fs.rmSync(dir, { recursive: true, force: true });
  const ok = !none.ok && empty.passed <= t.guards.length && !empty.ok && good.ok && good.passed === good.total && !broken.ok && pk.code === 0;
  console.log(`no addon ${none.ok ? 'passed?!' : 'fails'} | template ${empty.passed}/${empty.total} (want ${t.guards.length ? `at most ${t.guards.length}: the guards` : 0}) | solution ${good.passed}/${good.total} clean=${good.clean} | pack=${pk.code === 0} | error detected=${!broken.ok}\n${ok ? 'SELFTEST OK' : 'SELFTEST FAIL\n' + good.notes.join('\n') + '\n' + good.out + pk.out}`);
  process.exitCode = ok ? 0 : 1;
}

const [cmd, ...a] = process.argv.slice(2);
try {
  if (cmd === 'start') start(a[0], a[1]);
  else if (cmd === 'run') runTask(a[0], a.slice(1));
  else if (cmd === 'end') end(a[0], a.slice(1));
  else if (cmd === 'rank') rank(a[0]);
  else if (cmd === 'selftest') await selftest();
  else if (cmd === 'friction') (await import('./friction.mjs')).friction(ROOT, a);
  else if (cmd === 'playtest') (await import('./playbench.mjs')).playbench(HERE, TOP, a);
  else console.log('usage: node bench/bench.mjs run <task|all> [--via claude] | start <agent> <task|all> | end <id> [--claude|--codex|--transcript f|--tokens N --steps N] | rank [task] | friction [n|all|<transcript.jsonl>...] | playtest [<case>] [--via claude] | selftest');
} catch (e) { console.error('ERR ' + e.message); process.exitCode = 1; }
