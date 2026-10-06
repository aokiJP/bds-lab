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
import crypto from 'node:crypto';
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
}

// ---------------------------------------------------------------- borrowing other people's addons (common/borrow.mjs, colony harvest)
const B = await imp('common/borrow.mjs');
{
  const a = B.rng('s1'), b = B.rng('s1'), c = B.rng('s2'), xs = [a(), a(), a()];
  ok(JSON.stringify(xs) === JSON.stringify([b(), b(), b()]) && JSON.stringify(xs) !== JSON.stringify([c(), c(), c()]) && xs.every((x) => x >= 0 && x < 1), 'a seeded order: the same seed gives the same numbers, another seed others');
  const sh = B.shuffle([1, 2, 3, 4, 5, 6], B.rng('k'));
  ok(JSON.stringify([...sh].sort()) === '[1,2,3,4,5,6]' && JSON.stringify(sh) === JSON.stringify(B.shuffle([1, 2, 3, 4, 5, 6], B.rng('k'))), 'shuffle: a permutation, the same for the same seed', JSON.stringify(sh));
  ok(JSON.stringify(B.statedVersion({ 対応バージョン: '統合版 1.21.50 以降' })) === '[1,21,50]' && JSON.stringify(B.statedVersion({ バージョン: '1.20' })) === '[1,20,0]' && B.statedVersion({ 難易度: '普通' }) === null, 'the version a post states (its info table)');
  const btn = (kind, dest, hosted = true) => ({ kind, dest, hosted });
  ok(B.prefilter({ isJava: true, buttons: [btn('zip')] }) === 'Java Edition の記事' && /ボタンが無い（本文/.test(B.prefilter({ buttons: [] })) && /欲しい種類/.test(B.prefilter({ buttons: [btn('mcworld')] }))
    && /知らないサイト/.test(B.prefilter({ buttons: [btn('mcaddon', 'https://x.example/f', false)] })) && /古い版向け（1\.16\.0/.test(B.prefilter({ buttons: [btn('mcaddon')], info: { 対応バージョン: '1.16' } })) && B.prefilter({ buttons: [btn('mcaddon')], info: {} }) === null,
    'prefilter: Java, no button, the wrong kind, an unknown host, an old version; a fine post passes');
  const rules = B.rulesOf('<div class="entry"><p>楽しいアドオンです。</p><p>二次配布は禁止です。</p><p>改変はOK、クレジットを書いてください</p></div><div class="comment-area"><p>二次配布していいですか</p></div>');
  ok(JSON.stringify(rules) === JSON.stringify(['二次配布は禁止です。', '改変はOK、クレジットを書いてください']), 'the rules a post states (二次配布・改変・クレジット), not the comments under it', JSON.stringify(rules));
  const recs = [{ post: '1', sha256: 'aa', packs: [{ uuid: 'U1', version: '1.0.0' }], result: 'kept', stage: 'real', bds: '1.26.52.3' }, { post: '2', result: 'dropped', stage: 'scan', bds: '1.26.52.3' }, { post: '3', result: 'dropped', stage: 'real', bds: '1.26.52.3' }, { post: '4', result: 'dropped', stage: 'brief', bds: '1.26.60.1' }];
  const idx = B.seenIndex(recs);
  ok(B.seenAs(idx, { post: '1' })?.by === 'post' && B.seenAs(idx, { post: '9', sha256: 'aa' })?.by === 'sha256' && B.seenAs(idx, { post: '9', packs: [{ uuid: 'u1', version: '1.0.0' }] })?.by === 'pack' && B.seenAs(idx, { post: '9', packs: [{ uuid: 'u1', version: '1.0.1' }] }) === null,
    'seen: by the post, by the same file posted again (sha256), by the same pack (UUID and version)');
  ok(JSON.stringify(B.retryable(recs, '1.26.60.1').map((r) => r.post)) === '["3"]', '--retry: only what a newer BDS may change (not a risk), not already tried on this BDS', JSON.stringify(B.retryable(recs, '1.26.60.1')));
  // --retry: the post's own records do not count, the same content as another post does (even when the retried post's record
  // about it is the last one)
  const idx2 = B.seenIndex([...recs, { post: '5', sha256: 'aa', result: 'dropped', stage: 'real', bds: '1.21.0.0' }]);
  ok(B.seenAs(idx2, { sha256: 'aa' }, { except: '5' })?.rec.post === '1' && B.seenAs(B.seenIndex([recs[0]]), { sha256: 'aa' }, { except: '1' }) === null && B.seenAs(idx2, { packs: [{ uuid: 'U1', version: '1.0.0' }] }, { except: '1' }) === null,
    '--retry: its own post set aside, the same file or pack under another post is still a copy');
  // a borrowed unit known without its mark (still being judged, the mark lost): by its name or the original kept in it
  const bx = path.join(T, 'bx');
  for (const d of ['borrowed_7', 'mine', 'kept']) fs.mkdirSync(path.join(bx, 'bds', 'addons', d), { recursive: true });
  fs.mkdirSync(path.join(bx, 'bds', 'addons', 'kept', '.borrowed'));
  ok(B.borrowedAs(path.join(bx, 'bds', 'addons', 'borrowed_7'))?.pending && B.borrowedAs(path.join(bx, 'bds', 'addons', 'kept'))?.pending && B.borrowedAs(path.join(bx, 'bds', 'addons', 'mine')) === null
    && JSON.stringify(B.borrowedUnits(bx).map((u) => u.rel)) === '["bds/addons/borrowed_7","bds/addons/kept"]', 'a borrowed unit without its mark: by its name (borrowed_…) or its kept original (.borrowed/)');
  ok(B.borrowedPath('bds/addons/borrowed_5/bp/x.js') && B.borrowedPath('ll/mods/mine/.borrowed/o.zip') && !B.borrowedPath('bds/addons/mine/bp/x.js') && !B.borrowedPath('docs/borrowed_5.md'), 'borrowedPath: the same, for a list of files');
  // share: a borrowed unit never ships, even named a sample by mistake
  const lab0 = path.join(T, 'sharelab');
  fs.mkdirSync(path.join(lab0, 'common', 'data'), { recursive: true }); fs.mkdirSync(path.join(lab0, 'bds', 'addons', 'borrowed_1'), { recursive: true });
  fs.writeFileSync(path.join(lab0, 'common', 'data', 'samples.json'), JSON.stringify({ bds: ['borrowed_1'] }));
  fs.writeFileSync(path.join(lab0, 'bds', 'addons', 'borrowed_1', 'imported.json'), JSON.stringify({ borrowed: { url: 'https://x/1/' } }));
  const SH = await imp('common/share.mjs');
  let threw = ''; try { SH.collect(lab0); } catch (e) { threw = e.message; }
  ok(/借りたアドオンは配りません: bds\/addons\/borrowed_1/.test(threw), 'share: a borrowed unit stops the release (collect)', threw);
  // one with no mark yet (being judged), named a sample: stopped by its name
  fs.rmSync(path.join(lab0, 'bds', 'addons', 'borrowed_1', 'imported.json')); fs.mkdirSync(path.join(lab0, 'bds', 'addons', 'borrowed_1', 'bp'), { recursive: true }); fs.writeFileSync(path.join(lab0, 'bds', 'addons', 'borrowed_1', 'bp', 'manifest.json'), '{}');
  threw = ''; try { SH.collect(lab0); } catch (e) { threw = e.message; }
  ok(/借りたアドオンは配りません: bds\/addons\/borrowed_1/.test(threw), 'share: a borrowed unit with no mark yet is stopped too (its name)', threw);
}
// the site's addon index, posts and files for harvest: each kind of post harvest must tell apart
const manifest = (name, uuid, deps, script = true) => Buffer.from(JSON.stringify({ format_version: 2, header: { name, uuid: `${uuid}-0000-4000-8000-000000000001`, version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: script ? 'script' : 'data', ...(script ? { language: 'javascript', entry: 'scripts/main.js' } : {}), uuid: `${uuid}-0000-4000-8000-000000000002`, version: [1, 0, 0] }], dependencies: deps }));
const addonOf = (name, uuid, deps, js) => Z.writeZip([{ name: `${name} BP/manifest.json`, data: manifest(name, uuid, deps) }, { name: `${name} BP/scripts/main.js`, data: Buffer.from(js) }]);
const GOOD_JS = "import { world } from '@minecraft/server';\nworld.afterEvents.playerSpawn.subscribe((e) => { if (e.initialSpawn) e.player.sendMessage('welcome'); });\n";
const FILES = {
  13001: addonOf('Welcome', 'a0000001', [{ module_name: '@minecraft/server', version: '2.0.0' }], GOOD_JS),
  13002: addonOf('OldBeta', 'a0000002', [{ module_name: '@minecraft/server', version: '1.2.0-beta' }], GOOD_JS),
  13003: addonOf('Phone Home', 'a0000003', [{ module_name: '@minecraft/server', version: '2.0.0' }, { module_name: '@minecraft/server-net', version: '1.0.0-beta' }], GOOD_JS),
  13009: addonOf('Crashy', 'a0000009', [{ module_name: '@minecraft/server', version: '2.0.0' }], "import { world } from '@minecraft/server';\nworld.afterEvents.chatSend.subscribe((e) => { e.sender.sendMessage('hi'); });\n"),
  13010: addonOf('Greeter', 'a0000010', [{ module_name: '@minecraft/server', version: '2.0.0' }], GOOD_JS.replace('welcome', 'hello')),
  13011: addonOf('Ruled', 'a0000011', [{ module_name: '@minecraft/server', version: '2.0.0' }], GOOD_JS.replace('welcome', 'ruled')),
};
FILES[13004] = FILES[13001];   // the same file posted again under another post
FILES[13013] = Z.writeZip([{ name: 'Data BP/manifest.json', data: manifest('Data', 'a0000013', [], false) }, { name: 'Data BP/items/x.json', data: Buffer.from('{}') }]);   // no script
FILES[13012] = FILES[13010].subarray(0, FILES[13010].length - 40);   // cut short
// an .mcaddon of .mcpack files (no manifest.json at its top: a common shape) — an addon all the same
FILES[13014] = Z.writeZip([{ name: 'Nested BP.mcpack', data: Z.writeZip([{ name: 'manifest.json', data: manifest('Nested', 'a0000014', [{ module_name: '@minecraft/server', version: '2.0.0' }]) }, { name: 'scripts/main.js', data: Buffer.from(GOOD_JS.replace('welcome', 'nested')) }]) }]);
FILES[13015] = addonOf('Mine', 'a0000015', [{ module_name: '@minecraft/server', version: '2.0.0' }], GOOD_JS.replace('welcome', 'mine'));   // its unit is here already
const HPOST = (id, { cat = 23, buttons = '', info = '', body = '' } = {}) => `<!DOCTYPE html><html><head><meta property="og:title" content="Addon ${id}"><meta property="article:published_time" content="2026-09-30T12:00:00+09:00"></head>
<body class="single postid-${id} categoryid-${cat}"><a href="https://minecraft-mcworld.com/author/0123456789abcdef0123/" title="職人${id} の投稿"><img src="a.png">職人${id}</a><table>${info}</table>${body}${buttons}<div class="comment-area"><p>二次配布していいですか</p></div></body></html>`;
const HPOSTS = {
  13001: HPOST(13001, { buttons: BTN(13001, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13002: HPOST(13002, { buttons: BTN(13002, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13003: HPOST(13003, { buttons: BTN(13003, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13004: HPOST(13004, { buttons: BTN(13004, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13005: HPOST(13005, { cat: 26, buttons: BTN(13005, 2, 'ダウンロード (zip) [DL:9]') }),
  13006: HPOST(13006, {}),
  13007: HPOST(13007, { info: '<tr><th>対応バージョン</th><td>1.16</td></tr>', buttons: BTN(13007, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13008: HPOST(13008, { buttons: BTN(13008, 3, 'ダウンロード (mcworld) [DL:9]') }),
  13009: HPOST(13009, { buttons: BTN(13009, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13010: HPOST(13010, { buttons: BTN(13010, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13011: HPOST(13011, { body: '<p>二次配布・転載は禁止です。</p><p>動画での紹介はOK</p>', buttons: BTN(13011, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13012: HPOST(13012, { buttons: BTN(13012, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13013: HPOST(13013, { buttons: BTN(13013, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13014: HPOST(13014, { buttons: BTN(13014, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
  13015: HPOST(13015, { buttons: BTN(13015, 1, 'ダウンロード (mcpack/mcaddon) [DL:9]') }),
};
const IDS = Object.keys(HPOSTS).map(Number);
const hhits = [];
const hsrv = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x'); hhits.push(u.pathname + u.search);
  const send = (code, body, h = {}) => { s.writeHead(code, h); s.end(body); };
  if (u.pathname === '/wp-json/wp/v2/posts') {
    // 4 posts a page, 3 pages, newest first (the order harvest's seed shuffles)
    const per = Number(u.searchParams.get('per_page')) || 20, page = Number(u.searchParams.get('page')) || 1, all = [...IDS].reverse(), size = 4;
    if (u.searchParams.get('categories') !== '20,22,23') return send(400, '[]');
    const got = all.slice((page - 1) * size, page * size);
    if (!got.length) return send(400, '[]');
    return send(200, JSON.stringify(got.map((id) => ({ id, link: `https://minecraft-mcworld.com/${id}/`, date: '2026-10-01T00:00:00', title: { rendered: `Addon ${id}` }, categories: [23] }))), { 'content-type': 'application/json', 'x-wp-total': String(all.length), 'x-wp-totalpages': String(Math.ceil(all.length / size)), 'x-per': String(per) });
  }
  const m = /^\/(\d+)\/$/.exec(u.pathname);
  if (m && HPOSTS[m[1]]) return send(200, HPOSTS[m[1]], { 'content-type': 'text/html' });
  if (u.pathname === '/dl/' && FILES[u.searchParams.get('postid')]) return send(200, FILES[u.searchParams.get('postid')], { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="addon-${u.searchParams.get('postid')}.mcaddon"` });
  send(404, 'not here');
});
await new Promise((r) => hsrv.listen(0, '127.0.0.1', r));
const UNITS = path.join(TOP, 'bds', 'addons'), curFile = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(curFile) ? fs.readFileSync(curFile, 'utf8') : null;
const hlab = (args, extra = {}) => new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'colony', ...args], { cwd: T, env: { ...env, COLONY_ORIGIN: `http://127.0.0.1:${hsrv.address().port}`, LAB_BORROW_BDS: '1.26.52.3', ...extra } }); let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; }); c.on('close', (code) => res({ code, t })); });
const units = () => fs.readdirSync(UNITS).filter((d) => /^borrowed_13\d{3}$/.test(d));
const steps = (t) => t.split('\n').filter((l) => /^(TRY|DROP|KEEP) /.test(l)).map((l) => l.split(' ').slice(0, 2).join(' ').replace(/\s+/g, ' '));
try {
  for (const u of units()) fs.rmSync(path.join(UNITS, u), { recursive: true, force: true });
  // the same seed, two fresh labs (their own seen record and page cache): the same order, request for request
  const seenA = path.join(T, 'seen-a.jsonl'), seenB = path.join(T, 'seen-b.jsonl');
  const h0 = hhits.length;
  let a = await hlab(['harvest', '--n', '1', '--seed', 'fixed', '--max-requests', '7', '--sim-only'], { LAB_BORROW_SEEN: seenA, LAB_COLONY_DIR: path.join(T, 'colony-a') });
  const usedA = hhits.length - h0;
  for (const u of units()) fs.rmSync(path.join(UNITS, u), { recursive: true, force: true });
  const h1 = hhits.length;
  const b = await hlab(['harvest', '--n', '1', '--seed', 'fixed', '--max-requests', '7', '--sim-only'], { LAB_BORROW_SEEN: seenB, LAB_COLONY_DIR: path.join(T, 'colony-b') });
  const usedB = hhits.length - h1;
  ok(steps(a.t).length > 0 && JSON.stringify(steps(a.t)) === JSON.stringify(steps(b.t)) && JSON.stringify(hhits.slice(h0, h0 + usedA)) === JSON.stringify(hhits.slice(h1, h1 + usedB)), 'harvest --seed: the same seed, the same posts in the same order (two labs, request for request)', `${a.t}\n----\n${b.t}`);
  ok(usedA <= 7 && new RegExp(`アクセス ${usedA}/7`).test(a.t), `harvest --max-requests: never more than the budget, and the count is said (${usedA})`, a.t);
  for (const u of units()) fs.rmSync(path.join(UNITS, u), { recursive: true, force: true });
  // --fresh: each post's page asked for once (the page read for the prefilter is the one the download uses)
  const hf = hhits.length;
  const fr = await hlab(['harvest', '--n', '1', '--seed', 'fixed', '--max-requests', '7', '--sim-only', '--fresh'], { LAB_BORROW_SEEN: path.join(T, 'seen-f.jsonl'), LAB_COLONY_DIR: path.join(T, 'colony-f') });
  const pages = hhits.slice(hf).filter((x) => /^\/\d+\/$/.test(x));
  ok(pages.length > 0 && new Set(pages).size === pages.length, 'harvest --fresh: a post\'s page is asked for once (not again for its download)', `${pages.join(' ')}\n${fr.t}`);
  for (const u of units()) fs.rmSync(path.join(UNITS, u), { recursive: true, force: true });
  // stopped while a unit is judged (Ctrl+C, a kill): marked as borrowed from its import on; then that unit and its download
  // go and the current unit is put back
  {
    const seenK = path.join(T, 'seen-k.jsonl'), CDK = path.join(T, 'colony-k');
    fs.writeFileSync(seenK, JSON.stringify({ at: '2026-01-01T00:00:00Z', site: 'colony', post: '13010', title: 'x', result: 'dropped', stage: 'real', reason: 'old', bds: '1.21.0.0' }) + '\n');
    fs.mkdirSync(path.dirname(curFile), { recursive: true }); fs.writeFileSync(curFile, 'wand');
    const k = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'colony', 'harvest', '--retry', '--n', '1', '--seed', 'k', '--sim-only'], { cwd: T, env: { ...env, COLONY_ORIGIN: `http://127.0.0.1:${hsrv.address().port}`, LAB_BORROW_BDS: '1.26.52.3', LAB_BORROW_SEEN: seenK, LAB_COLONY_DIR: CDK } });
    let kt = ''; k.stdout.on('data', (d) => { kt += d; }); k.stderr.on('data', (d) => { kt += d; });
    for (let i = 0; i < 1200 && !/check（/.test(kt) && k.exitCode === null; i++) await new Promise((res) => setTimeout(res, 100));
    let pend = null; try { pend = JSON.parse(fs.readFileSync(path.join(UNITS, 'borrowed_13010', 'imported.json'), 'utf8')).borrowed; } catch { /* not there */ }
    k.kill('SIGTERM');
    const code = await new Promise((res) => (k.exitCode !== null ? res(k.exitCode) : k.on('close', res)));
    ok(pend?.pending === true && pend.post === '13010' && /\/13010\/$/.test(pend.url), 'harvest: a unit being judged is marked as borrowed from its import on (the guards stop it)', `${JSON.stringify(pend)}\n${kt}`);
    ok(code === 143 && !fs.existsSync(path.join(UNITS, 'borrowed_13010')) && !fs.existsSync(path.join(CDK, '13010')) && fs.readFileSync(curFile, 'utf8') === 'wand', 'harvest stopped by a signal: the unit being judged and its download gone, the current unit put back', `exit ${code}\n${kt}`);
  }
  // a unit already here under a post's name (kept before, maybe fixed since): never replaced
  fs.mkdirSync(path.join(UNITS, 'borrowed_13015'), { recursive: true }); fs.writeFileSync(path.join(UNITS, 'borrowed_13015', 'mine.txt'), 'my fixes');
  // a whole harvest: every kind of post told apart; kept ones marked, dropped ones gone with their reason recorded
  const seen = path.join(T, 'seen.jsonl'), CD = path.join(T, 'colony-h');
  const r = await hlab(['harvest', '--n', '10', '--seed', 'all', '--max-requests', '60', '--sim-only'], { LAB_BORROW_SEEN: seen, LAB_COLONY_DIR: CD });
  const harvestTail = r.t.split('\n').slice(-40).join('\n');
  const rec = B.readSeen(seen), by = (id) => rec.filter((x) => String(x.post) === String(id)).at(-1);
  const kept = rec.filter((x) => x.result === 'kept').map((x) => Number(x.post)).sort();
  ok(r.code === 0 && /残した 4 \/ 落とした 11/.test(r.t) && /候補を見尽くしました/.test(r.t) && kept.length === 4 && kept.includes(13010) && kept.includes(13011) && kept.includes(13014) && (kept.includes(13001) !== kept.includes(13004)),
    'harvest: every post looked at, the four working addons kept (the one posted twice once; the .mcaddon of .mcpack files too)', `seen: ${JSON.stringify(rec.map((x) => [x.post, x.result, x.stage, x.reason]))}\nexit ${r.code}, the end of the harvest's output:\n${harvestTail}`);
  const st = (id) => by(id) && `${by(id).result}:${by(id).stage}`;
  ok(st(13002) === 'dropped:brief' && st(13003) === 'dropped:scan' && st(13005) === 'dropped:prefilter' && st(13006) === 'dropped:prefilter' && st(13007) === 'dropped:prefilter' && st(13008) === 'dropped:prefilter' && st(13009) === 'dropped:sim' && (st(13012) ?? 'dropped:file') === 'dropped:file' && st(13013) === 'dropped:kind',
    'harvest: a beta of another BDS (brief), a risky one (scan), Java / no button / an old version / a world (before downloading), a crash at load (sim), a cut file, no script (kind)', `seen: ${JSON.stringify(rec.map((x) => [x.post, x.result, x.stage, x.reason]))}\nexit ${r.code}, the end of the harvest's output:\n${harvestTail}`);
  ok(st(13015) === 'dropped:exists' && fs.readFileSync(path.join(UNITS, 'borrowed_13015', 'mine.txt'), 'utf8') === 'my fixes' && !hhits.some((x) => /^\/dl\/.*postid=13015\b/.test(x)), 'harvest: a unit already here under that name is left as it is (nothing downloaded for it)', JSON.stringify(by(13015)));
  ok([st(13001), st(13004)].sort().join() === 'dropped:seen,kept:sim' && /同じ中身を見ています（記事 130(01|04)、sha256）/.test([by(13001), by(13004)].find((x) => x.result === 'dropped').reason), 'harvest: the same file posted again is seen by its sha256 and never kept twice', JSON.stringify([by(13001), by(13004)]));
  const raw = fs.readFileSync(seen, 'utf8');
  ok(!/sendMessage|import \{/.test(raw) && rec.every((x) => x.at && x.result && x.stage && x.bds === '1.26.52.3') && rec.filter((x) => x.result === 'kept').every((x) => /^[0-9a-f]{64}$/.test(x.sha256) && x.packs.length === 1 && x.packs[0].uuid),
    'the seen record: numbers, hashes, pack ids and reasons — no content', raw.slice(0, 600));
  const u11 = path.join(UNITS, 'borrowed_13011'), mark = JSON.parse(fs.readFileSync(path.join(u11, 'imported.json'), 'utf8')).borrowed, bj = JSON.parse(fs.readFileSync(path.join(u11, 'borrowed.json'), 'utf8'));
  const origF = path.join(u11, mark.original);
  ok(mark.url.endsWith('/13011/') && mark.author === '職人13011' && mark.rules.includes('二次配布・転載は禁止です。') && !mark.rules.some((x) => /していいですか/.test(x)) && /^PASS sim 2\/2/.test(bj.verdict.sim) && bj.verdict.note,
    'a kept unit: where it came from, its author, the rules the post states (not the comments), the verdict', JSON.stringify({ mark, verdict: bj.verdict }));
  ok(fs.existsSync(origF) && (fs.statSync(origF).mode & 0o222) === 0 && B.originalOf(u11) === origF && /借りたアドオン/.test(fs.readFileSync(path.join(u11, 'TASK.md'), 'utf8')), 'the original file kept read-only beside it, its sha256 checked; TASK.md says it is borrowed');
  ok(!fs.existsSync(path.join(UNITS, 'borrowed_13002')) && !fs.existsSync(path.join(UNITS, 'borrowed_13009')) && !fs.existsSync(path.join(CD, '13002')), 'dropped: the unit and the download gone, only the record stays');
  // again: nothing seen is asked for again (no page, no download)
  const h2 = hhits.length;
  const again = await hlab(['harvest', '--n', '2', '--seed', 'other', '--max-requests', '30', '--sim-only'], { LAB_BORROW_SEEN: seen, LAB_COLONY_DIR: CD });
  const asked = hhits.slice(h2).map((x) => /^\/(\d+)\/$/.exec(x)?.[1] ?? /postid=(\d+)/.exec(x)?.[1]).filter(Boolean);
  ok(!asked.some((id) => by(id)), 'harvest again: no post seen before is asked for again (page or file)', `${asked.join(' ')}\n${again.t}`);
  // borrowed, diff, the guards
  let o = await hlab(['borrowed']);
  ok(/bds\/addons\/borrowed_13011 .*by 職人13011/.test(o.t) && /決まり: 二次配布・転載は禁止です。/.test(o.t), 'colony borrowed: each one, its rules and verdict', o.t);
  o = await hlab(['diff', 'borrowed_13011']);
  ok(o.code === 0 && /元のまま/.test(o.t), 'colony diff: as it came', o.t);
  fs.appendFileSync(path.join(u11, 'bp', 'scripts', 'main.js'), "// fixed here\n");
  o = await hlab(['diff', '13011']);
  ok(o.code === 0 && /^\+\/\/ fixed here$/m.test(o.t) && /bp:/.test(o.t), 'colony diff <post>: what was changed since (git diff against the original)', o.t);
  const labOut = (args) => new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, env: { ...env } }); let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; }); c.on('close', (code) => res({ code, t })); });
  for (const cmd of ['ship', 'publish']) { o = await labOut(['bds', cmd, '-a', 'borrowed_13011']); ok(o.code !== 0 && /借りたアドオンは配りません/.test(o.t) && /13011/.test(o.t), `${cmd}: a borrowed unit is stopped before anything is written`, o.t); }
  o = await labOut(['bds', 'bundle']);
  ok(o.code !== 0 && /bundle: 借りたアドオンは配りません/.test(o.t) && /--skip-borrowed/.test(o.t) && !fs.existsSync(path.join(TOP, 'dist', 'bds-lab-1.26.52.3.zip')), 'bundle: stopped while borrowed units are here (--skip-borrowed leaves them out)', o.t);
  // a newer BDS: --retry takes again only what it may change
  const h3 = hhits.length;
  o = await hlab(['harvest', '--retry', '--n', '5', '--seed', 'r', '--max-requests', '20', '--sim-only'], { LAB_BORROW_SEEN: seen, LAB_COLONY_DIR: CD, LAB_BORROW_BDS: '1.26.60.1' });
  const retried = [...new Set(hhits.slice(h3).map((x) => /^\/(\d+)\/$/.exec(x)?.[1] ?? /postid=(\d+)/.exec(x)?.[1]).filter(Boolean))].sort();
  ok(JSON.stringify(retried) === '["13002","13009"]' && /--retry/.test(o.t), '--retry after a BDS update: the brief and sim drops again, not the risky, the old or the foreign', `${retried}\n${o.t}`);
  // --retry still knows a copy: the post posted twice, its drop made retryable, is the same file as the kept one
  {
    const keptOne = kept.includes(13001) ? '13001' : '13004', copy = keptOne === '13001' ? '13004' : '13001', seenR = path.join(T, 'seen-r.jsonl');
    fs.writeFileSync(seenR, fs.readFileSync(seen, 'utf8') + JSON.stringify({ at: new Date().toISOString(), site: 'colony', post: copy, title: 'x', result: 'dropped', stage: 'real', reason: 'then', bds: '1.21.0.0', sha256: by(keptOne).sha256, packs: by(keptOne).packs }) + '\n');
    o = await hlab(['harvest', '--retry', '--n', '5', '--seed', 'r', '--max-requests', '20', '--sim-only'], { LAB_BORROW_SEEN: seenR, LAB_COLONY_DIR: CD, LAB_BORROW_BDS: '1.26.60.1' });
    ok(new RegExp(`DROP ${copy} .*seen: 同じ中身を見ています（記事 ${keptOne}、sha256）`).test(o.t) && !fs.existsSync(path.join(UNITS, `borrowed_${copy}`)), '--retry: a post that is a copy of a kept one is still dropped as seen (only its own record set aside)', o.t);
  }
  // diff on someone else's zip: no name in it writes outside the folder it is unpacked into (../, absolute, a nested pack's)
  {
    const sd = path.join(UNITS, 'borrowed_m_slip'), tag = `slip-${process.pid}`, uuid = 'a0000077';
    const outside = [path.join(os.tmpdir(), `${tag}-1.txt`), path.join(os.tmpdir(), `${tag}-2.txt`), path.join(os.tmpdir(), `${tag}-3`), path.join(T, `${tag}-4.txt`)];
    const bp = Z.writeZip([{ name: 'manifest.json', data: manifest('Slip', uuid, []) }, { name: `../../../${tag}-2.txt`, data: Buffer.from('x') }]);
    const orig = Z.writeZip([{ name: 'Slip BP.mcpack', data: bp }, { name: `../../${tag}-1.txt`, data: Buffer.from('x') }, { name: `../../${tag}-3.mcpack`, data: Z.writeZip([{ name: 'a.txt', data: Buffer.from('x') }]) }, { name: `${path.join(T, `${tag}-4.txt`)}`, data: Buffer.from('x') }]);
    fs.mkdirSync(path.join(sd, 'bp'), { recursive: true }); fs.mkdirSync(path.join(sd, '.borrowed'));
    fs.writeFileSync(path.join(sd, 'bp', 'manifest.json'), manifest('Slip', uuid, [])); fs.writeFileSync(path.join(sd, '.borrowed', 'slip.mcaddon'), orig);
    fs.writeFileSync(path.join(sd, 'imported.json'), JSON.stringify({ borrowed: { site: 'manual', original: '.borrowed/slip.mcaddon', sha256: crypto.createHash('sha256').update(orig).digest('hex') } }));
    o = await hlab(['diff', 'borrowed_m_slip']);
    ok(o.code === 0 && /bp: 元のまま|元のまま/.test(o.t) && !outside.some((f) => fs.existsSync(f)), 'colony diff: names that point outside (../, absolute, inside a nested pack) are never written', `${o.t}\n${outside.filter((f) => fs.existsSync(f)).join(' ')}`);
    for (const f of outside) fs.rmSync(f, { recursive: true, force: true });
    fs.writeFileSync(path.join(sd, 'imported.json'), JSON.stringify({ borrowed: { site: 'manual', original: '../../../package.json' } }));
    o = await hlab(['diff', 'borrowed_m_slip']);
    ok(o.code !== 0 && /not in borrowed_m_slip\/\.borrowed/.test(o.t), 'colony diff: an edited mark pointing outside the unit\'s .borrowed/ is not followed', o.t);
    fs.rmSync(sd, { recursive: true, force: true });
  }
  // by hand: a file from another site, the same verdict and mark (borrowed_m_…: never a harvested post's name)
  const own = path.join(T, 'other-site.mcaddon'); fs.writeFileSync(own, addonOf('Hand', 'a0000099', [{ module_name: '@minecraft/server', version: '2.0.0' }], GOOD_JS.replace('welcome', 'hand')));
  o = await hlab(['borrow', own, '--url', 'https://example.org/hand', '--author', 'Someone', '--name', 'hand', '--sim-only'], { LAB_BORROW_SEEN: seen });
  const hm = fs.existsSync(path.join(UNITS, 'borrowed_m_hand', 'imported.json')) ? JSON.parse(fs.readFileSync(path.join(UNITS, 'borrowed_m_hand', 'imported.json'), 'utf8')).borrowed : {};
  ok(o.code === 0 && /KEEP bds\/addons\/borrowed_m_hand/.test(o.t) && hm.site === 'manual' && hm.url === 'https://example.org/hand' && !hm.pending && B.readSeen(seen).at(-1).site === 'manual', 'colony borrow <file>: a file from elsewhere, the same verdict, marked as borrowed', o.t);
  o = await hlab(['get', '13011'], { LAB_BORROW_SEEN: seen, LAB_COLONY_DIR: CD });
  ok(/^W seen before \(\d{4}-\d\d-\d\d: kept/m.test(o.t), 'colony get on a post harvest saw: said, not refused', o.t);
} finally {
  hsrv.close();
  for (const u of [...units(), 'borrowed_m_hand', 'borrowed_m_slip']) fs.rmSync(path.join(UNITS, u), { recursive: true, force: true });
  if (cur0 === null) fs.rmSync(curFile, { force: true }); else fs.writeFileSync(curFile, cur0);
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`${fails ? 'FAIL' : 'PASS'} colony-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
