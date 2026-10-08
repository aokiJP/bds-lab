'use strict';
// bds-lab 管理パネルの service worker: the panel opens with no network (its shell is kept on the device) and a notification
// reaches a phone (a phone's browser shows one only from a worker: registration.showNotification) and opens the panel when
// tapped. A classic script — no import, no export; register it as
//   navigator.serviceWorker.register('sw.js?v=' + <config.json's version>)
// The version in the address names the cache (a new deploy is a new address: the browser installs the new worker, which keeps
// the new shell and drops the old). Without a version the files are asked of the network first, so nothing can go stale.
//   - at install: the shell is fetched afresh (index.html, panel.css, panel.js, the manifest and icon, config.json and every
//     module panel.js imports, found by reading the imports) and kept in this version's cache, all or nothing
//   - the page itself (a navigation) and config.json: the network first, the kept copy when it does not answer
//   - the rest of the panel's own files: the kept copy first, the network when it is not there (and kept then)
//   - api.github.com and every other origin: not touched at all (the page's CSP lets it talk to GitHub alone, and a token
//     never passes through here)
//   - a notification tapped: the panel's address in its data (a string, or { url }) is opened, or brought to the front
// route() is the whole decision of where a request goes, kept at the top level for tests/inbox-offline.mjs to read.

const SCOPE = new URL('./', globalThis.location.href).href;
const VERSION = (() => { const v = new URL(globalThis.location.href).searchParams.get('v') ?? ''; return /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : ''; })();
// (the cache's name has the folder in it: another panel on the same origin keeps its own)
const PREFIX = `bdslab-panel:${new URL(SCOPE).pathname}:`;
const CACHE = PREFIX + (VERSION || 'unversioned');
const INDEX = new URL('index.html', SCOPE).href;
const SHELL = ['index.html', 'panel.css', 'panel.js', 'manifest.webmanifest', 'icon.svg', 'config.json'];
const MUST = ['index.html', 'panel.css', 'panel.js'];
const MAX_FILES = 300;

/** where a request goes (pure): 'network-first' (the page and config.json), 'cache-first' (the panel's other files) or 'pass'
 *  (not ours to touch: GitHub's API, every other origin, this worker's own file). origin: this worker's; mode: the request's,
 *  when it is known — a navigation is the page, whatever its address */
function route(url, origin, mode = '') {
  let u;
  try { u = new URL(String(url), origin); } catch { return 'pass'; }
  if (u.origin !== origin || !/^https?:$/.test(u.protocol) || u.hostname === 'api.github.com') return 'pass';
  const p = u.pathname;
  if (p.endsWith('/sw.js')) return 'pass';
  if (mode === 'navigate' || p.endsWith('/') || p.endsWith('.html') || p.endsWith('/config.json')) return 'network-first';
  return 'cache-first';
}

/** the files a module names with import / export … from / import(), as addresses inside this folder (pure) */
function imports(text, base) {
  const out = [];
  for (const m of String(text).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"\s]+)\1/g)) {
    try { const u = new URL(m[2], base); if (u.href.startsWith(SCOPE)) out.push(u.href.split(/[?#]/)[0]); } catch { /* not an address */ }
  }
  return out;
}

/** the shell fetched afresh (past the browser's own cache) and written to this version's cache — nothing is written unless the
 *  files that make the page are all there; a module that is missing is no trouble (it is kept when it is first asked for) */
async function precache() {
  const got = new Map(), tried = new Set();
  let wave = SHELL.map((p) => new URL(p, SCOPE).href);
  while (wave.length && tried.size < MAX_FILES) {
    const now = [...new Set(wave)].filter((u) => !tried.has(u)).slice(0, MAX_FILES - tried.size);
    for (const u of now) tried.add(u);
    const done = await Promise.all(now.map(async (u) => { try { const r = await fetch(u, { cache: 'reload' }); return r.ok ? [u, r] : null; } catch { return null; } }));
    wave = [];
    for (const d of done) {
      if (!d) continue;
      got.set(d[0], d[1]);
      if (/\.m?js$/.test(new URL(d[0]).pathname)) wave.push(...imports(await d[1].clone().text(), d[0]));
    }
  }
  for (const p of MUST) if (!got.has(new URL(p, SCOPE).href)) throw new Error(`${p} が取れません`);
  const cache = await globalThis.caches.open(CACHE);
  for (const [u, r] of got) await cache.put(u, r);
}
const kept = async (key) => (await globalThis.caches.open(CACHE)).match(key);
const keep = async (key, res) => { try { await (await globalThis.caches.open(CACHE)).put(key, res); } catch { /* storage full or refused */ } };

/** the network first; when it does not answer (or the server is failing) the kept copy. A page is kept as index.html whatever
 *  its address — the address may carry a one-time code (GitHub's way back with the App), which is never kept. A file is asked
 *  of the server again, not of the browser's own ten-minute cache (a page cannot be: a navigation takes no options) */
async function networkFirst(event) {
  const req = event.request, key = req.mode === 'navigate' ? INDEX : req;
  try {
    const res = await fetch(req, req.mode !== 'navigate' && req.cache === 'default' ? { cache: 'no-cache' } : undefined);
    if (res.ok && res.type === 'basic') event.waitUntil(keep(key, res.clone()));
    else if (res.status >= 500) { const hit = await kept(key); if (hit) return hit; }
    return res;
  } catch (e) {
    const hit = await kept(key);
    if (hit) return hit;
    throw e;
  }
}
/** the kept copy first; the network when it is not there — the newest, past the browser's own cache: an older deploy's copy must
 *  not be kept under this version — and what it gives is kept */
async function cacheFirst(event) {
  const req = event.request, hit = await kept(req);
  if (hit) return hit;
  const res = await fetch(req, req.cache === 'default' ? { cache: 'reload' } : undefined);
  if (res.ok && res.type === 'basic') event.waitUntil(keep(req, res.clone()));
  return res;
}

globalThis.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => globalThis.skipWaiting()));
});
globalThis.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const n of await globalThis.caches.keys()) if (n.startsWith(PREFIX) && n !== CACHE) await globalThis.caches.delete(n);
    await globalThis.clients.claim();
  })());
});
globalThis.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || (req.cache === 'only-if-cached' && req.mode !== 'same-origin') || !req.url.startsWith(SCOPE)) return;
  const how = route(req.url, globalThis.location.origin, req.mode);
  if (how === 'pass') return;
  // (no version in the address: the files could be of any deploy, so they are asked of the network first)
  event.respondWith(how === 'cache-first' && VERSION ? cacheFirst(event) : networkFirst(event));
});

/** where a tapped notification goes (pure): its data's address — the data itself when it is a string, else { url } — when that is
 *  inside this folder; otherwise the panel's front page */
function target(data, scope = SCOPE) {
  const raw = typeof data === 'string' ? data : data?.url;
  if (typeof raw === 'string' && raw) { try { const u = new URL(raw, scope); if (u.href.startsWith(scope)) return u.href; } catch { /* not an address */ } }
  return scope;
}
globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = target(event.notification.data);
  event.waitUntil((async () => {
    const open = (await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true })).find((c) => c.url.startsWith(SCOPE));
    if (!open) return globalThis.clients.openWindow(url);
    // (a panel already open is brought to the front and taken to the address — its #tab)
    try { await open.focus(); } catch { /* the browser would not */ }
    if (typeof open.navigate === 'function' && open.url !== url) await open.navigate(url).catch(() => {});
    return open;
  })());
});
