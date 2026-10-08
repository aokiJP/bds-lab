// the management panel's news (an inbox), its use with no network (a service worker) and its bulk secrets, without a browser or
// a network: what is new between two looks at the lab (runs that ended or failed, joins, lenders, invitations, a newer
// version) and the list that keeps it (200 at most, each once, read or not, in a storage that may refuse); a .env text read
// into secrets (quotes, comments, several lines, what is refused — and no value ever in a message); the service worker's file
// run in node:vm against a fake cache, network and windows (where each request goes, the shell kept at install all or
// nothing, the network first for the page and config.json, the kept copy first for the rest, GitHub and every other origin
// never touched, a tapped notification opening the panel); and the three screens on a small fake DOM.
// node tests/inbox-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const IB = await imp('panel/lib/inbox.mjs'), BK = await imp('panel/lib/bulk.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const throws = async (fn, re, m) => { let e = null; try { await fn(); } catch (x) { e = x; } ok(e && re.test(e.message), `${m}: ${e?.message ?? 'did not throw'}`); };

// ---- what is new between two looks ----
const T0 = Date.parse('2026-10-08T00:00:00Z');
const run = (id, status, conclusion = null, o = {}) => ({ id, name: 'verify', status, conclusion, run_attempt: 1, head_branch: 'main', html_url: `https://github.com/o/lab/actions/runs/${id}`,
  created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z', triggering_actor: { login: 'me' }, ...o });
const join = (n, login, note = '手伝いたいです') => ({ number: n, login, body: `${note}\n\n— ${login}（管理パネルから）`, at: '2026-10-08T01:00:00Z', url: `https://github.com/o/lab/issues/${n}` });
const lender = (slug, ok = true) => ({ slug, owner: slug.split('/')[0], always: { ok, why: [] }, admin: false, rules: { minutesPerMonth: 50000 } });
const invite = (id, full, fork = true) => ({ id, repository: { full_name: full, fork }, inviter: { login: full.split('/')[0] }, created_at: '2026-10-08T02:00:00Z', html_url: `https://github.com/${full}/invitations` });
const NEWER = { state: 'newer', say: '新しい版 abc1234 が出ています: 読み直すと使えます（このページ: def5678）' }, LIVE = { state: 'live', say: 'このページ: def5678（いちばん新しい版）' };
const snap = (o, ms = T0) => IB.snapshot(o, ms);

await t('a snapshot keeps only what the list needs, as lists by id; a part that was not read stays null (pure)', () => {
  const s = snap({ runs: [run(1, 'in_progress', null, { token: 'ghp_ABCDEFGHIJKLMNOPQRSTUV', head_commit: { message: 'secret thing' } }), run(2, 'completed', 'failure', { html_url: 'http://insecure/x', name: '  a\n  b  ' })],
    joins: [join(7, 'newbie')], forks: [lender('bob/lab')], invitations: [invite(55, 'bob/lab'), invite(56, 'x/y', false)], version: NEWER });
  eq(s.v, 1); eq(s.at, '2026-10-08T00:00:00.000Z');
  eq(s.runs[0], { id: '1', name: 'verify', status: 'in_progress', conclusion: null, attempt: 1, branch: 'main', actor: 'me', at: '2026-10-08T00:03:00Z', url: 'https://github.com/o/lab/actions/runs/1', repo: 'o/lab' });
  eq([s.runs[1].name, s.runs[1].url, s.runs[1].repo], ['a b', '', null], 'cut to one line; only https addresses');
  eq(s.joins, [{ id: '7', login: 'newbie', body: '手伝いたいです', at: '2026-10-08T01:00:00Z', url: 'https://github.com/o/lab/issues/7' }]);
  eq(s.forks, [{ id: 'bob/lab', owner: 'bob', always: true }]);
  eq(s.invitations.map((i) => i.id), ['55'], 'only a fork\'s invitation');
  eq(s.version, NEWER);
  ok(!/ghp_|secret thing/.test(JSON.stringify(s)), 'a field it was not asked to keep is never kept');
  const none = snap({});
  eq([none.runs, none.joins, none.forks, none.invitations, none.version], [null, null, null, null, null], 'not read');
  eq(snap({ runs: [] }).runs, [], 'read, and empty');
  eq(snap({ runs: Array.from({ length: 130 }, (_, i) => run(i + 1, 'completed', 'success')) }).runs.length, 100, 'the newest 100');
  eq(JSON.parse(JSON.stringify(s)), s, 'plain data: it can be kept as JSON');
});

await t('diff: nothing on the first look; a run told when it ended after it was seen going, a failure when it is new; a pass nobody saw going is not told (pure)', () => {
  const prev = snap({ runs: [run(1, 'in_progress'), run(2, 'completed', 'failure'), run(5, 'queued')] });
  const next = snap({ runs: [run(1, 'completed', 'success'), run(2, 'completed', 'failure'), run(3, 'completed', 'failure'), run(4, 'completed', 'success'), run(5, 'in_progress')] }, T0 + 60_000);
  eq(IB.diff(null, next), [], 'no look before');
  eq(IB.diff(undefined, next), []);
  eq(IB.diff({ v: 2, runs: [] }, next), [], 'a snapshot of another form is no look');
  const out = IB.diff(prev, next);
  eq(out.map((e) => e.id), ['run:1:1:success', 'run:3:1:failure'], 'run 1 ended; run 3 failed unseen; run 2 failed already; run 4 passed unseen; run 5 still going');
  eq(out[0], { id: 'run:1:1:success', kind: 'run', title: '✅ verify が通りました', body: 'main · me', tab: 'runs', at: '2026-10-08T00:03:00Z', level: 'ok', run: '1', repo: 'o/lab', url: 'https://github.com/o/lab/actions/runs/1' });
  eq([out[1].kind, out[1].level, out[1].title], ['failure', 'bad', '❌ verify が失敗しました']);
  eq(IB.diff(next, next), [], 'nothing changed: nothing new');
  // what a run says by how it ended
  const ends = (c) => IB.diff(snap({ runs: [run(9, 'in_progress')] }), snap({ runs: [run(9, 'completed', c)] }))[0];
  eq([ends('cancelled').kind, ends('cancelled').level, ends('cancelled').title], ['run', 'info', '⏹️ verify が止まりました']);
  eq([ends('action_required').level, ends('action_required').title], ['warn', '✋ verify が承認を待っています']);
  eq([ends('timed_out').kind, ends('timed_out').title], ['failure', '⌛ verify が時間切れになりました']);
  eq([ends('startup_failure').kind, ends('startup_failure').title], ['failure', '💥 verify が始められませんでした']);
  eq(ends('skipped').title, '⏭️ verify が飛ばされました');
  // a re-run is a new attempt: told again (its id differs), though nobody saw it going
  const again = IB.diff(snap({ runs: [run(2, 'completed', 'failure')] }), snap({ runs: [run(2, 'completed', 'failure', { run_attempt: 2 })] }));
  eq(again.map((e) => e.id), ['run:2:2:failure']);
  eq(IB.diff(snap({ runs: [run(2, 'completed', 'failure')] }), snap({ runs: [run(2, 'completed', 'success', { run_attempt: 2 })] })).map((e) => e.id), ['run:2:2:success'], 'a re-run that passes is told too');
  // the time of a run with no time of its own: the look it was found at
  eq(IB.diff(snap({ runs: [run(1, 'in_progress')] }), snap({ runs: [run(1, 'completed', 'failure', { updated_at: undefined, created_at: undefined })] }, T0 + 5000))[0].at, '2026-10-08T00:00:05.000Z');
});

await t('diff: a request to join, a new lender, an invitation from a fork, a newer version — each once, in that order after the runs (pure)', () => {
  const prev = snap({ runs: [run(1, 'in_progress')], joins: [join(7, 'old')], forks: [lender('amy/lab')], invitations: [invite(50, 'amy/lab')], version: LIVE });
  const next = snap({ runs: [run(1, 'completed', 'failure')], joins: [join(7, 'old'), join(8, 'newbie')], forks: [lender('amy/lab'), lender('bob/lab')], invitations: [invite(50, 'amy/lab'), invite(55, 'bob/lab'), invite(56, 'x/y', false)], version: NEWER }, T0 + 90_000);
  const out = IB.diff(prev, next);
  eq(out.map((e) => e.id), ['run:1:1:failure', 'join:8', 'fork:bob/lab', 'invite:55', 'version:abc1234']);
  eq(out[1], { id: 'join:8', kind: 'join', title: '🙋 newbie さんから参加のお願い', body: '手伝いたいです', tab: 'members', at: '2026-10-08T01:00:00Z', level: 'warn', url: 'https://github.com/o/lab/issues/8' });
  eq(out[2], { id: 'fork:bob/lab', kind: 'fork', title: '⏱ bob さんがフォークで貸し始めました', body: 'bob/lab・いつも貸す', tab: 'hosts', at: '2026-10-08T00:01:30.000Z', level: 'info' });
  eq(out[3], { id: 'invite:55', kind: 'invite', title: '📨 bob/lab への招待が届きました', body: 'bob さんから: 受けると、そのフォークを預かれます', tab: 'hosts', at: '2026-10-08T02:00:00Z', level: 'warn', url: 'https://github.com/bob/lab/invitations' });
  eq(out[4], { id: 'version:abc1234', kind: 'version', title: '🆕 新しい版が出ています', body: NEWER.say, tab: 'overview', at: '2026-10-08T00:01:30.000Z', level: 'info' });
  eq(IB.diff(next, next), [], 'again: nothing');
  eq(IB.diff(next, snap({ ...{ runs: [], joins: [], forks: [], invitations: [] }, version: NEWER })), [], 'things that went away are not news; the same newer version is not told twice');
  eq(IB.diff(snap({ version: LIVE }), snap({ version: { state: 'newer', say: '新しい版 bbbbbbb が出ています' } })).map((e) => e.id), ['version:bbbbbbb']);
  eq(IB.diff(snap({ version: NEWER }), snap({ version: { state: 'newer', say: '新しい版 bbbbbbb が出ています' } })).map((e) => e.id), ['version:bbbbbbb'], 'a still newer one is news again');
  for (const state of ['live', 'deploying', 'failed', 'unknown']) eq(IB.diff(snap({ version: LIVE }), snap({ version: { state, say: 'x' } })), [], `${state}: not a new version`);
  eq(IB.diff(snap({ version: LIVE }), snap({ version: { state: 'newer', say: 'x' } })).map((e) => e.id), ['version:newer'], 'a say with no address in it');
});

await t('diff: a part that could not be read, on either side, is never taken for one that is empty (pure)', () => {
  const full = snap({ joins: [join(7, 'a')], forks: [lender('amy/lab')], invitations: [invite(50, 'amy/lab')], runs: [run(1, 'completed', 'failure')] });
  const blind = snap({});
  eq(IB.diff(blind, full), [], 'the look before could not read anything: no baseline, no flood');
  eq(IB.diff(full, blind), [], 'now it cannot: nothing new either');
  eq(IB.diff(snap({ joins: [] }), snap({ joins: [join(7, 'a')] })).map((e) => e.id), ['join:7'], 'read and empty before: a baseline');
  eq(IB.diff(snap({ joins: null, forks: [] }), snap({ joins: [join(7, 'a')], forks: [lender('amy/lab')] })).map((e) => e.id), ['fork:amy/lab'], 'only the parts both sides read');
});

// ---- the list that keeps the news ----
/** a storage that may refuse (the browser's own is a plain object to the store: getItem / setItem / removeItem) */
const fakeStorage = () => { const m = new Map(), s = { m, refuse: false, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem(k, v) { if (s.refuse) throw new Error('QuotaExceededError'); m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; return s; };
const ev = (id, at, o = {}) => ({ id, kind: 'run', title: `title ${id}`, body: '', tab: 'runs', at, level: 'info', ...o });

await t('the store: add (an id only once, the newest 200), list newest first, unread, markRead(id | all), clear — kept in the storage under its key', () => {
  const st = fakeStorage(), box = IB.store(st, 'k1');
  eq([box.list(), box.unread()], [[], 0]);
  eq(box.add([ev('a', '2026-10-08T00:01:00Z'), ev('b', '2026-10-08T00:03:00Z'), ev('c', '2026-10-08T00:02:00Z')]), 3);
  eq(box.list().map((x) => x.id), ['b', 'c', 'a'], 'newest first');
  eq(box.unread(), 3);
  eq(box.add(ev('a', '2026-10-08T00:09:00Z')), 0, 'an id already there is not added again');
  eq(box.add([ev('b', '2026-10-08T00:09:00Z'), ev('d', '2026-10-08T00:04:00Z')]), 1);
  eq(box.list().map((x) => x.id), ['d', 'b', 'c', 'a']);
  eq(box.markRead('nope'), 0);
  eq(box.markRead('b'), 1);
  eq([box.unread(), box.list().find((x) => x.id === 'b').read], [3, true]);
  eq(box.markRead('b'), 0, 'already read');
  eq(box.add(ev('b', '2026-10-08T00:10:00Z', { read: false })), 0);
  eq(box.list().find((x) => x.id === 'b').read, true, 'a piece found again does not become unread');
  eq(box.markRead('all'), 3);
  eq(box.unread(), 0);
  eq(box.markRead('all'), 0);
  // a new box over the same storage and key sees the same list; another key does not
  eq(IB.store(st, 'k1').list().length, 4);
  eq(IB.store(st, 'k2').list().length, 0);
  eq(box.clear(), 4);
  eq([box.list(), box.clear()], [[], 0]);
  eq(st.m.has('k1'), false, 'cleared: gone from the storage');
  // what comes in is cut to size, only https addresses are kept, an unknown level is plain, the read mark is its own
  box.add({ id: 'x'.repeat(300), kind: 'Ru<n>', title: 'T'.repeat(500), body: 'B\n\n  b'.repeat(200), tab: 'ru ns', at: 'not a time', level: 'loud', run: 'r42x', repo: 'o/lab', url: 'javascript:alert(1)', read: true, extra: 'ghp_SECRETSECRETSECRETSE' }, T0);
  const [x] = box.list();
  eq([x.id.length, x.kind, x.title.length, x.body.length <= 300, x.tab, x.at, x.level, x.run, x.url, x.read], [200, 'un', 200, true, 'runs', '2026-10-08T00:00:00.000Z', 'info', '42', '', false]);
  ok(!/ghp_/.test(st.m.get('k1')), 'a field it was not asked to keep is never kept');
  eq(box.add([null, undefined, 5, {}, { id: 'only id' }, { title: 'only title' }, { id: 7, title: 'id not text' }]), 0, 'what is not a piece of news is not added');
});

await t('the store keeps the newest 200 (the oldest go); a storage with junk in it, or one that refuses, is no trouble', () => {
  const st = fakeStorage(), box = IB.store(st, 'k');
  const many = Array.from({ length: 250 }, (_, i) => ev(`e${i}`, new Date(T0 + i * 1000).toISOString()));
  eq(box.add(many), 200, 'only the 200 newest stay, and that is what was added');
  const l = box.list();
  eq([l.length, l[0].id, l.at(-1).id], [200, 'e249', 'e50']);
  eq(box.add(ev('old', '2020-01-01T00:00:00Z')), 0, 'older than all of them, and the list is full: it does not stay');
  eq(IB.store(fakeStorage(), 'k', { max: 3 }).add(many.slice(0, 5)), 3);
  for (const junk of ['not json', '{"v":1,"items":"x"}', '{"items":[null,1,"x",{"id":"a"},{"id":"b","title":"ok","at":"2026-10-08T00:00:00Z"}]}', 'null', '[]']) {
    const s2 = fakeStorage(); s2.m.set('k', junk);
    const b2 = IB.store(s2, 'k');
    eq(b2.list().map((x) => x.id), junk.includes('"b"') ? ['b'] : [], junk);
    eq(b2.markRead('all'), junk.includes('"b"') ? 1 : 0, junk);
  }
  // a list somebody else wrote out of order (another tab, a hand-edited storage) is read newest first
  const out = fakeStorage(); out.m.set('k', JSON.stringify({ v: 1, items: [ev('old', '2026-10-08T00:01:00Z'), ev('new', '2026-10-08T00:09:00Z'), ev('mid', '2026-10-08T00:05:00Z')] }));
  eq(IB.store(out, 'k').list().map((x) => x.id), ['new', 'mid', 'old']);
  const closed = fakeStorage(); closed.refuse = true;
  const b3 = IB.store(closed, 'k');
  eq(b3.add(ev('a', '2026-10-08T00:00:00Z')), 1, 'told it was new, nothing thrown');
  eq([b3.list(), b3.unread(), b3.markRead('all'), b3.clear()], [[], 0, 0, 0], 'and nothing is kept');
  const gone = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } };
  const b4 = IB.store(gone, 'k');
  eq([b4.list(), b4.unread(), b4.last()], [[], 0, null]);
  b4.remember(snap({})); b4.clear();
});

await t('the store tells whoever listens, once for what changed — through any store over the same storage and key — and a listener that fails or leaves is no trouble', () => {
  const st = fakeStorage(), a = IB.store(st, 'k'), b = IB.store(st, 'k'), other = IB.store(st, 'other');
  let n = 0, m = 0;
  const off = a.onChange(() => { n++; });
  b.onChange(() => { m++; throw new Error('a view fell over'); });
  b.add(ev('x', '2026-10-08T00:00:00Z'));
  eq([n, m], [1, 1], 'a store over the same key hears of what another one added');
  a.add(ev('x', '2026-10-08T00:00:00Z'));
  eq([n, m], [1, 1], 'nothing new: nothing said');
  a.markRead('x'); eq([n, m], [2, 2]);
  a.markRead('x'); eq([n, m], [2, 2], 'nothing changed');
  other.add(ev('y', '2026-10-08T00:00:00Z')); eq([n, m], [2, 2], 'another key');
  a.clear(); eq([n, m], [3, 3]);
  a.clear(); eq([n, m], [3, 3]);
  off();
  b.add(ev('z', '2026-10-08T00:00:00Z'));
  eq([n, m], [3, 4], 'one that left is not told');
  // many boxes made over the same storage: one set of listeners, not one each
  const sets = Array.from({ length: 5 }, () => IB.store(st, 'k').onChange(() => { n++; }));
  b.add(ev('w', '2026-10-08T00:00:00Z'));
  eq(n, 3 + 5);
  for (const f of sets) f();
});

await t('the store keeps the snapshot of the last look (for the next diff), and nothing but a snapshot', () => {
  const st = fakeStorage(), box = IB.store(st, 'k');
  eq(box.last(), null);
  const s = snap({ runs: [run(1, 'in_progress')], joins: [join(7, 'a')], forks: null });
  box.remember(s);
  eq(IB.store(st, 'k').last(), s, 'it comes back as it went in, for another store too');
  eq(IB.store(st, 'other').last(), null);
  box.remember({ v: 2 }); eq(box.last(), null, 'not a snapshot of ours: forgotten');
  box.remember(s); box.remember(null); eq(box.last(), null);
  st.m.set('k.snapshot', JSON.stringify({ v: 1, at: 'x', runs: 'junk', joins: null })); eq(box.last(), null, 'junk');
  st.m.set('k.snapshot', 'not json'); eq(box.last(), null);
  // the whole loop: look, ask what is new, keep it, look again later
  const b2 = IB.store(fakeStorage(), 'loop');
  const look = (o, ms) => { const next = snap(o, ms), news = IB.diff(b2.last(), next); b2.remember(next); return b2.add(news, ms); };
  eq(look({ runs: [run(1, 'in_progress')] }, T0), 0, 'the first look tells nothing');
  eq(look({ runs: [run(1, 'completed', 'failure')] }, T0 + 1000), 1);
  eq(look({ runs: [run(1, 'completed', 'failure')] }, T0 + 2000), 0);
  eq(b2.list().map((x) => x.id), ['run:1:1:failure']);
});

// ---- a .env text into secrets ----
const names = (r) => r.items.map((x) => x.name), vals = (r) => Object.fromEntries(r.items.map((x) => [x.name, x.value]));

await t('parseEnv: KEY=VALUE, export, spaces round the =, comments, blank lines, CRLF and a BOM; the names in the order they first appear (pure)', () => {
  const r = BK.parseEnv('\uFEFF# the lab\r\nMS_EMAIL=me@example.com\r\n\r\nexport MS_PASSWORD = hunter two  \r\n   \t# indented comment\r\n  \tAPP_CACHE_KEY=abc=def==\r\nB2=\nHOST_URL=https://x.example/a#frag\nLEFT=value # a note\nQ=\'x\'   # after a quote\nZ_9=1');
  eq(r.errors, ['7 行目: B2 の値が空です（空の秘密は登録できません）']);
  eq(r.warnings, []);
  eq(names(r), ['MS_EMAIL', 'MS_PASSWORD', 'APP_CACHE_KEY', 'HOST_URL', 'LEFT', 'Q', 'Z_9']);
  eq(vals(r), { MS_EMAIL: 'me@example.com', MS_PASSWORD: 'hunter two', APP_CACHE_KEY: 'abc=def==', HOST_URL: 'https://x.example/a#frag', LEFT: 'value', Q: 'x', Z_9: '1' });
  const crlf = BK.parseEnv('A="x"\r\nB=\'y\' # n\r\nPEM="l1\r\nl2"\r\nC=z\r\n');
  eq([crlf.errors, vals(crlf)], [[], { A: 'x', B: 'y', PEM: 'l1\nl2', C: 'z' }], 'a Windows file: lines end with \\r\\n, a key too');
  eq([BK.parseEnv('\uFEFFFIRST=1\nSECOND=2').errors, names(BK.parseEnv('\uFEFFFIRST=1\nSECOND=2'))], [[], ['FIRST', 'SECOND']], 'a byte order mark in front of the first name');
  eq(BK.parseEnv(''), { items: [], errors: [], warnings: [] });
  eq(BK.parseEnv(null), { items: [], errors: [], warnings: [] });
  eq(BK.parseEnv('# only\n\n   \n'), { items: [], errors: [], warnings: [] });
  const hash = BK.parseEnv('A=#x\nB= # note\nC=1\n');
  eq(vals(hash), { A: '#x', C: '1' }, 'a # after a space starts a note, a # right after the = does not');
  eq(hash.errors, ['2 行目: B の値が空です（空の秘密は登録できません）'], 'a note is not a value');
});

await t('parseEnv: quoted values — single as they are, double with \\n \\r \\t \\" \\\\, # and spaces inside, over several lines, a note after the closing quote (pure)', () => {
  const pem = '-----BEGIN KEY-----\nAAAA\nBBBB\n-----END KEY-----';
  const r = BK.parseEnv(`SQ='a # b  c \\n \\" $X'\nDQ="a # b  c \\n \\" \\\\ \\t \\d $X"\nKEY="${pem}"   # a note\nSEC='one\ntwo'\nLAST=after`);
  eq(r.errors, []);
  eq(vals(r), { SQ: 'a # b  c \\n \\" $X', DQ: 'a # b  c \n " \\ \t \\d $X', KEY: pem, SEC: 'one\ntwo', LAST: 'after' });
  eq(BK.parseEnv('A="  padded  "\nB=\'\'x').errors, ['2 行目: 引用符のあとに余計な文字があります（2 行目）']);
  eq(vals(BK.parseEnv('A="  padded  "')), { A: '  padded  ' }, 'inside quotes nothing is trimmed');
  // line numbers go on counting after a value that ran over several lines
  const e = BK.parseEnv('A="x\ny\nz"\nbad line\nB=');
  eq(e.errors, ['4 行目: KEY=VALUE の形ではありません', '5 行目: B の値が空です（空の秘密は登録できません）']);
  eq(BK.parseEnv('A="x\ny" trailing\nB=1').errors, ['1 行目: 引用符のあとに余計な文字があります（2 行目）'], 'told where the quote closed');
  eq(BK.parseEnv('B=1\nA="never closed\nC=2\nD=3').errors, ['2 行目: 引用符 " が閉じていません'], 'nothing after an unclosed quote can be trusted');
  eq(BK.parseEnv('B=1\nA=\'never closed').items.map((x) => x.name), ['B']);
});

await t('parseEnv: a name GitHub does not take, a value it cannot hold — said by line, the good lines still read (pure)', () => {
  const r = BK.parseEnv('lower=1\n9LIVES=1\nGITHUB_TOKEN=x\nGITHUB_=x\nHAS-DASH=1\nHAS.DOT=1\nNO_VALUE=\nEMPTY_QUOTES=""\nBLANK=\'   \'\nNO EQUALS\n=nameless\njust-a-word\nGOOD=1\n_ALSO=2\nA1_B2=3');
  eq(r.errors, [
    '1 行目: 名前は英大文字・数字・_ だけです（数字から始めません）', '2 行目: 名前は英大文字・数字・_ だけです（数字から始めません）',
    '3 行目: GITHUB_TOKEN は GITHUB_ で始まる名前にできません', '4 行目: GITHUB_ は GITHUB_ で始まる名前にできません',
    '5 行目: 名前は英大文字・数字・_ だけです（数字から始めません）', '6 行目: 名前は英大文字・数字・_ だけです（数字から始めません）',
    '7 行目: NO_VALUE の値が空です（空の秘密は登録できません）', '8 行目: EMPTY_QUOTES の値が空です（空の秘密は登録できません）', '9 行目: BLANK の値が空です（空の秘密は登録できません）',
    '10 行目: KEY=VALUE の形ではありません', '11 行目: KEY=VALUE の形ではありません', '12 行目: KEY=VALUE の形ではありません']);
  eq(names(r), ['GOOD', '_ALSO', 'A1_B2'], 'the good lines are still read; the page registers nothing while there are errors');
  const big = BK.parseEnv(`BIG="${'あ'.repeat(17000)}"\nSMALL="${'x'.repeat(40000)}"\nEDGE='${'y'.repeat(BK.MAX_BYTES)}'`);
  eq(big.errors, ['1 行目: BIG が大きすぎます（48 KB まで）'], 'counted in bytes: 17000 three-byte letters are over, 40000 one-byte letters and exactly 48 KB are not');
  eq(names(big), ['SMALL', 'EDGE']);
  const hundred = Array.from({ length: 101 }, (_, i) => `K${i}=v`).join('\n');
  eq(BK.parseEnv(hundred).errors, ['秘密は 100 個までです（GitHub の上限）: 貼られたのは 101 個']);
  eq(BK.parseEnv(hundred.split('\n').slice(0, 100).join('\n')).errors, []);
});

await t('parseEnv: a name given twice — the later one is used, in the place of the first, with a warning that says the lines (pure)', () => {
  const r = BK.parseEnv('A=1\nB=2\n# x\nA=3\nA=4');
  eq(r.items, [{ name: 'A', value: '4' }, { name: 'B', value: '2' }]);
  eq(r.warnings, ['A が 1 行目と 4 行目にあります: 後のものを使います', 'A が 4 行目と 5 行目にあります: 後のものを使います']);
  eq(r.errors, []);
  eq(BK.parseEnv('A=1\nA=\n').items, [{ name: 'A', value: '1' }], 'an empty later one is an error, not a replacement');
  eq(BK.parseEnv('A=1\nA=\n').errors, ['2 行目: A の値が空です（空の秘密は登録できません）']);
});

await t('parseEnv: no value ever in an error or a warning — not of a refused line, a stray token, a bad quote, a name given twice (pure)', () => {
  const SECRETS = ['ghp_SUPERSECRETTOKEN1234567890abcdef', 'sk-ant-api03-ZZZZ-wwww-1111', 'p@ss w0rd with spaces', 'c2VjcmV0LXRva2VuLWhlcmU', 'ZmFrZQ'];
  const text = [
    `lower_name=${SECRETS[0]}`, `GITHUB_TOKEN=${SECRETS[1]}`, `OKAY="${SECRETS[2]}" trailing junk`, `${SECRETS[0]}`, `${SECRETS[3]}=`, `${SECRETS[4]}==`,
    `has space=${SECRETS[1]}`, `DUP=${SECRETS[0]}`, `DUP=${SECRETS[1]}`, `FINE=${SECRETS[2]}`, `"${SECRETS[0]}"`, `NAME=\'${SECRETS[3]}`].join('\n');
  const r = BK.parseEnv(text);
  const said = JSON.stringify([r.errors, r.warnings]);
  for (const s of SECRETS) ok(!said.includes(s) && !said.includes(s.slice(0, 12)), `a value is in the messages: ${s}\n${said}`);
  ok(r.errors.length >= 8 && r.warnings.length === 1, said);
  ok(r.errors.every((e) => /^\d+ 行目: /.test(e)), 'every error says its line');
  eq(vals(r).DUP, SECRETS[1]);
  // a name is said only when it has the right form
  ok(/GITHUB_TOKEN/.test(said) && /DUP/.test(said), said);
});

// ---- the service worker, run in node:vm against a fake cache, network and windows ----
const SW_SRC = fs.readFileSync(path.join(TOP, 'panel', 'sw.js'), 'utf8');
const B = 'https://o.github.io/bds-lab/', ORIGIN = 'https://o.github.io';
/** panel/sw.js loaded as a browser loads it (a classic script in a worker's global scope) over a fake CacheStorage, network and
 *  window list. site: address → body | { body, status }; kept: caches there already (name → { address: body }) */
function loadSw({ href = `${B}sw.js?v=v1`, site = {}, kept = {}, windows = [] } = {}) {
  const listeners = {}, log = { fetched: [], skipped: 0, claimed: 0, opened: [] }, net = { offline: false };
  const store = new Map(Object.entries(kept).map(([n, files]) => [n, new Map(Object.entries(files).map(([u, body]) => [u, { body, status: 200 }]))]));
  const urlOf = (r) => (typeof r === 'string' ? r : r.url);
  const cacheOf = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return { put: async (r, res) => { m.set(urlOf(r), { body: await res.text(), status: res.status }); }, match: async (r) => { const e = m.get(urlOf(r)); return e ? new Response(e.body, { status: e.status }) : undefined; } };
  };
  const sandbox = {
    URL, Response, console, location: { href, origin: new URL(href).origin },
    caches: { open: async (n) => cacheOf(n), keys: async () => [...store.keys()], delete: async (n) => store.delete(n) },
    fetch: async (req, init) => {
      const u = urlOf(req); log.fetched.push({ url: u, cache: init?.cache });
      if (net.offline) throw new TypeError('Failed to fetch');
      const e = site[u], r = new Response(e === undefined ? 'not found' : typeof e === 'string' ? e : e.body, { status: e === undefined ? 404 : e.status ?? 200 });
      Object.defineProperty(r, 'type', { value: 'basic' });
      return r;
    },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    skipWaiting: async () => { log.skipped++; },
    clients: { claim: async () => { log.claimed++; }, matchAll: async () => windows, openWindow: async (u) => { log.opened.push(u); return {}; } },
  };
  vm.runInContext(SW_SRC, vm.createContext(sandbox), { filename: 'panel/sw.js' });
  const fire = async (type, extra = {}) => {
    const waits = [], e = { waitUntil: (p) => { waits.push(Promise.resolve(p)); }, ...extra };
    for (const fn of listeners[type] ?? []) fn(e);
    await Promise.all(waits);
    return e;
  };
  /** a request from the page → null when the worker leaves it to the browser, else the Response (a rejection: the network failed) */
  const request = async (url, { mode = 'cors', method = 'GET', cache = 'default' } = {}) => {
    const waits = [], e = { request: { url, method, mode, cache }, waitUntil: (p) => { waits.push(Promise.resolve(p)); }, respondWith: (p) => { e.answer = Promise.resolve(p); } };
    for (const fn of listeners.fetch ?? []) fn(e);
    if (!e.answer) return null;
    const res = await e.answer;
    await Promise.all(waits);
    return res;
  };
  const kept2 = (name) => { const m = store.get(name); return m ? Object.fromEntries([...m].map(([u, x]) => [u, x.body])) : null; };
  return { sandbox, route: sandbox.route, target: sandbox.target, listeners, log, net, store, fire, request, kept: kept2, site };
}
const SITE = () => ({
  [`${B}index.html`]: '<!doctype html>INDEX', [`${B}panel.css`]: 'css', [`${B}manifest.webmanifest`]: '{}', [`${B}icon.svg`]: '<svg/>', [`${B}config.json`]: '{"version":"v1"}',
  [`${B}panel.js`]: "import { h } from './ui/dom.mjs';\nimport * as M from './lib/model.mjs';\nimport './lib/side.mjs';\nexport * from './lib/re.mjs';\nconst lazy = () => import('./lib/lazy.mjs');\nimport x from 'https://evil.example/x.mjs';\nimport y from '../../outside.mjs';\nimport z from \"./lib/q.mjs?v=2#h\";\n// said from './lib/ghost.mjs'\n",
  [`${B}ui/dom.mjs`]: 'export const h = 1;', [`${B}lib/model.mjs`]: "import { y } from './seal.mjs';\nexport const M = 1;", [`${B}lib/seal.mjs`]: 'export const y = 2;', [`${B}lib/side.mjs`]: '',
  [`${B}lib/re.mjs`]: "import '../ui/dom.mjs';", [`${B}lib/lazy.mjs`]: 'export default 1;', [`${B}lib/q.mjs`]: 'export default 2;', [`${B}lib/new.mjs`]: 'export const fresh = 1;',
});
const CACHE_V1 = 'bdslab-panel:/bds-lab/:v1';

await t('sw.js route(url, origin): the page and config.json network first, the panel\'s other files cache first, GitHub\'s API, every other origin and the worker itself not touched (node:vm)', () => {
  const { route } = loadSw();
  const r = (u, mode) => route(u, ORIGIN, mode);
  for (const u of [B, `${B}index.html`, `${B}?code=abc123`, `${B}index.html#runs`, `${B}config.json`, `${B}config.json?x=1`, ORIGIN + '/', `${B}other.html`]) eq(r(u), 'network-first', u);
  for (const u of [`${B}panel.js`, `${B}panel.css`, `${B}lib/model.mjs`, `${B}ui/dom.mjs`, `${B}icon.svg`, `${B}manifest.webmanifest`, `${B}lib/model.mjs?v=2`, `${B}README.md`]) eq(r(u), 'cache-first', u);
  eq(r(B.slice(0, -1), 'navigate'), 'network-first', 'a navigation is the page whatever its address');
  eq(r(`${B}panel.js`, 'cors'), 'cache-first');
  for (const u of ['https://api.github.com/user', 'https://api.github.com/repos/o/lab/actions/runs', 'https://avatars.githubusercontent.com/u/1', 'https://github.com/o/lab', 'https://bds-lab-auth.o.workers.dev/refresh', 'http://o.github.io/bds-lab/panel.js',
    'https://o.github.io.evil.example/panel.js', 'https://evil.example/o.github.io/panel.js', 'data:text/plain,hi', 'blob:https://o.github.io/1', 'chrome-extension://x/y.js', `${B}sw.js`, `${B}sw.js?v=abc`, ORIGIN + '/sw.js']) eq(r(u), 'pass', u);
  eq(r('https://api.github.com/user', 'navigate'), 'pass', 'not even as a navigation');
  eq(route('https://api.github.com/user', 'https://api.github.com'), 'pass', 'and never GitHub\'s API');
  eq(r('not a url at all'), 'cache-first', 'a relative address is read against the origin');
  eq([route('', ORIGIN), route(undefined, ORIGIN), route(null, ORIGIN)].length, 3, 'whatever it is given, it answers');
  eq(route(`${B}panel.js`, ''), 'pass', 'no origin: nothing is ours');
  eq(route(`${B}panel.js`, 'null'), 'pass');
  eq(route('http://[bad', ORIGIN), 'pass', 'an address that does not parse');
});

await t('sw.js install: the shell fetched afresh — every module found by reading imports, nothing outside the folder — and kept in this version\'s cache; skipWaiting after (node:vm, fake cache and network)', async () => {
  const w = loadSw({ site: SITE() });
  await w.fire('install');
  const files = w.kept(CACHE_V1);
  eq(Object.keys(files).sort(), [`${B}config.json`, `${B}icon.svg`, `${B}index.html`, `${B}lib/lazy.mjs`, `${B}lib/model.mjs`, `${B}lib/q.mjs`, `${B}lib/re.mjs`, `${B}lib/seal.mjs`, `${B}lib/side.mjs`, `${B}manifest.webmanifest`, `${B}panel.css`, `${B}panel.js`, `${B}ui/dom.mjs`].sort());
  ok(w.log.fetched.every((f) => f.cache === 'reload'), 'past the browser\'s own cache: a new deploy must not be kept as the old one');
  ok(!w.log.fetched.some((f) => /evil|outside/.test(f.url)), `nothing outside the folder is fetched: ${w.log.fetched.map((f) => f.url).join(' ')}`);
  ok(w.log.fetched.some((f) => f.url === `${B}lib/ghost.mjs`), 'a name seen in a comment is tried — and is no trouble when it is not there');
  eq(new Set(w.log.fetched.map((f) => f.url)).size, w.log.fetched.length, 'each file once');
  eq(files[`${B}lib/seal.mjs`], 'export const y = 2;');
  eq(w.log.skipped, 1);
  eq([...w.store.keys()], [CACHE_V1], 'the cache is named for the folder and the version');
  // a worker without a version in its address: its own name
  const bare = loadSw({ href: `${B}sw.js`, site: SITE() });
  await bare.fire('install');
  eq([...bare.store.keys()], ['bdslab-panel:/bds-lab/:unversioned']);
  // a version that is not a plain token is no version
  eq([...(await (async () => { const x = loadSw({ href: `${B}sw.js?v=a%20b/..`, site: SITE() }); await x.fire('install'); return x.store.keys(); })())], ['bdslab-panel:/bds-lab/:unversioned']);
});

await t('sw.js install: all or nothing — a file the page cannot do without missing, and nothing is written (the old worker stays); a module or config.json missing is no trouble', async () => {
  for (const must of ['index.html', 'panel.css', 'panel.js']) {
    const site = SITE(); delete site[B + must];
    const w = loadSw({ site, kept: { [CACHE_V1]: { [`${B}panel.js`]: 'the old one' } } });
    await throws(() => w.fire('install'), new RegExp(must.replace('.', '\\.')), `${must} missing`);
    eq(w.kept(CACHE_V1), { [`${B}panel.js`]: 'the old one' }, 'the cache that was there is as it was');
    eq(w.log.skipped, 0, 'and the worker does not take over');
  }
  const down = loadSw({ site: SITE() }); down.net.offline = true;
  await throws(() => down.fire('install'), /取れません/, 'offline at install');
  eq([down.store.size, down.log.skipped], [0, 0]);
  const partial = SITE(); delete partial[`${B}config.json`]; delete partial[`${B}lib/lazy.mjs`]; partial[`${B}lib/seal.mjs`] = { body: 'down', status: 503 };
  const p = loadSw({ site: partial });
  await p.fire('install');
  ok(p.kept(CACHE_V1)[`${B}panel.js`] && !(`${B}lib/lazy.mjs` in p.kept(CACHE_V1)) && !(`${B}lib/seal.mjs` in p.kept(CACHE_V1)), 'the rest is kept');
  eq(p.log.skipped, 1);
  // a page that imports in a loop, and one that imports without end, are read once each and stop
  const loop = SITE(); loop[`${B}lib/seal.mjs`] = "import './model.mjs';"; loop[`${B}ui/dom.mjs`] = Array.from({ length: 400 }, (_, i) => `import './gen${i}.mjs';`).join('\n');
  for (let i = 0; i < 400; i++) loop[`${B}ui/gen${i}.mjs`] = `import './gen${i + 1}.mjs';`;
  const l = loadSw({ site: loop });
  await l.fire('install');
  ok(l.log.fetched.length <= 300 && new Set(l.log.fetched.map((f) => f.url)).size === l.log.fetched.length, `bounded: ${l.log.fetched.length} fetches`);
});

await t('sw.js activate: the caches of other versions of this panel go, other panels\' and other things\' stay; the open pages are taken over (node:vm)', async () => {
  const w = loadSw({ kept: { [CACHE_V1]: { a: '1' }, 'bdslab-panel:/bds-lab/:v0': { a: '0' }, 'bdslab-panel:/bds-lab/:unversioned': { a: 'u' }, 'bdslab-panel:/other-lab/:v1': { a: 'o' }, 'bdslab-panel:/:v1': { a: 'root' }, 'workbox-precache': { a: 'w' } } });
  await w.fire('activate');
  eq([...w.store.keys()].sort(), ['bdslab-panel:/:v1', 'bdslab-panel:/bds-lab/:v1', 'bdslab-panel:/other-lab/:v1', 'workbox-precache']);
  eq(w.log.claimed, 1);
});

await t('sw.js fetch: the page and config.json network first (the kept copy when the network is down or the server fails); a page is kept as index.html whatever its address, a one-time code in it never (node:vm)', async () => {
  const site = SITE(); site[B] = '<!doctype html>ROOT-1'; site[`${B}?code=ONE-TIME-CODE`] = '<!doctype html>ROOT-CODE';
  const w = loadSw({ site });
  await w.fire('install'); await w.fire('activate');
  const text = async (p) => { const r = await p; return r === null ? null : [r.status, await r.text()]; };
  eq(await text(w.request(B, { mode: 'navigate' })), [200, '<!doctype html>ROOT-1'], 'online: the network\'s page');
  eq(w.log.fetched.at(-1).cache, undefined, 'a navigation is fetched as it is (it takes no options)');
  eq(w.kept(CACHE_V1)[`${B}index.html`], '<!doctype html>ROOT-1', 'and it is kept as index.html');
  eq(await text(w.request(`${B}?code=ONE-TIME-CODE`, { mode: 'navigate' })), [200, '<!doctype html>ROOT-CODE']);
  ok(!Object.keys(w.kept(CACHE_V1)).some((u) => /code|ONE-TIME/.test(u)) && !JSON.stringify([...w.store.keys()]).includes('ONE-TIME'), 'no address with a code is kept');
  w.net.offline = true;
  eq(await text(w.request(B, { mode: 'navigate' })), [200, '<!doctype html>ROOT-CODE'], 'offline: the page as last seen');
  eq(await text(w.request(`${B}index.html?x=1`, { mode: 'navigate' })), [200, '<!doctype html>ROOT-CODE'], 'whatever its address');
  w.net.offline = false;
  w.site[`${B}config.json`] = '{"version":"v2"}';
  eq(await text(w.request(`${B}config.json`, { cache: 'no-store' })), [200, '{"version":"v2"}'], 'config.json: the network\'s, not the kept one');
  eq(w.log.fetched.at(-1).cache, undefined, 'and as the page asked for it (no-store)');
  eq(w.kept(CACHE_V1)[`${B}config.json`], '{"version":"v2"}', 'kept for when there is none');
  w.net.offline = true;
  eq(await text(w.request(`${B}config.json`)), [200, '{"version":"v2"}'], 'offline: config.json as last seen');
  w.net.offline = false;
  // the server failing: the kept page, not the failure — a missing page is a missing page
  w.site[B] = { body: 'bad gateway', status: 502 };
  eq(await text(w.request(B, { mode: 'navigate' })), [200, '<!doctype html>ROOT-CODE'], 'a failing server: the kept page');
  w.site[B] = { body: 'nope', status: 404 };
  eq(await text(w.request(B, { mode: 'navigate' })), [404, 'nope'], 'a 404 is the page\'s answer');
  eq(w.kept(CACHE_V1)[`${B}index.html`], '<!doctype html>ROOT-CODE', 'and is not kept');
  // nothing kept and no network: the browser's own offline page
  const fresh = loadSw({ site: SITE() }); fresh.net.offline = true;
  await throws(() => fresh.request(B, { mode: 'navigate' }), /Failed to fetch/, 'nothing kept, no network');
  await throws(() => fresh.request(`${B}config.json`), /Failed to fetch/, 'config.json: nothing kept, no network');
  // a server failing with nothing kept: its answer
  const bad = loadSw({ site: { [B]: { body: 'down', status: 503 } } });
  eq(await text(bad.request(B, { mode: 'navigate' })), [503, 'down']);
});

await t('sw.js fetch: the panel\'s other files cache first (kept at install, kept when first asked for, a failure never kept); without a version in the worker\'s address the network first (node:vm)', async () => {
  const w = loadSw({ site: SITE() });
  await w.fire('install');
  const text = async (p) => { const r = await p; return r === null ? null : [r.status, await r.text()]; };
  const n0 = w.log.fetched.length;
  eq(await text(w.request(`${B}panel.js`)), [200, SITE()[`${B}panel.js`]]);
  eq(await text(w.request(`${B}lib/model.mjs`)), [200, "import { y } from './seal.mjs';\nexport const M = 1;"]);
  eq(w.log.fetched.length, n0, 'from the kept copies: the network is not asked');
  w.site[`${B}panel.js`] = 'a newer deploy';
  eq((await text(w.request(`${B}panel.js`)))[1], SITE()[`${B}panel.js`], 'a new deploy does not change what this version serves: a new version is a new worker');
  eq(await text(w.request(`${B}lib/new.mjs`)), [200, 'export const fresh = 1;'], 'not kept yet: the network\'s');
  eq(w.log.fetched.at(-1), { url: `${B}lib/new.mjs`, cache: 'reload' }, 'asked past the browser\'s own cache: an older deploy\'s copy is not kept under this version');
  eq(w.kept(CACHE_V1)[`${B}lib/new.mjs`], 'export const fresh = 1;', 'and kept now');
  const n1 = w.log.fetched.length;
  eq((await text(w.request(`${B}lib/new.mjs`)))[1], 'export const fresh = 1;');
  eq(w.log.fetched.length, n1, 'asked once');
  eq(await text(w.request(`${B}lib/missing.mjs`)), [404, 'not found']);
  ok(!(`${B}lib/missing.mjs` in w.kept(CACHE_V1)), 'a 404 is not kept');
  w.net.offline = true;
  eq((await text(w.request(`${B}lib/new.mjs`)))[0], 200, 'offline: kept ones still come');
  await throws(() => w.request(`${B}lib/never.mjs`), /Failed to fetch/, 'offline and never kept');
  // no version in the address: the files could be of any deploy — the network first, the kept copy when it is down
  const bare = loadSw({ href: `${B}sw.js`, site: SITE() });
  await bare.fire('install');
  bare.site[`${B}panel.js`] = 'a newer deploy';
  eq(await text(bare.request(`${B}panel.js`)), [200, 'a newer deploy'], 'the newest while the network is there');
  eq(bare.log.fetched.at(-1), { url: `${B}panel.js`, cache: 'no-cache' }, 'and asked of the server, not of the browser\'s own cache');
  eq(bare.kept('bdslab-panel:/bds-lab/:unversioned')[`${B}panel.js`], 'a newer deploy', 'and that is what is kept');
  bare.net.offline = true;
  eq(await text(bare.request(`${B}panel.js`)), [200, 'a newer deploy'], 'offline: as last seen');
  eq((await text(bare.request(`${B}lib/model.mjs`)))[0], 200, 'offline: kept at install');
});

await t('sw.js fetch: GitHub\'s API, every other origin, other methods, other folders and the worker\'s own file are left to the browser; nothing is answered (node:vm)', async () => {
  const w = loadSw({ site: SITE() });
  await w.fire('install');
  const n0 = w.log.fetched.length;
  for (const [u, o] of [['https://api.github.com/user', {}], ['https://api.github.com/repos/o/lab/actions/secrets/X', { method: 'PUT' }], ['https://avatars.githubusercontent.com/u/1', {}], ['https://bds-lab-auth.o.workers.dev/refresh', {}],
    ['https://github.com/o/lab', { mode: 'navigate' }], [`${B}panel.js`, { method: 'POST' }], [`${B}panel.js`, { method: 'HEAD' }], ['https://o.github.io/other-lab/panel.js', {}], ['https://o.github.io/', { mode: 'navigate' }],
    [`${B}sw.js`, {}], [`${B}panel.js`, { cache: 'only-if-cached', mode: 'cors' }]]) {
    eq(await w.request(u, o), null, `${o.method ?? 'GET'} ${u}`);
  }
  eq(w.log.fetched.length, n0, 'and the network was not asked for any of them');
  ok((await w.request(`${B}panel.js`, { cache: 'only-if-cached', mode: 'same-origin' })) !== null, 'only-if-cached is the worker\'s for a same-origin request');
});

await t('sw.js notificationclick: the panel\'s address in the notification\'s data is opened, or an open panel is brought to the front and taken there; an address outside the folder is never opened (node:vm)', async () => {
  const click = async (w, data) => { let closed = 0; await w.fire('notificationclick', { notification: { data, close: () => { closed++; } } }); return closed; };
  const hash = `${B}#runs?repo=o%2Flab&run=7`;
  // no panel open: a new window at the address
  for (const data of [{ url: hash }, hash, { url: '#runs?repo=o%2Flab&run=7' }]) {
    const w = loadSw();
    eq(await click(w, data), 1, 'the notification is closed');
    eq(w.log.opened, [hash], JSON.stringify(data));
  }
  // an address that is not the panel's, or none: the panel's front page
  for (const data of [{ url: 'https://evil.example/phish' }, 'https://evil.example/', { url: `${ORIGIN}/other-lab/` }, { url: 'javascript:alert(1)' }, { url: `${B}../other-lab/` }, { url: 5 }, {}, null, undefined, '', { url: '' }, 42]) {
    const w = loadSw();
    await click(w, data);
    eq(w.log.opened, [B], `${JSON.stringify(data)} -> the front page`);
  }
  eq(loadSw().target({ url: `${B}lib/x` }), `${B}lib/x`);
  eq(loadSw().target('x/y'), `${B}x/y`);
  // the panel already open: brought to the front and taken to the address; not opened again
  const calls = [], win = (url, o = {}) => ({ url, focus: async () => { calls.push(['focus', url]); }, navigate: async (u) => { calls.push(['navigate', u]); if (o.noNavigate) throw new Error('not allowed'); return {}; } });
  const w = loadSw({ windows: [{ url: 'https://elsewhere.example/', focus: async () => { calls.push(['wrong']); } }, win(`${B}#overview`)] });
  await click(w, { url: hash });
  eq(calls, [['focus', `${B}#overview`], ['navigate', hash]]);
  eq(w.log.opened, [], 'no second window');
  calls.length = 0;
  await click(loadSw({ windows: [win(hash)] }), { url: hash });
  eq(calls, [['focus', hash]], 'already there: only to the front');
  calls.length = 0;
  const w2 = loadSw({ windows: [win(`${B}#x`, { noNavigate: true })] });
  await click(w2, { url: hash });
  eq(calls.map((c) => c[0]), ['focus', 'navigate'], 'a window that will not be moved is still brought to the front');
  eq(w2.log.opened, []);
  // a window that will not even come forward
  const stubborn = loadSw({ windows: [{ url: `${B}#x`, focus: async () => { throw new Error('no'); }, navigate: async (u) => { calls.push(['nav', u]); } }] });
  calls.length = 0;
  await click(stubborn, { url: hash });
  eq(calls, [['nav', hash]]);
});

await t('sw.js: a classic script — no import, no export; touches nothing but the worker\'s own scope; the page\'s CSP lets it be registered (its script-src \'self\', no worker-src)', () => {
  ok(!/^\s*(import|export)\b/m.test(SW_SRC), 'a classic script takes no module syntax');
  ok(!/\binnerHTML\b|\bimportScripts\b|\beval\(|\bsetTimeout\b|\bXMLHttpRequest\b|\bpostMessage\b/.test(SW_SRC.replace(/\/\/.*$/gm, '')), 'nothing it does not need');
  ok(!/api\.github\.com/.test(SW_SRC.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/u\.hostname === 'api\.github\.com'/, '')), 'GitHub\'s API is named once, to be left alone');
  const html = fs.readFileSync(path.join(TOP, 'panel', 'index.html'), 'utf8'), csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  ok(/script-src 'self'/.test(csp) && !/worker-src|child-src/.test(csp), 'a worker\'s script is allowed by script-src when worker-src and child-src are not there');
  ok(/connect-src 'self' https:\/\/api\.github\.com/.test(csp), 'the page\'s own connections are unchanged');
});

// ---- the three screens on a small fake DOM ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); this.parent = null; } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, hidden: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'hidden') this.hidden = true; if (k === 'disabled') this.disabled = true; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    adopt(xs) { return xs.map((x) => { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; return n; }); }
    append(...xs) { this.kids.push(...this.adopt(xs)); }
    prepend(...xs) { this.kids.unshift(...this.adopt(xs)); }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get isConnected() { let p = this; while (p.parent) p = p.parent; return p === globalThis.document.body; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    set textContent(v) { this.replaceChildren(String(v)); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    click() { return this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
    byText(re, tag = 'BUTTON') { return this.all((e) => e.tagName === tag && re.test(e.textContent))[0]; }
  }
  const body = new E('body'), main = new E('main'), toast = new E('div');
  main.setAttribute('id', 'main'); toast.setAttribute('id', 'toast'); body.append(main, toast);
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (body.all((e) => e.attrs.id === id)[0] ?? null), body };
  return { E, body, main, toast };
}

await t('the 🔔 and the list: the number not read follows the store by itself; the list narrowed to all / not read / failures; 「すべて読んだ」; a tap on one goes to its tab and reads it; it stands at the top of the page and goes again (fake DOM)', async () => {
  const { main, body, E } = fakeDom();
  const UI = await imp('panel/ui/inbox.mjs');
  const box = IB.store(fakeStorage(), 'ui'), went = [];
  const ctx = { inbox: box, go: (tab, item) => { went.push([tab, item?.id]); } };
  const bell = UI.bellButton(ctx);
  body.append(bell);
  eq([bell.textContent, bell.className, bell.getAttribute('aria-label')], ['🔔', '', 'お知らせ']);
  box.add([ev('f1', '2026-10-08T00:03:00Z', { kind: 'failure', level: 'bad', title: '❌ verify が失敗しました', body: 'main · me', url: 'https://github.com/o/lab/actions/runs/1' }),
    ev('r1', '2026-10-08T00:02:00Z', { kind: 'run', level: 'ok', title: '✅ app が通りました' }), ev('j1', '2026-10-08T00:01:00Z', { kind: 'join', level: 'warn', title: '🙋 newbie さんから参加のお願い', tab: 'members' })]);
  eq([bell.textContent, bell.className, bell.getAttribute('aria-label')], ['🔔 3', 'on', 'お知らせ（未読 3 件）'], 'told by the store, with no one asking');
  box.add(Array.from({ length: 120 }, (_, i) => ev(`m${i}`, '2026-10-07T00:00:00Z')));
  eq(bell.textContent, '🔔 99+');
  box.clear(); box.add([ev('f1', '2026-10-08T00:03:00Z', { kind: 'failure', level: 'bad', title: '❌ verify が失敗しました', body: 'main · me', url: 'https://github.com/o/lab/actions/runs/1' }),
    ev('r1', '2026-10-08T00:02:00Z', { kind: 'run', level: 'ok', title: '✅ app が通りました' }), ev('j1', '2026-10-08T00:01:00Z', { kind: 'join', level: 'warn', title: '🙋 newbie さんから参加のお願い', tab: 'members' })]);
  // a tap on the bell: the list at the top of the page (before what the page already shows)
  main.append(new E('section'));
  await bell.click();
  const card = main.kids[0];
  eq(card.attrs.id, 'inbox', 'first in the page');
  const cards = () => main.kids.filter((k) => k.attrs.id === 'inbox').length;
  const rowsOf = (c) => c.all((e) => e.tagName === 'LI').map((l) => l.attrs['data-inbox'] ?? '(empty)'), rows = () => rowsOf(card);
  eq(rows(), ['f1', 'r1', 'j1'], 'newest first');
  ok(/verify が失敗しました/.test(card.textContent) && /main · me/.test(card.textContent) && /失敗/.test(card.textContent) && /新着/.test(card.textContent), card.textContent);
  eq(card.all((e) => e.tagName === 'A').map((a) => a.attrs.href), ['https://github.com/o/lab/actions/runs/1'], 'GitHub\'s page for it, as a link');
  ok(!/null|undefined|false/.test(card.textContent), `a missing part is left out, not written as a word: ${card.textContent}`);
  const filter = async (k) => { await card.all((e) => e.attrs['data-filter'] === k)[0].click(); return rows(); };
  eq(await filter('failed'), ['f1']);
  eq(await filter('unread'), ['f1', 'r1', 'j1']);
  ok(/未読（3）/.test(card.textContent), 'the count on the filter');
  box.markRead('r1');
  eq(rows(), ['f1', 'j1'], 'follows the store while it is open');
  eq(await filter('all'), ['f1', 'r1', 'j1']);
  // a tap on one: read, the list put away, its tab
  const f1 = card.all((e) => e.attrs['data-inbox'] === 'f1')[0];
  await f1.byText(/開く/).click();
  eq(went, [['runs', 'f1']]);
  eq([box.list().find((x) => x.id === 'f1').read, bell.textContent], [true, '🔔 1'], 'read, and the bell follows');
  eq(cards(), 0, 'the list is put away when one is opened');
  // again: shown, and a tap on the bell takes it away
  await bell.click();
  eq(main.kids[0].attrs.id, 'inbox');
  const card2 = main.kids[0];
  await card2.byText(/すべて読んだ/).click();
  eq([box.unread(), bell.textContent, bell.className], [0, '🔔', ''], 'all read');
  ok(card2.byText(/すべて読んだ/).disabled, 'nothing left to read: the button rests');
  await bell.click();
  eq(cards(), 0, 'a second tap on the bell takes it away');
  // empty states and clearing
  await bell.click();
  const card3 = main.kids[0];
  await card3.all((e) => e.attrs['data-filter'] === 'unread')[0].click();
  ok(/読んでいないお知らせはありません/.test(card3.textContent), card3.textContent);
  await card3.all((e) => e.attrs['data-filter'] === 'failed')[0].click();
  eq(rowsOf(card3), ['f1'], 'the failure is still there');
  globalThis.confirm = () => false;
  await card3.byText(/消す/).click();
  eq(box.list().length, 3, 'asked first; declined');
  globalThis.confirm = () => true;
  await card3.byText(/消す/).click();
  eq(box.list().length, 0);
  ok(/失敗のお知らせはありません/.test(card3.textContent), card3.textContent);
  // a list made on its own (no way to put itself away): no button for it, and no stray word where it would be
  box.add(ev('lone', '2026-10-08T00:00:00Z', { tab: '', url: '' }));
  const lone = UI.inboxPanel({ inbox: box, go: () => {} });
  ok(!/null|undefined|false/.test(lone.textContent) && !lone.byText(/閉じる/), lone.textContent);
  eq(lone.all((e) => e.attrs['data-inbox'] === 'lone')[0]?.all((e) => e.tagName === 'BUTTON').length, 0, 'news with no tab and no address has nothing to open');
  // a bell or a list the page has drawn over stops listening
  const old = UI.bellButton(ctx), was = old.textContent;
  eq(old.isConnected, false);
  box.add(ev('zz', '2026-10-08T00:00:00Z'));
  eq([old.textContent, box.unread() > Number(was.replace(/\D/g, '') || 0)], [was, true], 'a bell that is not on the page is not redrawn');
  // a page with its own way of showing the list
  let opened = 0;
  const shown = main.kids.length, own = UI.bellButton({ ...ctx, open: () => { opened++; } });
  await own.click();
  eq([opened, main.kids.length], [1, shown], 'its own way is used, the default one is not');
  delete globalThis.confirm;
});

await t('the 「まとめて登録」 card: names only as it is typed (errors and warnings in words), each registered through guarded secrets.put in turn with the progress, the box emptied when all are in (fake DOM)', async () => {
  const { toast } = fakeDom();
  const UI = await imp('panel/ui/bulk.mjs');
  const VALUES = ['value-one-ABC', 'value two with spaces', 'multi-line-secret-Q\nsecond-line-secret-R'];
  const sent = [], told = [], reloaded = [];
  const ctx = { names: ['MS_EMAIL'], reload: () => { reloaded.push(1); }, toast: (text, bad) => { told.push([text, Boolean(bad)]); },
    guarded: async (action, detail, fn, done) => { told.push(['guarded', action, JSON.stringify(detail), done]); try { return await fn(); } catch { return undefined; } },
    putSecret: async (name, value) => { sent.push([name, value]); return null; } };
  const card = UI.bulkCard(ctx);
  const area = card.all((e) => e.tagName === 'TEXTAREA')[0], go = card.all((e) => e.attrs.id === 'bulkgo')[0], status = card.all((e) => e.attrs.id === 'bulkstatus')[0];
  const type = async (text) => { area.value = text; await area.fire('input'); };
  eq([go.disabled, go.textContent], [true, 'まとめて登録']);
  ok(/まだ何も貼られていません/.test(card.textContent), 'nothing pasted yet');
  const noWord = (m) => ok(!/null|undefined|false/.test(card.textContent), `a missing part is left out, not written as a word (${m}): ${card.textContent.slice(0, 400)}`);
  noWord('empty');
  eq([area.attrs.spellcheck, area.attrs.autocomplete, area.style.webkitTextSecurity], ['false', 'off', 'disc'], 'kept from spell checkers and autofill, shown as dots');
  // typed: the names, never a value
  await type(`MS_EMAIL=${VALUES[0]}\nMS_PASSWORD="${VALUES[1]}"\nKEY='${VALUES[2]}'\n# note\nMS_EMAIL2=x`);
  eq(card.all((e) => e.attrs['data-name']).map((e) => e.attrs['data-name']), ['MS_EMAIL', 'MS_PASSWORD', 'KEY', 'MS_EMAIL2']);
  ok(/登録する名前（4 個・うち 1 個は入れ替え）/.test(card.textContent) && /🔁 MS_EMAIL/.test(card.textContent) && /🆕 MS_PASSWORD/.test(card.textContent), card.textContent);
  for (const v of VALUES) for (const part of v.split('\n')) ok(!card.textContent.includes(part), `a value is on the page: ${part}`);
  eq([go.disabled, go.textContent], [false, '4 個をまとめて登録']);
  noWord('names');
  // errors: nothing can be registered, and they say so without the value
  await type(`GOOD=${VALUES[0]}\nlower=${VALUES[1]}\nDUP=1\nDUP=2`);
  eq(card.all((e) => e.attrs.id === 'bulkerrors').length + card.all((e) => e.attrs.id === 'bulkwarnings').length, 2);
  ok(/❌ 2 行目: 名前は英大文字/.test(card.textContent) && /⚠️ DUP が 3 行目と 4 行目/.test(card.textContent), card.textContent);
  ok(!card.textContent.includes(VALUES[1]) && !card.textContent.includes(VALUES[0]), 'no value in the messages');
  eq(go.disabled, true, 'errors: the button rests');
  noWord('errors');
  // all registered, in order, each through guarded
  await type(`MS_EMAIL=${VALUES[0]}\nMS_PASSWORD="${VALUES[1]}"\nKEY='${VALUES[2]}'`);
  const asked = [];
  globalThis.confirm = (m) => { asked.push(m); return true; };
  await go.click();
  eq(sent, [['MS_EMAIL', VALUES[0]], ['MS_PASSWORD', VALUES[1]], ['KEY', VALUES[2]]]);
  eq(told.filter((x) => x[0] === 'guarded').map((x) => x.slice(1, 3)), [['secrets.put', '{"name":"MS_EMAIL"}'], ['secrets.put', '{"name":"MS_PASSWORD"}'], ['secrets.put', '{"name":"KEY"}']]);
  eq(asked.length, 1, 'replacing a secret that is there is asked once');
  ok(/MS_EMAIL/.test(asked[0]) && !asked[0].includes(VALUES[0]), asked[0]);
  eq(area.value, '', 'the box is emptied when all are in');
  noWord('done');
  ok(/✅ 3 個の秘密を登録しました/.test(status.textContent), status.textContent);
  eq(told.at(-1), ['3 個の秘密を登録しました', false]);
  eq(reloaded.length, 1);
  ok(!/value-one|value two|secret-Q|secret-R/.test(JSON.stringify(told)), 'no value was ever said');
  ok(!/value-one|value two|secret-Q|secret-R/.test(card.textContent), 'nor shown');
  eq([go.disabled, go.textContent, area.disabled], [true, 'まとめて登録', false]);
  ok(toast.kids.length === 0, 'it used the toast it was given');
  delete globalThis.confirm;
});

await t('the 「まとめて登録」 card: one that stops it stops the run (the box kept), pressing again goes on with the rest only; declining the replace asks nothing of GitHub; a role the policy does not allow keeps the button resting; GitHub\'s empty answer is a success (fake DOM)', async () => {
  fakeDom();
  const UI = await imp('panel/ui/bulk.mjs');
  const sent = [], told = [], fails = new Set(['B']), reloaded = [];
  const ctx = { reload: () => { reloaded.push(1); }, toast: (text, bad) => { told.push([text, Boolean(bad)]); },
    guarded: async (_a, _d, fn) => { try { return await fn(); } catch { return undefined; } },
    putSecret: async (name, value) => { if (fails.has(name)) throw new Error('GitHub: 403'); sent.push([name, value]); return null; } };
  const card = UI.bulkCard(ctx);
  const area = card.all((e) => e.tagName === 'TEXTAREA')[0], go = card.all((e) => e.attrs.id === 'bulkgo')[0], status = card.all((e) => e.attrs.id === 'bulkstatus')[0], bar = card.all((e) => e.className === 'bar')[0];
  const type = async (text) => { area.value = text; await area.fire('input'); };
  await type('A=1\nB=2\nC=3\nD=4');
  await go.click();
  eq(sent, [['A', '1']], 'A in, B refused: the run stops there');
  eq(area.value, 'A=1\nB=2\nC=3\nD=4', 'the box is kept');
  ok(/B で止まりました（登録した 1 個・のこり 3 個）/.test(status.textContent), status.textContent);
  eq(told.at(-1), ['B で止まりました', true]);
  eq([bar.kids[0].style.width, bar.hidden, go.disabled, area.disabled], ['25%', false, false, false]);
  eq(reloaded.length, 1, 'the one that went in is told to the tab');
  fails.clear();
  await go.click();
  eq(sent, [['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']], 'again: A is not sent twice');
  eq(area.value, '');
  ok(/✅ 4 個の秘密を登録しました（今回送ったのは 3 個・のこりは前に登録済み）/.test(status.textContent), status.textContent);
  // what was registered is remembered by name and value: the same text is not sent twice, a changed value is sent again
  const sent0 = sent.length;
  fails.add('B');
  await type('A=1\nB=2');
  await go.click();
  eq(sent.slice(sent0), [['A', '1']], 'A in, B refused');
  await type('A=9\nB=2');
  await go.click();
  eq(sent.slice(sent0), [['A', '1'], ['A', '9']], 'A has a new value: sent again; B refused again');
  fails.clear();
  await go.click();
  eq(sent.slice(sent0), [['A', '1'], ['A', '9'], ['B', '2']], 'B now; A=9 is in already');
  eq(area.value, '');
  // all in: the memory of what went in is gone with the box — the same text pasted again is sent again
  fails.clear();
  const sent1 = sent.length;
  await type('A=1\nB=2'); await go.click();
  await type('A=1\nB=2'); await go.click();
  eq(sent.slice(sent1), [['A', '1'], ['B', '2'], ['A', '1'], ['B', '2']], 'a second paste of the same text is not skipped');
  // typing again forgets what the last press said
  await type('A=1');
  eq([status.textContent, bar.hidden], ['', true]);
  // the replace declined
  const again = UI.bulkCard({ ...ctx, names: ['A'] });
  const a2 = again.all((e) => e.tagName === 'TEXTAREA')[0];
  a2.value = 'A=1\nZ=2'; await a2.fire('input');
  globalThis.confirm = () => false;
  const n = sent.length;
  await again.all((e) => e.attrs.id === 'bulkgo')[0].click();
  eq(sent.length, n, 'declined: nothing sent');
  eq(a2.value, 'A=1\nZ=2', 'and the box is as it was');
  delete globalThis.confirm;
  // not allowed by the policy: the button stays resting, whatever is typed
  const shut = UI.bulkCard({ ...ctx, gate: () => ({ disabled: true, title: '許されていません' }) });
  const s2 = shut.all((e) => e.tagName === 'TEXTAREA')[0], g2 = shut.all((e) => e.attrs.id === 'bulkgo')[0];
  s2.value = 'A=1'; await s2.fire('input');
  eq([g2.disabled, g2.attrs.title], [true, '許されていません']);
  // the replace is asked about what is still to be sent: not again for what an earlier press already put in
  const asked2 = [], twice = UI.bulkCard({ ...ctx, names: ['A'] }), t2 = twice.all((e) => e.tagName === 'TEXTAREA')[0], tgo = twice.all((e) => e.attrs.id === 'bulkgo')[0];
  globalThis.confirm = (m) => { asked2.push(m); return true; };
  fails.clear(); fails.add('B');
  t2.value = 'A=1\nB=2'; await t2.fire('input'); await tgo.click();
  fails.clear();
  await tgo.click();
  eq(asked2.length, 1, 'asked once, about A; the second press has only B to send');
  ok(/A/.test(asked2[0]) && !/B/.test(asked2[0].replace('よろしいですか', '')), asked2[0]);
  delete globalThis.confirm;
  // 「欄を空にする」 forgets what went in as well: the same text pasted again is sent again
  const forget = UI.bulkCard(ctx), f2 = forget.all((e) => e.tagName === 'TEXTAREA')[0], fgo = forget.all((e) => e.attrs.id === 'bulkgo')[0], n1 = sent.length;
  fails.clear(); fails.add('B');
  f2.value = 'A=1\nB=2'; await f2.fire('input'); await fgo.click();
  await forget.byText(/欄を空にする/).click();
  f2.value = 'A=1\nB=2'; await f2.fire('input'); await fgo.click();
  eq(sent.slice(n1), [['A', '1'], ['A', '1']], 'A is sent again after the box was emptied by hand');
  fails.clear();
  // 「欄を空にする」, and the box shown readable on asking
  const clearCard = UI.bulkCard(ctx), c2 = clearCard.all((e) => e.tagName === 'TEXTAREA')[0];
  c2.value = 'A=1'; await c2.fire('input');
  await clearCard.byText(/欄を空にする/).click();
  eq(c2.value, '');
  ok(/まだ何も貼られていません/.test(clearCard.textContent));
  const box = clearCard.all((e) => e.tagName === 'INPUT')[0];
  box.checked = true; await box.fire('change');
  eq(c2.style.webkitTextSecurity, 'none');
  box.checked = false; await box.fire('change');
  eq(c2.style.webkitTextSecurity, 'disc');
});

await t('the screens write text as text and nothing else: no innerHTML, outerHTML or insertAdjacentHTML, no inline style attribute, no new colours — only the page\'s own classes and variables (the page\'s CSP allows nothing more)', () => {
  for (const f of ['panel/ui/inbox.mjs', 'panel/ui/bulk.mjs', 'panel/lib/inbox.mjs', 'panel/lib/bulk.mjs', 'panel/sw.js']) {
    const code = fs.readFileSync(path.join(TOP, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\(\s*['"]style['"]|#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(code), `${f}`);
    ok(!/localStorage|sessionStorage|fetch\(.*(token|Authorization)/i.test(code.replace(/the browser's own/g, '')), `${f}: no storage of its own, no token in a request`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
