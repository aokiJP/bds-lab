// runcompare (「実行の比較」, ui/runcompare.mjs): two runs side by side — each job's and each step's result and time, and what
// differs in branch, commit and the other things a run starts from. Pure: no DOM, no fetch, no node:. A run and a job are
// GitHub's own: run `id`, `status`, `conclusion`, `head_branch`, `head_sha`, `event`, `display_title`, `actor.login`,
// `run_started_at`; job `name`, `status`, `conclusion`, `started_at`, `completed_at`, `steps[{ name, number, conclusion,
// started_at, completed_at }]`. (A run does not tell the inputs of a manual start; what it starts from is the event, branch,
// commit, title and who started it.)

const ok = (r) => r?.status === 'completed' && r.conclusion === 'success';
const when = (r) => Date.parse(r?.run_started_at ?? r?.created_at) || 0;
const list = (x) => (Array.isArray(x) ? x.filter((e) => e && typeof e === 'object') : []);

/** the time a job or step took, in ms (pure); null when it did not run or does not say (skipped, not finished, dates that run backwards) */
export function spanMs(x) {
  if (!x || x.conclusion === 'skipped' || !x.started_at || !x.completed_at) return null;
  const d = Date.parse(x.completed_at) - Date.parse(x.started_at);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

/** a time in plain words (pure): 「45 秒」, 「2 分」, 「1 時間 5 分」; 「—」 when unknown */
export function words(ms) {
  if (!Number.isFinite(ms) || ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} 分` : m % 60 ? `${Math.floor(m / 60)} 時間 ${m % 60} 分` : `${Math.floor(m / 60)} 時間`;
}

/** two times as 「2 分 → 7 分（+5 分）」 (pure); the change is the difference in words (−3 分 when faster); 「—」 for one unknown, no change when equal */
export function diffText(aMs, bMs) {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs) || aMs === null || bMs === null) return `${words(aMs)} → ${words(bMs)}`;
  const d = bMs - aMs;
  if (d === 0) return `${words(aMs)} → ${words(bMs)}（同じ）`;
  return `${words(aMs)} → ${words(bMs)}（${d > 0 ? '+' : '−'}${words(Math.abs(d))}）`;
}

/** the link to GitHub's own comparison of two commits (pure); null when a commit is missing, the same, or the repository is no owner/name */
export function compareUrl(slug, shaA, shaB) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(slug ?? '')) || !/^[0-9a-f]{7,40}$/i.test(String(shaA ?? '')) || !/^[0-9a-f]{7,40}$/i.test(String(shaB ?? '')) || shaA === shaB) return null;
  return `https://github.com/${slug}/compare/${shaA}...${shaB}`;
}

/** the two runs to show first (pure): the last one that passed (before the newest) and the newest → { a, b } (runs, a may be
 *  null: nothing passed before). The newest is the one that started last; with no earlier pass, a is null */
export function defaults(runs) {
  const rs = list(runs).slice().sort((x, y) => when(y) - when(x) || (y.id ?? 0) - (x.id ?? 0));
  const b = rs[0] ?? null;
  const a = b ? rs.find((r) => r !== b && ok(r) && when(r) <= when(b)) ?? null : null;
  return { a, b };
}

const side = (j) => (j ? { conclusion: j.conclusion ?? j.status ?? null, ms: spanMs(j) } : null);
// (a name met again in the same job — the same "Run …" twice — is that name with its turn: 「Run …（2 回目）」, so both are compared)
const byName = (xs) => { const m = new Map(), seen = new Map(); for (const x of list(xs)) if (typeof x.name === 'string') { const n = (seen.get(x.name) ?? 0) + 1; seen.set(x.name, n); m.set(n === 1 ? x.name : `${x.name}（${n} 回目）`, x); } return m; };
// (the names of a and b in the order a had them, then the ones only b has)
const names = (ma, mb) => [...ma.keys(), ...[...mb.keys()].filter((k) => !ma.has(k))];
const differs = (x, y) => (x?.conclusion ?? null) !== (y?.conclusion ?? null) || (x === null) !== (y === null);
// (the time got longer: both known and b the greater)
const slowerBy = (x, y) => (x?.ms !== null && x?.ms !== undefined && y?.ms !== null && y?.ms !== undefined ? y.ms - x.ms : 0);

/** two runs and their jobs → { jobs: [{ name, a, b, changed, steps: [{ name, a, b, changed }] }], slower: [{ name, step, aMs, bMs,
 *  deltaMs, text }] (the biggest first: what took longer in b), commits: { a, b, same, url }, branches: { a, b }, inputs: [{ key,
 *  label, a, b, changed }] } (pure). a/b of a job: { conclusion, ms } or null when that run has no such job. changed: the result
 *  differs (or only one run has it). Never throws on odd input */
export function compareRuns(a, jobsA, b, jobsB, { slug = '', minMs = 1000 } = {}) {
  const ma = byName(jobsA), mb = byName(jobsB), slower = [], jobs = [];
  for (const name of names(ma, mb)) {
    const ja = ma.get(name), jb = mb.get(name), sa = side(ja), sb = side(jb);
    const steps = [], sta = byName(list(ja?.steps)), stb = byName(list(jb?.steps));
    for (const sn of names(sta, stb)) {
      const x = side(sta.get(sn)), y = side(stb.get(sn));
      steps.push({ name: sn, a: x, b: y, changed: differs(x, y) });
      const d = slowerBy(x, y);
      if (d >= minMs) slower.push({ name, step: sn, aMs: x.ms, bMs: y.ms, deltaMs: d, text: diffText(x.ms, y.ms) });
    }
    jobs.push({ name, a: sa, b: sb, changed: differs(sa, sb), steps });
    const d = slowerBy(sa, sb);
    if (d >= minMs) slower.push({ name, step: null, aMs: sa.ms, bMs: sb.ms, deltaMs: d, text: diffText(sa.ms, sb.ms) });
  }
  slower.sort((x, y) => y.deltaMs - x.deltaMs || (x.step === null ? -1 : 0) - (y.step === null ? -1 : 0)); // (the job before its own steps when equal)
  const shaA = a?.head_sha ?? null, shaB = b?.head_sha ?? null;
  const pair = (key, label, get) => { const x = get(a) ?? null, y = get(b) ?? null; return { key, label, a: x, b: y, changed: x !== y }; };
  return {
    jobs, slower,
    commits: { a: shaA, b: shaB, same: Boolean(shaA) && shaA === shaB, url: compareUrl(slug, shaA, shaB) },
    branches: { a: a?.head_branch ?? null, b: b?.head_branch ?? null },
    inputs: [pair('event', 'きっかけ', (r) => r?.event), pair('branch', '枝', (r) => r?.head_branch), pair('title', '題', (r) => r?.display_title ?? r?.name), pair('actor', '始めた人', (r) => r?.actor?.login)],
  };
}
