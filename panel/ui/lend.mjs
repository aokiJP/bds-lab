// lend (「時間を貸す」): the one thing someone the lab's owner did not invite may do here — lend their own GitHub Actions
// minutes. Their own new repository becomes a host: the template's README and host.yml as they are (the lab checks
// host.yml byte for byte), .lab-host.json from the rules they choose. Nothing of the lab is shown or touched (GitHub would
// refuse it anyway: they have no access to it), and nothing of theirs is asked for but the host itself.
import { h, toast, act, link } from './dom.mjs';
import * as M from '../lib/model.mjs';
import { HOST_FILES } from '../lib/hosttemplate.mjs';

/** ctx: { api, me: { login }, labSlug, oauth, appSlug, onReady(slug), other() } */
export function lendStart(ctx) {
  const { api, me } = ctx, owner = ctx.labSlug.split('/')[0];
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const until = M.dayOf(new Date(Date.now() + 90 * 86_400_000), tz);
  const f = {
    slug: h('input', { type: 'text', value: `${me.login}/bds-lab-host`, 'aria-label': 'ホストのリポジトリ', autocapitalize: 'off' }),
    minutes: h('input', { type: 'number', min: 1, max: 50000, value: 600, 'aria-label': '1 か月に貸す分' }),
    hours: h('input', { type: 'text', value: '00:00-24:00', 'aria-label': '時間帯' }), tz: h('input', { type: 'text', value: tz, 'aria-label': '時間帯の地域' }),
    until: h('input', { type: 'date', value: until, 'aria-label': '最後の日' }), contact: h('input', { type: 'text', value: me.login, 'aria-label': '連絡先' }),
    jobs: Object.fromEntries(M.HOST_JOBS.map((n) => [n, h('input', { type: 'checkbox', checked: ['gate', 'test', 'go', 'sim'].includes(n), 'aria-label': `許す: ${n}` })])),
  };
  const make = () => act(async () => {
    const slug = f.slug.value.trim();
    if (!M.SLUG.test(slug)) throw new Error('owner/名前 で');
    const rules = { minutesPerMonth: Number(f.minutes.value), jobs: M.HOST_JOBS.filter((n) => f.jobs[n].checked), hours: f.hours.value.trim(), timezone: f.tz.value.trim(), ...(f.until.value ? { until: f.until.value } : {}), contact: f.contact.value.trim() };
    const made = M.newHostFiles(HOST_FILES, rules);
    if (made.errors.length) throw new Error(made.errors.join(' / '));
    const repo = await api.repo(slug).catch(() => null), c = M.newHostCheck(repo, me.login);
    if (!c.ok) throw new Error(c.errors.join(' / '));
    if (c.warns.length && !confirm(`${c.warns.join('\n')}\nこのまま整えますか`)) return;
    for (const [p, text] of Object.entries(made.files)) {
      const had = await api.file(slug, p).catch(() => null);
      if (had?.text === text) continue;
      await api.putFile(slug, p, text, had?.sha, 'panel: bds-lab のホスト（時間を貸す）');
    }
    toast(`${slug} をホストにしました`);
    ctx.onReady(slug);
  });
  return h('div', {},
    h('div', { class: 'card', id: 'lend' }, h('h2', {}, '⏱ GitHub Actions の時間を貸す'),
      h('p', {}, `このパネルでラボ（${ctx.labSlug}）を使えるのは、持ち主（${owner}）が招いた人だけです。あなたがここでできるのは、自分の GitHub Actions の時間をラボに貸すことだけです。`),
      h('p', { class: 'muted' }, 'ラボの中身・秘密・実行には触れません。あなたのパスワードや鍵も受け取りません。貸すのは自分で作るリポジトリ（ホスト）1 つだけで、いつでも止められます（最後の日を昨日にする・リポジトリを消す）。分は上限の 80% で止まります。'),
      h('ol', {},
        h('li', {}, link('https://github.com/new?name=bds-lab-host&visibility=private&description=bds-lab%20%E3%81%AE%E3%83%9B%E3%82%B9%E3%83%88', 'private のリポジトリを作る'), '（中は空のままで）'),
        h('li', {}, ctx.oauth && ctx.appSlug ? [link(`https://github.com/apps/${ctx.appSlug}/installations/new`, 'ラボの App をそのリポジトリだけに入れる'), '（Only select repositories で、そのリポジトリだけを選ぶ）']
          : 'トークンの対象にそのリポジトリを入れる（Contents・Workflows: Read and write）'),
        h('li', {}, '下で貸す条件を決めて「ホストを整える」（README・host.yml・.lab-host.json の 3 つを書きます）'),
        h('li', {}, `ホストの Settings → Collaborators で、ラボの持ち主 ${owner} を Write で招く（借りるのはその人だけです）`)),
      h('label', {}, 'ホストのリポジトリ（あなたのもの）'), f.slug,
      h('label', {}, '1 か月に貸す分'), f.minutes, h('label', {}, '時間帯（HH:MM-HH:MM）'), f.hours, h('label', {}, '時間帯の地域'), f.tz,
      h('label', {}, '最後の日'), f.until, h('label', {}, '連絡先'), f.contact,
      h('label', {}, '許す仕事'), h('div', { class: 'row' }, M.HOST_JOBS.map((n) => h('label', {}, f.jobs[n], ` ${M.HOST_JOB_WORDS[n] ?? n}`))),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: make }, 'ホストを整える'))),
    h('div', { class: 'card' }, h('p', { class: 'muted' }, `ログイン: ${me.login}。ラボに招かれているなら、招待を受けてから入り直してください。`),
      h('button', { onclick: ctx.other }, '別のアカウントで入る')));
}
