// the pull-request watch without a browser or a network: risk (what a patch to .github/ changes: permissions, pull_request_target,
// secrets, outside actions not pinned) and the card on a small fake DOM over a fake GitHub (lib/gh.mjs, every request through
// ghrules' fakeCheck): reads only, danger first, only github.com links, a refused read told.
// node tests/wfwatch-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

class Node { constructor() { this.kids = []; this.attrs = {}; } append(...k) { this.kids.push(...k); } replaceChildren(...k) { this.kids = k; } setAttribute(k, v) { this.attrs[k] = v; } addEventListener() {} }
class Text extends Node { constructor(s) { super(); this.text = s; } }
globalThis.Node = Node;
globalThis.document = { createElement: (tag) => Object.assign(new Node(), { tag }), createTextNode: (s) => new Text(s) };
const text = (n) => (n instanceof Text ? n.text : (n.kids ?? []).map(text).join(''));
const find = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of n.kids ?? []) find(k, f, out); return out; };

// (the page's requests counted where they start: a wait ends when none is open and none has come or gone for a while)
const net = { busy: 0, at: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (...x) => { net.busy++; net.at = Date.now(); try { return await realFetch(...x); } finally { net.busy--; net.at = Date.now(); } };
const settle = async () => {
  const until = Date.now() + 10_000;
  await new Promise((r) => setTimeout(r, 30));
  while (Date.now() < until && (net.busy > 0 || Date.now() - net.at < 60)) await new Promise((r) => setTimeout(r, 15));
  await new Promise((r) => setTimeout(r, 0));
};

const W = await imp('panel/lib/wfwatch.mjs'), UI = await imp('panel/ui/wfwatch.mjs');
const wf = (...lines) => ({ filename: '.github/workflows/x.yml', patch: `@@ -1,2 +1,5 @@\n context\n${lines.map((l) => `+${l}`).join('\n')}\n-gone: write` });
const SHA = 'a'.repeat(40);

await t('nothing under .github: none', () => {
  eq(W.risk([{ filename: 'panel/panel.js', patch: '+pull_request_target' }]), { level: 'none', why: [] });
  eq(W.risk(null), { level: 'none', why: [] }); eq(W.risk([null, {}]), { level: 'none', why: [] });
});
await t('a plain workflow change: look', () => {
  const r = W.risk([wf('      - run: echo hi')]);
  eq(r.level, 'look'); ok(r.why.length === 1, r.why.join());
});
await t('pull_request_target and write permissions: danger; removed lines do not count', () => {
  eq(W.risk([wf('on: pull_request_target')]).level, 'danger');
  eq(W.risk([wf('  contents: write')]).level, 'danger');
  eq(W.risk([wf('permissions: write-all')]).level, 'danger');
  eq(W.risk([wf('  contents: read')]).level, 'look');
  eq(W.risk([{ filename: '.github/workflows/x.yml', patch: '@@ -1 +1 @@\n-on: pull_request_target\n-  contents: write\n+on: push' }]).level, 'look');
});
await t('secrets and outside actions: look; a commit pin, a local action and a comment are quiet', () => {
  ok(W.risk([wf('  T: ${{ secrets.TOKEN }}')]).why.some((w) => w.includes('秘密')), 'secrets');
  ok(W.risk([wf('      - uses: actions/checkout@v5')]).why.some((w) => w.includes('actions/checkout') && w.includes('固定')), 'tag');
  ok(W.risk([wf('      - uses: actions/checkout')]).why.some((w) => w.includes('固定')), 'no ref');
  eq(W.risk([wf(`      - uses: actions/checkout@${SHA} # v5`)]).why.length, 1, 'pinned: only the generic reason');
  eq(W.risk([wf('      - uses: ./.github/actions/mine')]).why.length, 1, 'local');
  eq(W.risk([wf('  # secrets.X in a comment')]).why.length, 1, 'comment: only the generic reason');
});
await t('a patch GitHub did not give is said, not trusted; the highest level wins; a reason is said once', () => {
  const r = W.risk([{ filename: '.github/workflows/big.yml' }, wf('on: pull_request_target', 'on: pull_request_target')]);
  eq(r.level, 'danger'); ok(r.why.some((w) => w.includes('big.yml')), 'big'); eq(r.why.filter((w) => w.includes('pull_request_target')).length, 1);
  eq(W.risk([{ filename: '.github/dependabot.yml', patch: '+x: 1' }]).why, ['.github の中身が変わります']);
});

const PRS = [{ number: 1, title: 'docs', html_url: 'https://github.com/o/lab/pull/1' }, { number: 2, title: 'ci tweak', html_url: 'https://github.com/o/lab/pull/2' }, { number: 3, title: 'evil', html_url: 'https://evil.example/pull/3' }];
const FILES = { 1: [{ filename: 'README.md', patch: '+hi' }], 2: [wf('  T: ${{ secrets.TOKEN }}')], 3: [wf('on: pull_request_target')] };
const fakeGh = async (answer) => {
  const G = await imp('panel/lib/gh.mjs'), { fakeCheck } = await imp('panel/lib/ghrules.mjs'), seen = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', bad = fakeCheck(method, u.pathname, init.body ? JSON.parse(init.body) : undefined);
    seen.push(`${method} ${u.pathname}`);
    const [status, body] = bad ? [422, { message: bad.message }] : answer(method, u.pathname);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { api: G.gh({ token: 't', fetchImpl }), seen };
};
await t('the card lists only the risky PRs, danger first, reads only, github.com links only', async () => {
  const f = await fakeGh((m, p) => {
    if (m === 'GET' && p === '/repos/o/lab/pulls') return [200, PRS];
    const n = /^\/repos\/o\/lab\/pulls\/(\d)\/files$/.exec(p);
    return m === 'GET' && n ? [200, FILES[n[1]]] : [404, { message: 'Not Found' }];
  });
  const el = UI.wfWatchCard({ api: f.api, lab: { slug: 'o/lab' } });
  await settle();
  ok(f.seen.every((s) => s.startsWith('GET ')), `only reads: ${f.seen}`);
  eq(f.seen.length, 4, f.seen.join());
  const s = text(el);
  ok(s.includes('2 件の PR') && s.includes('3 件のうち'), s);
  ok(!s.includes('docs'), 'quiet PR left out');
  ok(s.indexOf('evil') < s.indexOf('ci tweak'), 'danger first');
  ok(!find(el, (n) => n.tag === 'a').some((a) => !a.attrs.href.startsWith('https://github.com/')), 'links');
  ok(!find(el, (n) => n.tag === 'a').some((a) => a.attrs.href.includes('evil')), 'no outside link');
  ok(text(find(el, (n) => n.attrs['data-level'] === 'danger')[0]).includes('evil'), 'danger marked');
});
await t('no risky PR is said calmly; a refused read is told, not blank', async () => {
  const f = await fakeGh((m, p) => (p === '/repos/o/lab/pulls' ? [200, []] : [404, { message: 'Not Found' }]));
  const el = UI.wfWatchCard({ api: f.api, lab: { slug: 'o/lab' } });
  await settle();
  ok(text(el).includes('0 件の PR は、どれも'), text(el));
  const g = await fakeGh(() => [403, { message: 'Resource not accessible by integration' }]);
  const el2 = UI.wfWatchCard({ api: g.api, lab: { slug: 'o/lab' } });
  await settle();
  ok(/権限がありません/.test(text(el2)) && /Resource not accessible/.test(text(el2)), text(el2));
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
