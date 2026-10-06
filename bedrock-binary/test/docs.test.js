import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeMetadata } from '../src/report/metadata.js';
import { buildSite, slugOf } from '../src/report/site.js';

const profile = {
  version: '1.2.3.4',
  channel: 'release',
  generatedAt: '2026-01-01T00:00:00.000Z',
  binary: { buildId: 'abc123', machine: 'x86-64', size: 1 },
  stats: { functions: 10, strings: 100 },
  enums: [
    { name: 'Net::MinecraftPacketIds', short: 'MinecraftPacketIds', source: 'cereal', ordered: true, addr: 0x1000, values: ['KeepAlive', 'Login'] },
    { name: 'Loose', short: 'Loose', source: 'shape', ordered: false, addr: 0x2000, values: ['A1', 'B2'] },
  ],
  identifiers: { live: ['Live1'], dead: ['BlockBroken'] },
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bb-'));

test('名前空間つきの型名をファイル名にできる', () => {
  assert.equal(slugOf('Net::MinecraftPacketIds'), 'Net-MinecraftPacketIds');
  assert.equal(slugOf('Editor::Widgets::Type'), 'Editor-Widgets-Type');
});

const PACKETS = ['KeepAlive', 'Login', 'PlayStatus', 'ServerToClientHandshake'];
const full = {
  ...profile,
  enums: [
    { name: 'Net::MinecraftPacketIds', short: 'MinecraftPacketIds', source: 'cereal', ordered: true, addr: 0x1000, values: PACKETS },
    { name: 'TextPacketType', short: 'TextPacketType', source: 'cereal', ordered: false, addr: 0x2000, values: ['raw', 'chat', 'translate', 'popup', 'MessageOnly', 'TextPacketPayload'] },
    // 名前が崩れているが値で見つかるもの（cereal の無いビルドを模す）
    { name: 'Garbage', short: 'Garbage', source: 'shape', ordered: false, addr: 0x3000, values: ['Any', 'GameDirectors', 'Admin', 'Host', 'Owner', 'Internal'] },
    // 名前は合っているが中身が違うもの。出してはいけない
    { name: 'PlayStatus', short: 'PlayStatus', source: 'shape', ordered: false, addr: 0x4000, values: ['identifier', 'weight', 'rarity'] },
    { name: 'Editor::LogLevel', short: 'LogLevel', source: 'cereal', ordered: false, addr: 0x5000, values: ['Info', 'Warning', 'Error'] },
    { name: 'Loose', short: 'Loose', source: 'shape', ordered: false, addr: 0x6000, values: ['A1', 'B2'] },
  ],
  commands: [{ name: 'worldbuilder', descriptionKey: 'commands.worldbuilder.description', related: [], addr: 1, inOfficialMetadata: false }],
  wss: {
    envelope: ['body', 'header', 'messagePurpose'],
    eventTypes: [],
    knownNames: [
      { name: 'PlayerMessage', present: true, referenced: true },
      { name: 'BlockBroken', present: true, referenced: false },
      { name: 'ItemCrafted', present: false, referenced: false },
    ],
  },
  identifiers: { live: ['event', 'header'], dead: ['subscribe'] },
};
const read = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, 'metadata', rel), 'utf8'));

test('bedrock-samples と同じ階層で、schema / molang / doc は作らない', () => {
  const dir = tmp();
  writeMetadata(full, dir);
  const dirs = fs.readdirSync(path.join(dir, 'metadata')).sort();
  assert.deepEqual(dirs, ['command_modules', 'enum_modules', 'packet_modules', 'version.json', 'wss_modules']);
  const m = read(dir, 'packet_modules/mojang-packet-ids.json');
  assert.equal(m.module_type, 'binary');
  assert.equal(m.source_binary.side, 'server');
  // getId() の番号が無い（古い）プロファイル: 値の並びは番号ではないので名前だけ
  assert.deepEqual(m.data_items[0].values.slice(0, 2), ['KeepAlive', 'Login']);
  assert.equal(m.data_items[0].id_basis, 'names_only');
});

test('パケット ID は getId() から読んだ番号で出す（値の並びの番号ではない）', () => {
  const dir = tmp();
  const list = [{ id: 1, class: 'LoginPacket', name: 'Login' }, { id: 9, class: 'TextPacket', name: 'Text' }, { id: 300, class: 'CameraInstructionPacket', name: null }];
  writeMetadata({ ...full, packets: { basis: 'getId', slot: 2, list, noClass: [{ name: 'KeepAlive', id: 0 }] } }, dir);
  const item = read(dir, 'packet_modules/mojang-packet-ids.json').data_items[0];
  assert.equal(item.id_basis, 'code_getid');
  assert.deepEqual(item.values, [{ id: 1, name: 'Login', class: 'LoginPacket' }, { id: 9, name: 'Text', class: 'TextPacket' }, { id: 300, name: 'CameraInstruction', class: 'CameraInstructionPacket' }]);
  const site = tmp();
  buildSite({ ...profile, packets: { basis: 'getId', slot: 2, list, noClass: [{ name: 'KeepAlive', id: 0 }] } }, site);
  const html = fs.readFileSync(path.join(site, 'packets.html'), 'utf8');
  assert.match(html, /<td class="num">300<\/td><td class="num">0x12c<\/td><td><code>CameraInstructionPacket<\/code>/);
  assert.match(html, /KeepAlive \(0\)/);
});

test('値の後ろに混ざった型名や表記の違う語は落とす', () => {
  const dir = tmp();
  writeMetadata(full, dir);
  const t = read(dir, 'packet_modules/mojang-display.json').data_items.find((x) => x.key === 'text_type');
  assert.deepEqual(t.values.map((v) => v.name), ['raw', 'chat', 'translate', 'popup']);
  assert.equal(t.id_basis, 'declaration_order');
  assert.deepEqual(t.trimmed.tail, ['MessageOnly', 'TextPacketPayload']);
});

test('名前が崩れていても先頭の値で見つけ、名前が合っていても中身が違えば出さない', () => {
  const dir = tmp();
  writeMetadata(full, dir);
  const perm = read(dir, 'command_modules/mojang-command-context.json').data_items.find((x) => x.key === 'permission_level');
  assert.equal(perm.name_source, 'anchors');
  assert.equal(perm.name, 'CommandPermissionLevel');
  const v = read(dir, 'version.json');
  const skippedPlay = v.skipped.find((x) => x.key === 'play_status');
  assert.match(skippedPlay.reason, /先頭が想定と違います/);
  assert.equal(fs.existsSync(path.join(dir, 'metadata/packet_modules/mojang-login-flow.json')), false);
});

test('WSS のイベント名は referenced / string_only / absent に分ける', () => {
  const dir = tmp();
  writeMetadata(full, dir);
  const e = read(dir, 'wss_modules/mojang-wss-events.json');
  assert.deepEqual(e.data_items, [
    { name: 'PlayerMessage', status: 'referenced' },
    { name: 'BlockBroken', status: 'string_only' },
    { name: 'ItemCrafted', status: 'absent' },
  ]);
  assert.deepEqual(e.summary, { referenced: 1, string_only: 1, absent: 1 });
  const p = read(dir, 'wss_modules/mojang-wss-protocol.json');
  const st = Object.fromEntries(p.data_items.map((x) => [x.name, x.status]));
  assert.equal(st.event, 'referenced');
  assert.equal(st.subscribe, 'string_only');
  assert.equal(st.commandRequest, 'absent');
});

test('enum_modules は裏の取れたものだけ。内部用と推定だけのものは入れない', () => {
  const dir = tmp();
  writeMetadata(full, dir);
  const names = read(dir, 'enum_modules/mojang-enums.json').data_items.map((x) => x.name);
  assert.ok(names.includes('Net::MinecraftPacketIds'));
  assert.ok(names.includes('TextPacketType'));
  assert.equal(names.includes('Editor::LogLevel'), false);
  assert.equal(names.includes('Loose'), false);
  assert.equal(names.includes('Garbage'), false);
});

test('再生成すると前回のモジュールは残らない', () => {
  const dir = tmp();
  writeMetadata(full, dir);
  assert.ok(fs.existsSync(path.join(dir, 'metadata/packet_modules/mojang-display.json')));
  writeMetadata({ ...full, enums: full.enums.slice(0, 1) }, dir);
  assert.equal(fs.existsSync(path.join(dir, 'metadata/packet_modules/mojang-display.json')), false);
});

test('version.json は bedrock-samples と同じく latest を持つ', () => {
  const dir = tmp();
  writeMetadata(full, dir);
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8'));
  assert.equal(v.latest.version, '1.2.3.4');
  assert.equal(v.latest.build_id, 'abc123');
  const mv = read(dir, 'version.json');
  assert.equal(mv.format, 2);
  assert.ok(mv.modules.includes('metadata/wss_modules/mojang-wss-events.json'));
});

test('サイトは enum ごとのページと検索インデックスを作る', () => {
  const dir = tmp();
  const r = buildSite(profile, dir);
  assert.ok(fs.existsSync(path.join(dir, 'enums/Net-MinecraftPacketIds.html')));
  assert.ok(fs.existsSync(path.join(dir, 'packets.html')));
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  // enum 2 個 + 値 4 個
  assert.equal(idx.length, 6);
  assert.equal(r.records, 6);
  const login = idx.find((x) => x.n === 'Login');
  assert.equal(login.e, 'Net::MinecraftPacketIds');
  assert.equal(login.i, 1);
});

test('並びが未確定の enum にはその旨を出す', () => {
  const dir = tmp();
  buildSite(profile, dir);
  const loose = fs.readFileSync(path.join(dir, 'enums/Loose.html'), 'utf8');
  assert.ok(loose.includes('番号は目安'));
  const solid = fs.readFileSync(path.join(dir, 'enums/Net-MinecraftPacketIds.html'), 'utf8');
  assert.ok(!solid.includes('番号は目安'));
});

test('metadata を先に書いてもサイト生成で消えない', () => {
  const dir = tmp();
  writeMetadata(full, dir);
  buildSite(profile, dir);
  assert.ok(fs.existsSync(path.join(dir, 'metadata/packet_modules/mojang-packet-ids.json')));
  assert.ok(fs.existsSync(path.join(dir, 'version.json')));
});

import { extractCommands, undocumentedCommands } from '../src/analysis/commands.js';
import { extractWss } from '../src/analysis/wss.js';

const xrefStub = (functions, strings = [], referenced = []) => ({
  byFunction: new Map(functions.map((f, i) => [i, f])),
  functions: { addressOf: (i) => 0x1000 + i },
  strings: { entries: () => strings.map((value) => ({ value })) },
  referenced: new Set(referenced),
});

test('説明キーとコマンド名の組からコマンドを拾う', () => {
  const x = xrefStub([['commands.setblock.description', 'setblock'], ['無関係', 'noise']]);
  const c = extractCommands(x);
  assert.equal(c.length, 1);
  assert.equal(c[0].name, 'setblock');
  assert.equal(c[0].descriptionKey, 'commands.setblock.description');
});

test('同じ関数の他の識別子は関連として残す', () => {
  const x = xrefStub([['commands.tickingarea.description', 'tickingarea', 'TickingAreaModeAdd', 'void *operator new(size_t)']]);
  const [c] = extractCommands(x);
  assert.deepEqual(c.related, ['TickingAreaModeAdd'], 'メッセージ文は落とす');
});

test('公式メタデータに無いコマンドを見分ける', () => {
  const x = xrefStub([
    ['commands.setblock.description', 'setblock'],
    ['commands.worldbuilder.description', 'worldbuilder'],
  ]);
  const c = extractCommands(x, ['setblock']);
  assert.deepEqual(undocumentedCommands(c).map((v) => v.name), ['worldbuilder']);
  assert.equal(c.find((v) => v.name === 'setblock').inOfficialMetadata, true);
});

test('公式リストを渡さなければ判定を保留する', () => {
  const [c] = extractCommands(xrefStub([['commands.x.description', 'x']]));
  assert.equal(c.inOfficialMetadata, null);
});

test('WSS の封筒キーは messagePurpose を読む関数から取る', () => {
  const x = xrefStub([['header', 'requestId', 'messagePurpose', 'version', 'body', 'NotAKey!']]);
  const w = extractWss(x, []);
  assert.deepEqual(w.envelope, ['body', 'header', 'messagePurpose', 'requestId', 'version']);
});

test('廃止マーカーは名前から外して印にする', () => {
  const enums = [
    { name: 'LegacyTelemetryEventPacketPayload::Type', ordered: false, values: ['PortalUsed', 'PetDied_OBSOLETE'] },
  ];
  const w = extractWss(xrefStub([]), enums);
  assert.deepEqual(w.eventTypes[0].values, [
    { id: 0, name: 'PortalUsed', obsolete: false },
    { id: 1, name: 'PetDied', obsolete: true },
  ]);
});

test('出回っている名前を「存在」と「参照」で三分する', () => {
  const x = xrefStub([], ['PlayerMessage', 'BlockBroken'], ['PlayerMessage']);
  const w = extractWss(x, [], ['PlayerMessage', 'BlockBroken', 'ApiInit']);
  assert.equal(w.summary.knownTotal, 3);
  assert.equal(w.summary.presentInBinary, 2);
  assert.equal(w.summary.referencedInBinary, 1);
  assert.deepEqual(w.knownNames.find((k) => k.name === 'BlockBroken'), {
    name: 'BlockBroken',
    present: true,
    referenced: false,
  });
});
