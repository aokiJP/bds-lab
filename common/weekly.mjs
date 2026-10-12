// node lab.mjs weekly [--send|--dry] [--tz <zone>] [--hosts <owner/repo,…>]: the lab's week in one message — runs, the share
// that passed, minutes, the workflows that failed most, new releases, the lenders' minutes — made by panel/lib/weekly.mjs
// (imported: the panel's 「週報」 card and this say the same words).
//   Read through GitHub's REST with GITHUB_TOKEN from GITHUB_REPOSITORY (GITHUB_API_URL): the runs of the last 14 days (this
//   week and last, up to 500), the releases (newest 30) and each lender's host.yml runs (--hosts, else the repository variable
//   LAB_HOSTS as the workflow passes it; one the token cannot read is said, not a failure).
//   --dry (and no flag): the message printed, nothing sent.
//   --send: the message to LAB_NOTIFY_WEBHOOK (common/notify.mjs: Discord, Slack, ntfy or a JSON POST); none set: said (W), not
//   a failure — notify's own rule; set but refused: exit 1.
// The token and the webhook's address are never printed (each line goes through scrub, and Actions is told to mask them).
import { report } from '../panel/lib/weekly.mjs';
import { notify } from './notify.mjs';

const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export const PER_PAGE = 100, MAX_PAGES = 5;
// (a line of the log: no control characters — a line of its own could be read by Actions as a workflow command — and no secret)
const clean = (s, n = 2000) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, n);
const scrub = (s, secrets) => secrets.reduce((t, x) => (x && x.length >= 4 ? t.split(x).join('***') : t), String(s));

/** one GET from GitHub's REST → the answer's JSON; throws { status, message } in words (status 0: no network) */
async function get(fetchImpl, { api, token }, p) {
  let r;
  try {
    r = await fetchImpl(`${api}${p}`, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'bds-lab' }, signal: AbortSignal.timeout(30_000) });
  } catch (e) { throw Object.assign(new Error(`GitHub につながりません（${e.cause?.code ?? e.name ?? 'network'}）`), { status: 0 }); }
  const text = await r.text().catch(() => '');
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${String(json?.message ?? text).slice(0, 200)}`), { status: r.status });
  return json;
}
/** a repository's runs created from `since` on, newest first, up to MAX_PAGES × PER_PAGE → { runs, partial } */
async function runsOf(fetchImpl, gh, repo, since, workflow = '') {
  const runs = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await get(fetchImpl, gh, `/repos/${repo}/actions/${workflow ? `workflows/${encodeURIComponent(workflow)}/` : ''}runs?per_page=${PER_PAGE}&page=${page}&created=${encodeURIComponent(`>=${since}`)}`);
    const rs = Array.isArray(j?.workflow_runs) ? j.workflow_runs : [];
    runs.push(...rs);
    if (rs.length < PER_PAGE) return { runs, partial: false };
  }
  return { runs, partial: true };
}

/** node lab.mjs weekly. opts (tests): out, env, now, fetchImpl, send (instead of notify) → false when it could not be made or
 *  sent (exit 1) */
export async function weeklyCmd(args = [], { out = console.log, env = process.env, now = Date.now(), fetchImpl = (...a) => globalThis.fetch(...a), send = notify } = {}) {
  const a = [...args], token = String(env.GITHUB_TOKEN ?? ''), hook = String(env.LAB_NOTIFY_WEBHOOK ?? '').trim(), secrets = [token, hook];
  const say = (s) => out(clean(scrub(s, secrets)));
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 && i + 1 < a.length ? a[i + 1] : ''; };
  if (a.includes('help') || a.includes('--help')) {
    say('usage: node lab.mjs weekly [--dry | --send] [--text-out <ファイル>] [--tz <Asia/Tokyo など>] [--hosts <owner/repo,…>]   （1 週間の実行・通った割合・使った分・よく落ちたもの・新しいリリース・貸し手の分を 1 通に。--send で LAB_NOTIFY_WEBHOOK へ）');
    return true;
  }
  const sending = a.includes('--send') && !a.includes('--dry');
  const repo = String(env.GITHUB_REPOSITORY ?? ''), api = String(env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''), gh = { api, token };
  if (!SLUG.test(repo) || !token) { say('ERR weekly: GITHUB_REPOSITORY（owner/名前）と GITHUB_TOKEN が要ります（Actions の中ならそのまま。手元なら GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=owner/lab node lab.mjs weekly --dry）'); return false; }
  // (in Actions: the two secrets masked in the whole log, whoever prints them)
  if (env.GITHUB_ACTIONS === 'true') for (const s of secrets) if (s.length >= 4) out(`::add-mask::${s}`);
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.parse(now), since = new Date(at - 15 * 86_400_000).toISOString().slice(0, 10);
  const hosts = [...new Set(String(opt('--hosts') || env.LAB_HOSTS || '').split(/[\s,]+/).filter((s) => SLUG.test(s)))].slice(0, 20);
  let lab, releases;
  try {
    [lab, releases] = await Promise.all([runsOf(fetchImpl, gh, repo, since), get(fetchImpl, gh, `/repos/${repo}/releases?per_page=30`)]);
  } catch (e) {
    say(`ERR weekly: ${repo} を読めません: ${e.message}${e.status === 401 ? '（トークンが受け付けられません）' : e.status === 403 ? '（権限: actions: read と contents: read が要ります）' : e.status === 404 ? '（リポジトリが見えません: 名前とトークンの範囲を確かめる）' : ''}`);
    return false;
  }
  const theirs = await Promise.all(hosts.map(async (slug) => {
    try { return { slug, runs: (await runsOf(fetchImpl, gh, slug, since, 'host.yml')).runs }; } catch (e) { say(`W weekly: 貸し手 ${slug} の host.yml を読めません（${e.message}）`); return { slug, runs: null }; }
  }));
  let r;
  try { r = report({ runs: lab.runs, releases: Array.isArray(releases) ? releases : [], now: at, hosts: theirs, tz: opt('--tz') || env.LAB_TZ || 'UTC', slug: repo, partial: lab.partial }); }
  catch (e) { say(`ERR weekly: 週報を作れません（${e.message}）`); return false; }
  for (const l of r.text.split('\n')) say(l);
  // (the message alone in a file: the workflow hands it to `app notify --text`, which sends it the lab's way — the Discord bot's
  // direct message first, else the webhook — as notify.yml does)
  const file = opt('--text-out');
  if (file) { try { (await import('node:fs')).writeFileSync(file, r.text + '\n'); } catch (e) { say(`ERR weekly: ${file} に書けません（${e.message}）`); return false; } }
  if (!sending) { say(`（${r.text.length} 文字。送っていません: 送るのは --send）`); return true; }
  if (!hook) { say('W weekly: LAB_NOTIFY_WEBHOOK がないので送りません（Secrets に Discord の Webhook URL を入れるか、管理パネルの「Discord に送る」で notify.yml から）'); return true; }
  const [first, ...rest] = r.text.split('\n');
  const ok = await send(first, rest, { ok: r.numbers.bad === 0, url: hook, out: say });
  say(ok ? 'OK 週報を送りました' : 'FAIL 週報を送れませんでした');
  return Boolean(ok);
}
