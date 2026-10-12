// nlsched (in the 「予約」 tab): a schedule from a sentence — 「毎週月曜の朝 9 時に verify」. What was read is said back in
// words with its next three times, a question when something is missing (never a guess: lib/nlsched.mjs), and 「この予約を足す」
// hands the job(s) to the tab: onJob(job) for each (平日: 5), or onJobs(jobs) once. Writing them is the tab's own save (its
// guarded('dispatch'), the AI question for ai-make, hostrun's right): this card reads and writes nothing on GitHub.
import { h, failView } from './dom.mjs';
import * as N from '../lib/nlsched.mjs';
import * as S from '../lib/schedule.mjs';

const localTz = () => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return S.validTimezone(z) ? z : 'UTC'; } catch { return 'UTC'; } };
const EXAMPLES = ['毎週月曜の朝 9 時に verify', '平日の夜 10 時に unit test ruby', '3 時間ごとに latest'];

/** the card. ctx: { workflows, units (the units' names), tz (else this browser's), ids (the schedule's ids: an array or a
 *  function giving one), may(action), now() (→ ms; tests), onJob }. opts: { onJob(job) (a promise; undefined back: not
 *  added — the tab said why), onJobs(jobs) (all at once, when the tab writes them in one save) } → the element */
export function nlScheduleCard(ctx = {}, opts = {}) {
  const onJob = opts.onJob ?? ctx.onJob, onJobs = opts.onJobs ?? ctx.onJobs;
  const now = () => ctx.now?.() ?? Date.now();
  const may = ctx.may ? Boolean(ctx.may('dispatch')) : true;
  const input = h('input', { type: 'text', id: 'nlschedtext', 'aria-label': '予約を日本語で', placeholder: `例: ${EXAMPLES[0]}`, maxlength: 300 });
  const out = h('div', { 'aria-live': 'polite' }), why = h('p', { class: 'muted' });
  const add = h('button', { disabled: true }, 'この予約を足す');
  let cur = null, busy = false;

  const read = () => {
    const ids = typeof ctx.ids === 'function' ? ctx.ids() : ctx.ids;
    cur = N.parse(input.value, { workflows: ctx.workflows ?? [], units: ctx.units, tz: ctx.tz ?? localTz(), ids: ids ?? [] });
    const kids = [];
    if (!String(input.value).trim()) kids.push(h('p', { class: 'muted' }, `たとえば: ${EXAMPLES.join(' ・ ')}`));
    else if (cur.ask) kids.push(cur.said ? h('p', {}, `わかったこと: ${cur.said}`) : null, h('p', { class: 'bad' }, `❓ ${cur.ask}`));
    else {
      kids.push(h('p', {}, `✔ ${cur.said}`));
      // (the next three of all of them: 平日's five jobs start on five days)
      const next = cur.jobs.flatMap((j) => S.nextRuns(j, now(), 3)).sort((a, b) => a - b).slice(0, 3);
      kids.push(h('p', { class: 'muted' }, `次は ${next.map((d) => S.fmtWhen(d, cur.job.timezone)).join('・')}`));
      if (S.AI_WORKFLOWS.includes(cur.job.workflow)) kids.push(h('p', { class: 'muted' }, `${cur.job.workflow} は始まるたびに AI の料金を使います（足すときにもう一度聞きます）`));
    }
    out.replaceChildren(...kids.filter(Boolean));
    // (a button that cannot be pressed says why, in words)
    const no = !may ? '役割に「ワークフローを始める」が要ります（管理者に頼んでください）'
      : !(onJob || onJobs) ? 'ここからは足せません（「予約」のタブで使ってください）'
        : !String(input.value).trim() ? 'いつ・何を、を書いてください'
          : cur.ask ? '上の ❓ に答えるように書き直してください' : busy ? '足しています…' : '';
    add.disabled = Boolean(no);
    why.textContent = no;
    return cur;
  };

  add.addEventListener('click', async () => {
    const r = read();
    if (add.disabled || !r.jobs.length) return;
    busy = true; read();
    let n = 0;
    try {
      if (onJobs) n = (await onJobs(r.jobs)) === undefined ? 0 : r.jobs.length;
      else for (const j of r.jobs) { if ((await onJob(j)) === undefined) break; n++; }
    } catch (e) {
      busy = false; read();
      if (n) out.append(h('p', {}, `${r.jobs.length} 件のうち ${n} 件は足しました（残りは「予約」の一覧で足してください）`));
      out.append(failView(e, () => add.click?.()));
      return;
    }
    busy = false;
    if (n === r.jobs.length) { input.value = ''; read(); out.replaceChildren(h('p', {}, `足しました: ${r.said}`)); return; }
    read();
    // (not added — the tab has said why: refused, asked and declined; some of several: which)
    if (n) out.append(h('p', {}, `${r.jobs.length} 件のうち ${n} 件は足しました（残りは「予約」の一覧で足してください）`));
  });
  input.addEventListener('input', read);
  read();
  return h('section', { class: 'card', id: 'nlsched' },
    h('h3', {}, '🗓 日本語で予約'),
    h('p', { class: 'muted' }, 'いつ・何を、をふつうの言葉で書くと、予約の形にします。分からないところは聞き返します。'),
    input, out, h('div', {}, add, ' ', why));
}
