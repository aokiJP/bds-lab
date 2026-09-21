#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bdsKind, wantedKind } from './launch.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const has = (k) => argv.includes(k);
const say = (...a) => { if (!has('--print')) process.stderr.write(`${a.join(' ')}\n`); };

const WANT = wantedKind();
const EXE = WANT === 'windows' ? 'bedrock_server.exe' : 'bedrock_server';
const KIND_LABEL = { linux: 'Linux 版', windows: 'Windows 版' };

export function looksLikeBds(dir) {
  return bdsKind(dir) === WANT;
}

const DIR_CANDIDATES = () => [
  process.env.SANDBOX_BE_BDS,
  path.join(ROOT, 'vendor', 'bedrock-server'),
  path.join(ROOT, 'bedrock-server'),
  path.join(process.cwd(), 'bedrock-server'),
  path.join(os.homedir(), 'bedrock-server'),
  path.join(os.homedir(), 'bds'),
].filter(Boolean);

const ZIP_DIRS = () => [
  path.join(ROOT, 'vendor'),
  ROOT,
  process.cwd(),
  path.join(os.homedir(), 'Downloads'),
  '/mnt/user-data/uploads',
  os.tmpdir(),
];

export function zipKind(zipPath) {
  try {
    const names = readCentralDirectory(fs.readFileSync(zipPath)).map((e) => e.name);
    if (names.some((n) => /(^|\/)bedrock_server\.exe$/.test(n))) return 'windows';
    if (names.some((n) => /(^|\/)bedrock_server$/.test(n))) return 'linux';
    return null;
  } catch { return null; }
}

export function findZip() {
  const given = opt('--zip');
  if (given) return path.resolve(given);
  const hits = [];
  for (const dir of ZIP_DIRS()) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/^bedrock[-_]server.*\.zip$/i.test(n)) continue;
      const p = path.join(dir, n);
      try { hits.push({ p, mtime: fs.statSync(p).mtimeMs }); } catch { /* 読めないものは飛ばす */ }
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime);
  for (const h of hits) {
    const kind = zipKind(h.p);
    if (kind === WANT) return h.p;
    if (kind) say(`${h.p} は${KIND_LABEL[kind]}なので使いません（ここで要るのは${KIND_LABEL[WANT]}）`);
  }
  return null;
}

function readCentralDirectory(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0x10000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip の形が読めません（End of central directory がありません）');
  let count = buf.readUInt16LE(eocd + 10);
  let size = buf.readUInt32LE(eocd + 12);
  let offset = buf.readUInt32LE(eocd + 16);

  if (offset === 0xffffffff || count === 0xffff || size === 0xffffffff) {
    let loc = -1;
    for (let i = eocd - 20; i >= 0 && i > eocd - 20 - 0x10000; i--) {
      if (buf.readUInt32LE(i) === 0x07064b50) { loc = i; break; }
    }
    if (loc < 0) throw new Error('zip64 の位置情報が見つかりません');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    if (buf.readUInt32LE(z64) !== 0x06064b50) throw new Error('zip64 の中身が読めません');
    count = Number(buf.readBigUInt64LE(z64 + 32));
    size = Number(buf.readBigUInt64LE(z64 + 40));
    offset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const entries = [];
  let p = offset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`zip の目次が壊れています（${i} 件目）`);
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const externalAttr = buf.readUInt32LE(p + 38);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = buf.readUInt16LE(e);
        const len = buf.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(q)); q += 8; }
          break;
        }
        e += 4 + len;
      }
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset, mode: (externalAttr >>> 16) & 0xffff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function extractZip(zipPath, outDir) {
  const buf = fs.readFileSync(zipPath);
  const entries = readCentralDirectory(buf);
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const e of entries) {
    const dest = path.resolve(outDir, e.name);
    if (!dest.startsWith(path.resolve(outDir) + path.sep) && dest !== path.resolve(outDir)) throw new Error(`zip の中に外へ出る名前があります: ${e.name}`);
    if (e.name.endsWith('/')) { fs.mkdirSync(dest, { recursive: true }); continue; }
    const lo = e.localOffset;
    if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error(`本体の位置が合いません: ${e.name}`);
    const nameLen = buf.readUInt16LE(lo + 26);
    const extraLen = buf.readUInt16LE(lo + 28);
    const start = lo + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + e.compressedSize);
    const data = e.method === 0 ? raw : zlib.inflateRawSync(raw);
    if (e.uncompressedSize && data.length !== e.uncompressedSize) throw new Error(`大きさが合いません: ${e.name}（${data.length} != ${e.uncompressedSize}）`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    if (e.mode) { try { fs.chmodSync(dest, e.mode & 0o777); } catch { /* Windows では効かない */ } }
    n++;
  }
  return n;
}

export const DOWNLOAD_API = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';

export function pickDownloadUrl(json, { kind = WANT, preview = false } = {}) {
  const type = `serverBedrock${preview ? 'Preview' : ''}${kind === 'windows' ? 'Windows' : 'Linux'}`;
  return json?.result?.links?.find((l) => l.downloadType === type)?.downloadUrl ?? null;
}

async function download(outZip, { preview = has('--preview') } = {}) {
  say('公式の配布 API から最新の場所を探しています…');
  let url = null;
  try {
    const res = await fetch(DOWNLOAD_API, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
    if (res.ok) url = pickDownloadUrl(await res.json(), { preview });
  } catch { /* 下で配布ページを見る */ }
  if (!url) {
    try {
      const html = await (await fetch('https://www.minecraft.net/en-us/download/server/bedrock', { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
      url = html.match(new RegExp(`https://[^"']*bin-${WANT === 'windows' ? 'win' : 'linux'}${preview ? '-preview' : ''}/[^"']*\\.zip`))?.[0] ?? null;
    } catch { /* 下の控えを使う */ }
  }
  if (!url && !preview) {
    const known = knownLatest();
    if (known) { say(`配布元を読めないので、控えの版を使います: ${known.version}`); url = known.url; }
  }
  if (!url) throw new Error('配布元から zip の場所を読み取れませんでした。https://www.minecraft.net/download/server/bedrock から手で落として、~/Downloads に置いてください');
  say(`落としています（${KIND_LABEL[WANT]}）: ${url}`);
  const z = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!z.ok) throw new Error(`ダウンロードに失敗しました: ${z.status}`);
  fs.writeFileSync(outZip, Buffer.from(await z.arrayBuffer()));
  return outZip;
}

function versionList() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'data', 'bds-versions.json'), 'utf8'));
  } catch { return null; }
}

export function knownVersions() {
  const j = versionList();
  if (!j) return { stable: null, preview: null, all: [] };
  const kind = WANT === 'windows' ? 'windows' : 'linux';
  return { stable: j[kind]?.stable ?? null, preview: j[kind]?.preview ?? null, all: j[kind]?.versions ?? [] };
}

export function urlFor(version, { preview = false } = {}) {
  const j = versionList();
  if (!j?.cdn_root) return null;
  const bin = `bin-${WANT === 'windows' ? 'win' : 'linux'}${preview ? '-preview' : ''}`;
  return `${j.cdn_root}/${bin}/bedrock-server-${version}.zip`;
}

export function knownLatest({ preview = false } = {}) {
  const v = preview ? knownVersions().preview : knownVersions().stable;
  const url = v && urlFor(v, { preview });
  return url ? { version: v, url } : null;
}

export async function ensureBdsVersion({ root, version, preview = false, say = () => {} }) {
  const out = path.join(root, 'vendor', `bedrock-server-${version}`);
  if (looksLikeBds(out)) return out;
  const zip = path.join(root, 'vendor', `bedrock-server-${version}.zip`);
  if (!fs.existsSync(zip)) {
    const url = urlFor(version, { preview });
    if (!url) throw new Error(`版 ${version} の場所が分かりません`);
    say(`BDS ${version} を落としています…`);
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`BDS ${version} を落とせませんでした（${res.status}）。版の名前を確かめてください`);
    fs.mkdirSync(path.dirname(zip), { recursive: true });
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  say(`BDS ${version} を展開しています…`);
  extractZip(zip, out);
  const exe = path.join(out, EXE);
  if (!fs.existsSync(exe)) throw new Error(`展開しましたが ${EXE} がありません: ${zip}`);
  try { fs.chmodSync(exe, 0o755); } catch { /* Windows */ }
  return out;
}

export async function ensureBds({ dir, zip, allowDownload = false, quiet = false } = {}) {
  const note = quiet ? () => {} : say;
  const wanted = dir ?? opt('--dir');
  if (wanted && looksLikeBds(wanted)) return path.resolve(wanted);
  const other = wanted && bdsKind(wanted);
  if (other) throw new Error(`${wanted} は${KIND_LABEL[other]}の BDS です。ここでは${KIND_LABEL[WANT]}が要ります（${process.platform === 'darwin' ? 'macOS は Linux 版をコンテナで動かします。' : ''}別のフォルダを指定するか --download で用意してください）`);
  for (const d of DIR_CANDIDATES()) if (looksLikeBds(d)) { note(`展開済みの BDS を使います: ${d}`); return path.resolve(d); }

  const out = path.resolve(wanted ?? path.join(ROOT, 'vendor', 'bedrock-server'));
  let z = zip ?? findZip();
  if (!z && allowDownload) {
    const keep = path.join(ROOT, 'vendor');
    try { fs.mkdirSync(keep, { recursive: true }); } catch { /* 書けなければ一時領域へ */ }
    const dest = fs.existsSync(keep) ? path.join(keep, 'bedrock-server.zip') : path.join(os.tmpdir(), 'bedrock-server.zip');
    z = await download(dest);
  }
  if (!z) return null;
  if (!fs.existsSync(z)) throw new Error(`zip がありません: ${z}`);
  const kind = zipKind(z);
  if (kind && kind !== WANT) throw new Error(`${z} は${KIND_LABEL[kind]}の BDS です。ここでは${KIND_LABEL[WANT]}を使います（${process.platform === 'darwin' ? 'macOS は Linux 版をコンテナで動かします。' : ''}--download で取り直せます）`);

  note(`${z} を ${out} に展開しています（数十秒かかります）…`);
  const n = extractZip(z, out);
  note(`${n} ファイルを展開しました`);
  const exe = path.join(out, EXE);
  if (!fs.existsSync(exe)) throw new Error(`展開しましたが ${EXE} がありません。${KIND_LABEL[WANT]}の BDS の zip でしょうか: ${z}`);
  try { fs.chmodSync(exe, 0o755); } catch { /* Windows */ }
  note('BDS を使うには Minecraft の EULA とプライバシーポリシーへの同意が要ります（bedrock_server_how_to.html）');
  return out;
}
