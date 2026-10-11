// releases (the 「配布」 tab): what the lab has given out — its GitHub Releases, newest first, each file in them with its size
// and how many times it was downloaded, its link to pass on, a word to Discord (notify.yml) — and the totals (lib/releases.mjs).
import { h, toast, act, link } from './dom.mjs';
import * as R from '../lib/releases.mjs';
import { hasWorkflow } from '../lib/workspace.mjs';
import { fmtBytes, ago } from '../lib/model.mjs';
import { wayOut } from './workspace.mjs';

/** text to the clipboard (shown to copy by hand where the browser will not) */
const copy = (text, done) => navigator.clipboard?.writeText(text).then(() => toast(done), () => prompt('自動で写せませんでした。この文字を選んで、手で写してください', text)) ?? prompt('自動で写せませんでした。この文字を選んで、手で写してください', text);

/** the 「配布」 tab. ctx: { api, lab: { slug, workflows? (notify.yml looked for in it) }, gate(action), guarded(action, detail,
 *  fn, done), dispatch(workflow, inputs) (GitHub's call alone: the guard is this tab's), caps? ({ notify: { ok, need } }: the
 *  lab's settings, panel.js capsOf — Discord not set up: the button says what is missing) } → a promise of the releases shown */
export function releasesTab(body, ctx) {
  const slug = ctx.lab.slug, g = ctx.gate?.('dispatch') ?? {}, c = ctx.caps?.notify;
  const off = g.disabled ? g : !hasWorkflow(ctx.lab.workflows, 'notify.yml') ? { disabled: true, title: 'このラボには notify.yml がありません' } : c?.ok === false ? { disabled: true, title: c.need } : {};
  // (a button that is off says why where it can be read — a title is not seen on a phone — and the one step to turn it on)
  const why = g.disabled ? g.title : !hasWorkflow(ctx.lab.workflows, 'notify.yml') ? 'このラボには .github/workflows/notify.yml がありません: 「概要」でラボを新しくすると「Discord に知らせる」が使えます。'
    : c?.ok === false ? `Discord がまだ使えません（足りないもの: ${c.need}）: 「秘密」タブで入れると「Discord に知らせる」が使えます。` : '';
  const whyNote = why ? h('p', { class: 'warn' }, why, ' ', ctx.go && !g.disabled && c?.ok === false ? h('button', { onclick: () => ctx.go('secrets') }, '「秘密」を開く') : null) : null;
  const sum = h('div', { class: 'row', id: 'reltotals' }), list = h('div', {}, h('p', { class: 'muted' }, '読んでいます…'));
  const tell = (r) => ctx.guarded('dispatch', { workflow: 'notify.yml', release: String(r.tag_name ?? '') }, () => ctx.dispatch('notify.yml', { run: '', message: R.notifyMessage(r) }), 'Discord に知らせるよう頼みました（数十秒で届きます）');
  const card = (r) => {
    const files = r.assets ?? [];
    return h('div', { class: 'card', 'data-release': r.tag_name },
      h('h2', {}, r.name || r.tag_name, h('span', { class: 'chip' }, r.tag_name), r.draft ? h('span', { class: 'chip' }, '下書き') : null, r.prerelease ? h('span', { class: 'chip' }, 'プレリリース') : null,
        h('span', { class: 'muted' }, ago(r.published_at ?? r.created_at))),
      files.length ? h('ul', { class: 'plain' }, files.map((a) => h('li', { class: 'row', 'data-asset': a.name },
        h('span', { class: 'grow' }, R.isPack(a.name) ? '📦 ' : '📄 ', link(a.browser_download_url, a.name), h('span', { class: 'muted' }, ` ${fmtBytes(a.size ?? 0)}・${a.download_count ?? 0} 回`)),
        h('button', { onclick: () => copy(a.browser_download_url, `${a.name} のリンクを写しました`) }, '🔗 リンクを写す'))))
        : h('p', { class: 'muted' }, 'ファイルがありません。「GitHub で見る」でリリースを開き、.mcaddon を足すと、ここに出ます。'),
      h('div', { class: 'row' }, link(r.html_url, 'GitHub で見る'),
        // (a draft is no one's to take yet: nothing to tell)
        h('button', { ...(r.draft ? { disabled: true, title: '下書きは公開されていません: GitHub で公開してから知らせます' } : off), onclick: () => tell(r) }, '📨 Discord に知らせる')));
  };
  const load = () => act(async () => {
    // (not readable: why, where the list would be — and as a toast)
    const rs = R.newestFirst(await R.listReleases(ctx.api, slug).catch((e) => { list.replaceChildren(wayOut(e, ctx, () => load())); throw e; })), t = R.totals(rs);
    sum.replaceChildren(...[`リリース ${t.releases}`, `ファイル ${t.assets}（パック ${t.packs}）`, `ダウンロード ${t.downloads} 回`, `合わせて ${fmtBytes(t.bytes)}`].map((x) => h('span', { class: 'chip' }, x)));
    list.replaceChildren(...(rs.length ? rs.map(card) : [h('div', { class: 'card' }, h('p', { class: 'muted' }, 'まだリリースがありません。AI で作ったアドオン（ai-make）はリリースに届きます。「アドオン」の「仕上げる」の .mcaddon は、実行の成果物（「成果物」タブ）にあります。'),
      h('div', { class: 'row' }, ctx.go ? h('button', { onclick: () => ctx.go('units') }, '「アドオン」で作る') : null, link(`https://github.com/${slug}/releases/new`, 'GitHub でリリースを作る')))]));
    return rs;
  });
  body.append(h('div', { class: 'card', id: 'releases' }, h('h2', {}, `配布（${slug}）`),
    h('p', { class: 'muted' }, 'GitHub のリリースにあるものです（新しい 30 件）。リンクを写して遊ぶ人に渡すか、Discord に知らせます（notify.yml）。ダウンロードの数は GitHub が数えています。'),
    whyNote, sum, h('div', { class: 'row' }, h('button', { onclick: () => load() }, '読み直す'), link(`https://github.com/${slug}/releases`, 'GitHub のリリース'))), list);
  return load();
}
