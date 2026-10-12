// keys: every shortcut of the panel in one table — KEYMAP ([キー, 言葉, 動き]) — and match(event) → the move it asks for.
// Before, the keys were spread over panel.js (its keydown) and model.mjs (shortcut); now the table is here, and the page, the
// 「設定」 list (ui/keys.mjs) and the tests all read the same one. Pure: no DOM, no fetch — the event is only read.
//
//   'Mod+K' = Ctrl+K (Windows, Linux) or ⌘+K (Mac): it works even inside a text box (as before).
//   the other keys: only outside a text box (input, textarea, select, contenteditable), never with Ctrl/⌘/Alt, never while
//   typing Japanese (isComposing).
// The moves: { palette } 「やりたいこと」 · { help } the keys (opens 「やりたいこと」 too) · { tab: i } the i-th tab shown
// (0 = the first) · { search } search the runs · { reload } read again. resolve(move, tabs) turns { tab: i } into the tab's name.

export const KEYMAP = Object.freeze([
  ['Mod+K', 'やりたいことを探す', { palette: true }],
  ['?', 'やりたいことを探す（キーの一覧も）', { help: true }],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n, i) => [String(n), `${i + 1} 番目のタブを開く`, { tab: i }]),
  ['/', '実行を探す（「実行」タブの検索へ）', { search: true }],
  ['r', '読み直す', { reload: true }],
].map((x) => Object.freeze(x)));

const TEXT = /^(INPUT|TEXTAREA|SELECT)$/;
/** is this element a place to type (a key there is a letter, not a shortcut) */
export const typing = (el) => Boolean(el && (TEXT.test(String(el.tagName ?? '').toUpperCase()) || el.isContentEditable));

/** 'Mod+K' → { mod: true, key: 'k' }; '?' → { mod: false, key: '?' } */
export function parse(spec) {
  const s = String(spec ?? '');
  const m = /^Mod\+(.+)$/.exec(s);
  return m ? { mod: true, key: m[1].toLowerCase() } : { mod: false, key: s };
}

/** a key pressed → the move (a copy) or null. event: { key, ctrlKey, metaKey, altKey, isComposing, target };
 *  active: the element with the focus (document.activeElement; default event.target) */
export function match(event, keymap = KEYMAP, active = event?.target) {
  if (!event || typeof event.key !== 'string' || event.isComposing || event.altKey) return null;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  for (const [spec, , move] of keymap) {
    const k = parse(spec);
    if (k.mod) { if (mod && event.key.toLowerCase() === k.key) return { ...move }; continue; }
    if (mod || typing(active)) continue;
    if (event.key === k.key) return { ...move };
  }
  return null;
}

/** { tab: i } → { tab: <the i-th shown tab's name> } (null when there are fewer tabs); other moves as they are */
export function resolve(move, tabs = []) {
  if (!move) return null;
  if (move.tab === undefined) return move;
  return typeof move.tab === 'number' && tabs[move.tab] ? { tab: tabs[move.tab] } : null;
}

/** how a key is written for people: 'Mod+K' → 'Ctrl+K' or '⌘+K' (mac); 'r' → 'R' */
export function label(spec, mac = false) {
  const k = parse(spec), key = k.key.length === 1 ? k.key.toUpperCase() : k.key;
  return k.mod ? `${mac ? '⌘' : 'Ctrl'}+${key}` : key;
}

/** is this a Mac (⌘ instead of Ctrl) — from navigator.platform / userAgent given */
export const isMac = (platform = '') => /Mac|iPhone|iPad|iPod/i.test(String(platform));

/** the list for people: the tab keys in one row (1〜9・0), the others one row each → [{ keys, words }] */
export function rows(keymap = KEYMAP, mac = false) {
  const out = [], tabs = keymap.filter(([, , m]) => typeof m.tab === 'number');
  let tabsDone = false;
  for (const [spec, words, move] of keymap) {
    if (typeof move.tab === 'number') {
      if (tabsDone) continue;
      tabsDone = true;
      const ks = tabs.map(([s]) => label(s, mac));
      out.push({ keys: ks.join('') === '1234567890' ? '1〜9・0' : ks.join('・'), words: 'タブを左から順に開く（0 は 10 番目）' });
      continue;
    }
    out.push({ keys: label(spec, mac), words });
  }
  return out;
}

/** one line of help (for a small note): 'Ctrl+K: やりたいことを探す　?: …' */
export const helpLine = (keymap = KEYMAP, mac = false) => rows(keymap, mac).map((r) => `${r.keys}: ${r.words}`).join('　');

/** Tab inside a dialog → the index to move the focus to, or null (let the browser move it): from the last forward → the
 *  first; from the first backward (Shift+Tab) → the last; focus outside the dialog (index -1) → the first / the last */
export function trapIndex(count, index, back = false) {
  if (!(count > 0)) return null;
  if (index < 0 || index >= count) return back ? count - 1 : 0;
  if (!back && index === count - 1) return 0;
  if (back && index === 0) return count - 1;
  return null;
}

/** what keeps someone with only a keyboard from going round the page with Tab → [{ what, why }] (pure; the items are read
 *  from the page by ui/keys.mjs tabCheck): a tabindex above 0 (breaks the order), a button or link with no words, a button
 *  taken out of the order (tabindex -1) that is not disabled.
 *  items: [{ tag, tabindex, name, disabled }] */
export function tabProblems(items = []) {
  const out = [];
  for (const [i, x] of items.entries()) {
    const tag = String(x.tag ?? '').toLowerCase(), ti = x.tabindex === undefined || x.tabindex === null || x.tabindex === '' ? null : Number(x.tabindex);
    const what = `${i + 1} 番目の${tag === 'a' ? 'リンク' : tag === 'button' ? 'ボタン' : '欄'}${x.name ? `「${String(x.name).slice(0, 30)}」` : ''}`;
    if (ti !== null && ti > 0) out.push({ what, why: 'Tab の順番が飛びます（tabindex が 0 より大きい）' });
    if ((tag === 'button' || tag === 'a') && !String(x.name ?? '').trim()) out.push({ what, why: '言葉がないので、読み上げで何のボタンか分かりません' });
    if (ti !== null && ti < 0 && !x.disabled && (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'textarea')) out.push({ what, why: 'Tab で行けません（tabindex が -1）' });
  }
  return out;
}
