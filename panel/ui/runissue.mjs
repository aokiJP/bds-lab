// runissue card: a failed run → an Issue in one click (its summary, failed jobs, annotations and the link to the run). When the
// run already has an Issue, that one is opened instead of a second. The write goes through ctx.guarded('issues', …).
import { h, act, link } from './dom.mjs';
import * as R from '../lib/runissue.mjs';

const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

/** ctx: { api, lab: { slug }, guarded?(action, detail, fn, done) }; run: a failed workflow run → the card (an element) */
export function runIssueCard(ctx, run) {
  const { api, lab } = ctx, out = h('div', {}), failed = ['failure', 'timed_out', 'cancelled', 'startup_failure'].includes(run?.conclusion);
  const why = failed ? '' : 'この実行は落ちていないので、Issue は作れません';
  const show = (r) => fill(out, h('p', {}, r.existed ? 'この実行の Issue はもうあります: ' : 'Issue を作りました: ', link(r.issue.html_url, `#${r.issue.number}`)));
  const go = h('button', {
    class: 'primary', disabled: !failed, title: why,
    onclick: async () => {
      const work = () => R.openOrCreate(api, lab.slug, run);
      const r = ctx.guarded ? await ctx.guarded('issues', { run: run.id }, work, '調べました') : await act(work, '調べました');
      if (r === undefined) return;
      show(r);
    },
  }, '🐛 失敗から Issue');
  return h('div', { class: 'card', 'data-runissue': run?.id ?? '' }, h('h3', {}, '🐛 失敗から Issue'), h('p', { class: 'muted' }, 'まとめ・失敗したジョブ・注釈・実行へのリンクを Issue にします。同じ実行の Issue があれば、それを開きます。'), go, why ? h('p', { class: 'muted' }, why) : null, out);
}
