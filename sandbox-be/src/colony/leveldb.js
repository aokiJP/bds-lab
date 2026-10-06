// Bedrock の db/ を読む最小の LevelDB リーダ。依存ゼロ（node:zlib のみ）。
//
// 読むもの:
//   *.ldb / *.sst   … SST テーブル（確定したデータ）
//   *.log           … 書き込みログ（まだテーブルに落ちていない分）
//
// MANIFEST は読まない。テーブルとログを全部読み、キーごとに通し番号（sequence）がいちばん大きいものを取る。
// LevelDB 自身と同じ決め方なので、どのファイルが新しいかを名前から推す必要がない。削除の印も同じ番号で比べる。
//
// SST の形（LevelDB の table_format）:
//   ... データブロック ... メタインデックス インデックス フッタ(48B)
//   フッタ: metaindex ハンドル(varint offset,size) index ハンドル 詰め物 マジック8B
//   ブロック: 中身 + 圧縮種別(1B) + crc32c(4B)
//   ブロックの中身: エントリ列 + リスタート配列(uint32*n) + n(uint32)
//   エントリ: varint 共有長, varint 非共有長, varint 値長, キー差分, 値
//   テーブルのキーは「内部キー」: 利用者のキー + 8 バイト（通し番号 << 8 | 種別。種別 1=値 0=削除）
//
// 圧縮種別（Mojang の leveldb-mcpe）: 0=無圧縮 1=snappy 2=zlib 4=zlib raw（今の Bedrock はこれ）。
//   3 は版によって zstd。種別の番号を信じ切らず、合わなければ他の解き方も順に試す。
//   （2026-10 に BDS 1.26.52.3 が書いたテーブルで確かめた: インデックスは 4 = raw deflate）

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- varint

function uvarint(buf, p) {
  let x = 0, shift = 0;
  for (;;) {
    const b = buf[p++];
    if (b === undefined) throw new Error('varint が途中で切れている');
    x += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) break;
    shift += 7;
    if (shift > 63) throw new Error('varint が長すぎる');
  }
  return [x, p];
}

// ---------------------------------------------------------------- 展開

/** snappy（生の形式。LevelDB のブロックはフレームなし）を解く */
export function snappyDecompress(src) {
  let [len, p] = uvarint(src, 0);
  const out = Buffer.alloc(len);
  let o = 0;
  while (p < src.length) {
    const tag = src[p++], kind = tag & 3;
    if (kind === 0) {                                   // 文字列そのまま
      let n = tag >> 2;
      if (n >= 60) { const k = n - 59; n = src.readUIntLE(p, k); p += k; }
      n += 1;
      if (p + n > src.length || o + n > len) throw new Error('snappy: 文字列が範囲外');
      src.copy(out, o, p, p + n); p += n; o += n;
      continue;
    }
    let n, off;
    if (kind === 1) { n = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[p++]; }
    else if (kind === 2) { n = (tag >> 2) + 1; off = src.readUInt16LE(p); p += 2; }
    else { n = (tag >> 2) + 1; off = src.readUInt32LE(p); p += 4; }
    if (!off || off > o || o + n > len) throw new Error('snappy: 参照が範囲外');
    for (let i = 0; i < n; i++, o++) out[o] = out[o - off];   // 重なりうるので 1 バイトずつ
  }
  if (o !== len) throw new Error('snappy: 長さが合わない');
  return out;
}

const zstd = (b) => {
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('zstd（この Node では解けない。Node 22.15+ が要る）');
  return zlib.zstdDecompressSync(b);
};
const ORDER = {
  2: [zlib.inflateSync, zlib.inflateRawSync, zstd],
  3: [zstd, zlib.inflateRawSync, zlib.inflateSync],
  4: [zlib.inflateRawSync, zlib.inflateSync, zstd],
};
export function decompress(body, type) {
  if (type === 0) return body;
  if (type === 1) return snappyDecompress(body);
  const ways = ORDER[type];
  if (!ways) throw new Error(`知らない圧縮種別 ${type}`);
  let first;
  for (const f of ways) { try { return f(body); } catch (e) { first ??= e; } }
  throw new Error(`圧縮種別 ${type} のブロックを解けない（${first.message}）`);
}

/** ブロックハンドル（offset,size）の位置から中身を取り出す */
function readBlock(buf, offset, size) {
  if (offset + size + 5 > buf.length) throw new Error(`ブロック(${offset}+${size}) がファイルの外`);
  return decompress(buf.subarray(offset, offset + size), buf[offset + size]);   // crc32c は検証しない（壊れていれば展開で落ちる）
}

/** ブロックの中身をエントリに分解する → [{key:Buffer, value:Buffer}] */
function parseBlockEntries(block) {
  if (block.length < 4) return [];
  const numRestarts = block.readUInt32LE(block.length - 4);
  const restartsAt = block.length - 4 - numRestarts * 4;
  if (restartsAt < 0) throw new Error('ブロックのリスタート配列が壊れている');
  const out = [];
  let p = 0;
  let prev = Buffer.alloc(0);
  while (p < restartsAt) {
    let shared, nonShared, valLen;
    [shared, p] = uvarint(block, p);
    [nonShared, p] = uvarint(block, p);
    [valLen, p] = uvarint(block, p);
    if (shared > prev.length || p + nonShared + valLen > restartsAt) throw new Error('ブロックのエントリが壊れている');
    const key = Buffer.concat([prev.subarray(0, shared), block.subarray(p, p + nonShared)]);
    p += nonShared;
    const value = block.subarray(p, p + valLen);
    p += valLen;
    out.push({ key, value });
    prev = key;
  }
  return out;
}

const MAGIC = Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);

/** 内部キー → { key（利用者のキー）, seq（BigInt）, del } */
export function splitInternalKey(ikey) {
  if (ikey.length < 8) throw new Error('内部キーが短すぎる');
  const t = ikey.readBigUInt64LE(ikey.length - 8);
  return { key: ikey.subarray(0, ikey.length - 8), seq: t >> 8n, del: (t & 0xffn) === 0n };
}

/** SST テーブル1つを全部読む → [{key, value, seq, del}]（key は利用者のキー） */
export function readTable(buf) {
  if (buf.length < 48) throw new Error('SST が短すぎる');
  const footer = buf.subarray(buf.length - 48);
  if (!footer.subarray(40).equals(MAGIC)) throw new Error('SST のマジックが合わない');

  let p = 0;
  let idxOff, idxSize;
  [, p] = uvarint(footer, p);           // metaindex（フィルタ。使わない）
  [, p] = uvarint(footer, p);
  [idxOff, p] = uvarint(footer, p);
  [idxSize, p] = uvarint(footer, p);

  const index = parseBlockEntries(readBlock(buf, idxOff, idxSize));
  const out = [];
  for (const e of index) {
    let q = 0, off, size;
    [off, q] = uvarint(e.value, q);
    [size, q] = uvarint(e.value, q);
    let block;
    try { block = readBlock(buf, off, size); }
    catch (err) { throw new Error(`データブロック(${off}) を読めない: ${err.message}`); }
    for (const kv of parseBlockEntries(block)) out.push({ ...splitInternalKey(kv.key), value: kv.value });
  }
  return out;
}

// ---------------------------------------------------------------- .log

/**
 * 書き込みログを読む。
 *   32KB ブロックごと。レコード: crc32(4) 長さ(2) 種別(1) 中身
 *   種別 1=単体 2=先頭 3=中 4=末尾
 * 組み上がったレコードは WriteBatch:
 *   seq(8) count(4) [ 種別(1) キー(varstring) [値(varstring)] ]*   … i 番目の操作の通し番号は seq + i
 * → [{key, value, seq, del}]
 */
export function readLog(buf) {
  const BLOCK = 32768;
  const records = [];
  let acc = [];
  for (let base = 0; base < buf.length; base += BLOCK) {
    const end = Math.min(base + BLOCK, buf.length);
    let p = base;
    while (p + 7 <= end) {
      const len = buf.readUInt16LE(p + 4);
      const type = buf[p + 6];
      if (type === 0 && len === 0) break;             // 詰め物
      if (p + 7 + len > end) break;                   // 壊れている（書きかけ）
      const data = buf.subarray(p + 7, p + 7 + len);
      if (type === 1) records.push(data);
      else if (type === 2) acc = [data];
      else if (type === 3) acc.push(data);
      else if (type === 4) { acc.push(data); records.push(Buffer.concat(acc)); acc = []; }
      p += 7 + len;
    }
  }

  const out = [];
  for (const rec of records) {
    if (rec.length < 12) continue;
    const seq0 = rec.readBigUInt64LE(0);
    const count = rec.readUInt32LE(8);
    let p = 12;
    for (let i = 0; i < count && p < rec.length; i++) {
      const type = rec[p++];
      let klen, vlen;
      [klen, p] = uvarint(rec, p);
      const key = rec.subarray(p, p + klen); p += klen;
      if (type === 1) {
        [vlen, p] = uvarint(rec, p);
        out.push({ key, value: rec.subarray(p, p + vlen), seq: seq0 + BigInt(i), del: false }); p += vlen;
      } else {
        out.push({ key, value: null, seq: seq0 + BigInt(i), del: true });   // 削除の印
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- まとめて

/**
 * db/ ディレクトリを読んで Map<キーの16進, Buffer> を返す。
 * キーごとに通し番号の大きいものが勝つ（削除の印が勝てば、そのキーは無い）。
 *   keep(key:Buffer) → false のキーは覚えない（大きなワールドで、要る範囲のチャンクだけ持つ）
 */
export async function openDb(dir, { keep = null } = {}) {
  const names = await fs.readdir(dir);
  const tables = names.filter((n) => /\.(ldb|sst)$/i.test(n)).sort();
  const logs = names.filter((n) => /\.log$/i.test(n)).sort();

  const best = new Map();                              // hex → { seq, value|null }
  const problems = [];
  let entries = 0;

  const put = (kv) => {
    entries++;
    if (keep && !keep(kv.key)) return;
    const k = kv.key.toString('hex'), was = best.get(k);
    if (was && was.seq > kv.seq) return;
    best.set(k, { seq: kv.seq, value: kv.del ? null : Buffer.from(kv.value) });
  };

  for (const n of tables) {
    try { for (const kv of readTable(await fs.readFile(path.join(dir, n)))) put(kv); }
    catch (e) { problems.push(`${n}: ${e.message}`); }
  }
  for (const n of logs) {
    try { for (const kv of readLog(await fs.readFile(path.join(dir, n)))) put(kv); }
    catch (e) { problems.push(`${n}: ${e.message}`); }
  }

  const map = new Map();
  for (const [k, v] of best) if (v.value) map.set(k, v.value);
  return { map, problems, tables: tables.length, logs: logs.length, entries };
}

// ---------------------------------------------------------------- キー

/**
 * Bedrock のチャンクキーを読む。
 *   [x int32LE][z int32LE]([dimension int32LE]) [tag 1B] ([subY 1B])
 * tag 0x2f = サブチャンク、0x2b = 3D データ（高さ・バイオーム）、0x2c = バージョン、0x31 = ブロックエンティティ
 * 9/10/13/14 バイトでも、tag が知っているものでなければチャンクのキーではない（"Overworld" も 9 バイト）
 */
const CHUNK_TAGS = new Set([...Array.from({ length: 0x41 - 0x2b + 1 }, (_, i) => 0x2b + i), 0x76]);   // 43..65 と旧いバージョン 118
export function parseChunkKey(keyHex) {
  const b = Buffer.from(keyHex, 'hex');
  const len = b.length;
  let dim = 0, off = 8;
  if (len === 13 || len === 14) { dim = b.readInt32LE(8); off = 12; }
  else if (len !== 9 && len !== 10) return null;
  const tag = b[off];
  if (!CHUNK_TAGS.has(tag)) return null;
  if ((len === 10 || len === 14) && tag !== 0x2f) return null;   // 添字つきはサブチャンクだけ
  const subY = len === off + 2 ? b.readInt8(off + 1) : null;
  return { x: b.readInt32LE(0), z: b.readInt32LE(4), dim, tag, subY };
}

export const TAG = { SUBCHUNK: 0x2f, DATA3D: 0x2b, VERSION: 0x2c, VERSION_OLD: 0x76, BLOCK_ENTITY: 0x31 };
