#!/usr/bin/env node
// harden's shorter chain without a server: the pure parts (failing sections that are the last ones, the coverage as a section
// began, a bug's run with those sections left out) and measure / harden on a fake lab: the bugs run beside the coverage run,
// failing last sections need no run again (their bugs survive unless a kept section catches them), failing middle ones do.
// node tests/harden-fast-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-hf-'));
process.env.LAB_LABS_ROOT = path.join(T, 'lab');   // checkpoint.mjs (and mutate through it) works on the fake lab below
process.env.LAB_MUTATE_JOBS = '2';
const imp = (m) => import(pathToFileURL(path.join(TOP, 'common', m)).href);
let good = 0, bad = 0;
const check = (c, name, info = '') => { if (c) { good++; console.log(`✔ ${name}`); } else { bad++; console.log(`✘ ${name}\n    ${String(info).slice(-1500).split('\n').join('\n    ')}`); } };
const put = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const M = await imp('mutate.mjs');

// ---------- the pure parts ----------
{
  const S = (...xs) => xs.map(([ok, t]) => `SECTION ${ok ? 'PASS' : 'FAIL'} ${t}`);
  const fresh = new Set(['n1', 'n2', 'n3']);
  check(JSON.stringify(M.tailFails(S([1, 'a'], [1, 'n1'], [0, 'n2'], [0, 'n3']), fresh)) === '["n2","n3"]', 'tailFails: new sections failing at the end → their titles, in order');
  check(M.tailFails(S([1, 'a'], [0, 'n1'], [1, 'n2']), fresh) === null, 'tailFails: a failing section with one after it → null (the rest run again)');
  check(M.tailFails(S([0, 'a'], [0, 'n1']), new Set(['n1'])) === null, 'tailFails: an old section failing → null');
  check(M.tailFails(S([1, 'a'], [1, 'n1']), fresh) === null, 'tailFails: nothing failing → null');
  check(M.tailFails([...S([1, 'a'], [0, 'n1']), 'SECTION OUTSIDE :: E boom @@ null'], fresh) === null, 'tailFails: a failure outside any section → null');
  check(JSON.stringify(M.tailFails(['✘ 9: ## n1 > x', 'SECTION PASS a', 'SECTION FAIL n1', 'SECTION WHY n1 :: expect ~ x', 'FAIL 1/2'], fresh)) === '["n1"]', 'tailFails: other lines are ignored');
  const lines = ['SECTION COV a :: COV 0% of code lines ran | src/main.ts 0/4 never ran: 1-4', 'SECTION COV n1 :: COV 75% of code lines ran | src/main.ts 3/4 never ran: 3', 'COV 100% of code lines ran | src/main.ts 4/4'];
  check(M.sectionCov(lines, 'n1') === 'COV 75% of code lines ran | src/main.ts 3/4 never ran: 3' && M.sectionCov(lines, 'n2') === '' && M.sectionCov(lines, 'a').startsWith('COV 0%'), 'sectionCov: the COV as that section began ("" when not printed)');
  const run = (ok, ...rest) => ({ ok, ran: true, lines: rest });
  check(M.caughtBy(run(true, 'SECTION PASS a'), ['n1']) === false, 'caughtBy: a passing run survives');
  check(M.caughtBy(run(false, 'SECTION PASS a', 'SECTION FAIL n1'), ['n1']) === false, 'caughtBy: only a left-out section fails → survived');
  check(M.caughtBy(run(false, 'SECTION FAIL a', 'SECTION FAIL n1'), ['n1']) === true, 'caughtBy: a kept section fails → caught');
  check(M.caughtBy(run(false, 'SECTION PASS a', 'SECTION FAIL n1', 'SECTION OUTSIDE :: E x @@ null'), ['n1']) === true, 'caughtBy: a failure outside any section → caught');
  check(M.caughtBy(run(false, 'FAIL 0/1'), ['n1']) === true, 'caughtBy: no SECTION line to tell → caught');
}

// ---------- measure and harden on a fake lab ----------
// the fake `test`: a section fails when it wants "PAY 99"; `n <= 0` made `n < 0` fails the sections that pay 0, `<= 0` made
// `<= 1` fails the ones marked tailonly. --cov: line 3 runs once a section opens the shop; with LAB_SECTIONS the COV as each
// section began. Each run is logged (unit, cov, start, end) and takes 300 ms, so runs at once overlap
const FAKE = String.raw`import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const a = process.argv.slice(2), u = a[a.indexOf('-a') + 1], H = path.dirname(fileURLToPath(import.meta.url)), D = path.join(H, 'addons', u), t0 = Date.now();
if (a[0] !== 'test') { console.log('fake ' + a.join(' ')); process.exit(0); }
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
const src = fs.readFileSync(path.join(D, 'src', 'main.ts'), 'utf8'), tests = fs.readFileSync(path.join(D, 'tests.txt'), 'utf8'), S = process.env.LAB_SECTIONS, cov = a.includes('--cov');
const secs = tests.split(/^## /m).slice(1).map((x) => ({ title: x.split('\n')[0].trim(), body: x }));
let fail = 0, shop = false;
const C = (all) => 'COV ' + (all ? '100% of code lines ran | src/main.ts 4/4' : '75% of code lines ran | src/main.ts 3/4 never ran: 3');
const covs = [];
for (const s of secs) {
  covs.push('SECTION COV ' + s.title + ' :: ' + C(shop));
  if (/shop/.test(s.body)) shop = true;
  const bad = /PAY 99/.test(s.body) || (/n < 0/.test(src) && /pay 0/.test(s.body)) || (/<= 1/.test(src) && /tailonly/.test(s.body));
  if (bad) { fail++; console.log('✘ 1: ## ' + s.title + ' > x'); }
  if (S) { console.log('SECTION ' + (bad ? 'FAIL' : 'PASS') + ' ' + s.title); if (bad) console.log('SECTION WHY ' + s.title + ' :: expect ~ wrong'); }
}
const rj = JSON.stringify({ addon: u, ok: !fail });
fs.mkdirSync(path.join(H, '.lab', 'reports'), { recursive: true }); fs.writeFileSync(path.join(H, '.lab', 'report.json'), rj); fs.writeFileSync(path.join(H, '.lab', 'reports', u + '.json'), rj);
if (cov) { if (S) covs.forEach((l) => console.log(l)); console.log(C(shop)); }
fs.appendFileSync(path.join(H, 'runs.log'), JSON.stringify({ u, cov, t0, t1: Date.now() }) + '\n');
console.log((fail ? 'FAIL ' : 'PASS ') + (secs.length - fail) + '/' + secs.length); process.exit(fail ? 1 : 0);`;
const L0 = path.join(T, 'lab'), unit = path.join(L0, 'bds', 'addons', 'hf'), LOG = path.join(L0, 'bds', 'runs.log');
put(path.join(L0, 'bds', 'lab.mjs'), FAKE); put(path.join(L0, 'AGENTS.md'), '# fake lab\n');
const MAIN = "export function pay(n: number) {\n  if (n <= 0) return 'nothing';\n  return 'paid';\n}\n";
put(path.join(unit, 'src', 'main.ts'), MAIN); put(path.join(unit, 'src', 'kit.ts'), '// kit\n'); put(path.join(unit, 'TASK.md'), '# hf\n');
const runs = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const left = () => fs.readdirSync(path.join(L0, 'bds', 'addons')).filter((x) => x !== 'hf');
const all = M.sites([['src/main.ts', MAIN]]), lt = all.find((s) => s.was === '<='), one = all.find((s) => s.kind === 'num' && s.was === '0');
{
  // the failing section is the last one: one coverage run, the two bugs beside it; a bug only it catches survives
  put(path.join(unit, 'tests.txt'), '## base\n@A cmd /lab:pay 5\n~ paid\n\n## zero\n@A cmd /lab:pay 0\n~ nothing\n\n## wrong\n@A cmd /lab:shop tailonly\n~ PAY 99\n');
  fs.rmSync(LOG, { force: true });
  const outs = [];
  const r = await M.measure('bds', 'hf', { only: [lt, one], out: (l) => outs.push(l), baseEnv: { LAB_SECTIONS: '1' }, tail: (b) => M.tailFails(b.lines, new Set(['zero', 'wrong'])) });
  const rs = runs(), base = rs.find((x) => x.cov), muts = rs.filter((x) => !x.cov);
  check(r.ok && !r.base.ok && JSON.stringify(r.dropped) === '["wrong"]', 'measure: the last section failing → ok, it left out', JSON.stringify({ ok: r.ok, dropped: r.dropped }));
  check(r.cov === 'COV 75% of code lines ran | src/main.ts 3/4 never ran: 3', 'measure: the coverage as the left-out section began (not the whole run\'s)', r.cov);
  check(r.tried === 2 && r.caught === 1 && r.lived.length === 1 && r.lived[0].s === one, 'measure: the bug a kept section catches is caught; the one only the left-out section catches survives', outs.join('\n'));
  check(rs.length === 3 && base && muts.length === 2 && muts.every((m) => m.u.startsWith('hf__mut') && m.t0 < base.t1 && base.t0 < m.t1), 'measure: the bugs run beside the coverage run (each in a copy)', JSON.stringify(rs));
  check(!left().length && JSON.parse(fs.readFileSync(path.join(L0, 'bds', '.lab', 'report.json'), 'utf8')).addon === 'hf' && fs.readFileSync(path.join(unit, 'src', 'main.ts'), 'utf8') === MAIN, 'measure: the copies gone, the unit\'s own last result kept, its code as it was', left().join(' '));
}
{
  // the failing section has one after it: the bugs' results are dropped (the caller runs again)
  put(path.join(unit, 'tests.txt'), '## base\n@A cmd /lab:pay 5\n~ paid\n\n## wrong\n@A cmd /lab:shop\n~ PAY 99\n\n## zero\n@A cmd /lab:pay 0\n~ nothing\n');
  fs.rmSync(LOG, { force: true });
  const outs = [];
  const r = await M.measure('bds', 'hf', { only: [lt, one], out: (l) => outs.push(l), baseEnv: { LAB_SECTIONS: '1' }, tail: (b) => M.tailFails(b.lines, new Set(['zero', 'wrong'])) });
  check(!r.ok && !r.dropped && r.tried === 0 && !outs.some((l) => /caught|survived/.test(l)) && !left().length, 'measure: a failing section in the middle → not ok, no bug counted, copies gone', outs.join('\n'));
}
{
  // without tail: as before (a failing coverage run is not ok; a passing one counts the bugs, run beside it)
  put(path.join(unit, 'tests.txt'), '## base\n@A cmd /lab:pay 5\n~ paid\n\n## zero\n@A cmd /lab:pay 0\n~ nothing\n');
  const r = await M.measure('bds', 'hf', { only: [lt, one] });
  check(r.ok && r.tried === 2 && r.caught === 1 && r.lived[0].s === one && r.cov.startsWith('COV 75%'), 'measure (only, no tail): ok, the same bugs caught as one at a time', JSON.stringify({ ok: r.ok, caught: r.caught }));
}

// harden with a scripted AI: its sections end in a wrong one → the check is the one run beside its bugs, nothing runs again
const TESTS0 = '## base\n@A cmd /lab:pay 5\n~ paid\n';
put(path.join(unit, 'tests.txt'), TESTS0);
const ADD = '\n## harden: paying nothing\n@A cmd /lab:pay 0\n~ nothing\n\n## harden: wrong on purpose\n@A cmd /lab:shop tailonly\n~ PAY 99\n';
const steps = [[{ name: 'write', input: { path: 'tests.txt', content: TESTS0 + ADD } }], 'Added 2 sections.'];
const seen = [];
const srv = http.createServer((q, s) => { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { seen.push(JSON.parse(b)); const st = steps[seen.length - 1] ?? 'done';
  s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ content: typeof st === 'string' ? [{ type: 'text', text: st }] : st.map((c, i) => ({ type: 'tool_use', id: `t${seen.length}_${i}`, name: c.name, input: c.input })), usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: typeof st === 'string' ? 'end_turn' : 'tool_use' })); }); });
await new Promise((z) => srv.listen(0, '127.0.0.1', z));
process.env.ANTHROPIC_API_KEY = 'k'; process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${srv.address().port}`; process.env.NO_PROXY = '127.0.0.1'; process.env.no_proxy = '127.0.0.1'; process.env.NODE_USE_ENV_PROXY = '';
{
  const outs = [];
  const sectionsOf = (file) => { const secs = []; let cur = null; (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split(/\r?\n/).forEach((raw, i) => { const l = raw.trim(); if (l.startsWith('## ')) { cur = { title: l.slice(3).trim(), body: [], start: i, end: i }; secs.push(cur); return; } if (!cur) return; if (l && !l.startsWith('#')) { cur.body.push(l); cur.end = i; } }); return secs; };
  const files = (d, f = () => true) => { const r = []; const w = (x) => { let es = []; try { es = fs.readdirSync(x, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(x, e.name); if (e.isDirectory()) w(p); else if (f(p)) r.push(p); } }; w(d); return r; };
  const L = { F: { name: 'bds', unitDir: 'addons' }, TOP: L0, ADDONS: path.join(L0, 'bds', 'addons'), CACHE: path.join(L0, 'bds', '.lab'), out: (l) => outs.push(String(l)), die: (m) => { throw new Error(m); }, files, rel: (f) => path.relative(path.join(L0, 'bds'), f).split(path.sep).join('/'), sectionsOf, addonNames: () => fs.readdirSync(path.join(L0, 'bds', 'addons')), useAddon: () => {} };
  const Mk = await imp('make.mjs');
  fs.rmSync(LOG, { force: true });
  const ok = await Mk.harden(L, { name: 'hf', n: 2, via: 'anthropic', model: 'fake', turns: 6 });
  const o = outs.join('\n'), after = fs.readFileSync(path.join(unit, 'tests.txt'), 'utf8'), covRuns = runs().filter((x) => x.cov).length;
  check(after === TESTS0 + '\n## harden: paying nothing\n@A cmd /lab:pay 0\n~ nothing\n', 'harden: tests.txt = the old one + the new section that passes', after);
  check(/^SUSPECT "## harden: wrong on purpose": fails on the code as it is \(expect ~ wrong\)/m.test(o) && /^ {2}\| ~ PAY 99$/m.test(o), 'harden: the failing last section shown as SUSPECT with its lines', o);
  check(ok && /^harden hf: \+1 section\(s\): "## harden: paying nothing"$/m.test(o) && /^ {2}bugs caught: 0\/2 → 1\/2 \(still unnoticed: src\/main\.ts:2 `0` → `1`\)$/m.test(o) && /^ {2}code the tests run: 75% → 75% \(1 place\(s\) still unrun/m.test(o) && /^HARDENED addons\/hf via anthropic:fake/m.test(o), 'harden: +1 section, bugs caught before → after (the wrong section\'s own catch not counted), coverage before → after, HARDENED', o);
  check(covRuns === 2 && !/^W /m.test(o), 'harden: two coverage runs in all (before; the check with its bugs beside it): no run again', `${covRuns} coverage runs\n${o}`);
  check(!left().length, 'harden: no copy left', left().join(' '));
}
srv.close();
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${bad ? 'FAIL' : 'PASS'} harden-fast-offline (${good} ok${bad ? `, ${bad} failed` : ''})`);
process.exit(bad ? 1 : 0);
