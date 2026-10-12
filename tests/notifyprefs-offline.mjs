// notifyprefs (who hears what: 落ちた・通った・リリース・週報・連携の不調・秘密の古さ) without a browser or a network: the file read
// strictly (bad JSON and bad shapes refused in words), wants / mentions / setPref, and the card on a small fake DOM (own row
// only for a member, all rows for an administrator, written with the sha through guarded(variables), a change made elsewhere
// read again) against a fake GitHub that follows ghrules.
// node tests/notifyprefs-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const N = await imp('panel/lib/notifyprefs.mjs'), { fakeCheck } = await imp('panel/lib/ghrules.mjs'), P = await imp('panel/lib/policy.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const refuses = (x, re, m) => { let e = null; try { N.parsePrefs(x); } catch (z) { e = z; } ok(e && re.test(e.message), `${m}: ${e?.message ?? 'accepted'}`); };
const ID = '123456789012345678', ID2 = '223456789012345678';

await t('parsePrefs: empty = default; a good file kept in order; bad JSON and bad shapes refused in words (pure)', () => {
  eq(N.parsePrefs(''), N.defaultPrefs());
  eq(N.parsePrefs(JSON.stringify({ version: 1, members: { alice: { kinds: ['release', 'failed'], discord: ID } } })), { version: 1, members: { alice: { kinds: ['failed', 'release'], discord: ID } } });
  refuses('{oops', /JSON として読めません/, 'bad json');
  refuses('[]', /形で書いて/, 'array');
  refuses('{"x":1}', /知らない項目/, 'unknown key');
  refuses('{"version":2}', /version は 1/, 'version');
  refuses('{"members":{"a b":{"kinds":[]}}}', /ユーザー名/, 'login');
  refuses('{"members":{"a":{"kinds":["nope"]}}}', /知らない種類/, 'kind');
  refuses('{"members":{"a":{"kinds":"failed"}}}', /kinds は/, 'kinds not list');
  refuses('{"members":{"a":{"kinds":[],"discord":"abc"}}}', /discord は/, 'discord id');
  refuses('{"members":{"a":{"kinds":[],"token":"x"}}}', /知らない項目/, 'extra key');
});

await t('wants / kindsOf: the defaults for a member who never chose; the choice otherwise (case-blind)', () => {
  const p = N.parsePrefs({ members: { Alice: { kinds: ['weekly'] } } });
  ok(N.wants(p, 'bob', 'failed') && !N.wants(p, 'bob', 'passed'), 'defaults');
  ok(N.wants(p, 'alice', 'weekly') && !N.wants(p, 'alice', 'failed'), 'own choice');
  ok(!N.wants(p, 'alice', 'nonsense'), 'unknown kind');
});

await t('setPref: a new object, kinds in order, discord kept or removed; the old prefs untouched', () => {
  const p0 = N.defaultPrefs(), p1 = N.setPref(p0, 'bob', 'passed', true, ID);
  eq(p0, N.defaultPrefs()); eq(p1.members.bob, { kinds: ['failed', 'passed', 'release', 'connect'], discord: ID });
  const p2 = N.setPref(p1, 'BOB', 'failed', false); eq(Object.keys(p2.members), ['bob']); eq(p2.members.bob.kinds, ['passed', 'release', 'connect']);
  eq(N.setPref(p2, 'bob', null, true, null).members.bob.discord, undefined);
  let e = null; try { N.setPref(p0, 'bob', 'x', true); } catch (z) { e = z; } ok(e, 'unknown kind refused');
  e = null; try { N.setPref(p0, 'bob', 'failed', true, 'zz'); } catch (z) { e = z; } ok(e, 'bad discord refused');
  eq(N.parsePrefs(N.prefsText(p1)), p1, 'the text reads back');
});

await t('mentions: who wants the kind and gave an id, as <@id>, each once', () => {
  const p = N.parsePrefs({ members: { a: { kinds: ['failed'], discord: ID }, b: { kinds: ['failed'] }, c: { kinds: ['weekly'], discord: ID2 }, d: { kinds: ['failed'], discord: ID } } });
  eq(N.mentions(p, 'failed'), [`<@${ID}>`]); eq(N.mentions(p, 'weekly'), [`<@${ID2}>`]); eq(N.mentions(p, 'passed'), []); eq(N.mentions(p, 'x'), []); eq(N.mentions(null, 'failed'), []);
});

// ---- the card on a small DOM ----
function fakeDom() {
  class Nd { get textContent() { return ''; } }
  class T extends Nd { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends Nd {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { if (x === null || x === undefined || Array.isArray(x)) throw new Error('append(bad)'); const n = x instanceof Nd ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = Nd;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null) };
  return { toast };
}

await t('the card: a member sees and changes only their own row; an administrator all; written with the sha through guarded(variables); a change made elsewhere is read again; a viewer cannot (fake DOM)', async () => {
  const { toast } = fakeDom();
  const UI = await imp('panel/ui/notifyprefs.mjs'), DOM = await imp('panel/ui/dom.mjs');
  const files = { [N.NOTIFY_FILE]: { text: JSON.stringify({ version: 1, members: { bob: { kinds: ['weekly'] } } }), sha: 's1' } };
  let n = 1; const puts = [], guards = [];
  const api = {
    async file(r, p) { const f = files[p]; return f ? { ...f } : null; },
    async putFile(r, p, text, sha, message) {
      const bad = fakeCheck('PUT', `/repos/${r}/contents/${p}`, { message, content: Buffer.from(text).toString('base64'), ...(sha ? { sha } : {}) });
      if (bad) throw Object.assign(new Error(bad.message), { status: 422 });
      puts.push({ p, sha, message });
      if ((files[p]?.sha ?? undefined) !== sha) throw Object.assign(new Error('409 does not match'), { status: 409 });
      files[p] = { text, sha: `s${++n}` }; return { content: { sha: files[p].sha } };
    },
  };
  const ctx = (o = {}) => ({ api, lab: { slug: 'o/lab', role: 'write' }, me: { login: 'alice' }, members: ['alice', 'bob'], may: (a) => P.ACTIONS.includes(a) && a === 'variables',
    // (as the panel's: an action the policy does not know is refused before anything is sent)
    guarded: async (action, detail, fn, done) => { guards.push({ action, detail }); if (!P.can(P.DEFAULT_POLICY, 'write', action)) { DOM.toast('許されていません', true); return undefined; } try { const r = await fn(); if (done) DOM.toast(done); return r; } catch (e) { DOM.toast(e.message, true); return undefined; } }, ...o });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const boxes = (c, kind) => c.all((e) => e.attrs['data-kind'] === kind);
  const rows = (c) => c.all((e) => e.attrs['data-login'] !== undefined).map((e) => e.attrs['data-login']);

  let card = UI.notifyPrefsCard(ctx()); await flush();
  eq(rows(card), ['alice'], 'a member sees their own row only');
  eq(boxes(card, 'failed')[0].checked, true, 'default on');
  const cb = boxes(card, 'weekly')[0]; cb.checked = true; await cb.fire('change'); await flush();
  eq(guards.at(-1).action, 'variables'); eq(guards.at(-1).detail.file, N.NOTIFY_FILE);
  eq(puts.at(-1).sha, 's1'); ok(/通知の設定/.test(puts.at(-1).message), 'commit message');
  eq(N.wants(N.parsePrefs(files[N.NOTIFY_FILE].text), 'alice', 'weekly'), true, 'written');
  eq(N.parsePrefs(files[N.NOTIFY_FILE].text).members.bob.kinds, ['weekly'], 'bob untouched');
  eq(boxes(card, 'weekly')[0].checked, true, 'redrawn');

  // changed elsewhere: our sha is old
  files[N.NOTIFY_FILE] = { text: JSON.stringify({ version: 1, members: { bob: { kinds: ['passed'] } } }), sha: 's9' };
  const cb2 = boxes(card, 'passed')[0]; cb2.checked = true; await cb2.fire('change'); await flush();
  ok(/別の人が先に/.test(toast.kids.at(-1).textContent) || toast.kids.some((k) => /別の人が先に|does not match/.test(k.textContent)), 'told');
  eq(N.parsePrefs(files[N.NOTIFY_FILE].text).members.bob.kinds, ['passed'], 'nothing written over it');

  // a protected branch's 409 is no change made elsewhere: said as it is, not "read again and try once more"
  const rule = { ...api, async putFile() { throw Object.assign(new Error('GitHub: 409 Repository rule violations found'), { status: 409 }); } };
  card = UI.notifyPrefsCard(ctx({ api: rule })); await flush();
  const cb3 = boxes(card, 'release')[0]; cb3.checked = !cb3.checked; await cb3.fire('change'); await flush();
  ok(/rule violations/.test(toast.kids.at(-1).textContent) && !/別の人が先に/.test(toast.kids.at(-1).textContent), toast.kids.at(-1).textContent);

  // their Discord user id: kept in the file (no other switch moved); a wrong one refused in words, nothing written
  card = UI.notifyPrefsCard(ctx()); await flush();
  const idBox = card.all((e) => e.attrs['data-discord'] === 'alice')[0], save = card.all((e) => e.tagName === 'BUTTON' && /ID を記録/.test(e.textContent))[0];
  const kindsBefore = N.kindsOf(N.parsePrefs(files[N.NOTIFY_FILE].text), 'alice');
  idBox.value = '123456789012345678'; await save.fire('click'); await flush();
  const now = N.parsePrefs(files[N.NOTIFY_FILE].text);
  eq(now.members.alice.discord, '123456789012345678'); eq(N.kindsOf(now, 'alice'), kindsBefore, 'the switches untouched');
  ok(N.mentions(now, kindsBefore[0]).includes('<@123456789012345678>'), 'called for what they ticked');
  const n0 = puts.length; idBox.value = 'abc'; await save.fire('click'); await flush();
  eq(puts.length, n0, 'a wrong id: nothing written'); ok(/ユーザー ID/.test(card.textContent), 'said why');

  card = UI.notifyPrefsCard(ctx({ lab: { slug: 'o/lab', role: 'admin' } })); await flush();
  ok(rows(card).includes('bob') && rows(card).includes('alice'), 'an administrator sees all');
  card = UI.notifyPrefsCard(ctx({ may: () => false })); await flush();
  ok(boxes(card, 'failed')[0].disabled, 'cannot without the right'); ok(/変数/.test(card.textContent), 'the reason is shown');
  const before = puts.length;
  card = UI.notifyPrefsCard(ctx({ api: { ...api, async file() { throw Object.assign(new Error('GitHub: 500'), { status: 500 }); } } })); await flush();
  ok(/500/.test(card.textContent), 'a failure is shown'); eq(puts.length, before);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
