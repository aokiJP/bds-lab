// units (the 「アドオン」 tab): the lab's units as they are on GitHub — each one's title, what it does, its version, how many
// tests it has and its newest .mcaddon — tested, finished into an .mcaddon, its files changed, or changed by AI, all with no
// computer of one's own (unit.yml and ai-make.yml on GitHub Actions); above them, a new one made and a person's addon taken in
// (ui/workspace.mjs). What GitHub lists is read once for the visit (lib/units.mjs); 「読み直す」 reads it again.
import { h, act, link } from './dom.mjs';
import * as U from '../lib/units.mjs';
import * as R from '../lib/releases.mjs';
import { fmtBytes } from '../lib/model.mjs';
import { newUnitCard, importCard, editorView, startUnit, startAttrs } from './workspace.mjs';

/** the 「アドオン」 tab. ctx: ui/workspace.mjs's (api, lab: { slug, repo, workflows? }, gate(action), guarded(action, detail,
 *  fn, done), go(tab), dispatch(workflow, inputs): GitHub's call alone — the guard is this tab's) and:
 *    runUnit?({ job: 'test' | 'go', unit })   the job started for the unit (none: startUnit — unit.yml on the lab's Actions)
 *    edit?(unit)                              the unit's files opened (none: the editor in this tab, editorView)
 *    aiMake?({ unit })                        「アイデアからアドオンを作る」 (ai-make.yml) opened with the unit to change
 *                                             filled in — unit: bds/<name>; none for a new one. What to change and AI's fees
 *                                             are asked there (none: no AI button)
 *  → a promise of the units shown */
export function unitsTab(body, ctx) {
  const slug = ctx.lab.slug, branch = ctx.lab.repo?.default_branch ?? 'main';
  // (the panel's own way to run a unit, else unit.yml here: its button off when the lab has none)
  const run = (x) => (ctx.runUnit ? ctx.runUnit(x) : startUnit(ctx, x)), g = ctx.runUnit ? ctx.gate?.('dispatch') ?? {} : startAttrs(ctx);
  const slot = h('div', { id: 'editor-slot' });
  const edit = ctx.edit ?? ((u) => { slot.replaceChildren(editorView({ ...ctx, closeEditor: () => slot.replaceChildren() }, u)); slot.scrollIntoView?.({ block: 'start' }); });
  const made = newUnitCard(ctx), taken = importCard(ctx);
  // (a card's form opened and brought into view: the words shown when there is no unit yet point at them)
  const open = (card) => { const d = card.querySelector?.('details'); if (d) d.open = true; card.scrollIntoView?.({ block: 'start' }); };
  const q = h('input', { type: 'search', placeholder: '探す（名前・題・説明）', 'aria-label': 'アドオンを探す' });
  const count = h('span', { class: 'muted grow' }), list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…'));
  let units = [], latest = {};
  const card = (u) => {
    const last = latest[u.ref], bds = u.kind === 'bds', a = last?.asset;
    return h('div', { class: 'card', 'data-unit': u.ref },
      h('h2', {}, u.title, bds ? null : h('span', { class: 'chip' }, U.KIND_WORDS[u.kind] ?? u.kind), u.version ? h('span', { class: 'chip' }, `v${u.version}`) : null,
        h('span', { class: u.tests ? 'chip' : 'chip bad' }, u.tests === null ? 'tests.txt なし' : `試験 ${u.tests}`)),
      u.description ? h('p', {}, u.description) : null,
      h('p', { class: 'muted' }, `${u.dir} · `, !last ? 'まだ配布はありません'
        : a ? [link(a.browser_download_url, `⬇ ${a.name}`), `（${fmtBytes(a.size ?? 0)}・${a.download_count ?? 0} 回）`] : link(last.release.html_url, `⬇ ${last.release.name || last.release.tag_name}`)),
      h('div', { class: 'row' },
        bds ? h('button', { ...g, onclick: () => run({ job: 'test', unit: u.name }) }, '🧪 試験') : null,
        bds ? h('button', { class: 'primary', ...g, onclick: () => run({ job: 'go', unit: u.name }) }, '📦 仕上げる（.mcaddon）') : null,
        bds ? h('button', { onclick: () => edit(u) }, '✏️ ファイルを直す') : null,
        ctx.aiMake ? h('button', { onclick: () => ctx.aiMake({ unit: u.ref }) }, '💡 AI で変える') : null,
        last ? h('button', { onclick: () => ctx.go('releases') }, '配布を見る') : null,
        link(`https://github.com/${slug}/tree/${branch}/${u.dir}`, 'GitHub')),
      bds ? null : h('p', { class: 'muted' }, '試験と仕上げは「AI で変える」から（AI が本物のサーバーで確かめます）。'));
  };
  const none = () => h('div', { class: 'card', id: 'nounits' }, h('h2', {}, 'まだアドオンがありません'),
    h('p', {}, '始め方は 3 つ。どれも手元の PC は要りません:'),
    h('ul', { class: 'plain' },
      h('li', { class: 'row' }, h('span', { class: 'grow' }, h('strong', {}, '💡 AI で作る'), h('div', { class: 'muted' }, 'やりたいことを日本語で書くだけ。AI が作って本物のサーバーで確かめ、リリースに届けます（ai-make）。')),
        h('button', { onclick: () => (ctx.aiMake ? ctx.aiMake({}) : ctx.go('start')) }, '開く')),
      h('li', { class: 'row' }, h('span', { class: 'grow' }, h('strong', {}, '🆕 新しく作る'), h('div', { class: 'muted' }, '名前と題を決めて、ひな形から。')), h('button', { onclick: () => open(made) }, '開く')),
      h('li', { class: 'row' }, h('span', { class: 'grow' }, h('strong', {}, '📥 取り込む'), h('div', { class: 'muted' }, '人のアドオン（.mcaddon・.mcpack・.zip）を直して仕上げる。')), h('button', { onclick: () => open(taken) }, '開く'))));
  const draw = () => {
    const shown = U.filterUnits(units, q.value);
    count.replaceChildren(`${shown.length} 件${units.length >= U.UNIT_LIMIT ? `（最初の ${U.UNIT_LIMIT} 件）` : ''}`);
    list.replaceChildren(...(!units.length ? [none()] : shown.length ? shown.map(card) : [h('p', { class: 'muted' }, '当てはまるアドオンがありません。')]));
  };
  q.addEventListener('input', draw);
  const load = (fresh = false) => act(async () => {
    // (not readable: why, where the list would be — and as a toast)
    const [us, rs] = await Promise.all([U.listUnits(ctx.api, slug, { fresh }).catch((e) => { list.replaceChildren(h('p', { class: 'bad' }, e.message)); throw e; }), R.listReleases(ctx.api, slug).catch(() => [])]);
    units = us; latest = R.latestByUnit(rs, us);
    draw();
    return units;
  });
  body.append(made, taken, slot,
    h('div', { class: 'card', id: 'units' }, h('h2', {}, `アドオン（${slug}）`),
      h('p', { class: 'muted' }, '「試験」は tests.txt を本物のサーバーとプレイヤーで、「仕上げる」は試験・QA のあと .mcaddon を作ります（unit.yml・「進み具合」で見られます。.mcaddon は実行の成果物に）。'),
      h('div', { class: 'row' }, q, h('button', { onclick: () => load(true) }, '読み直す'), count)),
    list);
  return load();
}
