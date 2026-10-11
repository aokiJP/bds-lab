// no dead end in 準備・ガイド・健康度・サインイン, without a browser or a network: every 準備 row that is not ok has a fix or a
// next step to take (in each state a stub GitHub can put the lab in), every guide step that is not done says why and what to
// press, the health card says what it could not read (and shows a way out when it cannot be drawn), a 準備 tab that could not
// be read says so with a way on, and the sign-in card says what to put in place of a wrong entry before sending it.
// node tests/setup-rescue-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const S = await imp('panel/lib/setup.mjs'), G = await imp('panel/lib/guide.mjs'), SS = await imp('panel/lib/session.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const ok = (c, m) => { if (!c) throw new Error(m); };

// ---- a small DOM ----
class N { get textContent() { return ''; } }
class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
class E extends N {
  constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, parent: null, _text: null }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
  append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); n.parent = this; this.kids.push(n); } }
  replaceChildren(...xs) { this.kids = []; this.append(...xs); }
  remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text ?? this.kids.map((k) => k.textContent).join(''); }
  fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
  all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
}
const toast = new E('div');
globalThis.Node = N;
globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };

// ---- a stub GitHub: each call answers from what the case says, or fails with a status ----
const err = (status, message = 'no') => Object.assign(new Error(message), { status });
const stub = (o = {}) => ({
  variable: async (_s, n) => { if (o.varErr) throw err(o.varErr); return o.vars?.[n] ?? null; },
  pages: async () => { if (o.pagesErr) throw err(o.pagesErr); return o.pages ?? null; },
  userInstallations: async () => { if (o.instErr) throw err(o.instErr); return o.installs ?? []; },
  installationRepos: async () => [],
  app: async () => { if (o.appErr) throw err(o.appErr); return { permissions: o.perms ?? {} }; },
});
const LAB = (extra = {}) => ({ slug: 'o/lab', repo: { default_branch: 'main', owner: { login: 'o', type: 'User' } }, role: 'admin', secrets: [], workflows: [], ...extra });
const health = (j) => async () => ({ ok: j !== null, status: j === null ? 500 : 200, json: async () => j });

await t('準備: every row that is not ok has a fix or a next step, whatever state the lab is in', async () => {
  const cases = {
    'nothing there': { ctx: { api: stub(), lab: LAB(), hosts: [{ slug: 'x/host' }], config: {}, panelUrl: 'https://o.github.io/lab/' } },
    'everything refused': { ctx: { api: stub({ varErr: 403, pagesErr: 403 }), lab: LAB({ secrets: null }), hosts: [{ slug: 'x/host' }], config: {}, panelUrl: 'https://o.github.io/lab/' } },
    'App known, no auth-deploy.yml, no secrets': { ctx: { api: stub({ vars: { APP_ID: '1', APP_SLUG: 'lab-o' }, pages: { build_type: 'workflow' } }), lab: LAB(), hosts: [], config: {}, panelUrl: 'https://o.github.io/lab/' } },
    'App known, app slug in the config only': { ctx: { api: stub({ varErr: 403 }), lab: LAB({ workflows: [{ path: '.github/workflows/pages.yml' }] }), hosts: [], config: { appSlug: 'lab-o' }, panelUrl: 'https://o.github.io/lab/' } },
    'service address in a variable but not in the page, no pages.yml': { ctx: { api: stub({ vars: { APP_ID: '1', APP_SLUG: 'lab-o', APP_CLIENT_ID: 'Iv1.a', LAB_AUTH_URL: 'https://a.example' } }), lab: LAB(), hosts: [], config: {}, panelUrl: 'https://o.github.io/lab/' } },
    'service answers with no client id, no pages.yml': { ctx: { api: stub({ vars: { APP_ID: '1', APP_SLUG: 'lab-o', LAB_AUTH_URL: 'https://a.example' } }), lab: LAB(), hosts: [], config: { authUrl: 'https://a.example' }, panelUrl: 'https://o.github.io/lab/', fetchImpl: health({ ok: true, clientId: 'Iv1.a', origins: ['https://o.github.io'] }) } },
    'signed in with the App, installs unreadable': { ctx: { api: stub({ vars: { APP_ID: '1', APP_SLUG: 'lab-o', APP_CLIENT_ID: 'Iv1.a' }, instErr: 500, appErr: 500 }), lab: LAB(), hosts: [{ slug: 'x/host' }], config: { authUrl: 'https://a.example' }, panelUrl: 'https://o.github.io/lab/', signedInWithApp: true, fetchImpl: health(null) } },
    'key missing, App id there, App slug not': { ctx: { api: stub({ vars: { APP_ID: '1' } }), lab: LAB({ secrets: ['X'] }), hosts: [], config: {}, panelUrl: 'https://o.github.io/lab/' } },
  };
  let rows = 0;
  for (const [name, { ctx }] of Object.entries(cases)) for (const c of await S.checks(ctx)) {
    rows++;
    ok(c.ok === true || c.fix || c.next, `${name}: ${c.key} is not ok and has neither a fix nor a next step`);
    if (c.fix?.link) ok(/^https:\/\/(github\.com|api\.github\.com)\//.test(c.fix.link), `${name}: ${c.key} links outside GitHub: ${c.fix.link}`);
    ok(c.ok === true || c.need, `${name}: ${c.key} says nothing of what is missing`);
  }
  ok(rows > 30, `rows looked at: ${rows}`);
  const c = Object.fromEntries((await S.checks(cases['nothing there'].ctx)).map((x) => [x.key, x]));
  ok(c.installed.next.goto === 'app' && c['host:x/host'].next.goto === 'app' && c.deploy.fix.link === 'https://github.com/o/lab', 'the rows that wait for the App point to the App row');
  const w = Object.fromEntries((await S.checks({ ...cases['nothing there'].ctx, lab: LAB({ workflows: [{ path: '.github/workflows/auth-deploy.yml' }] }) })).map((x) => [x.key, x]));
  ok(w.deploy.fix === null && w.deploy.next.goto === 'app', JSON.stringify(w.deploy));
  const d = Object.fromEntries((await S.checks(cases['App known, no auth-deploy.yml, no secrets'].ctx)).map((x) => [x.key, x]));
  ok(d.deploy.fix.link === 'https://github.com/o/lab' && /Sync fork/.test(d.deploy.need), JSON.stringify(d.deploy));
});

await t('準備: a row that waits for another carries the step; the App row scrolled to by a link, not a button', async () => {
  const UI = await imp('panel/ui/setup.mjs');
  const body = new E('div');
  await UI.setupTab(body, { api: stub(), lab: LAB(), hosts: [], me: { login: 'o' }, config: {}, panelUrl: 'https://o.github.io/lab/', storage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { search: '', hash: '', pathname: '/' } });
  const links = body.all((e) => e.tagName === 'A' && e.attrs.role === 'button');
  ok(links.length >= 2 && links.every((a) => /GitHub App/.test(a.textContent)), `links: ${links.map((a) => a.textContent)}`);
  let scrolled = null;
  globalThis.document.querySelector = (q) => ({ scrollIntoView() { scrolled = q; } });
  await links[0].fire('click');
  delete globalThis.document.querySelector;
  ok(scrolled === '[data-check="app"]', String(scrolled));
});

await t('準備: a tab that could not read the lab says so, with the way on (not "確かめています…" for good)', async () => {
  const UI = await imp('panel/ui/setup.mjs'), D = await imp('panel/ui/dom.mjs');
  const bad = LAB(); Object.defineProperty(bad, 'workflows', { get() { throw err(403, 'Resource not accessible'); } });
  const body = new E('div');
  await UI.setupTab(body, { api: stub(), lab: bad, hosts: [], me: { login: 'o' }, config: {}, panelUrl: 'https://o.github.io/lab/', storage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { search: '', hash: '', pathname: '/' } });
  ok(!/確かめています/.test(body.textContent) && /Resource not accessible/.test(body.textContent) && /もう一度/.test(body.textContent), body.textContent);
  ok(body.all((e) => e.attrs.role === 'alert').length === 1 && body.all((e) => e.tagName === 'A' && /^https:\/\/github\.com\/settings\/personal-access-tokens\/new/.test(e.attrs.href)).length === 1, 'an alert and the token link');
  void D;
});

await t('ガイド: every step not done says why it waits and what to press; done ones say nothing', () => {
  for (const role of ['owner', 'admin', 'writer', 'lender', 'stranger']) {
    const none = G.guideSteps(role, {}), all = G.guideSteps(role, { pages: 1, app: 1, auth: 1, discord: 1, ran: 1, lenders: 1, lending: 1, watched: 1, fork: 1, asked: 1 });
    ok(none.steps.every((s) => s.done || (s.stuck && s.act)), `${role}: ${JSON.stringify(none.steps.filter((s) => !s.stuck || !s.act))}`);
    ok(all.steps.every((s) => s.done && !s.stuck && !s.act), `${role}: done steps are quiet`);
  }
  const owner = G.guideSteps('owner', { pages: true });
  ok(/先に「GitHub App を作る」/.test(owner.steps.find((s) => s.id === 'auth').stuck) && /App を作る/.test(owner.next.act), 'the service waits for the App');
  ok(/URL/.test(G.guideSteps('owner', { pages: true, app: true }).next.stuck), 'with the App, the service asks for its address');
});

await t('ガイド: the card shows the reason and the next hand', async () => {
  const { guideCard } = await imp('panel/ui/guide.mjs');
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const card = guideCard({ role: 'owner', facts: { pages: true }, go() {}, storage, labSlug: 'o/lab' });
  ok(/今の様子: まだ App がありません/.test(card.textContent) && /次の 1 手: 「準備」の「GitHub App」の行/.test(card.textContent), card.textContent);
  ok(card.all((e) => e.tagName === 'LI').every((li) => /✅|（.+）/.test(li.textContent)), 'each step in the list says why or is done');
});

await t('健康度: what could not be read is said, with the way on; a card that cannot be drawn offers 「もう一度」', async () => {
  const H = await imp('panel/ui/health.mjs');
  const api = { runs: async () => { throw err(403, 'Resource not accessible'); }, secrets: async () => [] };
  const f = await H.readFacts({ api, lab: LAB({ role: 'write' }), hosts: [], config: {}, checks: async () => [{ ok: true }], now: Date.UTC(2026, 9, 1) }, { fresh: true });
  ok(f.unread.length === 1 && f.unread[0].what === '実行の一覧' && f.unread[0].error.status === 403, JSON.stringify(f.unread));
  const box = H.healthCard({ api, lab: LAB({ role: 'write' }), hosts: [], config: {}, checks: async () => [{ ok: true }], now: Date.UTC(2026, 9, 1), policy: undefined, version: { state: 'live' }, go() {} });
  await new Promise((r) => setTimeout(r, 20));
  ok(/読めなかったもの/.test(box.textContent) && /実行の一覧: Resource not accessible/.test(box.textContent) && box.all((e) => e.attrs['data-unread']).length === 1, box.textContent);
  const broken = H.healthCard({ api, lab: LAB({ role: 'write' }), hosts: [], config: {}, checks: async () => [{ ok: true }], get version() { throw err(500, 'GitHub is down'); }, go() {} });
  await new Promise((r) => setTimeout(r, 20));
  ok(!/測っています/.test(broken.textContent) && /GitHub is down/.test(broken.textContent) && /もう一度/.test(broken.textContent), broken.textContent);
});

await t('サインイン: a wrong entry is told what to put instead before anything is sent; the failures end with a way in', async () => {
  const { signInCard } = await imp('panel/ui/signin.mjs');
  const calls = [];
  const card = signInCard({ authUrl: null, lab: 'o/lab', onToken: (x) => calls.push(x) });
  const go = card.all((e) => e.attrs.id === 'go')[0];
  await go.fire('click');
  ok(calls.length === 0 && /上の「トークンを作る」/.test(card.textContent), card.textContent);
  const withErr = signInCard({ authUrl: 'https://a.example', err: 'GitHub でのサインインが取り消されました', lab: 'o/lab', onOAuth: (x) => calls.push(x) });
  ok(/トークンで入る/.test(withErr.textContent) && /もう一度「GitHub でサインイン」/.test(withErr.textContent), 'a failed sign-in says what to press');
  const lab = withErr.all((e) => e.attrs.id === 'oauth-lab')[0]; lab.value = 'bad';
  await withErr.all((e) => e.attrs.id === 'oauth')[0].fire('click');
  ok(calls.length === 0 && /例: myname\/bds-lab/.test(withErr.textContent), 'a wrong lab name: an example');
  for (const code of ['denied', 'github', 'unreachable', 'config', 'origin', 'return', 'body']) ok(/もう一度|トークンで入る|待って/.test(SS.explainAuth(code)), `${code}: ${SS.explainAuth(code)}`);
});

console.log(fail ? `FAIL setup-rescue-offline (${fail} failed, ${pass} ok)` : `PASS setup-rescue-offline (${pass} ok)`);
process.exit(fail ? 1 : 0);
