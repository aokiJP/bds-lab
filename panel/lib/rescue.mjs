// rescue: no dead end in the panel. Whatever went wrong — the network, GitHub's answer, this sign-in's rights, the lab's own
// state — becomes plain words and the one next step (pure: the page draws it). { why: what happened, in words a child can
// follow; next: what to do, one line; action: { label, link } (GitHub's page for it) | { label, kind: 'retry' | 'signin' |
// 'reload' } (the page does it) | null; wait: ms until it is worth trying again (the rate limit) }
import { moreRights, installUrl } from './setup.mjs';

const RATE = /rate limit|secondary rate|abuse/i, SAML = /SAML|single sign-on|SSO/i, ACTIONS_OFF = /actions (is|are) disabled|actions has been disabled/i;
const mins = (ms) => Math.max(1, Math.ceil(ms / 60_000));
/** e: what was thrown (lib/gh.mjs's GhError: status, message, path, reset — or anything); ctx: { owner, isOrg, appSlug,
 *  signedInWithApp, lab, now, online } → { why, next, action, wait } */
export function rescue(e, ctx = {}) {
  const status = Number(e?.status ?? NaN), msg = String(e?.message ?? e ?? ''), now = ctx.now ?? Date.now();
  const retry = { label: 'もう一度', kind: 'retry' }, more = moreRights(ctx);
  if (ctx.online === false || status === 0 || (!Number.isFinite(status) && /fetch|network|Failed to fetch|NetworkError|Load failed/i.test(msg))) return { why: 'インターネットにつながっていません', next: 'Wi-Fi や電波を確かめて、つながったら「もう一度」', action: retry, wait: 0 };
  if (status === 401) return { why: 'サインインの期限が切れたか、トークンが取り消されました', next: '「入り直す」を押して、もう一度サインインしてください', action: { label: '入り直す', kind: 'signin' }, wait: 0 };
  if ((status === 403 || status === 429) && RATE.test(msg)) {
    const wait = Number.isFinite(Number(e?.reset)) && Number(e.reset) > 0 ? Math.max(0, Number(e.reset) * 1000 - now) : 60_000;
    return { why: 'GitHub に短い時間にたくさん頼みすぎました（回数の上限）', next: `あと約 ${mins(wait)} 分で使えます。待ってから「もう一度」`, action: retry, wait };
  }
  if (status === 403 && SAML.test(msg)) return { why: '組織のシングルサインオン（SAML）で、このトークンがまだ許されていません', next: 'GitHub のトークンの画面で、組織の「Configure SSO」→「Authorize」を押してください', action: { label: 'トークンの画面（GitHub へ）', link: ctx.signedInWithApp ? 'https://github.com/settings/applications' : 'https://github.com/settings/personal-access-tokens' }, wait: 0 };
  if (status === 403 && ACTIONS_OFF.test(msg)) return { why: 'このリポジトリでは GitHub Actions が止められています', next: 'Settings → Actions で「Allow all actions」を選んで保存してください', action: ctx.lab ? { label: 'Actions の設定（GitHub へ）', link: `https://github.com/${ctx.lab}/settings/actions` } : null, wait: 0 };
  if (status === 403) return { why: `このサインインには、その操作の権限がありません${msg ? `（${msg}）` : ''}`, next: more.how, action: { label: more.label, link: more.link }, wait: 0 };
  if (status === 404) {
    if (ctx.signedInWithApp && installUrl(ctx.appSlug)) return { why: '見つからないか、ラボの App がそのリポジトリに入っていません', next: 'App をそのリポジトリに入れてから、もう一度', action: { label: 'App を入れる（GitHub へ）', link: installUrl(ctx.appSlug) }, wait: 0 };
    return { why: '見つからないか、このトークンでは見えません', next: `${ctx.signedInWithApp ? '' : 'トークンの Repository access にラボ（と貸し借りのホスト）が入っているか確かめてください。'}${more.how}`, action: { label: more.label, link: more.link }, wait: 0 };
  }
  if (status === 409) return { why: 'ほかの人（か別のタブ）が先に同じものを変えました', next: '「読み直す」で今の中身にしてから、もう一度', action: { label: '読み直す', kind: 'reload' }, wait: 0 };
  if (status === 422) return { why: `GitHub が受け付けませんでした${msg ? `（${msg}）` : ''}`, next: '入れた中身（名前・空の欄・長さ）を確かめて、もう一度', action: retry, wait: 0 };
  if (status >= 500) return { why: 'GitHub の側で一時的な不具合が起きています', next: '少し待ってから「もう一度」（続くときは GitHub の状況のページ githubstatus を）', action: retry, wait: 30_000 };
  return { why: msg || '思わぬことが起きました', next: '「もう一度」を押してください。続くときは、この文を写して作者に知らせてください', action: retry, wait: 0 };
}
