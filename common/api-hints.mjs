// A type error about a Minecraft name answered from the declaration files, under the error, so the AI does not look it up:
// beta-only (it is in this BDS's beta module: mode beta), on another class (that class and its signature), else the closest
// members of that class with their signatures, or the closest exported names.
import { decls, MEMBER, members, baseOf } from './dts.mjs';

const dist = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)); return m[a.length][b.length]; };
const sigOf = (l) => l.trim().replace(/;\s*(\/\/.*)?$/, '').replace(/\s+/g, ' ').slice(0, 150);
function allMembers(map, cls) { const res = []; for (let n = cls, seen = new Set(); n && map.has(n) && !seen.has(n); n = baseOf(map, n)) { seen.add(n); for (const l of members(map.get(n))) { const k = MEMBER.exec(l)?.[1]; if (k) res.push([k, l, n]); } } return res; }
const near = (want, list) => list.map((x) => [dist(want, x[0]) - (x[0].toLowerCase().includes(want.toLowerCase()) || want.toLowerCase().includes(x[0].toLowerCase()) ? 2 : 0), x]).filter(([d]) => d <= Math.max(2, want.length / 3)).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
/** texts: the current d.ts texts; beta: the beta d.ts texts (or null). Returns hints per error line: Map(err → hint) */
export function apiHints(errs, texts, beta = null) {
  const cur = decls(texts.map((text) => ({ text }))), bet = beta ? decls(beta.map((text) => ({ text }))) : null, res = new Map();
  for (const e of errs) {
    const p = /Property '(\w+)' does not exist on type '(?:typeof )?(\w+)'/.exec(e), x = /has no exported member (?:named )?'(\w+)'/.exec(e);
    if (p && cur.has(p[2])) {
      const [member, cls] = [p[1], p[2]];
      if (bet && allMembers(bet, cls).some(([k]) => k === member)) { res.set(e, `fix: ${cls}.${member} is beta-only (${sigOf(allMembers(bet, cls).find(([k]) => k === member)[1])}): node lab.mjs mode beta, or do without it`); continue; }
      const elsewhere = [...cur.keys()].filter((n) => n !== cls && members(cur.get(n)).some((l) => MEMBER.exec(l)?.[1] === member)).slice(0, 3);
      if (elsewhere.length) { const l = members(cur.get(elsewhere[0])).find((y) => MEMBER.exec(y)?.[1] === member); res.set(e, `fix: ${member} is on ${elsewhere.join(', ')}, not ${cls}: ${elsewhere[0]}.${sigOf(l)}`); continue; }
      const close = near(member, allMembers(cur, cls)).slice(0, 2);
      if (close.length) res.set(e, `fix: ${cls} has ${close.map(([, l, n]) => `${n === cls ? '' : n + ': '}${sigOf(l)}`).join(' | ')}`);
      else if (bet && !bet.has(cls)) res.set(e, `fix: ${cls} has no ${member}: node lab.mjs api ${cls}`);
    } else if (x) {
      const name = x[1];
      if (bet?.has(name) && !cur.has(name)) { res.set(e, `fix: ${name} is beta-only: node lab.mjs mode beta, or do without it`); continue; }
      const close = near(name, [...cur.keys()].map((n) => [n, cur.get(n).split('\n')[0], n])).slice(0, 3);
      if (close.length) res.set(e, `fix: exported names like it: ${close.map(([n]) => n).join(', ')}`);
    }
  }
  return res;
}

// the usual Script API runtime errors and what fixes them (test prints the matching one under its E lines; why says it as the next step)
export const RUNTIME_HINTS = [
  [/cannot read property '[^']+' of (undefined|null)|is (undefined|null)\b/i, 'a value is undefined there (an empty slot, a missing component, a player who left, a find() with no match): check it before use'],
  [/does not have required privileges|restricted[- ]execution/i, 'a world change inside a before-event (read-only there): do it in system.run(() => ...)'],
  [/early[- ]execution|cannot be (called|used) during early/i, 'world.* before the world loaded: move it into kit ready(() => ...) or world.afterEvents.worldLoad'],
  [/InvalidEntityError|Entity is (not valid|invalid)|entity .* removed/i, 'the entity is gone (died, left, unloaded): check entity.isValid before using it, and after every await'],
  [/LocationInUnloadedChunkError|unloaded chunk/i, 'that place is not loaded: tp a player near it first, or dimension.isChunkLoaded / a tickingarea'],
  [/LocationOutOfWorldBoundariesError|out of (the )?world bound/i, 'y is outside the world (flat world: -64..319): clamp the location'],
  [/\bnot a function|not a constructor|has no (property|member)/i, 'an API this Minecraft does not have (renamed or beta only): node lab.mjs api <Class> / apidiff; wrap an optional part in kit feature()'],
  [/Watchdog|slow[- ]running script|script (hang|timeout)/i, 'a loop took too long in one tick: spread the work with system.runJob or every(ticks, ...)'],
  [/ArgumentOutOfBoundsError|out of bounds|must be (between|within)/i, 'a number outside what the API accepts (count 1..64 per stack, slot index, volume...): clamp it'],
  [/Failed to resolve identity/i, "that player/entity has no score in any objective yet: getScore throws until one is set (measured on BDS 1.26.52.3; hasParticipant is false): use addScore(p, n), or o.hasParticipant(p) ? o.getScore(p) : 0"],
  [/is not in this BDS; it has/i, 'module versions: node lab.mjs mode beta (or mode stable) sets the ones this BDS has'],
];
