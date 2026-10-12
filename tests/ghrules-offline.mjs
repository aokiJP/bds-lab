// GitHub's rules for what the panel sends (panel/lib/ghrules.mjs) without a network: every write lib/gh.mjs makes has its kind
// and rules, each rule says where it comes from, the sure ones stop a write before it is sent (a 422 with the next step, no
// request, no secret in the words) and the rest only the fakes use; what lib/setup.mjs hands GitHub's pages (the App's
// manifest, the token page's address, the install link) keeps every rule — and the three times GitHub refused it (no
// hook_attributes.url, a #fragment in redirect_url, Variables as `variables` alone) are caught again when setup.mjs is put back
// as it was before each fix.
// node tests/ghrules-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const R = await imp('panel/lib/ghrules.mjs'), S = await imp('panel/lib/setup.mjs'), G = await imp('panel/lib/gh.mjs'), RS = await imp('panel/lib/rescue.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const PANEL = 'https://o.github.io/bds-lab/', AUTH = 'https://bds-lab-auth.o.workers.dev';
const WRITES = ['secrets.put', 'secrets.delete', 'variables.create', 'variables.update', 'dispatch', 'contents.put', 'issues.create', 'issues.update', 'issues.lock', 'comments.create', 'labels.create', 'collaborators.put', 'invitations.accept', 'pages.create', 'pages.update', 'merge-upstream', 'workflows.enable', 'workflows.disable', 'runs.cancel', 'runs.rerun', 'app-manifests.conversions'];

await t('every kind has rules, each with an id, strict, where it comes from and a test', () => {
  for (const k of [...WRITES, 'appManifest', 'tokenUrl', 'installLink']) ok(R.kinds.includes(k) && R.RULES[k].length, `no rules for ${k}`);
  for (const k of R.kinds) for (const r of R.RULES[k]) ok(typeof r.id === 'string' && typeof r.strict === 'boolean' && /実際のエラー|広く知られた決まり|推測/.test(r.source) && typeof r.test === 'function', `${k}: ${r.id}`);
  // (the errors GitHub really gave are sure)
  for (const id of ['manifest.hook-url', 'manifest.redirect-fragment', 'token.variables']) ok(Object.values(R.RULES).flat().some((r) => r.id === id && r.strict && r.source === '実際のエラー'), id);
});

await t('kindOf: each write lib/gh.mjs makes → its kind and the parts of its address; reads → null', () => {
  const r = '/repos/o/lab';
  const want = [
    ['PUT', `${r}/actions/secrets/APP_ID`, 'secrets.put', { name: 'APP_ID' }], ['DELETE', `${r}/actions/secrets/X`, 'secrets.delete', { name: 'X' }],
    ['POST', `${r}/actions/variables`, 'variables.create', {}], ['PATCH', `${r}/actions/variables/APP_ID`, 'variables.update', { name: 'APP_ID' }],
    ['POST', `${r}/actions/workflows/hostrun.yml/dispatches`, 'dispatch', { workflow: 'hostrun.yml' }],
    ['PUT', `${r}/actions/workflows/7/enable`, 'workflows.enable', { workflow: '7' }], ['PUT', `${r}/actions/workflows/7/disable`, 'workflows.disable', { workflow: '7' }],
    ['POST', `${r}/actions/runs/9/cancel`, 'runs.cancel', { run: '9' }], ['POST', `${r}/actions/runs/9/rerun-failed-jobs`, 'runs.rerun', { run: '9' }],
    ['PUT', `${r}/contents/.github/a%20b.json`, 'contents.put', { file: '.github/a b.json' }],
    ['POST', `${r}/issues`, 'issues.create', {}], ['PATCH', `${r}/issues/3`, 'issues.update', { number: '3' }], ['PUT', `${r}/issues/3/lock`, 'issues.lock', { number: '3' }],
    ['POST', `${r}/issues/3/comments`, 'comments.create', { number: '3' }], ['POST', `${r}/labels`, 'labels.create', {}],
    ['PUT', `${r}/collaborators/someone`, 'collaborators.put', { login: 'someone' }], ['PATCH', '/user/repository_invitations/5', 'invitations.accept', { id: '5' }],
    ['POST', `${r}/pages`, 'pages.create', {}], ['PUT', `${r}/pages`, 'pages.update', {}], ['POST', `${r}/merge-upstream`, 'merge-upstream', {}],
    ['POST', '/app-manifests/abc_D-1/conversions', 'app-manifests.conversions', { code: 'abc_D-1' }],
  ];
  for (const [m, p, kind, parts] of want) eq(R.kindOf(m, p), { kind, path: parts }, `${m} ${p}`);
  eq([...new Set(want.map((w) => w[2]))].sort(), [...WRITES].sort(), 'every write kind has its address');
  for (const [m, p] of [['GET', `${r}/actions/secrets/APP_ID`], ['GET', `${r}/contents/a.json?ref=main`], ['GET', '/user'], ['GET', `${r}/pages`], ['POST', '/somewhere/else']]) eq(R.kindOf(m, p), null, `${m} ${p}`);
});

await t('appManifest: what the panel hands GitHub keeps every rule, sure or not', () => {
  for (const args of [{ owner: 'o', repo: 'bds-lab', panelUrl: PANEL, authUrl: AUTH }, { owner: 'o', repo: 'bds-lab', panelUrl: `${PANEL}#setup` }, { owner: 'a-very-long-organization-name-x', repo: 'my-own-bds-lab-fork', panelUrl: PANEL, authUrl: AUTH }]) {
    eq(R.check('appManifest', S.appManifest(args)), [], JSON.stringify(args));
  }
});
await t('tokenUrl and installLink: every rule kept', () => {
  for (const o of [undefined, 'o', 'An-Org', 'not a login!']) eq(R.check('tokenUrl', S.tokenUrl(o)), [], `tokenUrl(${o})`);
  for (const l of [S.installLink('bds-lab-o', 12, 34), S.installLink('bds-lab-o'), S.installLink('bds-lab-o', 12, null)]) eq(R.check('installLink', l), [], l);
});

await t('the three refusals GitHub gave are caught: no hook_attributes.url, #fragment in redirect_url, Variables as variables alone', () => {
  const m = S.appManifest({ owner: 'o', repo: 'bds-lab', panelUrl: PANEL, authUrl: AUTH });
  ok(R.check('appManifest', { ...m, hook_attributes: { active: false } }, { strictOnly: true }).some((x) => /hook_attributes\.url/.test(x) && /wasn't supplied/.test(x)), 'no hook url');
  ok(R.check('appManifest', { ...m, redirect_url: `${m.redirect_url}#setup` }, { strictOnly: true }).some((x) => /redirect_url/.test(x) && /valid URL/.test(x)), 'fragment');
  const u = new URL(S.tokenUrl('o')); u.searchParams.delete('actions_variables');
  ok(R.check('tokenUrl', u.href, { strictOnly: true }).some((x) => /actions_variables/.test(x)), 'variables alone');
  // (and the rest of a manifest's sure rules)
  for (const bad of [{ name: '' }, { name: 'x'.repeat(35) }, { url: 'ftp://x' }, { url: undefined }, { callback_urls: Array.from({ length: 11 }, (_, i) => `${AUTH}/c${i}`) }, { callback_urls: [`${AUTH}/callback#x`] }, { default_permissions: { contents: 'admin' } }, { setup_url: '/relative' }]) {
    ok(R.check('appManifest', { ...m, ...bad }, { strictOnly: true }).length, JSON.stringify(bad).slice(0, 80));
  }
  // (not sure: only the fakes)
  eq(R.check('appManifest', { ...m, setup_url: `${PANEL}#setup` }, { strictOnly: true }), [], 'setup_url #fragment is not stopped in earnest');
  ok(R.check('appManifest', { ...m, setup_url: `${PANEL}#setup` }).length, 'the fakes refuse it');
  ok(R.check('appManifest', { ...m, default_permissions: { not_a_permission: 'read' } }).length && !R.check('appManifest', { ...m, default_permissions: { not_a_permission: 'read' } }, { strictOnly: true }).length, 'unknown permission names: the fakes only');
});

// (lib/setup.mjs as it was before each fix: a copy with that fix undone, its own import made absolute)
async function setupAsBefore(undo) {
  let src = fs.readFileSync(path.join(TOP, 'panel/lib/setup.mjs'), 'utf8');
  for (const [from, to] of undo) { ok(src.includes(from), `setup.mjs no longer has ${JSON.stringify(from)}: bring this test's undo up to date`); src = src.replace(from, to); }
  src = src.replace(/from '\.\/([a-z]+\.mjs)'/g, (_, f) => `from '${pathToFileURL(path.join(TOP, 'panel/lib', f)).href}'`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghrules-')), f = path.join(dir, 'setup.mjs');
  fs.writeFileSync(f, src);
  try { return await import(pathToFileURL(f).href); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
await t('setup.mjs put back as before each fix: the rules fail it (cfb6b65, 063db70, 0bb7be9)', async () => {
  const args = { owner: 'o', repo: 'bds-lab', panelUrl: PANEL, authUrl: AUTH };
  const noHook = await setupAsBefore([['hook_attributes: { url, active: false }', 'hook_attributes: { active: false }']]);
  ok(R.check('appManifest', noHook.appManifest(args), { strictOnly: true }).some((x) => /hook_attributes\.url/.test(x)), 'no hook url not caught');
  const frag = await setupAsBefore([['redirect_url: url,', 'redirect_url: `${url}#setup`,'], ['setup_url: url,', 'setup_url: `${url}#setup`,']]);
  ok(R.check('appManifest', frag.appManifest(args), { strictOnly: true }).some((x) => /redirect_url/.test(x)), '#setup not caught');
  const vars = await setupAsBefore([["actions_variables: 'write', variables: 'write'", "variables: 'write'"]]);
  ok(R.check('tokenUrl', vars.tokenUrl('o'), { strictOnly: true }).some((x) => /actions_variables/.test(x)), 'variables alone not caught');
  // (and the copy as it is now passes: the undo is what fails it)
  const now = await setupAsBefore([]);
  eq(R.check('appManifest', now.appManifest(args)), []); eq(R.check('tokenUrl', now.tokenUrl('o')), []);
});

await t('the writes: names, values and fields GitHub surely refuses', () => {
  const chk = (k, path, body, o) => R.check(k, { path, body }, o);
  const sealed = { encrypted_value: 'AAAA', key_id: '123' };
  eq(chk('secrets.put', { name: 'APP_PRIVATE_KEY' }, sealed, { strictOnly: true }), []);
  for (const n of ['1ABC', 'A-B', 'GITHUB_TOKEN', 'github_x', '', 'A B']) ok(chk('secrets.put', { name: n }, sealed, { strictOnly: true }).length, `secret ${n}`);
  ok(chk('secrets.put', { name: 'X' }, { key_id: '1' }, { strictOnly: true }).length, 'not sealed');
  ok(chk('secrets.put', { name: 'X' }, { encrypted_value: 'A'.repeat(70000), key_id: '1' }).length && !chk('secrets.put', { name: 'X' }, { encrypted_value: 'A'.repeat(70000), key_id: '1' }, { strictOnly: true }).length, 'size: the fakes only');
  eq(chk('variables.create', {}, { name: 'APP_ID', value: '1' }), []); eq(chk('variables.update', { name: 'APP_ID' }, { name: 'APP_ID', value: '' }), []);
  ok(chk('variables.create', {}, { name: 'GITHUB_X', value: '1' }, { strictOnly: true }).length && chk('variables.create', {}, { name: 'A', value: 1 }, { strictOnly: true }).length, 'variables');
  ok(chk('variables.create', {}, { name: 'A', value: 'x'.repeat(48 * 1024 + 1) }).length, 'variable size');
  eq(chk('dispatch', { workflow: 'a.yml' }, { ref: 'main', inputs: { a: '1', b: 'true' } }), []); eq(chk('dispatch', { workflow: 'a.yml' }, { ref: 'main', inputs: {} }), []);
  ok(chk('dispatch', {}, { ref: '', inputs: {} }, { strictOnly: true }).length && chk('dispatch', {}, { ref: 'main', inputs: [] }, { strictOnly: true }).length, 'ref / inputs');
  ok(chk('dispatch', {}, { ref: 'main', inputs: { a: true } }).length && !chk('dispatch', {}, { ref: 'main', inputs: { a: true } }, { strictOnly: true }).length, 'a boolean input: the fakes only');
  ok(chk('dispatch', {}, { ref: 'main', inputs: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`i${i}`, 'x'])) }).length, '26 inputs');
  eq(chk('contents.put', { file: '.lab-host.json' }, { message: 'm', content: 'e30K', sha: 'abc' }), []);
  for (const [f, b] of [['', { message: 'm', content: 'e30K' }], ['a/../b', { message: 'm', content: 'e30K' }], ['a.json', { content: 'e30K' }], ['a.json', { message: 'm', content: 'not base64!' }], ['a.json', { message: 'm', content: 'e30K', sha: '' }]]) ok(chk('contents.put', { file: f }, b, { strictOnly: true }).length, `${f} ${JSON.stringify(b)}`);
  ok(chk('issues.create', {}, { title: ' ', body: '' }, { strictOnly: true }).length && !chk('issues.create', {}, { title: 't', body: '', labels: ['a'] }).length, 'issue title');
  ok(chk('issues.update', {}, { state: 'done' }, { strictOnly: true }).length && !chk('issues.update', {}, { state: 'closed' }).length, 'issue state');
  ok(chk('comments.create', {}, { body: '' }, { strictOnly: true }).length && !chk('comments.create', {}, { body: 'x' }).length, 'comment');
  ok(chk('labels.create', {}, { name: '', color: 'ededed' }, { strictOnly: true }).length && !chk('labels.create', {}, { name: 'a', color: 'ededed', description: '' }).length, 'label');
  ok(chk('labels.create', {}, { name: 'a', color: '#ededed' }).length && !chk('labels.create', {}, { name: 'a', color: '#ededed' }, { strictOnly: true }).length, 'label # colour: the fakes only');
  ok(chk('pages.create', {}, { build_type: 'actions' }, { strictOnly: true }).length && !chk('pages.update', {}, { build_type: 'workflow' }).length, 'pages');
  ok(chk('merge-upstream', {}, { branch: '' }, { strictOnly: true }).length && !chk('merge-upstream', {}, { branch: 'main' }).length, 'merge-upstream');
  // (an organization's own role: GitHub takes it — never stopped in earnest)
  eq(chk('collaborators.put', { login: 'someone' }, { permission: 'custom-role' }, { strictOnly: true }), []); ok(chk('collaborators.put', { login: 'someone' }, { permission: 'custom-role' }).length, 'the fakes refuse an unknown role');
  eq(chk('collaborators.put', { login: 'someone' }, { permission: 'push' }), []);
});

await t('fakeCheck: what a fake GitHub answers — 422 with the words, null for a right write or a read', () => {
  eq(R.fakeCheck('PUT', '/repos/o/lab/actions/secrets/GITHUB_X', { encrypted_value: 'AAAA', key_id: '1' })?.status, 422);
  eq(R.fakeCheck('PUT', '/repos/o/lab/actions/secrets/APP_ID', { encrypted_value: 'AAAA', key_id: '1' }), null);
  eq(R.fakeCheck('PUT', '/repos/o/lab/collaborators/x', { permission: 'owner' })?.status, 422);
  eq(R.fakeCheck('GET', '/repos/o/lab/actions/secrets/GITHUB_X'), null);
  eq(R.fakeCheck('PUT', '/repos/o/lab/actions/workflows/a.yml/enable'), null);
  ok(/build_type/.test(R.fakeCheck('POST', '/repos/o/lab/pages', { build_type: 'x' })?.message ?? ''), 'its words');
});

await t('lib/gh.mjs: a sure problem is stopped before sending (422, rescue\'s next step, no value in the words); right writes go as they were', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(`${init.method} ${url.replace('https://api.github.com', '')}`); const body = url.endsWith('/public-key') ? { key: Buffer.alloc(32, 7).toString('base64'), key_id: 'k1' } : {}; return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) }; };
  const calls = [], api = G.gh({ token: 'tok', fetchImpl, onCall: (c) => calls.push(c) });
  const VALUE = 'the-secret-value-0123456789';
  let e = null; try { await api.putSecret('o/lab', 'GITHUB_X', VALUE); } catch (x) { e = x; }
  ok(e instanceof G.GhError && e.status === 422 && /GITHUB_/.test(e.message) && !e.message.includes(VALUE), e?.message);
  eq(sent, ['GET /repos/o/lab/actions/secrets/public-key'], 'the secret was not sent');
  const r = RS.rescue(e, {}); ok(/受け付けませんでした/.test(r.why) && r.action?.kind === 'retry', JSON.stringify(r));
  sent.length = 0;
  for (const f of [() => api.dispatch('o/lab', 'a.yml', '', {}), () => api.createIssue('o/lab', { title: '' }), () => api.comment('o/lab', 1, ''), () => api.putFile('o/lab', 'a.json', '{}', undefined, ''), () => api.syncFork('o/lab', '')]) {
    let x = null; try { await f(); } catch (y) { x = y; } ok(x?.status === 422, `not stopped: ${x?.message}`);
  }
  eq(sent, [], 'nothing sent'); ok(calls.every((c) => c.path !== '/repos/o/lab/issues'), 'no call told for what was not sent');
  // (a right one, and one only the fakes refuse: sent unchanged)
  await api.putSecret('o/lab', 'APP_ID', VALUE); await api.setVariable('o/lab', 'APP_ID', '1'); await api.dispatch('o/lab', 'a.yml', 'main', { a: '1' });
  await api.addCollaborator('o/lab', 'someone', 'custom-role'); await api.enablePages('o/lab'); await api.putFile('o/lab', 'dir/a b.json', '{}', 'abc', 'm');
  eq(sent.filter((s) => !s.startsWith('GET')), ['PUT /repos/o/lab/actions/secrets/APP_ID', 'PATCH /repos/o/lab/actions/variables/APP_ID', 'POST /repos/o/lab/actions/workflows/a.yml/dispatches', 'PUT /repos/o/lab/collaborators/someone', 'POST /repos/o/lab/pages', 'PUT /repos/o/lab/contents/dir/a%20b.json']);
  // (a label GitHub refuses comes back as createLabel's null, as GitHub's own 422 does)
  eq(await api.createLabel('o/lab', { name: '' }), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
