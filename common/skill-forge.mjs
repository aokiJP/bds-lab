// The skills themselves, not only their rules: write one from nothing, grade it against what makes a skill good (and against
// the reference skill collections), route a request to it, and refine it in a loop that keeps a change only when it measures
// better. Every step is deterministic and costs no tokens; only the AI's edit in between does.
//   skill new <name> "<description>"     a skill from the template (a draft until a bench keeps it; skill-forge says how)
//   skill grade [name|all] [--ref <dir|url>]... [--json]
//                                        0-2 per criterion of skills/rubric.json; --ref grades a reference collection with
//                                        the portable criteria and shows, for each criterion we score lower, its best line
//   skill route "<request>" [--eval]     the 1-3 skills to read for a request (any language); --eval: skills/routes.json
//   skill refine <name|weakest>          a brief: what to improve, how the best reference does it, misses, candidates
//   skill refine <name> --done           grade again: keep the edit only if nothing got worse (else put the old one back)
//   skill refine <name> --revert         put the snapshot back
// Why a gate: SkillsBench (arXiv 2602.12670) measured skills a model writes for itself at -1.3pp on average (curated
// ones +16.2pp). So a skill the AI writes here is a draft until its grade, its routing and a bench say it helps.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SK, knowledge, skillNames, front, episodes, sourceDir, ruleLines } from './skills.mjs';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const RUBRIC = () => readJ(path.join(SK, 'rubric.json'), { criteria: [] });
const GRADES = () => path.join(SK, 'grades.json');
const ROUTES = () => path.join(SK, 'routes.json');
const MAX = 3200, MIN = 500;
const skillFile = (n, dir = SK) => path.join(dir, n, 'SKILL.md');
const val = (args, key, d) => { const i = args.indexOf(key); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const vals = (args, key) => args.flatMap((a, i) => (a === key && args[i + 1] !== undefined ? [args[i + 1]] : []));
const pct = (x) => `${Math.round(x * 100)}%`;
const cut = (x, n) => (String(x).length > n ? String(x).slice(0, n) + '…' : String(x));
const today = () => new Date().toISOString().slice(0, 10);
const LABDIR = () => (process.env.LAB_STATE_DIR ? path.resolve(process.env.LAB_STATE_DIR) : path.join(TOP, '.lab'));   // (tests: elsewhere)

// ---------- words: English words and CJK bigrams (so a Japanese request finds an English skill through triggers.txt) ----------
const STOP = new Set('the a an and or of to in on for with is are be it its this that as at by from use when what how do not no any all one each your you they their them then than into only can will must should if else so but our we us me my have has was were been also more most such which who whose there here these those via per out up off over under after before about write make want need like please tell help short long good'.split(' '));   // (request filler: 'write a poem' is no skill's word)
const stem = (w) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w);
export function tokens(s) {
  const t = String(s).toLowerCase(), out = [];
  for (const w of t.match(/[a-z0-9][a-z0-9_.:/-]*[a-z0-9]|[a-z0-9]/g) ?? []) for (const p of w.split(/[._:/-]+/)) if (p.length >= 2 && !STOP.has(p)) out.push(stem(p));
  // Japanese: a katakana run is one word (ログイン and ダイアログ share no piece), a kanji run is a word plus its pairs
  // (釣り大会 → 大会), hiragana is grammar and left out
  for (const run of t.match(/[゠-ヿｦ-ﾟ]{2,}|[㐀-鿿豈-﫿々]+/g) ?? []) {
    out.push(run);
    if (/^[㐀-鿿]/.test(run) && run.length >= 3) for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}
const wordSet = (s) => new Set(tokens(s).filter((w) => w.length > 3 || /[^\x00-\x7f]/.test(w)));

// ---------- one SKILL.md for every AI: a part only one AI needs sits in <!-- only:claude,codex -->…<!-- /only --> ----------
// forAI(text, 'claude') keeps Claude's parts (markers removed) and drops the others; forAI(text) is the portable view every AI
// shares (all such parts dropped): the grade, the router and `skill <name>` read that one
export const AIS = ['claude', 'codex', 'gemini', 'copilot', 'cursor', 'windsurf', 'cline', 'roo', 'kiro', 'opencode', 'aider', 'agents', 'chatgpt'];
export function forAI(text, ai = null) {
  return String(text).replace(/[ \t]*<!-- only:([\w,-]+) -->\n?([\s\S]*?)<!-- \/only -->[ \t]*\n?/g, (_, who, body) => (ai && who.split(',').includes(ai) ? body : ''));
}
/** what an AI reads when the lab prints a skill: no front matter (the router already matched the description), no build
 *  markers, no rule ids (the just-in-time `rule:` line under a failure names the id), one AI's parts for that AI only.
 *  The file on disk stays the full portable SKILL.md (installs and other AIs read that). */
let ENTRY = null;
function entryRules() {   // rules AGENTS.md already says (knowledge.json `entry`: a phrase still found in AGENTS.md)
  if (ENTRY) return ENTRY;
  let ag = ''; try { ag = fs.readFileSync(path.join(TOP, 'AGENTS.md'), 'utf8'); } catch { /* none */ }
  return (ENTRY = new Set(knowledge().rules.filter((r) => r.entry && ag.includes(r.entry)).map((r) => r.id)));
}
export function readerView(text, ai = null) {
  const E = entryRules();
  return forAI(text, ai).split('\n').filter((l) => { const m = / `([a-z0-9-]+)`( \[source\])?$/.exec(l); return !(m && /^- /.test(l) && E.has(m[1])); }).join('\n').replace(/^---\n[\s\S]*?\n---\n+/, '').replace(/^<!--[^\n]*?-->[ \t]*\n?/gm, '').replace(/ `[a-z0-9]+(-[a-z0-9]+)+`(?=( \[source\])?$)/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
// ---------- reading a collection of skills (ours, or a reference repository's) ----------
export function collection(dir) {
  const res = [];
  const walk = (d, depth = 0) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (/^(\.git|node_modules|\.lab)$/.test(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory() && depth < 4) walk(p, depth + 1); else if (e.name === 'SKILL.md') res.push(p); } };
  walk(dir);
  return res.sort().map((f) => { const raw = fs.readFileSync(f, 'utf8'), text = forAI(raw), { meta, body } = front(text); let trig = ''; try { trig = fs.readFileSync(path.join(path.dirname(f), 'triggers.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).join('\n'); } catch { /* none */ } return { name: meta.name ?? path.basename(path.dirname(f)), dir: path.basename(path.dirname(f)), file: f, raw, text, meta, body, triggers: trig, bytes: Math.max(Buffer.byteLength(text), ...AIS.map((a) => Buffer.byteLength(forAI(raw, a)))) }; });   // bytes: the largest copy one AI gets
}
export const ours = () => collection(SK).filter((s) => skillNames().includes(s.dir));

// ---------- known commands and paths of this lab (for `grounded`) ----------
let VERBS = null;
function labVerbs() {
  if (VERBS) return VERBS;
  VERBS = new Set(['bds', 'end', 'll', 'app', 'help', 'skill', 'skills', 'go', 'test', 'sim', 'run', 'new', 'import', 'brief', 'add', 'check', 'build', 'png', 'render', 'deploy', 'make', 'harden', 'status', 'upkeep', 'share', 'auto']);
  for (const f of ['common/help.md', 'bds/help.md', 'end/help.md', 'll/help.md', 'AGENTS.md', 'end/AGENTS.md', 'll/AGENTS.md', 'app/AGENTS.md']) {
    let t = ''; try { t = fs.readFileSync(path.join(TOP, f), 'utf8'); } catch { continue; }
    for (const m of t.matchAll(/`(?:node lab\.mjs )?(?:(?:bds|end|ll) )?([a-z][a-z0-9-]*)/g)) VERBS.add(m[1]);
    for (const m of t.matchAll(/^## ([a-z][\w-]*)/gm)) VERBS.add(m[1]);
  }
  for (const k of ['bds', 'end', 'll']) { let f = ''; try { f = fs.readFileSync(path.join(TOP, k, 'flavor.mjs'), 'utf8'); } catch { continue; } const b = /commands: \{([\s\S]*?)\n {2}\},/.exec(f)?.[1] ?? ''; for (const m of b.matchAll(/^ {4}(?:async )?([a-z_]+)(?:\(|:)/gm)) VERBS.add(m[1]); }   // each flavor's commands (as tests/docs-offline.mjs reads them)
  for (const m of fs.readFileSync(path.join(TOP, 'common', 'core.mjs'), 'utf8').matchAll(/cmd === '([\w-]+)'/g)) VERBS.add(m[1]);
  for (const f of ['lab.mjs', 'bds/lab.mjs', 'end/lab.mjs', 'll/lab.mjs']) { let t = ''; try { t = fs.readFileSync(path.join(TOP, f), 'utf8'); } catch { continue; } for (const m of t.matchAll(/A\[0\] === '([a-z][\w-]*)'|cmd === '([a-z][\w-]*)'|\b([a-z][\w-]*): \['[\w.-]+\.mjs'/g)) VERBS.add(m[1] ?? m[2] ?? m[3]); }
  return VERBS;
}
function groundedRefs(text) {
  const cmds = [], paths = [];
  for (const m of text.matchAll(/node lab\.mjs ((?:(?:bds|end|ll) )?[a-z][a-z0-9-]*)/g)) cmds.push(m[1].split(' ').at(-1));
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const x = m[1].trim();
    if (/^(bds|end|ll|skills|common|tests|auto|app|training)\/[\w./-]*[\w/]$/.test(x) && !/[<>*{}]/.test(x)) paths.push(x.replace(/\/$/, ''));
  }
  return { cmds: [...new Set(cmds)], paths: [...new Set(paths)] };
}

// ---------- the grade ----------
const firstSentence = (d) => (String(d).match(/^.*?[.!?。](\s|$)/)?.[0] ?? String(d)).trim();
const HARD = /(^|[^\w-])(never|always|must|do not|don't|only|no two|not a)\b/i;   // (beta-only is a word, not a rule)
const WHY = /when missed|\((they|it|its|this|that|the|so|as|since|else)\b|because|otherwise|so that|\bso (it|the|a|you)\b|→|—|: (it|the|a|you)\b|\b(caus|break|fail|throw|crash|lost|lose|wrong|reject|flicker|hang|stuck|silent)/i;
function scoreOne(s, all, ctx) {
  const R = {}, at = {};   // R[id] = 0..2, at[id] = the line that earned it (for exemplars)
  // template lines still to fill (skill new) count for nothing: a draft scores low until it says something
  const d = s.meta.description ?? '', body = s.body.split('\n').filter((l) => !/<(first action|next action|how to check|what proves it|what looks similar|what this part says)[^>]*>/.test(l)).join('\n'), lines = body.split('\n');
  const line = (re) => lines.find((l) => re.test(l))?.trim().slice(0, 180);
  // name
  R.name = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name) && s.name.length <= 64 ? (s.name === s.dir ? 2 : 1) : 0;
  // trigger
  const when = /\b(use (it |this )?(when|for|after|before|first|whenever|with|only|on|to)|use first|when (the|a|you|an|someone|asked|it)|trigger)/i.test(d);
  const what = firstSentence(d).length >= 20;
  R.trigger = when && what && d.length <= 500 && firstSentence(d).length <= 240 ? 2 : (when || what) && d.length <= 1024 ? 1 : 0;
  if (R.trigger) at.trigger = `description: ${d.slice(0, 180)}`;
  // boundary: a hand-off by name, and a phrase that limits it
  const sib = all.map((x) => x.name).filter((x) => x !== s.name);
  const names = sib.some((x) => new RegExp('`' + x.replace(/[-]/g, '\\-') + '`|\\b' + x + '\\b').test(d + '\n' + body));
  const limit = /\b(not for|do not use|don't use|instead|rather than|only (when|for|if)|unless|belongs to|goes to|hand(s)? off|outside|beyond|not this skill|skip this)\b/i;
  const lim = limit.test(d + '\n' + body);
  R.boundary = names && lim ? 2 : names || lim ? 1 : 0;
  const sibRe = new RegExp(sib.map((x) => x.replace(/[-]/g, '\\-')).join('|') || '^$');
  if (R.boundary) at.boundary = lines.find((l) => limit.test(l) && sibRe.test(l))?.trim().slice(0, 180) ?? (limit.test(d) && sibRe.test(d) ? `description: ${d.slice(0, 180)}` : line(/\b(not for|instead|rather than|do not use)\b/i) ?? line(limit));
  // procedure: numbered steps (at line start or inline "1 `cmd`")
  const numbered = lines.filter((l) => /^\s*(\d+[.)]|\d+\s+[`A-Za-z]|[A-Z][.)]\s)/.test(l)).length + (body.match(/(?:^|[.:]\s|\*\*\s)\d+[.)]?\s+[`A-Za-z]/gm) ?? []).length;
  const bullets = lines.filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
  R.procedure = numbered >= 3 ? 2 : numbered >= 1 || bullets >= 3 ? 1 : 0;
  if (R.procedure) at.procedure = line(/^\s*(\d+[.)]|\d+\s+[`A-Za-z])/) ?? line(/^\s*[-*]\s+\S/);
  // example: a command with arguments, a code block, e.g.
  const spans = [...body.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);   // pairs in order (a lone regex would pair a closing tick with the next opening one)
  const cmdx = spans.filter((x) => /\s/.test(x) && /^(node|python|npm|npx|pip|\.\/|@[A-Z] |[a-z][\w-]* [\w<"'/-])/.test(x)).length + Math.floor((body.match(/```/g) ?? []).length / 2) + (body.match(/\be\.g\./g) ?? []).length;
  R.example = cmdx >= 2 ? 2 : cmdx >= 1 ? 1 : 0;
  if (R.example) at.example = line(/`(node|python|npm)[^`]*\s[^`]*`/) ?? line(/```|e\.g\./);
  // rules-why
  const rl = lines.filter((l) => /^\s*([-*]|\d+[.)])\s/.test(l) && HARD.test(l));
  const rw = rl.filter((l) => WHY.test(l));
  R['rules-why'] = !rl.length ? 2 : rw.length / rl.length >= 0.6 ? 2 : rw.length / rl.length >= 0.3 ? 1 : 0;
  if (rw.length) at['rules-why'] = rw[0].trim().slice(0, 180);
  // done
  const doneHead = /^\s*(#+\s*)?(\*\*)?(report|output|success|done( when)?|deliver|verification|before (you )?(say|report|deliver)|acceptance)\b/i;
  const doneAny = /\b(report|success|done when|DONE|deliver|hand (it )?back|finished when|acceptance|check that|Verify)\b/;   // Verify: says what proves it, not what to report: 1
  R.done = lines.some((l) => doneHead.test(l) || /\b(Done when|Report:|Success:|Output:)/.test(l)) ? 2 : doneAny.test(body) ? 1 : 0;
  if (R.done) at.done = line(/\b(Done when|Report:|Success:|Output:)/) ?? line(doneHead) ?? line(doneAny);
  // honesty
  const hon = /\b(not verified|unverified|say so|say which|say what|honest|cannot prove|can't prove|only the game|never report|never claim|not proof|is not proof|static check|still needs|not (yet )?(battle-)?tested|not a game capture|unresolved|instead of guessing)\b/gi;
  const hn = (body.match(hon) ?? []).length;
  R.honesty = hn >= 2 ? 2 : hn ? 1 : 0;
  if (hn) at.honesty = line(new RegExp(hon.source, 'i'));
  // budget
  R.budget = s.bytes >= MIN && s.bytes <= MAX ? 2 : s.bytes <= 8000 ? 1 : 0;
  // portable
  const vendor = /\b(TodoWrite|Task tool|Skill tool|SlashCommand|apply_patch|Claude Code|Codex CLI|Gemini CLI|Copilot|Cursor|Windsurf|ultrathink|\$ARGUMENTS|allowed-tools|AskUserQuestion)\b|(^|[\s`(])(\/home\/|\/Users\/|[A-Z]:\\)/g;
  const vh = (s.text.match(vendor) ?? []).length;
  R.portable = vh === 0 ? 2 : vh === 1 ? 1 : 0;
  // focus: the most words shared with one sibling
  const mine = wordSet(body);
  let worst = 0, with_ = '';
  for (const o of all) { if (o.name === s.name) continue; const O = ctx.words.get(o.name); let n = 0; for (const w of mine) if (O.has(w)) n++; const j = n / (mine.size + O.size - n || 1); if (j > worst) { worst = j; with_ = o.name; } }
  R.focus = worst < 0.3 ? 2 : worst < 0.45 ? 1 : 0;
  const notes = { focus: `${pct(worst)} shared with ${with_ || '-'}` };
  // no-repeat (rubric v2): lines that say again what the always-loaded entry file says
  const rep = lines.filter((l) => l.length >= 40 && !/rules:(begin|end)/.test(l)).filter((l) => { const W = wordSet(l); if (W.size < 8) return false; return ctx.entry.some((E) => { let n = 0; for (const w of W) if (E.has(w)) n++; return n / W.size >= 0.75; }); });
  R['no-repeat'] = rep.length === 0 ? 2 : rep.length <= 2 ? 1 : 0;
  if (rep.length) notes['no-repeat'] = `${rep.length} line(s) repeat AGENTS.md: "${rep[0].trim().slice(0, 90)}"`;
  if (ctx.lab) {
    // grounded
    const g = groundedRefs(s.text), V = labVerbs();
    const badC = g.cmds.filter((c) => !V.has(c)), badP = g.paths.filter((p) => !fs.existsSync(path.join(TOP, p)));
    const n = g.cmds.length + g.paths.length, bad = badC.length + badP.length;
    R.grounded = !n ? 1 : !bad ? 2 : bad / n <= 0.1 ? 1 : 0;
    if (bad) notes.grounded = `not here: ${[...badC.map((c) => `node lab.mjs ${c}`), ...badP].join(', ')}`;
    // evidence
    const rs = ctx.k.rules.filter((r) => r.skill === s.name && r.status === 'verified'), re = rs.filter((r) => ['test', 'probe', 'unit'].includes(r.evidence?.kind));
    R.evidence = !rs.length ? 1 : re.length / rs.length >= 0.8 ? 2 : re.length / rs.length >= 0.4 ? 1 : 0;
    notes.evidence = `${re.length}/${rs.length} rules re-run here`;
    // routed
    const master = all.find((x) => x.name.endsWith('-master'));
    const named = !master || master.name === s.name || new RegExp('`' + s.name + '`|\\b' + s.name + '\\b').test(master.text);
    const rc = ctx.route?.per?.[s.name];
    R.routed = named && (!rc ? s.name.endsWith('-master') : rc.ok / rc.n >= 0.8) ? 2 : named || (rc && rc.ok / rc.n >= 0.5) ? 1 : 0;
    notes.routed = `${named ? 'named by the master' : 'NOT named by the master'}${rc ? `, route ${rc.ok}/${rc.n} of its requests` : ', no requests in skills/routes.json'}`;
  }
  // criteria that are data (rubric.json `re`): a pattern the skill must have (adopted from the references by skill rubric
  // adopt, so the rubric can grow without code)
  for (const c of RUBRIC().criteria.filter((c) => c.re)) { const n = patternCount(body, c.re); R[c.id] = n >= (c.two ?? 1) ? 2 : n ? 1 : 0; if (n) at[c.id] = line(new RegExp(c.re, 'im')); }
  const crit = RUBRIC().criteria.filter((c) => ctx.lab || c.scope === 'portable');
  const total = crit.reduce((a, c) => a + (R[c.id] ?? 0), 0), max = crit.length * 2;
  const pTotal = crit.filter((c) => c.scope === 'portable').reduce((a, c) => a + (R[c.id] ?? 0), 0), pMax = crit.filter((c) => c.scope === 'portable').length * 2;
  return { name: s.name, bytes: s.bytes, R, at, notes, score: max ? total / max : 0, portable: pMax ? pTotal / pMax : 0 };
}
export function patternCount(body, re) { try { return (String(body).match(new RegExp(re, 'gim')) ?? []).length; } catch { return 0; } }
/** grade a collection; lab = ours (all criteria), else a reference (portable ones) */
export function gradeAll(list, { lab = false, route = null, entryFile = null } = {}) {
  // the always-loaded entry file (AGENTS.md) of that repository: what a skill repeats from it costs tokens twice
  let entry = []; try { entry = fs.readFileSync(entryFile ?? path.join(TOP, 'AGENTS.md'), 'utf8').split('\n').filter((l) => l.length >= 40).map((l) => wordSet(l)).filter((w) => w.size >= 5); } catch { /* none */ }
  const ctx = { lab, k: lab ? knowledge() : { rules: [] }, route, entry, words: new Map(list.map((s) => [s.name, wordSet(s.body)])) };
  return list.map((s) => scoreOne(s, list, ctx));
}

// ---------- routing: which skill for a request (BM25 over name, description, triggers.txt and body) ----------
function index(list) {
  const docs = list.filter((s) => !s.name.endsWith('-master')).map((s) => {
    const tf = new Map(), add = (text, w) => { for (const t of tokens(text)) tf.set(t, (tf.get(t) ?? 0) + w * weightOf(t)); };
    add(s.name.replace(/-/g, ' '), 3); add(s.meta.description ?? '', 2); add(s.triggers, 3); add(s.body, 0.5);
    return { name: s.name, tf, len: [...tf.values()].reduce((a, b) => a + b, 0) };
  });
  const N = docs.length, df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = docs.reduce((a, d) => a + d.len, 0) / (N || 1);
  return { docs, idf: (t) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5)), avg };
}
// a common kanji alone (方 of 書き方, 作 of 作り方, 教 of 教えて) says little: a quarter weight, so a request about curry or a CV
// finds no skill; a telling one (釣 歩 撃 魚) keeps its weight
const GENERIC_KANJI = new Set([...'方作書使見入出何時事物人中上下前後気分行来言思全一二三大小高教欲付開閉置持取聞知読話考待会着食寝住売買送返変直調']);
const weightOf = (t) => (t.length === 1 && GENERIC_KANJI.has(t) ? 0.25 : 1);
export function rank(q, ix) {
  const qs = [...new Set(tokens(q))], k1 = 1.2, b = 0.6;
  return ix.docs.map((d) => {
    let sc = 0; const hit = [];
    for (const t of qs) { const f = d.tf.get(t); if (!f) continue; const w = weightOf(t) * ix.idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / ix.avg)); sc += w; hit.push([t, w]); }
    return { name: d.name, score: sc, why: hit.sort((x, y) => y[1] - x[1]).slice(0, 4).map((x) => x[0]) };
  }).filter((r) => r.score > 0).sort((x, y) => y.score - x.score);
}
export const NONE = 1.5;   // under this the router names no skill (the master routes): a request no skill owns must land here
export function routeEval(list = ours()) {
  const cases = readJ(ROUTES(), { cases: [] }).cases, ix = index(list), per = {}, sets = { dev: { n: 0, ok1: 0, ok2: 0 }, held: { n: 0, ok1: 0, ok2: 0 } }, fails = [], close = [];
  for (const c of cases) {
    const rk = rank(c.q, ix), r = rk[0]?.score >= NONE ? rk.map((x) => x.name) : [], set = sets[c.set === 'held' ? 'held' : 'dev'];
    // want [] = no skill owns it (weather, a poem): a skill that grabs it would be loaded for nothing
    const ok1 = c.want.length ? c.want.includes(r[0]) : !r.length, ok2 = c.want.length ? c.want.some((w) => r.slice(0, 2).includes(w)) : !r.length;
    set.n++; if (ok1) set.ok1++; if (ok2) set.ok2++;
    if (c.set !== 'held' && c.want.length) { const p = (per[c.want[0]] ??= { n: 0, ok: 0 }); p.n++; if (ok1) p.ok++; }
    if (c.set !== 'held' && !c.want.length && r[0]) { const p = (per[r[0]] ??= { n: 0, ok: 0 }); p.n++; }   // grabbing a request nobody owns counts against that skill   // a skill's own score sees dev cases only: held-out ones stay unseen
    if (!ok1) fails.push({ q: c.q, want: c.want, got: r.slice(0, 2), set: c.set ?? 'dev' });
    else if (c.want.length && rk[1] && rk[1].score >= rk[0].score * 0.87) close.push({ q: c.q, first: rk[0].name, second: rk[1].name, set: c.set ?? 'dev' });   // right, but by a hair: an unrelated edit can flip it
  }
  return { per, sets, fails, close, n: cases.length };
}
export function route(args, out = console.log) {
  if (args.includes('--eval')) {
    const e = routeEval(); const f = (s) => (s.n ? `${s.ok1}/${s.n} first (${pct(s.ok1 / s.n)}), ${s.ok2}/${s.n} in the first two` : 'no cases');
    out(`route dev: ${f(e.sets.dev)} · held out: ${f(e.sets.held)}`);
    for (const x of e.fails.filter((x) => x.set !== 'held' || args.includes('--all')).slice(0, 12)) out(`  ✘ "${x.q}" → ${x.got.join(', ') || '(nothing)'} (want ${x.want[0] ?? 'no skill'})`);
    for (const x of e.close.filter((x) => x.set !== 'held' || args.includes('--all'))) out(`  ~ "${x.q}": ${x.first} first by a hair over ${x.second} (give ${x.first} a word only it has)`);
    if (e.sets.held.n) out('  (held-out cases are not listed: fixing for them would teach the test; --all shows them)');
    return true;
  }
  const q = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!q) { out('usage: node lab.mjs skill route "<request, any language>"  ·  --eval: accuracy on skills/routes.json'); return false; }
  const r = rank(q, index(ours())).slice(0, 3), top = r[0]?.score ?? 0;
  if (!r.length || top < NONE) { if (!args.includes('--print')) out(`(no clear owner) read bds-addon-master: node lab.mjs skill bds-addon-master`); return true; }   // (--print: AGENTS.md's steps are enough; no extra turn suggested)
  const near = r.filter((x) => x.score >= top * 0.5);
  // one clear owner: print it now (a second call to read it would re-send the whole conversation); close ones: name them,
  // `skill a b` prints both in one call
  // --print (bds new, import, make): print, never only name: a close second is printed too (cheaper than the extra turn that
  // reading it would take, which re-sends the whole conversation)
  if (args.includes('--print') && near.length > 1 && near[1].score >= top * 0.75) {
    for (const x of near.slice(0, 2)) { noteRead(x.name); const raw = fs.readFileSync(skillFile(x.name), 'utf8'); out(`# skill ${x.name} (matched: ${x.why.join(', ')})`); out(focus(readerView(raw), q, raw, x.name)); }
    return true;
  }
  if (!args.includes('--list') && (near.length === 1 || near[1].score < top * 0.75)) {
    noteRead(r[0].name);
    out(`# skill ${r[0].name} (matched: ${r[0].why.join(', ')})${near[1] ? ` · also near: ${near[1].name}` : ''}`);
    out(focus(readerView(fs.readFileSync(skillFile(r[0].name), 'utf8')), q, fs.readFileSync(skillFile(r[0].name), 'utf8'), r[0].name));
    return true;
  }
  for (const x of near) out(`${x.name.padEnd(18)} ${x.score.toFixed(1).padStart(5)}  (${x.why.join(', ')})`);
  out(near.length > 1 ? `close: read the one that fits, or both in one call: node lab.mjs skill ${near.slice(0, 2).map((x) => x.name).join(' ')}` : `read: node lab.mjs skill ${r[0].name}`);
  return true;
}

/** a catalog skill (<!-- catalog --> in it, like bds-recipes: one line per proven unit) shows only the lines that fit the
 *  request (the 3 best), the rest named by count: the AI copies one unit, the other ten lines would ride along every turn */
function focus(view, q, raw, name) {
  if (!/<!-- catalog -->/.test(raw)) return view;
  const Q = new Set(tokens(q)), lines = view.split('\n'), items = lines.map((l, i) => [i, l]).filter(([, l]) => /^- /.test(l));
  if (items.length <= 3) return view;
  const rules = knowledge().rules.filter((r) => r.skill === name && r.tags), tagsOf = (l) => rules.find((r) => l.startsWith(`- ${r.rule}`))?.tags ?? '';   // knowledge.json `tags`: the words a request uses (any language)
  const sc = items.map(([i, l]) => [i, tokens(l + ' ' + tagsOf(l)).filter((t) => Q.has(t)).length]).sort((a, b) => b[1] - a[1]);
  const keep = new Set(sc.filter((x) => x[1] > 0).slice(0, 3).map((x) => x[0]));
  if (!keep.size) return view;
  const outL = lines.filter((l, i) => !/^- /.test(l) || keep.has(i));
  return outL.join('\n') + `\n(${items.length - keep.size} more lines like these: node lab.mjs skill ${name})`;
}
// ---------- grades.json: the skills' own generations ----------
export const grades = () => readJ(GRADES(), { about: 'Grades of each skill per generation (node lab.mjs skill grade / refine). status: draft = written here and not yet shown to help (skill bench --without <name>), kept = proven or curated; scope lab = for this repository only (not installed elsewhere).', skills: {}, log: [], refine: [], ref: {} });
const saveGrades = (g) => fs.writeFileSync(GRADES(), JSON.stringify(g, null, 1) + '\n');
export function statusOf(name) { return grades().skills[name]?.status ?? 'kept'; }
/** the part of a grade an edit can still raise (criteria a probe or a test raises, text:false, left out): picks `weakest` */
/** a skill whose last two refinements were both reverted is stuck: `weakest` passes over it until something else changes */
export function stuck(name) { const t = (grades().refine ?? []).filter((x) => x.skill === name).slice(-2); return t.length === 2 && t.every((x) => !x.kept); }
// the lowest that an edit can still raise, past stuck ones; null when no skill has anything left an edit can raise
const pickWeakest = (res) => [...res].filter((r) => !stuck(r.name) && textScore(r) < 1).sort((a, b) => textScore(a) - textScore(b) || a.score - b.score)[0]?.name ?? null;
export function textScore(r) { const cs = RUBRIC().criteria.filter((c) => c.text !== false && r.R[c.id] !== undefined); return cs.length ? cs.reduce((a, c) => a + r.R[c.id], 0) / (cs.length * 2) : 1; }
function record(g, res, e, why) {
  const scores = Object.fromEntries(res.map((r) => [r.name, Math.round(r.score * 100)])), text = Object.fromEntries(res.map((r) => [r.name, Math.round(textScore(r) * 100)]));
  const mean = Math.round(res.reduce((a, r) => a + r.score, 0) / (res.length || 1) * 100);
  const rt = { dev: e.sets.dev.n ? Math.round(e.sets.dev.ok1 / e.sets.dev.n * 100) : null, held: e.sets.held.n ? Math.round(e.sets.held.ok1 / e.sets.held.n * 100) : null };
  const last = g.log.at(-1);
  if (last && last.rubric === RUBRIC().version && last.mean === mean && JSON.stringify(last.scores) === JSON.stringify(scores) && last.route?.dev === rt.dev && last.route?.held === rt.held) return false;
  g.log.push({ gen: (last?.gen ?? 0) + 1, at: today(), rubric: RUBRIC().version, mean, route: rt, scores, text, why });
  return true;
}

export function grade(args, out = console.log) {
  const refs = vals(args, '--ref'), json = args.includes('--json');
  const want = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--ref')[0] ?? 'all';
  const list = ours(), e = routeEval(list), res = gradeAll(list, { lab: true, route: e });
  const crit = RUBRIC().criteria;
  const show = want === 'all' ? res : res.filter((r) => r.name === want);
  if (!show.length) { out(`ERR no skill "${want}" (skills: ${list.map((s) => s.name).join(' ')})`); return false; }
  const g = grades();
  if (record(g, res, e, 'grade')) saveGrades(g);
  if (json && !refs.length) { out(JSON.stringify(show)); return true; }
  const head = crit.map((c) => c.id.slice(0, 4)).join(' ');
  out(`skill               score ${head}`);
  for (const r of show.sort((a, b) => a.score - b.score)) out(`${(r.name + (statusOf(r.name) === 'draft' ? '*' : '')).padEnd(19)} ${pct(r.score).padStart(5)} ${crit.map((c) => String(r.R[c.id] ?? '-').padStart(4)).join(' ')}`);
  const mean = res.reduce((a, r) => a + r.score, 0) / res.length;
  out(`mean ${pct(mean)} (portable criteria only: ${pct(res.reduce((a, r) => a + r.portable, 0) / res.length)}) · route dev ${e.sets.dev.n ? pct(e.sets.dev.ok1 / e.sets.dev.n) : '-'} held ${e.sets.held.n ? pct(e.sets.held.ok1 / e.sets.held.n) : '-'} · ${crit.length} criteria (skills/rubric.json)${res.some((r) => statusOf(r.name) === 'draft') ? ' · * draft' : ''}`);
  if (want !== 'all') { const r = show[0]; for (const c of crit) if ((r.R[c.id] ?? 2) < 2) out(`  ${c.id} ${r.R[c.id]}: ${c.what}${r.notes[c.id] ? ` [${r.notes[c.id]}]` : ''} → ${c.fix}`); }
  // reference collections: the same portable criteria, and for each one we score lower, the line that earns theirs a 2
  for (const ref of refs) {
    const dir = sourceDir(ref), rl = collection(dir);
    if (!rl.length) { out(`W --ref ${ref}: no SKILL.md found`); continue; }
    const rr = gradeAll(rl, { lab: false, entryFile: path.join(dir, 'AGENTS.md') }), name = path.basename(dir);
    const pm = rr.reduce((a, r) => a + r.portable, 0) / rr.length, om = res.reduce((a, r) => a + r.portable, 0) / res.length;
    out(`ref ${name}: ${rr.length} skills, portable ${pct(pm)} (ours ${pct(om)})`);
    for (const c of crit.filter((c) => c.scope === 'portable')) {
      const a = res.reduce((s, r) => s + r.R[c.id], 0) / res.length, b = rr.reduce((s, r) => s + r.R[c.id], 0) / rr.length;
      const best = rr.filter((r) => r.R[c.id] === 2 && r.at[c.id]).sort((x, y) => y.portable - x.portable)[0];
      if (b > a + 0.05) out(`  ${c.id}: theirs ${b.toFixed(1)} > ours ${a.toFixed(1)}${best ? ` · e.g. ${best.name}: "${best.at[c.id]}"` : ''}`);
    }
    const g2 = grades(); g2.ref = { ...(g2.ref ?? {}), [name]: { at: today(), skills: rr.length, portable: Math.round(pm * 100), ours: Math.round(om * 100) } }; saveGrades(g2);
  }
  if (refs.length) out('(the rubric was written here, from these references and SkillsBench: scoring above a reference shows we follow it, not that our skills work better; skill bench decides that)');
  return true;
}

// ---------- new: a skill from nothing, in the shape the good ones share ----------
export function newSkill(args, out = console.log) {
  const [name, ...d] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--like'), desc = d.join(' ').trim(), like = val(args, '--like', null);
  if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) { out('usage: node lab.mjs skill new <kebab-name> "<what it does, in the words people use. Use when ...>"'); return false; }
  if (fs.existsSync(skillFile(name))) { out(`ERR skill ${name} exists: node lab.mjs skill refine ${name}`); return false; }
  if (desc.length < 40 || !/\buse (it |this )?(when|for|after|first|with)\b/i.test(desc)) { out('ERR the description is how an AI finds this skill: the first sentence says what it does, then "Use when ..." with 2-4 concrete triggers (at least 40 characters)'); return false; }
  const near = rank(desc, index(ours()))[0];
  const title = name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  // --like <skill | repo/skill | path>: borrow the parts (headings) of a skill that works, ours or a reference's
  let parts = '';
  if (like) {
    const ex = exemplar(like);
    if (!ex) { out(`ERR --like ${like}: no such skill here or in .lab/skill-sources (skill grade --ref <url> fetches a collection)`); return false; }
    const heads = [...ex.body.matchAll(/^#{2,3} +(.+)$/gm)].map((m) => m[0].trim()).filter((h) => !/rules:|^#{2,3} +(references?|see also)$/i.test(h)).slice(0, 6);
    parts = heads.map((h) => `${h}\n<what this part says for ${name}, the way ${ex.where} does>\n\n`).join('');
    out(`--like ${ex.where}: its parts ${heads.map((h) => h.replace(/^#+ +/, '')).join(' · ') || '(no headings: the plain shape)'}`);
  }
  fs.mkdirSync(path.join(SK, name), { recursive: true });
  fs.writeFileSync(skillFile(name), `---\nname: ${name}\ndescription: ${desc.replace(/\n/g, ' ')}\n---\n\n# ${title}\n\nNot for: <what looks similar but belongs elsewhere> (use \`${near?.name ?? 'bds-addon-master'}\`).\n\n${parts}1. <first action: a command with real arguments, e.g. \`node lab.mjs ...\`>\n2. <next action>\n3. <how to check it worked: the command and the line that proves it>\n\nDone when <what proves it>. Report: what ran, what passed, what is not verified (say so).\n\n<!-- rules:begin (node lab.mjs skill build writes these from skills/knowledge.json) -->\n<!-- rules:end -->\n`);
  fs.writeFileSync(path.join(SK, name, 'triggers.txt'), `# words and phrases a person uses when this skill is needed, any language, one per line (skill route reads them; not installed)\n`);
  const g = grades(); g.skills[name] = { status: 'draft', born: today(), scope: args.includes('--lab') ? 'lab' : 'portable' }; saveGrades(g);
  out(`OK skills/${name}/SKILL.md (draft) + triggers.txt${near ? ` · closest existing skill: ${near.name} (check they do not overlap: skill grade ${name} → focus)` : ''}`);
  out(`next: fill the <...> lines (read skill-forge), then node lab.mjs skill refine ${name} and --done until it keeps; name it in bds-addon-master; skill bench --without ${name} decides draft → kept`);
  return true;
}

/** a skill to copy the shape of: ours by name, `repo/skill` in .lab/skill-sources, or a path to a SKILL.md or its folder */
export function exemplar(like) {
  const mine = ours().find((s) => s.name === like);
  if (mine) return { ...mine, where: like };
  const p = path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), like);
  if (fs.existsSync(p)) { const c = collection(fs.statSync(p).isDirectory() ? p : path.dirname(p))[0]; if (c) return { ...c, where: path.basename(path.dirname(c.file)) }; }
  const [repo, sk] = like.split('/'), base = path.join(TOP, '.lab', 'skill-sources');
  let repos = []; try { repos = fs.readdirSync(base); } catch { /* none */ }
  for (const r of sk ? repos.filter((x) => x === repo) : repos) { const c = collection(path.join(base, r)).find((x) => x.name === (sk ?? repo) || x.dir === (sk ?? repo)); if (c) return { ...c, where: `${r}/${c.dir}` }; }
  return null;
}

// ---------- refine: the self-training loop for one skill ----------
const snapDir = (n) => path.join(LABDIR(), 'skill-refine', n);
function snapshot(n) { const d = snapDir(n); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); fs.cpSync(path.join(SK, n), path.join(d, 'files'), { recursive: true }); return d; }
function restore(n) { const d = path.join(snapDir(n), 'files'); if (!fs.existsSync(d)) return false; fs.rmSync(path.join(SK, n), { recursive: true, force: true }); fs.cpSync(d, path.join(SK, n), { recursive: true }); return true; }
function refsGraded(args) {
  const refs = vals(args, '--ref'), dirs = refs.length ? refs.map(sourceDir) : (() => { try { const b = path.join(TOP, '.lab', 'skill-sources'); return fs.readdirSync(b).map((x) => path.join(b, x)); } catch { return []; } })();
  return dirs.flatMap((d) => { const rl = collection(d); return rl.length ? gradeAll(rl, { lab: false, entryFile: path.join(d, 'AGENTS.md') }).map((r) => ({ ...r, repo: path.basename(d) })) : []; });
}
export function refine(args, out = console.log) {
  let [name] = args.filter((a, i) => !a.startsWith('--') && !['--ref', '--via', '--rounds', '--model', '--because'].includes(args[i - 1]));
  const list = ours(), e0 = routeEval(list), res0 = gradeAll(list, { lab: true, route: e0 });
  if (!name || name === 'weakest') { name = pickWeakest(res0); if (!name) { out(`OK nothing left an edit can raise${res0.some((r) => stuck(r.name)) ? ` (stuck after two reverts: ${res0.filter((r) => stuck(r.name)).map((r) => r.name).join(' ')}; name one to try again)` : ''}; what remains needs a probe, a test or a bench`); return true; } }
  const cur = res0.find((r) => r.name === name);
  if (!cur) { out(`ERR no skill "${name}"`); return false; }
  const crit = RUBRIC().criteria, statef = path.join(snapDir(name), 'base.json');
  if (args.includes('--revert')) { const ok = restore(name); out(ok ? `OK ${name}: snapshot put back` : `ERR no snapshot for ${name}`); return ok; }
  if (args.includes('--done')) {
    const base = readJ(statef, null);
    if (!base) { out(`ERR no refine started for ${name}: node lab.mjs skill refine ${name}`); return false; }
    const why = [];
    if (cur.bytes > MAX) why.push(`${cur.bytes} B is over ${MAX} B`);
    if (!/<!-- rules:begin[^>]*-->[\s\S]*<!-- rules:end -->/.test(fs.readFileSync(skillFile(name), 'utf8')) && base.rulesBlock) why.push('the rules block is gone (skill build writes it; keep the two marker lines)');
    const nowText = fs.readFileSync(skillFile(name), 'utf8');
    if (/<(first action|next action|how to check|what proves it|what looks similar|what this part says)[^>]*>/.test(nowText)) why.push('template lines still to fill (<...>)');
    { const blk = /<!-- rules:begin[^>]*-->\n?([\s\S]*?)<!-- rules:end -->/.exec(nowText)?.[1] ?? null, want = ruleLines(knowledge(), name).join('\n'); if (blk !== null && blk.trim() !== want.trim()) why.push('the rules block was edited (it is written from skills/knowledge.json: change a rule there, with evidence)'); }
    if (/[ \t]*<!-- only:(?![\w,-]+ -->)/.test(nowText) || (nowText.match(/<!-- only:/g) ?? []).length !== (nowText.match(/<!-- \/only -->/g) ?? []).length) why.push('an <!-- only:<ai> --> part is not closed with <!-- /only -->');
    if (cur.score < base.score - 1e-9) why.push(`score ${pct(base.score)} → ${pct(cur.score)}`);
    for (const c of crit) if ((base.R[c.id] ?? 0) > (cur.R[c.id] ?? 0)) why.push(`${c.id} ${base.R[c.id]} → ${cur.R[c.id]}`);
    const d0 = base.route.dev, h0 = base.route.held, d1 = e0.sets.dev.ok1, h1 = e0.sets.held.ok1;
    // case by case (cases added to skills/routes.json meanwhile do not count): a request routed right before and wrong now
    const failNow = new Set(e0.fails.map((x) => x.q));
    if (base.routeOk) {
      const lost = base.routeOk.filter((q) => failNow.has(q)), lostH = lost.filter((q) => base.routeHeld?.includes(q));
      if (lost.length - lostH.length) why.push(`routing got worse on dev cases (${lost.length - lostH.length} routed right before now go elsewhere${lostH.length < lost.length ? `: "${cut(lost.find((q) => !lostH.includes(q)), 50)}"` : ''})`);
      if (lostH.length) why.push(`routing got worse on held-out cases (${lostH.length} routed right before now go elsewhere)`);
    } else {
      if (d1 < d0) why.push(`routing got worse on dev cases (${d0} → ${d1} first)`);
      if (h1 < h0) why.push(`routing got worse on held-out cases (${h0} → ${h1} first)`);
    }
    // a change no other skill's grade may pay for (focus, routed of the others)
    for (const r of res0) { const b = base.others?.[r.name]; if (r.name !== name && b !== undefined && r.score < b - 1e-9) why.push(`${r.name} ${pct(b)} → ${pct(r.score)}`); }
    // --shorter: the same skill in fewer bytes (5%+) counts as better, if every `code span`, number and rule id survives
    const shorter = args.includes('--shorter');
    if (shorter && base.text) { const lost = lostFacts(base.text, nowText); if (lost.length) why.push(`lost what it said: ${lost.slice(0, 6).join(' ')}`); }
    const gained = base.routeOk ? readJ(ROUTES(), { cases: [] }).cases.filter((c) => base.routeAll?.includes(c.q) && !base.routeOk.includes(c.q) && !failNow.has(c.q)).length : (d1 > d0 || h1 > h0 ? 1 : 0);
    const g = grades(), better = cur.score > base.score + 1e-9 || gained > 0 || (shorter && cur.bytes <= base.bytes * 0.95);
    // longer and no better costs tokens on every turn for nothing; an AI editing for the rubric (refine --via) must gain
    // something measurable (seen: an AI added invented "(when missed: …)" clauses, +35% bytes, the grade unchanged)
    const because = val(args, '--because', null);   // new content the grade cannot see (a new command to document): said, and logged
    if (!better && base.bytes && cur.bytes > base.bytes * 1.05 && !because) why.push(`${base.bytes} → ${cur.bytes} B and no better (new content the grade cannot see: --done --because "<what it adds>")`);
    if (!better && args.includes('--strict')) why.push(`no better (--strict: an edit must raise the grade or the routing${args.includes('--shorter') ? `, or cut 5%: ${base.bytes} → ${cur.bytes} B` : ''})`);
    if (why.length) {
      restore(name);
      g.refine.push({ skill: name, at: today(), from: Math.round(base.score * 100), to: Math.round(cur.score * 100), kept: false, why: why.join('; ') });
      saveGrades(g);
      out(`REVERTED ${name}: ${why.join('; ')} (the old SKILL.md is back; try again: skill refine ${name})`);
      return false;
    }
    g.refine.push({ skill: name, at: today(), from: Math.round(base.score * 100), to: Math.round(cur.score * 100), kept: true, better, ...(val(args, '--because', null) ? { because: val(args, '--because', null) } : {}) });
    record(g, res0, e0, `refine ${name}`);
    saveGrades(g);
    fs.rmSync(snapDir(name), { recursive: true, force: true });
    out(`KEPT ${name}: ${pct(base.score)} → ${pct(cur.score)} · route dev ${d0} → ${d1}, held ${h0} → ${h1}${better ? '' : ' (no worse, no better: fine for a wording change)'} · then: node lab.mjs skill build --check${statusOf(name) === 'draft' ? ` · draft until skill bench --without ${name} keeps it` : ''}`);
    return true;
  }
  // the brief. A refine already under way (the file changed since its snapshot) keeps its snapshot: taking a new one would make
  // the edit the baseline, so --done could no longer see what got worse and --revert could not go back
  const open = readJ(statef, null), nowRaw = fs.readFileSync(skillFile(name), 'utf8');
  if (open?.text !== undefined && open.text !== nowRaw && fs.existsSync(path.join(snapDir(name), 'files'))) out(`(a refine of ${name} is under way since its snapshot: this brief is against that one; --done to measure, --revert to go back)`);
  else { snapshot(name);
  fs.writeFileSync(statef, JSON.stringify({ text: fs.readFileSync(skillFile(name), 'utf8'), score: cur.score, bytes: cur.bytes, R: cur.R, route: { dev: e0.sets.dev.ok1, held: e0.sets.held.ok1 }, ...(() => { const f = new Set(e0.fails.map((x) => x.q)), cs = readJ(ROUTES(), { cases: [] }).cases; return { routeAll: cs.map((c) => c.q), routeOk: cs.filter((c) => !f.has(c.q)).map((c) => c.q), routeHeld: cs.filter((c) => c.set === 'held').map((c) => c.q) }; })(), rulesBlock: /<!-- rules:begin/.test(fs.readFileSync(skillFile(name), 'utf8')), others: Object.fromEntries(res0.map((r) => [r.name, r.score])) })); }
  out(`refine ${name}: ${pct(cur.score)} now, ${cur.bytes}/${MAX} B · edit skills/${name}/SKILL.md (and triggers.txt), then node lab.mjs skill refine ${name} --done (kept only if nothing gets worse)`);
  const refsR = refsGraded(args);
  for (const c of crit) {
    if ((cur.R[c.id] ?? 2) >= 2) continue;
    if (c.text === false) { out(`- ${c.id} ${cur.R[c.id]}/2 (not a text fix): ${c.fix}${cur.notes[c.id] ? ` [${cur.notes[c.id]}]` : ''}`); continue; }
    out(`- ${c.id} ${cur.R[c.id]}/2: ${c.fix}${cur.notes[c.id] ? ` [${cur.notes[c.id]}]` : ''}`);
    const ex = refsR.filter((r) => r.R[c.id] === 2 && r.at[c.id]).sort((a, b) => b.portable - a.portable)[0];
    if (ex) out(`    how a reference does it (${ex.repo}/${ex.name}): "${ex.at[c.id]}"`);
  }
  // what was tried and put back since the last kept edit: do not try it again
  { const h = (grades().refine ?? []).filter((x) => x.skill === name); const since = h.slice(h.map((x) => x.kept).lastIndexOf(true) + 1); for (const x of since.slice(-2)) out(`- tried ${x.at} and reverted: ${x.why} (do something else)`); }
  const k = knowledge();
  for (const r of k.rules.filter((r) => r.skill === name && r.status === 'verified' && (r.misses?.n ?? 0) >= 2)) out(`- rule ${r.id} missed ${r.misses.n}×: say it where the step happens, or make it a check`);
  const cands = k.rules.filter((r) => r.skill === name && r.status === 'candidate');
  if (cands.length) out(`- ${cands.length} candidate rule(s) wait for proof: ${cands.slice(0, 3).map((r) => r.id).join(' ')} (skill promote <id> --evidence ...)`);
  for (const f of e0.fails.filter((x) => x.set !== 'held' && (x.want[0] === name || x.got[0] === name)).slice(0, 5)) out(`- route: "${f.q}" → ${f.got[0] ?? '(nothing)'}, should be ${f.want[0]}${f.want[0] === name ? ' (add its words to triggers.txt or the description)' : ' (this skill wins a request it does not own: narrow its words)'}`);
  for (const c of e0.close.filter((x) => x.set !== 'held' && (x.first === name || x.second === name)).slice(0, 3)) out(`- route by a hair: "${c.q}" → ${c.first} just over ${c.second}${c.first === name ? ' (a word only this skill has makes it safe)' : ' (do not take it: it is theirs)'}`);
  const reads = usage()[name];
  if (reads) out(`- used: read ${reads.reads}× in ${reads.units} unit(s)${reads.fixesWith !== null ? `, failures fixed per unit when read ${reads.fixesWith.toFixed(1)} vs not ${reads.fixesWithout?.toFixed(1) ?? '-'}` : ''}`);
  if (!refsR.length) out('  (no reference skills here yet for examples: skill grade --ref https://github.com/iMasterProX/mcbemodelingmasterAI once fetches one)');
  return true;
}

// what a shorter skill must still say: every `code span`, number and rule id of the old one (or AGENTS.md says it)
export function facts(text) { const t = String(text).replace(/^---\n[\s\S]*?\n---\n/, ''); return new Set([...t.matchAll(/`([^`\n]+)`/g)].map((m) => '`' + m[1] + '`').concat([...t.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?![\w])/g)].map((m) => m[0]))); }
export function lostFacts(oldText, newText) { let ag = ''; try { ag = fs.readFileSync(path.join(TOP, 'AGENTS.md'), 'utf8'); } catch { /* none */ } const nw = String(newText); return [...facts(oldText)].filter((f) => !nw.includes(f.replace(/^`|`$/g, '')) && !ag.includes(f.replace(/^`|`$/g, ''))); }
// ---------- refine --via <ai>: another AI does the edit, the lab measures, the gate keeps or reverts; rounds until it stalls ----------
async function askAI(via, prompt, model) {
  const custom = process.env.LAB_FORGE_AI_CMD ?? (/\{prompt/.test(via ?? '') ? via : null);
  if (custom) {   // any command: {prompt_file} (or the last argument) is a file holding the prompt; its stdout is the answer
    fs.mkdirSync(LABDIR(), { recursive: true });
    const f = path.join(LABDIR(), `forge-prompt-${process.pid}.txt`); fs.writeFileSync(f, prompt);
    // the prompt holds SKILL.md text (backticks, $): quoted for the shell so none of it runs; Windows' cmd has no safe quoting
    // for arbitrary text, so {prompt} there means the file too
    const q = (x) => (process.platform === 'win32' ? `"${x.replace(/"/g, '""')}"` : `'${x.replace(/'/g, `'\\''`)}'`);
    // (a function replacer: a string one reads $& $` $' in the text as patterns and garbles the command)
    const cmd = /\{prompt_file\}/.test(custom) ? custom.replaceAll('{prompt_file}', () => q(f)) : /\{prompt\}/.test(custom) ? custom.replaceAll('{prompt}', () => (process.platform === 'win32' ? q(f) : q(prompt))) : `${custom} ${q(f)}`;
    const r = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 900000, maxBuffer: 64e6 });
    fs.rmSync(f, { force: true });
    return { text: r.stdout ?? '', tokens: Number(/tokens[ =:]+(\d+)/.exec(r.stderr ?? '')?.[1] ?? 0), via: 'command' };
  }
  const { ask1, pickVia } = await import('./make.mjs');
  const v = !via || via === 'auto' ? pickVia(null) : via;
  if (!v) throw new Error('refine --via needs an AI: ANTHROPIC_API_KEY, OPENAI_API_KEY, or the claude / codex / gemini CLI (or --via "<command {prompt_file}>")');
  const r = await ask1(v, prompt, { model, max: 8000 });
  return { ...r, via: v };
}
export async function refineAuto(args, out = console.log) {
  const via = val(args, '--via', 'auto'), rounds = Math.max(1, Number(val(args, '--rounds', 3))), model = val(args, '--model', undefined), shorter = val(args, '--goal', 'better') === 'shorter';
  const refArgs = vals(args, '--ref').flatMap((r) => ['--ref', r]);
  let [name] = args.filter((a, i) => !a.startsWith('--') && !['--ref', '--via', '--rounds', '--model', '--goal'].includes(args[i - 1]));
  if ((!name || name === 'weakest') && shorter) name = ours().filter((s) => !s.name.endsWith('-master')).sort((a, b) => b.bytes - a.bytes)[0]?.name;   // shorter: the longest
  if (!name || name === 'weakest') { const e = routeEval(); name = pickWeakest(gradeAll(ours(), { lab: true, route: e })); if (!name) { out('FORGE nothing left an edit can raise (skill growth: the next step needs a probe, a test, a bench or a stricter rubric)'); return true; } }
  if (!name || !skillNames().includes(name)) { out(`ERR no skill "${name}"`); return false; }
  const scoreNow = () => { const e = routeEval(); return gradeAll(ours(), { lab: true, route: e }).find((r) => r.name === name)?.score ?? 0; };
  const s0 = scoreNow();
  let tokens = 0, kept = 0, reverted = 0, quiet = 0, n = 0, usedVia = via;
  for (; n < rounds && quiet < 2; n++) {
    const brief = [];
    if (!refine([name, ...refArgs], (l) => brief.push(l))) { brief.forEach((l) => out(l)); return false; }
    const work = brief.slice(1).filter((l) => !/\(not a text fix\)|^\s+how a reference|^- used:|^\s+\(no reference|^- tried /.test(l));
    if (!work.length && !shorter) { out(`  round ${n + 1}: nothing in the brief a text edit can improve`); restore(name); fs.rmSync(snapDir(name), { recursive: true, force: true }); break; }
    const file = fs.readFileSync(skillFile(name), 'utf8'); let trig = ''; try { trig = fs.readFileSync(path.join(SK, name, 'triggers.txt'), 'utf8'); } catch { /* none */ }
    const kText = fs.readFileSync(path.join(SK, 'knowledge.json'), 'utf8');
    const prompt = shorter ? `You shorten ONE skill of bds-lab (AIs build Minecraft Bedrock addons and prove them on real servers). The skill is a SKILL.md an AI reads whole while it works; every word costs tokens on every later turn. Say exactly the same in fewer words: same steps in the same order, same hand-offs, same limits, same rules.\n\nHard limits (the lab checks each and puts the old file back if one breaks): keep every \`code span\`, every number and every rule id exactly (a command may not change by one character); keep the front matter (name: ${name}; the description may get shorter but must keep what it does and "Use when ..."); keep the two rules marker lines; a rule line is "- <rule> (when missed: <symptom>) \`<id>\`" and may be reworded shorter but keeps its id, its meaning and its symptom; add nothing new; no AI product names; the result must be at least 5% smaller. Text the repository's AGENTS.md already says may go (the lab knows it).\n\nskills/${name}/SKILL.md now:\n\`\`\`markdown\n${file}\n\`\`\`\n\nReply with the whole new SKILL.md in one \`\`\`skill block. Nothing else.` : `You improve ONE skill of bds-lab (a lab where AIs build Minecraft Bedrock addons and prove them on real servers). A skill is a SKILL.md that AI agents load as part of their system prompt: every line costs tokens on every turn, so it must be short, procedural, exact.\n\nWhat the lab measured (fix exactly these; a reference line shows how a good skill does it; never invent a consequence, a command or a fact that the file and the brief do not give):\n${brief.join('\n')}\n\nHard limits (the lab reverts an edit that breaks one): keep the front matter \`name: ${name}\`; description = what it does in its first sentence + "Use when ..." with concrete triggers, at most 500 characters; keep every line between <!-- rules:begin ... --> and <!-- rules:end --> exactly as it is (they come from skills/knowledge.json); at most 3200 bytes; only commands and paths that already appear in the file or the brief; no AI product names in shared text (a part only one AI needs goes inside <!-- only:<ai> --> ... <!-- /only -->); no other skill may lose its requests (keep triggers.txt to this skill's own words); do not repeat what the repository's AGENTS.md says.\n\nskills/${name}/SKILL.md now:\n\`\`\`markdown\n${file}\n\`\`\`\nskills/${name}/triggers.txt now (words and phrases, any language, one per line; lines starting with # are comments):\n\`\`\`text\n${trig}\n\`\`\`\n\nReply with the whole new SKILL.md in one \`\`\`skill block and the whole new triggers.txt in one \`\`\`triggers block. Nothing else.`;
    let r;
    try { r = await askAI(via, prompt, model); } catch (e) { out(`ERR ${e.message}`); restore(name); return false; }
    tokens += r.tokens ?? 0; usedVia = r.via ?? via;
    const sk = /\`\`\`skill[^\n]*\n([\s\S]*?)\n\`\`\`/.exec(r.text)?.[1], tg = /\`\`\`triggers[^\n]*\n([\s\S]*?)\n\`\`\`/.exec(r.text)?.[1];
    if (!sk || !/^---\nname: /.test(sk)) { out(`  round ${n + 1}: the answer had no \`\`\`skill block with front matter: nothing changed`); restore(name); reverted++; quiet++; continue; }
    if (shorter) {
      // reworded rule lines go back to knowledge.json by id (the file's rules block is always written from there)
      const K = JSON.parse(kText), mine = K.rules.filter((x) => x.skill === name && x.status === 'verified'), seen = new Set();
      let bad = '';
      for (const l of (/<!-- rules:begin[^>]*-->\n?([\s\S]*?)<!-- rules:end -->/.exec(sk)?.[1] ?? '').split('\n').filter((x) => x.startsWith('- '))) {
        const m = /^- (.*?)(?: \(when missed: (.*)\))? `([a-z0-9-]+)`( \[source\])?$/.exec(l), rr = m && mine.find((x) => x.id === m[3]);
        if (!rr) { bad = `a rule line the lab does not know: ${l.slice(0, 60)}`; break; }
        const old = `${rr.rule} ${rr.why ?? ''}`, nw = `${m[1]} ${m[2] ?? ''}`, lost = lostFacts(old, nw);
        if (lost.length || (rr.why && !m[2])) { bad = `rule ${rr.id} lost ${lost.join(' ') || 'its symptom'}`; break; }
        seen.add(rr.id); rr.rule = m[1]; if (m[2]) rr.why = m[2];
      }
      if (!bad && seen.size !== mine.length) bad = `rule lines missing: ${mine.filter((x) => !seen.has(x.id)).map((x) => x.id).join(' ')}`;
      if (bad) { out(`  round ${n + 1}: ${bad}: nothing changed`); restore(name); reverted++; quiet++; continue; }
      fs.writeFileSync(path.join(SK, 'knowledge.json'), JSON.stringify(K, null, 2) + '\n');
      const { withRules } = await import('./skills.mjs');
      fs.writeFileSync(skillFile(name), (withRules(sk.trimEnd() + '\n', ruleLines(K, name)) ?? sk.trimEnd() + '\n'));
    } else fs.writeFileSync(skillFile(name), sk.trimEnd() + '\n');
    if (tg !== undefined && !shorter) fs.writeFileSync(path.join(SK, name, 'triggers.txt'), tg.trimEnd() + '\n');
    const done = [], ok = refine([name, '--done', '--strict', ...(shorter ? ['--shorter'] : [])], (l) => done.push(l));
    if (!ok && shorter) fs.writeFileSync(path.join(SK, 'knowledge.json'), kText);   // the rules come back with the file
    out(`  round ${n + 1}: ${done.at(-1)}`);
    if (ok) { kept++; quiet = 0; } else { reverted++; quiet++; }
  }
  const s1 = scoreNow();
  if (shorter) out(`  size: ${Buffer.byteLength(readerView(fs.readFileSync(skillFile(name), 'utf8')))} B as read`);
  out(`FORGE ${name}: ${pct(s0)} → ${pct(s1)} in ${n} round(s), ${kept} kept / ${reverted} reverted via ${usedVia}: ${tokens.toLocaleString('en')} tokens`);
  return kept > 0 || s1 >= s0;
}

// ---------- usage: which skills are read, and whether units where they were read needed fewer fixes ----------
const READS = () => path.join(LABDIR(), 'skill-reads.jsonl');
export function noteRead(name) {
  if (process.env.LAB_SKILL_READS === 'off') return;   // (tests)
  try {
    // the lab being worked in first (LAB_KIND, else .lab-kind), so a read while making an Endstone plugin counts for it
    let cur = process.env.LAB_KIND; try { cur ??= fs.readFileSync(path.join(TOP, '.lab-kind'), 'utf8').trim(); } catch { /* bds */ }
    let unit = null; for (const k of [...new Set([cur, 'bds', 'end', 'll'])].filter((x) => ['bds', 'end', 'll'].includes(x))) { try { unit = `${k}/${fs.readFileSync(path.join(TOP, k, '.lab', 'addon'), 'utf8').trim()}`; break; } catch { /* none */ } }
    fs.mkdirSync(LABDIR(), { recursive: true });
    fs.appendFileSync(READS(), JSON.stringify({ at: new Date().toISOString(), skill: name, unit }) + '\n');
  } catch { /* read-only: no usage then */ }
}
export function usage() {
  const rows = []; try { for (const l of fs.readFileSync(READS(), 'utf8').split('\n')) if (l.trim()) try { rows.push(JSON.parse(l)); } catch { /* torn */ } } catch { /* none */ }
  const eps = episodes(), fixes = new Map();
  for (const e of eps) { const u = `${e.lab}/${e.unit}`; fixes.set(u, (fixes.get(u) ?? 0) + (e.fixed?.length ?? 0)); }
  const res = {};
  for (const r of rows) { const x = (res[r.skill] ??= { reads: 0, unitSet: new Set() }); x.reads++; if (r.unit) x.unitSet.add(r.unit); }
  for (const [n, x] of Object.entries(res)) {
    const w = [...x.unitSet].filter((u) => fixes.has(u)), wo = [...fixes.keys()].filter((u) => !x.unitSet.has(u));
    const avg = (us) => (us.length ? us.reduce((a, u) => a + fixes.get(u), 0) / us.length : null);
    res[n] = { reads: x.reads, units: x.unitSet.size, fixesWith: avg(w), fixesWithout: avg(wo) };
  }
  return res;
}

// ---------- growth of the skills layer (skill growth prints this after the rules layer) ----------
export function growthLines(hist) {
  const g = grades(), log = g.log ?? [], first = log[0], last = log.at(-1), outL = [];
  if (!last) { outL.push('  L2 skills: never graded (node lab.mjs skill grade)'); return { lines: outL, next: ['skill grade: score every skill against skills/rubric.json'] }; }
  const kept = (g.refine ?? []).filter((x) => x.kept).length, rev = (g.refine ?? []).filter((x) => !x.kept).length;
  outL.push(`  L2 skills: grade ${last.mean}%${first && first !== last ? ` (gen 1 ${first.mean}%, ${first.at})` : ''} · route first-pick dev ${last.route?.dev ?? '-'}% held-out ${last.route?.held ?? '-'}% · refinements ${kept} kept / ${rev} reverted · drafts ${Object.values(g.skills ?? {}).filter((s) => s.status === 'draft').length}`);
  const weakest = Object.entries(last.scores).sort((a, b) => a[1] - b[1]).slice(0, 3);
  if (log.length > 1) outL.push(`      history: ${log.slice(-6).map((x) => `gen ${x.gen} ${x.mean}%/${x.route?.held ?? '-'}%`).join(' · ')}`);
  const refs = Object.entries(g.ref ?? {});
  if (refs.length) outL.push(`      references (portable criteria): ${refs.map(([n, r]) => `${n} ${r.portable}%`).join(' · ')}`);
  const u = usage(), names = skillNames(), unread = names.filter((n) => !u[n]);
  if (Object.keys(u).length) outL.push(`      used: ${Object.entries(u).sort((a, b) => b[1].reads - a[1].reads).slice(0, 5).map(([n, x]) => `${n} ${x.reads}×`).join(' · ')}${unread.length ? ` · never read: ${unread.length}` : ''}`);
  // L3: does the rubric predict real results? each bench recorded the grade it ran with
  const hb = (hist ?? []).filter((h) => h.grade !== undefined && h.on?.runs);
  let valid = null;
  if (hb.length >= 3) { let agree = 0, pairs = 0; for (let i = 1; i < hb.length; i++) { const dg = hb[i].grade - hb[i - 1].grade, dp = hb[i].on.pass / hb[i].on.runs - hb[i - 1].on.pass / hb[i - 1].on.runs; if (dg && dp) { pairs++; if (Math.sign(dg) === Math.sign(dp)) agree++; } } valid = { agree, pairs }; }
  outL.push(`  L3 rubric v${RUBRIC().version}, ${RUBRIC().criteria.length} criteria: ${valid ? (valid.pairs ? `grade and bench moved together in ${valid.agree}/${valid.pairs} bench pairs${valid.agree / valid.pairs < 0.5 ? ' — the rubric does not predict results: rewrite the criteria that rose without passes' : ''}` : 'benches so far did not change both') : `validity unknown (${hb.length}/3 benches with a grade: skill bench records it)`}`);
  const next = [];
  // a grade every skill tops out no longer tells skills apart: the bar has to rise (a new criterion from a bench failure
  // or a reference), and only a bench says whether the rubric measures anything real
  if (last.mean >= 90) {
    const cands = RUBRIC().candidates ?? [], open = cands.filter((c) => c.calibrated?.verdict === 'adoptable');
    if (open.length) next.push(`grade ${last.mean}%: the rubric is near its ceiling and ${open.map((c) => c.id).join(' ')} is adoptable: skill rubric adopt ${open[0].id}`);
    else if (cands.length && cands.every((c) => c.calibrated)) next.push(`grade ${last.mean}%: the rubric is near its ceiling and the references offer no stricter part with a signal (rubric calibrate): only a bench can raise the bar now (skill bench --via <ai> --runs 3)`);
    else next.push(`grade ${last.mean}%: the rubric is near its ceiling — skill rubric mine + calibrate (a stricter part from the references), or a criterion from a bench failure (version + 1)`);
  }
  if (weakest.length && weakest[0][1] < 80) next.push(`skill refine ${weakest[0][0]} (${weakest[0][1]}%, the weakest)`);
  if (last.route?.held !== null && last.route?.held < 80) next.push('routing held-out under 80%: skill route --eval, add words to triggers.txt / descriptions (not the held-out sentences themselves)');
  const drafts = Object.entries(g.skills ?? {}).filter(([, s]) => s.status === 'draft' && s.scope !== 'lab').map(([n]) => n);
  if (drafts.length) next.push(`draft skill(s) ${drafts.join(' ')}: skill bench --without <name> decides`);
  if (!refs.length) next.push('skill grade --ref <repo>: compare with a reference collection');
  return { lines: outL, next };
}

// ---------- install helpers: what one AI gets on top of the shared SKILL.md ----------
export function overlay(name, ai) { try { return fs.readFileSync(path.join(SK, name, 'ai', `${ai}.md`), 'utf8').trim(); } catch { return ''; } }
