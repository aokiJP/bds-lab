// AArch64 の .text から「どの命令がどのアドレスを指しているか」を拾う。
//
// x86-64 の RIP 相対 1 命令 (lea/mov) に相当するのが、arm64 では 2 命令の組になる。
//
//   adrp x8, page          ; x8 = (pc & ~0xfff) + imm21 << 12
//   add  x8, x8, #lo12     ; x8 = page + lo12            → 文字列そのもの
//   ldr  x9, [x8, #lo12]   ; x9 = *(page + lo12)         → ポインタ表のスロット経由
//   adr  x0, label         ; x0 = pc + imm21             → ±1 MB 内の直接参照
//
// 命令長は 4 バイト固定なので、x86 と違って命令境界を推測する必要はない。
// レジスタごとに直近の adrp を覚えておき、後続の add / ldr と組み合わせる。
//
// 限界: adrp と add の間に同じレジスタを書き換える別命令が挟まると、古いページで
// 誤って組み合わせる可能性がある。これを抑えるため
//   - 組み合わせる距離を WINDOW 命令以内に制限する
//   - 関数境界（.eh_frame_hdr）をまたいだら状態を捨てる
//   - 解決先が文字列の範囲に入らなければ捨てる（呼び出し側）
// の 3 段で絞っている。

export const WINDOW = 16;

const OP_ADRP_MASK = 0x9f000000;
const OP_ADRP = 0x90000000;
const OP_ADR = 0x10000000;
const OP_ADD_X_IMM_MASK = 0xff800000; // sf=1, op=0, S=0, 100010, sh は bit 22
const OP_ADD_X_IMM = 0x91000000;
const OP_LDR_X_UIMM_MASK = 0xffc00000;
const OP_LDR_X_UIMM = 0xf9400000;

const PAGE = 4096;

/** imm21 (immhi:immlo) を符号付きで取り出す */
function imm21(insn) {
  const immlo = (insn >>> 29) & 0x3;
  const immhi = (insn >>> 5) & 0x7ffff;
  const v = immhi * 4 + immlo;
  return v >= 0x100000 ? v - 0x200000 : v;
}

export function decodeAdrp(insn, pc) {
  if (((insn & OP_ADRP_MASK) >>> 0) !== OP_ADRP) return null;
  return { rd: insn & 0x1f, page: Math.floor(pc / PAGE) * PAGE + imm21(insn) * PAGE };
}

export function decodeAdr(insn, pc) {
  if (((insn & OP_ADRP_MASK) >>> 0) !== OP_ADR) return null;
  return { rd: insn & 0x1f, target: pc + imm21(insn) };
}

export function decodeAddImm(insn) {
  if (((insn & OP_ADD_X_IMM_MASK) >>> 0) !== OP_ADD_X_IMM) return null;
  const shift = (insn >>> 22) & 1;
  const imm12 = (insn >>> 10) & 0xfff;
  return { rd: insn & 0x1f, rn: (insn >>> 5) & 0x1f, imm: shift ? imm12 * PAGE : imm12, shifted: shift === 1 };
}

export function decodeLdrImm(insn) {
  if (((insn & OP_LDR_X_UIMM_MASK) >>> 0) !== OP_LDR_X_UIMM) return null;
  return { rt: insn & 0x1f, rn: (insn >>> 5) & 0x1f, imm: ((insn >>> 10) & 0xfff) * 8 };
}

/**
 * .text を走査して参照を報告する。
 *
 * @param {Buffer} buf ファイル全体
 * @param {{offset:number, size:number, addr:number}} text
 * @param {{count:number, addressOf:(i:number)=>number}|null} functions 関数境界。null なら境界リセットなし
 * @param {(kind:'addr'|'slot', target:number, pc:number, func:number)=>void} onRef
 * @param {{onProgress?:(ratio:number)=>void}} [opts]
 */
export function scanArm64(buf, text, functions, onRef, opts = {}) {
  const { onProgress } = opts;
  const count = Math.floor(text.size / 4);
  const pageVal = new Float64Array(32);
  const pageAt = new Int32Array(32).fill(-0x7fffffff);

  // 関数境界を先頭から順に追う。.eh_frame_hdr のテーブルは昇順なので二分探索は要らない
  let func = -1;
  let nextStart = functions && functions.count > 0 ? functions.addressOf(0) : Infinity;
  const advance = (pc) => {
    while (pc >= nextStart) {
      func++;
      nextStart = func + 1 < functions.count ? functions.addressOf(func + 1) : Infinity;
      pageAt.fill(-0x7fffffff);
    }
  };

  const progressStep = Math.max(1, Math.floor(count / 20));

  for (let k = 0; k < count; k++) {
    const pc = text.addr + k * 4;
    if (pc >= nextStart) advance(pc);
    const insn = buf.readUInt32LE(text.offset + k * 4);
    const top = (insn >>> 24) & 0xff;

    // 先頭バイトで大半を即座に弾く。対象命令の上位バイトは限られている
    if ((top & 0x9f) === 0x90) {
      const a = decodeAdrp(insn, pc);
      pageVal[a.rd] = a.page;
      pageAt[a.rd] = k;
    } else if ((top & 0x9f) === 0x10) {
      const a = decodeAdr(insn, pc);
      pageAt[a.rd] = -0x7fffffff;
      onRef('addr', a.target, pc, func);
    } else if (top === 0x91) {
      const a = decodeAddImm(insn);
      if (a && k - pageAt[a.rn] <= WINDOW) {
        const target = pageVal[a.rn] + a.imm;
        if (a.shifted) {
          // add x8, x8, #hi, lsl #12 → さらに下位の add が続く形。途中値として持ち回る
          pageVal[a.rd] = target;
          pageAt[a.rd] = k;
        } else {
          pageAt[a.rd] = -0x7fffffff;
          onRef('addr', target, pc, func);
        }
      } else if (a) {
        pageAt[a.rd] = -0x7fffffff;
      }
    } else if (top === 0xf9) {
      const a = decodeLdrImm(insn);
      if (a) {
        if (k - pageAt[a.rn] <= WINDOW) onRef('slot', pageVal[a.rn] + a.imm, pc, func);
        pageAt[a.rt] = -0x7fffffff;
      }
    }

    if (onProgress && k % progressStep === 0) onProgress(k / count);
  }
}
