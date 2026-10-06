// 本物のコンパイラ（clang++）とリンカ（ld.lld）が出す RTTI と vtable から、パケット ID を読めるか。
// 合成 ELF（test/packets.test.js）だけでは「自分で書いた並べ方を自分で読めた」ことしか言えない。
// x86-64（BDS と同じ）と arm64（Android と同じ。再配置 4 形式すべて）、endbr64 / bti の付くビルドも。
// clang++ / ld.lld が無い環境では飛ばす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ElfFile } from '../src/elf/reader.js';
import { extractPacketIds } from '../src/analysis/packets.js';
import { buildProfile } from '../src/analysis/profile.js';

function findTool(names) {
  for (const n of names) {
    try {
      execFileSync(n, ['--version'], { stdio: 'ignore' });
      return n;
    } catch {
      // 次の候補
    }
  }
  return null;
}
const CLANG = findTool(['clang++', 'clang++-18', 'clang++-17', 'clang++-16']);
const LLD = findTool(['ld.lld', 'ld.lld-18', 'ld.lld-17', 'ld.lld-16']);
const skip = !CLANG || !LLD ? 'clang++ と ld.lld が必要です' : false;

// 番号は BDS 1.26.52.3 の実物どおり。ソースでの並び（＝列挙子の並び）は番号順にしない
const PACKETS = [
  ['TextPacket', 9], ['LoginPacket', 1], ['CameraAimAssistActorPriorityPacket', 339], ['CameraInstructionPacket', 300],
  ['ClientCacheBlobStatusPacket', 135], ['RecordStartedPacket', 352], ['AddActorPacket', 13], ['PlayStatusPacket', 2],
];
const ENUM = ['KeepAlive', 'Login', 'PlayStatus', 'Text', 'AddActor', 'ClientCacheBlobStatusPacket', 'CameraInstruction', 'CameraAimAssistActorPriority', 'RecordStarted'];

function source() {
  return [
    // ヘッダは使わない（ターゲットごとの標準ライブラリが無くても通るように）
    'enum class MinecraftPacketIds : int {};',
    'struct Packet {',
    '  virtual ~Packet();',
    '  virtual MinecraftPacketIds getId() const = 0;',
    '  virtual const char* getName() const = 0;',
    '  virtual int maxSize() const { return 0xa00000; }',
    '  int mFlags = 0;',
    '};',
    'Packet::~Packet() {}',
    // 多重継承: 2 本目の vtable（offset-to-top が 0 でない）が混ざる
    'struct Observer { virtual ~Observer(); virtual int priority() const { return 77; } };',
    'Observer::~Observer() {}',
    ...PACKETS.map(([c, id], i) =>
      `struct ${c} ${i === 2 ? 'final ' : ''}: Packet${i === 3 ? ', Observer' : ''} {` +
      ` MinecraftPacketIds getId() const override { return (MinecraftPacketIds)${id}; }` +
      ` const char* getName() const override { return "${c}"; } };`),
    // 列挙子の名前の表（cereal のリフレクション文字列の代わり。結び付けの確認用）
    `extern "C" const char* const kNames[] = {${ENUM.map((n) => `"${n}"`).join(',')}};`,
    'extern "C" Packet* make(int i) {',
    '  switch (i) {',
    ...PACKETS.map(([c], i) => `    case ${i}: return new ${c};`),
    '    default: return nullptr;',
    '  }',
    '}',
  ].join('\n');
}

function build(dir, { target, cflags = [], modes }) {
  const cpp = path.join(dir, 'packets.cpp');
  const o = path.join(dir, `${target}.o`);
  fs.writeFileSync(cpp, source());
  execFileSync(CLANG, [`--target=${target}`, '-fPIC', '-O2', '-fvisibility=hidden', '-ffreestanding', '-fno-exceptions', '-funwind-tables', ...cflags, '-c', cpp, '-o', o]);
  const out = {};
  for (const m of modes) {
    out[m] = path.join(dir, `lib_${target}_${m.replace('+', '_')}.so`);
    execFileSync(LLD, ['-shared', '--eh-frame-hdr', `--pack-dyn-relocs=${m}`, '-z', 'undefs', '-o', out[m], o]);
  }
  return out;
}

const expected = [...PACKETS].map(([c, id]) => ({ id, class: c })).sort((a, b) => a.id - b.id);

const BUILDS = [
  { label: 'x86-64', target: 'x86_64-linux-gnu', modes: ['none', 'relr'] },
  { label: 'x86-64 + endbr64', target: 'x86_64-linux-gnu', cflags: ['-fcf-protection=full'], modes: ['none'] },
  { label: 'arm64', target: 'aarch64-linux-android21', modes: ['none', 'android', 'relr', 'android+relr'] },
  { label: 'arm64 + bti', target: 'aarch64-linux-android21', cflags: ['-mbranch-protection=standard'], modes: ['none'] },
];

for (const b of BUILDS) {
  test(`lld 製の ${b.label} から getId() でパケット ID を読む`, { skip }, () => {
    const libs = build(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pk-')), b);
    for (const m of b.modes) {
      const r = extractPacketIds(new ElfFile(fs.readFileSync(libs[m])));
      assert.equal(r.basis, 'getId', `${m}: ${r.reason}`);
      assert.deepEqual(r.list, expected, m);
    }
  });
}

test('プロファイルに番号と列挙子が載る（buildProfile）', { skip }, () => {
  const libs = build(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pk-')), BUILDS[0]);
  const p = buildProfile(libs.none, { quiet: true, channel: 'release', version: '0.0.0.1' });
  assert.equal(p.packets.basis, 'getId');
  assert.equal(p.stats.packets, PACKETS.length);
  assert.deepEqual(p.packets.list.map((x) => [x.id, x.class]), expected.map((x) => [x.id, x.class]));
});
