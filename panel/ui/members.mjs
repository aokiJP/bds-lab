// members (the 「メンバー」 tab): the lab's people — invite someone by their GitHub name as an administrator, a writer or a
// reader, change a role, remove someone, take back an invitation — and the lab's policy as a grid of roles × actions. For
// the lab's administrators (GitHub allows nobody else, and the policy's `members`); anyone else sees the list only.
import { h, toast, act, link } from './dom.mjs';
import * as MB from '../lib/members.mjs';
import * as P from '../lib/policy.mjs';

/** ctx: { api, lab: { slug, repo, role }, me, policy, role, may(action), guarded(action, detail, fn, done), reload() } */
export function membersTab(body, ctx) {
  const { api, lab } = ctx, admin = lab.role === 'admin' && ctx.may('members');
  const list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…'));
  const who = h('input', { type: 'text', placeholder: 'GitHub のユーザー名', autocapitalize: 'off', 'aria-label': '招く人' });
  const perm = h('select', { 'aria-label': '役割' }, MB.PERMISSIONS.map((p) => h('option', { value: p, selected: p === 'push' ? 'selected' : null }, MB.PERMISSION_WORDS[p])));
  const load = () => act(async () => {
    let m;
    // (signed in through the App, GitHub gives no repository administration — on purpose: the App is on lenders' hosts too —
    // so the people are changed on GitHub's own page then)
    try { m = await MB.readMembers(api, lab.slug, lab.repo); } catch (e) { if (e.status !== 403) throw e; return list.replaceChildren(h('p', { class: 'warn' }, 'このサインインでは、GitHub がメンバーを読ませません（ラボの App には、リポジトリの管理の権限を渡していません: 貸し手のホストを守るため）。'), h('p', {}, link(`https://github.com/${lab.slug}/settings/access`, 'GitHub の「Collaborators」で招く・変える'), ' か、Administration: Read and write のトークンで入る（＋ でアカウントを加える）と、ここでできます。')); }
    list.replaceChildren(h('ul', { class: 'plain' },
      m.members.map((x) => {
        const c = MB.canChange(x, { owner: m.owner, me: ctx.me.login }), sel = h('select', { 'aria-label': `${x.login} の役割`, disabled: !admin || !c.ok }, MB.PERMISSIONS.map((p) => h('option', { value: p, selected: p === x.permission ? 'selected' : null }, MB.PERMISSION_WORDS[p])));
        sel.addEventListener('change', () => ctx.guarded('members', { user: x.login, permission: sel.value }, () => MB.setMember(api, lab.slug, x.login, sel.value), `${x.login} を「${MB.PERMISSION_WORDS[sel.value]}」にしました`).then(load));
        return h('li', { class: 'row', 'data-member': x.login }, x.avatar ? h('img', { class: 'avatar', src: x.avatar, alt: '' }) : null,
          h('span', { class: 'grow' }, h('strong', {}, x.login), x.login.toLowerCase() === m.owner.toLowerCase() ? h('span', { class: 'chip' }, '持ち主') : null, c.ok ? null : h('div', { class: 'muted' }, c.why)),
          sel, admin && c.ok ? h('button', { class: 'danger', onclick: () => confirm(`${x.login} をこのラボから外しますか`) && ctx.guarded('members', { user: x.login, permission: 'none' }, () => MB.removeMember(api, lab.slug, x.login), `${x.login} を外しました`).then(load) }, '外す') : null);
      }),
      m.invitations.map((i) => h('li', { class: 'row' }, h('span', { class: 'grow' }, h('strong', {}, i.login), ' ', h('span', { class: 'chip' }, '招待中'), h('div', { class: 'muted' }, `${MB.PERMISSION_WORDS[i.permission] ?? i.permission}・相手が GitHub の通知かメールで受けると入ります`)),
        h('button', { title: '相手に渡すアドレス（GitHub の通知とメールにも届きます）', onclick: () => copy(MB.invitationUrl(lab.slug), '招待を受けるアドレスを写しました') }, '🔗 アドレス'),
        admin ? h('button', { onclick: () => ctx.guarded('members', { user: i.login, permission: 'none' }, () => MB.cancelInvitation(api, lab.slug, i.id), `${i.login} への招待を取り消しました`).then(load) }, '取り消す') : null))));
  });
  body.append(h('div', { class: 'card' }, h('h2', {}, `メンバー（${lab.slug}）`),
    h('p', { class: 'muted' }, admin ? 'GitHub のユーザー名で招きます。相手が招待を受けると、その役割で「GitHub でサインイン」から入れます（パネルでできることは下の「役割」でさらに狭められます）。'
      : '見るだけです: メンバーを変えられるのはラボの管理者だけです（GitHub が管理者にだけ許します）。'),
    admin ? h('div', { class: 'row' }, who, perm, h('button', { class: 'primary', onclick: async () => {
      const name = who.value.trim().replace(/^@/, '');
      if (perm.value === 'admin' && !confirm(`${name} を管理者にしますか（メンバー・秘密・設定も変えられるようになります）`)) return;
      const r = await ctx.guarded('members', { user: name, permission: perm.value }, () => MB.setMember(api, lab.slug, name, perm.value));
      if (r !== undefined) { toast(r === 'invited' ? `${name} を招きました（相手が受けると入ります）` : `${name} の役割を変えました`); who.value = ''; load(); }
    } }, '招く')) : null,
    list));
  body.append(policyCard(ctx, admin));
  load();
}

/** text to the clipboard (shown to copy by hand where the browser will not) */
const copy = (text, done) => navigator.clipboard?.writeText(text).then(() => toast(done), () => prompt('写してください', text)) ?? prompt('写してください', text);

/** the policy as a grid: which GitHub role may do which action in the panel, what is asked first, idle minutes, the log */
function policyCard(ctx, admin) {
  const g = MB.gridOf(ctx.policy), boxes = {}, ask = {};
  const head = h('tr', {}, h('th', {}, ''), P.GITHUB_ROLES.map((r) => h('th', {}, r)), h('th', {}, '確かめる'));
  const rows = P.ACTIONS.map((a) => h('tr', {}, h('td', {}, P.ACTION_WORDS[a]),
    P.GITHUB_ROLES.map((r) => { const b = h('input', { type: 'checkbox', checked: g.roles[r].includes(a), disabled: !admin || r === 'admin', 'aria-label': `${r}: ${a}` }); (boxes[r] ??= {})[a] = b; return h('td', {}, b); }),
    h('td', {}, (ask[a] = h('input', { type: 'checkbox', checked: g.confirm.includes(a), disabled: !admin, 'aria-label': `確かめる: ${a}` })))));
  const idle = h('input', { type: 'number', min: 0, max: 1440, value: g.idleMinutes, disabled: !admin }), audit = h('select', { disabled: !admin }, ['auto', 'issue', 'off'].map((v) => h('option', { value: v, selected: v === g.audit ? 'selected' : null }, { auto: 'auto（非公開なら残す）', issue: '残す', off: '残さない' }[v])));
  return h('div', { class: 'card' }, h('h2', {}, '役割（パネルでできること）'),
    h('p', { class: 'muted' }, `${P.POLICY_FILE} に書きます。GitHub の役割ごとに、パネルで許す操作を選びます（GitHub が許さないことはここで選んでもできません。管理者はいつも全部）。${ctx.policyErrors?.length ? ' いまのファイルは正しくありません: 保存すると直ります。' : ''}`),
    // (a ready-made grid in one tap; nothing is written until 「役割を保存」)
    admin ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'ひな形:'), Object.entries(MB.POLICY_PRESETS).map(([id, p]) => h('button', { 'data-preset': id, onclick: () => {
      const n = MB.applyPreset(g, id);
      for (const r of P.GITHUB_ROLES) for (const a of P.ACTIONS) boxes[r][a].checked = n.roles[r].includes(a);
      toast(`「${p.label}」にしました（まだ保存していません）`);
    } }, p.label))) : null,
    h('table', {}, h('thead', {}, head), h('tbody', {}, rows)),
    h('label', {}, '操作がなければサインアウトする分（0: しない）'), idle, h('label', {}, '監査ログ'), audit,
    admin ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => {
      const grid = { ...g, roles: Object.fromEntries(P.GITHUB_ROLES.map((r) => [r, P.ACTIONS.filter((a) => boxes[r][a].checked)])), confirm: P.ACTIONS.filter((a) => ask[a].checked), idleMinutes: Number(idle.value), audit: audit.value };
      return ctx.guarded('members', { file: P.POLICY_FILE }, () => MB.savePolicy(ctx.api, ctx.lab.slug, grid), '役割を保存しました（既定の枝に）').then((r) => { if (r !== undefined) ctx.reload(); });
    } }, '役割を保存')) : h('p', { class: 'muted' }, '変えられるのは管理者だけです'),
    link(`https://github.com/${ctx.lab.slug}/blob/${ctx.lab.repo?.default_branch ?? 'main'}/${P.POLICY_FILE}`, 'GitHub でファイルを見る'));
}
