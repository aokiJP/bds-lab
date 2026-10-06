// .rodata の文字列を「アドレスで引ける表」にする。
//
// 肝は末尾マージへの対応。リンカは -fmerge-constants で "SubClientLogin" と "Login" を
// 一本化し、後者へのポインタは前者の途中を指す。素直に start アドレスだけ引くと、
// そういう値が丸ごと取りこぼされる（実際 MinecraftPacketIds の Login / Disconnect / Text が消えた）。

export class StringTable {
  /**
   * @param {Buffer} data セクションの中身
   * @param {number} baseAddr そのセクションの仮想アドレス
   */
  constructor(data, baseAddr, { minLength = 1 } = {}) {
    this.base = baseAddr;
    this.values = [];
    this.offsets = [];

    let start = -1;
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      const printable = c >= 0x20 && c <= 0x7e;
      if (printable) {
        if (start < 0) start = i;
        continue;
      }
      // 終端は NUL のみ。バッファ末尾を終端扱いにすると境界で切れた断片を拾う
      if (start >= 0 && c === 0x00 && i - start >= minLength) {
        this.offsets.push(start);
        this.values.push(data.toString('latin1', start, i));
      }
      start = -1;
    }
    this.starts = Int32Array.from(this.offsets);
  }

  get size() {
    return this.values.length;
  }

  /** 文字列の開始アドレスを列挙する */
  *entries() {
    for (let i = 0; i < this.values.length; i++) {
      yield { addr: this.base + this.starts[i], value: this.values[i] };
    }
  }

  /**
   * アドレスを文字列に解決する。
   * 途中を指していれば、そこから末尾までを返す（末尾マージされた値はこれで拾える）。
   */
  resolve(addr) {
    const off = addr - this.base;
    if (off < 0) return undefined;
    const i = this.#floor(off);
    if (i < 0) return undefined;
    const s = this.starts[i];
    const v = this.values[i];
    if (off > s + v.length) return undefined; // 文字列と文字列の隙間
    return off === s ? v : v.slice(off - s);
  }

  /** そのアドレスがちょうど文字列の先頭かどうか */
  isStart(addr) {
    const off = addr - this.base;
    const i = this.#floor(off);
    return i >= 0 && this.starts[i] === off;
  }

  #floor(off) {
    let lo = 0;
    let hi = this.starts.length - 1;
    let r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (this.starts[m] <= off) {
        r = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return r;
  }
}
