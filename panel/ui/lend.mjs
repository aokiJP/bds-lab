// lend (「時間を貸す」): lending GitHub Actions time to the lab from one's own fork of it — the one thing someone the lab's
// owner did not invite may do here, and what the lab's administrators always do (the policy's adminsLend: every job, all
// day, no last day). The fork is public and the same code as the lab (GitHub's standard runners cost a public repository
// no minutes; host.yml comes with the fork, as the lab checks it byte for byte); it is brought up to the lab when behind,
// .lab-host.json is written from the rules, host.yml alone is switched on (the lab's own CI, schedules and autopilot stay
// off there), and the fork's whole say is given to the lab's owner: invited as a collaborator (an organization's fork: as its
// administrator), with the lab's App on it. Nothing of the lab is shown or touched here, and nothing of the lender's is
// asked for but the fork.
import { h, toast, act, link } from './dom.mjs';
import * as M from '../lib/model.mjs';
import { HOST_FILES } from '../lib/hosttemplate.mjs';

/** the fork made a host, its say given to the lab's owner → { slug, delegated } (throws with what is wrong, in words).
 *  rules: .lab-host.json's JSON */
export async function lendFork(api, { slug, me, labSlug, rules }) {
  const owner = labSlug.split('/')[0], made = M.hostRulesText(rules);
  if (!M.SLUG.test(String(slug ?? ''))) throw new Error('owner/名前 で');
  if (made.errors.length) throw new Error(made.errors.join(' / '));
  let repo = await api.repo(slug).catch(() => null);
  const c = M.forkHostCheck(repo, me, labSlug);
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
  // (the fork's say given to the lab's owner: invited — GitHub's invitation, theirs to take; already in: nothing new. A sign-in
  // GitHub does not let invite says so, and the fork lends all the same: the lab reaches it with the App)
  let delegated = M.same(owner, me);
  if (!delegated) { try { await api.addCollaborator(slug, owner, 'admin'); delegated = true; } catch (e) { if (![403, 404, 422].includes(e.status)) throw e; } }
  return { slug, delegated };
}

/** ctx: { api, me: { login }, labSlug, oauth, appSlug, always (an administrator: lends always), embedded (inside the
 *  panel: no sign-in card), labHosts(slug) (the fork into the lab's LAB_HOSTS: an administrator's own sign-in), onReady(slug,
 *  { delegated }), other() } */
export function lendStart(ctx) {
  const { api, me } = ctx, owner = ctx.labSlug.split('/')[0], always = Boolean(ctx.always);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const until = always ? '' : M.dayOf(new Date(Date.now() + 90 * 86_400_000), tz), fixed = always ? { disabled: true, title: '管理者はいつも貸します' } : {};
  const f = {
    slug: h('input', { type: 'text', value: `${me.login}/${ctx.labSlug.split('/')[1]}`, 'aria-label': 'フォーク', autocapitalize: 'off' }),
    minutes: h('input', { type: 'number', min: 1, max: M.ALWAYS_MINUTES, value: always ? M.ALWAYS_MINUTES : 600, 'aria-label': '1 か月に貸す分', ...fixed }),
    hours: h('input', { type: 'text', value: '00:00-24:00', 'aria-label': '時間帯', ...fixed }), tz: h('input', { type: 'text', value: tz, 'aria-label': '時間帯の地域' }),
    until: h('input', { type: 'date', value: until, 'aria-label': '最後の日', ...fixed }), contact: h('input', { type: 'text', value: me.login, 'aria-label': '連絡先' }),
    jobs: Object.fromEntries(M.HOST_JOBS.map((n) => [n, h('input', { type: 'checkbox', checked: always || ['gate', 'test', 'go', 'sim'].includes(n), 'aria-label': `許す: ${n}`, ...fixed })])),
  };
  const make = () => act(async () => {
    const rules = always ? M.alwaysRules(f.tz.value.trim(), f.contact.value.trim())
      : { minutesPerMonth: Number(f.minutes.value), jobs: M.HOST_JOBS.filter((n) => f.jobs[n].checked), hours: f.hours.value.trim(), timezone: f.tz.value.trim(), ...(f.until.value ? { until: f.until.value } : {}), contact: f.contact.value.trim() };
    const r = await lendFork(api, { slug: f.slug.value.trim(), me: me.login, labSlug: ctx.labSlug, rules });
    let listed = '';
    if (ctx.labHosts) { try { await ctx.labHosts(r.slug); listed = '・ラボの LAB_HOSTS に入れました'; } catch (e) { listed = `・LAB_HOSTS に入れられません（${e.message}）`; } }
    toast(`${r.slug} で貸します${r.delegated ? `・持ち主 ${owner} に預けました（招待）` : `・持ち主 ${owner} を招けませんでした: フォークの Settings → Collaborators で招いてください`}${listed}`, !r.delegated);
    ctx.onReady(r.slug, r);
  });
  const lend = h('div', { class: 'card', id: 'lend' }, h('h2', {}, always ? '⏱ 管理者はいつも時間を貸します' : '⏱ GitHub Actions の時間を貸す'),
    always ? h('p', {}, `このラボの管理者（持ち主 ${owner} のほか）は、自分の GitHub Actions の時間をいつもラボに貸します（全部の仕事・一日中・期限なし）。貸すまで、パネルの管理者の操作は止まっています。`)
      : h('p', {}, `このパネルでラボ（${ctx.labSlug}）を使えるのは、持ち主（${owner}）が招いた人だけです。あなたがここでできるのは、自分の GitHub Actions の時間をラボに貸すことだけです。`),
    h('p', { class: 'muted' }, `貸すのはラボのフォーク 1 つだけで、その全権限（設定・中身・Actions・秘密）をラボの持ち主 ${owner} に預けます（フォークへの招待と、ラボの App）。ラボの中身・秘密・実行には触れず、あなたのほかのリポジトリにも触れません。パスワードや鍵も受け取りません。走るのは、条件が許すラボの試験だけです。`),
    h('ol', {},
      h('li', {}, link(`https://github.com/${ctx.labSlug}/fork`, 'ラボをフォークする'), '（public・ラボと同じ中身。public なので GitHub の標準のランナーの分は掛かりません）'),
      h('li', {}, ctx.oauth && ctx.appSlug ? [link(`https://github.com/apps/${ctx.appSlug}/installations/new`, 'ラボの App をそのフォークだけに入れる'), '（Only select repositories で、そのフォークだけを選ぶ: App の権限がそのフォークに及びます）']
        : 'トークンの対象にそのフォークを入れる（Administration・Contents・Actions・Workflows: Read and write）'),
      h('li', {}, `${always ? '' : '下で貸す条件を決めて'}「フォークで貸す」: ラボに合わせ、.lab-host.json を書き、host.yml だけを動くようにし（ラボのほかのワークフローはあなたのところでは動きません）、持ち主 ${owner} をフォークに招きます`)),
    h('label', {}, 'フォーク（あなたのもの）'), f.slug,
    h('label', {}, '1 か月に貸す分'), f.minutes, h('label', {}, '時間帯（HH:MM-HH:MM）'), f.hours, h('label', {}, '時間帯の地域'), f.tz,
    h('label', {}, '最後の日'), f.until, h('label', {}, '連絡先'), f.contact,
    h('label', {}, '許す仕事'), h('div', { class: 'row' }, M.HOST_JOBS.map((n) => h('label', {}, f.jobs[n], ` ${M.HOST_JOB_WORDS[n] ?? n}`))),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: make }, 'フォークで貸す')));
  if (ctx.embedded) return lend;
  return h('div', {}, lend,
    h('div', { class: 'card' }, h('p', { class: 'muted' }, `ログイン: ${me.login}。ラボに招かれているなら、招待を受けてから入り直してください。`),
      h('button', { onclick: ctx.other }, '別のアカウントで入る')));
}
