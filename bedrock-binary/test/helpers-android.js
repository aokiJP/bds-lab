// arm64 / Android 側のテスト用素材。本物の libminecraftpe.so や APK は置けないので組み立てる。
import zlib from 'node:zlib';
import { crc32 } from '../src/apk/zip.js';

const u32 = (v) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
};

// ---- 命令 ----

export function adrp(pc, target, rd) {
  const imm = Math.floor(target / 4096) - Math.floor(pc / 4096);
  const v = imm & 0x1fffff;
  return u32(0x90000000 | ((v & 3) << 29) | (((v >> 2) & 0x7ffff) << 5) | rd);
}

export function adr(pc, target, rd) {
  const v = (target - pc) & 0x1fffff;
  return u32(0x10000000 | ((v & 3) << 29) | (((v >> 2) & 0x7ffff) << 5) | rd);
}

export function addImm(rd, rn, imm, shift = 0) {
  return u32(0x91000000 | (shift << 22) | ((imm & 0xfff) << 10) | (rn << 5) | rd);
}

export function ldrImm(rt, rn, off) {
  return u32(0xf9400000 | (((off / 8) & 0xfff) << 10) | (rn << 5) | rt);
}

export const NOP = u32(0xd503201f);
/** mov x0, x1 — 走査対象外の命令 */
export const MOV = u32(0xaa0103e0);

/** 文字列群を adrp+add で順に読む関数の命令列 */
export function loadStrings(startPc, targets, reg = 8) {
  const out = [];
  let pc = startPc;
  for (const t of targets) {
    out.push(adrp(pc, t, reg));
    pc += 4;
    out.push(addImm(reg, reg, t % 4096));
    pc += 4;
  }
  return Buffer.concat(out);
}

// ---- 再配置 ----

export function sleb(value) {
  const out = [];
  let v = BigInt(value);
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    const done = (v === 0n && (byte & 0x40) === 0) || (v === -1n && (byte & 0x40) !== 0);
    out.push(done ? byte : byte | 0x80);
    if (done) return Buffer.from(out);
  }
}

/** Elf64_Rela の配列 */
export function rela(entries, type) {
  const b = Buffer.alloc(entries.length * 24);
  entries.forEach(({ offset, addend }, i) => {
    b.writeBigUInt64LE(BigInt(offset), i * 24);
    b.writeBigUInt64LE(BigInt(type), i * 24 + 8);
    b.writeBigInt64LE(BigInt(addend), i * 24 + 16);
  });
  return b;
}

/**
 * APS2 形式。lld と同じく「オフセット差が一定で addend を個別に持つ」グループで詰める。
 * 最初のエントリだけ別グループにして、グループをまたぐ addend の累積も確かめる。
 */
export function aps2(entries, type) {
  const parts = [Buffer.from('APS2', 'latin1'), sleb(entries.length), sleb(0)];
  let offset = 0;
  let addend = 0;
  const [first, ...restEntries] = entries;
  // グループ 1: 1 件、info をグループで共有、addend は個別
  parts.push(sleb(1), sleb(1 | 8), sleb(type));
  parts.push(sleb(first.offset - offset), sleb(first.addend - addend));
  offset = first.offset;
  addend = first.addend;
  if (restEntries.length) {
    // グループ 2: 残り全部。オフセット差 8 固定、info 共有、addend 個別
    parts.push(sleb(restEntries.length), sleb(1 | 2 | 8), sleb(8), sleb(type));
    for (const e of restEntries) {
      if (e.offset - offset !== 8) throw new Error('aps2 helper: offsets must be 8 apart');
      parts.push(sleb(e.addend - addend));
      offset = e.offset;
      addend = e.addend;
    }
  }
  return Buffer.concat(parts);
}

/** RELR。連続したアドレスをビットマップで表す */
export function relr(addrs) {
  const words = [];
  let i = 0;
  while (i < addrs.length) {
    const start = addrs[i];
    words.push(BigInt(start));
    let base = start + 8;
    i++;
    while (i < addrs.length) {
      let bits = 0n;
      let consumed = 0;
      while (i + consumed < addrs.length) {
        const d = addrs[i + consumed] - base;
        if (d < 0 || d % 8 !== 0 || d / 8 >= 63) break;
        bits |= 1n << BigInt(d / 8);
        consumed++;
      }
      if (!consumed) break;
      words.push((bits << 1n) | 1n);
      i += consumed;
      base += 63 * 8;
    }
  }
  const b = Buffer.alloc(words.length * 8);
  words.forEach((w, k) => b.writeBigUInt64LE(w, k * 8));
  return b;
}

// ---- APK ----

/** 最小の ZIP。entries: [{name, data, method?}] */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method = 8 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function chunk(type, headerSize, body) {
  const h = Buffer.alloc(8);
  h.writeUInt16LE(type, 0);
  h.writeUInt16LE(headerSize, 2);
  h.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([h, body]);
}

function stringPool(strings, utf8) {
  const offsets = [];
  const data = [];
  let pos = 0;
  for (const s of strings) {
    offsets.push(pos);
    let enc;
    if (utf8) {
      const bytes = Buffer.from(s, 'utf8');
      enc = Buffer.concat([Buffer.from([s.length, bytes.length]), bytes, Buffer.from([0])]);
    } else {
      const units = Buffer.from(s, 'utf16le');
      const len = Buffer.alloc(2);
      len.writeUInt16LE(s.length);
      enc = Buffer.concat([len, units, Buffer.alloc(2)]);
    }
    data.push(enc);
    pos += enc.length;
  }
  let body = Buffer.concat(data);
  if (body.length % 4) body = Buffer.concat([body, Buffer.alloc(4 - (body.length % 4))]);
  const hdr = Buffer.alloc(20); // stringCount styleCount flags stringsStart stylesStart
  hdr.writeUInt32LE(strings.length, 0);
  hdr.writeUInt32LE(utf8 ? 0x100 : 0, 8);
  hdr.writeUInt32LE(28 + strings.length * 4, 12);
  const offs = Buffer.alloc(strings.length * 4);
  offsets.forEach((o, i) => offs.writeUInt32LE(o, i * 4));
  return chunk(0x0001, 28, Buffer.concat([hdr, offs, body]));
}

/**
 * バイナリ XML の AndroidManifest。
 * obfuscated=true なら属性名を空文字にして、リソース ID だけで引けるかを試す。
 */
export function buildManifest({ pkg, versionCode, versionName, split, utf8 = true, obfuscated = false }) {
  // 先頭 2 つはリソースマップに対応する属性名
  const strings = [obfuscated ? '' : 'versionCode', obfuscated ? ' ' : 'versionName', 'package', 'split', 'manifest', pkg, versionName ?? '', split ?? ''];
  const idx = { versionCode: 0, versionName: 1, package: 2, split: 3, manifest: 4, pkg: 5, vname: 6, split_v: 7 };

  const resMap = Buffer.alloc(8);
  resMap.writeUInt32LE(0x0101021b, 0);
  resMap.writeUInt32LE(0x0101021c, 4);

  const attrs = [];
  const attr = (name, raw, type, data) => {
    const a = Buffer.alloc(20);
    a.writeUInt32LE(0xffffffff, 0);
    a.writeUInt32LE(name, 4);
    a.writeUInt32LE(raw, 8);
    a.writeUInt16LE(8, 12);
    a[15] = type;
    a.writeUInt32LE(data >>> 0, 16);
    attrs.push(a);
  };
  attr(idx.package, idx.pkg, 0x03, idx.pkg);
  if (versionCode !== undefined) attr(idx.versionCode, 0xffffffff, 0x10, versionCode);
  if (versionName !== undefined) attr(idx.versionName, idx.vname, 0x03, idx.vname);
  if (split !== undefined) attr(idx.split, idx.split_v, 0x03, idx.split_v);

  const node = Buffer.alloc(8); // lineNumber, comment
  node.writeUInt32LE(1, 0);
  node.writeUInt32LE(0xffffffff, 4);
  const ext = Buffer.alloc(20);
  ext.writeUInt32LE(0xffffffff, 0);
  ext.writeUInt32LE(idx.manifest, 4);
  ext.writeUInt16LE(20, 8);
  ext.writeUInt16LE(20, 10);
  ext.writeUInt16LE(attrs.length, 12);
  const start = chunk(0x0102, 16, Buffer.concat([node, ext, ...attrs]));

  const body = Buffer.concat([stringPool(strings, utf8), chunk(0x0180, 8, resMap), start]);
  return chunk(0x0003, 8, body);
}
