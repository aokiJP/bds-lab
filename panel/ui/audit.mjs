// audit (the 「監査」 tab): the lab's audit log (lib/audit.mjs) for the roles the policy lets read it — narrowed by who, what
// and since when, and taken away as CSV (made in this page: a Blob and a link with download, sent nowhere).
import { h, toast, act, link } from './dom.mjs';
import * as AU from '../lib/audit.mjs';
import * as P from '../lib/policy.mjs';

/** the 「監査」 tab. ctx: { api, lab: { slug, repo }, policy, role (policy.roleFor's answer; else the lab's GitHub role) }
 *  → a promise of the entries read */
export function auditTab(body, ctx) {
  // (no role handed in: the lab's GitHub role, and teams the policy names counted as not known — the narrowest)
  const { api, lab } = ctx, policy = ctx.policy ?? P.DEFAULT_POLICY, role = ctx.role ?? P.roleFor({ repoRole: lab.repo?.permissions, teams: Object.keys(policy.teams ?? {}).length ? null : [], policy });
  if (!P.can(policy, role, 'audit.read')) return body.append(h('div', { class: 'card' }, h('h2', {}, '監査ログ'), h('p', { class: 'muted' }, 'この役割では監査ログを見られません（.github/bds-lab-panel.json の roles に audit.read）')));
  const mode = P.auditMode(policy, lab.repo?.visibility);
  const who = h('select', { 'aria-label': '誰' }), what = h('select', { 'aria-label': '何' }, h('option', { value: '' }, 'すべての操作'), Object.entries(AU.AUDIT_WORDS).map(([k, v]) => h('option', { value: k }, `${v}（${k}）`)));
  const since = h('input', { type: 'date', 'aria-label': 'この日から' }), count = h('span', { class: 'muted grow' }), list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…'));
  let all = [];
  const shown = () => AU.filter(all, { actor: who.value, action: what.value, since: since.value });
  const draw = () => {
    const xs = shown();
    count.replaceChildren(`${xs.length} 件（全部で ${all.length} 件）`);
    list.replaceChildren(xs.length ? h('table', {}, h('thead', {}, h('tr', {}, ['いつ', '誰', '何', 'どこ', '詳しく', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, [...xs].reverse().map((e) => h('tr', {}, h('td', {}, e.at.replace('T', ' ').slice(0, 19)), h('td', {}, e.actor), h('td', {}, AU.AUDIT_WORDS[e.action] ?? e.action), h('td', {}, e.target),
        h('td', {}, Object.entries(e.detail).map(([k, v]) => `${k}=${[].concat(v).join(',')}`).join(' ')), h('td', {}, e.edited ? h('span', { class: 'warn' }, '✎ 編集あり ') : null, e.url ? link(e.url, 'GitHub') : null)))))
      : h('p', { class: 'muted' }, all.length ? '当てはまるものがありません。' : 'まだ記録がありません。'));
  };
  for (const el of [who, what, since]) el.addEventListener('change', draw);
  /** the entries shown, as a CSV file (a BOM first: a spreadsheet reads it as UTF-8) */
  const csv = () => {
    const url = URL.createObjectURL(new Blob(['\ufeff', AU.toCsv(shown())], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `bds-lab-audit-${lab.slug.replace('/', '_')}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast('CSV を作りました');
  };
  body.append(h('div', { class: 'card' }, h('h2', {}, `監査ログ（${lab.slug}）`),
    h('p', { class: 'muted' }, mode === 'issue' ? `パネルでの操作を、issue「${AU.AUDIT_TITLE}」（ラベル ${AU.AUDIT_LABEL}。ロックしてコメントはリポジトリの協力者だけ、${AU.ROTATE_AT} 件ごとに番号付きの次の issue へ）にコメントで残しています。書いた人と記録の人が違うものは数えず、後から編集されたものは「編集あり」と出ます。issue はリポジトリの管理者なら消せます: 消せない記録が要るなら GitHub Enterprise の監査ログを。`
      : '記録していません（公開リポジトリの既定。.github/bds-lab-panel.json の "audit": "issue" で残します）。前の記録があれば下に出ます。'),
    h('div', { class: 'row' }, who, what, since, h('button', { onclick: () => load() }, '読み直す'), h('button', { class: 'primary', onclick: csv }, 'CSV で取り出す')), h('div', { class: 'row' }, count)), list);
  const load = () => act(async () => {
    all = (await AU.readAudit(api, lab.slug)).entries;
    const keep = who.value;
    who.replaceChildren(h('option', { value: '' }, 'すべての人'), ...[...new Set(all.map((e) => e.actor))].sort().map((x) => h('option', { value: x, selected: x === keep ? 'selected' : null }, x)));
    draw();
    return all;
  });
  return load();
}
