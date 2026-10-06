import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElfFile, ElfError } from '../src/elf/reader.js';
import { StringTable } from '../src/elf/strings.js';
import { FunctionTable } from '../src/elf/functions.js';
import { buildElf, cstrings, ehFrameHdr } from './helpers.js';

test('ELF でないものは弾く', () => {
  assert.throws(() => new ElfFile(Buffer.alloc(128)), ElfError);
});

test('ELF32 とビッグエンディアンは未対応と言う', () => {
  const b = buildElf({ sections: [] });
  b[4] = 1;
  assert.throws(() => new ElfFile(b), /ELF32/);
  const c = buildElf({ sections: [] });
  c[5] = 2;
  assert.throws(() => new ElfFile(c), /エンディアン/);
});

test('セクションを名前で引ける', () => {
  const elf = new ElfFile(buildElf({ sections: [{ name: '.rodata', data: cstrings('abc'), addr: 0x1000 }] }));
  assert.equal(elf.section('.rodata').size, 4);
  assert.equal(elf.section('.nope'), undefined);
  assert.throws(() => elf.require('.nope'), /がありません/);
});

test('アーキテクチャ名を返す', () => {
  assert.equal(new ElfFile(buildElf({ machine: 0x3e })).machineName, 'x86-64');
  assert.equal(new ElfFile(buildElf({ machine: 0xb7 })).machineName, 'aarch64');
});

test('仮想アドレスをファイルオフセットに直せる', () => {
  const elf = new ElfFile(buildElf({ sections: [{ name: '.rodata', data: cstrings('abcd'), addr: 0x2000 }] }));
  const s = elf.section('.rodata');
  assert.equal(elf.offsetOf(0x2002), s.offset + 2);
  assert.equal(elf.offsetOf(0x9999), null);
});

test('文字列は NUL 終端のみ拾う', () => {
  const t = new StringTable(Buffer.from('Alpha\0\x01Beta\0Trailing', 'latin1'), 0x1000);
  assert.deepEqual(t.values, ['Alpha', 'Beta']);
});

test('末尾マージされた文字列は途中から解決できる', () => {
  // "SubClientLogin" の中に "Login" が畳み込まれている状況
  const t = new StringTable(cstrings('SubClientLogin'), 0x1000);
  assert.equal(t.resolve(0x1000), 'SubClientLogin');
  assert.equal(t.resolve(0x1009), 'Login');
  assert.equal(t.isStart(0x1009), false);
  assert.equal(t.isStart(0x1000), true);
});

test('文字列の隙間や範囲外は undefined', () => {
  const t = new StringTable(cstrings('abc', 'def'), 0x1000);
  assert.equal(t.resolve(0x0fff), undefined);
  assert.equal(t.resolve(0x1003), ''); // 終端そのもの
  assert.equal(t.resolve(0x9999), undefined);
});

test('eh_frame_hdr から関数境界を取る', () => {
  const base = 0x5000;
  const hdr = ehFrameHdr(base, [0x1000, 0x1100, 0x1200]);
  const elf = new ElfFile(buildElf({ sections: [{ name: '.eh_frame_hdr', data: hdr, addr: base }] }));
  const ft = new FunctionTable(elf);
  assert.equal(ft.count, 3);
  assert.equal(ft.addressOf(1), 0x1100);
  assert.equal(ft.indexOf(0x1150), 1);
  assert.equal(ft.indexOf(0x1000), 0);
  assert.equal(ft.indexOf(0x0999), -1);
});

test('eh_frame_hdr が無ければ理由を言って落ちる', () => {
  const elf = new ElfFile(buildElf({ sections: [] }));
  assert.throws(() => new FunctionTable(elf), /eh_frame_hdr/);
});
