// no dead end in the panel's shell (panel/panel.js: the door, reading the lab, 概要・実行・秘密・端末・設定・貸し借り) and
// lib/model.mjs: a sign-in that fails says what to do next; a read that fails says so in place with 「もう一度」 (never an
// empty box, never 「ありません」 for what could not be read, never 0 minutes); an empty list says what fills it; what GitHub
// would refuse with a 422 is said before asking. The pure parts one by one, then panel.js itself on a small fake DOM and a
// fake GitHub (fetch), and every failure it swallows on purpose saying why. node tests/shell-rescue-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const M = await imp('panel/lib/model.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const E = (status, message = '') => new G.GhError(status, message, '/x');

// ---- the pure parts (lib/model.mjs) ----
await t('a sign-in that failed: the next steps, the likeliest first — the network again, GitHub\'s sign-in again, a new token, another lab (pure)', () => {
  const net = M.signInNext(E(0, 'GitHub につながりません（Failed to fetch）'), { authUrl: 'https://auth.example' });
  eq(net.steps, ['retry', 'oauth', 'token', 'lab'], 'the network: again first');
  ok(/つながりません/.test(net.say) && /もう一度/.test(net.say), net.say);
  const bad = M.signInNext(E(401, 'トークンが受け付けられません'));
  eq(bad.steps, ['token', 'lab'], 'no sign-in service: a token, then another lab');
  ok(/新しいトークン/.test(bad.say), bad.say);
  eq(M.signInNext(E(404, '見つからないか、このトークンでは見えません')).steps[0], 'lab', 'not found: the lab\'s name first');
  eq(M.signInNext('サインインの期限が切れました。もう一度サインインしてください', { authUrl: 'https://a.example' }).steps, ['oauth', 'token', 'lab'], 'words alone (the service\'s): still steps');
  for (const x of [E(500, 'boom'), new Error('odd'), '', undefined]) { const n = M.signInNext(x); ok(n.say && n.steps.length >= 2 && n.steps.includes('token'), JSON.stringify(n)); }
});

await t('a lender\'s .lab-host.json: none (usual: how to make it), not read (said: never 「ありません」), not JSON, wrong, good (pure)', () => {
  const none = M.hostFile(null);
  ok(none.state === 'missing' && /ありません/.test(none.errors[0]) && /貸し借り/.test(none.errors[0]), JSON.stringify(none));
  const unread = M.hostFile(null, E(502, 'Bad gateway'));
  ok(unread.state === 'unread' && /読めませんでした/.test(unread.errors[0]) && /Bad gateway/.test(unread.errors[0]) && !/ありません/.test(unread.errors[0]), JSON.stringify(unread));
  const notJson = M.hostFile({ text: '{oops' });
  ok(notJson.state === 'bad' && /JSON ではありません/.test(notJson.errors[0]) && /直す|保存し直/.test(notJson.errors[0]), JSON.stringify(notJson));
  const wrong = M.hostFile({ text: JSON.stringify({ minutesPerMonth: 0, jobs: ['gate'] }) });
  ok(wrong.state === 'bad' && /minutesPerMonth/.test(wrong.errors.join()), JSON.stringify(wrong));
  const good = M.hostFile({ text: JSON.stringify({ minutesPerMonth: 600, jobs: ['gate'] }) });
  eq([good.state, good.rules.minutesPerMonth, good.errors], ['ok', 600, []]);
  eq(M.hostFile({ text: JSON.stringify({ minutesPerMonth: 600, jobs: ['gate'] }) }).rules, M.checkRules({ minutesPerMonth: 600, jobs: ['gate'] }).rules, 'the same rules as checkRules');
});

await t('an empty list of runs: why, and the one next step — take the search away, or 「実行」 (pure)', () => {
  eq(M.runsEmpty({ all: 0 }).step, 'start'); ok(/実行/.test(M.runsEmpty({ all: 0 }).text), 'the lab: start one');
  ok(/ホスト/.test(M.runsEmpty({ all: 0, isLab: false }).text) && M.runsEmpty({ all: 0, isLab: false }).step === 'start', 'a host: start one there');
  eq(M.runsEmpty({ all: 12, q: 'verify' }).step, 'clear'); eq(M.runsEmpty({ all: 12, show: 'failed' }).step, 'clear');
  ok(/当てはまる実行がありません/.test(M.runsEmpty({ all: 12, q: 'x' }).text) && /変えて/.test(M.runsEmpty({ all: 12, q: 'x' }).text), 'narrowed: change the search');
  eq(M.runsEmpty({ all: 3 }).step, null, 'nothing narrowed, nothing to offer (cannot happen: the list would not be empty)');
});

await t('owner/name typed in: said before it is used — empty, a pasted address, a space, already in the list (pure)', () => {
  ok(/owner\/名前/.test(M.slugProblem('')) && /例/.test(M.slugProblem('  ')), 'empty: the form and an example');
  ok(/形が違います/.test(M.slugProblem('https://github.com/o/lab')) && /github\.com\/ のあと/.test(M.slugProblem('https://github.com/o/lab')), 'an address pasted: what to take from it');
  ok(/形が違います/.test(M.slugProblem('o / lab')) && /形が違います/.test(M.slugProblem('o')), 'a space, no slash');
  ok(/もう一覧にあります/.test(M.slugProblem('O/Lab', ['o/lab'])), 'already there (any case)');
  eq([M.slugProblem('o/lab'), M.slugProblem(' o/lab ', ['x/y'])], [null, null], 'good');
  ok(M.slugProblem('x'.repeat(500)).length < 300, 'never the whole of a long paste');
});

await t('a secret\'s name and value: what GitHub would refuse (422) said before sealing and sending (pure)', () => {
  ok(/GITHUB_/.test(M.secretProblem('GITHUB_TOKEN', 'v')) && /ほかの名前/.test(M.secretProblem('GITHUB_TOKEN', 'v')), 'GITHUB_: another name');
  ok(/数字から始めません/.test(M.secretProblem('1ABC', 'v')) && /数字から始めません/.test(M.secretProblem('MY-KEY', 'v')), 'the characters');
  ok(/名前を入れて/.test(M.secretProblem('', 'v')), 'no name');
  ok(/値が空/.test(M.secretProblem('MS_EMAIL', '')), 'no value');
  ok(/48 KB/.test(M.secretProblem('BIG', 'x'.repeat(49 * 1024))), 'too large');
  ok(/255/.test(M.secretProblem('A'.repeat(256), 'v')), 'too long a name');
  eq([M.secretProblem('MS_EMAIL', 'a@b.c'), M.secretProblem('DISCORD_USER_ID')], [null, null], 'good (and a name alone)');
});

await t('a workflow\'s required inputs left empty: named before GitHub refuses the run with a 422 (pure)', () => {
  const d = M.dispatchInputs(`on:\n  workflow_dispatch:\n    inputs:\n      unit:\n        required: true\n      mode:\n        required: true\n        default: run\n      deep:\n        type: boolean\n        required: true\n      note:\n        description: x\n`);
  eq(M.dispatchMissing(d.inputs, { unit: '', mode: '', deep: false, note: '' }), ['unit'], 'one with a default and a checkbox are never missing');
  eq(M.dispatchMissing(d.inputs, { unit: ' coins ', mode: '', deep: false }), []);
  eq(M.dispatchMissing(d.inputs, { unit: '   ' }), ['unit'], 'spaces are empty');
});

await t('「いまやること」: what could not be read is named, with 「読み直す」 — the rest as before (pure)', () => {
  eq(M.todos({}), [], 'nothing to do: nothing said');
  const x = M.todos({ unread: ['実行', '秘密'], joins: 1 });
  ok(x.some((i) => i.level === 'warn' && /実行・秘密を読めませんでした/.test(i.text) && /読み直す/.test(i.text) && i.tab === null), JSON.stringify(x));
  eq(M.todos({ joins: 2, noVars: true }).map((i) => [i.level, i.tab]), [['warn', 'members'], ['info', 'setup']], 'unchanged without unread');
});

await t('words that stopped short now say the next step: the shut door, a host without rules, an administrator without a fork (pure)', () => {
  const no = M.access({ lab: { permissions: { pull: true } } });
  ok(!no.ok && /書き込める人/.test(no.why) && /貸している/.test(no.why) && /設定/.test(no.why) && /招いて/.test(no.why) && /時間を貸す/.test(no.why), no.why);
  ok(/貸し借り/.test(M.hostNow(null, 0).why[0]), M.hostNow(null, 0).why[0]);
  ok(/読めません/.test(M.hostRunInputs({ host: 'l/h', job: 'gate', rules: null }).error) && /読み直す/.test(M.hostRunInputs({ host: 'l/h', job: 'gate', rules: null }).error));
  ok(/フォークがまだ/.test(M.adminLend({ required: true }).why[0]) && /フォークで貸す/.test(M.adminLend({ required: true }).why[0]));
});

// ---- panel.js itself: every failure it lets go of says why it may (the rest are said on the page) ----
const SRC = fs.readFileSync(path.join(TOP, 'panel', 'panel.js'), 'utf8');
await t('panel.js: every failure let go of on purpose carries its reason (a comment in the catch); none of the reads before a write is let go of', () => {
  const silent = [...SRC.matchAll(/\.catch\(\(\) => (null|\[\]|undefined|\{\}|'[^']*'|\(\{\s*\}\))\)/g)].map((m) => SRC.slice(0, m.index).split('\n').length);
  eq(silent, [], 'lines with a catch that throws a failure away without a word');
  const bare = [...SRC.matchAll(/catch \{\s*\}/g)].map((m) => SRC.slice(0, m.index).split('\n').length);
  eq(bare, [], 'an empty catch block');
  // (LAB_HOSTS and a lender's .lab-host.json are written from what was read: a failed read must stop the write, never empty it)
  const fn = (name) => { const i = SRC.indexOf(`function ${name}(`); ok(i >= 0, name); return SRC.slice(i, SRC.indexOf('\n}\n', i)); };
  ok(!/variable\([^)]*'LAB_HOSTS'\)\.catch/.test(fn('addLabHost')), 'addLabHost: a failed read of LAB_HOSTS is not a list of none');
  ok(!/variable\([^)]*'LAB_HOSTS'\)\.catch\(\(\)/.test(fn('forksCard')) && /variable\([^)]*'LAB_HOSTS'\)\.catch\(\(e\) => \{ if \(e\.status === 403\) return undefined;[^\n]{0,160}throw e; \}\)/.test(fn('forksCard')) && !/'\.lab-host\.json'\)\.catch/.test(fn('forksCard')), 'forksCard: the same, and the file\'s sha read before it is written');
  ok(!/runs\([^)]*\)\.catch/.test(fn('hostUse')), 'hostUse: minutes not read are never counted as 0');
  for (const name of ['files', 'secrets', 'live', 'runs', 'detail', 'hostCard', 'forksCard', 'todoCard', 'discord', 'dispatchForm', 'overview'])
    ok(/\bfill\(/.test(fn(name)), `${name}: the part that says 「読んでいます…」 is filled by fill() — on a failure, failView in its place`);
});

// ---- panel.js on a small fake DOM, with a fake GitHub behind fetch ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class El extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, hidden: false, parent: null, dataset: {} }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'disabled') this.disabled = true; if (k === 'hidden') this.hidden = true; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    replaceWith(x) { if (!this.parent) return; const p = this.parent, i = p.kids.indexOf(this); p.kids[i] = x; x.parent = p; this.parent = null; }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    set textContent(s) { this.replaceChildren(String(s)); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type) { return Promise.all([...(this.on[type] ?? []), ...(this[`on${type}`] ? [this[`on${type}`]] : [])].map((fn) => fn({ target: this, preventDefault() {} }))); }
    click() { return this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof El) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
    button(re) { return this.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0] ?? null; }
    closest() { return null; }
    querySelector() { return null; }
    focus() {} select() {} scrollIntoView() {}
  }
  const body = new El('body'), root = (id) => { const e = new El('div'); e.setAttribute('id', id); body.append(e); return e; };
  const who = root('who'), mainEl = root('main'), toast = root('toast');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new El(tag), createTextNode: (s) => new T(s), getElementById: (id) => body.all((e) => e.id === id)[0] ?? null, body, title: 'bds-lab', visibilityState: 'visible', hidden: false, activeElement: null, querySelector: () => null, querySelectorAll: () => [] };
  return { El, body, who, main: mainEl, toast };
}
function memStore(init = {}) { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; }
/** routes: [[method path-regex, (m) → [status, json]]], the first that matches; anything else 404 */
function fakeFetch(routes, seen) {
  return async (url, opts = {}) => {
    const u = String(url), method = (opts.method ?? 'GET').toUpperCase();
    if (!u.startsWith('https://api.github.com')) return new Response('', { status: 404 });
    const p = u.slice('https://api.github.com'.length);
    seen.push(`${method} ${p}`);
    for (const [key, fn] of routes) {
      const [m, re] = key.split(' '); const x = new RegExp(`^${re}$`).exec(p.split('?')[0]);
      if (m === method && x) {
        const [status, j] = fn(x, p);
        if (status === 'throw') throw new TypeError('Failed to fetch');
        return new Response(j === null ? null : JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
}
let n = 0;
/** panel.js started as a fresh page: one account (token tok) whose lab is o/lab, GitHub as routes → the page's parts */
async function page(routes, { account = true } = {}) {
  const dom = fakeDom(), seen = [];
  const local = memStore(account ? { 'bdslab.panel.accounts': JSON.stringify([{ login: 'me', avatar: '', at: '2026-01-01T00:00:00Z' }]), 'bdslab.panel.tok.me': JSON.stringify('tok'), 'bdslab.panel.cfg.me': JSON.stringify({ lab: 'o/lab', hosts: [] }), 'bdslab.panel.active': JSON.stringify('me') } : {});
  const win = { localStorage: local, sessionStorage: memStore(), addEventListener() {}, focus() {} };
  win.top = win; win.self = win;
  globalThis.window = win;
  globalThis.location = { href: 'https://o.github.io/lab/', origin: 'https://o.github.io', pathname: '/lab/', search: '', hash: '', hostname: 'o.github.io', assign() {}, reload() {} };
  globalThis.history = { replaceState() {} };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'test' }, configurable: true, writable: true });
  globalThis.fetch = fakeFetch(routes, seen);
  globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};
  globalThis.confirm = () => true; globalThis.prompt = () => null;
  await import(`${pathToFileURL(path.join(TOP, 'panel', 'panel.js')).href}?page=${++n}`);
  const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => realTimeout(r, 10)); } return false; };
  return { ...dom, seen, until, text: () => dom.main.textContent };
}
const ME = ['GET /user', () => [200, { login: 'me', avatar_url: 'https://avatars.githubusercontent.com/u/1' }]];
const LABREPO = (perm = { push: true, pull: true }) => ['GET /repos/o/lab', () => [200, { full_name: 'o/lab', default_branch: 'main', visibility: 'public', permissions: perm, owner: { login: 'o', type: 'User' }, html_url: 'https://github.com/o/lab' }]];
// (setTimeout left running by a toast must not hold the test open)
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const x = realTimeout(fn, ms, ...a); x?.unref?.(); return x; };

await t('the door: a token GitHub does not take — the card says why, and below it the next steps: a new token (GitHub\'s page), another lab (fake DOM, fake GitHub)', async () => {
  const p = await page([['GET /user', () => [401, { message: 'Bad credentials' }]]]);
  ok(await p.until(() => p.body.all((e) => e.id === 'signin-next').length), `the next steps shown: ${p.text()}`);
  const next = p.body.all((e) => e.id === 'signin-next')[0];
  ok(/受け付けられません/.test(p.text()) && /新しいトークン/.test(next.textContent), next.textContent);
  const a = next.all((e) => e.tagName === 'A')[0];
  ok(a && /^https:\/\/github\.com\/settings\/(personal-access-tokens|tokens)/.test(a.attrs.href), `a token's page on GitHub: ${a?.attrs.href}`);
  ok(next.button(/別のラボ/), 'another lab: a tap');
});

await t('the door: GitHub not answering at all — 「もう一度」 asks again (fake DOM, fake GitHub)', async () => {
  let up = false;
  const p = await page([['GET /user', () => (up ? [200, { login: 'me' }] : ['throw'])], ['GET /repos/o/lab', () => [500, { message: 'x' }]]]);
  ok(await p.until(() => p.body.all((e) => e.id === 'signin-next').length), p.text());
  const again = p.body.all((e) => e.id === 'signin-next')[0].button(/もう一度/);
  ok(again, 'again offered');
  up = true; await again.click();
  ok(await p.until(() => p.seen.filter((x) => x === 'GET /user').length >= 2), `asked again: ${p.seen.join(' ')}`);
});

await t('the lab not read (GitHub\'s own trouble, not 「not yours」): said in place with 「もう一度」 — never the shut door (fake DOM, fake GitHub)', async () => {
  const p = await page([ME, ['GET /repos/o/lab', () => [502, { message: 'Bad gateway' }]]]);
  ok(await p.until(() => /ラボ（o\/lab）を読めませんでした/.test(p.text())), p.text());
  ok(!/使えません|時間を貸す/.test(p.text()), `not shut out for GitHub's trouble: ${p.text()}`);
  ok(p.main.button(/もう一度/) && p.main.button(/設定/), 'again, and the settings to change the lab');
  const before = p.seen.filter((x) => x === 'GET /repos/o/lab').length;
  await p.main.button(/もう一度/).click();
  ok(await p.until(() => p.seen.filter((x) => x === 'GET /repos/o/lab').length > before), 'asked again');
});

await t('the shut door: the ways on — another lab\'s name (checked before it is used), again — and a search for hosts that failed is said (fake DOM, fake GitHub)', async () => {
  const p = await page([ME, ['GET /repos/o/lab', () => [404, { message: 'Not Found' }]], ['GET /user/repos', () => [503, { message: 'Service unavailable' }]]]);
  ok(await p.until(() => p.body.all((e) => e.id === 'locked-ways').length), p.text());
  const ways = p.body.all((e) => e.id === 'locked-ways')[0];
  ok(/GitHub の側で一時的な不具合/.test(ways.textContent) && ways.button(/もう一度/) && ways.button(/このラボで入り直す/), ways.textContent);
  const input = ways.all((e) => e.tagName === 'INPUT')[0];
  input.value = 'https://github.com/o/other';
  await ways.button(/このラボで入り直す/).click();
  ok(/形が違います/.test(p.toast.textContent), `a pasted address said before it is used: ${p.toast.textContent}`);
});

await t('概要 for a writer: the lab\'s settings not read are said with 「もう一度」; 進み具合 not read: failView in the list, not 「読んでいます…」 (fake DOM, fake GitHub)', async () => {
  let runsUp = false;
  const p = await page([ME, LABREPO(), ['GET /repos/o/lab/actions/secrets', () => [500, { message: 'boom' }]], ['GET /repos/o/lab/actions/variables', () => [200, { variables: [] }]],
    ['GET /repos/o/lab/actions/workflows', () => [200, { workflows: [] }]], ['GET /repos/o/lab/actions/runs', () => (runsUp ? [200, { workflow_runs: [] }] : [503, { message: 'unavailable' }])], ['GET /repos/o/lab/pulls', () => [200, []]]]);
  ok(await p.until(() => p.body.all((e) => e.id === 'envfail').length), p.text());
  ok(/秘密の名前を読めませんでした/.test(p.body.all((e) => e.id === 'envfail')[0].textContent) && p.body.all((e) => e.id === 'envfail')[0].button(/もう一度/), p.body.all((e) => e.id === 'envfail')[0].textContent);
  ok(await p.until(() => /GitHub の側で一時的な不具合/.test(p.body.all((e) => e.id === 'ovruns')[0]?.textContent ?? '')), `the recent runs: ${p.body.all((e) => e.id === 'ovruns')[0]?.textContent}`);
  // (進み具合: the tab)
  p.main.all((e) => e.attrs['data-tab'] === 'runs')[0].click();
  ok(await p.until(() => /GitHub の側で一時的な不具合/.test(p.text()) && !/読んでいます…/.test(p.text())), p.text());
  runsUp = true;
  await p.main.all((e) => e.className === 'bad' && e.attrs.role === 'alert').at(-1).button(/もう一度/).click();
  ok(await p.until(() => /まだ実行がありません/.test(p.text())), p.text());
  ok(p.main.button(/「実行」を開く/), 'no runs yet: 「実行」 a tap away');
});

console.log(`${fail ? 'FAIL' : 'PASS'} shell-rescue-offline (${pass} ok${fail ? `, ${fail} failed` : ''})`);
process.exit(fail ? 1 : 0);
