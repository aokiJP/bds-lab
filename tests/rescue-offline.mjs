// the panel's way out of every failure (panel/lib/rescue.mjs): each kind of trouble — the network, an expired sign-in, the
// rate limit, SAML, Actions turned off, missing rights (a token or the App), not found, a conflict, refused input, GitHub's
// own trouble, anything else — has plain words and a next step, never nothing. node tests/rescue-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = await import(pathToFileURL(path.join(TOP, 'panel/lib/rescue.mjs')).href), G = await import(pathToFileURL(path.join(TOP, 'panel/lib/gh.mjs')).href);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log(`FAIL ${m}`); } };
const E = (status, message, extra = {}) => Object.assign(new G.GhError(status, message, '/x'), extra);
const tok = { owner: 'o', lab: 'o/lab' }, app = { owner: 'o', lab: 'o/lab', signedInWithApp: true, appSlug: 'lab-app' };
const all = [];
const r = (e, ctx = tok) => { const x = R.rescue(e, ctx); all.push(x); return x; };

let x = r(E(0, 'GitHub につながりません（Failed to fetch）'));
ok(/インターネット/.test(x.why) && x.action.kind === 'retry', 'the network: again');
x = r(new TypeError('Failed to fetch'));
ok(/インターネット/.test(x.why) && x.action.kind === 'retry', 'a fetch that threw (no status): the network');
x = r(E(500, 'boom'), { ...tok, online: false });
ok(/インターネット/.test(x.why), 'the browser says offline: the network first');
x = r(E(401, 'Bad credentials'));
ok(/期限/.test(x.why) && x.action.kind === 'signin', '401: sign in again');
x = r(E(403, 'API rate limit exceeded', { reset: 1_000_000 + 300 }), { ...tok, now: 1_000_000 * 1000 });
ok(/上限/.test(x.why) && /5 分/.test(x.next) && x.wait === 300_000 && x.action.kind === 'retry', `rate limit: how long (${x.next})`);
x = r(E(429, 'You have exceeded a secondary rate limit'));
ok(/上限/.test(x.why) && x.wait > 0, '429 secondary: wait');
x = r(E(403, 'Resource protected by organization SAML enforcement'));
ok(/SAML/.test(x.why) && /personal-access-tokens/.test(x.action.link), 'SAML: the token page');
x = r(E(403, 'Actions is disabled on this repository'));
ok(/Actions/.test(x.why) && x.action.link === 'https://github.com/o/lab/settings/actions', 'Actions off: its settings');
x = r(E(403, 'Resource not accessible by personal access token'));
ok(/権限/.test(x.why) && /personal-access-tokens\/new/.test(x.action.link) && /入り直して/.test(x.next), '403 with a token: a token with everything in');
x = r(E(403, 'Resource not accessible by integration'), app);
ok(/settings\/apps\/lab-app\/permissions$/.test(x.action.link), '403 with the App: its permissions');
x = r(E(404, 'Not Found'));
ok(/見えません/.test(x.why) && /Repository access/.test(x.next) && x.action.link, '404 with a token: what to check, a token');
x = r(E(404, 'Not Found'), app);
ok(x.action.link === 'https://github.com/apps/lab-app/installations/new', '404 with the App: install it');
x = r(E(409, 'sha does not match'));
ok(x.action.kind === 'reload', '409: read again');
x = r(E(422, 'name is invalid'));
ok(/受け付け/.test(x.why) && /name is invalid/.test(x.why) && x.action.kind === 'retry', '422: what GitHub said');
x = r(E(502, 'Bad gateway'));
ok(/GitHub の側/.test(x.why) && x.action.kind === 'retry' && x.wait > 0, '5xx: GitHub, again later');
x = r(new Error('something odd'));
ok(x.why === 'something odd' && x.action.kind === 'retry', 'anything else: its words, again');
x = r(undefined);
ok(x.why && x.action, 'nothing thrown at all: still words and a step');
ok(all.every((y) => y.why && y.next && y.action && (y.action.link ? /^https:\/\//.test(y.action.link) : ['retry', 'signin', 'reload'].includes(y.action.kind))), 'every answer: words, a next step, an action (https links only)');

// lib/gh.mjs: a network failure is status 0; a refusal carries when the rate limit opens again
const api = G.gh({ token: 't', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
try { await api.me(); ok(false, 'no throw'); } catch (e) { ok(e instanceof G.GhError && e.status === 0, `network → GhError 0 (${e.status})`); }
const api2 = G.gh({ token: 't', fetchImpl: async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-reset': '1234' } }) });
try { await api2.me(); ok(false, 'no throw'); } catch (e) { ok(e.status === 403 && e.reset === 1234, `reset kept (${e.reset})`); }

console.log(`${fail ? 'FAIL' : 'PASS'} rescue-offline (${pass} ok${fail ? `, ${fail} failed` : ''})`);
process.exit(fail ? 1 : 0);
