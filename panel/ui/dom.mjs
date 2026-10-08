// dom: the panel's few DOM helpers, shared by panel.js and the screens in panel/ui/ (text is always text: never parsed as
// HTML; no inline style attribute — the page's CSP allows none — styles go through the CSSOM).
export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = Boolean(v);
    // (styles through the CSSOM: the page's CSP allows no inline style attribute)
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};
export const $ = (id) => document.getElementById(id);
export const main = () => $('main');
export const toast = (text, bad = false) => { const d = h('div', { class: bad ? 'bad' : '' }, text); $('toast').append(d); setTimeout(() => d.remove(), bad ? 9000 : 4500); };
export const act = async (fn, done) => { try { const r = await fn(); if (done) toast(done); return r; } catch (e) { toast(e.message ?? String(e), true); return undefined; } };
// (an address from GitHub's answers: only https:// ones become links, anything else stays words)
export const link = (href, text) => (/^https:\/\//.test(String(href ?? '')) ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text) : h('span', {}, text));
