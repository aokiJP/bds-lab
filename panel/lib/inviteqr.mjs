// inviteqr (pure): what to hand someone just invited to the lab — GitHub's page where they accept (it is also what the QR code
// holds), the panel's address (only when it is a github.io page) and the first three steps — as lines and as markdown.
// No DOM, no fetch.

/** the roles in words a child can read */
export const ROLE_WORDS = { admin: '管理者', maintain: '保守', write: '書き込み', push: '書き込み', triage: '整理', read: '見るだけ', pull: '見るだけ' };
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** the panel's address when it is a https://….github.io/… page (else ''): nothing else is written into the words */
export function panelUrlOf(panelUrl) {
  try { const u = new URL(String(panelUrl ?? '')); return u.protocol === 'https:' && /\.github\.io$/.test(u.hostname) ? `${u.origin}${u.pathname}` : ''; } catch { return ''; }
}

/** inviteText({ slug, panelUrl, role, login }) → { url, lines, md }. url: GitHub's invitations page of the lab (for the QR);
 *  a slug that is not owner/repo → an Error in words */
export function inviteText({ slug, panelUrl, role, login } = {}) {
  if (!SLUG.test(String(slug ?? ''))) throw new Error('ラボの名前（owner/repo）が分かりません。先にラボを選んでください');
  const url = `https://github.com/${slug}/invitations`, panel = panelUrlOf(panelUrl), who = String(login ?? '').replace(/[^A-Za-z0-9-]/g, ''), rw = ROLE_WORDS[role];
  const lines = [
    `${who ? `${who} さん、` : ''}ラボ ${slug} に招きました${rw ? `（役割: ${rw}）` : ''}。`,
    `1. このページを開いて「Accept invitation」を押す: ${url}`,
    panel ? `2. パネルを開いて「Sign in with GitHub」でサインインする: ${panel}` : '2. 招いた人に、パネルのアドレスを聞いてサインインする',
    '3. 「何がしたい？」か「ガイド」を開いて、最初の 1 つを作る',
  ];
  return { url, lines, md: lines.map((l, i) => (i === 0 ? l : `- ${l}`)).join('\n') };
}
