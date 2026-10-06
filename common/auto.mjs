// node lab.mjs auto: the autopilot. The AI runs bds-lab by itself — it decides what to do next, does it, checks it the lab's
// way, merges it, releases it, writes down what it learned and plans its own next work. A person only sets the floor
// (auto/policy.json: the token caps, merge mode; auto/STOP: the kill switch; see common/auto-guard.mjs) and reads the ledger.
//
// One tick:  sense (no tokens: every source of work below becomes a candidate) → choose (the AI picks one from the ranked
//            list, with its reason; without an AI the best score) → act (the lab's own commands, or the engine agent for a
//            change to the lab itself) → check (the unit's `go`; for the engine the gate tests and the floor) → review (a
//            second AI reads the diff: APPROVE or the change is put back) → merge (commit + push to the current branch; or a
//            pull request; or local only) → learn (a row in auto/ledger.jsonl; a failure becomes a one-line lesson in
//            auto/LESSONS.md, which every later make reads) → notify.
// Sources of work and their base value (× the success rate the ledger has seen for that kind, × a cost factor, with backoff
// for a target that failed recently):
//   repair 100   a unit whose last test failed (<lab>/.lab/last-fail/)        → maintain -a <unit> --to current
//   upkeep  85   upkeep not run for upkeepHours                                → upkeep (health, cleaning, newest Minecraft, fixes)
//   issue   75   an open GitHub issue labeled issueLabel                       → make "<issue>" --playtest, comment, close
//   release 60   a unit with TASK.md changes CHANGELOG.md does not have        → release -a <unit>
//   backlog 50   an open `- [ ] <request>` in auto/BACKLOG.md                  → make "<request>" --playtest
//   lab     45   an open `- [ ] lab: <change>` in auto/BACKLOG.md              → the engine agent changes the lab itself (gated)
//   playtest 35  a unit the autopilot never playtested                         → make -a <unit> --playtest
//   harden  30   a unit not hardened in 14 days                                → harden -a <unit> (no tokens when nothing is missed)
//   reflect 25   every reflectEvery ticks, or the backlog is empty             → the AI rewrites its backlog and condenses its lessons
//   share   40   the lab itself changed (lab tasks) since the last shared release → share --release (the lab, no units)
//   invent  10   fewer than 3 open backlog items                               → the AI proposes new addons into the backlog
//
//   node lab.mjs auto                      the state: the floor, today's tokens, what each kind has earned, the queue
//   node lab.mjs auto run [--ticks n | --forever] [--via v] [--model m] [--dry]   the lab calls the AI (make.mjs's --via)
//   node lab.mjs auto next                 for an agent that is itself the AI (Claude Code, Codex...): the one task, how
//   node lab.mjs auto done <id> ok|fail ["<lesson>"]   …and its result (an engine task is gated here; fail → put back)
//   node lab.mjs auto gate [--all] [--jobs n] [--on <owner/repo>|auto]  the gate tests on the lab as it is, side by side (--all:
//                                          every offline test; --on: on a lender's host, node lab.mjs host; policy gateOn)
//   node lab.mjs auto plan                 is there work, and for which labs (a schedule decides on it before its set-up)
//   node lab.mjs auto log [n]   auto stop ["why"]   auto resume   auto policy [key=value ...]   auto schedule hourly|daily|off
// LAB_AUTO_ROOT: another bds-lab folder (tests). LAB_AUTO_ISSUES=<json>: issues instead of gh (tests). LAB_CI_DRY=1: gh/git
// pushes are printed, not run.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { policy, stopped, floorHash, canSpend, isProtected, SECRET, PROTECTED, DEFAULT_POLICY } from './auto-guard.mjs';
import { hostCmd, hostsSummary } from './hosts.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOP = process.env.LAB_AUTO_ROOT || REPO;
const AUTO = path.join(TOP, 'auto'), LEDGER = path.join(AUTO, 'ledger.jsonl'), BACKLOG = path.join(AUTO, 'BACKLOG.md'), LESSONS = path.join(AUTO, 'LESSONS.md');
const WORK = path.join(AUTO, '.work'), LEASE = path.join(AUTO, '.lease.json');
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
const VALUE = { repair: 100, upkeep: 85, issue: 75, release: 60, backlog: 50, lab: 45, share: 40, playtest: 35, harden: 30, reflect: 25, forge: 20, invent: 10 };
const DRY = () => !!process.env.LAB_CI_DRY;
const NEEDS_AI = new Set(['invent', 'reflect', 'lab', 'backlog', 'issue', 'playtest', 'forge']);
// with no AI the lab also leaves harden alone: it asks an AI for every place no test runs, so without one it fails each time
// (seen in a ledger: the same harden failed four runs in a row with "make needs an AI")
const NO_AI = new Set([...NEEDS_AI, 'harden']);
// following Minecraft is never given up (a newer version may fix what failed), but a failing run waits longer each time
const PERIODIC = new Set(['upkeep']);
const LOCK = path.join(AUTO, '.lock');
const SELF_CLEANING = new Set(['upkeep', 'repair', 'harden', 'release']);
// what each kind may change (auto/ — its memory — always): a unit task its units; maintain also the lab's version data; the
// engine agent the lab itself (gated); share the version and its notes
const UNIT_PATH = /^(bds\/addons|end\/plugins|ll\/mods)\//;
export function inScope(kind, r) {
  if (/^auto\//.test(r)) return true;
  if (kind === 'lab') return true;
  if (kind === 'share') return /^(VERSION|CHANGES\.md)$/.test(r);
  if (kind === 'forge') return /^skills\/[\w-]+\/(SKILL\.md|triggers\.txt)$|^skills\/grades\.json$/.test(r);   // one skill's text and the grade log; never knowledge.json, rubric.json or routes.json
  if (kind === 'upkeep' || kind === 'repair') return UNIT_PATH.test(r) || /^(common\/data\/|bds\/vendor\/bds-version\.txt$|(bds|end|ll)\/flavor\.mjs$|common\/kit\/versions\.json$)/.test(r);
  if (['invent', 'reflect'].includes(kind)) return false;
  return UNIT_PATH.test(r);
}
const HOUR = 3600_000, DAY = 24 * HOUR;
const today = () => new Date().toISOString().slice(0, 10);
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 12);
const rel = (f) => path.relative(TOP, f).split(path.sep).join('/');

// ---------- memory: the ledger (every task, its result and cost), the backlog, the lessons ----------
export function ledger() {
  try { return fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
const record = (row) => { fs.mkdirSync(AUTO, { recursive: true }); fs.appendFileSync(LEDGER, JSON.stringify(row) + '\n'); };
export const spentToday = (rows = ledger()) => rows.filter((r) => (r.at ?? '').startsWith(today())).reduce((s, r) => s + (r.tokens ?? 0), 0);
// per kind: how often it worked, what it cost (the bandit the choice learns from)
export function stats(rows = ledger()) {
  const s = {};
  for (const r of rows) { const x = (s[r.kind] ??= { n: 0, ok: 0, tok: 0 }); x.n++; if (r.ok) x.ok++; x.tok += r.tokens ?? 0; }
  return s;
}
const backlogLines = () => { try { return fs.readFileSync(BACKLOG, 'utf8').split('\n'); } catch { return []; } };
export const openItems = () => backlogLines().map((l) => /^- \[ \] (.+)$/.exec(l)?.[1]?.trim()).filter(Boolean);
const itemId = (t) => 'b' + sha(t.replace(/\s+\(tried \d+×\)$/, '')).slice(0, 8);
function markItem(text, ok) {
  const lines = backlogLines(), i = lines.findIndex((l) => l === `- [ ] ${text}`);
  if (i < 0) return;
  if (ok) lines[i] = `- [x] ${text.replace(/\s+\(tried \d+×\)$/, '')} (${today()})`;
  else { const n = Number(/\(tried (\d+)×\)$/.exec(text)?.[1] ?? 0) + 1; lines[i] = n >= 4 ? `- [~] ${text.replace(/\s+\(tried \d+×\)$/, '')} (gave up ${today()}: failed ${n}×)` : `- [ ] ${text.replace(/\s+\(tried \d+×\)$/, '')} (tried ${n}×)`; }
  fs.writeFileSync(BACKLOG, lines.join('\n'));
}
function addItems(items) {
  const have = new Set(backlogLines().map((l) => l.replace(/^- \[.\] /, '').replace(/\s+\((tried|gave up|\d{4}-).*$/, '').trim()));
  const fresh = [...new Set(items.map((x) => String(x).replace(/^- \[.\]\s*/, '').replace(/\s+/g, ' ').trim()).filter((x) => x && x.length < 400 && !have.has(x)))];
  if (!fresh.length) return 0;
  const cur = backlogLines().join('\n').trimEnd() || '# Backlog (the AI writes this; a person may add `- [ ] <request>` lines too)\n';
  fs.mkdirSync(AUTO, { recursive: true }); fs.writeFileSync(BACKLOG, cur + '\n' + fresh.map((x) => `- [ ] ${x}`).join('\n') + '\n');
  return fresh.length;
}
const lessons = () => { try { return fs.readFileSync(LESSONS, 'utf8').split('\n').filter((l) => /^- /.test(l)); } catch { return []; } };
// what a make reads: the newest 12 lessons, at most 1,500 characters (every turn resends it: kept short on purpose)
function lessonsCtx(id) {
  const ls = lessons().map((l) => l.replace(/^- \d{4}-\d\d-\d\d /, '- ')).slice(-12);
  if (!ls.length) return '';
  let t = 'Lessons from earlier autopilot runs (avoid repeating these failures):\n'; for (const l of ls.reverse()) { if (t.length + l.length > 1500) break; t += l + '\n'; }
  const f = path.join(WORK, id, '.lessons.md'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f;
}
const norm = (s) => s.toLowerCase().replace(/^- (\d{4}-\d\d-\d\d )?(\[\w+\] )?/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function addLesson(kind, text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || lessons().some((l) => norm(l) === norm(t))) return;   // the same lesson twice teaches nothing
  const all = [...lessons(), `- ${today()} [${kind}] ${cut(t, 240)}`].slice(-40);   // the newest 40; reflect condenses them
  fs.mkdirSync(AUTO, { recursive: true }); fs.writeFileSync(LESSONS, '# Lessons (the autopilot writes these from its own failures; every make reads them)\n' + all.join('\n') + '\n');
}

// ---------- sense: every source of work, no tokens ----------
const unitsOf = (k) => { try { return fs.readdirSync(path.join(TOP, k, UNITS[k])).filter((n) => !n.startsWith('.') && fs.statSync(path.join(TOP, k, UNITS[k], n)).isDirectory()).sort(); } catch { return []; } };
export const allUnits = () => Object.keys(UNITS).flatMap((k) => unitsOf(k).map((u) => ({ k, u, dir: path.join(TOP, k, UNITS[k], u) })));
function newNotes(task, changelog) {   // (= release.mjs newNotes: the TASK.md lines no release has carried yet)
  const pick = (h) => ((task.split(new RegExp(`^## ${h}\\s*$`, 'm'))[1] ?? '').split(/^## /m)[0]).split('\n').filter((l) => /^- /.test(l)).map((l) => l.replace(/^- (\d{4}-\d\d-\d\d )?/, '').trim());
  return [...pick('Changes'), ...pick('Maintenance')].filter((l) => l && !changelog.includes(l));
}
const readOr = (f, d = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
function issues(pol) {
  if (process.env.LAB_AUTO_ISSUES) { try { return JSON.parse(fs.readFileSync(process.env.LAB_AUTO_ISSUES, 'utf8')); } catch { return []; } }
  if (!isGit() || spawnSync('gh', ['--version'], { encoding: 'utf8' }).status !== 0) return [];
  const r = spawnSync('gh', ['issue', 'list', '--state', 'open', '--label', pol.issueLabel, '--json', 'number,title,body', '--limit', '20'], { cwd: TOP, encoding: 'utf8', timeout: 30000 });
  try { const j = JSON.parse(r.stdout || '[]'); return Array.isArray(j) ? j : []; } catch { return []; }
}
export function sense(pol = policy(TOP), rows = ledger(), now = Date.now()) {
  const T = [], on = (k) => pol.kinds[k] !== false;
  const last = (pred) => rows.filter(pred).at(-1);
  const add = (t) => { if (on(t.kind)) T.push(t); };
  for (const { k, u, dir } of allUnits()) {
    const lf = path.join(TOP, k, '.lab', 'last-fail', `${u}.json`);
    if (fs.existsSync(lf)) add({ id: `repair:${k}/${u}`, kind: 'repair', title: `${k}/${u}: its last test failed`, cmd: ['maintain', '--lab', k, '-a', u, '--to', 'current'], howto: `node lab.mjs ${k} go -a ${u} (node lab.mjs ${k} why -a ${u} before an edit), fix it until DONE without weakening a test` });
    const notes = newNotes(readOr(path.join(dir, 'TASK.md')), readOr(path.join(dir, 'CHANGELOG.md')));
    if (notes.length && !fs.existsSync(lf)) add({ id: `release:${k}/${u}`, kind: 'release', title: `${k}/${u}: ${notes.length} change(s) not released (${cut(notes[0], 50)})`, cmd: [k, 'release', '-a', u], howto: `node lab.mjs ${k} release -a ${u}` });
    if (!last((r) => r.id === `playtest:${k}/${u}` && r.ok)) add({ id: `playtest:${k}/${u}`, kind: 'playtest', title: `${k}/${u}: never playtested by another AI`, cmd: [k, 'make', '-a', u, '--playtest'], howto: `node lab.mjs ${k} chaos -a ${u} --append, then fix what it finds until node lab.mjs ${k} go -a ${u} says DONE` });
    const h = last((r) => r.id === `harden:${k}/${u}` && r.ok);
    if (!h || now - Date.parse(h.at) > 14 * DAY) add({ id: `harden:${k}/${u}`, kind: 'harden', title: `${k}/${u}: tests not hardened ${h ? 'for 14 days' : 'yet'}`, cmd: [k, 'harden', '-a', u], howto: `node lab.mjs ${k} gaps -a ${u} and node lab.mjs ${k} mutate -a ${u}, then add ## sections to tests.txt that catch what they print` });
  }
  const up = last((r) => r.kind === 'upkeep');
  if (!up || now - Date.parse(up.at) > pol.upkeepHours * HOUR) add({ id: 'upkeep', kind: 'upkeep', title: `maintain on the newest Minecraft (${up ? 'last ' + up.at.slice(0, 10) : 'never'})`, cmd: ['upkeep'], howto: 'node lab.mjs upkeep' });
  for (const i of on('issue') ? issues(pol) : []) {
    const text = `${String(i.title ?? '').replace(/^make\s*[:：]\s*/i, '')}\n\n${i.body ?? ''}`.trim();
    if (!last((r) => r.id === `issue:#${i.number}` && r.ok)) add({ id: `issue:#${i.number}`, kind: 'issue', issue: i.number, title: `issue #${i.number}: ${cut(i.title, 60)}`, cmd: ['make', text, '--playtest'], howto: `build it: node lab.mjs make is not for you; follow AGENTS.md for this request: ${cut(text, 300)}` });
  }
  const open = openItems();
  for (const it of open) {
    const lab = /^lab\s*:/i.test(it), text = it.replace(/^lab\s*:\s*/i, '').replace(/\s+\(tried \d+×\)$/, '');
    add(lab ? { id: `lab:${itemId(it)}`, kind: 'lab', item: it, title: `the lab itself: ${cut(text, 70)}`, howto: `change bds-lab's engine (not a unit) for: ${text}. Never touch ${PROTECTED.join(' ')}. Then node lab.mjs auto gate must PASS` }
      : { id: `backlog:${itemId(it)}`, kind: 'backlog', item: it, title: cut(text, 80), cmd: ['make', text, '--playtest'], howto: `build it following AGENTS.md: ${text}` });
  }
  // the skills as prompts: the weakest one below 85%, or routing that misses held-out requests → refine it (another AI edits,
  // the lab's gate keeps or reverts: skill refine --via)
  {
    let g = null; try { g = JSON.parse(fs.readFileSync(path.join(TOP, 'skills', 'grades.json'), 'utf8')); } catch { /* never graded */ }
    const lg = g?.log?.at(-1);
    if (lg) {
      const [weak, sc] = Object.entries(lg.text ?? lg.scores ?? {}).sort((a, b) => a[1] - b[1])[0] ?? [];   // text: what an edit can still raise
      const f = last((r) => r.kind === 'forge'), fresh = !f || now - Date.parse(f.at) > DAY;
      if (weak && fresh && (sc < 85 || (lg.route?.held ?? 100) < 80)) add({ id: `forge:${weak}`, kind: 'forge', title: `skill ${weak} grades ${sc}%${(lg.route?.held ?? 100) < 80 ? `, routing held-out ${lg.route.held}%` : ''}: refine it`, cmd: ['skill', 'refine', weak, '--via', 'auto', '--rounds', '2'], howto: `node lab.mjs skill refine ${weak}, edit skills/${weak}/SKILL.md and triggers.txt for what the brief names, node lab.mjs skill refine ${weak} --done (kept only if nothing gets worse); read skills/skill-forge/SKILL.md first` });
    }
  }
  // the lab itself changed since the last shared release → a new one (the lab without anyone's units: `share`)
  const sinceShare = rows.slice(rows.map((r) => r.kind).lastIndexOf('share') + 1).filter((r) => r.kind === 'lab' && r.ok);
  if (sinceShare.length) add({ id: 'share', kind: 'share', title: `share bds-lab itself: ${sinceShare.length} engine change(s) since the last release`, cmd: ['share', '--release'], howto: 'node lab.mjs share --release' });
  const ticks = rows.length - rows.map((r) => r.kind).lastIndexOf('reflect') - 1;
  if (rows.length && (ticks >= pol.reflectEvery || !open.length)) add({ id: 'reflect', kind: 'reflect', title: `reread the ledger and lessons, rewrite the backlog (${ticks} tasks since)`, howto: 'node lab.mjs auto log 40; then rewrite auto/BACKLOG.md (open `- [ ]` lines, `lab:` for changes to the lab itself) and condense auto/LESSONS.md to its 20 most useful lines' });
  if (open.length < 3) add({ id: 'invent', kind: 'invent', title: `propose new addons (${open.length} open in the backlog)`, howto: 'add 3 new `- [ ] <a concrete addon request>` lines to auto/BACKLOG.md that no unit does yet' });
  return rank(T, pol, rows, now);
}
// score = value × success rate of the kind (Laplace) × a cost factor; a target that failed f times in a row waits 2^f hours, 4× gives up
// (upkeep: never given up, its period doubled per failure)
export function rank(T, pol, rows, now = Date.now()) {
  const st = stats(rows);
  const out = [];
  for (const t of T) {
    const mine = rows.filter((r) => r.id === t.id);
    let f = 0; for (let i = mine.length - 1; i >= 0 && !mine[i].ok; i--) f++;
    if (f >= 4 && !PERIODIC.has(t.kind) && t.kind !== 'reflect' && t.kind !== 'invent') continue;   // abandoned (reflect may put it back as a new item)
    // cooling down: 2^f hours; upkeep its period doubled per failure (1, 2, 4 days … at most a week), each of its runs takes minutes
    const wait = PERIODIC.has(t.kind) ? Math.min(7 * 24, Math.max(2 ** f, (pol.upkeepHours ?? 24) * 2 ** (f - 1))) : 2 ** f;
    if (f && now - Date.parse(mine.at(-1).at) < wait * HOUR) continue;
    const s = st[t.kind] ?? { n: 0, ok: 0, tok: 0 }, rate = (s.ok + 1) / (s.n + 2), avg = s.n ? s.tok / s.n : 0;
    t.score = Math.round(VALUE[t.kind] * rate * (1 / (1 + avg / Math.max(1, pol.taskTokens))) * 10) / 10;
    t.fails = f;
    out.push(t);
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- the AI: one question (make.mjs ask1), the engine agent ----------
let VIA = null, MODEL = null;
async function ask(prompt, max = 2000) {
  const { ask1 } = await import('./make.mjs');
  const r = await ask1(VIA, prompt, { model: MODEL ?? undefined, max });
  return { text: r.text ?? '', tokens: r.tokens ?? 0 };
}
const jsonIn = (t) => { const m = /```(?:json)?\s*([\s\S]*?)```/.exec(t)?.[1] ?? /[[{][\s\S]*[\]}]/.exec(t)?.[0]; try { return JSON.parse(m); } catch { return null; } };
async function choose(cands, rows, out) {
  if (!VIA || cands.length < 2) return { task: cands[0], why: 'the best score', tokens: 0 };
  // a clear lead needs no question (a broken unit, the update, or twice the next score): the AI is asked only when it is close
  if (cands[0].score >= 2 * cands[1].score || (['repair', 'upkeep'].includes(cands[0].kind) && cands[0].score >= 1.5 * cands[1].score)) return { task: cands[0], why: `a clear lead (${cands[0].score} vs ${cands[1].score}): no AI asked`, tokens: 0 };
  const st = stats(rows), top = cands.slice(0, 8);
  const p = `You run bds-lab by yourself (an autopilot that builds, tests on real Minecraft Bedrock servers, fixes, merges and releases with no person). Pick the ONE task to do now: the most value per token, and what unblocks the most.\nCandidates (id | kind | score | what):\n${top.map((t) => `${t.id} | ${t.kind} | ${t.score} | ${t.title}${t.fails ? ` (failed ${t.fails}× lately)` : ''}`).join('\n')}\nWhat each kind earned so far (ok/n, avg tokens): ${Object.entries(st).map(([k, s]) => `${k} ${s.ok}/${s.n} ${Math.round(s.tok / s.n)}`).join(', ') || 'nothing yet'}\nLast tasks: ${rows.slice(-6).map((r) => `${r.id} ${r.ok ? 'ok' : 'FAIL'}`).join(', ') || 'none'}\nLessons: ${lessons().slice(-8).join(' ') || 'none'}\nReply JSON only: {"pick":"<id>","why":"<at most 12 words>"}`;
  try {
    const r = await ask(p, 300), j = jsonIn(r.text), t = top.find((x) => x.id === j?.pick);
    if (t) return { task: t, why: cut(j.why ?? '', 120), tokens: r.tokens };
    out(`W auto: the AI picked "${cut(j?.pick ?? r.text, 40)}", not a candidate: the best score instead`);
    return { task: cands[0], why: 'the best score (the pick was not a candidate)', tokens: r.tokens };
  } catch (e) { out(`W auto: choose: ${e.message}`); return { task: cands[0], why: 'the best score (no answer)', tokens: 0 }; }
}

const ENGINE_TOOLS = [
  { name: 'read', description: 'Read a file of bds-lab (path relative to its top folder).', params: { path: 'string' } },
  { name: 'list', description: 'List a folder of bds-lab (relative path; "." is the top).', params: { path: 'string' } },
  { name: 'grep', description: 'Search the lab\'s engine files (common/, tests/, lab.mjs, */flavor.mjs, *.md) for a regex; file:line: text.', params: { regex: 'string' } },
  { name: 'write', description: 'Write a whole file (relative path).', params: { path: 'string', content: 'string' } },
  { name: 'edit', description: 'Replace one exact, unique string in a file (relative path).', params: { path: 'string', old: 'string', new: 'string' } },
  { name: 'run', description: 'Run `node tests/<name>.mjs` or `node lab.mjs <args>` from the top folder (no shell). Returns its output.', params: { command: 'string' } },
];
const schema = (t) => ({ type: 'object', properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, { type: v }])), required: Object.keys(t.params) });
const ENGINE_SKIP = /(^|\/)(\.lab|\.lab-node|\.lab-tools|node_modules|runs|dist|\.git|vendor|\.work)(\/|$)/;
function engineTool(call) {
  const at = (p) => { const f = path.resolve(TOP, String(p ?? '.')); if (f !== TOP && !f.startsWith(TOP + path.sep)) throw new Error('outside the lab'); const r = rel(f); if (SECRET.test(r)) throw new Error('a secret: never'); return { f, r }; };
  const w = (p) => { const x = at(p); if (isProtected(x.r)) throw new Error(`${x.r} is the person's (common/auto-guard.mjs): never written by the AI`); return x; };
  const clip = (o) => (o.length > 8000 ? o.slice(0, 4000) + `\n… (${o.length - 8000} chars cut) …\n` + o.slice(-4000) : o);
  try {
    const i = call.input ?? {};
    if (call.name === 'read') { const t = fs.readFileSync(at(i.path).f, 'utf8'); return t.length > 30000 ? t.slice(0, 30000) + '\n… (cut: read a smaller part with grep)' : t; }
    if (call.name === 'list') return fs.readdirSync(at(i.path).f, { withFileTypes: true }).map((e) => e.name + (e.isDirectory() ? '/' : '')).join('\n');
    if (call.name === 'grep') {
      const re = new RegExp(i.regex), hits = [];
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = rel(p); if (ENGINE_SKIP.test(r) || /^(bds|end|ll)\/(addons|plugins|mods)\//.test(r)) continue; if (e.isDirectory()) walk(p); else if (/\.(mjs|cjs|js|ts|md|json|py|yml)$/.test(e.name) && !SECRET.test(r)) fs.readFileSync(p, 'utf8').split('\n').forEach((l, n) => { if (hits.length < 80 && re.test(l)) hits.push(`${r}:${n + 1}: ${cut(l.trim(), 200)}`); }); } };
      walk(TOP); return hits.join('\n') || '(no match)';
    }
    if (call.name === 'write') { const { f } = w(i.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(i.content)); return 'ok'; }
    if (call.name === 'edit') { const { f } = w(i.path), s = fs.readFileSync(f, 'utf8'), n = s.split(i.old).length - 1; if (n !== 1) return `old string found ${n} times: must be exactly once`; fs.writeFileSync(f, s.replace(i.old, () => i.new)); return 'ok'; }
    if (call.name === 'run') {
      const argv = (String(i.command).match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^["']|["']$/g, ''));
      if (argv[0] !== 'node') return 'only `node tests/<name>.mjs` or `node lab.mjs <args>`';
      const ok = /^tests\/[\w-]+\.mjs$/.test(argv[1] ?? '') || (argv[1] === 'lab.mjs' && !['auto', 'make', 'harden', 'login', 'github', 'publish', 'ship', 'release', 'handoff', 'update', 'bg', 'maintain'].includes(argv[2]));
      if (!ok) return `not from here: ${argv.slice(1, 3).join(' ')} (tests/<name>.mjs, or lab.mjs without auto/make/release/...)`;
      const r = spawnSync(process.execPath, argv.slice(1), { cwd: TOP, encoding: 'utf8', timeout: 600000, maxBuffer: 64e6, env: { ...process.env, LAB_NOTRACE: '1', FORCE_COLOR: '0' } });
      return clip(((r.stdout ?? '') + (r.stderr ?? '')).trim() + `\n(exit ${r.status})`);
    }
    return 'unknown tool ' + call.name;
  } catch (e) { return 'ERR ' + e.message; }
}
async function engineAgent(task, pol, budget, out) {
  const goal = task.item.replace(/^lab\s*:\s*/i, '').replace(/\s+\(tried \d+×\)$/, '');
  const sys = `You improve bds-lab itself: its engine (lab.mjs, common/, tests/, the AGENTS.md and help.md an AI reads, */flavor.mjs), not a unit. It lets an AI build Minecraft Bedrock addons alone and prove them on real servers with real clients; you work with no person, and your change is merged to main once the gate passes and a reviewer approves.\nRules: read before you change; keep the change small and on the goal; never weaken or delete a test; a new behaviour gets an offline test in tests/; every doc command must exist (tests/docs-offline.mjs). Never touch: ${PROTECTED.join(' ')} (refused anyway). The gate (must pass after your change; run them with \`run\`): ${pol.gate.join(' ')}.\nLessons from earlier runs:\n${lessons().slice(-12).join('\n') || '(none)'}\nFinish with one line: what you changed.`;
  const prompt = `Goal: ${goal}`;
  if (VIA !== 'anthropic' && VIA !== 'openai') {   // an agent CLI on this machine does it with its own tools (the gate and the floor still decide)
    const tpl = { claude: ['claude', '-p', '{p}', '--strict-mcp-config', '--tools', 'Bash,Read,Write,Edit,Glob,Grep', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(node tests/:*)', 'Bash(node lab.mjs:*)', 'Read', 'Write', 'Edit', 'Glob', 'Grep'], codex: ['codex', 'exec', '--full-auto', '--skip-git-repo-check', '{p}'], gemini: ['gemini', '--yolo', '-p', '{p}'] }[VIA];
    if (!tpl) return { ok: false, tokens: 0, note: `--via ${VIA}: the engine agent needs anthropic, openai, claude, codex or gemini` };
    const r = spawnSync(tpl[0], tpl.slice(1).map((x) => x.replace('{p}', () => sys + '\n\n' + prompt)), { cwd: TOP, encoding: 'utf8', timeout: 3 * HOUR, maxBuffer: 64e6, env: { ...process.env, LAB_AUTO_AGENT: '1' } });   // (LAB_AUTO_AGENT: its `node lab.mjs auto resume|policy|run` are refused, as for every other agent the autopilot starts)
    return { ok: r.status === 0, tokens: 0, note: cut((r.stdout ?? '').trim().split('\n').at(-1) ?? '', 200) };
  }
  const anth = VIA === 'anthropic', mdl = MODEL ?? (anth ? 'claude-sonnet-5-5' : process.env.OPENAI_MODEL);
  if (!mdl) return { ok: false, tokens: 0, note: '--via openai needs --model (or OPENAI_MODEL)' };
  const msgs = anth ? [{ role: 'user', content: prompt }] : [{ role: 'system', content: sys }, { role: 'user', content: prompt }];
  let tokens = 0, answer = '';
  const post = async (url, headers, body) => {
    for (let k = 0; ; k++) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      if (r.ok) return r.json();
      if ((r.status === 429 || r.status >= 500) && k < 4) { await new Promise((z) => setTimeout(z, 3000 * 2 ** k)); continue; }
      throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  };
  for (let t = 0; t < 40; t++) {
    if (budget && tokens >= budget) { out(`auto: engine agent stopped at its budget (${tokens.toLocaleString('en')} tokens)`); break; }
    let calls;
    if (anth) {
      const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
      const r = await post(`${base}/v1/messages`, { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' }, { model: mdl, max_tokens: 16000, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], tools: ENGINE_TOOLS.map((x) => ({ name: x.name, description: x.description, input_schema: schema(x) })), messages: msgs });
      const u = r.usage ?? {}; tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      msgs.push({ role: 'assistant', content: r.content });
      calls = (r.content ?? []).filter((c) => c.type === 'tool_use');
      const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'); if (text.trim()) answer = text;
      if (!calls.length) break;
      msgs.push({ role: 'user', content: calls.map((c) => ({ type: 'tool_result', tool_use_id: c.id, content: engineTool(c) })) });
    } else {
      const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const r = await post(`${base}/chat/completions`, { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? 'none'}` }, { model: mdl, messages: msgs, tools: ENGINE_TOOLS.map((x) => ({ type: 'function', function: { name: x.name, description: x.description, parameters: schema(x) } })) });
      const u = r.usage ?? {}; tokens += (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
      const m = r.choices[0].message; msgs.push(m); if (m.content?.trim()) answer = m.content;
      calls = (m.tool_calls ?? []).map((c) => { let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch { /* → tool error */ } return { id: c.id, name: c.function.name, input }; });
      if (!calls.length) break;
      for (const c of calls) msgs.push({ role: 'tool', tool_call_id: c.id, content: engineTool(c) });
    }
  }
  return { ok: true, tokens, note: cut(answer.trim().split('\n').at(-1) ?? '', 200) };
}

// ---------- snapshots: what a task changed, and putting it back (no git needed) ----------
const SNAP_SKIP = (r) => /(^|\/)(\.lab|\.lab-node|\.lab-node\.tmp|\.lab-tools|node_modules|runs|dist|\.git|\.logs|__pycache__)(\/|$)/.test(r) || /^(bds\/vendor|auto\/\.work|auto\/\.lease\.json|auto\/\.lock|auto\/\.scheduled\.log|carry)(\/|$)/.test(r)
  || /^(\.lab-run\.|\.lab-base\.json|\.lab-patch\.txt|verify-result\.txt|\.lab-kind$|\.lab-ci-comment)/.test(r) || /\.(tgz|zip|mcaddon|mcpack|whl|apk|apks|xapk)$/.test(r) || SECRET.test(r) || r === 'bds/bench/ranking.json';
// what git ignores is not the work either (caches, logs, a person's local files): never compared, never put back
function ignoredSet() {
  if (!isGit()) return null;
  const r = git(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']);
  return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null;
}
function snapshot(keep) {
  const map = {}, dir = keep ? path.join(WORK, keep) : null, ign = ignoredSet() ?? [];
  const ignored = (r, isDir) => ign.some((x) => (x.endsWith('/') ? (r + (isDir ? '/' : '')).startsWith(x) : r === x));
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = rel(p); if (SNAP_SKIP(r) || ignored(r, e.isDirectory())) continue; if (e.isDirectory()) walk(p); else if (e.isFile()) { const b = fs.readFileSync(p); map[r] = sha(b); if (dir) { const q = path.join(dir, r); fs.mkdirSync(path.dirname(q), { recursive: true }); fs.writeFileSync(q, b); } } } };
  walk(TOP);
  if (dir) fs.writeFileSync(path.join(dir, '.snap.json'), JSON.stringify(map));
  return map;
}
const changedSince = (before, after = snapshot()) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((r) => before[r] !== after[r]).sort();
function putBack(id, paths) {
  const dir = path.join(WORK, id);
  for (const r of paths) {
    const b = path.join(dir, r), f = path.join(TOP, r);
    if (fs.existsSync(b)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(b, f); continue; }
    fs.rmSync(f, { force: true });
    for (let d = path.dirname(f); d.startsWith(TOP + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { break; } }   // the folders it made, once empty
  }
}
const dropWork = (id) => fs.rmSync(path.join(WORK, id), { recursive: true, force: true });

// ---------- the gate: the offline tests an engine change must keep passing ----------
export function gate(pol, out, only = null, { jobs } = {}) {
  const res = [], list = [];
  for (const t of only ?? pol.gate) { if (!fs.existsSync(path.join(TOP, t))) res.push({ t, ok: true, skip: true }); else list.push(t); }
  if (!list.length) return res;
  // side by side (common/run-tests.mjs: LAB_GATE_JOBS, default the cores; the tests that share the lab folder run alone)
  const r = spawnSync(process.execPath, [path.join(REPO, 'common', 'run-tests.mjs'), '--json', '--cwd', TOP, '--timeout', '900000', ...(jobs ? ['--jobs', String(jobs)] : []), ...list],
    { cwd: TOP, encoding: 'utf8', maxBuffer: 256e6, env: { ...process.env, LAB_NOTRACE: '1', FORCE_COLOR: '0', LAB_AUTO_IN_GATE: '1' } });
  let rows = null; try { rows = JSON.parse(r.stdout); } catch { /* the runner itself failed */ }
  if (!Array.isArray(rows)) rows = list.map((t) => ({ t, ok: false, lines: [`✘ the test runner failed: ${((r.stderr || r.stdout || '').trim().split('\n').at(-1)) || 'exit ' + r.status}`] }));
  for (const x of rows) {
    const bad = x.lines.filter((l) => /^✘/.test(l));
    res.push({ t: x.t, ok: x.ok, bad: bad.slice(0, 4), tail: x.lines.at(-1), ms: x.ms });
    out(`  gate ${x.ok ? '✔' : '✘'} ${x.t}${x.ms ? ` (${Math.round(x.ms / 1000)} s)` : ''}${x.ok ? '' : ': ' + (x.lines.filter((l) => /^(✘|FAIL )/.test(l)).slice(0, 2).join(' | ') || x.lines.at(-1))}`);
    // a failure: where it failed, from the test's own output (CI shows nothing else of a test run side by side)
    if (!x.ok) { const at = Math.max(0, x.lines.findIndex((l) => /^(✘|FAIL )/.test(l))); for (const l of x.lines.slice(at, at + 25)) out(`      | ${l}`); }
  }
  return res;
}
// an engine change: it passes the gate, or each test it fails also failed before it (not its doing); and the floor is intact
async function engineVerdict(id, pol, changed, floor0, out) {
  const touched = changed.filter((r) => isProtected(r));
  if (touched.length || floorHash(TOP) !== floor0) return { ok: false, why: `touched the floor (${touched.join(' ') || 'common/auto-guard.mjs'}): put back` };
  if (!changed.length) return { ok: false, why: 'changed nothing' };
  // the gate on a lender's host when the person set gateOn (AI-free, the same tests, the change as it is on disk): passed
  // there = passed; failed there, or no host could take it (the budget, the hours, none) = the gate here decides, as before
  if (pol.gateOn && pol.gateOn !== 'local') {
    const said = [];
    const passed = await hostCmd(['run', 'gate', '--on', String(pol.gateOn)], (l) => { said.push(l); out(`  host ${l}`); });
    const hit = said.map((l) => /^PASS (r\S+) on (\S+?)（/.exec(l)).find(Boolean);
    if (passed && hit) return { ok: true, why: `gate passed on ${hit[2]} (${hit[1]})` };
  }
  const after = gate(pol, out), failing = after.filter((x) => !x.ok).map((x) => x.t);
  if (!failing.length) return { ok: true, why: `gate passed (${after.filter((x) => !x.skip).length} tests)` };
  // were they failing before the change too? put the old files in, run just those, put the change back
  const tmp = `${id}-new`; const nowSnap = {}; for (const r of changed) { const f = path.join(TOP, r); if (fs.existsSync(f)) { const q = path.join(WORK, tmp, r); fs.mkdirSync(path.dirname(q), { recursive: true }); fs.copyFileSync(f, q); nowSnap[r] = 1; } }
  putBack(id, changed);
  const before = gate(pol, () => {}, failing);
  for (const r of changed) { const q = path.join(WORK, tmp, r), f = path.join(TOP, r); if (nowSnap[r]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.copyFileSync(q, f); } else fs.rmSync(f, { force: true }); }
  dropWork(tmp);
  const broke = failing.filter((t) => before.find((x) => x.t === t)?.ok);
  return broke.length ? { ok: false, why: `broke ${broke.join(' ')}` } : { ok: true, why: `gate: ${failing.join(' ')} failed before this change too` };
}

// ---------- git: merge what passed ----------
const git = (args, opts = {}) => spawnSync('git', args, { cwd: TOP, encoding: 'utf8', maxBuffer: 256e6, ...opts });
export const isGit = () => git(['rev-parse', '--is-inside-work-tree']).stdout?.trim() === 'true';
const hasRemote = () => !!git(['remote']).stdout?.trim();
function remote(args) { if (DRY()) { console.log(`DRY git ${args.join(' ')}`); return { status: 0 }; } return git(args); }
function merge(pol, task, paths, out) {
  if (!isGit() || !paths.length || pol.merge === 'off') return null;
  if (!git(['config', 'user.email']).stdout?.trim()) { git(['config', 'user.email', 'bds-lab-auto@users.noreply.github.com']); git(['config', 'user.name', 'bds-lab autopilot']); }
  const msg = `auto(${task.kind}): ${cut(task.title, 70)}\n\n${task.id}\n${task.why ? 'why: ' + task.why + '\n' : ''}`;
  const from = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  const branch = pol.merge === 'pr' ? `auto/${task.id.replace(/[^\w-]+/g, '-')}-${Date.now().toString(36)}` : null;
  if (branch) git(['checkout', '-q', '-b', branch]);
  // only what this task changed (the person's own unrelated edits stay uncommitted); ignored files stay out
  const keep = paths.filter((r) => git(['check-ignore', '-q', r]).status !== 0);
  for (let i = 0; i < keep.length; i += 200) git(['add', '-A', '--', ...keep.slice(i, i + 200)]);
  const c = git(['commit', '-q', '-m', msg]);
  if (c.status !== 0) { if (branch) git(['checkout', '-q', from]); out(`W auto: nothing committed (${(c.stdout + c.stderr).trim().split('\n').at(-1)})`); return null; }
  const hash = git(['rev-parse', '--short', 'HEAD']).stdout.trim();
  if (pol.merge === 'local' || !pol.push || !hasRemote()) { if (branch) git(['checkout', '-q', from]); return { commit: hash, where: branch ?? from }; }
  if (branch) {
    remote(['push', '-q', '-u', 'origin', branch]);
    if (!DRY()) spawnSync('gh', ['pr', 'create', '--head', branch, '--title', `auto(${task.kind}): ${cut(task.title, 70)}`, '--body', msg + '\n🤖 bds-lab autopilot'], { cwd: TOP, encoding: 'utf8' });
    else console.log(`DRY gh pr create --head ${branch}`);
    git(['checkout', '-q', from]);
    return { commit: hash, where: `PR ${branch}` };
  }
  let p = remote(['push', '-q', 'origin', `HEAD:${from}`]);
  if (p.status !== 0) { remote(['pull', '-q', '--rebase', 'origin', from]); p = remote(['push', '-q', 'origin', `HEAD:${from}`]); }   // someone else pushed meanwhile
  if (p.status !== 0) out(`W auto: push failed: ${(p.stderr ?? '').trim().split('\n').at(-1)}`);
  return { commit: hash, where: from, pushed: p.status === 0 };
}
function diffText(paths, id, limit = 24000) {
  const parts = [];
  for (const r of paths) {
    const b = path.join(WORK, id, r), f = path.join(TOP, r);
    const old = fs.existsSync(b) ? fs.readFileSync(b, 'utf8') : null, now = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
    if ((old ?? now ?? '').includes('\u0000')) { parts.push(`--- ${r} (binary)`); continue; }
    if (old === null) { parts.push(`+++ new ${r}\n${cut(now, 3000).split('\n').map((l) => '+' + l).join('\n')}`); continue; }
    if (now === null) { parts.push(`--- deleted ${r}`); continue; }
    const a = old.split('\n'), c = now.split('\n'); let p = 0; while (p < a.length && p < c.length && a[p] === c[p]) p++;
    let q = 0; while (q < a.length - p && q < c.length - p && a[a.length - 1 - q] === c[c.length - 1 - q]) q++;
    parts.push(`@@ ${r}:${p + 1}\n${a.slice(p, a.length - q).map((l) => '-' + l).join('\n')}\n${c.slice(p, c.length - q).map((l) => '+' + l).join('\n')}`);
  }
  return cut(parts.join('\n'), limit);
}
// changes that need no reviewer: a release's version and notes; tests only appended (harden, playtest findings)
function mechanical(task, paths, id) {
  const appended = (r) => { const b = path.join(WORK, id, r), f = path.join(TOP, r); if (!fs.existsSync(f)) return false; const old = fs.existsSync(b) ? fs.readFileSync(b, 'utf8') : ''; return fs.readFileSync(f, 'utf8').startsWith(old.trimEnd()); };
  if (task.kind === 'release') return paths.every((r) => /\/(CHANGELOG\.md|TASK\.md|manifest\.json|pyproject\.toml|package\.json)$/.test(r));
  if (task.kind === 'harden') return paths.every((r) => /\/tests\.(txt|lock)$/.test(r) && appended(r));
  return false;
}
async function review(task, paths, id, out) {
  if (mechanical(task, paths, id)) return { ok: true, why: 'APPROVE: mechanical (version/notes, or tests only appended): no AI asked', tokens: 0 };
  const p = `You are the reviewer of an autopilot: an AI changed bds-lab (a lab where AI builds Minecraft Bedrock addons and proves them on real servers) and this change is merged to main with no person if you approve. It already passed the lab's own checks.\nTask: ${task.kind} — ${task.title}\nChanged files: ${paths.join(' ')}\nDiff:\n${diffText(paths, id)}\nREJECT only for: a weakened or deleted test or check, a secret or token in a file, something destructive or unrelated to the task, code that plainly cannot work, a change to the safety floor (${PROTECTED.join(' ')}). Otherwise APPROVE.\nFirst line exactly: APPROVE or REJECT: <reason>`;
  try { const r = await ask(p, 400), line = r.text.trim().split('\n')[0] ?? ''; return { ok: /^APPROVE/i.test(line), why: cut(line, 160), tokens: r.tokens }; } catch (e) { out(`W auto: review: ${e.message}: not merged (a change no reviewer read is not merged with review on; it runs again later)`); return { ok: false, why: `REJECT: the reviewer could not be asked (${cut(e.message, 80)})`, tokens: 0 }; }
}

// ---------- act ----------
function labRun(args, env, out) {
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', timeout: 4 * HOUR, maxBuffer: 256e6, env: { ...process.env, FORCE_COLOR: '0', LAB_NOTRACE: '1', LAB_AUTO_AGENT: '1', ...env } });
  const lines = ((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n').filter(Boolean);
  // the tokens it spent: make prints `MADE|NOT DONE ... via x: N tokens`, harden/maintain their own totals
  const tokens = lines.filter((l) => /^(MADE|NOT DONE|HARDEN|maintain|BUDGET|harden|FORGE)/i.test(l)).map((l) => Number((/([\d,]{2,}) tokens/.exec(l)?.[1] ?? '0').replace(/,/g, ''))).reduce((a, b) => a + b, 0);
  lines.slice(-8).forEach((l) => out('  ' + l));
  return { ok: r.status === 0, lines, tokens };
}
async function lessonFrom(task, lines) {
  if (!VIA) return '';
  try { const r = await ask(`An autopilot task in bds-lab (AI builds Minecraft Bedrock addons, proves them on real servers) failed. Write ONE line, at most 25 words, imperative and general enough to help the next run avoid it (not a log line).\nTask: ${task.kind} — ${task.title}\nLast output:\n${lines.slice(-30).join('\n')}`, 200); return { text: r.text.trim().split('\n')[0], tokens: r.tokens }; } catch { return ''; }
}
async function invent(n = 3) {
  const have = allUnits().map((x) => `${x.k}/${x.u}`).join(', '), open = openItems().join(' | '), done = backlogLines().filter((l) => /^- \[[x~]\]/.test(l)).slice(-20).join(' | ');
  const r = await ask(`You choose what bds-lab builds next, by yourself. Propose ${n} NEW Minecraft Bedrock addon requests: things players would enjoy, each testable on a server with real clients (commands, items, forms, events), not done yet.\nExisting units: ${have || 'none'}\nOpen backlog: ${open || 'none'}\nDone or given up: ${done || 'none'}\nEach: one line, a concrete request in Japanese as a player would write it. Reply a JSON array of strings only.`, 800);
  const j = jsonIn(r.text);
  return { n: addItems(Array.isArray(j) ? j.slice(0, n) : []), tokens: r.tokens };
}
async function reflect(rows) {
  const st = stats(rows), recent = rows.slice(-30).map((r) => `${r.at.slice(0, 10)} ${r.id} ${r.ok ? 'ok' : 'FAIL'} ${r.tokens ?? 0}tok ${cut(r.note ?? '', 80)}`).join('\n');
  const r = await ask(`You are the autopilot of bds-lab (AI builds Minecraft Bedrock addons alone and proves them on real servers, and also improves the lab's own engine). Reread what you did and plan.\nPer kind (ok/n, tokens): ${Object.entries(st).map(([k, s]) => `${k} ${s.ok}/${s.n} ${s.tok}`).join(', ')}\nRecent:\n${recent}\nLessons:\n${lessons().join('\n') || '(none)'}\nOpen backlog:\n${openItems().join('\n') || '(none)'}\nUnits: ${allUnits().map((x) => `${x.k}/${x.u}`).join(', ')}\nReply JSON only: {"add":[new backlog lines: an addon request in Japanese, or "lab: <a change to the lab itself that would make you build better or cheaper, from the failures above>"],"drop":[open lines to remove exactly as written],"lessons":[the 20 most useful lessons, condensed, each one line]}`, 3000);
  const j = jsonIn(r.text) ?? {};
  let dropped = 0;
  if (Array.isArray(j.drop) && j.drop.length) { const set = new Set(j.drop.map(String)); const lines = backlogLines().map((l) => { const m = /^- \[ \] (.+)$/.exec(l); if (m && set.has(m[1].trim())) { dropped++; return `- [-] ${m[1].trim()} (dropped ${today()})`; } return l; }); fs.writeFileSync(BACKLOG, lines.join('\n')); }
  const added = addItems(Array.isArray(j.add) ? j.add.slice(0, 8) : []);
  if (Array.isArray(j.lessons) && j.lessons.length) fs.writeFileSync(LESSONS, '# Lessons (the autopilot writes these from its own failures; every make reads them)\n' + j.lessons.slice(0, 20).map((x) => `- ${cut(String(x).replace(/^- /, ''), 240)}`).join('\n') + '\n');
  return { added, dropped, lessons: Array.isArray(j.lessons) ? Math.min(20, j.lessons.length) : 0, tokens: r.tokens };
}
function issueReply(task, ok, lines) {
  if (!task.issue) return;
  const unit = lines.map((l) => /^(?:MADE|NOT DONE) (addons|plugins|mods)\/([\w-]+)/.exec(l)).filter(Boolean).at(-1);
  const body = `${ok ? '✅ 自動操縦の AI が作り、本物のサーバーでテストと品質チェックに通しました。' : '⚠️ 自動操縦の AI が作りましたが、まだ通っていません（次の機会にもう一度試します）。'}\n\n${unit ? `\`${unit[1]}/${unit[2]}\`` : ''}\n\n<details><summary>最後の結果</summary>\n\n\`\`\`\n${lines.slice(-15).join('\n')}\n\`\`\`\n</details>\n\n<!-- bds-lab-auto ${task.id} -->`;
  if (DRY()) { console.log(`DRY gh issue comment ${task.issue}\n${body}`); if (ok) console.log(`DRY gh issue close ${task.issue}`); return; }
  const f = path.join(WORK, `issue-${task.issue}.md`); fs.mkdirSync(WORK, { recursive: true }); fs.writeFileSync(f, body);
  spawnSync('gh', ['issue', 'comment', String(task.issue), '--body-file', f], { cwd: TOP, encoding: 'utf8' });
  if (ok) spawnSync('gh', ['issue', 'close', String(task.issue)], { cwd: TOP, encoding: 'utf8' });
  fs.rmSync(f, { force: true });
}

// one tick: false when nothing ran (stopped, out of tokens, nothing to do)
export async function tick({ dry = false, out = console.log } = {}) {
  const pol = policy(TOP), why0 = stopped(TOP);
  if (why0) { out(`STOP auto/STOP: ${cut(why0, 120)} (node lab.mjs auto resume)`); return false; }
  const rows = ledger(), spend = canSpend(pol, spentToday(rows));
  if (!spend.ok) { out(`PAUSE ${spend.why}: the next day continues`); return false; }
  // without an AI only what the lab does by itself (maintain's autofix, release; harden asks none when nothing is missed)
  const cands = sense(pol, rows).filter((t) => VIA || !NO_AI.has(t.kind));
  if (!cands.length) { out(`IDLE nothing to do${VIA ? '' : ' without an AI'}`); return false; }
  const pick = await choose(cands, rows, out), task = pick.task;
  task.why = pick.why;
  out(`auto: ${task.id} (${task.kind}, score ${task.score}) — ${task.title}\n  why: ${task.why}`);
  if (dry) { out(`DRY ${task.cmd ? 'node lab.mjs ' + task.cmd.map((a) => (/\s/.test(a) ? JSON.stringify(cut(a, 60)) : a)).join(' ') : `(${task.kind}: the AI itself)`}`); return true; }
  const id = `${Date.now().toString(36)}-${task.kind}`, t0 = Date.now(), floor0 = floorHash(TOP);
  const before = snapshot(id);
  let ok = false, tokens = pick.tokens, note = '', lines = [];
  const budget = canSpend(pol, spentToday(rows), tokens).left;
  try {
    if (task.kind === 'invent') { const r = await invent(); ok = r.n > 0; tokens += r.tokens; note = `${r.n} idea(s) into the backlog`; }
    else if (task.kind === 'reflect') { const r = await reflect(rows); ok = true; tokens += r.tokens; note = `backlog +${r.added} −${r.dropped}${r.lessons ? `; lessons → ${r.lessons}` : ''}`; }
    else if (task.kind === 'lab') {
      const r = await engineAgent(task, pol, budget, out); tokens += r.tokens;
      const v = r.ok ? await engineVerdict(id, pol, changedSince(before), floor0, out) : { ok: false, why: r.note };
      ok = v.ok; note = `${v.why}${r.note ? ' | ' + r.note : ''}`;
    } else {
      const r = labRun(task.cmd, { LAB_TOKEN_BUDGET: String(budget), LAB_MAKE_CONTEXT: lessonsCtx(id) }, out);
      ok = r.ok; tokens += r.tokens; lines = r.lines; note = cut(r.lines.filter((l) => /^(MADE|NOT DONE|DONE|FAIL|OK|PASS|BROKEN|FIXED|LIMITED|WAIT|ERR)/.test(l)).at(-1) ?? r.lines.at(-1) ?? '', 160);
    }
  } catch (e) { ok = false; note = 'ERR ' + e.message; out(`E auto: ${e.message}`); }
  // each kind may change only its own part of the folder (an agent CLI inside a make can write anywhere): the floor never,
  // the rest outside the scope is put back and said
  {
    const stray = changedSince(before).filter((r) => isProtected(r) || !inScope(task.kind, r));
    if (stray.length || floorHash(TOP) !== floor0) {
      putBack(id, stray);
      if (stray.some((r) => isProtected(r)) || floorHash(TOP) !== floor0) { ok = false; note = `touched the floor (${stray.filter((r) => isProtected(r)).join(' ') || 'common/auto-guard.mjs'}): put back${note ? ' | ' + note : ''}`; }
      else note = `${note}${note ? ' | ' : ''}outside its scope, put back: ${cut(stray.join(' '), 120)}`;
      out(`  W ${stray.length} change(s) outside ${task.kind}'s scope put back: ${cut(stray.join(' '), 160)}`);
    }
  }
  // nothing that failed stays (a half-built unit, a broken engine change); what it taught stays (auto/). maintain, harden and
  // release put back their own failures and keep what worked (one unit fixed of three): theirs is kept and merged
  const own = SELF_CLEANING.has(task.kind) && changedSince(before).some((r) => !/^auto\//.test(r));
  if (!ok && !own) putBack(id, changedSince(before).filter((r) => !/^auto\//.test(r)));
  // a second AI reads what changed before it is merged (the lab's own ledger/backlog/lesson files are not code: not reviewed)
  let changed = changedSince(before);
  const code = changed.filter((r) => !/^auto\//.test(r));
  let keep = ok || own;
  if (keep && code.length && pol.review && VIA && !['invent', 'reflect'].includes(task.kind)) {
    const rv = await review(task, code, id, out); tokens += rv.tokens;
    out(`  review: ${rv.why}`);
    if (!rv.ok) { ok = false; keep = false; note = `rejected by review: ${rv.why}`; putBack(id, code); changed = changedSince(before); }
  }
  if (!ok && task.kind !== 'invent' && task.kind !== 'reflect') { const l = await lessonFrom(task, lines.length ? lines : [note]); if (l) { tokens += l.tokens ?? 0; addLesson(task.kind, l.text); } }
  if (task.item) markItem(task.item, ok);
  if (task.issue) issueReply(task, ok, lines.length ? lines : [note]);
  const row = { id: task.id, at: new Date().toISOString(), kind: task.kind, title: cut(task.title, 120), ok, tokens, sec: Math.round((Date.now() - t0) / 1000), via: VIA ? `${VIA}${MODEL ? ':' + MODEL : ''}` : 'none', why: task.why, note };
  record(row);
  const m = keep ? merge(pol, ok ? task : { ...task, title: `partly: ${task.title}` }, changedSince(before), out) : null;
  if (m) out(`  merged: ${m.commit} → ${m.where}${m.pushed === false ? ' (not pushed)' : ''}`);
  else if (!keep && isGit()) merge(pol, { ...task, title: `failed, ledger only: ${task.title}` }, changedSince(before).filter((r) => /^auto\//.test(r)), out);   // the failure is remembered too
  dropWork(id);
  out(`${ok ? 'OK' : 'FAIL'} ${task.id}: ${note} (${tokens.toLocaleString('en')} tokens, ${row.sec}s)`);
  // the phone hears what changed something or failed; not the planning (invent, reflect)
  if (!['invent', 'reflect'].includes(task.kind) || !ok) try { const n = await import('./notify.mjs'); await n.notify(`auto ${ok ? 'OK' : 'FAIL'}: ${task.id}`, [cut(task.title, 200), note, `${tokens.toLocaleString('en')} tokens`], { ok, out }); } catch { /* best-effort */ }
  return true;
}

// ---------- the commands ----------
function status(out) {
  const pol = policy(TOP), rows = ledger(), st = stats(rows), s = stopped(TOP);
  out(`autopilot: ${s ? `STOPPED (${cut(s, 80)}; node lab.mjs auto resume)` : 'ready'} | merge ${pol.merge}${pol.push ? '+push' : ''} | review ${pol.review ? 'on' : 'off'} | today ${spentToday(rows).toLocaleString('en')} / ${pol.dailyTokens.toLocaleString('en')} tokens | ${rows.length} tasks in the ledger`);
  if (Object.keys(st).length) out('earned: ' + Object.entries(st).map(([k, x]) => `${k} ${x.ok}/${x.n}`).join(' · '));
  { const hs = hostsSummary(); if (hs) out(`hosts (gate ${pol.gateOn}): ${hs}`); }
  const q = sense(pol, rows);
  out(q.length ? 'next (the AI picks one; score = value × success rate × cost):' : 'next: nothing to do');
  for (const t of q.slice(0, 10)) out(`  ${String(t.score).padStart(5)}  ${t.id}  ${t.title}`);
  if (q.length > 10) out(`  … ${q.length - 10} more`);
  out('run: node lab.mjs auto run [--forever] | an agent itself: node lab.mjs auto next | stop: node lab.mjs auto stop');
  return true;
}
function setPolicy(args, out) {
  const f = path.join(AUTO, 'policy.json');
  let p = {}; try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* new */ }
  if (!args.length) { out(JSON.stringify(policy(TOP), null, 1)); return true; }
  if (process.env.LAB_AUTO_AGENT) { out('ERR the policy is the person\'s: an AI never changes it'); return false; }
  for (const a of args) {
    const m = /^([\w.]+)=(.*)$/.exec(a); if (!m) { out(`ERR ${a}: key=value`); return false; }
    let v = m[2]; try { v = JSON.parse(v); } catch { /* a string */ }
    const ks = m[1].split('.'); if (!(ks[0] in DEFAULT_POLICY)) { out(`ERR unknown key ${ks[0]} (${Object.keys(DEFAULT_POLICY).join(' ')})`); return false; }
    // the same type as the default (dailyTokens=abc used to be stored as a string, and `spent >= "abc"` is never true: no cap)
    const want = ks.length === 2 && ks[0] === 'kinds' ? (ks[1] in DEFAULT_POLICY.kinds ? false : undefined) : ks.length === 1 ? DEFAULT_POLICY[ks[0]] : undefined;
    if (want === undefined) { out(`ERR ${m[1]}: no such setting${ks[0] === 'kinds' ? ` (kinds: ${Object.keys(DEFAULT_POLICY.kinds).join(' ')})` : ''}`); return false; }
    if (typeof want === 'number' && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) { out(`ERR ${m[1]}=${m[2]}: a number ≥ 0`); return false; }
    if (typeof want === 'boolean' && typeof v !== 'boolean') { out(`ERR ${m[1]}=${m[2]}: true or false`); return false; }
    if (m[1] === 'merge' && !['auto', 'pr', 'local'].includes(v)) { out(`ERR merge=${m[2]}: auto | pr | local`); return false; }
    if (m[1] === 'gateOn' && !(v === 'local' || v === 'auto' || /^[\w.-]+\/[\w.-]+$/.test(String(v)))) { out(`ERR gateOn=${m[2]}: local | auto | <owner/repo>`); return false; }
    if (Array.isArray(want) && !(Array.isArray(v) && v.every((x) => typeof x === 'string' && fs.existsSync(path.join(TOP, x))))) { out(`ERR ${m[1]}: a JSON list of test files that exist, e.g. ${m[1]}='["tests/docs-offline.mjs"]'`); return false; }
    if (typeof want === 'string' && typeof v !== 'string') { out(`ERR ${m[1]}=${m[2]}: text`); return false; }
    let o = p; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; o[ks.at(-1)] = v;
  }
  fs.mkdirSync(AUTO, { recursive: true }); fs.writeFileSync(f, JSON.stringify(p, null, 1) + '\n');
  out('OK ' + args.join(' ')); return true;
}
function schedule(when, out) {
  const log = path.join(AUTO, '.scheduled.log'), line = `cd ${JSON.stringify(TOP)} && ${JSON.stringify(process.execPath)} lab.mjs auto run --ticks 1 >> ${JSON.stringify(log)} 2>&1 # bds-lab auto`;
  const cron = { hourly: '7 * * * *', daily: '23 4 * * *' }[when];
  if (!cron && when !== 'off') { out('usage: node lab.mjs auto schedule hourly|daily|off'); return false; }
  if (process.platform === 'win32') {
    const name = 'bds-lab auto';
    if (when === 'off') { spawnSync('schtasks', ['/Delete', '/F', '/TN', name]); out('OK the scheduled autopilot is off'); return true; }
    const r = spawnSync('schtasks', ['/Create', '/F', '/TN', name, '/SC', when === 'hourly' ? 'HOURLY' : 'DAILY', '/TR', `cmd /c cd /d "${TOP}" && "${process.execPath}" lab.mjs auto run --ticks 1 >> "${log}" 2>&1`], { encoding: 'utf8' });
    out(r.status === 0 ? `OK the autopilot runs ${when} (Task Scheduler; log auto/.scheduled.log)` : `E schtasks: ${(r.stderr || r.stdout).trim()}`); return r.status === 0;
  }
  const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (cur.error) { out('E no crontab here: run `node lab.mjs auto run --forever` instead'); return false; }
  const keep = (cur.stdout ?? '').split('\n').filter((l) => l && !l.includes('# bds-lab auto'));
  const r = spawnSync('crontab', ['-'], { input: [...keep, ...(cron ? [`${cron} ${line}`] : [])].join('\n') + '\n', encoding: 'utf8' });
  out(r.status !== 0 ? `E crontab: ${r.stderr}` : when === 'off' ? 'OK the scheduled autopilot is off' : `OK the autopilot runs ${when} (crontab; log auto/.scheduled.log; off: node lab.mjs auto schedule off)`);
  return r.status === 0;
}
// for an agent that is the AI itself: the lease holds the snapshot, so `done` can gate and put an engine change back
function next(out) {
  const pol = policy(TOP), s = stopped(TOP);
  if (s) { out(`STOP auto/STOP: ${cut(s, 120)}. Do nothing more; tell the person.`); return false; }
  const rows = ledger(), spend = canSpend(pol, spentToday(rows));
  if (!spend.ok) { out(`PAUSE ${spend.why}. Do nothing more today.`); return false; }
  const q = sense(pol, rows);
  if (!q.length) { out('IDLE nothing to do: stop here.'); return true; }
  const t = q[0], id = `${Date.now().toString(36)}-${t.kind}`;
  snapshot(id);
  fs.writeFileSync(LEASE, JSON.stringify({ lease: id, task: t, at: Date.now(), floor: floorHash(TOP) }));
  out(`TASK ${t.id} (${t.kind}): ${t.title}\ndo: ${t.howto}\nthen: node lab.mjs auto done ${t.id} ok|fail "<one-line lesson, for a fail>"`);
  if (q.length > 1) out(`(after it: ${q.slice(1, 4).map((x) => x.id).join(', ')})`);
  out(`never: ${PROTECTED.join(' ')} · never weaken a test · never node lab.mjs auto stop|resume|policy`);
  return true;
}
async function done(args, out) {
  let L = null; try { L = JSON.parse(fs.readFileSync(LEASE, 'utf8')); } catch { /* none */ }
  const [tid, verdict, ...rest] = args;
  if (!L || L.task.id !== tid || !/^(ok|fail)$/.test(verdict ?? '')) { out(`usage: node lab.mjs auto done <id> ok|fail ["lesson"]${L ? ` (the open task is ${L.task.id})` : ' (no open task: node lab.mjs auto next)'}`); return false; }
  const pol = policy(TOP), task = L.task, id = L.lease;
  const before = JSON.parse(fs.readFileSync(path.join(WORK, id, '.snap.json'), 'utf8'));
  let ok = verdict === 'ok', note = rest.join(' ');
  let changed = changedSince(before);
  if (changed.some((r) => isProtected(r)) || floorHash(TOP) !== L.floor) { ok = false; note = `touched the floor: put back (${changed.filter((r) => isProtected(r)).join(' ')})`; putBack(id, changed); }
  else if (ok && task.kind === 'lab') { const v = await engineVerdict(id, pol, changed, L.floor, out); ok = v.ok; note = v.why + (note ? ' | ' + note : ''); if (!ok) putBack(id, changed); }
  if (!ok && rest.length) addLesson(task.kind, rest.join(' '));
  if (task.item) markItem(task.item, ok);
  record({ id: task.id, at: new Date().toISOString(), kind: task.kind, title: cut(task.title, 120), ok, tokens: 0, sec: Math.round((Date.now() - L.at) / 1000), via: 'agent', why: 'auto next', note: cut(note, 200) });
  changed = changedSince(before);
  const m = ok ? merge(pol, task, changed, out) : merge(pol, { ...task, title: `failed, ledger only: ${task.title}` }, changed.filter((r) => /^auto\//.test(r)), out);
  dropWork(id); fs.rmSync(LEASE, { force: true });
  out(`${ok ? 'OK' : 'FAIL'} ${task.id}${note ? ': ' + note : ''}${m ? ` (merged ${m.commit} → ${m.where})` : ''}\nnext: node lab.mjs auto next`);
  return ok;
}

export async function autoCmd(args, out = console.log) {
  const a = [...args], flag = (k) => { const i = a.indexOf(k); if (i < 0) return undefined; const v = a[i + 1]; a.splice(i, 2); return v; };
  VIA = flag('--via') ?? null; MODEL = flag('--model') ?? process.env.LAB_MODEL ?? null;
  const sub = a[0] ?? 'status';
  if (sub === 'status') return status(out);
  if (sub === 'stop') { fs.mkdirSync(AUTO, { recursive: true }); fs.writeFileSync(path.join(AUTO, 'STOP'), (a.slice(1).join(' ') || `stopped ${new Date().toISOString()}`) + '\n'); out('OK the autopilot is stopped (auto/STOP). node lab.mjs auto resume starts it again'); return true; }
  if (sub === 'resume') { if (process.env.LAB_AUTO_AGENT) { out('ERR only the person resumes the autopilot'); return false; } fs.rmSync(path.join(AUTO, 'STOP'), { force: true }); out('OK the autopilot may run again'); return true; }
  if (sub === 'policy') return setPolicy(a.slice(1), out);
  if (sub === 'schedule') return schedule(a[1], out);
  if (sub === 'plan') {
    // for a schedule (.github/workflows/auto.yml): is there work this run, and which labs it may touch — decided before the costly
    // set-up (Python, Wine, the build tools), so an idle hourly run costs a minute instead of several (Actions minutes run out)
    const { pickVia } = await import('./make.mjs'); VIA = pickVia(null);
    const pol = policy(TOP), why0 = stopped(TOP), rows = ledger(), spend = canSpend(pol, spentToday(rows));
    const cands = why0 || !spend.ok ? [] : sense(pol, rows).filter((t) => VIA || !NO_AI.has(t.kind));
    const labs = [...new Set(cands.flatMap((t) => { const m = /^(?:repair|release|playtest|harden):(bds|end|ll)\//.exec(t.id); return m ? [m[1]] : Object.keys(UNITS); }))].sort();
    out(cands.length ? `WORK ${cands[0].id} first (${cands.length} candidate(s), labs ${labs.join(',')})` : `IDLE ${why0 ? `stopped: ${cut(why0, 80)}` : !spend.ok ? spend.why : `nothing to do${VIA ? '' : ' without an AI'}`}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `work=${cands.length ? 'yes' : 'no'}\nlabs=${labs.join(',')}\n`);
    return true;
  }
  if (sub === 'gate') {
    // --on <owner/repo>|auto: on a lender's host (node lab.mjs host): the same gate, their minutes
    const on = flag('--on');
    if (on) return hostCmd(['run', a.includes('--all') ? 'gate-all' : 'gate', '--on', on], out);
    // --all: every offline test in tests/ too (the gate's, then the rest: the labs end to end, app, lan, login, env, …);
    // --jobs n: how many side by side (1 = one by one); a test whose vendored part is missing says so and is not a failure
    const pol = policy(TOP), all = a.includes('--all'), jobs = Number(flag('--jobs')) || undefined;
    const extra = all ? fs.readdirSync(path.join(TOP, 'tests')).filter((f) => /^(offline|[\w-]+-offline)\.mjs$/.test(f)).map((f) => `tests/${f}`).filter((t) => !pol.gate.includes(t)).sort() : [];
    const t0 = Date.now(), r = gate(pol, out, all ? [...pol.gate, ...extra] : null, { jobs }); const bad = r.filter((x) => !x.ok); out(bad.length ? `FAIL gate: ${bad.map((x) => x.t).join(' ')}` : `PASS gate (${r.filter((x) => !x.skip).length} tests, ${Math.round((Date.now() - t0) / 1000)} s)`); return !bad.length;
  }
  if (sub === 'next') return next(out);
  if (sub === 'done') return done(a.slice(1), out);
  if (sub === 'log') {
    const rows = ledger(), n = Number(a[1]) || 20;
    for (const r of rows.slice(-n)) out(`${r.at.slice(0, 16).replace('T', ' ')} ${r.ok ? '✔' : '✘'} ${r.id}  ${(r.tokens ?? 0).toLocaleString('en')} tok ${r.sec}s  ${cut(r.note ?? '', 100)}`);
    const st = stats(rows); out(Object.entries(st).map(([k, x]) => `${k} ${x.ok}/${x.n} avg ${Math.round(x.tok / x.n).toLocaleString('en')} tok`).join(' · ') || '(empty ledger)');
    return true;
  }
  if (sub === 'run') {
    if (process.env.LAB_AUTO_AGENT) { out('ERR the autopilot is already running this (an AI it started cannot start another)'); return false; }
    // one autopilot at a time on a folder (a schedule and a person, two terminals)
    try { const l = JSON.parse(fs.readFileSync(LOCK, 'utf8')); let alive = false; try { process.kill(l.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } if (alive && l.pid !== process.pid) { out(`BUSY another autopilot runs here (pid ${l.pid}, since ${new Date(l.at).toISOString().slice(0, 16)})`); return false; } } catch { /* free */ }
    fs.mkdirSync(AUTO, { recursive: true }); fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }));
    process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.rmSync(LOCK); } catch { /* gone */ } });
    if (!VIA) { const { pickVia } = await import('./make.mjs'); VIA = pickVia(null); }
    if (!VIA) out('W auto: no AI (ANTHROPIC_API_KEY / OPENAI_API_KEY / claude / codex / gemini): only tasks the lab does without one; the choice is the best score');
    const forever = a.includes('--forever'), dry = a.includes('--dry'), ticks = forever ? Infinity : Number(flag('--ticks') ?? 1);
    const pol = policy(TOP);
    let ran = 0;
    for (let i = 0; i < ticks; i++) {
      const did = await tick({ dry, out });
      if (did) ran++;
      if (stopped(TOP)) break;
      if (i + 1 < ticks) { if (!did && !forever) break; if (forever) await new Promise((r) => setTimeout(r, (did ? 1 : 3) * pol.sleepMinutes * 60_000)); }
    }
    out(`auto: ${ran} task(s)`);
    return true;
  }
  out('usage: node lab.mjs auto [run [--ticks n|--forever] [--dry] [--via v] [--model m] | next | plan | done <id> ok|fail ["lesson"] | gate [--all] [--jobs n] [--on <owner/repo>|auto] | log [n] | stop ["why"] | resume | policy [key=value] | schedule hourly|daily|off]');
  return false;
}
