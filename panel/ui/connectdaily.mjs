// connectdaily (a card over the 「🔗 連携」 tab): what connect.yml's daily check last found (lib/connectdaily.mjs) — each service
// whose secrets are there ✅ or ⚠️ with the words of what is wrong and the next step, how old the check is (a check that has
// stopped is said so), and the run on GitHub. It only reads (connect.yml's runs and their annotations): nothing is started or
// written here — mending is the tab's own 「封じて登録して確かめる」 under it.
import { h, link, failView } from './dom.mjs';
import * as D from '../lib/connectdaily.mjs';

const ICON = { ok: '✅ ', bad: '⚠️ ', stale: '⏸️ ', none: '❔ ' };
// (replaceChildren takes nodes, not lists or nulls)
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

/** the card. ctx: { api, lab: { slug }, now? (ms, tests) } → the element at once (「読んでいます…」), filled when read; el.ready:
 *  the promise of that reading (tests). A failure is said with the way on (failView) and 「もう一度読む」 */
export function connectDailyCard(ctx) {
  const body = h('div', { role: 'status' }, '読んでいます…');
  const el = h('div', { class: 'card connect-daily' }, h('h3', {}, '🔗 連携の毎日の確かめ'), body);
  const read = async () => {
    fill(body, '読んでいます…');
    try {
      const v = D.view(await D.readDaily(ctx.api, ctx.lab.slug), ctx.now ?? Date.now());
      fill(body,
        h('div', { class: v.tone === 'bad' ? 'bad' : v.tone === 'ok' ? 'ok' : 'muted', role: v.tone === 'bad' ? 'alert' : 'status' }, ICON[v.tone], v.head),
        v.lines.length ? h('ul', {}, v.lines.map((l) => h('li', { class: l.ok ? '' : 'bad' }, l.ok ? '✅ ' : '⚠️ ', `${l.name}: ${l.text}`, l.next ? h('div', { class: 'muted' }, `つぎに: ${l.next}`) : null))) : null,
        v.tone === 'bad' ? h('p', { class: 'muted' }, 'この下のそのサービスの「つなぐ」で、値を入れ直して確かめてください。') : null,
        h('div', { class: 'row muted' }, v.when ? `最後の確かめ: ${v.when}` : null, v.url ? [' ', link(v.url, 'GitHub で実行を見る')] : null),
        h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => read() }, 'もう一度読む')));
    } catch (e) {
      fill(body, failView(e, () => read()), h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => read() }, 'もう一度読む')));
    }
  };
  el.ready = read();
  return el;
}
