// the panel's 「何がしたい？」 without a browser: the tree (pure: every path ends at a tab of the panel, nothing loops), a leaf
// resolved for a role/lab that may not use it (the reason and another way), and the card on a small fake DOM (one question at
// a time, 戻る / 最初から, the state kept in storage, the go button calling ctx.go).
// node tests/wizard-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const W = await imp('panel/lib/wizard.mjs'), P = await imp('panel/lib/policy.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// the tabs panel.js knows (read from its source, so a rename there fails here)
const src = fs.readFileSync(path.join(TOP, 'panel/panel.js'), 'utf8');
const TABS = [...(/const TABS = \[(.*?)\];/s.exec(src)?.[1] ?? '').matchAll(/\['(\w+)'/g)].map((m) => m[1]);

// a small fake DOM: click calls onclick, a disabled button is not pressed
class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; this.onclick = null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, f) { if (k === 'click') this.onclick = f; }
  append(...c) { this.kids.push(...c); }
  replaceChildren(...c) { this.kids = c; }
  get text() { return this.kids.map((k) => (typeof k === 'string' ? k : k.text)).join(''); }
  all(f, out = []) { if (f(this)) out.push(this); for (const k of this.kids) if (k instanceof El) k.all(f, out); return out; }
  click() { if ('disabled' in this.attrs) return; this.onclick?.(); }
}
globalThis.Node = El;
globalThis.document = { createElement: (t) => new El(t), createTextNode: (s) => String(s) };
const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const U = await imp('panel/ui/wizard.mjs');
const btn = (card, a, v) => card.all((e) => e.tag === 'button' && e.attrs[a] === v)[0];

await t('every path ends at a leaf on a real tab, with no loop', () => {
  ok(TABS.length > 10, 'tabs read');
  eq(W.next([]).options.length, 3);
  let leaves = 0;
  const walk = (p) => { const r = W.next(p); if (r.go) { leaves++; ok(TABS.includes(r.go.tab), `tab ${r.go.tab}`); ok(r.go.say.length > 10, 'say'); return; } ok(p.length < 4, 'deep'); eq(r.options.length >= 2 && r.options.length <= 3, true, p.join('/')); for (const o of r.options) walk([...p, o.id]); };
  walk([]);
  ok(leaves >= 9, `leaves ${leaves}`);
  for (const l of Object.values(W.LEAVES)) { ok(TABS.includes(l.tab), l.tab); if (l.need) ok(P.ACTIONS.includes(l.need), l.need); }
});
await t('next: a wrong path is told, not thrown; a leaf has no question after it', () => {
  ok(W.next(['nope']).error, 'unknown');
  ok(W.next(['make', 'idea', 'x']).error, 'past the end');
  eq(W.next(['make', 'idea']).key, 'idea');
});
await t('resolve: allowed goes straight; not allowed gives the reason and another way', () => {
  const all = { tabs: () => TABS, may: () => true };
  eq(W.resolve('idea', all).tab, 'start'); eq(W.resolve('idea', all).focus, 'make');
  const read = { tabs: () => ['overview', 'hosts', 'settings'], may: (a) => P.can(P.DEFAULT_POLICY, 'read', a) };
  const r = W.resolve('idea', read);
  eq(r.tab, 'overview'); ok(r.why && r.from === 'idea', 'why');
  const noSecret = { tabs: () => TABS, may: (a) => a !== 'secrets.put' };
  const s = W.resolve('secret', noSecret);
  eq(s.tab, 'connect'); ok(/secrets\.put/.test(s.why), 'names the action');
  eq(W.resolve('guide', { tabs: () => [], may: () => true }).tab, undefined);
  ok(W.resolve('guide', { tabs: () => [], may: () => true }).why, 'nothing: a reason');
});
await t('card: one question at a time, back, restart, state in storage, go', () => {
  const storage = store(), went = [];
  const ctx = { tabs: () => TABS, may: () => true, storage, labSlug: 'o/lab', go: (tab, focus) => went.push([tab, focus]) };
  const card = U.wizardCard(ctx);
  eq(card.all((e) => e.attrs['data-choice']).length, 3);
  btn(card, 'data-choice', 'make').click();
  ok(/どうやって作り/.test(card.text), 'second question');
  eq(JSON.parse(storage.getItem('bdslab.panel.wizard.o/lab')), ['make']);
  btn(card, 'data-act', 'back').click();
  ok(/何がしたいですか/.test(card.text) && !btn(card, 'data-act', 'back'), 'back at root');
  btn(card, 'data-choice', 'make').click(); btn(card, 'data-choice', 'idea').click();
  ok(/アイデアからアドオン/.test(card.text) && /#make/.test(card.text), 'leaf with focus');
  btn(card, 'data-go', 'start').click();
  eq(went, [['start', 'make']]);
  btn(card, 'data-act', 'restart').click();
  eq(storage.getItem('bdslab.panel.wizard.o/lab'), '[]');
  // a redraw keeps the place; a broken value starts over
  btn(card, 'data-choice', 'share').click();
  ok(/どうやって配り/.test(U.wizardCard(ctx).text), 'kept');
  storage.setItem('bdslab.panel.wizard.o/lab', '{not json');
  ok(/何がしたいですか/.test(U.wizardCard(ctx).text), 'bad value');
  storage.setItem('bdslab.panel.wizard.o/lab', '["zzz"]');
  ok(/何がしたいですか/.test(U.wizardCard(ctx).text), 'unknown id');
});
await t('card: a place the role cannot use shows why and the other way (no dead button)', () => {
  const storage = store(), went = [];
  const ctx = { tabs: () => ['overview', 'hosts', 'settings'], may: () => false, storage, go: (tab) => went.push(tab) };
  storage.setItem('bdslab.panel.wizard.', JSON.stringify(['share', 'invite']));
  const card = U.wizardCard(ctx);
  ok(card.all((e) => e.attrs['data-why']).length === 1, 'why shown');
  ok(/メンバー/.test(card.text), 'names the tab');
  btn(card, 'data-go', 'overview').click();
  eq(went, ['overview']);
  const none = U.wizardCard({ ...ctx, tabs: () => [], storage });
  ok(none.all((e) => e.attrs.role === 'alert').length === 1 && !none.all((e) => e.attrs['data-go']).length, 'no go button');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
