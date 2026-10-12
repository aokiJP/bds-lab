// relnotes: a draft of a release's notes for the people who play — from the previous release's tag to now, the commits (and the
// merged pull requests among them) sorted into 「新しい・直した・そのほか」 by their titles (Japanese or English), and, for one
// unit, only the commits that touched its folder (bds/addons/<name>/). Read with the person's own sign-in through lib/gh.mjs;
// the rest is pure. No DOM, no node:.
import { TAG_PREFIX } from './releases.mjs';

const NEW_RE = /^(?:feat|feature|add|new)\b|追加|新(?:しい|規|機能)|できるように|対応|導入|実装|増や/i;
const FIX_RE = /^(?:fix|bug|bugfix|hotfix|patch)\b|\b(?:fix(?:es|ed)?|bug|repair(?:ed)?|resolve[sd]?|correct(?:ed)?)\b|直(?:し|す|る)|修正|不具合|バグ|誤り|なおし/i;
const NOISE_RE = /^(?:merge (?:branch|remote-tracking)|revert "?merge)/i;

/** a commit's message → { title, pr } : the title a player reads (a merged pull request's own title, not 「Merge pull request」;
 *  a conventional 「feat(x):」 lead cut), and the pull request number if it was one (pure) */
export function titleOf(message) {
  const lines = String(message ?? '').split('\n').map((s) => s.trim());
  const first = lines[0] ?? '';
  const m = /^Merge pull request #(\d+)\b/i.exec(first);
  if (m) return { title: lines.slice(1).find(Boolean) ?? '', pr: Number(m[1]) };
  const sq = /\(#(\d+)\)\s*$/.exec(first);
  return { title: first.replace(/\s*\(#\d+\)\s*$/, ''), pr: sq ? Number(sq[1]) : null };
}
/** a title → 'new' | 'fixed' | 'other' (pure). Fixes win over news when a title says both ("add a fix" is a fix) */
export function classify(title) {
  const t = String(title ?? '').trim();
  if (FIX_RE.test(t)) return 'fixed';
  if (NEW_RE.test(t)) return 'new';
  return 'other';
}
// (the words without the programmer's lead: "feat(shop): x" → "x")
const plain = (t) => String(t ?? '').replace(/^\w+(?:\([^)]*\))?!?:\s*/, '').trim();

/** commits (GitHub's commit objects) → { new, fixed, other }: each a list of { title, pr, sha } in the order given, a title
 *  once only, merge-of-branch commits and empty titles left out (pure) */
export function sortCommits(commits) {
  const out = { new: [], fixed: [], other: [] }, seen = new Set();
  for (const c of commits ?? []) {
    const msg = c?.commit?.message ?? c?.message ?? '';
    if (NOISE_RE.test(String(msg).trim())) continue;
    const { title, pr } = titleOf(msg), words = plain(title);
    if (!words || seen.has(words.toLowerCase())) continue;
    seen.add(words.toLowerCase());
    out[classify(title)].push({ title: words, pr, sha: String(c?.sha ?? '').slice(0, 7) });
  }
  return out;
}
/** does this commit's file list touch the unit's folder (pure). files: GitHub's [{ filename }] */
export const touches = (files, unit) => {
  const dir = unitDir(unit);
  return Boolean(dir) && (files ?? []).some((f) => String(f?.filename ?? '').startsWith(dir) || String(f?.previous_filename ?? '').startsWith(dir));
};
/** a unit's folder in the repository: bds/addons/<name>/ (end/ll units: their own folders) (pure) */
export function unitDir(unit) {
  if (!unit?.name || !/^[\w.-]+$/.test(unit.name)) return '';
  const k = unit.kind ?? 'bds';
  return k === 'bds' ? `bds/addons/${unit.name}/` : k === 'end' ? `end/plugins/${unit.name}/` : `ll/mods/${unit.name}/`;
}
/** the lab's tag of a unit's release, as it would be written: addon-<name> (pure) */
export const tagOf = (unit) => `${TAG_PREFIX[unit?.kind ?? 'bds'] ?? 'addon'}-${unit?.name}`;

/** the draft as words for players (pure). draft: sortCommits' answer; { title, from: the previous tag or null } */
export function toMarkdown(draft, { title = '', from = null } = {}) {
  const sec = (head, xs) => (xs.length ? [`### ${head}`, ...xs.map((x) => `- ${x.title}${x.pr ? ` (#${x.pr})` : ''}`), ''] : []);
  const body = [...sec('新しくなったこと', draft.new), ...sec('直したこと', draft.fixed), ...sec('そのほか', draft.other)];
  const lead = from ? `${from} からの変わったところです。` : '最初の版です。';
  if (!body.length) return `${title ? `## ${title}\n\n` : ''}${lead}\n\n（遊ぶ人に伝える変更はまだありません）\n`;
  return `${title ? `## ${title}\n\n` : ''}${lead}\n\n${body.join('\n')}`.replace(/\n+$/, '\n');
}

/** the unit's previous release tag, from the lab's releases (drafts aside), or null: the first version.
 *  The newest one with the unit's own tag (addon-<name>…) — api: lib/gh.mjs */
export async function previousTag(api, slug, unit) {
  const rs = (await api.call('GET', `/repos/${slug}/releases?per_page=30`)) ?? [], want = tagOf(unit).toLowerCase();
  // (the tag itself, or with a version after it: addon-coins-v2, addon-coins.3 — never addon-coins-plus, another unit's)
  const own = (tag) => { const t = String(tag ?? '').toLowerCase(); return t === want || (t.startsWith(want) && /^[-._]?v?\d/.test(t.slice(want.length))); };
  const mine = rs.filter((r) => r && !r.draft && own(r.tag_name));
  mine.sort((a, b) => (Date.parse(b.published_at ?? b.created_at ?? '') || 0) - (Date.parse(a.published_at ?? a.created_at ?? '') || 0));
  return mine[0]?.tag_name ?? null;
}
const LIMIT = 60;
/** the commits from `fromTag` to `head` (the whole compare, newest last as GitHub gives it), and with a unit only the ones that
 *  touched its folder (each commit asked for its files: at most 60). No tag: the unit's own newest commits (or the repository's).
 *  → { commits, from, truncated } */
export async function commitsSince(api, slug, { unit = null, fromTag = null, head = 'HEAD' } = {}) {
  let list, truncated = false;
  if (fromTag) {
    const r = await api.call('GET', `/repos/${slug}/compare/${encodeURIComponent(fromTag)}...${encodeURIComponent(head)}`);
    list = r?.commits ?? [];
    truncated = list.length >= 250;
  } else {
    const dir = unitDir(unit);
    list = ((await api.call('GET', `/repos/${slug}/commits?per_page=${LIMIT}${dir ? `&path=${encodeURIComponent(dir.replace(/\/$/, ''))}` : ''}`)) ?? []).slice().reverse();
    return { commits: list, from: null, truncated: list.length >= LIMIT };
  }
  if (unit?.name) {
    const keep = [], recent = list.slice(-LIMIT);
    truncated = truncated || list.length > LIMIT;
    for (const c of recent) {
      // (a merge commit's files are the merge's own: a pull request's commits are looked at one by one, the merge itself skipped)
      if (/^Merge /i.test(c?.commit?.message ?? '') && !/^Merge pull request/i.test(c.commit.message)) continue;
      const d = await api.call('GET', `/repos/${slug}/commits/${encodeURIComponent(c.sha)}`);
      if (touches(d?.files, unit)) keep.push(c);
    }
    list = keep;
  }
  return { commits: list, from: fromTag, truncated };
}
/** the whole draft: previous tag (given or found) → commits → words. → { from, draft, markdown, count, truncated } */
export async function draftNotes(api, slug, { unit = null, fromTag, head = 'HEAD', title = '' } = {}) {
  const from = fromTag === undefined ? (unit ? await previousTag(api, slug, unit) : null) : fromTag;
  const { commits, truncated } = await commitsSince(api, slug, { unit, fromTag: from, head });
  const draft = sortCommits(commits);
  return { from, draft, markdown: toMarkdown(draft, { title, from }), count: draft.new.length + draft.fixed.length + draft.other.length, truncated };
}
