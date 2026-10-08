// GitHub Actions time lent by lenders (common/hosts.mjs, `node lab.mjs host`) without GitHub: the lender's rules, the budget
// and its edges (80 %, the last day, the hours, one at a time, the month), what never goes to a host, the template, and the
// commands end to end against a fake gh (tests/fake/host/gh: bare repositories, workflow runs, artifacts, 403/404) — one
// run really runs `node lab.mjs host __job` in a clone of what was pushed, as host.yml does.
// node tests/host-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = await import(pathToFileURL(path.join(TOP, 'common', 'hosts.mjs')).href);
let pass = 0, fail = 0;
const only = process.env.HOST_TEST_ONLY ? new RegExp(process.env.HOST_TEST_ONLY) : null;
const t = async (name, fn) => { if (only && !only.test(name)) return; try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}\n     ${e.stack?.split('\n')[1] ?? ''}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'host-offline-'));
const RULES = { lab: 1, minutesPerMonth: 100, jobs: ['gate', 'sim', 'test'], hours: '00:00-24:00', timezone: 'Asia/Tokyo', until: '2027-03-31', contact: '@lender' };

// ---- pieces ----
await t('the lender\'s rules: what is right, and every wrong value named', () => {
  eq(H.checkRules(RULES).errors, []);
  eq(H.checkRules({ minutesPerMonth: 600, jobs: ['gate'] }).rules, { minutesPerMonth: 600, jobs: ['gate'], hours: '00:00-24:00', timezone: 'UTC', until: null, contact: '' }, 'defaults');
  const e = H.checkRules({ minutesPerMonth: 1.5, jobs: ['gate', 'make'], hours: '9-17', timezone: 'Mars/Base', until: '31/03/2027', contact: 7 }).errors;
  eq(e.length, 6, e.join(' | '));
  ok(/AI/.test(e[1]), 'make (an AI job) is no job a host runs');
  eq(H.checkRules(null).rules, null);
});
await t('hours and days in the lender\'s time zone: a window over midnight, the last day, the month', () => {
  const at = (iso) => new Date(iso);
  ok(H.within('09:00-23:00', 'Asia/Tokyo', at('2026-10-06T00:30:00Z')), '09:30 JST is inside 09:00-23:00');
  ok(!H.within('09:00-23:00', 'Asia/Tokyo', at('2026-10-06T14:30:00Z')), '23:30 JST is outside');
  ok(H.within('22:00-06:00', 'Asia/Tokyo', at('2026-10-06T14:30:00Z')) && H.within('22:00-06:00', 'Asia/Tokyo', at('2026-10-06T20:59:00Z')) && !H.within('22:00-06:00', 'Asia/Tokyo', at('2026-10-06T21:00:00Z')), 'over midnight: 23:30 and 05:59 in, 06:00 out');
  ok(H.within('00:00-24:00', 'UTC', at('2026-10-06T23:59:00Z')) && H.within('08:00-08:00', 'UTC', at('2026-10-06T03:00:00Z')), 'all day');
  eq([H.monthOf('2026-10-31T16:00:00Z', 'Asia/Tokyo'), H.monthOf('2026-10-31T16:00:00Z', 'UTC'), H.dayOf('2026-10-31T16:00:00Z', 'Asia/Tokyo')], ['2026-11', '2026-10', '2026-11-01']);
});
await t('the budget: stops at 80 % of the month (the estimate counted), the last day, the jobs, the hours, one at a time, a withdrawn host', () => {
  const host = (o = {}) => ({ slug: 'l/h', rules: { ...H.checkRules(RULES).rules, ...o } });
  const now = new Date('2026-10-15T03:00:00Z');
  const done = (min, at = '2026-10-10T00:00:00Z', job = 'upkeep', req = `q${Math.random()}`) => [{ at, host: 'l/h', request: req, job, state: 'dispatched' }, { at, host: 'l/h', request: req, state: 'done', minutes: min, ok: true }];
  // 80 of 100: 65 used + gate's 15 = 80 → yes; 66 + 15 → no
  ok(H.canRun(host(), 'gate', done(65), now).ok, '65 + 15 = 80: at the line, allowed');
  const over = H.canRun(host(), 'gate', [...done(51), ...done(15)], now);
  ok(!over.ok && /80%（80 分）を超えます/.test(over.why.join()), `66 + 15 > 80: stopped (${over.why})`);
  eq(H.estimate([...done(20, undefined, 'gate'), ...done(30, undefined, 'gate')], 'gate'), 25, 'the estimate: what its last runs took');
  eq(H.estimate([], 'gate'), 15, 'never run: the job\'s own guess');
  ok(H.canRun(host(), 'gate', [...done(60, '2026-09-30T14:00:00Z')], now).ok, 'September\'s minutes do not count in October (JST)');
  ok(!H.canRun(host(), 'gate', done(60, '2026-09-30T16:00:00Z'), now).ok === false, 'Oct 1st 01:00 JST counts in October');
  ok(H.canRun(host({ until: '2026-10-15' }), 'sim', [], now).ok && !H.canRun(host({ until: '2026-10-14' }), 'sim', [], now).ok, 'the last day is a day it may run, the day after not');
  ok(/許されていません/.test(H.canRun(host(), 'go', [], now).why.join()), 'a job the lender did not allow');
  ok(/時間帯/.test(H.canRun(host({ hours: '20:00-23:00' }), 'sim', [], now).why.join()), 'outside the hours (12:00 JST)');
  ok(/別の仕事/.test(H.canRun(host(), 'sim', [{ at: '2026-10-15T02:00:00Z', host: 'l/h', request: 'r1', job: 'sim', state: 'dispatched' }], now).why.join()), 'one at a time');
  ok(/使えなくなりました/.test(H.canRun({ ...host(), withdrawn: { at: '2026-10-01', why: '404' } }, 'sim', [], now).why.join()), 'withdrawn');
  const pick = H.choose({ 'a/x': { rules: host().rules }, 'b/y': { rules: host({ minutesPerMonth: 1000 }).rules } }, 'sim', [], { now });
  eq(pick.host, 'b/y', 'the host with the most minutes left');
  eq(H.choose({ 'a/x': { rules: host().rules } }, 'go', [], { now }).host, null);
});
await t('what never goes to a host: secrets, keys, the BDS zip, APKs, the app lab\'s runs, .lab, borrowed addons (mark, name, original), a file too large', async () => {
  const f = (rel, text = 'x') => [rel, Buffer.from(text)];
  const bad = await H.prePush([f('.env.local'), f('bds/addons/z/.env.production'), f('bds/addons/z/.env.example'), f('bds/addons/z/certs/server.pem'), f('bds/addons/z/signing.p12'), f('home/id_ed25519'), f('bds/addons/z/.npmrc'),
    f('bds/vendor/bedrock-server.zip'), f('a/b.apk'), f('app/runs/1/report.md'), f('bds/.lab/x'), f('bds/addons/x/imported.json', JSON.stringify({ borrowed: { url: 'u' } })),
    f('bds/addons/borrowed_77/bp/manifest.json', '{}'), f('bds/addons/mine/.borrowed/orig.mcaddon', 'zip'),
    f('bds/addons/y/bp/scripts/main.js', `const k = 'sk-ant-${'a'.repeat(30)}';`), f('bds/addons/y/bp/functions/setup.mcfunction', `say ghp_${'B'.repeat(36)}`), ['big.bin', Buffer.alloc(51e6)], f('common/ok.mjs', 'export const fine = 1;')], tmp);
  const why = Object.fromEntries(bad.map((b) => [b.rel, b.why]));
  ok(why['.env.local'] && why['bds/addons/z/.env.production'] && !why['bds/addons/z/.env.example'] && /鍵/.test(why['bds/addons/z/certs/server.pem']) && /鍵/.test(why['bds/addons/z/signing.p12']) && /SSH/.test(why['home/id_ed25519']) && /認証/.test(why['bds/addons/z/.npmrc']), JSON.stringify(bad, null, 1));
  ok(why['bds/vendor/bedrock-server.zip'] && why['a/b.apk'] && why['app/runs/1/report.md'] && why['bds/.lab/x'] && /借りた/.test(why['bds/addons/x']) && /借りた/.test(why['bds/addons/borrowed_77']) && /借りた/.test(why['bds/addons/mine']) && bad.some((b) => b.rel === 'bds/addons/y/bp/scripts/main.js:1' && /Anthropic/.test(b.why)) && /大きすぎ/.test(why['big.bin']) && !why['common/ok.mjs'], JSON.stringify(bad, null, 1));
  ok(bad.some((b) => b.rel === 'bds/addons/y/bp/functions/setup.mcfunction:1' && /GitHub/.test(b.why)), 'a key in any text file (an .mcfunction) is found too');
  ok(!JSON.stringify(bad).includes('a'.repeat(30)) && !JSON.stringify(bad).includes('B'.repeat(36)), 'the secret itself is never printed');
});
await t('what is pushed: the lab as a release carries it, its own CI inert (only host.yml runs), the memory reset with the person\'s gate, the unit asked for; lint-offline passes in it', async () => {
  const files = await H.packFiles('coins'), rels = files.map(([r]) => r);
  ok(rels.includes('common/core.mjs') && rels.includes('bds/vendor/bds-version.txt') && !rels.includes('bds/vendor/bedrock-server.zip'), 'the lab, the BDS version, no BDS');
  eq(rels.filter((r) => r.startsWith('.github/')), ['.github/workflows/host.yml'], 'no workflow of the lab\'s own where GitHub starts them (a push must start nothing but host.yml)');
  ok(rels.includes('.lab-github/workflows/verify.yml'), 'the lab\'s own workflows carried under .lab-github/ (inert there)');
  ok(rels.includes('bds/addons/coins/bp/manifest.json') && !rels.some((r) => /(^|\/)(\.lab|node_modules|dist)\//.test(r) || /tsconfig\.json$/.test(r)), 'the unit, without its caches');
  eq(files.find(([r]) => r === 'auto/ledger.jsonl')?.[1].toString(), '', 'the autopilot\'s ledger reset (share\'s resetMemory)');
  const { policy } = await import(pathToFileURL(path.join(TOP, 'common', 'auto-guard.mjs')).href);
  eq(JSON.parse(files.find(([r]) => r === 'auto/policy.json')[1].toString()).gate, policy(TOP).gate, 'the gate the host runs is the person\'s own list');
  eq((await H.prePush(files)).map((b) => b.rel), [], 'and it passes the check');
  // the lab's own hygiene check, in exactly what a host gets (it reads the workflows: they must be there for it)
  const w = path.join(tmp, 'packed');
  for (const [r, b] of files) { const f = path.join(w, r); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); }
  const l = spawnSync(process.execPath, [path.join(w, 'tests', 'lint-offline.mjs')], { cwd: w, encoding: 'utf8', timeout: 180_000 });
  ok(l.status === 0, (l.stdout + l.stderr).split('\n').filter((x) => /✘|FAIL|Error/.test(x)).slice(0, 12).join('\n'));
  fs.rmSync(w, { recursive: true, force: true });
  // what share never ships is not sent from a unit either (an .env of any name, a packed .mcaddon); a key file stops the push
  const u = path.join(TOP, 'bds', 'addons', 'coins');
  fs.writeFileSync(path.join(u, '.env.production'), `TOKEN=ghp_${'C'.repeat(36)}\n`); fs.writeFileSync(path.join(u, 'old.mcaddon'), 'zip');
  try { const r2 = (await H.packFiles('coins')).map(([r]) => r); ok(!r2.includes('bds/addons/coins/.env.production') && !r2.includes('bds/addons/coins/old.mcaddon'), 'left out'); }
  finally { fs.rmSync(path.join(u, '.env.production'), { force: true }); fs.rmSync(path.join(u, 'old.mcaddon'), { force: true }); }
});
await t('the template: host.yml pinned to commits, contents: read, no pull_request_target, inputs only through env; actionlint', () => {
  const y = fs.readFileSync(path.join(H.TEMPLATE, H.WORKFLOW), 'utf8');
  const uses = [...y.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  ok(uses.length >= 4 && uses.every((u) => /@[0-9a-f]{40}$/.test(u)), uses.join(' '));
  ok(/permissions:\n {2}contents: read\n\n/.test(y) && !/write/.test(y.split('permissions:')[1].split('\n\n')[0]) && !/pull_request_target|secrets\./.test(y), 'least privilege, no secrets');
  const runs = [...y.matchAll(/^\s+run: (.*)$/gm)].map((m) => m[1]);
  ok(runs.length && runs.every((r) => !/\$\{\{/.test(r)), `no input inside a run line (script injection): ${runs.join(' | ')}`);
  const rules = JSON.parse(fs.readFileSync(path.join(H.TEMPLATE, '.lab-host.json'), 'utf8'));
  eq(H.checkRules(rules).errors, [], 'the example rules are right');
  const al = spawnSync('actionlint', ['-version'], { encoding: 'utf8' });
  if (al.status === 0) { const r = spawnSync('actionlint', [path.join(H.TEMPLATE, H.WORKFLOW)], { encoding: 'utf8' }); ok(r.status === 0, r.stdout + r.stderr); }
  else console.log('     (no actionlint here: not run)');
});

// ---- the commands, against the fake gh ----
const GHD = path.join(tmp, 'github'), HOME = path.join(tmp, 'home'), STATE = path.join(tmp, 'state'), FAKE = path.join(TOP, 'tests', 'fake', 'host', 'gh');
fs.mkdirSync(GHD, { recursive: true }); fs.mkdirSync(HOME, { recursive: true }); fs.chmodSync(FAKE, 0o755);
fs.writeFileSync(path.join(HOME, '.gitconfig'), `[url "${GHD}/"]\n\tinsteadOf = https://github.com/\n[init]\n\tdefaultBranch = main\n[user]\n\tname = t\n\temail = t@t\n`);
const ENV = { ...process.env, HOME, GIT_CONFIG_NOSYSTEM: '1', LAB_GH: FAKE, FAKEGH_DIR: GHD, LAB_HOST_STATE: STATE, LAB_HOST_POLL_MS: '30', NO_COLOR: '1' };
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_ACTIONS', 'LAB_ASK_FILE']) delete ENV[k];
const state = () => JSON.parse(fs.readFileSync(path.join(GHD, 'state.json'), 'utf8'));
const setState = (f) => { const s = (() => { try { return state(); } catch { return { repos: {}, runs: [], issues: [], next: 5000 }; } })(); f(s); fs.writeFileSync(path.join(GHD, 'state.json'), JSON.stringify(s)); };
const host = (args, extra = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'host', ...args], { cwd: TOP, encoding: 'utf8', timeout: 600_000, env: { ...ENV, ...extra } }); return { status: r.status, text: (r.stdout ?? '') + (r.stderr ?? '') }; };
const ledger = () => H.readLedger(path.join(STATE, 'host-ledger.jsonl'));
const branches = (slug) => spawnSync('git', ['--git-dir', path.join(GHD, `${slug}.git`), 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
// a lender's repository: the template on main (its rules and host.yml can be made wrong)
function lender(slug, { rules = RULES, workflow = null, push = true } = {}) {
  const w = fs.mkdtempSync(path.join(tmp, 'mk-'));
  fs.cpSync(H.TEMPLATE, w, { recursive: true });
  if (rules === null) fs.rmSync(path.join(w, '.lab-host.json')); else fs.writeFileSync(path.join(w, '.lab-host.json'), JSON.stringify(rules, null, 1));
  if (workflow !== null) fs.writeFileSync(path.join(w, H.WORKFLOW), workflow);
  fs.mkdirSync(path.dirname(path.join(GHD, `${slug}.git`)), { recursive: true });
  const g = (args, cwd = w) => spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  g(['init', '-q', '--bare', path.join(GHD, `${slug}.git`)], tmp);
  g(['init', '-q', '-b', 'main']); g(['add', '-A']); g(['commit', '-q', '-m', 'template']);
  const p = g(['push', '-q', `https://github.com/${slug}.git`, 'HEAD:refs/heads/main']);
  if (p.status !== 0) throw new Error(p.stderr);
  fs.rmSync(w, { recursive: true, force: true });
  setState((s) => { s.repos[slug] = { push, private: true, withdrawn: null }; });
}
await t('host add: write access, the rules, host.yml as the lab\'s; each refusal says what to do', () => {
  lender('lender/host'); lender('lender/ro', { push: false }); lender('lender/norules', { rules: null }); lender('lender/badrules', { rules: { ...RULES, jobs: ['make'] } }); lender('lender/oldwf', { workflow: 'name: x\non: workflow_dispatch\njobs: {}\n' });
  let r = host(['add', 'lender/ro']); ok(r.status === 1 && /書き込めません/.test(r.text) && /collaborator/.test(r.text), r.text);
  r = host(['add', 'lender/norules']); ok(r.status === 1 && /\.lab-host\.json がありません/.test(r.text) && /host template/.test(r.text), r.text);
  r = host(['add', 'lender/badrules']); ok(r.status === 1 && /jobs:/.test(r.text), r.text);
  r = host(['add', 'lender/oldwf']); ok(r.status === 1 && /ひな形と違います/.test(r.text), r.text);
  r = host(['add', 'nobody/here']); ok(r.status === 1 && /403\/404/.test(r.text), r.text);
  r = host(['add', 'lender/host']);
  ok(r.status === 0 && /OK lender\/host: 1 か月 100 分（80 分で止める）· 仕事 gate sim test/.test(r.text), r.text);
  r = host(['list']); ok(/lender\/host/.test(r.text) && /今月 0 分 \/ 止める 80 分 \/ 上限 100 分/.test(r.text) && /連絡 @lender/.test(r.text), r.text);
  r = host(['template', path.join(tmp, 'tpl')]); ok(r.status === 0 && fs.existsSync(path.join(tmp, 'tpl', '.github', 'workflows', 'host.yml')) && fs.existsSync(path.join(tmp, 'tpl', 'README.md')), r.text);
});
await t('host run: pushed, started, waited for, the result taken, the minutes in the ledger, the branch gone — the job really run in a clone of what was pushed', () => {
  const r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'lender/host'], { FAKE_HOST_EXEC: '1', FAKE_RUN_MS: '125000' });
  ok(r.status === 0 && /^PASS r\d{8}-\d{6}-[0-9a-f]{4} on lender\/host（3 分、success/m.test(r.text) && /PASS sim 3\/3/.test(r.text), r.text);
  const L = ledger(), d = L.find((x) => x.state === 'done');
  ok(L[0].state === 'dispatched' && L[0].job === 'sim' && L[0].unit === 'jsonui_demo' && d.minutes === 3 && d.ok === true && d.request === L[0].request, JSON.stringify(L));
  const res = JSON.parse(fs.readFileSync(path.join(d.result, 'result.json'), 'utf8'));
  ok(res.ok && res.job === 'sim' && /PASS sim/.test(res.summary.join('\n')) && !fs.readFileSync(path.join(d.result, 'log.txt'), 'utf8').includes(TOP), `the result and a log with no local paths: ${JSON.stringify(res)}`);
  eq(branches('lender/host'), ['main'], 'the work branch deleted');
  const calls = fs.readFileSync(path.join(GHD, 'calls.log'), 'utf8');
  ok(new RegExp(`workflow run host\\.yml --repo lender/host --ref lab/run-${d.request} -f job=sim -f unit=jsonui_demo -f request=${d.request}`).test(calls), calls.split('\n').filter((l) => /workflow/.test(l)).join('\n'));
  ok(/今月 3 分/.test(host(['list']).text), 'the month\'s minutes');
  ok(/PASS .*（3 分/.test(host(['results']).text), 'results: the last one');
});
await t('one at a time, and picked up where it stopped: --no-wait, then results; a second job waits for the first', () => {
  let r = host(['run', 'gate', '--on', 'lender/host', '--no-wait'], { FAKE_RUN_POLLS: '200' });
  ok(r.status === 0 && /結果: node lab\.mjs host results r/.test(r.text), r.text);
  const req = /host results (r\S+)/.exec(r.text)[1];
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'lender/host']);
  ok(r.status === 1 && /別の仕事が走っています/.test(r.text) && /自分の場で node lab\.mjs sim -a jsonui_demo/.test(r.text), r.text);
  r = host(['results', req]); ok(/まだ走っています/.test(r.text), r.text);
  setState((s) => { for (const x of s.runs) x.polls = 0; });
  r = host(['results', req]);
  ok(r.status === 0 && new RegExp(`PASS ${req} on lender/host`).test(r.text), r.text);
  eq(H.pending(ledger()), [], 'settled');
  eq(branches('lender/host'), ['main']);
});
await t('a start that never became a run is let go after ten minutes (the host is not held for ever)', () => {
  const L = path.join(STATE, 'host-ledger.jsonl'), at = new Date(Date.now() - 20 * 60_000).toISOString();
  fs.appendFileSync(L, JSON.stringify({ at, host: 'lender/host', request: 'r20260101-000000-dead', job: 'gate', state: 'dispatched', branch: 'lab/run-r20260101-000000-dead', run: null }) + '\n');
  const r = host(['results']);
  ok(/LOST r20260101-000000-dead on lender\/host/.test(r.text) && !H.pending(ledger()).length, r.text);
});
await t('the budget stops it with the reasons and what to do instead; other hosts are taken in its place (auto)', () => {
  // this month: 3 + 2 (gate's guess 15) … a host at 70 of 80
  const L = path.join(STATE, 'host-ledger.jsonl'), month = new Date().toISOString().slice(0, 7);
  fs.appendFileSync(L, JSON.stringify({ at: `${month}-01T12:00:00Z`, host: 'lender/host', request: 'rbig', job: 'gate', state: 'dispatched' }) + '\n' + JSON.stringify({ at: new Date().toISOString(), host: 'lender/host', request: 'rbig', state: 'done', minutes: 70, ok: true }) + '\n');
  let r = host(['run', 'gate', '--on', 'lender/host']);
  ok(r.status === 1 && /80%（80 分）を超えます/.test(r.text) && /auto gate/.test(r.text), r.text);
  lender('friend/host', { rules: { ...RULES, minutesPerMonth: 500 } });
  ok(host(['add', 'friend/host']).status === 0, 'a second host');
  r = host(['run', 'gate']);
  ok(r.status === 0 && /^friend\/host: gate/m.test(r.text) && /PASS r\S+ on friend\/host/.test(r.text), r.text);
});
await t('a withdrawn host (403/404 twice in a row) is not used; seen again, it is; a run that never shows up is settled as lost', () => {
  if (!state().repos['friend/host']) { lender('friend/host', { rules: { ...RULES, minutesPerMonth: 500 } }); host(['add', 'friend/host']); }
  setState((s) => { s.repos['friend/host'].withdrawn = 404; });
  let r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
  ok(r.status === 1 && /1 回目: 今回は使いません/.test(r.text) && /今は見えません/.test(r.text) && !ledger().some((x) => x.state === 'withdrawn'), `one 404 is not the end (GitHub has hiccups)\n${r.text}`);
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
  ok(r.status === 1 && /このホストはもう使いません/.test(r.text) && /使えなくなりました/.test(r.text), r.text);
  ok(ledger().some((x) => x.state === 'withdrawn' && x.host === 'friend/host'), 'written down');
  ok(/✘ 使えません/.test(host(['list']).text), 'list says so');
  setState((s) => { s.repos['friend/host'].withdrawn = null; });
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
  ok(r.status === 0 && /また見えるようになりました/.test(r.text) && /PASS r\S+ on friend\/host/.test(r.text), r.text);
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host'], { FAKE_NO_RUN: '1', LAB_HOST_FIND_MS: '1500' });
  ok(r.status === 1 && /LOST r\S+ on friend\/host/.test(r.text), r.text);
  eq(ledger().at(-1).state, 'lost');
  eq(branches('friend/host').filter((b) => b.startsWith('lab/run-')), [], 'its branch deleted');
});
await t('not the lender\'s doing (a rate limit, an organization\'s SSO): that run only, no strike; no write access, archived, rules gone or wrong: paused, never the old rules', () => {
  for (const why of ['ratelimit', 'sso']) {
    setState((s) => { s.repos['friend/host'].withdrawn = why; });
    const r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
    ok(r.status === 1 && /今回は使いません: 後でもう一度/.test(r.text) && !/回目/.test(r.text), r.text);
  }
  setState((s) => { s.repos['friend/host'].withdrawn = null; });
  const hostsNow = () => JSON.parse(fs.readFileSync(path.join(STATE, 'hosts.json'), 'utf8')).hosts['friend/host'];
  eq([hostsNow().strikes ?? 0, hostsNow().withdrawn], [0, null], 'no strike');
  setState((s) => { s.repos['friend/host'].push = false; });
  let r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
  ok(r.status === 1 && /書き込めません/.test(r.text), r.text);
  setState((s) => { s.repos['friend/host'].push = true; s.repos['friend/host'].archived = true; });
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
  ok(r.status === 1 && /アーカイブされています/.test(r.text), r.text);
  setState((s) => { s.repos['friend/host'].archived = false; });
  // the lender removes their rules (to stop lending): paused — the rules read before are not used in their place
  const main = (f) => { const w = fs.mkdtempSync(path.join(tmp, 'edit-')), g = (args) => spawnSync('git', args, { cwd: w, encoding: 'utf8', env: ENV }); g(['clone', '-q', `https://github.com/friend/host.git`, '.']); f(w); g(['add', '-A']); g(['commit', '-q', '-m', 'edit']); g(['push', '-q', 'origin', 'HEAD:main']); fs.rmSync(w, { recursive: true, force: true }); };
  main((w) => fs.rmSync(path.join(w, '.lab-host.json')));
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
  ok(r.status === 1 && /\.lab-host\.json: ありません（直るまで、このホストは使いません）/.test(r.text) && /直るまで使いません/.test(r.text), r.text);
  main((w) => fs.writeFileSync(path.join(w, '.lab-host.json'), JSON.stringify({ ...RULES, minutesPerMonth: 'lots' })));
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
  ok(r.status === 1 && /minutesPerMonth/.test(r.text) && /直るまで使いません/.test(r.text), r.text);
  main((w) => fs.writeFileSync(path.join(w, '.lab-host.json'), JSON.stringify({ ...RULES, minutesPerMonth: 500 })));
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host']);
  ok(r.status === 0 && /PASS r\S+ on friend\/host/.test(r.text), r.text);
});
await t('a run GitHub does not answer about is never "lost"; once seen, its number is kept and looked up straight', () => {
  const L = path.join(STATE, 'host-ledger.jsonl'), at = new Date(Date.now() - 20 * 60_000).toISOString();
  fs.appendFileSync(L, JSON.stringify({ at, host: 'friend/host', request: 'r20260102-000000-beef', job: 'sim', state: 'dispatched', branch: 'lab/run-r20260102-000000-beef', run: null }) + '\n');
  let r = host(['results'], { FAKE_LIST_FAIL: '1' });
  ok(/まだ走っています: r20260102-000000-beef/.test(r.text) && !/LOST r20260102/.test(r.text), r.text);
  r = host(['results']);
  ok(/LOST r20260102-000000-beef/.test(r.text), `answered "no run" by GitHub: let go\n${r.text}`);
  // a run seen while it ran: its number in the ledger, and the next look goes to it (not to the branch's list)
  r = host(['run', 'sim', '-a', 'jsonui_demo', '--on', 'friend/host', '--no-wait'], { FAKE_RUN_POLLS: '200' });
  const req = /host results (r\S+)/.exec(r.text)[1];
  host(['results', req]);
  const seen = ledger().find((x) => x.request === req && x.state === 'running');
  ok(seen && seen.run, JSON.stringify(ledger().filter((x) => x.request === req)));
  const before = fs.readFileSync(path.join(GHD, 'calls.log'), 'utf8').split('\n').length;
  setState((s) => { for (const x of s.runs) x.polls = 0; });
  r = host(['results', req], { FAKE_LIST_FAIL: '1' });
  ok(new RegExp(`PASS ${req} on friend/host`).test(r.text), r.text);
  ok(!fs.readFileSync(path.join(GHD, 'calls.log'), 'utf8').split('\n').slice(before).some((l) => /^run list/.test(l)), 'not looked for again');
});
await t('nothing is pushed when the check finds a secret or a borrowed addon (the file named, the secret not)', () => {
  const u = path.join(TOP, 'bds', 'addons', `zz_host_${process.pid}`), b = path.join(TOP, 'bds', 'addons', `borrowed_zzhost${process.pid}`);
  try {
    fs.mkdirSync(path.join(u, 'bp', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(u, 'bp', 'manifest.json'), '{"format_version":2,"header":{"name":"x","uuid":"00000000-0000-4000-8000-000000000001","version":[1,0,0]},"modules":[]}');
    fs.writeFileSync(path.join(u, 'bp', 'scripts', 'main.js'), `const key = 'ghp_${'A'.repeat(36)}';\n`);
    const before = branches('friend/host');
    let r = host(['run', 'sim', '-a', path.basename(u), '--on', 'friend/host']);
    ok(r.status === 1 && /STOP 送る前の検査で止めました（何も送っていません）/.test(r.text) && new RegExp(`${path.basename(u)}/bp/scripts/main\\.js:1: 秘密らしいもの（GitHub token）`).test(r.text) && !r.text.includes('A'.repeat(36)), r.text);
    eq(branches('friend/host'), before, 'nothing pushed');
    fs.cpSync(u, b, { recursive: true });
    fs.writeFileSync(path.join(b, 'bp', 'scripts', 'main.js'), '// fine\n');
    fs.writeFileSync(path.join(b, 'imported.json'), JSON.stringify({ borrowed: { url: 'https://example.org/x' } }));
    r = host(['run', 'sim', '-a', path.basename(b), '--on', 'friend/host']);
    ok(r.status === 1 && /借りたアドオン/.test(r.text), r.text);
  } finally { fs.rmSync(u, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); }
});
await t('on the host: the lender\'s own rules refuse a job they do not allow (whatever the person\'s lab said); the result says why', () => {
  const w = fs.mkdtempSync(path.join(tmp, 'job-')), rf = path.join(w, 'rules.json');
  fs.writeFileSync(rf, JSON.stringify({ ...RULES, jobs: ['gate'] }));
  const run = (env) => spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'host', '__job'], { cwd: TOP, encoding: 'utf8', env: { ...process.env, HOST_RULES: rf, ...env } });
  try {
    let r = run({ HOST_JOB: 'sim', HOST_UNIT: 'jsonui_demo', HOST_REQUEST: 'r20261006-000000-abcd' });
    const res = JSON.parse(fs.readFileSync(path.join(TOP, 'host-result', 'result.json'), 'utf8'));
    ok(r.status === 1 && res.ok === false && /sim は許されていません/.test(res.refused), JSON.stringify(res));
    r = run({ HOST_JOB: 'gate', HOST_REQUEST: '$(rm -rf /)' });
    ok(r.status === 1 && /request の形が違います/.test(JSON.parse(fs.readFileSync(path.join(TOP, 'host-result', 'result.json'), 'utf8')).refused), 'a request id of the wrong shape');
  } finally { fs.rmSync(path.join(TOP, 'host-result'), { recursive: true, force: true }); }
});
await t('the autopilot: auto gate --on runs the gate on a host, auto shows each host\'s minutes, gateOn is checked', () => {
  const lab = (args) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', timeout: 600_000, env: ENV }); return { status: r.status, text: (r.stdout ?? '') + (r.stderr ?? '') }; };
  let r = lab(['auto', 'gate', '--on', 'friend/host']);
  ok(r.status === 0 && /^friend\/host: gate/m.test(r.text) && /PASS r\S+ on friend\/host/.test(r.text), r.text);
  r = lab(['auto']);
  ok(/^hosts \(gate local\): .*friend\/host \d+\/400 分（\d{4}-\d\d）/m.test(r.text) && /lender\/host 7\d\/80 分/.test(r.text), r.text);
  r = lab(['auto', 'policy', 'gateOn=nowhere']);
  ok(r.status === 1 && /gateOn=nowhere: local \| auto \| <owner\/repo>/.test(r.text), r.text);
});
await t('host report: the month in numbers for the lender (no units, no contents); written as an Issue only when asked and confirmed', () => {
  let r = host(['report', 'lender/host']);
  ok(r.status === 0 && /# bds-lab: lender\/host の \d{4}-\d\d（Asia\/Tokyo）/.test(r.text) && /使った分: 7[3-9] 分 \/ 上限 100 分/.test(r.text) && /\| sim \| 1 \| 1 \| 3 \|/.test(r.text) && !/jsonui_demo/.test(r.text), r.text);
  r = host(['report', 'lender/host', '--issue']);
  ok(r.status === 1 && /確かめます/.test(r.text) && !state().issues.length, 'not written without a yes');
  r = host(['report', 'lender/host', '--issue', '--yes']);
  ok(r.status === 0 && state().issues.length === 1 && /使った分/.test(state().issues[0].body) && !/jsonui_demo|sk-ant/.test(state().issues[0].body), r.text);
  r = host(['forget', 'friend/host']); ok(r.status === 0 && !JSON.parse(fs.readFileSync(path.join(STATE, 'hosts.json'), 'utf8')).hosts['friend/host'], r.text);
});

await t('host ci (hostrun.yml, started from the management panel): on a fresh runner with the person\'s LAB_HOST_TOKEN — the host added, GitHub\'s own count of the month (everyone\'s runs) stops it at 80%, the result in the summary, an annotation and HOST_OUT; the host\'s words never read as workflow commands', () => {
  const fresh = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };
  const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const ci = (extra) => host(['ci'], { LAB_HOST_CI: '1', GH_TOKEN: 'ghs_test', HOST_ON: 'lender/host', HOST_JOB: 'sim', HOST_UNIT: 'jsonui_demo', HOST_WAIT: 'true', ...extra });
  let r = host(['ci'], { LAB_HOST_CI: '1', HOST_ON: 'lender/host', HOST_JOB: 'sim' });
  ok(r.status === 1 && /LAB_HOST_TOKEN/.test(r.text) && /Secrets/.test(r.text), `no token: what to set, where\n${r.text}`);
  r = host(['ci'], { GH_TOKEN: 'x', HOST_JOB: 'gate' });
  ok(r.status === 1 && /hostrun\.yml の中で/.test(r.text), `not in Actions: said\n${r.text}`);
  r = ci({ LAB_HOST_STATE: fresh('ci0'), HOST_ON: 'auto', LAB_HOSTS: '' });
  ok(r.status === 1 && /LAB_HOSTS/.test(r.text), r.text);
  r = ci({ LAB_HOST_STATE: fresh('ci0b'), HOST_ON: 'auto', LAB_HOSTS: 'lender/host,$(id)' });
  ok(r.status === 1 && /\$\(id\) は owner\/repo ではありません/.test(r.text), r.text);
  // passes: a fresh runner (no ledger), GitHub counting 10 of the month's minutes
  setState((x) => { x.ghRuns = { 'lender/host': [{ status: 'completed', conclusion: 'success', run_started_at: iso(now - 60_000), updated_at: iso(now + 9 * 60_000) }] }; });
  const sum = path.join(tmp, 'summary.md'), outDir = path.join(tmp, 'hostrun-result');
  r = ci({ LAB_HOST_STATE: fresh('ci1'), GITHUB_STEP_SUMMARY: sum, HOST_OUT: outDir });
  const stop = /^::stop-commands::([0-9a-f]{16})$/m.exec(r.text)?.[1];
  ok(r.status === 0 && /^OK lender\/host: 1 か月 100 分/m.test(r.text) && /^lender\/host: sim -a jsonui_demo · .* 今月 10\/80 分/m.test(r.text) && /^PASS r\S+ on lender\/host/m.test(r.text) && !/::error/.test(r.text), r.text);
  ok(stop && r.text.indexOf(`::stop-commands::${stop}`) < r.text.indexOf('PASS r') && r.text.indexOf('PASS r') < r.text.indexOf(`::${stop}::`), `what the host says is printed between stop-commands and its resume\n${r.text}`);
  ok(/## ✅ sim -a jsonui_demo（ホスト: lender\/host）/.test(fs.readFileSync(sum, 'utf8')) && /PASS r/.test(fs.readFileSync(sum, 'utf8')), fs.readFileSync(sum, 'utf8'));
  const got = fs.readdirSync(outDir);
  ok(got.length === 1 && fs.existsSync(path.join(outDir, got[0], 'result.json')), `the result for the run's artifact: ${got}`);
  eq(branches('lender/host'), ['main'], 'the work branch gone');
  // GitHub's count: 79 minutes used (by anyone) — the empty ledger of a fresh runner does not let it through
  setState((x) => { x.ghRuns['lender/host'] = [{ status: 'completed', conclusion: 'success', run_started_at: iso(now - 60_000), updated_at: iso(now + 78 * 60_000) }]; });
  r = ci({ LAB_HOST_STATE: fresh('ci2') });
  ok(r.status === 1 && /今月 79 分 \+ この仕事の見込み 2 分が、上限 100 分の 80%（80 分）を超えます/.test(r.text) && /^::error title=host sim::.*80%25（80 分）/m.test(r.text), `stopped by GitHub's count, the reason as an annotation (escaped)\n${r.text}`);
  // a run going there now (someone else's): one at a time
  setState((x) => { x.ghRuns['lender/host'] = [{ status: 'in_progress', run_started_at: iso(now - 60_000), updated_at: iso(now) }]; });
  r = ci({ LAB_HOST_STATE: fresh('ci3') });
  ok(r.status === 1 && /別の仕事が走っています/.test(r.text), r.text);
  // the job failed on the host: this run fails, the host's lines in its annotation
  setState((x) => { x.ghRuns['lender/host'] = []; });
  r = ci({ LAB_HOST_STATE: fresh('ci4'), HOST_JOB: 'gate', HOST_UNIT: '', FAKE_RUN_OK: '0' });
  ok(r.status === 1 && /^FAIL r\S+ on lender\/host/m.test(r.text) && /^::error title=host gate::.*FAIL gate: tests\/x-offline\.mjs/m.test(r.text), r.text);
  setState((x) => { delete x.ghRuns; });
});

await t('host ci, auto with the lab\'s App: a token minted on each LAB_HOSTS host the App is on (masked before workflow commands stop counting), each host asked with its own; one without the App on LAB_HOST_TOKEN; the App\'s key never reaches what it starts', async () => {
  const fresh = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); return d; };
  lender('friend/fork', { rules: { ...RULES, minutesPerMonth: 50000 } });
  // (GitHub's App side, a process of its own: the App is on friend/fork alone — a token for it; anything else: 404)
  const srv = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    const s = http.createServer((q, r) => {
      const send = (c, j) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(j)); };
      if (q.method === 'GET' && q.url === '/repos/friend/fork/installation') return send(200, { id: 77 });
      if (q.method === 'POST' && q.url === '/app/installations/77/access_tokens') return send(201, { token: 'ghs_appforktoken', expires_at: '2099-01-01T00:00:00Z', permissions: { contents: 'write' } });
      send(404, { message: 'Not Found' });
    }).listen(0, '127.0.0.1', () => console.log(s.address().port));`], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((res, rej) => { srv.stdout.once('data', (d) => res(String(d).trim())); srv.once('exit', () => rej(new Error('no server'))); });
    const pem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
    fs.writeFileSync(path.join(GHD, 'tokens.log'), '');
    const r = host(['ci'], { LAB_HOST_CI: '1', LAB_HOST_STATE: fresh('ci-app'), GH_TOKEN: 'ghs_labhosttoken', HOST_ON: 'auto', LAB_HOSTS: 'lender/host friend/fork', HOST_JOB: 'sim', HOST_UNIT: 'jsonui_demo', HOST_WAIT: 'true', APP_ID: '4242', APP_PRIVATE_KEY: pem, GITHUB_API_URL: `http://127.0.0.1:${port}` });
    const stop = /^::stop-commands::([0-9a-f]{16})$/m.exec(r.text)?.[1];
    ok(r.status === 0 && /^PASS r\S+ on friend\/fork/m.test(r.text), `the fork lending the most was chosen and ran\n${r.text}`);
    ok(r.text.indexOf('::add-mask::ghs_appforktoken') >= 0 && r.text.indexOf('::add-mask::ghs_appforktoken') < r.text.indexOf(`::stop-commands::${stop}`), `the App's token masked before workflow commands stop counting\n${r.text}`);
    ok(/lender\/host: ラボの App のトークンはありません.*LAB_HOST_TOKEN で/.test(r.text), `a host without the App: said, on LAB_HOST_TOKEN\n${r.text}`);
    const tl = fs.readFileSync(path.join(GHD, 'tokens.log'), 'utf8').split('\n').filter(Boolean);
    const by = (re) => tl.filter((l) => re.test(l)).map((l) => l.split(' ')[0]);
    ok(by(/friend\/fork/).length && by(/friend\/fork/).every((x) => x === 'ghs_appforktoken'), `every ask of friend/fork with its App token\n${tl.join('\n')}`);
    ok(by(/lender\/host/).length && by(/lender\/host/).every((x) => x === 'ghs_labhosttoken'), `lender/host with LAB_HOST_TOKEN\n${tl.join('\n')}`);
    ok(!tl.some((l) => / KEY /.test(l)), `the App's key reached nothing it started\n${tl.join('\n')}`);
    // no LAB_HOST_TOKEN at all: the App's tokens are enough
    const r2 = host(['ci'], { LAB_HOST_CI: '1', LAB_HOST_STATE: fresh('ci-app2'), HOST_ON: 'auto', LAB_HOSTS: 'friend/fork', HOST_JOB: 'sim', HOST_UNIT: 'jsonui_demo', HOST_WAIT: 'true', APP_ID: '4242', APP_PRIVATE_KEY: pem, GITHUB_API_URL: `http://127.0.0.1:${port}` });
    ok(r2.status === 0 && /^PASS r\S+ on friend\/fork/m.test(r2.text), r2.text);
  } finally { srv.kill(); }
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? 'FAIL' : 'OK'} host-offline: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
