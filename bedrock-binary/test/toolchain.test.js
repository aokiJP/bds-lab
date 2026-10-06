// 本物のリンカ (lld) で arm64 の .so を作り、4 種類の再配置形式すべてで同じ結果になるかを確かめる。
// 合成 ELF のテストだけでは「自分で書いたエンコーダと自分で書いたデコーダが合っている」ことしか言えない。
// clang / ld.lld が無い環境では飛ばす。CI では入れてから回す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildProfile } from '../src/analysis/profile.js';
import { ElfFile } from '../src/elf/reader.js';
import { StringTable } from '../src/elf/strings.js';
import { relativeRelocations, SHT_ANDROID_RELA, SHT_RELR } from '../src/elf/relocs.js';

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

const CLANG = findTool(['clang', 'clang-18', 'clang-17', 'clang-16']);
const LLD = findTool(['ld.lld', 'ld.lld-18', 'ld.lld-17', 'ld.lld-16']);
const skip = !CLANG || !LLD ? 'clang と ld.lld が必要です' : false;

const MODES = ['none', 'android', 'relr', 'android+relr'];
const VALUES = Array.from({ length: 40 }, (_, i) => `Value${String(i).padStart(2, '0')}`);

function build(dir) {
  const src = [
    'extern void reg(const char* s);',
    `static const char* const names[] = {${VALUES.map((v) => `"${v}"`).join(',')}};`,
    'const char* get(int i){ return names[i]; }',
    // アドレスを外に出さないと、LLVM が配列を再配置なしの相対オフセット表に変換してしまう。
    // Bedrock の enum 名配列は汎用コードに渡るので、ポインタ配列のまま残る
    'const char* const* table(void){ return names; }',
    // 登録は逆順。命令順ではなく配列順が採用されることを確かめる
    `void register_enum(void){ reg("KindEnum");${[...VALUES].reverse().map((v) => `reg("${v}");`).join('')} }`,
    // hidden な大域変数は GOT を通らず adrp + ldr で直接読まれ、中身は相対再配置で埋まる
    '__attribute__((visibility("hidden"))) const char* slot_value = "ViaSlot";',
    'const char* via_slot(void){ return slot_value; }',
  ].join('\n');
  const c = path.join(dir, 'x.c');
  const o = path.join(dir, 'x.o');
  fs.writeFileSync(c, src);
  execFileSync(CLANG, ['--target=aarch64-linux-android21', '-fPIC', '-O2', '-funwind-tables', '-ffreestanding', '-c', c, '-o', o]);
  const out = {};
  for (const m of MODES) {
    out[m] = path.join(dir, `lib_${m.replace('+', '_')}.so`);
    execFileSync(LLD, ['-shared', '--eh-frame-hdr', `--pack-dyn-relocs=${m}`, '-z', 'undefs', '-o', out[m], o]);
  }
  return out;
}

/** 再配置が指す文字列を、再配置先アドレスの順に並べる。形式が違っても同じになるはず */
function normalized(file) {
  const elf = new ElfFile(fs.readFileSync(file));
  const ro = elf.require('.rodata');
  const st = new StringTable(elf.data(ro), Number(ro.addr));
  const relocs = relativeRelocations(elf).sort((a, b) => a.offset - b.offset);
  // 配列部分は 8 バイト間隔で連続しているはず
  const arr = relocs.filter((r) => /^Value/.test(st.resolve(r.addend) ?? ''));
  for (let i = 1; i < arr.length; i++) assert.equal(arr[i].offset - arr[i - 1].offset, 8, `${file}: 配列が連続していない`);
  return relocs.map((r) => st.resolve(r.addend));
}

test('lld が出す 4 形式の再配置を同じ内容に展開する', { skip }, () => {
  const libs = build(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-lld-')));
  const types = (f) => new ElfFile(fs.readFileSync(f)).sections.map((s) => s.type);
  assert.ok(types(libs.android).includes(SHT_ANDROID_RELA), 'android モードで APS2 が出ていない');
  assert.ok(types(libs.relr).includes(SHT_RELR), 'relr モードで RELR が出ていない');

  const base = normalized(libs.none);
  assert.deepEqual(base, [...VALUES, 'ViaSlot']);
  for (const m of MODES) assert.deepEqual(normalized(libs[m]), base, m);
});

test('lld 製の arm64 .so から enum を配列順で復元する', { skip }, () => {
  const libs = build(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-lld-')));
  for (const m of MODES) {
    const p = buildProfile(libs[m], { quiet: true, channel: 'android', version: '0.0.0.1' });
    const e = p.enums.find((x) => x.name === 'KindEnum');
    assert.ok(e, `${m}: KindEnum が取れていない`);
    assert.equal(e.ordered, true, `${m}: 配列で裏が取れていない`);
    assert.deepEqual(e.values, VALUES, m);
    assert.ok(p.stats.codeRefs >= VALUES.length + 1, `${m}: コード参照が少なすぎる (${p.stats.codeRefs})`);
    assert.ok(p.stats.slotRefs >= 1, `${m}: adrp + ldr のスロット参照が拾えていない`);
    assert.ok(p.identifiers.live.includes('ViaSlot'), m);
  }
});
