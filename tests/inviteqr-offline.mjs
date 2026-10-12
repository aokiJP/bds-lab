// the invitation hand-over without a browser or a network: the words (GitHub's invitation page, the panel address only when it
// is github.io, three steps), and the card on a small fake DOM over a fake fetch (through ghrules' fakeCheck) — the QR of the
// invitation page, the copy button, nothing written, and the "invite first" state when there is no invitation.
// node tests/inviteqr-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const I = await imp('panel/lib/inviteqr.mjs'), G = await imp('panel/lib/gh.mjs'), Q = await imp('panel/lib/qr.mjs');
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

await t('inviteText: the GitHub page, three steps, the panel address only for github.io', () => {
  const a = I.inviteText({ slug: 'o/lab', panelUrl: 'https://o.github.io/lab/panel/?x=1#y', role: 'write', login: 'kid' });
  eq(a.url, 'https://github.com/o/lab/invitations');
  eq(a.lines.length, 4);
  ok(/kid さん/.test(a.lines[0]) && /書き込み/.test(a.lines[0]), a.lines[0]);
  ok(a.lines[1].includes(a.url) && a.lines[2].includes('https://o.github.io/lab/panel/') && !a.lines[2].includes('x=1'), a.lines.join('|'));
  ok(a.md.split('\n').length === 4 && a.md.split('\n')[1].startsWith('- 1.'), a.md);
  for (const p of ['https://evil.example/panel/', 'http://o.github.io/x', 'javascript:alert(1)', '', undefined, 'https://github.io.evil.com/']) {
    const b = I.inviteText({ slug: 'o/lab', panelUrl: p, login: 'k' });
    ok(!/https?:\/\/(?!github\.com)/.test(b.md) && /アドレスを聞いて/.test(b.lines[2]), `${p}: ${b.md}`);
  }
  eq(I.inviteText({ slug: 'o/lab', login: 'a b<x>' }).lines[0].startsWith('abx さん'), true);
});
await t('inviteText: a bad slug is told in words', () => {
  for (const s of [undefined, '', 'nolab', 'a/b/c', '../x/y']) { let e = null; try { I.inviteText({ slug: s }); } catch (x) { e = x; } ok(e && /owner\/repo/.test(e.message), String(s)); }
});

function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag, ns = null) { super(); Object.assign(this, { tagName: ns ? tag : tag.toUpperCase(), ns, kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return this.attrs.disabled !== undefined ? Promise.resolve() : Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createElementNS: (ns, tag) => new E(tag, ns), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { toast };
}
// (the card's requests to the fake GitHub counted where they start and end: a wait ends when none is open and none has come or
// gone for a while — not after a fixed time, which a busy CI runner can outlast)
const net = { busy: 0, at: 0 };
const flush = async () => {
  const until = Date.now() + 10_000;
  await new Promise((r) => setTimeout(r, 30));
  while (Date.now() < until && (net.busy > 0 || Date.now() - net.at < 60)) await new Promise((r) => setTimeout(r, 15));
};
function api(invitations, { down = false, refused = 0 } = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => { net.busy++; net.at = Date.now(); try { return await answer(url, init); } finally { net.busy--; net.at = Date.now(); } };
  const answer = async (url, init) => {
    const u = url.replace('https://api.github.com', ''), m = init.method; seen.push(`${m} ${u}`);
    const json = (code, j) => ({ status: code, ok: code < 300, headers: { get: () => null }, text: async () => JSON.stringify(j), json: async () => j });
    const bad = fakeCheck(m, u, init.body ? JSON.parse(init.body) : null); if (bad) return json(422, { message: bad.message });
    if (down) return json(500, { message: 'boom' });
    if (refused && /^\/repos\/o\/lab\/invitations\?/.test(u)) return json(refused, { message: refused === 403 ? 'Must have admin rights to Repository.' : 'Not Found' });
    if (/^\/repos\/o\/lab\/collaborators\?/.test(u)) return json(200, [{ login: 'o', permissions: { admin: true }, role_name: 'admin' }]);
    if (/^\/repos\/o\/lab\/invitations\?/.test(u)) return json(200, invitations);
    return json(404, { message: 'Not Found' });
  };
  return { api: G.gh({ token: 'x', fetchImpl }), seen };
}
const INV = [{ id: 7, invitee: { login: 'Kid' }, permissions: 'write', created_at: '2026-10-01T00:00:00Z' }];

await t('the card: QR of the invitation page, the words, copy writes the markdown; only reads', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/inviteqr.mjs'), { api: a, seen } = api(INV), copied = [];
  const card = UI.inviteQrCard({ api: a, lab: { slug: 'o/lab' }, panelUrl: 'https://o.github.io/lab/', clipboard: { writeText: async (s) => { copied.push(s); } } }, { login: 'kid', role: 'write' });
  await flush();
  const url = 'https://github.com/o/lab/invitations', [pic] = card.all((e) => e.tagName === 'svg');
  ok(pic, 'a QR drawn'); ok(card.all((e) => e.tagName === 'PRE').some((p) => /kid さん/.test(p.textContent) && p.textContent.includes(url)), card.textContent);
  eq(Q.encode(url).size + 8, Number(pic.attrs.viewBox.split(' ')[2]));
  const btn = card.all((e) => e.tagName === 'BUTTON' && /文を写す/.test(e.textContent))[0];
  await btn.click(); await flush();
  eq(copied.length, 1); ok(copied[0].includes(url) && copied[0].includes('https://o.github.io/lab/'), copied[0]);
  ok(/渡す文を写しました/.test(toast.textContent), toast.textContent);
  ok(seen.every((s) => s.startsWith('GET ')), seen.join(','));
  ok(card.all(() => true).every((e) => !('style' in e.attrs)), 'no style attribute');
});
await t('no invitation yet (or for someone else): "invite first", no QR, a button to look again', async () => {
  fakeDom(); const UI = await imp('panel/ui/inviteqr.mjs');
  for (const [inv, login] of [[[], 'kid'], [INV, 'other'], [[], undefined]]) {
    const card = UI.inviteQrCard({ api: api(inv).api, lab: { slug: 'o/lab' } }, { login });
    await flush();
    ok(/先に「メンバー」で/.test(card.textContent) && !card.all((e) => e.tagName === 'svg').length, card.textContent);
    ok(card.all((e) => e.tagName === 'BUTTON' && /調べ直す/.test(e.textContent)).length === 1, 'look again');
  }
});
await t('the list unreadable (403/404: not an administrator) with a login: never "none yet" — the QR and words all the same', async () => {
  for (const refused of [403, 404]) {
    fakeDom(); const UI = await imp('panel/ui/inviteqr.mjs');
    const card = UI.inviteQrCard({ api: api([], { refused }).api, lab: { slug: 'o/lab' } }, { login: 'kid', role: 'write' });
    await flush();
    const url = 'https://github.com/o/lab/invitations';
    ok(!/まだありません|先に「メンバー」で/.test(card.textContent), `${refused}: ${card.textContent}`);
    ok(card.all((e) => e.tagName === 'svg').length === 1 && card.all((e) => e.tagName === 'PRE').some((p) => /kid さん/.test(p.textContent) && p.textContent.includes(url)), `${refused}: ${card.textContent}`);
    ok(/GitHub のページを開くと分かります/.test(card.textContent) && !card.all((e) => e.attrs.role === 'alert').length, card.textContent);
  }
});
await t('the list unreadable with no login: says only administrators see it (not "none yet"), no QR', async () => {
  fakeDom(); const UI = await imp('panel/ui/inviteqr.mjs');
  const card = UI.inviteQrCard({ api: api([], { refused: 403 }).api, lab: { slug: 'o/lab' } }, {});
  await flush();
  ok(/管理者だけが招待の一覧を見られます/.test(card.textContent) && !/まだありません/.test(card.textContent), card.textContent);
  ok(!card.all((e) => e.tagName === 'svg').length && card.all((e) => e.tagName === 'BUTTON' && /調べ直す/.test(e.textContent)).length === 1, card.textContent);
});
await t('no login: whoever was invited last (the newest created_at), whatever order GitHub lists them in', async () => {
  fakeDom(); const UI = await imp('panel/ui/inviteqr.mjs');
  const list = [
    { id: 1, invitee: { login: 'Old' }, permissions: 'read', created_at: '2026-09-01T00:00:00Z' },
    { id: 3, invitee: { login: 'Newest' }, permissions: 'write', created_at: '2026-10-05T00:00:00Z' },
    { id: 2, invitee: { login: 'Mid' }, permissions: 'admin', created_at: '2026-10-01T00:00:00Z' },
  ];
  const card = UI.inviteQrCard({ api: api(list).api, lab: { slug: 'o/lab' } }, {});
  await flush();
  ok(card.all((e) => e.tagName === 'PRE').some((p) => /^Newest さん/.test(p.textContent) && /書き込み/.test(p.textContent)), card.textContent);
});
await t('a button that cannot be pressed is not pressed (disabled: click does nothing)', async () => {
  fakeDom(); const { h } = await imp('panel/ui/dom.mjs'), pressed = [];
  const off = h('button', { disabled: true, onclick: () => pressed.push('off') }, 'x'), on = h('button', { onclick: () => pressed.push('on') }, 'y');
  await off.click(); eq(pressed, [], 'disabled');
  await on.click(); eq(pressed, ['on'], 'enabled');
});
await t('GitHub down: the failure in words with a way on (role alert)', async () => {
  fakeDom(); const UI = await imp('panel/ui/inviteqr.mjs');
  const card = UI.inviteQrCard({ api: api([], { down: true }).api, lab: { slug: 'o/lab' } }, { login: 'kid' });
  await flush();
  ok(card.all((e) => e.attrs.role === 'alert').length === 1 && !card.all((e) => e.tagName === 'svg').length, card.textContent);
});

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
