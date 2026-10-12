// qr (a card for any screen): a link as a QR code a phone's camera reads — a release's .mcaddon, an invite — drawn as SVG in
// the page (lib/qr.mjs: nothing fetched, no library), its words under it, the link to open and a button to copy it. A text
// too long for a QR code, or none, is told in words with what to do instead. No style attribute (the page's CSP): the
// squares are one SVG path, sized by attributes.
import { h, toast, link, failView } from './dom.mjs';
import * as Q from '../lib/qr.mjs';

// (SVG's namespace, put together: the panel's files hold no address but GitHub's — tests/panel-offline.mjs — and this one is
// a name, never fetched)
const SVG_NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
/** light modules around the code (the standard asks for 4) */
const QUIET = 4;
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };

/** the dark modules as one path's d: a run of dark modules in a row is one rectangle (pure) */
export function pathOf(modules, quiet = QUIET) {
  const out = [];
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let w = 1; while (row[x + w]) w++;
      out.push(`M${x + quiet} ${y + quiet}h${w}v1h-${w}z`);
      x += w - 1;
    }
  });
  return out.join('');
}

/** the QR code of `text` as an <svg> element (black on white, the quiet zone in it); throws (in words) when it cannot be one */
export function qrSvg(text, { px = 200, label = 'QR コード' } = {}) {
  const { size, modules } = Q.encode(text), n = size + 2 * QUIET;
  const e = svg('svg', { viewBox: `0 0 ${n} ${n}`, width: px, height: px, role: 'img', 'aria-label': label, 'shape-rendering': 'crispEdges', class: 'qr' });
  const title = svg('title'); title.append(document.createTextNode(label));
  e.append(title, svg('rect', { width: n, height: n, fill: '#ffffff' }), svg('path', { d: pathOf(modules), fill: '#000000' }));
  return e;
}

// (text to the clipboard; where the browser will not, shown to copy by hand)
const copy = (text) => (globalThis.navigator?.clipboard?.writeText
  ? globalThis.navigator.clipboard.writeText(text).then(() => toast('リンクを写しました'), () => globalThis.prompt?.('自動で写せませんでした。この文字を選んで、手で写してください', text))
  : globalThis.prompt?.('自動で写せませんでした。この文字を選んで、手で写してください', text));

/** a card: the QR code of `text`, `label` over it (e.g. 「Coins v1.2 をスマホで受け取る」), the link and 「リンクを写す」.
 *  qrCard(ctx, text, label) like the other cards, or qrCard(text, label) (ctx is not needed: nothing is read or written).
 *  An empty or too long text → the words and the way on (the link and its copy button stay, so it can still be handed over) */
export function qrCard(ctx, text, label) {
  if (typeof ctx === 'string' || ctx === null || ctx === undefined) [ctx, text, label] = [{}, ctx, text];
  const s = String(text ?? '').trim(), title = label ? String(label) : 'スマホのカメラで読むと受け取れます';
  if (!s) return h('div', { class: 'card qr-card' }, h('b', {}, title), h('p', { class: 'muted' }, 'まだ QR にするリンクがありません。リリースを作ると、ここにその .mcaddon のリンクの QR が出ます。'));
  let pic;
  try { pic = qrSvg(s, { label: `${title}（QR コード）` }); } catch (e) { pic = failView(e); }
  return h('div', { class: 'card qr-card' },
    h('b', {}, title),
    h('div', { class: 'qr-pic' }, pic),
    h('p', { class: 'muted' }, 'スマホのカメラを向けて、出てきたリンクを開きます。'),
    h('div', { class: 'row' }, /^https:\/\//.test(s) ? link(s, s) : h('code', {}, s), h('button', { type: 'button', onclick: () => copy(s) }, '📋 リンクを写す')));
}
