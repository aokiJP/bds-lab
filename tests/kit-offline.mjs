#!/usr/bin/env node
// kit + pixel presets + `add` without a server: every shape draws, kit.js matches kit.ts, add writes names in every language.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pixel, SHAPES } from '../common/pixel.mjs';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };
for (const s of SHAPES) {
  const p = pixel(s + ':3080f0'), pal = new Set(p.pal.split(' ').map((x) => x[0]));
  const good = p.rows.length === 16 && p.rows.every((r) => r.length === 16 && [...r].every((ch) => ch === '.' || pal.has(ch))) && p.rows.join('').replace(/\./g, '').length > 20;
  ok(good, `pixel ${s}: 16x16, palette complete, drawn`);
}
ok((() => { try { pixel('nope'); return false; } catch (e) { return /gem/.test(e.message); } })(), 'unknown shape lists the shapes');
// kit.js (for --js addons without TypeScript) is kit.ts transpiled
const tsf = [path.join(TOP, 'bds', '.lab', 'node', 'node_modules', 'typescript'), ...fs.globSync?.(path.join(TOP, 'bds', '.lab', '**', 'node_modules', 'typescript')) ?? []].find((d) => fs.existsSync(path.join(d ?? '', 'package.json')));
if (tsf) {
  const ts = createRequire(import.meta.url)(tsf);
  const want = ts.transpileModule(fs.readFileSync(path.join(TOP, 'common', 'kit', 'kit.ts'), 'utf8'), { compilerOptions: { target: 99, module: 99 } }).outputText;
  const have = fs.readFileSync(path.join(TOP, 'common', 'kit', 'kit.js'), 'utf8').split('\n').slice(1).join('\n');
  if (process.argv.includes('--fix') && want !== have) fs.writeFileSync(path.join(TOP, 'common', 'kit', 'kit.js'), '// generated from kit.ts by tests/kit-offline.mjs --fix (new --js copies it when no TypeScript is at hand)\n' + want);
  ok(want === have || process.argv.includes('--fix'), 'common/kit/kit.js = kit.ts transpiled (after editing kit.ts: node tests/kit-offline.mjs --fix)');
} else console.log('- kit.js check skipped (no TypeScript in the cache yet)');
// kit/versions.json knows the current kit (else old units' unedited copies would never be brought up to it)
{
  const vf = path.join(TOP, 'common', 'kit', 'versions.json'), v = JSON.parse(fs.readFileSync(vf, 'utf8'));
  const { kitHash } = await import('../common/build.mjs');
  const cur = { ts: kitHash(fs.readFileSync(path.join(TOP, 'common', 'kit', 'kit.ts'), 'utf8')), js: kitHash(fs.readFileSync(path.join(TOP, 'common', 'kit', 'kit.js'), 'utf8')) };
  const stale = Object.keys(cur).filter((k) => v[k].at(-1) !== cur[k]);
  if (process.argv.includes('--fix') && stale.length) { for (const k of stale) v[k] = [...v[k].filter((h) => h !== cur[k]), cur[k]]; fs.writeFileSync(vf, JSON.stringify(v, null, 2).replace(/\[\n\s+("[^\]]*?)\n\s+\]/g, (m, x) => `[${x.replace(/\n\s+/g, ' ')}]`) + '\n'); }
  ok(!stale.length || process.argv.includes('--fix'), `common/kit/versions.json ends with the current kit (${cur.ts} ${cur.js}; after editing kit.ts: node tests/kit-offline.mjs --fix)`);
}
// add: ja= and tex= on a scratch addon made from the plain template (offline: no server needed)
const name = 'kitoffline', dir = path.join(TOP, 'bds', 'addons', name);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'bp'), { recursive: true }); fs.mkdirSync(path.join(dir, 'rp', 'texts'), { recursive: true });
fs.writeFileSync(path.join(dir, 'bp', 'manifest.json'), JSON.stringify({ format_version: 2, header: { name: 'K', description: 'k', uuid: '11111111-1111-4111-8111-111111111111', version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'data', uuid: '11111111-1111-4111-8111-111111111112', version: [1, 0, 0] }] }));
fs.writeFileSync(path.join(dir, 'rp', 'manifest.json'), JSON.stringify({ format_version: 2, header: { name: 'K RP', description: 'k', uuid: '11111111-1111-4111-8111-111111111113', version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'resources', uuid: '11111111-1111-4111-8111-111111111114', version: [1, 0, 0] }] }));
fs.writeFileSync(path.join(dir, 'rp', 'texts', 'languages.json'), '["en_US","ja_JP"]');
const r = spawnSync(process.execPath, [path.join(TOP, 'bds', 'lab.mjs'), 'add', 'item', 'lab:ruby', 'Ruby', 'ja=ルビー', 'tex=gem:e0115f', 'max_stack_size=16', 'component={"food":{"nutrition":4}}', '-a', name], { cwd: path.join(TOP, 'bds'), encoding: 'utf8', env: { ...process.env, LAB_NETENV: 'off' } });
const itemJ = JSON.parse(fs.readFileSync(path.join(dir, 'bp', 'items', 'ruby.json'), 'utf8')), item = itemJ['minecraft:item'];
ok(r.status === 0 && /^OK item lab:ruby/m.test(r.stdout), `add prints one OK line (${r.stdout.trim().split('\n').at(-1)})`);
ok(item.components['minecraft:max_stack_size'] === 16 && item.components['minecraft:food']?.nutrition === 4 && itemJ.format_version >= '1.21.90', 'add: components (single and object form), format_version for custom components');
ok(fs.readFileSync(path.join(dir, 'rp', 'texts', 'en_US.lang'), 'utf8').includes('item.lab:ruby.name=Ruby') && fs.readFileSync(path.join(dir, 'rp', 'texts', 'ja_JP.lang'), 'utf8').includes('item.lab:ruby.name=ルビー'), 'add: the name in every language (ja=)');
ok(fs.statSync(path.join(dir, 'rp', 'textures', 'items', 'ruby.png')).size > 100, 'add: tex= draws the texture');
const r2 = spawnSync(process.execPath, [path.join(TOP, 'bds', 'lab.mjs'), 'add', 'entity', 'lab:slime', 'Slime', 'ja=スライム', 'health={"value":6,"max":6}', 'drops=lab:gel*1-2,bone', '-a', name], { cwd: path.join(TOP, 'bds'), encoding: 'utf8', env: { ...process.env, LAB_NETENV: 'off' } });
const ent = JSON.parse(fs.readFileSync(path.join(dir, 'bp', 'entities', 'slime.json'), 'utf8'))['minecraft:entity'].components;
const loot = JSON.parse(fs.readFileSync(path.join(dir, 'bp', 'loot_tables', 'entities', 'slime.json'), 'utf8'));
ok(r2.status === 0 && ent['minecraft:health'].max === 6 && ent['minecraft:loot'].table === 'loot_tables/entities/slime.json', 'add entity: components + drops= wires a loot table');
ok(loot.pools.length === 2 && loot.pools[0].entries[0].name === 'lab:gel' && loot.pools[0].entries[0].functions[0].count.max === 2 && loot.pools[1].entries[0].name === 'minecraft:bone', 'drops=: one pool per item, counts');
ok(fs.statSync(path.join(dir, 'rp', 'textures', 'entity', 'slime.png')).size > 100, 'add entity: a drawn box skin');
spawnSync(process.execPath, [path.join(TOP, 'bds', 'lab.mjs'), 'add', 'block', 'lab:lamp', 'Lamp', 'states={"lab:lit":[false,true]}', '-a', name], { cwd: path.join(TOP, 'bds'), encoding: 'utf8', env: { ...process.env, LAB_NETENV: 'off' } });
ok(JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, 'bp', 'blocks', 'lamp.json'), 'utf8'))['minecraft:block'].description.states) === '{"lab:lit":[false,true]}', 'add block: states=');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} kit-offline`);
process.exit(fails ? 1 : 0);
