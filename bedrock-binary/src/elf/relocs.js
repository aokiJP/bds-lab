// 相対再配置（読み込みアドレス + addend を書き込むだけのもの）を列挙する。
//
// ポインタ配列の中身はファイル上では 0 で、本当の値は再配置の addend にある。
// 置き場所はビルドによって 3 通りあるので、全部を同じ形 {offset, addend} に揃える。
//
//   .rela.dyn (SHT_RELA)          普通の Elf64_Rela。bedrock_server はこれ
//   .rela.dyn (SHT_ANDROID_RELA)  "APS2" で始まる Android の圧縮形式。NDK の --pack-dyn-relocs=android
//   .relr.dyn (SHT_RELR)          アドレスとビットマップだけの形式。addend はファイル上の値そのもの
//
// Android の .so は後ろ 2 つのどちらかになっていることが多い。

import { SHT } from './reader.js';

export const R_X86_64_RELATIVE = 8;
export const R_AARCH64_RELATIVE = 1027;

export const SHT_RELR = 19;
export const SHT_ANDROID_RELA = 0x60000002;
export const SHT_ANDROID_RELR = 0x6fffff00;

const MACHINE_RELATIVE = { 0x3e: R_X86_64_RELATIVE, 0xb7: R_AARCH64_RELATIVE };

const APS2 = 0x32535041; // "APS2" (LE)
const GROUPED_BY_INFO = 1;
const GROUPED_BY_OFFSET_DELTA = 2;
const GROUPED_BY_ADDEND = 4;
const GROUP_HAS_ADDEND = 8;

export class RelocError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RelocError';
  }
}

/** このアーキテクチャの「相対再配置」の型番号。対象外なら null */
export function relativeTypeFor(machine) {
  return MACHINE_RELATIVE[machine] ?? null;
}

/**
 * ELF 内の相対再配置をすべて {offset, addend} で返す（順不同）。
 * @param {import('./reader.js').ElfFile} elf
 */
export function relativeRelocations(elf) {
  const type = relativeTypeFor(elf.machine);
  if (type === null) return [];
  const out = [];
  for (const s of elf.sections) {
    if (s.size === 0) continue;
    if (s.type === SHT.RELA && s.entsize !== 0 && s.entsize !== 24) {
      throw new RelocError(`${s.name}: RELA の entsize が ${s.entsize} です（24 を想定）`);
    }
    if (s.type === SHT.RELA) readRela(elf.data(s), type, out);
    else if (s.type === SHT_ANDROID_RELA) readAndroidPacked(elf.data(s), type, out, s.name);
    else if (s.type === SHT_RELR || s.type === SHT_ANDROID_RELR) readRelr(elf, elf.data(s), out);
  }
  return out;
}

function readRela(d, type, out) {
  const n = Math.floor(d.length / 24);
  for (let i = 0; i < n; i++) {
    const o = i * 24;
    // r_info の下位 32 ビットが型。シンボル番号（上位）は相対再配置では 0
    if (d.readUInt32LE(o + 8) !== type) continue;
    out.push({ offset: Number(d.readBigUInt64LE(o)), addend: Number(d.readBigInt64LE(o + 16)) });
  }
}

/** SLEB128 を Number で読む。値は 2^53 に収まる前提（アドレスと addend なので十分） */
export class Sleb128Reader {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  next() {
    let result = 0;
    let mul = 1;
    let byte;
    do {
      if (this.pos >= this.buf.length) throw new RelocError('SLEB128 がセクション末尾で途切れています');
      byte = this.buf[this.pos++];
      result += (byte & 0x7f) * mul;
      mul *= 128;
      if (mul > 2 ** 70) throw new RelocError('SLEB128 が長すぎます');
    } while (byte & 0x80);
    if (byte & 0x40) result -= mul;
    return result;
  }
}

/** bionic の packed_reloc_iterator と同じ手順で展開する */
export function readAndroidPacked(d, type, out, name = '.rela.dyn') {
  if (d.length < 4 || d.readUInt32LE(0) !== APS2) {
    throw new RelocError(`${name}: APS2 マジックがありません（APS1 など REL 形式は未対応）`);
  }
  const r = new Sleb128Reader(d, 4);
  const total = r.next();
  if (total < 0 || total > 1e8) throw new RelocError(`${name}: 再配置数が不正です: ${total}`);
  let offset = r.next();
  let info = 0;
  let addend = 0;
  let done = 0;

  while (done < total) {
    const groupSize = r.next();
    const flags = r.next();
    if (groupSize <= 0) throw new RelocError(`${name}: グループの大きさが不正です: ${groupSize}`);
    const byOffset = (flags & GROUPED_BY_OFFSET_DELTA) !== 0;
    const byInfo = (flags & GROUPED_BY_INFO) !== 0;
    const hasAddend = (flags & GROUP_HAS_ADDEND) !== 0;
    const byAddend = (flags & GROUPED_BY_ADDEND) !== 0;

    const offsetDelta = byOffset ? r.next() : 0;
    if (byInfo) info = r.next();
    if (hasAddend && byAddend) addend += r.next();
    else if (!hasAddend) addend = 0;

    for (let i = 0; i < groupSize; i++) {
      offset += byOffset ? offsetDelta : r.next();
      if (!byInfo) info = r.next();
      if (hasAddend && !byAddend) addend += r.next();
      // r_info は 64 ビット。下位 32 ビットが型
      if (info % 2 ** 32 === type) out.push({ offset, addend });
    }
    done += groupSize;
  }
}

/** RELR。addend は再配置先に書かれている値そのもの */
export function readRelr(elf, d, out) {
  const n = Math.floor(d.length / 8);
  let base = 0;
  const push = (addr) => {
    const fo = elf.offsetOf(addr);
    if (fo === null || fo + 8 > elf.buf.length) return;
    out.push({ offset: addr, addend: Number(elf.buf.readBigUInt64LE(fo)) });
  };
  for (let i = 0; i < n; i++) {
    const word = d.readBigUInt64LE(i * 8);
    if ((word & 1n) === 0n) {
      const addr = Number(word);
      push(addr);
      base = addr + 8;
    } else {
      let bits = word >> 1n;
      for (let j = 0; bits !== 0n; j++, bits >>= 1n) {
        if (bits & 1n) push(base + j * 8);
      }
      base += 63 * 8;
    }
  }
}
