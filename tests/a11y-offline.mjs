// a11y (見やすさ: 大きな字・はっきりした色・動きを減らす・リンクに下線) without a browser: the choice kept in a storage (broken text
// and a refusing storage are no trouble), the device's settings as defaults (matchMedia), the classes for <html>, the card on a
// small fake DOM (a click runs onclick, a disabled button is not pressed), and every colour pair of panel/a11y.css checked for
// contrast (WCAG AA 4.5:1 for text, 3:1 for borders; 7:1 for the main text).
// node tests/a11y-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const A = await imp('panel/lib/a11y.mjs'), { memoryStorage } = await imp('panel/lib/accounts.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const media = (on) => (q) => ({ matches: on.includes(q) });

await t('PREFS: four switches, each with a key, words, a class and an off default', () => {
  eq(A.PREFS.map((p) => p.key), ['big', 'contrast', 'calm', 'links']);
  for (const p of A.PREFS) ok(p.words && p.hint && p.cls === `a11y-${p.key}` && p.def === false, p.key);
  eq(A.defaults(), { big: false, contrast: false, calm: false, links: false });
});

await t('fromMedia: reduce motion → calm; more contrast or forced colours → contrast and links; none or a throwing one → all off', () => {
  eq(A.fromMedia(media(['(prefers-reduced-motion: reduce)'])), { big: false, contrast: false, calm: true, links: false });
  eq(A.fromMedia(media(['(prefers-contrast: more)'])), { big: false, contrast: true, calm: false, links: true });
  eq(A.fromMedia(media(['(forced-colors: active)'])), { big: false, contrast: true, calm: false, links: true });
  eq(A.fromMedia(undefined), A.defaults());
  eq(A.fromMedia(() => { throw new Error('old browser'); }), A.defaults());
});

await t('load / save / reset / chosen: the choice over the defaults; broken text, unknown keys and a refusing storage are no trouble', () => {
  const s = memoryStorage();
  eq(A.load(s), A.defaults()); ok(!A.chosen(s), 'nothing chosen');
  const dev = A.fromMedia(media(['(prefers-reduced-motion: reduce)']));
  eq(A.load(s, dev).calm, true, 'device default');
  ok(A.save(s, { big: true, calm: false, token: 'x', links: 'yes' }), 'saved');
  eq(JSON.parse(s.getItem(A.STORAGE_KEY)), { big: true, calm: false }, 'only known true/false kept');
  eq(A.load(s, dev), { big: true, contrast: false, calm: false, links: false }, 'the choice wins over the device');
  ok(A.chosen(s), 'chosen');
  s.setItem(A.STORAGE_KEY, '{oops'); eq(A.load(s, dev), dev, 'broken → the base'); ok(!A.chosen(s), 'broken = not chosen');
  s.setItem(A.STORAGE_KEY, '[true]'); eq(A.load(s), A.defaults(), 'not an object');
  ok(A.reset(s) && s.getItem(A.STORAGE_KEY) === null, 'reset');
  const refuse = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  eq(A.load(refuse, dev), dev); ok(!A.save(refuse, { big: true }), 'save says false'); ok(!A.reset(refuse), 'reset says false'); ok(!A.chosen(refuse), 'not chosen');
  eq(A.load(null), A.defaults());
});

await t('classes: the classes for <html> in order; nothing for nothing', () => {
  eq(A.classes({ links: true, big: true, calm: false }), ['a11y-big', 'a11y-links']);
  eq(A.classes(A.defaults()), []); eq(A.classes(null), []); eq(A.classes({ big: 'yes' }), [], 'only true');
  eq([...A.ALL_CLASSES], ['a11y-big', 'a11y-contrast', 'a11y-calm', 'a11y-links']);
});

// ---- contrast: every colour pair in panel/a11y.css ----
const hex = (s) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim()); if (!m) throw new Error(`not a colour: ${s}`); const x = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
const lum = (c) => { const [r, g, b] = hex(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

await t('ratio: the WCAG formula (black on white 21:1, same colour 1:1, a known pair)', () => {
  ok(Math.abs(ratio('#000', '#fff') - 21) < 1e-9, 'black/white'); ok(Math.abs(ratio('#777777', '#777777') - 1) < 1e-9, 'same');
  ok(Math.abs(ratio('#767676', '#ffffff') - 4.54) < 0.01, `#767676 on white ${ratio('#767676', '#ffffff')}`);
});

const css = fs.readFileSync(path.join(TOP, 'panel/a11y.css'), 'utf8');
const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/html\.a11y-contrast\s*\{([^}]*)\}/g)].map((m) => Object.fromEntries([...m[1].matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)].map((v) => [v[1], v[2].trim()]))).filter((b) => Object.keys(b).length);
const rootVars = [...fs.readFileSync(path.join(TOP, 'panel/panel.css'), 'utf8').matchAll(/:root\s*\{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/--([a-z-]+)\s*:/g)].map((v) => v[1]));

await t('a11y.css: a light and a dark set of colours, each laying a value over every colour variable of panel.css', () => {
  eq(blocks.length, 2, 'light and dark');
  ok(rootVars.length >= 10, `panel.css variables read: ${rootVars}`);
  for (const [i, b] of blocks.entries()) for (const v of rootVars) ok(b[v], `${i ? 'dark' : 'light'}: --${v} not set`);
  ok(/html\.a11y-contrast button\.primary[^{]*\{[^}]*var\(--on-accent\)/.test(css), 'the primary button text uses --on-accent');
  ok(/#toast div\.bad\s*\{[^}]*var\(--on-bad\)/.test(css), 'the bad toast uses --on-bad');
});

// [text, background, at least]
const PAIRS = [
  ['fg', 'bg', 7], ['fg', 'card', 7], ['fg', 'chip', 7], ['bg', 'fg', 7],
  ['muted', 'bg', 7], ['muted', 'card', 7], ['muted', 'chip', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'card', 4.5], ['accent', 'chip', 4.5],
  ['ok', 'bg', 4.5], ['ok', 'card', 4.5], ['warn', 'bg', 4.5], ['warn', 'card', 4.5], ['bad', 'bg', 4.5], ['bad', 'card', 4.5], ['bad', 'chip', 4.5],
  ['on-accent', 'accent', 4.5], ['on-bad', 'bad', 4.5],
  ['line', 'bg', 3], ['line', 'card', 3],
];
await t('a11y.css: every pair of text and background reads (AA 4.5:1 or more; the main text 7:1; borders 3:1), light and dark', () => {
  const low = [];
  for (const [i, b] of blocks.entries()) for (const [f, g, min] of PAIRS) { const r = ratio(b[f], b[g]); if (!(r >= min)) low.push(`${i ? 'dark' : 'light'} --${f} on --${g}: ${r.toFixed(2)} < ${min}`); }
  eq(low, [], 'too low');
  const worst = Math.min(...blocks.flatMap((b) => PAIRS.filter((p) => p[2] >= 4.5).map(([f, g]) => ratio(b[f], b[g]))));
  console.log(`     (the lowest text pair: ${worst.toFixed(2)}:1)`);
});

await t('a11y.css: each switch has its rules (big: 1.25 times; calm: animation and transition off; links: underline)', () => {
  ok(/html\.a11y-big body\s*\{\s*font-size:\s*18\.75px/.test(css), 'big 1.25 × 15px');
  ok(/html\.a11y-calm[^{]*\{[^}]*animation:\s*none !important;[^}]*transition:\s*none !important/.test(css), 'calm');
  ok(/html\.a11y-links a[^{]*\{[^}]*text-decoration:\s*underline/.test(css), 'links');
  ok(!/url\(|@import|https?:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'nothing fetched from elsewhere');
});

// ---- the card on a small DOM ----
function fakeDom() {
  class Nd { get textContent() { return ''; } }
  class T extends Nd { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends Nd {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { if (x === null || x === undefined || Array.isArray(x)) throw new Error('append(bad)'); const n = x instanceof Nd ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    // (as a browser: a click runs the click listeners — h()'s onclick — unless the button is disabled)
    click() { if (this.disabled) return; for (const fn of this.on.click ?? []) fn({ target: this }); }
    fire(type) { for (const fn of this.on[type] ?? []) fn({ target: this }); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const set = new Set(['keep-me']);
  const html = { classList: { toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return on; }, contains: (c) => set.has(c) } };
  const toast = new E('div');
  globalThis.Node = Nd;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), documentElement: html };
  return { toast, set };
}

await t('apply: the chosen classes on <html>, the others taken off, other classes left alone (fake DOM)', async () => {
  const { set } = fakeDom();
  const UI = await imp('panel/ui/a11y.mjs');
  eq(UI.apply(globalThis.document, { big: true, links: true }), ['a11y-big', 'a11y-links']);
  ok(set.has('a11y-big') && set.has('a11y-links') && set.has('keep-me'), [...set].join(' '));
  UI.apply(globalThis.document, { contrast: true });
  eq([...set].sort(), ['a11y-contrast', 'keep-me']);
  eq(UI.apply({}, { big: true }), ['a11y-big'], 'no <html>: nothing breaks');
});

await t('the card: four switches, 「今すぐ見る」 pressable only after a change (the reason shown), applies and keeps it; back to the device (fake DOM)', async () => {
  const { toast, set } = fakeDom();
  const UI = await imp('panel/ui/a11y.mjs');
  const storage = memoryStorage();
  const card = UI.a11yCard({ storage, document: globalThis.document, matchMedia: media(['(prefers-reduced-motion: reduce)']) });
  const boxes = () => card.all((e) => e.attrs['data-a11y-key'] !== undefined);
  const btn = (w) => card.all((e) => e.attrs['data-a11y-do'] === w)[0];
  eq(boxes().map((b) => b.attrs['data-a11y-key']), ['big', 'contrast', 'calm', 'links']);
  ok(/動きを減らす/.test(card.textContent) && /大きな字/.test(card.textContent), 'the words');
  eq(boxes().map((b) => b.checked), [false, false, true, false], 'the device decides first');
  ok(btn('show').disabled, 'nothing changed: cannot show'); ok(/チェックを変えると押せます/.test(card.textContent), 'the reason is shown');
  ok(btn('reset').disabled, 'nothing chosen: cannot go back'); ok(/端末.*設定に合わせています/.test(card.textContent), 'said');
  btn('show').click(); btn('reset').click();
  eq(storage.getItem('bdslab.panel.a11y'), null, 'a disabled button is not pressed'); ok(!set.has('a11y-calm'), 'nothing applied');

  const big = boxes()[0]; big.checked = true; big.fire('change');
  ok(!btn('show').disabled, 'a change: pressable'); ok(!/チェックを変えると押せます/.test(card.textContent), 'the reason gone');
  eq(set.has('a11y-big'), false, 'not yet: only after 「今すぐ見る」');
  btn('show').click();
  ok(set.has('a11y-big') && set.has('a11y-calm'), `applied: ${[...set]}`);
  eq(JSON.parse(storage.getItem('bdslab.panel.a11y')), { big: true, contrast: false, calm: true, links: false }, 'kept');
  ok(/見え方を変えました/.test(toast.textContent), 'told');
  ok(btn('show').disabled && !btn('reset').disabled, 'shown: nothing more to show; now it can go back');

  // a second card (the page opened again) reads the choice back
  const again = UI.a11yCard({ storage, document: globalThis.document, matchMedia: media([]) });
  eq(again.all((e) => e.attrs['data-a11y-key'] !== undefined).map((b) => b.checked), [true, false, true, false], 'kept over a reload');

  btn('reset').click();
  eq(storage.getItem('bdslab.panel.a11y'), null, 'forgotten'); ok(!set.has('a11y-big') && set.has('a11y-calm'), `back to the device: ${[...set]}`);
  eq(boxes().map((b) => b.checked), [false, false, true, false], 'redrawn'); ok(btn('reset').disabled, 'nothing chosen again');
});

await t('the card: a storage that refuses still shows it for the page, and says why with the next step (fake DOM)', async () => {
  const { set } = fakeDom();
  const UI = await imp('panel/ui/a11y.mjs');
  const refuse = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); }, removeItem() {} };
  const card = UI.a11yCard({ storage: refuse, document: globalThis.document, matchMedia: undefined });
  const links = card.all((e) => e.attrs['data-a11y-key'] === 'links')[0]; links.checked = true; links.fire('change');
  card.all((e) => e.attrs['data-a11y-do'] === 'show')[0].click();
  ok(set.has('a11y-links'), 'applied for the page');
  const bad = card.all((e) => e.attrs.role === 'alert')[0];
  ok(bad && /残せませんでした/.test(bad.textContent) && /もう一度/.test(bad.textContent), card.textContent);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
