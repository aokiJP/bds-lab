// One run of a tests.txt-like text on a fresh server, for the tools that look into a unit (why, record, chaos, shrink):
// what each command printed (LAB_DUMP), each section's verdict and why, the test's own lines. The unit is not changed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TOP } from './checkpoint.mjs';

let N = 0;
/** { ok, ran, lines, segs: [{ cmd, out }], sec: {title: pass}, why: {title: [why]} } */
export function trial(k, u, text, { env = {}, args = [] } = {}) {
  const d = path.join(TOP, k, '.lab', 'trial'), f = path.join(d, `${u}-${process.pid}-${N++}.txt`), dump = f + '.dump';
  fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(f, text.endsWith('\n') ? text : text + '\n');
  try {
    const r = spawnSync(process.execPath, [path.join(TOP, k, 'lab.mjs'), 'test', f, '-a', u, ...args], { cwd: path.join(TOP, k), encoding: 'utf8', maxBuffer: 256e6, timeout: 30 * 60_000,
      env: { ...process.env, LAB_DUMP: dump, LAB_SECTIONS: '1', LAB_NO_LASTFAIL: '1', LAB_NO_KITSYNC: '1', LAB_NOTRACE: '1', FORCE_COLOR: '0', ...env } });
    const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
    const segs = [];
    try { for (const l of fs.readFileSync(dump, 'utf8').split('\n')) { if (l.startsWith('> ')) segs.push({ cmd: l.slice(2) === 'null' ? null : l.slice(2), out: [] }); else if (segs.length && l) segs.at(-1).out.push(l); } } catch { /* it did not get that far */ }
    const sec = {}, why = {};
    for (const l of lines) { const m = /^SECTION (PASS|FAIL) (.*)$/.exec(l); if (m) sec[m[2]] = m[1] === 'PASS'; const w = /^SECTION WHY (.*?) :: (.*)$/.exec(l); if (w) (why[w[1]] ??= []).push(w[2]); }
    return { ok: r.status === 0 && lines.some((l) => /^PASS \d/.test(l)), ran: lines.some((l) => /^(PASS|FAIL) \d+\/\d+/.test(l)), lines, segs, sec, why };
  } finally { fs.rmSync(f, { force: true }); fs.rmSync(dump, { force: true }); }
}
/** the `## ` sections of a tests.txt text: [{ title, from, to }] (line indexes: the title line, the line after the last) */
export function sectionsOf(text) {
  const ls = text.split(/\r?\n/), res = [];
  ls.forEach((l, i) => { if (l.trim().startsWith('## ')) { if (res.length) res.at(-1).to = i; res.push({ title: l.trim().slice(3), from: i, to: ls.length }); } });
  return res;
}
/** a script error (not a refused command or a player's note): the line, normalized for comparing runs */
export const SCRIPT_ERR = /^E (?:\[Scripting\] )?(?:Uncaught )?(?:[\w.]*(?:TypeError|ReferenceError|RangeError|InternalError|SyntaxError|Error)\b|Unhandled promise rejection|.*\bBDS crashed\b|.*\b\w+(?:Error|Exception): )/;   // (the last: a Python traceback as one line (pytb.mjs), an LSE error)
export const sig = (l) => String(l).replace(/\s+\(during: .*\)$/, '').replace(/\b\d+(\.\d+)?\b/g, 'N').trim();
/** ddmin: a smallest sublist of `items` for which `test(sub)` stays true (indexes in `keep` stay); at most maxRuns tests.
 *  capped: it stopped at maxRuns before it was done (more runs may cut more) */
export async function ddmin(items, test, { keep = [], maxRuns = 8 } = {}) {
  let cur = items.map((_, i) => i).filter((i) => !keep.includes(i)), runs = 0, n = 2, done = !cur.length;
  const pick = (ix) => [...new Set([...keep, ...ix])].sort((a, b) => a - b).map((i) => items[i]);
  while (cur.length && runs < maxRuns) {
    const size = Math.max(1, Math.ceil(cur.length / n)); let cut = false;
    for (let s = 0; s < cur.length && runs < maxRuns; s += size) {
      const rest = cur.filter((_, j) => j < s || j >= s + size);
      runs++;
      if (await test(pick(rest))) { cur = rest; n = Math.max(2, n - 1); cut = true; break; }
    }
    if (!cut && runs < maxRuns) { if (size === 1) { done = true; break; } n = Math.min(cur.length, n * 2); }
    if (!cur.length) done = true;
  }
  return { items: pick(cur), runs, capped: !done };
}

// ---- real players in test lines: who is used, fresh names, renaming, the joins a cut-down case still needs ----
const PLAYER_AT = /^@(\w+)&?(?:\s|$)/;
/** the real players a tests.txt text uses: `@A ...` lines and p('A') in js */
export function playersIn(text) {
  const s = new Set();
  for (const raw of String(text).split(/\r?\n/)) { const l = raw.trim(), m = PLAYER_AT.exec(l); if (m) s.add(m[1]); for (const x of l.matchAll(/\bp\(\s*['"](\w+)['"]\s*\)/g)) s.add(x[1]); }
  return s;
}
/** n one-letter player names the text does not use (A, B... when it uses none: a case pasted after the other sections then
 *  starts from players nothing set up, as on the fresh server it was found on) */
export function freshNames(used, n = 2) { const res = []; for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (!used.has(c)) res.push(c); if (res.length === n) break; } return res; }
/** test lines with players renamed (map {A: 'C'}): `@A ...`, a whole-word `A` (give A x / tp A ... / a command's target) and p('A') */
export function renamePlayers(lines, map) {
  const r = (n) => map[n] ?? n;
  return lines.map((l) => l.replace(/(^|\s)@(\w+)(&?)(?=\s|$)/g, (m, a, n, b) => `${a}@${r(n)}${b}`).replace(/(^|\s)([A-Z])(?=\s|$)/g, (m, a, n) => `${a}${r(n)}`).replace(/\bp\(\s*(['"])(\w+)\1\s*\)/g, (m, q, n) => `p(${q}${r(n)}${q})`));
}
/** the `@X join` lines a list of test lines needs first: every player it uses before (or without) its own join. A cut-down case
 *  must not fail only because the line that joined a player was cut */
export function joinsFor(lines, known = new Set()) {
  const joined = new Set(), need = [];
  for (const raw of lines) {
    const l = String(raw).trim(), m = PLAYER_AT.exec(l);
    if (!l || l.startsWith('#') || /^(!~|[=~!])/.test(l)) continue;
    if (m && /^@\w+&?\s+join\b/.test(l)) { joined.add(m[1]); continue; }
    if (m && /^@\w+&?\s+leave\b/.test(l) && !joined.has(m[1]) && !need.includes(m[1])) { need.push(m[1]); joined.add(m[1]); continue; }
    // a player named in a command too (`give B bread 1`, `/lab:pay 2 B`): one of the names the tests use
    const named = [...l.matchAll(/(?:^|\s)(\w+)(?=\s|$)/g)].map((x) => x[1]).filter((n) => known.has(n));
    for (const n of [...(m ? [m[1]] : []), ...[...l.matchAll(/\bp\(\s*['"](\w+)['"]\s*\)/g)].map((x) => x[1]), ...named]) if (!joined.has(n) && !need.includes(n)) need.push(n);
  }
  return need.map((n) => `@${n} join`);
}
/** what came instead of a failing expectation (`v`) in a trial run: the first line printed from its command on (one that starts
 *  like the expectation first), or ''; null when that expectation did not fail. Two runs fail the same way only if this matches
 *  too: "PAY you have only 2" and "only 0" are not the same failure (numbers kept; durations aside) */
export function cameInstead(t, title, v) {
  const b = t.lines.join('\n').split(/\n(?=✘ |E |SECTION |PASS |FAIL |fixed since)/).find((x) => x.startsWith('✘ ') && x.includes(`## ${title} > `) && (x.split('\n')[1] ?? '').trim().endsWith(v));
  if (!b) return null;
  const cmd = b.split('\n')[0].replace(/^✘ \d+: ## .*? > /, ''), k = t.segs.findLastIndex((g) => g.cmd === cmd);
  const pool = (k >= 0 ? t.segs.slice(k) : []).flatMap((g) => g.out).filter((x) => x && !/^(E |\s|EV |ST |X |T\d+ |COV |PERF |PROF |trace |events |states |cov)/.test(x));
  const pre = /^\^?(@?\w+ [^\s\\(]+)/.exec(v)?.[1];
  return (pool.find((x) => pre && x.startsWith(pre)) ?? pool[0] ?? '').replace(/\d+(\.\d+)?\s?ms\b/g, 'Nms');
}
