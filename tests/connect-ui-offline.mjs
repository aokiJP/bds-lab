// the panel's 「連携」 tab without a browser or a network: the services and the shape of each value (pure), their state from the
// lab's secret names, the check's notice read for the screen (links only to the official pages), connect.yml started and
// waited for as this person's own run (a fake GitHub on node:http that opens the sealed secrets), and the tab on a small fake
// DOM: a wrong shape stopped before anything is sent, the value sealed and the field emptied, the result and the next step,
// 「全部つなぐ」 in order, and a role the policy does not allow told why.
// node tests/connect-ui-offline.mjs
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const C = await imp('panel/lib/connect.mjs'), G = await imp('panel/lib/gh.mjs'), SEAL = await imp('panel/lib/seal.mjs'), P = await imp('panel/lib/policy.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// values made at run time (the lab's secret scan reads this file)
const BOT = `${'A'.repeat(24)}.${'b'.repeat(6)}.${'C'.repeat(27)}`, UID = '123456789012345678', CF = `cf-${'x'.repeat(30)}`, ACC = '0123456789abcdef0123456789abcdef';
const OAUTH = `oauth2_4/${'z'.repeat(40)}`, ANT = `sk-ant-${'q'.repeat(30)}`;
const INVITE = 'https://discord.com/oauth2/authorize?client_id=1&scope=bot';

async function fakeGitHub(init = {}) {
  const sk = crypto.randomBytes(32), pk = SEAL.x25519Public(sk);
  const st = { secrets: new Map(), runs: [], dispatched: [], seen: [], notices: init.notices ?? {}, conclusion: init.conclusion ?? 'success', intruders: init.intruders ?? false };
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === null || j === undefined ? '' : JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method, body = b ? JSON.parse(b) : null; let x;
      st.seen.push(`${m} ${u}`);
      { const bad = fakeCheck(m, u, body); if (bad) return send(res, 422, { message: bad.message }); } // (GitHub's rules for a write: ghrules)
      if (u === '/repos/o/lab/actions/secrets/public-key') return send(res, 200, { key_id: 'KID', key: SEAL.toB64(pk) });
      if ((x = /^\/repos\/o\/lab\/actions\/secrets\/(\w+)$/.exec(u)) && m === 'PUT') { if (x[1] === init.failSecret) return send(res, 403, { message: 'Resource not accessible by integration' }); st.secrets.set(x[1], body); return send(res, 201, null); }
      if ((x = /^\/repos\/o\/lab\/actions\/workflows\/connect\.yml\/dispatches$/.exec(u)) && m === 'POST') {
        st.dispatched.push(body);
        if (st.intruders) st.runs.unshift({ id: 7001, status: 'completed', conclusion: 'success', event: 'pull_request', head_branch: 'main', actor: { login: 'mallory' }, service: 'evil' });
        st.runs.unshift({ id: 100 + st.runs.length, status: 'queued', conclusion: null, event: 'workflow_dispatch', head_branch: body.ref, actor: { login: 'o' }, triggering_actor: { login: 'o' }, service: body.inputs.service });
        return send(res, 204, null);
      }
      if (/^\/repos\/o\/lab\/actions\/workflows\/connect\.yml\/runs\?/.test(u)) {
        const out = st.runs.map((r) => ({ ...r }));
        for (const r of st.runs) if (r.status === 'queued') r.status = 'in_progress'; else if (r.status === 'in_progress') { r.status = 'completed'; r.conclusion = st.conclusion; }
        return send(res, 200, { workflow_runs: out });
      }
      if ((x = /^\/repos\/o\/lab\/actions\/runs\/(\d+)\/jobs\?/.exec(u))) return send(res, 200, { jobs: [{ name: 'connect', check_run_url: `https://api.github.com/repos/o/lab/check-runs/${x[1]}1` }] });
      if ((x = /^\/repos\/o\/lab\/check-runs\/(\d+)1\/annotations\?/.exec(u))) {
        const run = st.runs.find((r) => String(r.id) === x[1]), msg = run && st.notices[run.service];
        return send(res, 200, msg === undefined ? [] : [{ annotation_level: 'notice', title: `connect-${run.service}`, message: msg }]);
      }
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const open = (name) => {
    const s = SEAL.fromB64(st.secrets.get(name).encrypted_value), epk = s.subarray(0, 32), nonce = SEAL.blake2b(Buffer.concat([epk, pk]), 24), k = SEAL.hsalsa20(SEAL.x25519(sk, epk), new Uint8Array(16));
    return new TextDecoder().decode(SEAL.secretbox(s.subarray(48), nonce, k).subarray(16));
  };
  return { st, open, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base: `http://127.0.0.1:${srv.address().port}` }) };
}
const QUICK = { sleep: async () => {}, every: 1, timeoutMs: 50, me: 'o' };
const J = (o) => JSON.stringify(o);

await t('the services: five, in order, each with its secrets, steps and fields; every link is an official page; the shape of each value checked without repeating it (pure)', () => {
  eq(C.SERVICES.map((s) => s.key), ['discord', 'cloudflare', 'microsoft', 'google', 'ai']);
  eq(C.SERVICES.flatMap((s) => s.secrets), ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'MS_EMAIL', 'MS_PASSWORD', 'GOOGLE_EMAIL', 'GOOGLE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
  for (const s of C.SERVICES) {
    ok(s.why && s.steps.length && eqSet(s.fields.map((f) => f.name), s.secrets), `${s.key}: shape`);
    for (const st of s.steps) ok(st.say && (!st.link || C.safeLink(st.link)), `${s.key}: ${st.link}`);
  }
  const f = (svc, name) => C.serviceOf(svc).fields.find((x) => x.name === name);
  const cases = [['discord', 'DISCORD_BOT_TOKEN', BOT, 'abc'], ['discord', 'DISCORD_USER_ID', UID, '12ab'], ['cloudflare', 'CLOUDFLARE_API_TOKEN', CF, 'short'], ['cloudflare', 'CLOUDFLARE_ACCOUNT_ID', ACC, 'xyz'],
    ['microsoft', 'MS_EMAIL', 'a@b.example', 'nope'], ['microsoft', 'MS_PASSWORD', 'pw', ''], ['google', 'GOOGLE_EMAIL', 'a@b.example', 'a@b'], ['google', 'GOOGLE_OAUTH_TOKEN', OAUTH, 'abcdefghijklmnop'],
    ['ai', 'ANTHROPIC_API_KEY', ANT, 'sk-xx'], ['ai', 'OPENAI_API_KEY', 'sk-' + 'o'.repeat(30), 'key']];
  for (const [svc, n, good, bad] of cases) { eq(f(svc, n).check(good), null, `${n} good`); const p = f(svc, n).check(bad); ok(p && !p.includes(bad || '\0'), `${n} bad: ${p}`); }
  ok(f('discord', 'DISCORD_BOT_TOKEN').secret && f('cloudflare', 'CLOUDFLARE_API_TOKEN').secret && f('microsoft', 'MS_PASSWORD').secret && f('google', 'GOOGLE_OAUTH_TOKEN').secret && !f('discord', 'DISCORD_USER_ID').secret, 'secret fields');
  const d = C.serviceOf('discord');
  eq(Object.keys(C.problems(d, {}, [])), ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID'], 'empty: both asked');
  eq(C.problems(d, {}, d.secrets), {}, 'kept: may stay empty (a new check only)');
  eq(Object.keys(C.problems(d, { DISCORD_BOT_TOKEN: 'x', DISCORD_USER_ID: UID }, [])), ['DISCORD_BOT_TOKEN']);
  const ai = C.serviceOf('ai');
  eq(C.problems(ai, { ANTHROPIC_API_KEY: ANT }, []), {}, 'one of the two is enough');
  eq(Object.keys(C.problems(ai, {}, [])), ['ANTHROPIC_API_KEY'], 'none at all');
  eq(C.safeLink('https://evil.example/x'), null); eq(C.safeLink('http://discord.com/x'), null); eq(C.safeLink('https://discord.com.evil.example/'), null); eq(C.safeLink('javascript:alert(1)'), null); eq(C.safeLink('https://u:p@discord.com/'), null);
  ok(C.safeLink(INVITE) && C.safeLink('https://github.com/o/lab/actions'), 'the official pages');
});
function eqSet(a, b) { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }

await t('status: missing / not checked / tied / failed from the secret names and what a check said; parseResult shows names and yes/no, a link only to an official page (pure)', () => {
  const by = (s, c) => Object.fromEntries(C.status(s, c).map((x) => [x.key, x.state]));
  eq(by([], {}), { discord: 'missing', cloudflare: 'missing', microsoft: 'missing', google: 'missing', ai: 'missing' });
  eq(by(['DISCORD_BOT_TOKEN'], {}).discord, 'missing'); eq(C.status(['DISCORD_BOT_TOKEN'], {})[0].missing, ['DISCORD_USER_ID']);
  eq(by(['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID'], {}).discord, 'unchecked');
  eq(by(['OPENAI_API_KEY'], {}).ai, 'unchecked', 'either AI key');
  eq(by(['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID'], { discord: { ok: true } }).discord, 'ok');
  eq(by(['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID'], { discord: { ok: false } }).discord, 'bad');
  eq(by([], { discord: { ok: true } }).discord, 'missing', 'a check does not make a missing secret tied');
  const r = C.parseResult(J({ ok: true, who: 'Lab Bot', id: '42', next: { say: 'ボットをサーバーに入れます', url: INVITE } }));
  eq([r.ok, r.text, r.next], [true, 'つながりました（Lab Bot・42）', { say: 'ボットをサーバーに入れます', url: INVITE }]);
  eq(C.parseResult(J({ ok: false, why: 'トークンが違います' })).text, 'つながりません: トークンが違います');
  eq(C.parseResult(J({ ok: true, next: { say: 's', url: 'https://evil.example/' } })).next, { say: 's', url: null }, 'a link that is not official is dropped');
  for (const bad of ['', 'not json', '{"x":1}', null]) { const p = C.parseResult(bad); ok(!p.ok && /読めません/.test(p.text), `unreadable: ${bad}`); }
});

await t('runCheck: connect.yml started with the service, this person\'s own new run waited for (not a fork\'s, not an earlier one), its notice read; a failed run keeps its reason; no notice says so', async () => {
  const f = await fakeGitHub({ notices: { discord: J({ ok: true, who: 'Bot', next: { say: '入れる', url: INVITE } }), cloudflare: J({ ok: false, why: 'トークンが違います' }) }, intruders: true });
  try {
    const steps = [], r = await C.runCheck(f.api, 'o/lab', 'discord', { ...QUICK, onStep: (s) => steps.push(s) });
    eq([r.ok, r.next.url], [true, INVITE]); eq(f.st.dispatched, [{ ref: 'main', inputs: { service: 'discord' } }]); ok(steps.length, 'told');
    f.st.conclusion = 'failure';
    const r2 = await C.runCheck(f.api, 'o/lab', 'cloudflare', QUICK);
    eq([r2.ok, r2.text], [false, 'つながりません: トークンが違います'], 'the reason of a failed run');
    let e = null; try { await C.runCheck(f.api, 'o/lab', 'google', QUICK); } catch (x) { e = x; }
    ok(e && /failure で終わりました/.test(e.message), e?.message);
    f.st.conclusion = 'success';
    e = null; try { await C.runCheck(f.api, 'o/lab', 'microsoft', QUICK); } catch (x) { e = x; }
    ok(e && /結果/.test(e.message), e?.message);
    e = null; try { await C.runCheck(f.api, 'o/lab', 'nope', QUICK); } catch (x) { e = x; }
    ok(e && /知らないサービス/.test(e.message), 'unknown service');
    e = null; try { await C.runCheck(f.api, 'o/lab', 'ai', { ...QUICK, me: '../x' }); } catch (x) { e = x; }
    ok(e && /ログイン名/.test(e.message), 'no who');
    f.st.runs.length = 0; f.st.conclusion = 'success'; f.st.notices.ai = J({ ok: true });
    e = null; try { await C.runCheck(f.api, 'o/lab', 'ai', { ...QUICK, me: 'someoneelse' }); } catch (x) { e = x; }
    ok(e && /時間内/.test(e.message), 'only this person\'s own run is waited for');
  } finally { f.close(); }
});

// ---- a small DOM: enough for panel/ui/dom.mjs's h and the tab ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, open: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
const LAB = (over = {}) => ({ slug: 'o/lab', role: 'admin', secrets: [], ...over });
const card = (body, key) => body.all((e) => e.attrs['data-service'] === key)[0];
const field = (c, label) => c.all((e) => e.tagName === 'INPUT' && e.attrs['aria-label'] === label)[0];
const button = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];

await t('the 「連携」 tab: a card for each service with its state, steps and official links; secret fields are password fields not offered to the browser; a wrong shape is stopped before anything is sent', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/connect.mjs'), f = await fakeGitHub();
  try {
    const body = new E('div');
    await UI.connectTab(body, { api: f.api, lab: LAB(), me: { login: 'o' } });
    eq(body.all((e) => e.attrs['data-service']).map((e) => e.attrs['data-service']), ['discord', 'cloudflare', 'microsoft', 'google', 'ai']);
    const d = card(body, 'discord');
    ok(/⚠️ 未/.test(d.textContent), d.textContent);
    const hrefs = body.all((e) => e.tagName === 'A').map((a) => a.attrs.href);
    ok(hrefs.length >= 6 && hrefs.every((h) => C.safeLink(h)) && body.all((e) => e.tagName === 'A').every((a) => a.attrs.rel === 'noopener noreferrer' && a.attrs.target === '_blank'), hrefs.join());
    const tok = field(d, 'ボットのトークン'), uid = field(d, 'あなたのユーザー ID');
    eq([tok.attrs.type, tok.attrs.autocomplete, uid.attrs.type], ['password', 'off', 'text']);
    tok.value = 'abc'; uid.value = UID;
    await button(d, /封じて登録/).click();
    ok(/ボットのトークンの形が違います/.test(d.textContent) && !f.st.seen.length, 'stopped before any request');
    ok(!d.textContent.includes('abc'), 'the wrong value not repeated');
  } finally { f.close(); }
});

await t('封じて登録して確かめる: each value sealed (GitHub opens them), the fields emptied, connect.yml dispatched with the service, the result and the next step (Discord\'s invite) shown, the state ✅, the record without values; nothing in the page', async () => {
  const { E, toast } = fakeDom(), UI = await imp('panel/ui/connect.mjs');
  const f = await fakeGitHub({ notices: { discord: J({ ok: true, who: 'Lab Bot', next: { say: 'ボットをサーバーに入れてください', url: INVITE } }) } });
  const orig = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...a) => orig(fn, ms > 100 ? 1 : 1, ...a);
  try {
    const recs = [], lab = LAB(), body = new E('div');
    await UI.connectTab(body, { api: f.api, lab, me: { login: 'o' }, record: (a, d) => recs.push([a, d]) });
    const d = card(body, 'discord'), tok = field(d, 'ボットのトークン'), uid = field(d, 'あなたのユーザー ID');
    tok.value = BOT; uid.value = UID;
    await button(d, /封じて登録/).click();
    eq([f.open('DISCORD_BOT_TOKEN'), f.open('DISCORD_USER_ID')], [BOT, UID], 'sealed');
    eq([tok.value, uid.value], ['', ''], 'the fields emptied');
    eq(f.st.dispatched, [{ ref: 'main', inputs: { service: 'discord' } }]);
    eq(lab.secrets, ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID']);
    ok(/✅ つながりました（Lab Bot）/.test(d.textContent) && /✅ つながっている/.test(d.textContent), d.textContent);
    const a = d.all((e) => e.tagName === 'A' && e.attrs.href === INVITE);
    ok(a.length === 1, 'the invite link as the next step');
    eq(recs, [['connect.discord', { ok: true }]]);
    const page = `${body.textContent}${toast.textContent}${JSON.stringify(recs)}`;
    ok(!page.includes(BOT) && !page.includes(UID), 'no value anywhere in the page');
  } finally { globalThis.setTimeout = orig; f.close(); }
});

await t('a check that fails or cannot be made: the words and the way on in place (failView), the fields emptied; GitHub refusing a secret stops before any run', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/connect.mjs');
  const f = await fakeGitHub({ notices: { cloudflare: J({ ok: false, why: 'トークンが違います' }) }, failSecret: 'MS_PASSWORD' });
  try {
    const body = new E('div');
    await UI.connectTab(body, { api: f.api, lab: LAB(), me: { login: 'o' } });
    const c = card(body, 'cloudflare'), tk = field(c, 'API トークン');
    tk.value = CF; field(c, 'アカウント ID').value = ACC;
    await button(c, /封じて登録/).click();
    ok(/⚠️ つながりません: トークンが違います/.test(c.textContent) && /つながらなかった/.test(c.textContent) && tk.value === '', c.textContent);
    const m = card(body, 'microsoft'), pw = field(m, 'パスワード');
    field(m, 'Microsoft アカウントのメール').value = 'a@b.example'; pw.value = 'hunter2hunter2';
    const before = f.st.dispatched.length;
    await button(m, /封じて登録/).click();
    ok(m.all((e) => e.attrs.role === 'alert').length === 1 && /権限がありません|Resource|受け付け/.test(m.textContent) && pw.value === '' && f.st.dispatched.length === before, m.textContent);
    ok(!m.textContent.includes('hunter2'), 'the password not shown');
  } finally { f.close(); }
});

await t('全部つなぐ: the services not yet tied opened from the top, one after another as each is tied; a failure stops it; the tied are skipped', async () => {
  const { E } = fakeDom(), UI = await imp('panel/ui/connect.mjs');
  const f = await fakeGitHub({ notices: { discord: J({ ok: true }), cloudflare: J({ ok: false, why: 'x' }), microsoft: J({ ok: true }) } });
  try {
    const body = new E('div'), lab = LAB({ secrets: ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID', 'MS_EMAIL', 'MS_PASSWORD'] });
    await UI.connectTab(body, { api: f.api, lab, me: { login: 'o' } });
    const opened = () => ['discord', 'cloudflare', 'microsoft', 'google', 'ai'].filter((k) => card(body, k).all((e) => e.tagName === 'DETAILS')[0].open);
    eq(opened(), []);
    await button(body, /全部つなぐ/).click();
    eq(opened(), ['discord'], 'the first not yet checked');
    await button(card(body, 'discord'), /封じて登録/).click();   // (kept secrets: no new value needed, only a check)
    eq(opened(), ['discord', 'cloudflare'], 'then the next');
    ok(/つぎは Cloudflare/.test(body.textContent), body.textContent);
    const c = card(body, 'cloudflare');
    field(c, 'API トークン').value = CF; field(c, 'アカウント ID').value = ACC;
    await button(c, /封じて登録/).click();
    ok(/止めました/.test(body.textContent) && !opened().includes('microsoft'), 'a failure stops the run');
    await button(body, /全部つなぐ/).click();
    eq(opened().at(-1), 'cloudflare', 'again from the first not tied');
    const skip = button(c, /とばして次へ/); await skip.click();
    eq(opened().at(-1), 'microsoft', 'skipped to the next');
  } finally { f.close(); }
});

await t('the policy and GitHub\'s role: a role that may not put secrets or start a workflow (or a reader) gets the reason, no field and no button that works; nothing is sent', async () => {
  const { E, toast } = fakeDom(), UI = await imp('panel/ui/connect.mjs'), f = await fakeGitHub();
  try {
    const { policy } = P.checkPolicy({ version: 1, roles: { admin: ['*'], write: ['dispatch'] } });
    for (const [lab, role, re] of [[LAB({ role: 'write' }), 'write', /秘密を登録する/], [LAB({ role: 'read' }), 'read', /write 以上/]]) {
      const body = new E('div');
      await UI.connectTab(body, { api: f.api, lab, role, policy, me: { login: 'o' } });
      ok(re.test(body.textContent) && !body.all((e) => e.tagName === 'INPUT').length, body.textContent);
      await button(body, /全部つなぐ/).click();
      ok(re.test(toast.textContent), 'told again when pressed');
    }
    ok(!f.st.seen.length, 'nothing sent');
    const adm = new E('div');
    await UI.connectTab(adm, { api: f.api, lab: LAB(), role: 'admin', policy, me: { login: 'o' } });
    ok(adm.all((e) => e.tagName === 'INPUT').length === 10, 'the administrator gets the fields');
  } finally { f.close(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
