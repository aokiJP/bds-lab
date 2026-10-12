// secretmap (the 「秘密」 tab): a card of which workflow uses which secret, what is missing (with the way to register it) and
// what nobody uses (to be checked before it is removed). It only reads (the workflow files and the secrets' names).
import { h, link, failView } from './dom.mjs';
import { usage } from '../lib/secretmap.mjs';

const base = (p) => String(p).split('/').pop();

/** the card. ctx: { api, lab: { slug, workflows }, openSecrets?(name) } (api.file(slug, path) → { text } | null, api.secrets(slug)
 *  → [{ name }]); openSecrets takes the person to 「秘密」 with that name ready. Fills in when read; a failure says the next step */
export function secretMapCard(ctx) {
  const body = h('div', {}, '読んでいます…');
  const root = h('section', { class: 'card', 'data-card': 'secretmap' }, h('h3', {}, '🗺 秘密の使われ方'), body);
  const draw = async () => {
    try {
      const wfs = (ctx.lab.workflows ?? []).filter((w) => /\.ya?ml$/.test(String(w.path)));
      const [files, secrets] = await Promise.all([
        Promise.all(wfs.map(async (w) => ({ path: w.path, text: (await ctx.api.file(ctx.lab.slug, w.path))?.text ?? '' }))),
        ctx.api.secrets(ctx.lab.slug).catch((e) => { if (e.status === 403 || e.status === 404) return null; throw e; })]);
      const u = usage(files, secrets), used = u.byWorkflow.filter((w) => w.secrets.length);
      const where = `https://github.com/${ctx.lab.slug}/settings/secrets/actions`;
      body.replaceChildren(
        u.known ? null : h('p', { class: 'warn' }, '秘密の名前を読む権利がないので、「足りない」「使われていない」は調べていません（管理者に頼むか、権利のあるトークンで入り直してください）。'),
        used.length === 0 ? h('p', {}, '秘密を使っているワークフローは見つかりませんでした。') : h('ul', {}, used.map((w) => h('li', { 'data-workflow': w.path }, h('b', {}, base(w.path)), ': ', w.secrets.join('、')))),
        u.missing.length === 0 ? null : h('div', { class: 'warn', 'data-part': 'missing' }, h('p', {}, `足りない秘密が ${u.missing.length} 個あります（使われているのに、まだ入っていません）。`),
          h('ul', {}, u.missing.map((m) => h('li', {}, h('b', {}, m.name), `（${m.paths.map(base).join('、')} が使います） `,
            ctx.openSecrets ? h('button', { onclick: () => ctx.openSecrets(m.name) }, '「秘密」で登録する') : h('small', {}, '「秘密」のタブで、この名前で登録してください。'))))),
        u.unused.length === 0 ? null : h('div', { 'data-part': 'unused' }, h('p', {}, `どのワークフローも使っていない秘密が ${u.unused.length} 個あります。`),
          h('ul', {}, u.unused.map((n) => h('li', {}, h('b', {}, n)))),
          h('p', {}, h('small', {}, '消す前に、確かめてください: ワークフロー以外（手元の道具や別のリポジトリ）が使っているかもしれません。消すのは「秘密」のタブの操作です。'))),
        h('p', {}, h('small', {}, '読むのは、ワークフローの文字と、秘密の名前だけです（秘密の値は GitHub も教えません）。 '), link(where, 'GitHub の秘密の一覧')));
    } catch (e) { body.replaceChildren(failView(e, draw)); }
  };
  draw();
  root.reload = draw;
  return root;
}
