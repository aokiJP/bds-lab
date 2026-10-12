// revert: a unit's file taken back to an earlier version — the file's history (one entry per commit), the text it had at a
// version, how a version differs from now (lines added and removed), and the earlier text written over the file as a NEW
// commit (nothing is erased: the history only grows). Pure functions: no DOM; GitHub only through `api` (lib/gh.mjs).
const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');
const b64 = (text) => { const b = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const need = (v, what) => { if (!v || typeof v !== 'string') throw new Error(`${what}が空です`); };
export const shortSha = (sha) => String(sha ?? '').slice(0, 7);
/** the commit message restore() writes (pure) */
export const restoreMessage = (path, sha) => `${path} を ${shortSha(sha)} の版に戻す`;

/** the commits that changed a file, the newest first → [{ sha, date, author, message }] (message: its first line). ref: the
 *  branch to look along (none: the default branch) */
export async function history(api, slug, path, ref, { per = 30 } = {}) {
  need(slug, 'リポジトリ'); need(path, 'ファイルの場所');
  const a = await api.call('GET', `/repos/${slug}/commits?per_page=${per}&path=${encodeURIComponent(path)}${ref ? `&sha=${encodeURIComponent(ref)}` : ''}`);
  return (Array.isArray(a) ? a : []).map((c) => ({
    sha: String(c.sha ?? ''), date: c.commit?.author?.date ?? c.commit?.committer?.date ?? '',
    author: c.author?.login ?? c.commit?.author?.name ?? '', message: String(c.commit?.message ?? '').split('\n')[0],
  }));
}

/** the file's text at a commit; null when the file was not there then */
export async function contentAt(api, slug, path, sha) {
  need(sha, 'commit');
  return (await api.file(slug, path, sha))?.text ?? null;
}

/** how `to` differs from `from`, in lines (pure) → { added, removed }: lines only in `to`, lines only in `from` (a changed
 *  line counts once on each side; order is not looked at) */
export function lineDiff(from, to) {
  const lines = (t) => (t === null || t === undefined || t === '' ? [] : String(t).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
  const count = new Map();
  for (const l of lines(from)) count.set(l, (count.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of lines(to)) { const n = count.get(l) ?? 0; if (n > 0) count.set(l, n - 1); else added++; }
  let removed = 0; for (const n of count.values()) removed += n;
  return { added, removed };
}

/** the file written back to its text at `sha`, as a new commit on `branch` (none: the default branch). The current sha is read
 *  just before, so a change made elsewhere in between is refused by GitHub, never written over. The same text as now → nothing
 *  is written → { changed: false } */
export async function restore(api, slug, path, sha, branch) {
  need(slug, 'リポジトリ'); need(path, 'ファイルの場所'); need(sha, 'commit');
  const old = await contentAt(api, slug, path, sha);
  if (old === null) throw new Error(`${shortSha(sha)} の版にはこのファイルがありません（戻せません）`);
  const now = await api.file(slug, path, branch || undefined);
  if (now && now.text === old) return { changed: false, sha: now.sha };
  const r = await api.call('PUT', `/repos/${slug}/contents/${enc(path)}`, { message: restoreMessage(path, sha), content: b64(old), ...(now?.sha ? { sha: now.sha } : {}), ...(branch ? { branch } : {}) });
  return { changed: true, sha: r?.commit?.sha ?? null, ...lineDiff(now?.text ?? '', old) };
}
