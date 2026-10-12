// progress (a card): an ai-make.yml run drawn in its five stages — what is going on now, what is done, where it fell (with GitHub's
// own words for the reason and the one next step), how long is left — read again every 15 s until the run is over; when it
// has made something, the way to the release. Reads only; the one write (「もう一度」, the failed jobs run again) goes through
// ctx.guarded when the page gives one.
import { h, act, link, failView } from './dom.mjs';
import * as PG from '../lib/progress.mjs';
import * as P from '../lib/policy.mjs';

export const EVERY = 15_000;
const MARK = { done: '✅', now: '⏳', failed: '❌', todo: '⚪' };
const STATE_WORD = { done: '済み', now: 'いま', failed: '落ちた', todo: 'まだ' };

/** ctx: { api, lab: { slug, role }, me, policy, role, guarded?(action, detail, fn, done), record?, timers? ({ setInterval, clearInterval }:
 *  tests only), now? () } · run: a workflow run (GitHub's shape). → an element; its .stop() ends the reading */
export function progressCard(ctx, run) {
  const slug = ctx.lab.slug, now = () => (ctx.now ? ctx.now() : Date.now()), timers = ctx.timers ?? globalThis;
  const list = h('ol', { class: 'plain' }), say = h('div', { class: 'muted', role: 'status' }), more = h('div', {});
  const card = h('div', { class: 'card', 'data-progress': String(run.id) }, h('h3', {}, '💡 AI が作っています'), say, list, more);
  let cur = run, timer = null, history = null, busy = false;
  const stop = () => { if (timer !== null) { timers.clearInterval(timer); timer = null; } };
  card.stop = stop;
  // (may this person run the failed jobs again? — and if not, why)
  const no = () => {
    if (ctx.lab?.role === 'read') return 'このラボに書ける人だけが、やり直せます';
    const role = ctx.role ?? ctx.lab.role;
    return P.can(ctx.policy ?? P.DEFAULT_POLICY, role, 'dispatch') ? null : `役割「${role}」には、ポリシーが「${P.ACTION_WORDS.dispatch}」を許していません`;
  };
  async function draw() {
    let jobs = [], reasons = [];
    try { jobs = await ctx.api.jobs(slug, cur.id); } catch (e) { more.replaceChildren(failView(e, refresh)); }
    const over = cur.status === 'completed', failedRun = over && cur.conclusion !== 'success';
    if (failedRun) { try { reasons = await PG.failReason(ctx.api, slug, cur.id); } catch { /* the stage alone */ } }
    const expect = PG.expectedMs(history ?? []);
    const s = PG.stagesOf(jobs, { now: now(), run: cur, expect, hint: reasons.join(' ') });
    list.replaceChildren(...s.stages.map((g, i) => h('li', { 'data-stage': g.key, 'data-state': g.state, class: i === s.index ? 'row' : 'row muted' },
      h('span', {}, `${MARK[g.state]} `), h('strong', {}, g.label), h('span', { class: 'muted' }, ` — ${g.state === 'now' ? g.word : STATE_WORD[g.state]}`))));
    const left = PG.etaWords(PG.etaOf(cur, history ?? [], now()));
    if (!over) { say.replaceChildren(`${s.percent}% ${s.estimated ? '（目安）' : ''}${left ? ` · ${left}` : ' · 前の実行がないので、時間は分かりません'}`); more.replaceChildren(link(cur.html_url, '実行の様子を GitHub で見る')); return; }
    stop();
    if (!failedRun) {
      say.replaceChildren('✅ できました。リリースに届いています');
      more.replaceChildren(h('div', {}, link(`https://github.com/${slug}/releases`, '🎁 配布のページ（リリース）を開く')), cur.html_url ? h('div', {}, link(cur.html_url, '実行の記録')) : null);
      return;
    }
    const f = s.stages[s.index]?.key;
    const why = no();
    say.replaceChildren(`❌ 「${s.stages[s.index]?.label ?? '途中'}」で止まりました`);
    more.replaceChildren(
      reasons.length ? h('ul', { class: 'plain' }, ...reasons.map((r) => h('li', { class: 'bad' }, r))) : h('p', { class: 'muted' }, 'GitHub が理由を書いていません。実行のログの最後の行に出ています。'),
      h('p', {}, `次の 1 手: ${PG.nextStep(f)}`),
      h('div', { class: 'row' }, h('button', { class: 'primary', disabled: Boolean(why), title: why ?? '', onclick: retry }, '🔁 落ちたところからやり直す'), why ? h('span', { class: 'muted' }, ` ${why}`) : null, ' ', link(cur.html_url, 'ログを GitHub で見る')));
  }
  async function retry() {
    if (no()) return;
    const go = () => ctx.api.rerunFailed(slug, cur.id);
    const r = ctx.guarded ? await ctx.guarded('dispatch', { run: String(cur.id), workflow: 'ai-make.yml' }, go, 'やり直しを始めました') : await act(go, 'やり直しを始めました');
    if (r === undefined) return;
    ctx.record?.('progress.rerun', { run: cur.id });
    await refresh(true);
  }
  async function refresh(again = false) {
    if (busy) return;
    busy = true;
    try {
      const r = await ctx.api.call('GET', `/repos/${slug}/actions/runs/${cur.id}`);
      if (r) cur = r;
      if (history === null) { try { history = (await ctx.api.runs(slug, { workflow: 'ai-make.yml', per: 20 })).filter((x) => x.id !== cur.id); } catch { history = []; } }
      await draw();
      if (again && cur.status !== 'completed' && timer === null) timer = timers.setInterval(refresh, EVERY);
    } catch (e) { more.replaceChildren(failView(e, () => refresh(true))); } finally { busy = false; }
  }
  refresh(true).then(() => { if (cur.status !== 'completed' && timer === null) timer = timers.setInterval(refresh, EVERY); });
  return card;
}
