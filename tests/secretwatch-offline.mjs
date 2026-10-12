// the secret-age watch without a browser or a network: ageOf (levels, order, how-to by name, no value ever) and the card on a
// small fake DOM (an old secret shown with its way on, new ones quiet, a refused read told with a next step).
// node tests/secretwatch-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

// (a small fake DOM, enough for dom.mjs's h)
class Node { constructor() { this.kids = []; this.attrs = {}; } append(...k) { this.kids.push(...k); } replaceChildren(...k) { this.kids = k; } setAttribute(k, v) { this.attrs[k] = v; } addEventListener() {} }
class Text extends Node { constructor(s) { super(); this.text = s; } }
globalThis.Node = Node;
globalThis.document = { createElement: (tag) => Object.assign(new Node(), { tag }), createTextNode: (s) => new Text(s) };
const text = (n) => (n instanceof Text ? n.text : (n.kids ?? []).map(text).join(''));
const find = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of n.kids ?? []) find(k, f, out); return out; };

const W = await imp('panel/lib/secretwatch.mjs'), UI = await imp('panel/ui/secretwatch.mjs'), C = await imp('panel/lib/connect.mjs');
const NOW = Date.parse('2026-10-12T00:00:00Z'), ago = (d) => new Date(NOW - d * 86_400_000).toISOString();
const SECRETS = [{ name: 'DISCORD_BOT_TOKEN', updated_at: ago(200) }, { name: 'GH_PAT', updated_at: ago(100) }, { name: 'CLOUDFLARE_API_TOKEN', updated_at: ago(10) }, { name: 'ODD', updated_at: ago(95) }, { name: 'NODATE' }];

await t('levels at 90 and 180 days', () => {
  const lv = (d) => W.ageOf([{ name: 'X', updated_at: ago(d) }], { now: NOW })[0].level;
  eq([lv(89), lv(90), lv(179), lv(180)], ['ok', 'old', 'old', 'stale']);
});
await t('oldest first, no date is ok and last', () => {
  const r = W.ageOf(SECRETS, { now: NOW });
  eq(r.map((x) => x.name), ['DISCORD_BOT_TOKEN', 'GH_PAT', 'ODD', 'CLOUDFLARE_API_TOKEN', 'NODATE']);
  eq(r[4], { name: 'NODATE', days: null, level: 'ok', why: '入れた日が分かりません', how: r[4].how });
});
await t('how: GitHub token page, 連携 service, unknown', () => {
  const r = Object.fromEntries(W.ageOf(SECRETS, { now: NOW }).map((x) => [x.name, x.how]));
  ok(r.GH_PAT.url.startsWith('https://github.com/'), 'github link');
  ok(r.DISCORD_BOT_TOKEN.say.includes('連携') && r.DISCORD_BOT_TOKEN.url === null, 'service via 連携, no outside link');
  ok(r.ODD.url === null && r.ODD.say.includes('分かりません'), 'unknown said');
  for (const s of C.SERVICES) for (const n of s.secrets) ok(W.howTo(n).say.includes('連携'), n);
});
await t('bad input is harmless', () => { eq(W.ageOf(null, { now: NOW }), []); eq(W.ageOf([null, {}, { name: 5 }], { now: NOW }), []); });
// (the panel's own api, lib/gh.mjs, over a fake GitHub: every request checked by ghrules' fakeCheck — this card only reads)
const fakeGh = async (answer) => {
  const G = await imp('panel/lib/gh.mjs'), { fakeCheck } = await imp('panel/lib/ghrules.mjs'), seen = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', bad = fakeCheck(method, u.pathname, init.body ? JSON.parse(init.body) : undefined);
    seen.push(`${method} ${u.pathname}`);
    const [status, body] = bad ? [422, { message: bad.message }] : answer(method, u.pathname);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { api: G.gh({ token: 't', fetchImpl }), seen };
};
await t('the card shows only old ones, with the way on, and only github.com links', async () => {
  const f = await fakeGh((m, p) => (m === 'GET' && p === '/repos/o/lab/actions/secrets' ? [200, { total_count: SECRETS.length, secrets: SECRETS }] : [404, { message: 'Not Found' }]));
  const el = UI.secretWatchCard({ api: f.api, lab: { slug: 'o/lab' }, now: NOW });
  await new Promise((r) => setTimeout(r, 20));
  eq(f.seen, ['GET /repos/o/lab/actions/secrets'], 'reads the secrets\' names and dates only');
  await new Promise((r) => setTimeout(r, 0));
  const s = text(el);
  ok(s.includes('DISCORD_BOT_TOKEN') && s.includes('GH_PAT') && s.includes('ODD'), s);
  ok(!s.includes('CLOUDFLARE_API_TOKEN') && s.includes('3 個'), s);
  for (const a of find(el, (n) => n.tag === 'a')) ok(a.attrs.href.startsWith('https://github.com/'), a.attrs.href);
});
await t('a refused read is told, not blank', async () => {
  const f = await fakeGh(() => [403, { message: 'Resource not accessible by integration' }]);
  const el = UI.secretWatchCard({ api: f.api, lab: { slug: 'o/lab' }, now: NOW });
  await new Promise((r) => setTimeout(r, 20));
  ok(/権限がありません/.test(text(el)) && /Resource not accessible/.test(text(el)), text(el));
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
