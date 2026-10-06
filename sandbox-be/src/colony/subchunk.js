// サブチャンク（16x16x16）を解いてブロック名の格子にする。
//
// 値の形:
//   version(1B)  8 または 9（1 は旧い形式: ストレージ 1 つで numStorages の欄なし）
//   numStorages(1B)
//   version 9 のときだけ yIndex(int8)  ← このサブチャンクの y 位置
//   ストレージごとに:
//     header(1B) = (bitsPerBlock << 1) | isRuntime
//     4096 個の添字を uint32 に詰めたもの（下位ビットから、ワードをまたがない）
//     paletteSize(int32LE)
//     paletteSize 個の NBT コンパウンド（LE・ヘッダなし・連続）
//       { name: "minecraft:stone", states: {…}, version: int }
//
// ストレージが 2 つあるのは水没ブロック（layer 1 が水）。layer 0 だけ使う。

const TAG_END = 0, TAG_BYTE = 1, TAG_SHORT = 2, TAG_INT = 3, TAG_LONG = 4,
  TAG_FLOAT = 5, TAG_DOUBLE = 6, TAG_BYTE_ARRAY = 7, TAG_STRING = 8,
  TAG_LIST = 9, TAG_COMPOUND = 10, TAG_INT_ARRAY = 11, TAG_LONG_ARRAY = 12;

/** 位置を持ち歩くリトルエンディアンの NBT リーダ */
class LE {
  constructor(buf, p = 0) { this.b = buf; this.p = p; }
  u8() { return this.b.readUInt8(this.p++); }
  i8() { return this.b.readInt8(this.p++); }
  i16() { const v = this.b.readInt16LE(this.p); this.p += 2; return v; }
  u16() { const v = this.b.readUInt16LE(this.p); this.p += 2; return v; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  i64() { const v = this.b.readBigInt64LE(this.p); this.p += 8; return v; }
  f32() { const v = this.b.readFloatLE(this.p); this.p += 4; return v; }
  f64() { const v = this.b.readDoubleLE(this.p); this.p += 8; return v; }
  str() { const n = this.u16(); const s = this.b.toString('utf8', this.p, this.p + n); this.p += n; return s; }
  payload(t) {
    switch (t) {
      case TAG_BYTE: return this.i8();
      case TAG_SHORT: return this.i16();
      case TAG_INT: return this.i32();
      case TAG_LONG: return this.i64();
      case TAG_FLOAT: return this.f32();
      case TAG_DOUBLE: return this.f64();
      case TAG_BYTE_ARRAY: { const n = this.i32(); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
      case TAG_STRING: return this.str();
      case TAG_LIST: { const et = this.u8(); const n = this.i32(); const a = []; for (let i = 0; i < n; i++) a.push(this.payload(et)); return a; }
      case TAG_COMPOUND: { const o = {}; for (;;) { const tt = this.u8(); if (tt === TAG_END) break; const nm = this.str(); o[nm] = this.payload(tt); } return o; }
      case TAG_INT_ARRAY: { const n = this.i32(); const a = []; for (let i = 0; i < n; i++) a.push(this.i32()); return a; }
      case TAG_LONG_ARRAY: { const n = this.i32(); const a = []; for (let i = 0; i < n; i++) a.push(this.i64()); return a; }
      default: throw new Error(`知らない NBT タグ ${t}`);
    }
  }
  compound() {
    const t = this.u8();
    if (t !== TAG_COMPOUND) throw new Error(`パレットの要素が Compound でない（${t}）`);
    this.str();                       // ルート名（空）
    return this.payload(TAG_COMPOUND);
  }
}

/**
 * サブチャンクの値を解く。
 * → { yIndex, blocks: string[4096], states: (object|null)[4096], palette }
 *   添字は x*256 + z*16 + y（Bedrock の並び順）
 */
export function decodeSubchunk(buf) {
  const r = new LE(buf);
  const version = r.u8();
  if (version !== 1 && version !== 8 && version !== 9) {
    throw new Error(`未対応のサブチャンク形式 version=${version}（1 / 8 / 9 のみ。0・2〜7 は 1.2 より前の形）`);
  }
  const numStorages = version === 1 ? 1 : r.u8();     // 1: ストレージ 1 つ、数の欄なし
  const yIndex = version === 9 ? r.i8() : null;
  if (numStorages === 0) return { yIndex, blocks: null, palette: [] };

  // layer 0 だけ読む（layer 1 は水没情報）
  const header = r.u8();
  const bits = header >> 1;
  if (![0, 1, 2, 3, 4, 5, 6, 8, 16].includes(bits)) throw new Error(`サブチャンクの 1 ブロックのビット数が ${bits}（1〜6・8・16 か 0 のはず）`);
  if (bits === 0) {
    // 全部同じブロック。パレットの数の欄が無い書き方と、ある書き方（1）の両方を読む: 次が Compound(0x0a) なら数の欄なし
    const size = r.b[r.p] === TAG_COMPOUND ? 1 : r.i32();
    const palette = [];
    for (let i = 0; i < size; i++) palette.push(r.compound());
    const name = palette[0]?.name ?? 'minecraft:air';
    return { yIndex, uniform: name, palette, blocks: null };
  }

  const perWord = Math.floor(32 / bits);
  const words = Math.ceil(4096 / perWord);
  const start = r.p;
  r.p += words * 4;
  if (r.p + 4 > buf.length) throw new Error('サブチャンクが途中で切れている');

  const size = r.i32();
  const palette = [];
  for (let i = 0; i < size; i++) palette.push(r.compound());

  const mask = (1 << bits) - 1;
  const blocks = new Array(4096);
  const states = new Array(4096);
  let idx = 0;
  for (let w = 0; w < words && idx < 4096; w++) {
    const word = buf.readUInt32LE(start + w * 4);
    for (let j = 0; j < perWord && idx < 4096; j++, idx++) {
      const pi = (word >>> (bits * j)) & mask;
      const entry = palette[pi];
      blocks[idx] = entry?.name ?? 'minecraft:air';
      states[idx] = entry?.states && Object.keys(entry.states).length ? entry.states : null;
    }
  }
  return { yIndex, blocks, states, palette };
}

/** 添字 → 局所座標 */
export const localOf = (i) => ({ x: (i >> 8) & 15, z: (i >> 4) & 15, y: i & 15 });
export const indexOf = (x, y, z) => (x << 8) | (z << 4) | y;
