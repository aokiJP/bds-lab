/**
 * 最小限のNBTパーサ。level.dat から世界名・バージョン・ゲームモード等を読む。
 *
 * Java版   : gzip圧縮 + ビッグエンディアン
 * 統合版   : 無圧縮 + リトルエンディアン + 先頭8バイトのヘッダ
 *            (version:int32, length:int32) が付く
 */
import zlib from 'node:zlib';

const TAG = {
  END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6,
  BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12,
};

class Reader {
  constructor(buf, little) { this.b = buf; this.p = 0; this.le = little; }
  u8() { return this.b.readUInt8(this.p++); }
  i8() { return this.b.readInt8(this.p++); }
  i16() { const v = this.le ? this.b.readInt16LE(this.p) : this.b.readInt16BE(this.p); this.p += 2; return v; }
  u16() { const v = this.le ? this.b.readUInt16LE(this.p) : this.b.readUInt16BE(this.p); this.p += 2; return v; }
  i32() { const v = this.le ? this.b.readInt32LE(this.p) : this.b.readInt32BE(this.p); this.p += 4; return v; }
  i64() { const v = this.le ? this.b.readBigInt64LE(this.p) : this.b.readBigInt64BE(this.p); this.p += 8; return v; }
  f32() { const v = this.le ? this.b.readFloatLE(this.p) : this.b.readFloatBE(this.p); this.p += 4; return v; }
  f64() { const v = this.le ? this.b.readDoubleLE(this.p) : this.b.readDoubleBE(this.p); this.p += 8; return v; }
  str() { const n = this.u16(); const s = this.b.toString('utf8', this.p, this.p + n); this.p += n; return s; }
}

function readPayload(r, type) {
  switch (type) {
    case TAG.BYTE: return r.i8();
    case TAG.SHORT: return r.i16();
    case TAG.INT: return r.i32();
    case TAG.LONG: return r.i64();
    case TAG.FLOAT: return r.f32();
    case TAG.DOUBLE: return r.f64();
    case TAG.BYTE_ARRAY: { const n = r.i32(); const v = r.b.subarray(r.p, r.p + n); r.p += n; return v; }
    case TAG.STRING: return r.str();
    case TAG.LIST: {
      const t = r.u8(); const n = r.i32(); const out = [];
      for (let i = 0; i < n; i++) out.push(readPayload(r, t));
      return out;
    }
    case TAG.COMPOUND: {
      const o = {};
      for (;;) {
        const t = r.u8();
        if (t === TAG.END) break;
        const name = r.str();
        o[name] = readPayload(r, t);
      }
      return o;
    }
    case TAG.INT_ARRAY: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i32()); return a; }
    case TAG.LONG_ARRAY: { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.i64()); return a; }
    default: throw new Error(`未知のNBTタグ ${type}`);
  }
}

/** level.dat の Buffer を渡すと {edition, data} を返す */
export function parseLevelDat(buf) {
  // 統合版を先に見る: 先頭 4 バイトの版は今 10（= 0x0a）で、Java の無圧縮（先頭が Compound の 0x0a）と見分けがつかない。
  // 2 つ目の int32 が残りの長さと合い、9 バイト目が Compound なら統合版
  if (buf.length > 8 && buf[8] === 0x0a && buf.readInt32LE(4) === buf.length - 8) {
    return { edition: 'bedrock', storageVersion: buf.readInt32LE(0), data: parseRoot(buf.subarray(8), true) };
  }
  // Java: gzip (1f 8b) または zlib (78 xx)
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    return { edition: 'java', data: parseRoot(zlib.gunzipSync(buf), false) };
  }
  if (buf[0] === 0x78) {
    return { edition: 'java', data: parseRoot(zlib.inflateSync(buf), false) };
  }
  // Java無圧縮
  if (buf[0] === 0x0a) {
    return { edition: 'java', data: parseRoot(buf, false) };
  }
  // 統合版（長さの欄が合わないもの: 書きかけ・手で直したもの）: 8バイトヘッダのあとに TAG_Compound(0x0a)
  if (buf.length > 8 && buf[8] === 0x0a) {
    const storageVersion = buf.readInt32LE(0);
    return { edition: 'bedrock', storageVersion, data: parseRoot(buf.subarray(8), true) };
  }
  throw new Error('level.dat を判別できない');
}

function parseRoot(buf, little) {
  const r = new Reader(buf, little);
  const t = r.u8();
  if (t !== TAG.COMPOUND) throw new Error('ルートがCompoundでない');
  r.str();                       // ルート名 (通常は空)
  return readPayload(r, TAG.COMPOUND);
}

/** level.dat の中身から人が読む用の要約を作る */
export function summarize(parsed) {
  const d = parsed.data;
  if (parsed.edition === 'bedrock') {
    return {
      edition: 'bedrock',
      name: d.LevelName ?? null,
      version: Array.isArray(d.lastOpenedWithVersion) ? d.lastOpenedWithVersion.join('.') : null,
      gameMode: ['サバイバル', 'クリエイティブ', 'アドベンチャー', 'スペクテイター'][d.GameType] ?? d.GameType,
      difficulty: ['ピースフル', 'イージー', 'ノーマル', 'ハード'][d.Difficulty] ?? d.Difficulty,
      seed: d.RandomSeed != null ? String(d.RandomSeed) : null,
      lastPlayed: d.LastPlayed != null ? new Date(Number(d.LastPlayed) * 1000).toISOString() : null,
      commands: d.commandsEnabled === 1,
      experiments: d.experiments ? Object.keys(d.experiments).filter((k) => d.experiments[k] === 1) : [],
      spawn: [d.SpawnX, d.SpawnY, d.SpawnZ],
    };
  }
  const D = d.Data || d;
  return {
    edition: 'java',
    name: D.LevelName ?? null,
    version: D.Version?.Name ?? (D.DataVersion != null ? `DataVersion ${D.DataVersion}` : null),
    dataVersion: D.DataVersion ?? null,
    gameMode: ['サバイバル', 'クリエイティブ', 'アドベンチャー', 'スペクテイター'][D.GameType] ?? D.GameType,
    difficulty: ['ピースフル', 'イージー', 'ノーマル', 'ハード'][D.Difficulty] ?? D.Difficulty,
    seed: D.WorldGenSettings?.seed != null ? String(D.WorldGenSettings.seed) : null,
    lastPlayed: D.LastPlayed != null ? new Date(Number(D.LastPlayed)).toISOString() : null,
    spawn: [D.SpawnX, D.SpawnY, D.SpawnZ],
  };
}
