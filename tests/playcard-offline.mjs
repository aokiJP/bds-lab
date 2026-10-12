// the 「🎮 遊び方カード」 without a browser or a network: the card made from TASK.md, tests.txt and bp/manifest.json (pure: what it
// does, the addon's own commands with what TASK.md says of each, its items, the title; Minecraft's own left out; Markdown
// that shows a < as a <), and the card on a small fake DOM over a fake GitHub on node:http (its rules: ghrules' fakeCheck):
// the three files read from the unit's folder, 「Markdown を写す」, English and back without reading again, an empty unit
// told how to fill it (the button not pressable, with the reason), a failure told with the way on and 「もう一度」.
// node tests/playcard-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const P = await imp('panel/lib/playcard.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const TASK = `# Shop

## Request
/lab:shop でフォームを開いてコインでアイテムを買える。/lab:pay <相手> <額> でコインを送れる。初めて参加したら 50 コイン

## Acceptance (one tests.txt \`## \` section each)
- [x] /lab:pay <相手> <額> でコインを送れる（## paying another player moves the coins）
- [x] /lab:sethome で今いる場所を家にし、/lab:home でそこへ戻る（## home）

## Guessed
<!-- values decided without asking -->
`;
const TESTS = `## buying
@A join
@A cmd /lab:shop
until form
@A form Bread
## pay
@B join
@A cmd /lab:pay B 20
@A cmd /lab:pay B -10
@A cmd /function tsrepl_start
@A cmd /give @s diamond
@A cmd /minecraft:give @s diamond
## items
give A lab:ruby 3
give A minecraft:bread 2
give A diamond_sword
@A select lab:wand
@A place lab:lamp 1 -60 1
@A cmd /lab:home
@A cmd /lab:sethome
@A cmd /lab:secret
`;
const MANIFEST = JSON.stringify({ format_version: 2, header: { name: '§6Shop', description: 'A coin shop', version: [1, 2, 0] }, modules: [] });

await t('the card (pure): the title from the manifest, what it does from TASK.md\'s first paragraph, the addon\'s own commands (each once, how it is typed and what TASK.md says of it, else an example) and items; Minecraft\'s own left out', () => {
  const c = P.playcard({ task: TASK, tests: TESTS, manifest: MANIFEST });
  eq(c.title, 'Shop');
  eq(c.what, '/lab:shop でフォームを開いてコインでアイテムを買える。/lab:pay <相手> <額> でコインを送れる。初めて参加したら 50 コイン');
  eq(c.commands, [
    { cmd: '/lab:shop', say: '/lab:shop でフォームを開いてコインでアイテムを買える' },
    { cmd: '/lab:pay <相手> <額>', say: '/lab:pay <相手> <額> でコインを送れる' },
    { cmd: '/lab:home', say: '/lab:home でそこへ戻る' },
    { cmd: '/lab:sethome', say: '/lab:sethome で今いる場所を家にし' },
    { cmd: '/lab:secret', say: '例: /lab:secret' },
  ]);
  eq(c.items, ['lab:ruby', 'lab:wand', 'lab:lamp']);
  eq(P.playcard({ task: TASK, tests: TESTS, manifest: MANIFEST, lang: 'en' }).commands.at(-1).say, 'e.g.: /lab:secret', 'the card\'s own words in English');
});

await t('the card (pure): no manifest → TASK.md\'s heading; no TASK.md → the pack\'s description; nothing at all → empty, and the Markdown says so; at most CARD_LIMIT of each', () => {
  eq(P.playcard({ task: TASK, tests: '' }).title, 'Shop');
  const d = P.playcard({ task: null, tests: null, manifest: MANIFEST });
  eq([d.title, d.what, d.commands, d.items], ['Shop', 'A coin shop', [], []]);
  const e = P.playcard({});
  eq([e.title, e.what, e.commands, e.items], ['', '', [], []]);
  ok(/まだ書かれていません/.test(e.md), e.md);
  ok(/Not written yet/.test(P.playcard({ lang: 'en' }).md), 'English');
  const many = Array.from({ length: 30 }, (_, i) => `@A cmd /lab:c${i}\ngive A lab:i${i}`).join('\n');
  const m = P.playcard({ tests: many });
  eq([m.commands.length, m.items.length], [P.CARD_LIMIT, P.CARD_LIMIT]);
  eq(P.firstParagraph('# T\n\n<!-- a note -->\n\n- [x] **one** line\ntwo `x`\n\nthree'), 'one line two x', 'marks out, the first paragraph only');
  eq(P.fromTests('@A cmd /Lab:X\n@A cmd /x:y\n give B a:b 1').commands.map((x) => x.name), ['/x:y'], 'only ids as the lab writes them');
});

await t('the Markdown (pure): headings in the card\'s language, commands as code, a < [ or | in the words shown and not read as HTML or a link, emphasis marks dropped', () => {
  const c = P.playcard({ task: TASK, tests: TESTS, manifest: MANIFEST });
  ok(c.md.startsWith('## 🎮 Shop\n\n### 何ができるか\n\n'), c.md);
  ok(c.md.includes('- `/lab:pay <相手> <額>` — /lab:pay \\<相手\\> \\<額\\> でコインを送れる'), c.md);
  ok(c.md.includes('### アイテム\n\n- `lab:ruby`\n- `lab:wand`\n- `lab:lamp`\n'), c.md);
  const en = P.playcard({ task: TASK, tests: TESTS, manifest: MANIFEST, lang: 'en' }).md;
  ok(/### What it does/.test(en) && /### Commands/.test(en) && /### Items/.test(en), en);
  const x = P.playcard({ task: '<img src=x onerror=alert(1)> *hi* [go](javascript:1) a|b', tests: '' }).md;
  ok(!/(^|[^\\])<img/.test(x) && x.includes('\\<img') && x.includes(' hi ') && x.includes('\\[go\\](javascript:1) a\\|b'), x);
});

// ---- a fake GitHub: the contents API for the unit's files (and every request kept) ----
async function fakeGitHub(files = {}, { fail = null } = {}) {
  const st = { seen: [], files, fail };
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === null || j === undefined ? '' : JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method, body = b ? JSON.parse(b) : null; let x;
      st.seen.push(`${m} ${u}`);
      { const bad = fakeCheck(m, u, body); if (bad) return send(res, 422, { message: bad.message }); }
      if (st.fail) return send(res, st.fail, { message: st.fail === 403 ? 'Resource not accessible by integration' : 'Server Error' });
      if ((x = /^\/repos\/o\/lab\/contents\/([^?]+)(?:\?ref=(.+))?$/.exec(u)) && m === 'GET') {
        const p = decodeURIComponent(x[1]), text = st.files[p];
        if (text === undefined) return send(res, 404, { message: 'Not Found' });
        return send(res, 200, { type: 'file', path: p, sha: 'abc', encoding: 'base64', content: Buffer.from(text).toString('base64') });
      }
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { st, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base: `http://127.0.0.1:${srv.address().port}` }) };
}

// ---- a small DOM: enough for panel/ui/dom.mjs's h and the card ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, open: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    set textContent(s) { this.replaceChildren(String(s)); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div'), clip = [];
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (s) => { clip.push(s); } } } });
  return { E, toast, clip };
}
const button = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];
const DIR = 'bds/addons/shop';
const FILES = { [`${DIR}/TASK.md`]: TASK, [`${DIR}/tests.txt`]: TESTS, [`${DIR}/bp/manifest.json`]: MANIFEST };
const LAB = { slug: 'o/lab', role: 'write' };

await t('the card: the three files read from the unit\'s folder (nothing written), the title, what it does, each command with its words and each item; 「Markdown を写す」 puts the Markdown on the clipboard', async () => {
  const { toast, clip } = fakeDom(), UI = await imp('panel/ui/playcard.mjs'), f = await fakeGitHub(FILES);
  try {
    const el = UI.playcardCard({ api: f.api, lab: LAB }, { name: 'shop', kind: 'bds' });
    ok(/読んでいます/.test(el.textContent), 'waiting said');
    await el.loaded;
    eq(f.st.seen.sort(), ['GET /repos/o/lab/contents/bds/addons/shop/TASK.md', 'GET /repos/o/lab/contents/bds/addons/shop/bp/manifest.json', 'GET /repos/o/lab/contents/bds/addons/shop/tests.txt']);
    ok(/Shop/.test(el.textContent) && /何ができるか/.test(el.textContent) && /初めて参加したら 50 コイン/.test(el.textContent), el.textContent);
    eq(el.all((e) => e.attrs['data-cmd']).map((e) => e.attrs['data-cmd']), ['/lab:shop', '/lab:pay <相手> <額>', '/lab:home', '/lab:sethome', '/lab:secret']);
    eq(el.all((e) => e.attrs['data-item']).map((e) => e.attrs['data-item']), ['lab:ruby', 'lab:wand', 'lab:lamp']);
    const cp = button(el, /Markdown を写す/);
    ok(!cp.disabled, 'pressable');
    await cp.click(); await new Promise((r) => setImmediate(r));
    eq(clip, [P.playcard({ task: TASK, tests: TESTS, manifest: MANIFEST }).md]);
    ok(/写しました/.test(toast.textContent), toast.textContent);
  } finally { f.close(); }
});

await t('English and back: the card\'s words change, the files are not read again; readPlaycard gives the Markdown alone for a release (at its tag)', async () => {
  fakeDom(); const UI = await imp('panel/ui/playcard.mjs'), f = await fakeGitHub(FILES);
  try {
    const el = UI.playcardCard({ api: f.api, lab: LAB }, { name: 'shop' });
    await el.loaded;
    const n = f.st.seen.length;
    await button(el, /^English$/).click();
    ok(/What it does/.test(el.textContent) && /Commands/.test(el.textContent) && /e\.g\.: \/lab:secret/.test(el.textContent), el.textContent);
    await button(el, /^日本語$/).click();
    ok(/何ができるか/.test(el.textContent), 'back');
    eq(f.st.seen.length, n, 'not read again');
    const r = await UI.readPlaycard({ api: f.api, lab: LAB }, { name: 'shop' }, { lang: 'en', ref: 'v1.2.0' });
    eq(r.md, P.playcard({ task: TASK, tests: TESTS, manifest: MANIFEST, lang: 'en' }).md);
    eq(r.found, ['TASK.md', 'tests.txt', 'bp/manifest.json']);
    ok(f.st.seen.slice(n).every((s) => s.endsWith('?ref=v1.2.0')), f.st.seen.slice(n).join());
  } finally { f.close(); }
});

await t('an empty unit: told how to fill it (which file, which lines), 「Markdown を写す」 not pressable and why', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/playcard.mjs'), f = await fakeGitHub({});
  try {
    const el = UI.playcardCard({ api: f.api, lab: LAB }, { name: 'blank' });
    await el.loaded;
    ok(el.all((e) => e.attrs['data-empty'] !== undefined).length === 1, el.textContent);
    ok(/bds\/addons\/blank\/TASK\.md/.test(el.textContent) && /@A cmd \/ns:名前/.test(el.textContent) && /give A ns:名前/.test(el.textContent), el.textContent);
    const cp = button(el, /Markdown を写す/);
    ok(cp.disabled && /TASK\.md か tests\.txt/.test(cp.attrs.title), JSON.stringify(cp.attrs));
    ok(E, 'dom');
    const only = await fakeGitHub({ 'bds/addons/half/tests.txt': '@A cmd /lab:go' });
    try {
      const h2 = UI.playcardCard({ api: only.api, lab: LAB }, { name: 'half' });
      await h2.loaded;
      ok(/TASK\.md の最初の段落に書くと出ます/.test(h2.textContent) && /アイテムはありません/.test(h2.textContent) && !button(h2, /Markdown を写す/).disabled, h2.textContent);
    } finally { only.close(); }
  } finally { f.close(); }
});

await t('a failure: GitHub\'s words in place with the way on (failView) and 「もう一度」 that reads again; a name that is not a unit is refused before any request', async () => {
  fakeDom(); const UI = await imp('panel/ui/playcard.mjs'), f = await fakeGitHub(FILES, { fail: 403 });
  try {
    const el = UI.playcardCard({ api: f.api, lab: LAB }, { name: 'shop' });
    await el.loaded;
    ok(el.all((e) => e.attrs.role === 'alert').length === 1 && /作れませんでした/.test(el.textContent), el.textContent);
    f.st.fail = null;
    await button(el, /もう一度/).click();
    await new Promise((r) => setTimeout(r, 30));
    ok(el.all((e) => e.attrs['data-cmd']).length === 5, el.textContent);
    const n = f.st.seen.length;
    const bad = UI.playcardCard({ api: f.api, lab: LAB }, { name: '../../etc' });
    await bad.loaded;
    ok(/ユニットの名前ではありません/.test(bad.textContent) && f.st.seen.length === n, bad.textContent);
  } finally { f.close(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
