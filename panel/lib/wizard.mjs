// wizard: 「何がしたい？」 for someone new — a few questions of 2-3 choices each ("作りたい・直したい・配りたい" and what
// comes next) that end at one place in the panel: a tab, the element to look at, and a sentence. Pure: no DOM, no fetch,
// no node:. The leaves only name tabs of the panel (panel.js TABS); resolve() turns a leaf into where to go now, or, when
// the tab is not there for this person (no lab, or the policy does not allow it), the reason and another way.

import { HELP } from './guide.mjs';
import { ACTION_WORDS } from './policy.mjs';
const NAME = (tab) => HELP[tab]?.title ?? tab;

// (a leaf: { tab, focus?, where?, say, need?, alt? } — focus: the id of the element to open at (for the page, never shown);
// where: the heading of that element as the person sees it; need: the policy action the place is for; alt: the leaf's key in
// LEAVES to go to instead when this one cannot be used)
export const LEAVES = Object.freeze({
  idea: { tab: 'start', focus: 'make', where: '💡 アイデアからアドオンを作る', say: '「実行」の「アイデアからアドオンを作る」に、作りたいものを書いてください。AI が作って、試験まで確かめます。', need: 'dispatch', alt: 'guide' },
  import: { tab: 'units', say: '「アドオン」で人の .mcaddon / .zip を取り込みます。取り込むと、試験もそこからできます。', alt: 'guide' },
  fresh: { tab: 'units', say: '「アドオン」で新しいアドオンを作ります。名前を決めると、土台の一式ができます。', alt: 'guide' },
  failed: { tab: 'runs', say: '「進み具合」で落ちた実行の「詳しく」を開くと、原因と直し方が言葉で出ます。', alt: 'guide' },
  edit: { tab: 'units', say: '「アドオン」で直したいアドオンを開き、ファイルを直すか「AI で変える」を使います。', alt: 'guide' },
  secret: { tab: 'secrets', say: '「秘密」で、パスワードや鍵を登録し直します。値は封じてから送られ、表示されません。', need: 'secrets.put', alt: 'connect' },
  link: { tab: 'releases', say: '「配布」の「リンクを写す」で、そのまま人に渡せます。', alt: 'guide' },
  notify: { tab: 'discord', say: '「Discord」で、実行が終わったときの知らせを送る先を決めます。まず「試しに送る」で確かめると安心です。', alt: 'guide' },
  invite: { tab: 'members', say: '「メンバー」で、一緒に使う人を招きます。招かれた人が受けると入れます。', need: 'members', alt: 'guide' },
  connect: { tab: 'connect', say: '「連携」で、Discord などをつなぎ直します。', alt: 'guide' },
  guide: { tab: 'overview', focus: 'guide', where: '🧭 はじめてのガイド', say: '「概要」の「はじめてのガイド」が、次にやることを順に教えてくれます。', alt: null },
});

// (a question: { ask, options: [{ id, label, next }] } — next: a question's key in ASKS, or a leaf's key in LEAVES with leaf: true)
export const ASKS = Object.freeze({
  root: { ask: '何がしたいですか？', options: [
    { id: 'make', label: '✨ 作りたい', ask: 'make' },
    { id: 'fix', label: '🔧 直したい', ask: 'fix' },
    { id: 'share', label: '📦 配りたい', ask: 'share' }] },
  make: { ask: 'どうやって作りますか？', options: [
    { id: 'idea', label: '💡 アイデアから、AI に作ってもらう', leaf: 'idea' },
    { id: 'import', label: '📥 人のアドオンを取り込む', leaf: 'import' },
    { id: 'fresh', label: '🆕 新しく一から作る', leaf: 'fresh' }] },
  fix: { ask: '何を直しますか？', options: [
    { id: 'failed', label: '❌ 落ちた実行の原因を知りたい', leaf: 'failed' },
    { id: 'edit', label: '📝 アドオンの中身を直したい', leaf: 'edit' },
    { id: 'secret', label: '🔑 秘密（パスワード・鍵）を入れ直したい', leaf: 'secret' }] },
  share: { ask: 'どうやって配りますか？', options: [
    { id: 'link', label: '🔗 リンクを人に渡す', leaf: 'link' },
    { id: 'notify', label: '🔔 Discord に知らせる', leaf: 'notify' },
    { id: 'invite', label: '👥 仲間を招く', leaf: 'invite' }] },
});

export const TREE = Object.freeze({ root: 'root', asks: ASKS, leaves: LEAVES });

/** path: the ids chosen so far (['make', 'idea']) → { ask, options: [{ id, label }], path } for the next question, or
 *  { go: leaf, key } at the end; { error } for a path that is not in the tree */
export function next(path = []) {
  let node = ASKS.root;
  const seen = [];
  for (const id of path) {
    const o = node?.options?.find((x) => x.id === id);
    if (!o) return { error: `「${id}」という選び方はありません。最初からやり直してください`, path: seen };
    seen.push(id);
    if (o.leaf) return seen.length === path.length ? { go: { ...LEAVES[o.leaf] }, key: o.leaf, path: seen } : { error: '行き先の先に質問はありません', path: seen };
    node = ASKS[o.ask];
  }
  return { ask: node.ask, options: node.options.map(({ id, label }) => ({ id, label })), path: seen };
}

/** a leaf → where to go for this person. ctx: { tabs: () => tab keys shown now, may: (action) => bool }
 *  → { tab, name, focus, where, say, key } or { …, why, from } when the first place cannot be used and another is offered
 *  or { why } alone when nothing can be */
export function resolve(key, ctx) {
  const seen = new Set();
  let k = key, why = null, from = null;
  while (k && !seen.has(k)) {
    seen.add(k);
    const leaf = LEAVES[k];
    if (!leaf) break;
    const shown = ctx.tabs().includes(leaf.tab);
    const allowed = !leaf.need || ctx.may(leaf.need);
    if (shown && allowed) return { tab: leaf.tab, name: NAME(leaf.tab), focus: leaf.focus ?? null, where: leaf.where ?? null, say: leaf.say, key: k, ...(why ? { why, from } : {}) };
    if (!why) {
      from = key;
      why = !shown ? `この画面には「${NAME(leaf.tab)}」のタブがありません（ラボにつながっていないか、あなたの役割では開けません）。` : `あなたの役割では「${ACTION_WORDS[leaf.need] ?? 'この操作をする'}」ことができません（管理者に、ポリシーで許してもらってください）。`;
    }
    k = leaf.alt;
  }
  return { why: why ?? 'いまは行ける場所がありません。ラボにサインインしているか確かめてください。' };
}
