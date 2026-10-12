// inviteqr (a card): what to give someone just invited — a QR code of GitHub's invitation page, a few words (the panel's address,
// the first three steps) and a button that copies them. Only read (the invitation itself is made in 「メンバー」); with no
// invitation yet it says to invite first; when the list cannot be read (only administrators may), it never says "none yet".
import { h, act, failView } from './dom.mjs';
import { qrCard } from './qr.mjs';
import * as I from '../lib/inviteqr.mjs';
import * as MB from '../lib/members.mjs';

/** ctx: { api, lab: { slug, repo }, panelUrl?, clipboard? } · who: { login, role } (no login: whoever was invited last) → an element */
export function inviteQrCard(ctx, { login, role } = {}) {
  const body = h('div', {}, h('p', { class: 'muted', role: 'status' }, '招待を調べています…'));
  const card = h('div', { class: 'card', 'data-card': 'inviteqr' }, h('h3', {}, '📨 招いた人に渡すもの'), body);
  async function draw() {
    body.replaceChildren(h('p', { class: 'muted', role: 'status' }, '招待を調べています…'));
    try {
      // (the invitations as GitHub lists them — only an administrator may read them: GitHub answers 403/404 to anyone else, and
      // then nothing is known — not "none yet". Read here, not through readMembers, which takes a refusal as an empty list)
      let list = null;
      try { list = (await ctx.api.call('GET', `/repos/${ctx.lab.slug}/invitations?per_page=100`)) ?? []; } catch (e) { if (e?.status !== 403 && e?.status !== 404) throw e; }
      if (!list && !login) { body.replaceChildren(h('p', { class: 'warn' }, '管理者だけが招待の一覧を見られます。招いた人の GitHub のユーザー名が分かれば、その人に渡す QR と文が出せます。'), h('button', { onclick: () => draw() }, '調べ直す')); return; }
      // (no login: whoever was invited last — the newest created_at, whatever order GitHub lists them in)
      const mine = (list ?? []).map((i) => ({ login: i.invitee?.login ?? '?', permission: i.permissions, at: String(i.created_at ?? '') }))
        .filter((i) => !login || String(i.login).toLowerCase() === String(login).toLowerCase()).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      if (list && !mine.length) { body.replaceChildren(h('p', { class: 'warn' }, `${login ? `${login} への` : ''}招待がまだありません。先に「メンバー」で GitHub のユーザー名を入れて招いてください。招くと、ここに QR と文が出ます。`), h('button', { onclick: () => draw() }, '調べ直す')); return; }
      // (the list unreadable but the login known: the QR and words all the same — GitHub's page itself shows the invitation, or none)
      const who = login || mine[0].login, t = I.inviteText({ slug: ctx.lab.slug, panelUrl: ctx.panelUrl, role: role ?? MB.roleOfPermission(mine[0]?.permission), login: who });
      const note = list ? null : h('p', { class: 'muted' }, '招待の一覧は管理者だけが見られます。招待が届いているかは、QR の GitHub のページを開くと分かります。');
      body.replaceChildren(...(note ? [note] : []), qrCard(ctx, t.url, `${who} さんがスマホで招待を受ける`), h('pre', { 'aria-label': '招いた人に渡す文' }, t.md),
        h('button', { class: 'primary', onclick: () => act(async () => {
          const clip = ctx.clipboard ?? globalThis.navigator?.clipboard;
          if (!clip?.writeText) throw new Error('このブラウザでは写せません: 上の文を選んで写してください');
          await clip.writeText(t.md);
        }, '渡す文を写しました') }, '📋 文を写す'));
    } catch (e) { body.replaceChildren(failView(e, draw)); }
  }
  draw();
  return card;
}
