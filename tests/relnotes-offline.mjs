// the release-notes draft without a browser or a network: titles sorted into new / fixed / other (Japanese and English), merged
// pull requests read by their own title, a unit's folder as the filter, the previous tag found, the first version, and the card
// on a small fake DOM (a fake GitHub on node:http that answers through ghrules) — failure with the way on, copy button.
// node tests/relnotes-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const R = await imp('panel/lib/relnotes.mjs'), G = await imp('panel/lib/gh.mjs');
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const C = (sha, message) => ({ sha: sha.padEnd(40, '0'), commit: { message } });
const COMMITS = [
  C('a1', 'feat(shop): ルビーの店を追加'), C('b2', 'fix: 看板が消える不具合を修正'), C('c3', 'Merge pull request #12 from o/x\n\nAdd a gold pickaxe'),
  C('d4', 'Merge branch main into x'), C('e5', 'README を整える'), C('f6', 'Fixed crash when joining (#15)'), C('a7', 'ルビーの店を追加'),
];
const FILES = { a1: ['bds/addons/shop/src/main.ts'], b2: ['bds/addons/shop/bp/x.json'], c3: ['bds/addons/other/a.json'], e5: ['README.md'], f6: ['bds/addons/shop/rp/y.png'], a7: ['bds/addons/shop/z'] };

await t('titles: the merged pull request\'s own title, a number from the squash, the programmer\'s lead cut', () => {
  eq(R.titleOf('Merge pull request #12 from o/x\n\nAdd a pickaxe'), { title: 'Add a pickaxe', pr: 12 });
  eq(R.titleOf('Fixed crash (#15)\n\nbody'), { title: 'Fixed crash', pr: 15 });
  eq(R.titleOf(''), { title: '', pr: null });
});
await t('classify: Japanese and English; a fix wins; the rest is other', () => {
  eq(['ルビーを追加', 'Add ruby', 'feat: x', '看板を直した', 'fix: sign', 'Fixed crash', 'バグ修正', 'READMEを整える', 'Add a fix for signs'].map(R.classify),
    ['new', 'new', 'new', 'fixed', 'fixed', 'fixed', 'fixed', 'other', 'fixed']);
});
await t('sortCommits: three lists, branch merges and repeated titles left out, no lead word', () => {
  const d = R.sortCommits(COMMITS);
  eq(d.new.map((x) => x.title), ['ルビーの店を追加', 'Add a gold pickaxe']);
  eq(d.fixed.map((x) => x.title), ['看板が消える不具合を修正', 'Fixed crash when joining']);
  eq(d.other.map((x) => x.title), ['README を整える']);
  eq(d.new[1].pr, 12);
});
await t('unit folder and tag names; markdown for players', () => {
  eq(R.unitDir({ name: 'shop' }), 'bds/addons/shop/'); eq(R.unitDir({ name: '../x' }), '');
  ok(R.touches([{ filename: 'bds/addons/shop/a' }], { name: 'shop' }) && !R.touches([{ filename: 'bds/addons/shopkeeper/a' }], { name: 'shop' }), 'touches');
  eq(R.tagOf({ name: 'shop' }), 'addon-shop');
  const md = R.toMarkdown(R.sortCommits(COMMITS), { title: 'shop', from: 'addon-shop-v1' });
  ok(/### 新しくなったこと\n- ルビーの店を追加/.test(md) && /Add a gold pickaxe \(#12\)/.test(md) && /### 直したこと/.test(md) && /addon-shop-v1 からの/.test(md), md);
  ok(/最初の版/.test(R.toMarkdown({ new: [], fixed: [], other: [] })), 'first');
});

async function fakeGitHub(init = {}) {
  const seen = [];
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method; let x; seen.push(`${m} ${u}`);
      { const bad = fakeCheck(m, u, b ? JSON.parse(b) : null); if (bad) return send(res, 422, { message: bad.message }); }
      if (init.down) return send(res, 500, { message: 'boom' });
      if (/^\/repos\/o\/lab\/releases\?/.test(u)) return send(res, 200, init.releases ?? [
        { tag_name: 'addon-shop-plus', published_at: '2026-03-01T00:00:00Z' }, { tag_name: 'addon-shop-v1', published_at: '2026-01-01T00:00:00Z' }, { tag_name: 'addon-shop-v2', draft: true, published_at: '2026-04-01T00:00:00Z' }]);
      if ((x = /^\/repos\/o\/lab\/compare\/(.+)\.\.\.(.+)$/.exec(u))) return send(res, 200, { commits: COMMITS });
      if ((x = /^\/repos\/o\/lab\/commits\/(\w{2})0+$/.exec(u))) return send(res, 200, { files: (FILES[x[1]] ?? []).map((filename) => ({ filename })) });
      if (/^\/repos\/o\/lab\/commits\?/.test(u)) return send(res, 200, [COMMITS[1], COMMITS[0]]);
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { seen, api: G.gh({ token: 'x', base: `http://127.0.0.1:${srv.address().port}` }), close: () => srv.close() };
}

await t('previousTag: the unit\'s own newest published tag, never another unit\'s (shop-plus) nor a draft; none → null', async () => {
  const f = await fakeGitHub();
  try { eq(await R.previousTag(f.api, 'o/lab', { name: 'shop' }), 'addon-shop-v1'); eq(await R.previousTag(f.api, 'o/lab', { name: 'zzz' }), null); } finally { f.close(); }
});
await t('draftNotes for a unit: compare from the tag, only commits touching bds/addons/shop/, the merge of branches skipped', async () => {
  const f = await fakeGitHub();
  try {
    const d = await R.draftNotes(f.api, 'o/lab', { unit: { name: 'shop' }, head: 'main' });
    eq(d.from, 'addon-shop-v1'); eq(d.count, 3);
    eq(d.draft.new.map((x) => x.title), ['ルビーの店を追加']);
    ok(!d.markdown.includes('gold pickaxe') && !d.markdown.includes('README'), d.markdown);
    ok(f.seen.some((s) => s.includes('compare/addon-shop-v1...main')), f.seen.join('\n'));
  } finally { f.close(); }
});
await t('draftNotes without a tag: the first version from the unit\'s own commits', async () => {
  const f = await fakeGitHub();
  try {
    const d = await R.draftNotes(f.api, 'o/lab', { unit: { name: 'shop' }, fromTag: null });
    eq(d.from, null); ok(/最初の版/.test(d.markdown) && d.count === 2, d.markdown);
    ok(f.seen.some((s) => s.includes('path=bds%2Faddons%2Fshop')), f.seen.join());
  } finally { f.close(); }
});

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
    remove() {}
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null) };
  return { toast };
}
const settle = () => new Promise((r) => setTimeout(r, 80));
const btn = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];

await t('the card: the draft shown, the copy button waits for it then copies; the record has no text', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/relnotes.mjs'), f = await fakeGitHub();
  const rec = [], copied = [];
  try {
    const c = UI.relnotesCard({ api: f.api, lab: { slug: 'o/lab' }, clipboard: { writeText: async (s) => copied.push(s) }, record: (a, d) => rec.push([a, d]) }, { unit: { name: 'shop' } });
    ok(btn(c, /写す/).disabled, 'copy waits for the draft');
    await settle();
    ok(/ルビーの店を追加/.test(c.textContent) && !btn(c, /写す/).disabled, c.textContent);
    await btn(c, /写す/).click();
    ok(copied.length === 1 && /直したこと/.test(copied[0]) && /写しました/.test(toast.textContent), 'copied');
    eq(rec, [['relnotes', { unit: 'shop', count: 3 }]]);
  } finally { f.close(); }
});
await t('the card: no tag → the first version; a lab that cannot be read → the words and 「もう一度」; nothing to say → how to fill', async () => {
  fakeDom();
  const UI = await imp('panel/ui/relnotes.mjs');
  let f = await fakeGitHub();
  try {
    const c = UI.relnotesCard({ api: f.api, lab: { slug: 'o/lab' } }, { unit: { name: 'shop' }, fromTag: null });
    await settle(); ok(/最初の版/.test(c.textContent), c.textContent);
  } finally { f.close(); }
  f = await fakeGitHub({ down: true });
  try {
    const c = UI.relnotesCard({ api: f.api, lab: { slug: 'o/lab' } }, { unit: { name: 'shop' } });
    await settle(); ok(/GitHub: 500/.test(c.textContent) && c.all((e) => e.attrs.role === 'alert').length === 1 && btn(c, /写す/).disabled && btn(c, /もう一度/), c.textContent);
  } finally { f.close(); }
  f = await fakeGitHub();
  try {
    const c = UI.relnotesCard({ api: f.api, lab: { slug: 'o/lab' } }, { unit: { name: 'nothing' }, fromTag: 'addon-nothing-v1' });
    await settle(); ok(/まだありません/.test(c.textContent) && btn(c, /写す/).disabled, c.textContent);
  } finally { f.close(); }
});

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
