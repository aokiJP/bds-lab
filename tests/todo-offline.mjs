// the ToDo board without a browser or a network: the columns from the issues (pull requests left out), the writes that move a
// card (labels and open/closed), and the card on a small fake DOM over a fake GitHub (through ghrules' fakeCheck) — the moves
// through the page's guard with the `issues` action, the labels made first, a role without the power refused.
// node tests/todo-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const L = await imp('panel/lib/todo.mjs'), G = await imp('panel/lib/gh.mjs'), P = await imp('panel/lib/policy.mjs');
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const iss = (number, title, labels = [], state = 'open', extra = {}) => ({ number, title, state, labels: labels.map((name) => ({ name })), updated_at: `2026-10-0${number}T00:00:00Z`, ...extra });

await t('columns: closed is done, doing label is doing, the rest is todo; pull requests left out; newest first', () => {
  const c = L.columns([iss(1, 'a', ['todo']), iss(2, 'b', ['doing']), iss(3, 'c', [], 'closed'), iss(4, 'd'), iss(5, 'pr', ['todo'], 'open', { pull_request: {} }), iss(6, 'e', ['todo', 'doing'], 'closed')]);
  eq(c.todo.map((i) => i.number), [4, 1]); eq(c.doing.map((i) => i.number), [2]); eq(c.done.map((i) => i.number), [6, 3]);
  eq(L.columns(null), { todo: [], doing: [], done: [] });
});
await t('moveOps: the labels put on and taken off, closing and opening; nothing when already there', () => {
  eq(L.moveOps(iss(1, 'a', ['todo']), 'doing'), [{ method: 'POST', path: '/issues/1/labels', body: { labels: ['doing'] } }, { method: 'DELETE', path: '/issues/1/labels/todo' }]);
  eq(L.moveOps(iss(1, 'a', ['doing', 'bug']), 'done'), [{ method: 'DELETE', path: '/issues/1/labels/doing' }, { method: 'PATCH', path: '/issues/1', body: { state: 'closed' } }]);
  eq(L.moveOps(iss(1, 'a'), 'done'), [{ method: 'PATCH', path: '/issues/1', body: { state: 'closed' } }]);
  eq(L.moveOps(iss(2, 'b', ['doing'], 'closed'), 'todo').map((o) => o.method + o.path), ['PATCH/issues/2', 'POST/issues/2/labels', 'DELETE/issues/2/labels/doing']);
  eq(L.moveOps(iss(3, 'c'), 'todo'), []); eq(L.moveOps(iss(3, 'c', ['doing']), 'doing'), []); eq(L.moveOps(iss(3, 'c'), 'nowhere'), []);
});

function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag, ns = null) { super(); Object.assign(this, { tagName: ns ? tag : tag.toUpperCase(), ns, kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return this.attrs.disabled !== undefined ? Promise.resolve() : Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createElementNS: (ns, tag) => new E(tag, ns), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { toast };
}
// (the card's requests to the fake GitHub counted where they start and end: a wait ends when none is open and none has come or
// gone for a while — not after a fixed time, which a busy CI runner can outlast)
const net = { busy: 0, at: 0 };
const flush = async () => {
  const until = Date.now() + 10_000;
  await new Promise((r) => setTimeout(r, 30));
  while (Date.now() < until && (net.busy > 0 || Date.now() - net.at < 60)) await new Promise((r) => setTimeout(r, 15));
};
/** a fake GitHub holding the lab's issues and labels; every request is kept in `seen` */
function fake(issues, { labels = [], down = false } = {}) {
  const seen = [], bodies = [], state = { issues, labels: new Set(labels) };
  const fetchImpl = async (url, init) => { net.busy++; net.at = Date.now(); try { return await answer(url, init); } finally { net.busy--; net.at = Date.now(); } };
  const answer = async (url, init) => {
    const u = url.replace('https://api.github.com', ''), m = init.method, b = init.body ? JSON.parse(init.body) : null; seen.push(`${m} ${u}`); if (b) bodies.push(b);
    const json = (code, j) => ({ status: code, ok: code < 300, headers: { get: () => null }, text: async () => JSON.stringify(j), json: async () => j });
    const bad = fakeCheck(m, u, b); if (bad) return json(422, { message: bad.message });
    if (down) return json(500, { message: 'boom' });
    let x;
    if (m === 'GET' && /^\/repos\/o\/lab\/issues\?/.test(u)) return json(200, state.issues);
    if (m === 'POST' && u === '/repos/o/lab/labels') { if (state.labels.has(b.name)) return json(422, { message: 'already_exists' }); state.labels.add(b.name); return json(201, b); }
    if ((x = /^\/repos\/o\/lab\/issues\/(\d+)\/labels(?:\/([^/]+))?$/.exec(u))) {
      const i = state.issues.find((q) => q.number === Number(x[1]));
      if (m === 'POST') { for (const l of b.labels) if (!i.labels.some((q) => q.name === l)) i.labels.push({ name: l }); return json(200, i.labels); }
      if (m === 'DELETE') { if (!i.labels.some((q) => q.name === x[2])) return json(404, { message: 'Label does not exist' }); i.labels = i.labels.filter((q) => q.name !== x[2]); return json(200, i.labels); }
    }
    if ((x = /^\/repos\/o\/lab\/issues\/(\d+)$/.exec(u)) && m === 'PATCH') { const i = state.issues.find((q) => q.number === Number(x[1])); i.state = b.state; return json(200, i); }
    return json(404, { message: 'Not Found' });
  };
  return { api: G.gh({ token: 'x', fetchImpl }), seen, bodies, state };
}
/** the page's guard as the tests have it: the policy's own answer for the role, everything asked is kept */
const guard = (role, log) => async (action, detail, fn, done) => {
  log.push({ action, detail });
  if (!P.can(P.DEFAULT_POLICY, role, action)) return undefined;
  try { const r = await fn(); if (done) log.push({ done }); return r; } catch (e) { log.push({ failed: e.message }); return undefined; }
};
const ctxOf = (g, role, log) => ({ api: g.api, lab: { slug: 'o/lab' }, guarded: guard(role, log), may: (a) => P.can(P.DEFAULT_POLICY, role, a) });
const btn = (card, n, to) => card.all((e) => e.tagName === 'BUTTON' && e.attrs['data-to'] === to && e.parent.parent.attrs['data-issue'] === String(n))[0];
const colOf = (card, c) => card.all((e) => e.tagName === 'SECTION' && e.attrs['data-col'] === c)[0];
const BASE = () => [iss(1, 'ケーキを焼く', ['todo']), iss(2, 'ゆかを塗る', ['doing']), iss(3, 'おわった件', [], 'closed'), iss(4, 'PR', [], 'open', { pull_request: {} })];

await t('the card: three columns with their cards, a pull request is no card, only reads so far', async () => {
  fakeDom(); const UI = await imp('panel/ui/todo.mjs'), g = fake(BASE()), log = [];
  const card = UI.todoCard(ctxOf(g, 'write', log));
  await flush();
  ok(/やる（1）/.test(colOf(card, 'todo').textContent) && /ケーキを焼く/.test(colOf(card, 'todo').textContent), card.textContent);
  ok(/ゆかを塗る/.test(colOf(card, 'doing').textContent) && /おわった件/.test(colOf(card, 'done').textContent), card.textContent);
  ok(!/PR/.test(card.textContent), 'no pull request card');
  ok(g.seen.every((s) => s.startsWith('GET ')) && log.length === 0, g.seen.join(','));
  ok(card.all(() => true).every((e) => !('style' in e.attrs)), 'no style attribute');
});
await t('→ やっている: the labels are made first, then the label moves, through guarded issues; the board is read again', async () => {
  fakeDom(); const UI = await imp('panel/ui/todo.mjs'), g = fake(BASE()), log = [];
  const card = UI.todoCard(ctxOf(g, 'write', log));
  await flush();
  await btn(card, 1, 'doing').click(); await flush();
  eq(log[0], { action: 'issues', detail: { number: 1, to: 'doing' } }); ok(log.some((l) => /動かしました/.test(l.done ?? '')), JSON.stringify(log));
  eq(g.seen.filter((s) => s !== 'GET /repos/o/lab/issues?state=all&per_page=100&sort=updated'), ['POST /repos/o/lab/labels', 'POST /repos/o/lab/labels', 'POST /repos/o/lab/issues/1/labels', 'DELETE /repos/o/lab/issues/1/labels/todo']);
  eq([...g.state.labels], ['todo', 'doing']);
  ok(/ケーキを焼く/.test(colOf(card, 'doing').textContent) && !/ケーキを焼く/.test(colOf(card, 'todo').textContent), 'moved on the board');
});
await t('→ できた closes it, → やる opens it again; labels already there are not made twice', async () => {
  fakeDom(); const UI = await imp('panel/ui/todo.mjs'), g = fake(BASE(), { labels: ['todo', 'doing'] }), log = [];
  const card = UI.todoCard(ctxOf(g, 'admin', log));
  await flush();
  await btn(card, 2, 'done').click(); await flush();
  eq(g.state.issues[1].state, 'closed'); eq(g.state.issues[1].labels, []);
  ok(/ゆかを塗る/.test(colOf(card, 'done').textContent), 'in done');
  await btn(card, 3, 'todo').click(); await flush();
  eq(g.state.issues[2].state, 'open'); eq(g.state.issues[2].labels.map((l) => l.name), ['todo']);
  ok(/おわった件/.test(colOf(card, 'todo').textContent), 'in todo');
});
await t('a role without the power (read, triage): the buttons are disabled with the reason, a click writes nothing', async () => {
  for (const role of ['read', 'triage']) {
    fakeDom(); const UI = await imp('panel/ui/todo.mjs'), g = fake(BASE()), log = [];
    const card = UI.todoCard(ctxOf(g, role, log));
    await flush();
    const b = btn(card, 1, 'doing');
    ok(b.attrs.disabled !== undefined && /この役割では動かせません/.test(b.attrs.title) && /この役割では動かせません/.test(card.textContent), role);
    await b.click(); await flush();
    ok(g.seen.every((s) => s.startsWith('GET ')) && log.length === 0, `${role}: ${g.seen.join(',')}`);
  }
});
await t('a guard that refuses (a role the policy does not allow, though the card thought so): nothing is written', async () => {
  fakeDom(); const UI = await imp('panel/ui/todo.mjs'), g = fake(BASE()), log = [];
  const card = UI.todoCard({ ...ctxOf(g, 'read', log), may: () => true });
  await flush();
  await btn(card, 1, 'doing').click(); await flush();
  eq(log.length, 1); ok(g.seen.every((s) => s.startsWith('GET ')), g.seen.join(','));
});
await t('GitHub down: the failure in words with a way on (role alert)', async () => {
  fakeDom(); const UI = await imp('panel/ui/todo.mjs'), g = fake([], { down: true });
  const card = UI.todoCard(ctxOf(g, 'write', []));
  await flush();
  ok(card.all((e) => e.attrs.role === 'alert').length === 1 && card.all((e) => e.tagName === 'BUTTON' && /読み直す/.test(e.textContent)).length === 1, card.textContent);
});
await t('a button that cannot be pressed is not pressed (disabled: click does nothing)', async () => {
  fakeDom(); const { h } = await imp('panel/ui/dom.mjs'), pressed = [];
  const off = h('button', { disabled: true, onclick: () => pressed.push('off') }, 'x'), on = h('button', { onclick: () => pressed.push('on') }, 'y');
  await off.click(); eq(pressed, [], 'disabled');
  await on.click(); eq(pressed, ['on'], 'enabled');
});

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
