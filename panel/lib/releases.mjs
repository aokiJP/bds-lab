// releases: what the lab has given out — its GitHub Releases (the newest 30), the packs in them a player opens in
// Minecraft (.mcaddon .mcpack .mcworld .mctemplate), each unit's newest one, and the downloads so far. Read with the person's
// own sign-in through lib/gh.mjs; the rest is pure. No DOM, no node:.

export const PACK_TYPES = ['.mcaddon', '.mcpack', '.mcworld', '.mctemplate'];
/** the lab's own release of a unit (`ship`: common/github.mjs, common/ci.mjs): <prefix>-<name> */
export const TAG_PREFIX = { bds: 'addon', end: 'plugin', ll: 'mod' };

/** the lab's releases as GitHub lists them (the newest 30; drafts too for whoever may write) */
export const listReleases = async (api, slug) => (await api.call('GET', `/repos/${slug}/releases?per_page=30`)) ?? [];
/** a file a player opens in Minecraft (pure) */
export const isPack = (name) => PACK_TYPES.some((x) => String(name ?? '').toLowerCase().endsWith(x));
/** a release's packs (pure) */
export const packAssets = (release) => (release?.assets ?? []).filter((a) => isPack(a?.name));
// (when a release came out: published, else made — a draft has no published_at)
const when = (r) => Date.parse(r?.published_at ?? r?.created_at ?? '') || 0;
/** the releases newest first (pure; the list given stays as it was) */
export const newestFirst = (releases) => [...(releases ?? [])].sort((a, b) => when(b) - when(a));

const words = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** is `needle` in `hay` (pure): any case, as whole words in a row — - _ . and spaces between words alike, so "coins" is in
 *  "addon-coins", "coins-latest.mcaddon" and "coins-v1.2.mcaddon", "Daily Bonus" in "Daily.Bonus.mcaddon", and "shop" is
 *  not in "shopkeeper". Never glued by _ to more at either end — a unit's name holds _: "coins" is not in "coins_plus" nor
 *  in "my_coins" */
export function holds(hay, needle) {
  const n = words(needle);
  if (!n.length) return false;
  // (each word letters and digits alone: nothing in it that a regular expression reads as more)
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${n.join('[^\\p{L}\\p{N}]+')}(?![\\p{L}\\p{N}_])`, 'u').test(String(hay ?? '').toLowerCase());
}
/** each unit's newest release (drafts aside: no player can take one) → { [unit.ref]: { release, asset } } (pure). A release is a
 *  unit's when its tag or a file in it has the unit's name or title in it (holds; a title of fewer than 3 letters is not
 *  looked for); the lab's own tag for the unit (addon-<name>) comes first, and one under another unit's own tag — addon-
 *  plugin- mod- and the name of another unit given — is never this one's. asset: the unit's .mcaddon in it, else its first
 *  pack (null: none — the release's page is the way) */
export function latestByUnit(releases, units) {
  const rs = newestFirst(releases).filter((r) => r && !r.draft), us = (units ?? []).filter((u) => u?.name), out = {};
  const tagsOf = (u) => Object.values(TAG_PREFIX).map((p) => `${p}-${u.name}`.toLowerCase());
  for (const u of us) {
    const kind = u.kind ?? 'bds', ref = u.ref ?? `${kind}/${u.name}`;
    const keys = [u.name, words(u.title).join('').length >= 3 ? u.title : null].filter(Boolean);
    const own = `${TAG_PREFIX[kind] ?? TAG_PREFIX.bds}-${u.name}`.toLowerCase();
    const theirs = new Set(us.filter((o) => o !== u).flatMap(tagsOf));
    theirs.delete(own);
    const has = (r) => !theirs.has(String(r.tag_name ?? '').toLowerCase()) && keys.some((k) => holds(r.tag_name, k) || (r.assets ?? []).some((a) => holds(a?.name, k)));
    const r = rs.find((x) => String(x.tag_name ?? '').toLowerCase() === own) ?? rs.find(has);
    if (!r) continue;
    const packs = packAssets(r), mine = packs.filter((a) => keys.some((k) => holds(a.name, k)));
    const pick = (xs) => xs.find((a) => a.name.toLowerCase().endsWith('.mcaddon')) ?? xs[0] ?? null;
    out[ref] = { release: r, asset: pick(mine) ?? pick(packs) };
  }
  return out;
}
/** how much is out (pure): releases, files, packs among them, downloads, bytes */
export function totals(releases) {
  const rs = releases ?? [], as = rs.flatMap((r) => r?.assets ?? []);
  return { releases: rs.length, assets: as.length, packs: as.filter((a) => isPack(a?.name)).length,
    downloads: as.reduce((n, a) => n + (Number(a?.download_count) || 0), 0), bytes: as.reduce((n, a) => n + (Number(a?.size) || 0), 0) };
}
/** the words notify.yml sends to Discord for a release: "<title>: <its page>" (pure). The title never starts with - (notify
 *  would take it for an option); an address that is not https:// is left out */
export function notifyMessage(release) {
  const title = String(release?.name || release?.tag_name || '').replace(/\s+/g, ' ').replace(/^[\s-]+/, '').slice(0, 100) || 'リリース';
  const url = /^https:\/\//.test(String(release?.html_url ?? '')) ? release.html_url : '';
  return url ? `${title}: ${url}` : title;
}
