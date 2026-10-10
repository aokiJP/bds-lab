// verify's plan (common/verify-plan.mjs) without GitHub: each changed file's need (the autopilot's memory and the change log:
// none; the panel alone: the panel's own tests; docs, other workflows, the offline tests: every offline test; the engine, the
// addons, verify.yml itself: the real server too), the plan from them (the same content: nothing; by hand or [full ci], or no
// passed commit: everything), the panel files code outside the panel loads (a comment or a .md is not a load; what they import
// is), and the whole run on a temp git repository with a fake GitHub — the base is the last commit a push or a by-hand run
// passed on (a pull request's run is not: it tested a merge), a re-run is not its own base, GitHub refusing makes the whole run,
// the outputs and the summary written, the token never printed.
// node tests/verify-plan-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = await import(pathToFileURL(path.join(TOP, 'common', 'verify-plan.mjs')).href);
const R = await import(pathToFileURL(path.join(TOP, 'common', 'run-tests.mjs')).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-verifyplan-'));
// (made-up panel files: a real one named here would read as loaded from outside the panel)
const PUI = 'panel/ui/zz-tab.mjs', PLIB = 'panel/lib/zz-lib.mjs';

await t('each changed file\'s need (pure): nothing / panel / offline / all — a panel file loaded from outside is all', () => {
  const ext = new Set(['panel/lib/zz-pages.mjs']);
  const want = {
    'auto/ledger.jsonl': 'nothing', 'CHANGES.md': 'nothing',
    [PUI]: 'panel', [PLIB]: 'panel', 'panel/README.md': 'panel', 'panel/sw.js': 'panel', 'tests/units-offline.mjs': 'panel', 'tests/panel-browser.mjs': 'panel',
    'panel/lib/zz-pages.mjs': 'all',
    'README.md': 'offline', 'AGENTS.md': 'offline', 'docs/guide/host.md': 'offline', 'auth/worker.mjs': 'offline', '.github/workflows/unit.yml': 'offline',
    '.github/bds-lab-panel.json': 'offline', '.claude/hooks/no-repo-delete.mjs': 'offline', 'tests/share-offline.mjs': 'offline', 'tests/offline.mjs': 'offline',
    'common/verify-plan.mjs': 'offline', 'common/run-tests.mjs': 'offline', 'host/template/README.md': 'offline',
    '.github/workflows/verify.yml': 'all', 'common/core.mjs': 'all', 'lab.mjs': 'all', 'bds/addons/coins/src/main.ts': 'all', 'app/lib/play.mjs': 'all',
    'tests/dev-bds.mjs': 'all', 'tests/play-bds.mjs': 'all', 'skills/bds-from-scratch/SKILL.md': 'all', 'bds/vendor/bds-version.txt': 'all',
  };
  for (const [f, n] of Object.entries(want)) eq(V.need(f, ext), n, f);
});

await t('the plan (pure): the same content = nothing; the panel alone = its own tests, the browser apart, no real server; anything else = every offline test; the engine = the real server too', () => {
  const same = V.planVerify({ base: 'a1b2c3d4e5f6', files: [] });
  eq([same.offline, same.bds, same.tests], ['none', false, []]);
  ok(/前に通った a1b2c3d と同じ中身/.test(same.why), same.why);
  eq(V.planVerify({ base: 'a1b2c3d4', files: ['auto/ledger.jsonl', 'CHANGES.md'] }).offline, 'none', 'the autopilot\'s row and the change log');
  const panel = V.planVerify({ base: 'a1b2c3d4', files: [PUI, 'tests/units-offline.mjs', 'CHANGES.md'] });
  eq([panel.offline, panel.bds, panel.browser], ['panel', false, true]);
  ok(panel.tests.includes('tests/panel-offline.mjs') && panel.tests.includes('tests/units-offline.mjs') && !panel.tests.includes('tests/panel-browser.mjs'), panel.tests.join(' '));
  ok(/3 個のファイルが変わった/.test(panel.why) && /パネルの分だけ/.test(panel.why) && /本物の BDS: 流さない/.test(panel.why), panel.why);
  const only = V.planVerify({ base: 'a1b2c3d4', files: ['tests/units-offline.mjs'] });
  eq([only.offline, only.tests, only.browser], ['panel', ['tests/units-offline.mjs'], false], 'a panel test alone: itself');
  const docs = V.planVerify({ base: 'a1b2c3d4', files: [PUI, 'README.md'] });
  eq([docs.offline, docs.bds, docs.browser, docs.tests], ['full', false, true, []]);
  const wf = V.planVerify({ base: 'a1b2c3d4', files: ['.github/workflows/unit.yml'] });
  eq([wf.offline, wf.bds], ['full', false]);
  for (const f of ['.github/workflows/verify.yml', 'common/core.mjs', 'bds/vendor/bds-version.txt']) {
    const p = V.planVerify({ base: 'a1b2c3d4', files: [PUI, f, 'bds/addons/coins/tests.txt'] });
    eq([p.offline, p.bds, p.bdsParts, p.addons], ['full', true, ['bench', 'scratch', 'dev', 'addons'], 'all'], f);
    ok(p.why.includes(`本物の BDS: すべて（${f}`), p.why);
  }
  const ext = V.planVerify({ base: 'a1b2c3d4', files: ['panel/lib/zz-pages.mjs'], external: new Set(['panel/lib/zz-pages.mjs']) });
  eq([ext.offline, ext.bds], ['full', true], 'a panel file loaded from outside');
});

await t('the extra ones asked for (pure): by hand, or the marker in the commit\'s title — not only named in its text', () => {
  eq([V.fullAsked('workflow_dispatch', ''), V.fullAsked('push', '[full ci] the engine changed'), V.fullAsked('push', 'the engine changed [full ci]\n\nwhy')], [true, true, true]);
  eq([V.fullAsked('push', 'verify plans its jobs\n\n- by hand or [full ci] in the commit: everything'), V.fullAsked('push', ''), V.fullAsked('push', null)], [false, false, false]);
});

await t('an addon\'s own files alone (pure): only those addons\' tests on the real server — none for one deleted; an odd name or the engine too: every part', () => {
  const one = V.planVerify({ base: 'a1b2c3d4', files: ['bds/addons/coins/src/main.ts', 'bds/addons/coins/tests.txt', 'bds/addons/shop/bp/manifest.json', 'CHANGES.md'] });
  eq([one.offline, one.bds, one.bdsParts, one.addons], ['full', true, ['addons'], ['coins', 'shop']]);
  ok(/本物の BDS: アドオン coins、shop の試験だけ/.test(one.why), one.why);
  const gone = V.planVerify({ base: 'a1b2c3d4', files: ['bds/addons/old/src/main.ts'], present: (n) => n !== 'old' });
  eq([gone.offline, gone.bds, gone.bdsParts, gone.addons], ['full', false, [], []]);
  ok(/変わったアドオンはもうない/.test(gone.why), gone.why);
  for (const files of [['bds/addons/we ird/x.ts'], ['bds/addons/coins/x.ts', 'bds/kit.ts'], ['bds/addons/coins/x.ts', 'skills/bds-from-scratch/SKILL.md']]) {
    const p = V.planVerify({ base: 'a1b2c3d4', files });
    eq([p.bds, p.bdsParts, p.addons], [true, ['bench', 'scratch', 'dev', 'addons'], 'all'], files.join(' '));
  }
  const none = V.planVerify({ base: 'a1b2c3d4', files: [PUI] });
  eq([none.bds, none.bdsParts], [false, []], 'the panel alone: no part');
  eq([V.planVerify({ full: true }).bdsParts, V.planVerify({}).addons], [['bench', 'scratch', 'dev', 'addons'], 'all'], 'everything: every part');
});

await t('everything (pure): by hand or [full ci], no passed commit, or a reason given', () => {
  for (const p of [V.planVerify({ full: true, base: 'a1b2c3d4', files: [PUI] }), V.planVerify({ base: null, files: [] }), V.planVerify({ full: true, reason: '計画を作れない（x）: すべての試験' })]) eq([p.offline, p.bds, p.browser], ['full', true, true]);
  ok(/手で始めた/.test(V.planVerify({ full: true }).why) && /見つからない/.test(V.planVerify({}).why), 'said why');
});

// ---- a temp git repository ----
const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const put = (dir, files) => { for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); } };
const commit = (dir, files, msg) => { put(dir, files); git(dir, 'add', '-A'); git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };
const repo = (name) => { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); git(d, 'init', '-q'); return d; };

await t('panel files loaded from outside: an import or a string in code, and what they import inside the panel; not a comment, a .md, the panel itself or its own CLI', () => {
  const d = repo('ext');
  commit(d, {
    'app/lib/live.mjs': "import { PAGES } from '../../panel/lib/a.mjs';\n",
    'panel/lib/a.mjs': "import { B } from './b.mjs';\nexport const PAGES = B;\n",
    'panel/lib/b.mjs': "import { C } from '../ui/c.mjs';\nexport const B = C;\n",
    'panel/ui/c.mjs': 'export const C = 1;\n',
    'panel/ui/v.mjs': "import { D } from '../lib/d.mjs';\n",
    'panel/lib/d.mjs': 'export const D = 1;\n',
    'common/y.mjs': '// the panel counts the same (panel/lib/e.mjs)\n  * and so on (panel/lib/e2.mjs) */\n',
    'docs/z.md': 'see panel/lib/f.mjs\n',
    'common/schedule.mjs': "import * as S from '../panel/lib/g.mjs';\n",
    'common/z.mjs': "export const HOST_MODULE = 'panel/lib/h.mjs';\n",
    'panel/lib/h.mjs': "export * from './i.mjs';\n",
    'panel/lib/i.mjs': 'export const I = 1;\n',
  }, 'one');
  eq([...V.externalPanel(d)].sort(), ['panel/lib/a.mjs', 'panel/lib/b.mjs', 'panel/lib/h.mjs', 'panel/lib/i.mjs', 'panel/ui/c.mjs']);
  eq([...V.externalPanel(repo('empty'))], [], 'nothing found: none');
});

const fakeGitHub = (runs, seen = []) => async (url, init) => {
  seen.push({ url: String(url), auth: init?.headers?.authorization });
  if (runs === 500) return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ workflow_runs: runs }) };
};
const envFor = (d, extra = {}) => {
  const o = path.join(d, '..', `${path.basename(d)}-out.txt`), s = path.join(d, '..', `${path.basename(d)}-sum.md`), ev = path.join(d, '..', `${path.basename(d)}-event.json`);
  fs.writeFileSync(o, ''); fs.writeFileSync(s, ''); fs.writeFileSync(ev, JSON.stringify({ head_commit: { message: extra.message ?? 'a change' } }));
  return { GITHUB_OUTPUT: o, GITHUB_STEP_SUMMARY: s, GITHUB_EVENT_PATH: ev, GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'o/r', GITHUB_API_URL: 'http://fake', GITHUB_TOKEN: 'tok-SECRET-1234', GITHUB_RUN_ATTEMPT: '1', ...extra };
};
const quiet = () => { const said = []; return { said, out: (l) => said.push(l) }; };

await t('the run on a repository: the base is the last commit a push passed on (a pull request\'s success is not), the panel alone → its tests; outputs and summary written; the token asked with, never printed', async () => {
  const d = repo('run');
  const c1 = commit(d, { 'common/core.mjs': 'x\n', [PUI]: 'a\n', 'CHANGES.md': '# c\n' }, 'base');
  const c2 = commit(d, { [PUI]: 'b\n' }, 'panel');
  commit(d, { 'CHANGES.md': '# c2\n', 'auto/ledger.jsonl': '{}\n' }, 'notes');
  const seen = [], q = quiet(), env = envFor(d);
  const p = await V.main({ env, cwd: d, fetchImpl: fakeGitHub([{ head_sha: c2, event: 'pull_request' }, { head_sha: c1, event: 'push' }], seen), out: q.out });
  eq([p.offline, p.bds, p.browser], ['panel', false, true]);
  ok(p.why.startsWith(`前に通った ${c1.slice(0, 7)} から 3 個のファイルが変わった`), p.why);
  const outText = fs.readFileSync(env.GITHUB_OUTPUT, 'utf8');
  ok(/^offline=panel$/m.test(outText) && /^bds=false$/m.test(outText) && /^browser=true$/m.test(outText) && /^tests=tests\/panel-offline\.mjs( tests\/[\w-]+\.mjs)+$/m.test(outText), outText);
  ok(/^### verify の計画\n前に通った/.test(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')), 'summary');
  eq(seen.map((x) => [x.url, x.auth]), [['http://fake/repos/o/r/actions/workflows/verify.yml/runs?status=success&per_page=100', 'Bearer tok-SECRET-1234']]);
  ok(!q.said.join('\n').includes('SECRET') && !outText.includes('SECRET'), 'the token never printed');
});

await t('the same content: nothing runs; a re-run is not its own base; an engine change: the real server', async () => {
  const d = repo('same');
  const c1 = commit(d, { 'common/core.mjs': 'x\n' }, 'base');
  const c2 = commit(d, { [PUI]: 'a\n' }, 'panel');
  const runs = [{ head_sha: c2, event: 'push' }, { head_sha: c1, event: 'workflow_dispatch' }];
  eq((await V.main({ env: envFor(d), cwd: d, fetchImpl: fakeGitHub(runs), out: quiet().out })).offline, 'none', 'HEAD passed: the same content');
  // (an addon whose files alone changed: only its tests on the real server — present in the checkout or not)
  const c3 = commit(d, { 'bds/addons/coins/bp/manifest.json': '{}\n', 'bds/addons/coins/tests.txt': 'x\n', 'bds/addons/gone/tests.txt': 'x\n' }, 'addons');
  const envA = envFor(d), pa = await V.main({ env: envA, cwd: d, fetchImpl: fakeGitHub([{ head_sha: c2, event: 'push' }]), out: quiet().out });
  eq([pa.bds, pa.bdsParts, pa.addons], [true, ['addons'], ['coins']], 'gone has no bp/manifest.json');
  const outA = fs.readFileSync(envA.GITHUB_OUTPUT, 'utf8');
  ok(/^bdsparts=\["addons"\]$/m.test(outA) && /^addons=coins$/m.test(outA), outA);
  git(d, 'reset', '-q', '--hard', c2); ok(!!c3, 'c3 made');
  const again = await V.main({ env: envFor(d, { GITHUB_RUN_ATTEMPT: '2' }), cwd: d, fetchImpl: fakeGitHub(runs), out: quiet().out });
  eq([again.offline, again.bds], ['panel', false], 'a re-run: counted from the commit before');
  commit(d, { 'common/core.mjs': 'y\n' }, 'engine');
  const envE = envFor(d), eng = await V.main({ env: envE, cwd: d, fetchImpl: fakeGitHub(runs), out: quiet().out });
  eq([eng.offline, eng.bds, eng.bdsParts, eng.addons], ['full', true, ['bench', 'scratch', 'dev', 'addons'], 'all']);
  ok(/^bdsparts=\["bench","scratch","dev","addons"\]$/m.test(fs.readFileSync(envE.GITHUB_OUTPUT, 'utf8')) && /^addons=all$/m.test(fs.readFileSync(envE.GITHUB_OUTPUT, 'utf8')), 'outputs');
  // (every offline test on one runner: more runners cost more minutes than they save in waiting — common/verify-plan.mjs SHARDS)
  ok(/^shards=\[1\]$/m.test(fs.readFileSync(envE.GITHUB_OUTPUT, 'utf8')) && /^nshards=1$/m.test(fs.readFileSync(envE.GITHUB_OUTPUT, 'utf8')), 'every offline test: one runner');
});

await t('everything: by hand, [full ci], GitHub refusing (said, not a failure), no passed commit', async () => {
  const d = repo('full');
  const c1 = commit(d, { 'common/core.mjs': 'x\n' }, 'base');
  commit(d, { [PUI]: 'a\n' }, 'panel');
  const runs = [{ head_sha: c1, event: 'push' }];
  for (const env of [envFor(d, { GITHUB_EVENT_NAME: 'workflow_dispatch' }), envFor(d, { message: 'big change [full ci]' })]) {
    const p = await V.main({ env, cwd: d, fetchImpl: fakeGitHub(runs), out: quiet().out });
    eq([p.offline, p.bds, p.extra], ['full', true, true]);
    ok(/^extra=true$/m.test(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8')), 'extra in the outputs');
  }
  const named = envFor(d, { message: 'verify plans its jobs\n\n- by hand or [full ci] in the commit: everything' });
  const p2 = await V.main({ env: named, cwd: d, fetchImpl: fakeGitHub(runs), out: quiet().out });
  eq([p2.offline, p2.bds, p2.extra], ['panel', false, false], 'the marker only named in the text');
  ok(/^extra=false$/m.test(fs.readFileSync(named.GITHUB_OUTPUT, 'utf8')), 'extra=false');
  const q = quiet(), env = envFor(d);
  const refused = await V.main({ env, cwd: d, fetchImpl: fakeGitHub(500), out: q.out });
  eq([refused.offline, refused.bds, refused.extra], ['full', true, false], 'everything, not the extra ones');
  ok(/計画を作れない（GitHub が 500 で断りました）/.test(refused.why) && /^bds=true$/m.test(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8')), refused.why);
  const none = await V.main({ env: envFor(d), cwd: d, fetchImpl: fakeGitHub([]), out: quiet().out });
  eq([none.offline, none.bds], ['full', true], 'no passed commit');
});

await t('every offline test on n runners (run-tests shardOf, pure): each test in exactly one shard, in the list\'s order, the same split every time; the long ones apart; the serial ones spread; shard 1\'s own steps counted', () => {
  const list = Array.from({ length: 40 }, (_, k) => `tests/t${String(k).padStart(2, '0')}-offline.mjs`);
  const time = Object.fromEntries(list.map((t, k) => [t, 5 + ((k * 37) % 90)]));
  for (const n of [1, 2, 3, 4, 6]) {
    const parts = Array.from({ length: n }, (_, k) => R.shardOf(list, k + 1, n, { time }));
    eq(parts.flat().sort(), [...list].sort(), `n=${n}: every test once`);
    for (const p of parts) eq(p, list.filter((t) => p.includes(t)), `n=${n}: the list's order`);
    eq(parts, Array.from({ length: n }, (_, k) => R.shardOf(list, k + 1, n, { time })), `n=${n}: the same split again`);
  }
  // (the serial ones — a runner's own folder — never all on one runner; the two longest side by side ones apart)
  const ser = ['tests/app-offline.mjs', 'tests/host-offline.mjs', 'tests/make-offline.mjs', 'tests/colony-offline.mjs'];
  const big = { 'tests/app-offline.mjs': 600, 'tests/host-offline.mjs': 120, 'tests/make-offline.mjs': 90, 'tests/colony-offline.mjs': 80, 'tests/offline.mjs': 400, 'tests/env-offline.mjs': 380 };
  const all = [...list, ...Object.keys(big)], t2 = { ...time, ...big };
  const four = Array.from({ length: 4 }, (_, k) => R.shardOf(all, k + 1, 4, { time: t2 }));
  ok(four.every((p) => ser.filter((x) => p.includes(x)).length < ser.length), 'the serial ones spread');
  ok(four.findIndex((p) => p.includes('tests/offline.mjs')) !== four.findIndex((p) => p.includes('tests/env-offline.mjs')), 'the two longest side by side apart');
  ok(four.findIndex((p) => p.includes('tests/app-offline.mjs')) !== four.findIndex((p) => p.includes('tests/host-offline.mjs')), 'the two longest serial apart');
  // (shard 1 with its own steps besides: it takes less of the list)
  const sum = (p) => p.reduce((n, x) => n + (t2[x] ?? 60), 0);
  const plain = R.shardOf(all, 1, 4, { time: t2 }), lighter = R.shardOf(all, 1, 4, { time: t2, first: 600 });
  ok(sum(lighter) < sum(plain), `shard 1 lighter with first: ${sum(lighter)} < ${sum(plain)}`);
  // (a test not timed counts as a minute: still in exactly one shard)
  eq(Array.from({ length: 3 }, (_, k) => R.shardOf([...list, 'tests/new-offline.mjs'], k + 1, 3, { time })).flat().filter((x) => x === 'tests/new-offline.mjs').length, 1);
  for (const [i, n] of [[0, 4], [5, 4], [1, 0], [1.5, 2]]) { let threw = false; try { R.shardOf(list, i, n); } catch { threw = true; } ok(threw, `shard ${i}/${n} refused`); }
  eq(R.shardOf([], 2, 3), [], 'nothing: nothing');
});

await t('the workflows agree with the code: verify.yml runs each part the plan can name; notify.yml starts a runner exactly for the runs app notify tells (its if, evaluated as GitHub does: strings without case)', async () => {
  const verify = fs.readFileSync(path.join(TOP, '.github', 'workflows', 'verify.yml'), 'utf8');
  for (const part of V.BDS_PARTS) ok(verify.includes(`matrix.part == '${part}'`), `verify.yml runs the part ${part}`);
  for (const o of ['offline', 'shards', 'nshards', 'tests', 'browser', 'bds', 'bdsparts', 'addons', 'extra']) ok(verify.includes(`${o}: \${{ steps.plan.outputs.${o} }}`), `the plan job hands on ${o}`);
  ok(verify.includes('shard: ${{ fromJSON(needs.plan.outputs.shards) }}') && verify.includes('auto gate --all --shard ${{ matrix.shard }}/${{ needs.plan.outputs.nshards }}'), 'every offline test: on the plan\'s shards');
  const RM = await import(pathToFileURL(path.join(TOP, 'app', 'lib', 'runmsg.mjs')).href);
  const yml = fs.readFileSync(path.join(TOP, '.github', 'workflows', 'notify.yml'), 'utf8');
  const expr = /^ {4}if: >-\n((?: {6}.*\n)+)/m.exec(yml)?.[1].replace(/\s+/g, ' ').trim();
  ok(expr, 'the notify job\'s if');
  const js = expr.replace(/github\.event_name/g, 'E').replace(/github\.event\.workflow_run\.conclusion/g, 'C').replace(/github\.event\.workflow_run\.event/g, 'V').replace(/vars\.LAB_NOTIFY/g, 'P')
    .replace(/!=/g, '!==').replace(/([^!=])==([^=])/g, '$1===$2').replace(/'([^']*)'/g, (_, x) => `'${x.toLowerCase()}'`);
  ok(!/[A-Za-z_]\.[A-Za-z_]/.test(js.replace(/'[^']*'/g, '')), `every context understood: ${js}`);
  const starts = new Function('E', 'C', 'V', 'P', `return (${js});`);
  for (const P of ['', 'auto', 'ALL', 'all', 'failures', 'off', 'Off', 'something']) for (const C of ['success', 'failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required']) for (const V of ['push', 'workflow_dispatch', 'schedule']) {
    const run = { status: 'completed', conclusion: C, event: V };
    eq(starts('workflow_run', C, V, P.toLowerCase()), RM.shouldNotify(run, P), `LAB_NOTIFY=${P || '(none)'} ${C} ${V}`);
  }
  ok(starts('workflow_dispatch', '', '', ''), 'by hand: always');
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
