// 「どの関数がどの文字列を、どの順で参照しているか」を求める。
//
// これが本体。.rodata を眺めるだけでは文字列は 12 万件のスープでしかないが、
// 参照元の関数でまとめると、コンパイラが散らしたはずの意味のまとまりが戻ってくる。
//
// 拾う経路は 2 つ。
//  1. .text の PC 相対参照。命令の並び順 = 元の記述順
//       x86-64  : lea / mov [rip+disp32]
//       aarch64 : adrp + add / adrp + ldr / adr（src/elf/arm64.js）
//  2. 相対再配置。読み込み時に埋まるポインタ表（src/elf/relocs.js）
//       .rela.dyn / Android 圧縮 (APS2) / .relr.dyn のどれでも同じ形で扱う

import { scanArm64 } from '../elf/arm64.js';
import { relativeRelocations } from '../elf/relocs.js';

export const ARCH = { X86_64: 0x3e, AARCH64: 0xb7 };

export class XrefError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XrefError';
  }
}

export class XrefIndex {
  /**
   * @param {import('../elf/reader.js').ElfFile} elf
   * @param {import('../elf/strings.js').StringTable} strings
   * @param {import('../elf/functions.js').FunctionTable} functions
   */
  constructor(elf, strings, functions, { onProgress } = {}) {
    this.elf = elf;
    this.strings = strings;
    this.functions = functions;

    /** @type {Map<number, string[]>} 関数番号 → 参照した文字列（出現順・重複なし） */
    this.byFunction = new Map();
    /** @type {Set<string>} コードまたはポインタ表から参照された文字列 */
    this.referenced = new Set();
    /** @type {Array<{offset:number,value:string}>} 再配置経由のポインタ（アドレス順） */
    this.pointers = [];
    /** 経路ごとの件数。arm64 の検出が妥当かを見るのに使う */
    this.counts = { code: 0, viaSlot: 0, relocations: 0 };

    // arm64 の ldr はスロット経由で文字列を読むので、再配置を先に集めておく
    this.#scanRelocations();
    if (elf.machine === ARCH.X86_64) this.#scanX86(onProgress);
    else if (elf.machine === ARCH.AARCH64) this.#scanArm64(onProgress);
    else throw new XrefError(`${elf.machineName} の命令走査は未対応です（x86-64 と aarch64 のみ）`);
  }

  #record(func, value) {
    this.referenced.add(value);
    if (func < 0) return;
    let list = this.byFunction.get(func);
    if (!list) this.byFunction.set(func, (list = []));
    // 同じ関数が同じ文字列を何度も読むことはあるので、初出だけ残して順序を保つ
    if (!list.includes(value)) list.push(value);
  }

  #scanX86(onProgress) {
    const { buf } = this.elf;
    const text = this.elf.section('.text');
    if (!text) return;
    const off = text.offset;
    const addr = Number(text.addr);
    const end = off + text.size - 7;
    const step = Math.max(1, Math.floor(text.size / 20));

    for (let i = off; i < end; i++) {
      if (onProgress && (i - off) % step === 0) onProgress((i - off) / text.size);
      // REX (0x48-0x4f) + opcode + ModRM(mod=00, rm=101) + disp32
      const rex = buf[i];
      if (rex < 0x48 || rex > 0x4f) continue;
      const op = buf[i + 1];
      if (op !== 0x8d && op !== 0x8b) continue; // lea / mov r64, [rip+d]
      if ((buf[i + 2] & 0xc7) !== 0x05) continue;

      const insn = addr + (i - off);
      const value = this.strings.resolve(insn + 7 + buf.readInt32LE(i + 3));
      if (value === undefined || value.length < 2) continue;
      this.counts.code++;
      this.#record(this.functions.indexOf(insn), value);
    }
  }

  #scanArm64(onProgress) {
    const text = this.elf.section('.text');
    if (!text) return;
    const slots = new Map(this.pointers.map((p) => [p.offset, p.value]));
    scanArm64(
      this.elf.buf,
      { offset: text.offset, size: text.size, addr: Number(text.addr) },
      this.functions,
      (kind, target, _pc, func) => {
        let value;
        if (kind === 'addr') {
          value = this.strings.resolve(target);
          if (value === undefined || value.length < 2) return;
          this.counts.code++;
        } else {
          value = slots.get(target);
          if (value === undefined) return;
          this.counts.viaSlot++;
        }
        this.#record(func, value);
      },
      { onProgress },
    );
  }

  #scanRelocations() {
    for (const { offset, addend } of relativeRelocations(this.elf)) {
      const value = this.strings.resolve(addend);
      if (value === undefined || value.length < 2) continue;
      this.pointers.push({ offset, value });
      this.referenced.add(value);
    }
    this.pointers.sort((a, b) => a.offset - b.offset);
    this.counts.relocations = this.pointers.length;
  }

  /** 参照されていない文字列（デッドコード由来）を列挙する */
  deadStrings() {
    const dead = [];
    for (const { value } of this.strings.entries()) {
      if (!this.referenced.has(value)) dead.push(value);
    }
    return dead;
  }

  stats() {
    return {
      strings: this.strings.size,
      referenced: this.referenced.size,
      functionsWithStrings: this.byFunction.size,
      relocPointers: this.pointers.length,
      codeRefs: this.counts.code,
      slotRefs: this.counts.viaSlot,
    };
  }
}
