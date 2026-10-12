// notifyprefs (a card): who hears what — 落ちた・通った・リリース・週報・連携の不調・秘密の古さ — member by member. Everyone
// switches their own row; an administrator all of them. Kept in the lab's default branch (.github/bds-lab-notify.json:
// lib/notifyprefs.mjs), written with the sha read, so it is the same kind of write as the lab's other settings
// (the policy's 「変数」 = variables), kept in the audit log.
import { h, failView } from './dom.mjs';
import * as N from '../lib/notifyprefs.mjs';

const said = (text, e) => Object.assign(new Error(text), { status: e?.status, reset: e?.reset });
// (a change made elsewhere: GitHub's 409 "is at <sha> but expected <sha>" or a 422 about the sha — not a protected branch's or a
// ruleset's 409 "Repository rule violations": that one is said as it is, reading again would never get past it)
const staleSha = (e) => (e?.status === 409 || e?.status === 422) && !/rule/i.test(e?.message ?? '') && /\bsha\b|but expected|does not match/i.test(e?.message ?? '');

/** ctx: { api (file, putFile), lab: { slug, role }, me: { login }, members? (logins to list besides the file's), may(action),
 *  guarded(action, detail, fn, done) } → an element that fills itself */
export function notifyPrefsCard(ctx) {
  const { api, lab } = ctx, me = String(ctx.me?.login ?? ''), admin = lab.role === 'admin';
  const box = h('div', { class: 'card', 'data-card': 'notifyprefs' });
  const st = { prefs: N.defaultPrefs(), sha: null, broken: false };
  const canWrite = Boolean(ctx.may?.('variables'));
  const mayEdit = (login) => canWrite && (admin || login.toLowerCase() === me.toLowerCase());
  const why = (login) => (!canWrite ? '役割に「変数」を変える力が要ります（管理者に頼んでください）' : mayEdit(login) ? null : '自分の行だけ変えられます（管理者は全員分）');

  const logins = () => {
    const seen = new Map();
    for (const l of [me, ...(ctx.members ?? []), ...Object.keys(st.prefs.members)]) if (l && !seen.has(l.toLowerCase())) seen.set(l.toLowerCase(), l);
    return [...seen.values()].filter((l) => admin || l.toLowerCase() === me.toLowerCase());
  };

  /** prefs written with the sha read → true when done; a change made elsewhere is read again, nothing written over it */
  const save = async (next, message, detail) => {
    let stale = false;
    const r = await ctx.guarded('variables', { file: N.NOTIFY_FILE, ...detail },
      () => api.putFile(lab.slug, N.NOTIFY_FILE, N.prefsText(next), st.sha ?? undefined, `panel: 通知の設定 — ${message}`).catch((e) => {
        if (staleSha(e)) { stale = true; throw said('別の人が先に通知の設定を変えました。読み直しました: もう一度切り替えてください', e); }
        throw e;
      }), '通知の設定を保存しました');
    if (r === undefined) { if (stale) await load(); else draw(); return false; }
    st.prefs = next; st.sha = r?.content?.sha ?? st.sha; st.broken = false;
    if (!st.sha) await load(); else draw();
    return true;
  };

  const row = (login) => {
    const t = why(login), kinds = N.kindsOf(st.prefs, login), has = st.prefs.members[login];
    const own = Object.keys(st.prefs.members).find((x) => x.toLowerCase() === login.toLowerCase());
    return h('li', { class: 'row', 'data-login': login },
      h('b', {}, login, login.toLowerCase() === me.toLowerCase() ? '（自分）' : ''),
      ' ', N.KINDS.map((k) => h('label', { title: t ?? N.KIND_WORDS[k] },
        h('input', { type: 'checkbox', 'data-kind': k, checked: kinds.includes(k), disabled: Boolean(t), 'aria-label': `${login}: ${N.KIND_WORDS[k]}`,
          onchange: (ev) => { const on = ev.target.checked; try { return save(N.setPref(st.prefs, own ?? login, k, on), `${login} ${N.KIND_WORDS[k]} ${on ? '入' : '切'}`, { user: login, kind: k, on }); } catch (e) { ev.target.checked = !on; box.append(failView(e)); return undefined; } } }),
        ' ', N.KIND_WORDS[k], ' ')),
      // (their Discord user id: the Webhook's message calls them by it — <@id> — for the kinds ticked; empty: not called)
      (() => {
        const id = h('input', { type: 'text', inputmode: 'numeric', 'data-discord': login, value: has?.discord ?? '', placeholder: 'Discord のユーザー ID（数字）', 'aria-label': `${login}: Discord のユーザー ID`, disabled: Boolean(t) });
        const keep = () => { const v = id.value.trim(); try { return save(N.setPref(st.prefs, own ?? login, null, false, v || null), `${login} の Discord の ID を${v ? '入れる' : '消す'}`, { user: login, discord: v ? 'set' : 'removed' }); } catch (e) { box.append(failView(e)); return undefined; } };
        return h('span', { class: 'row' }, ' ', id, h('button', { type: 'button', disabled: Boolean(t), title: t ?? 'Discord で開発者モードを入れ、自分の名前を右クリック →「ユーザー ID をコピー」', onclick: keep }, 'ID を記録'));
      })(),
      has ? null : h('span', { class: 'muted' }, ' まだ選んでいません（いまは初めの設定: ' + N.DEFAULT_KINDS.map((k) => N.KIND_WORDS[k]).join('・') + '）'),
      t ? h('p', { class: 'muted' }, t) : null);
  };

  const draw = () => box.replaceChildren(...[
    h('h3', {}, '🔔 通知の設定'),
    h('p', { class: 'muted' }, '誰が何を知らせてほしいかを、チェックで選びます。リポジトリの ' + N.NOTIFY_FILE + ' に残ります。'),
    st.broken ? h('p', { class: 'warn' }, `いまの ${N.NOTIFY_FILE} は読めません。切り替えて保存すると、ここの設定で置き換わります。`) : null,
    h('ul', { class: 'plain' }, logins().map(row))].filter(Boolean));

  async function load() {
    box.replaceChildren(h('p', { class: 'muted' }, '読んでいます…'));
    try {
      const f = await api.file(lab.slug, N.NOTIFY_FILE);
      st.sha = f?.sha ?? null; st.broken = false;
      if (f) { try { st.prefs = N.parsePrefs(f.text); } catch { st.prefs = N.defaultPrefs(); st.broken = true; } } else st.prefs = N.defaultPrefs();
      draw();
    } catch (e) { box.replaceChildren(failView(e, load), h('button', { onclick: () => load() }, '読み直す')); }
  }
  load();
  return box;
}
