// 取得系: fetch / apk / track
import fs from 'node:fs';
import path from 'node:path';
import { buildProfile } from '../analysis/profile.js';
import { fetchServerBinary, CHANNELS } from '../net/bds.js';
import { extractLibrary, inspectApks, collectApks, ApkError, DEFAULT_ABI, DEFAULT_LIB } from '../apk/extract.js';
import { PreflightError } from '../lib/preflight.js';
import { str } from '../lib/args.js';
import { profilePath } from '../lib/versions.js';
import { recordProfile } from '../lib/store.js';

function channelsFrom(args) {
  const channels = args.length ? args : Object.keys(CHANNELS);
  for (const c of channels) {
    if (c === 'android') {
      throw new ApkError('android は自動取得できません', 'APK は購入者本人が用意するものです。`apk <APK のフォルダ> --scan` を使ってください。');
    }
    if (!CHANNELS[c]) throw new PreflightError(`channel は ${Object.keys(CHANNELS).join(' か ')} です（指定: ${c}）`);
  }
  return channels;
}

export const fetchCmd = {
  name: 'fetch',
  group: '取得',
  usage: 'fetch [release|preview]',
  summary: '公式サイトから BDS をダウンロード',
  example: 'fetch release',
  run: async ({ args, dirs }) => {
    for (const c of channelsFrom(args)) {
      const r = await fetchServerBinary(c, dirs.work);
      console.log(`${r.channel} ${r.version} → ${r.path}`);
    }
  },
};

export const apk = {
  group: '取得',
  usage: 'apk <APK|フォルダ>... [--scan] [--dry-run] [--abi A]',
  summary: '自分の APK 一式から libminecraftpe.so を取り出す',
  example: 'apk ~/Downloads/minecraft-apk --scan',
  minArgs: 1,
  heavy: true,
  run({ args, flags, dirs }) {
    const abi = str(flags.abi) ?? DEFAULT_ABI;
    const lib = str(flags.lib) ?? DEFAULT_LIB;

    if (flags['dry-run']) {
      const info = inspectApks(collectApks(args), { abi, lib });
      for (const a of info.apks) {
        console.log(`  ${path.basename(a.path).padEnd(32)} ${a.split ? `split=${a.split}` : 'base'}  ${a.versionName ?? ''} (${a.versionCode ?? '?'})`);
      }
      console.log(`\n  版          ${info.manifest?.versionName ?? '不明'} (${info.manifest?.versionCode ?? '?'})`);
      console.log(`  ${lib} の ABI  ${info.abis.join(', ') || 'なし'}`);
      console.log(`  取り出し元   ${info.lib ? `${path.basename(info.lib.apk)} (${info.lib.size.toLocaleString()} バイト)` : '見つかりません'}`);
      return;
    }

    const r = extractLibrary(args, { abi, lib, workDir: dirs.work, allowOtherPackage: Boolean(flags['any-package']) });
    console.log(`${r.package ?? '?'} ${r.version} (versionCode ${r.versionCode ?? '?'}, ${r.abi})`);
    console.log(`  ${r.sourceApk} → ${r.path}${r.reused ? '（同じ内容のため再利用）' : ''}`);
    if (!flags.scan) {
      console.log(`\n次は解析です: npm run bb -- apk ${args.join(' ')} --scan`);
      return;
    }
    const profile = buildProfile(r.path, {
      version: r.version,
      channel: 'android',
      source: { kind: 'apk', package: r.package, versionCode: r.versionCode, abi: r.abi, buildId: r.buildId },
    });
    const rec = recordProfile(profile, dirs);
    console.log(`→ ${rec.profilePath}`);
    if (rec.diffPath) console.log(`→ ${rec.diffPath}${rec.changed ? '' : '（差分なし）'}`);
  },
};

export const track = {
  group: '取得',
  usage: 'track [release|preview]',
  summary: '取得 → 解析 → 前回との差分までまとめて（CI 用）',
  heavy: true,
  run: async ({ args, dirs }) => {
    let changed = 0;
    for (const channel of channelsFrom(args)) {
      const bin = await fetchServerBinary(channel, dirs.work);
      if (fs.existsSync(profilePath(dirs.profiles, channel, bin.version))) {
        console.log(`${channel} ${bin.version}: 解析済み`);
        continue;
      }
      const rec = recordProfile(
        buildProfile(bin.path, { version: bin.version, channel, quiet: true, symbolsPath: bin.symbolsPath, langPath: bin.langPath }),
        dirs,
      );
      if (rec.changed) changed++;
      console.log(`${channel} ${bin.version}: 解析しました${rec.diffPath ? ` → ${rec.diffPath}` : ''}`);
    }
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  },
};
