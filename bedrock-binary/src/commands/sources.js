// 素材まわり: sources / names
import fs from 'node:fs';
import path from 'node:path';
import { ZipReader } from '../apk/zip.js';
import { collectApks } from '../apk/extract.js';
import { inventory, formatInventory } from '../analysis/sources.js';
import { buildDictionary } from '../analysis/identify.js';
import { loadProfile } from '../analysis/profile.js';
import { requireFile, PreflightError } from '../lib/preflight.js';
import { str } from '../lib/args.js';

const DICTIONARY = new URL('../../data/enum-names.json', import.meta.url);

/** zip 1 本のエントリ一覧 */
function entriesOf(file) {
  const zip = new ZipReader(file);
  try {
    return zip.entries.map((e) => ({ name: e.name, size: e.size }));
  } finally {
    zip.close();
  }
}

export const sources = {
  name: 'sources',
  group: '素材',
  usage: 'sources <BDS の zip | APK | APK のフォルダ> [--json]',
  summary: '配布物の中身を、採用 / 照合 / 見送りに分けて表示する',
  example: 'sources work/release/bds.zip',
  minArgs: 1,
  run({ args, flags }) {
    const first = requireFile(args[0]);
    const isApk = /\.apk$/i.test(first) || fs.statSync(first).isDirectory();
    const files = isApk ? collectApks(args) : [first];
    const entries = files.flatMap(entriesOf);
    const inv = inventory(entries, isApk ? 'apk' : 'bds');

    if (flags.json) {
      console.log(JSON.stringify({ files: files.map((f) => path.basename(f)), ...inv }, null, 2));
      return;
    }
    for (const line of formatInventory(inv)) console.log(line);
    console.log('\n採用 = 解析に使う / 照合 = 名前の裏取りだけ / 見送り = 使わない');
    console.log('「表に無いもの」に中身があれば、版で増えたファイルです。src/analysis/sources.js に足してください。');
  },
};

export const names = {
  name: 'names',
  group: '素材',
  usage: 'names [プロファイル...] [--out FILE]',
  summary: '型名の辞書（data/enum-names.json）を作り直す',
  example: 'names profiles/release-1.26.51.1.json',
  run({ args, flags }) {
    const files = args.length
      ? args.map(requireFile)
      : (fs.existsSync('profiles') ? fs.readdirSync('profiles') : [])
          .filter((f) => f.startsWith('release-') && f.endsWith('.json'))
          .map((f) => path.join('profiles', f));
    if (!files.length) throw new PreflightError('プロファイルがありません', 'まず npm start で release を解析してください。');

    const sourcesList = files.map((f) => {
      const profile = loadProfile(f);
      return { profile, label: `${profile.channel ?? '?'}-${profile.version ?? '?'}` };
    });
    const dict = buildDictionary(sourcesList);
    const named = sourcesList.filter((s) => (s.profile.enums ?? []).some((e) => e.source === 'cereal' || e.source === 'symbols'));
    if (!dict.entries.length) {
      throw new PreflightError(
        '型名が取れているプロファイルがありません',
        'cereal の文字列がある release ビルドか、bedrock_server_symbols.debug つきの解析結果が要ります。',
      );
    }
    const out = str(flags.out) ?? new URL(DICTIONARY).pathname;
    fs.writeFileSync(out, `${JSON.stringify(dict, null, 1)}\n`);
    console.log(`${dict.entries.length} 個の型名を ${named.length} 本のプロファイルから集めました`);
    console.log(`→ ${out}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  },
};
