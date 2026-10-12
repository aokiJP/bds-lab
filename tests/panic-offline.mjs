// the 🛑 emergency stop without a browser or a network: what starts a workflow (its file's `on:`), the stop's plan (pure:
// the runs to cancel, the workflows to turn off, what is kept and why — pages.yml above all) and the way back (only what the
// stop turned off), then the card on a small fake DOM over a fake GitHub (a fake fetch for lib/gh.mjs, GitHub's rules for
// writes through ghrules' fakeCheck): nothing to stop, a run that ended meanwhile (409), a role that may not, the undo.
// node tests/panic-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const PN = await imp('panel/lib/panic.mjs'), G = await imp('panel/lib/gh.mjs'), P = await imp('panel/lib/policy.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ---- pure ----
await t('triggersOf: the one-word, list, flow-mapping and block forms; comments and quotes; none found → null', () => {
  eq(PN.triggersOf('name: x\non: workflow_dispatch\njobs: {}\n'), ['workflow_dispatch']);
  eq(PN.triggersOf('on: [push, "pull_request"]  # both\n'), ['push', 'pull_request']);
  eq(PN.triggersOf('on: { schedule: [{ cron: "1 * * * *" }], workflow_dispatch: {} }\n'), ['schedule', 'workflow_dispatch']);
  eq(PN.triggersOf('"on":\n  # a note\n  push:\n    branches: [main]\n    paths: [a]\n  schedule:\n    - cron: "0 3 * * *"\n  workflow_dispatch:\n    inputs:\n      x: { description: y }\njobs:\n  a: {}\n'), ['push', 'schedule', 'workflow_dispatch']);
  eq(PN.triggersOf('on:\n  - push\n  - issues\n'), ['push', 'issues']);
  eq(PN.triggersOf('on:\r\n  workflow_dispatch:\r\njobs: {}\r\n'), ['workflow_dispatch']);
  eq(PN.triggersOf('jobs: {}\n'), null); eq(PN.triggersOf(null), null);
});
await t('triggersOf on the lab\'s own workflows: auto.yml and pages.yml start by themselves, copilot-setup-steps.yml only by hand', () => {
  const read = (f) => PN.triggersOf(fs.readFileSync(path.join(TOP, '.github/workflows', f), 'utf8'));
  eq(read('auto.yml'), ['schedule', 'workflow_dispatch']);
  eq(read('pages.yml'), ['push', 'schedule', 'workflow_dispatch']);
  eq(read('copilot-setup-steps.yml'), ['workflow_dispatch']);
  ok(read('ai-make.yml').includes('issues'), 'issues');
});
const W = (id, file, triggers, state = 'active') => ({ id, name: file.replace(/\.yml$/, ''), path: `.github/workflows/${file}`, state, triggers });
const RUN = (id, file, status = 'in_progress', wid = undefined) => ({ id, status, workflow_id: wid, path: `.github/workflows/${file}`, name: file.replace(/\.yml$/, ''), display_title: `title ${id}` });
await t('plan: the going runs cancelled, the self-starting workflows turned off; pages.yml (and its runs), manual, already off, unreadable and GitHub\'s own kept with a reason', () => {
  const wfs = [W(1, 'auto.yml', ['schedule', 'workflow_dispatch']), W(2, 'pages.yml', ['push', 'schedule']), W(3, 'app.yml', ['workflow_dispatch']), W(4, 'maint.yml', ['schedule'], 'disabled_manually'),
    W(5, 'notify.yml', ['workflow_run']), W(6, 'odd.yml', null), { id: 7, name: 'pages-build-deployment', path: 'dynamic/pages/pages-build-deployment', state: 'active' }];
  const runs = [RUN(10, 'auto.yml', 'in_progress', 1), RUN(11, 'app.yml', 'queued', 3), RUN(12, 'pages.yml', 'in_progress', 2), RUN(13, 'auto.yml', 'completed', 1), RUN(14, 'verify.yml', 'waiting')];
  const p = PN.plan(runs, wfs);
  eq(p.cancel, [10, 11, 14]); eq(p.disable, [1, 5]);
  eq(p.keep.map((k) => [k.kind, k.id]), [['workflow', 2], ['workflow', 3], ['workflow', 4], ['workflow', 6], ['workflow', 7], ['run', 12]]);
  ok(p.keep.every((k) => k.why.length > 5) && /パネル/.test(p.keep[0].why) && p.keep[5].name === 'title 12', JSON.stringify(p.keep));
  eq(PN.plan([], []), { cancel: [], disable: [], keep: [] });
});
await t('restorePlan: only the recorded ids, once each; one going again or gone is passed over with the reason', () => {
  eq(PN.restorePlan({ disabled: [{ id: 1, name: 'auto.yml' }, { id: 5, name: 'notify.yml' }, { id: 1, name: 'auto.yml' }] }), { enable: [1, 5], skip: [] });
  const r = PN.restorePlan({ disabled: [{ id: 1, name: 'auto.yml' }, { id: 5, name: 'notify.yml' }, { id: 8, name: 'gone.yml' }] }, [W(1, 'auto.yml', null, 'disabled_manually'), W(5, 'notify.yml', null, 'active'), W(9, 'other.yml', null, 'disabled_manually')]);
  eq(r.enable, [1]); eq(r.skip.map((x) => x.id), [5, 8]);
  eq(PN.restorePlan(null), { enable: [], skip: [] }); eq(PN.restorePlan([3]).enable, [3]);
});

// ---- a fake GitHub (a fake fetch for gh()) and a small DOM ----
// (the requests counted where they start and end: a wait ends when none is open and none has come or gone for a while — not
// after a fixed time)
const net = { busy: 0, at: 0 };
const settle = async () => {
  const until = Date.now() + 10_000;
  await new Promise((r) => setTimeout(r, 20));
  while (Date.now() < until && (net.busy > 0 || Date.now() - net.at < 40)) await new Promise((r) => setTimeout(r, 10));
};
const FILES = { 'auto.yml': 'on:\n  schedule: [{ cron: "17 * * * *" }]\n  workflow_dispatch:\n', 'pages.yml': 'on:\n  push:\n  schedule:\n    - cron: "1 * * * *"\n', 'app.yml': 'on:\n  workflow_dispatch:\n', 'notify.yml': 'on:\n  workflow_run:\n    workflows: [app]\n' };
function fakeGitHub(init = {}) {
  const st = { wfs: init.wfs ?? [], runs: init.runs ?? [], gone: new Set(init.gone ?? []), broken: new Set(init.broken ?? []), writes: [], seen: [] };
  const json = (code, j) => new Response(j === null ? null : JSON.stringify(j), { status: code, headers: { 'content-type': 'application/json' } });
  const answer = (m, u, body) => {
    const bad = fakeCheck(m, u, body); if (bad) return json(422, { message: bad.message });
    let x;
    if (m === 'GET' && /^\/repos\/o\/lab\/actions\/workflows\?/.test(u)) return json(200, { workflows: st.wfs.map(({ triggers: _, ...w }) => w) });
    if (m === 'GET' && (x = /^\/repos\/o\/lab\/actions\/runs\?per_page=100&status=(\w+)$/.exec(u))) return json(200, { workflow_runs: st.runs.filter((r) => r.status === x[1]) });
    if (m === 'GET' && (x = /^\/repos\/o\/lab\/contents\/\.github\/workflows\/([^?]+)$/.exec(u))) return FILES[x[1]] ? json(200, { content: Buffer.from(FILES[x[1]]).toString('base64'), sha: 's' }) : json(404, { message: 'Not Found' });
    if (m === 'PUT' && (x = /^\/repos\/o\/lab\/actions\/workflows\/(\d+)\/(disable|enable)$/.exec(u))) {
      const w = st.wfs.find((y) => String(y.id) === x[1]); if (!w) return json(404, { message: 'Not Found' });
      st.writes.push(`${x[2]} ${x[1]}`); w.state = x[2] === 'disable' ? 'disabled_manually' : 'active'; return json(204, null);
    }
    if (m === 'POST' && (x = /^\/repos\/o\/lab\/actions\/runs\/(\d+)\/cancel$/.exec(u))) {
      if (st.gone.has(Number(x[1]))) return json(409, { message: 'Cannot cancel a workflow run that is completed.' });
      if (st.broken.has(Number(x[1]))) return json(500, { message: 'boom' });
      st.writes.push(`cancel ${x[1]}`); st.runs = st.runs.filter((r) => String(r.id) !== x[1]); return json(202, {});
    }
    return json(404, { message: `Not Found ${m} ${u}` });
  };
  const fetchImpl = async (url, opts = {}) => {
    net.busy++; net.at = Date.now();
    try {
      await new Promise((r) => setTimeout(r, 1));
      const u = String(url).replace('https://api.github.com', ''), m = opts.method ?? 'GET';
      st.seen.push(`${m} ${u}`);
      if (/Bearer ghu_/.test(opts.headers?.authorization ?? '') === false) return json(401, { message: 'Bad credentials' });
      return answer(m, u, opts.body ? JSON.parse(opts.body) : null);
    } finally { net.busy--; net.at = Date.now(); }
  };
  return { st, api: G.gh({ token: 'ghu_usertoken0123456789', fetchImpl }) };
}
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    // (as in a browser: a disabled button is not pressed)
    click() { if (this.disabled) return Promise.resolve(); return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { toast };
}
const fakeStorage = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// (the page's guard as the policy says: a role DEFAULT_POLICY does not allow is refused, nothing run)
const fakeGuard = (role) => {
  const g = { calls: [], refused: [], failed: [] };
  g.guarded = async (action, detail, fn) => {
    g.calls.push([action, detail]);
    if (!P.can(P.DEFAULT_POLICY, role, action)) { g.refused.push(action); return undefined; }
    try { return await fn(); } catch (e) { g.failed.push(e); return undefined; }
  };
  return g;
};
const btn = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];
const LAB = (role = 'admin') => ({ slug: 'o/lab', role });
const toasts = [];
const say = (text, bad) => toasts.push([text, Boolean(bad)]);

await t('the fake DOM: click calls onclick, a disabled button is not pressed', async () => {
  fakeDom(); const { h } = await imp('panel/ui/dom.mjs');
  let n = 0; const a = h('button', { onclick: () => { n++; } }, 'a'), b = h('button', { disabled: true, onclick: () => { n += 10; } }, 'b');
  await a.click(); await b.click(); eq(n, 1);
});

await t('nothing going: the button cannot be pressed and says why; nothing is written', async () => {
  fakeDom(); const UI = await imp('panel/ui/panic.mjs');
  const f = fakeGitHub({ wfs: [W(3, 'app.yml'), W(2, 'pages.yml')] }), g = fakeGuard('admin');
  const c = UI.panicCard({ api: f.api, lab: LAB(), guarded: g.guarded, storage: fakeStorage(), toast: say }); await settle();
  const go = btn(c, /全部止める/);
  ok(go.disabled && /いま止めるものはありません/.test(c.textContent) && /いま止めるもの/.test(go.attrs.title), c.textContent);
  ok(/実行: 0 件/.test(c.textContent) && /ワークフロー: 0 本/.test(c.textContent) && /pages\.yml — パネル/.test(c.textContent), c.textContent);
  await go.click(); await settle();
  eq(f.st.writes, []); eq(g.calls, []); ok(!/本当に止めますか/.test(c.textContent), 'no confirmation');
  ok(!f.st.seen.some((s) => /pages\.yml$/.test(s)), 'pages.yml not even read');
});

await t('the stop: what and how many said first; the workflows off, then the runs cancelled (a run that ended meanwhile: 409, said so); kept in storage and on the button; 「もとに戻す」 turns on only those', async () => {
  fakeDom(); const UI = await imp('panel/ui/panic.mjs'); toasts.length = 0;
  const f = fakeGitHub({ wfs: [W(1, 'auto.yml'), W(2, 'pages.yml'), W(3, 'app.yml'), W(5, 'notify.yml'), W(4, 'maint.yml', null, 'disabled_manually')],
    runs: [RUN(11, 'auto.yml', 'in_progress', 1), RUN(12, 'app.yml', 'queued', 3), RUN(13, 'auto.yml', 'waiting', 1), RUN(20, 'pages.yml', 'in_progress', 2)], gone: [12] });
  const g = fakeGuard('write'), store = fakeStorage();
  const c = UI.panicCard({ api: f.api, lab: LAB('write'), guarded: g.guarded, storage: store, toast: say }); await settle();
  ok(/実行: 3 件/.test(c.textContent) && /ワークフロー: 2 本（auto\.yml・notify\.yml）/.test(c.textContent), c.textContent);
  await btn(c, /全部止める/).click();
  ok(/本当に止めますか？ 実行 3 件を止め、ワークフロー 2 本/.test(c.textContent), c.textContent);
  eq(f.st.writes, [], 'nothing sent before 「はい」');
  await btn(c, /やめる/).click(); ok(!/本当に止めますか/.test(c.textContent), 'the confirmation can be put away');
  await btn(c, /全部止める/).click();
  await btn(c, /はい、止める/).click(); await settle();
  eq(f.st.writes, ['disable 1', 'disable 5', 'cancel 11', 'cancel 13']);
  eq(g.calls.map((x) => x[0]), ['dispatch', 'run.cancel']); eq(g.refused, []);
  ok(/ワークフロー 2 本を止めました/.test(c.textContent) && /実行 2 件を止めました（1 件は、その前にもう終わっていました）/.test(c.textContent), c.textContent);
  ok(!f.st.writes.some((w) => / 2$| 20$/.test(w)), 'pages.yml and its run left alone');
  const rec = JSON.parse(store.getItem('bdslab.panel.panic.o/lab'));
  eq(rec.disabled, [{ id: 1, name: 'auto.yml' }, { id: 5, name: 'notify.yml' }]);
  const back = btn(c, /もとに戻す/);
  ok(back && !back.disabled && back.attrs['data-workflows'] === '1,5' && /auto\.yml・notify\.yml/.test(back.textContent), back?.textContent);
  ok(!/ghu_/.test(c.textContent) && !/ghu_/.test([...store.m.values()].join()), 'no token shown or kept');
  // (one turned on by someone meanwhile is passed over; maint.yml, off before the stop, is never touched)
  f.st.wfs.find((w) => w.id === 5).state = 'active';
  await back.click(); await settle();
  eq(f.st.writes.slice(4), ['enable 1']); eq(g.calls.at(-1)[0], 'dispatch');
  ok(/1 本をまた動くように/.test(c.textContent) && /notify\.yml: もう動いています/.test(c.textContent), c.textContent);
  eq(store.getItem('bdslab.panel.panic.o/lab'), null, 'the record is gone once all is back');
  ok(!btn(c, /もとに戻す/), 'no undo left');
  eq(f.st.wfs.find((w) => w.id === 4).state, 'disabled_manually');
});

await t('a record left in this tab (the page opened again): the undo is offered at once and turns on only those ids', async () => {
  fakeDom(); const UI = await imp('panel/ui/panic.mjs');
  const f = fakeGitHub({ wfs: [W(1, 'auto.yml', null, 'disabled_manually'), W(4, 'maint.yml', null, 'disabled_manually')] }), g = fakeGuard('admin'), store = fakeStorage();
  store.setItem('bdslab.panel.panic.o/lab', JSON.stringify({ at: Date.parse('2026-10-12T03:00:00Z'), disabled: [{ id: 1, name: 'auto.yml' }] }));
  const c = UI.panicCard({ api: f.api, lab: LAB(), guarded: g.guarded, storage: store, toast: say }); await settle();
  const back = btn(c, /もとに戻す/); ok(back && /緊急停止で止めたワークフロー: 1 本/.test(c.textContent), c.textContent);
  await back.click(); await settle();
  eq(f.st.writes, ['enable 1']);
});

await t('a role that may not (triage): the button cannot be pressed and says why in words; the guard refuses too; nothing is written', async () => {
  fakeDom(); const UI = await imp('panel/ui/panic.mjs');
  const f = fakeGitHub({ wfs: [W(1, 'auto.yml')], runs: [RUN(11, 'auto.yml', 'in_progress', 1)] }), g = fakeGuard('triage'), store = fakeStorage();
  store.setItem('bdslab.panel.panic.o/lab', JSON.stringify({ at: Date.now(), disabled: [{ id: 9, name: 'x.yml' }] }));
  const c = UI.panicCard({ api: f.api, lab: LAB('triage'), guarded: g.guarded, storage: store, toast: say }); await settle();
  const go = btn(c, /全部止める/), back = btn(c, /もとに戻す/);
  ok(go.disabled && /実行を止めるは、あなたの役割には許されていません/.test(c.textContent) && /ワークフローを始めるは、あなたの役割には許されていません/.test(go.attrs.title), c.textContent);
  ok(back.disabled && back.attrs.title.length > 5, 'the undo too');
  ok(!/run\.cancel|dispatch/.test(c.textContent), 'no action names shown');
  await go.click(); await back.click(); await settle();
  eq(f.st.writes, []); eq(g.calls, []);
  eq(await g.guarded('run.cancel', {}, () => f.api.cancel('o/lab', 11)), undefined); eq(g.refused, ['run.cancel']); eq(f.st.writes, []);
});

await t('a policy that allows cancelling but not turning off: the runs are stopped, the workflows left, the reason shown', async () => {
  fakeDom(); const UI = await imp('panel/ui/panic.mjs');
  const f = fakeGitHub({ wfs: [W(1, 'auto.yml')], runs: [RUN(11, 'auto.yml', 'in_progress', 1)] }), g = fakeGuard('write');
  const policy = { version: 1, roles: { write: ['run.cancel'] }, teams: {}, confirm: [] };
  const c = UI.panicCard({ api: f.api, lab: LAB('write'), policy, guarded: g.guarded, storage: fakeStorage(), toast: say }); await settle();
  ok(/ワークフロー: 1 本（auto\.yml） — ワークフローを始めるは/.test(c.textContent), c.textContent);
  await btn(c, /全部止める/).click();
  ok(/実行 1 件を止め、ワークフロー 0 本/.test(c.textContent), c.textContent);
  await btn(c, /はい、止める/).click(); await settle();
  eq(f.st.writes, ['cancel 11']); eq(g.calls.map((x) => x[0]), ['run.cancel']);
});

await t('GitHub fails: one run that cannot be cancelled shows the words (failView) while the rest are stopped; a reading that fails shows the words and a way to try again', async () => {
  fakeDom(); const UI = await imp('panel/ui/panic.mjs');
  let f = fakeGitHub({ wfs: [W(3, 'app.yml')], runs: [RUN(11, 'app.yml', 'in_progress', 3), RUN(12, 'app.yml', 'in_progress', 3)], broken: [11] }), g = fakeGuard('admin');
  let c = UI.panicCard({ api: f.api, lab: LAB(), guarded: g.guarded, storage: fakeStorage(), toast: say }); await settle();
  await btn(c, /全部止める/).click(); await btn(c, /はい、止める/).click(); await settle();
  eq(f.st.writes, ['cancel 12']);
  ok(/実行 1 件を止めました/.test(c.textContent) && /実行 11 は止められませんでした/.test(c.textContent) && c.all((e) => e.attrs.role === 'alert').length >= 1, c.textContent);
  f = fakeGitHub({ wfs: [] }); g = fakeGuard('admin');
  const api = { ...f.api, workflows: async () => { throw new G.GhError(0, 'GitHub につながりません（offline）', '/x'); } };
  c = UI.panicCard({ api, lab: LAB(), guarded: g.guarded, storage: fakeStorage(), toast: say }); await settle();
  ok(/つながりません/.test(c.textContent) && c.all((e) => e.attrs.role === 'alert').length === 1 && !btn(c, /全部止める/), c.textContent);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
