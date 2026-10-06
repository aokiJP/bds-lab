import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElfFile } from '../src/elf/reader.js';
import {
  relativeRelocations, readAndroidPacked, Sleb128Reader, RelocError,
  R_AARCH64_RELATIVE, R_X86_64_RELATIVE, SHT_ANDROID_RELA, SHT_RELR,
} from '../src/elf/relocs.js';
import { buildElf } from './helpers.js';
import { sleb, rela, aps2, relr } from './helpers-android.js';

const ENTRIES = [
  { offset: 0x3000, addend: 0x1000 },
  { offset: 0x3008, addend: 0x1010 },
  { offset: 0x3010, addend: 0x1004 },
  { offset: 0x3018, addend: 0x2000 },
];
const sorted = (xs) => [...xs].sort((a, b) => a.offset - b.offset);

test('SLEB128 は正負と多バイトを往復できる', () => {
  for (const v of [0, 1, -1, 63, 64, -64, -65, 127, 128, 0x7fffffff, -0x80000000, 2 ** 40, -(2 ** 40)]) {
    assert.equal(new Sleb128Reader(sleb(v)).next(), v, String(v));
  }
});

test('途切れた SLEB128 は理由つきで落ちる', () => {
  assert.throws(() => new Sleb128Reader(Buffer.from([0x80])).next(), RelocError);
});

test('RELA から相対再配置だけを拾う（アーキテクチャ別の型番号）', () => {
  const data = Buffer.concat([rela(ENTRIES, R_AARCH64_RELATIVE), rela([{ offset: 0x9000, addend: 5 }], 257)]);
  const elf = new ElfFile(buildElf({ machine: 0xb7, sections: [{ name: '.rela.dyn', type: 4, data, addr: 0x500 }] }));
  assert.deepEqual(sorted(relativeRelocations(elf)), ENTRIES);

  // 同じデータでも x86-64 として読めば型番号が違うので 0 件
  const x86 = new ElfFile(buildElf({ machine: 0x3e, sections: [{ name: '.rela.dyn', type: 4, data, addr: 0x500 }] }));
  assert.equal(relativeRelocations(x86).length, 0);
  const x86data = rela(ENTRIES, R_X86_64_RELATIVE);
  const x86ok = new ElfFile(buildElf({ machine: 0x3e, sections: [{ name: '.rela.dyn', type: 4, data: x86data, addr: 0x500 }] }));
  assert.equal(relativeRelocations(x86ok).length, 4);
});

test('Android APS2 を展開する（グループ間の addend 累積を含む）', () => {
  const out = [];
  readAndroidPacked(aps2(ENTRIES, R_AARCH64_RELATIVE), R_AARCH64_RELATIVE, out);
  assert.deepEqual(out, ENTRIES);

  const elf = new ElfFile(buildElf({
    machine: 0xb7,
    sections: [{ name: '.rela.dyn', type: SHT_ANDROID_RELA, data: aps2(ENTRIES, R_AARCH64_RELATIVE), addr: 0x500 }],
  }));
  assert.deepEqual(relativeRelocations(elf), ENTRIES);
});

test('APS2 のグループフラグ: addend なしグループは addend を 0 に戻す', () => {
  const data = Buffer.concat([
    Buffer.from('APS2', 'latin1'), sleb(2), sleb(0),
    sleb(1), sleb(1 | 8), sleb(R_AARCH64_RELATIVE), sleb(0x100), sleb(0x77),
    sleb(1), sleb(1), sleb(R_AARCH64_RELATIVE), sleb(0x8),
  ]);
  const out = [];
  readAndroidPacked(data, R_AARCH64_RELATIVE, out);
  assert.deepEqual(out, [{ offset: 0x100, addend: 0x77 }, { offset: 0x108, addend: 0 }]);
});

test('APS2 でないデータは弾く', () => {
  assert.throws(() => readAndroidPacked(Buffer.from('APS1....'), 1027, []), /APS2/);
});

test('RELR はアドレスとビットマップを展開し、addend をファイル上の値から読む', () => {
  // 0x3000 に 8 本、少し飛んで 0x3100 に 1 本、64 本目以降（ビットマップ 2 語目）も混ぜる
  const addrs = [...Array(8).keys()].map((i) => 0x3000 + i * 8);
  addrs.push(0x3100);
  for (let i = 0; i < 70; i++) addrs.push(0x4000 + i * 8);

  const dataStart = 0x3000;
  const data = Buffer.alloc(0x4000 + 70 * 8 - dataStart);
  for (const a of addrs) data.writeBigUInt64LE(BigInt(a + 0x10000), a - dataStart);

  const elf = new ElfFile(buildElf({
    machine: 0xb7,
    sections: [
      { name: '.data.rel.ro', data, addr: dataStart },
      { name: '.relr.dyn', type: SHT_RELR, data: relr(addrs), addr: 0x800 },
    ],
  }));
  const got = sorted(relativeRelocations(elf));
  assert.equal(got.length, addrs.length);
  assert.deepEqual(got.map((r) => r.offset), addrs);
  assert.ok(got.every((r) => r.addend === r.offset + 0x10000));
});

test('entsize がおかしい RELA は理由つきで落ちる', () => {
  const buf = buildElf({ machine: 0xb7, sections: [{ name: '.rela.dyn', type: 4, data: Buffer.alloc(24), addr: 0x500 }] });
  // .rela.dyn はセクションヘッダの 1 番。entsize は +0x38
  const shoff = Number(buf.readBigUInt64LE(0x28));
  buf.writeBigUInt64LE(16n, shoff + 64 + 0x38);
  assert.throws(() => relativeRelocations(new ElfFile(buf)), /entsize/);
});
