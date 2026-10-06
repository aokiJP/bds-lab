// 依存ゼロの ZIP リーダ。APK（= ZIP）から必要なエントリだけを取り出す。
//
// APK は数百 MB あるので、全体をメモリに載せずに中央ディレクトリだけ読み、
// 必要なエントリのデータ部分だけをファイルから切り出す。
// 対応: 無圧縮 (method 0) と deflate (method 8)、ZIP64。暗号化と分割 ZIP は非対応。

import fs from 'node:fs';
import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export class ZipReader {
  /** @param {string} path */
  constructor(path) {
    this.path = path;
    this.fd = fs.openSync(path, 'r');
    try {
      this.size = fs.fstatSync(this.fd).size;
      this.entries = this.#readCentralDirectory();
      this.byName = new Map(this.entries.map((e) => [e.name, e]));
    } catch (e) {
      fs.closeSync(this.fd);
      throw e;
    }
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  #read(position, length) {
    if (position < 0 || position + length > this.size) {
      throw new ZipError(`${this.path}: ファイル範囲外を読もうとしました (${position}+${length} > ${this.size})`);
    }
    const b = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const n = fs.readSync(this.fd, b, done, length - done, position + done);
      if (n === 0) throw new ZipError(`${this.path}: 読み込みが途中で終わりました`);
      done += n;
    }
    return b;
  }

  #readCentralDirectory() {
    if (this.size < 22) throw new ZipError(`${this.path}: ZIP として小さすぎます`);
    const tailLen = Math.min(this.size, 22 + MAX_COMMENT);
    const tail = this.#read(this.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError(`${this.path}: ZIP の終端レコードがありません（APK ではない可能性）`);

    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== SIG_ZIP64_LOCATOR) {
        throw new ZipError(`${this.path}: ZIP64 の位置情報がありません`);
      }
      const z64 = this.#read(Number(tail.readBigUInt64LE(loc + 8)), 56);
      if (z64.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw new ZipError(`${this.path}: ZIP64 終端レコードが壊れています`);
      count = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }

    const cd = this.#read(cdOffset, cdSize);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) {
        throw new ZipError(`${this.path}: 中央ディレクトリの ${i} 件目が壊れています`);
      }
      const flags = cd.readUInt16LE(p + 8);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const e = {
        name: cd.toString('utf8', p + 46, p + 46 + nameLen),
        method: cd.readUInt16LE(p + 10),
        encrypted: (flags & 1) !== 0,
        crc: cd.readUInt32LE(p + 16),
        compressedSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        localOffset: cd.readUInt32LE(p + 42),
      };
      readZip64Extra(e, cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen));
      entries.push(e);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  has(name) {
    return this.byName.has(name);
  }

  /** エントリを展開して返す。CRC を検証する */
  read(name, { maxSize = 2 ** 31 - 1 } = {}) {
    const e = typeof name === 'string' ? this.byName.get(name) : name;
    if (!e) throw new ZipError(`${this.path}: ${name} がありません`);
    if (e.encrypted) throw new ZipError(`${this.path}: ${e.name} は暗号化されています`);
    if (e.size > maxSize) throw new ZipError(`${this.path}: ${e.name} が大きすぎます (${e.size} バイト)`);

    const local = this.#read(e.localOffset, 30);
    if (local.readUInt32LE(0) !== SIG_LOCAL) throw new ZipError(`${this.path}: ${e.name} のローカルヘッダが壊れています`);
    const dataStart = e.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const raw = this.#read(dataStart, e.compressedSize);

    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(e.size, 1) });
      } catch (err) {
        throw new ZipError(`${this.path}: ${e.name} の展開に失敗しました: ${err.message}`);
      }
    } else throw new ZipError(`${this.path}: ${e.name} の圧縮方式 ${e.method} は未対応です`);

    if (data.length !== e.size) {
      throw new ZipError(`${this.path}: ${e.name} の大きさが合いません (${data.length} ≠ ${e.size})`);
    }
    const actual = crc32(data);
    if (actual !== e.crc) {
      throw new ZipError(
        `${this.path}: ${e.name} の CRC が合いません (0x${actual.toString(16)} ≠ 0x${e.crc.toString(16)})。ファイルが壊れています`,
      );
    }
    return data;
  }
}

function readZip64Extra(e, extra) {
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = extra.readUInt16LE(p);
    const len = extra.readUInt16LE(p + 2);
    if (id === 0x0001) {
      let q = p + 4;
      const take = () => {
        const v = Number(extra.readBigUInt64LE(q));
        q += 8;
        return v;
      };
      if (e.size === 0xffffffff) e.size = take();
      if (e.compressedSize === 0xffffffff) e.compressedSize = take();
      if (e.localOffset === 0xffffffff) e.localOffset = take();
      return;
    }
    p += 4 + len;
  }
}
