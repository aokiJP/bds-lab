// 実機（BDS）もネットワークも要らない自己点検。
// ここが通らない状態で実機を上げても意味がないので、迷ったらまずこれを走らせる。
//   node bin/bds-lab.mjs selftest
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what = '') => { if (a !== b) throw new Error(`${what}期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); };
const ok = (c, what) => { if (!c) throw new Error(what ?? '条件が成り立ちません'); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-selftest-'));

/** pure JS で tar を組む（外の tar コマンドに頼らない） */
function makeTgz(files) {
  const blocks = [];
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body, 'utf8');
    const head = Buffer.alloc(512, 0);
    head.write(name, 0, 100, 'utf8');
    head.write('000644 \0', 100, 8, 'utf8');
    head.write('000000 \0', 108, 8, 'utf8');
    head.write('000000 \0', 116, 8, 'utf8');
    head.write(`${data.length.toString(8).padStart(11, '0')} `, 124, 12, 'utf8');
    head.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')} `, 136, 12, 'utf8');
    head.write('        ', 148, 8, 'utf8');   // チェックサムの場所は空白で埋めてから計算する
    head.write('0', 156, 1, 'utf8');
    head.write('ustar\0' + '00', 257, 8, 'utf8');
    let sum = 0;
    for (const b of head) sum += b;
    head.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
    blocks.push(head, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

test('tar — npm の .tgz から index.d.ts を取り出せる', async () => {
  const { readTgz, pickFromTgz } = await import('../util/tar.mjs');
  const tgz = makeTgz({ 'package/README.md': 'hi', 'package/index.d.ts': 'declare const a: number;' });
  eq(readTgz(tgz).length, 2, '中身の数: ');
  eq(String(pickFromTgz(tgz, 'index.d.ts')), 'declare const a: number;');
  eq(pickFromTgz(tgz, 'nope.d.ts'), null, '無いものは null: ');
});

test('zip — 書いたものを読み直せる（UTF-8 の名前・非圧縮・大きめ）', async () => {
  const { writeZip } = await import('../util/zip.mjs');
  const { extractZip } = await import('../../tools/bds/get.mjs');
  const dir = tmpdir();
  const big = 'あ'.repeat(200000);
  const zip = path.join(dir, 'a.zip');
  writeZip(zip, [
    { name: '日本語/メモ.txt', body: 'こんにちは' },
    { name: 'big.txt', body: big },
    { name: 'raw.bin', body: Buffer.from([0, 1, 2, 3]) },
  ]);
  const out = path.join(dir, 'out');
  eq(extractZip(zip, out), 3, 'ファイル数: ');
  eq(fs.readFileSync(path.join(out, '日本語/メモ.txt'), 'utf8'), 'こんにちは');
  eq(fs.readFileSync(path.join(out, 'big.txt'), 'utf8').length, big.length);
  eq(fs.readFileSync(path.join(out, 'raw.bin')).length, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('collect — skip は一番上の階層にだけ効く（src/play/worlds を巻き込まない）', async () => {
  const { collect } = await import('../util/zip.mjs');
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'worlds'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'worlds', 'level.dat'), 'x');
  fs.mkdirSync(path.join(dir, 'src', 'play', 'worlds'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'play', 'worlds', 'voxel.js'), 'x');
  const names = collect(dir, '', new Set(['worlds'])).map((e) => e.name);
  ok(!names.includes('worlds/level.dat'), '一番上の worlds は外れるはず');
  ok(names.includes('src/play/worlds/voxel.js'), '下の worlds は残るはず');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bundle — import/export を畳んで、その場で動く 1 本にできる', async () => {
  const { bundle } = await import('../util/bundle.mjs');
  const files = {
    'scripts/config.js': 'export const CONFIG = { speed: 3 };\n',
    'scripts/util.js': 'export default function twice(n) { return n * 2; }\nexport const tag = "T";\n',
    'scripts/main.js': [
      'import { world } from "@minecraft/server";',
      'import { CONFIG } from "./config.js";',
      'import twice, { tag } from "./util.js";',
      'import * as all from "./config.js";',
      'world.out = `${tag}:${twice(CONFIG.speed)}:${all.CONFIG.speed}`;',
    ].join('\n'),
  };
  const b = bundle({ files, entry: 'scripts/main.js' });
  ok(!b.error, `畳めませんでした: ${b.error}`);
  const world = {};
  new Function('__outside', b.source)({ '@minecraft/server': { world } });
  eq(world.out, 'T:6:3');
});

test('bundle — 載せられない書き方は理由を返す（黙って壊れない）', async () => {
  const { bundle } = await import('../util/bundle.mjs');
  eq(Boolean(bundle({ files: { 'a.js': 'export * from "./b.js";' }, entry: 'a.js' }).error), true, 'export *: ');
  eq(Boolean(bundle({ files: { 'a.js': 'const x = import("./b.js");' }, entry: 'a.js' }).error), true, '動的 import: ');
  eq(Boolean(bundle({ files: { 'a.js': 'import { x } from "./nope.js";' }, entry: 'a.js' }).error), true, '読めない import: ');
  eq(Boolean(bundle({ files: { 'a.js': 'const x = 1;' }, entry: 'b.js' }).error), true, '入口が無い: ');
});

test('NBT — level.dat を読んで書いて、同じものに戻る', async () => {
  const { readLevelDat, writeLevelDat, TAG } = await import('../util/nbt.mjs');
  const { writeExperiments } = await import('../../tools/bds/experiments.mjs');
  const doc = {
    version: 10,
    name: '',
    type: TAG.COMPOUND,
    value: {
      LevelName: { type: TAG.STRING, value: 'bds-lab' },
      GameType: { type: TAG.INT, value: 1 },
      RandomSeed: { type: TAG.LONG, value: 1n },
      rainLevel: { type: TAG.FLOAT, value: 0 },
    },
  };
  const back = readLevelDat(writeLevelDat(doc));
  eq(back.value.LevelName.value, 'bds-lab');
  eq(back.value.GameType.value, 1);

  const dir = tmpdir();
  const file = path.join(dir, 'level.dat');
  fs.writeFileSync(file, writeLevelDat(doc));
  eq(await writeExperiments(file, ['gametest']), true, '1 回目は書き換わる: ');
  const after = readLevelDat(fs.readFileSync(file));
  eq(after.value.experiments.value.gametest.value, 1);
  eq(after.value.LevelName.value, 'bds-lab', '元の中身が残る: ');
  eq(await writeExperiments(file, ['gametest']), false, '2 回目は書き換えない: ');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('起動の失敗判定 — アドオンの例外を「起動できない」と取り違えない', async () => {
  const { classifyLine, explainFailure } = await import('../../tools/bds/server.mjs');
  eq(classifyLine('[Scripting] Import [config.js] not found'), null, 'アドオンの例外: ');
  eq(classifyLine('NO LOG FILE! - setting up server logging...'), null, 'ただのログ: ');
  ok(classifyLine('ERROR: Failed to bind to port 19132: address already in use'), 'ポートの衝突は拾うはず');
  eq(explainFailure(['[Scripting] Error: not found'], 'native'), null, '[Scripting] だけなら原因なし: ');
});

test('server.properties — 必要な設定が書かれ、読み直せる', async () => {
  const { setProperties, readProperties, ensureRunnable, REQUIRED_PROPERTIES } = await import('../../tools/bds/server.mjs');
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'server.properties'), 'server-name=old\n# コメント\nlevel-name=world\n');
  setProperties(dir, { 'server-name': 'lab', 'new-key': '1' });
  const p = readProperties(dir);
  eq(p['server-name'], 'lab');
  eq(p['new-key'], '1');
  eq(p['level-name'], 'world', '触っていない行は残る: ');
  ensureRunnable(dir, { port: 20000, portV6: 20001 });
  const q = readProperties(dir);
  for (const [k, v] of Object.entries(REQUIRED_PROPERTIES)) eq(q[k], v, `${k}: `);
  eq(q['server-port'], '20000');
  eq(ensureRunnable(dir, { port: 20000, portV6: 20001 }).length, 0, '2 回目は変えない: ');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('仕様書の実行 — 通る・落ちる・ゆらぎ・アドオンの申告', async () => {
  const { runSpecs, hintFor, Failed } = await import('../verify/spec-runner.mjs');
  let tries = 0;
  const specs = [
    { file: 'a.spec.mjs', name: '通る', async run(t) { t.expect(true); } },
    { file: 'a.spec.mjs', name: '落ちる', async run(t) { t.expect(false, 'わざと'); } },
    { file: 'a.spec.mjs', name: 'ゆらぐ', async run(t) { if (++tries < 2) throw new Failed('1 回目だけ落ちる'); } },
    { file: 'a.spec.mjs', name: '別のタグ', tags: ['real'], async run() { } },
  ];
  const logs = [];
  const makeCtx = async () => ({
    t: { expect(c, d) { if (!c) throw new Failed(d); return true; }, logs: () => logs, fromAddon: () => ({ notes: ['n=1'], metrics: { m: 2 }, failures: [] }) },
    notes: [],
  });
  const r = await runSpecs({ specs, makeCtx, tag: 'sim', say: () => {} });
  eq(r.total, 3, 'tag で絞る: ');
  eq(r.passed, 2);
  eq(r.results.find((x) => x.name === 'ゆらぐ').flaky, true);
  eq(r.results.find((x) => x.name === '落ちる').detail, 'わざと');
  ok(r.results[0].notes.includes('n=1'), 'アドオンの note が入る');
  ok(r.results[0].notes.includes('m=2'), 'アドオンの metric が入る');
  ok(hintFor('Import [config.js] not found'), '消したファイルの import に当たりが出る');
});

test('仕様書の実行 — アドオンが例外を出したら、通っていても落とす', async () => {
  const { runSpecs } = await import('../verify/spec-runner.mjs');
  const makeCtx = async () => ({
    t: { expect: () => true, logs: () => ['TypeError: x is not a function'], fromAddon: () => null },
    notes: [],
  });
  const r = await runSpecs({ specs: [{ file: 'a.spec.mjs', name: '通ったように見える', async run() { } }], makeCtx, tag: 'sim', say: () => {}, retry: false });
  eq(r.ok, false);
  ok(r.results[0].detail.includes('TypeError'), '例外の中身が残る');
});

test('報告 — 差分と、飛ばしたものが要約に出る', async () => {
  const { writeReport, readReport, summarize } = await import('../verify/spec-runner.mjs');
  const ROOT = tmpdir();
  writeReport({ ROOT, report: { version: '1.0', total: 2, passed: 2, results: [{ name: 'A', ok: true }, { name: 'B', ok: true }] } });
  const next = { version: '1.0', total: 2, passed: 1, results: [{ name: 'A', ok: true }, { name: 'B', ok: false, detail: 'だめ' }], skipped: ['C'], skippedWhy: 'ネットワークが無い' };
  writeReport({ ROOT, report: next });
  eq(next.diff.newlyFailed.join(), 'B');
  eq(readReport(ROOT).passed, 1);
  const text = summarize(next);
  ok(text.includes('今回から壊れた'), '壊れたものが出る');
  ok(text.includes('C'), '飛ばしたものが出る');
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('アドオンの読み取り — 雛形がそのまま読める / 壊れていれば理由が出る', async () => {
  const { readAddon } = await import('../verify/addon.mjs');
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const a = readAddon(path.join(ROOT, 'templates', 'addon'));
  eq(a.entry, 'scripts/main.js');
  eq(a.scriptEval, true, 'script_eval が入っている: ');
  ok(a.files['scripts/config.js'].includes('CONFIG'), 'config.js に CONFIG がある');

  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ header: { uuid: 'u' }, modules: [{ type: 'script', entry: 'scripts/nope.js' }] }));
  let why = '';
  try { readAddon(dir); } catch (e) { why = String(e.message); }
  ok(why.includes('入口のファイルがありません'), `理由が出る: ${why}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('モジュールの版 — npm の版と manifest の版を作り分ける', async () => {
  const { npmSpec, manifestVersion, dependencies, typeSpecs } = await import('../util/modules.mjs');
  ok(/^@minecraft\/server@\d/.test(npmSpec('server', 'stable')), 'npm の指定が作れる');
  eq(/-beta$/.test(manifestVersion('server', 'beta')), true, 'beta は -beta で終わる: ');
  eq(/^\d+\.\d+\.\d+$/.test(manifestVersion('server', 'stable')), true, 'stable は数字だけ: ');
  const deps = dependencies({ beta: true, ui: true, gametest: true });
  eq(deps.length, 3);
  eq(deps[0].module_name, '@minecraft/server');
  ok(typeSpecs({ beta: true }).length >= 2, '型定義の指定が作れる');
});

test('雛形づくり — 置き換えが残らず、仕様書まで出来る', async () => {
  const { scaffold, listAddons } = await import('./project.mjs');
  const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const ROOT = tmpdir();
  fs.cpSync(path.join(HERE, 'templates'), path.join(ROOT, 'templates'), { recursive: true });
  const r = scaffold({ ROOT, name: 'Free Camera!', description: '自由に飛ぶ', say: () => {} });
  eq(r.id, 'free_camera');
  eq(listAddons(ROOT).join(), 'free_camera');
  const manifest = fs.readFileSync(path.join(r.addonDir, 'manifest.json'), 'utf8');
  ok(!manifest.includes('__'), `置き換えが残っています: ${manifest.match(/__\w+__/)?.[0]}`);
  ok(JSON.parse(manifest).dependencies.some((d) => d.module_name === '@minecraft/server'), '依存が入る');
  const spec = fs.readFileSync(path.join(ROOT, 'specs', 'free_camera.spec.mjs'), 'utf8');
  ok(!spec.includes('__'), '仕様書にも置き換えが残らない');
  ok(spec.includes('FREE_CAMERA'), 'タグが入る');
  eq(scaffold({ ROOT, name: 'free_camera', say: () => {} }).existed, true, '2 回目は作り直さない: ');
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('AI に渡す zip — 中身が揃っていて、実機は入れたり外したりできる', async () => {
  const { makeHandoff, readState } = await import('./handoff.mjs');
  const { scaffold } = await import('./project.mjs');
  const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const ROOT = tmpdir();
  for (const d of ['templates', 'skills', 'bin', 'src', 'tools', 'types', 'data']) fs.cpSync(path.join(HERE, d), path.join(ROOT, d), { recursive: true });
  for (const f of ['AGENTS.md', 'START_HERE.md', 'README.md', 'package.json']) fs.copyFileSync(path.join(HERE, f), path.join(ROOT, f));
  const p = scaffold({ ROOT, name: 'demo', say: () => {} });
  fs.mkdirSync(path.join(ROOT, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'vendor', 'bedrock-server.zip'), crypto.randomBytes(300000));   // 圧縮で消えない中身にする

  const { extractZip } = await import('../../tools/bds/get.mjs');
  const withBds = makeHandoff({ ROOT, addonDir: p.addonDir, specsDir: path.join(ROOT, 'specs'), say: () => {} });
  eq(withBds.round, 1);
  const out = path.join(tmpdir(), 'unzipped');   // ROOT の中に置くと 2 個目の zip に巻き込まれる
  extractZip(withBds.zip, out);
  for (const need of ['START_HERE.md', 'PROMPT.md', 'AGENTS.md', 'package.json', 'bin/bds-lab.mjs', 'specs/demo.spec.mjs', 'addons/demo/manifest.json', 'vendor/bedrock-server.zip']) {
    ok(fs.existsSync(path.join(out, need)), `zip に ${need} が要ります`);
  }
  ok(fs.readFileSync(path.join(out, 'PROMPT.md'), 'utf8').includes('demo'), 'PROMPT.md に名前が入る');

  const noBds = makeHandoff({ ROOT, addonDir: p.addonDir, specsDir: path.join(ROOT, 'specs'), say: () => {}, withBds: false });
  eq(noBds.round, 2, '回を数える: ');
  eq(readState(ROOT).round, 2);
  const out2 = path.join(tmpdir(), 'unzipped2');
  extractZip(noBds.zip, out2);
  ok(!fs.existsSync(path.join(out2, 'vendor', 'bedrock-server.zip')), '--no-bds では実機を入れない');
  ok(fs.statSync(noBds.zip).size < fs.statSync(withBds.zip).size, '実機を外すと小さくなる');
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('archive — node_modules と実機を消し、残りを zip にできる', async () => {
  const { archive } = await import('./archive.mjs');
  const { extractZip } = await import('../../tools/bds/get.mjs');
  const ROOT = tmpdir();
  fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src', 'a.mjs'), '// ソース');
  fs.mkdirSync(path.join(ROOT, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'node_modules', 'x', 'index.js'), 'x'.repeat(1000));
  fs.mkdirSync(path.join(ROOT, 'vendor', 'bedrock-server'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'vendor', 'bedrock-server', 'bedrock_server'), 'y'.repeat(1000));
  fs.writeFileSync(path.join(ROOT, 'vendor', 'bedrock-server.zip'), crypto.randomBytes(2000));
  fs.mkdirSync(path.join(ROOT, '.bds-lab'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.bds-lab', 'state.json'), '{}');

  const said = [];
  const r = archive({ ROOT, say: (m) => said.push(m) });
  ok(!fs.existsSync(path.join(ROOT, 'node_modules')), 'node_modules を消すはず');
  ok(!fs.existsSync(path.join(ROOT, 'vendor', 'bedrock-server')), '展開済みの実機を消すはず');
  ok(fs.existsSync(path.join(ROOT, 'vendor', 'bedrock-server.zip')), 'bedrock-server.zip 自体は残すはず');
  ok(r.freed > 0, '空いた容量を数えるはず');

  const out = path.join(tmpdir(), 'unzipped');
  extractZip(r.zip, out);
  ok(fs.existsSync(path.join(out, 'src', 'a.mjs')), 'src は入るはず');
  ok(!fs.existsSync(path.join(out, 'node_modules')), 'zip に node_modules は入らないはず');
  ok(!fs.existsSync(path.join(out, 'vendor')), 'zip に vendor は入らないはず（既定では --with-vendor 無し）');
  ok(!fs.existsSync(path.join(out, '.bds-lab')), 'zip に .bds-lab は入らないはず');

  const customZip = path.join(tmpdir(), 'custom.zip');
  const r2 = archive({ ROOT, say: () => {}, clean: false, withVendorZip: true, out: customZip });
  eq(r2.zip, customZip, '--out を尊重するはず');
  const out2 = path.join(tmpdir(), 'unzipped2');
  extractZip(r2.zip, out2);
  ok(fs.existsSync(path.join(out2, 'vendor', 'bedrock-server.zip')), '--with-vendor なら実機の zip も入るはず');
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('CLI — スペース無しでくっついたオプションは、黙って無視せずはっきり止める', () => {
  const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const ROOT = tmpdir();
  for (const d of ['bin', 'src', 'tools']) fs.cpSync(path.join(HERE, d), path.join(ROOT, d), { recursive: true });

  const bad = spawnSync('node', ['bin/bds-lab.mjs', 'archive', '--with-vendor--no-clean'], { cwd: ROOT, encoding: 'utf8' });
  ok(bad.status !== 0, 'くっついたオプションでは失敗するはず');
  ok(bad.stderr.includes('archive に無いオプションです'), `エラーの中身: ${bad.stderr}`);
  ok(!fs.existsSync(path.join(ROOT, '.bds-lab', 'archive')), '止まったので zip は作らないはず');

  const good = spawnSync('node', ['bin/bds-lab.mjs', 'archive', '--no-clean', '--with-vendor'], { cwd: ROOT, encoding: 'utf8' });
  eq(good.status, 0, `正しくスペースで分ければ通るはず: ${good.stderr}`);

  const other = spawnSync('node', ['bin/bds-lab.mjs', 'archive', '--no-github'], { cwd: ROOT, encoding: 'utf8' });
  ok(other.status !== 0, 'archive には無いオプション（他のコマンドのもの）でも止まるはず');
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('返信の取り込み — アドオンを丸ごと入れ替え、前の版を残す', async () => {
  const { apply } = await import('./apply.mjs');
  const { writeZip } = await import('../util/zip.mjs');
  const ROOT = tmpdir();
  const addonDir = path.join(ROOT, 'addons', 'demo');
  fs.mkdirSync(path.join(addonDir, 'scripts'), { recursive: true });
  const manifest = JSON.stringify({ header: { uuid: 'u', version: [1, 0, 0] }, modules: [{ type: 'script', entry: 'scripts/main.js' }] });
  fs.writeFileSync(path.join(addonDir, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(addonDir, 'scripts', 'main.js'), '// 古い');
  fs.writeFileSync(path.join(addonDir, 'scripts', 'old.js'), '// 消えるはず');
  fs.writeFileSync(path.join(addonDir, 'TASK.md'), '# 依頼書');

  const zip = path.join(ROOT, 'reply.zip');
  writeZip(zip, [
    { name: 'demo/manifest.json', body: manifest },
    { name: 'demo/scripts/main.js', body: '// 新しい' },
    { name: 'specs/demo.spec.mjs', body: 'export default [];' },
  ]);
  const r = await apply({ ROOT, zipPath: zip, addonDir, specsDir: path.join(ROOT, 'specs'), say: () => {} });
  eq(r.specs, 1, '仕様書も取り込む: ');
  eq(fs.readFileSync(path.join(addonDir, 'scripts', 'main.js'), 'utf8'), '// 新しい');
  ok(!fs.existsSync(path.join(addonDir, 'scripts', 'old.js')), '返さなかったファイルは消える');
  ok(fs.existsSync(path.join(addonDir, 'TASK.md')), 'TASK.md は残す');
  ok(fs.existsSync(path.join(ROOT, '.bds-lab', 'history', '00', 'scripts', 'old.js')), '前の版が残る');
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('GitHub — gh が無くても手元の git だけで進む', async () => {
  if (spawnSync('git', ['--version']).status !== 0) return 'git が無いので飛ばしました';
  const { setupRepo, currentBranch, gitReady } = await import('./github.mjs');
  const ROOT = tmpdir();
  fs.writeFileSync(path.join(ROOT, 'README.md'), 'x');
  fs.mkdirSync(path.join(ROOT, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'vendor', 'bedrock-server.zip'), Buffer.alloc(1024, 1));
  const r = await setupRepo({ ROOT, repoName: 'demo', branch: 'addon/demo', say: () => {} });
  eq(gitReady(ROOT), true);
  eq(r.branch, 'addon/demo');
  eq(currentBranch(ROOT), 'addon/demo');
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const n of ['node_modules/', 'vendor/*', '!vendor/bedrock-server.zip', '.bds-lab/']) ok(ignore.includes(n), `.gitignore に ${n} が要ります`);
  fs.rmSync(ROOT, { recursive: true, force: true });
  return null;
});

test('GitHub — 45MB を超える実機は、git-lfs が無ければ載せない', async () => {
  if (spawnSync('git', ['--version']).status !== 0) return 'git が無いので飛ばしました';
  if (spawnSync('git', ['lfs', 'version']).status === 0) return 'git-lfs があるので飛ばしました';
  const { setupRepo } = await import('./github.mjs');
  const ROOT = tmpdir();
  fs.writeFileSync(path.join(ROOT, 'README.md'), 'x');
  fs.mkdirSync(path.join(ROOT, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'vendor', 'bedrock-server.zip'), Buffer.alloc(50 * 1024 * 1024, 1));
  await setupRepo({ ROOT, repoName: 'demo', branch: 'addon/demo', say: () => {} });
  const tracked = spawnSync('git', ['ls-files', 'vendor'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  eq(tracked, '', '大きすぎる実機は git に載せない: ');
  fs.rmSync(ROOT, { recursive: true, force: true });
  return null;
});

test('型定義 — 取れなかった理由が、そのまま読める形で出る', async () => {
  const { whyFailed, haveTypes, typeDir } = await import('./docs.mjs');
  ok(whyFailed({ stderr: 'ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND  No package.json' }).includes('ERR_PNPM'), 'pnpm の理由を拾う');
  ok(whyFailed({ stderr: 'npm error code E403\nnpm error 403 Forbidden' }).includes('E403'), 'npm の理由を拾う');
  eq(whyFailed({ error: { code: 'ETIMEDOUT', message: 'x' } }), '時間切れ');
  const ROOT = tmpdir();
  eq(haveTypes(ROOT), false);
  fs.mkdirSync(typeDir(ROOT), { recursive: true });
  fs.writeFileSync(path.join(typeDir(ROOT), 'server.d.ts'), 'x');
  eq(haveTypes(ROOT), true);
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('型定義 — registry の .tgz から直に取り込める（pnpm も npm も通さない）', async () => {
  const { syncTypes, haveTypes, typeDir } = await import('./docs.mjs');
  const ROOT = tmpdir();
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url).includes('server-gametest')) return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => makeTgz({ 'package/index.d.ts': `// ${url}` }) };
  };
  try {
    const dir = await syncTypes({ ROOT, say: () => {} });
    eq(dir, typeDir(ROOT));
    eq(haveTypes(ROOT), true);
    ok(asked.every((u) => u.startsWith('https://registry.npmjs.org/@minecraft/')), `取りに行く先: ${asked[0]}`);
    ok(fs.existsSync(path.join(typeDir(ROOT), 'server.d.ts')), 'server.d.ts が要ります');
    ok(fs.existsSync(path.join(typeDir(ROOT), 'server-ui.d.ts')), 'server-ui.d.ts が要ります');
    ok(!fs.existsSync(path.join(typeDir(ROOT), 'server-gametest.d.ts')), '取れなかったものは書かない');
    const versions = fs.readFileSync(path.join(typeDir(ROOT), 'VERSIONS.md'), 'utf8');
    ok(versions.includes('@minecraft/server'), 'どの版かを残す');
    asked.length = 0;
    await syncTypes({ ROOT, say: () => {} });
    eq(asked.length, 0, '2 回目は取りに行かない: ');
  } finally {
    globalThis.fetch = real;
    fs.rmSync(ROOT, { recursive: true, force: true });
  }
});

test('bundle — 副作用だけの import が、次の import に飲み込まれない', async () => {
  const { bundle } = await import('../util/bundle.mjs');
  const files = {
    'scripts/side.js': 'globalThis.__side = (globalThis.__side ?? 0) + 1;\n',
    'scripts/util.js': 'export const two = 2;\n',
    'scripts/main.js': [
      'import "./side.js";',
      'import { two } from "./util.js";',
      'globalThis.__out = two;',
    ].join('\n'),
  };
  const b = bundle({ files, entry: 'scripts/main.js' });
  ok(!b.error, `畳めませんでした: ${b.error}`);
  delete globalThis.__side; delete globalThis.__out;
  new Function('__outside', b.source)({});
  eq(globalThis.__side, 1, '副作用の import が 1 回走る: ');
  eq(globalThis.__out, 2);
  delete globalThis.__side; delete globalThis.__out;
});

test('.mcaddon の取り込み — BP と RP を分けて置き、仕様書まで作る', async () => {
  const { importAddon } = await import('./import.mjs');
  const { writeZip } = await import('../util/zip.mjs');
  const { readAddon, asResourcePack } = await import('../verify/addon.mjs');
  const ROOT = tmpdir();
  const bpUuid = '11111111-2222-4333-8444-555555555555';
  const rpUuid = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  const bp = {
    format_version: 2,
    header: { name: 'Demo Pack [BP]', uuid: bpUuid, version: [1, 0, 0], min_engine_version: [1, 21, 0] },
    modules: [{ type: 'data', uuid: '11111111-2222-4333-8444-555555555556', version: [1, 0, 0] },
      { type: 'script', language: 'javascript', uuid: '11111111-2222-4333-8444-555555555557', version: [1, 0, 0], entry: 'scripts/main.js' }],
    dependencies: [{ uuid: rpUuid, version: [1, 0, 0] }, { module_name: '@minecraft/server', version: '1.9.0' }],
  };
  const rp = { format_version: 2, header: { name: 'Demo Pack [RP]', uuid: rpUuid, version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'resources', uuid: '66666666-7777-4888-8999-aaaaaaaaaaab', version: [1, 0, 0] }] };
  const mcaddon = path.join(ROOT, 'demo.mcaddon');
  writeZip(mcaddon, [
    { name: 'demo bp/manifest.json', body: JSON.stringify(bp) },
    { name: 'demo bp/scripts/main.js', body: 'import "./util";\nconsole.warn("DEMO loaded");\n' },
    { name: 'demo bp/scripts/util.js', body: 'export const x = 1;\n' },
    { name: 'demo bp/entities/bot.json', body: JSON.stringify({ format_version: '1.21.0', 'minecraft:entity': { description: { identifier: 'demo:bot' } } }) },
    { name: 'demo rp/manifest.json', body: JSON.stringify(rp) },
    { name: 'demo rp/textures/x.json', body: '{}' },
  ]);

  const r = await importAddon({ ROOT, file: mcaddon, say: () => {} });
  eq(r.id, 'demo_pack', '[BP] を名前から落とす: ');
  ok(fs.existsSync(path.join(r.dir, 'behavior_pack', 'manifest.json')), 'BP を置く');
  ok(fs.existsSync(path.join(r.dir, 'resource_pack', 'manifest.json')), 'RP も置く');
  ok(fs.existsSync(path.join(ROOT, 'specs', 'demo_pack.spec.mjs')), '仕様書を作る');
  ok(r.warnings.some((w) => w.module === '@minecraft/server'), '古い版を警告する');

  const addon = readAddon(r.dir);
  eq(addon.entry, 'scripts/main.js');
  eq(addon.rp.uuid, rpUuid, 'RP を一緒に読む: ');
  eq(asResourcePack(addon).name, 'demo_pack_rp');
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('inspect — 実機を上げずに、読み込めない理由を見つけて直せる', async () => {
  const { inspect, fix, parseLoose } = await import('./inspect.mjs');
  const { importAddon } = await import('./import.mjs');
  const { writeZip } = await import('../util/zip.mjs');
  const ROOT = tmpdir();
  const bpUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const bp = {
    format_version: 2,
    header: { name: 'Bad', uuid: bpUuid, version: [1, 0, 0] },
    modules: [{ type: 'script', language: 'javascript', uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef', version: [1, 0, 0], entry: 'scripts/main.js' }],
    dependencies: [{ module_name: '@minecraft/server', version: '1.9.0' }],
  };
  const mcaddon = path.join(ROOT, 'bad.mcaddon');
  writeZip(mcaddon, [
    { name: 'bad/manifest.json', body: JSON.stringify(bp) },
    { name: 'bad/scripts/main.js', body: 'import "./util";\nworld.beforeEvents.chatSend.subscribe(() => {});\nconst p = new Proxy({}, {});\n' },
    { name: 'bad/scripts/util.js', body: 'export const x = 1;\n' },
    { name: 'bad/entities/a.json', body: JSON.stringify({ format_version: '1.21.0', 'minecraft:entity': { description: { identifier: 'demo:same' } } }) },
    { name: 'bad/entities/b.json', body: JSON.stringify({ format_version: '1.21.0', 'minecraft:entity': { description: { identifier: 'demo:same' } } }) },
  ]);
  const r = await importAddon({ ROOT, file: mcaddon, say: () => {} });

  const before = inspect({ ROOT, addonDir: r.dir, say: () => {} });
  eq(before.ok, false, '読み込めない理由がある: ');
  const why = [...before.errors, ...before.warns].map((f) => f.why).join('\n');
  ok(/1\.9\.0 は古い系列/.test(why), 'モジュールの版を見つける');
  ok(/chatSend/.test(why), 'chatSend を見つける');
  ok(/Proxy/.test(why), 'Proxy を見つける');
  ok(/identifier が .* と重複/.test(why), 'identifier の重複を見つける');
  ok(/拡張子がありません/.test(why), '拡張子なしの import を見つける');

  fix({ addonDir: r.dir, say: () => {} });
  const manifest = JSON.parse(fs.readFileSync(path.join(r.dir, 'behavior_pack', 'manifest.json'), 'utf8'));
  ok(!manifest.dependencies[0].version.startsWith('1.'), `版を直す: ${manifest.dependencies[0].version}`);
  ok(manifest.capabilities.includes('script_eval'), 'script_eval を足す');
  ok(fs.readFileSync(path.join(r.dir, 'behavior_pack', 'scripts', 'main.js'), 'utf8').includes('"./util.js"'), 'import に .js を足す');

  const after = inspect({ ROOT, addonDir: r.dir, say: () => {} });
  ok(after.errors.every((e) => !/1\.9\.0/.test(e.why)), '版の指摘は消える');
  eq(parseLoose('{ "a": 1 } // メモ').comments, true, 'コメント付き JSON も読める: ');
  eq(parseLoose('{ nope').ok, false);
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test('実機の世界 — リソースパックも置き、種として取っておける', async () => {
  const { Bds } = await import('../../tools/bds/server.mjs');
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, 'server.properties'), '');
  const bds = new Bds({ dir, level: 'lab', port: 30000, portV6: 30001 });
  bds.prepare({
    packs: [{ name: 'bp', uuid: 'u1', version: [1, 0, 0], files: { 'manifest.json': '{}' } }],
    resourcePacks: [{ name: 'rp', uuid: 'u2', version: [1, 0, 0], files: { 'manifest.json': '{}', 'textures/a.png': Buffer.from([1, 2]) } }],
  });
  ok(fs.existsSync(path.join(bds.worldDir, 'behavior_packs', 'bp', 'manifest.json')), 'BP が入る');
  ok(fs.existsSync(path.join(bds.worldDir, 'resource_packs', 'rp', 'textures', 'a.png')), 'RP が入る');
  eq(JSON.parse(fs.readFileSync(path.join(bds.worldDir, 'world_resource_packs.json'), 'utf8'))[0].pack_id, 'u2');

  const cache = path.join(dir, 'cache');
  eq(bds.snapshotWorld(cache), false, 'level.dat が無ければ取っておかない: ');
  fs.writeFileSync(path.join(bds.worldDir, 'level.dat'), 'x');
  fs.mkdirSync(path.join(bds.worldDir, 'db'), { recursive: true });
  fs.writeFileSync(path.join(bds.worldDir, 'db', 'CURRENT'), 'y');
  eq(bds.snapshotWorld(cache), true);
  ok(fs.existsSync(path.join(cache, 'db', 'CURRENT')), '世界の中身は取っておく');
  ok(!fs.existsSync(path.join(cache, 'behavior_packs')), 'パックは取っておかない（毎回入れ直すもの）');

  fs.rmSync(bds.worldDir, { recursive: true, force: true });
  eq(bds.seedWorld(cache), true, '種から戻せる: ');
  ok(fs.existsSync(path.join(bds.worldDir, 'level.dat')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('版の追いかけ — npm の版を系統ごとに振り分けられる', async () => {
  const { pickTracks, trackOf, newer } = await import('./update.mjs');
  eq(trackOf('2.10.0'), 'stable');
  eq(trackOf('2.11.0-beta.1.26.51-stable'), 'beta');
  eq(trackOf('2.11.0-rc.1.26.60-preview.25'), 'preview');
  eq(trackOf('2.12.0-beta.1.26.60-preview.25'), 'preview_beta');
  ok(newer('2.11.0', '2.10.0') > 0, '数字で比べる');
  ok(newer('2.10.0', '2.10.0-beta.1') > 0, '安定版のほうが新しい');
  ok(newer('1.26.60', '1.26.9') > 0, '9 より 60 が新しい');
  const t = pickTracks(['2.9.0', '2.10.0', '2.11.0-beta.1.26.51-stable', '2.10.0-beta.1.26.40-stable', '2.12.0-beta.1.26.60-preview.25']);
  eq(t.stable, '2.10.0');
  eq(t.beta, '2.11.0-beta.1.26.51-stable');
  eq(t.preview_beta, '2.12.0-beta.1.26.60-preview.25');
});

test('公開まわり — 枝からタグを決め、BDS の落とし先を選べる', async () => {
  const { tagFor } = await import('./release.mjs');
  const { pickDownloadUrl } = await import('../../tools/bds/get.mjs');
  eq(tagFor('main'), 'template');
  eq(tagFor('addon/free_camera'), 'addon-free_camera');
  const json = { result: { links: [
    { downloadType: 'serverBedrockWindows', downloadUrl: 'https://x/win.zip' },
    { downloadType: 'serverBedrockLinux', downloadUrl: 'https://x/linux.zip' },
  ] } };
  eq(pickDownloadUrl(json, { kind: 'linux' }), 'https://x/linux.zip');
  eq(pickDownloadUrl(json, { kind: 'windows' }), 'https://x/win.zip');
  eq(pickDownloadUrl({}, { kind: 'linux' }), null);
});

test('アドオンからの合図 — note / metric / fail を拾う', async () => {
  const { Bridge } = await import('../verify/bridge.mjs');
  const sent = [];
  const b = new Bridge({ ROOT: tmpdir(), addonDir: '.', send: (c) => sent.push(c) });
  eq(b.handle('[2026-01-01 00:00:00 INFO] [Scripting] lab:action {"op":"note","text":"やあ","id":"1"}'), true);
  eq(b.notes.join(), 'やあ');
  ok(sent[0].includes('lab:reply'), '返事を送る');
  b.handle('[Scripting] lab:action {"op":"metric","key":"fov","value":70}');
  eq(b.metrics.fov, 70);
  b.handle('[Scripting] lab:action {"op":"fail","reason":"だめ"}');
  eq(b.failures.join(), 'だめ');
  eq(b.handle('[Scripting] ふつうのログ'), false, 'ふつうの行は素通り: ');
  eq(b.handle('[Scripting] lab:action {"op":"shell","command":"echo"}'), true);
  ok(sent.every((c) => !c.includes('"ok":true,"payload":{"status"')), '外のコマンドは既定で止まっている');
  b.reset();
  eq(b.notes.length, 0);
});

test('仕様書の選び分け — 別のアドオンの仕様書を読まない（#36）', async () => {
  const { loadSpecs } = await import('../verify/spec-runner.mjs');
  const dir = tmpdir();
  const body = "export default [{ name: 'x', run() {} }];\n";
  for (const f of ['_environment.spec.mjs', 'fly.spec.mjs', 'probe.spec.mjs', 'smoke.spec.mjs']) fs.writeFileSync(path.join(dir, f), body);
  fs.mkdirSync(path.join(dir, 'probe'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'probe', 'extra.spec.mjs'), body);

  const mine = await loadSpecs(dir, { addon: 'probe', others: ['fly'] });
  const files = mine.map((x) => x.file).sort();
  eq(files.join(','), '_environment.spec.mjs,probe.spec.mjs,probe/extra.spec.mjs,smoke.spec.mjs',
    '共通・自分・自分のフォルダ・どのアドオンでもないものだけ: ');
  ok(!files.includes('fly.spec.mjs'), '別のアドオンの仕様書は読まない');

  const all = await loadSpecs(dir);
  eq(all.length, 4, 'アドオンを指定しなければ、いままで通り全部: ');
});

test('取り込み — 動かない中身では入れ替えない（#17）', async () => {
  const { validate } = await import('./apply.mjs');
  const pack = (files) => ({ manifest: { modules: [{ type: 'script', entry: 'scripts/main.js' }] }, files });

  eq(validate(pack({ 'scripts/main.js': 'export const a = 1;\n' })).length, 0, '正しい中身は通す: ');
  ok(validate(pack({ 'scripts/main.js': 'export const a = (;\n' }))[0]?.includes('scripts/main.js'), '構文エラーを見つける');
  ok(validate(pack({ 'scripts/main.js': 'const a = 1;\n// 以下同じ\n' })).length > 0, '「以下同じ」を見つける');
  ok(validate(pack({ 'scripts/other.js': 'const a = 1;\n' }))[0]?.includes('入口'), '入口の無い返信を弾く');
});

test('API の索引 — 名前で引けて、実機に在るかも出る', async () => {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  if (!fs.existsSync(path.join(ROOT, 'types', 'minecraft', 'server.d.ts'))) return '型定義がありません（npm run docs）';
  const { lookup } = await import('./api.mjs');

  const cls = lookup({ ROOT, query: 'InputInfo' });
  ok(cls.length <= 25, `25 行以内（実際 ${cls.length}）`);
  ok(cls[0].startsWith('InputInfo'), '見出しが引いたものと同じ');
  ok(cls.some((l) => l.includes('getMovementVector')), 'メンバーが出る');

  const one = lookup({ ROOT, query: 'InputInfo.getMovementVector' });
  ok(one[0].includes('Vector2'), '戻り値が出る');

  const miss = lookup({ ROOT, query: 'Playr' });
  ok(miss[0].includes('Player'), `近い名前を出す（${miss[0]}）`);

  const found = lookup({ ROOT, query: null, find: 'movementVector' });
  ok(found.some((l) => l.includes('InputInfo')), '語からも探せる');
});

test('結果の要約 — 40 行以内で、最初の失敗だけを出す', async () => {
  const { lines } = await import('./status.mjs');
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, '.bds-lab'), { recursive: true });
  const results = [
    ...Array.from({ length: 20 }, (_, i) => ({ name: `通る ${i}`, ok: true, notes: [] })),
    { name: '落ちる A', ok: false, detail: 'これが原因', hint: 'ここを直す', notes: ['実機で読んだ値'] },
    { name: '落ちる B', ok: false, detail: '2 つ目', notes: [] },
  ];
  fs.writeFileSync(path.join(dir, '.bds-lab', 'report.json'), JSON.stringify({
    at: '2026-09-21T00:00:00.000Z', version: '1.26.51.1', addon: 'probe', how: 'eval',
    total: 22, passed: 20, results, skipped: ['real の 1 本'], diff: { newlyFailed: ['落ちる A'] },
  }));

  const out = lines(dir);
  ok(out.length <= 40, `40 行以内（実際 ${out.length}）`);
  ok(out.join('\n').includes('落ちる A'), '最初の失敗は出る');
  ok(!out.join('\n').includes('2 つ目'), '2 つ目の中身は出さない');
  ok(out.join('\n').includes('これが原因'), '原因が出る');
  ok(lines(dir, { full: true }).length > out.length, '--full では増える');
  eq(lines(tmpdir())[0], 'まだ検証していません → npm test', '結果が無いときの案内: ');
});

test('.gitignore — 実機の zip が git に載る形になっている（#21）', () => {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const body = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  ok(!body.includes('vendor/'), 'vendor/ だと打ち消しが効かない（vendor/* にする）');
  ok(body.includes('vendor/*') && body.includes('!vendor/bedrock-server.zip'), 'vendor/* と打ち消しが揃っている');
  const r = spawnSync('git', ['check-ignore', '-q', 'vendor/bedrock-server.zip'], { cwd: ROOT });
  if (r.error || r.status === 128) return 'git が使えません';
  eq(r.status, 1, '実機の zip は無視されない（1 = 無視されない）: ');
});

export async function selftest({ say = console.log } = {}) {
  let failed = 0;
  let skipped = 0;
  for (const t of tests) {
    try {
      const note = await t.fn();
      if (note) { skipped++; say(`－ ${t.name} — ${note}`); }
      else say(`✔ ${t.name}`);
    } catch (e) {
      failed++;
      say(`✘ ${t.name}`);
      say(`   ${String(e?.message ?? e).split('\n').join('\n   ')}`);
    }
  }
  say('');
  say(`${tests.length - failed - skipped}/${tests.length - skipped} 通りました${skipped ? `（${skipped} 件は飛ばしました）` : ''}`);
  if (!failed) say('実機もネットワークも要らないところは、すべて動いています');
  return { ok: failed === 0, total: tests.length, failed, skipped };
}
