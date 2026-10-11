// the panel's dead ends in the 「予約」「統計」「お知らせ」「まとめて登録」「メンバー」「監査」「貸す」 tabs, on a small fake DOM and a fake
// GitHub: a failure is never dropped in silence or left as 「読んでいます…」 (the words and the next step, through setOnFail), an empty
// list says what fills it, a button that cannot be pressed says why, and what is wrong with an input is said before it is sent.
// node tests/misc-rescue-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(String(m)); };

function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  const REFLECT = { type: (v) => v, id: (v) => v, disabled: () => true, hidden: () => true, title: (v) => v };
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, hidden: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (REFLECT[k]) this[k] = REFLECT[k](String(v)); }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { if (x === null || x === undefined || Array.isArray(x)) throw new Error('append(null/undefined/list)'); const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    prepend(...xs) { const old = this.kids; this.kids = []; this.append(...xs); for (const k of old) { k.parent = this; this.kids.push(k); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    set textContent(v) { this.replaceChildren(v); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    click() { return this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
const btn = (root, text) => root.all((e) => e.tagName === 'BUTTON' && e.textContent === text);
const links = (root) => root.all((e) => e.tagName === 'A').map((a) => a.attrs.href);
const WAY = 'https://github.com/settings/personal-access-tokens';

// (the page's own next step, as panel.js gives it: a link for a refused right, a button for the rest)
async function withWay(D) {
  D.setOnFail((e, retry) => (e.status === 403 ? D.link(WAY, 'トークンを作り直す') : retry ? D.h('button', { class: 'retry', onclick: retry }, 'もう一度') : null));
}

await t('「予約」: the file not read → the words and the next step (the page\'s way, a 読み直す button, a hint); a workflow\'s inputs not read → the same, with 読み直す; a read-only role is told whom to ask, and the disabled buttons say why', async () => {
  const { E } = fakeDom();
  const D = await imp('panel/ui/dom.mjs'), UI = await imp('panel/ui/schedule.mjs');
  await withWay(D);
  let fileErr = Object.assign(new Error('このトークンには、その操作の権限がありません'), { status: 403 });
  const api = { async file() { if (fileErr) throw fileErr; return null; } };
  const ctx = { api, lab: { slug: 'o/lab', repo: {} }, workflows: [{ name: 'verify', path: '.github/workflows/verify.yml', state: 'active' }], may: () => false, dispatchInputs: async () => { throw Object.assign(new Error('GitHub: 502'), { status: 502 }); } };
  const body = new E('div');
  await UI.scheduleTab(body, ctx);
  ok(/を読めません/.test(body.textContent) && links(body).includes(WAY) && btn(body, '読み直す').length >= 1 && /権限を確かめてから/.test(body.textContent), body.textContent);
  ok(/管理者に/.test(body.textContent), 'a read-only role is told whom to ask');
  const add = btn(body, '＋ 予約を足す')[0];
  ok(add.disabled && /管理者に頼んでください/.test(add.attrs.title ?? ''), `why the button cannot be pressed: ${add.attrs.title}`);
  fileErr = null;
  await btn(body, '読み直す')[0].click();
  ok(!/を読めません/.test(body.textContent), 'read again');
  // (inputs not read: in the form's place, with the page's retry and a 読み直す)
  const ctx2 = { ...ctx, may: () => true };
  const b2 = new E('div');
  await UI.scheduleTab(b2, ctx2);
  await btn(b2, '＋ 予約を足す')[0].click();
  ok(/verify\.yml を読めません: GitHub: 502/.test(b2.textContent) && btn(b2, 'もう一度').length === 1 && btn(b2, '読み直す').length >= 1, b2.textContent);
});

await t('「統計」: the runs not read → the words, the page\'s next step and 読み直す (not a bare message); an empty period says what to do; a lender that was not read gets a link to its Actions', async () => {
  const { E } = fakeDom();
  const D = await imp('panel/ui/dom.mjs'), UI = await imp('panel/ui/stats.mjs');
  await withWay(D);
  let boom = Object.assign(new Error('GitHub: 502 Bad Gateway'), { status: 502 });
  const api = { async call(method, p) { if (boom && !/host\.yml/.test(p)) throw boom; if (/host\.yml/.test(p)) throw new Error('nope'); return { workflow_runs: [] }; } };
  const body = new E('div');
  const hosts = [{ slug: 'bob/lab', repo: { html_url: 'https://github.com/bob/lab' } }];
  await UI.statsTab(body, { api, lab: { slug: 'o/lab' }, hosts, now: Date.parse('2026-10-08T00:00:00Z') });
  ok(/502 Bad Gateway/.test(body.textContent) && btn(body, 'もう一度').length === 1 && btn(body, '読み直す').length >= 1, body.textContent);
  boom = null;
  await btn(body, '読み直す')[0].click();
  ok(/始まった実行はありません/.test(body.textContent) && /90 日/.test(body.textContent) && /host\.yml の実行を読めませんでした/.test(body.textContent) && links(body).includes('https://github.com/bob/lab/actions/workflows/host.yml'), body.textContent);
});

await t('「お知らせ」: each empty list says what fills it; 「すべて読んだ」 with nothing unread says why it is off', async () => {
  const { E } = fakeDom();
  const IB = await imp('panel/lib/inbox.mjs'), UI = await imp('panel/ui/inbox.mjs');
  const store = IB.store({ getItem: () => null, setItem() {}, removeItem() {} }, 'k');
  ok(store, 'inbox store');
  const card = UI.inboxPanel({ inbox: store, go() {} });
  ok(/実行が終わったり/.test(card.textContent), card.textContent);
  await card.all((e) => e.attrs['data-filter'] === 'unread')[0].click();
  ok(/「すべて」を押すと/.test(card.textContent), card.textContent);
  await card.all((e) => e.attrs['data-filter'] === 'failed')[0].click();
  ok(/「すべて」で/.test(card.textContent), card.textContent);
  const read = card.all((e) => e.attrs.id === 'inboxread')[0];
  ok(read.disabled && /ありません/.test(read.attrs.title ?? ''), 'why it is off');
  void E;
});

await t('「まとめて登録」: a wrong line says what to do next; the button says why it cannot be pressed (nothing pasted, a line to fix, the role)', async () => {
  fakeDom();
  const UI = await imp('panel/ui/bulk.mjs');
  const mk = (over = {}) => UI.bulkCard({ guarded: async (a, d, fn) => fn(), putSecret: async () => null, ...over });
  const card = mk();
  const area = card.all((e) => e.tagName === 'TEXTAREA')[0], go = card.all((e) => e.attrs.id === 'bulkgo')[0];
  ok(/ここに .env の中身を貼ってください|上の欄に .env の中身を貼ってください/.test(card.textContent) && /貼ってください/.test(go.attrs.title ?? go.title ?? ''), 'nothing pasted');
  area.value = 'oops no equals';
  await area.fire('input');
  ok(/KEY=VALUE の形ではありません/.test(card.textContent) && /全部直ると/.test(card.textContent) && /直す行があります/.test(go.title), card.textContent);
  area.value = '# only a note';
  await area.fire('input');
  ok(/NAME=値 の形の行を入れてください/.test(card.textContent), card.textContent);
  const ro = mk({ gate: () => ({ disabled: true }) });
  ok(/管理者に頼んでください/.test(ro.all((e) => e.attrs.id === 'bulkgo')[0].title), 'role');
});

await t('「メンバー」: the people not read → the words, the page\'s next step and 読み直す (not 「読んでいます…」 for good); join requests / lending / history not read are said, with GitHub\'s page; a reader is told whom to ask and why a role cannot be changed', async () => {
  const { E } = fakeDom();
  const D = await imp('panel/ui/dom.mjs'), UI = await imp('panel/ui/members.mjs'), P = await imp('panel/lib/policy.mjs');
  await withWay(D);
  let down = true;
  const api = {
    async call(method, p) { if (/collaborators\?/.test(p)) { if (down) throw Object.assign(new Error('GitHub: 502'), { status: 502 }); return [{ login: 'o', permissions: { admin: true }, role_name: 'admin' }, { login: 'amy', permissions: { push: true }, role_name: 'write' }]; } return []; },
    async issues() { throw new Error('no'); }, async commits() { throw new Error('no'); },
  };
  const ctx = { api, lab: { slug: 'o/lab', role: 'admin', repo: { owner: { login: 'o' } } }, me: { login: 'o' }, policy: P.DEFAULT_POLICY, may: () => true, guarded: async (a, d, fn) => fn(), reload() {}, lending: async () => { throw new Error('no'); } };
  const body = new E('div');
  {
    UI.membersTab(body, ctx);
    await new Promise((r) => setTimeout(r, 20));
    ok(/GitHub: 502/.test(body.textContent) && !/読んでいます/.test(body.textContent) && btn(body, 'もう一度').length === 1, body.textContent);
    ok(/変更の記録を読めませんでした/.test(body.textContent) && links(body).some((l) => /commits\/main\//.test(l)), 'history not read');
    down = false;
    await btn(body, '読み直す')[0].click();
    await new Promise((r) => setTimeout(r, 20));
    ok(body.all((e) => e.attrs['data-member'] === 'amy').length === 1 && /参加のお願いを読めませんでした/.test(body.textContent) && links(body).includes('https://github.com/o/lab/issues'), body.textContent);
  }
  const rd = new E('div');
  UI.membersTab(rd, { ...ctx, lab: { ...ctx.lab, role: 'read' }, may: () => false });
  await new Promise((r) => setTimeout(r, 20));
  ok(/ラボの管理者に頼んでください/.test(rd.textContent), rd.textContent);
  const sel = rd.all((e) => e.tagName === 'SELECT' && e.attrs['aria-label'] === 'amy の役割')[0];
  ok(sel?.disabled && /管理者だけ/.test(sel.attrs.title ?? ''), 'why the role cannot be changed');
});

await t('「監査」: the log not read → the words and the next step in the list\'s place; an empty log says how to turn it on or what fills it; a role without audit.read is told whom to ask', async () => {
  const { E } = fakeDom();
  const D = await imp('panel/ui/dom.mjs'), UI = await imp('panel/ui/audit.mjs'), P = await imp('panel/lib/policy.mjs');
  await withWay(D);
  let boom = Object.assign(new Error('GitHub: 500'), { status: 500 });
  const api = { async labeledIssues() { if (boom) throw boom; return []; }, async allComments() { return []; } };
  const lab = { slug: 'o/lab', repo: { visibility: 'public' } };
  const body = new E('div');
  await UI.auditTab(body, { api, lab, role: 'admin' });
  ok(/GitHub: 500/.test(body.textContent) && !/読んでいます/.test(body.textContent) && btn(body, 'もう一度').length === 1, body.textContent);
  boom = null;
  await btn(body, '読み直す')[btn(body, '読み直す').length - 1].click();
  ok(/"audit": "issue"/.test(body.textContent), body.textContent);
  const denied = new E('div');
  await UI.auditTab(denied, { api, lab, role: 'nobody', policy: P.DEFAULT_POLICY });
  ok(/管理者に/.test(denied.textContent), denied.textContent);
});

await t('「貸す」: a fork name in the wrong form is told before anything is sent, with an example', async () => {
  fakeDom();
  const UI = await imp('panel/ui/lend.mjs');
  let called = 0;
  const api = new Proxy({}, { get: () => async () => { called++; return null; } });
  let e = null;
  try { await UI.lendFork(api, { slug: 'not a slug', me: 'bob', labSlug: 'o/lab', rules: {} }); } catch (x) { e = x; }
  ok(e && /owner\/名前 の形で入れてください/.test(e.message) && /例/.test(e.message) && called === 0, e?.message);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
