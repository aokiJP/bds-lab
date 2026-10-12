// the panel's 🔍 版の比較 without a browser or a network: zips made here (stored and deflate, folders, a comment) read by
// lib/packdiff.mjs's own reader (the inflate: DecompressionStream, as in the browser), an .mcaddon's .mcpack opened one level,
// the refusals in words (not a zip, over 50 MB, encrypted, another method, a wrong CRC, cut short, a zip bomb), Bedrock's JSON
// (comments, trailing commas, a BOM), the diff (files added, removed, changed, sizes, JSON keys), a release's file fetched
// only through the api, and the card on a small fake DOM: the newest two chosen, 比べる, the result, a button that cannot be
// pressed saying why, a failure in place, a file from this device; nothing written to GitHub.
// node tests/packdiff-offline.mjs
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const D = await imp('panel/lib/packdiff.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const rejects = async (p, re, m = '') => { let e = null; try { await p; } catch (x) { e = x; } ok(e && re.test(e.message), `${m} want ${re} got ${e?.message ?? 'no error'}`); return e; };

// ---- a small zip writer (what the lab's own `go` makes: stored or deflate; local headers, the central directory, its end) ----
const enc = new TextEncoder();
const bytes = (x) => (typeof x === 'string' ? enc.encode(x) : x instanceof Uint8Array ? x : new Uint8Array(x));
/** files: [[name, content, { method, flags, crc, size }?]] → Uint8Array */
function zip(files, { comment = '' } = {}) {
  const locals = [], cds = []; let off = 0;
  for (const [name, content, o = {}] of files) {
    const data = bytes(content ?? ''), n = enc.encode(name), method = o.method ?? (name.endsWith('/') ? 0 : 8);
    const packed = method === 8 ? new Uint8Array(zlib.deflateRawSync(data)) : data, crc = o.crc ?? zlib.crc32(data), usize = o.size ?? data.length;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(o.flags ?? 0, 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(o.flags ?? 0, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, packed); cds.push(ch, n); off += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(cds), c = enc.encode(comment), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16); end.writeUInt16LE(c.length, 20);
  return new Uint8Array(Buffer.concat([...locals, cd, end, c]));
}
const text = (m, p) => new TextDecoder().decode(m.get(p));
const manifest = (v, extra = {}) => JSON.stringify({ format_version: 2, header: { name: 'Coins', uuid: 'aaaa', version: v }, modules: [{ type: 'data', version: v }], ...extra }, null, 2);
const BIG = 'x'.repeat(5000);
const packV1 = () => zip([['coins_bp/', ''], ['coins_bp/manifest.json', manifest([1, 0, 0])], ['coins_bp/scripts/main.js', `// v1\n${BIG}`], ['coins_bp/items/coin.json', '{ "a": 1 }'], ['coins_bp/old.txt', 'bye']]);
const packV2 = () => zip([['coins_bp/manifest.json', manifest([1, 1, 0], { dependencies: [{ module_name: '@minecraft/server' }] })], ['coins_bp/scripts/main.js', `// v2\n${BIG}${BIG}`], ['coins_bp/items/coin.json', '{\n  "a": 1\n}\n'], ['coins_bp/new.png', new Uint8Array([137, 80, 78, 71])]]);
const addon = (bp, rp = zip([['rp/manifest.json', '{"header":{"name":"R"}}']], { method: 0 })) => zip([['Coins_BP.mcpack', bp, { method: 0 }], ['Coins_RP.mcpack', rp], ['README.txt', 'hi']]);

await t('readZip: stored and deflate (DecompressionStream, as in the browser), folders left out, a zip with a comment, its order kept; each file checked against its CRC', async () => {
  const z = zip([['a/', ''], ['a/s.txt', 'stored text', { method: 0 }], ['a/d.json', '{"k":"deflated deflated deflated"}'], ['b\\win.txt', 'back']], { comment: 'made by a test' });
  const m = await D.readZip(z);
  eq([...m.keys()], ['a/s.txt', 'a/d.json', 'b/win.txt'], 'folders out, \\ as /');
  eq([text(m, 'a/s.txt'), text(m, 'a/d.json')], ['stored text', '{"k":"deflated deflated deflated"}']);
  eq(D.crc32(enc.encode('123456789')), 0xcbf43926, 'CRC-32 check value');
  eq((await D.readZip(zip([]))).size, 0, 'an empty zip');
  eq(text(await D.readZip(z.buffer), 'a/s.txt'), 'stored text', 'an ArrayBuffer too');
});

await t('readZip refuses in words: not a zip, over 50 MB (before reading), encrypted, another method, a wrong CRC or size, cut short, more than all a pack may hold', async () => {
  await rejects(D.readZip(enc.encode('PK? not really a zip at all, just words')), /zip ではありません/);
  await rejects(D.readZip(new Uint8Array(D.MAX_BYTES + 1)), /大きすぎます.*50 MB/);
  await rejects(D.readZip(zip([['s.txt', 'x', { flags: 1 }]])), /鍵のかかった/);
  await rejects(D.readZip(zip([['s.txt', 'x', { method: 12, crc: 0 }]])), /開けない詰め方.*方式 12/);
  await rejects(D.readZip(zip([['s.txt', 'hello', { crc: 1 }]])), /目次と合いません/);
  await rejects(D.readZip(zip([['s.txt', 'hello', { size: 4 }]])), /目次と合いません/);
  const z = zip([['s.txt', 'hello world', { method: 0 }]]), cut = new Uint8Array([...z.subarray(0, 35), ...z.subarray(z.length - 68)]);
  await rejects(D.readZip(cut), /壊れて|切れて/, 'cut short');
  await rejects(D.readZip(zip([['bomb.bin', new Uint8Array(4096)]]), { budget: { left: 1000 } }), /大きすぎ/, 'a zip bomb');
  const bad = zip([['d.txt', 'deflated words'], ['e.txt', 'more']]); bad[40] ^= 0xff;
  await rejects(D.readZip(bad), /壊れています|目次と合いません/, 'broken deflate');
});

await t('openPack: an .mcaddon\'s .mcpack opened one level as "<pack>/<path>"; a pack in a pack stays a file; one that does not open stays a file', async () => {
  const deep = zip([['x.txt', 'deep']]);
  const m = await D.openPack(zip([['A.mcpack', zip([['manifest.json', '{}'], ['inner.mcpack', deep, { method: 0 }]])], ['B.mcpack', enc.encode('not a zip')], ['top.txt', 't']]));
  eq([...m.keys()], ['A.mcpack/manifest.json', 'A.mcpack/inner.mcpack', 'B.mcpack', 'top.txt']);
  eq(m.get('A.mcpack/inner.mcpack').length, deep.length, 'the pack in a pack: one file');
  eq([...(await D.openPack(packV1())).keys()], ['coins_bp/manifest.json', 'coins_bp/scripts/main.js', 'coins_bp/items/coin.json', 'coins_bp/old.txt'], 'a .mcpack alone: its own files');
  await rejects(D.openPack(zip([['A.mcpack', zip([['b.bin', new Uint8Array(3000)]])]]), { budget: { left: 3000 } }), /大きすぎ/, 'the budget counts what is inside too');
});

await t('Bedrock\'s JSON: comments, trailing commas and a BOM read; // inside a string kept; not JSON → undefined; flatJson and jsonChanges by key (pure)', () => {
  eq(D.parseJsonLoose('﻿{ // a comment\n "a": "http://x//y", /* b */ "b": [1, 2,], }'), { a: 'http://x//y', b: [1, 2] });
  eq(D.parseJsonLoose('{"q": "say \\"hi\\" // not a comment"}'), { q: 'say "hi" // not a comment' });
  eq([D.parseJsonLoose('not json'), D.parseJsonLoose('')], [undefined, undefined]);
  eq(D.flatJson({ header: { version: [1, 0] }, 'minecraft:item': { components: {} }, 'a b': 1, e: [] }), [['header.version[0]', 1], ['header.version[1]', 0], ['minecraft:item.components', {}], ['"a b"', 1], ['e', []]]);
  eq(D.jsonChanges({ a: 1, b: { c: 2 }, gone: true }, { a: 1, b: { c: 3 }, now: 'x' }), [{ key: 'b.c', a: 2, b: 3 }, { key: 'gone', a: true, b: undefined }, { key: 'now', a: undefined, b: 'x' }]);
});

await t('diff: files added, removed and changed by path, sizes, the JSON keys that changed, a JSON that only looks different, the alike counted (pure)', async () => {
  const d = await D.comparePacks(addon(packV1()), addon(packV2()));
  eq(d.added, [{ path: 'Coins_BP.mcpack/coins_bp/new.png', size: 4 }]);
  eq(d.removed, [{ path: 'Coins_BP.mcpack/coins_bp/old.txt', size: 3 }]);
  eq(d.changed.map((c) => c.path), ['Coins_BP.mcpack/coins_bp/items/coin.json', 'Coins_BP.mcpack/coins_bp/manifest.json', 'Coins_BP.mcpack/coins_bp/scripts/main.js']);
  const [coin, man, js] = d.changed;
  eq(coin.json, [], 'whitespace alone: no key changed');
  eq(man.json, [{ key: 'header.version[1]', a: 0, b: 1 }, { key: 'modules[0].version[1]', a: 0, b: 1 }, { key: 'dependencies[0].module_name', a: undefined, b: '@minecraft/server' }]);
  eq([js.sizeA, js.sizeB, js.json], [5006, 10006, undefined], 'not JSON: sizes alone');
  eq(d.same, 2, 'the RP manifest and README alike');
  ok(d.sizeB > d.sizeA, 'totals');
  const same = await D.comparePacks(addon(packV1()), addon(packV1()));
  eq([same.added.length, same.removed.length, same.changed.length], [0, 0, 0]);
  const many = (n) => zip([['m.json', JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, n])))]]);
  const lots = await D.comparePacks(many(150), many(151));
  eq([lots.changed[0].json.length, lots.changed[0].jsonMore], [D.MAX_KEYS, 51], 'the rest counted');
});

await t('a release\'s packs to choose; fetchAsset only through the api: too big refused before asking, an api that cannot fetch files says the way (a file from this device)', async () => {
  const rel = [{ tag_name: 'addon-coins-2', assets: [{ id: 2, name: 'Coins.mcaddon', size: 9 }, { id: 3, name: 'notes.txt', size: 1 }] }, { tag_name: 'addon-coins-1', assets: [{ id: 1, name: 'Coins.mcaddon', size: 8 }] }];
  eq(D.packOptions(rel).map((o) => [o.id, o.label, o.size]), [[2, 'addon-coins-2 — Coins.mcaddon', 9], [1, 'addon-coins-1 — Coins.mcaddon', 8]]);
  eq(D.packOptions(null), []);
  const asked = [], api = { assetBytes: async (slug, id) => { asked.push([slug, id]); return new Uint8Array([1, 2]).buffer; } };
  eq([...(await D.fetchAsset(api, 'o/lab', { id: 2, name: 'C.mcaddon', size: 2 }))], [1, 2]);
  await rejects(D.fetchAsset(api, 'o/lab', { id: 9, name: 'Huge.mcaddon', size: D.MAX_BYTES + 1 }), /Huge\.mcaddon は大きすぎます/);
  eq(asked, [['o/lab', 2]], 'the huge one never asked for');
  await rejects(D.fetchAsset({ call: async () => null }, 'o/lab', { id: 2, name: 'C', size: 2 }), /手元のファイル/);
});

// ---- a small DOM: enough for panel/ui/dom.mjs's h and the card (tests/connect-ui-offline.mjs's) ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, open: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
/** the api the card is given: lib/gh.mjs on a fake fetch (every request through ghrules' fakeCheck, all of them seen) and
 *  assetBytes — a release's file by id — as the request to the lead asks lib/gh.mjs to give */
function fakeApi(files) {
  const seen = [];
  const fetchImpl = async (url, o) => {
    const u = url.replace(/^https?:\/\/[^/]+/, ''), body = o.body ? JSON.parse(o.body) : null; seen.push(`${o.method} ${u}`);
    const bad = fakeCheck(o.method, u, body);
    return { ok: !bad, status: bad ? 422 : 404, headers: { get: () => null }, text: async () => JSON.stringify({ message: bad?.message ?? 'Not Found' }) };
  };
  const api = G.gh({ token: 'ghu_usertoken0123456789', base: 'https://api.github.com', fetchImpl });
  api.assetBytes = async (slug, id) => { seen.push(`GET /repos/${slug}/releases/assets/${id}`); if (!files[id]) throw new G.GhError(404, G.explain(404), `/repos/${slug}/releases/assets/${id}`); return files[id].buffer; };
  return { api, seen };
}
const RELS = [{ tag_name: 'addon-coins-3', assets: [{ id: 30, name: 'Coins.mcaddon', size: 100 }, { id: 31, name: 'Broken.mcaddon', size: 10 }] }, { tag_name: 'addon-coins-2', assets: [{ id: 20, name: 'Coins.mcaddon', size: 100 }, { id: 21, name: 'notes.md', size: 5 }] }];
const button = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];
const selects = (c) => c.all((e) => e.tagName === 'SELECT');

await t('the card: the newest pack and the release before\'s chosen (before on the left), 比べる → files added, removed, changed and the JSON keys; each file asked once through the api; nothing written', async () => {
  fakeDom(); const UI = await imp('panel/ui/packdiff.mjs');
  const { api, seen } = fakeApi({ 20: addon(packV1()), 30: addon(packV2()) });
  const el = UI.packdiffCard({ api, lab: { slug: 'o/lab' } }, { releases: RELS });
  const [a, b] = selects(el);
  eq([a.value, b.value], ['2', '0'], 'the release before / the newest');
  eq(a.all((e) => e.tagName === 'OPTION').length, 4, 'the packs alone (notes.md not offered) and the empty choice');
  const go = button(el, /比べる/);
  ok(!go.disabled, 'can be pressed');
  await go.click();
  const r = el.textContent;
  ok(/➕ 増えた 1/.test(r) && /➖ 消えた 1/.test(r) && /✏️ 変わった 3/.test(r) && /＝ 同じ 2/.test(r), r);
  ok(/coins_bp\/new\.png/.test(r) && /coins_bp\/old\.txt/.test(r), 'the files');
  const keys = el.all((e) => e.attrs['data-key']).map((e) => e.textContent);
  ok(keys.includes('header.version[1]: 0 → 1') && keys.includes('dependencies[0].module_name: （なし） → "@minecraft/server"'), keys.join(' | '));
  ok(/書き方だけの違い/.test(r), 'whitespace alone said so');
  await go.click();
  eq(seen, ['GET /repos/o/lab/releases/assets/20', 'GET /repos/o/lab/releases/assets/30'], 'each once; no write, no other call');
});

await t('a button that cannot be pressed says why where it can be read: the same pack both sides, no packs in the releases (the way: files from this device); a file from this device compared', async () => {
  fakeDom(); const UI = await imp('panel/ui/packdiff.mjs');
  const { api, seen } = fakeApi({});
  const el = UI.packdiffCard({ api, lab: { slug: 'o/lab' } }, { releases: RELS }), [a, b] = selects(el), go = button(el, /比べる/);
  a.value = '0'; await a.fire('change');
  ok(go.disabled && /同じファイル/.test(el.all((e) => 'data-why' in e.attrs)[0].textContent) && /同じファイル/.test(go.attrs.title), 'the same one');
  b.value = ''; await b.fire('change');
  ok(go.disabled && /両方を選んで/.test(el.textContent), 'one side empty');
  const empty = UI.packdiffCard({ api, lab: { slug: 'o/lab' } }, { releases: [] });
  const g2 = button(empty, /比べる/);
  ok(g2.disabled && /2 つ以上あると/.test(empty.textContent) && /手元のファイル/.test(empty.textContent), empty.textContent);
  ok(/リリースにパックがありません/.test(empty.textContent), 'the empty list says so');
  const [fa, fb] = empty.all((e) => e.tagName === 'INPUT' && e.attrs.type === 'file');
  const file = (name, u8) => ({ name, size: u8.length, lastModified: 1, arrayBuffer: async () => u8.buffer });
  fa.files = [file('old.mcaddon', addon(packV1()))]; await fa.fire('change');
  ok(g2.disabled, 'one file is not two');
  fb.files = [file('new.mcaddon', addon(packV2()))]; await fb.fire('change');
  ok(!g2.disabled, 'two files: can be pressed');
  const d = await empty.compare();
  eq([d.added.length, d.removed.length, d.changed.length], [1, 1, 3]);
  ok(/「old\.mcaddon」から「new\.mcaddon」へ/.test(empty.textContent), empty.textContent);
  const huge = file('huge.mcaddon', new Uint8Array(1)); huge.size = D.MAX_BYTES + 1;
  fb.files = [huge]; await fb.fire('change');
  ok(g2.disabled && /huge\.mcaddon は大きすぎます/.test(empty.textContent), 'too big: said before reading');
  eq(seen, [], 'nothing asked of GitHub');
});

await t('a failure is shown in place with its words (failView), the button usable again: a broken pack, GitHub not finding the file, an api that cannot fetch files; the same packs: 中身は同じ', async () => {
  fakeDom(); const UI = await imp('panel/ui/packdiff.mjs');
  const { api } = fakeApi({ 20: addon(packV1()), 31: enc.encode('not a zip at all, really not') });
  const el = UI.packdiffCard({ api, lab: { slug: 'o/lab' } }, { releases: RELS }), [a, b] = selects(el), go = button(el, /比べる/);
  b.value = '1'; await b.fire('change'); // Broken.mcaddon
  await go.click();
  const alert = () => el.all((e) => e.attrs.role === 'alert')[0];
  ok(alert() && /zip ではありません/.test(alert().textContent) && !go.disabled, el.textContent);
  b.value = '0'; await b.fire('change'); // addon-coins-3 Coins (id 30: GitHub has none)
  await go.click();
  ok(alert() && /見つからない/.test(alert().textContent), alert()?.textContent);
  const no = UI.packdiffCard({ api: { call: async () => null }, lab: { slug: 'o/lab' } }, { releases: RELS });
  // (an api that cannot read a release's file — the panel's own: GitHub sends it from another host — no release to choose; each
  // pack a link to take it from GitHub, and 比べる says to choose the two downloaded files)
  eq(selects(no).length, 0, 'no release to choose where it cannot be read');
  const takes = no.all((e) => e.tagName === 'A').map((e) => e.attrs.href);
  ok(takes.length === 3 && takes.every((u) => /^https:\/\/github\.com\//.test(u)), JSON.stringify(takes));
  const nb = button(no, /比べる/);
  ok(nb.disabled && /手元のファイル|ダウンロードした/.test(nb.attrs.title ?? ''), JSON.stringify(nb.attrs));
  await nb.click();
  ok(!no.all((e) => e.attrs.role === 'alert').length, 'nothing asked of GitHub');
  const same = fakeApi({ 20: addon(packV1()), 30: addon(packV1()) });
  const s = UI.packdiffCard({ api: same.api, lab: { slug: 'o/lab' } }, { releases: RELS });
  await button(s, /比べる/).click();
  ok(/中身は同じです/.test(s.textContent), s.textContent);
  ok(!a.disabled, 'the choices stay usable');
});

await t('the files: text is never parsed as HTML; no address but GitHub\'s; no fetch of their own (the api alone)', async () => {
  const fs = await import('node:fs');
  for (const f of ['panel/lib/packdiff.mjs', 'panel/ui/packdiff.mjs']) {
    const src = fs.readFileSync(path.join(TOP, f), 'utf8');
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(src), `${f}: no HTML`);
    ok(![...src.matchAll(/https?:\/\/[\w.-]+/g)].some((m) => !/^https:\/\/(api\.)?github\.com$/.test(m[0])), `${f}: GitHub alone`);
    ok(!/\bfetch\(/.test(src), `${f}: no fetch of its own`);
  }
  ok(!/document|window/.test(fs.readFileSync(path.join(TOP, 'panel/lib/packdiff.mjs'), 'utf8')), 'the lib: no DOM');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
