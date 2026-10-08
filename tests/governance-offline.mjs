// the panel's roles and audit log without a browser or a network: the policy file checked (a broken one allows nothing, never
// the wider default), the default the same as the panel before policies, `can` asking GitHub's role first (no policy goes
// past it), organization teams (the first listed; teams that cannot be read count every role they might give), the policy
// read from the lab's default branch; audit entries with fixed keys only and never a secret's value, kept as comments on an
// issue made with its label and locked (a fake GitHub on node:http, one login per token) and read back — an entry written as
// someone else is not counted, an edited one is marked, GitHub's time is the time; a full issue (ROTATE_AT comments) closed
// and the next made, every one read — CSV quoted and never a formula, and the 「監査」 tab on a small fake DOM.
// node tests/governance-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const P = await imp('panel/lib/policy.mjs'), AU = await imp('panel/lib/audit.mjs'), G = await imp('panel/lib/gh.mjs'), M = await imp('panel/lib/model.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const allowed = (policy, role) => P.ACTIONS.filter((a) => P.can(policy, role, a));

await t('no policy file: the panel as it was — writers and admins do what GitHub lets them (lending: a host\'s admin), readers nothing; deleting a secret asks first; never signed out for idling; the audit log kept when the lab is not public (pure)', () => {
  eq(P.checkPolicy(null), { policy: P.DEFAULT_POLICY, errors: [] });
  eq(allowed(P.DEFAULT_POLICY, 'admin'), P.ACTIONS);
  // (lending: a host's admin; members: the lab's admin — GitHub's own rule for both)
  const writer = P.ACTIONS.filter((a) => a !== 'lend' && a !== 'members');
  eq([allowed(P.DEFAULT_POLICY, 'maintain'), allowed(P.DEFAULT_POLICY, 'write')], [writer, writer]);
  eq([allowed(P.DEFAULT_POLICY, 'triage'), allowed(P.DEFAULT_POLICY, 'read'), allowed(P.DEFAULT_POLICY, null), allowed(null, 'write')], [[], [], [], writer], 'no policy at all: the default');
  // (the panel's own idea of who uses the lab: write or admin — the same people)
  for (const [perm, role] of [[{ admin: true }, 'admin'], [{ maintain: true, push: true }, 'maintain'], [{ push: true }, 'write'], [{ triage: true, pull: true }, 'triage'], [{ pull: true }, 'read']]) {
    eq(P.repoRoleOf(perm), role, JSON.stringify(perm));
    const usesLab = ['admin', 'write'].includes(M.roleOf(perm));
    eq(P.can(P.DEFAULT_POLICY, P.roleFor({ repoRole: perm }), 'dispatch'), usesLab, `${role}: dispatch as before`);
  }
  ok(P.can(P.DEFAULT_POLICY, P.roleFor({ repoRole: { admin: true } }), 'lend') && !P.can(P.DEFAULT_POLICY, P.roleFor({ repoRole: { push: true } }), 'lend'), 'lending: the host\'s admin (its lender), as before');
  eq(P.ACTIONS.filter((a) => P.needsConfirm(P.DEFAULT_POLICY, a)), ['secrets.delete'], 'what asked before still asks');
  eq(P.idleMinutes(P.DEFAULT_POLICY), 0);
  eq(['private', 'internal', 'public', undefined].map((v) => P.auditMode(P.DEFAULT_POLICY, v)), ['issue', 'issue', 'off', 'off']);
  ok(Object.isFrozen(P.DEFAULT_POLICY) && Object.isFrozen(P.DEFAULT_POLICY.roles.write), 'nobody changes the default in place');
});

await t('the policy file checked: errors in words; a file that does not check out allows nothing (it meant to narrow: never the wider default); roles listed are the only roles (pure)', () => {
  const bad = [['x', /オブジェクト/], [[1], /オブジェクト/], [{ rolez: {} }, /rolez: 知らない項目/], [{ version: 2 }, /version: 1/], [{ roles: { write: ['deploy'] } }, /roles\.write: dispatch/], [{ roles: { 'Bad Name': [] } }, /役割の名前/],
    [{ roles: [] }, /roles: \{/], [{ teams: { ops: 'operator' } }, /teams\.ops: roles にある役割/], [{ teams: { 'a b': 'write' } }, /teams\.a b: 組織のチーム/], [{ confirm: ['nope'] }, /confirm/], [{ idleMinutes: -1 }, /idleMinutes/], [{ idleMinutes: 1.5 }, /idleMinutes/], [{ audit: 'yes' }, /audit/]];
  for (const [j, re] of bad) {
    const r = P.checkPolicy(j);
    ok(r.policy === P.LOCKED_POLICY && r.errors.some((e) => re.test(e)), `${JSON.stringify(j)} → ${r.errors.join(' / ')}`);
    eq(allowed(r.policy, 'admin'), [], `${JSON.stringify(j)}: nothing allowed, even to an admin`);
    eq(P.ACTIONS.every((a) => P.needsConfirm(r.policy, a)), true, 'everything asks');
  }
  const { policy, errors } = P.checkPolicy({ version: 1, roles: { admin: ['*'], write: ['dispatch', 'dispatch', 'run.cancel'], auditor: ['audit.read'] }, teams: { auditors: 'auditor' }, confirm: ['run.cancel'], idleMinutes: 30, audit: 'issue' });
  eq(errors, []);
  eq(policy, { version: 1, roles: { admin: ['*'], write: ['dispatch', 'run.cancel'], auditor: ['audit.read'] }, teams: { auditors: 'auditor' }, confirm: ['run.cancel'], idleMinutes: 30, audit: 'issue' });
  eq([allowed(policy, 'write'), allowed(policy, 'maintain'), allowed(policy, 'admin').length], [['dispatch', 'run.cancel'], [], P.ACTIONS.length], 'a role not listed may do nothing');
  eq([P.needsConfirm(policy, 'run.cancel'), P.needsConfirm(policy, 'secrets.delete'), P.idleMinutes(policy), P.auditMode(policy, 'public')], [true, false, 30, 'issue']);
  eq(P.checkPolicy({ teams: { ops: 'write' } }).policy.roles, P.DEFAULT_POLICY.roles, 'no roles: the default\'s, which a team may name');
  eq(P.checkPolicy({ audit: 'off' }).policy.audit, 'off');
  eq(P.needsConfirm(P.checkPolicy({ confirm: ['*'] }).policy, 'dispatch'), true);
});

await t('can: GitHub first — whatever a policy says, nothing past what the person\'s GitHub role on that repository could be allowed; a policy only narrows (pure)', () => {
  const everything = P.checkPolicy({ roles: { admin: ['*'], maintain: ['*'], write: ['*'], triage: ['*'], read: ['*'] } }).policy;
  eq(allowed(everything, 'read'), ['audit.read'], 'a reader given everything: only reading (GitHub lets a reader read issues)');
  eq(allowed(everything, 'triage'), ['audit.read']);
  eq(allowed(everything, 'write'), P.ACTIONS.filter((a) => a !== 'lend' && a !== 'members'), 'a writer given everything: not a host\'s admin, not the lab\'s members');
  for (const a of P.ACTIONS) ok(P.GITHUB_ROLES.includes(P.GITHUB_NEEDS[a]), `${a}: GitHub's least role said`);
  const narrow = P.checkPolicy({ roles: { admin: ['dispatch'], write: [] } }).policy;
  eq([allowed(narrow, 'admin'), allowed(narrow, 'write')], [['dispatch'], []], 'narrowed: even an admin only what is listed');
  ok(!P.can(P.DEFAULT_POLICY, 'admin', 'delete.everything') && !P.can(P.DEFAULT_POLICY, 'admin', '*'), 'an action not known: no');
  ok(!P.can(everything, 'owner', 'dispatch') && !P.can(everything, { name: 'admin', names: ['admin'], repoRole: null }, 'dispatch'), 'no GitHub role: no');
  ok(!P.can(everything, { name: 'admin', names: ['admin'], repoRole: 'read' }, 'dispatch'), 'a role object claiming admin on a read repository: still GitHub\'s read');
  eq(P.roleFor({ repoRole: 'superuser' }), { name: null, names: [], repoRole: null, team: null });
});

await t('teams: an organization\'s team names a role (the first team listed that the person is in), within GitHub\'s role; teams that cannot be read count every role they might give — only what all of them allow (pure)', () => {
  const policy = P.checkPolicy({ roles: { admin: ['*'], write: ['dispatch'], operator: ['dispatch', 'run.cancel', 'hostrun'], auditor: ['audit.read'] }, teams: { 'Release-Ops': 'operator', auditors: 'auditor' } }).policy;
  const op = P.roleFor({ repoRole: { push: true }, teams: ['release-ops', 'auditors'], policy });
  eq(op, { name: 'operator', names: ['operator'], repoRole: 'write', team: 'Release-Ops' }, 'the first team listed, any case');
  eq(allowed(policy, op), ['dispatch', 'hostrun', 'run.cancel']);
  eq(allowed(policy, P.roleFor({ repoRole: { push: true }, teams: ['auditors'], policy })), ['audit.read'], 'a team can narrow a writer');
  eq(allowed(policy, P.roleFor({ repoRole: { push: true }, teams: [], policy })), ['dispatch'], 'in no team: GitHub\'s role');
  eq(allowed(policy, P.roleFor({ repoRole: { pull: true }, teams: ['release-ops'], policy })), [], 'a reader in the operators\' team: GitHub still says read');
  const unknown = P.roleFor({ repoRole: { push: true }, teams: null, policy });
  eq([unknown.name, unknown.names], [null, ['operator', 'auditor', 'write']]);
  eq(allowed(policy, unknown), [], 'teams not readable: only what every role they might have allows');
  const p2 = P.checkPolicy({ roles: { write: ['dispatch', 'audit.read'], operator: ['dispatch', 'run.cancel'] }, teams: { ops: 'operator' } }).policy;
  eq(allowed(p2, P.roleFor({ repoRole: 'write', teams: null, policy: p2 })), ['dispatch'], 'the common part');
  eq(P.roleFor({ repoRole: 'write', teams: null, policy: P.DEFAULT_POLICY }).name, 'write', 'no teams in the policy: nothing unknown');
});

// ---- a fake GitHub: a policy file, an organization's teams, issues, labels and comments; each token is one person ----
async function fakeGitHub({ policyText = null, policyStatus = 200, teams = {} } = {}) {
  const st = { issues: [], labels: new Set(), comments: {}, seen: [], clock: Date.parse('2026-10-08T00:00:00Z'), policyText, policyStatus, teams, lockStatus: 204, closeStatus: 200 };
  const withCount = (i) => ({ ...i, comments: (st.comments[i.number] ?? []).length });
  const who = (req) => ({ 'Bearer tok-alice': 'alice', 'Bearer tok-bob': 'bob', 'Bearer tok-mallory': 'mallory' })[req.headers.authorization] ?? null;
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === null || j === undefined ? '' : JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const u = req.url, m = req.method, body = b ? JSON.parse(b) : null, me = who(req);
      st.seen.push({ m, u, me, body: b });
      if (!me) return send(res, 401, { message: 'Bad credentials' });
      let x;
      if (u === '/repos/o/lab/contents/.github/bds-lab-panel.json') return st.policyStatus !== 200 ? send(res, st.policyStatus, { message: 'Resource not accessible' }) : st.policyText === null ? send(res, 404, { message: 'Not Found' }) : send(res, 200, { content: Buffer.from(st.policyText).toString('base64'), sha: 'S' });
      if ((x = /^\/orgs\/acme\/teams\/([\w.-]+)\/memberships\/(\w+)$/.exec(u))) { const s = st.teams[x[1]]; return s === 403 ? send(res, 403, { message: 'Resource not accessible by integration' }) : s?.includes(x[2]) ? send(res, 200, { state: 'active', role: 'member' }) : send(res, 404, { message: 'Not Found' }); }
      if (u === `/repos/o/lab/issues?labels=${AU.AUDIT_LABEL}&state=all&per_page=100`) return send(res, 200, st.issues.filter((i) => i.labels.some((l) => l.name === AU.AUDIT_LABEL)).map(withCount));
      if ((x = /^\/repos\/o\/lab\/issues\/(\d+)(\/lock)?$/.exec(u))) {
        const i = st.issues.find((y) => y.number === Number(x[1]));
        if (!i) return send(res, 404, { message: 'Not Found' });
        if (x[2] && m === 'PUT') { if (st.lockStatus !== 204) return send(res, st.lockStatus, { message: 'Resource not accessible by integration' }); i.locked = true; return send(res, 204, null); }
        if (!x[2] && m === 'PATCH') { if (st.closeStatus !== 200) return send(res, st.closeStatus, { message: 'Resource not accessible by integration' }); Object.assign(i, { state: body.state }); return send(res, 200, withCount(i)); }
        if (!x[2] && m === 'GET') return send(res, 200, withCount(i));
      }
      if (u === '/repos/o/lab/labels' && m === 'POST') { if (st.labels.has(body.name)) return send(res, 422, { message: 'Validation Failed' }); st.labels.add(body.name); return send(res, 201, body); }
      if (u === '/repos/o/lab/issues' && m === 'POST') { const i = { number: 10 + st.issues.length, title: body.title, body: body.body, state: 'open', labels: body.labels.filter((l) => st.labels.has(l)).map((name) => ({ name })), user: { login: me } }; st.issues.push(i); return send(res, 201, i); }
      if ((x = /^\/repos\/o\/lab\/issues\/(\d+)\/comments$/.exec(u)) && m === 'POST') {
        const at = new Date(st.clock += 60_000).toISOString(), c = { id: 1000 + Object.values(st.comments).flat().length, body: body.body, user: { login: me }, created_at: at, updated_at: at, html_url: `https://github.com/o/lab/issues/${x[1]}#issuecomment-1`, author_association: 'OWNER' };
        (st.comments[x[1]] ??= []).push(c); return send(res, 201, c);
      }
      if ((x = /^\/repos\/o\/lab\/issues\/(\d+)\/comments\?per_page=100&page=(\d+)/.exec(u))) { const all = st.comments[x[1]] ?? [], p = Number(x[2]); return send(res, 200, all.slice((p - 1) * 100, p * 100)); }
      send(res, 404, { message: `Not Found ${m} ${u}` });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { st, base, as: (login) => G.gh({ token: `tok-${login}`, base }), close: () => srv.close() };
}

await t('the policy read from the lab\'s default branch: none → the default; a good one → it; not JSON or not readable → nothing allowed, said why; teams read from the organization (403: not known) (fake GitHub)', async () => {
  const f = await fakeGitHub();
  try {
    const api = f.as('alice');
    eq(await P.loadPolicy(api, 'o/lab'), { policy: P.DEFAULT_POLICY, errors: [], found: false });
    f.st.policyText = JSON.stringify({ roles: { admin: ['*'], write: ['dispatch'] }, teams: { ops: 'admin', auditors: 'write' }, idleMinutes: 15 });
    const good = await P.loadPolicy(api, 'o/lab');
    eq([good.found, good.errors, good.policy.idleMinutes, good.policy.roles.write], [true, [], 15, ['dispatch']]);
    ok(!f.st.seen.some((s) => /\?ref=/.test(s.u)), 'the default branch (no ref)');
    f.st.policyText = '{ "roles": ';
    const broken = await P.loadPolicy(api, 'o/lab');
    ok(broken.policy === P.LOCKED_POLICY && /JSON ではありません/.test(broken.errors[0]), JSON.stringify(broken.errors));
    f.st.policyText = '{"rolez":{}}';
    ok((await P.loadPolicy(api, 'o/lab')).policy === P.LOCKED_POLICY, 'an unknown key: nothing allowed');
    f.st.policyStatus = 403;
    const hidden = await P.loadPolicy(api, 'o/lab');
    ok(hidden.policy === P.LOCKED_POLICY && hidden.found === null && /読めません/.test(hidden.errors[0]), JSON.stringify(hidden));
    f.st.teams = { ops: ['alice'], auditors: ['bob'] };
    eq(await P.teamsOf(api, 'acme', 'alice', good.policy), ['ops']);
    eq(await P.teamsOf(api, 'acme', 'carol', good.policy), [], 'in none (404)');
    f.st.teams = { ops: 403 };
    eq(await P.teamsOf(api, 'acme', 'alice', good.policy), null, 'not readable: unknown, not "in none"');
    eq(await P.teamsOf(api, 'acme', 'alice', P.DEFAULT_POLICY), [], 'no teams in the policy: none asked');
  } finally { f.close(); }
});

await t('an audit entry: fixed keys of fixed forms only — a secret\'s name, never its value (nor a token or a key under any key); a wrong actor or action refused (pure)', () => {
  const e = AU.entry({ actor: 'alice', action: 'secrets.put', target: 'o/lab', at: '2026-10-08T01:02:03Z', detail: { name: 'MS_PASSWORD', value: 'hunter2', secret: 'hunter2', token: 'ghp_x', run: 123, ref: 'main', workflow: 'app.yml', inputs: ['mode', 'hold'], file: '../../etc/passwd', unit: 'Coins!', extra: { a: 1 } } });
  eq(e, { v: 1, at: '2026-10-08T01:02:03.000Z', actor: 'alice', action: 'secrets.put', target: 'o/lab', detail: { name: 'MS_PASSWORD', run: '123', ref: 'main', workflow: 'app.yml', inputs: ['mode', 'hold'] } });
  ok(!JSON.stringify(e).includes('hunter2') && !AU.commentBody(e).includes('hunter2'), 'no value');
  eq(AU.entry({ actor: 'a', action: 'dispatch', detail: { ref: `ghp_${'abcdefghijklmnopqrstuvwxyz0123'}`, name: 'GHP_OK', app: 'eyJhbGciOiJIUzI1NiJ9abcdefghijk.x' } }).detail, { name: 'GHP_OK' }, 'something shaped like a token: out, whatever its key');
  eq(AU.entry({ actor: 'a', action: 'variables', target: 'not a slug', detail: { name: 'LAB_NOTIFY' } }).target, '', 'a target that is not owner/repo: none');
  for (const bad of [{ actor: 'x y', action: 'dispatch' }, { actor: 'a', action: 'Drop Table' }, { actor: 'a', action: 'dispatch', at: 'yesterday' }, { action: 'dispatch' }]) {
    let threw = false; try { AU.entry(bad); } catch { threw = true; }
    ok(threw, JSON.stringify(bad));
  }
  const body = AU.commentBody(AU.entry({ actor: 'alice', action: 'dispatch', target: 'o/lab', detail: { workflow: 'app.yml', ref: 'x-->y<script>' } }));
  ok(/^\S+ `alice` ワークフローを始めた o\/lab `workflow=app\.yml`\n<!-- bdslab-audit \{.*\} -->$/.test(body) && (body.match(/-->/g) ?? []).length === 1 && !/@alice/.test(body), body);
  ok(!/<script>/.test(AU.commentBody(AU.entry({ actor: 'a', action: 'dispatch', detail: { file: 'a<b>.json' } }))), 'nothing that ends the HTML comment');
  const sneaky = AU.commentBody({ ...AU.entry({ actor: 'a', action: 'dispatch' }), detail: { ref: 'x --> <b>' } });
  ok((sneaky.match(/-->/g) ?? []).length === 1, `escaped even if handed in raw: ${sneaky}`);
});

await t('the audit log on GitHub: its issue found, or made once with its label; each record a comment by the person; read back — one written as someone else not counted, an edited one marked, GitHub\'s time (fake GitHub)', async () => {
  const f = await fakeGitHub();
  try {
    const alice = f.as('alice'), bob = f.as('bob'), mallory = f.as('mallory');
    eq(await AU.findAuditIssue(alice, 'o/lab'), null, 'none yet (looking never makes one)');
    eq(await AU.readAudit(alice, 'o/lab'), { issue: null, entries: [] });
    const looked = f.st.seen.length;
    await AU.record(alice, 'o/lab', { actor: 'alice', action: 'secrets.put', target: 'o/lab', detail: { name: 'MS_PASSWORD', value: 'hunter2' } });
    await AU.record(alice, 'o/lab', { actor: 'alice', action: 'dispatch', target: 'o/lab', detail: { workflow: 'app.yml', ref: 'main' } });
    eq([f.st.issues.length, [...f.st.labels], f.st.issues[0].title, f.st.issues[0].labels], [1, [AU.AUDIT_LABEL], AU.AUDIT_TITLE, [{ name: AU.AUDIT_LABEL }]], 'one issue, with its label');
    ok(f.st.issues[0].locked === true && f.st.seen.filter((s) => s.m === 'PUT' && s.u === '/repos/o/lab/issues/10/lock' && s.body === '').length === 1, 'locked once, no reason given: only collaborators comment');
    eq(f.st.seen.slice(looked).filter((s) => s.m === 'GET' && /labels=/.test(s.u)).length, 1, 'found once, then remembered');
    await AU.record(bob, 'o/lab', { actor: 'bob', action: 'run.cancel', target: 'o/lab', detail: { run: 77 } });
    eq(f.st.issues.length, 1, 'another person finds the same issue');
    // mallory writes an entry as alice: GitHub says mallory wrote it
    await AU.record(mallory, 'o/lab', { actor: 'alice', action: 'secrets.delete', target: 'o/lab', detail: { name: 'MS_EMAIL' } });
    await mallory.comment('o/lab', 10, 'just a comment');
    await mallory.comment('o/lab', 10, `quoting: ${AU.commentBody(AU.entry({ actor: 'bob', action: 'lend' }))}`);
    // bob's entry edited later
    const c = f.st.comments[10];
    c[2].updated_at = new Date(Date.parse(c[2].updated_at) + 5000).toISOString();
    const { issue, entries } = await AU.readAudit(alice, 'o/lab');
    eq(issue, 10);
    eq(entries.map((e) => [e.actor, e.by, e.action, e.edited]), [['alice', 'alice', 'secrets.put', false], ['alice', 'alice', 'dispatch', false], ['bob', 'bob', 'run.cancel', true]], 'mallory\'s "alice" not counted; bob\'s edit marked');
    eq(entries[0].at, c[0].created_at, 'GitHub\'s time, not the one written');
    eq(entries[0].detail, { name: 'MS_PASSWORD' });
    ok(!JSON.stringify(f.st.comments).includes('hunter2'), 'the secret\'s value never on GitHub');
    // a second issue made by a race: both read
    await mallory.createLabel('o/lab', { name: AU.AUDIT_LABEL });
    const second = await f.as('bob').createIssue('o/lab', { title: AU.AUDIT_TITLE, labels: [AU.AUDIT_LABEL] });
    await bob.comment('o/lab', second.number, AU.commentBody(AU.entry({ actor: 'bob', action: 'variables', target: 'o/lab', detail: { name: 'LAB_NOTIFY' } })));
    const both = await AU.readAudit(alice, 'o/lab');
    eq([both.issue, both.entries.length, both.entries.at(-1).action], [10, 4, 'variables']);
    // a title look-alike without the label is not the log
    f.st.issues.push({ number: 99, title: AU.AUDIT_TITLE, state: 'open', labels: [], user: { login: 'mallory' } });
    eq(await AU.findAuditIssue(f.as('bob'), 'o/lab'), 10);
  } finally { f.close(); }
});

await t('the log\'s issues: at ROTATE_AT comments the full one is closed and the next made (its title numbered, locked, pointing back), anyone then finds the new one; a close refused never sends a record back to the full one; a lock refused said, the record kept; every issue read (fake GitHub)', async () => {
  const f = await fakeGitHub();
  try {
    const alice = f.as('alice'), seed = (n, count) => {
      for (let i = 0; i < count; i++) { const at = new Date(f.st.clock += 1000).toISOString(); (f.st.comments[n] ??= []).push({ id: 5000 + i, body: AU.commentBody(AU.entry({ actor: 'alice', action: 'dispatch', target: 'o/lab', detail: { run: i } })), user: { login: 'alice' }, created_at: at, updated_at: at }); }
    };
    eq(AU.ROTATE_AT, 900);
    await AU.record(alice, 'o/lab', { actor: 'alice', action: 'dispatch', target: 'o/lab' });
    seed(10, AU.ROTATE_AT - 2);
    await AU.record(alice, 'o/lab', { actor: 'alice', action: 'dispatch', target: 'o/lab' });
    eq([f.st.comments[10].length, f.st.issues.length], [AU.ROTATE_AT, 1], 'up to ROTATE_AT in one issue (looked at again before each record)');
    const r = await AU.record(alice, 'o/lab', { actor: 'alice', action: 'run.cancel', target: 'o/lab', detail: { run: 5 } });
    ok(!r.why, 'locked: nothing to say');
    const [old, next] = f.st.issues;
    eq([old.state, next.number, next.title, next.state, next.locked, next.labels, f.st.comments[11].length, f.st.comments[10].length], ['closed', 11, `${AU.AUDIT_TITLE} 2`, 'open', true, [{ name: AU.AUDIT_LABEL }], 1, AU.ROTATE_AT], 'the full one closed, the next made and written to');
    ok(/前の記録: #10/.test(next.body), next.body);
    const made = f.st.seen.map((s, i) => (s.m === 'POST' && s.u === '/repos/o/lab/issues' ? i : -1)).filter((i) => i >= 0), closed = f.st.seen.findIndex((s) => s.m === 'PATCH' && s.u === '/repos/o/lab/issues/10');
    ok(made.length === 2 && closed > made[1] && JSON.parse(f.st.seen[closed].body).state === 'closed', 'closed only once the next is there');
    eq(await AU.findAuditIssue(f.as('bob'), 'o/lab'), 11, 'anyone finds the new one');
    await AU.record(f.as('bob'), 'o/lab', { actor: 'bob', action: 'variables', target: 'o/lab', detail: { name: 'LAB_NOTIFY' } });
    eq(f.st.comments[11].length, 2);
    const all = await AU.readAudit(alice, 'o/lab');
    eq([all.issue, all.entries.length, all.entries.at(-1).actor, all.entries.filter((e) => e.action === 'run.cancel').length], [11, AU.ROTATE_AT + 2, 'bob', 1], 'every issue read, the full one to its end');
    // the next one full too, its close and the new one's lock refused: the record kept, said why; the full one passed by
    seed(11, AU.ROTATE_AT - 2);
    f.st.closeStatus = 403; f.st.lockStatus = 403;
    const carol = f.as('mallory');
    const r2 = await AU.record(carol, 'o/lab', { actor: 'mallory', action: 'dispatch', target: 'o/lab' });
    ok(/監査の issue #12 をロックできません/.test(r2.why) && !/tok-|Bearer/.test(r2.why), r2.why);
    eq([f.st.issues.map((i) => [i.number, i.state, i.title]), f.st.comments[12].length], [[[10, 'closed', AU.AUDIT_TITLE], [11, 'open', `${AU.AUDIT_TITLE} 2`], [12, 'open', `${AU.AUDIT_TITLE} 3`]], 1], 'the record in the new one; the full one left open');
    eq(await AU.findAuditIssue(f.as('bob'), 'o/lab'), 12, 'a full one left open is never chosen again');
    await AU.record(f.as('bob'), 'o/lab', { actor: 'bob', action: 'dispatch', target: 'o/lab' });
    eq([f.st.comments[11].length, f.st.comments[12].length, f.st.issues.length], [AU.ROTATE_AT, 2, 3], 'not back to the full one, no other made');
    eq((await AU.readAudit(alice, 'o/lab')).entries.length, 2 * AU.ROTATE_AT + 2);
  } finally { f.close(); }
});

await t('CSV: RFC 4180 (CRLF, quoted when needed, " doubled); a value a spreadsheet would read as a formula gets a \' first; filters by who, what, since (pure)', () => {
  const es = [
    { at: '2026-10-08T00:00:00.000Z', actor: 'alice', action: 'dispatch', target: 'o/lab', detail: { workflow: 'app.yml', inputs: ['mode', 'hold'] }, edited: false, url: 'https://github.com/o/lab/issues/10#issuecomment-1' },
    { at: '2026-10-09T00:00:00.000Z', actor: 'Bob', action: 'secrets.delete', target: '', detail: { name: 'MS_EMAIL' }, edited: true, url: '' },
    { at: '=HYPERLINK("http://x")', actor: '+1', action: '-2', target: '@SUM(A1)', detail: {}, edited: false, url: '\tx' },
    { at: '2026-10-10T00:00:00.000Z', actor: 'carol', action: 'secrets.put', target: 'a,"b"\nc', detail: { ref: '＝1+1' }, edited: false, url: '' },
  ];
  const csv = AU.toCsv(es), rows = csv.split('\r\n');
  eq(rows[0], AU.CSV_COLUMNS.join(','));
  eq(rows[1], '2026-10-08T00:00:00.000Z,alice,dispatch,o/lab,"workflow=app.yml inputs=mode,hold",,https://github.com/o/lab/issues/10#issuecomment-1');
  eq(rows[2], '2026-10-09T00:00:00.000Z,Bob,secrets.delete,,name=MS_EMAIL,edited,');
  eq(rows[3], '"\'=HYPERLINK(""http://x"")",\'+1,\'-2,\'@SUM(A1),,,\'\tx');
  ok(csv.includes('"a,""b""\nc"') && csv.includes('ref=＝1+1') && csv.endsWith('\r\n'), csv);
  eq(AU.toCsv([{ at: 'x', actor: 'a', action: 'dispatch', target: '', detail: { ref: '=cmd' } }]).split('\r\n')[1].split(',')[4], 'ref==cmd', 'a detail cell starts with its key');
  const full = AU.toCsv([{ at: 'x', actor: '＝1', action: 'a', target: '', detail: {} }]);
  ok(full.includes(",'＝1,"), 'full-width = too');
  eq(AU.filter(es.slice(0, 2), { actor: 'bob' }).length, 1, 'any case');
  eq(AU.filter([...es.slice(0, 2), es[3]], { action: 'secrets' }).map((e) => e.action), ['secrets.delete', 'secrets.put'], 'secrets = put and delete');
  eq(AU.filter([...es.slice(0, 2), es[3]], { since: '2026-10-09' }).map((e) => e.actor), ['Bob', 'carol']);
  eq(AU.filter(es.slice(0, 2), {}).length, 2);
});

// ---- a small DOM: enough for panel/ui/dom.mjs's h and the tab ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    click() { return this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}

await t('the 「監査」 tab: for a role the policy lets read it — the entries, narrowed by who / what / since, the edited ones marked, taken away as a CSV made in the page; another role told it may not (fake DOM, fake GitHub)', async () => {
  const { E } = fakeDom();
  const UI = await imp('panel/ui/audit.mjs');
  const f = await fakeGitHub();
  const made = [], real = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = (b) => { made.push(b); return 'blob:fake/1'; }; URL.revokeObjectURL = () => {};
  try {
    const alice = f.as('alice');
    await AU.record(alice, 'o/lab', { actor: 'alice', action: 'dispatch', target: 'o/lab', detail: { workflow: 'app.yml' } });
    await AU.record(f.as('bob'), 'o/lab', { actor: 'bob', action: 'secrets.put', target: 'o/lab', detail: { name: 'MS_PASSWORD' } });
    await AU.record(f.as('bob'), 'o/lab', { actor: 'bob', action: 'secrets.delete', target: 'o/lab', detail: { name: 'MS_EMAIL' } });
    f.st.comments[10][1].updated_at = '2030-01-01T00:00:00Z';
    const lab = { slug: 'o/lab', repo: { visibility: 'private', permissions: { push: true } } };
    const body = new E('div');
    await UI.auditTab(body, { api: alice, lab });
    const rows = () => body.all((e) => e.tagName === 'TR').slice(1).map((r) => r.textContent);
    eq(rows().length, 3);
    ok(rows()[0].startsWith('2026-10-08 00:03:00bob秘密を消した') && /✎ 編集あり/.test(rows()[1]), rows().join('\n'));
    ok(/issue「bds-lab 監査ログ」/.test(body.textContent) && /3 件（全部で 3 件）/.test(body.textContent), body.textContent);
    const [who, what] = body.all((e) => e.tagName === 'SELECT');
    eq(who.all((e) => e.tagName === 'OPTION').map((o) => o.value), ['', 'alice', 'bob']);
    who.value = 'bob'; await who.fire('change');
    eq(rows().length, 2);
    what.value = 'secrets.put'; await what.fire('change');
    eq(rows().length, 1);
    await body.all((e) => e.tagName === 'BUTTON' && /CSV/.test(e.textContent))[0].click();
    const bytes = new Uint8Array(await made[0].arrayBuffer()), text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    ok(made.length === 1 && made[0].type === 'text/csv;charset=utf-8' && text.startsWith('\ufeffat,actor,') && text.split('\r\n').length === 3 && text.includes(',bob,secrets.put,o/lab,name=MS_PASSWORD,edited,'), `the shown ones, a BOM first: ${JSON.stringify(text)}`);
    ok(!globalThis.document.body.kids.length, 'the download link gone again');
    // the policy's role may not read it
    const policy = P.checkPolicy({ roles: { write: ['dispatch'] } }).policy, denied = new E('div');
    await UI.auditTab(denied, { api: alice, lab, policy, role: P.roleFor({ repoRole: 'write', policy }) });
    ok(/見られません/.test(denied.textContent) && !denied.all((e) => e.tagName === 'TABLE').length, denied.textContent);
    // no role handed in and a policy with teams: teams not known, the narrowest (an auditors' team cannot widen a writer)
    const teamed = P.checkPolicy({ roles: { write: ['dispatch'], auditor: ['audit.read'] }, teams: { auditors: 'auditor' } }).policy, guess = new E('div');
    await UI.auditTab(guess, { api: alice, lab, policy: teamed });
    ok(/見られません/.test(guess.textContent), guess.textContent);
    // a public lab: not recording by default, said so
    const pub = new E('div');
    await UI.auditTab(pub, { api: alice, lab: { ...lab, repo: { ...lab.repo, visibility: 'public' } } });
    ok(/記録していません/.test(pub.textContent), pub.textContent);
  } finally { URL.createObjectURL = real.create; URL.revokeObjectURL = real.revoke; f.close(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
