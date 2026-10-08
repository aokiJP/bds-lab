// the management panel's parts without a browser or a network (panel/lib/*.mjs are plain modules: Node runs them as the
// browser does): who may use it, what each repository's settings allow, the workflows' input forms from their real YAML,
// a run's progress, a host's rules (held equal to common/hosts.mjs) and minutes, the secret sealed as libsodium seals it
// (vectors made with libsodium itself), the live issue's lines sealed and read the same way as app/lib on the runner, the
// GitHub client against a fake API, the accounts of one browser (each its own token and settings), where a job runs (the lab or
// a lender's host: hostrun.yml), and the run's news to Discord with its deliverables (notify).
// node tests/panel-offline.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const M = await imp('panel/lib/model.mjs'), SEAL = await imp('panel/lib/seal.mjs'), PV = await imp('panel/lib/vault.mjs'), LF = await imp('panel/lib/livefmt.mjs'), G = await imp('panel/lib/gh.mjs');
const H = await imp('common/hosts.mjs'), AV = await imp('app/lib/vault.mjs'), AL = await imp('app/lib/live.mjs'), PG = await imp('panel/lib/pages.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const hex = (b) => Buffer.from(b).toString('hex');

await t('who may use it: write or admin on the lab, or lend (admin) / borrow (write) a host; anyone else is told why (pure)', () => {
  eq(M.roleOf({ admin: true }), 'admin'); eq(M.roleOf({ push: true }), 'write'); eq(M.roleOf({ maintain: true }), 'write'); eq(M.roleOf({ pull: true }), 'read'); eq(M.roleOf(null), null);
  eq(M.access({ lab: { permissions: { admin: true } } }), { ok: true, as: ['admin'], why: '' });
  eq(M.access({ lab: null, hosts: [{ permissions: { admin: true } }, { permissions: { push: true } }] }).as, ['lender', 'borrower']);
  const no = M.access({ lab: { permissions: { pull: true } }, hosts: [{ permissions: { pull: true } }] });
  ok(!no.ok && /書き込める人/.test(no.why) && /貸している/.test(no.why), JSON.stringify(no));
  ok(!M.access({ lab: null }).ok, 'nothing visible: no');
});

await t('what a repository\'s own settings allow: its secrets\' names and workflows; unknown when the token may not list secrets (pure)', () => {
  const wf = ['app.yml', 'notify.yml', 'secrets.yml', 'verify.yml', 'hostrun.yml', 'ai-make.yml'].map((f) => ({ path: `.github/workflows/${f}` }));
  const all = M.capabilities({ secrets: ['DISCORD_BOT_TOKEN', 'DISCORD_USER_ID', 'LAB_SECRETS_TOKEN', 'GOOGLE_EMAIL', 'GOOGLE_AAS_TOKEN', 'MS_EMAIL', 'APP_CACHE_KEY', 'LAB_HOST_TOKEN', 'ANTHROPIC_API_KEY'], workflows: wf, visibility: 'public' });
  ok(all.every((c) => c.ok === true && c.need === ''), JSON.stringify(all));
  // (AI makes an addon from an idea: ai-make.yml and an API key — Claude's or an OpenAI-compatible one)
  const mk = (sec, w = wf) => M.capabilities({ secrets: sec, workflows: w }).find((c) => c.key === 'make');
  ok(mk(['OPENAI_API_KEY']).ok === true && /ANTHROPIC_API_KEY/.test(mk([]).need) && /ai-make\.yml がありません/.test(mk(['ANTHROPIC_API_KEY'], wf.slice(0, 5)).need), JSON.stringify(mk([])));
  const bare = Object.fromEntries(M.capabilities({ secrets: ['DISCORD_BOT_TOKEN'], workflows: wf }).map((c) => [c.key, c]));
  ok(bare.discord.ok === false && /DISCORD_USER_ID/.test(bare.discord.need) && bare.notify.ok === false && /このパネルの「秘密」からなら/.test(bare.secretsForm.need), JSON.stringify(bare));
  const hook = Object.fromEntries(M.capabilities({ secrets: ['LAB_NOTIFY_WEBHOOK'], workflows: wf }).map((c) => [c.key, c]));
  ok(hook.notify.ok === true && hook.discord.ok === false, 'a webhook is enough for notify');
  ok(M.capabilities({ secrets: null, workflows: wf }).every((c) => c.ok === null && /Secrets: Read/.test(c.need)), 'not allowed to look: unknown, said why');
  ok(M.capabilities({ secrets: [], workflows: [{ path: '.github/workflows/host.yml' }], host: true })[0].ok === true, 'a host: host.yml');
  for (const k of Object.keys(M.KNOWN_SECRETS)) ok(/^[A-Z_]+$/.test(k), k);
});

await t('the workflows\' inputs from their real YAML: choices, booleans, defaults; every preset names inputs its workflow has (pure)', () => {
  const y = (f) => fs.readFileSync(path.join(TOP, '.github', 'workflows', f), 'utf8');
  const app = M.dispatchInputs(y('app.yml')), by = Object.fromEntries(app.inputs.map((i) => [i.name, i]));
  ok(app.dispatch && by.mode.options.join() === 'run,ui,ui-all,hold' && by.mode.default === 'run' && by.account.type === 'boolean' && by.account.default === 'true' && by.hold.default === '0' && /hold/.test(by.hold.description), JSON.stringify(by.mode));
  eq(M.dispatchInputs(y('secrets.yml')).inputs.map((i) => [i.name, i.default]), [['names', 'MS_EMAIL,MS_PASSWORD'], ['minutes', '10']]);
  eq(M.dispatchInputs(y('verify.yml')), { dispatch: true, inputs: [] });
  eq(M.dispatchInputs('on:\n  push:\n    branches: [main]\n'), { dispatch: false, inputs: [] });
  eq(M.dispatchInputs('on: [push, workflow_dispatch]\n').dispatch, true);
  const inline = M.dispatchInputs("on:\n  workflow_dispatch:\n    inputs:\n      a: { description: 'x, y', default: 'q', type: choice, options: [q, r] }\n      b:\n        type: boolean\n        options:\n          - one\n          - 'two'\n");
  eq(inline.inputs.map((i) => [i.name, i.type, i.default, i.options]), [['a', 'choice', 'q', ['q', 'r']], ['b', 'boolean', '', ['one', 'two']]]);
  for (const p of M.PRESETS) {
    const f = path.join(TOP, '.github', 'workflows', p.workflow);
    ok(fs.existsSync(f), `${p.workflow} exists`);
    const names = M.dispatchInputs(fs.readFileSync(f, 'utf8')).inputs.map((i) => i.name);
    for (const k of Object.keys(p.inputs)) ok(names.includes(k), `${p.id}: ${p.workflow} has ${k} (${names.join(' ')})`);
  }
  eq(M.dispatchBody(app.inputs, { mode: 'hold', hold: 60, account: false, addon: '', screen: undefined }), { mode: 'hold', account: 'false', hold: '60' }, 'strings; booleans as words; empty ones left to their default');
});

await t('a run\'s progress from its jobs and steps; durations and ages in words (pure)', () => {
  const run = { status: 'in_progress', run_started_at: '2026-10-08T00:00:00Z', created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z' };
  const jobs = [{ name: 'prep', status: 'completed', conclusion: 'success', steps: [{ status: 'completed' }, { status: 'completed' }] }, { name: 'device', status: 'in_progress', steps: [{ status: 'completed' }, { status: 'in_progress', name: '端末を作る' }, { status: 'queued' }] }];
  const p = M.progress(run, jobs, Date.parse('2026-10-08T00:02:30Z'));
  eq([p.state, p.done, p.total, p.pct, p.now, p.ms], ['in_progress', 3, 5, 60, '端末を作る', 150_000]);
  eq(p.jobs.map((j) => [j.name, j.state, j.done, j.total]), [['prep', 'success', 2, 2], ['device', 'in_progress', 1, 3]]);
  eq(M.progress({ ...run, status: 'completed', conclusion: 'failure' }, jobs).pct, 100);
  eq([M.fmtMs(42_000), M.fmtMs(125_000), M.fmtMs(3_725_000)], ['42 秒', '2 分 5 秒', '1 時間 2 分']);
  eq(M.ago('2026-10-08T00:00:00Z', Date.parse('2026-10-08T02:00:00Z')), '2 時間前');
});

await t('hosts: the rules checked exactly as common/hosts.mjs checks them; the minutes of a month from the host\'s runs; pause / resume by `until` (pure)', () => {
  const samples = [null, 'x', {}, { minutesPerMonth: 600, jobs: ['gate'] }, { minutesPerMonth: 0, jobs: ['gate'] }, { minutesPerMonth: 600, jobs: ['make'] }, { minutesPerMonth: 600, jobs: [] },
    { minutesPerMonth: 600, jobs: ['gate', 'test'], hours: '22:00-06:00', timezone: 'Asia/Tokyo', until: '2027-03-31', contact: 'me' }, { minutesPerMonth: 600, jobs: ['gate'], hours: '25:00-26:00' },
    { minutesPerMonth: 600, jobs: ['gate'], timezone: 'Mars/Base' }, { minutesPerMonth: 600, jobs: ['gate'], until: 'tomorrow' }, { minutesPerMonth: 1.5, jobs: ['gate'] }, { minutesPerMonth: 600, jobs: ['gate'], contact: 'x'.repeat(201) }];
  for (const s of samples) eq(M.checkRules(s), H.checkRules(s), JSON.stringify(s));
  eq(M.HOST_JOBS, Object.keys(H.JOBS)); eq(M.STOP_AT, H.STOP_AT);
  const now = new Date('2026-10-08T03:00:00Z');
  for (const [hours, tz] of [['00:00-24:00', 'UTC'], ['22:00-06:00', 'Asia/Tokyo'], ['09:00-17:00', 'Asia/Tokyo'], ['12:00-12:00', 'UTC']]) eq(M.within(hours, tz, now), H.within(hours, tz, now), hours);
  eq(M.monthOf(now, 'Asia/Tokyo'), H.monthOf(now, 'Asia/Tokyo'));
  const runs = [{ status: 'completed', run_started_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:10:30Z' }, { status: 'completed', run_started_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:20Z' },
    { status: 'in_progress', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:30:00Z' }, { status: 'completed', run_started_at: '2026-09-30T23:00:00Z', updated_at: '2026-09-30T23:30:00Z' }];
  eq(M.monthMinutes(runs, '2026-10', 'UTC'), 12, 'each run rounded up to its minute; this month only; finished only');
  eq(M.monthMinutes(runs, '2026-10', 'Asia/Tokyo'), 42, 'the month in the host\'s time zone (the 30th 23:00 UTC is October in Tokyo)');
  const rules = M.checkRules({ minutesPerMonth: 100, jobs: ['gate'], until: '2026-10-31', timezone: 'UTC' }).rules;
  eq(M.hostNow(rules, 50, now).ok, true); ok(/80%/.test(M.hostNow(rules, 80, now).why.join()), 'stops at 80%'); ok(/期限/.test(M.hostNow({ ...rules, until: '2026-10-07' }, 0, now).why.join()), 'past its day');
  ok(/走っています/.test(M.hostNow(rules, 0, now, true).why.join()), 'one at a time');
  const paused = M.pauseRules({ minutesPerMonth: 100, jobs: ['gate'], until: '2027-01-01' }, now, 'UTC');
  eq(paused.until, '2026-10-07'); ok(!M.hostNow(M.checkRules(paused).rules, 0, now).ok, 'paused: not usable'); ok(!H.canRun({ slug: 'a/b', rules: M.checkRules(paused).rules }, 'gate', [], now).ok, 'and the borrower\'s lab agrees');
  eq(M.resumeRules(paused, '2026-12-31').until, '2026-12-31');
});

await t('accounts: several in one browser, each with its own token and settings; one in use; a remembered one in localStorage, another in this tab only; the old single token moved in (pure)', async () => {
  const AC = await imp('panel/lib/accounts.mjs');
  const local = AC.memoryStorage(), session = AC.memoryStorage(), D = { lab: 'aokiJP/bds-lab' };
  const A = AC.accounts({ local, session, defaults: D });
  eq([A.list(), A.active()], [[], null]);
  A.add({ login: 'author1', avatar: 'https://avatars.githubusercontent.com/u/1', token: 'tok-a', remember: true, cfg: { lab: 'author1/bds-lab' } });
  A.add({ login: 'lender1', avatar: 'javascript:alert(1)', token: 'tok-l', remember: false, cfg: { lab: 'not a slug', hosts: ['lender1/host', 'bad slug', 'lender1/host'] } });
  eq(A.list().map((e) => [e.login, e.remember, e.avatar]), [['author1', true, 'https://avatars.githubusercontent.com/u/1'], ['lender1', false, '']], 'listed; an avatar address that is not https is dropped');
  eq(A.active(), 'lender1', 'the one just added is in use');
  eq([A.token('author1'), A.token('lender1')], ['tok-a', 'tok-l']);
  eq(A.cfg('lender1'), { lab: 'aokiJP/bds-lab', hosts: ['lender1/host'], refresh: 20, vault: '' }, 'its own settings, cleaned (a wrong lab: the default)');
  A.setCfg('author1', { hosts: ['lender1/host'], vault: 'k', refresh: 1 });
  eq(A.cfg('author1'), { lab: 'author1/bds-lab', hosts: ['lender1/host'], refresh: 5, vault: 'k' });
  eq(A.cfg('lender1').vault, '', 'one account\'s settings are not another\'s');
  ok(A.use('author1') && A.active() === 'author1' && !A.use('nobody') && A.active() === 'author1', 'switched; an unknown one is not');
  const dump = (st) => Array.from({ length: st.length }, (_, i) => st.key(i)).map((k) => `${k}=${st.getItem(k)}`).join('\n');
  ok(dump(local).includes('tok-a') && !dump(local).includes('tok-l') && dump(session).includes('tok-l'), `the remembered one in localStorage, the other in this tab only\n${dump(local)}\n--\n${dump(session)}`);
  const A2 = AC.accounts({ local, session: AC.memoryStorage(), defaults: D });
  eq([A2.list().map((e) => e.login), A2.active()], [['author1'], 'author1'], 'a new tab: the tab-only one is gone');
  A.add({ login: 'author1', token: 'tok-a2', remember: true });
  eq([A.token('author1'), A.cfg('author1').vault, A.list().length], ['tok-a2', 'k', 2], 'signed in again: the token replaced, the settings kept');
  eq(A.remove('author1'), 'lender1', 'forgotten: the next one in use');
  ok(!/tok-a|author1/.test(dump(local)), `its token and settings gone\n${dump(local)}`);
  // the panel before accounts: one token (this tab: as it was typed; the browser: JSON), the settings without a login
  const l2 = AC.memoryStorage(), s2 = AC.memoryStorage();
  l2.setItem('bdslab.panel.lab', JSON.stringify('o/lab')); l2.setItem('bdslab.panel.hosts', JSON.stringify(['o/h'])); l2.setItem('bdslab.panel.vault', JSON.stringify('v'));
  s2.setItem('bdslab.panel.token', 'github_pat_raw');
  const A3 = AC.accounts({ local: l2, session: s2 });
  eq(A3.legacy(), { token: 'github_pat_raw', remember: false, cfg: { lab: 'o/lab', hosts: ['o/h'], refresh: 20, vault: 'v' } });
  l2.setItem('bdslab.panel.token', JSON.stringify('ghp_kept')); s2.removeItem('bdslab.panel.token');
  eq([A3.legacy().token, A3.legacy().remember], ['ghp_kept', true]);
  A3.dropLegacy(); eq([A3.legacy(), l2.getItem('bdslab.panel.vault')], [null, null]);
  let threw = false; try { A.add({ login: '../x', token: 't' }); } catch { threw = true; }
  ok(threw, 'a login GitHub would not give is refused');
});

await t('where a job runs: this lab or a lender\'s host — hostrun.yml\'s inputs from the host\'s own rules, the host with the most minutes left, GitHub\'s count of the month the same here and in the lab; the address of a tab or a run (pure)', () => {
  const rules = M.checkRules({ minutesPerMonth: 600, jobs: ['gate', 'go'] }).rules;
  eq(M.hostRunInputs({ host: 'l/h', job: 'go', unit: 'coins', wait: false, rules }), { inputs: { host: 'l/h', job: 'go', unit: 'coins', wait: 'false' } });
  eq(M.hostRunInputs({ host: 'l/h', job: 'gate', unit: 'ignored', rules }).inputs, { host: 'l/h', job: 'gate', unit: '', wait: 'true' });
  ok(/許されていません/.test(M.hostRunInputs({ host: 'l/h', job: 'sim', unit: 'x', rules }).error), 'a job the lender did not allow');
  ok(/ユニット/.test(M.hostRunInputs({ host: 'l/h', job: 'go', unit: '../x', rules }).error), 'a unit\'s name only');
  ok(/ホスト/.test(M.hostRunInputs({ host: 'nope', job: 'gate', rules }).error) && /読めません/.test(M.hostRunInputs({ host: 'l/h', job: 'gate', rules: null }).error));
  const hr = M.dispatchInputs(fs.readFileSync(path.join(TOP, '.github', 'workflows', 'hostrun.yml'), 'utf8'));
  eq(hr.inputs.map((i) => i.name), ['host', 'job', 'unit', 'wait'], 'the panel sends what hostrun.yml takes');
  eq([hr.inputs[1].options, hr.inputs[3].type], [M.HOST_JOBS, 'boolean'], 'its jobs are the host\'s jobs');
  eq(M.bestHost([{ slug: 'a/x', now: { ok: true, remaining: 10 } }, { slug: 'b/y', now: { ok: true, remaining: 90 } }, { slug: 'c/z', now: { ok: false, remaining: 500 } }]).slug, 'b/y');
  eq(M.bestHost([{ slug: 'c/z', now: { ok: false, remaining: 500 } }]), null);
  const cap = (sec) => M.capabilities({ secrets: sec, workflows: [{ path: '.github/workflows/hostrun.yml' }] }).find((c) => c.key === 'hostrun');
  ok(cap(['LAB_HOST_TOKEN']).ok === true && cap([]).ok === false && /LAB_HOST_TOKEN/.test(cap([]).need), JSON.stringify(cap([])));
  const runs = [{ status: 'completed', run_started_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:10:30Z' }, { status: 'in_progress', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:30:00Z' }, { status: 'completed', run_started_at: '2026-09-30T23:00:00Z', updated_at: '2026-09-30T23:30:00Z' }];
  for (const tz of ['UTC', 'Asia/Tokyo']) eq(M.monthMinutes(runs, '2026-10', tz), H.monthMinutes(runs, '2026-10', tz), tz);
  eq(H.githubUse(runs, new Date('2026-10-08T03:00:00Z'), 'UTC'), { month: '2026-10', used: 11, running: true });
  eq(M.parseHash('#runs?repo=aokiJP%2Fbds-lab&run=123'), { tab: 'runs', repo: 'aokiJP/bds-lab', run: '123' });
  eq(M.parseHash('#discord'), { tab: 'discord', repo: null, run: null });
  eq(M.parseHash('#runs?repo=..%2Fx%2Fy&run=1;alert(1)'), { tab: 'runs', repo: null, run: null }, 'anything else in the address is nothing');
  eq(M.parseHash('#<img>'), { tab: null, repo: null, run: null });
  eq([M.fmtBytes(512), M.fmtBytes(1_234_567)], ['512 B', '1.2 MB']);
  ok(M.DISCORD_ID.test('123456789012345678') && !M.DISCORD_ID.test('12345') && !M.DISCORD_ID.test('1234567890123456789x'));
});

await t('members: GitHub\'s roles read and changed (never the owner, never oneself), an unknown name said before anything is sent; the policy as a grid and back, checked, admin always all (pure + a fake GitHub)', async () => {
  const MB = await imp('panel/lib/members.mjs'), P = await imp('panel/lib/policy.mjs');
  eq(MB.memberOf({ login: 'a', role_name: 'write', avatar_url: 'javascript:x' }), { login: 'a', avatar: '', permission: 'push', role: 'write' });
  eq(MB.memberOf({ login: 'b', permissions: { admin: true } }).permission, 'admin');
  ok(!MB.canChange({ login: 'Owner' }, { owner: 'owner', me: 'x' }).ok && !MB.canChange({ login: 'me' }, { owner: 'o', me: 'ME' }).ok && MB.canChange({ login: 'c' }, { owner: 'o', me: 'me' }).ok, 'the owner and oneself are not changed here');
  const calls = [], api = { call: async (m, path, body) => { calls.push(`${m} ${path}${body ? ' ' + JSON.stringify(body) : ''}`);
    if (path === '/users/ghost') throw Object.assign(new Error('nf'), { status: 404 });
    if (m === 'PUT' && path.endsWith('/newbie')) return { id: 77 };
    if (m === 'GET' && path.includes('/collaborators')) return [{ login: 'o', permissions: { admin: true } }, { login: 'w', role_name: 'write' }];
    if (m === 'GET' && path.includes('/invitations')) return [{ id: 5, invitee: { login: 'newbie' }, permissions: 'write', created_at: 'x' }];
    return null; } };
  eq(await MB.setMember(api, 'o/lab', 'newbie', 'admin'), 'invited'); eq(await MB.setMember(api, 'o/lab', 'w', 'pull'), 'changed');
  let e = ''; try { await MB.setMember(api, 'o/lab', 'ghost', 'push'); } catch (x) { e = x.message; } ok(/いません/.test(e) && !calls.some((c) => c.startsWith('PUT') && c.includes('ghost')), `unknown: nothing sent\n${calls.join('\n')}`);
  e = ''; try { await MB.setMember(api, 'o/lab', '../x', 'push'); } catch (x) { e = x.message; } ok(/ユーザー名/.test(e), e);
  ok(calls.includes('PUT /repos/o/lab/collaborators/newbie {"permission":"admin"}'), calls.join('\n'));
  const m = await MB.readMembers(api, 'o/lab', { owner: { login: 'o' } });
  eq([m.owner, m.members.map((x) => x.permission), m.invitations[0]], ['o', ['admin', 'push'], { id: 5, login: 'newbie', permission: 'push', at: 'x' }]);
  // the grid and back: admin always '*', the roles a team names kept, the checked file
  const pol = P.checkPolicy({ roles: { admin: ['*'], write: ['dispatch'], auditor: ['audit.read'] }, teams: { aud: 'auditor' }, confirm: ['dispatch'], idleMinutes: 30, audit: 'issue' }).policy;
  const g = MB.gridOf(pol);
  eq([g.roles.admin.length, g.roles.write, g.confirm, g.extra], [P.ACTIONS.length, ['dispatch'], ['dispatch'], { auditor: ['audit.read'] }]);
  g.roles.write = ['dispatch', 'run.cancel']; g.roles.admin = [];
  const back = MB.policyOf(g);
  eq([back.errors, back.json.roles, back.json.teams], [[], { auditor: ['audit.read'], write: ['dispatch', 'run.cancel'], admin: ['*'] }, { aud: 'auditor' }]);
  ok(P.can(P.checkPolicy(back.json).policy, 'write', 'run.cancel') && !P.can(P.checkPolicy(back.json).policy, 'write', 'members') && P.can(P.checkPolicy(back.json).policy, 'admin', 'members'), 'members: admins only');
  ok(!P.can(P.DEFAULT_POLICY, 'write', 'members'), 'GitHub first: no writer changes members, whatever a policy says');
  const lab = JSON.parse(fs.readFileSync(path.join(TOP, '.github', 'bds-lab-panel.json'), 'utf8')), lp = P.checkPolicy(lab);
  ok(!lp.errors.length && P.can(lp.policy, 'admin', 'members') && !P.can(lp.policy, 'write', 'dispatch') && !P.can(lp.policy, 'maintain', 'secrets.put'), `this lab: its owner alone ${JSON.stringify(lp.errors)}`);
});

await t('runs found as typed (name, title, branch, who), failed / going / mine; a run that ended since the last look (pure)', () => {
  const rs = [{ id: 1, name: 'verify', head_branch: 'main', status: 'completed', conclusion: 'failure', triggering_actor: { login: 'me' } }, { id: 2, name: 'app', display_title: 'hold 60', head_branch: 'dev', status: 'in_progress', actor: { login: 'you' } }, { id: 3, name: 'notify', head_branch: 'main', status: 'completed', conclusion: 'success', actor: { login: 'me' } }];
  eq(M.filterRuns(rs, { q: 'HOLD' }).map((r) => r.id), [2]); eq(M.filterRuns(rs, { q: 'main' }).map((r) => r.id), [1, 3]);
  eq([M.filterRuns(rs, { show: 'failed' }).map((r) => r.id), M.filterRuns(rs, { show: 'going' }).map((r) => r.id), M.filterRuns(rs, { show: 'mine', me: 'me' }).map((r) => r.id)], [[1], [2], [1, 3]]);
  const was = new Map([[1, 'completed'], [2, 'in_progress']]);
  eq(M.endedSince(was, [{ ...rs[1], status: 'completed', conclusion: 'success' }, rs[0], { id: 9, status: 'completed' }]).map((r) => r.id), [2], 'only one seen going and ended now');
});

await t('each workflow\'s health, a secret\'s age, the keys, the role presets and the invitation\'s address (pure)', async () => {
  const MB = await imp('panel/lib/members.mjs'), P = await imp('panel/lib/policy.mjs');
  const at = (m) => `2026-10-0${m}T00:00:00Z`, run = (id, path, conclusion, d = 1, mins = 2) => ({ id, name: path.split('.')[0], path, status: 'completed', conclusion, run_started_at: at(d), created_at: at(d), updated_at: new Date(Date.parse(at(d)) + mins * 60_000).toISOString() });
  const rs = [run(1, 'verify.yml', 'failure', 5, 4), run(2, 'verify.yml', 'timed_out', 4, 60), run(3, 'verify.yml', 'success', 3, 3), run(4, 'go.yml', 'success', 5, 10), run(5, 'go.yml', 'cancelled', 4), { id: 6, path: 'go.yml', name: 'go', status: 'in_progress' }, run(7, 'notify.yml', 'cancelled')];
  const hs = M.workflowHealth(rs), v = hs[0], g = hs.find((x) => x.path === 'go.yml');
  ok(v.path === 'verify.yml' && v.streak === 2 && v.ok === 1 && v.bad === 2 && Math.abs(v.rate - 1 / 3) < 1e-9 && v.ms === 4 * 60_000 && v.last.id === 1, JSON.stringify(v));
  ok(g.rate === 1 && g.ok === 1 && g.streak === 0 && hs.find((x) => x.path === 'notify.yml').rate === null, JSON.stringify(hs));
  const now = Date.parse('2026-10-08T00:00:00Z');
  ok(M.secretAge('2026-10-01T00:00:00Z', now).days === 7 && !M.secretAge('2026-10-01T00:00:00Z', now).stale && M.secretAge('2026-01-01T00:00:00Z', now).stale && M.secretAge(undefined, now).days === null);
  const tabs = ['overview', 'runs', 'secrets'];
  eq([M.shortcut('2', tabs), M.shortcut('4', tabs), M.shortcut('/', tabs), M.shortcut('r', tabs), M.shortcut('?', tabs), M.shortcut('x', tabs)], [{ tab: 'runs' }, null, { search: true }, { reload: true }, { help: true }, null]);
  const base = MB.gridOf(P.checkPolicy({ version: 1, roles: { admin: ['*'], ops: ['dispatch'] }, teams: { oncall: 'ops' }, confirm: ['dispatch'], idleMinutes: 30, audit: 'issue' }).policy);
  for (const id of Object.keys(MB.POLICY_PRESETS)) {
    const grid = MB.applyPreset(base, id), back = MB.policyOf(grid);
    ok(!back.errors.length && grid.idleMinutes === 30 && grid.confirm.join() === 'dispatch' && back.json.teams.oncall === 'ops' && back.json.roles.ops.join() === 'dispatch' && back.json.roles.admin.join() === '*', `${id}: ${JSON.stringify(back)}`);
  }
  const team = P.checkPolicy(MB.policyOf(MB.applyPreset(base, 'team')).json).policy;
  ok(P.can(team, 'maintain', 'variables') && !P.can(team, 'maintain', 'secrets.put') && !P.can(team, 'maintain', 'members') && P.can(team, 'write', 'dispatch') && !P.can(team, 'write', 'variables'), 'team: all but secrets and members');
  const only = P.checkPolicy(MB.policyOf(MB.applyPreset(base, 'owner')).json).policy;
  ok(P.ACTIONS.every((a) => !P.can(only, 'maintain', a) && !P.can(only, 'write', a)), 'owner: nobody else');
  eq(MB.invitationUrl('o/lab'), 'https://github.com/o/lab/invitations');
});

await t('debug: the calls kept (a ring), the errors among them, whether this page is the newest published, a report with no token in it (pure)', async () => {
  const D = await imp('panel/lib/debug.mjs');
  let now = Date.parse('2026-10-08T01:02:03Z');
  const log = D.debugLog(3, () => now++);
  log.add({ method: 'GET', path: '/user', status: 200, ms: 5 }); log.add({ method: 'GET', path: '/repos/o/r/contents/x', status: 404, ms: 7 });
  log.add({ kind: 'error', message: 'boom', where: 'panel.js:3' }); log.add({ method: 'POST', path: '/repos/o/r/actions/runs/1/cancel', status: 0, ms: 9 });
  eq(log.list().map((e) => e.status ?? e.kind), [0, 'error', 404], 'the last three, newest first');
  eq(log.errors().length, 3);
  const P = 'a'.repeat(40), N = 'b'.repeat(40), run = (head_sha, status, conclusion) => ({ head_sha, status, conclusion });
  eq([D.versionState(null).state, D.versionState(P, []).state, D.versionState(P, [run(P, 'completed', 'success')]).state, D.versionState(P, [run(N, 'in_progress', null)]).state, D.versionState(P, [run(N, 'completed', 'success')]).state, D.versionState(P, [run(N, 'completed', 'failure')]).state],
    ['unknown', 'unknown', 'live', 'deploying', 'newer', 'failed']);
  ok(/bbbbbbb/.test(D.versionState(P, [run(N, 'completed', 'success')]).say), 'the new version named');
  const r = D.report({ version: P, url: 'https://x.github.io/bds-lab/#bdslab-auth=ghu_abcdefghijklmnop', agent: 'test', login: 'me', kind: 'oauth', lab: 'o/r', role: 'admin', tab: 'runs', remaining: 4999, log });
  ok(/✘ 届かない POST \/repos\/o\/r\/actions\/runs\/1\/cancel/.test(r) && /✘ boom \(panel\.js:3\)/.test(r) && /GitHub でサインイン/.test(r) && !/ghu_|#/.test(r.split('\n')[2]), r);
  eq(D.redact('a ghp_0123456789abcdef b github_pat_11AB_cd lab-sealed:v1:xyz'), 'a [消しました] b [消しました] [消しました]');
});

await t('a stranger lends: their own public fork of the lab becomes a host — host.yml as the lab has it, their rules, nothing else running there (pure)', async () => {
  const PC = await imp('common/panel-config.mjs'), { HOST_FILES } = await imp('panel/lib/hosttemplate.mjs');
  eq(fs.readFileSync(path.join(TOP, PC.HOST_MODULE), 'utf8'), PC.hostTemplateModule(), 'panel/lib/hosttemplate.mjs is host/template now (node common/panel-config.mjs --host-template)');
  eq(fs.readFileSync(path.join(TOP, '.github/workflows/host.yml'), 'utf8'), HOST_FILES['.github/workflows/host.yml'], 'the lab carries host.yml as the template has it: every fork is a host as it stands');
  const LAB = 'Owner/bds-lab', mine = { owner: { login: 'Lee' }, permissions: { admin: true }, private: false, visibility: 'public', fork: true, parent: { full_name: 'owner/bds-lab' } };
  ok(M.forkHostCheck(mine, 'lee', LAB).ok && !M.forkHostCheck(null, 'lee', LAB).ok, 'their own fork of this lab: yes; none: no');
  ok(/フォークだけ/.test(M.forkHostCheck({ ...mine, fork: false, parent: undefined }, 'lee', LAB).errors.join()) && /フォークだけ/.test(M.forkHostCheck({ ...mine, parent: { full_name: 'x/other' } }, 'lee', LAB).errors.join()), 'not a fork, or another lab\'s: never');
  ok(/あなた自身/.test(M.forkHostCheck({ ...mine, owner: { login: 'other' } }, 'lee', LAB).errors.join()) && /あなた自身/.test(M.forkHostCheck({ ...mine, permissions: { push: true } }, 'lee', LAB).errors.join()), 'another\'s fork: never (not even one they may write)');
  ok(/アーカイブ/.test(M.forkHostCheck({ ...mine, archived: true }, 'lee', LAB).errors.join()) && /private/.test(M.forkHostCheck({ ...mine, private: true }, 'lee', LAB).errors.join()));
  const rules = { minutesPerMonth: 300, jobs: ['gate', 'sim'], hours: '22:00-06:00', timezone: 'Asia/Tokyo', until: '2027-01-31', contact: 'lee' };
  ok(M.checkRules(JSON.parse(M.hostRulesText(rules).text)).rules.minutesPerMonth === 300 && M.hostRulesText({ ...rules, jobs: ['make'] }).text === null, 'their rules; an AI job is never lent');
  eq(M.forkWorkflows([{ id: 1, path: '.github/workflows/host.yml', state: 'disabled_fork' }, { id: 2, path: '.github/workflows/verify.yml', state: 'active' }, { id: 3, path: '.github/workflows/auto.yml', state: 'disabled_fork' }]), { enable: [1], disable: [2] }, 'host.yml on, the lab\'s own off');
  ok(M.canBorrow({ rules: {}, role: 'read', repo: mine }, LAB) && !M.canBorrow({ rules: {}, role: 'read', repo: { fork: false } }, LAB) && M.canBorrow({ rules: {}, role: 'borrower', repo: {} }, LAB) && !M.canBorrow({ rules: null, role: 'lender', repo: mine }, LAB), 'the lab borrows a fork of itself without an invitation');
});

await t('panel check: a changed file → the checks it needs (ESLint, the offline tests, the browser unless quick); failures\' lines (pure)', async () => {
  const PN = await imp('common/panel.mjs');
  // (a library or a view of the panel: the tabs that read them — 「アドオン」「予約」「統計」「お知らせ」 — are tried too)
  const LANES = ['tests/units-offline.mjs', 'tests/schedule-offline.mjs', 'tests/stats-offline.mjs', 'tests/inbox-offline.mjs'];
  eq(PN.plan(['panel/lib/members.mjs']), { lint: ['panel/lib/members.mjs'], tests: ['tests/panel-offline.mjs', 'tests/governance-offline.mjs', ...LANES, 'tests/panel-browser.mjs'] });
  eq(PN.plan(['panel/ui/signin.mjs', 'auth/handler.mjs'], { quick: true }).tests, ['tests/panel-offline.mjs', 'tests/session-offline.mjs', 'tests/auth-offline.mjs', ...LANES]);
  eq(PN.plan(['common/unitci.mjs', 'common/schedule.mjs']), { lint: ['common/unitci.mjs', 'common/schedule.mjs'], tests: ['tests/units-offline.mjs', 'tests/schedule-offline.mjs'] }, 'the CLI side of 「アドオン」 and 「予約」');
  eq(PN.plan(['panel/sw.js'], { quick: true }).tests, ['tests/panel-offline.mjs', 'tests/inbox-offline.mjs'], 'the service worker');
  eq(PN.plan(['tests/stats-offline.mjs']).tests, ['tests/stats-offline.mjs'], 'a lane test: itself');
  eq(PN.plan(['README.md', 'bds/lab.mjs']), { lint: [], tests: [] }, 'not the panel: nothing');
  eq(PN.plan(['host/template/.lab-host.json', 'tests/setup-offline.mjs']).tests, ['tests/panel-offline.mjs', 'tests/setup-offline.mjs']);
  eq(PN.failLines('ok a\nFAIL b\n  why\nok c').slice(0, 2), ['FAIL b', '  why']);
});

await t('administrators always lend (adminsLend): the rules that lend always, an administrator\'s lending as the lab sees it, the lab\'s lending forks, LAB_HOSTS kept, auto runs, what needs doing now (pure)', async () => {
  const P = await imp('panel/lib/policy.mjs'), MB = await imp('panel/lib/members.mjs');
  const A = M.alwaysRules('Asia/Tokyo', 'me');
  ok(M.alwaysLends(A).ok && A.minutesPerMonth === M.ALWAYS_MINUTES && A.jobs.length === M.HOST_JOBS.length && !('until' in A), JSON.stringify(A));
  const not = M.alwaysLends({ ...A, minutesPerMonth: 600, jobs: ['gate'], hours: '09:00-18:00', until: '2027-01-01' });
  ok(!not.ok && not.why.length === 4 && /600/.test(not.why[0]) && /upkeep/.test(not.why[1]) && /09:00-18:00/.test(not.why[2]) && /2027-01-01/.test(not.why[3]), JSON.stringify(not));
  ok(!M.alwaysLends(null).ok && /ありません/.test(M.alwaysLends(null).why[0]) && !M.alwaysLends({ jobs: ['make'] }).ok, 'no rules or wrong ones: not lending');
  const LAB = 'o/lab', fork = { full_name: 'ad/lab', owner: { login: 'ad' }, permissions: { admin: true }, fork: true, parent: { full_name: LAB }, visibility: 'public' };
  eq(M.adminLend({ required: false }), { required: false, ok: true, fork: null, why: [] }, 'not an administrator (or the owner, or no adminsLend): nothing asked');
  ok(!M.adminLend({ required: true }).ok && /フォークがまだ/.test(M.adminLend({ required: true }).why[0]), 'no fork: not yet');
  const good = M.adminLend({ required: true, fork, check: M.forkHostCheck(fork, 'ad', LAB), rules: A, hostYmlOk: true });
  ok(good.ok && good.fork === 'ad/lab', JSON.stringify(good));
  const behind = M.adminLend({ required: true, fork, check: M.forkHostCheck(fork, 'ad', LAB), rules: { ...A, until: '2027-01-01' }, hostYmlOk: false });
  ok(!behind.ok && behind.why.some((w) => /host\.yml/.test(w)) && behind.why.some((w) => /最後の日/.test(w)), JSON.stringify(behind));
  // (the policy's switch: off by default, carried through the grid and back)
  const g = MB.gridOf(P.checkPolicy({ version: 1, adminsLend: true }).policy);
  ok(g.adminsLend === true && MB.policyOf(g).json.adminsLend === true && !('adminsLend' in MB.policyOf(MB.gridOf(P.DEFAULT_POLICY)).json) && MB.applyPreset(g, 'owner').adminsLend === true, 'adminsLend kept through the grid, a preset and back');
  ok(JSON.parse(fs.readFileSync(path.join(TOP, '.github/bds-lab-panel.json'), 'utf8')).adminsLend === true, 'this lab: its administrators always lend');
  const lf = M.lendingForks([{ fork: { full_name: 'z/lab', owner: { login: 'z' } }, json: { ...A, minutesPerMonth: 300 } }, { fork: { full_name: 'ad/lab', owner: { login: 'ad' } }, json: A }, { fork: { full_name: 'n/lab', owner: { login: 'n' } }, json: null }], ['AD']);
  eq(lf.map((x) => [x.slug, x.admin, x.always.ok]), [['ad/lab', true, true], ['z/lab', false, false]], 'the administrators\' first; a fork that does not lend: not listed');
  eq([M.labHostsWith('a/b, c/d  a/b', ['e/f', 'C/D']), M.labHostsWith('a/b c/d', [], ['A/B']), M.labHostsWith(null, ['bad', 'x/y'])], ['a/b c/d e/f', 'c/d', 'x/y']);
  eq(M.hostRunInputs({ host: 'auto', job: 'gate' }).inputs, { host: 'auto', job: 'gate', unit: '', wait: 'true' });
  ok(/ユニット/.test(M.hostRunInputs({ host: 'auto', job: 'sim', unit: '' }).error) && /走らせられる仕事ではありません/.test(M.hostRunInputs({ host: 'auto', job: 'make' }).error), 'auto: any lent job, a unit when it takes one');
  const td = M.todos({ policyErrors: ['x'], idleAdmins: ['ad'], invites: 2, unlisted: ['z/lab'], stale: ['OLD'], health: [{ name: 'verify', streak: 3 }, { name: 'go', streak: 1 }], ending: [{ slug: 'l/h', until: '2026-10-10', days: 2 }], version: { state: 'newer', say: '新しい版' } });
  eq(td.map((x) => [x.level, x.tab]), [['bad', 'members'], ['bad', 'runs'], ['warn', 'hosts'], ['warn', 'hosts'], ['warn', 'secrets'], ['warn', 'hosts'], ['info', 'hosts'], ['info', null]], JSON.stringify(td));
  ok(/verify が 3 回続けて/.test(td[1].text) && /招待が 2 件/.test(td[3].text) && /あと 2 日/.test(td[5].text), JSON.stringify(td));
  eq(M.todos({}), [], 'nothing to do: nothing said');
});

await t('fewer errors and outsiders who ask: a role GitHub refuses on a person\'s repository (422) left out; requests to join read from the lab\'s issues; variables GitHub refused once not asked again (pure / fake)', async () => {
  const MB = await imp('panel/lib/members.mjs'), { gh } = await imp('panel/lib/gh.mjs');
  const calls = [], api = { call: async (m, p, b) => { calls.push(`${m} ${p} ${JSON.stringify(b)}`); if (b?.permission && b.permission !== 'push') throw Object.assign(new Error('Validation Failed'), { status: 422 }); return { id: 1 }; } };
  eq(await MB.putCollaborator(api, 'me/lab', 'friend', 'admin'), { value: { id: 1 }, plain: true });
  eq(calls, ['PUT /repos/me/lab/collaborators/friend {"permission":"admin"}', 'PUT /repos/me/lab/collaborators/friend {}'], 'tried with the role, then without');
  let e = null; try { await MB.putCollaborator({ call: async () => { throw Object.assign(new Error('x'), { status: 422 }); } }, 'me/lab', 'f', 'push'); } catch (x) { e = x; } ok(e?.status === 422, 'write itself refused: said, not retried');
  const rq = M.joinRequests([{ number: 3, title: `${M.JOIN_TITLE} lee`, body: 'hi', user: { login: 'lee' }, html_url: 'u' }, { number: 4, title: 'other' }, { number: 5, title: `${M.JOIN_TITLE} x`, pull_request: {} }]);
  eq(rq.map((x) => [x.number, x.login, x.body]), [[3, 'lee', 'hi']]);
  eq(M.todos({ joins: 2, noVars: true }).map((x) => [x.level, x.tab]), [['warn', 'members'], ['info', 'setup']]);
  let n = 0;
  const g = gh({ token: 't', base: 'https://x', fetchImpl: async () => { n++; return { status: 403, ok: false, headers: { get: () => null }, text: async () => '{"message":"Resource not accessible by integration"}' }; } });
  ok(await g.variableNames('o/r') === null, 'refused: no names');
  for (let i = 0; i < 3; i++) { let x = null; try { await g.variable('o/r', 'LAB_HOSTS'); } catch (y) { x = y; } ok(x?.status === 403, 'the same answer'); }
  eq(n, 1, 'asked GitHub once: no request after a 403 on that repository\'s variables');
});

await t('the guide for someone new: every tab explained, the words, what they want from their own words (any kana, any form), the next step by role, why a run failed in words, an access review as CSV (pure)', async () => {
  const G = await imp('panel/lib/guide.mjs');
  for (const k of M.TAB_KEYS) ok(G.HELP[k]?.what && G.HELP[k].title, `help for ${k}`);
  for (const x of G.INTENTS) ok(M.TAB_KEYS.includes(x.tab), `${x.id} goes to a tab`);
  const top = (q, o) => G.findIntents(q, o)[0]?.id;
  eq([top('アドオンを作りたい'), top('ひみつ'), top('パスワードを登録したい'), top('止めたい'), top('かんりしゃをまねく'), top('かしたい'), top('わからない'), top('エラーが出る'), top('ディスコード')],
    ['make', 'secrets', 'secrets', 'cancel', 'members', 'lend', 'guide', 'debug', 'discord']);
  ok(!G.findIntents('秘密を登録', { may: (a) => a !== 'secrets.put' }).some((x) => x.id === 'secrets') && !G.findIntents('監査', { tabs: ['overview'] }).length, 'what this person may not do or see: not offered');
  ok(G.findIntents('').length > 0 && G.findIntents('zzzz').length === 0, 'nothing typed: the common ones; nonsense: nothing');
  eq(G.findTerms('ふぉーく').map((x) => x.term), ['フォーク']);
  const owner = G.guideSteps('owner', { pages: true, app: true });
  ok(owner.total === 7 && owner.done === 3 && owner.next.id === 'auth', JSON.stringify(owner.next));
  ok(G.guideSteps('owner', { pages: 1, app: 1, auth: 1, discord: 1, ran: 1, lenders: 1 }).next === null, 'all done: no next');
  eq(G.guideSteps('admin', {}).steps.map((x) => x.id), ['signin', 'lend', 'discord', 'run']);
  eq(G.guideSteps('stranger', {}).steps.map((x) => x.id), ['fork', 'lend', 'join']);
  eq(G.guideSteps('writer', { ran: true }).next.id, 'watch');
  const known = Object.keys(M.KNOWN_SECRETS);
  const d1 = G.diagnose({ run: { conclusion: 'failure' }, annotations: [{ message: 'FAIL gate: tests/panel-offline.mjs' }, { message: 'DISCORD_BOT_TOKEN is not set' }], secrets: ['GOOGLE_EMAIL'], known });
  ok(d1.some((x) => x.prefill === 'DISCORD_BOT_TOKEN' && x.tab === 'secrets') && d1.some((x) => /試験が落ちました（panel-offline\.mjs）/.test(x.title)), JSON.stringify(d1));
  ok(!G.diagnose({ run: { conclusion: 'failure' }, annotations: [{ message: 'DISCORD_BOT_TOKEN missing' }], secrets: ['DISCORD_BOT_TOKEN'], known }).some((x) => x.prefill), 'a secret that is there is not asked for');
  eq(G.diagnose({ run: { conclusion: 'timed_out' } }).map((x) => x.title), ['時間切れです']);
  eq(G.diagnose({ run: { conclusion: 'cancelled' } }).map((x) => x.title), ['止められました']);
  ok(/API rate limit/.test('API rate limit') && G.diagnose({ run: { conclusion: 'failure' }, annotations: [{ message: 'API rate limit exceeded' }] })[0].title === 'GitHub の回数の上限です');
  ok(/注釈にありません/.test(G.diagnose({ run: { conclusion: 'failure' } })[0].title), 'nothing known: where to look');
  const now = Date.parse('2026-10-08T00:00:00Z'), day = 86_400_000;
  const rv = G.accessReview({ owner: 'me', now, adminsLend: true, lending: ['ad1'],
    members: [{ login: 'me', permission: 'admin' }, { login: 'ad1', permission: 'admin' }, { login: 'ad2', permission: 'admin' }, { login: 'w', permission: 'push' }, { login: 'old', permission: 'push' }],
    invitations: [{ login: 'inv', permission: 'push', at: new Date(now - 10 * day).toISOString() }],
    runs: [{ triggering_actor: { login: 'w' }, created_at: new Date(now - 2 * day).toISOString() }, { actor: { login: 'old' }, created_at: new Date(now - 200 * day).toISOString() }, { triggering_actor: { login: 'ad1' }, created_at: new Date(now - day).toISOString() }, { triggering_actor: { login: 'ad2' }, created_at: new Date(now - day).toISOString() }] });
  const by = Object.fromEntries(rv.rows.map((r) => [r.login, r.flags]));
  eq([by.me, by.w, by.old, by.ad1, by.ad2, by.inv], [[], [], ['200 日動きなし'], ['管理者（全部できる）'], ['管理者（全部できる）', '管理者なのに貸していない'], ['招待が 10 日そのまま']]);
  eq(rv.flagged, 3, 'what to look at: the idle one, the admin who does not lend, the waiting invitation');
  const csv = G.accessCsv(rv.rows);
  ok(csv.startsWith('\ufeffログイン,種類,役割') && csv.includes('ad2,メンバー,admin') && csv.trim().split('\n').length === 7, csv);
});

await t('the secret sealed as libsodium seals it (crypto_box_seal; vectors from libsodium) and its parts against Node\'s own X25519 and BLAKE2b', () => {
  // (made with libsodium-wrappers 0.7.15: seed keypair from 32 bytes of i+1, ephemeral secret 32 bytes of 100+i; sha256 of the box)
  const V = [['', '1b1b58dd50ea14b60da17b790cd02754d970c9bab864ebb3c0f3016fe51d3f57', '138d5a94edadcd0cb3573cbbad620463cd344c38f5017230d1a0d5eb53a52b7b'],
    ['a', '60346e7c911a5f6ba154129174cafe75b294ac3bbd5549632f48cec6266f8410', '8ba9b9ba10b079d8701190f5a0c65b9d61c1374e953c272b953429788aef7d82'],
    ['Very-Secret-pw-123', '75e270df2952c57ba8367ba8618c178f9fe50db2799d304e74e918d985686146', 'fe3c8f5a19b12d8a1fcc80cb0ec89bc9dd0116643fc6283a6dfca7f5f3c51f13'],
    ['x'.repeat(200), 'edd03cade80d29de6ea313a74ab369f4732ecb36649066b78b5b2dd664cb0417', 'e39062b23cc3cf9d8826c290150165bb06db821ac7705dd3179cd8c837ef7df2'],
    ['パスワード🔑'.repeat(30), 'c44e429251771ec76197c7a1f8ea289a18ca3dd7a7e102ba7cc84df6b55cbe1a', 'dfb9733aed4c8a8816d9b22007b1895bb6b3e9c4a86b07abcac41f01e8d2d8f4']];
  V.forEach(([msg, pk, sha], i) => {
    const out = SEAL.sealBox(msg, Buffer.from(pk, 'hex'), { ephemeral: new Uint8Array(32).fill(100 + i) });
    eq(crypto.createHash('sha256').update(out).digest('hex'), sha, `vector ${i}`);
    eq(out.length, 48 + Buffer.byteLength(msg), 'epk + tag + message');
  });
  // the recipient can open it: the same box recomputed from its own secret key and the sender's public one
  const sk = crypto.randomBytes(32), pk = SEAL.x25519Public(sk), sealed = SEAL.sealBox('hello panel', pk), epk = sealed.subarray(0, 32);
  const nonce = SEAL.blake2b(Buffer.concat([epk, pk]), 24);
  eq(hex(SEAL.box(new TextEncoder().encode('hello panel'), nonce, epk, sk)), hex(sealed.subarray(32)), 'opens with the recipient\'s key');
  ok(hex(SEAL.sealBox('hello panel', pk)) !== hex(sealed), 'a new ephemeral key every time');
  // X25519 against Node's own, BLAKE2b-512 against Node's own, Poly1305 against RFC 8439
  for (let k = 0; k < 5; k++) {
    const a = crypto.generateKeyPairSync('x25519'), b = crypto.generateKeyPairSync('x25519');
    const raw = (key, type) => key.export({ format: 'der', type }).subarray(-32);
    eq(hex(SEAL.x25519(raw(a.privateKey, 'pkcs8'), raw(b.publicKey, 'spki'))), hex(crypto.diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey })), `x25519 ${k}`);
    const d = crypto.randomBytes(k * 97);
    eq(hex(SEAL.blake2b(d, 64)), crypto.createHash('blake2b512').update(d).digest('hex'), `blake2b ${k}`);
  }
  eq(hex(SEAL.poly1305(new TextEncoder().encode('Cryptographic Forum Research Group'), Buffer.from('85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b', 'hex'))), 'a8061dc1305136c6c22b8baf0c0127a9');
  const p = SEAL.secretPayload('v', { key: SEAL.toB64(pk), key_id: 'K1' });
  ok(p.key_id === 'K1' && SEAL.fromB64(p.encrypted_value).length === 49, JSON.stringify(p));
});

await t('the live issue: the panel\'s sealed lines open on the runner and the runner\'s in the panel (the same key from APP_CACHE_KEY or GOOGLE_AAS_TOKEN)', async () => {
  for (const env of [{ APP_CACHE_KEY: 'panel-test-key' }, { GOOGLE_AAS_TOKEN: 'aas_et/panel' }]) {
    const pk = await PV.vaultKey({ cacheKey: env.APP_CACHE_KEY, aasToken: env.GOOGLE_AAS_TOKEN }), nk = AV.vaultKey(env);
    const s1 = await PV.sealText('walk forward 2\nwhere', pk);
    eq(AV.openText(s1, nk), 'walk forward 2\nwhere', 'panel → runner');
    eq(await PV.openText(AV.sealText('画面 🎮', nk), pk), '画面 🎮', 'runner → panel');
    eq(await PV.openText(s1.slice(0, -4) + 'AAAA', pk), null, 'altered');
    eq(await PV.openText(s1, await PV.vaultKey({ cacheKey: 'other' })), null, 'another key');
  }
  eq(await PV.vaultKey({}), null);
  const env = { APP_REPO_VISIBILITY: 'public', APP_CACHE_KEY: 'panel-test-key' }, key = await PV.vaultKey({ cacheKey: 'panel-test-key' });
  const body = await LF.commandBody(123, 'walk forward 1\nscreen', { isPublic: true, key });
  ok(body.startsWith('lab@123 lab-sealed:v1:'), body);
  eq(AL.commandsOf(body, 123, env), ['walk forward 1', 'screen'], 'the runner takes the panel\'s command');
  eq(await LF.commandBody(123, 'x', { isPublic: true }), null, 'public without a key: nothing plain');
  eq(await LF.commandBody(123, 'x', { isPublic: false }), 'lab@123 x');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  const reply = AL.replyBody(123, 77, 'forward へ 1 秒歩きました', png, 60_000, env);
  eq(await LF.replyParts(reply, 123, { isPublic: true, key }), { id: 77, text: 'forward へ 1 秒歩きました', png: png.toString('base64') }, 'the runner\'s reply, opened');
  eq(await LF.replyParts(reply, 123, { isPublic: true }), { id: 77, text: null, png: null }, 'no key: said as sealed');
  eq(await LF.replyParts(AL.replyBody(5, 9, 'plain', null, 60_000, { APP_REPO_VISIBILITY: 'private' }), 5, { isPublic: false }), { id: 9, text: 'plain', png: null });
  eq(await LF.tellText('lab-live@123 待っています（60 分まで）', 123, {}), '待っています（60 分まで）');
  eq(LF.liveIssue([{ number: 3, title: 'x' }, { number: 7, title: AL.ISSUE_TITLE }]), 7); eq(LF.ISSUE_TITLE, AL.ISSUE_TITLE);
  // (the panel's buttons are Discord's: every one a command the runner knows)
  for (const r of Object.values(PG.PAGES).flat(2)) if (!String(r[1]).startsWith('#')) for (const c of r[1].split(' && ')) ok(!AL.parseCommand(c).error, `${r[0]}: ${c}`);
});

await t('the GitHub client: the token as a bearer, workflow dispatch and secret sealing as GitHub takes them, errors in words, secret names only', async () => {
  const seen = [];
  const sk = crypto.randomBytes(32), pk = SEAL.x25519Public(sk);
  const fetchImpl = async (url, init) => {
    seen.push({ url: url.replace('https://api.test', ''), method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
    const u = url.replace('https://api.test', ''), send = (status, j) => ({ ok: status < 300, status, headers: { get: (k) => ({ 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1' })[k] ?? null }, text: async () => (j === null ? '' : JSON.stringify(j)) });
    if (u === '/repos/o/r/actions/secrets/public-key') return send(200, { key_id: 'KID', key: SEAL.toB64(pk) });
    if (u.startsWith('/repos/o/r/actions/secrets?')) return send(200, { secrets: [{ name: 'A' }, { name: 'B' }] });
    if (u.startsWith('/repos/o/nope/actions/secrets')) return send(403, { message: 'Resource not accessible by personal access token' });
    if (u === '/repos/o/r/contents/.lab-host.json') return send(200, { content: Buffer.from('{"a":"日本"}').toString('base64'), sha: 'S1' });
    if (u === '/repos/o/r/contents/none.json') return send(404, { message: 'Not Found' });
    if (u === '/user') return send(401, { message: 'Bad credentials' });
    return send(init.method === 'GET' ? 200 : 204, init.method === 'GET' ? {} : null);
  };
  const api = G.gh({ token: 'tok123', base: 'https://api.test', fetchImpl });
  await api.dispatch('o/r', 'app.yml', 'main', { mode: 'hold' });
  ok(seen[0].url === '/repos/o/r/actions/workflows/app.yml/dispatches' && seen[0].method === 'POST' && seen[0].auth === 'Bearer tok123' && seen[0].body.ref === 'main' && seen[0].body.inputs.mode === 'hold', JSON.stringify(seen[0]));
  await api.putSecret('o/r', 'MS_EMAIL', 'me@example.com');
  const put = seen.at(-1), sealed = SEAL.fromB64(put.body.encrypted_value), epk = sealed.subarray(0, 32);
  ok(put.url === '/repos/o/r/actions/secrets/MS_EMAIL' && put.method === 'PUT' && put.body.key_id === 'KID' && !JSON.stringify(put).includes('me@example.com'), JSON.stringify(put));
  eq(hex(SEAL.box(new TextEncoder().encode('me@example.com'), SEAL.blake2b(Buffer.concat([epk, pk]), 24), epk, sk)), hex(sealed.subarray(32)), 'GitHub (the key\'s owner) opens it');
  eq(await api.secretNames('o/r'), ['A', 'B']); eq(await api.secretNames('o/nope'), null, 'not allowed: null, not an error');
  eq(await api.file('o/r', '.lab-host.json'), { text: '{"a":"日本"}', sha: 'S1' }); eq(await api.file('o/r', 'none.json'), null);
  await api.putFile('o/r', '.lab-host.json', '{"a":"日本"}\n', 'S1', 'msg');
  ok(Buffer.from(seen.at(-1).body.content, 'base64').toString('utf8') === '{"a":"日本"}\n' && seen.at(-1).body.sha === 'S1', 'UTF-8 in base64, with the sha');
  let err = null; try { await api.me(); } catch (e) { err = e; }
  ok(err instanceof G.GhError && err.status === 401 && /トークンが受け付けられません/.test(err.message), err?.message);
  eq(api.state.remaining, 4999);
  ok(/権限がありません/.test(G.explain(403, 'x')) && /回数の上限/.test(G.explain(403, 'API rate limit exceeded')) && /見つからない/.test(G.explain(404)), 'errors in words');
});

await t('the page: its CSP allows GitHub\'s API alone (and its own config; pages.yml adds the sign-in service), its own scripts, a form to GitHub only; no inline script or style; text is never parsed as HTML', () => {
  const html = fs.readFileSync(path.join(TOP, 'panel', 'index.html'), 'utf8'), js = fs.readFileSync(path.join(TOP, 'panel', 'panel.js'), 'utf8');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  ok(/default-src 'none'/.test(csp) && /script-src 'self';/.test(csp) && /connect-src 'self' https:\/\/api\.github\.com;/.test(csp) && /form-action https:\/\/github\.com; manifest-src 'self'$/.test(csp) && !/unsafe/.test(csp), csp);
  ok(!/<script>(?!\s*<\/script>)/.test(html) && !/ style="/.test(html) && !/ on\w+="/.test(html), 'no inline script, style or handler in the page');
  for (const f of ['panel.js', ...['lib', 'ui'].flatMap((d) => (fs.existsSync(path.join(TOP, 'panel', d)) ? fs.readdirSync(path.join(TOP, 'panel', d)).map((x) => `${d}/${x}`) : []))]) {
    const src = fs.readFileSync(path.join(TOP, 'panel', f), 'utf8');
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(src), `${f}: no HTML parsing, no eval`);
    ok(![...src.matchAll(/https?:\/\/[\w.-]+/g)].map((m) => m[0]).some((u) => !/^https:\/\/(api\.github\.com|github\.com|avatars\.githubusercontent\.com)$/.test(u)), `${f}: no other address`);
  }
  ok(/setAttribute\('style'/.test(js) === false, 'styles through the CSSOM only');
  eq(M.repoFromLocation({ hostname: 'aokijp.github.io', pathname: '/bds-lab/' }), 'aokijp/bds-lab'); eq(M.repoFromLocation({ hostname: '127.0.0.1', pathname: '/' }), null);
});

await t('notify: when a run is told (auto / all / failures / off) and what is said: the result, the failed job and step, its annotation, links (pure)', async () => {
  const RM = await imp('app/lib/runmsg.mjs');
  const run = (c, event = 'push') => ({ status: 'completed', conclusion: c, event, name: 'app', head_branch: 'main', html_url: 'https://github.com/o/r/actions/runs/5', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:12:00Z', triggering_actor: { login: 'me' } });
  eq(['success', 'failure', 'cancelled', 'skipped'].map((c) => RM.shouldNotify(run(c))), [false, true, true, false], 'auto: failures (a pushed success is quiet)');
  eq(RM.shouldNotify(run('success', 'workflow_dispatch')), true, 'auto: a run started by hand is told when it passes too');
  eq([RM.shouldNotify(run('success'), 'all'), RM.shouldNotify(run('failure'), 'off'), RM.shouldNotify(run('success', 'workflow_dispatch'), 'failures'), RM.shouldNotify({ status: 'in_progress' }, 'all')], [true, false, false, false]);
  const m = RM.runMessage({ run: run('failure'), jobs: [{ name: 'device (1)', conclusion: 'failure', steps: [{ name: 'checkout', conclusion: 'success' }, { name: '端末で確かめる', conclusion: 'failure' }] }, { name: 'prep', conclusion: 'success' }],
    annotations: { 'device (1)': [{ annotation_level: 'warning', message: 'w' }, { annotation_level: 'failure', title: '結果とエラー', message: '✘ 3 until stable\n画面が落ち着きません' }] }, panel: RM.panelUrl('aokiJP/bds-lab') });
  ok(/^❌ \*\*app\*\* 落ちました（main・me・12 分）/.test(m.content) && /・device \(1\): 端末で確かめる/.test(m.content) && /結果とエラー: ✘ 3 until stable 画面が落ち着きません/.test(m.content) && !/prep/.test(m.content) && m.ok === false, m.content);
  eq(m.buttons, [{ label: 'GitHub で見る', url: 'https://github.com/o/r/actions/runs/5' }, { label: '管理パネル', url: 'https://aokijp.github.io/bds-lab/' }]);
  eq(RM.panelUrl('o/r', { LAB_PANEL_URL: 'https://panel.example' }), 'https://panel.example');
  ok(RM.runMessage({ run: { ...run('failure'), name: 'x'.repeat(5000) } }).content.length <= 1900, 'within a message');
});

await t('the run\'s deliverables for Discord: which files go (LAB_NOTIFY_FILES), within the upload limit, the rest named; read from its artifacts (a fake GitHub whose storage takes no token) — packs inside kept whole', async () => {
  const RF = await imp('app/lib/runfiles.mjs'), RM = await imp('app/lib/runmsg.mjs'), SH = await imp('common/share.mjs');
  const f = (name, size) => ({ name, size });
  eq(RF.patterns('off'), null); eq(RF.pickFiles([f('a.mcaddon', 1)], { pats: null }), { attach: [], tooBig: [] });
  const p = RF.pickFiles([f('dist/A.mcaddon', 3e6), f('B.mcpack', 2e6), f('log.txt', 10), f('big.mcworld', 9e6), f('again/A.mcaddon', 3e6)], { pats: RF.patterns('auto'), maxBytes: 10e6 });
  eq([p.attach.map((x) => x.name), p.tooBig.map((x) => x.name)], [['B.mcpack', 'again/A.mcaddon'], ['big.mcworld']], 'the smallest first while within the limit; a name once; not a log');
  eq([RF.pickFiles([f('a.zip', 1)], { pats: RF.patterns('*.zip, *.mcaddon') }).attach.length, RF.pickFiles([f('a.zip', 1)], { pats: RF.patterns('auto') }).attach.length], [1, 0]);
  eq(RF.pickFiles(Array.from({ length: 12 }, (_, i) => f(`${i}.mcpack`, 1))).attach.length, 10, 'ten files a message (Discord)');
  const zip = SH.zip([['Coins.mcaddon', Buffer.from('ADDON')], ['report.txt', Buffer.from('r')], ['packs/Coins_BP.mcpack', SH.zip([['manifest.json', Buffer.from('{}')]], '')]], '');
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push(`${req.headers.host.split(':')[0]} ${req.url} ${req.headers.authorization ?? '-'}`);
    if (req.url === '/gh/repos/o/r/actions/runs/5/artifacts?per_page=100') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ artifacts: [{ id: 1, name: 'bds-addons', size_in_bytes: zip.length, expired: false, archive_download_url: `http://127.0.0.1:${port}/gh/repos/o/r/actions/artifacts/1/zip` }, { id: 2, name: 'old', size_in_bytes: 9, expired: true, archive_download_url: `http://127.0.0.1:${port}/gh/x` }] })); }
    if (req.url === '/gh/repos/o/r/actions/artifacts/1/zip') { res.writeHead(302, { location: `http://localhost:${port}/storage/1.zip?sig=x` }); return res.end(); }
    if (req.url === '/storage/1.zip?sig=x') { if (req.headers.authorization) { res.writeHead(403); return res.end('a token where none is asked'); } res.writeHead(200, { 'content-type': 'application/zip' }); return res.end(zip); }
    res.writeHead(404); res.end();
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port, base = `http://127.0.0.1:${port}/gh`;
  const got = await RF.runFiles({ base, repo: 'o/r', run: 5, token: 'ghs_x', policy: '' });
  srv.close();
  eq([got.attach.map((x) => `${x.name}:${x.data.length}`), got.tooBig, got.why], [['Coins.mcaddon:5', `Coins_BP.mcpack:${SH.zip([['manifest.json', Buffer.from('{}')]], '').length}`], [], ''], seen.join('\n'));
  eq(got.artifacts.map((a) => [a.name, a.expired]), [['bds-addons', false], ['old', true]]);
  ok(seen.some((l) => /^localhost \/storage\/1\.zip\?sig=x -$/.test(l)), `the storage asked without the token\n${seen.join('\n')}`);
  eq((await RF.runFiles({ base: 'http://127.0.0.1:1/gh', repo: 'o/r', run: 5, token: 't' })).attach, [], 'GitHub not answering: no files, no failure');
  // said in the message: what went along, what was too large, a button to the artifacts, the panel opened at the run
  const run = { status: 'completed', conclusion: 'success', event: 'workflow_dispatch', name: 'hostrun', head_branch: 'main', html_url: 'https://github.com/aokiJP/bds-lab/actions/runs/5', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:12:00Z' };
  const m = RM.runMessage({ run, files: { attach: [{ name: 'Coins.mcaddon', size: 1_200_000 }], tooBig: [{ name: 'World.mcworld', size: 30e6 }], artifacts: got.artifacts }, panel: RM.panelRunUrl(RM.panelUrl('aokiJP/bds-lab'), 'aokiJP/bds-lab', 5) });
  ok(/📦 Coins\.mcaddon（1\.2 MB）/.test(m.content) && /添えられません（Discord の上限）: World\.mcworld（30\.0 MB）/.test(m.content), m.content);
  eq(m.buttons.map((b) => b.label), ['GitHub で見る', '成果物（1）', '管理パネル']);
  eq(m.buttons[1].url, 'https://github.com/aokiJP/bds-lab/actions/runs/5#artifacts');
  eq(M.parseHash(new URL(m.buttons[2].url).hash), { tab: 'runs', repo: 'aokiJP/bds-lab', run: '5' }, 'the panel\'s button opens that run');
  eq(RM.panelRunUrl('https://panel.example/#mine', 'o/r', 5), 'https://panel.example/#mine', 'an address with its own hash is left alone');
});

await t('app notify: a finished run told as a DM with link buttons and its .mcaddon attached (fake GitHub + fake Discord); a fork\'s files never; --force; else to the webhook (a Discord one with the files); nowhere to send: said, not a failure', async () => {
  const { spawn } = await import('node:child_process');
  const SH = await imp('common/share.mjs');
  const got = { dm: [], hook: [] }, zip = SH.zip([['Coins.mcaddon', Buffer.from('ADDON-BYTES')]], '');
  // (Discord takes files as multipart: the message in payload_json, each file a part)
  const body = (req, b) => {
    if (!String(req.headers['content-type']).startsWith('multipart/')) return { json: b ? JSON.parse(b) : null, files: [] };
    const json = JSON.parse(/name="payload_json"\r\n(?:[^\r\n]+\r\n)*\r\n([^\r\n]*)\r\n/.exec(b)?.[1] ?? 'null');
    return { json, files: [...b.matchAll(/name="files\[\d+\]"; filename="([^"]+)"\r\n(?:[^\r\n]+\r\n)*\r\n([^\r\n]*)\r\n/g)].map((m) => `${m[1]}=${m[2]}`) };
  };
  const arts = (id) => ({ artifacts: [{ id, name: 'bds-addons', size_in_bytes: zip.length, expired: false, archive_download_url: `http://127.0.0.1:${port}/gh/repos/o/r/actions/artifacts/${id}/zip` }] });
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (/^\/gh\/repos\/o\/r\/actions\/runs\/(5|6|8|9)\/artifacts/.test(req.url)) return send(200, arts(req.url.split('/')[7]));
      if (/^\/gh\/repos\/o\/r\/actions\/artifacts\/\d+\/zip$/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/zip' }); return res.end(zip); }
      if (req.url === '/gh/repos/o/r/actions/runs/8') return send(200, { id: 8, status: 'completed', conclusion: 'success', event: 'pull_request', name: 'verify', head_branch: 'patch-1', html_url: 'https://github.com/o/r/actions/runs/8', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z', actor: { login: 'someone' }, head_repository: { full_name: 'someone/r' } });
      if (req.url === '/gh/repos/o/r/actions/runs/9') return send(200, { id: 9, status: 'completed', conclusion: 'success', event: 'workflow_dispatch', name: 'hostrun', path: '.github/workflows/hostrun.yml', head_branch: 'main', html_url: 'https://github.com/o/r/actions/runs/9', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z', actor: { login: 'me' } });
      if (/^\/gh\/repos\/o\/r\/actions\/runs\/(6|8|9)\/jobs/.test(req.url)) return send(200, { jobs: [] });
      if (req.url === '/gh/repos/o/r/actions/runs/5') return send(200, { id: 5, status: 'completed', conclusion: 'failure', event: 'push', name: 'verify', head_branch: 'main', html_url: 'https://github.com/o/r/actions/runs/5', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z', actor: { login: 'me' } });
      if (req.url === '/gh/repos/o/r/actions/runs/6') return send(200, { id: 6, status: 'completed', conclusion: 'success', event: 'push', name: 'verify', head_branch: 'main', html_url: 'https://github.com/o/r/actions/runs/6', run_started_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:03:00Z' });
      if (/^\/gh\/repos\/o\/r\/actions\/runs\/5\/jobs/.test(req.url)) return send(200, { jobs: [{ name: 'offline', conclusion: 'failure', check_run_url: 'https://api/x/check-runs/77', steps: [{ name: 'every offline test', conclusion: 'failure' }] }] });
      if (/^\/gh\/repos\/o\/r\/check-runs\/77\/annotations/.test(req.url)) return send(200, [{ annotation_level: 'failure', message: 'FAIL gate: tests/panel-offline.mjs' }]);
      if (req.url === '/dc/users/@me/channels') return send(200, { id: 'dm1' });
      if (req.url === '/dc/channels/dm1/messages') { const x = body(req, b); got.dm.push({ auth: req.headers.authorization, body: x.json, files: x.files }); return send(200, { id: 'm1' }); }
      if (req.url === '/hook' || req.url.startsWith('/discord.com/api/webhooks/')) { const x = body(req, b); got.hook.push({ ...x.json, files: x.files }); return send(204, {}); }
      send(404, { url: req.url });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const run = (args, env) => new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', 'notify', ...args], { cwd: TOP, env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_API_URL: `http://127.0.0.1:${port}/gh`, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'ghs_x', DISCORD_API_URL: `http://127.0.0.1:${port}/dc`, DISCORD_BOT_TOKEN: '', DISCORD_USER_ID: '', LAB_NOTIFY_WEBHOOK: '', LAB_NOTIFY: '', ...env } }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', (code) => res({ code, o })); });
  const dc = { DISCORD_BOT_TOKEN: 'bot-tok', DISCORD_USER_ID: '123456789012345678' };
  const a = await run(['--run', '5'], dc);
  ok(a.code === 0 && /OK Discord の DM に送りました/.test(a.o) && got.dm.length === 1 && got.dm[0].auth === 'Bot bot-tok', a.o);
  const msg = got.dm[0].body;
  ok(/❌ \*\*verify\*\* 落ちました/.test(msg.content) && /・offline: every offline test/.test(msg.content) && /FAIL gate: tests\/panel-offline\.mjs/.test(msg.content) && msg.components[0].components.every((x) => x.type === 2 && x.style === 5 && /^https:\/\//.test(x.url)) && msg.allowed_mentions.parse.length === 0, JSON.stringify(msg));
  ok(/OK Discord の DM に送りました（Coins\.mcaddon）/.test(a.o) && JSON.stringify(got.dm[0].files) === JSON.stringify(['Coins.mcaddon=ADDON-BYTES']) && /📦 Coins\.mcaddon/.test(msg.content) && msg.attachments?.[0]?.filename === 'Coins.mcaddon', `the run's .mcaddon went along\n${a.o}\n${JSON.stringify(got.dm[0])}`);
  ok(msg.components[0].components.some((x) => x.label === '成果物（1）') && msg.components[0].components.some((x) => /#runs\?repo=o%2Fr&run=5$/.test(x.url)), JSON.stringify(msg.components));
  const quiet = await run(['--run', '6'], dc);
  ok(quiet.code === 0 && /知らせません（LAB_NOTIFY=auto、verify success、push）/.test(quiet.o) && got.dm.length === 1, quiet.o);
  const forced = await run(['--run', '6', '--force'], dc);
  ok(forced.code === 0 && got.dm.length === 2 && /✅ \*\*verify\*\* 通りました/.test(got.dm[1].body.content) && got.dm[1].files.length === 1, `--force (the panel's 「Discord に送る」) tells it anyway\n${forced.o}`);
  const fork = await run(['--run', '8', '--force'], dc);
  ok(fork.code === 0 && got.dm.length === 3 && !got.dm[2].files.length && /成果物は添えません（someone\/r の変更から/.test(fork.o) && !/📦/.test(got.dm[2].body.content), `a fork's pull request: told, its files never handed on\n${fork.o}`);
  const lent = await run(['--run', '9'], dc);
  ok(lent.code === 0 && !got.dm.at(-1).files.length && /貸し手のランナーで作ったもの/.test(lent.o) && !/📦/.test(got.dm.at(-1).body.content), `a hostrun's files (made on a lender's runner) are never handed on\n${lent.o}`);
  const off = await run(['--run', '5'], { ...dc, LAB_NOTIFY_FILES: 'off' });
  ok(off.code === 0 && !got.dm.at(-1).files.length && /成果物（1）/.test(JSON.stringify(got.dm.at(-1).body.components)), 'LAB_NOTIFY_FILES=off: no file, the button still');
  const dhook = await run(['--run', '5'], { LAB_NOTIFY_WEBHOOK: `http://127.0.0.1:${port}/discord.com/api/webhooks/1/abc` });
  ok(dhook.code === 0 && /OK Webhook に送りました（Coins\.mcaddon）/.test(dhook.o) && JSON.stringify(got.hook.at(-1).files) === JSON.stringify(['Coins.mcaddon=ADDON-BYTES']) && got.hook.at(-1).username === 'bds-lab', `a Discord webhook takes the files too\n${dhook.o}`);
  const test = await run(['--text', 'hello from the panel'], dc);
  ok(test.code === 0 && got.dm.at(-1).body.content === 'hello from the panel', test.o);
  const hook = await run(['--run', '5'], { LAB_NOTIFY_WEBHOOK: `http://127.0.0.1:${port}/hook` });
  const h0 = got.hook.at(-1);
  ok(hook.code === 0 && /OK Webhook に送りました$/m.test(hook.o) && got.hook.length === 2 && /verify 落ちました/.test(JSON.stringify(h0)) && /actions\/runs\/5/.test(JSON.stringify(h0)) && !h0.files.length && /Coins\.mcaddon/.test(JSON.stringify(h0)), `another webhook: the files named, not sent\n${hook.o}${JSON.stringify(got.hook)}`);
  const none = await run(['--run', '5'], {});
  ok(none.code === 0 && /通知先がありません/.test(none.o), none.o);
  srv.close();
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
