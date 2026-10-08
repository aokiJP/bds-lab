// the panel's 「アドオン」 and 「配布」 without a browser or a network: the units read from a fake GitHub (what each one's files
// say, the hidden ones left out, the limit, read once for the visit), the releases and each unit's newest pack, unit.yml's
// inputs, a person's pack put in incoming/ (its name made safe, its bytes as base64, the path and the message) and unit.yml
// started after it, a file changed over its sha — and common/unitci.mjs, the Actions side: the inputs checked by the panel's
// own rules, the command run with its words as arguments (a fake spawn), its output kept from being read as workflow
// commands, the summary and outputs written. The tabs themselves on a small fake DOM. The real GitHub client (lib/gh.mjs)
// talks to the fake GitHub: what it sends is what GitHub would get.
// node tests/units-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const U = await imp('panel/lib/units.mjs'), R = await imp('panel/lib/releases.mjs'), W = await imp('panel/lib/workspace.mjs'), G = await imp('panel/lib/gh.mjs');
const C = await imp('common/unitci.mjs');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${e.stack?.split('\n').slice(0, 3).join('\n     ') ?? e}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');

// ---- a fake GitHub for the real client: files and releases in memory, each request kept ----
const manifest = (name, description, version = [1, 0, 0], entry = 'scripts/main.js') => JSON.stringify({ format_version: 2, header: { name, description, uuid: 'u', version, min_engine_version: [1, 26, 0] }, modules: [{ type: 'script', language: 'javascript', uuid: 'm', version: [1, 0, 0], entry }] });
function fakeGitHub({ files = {}, releases = [], big = [], fail = {} } = {}) {
  const st = { files: new Map(Object.entries(files).map(([p, x]) => [p, { data: Buffer.from(x), sha: sha(Buffer.from(x)) }])), seen: [], releases };
  const send = (status, j) => ({ ok: status < 300, status, headers: { get: () => null }, text: async () => (j === null || j === undefined ? '' : JSON.stringify(j)) });
  const fetchImpl = async (url, init) => {
    const u = new URL(url), p = decodeURIComponent(u.pathname), body = init.body ? JSON.parse(init.body) : null;
    st.seen.push({ method: init.method, path: p + u.search, raw: u.pathname, body, auth: init.headers.authorization });
    if (fail[p]) return send(fail[p], { message: 'Resource not accessible by integration' });
    let m;
    if ((m = /^\/repos\/o\/lab\/contents\/(.+)$/.exec(p))) {
      const f = m[1], x = st.files.get(f);
      if (init.method === 'GET') {
        if (x) return send(200, { type: 'file', name: f.split('/').pop(), path: f, sha: x.sha, size: x.data.length, ...(big.includes(f) ? { encoding: 'none', content: '' } : { encoding: 'base64', content: x.data.toString('base64').replace(/.{60}/g, '$&\n') }) });
        const kids = new Map();
        for (const [k, v] of st.files) if (k.startsWith(`${f}/`)) { const rest = k.slice(f.length + 1), name = rest.split('/')[0]; kids.set(name, rest.includes('/') ? { type: 'dir', name, path: `${f}/${name}`, sha: 'tree' } : { type: 'file', name, path: `${f}/${name}`, sha: v.sha }); }
        return kids.size ? send(200, [...kids.values()]) : send(404, { message: 'Not Found' });
      }
      if (init.method === 'PUT') {
        if (x && !body.sha) return send(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
        if (x && body.sha !== x.sha) return send(409, { message: `${f} does not match ${body.sha}` });
        const data = Buffer.from(body.content, 'base64'), s = sha(data);
        st.files.set(f, { data, sha: s });
        return send(x ? 200 : 201, { content: { path: f, sha: s }, commit: { sha: `c${s.slice(0, 7)}`, html_url: `https://github.com/o/lab/commit/c${s.slice(0, 7)}` } });
      }
    }
    if (p === '/repos/o/lab/releases' && init.method === 'GET') return send(200, st.releases);
    if (/^\/repos\/o\/lab\/actions\/workflows\/[^/]+\/dispatches$/.test(p) && init.method === 'POST') return send(204, null);
    return send(404, { message: 'Not Found' });
  };
  return { st, api: G.gh({ token: 'tok-secret', base: 'https://api.test', fetchImpl }), reads: () => st.seen.filter((s) => s.method === 'GET') };
}
const LAB = {
  'bds/addons/coins/bp/manifest.json': manifest('§6Coins', 'Get a coin once a day'),
  'bds/addons/coins/TASK.md': '# Coins\r\n\r\n## Request\r\n/lab:coins でコインを1枚\r\n',
  'bds/addons/coins/tests.txt': '## loads\n@A join\n~ joined\n\n## coin\n@A cmd /lab:coins\n\n## once a day\nx\n',
  'bds/addons/coins/src/main.ts': "import { world } from '@minecraft/server';\n// 日本語のコメント\n",
  'bds/addons/daily/bp/manifest.json': manifest('pack.name', 'pack.description', [2, 1, 0], 'scripts/index.js'),
  'bds/addons/daily/TASK.md': 'intro\n\n## Daily Bonus\n',
  'bds/addons/daily/tests.txt': '## a\n',
  'bds/addons/_hidden/TASK.md': '# no', 'bds/addons/zz_parked/TASK.md': '# no', 'bds/addons/.git/x': 'x', 'bds/addons/Bad-Name/TASK.md': '# no', 'bds/addons/README.md': 'not a unit',
  'end/plugins/hub/TASK.md': '# hub\n', 'end/plugins/hub/tests.txt': '## one\n## two\n', 'end/plugins/hub/pyproject.toml': '[project]\n',
  'll/mods/hub/manifest.json': JSON.stringify({ name: 'hub', entry: 'hub.js', type: 'lse-quickjs', version: '0.1.0', description: 'Sends the player to another server' }),
  'll/mods/hub/TASK.md': '# hub\n',
};
const asset = (name, size, n) => ({ name, size, download_count: n, browser_download_url: `https://github.com/o/lab/releases/download/x/${name}` });
const RELEASES = [
  { tag_name: 'addon-shopkeeper', name: 'shopkeeper 1.0.0', published_at: '2026-10-07T00:00:00Z', html_url: 'https://github.com/o/lab/releases/tag/addon-shopkeeper', assets: [asset('shopkeeper-latest.mcaddon', 2000, 1)] },
  { tag_name: 'addon-coins', name: '- Coins 1.0.0', published_at: '2026-09-01T00:00:00Z', html_url: 'https://github.com/o/lab/releases/tag/addon-coins', assets: [asset('coins-source.zip', 5000, 2), asset('coins-latest.mcaddon', 120_000, 7), asset('history.zip', 9000, 0)] },
  { tag_name: 'v9', name: 'draft', draft: true, created_at: '2026-10-08T00:00:00Z', published_at: null, html_url: 'https://github.com/o/lab/releases/tag/untagged-1', assets: [asset('coins-next.mcaddon', 1, 0)] },
  { tag_name: 'bundle-2026', name: 'everything', published_at: '2026-08-01T00:00:00Z', html_url: 'https://github.com/o/lab/releases/tag/bundle-2026', assets: [asset('Daily.Bonus.mcpack', 300, 4), asset('shop.mcaddon', 10, 1)] },
];

await t('units: the folders shown (not _ zz_ . nor a name the lab would refuse), a manifest read — a pack\'s or a LeviLamina mod\'s, § codes and .lang keys out, its script only inside the pack — TASK.md\'s first heading, the tests counted, a unit summed up and searched (pure)', () => {
  eq(['coins', 'teleport_menu', 'ab', '_x', 'zz_old', '.git', 'Coins', '1abc', 'a', 'x'.repeat(41), 'jsonui-demo'].map(U.isUnitName), [true, true, true, false, false, false, false, false, false, false, false]);
  eq(U.parseManifest(`\uFEFF${manifest('§aRuby §lSword', 'Lightning  on\nright click', [1, 2, 3])}`), { name: 'Ruby Sword', description: 'Lightning on right click', version: '1.2.3', entry: 'scripts/main.js' });
  eq(U.parseManifest(LAB['ll/mods/hub/manifest.json']), { name: 'hub', description: 'Sends the player to another server', version: '0.1.0', entry: null }, 'a LeviLamina mod: name and version at the top');
  eq(U.parseManifest(manifest('pack.name', 'pack.description')).name, '', 'a pack named by its .lang files says nothing here');
  for (const bad of ['../../.github/workflows/x.js', 'scripts/../../x.js', '/etc/x.js', 'scripts/a.ts', 'main.js']) eq(U.parseManifest(manifest('a', 'b', [1, 0, 0], bad)).entry, null, bad);
  eq([U.parseManifest('{nope'), U.parseManifest('[1]'), U.parseManifest('"x"'), U.parseManifest(null)], [null, null, null, null]);
  eq([U.taskTitle('# Coins\r\n## Request'), U.taskTitle('text\n\n### C# guide ##\n# later'), U.taskTitle('no heading'), U.taskTitle(null)], ['Coins', 'C# guide', '', '']);
  eq([U.testSections(LAB['bds/addons/coins/tests.txt']), U.testSections('##x\n ## y\n## z\r\n## w'), U.testSections(null)], [3, 2, 0]);
  const s = U.unitSummary({ name: 'coins', manifest: LAB['bds/addons/coins/bp/manifest.json'], task: LAB['bds/addons/coins/TASK.md'], tests: LAB['bds/addons/coins/tests.txt'] });
  eq(s, { kind: 'bds', name: 'coins', dir: 'bds/addons/coins', ref: 'bds/coins', title: 'Coins', description: 'Get a coin once a day', version: '1.0.0', tests: 3, task: 'Coins', entry: 'bp/scripts/main.js' });
  eq(U.unitSummary({ name: 'daily', manifest: LAB['bds/addons/daily/bp/manifest.json'], task: LAB['bds/addons/daily/TASK.md'], tests: null }), { kind: 'bds', name: 'daily', dir: 'bds/addons/daily', ref: 'bds/daily', title: 'Daily Bonus', description: '', version: '2.1.0', tests: null, task: 'Daily Bonus', entry: 'bp/scripts/index.js' }, 'the title from TASK.md when the pack has none; no tests.txt: null');
  eq(U.unitSummary({ kind: 'll', name: 'hub', manifest: LAB['ll/mods/hub/manifest.json'] }), { kind: 'll', name: 'hub', dir: 'll/mods/hub', ref: 'll/hub', title: 'hub', description: 'Sends the player to another server', version: '0.1.0', tests: null, task: '', entry: null });
  eq(U.unitSummary({ name: 'bare' }).title, 'bare', 'nothing read: the folder\'s name');
  const us = [s, U.unitSummary({ kind: 'end', name: 'hub', task: '# hub' })];
  eq([U.filterUnits(us, '').length, U.filterUnits(us, 'COIN day').map((u) => u.name), U.filterUnits(us, 'endstone').map((u) => u.ref), U.filterUnits(us, 'coin hub').length], [2, ['coins'], ['end/hub'], 0]);
});

await t('units from a fake GitHub: bds/addons then end/plugins and ll/mods (each unit\'s manifest, TASK.md, tests.txt), the hidden and parked ones left out, 30 at most, read once for the visit — again when asked fresh or for another sign-in, and a failed read not kept', async () => {
  const f = fakeGitHub({ files: LAB });
  const us = await U.listUnits(f.api, 'o/lab');
  eq(us.map((u) => [u.ref, u.title, u.version, u.tests]), [['bds/coins', 'Coins', '1.0.0', 3], ['bds/daily', 'Daily Bonus', '2.1.0', 1], ['end/hub', 'hub', '', 2], ['ll/hub', 'hub', '0.1.0', null]]);
  const paths = f.reads().map((s) => s.path);
  ok(paths.includes('/repos/o/lab/contents/bds/addons') && paths.includes('/repos/o/lab/contents/end/plugins') && paths.includes('/repos/o/lab/contents/ll/mods'), paths.join('\n'));
  ok(!paths.some((p) => /_hidden|zz_parked|\.git|Bad-Name|README/.test(p)), 'nothing read of the hidden ones');
  ok(!paths.includes('/repos/o/lab/contents/end/plugins/hub/bp/manifest.json') && paths.includes('/repos/o/lab/contents/ll/mods/hub/manifest.json'), 'each lab\'s own manifest');
  ok(f.st.seen.every((s) => s.auth === 'Bearer tok-secret' && s.method === 'GET'), 'the person\'s own sign-in; nothing written');
  const n = f.st.seen.length;
  ok((await U.listUnits(f.api, 'o/lab')) === us && f.st.seen.length === n, 'the second look: no request');
  await U.listUnits(f.api, 'o/lab', { fresh: true });
  ok(f.st.seen.length === 2 * n, 'fresh: read again');
  const other = fakeGitHub({ files: LAB });
  await U.listUnits(other.api, 'o/lab');
  ok(other.st.seen.length === n, 'another sign-in (another client) reads for itself');
  U.forgetUnits(f.api, 'o/lab'); await U.listUnits(f.api, 'o/lab');
  ok(f.st.seen.length === 3 * n, 'forgotten after a change: read again');
  // 30 at most, bds first; a lab without bds/addons has none; end/ and ll/ refusing does not matter, bds/addons refusing does
  const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`bds/addons/u${String(i).padStart(2, '0')}/TASK.md`, `# U${i}`]));
  const lots = await U.listUnits(fakeGitHub({ files: { ...many, 'end/plugins/hub/TASK.md': '# hub' } }).api, 'o/lab');
  eq([lots.length, lots[0].name, lots.at(-1).name, lots.some((u) => u.kind === 'end')], [30, 'u00', 'u29', false]);
  eq(await U.listUnits(fakeGitHub({ files: {} }).api, 'o/lab'), []);
  eq((await U.listUnits(fakeGitHub({ files: LAB, fail: { '/repos/o/lab/contents/end/plugins': 403 } }).api, 'o/lab')).map((u) => u.ref), ['bds/coins', 'bds/daily', 'll/hub']);
  const shut = fakeGitHub({ files: LAB, fail: { '/repos/o/lab/contents/bds/addons': 403 } });
  let err = null; try { await U.listUnits(shut.api, 'o/lab'); } catch (e) { err = e; }
  ok(err?.status === 403 && /権限がありません/.test(err.message), err?.message);
  delete shut.st.seen; shut.st.seen = [];
  const again = await U.listUnits(shut.api, 'o/lab').catch(() => null);
  ok(again === null && shut.st.seen.length === 1, 'a failed read is not kept: asked again');
  eq([await U.unitExists(f.api, 'o/lab', 'coins'), await U.unitExists(f.api, 'o/lab', 'ruby_sword')], [true, false]);
});

await t('releases: the packs, newest first, each unit\'s newest — its own tag first, whole words (shop is not in shopkeeper), the title too, drafts aside, the .mcaddon first — the totals, and the word to Discord (pure); read from a fake GitHub', async () => {
  eq(R.packAssets(RELEASES[1]).map((a) => a.name), ['coins-latest.mcaddon']);
  eq(['A.MCADDON', 'w.mcworld', 't.mctemplate', 'p.mcpack', 'x.zip', 'mcaddon', null].map(R.isPack), [true, true, true, true, false, false, false]);
  eq(R.newestFirst(RELEASES).map((r) => r.tag_name), ['v9', 'addon-shopkeeper', 'addon-coins', 'bundle-2026'], 'a draft by when it was made');
  ok(RELEASES[0].tag_name === 'addon-shopkeeper', 'the list given stays as it was');
  eq([R.holds('addon-coins', 'coins'), R.holds('coins-latest.mcaddon', 'Coins'), R.holds('Daily.Bonus.mcpack', 'Daily Bonus'), R.holds('teleport_menu-latest.mcaddon', 'teleport_menu'), R.holds('addon-shopkeeper', 'shop'), R.holds('x', ''), R.holds('ルビーの剣.mcaddon', 'ルビーの剣')], [true, true, true, true, false, false, true]);
  const units = [{ kind: 'bds', name: 'coins', ref: 'bds/coins', title: 'Coins' }, { kind: 'bds', name: 'daily', ref: 'bds/daily', title: 'Daily Bonus' }, { kind: 'bds', name: 'shop', ref: 'bds/shop', title: 'Shop' }, { name: 'lamp', title: 'UI' }, { kind: 'll', name: 'hub', ref: 'll/hub', title: 'hub' }];
  const by = R.latestByUnit(RELEASES, units);
  eq(Object.keys(by), ['bds/coins', 'bds/daily', 'bds/shop'], 'no release of lamp, nor of the mod');
  eq([by['bds/coins'].release.tag_name, by['bds/coins'].asset.name], ['addon-coins', 'coins-latest.mcaddon'], 'its own tag, not the newer draft; the .mcaddon, not the source zip');
  eq([by['bds/daily'].release.tag_name, by['bds/daily'].asset.name], ['bundle-2026', 'Daily.Bonus.mcpack'], 'by its title, in a release of several');
  eq([by['bds/shop'].release.tag_name, by['bds/shop'].asset.name], ['bundle-2026', 'shop.mcaddon'], 'not the newer shopkeeper');
  eq(R.latestByUnit([{ tag_name: 'mod-hub', assets: [], html_url: 'https://github.com/o/lab/releases/tag/mod-hub', published_at: '2026-01-01T00:00:00Z' }, { tag_name: 'plugin-hub', assets: [], published_at: '2026-02-01T00:00:00Z' }], [{ kind: 'll', name: 'hub', title: 'hub' }])['ll/hub'], { release: { tag_name: 'mod-hub', assets: [], html_url: 'https://github.com/o/lab/releases/tag/mod-hub', published_at: '2026-01-01T00:00:00Z' }, asset: null }, 'a mod\'s own tag before a plugin\'s newer one; no pack: null');
  eq(R.latestByUnit(null, units), {}); eq(R.latestByUnit(RELEASES, null), {});
  eq(R.totals(RELEASES), { releases: 4, assets: 7, packs: 5, downloads: 15, bytes: 136_311 });
  eq(R.totals([]), { releases: 0, assets: 0, packs: 0, downloads: 0, bytes: 0 });
  eq(R.notifyMessage(RELEASES[1]), 'Coins 1.0.0: https://github.com/o/lab/releases/tag/addon-coins', 'never starting with - (notify would take it for an option)');
  eq([R.notifyMessage({ tag_name: 'v1', html_url: 'javascript:alert(1)' }), R.notifyMessage({ name: '--', tag_name: 'x', html_url: 'https://github.com/o/lab/releases/tag/x' }), R.notifyMessage({ name: 'x'.repeat(300) }).length], ['v1', 'リリース: https://github.com/o/lab/releases/tag/x', 100]);
  const f = fakeGitHub({ releases: RELEASES });
  eq((await R.listReleases(f.api, 'o/lab')).length, 4);
  eq(f.st.seen.map((s) => `${s.method} ${s.path}`), ['GET /repos/o/lab/releases?per_page=30']);
});

await t('unit.yml\'s inputs: a new unit, a run, a pack to take in — names made safe (folders dropped, only letters, digits and . _ -, never ..), kinds and sizes held, words the lab would take for an option refused (pure)', () => {
  eq(W.newUnitInputs({ unit: ' ruby_sword ', title: ' Ruby Sword ', request: ' ルビーの剣。\n右クリックで雷 ' }), { inputs: { job: 'new', unit: 'ruby_sword', title: 'Ruby Sword', request: 'ルビーの剣。\n右クリックで雷' } });
  eq(W.newUnitInputs({ unit: 'lamp' }).inputs, { job: 'new', unit: 'lamp', title: 'lamp', request: '' }, 'no title: the name');
  for (const [x, re] of [[{ unit: 'Ruby' }, /英小文字/], [{ unit: '1abc' }, /英小文字/], [{ unit: 'a' }, /2〜40/], [{ unit: 'ok_name', title: 'two\nlines' }, /1 行/], [{ unit: 'ok_name', title: '--js' }, /--/],
    [{ unit: 'ok_name', request: 'desc=evil' }, /名前=/], [{ unit: 'ok_name', title: 'x'.repeat(81) }, /80 文字/], [{ unit: 'ok_name', request: 'x'.repeat(2001) }, /2000 文字/], [{ unit: 'ok_name', request: 'a\u0000b' }, /使えない文字/]]) {
    const r = W.newUnitInputs(x);
    ok(r.error && re.test(r.error) && !r.inputs, `${JSON.stringify(x)}: ${r.error}`);
  }
  ok(!W.newUnitInputs({ unit: 'ok_name', request: '- 剣\n- 雷\n\tタブも' }).error, 'a list in the request is fine (one - is not an option)');
  eq([W.runInputs({ job: 'test', unit: 'coins' }), W.runInputs({ job: 'go', unit: 'coins' }).inputs, W.runInputs({ job: 'sim', unit: 'coins' }).inputs.job], [{ inputs: { job: 'test', unit: 'coins' } }, { job: 'go', unit: 'coins' }, 'sim']);
  ok(W.runInputs({ job: 'new', unit: 'coins' }).error && W.runInputs({ job: 'test', unit: '../x' }).error && W.runInputs({}).error, 'only test / go / sim of a good name');
  const p = W.importPlan({ fileName: 'C:\\Users\\me\\Downloads\\My Cool Addon v1.2.MCADDON', size: 12_345, words: ' 直してほしい ' });
  eq(p, { name: 'My_Cool_Addon_v1.2.mcaddon', path: 'incoming/My_Cool_Addon_v1.2.mcaddon', message: 'panel: 取り込む My_Cool_Addon_v1.2.mcaddon（unit.yml が bds/addons に） [skip ci]', inputs: { job: 'import', file: 'incoming/My_Cool_Addon_v1.2.mcaddon', words: '直してほしい' } });
  const names = (n) => W.importPlan({ fileName: n, size: 1 }).name ?? W.importPlan({ fileName: n, size: 1 }).error;
  eq(['../../.github/workflows/evil.zip', '剣.mcpack', '.hidden.mcpack', 'a..b...c.zip', '-x-.zip', 'ｆｕｌｌ.zip', `${'a'.repeat(200)}.zip`].map(names),
    ['evil.zip', 'addon.mcpack', 'hidden.mcpack', 'a.b.c.zip', 'x.zip', 'full.zip', `${'a'.repeat(80)}.zip`]);
  for (const n of ['../../.github/workflows/evil.zip', '剣.mcpack', '.hidden.mcpack', 'a..b...c.zip', `${'a'.repeat(200)}.zip`]) { const x = W.importPlan({ fileName: n, size: 1 }); ok(W.INCOMING.test(x.path) && !x.path.includes('..') && x.path.split('/').length === 2, x.path); }
  eq(['x.exe', 'x.mcworld', 'mcaddon', '.mcaddon', 'x'].map((n) => Boolean(W.importPlan({ fileName: n, size: 1 }).error)), [true, true, true, true, true], 'only .mcaddon .mcpack .zip');
  eq([W.importPlan({ fileName: 'a.zip', size: 0 }).error, W.importPlan({ fileName: 'a.zip', size: W.MAX_BYTES + 1 }).error, W.importPlan({ fileName: 'a.zip', size: W.MAX_BYTES }).error], ['空のファイルです', '大きすぎます（50 MB まで）', undefined]);
  eq(W.importPlan({ fileName: 'a.zip', size: 1, unit: 'mine' }).inputs, { job: 'import', file: 'incoming/a.zip', words: '', unit: 'mine' }, 'a name given: unit');
  ok(/英小文字/.test(W.importPlan({ fileName: 'a.zip', size: 1, unit: 'Mine' }).error) && /--/.test(W.importPlan({ fileName: 'a.zip', size: 1, words: '--name x' }).error), 'its name and words checked');
  eq([W.base64Of('data:application/octet-stream;base64,UEsDBA=='), W.base64Of('data:,plain'), W.base64Of(null)], ['UEsDBA==', '', '']);
  eq([W.hasWorkflow(undefined, 'unit.yml'), W.hasWorkflow([{ path: '.github/workflows/unit.yml' }], 'unit.yml'), W.hasWorkflow([{ path: '.github/workflows/xunit.yml' }], 'unit.yml'), W.hasWorkflow([], 'unit.yml')], [true, true, false, false]);
});

await t('the editor\'s files and checks: the pack\'s script from its manifest, a manifest must stay JSON with its header, tests.txt not empty, nothing outside the list, 1 MB at most (pure)', () => {
  eq(W.editableFiles({ entry: 'bp/scripts/index.js' }), [...W.EDITABLE, 'bp/scripts/index.js']);
  eq(W.editableFiles(null).at(-1), 'bp/scripts/main.js');
  ok(['src/main.ts', 'tests.txt', 'TASK.md', 'bp/manifest.json'].every((f) => W.EDITABLE.includes(f)), W.EDITABLE.join(' '));
  eq(W.checkEdit('tests.txt', '## a\n', null), { ok: true, error: '' });
  ok(/空/.test(W.checkEdit('tests.txt', ' \n\n', null).error), 'tests.txt empty');
  ok(/JSON として読めません/.test(W.checkEdit('bp/manifest.json', '{ "header": ', null).error) && /header/.test(W.checkEdit('rp/manifest.json', '{"format_version":2}', null).error), 'manifests');
  ok(W.checkEdit('bp/manifest.json', `\uFEFF${manifest('a', 'b')}`, null).ok, 'a BOM is fine');
  ok(/直せません/.test(W.checkEdit('.github/workflows/x.yml', 'x', null).error) && /直せません/.test(W.checkEdit('../x', 'x', null).error) && /直せません/.test(W.checkEdit('bp/scripts/index.js', 'x', null).error), 'only the files offered');
  ok(W.checkEdit('bp/scripts/index.js', 'x', { entry: 'bp/scripts/index.js' }).ok, 'its own script');
  ok(/1 MB/.test(W.checkEdit('TASK.md', 'あ'.repeat(400_000), null).error), 'UTF-8 bytes counted');
});

await t('a person\'s pack put in incoming/ (base64 of its bytes, its path, the commit\'s message; one there by that name replaced through its sha) and unit.yml started after it; a unit\'s file read and saved over its sha, another\'s change since said in words; a big file refused (fake GitHub)', async () => {
  const f = fakeGitHub({ files: { ...LAB, 'bds/addons/coins/rp/texts/en_US.lang': 'x'.repeat(10) }, big: ['bds/addons/coins/rp/texts/en_US.lang'] });
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80, 0x7f]), p = W.importPlan({ fileName: 'My Pack.mcpack', size: bytes.length, words: 'お店の値段を半分に' });
  const started = [];
  const dispatch = async (wf, inputs) => { started.push({ wf, inputs, at: f.st.seen.length }); return f.api.dispatch('o/lab', wf, 'main', inputs); };
  eq(await W.importUnit(f.api, 'o/lab', p, bytes.toString('base64'), dispatch), 'incoming/My_Pack.mcpack');
  const put = f.st.seen.find((s) => s.method === 'PUT');
  eq([put.path, put.body.message, put.body.sha, Buffer.from(put.body.content, 'base64').equals(bytes)], ['/repos/o/lab/contents/incoming/My_Pack.mcpack', 'panel: 取り込む My_Pack.mcpack（unit.yml が bds/addons に） [skip ci]', undefined, true]);
  eq(f.st.seen.map((s) => `${s.method} ${s.path}`), ['GET /repos/o/lab/contents/incoming', 'PUT /repos/o/lab/contents/incoming/My_Pack.mcpack', 'POST /repos/o/lab/actions/workflows/unit.yml/dispatches'], 'put first, then unit.yml');
  eq(f.st.seen.at(-1).body, { ref: 'main', inputs: { job: 'import', file: 'incoming/My_Pack.mcpack', words: 'お店の値段を半分に' } });
  eq(started[0].wf, 'unit.yml');
  // the same name again: replaced (its sha), not refused by GitHub
  await W.putIncoming(f.api, 'o/lab', p, Buffer.from('second').toString('base64'));
  eq([f.st.seen.at(-1).body.sha, f.st.files.get('incoming/My_Pack.mcpack').data.toString()], [sha(bytes), 'second']);
  for (const bad of [{ path: 'incoming/../x.zip' }, { path: '.github/workflows/x.zip' }, { path: 'incoming/a/b.zip' }]) { let e = null; try { await W.putIncoming(f.api, 'o/lab', { ...bad, message: 'm' }, 'QQ=='); } catch (x) { e = x; } ok(/使えません/.test(e?.message), bad.path); }
  let e0 = null; try { await W.putIncoming(f.api, 'o/lab', p, ''); } catch (x) { e0 = x; } ok(/読めません/.test(e0?.message), 'no bytes: not sent');
  // a unit's file: read (UTF-8, its sha), saved over that sha, saved again over the new one, another's change since refused in words
  const r = await W.readUnitFile(f.api, 'o/lab', 'bds/addons/coins/src/main.ts');
  eq([r.text, r.sha], [LAB['bds/addons/coins/src/main.ts'], sha(Buffer.from(LAB['bds/addons/coins/src/main.ts']))]);
  eq(await W.readUnitFile(f.api, 'o/lab', 'bds/addons/coins/rp/manifest.json'), null);
  let big = null; try { await W.readUnitFile(f.api, 'o/lab', 'bds/addons/coins/rp/texts/en_US.lang'); } catch (x) { big = x; }
  ok(/大きすぎ/.test(big?.message), 'a file the API gives no text of: not opened (saving would wipe it)');
  let dir = null; try { await W.readUnitFile(f.api, 'o/lab', 'bds/addons/coins/src'); } catch (x) { dir = x; } ok(/ファイルではありません/.test(dir?.message), 'a folder');
  const s1 = await W.saveUnitFile(f.api, 'o/lab', 'bds/addons/coins/src/main.ts', '// 新しい\n', r.sha, 'panel: m');
  const sent = f.st.seen.at(-1);
  eq([sent.method, sent.path, sent.body.sha, Buffer.from(sent.body.content, 'base64').toString('utf8'), sent.body.message, s1.sha], ['PUT', '/repos/o/lab/contents/bds/addons/coins/src/main.ts', r.sha, '// 新しい\n', 'panel: m', sha(Buffer.from('// 新しい\n'))]);
  ok((await W.saveUnitFile(f.api, 'o/lab', 'bds/addons/coins/src/main.ts', '// 3\n', s1.sha, 'm')).sha, 'saved again over the new sha');
  let late = null; try { await W.saveUnitFile(f.api, 'o/lab', 'bds/addons/coins/src/main.ts', 'mine', r.sha, 'm'); } catch (x) { late = x; }
  ok(/ほかの人が先に変えました/.test(late?.message) && f.st.files.get('bds/addons/coins/src/main.ts').data.toString() === '// 3\n', 'another\'s change not overwritten');
  let nosha = null; try { await W.saveUnitFile(f.api, 'o/lab', 'bds/addons/coins/src/main.ts', 'mine', null, 'm'); } catch (x) { nosha = x; }
  ok(/ほかの人が先に変えました/.test(nosha?.message), 'a file there already, saved with no sha: the same words');
});

await t('unitci: the inputs checked by the panel\'s own rules — each job\'s command, its words as arguments, never through a shell; anything else refused without repeating it (pure)', () => {
  eq(C.plan({ JOB: 'new', UNIT: 'ruby_sword', TITLE: 'Ruby Sword', REQUEST: 'ルビーの剣\n雷' }).args, ['lab.mjs', 'bds', 'new', 'ruby_sword', 'Ruby Sword', 'ルビーの剣\n雷']);
  eq(C.plan({ JOB: 'new', UNIT: 'lamp' }).args, ['lab.mjs', 'bds', 'new', 'lamp', 'lamp'], 'no title: the name; no request: left out');
  eq(C.plan({ JOB: 'import', FILE: 'incoming/My_Pack.mcpack', WORDS: '直して' }).args, ['lab.mjs', 'import', 'incoming/My_Pack.mcpack', '直して']);
  eq(C.plan({ JOB: 'import', FILE: 'incoming/a.zip', UNIT: 'mine' }).args, ['lab.mjs', 'import', 'incoming/a.zip', '--name', 'mine']);
  for (const job of ['test', 'sim', 'go']) eq(C.plan({ JOB: job, UNIT: 'coins', TITLE: 'ignored', FILE: 'x' }), { job, unit: 'coins', args: ['lab.mjs', job, '-a', 'coins'], show: `node lab.mjs ${job} -a coins` });
  eq(C.plan({ JOB: 'new', UNIT: 'ruby_sword', TITLE: 'Ruby Sword', REQUEST: 'x' }).show, 'node lab.mjs bds new ruby_sword "Ruby Sword" x');
  const bad = [{ JOB: 'rm', UNIT: 'coins' }, { JOB: 'new\n::add-mask::x', UNIT: 'coins' }, { JOB: 'test', UNIT: 'Coins' }, { JOB: 'go', UNIT: 'coins; rm -rf /' }, { JOB: 'test', UNIT: '' },
    { JOB: 'new', UNIT: 'ok_x', TITLE: 'a\nb' }, { JOB: 'new', UNIT: 'ok_x', TITLE: '--stable' }, { JOB: 'new', UNIT: 'ok_x', REQUEST: 'desc=x' }, { JOB: 'new', UNIT: 'ok_x', TITLE: 'x'.repeat(81) },
    { JOB: 'import', FILE: '../x.mcaddon' }, { JOB: 'import', FILE: 'incoming/../x.mcaddon' }, { JOB: 'import', FILE: 'incoming/a/b.mcaddon' }, { JOB: 'import', FILE: 'incoming/x.exe' },
    { JOB: 'import', FILE: 'incoming/.x.zip' }, { JOB: 'import', FILE: '/etc/passwd' }, { JOB: 'import', FILE: '' }, { JOB: 'import', FILE: 'incoming/a.zip', WORDS: '--name evil' }, { JOB: 'import', FILE: 'incoming/a.zip', UNIT: 'A' },
    { JOB: 'import', FILE: `incoming/${'a'.repeat(120)}.zip` }];
  for (const env of bad) { const r = C.plan(env); ok(r.error && !r.args && !/[\n\r]|::|rm -rf|evil|passwd|stable/.test(r.error), `${JSON.stringify(env).slice(0, 80)} → ${r.error}`); }
  // (the two sides hold each other: what the panel makes, unitci takes; what the panel refuses, unitci refuses)
  for (const x of [{ unit: 'ruby_sword', title: 'Ruby', request: '剣' }, { unit: 'a1', title: '' }, { unit: 'ok_x', title: '--js' }, { unit: 'ok_x', request: 'k=v' }, { unit: 'Bad' }, { unit: 'ok_x', title: 'x'.repeat(80) }, { unit: 'ok_x', title: 'x'.repeat(81) }]) {
    const panel = W.newUnitInputs(x), ci = C.plan({ JOB: 'new', UNIT: x.unit, TITLE: x.title, REQUEST: x.request });
    eq(Boolean(panel.error), Boolean(ci.error), JSON.stringify(x));
  }
  for (const n of ['My Pack.mcpack', '剣.zip', '../../x.mcaddon', 'a..b.zip']) { const p = W.importPlan({ fileName: n, size: 1, words: 'w' }); ok(!C.plan({ JOB: 'import', FILE: p.inputs.file, WORDS: p.inputs.words }).error, n); }
  eq([C.madeUnit(['W x', 'OK bds/addons/their_pack/ (bp rp), now the current addon']), C.madeUnit(['OK bds/addons/../x/']), C.madeUnit([])], ['their_pack', null, null]);
});

await t('unitci run: the command spawned with its words as arguments (no shell) on the bds lab, everything it prints inside stopped workflow commands, the summary and the outputs written; a failure annotated after; outside Actions refused; --dry runs nothing; an import\'s pack missing, or a link, runs nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unitci-'));
  try {
    const sum = path.join(dir, 'summary.md'), outp = path.join(dir, 'out.txt'), runs = [];
    let answer = { status: 0, stdout: 'W no server here\n::set-output name=x::y\nOK bds/addons/ruby_sword/: write bds/addons/ruby_sword/src/main.ts\n', stderr: '' };
    const spawn = (cmd, args, opts) => { runs.push({ cmd, args, opts }); return answer; };
    const env = (x) => ({ GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: sum, GITHUB_OUTPUT: outp, ...x });
    const run = async (x, args = []) => { const said = []; const r = await C.unitCiCmd(args, { env: env(x), spawn, out: (l) => said.push(String(l)), root: dir }); return { r, said }; };
    const a = await run({ JOB: 'new', UNIT: 'ruby_sword', TITLE: 'Ruby Sword', REQUEST: '剣\n::add-mask::oops' });
    eq([a.r, runs.length, runs[0].cmd, runs[0].args], [true, 1, process.execPath, ['lab.mjs', 'bds', 'new', 'ruby_sword', 'Ruby Sword', '剣\n::add-mask::oops']]);
    ok(runs[0].opts.cwd === dir && !runs[0].opts.shell && runs[0].opts.env.LAB_KIND === 'bds' && runs[0].opts.env.FORCE_COLOR === '0', JSON.stringify({ ...runs[0].opts, env: undefined }));
    const stop = /^::stop-commands::([0-9a-f]{16})$/.exec(a.said[0])?.[1], end = a.said.indexOf(`::${stop}::`);
    ok(stop && end > 0 && a.said.indexOf('::set-output name=x::y') > 0 && a.said.indexOf('::set-output name=x::y') < end && a.said.slice(0, end).some((l) => l.includes('::add-mask::oops')) && !a.said.slice(end + 1).length, a.said.join('\n'));
    const s1 = fs.readFileSync(sum, 'utf8');
    ok(/^## ✅ 新しく作る ruby_sword/.test(s1) && /bds\/addons\/ruby_sword を作りました/.test(s1) && /```\nW no server here/.test(s1), s1);
    eq(fs.readFileSync(outp, 'utf8'), 'ok=true\nunit=ruby_sword\n');
    // a failure: false, the lab's own words in an annotation once commands are back, the summary says so
    fs.rmSync(sum); fs.rmSync(outp);
    answer = { status: 1, stdout: 'E line 3: x is not defined\nsome detail\nFAIL test 2/3\n```\n', stderr: 'node: warning' };
    const b = await run({ JOB: 'test', UNIT: 'coins' });
    const stop2 = /^::stop-commands::(\w+)$/.exec(b.said[0])[1], end2 = b.said.indexOf(`::${stop2}::`);
    ok(stop2 !== stop, 'a new stop word each run');
    eq([b.r, runs.at(-1).args, b.said.slice(end2 + 1)], [false, ['lab.mjs', 'test', '-a', 'coins'], ['::error title=unit test::E line 3: x is not defined%0AFAIL test 2/3']]);
    const s2 = fs.readFileSync(sum, 'utf8');
    ok(/^## ❌ 試験 coins/.test(s2) && /````\n[\s\S]*FAIL test 2\/3\n```\nnode: warning\n````/.test(s2), `a code block the output cannot close: ${s2}`);
    eq(fs.readFileSync(outp, 'utf8'), 'ok=false\nunit=coins\n');
    // a spawn that could not start
    answer = { status: null, stdout: '', stderr: '', error: new Error('spawnSync ENOBUFS') };
    const c = await run({ JOB: 'go', UNIT: 'coins' });
    ok(!c.r && c.said.some((l) => l === 'ERR spawnSync ENOBUFS') && /^::error title=unit go::/.test(c.said.at(-1)), c.said.join('\n'));
    // bad inputs: nothing run, said inside the stop, annotated after
    const n0 = runs.length, d = await run({ JOB: 'new', UNIT: 'Bad Name' });
    ok(!d.r && runs.length === n0 && d.said.includes(`ERR UNIT: ${W.UNIT_SAY}`) && /^::error title=unit::UNIT: /.test(d.said.at(-1)), d.said.join('\n'));
    // --dry: the command, nothing run, anywhere; outside Actions: refused
    const dry = []; ok(await C.unitCiCmd(['--dry'], { env: { JOB: 'go', UNIT: 'coins' }, spawn, out: (l) => dry.push(l) }) && dry.join() === 'OK node lab.mjs go -a coins' && runs.length === n0, dry.join());
    const dry2 = []; ok(!(await C.unitCiCmd(['--dry'], { env: { JOB: 'x' }, spawn, out: (l) => dry2.push(l) })) && /^ERR JOB/.test(dry2[0]), dry2.join());
    let e = null; try { await C.unitCiCmd([], { env: { JOB: 'go', UNIT: 'coins' }, spawn, out: () => {} }); } catch (x) { e = x; }
    ok(/unit\.yml の中で/.test(e?.message) && runs.length === n0, e?.message);
    // import: the pack must be a file in incoming/ — missing, or a link: nothing run
    const g = await run({ JOB: 'import', FILE: 'incoming/My_Pack.mcpack', WORDS: '直して' });
    ok(!g.r && runs.length === n0 && g.said.some((l) => /^ERR incoming\/My_Pack\.mcpack がありません/.test(l)), g.said.join('\n'));
    ok(/## ❌ unitci: 始められません\n\n- incoming\/My_Pack\.mcpack がありません/.test(fs.readFileSync(sum, 'utf8')), 'the summary says why');
    fs.mkdirSync(path.join(dir, 'incoming')); fs.writeFileSync(path.join(dir, 'outside.mcpack'), 'x'); fs.symlinkSync(path.join(dir, 'outside.mcpack'), path.join(dir, 'incoming', 'link.mcpack'));
    const lnk = await run({ JOB: 'import', FILE: 'incoming/link.mcpack' });
    ok(!lnk.r && runs.length === n0, 'a link is not a pack');
    fs.writeFileSync(path.join(dir, 'incoming', 'My_Pack.mcpack'), 'PK');
    answer = { status: 0, stdout: 'OK bds/addons/their_pack/ (bp rp), now the current addon\n', stderr: '' };
    const i = await run({ JOB: 'import', FILE: 'incoming/My_Pack.mcpack', WORDS: '直して', UNIT: '' });
    eq([i.r, runs.at(-1).args, fs.readFileSync(outp, 'utf8').split('\n').slice(-3)], [true, ['lab.mjs', 'import', 'incoming/My_Pack.mcpack', '直して'], ['ok=true', 'unit=their_pack', '']]);
    ok(/bds\/addons\/their_pack に取り込みました/.test(fs.readFileSync(sum, 'utf8')), 'the unit it became');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- a small DOM: enough for panel/ui/dom.mjs's h and the tabs (a click runs its handlers; the rest is plain values) ----
function fakeDom() {
  class N { get textContent() { return ''; } }
  class T extends N { constructor(s) { super(); this.data = String(s); } get textContent() { return this.data; } }
  class E extends N {
    constructor(tag) { super(); Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, on: {}, style: {}, className: '', value: '', checked: false, parent: null }); }
    get disabled() { return this._disabled ?? 'disabled' in this.attrs; }
    set disabled(v) { this._disabled = Boolean(v); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { (this.on[type] ??= []).push(fn); }
    append(...xs) { for (const x of xs) { const n = x instanceof N ? x : new T(x); if (n.parent) n.parent.kids = n.parent.kids.filter((k) => k !== n); n.parent = this; this.kids.push(n); } }
    replaceChildren(...xs) { for (const k of this.kids) k.parent = null; this.kids = []; this.append(...xs); }
    remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; }
    get textContent() { return this.kids.map((k) => k.textContent).join(''); }
    fire(type) { return Promise.all((this.on[type] ?? []).map((fn) => fn({ target: this, preventDefault() {} }))); }
    click() { return this.disabled ? Promise.resolve() : this.fire('click'); }
    all(test) { const out = [], walk = (e) => { for (const k of e.kids) if (k instanceof E) { if (test(k)) out.push(k); walk(k); } }; walk(this); return out; }
    byId(id) { return this.all((e) => e.attrs.id === id)[0]; }
    button(re) { return this.all((e) => e.tagName === 'BUTTON' && re.test(e.textContent))[0]; }
  }
  const toast = new E('div');
  globalThis.Node = N;
  globalThis.document = { createElement: (tag) => new E(tag), createTextNode: (s) => new T(s), getElementById: (id) => (id === 'toast' ? toast : null), body: new E('body') };
  return { E, toast };
}
/** a ctx as panel.js would give one: guarded runs the action (as act: an error is a toast, undefined back) and keeps what it was asked */
function ctxOf(api, extra = {}) {
  const log = { guarded: [], went: [], ran: [], edited: [], ai: [], errors: [] };
  const ctx = {
    api, lab: { slug: 'o/lab', repo: { default_branch: 'main' }, workflows: [{ path: '.github/workflows/unit.yml' }, { path: '.github/workflows/notify.yml' }] },
    gate: () => ({}), go: (tab) => log.went.push(tab),
    guarded: async (action, detail, fn, done) => { log.guarded.push({ action, detail, done }); try { return await fn(); } catch (e) { log.errors.push(e.message); return undefined; } },
    dispatch: (wf, inputs) => api.dispatch('o/lab', wf, 'main', inputs),
    ...extra,
  };
  return { ctx, log };
}

await t('the 「アドオン」 tab (fake DOM, fake GitHub): a card per unit — title, version, tests, its newest .mcaddon — searched; 試験 / 仕上げる / ファイルを直す / AI で変える / 配布を見る do what they say; unit.yml through guarded once when the panel gives no runUnit, off when the lab has none; no unit yet: the three ways to begin', async () => {
  const { E, toast } = fakeDom();
  const UI = await imp('panel/ui/units.mjs');
  const f = fakeGitHub({ files: LAB, releases: RELEASES });
  const { ctx, log } = ctxOf(f.api, { runUnit: (x) => log.ran.push(x), edit: (u) => log.edited.push(u.ref), aiMake: (x) => log.ai.push(x) });
  const body = new E('div');
  const us = await UI.unitsTab(body, ctx);
  eq(us.map((u) => u.ref), ['bds/coins', 'bds/daily', 'end/hub', 'll/hub']);
  const cards = () => body.all((e) => e.attrs['data-unit'] && e.className === 'card');
  eq(cards().map((c) => c.attrs['data-unit']), ['bds/coins', 'bds/daily', 'end/hub', 'll/hub']);
  const coins = cards()[0].textContent;
  ok(/^Coinsv1\.0\.0試験 3Get a coin once a daybds\/addons\/coins · ⬇ coins-latest\.mcaddon（120 KB・7 回）/.test(coins), coins);
  ok(cards()[0].all((e) => e.tagName === 'A').some((a) => a.attrs.href === 'https://github.com/o/lab/releases/download/x/coins-latest.mcaddon'), 'the .mcaddon a link');
  ok(/まだ配布はありません/.test(cards()[2].textContent) && /Endstone のプラグイン/.test(cards()[2].textContent) && !cards()[2].button(/試験/) && cards()[2].button(/AI で変える/), cards()[2].textContent);
  ok(/tests\.txt なし/.test(cards()[3].textContent), 'no tests.txt: said');
  await cards()[0].button(/🧪 試験/).click(); await cards()[0].button(/仕上げる/).click(); await cards()[0].button(/ファイルを直す/).click(); await cards()[0].button(/AI で変える/).click(); await cards()[0].button(/配布を見る/).click();
  await cards()[2].button(/AI で変える/).click();
  eq([log.ran, log.edited, log.ai, log.went], [[{ job: 'test', unit: 'coins' }, { job: 'go', unit: 'coins' }], ['bds/coins'], [{ unit: 'bds/coins' }, { unit: 'end/hub' }], ['releases']]);
  const q = body.all((e) => e.attrs.type === 'search')[0];
  q.value = 'daily'; await q.fire('input');
  eq(cards().map((c) => c.attrs['data-unit']), ['bds/daily']);
  q.value = 'nothing like it'; await q.fire('input');
  ok(!cards().length && /当てはまるアドオンがありません/.test(body.textContent) && /0 件/.test(body.textContent), 'no hit: said');
  ok(body.byId('newunit') && body.byId('importunit'), 'the two cards above');
  // no runUnit from the panel: unit.yml through guarded, once
  const g2 = fakeGitHub({ files: LAB, releases: RELEASES }), c2 = ctxOf(g2.api), b2 = new E('div');
  await UI.unitsTab(b2, c2.ctx);
  await b2.all((e) => e.attrs['data-unit'] === 'bds/daily')[0].button(/仕上げる/).click();
  eq(c2.log.guarded.map((x) => [x.action, x.detail]), [['dispatch', { workflow: 'unit.yml', job: 'go', unit: 'daily' }]]);
  eq(g2.st.seen.filter((s) => s.method === 'POST').map((s) => [s.path, s.body]), [['/repos/o/lab/actions/workflows/unit.yml/dispatches', { ref: 'main', inputs: { job: 'go', unit: 'daily' } }]]);
  ok(/成果物 unit-daily/.test(c2.log.guarded[0].done), c2.log.guarded[0].done);
  ok(!b2.all((e) => e.tagName === 'BUTTON' && /AI で変える/.test(e.textContent)).length, 'no aiMake: no AI button');
  // the editor in the tab when the panel gives none
  await b2.all((e) => e.attrs['data-unit'] === 'bds/coins')[0].button(/ファイルを直す/).click();
  ok(b2.byId('editor')?.attrs['data-unit'] === 'bds/coins', 'opened here');
  await b2.byId('editor').button(/閉じる/).click();
  ok(!b2.byId('editor'), 'closed');
  // a lab with no unit.yml: off, said why; the policy's gate passed on
  const c3 = ctxOf(fakeGitHub({ files: LAB }).api), b3 = new E('div');
  c3.ctx.lab.workflows = [{ path: '.github/workflows/verify.yml' }];
  await UI.unitsTab(b3, c3.ctx);
  const t3 = b3.all((e) => e.attrs['data-unit'] === 'bds/coins')[0].button(/試験/);
  ok(t3.disabled && /unit\.yml がありません/.test(t3.attrs.title) && /unit\.yml がまだありません/.test(b3.textContent), 'no unit.yml');
  await t3.click(); eq(c3.log.guarded, [], 'a button that is off does nothing');
  const c4 = ctxOf(fakeGitHub({ files: LAB }).api, { runUnit: () => {}, gate: (a) => (a === 'dispatch' ? { disabled: true, title: 'あなたの役割には許されていません' } : {}) }), b4 = new E('div');
  await UI.unitsTab(b4, c4.ctx);
  const t4 = b4.all((e) => e.attrs['data-unit'] === 'bds/coins')[0].button(/仕上げる/);
  ok(t4.disabled && t4.attrs.title === 'あなたの役割には許されていません' && b4.button(/^作る$/).disabled, 'the policy\'s gate');
  // no units: the three ways to begin
  const c5 = ctxOf(fakeGitHub({ files: {} }).api, { aiMake: (x) => c5.log.ai.push(x) }), b5 = new E('div');
  await UI.unitsTab(b5, c5.ctx);
  const none = b5.byId('nounits');
  ok(none && /AI で作る/.test(none.textContent) && /新しく作る/.test(none.textContent) && /取り込む/.test(none.textContent) && none.all((e) => e.tagName === 'LI').length === 3, none?.textContent);
  for (const b of none.all((e) => e.tagName === 'BUTTON')) await b.click();
  eq(c5.log.ai, [{}], 'AI: a new one');
  const c6 = ctxOf(fakeGitHub({ files: {} }).api), b6 = new E('div');
  await UI.unitsTab(b6, c6.ctx); await b6.byId('nounits').all((e) => e.tagName === 'BUTTON')[0].click();
  eq(c6.log.went, ['start'], 'no aiMake: to 「実行」');
  ok(!toast.textContent, `no error: ${toast.textContent}`);
  // the units not readable: why, in place of the list (and a toast)
  const b7 = new E('div');
  ok(await UI.unitsTab(b7, ctxOf(fakeGitHub({ files: LAB, fail: { '/repos/o/lab/contents/bds/addons': 403 } }).api).ctx) === undefined, 'nothing shown');
  ok(/権限がありません/.test(b7.all((e) => e.tagName === 'P' && e.className === 'bad')[0]?.textContent) && !/読んでいます/.test(b7.textContent) && /権限がありません/.test(toast.textContent), b7.textContent);
});

await t('the cards (fake DOM, fake GitHub): 新しく作る starts unit.yml with its inputs (a name taken refused first); 取り込む reads the file, puts its bytes in incoming/ as base64 and starts unit.yml, through guarded once; the editor reads with its sha, saves, saves again over the new one, refuses a broken manifest, and 保存して試験 runs the test', async () => {
  const { toast } = fakeDom();
  const UW = await imp('panel/ui/workspace.mjs');
  const f = fakeGitHub({ files: LAB }), { ctx, log } = ctxOf(f.api);
  // 新しく作る
  const nu = UW.newUnitCard(ctx);
  nu.byId('newunit-name').value = 'coins';
  await nu.button(/^作る$/).click();
  ok(/bds\/addons\/coins はもうあります/.test(toast.textContent) && !log.guarded.length, toast.textContent);
  nu.byId('newunit-name').value = ' ruby_sword '; nu.byId('newunit-title').value = 'Ruby Sword'; nu.byId('newunit-request').value = 'ルビーの剣';
  await nu.button(/^作る$/).click();
  eq([log.guarded.map((x) => [x.action, x.detail]), f.st.seen.at(-1).body], [[['dispatch', { workflow: 'unit.yml', job: 'new', unit: 'ruby_sword' }]], { ref: 'main', inputs: { job: 'new', unit: 'ruby_sword', title: 'Ruby Sword', request: 'ルビーの剣' } }]);
  ok(nu.byId('newunit-name').value === '' && nu.byId('newunit-request').value === '', 'emptied once started');
  nu.byId('newunit-name').value = 'Bad'; await nu.button(/^作る$/).click();
  ok(log.guarded.length === 1 && /英小文字/.test(toast.textContent), 'a bad name: said, nothing started');
  // 取り込む
  globalThis.FileReader = class { readAsDataURL(file) { setTimeout(() => { this.result = `data:application/octet-stream;base64,${Buffer.from(file.bytes).toString('base64')}`; this.onload(); }, 0); } };
  const im = UW.importCard(ctx), bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 250, 251, 252]);
  await im.button(/^取り込む$/).click();
  ok(/ファイルを選んでください/.test(toast.textContent) && log.guarded.length === 1, 'no file: said');
  im.byId('import-file').files = [{ name: 'Their Pack (v2).mcaddon', size: bytes.length, bytes }];
  im.byId('import-words').value = '新しい版で動くように';
  const before = f.st.seen.length;
  await im.button(/^取り込む$/).click();
  const sent = f.st.seen.slice(before);
  eq(sent.map((s) => `${s.method} ${s.path}`), ['GET /repos/o/lab/contents/incoming', 'PUT /repos/o/lab/contents/incoming/Their_Pack_v2.mcaddon', 'POST /repos/o/lab/actions/workflows/unit.yml/dispatches']);
  ok(Buffer.from(sent[1].body.content, 'base64').equals(bytes) && /\[skip ci\]$/.test(sent[1].body.message), 'the bytes as base64, the commit skips CI');
  eq([sent[2].body.inputs, log.guarded.at(-1).detail, log.guarded.length], [{ job: 'import', file: 'incoming/Their_Pack_v2.mcaddon', words: '新しい版で動くように' }, { workflow: 'unit.yml', job: 'import', file: 'incoming/Their_Pack_v2.mcaddon' }, 2]);
  ok(/✅ incoming\/Their_Pack_v2\.mcaddon に入れ/.test(im.byId('import-state').textContent) && im.byId('import-words').value === '', im.byId('import-state').textContent);
  im.byId('import-file').files = [{ name: 'x.exe', size: 3, bytes: [1, 2, 3] }];
  await im.button(/^取り込む$/).click();
  ok(log.guarded.length === 2 && /\.mcaddon・\.mcpack・\.zip/.test(toast.textContent), 'another kind: said, nothing sent');
  // the editor
  const ran = [], ed = UW.editorView({ ...ctx, runUnit: (x) => ran.push(x) }, U.unitSummary({ name: 'coins', manifest: LAB['bds/addons/coins/bp/manifest.json'] }));
  await settle();
  const text = ed.byId('edit-text'), pick = ed.byId('edit-file');
  eq([pick.value, text.value, text.disabled, ed.byId('edit-state').textContent], ['src/main.ts', LAB['bds/addons/coins/src/main.ts'], false, 'bds/addons/coins/src/main.ts']);
  ok(/TypeScript/.test(ed.textContent) && ed.all((e) => e.tagName === 'A').some((a) => a.attrs.href === 'https://github.com/o/lab/blob/main/bds/addons/coins/src/main.ts'), 'what to know, and GitHub');
  text.value = '// 1\n'; await ed.button(/^保存$/).click();
  text.value = '// 2\n'; await ed.button(/^保存$/).click();
  const puts = f.st.seen.filter((s) => s.method === 'PUT' && s.path.endsWith('src/main.ts'));
  eq([puts.length, puts[0].body.sha, puts[1].body.sha, f.st.files.get('bds/addons/coins/src/main.ts').data.toString()], [2, sha(Buffer.from(LAB['bds/addons/coins/src/main.ts'])), sha(Buffer.from('// 1\n')), '// 2\n'], 'each save over the sha it read or wrote');
  eq(log.guarded.slice(-2).map((x) => [x.action, x.detail]), [['dispatch', { file: 'bds/addons/coins/src/main.ts' }], ['dispatch', { file: 'bds/addons/coins/src/main.ts' }]]);
  await ed.button(/保存して試験/).click();
  eq([ran, f.st.seen.filter((s) => s.method === 'PUT' && s.path.endsWith('src/main.ts')).length], [[{ job: 'test', unit: 'coins' }], 2], 'nothing changed: only the test');
  pick.value = 'bp/manifest.json'; await pick.fire('change'); await settle();
  ok(/UUID/.test(ed.textContent), 'the manifest\'s note');
  text.value = '{ broken'; await ed.button(/^保存$/).click();
  ok(/JSON として読めません/.test(toast.textContent) && f.st.seen.filter((s) => s.method === 'PUT' && s.path.endsWith('manifest.json')).length === 0, 'a broken manifest is not saved');
  pick.value = 'rp/texts/ja_JP.lang'; await pick.fire('change'); await settle();
  ok(text.disabled && /このユニットにありません/.test(ed.byId('edit-state').textContent), 'a file it does not have');
  await ed.button(/^保存$/).click(); ok(/まだ読めていません/.test(toast.textContent), 'nothing read: nothing saved');
  // another's change since it was read: refused in words, theirs kept
  pick.value = 'tests.txt'; await pick.fire('change'); await settle();
  f.st.files.set('bds/addons/coins/tests.txt', { data: Buffer.from('## theirs\n'), sha: sha(Buffer.from('## theirs\n')) });
  text.value = '## mine\n'; await ed.button(/^保存$/).click();
  ok(/ほかの人が先に変えました/.test(log.errors.at(-1)) && f.st.files.get('bds/addons/coins/tests.txt').data.toString() === '## theirs\n', log.errors.join(' / '));
  ok(/ここで直せるのは bds のアドオン/.test(UW.editorView(ctx, U.unitSummary({ kind: 'end', name: 'hub' })).textContent), 'an Endstone plugin: not here');
});

await t('the 「配布」 tab (fake DOM, fake GitHub): the releases newest first, each file with its size and downloads, its link copied, Discord told through notify.yml (guarded), the totals; a draft not told; notify.yml missing or Discord not set up: off, said why', async () => {
  const { E, toast } = fakeDom();
  const UR = await imp('panel/ui/releases.mjs');
  const copied = [];
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (x) => { copied.push(x); } }, configurable: true });
  const f = fakeGitHub({ releases: RELEASES }), { ctx, log } = ctxOf(f.api), body = new E('div');
  const rs = await UR.releasesTab(body, ctx);
  eq(rs.map((r) => r.tag_name), ['v9', 'addon-shopkeeper', 'addon-coins', 'bundle-2026']);
  eq(body.all((e) => e.attrs['data-release']).map((e) => e.attrs['data-release']), ['v9', 'addon-shopkeeper', 'addon-coins', 'bundle-2026']);
  eq(body.byId('reltotals').textContent, 'リリース 4ファイル 7（パック 5）ダウンロード 15 回合わせて 136 KB');
  const coins = body.all((e) => e.attrs['data-release'] === 'addon-coins')[0];
  ok(/📦 coins-latest\.mcaddon 120 KB・7 回/.test(coins.textContent) && /📄 coins-source\.zip/.test(coins.textContent) && /下書き/.test(body.all((e) => e.attrs['data-release'] === 'v9')[0].textContent), coins.textContent);
  await coins.all((e) => e.attrs['data-asset'] === 'coins-latest.mcaddon')[0].button(/リンクを写す/).click();
  await settle();
  ok(copied[0] === 'https://github.com/o/lab/releases/download/x/coins-latest.mcaddon' && /coins-latest\.mcaddon のリンクを写しました/.test(toast.textContent), `${copied} ${toast.textContent}`);
  await coins.button(/Discord に知らせる/).click();
  eq([log.guarded.map((x) => [x.action, x.detail]), f.st.seen.at(-1).path, f.st.seen.at(-1).body], [[['dispatch', { workflow: 'notify.yml', release: 'addon-coins' }]], '/repos/o/lab/actions/workflows/notify.yml/dispatches', { ref: 'main', inputs: { run: '', message: 'Coins 1.0.0: https://github.com/o/lab/releases/tag/addon-coins' } }]);
  const draft = body.all((e) => e.attrs['data-release'] === 'v9')[0].button(/Discord/);
  ok(draft.disabled && /下書き/.test(draft.attrs.title), 'a draft is not told');
  // notify.yml missing; Discord not set up; the policy's gate
  const c2 = ctxOf(f.api), b2 = new E('div'); c2.ctx.lab.workflows = [];
  await UR.releasesTab(b2, c2.ctx);
  ok(b2.all((e) => e.attrs['data-release'] === 'addon-coins')[0].button(/Discord/).attrs.title === 'このラボには notify.yml がありません', 'no notify.yml');
  const c3 = ctxOf(f.api, { caps: { notify: { ok: false, need: '秘密 DISCORD_BOT_TOKEN と DISCORD_USER_ID（か LAB_NOTIFY_WEBHOOK）' } } }), b3 = new E('div');
  await UR.releasesTab(b3, c3.ctx);
  const n3 = b3.all((e) => e.attrs['data-release'] === 'addon-coins')[0].button(/Discord/);
  ok(n3.disabled && /DISCORD_BOT_TOKEN/.test(n3.attrs.title), 'Discord not set up: said what is missing');
  // none yet
  const b4 = new E('div');
  await UR.releasesTab(b4, ctxOf(fakeGitHub({ releases: [] }).api).ctx);
  ok(/まだリリースがありません/.test(b4.textContent) && b4.byId('reltotals').textContent === 'リリース 0ファイル 0（パック 0）ダウンロード 0 回合わせて 0 B', b4.textContent);
  // not readable: why, in place of the list
  const b5 = new E('div');
  await UR.releasesTab(b5, ctxOf(fakeGitHub({ fail: { '/repos/o/lab/releases': 404 } }).api).ctx);
  ok(/見つからない/.test(b5.all((e) => e.tagName === 'P' && e.className === 'bad')[0]?.textContent) && !/読んでいます/.test(b5.textContent), b5.textContent);
});

await t('the new files: text never parsed as HTML, no eval, no address but GitHub\'s; the Actions side spawns with no shell, the panel side imports nothing of node', () => {
  for (const f of ['panel/lib/units.mjs', 'panel/lib/releases.mjs', 'panel/lib/workspace.mjs', 'panel/ui/units.mjs', 'panel/ui/workspace.mjs', 'panel/ui/releases.mjs']) {
    const src = fs.readFileSync(path.join(TOP, f), 'utf8');
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|sessionStorage/.test(src), `${f}: no HTML parsing, no eval, nothing stored`);
    ok(![...src.matchAll(/https?:\/\/[\w.-]+/g)].map((m) => m[0]).some((u) => !/^https:\/\/(api\.github\.com|github\.com)$/.test(u)), `${f}: no other address`);
    ok(!/from 'node:|import\('node:/.test(src), `${f}: nothing of node`);
  }
  const ci = fs.readFileSync(path.join(TOP, 'common', 'unitci.mjs'), 'utf8');
  ok(/^\/\/ node lab\.mjs unitci/.test(ci) && [...ci.matchAll(/from 'node:child_process'/g)].length === 1 && /^import \{ spawnSync \} from 'node:child_process';$/m.test(ci) && !/shell\s*:/.test(ci), 'unitci: says what it is; spawnSync alone, no shell');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
