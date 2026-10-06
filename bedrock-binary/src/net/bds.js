// BDS を公式の配布経路から取ってくる。
// Mojang が用意しているリンク API がそのまま使えるので、スクレイピングは要らない。
// APK 側には同等の公開 API が無く、正規に自動化する方法は存在しない（README 参照）。
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fetchJson, fetchBuffer } from './http.js';
import { ZipReader } from '../apk/zip.js';
import { PreflightError, assert } from '../lib/preflight.js';
import { inventory, formatInventory } from '../analysis/sources.js';

const LINKS_API = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';

// 素っ気ない UA だと配信側に弾かれることがある
const HEADERS = { Referer: 'https://www.minecraft.net/' };

export const CHANNELS = {
  release: 'serverBedrockLinux',
  preview: 'serverBedrockPreviewLinux',
};

export async function resolveDownload(channel) {
  const kind = CHANNELS[channel];
  assert(kind, `channel は ${Object.keys(CHANNELS).join(' か ')} です（指定: ${channel}）`);

  const json = await fetchJson(LINKS_API, { headers: HEADERS, label: 'links API' });
  const links = json?.result?.links;
  assert(Array.isArray(links), 'links API の形が変わっています（result.links が配列ではない）');

  const hit = links.find((l) => l.downloadType === kind);
  if (!hit) {
    throw new PreflightError(
      `${kind} が応答に含まれていません`,
      `返ってきた種別: ${links.map((l) => l.downloadType).join(', ')}`,
    );
  }
  const version = hit.downloadUrl.match(/bedrock-server-([\d.]+)\.zip/)?.[1];
  if (!version) throw new PreflightError(`URL からバージョンを取れません: ${hit.downloadUrl}`);
  return { url: hit.downloadUrl, version, channel };
}

/** 同梱の翻訳ファイル。英語だけ取る（他言語は同じキーの訳違い） */
const LANG_ENTRY = /^resource_packs\/vanilla\/texts\/en_US\.lang$/;
/** シンボルファイル。これがあると enum の型名が確定する */
const SYMBOLS_ENTRY = /symbols\.debug$/;
/** 展開すると場所を食うので、大きいものは明示されたときだけ取り出す */
const SYMBOLS_AUTO_LIMIT = 400 * 1024 * 1024;

/**
 * zip を落として bedrock_server だけ取り出す。既にあればそれを返す。
 * 展開は自前の ZIP リーダで行うので、unzip コマンドは要らない（Windows でもそのまま動く）。
 */
export async function fetchServerBinary(channel, workDir = 'work', { symbols = 'auto', quiet = false } = {}) {
  const { url, version } = await resolveDownload(channel);
  const dir = path.join(workDir, channel, version);
  const bin = path.join(dir, 'bedrock_server');
  const extra = () => ({
    symbolsPath: existsSync(path.join(dir, 'bedrock_server_symbols.debug')) ? path.join(dir, 'bedrock_server_symbols.debug') : null,
    langPath: existsSync(path.join(dir, 'en_US.lang')) ? path.join(dir, 'en_US.lang') : null,
  });
  if (existsSync(bin)) {
    console.log(`  ${channel} ${version}: 取得済み`);
    return { path: bin, version, channel, ...extra() };
  }

  console.log(`  ${channel} ${version}: ダウンロード中`);
  await fs.mkdir(dir, { recursive: true });
  const zipPath = path.join(dir, 'bds.zip');
  const buf = await fetchBuffer(url, { headers: HEADERS, label: `BDS ${version}` });
  // 200 MB 前後のはず。極端に小さければエラーページを掴んでいる
  assert(buf.length > 10_000_000, `zip が小さすぎます (${buf.length} bytes)`);
  await fs.writeFile(zipPath, buf);

  const zip = new ZipReader(zipPath);
  try {
    const entry = zip.entries.find((e) => e.name === 'bedrock_server' || e.name.endsWith('/bedrock_server'));
    if (!entry) {
      throw new PreflightError('zip の中に bedrock_server がありません', '配布物のレイアウトが変わった可能性があります。');
    }
    const tmp = `${bin}.${process.pid}.tmp`;
    await fs.writeFile(tmp, zip.read(entry), { mode: 0o755 });
    await fs.rename(tmp, bin);

    // 中身の棚卸し。何を使い、何を見送ったかを毎回記録する
    const inv = inventory(zip.entries.map((e) => ({ name: e.name, size: e.size })), 'bds');
    await fs.writeFile(path.join(dir, 'sources.json'), `${JSON.stringify({ channel, version, url, ...inv }, null, 2)}\n`);
    if (!quiet) for (const line of formatInventory(inv)) console.log(`  ${line}`);

    // 本体以外で使うもの。無ければ黙って諦める（版によって入っていない）
    const sym = zip.entries.find((e) => SYMBOLS_ENTRY.test(e.name));
    if (sym && (symbols === true || (symbols === 'auto' && sym.size <= SYMBOLS_AUTO_LIMIT))) {
      await fs.writeFile(path.join(dir, 'bedrock_server_symbols.debug'), zip.read(sym));
      console.log(`  シンボル: ${sym.name} (${(sym.size / 1024 / 1024).toFixed(0)} MB) を取り出しました`);
    } else if (sym) {
      console.log(`  シンボル: ${sym.name} は ${(sym.size / 1024 / 1024).toFixed(0)} MB あるため見送りました（--symbols で取り出す）`);
    }
    const lang = zip.entries.find((e) => LANG_ENTRY.test(e.name));
    if (lang) await fs.writeFile(path.join(dir, 'en_US.lang'), zip.read(lang));
  } finally {
    zip.close();
    // 展開後の zip は 80 MB 以上あって邪魔なので消す
    await fs.rm(zipPath, { force: true });
  }
  return { path: bin, version, channel, ...extra() };
}
