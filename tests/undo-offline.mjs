// the audit log's undo without a browser or a network: what an entry can be put back to (pure: a file of the policy, the
// timetable or the notify settings; a variable only with its value from before; a secret, a deletion or another action
// never), the commit found by the entry's time and person, the file put back from the commit's parent as a NEW commit with the
// current sha (a fake GitHub behind lib/gh.mjs's gh({ fetchImpl }), each write through ghrules' fakeCheck), the variable set
// back, and the card on a small fake DOM (now and after, 「この変更を取り消す」 through a fake guarded that asks the policy,
// a button that cannot be pressed saying why, failing GitHub shown with failView).
// node tests/undo-offline.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeCheck } from '../panel/lib/ghrules.mjs';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const U = await imp('panel/lib/undo.mjs'), G = await imp('panel/lib/gh.mjs'), P = await imp('panel/lib/policy.mjs'), AU = await imp('panel/lib/audit.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const PF = P.POLICY_FILE, SF = '.github/bds-lab-schedule.json', NF = '.github/bds-lab-notify.json';
const POL1 = `${JSON.stringify({ version: 1, roles: { write: ['dispatch'] } }, null, 2)}\n`;
const POL2 = `${JSON.stringify({ version: 1, roles: { write: ['dispatch', 'variables'] }, confirm: ['*'] }, null, 2)}\n`;
const S0 = '0'.repeat(40), S1 = '1'.repeat(40), S2 = '2'.repeat(40), S3 = '3'.repeat(40);
const AT = '2026-10-10T09:00:30Z';
const ent = (action, detail, at = AT, actor = 'alice') => AU.entry({ actor, action, target: 'o/lab', detail, at });
// (the requests to the fake GitHub counted where they start and end: a wait ends when none is open and none has come or gone
// for a while — not after a fixed time, which a busy CI runner can outlast)
const net = { busy: 0, at: 0 };
const settle = async () => {
  const until = Date.now() + 10_000;
  await new Promise((r) => setTimeout(r, 30));
  while (Date.now() < until && (net.busy > 0 || Date.now() - net.at < 60)) await new Promise((r) => setTimeout(r, 15));
};

/** a fake GitHub: per file, commits (newest first) each with its text; variables by name. Every write through fakeCheck */
function fakeGitHub({ down = false } = {}) {
  const st = {
    files: { [PF]: [
      { sha: S2, login: 'bob', date: '2026-10-11T12:00:00Z', text: `${JSON.stringify({ version: 1, roles: { write: [] } }, null, 2)}\n` },
      { sha: S3, login: 'carol', date: '2026-10-10T09:00:25Z', text: POL2.replace('"confirm"', '"idleMinutes": 5,\n  "confirm"') },
      { sha: S1, login: 'alice', date: '2026-10-10T09:00:20Z', text: POL2 },
      { sha: S0, login: 'alice', date: '2026-10-01T00:00:00Z', text: POL1 },
    ], [NF]: [{ sha: S1, login: 'alice', date: '2026-10-10T09:00:10Z', text: '{"version":1,"members":{}}\n' }] },
    vars: { LAB_HOSTS: 'o/new' }, puts: [], patches: [], seen: [],
  };
  // (the parent of a commit: the next older one of that file)
  const parentOf = (f, i) => st.files[f][i + 1]?.sha ?? null;
  const textAt = (f, ref) => { const xs = st.files[f] ?? []; const x = ref ? xs.find((c) => c.sha === ref) : xs[0]; return x ? x.text : null; };
  const answer = async (url, init) => {
    const u = String(url).replace(/^https:\/\/fake/, ''), m = init.method, body = init.body ? JSON.parse(init.body) : null;
    const send = (status, j) => ({ status, ok: status < 300, headers: { get: () => null }, text: async () => (j === null ? '' : JSON.stringify(j)) });
    st.seen.push(`${m} ${u}`);
    { const bad = fakeCheck(m, u, body); if (bad) return send(422, { message: bad.message }); }
    if (down) return send(500, { message: 'boom' });
    let x;
    if (m === 'GET' && (x = /^\/repos\/o\/lab\/commits\?per_page=\d+&path=([^&]+)&since=([^&]+)(?:&until=([^&]+))?$/.exec(u))) {
      const f = decodeURIComponent(x[1]), a = Date.parse(decodeURIComponent(x[2])), b = x[3] ? Date.parse(decodeURIComponent(x[3])) : Infinity;
      return send(200, (st.files[f] ?? []).map((c, i) => ({ c, i })).filter(({ c }) => Date.parse(c.date) >= a && Date.parse(c.date) <= b)
        .map(({ c, i }) => ({ sha: c.sha, author: { login: c.login }, commit: { author: { date: c.date }, committer: { date: c.date } }, parents: parentOf(f, i) ? [{ sha: parentOf(f, i) }] : [] })));
    }
    if (m === 'GET' && (x = /^\/repos\/o\/lab\/contents\/([^?]+)(?:\?ref=(.+))?$/.exec(u))) {
      const f = x[1].split('/').map(decodeURIComponent).join('/'), text = textAt(f, x[2] ? decodeURIComponent(x[2]) : null);
      return text === null ? send(404, { message: 'Not Found' }) : send(200, { content: Buffer.from(text).toString('base64'), sha: `blob-${st.files[f].length}` });
    }
    if (m === 'PUT' && (x = /^\/repos\/o\/lab\/contents\/(.+)$/.exec(u))) {
      const f = x[1].split('/').map(decodeURIComponent).join('/');
      if (body.sha !== `blob-${st.files[f].length}`) return send(409, { message: `${f} does not match ${body.sha}` });
      st.puts.push({ f, ...body }); st.files[f].unshift({ sha: 'f'.repeat(40), login: 'alice', date: '2026-10-12T00:00:00Z', text: Buffer.from(body.content, 'base64').toString() });
      return send(200, { commit: { sha: 'f'.repeat(40) }, content: { sha: `blob-${st.files[f].length}` } });
    }
    if ((x = /^\/repos\/o\/lab\/actions\/variables\/([^/?]+)$/.exec(u))) {
      const n = decodeURIComponent(x[1]);
      if (m === 'GET') return n in st.vars ? send(200, { name: n, value: st.vars[n] }) : send(404, { message: 'Not Found' });
      if (m === 'PATCH') { if (!(n in st.vars)) return send(404, { message: 'Not Found' }); st.patches.push(body); st.vars[n] = body.value; return send(204, null); }
    }
    if (m === 'POST' && u === '/repos/o/lab/actions/variables') { st.patches.push(body); st.vars[body.name] = body.value; return send(201, null); }
    return send(404, { message: `Not Found ${m} ${u}` });
  };
  const fetchImpl = async (url, init) => { net.busy++; net.at = Date.now(); try { return await answer(url, init); } finally { net.busy--; net.at = Date.now(); } };
  return { st, api: G.gh({ token: 'ghu_usertoken0123456789', base: 'https://fake', fetchImpl }) };
}

await t('undoable: the policy, the timetable and the notify files with the action that guards them; a variable only with its value from before; secrets, other files and other actions say why not (pure)', () => {
  eq(U.undoable(ent('members', { file: PF })), { ok: true, kind: 'file', path: PF, action: 'members', why: '' });
  eq(U.undoable({ action: 'policy', detail: { file: PF } }).action, 'members');
  eq(U.undoable(ent('dispatch', { file: SF, workflow: 'verify.yml' })), { ok: true, kind: 'file', path: SF, action: 'dispatch', why: '' });
  eq(U.undoable(ent('variables', { file: NF })), { ok: true, kind: 'file', path: NF, action: 'variables', why: '' });
  eq(U.undoable({ action: 'variables', detail: { name: 'LAB_HOSTS', before: 'o/old' } }), { ok: true, kind: 'variable', name: 'LAB_HOSTS', before: 'o/old', action: 'variables', why: '' });
  eq(U.undoable({ action: 'variables', detail: { name: 'LAB_HOSTS', before: '' } }).before, '', 'an empty value from before is a value');
  const noBefore = U.undoable(ent('variables', { name: 'LAB_HOSTS' }));
  ok(!noBefore.ok && noBefore.kind === 'variable' && /前の値が記録にありません/.test(noBefore.why), noBefore.why);
  for (const e of [ent('secrets.put', { name: 'X' }), ent('secrets.delete', { name: 'X' })]) { const r = U.undoable(e); ok(!r.ok && /秘密の値/.test(r.why), r.why); }
  const unit = U.undoable(ent('dispatch', { file: 'units/x/tests.txt' }));
  ok(!unit.ok && /アドオン/.test(unit.why), unit.why);
  for (const e of [ent('dispatch', { workflow: 'verify.yml' }), ent('run.cancel', { run: '5' }), ent('members', { user: 'bob', permission: 'none' }), {}, null]) { const r = U.undoable(e); ok(!r.ok && r.why, JSON.stringify(e)); }
  ok(!U.undoable({ action: 'variables', detail: {} }).ok, 'no name');
});

await t('pickCommit: within the window around the entry, the entry\'s person first, the nearest; its parent; none outside (pure)', () => {
  const c = (sha, login, date, parent) => ({ sha, author: { login }, commit: { committer: { date } }, parents: parent ? [{ sha: parent }] : [] });
  const xs = [c(S2, 'bob', '2026-10-10T09:00:28Z', S1), c(S1, 'alice', '2026-10-10T09:00:20Z', S0), c(S3, 'alice', '2026-10-10T08:40:00Z', S0)];
  eq(U.pickCommit(xs, ent('members', {})), { sha: S1, parent: S0, date: '2026-10-10T09:00:20.000Z' });
  eq(U.pickCommit(xs, ent('members', {}, AT, 'dave')).sha, S2, 'nobody of that name: the nearest');
  eq(U.pickCommit([c(S1, 'alice', '2026-10-10T09:00:20Z')], ent('members', {})).parent, null);
  eq(U.pickCommit(xs, ent('members', {}, '2026-10-11T00:00:00Z')), null);
  eq(U.pickCommit(null, ent('members', {})), null);
  eq(U.pickCommit(xs, { at: 'nope' }), null);
});

await t('lineChanges and undoMessage (pure)', () => {
  eq(U.lineChanges('a\nb\n', 'a\nB\nc\n'), { added: ['B', 'c'], removed: ['b'] });
  eq(U.lineChanges('a\na\n', 'a\n'), { added: [], removed: ['a'] });
  eq(U.lineChanges(null, ''), { added: [], removed: [] });
  eq(U.lineChanges('a\r\n', 'a\n'), { added: [], removed: [] });
  eq(U.undoMessage(PF, S0), `panel: ${PF} を 0000000 の前に戻す（監査ログから取り消し）`);
});

await t('prepare + apply (a file): the commit found by time and person, its parent\'s text written over the file as a new commit with the current sha; again: nothing written', async () => {
  const f = fakeGitHub();
  const p = await U.prepare(f.api, 'o/lab', ent('members', { file: PF }));
  eq([p.ok, p.kind, p.commit.sha, p.commit.parent, p.before, p.same, p.problems], [true, 'file', S1, S0, POL1, false, []]);
  ok(p.now.includes('"write": []'), p.now);
  ok(f.st.seen.some((s) => /since=2026-10-10T08%3A50%3A30\.000Z&until=2026-10-10T09%3A02%3A30\.000Z/.test(s)), f.st.seen.join('\n'));
  const r = await U.apply(f.api, 'o/lab', p);
  eq(r.changed, true); eq(f.st.puts.length, 1); eq(f.st.puts[0].sha, 'blob-4'); eq(f.st.puts[0].message, U.undoMessage(PF, S1));
  eq(f.st.files[PF][0].text, POL1);
  eq((await U.apply(f.api, 'o/lab', p)).changed, false); eq(f.st.puts.length, 1, 'the same as now writes nothing');
  eq((await U.prepare(f.api, 'o/lab', ent('members', { file: PF }))).same, true, 'undone: the same as now (the new commit is not the one found)');
});

await t('prepare: a file made by the change, a commit not found and a broken version from before say why; apply refuses them and writes nothing', async () => {
  const f = fakeGitHub();
  const made = await U.prepare(f.api, 'o/lab', ent('variables', { file: NF }));
  ok(!made.ok && /作られました/.test(made.why), made.why);
  const none = await U.prepare(f.api, 'o/lab', ent('dispatch', { file: SF }));
  ok(!none.ok && /見つかりません/.test(none.why), none.why);
  f.st.files[PF][3].text = '{"version":1,"roles":{"write":["fly"]}}\n';
  const broken = await U.prepare(f.api, 'o/lab', ent('members', { file: PF }));
  ok(broken.ok && broken.problems.length === 1 && /roles/.test(broken.problems[0]), JSON.stringify(broken.problems));
  f.st.files[PF][3].text = 'not json';
  ok(/JSON/.test((await U.prepare(f.api, 'o/lab', ent('members', { file: PF }))).problems[0]), 'not JSON');
  for (const p of [made, none, broken, U.undoable(ent('secrets.put', { name: 'X' }))]) { let e = null; try { await U.apply(f.api, 'o/lab', p); } catch (x) { e = x; } ok(e, 'refused'); }
  eq(f.st.puts.length, 0);
});

await t('prepare + apply (a variable): now and before shown; PATCH sets it back; a variable gone since is made again; the same writes nothing', async () => {
  const f = fakeGitHub(), e = { ...ent('variables', { name: 'LAB_HOSTS' }), detail: { name: 'LAB_HOSTS', before: 'o/old' } };
  const p = await U.prepare(f.api, 'o/lab', e);
  eq([p.ok, p.now, p.before, p.same], [true, 'o/new', 'o/old', false]);
  eq((await U.apply(f.api, 'o/lab', p)).changed, true); eq(f.st.vars.LAB_HOSTS, 'o/old'); eq(f.st.patches, [{ name: 'LAB_HOSTS', value: 'o/old' }]);
  eq((await U.apply(f.api, 'o/lab', p)).changed, false); eq(f.st.patches.length, 1);
  delete f.st.vars.LAB_HOSTS;
  eq((await U.prepare(f.api, 'o/lab', e)).now, null);
  eq((await U.apply(f.api, 'o/lab', p)).changed, true); eq(f.st.vars.LAB_HOSTS, 'o/old');
});

// ---- a small DOM: click calls the onclick handlers, a disabled button is never pressed ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    prepend(...xs) { const old = this.kids; this.kids = []; this.append(...xs); this.kids.push(...old); }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { if (this.disabled) return Promise.resolve([]); return Promise.all((this.on.click ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
const btn = (c, re) => c.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0];
/** 「取り消す…」 pressed: only then is GitHub read */
const open = async (c) => { const b = btn(c, /^取り消す…$/); if (b) await b.click(); await settle(); };
/** the check 「後の N 件の変更もまとめて戻す」 ticked */
const tickBox = (c) => { const b = c.all((e) => e.tagName === 'INPUT' && e.attrs.type === 'checkbox')[0]; b.checked = true; for (const fn of b.on.change ?? []) fn({ target: b }); return b; };
/** a guarded like panel.js's: the policy asked for the role, refused when not allowed, the done words, the record kept */
const fakeGuarded = (role, calls, toast) => async (action, detail, fn, done) => {
  if (!P.can(P.DEFAULT_POLICY, role, action)) { calls.push(['refused', action]); return undefined; }
  try { const r = await fn(); calls.push([action, detail]); if (done) toast.append(globalThis.document.createTextNode(done)); return r; } catch (e) { calls.push(['failed', e.message]); return undefined; }
};

await t('undoCard (a file): now and after shown line by line; 「この変更を取り消す」 through guarded(members, { file }) writes a new commit, then shows it the same as now', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/undo.mjs'), f = fakeGitHub(), calls = [];
  const c = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('admin', calls, toast), may: () => true }, ent('members', { file: PF }));
  await open(c);
  ok(/役割（ポリシー）/.test(c.textContent) && /1111111 の前の版にすると/.test(c.textContent) && /\+ +"dispatch"/.test(c.textContent), c.textContent);
  tickBox(c);
  const go = btn(c, /この変更を取り消す/); ok(!go.disabled, 'can be pressed');
  await go.click(); await settle();
  eq(calls, [['members', { file: PF, ref: '0000000' }]]); eq(f.st.puts.length, 1);
  ok(/取り消しました/.test(c.textContent) && /今と同じです/.test(c.textContent) && /新しい commit/.test(toast.textContent), c.textContent);
  const again = btn(c, /この変更を取り消す/); ok(again.disabled, 'the same as now: cannot be pressed');
  await again.click(); await settle(); eq(f.st.puts.length, 1, 'a disabled button writes nothing');
});

await t('undoCard: the guard per file (the timetable: dispatch; notify: variables; a variable: variables) and a role the policy does not allow is refused by guarded', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/undo.mjs'), f = fakeGitHub(), calls = [];
  const e = { ...ent('variables', { name: 'LAB_HOSTS' }), detail: { name: 'LAB_HOSTS', before: 'o/old' } };
  // (a read role through guarded alone: the button is there, the policy refuses it)
  const c = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('read', calls, toast) }, e);
  await open(c);
  ok(/今: o\/new/.test(c.textContent) && /取り消した後: o\/old/.test(c.textContent), c.textContent);
  await btn(c, /この変更を取り消す/).click(); await settle();
  eq(calls, [['refused', 'variables']]); eq(f.st.patches.length, 0);
  const c2 = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('write', calls, toast) }, e);
  await open(c2); await btn(c2, /この変更を取り消す/).click(); await settle();
  eq(calls.at(-1), ['variables', { name: 'LAB_HOSTS', before: 'o/new' }]); eq(f.st.vars.LAB_HOSTS, 'o/old');
  // (may() says no first: the button cannot be pressed and says what is needed)
  const c3 = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('admin', calls, toast), may: (a) => a !== 'members' }, ent('members', { file: PF }));
  await open(c3);
  const b3 = btn(c3, /この変更を取り消す/); ok(b3.disabled && /メンバーと役割を変える/.test(c3.textContent), c3.textContent);
  await b3.click(); eq(f.st.puts.length, 0);
});

await t('undoCard: what cannot be undone says why with a button that cannot be pressed; a broken version from before cannot be written; a failing GitHub shows failView and a way to read again', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/undo.mjs'), calls = [];
  let f = fakeGitHub();
  const g = fakeGuarded('admin', calls, toast);
  for (const [e, re] of [[ent('secrets.put', { name: 'X' }), /秘密の値/], [ent('variables', { name: 'LAB_HOSTS' }), /前の値が記録にありません/], [ent('variables', { file: NF }), /作られました/]]) {
    const c = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: g }, e);
    await open(c);
    const b = btn(c, /この変更を取り消す/); ok(b.disabled && re.test(c.textContent), c.textContent);
    await b.click();
  }
  f.st.files[PF][3].text = '{"version":1,"roles":{"write":["fly"]}}\n';
  const c = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: g }, ent('members', { file: PF }));
  await open(c);
  ok(btn(c, /この変更を取り消す/).disabled && /誤りがあるので戻せません/.test(c.textContent), c.textContent);
  const c0 = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' } }, ent('members', { file: PF }));
  await open(c0); ok(btn(c0, /この変更を取り消す/).disabled, 'no guarded: nothing written');
  eq(calls, []); eq(f.st.puts.length, 0);
  f = fakeGitHub({ down: true });
  const cd = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: g }, ent('members', { file: PF }));
  await open(cd);
  ok(cd.all((e) => e.attrs.role === 'alert').length === 1 && btn(cd, /読み直す/), cd.textContent);
});

await t('apply: writes with the sha prepare read (not read again); changed after prepare → 「開いた後に変わりました」 and nothing written', async () => {
  const f = fakeGitHub();
  const p = await U.prepare(f.api, 'o/lab', ent('members', { file: PF }));
  eq(p.nowSha, 'blob-4');
  // (someone changes the policy after the card was opened)
  f.st.files[PF].unshift({ sha: 'e'.repeat(40), login: 'dave', date: '2026-10-11T13:00:00Z', text: POL2 });
  let e = null; try { await U.apply(f.api, 'o/lab', p); } catch (x) { e = x; }
  ok(e && /開いた後に変わりました。読み直してください/.test(e.message), e?.message);
  eq(f.st.puts.length, 0, 'nothing written'); eq(f.st.files[PF][0].text, POL2);
  const seen = f.st.seen.length, p2 = await U.prepare(f.api, 'o/lab', ent('members', { file: PF }));
  eq((await U.apply(f.api, 'o/lab', p2)).changed, true);
  eq(f.st.seen.slice(seen).filter((x) => /^GET .*\/contents\/[^?]+$/.test(x)).length, 1, 'the current file read once, by prepare');
});

await t('prepare: the commits of the same file after the one undone are counted (later); none after: 0', async () => {
  const f = fakeGitHub();
  eq((await U.prepare(f.api, 'o/lab', ent('members', { file: PF }))).later, 2);
  ok(f.st.seen.some((x) => /commits\?per_page=\d+&path=[^&]+&since=2026-10-10T09%3A00%3A20\.000Z$/.test(x)), f.st.seen.join('\n'));
  const last = await U.prepare(f.api, 'o/lab', ent('members', { file: PF }, '2026-10-11T12:00:10Z', 'bob'));
  eq([last.ok, last.commit.sha, last.later], [true, S2, 0]);
});

await t('undoCard: later changes of the same file are said ("それも戻ります") and the button waits for the check; none later: no check', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/undo.mjs'), f = fakeGitHub(), calls = [];
  const c = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('admin', calls, toast) }, ent('members', { file: PF }));
  await open(c);
  ok(/2 件変わっています/.test(c.textContent) && /それも戻ります/.test(c.textContent) && /後の 2 件の変更もまとめて戻す/.test(c.textContent), c.textContent);
  const go = btn(c, /この変更を取り消す/); ok(go.disabled && /チェックを入れてください/.test(c.textContent), c.textContent);
  await go.click(); await settle(); eq(f.st.puts.length, 0, 'not ticked: nothing written'); eq(calls, []);
  tickBox(c); ok(!go.disabled, 'ticked: can be pressed');
  await go.click(); await settle(); eq(f.st.puts.length, 1);
  const f2 = fakeGitHub();
  const c2 = UI.undoCard({ api: f2.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('admin', [], toast) }, ent('members', { file: PF }, '2026-10-11T12:00:10Z', 'bob'));
  await open(c2);
  ok(!/それも戻ります/.test(c2.textContent) && c2.all((e) => e.tagName === 'INPUT').length === 0 && !btn(c2, /この変更を取り消す/).disabled, c2.textContent);
});

await t('undoCard: making the card reads nothing from GitHub; 「取り消す…」 pressed reads it', async () => {
  fakeDom();
  const UI = await imp('panel/ui/undo.mjs'), f = fakeGitHub();
  const c = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: async () => undefined }, ent('members', { file: PF }));
  await settle();
  eq(f.st.seen, [], 'nothing read yet'); ok(btn(c, /^取り消す…$/) && !btn(c, /この変更を取り消す/), c.textContent);
  await open(c);
  ok(f.st.seen.length > 0 && btn(c, /この変更を取り消す/), c.textContent);
});

await t('undoCard: the record keeps ref (the commit put back to) and a variable\'s value before the undo, so the undo can be undone too', async () => {
  const { toast } = fakeDom(), UI = await imp('panel/ui/undo.mjs'), f = fakeGitHub(), calls = [];
  const e = { ...ent('variables', { name: 'LAB_HOSTS' }), detail: { name: 'LAB_HOSTS', before: 'o/old' } };
  const c = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('admin', calls, toast) }, e);
  await open(c); await btn(c, /この変更を取り消す/).click(); await settle();
  eq(calls, [['variables', { name: 'LAB_HOSTS', before: 'o/new' }]]);
  // (the record as the audit log keeps it: undoable again, back to o/new)
  const back = U.undoable(ent('variables', calls[0][1]));
  eq([back.ok, back.before], [true, 'o/new']);
  // (a variable not of BEFORE_NAMES: no before)
  f.st.vars.OTHER = 'now';
  const c2 = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('admin', calls, toast) }, { action: 'variables', detail: { name: 'OTHER', before: 'old' } });
  await open(c2); await btn(c2, /この変更を取り消す/).click(); await settle();
  eq(calls.at(-1), ['variables', { name: 'OTHER' }]);
  const c3 = UI.undoCard({ api: f.api, lab: { slug: 'o/lab' }, guarded: fakeGuarded('admin', calls, toast) }, ent('members', { file: PF }));
  await open(c3); tickBox(c3); await btn(c3, /この変更を取り消す/).click(); await settle();
  eq(calls.at(-1), ['members', { file: PF, ref: '0000000' }]);
  ok(AU.entry({ actor: 'alice', action: 'members', detail: calls.at(-1)[1] }).detail.ref === '0000000', 'the audit log keeps ref');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
