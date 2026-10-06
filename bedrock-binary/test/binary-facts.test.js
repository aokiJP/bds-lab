import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElfFile, SHT } from '../src/elf/reader.js';
import { SymbolTable, enumTypeFromSymbol, mangledParts } from '../src/elf/symbols.js';
import { extractEnums } from '../src/analysis/enums.js';
import { XrefIndex } from '../src/analysis/xref.js';
import { StringTable } from '../src/elf/strings.js';
import { FunctionTable } from '../src/elf/functions.js';
import { buildDictionary, applyDictionary, rawOf } from '../src/analysis/identify.js';
import { extractFacts } from '../src/analysis/facts.js';
import { extractWss } from '../src/analysis/wss.js';
import { inventory } from '../src/analysis/sources.js';
import { parseLang, attachCommandTexts } from '../src/analysis/lang.js';
import { buildElf, cstrings, ehFrameHdr, lea, symtab } from './helpers.js';

const mk = (s) => s.length + s;

// ---- シンボルからの型名 ----------------------------------------------------

test('マングル名から enum の型名だけを取り出す', () => {
  const plain = `_ZN${mk('cereal')}${mk('BasicFactory')}${mk('MinecraftPacketIds')}E${mk('scope')}Ev`;
  const nested = `_ZN${mk('cereal')}${mk('internal')}${mk('TypeSchema')}IN${mk('Connection')}${mk('DisconnectFailReason')}EE${mk('build')}Ev`;
  assert.equal(enumTypeFromSymbol(plain.replace('IdsE', 'IdsE')), null, 'テンプレート引数の開始が無いものは拾わない');
  assert.equal(enumTypeFromSymbol(`_ZN${mk('cereal')}${mk('BasicFactory')}I${mk('MinecraftPacketIds')}E${mk('scope')}Ev`), 'MinecraftPacketIds');
  assert.equal(enumTypeFromSymbol(nested), 'Connection::DisconnectFailReason');
  assert.equal(enumTypeFromSymbol('_ZN5Level4tickEv'), null);
  assert.equal(enumTypeFromSymbol('main'), null);
  assert.deepEqual(mangledParts('_ZN5Level4tickEv'), ['Level', 'tick']);
});

test('シンボル表を読んで、アドレスから名前を引く', () => {
  const { data, str } = symtab([{ name: '_ZN5Level4tickEv', addr: 0x20000 }]);
  const elf = new ElfFile(
    buildElf({
      sections: [
        { name: '.strtab', type: SHT.STRTAB, data: str, addr: 0 },
        { name: '.symtab', type: SHT.SYMTAB, data, addr: 0, link: 1, entsize: 24 },
      ],
    }),
  );
  const t = new SymbolTable(elf);
  assert.equal(t.count, 1);
  assert.equal(t.nameAt(0x20000), '_ZN5Level4tickEv');
  assert.equal(t.nameAt(0x30000), null);
});

/** 1 つの関数が values を順に読むだけの x86-64 バイナリ */
function binaryWith(values, { funcAddr = 0x20000 } = {}) {
  const RODATA = 0x10000;
  const HDR = 0x30000;
  const addrOf = (v) => RODATA + values.slice(0, values.indexOf(v)).reduce((a, s) => a + s.length + 1, 0);
  // 走査は末尾 7 バイトを見ないので、余白を足しておく
  const text = Buffer.concat([...values.map((v, i) => lea(funcAddr + i * 7, addrOf(v))), Buffer.alloc(16)]);
  return {
    RODATA, funcAddr,
    sections: [
      { name: '.rodata', data: cstrings(...values), addr: RODATA },
      { name: '.text', data: text, addr: funcAddr },
      { name: '.eh_frame_hdr', data: ehFrameHdr(HDR, [funcAddr]), addr: HDR },
    ],
  };
}

function analyze(values, extraSections = []) {
  const b = binaryWith(values);
  const elf = new ElfFile(buildElf({ sections: [...b.sections, ...extraSections] }));
  const strings = new StringTable(elf.data('.rodata'), 0x10000);
  const xref = new XrefIndex(elf, strings, new FunctionTable(elf));
  return { elf, strings, xref, funcAddr: b.funcAddr };
}

test('シンボルがあれば、形からの推定より優先して型名になる', () => {
  const values = ['SomethingElse', 'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
  const { xref, funcAddr } = analyze(values);

  const guessed = extractEnums(xref)[0];
  assert.equal(guessed.source, 'shape');
  assert.equal(guessed.name, 'SomethingElse', '形からの推定では先頭が名前になる');

  const mangled = `_ZN${mk('cereal')}${mk('BasicFactory')}I${mk('NatoAlphabet')}E${mk('scope')}Ev`;
  const named = extractEnums(xref, { symbolName: (a) => (a === funcAddr ? mangled : null) })[0];
  assert.equal(named.source, 'symbols');
  assert.equal(named.name, 'NatoAlphabet');
  assert.equal(named.nameProvisional, false);
});

// ---- 名前辞書 --------------------------------------------------------------

test('型名の無いビルドでも、中身から型名と値の先頭が戻る', () => {
  const values = ['Achievement', 'Interaction', 'PortalCreated', 'PortalUsed', 'MobKilled', 'CauldronUsed'];
  const dict = buildDictionary([
    {
      label: 'release-1.0.0.0',
      profile: { enums: [{ name: 'LegacyTelemetryEventPacketPayload::Type', short: 'Type', source: 'cereal', values }] },
    },
  ]);
  assert.equal(dict.entries.length, 1);

  // 型名が無いビルドでは、先頭の値が名前として持っていかれる
  const shaped = [{ name: 'Achievement', shortName: 'Achievement', source: 'shape', nameProvisional: true, raw: values, values: values.slice(1), addr: 1 }];
  const r = applyDictionary(shaped, dict);
  assert.equal(r.named, 1);
  assert.equal(r.headFixed, 1, '落ちていた先頭の値が戻っていない');
  assert.equal(shaped[0].name, 'LegacyTelemetryEventPacketPayload::Type');
  assert.equal(shaped[0].source, 'dictionary');
  assert.deepEqual(shaped[0].values, values);
  assert.equal(shaped[0].values.indexOf('Interaction'), 1, 'ID が 1 ずれたまま');
});

test('このビルドで確定している型名は、辞書で別の enum に付けない（同じ名前が 2 つにならない）', () => {
  const v = ['air', 'dirt', 'wood', 'metal', 'grate', 'water', 'lava'];
  const dict = buildDictionary([{ label: 'r', profile: { enums: [{ name: 'MaterialType', source: 'cereal', values: v }] } }]);
  const enums = [
    { name: 'MaterialType', source: 'cereal', nameProvisional: false, values: v, addr: 1 },
    { name: 'air', source: 'shape', nameProvisional: true, raw: v, values: v.slice(1), addr: 2 },   // 同じ型の 2 か所目の登録
  ];
  assert.equal(applyDictionary(enums, dict).named, 0);
  assert.equal(enums.filter((e) => e.name === 'MaterialType').length, 1);
  assert.equal(enums[1].source, 'shape');
});

test('中身が似ていないものには名前を付けない', () => {
  const dict = buildDictionary([
    { label: 'r', profile: { enums: [{ name: 'Fruits', source: 'cereal', values: ['Apple', 'Banana', 'Cherry', 'Durian', 'Elderberry', 'Fig'] }] } },
  ]);
  const other = [{ name: 'Alpha', source: 'shape', nameProvisional: true, values: ['Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'], addr: 2 }];
  assert.equal(applyDictionary(other, dict).named, 0);
  assert.equal(other[0].name, 'Alpha');
});

test('raw が無い古いプロファイルでも、名前を先頭に戻して扱う', () => {
  assert.deepEqual(rawOf({ name: 'Achievement', source: 'shape', values: ['Interaction'] }), ['Achievement', 'Interaction']);
  assert.deepEqual(rawOf({ name: 'X::Y', source: 'cereal', values: ['A'] }), ['A']);
});

// ---- WSS -------------------------------------------------------------------

test('型名が無くても、値の並びでイベント種別を見つける', () => {
  const values = ['Achievement', 'Interaction', 'PortalCreated', 'PortalUsed', 'MobKilled', 'PetDied_OBSOLETE'];
  const enums = [{ name: 'Achievement', source: 'shape', nameProvisional: true, values: values.slice(1) }];
  const stub = { byFunction: new Map(), referenced: new Set(), strings: { entries: () => [] } };
  const w = extractWss(stub, enums);
  assert.equal(w.eventTypes.length, 1);
  assert.equal(w.eventTypes[0].via, 'anchors');
  assert.equal(w.eventTypes[0].values[0].name, 'Achievement', '先頭の値が名前に吸われたまま');
  assert.deepEqual(w.eventTypes[0].values.at(-1), { id: 5, name: 'PetDied', obsolete: true });
});

test('封筒のキーは、messagePurpose を読む関数すべてから集める', () => {
  const stub = {
    byFunction: new Map([
      [1, ['messagePurpose', 'header', 'body']],
      [2, ['messagePurpose', 'requestId', 'eventName']],
      [3, ['somethingElse']],
    ]),
    referenced: new Set(),
    strings: { entries: () => [] },
  };
  const w = extractWss(stub, []);
  assert.equal(w.envelopeFunctions, 2);
  assert.deepEqual(w.envelope, ['body', 'eventName', 'header', 'messagePurpose', 'requestId']);
});

// ---- バイナリから拾うそのほかの事実 ----------------------------------------

test('名前空間つき識別子・Molang・翻訳キー・スクリプト API を分けて拾う', () => {
  const values = [
    'minecraft:zombie', 'minecraft:stone', 'custom:thing', 'query.is_baby',
    'commands.give.description', '@minecraft/server', '1.19.0', 'JustAnIdentifier',
  ];
  const { strings, xref } = analyze(values);
  const f = extractFacts(strings, xref);

  assert.deepEqual(f.namespaced.namespaces.sort(), ['custom', 'minecraft']);
  assert.equal(f.namespaced.byNamespace.minecraft.total, 2);
  assert.equal(f.namespaced.byNamespace.minecraft.referenced, 2, '参照済みのはずの識別子が dead 側にいる');
  assert.deepEqual(f.molang.live, ['query.is_baby']);
  assert.deepEqual(f.textKeys.live, ['commands.give.description']);
  assert.deepEqual(f.scriptModules, [{ name: '@minecraft/server', referenced: true, versions: ['1.19.0'] }]);
});

test('参照されていない識別子は string_only 側に入る', () => {
  const b = binaryWith(['minecraft:used']);
  // 参照しない文字列を .rodata の後ろにだけ足す（前に足すとアドレスがずれる）
  b.sections[0] = { name: '.rodata', data: cstrings('minecraft:used', 'minecraft:unused'), addr: 0x10000 };
  const elf = new ElfFile(buildElf({ sections: b.sections }));
  const strings = new StringTable(elf.data('.rodata'), 0x10000);
  const xref = new XrefIndex(elf, strings, new FunctionTable(elf));
  const f = extractFacts(strings, xref);
  assert.deepEqual(f.namespaced.byNamespace.minecraft.live, ['minecraft:used']);
  assert.deepEqual(f.namespaced.byNamespace.minecraft.dead, ['minecraft:unused']);
});

// ---- 配布物の棚卸し --------------------------------------------------------

test('配布物の中身を、採用 / 照合 / 見送りに分ける', () => {
  const inv = inventory(
    [
      { name: 'bedrock_server', size: 200 },
      { name: 'bedrock_server_symbols.debug', size: 100 },
      { name: 'resource_packs/vanilla/texts/en_US.lang', size: 10 },
      { name: 'behavior_packs/vanilla/entities/zombie.json', size: 5 },
      { name: 'server.properties', size: 1 },
      { name: 'newthing.bin', size: 2 },
    ],
    'bds',
  );
  const by = Object.fromEntries(inv.groups.map((g) => [g.key, g]));
  assert.equal(by.server_binary.use, 'adopt');
  assert.equal(by.symbols.files, 1);
  assert.equal(by.texts.use, 'check', '文面は出さない方針なので採用ではない');
  assert.equal(by.config.use, 'skip');
  assert.equal(by.unknown.files, 1, '表に無いものが埋もれている');
  assert.deepEqual(by.unknown.samples, ['newthing.bin']);
});

test('APK 側は .so と manifest だけを採用する', () => {
  const inv = inventory(
    [
      { name: 'lib/arm64-v8a/libminecraftpe.so', size: 90 },
      { name: 'lib/armeabi-v7a/libminecraftpe.so', size: 80 },
      { name: 'AndroidManifest.xml', size: 3 },
      { name: 'classes.dex', size: 7 },
    ],
    'apk',
  );
  const by = Object.fromEntries(inv.groups.map((g) => [g.key, g]));
  assert.equal(by.client_lib.files, 1);
  assert.equal(by.other_abi.files, 1, '32bit まで採用してしまっている');
  assert.equal(by.android.files, 1);
});

// ---- 翻訳表は「あるか」だけ ------------------------------------------------

test('翻訳表からは文面を取り込まず、有無だけを見る', () => {
  const lang = parseLang('# コメント\ncommands.give.description=Gives an item\t訳注\n\nbroken\n');
  assert.equal(lang.get('commands.give.description'), 'Gives an item');
  const commands = [
    { name: 'give', descriptionKey: 'commands.give.description' },
    { name: 'internal', descriptionKey: 'commands.internal.description' },
  ];
  const r = attachCommandTexts(commands, lang);
  assert.deepEqual(r, { total: 2, withText: 1, withoutText: 1 });
  assert.equal(commands[0].hasText, true);
  assert.equal(commands[1].hasText, false);
  assert.equal(commands[0].description, undefined, '文面を取り込んでしまっている');
});
