// node lab.mjs record [-a <unit>] "<cmd>" ["<cmd>" ...] [--title "<t>"] [--append]: what those commands really print, as a
// tests.txt section to keep: run twice on fresh servers; a line the same both times becomes `= line`, one whose numbers change
// `~ ^regex$`, one that changes otherwise is left out. Script errors are said, never recorded. It is what the addon does NOW:
// read it before keeping it (a wrong behaviour recorded is a wrong test). --append adds it to tests.txt.
import fs from 'node:fs';
import path from 'node:path';
import * as CP from './checkpoint.mjs';
import { trial, joinsFor, playersIn } from './trial.mjs';

const NOISE = /^(EV |ST |X |PERF |PROF |COV |trace |events (on|off)|states (on|off)|cov( on)?$|W )/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** one expectation for a line seen in two runs: `= a`, `~ ^…$` when only numbers differ, null otherwise */
export function expect(a, b) {
  if (a === b) return `= ${a}`;
  const num = /-?\d+(?:\.\d+)?/g, pa = a.split(num), pb = b.split(num);
  if (pa.length !== pb.length || pa.some((x, i) => x !== pb[i])) return null;
  const na = a.match(num), nb = b.match(num);
  return `~ ^${pa.map((x, i) => esc(x) + (i < na.length ? (na[i] === nb[i] ? esc(na[i]) : '-?\\d+(\\.\\d+)?') : '')).join('')}$`;
}
/** the section from two runs' segments: [cmd, [expectations]] per command; errors: the script errors seen. `setup`: that many
 *  lines first (the joins it needed) run but get no expectations */
export function section(cmds, segsA, segsB, setup = 0) {
  const at = (segs, i) => (segs[i + 1]?.out ?? []).filter((l) => !NOISE.test(l) && !l.startsWith('E '));
  const res = [], errors = new Set();
  for (const g of [...segsA, ...segsB]) for (const l of g.out) if (l.startsWith('E ')) errors.add(l);
  cmds.forEach((c, i) => {
    if (i < setup) { res.push([c, []]); return; }
    const a = at(segsA, i), b = at(segsB, i), exp = [];
    // what players see first (chat, title, forms), then the rest; at most 6 per command
    const order = [...a.keys()].sort((x, y) => Number(!a[x].startsWith('@')) - Number(!a[y].startsWith('@')) || x - y);
    for (const j of order) {   // the same line in the other run (anywhere: async order), else one of the same shape
      const e = b.includes(a[j]) ? `= ${a[j]}` : b.map((x) => expect(a[j], x)).find(Boolean) ?? null;
      if (e && !exp.includes(e)) exp.push(e);
      if (exp.length >= 6) break;
    }
    res.push([c, exp]);
  });
  return { res, errors: [...errors] };
}

export async function recordCmd(args, out = console.log) {
  const k = CP.labKind(), u = CP.currentUnit(k, args), opt = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
  const cmds = args.filter((a, i) => !a.startsWith('--') && a !== '-a' && !['-a', '--title'].includes(args[i - 1]));
  if (!cmds.length) { out('usage: node lab.mjs record "<cmd>" ["<cmd>" ...] [--title "<t>"] [--append]   (e.g. record "@A join" "@A cmd /lab:shop" "@A form 0")'); return false; }
  const title = opt('--title') ?? `recorded: ${cmds.map((c) => c.replace(/^@\w+ /, '')).join(', ').slice(0, 60)}`;
  // a player the commands use joins first (a no-op where an earlier section joined it): the section stands on its own
  let tests = ''; try { tests = fs.readFileSync(path.join(CP.unitDir(k, u), 'tests.txt'), 'utf8'); } catch { /* none */ }
  const joins = joinsFor(cmds, new Set([...playersIn(tests), ...playersIn(cmds.join('\n'))])), all = [...joins, ...cmds];
  const text = `## ${title}\n${all.join('\n')}\n`;
  out(`record ${u}: ${cmds.length} command(s), twice on fresh servers...`);
  const a = trial(k, u, text), b = trial(k, u, text);
  if (!a.segs.length || !b.segs.length) { a.lines.filter((l) => /^(E |ERR|FAIL)/.test(l)).slice(0, 8).forEach((l) => out(l)); out('FAIL record: the run did not start'); return false; }
  const { res, errors } = section(all, a.segs, b.segs, joins.length);
  const body = [`## ${title}`, ...res.flatMap(([c, e]) => [c, ...e])].join('\n');
  out(body);
  for (const e of errors.slice(0, 4)) out(`W ${e}  (a script error now: not recorded; fix it)`);
  if (args.includes('--append')) {
    const f = path.join(CP.unitDir(k, u), 'tests.txt'), cur = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, cur.replace(/\s*$/, '\n\n') + body + '\n');
    out(`OK appended to tests.txt (${res.reduce((n, [, e]) => n + e.length, 0)} expectations): it is what the addon does now, check it is what it should do`);
  } else out(`OK ${res.reduce((n, [, e]) => n + e.length, 0)} expectations from what it does now (check them; --append adds the section to tests.txt)`);
  return !errors.length;
}
