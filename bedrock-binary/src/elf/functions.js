// ストリップされたバイナリでも関数の境界は分かる。
// .eh_frame_hdr の二分探索テーブルが、全 FDE の開始アドレスを昇順で持っているため。
// bedrock_server ではこれで約 53 万個の関数が取れる。シンボルは 392 個しか残っていないのに。

import { ElfError } from './reader.js';

const DW_EH_PE_datarel = 0x30;
const DW_EH_PE_sdata4 = 0x0b;

export class FunctionTable {
  constructor(elf) {
    const h = elf.section('.eh_frame_hdr');
    if (!h) throw new ElfError('.eh_frame_hdr がありません。関数境界を復元できません。');
    const d = elf.data(h);
    const base = Number(h.addr);

    const version = d[0];
    if (version !== 1) throw new ElfError(`.eh_frame_hdr の version が ${version} です（1 を想定）`);

    const tableEnc = d[3];
    if (tableEnc !== (DW_EH_PE_datarel | DW_EH_PE_sdata4)) {
      throw new ElfError(`table_enc が 0x${tableEnc.toString(16)} です（0x3b を想定）`);
    }
    // eh_frame_ptr は sdata4|pcrel 前提で読み飛ばし、fde_count(udata4) を取る
    const count = d.readInt32LE(8);
    if (count <= 0 || 12 + count * 8 > d.length) {
      throw new ElfError(`fde_count が不正です: ${count}`);
    }

    this.base = base;
    this.count = count;
    // datarel: テーブルの値は .eh_frame_hdr の仮想アドレスからの相対
    this.starts = new Int32Array(count);
    for (let i = 0; i < count; i++) this.starts[i] = d.readInt32LE(12 + i * 8);
  }

  /** i 番目の関数の開始アドレス */
  addressOf(i) {
    return this.base + this.starts[i];
  }

  /** アドレスを含む関数の番号。見つからなければ -1 */
  indexOf(addr) {
    const v = addr - this.base;
    let lo = 0;
    let hi = this.count - 1;
    let r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (this.starts[m] <= v) {
        r = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return r;
  }
}
