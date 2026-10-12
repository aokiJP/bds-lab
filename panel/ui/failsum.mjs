// failsum card: a failed run said in three lines — where it fell, why, and the one next step — for 「進み具合」's 「詳しく」, above
// the rest of a failed run. Reads only (the run's jobs, the failed jobs' annotations; never a log: lib/failsum.mjs says why);
// the next step is lib/guide.mjs diagnose's first fix when it has one. Nothing is written, so no ctx.guarded and no record.
import { h, toast, link, failView } from './dom.mjs';
import * as FS from '../lib/failsum.mjs';
import * as GD from '../lib/guide.mjs';
import * as M from '../lib/model.mjs';

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required']);
// (links out of the panel go to github.com only)
const ghLink = (href, text) => (/^https:\/\/github\.com\//.test(String(href ?? '')) ? link(href, text) : null);

/** ctx: { api, lab: { slug, secrets? }, slug? (the run's repository when not the lab's: a lender's), go?(tab) } · run: a
 *  workflow run (GitHub's shape). → the card (an element); for a run that did not fail, a short line saying so */
export function failsumCard(ctx, run) {
  const slug = ctx.slug ?? run?.repository?.full_name ?? ctx.lab?.slug;
  const body = h('div', { role: 'status' }, h('span', { class: 'muted' }, '落ちた理由をまとめています…'));
  const card = h('div', { class: 'card failsum', 'data-failsum': String(run?.id ?? '') }, h('h3', {}, '🩺 落ちた理由のまとめ'), body);
  const load = async () => {
    body.replaceChildren(h('span', { class: 'muted' }, '落ちた理由をまとめています…'));
    let jobs, annotations = [];
    try { jobs = await ctx.api.jobs(slug, run.id); } catch (e) { body.replaceChildren(failView(e, load), h('button', { onclick: load }, '読み直す')); return; }
    for (const j of jobs.filter((x) => FAILED.has(x.conclusion)).slice(0, 3)) {
      const id = /\/check-runs\/(\d+)/.exec(String(j.check_run_url ?? ''))?.[1];
      // (a job's notes are extra: its steps still say where it fell)
      if (id) { try { annotations.push(...(await ctx.api.annotations(slug, id) ?? [])); } catch { /* the steps alone */ } }
    }
    const diagnosis = GD.diagnose({ run, jobs, annotations, secrets: slug === ctx.lab?.slug ? ctx.lab?.secrets ?? null : null, known: Object.keys(M.KNOWN_SECRETS) });
    const s = FS.summarize({ run, jobs, annotations, diagnosis });
    if (!s) { body.replaceChildren(h('p', { class: 'muted' }, run.status === 'completed' ? 'この実行は落ちていません。' : 'この実行はまだ動いています。終わって落ちていたら、ここに理由が出ます。')); return; }
    const tab = s.tab;
    body.replaceChildren(
      h('ol', { class: 'plain' }, s.lines.map((l, i) => h('li', { 'data-line': ['where', 'why', 'next'][i] }, l))),
      h('div', { class: 'row' },
        tab && tab !== 'runs' && ctx.go ? h('button', { class: 'primary', onclick: () => ctx.go(tab) }, `「${GD.HELP[tab]?.title ?? tab}」を開く`) : null,
        h('button', { onclick: () => copy(s.lines.join('\n')) }, '📋 3 行を写す'),
        ghLink(run.html_url, 'GitHub でログを見る')));
  };
  load();
  return card;
}

async function copy(text) {
  try { await globalThis.navigator.clipboard.writeText(text); toast('写しました。そのまま貼って伝えられます'); } catch { toast('写せませんでした（このブラウザが許していません）。文を選んで写してください', true); }
}
