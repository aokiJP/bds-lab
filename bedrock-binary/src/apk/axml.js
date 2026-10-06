// APK の AndroidManifest.xml（バイナリ XML）から、版の特定に要る属性だけを読む。
//
// 取るのは <manifest> 要素の package / versionCode / versionName / split の 4 つ。
// 難読化された APK では属性名の文字列が空になっていることがあるので、
// 名前が引けないときはリソース ID（android:versionCode = 0x0101021b など）で判定する。

const RES_STRING_POOL = 0x0001;
const RES_XML = 0x0003;
const RES_XML_START_ELEMENT = 0x0102;
const RES_XML_RESOURCE_MAP = 0x0180;
const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

const ATTR_IDS = {
  0x0101021b: 'versionCode',
  0x0101021c: 'versionName',
};

export class AxmlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AxmlError';
  }
}

function readStringPool(d, start) {
  const headerSize = d.readUInt16LE(start + 2);
  const count = d.readUInt32LE(start + 8);
  const flags = d.readUInt32LE(start + 16);
  const stringsStart = start + d.readUInt32LE(start + 20);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const offsets = start + headerSize;
  const strings = new Array(count);

  for (let i = 0; i < count; i++) {
    let p = stringsStart + d.readUInt32LE(offsets + i * 4);
    if (utf8) {
      // 文字数（読み飛ばす）→ バイト数 → 本体。どちらも上位ビットが立てば 2 バイト
      p += d[p] & 0x80 ? 2 : 1;
      let len = d[p];
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | d[p + 1];
        p += 2;
      } else p += 1;
      strings[i] = d.toString('utf8', p, p + len);
    } else {
      let len = d.readUInt16LE(p);
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | d.readUInt16LE(p + 2);
        p += 4;
      } else p += 2;
      strings[i] = d.toString('utf16le', p, p + len * 2);
    }
  }
  return strings;
}

/**
 * @param {Buffer} d AndroidManifest.xml の中身
 * @returns {{package:string|null, versionCode:number|null, versionName:string|null, split:string|null}}
 */
export function parseManifest(d) {
  if (d.length < 8 || d.readUInt16LE(0) !== RES_XML) {
    throw new AxmlError('AndroidManifest.xml がバイナリ XML ではありません');
  }
  let strings = [];
  let resMap = [];
  let p = d.readUInt16LE(2);

  while (p + 8 <= d.length) {
    const type = d.readUInt16LE(p);
    const size = d.readUInt32LE(p + 4);
    if (size < 8 || p + size > d.length) throw new AxmlError(`チャンクの大きさが不正です (offset ${p})`);

    if (type === RES_STRING_POOL) strings = readStringPool(d, p);
    else if (type === RES_XML_RESOURCE_MAP) {
      const hs = d.readUInt16LE(p + 2);
      resMap = [];
      for (let q = p + hs; q + 4 <= p + size; q += 4) resMap.push(d.readUInt32LE(q));
    } else if (type === RES_XML_START_ELEMENT) {
      const ext = p + d.readUInt16LE(p + 2);
      const nameIdx = d.readUInt32LE(ext + 4);
      if (strings[nameIdx] === 'manifest') return readManifestAttrs(d, ext, strings, resMap);
    }
    p += size;
  }
  throw new AxmlError('<manifest> 要素が見つかりません');
}

function readManifestAttrs(d, ext, strings, resMap) {
  const attrStart = ext + d.readUInt16LE(ext + 8);
  const attrSize = d.readUInt16LE(ext + 10);
  const attrCount = d.readUInt16LE(ext + 12);
  const out = { package: null, versionCode: null, versionName: null, split: null };

  for (let i = 0; i < attrCount; i++) {
    const a = attrStart + i * attrSize;
    const nameIdx = d.readUInt32LE(a + 4);
    const rawIdx = d.readUInt32LE(a + 8);
    const dataType = d[a + 15];
    const data = d.readUInt32LE(a + 16);

    const key = ATTR_IDS[resMap[nameIdx]] ?? strings[nameIdx] ?? '';
    const str = rawIdx !== NO_INDEX ? strings[rawIdx] : dataType === TYPE_STRING ? strings[data] : undefined;

    if (key === 'package') out.package = str ?? null;
    else if (key === 'split') out.split = str ?? null;
    else if (key === 'versionName') out.versionName = str ?? null;
    else if (key === 'versionCode') {
      if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) out.versionCode = data;
      else if (str !== undefined && /^\d+$/.test(str)) out.versionCode = Number(str);
    }
  }
  return out;
}

/**
 * <uses-permission android:name="…"> (and uses-permission-sdk-23) の名前をすべて。
 * 属性名が空の難読化 APK でも android:name（0x01010003）で引ける。
 * @param {Buffer} d AndroidManifest.xml の中身
 * @returns {string[]}
 */
export function manifestPermissions(d) {
  if (d.length < 8 || d.readUInt16LE(0) !== RES_XML) throw new AxmlError('AndroidManifest.xml がバイナリ XML ではありません');
  let strings = [], resMap = [];
  const out = [];
  let p = d.readUInt16LE(2);
  while (p + 8 <= d.length) {
    const type = d.readUInt16LE(p), size = d.readUInt32LE(p + 4);
    if (size < 8 || p + size > d.length) throw new AxmlError(`チャンクの大きさが不正です (offset ${p})`);
    if (type === RES_STRING_POOL) strings = readStringPool(d, p);
    else if (type === RES_XML_RESOURCE_MAP) {
      const hs = d.readUInt16LE(p + 2);
      resMap = [];
      for (let q = p + hs; q + 4 <= p + size; q += 4) resMap.push(d.readUInt32LE(q));
    } else if (type === RES_XML_START_ELEMENT) {
      const ext = p + d.readUInt16LE(p + 2);
      if (/^uses-permission(-sdk-23)?$/.test(strings[d.readUInt32LE(ext + 4)] ?? '')) {
        const attrStart = ext + d.readUInt16LE(ext + 8), attrSize = d.readUInt16LE(ext + 10), attrCount = d.readUInt16LE(ext + 12);
        for (let i = 0; i < attrCount; i++) {
          const a = attrStart + i * attrSize, nameIdx = d.readUInt32LE(a + 4), rawIdx = d.readUInt32LE(a + 8);
          if (resMap[nameIdx] === 0x01010003 || strings[nameIdx] === 'name') {
            const v = rawIdx !== NO_INDEX ? strings[rawIdx] : d[a + 15] === TYPE_STRING ? strings[d.readUInt32LE(a + 16)] : undefined;
            if (v) out.push(v);
          }
        }
      }
    }
    p += size;
  }
  return out;
}
