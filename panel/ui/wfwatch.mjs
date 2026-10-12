// wfwatch (「概要」): a card of the open pull requests that change .github/ — what they change, said plainly, the riskiest
// first. It only reads (the pulls and each one's files) and writes nothing; a PR's link goes to github.com only.
import { h, link, failView } from './dom.mjs';
import { risk } from '../lib/wfwatch.mjs';

const MARK = { danger: '🔴', look: '🟡' };
const ORDER = { danger: 0, look: 1 };

/** the card. ctx: { api, lab: { slug } } (api.pulls(slug), api.call('GET', pulls/{n}/files)); fills in when read, and says
 *  what is wrong with the next step (failView) when GitHub will not tell */
export function wfWatchCard(ctx) {
  const body = h('div', {}, '読んでいます…');
  const root = h('section', { class: 'card', 'data-card': 'wfwatch' }, h('h3', {}, '🛡 手順を変える PR'), body);
  const draw = async () => {
    try {
      const slug = ctx.lab.slug, pulls = await ctx.api.pulls(slug);
      const all = await Promise.all((Array.isArray(pulls) ? pulls : []).map(async (pr) => {
        const files = await ctx.api.call('GET', `/repos/${slug}/pulls/${pr.number}/files?per_page=100`);
        return { pr, ...risk(files) };
      }));
      const hit = all.filter((x) => x.level !== 'none').sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.pr.number - b.pr.number);
      body.replaceChildren(
        h('p', {}, hit.length === 0 ? `開いている ${all.length} 件の PR は、どれも自動で動く手順を変えません。` : `${hit.length} 件の PR が、自動で動く手順を変えます（開いている ${all.length} 件のうち）。マージする前に中身を見てください。`),
        h('ul', {}, hit.map((x) => {
          const url = String(x.pr.html_url ?? '');
          return h('li', { 'data-level': x.level }, `${MARK[x.level]} `, url.startsWith('https://github.com/') ? link(url, `#${x.pr.number} ${x.pr.title ?? ''}`) : h('span', {}, `#${x.pr.number} ${x.pr.title ?? ''}`),
            h('ul', {}, x.why.map((w) => h('li', {}, w))));
        })));
    } catch (e) { body.replaceChildren(failView(e, draw)); }
  };
  draw();
  root.reload = draw;
  return root;
}
