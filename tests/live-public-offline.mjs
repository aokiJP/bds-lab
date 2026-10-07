// live in a public repository, without a network: the commands, the replies (with their screen) and the sign-in numbers are
// sealed in the issue (a fake issues API shows what GitHub would show everyone); a private one stays as it was.
// node tests/live-public-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LV = await import(pathToFileURL(path.join(TOP, 'app/lib/live.mjs')).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const PUB = { APP_REPO_VISIBILITY: 'public', APP_CACHE_KEY: 'test-key-one' }, PRIV = { APP_REPO_VISIBILITY: 'private', APP_CACHE_KEY: 'test-key-one' };
const OTHER = { APP_REPO_VISIBILITY: 'public', APP_CACHE_KEY: 'test-key-two' }, NOKEY = { APP_REPO_VISIBILITY: 'public' };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9]);

// a fake issues API: what is posted is all that anyone can read
const posted = [];
const fake = async (url, init) => {
  const m = init?.method ?? 'GET';
  if (m === 'POST') { const b = JSON.parse(init.body); posted.push(b.body); return { ok: true, status: 200, json: async () => ({ id: posted.length }) }; }
  return { ok: true, status: 200, json: async () => posted.map((body, i) => ({ id: i + 1, body })) };
};
const api = LV.api({ repo: 'o/r', token: 't', fetchImpl: fake });

await t('public: the command is sealed in the issue, the head stays plain, the same command runs', async () => {
  posted.length = 0;
  const body = LV.commandBody(123, 'screen\ntap 0.5 0.5\nsh cat /secret/pw', PUB);
  await api.comment(1, body);
  const shown = posted.join('\n');
  ok(shown.startsWith('lab@123 lab-sealed:v1:'), shown);
  ok(!/screen|tap|secret|cat/.test(shown.replace('lab-sealed:v1:', '').replace(/^lab@123 /, '')), 'no command in clear: ' + shown);
  eq(LV.commandsOf(posted[0], 123, PUB), ['screen', 'tap 0.5 0.5', 'sh cat /secret/pw']);
  eq(LV.commandsOf(posted[0], 124, PUB), null, 'another run');
});
await t('public: a plain command, another key, an altered comment are no commands', async () => {
  eq(LV.commandsOf('lab@123 screen', 123, PUB), null, 'plain in public');
  const b = LV.commandBody(123, 'screen', PUB);
  eq(LV.commandsOf(b, 123, OTHER), null, 'other key');
  eq(LV.commandsOf(b.slice(0, -4) + 'AAAA', 123, PUB), null, 'altered');
  eq(LV.commandsOf(b, 123, NOKEY), null, 'no key');
  eq(LV.commandBody(123, 'screen', NOKEY), null, 'no key: nothing written');
});
await t('public: the reply (text and screen) is sealed, read back whole; no key writes nothing', async () => {
  const b = LV.replyBody(123, 77, 'line\n```inner``` password=hunter2', png, 60_000, PUB);
  ok(b.startsWith('lab-reply@123 #77\nlab-sealed:v1:') && !/hunter2|inner|line|png:/.test(b.split('\n')[1]), b);
  const back = LV.replyParts(b, 123, PUB);
  eq([back.id, back.text, back.png.equals(png)], [77, "line\n'''inner''' password=hunter2", true]);
  eq(LV.replyParts(b, 123, OTHER), null, 'other key');
  const nk = LV.replyBody(123, 77, 'secret text', png, 60_000, NOKEY);
  ok(!/secret text/.test(nk) && !/png:/.test(nk) && LV.replyParts(nk, 123, NOKEY) === null, nk);
});
await t('public: a screen too big for a comment is left out with a hint; the comment stays under the limit', async () => {
  const big = Buffer.alloc(40_000, 7);
  const b = LV.replyBody(1, 2, 'x'.repeat(100_000), big, 60_000, PUB), back = LV.replyParts(b, 1, PUB);
  ok(b.length < 65_000, `${b.length}`);
  ok(back && back.png === null && /app live pull/.test(back.text), back?.text.slice(-120));
});
await t('public: the two-step number goes sealed and comes back as the code', async () => {
  posted.length = 0;
  await api.comment(1, LV.tellBody(123, 'Microsoft の確認の番号: 47', PUB));
  ok(!/47|Microsoft/.test(posted[0]), posted[0]);
  eq(LV.tellText(posted[0], 123, PUB), 'Microsoft の確認の番号: 47');
  eq(LV.tellText(posted[0], 123, OTHER), null);
  const c = LV.commandBody(123, 'code 123456', PUB);
  ok(!/123456/.test(c), c);
  eq(LV.codeOf(c, 123, PUB), '123456'); eq(LV.codeOf(c, 124, PUB), null); eq(LV.codeOf('lab@123 code 123456', 123, PUB), null, 'plain in public');
  eq(LV.codeOf(LV.commandBody(123, 'code 123456', OTHER), 123, PUB), null);
});
await t('private: as before (plain), and a sealed comment still opens', async () => {
  eq(LV.commandBody(123, 'screen', PRIV), 'lab@123 screen');
  eq(LV.commandsOf('lab@123 screen\ntap 1 1', 123, PRIV), ['screen', 'tap 1 1']);
  eq(LV.commandsOf('lab@123 screen', 123, {}), ['screen'], 'visibility unknown: as before');
  const r = LV.replyBody(123, 5, 'hello', png, 60_000, PRIV);
  ok(/^lab-reply@123 #5\n```\nhello\n```\n<!--png:/.test(r), r);
  eq(LV.replyParts(r, 123, PRIV).text, 'hello');
  eq(LV.tellBody(123, 'n', PRIV), 'lab-live@123 n');
  eq(LV.commandsOf(LV.commandBody(123, 'screen', PUB), 123, PRIV), ['screen'], 'sealed opens in private');
  eq(LV.replyParts(LV.replyBody(123, 6, 'hi', null, 60_000, PUB), 123, PRIV).text, 'hi');
});
await t('GitHub Actions without a visibility: public (the safe side); this machine without one: as before', () => {
  const ACT = { GITHUB_ACTIONS: 'true', APP_CACHE_KEY: 'test-key-one' };
  ok(LV.isPublic(ACT) && !LV.isPublic({}) && !LV.isPublic({ GITHUB_ACTIONS: 'true', APP_REPO_VISIBILITY: 'private' }), 'isPublic');
  ok(LV.commandBody(123, 'code 123456', ACT).startsWith('lab@123 lab-sealed:v1:'), 'sealed in Actions');
});
await t('public reply of multibyte text: sealed, under the comment limit', () => {
  const b = LV.replyBody(123, 8, 'あ'.repeat(100_000), null, 60_000, PUB);
  ok(b.length < 65_536, `${b.length}`);
  ok(/あ$/.test(LV.replyParts(b, 123, PUB).text.trimEnd()), 'tail kept');
});
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
