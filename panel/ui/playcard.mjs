// playcard (「🎮 遊び方カード」): a unit's card for the people who play it — what it does, the commands to type and the items —
// from its TASK.md, tests.txt and bp/manifest.json on the default branch (lib/playcard.mjs; read with the person's own sign-in
// through api.file, nothing written), in Japanese or English, with 「Markdown を写す」 for a release's notes or a post. A part on
// its own: the tab that shows a unit (or a release) puts playcardCard(ctx, unit) where it wants it; readPlaycard gives the
// Markdown alone (a release's body).
import { h, toast, failView } from './dom.mjs';
import { playcard } from '../lib/playcard.mjs';
import { KINDS, isUnitName } from '../lib/units.mjs';

const FILES = ['TASK.md', 'tests.txt', 'bp/manifest.json'];
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
/** text to the clipboard (shown to copy by hand where the browser will not) */
const copy = (text, done) => globalThis.navigator?.clipboard?.writeText(text).then(() => toast(done), () => globalThis.prompt?.('自動で写せませんでした。この文字を選んで、手で写してください', text)) ?? globalThis.prompt?.('自動で写せませんでした。この文字を選んで、手で写してください', text);

/** a unit's card read from GitHub → playcard's { title, what, commands, items, md } and found: the files that were there.
 *  unit: { name, kind? ('bds'), dir? } (a unitSummary); ref: a branch or tag (else the default branch); lang 'ja' | 'en' */
export async function readPlaycard(ctx, unit, { lang = 'ja', ref } = {}) {
  const f = await readFiles(ctx, unit, ref);
  return { ...playcard({ ...f, lang }), found: f.found, dir: f.dir };
}
// (the three files' texts, null where there is none)
async function readFiles(ctx, unit, ref) {
  if (!isUnitName(unit?.name)) throw new Error(`「${String(unit?.name ?? '')}」はユニットの名前ではありません（英小文字で始まる、英小文字・数字・_ の 2〜40 字）`);
  const dir = `${(KINDS.find((k) => k.kind === (unit.kind ?? 'bds')) ?? KINDS[0]).dir}/${unit.name}`;
  const [task, tests, manifest] = await Promise.all(FILES.map((f) => ctx.api.file(ctx.lab.slug, `${dir}/${f}`, ref).then((x) => x?.text ?? null)));
  return { task, tests, manifest, found: FILES.filter((_, i) => [task, tests, manifest][i] !== null), dir };
}

/** the 「🎮 遊び方カード」 card for a unit → an element, filled once the three files are read. ctx: { api (lib/gh.mjs), lab: { slug } }
 *  (as the other tabs'); unit: { name, kind? } */
export function playcardCard(ctx, unit) {
  const box = h('div', { class: 'card', 'data-playcard': String(unit?.name ?? '') }, h('h2', {}, '🎮 遊び方カード'), h('p', { class: 'muted', role: 'status' }, '読んでいます…'));
  let lang = 'ja', files = null;
  const draw = (c) => {
    const empty = !c.what && !c.commands.length && !c.items.length;
    const copyBtn = h('button', { class: 'primary', disabled: empty, title: empty ? '書くことがまだありません: 下の「埋め方」のとおりに TASK.md か tests.txt を書くと押せます' : null, onclick: () => copy(c.md, 'Markdown を写しました（リリースの本文などに貼れます）') }, 'Markdown を写す');
    const langBtn = h('button', { onclick: () => { lang = lang === 'ja' ? 'en' : 'ja'; show(); } }, lang === 'ja' ? 'English' : '日本語');
    fill(box, h('h2', {}, '🎮 遊び方カード', c.title ? h('span', { class: 'chip' }, c.title) : null),
      h('p', { class: 'muted' }, '遊ぶ人向けの短い説明です。TASK.md・tests.txt・bp/manifest.json から作ります。'),
      empty ? h('div', { class: 'muted', 'data-empty': '' }, h('p', {}, 'まだ書くことがありません。埋め方:'), h('ul', {},
        h('li', {}, `${c.dir}/TASK.md の最初の段落に、何ができるかを 1〜2 文で`),
        h('li', {}, `${c.dir}/tests.txt に、使うコマンドを「@A cmd /ns:名前」、もらうアイテムを「give A ns:名前」の行で`)))
        : [h('h3', {}, lang === 'ja' ? '何ができるか' : 'What it does'), h('p', {}, c.what || (lang === 'ja' ? '（TASK.md の最初の段落に書くと出ます）' : '(write it in the first paragraph of TASK.md)')),
          h('h3', {}, lang === 'ja' ? 'コマンド' : 'Commands'),
          c.commands.length ? h('ul', { class: 'plain' }, c.commands.map((x) => h('li', { 'data-cmd': x.cmd }, h('code', {}, x.cmd), ' — ', x.say)))
            : h('p', { class: 'muted' }, 'コマンドはありません（tests.txt に「@A cmd /ns:名前」の行があると出ます）'),
          h('h3', {}, lang === 'ja' ? 'アイテム' : 'Items'),
          c.items.length ? h('ul', { class: 'plain' }, c.items.map((x) => h('li', { 'data-item': x }, h('code', {}, x))))
            : h('p', { class: 'muted' }, 'アイテムはありません（tests.txt に「give A ns:名前」の行があると出ます）')],
      h('details', {}, h('summary', {}, '📋 Markdown を見る'), h('pre', {}, c.md)),
      h('div', { class: 'row' }, copyBtn, langBtn));
  };
  // (the language changed: drawn again from what was read, not read again)
  const show = () => { const c = { ...playcard({ ...files, lang }), found: files.found, dir: files.dir }; draw(c); return c; };
  const load = async () => {
    try { files = await readFiles(ctx, unit); return show(); } catch (e) {
      fill(box, h('h2', {}, '🎮 遊び方カード'), h('p', { class: 'muted' }, 'カードを作れませんでした。'), failView(e, () => load()), h('div', { class: 'row' }, h('button', { onclick: () => load() }, 'もう一度')));
      return undefined;
    }
  };
  box.loaded = load();
  return box;
}
