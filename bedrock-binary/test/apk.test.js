import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZipReader, ZipError, crc32 } from '../src/apk/zip.js';
import { parseManifest, AxmlError } from '../src/apk/axml.js';
import { extractLibrary, inspectApks, collectApks, ApkError } from '../src/apk/extract.js';
import { buildProfile } from '../src/analysis/profile.js';
import { diffProfiles } from '../src/report/diff.js';
import { renderDiff, renderProfile } from '../src/report/markdown.js';
import { buildElf, cstrings, ehFrameHdr, lea } from './helpers.js';
import { buildZip, buildManifest, loadStrings, rela, aps2, ldrImm, adrp } from './helpers-android.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bb-apk-'));
const write = (dir, name, buf) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  return p;
};

test('crc32 は既知の値と一致する', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('ZIP を無圧縮と deflate の両方で読み、CRC を検証する', () => {
  const dir = tmp();
  const big = Buffer.alloc(100_000, 'abc');
  const p = write(dir, 'a.zip', buildZip([
    { name: 'stored.bin', data: Buffer.from('hello'), method: 0 },
    { name: 'deflated.bin', data: big },
  ]));
  const z = new ZipReader(p);
  try {
    assert.deepEqual(z.entries.map((e) => e.name), ['stored.bin', 'deflated.bin']);
    assert.equal(z.read('stored.bin').toString(), 'hello');
    assert.ok(z.read('deflated.bin').equals(big));
    assert.throws(() => z.read('missing'), ZipError);
  } finally {
    z.close();
  }

  // 本体の 1 バイトを壊すと CRC で止まる
  const buf = fs.readFileSync(p);
  buf[30 + 'stored.bin'.length] ^= 0xff;
  const bad = write(dir, 'bad.zip', buf);
  const zb = new ZipReader(bad);
  try {
    assert.throws(() => zb.read('stored.bin'), /CRC/);
  } finally {
    zb.close();
  }
});

test('ZIP でないファイルは理由つきで弾く', () => {
  const dir = tmp();
  assert.throws(() => new ZipReader(write(dir, 'x.apk', Buffer.alloc(100))), /終端レコード/);
  assert.throws(() => new ZipReader(write(dir, 'y.apk', Buffer.alloc(3))), /小さすぎ/);
});

test('バイナリ XML から版情報を読む（UTF-8 / UTF-16 / 難読化）', () => {
  const want = { package: 'com.mojang.minecraftpe', versionCode: 972112402, versionName: '1.21.124.02', split: null };
  assert.deepEqual(parseManifest(buildManifest({ pkg: want.package, versionCode: want.versionCode, versionName: want.versionName })), want);
  assert.deepEqual(parseManifest(buildManifest({ pkg: want.package, versionCode: want.versionCode, versionName: want.versionName, utf8: false })), want);
  assert.deepEqual(
    parseManifest(buildManifest({ pkg: want.package, versionCode: want.versionCode, versionName: want.versionName, obfuscated: true })),
    want,
  );
  const split = parseManifest(buildManifest({ pkg: want.package, versionCode: 5, split: 'config.arm64_v8a' }));
  assert.equal(split.split, 'config.arm64_v8a');
  assert.equal(split.versionName, null);
  assert.throws(() => parseManifest(Buffer.from('<manifest/>')), AxmlError);
});

// ---- ここから arm64 の .so を組み立てて通しで試す ----

const RODATA = 0x10000;
const TEXT = 0x20000;
const HDR = 0x30000;
const DATA = 0x40000;
const PKG = 'com.mojang.minecraftpe';

function arm64Library({ values, packed = false }) {
  return arm64LibraryWithOrder(values, values, packed);
}

function apkSet(dir, { versionName, versionCode, so, splitVersionCode = versionCode, pkg = PKG, abi = 'arm64-v8a', method = 0 }) {
  const base = write(dir, 'base.apk', buildZip([
    { name: 'AndroidManifest.xml', data: buildManifest({ pkg, versionCode, versionName }) },
    { name: 'classes.dex', data: Buffer.from('dex\n035\0') },
  ]));
  const split = write(dir, `split_config.${abi.replace(/-/g, '_')}.apk`, buildZip([
    { name: 'AndroidManifest.xml', data: buildManifest({ pkg, versionCode: splitVersionCode, split: `config.${abi.replace(/-/g, '_')}` }) },
    { name: `lib/${abi}/libminecraftpe.so`, data: so, method },
    { name: `lib/${abi}/libc++_shared.so`, data: Buffer.from('not elf') },
  ]));
  return { base, split };
}

const VALUES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'];

test('分割 APK 一式を調べ、.so の場所と版を特定する', () => {
  const dir = tmp();
  apkSet(dir, { versionName: '1.21.124.02', versionCode: 972112402, so: arm64Library({ values: VALUES }) });
  const info = inspectApks(collectApks([dir]));
  assert.equal(info.manifest.versionName, '1.21.124.02');
  assert.deepEqual(info.abis, ['arm64-v8a']);
  assert.match(info.lib.apk, /split_config\.arm64_v8a\.apk$/);
});

test('.so を取り出し、2 回目は同一内容として再利用する', () => {
  const dir = tmp();
  const work = tmp();
  const so = arm64Library({ values: VALUES });
  apkSet(dir, { versionName: '1.21.124.02', versionCode: 972112402, so, method: 8 });
  const r = extractLibrary([dir], { workDir: work });
  assert.equal(r.version, '1.21.124.02');
  assert.equal(r.versionCode, 972112402);
  assert.equal(r.reused, false);
  assert.ok(fs.readFileSync(r.path).equals(so));
  assert.equal(path.relative(work, r.path), path.join('android', '1.21.124.02', 'arm64-v8a', 'libminecraftpe.so'));
  assert.equal(extractLibrary([dir], { workDir: work }).reused, true);
});

test('取り出しの失敗はどれも理由とヒントを返す', () => {
  const so = arm64Library({ values: VALUES });

  const onlyBase = tmp();
  const { base } = apkSet(onlyBase, { versionName: '1.0.0.1', versionCode: 1, so });
  assert.throws(() => extractLibrary([base], { workDir: tmp() }), (e) => e instanceof ApkError && /どの APK にもありません/.test(e.message));

  const mixed = tmp();
  apkSet(mixed, { versionName: '1.0.0.1', versionCode: 1, splitVersionCode: 2, so });
  assert.throws(() => extractLibrary([mixed], { workDir: tmp() }), /版の違う APK/);

  const other = tmp();
  apkSet(other, { versionName: '1.0.0.1', versionCode: 1, so, pkg: 'com.example.other' });
  assert.throws(() => extractLibrary([other], { workDir: tmp() }), /パッケージが com.example.other/);
  assert.equal(extractLibrary([other], { workDir: tmp(), allowOtherPackage: true }).package, 'com.example.other');

  assert.throws(() => extractLibrary([other], { abi: 'armeabi-v7a' }), /ELF32/);

  const x86so = tmp();
  apkSet(x86so, { versionName: '1.0.0.1', versionCode: 1, so: buildElf({ machine: 0x3e }) });
  assert.throws(() => extractLibrary([x86so], { workDir: tmp() }), /アーキテクチャが x86-64/);

  const noSplitOnly = tmp();
  const { split } = apkSet(noSplitOnly, { versionName: '1.0.0.1', versionCode: 1, so });
  assert.throws(() => extractLibrary([split], { workDir: tmp() }), /versionName/);

  assert.throws(() => collectApks([tmp()]), /\.apk がありません/);
  assert.throws(() => collectApks(['/nonexistent/x.apk']), /ありません/);
  assert.throws(() => collectApks([write(tmp(), 'lib.so', so)]), /\.apk ではありません/);
});

for (const packed of [false, true]) {
  test(`arm64 の .so から enum とスロット参照を復元する（${packed ? 'APS2' : 'RELA'}）`, () => {
    const dir = tmp();
    // 命令順は並べ替え、配列は定義順。配列側の並びが採用されるはず
    const shuffled = ['Three', 'Zero', 'Five', 'One', 'Four', 'Two'];
    const file = write(dir, 'libminecraftpe.so', arm64LibraryWithOrder(shuffled, VALUES, packed));

    const p = buildProfile(file, { version: '1.21.124.02', channel: 'android', quiet: true, source: { kind: 'apk', versionCode: 1, abi: 'arm64-v8a', package: PKG } });
    assert.equal(p.binary.machine, 'aarch64');
    assert.equal(p.binary.path, 'libminecraftpe.so');
    const e = p.enums.find((x) => x.name === 'MyEnum');
    assert.ok(e, 'MyEnum が取れていない');
    assert.equal(e.ordered, true);
    assert.deepEqual(e.values, VALUES);
    assert.ok(p.identifiers.live.includes('ViaSlot'), 'ldr 経由の参照が拾えていない');
    assert.ok(p.identifiers.dead.includes('Unused'));
    assert.ok(p.stats.codeRefs >= VALUES.length + 1);
    assert.equal(p.stats.slotRefs, 1);
    assert.equal(p.wss.side, 'client');
    assert.match(renderProfile(p), /APK `com.mojang.minecraftpe` versionCode 1/);
  });
}

/** 命令側の順序 (order) と配列側の順序 (table) を別々に指定できる版 */
function arm64LibraryWithOrder(order, table, packed) {
  const strs = ['MyEnum', ...table, 'ViaSlot', 'Unused'];
  const addr = (v) => {
    let off = 0;
    for (const s of strs) {
      if (s === v) return RODATA + off;
      off += s.length + 1;
    }
    throw new Error(v);
  };
  const f0 = loadStrings(TEXT, ['MyEnum', ...order].map(addr));
  const f1Start = TEXT + f0.length;
  const f1 = Buffer.concat([adrp(f1Start, DATA, 9), ldrImm(0, 9, table.length * 8)]);
  const relocs = [...table, 'ViaSlot'].map((v, i) => ({ offset: DATA + i * 8, addend: addr(v) }));
  return buildElf({
    machine: 0xb7,
    sections: [
      { name: '.rodata', data: cstrings(...strs), addr: RODATA },
      { name: '.text', data: Buffer.concat([f0, f1]), addr: TEXT },
      { name: '.eh_frame_hdr', data: ehFrameHdr(HDR, [TEXT, f1Start]), addr: HDR },
      { name: '.data.rel.ro', data: Buffer.alloc(relocs.length * 8), addr: DATA },
      { name: '.rela.dyn', type: packed ? 0x60000002 : 4, data: packed ? aps2(relocs, 1027) : rela(relocs, 1027), addr: 0x50000 },
    ],
  });
}

test('サーバーとクライアントの差分は「片側にしか無いコード」として出す', () => {
  const dir = tmp();
  const android = buildProfile(write(dir, 'libminecraftpe.so', arm64LibraryWithOrder(VALUES, VALUES, false)), {
    version: '1.21.124.02', channel: 'android', quiet: true,
  });

  // 同じ enum を持つ x86-64 のサーバー側
  const strs = ['MyEnum', ...VALUES, 'ServerOnly'];
  const rodata = cstrings(...strs);
  const addr = (v) => RODATA + strs.slice(0, strs.indexOf(v)).reduce((a, s) => a + s.length + 1, 0);
  const text = Buffer.concat([...strs.map((v, i) => lea(TEXT + i * 7, addr(v))), Buffer.alloc(16)]);
  const server = buildProfile(write(dir, 'bedrock_server', buildElf({
    machine: 0x3e,
    sections: [
      { name: '.rodata', data: rodata, addr: RODATA },
      { name: '.text', data: text, addr: TEXT },
      { name: '.eh_frame_hdr', data: ehFrameHdr(HDR, [TEXT]), addr: HDR },
    ],
  })), { version: '1.21.124.2', channel: 'release', quiet: true });

  const d = diffProfiles(server, android);
  assert.equal(d.crossBinary, true);
  assert.ok(d.identifiers.live.removed.includes('ServerOnly'));
  assert.match(renderDiff(d), /サーバーとクライアントの比較/);
  assert.equal(diffProfiles(android, android).crossBinary, false);
});
