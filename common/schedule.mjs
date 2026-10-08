// node lab.mjs schedule <ci|list|check>: workflows the lab starts by itself at set times — .github/bds-lab-schedule.json, made
// in the management panel's 「予約」 (its checks and times are panel/lib/schedule.mjs, imported: the panel and this agree).
//   ci [--dry]   in the lab's own Actions, every hour (schedule.yml): each job on and due this hour is started through GitHub's
//                REST (POST /repos/{repo}/actions/workflows/{file}/dispatches) on the default branch, with the run's own token —
//                GITHUB_REPOSITORY, GITHUB_TOKEN (permissions: actions: write), GITHUB_API_URL, GITHUB_REF_NAME (the branch
//                when the repository's own default cannot be read). What started and what was skipped is printed; the token
//                never. A file that does not check out starts nothing (exit 1); a start GitHub refused is exit 1 too.
//                --dry: says what it would start, starts nothing (no token needed)
//   list         each job: when, its next three times, on or paused
//   check        the file checked (exit 1 when it is not right)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../panel/lib/schedule.mjs';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
// (text from the file or from GitHub on one line of the log: no control characters — a line of its own could be read by
// Actions as a workflow command — and never the token)
const clean = (s, n = 300) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n);
const scrub = (s, token) => (token && token.length >= 4 ? String(s).split(token).join('***') : String(s));

/** the schedule in the checkout → { found, jobs, errors } (errors: why it starts nothing) */
export function readSchedule(file = path.join(TOP, S.SCHEDULE_FILE)) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { found: false, jobs: [], errors: [] };
    return { found: true, jobs: [], errors: [`${S.SCHEDULE_FILE} を読めません（${e.code ?? e.message}）`] };
  }
  let j;
  try { j = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { return { found: true, jobs: [], errors: [`${S.SCHEDULE_FILE} が JSON ではありません（${e.message}）`] }; }
  return { found: true, ...S.checkSchedule(j) };
}

/** one call to GitHub's REST with the run's token → { ok, status, json, message } (a network failure: status 0) */
async function rest(fetchImpl, { api, token }, method, p, body) {
  try {
    const r = await fetchImpl(`${api}${p}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'bds-lab',
      ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    const text = await r.text().catch(() => '');
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { ok: r.ok, status: r.status, json, message: String(json?.message ?? text).slice(0, 200) };
  } catch (e) { return { ok: false, status: 0, json: null, message: e.cause?.code ?? e.name ?? 'network' }; }
}
/** why GitHub did not start a workflow, in words */
function refused(r, wf) {
  if (r.status === 0) return `GitHub につながりません（${r.message}）`;
  if (r.status === 401) return 'トークンが受け付けられません（HTTP 401）';
  if (r.status === 403) return `権限がありません（schedule.yml の permissions に actions: write）: ${r.message}`;
  if (r.status === 404) return `${wf} が見つかりません（.github/workflows にあるか・名前を確かめる）`;
  if (r.status === 422) return `GitHub が受け付けません: ${r.message}（workflow_dispatch があるか・入力の名前と値）`;
  return `HTTP ${r.status} ${r.message}`;
}

/** node lab.mjs schedule ci|list|check. opts (tests): out, env, file, now, fetchImpl → false when something is wrong (exit 1) */
export async function scheduleCmd(args = [], { out = console.log, env = process.env, file = path.join(TOP, S.SCHEDULE_FILE), now = new Date(), fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const a = [...args], sub = a.shift(), token = String(env.GITHUB_TOKEN ?? ''), at = new Date(now);
  const say = (s) => out(clean(scrub(s, token), 2000));
  const what = (j) => `${j.id} — ${j.workflow}・${S.describe(j)}`;
  const next = (j) => S.nextRuns(j, at, 3).map((d) => S.fmtWhen(d, j.timezone)).join('・');
  const none = () => say(`予約はありません（${S.SCHEDULE_FILE} がありません: 管理パネルの「予約」で作ります）`);
  if (sub === 'check') {
    const r = readSchedule(file);
    if (!r.found) { say(`✔ ${S.SCHEDULE_FILE} はありません（予約なし）`); return true; }
    for (const x of r.errors) say(`✘ ${x}`);
    if (!r.errors.length) say(`✔ ${S.SCHEDULE_FILE}: 予約 ${r.jobs.length} 件（動かす ${r.jobs.filter((j) => j.enabled).length} 件）、正しい形です`);
    return !r.errors.length;
  }
  if (sub === 'list') {
    const r = readSchedule(file);
    if (!r.found) { none(); return true; }
    for (const x of r.errors) say(`ERR schedule: ${x}`);
    if (r.errors.length) say(`ERR schedule: ${S.SCHEDULE_FILE} が正しくないので、直すまでどれも始まりません`);
    say(`予約 ${r.jobs.length} 件（${S.SCHEDULE_FILE}）`);
    for (const j of r.jobs) {
      const inputs = Object.entries(j.inputs).map(([k, v]) => `${k}=${clean(v, 40)}`).join(' ');
      say(`${j.enabled ? '▶' : '⏸'} ${j.id}  ${j.workflow}  ${S.describe(j)}  ${j.enabled ? `次 ${next(j)}` : '止めています'}${inputs ? `  入力 ${inputs}` : ''}${j.note ? `  — ${clean(j.note, 80)}` : ''}`);
    }
    return !r.errors.length;
  }
  if (sub === 'ci') {
    const dry = a.includes('--dry'), r = readSchedule(file);
    if (!r.found) { none(); return true; }
    if (r.errors.length) {
      for (const x of r.errors) say(`ERR schedule: ${x}`);
      say(`ERR schedule: ${S.SCHEDULE_FILE} が正しくないので、何も始めません（管理パネルの「予約」か GitHub で直す: node lab.mjs schedule check）`);
      return false;
    }
    const repo = String(env.GITHUB_REPOSITORY ?? ''), api = String(env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''), gh = { api, token };
    if (!dry && (!SLUG.test(repo) || !token)) { say('ERR schedule ci: GITHUB_REPOSITORY と GITHUB_TOKEN が要ります（Actions の中で動きます: schedule.yml。手元で見るなら list か ci --dry）'); return false; }
    const due = r.jobs.filter((j) => j.enabled && S.due(j, at));
    // (the default branch: the repository's own, else the branch this run is on — a scheduled run's is the default)
    let ref = null;
    if (due.length && !dry) {
      const rr = await rest(fetchImpl, gh, 'GET', `/repos/${repo}`);
      ref = rr.ok && typeof rr.json?.default_branch === 'string' ? rr.json.default_branch : env.GITHUB_REF_NAME || null;
      if (!rr.ok) say(`W schedule: ${repo} の既定の枝を読めません（${rr.status ? `HTTP ${rr.status} ${rr.message}` : rr.message}）: ${ref ? `${ref}（GITHUB_REF_NAME）で始めます` : 'GITHUB_REF_NAME もありません'}`);
    }
    const n = { started: 0, skipped: 0, paused: 0, failed: 0 };
    for (const j of r.jobs) {
      if (!j.enabled) { n.paused++; say(`⏸ 止めています: ${what(j)}`); continue; }
      if (!due.includes(j)) { n.skipped++; say(`· 飛ばしました（今ではない）: ${what(j)}・次 ${next(j)}`); continue; }
      if (dry) { n.started++; say(`▷ 始めます（--dry: 始めていません）: ${what(j)}`); continue; }
      const res = ref ? await rest(fetchImpl, gh, 'POST', `/repos/${repo}/actions/workflows/${encodeURIComponent(j.workflow)}/dispatches`, { ref, inputs: j.inputs })
        : { ok: false, status: -1, message: '既定の枝が分かりません（GITHUB_REF_NAME もありません）' };
      if (res.ok) { n.started++; say(`✔ 始めました: ${what(j)} → ${ref}`); }
      else { n.failed++; say(`✘ 始められません: ${what(j)}: ${res.status === -1 ? res.message : refused(res, j.workflow)}`); }
    }
    say(`予約 ${r.jobs.length} 件（${at.toISOString().slice(0, 16).replace('T', ' ')} UTC）: ${dry ? '始める' : '始めた'} ${n.started}・今ではない ${n.skipped}・止めている ${n.paused}${n.failed ? `・始められない ${n.failed}` : ''}`);
    return n.failed === 0;
  }
  out('usage: node lab.mjs schedule ci [--dry] | list | check   （予約: .github/bds-lab-schedule.json — 管理パネルの「予約」で作り、毎時の schedule.yml が ci で始めます）');
  return sub === 'help' || sub === '--help';
}
