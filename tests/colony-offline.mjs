#!/usr/bin/env node
// colony (common/colony.mjs + sandbox-be/src/colony/): people's distributed worlds and addons from Crafters Colony, offline.
// Worlds are written here byte by byte (little-endian NBT, sub-chunks, LevelDB tables and logs as Mojang's leveldb writes them:
// internal keys, raw-deflate blocks), plus one real table BDS 1.26.52.3 wrote (tests/fake/colony); the site is a stand-in on
// 127.0.0.1 (COLONY_ORIGIN) with the real site's page shapes. No network.   node tests/colony-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const Z = await imp('sandbox-be/src/colony/zip.js'), L = await imp('sandbox-be/src/colony/leveldb.js'), N = await imp('sandbox-be/src/colony/nbt.js');
const SC = await imp('sandbox-be/src/colony/subchunk.js'), W = await imp('sandbox-be/src/colony/world.js'), V = await imp('sandbox-be/src/colony/tovoxel.js');
const P = await imp('sandbox-be/src/colony/packs.js'), S = await imp('sandbox-be/src/colony/site.js'), C = await imp('common/colony.mjs');
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).split('\n').slice(-20).join('\n  ')}`); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-colony-'));

// ---------------------------------------------------------------- writers
const varint = (x) => { const o = []; while (x >= 0x80) { o.push((x & 0x7f) | 0x80); x = Math.floor(x / 128); } o.push(x); return Buffer.from(o); };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
// little-endian NBT: values are [tag, value]
const NB = { byte: (v) => [1, v], int: (v) => [3, v], long: (v) => [4, BigInt(v)], str: (v) => [8, v], list: (et, a) => [9, [et, a]], comp: (o) => [10, o] };
function nbtPayload([t, v]) {
  const s = (x) => { const b = Buffer.from(x, 'utf8'), l = Buffer.alloc(2); l.writeUInt16LE(b.length); return Buffer.concat([l, b]); };
  if (t === 1) return Buffer.from([v & 0xff]);
  if (t === 3) return i32(v);
  if (t === 4) { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; }
  if (t === 8) return s(v);
  if (t === 9) return Buffer.concat([Buffer.from([v[0]]), i32(v[1].length), ...v[1].map((x) => nbtPayload([v[0], x]))]);
  if (t === 10) return Buffer.concat([...Object.entries(v).flatMap(([k, x]) => [Buffer.from([x[0]]), s(k), nbtPayload(x)]), Buffer.from([0])]);
  throw new Error('tag ' + t);
}
const nbtRoot = (o) => Buffer.concat([Buffer.from([10, 0, 0]), nbtPayload(NB.comp(o))]);
const block = (name) => nbtRoot({ name: NB.str(name), states: NB.comp({}), version: NB.int(18168865) });
// a v9 sub-chunk: names[i] for i = x*256 + z*16 + y; uniform: one block, bits 0 (with or without the palette count)
function subchunk(yIndex, names, { uniform = null, count = true } = {}) {
  if (uniform) return Buffer.concat([Buffer.from([9, 1, yIndex & 0xff, 0]), count ? i32(1) : Buffer.alloc(0), block(uniform)]);
  const pal = [...new Set(names)], bits = [1, 2, 3, 4, 5, 6, 8, 16].find((b) => 2 ** b >= pal.length), per = Math.floor(32 / bits), words = Math.ceil(4096 / per);
  const w = Buffer.alloc(words * 4);
  for (let i = 0; i < 4096; i++) { const wi = Math.floor(i / per), sh = (i % per) * bits; w.writeUInt32LE((w.readUInt32LE(wi * 4) | (pal.indexOf(names[i]) << sh)) >>> 0, wi * 4); }
  return Buffer.concat([Buffer.from([9, 1, yIndex & 0xff, bits << 1]), w, i32(pal.length), ...pal.map(block)]);
}
const chunkKey = (x, z, tag, subY = null, dim = 0) => Buffer.concat([i32(x), i32(z), ...(dim ? [i32(dim)] : []), Buffer.from([tag]), ...(subY === null ? [] : [Buffer.from([subY & 0xff])])]);
// a LevelDB table as Mojang's leveldb writes it: internal keys (key + seq<<8|type), the data block compressed (4 = raw deflate)
function sstTable(entries, ctype = 4) {
  const ik = (e) => { const t = Buffer.alloc(8); t.writeBigUInt64LE((BigInt(e.seq) << 8n) | (e.del ? 0n : 1n)); return Buffer.concat([e.key, t]); };
  const blk = (kvs) => Buffer.concat([...kvs.flatMap(([k, v]) => [varint(0), varint(k.length), varint(v.length), k, v]), u32(0), u32(1)]);
  const comp = (raw) => (ctype === 4 ? zlib.deflateRawSync(raw) : ctype === 2 ? zlib.deflateSync(raw) : raw);
  const sorted = [...entries].sort((a, b) => Buffer.compare(a.key, b.key) || b.seq - a.seq);
  const data = comp(blk(sorted.map((e) => [ik(e), e.value ?? Buffer.alloc(0)])));
  const idxOff = data.length + 5, index = blk([[ik(sorted.at(-1)), Buffer.concat([varint(0), varint(data.length)])]]);
  const metaOff = idxOff + index.length + 5, meta = blk([]);
  const footer = Buffer.alloc(48); Buffer.concat([varint(metaOff), varint(meta.length), varint(idxOff), varint(index.length)]).copy(footer);
  Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]).copy(footer, 40);
  return Buffer.concat([data, Buffer.from([ctype]), u32(0), index, Buffer.from([0]), u32(0), meta, Buffer.from([0]), u32(0), footer]);
}
// a write-ahead log: one WriteBatch per call, cut into 32 KB blocks (FIRST/MIDDLE/LAST when it does not fit)
function logFile(batches) {
  const out = []; let pos = 0;
  const frag = (data) => {
    let off = 0, first = true;
    while (first || off < data.length) {
      const room = 32768 - (pos % 32768);
      if (room < 7) { out.push(Buffer.alloc(room)); pos += room; continue; }
      const take = Math.min(room - 7, data.length - off), last = off + take >= data.length;
      const type = first && last ? 1 : first ? 2 : last ? 4 : 3, h = Buffer.alloc(7);
      h.writeUInt16LE(take, 4); h[6] = type;
      out.push(h, data.subarray(off, off + take)); pos += 7 + take; off += take; first = false;
    }
  };
  for (const { seq, ops } of batches) {
    const s = Buffer.alloc(8); s.writeBigUInt64LE(BigInt(seq));
    frag(Buffer.concat([s, u32(ops.length), ...ops.flatMap((o) => (o.del ? [Buffer.from([0]), varint(o.key.length), o.key] : [Buffer.from([1]), varint(o.key.length), o.key, varint(o.value.length), o.value]))]));
  }
  return Buffer.concat(out);
}
function bedrockLevelDat({ name = 'Escape', spawn = [5, 32767, 5], version = [1, 26, 52, 3, 0] } = {}) {
  const body = nbtRoot({ LevelName: NB.str(name), SpawnX: NB.int(spawn[0]), SpawnY: NB.int(spawn[1]), SpawnZ: NB.int(spawn[2]), GameType: NB.int(2), Difficulty: NB.int(1), RandomSeed: NB.long(42), LastPlayed: NB.long(1790000000), commandsEnabled: NB.byte(1), lastOpenedWithVersion: NB.list(3, version), experiments: NB.comp({ gametest: NB.byte(1) }) });
  return Buffer.concat([i32(10), i32(body.length), body]);   // storage version 10 = 0x0a, the same first byte as Java's Compound
}
// a zip with raw name bytes and flags (an old Japanese Windows zip: Shift_JIS names, no UTF-8 flag)
function rawZip(files) {
  const loc = [], cen = []; let off = 0;
  for (const { name, data, flags = 0 } of files) {
    const crc = Z.crc32(data), h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(flags, 6); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    loc.push(h, name, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, name); off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, e]);
}

// ---------------------------------------------------------------- a world: chunk 0,0 is stone up to y -61 with grass at -60 and a
// gold block at 3,-59,3; chunk 1,0 is saved only in the log (newer), chunk 0,1 deleted by the log; level.dat says "spawn on the
// surface" (SpawnY 32767)
const names = (f) => Array.from({ length: 4096 }, (_, i) => f(i >> 8, i & 15, (i >> 4) & 15));
const sub4 = subchunk(-4, names((x, y) => (y === 4 ? 'minecraft:grass_block' : y < 4 ? 'minecraft:stone' : 'minecraft:air')));   // y -64..-49: grass at -60
const gold = subchunk(-4, names((x, y, z) => (y === 4 ? 'minecraft:grass_block' : y < 4 ? 'minecraft:stone' : x === 3 && z === 3 && y === 5 ? 'minecraft:gold_block' : 'minecraft:air')));
const table = sstTable([
  { key: chunkKey(0, 0, 0x2f, -4), seq: 10, value: sub4 },              // overwritten by the log (seq 20)
  { key: chunkKey(0, 0, 0x2f, -5), seq: 30, value: subchunk(-5, null, { uniform: 'minecraft:bedrock', count: false }) },   // newer than the log's
  { key: chunkKey(0, 1, 0x2f, -4), seq: 11, value: sub4 },              // deleted by the log
  { key: Buffer.from('Overworld'), seq: 1, value: nbtRoot({}) },        // 9 bytes: not a chunk key
]);
const log = logFile([
  { seq: 20, ops: [{ key: chunkKey(0, 0, 0x2f, -4), value: gold }, { key: chunkKey(0, 0, 0x2f, -5), value: subchunk(-5, null, { uniform: 'minecraft:stone' }) }, { key: chunkKey(0, 1, 0x2f, -4), del: true }] },
  { seq: 23, ops: [{ key: chunkKey(1, 0, 0x2f, -4), value: sub4 }, { key: Buffer.from('BigValue'), value: Buffer.alloc(70000, 7) }] },   // > 32 KB: FIRST/MIDDLE/LAST
]);
const bp = { name: 'behavior_packs/escape_bp/manifest.json', data: Buffer.from(JSON.stringify({ format_version: 2, header: { name: 'Escape BP', uuid: 'aaaaaaaa-0000-4000-8000-000000000001', version: [1, 2, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'script', language: 'javascript', uuid: 'aaaaaaaa-0000-4000-8000-000000000002', entry: 'scripts/main.js', version: [1, 2, 0] }], dependencies: [{ module_name: '@minecraft/server', version: '1.11.0' }, { uuid: 'bbbbbbbb-0000-4000-8000-000000000001', version: [1, 0, 0] }] })) };
const bpJs = { name: 'behavior_packs/escape_bp/scripts/main.js', data: Buffer.from("import { world, system } from '@minecraft/server';\nworld.afterEvents.playerSpawn.subscribe((e) => { if (e.initialSpawn) e.player.sendMessage('ようこそ'); });\nsystem.runInterval(() => {}, 20);\n") };
const rp = { name: 'resource_packs/escape_rp/manifest.json', data: Buffer.from(JSON.stringify({ format_version: 2, header: { name: 'Escape RP', uuid: 'bbbbbbbb-0000-4000-8000-000000000001', version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'resources', uuid: 'bbbbbbbb-0000-4000-8000-000000000002', version: [1, 0, 0] }] })) };
const worldFiles = (root = '') => [
  { name: root + 'level.dat', data: bedrockLevelDat() }, { name: root + 'levelname.txt', data: Buffer.from('Escape') },
  { name: root + 'db/000005.ldb', data: table }, { name: root + 'db/000006.log', data: log }, { name: root + 'db/CURRENT', data: Buffer.from('MANIFEST-000004\n') },
  ...[bp, bpJs, rp].map((f) => ({ ...f, name: root + f.name })),
];
const mcworld = path.join(T, 'escape.mcworld');
fs.writeFileSync(mcworld, Z.writeZip(worldFiles(), { mtime: new Date(2026, 9, 1) }));

// ---------------------------------------------------------------- readers
{
  const f = await N.parseLevelDat(bedrockLevelDat());
  ok(f.edition === 'bedrock' && f.storageVersion === 10 && N.summarize(f).name === 'Escape' && N.summarize(f).spawn.join() === '5,32767,5' && N.summarize(f).version === '1.26.52.3.0',
    'level.dat: a Bedrock one (storage version 10, its first byte 0x0a like a Java Compound) is read as Bedrock with its name, version and spawn', JSON.stringify(N.summarize(f)));
  const java = zlib.gzipSync(Buffer.concat([Buffer.from([10, 0, 0]), Buffer.from([10, 0, 4]), Buffer.from('Data'), Buffer.from([8, 0, 9]), Buffer.from('LevelName'), Buffer.from([0, 4]), Buffer.from('Java'), Buffer.from([0, 0])]));
  ok(N.summarize(N.parseLevelDat(java)).edition === 'java' && N.summarize(N.parseLevelDat(java)).name === 'Java', 'level.dat: a Java one (gzip, big-endian) stays Java');
}
{
  const real = L.readTable(fs.readFileSync(path.join(TOP, 'tests', 'fake', 'colony', 'bds-1.26.52.3.ldb')));
  ok(real.length === 8 && real.map((e) => e.key.toString()).includes('Overworld') && real.every((e) => !e.del && e.seq > 0n),
    'a table BDS 1.26.52.3 wrote (compression 4 = raw deflate, internal keys): 8 keys, the 8-byte sequence trailers taken off', real.map((e) => `${e.key} ${e.seq}`).join(' | '));
}
{
  const dir = path.join(T, 'db'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '000005.ldb'), table); fs.writeFileSync(path.join(dir, '000006.log'), log);
  const db = await L.openDb(dir), get = (k) => db.map.get(k.toString('hex'));
  ok(db.problems.length === 0 && get(chunkKey(0, 0, 0x2f, -4))?.equals(gold) && SC.decodeSubchunk(get(chunkKey(0, 0, 0x2f, -5))).uniform === 'minecraft:bedrock' && !get(chunkKey(0, 1, 0x2f, -4)) && get(chunkKey(1, 0, 0x2f, -4))?.equals(sub4),
    'LevelDB: the higher sequence wins whichever file it is in (log over table, table over log), a deletion removes the key', JSON.stringify(db.problems));
  ok(get(Buffer.from('BigValue'))?.length === 70000, 'LevelDB log: a record cut over 32 KB blocks (FIRST/MIDDLE/LAST) comes back whole');
  ok(L.parseChunkKey(Buffer.from('Overworld').toString('hex')) === null && L.parseChunkKey(chunkKey(-3, 7, 0x2f, -2, 1).toString('hex'))?.dim === 1 && L.parseChunkKey(chunkKey(-3, 7, 0x2f, -2, 1).toString('hex'))?.subY === -2,
    'chunk keys: "Overworld" (also 9 bytes) is not one; a Nether sub-chunk key reads dimension 1 and a negative index');
  const kept = await L.openDb(dir, { keep: (k) => k.length === 10 });
  ok(kept.map.size === 3 && kept.entries === db.entries && [...kept.map.keys()].every((k) => k.length === 20), 'openDb keep: only the keys asked for are held (a big world: the chunks around spawn)', kept.map.size);
  ok(L.snappyDecompress(Buffer.from([12, 12, 0x61, 0x62, 0x63, 0x64, 0x1e, 4, 0])).toString() === 'abcdabcdabcd' && L.decompress(zlib.deflateSync(Buffer.from('z')), 2).toString() === 'z' && L.decompress(zlib.deflateRawSync(Buffer.from('r')), 2).toString() === 'r',
    'blocks: snappy (a literal and an overlapping copy), zlib with and without its header whatever the type byte says');
}
{
  const s = SC.decodeSubchunk(gold);
  ok(s.yIndex === -4 && s.blocks[SC.indexOf(3, 5, 3)] === 'minecraft:gold_block' && s.blocks[SC.indexOf(0, 4, 9)] === 'minecraft:grass_block' && s.blocks[SC.indexOf(0, 6, 0)] === 'minecraft:air',
    'sub-chunk v9: palette and packed indices give each block (x*256 + z*16 + y)');
  ok(SC.decodeSubchunk(subchunk(2, null, { uniform: 'minecraft:stone', count: true })).uniform === 'minecraft:stone' && SC.decodeSubchunk(subchunk(2, null, { uniform: 'minecraft:dirt', count: false })).uniform === 'minecraft:dirt',
    'sub-chunk with 0 bits per block (one block): read with or without the palette count');
  let threw = ''; try { SC.decodeSubchunk(Buffer.from([9, 1, 0, 7 << 1])); } catch (e) { threw = e.message; }
  ok(/ビット数が 7/.test(threw), 'a sub-chunk with an impossible bit width says so instead of reading garbage', threw);
}

// ---------------------------------------------------------------- files: inspect, repack, install, packs, voxel
{
  const i = await W.inspect(mcworld);
  ok(i.kind === 'bedrock-world' && !i.nested && i.level.name === 'Escape' && i.levelName === 'Escape' && i.packs.join() === 'behavior_packs/escape_bp,resource_packs/escape_rp', 'inspect: a Bedrock world, level.dat, its packs', JSON.stringify(i));
  // an old Japanese Windows zip: the world one folder down, the folder name in Shift_JIS, no UTF-8 flag
  const sjis = Buffer.from([0x92, 0x45, 0x8f, 0x6f]);   // 「脱出」
  const nested = path.join(T, 'nested.zip');
  fs.writeFileSync(nested, rawZip(worldFiles().map((f) => ({ name: Buffer.concat([sjis, Buffer.from('/' + f.name)]), data: f.data }))));
  const j = await W.inspect(nested);
  ok(j.kind === 'bedrock-world' && j.nested && j.root === '脱出/', 'inspect: Shift_JIS names of an old Japanese zip read as Japanese; the world is one folder down', JSON.stringify(j.root));
  const fixed = path.join(T, 'fixed.mcworld'), r = await W.repack(nested, fixed);
  ok(r.stripped === '脱出/' && (await W.inspect(fixed)).root === '' && Z.listEntries(fs.readFileSync(fixed)).every((e) => !e.name.startsWith('脱出')), 'repack: the folder taken off, a proper .mcworld');
  const evil = path.join(T, 'evil.mcworld'), outside = path.join(T, 'outside.txt');
  fs.writeFileSync(evil, Z.writeZip([{ name: 'level.dat', data: bedrockLevelDat() }, { name: 'db/CURRENT', data: Buffer.from('x') }, { name: '../outside.txt', data: Buffer.from('pwned') }]));
  let err = ''; try { await W.install(evil, { dir: path.join(T, 'worlds') }); } catch (e) { err = e.message; }
  ok(/外を指す名前/.test(err) && !fs.existsSync(outside) && !fs.existsSync(path.join(T, 'worlds')) || (/外を指す名前/.test(err) && !fs.existsSync(outside) && fs.readdirSync(path.join(T, 'worlds')).length === 0),
    'install: a zip with a name that climbs out (../) writes nothing at all (zip slip)', err);
  const damaged = path.join(T, 'damaged.mcworld'); const b = fs.readFileSync(mcworld); b[40] ^= 0xff; fs.writeFileSync(damaged, b);
  let derr = ''; try { await W.verify(damaged); } catch (e) { derr = e.message; }
  ok(/CRC|不正|invalid|incorrect|unexpected/i.test(derr), 'verify: a byte changed inside is caught (CRC), not only a cut-off download', derr);
  const cand = W.worldsDirCandidates({ platform: 'win32', env: { APPDATA: 'C:\\R', LOCALAPPDATA: 'C:\\L' }, home: 'C:\\H', list: () => ['1234567', 'Shared'] });
  ok(/Minecraft Bedrock.Users.1234567.games.com\.mojang.minecraftWorlds$/.test(cand[0]) && /Users.Shared/.test(cand[1]) && /MinecraftUWP_8wekyb3d8bbwe/.test(cand[2]), 'Windows: the GDK folder (1.21.120+, per account) first, then Shared, then the old UWP one', cand.join(' | '));
  const course = await V.buildCourse(mcworld, { radius: 15, height: 16, profile: { blocks: { 'minecraft:stone': {}, 'minecraft:grass_block': {} } } });
  ok(course.world.origin.y === -59 && course.import.spawn?.levelDat === 32767 && course.import.blocks > 0 && course.import.db.problems.length === 0,
    'voxel: SpawnY 32767 ("on the surface") becomes the ground under spawn (grass at -60 → stand at -59)', JSON.stringify({ origin: course.world.origin, spawn: course.import.spawn, problems: course.import.db.problems }));
  ok(course.import.goalCandidates[0]?.type === 'minecraft:gold_block' && course.import.goalCandidates[0].rel.y === 0 && course.import.unknownBlocks.some(([nm]) => nm === 'minecraft:bedrock'),
    'voxel: the gold block is a goal candidate (relative to spawn); blocks the physics never measured are counted', JSON.stringify(course.import.goalCandidates.slice(0, 2)));
  const out = path.join(T, 'packs'), packs = await P.extractPacks(mcworld, out);
  ok(packs.length === 2 && packs[0].entry === 'scripts/main.js' && fs.existsSync(path.join(out, 'bp', 'escape_bp', 'scripts', 'main.js')), 'packs: the world\'s behavior and resource packs taken out');
  const { runSandbox } = await imp('sandbox-be/src/index.js');
  const sim = await P.runPack(packs.find((p) => p.kind === 'behavior'), { runSandbox, ticks: 40 });
  ok(sim.verdict === 'pass' && /^@minecraft\/server 1\.11\.0 → 2\.\d+\.0$/.test(sim.remapped ?? '') && sim.usage['System.runInterval'] === 1,
    'packs --sim: a pack asking @minecraft/server 1.11.0 (not in the sandbox) runs as the newest stable it has, and says so', JSON.stringify(sim));
}

// ---------------------------------------------------------------- the site's pages (the shapes of the real one)
const POST = (id, buttons, extra = '') => `<!DOCTYPE html><html><head>
<meta property="og:title" content="脱出ワールド &amp; 謎解き #${id}"><meta property="article:published_time" content="2026-09-30T12:00:00+09:00"><meta property="article:modified_time" content="2026-10-01T08:00:00+09:00">
<meta property="og:image" content="https://minecraft-mcworld.com/wp-content/uploads/2026/09/t.png"><meta name="description" content="鍵を集めて脱出しよう"></head>
<body class="single postid-${id} categoryid-3"><a href="https://minecraft-mcworld.com/author/0123456789abcdef0123/" title="テスト職人 の投稿"><img src="a.png">テスト職人</a>
<span class="cat-label cat-label-3">脱出・謎解き</span><a href="https://minecraft-mcworld.com/tag/%E8%AC%8E%E8%A7%A3%E3%81%8D/">謎解き</a>
<div class="count">1,234(週:56 月:789)</div><table><tr><th>想定クリア時間</th><td>30分</td></tr><tr><th>想定人数</th><td>1〜4人</td></tr></table>
${buttons}${extra}<div class="comment-area"><a href="https://minecraft-mcworld.com/author/ffffffffffffffffffff/">他人</a></div></body></html>`;
const BTN = (id, type, label) => `<div class="download-bt" onclick="download_bt_func(${id},${type})">${label}</div>`;
{
  const p = S.parsePost(POST(12345, BTN(12345, 3, 'ダウンロード (mcworld) [DL:42]') + BTN(12345, 1, 'ダウンロード (mcpack/mcaddon) [DL:7] 移動先 https://www.dropbox.com/s/abc/pack.mcaddon?dl=0')), '12345');
  ok(p.title === '脱出ワールド & 謎解き #12345' && p.author?.name === 'テスト職人' && p.catNames.includes('BE 脱出・謎解き') && p.views === 1234 && p.info['想定クリア時間'] === '30分' && p.tags[0] === '謎解き',
    'a post page: title, author (not the commenter), category, views, the info table, tags', JSON.stringify(p));
  ok(p.buttons.length === 2 && p.buttons[0].kind === 'mcworld' && p.buttons[0].count === 42 && p.buttons[1].kind === 'mcaddon' && p.buttons[1].hosted && /dropbox/.test(p.buttons[1].dest),
    'download buttons: "(mcpack/mcaddon)" is an addon even with type 1; a Dropbox destination is a known file host', JSON.stringify(p.buttons));
  ok(S.directUrl('https://www.dropbox.com/s/abc/pack.mcaddon?dl=0') === 'https://dl.dropboxusercontent.com/s/abc/pack.mcaddon?dl=1' && S.directUrl('https://drive.google.com/file/d/XYZ/view') === 'https://drive.google.com/uc?export=download&id=XYZ',
    'file hosts: Dropbox and Google Drive links straight to the file');
  ok(C.realLink('<a id="downloadButton" href="https://download1234.mediafire.com/abc/x.mcworld">Download</a>', 'https://www.mediafire.com/file/x') === 'https://download1234.mediafire.com/abc/x.mcworld'
    && /^https:\/\/drive\.usercontent\.google\.com\/download\?id=XYZ&export=download&confirm=t&uuid=u1$/.test(C.realLink('<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="XYZ"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u1"></form>', 'https://drive.google.com/uc?id=XYZ')),
    'a file host\'s page instead of the file: MediaFire\'s button and Google Drive\'s "can\'t scan" form give the real link');
  ok(C.postId('https://minecraft-mcworld.com/263966/') === '263966' && C.postId('263966') === '263966' && C.postId('12') === null, 'a post is its number or its URL');
}

// ---------------------------------------------------------------- the command against a stand-in site
const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Knockdown Revive</title><link>https://minecraft-mcworld.com/12348/</link><pubDate>Mon, 05 Oct 2026 10:04:56 +0000</pubDate><category><![CDATA[ビヘイビア＆リソース]]></category></item>
<item><title><![CDATA[脱出ワールド &amp; 謎解き]]></title><link>https://minecraft-mcworld.com/12345/</link><pubDate>Mon, 05 Oct 2026 08:29:32 +0000</pubDate><category><![CDATA[脱出・謎解き]]></category></item>
</channel></rss>`;
const addonZip = Z.writeZip([{ name: 'Revive BP/manifest.json', data: Buffer.from(JSON.stringify({ format_version: 2, header: { name: 'Revive', uuid: 'cccccccc-0000-4000-8000-000000000001', version: [2, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'script', language: 'javascript', uuid: 'cccccccc-0000-4000-8000-000000000002', entry: 'scripts/main.js', version: [2, 0, 0] }], dependencies: [{ module_name: '@minecraft/server', version: '2.0.0' }] })) }, { name: 'Revive BP/scripts/main.js', data: Buffer.from("import { world } from '@minecraft/server';\nworld.afterEvents.entityDie.subscribe((e) => { if (e.deadEntity.typeId === 'minecraft:player') e.deadEntity.sendMessage('down'); });\n") }]);
const hits = [];
let restDown = false;
const srv = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x'); hits.push(u.pathname + u.search);
  const send = (code, body, h = {}) => { s.writeHead(code, h); s.end(body); };
  if (u.pathname === '/feed/') return send(200, RSS, { 'content-type': 'application/rss+xml' });
  if (u.pathname === '/' && (u.searchParams.has('s') || u.searchParams.has('cat'))) {   // the site's own list page (12 a page)
    const sortBy = u.searchParams.get('sort');
    return send(200, `<html><body><div class="list"><a href="https://minecraft-mcworld.com/12348/"><img src="t.png"></a><a href="https://minecraft-mcworld.com/12348/">Knockdown Revive</a>
<a href="/12345/">脱出ワールド &amp; 謎解き</a>${sortBy === 'dl' ? '' : '<a href="/99999/">x</a>'}</div></body></html>`, { 'content-type': 'text/html' });
  }
  if (u.pathname === '/wp-json/wp/v2/posts' && restDown) return send(500, 'down');
  if (u.pathname === '/wp-json/wp/v2/posts') {
    const all = [{ id: 12345, date: '2026-10-05T08:29:32', title: { rendered: '脱出ワールド &#038; 謎解き' }, categories: [3] }, { id: 12348, date: '2026-10-05T10:04:56', title: { rendered: 'Knockdown Revive' }, categories: [23] }];
    const want = u.searchParams.get('search') ?? '', got = all.filter((p) => p.title.rendered.includes(want));
    return send(200, JSON.stringify(got), { 'content-type': 'application/json', 'x-wp-total': String(got.length) });
  }
  if (u.pathname === '/12345/') return send(200, POST(12345, BTN(12345, 3, 'ダウンロード (mcworld) [DL:42]')), { 'content-type': 'text/html; charset=UTF-8' });
  if (u.pathname === '/12347/') return send(200, POST(12347, BTN(12347, 3, 'ダウンロード (mcworld) [DL:1]')), { 'content-type': 'text/html' });
  if (u.pathname === '/12348/') return send(200, POST(12348, BTN(12348, 1, 'ダウンロード (mcpack/mcaddon) [DL:5]')), { 'content-type': 'text/html' });
  if (u.pathname === '/12349/') return send(200, POST(12349, BTN(12349, 2, 'ダウンロード (zip) [DL:3]')), { 'content-type': 'text/html' });
  if (u.pathname === '/dl/') {
    const id = u.searchParams.get('postid');
    if (id === '12345') return send(302, '', { location: '/files/escape' });
    if (id === '12347') { const b = fs.readFileSync(mcworld); return send(200, b.subarray(0, b.length - 200), { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="cut.mcworld"' }); }
    if (id === '12348') return send(200, addonZip, { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''%E5%BE%A9%E6%B4%BB.mcaddon" });
    if (id === '12349') return send(200, '<html><body>Please wait 30 seconds…</body></html>', { 'content-type': 'text/html' });
  }
  if (u.pathname === '/files/escape') return send(200, fs.readFileSync(mcworld), { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''%E8%84%B1%E5%87%BA.mcworld" });
  send(404, 'not here');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const CDIR = path.join(T, 'colony');
const env = { ...process.env, COLONY_ORIGIN: `http://127.0.0.1:${srv.address().port}`, LAB_COLONY_DIR: CDIR, LAB_COLONY_DELAY_MS: '0', LAB_DOTENV: 'off', LAB_NETENV: 'off', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', NO_COLOR: '1' };
const lab = (args, cwd = T) => new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'colony', ...args], { cwd, env }); let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; }); c.on('close', (code) => res({ code, t })); });
try {
  let r = await lab(['new']);
  ok(r.code === 0 && /^12348 +2026-10-05 ビヘイビア＆リソース +Knockdown Revive$/m.test(r.t) && /脱出ワールド & 謎解き/.test(r.t) && /next: node lab\.mjs colony show 12348/.test(r.t), 'colony new: the newest posts from the feed (one request), the next step', r.t);
  r = await lab(['search', '謎解き']);
  ok(r.code === 0 && /^12345 .*BE 脱出・謎解き +脱出ワールド & 謎解き$/m.test(r.t) && !/Knockdown/.test(r.t) && /1 post\(s\)/.test(r.t) && hits.some((h) => /_fields=id%2Clink%2Cdate%2Ctitle%2Ccategories/.test(h)), 'colony search: the site\'s index, titles without bodies (a small answer)', r.t);
  r = await lab(['search', '謎解き', '--sort', 'dl']);
  ok(r.code === 0 && /^12348 +Knockdown Revive$/m.test(r.t) && /^12345 +脱出ワールド & 謎解き$/m.test(r.t) && hits.some((h) => /^\/\?s=.*sort=dl/.test(h)), 'colony search --sort dl: the site\'s own list page (its sorts), the titles its links carry', r.t);
  restDown = true;
  r = await lab(['search', 'Revive', '--fresh']);
  restDown = false;
  ok(r.code === 0 && /^W the site's index did not answer \(REST HTTP 500\): its list page instead$/m.test(r.t) && /^12348 +Knockdown Revive$/m.test(r.t), 'colony search: the REST index down → the list page instead, said', r.t);
  r = await lab(['show', 'https://minecraft-mcworld.com/12345/']);
  ok(r.code === 0 && /^by テスト職人 · BE 脱出・謎解き · 2026-09-30 \(updated 2026-10-01\) · 1234 views$/m.test(r.t) && /想定クリア時間: 30分/.test(r.t) && /\[1\] mcworld · 42 downloads/.test(r.t) && /next: node lab\.mjs colony get 12345$/m.test(r.t), 'colony show <URL>: the post, its info and buttons', r.t);
  const before = hits.filter((h) => h === '/12345/').length;
  r = await lab(['get', '12345']);
  const file = path.join(CDIR, '12345', '脱出.mcworld');
  ok(r.code === 0 && fs.existsSync(file) && /CRC ok/.test(r.t) && /Bedrock world "Escape" · saved with 1\.26\.52\.3\.0/.test(r.t) && /next: node lab\.mjs colony install 12345 · its behavior pack as a unit: node lab\.mjs colony import 12345/.test(r.t),
    'colony get: through the site\'s /dl/ (a redirect), the Japanese file name kept, checked, inspected, the next step', r.t);
  ok(hits.filter((h) => h === '/12345/').length === before, 'the post page asked once an hour (get reused what show read)', hits.join(' '));
  const th = JSON.parse(fs.readFileSync(path.join(CDIR, 'throttle.json'), 'utf8'));
  ok(Array.isArray(th.stamps) && th.stamps.length >= 4 && th.last > 0, 'the polite throttle remembers this hour\'s requests across runs (.lab/colony/throttle.json)', JSON.stringify(th));
  r = await lab(['inspect', '12345']);
  ok(r.code === 0 && /脱出\.mcworld: bedrock-world · \d+ KB · 8 entries · CRC ok/.test(r.t), 'colony inspect <post>: the file got for it', r.t);
  r = await lab(['packs', '12345', '--sim', '--ticks', '40']);
  ok(r.code === 0 && /^bp "Escape BP" 1\.2\.0 · @minecraft\/server@1\.11\.0/m.test(r.t) && /sim: pass \(ran as @minecraft\/server 1\.11\.0 → 2\.\d+\.0/.test(r.t) && /^rp "Escape RP"/m.test(r.t), 'colony packs --sim: each pack, the behavior pack run in the sandbox', r.t);
  r = await lab(['voxel', '12345', '--radius', '12', '--height', '16']);
  const cf = path.join(CDIR, 'courses', '脱出.json');
  const cj = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')) : {};
  ok(r.code === 0 && /around spawn 5,-59,5/.test(r.t) && /SpawnY 32767\): the ground is y -59/.test(r.t) && /gold_block at -2,0,-2/.test(r.t) && cj.world?.blocks?.length > 0, 'colony voxel: the course around the real ground, the goal candidate named', r.t);
  ok(cj.name === '脱出ワールド & 謎解き #12345' && cj.source?.post === '12345' && cj.goal?.deadline === 30 * 60 * 20 && cj.meta?.players === '1〜4人', 'colony voxel <post>: the post\'s facts go with the course (its title, players, "30分" as the deadline in ticks)', JSON.stringify({ name: cj.name, source: cj.source, goal: cj.goal, meta: cj.meta }));
  r = await lab(['install', '12345', '--dir', path.join(T, 'mcw')]);
  ok(r.code === 0 && fs.readdirSync(path.join(T, 'mcw')).some((d) => d.startsWith('Escape_') && fs.existsSync(path.join(T, 'mcw', d, 'db', '000005.ldb'))), 'colony install: into the worlds folder given, under the world\'s own name', r.t);
  r = await lab(['get', '12347']);
  ok(r.code === 1 && /W the zip is damaged/.test(r.t), 'colony get: a download cut short is said damaged (exit 1), not taken as a world', r.t);
  r = await lab(['get', '12349']);
  ok(r.code === 1 && /a web page, not a file/.test(r.t) && !fs.existsSync(path.join(CDIR, '12349')), 'colony get: a wait/confirm page instead of the file is said, nothing kept', r.t);
  r = await lab(['get', '12345', '--type', 'zip']);
  ok(r.code === 1 && /has no zip button \(it has: mcworld\)/.test(r.t), 'colony get --type: a kind the post does not have is said with what it has', r.t);
  r = await lab(['get', '12348']);
  ok(r.code === 0 && fs.existsSync(path.join(CDIR, '12348', '復活.mcaddon')) && /addon "Revive" 2\.0\.0 · modules script/.test(r.t) && /next: node lab\.mjs colony import 12348/.test(r.t), 'colony get: an addon (mcpack/mcaddon button)', r.t);
  // import: the addon from the post, and the behavior pack out of the world, as units of the bds lab (then removed)
  const units = path.join(TOP, 'bds', 'addons'), curFile = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(curFile) ? fs.readFileSync(curFile, 'utf8') : null;
  const u1 = `zz_colony_addon_${process.pid}`, u2 = `zz_colony_world_${process.pid}`;
  try {
    r = await lab(['import', '12348', 'make the revive faster', '--name', u1]);
    const task = fs.existsSync(path.join(units, u1, 'TASK.md')) ? fs.readFileSync(path.join(units, u1, 'TASK.md'), 'utf8') : '';
    ok(r.code === 0 && fs.existsSync(path.join(units, u1, 'bp', 'scripts', 'main.js')) && /make the revive faster/.test(task), 'colony import <post>: the downloaded addon becomes a unit with the request', r.t);
    r = await lab(['import', '12345', '--name', u2]);
    const task2 = fs.existsSync(path.join(units, u2, 'TASK.md')) ? fs.readFileSync(path.join(units, u2, 'TASK.md'), 'utf8') : '';
    ok(r.code === 0 && fs.existsSync(path.join(units, u2, 'bp', 'manifest.json')) && fs.existsSync(path.join(units, u2, 'rp', 'manifest.json')) && /Crafters Colony .*12345.*脱出ワールド/.test(task2),
      'colony import <post of a world>: its behavior pack and the resource pack it depends on, the post named in TASK.md', r.t + task2);
  } finally {
    for (const u of [u1, u2]) fs.rmSync(path.join(units, u), { recursive: true, force: true });
    if (cur0 === null) fs.rmSync(curFile, { force: true }); else fs.writeFileSync(curFile, cur0);
  }
  r = await lab(['show', '12']);
  ok(r.code === 1 && /usage: node lab\.mjs colony show <post>/.test(r.t), 'colony show with no post number: its usage, exit 1', r.t);
} finally {
  srv.close();
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`${fails ? 'FAIL' : 'PASS'} colony-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
