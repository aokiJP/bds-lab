// lend (「時間を貸す」): the one thing someone the lab's owner did not invite may do here — lend their own GitHub Actions
// time. Their own fork of the lab becomes a host: public and the same code as the lab (GitHub's standard runners cost a
// public repository no minutes; host.yml comes with the fork, as the lab checks it byte for byte), brought up to the lab
// when it is behind, .lab-host.json from the rules they choose, host.yml alone switched on (the lab's own CI, schedules and
// autopilot stay off there). Nothing of the lab is shown or touched (GitHub would refuse it anyway), and nothing of theirs
// is asked for but the fork.
import { h, toast, act, link } from './dom.mjs';
import * as M from '../lib/model.mjs';
import { HOST_FILES } from '../lib/hosttemplate.mjs';

/** ctx: { api, me: { login }, labSlug, oauth, appSlug, onReady(slug), other() } */
export function lendStart(ctx) {
  const { api, me } = ctx, owner = ctx.labSlug.split('/')[0];
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const until = M.dayOf(new Date(Date.now() + 90 * 86_400_000), tz);
  const f = {
    slug: h('input', { type: 'text', value: `${me.login}/${ctx.labSlug.split('/')[1]}`, 'aria-label': 'フォーク', autocapitalize: 'off' }),
    minutes: h('input', { type: 'number', min: 1, max: 50000, value: 600, 'aria-label': '1 か月に貸す分' }),
    hours: h('input', { type: 'text', value: '00:00-24:00', 'aria-label': '時間帯' }), tz: h('input', { type: 'text', value: tz, 'aria-label': '時間帯の地域' }),
    until: h('input', { type: 'date', value: until, 'aria-label': '最後の日' }), contact: h('input', { type: 'text', value: me.login, 'aria-label': '連絡先' }),
    jobs: Object.fromEntries(M.HOST_JOBS.map((n) => [n, h('input', { type: 'checkbox', checked: ['gate', 'test', 'go', 'sim'].includes(n), 'aria-label': `許す: ${n}` })])),
  };
  const make = () => act(async () => {
    const slug = f.slug.value.trim();
    if (!M.SLUG.test(slug)) throw new Error('owner/名前 で');
    const rules = { minutesPerMonth: Number(f.minutes.value), jobs: M.HOST_JOBS.filter((n) => f.jobs[n].checked), hours: f.hours.value.trim(), timezone: f.tz.value.trim(), ...(f.until.value ? { until: f.until.value } : {}), contact: f.contact.value.trim() };
    const made = M.hostRulesText(rules);
    if (made.errors.length) throw new Error(made.errors.join(' / '));
    let repo = await api.repo(slug).catch(() => null);
    const c = M.forkHostCheck(repo, me.login, ctx.labSlug);
    if (!c.ok) throw new Error(c.errors.join(' / '));
    // (host.yml as the lab has it: a fork behind the lab is brought up first — GitHub's 「Sync fork」)
    const want = HOST_FILES['.github/workflows/host.yml'], wf = () => api.file(slug, '.github/workflows/host.yml').then((f) => f?.text, () => null);
    if ((await wf()) !== want) { await api.syncFork(slug, repo.default_branch); repo = await api.repo(slug); }
    if ((await wf()) !== want) throw new Error('フォークの host.yml がラボと違います: GitHub のフォークの画面で「Sync fork」をしてから、もう一度');
    const had = await api.file(slug, '.lab-host.json').catch(() => null);
    if (had?.text !== made.text) await api.putFile(slug, '.lab-host.json', made.text, had?.sha, 'panel: 時間を貸す（.lab-host.json）');
    // (only host.yml runs there: the lab's own workflows stay off in the lender's fork)
    const w = M.forkWorkflows(await api.workflows(slug));
    for (const id of w.enable) await api.enableWorkflow(slug, id);
    for (const id of w.disable) await api.disableWorkflow(slug, id);
    toast(`${slug} をホストにしました`);
    ctx.onReady(slug);
  });
  return h('div', {},
    h('div', { class: 'card', id: 'lend' }, h('h2', {}, '⏱ GitHub Actions の時間を貸す'),
      h('p', {}, `このパネルでラボ（${ctx.labSlug}）を使えるのは、持ち主（${owner}）が招いた人だけです。あなたがここでできるのは、自分の GitHub Actions の時間をラボに貸すことだけです。`),
      h('p', { class: 'muted' }, 'ラボの中身・秘密・実行には触れません。あなたのパスワードや鍵も受け取りません。貸すのはラボのフォーク 1 つだけで、いつでも止められます（最後の日を昨日にする・フォークを消す）。走るのは、条件が許すラボの試験だけです。'),
      h('ol', {},
        h('li', {}, link(`https://github.com/${ctx.labSlug}/fork`, 'ラボをフォークする'), '（public・ラボと同じ中身。public なので GitHub の標準のランナーの分は掛かりません）'),
        h('li', {}, ctx.oauth && ctx.appSlug ? [link(`https://github.com/apps/${ctx.appSlug}/installations/new`, 'ラボの App をそのフォークだけに入れる'), '（Only select repositories で、そのフォークだけを選ぶ）']
          : 'トークンの対象にそのフォークを入れる（Contents・Actions・Workflows: Read and write）'),
        h('li', {}, '下で貸す条件を決めて「フォークで貸す」（ラボに合わせ、.lab-host.json を書き、host.yml だけを動くようにします。ラボのほかのワークフローはあなたのところでは動きません）'),
        h('li', {}, `手元の node lab.mjs host からも使うなら、フォークの Settings → Collaborators で持ち主 ${owner} を Write で招く（パネルからだけなら要りません）`)),
      h('label', {}, 'フォーク（あなたのもの）'), f.slug,
      h('label', {}, '1 か月に貸す分'), f.minutes, h('label', {}, '時間帯（HH:MM-HH:MM）'), f.hours, h('label', {}, '時間帯の地域'), f.tz,
      h('label', {}, '最後の日'), f.until, h('label', {}, '連絡先'), f.contact,
      h('label', {}, '許す仕事'), h('div', { class: 'row' }, M.HOST_JOBS.map((n) => h('label', {}, f.jobs[n], ` ${M.HOST_JOB_WORDS[n] ?? n}`))),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: make }, 'フォークで貸す'))),
    h('div', { class: 'card' }, h('p', { class: 'muted' }, `ログイン: ${me.login}。ラボに招かれているなら、招待を受けてから入り直してください。`),
      h('button', { onclick: ctx.other }, '別のアカウントで入る')));
}
