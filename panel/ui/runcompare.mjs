// runcompare (「実行の比較」): two runs of the lab side by side — which job and step ended differently, what took longer (biggest
// first, 「2 分 → 7 分（+5 分）」), and what differs in branch, commit and start (lib/runcompare.mjs), with GitHub's own
// comparison of the two commits one link away. Only reads (the two runs' jobs, through ctx.api); nothing is written. At first
// it shows the last run that passed and the newest.
import { h, link, failView } from './dom.mjs';
import * as R from '../lib/runcompare.mjs';

const MARK = { success: '✅', failure: '❌', timed_out: '❌', startup_failure: '❌', cancelled: '🚫', skipped: '➖' };
const label = (c) => (c ? `${MARK[c] ?? '•'} ${c}` : '—');
const runName = (r) => `#${r.run_number ?? r.id} ${r.name ?? ''} · ${r.head_branch ?? '?'} · ${r.status === 'completed' ? (r.conclusion ?? '?') : (r.status ?? '?')}${r.run_started_at ? ` · ${String(r.run_started_at).slice(0, 16).replace('T', ' ')}` : ''}`;
const cell = (s) => (s ? `${label(s.conclusion)}${s.ms !== null && s.ms !== undefined ? `（${R.words(s.ms)}）` : ''}` : 'ない');

/** the result drawn: the table of jobs (with steps under a job that differs), the slower list, the inputs, the link */
export function resultView(cmp) {
  const rows = cmp.jobs.flatMap((j) => [
    h('tr', { 'data-job': j.name, 'data-changed': j.changed ? 'yes' : 'no' }, h('td', {}, j.changed ? '⚠️ ' : '', j.name), h('td', {}, cell(j.a)), h('td', {}, cell(j.b))),
    ...(j.changed || j.steps.some((s) => s.changed) ? j.steps.filter((s) => s.changed).map((s) => h('tr', { 'data-step': s.name, 'data-changed': 'yes' }, h('td', {}, '　└ ', s.name), h('td', {}, cell(s.a)), h('td', {}, cell(s.b)))) : []),
  ]);
  const diffs = cmp.inputs.filter((i) => i.changed);
  return h('div', { class: 'runcompare-result' },
    cmp.jobs.length ? h('table', { class: 'plain' }, h('thead', {}, h('tr', {}, h('th', {}, 'ジョブ'), h('th', {}, '前（A）'), h('th', {}, '後（B）'))), h('tbody', {}, rows)) : h('p', { class: 'muted' }, 'ジョブが見つかりませんでした。'),
    h('h3', {}, '遅くなったところ'),
    cmp.slower.length ? h('ul', { class: 'plain', id: 'runcompare-slower' }, cmp.slower.map((s) => h('li', {}, `${s.name}${s.step ? ` › ${s.step}` : ''}: ${s.text}`))) : h('p', { class: 'muted' }, '遅くなったところはありません。'),
    h('h3', {}, 'ちがい'),
    diffs.length ? h('ul', { class: 'plain', id: 'runcompare-inputs' }, diffs.map((i) => h('li', {}, `${i.label}: ${i.a ?? '—'} → ${i.b ?? '—'}`))) : h('p', { class: 'muted' }, '枝も、きっかけも同じです。'),
    h('p', {}, cmp.commits.same ? '同じ commit です。' : cmp.commits.url ? link(cmp.commits.url, 'GitHub で commit のちがいを見る') : 'commit のちがいは、片方の commit が分からないので出せません。'));
}

/** the card. ctx: { api (jobs(slug, runId)), lab: { slug } }; opts: { runs } (the lab's runs, GitHub's own, any order). The element
 *  has `.loaded`: a promise of the first comparison (when there is one to show) */
export function runCompareCard(ctx, { runs = [] } = {}) {
  const rs = (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r === 'object' && r.id !== undefined);
  const body = h('div', { id: 'runcompare-body' }), card = h('div', { class: 'card', id: 'runcompare' }, h('h2', {}, '⚖️ 実行の比べっこ'), body);
  card.loaded = Promise.resolve();
  if (rs.length < 2) { body.append(h('p', { class: 'muted' }, '比べるには、実行が 2 つ以上いります。まず動かしてみましょう。')); return card; }
  const sorted = rs.slice().sort((x, y) => (Date.parse(y.run_started_at ?? y.created_at) || 0) - (Date.parse(x.run_started_at ?? x.created_at) || 0) || y.id - x.id);
  const d = R.defaults(rs), pick = { b: d.b ?? sorted[0] };
  pick.a = d.a ?? sorted.find((r) => r !== pick.b); // (nothing passed before: the one before the newest)
  const select = (key, name) => h('select', { id: `runcompare-${key}`, 'aria-label': name, onchange: (e) => { pick[key] = rs.find((r) => String(r.id) === String(e.target.value)) ?? pick[key]; } },
    sorted.map((r) => h('option', { value: String(r.id), selected: r.id === pick[key].id }, runName(r))));
  const out = h('div', { id: 'runcompare-out', 'aria-live': 'polite' }), jobs = new Map();
  const jobsOf = async (r) => { if (!jobs.has(r.id)) jobs.set(r.id, await ctx.api.jobs(ctx.lab.slug, r.id)); return jobs.get(r.id); };
  async function compare() {
    const { a, b } = pick;
    if (a.id === b.id) { out.replaceChildren(h('p', { class: 'muted' }, '同じ実行どうしは比べられません。ちがう実行を選んでください。')); return; }
    out.replaceChildren(h('p', { class: 'muted' }, '読んでいます…'));
    try {
      const [ja, jb] = await Promise.all([jobsOf(a), jobsOf(b)]);
      out.replaceChildren(resultView(R.compareRuns(a, ja, b, jb, { slug: ctx.lab.slug })));
    } catch (e) { out.replaceChildren(failView(e, compare)); }
  }
  const btn = h('button', { id: 'runcompare-go', onclick: compare }, '比べる');
  body.append(h('p', { class: 'muted' }, 'A は前（通った実行）、B は後（今の実行）。選びなおせます。'),
    h('label', {}, 'A: ', select('a', '前の実行')), h('label', {}, 'B: ', select('b', '後の実行')), ' ', btn, out);
  card.loaded = compare();
  return card;
}
