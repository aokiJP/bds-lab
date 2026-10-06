// node lab.mjs skill ...: the lab's know-how as skills any AI can use, and the loop that grows them.
//   skill                         list (name, when to use it, rules verified / candidates)
//   skill <name>                  print one skill (read the one that fits: each costs tokens on every later turn)
//   skill build [--check]         write each SKILL.md's rule lines from skills/knowledge.json (--check: fail when stale)
//   skill install <claude|codex|gemini|cursor|copilot|agents|all> [--to <project>] [--global] [--drafts]
//                                 SKILL.md folders where each AI looks (.claude/ .agents/ .gemini/ .github/ .cursor/skills),
//                                 + skills/<name>/ai/<ai>.md for that AI only; Gemini / Copilot / AGENTS.md also get a
//                                 routing block that names `node lab.mjs skill <name>`
//   skill verify [id|all]         re-run each rule's evidence: its probe addon on the real BDS (skills/probes/<id>) or its
//                                 offline test; records the BDS version and date; a rule whose evidence fails is "disputed"
//   skill note "<one line>"     what surprised you while working → auto/LESSONS.md → skill learn makes it a candidate
//   skill growth                  how far the know-how has come (generations, proof, misses) and the next step for each part
//   skill learn [--from <repo>]   what failed and then got fixed (episodes the lab records with no tokens), auto/LESSONS.md:
//                                 recurring ones become candidate rules (not in SKILL.md until proven)
//   skill promote <id> [--evidence test:<file>|probe:<dir>|measured:"<what>"]   skill retire <id> "<why>"
//   skill bench [--via claude|codex|gemini|anthropic|openai] [--tasks a,b] [--runs n] [--without <skill>]
//                                 the bench tasks with the skills and without (A/B, hidden tests decide pass): history.json;
//                                 a skills change is kept only when builds do not get worse; --without: all but one skill
//                                 (a draft skill becomes kept when builds are no worse with it)
//   skill new | grade | route | refine   the skills as prompts: write one, grade it (skills/rubric.json, --ref a reference
//                                 collection), route a request to it, refine it in a gated loop (common/skill-forge.mjs)
// Every rule is a past failure with evidence the lab can re-run; a rule the real server contradicts loses (status disputed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as forge from './skill-forge.mjs';
import * as evolve from './skill-evolve.mjs';
import * as scratch from './scratch.mjs';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SK = process.env.LAB_SKILLS_DIR ? path.resolve(process.env.LAB_SKILLS_DIR) : path.join(TOP, 'skills');   // (tests: a copy)
const KNOW = path.join(SK, 'knowledge.json'), HIST = path.join(SK, 'history.json');
const BEGIN = /<!-- rules:begin[^>]*-->/, END = '<!-- rules:end -->';
export const EVIDENCE = ['test', 'probe', 'unit', 'measured', 'source'];   // strongest first: re-run here (test, probe, unit: a working addon/plugin/mod in the lab whose tests pass) > seen here once (measured) > a reference project says so (source)
const MAX_SKILL = 3200;   // bytes: a skill is read whole; past this it costs more than it saves (split it or retire rules)

const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const knowledge = () => readJ(KNOW, { rules: [] });
export function counts(k) {
  const live = k.rules.filter((r) => r.status === 'verified'), by = (kind) => live.filter((r) => r.evidence?.kind === kind).length;
  return { verified: live.length, rerun: by('test') + by('probe') + by('unit'), measured: by('measured'), source: by('source'), candidate: k.rules.filter((r) => r.status === 'candidate').length, disputed: k.rules.filter((r) => r.status === 'disputed').length, retired: k.rules.filter((r) => r.status === 'retired').length, missed: live.filter((r) => (r.misses?.n ?? 0) >= 3).length };
}
// every save that changes the counts adds a line to k.log: how the know-how grew, generation by generation (skill growth)
const saveKnow = (k) => {
  const c = counts(k), last = (k.log ?? []).at(-1), same = last && Object.keys(c).every((x) => last[x] === c[x]);
  if (!same) (k.log ??= []).push({ gen: (last?.gen ?? 0) + 1, at: new Date().toISOString().slice(0, 10), ...c });
  fs.writeFileSync(KNOW, JSON.stringify(k, null, 2) + '\n');
};
export function skillNames() { try { return fs.readdirSync(SK, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(SK, e.name, 'SKILL.md'))).map((e) => e.name).sort((a, b) => (a.endsWith('-master') ? -1 : b.endsWith('-master') ? 1 : a.localeCompare(b))); } catch { return []; } }
export function front(text) { const m = /^---\n([\s\S]*?)\n---\n?/.exec(text); const o = {}; if (m) for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } return { meta: o, body: m ? text.slice(m[0].length) : text }; }
const skillFile = (n) => path.join(SK, n, 'SKILL.md');

/** the rule lines of one skill, from knowledge.json (verified only) */
export function ruleLines(k, name) {
  return k.rules.filter((r) => r.skill === name && r.status === 'verified').map((r) => `- ${r.rule}${r.why ? ` (when missed: ${r.why})` : ''} \`${r.id}\`${r.evidence?.kind === 'source' ? ' [source]' : ''}`);
}
/** SKILL.md with its rules block rewritten; null when it has no block */
export function withRules(text, lines) {
  const b = BEGIN.exec(text); const e = text.indexOf(END);
  if (!b || e < 0) return null;
  return text.slice(0, b.index + b[0].length) + '\n' + (lines.length ? lines.join('\n') + '\n' : '') + text.slice(e);
}
export function build({ check = false } = {}, out = console.log) {
  const k = knowledge(), stale = [], big = [];
  for (const n of skillNames()) {
    const f = skillFile(n), t = fs.readFileSync(f, 'utf8'), nt = withRules(t, ruleLines(k, n));
    if (nt !== null && nt !== t) { stale.push(n); if (!check) fs.writeFileSync(f, nt); }
    if (Buffer.byteLength(nt ?? t) > MAX_SKILL) big.push(`${n} ${Buffer.byteLength(nt ?? t)} B`);
  }
  const orphans = k.rules.filter((r) => r.status === 'verified' && !skillNames().includes(r.skill)).map((r) => `${r.id} → ${r.skill}`);
  for (const x of orphans) out(`E rule ${x}: no such skill`);
  for (const x of big) out(`W ${x} (over ${MAX_SKILL} B: a skill is read whole; split it or retire rules)`);
  if (check) { if (stale.length) out(`E skills out of date with skills/knowledge.json: ${stale.join(' ')} (node lab.mjs skill build)`); else out(`OK skills match skills/knowledge.json (${skillNames().length} skills)`); return !stale.length && !orphans.length; }
  out(`OK skill build: ${stale.length ? `rewrote ${stale.join(' ')}` : 'nothing to change'} (${k.rules.filter((r) => r.status === 'verified').length} verified rules, ${k.rules.filter((r) => r.status === 'candidate').length} candidates)`);
  return !orphans.length;
}

export function list(out = console.log) {
  const k = knowledge();
  for (const n of skillNames()) {
    const { meta } = front(fs.readFileSync(skillFile(n), 'utf8'));
    const v = k.rules.filter((r) => r.skill === n && r.status === 'verified').length, c = k.rules.filter((r) => r.skill === n && r.status === 'candidate').length;
    out(`${n.padEnd(18)} ${String(meta.description ?? '').split('. ')[0].slice(0, 110)}${v || c ? ` [${v} rules${c ? `, ${c} candidates` : ''}]` : ''}${forge.statusOf(n) === 'draft' ? ' [draft]' : ''}`);
  }
  out('read one: node lab.mjs skill <name> · which one: skill route "<request>" · how they grow: node lab.mjs help skills');
  return true;
}

// ---------- install: the same skills, in the form each AI reads ----------
const MARK0 = '<!-- bds-lab skills: begin (node lab.mjs skill install) -->', MARK1 = '<!-- bds-lab skills: end -->';
function routingBlock(lab, names = skillNames()) {
  const rows = names.map((n) => { const { meta } = front(fs.readFileSync(skillFile(n), 'utf8')); return `- \`${n}\`: ${String(meta.description ?? '').split('. ')[0]}`; });
  return `${MARK0}\n## Minecraft Bedrock addon skills (bds-lab)\nBefore Bedrock addon / BDS work, read the ONE skill that fits: \`node ${path.join(lab, 'lab.mjs')} skill <name>\` (or open ${path.join(lab, 'skills', '<name>', 'SKILL.md')}); unsure which: \`node ${path.join(lab, 'lab.mjs')} skill route "<the request>"\`.\n${rows.join('\n')}\n${MARK1}\n`;
}
function upsertBlock(file, block) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const i = old.indexOf(MARK0), j = old.indexOf(MARK1);
  const next = i >= 0 && j > i ? old.slice(0, i) + block.trimEnd() + old.slice(j + MARK1.length) : (old ? old.replace(/\n*$/, '\n\n') : '') + block;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
}
// where each AI looks for SKILL.md folders (project, home); a routing block also goes where an AI reads always-on instructions
const TARGETS = {
  claude: { dir: ['.claude/skills', '.claude/skills'] },
  codex: { dir: ['.agents/skills', '.agents/skills'] },                       // Codex reads .agents/skills (repo and ~)
  gemini: { dir: ['.gemini/skills', '.gemini/skills'], block: ['GEMINI.md', '.gemini/GEMINI.md'] },
  copilot: { dir: ['.github/skills', '.copilot/skills'], block: ['.github/copilot-instructions.md', null] },
  cursor: { dir: ['.cursor/skills', '.cursor/skills'] },
  agents: { dir: ['.agents/skills', '.agents/skills'], block: ['AGENTS.md', null] },   // the vendor-neutral folder + AGENTS.md
  // more agents that read SKILL.md folders (paths as the cross-agent installers list them, 2026; most also read .agents/skills)
  windsurf: { dir: ['.windsurf/skills', '.codeium/windsurf/skills'] },
  cline: { dir: ['.cline/skills', '.cline/skills'] },
  roo: { dir: ['.roo/skills', '.roo/skills'] },
  kiro: { dir: ['.kiro/skills', '.kiro/skills'] },
  opencode: { dir: ['.opencode/skills', '.config/opencode/skills'] },
  aider: { block: ['CONVENTIONS.md', null] },   // no skill folders: the routing block in CONVENTIONS.md (aider --read CONVENTIONS.md)
};
export function install(args, out = console.log) {
  const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--to');
  const which = pos[0] === 'all' ? Object.keys(TARGETS) : pos;
  const ti = args.indexOf('--to'), global = args.includes('--global'), drafts = args.includes('--drafts');
  const to = path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), ti >= 0 ? args[ti + 1] : '.');
  const home = process.env.LAB_HOME_DIR ?? os.homedir();
  if (!which.length || which.some((w) => !TARGETS[w])) { out(`usage: node lab.mjs skill install <${Object.keys(TARGETS).join('|')}|all> [--to <project>] [--global] [--drafts]`); return false; }
  const g = forge.grades(), names = skillNames().filter((n) => g.skills?.[n]?.scope !== 'lab' && (drafts || g.skills?.[n]?.status !== 'draft'));
  const skipped = skillNames().filter((n) => !names.includes(n));
  const done = [], bases = new Map();   // codex and agents share .agents/skills: one write, with the part for each AI that reads it
  for (const w of which) { const t = TARGETS[w]; if (!t.dir) continue; const base = global ? path.join(home, t.dir[1]) : path.join(to, t.dir[0]); bases.set(base, [...(bases.get(base) ?? []), w]); }
  for (const [base, ais] of bases) {
    for (const n of names) {
      const d = path.join(base, n), ov = ais.map((w) => [w, forge.overlay(n, w)]).filter(([, x]) => x);
      fs.mkdirSync(d, { recursive: true });
      // the shared SKILL.md with the <!-- only:<ai> --> parts of the AIs that read this folder, plus skills/<name>/ai/<ai>.md:
      // one source, a form per AI
      const raw = fs.readFileSync(skillFile(n), 'utf8'), mine = raw.replace(/<!-- only:([\w,-]+) -->\n?([\s\S]*?)<!-- \/only -->\n?/g, (_, who, body) => (who.split(',').some((x) => ais.includes(x)) ? body : ''));
      fs.writeFileSync(path.join(d, 'SKILL.md'), mine.trimEnd() + '\n' + ov.map(([w, x]) => `\n## Only for ${w}\n${x}\n`).join(''));
    }
    done.push(base);
  }
  for (const w of which) {
    const t = TARGETS[w], bf = t.block && (global ? t.block[1] && path.join(home, t.block[1]) : path.join(to, t.block[0]));
    if (bf) { upsertBlock(bf, routingBlock(TOP, names)); done.push(bf); }
  }
  for (const d of [...new Set(done)]) out(`OK ${d}`);
  out(`(${names.length} skills${skipped.length ? `; not installed: ${skipped.join(' ')} (draft or lab-only; --drafts adds drafts)` : ''}; run again after skill build / learn / promote / refine to refresh)`);
  return true;
}

// ---------- verify: re-run the evidence ----------
function runLab(args, env = {}) { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', env: { ...process.env, LAB_NOTRACE: '1', ...env }, timeout: 900000 }); return { ok: r.status === 0, text: (r.stdout ?? '') + (r.stderr ?? '') }; }
function bdsVersion() { try { return fs.readFileSync(path.join(TOP, 'bds', 'vendor', 'bds-version.txt'), 'utf8').trim(); } catch { return '?'; } }
export function verifyOne(r, out = console.log) {
  const ev = r.evidence ?? {};
  if (ev.kind === 'probe') {
    const src = path.join(TOP, ev.ref), name = `zz_probe_${r.id.replace(/[^a-z0-9]+/g, '_')}`, unit = path.join(TOP, 'bds', 'addons', name);
    if (!fs.existsSync(src)) return { ok: false, why: `no probe ${ev.ref}` };
    const cur = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(cur) ? fs.readFileSync(cur, 'utf8') : null;
    fs.rmSync(unit, { recursive: true, force: true }); fs.cpSync(src, unit, { recursive: true });
    try {
      runLab(['bds', 'mode', 'stable', '-a', name]);
      const t = runLab(['bds', 'test', '-a', name]);
      return { ok: t.ok && /^PASS /m.test(t.text), why: t.ok ? '' : t.text.split('\n').filter((l) => /^(✘|  want|  got|E )/.test(l)).slice(0, 4).join(' | ') };
    } finally { fs.rmSync(unit, { recursive: true, force: true }); if (cur0 === null) fs.rmSync(cur, { force: true }); else fs.writeFileSync(cur, cur0); }
  }
  if (ev.kind === 'unit') {
    // a unit of the lab (bds/addons/x, end/plugins/x, ll/mods/x) whose tests.txt passes on the real server: the pattern works
    const [kind, , name] = String(ev.ref).split('/');
    if (!['bds', 'end', 'll'].includes(kind) || !name || !fs.existsSync(path.join(TOP, ev.ref, 'tests.txt'))) return { ok: false, why: `no unit ${ev.ref}` };
    if (kind === 'll' && !process.env.LAB_SKILL_SLOW) return { ok: true, skipped: 'LeviLamina unit (Wine, minutes): LAB_SKILL_SLOW=1 runs it' };
    const t = runLab([kind, 'test', '-a', name]);
    return { ok: t.ok && /^PASS /m.test(t.text), why: t.ok ? '' : t.text.split('\n').filter((l) => /^(✘|  want|  got|E )/.test(l)).slice(0, 4).join(' | ') };
  }
  if (ev.kind === 'test') {
    const f = path.join(TOP, ev.ref);
    if (!fs.existsSync(f)) return { ok: false, why: `no test ${ev.ref}` };
    if (/dev-bds\.mjs$/.test(ev.ref) && !process.env.LAB_SKILL_SLOW) return { ok: true, skipped: 'real-server suite (15 min): LAB_SKILL_SLOW=1 runs it' };
    const t = spawnSync(process.execPath, [f], { cwd: TOP, encoding: 'utf8', timeout: 1800000 });
    return { ok: t.status === 0, why: t.status === 0 ? '' : ((t.stdout ?? '') + (t.stderr ?? '')).split('\n').filter((l) => /^✘/.test(l)).slice(0, 3).join(' | ') };
  }
  return { ok: true, skipped: `${ev.kind ?? 'no'} evidence: nothing to re-run (a probe would make it re-checkable)` };
}
export function verify(args, out = console.log) {
  const k = knowledge(), want = args.find((a) => !a.startsWith('--')) ?? 'all', at = new Date().toISOString().slice(0, 10), bv = bdsVersion();
  const rs = k.rules.filter((r) => r.status !== 'retired' && (want === 'all' ? true : r.id === want || r.skill === want || r.evidence?.kind === want));
  if (!rs.length) { out(`ERR skill verify: no rule "${want}"`); return false; }
  let bad = 0, n = 0;
  const testRuns = new Map();   // one run per offline test file or unit, however many rules it backs
  for (const r of rs) {
    const key = ['test', 'unit'].includes(r.evidence?.kind) ? r.evidence.kind + ':' + r.evidence.ref : null;
    const res = key && testRuns.has(key) ? testRuns.get(key) : verifyOne(r, out);
    if (key) testRuns.set(key, res);
    if (res.skipped) { out(`- ${r.id}: ${res.skipped}`); continue; }
    n++;
    r.verified = { bds: bv, at, ok: res.ok };
    if (res.ok) { if (r.status === 'disputed') r.status = 'verified'; out(`✔ ${r.id}`); }
    else { bad++; if (r.status === 'verified') r.status = 'disputed'; out(`✘ ${r.id}: ${res.why || 'its evidence failed'} (status disputed: the real server disagrees; fix the rule or its evidence, then skill verify ${r.id})`); }
  }
  saveKnow(k);
  build({}, () => {});
  out(`${bad ? 'FAIL' : 'PASS'} skill verify: ${n - bad}/${n} on BDS ${bv}${bad ? ' (disputed rules leave SKILL.md until fixed)' : ''}`);
  return !bad;
}

// ---------- learn: candidates from experience (no tokens) ----------
const norm = (s) => String(s).replace(/\(during: .*\)$/, '').replace(/(src|bp\/scripts)\/[\w./-]+:\d+/g, '<file:line>').replace(/[\w./-]+\.[cm]?[jt]s:\d+/g, '<file:line>').replace(/'[^']*'|"[^"]*"/g, '<x>').replace(/\b\d+(\.\d+)?\b/g, 'N').replace(/\s+/g, ' ').trim();
export function episodes() {
  const res = [];
  const fs0 = process.env.LAB_EPISODES ? process.env.LAB_EPISODES.split(path.delimiter).map((f) => [path.basename(path.dirname(f)), f]) : ['bds', 'end', 'll'].map((k) => [k, path.join(TOP, k, '.lab', 'episodes.jsonl')]);
  for (const [k, f] of fs0) { try { for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l.trim()) try { res.push({ lab: k, ...JSON.parse(l) }); } catch { /* a torn line */ } } catch { /* none */ } }
  return res;
}
const skillOf = (sig) => (/\b(mc\.listen|mc\.newCommand|LeviLamina|lse\b)/.test(sig) ? 'levilamina-mod' : /^✘/.test(sig) ? 'bds-tests' : /form|selection|formValues/i.test(sig) ? 'bds-forms' : /py:|Traceback|endstone/i.test(sig) ? 'endstone-plugin' : /recipe|loot|component|texture|manifest|schema/i.test(sig) ? 'bds-content' : 'bds-script-api');
const safeRe = (x) => { try { return new RegExp(x, 'i'); } catch { return null; } };
const val = (args, key, d) => { const i = args.indexOf(key); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
// another project's skills (SKILL.md lines, data/rules.json, data/failure-modes.json) → source candidates: the lab reads
// what a good skill repo learned, keeps only hard rules it does not have yet, and they still need proof to enter a skill
const words = (x) => new Set(String(x).toLowerCase().replace(/[`*_"'()[\]]/g, ' ').split(/[^a-z0-9#@.$-]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length > 3));
const similar = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); };
const skillFor = (t, ref = '') => (/model/i.test(ref) && !/json-?ui|mcbe-ui/i.test(ref) ? 'bds-models' : /json-?ui|mcbe-ui/i.test(ref) ? 'bds-json-ui' : /\b(geo|geometry|cube|bone|uv|pivot|blockbench|z-?fight|texel|animation|attachable|render)/i.test(t) ? 'bds-models' : /\b(json ui|jsonui|_ui_defs|binding|namespace|server_form|hud|screen|anchor|stack_panel|factory)/i.test(t) ? 'bds-json-ui' : skillOf(t));
/** a folder, or a GitHub repo (cloned once into .lab/skill-sources/<name>, pulled after) */
export function sourceDir(from) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(from)) return path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), from);
  const url = from.replace(/\/+$/, '').replace(/\.git$/, ''), [owner, repo] = url.split('/').slice(-2), d = path.join(TOP, '.lab', 'skill-sources', repo === 'skills' ? `${owner}-skills` : repo);   // (anthropics/skills → anthropics-skills)
  if (fs.existsSync(path.join(d, '.git'))) spawnSync('git', ['pull', '-q', '--ff-only'], { cwd: d, timeout: 120000 });
  else { fs.mkdirSync(path.dirname(d), { recursive: true }); spawnSync('git', ['clone', '-q', '--depth', '1', url + '.git', d], { timeout: 300000 }); }
  return d;
}
export function mine(dir, k, already = [], max = 40) {
  const root = sourceDir(dir), name = path.basename(root), found = [];
  if (!fs.existsSync(root)) return [];
  const walk = (d, acc = []) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return acc; } for (const e of es) { if (/^(\.git|node_modules)$/.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, acc); else acc.push(p); } return acc; };
  const clean = (x) => String(x).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  for (const f of walk(root)) {
    const r = path.relative(root, f).split(path.sep).join('/');
    if (/(^|\/)SKILL\.md$/.test(r)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = /^\s*(?:[-*]|\d+\.)\s+(.{30,300})$/.exec(l); if (m) found.push({ rule: clean(m[1]), why: '', ref: `${name}/${r}` }); }
    if (/(^|\/)data\/rules\.json$/.test(r)) for (const x of readJ(f, {}).rules ?? []) if (x.rule) found.push({ rule: clean(x.rule), why: '', ref: `${name}/${r}#${x.id ?? ''}` });
    if (/(^|\/)data\/failure-modes\.json$/.test(r)) for (const x of readJ(f, {}).failure_modes ?? []) if (x.cure) found.push({ rule: clean(`${x.cure}`), why: clean(`${x.symptom ?? ''}${x.cause ? ': ' + x.cause : ''}`).slice(0, 160), ref: `${name}/${r}#${x.id ?? ''}` });
  }
  // hard rules first (never / always / must / do not / no X), the ones a model breaks; skip what the lab already knows
  const hard = (x) => /\b(never|always|must|do not|don't|only|no two|not a)\b/i.test(x.rule);
  const known = [...k.rules, ...already].map((r) => r.rule);
  const out = [];
  for (const x of [...found.filter(hard), ...found.filter((y) => !hard(y))]) {
    if (out.length >= max) break;
    if (/^(read|see|open|use this|run) /i.test(x.rule) && !hard(x)) continue;   // routing, not know-how
    if (!/^[A-Z`"]/.test(x.rule) || /[?:]$/.test(x.rule) || /`docs\//.test(x.rule)) continue;   // a fragment (a line that continues the one above it)
    if (/\]\(|\btools\/|\breferences\/|\bspec\[|`[^`]*[=(][^`]*`/.test(x.rule)) continue;   // tied to that repo's own tools and files
    if ([...known, ...out.map((y) => y.rule)].some((y) => similar(x.rule, y) > 0.45)) continue;
    const id = 'src-' + crypto.createHash('sha1').update(norm(x.rule)).digest('hex').slice(0, 8);
    if (k.rules.some((r) => r.id === id)) continue;
    out.push({ id, skill: skillFor(x.rule, x.ref), rule: x.rule, why: x.why, evidence: { kind: 'source', ref: x.ref }, status: 'candidate', added: new Date().toISOString().slice(0, 10) });
  }
  return out;
}
export function learn(args, out = console.log) {
  const k = knowledge(), eps = episodes(), have = new Set(k.rules.map((r) => r.id)), from = val(args, '--from', null);
  const by = new Map();
  for (const e of eps) for (const s of e.fixed ?? []) { const key = norm(s.sig); const g = by.get(key) ?? by.set(key, { sig: s.sig, hints: new Set(), units: new Set(), n: 0 }).get(key); g.n++; g.units.add(`${e.lab}/${e.unit}`); for (const h of s.hints ?? []) g.hints.add(h); }
  const fresh = [];
  for (const [key, g] of by) {
    // known already: a rule whose "when missed" text matches this failure
    if (k.rules.some((r) => (r.why && norm(r.why).length > 8 && (key.includes(norm(r.why)) || norm(r.why).includes(key))) || (r.match && safeRe(r.match)?.test(g.sig)))) continue;
    if (g.n < 2 && !g.hints.size) continue;   // once and with no hint: not a pattern yet
    const id = 'cand-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
    if (have.has(id)) { const r = k.rules.find((x) => x.id === id); r.evidence = { ...r.evidence, n: g.n, units: [...g.units].slice(0, 8) }; continue; }
    const hint = [...g.hints][0];
    fresh.push({ id, skill: skillOf(g.sig), rule: hint ? hint.replace(/^\s*(fix|hint):\s*/, '') : `(write the rule) seen ${g.n}× and fixed: ${g.sig.slice(0, 120)}`, why: g.sig.slice(0, 160), evidence: { kind: 'episodes', n: g.n, units: [...g.units].slice(0, 8) }, status: 'candidate', added: new Date().toISOString().slice(0, 10) });
  }
  // the autopilot's own lessons (written from its failures)
  try { for (const l of fs.readFileSync(process.env.LAB_LESSONS ?? path.join(TOP, 'auto', 'LESSONS.md'), 'utf8').split('\n')) { const m = /^-\s+(.{12,})$/.exec(l.trim()); if (!m) continue; const id = 'cand-' + crypto.createHash('sha1').update(norm(m[1])).digest('hex').slice(0, 8); if (!have.has(id) && !fresh.some((x) => x.id === id)) fresh.push({ id, skill: skillOf(m[1]), rule: m[1], why: '', evidence: { kind: 'lesson', ref: 'auto/LESSONS.md' }, status: 'candidate', added: new Date().toISOString().slice(0, 10) }); } } catch { /* none */ }
  // misses: a rule exists, and its failure still happened (and got fixed) in a unit: reading it up front did not prevent it.
  // Counted from every episode each time (not added up), so learn can run any number of times
  for (const r of k.rules) {
    const re = r.match && safeRe(r.match); if (!re) continue;
    const hit = []; for (const e of eps) for (const x of e.fixed ?? []) if (re.test(x.sig)) hit.push(`${e.lab}/${e.unit}`);
    if (hit.length) r.misses = { n: hit.length, units: [...new Set(hit)].slice(0, 8) }; else delete r.misses;
  }
  if (from) {
    const root = sourceDir(from);
    if (!fs.existsSync(root)) { out(`ERR skill learn --from ${from}: not found (a folder here, or https://github.com/<owner>/<repo>; a clone needs the network)`); return false; }
    fresh.push(...mine(root, k, fresh, Number(val(args, '--max', 40))));
  }
  k.rules.push(...fresh);
  saveKnow(k);
  for (const c of fresh) out(`+ ${c.id} [${c.skill}] ${c.rule.slice(0, 140)}${c.evidence.kind === 'source' ? ` (${c.evidence.ref})` : ''}`);
  for (const r of k.rules.filter((x) => x.status === 'verified' && (x.misses?.n ?? 0) >= 3 && x.misses.units.length >= 2)) out(`! ${r.id}: its failure still happened ${r.misses.n}× in ${r.misses.units.length} units: the rule alone does not prevent it; make it a check (an E/Q line before the server runs) or rewrite it`);
  const cands = k.rules.filter((r) => r.status === 'candidate');
  out(`OK skill learn: ${eps.length} episode(s), ${fresh.length} new candidate(s), ${cands.length} waiting${cands.length ? ': prove one with a probe (skills/probes/<id>: an addon + tests.txt) or a test, then skill promote <id> --evidence ...; or skill retire <id> "<why>"' : ''}`);
  return true;
}

// ---------- growth: how far the know-how has come and the next rung for each part of it ----------
// The ladder every rule climbs: seen (episode / lesson / another repo) → candidate → verified with evidence → re-run here
// (test or probe, re-checked on each new Minecraft) → enforced (its failure no longer happens: no misses). Each rung down
// the list is a next step; the log in knowledge.json shows the generations.
export function growth(args, out = console.log) {
  const k = knowledge(), c = counts(k), log = k.log ?? [], first = log[0], eps = episodes();
  const d = (x) => (first && first[x] !== undefined && c[x] !== first[x] ? ` (${c[x] - first[x] >= 0 ? '+' : ''}${c[x] - first[x]} since gen 1, ${first.at})` : '');
  out(`skills generation ${log.at(-1)?.gen ?? 0}: ${skillNames().length} skills, ${c.verified} rules${d('verified')}`);
  out('  L1 rules (seen → candidate → verified → re-run here → no misses):');
  out(`  proof: ${c.rerun} re-run here (test/probe)${d('rerun')} · ${c.measured} measured once · ${c.source} from reference projects [source]${c.verified ? ` · ${Math.round((c.rerun / c.verified) * 100)}% re-checkable` : ''}`);
  out(`  waiting: ${c.candidate} candidates · ${c.disputed} disputed · ${c.retired} retired`);
  const units = new Set(eps.map((e) => `${e.lab}/${e.unit}`)), fixes = eps.reduce((s, e) => s + (e.fixed?.length ?? 0), 0);
  if (eps.length) {
    // fixes per unit, older half vs newer half of the episodes: fewer failures to fix per unit = the skills prevent more
    const half = Math.floor(eps.length / 2), per = (xs) => { const u = new Set(xs.map((e) => `${e.lab}/${e.unit}`)).size; return u ? xs.reduce((s, e) => s + (e.fixed?.length ?? 0), 0) / u : 0; };
    out(`  experience: ${eps.length} episodes, ${fixes} failures fixed in ${units.size} units${half >= 2 ? ` · per unit ${per(eps.slice(0, half)).toFixed(1)} → ${per(eps.slice(half)).toFixed(1)} (older → newer half)` : ''}`);
  } else out('  experience: no episodes yet (every test/go records what the last edit fixed)');
  const sc = scratch.growthLine(); out(sc.line);   // practice from nothing: lessons with hidden tests (scratch next)
  const h = readJ(HIST, []).at(-1);
  out(`  selection: ${h ? `last bench ${String(h.at ?? '?').slice(0, 10)} ${h.keep === false ? 'WORSE' : h.keep ? 'KEEP' : 'UNSURE'}: ${h.why}` : 'never benched (skill bench --via <ai>: with vs without skills, hidden tests decide)'}`);
  const next = [];
  const missed = k.rules.filter((r) => r.status === 'verified' && (r.misses?.n ?? 0) >= 3).sort((a, b) => b.misses.n - a.misses.n);
  for (const r of missed.slice(0, 2)) next.push(`${r.id} missed ${r.misses.n}×: make it a check (E/Q before the server runs) or rewrite it`);
  for (const r of k.rules.filter((x) => x.status === 'disputed').slice(0, 2)) next.push(`${r.id} disputed: fix the rule or its probe, skill verify ${r.id}`);
  const head = next.length;   // what is broken (missed, disputed) first, then the skills layer, then what waits
  const cands = k.rules.filter((x) => x.status === 'candidate'); if (cands.length) next.push(`${cands.length} candidates: prove one (probe or test) and skill promote <id> --evidence ...; or retire it`);
  const src = k.rules.filter((x) => x.status === 'verified' && x.evidence?.kind === 'source'); if (src.length) next.push(`${src.length} [source] rules: a test or probe for one makes it re-checkable here (${src.slice(0, 3).map((r) => r.id).join(' ')})`);
  if (!h) next.push('skill bench: measure whether the skills make AI builds better');
  if (sc.next) next.push(sc.next);
  if (log.length > 1) out(`  history: ${log.slice(-6).map((x) => `gen ${x.gen} ${x.at} ${x.verified}r/${x.rerun}p/${x.candidate}c`).join(' · ')}`);
  // the layers above the rules: the skills as prompts (grade, routing, refinements, use) and the rubric that judges them
  const L = forge.growthLines(readJ(HIST, []));
  for (const l of L.lines) out(l);
  next.splice(head, 0, ...L.next.slice(0, 2));
  next.slice(0, 6).forEach((x, i) => out(`${i ? '      ' : '  next: '}${x}`));
  return true;
}
// note: what surprised the AI while it worked, one line, into auto/LESSONS.md: skill learn makes it a candidate (proof decides)
export function note(args, out = console.log) {
  const t = args.join(' ').replace(/\s+/g, ' ').trim();
  if (t.length < 12) { out('usage: node lab.mjs skill note "<what you learned that a skill should have said: one line, what to do>"'); return false; }
  const f = process.env.LAB_LESSONS ?? path.join(TOP, 'auto', 'LESSONS.md');
  const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# Lessons\n';
  if (old.split('\n').some((l) => l.trim() === `- ${t}`)) { out('OK skill note: already noted'); return true; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, old.replace(/\n*$/, '\n') + `- ${t}\n`);
  out(`OK skill note: ${path.relative(TOP, f)} (skill learn turns it into a candidate; a test or probe makes it a rule)`);
  return true;
}
export function promote(args, out = console.log) {
  const [id] = args.filter((a, j) => !a.startsWith('--') && args[j - 1] !== '--evidence'), i = args.indexOf('--evidence'), k = knowledge(), r = k.rules.find((x) => x.id === id);
  if (!id) { out('usage: node lab.mjs skill promote <rule id> [--evidence test:<file>|probe:<dir>|unit:<lab/kind/name>|measured:"<what>"|source:<url>]'); return false; }
  if (!r) { out(`ERR no rule ${id} (candidates: node lab.mjs skill growth)`); return false; }
  if (i >= 0) { const [kind, ...ref] = String(args[i + 1] ?? '').split(':'); r.evidence = { kind, ref: ref.join(':') }; }
  if (!EVIDENCE.includes(r.evidence?.kind)) { out(`ERR ${id}: a rule needs evidence first: --evidence test:<tests/x.mjs> | probe:<skills/probes/dir> | unit:<bds/addons/x> | measured:"<what, where>" | source:<repo url + file> (a reference project's finding: shown as [source] until a test or probe proves it here)`); return false; }
  if (/^\(write the rule\)/.test(r.rule)) { out(`ERR ${id}: write the rule first (one line in skills/knowledge.json: what to do, not what happened)`); return false; }
  r.status = 'verified'; r.promoted = new Date().toISOString().slice(0, 10);
  saveKnow(k); build({}, () => {});
  out(`OK ${id} verified → ${r.skill}${r.evidence.kind === 'probe' ? ` (skill verify ${id} runs its probe)` : ''}`);
  return true;
}
export function retire(args, out = console.log) {
  const [id, ...why] = args.filter((a) => !a.startsWith('--')), k = knowledge(), r = k.rules.find((x) => x.id === id);
  if (!id) { out('usage: node lab.mjs skill retire <rule id> "<why>"'); return false; }
  if (!r) { out(`ERR no rule ${id}`); return false; }
  r.status = 'retired'; r.retired = { at: new Date().toISOString().slice(0, 10), why: why.join(' ') || '(no reason given)' };
  saveKnow(k); build({}, () => {});
  out(`OK ${id} retired`);
  return true;
}

// ---------- bench: does a skills version make builds better? (A/B over the bench tasks, hidden tests decide pass) ----------
export function skillsHash() { const h = crypto.createHash('sha1'); for (const n of skillNames()) h.update(fs.readFileSync(skillFile(n))); return h.digest('hex').slice(0, 10); }
export function summarize(rows) {
  const n = rows.length, pass = rows.filter((r) => r.pass).length;
  const avg = (k) => (n ? Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) / n) : 0);
  return { runs: n, pass, tokens: avg('tokens'), steps: avg('steps') };
}
/** keep a skills version when it passes no fewer tasks and does not cost more than 10% more tokens */
export function verdict(on, off) {
  if (!on.runs || !off.runs) return { keep: null, why: 'not enough runs' };
  if (on.pass < off.pass) return { keep: false, why: `fewer passes with skills (${on.pass} < ${off.pass})` };
  if (on.pass > off.pass) return { keep: true, why: `more passes with skills (${on.pass} > ${off.pass})` };
  if (on.tokens > off.tokens * 1.1) return { keep: false, why: `same passes, ${Math.round((on.tokens / off.tokens - 1) * 100)}% more tokens with skills` };
  const d = off.tokens ? Math.round((on.tokens / off.tokens - 1) * 100) : 0;
  return { keep: true, why: d > 0 ? `same passes, ${d}% more tokens with skills (within 10%)` : `same passes, ${-d}% fewer tokens with skills` };
}
// one run of bds/bench/bench.mjs in its own process group: a timeout or a Ctrl-C ends the AI CLI, `go` and the BDS under it
// too (a plain spawnSync timeout killed only bench.mjs and left them running, spending tokens)
function runGroup(file, args, opt, ms) {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const c = spawn(file, args, { ...opt, detached: !win, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let text = '';
    c.stdout.on('data', (b) => { text += b; }); c.stderr.on('data', (b) => { text += b; });
    const kill = () => { try { if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F']); else process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } };
    const t = setTimeout(kill, ms), onSig = () => { kill(); process.exit(130); };
    process.once('SIGINT', onSig); process.once('SIGTERM', onSig);
    c.on('close', (code) => { clearTimeout(t); process.off('SIGINT', onSig); process.off('SIGTERM', onSig); resolve({ status: code, stdout: text, stderr: '' }); });
    c.on('error', (e) => { clearTimeout(t); resolve({ status: 1, stdout: text, stderr: String(e.message) }); });
  });
}
const BENCH_USAGE = 'usage: node lab.mjs skill bench --via <claude|codex|gemini|anthropic|openai> [--tasks ruby,kills,lamp] [--runs n] [--without <skill>]\n  spends AI tokens: every task is built twice per run (with the skills and without), so --via is required';
export async function bench(args, out = console.log) {
  const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (args.includes('--help') || args.includes('-h')) { out(BENCH_USAGE); return true; }
  const cmd = process.env.LAB_SKILL_BENCH_CMD;   // (tests: a stand-in for `node bds/bench/bench.mjs run <task> --via <via>`)
  // it spends tokens: never by default (an AI that typed `skill bench` to see what it does started a paid run)
  const via = val('--via', cmd ? 'test' : null);
  if (!via || via.startsWith('--')) { out(BENCH_USAGE); return false; }
  const runs = Number(val('--runs', 1)), tasks = String(val('--tasks', 'ruby,kills,lamp')).split(',').filter(Boolean), without = val('--without', null);
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) { out(`ERR --runs ${val('--runs')}: a whole number 1-20`); return false; }
  let known = null; try { const t = JSON.parse(fs.readFileSync(path.join(TOP, 'bds', 'bench', 'tasks.json'), 'utf8')); known = Object.keys(t.tasks ?? t); } catch { /* no bench here */ }
  const unknown = known ? tasks.filter((t) => !known.includes(t)) : [];
  if (!tasks.length || unknown.length) { out(`ERR --tasks: unknown ${unknown.join(',') || '(none given)'} (tasks: ${known?.join(' ') ?? '?'})`); return false; }
  if (without && !skillNames().includes(without)) { out(`ERR skill bench --without ${without}: no such skill`); return false; }
  const OFF = without ? `without:${without}` : 'off';   // A/B: all skills vs none, or vs all but one (does that one skill earn its tokens?)
  const one = async (task, skills) => {
    const r = cmd ? spawnSync(cmd, [task, skills], { shell: true, encoding: 'utf8', env: { ...process.env, LAB_SKILLS: skills } })
      : await runGroup(process.execPath, [path.join(TOP, 'bds', 'bench', 'bench.mjs'), 'run', task, '--via', via], { cwd: TOP, env: { ...process.env, LAB_SKILLS: skills } }, 3600000);
    const t = (r.stdout ?? '') + (r.stderr ?? '');
    const m = /RESULT (\{.*\})/.exec(t) ?? null;
    if (m) try { return JSON.parse(m[1]); } catch { /* below */ }
    return { pass: /\bPASS\b/.test(t) && !/\bFAIL\b/.test(t), tokens: Number(/tokens[ =:]+(\d+)/.exec(t)?.[1] ?? 0), steps: Number(/steps[ =:]+(\d+)/.exec(t)?.[1] ?? 0) };
  };
  const rows = { on: [], off: [] };
  for (let i = 0; i < runs; i++) for (const t of tasks) for (const s of ['on', 'off']) { const r = { task: t, ...(await one(t, s === 'off' ? OFF : 'on')) }; rows[s].push(r); out(`${s.padEnd(3)} ${t}: ${r.pass ? 'pass' : 'FAIL'} ${r.tokens} tokens ${r.steps} steps`); }
  const on = summarize(rows.on), off = summarize(rows.off), v = verdict(on, off);
  const h = readJ(HIST, []);
  let gm; try { const gl = forge.grades().log.at(-1); gm = gl?.mean; } catch { /* never graded */ }
  h.push({ at: new Date().toISOString(), skills: skillsHash(), via, tasks, on, off, keep: v.keep, why: v.why, bds: bdsVersion(), ...(without ? { without } : {}), ...(gm !== undefined ? { grade: gm } : {}) });
  fs.writeFileSync(HIST, JSON.stringify(h, null, 1) + '\n');
  if (without && v.keep) { const g = forge.grades(); if (g.skills?.[without]?.status === 'draft') { g.skills[without] = { ...g.skills[without], status: 'kept', kept: new Date().toISOString().slice(0, 10), by: `bench --without: ${v.why}` }; fs.writeFileSync(path.join(SK, 'grades.json'), JSON.stringify(g, null, 1) + '\n'); out(`${without}: draft → kept`); } }
  if (without && v.keep === false) out(`${without} makes builds worse: skill refine ${without}, or delete skills/${without}`);
  out(`${v.keep === false ? 'WORSE' : v.keep ? 'KEEP' : 'UNSURE'} skills ${skillsHash()}${without ? ` (with vs without ${without})` : ''}: ${v.why} (with: ${on.pass}/${on.runs} pass, ${on.tokens} tokens; without: ${off.pass}/${off.runs}, ${off.tokens}); skills/history.json${v.keep === false ? ' — undo the last skills change (git) or retire the rule that caused it' : ''}`);
  return v.keep !== false;
}

export async function skillCmd(args, out = console.log) {
  const [sub, ...rest] = args;
  if (!sub) return list(out);
  if (sub === 'build') return build({ check: rest.includes('--check') }, out);
  if (sub === 'install') return install(rest, out);
  if (sub === 'verify') return verify(rest, out);
  if (sub === 'learn') return learn(rest, out);
  if (sub === 'promote') return promote(rest, out);
  if (sub === 'retire') return retire(rest, out);
  if (sub === 'bench') return await bench(rest, out);
  if (sub === 'growth') return growth(rest, out);
  if (sub === 'note') return note(rest, out);
  if (sub === 'new') return forge.newSkill(rest, out);
  if (sub === 'grade') return forge.grade(rest, out);
  if (sub === 'route') return forge.route(rest, out);
  if (sub === 'compare') return evolve.compare(rest, out);
  if (sub === 'rubric') return evolve.rubricCmd(rest, out);
  if (sub === 'prompt') return evolve.prompt(rest, out);
  if (sub === 'refine') return rest.includes('--via') ? forge.refineAuto(rest, out) : forge.refine(rest, out);
  if (skillNames().includes(sub)) {
    // `skill a b`: several in one call (each call re-sends the conversation); the reader view (no front matter, markers or
    // ids); --raw: the file as it is; --for <ai>: that AI's parts too
    const i = rest.indexOf('--for'), ai = i >= 0 ? rest[i + 1] : null, names = [sub, ...rest.filter((x, j) => skillNames().includes(x) && rest[j - 1] !== '--for')];
    for (const n of names) { forge.noteRead(n); const t = fs.readFileSync(skillFile(n), 'utf8'); if (names.length > 1) out(`# skill ${n}`); out(rest.includes('--raw') ? forge.forAI(t, ai).trimEnd() : forge.readerView(t, ai)); }
    return true;
  }
  out(`ERR no skill "${sub}" (skills: ${skillNames().join(' ')}; or build | install | verify | learn | promote | retire | bench | growth | note | new | grade | route | refine | compare | rubric | prompt)`);
  return false;
}
