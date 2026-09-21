import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

export function writeZip(out, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (b) => { chunks.push(b); offset += b.length; };

  for (const e of entries) {
    const raw = Buffer.isBuffer(e.body) ? e.body : e.body !== undefined ? Buffer.from(e.body, 'utf8') : fs.readFileSync(e.abs);
    const def = zlib.deflateRawSync(raw, { level: 6 });
    const useDef = def.length < raw.length;
    const body = useDef ? def : raw;
    const name = Buffer.from(e.name, 'utf8');
    const at = offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDef ? 8 : 0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    push(local); push(name); push(body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(useDef ? 8 : 0, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(crc32(raw), 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE((0o100644 >>> 0) * 0x10000, 38);
    cd.writeUInt32LE(at, 42);
    central.push(Buffer.concat([cd, name]));
  }

  const cdStart = offset;
  for (const b of central) push(b);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  push(eocd);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.concat(chunks));
  return { files: central.length, size: offset };
}

const ALWAYS_SKIP = new Set(['.git', 'node_modules', '.DS_Store']);

/**
 * プロジェクト全体を zip にするときに、一番上の階層で外すもの。
 * 作り直せるもの（依存・実機・キャッシュ）と、大きい取得物（refs）。
 * handoff.mjs（AI への zip）と archive.mjs（丸ごと backup）の両方が使う。
 */
export const DEFAULT_SKIP = new Set(['.git', 'node_modules', '.DS_Store', '.bds-lab', 'dist', 'worlds', 'target', 'vendor', 'refs']);

/** バイト数を人が読める形にする（1.2 MB のように）。 */
export function humanSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** フォルダの中身の合計バイト数（シンボリックリンクは数えない）。 */
export function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const abs = stack.pop();
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) stack.push(p);
      else { try { total += fs.statSync(p).size; } catch { /* 消えかけのファイルは無視 */ } }
    }
  }
  return total;
}

/**
 * フォルダを entries にする。
 * skip の名前は**一番上の階層だけ**に効く（src/play/worlds のような同名の下層を巻き込まない）。
 */
export function collect(dir, prefix = '', skip = new Set()) {
  const out = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ALWAYS_SKIP.has(e.name)) continue;
      if (!rel && skip.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const a = path.join(abs, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(a, r);
      else out.push({ name: prefix ? `${prefix}/${r}` : r, abs: a });
    }
  };
  walk(dir, '');
  return out;
}

export async function extract(zipPath, outDir) {
  const { extractZip } = await import('../../tools/bds/get.mjs');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  return extractZip(zipPath, outDir);
}
