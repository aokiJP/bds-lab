// バイナリ 1 本を「プロファイル」という 1 個の JSON に落とす。
// 以降のレポート生成も版間比較も、バイナリ本体ではなくこの JSON だけを見る。
// 243 MB を持ち回らずに済み、過去版の記録を git に置ける。
import fs from 'node:fs';
import path from 'node:path';
import { ElfFile } from '../elf/reader.js';
import { StringTable } from '../elf/strings.js';
import { FunctionTable } from '../elf/functions.js';
import { XrefIndex } from '../analysis/xref.js';
import { extractEnums } from '../analysis/enums.js';
import { extractPointerTables, alignWithTables } from '../analysis/tables.js';
import { extractCommands } from '../analysis/commands.js';
import { extractWss } from '../analysis/wss.js';
import { applyDictionary } from '../analysis/identify.js';
import { SymbolTable } from '../elf/symbols.js';
import { parseLang, attachCommandTexts } from '../analysis/lang.js';
import { extractFacts, summarizeFacts } from '../analysis/facts.js';
import { extractPacketIds, linkPacketNames } from '../analysis/packets.js';

const DATA = new URL('../../data/', import.meta.url);
const readData = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(new URL(f, DATA), 'utf8'));
  } catch {
    return fallback;
  }
};

export const PROFILE_FORMAT = 1;

// 識別子らしい文字列だけを記録する。12 万件の生データは版間比較の役に立たないうえ、
// git に置くには大きすぎる。
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{2,63}$/;

/**
 * ELF を読んで相互参照まで作る。scan と enum（バイナリ直読み）の共通部分。
 * @param {Buffer|import('../elf/reader.js').ElfFile} input
 */
export function analyzeElf(input, { log = () => {} } = {}) {
  const elf = input instanceof ElfFile ? input : new ElfFile(input);
  const ro = elf.require('.rodata');
  const strings = new StringTable(elf.data(ro), Number(ro.addr));
  log(`  ${elf.machineName} / 文字列 ${strings.size.toLocaleString()} 件`);

  const functions = new FunctionTable(elf);
  log(`  関数 ${functions.count.toLocaleString()} 個（.eh_frame_hdr 由来）`);

  log('  相互参照を走査中...');
  const xref = new XrefIndex(elf, strings, functions);
  return { elf, strings, functions, xref };
}

/**
 * @param {string} binaryPath
 * @param {{version?:string, channel?:string, quiet?:boolean, source?:object}} opts
 *   source: バイナリの出どころ（APK から取り出した場合の versionCode など）。プロファイルにそのまま残す
 */
export function buildProfile(binaryPath, opts = {}) {
  const log = opts.quiet ? () => {} : (m) => console.log(m);
  const t0 = Date.now();

  log(`読み込み: ${binaryPath}`);
  const { elf, strings, functions, xref } = analyzeElf(fs.readFileSync(binaryPath), { log });
  const summary = elf.summary();
  const stats = xref.stats();
  log(`  参照あり ${stats.referenced.toLocaleString()} / 参照なし ${(stats.strings - stats.referenced).toLocaleString()}`);
  if (elf.machineName === 'aarch64') {
    log(`  経路: コード ${stats.codeRefs.toLocaleString()} / スロット経由 ${stats.slotRefs.toLocaleString()} / 再配置 ${stats.relocPointers.toLocaleString()}`);
    if (stats.codeRefs === 0) log('  ⚠ コードからの参照が 0 件です。.text の形が想定と違う可能性があります');
  }

  // シンボルファイル（bedrock_server_symbols.debug）があれば、型名はそこから取る。
  // cereal の文字列が消えた preview でも、これがあれば名前は確定する。
  let symbols = null;
  if (opts.symbolsPath) {
    symbols = new SymbolTable(new ElfFile(fs.readFileSync(opts.symbolsPath)));
    log(`  シンボル ${symbols.count.toLocaleString()} 個（${path.basename(opts.symbolsPath)}）`);
  }

  const tables = extractPointerTables(xref);
  const raw = extractEnums(xref, symbols ? { symbolName: (a) => symbols.nameAt(a) } : {});
  // 型名が取れないビルド（preview / Android）では、ここで名前と値の頭が確定する
  const dict = opts.dictionary ?? readData('enum-names.json', null);
  const named = applyDictionary(raw, dict ?? { entries: [] });
  if (named.named) {
    log(`  名前辞書で ${named.named} 個の enum に型名を復元（うち ${named.headFixed} 個は値の先頭がずれていた）`);
  }
  const enums = alignWithTables(raw, tables);
  log(`  ポインタ配列 ${tables.length} 本（うち ${enums.filter((e) => e.ordered).length} 個の enum の並びを確定）`);
  const cereal = enums.filter((e) => e.source !== 'shape').length;
  log(
    `  enum ${enums.length} 個（型名が確定 ${cereal} / 形から推定 ${enums.length - cereal}） ` +
      `値 ${enums.reduce((a, e) => a + e.values.length, 0).toLocaleString()} 件`,
  );

  // パケット ID は enum の並びではなく、各パケットクラスの getId() から（src/analysis/packets.js）
  const pk = extractPacketIds(elf);
  const packetEnum = enums.find((e) => e.name === 'MinecraftPacketIds')?.values ?? [];
  const linked = pk.basis ? linkPacketNames(pk.list, packetEnum) : { list: [], noClass: [] };
  const packets = { basis: pk.basis, slot: pk.slot, reason: pk.reason, list: linked.list, noClass: linked.noClass };
  log(pk.basis ? `  パケット ${linked.list.length} 個（ID は getId() から。列挙子と結び付いたもの ${linked.list.filter((p) => p.name).length}）` : `  パケット ID: 読めませんでした（${pk.reason}）`);

  const commands = extractCommands(xref, readData('official-commands.json', {}).commands ?? []);
  const undocumented = commands.filter((c) => c.inOfficialMetadata === false).length;
  log(`  コマンド ${commands.length} 個（公式メタデータに無いもの ${undocumented} 個）`);

  // 配布物の .lang があれば、翻訳キーに文面を当てる
  let texts = null;
  if (opts.langPath && fs.existsSync(opts.langPath)) {
    texts = attachCommandTexts(commands, parseLang(fs.readFileSync(opts.langPath, 'utf8')));
    log(`  説明文 ${texts.withText} / ${texts.total} 件（${path.basename(opts.langPath)}。文面が無いもの ${texts.withoutText} 個）`);
  }

  const wss = extractWss(xref, enums, readData('known-wss-events.json', {}).names ?? [], {
    side: opts.channel === 'android' ? 'client' : 'server',
  });
  log(
    `  WSS: 封筒キー ${wss.envelope.length} / イベント種別 ${wss.eventTypes.reduce((a, e) => a + e.values.length, 0)} / ` +
      `出回っている名前 ${wss.summary.knownTotal} 中 バイナリに ${wss.summary.presentInBinary}・参照あり ${wss.summary.referencedInBinary}`,
  );

  const facts = extractFacts(strings, xref);
  log(`  ${summarizeFacts(facts)}`);

  // 識別子は「参照あり / なし」を分けて持つ。
  // 参照なしはデッドコード由来で、サーバーでは絶対に使われないことの証拠になる。
  const live = [];
  const dead = [];
  const seen = new Set();
  for (const { value } of strings.entries()) {
    if (!IDENTIFIER.test(value) || seen.has(value)) continue;
    seen.add(value);
    (xref.referenced.has(value) ? live : dead).push(value);
  }
  live.sort();
  dead.sort();

  return {
    format: PROFILE_FORMAT,
    version: opts.version ?? null,
    channel: opts.channel ?? null,
    generatedAt: new Date().toISOString(),
    binary: {
      // 絶対パスは環境依存で差分のノイズになるので、ファイル名だけ残す
      path: path.basename(binaryPath),
      ...summary,
      symbols: symbols ? { file: path.basename(opts.symbolsPath), functions: symbols.count } : null,
    },
    source: opts.source ?? null,
    stats: {
      ...stats,
      functions: functions.count,
      identifiersLive: live.length,
      identifiersDead: dead.length,
      packets: packets.list.length,
      commands: commands.length,
      commandsUndocumented: undocumented,
      commandsWithText: texts?.withText ?? null,
      namespacedIdentifiers: Object.values(facts.namespaced.byNamespace).reduce((a, g) => a + g.total, 0),
      molang: facts.molang.total,
      textKeys: facts.textKeys.total,
      scriptModules: facts.scriptModules.length,
      elapsedMs: Date.now() - t0,
    },
    enums: enums.map((e) => ({
      name: e.name,
      short: e.shortName,
      source: e.source,
      // 形から推定した名前は仮のもの。辞書で確定したものは nameFrom / nameScore がつく
      provisional: Boolean(e.nameProvisional),
      nameFrom: e.nameFrom ?? undefined,
      nameScore: e.nameScore ?? undefined,
      ordered: Boolean(e.ordered),
      addr: e.addr,
      values: e.values,
      // 落とした頭（型名）。判断が誤っていたときに後から検証できるよう残す
      head: e.trimmedHead?.length ? e.trimmedHead : undefined,
    })),
    facts,
    pointerTables: tables.length,
    packets,
    commands,
    wss,
    identifiers: { live, dead },
  };
}

export function loadProfile(p) {
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (d.format !== PROFILE_FORMAT) {
    throw new Error(`${p}: プロファイル形式 ${d.format} は未対応です（このツールは ${PROFILE_FORMAT}）`);
  }
  return d;
}
