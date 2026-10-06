/**
 * 最小限のZIP読み書き。依存ゼロ (node:zlib のみ)。
 * .mcworld / .mcpack / .mcaddon は中身ただのZIPなので自前で足りる。
 */
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import { resolve as pathResolve, sep as pathSep } from 'node:path';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;

// 名前の文字コード: 汎用フラグの bit 11 が立っていれば UTF-8。立っていないのは昔の書き方で、日本語の Windows で作った zip は
// Shift_JIS（CP932）がふつう（配布ワールドの「脱出ワールド/level.dat」など）。UTF-8 として正しければ UTF-8、そうでなければ CP932
const UTF8 = new TextDecoder('utf-8', { fatal: true });
let SJIS = null;
try { SJIS = new TextDecoder('shift_jis'); } catch { /* ICU の無い Node: UTF-8 のまま */ }
export function entryName(bytes, flags = 0) {
  if (flags & 0x0800 || bytes.every((b) => b < 0x80)) return Buffer.from(bytes).toString('utf8');
  try { return UTF8.decode(bytes); } catch { return SJIS ? SJIS.decode(bytes) : Buffer.from(bytes).toString('utf8'); }
}

/**
 * zip の中の名前を、展開先の中に収まるパスにする（"../" で外へ出る・絶対パス・ドライブ名は拒む）。
 * 他人の配布物を展開するので、外に書く名前（zip slip）は 1 つでもあれば止める。
 */
export function safeJoin(base, name) {
  const rel = String(name).replace(/\\/g, '/');
  if (/^\/|^[a-zA-Z]:/.test(rel) || rel.split('/').includes('..')) throw new Error(`展開先の外を指す名前: ${name}`);
  const root = pathResolve(base), dest = pathResolve(root, rel);
  if (dest !== root && !dest.startsWith(root + pathSep)) throw new Error(`展開先の外を指す名前: ${name}`);
  return dest;
}

/** 末尾からEOCDを探す */
function findEOCD(buf) {
  const max = Math.min(buf.length, 0xffff + 22);
  for (let i = buf.length - 22; i >= buf.length - max; i--) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * セントラルディレクトリを読んでエントリ一覧を返す。
 * → [{name, size, csize, offset, method, crc, dir}]
 */
export function listEntries(buf) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('ZIPではない (EOCDなし)');

  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64 (4GB超 or 65535エントリ超)
  if (cdOffset === 0xffffffff || count === 0xffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === EOCD64_LOC_SIG) {
        const z64 = Number(buf.readBigUInt64LE(i + 8));
        if (buf.readUInt32LE(z64) === EOCD64_SIG) {
          count = Number(buf.readBigUInt64LE(z64 + 32));
          cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
        }
        break;
      }
    }
  }

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let csize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28);
    const eLen = buf.readUInt16LE(p + 30);
    const cLen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    const name = entryName(buf.subarray(p + 46, p + 46 + nLen), buf.readUInt16LE(p + 8));

    // ZIP64 拡張フィールド
    if (size === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
      let q = p + 46 + nLen;
      const end = q + eLen;
      while (q + 4 <= end) {
        const id = buf.readUInt16LE(q), len = buf.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(r)); r += 8; }
          if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(r)); r += 8; }
          if (offset === 0xffffffff) { offset = Number(buf.readBigUInt64LE(r)); r += 8; }
          break;
        }
        q += 4 + len;
      }
    }

    entries.push({ name, size, csize, offset, method, crc, dir: name.endsWith('/') });
    p += 46 + nLen + eLen + cLen;
  }
  return entries;
}

/** 1エントリを展開して Buffer で返す */
export function readEntry(buf, entry) {
  const lh = entry.offset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) throw new Error(`ローカルヘッダ不正: ${entry.name}`);
  if (buf.readUInt16LE(lh + 6) & 1) throw new Error(`暗号化されている（パスワード付き zip）: ${entry.name}`);
  const nLen = buf.readUInt16LE(lh + 26);
  const eLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nLen + eLen;
  if (start + entry.csize > buf.length) throw new Error(`途中で切れている: ${entry.name}`);
  const raw = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`未対応の圧縮方式 ${entry.method}: ${entry.name}`);
}

/** 名前で1件探して展開 (無ければ null) */
export function readByName(buf, entries, name) {
  const lower = name.toLowerCase();
  const e = entries.find((x) => x.name.toLowerCase() === lower)
    || entries.find((x) => x.name.toLowerCase().endsWith('/' + lower));
  return e ? readEntry(buf, e) : null;
}

/** ZIP全体の健全性チェック。壊れたDL（途中で切れた・化けた）を弾く: 展開・大きさ・CRC32 */
export function verify(buf) {
  const entries = listEntries(buf);
  if (!entries.length) throw new Error('中身が 1 つも無い');
  let bytes = 0;
  for (const e of entries) {
    if (e.dir) continue;
    const data = readEntry(buf, e);       // ここで壊れてれば例外
    if (data.length !== e.size) throw new Error(`サイズ不一致: ${e.name}`);
    if (crc32(data) !== e.crc) throw new Error(`CRC 不一致（中身が化けている）: ${e.name}`);
    bytes += data.length;
  }
  return { entries: entries.length, bytes };
}

// ---------------------------------------------------------------- 書き込み

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(d = new Date()) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}

/**
 * files: [{name, data:Buffer}] から ZIP を組み立てて Buffer を返す。
 * .mcworld はこれで作る (拡張子が違うだけの普通のZIP)。
 */
export function writeZip(files, { mtime = new Date() } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const { time, date } = dosTime(mtime);

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const deflated = zlib.deflateRawSync(f.data, { level: 6 });
    const useDeflate = deflated.length < f.data.length;
    const body = useDeflate ? deflated : f.data;
    const method = useDeflate ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);      // UTF-8フラグ
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CEN_SIG, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

/** ディレクトリを再帰的に読んで writeZip 用の配列にする */
export async function collectDir(root, prefix = '') {
  const out = [];
  const walk = async (dir, rel) => {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const p = `${dir}/${d.name}`;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(p, r);
      else out.push({ name: prefix + r, data: await fs.readFile(p) });
    }
  };
  await walk(root, '');
  return out;
}
