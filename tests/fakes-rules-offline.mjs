// The tests' fake GitHubs refuse what GitHub would, the same way: a write against GitHub's rules (panel/lib/ghrules.mjs, every
// rule, sure or not) answers 422 with { message } — a secret named GITHUB_X, an empty issue title, a collaborator role that is
// not one — and the App-creation page of panel-browser's fake GitHub says 「Invalid GitHub App configuration」 for a manifest
// with a #fragment in redirect_url or no hook_attributes.url. Every test file that has a fake GitHub passes its writes through
// fakeCheck, so a panel that sends what GitHub refuses fails there, not only on the real GitHub.
// node tests/fakes-rules-offline.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const R = await imp('panel/lib/ghrules.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

/** a fake GitHub made the way the tests make theirs: every write goes through fakeCheck first */
async function fake() {
  const srv = http.createServer((req, res) => {
    let b = ''; req.setEncoding('utf8'); req.on('data', (d) => { b += d; });
    req.on('end', () => {
      const bad = R.fakeCheck(req.method, req.url, b ? JSON.parse(b) : null);
      res.writeHead(bad ? 422 : 201, { 'content-type': 'application/json' }); res.end(JSON.stringify(bad ? { message: bad.message } : {}));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return { call: async (method, p, body) => { const r = await fetch(url + p, { method, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, j: await r.json() }; }, close: () => { srv.closeAllConnections?.(); srv.close(); } };
}

await t('a fake GitHub answers 422 with the words for a write GitHub refuses, and takes a right one', async () => {
  const g = await fake();
  try {
    const secret = await g.call('PUT', '/repos/o/lab/actions/secrets/GITHUB_X', { encrypted_value: 'AAAA', key_id: '1' });
    ok(secret.status === 422 && /GITHUB_/.test(secret.j.message), JSON.stringify(secret));
    const digit = await g.call('PUT', '/repos/o/lab/actions/secrets/1ABC', { encrypted_value: 'AAAA', key_id: '1' });
    ok(digit.status === 422 && /1ABC/.test(digit.j.message), JSON.stringify(digit));
    ok(!/AAAA/.test(secret.j.message + digit.j.message), 'a value in the words');
    const issue = await g.call('POST', '/repos/o/lab/issues', { title: '  ', body: 'x' });
    ok(issue.status === 422 && issue.j.message, JSON.stringify(issue));
    const role = await g.call('PUT', '/repos/o/lab/collaborators/x', { permission: 'owner' });
    eq(role.status, 422);
    eq((await g.call('PUT', '/repos/o/lab/actions/secrets/APP_ID', { encrypted_value: 'AAAA', key_id: '1' })).status, 201);
    eq((await g.call('POST', '/repos/o/lab/issues', { title: 'T', body: 'x' })).status, 201);
  } finally { g.close(); }
});

await t('the App-creation page: a manifest with a #fragment in redirect_url or no hook_attributes.url is refused in GitHub\'s words, a right one is not', () => {
  const good = { name: 'Lab', url: 'https://o.github.io/bds-lab/', hook_attributes: { url: 'https://o.github.io/bds-lab/', active: false }, redirect_url: 'https://bds-lab-auth.o.workers.dev/callback', callback_urls: ['https://bds-lab-auth.o.workers.dev/callback'], public: true, default_permissions: { contents: 'write' } };
  eq(R.check('appManifest', good), [], 'a right manifest');
  const frag = R.check('appManifest', { ...good, redirect_url: `${good.redirect_url}#setup` });
  ok(frag.length && frag.some((x) => /redirect_url/.test(x)), JSON.stringify(frag));
  const { url: _u, ...hook } = good.hook_attributes;
  const nohook = R.check('appManifest', { ...good, hook_attributes: { ...hook, active: false } });
  ok(nohook.some((x) => /hook_attributes/.test(x) && /"url" wasn't supplied/.test(x)), JSON.stringify(nohook));
});

await t('every test file with a fake GitHub passes its writes through fakeCheck, and panel-browser\'s App page through the appManifest rules', () => {
  // (found, not listed: every test whose fake answers GitHub's API — a new one is held to the same rule)
  const files = fs.readdirSync(path.join(TOP, 'tests')).filter((f) => /\.mjs$/.test(f) && f !== 'fakes-rules-offline.mjs').map((f) => `tests/${f}`)
    .filter((f) => { const s = fs.readFileSync(path.join(TOP, f), 'utf8'); return /(createServer|fetchImpl)/.test(s) && /\/repos\/[^'"`]*\/(issues|actions\/secrets|actions\/variables|contents|pages)/.test(s) && /method === '(POST|PUT|PATCH)'|m === '(POST|PUT|PATCH)'|'(POST|PUT|PATCH)'/.test(s); });
  ok(files.includes('tests/setup-offline.mjs') && files.includes('tests/app-offline.mjs'), `the search finds the fake GitHubs: ${files}`);
  // (and the ones it may not find by their look: listed too; ghrules-offline is the rules' own test)
  for (const n of ['setup', 'units', 'schedule', 'governance', 'panel', 'shell-rescue', 'units-rescue', 'stats', 'appci', 'misc-rescue', 'app']) files.push(`tests/${n}-offline.mjs`);
  files.push('tests/panel-browser.mjs');
  files.splice(0, files.length, ...new Set(files.filter((f) => f !== 'tests/ghrules-offline.mjs')));
  for (const f of files) {
    const s = fs.readFileSync(path.join(TOP, f), 'utf8');
    ok(/import \{[^}]*fakeCheck[^}]*\} from '\.\.\/panel\/lib\/ghrules\.mjs'/.test(s) && /fakeCheck\(/.test(s), `${f}: no fakeCheck on its fake GitHub`);
  }
  const pb = fs.readFileSync(path.join(TOP, 'tests/panel-browser.mjs'), 'utf8');
  ok(/ghCheck\('appManifest'/.test(pb) && /Invalid GitHub App configuration/.test(pb), 'panel-browser: the App page takes any manifest');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
