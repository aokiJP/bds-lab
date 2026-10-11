// signin: the panel's door. With a sign-in service in the config (authUrl): 「GitHub でサインイン」 at the top — the lab's
// GitHub App decides what this person may use, nothing to make by hand — and below it, folded, the way in with a token typed
// in (the first setup, or no service). Without one: the token's way alone, open, in the same words as before. The token form
// keeps its ids (#tok #lab #rem #go: tests/panel-browser.mjs fills them). The card only asks; the caller signs in.
import { h, link, toast } from './dom.mjs';
import { SLUG } from '../lib/model.mjs';
import { tokenUrl as tokenLink } from '../lib/setup.mjs';

const CLASSIC = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=bds-lab%20panel';
/** where to make a token, and which (the same words as the settings tab's) */
export const tokenHelp = (owner) => h('div', {},
  h('p', {}, link(tokenLink(owner), 'トークンを作る（Fine-grained）'), ' — 対象のリポジトリ: ラボと、貸し借りのホスト。権限: Actions・Contents・Secrets・Variables・Issues・Pages・Administration（メンバー）は Read and write、Pull requests は Read'),
  h('p', { class: 'muted' }, 'Fine-grained トークンが選べるのは 1 つの持ち主（自分か、入っている組織）のリポジトリだけです。ほかの人の個人アカウントにあるホストを借りるときは ', link(CLASSIC, 'Classic トークン（repo・workflow）'), ' を使ってください。'));

/** the sign-in card → an element. authUrl: the service's address (none: tokens only); err: why the last try failed;
 *  adding: another account; login: that account again; lab: the lab's repository to start with;
 *  onOAuth({ remember, lab }): to GitHub; onToken({ token, lab, remember }): a token typed in; back: to where one was */
export function signInCard({ authUrl = null, err = '', adding = false, login = null, lab = '', onOAuth, onToken, back = null } = {}) {
  const owner = String(lab ?? '').split('/')[0];
  const t = h('input', { type: 'password', id: 'tok', autocomplete: 'off', placeholder: 'github_pat_… / ghp_…' }), labIn = h('input', { type: 'text', id: 'lab', value: lab ?? '' }), rem = h('input', { type: 'checkbox', id: 'rem', checked: true });
  // (a mistake found before anything is sent: the toast, and under the fields what to put instead)
  const sayer = () => { const el = h('p', { class: 'bad' }); return [el, (text, hint) => { el.textContent = `${text}: ${hint}`; toast(text, true); }]; };
  const [fix, no] = sayer(), [fixO, noO] = sayer();
  const backBtn = () => (back ? h('button', { onclick: () => back() }, '戻る') : null);
  const intro = (who) => h('p', {}, `このパネルは、ラボのリポジトリに書き込める人と、GitHub Actions の時間を貸している・借りている人だけが使えます。見えるもの・できることは、${who}に GitHub が許していることだけです。`);
  const tokenForm = [
    h('p', { class: 'muted' }, 'トークンはこのブラウザの中だけに置き、GitHub の API にだけ送ります（このページはほかのどこにも通信できません）。作者・貸し手・借り手など、いくつかのアカウントを加えて上で切り替えられます（それぞれのトークンと設定で）。'),
    tokenHelp(owner),
    h('label', { for: 'tok' }, 'トークン'), t,
    h('label', { for: 'lab' }, 'ラボのリポジトリ（owner/名前）'), labIn,
    h('label', {}, rem, ' このブラウザに覚える（共有の端末では外す: このタブを閉じると忘れます）'),
    fix,
    !authUrl && err ? [h('p', { class: 'bad' }, err), h('p', {}, '入れなおしても入れないときは、トークンを作り直してください: ', link(tokenLink(owner), 'トークンを作る（GitHub へ）'))] : null,
    h('div', { class: 'row' }, h('button', { class: authUrl ? null : 'primary', id: 'go', onclick: () => {
      const v = t.value.trim(), l = labIn.value.trim();
      if (!v) return no('トークンを入れてください', '上の「トークンを作る」で作って、ここに貼り付けてください');
      if (!SLUG.test(l)) return no('ラボのリポジトリは owner/名前 で', '例: myname/bds-lab（GitHub のアドレスの github.com/ のあとの 2 つ）');
      return onToken?.({ token: v, lab: l, remember: rem.checked });
    } }, adding ? '加える' : '入る'), authUrl ? null : backBtn()),
  ];
  const folded = (open) => h('details', { open }, h('summary', {}, 'トークンで入る（最初の設定・サービスが無いとき）'), ...tokenForm);
  if (!authUrl) return h('div', { class: 'card' }, h('h2', {}, adding ? 'アカウントを加える' : login ? `${login} のトークンを入れ直す` : 'GitHub のトークンで入る'), intro('あなたのトークン'), folded(true));
  // (the two forms' lab fields follow each other: whichever way is taken, the lab typed is the one used)
  const oLab = h('input', { type: 'text', id: 'oauth-lab', value: lab ?? '', oninput: () => { labIn.value = oLab.value; } }), oRem = h('input', { type: 'checkbox', id: 'oauth-rem', checked: true });
  labIn.addEventListener('input', () => { oLab.value = labIn.value; });
  return h('div', { class: 'card' },
    h('h2', {}, adding ? 'アカウントを加える' : login ? `${login} でもう一度サインイン` : 'GitHub でサインイン'),
    intro('あなた'),
    h('p', { class: 'muted' }, '使えるリポジトリは、ラボの GitHub App を入れたところから自動で決まります（トークンを作る必要はありません）。サインインのトークンはこのブラウザの中だけに置きます。'),
    h('label', { for: 'oauth-lab' }, 'ラボのリポジトリ（owner/名前）'), oLab,
    h('label', {}, oRem, ' このブラウザに覚える（共有の端末では外す: このタブを閉じると忘れます）'),
    fixO,
    err ? [h('p', { class: 'bad' }, err), h('p', {}, 'もう一度「GitHub でサインイン」を押すか、下の「トークンで入る」から入れます。')] : null,
    h('div', { class: 'row' }, h('button', { class: 'primary', id: 'oauth', onclick: () => {
      const l = oLab.value.trim();
      if (!SLUG.test(l)) return noO('ラボのリポジトリは owner/名前 で', '例: myname/bds-lab（GitHub のアドレスの github.com/ のあとの 2 つ）');
      return onOAuth?.({ remember: oRem.checked, lab: l });
    } }, 'GitHub でサインイン'), backBtn()),
    folded(false));
}
