// the 「試験の履歴」 card without a browser or a network: the pure history of unit.yml's runs (lib/testhist.mjs: names, days, rate,
// last pass, streak, what is left out) and the card on a small stand-in DOM (ui/testhist.mjs: bars, table, empty, failure).
// node tests/testhist-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const T = await imp('panel/lib/testhist.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const NOW = Date.parse('2026-10-12T12:00:00Z');
let id = 1;
const run = (name, at, conclusion = 'success', extra = {}) => ({ id: id++, name, status: 'completed', conclusion, run_started_at: at, created_at: at, ...extra });

await t('run names: only "unit test|go <unit>" (pure)', () => {
  eq(T.parseName('unit test ruby'), { job: 'test', unit: 'ruby' });
  eq(T.parseName('unit go ruby'), { job: 'go', unit: 'ruby' });
  eq([T.parseName('unit build ruby'), T.parseName('verify'), T.parseName(null), T.parseName('unit test')], [null, null, null, null]);
});

await t('days, rate, last pass and streak per unit; the rest left out (pure)', () => {
  const runs = [
    run('unit test ruby', '2026-10-12T01:00:00Z'), run('unit go ruby', '2026-10-11T01:00:00Z'), run('unit test ruby', '2026-10-11T02:00:00Z', 'failure'),
    run('unit test ruby', '2026-10-01T01:00:00Z'), run('unit test gel', '2026-10-12T01:00:00Z', 'failure'), run('unit test gel', '2026-09-01T01:00:00Z'),
    run('unit test ruby', '2026-10-12T05:00:00Z', 'cancelled'), run('unit test ruby', '2026-10-12T06:00:00Z', null, { status: 'in_progress' }),
    run('verify', '2026-10-12T01:00:00Z'), run('unit test bad', 'not a date'), run('unit test ruby', '2026-10-10T01:00:00Z', 'timed_out'),
  ];
  const r = T.history(runs, { days: 30, now: NOW });
  eq(r.units.map((u) => u.unit), ['ruby', 'gel'], 'most failures first: ruby 2, gel 1');
  const ruby = r.units.find((u) => u.unit === 'ruby'), gel = r.units.find((u) => u.unit === 'gel');
  eq(ruby.days.length, 30);
  eq(ruby.days.at(-1), { date: '2026-10-12', pass: 1, fail: 0 });
  eq(ruby.days.at(-2), { date: '2026-10-11', pass: 1, fail: 1 });
  eq(ruby.days.at(-3), { date: '2026-10-10', pass: 0, fail: 1 });
  eq(ruby.days[0].date, '2026-09-13');
  eq([ruby.pass, ruby.fail, ruby.rate, ruby.lastPass, ruby.streak], [3, 2, 0.6, '2026-10-12', 1]);
  eq([gel.pass, gel.fail, gel.rate, gel.lastPass, gel.streak], [0, 1, 0, '2026-09-01', 0], 'last pass outside the window still shown');
  eq(T.history([], { now: NOW }).units, []);
  eq(T.history(null, { now: NOW }).units, []);
  eq(T.history(runs, { days: 1, now: NOW }).units.find((u) => u.unit === 'ruby').rate, 1);
  eq(T.history([run('unit test q', '2026-01-01T00:00:00Z')], { now: NOW }).units[0].rate, null, 'no run in the window: no rate');
});

function fakeDom() {
  class N { get textContent() { return ''; } }
  class Tx extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag, ns = '') { super(); Object.assign(this, { tagName: tag, ns, kids: [], attrs: {}, on: {}, style: {}, className: '', parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new Tx(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createElementNS: (ns, tag) => new E(tag, ns), createTextNode: (s) => new Tx(s), getElementById: () => null, body: new E('body') };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
fakeDom();
const U = await imp('panel/ui/testhist.mjs');
const fakeApi = (runs, seen = []) => ({ runs: async (slug, o) => { seen.push([slug, o]); if (runs instanceof Error) throw runs; return runs; }, call: async (m, a, b) => { ok(!fakeCheck(m, a, b), 'a write'); } });

await t('the card: reads unit.yml, draws bars with ✓ ✗ words and a table', async () => {
  const seen = [], runs = [run('unit test ruby', '2026-10-12T01:00:00Z'), run('unit test ruby', '2026-10-11T01:00:00Z', 'failure')];
  const card = U.testHistCard({ api: fakeApi(runs, seen), lab: { slug: 'o/lab' }, now: NOW });
  await tick();
  eq(seen, [['o/lab', { workflow: 'unit.yml', per: 100 }]]);
  const svgs = card.all((e) => e.tagName === 'svg');
  eq(svgs.length, 1);
  ok(svgs[0].attrs['aria-label'].includes('✓1') && svgs[0].attrs['aria-label'].includes('✗1'), 'label');
  ok(!('style' in svgs[0].attrs), 'no style attribute');
  eq(svgs[0].all((e) => e.tagName === 'rect').length, 2);
  ok(svgs[0].all((e) => e.attrs.fill === 'none').length === 1, 'failed bar is an open shape');
  const txt = card.textContent;
  ok(txt.includes('50%') && txt.includes('2026-10-12') && txt.includes('最後に通った日'), txt);
  eq(card.all((e) => e.tagName === 'tr').length, 2);
});

await t('no runs: a plain sentence; unreadable: failView with an alert', async () => {
  const a = U.testHistCard({ api: fakeApi([]), lab: { slug: 'o/lab' }, now: NOW });
  await tick();
  ok(a.textContent.includes('まだありません'), a.textContent);
  const b = U.testHistCard({ api: fakeApi(new Error('読めませんでした (403)')), lab: { slug: 'o/lab' }, now: NOW });
  await tick();
  eq(b.all((e) => e.attrs.role === 'alert').length, 1);
  ok(b.textContent.includes('403'), 'the words of the failure');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
