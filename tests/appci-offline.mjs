// The workflows' side of the lab's GitHub App, without GitHub: common/ghapp.mjs (the App's JWT signed with its key, the
// installation of one repository, a token narrowed to it and the permissions asked, masked and written to $GITHUB_ENV —
// never printed) against a fake GitHub that checks the JWT with the App's public key; and common/panel-config.mjs (the page
// Pages serves: config.json from the variables, the sign-in service let into the CSP, nothing else, the source untouched).
// node tests/appci-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const GA = await imp('common/ghapp.mjs'), PC = await imp('common/panel-config.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'appci-offline-'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }), TOKEN = 'ghs_' + 'T'.repeat(36);

await t('the App\'s JWT: RS256 over its header and claims, issued a minute back, nine minutes long, its id as the issuer; a wrong id or key said', () => {
  const now = Date.parse('2026-10-08T00:00:00Z'), [h, b, s] = GA.appJwt(1234, PEM, now).split('.');
  eq(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  eq(JSON.parse(Buffer.from(b, 'base64url')), { iat: now / 1000 - 60, exp: now / 1000 - 60 + 540, iss: '1234' });
  ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url')), 'the signature checks with the public key');
  ok(GA.appJwt('1', PEM.replace(/\n/g, '\\n')).split('.').length === 3, 'a key stored with \\n for its newlines works too');
  let e = ''; try { GA.appJwt('x', PEM); } catch (x) { e = x.message; } ok(/APP_ID/.test(e), e);
  e = ''; try { GA.appJwt('1', 'not a key'); } catch (x) { e = x.message; } ok(/APP_PRIVATE_KEY/.test(e) && !/not a key/.test(e), e);
});

// a fake GitHub: the JWT checked, the installation of a repository, a token for it
const seen = [];
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const jwt = String(req.headers.authorization ?? '').replace(/^Bearer /, ''), [h, b, s] = jwt.split('.');
    let good = false; try { good = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url')) && JSON.parse(Buffer.from(b, 'base64url')).iss === '77'; } catch { /* no */ }
    seen.push({ method: req.method, url: req.url, good, body: body ? JSON.parse(body) : null });
    if (!good) return send(401, { message: 'A JSON web token could not be decoded' });
    if (req.url === '/repos/lender1/bds-lab-host/installation') return send(200, { id: 555 });
    if (req.url === '/repos/someone/elsewhere/installation') return send(404, { message: 'Not Found' });
    if (req.url === '/app/installations/555/access_tokens' && req.method === 'POST') { const j = JSON.parse(body); return send(201, { token: TOKEN, expires_at: '2026-10-08T01:00:00Z', permissions: j.permissions ?? { contents: 'read' } }); }
    send(404, { message: 'Not Found' });
  });
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const API = `http://127.0.0.1:${srv.address().port}`;

await t('a token for one repository: its installation, then a token narrowed to that repository and the permissions asked', async () => {
  const r = await GA.installationToken({ appId: '77', pem: PEM, repo: 'lender1/bds-lab-host', permissions: { contents: 'write', actions: 'write' }, api: API });
  eq([r.token, r.expiresAt, r.permissions], [TOKEN, '2026-10-08T01:00:00Z', { contents: 'write', actions: 'write' }]);
  const post = seen.find((x) => x.method === 'POST');
  eq(post.body, { repositories: ['bds-lab-host'], permissions: { contents: 'write', actions: 'write' } }, 'only that repository');
  let e = ''; try { await GA.installationToken({ appId: '77', pem: PEM, repo: 'someone/elsewhere', api: API }); } catch (x) { e = x.message; }
  ok(/App が入っていません/.test(e) && /準備/.test(e), `not installed there: what to do\n${e}`);
  e = ''; try { await GA.installationToken({ appId: '78', pem: PEM, repo: 'lender1/bds-lab-host', api: API }); } catch (x) { e = x.message; }
  ok(/HTTP 401/.test(e), e);
  e = ''; try { await GA.installationToken({ appId: '77', pem: PEM, repo: '../x', api: API }); } catch (x) { e = x.message; }
  ok(/owner\/repo/.test(e), e);
});

await t('node common/ghapp.mjs token: masked, into $GITHUB_ENV, never printed; refuses without --env or outside a workflow; says what is missing', async () => {
  const run = (args, env) => new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'common', 'ghapp.mjs'), ...args], { env: { PATH: process.env.PATH, ...env } }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', (code) => res({ code, o })); });
  const envFile = path.join(tmp, 'github_env'), base = { APP_ID: '77', APP_PRIVATE_KEY: PEM, GITHUB_API_URL: API, GITHUB_ENV: envFile };
  const r = await run(['token', 'lender1/bds-lab-host', '--perm', 'contents=write', '--env', 'APP_TOKEN'], base);
  const lines = r.o.split('\n').filter(Boolean);
  ok(r.code === 0 && lines[0] === `::add-mask::${TOKEN}` && lines.slice(1).every((l) => !l.includes(TOKEN)) && /^OK lender1\/bds-lab-host の App のトークンを APP_TOKEN に/.test(lines[1]), r.o);
  eq(fs.readFileSync(envFile, 'utf8'), `APP_TOKEN=${TOKEN}\n`);
  let x = await run(['token', 'lender1/bds-lab-host'], base);
  ok(x.code === 1 && /--env/.test(x.o) && !x.o.includes(TOKEN), x.o);
  x = await run(['token', 'lender1/bds-lab-host', '--env', 'APP_TOKEN'], { ...base, GITHUB_ENV: '' });
  ok(x.code === 1 && /GITHUB_ENV/.test(x.o), x.o);
  x = await run(['token', 'lender1/bds-lab-host', '--env', 'APP_TOKEN'], { ...base, APP_PRIVATE_KEY: '' });
  ok(x.code === 1 && /APP_PRIVATE_KEY/.test(x.o) && /準備/.test(x.o), x.o);
  x = await run(['token', 'lender1/bds-lab-host', '--perm', 'contents=admin', '--env', 'APP_TOKEN'], base);
  ok(x.code === 1 && /知らない引数/.test(x.o), `only read or write: ${x.o}`);
  x = await run(['token', 'someone/elsewhere', '--env', 'APP_TOKEN'], base);
  ok(x.code === 1 && /App が入っていません/.test(x.o), x.o);
});
srv.close();

await t('the page Pages serves: config.json from the variables, the sign-in service (its origin only) let into the CSP, wrong values left out and said, the source untouched', () => {
  eq(PC.panelConfig({}), { config: { authUrl: null, appSlug: null, appClientId: null }, origin: null, errors: [] });
  eq(PC.panelConfig({ LAB_AUTH_URL: 'https://bds-lab-auth.me.workers.dev/', APP_SLUG: 'bds-lab-me', APP_CLIENT_ID: 'Iv23liABC' }), { config: { authUrl: 'https://bds-lab-auth.me.workers.dev', appSlug: 'bds-lab-me', appClientId: 'Iv23liABC' }, origin: 'https://bds-lab-auth.me.workers.dev', errors: [] });
  for (const u of ['http://x.example', 'https://u:p@x.example', 'https://x.example/sub', 'https://x.example/?a=1', "https://x.example' 'unsafe-inline", 'javascript:alert(1)']) {
    const r = PC.panelConfig({ LAB_AUTH_URL: u });
    ok(r.config.authUrl === null && r.origin === null && /LAB_AUTH_URL/.test(r.errors.join()), `${u}: ${JSON.stringify(r)}`);
  }
  const bad = PC.panelConfig({ APP_SLUG: 'Bad Slug"', APP_CLIENT_ID: 'x y' });
  ok(bad.config.appSlug === null && bad.config.appClientId === null && bad.errors.length === 2, JSON.stringify(bad));
  const out = path.join(tmp, 'site'), src = fs.readFileSync(path.join(TOP, 'panel', 'index.html'), 'utf8');
  PC.buildPages(out, { LAB_AUTH_URL: 'https://auth.example.com', APP_SLUG: 'bds-lab-me' });
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8'), csp = /content="([^"]+)"/.exec(html.split('Content-Security-Policy')[1])[1];
  ok(/connect-src 'self' https:\/\/api\.github\.com https:\/\/auth\.example\.com;/.test(csp) && /form-action https:\/\/github\.com/.test(csp) && !/unsafe/.test(csp), csp);
  eq(JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8')), { authUrl: 'https://auth.example.com', appSlug: 'bds-lab-me', appClientId: null });
  ok(fs.existsSync(path.join(out, 'panel.js')) && fs.existsSync(path.join(out, 'lib', 'session.mjs')) && fs.existsSync(path.join(out, 'ui', 'signin.mjs')), 'the whole panel');
  eq(fs.readFileSync(path.join(TOP, 'panel', 'index.html'), 'utf8'), src, 'the source untouched');
  ok(!fs.existsSync(path.join(TOP, 'panel', 'config.json')), 'no config.json left in the source');
  PC.buildPages(out, {});
  eq(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), src, 'no service: the page as it is');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
