// runissue: an Issue made from a failed Actions run — its summary, the failed jobs and steps, the annotations and the link to
// the run, as the Issue's text. One Issue per run: the text carries <!-- bds-lab-run:<id> -->, and the Issues with the label
// bds-lab-run are read (not the search, which is rate-limited harder) to find it before a new one is made. Pure functions: no DOM;
// GitHub only through `api` (lib/gh.mjs).
export const LABEL = 'bds-lab-run';
export const marker = (id) => `<!-- bds-lab-run:${id} -->`;
const SECRET = /(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g; // (the same shape as lib/drafts.mjs looksSecret)
/** a text with anything secret-looking hidden (pure) */
export const hide = (text) => String(text ?? '').replace(SECRET, '(伏せました)');
const one = (text, n) => { const s = hide(text).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const bad = (c) => ['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required'].includes(c);
const WORD = { failure: '失敗', timed_out: '時間切れ', cancelled: '取り消し', startup_failure: '始められませんでした', action_required: '確認待ち' };

/** the Issue for a failed run (pure) → { title, body, labels }. run: a workflow run; jobs: its jobs; annotations: { [jobId]: [..] } or a flat list */
export function issueBody(run, jobs = [], annotations = []) {
  const r = run ?? {}, id = r.id ?? '';
  const name = one(r.display_title || r.name || `実行 ${id}`, 80);
  const failed = (Array.isArray(jobs) ? jobs : []).filter((j) => bad(j?.conclusion));
  const notes = (Array.isArray(annotations) ? annotations : Object.values(annotations ?? {}).flat()).filter((a) => a && (a.message || a.title));
  const lines = [marker(id), '', `## まとめ`, `「${one(r.name || name, 80)}」が${WORD[r.conclusion] ?? '失敗'}しました（実行 #${r.run_number ?? id}、枝 ${one(r.head_branch, 60) || '?'}、commit ${String(r.head_sha ?? '').slice(0, 7) || '?'}）。`, ''];
  lines.push('## 失敗したジョブ');
  if (!failed.length) lines.push('- 失敗したジョブは見つかりませんでした（実行のページで確かめてください）。');
  for (const j of failed) {
    const steps = (j.steps ?? []).filter((s) => bad(s?.conclusion)).map((s) => one(s.name, 80));
    lines.push(`- ${one(j.name, 80)}（${WORD[j.conclusion] ?? j.conclusion}）${steps.length ? `: 失敗した step ${steps.join('・')}` : ''}${j.html_url ? ` ${j.html_url}` : ''}`);
  }
  lines.push('', '## 注釈');
  if (!notes.length) lines.push('- 注釈はありません。');
  for (const a of notes.slice(0, 20)) lines.push(`- ${a.annotation_level ?? 'notice'}: ${one(a.title ? `${a.title} ${a.message ?? ''}` : a.message, 300)}${a.path ? `（${one(a.path, 80)}${a.start_line ? `:${a.start_line}` : ''}）` : ''}`);
  if (notes.length > 20) lines.push(`- ほか ${notes.length - 20} 件`);
  lines.push('', '## 実行へのリンク', r.html_url ?? '(リンクなし)', '', '_パネルの「失敗から Issue」で作りました。_');
  return { title: `🐛 落ちた実行: ${name}`.slice(0, 120), body: lines.join('\n').slice(0, 60000), labels: [LABEL] };
}

/** the Issue already made for this run, or null: the Issues with the label are read (up to 3 pages), not searched → { number, html_url, state } | null */
export async function findIssue(api, slug, runId, { pages = 3 } = {}) {
  if (!slug || !runId) throw new Error('リポジトリと実行の番号が要ります');
  const key = marker(runId);
  for (let page = 1; page <= pages; page++) {
    const a = await api.call('GET', `/repos/${slug}/issues?state=all&labels=${LABEL}&per_page=100&page=${page}`);
    const list = Array.isArray(a) ? a : [];
    const hit = list.find((i) => !i.pull_request && String(i.body ?? '').includes(key));
    if (hit) return { number: hit.number, html_url: hit.html_url, state: hit.state };
    if (list.length < 100) break;
  }
  return null;
}

/** the Issue for a run → { issue: { number, html_url }, existed } : the one already there, else a new one. Only a failed run
 *  gets one. Annotations are read for the failed jobs (up to 5; a job whose annotations cannot be read just has none). */
export async function openOrCreate(api, slug, run) {
  if (!run?.id) throw new Error('実行が選ばれていません');
  if (!bad(run.conclusion)) throw new Error('この実行は落ちていないので、Issue は作りません');
  const had = await findIssue(api, slug, run.id);
  if (had) return { issue: had, existed: true };
  const jobs = await api.jobs(slug, run.id);
  const notes = [];
  for (const j of jobs.filter((x) => bad(x.conclusion)).slice(0, 5)) { try { const a = await api.annotations(slug, j.id); if (Array.isArray(a)) notes.push(...a); } catch { /* none for this job */ } }
  const made = await api.call('POST', `/repos/${slug}/issues`, issueBody(run, jobs, notes));
  return { issue: { number: made.number, html_url: made.html_url, state: 'open' }, existed: false };
}
