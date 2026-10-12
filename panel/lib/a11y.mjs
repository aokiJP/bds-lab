// a11y: how the panel is shown to this person — 大きな字・はっきりした色・動きを減らす・リンクに下線 — kept in this browser
// (localStorage), not in the lab: it is about the eyes in front of this screen, not about the lab. Each one is a class on <html>
// (html.a11y-big …) that panel/a11y.css reads. Before anything is chosen, the device's own settings decide (prefers-reduced-motion,
// prefers-contrast, forced-colors). Pure: no DOM, no fetch — the storage and matchMedia are given.
//
//   bdslab.panel.a11y = { "big": true, "calm": false }   (only what was chosen; the rest follows the device)

export const STORAGE_KEY = 'bdslab.panel.a11y';
export const PREFS = Object.freeze([
  { key: 'big', cls: 'a11y-big', words: '大きな字', hint: '字を 1.25 倍に、ボタンを大きくします', def: false },
  { key: 'contrast', cls: 'a11y-contrast', words: 'はっきりした色', hint: '字と背景の色の差を大きくします（読みやすい色の組）', def: false },
  { key: 'calm', cls: 'a11y-calm', words: '動きを減らす', hint: '画面の動き（アニメーション）を止めます', def: false },
  { key: 'links', cls: 'a11y-links', words: 'リンクに下線', hint: '押せる文字（リンク）に下線を引きます', def: false },
]);
const KEYS = PREFS.map((p) => p.key);

/** every switch at its plain default (all off) */
export const defaults = () => Object.fromEntries(PREFS.map((p) => [p.key, p.def]));

/** the device's settings as the defaults: reduce motion → calm; more contrast or forced colours → contrast and links.
 *  matchMedia missing or throwing (an old browser, a test): the plain defaults */
export function fromMedia(matchMedia) {
  const d = defaults();
  if (typeof matchMedia !== 'function') return d;
  const q = (s) => { try { return Boolean(matchMedia(s)?.matches); } catch { return false; } };
  if (q('(prefers-reduced-motion: reduce)')) d.calm = true;
  if (q('(prefers-contrast: more)') || q('(forced-colors: active)')) { d.contrast = true; d.links = true; }
  return d;
}

/** only the known keys with true/false values (anything else in the stored text is dropped) */
const clean = (o) => { const out = {}; if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of KEYS) if (typeof o[k] === 'boolean') out[k] = o[k]; return out; };

/** what was chosen here, laid over `base` (the defaults, or fromMedia(...)); a missing, broken or refusing storage = base */
export function load(storage, base = defaults()) {
  let saved = {};
  try { saved = clean(JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null')); } catch { /* broken or refused: the base */ }
  return { ...defaults(), ...clean(base), ...saved };
}

/** was anything chosen here at all (else the device's settings decide) */
export function chosen(storage) {
  try { return Object.keys(clean(JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null'))).length > 0; } catch { return false; }
}

/** keep the choice in this browser → true; false when the storage is full or refuses (the choice still holds for this page).
 *  base (fromMedia(...)): only what differs from it is kept, so the rest goes on following the device (a reduce-motion
 *  turned on later still gives calm); no base: every known switch given is kept */
export function save(storage, prefs, base) {
  let keep = clean(prefs);
  if (base !== undefined) { const b = { ...defaults(), ...clean(base) }; keep = Object.fromEntries(Object.entries(keep).filter(([k, v]) => v !== b[k])); }
  try { storage.setItem(STORAGE_KEY, JSON.stringify(keep)); return true; } catch { return false; }
}

/** forget the choice (back to the device's settings) → true when gone */
export function reset(storage) {
  try { storage.removeItem(STORAGE_KEY); return true; } catch { return false; }
}

/** the classes for <html>, in PREFS's order: ['a11y-big', 'a11y-calm'] */
export const classes = (prefs) => PREFS.filter((p) => prefs?.[p.key] === true).map((p) => p.cls);

/** every class this module may put on <html> (to take off the ones no longer on) */
export const ALL_CLASSES = Object.freeze(PREFS.map((p) => p.cls));
