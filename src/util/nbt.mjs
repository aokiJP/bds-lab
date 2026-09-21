const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTES: 7, STRING: 8, LIST: 9, COMPOUND: 10, INTS: 11, LONGS: 12 };

class Reader {
  constructor(buf) { this.b = buf; this.i = 0; }
  u8() { return this.b.readUInt8(this.i++); }
  i8() { return this.b.readInt8(this.i++); }
  i16() { const v = this.b.readInt16LE(this.i); this.i += 2; return v; }
  i32() { const v = this.b.readInt32LE(this.i); this.i += 4; return v; }
  i64() { const v = this.b.readBigInt64LE(this.i); this.i += 8; return v; }
  f32() { const v = this.b.readFloatLE(this.i); this.i += 4; return v; }
  f64() { const v = this.b.readDoubleLE(this.i); this.i += 8; return v; }
  str() { const n = this.b.readUInt16LE(this.i); this.i += 2; const s = this.b.toString('utf8', this.i, this.i + n); this.i += n; return s; }
  payload(type) {
    switch (type) {
      case T.BYTE: return this.i8();
      case T.SHORT: return this.i16();
      case T.INT: return this.i32();
      case T.LONG: return this.i64();
      case T.FLOAT: return this.f32();
      case T.DOUBLE: return this.f64();
      case T.BYTES: { const n = this.i32(); const v = this.b.subarray(this.i, this.i + n); this.i += n; return Buffer.from(v); }
      case T.STRING: return this.str();
      case T.LIST: { const t = this.u8(); const n = this.i32(); const v = []; for (let k = 0; k < n; k++) v.push({ type: t, value: this.payload(t) }); return { type: t, value: v }; }
      case T.COMPOUND: {
        const out = {};
        for (;;) {
          const t = this.u8();
          if (t === T.END) break;
          const name = this.str();
          out[name] = { type: t, value: this.payload(t) };
        }
        return out;
      }
      case T.INTS: { const n = this.i32(); const v = []; for (let k = 0; k < n; k++) v.push(this.i32()); return v; }
      case T.LONGS: { const n = this.i32(); const v = []; for (let k = 0; k < n; k++) v.push(this.i64()); return v; }
      default: throw new Error(`知らない NBT の型: ${type}`);
    }
  }
}

class Writer {
  constructor() { this.parts = []; }
  push(b) { this.parts.push(b); }
  u8(v) { const b = Buffer.alloc(1); b.writeUInt8(v); this.push(b); }
  i8(v) { const b = Buffer.alloc(1); b.writeInt8(v); this.push(b); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16LE(v); this.push(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.push(b); }
  i64(v) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); this.push(b); }
  f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v); this.push(b); }
  f64(v) { const b = Buffer.alloc(8); b.writeDoubleLE(v); this.push(b); }
  str(s) { const t = Buffer.from(s, 'utf8'); const b = Buffer.alloc(2); b.writeUInt16LE(t.length); this.push(b); this.push(t); }
  payload(type, value) {
    switch (type) {
      case T.BYTE: return this.i8(value);
      case T.SHORT: return this.i16(value);
      case T.INT: return this.i32(value);
      case T.LONG: return this.i64(value);
      case T.FLOAT: return this.f32(value);
      case T.DOUBLE: return this.f64(value);
      case T.BYTES: { this.i32(value.length); return this.push(Buffer.from(value)); }
      case T.STRING: return this.str(value);
      case T.LIST: {
        this.u8(value.type);
        this.i32(value.value.length);
        for (const e of value.value) this.payload(value.type, e?.value !== undefined ? e.value : e);
        return undefined;
      }
      case T.COMPOUND: {
        for (const [name, tv] of Object.entries(value)) { this.u8(tv.type); this.str(name); this.payload(tv.type, tv.value); }
        return this.u8(T.END);
      }
      case T.INTS: { this.i32(value.length); for (const v of value) this.i32(v); return undefined; }
      case T.LONGS: { this.i32(value.length); for (const v of value) this.i64(v); return undefined; }
      default: throw new Error(`知らない NBT の型: ${type}`);
    }
  }
  done() { return Buffer.concat(this.parts); }
}

/** level.dat（先頭 8 バイトの見出し + 無圧縮 little-endian NBT）を読む */
export function readLevelDat(buf) {
  const version = buf.readInt32LE(0);
  const r = new Reader(buf.subarray(8));
  const type = r.u8();
  const name = r.str();
  return { version, name, type, value: r.payload(type) };
}

export function writeLevelDat({ version, name, type, value }) {
  const w = new Writer();
  w.u8(type);
  w.str(name);
  w.payload(type, value);
  const body = w.done();
  const head = Buffer.alloc(8);
  head.writeInt32LE(version, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

export const TAG = T;
