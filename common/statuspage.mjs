// statuspage: the lab's 「いま動いているか」 as one public page (no sign-in), put on GitHub Pages:
//   node lab.mjs statuspage --out <dir>     → <dir>/status/index.html and <dir>/status/status.json
// It reads GitHub's REST with GITHUB_TOKEN and GITHUB_REPOSITORY: the last verify, the last test of each unit, the latest
// release and the daily connect check. Results, times and counts only — no secret, no person's name, no log sentence
// (the connect check keeps service names and yes/no, never its words). A private repository writes nothing and says why.
// The page is its own: no file or script from outside (CSP meta: default-src 'none'; style-src 'unsafe-inline').
// buildHtml(data) is pure; collect(fetchImpl, env) is the only part that asks GitHub.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.github.com';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
/** a run's conclusion → 'ok' | 'bad' | 'run' | 'none' (pure) */
export const verdict = (r) => !r ? 'none' : r.status && r.status !== 'completed' ? 'run' : r.conclusion === 'success' ? 'ok' : ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion) ? 'bad' : r.conclusion ? 'skip' : 'run';
const pick = (rs) => rs.find((r) => verdict(r) !== 'skip'); // cancelled / skipped say nothing: look at the one before
const brief = (r) => r ? { state: verdict(r), at: iso(r.updated_at ?? r.created_at) } : { state: 'none', at: null };

/** GitHub → the page's data (the only part that asks). fetchImpl: fetch; env: GITHUB_TOKEN, GITHUB_REPOSITORY.
 *  A private repository → { private: true } and nothing else. A failed read leaves that part 'none' (the rest still shows). */
export async function collect(fetchImpl, env = {}, now = new Date()) {
  const repo = String(env.GITHUB_REPOSITORY ?? '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY が owner/repo の形ではありません');
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) };
  const get = async (url) => { const r = await fetchImpl(url.startsWith('http') ? url : `${API}/repos/${repo}${url}`, { headers }); if (!r.ok) throw new Error(`GitHub ${r.status}`); return r.json(); };
  const soft = async (fn, def) => { try { return await fn(); } catch { return def; } };
  const meta = await get('');
  if (meta.private !== false) return { private: true };
  const runs = (wf, extra = '', per = 30, pages = 1) => soft(async () => {
    const all = [];
    for (let n = 1; n <= pages; n++) {
      const got = (await get(`/actions/workflows/${wf}/runs?per_page=${per}&page=${n}&status=completed${extra}`)).workflow_runs ?? [];
      all.push(...got);
      if (got.length < per) break;
    }
    return all;
  }, []);
  const branch = /^[\w./-]+$/.test(meta.default_branch ?? '') ? `&branch=${encodeURIComponent(meta.default_branch)}` : '';
  const mine = (r) => ['push', 'schedule'].includes(r.event); // not a pull request's run
  const verifyRuns = (await runs('verify.yml', branch)).filter(mine);
  const unitRuns = (await runs('unit.yml', '', 100, 3)).filter((r) => /^unit test /.test(r.display_title ?? ''));
  const units = {};
  for (const r of unitRuns) { // newest first: the first of each unit is its last
    const m = /^unit\s+test\s+([\w.-]+)/.exec(r.display_title ?? ''); // (a run's title: display_title, not the workflow's name)
    if (m && !units[m[1]] && verdict(r) !== 'skip') units[m[1]] = brief(r);
  }
  const rel = await soft(() => get('/releases/latest'), null);
  const connectRuns = await runs('connect.yml');
  const connect = await soft(async () => {
    const run = pick(connectRuns);
    if (!run) return { state: 'none', at: null, services: {} };
    const jobs = (await get(`/actions/runs/${run.id}/jobs`)).jobs ?? [];
    let services = {};
    for (const j of jobs) {
      if (!/^https:\/\/api\.github\.com\//.test(j.check_run_url ?? '')) continue;
      for (const a of await get(`${j.check_run_url}/annotations`)) {
        if (a.title !== 'connect-daily') continue;
        try { const o = JSON.parse(a.message); for (const s of o.checked ?? []) services[String(s)] = o.services?.[s]?.ok === true; } catch { /* not ours */ }
      }
    }
    return { ...brief(run), services };
  }, { state: 'none', at: null, services: {} });
  return {
    private: false, repo, at: now.toISOString(),
    verify: brief(pick(verifyRuns)),
    units: Object.fromEntries(Object.entries(units).sort(([a], [b]) => a.localeCompare(b))),
    release: rel && rel.tag_name ? { tag: String(rel.tag_name), at: iso(rel.published_at ?? rel.created_at) } : null,
    connect,
    counts: { verify: verifyRuns.length, verifyOk: verifyRuns.filter((r) => verdict(r) === 'ok').length },
  };
}

const MARK = { ok: ['✅', 'うまくいっています'], bad: ['❌', 'うまくいっていません'], run: ['⏳', '動いています'], none: ['❔', 'まだ結果がありません'] };
const when = (at) => at ? `<time datetime="${esc(at)}">${esc(at.replace('T', ' ').slice(0, 16))} UTC（日本時間 ${esc(new Date(new Date(at).getTime() + 9 * 36e5).toISOString().replace('T', ' ').slice(0, 16))}）</time>` : '';
const row = (name, st) => `<tr><th scope="row">${esc(name)}</th><td>${MARK[st.state][0]} ${MARK[st.state][1]}</td><td>${when(st.at)}</td></tr>`;

/** the data → one HTML page (pure). Every value is escaped; nothing is loaded from outside */
export function buildHtml(d) {
  const units = Object.entries(d.units ?? {}), conn = d.connect ?? { state: 'none', services: {} };
  const svc = Object.entries(conn.services ?? {});
  const all = [d.verify?.state, ...units.map(([, u]) => u.state)].filter((s) => s && s !== 'none');
  const head = all.includes('bad') ? 'bad' : all.length ? 'ok' : 'none';
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ラボの状況</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:42rem;margin:1rem auto;padding:0 1rem;color:#111;background:#fff}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ccc;padding:.4rem}h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:1.5rem}small{color:#444}@media (prefers-color-scheme:dark){body{color:#eee;background:#111}th,td{border-color:#555}small{color:#bbb}}</style>
</head><body>
<h1>${MARK[head][0]} ラボの状況</h1>
<p>${esc(d.repo)} の「いま動いているか」です。${when(d.at)} に集めました。</p>
<h2>verify（いちばん新しい確かめ）</h2>
<table>${row('verify', d.verify ?? { state: 'none' })}</table>
<h2>ユニットの最後の試験</h2>
${units.length ? `<table>${units.map(([n, u]) => row(n, u)).join('')}</table>` : '<p>まだ結果がありません。</p>'}
<h2>いちばん新しいリリース</h2>
<p>${d.release ? `${esc(d.release.tag)} ${when(d.release.at)}` : 'まだありません。'}</p>
<h2>連携の毎日の確認</h2>
${svc.length ? `<table>${svc.map(([n, ok]) => `<tr><th scope="row">${esc(n)}</th><td>${ok ? '✅ つながっています' : '❌ つながりません'}</td></tr>`).join('')}</table><p><small>${when(conn.at)}</small></p>` : '<p>まだ結果がありません。</p>'}
<p><small>結果と時刻と数だけを載せています。</small></p>
</body></html>
`;
}

/** statuspage --out <dir>: collect, then write <dir>/status/index.html and status.json → true/false */
export async function statusCmd(args = [], { fetchImpl = globalThis.fetch, env = process.env, out = console.log, now = new Date() } = {}) {
  const i = args.indexOf('--out');
  if (i < 0 || !args[i + 1]) { out('使い方: node lab.mjs statuspage --out <フォルダ>（GITHUB_TOKEN と GITHUB_REPOSITORY が要ります。<フォルダ>/status/ に index.html と status.json）'); return false; }
  let d;
  try { d = await collect(fetchImpl, env, now); } catch (e) { out(`E statuspage: ${e.message}`); return false; }
  if (d.private) { out('W statuspage: このリポジトリは非公開なので、公開の状況ページは書きません（公開にしてから、もう一度）'); return false; }
  const dir = path.join(args[i + 1], 'status');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), buildHtml(d));
  fs.writeFileSync(path.join(dir, 'status.json'), `${JSON.stringify(d, null, 2)}\n`);
  out(`OK statuspage: ${dir} に書きました`);
  return true;
}
