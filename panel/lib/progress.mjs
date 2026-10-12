// progress: where an ai-make.yml run is, in the five stages a person understands — 考える → 作る → 本物のサーバーで遊ぶ → 配る →
// 知らせる — from the run's jobs and steps (GitHub's API shape: jobs[].steps[] with name, status, conclusion, started_at,
// completed_at). Pure: no DOM, no fetch of its own (the one read, failReason, goes through the api it is given).
//
// ai-make.yml has one long step (「make」: common/ci.mjs thinks, builds, plays and releases inside it), which GitHub does not
// split. So the stages inside it are an ESTIMATE from how long the step has run against how long it took before (weights
// below; 要実測 — not measured on a real run). A step named for a stage (think/考え, build/作, play/遊, release/配, notify/知らせ)
// is used as it is, and the estimate steps aside.

export const STAGES = Object.freeze([
  { key: 'think', label: '考える', word: 'AI が何を作るか考えています' },
  { key: 'build', label: '作る', word: 'アドオンのファイルを作っています' },
  { key: 'play', label: '本物のサーバーで遊ぶ', word: '本物のサーバーに入って、動くか確かめています' },
  { key: 'ship', label: '配る', word: 'リリースに載せています' },
  { key: 'tell', label: '知らせる', word: '結果をまとめています' },
]);
// (how the make step's time is shared by its first four stages: a guess)
const WEIGHTS = [0.2, 0.3, 0.35, 0.15];
const NAMED = [/think|考え/i, /build|作る|作成/i, /play|遊|server/i, /release|publish|配/i, /notify|summary|知らせ|upload/i];
const PREP = /^(set up job|complete job|post |run actions\/|checkout|setup-|set up |cache|npm i|run npm|run sudo|run apt|run echo)/i;

const ms = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : NaN; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required']);
const stepState = (s) => (s.status === 'completed' ? (FAILED.has(s.conclusion) ? 'failed' : s.conclusion === 'skipped' ? 'skipped' : 'done') : s.status === 'in_progress' ? 'now' : 'todo');

/** how long a run took (ms; NaN when it does not say) */
export const durationOf = (r) => ms(r?.updated_at) - ms(r?.run_started_at ?? r?.created_at);
/** how long a run of this kind usually takes: the middle of the earlier finished, successful runs' times (null: no history) */
export function expectedMs(history = []) {
  const d = history.filter((r) => r?.status === 'completed' && r.conclusion === 'success').map(durationOf).filter((x) => x > 0).sort((a, b) => a - b);
  return d.length ? d[Math.floor((d.length - 1) / 2)] : null;
}

/** jobs (GitHub's shape) → { stages: [{ key, label, word, state: 'done'|'now'|'failed'|'todo' }], index (the stage now or failed,
 *  -1 none), percent (0–100), estimated (the inside of the make step is a guess), failed }.
 *  opts: { now (ms), run ({ status, conclusion }), expect (ms the make step usually takes), hint (words of the failure) } */
export function stagesOf(jobs = [], { now = Date.now(), run = null, expect = null, hint = '' } = {}) {
  const steps = (jobs ?? []).flatMap((j) => j?.steps ?? []);
  const states = STAGES.map(() => 'todo');
  let estimated = false;
  const done = run?.status === 'completed';
  const bad = done && FAILED.has(run.conclusion);
  const named = steps.map((s) => NAMED.findIndex((re) => re.test(s.name ?? '')));
  const fromNames = new Set(named.filter((i) => i >= 0)).size >= 3;
  if (fromNames) {
    // (stages the steps name: their own state; a stage no step names takes it from its neighbours)
    steps.forEach((s, i) => { const k = named[i]; if (k < 0) return; const st = stepState(s); if (st === 'skipped') return; const rank = { todo: 0, done: 1, now: 2, failed: 3 }; if (rank[st] >= rank[states[k]] && !(states[k] === 'now' && st === 'done')) states[k] = st; });
    const last = Math.max(...states.map((s, i) => (s === 'todo' ? -1 : i)));
    for (let i = 0; i < last; i++) if (states[i] === 'todo') states[i] = 'done';
  } else {
    const real = steps.filter((s) => !PREP.test(s.name ?? ''));
    const make = real.find((s) => /make/i.test(s.name ?? '')) ?? real[0];
    const tail = real.filter((s) => s !== make);
    const ms0 = make ? stepState(make) : 'todo';
    if (!steps.length) { if (run?.status === 'in_progress') states[0] = 'now'; } else if (ms0 === 'todo') states[0] = steps.some((s) => stepState(s) === 'now') || run?.status === 'in_progress' ? 'now' : 'todo';
    else {
      const t0 = ms(make.started_at), t1 = make.completed_at ? ms(make.completed_at) : now;
      const frac = expect > 0 && Number.isFinite(t0) ? clamp((t1 - t0) / expect, 0, 0.999) : 0;
      let at = 0, acc = 0;
      while (at < 3 && frac >= acc + WEIGHTS[at]) acc += WEIGHTS[at++];
      if (ms0 === 'now') { for (let i = 0; i < at; i++) states[i] = 'done'; states[at] = 'now'; estimated = true; }
      else if (ms0 === 'done') { for (let i = 0; i < 4; i++) states[i] = 'done'; }
      else if (ms0 === 'failed') {
        // (where it fell: the words of the failure when they name a stage, else how far the time had got)
        const w = NAMED.slice(0, 4).findIndex((re, i) => i > 0 && re.test(hint));
        const k = w > 0 ? w : at;
        for (let i = 0; i < k; i++) states[i] = 'done';
        states[k] = 'failed'; estimated = true;
      }
      if (ms0 === 'done') {
        const ts = tail.map(stepState);
        states[4] = ts.includes('failed') ? 'failed' : done && !bad ? 'done' : 'now';
        if (!done && !ts.length) states[4] = 'now';
      }
    }
  }
  // (the run itself failed or was stopped with no step to blame: the stage now is the one that failed)
  if (bad && !states.includes('failed')) { const i = states.indexOf('now'); const k = i >= 0 ? i : Math.max(0, states.lastIndexOf('done') + 1); states[clamp(k, 0, 4)] = 'failed'; }
  if (done && !bad && run.conclusion === 'success') states.fill('done');
  // (nothing is "now" after a finished run)
  if (done) for (let i = 0; i < 5; i++) if (states[i] === 'now') states[i] = bad ? 'failed' : 'done';
  const index = states.findIndex((s) => s === 'failed') >= 0 ? states.findIndex((s) => s === 'failed') : states.findIndex((s) => s === 'now');
  const w5 = [...WEIGHTS, 0.05], total = w5.reduce((a, b) => a + b, 0);
  const percent = Math.round(100 * w5.reduce((a, w, i) => a + (states[i] === 'done' ? w : states[i] === 'now' ? w / 2 : 0), 0) / total);
  return { stages: STAGES.map((s, i) => ({ ...s, state: states[i] })), index, percent, estimated, failed: states.includes('failed') };
}

/** how long is left (ms; null: not known — no earlier run to go by, or the run is over) */
export function etaOf(run, history = [], now = Date.now()) {
  if (!run || run.status === 'completed') return null;
  const total = expectedMs(history.filter((r) => r?.id !== run.id));
  if (!total) return null;
  const t0 = ms(run.run_started_at ?? run.created_at);
  return Number.isFinite(t0) ? Math.max(0, total - (now - t0)) : total;
}
/** a time left in words (「あと約 5 分」), or 「まもなく」 when the usual time has passed */
export const etaWords = (left) => (left === null || left === undefined ? '' : left < 60_000 ? 'まもなく終わります' : `あと約 ${Math.round(left / 60_000)} 分`);

const NEXT = {
  think: 'AI の鍵（ANTHROPIC_API_KEY か OPENAI_API_KEY）が合っているか「連携」で確かめて、もう一度。',
  build: '頼みの言葉を短く具体的にして、もう一度。続くときは実行のログの最後の行を見てください。',
  play: '作ったアドオンが本物のサーバーで動きませんでした。実行のログに落ちた試験の名前があります。頼みを変えてもう一度。',
  ship: 'リリースを書く権限（Contents: write）が足りないかもしれません。「準備」の診断を見てください。',
  tell: '作るところまでは済んでいます。リリースを確かめて、通知の設定（LAB_NOTIFY_WEBHOOK）を見てください。',
};
/** what to do after a stage fell (words) */
export const nextStep = (key) => NEXT[key] ?? 'ログを見て、もう一度やってみてください。';

/** why a run fell, in GitHub's own words: the error annotations of its failed jobs (up to 5, each clipped) — [] when none */
export async function failReason(api, repo, run) {
  const out = [];
  const jobs = await api.jobs(repo, run);
  for (const j of jobs.filter((x) => FAILED.has(x.conclusion))) {
    const id = /\/check-runs\/(\d+)/.exec(String(j.check_run_url ?? ''))?.[1] ?? j.id;
    if (!id) continue;
    let an = []; try { an = await api.annotations(repo, id); } catch { /* the reason is a help: none is fine */ }
    for (const a of an ?? []) if (a.annotation_level !== 'notice' && a.message) out.push(String(a.message).replace(/\s+/g, ' ').trim().slice(0, 200));
  }
  return [...new Set(out)].slice(0, 5);
}
