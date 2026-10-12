// the badges without a browser or a network: which prizes the lab's units, runs, releases and lenders earn (and the day), what
// is new to a browser (`fresh`), and the card (panel/ui/badges.mjs) on a small fake DOM against a fake GitHub behind
// lib/gh.mjs — the 🎉 for new ones only and kept in the browser's storage, a storage that refuses, a lab that cannot be
// read shows the words and 「数え直す」.
// node tests/badges-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const B = await imp('panel/lib/badges.mjs'), G = await imp('panel/lib/gh.mjs');
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const NOW = Date.parse('2026-10-12T09:00:00Z'), H = 3_600_000, D = 24 * H;
let id = 0;
/** a finished run that started `ago` ms before NOW */
const run = (ago, conclusion, file = 'verify.yml', status = 'completed') => {
  const s = NOW - ago;
  return { id: ++id, name: file, display_title: file, path: `.github/workflows/${file}`, status, conclusion: status === 'completed' ? conclusion : null,
    run_started_at: new Date(s).toISOString(), created_at: new Date(s).toISOString(), updated_at: new Date(s + 60_000).toISOString() };
};
/** n passes in a row, the oldest `from` hours ago, one hour apart */
const passes = (n, from = 100, file = 'verify.yml') => Array.from({ length: n }, (_, i) => run((from - i) * H, 'success', file));
const ids = (xs) => xs.map((x) => x.id);

await t('earned: nothing from nothing (and from what is not a list)', () => {
  eq(B.earned({}), []);
  eq(B.earned({ units: 'x', runs: null, releases: {}, hosts: 5, now: 'no' }), []);
  eq(B.earned({ units: [null, 3], runs: [null, { id: 1 }], releases: [null], hosts: [null, {}] }), []);
});
await t('earned: units — the first addon, five addons (other kinds are not addons)', () => {
  eq(ids(B.earned({ units: [{ kind: 'end', name: 'a' }] })), []);
  eq(ids(B.earned({ units: [{ kind: 'bds', name: 'a' }] })), ['first-addon']);
  eq(ids(B.earned({ units: Array.from({ length: 4 }, (_, i) => ({ kind: 'bds', name: `a${i}` })) })), ['first-addon']);
  eq(ids(B.earned({ units: Array.from({ length: 5 }, (_, i) => ({ kind: 'bds', name: `a${i}` })) })), ['first-addon', 'five-addons']);
});
await t('earned: releases — the first one has its day; a draft is not out', () => {
  eq(B.earned({ releases: [{ tag_name: 'x', draft: true, created_at: new Date(NOW).toISOString() }] }), []);
  const a = new Date(NOW - 3 * D).toISOString(), b = new Date(NOW - D).toISOString();
  eq(B.earned({ releases: [{ published_at: b }, { published_at: a }, { draft: true, created_at: new Date(NOW - 9 * D).toISOString() }] }), [{ id: 'first-release', at: Date.parse(a) }]);
  eq(B.earned({ releases: [{ tag_name: 'nodate' }] }), [{ id: 'first-release', at: null }], 'out, the day unknown');
});
await t('earned: ten passes in a row — a failure ends the row, other workflows and unfinished runs do not count', () => {
  eq(ids(B.earned({ runs: passes(9) })), []);
  const ten = B.earned({ runs: passes(10) });
  eq(ten, [{ id: 'green-ten', at: NOW - 91 * H }], 'the day the tenth passed');
  eq(ids(B.earned({ runs: [...passes(5, 100), run(94 * H + 1, 'failure'), ...passes(5, 93)] })), [], 'a failure in the middle');
  eq(ids(B.earned({ runs: [...passes(10, 100), run(50 * H, 'failure')] })), ['green-ten'], 'earned stays earned');
  eq(ids(B.earned({ runs: [...passes(5, 100), run(95 * H - 1, 'cancelled'), run(95 * H - 2, null, 'verify.yml', 'in_progress'), ...passes(5, 94)] })), ['green-ten'], 'cancelled and running are skipped, not failures');
  eq(ids(B.earned({ runs: passes(10, 100, 'ai-make.yml') })), [], 'not a test workflow');
  eq(B.streak(passes(7)).best, 7);
});
await t('earned: the first lend (a lender that could be read), four weekly reports, a hundred runs', () => {
  eq(ids(B.earned({ hosts: [{ slug: 'a/host', error: 'x' }, { repo: {} }] })), []);
  eq(ids(B.earned({ hosts: [{ slug: 'a/host', repo: {} }] })), ['first-lend']);
  eq(ids(B.earned({ runs: passes(3, 50, 'notify.yml') })), []);
  eq(B.earned({ runs: [...passes(4, 50, 'notify.yml'), run(10 * H, 'failure', 'notify.yml')] }), [{ id: 'weekly-four', at: NOW - 47 * H }]);
  const many = Array.from({ length: 100 }, (_, i) => run((200 - i) * H, i % 2 ? 'success' : 'failure', 'other.yml'));
  eq(B.earned({ runs: many }), [{ id: 'hundred-runs', at: NOW - 101 * H }]);
});
await t('fresh: only the ones not seen; bad seen means none seen', () => {
  const got = [{ id: 'a', at: null }, { id: 'b', at: 1 }];
  eq(B.fresh(got, ['a']), [{ id: 'b', at: 1 }]);
  eq(ids(B.fresh(got, null)), ['a', 'b']);
  eq(B.fresh(got, ['a', 'b']), []);
  eq(B.fresh(null, []), []);
  ok(B.BADGES.every((b) => b.id && b.name && b.text && b.icon) && new Set(B.BADGES.map((b) => b.id)).size === B.BADGES.length, 'every badge has words and its own id');
});

// ---- the card on a small fake DOM ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { if (this.disabled) return Promise.resolve([]); return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: () => null };
}
// (no fixed wait: let the promises run until the card has said what it counted — or gives up after many turns)
const settle = async (c) => { for (let i = 0; i < 200 && /数えています/.test(c.textContent); i++) await new Promise((r) => setImmediate(r)); };
const btn = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];
const unb = (s) => Buffer.from(s).toString('base64');
const RUNS = [...passes(10, 100), ...passes(4, 60, 'notify.yml')];
const REL = [{ tag_name: 'addon-shop', name: 'shop', published_at: new Date(NOW - D).toISOString(), assets: [] }];
/** a GitHub behind lib/gh.mjs: one addon, the runs and releases above; init.status makes every answer an error; reads only */
function fakeGh(init = {}) {
  const seen = [];
  const reply = (code, j) => ({ ok: code < 400, status: code, headers: { get: () => null }, text: async () => (j === undefined ? '' : JSON.stringify(j)) });
  const fetchImpl = async (url, o) => {
    const u = url.replace('https://api.github.com', ''), m = o?.method ?? 'GET';
    seen.push(`${m} ${u}`);
    const bad = fakeCheck(m, u, o?.body ? JSON.parse(o.body) : null); if (bad) return reply(422, { message: bad.message });
    if (init.status) return reply(init.status, { message: 'nope' });
    if (u === '/repos/o/lab/contents/bds/addons') return reply(200, [{ type: 'dir', name: 'shop' }]);
    if (/^\/repos\/o\/lab\/contents\/(end\/plugins|ll\/mods)$/.test(u)) return reply(404, { message: 'Not Found' });
    if (/^\/repos\/o\/lab\/contents\/bds\/addons\/shop\//.test(u)) return reply(200, { content: unb('## a\n'), sha: 's' });
    if (u.startsWith('/repos/o/lab/actions/runs?')) return reply(200, { workflow_runs: RUNS });
    if (u === '/repos/o/lab/releases?per_page=30') return reply(200, REL);
    return reply(404, { message: `Not Found ${u}` });
  };
  return { seen, init, api: G.gh({ token: 'x', fetchImpl }) };
}
const store = (init = {}, { refuse = false } = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { if (refuse) throw new Error('full'); m.set(k, v); } }; };
const ctxOf = (f, storage, hosts = [{ slug: 'friend/host', repo: {} }]) => ({ api: f.api, lab: { slug: 'o/lab' }, hosts, storage, now: NOW, tz: 'UTC' });
const item = (c, bid) => c.all((e) => e.attrs['data-badge'] === bid)[0];

await t('the card: earned and still-to-come, 🎉 on the new ones once, then kept as seen; reading only', async () => {
  fakeDom();
  const UI = await imp('panel/ui/badges.mjs'), f = fakeGh(), st = store();
  const c = UI.badgesCard(ctxOf(f, st));
  await settle(c);
  eq(item(c, 'first-addon').attrs['data-state'], 'earned'); eq(item(c, 'five-addons').attrs['data-state'], 'locked');
  ok(['first-addon', 'first-release', 'green-ten', 'first-lend', 'weekly-four'].every((b) => item(c, b).attrs['data-state'] === 'earned'), c.textContent);
  ok(/まだです: アドオンが 5 つ/.test(item(c, 'five-addons').textContent) && /2026-10-11/.test(item(c, 'first-release').textContent), c.textContent);
  ok(/🎉 新しい！/.test(item(c, 'first-addon').textContent) && !/新しい！/.test(item(c, 'five-addons').textContent), 'new ones marked');
  ok(/新しいバッジが 5 個/.test(c.textContent), c.textContent);
  eq(JSON.parse(st.m.get(UI.SEEN_KEY)).sort(), ['first-addon', 'first-lend', 'first-release', 'green-ten', 'weekly-four'], 'kept in this browser');
  ok(f.seen.every((s) => s.startsWith('GET ')), 'reads only');
  await btn(c, /数え直す/).click(); await settle(c); await new Promise((r) => setImmediate(r));
  const c2 = UI.badgesCard(ctxOf(f, st));
  await settle(c2);
  ok(!/新しい！/.test(c2.textContent) && !/新しいバッジが/.test(c2.textContent), 'seen ones are not new again');
  st.m.set(UI.SEEN_KEY, JSON.stringify(['first-addon']));
  const c3 = UI.badgesCard(ctxOf(f, st)); await settle(c3);
  ok(!/新しい！/.test(item(c3, 'first-addon').textContent) && /新しい！/.test(item(c3, 'first-release').textContent), 'one seen, the rest new');
  st.m.set(UI.SEEN_KEY, '{not json');
  const c4 = UI.badgesCard(ctxOf(f, st)); await settle(c4);
  ok(/新しい！/.test(item(c4, 'first-addon').textContent), 'a broken note means none seen');
});
await t('the card: a storage that refuses is said; a lender that could not be read gives no lend badge', async () => {
  fakeDom();
  const UI = await imp('panel/ui/badges.mjs'), f = fakeGh();
  const c = UI.badgesCard(ctxOf(f, store({}, { refuse: true }), [{ slug: 'x/host', error: 'no' }]));
  await settle(c);
  ok(/残せませんでした/.test(c.textContent) && item(c, 'first-lend').attrs['data-state'] === 'locked', c.textContent);
});
await t('the card: a lab that cannot be read → the words of the failure (failView) and 「数え直す」 counts again', async () => {
  fakeDom();
  const UI = await imp('panel/ui/badges.mjs'), f = fakeGh({ status: 500 });
  const c = UI.badgesCard(ctxOf(f, store()));
  await settle(c); await new Promise((r) => setImmediate(r));
  ok(/GitHub: 500/.test(c.textContent) && c.all((e) => e.attrs.role === 'alert').length === 1 && btn(c, /数え直す/), c.textContent);
  f.init.status = 0;
  await btn(c, /数え直す/).click(); await settle(c);
  ok(c.all((e) => e.attrs.role === 'alert').length === 0 && item(c, 'first-addon'), c.textContent);
});

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
