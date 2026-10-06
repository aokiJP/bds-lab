// node lab.mjs mutate [-a <unit>] [n] [--all]: would the tests notice a bug? Small bugs go into the unit's own code one at a time
// (=== ↔ !==, >= → >, && → ||, true → false, a call left out, a number +1) and tests.txt runs on each, on a fresh server. A bug
// no test notices "survives": its line is where a test is missing (one S line each, with the change). The lines the tests never
// run come first (test --cov) and get no bug: it would survive anyway. Default 6 bugs (6 server runs; --all: every site);
// a bug that does not even build is skipped. The unit is put back exactly as it was, whatever happens. Zero tokens.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as CP from './checkpoint.mjs';

const OPS = [
  ['cmp', / (===|!==|==|!=) /g, (m) => ({ '===': ' !== ', '!==': ' === ', '==': ' != ', '!=': ' == ' })[m.trim()]],
  ['cmp', / (>=|<=|>|<) /g, (m) => ({ '>=': ' > ', '<=': ' < ', '>': ' >= ', '<': ' <= ' })[m.trim()]],
  ['logic', / (&&|\|\|) /g, (m) => (m.trim() === '&&' ? ' || ' : ' && ')],
  ['bool', /\b(true|false)\b/g, (m) => (m === 'true' ? 'false' : 'true')],
  ['num', /(?<![\w.$])\d+(?![\w.])/g, (m) => String(Number(m) + 1)],
];
const CALL = /^\s*(await\s+)?[\w$]+(\.[\w$]+|\[[^\]]+\])*\s*\(.*\)\s*;?\s*$/;   // a line that is one whole call
const KINDS = ['call', 'cmp', 'logic', 'bool', 'num'];
/** the line with strings and comments blanked (same length): operators are found in code only */
export function mask(line, st = { block: false }) {
  let o = '', q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (st.block) { if (c === '*' && line[i + 1] === '/') { st.block = false; o += '  '; i++; } else o += ' '; continue; }
    if (q) { if (c === '\\') { o += '  '; i++; continue; } if (c === q) { q = null; o += c; } else o += ' '; continue; }
    if (c === '/' && line[i + 1] === '/') { o += ' '.repeat(line.length - i); break; }
    if (c === '/' && line[i + 1] === '*') { st.block = true; o += '  '; i++; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    o += c;
  }
  return o;
}
// Python (Endstone plugins): its own operators and comments
const PY_OPS = [
  ['cmp', / (==|!=) /g, (m) => (m.trim() === '==' ? ' != ' : ' == ')],
  ['cmp', / (>=|<=|>|<) /g, (m) => ({ '>=': ' > ', '<=': ' < ', '>': ' >= ', '<': ' <= ' })[m.trim()]],
  ['logic', / (and|or) /g, (m) => (m.trim() === 'and' ? ' or ' : ' and ')],
  ['bool', /\b(True|False)\b/g, (m) => (m === 'True' ? 'False' : 'True')],
  ['num', /(?<![\w.$])\d+(?![\w.])/g, (m) => String(Number(m) + 1)],
];
export function pyMask(line) { let o = '', q = null; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '\\') { o += '  '; i++; continue; } if (c === q) { q = null; o += c; } else o += ' '; continue; } if (c === '#') { o += ' '.repeat(line.length - i); break; } if (c === '"' || c === "'") q = c; o += c; } return o; }
function pySites(rel, text, skip) {
  const res = [];
  text.split('\n').forEach((raw, i) => {
    const m = pyMask(raw), n = i + 1;
    if (skip.has(`${rel}:${n}`) || !m.trim() || /^\s*(import|from|def|class|@|return\s*$|pass\b|"""|''')/.test(m) || /^\s*"""|^\s*'''/.test(raw)) return;
    if (/^\s*[\w.]+\(.*\)\s*$/.test(m) && !/^\s*(print|super)\b/.test(m)) res.push({ file: rel, line: n, col: 0, len: raw.length, to: raw.replace(/\S.*$/, 'pass  # mutate: call left out'), kind: 'call', was: raw.trim(), code: raw });
    for (const [kind, re, f] of PY_OPS) for (const x of m.matchAll(re)) {
      if (kind === 'num' && (/\[\s*$/.test(m.slice(0, x.index)) || /indent\s*=\s*$/.test(m.slice(0, x.index)))) continue;
      res.push({ file: rel, line: n, col: x.index, len: x[0].length, to: f(x[0]), kind, was: x[0].trim(), code: raw });
    }
  });
  return res;
}
/** every place a small bug can go: [{ file, line, col, len, to, kind, was }] (lines in `skip` (Set "file:line") left out) */
export function sites(files, skip = new Set()) {
  const res = [];
  for (const [rel, text] of files) {
    if (rel.endsWith('.py')) { res.push(...pySites(rel, text, skip)); continue; }
    const st = { block: false };
    text.split('\n').forEach((raw, i) => {
      const m = mask(raw, st), n = i + 1;
      if (skip.has(`${rel}:${n}`) || !m.trim() || /^\s*(import|export\s+(\*|\{)|type\s|interface\s|declare\s|\*|\/\*)/.test(m) || /^\s*[\])}]/.test(m)) return;
      if (CALL.test(m) && !/^\s*(return|if|for|while|switch|const|let|var|new)\b/.test(m)) res.push({ file: rel, line: n, col: 0, len: raw.length, to: raw.replace(/\S.*$/, '/* mutate: call left out */'), kind: 'call', was: raw.trim(), code: raw });
      for (const [kind, re, f] of OPS) for (const x of m.matchAll(re)) {
        if (kind === 'num' && (/\[\s*$/.test(m.slice(0, x.index)) || /(case|import)\s+$/.test(m.slice(0, x.index)) || /JSON\.stringify\([^()]*,\s*(null|undefined|\w+)\s*,\s*$/.test(m.slice(0, x.index)))) continue;   // an index, a case label, a JSON indent: noise (no player sees it)
        res.push({ file: rel, line: n, col: x.index, len: x[0].length, to: f(x[0]), kind, was: x[0].trim(), code: raw });
      }
    });
  }
  return res;
}
/** n sites, the kinds taken in turn (a left-out call first: the strongest sign), each kind spread over the code */
export function pick(all, n) {
  const by = KINDS.map((k) => all.filter((s) => s.kind === k)), out = [];
  const spread = (xs, m) => (xs.length <= m ? xs : Array.from({ length: m }, (_, i) => xs[Math.floor(((i + 0.5) * xs.length) / m)]));
  const take = by.map((xs) => spread(xs, n)), idx = by.map(() => 0);
  while (out.length < n && take.some((xs, i) => idx[i] < xs.length)) for (let i = 0; i < take.length && out.length < n; i++) if (idx[i] < take[i].length) out.push(take[i][idx[i]++]);
  return out;
}
const apply = (text, s) => { const ls = text.split('\n'); const l = ls[s.line - 1]; ls[s.line - 1] = s.kind === 'call' ? s.to : l.slice(0, s.col) + s.to + l.slice(s.col + s.len); return ls.join('\n'); };

/** the unit's own script files: [[rel, text]] (src/ for TypeScript, else bp/scripts; not the kit, not the lab's) */
export function unitFiles(dir) {
  const srcDir = fs.existsSync(path.join(dir, 'src')) ? 'src' : 'bp/scripts', files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(dir, d), { withFileTypes: true })) { const r = `${d}/${e.name}`; if (e.isDirectory()) { if (!/^(node_modules|lib)$/.test(e.name)) walk(r); } else if (/\.([cm]?[jt]s|py)$/.test(e.name) && !/\.d\.ts$|^kit\.[jt]s$|^lab_features\.js$|^__lab|^test_|^__init__\.py$/.test(e.name)) files.push([r, fs.readFileSync(path.join(dir, r), 'utf8')]); } };
  try { walk(srcDir); } catch { /* no scripts */ }
  return { srcDir, files };
}
/** one run of the unit's tests.txt on a fresh server: { ok, ran, lines } */
export function runTests(k, u, extra = [], env = {}) {
  const r = spawnSync(process.execPath, [path.join(CP.TOP, k, 'lab.mjs'), 'test', '-a', u, ...extra], { cwd: path.join(CP.TOP, k), encoding: 'utf8', maxBuffer: 256e6, timeout: 20 * 60_000, env: { ...process.env, LAB_NOTRACE: '1', FORCE_COLOR: '0', LAB_NO_LASTFAIL: '1', LAB_NO_KITSYNC: '1', ...env } });
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
  return { ok: r.status === 0 && lines.some((l) => /^PASS \d/.test(l)), ran: lines.some((l) => /^(PASS|FAIL) \d+\/\d+/.test(l)), lines };
}
export const whatOf = (s) => (s.kind === 'call' ? `\`${s.was.slice(0, 70)}\` left out` : `\`${s.was}\` → \`${s.to.trim()}\``);
/** coverage, then small bugs one at a time (n spread over the code, or exactly `only`: the same bugs again, e.g. after new tests).
 *  { ok (the tests pass as they are), cov, sites, tried, caught, lived: [{ s, what }], skipped }. The unit is put back exactly. */
export async function measure(k, u, { n = 6, only = null, out = () => {}, onBase = null } = {}) {
  const dir = CP.unitDir(k, u), { files } = unitFiles(dir);
  const res = { ok: false, cov: '', sites: [], tried: 0, caught: 0, lived: [], skipped: 0, files };
  if (!files.length) return { ...res, none: true };
  const held = CP.hold(k, u);
  try {
    const base = runTests(k, u, ['--cov']);
    res.base = base; res.ok = base.ok;
    if (!base.ok) return res;
    // COV 85% of code lines ran | src/main.ts 40/47 never ran: 12-15,30 | ...
    const cov = base.lines.find((l) => l.startsWith('COV ')) ?? '', skip = new Set();
    for (const m of cov.matchAll(/\| (\S+) \d+\/\d+ never ran: ([\d,-]+)/g)) for (const r of m[2].split(',')) { const [a, b = a] = r.split('-').map(Number); for (let x = a; x <= b; x++) skip.add(`${m[1]}:${x}`); }
    res.cov = cov;
    if (onBase) await onBase(cov);
    const backup = new Map(files);
    res.sites = sites(files, only ? new Set() : skip);
    const chosen = only ? only.filter((s) => backup.get(s.file)?.split('\n')[s.line - 1] === s.code) : pick(res.sites, Math.min(n, res.sites.length));   // (a line that changed since: not that bug any more)
    out(`  ${chosen.length} bug(s), one test run each${k === 'll' ? ' (LeviLamina under Wine: about 2 min each; run it in the background)' : ''}`);
    let i = 0;
    for (const s of chosen) {
      i++;
      if (!backup.has(s.file)) continue;
      fs.writeFileSync(path.join(dir, s.file), apply(backup.get(s.file), s));
      const r = runTests(k, u);
      fs.writeFileSync(path.join(dir, s.file), backup.get(s.file));
      const what = whatOf(s);
      if (!r.ran) { res.skipped++; out(`  - ${s.file}:${s.line} ${what}: does not build, skipped`); continue; }
      res.tried++;
      if (r.ok) res.lived.push({ s, what }); else res.caught++;
      out(`  ${i}/${chosen.length} ${r.ok ? 'survived' : 'caught  '} ${s.file}:${s.line} ${what}`);
    }
    res.chosen = chosen;
    return res;
  } finally { held.back(); }
}

export async function mutateCmd(args, out = console.log) {
  const k = CP.labKind(), u = CP.currentUnit(k, args), dir = CP.unitDir(k, u), all = args.includes('--all');
  const n = all ? 1e9 : Math.max(1, Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '-a') ?? 6));
  if (!unitFiles(dir).files.length) { out(`${u}: no scripts of its own to put bugs into (${unitFiles(dir).srcDir}/)`); return false; }
  out(`mutate ${u}: the tests as they are, with coverage...`);
  const G = await import('./gaps.mjs');
  const r = await measure(k, u, { n, out, onBase: (cov) => { if (cov) { out(`  ${cov.replace(/^COV /, 'coverage: ')}`); for (const g of G.explain(dir, cov).slice(0, 6)) out(`S ${G.line(g)}`); } } });
  if (!r.ok) { (r.base?.lines ?? []).filter((l) => /^(✘|E |FAIL)/.test(l)).slice(0, 6).forEach((l) => out('  ' + l)); out(`FAIL ${u}: the tests fail already: mutate needs a passing unit (node lab.mjs go)`); return false; }
  if (!r.chosen?.length) { out(`${u}: no place for a bug in the lines the tests run`); return true; }
  for (const { s, what } of r.lived) out(`S ${s.file}:${s.line} ${what}: no test notices (a ## section that checks what this line does)`);
  out(`${r.lived.length ? 'W' : 'OK'} mutate ${u}: ${r.caught}/${r.tried} bugs caught${r.tried ? ` (${Math.round((100 * r.caught) / r.tried)}%)` : ''}${r.cov ? `, ${/^COV (\d+%)/.exec(r.cov)?.[1] ?? '?'} of the code ran` : ''}${r.sites.length > r.chosen.length ? ` | ${r.sites.length} sites in all (--all)` : ''}`);
  return !r.lived.length;
}
