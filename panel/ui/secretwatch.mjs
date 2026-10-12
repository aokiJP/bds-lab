// secretwatch (the 「秘密」 tab and 「概要」): a card listing the lab's secrets that have stood a long time, each with the way to
// renew it. It reads only the secrets' names and dates (GitHub gives no values) and writes nothing.
import { h, link, failView } from './dom.mjs';
import { ageOf } from '../lib/secretwatch.mjs';

const MARK = { stale: '🔴', old: '🟡', ok: '🟢' };

/** the card. ctx: { api, lab: { slug }, now? } (api.secrets(slug) → [{ name, updated_at }]); fills in when read, and says what
 *  is wrong with the next step (failView) when GitHub will not tell */
export function secretWatchCard(ctx) {
  const body = h('div', {}, '読んでいます…');
  const root = h('section', { class: 'card', 'data-card': 'secretwatch' }, h('h3', {}, '🔑 秘密の古さ'), body);
  const draw = async () => {
    try {
      const list = ageOf(await ctx.api.secrets(ctx.lab.slug), { now: ctx.now ?? Date.now() }), worn = list.filter((x) => x.level !== 'ok');
      const where = `https://github.com/${ctx.lab.slug}/settings/secrets/actions`;
      body.replaceChildren(
        h('p', {}, list.length === 0 ? '秘密はまだ入っていません。' : worn.length === 0 ? `${list.length} 個の秘密は、どれも新しいです。` : `${worn.length} 個の秘密が古くなっています（${list.length} 個のうち）。`),
        h('ul', {}, worn.map((x) => h('li', { 'data-level': x.level }, `${MARK[x.level]} `, h('b', {}, x.name), `: ${x.why}。`, h('div', {}, x.how.say, ' ', x.how.url ? link(x.how.url, '作り直す画面') : null)))),
        h('p', {}, h('small', {}, 'GitHub が教えるのは「入れた日」だけです（本当の期限は分かりません）。 '), link(where, 'GitHub の秘密の一覧')));
    } catch (e) { body.replaceChildren(failView(e, draw)); }
  };
  draw();
  root.reload = draw;
  return root;
}
