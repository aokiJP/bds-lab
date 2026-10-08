// the management panel's parts without a browser or a network (panel/lib/*.mjs are plain modules: Node runs them as the
// browser does): who may use it, what each repository's settings allow, the workflows' input forms from their real YAML,
// a run's progress, a host's rules (held equal to common/hosts.mjs) and minutes, the secret sealed as libsodium seals it
// (vectors made with libsodium itself), the live issue's lines sealed and read the same way as app/lib on the runner, the
// GitHub client against a fake API, and the local server (`node lab.mjs panel`) that serves only the panel.
// node tests/panel-offline.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const M = await imp('panel/lib/model.mjs'), SEAL = await imp('panel/lib/seal.mjs'), PV = await imp('panel/lib/vault.mjs'), LF = await imp('panel/lib/livefmt.mjs'), G = await imp('panel/lib/gh.mjs');
const H = await imp('common/hosts.mjs'), AV = await imp('app/lib/vault.mjs'), AL = await imp('app/lib/live.mjs'), PANEL = await imp('common/panel.mjs'), PG = await imp('panel/lib/pages.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const hex = (b) => Buffer.from(b).toString('hex');

await t('who may use it: write or admin on the lab, or lend (admin) / borrow (write) a host; anyone else is told why (pure)', () => {
  eq(M.roleOf({ admin: true }), 'admin'); eq(M.roleOf({ push: true }), 'write'); eq(M.roleOf({ maintain: true }), 'write'); eq(M.roleOf({ pull: true }), 'read'); eq(M.roleOf(null), null);
  eq(M.access({ lab: { permissions: { admin: true } } }), { ok: true, as: ['admin'], why: '' });
  eq(M.access({ lab: null, hosts: [{ permissions: { admin: true } }, { permissions: { push: true } }] }).as, ['lender', 'borrower']);
  const no = M.access({ lab: { permissions: { pull: true } }, hosts: [{ permissions: { pull: true } }] });
  ok(!no.ok && /書き込める人/.test(no.why) && /貸している/.test(no.why), JSON.stringify(no));
  ok(!M.access({ lab: null }).ok, 'nothing visible: no');
});

await t('what a repository\'s own settings allow: its secrets\' names and workflows; unknown when the token may not list secrets (pure)', () => {
  const wf = ['app.yml', 'notify.yml', 'secrets.yml', 'verify.yml'].map((f) => ({ path: `.github/workflows/${f}` }));
  const all = M.capabilities({ secrets: ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID', 'LAB_SECRETS_TOKEN', 'GOOGLE_EMAIL', 'GOOGLE_AAS_TOKEN', 'MS_EMAIL', 'APP_CACHE_KEY'], workflows: wf, visibility: 'public' });
  ok(all.every((c) => c.ok === true && c.need === ''), JSON.stringify(all));
  const bare = Object.fromEntries(M.capabilities({ secrets: ['DISCORD_BOT_TOKEN'], workflows: wf }).map((c) => [c.key, c]));
  ok(bare.discord.ok === false && /DISCORD_USER_ID/.test(bare.discord.need) && bare.notify.ok === false && /このパネルの「秘密」からなら/.test(bare.secretsForm.need), JSON.stringify(bare));
  const hook = Object.fromEntries(M.capabilities({ secrets: ['LAB_NOTIFY_WEBHOOK'], workflows: wf }).map((c) => [c.key, c]));
  ok(hook.notify.ok === true && hook.discord.ok === false, 'a webhook is enough for notify');
  ok(M.capabilities({ secrets: null, workflows: wf }).every((c) => c.ok === null && /Secrets: Read/.test(c.need)), 'not allowed to look: unknown, said why');
  ok(M.capabilities({ secrets: [], workflows: [{ path: '.github/workflows/host.yml' }], host: true })[0].ok === true, 'a host: host.yml');
  for (const k of Object.keys(M.KNOWN_SECRETS)) ok(/^[A-Z_]+$/.test(k), k);
});

await t('the workflows\' inputs from their real YAML: choices, booleans, defaults; every preset names inputs its workflow has (pure)', () => {
  const y = (f) => fs.readFileSync(path.join(TOP, '.github', 'workflows', f), 'utf8');
  const app = M.dispatchInputs(y('app.yml')), by = Object.fromEntries(app.inputs.map((i) => [i.name, i]));
  ok(app.dispatch && by.mode.options.join() === 'run,ui,ui-all,hold' && by.mode.default === 'run' && by.account.type === 'boolean' && by.account.default === 'true' && by.hold.default === '0' && /hold/.test(by.hold.description), JSON.stringify(by.mode));
  eq(M.dispatchInputs(y('secrets.yml')).inputs.map((i) => [i.name, i.default]), [['names', 'MS_EMAIL,MS_PASSWORD'], ['minutes', '10']]);
  eq(M.dispatchInputs(y('verify.yml')), { dispatch: true, inputs: [] });
  eq(M.dispatchInputs('on:\n  push:\n    branches: [main]\n'), { dispatch: false, inputs: [] });
  eq(M.dispatchInputs('on: [push, workflow_dispatch]\n').dispatch, true);
  const inline = M.dispatchInputs("on:\n  workflow_dispatch:\n    inputs:\n      a: { description: 'x, y', default: 'q', type: choice, options: [q, r] }\n      b:\n        type: boolean\n        options:\n          - one\n          - 'two'\n");
  eq(inline.inputs.map((i) => [i.name, i.type, i.default, i.options]), [['a', 'choice', 'q', ['q', 'r']], ['b', 'boolean', '', ['one', 'two']]]);
  for (const p of M.PRESETS) {
    const f = path.join(TOP, '.github', 'workflows', p.workflow);
    ok(fs.existsSync(f), `${p.workflow} exists`);
    const names = M.dispatchInputs(fs.readFileSync(f, 'utf8')).inputs.map((i) => i.name);
    for (const k of Object.keys(p.inputs)) ok(names.includes(k), `${p.id}: ${p.workflow} has ${k} (${names.join(' ')})`);
  }
  eq(M.dispatchBody(app.inputs, { mode: 'hold', hold: 60, account: false, addon: '', screen: undefined }), { mode: 'hold', account: 'false', hold: '60' }, 'strings; booleans as words; empty ones left to their default');
});

await t('a run\'s progress from its jobs and steps; durations and ages in words (pure)', () => {
  const run = { status: 'in_progress', run_started_at: '2026-10-08T00:00:00Z', created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z' };
  const jobs = [{ name: 'prep', status: 'completed', conclusion: 'success', steps: [{ status: 'completed' }, { status: 'completed' }] }, { name: 'device', status: 'in_progress', steps: [{ status: 'completed' }, { status: 'in_progress', name: '端末を作る' }, { status: 'queued' }] }];
  const p = M.progress(run, jobs, Date.parse('2026-10-08T00:02:30Z'));
  eq([p.state, p.done, p.total, p.pct, p.now, p.ms], ['in_progress', 3, 5, 60, '端末を作る', 150_000]);
  eq(p.jobs.map((j) => [j.name, j.state, j.done, j.total]), [['prep', 'success', 2, 2], ['device', 'in_progress', 1, 3]]);
  eq(M.progress({ ...run, status: 'completed', conclusion: 'failure' }, jobs).pct, 100);
  eq([M.fmtMs(42_000), M.fmtMs(125_000), M.fmtMs(3_725_000)], ['42 秒', '2 分 5 秒', '1 時間 2 分']);
  eq(M.ago('2026-10-08T00:00:00Z', Date.parse('2026-10-08T02:00:00Z')), '2 時間前');
});

await t('hosts: the rules checked exactly as common/hosts.mjs checks them; the minutes of a month from the host\'s runs; pause / resume by `until` (pure)', () => {
  const samples = [null, 'x', {}, { minutesPerMonth: 600, jobs: ['gate'] }, { minutesPerMonth: 0, jobs: ['gate'] }, { minutesPerMonth: 600, jobs: ['make'] }, { minutesPerMonth: 600, jobs: [] },
    { minutesPerMonth: 600, jobs: ['gate', 'test'], hours: '22:00-06:00', timezone: 'Asia/Tokyo', until: '2027-03-31', contact: 'me' }, { minutesPerMonth: 600, jobs: ['gate'], hours: '25:00-26:00' },
    { minutesPerMonth: 600, jobs: ['gate'], timezone: 'Mars/Base' }, { minutesPerMonth: 600, jobs: ['gate'], until: 'tomorrow' }, { minutesPerMonth: 1.5, jobs: ['gate'] }, { minutesPerMonth: 600, jobs: ['gate'], contact: 'x'.repeat(201) }];
  for (const s of samples) eq(M.checkRules(s), H.checkRules(s), JSON.stringify(s));
  eq(M.HOST_JOBS, Object.keys(H.JOBS)); eq(M.STOP_AT, H.STOP_AT);
  const now = new Date('2026-10-08T03:00:00Z');
  for (const [hours, tz] of [['00:00-24:00', 'UTC'], ['22:00-06:00', 'Asia/Tokyo'], ['09:00-17:00', 'Asia/Tokyo'], ['12:00-12:00', 'UTC']]) eq(M.within(hours, tz, now), H.within(hours, tz, now), hours);
  eq(M.monthOf(now, 'Asia/Tokyo'), H.monthOf(now, 'Asia/Tokyo'));
  const runs = [{ status: 'completed', run_started_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:10:30Z' }, { status: 'completed', run_started_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:20Z' },
    { status: 'in_progress', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:30:00Z' }, { status: 'completed', run_started_at: '2026-09-30T23:00:00Z', updated_at: '2026-09-30T23:30:00Z' }];
  eq(M.monthMinutes(runs, '2026-10', 'UTC'), 12, 'each run rounded up to its minute; this month only; finished only');
  eq(M.monthMinutes(runs, '2026-10', 'Asia/Tokyo'), 42, 'the month in the host\'s time zone (the 30th 23:00 UTC is October in Tokyo)');
  const rules = M.checkRules({ minutesPerMonth: 100, jobs: ['gate'], until: '2026-10-31', timezone: 'UTC' }).rules;
  eq(M.hostNow(rules, 50, now).ok, true); ok(/80%/.test(M.hostNow(rules, 80, now).why.join()), 'stops at 80%'); ok(/期限/.test(M.hostNow({ ...rules, until: '2026-10-07' }, 0, now).why.join()), 'past its day');
  ok(/走っています/.test(M.hostNow(rules, 0, now, true).why.join()), 'one at a time');
  const paused = M.pauseRules({ minutesPerMonth: 100, jobs: ['gate'], until: '2027-01-01' }, now, 'UTC');
  eq(paused.until, '2026-10-07'); ok(!M.hostNow(M.checkRules(paused).rules, 0, now).ok, 'paused: not usable'); ok(!H.canRun({ slug: 'a/b', rules: M.checkRules(paused).rules }, 'gate', [], now).ok, 'and the borrower\'s lab agrees');
  eq(M.resumeRules(paused, '2026-12-31').until, '2026-12-31');
});

await t('the secret sealed as libsodium seals it (crypto_box_seal; vectors from libsodium) and its parts against Node\'s own X25519 and BLAKE2b', () => {
  // (made with libsodium-wrappers 0.7.15: seed keypair from 32 bytes of i+1, ephemeral secret 32 bytes of 100+i; sha256 of the box)
  const V = [['', '1b1b58dd50ea14b60da17b790cd02754d970c9bab864ebb3c0f3016fe51d3f57', '138d5a94edadcd0cb3573cbbad620463cd344c38f5017230d1a0d5eb53a52b7b'],
    ['a', '60346e7c911a5f6ba154129174cafe75b294ac3bbd5549632f48cec6266f8410', '8ba9b9ba10b079d8701190f5a0c65b9d61c1374e953c272b953429788aef7d82'],
    ['Very-Secret-pw-123', '75e270df2952c57ba8367ba8618c178f9fe50db2799d304e74e918d985686146', 'fe3c8f5a19b12d8a1fcc80cb0ec89bc9dd0116643fc6283a6dfca7f5f3c51f13'],
    ['x'.repeat(200), 'edd03cade80d29de6ea313a74ab369f4732ecb36649066b78b5b2dd664cb0417', 'e39062b23cc3cf9d8826c290150165bb06db821ac7705dd3179cd8c837ef7df2'],
    ['パスワード🔑'.repeat(30), 'c44e429251771ec76197c7a1f8ea289a18ca3dd7a7e102ba7cc84df6b55cbe1a', 'dfb9733aed4c8a8816d9b22007b1895bb6b3e9c4a86b07abcac41f01e8d2d8f4']];
  V.forEach(([msg, pk, sha], i) => {
    const out = SEAL.sealBox(msg, Buffer.from(pk, 'hex'), { ephemeral: new Uint8Array(32).fill(100 + i) });
    eq(crypto.createHash('sha256').update(out).digest('hex'), sha, `vector ${i}`);
    eq(out.length, 48 + Buffer.byteLength(msg), 'epk + tag + message');
  });
  // the recipient can open it: the same box recomputed from its own secret key and the sender's public one
  const sk = crypto.randomBytes(32), pk = SEAL.x25519Public(sk), sealed = SEAL.sealBox('hello panel', pk), epk = sealed.subarray(0, 32);
  const nonce = SEAL.blake2b(Buffer.concat([epk, pk]), 24);
  eq(hex(SEAL.box(new TextEncoder().encode('hello panel'), nonce, epk, sk)), hex(sealed.subarray(32)), 'opens with the recipient\'s key');
  ok(hex(SEAL.sealBox('hello panel', pk)) !== hex(sealed), 'a new ephemeral key every time');
  // X25519 against Node's own, BLAKE2b-512 against Node's own, Poly1305 against RFC 8439
  for (let k = 0; k < 5; k++) {
    const a = crypto.generateKeyPairSync('x25519'), b = crypto.generateKeyPairSync('x25519');
    const raw = (key, type) => key.export({ format: 'der', type }).subarray(-32);
    eq(hex(SEAL.x25519(raw(a.privateKey, 'pkcs8'), raw(b.publicKey, 'spki'))), hex(crypto.diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey })), `x25519 ${k}`);
    const d = crypto.randomBytes(k * 97);
    eq(hex(SEAL.blake2b(d, 64)), crypto.createHash('blake2b512').update(d).digest('hex'), `blake2b ${k}`);
  }
  eq(hex(SEAL.poly1305(new TextEncoder().encode('Cryptographic Forum Research Group'), Buffer.from('85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b', 'hex'))), 'a8061dc1305136c6c22b8baf0c0127a9');
  const p = SEAL.secretPayload('v', { key: SEAL.toB64(pk), key_id: 'K1' });
  ok(p.key_id === 'K1' && SEAL.fromB64(p.encrypted_value).length === 49, JSON.stringify(p));
});

await t('the live issue: the panel\'s sealed lines open on the runner and the runner\'s in the panel (the same key from APP_CACHE_KEY or GOOGLE_AAS_TOKEN)', async () => {
  for (const env of [{ APP_CACHE_KEY: 'panel-test-key' }, { GOOGLE_AAS_TOKEN: 'aas_et/panel' }]) {
    const pk = await PV.vaultKey({ cacheKey: env.APP_CACHE_KEY, aasToken: env.GOOGLE_AAS_TOKEN }), nk = AV.vaultKey(env);
    const s1 = await PV.sealText('walk forward 2\nwhere', pk);
    eq(AV.openText(s1, nk), 'walk forward 2\nwhere', 'panel → runner');
    eq(await PV.openText(AV.sealText('画面 🎮', nk), pk), '画面 🎮', 'runner → panel');
    eq(await PV.openText(s1.slice(0, -4) + 'AAAA', pk), null, 'altered');
    eq(await PV.openText(s1, await PV.vaultKey({ cacheKey: 'other' })), null, 'another key');
  }
  eq(await PV.vaultKey({}), null);
  const env = { APP_REPO_VISIBILITY: 'public', APP_CACHE_KEY: 'panel-test-key' }, key = await PV.vaultKey({ cacheKey: 'panel-test-key' });
  const body = await LF.commandBody(123, 'walk forward 1\nscreen', { isPublic: true, key });
  ok(body.startsWith('lab@123 lab-sealed:v1:'), body);
  eq(AL.commandsOf(body, 123, env), ['walk forward 1', 'screen'], 'the runner takes the panel\'s command');
  eq(await LF.commandBody(123, 'x', { isPublic: true }), null, 'public without a key: nothing plain');
  eq(await LF.commandBody(123, 'x', { isPublic: false }), 'lab@123 x');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  const reply = AL.replyBody(123, 77, 'forward へ 1 秒歩きました', png, 60_000, env);
  eq(await LF.replyParts(reply, 123, { isPublic: true, key }), { id: 77, text: 'forward へ 1 秒歩きました', png: png.toString('base64') }, 'the runner\'s reply, opened');
  eq(await LF.replyParts(reply, 123, { isPublic: true }), { id: 77, text: null, png: null }, 'no key: said as sealed');
  eq(await LF.replyParts(AL.replyBody(5, 9, 'plain', null, 60_000, { APP_REPO_VISIBILITY: 'private' }), 5, { isPublic: false }), { id: 9, text: 'plain', png: null });
  eq(await LF.tellText('lab-live@123 待っています（60 分まで）', 123, {}), '待っています（60 分まで）');
  eq(LF.liveIssue([{ number: 3, title: 'x' }, { number: 7, title: AL.ISSUE_TITLE }]), 7); eq(LF.ISSUE_TITLE, AL.ISSUE_TITLE);
  // (the panel's buttons are Discord's: every one a command the runner knows)
  for (const r of Object.values(PG.PAGES).flat(2)) if (!String(r[1]).startsWith('#')) for (const c of r[1].split(' && ')) ok(!AL.parseCommand(c).error, `${r[0]}: ${c}`);
});

await t('the GitHub client: the token as a bearer, workflow dispatch and secret sealing as GitHub takes them, errors in words, secret names only', async () => {
  const seen = [];
  const sk = crypto.randomBytes(32), pk = SEAL.x25519Public(sk);
  const fetchImpl = async (url, init) => {
    seen.push({ url: url.replace('https://api.test', ''), method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
    const u = url.replace('https://api.test', ''), send = (status, j) => ({ ok: status < 300, status, headers: { get: (k) => ({ 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1' })[k] ?? null }, text: async () => (j === null ? '' : JSON.stringify(j)) });
    if (u === '/repos/o/r/actions/secrets/public-key') return send(200, { key_id: 'KID', key: SEAL.toB64(pk) });
    if (u.startsWith('/repos/o/r/actions/secrets?')) return send(200, { secrets: [{ name: 'A' }, { name: 'B' }] });
    if (u.startsWith('/repos/o/nope/actions/secrets')) return send(403, { message: 'Resource not accessible by personal access token' });
    if (u === '/repos/o/r/contents/.lab-host.json') return send(200, { content: Buffer.from('{"a":"日本"}').toString('base64'), sha: 'S1' });
    if (u === '/repos/o/r/contents/none.json') return send(404, { message: 'Not Found' });
    if (u === '/user') return send(401, { message: 'Bad credentials' });
    return send(init.method === 'GET' ? 200 : 204, init.method === 'GET' ? {} : null);
  };
  const api = G.gh({ token: 'tok123', base: 'https://api.test', fetchImpl });
  await api.dispatch('o/r', 'app.yml', 'main', { mode: 'hold' });
  ok(seen[0].url === '/repos/o/r/actions/workflows/app.yml/dispatches' && seen[0].method === 'POST' && seen[0].auth === 'Bearer tok123' && seen[0].body.ref === 'main' && seen[0].body.inputs.mode === 'hold', JSON.stringify(seen[0]));
  await api.putSecret('o/r', 'MS_EMAIL', 'me@example.com');
  const put = seen.at(-1), sealed = SEAL.fromB64(put.body.encrypted_value), epk = sealed.subarray(0, 32);
  ok(put.url === '/repos/o/r/actions/secrets/MS_EMAIL' && put.method === 'PUT' && put.body.key_id === 'KID' && !JSON.stringify(put).includes('me@example.com'), JSON.stringify(put));
  eq(hex(SEAL.box(new TextEncoder().encode('me@example.com'), SEAL.blake2b(Buffer.concat([epk, pk]), 24), epk, sk)), hex(sealed.subarray(32)), 'GitHub (the key\'s owner) opens it');
  eq(await api.secretNames('o/r'), ['A', 'B']); eq(await api.secretNames('o/nope'), null, 'not allowed: null, not an error');
  eq(await api.file('o/r', '.lab-host.json'), { text: '{"a":"日本"}', sha: 'S1' }); eq(await api.file('o/r', 'none.json'), null);
  await api.putFile('o/r', '.lab-host.json', '{"a":"日本"}\n', 'S1', 'msg');
  ok(Buffer.from(seen.at(-1).body.content, 'base64').toString('utf8') === '{"a":"日本"}\n' && seen.at(-1).body.sha === 'S1', 'UTF-8 in base64, with the sha');
  let err = null; try { await api.me(); } catch (e) { err = e; }
  ok(err instanceof G.GhError && err.status === 401 && /トークンが受け付けられません/.test(err.message), err?.message);
  eq(api.state.remaining, 4999);
  ok(/権限がありません/.test(G.explain(403, 'x')) && /回数の上限/.test(G.explain(403, 'API rate limit exceeded')) && /見つからない/.test(G.explain(404)), 'errors in words');
});

await t('the page: its CSP allows GitHub\'s API alone and its own scripts; no inline script or style; text is never parsed as HTML', () => {
  const html = fs.readFileSync(path.join(TOP, 'panel', 'index.html'), 'utf8'), js = fs.readFileSync(path.join(TOP, 'panel', 'panel.js'), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  ok(/default-src 'none'/.test(csp) && /script-src 'self';/.test(csp) && /connect-src https:\/\/api\.github\.com;/.test(csp) && !/unsafe/.test(csp), csp);
  ok(!/<script>(?!\s*<\/script>)/.test(html) && !/ style="/.test(html) && !/ on\w+="/.test(html), 'no inline script, style or handler in the page');
  for (const f of ['panel.js', ...fs.readdirSync(path.join(TOP, 'panel', 'lib')).map((x) => `lib/${x}`)]) {
    const src = fs.readFileSync(path.join(TOP, 'panel', f), 'utf8');
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(src), `${f}: no HTML parsing, no eval`);
    ok(![...src.matchAll(/https?:\/\/[\w.-]+/g)].map((m) => m[0]).some((u) => !/^https:\/\/(api\.github\.com|github\.com|avatars\.githubusercontent\.com)$/.test(u)), `${f}: no other address`);
  }
  ok(/setAttribute\('style'/.test(js) === false, 'styles through the CSSOM only');
  eq(PANEL.CSP.replace(/; frame-ancestors 'none'$/, ''), csp, 'the local server sends the same policy');
  eq(M.repoFromLocation({ hostname: 'aokijp.github.io', pathname: '/bds-lab/' }), 'aokijp/bds-lab'); eq(M.repoFromLocation({ hostname: '127.0.0.1', pathname: '/' }), null);
});

await t('node lab.mjs panel\'s server: the panel\'s files with its CSP; nothing above the folder, no dot-files, no other method', async () => {
  const srv = http.createServer(PANEL.panelHandler()).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const get = async (p, m = 'GET') => { const r = await fetch(base + p, { method: m }); return { status: r.status, type: r.headers.get('content-type'), csp: r.headers.get('content-security-policy'), text: m === 'GET' ? await r.text() : '' }; };
  const root = await get('/');
  ok(root.status === 200 && /text\/html/.test(root.type) && /connect-src https:\/\/api\.github\.com/.test(root.csp) && /管理パネル/.test(root.text), JSON.stringify(root).slice(0, 200));
  ok((await get('/lib/model.mjs')).type.startsWith('text/javascript'), 'modules as JavaScript');
  for (const p of ['/../lab.mjs', '/%2e%2e/lab.mjs', '/..%2flab.mjs', '/.secret', '/lib/../../lab.mjs', '/nope.js']) eq((await get(p)).status, 404, p);
  eq((await get('/', 'POST')).status, 405);
  srv.close();
});

await t('notify: when a run is told (auto / all / failures / off) and what is said: the result, the failed job and step, its annotation, links (pure)', async () => {
  const RM = await imp('app/lib/runmsg.mjs');
  const run = (c, event = 'push') => ({ status: 'completed', conclusion: c, event, name: 'app', head_branch: 'main', html_url: 'https://github.com/o/r/actions/runs/5', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:12:00Z', triggering_actor: { login: 'me' } });
  eq(['success', 'failure', 'cancelled', 'skipped'].map((c) => RM.shouldNotify(run(c))), [false, true, true, false], 'auto: failures (a pushed success is quiet)');
  eq(RM.shouldNotify(run('success', 'workflow_dispatch')), true, 'auto: a run started by hand is told when it passes too');
  eq([RM.shouldNotify(run('success'), 'all'), RM.shouldNotify(run('failure'), 'off'), RM.shouldNotify(run('success', 'workflow_dispatch'), 'failures'), RM.shouldNotify({ status: 'in_progress' }, 'all')], [true, false, false, false]);
  const m = RM.runMessage({ run: run('failure'), jobs: [{ name: 'device (1)', conclusion: 'failure', steps: [{ name: 'checkout', conclusion: 'success' }, { name: '端末で確かめる', conclusion: 'failure' }] }, { name: 'prep', conclusion: 'success' }],
    annotations: { 'device (1)': [{ annotation_level: 'warning', message: 'w' }, { annotation_level: 'failure', title: '結果とエラー', message: '✘ 3 until stable\n画面が落ち着きません' }] }, panel: RM.panelUrl('aokiJP/bds-lab') });
  ok(/^❌ \*\*app\*\* 落ちました（main・me・12 分）/.test(m.content) && /・device \(1\): 端末で確かめる/.test(m.content) && /結果とエラー: ✘ 3 until stable 画面が落ち着きません/.test(m.content) && !/prep/.test(m.content) && m.ok === false, m.content);
  eq(m.buttons, [{ label: 'GitHub で見る', url: 'https://github.com/o/r/actions/runs/5' }, { label: '管理パネル', url: 'https://aokijp.github.io/bds-lab/' }]);
  eq(RM.panelUrl('o/r', { LAB_PANEL_URL: 'https://panel.example' }), 'https://panel.example');
  ok(RM.runMessage({ run: { ...run('failure'), name: 'x'.repeat(5000) } }).content.length <= 1900, 'within a message');
});

await t('app notify: a finished run told as a DM with link buttons (fake GitHub + fake Discord); else to the webhook; nowhere to send: said, not a failure', async () => {
  const { spawn } = await import('node:child_process');
  const got = { dm: [], hook: [] };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/gh/repos/o/r/actions/runs/5') return send(200, { id: 5, status: 'completed', conclusion: 'failure', event: 'push', name: 'verify', head_branch: 'main', html_url: 'https://github.com/o/r/actions/runs/5', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z', actor: { login: 'me' } });
      if (req.url === '/gh/repos/o/r/actions/runs/6') return send(200, { id: 6, status: 'completed', conclusion: 'success', event: 'push', name: 'verify', head_branch: 'main', html_url: 'https://github.com/o/r/actions/runs/6', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z' });
      if (/^\/gh\/repos\/o\/r\/actions\/runs\/5\/jobs/.test(req.url)) return send(200, { jobs: [{ name: 'offline', conclusion: 'failure', check_run_url: 'https://api/x/check-runs/77', steps: [{ name: 'every offline test', conclusion: 'failure' }] }] });
      if (/^\/gh\/repos\/o\/r\/check-runs\/77\/annotations/.test(req.url)) return send(200, [{ annotation_level: 'failure', message: 'FAIL gate: tests/panel-offline.mjs' }]);
      if (req.url === '/dc/users/@me/channels') return send(200, { id: 'dm1' });
      if (req.url === '/dc/channels/dm1/messages') { got.dm.push({ auth: req.headers.authorization, body: JSON.parse(b) }); return send(200, { id: 'm1' }); }
      if (req.url === '/hook') { got.hook.push(JSON.parse(b)); return send(204, {}); }
      send(404, { url: req.url });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const run = (args, env) => new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'notify', ...args], { cwd: TOP, env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_API_URL: `http://127.0.0.1:${port}/gh`, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'ghs_x', DISCORD_API_URL: `http://127.0.0.1:${port}/dc`, DISCORD_BOT_TOKEN: '', DISCORD_USER_ID: '', LAB_NOTIFY_WEBHOOK: '', LAB_NOTIFY: '', ...env } }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', (code) => res({ code, o })); });
  const dc = { DISCORD_BOT_TOKEN: 'bot-tok', DISCORD_USER_ID: '123456789012345678' };
  const a = await run(['--run', '5'], dc);
  ok(a.code === 0 && /OK Discord の DM に送りました/.test(a.o) && got.dm.length === 1 && got.dm[0].auth === 'Bot bot-tok', a.o);
  const msg = got.dm[0].body;
  ok(/❌ \*\*verify\*\* 落ちました/.test(msg.content) && /・offline: every offline test/.test(msg.content) && /FAIL gate: tests\/panel-offline\.mjs/.test(msg.content) && msg.components[0].components.every((x) => x.type === 2 && x.style === 5 && /^https:\/\//.test(x.url)) && msg.allowed_mentions.parse.length === 0, JSON.stringify(msg));
  const quiet = await run(['--run', '6'], dc);
  ok(quiet.code === 0 && /知らせません（LAB_NOTIFY=auto、verify success、push）/.test(quiet.o) && got.dm.length === 1, quiet.o);
  const test = await run(['--text', 'hello from the panel'], dc);
  ok(test.code === 0 && got.dm.at(-1).body.content === 'hello from the panel', test.o);
  const hook = await run(['--run', '5'], { LAB_NOTIFY_WEBHOOK: `http://127.0.0.1:${port}/hook` });
  ok(hook.code === 0 && /OK Webhook に送りました/.test(hook.o) && got.hook.length === 1 && /verify 落ちました/.test(JSON.stringify(got.hook[0])) && /actions\/runs\/5/.test(JSON.stringify(got.hook[0])), hook.o + JSON.stringify(got.hook));
  const none = await run(['--run', '5'], {});
  ok(none.code === 0 && /通知先がありません/.test(none.o), none.o);
  srv.close();
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
