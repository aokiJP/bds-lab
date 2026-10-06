// node lab.mjs chaos [-a <unit>] [steps=30] [--seed n] [--runs n] [--append]: real players play the unit at random — its
// commands with random arguments (forms answered at random), its items used, its blocks placed and clicked, its entities hit,
// the events it listens to set off, a second player joining and leaving, a restart — until a script error. The players are
// ones tests.txt does not use, so the case starts from players nothing set up. The steps that led to the error are cut to the
// fewest that still cause it (each try a fresh server), then run after the sections already in tests.txt: printed as a section
// to paste only once it fails there too (it fails until the bug is fixed, then keeps it fixed); --append adds it. Same seed,
// same play. Zero tokens.
// node lab.mjs shrink [-a <unit>] ["<## section>"] [--max n]: a failing section cut the same way (its lines and the sections
// before it; a player it still uses joins first) to the fewest that still fail the same way: the smallest case to read or report.
import fs from 'node:fs';
import path from 'node:path';
import * as CP from './checkpoint.mjs';
import { trial, sectionsOf, SCRIPT_ERR, sig, ddmin, playersIn, freshNames, renamePlayers, joinsFor, cameInstead } from './trial.mjs';
import { handlers } from './gaps.mjs';

export function mulberry(a) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const VAL = { int: ['0', '1', '3', '64', '-1', '999'], float: ['0.5', '1', '-2.5', '100'], string: ['hi', 'x', '"two words"', '""'], bool: ['true', 'false'], player: ['A', 'B', '@a', '@s'], entity: ['@s', '@e[type=pig]', '@e'], loc: ['~ ~ ~', '1 -60 1', '0 300 0'], item: ['diamond', 'stick'], block: ['stone', 'air'] };
function srcOf(dir) {
  const base = fs.existsSync(path.join(dir, 'src')) ? 'src' : path.join('bp', 'scripts'), res = [];
  const walk = (d) => { let es = []; try { es = fs.readdirSync(path.join(dir, d), { withFileTypes: true }); } catch { return; } for (const e of es) { const r = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|lib)$/.test(e.name)) walk(r); } else if (/\.([cm]?[jt]s|py)$/.test(e.name) && !/\.d\.ts$|^kit\.[jt]s$|^lab_features|^__lab|^test_/.test(e.name)) res.push(fs.readFileSync(path.join(dir, r), 'utf8')); } };
  walk(base);
  return res;
}
/** what players can do with this unit: { cmds: [{ id, ps: [{ opt, t }] }], acts: [[cmd lines]] } (from its code: gaps.handlers) */
export function surface(dir) {
  const texts = srcOf(dir), cmds = [], acts = [];
  for (const t of texts) {
    for (const m of t.matchAll(/\bcmd(?:Any)?\(\s*['"]([\w-]+:[\w-]+)['"]\s*,\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*\{([^}]*)\}/g))
      cmds.push({ id: m[1], ps: [...m[2].matchAll(/(['"]?)(\w+)(\??)\1\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)].map((x) => ({ opt: !!x[3], t: x[4] })) });
    // LeviLamina (LSE): const c = mc.newCommand('name', ..); c.mandatory('x', ParamType.Int); c.optional(..)
    const LT = { Int: "'int'", Float: "'float'", String: "'string'", RawText: "'string'", Bool: "'bool'", Player: "'player'", Actor: "'entity'", BlockPos: "'loc'", Vec3: "'loc'", Item: "'item'", Block: "'block'" };
    for (const m of t.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*mc\.newCommand\(\s*['"]([\w-]+)['"]/g)) {
      const ps = [...t.matchAll(new RegExp(`\\b${m[1]}\\.(mandatory|optional)\\(\\s*['"](\\w+)['"]\\s*,\\s*ParamType\\.(\\w+)`, 'g'))].map((x) => ({ opt: x[1] === 'optional', t: LT[x[3]] ?? "'string'" }));
      cmds.push({ id: m[2], ps });
    }
    // Endstone (Python): commands = {"name": {"usages": ["/name <x: int> [y: str]"]}}
    for (const m of t.matchAll(/["']usages["']\s*:\s*\[\s*["']\/([\w-]+)([^"']*)["']/g)) {
      const PT = { int: "'int'", float: "'float'", str: "'string'", message: "'string'", bool: "'bool'", player: "'player'", target: "'player'", actor: "'entity'", pos: "'loc'", block: "'block'" };
      const ps = [...m[2].matchAll(/(?:\(([^)]*)\))?([<\[])\s*\w+\s*:\s*(\w+)/g)].map((x) => ({ opt: x[2] === '[', t: x[1] ? `[${x[1].split('|').map((v) => `'${v}'`).join(',')}]` : PT[x[3]] ?? "'string'" }));
      cmds.push({ id: m[1], ps });
    }
    for (const h of handlers(t)) if (!h.what.startsWith('/') && !h.how.startsWith('(') && !/<\w+>/.test(h.how) && !/\(\)$|^later|^an interval/.test(h.what)) acts.push(h.how.split(' · '));
  }
  return { cmds, acts };
}
const argsOf = (c, rnd) => c.ps.filter((p) => !p.opt || rnd() < 0.5).map((p) => { const vs = p.t.startsWith('[') ? [...p.t.matchAll(/['"]([^'"]*)['"]/g)].map((x) => x[1]) : VAL[p.t.slice(1, -1)] ?? ['1']; return vs[Math.floor(rnd() * vs.length)] ?? '1'; }).join(' ');
/** the random play: a list of test lines (starts with @A join) */
export function plan(surf, steps, rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)], p = ['@A join', 'wait 500'];
  let b = false, restarted = false;
  for (let s = 0; s < steps; s++) {
    const r = rnd();
    if (surf.cmds.length && r < 0.4) {
      const c = pick(surf.cmds), who = b && rnd() < 0.3 ? 'B' : 'A', a = argsOf(c, rnd);
      p.push(`@${who} cmd /${c.id}${a ? ' ' + a : ''}`);
      if (rnd() < 0.6) p.push(rnd() < 0.75 ? `@${who} form ${Math.floor(rnd() * 3)}` : `@${who} form close`);
    } else if (surf.acts.length && r < 0.75) p.push(...pick(surf.acts));
    else {
      const x = pick(['@B join', '@B leave', '@A chat hello', '@A walk forward 2', 'wait 400', 'time set night', 'summon pig 2 -60 2', '@A attack pig', '@A jump', 'restart']);
      if ((x === '@B join' && b) || (x === '@B leave' && !b) || (x === 'restart' && restarted)) continue;
      if (x === '@B join') b = true; if (x === '@B leave') b = false; if (x === 'restart') restarted = true;
      p.push(x);
    }
  }
  return p;
}
/** the first script error of a run and the plan line after which it showed: { line, at } or null */
export function firstError(segs) {
  for (let i = 0; i < segs.length; i++) { const l = segs[i].out.find((x) => SCRIPT_ERR.test(x)); if (l) return { line: l, at: Math.max(0, i - 1) }; }
  return null;
}

/** the section title for an error: the error itself (no "Unhandled promise rejection:" noise), cut at a word, no quotes */
export function titleFor(seed, line) {
  const e = String(line).replace(/^E /, '').replace(/\s+\(during: .*\)$/, '').replace(/^(?:\[Scripting\]\s*)?(?:(?:Uncaught|Unhandled promise rejection:)\s*)+/i, '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
  let t = `chaos ${seed}: ${e}`;
  if (t.length > 100) t = t.slice(0, 100).replace(/\s+\S*$/, '');
  return t.trim();
}

export async function chaosCmd(args, out = console.log) {
  const k = CP.labKind(), u = CP.currentUnit(k, args), dir = CP.unitDir(k, u), opt = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
  const steps = Number(args.find((a, i) => /^\d+$/.test(a) && !['-a', '--seed', '--runs', '--max'].includes(args[i - 1])) ?? 30), runs = Number(opt('--runs') ?? 1), maxRuns = Number(opt('--max') ?? 8);
  const surf = surface(dir);
  if (!surf.cmds.length && !surf.acts.length) { out(`${u}: nothing a player can do with it was found in its code (commands, items, blocks, events)`); return true; }
  const tf = path.join(dir, 'tests.txt'), tests = fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8') : '';
  // players the tests do not use: a case pasted after the other sections starts from players nothing set up, as it was found
  const [P1, P2] = freshNames(playersIn(tests)), names = { A: P1, B: P2 };
  let seed = Number(opt('--seed') ?? Date.now() % 100000);
  for (let n = 0; n < runs; n++, seed++) {
    const p = renamePlayers(plan(surf, steps, mulberry(seed)), names);
    out(`chaos ${u}: ${steps} random steps (${p.length} lines, players ${P1} ${P2}, ${surf.cmds.length} command(s), ${surf.acts.length} other action(s)), seed ${seed}...`);
    const r = trial(k, u, `## chaos\n${p.join('\n')}\n`);
    if (!r.segs.length) { r.lines.filter((l) => /^(E |ERR|FAIL)/.test(l)).slice(0, 6).forEach((l) => out(l)); out('FAIL chaos: the run did not start (node lab.mjs go)'); return false; }
    const f = firstError(r.segs);
    if (!f) continue;
    const want = sig(f.line), upto = p.slice(0, f.at + 1), same = (t) => t.segs.some((g) => g.out.some((l) => SCRIPT_ERR.test(l) && sig(l) === want));
    out(`FOUND after line ${f.at + 1} (${upto.at(-1)}): ${f.line.replace(/\s+\(during: .*\)$/, '')}`);
    const body = (sub) => [...joinsFor(sub, new Set([P1, P2])), ...sub];
    const cut = await ddmin(upto, (sub) => same(trial(k, u, `## chaos\n${body(sub).join('\n')}\n`)), { maxRuns });
    const title = titleFor(seed, f.line), lines = body(cut.items), section = [`## ${title}`, ...lines].join('\n');
    if (sectionsOf(tests).some((x) => x.title === title)) { out(`## ${title} is in tests.txt already: fix the code until it passes (node lab.mjs why "${title}")`); return false; }
    out(`cut to ${lines.length} of ${upto.length} lines in ${cut.runs} run(s)${cut.capped ? ` (stopped at --max ${maxRuns}: more runs may cut more)` : ''}; now after the ${sectionsOf(tests).length} section(s) of tests.txt...`);
    // the promise of a pasted case is that it fails: true on a fresh server, checked after the sections it will follow
    const ctx = trial(k, u, `${tests.trimEnd()}\n\n${section}\n`), holds = ctx.sec[title] === false && (ctx.why[title] ?? []).some((w) => /^E /.test(w) && sig(w.split(' @@ ')[0]) === want);
    out(section);
    if (!holds) {
      out(`W after the sections of tests.txt it does not fail (${ctx.sec[title] === undefined ? 'it did not run there' : ctx.sec[title] ? 'it passes: their world state hides the bug' : 'it fails another way: ' + (ctx.why[title]?.[0] ?? '?')}): run it on its own (node lab.mjs test <file> with the lines above), and fix the bug at the line in the error`);
      return false;
    }
    if (args.includes('--append')) {
      fs.writeFileSync(tf, tests.replace(/\s*$/, '\n\n') + section + '\n');
      out(`OK appended to tests.txt: it fails now, after the other sections too; fix the code until it passes (never the section)`);
    } else out('OK it fails after the sections of tests.txt too: paste it at the end of tests.txt (or chaos --append) and fix the code until it passes');
    out(`next: node lab.mjs why "${title}" (the values where it throws)`);
    return false;
  }
  out(`OK chaos ${u}: ${runs} run(s) of ${steps} steps, no script error (seed ${seed - runs}${runs > 1 ? `..${seed - 1}` : ''}; others: --seed ${seed} --runs 3)`);
  return true;
}

export async function shrinkCmd(args, out = console.log) {
  const k = CP.labKind(), u = CP.currentUnit(k, args), dir = CP.unitDir(k, u), maxRuns = Number((() => { const i = args.indexOf('--max'); return i < 0 ? 12 : args[i + 1]; })());
  const text = fs.readFileSync(path.join(dir, 'tests.txt'), 'utf8'), ls = text.split(/\r?\n/), secs = sectionsOf(text);
  let title = args.find((a, i) => !a.startsWith('-') && !['-a', '--max'].includes(args[i - 1]));
  if (!title) { try { title = JSON.parse(fs.readFileSync(path.join(CP.TOP, k, '.lab', 'last-fail', `${u}.json`), 'utf8')).secs?.[0]; } catch { /* none */ } }
  const s = secs.find((x) => x.title === title) ?? (title ? null : undefined);
  if (!s) { out(title ? `ERR no section "${title}" (${secs.map((x) => x.title).join(' | ')})` : 'usage: node lab.mjs shrink "<## section title>" (or after a failing test)'); return false; }
  const before = secs.filter((x) => x.from < s.from), head = ls.slice(0, secs[0]?.from ?? 0).filter((l) => l.trim() && !l.trim().startsWith('#'));
  // the section's lines in units: a command with its expectations (and its indented continuation lines)
  const units = [];
  for (const raw of ls.slice(s.from + 1, s.to)) { const l = raw.trim(); if (!l || l.startsWith('#')) continue; if (/^(!~|[=~!])/.test(l) || (/^\s{2,}\S/.test(raw) && units.length)) units.at(-1).push(raw); else units.push([raw]); }
  const items = [...(head.length ? [{ head }] : []), ...before.map((x) => ({ sec: x })), ...units.map((x) => ({ lines: x }))], names = playersIn(text);
  // a player the kept lines still use joins first (the section that joined it may be cut)
  const build = (sub) => {
    const pre = [...sub.filter((x) => x.head).flatMap((x) => x.head), ...sub.filter((x) => x.sec).flatMap((x) => ls.slice(x.sec.from, x.sec.to))], own = sub.filter((x) => x.lines).flatMap((x) => x.lines);
    const joins = joinsFor([...pre, ...own].filter((l) => !l.trim().startsWith('## ')), names);
    return [...joins, ...pre, `## ${title}`, ...own].join('\n') + '\n';
  };
  out(`shrink "${title}": ${units.length} command(s) and ${before.length} section(s) before it...`);
  const base = trial(k, u, build(items));
  if (base.sec[title] !== false) { out(base.sec[title] === undefined ? `ERR "${title}" did not run (node lab.mjs test says why)` : `OK "${title}" passes now: nothing to cut`); return base.sec[title] !== undefined; }
  const first = base.why[title]?.[0] ?? '', want = sig(first.split(' @@ ')[0]);
  const exp = /^expect (\S+) (.*)$/.exec(first), keep = exp ? items.map((x, i) => (x.lines?.some((l) => l.trim() === `${exp[1]} ${exp[2]}`) ? i : -1)).filter((i) => i >= 0) : [];
  // the same failure: the same expectation (or error), and for an expectation the same line coming instead of it
  const came = exp ? cameInstead(base, title, exp[2]) : null;
  const cut = await ddmin(items, (sub) => { const t = trial(k, u, build(sub)); return t.sec[title] === false && (t.why[title] ?? []).some((w) => sig(w.split(' @@ ')[0]) === want) && (!exp || cameInstead(t, title, exp[2]) === came); }, { keep, maxRuns });
  const nb = cut.items.filter((x) => x.sec).length;
  out(`cut to ${cut.items.filter((x) => x.lines).length} of ${units.length} command(s)${before.length ? ` and ${nb} of ${before.length} section(s) before it` : ''} in ${cut.runs} run(s)${cut.capped ? ` (stopped at --max ${maxRuns}: --max ${maxRuns * 2} may cut more)` : ''}; it still fails with: ${first.replace(/ @@ /, '   (during: ') + (first.includes(' @@ ') ? ')' : '')}${came ? ` (came instead: ${came})` : came === '' ? ' (nothing came instead)' : ''}`);
  build(cut.items).trimEnd().split('\n').forEach((l) => out(l));
  out(`next: node lab.mjs why "${title}" (the values where it fails)`);
  return true;
}
