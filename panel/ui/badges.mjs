// badges (a card for 「概要」): the lab's prizes — what it has earned (computed by lib/badges.mjs from its units, runs, releases
// and lenders) and what is still to come. The ones this browser has not seen are marked 🎉 once; what was seen is kept in
// this browser (ctx.storage). Reading only: nothing is written to GitHub and nothing is recorded.
import { h, failView } from './dom.mjs';
import * as B from '../lib/badges.mjs';
import { readRuns } from './stats.mjs';
import { listReleases } from '../lib/releases.mjs';
import { listUnits } from '../lib/units.mjs';
import { clock, localZone } from '../lib/stats.mjs';

/** where this browser keeps the ids it has shown */
export const SEEN_KEY = 'bdslab.panel.badges.seen';
const readSeen = (st) => { try { const j = JSON.parse(st?.getItem(SEEN_KEY) ?? '[]'); return Array.isArray(j) ? j.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const writeSeen = (st, ids) => { try { st.setItem(SEEN_KEY, JSON.stringify(ids)); return true; } catch { return false; } };

/** ctx: { api, lab: { slug }, hosts? (as panel.js reads them: [{ slug, repo, error }]), storage (localStorage), tz?, now? (ms: tests only) }
 *  → an element that draws itself */
export function badgesCard(ctx) {
  const slug = ctx.lab.slug, say = h('div', { class: 'muted', role: 'status' }, 'バッジを数えています…'), out = h('div', {});
  async function draw() {
    say.replaceChildren('バッジを数えています…'); out.replaceChildren();
    try {
      const [units, runs, releases] = await Promise.all([listUnits(ctx.api, slug), readRuns(ctx.api, slug), listReleases(ctx.api, slug)]);
      const got = B.earned({ units, runs, releases, hosts: ctx.hosts ?? [], now: ctx.now ?? Date.now() });
      const seen = readSeen(ctx.storage), news = new Set(B.fresh(got, seen).map((x) => x.id)), tz = ctx.tz ?? localZone();
      const have = new Map(got.map((x) => [x.id, x]));
      say.replaceChildren(`${B.BADGES.length} 個のうち ${got.length} 個もらいました。${news.size ? `🎉 新しいバッジが ${news.size} 個あります！` : ''}`);
      out.replaceChildren(h('ul', { class: 'badges', 'aria-label': 'バッジの一覧' }, B.BADGES.map((b) => {
        const x = have.get(b.id), day = x?.at ? clock(x.at, tz)?.day : '';
        return h('li', { 'data-badge': b.id, 'data-state': x ? 'earned' : 'locked' },
          h('strong', {}, `${b.icon} ${b.name}`), news.has(b.id) ? h('span', { class: 'ok' }, ' 🎉 新しい！') : null,
          h('div', { class: 'muted' }, x ? `${b.text}${day ? `（${day}）` : ''}` : `まだです: ${b.text}`));
      })));
      // (seen now: the 🎉 is for this look only; a browser that cannot keep it just shows it again next time)
      if (news.size && !writeSeen(ctx.storage, [...new Set([...seen, ...got.map((x) => x.id)])])) out.append(h('p', { class: 'muted' }, 'このブラウザには「見た」を残せませんでした。次に開くときも 🎉 が出ます。'));
    } catch (e) { say.replaceChildren(); out.replaceChildren(failView(e, draw)); }
  }
  const card = h('div', { class: 'card', 'data-card': 'badges' }, h('h3', {}, '🏅 バッジ'),
    h('p', { class: 'muted' }, 'ラボのやってきたことから数えます。新しくもらったものには 🎉 が付きます。'), say, out,
    h('div', { class: 'row' }, h('button', { onclick: () => draw() }, '数え直す')));
  draw();
  return card;
}
