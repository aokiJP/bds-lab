// node lab.mjs scratch ...: practice building addons from nothing, and learn from it. The lessons are the bench's tasks
// (bds/bench/tasks.json: a request in a person's words + hidden tests, graded by level); the places to learn are the sandbox
// (sandbox-be: `sim`, `ts try`, seconds, no server) and the live world (TS REPL: `ts`, the real BDS); what it teaches flows
// back into the skills:
//   - every check is an episode (the failures the next edit removed: skill learn makes candidate rules of repeated ones)
//   - a section the sandbox and the real BDS disagree on is a sandbox gap (scratch gaps: sandbox-be's own to-do list)
//   - a probe that runs the same code in both and gets the same answer is measured evidence for a rule (scratch probe --rule)
//   scratch [list]                    the lessons by level, and what this lab has passed (sandbox / real BDS)
//   scratch next [--level n]          the next lesson to build from nothing, and how
//   scratch show <id>                 one lesson's request (never its tests)
//   scratch check <id> [--real] [-a <unit>]   its hidden tests on the unit: in the sandbox (seconds), --real on the real BDS
//   scratch stats                     first-try passes, attempts and time per lesson and area (skill growth shows the line)
//   scratch gaps [--backlog]          where the sandbox and the real BDS disagreed; --backlog files them in auto/BACKLOG.md
//   scratch probe "<code>" [--rule "<what it shows>" --skill <name>]   the same TypeScript in the sandbox (ts try) and the
//                                     live world (ts, after `up`): AGREE / DIFFER; agreeing + --rule → a candidate rule
//   scratch selftest [--real] [--jobs n]   the reference solution passes every lesson and the empty template fails (sandbox;
//                                     --real the real BDS too): the lessons themselves are proven before anyone practises on them.
//                                     --jobs n: n lessons at once, each on its own copies of the two units (the lines in order)
// State (this machine's experience, never shipped): bds/.lab/scratch.jsonl (checks), scratch-gaps.jsonl, probes.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = process.env.LAB_SCRATCH_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TASKS = () => { try { return JSON.parse(fs.readFileSync(path.join(TOP, 'bds', 'bench', 'tasks.json'), 'utf8')); } catch { return {}; } };
const STATE = () => (process.env.LAB_SCRATCH_STATE ? path.resolve(process.env.LAB_SCRATCH_STATE) : path.join(TOP, 'bds', '.lab'));   // (tests: elsewhere)
const LOG = () => path.join(STATE(), 'scratch.jsonl'), GAPS = () => path.join(STATE(), 'scratch-gaps.jsonl'), PROBES = () => path.join(STATE(), 'probes.jsonl');
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
const readRows = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const append = (f, row) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(row) + '\n'); };
const val = (args, k, d = null) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const pos = (args, flagsWithValue = ['-a', '--level', '--rule', '--skill']) => args.filter((a, i) => !a.startsWith('-') && !flagsWithValue.includes(args[i - 1]));
const bdsVersion = () => { try { return fs.readFileSync(path.join(TOP, 'bds', 'vendor', 'bds-version.txt'), 'utf8').trim(); } catch { return '?'; } };
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

/** the lessons in order: level, then the order tasks.json lists them */
export function lessons() {
  const t = TASKS();
  return Object.entries(t).map(([id, x], i) => ({ id, i, lab: x.lab ?? 'bds', level: x.level ?? 9, area: x.area ?? '', teaches: x.teaches ?? [], prompt: x.prompt, test: x.test ?? [], clean: !!x.clean }))
    .sort((a, b) => a.level - b.level || a.i - b.i);
}
const unitFor = (l) => `scratch_${l.id}`;
const unitDir = (l, u) => path.join(TOP, l.lab, UNITS[l.lab], u);
// a lesson's test as one file: a `## <id>` head when its first lines have none (so each run reports it by name)
const hiddenText = (l) => (/^## /.test(l.test[0] ?? '') ? l.test : [`## ${l.id}`, ...l.test]).join('\n') + '\n';
// what the unit is now (src, packs, tests): a sandbox and a real run of the same state can be compared
function stateHash(dir) {
  const h = crypto.createHash('sha1');
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; } for (const e of es) { if (/^(\.lab|node_modules|dist|tsconfig\.json|lab\.mjs)$/.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { h.update(path.relative(dir, p)); h.update(fs.readFileSync(p)); } } };
  walk(dir); return h.digest('hex').slice(0, 12);
}
function runLab(args, env = {}, timeout = 1800000) {
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', maxBuffer: 256e6, timeout, env: { ...process.env, LAB_NOTRACE: '1', FORCE_COLOR: '0', ...env } });
  return { code: r.status, text: ((r.stdout ?? '') + (r.stderr ?? '')).trim() };
}
// the same without waiting for it (selftest --jobs: several lessons at once); a run past its time is stopped (code null)
function runLabAsync(args, env = {}, timeout = 1800000) {
  return new Promise((res) => {
    let text = '', done = false;
    const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, env: { ...process.env, LAB_NOTRACE: '1', FORCE_COLOR: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (d) => { text += d; if (text.length > 256e6) text = text.slice(-128e6); };
    c.stdout.on('data', add); c.stderr.on('data', add);
    const kill = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, timeout);
    const end = (code) => { if (done) return; done = true; clearTimeout(kill); res({ code, text: text.trim() }); };
    c.on('error', (e) => { text += `\n${e.message}`; end(null); });
    c.on('close', (code) => end(code));
  });
}
/** status of every lesson from the log: { id: { sim, real, attempts, firstReal } } */
export function progress(rows = readRows(LOG())) {
  const p = {};
  for (const r of rows) {
    const x = (p[r.id] ??= { sim: null, real: null, attempts: 0, realTries: 0, firstTry: null, first: r.at, last: r.at });
    x.attempts++; x.last = r.at;
    if (r.where === 'sim') x.sim = r.pass ? 'pass' : x.sim === 'pass' ? 'pass' : r.verdict;
    else { x.realTries++; if (x.firstTry === null) x.firstTry = !!r.pass; if (r.pass) x.real = 'pass'; else if (x.real !== 'pass') x.real = 'fail'; }
  }
  return p;
}

// ---------- list / next / show ----------
function list(out) {
  const p = progress(), ls = lessons();
  if (!ls.length) { out('ERR no lessons (bds/bench/tasks.json)'); return false; }
  let lv = 0;
  for (const l of ls) {
    if (l.level !== lv) { lv = l.level; out(`level ${lv}`); }
    const x = p[l.id], st = x?.real === 'pass' ? 'DONE ' : x?.real === 'fail' ? 'real✘' : x?.sim === 'pass' ? 'sim✔ ' : x ? 'tried' : '     ';
    out(`  ${st} ${l.id.padEnd(10)} ${l.lab === 'bds' ? '' : `[${l.lab}] `}${l.area}${x ? ` (${x.attempts} check${x.attempts > 1 ? 's' : ''})` : ''}`);
  }
  const done = ls.filter((l) => p[l.id]?.real === 'pass').length;
  out(`${done}/${ls.length} lessons passed on the real BDS · next: node lab.mjs scratch next`);
  return true;
}
function next(args, out) {
  const p = progress(), want = Number(val(args, '--level', 0)) || 0;
  const l = lessons().find((x) => p[x.id]?.real !== 'pass' && (!want || x.level === want) && (x.lab === 'bds' || process.env.LAB_SCRATCH_ALL));
  if (!l) { out(want ? `OK every level-${want} lesson passed (scratch: the list)` : 'OK every lesson passed on the real BDS: scratch stats, then a request of your own (skill bds-from-scratch)'); return true; }
  show([l.id], out, true);
  return true;
}
function show(args, out, steps = false) {
  const id = pos(args)[0], l = lessons().find((x) => x.id === id);
  if (!l) { out(`ERR no lesson "${id ?? ''}" (node lab.mjs scratch)`); return false; }
  const u = unitFor(l), x = progress()[l.id], have = fs.existsSync(unitDir(l, u));
  out(`lesson ${l.id} (level ${l.level}: ${l.area}) — build it from nothing${x ? ` · ${x.attempts} check(s) so far, sandbox ${x.sim ?? '-'}, real ${x.real ?? '-'}` : ''}`);
  out(`request: ${l.prompt}`);
  if (!steps) return true;
  const title = l.id.replace(/(^|_)(\w)/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase());
  out(`1. ${have ? `the unit is there: bds/addons/${u}` : `node lab.mjs ${l.lab} new ${u} "${title}" "<the request above>"`}   (from nothing: no recipe, no other unit's code; skill bds-from-scratch has the steps)`);
  out(`2. look it up instead of guessing: api <Class.member> · doc <component> · ts try "<code>" (the sandbox) · ts "<code>" (the live world, after up); write your own tests.txt first, then src/main.ts; sim between edits`);
  out(`3. node lab.mjs scratch check ${l.id}          the lesson's hidden tests in the sandbox (seconds; a hint)`);
  out(`4. node lab.mjs scratch check ${l.id} --real   the hidden tests on the real BDS: the verdict${l.clean ? ' (and check: no E/W lines)' : ''}`);
  out(`then: anything that surprised you → node lab.mjs skill note "<one line: what to do>"; the next lesson: scratch next`);
  return true;
}

// ---------- check: the hidden tests on the unit ----------
function parseSim(text) {
  let j = null; for (const l of text.split('\n').reverse()) { if (l.startsWith('{"unit"')) { try { j = JSON.parse(l); } catch { /* torn */ } break; } }
  if (!j) return null;
  const unsure = (j.notes ?? []).length > 0;
  const secs = (j.rows ?? []).map((r) => ({ title: r.title, status: r.status === 'FAIL' && unsure ? 'UNSURE' : r.status, why: [...(r.bad ?? [])].slice(0, 3) }));
  return { secs, verdict: secs.some((s) => s.status === 'FAIL') ? 'FAIL' : secs.some((s) => s.status === 'UNSURE') ? 'UNSURE' : secs.every((s) => s.status === 'SKIP') ? 'SKIP' : 'PASS' };
}
function parseReal(text) {
  const secs = [];
  for (const l of text.split('\n')) {
    const m = /^SECTION (PASS|FAIL) (.*)$/.exec(l); if (m) { secs.push({ title: m[2], status: m[1], why: [] }); continue; }
    const w = /^SECTION WHY (.*?) :: (.*)$/.exec(l); if (w) secs.find((s) => s.title === w[1])?.why.push(w[2]);
  }
  const m = /^(PASS|FAIL) (\d+)\/(\d+)/m.exec(text);
  return { secs, verdict: m ? m[1] : 'FAIL', passed: m ? Number(m[2]) : 0, total: m ? Number(m[3]) : 0 };
}
// a lesson's hidden tests as this call's own file (several at once in one process: selftest --jobs), and how each run is read
let hiddenN = 0;
function hiddenFile(l) {
  fs.mkdirSync(STATE(), { recursive: true });
  const f = path.join(STATE(), `scratch-hidden-${process.pid}-${++hiddenN}.txt`);
  fs.writeFileSync(f, hiddenText(l));
  return f;
}
const REAL_ENV = { LAB_SECTIONS: '1', LAB_NO_LASTFAIL: '1' };
const simRead = (r) => { const p = parseSim(r.text); return p ? { ...p, text: r.text } : { verdict: 'ERROR', secs: [], text: r.text }; };
// (a clean lesson that passed: its check must print no E/W line either)
function checkRead(p, c) {
  const w = c.text.split('\n').filter((x) => /^[EW] /.test(x));
  if (c.code !== 0 || w.length) { p.verdict = 'FAIL'; p.secs.push({ title: 'check: no E/W lines', status: 'FAIL', why: w.slice(0, 3) }); }
  return p;
}
export function runHidden(l, unit, real, out = () => {}) {
  const f = hiddenFile(l);
  try {
    if (!real) return simRead(runLab(['sim', '-a', unit, '--tests', f, '--json'], {}, 600000));
    const r = runLab([l.lab, 'test', f, '-a', unit], REAL_ENV), p = parseReal(r.text);
    if (l.clean && p.verdict === 'PASS') checkRead(p, runLab([l.lab, 'check', '-a', unit]));
    return { ...p, text: r.text };
  } finally { fs.rmSync(f, { force: true }); }
}
/** runHidden without waiting (selftest --jobs) */
export async function runHiddenAsync(l, unit, real) {
  const f = hiddenFile(l);
  try {
    if (!real) return simRead(await runLabAsync(['sim', '-a', unit, '--tests', f, '--json'], {}, 600000));
    const r = await runLabAsync([l.lab, 'test', f, '-a', unit], REAL_ENV), p = parseReal(r.text);
    if (l.clean && p.verdict === 'PASS') checkRead(p, await runLabAsync([l.lab, 'check', '-a', unit]));
    return { ...p, text: r.text };
  } finally { fs.rmSync(f, { force: true }); }
}
function check(args, out) {
  const id = pos(args)[0], l = lessons().find((x) => x.id === id), real = args.includes('--real');
  if (!l) { out(`ERR no lesson "${id ?? ''}" (node lab.mjs scratch)`); return false; }
  const u = val(args, '-a', unitFor(l)), dir = unitDir(l, u);
  if (!fs.existsSync(dir)) { out(`ERR no unit ${l.lab}/${UNITS[l.lab]}/${u}: node lab.mjs scratch next (it says how to make it), or -a <unit>`); return false; }
  if (!real && l.lab !== 'bds') { out(`ERR ${l.id} is an ${l.lab} lesson: the sandbox runs BDS Script API addons only; scratch check ${l.id} --real`); return false; }
  const t0 = Date.now(), hash = stateHash(dir), r = runHidden(l, u, real, out);
  if (r.verdict === 'ERROR') { out(r.text.split('\n').slice(-6).join('\n')); out(`FAIL scratch check ${l.id}: the ${real ? 'test' : 'sandbox'} did not run (above)`); return false; }
  for (const s of r.secs) {
    out(`${{ PASS: '✔', FAIL: '✘', UNSURE: '?', SKIP: '-' }[s.status] ?? '?'} ${s.title}`);
    if (s.status !== 'PASS') s.why.slice(0, 3).forEach((w) => out(`  ${cut(w, 160)}`));
  }
  if (!r.secs.length) r.text.split('\n').filter((x) => /^(E |ERR|✘|FAIL)/.test(x)).slice(0, 8).forEach((x) => out('  ' + x));
  const pass = r.verdict === 'PASS', row = { at: new Date().toISOString(), id: l.id, unit: u, where: real ? 'real' : 'sim', pass, verdict: r.verdict, failed: r.secs.filter((s) => s.status === 'FAIL').map((s) => s.title), secs: Object.fromEntries(r.secs.map((s) => [s.title, s.status])), sec: Math.round((Date.now() - t0) / 1000), hash, bds: bdsVersion() };
  append(LOG(), row);
  // the sandbox and the real BDS on the same code: where they disagree, the sandbox is wrong or has not measured it
  if (real) {
    const s = readRows(LOG()).filter((x) => x.where === 'sim' && x.id === l.id && x.hash === hash).at(-1);
    if (s) {
      for (const x of r.secs) {
        // only where the sandbox gave a verdict (PASS or FAIL; UNSURE and SKIP say it could not tell) and the real BDS another
        const simSt = s.secs?.[x.title] ?? ((s.failed ?? []).includes(x.title) ? 'FAIL' : s.verdict === 'PASS' ? 'PASS' : null);
        if (!['PASS', 'FAIL'].includes(simSt) || simSt === x.status) continue;
        const t = x.title, gap = { at: row.at, id: l.id, section: t, sim: simSt, real: x.status, bds: row.bds, why: (x.why ?? []).slice(0, 2) };
        append(GAPS(), gap);
        out(`GAP "${t}": the sandbox said ${gap.sim}, the real BDS ${gap.real} (the sandbox is wrong here or has not measured it: scratch gaps)`);
      }
    }
  }
  if (pass && real) out(`PASS lesson ${l.id} on the real BDS (${r.passed}/${r.total}): done. Next: node lab.mjs scratch next`);
  else if (pass) out(`PASS lesson ${l.id} in the sandbox: a hint. The verdict: node lab.mjs scratch check ${l.id} --real`);
  else out(`${r.verdict} lesson ${l.id} ${real ? 'on the real BDS' : 'in the sandbox'}: fix the unit (never the test), check again${real ? '' : '; UNSURE/SKIP: the sandbox cannot tell, --real decides'}`);
  return pass;
}

// ---------- stats and gaps ----------
function stats(args, out) {
  const rows = readRows(LOG()), p = progress(rows), ls = lessons();
  if (!rows.length) { out('no checks yet: node lab.mjs scratch next'); return true; }
  const done = ls.filter((l) => p[l.id]?.real === 'pass'), first = done.filter((l) => p[l.id].firstTry);
  out(`lessons: ${done.length}/${ls.length} passed on the real BDS · first real try: ${first.length}/${done.length || 0} · checks: ${rows.length} (${rows.filter((r) => r.where === 'sim').length} sandbox, ${rows.filter((r) => r.where === 'real').length} real)`);
  const byArea = {};
  for (const l of ls) for (const t of l.teaches.length ? l.teaches : ['-']) { const a = (byArea[t] ??= { n: 0, done: 0, checks: 0 }); a.n++; if (p[l.id]?.real === 'pass') a.done++; a.checks += p[l.id]?.attempts ?? 0; }
  out('by skill: ' + Object.entries(byArea).map(([k, a]) => `${k} ${a.done}/${a.n}${a.checks ? ` (${a.checks} checks)` : ''}`).join(' · '));
  // the sandbox as a predictor: of the real checks that had a sandbox check of the same code, how often they agreed
  const sims = rows.filter((r) => r.where === 'sim'), pairs = rows.filter((r) => r.where === 'real').map((r) => [r, sims.filter((s) => s.id === r.id && s.hash === r.hash).at(-1)]).filter(([, s]) => s && s.verdict !== 'UNSURE' && s.verdict !== 'SKIP');
  if (pairs.length) out(`the sandbox predicted the real verdict in ${pairs.filter(([r, s]) => r.pass === s.pass).length}/${pairs.length} checks of the same code · gaps: ${readRows(GAPS()).length} (scratch gaps)`);
  const stuck = ls.filter((l) => (p[l.id]?.attempts ?? 0) >= 4 && p[l.id]?.real !== 'pass');
  if (stuck.length) out(`stuck (4+ checks, not passed): ${stuck.map((l) => l.id).join(' ')} — read the skills it teaches (${[...new Set(stuck.flatMap((l) => l.teaches))].join(' ')}), then skill note what was missing`);
  return true;
}
export function gapsSummary() { const g = readRows(GAPS()); return { n: g.length, sections: new Set(g.map((x) => `${x.id}/${x.section}`)).size }; }
function gaps(args, out) {
  const g = readRows(GAPS()), pr = readRows(PROBES()).filter((x) => x.agree === false);
  if (!g.length && !pr.length) { out('OK no disagreements between the sandbox and the real BDS recorded (scratch check --real records them)'); return true; }
  const seen = new Map(); for (const x of g) seen.set(`${x.id} :: ${x.section} :: sandbox ${x.sim}, BDS ${x.real}`, x);
  for (const [k, x] of seen) out(`- ${k}${x.why?.length ? ` (${cut(x.why.join(' | '), 140)})` : ''} [BDS ${x.bds}]`);
  for (const x of pr) out(`- probe ${cut(x.code, 60)}: sandbox ${cut(x.sandbox, 50)} / BDS ${cut(x.live, 50)} [BDS ${x.bds}]`);
  if (args.includes('--backlog')) {
    const f = path.join(process.env.LAB_AUTO_ROOT || TOP, 'auto', 'BACKLOG.md'), have = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# Backlog (the AI writes this; a person may add `- [ ] <request>` lines too)\n';
    const items = [...[...seen.values()].map((x) => `lab: sandbox-be disagrees with BDS ${x.bds} on lesson ${x.id} "${x.section}" (sandbox ${x.sim}, BDS ${x.real}): measure it on BDS and make the sandbox match (scratch gaps)`), ...pr.map((x) => `lab: sandbox-be answers ${cut(x.code, 60)} with ${cut(x.sandbox, 40)}, BDS ${x.bds} with ${cut(x.live, 40)}: make the sandbox match (scratch gaps)`)].filter((x) => !have.includes(x));
    if (items.length) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, have.trimEnd() + '\n' + items.map((x) => `- [ ] ${x}`).join('\n') + '\n'); }
    out(`OK ${items.length} new backlog item(s) for sandbox-be (auto/BACKLOG.md)`);
  }
  return true;
}

// ---------- probe: the same code in the sandbox and in the live world ----------
const valueLines = (t) => t.split('\n').filter((l) => /^(= |E )/.test(l)).map((l) => l.replace(/\s+$/, '')).join('\n');
async function probe(args, out) {
  const code = pos(args)[0], rule = val(args, '--rule'), skill = val(args, '--skill');
  if (!code) { out('usage: node lab.mjs scratch probe "<TypeScript expression or statements>" [--rule "<the rule it proves>" --skill <name>]'); return false; }
  if (rule && !skill) { out('ERR --rule needs --skill <the skill it belongs to> (node lab.mjs skill)'); return false; }
  const sb = runLab(['ts', 'try', code], {}, 120000), sv = valueLines(sb.text);
  out(`sandbox: ${sv || cut(sb.text.split('\n')[0] ?? '', 160)}`);
  const { live } = await import(pathToFileURL(path.join(TOP, 'common', 'ts.mjs')).href);
  if (!live()) { out('no live world: node lab.mjs up (TS REPL is in every live server), then scratch probe again; the sandbox alone is not evidence'); return false; }
  const lv = runLab(['ts', code], {}, 120000), lvv = valueLines(lv.text);
  out(`BDS:     ${lvv || cut(lv.text.split('\n')[0] ?? '', 160)}`);
  const agree = !!sv && sv === lvv, row = { at: new Date().toISOString(), code, sandbox: sv, live: lvv, agree, bds: bdsVersion() };
  append(PROBES(), row);
  if (!agree) { out(`DIFFER: the real BDS is the truth; the sandbox's answer is a gap (scratch gaps)${rule ? ' — no rule from a disagreement' : ''}`); return false; }
  out('AGREE: the sandbox and the real BDS give the same answer');
  if (rule) {
    const kf = path.join(TOP, 'skills', 'knowledge.json'), k = JSON.parse(fs.readFileSync(kf, 'utf8'));
    let names = []; try { names = fs.readdirSync(path.join(TOP, 'skills')).filter((n) => fs.existsSync(path.join(TOP, 'skills', n, 'SKILL.md'))); } catch { /* none */ }
    if (!names.includes(skill)) { out(`ERR no skill ${skill} (${names.join(' ')})`); return false; }
    const id = 'probe-' + crypto.createHash('sha1').update(rule).digest('hex').slice(0, 8);
    if (k.rules.some((r) => r.id === id)) { out(`OK rule ${id} is already there`); return true; }
    k.rules.push({ id, skill, rule: rule.replace(/\s+/g, ' ').trim(), status: 'candidate', evidence: { kind: 'measured', ref: `sandbox-be and TS REPL on BDS ${row.bds} agree: ${cut(code, 120)} → ${cut(sv, 80)}` }, added: row.at.slice(0, 10) });
    fs.writeFileSync(kf, JSON.stringify(k, null, 2) + '\n');
    out(`OK candidate ${id} [${skill}] with measured evidence: read it again, then node lab.mjs skill promote ${id} puts it in the skill`);
  }
  return true;
}

// ---------- selftest: the lessons are sound before anyone practises on them ----------
async function selftest(args, out) {
  const real = args.includes('--real'), only = pos(args, ['-a', '--level', '--rule', '--skill', '--jobs']), jobs = Math.max(1, Math.floor(Number(val(args, '--jobs', 1))) || 1);
  const { SOLUTION, SOLUTION_ADD, SOLUTION_JSON } = await import(pathToFileURL(path.join(TOP, 'bds', 'bench', 'solution.mjs')).href);
  const cur = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : null;
  const ref = 'zz_scratch_ref', empty = 'zz_scratch_empty', ad = (u) => path.join(TOP, 'bds', 'addons', u);
  const ls = lessons().filter((l) => l.lab === 'bds' && (!only.length || only.includes(l.id)));
  // the reference must pass where it can be judged (a sandbox SKIP/UNSURE says the sandbox cannot tell); the empty one must not
  // → { good, lines } of one lesson
  const judge = (l, rs, es, rr, er) => {
    const good = rs.verdict !== 'FAIL' && es.verdict !== 'PASS' && (!real || (rr.verdict === 'PASS' && er.verdict !== 'PASS')), lines = [];
    lines.push(`${good ? '✔' : '✘'} ${l.id.padEnd(10)} ${rs.verdict.padEnd(6)}${real ? ' / ' + rr.verdict.padEnd(4) : ''}          ${es.verdict.padEnd(6)}${real ? ' / ' + er.verdict : ''}`);
    if (rs.verdict === 'FAIL') rs.secs.filter((s) => s.status === 'FAIL').forEach((s) => lines.push(`    sandbox ✘ ${s.title}: ${cut(s.why.join(' | '), 200)}`));
    if (real && rr.verdict !== 'PASS') { rr.secs.filter((s) => s.status === 'FAIL').forEach((s) => lines.push(`    BDS ✘ ${s.title}: ${cut(s.why.join(' | '), 200)}`)); if (!rr.secs.length) lines.push('    ' + cut(rr.text.split('\n').filter((x) => /^(E |ERR|FAIL|✘)/.test(x)).slice(0, 4).join(' | '), 300)); }
    return { good, lines };
  };
  // (--jobs: each slot its own copies of the two units, made once the two are ready)
  const slots = [];
  let ok = true;
  try {
    for (const u of [ref, empty]) fs.rmSync(ad(u), { recursive: true, force: true });
    for (const [u, t] of [[ref, 'Scratch Reference'], [empty, 'Scratch Empty']]) { const r = runLab(['bds', 'new', u, t, '--js']); if (r.code !== 0) { out(r.text); return false; } }
    for (const a of SOLUTION_ADD) { const r = runLab(['bds', ...a, '-a', ref]); if (r.code !== 0) { out(`E ${a.join(' ')}: ${cut(r.text, 300)}`); ok = false; } }
    for (const [f, body] of Object.entries(SOLUTION)) { if (body === null) continue; fs.mkdirSync(path.dirname(path.join(ad(ref), f)), { recursive: true }); fs.writeFileSync(path.join(ad(ref), f), body); }
    for (const [f, fn] of Object.entries(SOLUTION_JSON)) { const p = path.join(ad(ref), f), j = JSON.parse(fs.readFileSync(p, 'utf8')); fn(j); fs.writeFileSync(p, JSON.stringify(j, null, 2)); }
    out(`lesson      reference (sandbox${real ? ' / BDS' : ''})   empty template (sandbox${real ? ' / BDS' : ''})`);
    const show = (j) => { if (!j.good) ok = false; for (const x of j.lines) out(x); };
    if (jobs === 1) {
      for (const l of ls) {
        const rs = runHidden(l, ref, false), es = runHidden(l, empty, false);
        const rr = real ? runHidden(l, ref, true) : null, er = real ? runHidden(l, empty, true) : null;
        show(judge(l, rs, es, rr, er));
      }
    } else {
      // n lessons at once, each slot on its own copies (a lab run builds into its unit: two runs of one unit would collide); the
      // lines still in the lessons' order, each as soon as the ones before it are out
      for (let k = 0; k < Math.min(jobs, ls.length); k++) {
        const s = { ref: `${ref}_${k}`, empty: `${empty}_${k}` };
        slots.push(s);
        for (const [from, to] of [[ref, s.ref], [empty, s.empty]]) { fs.rmSync(ad(to), { recursive: true, force: true }); fs.cpSync(ad(from), ad(to), { recursive: true }); }
      }
      const done = new Array(ls.length);
      let next = 0, shown = 0;
      await Promise.all(slots.map(async (s) => {
        while (next < ls.length) {
          const i = next++, l = ls[i];
          const rs = await runHiddenAsync(l, s.ref, false), es = await runHiddenAsync(l, s.empty, false);
          const rr = real ? await runHiddenAsync(l, s.ref, true) : null, er = real ? await runHiddenAsync(l, s.empty, true) : null;
          done[i] = judge(l, rs, es, rr, er);
          while (shown < ls.length && done[shown]) show(done[shown++]);
        }
      }));
    }
  } finally {
    if (!process.env.LAB_SCRATCH_KEEP) for (const u of [ref, empty, ...slots.flatMap((s) => [s.ref, s.empty])]) fs.rmSync(ad(u), { recursive: true, force: true });
    if (cur0 === null) fs.rmSync(cur, { force: true }); else fs.writeFileSync(cur, cur0);
  }
  out(`${ok ? 'PASS' : 'FAIL'} scratch selftest: ${ls.length} lesson(s), the reference ${real ? 'in the sandbox and on the real BDS' : 'in the sandbox'}, the empty template must fail`);
  return ok;
}

/** the line skill growth prints for the from-scratch experience */
export function growthLine() {
  const rows = readRows(LOG()), p = progress(rows), ls = lessons(), done = ls.filter((l) => p[l.id]?.real === 'pass').length, g = gapsSummary();
  return { line: `  L0 from scratch: ${done}/${ls.length} lessons passed on the real BDS · ${rows.length} checks · sandbox gaps ${g.sections}`, next: done < ls.length ? 'scratch next: practise building from nothing (the sandbox and TS REPL to learn, the real BDS decides)' : null };
}

export async function scratchCmd(args, out = console.log) {
  const [sub, ...rest] = args;
  if (!sub || sub === 'list') return list(out);
  if (sub === 'next') return next(rest, out);
  if (sub === 'show') return show(rest, out);
  if (sub === 'check') return check(rest, out);
  if (sub === 'stats') return stats(rest, out);
  if (sub === 'gaps') return gaps(rest, out);
  if (sub === 'probe') return probe(rest, out);
  if (sub === 'selftest') return selftest(rest, out);
  out('usage: node lab.mjs scratch [list] | next [--level n] | show <id> | check <id> [--real] [-a <unit>] | stats | gaps [--backlog] | probe "<code>" [--rule "<rule>" --skill <name>] | selftest [--real] [--jobs n] [<id> ...]');
  return false;
}
