// connect-daily without a network: the CLI (common/connect-daily.mjs) against fake services on node:http — only the services
// whose secrets are there asked, every secret hidden first in Actions, one notice `connect-daily` and a warning for each broken
// one, Google's one-time oauth_token never spent, Discord told once (LAB_NOTIFY_WEBHOOK, not when LAB_NOTIFY is off or
// --no-notify), no secret's value anywhere in what is printed or sent — and the panel's side: the notice read for the screen
// (panel/lib/connectdaily.mjs), the scheduled run looked in first through a fake GitHub (reading only), and the card
// (panel/ui/connectdaily.mjs) on a small fake DOM: all well, broken, none yet, stopped, and a failure with the way on.
// node tests/connectdaily-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const CD = await imp('common/connect-daily.mjs'), D = await imp('panel/lib/connectdaily.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// values made at run time (the lab's secret scan reads this file)
const BOT = ['MTFAKE', 'bot-token', '0123456789abcdefghij'].join('.'), CF = `cf-token-${'k'.repeat(24)}`, ACC = '0123456789abcdef0123456789abcdef';
const ANT = ['sk', 'ant', 'fake-0123456789'].join('-'), OAUTH = ['oauth2', '4/FAKE-one-time-0123456789'].join('_'), AAS = ['aas', 'et/FAKE-aas-token-0123456789abcdefghijklmnop'].join('_');
const PW = 'pw-Very-Secret-42', HOOK_PATH = '/hook/s3cr3t-webhook-path';

// ---- the fake services (Discord, Cloudflare, Anthropic) and a webhook ----
const st = { seen: [], hook: [] };
const fake = http.createServer((req, res) => {
  let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://fake'), hd = req.headers;
    st.seen.push(u.pathname);
    const send = (status, j) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (u.pathname === HOOK_PATH) { st.hook.push(JSON.parse(b)); return send(200, {}); }
    if (u.pathname.startsWith('/discord/')) {
      if (hd.authorization !== `Bot ${BOT}`) return send(401, { message: '401: Unauthorized' });
      if (u.pathname === '/discord/users/@me') return send(200, { id: '1111111111111111111', username: 'lab-bot', bot: true });
      if (u.pathname === '/discord/oauth2/applications/@me') return send(200, { id: '2222222222222222222' });
    }
    // (Cloudflare: every token refused — the one that "went bad")
    if (u.pathname.startsWith('/cf/')) return send(401, { success: false, errors: [{ code: 1000 }] });
    if (u.pathname === '/ant/v1/models') return hd['x-api-key'] === ANT ? send(200, { data: [{ id: 'm' }] }) : send(401, { error: {} });
    send(404, {});
  });
}).listen(0, '127.0.0.1');
await new Promise((r) => fake.once('listening', r));
const BASE = `http://127.0.0.1:${fake.address().port}`;
const baseEnv = { DISCORD_API_URL: `${BASE}/discord`, CLOUDFLARE_API_URL: `${BASE}/cf`, ANTHROPIC_BASE_URL: `${BASE}/ant`, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/lab', GITHUB_RUN_ID: '77' };
const ALL = { DISCORD_BOT_TOKEN: BOT, DISCORD_USER_ID: '123456789012345678', CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: ACC, MS_EMAIL: 'me@example.com', MS_PASSWORD: PW, GOOGLE_EMAIL: 'me@gmail.com', GOOGLE_AAS_TOKEN: AAS, ANTHROPIC_API_KEY: ANT };
const NOW = Date.parse('2026-10-12T03:00:00Z');
// (the runner's escaping of a command's data undone: what GitHub keeps as the annotation's message)
const unesc = (s) => s.replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%25/g, '%');
async function daily(env, args = [], opts = {}) {
  const lines = [], sent = [];
  const r = await CD.dailyCmd(args, { env: { ...baseEnv, ...env }, out: (l) => lines.push(String(l)), now: () => new Date(NOW), notifyImpl: opts.notifyImpl ?? (async (title, ls, o) => { sent.push({ title, lines: ls, ...o }); return true; }) });
  const n = lines.find((l) => l.startsWith('::notice title=connect-daily::'));
  return { r, lines, sent, raw: n ? unesc(n.slice('::notice title=connect-daily::'.length)) : null, notice: n ? JSON.parse(unesc(n.slice('::notice title=connect-daily::'.length))) : null };
}
const noSecret = (text, secrets, m) => { for (const s of secrets) ok(!String(text).includes(s), `${m}: a secret's value printed`); };
const SECRET_VALUES = [BOT, CF, ANT, OAUTH, AAS, PW, HOOK_PATH];

await t('which services are there: only those with a secret (AI: OPENAI_BASE_URL too), in the tab\'s order (pure)', () => {
  eq(CD.configured({}), []);
  eq(CD.configured({ ANTHROPIC_API_KEY: 'x', DISCORD_USER_ID: '1', MS_PASSWORD: ' ' }), ['discord', 'ai']);
  eq(CD.configured({ OPENAI_BASE_URL: 'http://x' }), ['ai']);
  eq(CD.configured(ALL), ['discord', 'cloudflare', 'microsoft', 'google', 'ai']);
});

await t('one check kept small: ok, the form only, what is wrong and the next step on one line each; nothing else (pure)', () => {
  eq(CD.brief({ ok: true, bot: 'b', invite: 'https://discord.com/x', next: '招待\nリンク' }), { ok: true, next: '招待 リンク' });
  eq(CD.brief({ ok: true, verified: false, email: true }), { ok: true, verified: false });
  eq(CD.brief({ ok: false, anthropic: { ok: false, problem: '鍵が違います' } }), { ok: false, problem: '鍵が違います' });
  eq(CD.brief({ ok: false }), { ok: false, problem: '理由は分かりません' });
  eq(CD.brief({ ok: false, problem: 'x'.repeat(500) }).problem.length, 200);
  const s = CD.summary({ ai: { ok: true }, discord: { ok: false, problem: 'p' } }, 'T');
  eq(s, { ok: false, at: 'T', checked: ['discord', 'ai'], bad: ['discord'], services: { discord: { ok: false, problem: 'p' }, ai: { ok: true } } });
  const m = CD.message(s, { runUrl: 'https://github.com/o/lab/actions/runs/1' });
  ok(/Discord がつながりません/.test(m.title) && m.lines[0] === '・Discord: p' && m.lines.at(-1) === 'https://github.com/o/lab/actions/runs/1', JSON.stringify(m));
  ok(!CD.message(s, { runUrl: 'https://evil.example/x' }).lines.some((l) => /evil/.test(l)), 'only a GitHub link');
});

await t('a day with everything there: each service asked as the tab asks it, Cloudflare broken → the notice, a warning, E line, Discord told once; every secret masked first and its value nowhere else', async () => {
  const { r, lines, sent, notice } = await daily({ ...ALL, GOOGLE_OAUTH_TOKEN: OAUTH, LAB_NOTIFY_WEBHOOK: `${BASE}${HOOK_PATH}` });
  eq(r, false);
  eq(notice.checked, ['discord', 'cloudflare', 'microsoft', 'google', 'ai']); eq(notice.bad, ['cloudflare']); eq(notice.at, '2026-10-12T03:00:00.000Z'); eq(notice.ok, false);
  eq(notice.services.discord.ok, true); eq(notice.services.microsoft, { ok: true, verified: false, next: notice.services.microsoft.next }); eq(notice.services.google.ok, true); eq(notice.services.ai, { ok: true });
  ok(/CLOUDFLARE_API_TOKEN が違う/.test(notice.services.cloudflare.problem), notice.services.cloudflare.problem);
  const masks = lines.filter((l) => l.startsWith('::add-mask::')), first = lines.findIndex((l) => !l.startsWith('::add-mask::'));
  for (const v of [BOT, CF, ANT, AAS, PW, OAUTH, `${BASE}${HOOK_PATH}`]) ok(masks.includes(`::add-mask::${v}`), `masked: ${v.slice(0, 6)}`);
  ok(first === masks.length, 'masks before anything else');
  ok(lines.some((l) => /^::warning title=連携の不調 Cloudflare::.*CLOUDFLARE_API_TOKEN/.test(l)), 'a warning for the broken one');
  ok(lines.includes('E connect-daily cloudflare: ' + notice.services.cloudflare.problem) && lines.includes('OK connect-daily discord'), lines.join('\n'));
  noSecret(lines.filter((l) => !l.startsWith('::add-mask::')).join('\n'), SECRET_VALUES, 'printed');
  eq(sent.length, 1); eq(sent[0].ok, false); eq(sent[0].url, `${BASE}${HOOK_PATH}`);
  ok(/Cloudflare がつながりません/.test(sent[0].title) && sent[0].lines.includes('https://github.com/o/lab/actions/runs/77') && sent[0].lines.some((l) => /^・Cloudflare: /.test(l)), JSON.stringify(sent[0]));
  noSecret(JSON.stringify([sent[0].title, sent[0].lines]), SECRET_VALUES, 'sent');
  ok(!st.seen.some((p) => /google|play/i.test(p)), 'Google not asked on the network (its one-time value not spent)');
});

await t('Google: the one-time oauth_token alone is never spent (said broken, the way on); the AAS token\'s form looked at otherwise', async () => {
  const a = await daily({ GOOGLE_EMAIL: 'me@gmail.com', GOOGLE_OAUTH_TOKEN: OAUTH }, ['--no-notify']);
  eq(a.notice.bad, ['google']); ok(/AAS トークンになっていません/.test(a.notice.services.google.problem) && /連携/.test(a.notice.services.google.next), JSON.stringify(a.notice));
  const b = await daily({ GOOGLE_EMAIL: 'me@gmail.com', GOOGLE_AAS_TOKEN: OAUTH });
  eq(b.notice.bad, ['google']); ok(/oauth_token/.test(b.notice.services.google.problem), b.notice.services.google.problem);
  ok(!JSON.stringify(b.notice).includes(OAUTH), 'the value not in the notice');
});

await t('when Discord is not told: nothing broken, --no-notify, LAB_NOTIFY off, no webhook; nothing there → true, said so; a wrong word → usage', async () => {
  const good = await daily({ DISCORD_BOT_TOKEN: BOT, LAB_NOTIFY_WEBHOOK: `${BASE}${HOOK_PATH}` });
  eq([good.r, good.sent.length, good.notice.ok, good.notice.checked], [true, 0, true, ['discord']]);
  const bad = { CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: ACC, LAB_NOTIFY_WEBHOOK: `${BASE}${HOOK_PATH}` };
  eq((await daily(bad, ['--no-notify'])).sent.length, 0);
  eq((await daily({ ...bad, LAB_NOTIFY: 'OFF' })).sent.length, 0);
  eq((await daily({ CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: ACC })).sent.length, 0);
  const none = await daily({});
  eq([none.r, none.notice.checked, none.notice.ok], [true, [], true]); ok(none.lines.some((l) => /1 つも入っていません/.test(l)), none.lines.join('\n'));
  const use = await daily({}, ['--now']); eq(use.r, false); ok(/使い方/.test(use.lines[0]), use.lines[0]);
  const off = await daily({ GITHUB_ACTIONS: '', DISCORD_BOT_TOKEN: BOT });
  ok(!off.lines.some((l) => l.startsWith('::add-mask::')), 'masks only in Actions');
});

await t('the message really goes through common/notify.mjs to the webhook (a fake one), and a check that throws is a broken one', async () => {
  const N = await imp('common/notify.mjs');
  st.hook.length = 0;
  const r = await daily({ CLOUDFLARE_API_TOKEN: CF, CLOUDFLARE_ACCOUNT_ID: ACC, LAB_NOTIFY_WEBHOOK: `${BASE}${HOOK_PATH}` }, [], { notifyImpl: N.notify });
  eq(st.hook.length, 1); ok(st.hook[0].ok === false && /Cloudflare がつながりません/.test(st.hook[0].title), JSON.stringify(st.hook[0]));
  ok(r.lines.includes('OK connect-daily: Discord に知らせました'), r.lines.join('\n'));
  const lines = [];
  const x = await CD.dailyCmd([], { env: { ANTHROPIC_API_KEY: ANT }, out: (l) => lines.push(l), fetchImpl: async () => { throw Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }); }, notifyImpl: async () => true });
  eq(x, false); ok(lines.some((l) => /^E connect-daily ai: /.test(l)), lines.join('\n'));
  // (--text-out: the message alone in a file for `app notify --text` — written only when one is broken, never a value)
  const fsm = await import('node:fs'), os = await import('node:os'), dir = fsm.mkdtempSync(path.join(os.tmpdir(), 'daily-')), file = path.join(dir, 'daily.txt');
  try {
    const y = await CD.dailyCmd(['--no-notify', '--text-out', file], { env: { ANTHROPIC_API_KEY: ANT }, out: () => {}, fetchImpl: async () => { throw Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }); }, notifyImpl: async () => { throw new Error('--no-notify: nothing sent'); } });
    const text = fsm.readFileSync(file, 'utf8');
    ok(y === false && /AI/.test(text) && !text.includes(ANT), text);
    fsm.rmSync(file);
    eq(await CD.dailyCmd(['--text-out', file], { env: {}, out: () => {} }), true);
    ok(!fsm.existsSync(file), 'nothing broken: no file');
    eq(await CD.dailyCmd(['--text-out'], { env: {}, out: () => {} }), false, 'no file named: the usage');
  } finally { fsm.rmSync(dir, { recursive: true, force: true }); }
});

// ---- the panel's side ----
await t('the notice read for the screen: the services the tab knows, its words, broken ones named; anything else is no notice (pure)', async () => {
  const { raw } = await daily({ ...ALL }, ['--no-notify']);
  const d = D.parseDaily(raw);
  eq(d.services.map((s) => [s.key, s.ok]), [['discord', true], ['cloudflare', false], ['microsoft', true], ['google', true], ['ai', true]]);
  eq(d.bad, ['Cloudflare']); eq(d.ok, false); eq(d.at, NOW);
  ok(/^つながりません: CLOUDFLARE_API_TOKEN/.test(d.services[1].text) && /^形はよいです/.test(d.services[2].text) && d.services[0].text === 'つながりました', JSON.stringify(d.services));
  for (const x of ['', 'nope', '{}', '{"ok":true}', '[1]', null]) eq(D.parseDaily(x), null, String(x));
  eq(D.parseDaily(JSON.stringify({ ok: true, services: { evil: { ok: false }, ai: { ok: 'yes' } } })).services, [], 'unknown keys and odd values dropped');
  eq(D.parseDaily(JSON.stringify({ ok: true, services: { ai: { ok: false, problem: 'p' } } })).ok, false, 'ok only when every one is');
});

await t('which runs to look in: finished ones, the scheduled first, newest first, at most 3; how old in words (pure)', () => {
  const r = (id, event, at, status = 'completed') => ({ id, event, status, run_started_at: at });
  eq(D.candidates([r(1, 'workflow_dispatch', '2026-10-12T00:00:00Z'), r(2, 'schedule', '2026-10-10T00:00:00Z'), r(3, 'schedule', '2026-10-11T00:00:00Z'), r(4, 'schedule', '2026-10-12T00:00:00Z', 'in_progress'), r(5, 'workflow_dispatch', '2026-10-01T00:00:00Z')]).map((x) => x.id), [3, 2, 1]);
  eq(D.candidates(null), []);
  eq([D.age(NOW - 10 * 60_000, NOW), D.age(NOW - 5 * 3600_000, NOW), D.age(NOW - 30 * 3600_000, NOW), D.age(NOW - 3 * 86400_000, NOW), D.age(null, NOW)],
    [{ words: 'さっき', stale: false }, { words: '5 時間前', stale: false }, { words: 'きのう', stale: false }, { words: '3 日前', stale: true }, { words: 'いつか分かりません', stale: true }]);
});

// a fake GitHub on node:http: connect.yml's runs, their jobs and annotations (reading only; a write is checked by ghrules)
async function fakeGitHub(runs, notices) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method; let x;
      seen.push(`${m} ${u}`);
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      { const bad = fakeCheck(m, u, b ? JSON.parse(b) : null); if (bad) return send(422, { message: bad.message }); }
      if (u.startsWith('/repos/o/lab/actions/workflows/connect.yml/runs?')) return send(200, { workflow_runs: runs });
      if ((x = /^\/repos\/o\/lab\/actions\/runs\/(\d+)\/jobs\?/.exec(u))) return send(200, { jobs: [{ name: 'daily', check_run_url: `https://api.github.com/repos/o/lab/check-runs/${x[1]}9` }] });
      if ((x = /^\/repos\/o\/lab\/check-runs\/(\d+)9\/annotations\?/.exec(u))) return send(200, notices[x[1]] === undefined ? [] : [{ annotation_level: 'notice', title: 'connect-daily', message: notices[x[1]] }, { annotation_level: 'warning', title: 'x', message: 'y' }]);
      send(404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { seen, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base: `http://127.0.0.1:${srv.address().port}` }) };
}
const { raw: BAD } = await daily({ ...ALL }, ['--no-notify']);
const { raw: GOOD } = await daily({ DISCORD_BOT_TOKEN: BOT }, ['--no-notify']);
const RUNS = [
  { id: 30, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', run_started_at: '2026-10-12T02:00:00Z', html_url: 'https://github.com/o/lab/actions/runs/30' },
  { id: 20, event: 'schedule', status: 'completed', conclusion: 'failure', run_started_at: '2026-10-12T00:00:00Z', html_url: 'https://github.com/o/lab/actions/runs/20' },
  { id: 10, event: 'schedule', status: 'completed', conclusion: 'success', run_started_at: '2026-10-11T00:00:00Z', html_url: 'https://github.com/o/lab/actions/runs/10' }];

await t('the newest daily check read through GitHub: the scheduled run first, an older one when the newest has no notice; GETs only; none → null', async () => {
  const g = await fakeGitHub(RUNS, { 10: GOOD, 30: GOOD });
  try {
    const f = await D.readDaily(g.api, 'o/lab');
    eq([f.run.id, f.daily.ok, f.daily.services.map((s) => s.key)], [10, true, ['discord']]);
    ok(g.seen.every((s) => s.startsWith('GET ')), g.seen.join('\n'));
    ok(g.seen.indexOf('GET /repos/o/lab/actions/runs/20/jobs?per_page=100') < g.seen.indexOf('GET /repos/o/lab/actions/runs/10/jobs?per_page=100'), 'newest scheduled first');
  } finally { g.close(); }
  const g2 = await fakeGitHub(RUNS, {});
  try { eq(await D.readDaily(g2.api, 'o/lab'), null); } finally { g2.close(); }
});

await t('what the card says: all well, broken (named), none yet, a check that stopped; only a GitHub link (pure)', () => {
  const run = { html_url: 'https://github.com/o/lab/actions/runs/1' };
  const v = D.view({ run, daily: D.parseDaily(BAD) }, NOW + 3600_000);
  eq([v.tone, v.head, v.when, v.url], ['bad', 'Cloudflare がつながらなくなっています', '1 時間前', run.html_url]);
  eq(D.view({ run, daily: D.parseDaily(GOOD) }, NOW).tone, 'ok');
  const s = D.view({ run: { html_url: 'https://evil.example/x' }, daily: D.parseDaily(GOOD) }, NOW + 4 * 86400_000);
  ok(s.tone === 'stale' && /4 日前/.test(s.head) && /止まっている/.test(s.head) && s.url === null, JSON.stringify(s));
  eq(D.view(null).tone, 'none'); ok(/まだ/.test(D.view(null).head), 'none said');
  ok(/1 つも入っていません/.test(D.view({ run, daily: D.parseDaily(JSON.stringify({ ok: true, at: new Date(NOW).toISOString(), services: {} })) }, NOW).head), 'nothing there');
});

// ---- a small DOM: enough for panel/ui/dom.mjs's h and the card ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: () => new E('div'), body: new E('body') };
  return { E };
}

await t('the card on a fake DOM: 「読んでいます…」 at once, then broken ones named with the next step and the run\'s GitHub link; reads only', async () => {
  fakeDom();
  const U = await imp('panel/ui/connectdaily.mjs');
  const g = await fakeGitHub(RUNS, { 20: BAD });
  try {
    const el = U.connectDailyCard({ api: g.api, lab: { slug: 'o/lab' }, now: NOW + 3600_000 });
    ok(/読んでいます/.test(el.textContent), el.textContent);
    await el.ready;
    const text = el.textContent;
    ok(/⚠️ Cloudflare がつながらなくなっています/.test(text) && /Cloudflare: つながりません: CLOUDFLARE_API_TOKEN/.test(text) && /✅ Discord: つながりました/.test(text) && /最後の確かめ: 1 時間前/.test(text) && /「つなぐ」で/.test(text), text);
    const a = el.all((e) => e.tagName === 'A');
    eq(a.map((x) => x.attrs.href), ['https://github.com/o/lab/actions/runs/20']);
    ok(el.all((e) => e.attrs.role === 'alert').length === 1, 'the broken state is an alert');
    ok(g.seen.every((s) => s.startsWith('GET ')), 'reads only');
    noSecret(text, SECRET_VALUES, 'the card');
  } finally { g.close(); }
});

await t('the card: none yet, and a failure said with the way on and 「もう一度読む」 that reads again', async () => {
  const U = await imp('panel/ui/connectdaily.mjs');
  const g = await fakeGitHub([], {});
  try { const el = U.connectDailyCard({ api: g.api, lab: { slug: 'o/lab' }, now: NOW }); await el.ready; ok(/❔ まだ毎日の確かめの結果がありません/.test(el.textContent), el.textContent); } finally { g.close(); }
  let calls = 0;
  const api = { runs: async () => { calls++; if (calls === 1) throw new Error('GitHub に届きません'); return RUNS; }, jobs: async () => [{ check_run_url: 'https://api.github.com/repos/o/lab/check-runs/209' }], annotations: async () => [{ annotation_level: 'notice', title: 'connect-daily', message: GOOD }] };
  const el = U.connectDailyCard({ api, lab: { slug: 'o/lab' }, now: NOW });
  await el.ready;
  ok(/GitHub に届きません/.test(el.textContent) && el.all((e) => e.attrs.role === 'alert').length === 1, el.textContent);
  const again = el.all((e) => e.tagName === 'BUTTON' && e.textContent === 'もう一度読む');
  eq(again.length, 1);
  await again[0].click();
  ok(/✅ ぜんぶ、つながっています/.test(el.textContent), el.textContent);
});

fake.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
