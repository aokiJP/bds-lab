// 解析系: scan / info / enum / strings
import fs from 'node:fs';
import path from 'node:path';
import { ElfFile } from '../elf/reader.js';
import { extractEnums, indexEnums } from '../analysis/enums.js';
import { analyzeElf, buildProfile, loadProfile } from '../analysis/profile.js';
import { requireFile, PreflightError } from '../lib/preflight.js';
import { str } from '../lib/args.js';
import { inferChannel, inferVersion, profilePath } from '../lib/versions.js';
import { writeJson } from '../lib/store.js';
import { nameConfirmed, SOURCE_LABEL } from '../analysis/identify.js';
import { padDisplay } from '../lib/text.js';

/** バイナリと同じフォルダにある補助ファイル。無ければ null */
function besideBinary(binary, name) {
  const p = path.join(path.dirname(binary), name);
  return fs.existsSync(p) ? p : null;
}

export const scan = {
  group: '解析',
  usage: 'scan <バイナリ> [--version V] [--channel C] [--symbols F] [--lang F] [--out FILE]',
  summary: 'バイナリを解析してプロファイル JSON を書く',
  example: 'scan work/release/1.26.51.1/bedrock_server',
  minArgs: 1,
  heavy: true,
  run({ args, flags, dirs }) {
    const p = buildProfile(requireFile(args[0]), {
      version: str(flags.version) ?? inferVersion(args[0]),
      channel: str(flags.channel) ?? inferChannel(args[0]),
      // 同じフォルダに一緒に取り出したものがあれば、指定が無くても使う
      symbolsPath: str(flags.symbols) ?? besideBinary(args[0], 'bedrock_server_symbols.debug'),
      langPath: str(flags.lang) ?? besideBinary(args[0], 'en_US.lang'),
    });
    const out = str(flags.out) ?? profilePath(dirs.profiles, p.channel ?? 'unknown', p.version ?? 'unknown');
    writeJson(out, p);
    console.log(`→ ${out}  (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
  },
};

export const info = {
  group: '解析',
  usage: 'info <バイナリ>',
  summary: 'ELF のアーキテクチャとセクションを表示',
  minArgs: 1,
  heavy: true,
  run({ args }) {
    const elf = new ElfFile(fs.readFileSync(requireFile(args[0])));
    const s = elf.summary();
    console.log(args[0]);
    for (const [k, v] of [
      ['アーキテクチャ', s.machine],
      ['種別', s.type],
      ['build-id', s.buildId ?? '(なし)'],
      ['ストリップ', s.stripped ? 'されている' : 'されていない'],
      ['サイズ', `${s.size.toLocaleString()} バイト`],
    ]) console.log(`  ${k.padEnd(14)} ${v}`);
    console.log('\n  セクション');
    for (const sec of elf.sections) {
      if (!sec.name || sec.size === 0) continue;
      console.log(`    ${sec.name.padEnd(20)} type=0x${sec.type.toString(16).padStart(8, '0')} addr=0x${Number(sec.addr).toString(16).padStart(9)} size=${sec.size.toLocaleString().padStart(12)}`);
    }
  },
};

function loadEnums(p) {
  if (p.endsWith('.json')) return loadProfile(p).enums.map((e) => ({ ...e, shortName: e.short }));
  return extractEnums(analyzeElf(fs.readFileSync(p)).xref);
}

export const enumCmd = {
  name: 'enum',
  group: '解析',
  usage: 'enum <プロファイル|バイナリ> [名前] [--cereal]',
  summary: 'enum を引く。名前を省くと一覧',
  example: 'enum profiles/release-1.21.124.2.json MinecraftPacketIds',
  minArgs: 1,
  heavy: true,
  run({ args, flags }) {
    const enums = loadEnums(requireFile(args[0]));
    if (!args[1]) {
      for (const e of [...enums].sort((x, y) => y.values.length - x.values.length)) {
        if (flags.cereal && !nameConfirmed(e)) continue;
        console.log(`${String(e.values.length).padStart(4)}  ${padDisplay(SOURCE_LABEL[e.source] ?? e.source ?? '?', 10)}  ${e.name}`);
      }
      console.log(`\n${enums.length} 個`);
      return;
    }
    const hit = indexEnums(enums).get(args[1].toLowerCase());
    if (!hit) {
      const near = enums.filter((e) => e.name.toLowerCase().includes(args[1].toLowerCase()));
      throw new PreflightError(
        `enum \`${args[1]}\` は見つかりません`,
        near.length ? `近いもの: ${near.slice(0, 8).map((e) => e.name).join(', ')}` : '名前を省くと一覧が出ます。',
      );
    }
    console.log(`${hit.name}  (${hit.values.length} 値)`);
    for (const [i, v] of hit.values.entries()) console.log(`${String(i).padStart(4)}  ${v}`);
  },
};

export const strings = {
  group: '解析',
  usage: 'strings <プロファイル> [パターン] [--dead] [--limit N]',
  summary: '識別子を検索。--dead で「どこからも使われていないもの」',
  example: 'strings profiles/release-1.21.124.2.json Block --dead',
  minArgs: 1,
  run({ args, flags }) {
    const p = loadProfile(requireFile(args[0]));
    const list = flags.dead ? p.identifiers.dead : p.identifiers.live;
    let re = null;
    if (args[1]) {
      try {
        re = new RegExp(args[1], 'i');
      } catch (e) {
        throw new PreflightError(`パターンが正規表現として不正です: ${e.message}`);
      }
    }
    const hits = re ? list.filter((s) => re.test(s)) : list;
    const limit = Number.parseInt(str(flags.limit) ?? '500', 10) || 500;
    for (const s of hits.slice(0, limit)) console.log(s);
    console.log(`\n${hits.length} 件${hits.length > limit ? `（先頭 ${limit} 件を表示）` : ''}`);
  },
};
