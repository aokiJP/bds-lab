// the secret map without a browser or a network: usage (dot and bracket forms, GITHUB_TOKEN apart, unused, missing, comments)
// and the card on a small fake DOM over a fake GitHub (lib/gh.mjs + ghrules' fakeCheck).
// node tests/secretmap-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

class Node { constructor() { this.kids = []; this.attrs = {}; } append(...k) { this.kids.push(...k); } replaceChildren(...k) { this.kids = k; } setAttribute(k, v) { this.attrs[k] = v; } addEventListener(k, f) { (this.on ??= {})[k] = f; } }
class Text extends Node { constructor(s) { super(); this.text = s; } }
globalThis.Node = Node;
globalThis.document = { createElement: (tag) => Object.assign(new Node(), { tag }), createTextNode: (s) => new Text(s) };
const text = (n) => (n == null ? '' : n instanceof Text ? n.text : (n.kids ?? []).map(text).join(''));
const find = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of (n.kids ?? []).filter(Boolean)) find(k, f, out); return out; };
const settle = () => new Promise((r) => setTimeout(r, 0));
// (wait until the card has left 「読んでいます」, not a fixed time)
const drawn = async (el) => { for (let i = 0; i < 200 && text(el).includes('読んでいます'); i++) await settle(); };

const M = await imp('panel/lib/secretmap.mjs'), UI = await imp('panel/ui/secretmap.mjs');
const A = '.github/workflows/a.yml', B = '.github/workflows/b.yml';
const FILES = {
  [A]: 'jobs:\n  x:\n    steps:\n      - env:\n          T: ${{ secrets.GITHUB_TOKEN }}\n          D: ${{ secrets.DISCORD_BOT_TOKEN }}\n          K: ${{ secrets[\'API_KEY\'] }}\n      # ${{ secrets.COMMENTED }}\n',
  [B]: 'env:\n  K: ${{ secrets.API_KEY }}\n  M: ${{ secrets.NOT_SET }}\n  Q: ${{ secrets["QUOTED"] }}\n',
};
const WF = Object.entries(FILES).map(([p, x]) => ({ path: p, text: x }));

await t('names: dot, bracket, comment lines skipped', () => {
  eq(M.namesIn(FILES[A]), ['GITHUB_TOKEN', 'DISCORD_BOT_TOKEN', 'API_KEY']);
  eq(M.namesIn(FILES[B]), ['API_KEY', 'NOT_SET', 'QUOTED']);
  eq(M.namesIn(null), []);
});
await t('usage: by workflow, by secret, unused, missing, GITHUB_TOKEN apart', () => {
  const u = M.usage(WF, [{ name: 'DISCORD_BOT_TOKEN' }, { name: 'API_KEY' }, { name: 'OLD_ONE' }]);
  eq(u.byWorkflow[0], { path: A, secrets: ['DISCORD_BOT_TOKEN', 'API_KEY'], builtin: true });
  eq(u.bySecret.API_KEY, [A, B]);
  eq(u.unused, ['OLD_ONE']);
  eq(u.missing, [{ name: 'NOT_SET', paths: [B] }, { name: 'QUOTED', paths: [B] }]);
  ok(!('GITHUB_TOKEN' in u.bySecret), 'built-in apart');
});
await t('usage: secrets not readable → nothing called unused or missing; bad input harmless', () => {
  const u = M.usage(WF, null);
  eq([u.known, u.unused, u.missing], [false, [], []]);
  eq(M.usage(null, undefined).byWorkflow, []);
  eq(M.usage([null, {}, { path: 'x.yml' }], ['A']).unused, ['A']);
});

const fakeGh = async (answer) => {
  const G = await imp('panel/lib/gh.mjs'), { fakeCheck } = await imp('panel/lib/ghrules.mjs'), seen = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET', bad = fakeCheck(method, u.pathname, init.body ? JSON.parse(init.body) : undefined);
    seen.push(`${method} ${u.pathname}`);
    const [status, body] = bad ? [422, { message: bad.message }] : answer(method, decodeURIComponent(u.pathname));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { api: G.gh({ token: 't', fetchImpl }), seen };
};
const answerOk = (m, p) => {
  if (m !== 'GET') return [405, { message: 'no' }];
  if (p === '/repos/o/lab/actions/secrets') return [200, { secrets: [{ name: 'DISCORD_BOT_TOKEN' }, { name: 'API_KEY' }, { name: 'OLD_ONE' }] }];
  const f = p.replace('/repos/o/lab/contents/', '');
  return FILES[f] !== undefined ? [200, { content: Buffer.from(FILES[f]).toString('base64'), sha: 's' }] : [404, { message: 'Not Found' }];
};
const lab = { slug: 'o/lab', workflows: [{ path: A }, { path: B }, { path: '.github/workflows/x.txt' }] };

await t('the card: map, missing with a working button, unused with the check-first words, read only', async () => {
  const f = await fakeGh(answerOk), opened = [];
  const el = UI.secretMapCard({ api: f.api, lab, openSecrets: (n) => opened.push(n) });
  await drawn(el);
  const s = text(el);
  ok(s.includes('a.yml') && s.includes('DISCORD_BOT_TOKEN') && s.includes('NOT_SET') && s.includes('OLD_ONE'), s);
  ok(s.includes('確かめて') && !s.includes('COMMENTED') && !s.includes('GITHUB_TOKEN'), s);
  ok(f.seen.every((x) => x.startsWith('GET ')), f.seen.join());
  const bs = find(el, (n) => n.tag === 'button');
  eq(bs.length, 2);
  bs[0].on.click(); eq(opened, ['NOT_SET']);
  for (const a of find(el, (n) => n.tag === 'a')) ok(a.attrs.href.startsWith('https://github.com/'), a.attrs.href);
});
await t('no way to open 「秘密」: no button, the words say where instead', async () => {
  const f = await fakeGh(answerOk), el = UI.secretMapCard({ api: f.api, lab });
  await drawn(el);
  eq(find(el, (n) => n.tag === 'button').length, 0);
  ok(text(el).includes('「秘密」のタブ'), text(el));
});
await t('secret names refused: said, and nothing called missing or unused', async () => {
  const f = await fakeGh((m, p) => (p.endsWith('/actions/secrets') ? [403, { message: 'Resource not accessible' }] : answerOk(m, p)));
  const el = UI.secretMapCard({ api: f.api, lab });
  await drawn(el);
  ok(text(el).includes('読む権利がない') && !text(el).includes('足りない秘密が'), text(el));
});
await t('a failed read is told with a way on', async () => {
  const f = await fakeGh(() => [500, { message: 'boom' }]);
  const el = UI.secretMapCard({ api: f.api, lab });
  await drawn(el);
  ok(find(el, (n) => n.attrs?.role === 'alert').length === 1, text(el));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
