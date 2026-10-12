// mobilenav (スマホの下のメニュー) without a browser: which tabs go in the bottom bar (「概要」 first, the lately opened ones,
// the role's usual ones, in the tabs' own order, 「その他」 for the rest), the opened tabs kept in a storage (broken text and a
// refusing storage are no trouble), the bar on a small fake DOM (a click runs onclick, a disabled button is not pressed;
// aria-current on the tab now; 「その他」 opens and closes, Esc too), and panel/mobilenav.css (only at 640px or less, the room
// under the page, the phone's home line).
// node tests/mobilenav-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const N = await imp('panel/lib/mobilenav.mjs'), { memoryStorage } = await imp('panel/lib/accounts.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// the panel's tabs (panel.js TABS) as a person who works in the lab sees them
const TABS = [['overview', '概要'], ['runs', '進み具合'], ['start', '実行'], ['units', 'アドオン'], ['releases', '配布'], ['files', '成果物'], ['schedule', '予約'], ['stats', '統計'], ['discord', 'Discord'], ['secrets', '秘密'],
  ['live', '端末'], ['hosts', '貸し借り'], ['members', 'メンバー'], ['setup', '準備'], ['connect', '連携'], ['audit', '監査'], ['settings', '設定']];
const keys = (l) => l.map((x) => x.key);

await t('pick: nothing opened yet → 概要・進み具合・アドオン・配布・その他; the rest in the tabs\' order', () => {
  const r = N.pick(TABS, { role: 'write' });
  eq(keys(r.main), ['overview', 'runs', 'units', 'releases', 'more']);
  eq(r.main.map((x) => x.label), ['概要', '進み具合', 'アドオン', '配布', 'その他']);
  eq(r.main.length, N.SLOTS);
  eq(keys(r.more), ['start', 'files', 'schedule', 'stats', 'discord', 'secrets', 'live', 'hosts', 'members', 'setup', 'connect', 'audit', 'settings']);
  eq(r.main.length - 1 + r.more.length, TABS.length, 'every tab once');
  eq(keys(N.pick(TABS, { role: 'admin' }).main), keys(r.main), 'admin the same');
  eq(keys(N.pick(TABS, { role: { name: 'maintain' } }).main), keys(r.main), 'the role as an object');
});

await t('pick: the lately opened tabs come first (newest first, at most RECENT_SLOTS), 概要 stays, shown in the tabs\' order', () => {
  const r = N.pick(TABS, { role: 'write', recent: ['stats'] });
  eq(keys(r.main), ['overview', 'runs', 'units', 'stats', 'more'], 'stats takes the last usual place');
  ok(keys(r.more).includes('releases') && !keys(r.more).includes('stats'), 'releases moved to その他');
  const two = N.pick(TABS, { role: 'write', recent: ['secrets', 'stats', 'schedule'] });
  eq(keys(two.main), ['overview', 'runs', 'stats', 'secrets', 'more'], 'two lately opened, the newest two');
  eq(N.RECENT_SLOTS, 2);
  // the usual ones opened lately take no extra place; unknown names and the 「その他」 key are ignored
  eq(keys(N.pick(TABS, { role: 'write', recent: ['runs', 'units', 'nope', 'more', 42, 'overview'] }).main), ['overview', 'runs', 'units', 'releases', 'more']);
  // 概要 first even when not opened
  eq(N.pick(TABS, { role: 'write', recent: ['audit', 'setup'] }).main[0].key, 'overview');
});

await t('pick: one who only looks (read) or lends gets their usual ones; a short list needs no 「その他」; never a tab not given', () => {
  const look = TABS.filter(([k]) => ['overview', 'hosts', 'settings', 'audit'].includes(k));
  eq(N.pick(look, { role: 'read' }), { main: [{ key: 'overview', label: '概要' }, { key: 'hosts', label: '貸し借り' }, { key: 'audit', label: '監査' }, { key: 'settings', label: '設定' }], more: [] });
  const five = TABS.slice(0, 5);
  eq(keys(N.pick(five, {}).main), ['overview', 'runs', 'start', 'units', 'releases'], 'five fit without 「その他」');
  eq(N.pick(five, {}).more, []);
  // a read role in a big list: its usual ones (hosts, settings, audit)
  eq(keys(N.pick(TABS, { role: 'read' }).main), ['overview', 'hosts', 'audit', 'settings', 'more']);
  eq(keys(N.pick(TABS, { role: null }).main), ['overview', 'hosts', 'audit', 'settings', 'more'], 'no role: the looking set');
  // no 概要 given (should not happen): the first ones fill in
  const noHome = TABS.slice(1);
  ok(!keys(N.pick(noHome, { role: 'write' }).main).includes('overview') && N.pick(noHome, { role: 'write' }).main.length === 5, 'no overview');
  eq(N.pick(null), { main: [], more: [] }); eq(N.pick([]), { main: [], more: [] });
  eq(N.norm([['a', 'A'], ['a', 'again'], { key: 'b' }, [''], null, ['more', 'x']]), [{ key: 'a', label: 'A' }, { key: 'b', label: 'b' }], 'twice, empty and the その他 key dropped');
});

await t('loadRecent / remember: newest first, at most KEEP, no doubles; broken text and a refusing storage are no trouble', () => {
  const s = memoryStorage();
  eq(N.loadRecent(s), []);
  eq(N.remember(s, 'stats'), ['stats']); eq(N.remember(s, 'runs'), ['runs', 'stats']); eq(N.remember(s, 'stats'), ['stats', 'runs'], 'moved to the front');
  eq(JSON.parse(s.getItem(N.STORAGE_KEY)), ['stats', 'runs']);
  for (let i = 0; i < 12; i++) N.remember(s, `t${i}`);
  eq(N.loadRecent(s).length, N.KEEP); eq(N.loadRecent(s)[0], 't11');
  eq(N.remember(s, 'Bad Name<script>'), N.loadRecent(s), 'not a tab name: not kept');
  s.setItem(N.STORAGE_KEY, '{oops'); eq(N.loadRecent(s), []);
  s.setItem(N.STORAGE_KEY, '{"a":1}'); eq(N.loadRecent(s), [], 'not a list');
  s.setItem(N.STORAGE_KEY, '["runs", 3, "runs", "X Y", "stats"]'); eq(N.loadRecent(s), ['runs', 'stats'], 'only names, once');
  const refuse = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  eq(N.loadRecent(refuse), []); eq(N.remember(refuse, 'runs'), ['runs'], 'refused: the list still');
  eq(N.loadRecent(null), []); eq(N.remember(undefined, 'runs'), ['runs']);
});

// ---- the bar on a small DOM ----
function fakeDom() {
  class Nd { get textContent() { return ''; } }
  class T extends Nd { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends Nd {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, hidden: false, parent: null, focused: false }); this.classList = { toggle: (c, on) => { const l = new Set(this.className.split(' ').filter(Boolean)); if (on) l.add(c); else l.delete(c); this.className = [...l].join(' '); return on; }, contains: (c) => this.className.split(' ').includes(c) }; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; if (k === 'hidden') this.hidden = true; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { if (x === null || x === undefined || Array.isArray(x)) throw new Error('append(bad)'); const n = x instanceof Nd ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); }
    focus() { this.focused = true; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    // (as a browser: a click runs the click listeners — h()'s onclick — unless the button is disabled)
    click() { if (this.disabled) return; for (const fn of this.on.click ?? []) fn({ target: this }); }
    fire(type, ev = {}) { for (const fn of this.on[type] ?? []) fn({ target: this, ...ev }); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  globalThis.Node = Nd;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: () => null };
  return { E };
}

await t('the bar: a nav with a label, the main tabs and 「その他」, aria-current only on the tab now (fake DOM)', async () => {
  fakeDom();
  const { mobileNav } = await imp('panel/ui/mobilenav.mjs');
  const went = [];
  const nav = mobileNav({ tabs: TABS, current: 'runs', role: 'write', storage: memoryStorage(), go: (k) => went.push(k) });
  eq(nav.tagName, 'NAV'); ok(nav.attrs['aria-label'] && /タブ/.test(nav.attrs['aria-label']), 'labelled'); ok(nav.className.includes('mobilenav'), nav.className);
  const bar = nav.all((e) => e.className === 'mobilenav-bar')[0];
  eq(bar.all((e) => e.tagName === 'BUTTON').map((b) => b.attrs['data-mtab']), ['overview', 'runs', 'units', 'releases', 'more']);
  eq(bar.all((e) => e.tagName === 'BUTTON').map((b) => b.textContent), ['概要', '進み具合', 'アドオン', '配布', 'その他']);
  const cur = nav.all((e) => e.attrs['aria-current'] !== undefined);
  eq(cur.map((b) => [b.attrs['data-mtab'], b.attrs['aria-current']]), [['runs', 'page']], 'only the tab now');
  ok(cur[0].className.includes('on'), 'shown as on');
  const style = nav.all((e) => e.attrs.style !== undefined); eq(style.length, 0, 'no style attribute (CSP)');
  ok(!/overview|releases|more/.test(nav.textContent), 'no tab names shown to people');
  eq(went, []);
});

await t('the bar: a tab pressed → go(key) and remembered; the tab now pressed → no go; a disabled button is not pressed (fake DOM)', async () => {
  fakeDom();
  const { mobileNav } = await imp('panel/ui/mobilenav.mjs');
  const storage = memoryStorage(), went = [];
  const nav = mobileNav({ tabs: TABS, current: 'overview', role: 'write', storage, go: (k) => went.push(k) });
  const btn = (k) => nav.all((e) => e.attrs['data-mtab'] === k)[0];
  btn('units').click();
  eq(went, ['units']); eq(N.loadRecent(storage), ['units']);
  btn('overview').click();
  eq(went, ['units'], 'already there: nothing to do'); eq(N.loadRecent(storage), ['overview', 'units']);
  const b = btn('releases'); b.disabled = true; b.click();
  eq(went, ['units'], 'a disabled button is not pressed');
  // the next bar (drawn again after go) puts a lately opened tab in a usual place
  N.remember(storage, 'stats');
  const next = mobileNav({ tabs: TABS, current: 'stats', role: 'write', storage, go: () => {} });
  eq(next.all((e) => e.className.includes('mobilenav-bar'))[0].all((e) => e.tagName === 'BUTTON').map((x) => x.attrs['data-mtab']), ['overview', 'runs', 'units', 'stats', 'more']);
});

await t('その他: closed at first; opens the rest (aria-expanded), a tab there goes and closes; Esc closes and goes back to it (fake DOM)', async () => {
  fakeDom();
  const { mobileNav } = await imp('panel/ui/mobilenav.mjs');
  const storage = memoryStorage(), went = [];
  const nav = mobileNav({ tabs: TABS, current: 'overview', role: 'write', storage, go: (k) => went.push(k) });
  const more = nav.all((e) => e.attrs['data-mtab'] === 'more')[0], list = nav.all((e) => e.tagName === 'UL')[0];
  ok(list.hidden, 'closed'); eq(more.attrs['aria-expanded'], 'false'); eq(more.attrs['aria-controls'], list.attrs.id);
  ok(list.attrs['aria-label'], 'the list is labelled');
  eq(list.all((e) => e.tagName === 'BUTTON').map((x) => x.textContent), ['実行', '成果物', '予約', '統計', 'Discord', '秘密', '端末', '貸し借り', 'メンバー', '準備', '連携', '監査', '設定']);
  more.click();
  ok(!list.hidden, 'open'); eq(more.attrs['aria-expanded'], 'true'); ok(nav.classList.contains('open'), 'nav marked open');
  more.click(); ok(list.hidden, 'pressed again: closed');
  more.click(); nav.fire('keydown', { key: 'Escape' });
  ok(list.hidden, 'Esc closes'); ok(more.focused, 'back to 「その他」'); eq(more.attrs['aria-expanded'], 'false');
  more.click(); nav.fire('keydown', { key: 'a' }); ok(!list.hidden, 'other keys: still open');
  list.all((e) => e.attrs['data-mtab'] === 'secrets')[0].click();
  eq(went, ['secrets']); ok(list.hidden, 'closed after going'); eq(N.loadRecent(storage), ['secrets']);
});

await t('その他: the tab now is among the rest → 「その他」 says which and is shown as on; the item there has aria-current (fake DOM)', async () => {
  fakeDom();
  const { mobileNav } = await imp('panel/ui/mobilenav.mjs');
  // (a storage that refuses: the tab now is not remembered, so it stays in the rest)
  const refuse = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const nav = mobileNav({ tabs: TABS, current: 'audit', role: 'write', storage: refuse, go: () => {} });
  const more = nav.all((e) => e.attrs['data-mtab'] === 'more')[0];
  ok(/その他/.test(more.textContent) && /今: 監査/.test(more.textContent), more.textContent); ok(more.className.includes('on'), 'on');
  const cur = nav.all((e) => e.attrs['aria-current'] !== undefined);
  eq(cur.map((b) => b.attrs['data-mtab']), ['audit'], 'aria-current on the item in the rest');
});

await t('a short list (a lender): no 「その他」, no list; nothing breaks without go or storage (fake DOM)', async () => {
  fakeDom();
  const { mobileNav } = await imp('panel/ui/mobilenav.mjs');
  const nav = mobileNav({ tabs: [['overview', '概要'], ['hosts', '貸し借り'], ['settings', '設定']], current: 'hosts' });
  eq(nav.all((e) => e.tagName === 'BUTTON').map((b) => b.attrs['data-mtab']), ['overview', 'hosts', 'settings']);
  eq(nav.all((e) => e.tagName === 'UL').length, 0, 'no list');
  nav.all((e) => e.attrs['data-mtab'] === 'settings')[0].click(); // (no go given: nothing happens, no throw)
  nav.fire('keydown', { key: 'Escape' });
  eq(mobileNav().all((e) => e.tagName === 'BUTTON').length, 0, 'no tabs: an empty bar');
});

// ---- the stylesheet ----
const css = fs.readFileSync(path.join(TOP, 'panel/mobilenav.css'), 'utf8'), bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
await t('mobilenav.css: hidden on a wide screen, fixed at the bottom at 640px or less, room under the page, the home line, no fetch', () => {
  ok(/^\s*nav\.mobilenav\s*\{\s*display:\s*none;\s*\}/m.test(bare), 'hidden outside the media query');
  const m = /@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*)\}\s*$/.exec(bare.trim());
  ok(m, 'one @media (max-width: 640px) block');
  const inner = m[1];
  ok(/nav\.mobilenav\s*\{[^}]*display:\s*block[^}]*position:\s*fixed[^}]*bottom:\s*0/.test(inner), 'fixed at the bottom');
  ok(/nav\.mobilenav\s*\{[^}]*env\(safe-area-inset-bottom/.test(inner), 'the bar above the home line');
  ok(/body\s*\{[^}]*padding-bottom:[^}]*env\(safe-area-inset-bottom/.test(inner), 'room under the page');
  ok(/\.mobilenav-more\[hidden\]\s*\{\s*display:\s*none/.test(inner), 'the closed list stays closed');
  ok(/min-height:\s*(4[4-9]|[5-9]\d)px/.test(inner), 'buttons big enough to press (44px or more)');
  ok(!/url\(|@import|https?:/.test(bare), 'nothing fetched from elsewhere');
  ok(!/@media/.test(bare.slice(bare.indexOf('@media') + 6)), 'only one media query');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
