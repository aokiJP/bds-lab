// the 「最初のアドオンを 5 分で」 card without a browser or a network: the steps and where a person stands (pure), and the card
// on a small fake DOM with a fake GitHub (writes checked by GitHub's rules: ghrules.fakeCheck): a name checked, the unit made
// through the guard, tried, finished, and the congratulation with what to do next; a policy that says no gives the reason.
// node tests/tutorial-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const T = await imp('panel/lib/tutorial.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, open: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}

const run = (status, conclusion = null, title = 'unit ruby') => ({ status, conclusion, display_title: title });
const rel = (tag, asset) => ({ tag_name: tag, draft: false, published_at: '2026-10-01T00:00:00Z', assets: asset ? [{ name: asset }] : [] });

await t('the steps are five, in order; stepOf puts a person on the right one from the facts (pure)', () => {
  eq(T.STEPS.map((s) => s.id), ['name', 'make', 'try', 'share', 'done']);
  ok(T.STEPS.every((s) => s.title && s.say), 'words');
  eq(T.stepOf({}).id, 'name');
  eq(T.stepOf({ unit: 'ruby' }).id, 'make');
  eq(T.stepOf({ unit: 'ruby', exists: true }).id, 'try');
  eq(T.stepOf({ unit: 'ruby', exists: true, runs: [run('in_progress')] }).tried, 'running');
  eq(T.stepOf({ unit: 'ruby', exists: true, runs: [run('completed', 'failure')] }).tried, 'failed');
  eq(T.stepOf({ unit: 'ruby', exists: true, runs: [run('completed', 'success')] }).id, 'share');
  eq(T.stepOf({ unit: 'ruby', exists: true, runs: [run('completed', 'success', 'other')] }).id, 'try', 'another unit\'s run is not counted');
  eq(T.stepOf({ unit: 'ruby', exists: true, released: true }).id, 'done');
  const s = T.stateOf({ unit: 'ruby', units: [{ name: 'ruby', title: 'Ruby', kind: 'bds' }], releases: [rel('addon-ruby', 'Ruby.mcaddon')] });
  ok(s.exists && s.released, 'released from a release with a pack');
  ok(!T.stateOf({ unit: 'ruby', units: [{ name: 'ruby', kind: 'bds' }], releases: [rel('addon-ruby', null)] }).released, 'no pack: not released');
});

function fakeGitHub({ units = [], runs = [], releases = [] } = {}) {
  const st = { units, runs, releases, dispatched: [], bad: [] };
  const api = {
    call: async (m, u, body) => {
      const bad = fakeCheck(m, u, body); if (bad) throw new Error(bad.message);
      if (m === 'GET' && /\/contents\/bds\/addons$/.test(u)) return st.units.map((n) => ({ type: 'dir', name: n }));
      if (m === 'GET' && /\/contents\/bds\/addons\/(\w+)$/.test(u)) { if (st.units.includes(/addons\/(\w+)$/.exec(u)[1])) return []; const e = new Error('Not Found'); e.status = 404; throw e; }
      if (m === 'GET' && /\/releases\?/.test(u)) return st.releases;
      const e = new Error(`Not Found ${m} ${u}`); e.status = 404; throw e;
    },
    file: async () => null,
    runs: async () => st.runs,
    dispatch: async (slug, wf, ref, inputs) => { const bad = fakeCheck('POST', `/repos/${slug}/actions/workflows/${wf}/dispatches`, { ref, inputs }); if (bad) throw new Error(bad.message); st.dispatched.push(inputs); },
  };
  return { st, api };
}
const LAB = { slug: 'o/lab', role: 'admin', repo: { default_branch: 'main' }, secrets: [], workflows: [{ path: '.github/workflows/unit.yml' }] };
const buttons = (c) => c.all((e) => e.tagName === 'BUTTON');
const button = (c, re) => buttons(c).find((b) => re.test(b.textContent));
const settle = () => new Promise((r) => setTimeout(r, 20));

await t('the card walks name → make → try → share → done, each step with its words and one button; making and trying go through the guard', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/tutorial.mjs'), g = fakeGitHub(), seen = [];
  const guarded = async (action, detail, fn) => { seen.push([action, detail.job]); return (await fn()) ?? true; };
  const card = UI.tutorialCard({ api: g.api, lab: LAB, me: { login: 'o' }, guarded, go() {} });
  await settle();
  ok(/名前を決める/.test(card.textContent) && /英小文字/.test(card.textContent), 'the first step is told');
  // a wrong name: said, nothing sent
  const input = card.all((e) => e.tagName === 'INPUT')[0];
  input.value = 'Bad Name';
  await button(card, /名前を決めて作る/).click();
  ok(/名前は/.test(card.textContent) && !g.st.dispatched.length, 'a wrong name stops before anything is sent');
  input.value = 'ruby_sword';
  await button(card, /名前を決めて作る/).click(); await settle();
  eq(g.st.dispatched.map((d) => [d.job, d.unit]), [['new', 'ruby_sword']]);
  ok(/まだ見つかりません/.test(card.textContent) && button(card, /作る/), 'waiting for the unit: told, and a way to look again');
  g.st.units.push('ruby_sword');
  await button(card, /見直す/).click(); await settle();
  ok(/できました。次は試験/.test(card.textContent), 'on the try step');
  await button(card, /^試す/).click(); await settle();
  eq(g.st.dispatched.at(-1), { job: 'test', unit: 'ruby_sword' });
  g.st.runs = [run('in_progress', null, 'unit ruby_sword')];
  await button(card, /見直す/).click(); await settle();
  ok(/試している途中/.test(card.textContent), 'running');
  g.st.runs = [run('completed', 'success', 'unit ruby_sword')];
  await button(card, /見直す/).click(); await settle();
  ok(button(card, /仕上げて/), 'on the share step');
  await button(card, /仕上げて/).click(); await settle();
  eq(g.st.dispatched.at(-1), { job: 'go', unit: 'ruby_sword' });
  g.st.releases = [rel('addon-ruby_sword', 'ruby_sword.mcaddon')];
  await button(card, /見直す/).click(); await settle();
  ok(/おめでとう/.test(card.textContent) && /これからできること/.test(card.textContent), 'the congratulation and what next');
  eq(seen.map((x) => x[1]), ['new', 'test', 'go']);
});

await t('a failed trial says so with the next step; a refused guard starts nothing; a lab without unit.yml and a policy that says no give the reason', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/tutorial.mjs');
  const g = fakeGitHub({ units: ['ruby'], runs: [run('completed', 'failure', 'unit ruby')] });
  const card = UI.tutorialCard({ api: g.api, lab: LAB, guarded: async () => undefined }, { unit: 'ruby' });
  await settle();
  ok(/通りませんでした/.test(card.textContent), 'failed told');
  await button(card, /^試す/).click(); await settle();
  eq(g.st.dispatched, [], 'the guard said no: nothing started');
  const old = UI.tutorialCard({ api: g.api, lab: { ...LAB, workflows: [] }, guarded: async () => undefined }, { unit: 'ruby' });
  await settle();
  ok(button(old, /^試す/).attrs.disabled !== undefined && /unit\.yml がありません/.test(old.textContent), 'no unit.yml: the button is off and says why');
  const gate = () => ({ disabled: true, title: 'この役割には許されていません' });
  const no = UI.tutorialCard({ api: g.api, lab: LAB, gate, guarded: async () => undefined }, { unit: 'ruby' });
  await settle();
  ok(/この役割には許されていません/.test(no.textContent), 'the policy\'s reason shown');
  const broken = UI.tutorialCard({ api: { ...g.api, call: async () => { throw new Error('GitHub に届きません'); } }, lab: LAB }, { unit: 'ruby' });
  await settle();
  ok(/GitHub に届きません/.test(broken.textContent), 'a failed read is told, not an empty box');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
