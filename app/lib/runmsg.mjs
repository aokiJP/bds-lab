// runmsg: a finished workflow run told in a few lines for the person's Discord (notify.yml → app notify), pure.
// What it says: the result, which workflow and branch, who started it, how long; the failed jobs and the first of their
// annotations; links to the run and to the management panel. When to say it (LAB_NOTIFY, a repository variable):
// auto (the default: every failure, and a success only of a run a person started by hand) · all · failures · off.
const ICON = { success: '✅', failure: '❌', cancelled: '⏹️', timed_out: '⌛', action_required: '✋', startup_failure: '💥', neutral: '➖', skipped: '⏭️' };
const WORD = { success: '通りました', failure: '落ちました', cancelled: '止められました', timed_out: '時間切れ', action_required: '人の確認を待っています', startup_failure: '始められませんでした', neutral: '終わりました', skipped: '飛ばされました' };
/** should this run be told (pure) */
export function shouldNotify(run, policy = 'auto') {
  const p = String(policy || 'auto').toLowerCase(), c = run?.conclusion;
  if (p === 'off' || !run || run.status !== 'completed' || c === 'skipped') return false;
  if (p === 'all') return true;
  const bad = !['success', 'neutral'].includes(c);
  if (p === 'failures') return bad;
  return bad || run.event === 'workflow_dispatch';
}
const mins = (run) => { const ms = Date.parse(run.updated_at) - Date.parse(run.run_started_at ?? run.created_at); return Number.isFinite(ms) ? (ms < 60_000 ? `${Math.round(ms / 1000)} 秒` : `${Math.round(ms / 60_000)} 分`) : '?'; };
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** the panel's address for a repository (pure): LAB_PANEL_URL, else its GitHub Pages */
export const panelUrl = (repo, env = {}) => env.LAB_PANEL_URL || (repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/` : null);
/** the panel's address that opens this run (pure): its 進み具合 tab, the run's repository and number in the hash (the panel
 *  switches to the account that has that repository) — none when the address already carries a hash */
export const panelRunUrl = (panel, repo, id) => (panel && !panel.includes('#') && repo && id ? `${panel}#runs?${new URLSearchParams({ repo, run: String(id) })}` : panel);
const size = (n) => `${(n / 1e6).toFixed(n < 1e6 ? 2 : 1)} MB`;
/** { run, jobs, annotations: { [jobName]: [..] }, panel, files } → { content, buttons: [{ label, url }] } (content within
 *  Discord's 2000). files (lib/runfiles.mjs): { attach, tooBig, artifacts } — what goes along, what was too large, a link */
export function runMessage({ run, jobs = [], annotations = {}, panel = null, files = null }) {
  const c = run.conclusion ?? run.status;
  const lines = [`${ICON[c] ?? '•'} **${clip(run.name, 60)}** ${WORD[c] ?? c}（${clip(run.head_branch, 40)}・${run.triggering_actor?.login ?? run.actor?.login ?? '?'}・${mins(run)}）`];
  if (run.display_title && run.display_title !== run.name) lines.push(clip(run.display_title, 120));
  for (const j of jobs.filter((x) => ['failure', 'timed_out', 'cancelled'].includes(x.conclusion)).slice(0, 4)) {
    const step = (j.steps ?? []).find((s) => s.conclusion === 'failure');
    lines.push(`・${clip(j.name, 60)}${step ? `: ${clip(step.name, 60)}` : ''}`);
    for (const a of (annotations[j.name] ?? []).filter((x) => x.annotation_level === 'failure').slice(0, 2)) lines.push(`  ${clip(`${a.title ? `${a.title}: ` : ''}${a.message}`, 200)}`);
  }
  if (files?.attach?.length) lines.push(`📦 ${files.attach.map((f) => `${clip(f.name, 60)}（${size(f.size)}）`).join('・')}`);
  if (files?.tooBig?.length) lines.push(`📦 添えられません（Discord の上限）: ${files.tooBig.map((f) => `${clip(f.name, 60)}（${size(f.size)}）`).join('・')} — 「成果物」から`);
  const content = lines.join('\n').slice(0, 1900), live = (files?.artifacts ?? []).filter((a) => !a.expired);
  return { content, ok: ['success', 'neutral'].includes(c), buttons: [{ label: 'GitHub で見る', url: run.html_url }, ...(live.length ? [{ label: `成果物（${live.length}）`, url: `${run.html_url}#artifacts` }] : []), ...(panel ? [{ label: '管理パネル', url: panel }] : [])].filter((b) => /^https:\/\//.test(b.url ?? '')) };
}
