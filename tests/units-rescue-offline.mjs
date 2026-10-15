// the 「アドオン」 and 「配布」 tabs with no dead end: a failure is never swallowed or left as a bare sentence — the list that
// could not be read says so and offers 「もう一度」 / GitHub's page, a silent "no release" is told apart from a failed read, a
// button that is off says why on the page, an empty list says what fills it, and the wrong input says what to do next.
// A small fake DOM and a fake api (what lib/gh.mjs gives: call, file, dispatch), no network.
// node tests/units-rescue-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const err = (status, message) => Object.assign(new Error(message), { status });

function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', parent: null }); }
    get disabled() { return this._d ?? 'disabled' in this.attrs; }
    set disabled(v) { this._d = Boolean(v); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    click() { return this.disabled ? Promise.resolve() : this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
    byId(id) { return this.all((e) => e.attrs.id === id)[0]; }
    button(re) { return this.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0]; }
    links() { return this.all((e) => e.tagName === 'A').map((a) => a.attrs.href); }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
/** a fake api: files = path → text; fail = path-prefix → the error thrown for it (any call or file read) */
function fakeApi({ files = {}, fail = {}, releases = [] } = {}) {
  const calls = [];
  const bad = (p) => Object.entries(fail).find(([k]) => p.startsWith(k))?.[1];
  const dirs = (p) => { const names = new Set(Object.keys(files).filter((f) => f.startsWith(`${p}/`)).map((f) => f.slice(p.length + 1).split('/')[0])); return [...names].map((name) => ({ type: 'dir', name })); };
  return {
    calls,
    async call(method, url, body) {
      const p = url.replace('/repos/o/lab/', ''); calls.push(`${method} ${p}`);
      { const bad = fakeCheck(method, url, body); if (bad) throw err(422, bad.message); } // (GitHub's rules for a write: ghrules)
      const e = bad(p); if (e) throw e;
      if (p.startsWith('releases')) return releases;
      if (p.startsWith('git/matching-refs')) return [];
      const m = /^contents\/(.+)$/.exec(p);
      if (m) { const d = dirs(m[1]); if (d.length) return d; if (files[m[1]] !== undefined) return { type: 'file', encoding: 'base64', content: Buffer.from(files[m[1]]).toString('base64'), sha: 's1' }; throw err(404, 'Not Found'); }
      throw err(404, 'Not Found');
    },
    async file(slug, p) { const e = bad(`contents/${p}`); if (e) throw e; return files[p] === undefined ? null : { text: files[p], sha: 's1' }; },
    async dispatch() {},
    async putFile() { return {}; },
  };
}
const MANIFEST = JSON.stringify({ format_version: 2, header: { name: 'Coins', description: 'A coin', uuid: 'u', version: [1, 0, 0] }, modules: [] });
const LAB = { 'bds/addons/coins/bp/manifest.json': MANIFEST, 'bds/addons/coins/TASK.md': '# Coins\n', 'bds/addons/coins/tests.txt': '## a\n', 'end/plugins/hub/pyproject.toml': 'x' };
const ctxOf = (api, extra = {}) => ({
  api, lab: { slug: 'o/lab', repo: { default_branch: 'main' }, workflows: [{ path: '.github/workflows/unit.yml' }, { path: '.github/workflows/notify.yml' }] },
  gate: () => ({}), go: () => {}, guarded: async (a, d, fn) => { try { return await fn(); } catch { return undefined; } }, dispatch: async () => {}, ...extra,
});
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

const U = await imp('panel/lib/units.mjs'), W = await imp('panel/lib/workspace.mjs');

// (the page's own hook, as panel.js sets it: lib/rescue.mjs's words and its next step under every failure drawn in place)
const D = await imp('panel/ui/dom.mjs'), RS = await imp('panel/lib/rescue.mjs');
D.setOnFail((e, retry) => { const r = RS.rescue(e, { lab: 'o/lab', owner: 'o' }), a = r.action; return D.h('span', { class: 'muted' }, `${r.why}。${r.next} `, a?.link ? D.link(a.link, a.label) : retry && a?.kind ? D.h('button', { onclick: () => retry() }, a.label) : null); });

await t('typed input that is wrong says what to do next (not just what is wrong)', () => {
  const next = /(もう一度|ください|してから|外す|消して|直して)/;
  const cases = [W.newUnitInputs({ unit: 'ok_name', title: 'x'.repeat(81) }).error, W.newUnitInputs({ unit: 'ok_name', request: 'x'.repeat(2001) }).error,
    W.newUnitInputs({ unit: 'ok_name', request: 'a\u0001b' }).error, W.newUnitInputs({ unit: 'ok_name', request: '--x' }).error, W.unitNameProblem('zz_shop'),
    W.unitNameProblem('shop_', { taking: true }), W.runInputs({ job: 'x', unit: 'a' }).error, W.checkEdit('x.yml', 'x', null).error, W.checkEdit('bp/manifest.json', '{', null).error,
    W.checkEdit('bp/manifest.json', '{}', null).error, W.checkEdit('tests.txt', ' ', null).error, W.checkEdit('TASK.md', 'x'.repeat(1_000_001), null).error];
  for (const c of cases) ok(c && next.test(c), `no next step: ${c}`);
  ok(W.UNIT_SAY.includes('例'), 'the name rule has an example');
});

await t('the units list names what it could not read (an extra folder, a file) instead of dropping it silently', async () => {
  const api = fakeApi({ files: LAB, fail: { 'contents/end/plugins': err(500, 'boom'), 'contents/bds/addons/coins/tests.txt': err(500, 'boom') } });
  const us = await U.listUnits(api, 'o/lab');
  ok(us.length === 1 && us.skipped.length === 1 && us.skipped[0].dir === 'end/plugins', JSON.stringify(us.skipped));
  ok(us[0].unread?.join() === 'tests.txt' && us[0].tests === null, 'tests.txt unread: named');
  const clean = await U.listUnits(fakeApi({ files: LAB }), 'o/lab');
  ok(!clean[0].unread && clean.skipped.length === 0, 'nothing wrong: nothing added');
});

await t('the 「アドオン」 tab: a list that cannot be read says what to do (and a button), the failed releases / extras / tests.txt are told, an empty search offers its way back', async () => {
  const { E } = fakeDom();
  const UI = await imp('panel/ui/units.mjs');
  // the units themselves unreadable (403): the words, the next step, and 「もう一度」 reads again
  const api0 = fakeApi({ files: LAB, fail: { 'contents/bds/addons': err(403, 'Resource not accessible by integration') } }), b0 = new E('div');
  await UI.unitsTab(b0, ctxOf(api0));
  const bad0 = b0.all((e) => e.className === 'bad')[0];
  ok(bad0 && /Resource not accessible/.test(bad0.textContent) && !/読んでいます/.test(b0.textContent), b0.textContent);
  const n0 = api0.calls.length;
  ok(b0.links().some((l) => /^https:\/\/github\.com\//.test(l)), `403 offers GitHub's page: ${b0.links()}`);
  const api1 = fakeApi({ files: LAB, fail: { 'contents/bds/addons': err(500, 'GitHub is down') } }), b1 = new E('div');
  await UI.unitsTab(b1, ctxOf(api1));
  const again = b1.button(/もう一度/);
  ok(again, `a 500 offers 「もう一度」: ${b1.textContent}`);
  const n1 = api1.calls.length; await again.click(); await settle();
  ok(api1.calls.length > n1, 'the button reads again'); ok(n0 > 0, 'sanity');
  // releases, the refs and a file unreadable: told, not shown as "no release"
  const api2 = fakeApi({ files: LAB, fail: { releases: err(500, 'x'), 'git/matching-refs': err(500, 'y'), 'contents/bds/addons/coins/tests.txt': err(500, 'z') } }), b2 = new E('div');
  await UI.unitsTab(b2, ctxOf(api2));
  const txt = b2.textContent;
  ok(/配布の一覧を読めませんでした/.test(txt) && /PR を待っているユニットを読めませんでした/.test(txt) && /tests\.txt 読めず/.test(txt) && /end\/plugins|読めませんでした（題/.test(txt), txt);
  ok(!/tests\.txt なし/.test(b2.all((e) => e.attrs['data-unit'] === 'bds/coins')[0].textContent), 'an unreadable tests.txt is not "none"');
  ok(b2.all((e) => e.tagName === 'BUTTON' && /もう一度/.test(e.textContent)).length >= 2, 'a retry for each');
  // an extra folder unreadable
  const api3 = fakeApi({ files: LAB, fail: { 'contents/end/plugins': err(500, 'boom') } }), b3 = new E('div');
  await UI.unitsTab(b3, ctxOf(api3));
  ok(/end\/plugins を読めませんでした/.test(b3.textContent) && b3.button(/^読み直す$/), b3.textContent);
  // a search that finds nothing: the way back
  const q = b3.all((e) => e.attrs.type === 'search')[0]; q.value = 'zzzz'; await q.fire('input');
  ok(/当てはまるアドオンがありません/.test(b3.textContent), 'said');
  await b3.button(/探す欄を空にする/).click();
  ok(q.value === '' && b3.all((e) => e.attrs['data-unit']).length >= 1, 'cleared: the units are back');
  // a unit without tests.txt: why and what to do
  const b4 = new E('div'); await UI.unitsTab(b4, ctxOf(fakeApi({ files: { 'bds/addons/coins/bp/manifest.json': MANIFEST } })));
  ok(b4.all((e) => /tests\.txt なし/.test(e.textContent) && e.attrs.title && /AI で変える/.test(e.attrs.title)).length >= 1, 'the chip says what to do');
});

await t('the cards: a lab without unit.yml says how to get it; the wrong input says what to do next; a failed take-in says so on the page', async () => {
  const { E, toast } = fakeDom();
  const UW = await imp('panel/ui/workspace.mjs');
  ok(/新しくすると使えます/.test(UW.startAttrs(ctxOf(fakeApi(), { lab: { slug: 'o/lab', workflows: [] } })).title), 'no unit.yml');
  const nu = UW.newUnitCard(ctxOf(fakeApi()));
  nu.byId('newunit-name').value = 'Bad Name'; await nu.button(/^作る$/).click();
  ok(/例/.test(toast.textContent), toast.textContent);
  const im = UW.importCard(ctxOf(fakeApi()));
  await im.button(/^取り込む$/).click(); ok(/ファイルを選んでください/.test(toast.textContent), 'no file');
  im.byId('import-file').files = [{ name: 'a.zip', size: 0 }];
  await im.button(/^取り込む$/).click();
  ok(/空のファイルです。ファイルを選び直す/.test(toast.textContent), toast.textContent);
  // a pack the lab refuses: nothing said but a toast would leave the box silent
  const f = { name: 'pack.mcaddon', size: 10 };
  const im2 = UW.importCard(ctxOf(fakeApi(), { guarded: async () => undefined })); im2.byId('import-file').files = [f];
  await im2.button(/^取り込む$/).click();
  ok(/取り込めませんでした/.test(im2.byId('import-state').textContent), im2.byId('import-state').textContent);
  void E;
});

await t('the editor: a file that is not there offers GitHub, a read that fails offers 「もう一度」, an unread file disables saving with recovery instructions, Endstone units get the GitHub page', async () => {
  const { E } = fakeDom();
  const UW = await imp('panel/ui/workspace.mjs');
  const unit = U.unitSummary({ name: 'coins', manifest: MANIFEST });
  const ed = UW.editorView(ctxOf(fakeApi({ files: { ...LAB, 'bds/addons/coins/TASK.md': undefined } })), unit); await settle();
  const pick = ed.byId('edit-file'), state = ed.byId('edit-state');
  pick.value = 'TASK.md'; await pick.fire('change'); await settle();
  ok(/TASK\.md はこのユニットにありません/.test(state.textContent) && state.links().some((l) => l.startsWith('https://github.com/o/lab/new/main/bds/addons/coins?filename=TASK.md')), state.textContent);
  const api = fakeApi({ files: LAB, fail: { 'contents/bds/addons/coins/src/main.ts': err(500, 'GitHub is down') } });
  const ed2 = UW.editorView(ctxOf(api), unit); await settle();
  const s2 = ed2.byId('edit-state');
  ok(/GitHub is down/.test(s2.textContent) && s2.button(/もう一度/), s2.textContent);
  const save = ed2.button(/^保存$/), writesBefore = api.calls.length;
  ok(save.disabled && /「読み直す」を押してください/.test(save.title), save.title);
  await save.click(); ok(api.calls.length === writesBefore, 'an unread file sends no write');
  const n = api.calls.length; await s2.button(/もう一度/).click(); await settle(); ok(api.calls.length > n, 'retry reads again');
  const end = UW.editorView(ctxOf(fakeApi()), U.unitSummary({ kind: 'end', name: 'hub' }));
  ok(end.links().some((l) => l === 'https://github.com/o/lab/tree/main/end/plugins/hub') && /GitHub の画面で直してください/.test(end.textContent), end.textContent);
  void E;
});

await t('the 「配布」 tab: a failed read has a next step, an off button says why on the page, an empty list says what fills it', async () => {
  const { E } = fakeDom();
  const UR = await imp('panel/ui/releases.mjs');
  const api = fakeApi({ fail: { releases: err(404, 'Not Found') } }), b = new E('div');
  await UR.releasesTab(b, ctxOf(api));
  ok(b.all((e) => e.className === 'bad').length === 1 && b.links().some((l) => /^https:\/\/github\.com\//.test(l)) && !/読んでいます/.test(b.textContent), b.textContent);
  const c1 = ctxOf(fakeApi(), { lab: { slug: 'o/lab', workflows: [] } }), b1 = new E('div'); await UR.releasesTab(b1, c1);
  ok(/notify\.yml がありません: ラボを新しくすると使えます（フォークなら GitHub のラボのページで Sync fork → Update branch）/.test(b1.textContent), b1.textContent);
  const went = [], c2 = ctxOf(fakeApi(), { caps: { notify: { ok: false, need: '秘密 DISCORD_BOT_TOKEN' } }, go: (x) => went.push(x) }), b2 = new E('div'); await UR.releasesTab(b2, c2);
  ok(/DISCORD_BOT_TOKEN/.test(b2.textContent) && /「秘密」タブで入れる/.test(b2.textContent), b2.textContent);
  await b2.button(/「秘密」を開く/).click(); ok(went.join() === 'secrets', 'the way to the secrets');
  ok(b2.links().includes('https://github.com/o/lab/releases/new') && b2.button(/「アドオン」で作る/), 'an empty list: how to fill it');
  const rel = [{ tag_name: 'v1', name: 'v1', draft: true, html_url: 'https://github.com/o/lab/releases/v1', assets: [], created_at: '2026-01-01T00:00:00Z' }]
  const b3 = new E('div'); await UR.releasesTab(b3, ctxOf(fakeApi({ releases: rel })));
  ok(/ファイルがありません。/.test(b3.textContent) && /公開してから知らせます/.test(b3.button(/Discord/).attrs.title), b3.textContent);
});

await t('wayOut: GitHub\'s words kept, the next step under them (no secret, no address but GitHub\'s)', async () => {
  fakeDom();
  const { wayOut } = await imp('panel/ui/workspace.mjs');
  const ctx = ctxOf(fakeApi());
  for (const e of [err(401, 'Bad credentials'), err(403, 'nope'), err(404, 'Not Found'), err(409, 'x'), err(422, 'x'), err(500, 'x'), new Error('Failed to fetch'), 'odd']) {
    const v = wayOut(e, ctx, () => {});
    ok([v, ...v.all(() => true)].filter((x) => x.className === 'bad').length === 1 && v.all((x) => x.className === 'muted')[0].textContent.length > 5, `a next step for ${e?.status ?? e}`);
    for (const l of v.links()) ok(/^https:\/\/(github\.com|api\.github\.com)\//.test(l), l);
  }
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
