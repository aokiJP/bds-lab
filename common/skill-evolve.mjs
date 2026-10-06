// The measuring stick grows too, and the skills leave the lab as one prompt for any AI.
//   skill compare [--ref <dir|url>]...      ours and every reference collection on the portable criteria, side by side
//   skill rubric                            the criteria (version, source), the candidates, the retired ones
//   skill rubric mine [--ref ...]           parts most skills of a reference have and ours lack (a heading, an `Input:` line)
//                                           → candidates in skills/rubric.json (a pattern: no code needed to check one)
//   skill rubric calibrate [--ref ...]      for each criterion and candidate: does it tell skills apart (or is everyone at 2),
//                                           do reference skills that have it score higher on the rest, is it the same as one
//                                           we have; and whether the grade has followed the bench (L3)
//   skill rubric adopt <id> [--force]       a candidate calibrate called adoptable → a criterion (rubric version + 1)
//   skill rubric retire <id> "<why>"        a criterion that no longer separates anything (version + 1)
//   skill prompt --for <ai> [--budget <bytes>] [--skills a,b|all] [--out <file>] [--drafts]
//                                           one system prompt from the skills for an AI that has no skill folder (a chat, an
//                                           API call): the router, then whole skills in order of use and grade, in budget
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SK, sourceDir, skillNames } from './skills.mjs';
import { collection, ours, gradeAll, routeEval, grades, statusOf, forAI, AIS, patternCount, usage } from './skill-forge.mjs';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RF = () => path.join(SK, 'rubric.json');
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const val = (args, key, d) => { const i = args.indexOf(key); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const vals = (args, key) => args.flatMap((a, i) => (a === key && args[i + 1] !== undefined ? [args[i + 1]] : []));
const pct = (x) => `${Math.round(x * 100)}%`;
const today = () => new Date().toISOString().slice(0, 10);
const saveRubric = (r) => fs.writeFileSync(RF(), JSON.stringify(r, null, 2) + '\n');

/** reference collections: --ref ones, else every folder in .lab/skill-sources (skill grade --ref / learn --from fetch them) */
function refs(args) {
  const want = vals(args, '--ref'), base = path.join(TOP, '.lab', 'skill-sources');
  const dirs = want.length ? want.map(sourceDir) : (() => { try { return fs.readdirSync(base).map((x) => path.join(base, x)).filter((d) => fs.statSync(d).isDirectory()); } catch { return []; } })();
  return dirs.map((d) => ({ name: path.basename(d), dir: d, list: collection(d) })).filter((r) => r.list.length)
    .map((r) => ({ ...r, graded: gradeAll(r.list, { lab: false, entryFile: path.join(r.dir, 'AGENTS.md') }) }));
}
const portableCrit = () => readJ(RF(), { criteria: [] }).criteria.filter((c) => c.scope === 'portable');

export function compare(args, out = console.log) {
  const R = refs(args), mine = gradeAll(ours(), { lab: true, route: routeEval() }), crit = portableCrit();
  if (!R.length) { out('no reference collections yet: skill compare --ref https://github.com/iMasterProX/mcbemodelingmasterAI (fetched once into .lab/skill-sources)'); return false; }
  const cols = [['bds-lab', mine], ...R.map((r) => [r.name, r.graded])];
  const w = 12;
  out(`${'criterion'.padEnd(14)}${cols.map(([n]) => n.slice(0, w - 1).padStart(w)).join('')}`);
  for (const c of crit) out(`${c.id.padEnd(14)}${cols.map(([, g]) => (g.reduce((a, r) => a + (r.R[c.id] ?? 0), 0) / g.length).toFixed(2).padStart(w)).join('')}`);
  out(`${'portable'.padEnd(14)}${cols.map(([, g]) => pct(g.reduce((a, r) => a + r.portable, 0) / g.length).padStart(w)).join('')}`);
  out(`${'skills'.padEnd(14)}${cols.map(([, g]) => String(g.length).padStart(w)).join('')}`);
  // where a reference leads: the criterion and its best line
  for (const c of crit) {
    const ourAvg = mine.reduce((a, r) => a + (r.R[c.id] ?? 0), 0) / mine.length;
    for (const r of R) { const avg = r.graded.reduce((a, x) => a + (x.R[c.id] ?? 0), 0) / r.graded.length; const best = r.graded.find((x) => x.R[c.id] === 2 && x.at[c.id]); if (avg > ourAvg + 0.1 && best) out(`  ${c.id}: ${r.name} leads (${avg.toFixed(2)} vs ${ourAvg.toFixed(2)}), e.g. ${best.name}: "${best.at[c.id]}"`); }
  }
  // the comparison is part of the growth record (skill growth: references)
  try { const g = readJ(path.join(SK, 'grades.json'), null); if (g) { const om = Math.round(mine.reduce((a, r) => a + r.portable, 0) / mine.length * 100); for (const r of R) g.ref = { ...(g.ref ?? {}), [r.name]: { at: today(), skills: r.graded.length, portable: Math.round(r.graded.reduce((a, x) => a + x.portable, 0) / r.graded.length * 100), ours: om } }; fs.writeFileSync(path.join(SK, 'grades.json'), JSON.stringify(g, null, 1) + '\n'); } } catch { /* read-only */ }
  out('(the criteria were written here from these references and SkillsBench: a higher score shows we follow them, not that our skills work better; skill bench decides that)');
  return true;
}

// ---------- the rubric itself ----------
function features(body) {
  const f = new Map();
  for (const m of body.matchAll(/^#{2,3}[ \t]+(.+?)[ \t]*$/gm)) { const t = m[1].toLowerCase().replace(/[`*_:()]/g, '').replace(/\s+/g, ' ').trim(); if (t.length >= 3 && t.length <= 30 && !/^\d/.test(t)) f.set(`heading:${t}`, `^#{2,3}[ \\t]+${t.split(' ').map((x) => x.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')).join('\\W+')}`); }
  for (const m of body.matchAll(/^[ \t]*(?:[-*][ \t]+)?\*{0,2}([A-Z][A-Za-z]{2,14}(?: [A-Za-z]{2,10})?)\*{0,2}:[ \t]/gm)) { const t = m[1].toLowerCase(); f.set(`label:${t}`, `^[ \\t]*(?:[-*][ \\t]+)?\\*{0,2}${t.replace(/ /g, '[ \\t]+')}\\*{0,2}:`); }
  return f;
}
export function mine(args, out = console.log) {
  const R = refs(args), mineL = ours(), rub = readJ(RF(), { criteria: [] });
  if (!R.length) { out('no reference collections: skill rubric mine --ref <dir|url>'); return false; }
  const prev = (list, key) => list.filter((s) => features(s.body).has(key)).length / list.length;
  const keys = new Map();
  for (const r of R) for (const s of r.list) for (const [k, re] of features(s.body)) keys.set(k, re);
  const known = [...rub.criteria, ...(rub.candidates ?? []), ...(rub.retired ?? [])].map((c) => c.feature ?? c.id);
  const found = [];
  for (const [k, re] of keys) {
    const by = Object.fromEntries(R.filter((r) => r.list.length >= 5).map((r) => [r.name, prev(r.list, k)]));
    const top = Math.max(0, ...Object.values(by)), o = prev(mineL, k);
    if (top < 0.5 || o >= 0.5 || known.includes(k)) continue;
    found.push({ id: 'pat-' + k.replace(/^\w+:/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30), feature: k, re, scope: 'portable', prevalence: Object.fromEntries(Object.entries(by).map(([n, v]) => [n, Math.round(v * 100)])), ours: Math.round(o * 100), mined: today() });
  }
  found.sort((a, b) => Math.max(...Object.values(b.prevalence)) - Math.max(...Object.values(a.prevalence)));
  const fresh = found.filter((c) => !(rub.candidates ?? []).some((x) => x.id === c.id)).slice(0, 8);
  rub.candidates = [...(rub.candidates ?? []), ...fresh];
  saveRubric(rub);
  for (const c of fresh) out(`+ ${c.id}: ${c.feature} in ${Object.entries(c.prevalence).map(([n, v]) => `${n} ${v}%`).join(', ')}; ours ${c.ours}%`);
  out(`OK rubric mine: ${fresh.length} new candidate(s), ${(rub.candidates ?? []).length} waiting (skill rubric calibrate says which carry a signal)`);
  return true;
}
// phi: how alike two yes/no columns are (1 = the same test under another name)
const phi = (a, b) => { let n11 = 0, n10 = 0, n01 = 0, n00 = 0; for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) n11++; else if (a[i]) n10++; else if (b[i]) n01++; else n00++; } const d = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00)); return d ? (n11 * n00 - n10 * n01) / d : 0; };
export function calibrate(args, out = console.log, { quiet = false } = {}) {
  const R = refs(args), rub = readJ(RF(), { criteria: [] }), crit = portableCrit();
  const mineG = gradeAll(ours(), { lab: true, route: routeEval() }), refG = R.flatMap((r) => r.graded.map((g, i) => ({ ...g, body: r.list[i].body, repo: r.name })));
  const verdicts = {};
  const say = (l) => { if (!quiet) out(l); };
  if (!refG.length) { say('no reference collections: calibrate needs one (skill compare --ref <url>)'); }
  // the criteria we have: still telling skills apart?
  for (const c of rub.criteria) {
    const o2 = mineG.filter((g) => g.R[c.id] === 2).length / mineG.length, r2 = refG.length && c.scope === 'portable' ? refG.filter((g) => g.R[c.id] === 2).length / refG.length : null;
    // a gate (the name format, a size cap) is a must: everyone passing is the point, not a lost signal
    const v = c.gate ? 'gate' : o2 >= 0.95 && (r2 === null || r2 >= 0.95) ? 'saturated' : o2 >= 0.95 ? 'ours-done' : 'separates';
    verdicts[c.id] = v;
    say(`${c.id.padEnd(14)} ours at 2: ${pct(o2)}${r2 !== null ? `, references: ${pct(r2)}` : c.scope === 'lab' ? ' (lab only)' : ''} → ${v === 'gate' ? 'a gate (a must; all passing is expected)' : v === 'saturated' ? 'SATURATED (no signal here: tighten it or retire it)' : v === 'ours-done' ? 'ours all pass; still separates the references' : 'separates'}`);
  }
  // candidates: signal (within a repository, skills that have it score higher on the portable rest), then redundancy (the same
  // test as a criterion, or as a stronger candidate: of a group that always comes together only the strongest is adoptable)
  const cands = rub.candidates ?? [], hasOf = (c) => refG.map((g) => patternCount(g.body, c.re) > 0);
  const avg = (xs) => xs.reduce((a, g) => a + g.portable, 0) / xs.length;
  for (const c of cands) {
    const has = hasOf(c);
    // lift within each repository (a better-written repository that also uses the part would fake a signal): the weighted
    // mean of (with − without) over repositories that have both, 3+ skills each
    let lw = 0, ln = 0;
    for (const r of R) { const gs = refG.filter((g) => g.repo === r.name), a = gs.filter((g) => patternCount(g.body, c.re) > 0), b = gs.filter((g) => !patternCount(g.body, c.re)); if (a.length >= 3 && b.length >= 3) { lw += (avg(a) - avg(b)) * gs.length; ln += gs.length; } }
    const lift = ln ? lw / ln : null;
    let same = null; for (const k of crit) { const p = phi(has, refG.map((g) => g.R[k.id] === 2)); if (Math.abs(p) >= 0.8) { same = `${k.id} (phi ${p.toFixed(2)})`; break; } }
    c.calibrated = { at: today(), lift: lift === null ? null : Math.round(lift * 100), same, verdict: same ? 'redundant' : lift !== null && lift >= 0.05 ? 'adoptable' : 'no-signal', n: refG.length, with: has.filter(Boolean).length };
  }
  const strong = cands.filter((c) => c.calibrated.verdict === 'adoptable').sort((a, b) => b.calibrated.lift - a.calibrated.lift || b.calibrated.with - a.calibrated.with);
  for (let i = 0; i < strong.length; i++) for (let j = 0; j < i; j++) if (strong[j].calibrated.verdict === 'adoptable' && phi(hasOf(strong[i]), hasOf(strong[j])) >= 0.8) { strong[i].calibrated.verdict = 'redundant'; strong[i].calibrated.same = `candidate ${strong[j].id} (always together: adopt that one)`; break; }
  for (const c of cands) {
    const k = c.calibrated; verdicts[c.id] = k.verdict;
    say(`candidate ${c.id}: in ${k.with}/${k.n} reference skills; within a repository, skills with it score ${k.lift === null ? '- (no repository has 3+ with and 3+ without)' : (k.lift >= 0 ? '+' : '') + k.lift + 'pt'} on the rest${k.same ? `; the same as ${k.same}` : ''} → ${k.verdict.toUpperCase()}${k.verdict === 'no-signal' && k.lift !== null ? ' (adoptable from +5pt)' : ''}`);
  }
  saveRubric(rub);
  // L3: the grade against the bench (each bench records the grade it ran with)
  const hb = readJ(path.join(SK, 'history.json'), []).filter((h) => h.grade !== undefined && h.on?.runs);
  say(hb.length >= 3 ? `bench: ${hb.length} runs with a grade (skill growth shows whether they moved together)` : `bench: ${hb.length}/3 runs with a grade — until then the rubric is judged by the references only (skill bench --via <ai> --runs 3)`);
  return verdicts;
}
export function adopt(args, out = console.log) {
  const [id] = args.filter((a) => !a.startsWith('--')), rub = readJ(RF(), { criteria: [] }), c = (rub.candidates ?? []).find((x) => x.id === id);
  if (!c) { out(`ERR no candidate ${id} (skill rubric lists them; skill rubric mine finds them)`); return false; }
  const v = c.calibrated?.verdict ?? calibrate(args, out, { quiet: true })[id];
  if (v !== 'adoptable' && !args.includes('--force')) { out(`ERR ${id} is ${v ?? 'not calibrated'}: only an adoptable candidate joins the rubric (skill rubric calibrate; --force overrides, and the next bench will judge it)`); return false; }
  const label = c.feature.replace(/^\w+:/, '');
  rub.criteria.push({ id, scope: 'portable', re: c.re, two: 1, what: `has the part most skills of ${Object.keys(c.prevalence).join(', ')} have: "${label}"`, fix: `add a "${label}" ${c.feature.startsWith('heading') ? 'section' : 'line'} the way the references do (skill compare shows one)`, source: `mined from ${Object.entries(c.prevalence).map(([n, p]) => `${n} ${p}%`).join(', ')} (ours ${c.ours}%); calibrate: ${c.calibrated ? `+${c.calibrated.lift}pt with it, ${c.calibrated.n} skills` : 'forced'}` });
  rub.candidates = rub.candidates.filter((x) => x.id !== id);
  rub.version = (rub.version ?? 1) + 1;
  rub.about = `${rub.about} v${rub.version}: adopted ${id} (${today()}).`;
  saveRubric(rub);
  out(`OK rubric v${rub.version}: ${id} is a criterion; node lab.mjs skill grade (a new generation), then skill refine weakest`);
  return true;
}
export function retire(args, out = console.log) {
  const [id, ...why] = args.filter((a) => !a.startsWith('--')), rub = readJ(RF(), { criteria: [] }), i = rub.criteria.findIndex((x) => x.id === id);
  if (i < 0) { out(`ERR no criterion ${id}`); return false; }
  if (!why.length) { out('ERR say why: skill rubric retire <id> "<why: e.g. saturated everywhere in calibrate>"'); return false; }
  const [c] = rub.criteria.splice(i, 1);
  rub.retired = [...(rub.retired ?? []), { ...c, retired: { at: today(), why: why.join(' ') } }];
  rub.version = (rub.version ?? 1) + 1; rub.about = `${rub.about} v${rub.version}: retired ${id} (${today()}).`;
  saveRubric(rub);
  out(`OK rubric v${rub.version}: ${id} retired`);
  return true;
}
export function rubricCmd(args, out = console.log) {
  const [sub, ...rest] = args;
  if (sub === 'mine') return mine(rest, out);
  if (sub === 'calibrate') { calibrate(rest, out); return true; }
  if (sub === 'adopt') return adopt(rest, out);
  if (sub === 'retire') return retire(rest, out);
  const rub = readJ(RF(), { criteria: [] });
  out(`rubric v${rub.version ?? 1}: ${rub.criteria.length} criteria (skills/rubric.json)`);
  for (const c of rub.criteria) out(`  ${c.id.padEnd(14)} ${c.scope.padEnd(8)} ${c.what.slice(0, 90)}${c.re ? ' [pattern]' : ''}`);
  for (const c of rub.candidates ?? []) out(`  candidate ${c.id}: ${c.feature} (${Object.entries(c.prevalence).map(([n, v]) => `${n} ${v}%`).join(', ')}; ours ${c.ours}%)${c.calibrated ? ` → ${c.calibrated.verdict}` : ''}`);
  for (const c of rub.retired ?? []) out(`  retired ${c.id}: ${c.retired.why}`);
  out('mine | calibrate | adopt <id> | retire <id> "<why>"');
  return true;
}

// ---------- one system prompt for any AI ----------
export function prompt(args, out = console.log) {
  const ai = val(args, '--for', null), budget = Number(val(args, '--budget', 24000)), want = val(args, '--skills', null), file = val(args, '--out', null);
  if (!ai || !AIS.includes(ai)) { out(`usage: node lab.mjs skill prompt --for <${AIS.join('|')}> [--budget <bytes>] [--skills a,b|all] [--out <file>] [--drafts]`); return false; }
  const g = grades(), last = g.log?.at(-1)?.scores ?? {}, use = usage();
  let names = skillNames().filter((n) => g.skills?.[n]?.scope !== 'lab' && (args.includes('--drafts') || statusOf(n) !== 'draft'));
  if (want && want !== 'all') names = names.filter((n) => want.split(',').includes(n));
  const read = (n) => forAI(fs.readFileSync(path.join(SK, n, 'SKILL.md'), 'utf8'), ai);
  const desc = (t) => /^description: (.*)$/m.exec(t)?.[1] ?? '';
  const order = [...names].sort((a, b) => (a.endsWith('-master') ? -1 : b.endsWith('-master') ? 1 : ((use[b]?.reads ?? 0) - (use[a]?.reads ?? 0)) || ((last[b] ?? 0) - (last[a] ?? 0))));
  const lab = path.join(TOP, 'lab.mjs');
  let text = `# Minecraft Bedrock addon skills (bds-lab), for ${ai}\nYou build and fix Minecraft Bedrock addons, Endstone plugins and LeviLamina mods. Pick the ONE skill below that fits the request and follow it; read nothing else unless it says so. When bds-lab is on this machine, every \`node lab.mjs ...\` runs in ${path.dirname(lab)}; without it, follow the steps as far as they need no lab command and say which checks you could not run.\n\n## Which skill\n${order.map((n) => `- ${n}: ${desc(read(n))}`).join('\n')}\n`;
  // whole skills while they fit; the line naming the rest counts too (it alone took a 9000-byte prompt to 9232): the last
  // skill taken goes back to that line until both fit
  const parts = [], partOf = (n) => `\n## Skill: ${n}\n${read(n).replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!-- rules:(begin|end)[^>]*-->\n?/g, '').trim().replace(/^# .*\n+/, '')}\n`;
  const restLine = (l) => (l.length ? `\n(Not included for size: ${l.join(', ')}${fs.existsSync(lab) ? ` — read with node lab.mjs skill <name>` : ''}.)\n` : '');
  for (const n of order) { const part = partOf(n); if (Buffer.byteLength(text + parts.map((x) => x.part).join('') + part) <= budget) parts.push({ n, part }); }
  const leftOf = () => order.filter((n) => !parts.some((x) => x.n === n));
  while (parts.length && Buffer.byteLength(text + parts.map((x) => x.part).join('') + restLine(leftOf())) > budget) parts.pop();
  // (then a smaller one passed over may fit in the room that left, in the same order)
  for (const n of leftOf()) {
    const part = partOf(n), next = [...parts, { n, part }].sort((a, b) => order.indexOf(a.n) - order.indexOf(b.n));
    if (Buffer.byteLength(text + next.map((x) => x.part).join('') + restLine(order.filter((m) => !next.some((x) => x.n === m)))) <= budget) parts.splice(0, parts.length, ...next);
  }
  const left = leftOf();
  text += parts.map((x) => x.part).join('') + restLine(left);
  if (file) { const f = path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), file); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); out(`OK ${f}: ${Buffer.byteLength(text)} bytes, ${order.length - left.length}/${order.length} skills whole${left.length ? `, ${left.length} named only` : ''}`); }
  else out(text.trimEnd());
  return true;
}
