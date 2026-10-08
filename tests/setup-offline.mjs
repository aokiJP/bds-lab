// the panel's setup without a browser or a network: the GitHub App's manifest (what GitHub makes from it, its permissions),
// where its form goes and the way back (?code= with this tab's state only), storeApp sealing the App's keys into secrets and
// setting its variables with nothing kept (a fake GitHub on node:http that opens what it is sent), every check in each of its
// states with the fix it offers and what that fix asks GitHub (Pages, the App, its installation, the sign-in service, putting
// it on Cloudflare through auth-deploy.yml's notice of this person's own run, the workflows, a lender's link), and the 「準備」
// tab on a small fake DOM (fixes for administrators the policy lets do them only, the App's real form, the code taken out of
// the address before anything else and used only when it can be kept).
// node tests/setup-offline.mjs
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const S = await imp('panel/lib/setup.mjs'), G = await imp('panel/lib/gh.mjs'), SEAL = await imp('panel/lib/seal.mjs'), AC = await imp('panel/lib/accounts.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const throws = async (fn, re, m) => { let e = null; try { await fn(); } catch (x) { e = x; } ok(e && re.test(e.message), `${m}: ${e?.message ?? 'did not throw'}`); };

// ---- a fake GitHub (and a fake sign-in service under /auth): it keeps what it is sent and opens the sealed secrets ----
const PEM = `-----BEGIN RSA ${'PRIVATE'} KEY-----\nMIIEpAIBAAKCAQEAfakefakefake\n-----END RSA ${'PRIVATE'} KEY-----\n`, // (made at run time: the lab's secret scan reads this file)
  CLIENT_SECRET = 'cs_0123456789abcdef0123456789abcdef01234567';
const CF_TOKEN = 'cf-token-ABCDEFGHIJKLMNOPQRSTUV', CF_ACCOUNT = '0123456789abcdef0123456789abcdef', AUTH_URL = 'https://bds-lab-auth.o.workers.dev';
async function fakeGitHub(init = {}) {
  const sk = crypto.randomBytes(32), pk = SEAL.x25519Public(sk);
  const st = { secrets: new Map(), vars: new Map(Object.entries(init.vars ?? {})), pages: init.pages ?? null, pagesStatus: init.pagesStatus ?? 200, installs: init.installs ?? [], instRepos: init.instRepos ?? {},
    runs: [{ id: 1, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', created_at: '2026-01-01T00:00:00Z' }], deployConclusion: init.deployConclusion ?? 'success', notice: init.notice ?? AUTH_URL,
    health: init.health ?? { ok: true, clientId: 'Iv1.app', origins: ['https://o.github.io'], version: 1 }, seen: [], failSecret: init.failSecret ?? null, log: init.log ?? [], intruders: init.intruders ?? false,
    appPerms: init.appPerms ?? { actions: 'write', contents: 'write', secrets: 'write', actions_variables: 'write', issues: 'write', workflows: 'write', pages: 'write', pull_requests: 'read', metadata: 'read', members: 'read' } };
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === null || j === undefined ? '' : JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method, body = b ? JSON.parse(b) : null;
      st.seen.push({ m, u, auth: req.headers.authorization ?? null, body: b });
      let x;
      if (u === '/auth/health') return send(res, st.health === 500 ? 500 : 200, st.health);
      // (the App as GitHub shows it to anyone: one made before administration was asked for)
      if (u === '/apps/lab-o') return send(res, 200, { slug: 'lab-o', permissions: st.appPerms });
      if ((x = /^\/app-manifests\/([\w-]+)\/conversions$/.exec(u)) && m === 'POST') { st.log.push('convert'); return send(res, 201, { id: 4242, slug: 'lab-o', node_id: 'N', client_id: 'Iv1.app', client_secret: CLIENT_SECRET, webhook_secret: null, pem: PEM, html_url: 'https://github.com/apps/lab-o', owner: { login: 'o' }, code: x[1] }); }
      if (u === '/repos/o/lab/actions/secrets/public-key') return send(res, 200, { key_id: 'KID', key: SEAL.toB64(pk) });
      if ((x = /^\/repos\/o\/lab\/actions\/secrets\/(\w+)$/.exec(u)) && m === 'PUT') { if (x[1] === st.failSecret) return send(res, 403, { message: 'Resource not accessible by integration' }); st.secrets.set(x[1], body); return send(res, 201, null); }
      if ((x = /^\/repos\/o\/lab\/actions\/variables\/(\w+)$/.exec(u))) {
        if (m === 'GET') return st.vars.has(x[1]) ? send(res, 200, { name: x[1], value: st.vars.get(x[1]) }) : send(res, 404, { message: 'Not Found' });
        if (m === 'PATCH') { if (!st.vars.has(x[1])) return send(res, 404, { message: 'Not Found' }); st.vars.set(x[1], body.value); return send(res, 204, null); }
      }
      if (u === '/repos/o/lab/actions/variables' && m === 'POST') { st.vars.set(body.name, body.value); return send(res, 201, null); }
      if (u === '/repos/o/lab/pages') {
        if (m === 'GET') return st.pagesStatus !== 200 ? send(res, st.pagesStatus, { message: 'Resource not accessible' }) : st.pages ? send(res, 200, st.pages) : send(res, 404, { message: 'Not Found' });
        if (m === 'POST') { if (st.pages) return send(res, 409, { message: 'already enabled' }); st.pages = { build_type: body.build_type, html_url: 'https://o.github.io/lab/' }; return send(res, 201, st.pages); }
        if (m === 'PUT') { st.pages = { ...st.pages, build_type: body.build_type }; return send(res, 204, null); }
      }
      if ((x = /^\/repos\/o\/lab\/actions\/workflows\/([\w.-]+)\/dispatches$/.exec(u)) && m === 'POST') {
        if (x[1] === 'auth-deploy.yml') {
          st.runs.unshift({ id: 900 + st.runs.length, status: 'queued', conclusion: null, event: 'workflow_dispatch', head_branch: body.ref, actor: { login: 'o' }, triggering_actor: { login: 'o' }, created_at: '2020-01-01T00:00:00Z' });
          // (runs that are not this person's, newer than theirs: a fork's pull request, another branch, someone else)
          if (st.intruders) st.runs.unshift({ id: 7001, status: 'queued', conclusion: null, event: 'pull_request', head_branch: 'main', actor: { login: 'mallory' }, triggering_actor: { login: 'mallory' } },
            { id: 7002, status: 'queued', conclusion: null, event: 'workflow_dispatch', head_branch: 'evil', actor: { login: 'o' }, triggering_actor: { login: 'o' } },
            { id: 7003, status: 'queued', conclusion: null, event: 'workflow_dispatch', head_branch: 'main', actor: { login: 'mallory' }, triggering_actor: { login: 'mallory' } });
        }
        return send(res, 204, null);
      }
      if (/^\/repos\/o\/lab\/actions\/workflows\/auth-deploy\.yml\/runs\?/.test(u)) {
        const out = st.runs.map((r) => ({ ...r }));
        // (each look moves a new run on: queued → in_progress → completed)
        for (const r of st.runs) if (r.status === 'queued') r.status = 'in_progress'; else if (r.status === 'in_progress') { r.status = 'completed'; r.conclusion = st.deployConclusion; }
        return send(res, 200, { workflow_runs: out });
      }
      if ((x = /^\/repos\/o\/lab\/actions\/runs\/(\d+)\/jobs\?/.exec(u))) return send(res, 200, { jobs: [{ name: 'deploy', check_run_url: `https://api.github.com/repos/o/lab/check-runs/${x[1]}1` }] });
      if ((x = /^\/repos\/o\/lab\/check-runs\/(\d+)\/annotations\?/.exec(u))) return send(res, 200, /^700\d1$/.test(x[1]) ? [{ annotation_level: 'notice', title: 'auth-url', message: 'https://evil.example' }] : st.notice ? [{ annotation_level: 'warning', title: 'auth-url', message: 'https://wrong.example' }, { annotation_level: 'notice', title: 'auth-url', message: ` ${st.notice}/ ` }] : []);
      if (u === '/user/installations?per_page=100') return send(res, 200, { total_count: st.installs.length, installations: st.installs });
      if ((x = /^\/user\/installations\/(\d+)\/repositories\?per_page=100&page=1$/.exec(u))) return send(res, 200, { repositories: (st.instRepos[x[1]] ?? []).map((full_name) => ({ full_name })) });
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  /** a sealed secret opened as GitHub's Actions would: crypto_box_seal_open with the repository's secret key */
  const open = (name) => {
    const s = SEAL.fromB64(st.secrets.get(name).encrypted_value), epk = s.subarray(0, 32), nonce = SEAL.blake2b(Buffer.concat([epk, pk]), 24), k = SEAL.hsalsa20(SEAL.x25519(sk, epk), new Uint8Array(16));
    const pt = SEAL.secretbox(s.subarray(48), nonce, k).subarray(16);
    ok(Buffer.from(SEAL.secretbox(pt, nonce, k)).equals(Buffer.from(s.subarray(32))), `${name}: its tag holds`);
    return new TextDecoder().decode(pt);
  };
  return { st, base, open, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base }), fetchImpl: (url, o) => fetch(String(url).replace(/^https:\/\/auth\.test/, `${base}/auth`), o) };
}
const WF = ['pages.yml', 'auth-deploy.yml', 'hostrun.yml', 'secrets.yml'].map((f) => ({ path: `.github/workflows/${f}` }));
const LAB = (over = {}) => ({ slug: 'o/lab', role: 'admin', repo: { default_branch: 'main', visibility: 'private', owner: { login: 'o', type: 'User' }, permissions: { admin: true } }, secrets: [], workflows: WF, ...over });
const byKey = (cs) => Object.fromEntries(cs.map((c) => [c.key, c]));
const QUICK = { sleep: async () => {}, every: 1, timeoutMs: 50 };

await t('the App\'s manifest: no webhook, no events, public (a lender puts it on their own account), its way back to the panel and its sign-in to the service; the permissions the panel and the workflows use and no more (pure)', () => {
  eq(S.APP_PERMISSIONS, { administration: 'write', actions: 'write', contents: 'write', secrets: 'write', actions_variables: 'write', issues: 'write', workflows: 'write', pages: 'write', pull_requests: 'read', metadata: 'read', members: 'read' }, 'members: read, an organization\'s teams for the policy; administration: a lending fork\'s whole say given to the lab\'s owner');
  // (an App made before asks its owner to add what is new: what GitHub's App lacks, write covering read)
  eq(S.appMissing({ actions: 'write', contents: 'write', secrets: 'write', actions_variables: 'write', issues: 'write', workflows: 'write', pages: 'write', pull_requests: 'write', metadata: 'read', members: 'read' }), [['administration', 'write']]);
  eq(S.appMissing({ ...S.APP_PERMISSIONS }), []); eq(S.appMissing(null).length, Object.keys(S.APP_PERMISSIONS).length);
  ok(Object.isFrozen(S.APP_PERMISSIONS), 'one constant, not changed by anyone');
  const m = S.appManifest({ owner: 'aokiJP', repo: 'bds-lab', panelUrl: 'https://aokijp.github.io/bds-lab/#runs', authUrl: 'https://bds-lab-auth.aoki.workers.dev/' });
  eq(m, { name: 'bds-lab-aokiJP', url: 'https://aokijp.github.io/bds-lab/', hook_attributes: { active: false }, redirect_url: 'https://aokijp.github.io/bds-lab/#setup', callback_urls: ['https://bds-lab-auth.aoki.workers.dev/callback'], setup_url: 'https://aokijp.github.io/bds-lab/#setup',
    public: true, default_permissions: S.APP_PERMISSIONS, default_events: [], request_oauth_on_install: false });
  for (const k of ['organization_administration', 'emails', 'checks']) ok(!(k in m.default_permissions), `no ${k}`);
  ok(m.default_permissions.administration === 'write', 'administration: the repositories it is put on (a lending fork, the lab), nothing of the account');
  eq(m.default_permissions.members, 'read', 'teams read, never written');
  eq(S.appManifest({ owner: 'o', repo: 'lab', panelUrl: 'https://o.github.io/lab/' }).callback_urls, [], 'no service yet: no callback (the check \'callback\' says to set it)');
  eq(S.appManifest({ owner: 'o', repo: 'lab', panelUrl: 'https://o.github.io/lab/', authUrl: 'http://plain.example' }).callback_urls, [], 'only an https service');
  eq(S.appManifest({ owner: 'o', repo: 'lab', panelUrl: 'https://o.github.io/lab/', authUrl: 'https://example.com/auth' }).callback_urls, [], 'a service under a path: none (it answers at its origin\'s /callback)');
  // the service's address: the root of an https origin only (the panel signs in at <origin>/…, the service's redirect_uri is <origin>/callback)
  eq(['https://auth.example', 'https://auth.example/', 'https://auth.example:8443', ' https://a-b.workers.dev// '].map(S.cleanAuthUrl), ['https://auth.example', 'https://auth.example', 'https://auth.example:8443', 'https://a-b.workers.dev']);
  eq(['https://example.com/auth', 'https://example.com/auth/', 'https://x.example/?a=1', 'https://x.example/#h', 'http://x.example', 'javascript:alert(1)', 'https://user@x.example', ''].map(S.cleanAuthUrl), Array(8).fill(null));
  ok(S.appManifest({ owner: 'a-very-long-organization-name-x', repo: 'bds-lab', panelUrl: 'https://x.github.io/y/' }).name.length <= 34, 'a name GitHub takes (34 at most)');
  eq(S.appManifest({ owner: 'o', repo: 'lab', panelUrl: 'https://o.github.io/lab/', name: 'Our <lab>' }).name, 'Our -lab', 'a given name, made safe');
  ok(S.appManifest({ owner: 'o', repo: 'lab', panelUrl: 'https://o.github.io/lab/' }).default_permissions !== S.APP_PERMISSIONS, 'a copy: the constant stays as it is');
});

await t('the form goes to GitHub alone (the person\'s account or the organization\'s) with a state; the way back is taken only with this tab\'s state (pure)', () => {
  eq(S.manifestAction('o', false, 'abc123'), 'https://github.com/settings/apps/new?state=abc123');
  eq(S.manifestAction('acme-inc', true, 'abc123'), 'https://github.com/organizations/acme-inc/settings/apps/new?state=abc123');
  eq(S.manifestAction('o', false, 'a&b=c'), 'https://github.com/settings/apps/new?state=a%26b%3Dc', 'the state cannot add a parameter');
  let threw = false; try { S.manifestAction('../evil', true, 's'); } catch { threw = true; }
  ok(threw, 'an organization name GitHub would not give: no address');
  const st = S.newState((n) => new Uint8Array(n).fill(171));
  eq(st, 'ab'.repeat(16)); const [s1, s2] = [S.newState(), S.newState()];
  ok(/^[0-9a-f]{32}$/.test(s1) && s1 !== s2, 'random, 16 bytes');
  eq(S.takeManifestCode('?code=0a1b2c3d&state=s1', 's1'), { code: '0a1b2c3d', state: 's1' });
  eq(S.takeManifestCode('#setup?code=0a1b2c3d&state=s1', 's1'), { code: '0a1b2c3d', state: 's1' }, 'GitHub may put it after the #');
  eq(S.takeManifestCode('?code=0a1b2c3d&state=other', 's1'), null, 'another state: not this tab\'s');
  eq(S.takeManifestCode('?code=0a1b2c3d', 's1'), null, 'no state');
  eq(S.takeManifestCode('?code=0a1b2c3d&state=', ''), null, 'no state kept: nothing taken');
  eq(S.takeManifestCode('?code=..%2Fx&state=s1', 's1'), null, 'a code of another form');
  eq(S.takeManifestCode('', 's1'), null);
});

await t('storeApp: the App\'s private key, client secret and a new 48-byte state secret sealed into secrets on the spot (GitHub opens them), its id, slug and client id in variables; the keys wiped, none in an address or the answer (fake GitHub)', async () => {
  const f = await fakeGitHub();
  try {
    const conv = await f.api.appFromManifest('c0dec0de');
    const asked = f.st.seen.find((s) => /conversions/.test(s.u));
    ok(asked.m === 'POST' && asked.auth === null, `the code alone, without the person's token: ${JSON.stringify(asked)}`);
    const rnd = new Uint8Array(48).map((_, i) => i * 5 + 1);
    let given = null;
    const r = await S.storeApp(f.api, 'o/lab', conv, { random: (n) => { eq(n, 48); given = rnd; return rnd; } });
    eq(r, { id: 4242, slug: 'lab-o', clientId: 'Iv1.app', owner: 'o', url: 'https://github.com/apps/lab-o', secrets: ['APP_PRIVATE_KEY', 'APP_CLIENT_SECRET', 'AUTH_STATE_SECRET'], variables: ['APP_ID', 'APP_SLUG', 'APP_CLIENT_ID'] });
    eq([f.open('APP_PRIVATE_KEY'), f.open('APP_CLIENT_SECRET')], [PEM, CLIENT_SECRET], 'GitHub (the key\'s owner) opens them');
    const state = f.open('AUTH_STATE_SECRET');
    eq(state, Buffer.from(new Uint8Array(48).map((_, i) => i * 5 + 1)).toString('base64url'), 'the state secret: the 48 random bytes, base64url');
    ok(state.length === 64 && given.every((b) => b === 0), 'long enough for the service (32+), its bytes wiped');
    eq(Object.fromEntries(f.st.vars), { APP_ID: '4242', APP_SLUG: 'lab-o', APP_CLIENT_ID: 'Iv1.app' });
    eq([conv.pem, conv.client_secret, conv.webhook_secret], [undefined, undefined, undefined], 'the answer\'s keys wiped');
    const wire = f.st.seen.map((s) => `${s.u} ${s.body}`).join('\n');
    ok(!wire.includes('MIIEpAIBAAKCAQEAfakefakefake') && !wire.includes(CLIENT_SECRET) && !wire.includes(state), 'no key travels plain');
    ok(!f.st.seen.some((s) => /APP_PRIVATE_KEY.*BEGIN|cs_|state=/.test(s.u)), 'none in an address');
    ok(!JSON.stringify(r).includes('BEGIN') && !JSON.stringify(r).includes(CLIENT_SECRET), 'none in the answer');
    // (GitHub refusing one: the App is there, said so; the keys wiped all the same)
    const g = await fakeGitHub({ failSecret: 'APP_CLIENT_SECRET' });
    const conv2 = await g.api.appFromManifest('c0de2');
    await throws(() => S.storeApp(g.api, 'o/lab', conv2), /権限がありません[\s\S]*App lab-o はできています[\s\S]*APP_PRIVATE_KEY/, 'a refusal');
    ok(conv2.pem === undefined && conv2.client_secret === undefined, 'wiped after a refusal too');
    g.close();
    await throws(() => S.storeApp(f.api, 'o/lab', { id: 1, slug: 'x', client_id: 'c' }), /鍵がありません/, 'an answer without the keys');
    await throws(() => S.storeApp(f.api, '../x', { id: 1 }), /owner\/名前/, 'a lab GitHub would not name');
  } finally { f.close(); }
});

await t('checks, a new lab: Pages off (its fix turns it on built by pages.yml), no App (its form), no service (an address of one\'s own, or Cloudflare once the App is there), workflows on a person\'s token, a lender\'s link waits for the App (fake GitHub)', async () => {
  const f = await fakeGitHub();
  try {
    const ctx = { api: f.api, lab: LAB(), hosts: [{ slug: 'lender/host' }, { slug: 'bad slug' }], config: {}, panelUrl: 'https://o.github.io/lab/', signedInWithApp: false, fetchImpl: f.fetchImpl };
    const cs = await S.checks(ctx), c = byKey(cs);
    eq(cs.map((x) => x.key), ['pages', 'app', 'installed', 'auth', 'deploy', 'workflows', 'host:lender/host'], 'in the order to do them; a host that is not owner/repo is left out');
    eq(cs.map((x) => x.ok), [false, false, false, false, false, false, false]);
    ok(cs.every((x) => typeof x.label === 'string' && x.label && x.need), 'each says what is missing');
    ok(c.app.fix.manifest === true && /1 回のクリック/.test(c.app.need), JSON.stringify(c.app));
    ok(/まず App/.test(c.installed.need) && /まず App/.test(c.deploy.need) && c.deploy.fix === null && /まず App/.test(c['host:lender/host'].need), 'what needs the App says so');
    ok(/APP_ID（変数）・APP_PRIVATE_KEY（秘密）/.test(c.workflows.need) && /LAB_HOST_TOKEN・LAB_SECRETS_TOKEN は要りません/.test(c.workflows.need), c.workflows.need);
    // Pages turned on, built by a workflow, pages.yml started
    const msg = await c.pages.fix.run();
    ok(/Pages を有効にしました（pages.yml/.test(msg), msg);
    const post = f.st.seen.find((s) => s.m === 'POST' && s.u === '/repos/o/lab/pages');
    eq(JSON.parse(post.body), { build_type: 'workflow' });
    ok(f.st.seen.some((s) => s.m === 'POST' && s.u === '/repos/o/lab/actions/workflows/pages.yml/dispatches' && JSON.parse(s.body).ref === 'main'), 'pages.yml started on the default branch');
    eq(byKey(await S.checks(ctx)).pages.ok, true, 'and then it is there');
    // the service: an address of one's own (https only) → LAB_AUTH_URL, pages.yml to hand it to the page
    eq(c.auth.fix.inputs.map((i) => i.name), ['url']);
    await throws(() => c.auth.fix.run({ url: 'http://plain.example' }), /https:\/\//, 'not https');
    await throws(() => c.auth.fix.run({ url: 'https://x.example/?a=1' }), /https:\/\//, 'a query');
    await throws(() => c.auth.fix.run({ url: 'https://example.com/auth' }), /origin の \/ に（auth\/README\.md）/, 'a path: the service is at its origin\'s /');
    ok(!f.st.vars.has('LAB_AUTH_URL'), 'nothing set for a wrong one');
    ok(/サービスは origin の \/ に（auth\/README\.md）/.test(c.auth.need), c.auth.need);
    eq([c.pages.fix.needs, c.auth.fix.needs, c.app.fix.needs], [['dispatch'], ['variables', 'dispatch'], ['secrets.put', 'variables']], 'each fix says what it does, in the policy\'s words');
    ok(/LAB_AUTH_URL を https:\/\/auth\.mine\.example にしました/.test(await c.auth.fix.run({ url: 'https://auth.mine.example/' })), 'the slash trimmed');
    eq(f.st.vars.get('LAB_AUTH_URL'), 'https://auth.mine.example');
    const later = byKey(await S.checks(ctx));
    ok(later.auth.ok === false && /まだありません: pages\.yml をもう一度/.test(later.auth.need) && /pages\.yml/.test(later.auth.fix.label) && !later.deploy, 'the variable set, the page not built yet: pages.yml again; no Cloudflare step');
  } finally { f.close(); }
});

await t('checks, the App made: it is there; installed (only an App\'s sign-in can tell: a token gets null and a link), a lender\'s install link; workflows on the App\'s token; the callback URL to look at (fake GitHub)', async () => {
  const vars = { APP_ID: '4242', APP_SLUG: 'lab-o', APP_CLIENT_ID: 'Iv1.app' };
  const f = await fakeGitHub({ vars, pages: { build_type: 'workflow' }, installs: [{ id: 7, app_slug: 'lab-o' }, { id: 8, app_slug: 'someone-else' }], instRepos: { 7: ['o/lab', 'Lender/Host'], 8: ['o/other'] } });
  try {
    const lab = LAB({ secrets: ['APP_PRIVATE_KEY', 'APP_CLIENT_SECRET', 'AUTH_STATE_SECRET'] });
    const base = { api: f.api, lab, hosts: [{ slug: 'lender/host' }, { slug: 'friend/host2' }], config: { authUrl: 'https://auth.test' }, panelUrl: 'https://o.github.io/lab/', fetchImpl: f.fetchImpl };
    const tok = byKey(await S.checks({ ...base, signedInWithApp: false }));
    ok(tok.app.ok === true && /lab-o/.test(tok.app.label), JSON.stringify(tok.app));
    ok(tok.installed.ok === null && tok.installed.need === 'App でサインインすると分かります' && tok.installed.fix.link === 'https://github.com/apps/lab-o/installations/new', JSON.stringify(tok.installed));
    ok(!f.st.seen.some((s) => s.u.startsWith('/user/installations')), 'a token: installations not asked');
    ok(tok['host:lender/host'].ok === null && tok['host:lender/host'].fix.link === 'https://github.com/apps/lab-o/installations/new' && /貸し手/.test(tok['host:lender/host'].fix.label), JSON.stringify(tok['host:lender/host']));
    ok(/Only select repositories」でホストのリポジトリだけ/.test(tok['host:lender/host'].need) && /contents・actions・workflows だけ（hostrun）/.test(tok['host:lender/host'].need), `the lender told to give it the host alone: ${tok['host:lender/host'].need}`);
    ok(tok.workflows.ok === true && tok.workflows.need === '', 'APP_ID and APP_PRIVATE_KEY: no personal token for hostrun or secrets');
    ok(tok.callback.ok === null && /https:\/\/auth\.test\/callback/.test(tok.callback.need) && tok.callback.fix.link === 'https://github.com/settings/apps/lab-o', JSON.stringify(tok.callback));
    // (an App made before administration was asked for: what to add, and where on GitHub)
    ok(tok['app-perms'].ok === false && /administration: write/.test(tok['app-perms'].need) && tok['app-perms'].fix.link === 'https://github.com/settings/apps/lab-o/permissions', JSON.stringify(tok['app-perms']));
    f.st.appPerms = { ...S.APP_PERMISSIONS };
    eq(byKey(await S.checks({ ...base, signedInWithApp: false }))['app-perms'].ok, true, 'all there: ok');
    const app = byKey(await S.checks({ ...base, signedInWithApp: true }));
    eq([app.installed.ok, app['host:lender/host'].ok, app['host:friend/host2'].ok, app.callback.ok], [true, true, false, true], 'this App\'s installations only; any case');
    ok(/Only select repositories/.test(app['host:friend/host2'].need), app['host:friend/host2'].need);
    ok(!f.st.seen.some((s) => s.u.startsWith('/user/installations/8/')), 'another App\'s installation not read');
    // the lab not among them
    f.st.instRepos[7] = ['Lender/Host'];
    const other = byKey(await S.checks({ ...base, signedInWithApp: true }));
    ok(other.installed.ok === false && /o\/lab に App が入っていません/.test(other.installed.need) && other.installed.fix.link, JSON.stringify(other.installed));
    f.st.instRepos[7] = ['o/lab', 'Lender/Host'];
    // an organization's App: its settings under the organization
    const org = byKey(await S.checks({ ...base, lab: { ...lab, repo: { ...lab.repo, owner: { login: 'acme', type: 'Organization' } } } }));
    eq(org.callback.fix.link, 'https://github.com/organizations/acme/settings/apps/lab-o');
    // the private key gone: its settings to make another
    const nokey = byKey(await S.checks({ ...base, lab: { ...lab, secrets: [] } }));
    ok(nokey.workflows.ok === false && /APP_PRIVATE_KEY（秘密）/.test(nokey.workflows.need) && /作り直し/.test(nokey.workflows.need) && nokey.workflows.fix.link === 'https://github.com/settings/apps/lab-o', nokey.workflows.need);
    eq(byKey(await S.checks({ ...base, lab: { ...lab, secrets: null } })).workflows.ok, null, 'secrets not visible: cannot tell');
  } finally { f.close(); }
});

await t('checks, the sign-in service: answering with this App\'s client id for this panel\'s origin; not answering, another client id, another origin, an old address in the page — each with its fix (fake service)', async () => {
  const vars = { APP_ID: '4242', APP_SLUG: 'lab-o', APP_CLIENT_ID: 'Iv1.app' };
  const run = async (init, over = {}) => {
    const f = await fakeGitHub({ vars, pages: { build_type: 'workflow' }, ...init });
    try { return { c: byKey(await S.checks({ api: f.api, lab: LAB({ secrets: ['APP_PRIVATE_KEY', 'APP_CLIENT_SECRET', 'AUTH_STATE_SECRET', ...(over.cf ? ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] : [])] }), config: { authUrl: 'https://auth.test/' }, panelUrl: 'https://o.github.io/lab/#setup', fetchImpl: f.fetchImpl, ...over.ctx })), f }; } finally { f.close(); }
  };
  const good = await run({});
  ok(good.c.auth.ok === true && good.c.auth.label.includes('https://auth.test') && !good.c.deploy, `answering: ${JSON.stringify(good.c.auth)}`);
  ok(good.f.st.seen.some((s) => s.u === '/auth/health' && s.auth === null), 'the service asked without the token');
  const other = await run({ health: { ok: true, clientId: 'Iv1.someone', origins: ['https://o.github.io'] } }, { cf: true });
  ok(other.c.auth.ok === false && /Iv1\.someone/.test(other.c.auth.need) && /APP_CLIENT_ID Iv1\.app/.test(other.c.auth.need) && /auth-deploy\.yml/.test(other.c.auth.fix.label), JSON.stringify(other.c.auth));
  const origin = await run({ health: { ok: true, clientId: 'Iv1.app', origins: 'https://elsewhere.example, https://x.example' } });
  ok(origin.c.auth.ok === false && /PANEL_ORIGINS にこのパネル（https:\/\/o\.github\.io）/.test(origin.c.auth.need) && origin.c.auth.fix.inputs, JSON.stringify(origin.c.auth));
  const down = await run({ health: 500 });
  ok(down.c.auth.ok === false && /答えません（HTTP 500）/.test(down.c.auth.need), JSON.stringify(down.c.auth));
  const gone = await run({}, { ctx: { fetchImpl: () => Promise.reject(new Error('net')) } });
  ok(gone.c.auth.ok === false && /つながりません/.test(gone.c.auth.need), JSON.stringify(gone.c.auth));
  const moved = await run({ vars: { ...vars, LAB_AUTH_URL: 'https://new.example' } });
  ok(moved.c.auth.ok === false && /LAB_AUTH_URL（https:\/\/new\.example）が、このページの設定/.test(moved.c.auth.need) && /pages\.yml/.test(moved.c.auth.fix.label), JSON.stringify(moved.c.auth));
  const noapp = await run({ vars: { APP_SLUG: 'lab-o' } });
  ok(noapp.c.auth.ok === false && /APP_CLIENT_ID/.test(noapp.c.auth.need), JSON.stringify(noapp.c.auth));
  // a service that names the panels' addresses (path and all): this panel's must begin with one — its origins no longer enough
  const panels = await run({ health: { ok: true, clientId: 'Iv1.app', origins: ['https://o.github.io'], panels: ['https://o.github.io/lab/'] } });
  ok(panels.c.auth.ok === true, JSON.stringify(panels.c.auth));
  const otherPanel = await run({ health: { ok: true, clientId: 'Iv1.app', origins: ['https://o.github.io'], panels: 'https://o.github.io/other/' } });
  ok(otherPanel.c.auth.ok === false && /PANEL_ORIGINS にこのパネルのアドレス（パス付き: https:\/\/o\.github\.io\/lab\/）/.test(otherPanel.c.auth.need) && /o\.github\.io\/other/.test(otherPanel.c.auth.need) && otherPanel.c.auth.fix, JSON.stringify(otherPanel.c.auth));
  eq((await run({ health: { ok: true, clientId: 'Iv1.app', origins: ['https://elsewhere.example'], panels: ['https://o.github.io/lab/'] } })).c.auth.ok, true, 'panels said: they decide');
  eq((await run({ health: { ok: true, clientId: 'Iv1.app', origins: ['https://o.github.io'], panels: [] } })).c.auth.ok, false, 'no panel allowed: none');
  // the page's own setting under a path: not a service the panel can sign in at, said so
  const pathed = await run({}, { ctx: { config: { authUrl: 'https://example.com/auth' } } });
  ok(pathed.c.auth.ok === false && /https の origin の根ではありません: サービスは origin の \/ に（auth\/README\.md）/.test(pathed.c.auth.need) && pathed.c.auth.fix.inputs && !pathed.f.st.seen.some((s) => s.u === '/auth/health'), JSON.stringify(pathed.c.auth));
});

await t('checks, putting the service on Cloudflare: its token and account sealed into secrets, auth-deploy.yml started and waited for (the new run, not an old one), its notice 「auth-url」 into LAB_AUTH_URL, pages.yml started; a failed run said (fake GitHub)', async () => {
  const vars = { APP_ID: '4242', APP_SLUG: 'lab-o', APP_CLIENT_ID: 'Iv1.app' }, secrets = ['APP_PRIVATE_KEY', 'APP_CLIENT_SECRET', 'AUTH_STATE_SECRET'];
  const f = await fakeGitHub({ vars, pages: { build_type: 'workflow' } });
  try {
    const ctx = { api: f.api, lab: LAB({ secrets }), me: { login: 'o' }, config: {}, panelUrl: 'https://o.github.io/lab/', fetchImpl: f.fetchImpl, wait: QUICK };
    const c = byKey(await S.checks(ctx));
    eq(c.deploy.fix.needs, ['secrets.put', 'dispatch', 'variables'], 'what it does, in the policy\'s words');
    ok(c.deploy.ok === false && /Cloudflare の API トークンとアカウント ID/.test(c.deploy.need) && c.deploy.fix.inputs.map((i) => `${i.name}:${Boolean(i.secret)}`).join() === 'token:true,account:false', JSON.stringify(c.deploy));
    await throws(() => c.deploy.fix.run({ token: CF_TOKEN, account: 'not-hex' }), /32 文字/, 'an account id of another form');
    await throws(() => c.deploy.fix.run({ token: 'short', account: CF_ACCOUNT }), /トークンの形/, 'a token of another form');
    ok(!f.st.secrets.size, 'nothing sent for a wrong form');
    const steps = [];
    const msg = await c.deploy.fix.run({ token: CF_TOKEN, account: CF_ACCOUNT }, { onStep: (s) => steps.push(s) });
    ok(msg.includes(AUTH_URL) && steps.length === 3, `${msg}\n${steps.join('\n')}`);
    eq([f.open('CLOUDFLARE_API_TOKEN'), f.open('CLOUDFLARE_ACCOUNT_ID')], [CF_TOKEN, CF_ACCOUNT], 'sealed, and GitHub opens them');
    eq(f.st.vars.get('LAB_AUTH_URL'), AUTH_URL, 'the notice\'s address (not the warning\'s), trimmed');
    const order = f.st.seen.filter((s) => s.m !== 'GET').map((s) => s.u.replace('/repos/o/lab', ''));
    eq(order, ['/actions/secrets/CLOUDFLARE_API_TOKEN', '/actions/secrets/CLOUDFLARE_ACCOUNT_ID', '/actions/workflows/auth-deploy.yml/dispatches', '/actions/variables/LAB_AUTH_URL', '/actions/variables', '/actions/workflows/pages.yml/dispatches']);
    ok(f.st.seen.some((s) => s.u === '/repos/o/lab/check-runs/9011/annotations?per_page=50') && !f.st.seen.some((s) => /check-runs\/11\//.test(s.u)), 'the new run\'s notice, not the old run\'s');
    ok(!f.st.seen.some((s) => s.u.includes(CF_TOKEN) || (s.body.includes(CF_TOKEN))), 'the token never plain');
    // with the secrets already there: no inputs, just put it there
    const ready = byKey(await S.checks({ ...ctx, lab: LAB({ secrets: [...secrets, 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] }), config: {}, wait: QUICK }));
    ok(ready.auth.ok === false && /pages\.yml をもう一度/.test(ready.auth.need), 'LAB_AUTH_URL set, the page not rebuilt yet');
    f.st.vars.delete('LAB_AUTH_URL');
    const ready2 = byKey(await S.checks({ ...ctx, lab: LAB({ secrets: [...secrets, 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] }), wait: QUICK }));
    ok(ready2.deploy.ok === true && !ready2.deploy.fix.inputs && /Cloudflare に置く/.test(ready2.deploy.fix.label), JSON.stringify(ready2.deploy));
    eq(byKey(await S.checks({ ...ctx, lab: LAB({ secrets: null }) })).deploy.ok, null, 'secrets not visible: cannot tell');
    ok(/auth-deploy\.yml がありません/.test(byKey(await S.checks({ ...ctx, lab: LAB({ secrets, workflows: [] }) })).deploy.need), 'no workflow to put it with');
  } finally { f.close(); }
  const bad = await fakeGitHub({ vars, deployConclusion: 'failure' });
  try { await throws(() => S.deployAuth(bad.api, 'o/lab', { me: 'o', ...QUICK }), /failure で終わりました/, 'a failed deploy'); ok(!bad.st.vars.has('LAB_AUTH_URL'), 'nothing set'); } finally { bad.close(); }
  const mute = await fakeGitHub({ vars, notice: '' });
  try { await throws(() => S.deployAuth(mute.api, 'o/lab', { me: 'o', ...QUICK }), /注釈 auth-url/, 'no notice'); } finally { mute.close(); }
  const slow = await fakeGitHub({ vars });
  try { await throws(() => S.deployAuth(slow.api, 'o/lab', { me: 'o', sleep: async () => {}, every: 10, timeoutMs: 5 }), /時間内に終わりません/, 'too long'); } finally { slow.close(); }
  const evil = await fakeGitHub({ vars, notice: 'javascript:alert(1)' });
  try { await throws(() => S.deployAuth(evil.api, 'o/lab', { me: 'o', ...QUICK }), /注釈 auth-url/, 'an address that is not https'); } finally { evil.close(); }
  const pathed = await fakeGitHub({ vars, notice: 'https://bds-lab-auth.o.workers.dev/auth' });
  try { await throws(() => S.deployAuth(pathed.api, 'o/lab', { me: 'o', ...QUICK }), /注釈 auth-url: https の origin の根/, 'an address under a path'); ok(!pathed.st.vars.has('LAB_AUTH_URL'), 'nothing set'); } finally { pathed.close(); }
  // nobody known to start it: nothing started
  const anon = await fakeGitHub({ vars });
  try { await throws(() => S.deployAuth(anon.api, 'o/lab', { ...QUICK }), /始める人/, 'no login'); ok(!anon.st.seen.some((s) => s.m !== 'GET'), 'nothing sent'); } finally { anon.close(); }
  // newer runs that are not this person's own (a fork's pull request, another branch, someone else's): never read; theirs is
  const crowd = await fakeGitHub({ vars, intruders: true });
  try {
    eq(await S.deployAuth(crowd.api, 'o/lab', { me: 'O', ...QUICK }), AUTH_URL, 'this person\'s run on this branch, any case');
    eq(crowd.st.vars.get('LAB_AUTH_URL'), AUTH_URL);
    ok(!crowd.st.seen.some((s) => /runs\/700\d\/jobs|check-runs\/700\d1\//.test(s.u)), `the others' runs not read: ${crowd.st.seen.filter((s) => /700\d/.test(s.u)).map((s) => s.u)}`);
  } finally { crowd.close(); }
});

await t('checks, Pages on another source (its fix switches it to the workflow) or not readable (cannot tell); variables not readable (cannot tell) (fake GitHub)', async () => {
  const f = await fakeGitHub({ pages: { build_type: 'legacy' } });
  try {
    const c = byKey(await S.checks({ api: f.api, lab: LAB(), config: {}, panelUrl: 'https://o.github.io/lab/' }));
    ok(c.pages.ok === false && /GitHub Actions」ではありません/.test(c.pages.need), c.pages.need);
    await c.pages.fix.run();
    ok(f.st.seen.some((s) => s.m === 'PUT' && s.u === '/repos/o/lab/pages' && JSON.parse(s.body).build_type === 'workflow') && f.st.pages.build_type === 'workflow', 'switched');
  } finally { f.close(); }
  // signed in with the App (no administration permission): GitHub's own Pages settings, no button
  const a = await fakeGitHub({});
  try {
    const off = byKey(await S.checks({ api: a.api, lab: LAB(), config: {}, panelUrl: 'https://o.github.io/lab/', signedInWithApp: true })).pages;
    ok(off.ok === false && off.fix.link === 'https://github.com/o/lab/settings/pages' && !off.fix.run && /Source を GitHub Actions に/.test(off.fix.label) && /Source を「GitHub Actions」に/.test(off.need), JSON.stringify(off));
    a.st.pages = { build_type: 'legacy' };
    const legacy = byKey(await S.checks({ api: a.api, lab: LAB(), config: {}, panelUrl: 'https://o.github.io/lab/', signedInWithApp: true })).pages;
    ok(legacy.ok === false && legacy.fix.link === 'https://github.com/o/lab/settings/pages' && !legacy.fix.run, JSON.stringify(legacy));
    ok(!a.st.seen.some((s) => s.m !== 'GET'), 'nothing asked of GitHub');
  } finally { a.close(); }
  const g = await fakeGitHub({ pagesStatus: 403 });
  try {
    g.api.variable = async () => { throw new G.GhError(403, 'no', '/x'); };
    const c = byKey(await S.checks({ api: g.api, lab: LAB(), config: {}, panelUrl: 'https://o.github.io/lab/' }));
    ok(c.pages.ok === null && /読めません/.test(c.pages.need) && !c.pages.fix, JSON.stringify(c.pages));
    ok(c.app.ok === null && /Variables: Read/.test(c.app.need) && c.workflows.ok === null, JSON.stringify(c.app));
  } finally { g.close(); }
});

// ---- a small DOM: enough for panel/ui/dom.mjs's h and the tab ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    click() { return this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
    focus() {}
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}

await t('the 「準備」 tab: the list for anyone; fixes for the lab\'s administrators only (a lender\'s link for all); the App\'s real form posted to GitHub with its manifest; GitHub\'s code taken out of the address before anything, used only with this tab\'s state, the keys sealed, nothing left in the page (fake DOM, fake GitHub)', async () => {
  const { E, toast } = fakeDom();
  const UI = await imp('panel/ui/setup.mjs');
  const f = await fakeGitHub({ vars: { APP_SLUG: 'lab-o' } });
  try {
    f.st.vars.delete('APP_SLUG');
    const nav = (search = '', hash = '#setup') => ({ location: { search, hash, pathname: '/lab/' }, history: { replaceState: (_a, _b, u) => { f.st.log.push(`replace ${u}`); } } });
    const base = { api: f.api, lab: LAB(), hosts: [{ slug: 'lender/host' }], me: { login: 'o' }, config: {}, panelUrl: 'https://o.github.io/lab/', signedInWithApp: false, fetchImpl: f.fetchImpl, storage: AC.memoryStorage() };
    const body = new E('div');
    await UI.setupTab(body, { ...base, ...nav() });
    const rows = body.all((e) => e.attrs['data-check']);
    eq(rows.map((r) => r.attrs['data-check']), ['pages', 'app', 'installed', 'auth', 'deploy', 'workflows', 'host:lender/host']);
    const form = body.all((e) => e.tagName === 'FORM')[0];
    ok(form && form.attrs.method === 'post' && /^https:\/\/github\.com\/settings\/apps\/new\?state=[0-9a-f]{32}$/.test(form.attrs.action), `a real form to GitHub: ${JSON.stringify(form?.attrs)}`);
    const hidden = form.all((e) => e.tagName === 'INPUT' && e.attrs.type === 'hidden')[0];
    eq([hidden.attrs.name, JSON.parse(hidden.value)], ['manifest', S.appManifest({ owner: 'o', repo: 'lab', panelUrl: 'https://o.github.io/lab/' })], 'its manifest');
    await form.fire('submit');
    const kept = JSON.parse(base.storage.getItem('bdslab.setup.manifest'));
    eq([kept.state, kept.lab], [form.attrs.action.split('state=')[1], 'o/lab'], 'the state kept in this tab as the form goes');
    ok(body.all((e) => e.tagName === 'BUTTON' && /Pages を有効に/.test(e.textContent)).length === 1 && body.all((e) => e.tagName === 'INPUT' && e.attrs.type === 'password').length === 0, 'Pages\' button; no Cloudflare field before the App');
    // someone who is not the lab's administrator: the list and the links, no button, no form
    const ro = new E('div');
    await UI.setupTab(ro, { ...base, lab: LAB({ role: 'write' }), ...nav() });
    ok(!ro.all((e) => e.tagName === 'FORM').length && !ro.all((e) => e.tagName === 'BUTTON' && e.textContent !== 'コピー').length && /見るだけです/.test(ro.textContent) && /管理者が直せます/.test(ro.textContent), ro.textContent);
    // a fix's button: Pages turned on, the record kept, the tab reloaded
    let reloads = 0; const recs = [];
    const adm = new E('div');
    await UI.setupTab(adm, { ...base, ...nav(), reload: () => { reloads++; }, record: (a, d) => recs.push([a, d]) });
    await adm.all((e) => e.tagName === 'BUTTON' && /Pages を有効に/.test(e.textContent))[0].click();
    ok(f.st.pages?.build_type === 'workflow' && reloads === 1 && JSON.stringify(recs) === '[["setup.pages",{}]]', `${reloads} ${JSON.stringify(recs)}`);
    // the way back with another tab's state: the code removed, not used
    f.st.log.length = 0;
    const wrong = new E('div');
    await UI.setupTab(wrong, { ...base, ...nav('?code=c0de1&state=nope') });
    ok(f.st.log.join() === 'replace /lab/#setup' && !f.st.seen.some((s) => /conversions/.test(s.u)) && /このタブで始めたものではない/.test(wrong.textContent), `${f.st.log.join()} ${wrong.textContent}`);
    // the way back with this tab's state: the address cleaned first, then the App's keys sealed into secrets
    base.storage.setItem('bdslab.setup.manifest', JSON.stringify({ state: 'abc', lab: 'o/lab', owner: 'o', isOrg: false, at: Date.now() }));
    f.st.log.length = 0; reloads = 0; recs.length = 0;
    const back = new E('div');
    await UI.setupTab(back, { ...base, ...nav('?code=c0de2&state=abc'), reload: () => { reloads++; }, record: (a, d) => recs.push([a, d]) });
    eq(f.st.log, ['replace /lab/#setup', 'convert'], 'the code out of the address before it is used');
    eq([f.open('APP_PRIVATE_KEY'), f.st.vars.get('APP_SLUG'), reloads, JSON.stringify(recs)], [PEM, 'lab-o', 1, '[["setup.app",{"app":"lab-o"}]]']);
    ok(/App lab-o を作り/.test(back.textContent), back.textContent);
    ok(base.storage.getItem('bdslab.setup.manifest') === null, 'the state used once');
    const page = `${back.textContent}\n${toast.textContent}\n${JSON.stringify(base.storage)}`;
    ok(!page.includes('BEGIN RSA') && !page.includes(CLIENT_SECRET), 'no key in the page or the storage');
    // the same code again (a reload): the state is gone, nothing done
    f.st.log.length = 0;
    await UI.setupTab(new E('div'), { ...base, ...nav('?code=c0de2&state=abc') });
    eq(f.st.log, ['replace /lab/#setup'], 'once only');
    // panel.js may take it first, before any request: the address cleaned at once, the answer handed to the tab (used once;
    // another lab's not used; older than GitHub's hour not used)
    base.storage.setItem('bdslab.setup.manifest', JSON.stringify({ state: 'def', lab: 'o/other', owner: 'o', isOrg: false, at: Date.now() }));
    f.st.log.length = 0;
    const early = UI.takeAppReturn({ ...nav('?code=c0de3&state=def'), storage: base.storage });
    eq([early, f.st.log], [{ code: 'c0de3', lab: 'o/other', owner: 'o', isOrg: false }, ['replace /lab/#setup']]);
    const el = new E('div');
    await UI.setupTab(el, { ...base, ...nav(), appReturn: early });
    ok(/別のラボ（o\/other）/.test(el.textContent) && !f.st.log.includes('convert') && early.used === true, el.textContent);
    ok(/App は GitHub にできています: App の設定で鍵/.test(el.textContent) && /App を消して/.test(el.textContent) && el.all((e) => e.tagName === 'A' && e.attrs.href === 'https://github.com/settings/apps').length === 1, `what to do with the App made: ${el.textContent}`);
    eq(UI.takeAppReturn({ ...nav('', '#setup'), storage: base.storage }), null, 'no code: nothing');
    base.storage.setItem('bdslab.setup.manifest', JSON.stringify({ state: 'old', lab: 'o/lab', at: Date.now() - 2 * 3_600_000 }));
    ok(/古い/.test(UI.takeAppReturn({ ...nav('?code=c0de4&state=old'), storage: base.storage }).error), 'older than an hour');
    // a lender's link for everyone, a Cloudflare field for the administrator once the App is there
    f.st.vars.set('APP_ID', '4242'); f.st.vars.set('APP_CLIENT_ID', 'Iv1.app');
    const later = new E('div');
    await UI.setupTab(later, { ...base, lab: LAB({ secrets: ['APP_PRIVATE_KEY', 'APP_CLIENT_SECRET', 'AUTH_STATE_SECRET'] }), ...nav(), wait: QUICK });
    const a = later.all((e) => e.tagName === 'A' && e.attrs.href === 'https://github.com/apps/lab-o/installations/new');
    ok(a.length >= 2 && a.every((x) => x.attrs.rel === 'noopener noreferrer'), 'the install links');
    const pw = later.all((e) => e.tagName === 'INPUT' && e.attrs.type === 'password');
    eq(pw.length, 1, 'Cloudflare\'s token as a password field');
    eq(pw[0].attrs.autocomplete, 'off', 'not offered to the browser\'s password manager');
    const acct = later.all((e) => e.tagName === 'INPUT' && e.attrs.type === 'text' && /CLOUDFLARE_ACCOUNT_ID/.test(e.attrs['aria-label']))[0];
    pw[0].value = CF_TOKEN; acct.value = CF_ACCOUNT;
    await later.all((e) => e.tagName === 'BUTTON' && /封じて登録し、置く/.test(e.textContent))[0].click();
    eq([f.open('CLOUDFLARE_API_TOKEN'), f.st.vars.get('LAB_AUTH_URL'), pw[0].value, acct.value], [CF_TOKEN, AUTH_URL, '', ''], 'sealed, put there, the fields emptied');
    ok(!later.textContent.includes(CF_TOKEN) && !toast.textContent.includes(CF_TOKEN), 'the token not shown');
  } finally { f.close(); }
});

await t('the 「準備」 tab and the policy: a fix only for a GitHub administrator whose role the policy lets do all it does (secrets, variables, starting a workflow), else why — the role and the policy — in place of its button; the App\'s form the same, and its way back looked at before the code is used (fake DOM, fake GitHub)', async () => {
  const { E } = fakeDom();
  const UI = await imp('panel/ui/setup.mjs'), P = await imp('panel/lib/policy.mjs');
  const f = await fakeGitHub();
  try {
    const nav = (search = '', hash = '#setup') => ({ location: { search, hash, pathname: '/lab/' }, history: { replaceState: () => {} } });
    const base = { api: f.api, lab: LAB(), hosts: [], me: { login: 'o' }, config: {}, panelUrl: 'https://o.github.io/lab/', signedInWithApp: false, fetchImpl: f.fetchImpl, storage: AC.memoryStorage() };
    const buttons = (b) => b.all((e) => e.tagName === 'BUTTON' && e.textContent !== 'コピー'), rowOf = (b, k) => b.all((e) => e.attrs['data-check'] === k)[0];
    // an administrator whose role may start workflows only: Pages' button (it starts pages.yml); not the App (secrets and
    // variables) nor the service's address (a variable): why, in place of them
    const dispatchOnly = P.checkPolicy({ roles: { admin: ['dispatch'], write: [] } }).policy;
    const b1 = new E('div');
    await UI.setupTab(b1, { ...base, ...nav(), policy: dispatchOnly, role: P.roleFor({ repoRole: 'admin', policy: dispatchOnly }) });
    eq(buttons(b1).map((x) => x.textContent), ['Pages を有効に（GitHub Actions で）']);
    ok(!b1.all((e) => e.tagName === 'FORM').length, 'no App form');
    ok(/役割「admin」には、ポリシー（\.github\/bds-lab-panel\.json の roles）が「秘密を登録する・変数を変える」を許していません/.test(rowOf(b1, 'app').textContent), rowOf(b1, 'app').textContent);
    ok(/「変数を変える」を許していません/.test(rowOf(b1, 'auth').textContent) && !b1.all((e) => e.tagName === 'INPUT').length, rowOf(b1, 'auth').textContent);
    // a policy that allows nothing (or a broken file): no button, no form, no field
    for (const policy of [P.checkPolicy({ roles: { admin: [] } }).policy, P.LOCKED_POLICY]) {
      const b = new E('div');
      await UI.setupTab(b, { ...base, ...nav(), policy, role: 'admin' });
      ok(!buttons(b).length && !b.all((e) => e.tagName === 'FORM').length && /ワークフローを始める/.test(rowOf(b, 'pages').textContent), b.textContent);
    }
    // a writer given everything by the policy: still not GitHub's administrator
    const all = P.checkPolicy({ roles: { admin: ['*'], write: ['*'] } }).policy, w = new E('div');
    await UI.setupTab(w, { ...base, lab: LAB({ role: 'write' }), ...nav(), policy: all, role: P.roleFor({ repoRole: 'write', policy: all }) });
    ok(!buttons(w).length && !w.all((e) => e.tagName === 'FORM').length && /管理者が直せます/.test(w.textContent), w.textContent);
    // the policy's role read from a team: said by the role's name
    const teamed = P.checkPolicy({ roles: { admin: ['*'], ops: ['dispatch'] }, teams: { ops: 'ops' } }).policy, tm = new E('div');
    await UI.setupTab(tm, { ...base, ...nav(), policy: teamed, role: P.roleFor({ repoRole: 'admin', teams: ['ops'], policy: teamed }) });
    ok(/役割「ops」/.test(rowOf(tm, 'app').textContent) && !tm.all((e) => e.tagName === 'FORM').length, rowOf(tm, 'app').textContent);
    // the way back while the policy does not let this role keep the App's keys: the code not used, what to do said
    // (an organization's App: its Apps' page)
    for (const [over, re] of [[{ policy: dispatchOnly, role: 'admin' }, /秘密を登録する・変数を変える/], [{ lab: LAB({ role: 'write' }) }, /管理者が直せます/]]) {
      base.storage.setItem('bdslab.setup.manifest', JSON.stringify({ state: 'xyz', lab: 'o/lab', owner: 'acme', isOrg: true, at: Date.now() }));
      f.st.log.length = 0;
      const b = new E('div');
      await UI.setupTab(b, { ...base, ...nav('?code=c0de9&state=xyz'), ...over });
      ok(!f.st.log.includes('convert') && !f.st.secrets.size && !f.st.seen.some((s) => /conversions/.test(s.u)), 'the code not used');
      ok(/戻ってきた App の code は使いません/.test(b.textContent) && re.test(b.textContent) && /App は GitHub にできています/.test(b.textContent) && /APP_PRIVATE_KEY・APP_CLIENT_SECRET/.test(b.textContent), b.textContent);
      eq(b.all((e) => e.tagName === 'A' && e.attrs.href === 'https://github.com/organizations/acme/settings/apps').length, 1, 'the organization\'s Apps');
    }
    // the policy allowing it: the keys kept as before
    base.storage.setItem('bdslab.setup.manifest', JSON.stringify({ state: 'ok1', lab: 'o/lab', owner: 'o', isOrg: false, at: Date.now() }));
    const keep = P.checkPolicy({ roles: { admin: ['secrets.put', 'variables'] } }).policy, b2 = new E('div');
    await UI.setupTab(b2, { ...base, ...nav('?code=c0dea&state=ok1'), policy: keep, role: 'admin' });
    ok(/App lab-o を作り/.test(b2.textContent) && f.st.vars.get('APP_SLUG') === 'lab-o', b2.textContent);
  } finally { f.close(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
