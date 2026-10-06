// The Playwright login (app/lib/playwright-login.mjs) in a REAL browser, Google's pages stood in for by routes:
//  1. the person signs in by hand → cookie + typed address picked up
//  2. .env.local has the address and password → filled in, the "同意する" step pressed, no hands at all
// Each time: the browser closes and its profile is deleted. Needs npm + a screen (Linux: xvfb-run -a node tests/app-browser.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { playwrightOauthToken } = await import(pathToFileURL(path.join(TOP, 'app', 'lib', 'playwright-login.mjs')).href);
const cache = path.join(os.tmpdir(), 'bds-lab-app-browser');
let bad = 0;
const check = (c, name, info) => { console.log(`${c ? '✔' : '✘'} ${name}${c ? '' : ' ' + info}`); if (!c) bad++; };
const left = () => fs.readdirSync(cache).filter((n) => n.startsWith('login-')).length;

const hand = async (ctx) => {
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<input type=email id=e><button id=b onclick="document.cookie='oauth_token=oauth2_4%2Fby-hand; path=/; secure'">next</button>` }));
  setTimeout(async () => { const p = ctx.pages()[0]; await p.fill('#e', 'me@example.com'); await p.click('#b'); }, 2000);
};
let r = await playwrightOauthToken({ cacheDir: cache, timeoutMs: 120000, onContext: hand });
check(r.oauthToken === 'oauth2_4/by-hand' && r.email === 'me@example.com' && !left(), 'by hand: cookie (percent-encoded) and address picked up, profile deleted', JSON.stringify(r));

// a sign-in flow: address → password → a consent page with 同意する → the cookie
const flow = async (ctx) => {
  await ctx.route('https://accounts.google.com/**', (route) => {
    const u = new URL(route.request().url());
    const page = { '/EmbeddedSetup': `<form action=/pw><input type=email name=e autofocus></form>`, '/pw': `<form action=/consent><input type=password name=p autofocus></form>`,
      '/consent': `<p>利用規約</p><button onclick="document.cookie='oauth_token=oauth2_4/fully-automatic; path=/; secure'">同意する</button>` }[u.pathname] ?? 'x';
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: page });
  });
};
r = await playwrightOauthToken({ cacheDir: cache, timeoutMs: 120000, onContext: flow, email: 'me@example.com', password: 'hunter2' });
check(r.oauthToken === 'oauth2_4/fully-automatic' && r.email === 'me@example.com' && !left(), 'from .env.local: address and password filled, 同意する pressed, no hands', JSON.stringify(r));

// the stall that was reported: after the password Google shows a "not now" interstitial, then a page with NO agree button,
// and the token only comes when the setup page is opened again while signed in (and it is percent-encoded)
const stall = async (ctx) => {
  await ctx.route('https://accounts.google.com/**', (route) => {
    const u = new URL(route.request().url()), signed = /SID=1/.test(route.request().headers().cookie ?? '');
    const page = u.pathname === '/EmbeddedSetup' ? (signed ? `<script>document.cookie='oauth_token=oauth2_4%2Fafter-revisit; path=/; secure'</script><p>…</p>` : `<form action=/pw><input type=email name=e autofocus></form>`)
      : u.pathname === '/pw' ? `<form action=/later><input type=password name=p autofocus></form>`
      : u.pathname === '/later' ? `<script>document.cookie='SID=1; path=/; secure'</script><p>パスキーを作成しますか？</p><button onclick="location='/blank'">後で</button>`
      : '<p>読み込み中…</p>';
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: page });
  });
};
const logs = [];
r = await playwrightOauthToken({ cacheDir: cache, timeoutMs: 120000, onContext: stall, email: 'me@example.com', password: 'hunter2', log: (l) => logs.push(l) });
check(r.oauthToken === 'oauth2_4/after-revisit' && logs.some((l) => /もう一度開きます/.test(l)) && !left(), 'no agree button: "後で" pressed, the setup page opened again while signed in, the (encoded) token taken', JSON.stringify(r) + logs.join(' | '));
console.log(`${bad ? 'FAIL' : 'PASS'} app-browser`);
process.exit(bad ? 1 : 0);
