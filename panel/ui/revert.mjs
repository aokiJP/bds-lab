// revert card: a file's history, and one click to take it back to a version. Choosing a version shows how it differs from now
// (lines added and removed); 「この版に戻す」 writes that text over the file as a new commit (the history stays), through
// ctx.guarded when the panel has it (the policy's check, the audit log).
import { h, act, failView } from './dom.mjs';
import * as R from '../lib/revert.mjs';

const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' '); };
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

/** ctx: { api, lab: { slug, repo, role }, me, policy, role, guarded?(action, detail, fn, done), record? }; { path: the file,
 *  branch?: the branch to look along and write to, onRestored?: called after a file was written back } → the card (an element) */
export function revertCard(ctx, { path, branch, onRestored } = {}) {
  const { api, lab } = ctx;
  const body = h('div', {}), detail = h('div', {}), root = h('div', { class: 'card', 'data-revert': path ?? '' }, h('h3', {}, `↩️ 前の版に戻す: ${path ?? ''}`), body, detail);
  let list = [];
  const load = async () => {
    fill(body, h('p', { class: 'muted' }, '履歴を読んでいます…'));
    try { list = await R.history(api, lab.slug, path, branch); } catch (e) { fill(body, failView(e, load), h('button', { onclick: load }, '読み直す')); return; }
    if (!list.length) { fill(body, h('p', { class: 'muted' }, 'このファイルの履歴はまだありません。ファイルを一度保存（commit）すると、ここから戻せます。')); return; }
    fill(body, h('ul', {}, list.map((c, i) => h('li', {}, h('button', { 'data-sha': c.sha, onclick: () => pick(c, i) }, `${R.shortSha(c.sha)}　${when(c.date)}　${c.author}　${c.message}`)))));
  };
  const pick = async (c, i) => {
    fill(detail, h('p', { class: 'muted' }, '今との違いを調べています…'));
    let old, now;
    try { [old, now] = await Promise.all([R.contentAt(api, lab.slug, path, c.sha), api.file(lab.slug, path, branch || undefined)]); } catch (e) { fill(detail, failView(e, () => pick(c, i))); return; }
    if (old === null) { fill(detail, h('p', { class: 'bad' }, 'この版にはこのファイルがありません。ほかの版を選んでください。')); return; }
    // (GitHub gives no text for a file over 1 MB: an empty version over a file with text is not written — it would empty it)
    if (old === '' && (now?.text ?? '') !== '') { fill(detail, h('p', { class: 'bad' }, 'この版の中身を読めませんでした（空か、大きすぎます）: 空で上書きしないよう、ここからは戻せません。GitHub の履歴から戻してください。')); return; }
    const d = R.lineDiff(now?.text ?? '', old), same = now?.text === old;
    const why = same ? '今と同じ中身です（戻す必要はありません）' : null;
    const go = h('button', {
      class: 'primary', disabled: same, title: why ?? '',
      onclick: async () => {
        const run = () => R.restore(api, lab.slug, path, c.sha, branch);
        const done = `${path} を ${R.shortSha(c.sha)} の版に戻しました（新しい commit として）`;
        const r = ctx.guarded ? await ctx.guarded('dispatch', { file: path, sha: R.shortSha(c.sha) }, run, done) : await act(run, done);
        if (r === undefined) return;
        // (guarded keeps it in the audit log already: once)
        if (!ctx.guarded) ctx.record?.('revert', { file: path, sha: R.shortSha(c.sha), changed: r.changed });
        fill(detail, h('p', {}, r.changed ? `戻しました。次は「試す」で確かめましょう。` : '今と同じ中身だったので、何も変えていません。'));
        onRestored?.(r); load();
      },
    }, 'この版に戻す');
    fill(detail, h('p', {}, `${R.shortSha(c.sha)} の版にすると: ${d.added} 行増え、${d.removed} 行減ります。`), why ? h('p', { class: 'muted' }, why) : null, go);
  };
  load();
  return root;
}
