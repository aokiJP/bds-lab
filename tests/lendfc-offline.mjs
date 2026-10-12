// lendfc without a network: the forecast of lenders' free time (panel/lib/lendfc.mjs, pure) from their past host.yml runs and
// .lab-host.json (hours, minutesPerMonth), and its card (panel/ui/lendfc.mjs) on a small fake DOM through a fake GitHub
// (lib/gh.mjs with a fake fetch, checked by ghrules' fakeCheck): the freest hours named, outside-the-hours slots at 0, the
// minutes left, a lender that cannot be read named with the reason, a failure with the way on, reading only.
// node tests/lendfc-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const L = await imp('panel/lib/lendfc.mjs'), M = await imp('panel/lib/model.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const NOW = Date.parse('2026-10-12T03:00:00Z'); // a Monday
const rulesOf = (o) => M.checkRules({ minutesPerMonth: 600, jobs: ['gate'], ...o }).rules;
const run = (id, start, min) => ({ id, status: 'completed', conclusion: 'success', run_started_at: start, created_at: start, updated_at: new Date(Date.parse(start) + min * 60_000).toISOString() });
// Tuesdays 10:00 UTC for four weeks (the last one is in this month), 30 minutes each
const BUSY = ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06'].map((d, i) => run(i + 1, `${d}T10:00:00Z`, 30));
const A = rulesOf({ hours: '09:00-23:00', timezone: 'UTC' });
const slot = (a, wd, hr) => a.free[wd * 24 + hr];

await t('availability: 168 slots, outside the hours 0, the busy hour below the quiet one, minutes left', () => {
  const [a] = L.availability({ 'o/a': BUSY }, { now: NOW, tz: 'UTC', rules: { 'o/a': A } });
  eq(a.slug, 'o/a'); eq(a.free.length, 168); eq(a.reason, '');
  eq(slot(a, 1, 3), [1, 3, 0], 'Monday 3:00 is outside 09:00-23:00');
  eq(slot(a, 2, 11)[2], 100); ok(slot(a, 2, 10)[2] < 100 && slot(a, 2, 10)[2] > 0, `busy Tuesday 10 ${slot(a, 2, 10)}`);
  eq(a.left, Math.floor(600 * M.STOP_AT) - 30, 'one 30 minute run this month');
  eq(a.best.length, 3); ok(a.best.every((b) => b.when && b.why), 'each with when and why');
  ok(!a.best.some((b) => b.when === '火曜 10 時〜11 時'), 'the busy hour is not offered');
  ok(a.best.every((b) => /^[日月火水木金土]曜 \d+ 時〜\d+ 時$/.test(b.when)), a.best.map((b) => b.when).join());
});

await t('availability: a night-crossing window, the grid in another zone, deterministic', () => {
  const r = rulesOf({ hours: '22:00-06:00', timezone: 'UTC' });
  const [a] = L.availability({ x: [] }, { now: NOW, tz: 'UTC', rules: { x: r } });
  eq([slot(a, 3, 23)[2], slot(a, 3, 2)[2], slot(a, 3, 12)[2]], [100, 100, 0]);
  const [j] = L.availability({ x: [] }, { now: NOW, tz: 'Asia/Tokyo', rules: { x: r } });
  eq([slot(j, 3, 8)[2], slot(j, 3, 12)[2], slot(j, 3, 18)[2]], [100, 100, 0], '23:00 UTC is 08:00 in Tokyo, 03:00 UTC is 12:00, 09:00 UTC is 18:00');
  eq(L.availability({ x: BUSY }, { now: NOW, rules: { x: A } }), L.availability({ x: BUSY }, { now: NOW, rules: { x: A } }));
});

await t('availability: no rules, unreadable runs, an used-up month, and runs outside the weeks looked at', () => {
  const out = L.availability({ n: [], e: new Error('GitHub が 500 を返しました'), u: [run(9, '2026-10-02T10:00:00Z', 30)], o: [run(8, '2026-05-05T10:00:00Z', 90)] },
    { now: NOW, tz: 'UTC', rules: { n: null, e: A, u: rulesOf({ minutesPerMonth: 10 }), o: A } });
  const by = Object.fromEntries(out.map((x) => [x.slug, x]));
  ok(/\.lab-host\.json/.test(by.n.reason) && by.n.free.length === 0 && by.n.left === null, by.n.reason);
  ok(/500/.test(by.e.reason) && by.e.best.length === 0, by.e.reason);
  eq(by.u.left, 0); eq(by.u.best, []); ok(/使い切り/.test(by.u.reason), by.u.reason);
  eq(slot(by.o, 2, 10)[2], 100, 'an old run does not count');
  eq(L.availability(undefined, {}), []);
});

await t('availability: past the lender\'s last day (in its own zone) nothing is offered', () => {
  const r = rulesOf({ hours: '09:00-23:00', timezone: 'Asia/Tokyo', until: '2026-10-11' });
  const [a] = L.availability({ x: [] }, { now: NOW, tz: 'UTC', rules: { x: r } }); // 12:00 on 10-12 in Tokyo
  eq([a.best, a.left, a.free.length], [[], 0, 0]); ok(/貸す期限（2026-10-11）を過ぎました/.test(a.reason), a.reason);
  const [b] = L.availability({ x: [] }, { now: NOW, tz: 'UTC', rules: { x: rulesOf({ hours: '09:00-23:00', timezone: 'Asia/Tokyo', until: '2026-10-12' }) } });
  eq(b.reason, ''); eq(b.best.length, 3);
});

// ---- the card ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return this.disabled ? Promise.resolve() : Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createElementNS: (ns, tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: () => new E('div'), body: new E('body') };
}
function fakeGitHub(byRepo) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const u = url.replace('http://fake', ''), m = init.method ?? 'GET';
    seen.push(`${m} ${u}`);
    const send = (status, j) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => j, text: async () => JSON.stringify(j) });
    const bad = fakeCheck(m, u, init.body ? JSON.parse(init.body) : null);
    if (bad) return send(422, { message: bad.message });
    const x = /^\/repos\/([^/]+\/[^/]+)\/actions\/workflows\/host\.yml\/runs\?/.exec(u);
    if (x && byRepo[x[1]] === 'boom') return send(500, { message: 'boom' });
    const pg = Number(/[?&]page=(\d+)/.exec(u)?.[1] ?? 1);
    if (x && byRepo[x[1]]) return send(200, { workflow_runs: byRepo[x[1]].slice((pg - 1) * 100, pg * 100) });
    return send(404, { message: `Not Found ${m} ${u}` });
  };
  return { seen, api: G.gh({ token: 'ghu_usertoken0123456789', base: 'http://fake', fetchImpl }) };
}

await t('the card: 「読んでいます…」 at once, the heat picture (168 cells, attributes only), three hours, a lender without rules named; reads only', async () => {
  fakeDom();
  const U = await imp('panel/ui/lendfc.mjs');
  const g = fakeGitHub({ 'o/a': BUSY });
  const el = U.lendForecastCard({ api: g.api, now: NOW, tz: 'UTC', hosts: [{ slug: 'o/a', rules: A }, { slug: 'o/b', rules: null }] });
  ok(/読んでいます/.test(el.textContent), el.textContent);
  await el.ready;
  const text = el.textContent;
  eq(el.all((e) => e.tagName === 'RECT').length, 168);
  ok(el.all((e) => e.tagName === 'SVG')[0].attrs.role === 'img' && /一週間の空き/.test(el.all((e) => e.tagName === 'SVG')[0].attrs['aria-label']), 'labelled svg');
  ok(el.all((e) => e.tagName === 'RECT').every((r) => Object.keys(r.style).length === 0), 'no style on cells');
  eq(el.all((e) => e.tagName === 'LI').length, 3);
  ok(/今月あと 450 分/.test(text) && /o\/b/.test(text) && /予報を出せません: \.lab-host\.json/.test(text), text);
  ok(g.seen.length === 1 && g.seen.every((s) => s.startsWith('GET ')), `only o/a is asked, reading only: ${g.seen}`);
});

await t('the card: a lender whose runs cannot be read is named with the reason (the others stay); 「もう一度読む」 reads again; no lender is said', async () => {
  const U = await imp('panel/ui/lendfc.mjs');
  const g = fakeGitHub({ 'o/a': BUSY, 'o/c': 'boom' });
  const el = U.lendForecastCard({ api: g.api, now: NOW, tz: 'UTC', hosts: [{ slug: 'o/c', rules: A }, { slug: 'o/a', rules: A }] });
  await el.ready;
  ok(/o\/c/.test(el.textContent) && /予報を出せません: 実行を読めませんでした/.test(el.textContent) && /o\/a/.test(el.textContent), el.textContent);
  ok(el.textContent.indexOf('o/c') < el.textContent.indexOf('o/a'), 'in the order given');
  const before = g.seen.length, btn = el.all((e) => e.tagName === 'BUTTON' && /もう一度読む/.test(e.textContent))[0];
  await btn.click(); await el.ready;
  ok(g.seen.length === before + 2, `read again: ${g.seen.length - before}`);
  const none = U.lendForecastCard({ api: g.api, now: NOW, hosts: [] }); await none.ready;
  ok(/まだ貸し手がありません/.test(none.textContent), none.textContent);
  const bad = U.lendForecastCard({ api: g.api, now: NOW, hosts: 5 }); await bad.ready;
  ok(bad.all((e) => e.attrs.role === 'alert').length === 1 && /もう一度読む/.test(bad.textContent), bad.textContent);
});

await t('the card: reads from the day before this month began when that is earlier, page after page; says so when it cannot read it all', async () => {
  const U = await imp('panel/ui/lendfc.mjs');
  const late = Date.parse('2026-10-30T03:00:00Z'); // four weeks back is 10-02: the month began before that
  const many = Array.from({ length: 230 }, (_, i) => run(i + 1, '2026-10-05T10:00:00Z', 1));
  const g = fakeGitHub({ 'o/a': many });
  const el = U.lendForecastCard({ api: g.api, now: late, tz: 'UTC', hosts: [{ slug: 'o/a', rules: A }] });
  await el.ready;
  ok(g.seen.length === 3 && g.seen.every((s) => /created=%3E%3D2026-09-30/.test(s)), `3 pages from 09-30: ${g.seen}`);
  ok(/今月あと \d+ 分/.test(el.textContent) && !/読めませんでした/.test(el.textContent), el.textContent);
  const huge = Array.from({ length: 2100 }, (_, i) => run(i + 1, '2026-10-05T10:00:00Z', 0));
  const h2 = fakeGitHub({ 'o/a': huge });
  const e2 = U.lendForecastCard({ api: h2.api, now: late, tz: 'UTC', hosts: [{ slug: 'o/a', rules: A }] }); await e2.ready;
  eq(h2.seen.length, 20); ok(/o\/a は実行が多く、2000 件までしか読めませんでした/.test(e2.textContent), e2.textContent);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
