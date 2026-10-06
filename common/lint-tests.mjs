// tests.txt lint (bds lab): what can be told wrong without a server. Used by `test` / `go` before the server starts.
import fs from 'node:fs';
import { createRequire } from 'node:module';

// a regex from a test/until line; a leading (?i) (PCRE/Python habit) means case-insensitive (same as core.mjs)
const rx = (src) => { const m = /^\(\?i\)/.exec(src); return new RegExp(m ? src.slice(4) : src, m ? 'i' : ''); };
// tests.txt checked before any server starts (a typo there used to cost a whole server run and a round with the AI):
// unknown real-player actions (with the nearest names), regexes that do not compile, `until` without a pattern, `wait` without
// a number, `js` code that does not parse. Returns E lines (file:line ...).
let ACTION_NAMES = null;
// a `~` that missed although its text, read literally, is in what came: a regex character (* . ? ( [ + |) was meant as itself
export function literalMiss(op, v, lines) {
  if (op !== '~' || !/[*.?()[\]+|{}^$]/.test(v)) return null;
  const lit = v.replace(/^\^|\$$/g, ''), line = lines.find((l) => l.includes(lit));
  if (!line) return null;
  const cs = [...new Set(lit.match(/[*.?()[\]+|{}]/g) ?? [])];
  // only the anchors kept it from matching: the line has more before (or after) the text
  if (!cs.length) return `the line is "${line.length > 120 ? line.slice(0, 120) + '…' : line}": ${/^\^/.test(v) && !line.startsWith(lit) ? '^ ties the text to the start of the line' : '$ ties the text to the end of the line'} (drop it, or write the whole line)`;
  return `"${lit}" is there as plain text, but ~ is a regex where ${cs.join(' ')} ${cs.length > 1 ? 'are' : 'is'} special: escape ${cs.length > 1 ? 'them' : 'it'} (${cs.map((c) => '\\' + c).join(' ')}) or use = for a whole line`;
}
export function lintTests(file, r = file) {
  const errs = [], lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  if (!ACTION_NAMES) {
    const req = createRequire(import.meta.url), { ACTIONS } = req('./realplayer.cjs'), { makeVerbs } = req('./verbs.cjs');
    const K = new Proxy({}, { get: (t, k) => (k === 'memo' ? new Map() : () => undefined) });
    ACTION_NAMES = new Set(['join', ...ACTIONS.split(' '), ...Object.keys(makeVerbs(K))]);
  }
  const near = (w) => { const d = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
    return [...ACTION_NAMES].filter((x) => Math.abs(x.length - w.length) <= 3).map((x) => [d(w, x), x]).sort((a, b) => a[0] - b[0]).slice(0, 3).filter(([k]) => k <= 3).map(([, x]) => x); };
  const AsyncFn = (async () => {}).constructor;
  const parses = (code) => { for (const c of [`return (${code});`, code]) { try { new AsyncFn('p', 'inv', 'mob', 'world', 'system', 'mc', 'dim', c); return true; } catch { /* next form */ } } return false; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], l = raw.trim(), at = `${r}:${i + 1}`;
    if (!l || l.startsWith('#')) continue;
    const ex = /^(!~|~)\s?(.*)$/.exec(l);
    if (ex) { try { rx(ex[2]); } catch (e) { errs.push(`${at}: ${ex[1]} ${e.message}`); } continue; }
    if (/^(=|!)/.test(l)) continue;
    const a = /^@\w+&?\s+(\S+)/.exec(l);
    if (a && !ACTION_NAMES.has(a[1])) { const n = near(a[1]); errs.push(`${at}: unknown action ${a[1]}${n.length ? ` (did you mean ${n.join(' / ')}?)` : ''}: help verbs <word>`); continue; }
    if (/^until\b/.test(l)) { const pat = l.slice(5).trim().replace(/\s+\d+$/, ''); if (!pat) errs.push(`${at}: until needs a regex: until <regex> [ms]`); else try { rx(pat); } catch (e) { errs.push(`${at}: until ${e.message}`); } continue; }
    if (/^wait\b/.test(l) && !/^wait\s+\d+\s*$/.test(l)) { errs.push(`${at}: wait <ms> (a number)`); continue; }
    if (/^js\s/.test(l)) {
      let code = l.slice(3);
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*(!~|[=~!])/.test(lines[i + 1])) code += ' ' + lines[++i].trim();
      if (!parses(code)) errs.push(`${at}: js does not parse: ${code.slice(0, 80)}`);
    }
  }
  return errs;
}
