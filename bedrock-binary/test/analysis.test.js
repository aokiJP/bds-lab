import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElfFile } from '../src/elf/reader.js';
import { StringTable } from '../src/elf/strings.js';
import { FunctionTable } from '../src/elf/functions.js';
import { XrefIndex } from '../src/analysis/xref.js';
import { extractEnums } from '../src/analysis/enums.js';
import { extractPointerTables, alignWithTables } from '../src/analysis/tables.js';
import { buildElf, cstrings, lea, ehFrameHdr } from './helpers.js';

const RODATA = 0x10000;
const TEXT = 0x20000;
const HDR = 0x30000;

/** 指定した文字列を順に参照する関数 1 個ぶんの .text を組む */
function fixture(strings, refs, { extraFuncs = [] } = {}) {
  const rodata = cstrings(...strings);
  const addrOf = (v) => {
    let off = 0;
    for (const s of strings) {
      if (s === v) return RODATA + off;
      off += s.length + 1;
    }
    throw new Error(`no such string: ${v}`);
  };
  const parts = refs.map((v, i) => lea(TEXT + i * 7, addrOf(v)));
  // 走査は命令長ぶん手前で止まるので、末尾の lea が落ちないよう余白を足す
  const text = Buffer.concat([...parts, Buffer.alloc(16)]);
  const hdr = ehFrameHdr(HDR, [TEXT, ...extraFuncs]);
  const elf = new ElfFile(
    buildElf({
      sections: [
        { name: '.rodata', data: rodata, addr: RODATA },
        { name: '.text', data: text, addr: TEXT },
        { name: '.eh_frame_hdr', data: hdr, addr: HDR },
      ],
    }),
  );
  const ro = elf.require('.rodata');
  const st = new StringTable(elf.data(ro), Number(ro.addr));
  return new XrefIndex(elf, st, new FunctionTable(elf));
}

test('lea を辿って参照文字列を関数ごとに集める', () => {
  const x = fixture(['Alpha', 'Beta', 'Gamma'], ['Alpha', 'Beta']);
  assert.deepEqual(x.byFunction.get(0), ['Alpha', 'Beta']);
  assert.ok(x.referenced.has('Alpha'));
  assert.equal(x.referenced.has('Gamma'), false);
});

test('同じ文字列を二度読んでも順序は保ち重複は作らない', () => {
  const x = fixture(['Alpha', 'Beta'], ['Alpha', 'Beta', 'Alpha']);
  assert.deepEqual(x.byFunction.get(0), ['Alpha', 'Beta']);
});

test('参照されていない文字列を列挙できる', () => {
  const x = fixture(['Alpha', 'Dead'], ['Alpha']);
  assert.deepEqual(x.deadStrings(), ['Dead']);
});

test('形から enum を取り、先頭を型名として扱う', () => {
  const values = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'];
  const x = fixture(['MyEnum', ...values], ['MyEnum', ...values]);
  const [e] = extractEnums(x);
  assert.equal(e.name, 'MyEnum');
  assert.equal(e.source, 'shape');
  assert.deepEqual(e.values, values);
});

test('値が少なすぎる関数は enum とみなさない', () => {
  const x = fixture(['Tiny', 'A', 'B'], ['Tiny', 'A', 'B']);
  assert.equal(extractEnums(x).length, 0);
});

test('cereal の文字列があれば名前空間つきの型名を優先する', () => {
  const pretty = 'Factory<Type> cereal::BasicFactory<Net::PacketIds>::scope(std::string_view)';
  const values = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'];
  const x = fixture([pretty, 'PacketIds', ...values], [pretty, 'PacketIds', ...values]);
  const [e] = extractEnums(x);
  assert.equal(e.name, 'Net::PacketIds');
  assert.equal(e.shortName, 'PacketIds');
  assert.equal(e.source, 'cereal');
  assert.deepEqual(e.values, values, '型名そのものは値に含めない');
});

test('cereal の定型語は値に混ぜない', () => {
  const pretty = 'cereal::BasicFactory<Thing>::scope(std::string_view)';
  const values = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'];
  const x = fixture([pretty, 'Thing', 'newlyCreated', ...values], [pretty, 'Thing', 'newlyCreated', ...values]);
  const [e] = extractEnums(x);
  assert.equal(e.values.includes('newlyCreated'), false);
});

test('ポインタ配列は 8 バイト連続のときだけ 1 本とみなす', () => {
  const xref = {
    pointers: [
      { offset: 0x100, value: 'Aa' },
      { offset: 0x108, value: 'Bb' },
      { offset: 0x110, value: 'Cc' },
      { offset: 0x118, value: 'Dd' },
      { offset: 0x120, value: 'Ee' },
      { offset: 0x200, value: 'Ff' }, // 飛んでいるので別の配列
    ],
  };
  const t = extractPointerTables(xref);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].values, ['Aa', 'Bb', 'Cc', 'Dd', 'Ee']);
});

test('配列と一致すれば並びを配列側に合わせる', () => {
  const enums = [{ name: 'Ee', values: ['Cc', 'Aa', 'Bb', 'Dd', 'Ee'] }];
  const tables = [{ offset: 0x100, values: ['Aa', 'Bb', 'Cc', 'Dd', 'Ee'] }];
  alignWithTables(enums, tables);
  assert.equal(enums[0].ordered, true);
  assert.deepEqual(enums[0].values, ['Aa', 'Bb', 'Cc', 'Dd', 'Ee']);
});

test('重なりが薄い配列には合わせない', () => {
  const enums = [{ name: 'Ee', values: ['Aa', 'Bb', 'Cc', 'Dd', 'Ee'] }];
  const tables = [{ offset: 0x100, values: ['Xx', 'Yy', 'Zz', 'Ww', 'Aa'] }];
  alignWithTables(enums, tables);
  assert.equal(enums[0].ordered, false);
  assert.deepEqual(enums[0].values, ['Aa', 'Bb', 'Cc', 'Dd', 'Ee']);
});
