// the 「今日やること」 card without a browser or a network: todo() (pure: what is to be done, heaviest first, nothing when all is
// well) and the card on a small fake DOM over a fake GitHub (node:http): one button per thing to the tab where it is mended, a
// part GitHub will not tell said in one line while the rest shows, nothing written, no secret value or token shown.
// node tests/today-offline.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const TD = await imp('panel/lib/today.mjs'), G = await imp('panel/lib/gh.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };

const NOW = Date.parse('2026-06-15T12:00:00Z'), DAY = 86_400_000, ago = (d) => new Date(NOW - d * DAY).toISOString();
const run = (id, path, conclusion, d, title) => ({ id, path: `.github/workflows/${path}`, name: path, display_title: title ?? path, status: 'completed', conclusion, run_started_at: ago(d), created_at: ago(d) });

await t('nothing to do: an empty list; facts missing or not lists are not looked at', () => {
  eq(TD.todo({ now: NOW }), []); eq(TD.todo(null), []); eq(TD.todo({ now: NOW, runs: 'x', secrets: 5, schedule: 3 }), []);
  eq(TD.todo({ now: NOW, runs: [run(1, 'verify.yml', 'success', 1)], secrets: [{ name: 'A', updated_at: ago(5) }], invitations: [{ id: 1, login: 'amy', at: ago(1) }] }), []);
});
await t('a failed run counts until a later good run of the same workflow; cancelled ones are skipped', () => {
  const l = TD.todo({ now: NOW, runs: [run(1, 'verify.yml', 'failure', 5, 'verify 検査'), run(2, 'verify.yml', 'success', 6), run(3, 'ai-make.yml', 'failure', 4), run(4, 'ai-make.yml', 'success', 2), run(5, 'notify.yml', 'cancelled', 1)] });
  eq(l.map((x) => x.id), ['run:.github/workflows/verify.yml']); ok(l[0].say.includes('verify 検査') && l[0].say.includes('5 日前'), l[0].say); eq(l[0].tab, 'runs');
});
await t('schedule: a broken file, errors, a fallen scheduler; secrets old and stale; invitations waiting; releases not told; lenders short', () => {
  const l = TD.todo({ now: NOW, schedule: { broken: true, runs: [run(9, 'schedule.yml', 'failure', 0)] },
    secrets: [{ name: 'OLD', updated_at: ago(100) }, { name: 'STALE', updated_at: ago(200) }, { name: 'NEW', updated_at: ago(2) }],
    invitations: [{ id: 7, login: 'amy', at: ago(10) }, { id: 8, login: 'bob', at: ago(1) }],
    releases: [{ tag_name: 'addon-a', name: 'A', published_at: ago(1) }, { tag_name: 'addon-b', name: 'B', published_at: ago(2) }, { tag_name: 'addon-c', published_at: ago(30) }, { tag_name: 'addon-d', published_at: ago(1), draft: true }], told: ['addon-b'],
    hosts: [{ slug: 'x/h1', left: 10 }, { slug: 'x/h2', left: 500 }, { slug: 'x/h3', left: null }] });
  eq(l.map((x) => x.id), ['schedule:broken', 'schedule:down', 'secret:STALE', 'invite:7', 'secret:OLD', 'release:addon-a', 'host:x/h1']);
  eq(l.map((x) => x.tab), ['schedule', 'schedule', 'secrets', 'members', 'secrets', 'releases', 'hosts']);
  ok(l.every((x, i) => i === 0 || l[i - 1].weight >= x.weight), 'heaviest first');
  ok(!JSON.stringify(l).includes('ghp_'), 'no value');
});
await t('releases are not judged without the list of those told', () => {
  eq(TD.todo({ now: NOW, releases: [{ tag_name: 'a', published_at: ago(1) }] }), []);
});

// ---- a fake GitHub and a small DOM ----
async function fakeGitHub(init) {
  const st = { seen: [], writes: 0 };
  const send = (res, code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(j === null ? '' : JSON.stringify(j)); };
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const u = req.url, m = req.method; st.seen.push(`${m} ${u}`); if (m !== 'GET') st.writes++;
      for (const [re, v] of init.routes) if (re.test(u)) return v instanceof Error ? send(res, v.status ?? 500, { message: v.message }) : send(res, 200, typeof v === 'function' ? v(u) : v);
      send(res, 404, { message: 'Not Found' });
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  return { st, close: () => srv.close(), api: G.gh({ token: 'ghu_usertoken0123456789', base: `http://127.0.0.1:${srv.address().port}` }) };
}
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', disabled: false, parent: null }); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'disabled') this.disabled = true; }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { this.kids = []; this.append(...xs); }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    click() { return this.disabled ? Promise.resolve() : Promise.all((this.on.click ?? []).map((fn) => fn({ target: this }))); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
  }
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: () => null, body: new E('body') };
}
const b64 = (s) => Buffer.from(s).toString('base64');
const routes = (o = {}) => [
  [/actions\/workflows\/schedule\.yml\/runs/, { workflow_runs: o.sched ?? [] }],
  [/actions\/workflows\/host\.yml\/runs/, { workflow_runs: [] }],
  [/\/o\/lab\/actions\/runs\?/, o.runs ?? { workflow_runs: [] }],
  [/contents\/\.github\/bds-lab-schedule\.json/, o.file ?? { content: b64('{"jobs":[]}'), sha: 's1' }],
  [/contents\/\.lab-host\.json/, { content: b64('{"minutesPerMonth":100,"jobs":["verify"]}'), sha: 's2' }],
  [/\/o\/lab\/actions\/secrets/, o.secrets ?? { secrets: [] }],
  [/\/o\/lab\/collaborators/, []],
  [/\/o\/lab\/invitations/, o.inv ?? []],
  [/\/o\/lab\/releases/, o.rel ?? []],
  ...(o.extra ?? []),
];
const LAB = { slug: 'o/lab', repo: { owner: { login: 'o' } } };
const buttons = (c) => c.all((e) => e.tagName === 'BUTTON');

await t('the card: each thing with one button to its tab; reading again; nothing written; no token shown', async () => {
  fakeDom(); const UI = await imp('panel/ui/today.mjs');
  const f = await fakeGitHub({ routes: routes({ runs: { workflow_runs: [run(1, 'verify.yml', 'failure', 3)] }, secrets: { secrets: [{ name: 'KEY', updated_at: ago(120) }] }, inv: [{ id: 4, invitee: { login: 'amy' }, permissions: 'write', created_at: ago(5) }] }) });
  try {
    const gone = []; const c = UI.todayCard({ api: f.api, lab: LAB, now: NOW, go: (tab) => gone.push(tab) }); await c.reload();
    eq(c.all((e) => e.attrs['data-todo']).map((e) => e.attrs['data-todo']), ['run:.github/workflows/verify.yml', 'invite:4', 'secret:KEY']);
    const open = buttons(c).filter((b) => /を開く/.test(b.textContent));
    eq(open.length, 3); for (const b of open) await b.click();
    eq(gone.slice().sort(), ['members', 'runs', 'secrets']);
    ok(!/今日はやることがありません/.test(c.textContent), 'not the empty line');
    eq(f.st.writes, 0, 'nothing written'); ok(!c.textContent.includes('ghu_'), 'no token');
    const before = f.st.seen.length; await buttons(c).find((b) => b.textContent === '読み直す').click(); ok(f.st.seen.length > before, 'read again');
  } finally { f.close(); }
});
await t('all well: the happy line; no go on the page: the button is words, not a dead button', async () => {
  fakeDom(); const UI = await imp('panel/ui/today.mjs'), f = await fakeGitHub({ routes: routes() });
  try { const c = UI.todayCard({ api: f.api, lab: LAB, now: NOW }); await c.reload(); ok(c.textContent.includes('今日はやることがありません 🎉'), c.textContent); } finally { f.close(); }
  const g = await fakeGitHub({ routes: routes({ runs: { workflow_runs: [run(1, 'verify.yml', 'timed_out', 1)] } }) });
  try { const c = UI.todayCard({ api: g.api, lab: LAB, now: NOW }); await c.reload(); eq(buttons(c).filter((b) => /を開く/.test(b.textContent)).length, 0); ok(/の画面で直せます/.test(c.textContent), c.textContent); } finally { g.close(); }
});
await t('a part GitHub will not tell: one line for it, the rest still shown', async () => {
  fakeDom(); const UI = await imp('panel/ui/today.mjs');
  const f = await fakeGitHub({ routes: routes({ secrets: Object.assign(new Error('no'), { status: 403 }), runs: { workflow_runs: [run(1, 'verify.yml', 'failure', 2)] } }) });
  try {
    const c = UI.todayCard({ api: f.api, lab: LAB, now: NOW, go() {} }); await c.reload();
    ok(/秘密は読めませんでした/.test(c.textContent) && c.textContent.includes('が落ちたままです'), c.textContent);
    ok(!/今日はやることがありません/.test(c.textContent), 'not the happy line when something was not read');
  } finally { f.close(); }
});
await t('releases (told list given) and lenders are read; the schedule file that is not JSON is told', async () => {
  fakeDom(); const UI = await imp('panel/ui/today.mjs');
  const f = await fakeGitHub({ routes: routes({ file: { content: b64('{oops'), sha: 'x' }, rel: [{ tag_name: 'addon-z', name: 'Z', published_at: ago(1) }], extra: [] }) });
  try {
    const c = UI.todayCard({ api: f.api, lab: LAB, now: NOW, go() {}, told: [], hosts: [{ slug: 'o/lab' }] }); await c.reload();
    const ids = c.all((e) => e.attrs['data-todo']).map((e) => e.attrs['data-todo']);
    ok(ids.includes('schedule:broken') && ids.includes('release:addon-z'), ids.join());
  } finally { f.close(); }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
