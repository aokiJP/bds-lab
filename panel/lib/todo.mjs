// todo: the lab's issues as a board of three columns — やる (todo), やっている (doing), できた (done: closed) — and the GitHub
// writes that move a card from one column to another (pure: no DOM, no network). The labels are `todo` and `doing`; an open
// issue with neither is a thing still to do. Pull requests are not cards (GitHub lists them among the issues).

export const LABEL_TODO = 'todo', LABEL_DOING = 'doing';
/** the labels the board needs, made when the repository has none (lib/gh.mjs createLabel: one there already is left alone) */
export const LABELS = Object.freeze([
  { name: LABEL_TODO, color: 'fbca04', description: 'やること（ToDo ボード）' },
  { name: LABEL_DOING, color: '0e8a16', description: 'やっているところ（ToDo ボード）' },
]);
/** the columns, in order, with their words */
export const COLUMNS = Object.freeze([{ id: 'todo', label: 'やる' }, { id: 'doing', label: 'やっている' }, { id: 'done', label: 'できた' }]);

const names = (i) => (Array.isArray(i?.labels) ? i.labels : []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
/** the column one issue is in: closed → done; open with doing → doing; else todo */
export const columnOf = (i) => (i?.state === 'closed' ? 'done' : names(i).includes(LABEL_DOING) ? 'doing' : 'todo');

/** GitHub's issues (open and closed; pull requests left out) → { todo, doing, done }, each the newest-updated first */
export function columns(issues) {
  const out = { todo: [], doing: [], done: [] };
  for (const i of Array.isArray(issues) ? issues : []) {
    if (!i || i.pull_request || !Number.isInteger(i.number)) continue;
    out[columnOf(i)].push(i);
  }
  const t = (i) => Date.parse(i.updated_at ?? '') || 0;
  for (const k of Object.keys(out)) out[k].sort((a, b) => t(b) - t(a) || b.number - a.number);
  return out;
}

/** the writes that move an issue to a column → [{ method, path (after /repos/<owner>/<repo>), body? }], [] when it is there
 *  already. Labels are only taken off when the issue has them (GitHub answers 404 for one that is not there) */
export function moveOps(issue, to) {
  if (!COLUMNS.some((c) => c.id === to) || !Number.isInteger(issue?.number)) return [];
  if (columnOf(issue) === to) return [];
  const n = issue.number, have = names(issue), ops = [];
  const add = (l) => { if (!have.includes(l)) ops.push({ method: 'POST', path: `/issues/${n}/labels`, body: { labels: [l] } }); };
  const drop = (l) => { if (have.includes(l)) ops.push({ method: 'DELETE', path: `/issues/${n}/labels/${encodeURIComponent(l)}` }); };
  if (to === 'done') { drop(LABEL_TODO); drop(LABEL_DOING); ops.push({ method: 'PATCH', path: `/issues/${n}`, body: { state: 'closed' } }); return ops; }
  if (issue.state === 'closed') ops.push({ method: 'PATCH', path: `/issues/${n}`, body: { state: 'open' } });
  if (to === 'doing') { add(LABEL_DOING); drop(LABEL_TODO); } else { add(LABEL_TODO); drop(LABEL_DOING); }
  return ops;
}
