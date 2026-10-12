// packdiff (🔍 版の比較): two versions of an addon chosen — two packs from the lab's releases, or two files from this device
// (one downloaded from a release's link) — and what differs between them shown: files added, removed and changed, their
// sizes, and for a JSON file the keys whose values changed (lib/packdiff.mjs). Nothing is written to GitHub; nothing leaves
// this browser.
import { h, failView } from './dom.mjs';
import * as D from '../lib/packdiff.mjs';
import { fmtBytes } from '../lib/model.mjs';

// (a value as a short line: JSON, cut at 80 letters; a side without the key says so)
const show = (x) => { if (x === undefined) return '（なし）'; const s = JSON.stringify(x); return s.length > 80 ? `${s.slice(0, 79)}…` : s; };
const delta = (a, b) => (b === a ? '同じ大きさ' : `${b > a ? '+' : '−'}${fmtBytes(Math.abs(b - a))}`);

/** the result drawn (pure of the network): the totals, then the files added, removed and changed */
export function diffView(d, { nameA = '前', nameB = '後' } = {}) {
  const chips = [`➕ 増えた ${d.added.length}`, `➖ 消えた ${d.removed.length}`, `✏️ 変わった ${d.changed.length}`, `＝ 同じ ${d.same}`, `大きさ ${fmtBytes(d.sizeA)} → ${fmtBytes(d.sizeB)}`].map((x) => h('span', { class: 'chip' }, x));
  if (!d.added.length && !d.removed.length && !d.changed.length) return h('div', { 'data-packdiff': 'result' }, h('div', { class: 'row' }, chips), h('p', {}, `✅ 中身は同じです（${nameA} と ${nameB}）。`));
  const list = (title, kind, xs, line) => (xs.length ? h('details', { open: xs.length <= 30, 'data-kind': kind }, h('summary', {}, `${title}（${xs.length}）`), h('ul', { class: 'plain' }, xs.map(line))) : null);
  return h('div', { 'data-packdiff': 'result' },
    h('p', { class: 'muted' }, `「${nameA}」から「${nameB}」へ`), h('div', { class: 'row' }, chips),
    list('➕ 増えたファイル', 'added', d.added, (x) => h('li', { 'data-path': x.path }, x.path, h('span', { class: 'muted' }, ` ${fmtBytes(x.size)}`))),
    list('➖ 消えたファイル', 'removed', d.removed, (x) => h('li', { 'data-path': x.path }, x.path, h('span', { class: 'muted' }, ` ${fmtBytes(x.size)}`))),
    list('✏️ 変わったファイル', 'changed', d.changed, (x) => h('li', { 'data-path': x.path }, x.path, h('span', { class: 'muted' }, ` ${fmtBytes(x.sizeA)} → ${fmtBytes(x.sizeB)}（${delta(x.sizeA, x.sizeB)}）`),
      x.json ? (x.json.length ? h('ul', {}, x.json.map((j) => h('li', { 'data-key': j.key }, h('code', {}, j.key), `: ${show(j.a)} → ${show(j.b)}`)), x.jsonMore ? h('li', { class: 'muted' }, `ほか ${x.jsonMore} か所`) : null)
        : h('div', { class: 'muted' }, '（値は同じです: 空白や並びなど、書き方だけの違い）')) : null)));
}

/** the 🔍 card. ctx: { api (lib/gh.mjs; api.assetBytes(slug, id) → the file's bytes), lab: { slug } }; releases: the lab's
 *  releases (lib/releases.mjs listReleases) → the card's element */
export function packdiffCard(ctx, { releases = [] } = {}) {
  const opts = D.packOptions(releases), slug = ctx?.lab?.slug ?? '', cache = new Map();
  const out = h('div', { role: 'status' }), why = h('p', { class: 'muted', 'data-why': '' });
  // (one side: a pack from a release, or a file from this device — a file chosen wins)
  const side = (label, pick) => {
    const sel = h('select', { 'aria-label': `${label}の版` }, h('option', { value: '' }, opts.length ? '— リリースから選ぶ —' : '（リリースにパックがありません）'),
      opts.map((o, i) => h('option', { value: String(i) }, `${o.label}（${fmtBytes(o.size)}）`)));
    if (pick >= 0 && pick < opts.length) sel.value = String(pick);
    const file = h('input', { type: 'file', accept: '.mcaddon,.mcpack,.zip', 'aria-label': `${label}の手元のファイル` });
    const s = { sel, file, label,
      chosen: () => { const f = file.files?.[0]; if (f) return { file: f, name: f.name, size: f.size, key: `file:${f.name}:${f.size}:${f.lastModified ?? ''}` }; const o = opts[Number(sel.value)]; return sel.value !== '' && o ? { asset: o, name: o.label, size: o.size, key: `asset:${o.id}` } : null; },
      el: h('div', { class: 'grow' }, h('label', {}, label), sel, h('div', { class: 'muted' }, 'または 手元のファイル: ', file)) };
    sel.addEventListener('change', () => paint()); file.addEventListener('change', () => paint());
    return s;
  };
  // (at the start: the newest pack on the right, and on the left the first pack of an earlier release — else the next pack)
  const before = opts.findIndex((o) => o.tag !== opts[0]?.tag), A = side('前', before > 0 ? before : opts.length >= 2 ? 1 : -1), B = side('後', opts.length >= 1 ? 0 : -1);
  const go = h('button', { class: 'primary', onclick: () => run() }, '🔍 比べる');
  /** why 比べる cannot be pressed now (words), null when it can */
  const blocked = () => {
    const a = A.chosen(), b = B.chosen();
    if (!a || !b) return opts.length < 2 && !(a || b) ? 'リリースのパック（.mcaddon・.mcpack）が 2 つ以上あると、ここで選べます。今は「手元のファイル」で 2 つ選んでください。' : '「前」と「後」の両方を選んでください。';
    if (a.key === b.key) return '同じファイルが選ばれています: 違う版を選んでください。';
    const big = [a, b].find((x) => x.size > D.MAX_BYTES);
    if (big) return `${big.name} は大きすぎます（50 MB まで）。`;
    return null;
  };
  function paint() { const w = blocked(); go.disabled = Boolean(w); if (w) go.setAttribute('title', w); else go.removeAttribute?.('title'); why.replaceChildren(w ?? ''); }
  const bytesOf = async (c) => {
    if (cache.has(c.key)) return cache.get(c.key);
    const b = c.file ? new Uint8Array(await c.file.arrayBuffer()) : await D.fetchAsset(ctx.api, slug, c.asset);
    cache.set(c.key, b);
    return b;
  };
  async function run() {
    if (blocked()) return paint();
    const a = A.chosen(), b = B.chosen();
    go.disabled = true; out.replaceChildren(h('p', { class: 'muted' }, '読んで比べています…'));
    try {
      const d = await D.comparePacks(await bytesOf(a), await bytesOf(b));
      out.replaceChildren(diffView(d, { nameA: a.name, nameB: b.name }));
      return d;
    } catch (e) {
      out.replaceChildren(failView(e, () => run()));
      return undefined;
    } finally { paint(); }
  }
  paint();
  const el = h('div', { class: 'card', id: 'packdiff' }, h('h2', {}, '🔍 版の比較'),
    h('p', { class: 'muted' }, '2 つの版の .mcaddon を開いて、増えた・消えた・変わったファイルと、JSON の値の違いを見せます。比べるのはこのブラウザの中だけで、GitHub には何も書きません。'),
    h('div', { class: 'row' }, A.el, B.el), h('div', { class: 'row' }, go), why, out);
  el.compare = run;
  return el;
}
