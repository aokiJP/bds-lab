// inviteqr (a card): what to give someone just invited — a QR code of GitHub's invitation page, a few words (the panel's address,
// the first three steps) and a button that copies them. Only read (the invitation itself is made in 「メンバー」); with no
// invitation yet it says to invite first.
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
      const m = await MB.readMembers(ctx.api, ctx.lab.slug, ctx.lab.repo), mine = (m.invitations ?? []).filter((i) => !login || String(i.login).toLowerCase() === String(login).toLowerCase());
      if (!mine.length) { body.replaceChildren(h('p', { class: 'warn' }, `${login ? `${login} への` : ''}招待がまだありません。先に「メンバー」で GitHub のユーザー名を入れて招いてください。招くと、ここに QR と文が出ます。`), h('button', { onclick: () => draw() }, '調べ直す')); return; }
      const who = login || mine[0].login, t = I.inviteText({ slug: ctx.lab.slug, panelUrl: ctx.panelUrl, role: role ?? MB.roleOfPermission(mine[0].permission), login: who });
      body.replaceChildren(qrCard(ctx, t.url, `${who} さんがスマホで招待を受ける`), h('pre', { 'aria-label': '招いた人に渡す文' }, t.md),
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
