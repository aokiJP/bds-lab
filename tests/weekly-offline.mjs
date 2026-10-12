// the weekly report without a browser, a network or Discord: the numbers of the last 7 days (runs, the share that passed and
// last week's, minutes, the workflows that failed most, new releases, the lenders' minutes), the words kept under Discord's
// 2000 letters and free of mentions; the CLI (common/weekly.mjs) against a fake GitHub on node:http that answers through
// ghrules — --dry sends nothing, --send hands the same words to notify, the token and the webhook never printed; and the card
// (panel/ui/weekly.mjs) on a small fake DOM: the draft, 「Discord に送る」 through guarded('dispatch') (P.can), a button that
// cannot be pressed says why, a lab that cannot be read shows the words and 「もう一度」.
// node tests/weekly-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const W = await imp('panel/lib/weekly.mjs'), G = await imp('panel/lib/gh.mjs'), P = await imp('panel/lib/policy.mjs'), CLI = await imp('common/weekly.mjs');
let fails = 0;
const t = async (name, fn) => { try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const NOW = Date.parse('2026-10-12T09:00:00Z'), H = 3_600_000, D = 24 * H;
let id = 0;
/** a finished run that started `ago` ms before NOW and took `min` minutes */
const run = (ago, conclusion, { name = 'verify', file = 'verify.yml', min = 3, status = 'completed' } = {}) => {
  const s = NOW - ago;
  return { id: ++id, name, path: `.github/workflows/${file}`, status, conclusion: status === 'completed' ? conclusion : null, run_started_at: new Date(s).toISOString(),
    created_at: new Date(s).toISOString(), updated_at: new Date(s + min * 60_000).toISOString(), head_branch: 'main' };
};
const RUNS = [
  run(1 * H, 'success'), run(2 * H, 'failure', { name: 'unit', file: 'unit.yml', min: 10 }), run(1 * D, 'failure', { name: 'unit', file: 'unit.yml', min: 10 }),
  run(2 * D, 'success', { name: 'unit', file: 'unit.yml', min: 10 }), run(3 * D, 'failure', { name: 'ai-make', file: 'ai-make.yml', min: 1 }),
  run(4 * D, 'cancelled', { min: 2 }), run(5 * D, 'success', { min: 0.5 }), run(30 * 60_000, null, { status: 'in_progress' }),
  // last week: 1 of 4 passed
  run(8 * D, 'success'), run(9 * D, 'failure'), run(10 * D, 'failure'), run(13 * D, 'timed_out'),
  // older than both weeks, and one with no date: not counted
  run(20 * D, 'failure'), { id: 999, status: 'completed', conclusion: 'failure' }, null,
];
const REL = [
  { tag_name: 'addon-shop-v2', name: 'ルビーの店 v2', html_url: 'https://github.com/o/lab/releases/tag/addon-shop-v2', published_at: new Date(NOW - 2 * D).toISOString() },
  { tag_name: 'addon-old', name: 'old', html_url: 'https://github.com/o/lab/releases/tag/addon-old', published_at: new Date(NOW - 9 * D).toISOString() },
  { tag_name: 'addon-draft', name: 'draft', draft: true, created_at: new Date(NOW - D).toISOString() },
  { tag_name: 'x', name: '@everyone 見て', html_url: 'javascript:alert(1)', published_at: new Date(NOW - 3 * D).toISOString() },
];
const HOSTS = [{ slug: 'friend/host', runs: [run(D, 'success', { name: 'host', file: 'host.yml', min: 7 }), run(10 * D, 'success', { name: 'host', file: 'host.yml', min: 50 })] }, { slug: 'gone/host', runs: null }];

await t('report: the last 7 days counted — passed, failed, the rest; the share and last week\'s; minutes as stats counts them', () => {
  const r = W.report({ runs: RUNS, releases: REL, hosts: HOSTS, now: NOW, slug: 'o/lab' });
  const n = r.numbers;
  eq([n.runs, n.ok, n.bad, n.other], [8, 3, 3, 2], 'counts');
  eq(n.rate, 0.5); eq(n.prevRate, 0.25);
  // (3 + 10 + 10 + 10 + 1 + 2 + 1 (half a minute is one) — the run still going counts none)
  eq(n.minutes, 37, 'minutes');
  eq(n.days, ['2026-10-05', '2026-10-12']);
  eq(n.top, [{ name: 'unit', path: '.github/workflows/unit.yml', bad: 2, runs: 3 }, { name: 'ai-make', path: '.github/workflows/ai-make.yml', bad: 1, runs: 1 }]);
  eq(n.releases.map((x) => x.tag), ['addon-shop-v2', 'x'], 'this week\'s, no draft, newest first');
  eq(n.releases[1].url, '', 'an address that is not GitHub\'s is left out');
  eq(n.hosts, [{ slug: 'friend/host', minutes: 7, runs: 1, unread: false }, { slug: 'gone/host', minutes: 0, runs: 0, unread: true }]);
  eq(n.hostMinutes, 7);
  ok(r.text.startsWith('📰 週報（o/lab） 2026-10-05〜2026-10-12'), r.text);
  for (const re of [/▶ 実行 8 回: ✅ 通った 3・❌ 落ちた 3・➖ そのほか 2/, /📊 通った割合 50%（先週 25%）/, /⏱ 使った分（見積もり）: 37 分/, /1\. unit — 2 回（3 回のうち）/, /2\. ai-make — 1 回/,
    /📦 新しいリリース 2 件:/, /ルビーの店 v2（addon-shop-v2） https:\/\/github\.com\/o\/lab\/releases\/tag\/addon-shop-v2/, /friend\/host: 7 分（1 回）/, /gone\/host: 読めませんでした/, /合わせて 7 分/]) ok(re.test(r.text), `${re}\n${r.text}`);
  ok(!r.text.includes('@everyone') && r.text.includes('@​everyone'), 'no mention: an @ followed by a zero-width space');
  ok(!r.text.includes('javascript:') && !r.text.includes('addon-old') && !r.text.includes('addon-draft'), r.text);
  eq(r.lines.join('\n'), r.text, 'short: the lines as they are');
});
await t('report: a quiet week, a week with no decided run, the clock in another zone, partial', () => {
  const q = W.report({ runs: [], releases: [], hosts: [], now: NOW });
  ok(/この 7 日に始まった実行はありません/.test(q.text) && /新しいリリースはありません/.test(q.text) && /貸し手の Actions は使っていません/.test(q.text) && !/通った割合/.test(q.text) && !/落ちた実行はありません/.test(q.text), q.text);
  eq([q.numbers.rate, q.numbers.prevRate, q.numbers.minutes], [null, null, 0]);
  const c = W.report({ runs: [run(H, 'cancelled')], now: NOW });
  ok(/通った・落ちたで終わった実行がまだありません/.test(c.text) && /落ちた実行はありません/.test(c.text), c.text);
  eq(W.report({ now: Date.parse('2026-10-12T20:00:00Z'), tz: 'Asia/Tokyo' }).numbers.days, ['2026-10-06', '2026-10-13'], 'named in Tokyo\'s calendar');
  ok(/新しい 1 件だけを読みました/.test(W.report({ runs: [run(H, 'success')], now: NOW, partial: true }).text), 'partial said');
  eq(W.report({ runs: 'no', releases: null, hosts: [null, {}], now: 'not a date' }).numbers.runs, 0, 'what is not a list is none');
});
await t('report: never past Discord\'s 2000 (and notify\'s 1900): many long names cut, whole lines dropped with a word', () => {
  const long = 'あ'.repeat(500);
  const runs = Array.from({ length: 50 }, (_, i) => run(H * (i + 1), 'failure', { name: `${long}${i}`, file: `w${i}.yml` }));
  const releases = Array.from({ length: 20 }, (_, i) => ({ tag_name: `t${i}`, name: long, html_url: `https://github.com/o/lab/releases/tag/t${i}`, published_at: new Date(NOW - H * (i + 1)).toISOString() }));
  const hosts = Array.from({ length: 30 }, (_, i) => ({ slug: `owner${i}/${'h'.repeat(90)}`, runs: [] }));
  const r = W.report({ runs, releases, hosts, now: NOW, slug: 'o/lab' });
  ok(r.text.length <= W.LIMIT && W.LIMIT < 1900, `${r.text.length}`);
  ok(r.text.endsWith('…（長いので、ここまで）') && r.text.startsWith('📰'), r.text.slice(-40));
  ok(r.lines.length > r.text.split('\n').length, 'lines: all of them, before fitting');
  eq(r.numbers.top.length, W.TOP); ok(r.lines.includes('  ・ほか 15 件') && r.lines.includes('  ・ほか 20 人'), 'lists named up to their tops');
  ok(r.lines.every((l) => !/[\u0000-\u001f]/.test(l)) && r.lines.filter((l) => l.includes('あ')).every((l) => l.length < 160), 'one line each, names cut');
  eq(W.fit(['x'.repeat(3000)], 100).map((l) => l.length), [100], 'one line longer than the limit: cut');
  eq(W.fit(['a', 'b'], 100), ['a', 'b']);
  eq(W.word('a\n\tb  @here'), 'a b @​here');
});

// ---- the CLI against a fake GitHub ----
const TOKEN = 'ghs_secret_token_1234', HOOK = 'https://discord.com/api/webhooks/1/hook-secret-xyz';
async function fakeGitHub(init = {}) {
  const seen = [];
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method; let x; seen.push({ m, u, auth: req.headers.authorization });
      { const bad = fakeCheck(m, u, b ? JSON.parse(b) : null); if (bad) return send(res, 422, { message: bad.message }); }
      if (init.status) return send(res, init.status, { message: 'nope' });
      if ((x = /^\/repos\/o\/lab\/actions\/runs\?per_page=100&page=(\d+)&created=(.+)$/.exec(u))) {
        const all = init.many ? Array.from({ length: 600 }, (_, i) => run(H + i * 60_000, 'success')) : RUNS.filter(Boolean);
        return send(res, 200, { workflow_runs: all.slice((x[1] - 1) * 100, x[1] * 100) });
      }
      if (/^\/repos\/o\/lab\/releases\?per_page=30$/.test(u)) return send(res, 200, REL);
      if (/^\/repos\/friend\/host\/actions\/workflows\/host\.yml\/runs\?/.test(u)) return send(res, 200, { workflow_runs: HOSTS[0].runs });
      // (the panel reads the same runs through lib/gh.mjs)
      if (/^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/host\.yml\/runs\?/.test(u)) return send(res, 404, { message: 'Not Found' });
      if (m === 'POST' && /^\/repos\/o\/lab\/actions\/workflows\/notify\.yml\/dispatches$/.test(u)) { (init.dispatched ??= []).push(JSON.parse(b)); res.writeHead(204); return res.end(); }
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { seen, base, init, api: G.gh({ token: 'x', base }), close: () => srv.close() };
}
const cli = async (f, args, env = {}, sendImpl) => {
  const lines = [], sent = [];
  const r = await CLI.weeklyCmd(args, { out: (s) => lines.push(s), now: NOW, env: { GITHUB_REPOSITORY: 'o/lab', GITHUB_TOKEN: TOKEN, GITHUB_API_URL: f?.base, ...env },
    send: sendImpl ?? (async (title, rest, o) => { sent.push({ title, rest, o }); return true; }) });
  return { r, text: lines.join('\n'), lines, sent };
};

await t('CLI --dry: the same words as report, from GitHub\'s runs of 15 days, the releases and the lenders; nothing sent', async () => {
  const f = await fakeGitHub();
  try {
    const c = await cli(f, ['--dry', '--hosts', 'friend/host,gone/host,not a slug'], { LAB_NOTIFY_WEBHOOK: HOOK });
    eq(c.r, true, c.text); eq(c.sent, [], 'dry: nothing sent');
    const want = W.report({ runs: RUNS, releases: REL, hosts: HOSTS, now: NOW, slug: 'o/lab' }).text;
    ok(c.text.includes(want.split('\n').slice(0, 6).join('\n')), `${c.text}\n---\n${want}`);
    ok(/gone\/host: 読めませんでした/.test(c.text) && /W weekly: 貸し手 gone\/host の host\.yml を読めません/.test(c.text) && /送っていません/.test(c.text), c.text);
    ok(f.seen.some((s) => s.u.includes(`created=${encodeURIComponent('>=2026-09-27')}`)), f.seen.map((s) => s.u).join('\n'));
    ok(f.seen.every((s) => s.m === 'GET' && s.auth === `Bearer ${TOKEN}`), 'reads only, with the token');
    ok(!c.text.includes(TOKEN) && !c.text.includes('hook-secret'), 'no secret printed');
    const plain = await cli(f, []);
    eq([plain.r, plain.sent.length], [true, 0], 'no flag: as --dry');
  } finally { f.close(); }
});
await t('CLI --send: the first line as the title, the rest as lines, to LAB_NOTIFY_WEBHOOK; a refusal is exit 1; no webhook is said', async () => {
  const f = await fakeGitHub();
  try {
    const c = await cli(f, ['--send', '--hosts', 'friend/host'], { LAB_NOTIFY_WEBHOOK: HOOK, GITHUB_ACTIONS: 'true' });
    eq(c.r, true, c.text); eq(c.sent.length, 1);
    const s = c.sent[0];
    ok(s.title.startsWith('📰 週報（o/lab）') && s.o.url === HOOK && s.o.ok === false && s.rest.some((l) => /通った割合 50%/.test(l)), JSON.stringify(s));
    ok([s.title, ...s.rest].join('\n').length <= W.LIMIT, 'fits');
    ok(c.lines.includes(`::add-mask::${TOKEN}`) && c.lines.includes(`::add-mask::${HOOK}`), 'masked in Actions');
    ok(c.lines.filter((l) => !l.startsWith('::add-mask::')).every((l) => !l.includes(TOKEN) && !l.includes('hook-secret')) && /OK 週報を送りました/.test(c.text), c.text);
    // (notify's own words of a failure go through the same scrub)
    const bad = await cli(f, ['--send'], { LAB_NOTIFY_WEBHOOK: HOOK }, async (title, rest, o) => { o.out(`W notify: HTTP 404 ${HOOK}`); return false; });
    ok(bad.r === false && /FAIL 週報を送れませんでした/.test(bad.text) && !bad.text.includes('hook-secret'), bad.text);
    const none = await cli(f, ['--send']);
    ok(none.r === true && none.sent.length === 0 && /LAB_NOTIFY_WEBHOOK がないので送りません/.test(none.text), none.text);
    const both = await cli(f, ['--send', '--dry'], { LAB_NOTIFY_WEBHOOK: HOOK });
    eq(both.sent.length, 0, '--dry wins');
  } finally { f.close(); }
});
await t('CLI: no token or repository → exit 1 with the way; GitHub refusing → exit 1 in words; 500 runs read → said partial', async () => {
  const miss = await cli(null, ['--dry'], { GITHUB_TOKEN: '' });
  ok(miss.r === false && /GITHUB_REPOSITORY（owner\/名前）と GITHUB_TOKEN が要ります/.test(miss.text), miss.text);
  ok((await cli(null, [], { GITHUB_REPOSITORY: '../x' })).r === false, 'a repository that is no slug');
  let f = await fakeGitHub({ status: 401 });
  try { const c = await cli(f, ['--dry']); ok(c.r === false && /ERR weekly: o\/lab を読めません: HTTP 401.*トークンが受け付けられません/.test(c.text) && !c.text.includes(TOKEN), c.text); } finally { f.close(); }
  f = await fakeGitHub({ many: true });
  try {
    const c = await cli(f, ['--dry']);
    ok(c.r && /新しい 500 件だけを読みました/.test(c.text) && /実行 500 回/.test(c.text), c.text);
    eq(f.seen.filter((s) => s.u.includes('/actions/runs?')).length, CLI.MAX_PAGES, 'stops at MAX_PAGES');
  } finally { f.close(); }
  const net = await CLI.weeklyCmd(['--dry'], { out: () => {}, now: NOW, env: { GITHUB_REPOSITORY: 'o/lab', GITHUB_TOKEN: TOKEN }, fetchImpl: async () => { throw Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }); } });
  eq(net, false, 'no network: exit 1');
  const help = await cli(null, ['--help']);
  ok(help.r && /usage: node lab\.mjs weekly/.test(help.text), help.text);
});

// ---- the card on a small fake DOM ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    remove() {}
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null) };
  return { toast };
}
const settle = () => new Promise((r) => setTimeout(r, 120));
const btn = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];
/** a card's ctx: the role given decides through the policy (P.can), as panel.js's gate and guarded do */
const ctxOf = (f, { role = 'write', workflows, caps, rec = [], guards = [] } = {}) => {
  const may = (a) => P.can(P.DEFAULT_POLICY, role, a);
  return { api: f.api, lab: { slug: 'o/lab', workflows }, now: NOW, hosts: [{ slug: 'friend/host', repo: { html_url: 'https://github.com/friend/host' } }, { slug: 'gone/host', repo: {} }, { slug: 'err/host', error: 'x' }], caps,
    record: (a, d) => rec.push([a, d]), go: () => {},
    gate: (a) => (may(a) ? {} : { disabled: true, title: 'この役割ではできません' }),
    guarded: async (action, detail, fn, done) => { guards.push({ action, detail }); if (!may(action)) return undefined; const r = await fn(); if (done) (await imp('panel/ui/dom.mjs')).toast(done); return r; },
    dispatch: (wf, inputs) => f.api.dispatch('o/lab', wf, 'main', inputs) };
};

await t('the card: this week\'s draft shown as it will be sent; 「Discord に送る」 starts notify.yml with it through guarded(dispatch); reading records nothing', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/weekly.mjs'), f = await fakeGitHub();
  const rec = [], guards = [];
  try {
    const c = UI.weeklyCard(ctxOf(f, { rec, guards, workflows: [{ path: '.github/workflows/notify.yml' }] }));
    ok(btn(c, /Discord に送る/).disabled, 'waits for the draft');
    await settle();
    const pre = c.all((e) => e.tagName === 'PRE')[0], want = W.report({ runs: RUNS, releases: REL, hosts: [{ slug: 'friend/host', runs: HOSTS[0].runs }, { slug: 'gone/host', runs: null }], now: NOW, slug: 'o/lab' }).text;
    eq(pre?.textContent, want, 'the same words as the CLI');
    ok(!btn(c, /Discord に送る/).disabled && /2026-10-05〜2026-10-12/.test(c.textContent), c.textContent);
    ok(!f.seen.some((s) => s.u.includes('err/host')), 'a host that could not be read when connecting is not asked');
    eq(rec, [], 'only reading: nothing for the audit log');
    await btn(c, /Discord に送る/).click();
    eq(guards, [{ action: 'dispatch', detail: { workflow: 'notify.yml', weekly: '2026-10-05..2026-10-12' } }]);
    eq(f.init.dispatched, [{ ref: 'main', inputs: { run: '', message: want } }], 'notify.yml with the message');
    ok(/週報を Discord に送るよう頼みました/.test(toast.textContent), toast.textContent);
  } finally { f.close(); }
});
await t('the card: a role that may not start workflows, no notify.yml, Discord not set up — the button off and why, in words', async () => {
  fakeDom();
  const UI = await imp('panel/ui/weekly.mjs'), f = await fakeGitHub();
  try {
    const guards = [], r = UI.weeklyCard(ctxOf(f, { role: 'read', guards }));
    await settle();
    ok(btn(r, /Discord に送る/).disabled && /この役割ではできません/.test(r.textContent) && r.all((e) => e.tagName === 'PRE').length === 1, r.textContent);
    await btn(r, /Discord に送る/).click(); eq(guards, [], 'nothing asked');
    const w = UI.weeklyCard(ctxOf(f, { workflows: [{ path: '.github/workflows/verify.yml' }] }));
    await settle(); ok(btn(w, /Discord に送る/).disabled && /notify\.yml がありません/.test(w.textContent), w.textContent);
    const d = UI.weeklyCard(ctxOf(f, { caps: { notify: { ok: false, need: 'LAB_NOTIFY_WEBHOOK' } } }));
    await settle(); ok(btn(d, /Discord に送る/).disabled && /足りないもの: LAB_NOTIFY_WEBHOOK/.test(d.textContent) && btn(d, /「秘密」を開く/), d.textContent);
    eq(f.init.dispatched, undefined, 'nothing started');
  } finally { f.close(); }
});
await t('the card: a lab that cannot be read → the words of the failure (failView) and 「読み直す」 draws again', async () => {
  fakeDom();
  const UI = await imp('panel/ui/weekly.mjs');
  const f = await fakeGitHub({ status: 500 });
  try {
    const c = UI.weeklyCard(ctxOf(f));
    await settle();
    ok(/GitHub: 500/.test(c.textContent) && c.all((e) => e.attrs.role === 'alert').length === 1 && btn(c, /Discord に送る/).disabled && btn(c, /読み直す/), c.textContent);
    f.init.status = 0;
    await btn(c, /読み直す/).click(); await settle();
    ok(c.all((e) => e.tagName === 'PRE').length === 1 && !btn(c, /Discord に送る/).disabled, c.textContent);
  } finally { f.close(); }
});

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
