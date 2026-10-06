// パケット ID を getId() の機械語から読む（src/analysis/packets.js）。
// 合成 ELF で「型名 → typeinfo → vtable → getId」のたどり方と、ID の並びが列挙子の並びと違う場合を確かめる。
// 本物のコンパイラが出す RTTI / vtable での確認は test/packets-toolchain.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElfFile } from '../src/elf/reader.js';
import { constantReturn, findTypeNames, extractPacketIds, linkPacketNames } from '../src/analysis/packets.js';
import { diffPackets, isEmptyDiff, diffProfiles } from '../src/report/diff.js';
import { renderDiff } from '../src/report/markdown.js';
import { buildElf } from './helpers.js';
import { rela } from './helpers-android.js';

const X86 = 0x3e;
const ARM = 0xb7;
const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const u32 = (...w) => Buffer.concat(w.map((x) => { const b = Buffer.alloc(4); b.writeUInt32LE(x >>> 0); return b; }));
const movz = (imm) => 0x52800000 | (imm << 5);
const RET = 0xd65f03c0;

test('定数を返すだけの関数を見分ける（x86-64）', () => {
  assert.equal(constantReturn(hex('b809000000c3cccc'), X86), 9);
  assert.equal(constantReturn(hex('b82c010000c3cccc'), X86), 300);
  assert.equal(constantReturn(hex('f30f1efa b860010000c3'), X86), 352); // endbr64 つき
  assert.equal(constantReturn(hex('31c0c3cccccccccc'), X86), 0);
  assert.equal(constantReturn(hex('b809000000909090'), X86), null); // ret で終わらない
  assert.equal(constantReturn(hex('488d0500000000c3'), X86), null); // lea（getName）
  assert.equal(constantReturn(hex('c3'), X86), null); // 短すぎる
});

test('定数を返すだけの関数を見分ける（arm64）', () => {
  assert.equal(constantReturn(u32(movz(9), RET), ARM), 9);
  assert.equal(constantReturn(u32(movz(352), RET), ARM), 352);
  assert.equal(constantReturn(u32(0xd503245f, movz(300), RET), ARM), 300); // bti c つき
  assert.equal(constantReturn(u32(0x2a1f03e0, RET), ARM), 0); // mov w0, wzr
  assert.equal(constantReturn(u32(movz(9) | (1 << 21), RET), ARM), null); // lsl #16 は番号ではない
  assert.equal(constantReturn(u32(movz(9), 0xd503201f), ARM), null); // ret でない
  assert.equal(constantReturn(u32(movz(9), RET), 0x28), null); // 対象外のアーキテクチャ
});

// ---------- 合成 ELF ----------
// .rodata の型名、.data.rel.ro の typeinfo と vtable（中身は 0、値は再配置の addend）、.text の関数。
// 実物と同じく、vtable の 3 本目が getId、5 本目は全クラスが同じ定数を返す関数（選んではいけない）
const RO = 0x1000;
const TEXT = 0x4000;
const DATA = 0x8000;

function synth({ machine = X86, packets, broken = {} } = {}) {
  const arm = machine === ARM;
  // 型名: 前が NUL でないもの・隣り合うものを混ぜる（実物の .rodata もそうなっている）
  const parts = [];
  const nameAt = {};
  let off = 0;
  const put = (b) => { parts.push(b); off += b.length; };
  put(Buffer.from([0x05, 0x06]));
  for (const [i, p] of packets.entries()) {
    if (i % 2) put(Buffer.from([0x07])); // NUL でない前置き
    nameAt[p.class] = RO + off;
    put(Buffer.from(`${p.class.length}${p.class}\0`, 'latin1'));
  }
  put(Buffer.from('6Packet\0', 'latin1')); // 基底クラス（長さ 6 の名前は Packet そのもの: 拾わない）
  const ro = Buffer.concat(parts);

  // .text: 16 バイトごとに 1 関数
  const text = [];
  const fn = (code) => { const a = TEXT + text.length * 16; const b = Buffer.alloc(16, arm ? 0 : 0xcc); code.copy(b); text.push(b); return a; };
  const ret = arm ? u32(RET) : hex('c3');
  const getId = (id) => (arm ? u32(movz(id), RET) : hex(`b8${Buffer.from(u32(id)).toString('hex')}c3`));
  const getName = arm ? u32(0x10000000, RET) : hex('488d0500000000c3');
  const same = fn(arm ? u32(movz(0x7fff), RET) : hex('b80000a000c3'));
  const dtor = fn(ret);
  const dtor2 = fn(arm ? u32(0xa9bf7bfd, RET) : hex('534889fbc3'));

  // .data.rel.ro: クラスごとに typeinfo 24 バイト + vtable (2 + 6) * 8 バイト
  const relocs = [];
  let d = 0;
  const data = [];
  const block = (words) => { const a = DATA + d; const b = Buffer.alloc(words.length * 8); words.forEach((w, i) => { if (typeof w === 'bigint') b.writeBigInt64LE(w, i * 8); }); data.push(b); d += b.length; return a; };
  const ti = {};
  for (const p of packets) {
    const t = block([0n, null, null]);
    ti[p.class] = t;
    relocs.push({ offset: t + 8, addend: nameAt[p.class] });
  }
  // 派生クラスの typeinfo は基底の typeinfo を指す（vtable と取り違えてはいけない）
  relocs.push({ offset: ti[packets[2].class] + 16, addend: ti[packets[0].class] });
  for (const p of packets) {
    const fns = [dtor, dtor2, fn(getId(broken[p.class] ?? p.id)), fn(getName), same, dtor];
    const v = block([0n, null, ...fns.map(() => null)]);
    relocs.push({ offset: v + 8, addend: ti[p.class] });
    fns.forEach((f, i) => relocs.push({ offset: v + 16 + i * 8, addend: f }));
  }
  // 多重継承の 2 本目の vtable（offset-to-top が 0 でない）。ここの定数は ID ではない
  const sec = block([-16n, null, null, null, null]);
  relocs.push({ offset: sec + 8, addend: ti[packets[1].class] }, { offset: sec + 16, addend: dtor }, { offset: sec + 24, addend: dtor2 }, { offset: sec + 32, addend: fn(getId(77)) });

  return new ElfFile(buildElf({
    machine,
    sections: [
      { name: '.rodata', type: 1, flags: 2, addr: RO, data: ro },
      { name: '.text', type: 1, flags: 6, addr: TEXT, data: Buffer.concat(text) },
      { name: '.data.rel.ro', type: 1, flags: 3, addr: DATA, data: Buffer.concat(data) },
      { name: '.rela.dyn', type: 4, flags: 2, addr: 0x20000, entsize: 24, data: rela(relocs, arm ? 1027 : 8) },
    ],
  }));
}

// ID の順と型名の順をわざと変える（実物も新しいパケットほど並びと番号が合わない）
const PACKETS = [
  { class: 'LoginPacket', id: 1 },
  { class: 'CameraInstructionPacket', id: 300 },
  { class: 'TextPacket', id: 9 },
  { class: 'CameraAimAssistActorPriorityPacket', id: 339 },
  { class: 'ClientCacheBlobStatusPacket', id: 135 },
];
const sorted = [...PACKETS].sort((a, b) => a.id - b.id);

test('型名は長さの数字で確かめて拾う（前が NUL でなくても、隣り合っていても）', () => {
  const elf = synth({ packets: PACKETS });
  const names = findTypeNames(elf);
  assert.deepEqual([...names.keys()].sort(), PACKETS.map((p) => p.class).sort());
  assert.equal(elf.buf.toString('latin1', elf.offsetOf(names.get('TextPacket')), elf.offsetOf(names.get('TextPacket')) + 12), '10TextPacket');
});

for (const [label, machine] of [['x86-64', X86], ['arm64', ARM]]) {
  test(`${label}: 型名 → typeinfo → vtable → getId() で番号を読む`, () => {
    const r = extractPacketIds(synth({ machine, packets: PACKETS }));
    assert.equal(r.basis, 'getId', r.reason);
    assert.equal(r.slot, 2);
    assert.deepEqual(r.list, sorted.map(({ id, class: c }) => ({ id, class: c })));
  });
}

test('照合に落ちたら番号を出さない（TextPacket が 9 でない）', () => {
  const r = extractPacketIds(synth({ packets: PACKETS, broken: { TextPacket: 8 } }));
  assert.equal(r.basis, null);
  assert.deepEqual(r.list, []);
  assert.match(r.reason, /TextPacket は 9 のはずが 8/);
});

test('照合用のクラスが無ければ番号を出さない', () => {
  const r = extractPacketIds(synth({ packets: PACKETS.filter((p) => !/^(Text|Login)Packet$/.test(p.class)).concat([{ class: 'OtherPacket', id: 5 }, { class: 'AnotherPacket', id: 6 }]) }));
  assert.equal(r.basis, null);
  assert.match(r.reason, /TextPacket \/ LoginPacket/);
});

test('型名が無いバイナリ・未対応のアーキテクチャは理由つきで空', () => {
  const none = new ElfFile(buildElf({ sections: [{ name: '.rodata', type: 1, flags: 2, addr: RO, data: Buffer.from('nothing\0') }] }));
  assert.match(extractPacketIds(none).reason, /型名/);
  const arm32 = new ElfFile(buildElf({ machine: 0x28, sections: [{ name: '.rodata', type: 1, flags: 2, addr: RO, data: Buffer.from('x\0') }] }));
  assert.match(extractPacketIds(arm32).reason, /未対応/);
});

// ---------- 列挙子との結び付け ----------
// BDS 1.26.52.3 の実物を縮めたもの: 134 は列から消えた番号、200〜299 は予約、新しい範囲は並びが番号順でない
const ENUM = ['KeepAlive', 'Login', 'PlayStatus', 'MoveAbsoluteActor', 'TickSync', 'Text', 'StructureTemplateDataExportResponse', 'ClientCacheBlobStatusPacket',
  'TriggerAnimation', 'UnlockedRecipes', 'TitleSpecificPacketsStart', 'TitleSpecificPacketsEnd', 'CameraInstruction', 'CompressedBiomeDefinitionList', 'TrimData',
  'SetMovementAuthorityMode', 'CameraAimAssistActorPriority', 'CameraAimAssistPresets'];
const CLASSES = [
  [1, 'LoginPacket'], [2, 'PlayStatusPacket'], [3, 'MoveActorAbsolutePacket'], [5, 'TextPacket'], [133, 'StructureTemplateDataResponsePacket'],
  [135, 'ClientCacheBlobStatusPacket'], [136, 'AnimateEntityPacket'], [137, 'UnlockedRecipesPacket'], [300, 'CameraInstructionPacket'], [302, 'TrimDataPacket'],
  [320, 'CameraAimAssistPresetsPacket'], [339, 'CameraAimAssistActorPriorityPacket'], [340, 'ClientboundDataStorePacket'],
].map(([id, c]) => ({ id, class: c }));

test('列挙子: 同じ名前は結び、名前が変わったものは前後と番号の数が合うときだけ順に当てる', () => {
  const { list, noClass } = linkPacketNames(CLASSES, ENUM);
  const name = Object.fromEntries(list.map((p) => [p.class, p.name]));
  assert.equal(name.TextPacket, 'Text');
  assert.equal(name.ClientCacheBlobStatusPacket, 'ClientCacheBlobStatusPacket');
  assert.equal(name.MoveActorAbsolutePacket, 'MoveAbsoluteActor'); // 2 と 5 の間に 2 つ、番号も 3, 4 の 2 つ
  assert.equal(name.AnimateEntityPacket, 'TriggerAnimation'); // 135 と 137 の間
  assert.equal(name.CameraAimAssistActorPriorityPacket, 'CameraAimAssistActorPriority'); // 並びが番号順でなくても名前で
  // 133 は列の前後（TickSync の後ろの Text=5 と 135）の間が 129 個あるのに列挙子は 1 つ: 当てない
  assert.equal(name.StructureTemplateDataResponsePacket, null);
  assert.equal(name.ClientboundDataStorePacket, null); // 列に無いパケット
  const gone = Object.fromEntries(noClass.map((x) => [x.name, x.id]));
  assert.equal(gone.KeepAlive, 0); // 先頭: 0 から
  assert.equal(gone.TickSync, 4); // 削除されたパケットにも番号（間がぴったり埋まるとき）
  assert.equal(gone.CompressedBiomeDefinitionList, 301);
  assert.equal(gone.StructureTemplateDataExportResponse, null);
  assert.equal(gone.TitleSpecificPacketsStart, null); // 予約の印: 番号を作らない
  assert.equal(gone.TitleSpecificPacketsEnd, null);
  assert.equal(gone.SetMovementAuthorityMode, null); // 並びが番号順でない範囲（302 の次が 339）
});

// ---------- 版の差 ----------
const prof = (version, list) => ({
  version, channel: 'release', binary: { machine: 'x86-64' },
  packets: { basis: 'getId', list: list.map(([id, c]) => ({ id, class: c, name: null })), noClass: [] },
  enums: [], identifiers: { live: [], dead: [] }, stats: {},
});

test('パケットの差: 追加・削除・番号の変化を getId() の番号で出す', () => {
  const a = prof('1.0', [[1, 'LoginPacket'], [9, 'TextPacket'], [134, 'UpdateBlockPropertiesPacket'], [300, 'CameraInstructionPacket']]);
  const b = prof('1.1', [[1, 'LoginPacket'], [9, 'TextPacket'], [300, 'CameraInstructionPacket'], [301, 'MovedPacket'], [353, 'NewThingPacket']]);
  b.packets.list.find((p) => p.class === 'MovedPacket').id = 301;
  a.packets.list.push({ id: 200, class: 'MovedPacket', name: null });
  // 同じ番号でクラス名だけ変わったものは増減ではない
  a.packets.list.push({ id: 330, class: 'DataStoreSyncPacket', name: null });
  b.packets.list.push({ id: 330, class: 'ClientboundDataStorePacket', name: null });
  const d = diffPackets(a.packets, b.packets);
  assert.deepEqual(d.renamed, [{ id: 330, from: 'DataStoreSyncPacket', to: 'ClientboundDataStorePacket' }]);
  assert.deepEqual(d.added.map((p) => p.class), ['NewThingPacket']);
  assert.deepEqual(d.removed.map((p) => p.class), ['UpdateBlockPropertiesPacket']);
  assert.deepEqual(d.renumbered, [{ class: 'MovedPacket', from: 200, to: 301 }]);
  const full = diffProfiles(a, b);
  assert.equal(isEmptyDiff(full), false);
  const md = renderDiff(full);
  assert.match(md, /## パケット \(\+1 \/ -1 \/ 番号の変化 1 \/ 名前だけ変わった 1\)/);
  assert.match(md, /330  0x14a  DataStoreSyncPacket → ClientboundDataStorePacket/);
  assert.match(md, /200 → 301  MovedPacket/);
  assert.match(md, /353  0x161  NewThingPacket/);
});

test('片方が古いプロファイル（getId の番号なし）なら、パケットの番号は語らない', () => {
  const a = prof('1.0', [[1, 'LoginPacket']]);
  const old = { ...prof('0.9', []), packets: undefined };
  assert.equal(diffPackets(old.packets, a.packets), null);
  const d = diffProfiles(old, a);
  assert.equal(d.packets, null);
  assert.equal(isEmptyDiff(d), true);
  assert.equal(diffPackets({ basis: null, list: [] }, a.packets), null);
});
