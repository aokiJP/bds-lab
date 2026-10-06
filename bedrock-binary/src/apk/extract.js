// 自分の端末や mcbedrock-get から得た APK 一式から、解析対象の .so を取り出す。
//
// Play 配信の Minecraft は分割 APK で、ネイティブライブラリは base ではなく
// config.arm64_v8a.apk 側に入っている。古い版（App Bundle 以前）は base.apk 1 本の中に
// lib/<abi>/ を持つ。どちらでも同じ手順で探せるよう、渡された APK を全部開いて横断する。
//
// ここは読み取りだけ。APK も .so もリポジトリには置かない（.gitignore と guard スクリプトで二重に止める）。

import fs from 'node:fs';
import path from 'node:path';
import { ZipReader } from './zip.js';
import { parseManifest } from './axml.js';
import { ElfFile } from '../elf/reader.js';

export const DEFAULT_LIB = 'libminecraftpe.so';
export const DEFAULT_ABI = 'arm64-v8a';
export const MINECRAFT_PACKAGE = 'com.mojang.minecraftpe';

// 32bit は ELF32。reader が未対応なので、取り出す前に理由つきで止める
const SUPPORTED_ABIS = new Set(['arm64-v8a', 'x86_64']);
const APK_EXT = /\.(apk)$/i;

export class ApkError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'ApkError';
    this.hint = hint;
  }
}

/** ファイルとディレクトリの混在を APK のパス一覧に展開する（ディレクトリは直下のみ） */
export function collectApks(inputs) {
  const out = [];
  for (const input of inputs) {
    let st;
    try {
      st = fs.statSync(input);
    } catch {
      throw new ApkError(`${input} がありません`);
    }
    if (st.isDirectory()) {
      const found = fs
        .readdirSync(input)
        .filter((f) => APK_EXT.test(f))
        .sort()
        .map((f) => path.join(input, f));
      if (!found.length) throw new ApkError(`${input} に .apk がありません`, 'mcbedrock-get のダウンロード先フォルダか、adb pull した APK を指定してください。');
      out.push(...found);
    } else if (APK_EXT.test(input)) out.push(input);
    else throw new ApkError(`${input} は .apk ではありません`, '.so を直接解析するなら scan を使ってください。');
  }
  return [...new Set(out.map((p) => path.resolve(p)))];
}

/**
 * APK 一式を調べる。何も書き出さない。
 * @returns {{apks:Array, manifest:object, lib:{apk:string, entry:string, size:number}|null, abis:string[]}}
 */
export function inspectApks(paths, { lib = DEFAULT_LIB, abi = DEFAULT_ABI } = {}) {
  const apks = [];
  let manifest = null;
  let found = null;
  const abis = new Set();
  const want = `lib/${abi}/${lib}`;

  for (const p of paths) {
    const z = new ZipReader(p);
    try {
      let m = null;
      if (z.has('AndroidManifest.xml')) {
        m = parseManifest(z.read('AndroidManifest.xml', { maxSize: 16 * 1024 * 1024 }));
      }
      for (const e of z.entries) {
        const hit = e.name.match(/^lib\/([^/]+)\/([^/]+)$/);
        if (hit && hit[2] === lib) abis.add(hit[1]);
      }
      const entry = z.byName.get(want);
      if (entry && !found) found = { apk: p, entry: want, size: entry.size };
      apks.push({ path: p, split: m?.split ?? null, package: m?.package ?? null, versionName: m?.versionName ?? null, versionCode: m?.versionCode ?? null });
      // 版名は base（split 属性なし）のものを正とする
      if (m && !m.split && (!manifest || !manifest.versionName)) manifest = m;
    } finally {
      z.close();
    }
  }

  if (!manifest) manifest = apks.find((a) => a.versionCode !== null) ?? null;
  return { apks, manifest, lib: found, abis: [...abis].sort() };
}

/**
 * .so を work 以下へ取り出す。既にあって内容が同じなら書き直さない。
 * @returns {{path:string, version:string, versionCode:number|null, package:string|null, abi:string, reused:boolean}}
 */
export function extractLibrary(inputs, { lib = DEFAULT_LIB, abi = DEFAULT_ABI, workDir = 'work', allowOtherPackage = false } = {}) {
  if (!SUPPORTED_ABIS.has(abi)) {
    throw new ApkError(
      `ABI ${abi} は解析できません（ELF32 は未対応）`,
      '64bit の分割 APK（config.arm64_v8a.apk）を用意してください。mcbedrock-get なら「64-bit」を選びます。',
    );
  }
  const paths = collectApks(inputs);
  const info = inspectApks(paths, { lib, abi });

  if (!info.manifest?.versionName) {
    throw new ApkError('base APK の versionName が読めません', 'base.apk（split の付いていない APK）も一緒に渡してください。');
  }
  const pkg = info.manifest.package;
  if (pkg && pkg !== MINECRAFT_PACKAGE && !allowOtherPackage) {
    throw new ApkError(`パッケージが ${pkg} です（${MINECRAFT_PACKAGE} を想定）`, '別のアプリを解析するなら --any-package を付けてください。');
  }
  const mismatched = info.apks.filter((a) => a.versionCode !== null && info.manifest.versionCode !== null && a.versionCode !== info.manifest.versionCode);
  if (mismatched.length) {
    throw new ApkError(
      `版の違う APK が混ざっています: ${mismatched.map((a) => `${path.basename(a.path)} (${a.versionCode})`).join(', ')}`,
      `base は versionCode ${info.manifest.versionCode} です。同じ版の一式だけを渡してください。`,
    );
  }
  if (!info.lib) {
    throw new ApkError(
      `lib/${abi}/${lib} がどの APK にもありません`,
      info.abis.length
        ? `${lib} がある ABI: ${info.abis.join(', ')}。分割 APK（config.${abi.replace(/-/g, '_')}.apk）を渡したか確認してください。`
        : 'ネイティブライブラリ入りの分割 APK（config.arm64_v8a.apk）も一緒に渡してください。',
    );
  }

  const version = info.manifest.versionName.trim();
  if (!/^[\w.+-]+$/.test(version)) throw new ApkError(`versionName を安全なパスにできません: ${version}`);
  const dir = path.join(workDir, 'android', version, abi);
  const dest = path.join(dir, lib);

  const z = new ZipReader(info.lib.apk);
  let data;
  try {
    data = z.read(info.lib.entry);
  } finally {
    z.close();
  }

  // 取り出したものが本当に解析できる ELF かを、書き出す前に確かめる
  const elf = new ElfFile(data);
  const expected = abi === 'arm64-v8a' ? 'aarch64' : 'x86-64';
  if (elf.machineName !== expected) {
    throw new ApkError(`${lib} のアーキテクチャが ${elf.machineName} です（${expected} を想定）`);
  }

  let reused = false;
  if (fs.existsSync(dest)) {
    const cur = fs.readFileSync(dest);
    reused = cur.length === data.length && cur.equals(data);
  }
  if (!reused) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dest);
  }

  return {
    path: dest,
    version,
    versionCode: info.manifest.versionCode ?? null,
    package: pkg ?? null,
    abi,
    size: data.length,
    buildId: elf.buildId(),
    sourceApk: path.basename(info.lib.apk),
    reused,
  };
}
