// undo card: one entry of the audit log taken back (lib/undo.mjs) — what it is now and what it would be after, line by line
// for a file and value by value for a variable, then 「この変更を取り消す」 through ctx.guarded with the policy's action for
// what is written (a variable: variables; the policy's file: members; the timetable: dispatch; who hears what: variables), so
// the undo is asked again when the policy wants and kept in the audit log too. Meant beside each row of the 「監査」 tab.
import { h, failView } from './dom.mjs';
import * as U from '../lib/undo.mjs';
import * as P from '../lib/policy.mjs';

const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const SHOW = 20;
const shown = (v) => (v === null || v === undefined ? '（無し）' : v === '' ? '（空）' : v);
const lines = (xs, mark, cls) => [xs.slice(0, SHOW).map((l) => h('div', { class: cls }, `${mark} ${l}`)), xs.length > SHOW ? h('div', { class: 'muted' }, `ほか ${xs.length - SHOW} 行`) : null];

/** ctx: { api, lab: { slug }, guarded(action, detail, fn, done), may?(action), onUndone?(result) }; entry: one of the audit log's
 *  entries (lib/audit.mjs) → the card (an element that fills itself) */
export function undoCard(ctx, entry) {
  const { api, lab } = ctx;
  const u = U.undoable(entry);
  const what = u.kind === 'file' ? U.UNDO_FILES[u.path]?.words ?? u.path : u.kind === 'variable' ? `変数 ${u.name}` : 'この変更';
  const body = h('div', {}), root = h('div', { class: 'card', 'data-undo': entry?.id ?? entry?.at ?? '' }, h('h3', {}, `↩️ 取り消す: ${what}`), body);
  const no = (why) => fill(body, h('p', { class: 'muted' }, why), h('button', { disabled: true, title: why }, 'この変更を取り消す'));
  const load = async () => {
    if (!u.ok) return no(u.why);
    fill(body, h('p', { class: 'muted' }, '今の中身と、取り消した後を調べています…'));
    let p;
    try { p = await U.prepare(api, lab.slug, entry); } catch (e) { fill(body, failView(e, load), h('button', { onclick: load }, '読み直す')); return undefined; }
    if (!p.ok) return no(p.why);
    let diff;
    if (p.kind === 'variable') diff = [h('p', {}, `今: ${shown(p.now)}`), h('p', {}, `取り消した後: ${shown(p.before)}`)];
    else {
      const c = U.lineChanges(p.now, p.before);
      diff = [h('p', {}, `${p.path} を ${U.shortSha(p.commit?.sha)} の前の版にすると: ${c.added.length} 行増え、${c.removed.length} 行減ります。`),
        h('div', { class: 'diff' }, lines(c.removed, '−', 'bad'), lines(c.added, '+', 'good'))];
    }
    const why = p.same ? '今と同じです（取り消す必要はありません）'
      : p.problems?.length ? `前の版に誤りがあるので戻せません: ${p.problems.join('・')}`
        : !ctx.guarded ? 'ここでは取り消せません（監査ログに残せないため）'
          : ctx.may && !ctx.may(p.action) ? `この役割では取り消せません（「${P.ACTION_WORDS[p.action] ?? p.action}」の力が要ります。管理者に頼んでください）` : null;
    const go = h('button', {
      class: 'primary', disabled: Boolean(why), title: why ?? '',
      onclick: async () => {
        if (why) return;
        const detail = p.kind === 'file' ? { file: p.path } : { name: p.name };
        const done = p.kind === 'file' ? `${what}を ${U.shortSha(p.commit?.sha)} の前に戻しました（新しい commit として）` : `変数 ${p.name} を前の値に戻しました`;
        const r = await ctx.guarded(p.action, detail, () => U.apply(api, lab.slug, p), done);
        if (r === undefined) return;
        ctx.onUndone?.(r);
        await load();
        body.prepend(h('p', {}, r.changed ? '取り消しました。監査ログにも残りました。' : '今と同じだったので、何も変えていません。'));
      },
    }, 'この変更を取り消す');
    fill(body, diff, why ? h('p', { class: 'muted' }, why) : null, go);
    return p;
  };
  load();
  return root;
}
