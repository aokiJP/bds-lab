// units: the lab's units as GitHub has them on the default branch — bds/addons (the addons), and end/plugins and ll/mods
// when the lab has them — each with what its own files say: the pack's name, description and version (bp/manifest.json; a
// LeviLamina mod's manifest.json), TASK.md's first heading and how many sections tests.txt has. Read with the person's own
// sign-in through lib/gh.mjs (the contents API) and kept for this visit; the rest is pure. No DOM, no node:.

/** a unit's name as the lab and unit.yml take it */
export const UNIT = /^[a-z][a-z0-9_]{1,39}$/;
/** at most this many units are read (each is two or three files) */
export const UNIT_LIMIT = 30;
/** where each lab keeps its units, and the manifest the panel reads in one (end: none — a pyproject.toml) */
export const KINDS = [
  { kind: 'bds', dir: 'bds/addons', manifest: 'bp/manifest.json' },
  { kind: 'end', dir: 'end/plugins', manifest: null },
  { kind: 'll', dir: 'll/mods', manifest: 'manifest.json' },
];
export const KIND_WORDS = { bds: 'アドオン', end: 'Endstone のプラグイン', ll: 'LeviLamina の MOD' };
const DIR = Object.fromEntries(KINDS.map((k) => [k.kind, k.dir]));

/** a folder that is a unit to show (pure): not a hidden or parked one (_ zz_ .), and a name the lab takes */
export const isUnitName = (n) => !/^(_|zz_|\.)/.test(String(n ?? '')) && UNIT.test(String(n ?? ''));
// (Minecraft's § colour codes and runs of spaces out; a pack that names itself through its .lang files says nothing here)
const plain = (s) => String(s ?? '').replace(/§./g, '').replace(/\s+/g, ' ').trim();
const langKey = (s) => /^pack\.(name|description)$/i.test(s);
// (a script the editor may open: under scripts/, a .js, no way out of the pack)
const SAFE_ENTRY = /^scripts\/[A-Za-z0-9_./-]{1,120}\.js$/;

/** a manifest's text → { name, description, version, entry } (pure): a pack's (header.*, version [1, 0, 0], its script
 *  module's entry: scripts/main.js) or a LeviLamina mod's (name, description, version "0.1.0" at the top); null when it is
 *  not a JSON object */
export function parseManifest(text) {
  let j; try { j = JSON.parse(String(text ?? '').replace(/^﻿/, '')); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const head = j.header && typeof j.header === 'object' && !Array.isArray(j.header) ? j.header : j;
  const name = plain(head.name), description = plain(head.description), v = head.version;
  const version = (Array.isArray(v) ? v.join('.') : typeof v === 'string' ? v : '').replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 30);
  const script = (Array.isArray(j.modules) ? j.modules : []).find((m) => m?.type === 'script' && typeof m.entry === 'string');
  const entry = script && SAFE_ENTRY.test(script.entry) && !script.entry.split('/').includes('..') ? script.entry : null;
  return { name: langKey(name) ? '' : name.slice(0, 120), description: langKey(description) ? '' : description.slice(0, 300), version, entry };
}
/** TASK.md's first heading (pure): '' when it has none */
export function taskTitle(text) {
  const m = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(String(text ?? ''));
  return m ? plain(m[1]).slice(0, 120) : '';
}
/** how many tests tests.txt has: its `## ` sections (pure) */
export const testSections = (text) => (String(text ?? '').match(/^## /gm) ?? []).length;

/** a unit from its files' texts (null: the file is not there) → { kind, name, dir, ref (ai-make's unit: bds/<name>), title,
 *  description, version, tests (null: no tests.txt), task (TASK.md's heading), entry (the pack's script: bp/scripts/main.js;
 *  null: none known) } (pure). The title: the pack's name, else TASK.md's, else the folder's */
export function unitSummary({ kind = 'bds', name, manifest = null, task = null, tests = null }) {
  const m = manifest === null ? null : parseManifest(manifest), t = taskTitle(task);
  return {
    kind, name, dir: `${DIR[kind] ?? DIR.bds}/${name}`, ref: `${kind}/${name}`,
    title: m?.name || t || name, description: m?.description ?? '', version: m?.version ?? '',
    tests: tests === null ? null : testSections(tests), task: t, entry: kind === 'bds' && m?.entry ? `bp/${m.entry}` : null,
  };
}
/** the units that have every word typed in their name, title, description or kind (pure; any case) */
export function filterUnits(units, q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return (units ?? []).filter((u) => { const hay = [u.name, u.title, u.description, u.kind, KIND_WORDS[u.kind]].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); });
}

/** a few at a time, in order: GitHub is not sent everything at once */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const k = next++; out[k] = await fn(items[k]); } }));
  return out;
}
async function readUnits(api, slug) {
  const found = [];
  for (const k of KINDS) {
    if (found.length >= UNIT_LIMIT) break;
    // (no such folder: a lab without that kind; end/ and ll/ are extra — what they cannot say leaves them out)
    let list;
    try { list = await api.call('GET', `/repos/${slug}/contents/${k.dir}`); } catch (e) { if (e.status === 404 || k.kind !== 'bds') continue; throw e; }
    for (const x of Array.isArray(list) ? list : []) if (x?.type === 'dir' && isUnitName(x.name) && found.length < UNIT_LIMIT) found.push({ k, name: x.name });
  }
  return pool(found, 4, async ({ k, name }) => {
    const at = (f) => api.file(slug, `${k.dir}/${name}/${f}`).then((x) => x?.text ?? null, () => null);
    const [manifest, task, tests] = await Promise.all([k.manifest ? at(k.manifest) : null, at('TASK.md'), at('tests.txt')]);
    return unitSummary({ kind: k.kind, name, manifest, task, tests });
  });
}
// (per GitHub client — a new sign-in is a new client, so another account never sees what this one read — and per lab)
const CACHE = new WeakMap();
/** the lab's units (up to UNIT_LIMIT: bds first, then end, then ll) → [unitSummary], read once for this visit (fresh: again) */
export function listUnits(api, slug, { fresh = false } = {}) {
  let m = CACHE.get(api);
  if (!m) CACHE.set(api, (m = new Map()));
  if (!fresh && m.has(slug)) return m.get(slug);
  const p = readUnits(api, slug);
  m.set(slug, p);
  // (a failed read is not kept: the next look asks again)
  p.catch(() => { if (m.get(slug) === p) m.delete(slug); });
  return p;
}
/** what was read for this lab forgotten (a file was changed here: the next look reads again) */
export const forgetUnits = (api, slug) => { CACHE.get(api)?.delete(slug); };
/** is there a bds unit by this name on the default branch already → true / false */
export async function unitExists(api, slug, name) {
  try { await api.call('GET', `/repos/${slug}/contents/${DIR.bds}/${encodeURIComponent(name)}`); return true; } catch (e) { if (e.status === 404) return false; throw e; }
}
