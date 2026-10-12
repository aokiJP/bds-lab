// mobilenav: スマホの下のメニュー — on a narrow screen the panel's tabs do not fit in one row, so the ones used most sit in a
// bar fixed at the bottom (4 tabs + 「その他」 that opens the rest). Which 4: 「概要」 always first (home), then the tabs opened
// lately (at most RECENT_SLOTS of them, so the bar changes little), then the role's usual ones, then the tabs in their order;
// shown in the tabs' own order, so a tab keeps its place. Pure: no DOM, no fetch — the storage is given.
//
//   bdslab.panel.recentTabs = ["stats", "runs", "secrets"]   (the tabs opened here, newest first; only names, nothing secret)

export const STORAGE_KEY = 'bdslab.panel.recentTabs';
/** buttons in the bar: the tabs and 「その他」 */
export const SLOTS = 5;
/** how many places the lately opened tabs may take from the usual ones */
export const RECENT_SLOTS = 2;
/** how many opened tabs are remembered */
export const KEEP = 8;
export const HOME = 'overview';
export const MORE = Object.freeze({ key: 'more', label: 'その他' });
/** the usual tabs: one who works in the lab (write and up) / one who only looks or lends */
export const USUAL = Object.freeze({ lab: Object.freeze(['overview', 'runs', 'units', 'releases']), look: Object.freeze(['overview', 'hosts', 'settings', 'audit']) });
const LAB_ROLES = ['admin', 'maintain', 'write'];

/** a role as GitHub's word ('write') or the panel's role object ({ name } / { names }) → which usual list */
export const usualFor = (role) => {
  const names = typeof role === 'string' ? [role] : [role?.name, ...(Array.isArray(role?.names) ? role.names : [])].filter(Boolean);
  return names.some((n) => LAB_ROLES.includes(n)) ? USUAL.lab : USUAL.look;
};

/** tabs as the panel keeps them ([['overview', '概要'], …]) or as { key, label } → [{ key, label }] (no key, or twice: dropped) */
export function norm(tabs) {
  const out = [], seen = new Set();
  for (const t of Array.isArray(tabs) ? tabs : []) {
    const key = Array.isArray(t) ? t[0] : t?.key, label = Array.isArray(t) ? t[1] : t?.label;
    if (typeof key !== 'string' || !key || seen.has(key) || key === MORE.key) continue;
    seen.add(key); out.push({ key, label: typeof label === 'string' && label ? label : key });
  }
  return out;
}

/** pick(tabs, { role, recent }) → { main: up to SLOTS buttons (the last is MORE when some tabs are left), more: the rest }.
 *  recent: tab names, newest first (loadRecent). Tabs not in `tabs` (not shown to this role) are never picked */
export function pick(tabs, { role = null, recent = [] } = {}) {
  const all = norm(tabs);
  if (all.length <= SLOTS) return { main: all, more: [] };
  const have = new Set(all.map((t) => t.key)), usual = usualFor(role), room = SLOTS - 1, chosen = [];
  const add = (k) => { if (chosen.length < room && have.has(k) && !chosen.includes(k)) chosen.push(k); };
  add(HOME);
  let lately = 0;
  for (const k of Array.isArray(recent) ? recent : []) {
    if (lately >= RECENT_SLOTS) break;
    if (typeof k !== 'string' || !have.has(k) || chosen.includes(k) || usual.includes(k)) continue;
    add(k); lately++;
  }
  for (const k of usual) add(k);
  for (const t of all) add(t.key);
  return { main: [...all.filter((t) => chosen.includes(t.key)), MORE], more: all.filter((t) => !chosen.includes(t.key)) };
}

/** the tabs opened here, newest first; a missing, broken or refusing storage = none */
export function loadRecent(storage) {
  let v = null;
  try { v = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null'); } catch { return []; }
  return Array.isArray(v) ? [...new Set(v.filter((k) => typeof k === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(k)))].slice(0, KEEP) : [];
}

/** a tab opened → the new list (newest first, at most KEEP); kept in the storage when it can (a refusing one: the list still) */
export function remember(storage, tab) {
  const list = loadRecent(storage);
  if (typeof tab !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(tab)) return list;
  const next = [tab, ...list.filter((k) => k !== tab)].slice(0, KEEP);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* full or refused: only this page knows */ }
  return next;
}
