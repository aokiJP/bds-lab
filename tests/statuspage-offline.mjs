// statuspage without a network: collect() against a fake fetch, buildHtml() pure (escaped, no outside file, CSP meta,
// no name or log sentence), statusCmd() writing the two files, and a private repository writing nothing.
// node tests/statuspage-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(pathToFileURL(path.join(TOP, 'common/statuspage.mjs')).href);
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const ENV = { GITHUB_TOKEN: 'tok-not-printed', GITHUB_REPOSITORY: 'o/lab' };
const run = (id, conclusion, title, at = '2026-10-10T01:02:03Z') => ({ id, status: 'completed', conclusion, display_title: title, updated_at: at, actor: { login: 'secret-person' } });
const mkFetch = ({ priv = false, fail = [] } = {}) => {
  const seen = [];
  const f = async (url, opts) => {
    seen.push({ url, opts });
    const u = url.replace('https://api.github.com/repos/o/lab', '');
    if (fail.some((x) => u.includes(x))) return { ok: false, status: 500, json: async () => ({}) };
    const J = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u === '') return J({ private: priv });
    if (u.startsWith('/actions/workflows/verify.yml')) return J({ workflow_runs: [run(1, 'failure', 'verify'), run(2, 'success', 'verify')] });
    if (u.startsWith('/actions/workflows/unit.yml')) return J({ workflow_runs: [run(3, 'success', 'unit test ruby'), run(4, 'failure', 'unit test ruby'), run(5, 'failure', 'unit test <b>x</b>'), run(6, 'failure', 'unit build gem'), run(7, 'failure', 'unit test amber')] });
    if (u.startsWith('/releases/latest')) return J({ tag_name: 'v1.2.3', published_at: '2026-10-01T00:00:00Z', author: { login: 'secret-person' } });
    if (u.startsWith('/actions/workflows/connect.yml')) return J({ workflow_runs: [run(9, 'success', 'connect')] });
    if (u === '/actions/runs/9/jobs') return J({ jobs: [{ check_run_url: 'https://api.github.com/repos/o/lab/check-runs/90' }] });
    if (u === '/check-runs/90/annotations') return J([{ title: 'connect-daily', message: JSON.stringify({ ok: false, checked: ['discord', 'ai'], bad: ['ai'], services: { discord: { ok: true }, ai: { ok: false, problem: 'LEAKY-SENTENCE' } } }) }]);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  f.seen = seen; return f;
};

await t('collect: verify, last test of each unit, release, connect', async () => {
  const f = mkFetch(), d = await S.collect(f, ENV, new Date('2026-10-11T00:00:00Z'));
  eq(d.verify.state, 'bad'); // the newest run first
  eq(d.units.ruby.state, 'ok'); eq(d.units.amber.state, 'bad'); ok(!d.units.gem, 'only test jobs');
  eq(d.release, { tag: 'v1.2.3', at: '2026-10-01T00:00:00.000Z' });
  eq(d.connect.services, { discord: true, ai: false });
  ok(f.seen.every((s) => s.opts.headers.authorization === 'Bearer tok-not-printed'));
  const j = JSON.stringify(d);
  ok(!/secret-person|LEAKY|tok-not/.test(j), j);
});
await t('collect: a failed read leaves that part empty, the rest stays', async () => {
  const d = await S.collect(mkFetch({ fail: ['releases', 'connect.yml'] }), ENV);
  eq(d.release, null); eq(d.connect.state, 'none'); eq(d.verify.state, 'bad');
});
await t('collect: private → only { private: true }; a bad repo name throws', async () => {
  eq(await S.collect(mkFetch({ priv: true }), ENV), { private: true });
  let e; try { await S.collect(mkFetch(), { GITHUB_REPOSITORY: 'x' }); } catch (x) { e = x; }
  ok(e, 'must throw');
});
await t('buildHtml: pure, escaped, CSP, nothing from outside, no leaked words', async () => {
  const d = await S.collect(mkFetch(), ENV, new Date('2026-10-11T00:00:00Z'));
  const h = S.buildHtml(d);
  ok(h.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`), 'csp');
  ok(!/<script|<link|<img|<iframe|src=|href=|https?:\/\//i.test(h), 'outside');
  ok(!h.includes('<b>x</b>'), 'a title that is not a unit name is not taken');
  const e = S.buildHtml({ repo: 'o/<i>', units: { '<b>x</b>': { state: 'ok', at: null } } });
  ok(!e.includes('<b>x') && e.includes('&lt;b&gt;x&lt;/b&gt;') && e.includes('o/&lt;i&gt;'), 'escape');
  ok(!/secret-person|LEAKY|tok-not/.test(h), 'leak');
  ok(h.includes('v1.2.3') && h.includes('discord') && h.includes('❌'), h);
  eq(S.buildHtml(d), h);
  ok(S.buildHtml({ repo: 'o/lab', at: null }).includes('まだ結果がありません'));
});
await t('statusCmd: writes status/index.html and status.json; private writes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statuspage-')), lines = [];
  try {
    eq(await S.statusCmd([], { fetchImpl: mkFetch(), env: ENV, out: (l) => lines.push(l) }), false);
    eq(await S.statusCmd(['--out', dir], { fetchImpl: mkFetch({ priv: true }), env: ENV, out: (l) => lines.push(l) }), false);
    ok(!fs.existsSync(path.join(dir, 'status')), 'private wrote');
    ok(lines.some((l) => /非公開/.test(l)), lines.join('\n'));
    eq(await S.statusCmd(['--out', dir], { fetchImpl: mkFetch(), env: ENV, out: (l) => lines.push(l) }), true);
    ok(fs.readFileSync(path.join(dir, 'status/index.html'), 'utf8').startsWith('<!doctype html>'));
    eq(JSON.parse(fs.readFileSync(path.join(dir, 'status/status.json'), 'utf8')).repo, 'o/lab');
    ok(!lines.join('\n').includes('tok-not'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
