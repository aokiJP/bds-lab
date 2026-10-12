// weekly (a card): this week's report — the draft of the message lib/weekly.mjs makes from the lab's runs of the last 14 days
// (this week and last), its releases and each lender's host.yml runs — shown as it will read, and 「Discord に送る」: notify.yml
// started with the message (`message` input) through ctx.guarded('dispatch', …). Reading writes nothing and records nothing.
import { h, failView } from './dom.mjs';
import * as W from '../lib/weekly.mjs';
import { readRuns, PER_PAGE, MAX_PAGES, MAX_HOSTS } from './stats.mjs';
import { listReleases } from '../lib/releases.mjs';
import { hasWorkflow } from '../lib/workspace.mjs';

/** ctx: { api, lab: { slug, workflows? (notify.yml looked for in it) }, hosts? (as panel.js reads them: [{ slug, repo, error }]),
 *  gate(action)?, guarded(action, detail, fn, done), dispatch(workflow, inputs) (GitHub's call alone: the guard is this card's),
 *  caps? ({ notify: { ok, need } }: Discord set up), go(tab)?, tz?, now? (ms: tests only) } → an element that draws itself */
export function weeklyCard(ctx) {
  const slug = ctx.lab.slug, g = ctx.gate?.('dispatch') ?? {}, c = ctx.caps?.notify, noWf = !hasWorkflow(ctx.lab.workflows, 'notify.yml');
  const hosts = (ctx.hosts ?? []).filter((x) => x?.repo && !x.error).slice(0, MAX_HOSTS);
  // (a button that is off says why where it can be read — a title is not seen on a phone — and the one step to turn it on)
  const why = g.disabled ? g.title || 'この役割では送れません'
    : noWf ? 'このラボには .github/workflows/notify.yml がありません: ラボを新しくすると送れます（フォークなら GitHub のラボのページで Sync fork → Update branch）。'
      : c?.ok === false ? `Discord がまだ使えません（足りないもの: ${c.need}）: 「秘密」タブで入れると送れます。` : '';
  const say = h('div', { class: 'muted', role: 'status' }, '実行を読んでいます…'), out = h('div', {});
  const send = h('button', { class: 'primary', disabled: true, title: '週報ができるまで押せません' }, '📨 Discord に送る');
  const again = h('button', { onclick: () => draw() }, '読み直す');
  const whyNote = why ? h('p', { class: 'warn' }, why, ' ', ctx.go && !g.disabled && !noWf && c?.ok === false ? h('button', { onclick: () => ctx.go('secrets') }, '「秘密」を開く') : null) : null;
  let rep = null;
  send.addEventListener('click', () => {
    if (!rep || why) return undefined;
    return ctx.guarded('dispatch', { workflow: 'notify.yml', weekly: rep.numbers.days.join('..') }, () => ctx.dispatch('notify.yml', { run: '', message: rep.text }),
      '週報を Discord に送るよう頼みました（数十秒で届きます）');
  });
  async function draw() {
    rep = null; send.disabled = true; send.setAttribute('title', '週報ができるまで押せません');
    say.replaceChildren('実行を読んでいます…'); out.replaceChildren();
    try {
      const now = ctx.now ?? Date.now(), since = new Date(now - 2 * W.WEEK_MS - 86_400_000).toISOString().slice(0, 10);
      const [runs, releases, ...theirs] = await Promise.all([readRuns(ctx.api, slug, { since }), listReleases(ctx.api, slug),
        ...hosts.map((x) => readRuns(ctx.api, x.slug, { workflow: 'host.yml', since }).catch(() => null))]);
      rep = W.report({ runs, releases, now, tz: ctx.tz, slug, partial: runs.length >= PER_PAGE * MAX_PAGES, hosts: hosts.map((x, i) => ({ slug: x.slug, runs: theirs[i] })) });
      say.replaceChildren(`この 7 日（${rep.numbers.days[0]}〜${rep.numbers.days[1]}）の週報の下書きです。このまま Discord に送られます（${rep.text.length} 文字）。`);
      out.replaceChildren(h('pre', { 'aria-label': '週報の下書き' }, rep.text));
      if (!why) { send.disabled = false; send.removeAttribute('title'); } else send.setAttribute('title', why);
    } catch (e) { say.replaceChildren(); out.replaceChildren(failView(e, draw)); }
  }
  const card = h('div', { class: 'card', 'data-card': 'weekly' }, h('h3', {}, '📰 週報'),
    h('p', { class: 'muted' }, '1 週間の実行の数・通った割合・使った分・よく落ちたもの・新しいリリース・貸し手の分を 1 通にまとめます。送る前にここで読めます。'),
    whyNote, say, out, h('div', { class: 'row' }, send, again));
  draw();
  return card;
}
