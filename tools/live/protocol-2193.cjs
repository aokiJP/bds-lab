'use strict';
// 実機 1.26.50 / 1.26.51（ネットワークプロトコル 2193）を、bedrock-protocol で話せるようにする。
//
// npm の minecraft-data は 2169（1.26.45）までしか無い（2026-09 時点）。そこで 1.26.45 の定義に、
// **Mojang 公式のプロトコル仕様（github.com/Mojang/bedrock-protocol-docs）のタグ v1.26.45 → v1.26.51 の差分**
// だけを当てた定義を作り、minecraft-data に「1.26.51」として登録する。推測で埋めたところは無い
// （下の PATCHES の各行に、根拠の json ファイル名を書いてある）。
//
//   node tools/live/protocol-2193.cjs          入れる（何度打っても同じ）
//   node tools/live/protocol-2193.cjs --check  入っているかだけ見る
//
// 大事な事実（Mojang の差分で確かめた）: 移動の入力 PlayerAuthInputPacket の並びは 2169 と 2193 で**変わっていない**。
// 変わったのは、アイテムの使用（Hand が増えた）・生き物の移動（Ticks が増えた）・音・ボスバー・カメラ・次元の定義など。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const VERSION = '1.26.51';
const PROTOCOL = 2193;
const BASE = '1.26.45';

function mdRoot() {
  const pkg = require.resolve('minecraft-data/package.json', { paths: [path.join(ROOT, 'vendor'), ROOT] });
  return path.dirname(pkg);
}

const opt = (t) => ['option', t];
const u8map = (m) => ['mapper', { type: 'u8', mappings: m }];

/** Mojang の差分（v1.26.45 → v1.26.51）。[根拠, 当て方] */
const PATCHES = [
  ['ItemUseInventoryTransaction.json: Hand（uint8、HandSlot）が Slot の次（ordinal 6）に入った', (t) => {
    const f = t.TransactionUseItem[1];
    const i = f.findIndex((x) => x.name === 'hotbar_slot');
    if (f.some((x) => x.name === 'hand')) return;
    f.splice(i + 1, 0, { name: 'hand', type: u8map({ 0: 'main_hand', 1: 'off_hand' }) });
  }],
  ['MoveActorDeltaData.json: Ticks（uint64、圧縮）が最後（ordinal 11）に入った', (t) => {
    const f = t.packet_move_entity_delta[1];
    if (!f.some((x) => x.name === 'ticks')) f.push({ name: 'ticks', type: 'varint64' });
  }],
  ['PlaySoundPacketPayload.json: Bypass Listener Range Check（bool、5）と Playback Position Seconds（float、7）が入った', (t) => {
    const f = t.packet_play_sound[1];
    if (f.some((x) => x.name === 'bypass_listener_range_check')) return;
    const i = f.findIndex((x) => x.name === 'loop_count');
    f.splice(i + 1, 0, { name: 'bypass_listener_range_check', type: 'bool' });
    f.push({ name: 'playback_position_seconds', type: 'lf32' });
  }],
  ['BossEventPacketPayload.json: Player ID が消えた（Target Actor ID の次が Event Type）', (t) => {
    const f = t.packet_boss_event[1];
    const i = f.findIndex((x) => x.name === 'player_id');
    if (i >= 0) f.splice(i, 1);
  }],
  ['CameraPresets.json: Apply Inherited Starting Rotation（bool、22）と Starting Rotation（Vec2、23）が最後に入った。'
    + '省略できるかは仕様に書いていないので実機で決めた: 実機の camera_presets（339 バイト）を「bool そのまま＋Vec2 は省略可」で読むとちょうど読み切れる（ほかの 4 通りは失敗）', (t) => {
    const f = t.CameraPresets[1];
    if (f.some((x) => x.name === 'apply_inherited_starting_rotation')) return;
    f.push({ name: 'apply_inherited_starting_rotation', type: 'bool' });
    f.push({ name: 'starting_rotation', type: opt('vec2f') });
  }],
  ['DimensionDefinition.json: Minimum Y（0）・Height Range（1）の順に変わり、Default Biome（string、5）が入った', (t) => {
    const def = t.packet_dimension_data[1][0].type[1].type[1];
    if (def.some((x) => x.name === 'default_biome')) return;
    const id = def.find((x) => x.name === 'id');
    const rest = def.filter((x) => !['id', 'max_height', 'min_height'].includes(x.name));
    def.length = 0;
    def.push(id, { name: 'min_y', type: 'zigzag32' }, { name: 'height_range', type: 'zigzag32' }, ...rest, { name: 'default_biome', type: 'string' });
  }],
  ['TextDataPayload.json: LineGapHeight（float、3）が BackgroundColor の次に戻った', (t) => {
    const f = t.ShapeText[1];
    if (f.some((x) => x.name === 'line_gap_height')) return;
    const i = f.findIndex((x) => x.name === 'background_color');
    f.splice(i + 1, 0, { name: 'line_gap_height', type: opt('lf32') });
  }],
  ['PlayerAuthInputPacket: Input Data は「数（varuint）＋旗の番号（zigzag の varint）の並び」で、前に「あるか」の 1 バイトは付かない。'
    + 'minecraft-data 1.26.40 以降は option で包んでいて、実機に送ると 1 バイトずれて切断される。'
    + '根拠: Mojang 2169 の __protocoldoc.json（Input Data は required の sequence_container）、gophertunnel（2193 対応）の InputFlagList、'
    + '実機での切断の二分探索（option 付きの 01 00 は切断・並びだけの 00 は通る）。'
    + '後ろの 5 つ（Item Use Transaction〜Client Predicted Vehicle）は required=false なので、それぞれ「あるか」の 1 バイトが前に付く（minecraft-data のまま正しい）', (t) => {
    const f = t.packet_player_auth_input[1];
    const d = f.find((x) => x.name === 'input_data');
    if (Array.isArray(d.type) && d.type[0] === 'option') d.type = d.type[1];
  }],
  ['PlayerAuthInputPacket: 省略できる 5 つの欄は「あるか」の 1 バイト＋中身。minecraft-data は *_presence（bool）と option（これも 1 バイト書く）の両方を持っていて 2 バイトになる。'
    + '*_presence を消して option だけにする（gophertunnel の OptionalFunc と同じ。実機で確かめた: 2 バイトだと切断、1 バイトだと通る）', (t) => {
    const f = t.packet_player_auth_input[1];
    for (let i = f.length - 1; i >= 0; i--) if (/_presence$/.test(f[i].name)) f.splice(i, 1);
    const tr = f.find((x) => x.name === 'transaction');
    const inner = tr?.type?.[1]?.[1];
    if (Array.isArray(inner)) for (let i = inner.length - 1; i >= 0; i--) if (/_presence$/.test(inner[i].name)) inner.splice(i, 1);
  }],
  ['InventoryTransactionPacket: 種類（transaction_type）は varuint そのまま、actions は数＋並び。minecraft-data はどちらも option で包んでいて 1 バイトずつ多い。'
    + '根拠: gophertunnel（2193 対応）の InventoryTransaction.Marshal（TransactionDataType は Varuint32、Actions は Slice）', (t) => {
    const f = t.Transaction[1];
    for (const n of ['transaction_type', 'actions']) {
      const x = f.find((y) => y.name === n);
      if (x && Array.isArray(x.type) && x.type[0] === 'option') x.type = x.type[1];
    }
  }],
  ['InventoryAction（TransactionActions の 1 件）: 種類（varuint）・窓の番号（省略可の int8）・元の旗（省略可の varuint）・場所（varuint）・前の物・後の物。'
    + 'minecraft-data は種類ごとに枝分かれする古い並びで、サーバーが送り返す inventory_transaction が読めなかった（実機で確かめた）。根拠: gophertunnel の InventoryAction.Marshal', (t) => {
    t.TransactionActions = ['array', { countType: 'varint', type: ['container', [
      { name: 'source_type', type: ['mapper', { type: 'varint', mappings: { 0: 'container', 1: 'global', 2: 'world_interaction', 3: 'creative', 100: 'craft_slot', 99999: 'craft' } }] },
      { name: 'window_id', type: ['option', 'i8'] },
      { name: 'source_flags', type: ['option', 'varint'] },
      { name: 'slot', type: 'varint' },
      { name: 'old_item', type: 'ItemV4' },
      { name: 'new_item', type: 'ItemV4' },
    ]] }];
  }],
  ['MinecraftPacketIds.json: SetPlayerFurnaceOptions（351）・RecordStarted（352）が増えた。中身は読まずに受け流す', (t) => {
    const m = t.mcpe_packet[1][0].type[1].mappings;
    const sw = t.mcpe_packet[1][1].type[1].fields;
    if (!Object.values(m).includes('set_player_furnace_options')) {
      m['351'] = 'set_player_furnace_options';
      m['352'] = 'record_started';
      sw.set_player_furnace_options = 'packet_set_player_furnace_options';
      sw.record_started = 'packet_record_started';
      t.packet_set_player_furnace_options = ['container', [{ name: 'data', type: 'restBuffer' }]];
      t.packet_record_started = ['container', [{ name: 'position', type: 'BlockCoordinates' }, { name: 'data', type: 'restBuffer' }]];
    }
  }],
];

function isInstalled() {
  try {
    const dir = path.join(mdRoot(), 'minecraft-data', 'data', 'bedrock', VERSION);
    const stamp = JSON.parse(fs.readFileSync(path.join(dir, 'sandbox-be.json'), 'utf8'));
    return stamp.why?.join('\n') === PATCHES.map((p) => p[0]).join('\n') && fs.readFileSync(path.join(mdRoot(), 'data.js'), 'utf8').includes(`'${VERSION}': {`);
  } catch { return false; }
}

/** 入れる。入っていれば何もしない。戻りは { installed, changed } */
function ensureProtocol({ quiet = true } = {}) {
  if (isInstalled()) return { installed: true, changed: false };
  const md = mdRoot();
  const dataDir = path.join(md, 'minecraft-data', 'data', 'bedrock');
  const proto = JSON.parse(fs.readFileSync(path.join(dataDir, BASE, 'protocol.json'), 'utf8'));
  const from = (v) => JSON.parse(fs.readFileSync(path.join(dataDir, v, 'protocol.json'), 'utf8')).types;
  for (const [why, apply] of PATCHES) {
    apply(proto.types, from);
    if (!quiet) process.stdout.write(`  ✓ ${why}\n`);
  }
  const out = path.join(dataDir, VERSION);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'protocol.json'), JSON.stringify(proto));
  fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ version: PROTOCOL, minecraftVersion: VERSION, majorVersion: '1.26', releaseType: 'release' }, null, 2));
  fs.writeFileSync(path.join(out, 'sandbox-be.json'), JSON.stringify({ base: BASE, source: 'Mojang/bedrock-protocol-docs v1.26.45 → v1.26.51', patches: PATCHES.length, why: PATCHES.map((p) => p[0]) }, null, 2));

  // 版の一覧（新しいものが先頭）
  const pvFile = path.join(dataDir, 'common', 'protocolVersions.json');
  const pv = JSON.parse(fs.readFileSync(pvFile, 'utf8'));
  if (!pv.some((v) => v.minecraftVersion === VERSION)) {
    pv.unshift({ minecraftVersion: VERSION, version: PROTOCOL, majorVersion: '1.26', releaseType: 'release' });
    fs.writeFileSync(pvFile, JSON.stringify(pv, null, 2));
  }
  // どのデータをどこから読むか（1.26.45 と同じものを使い、protocol と version だけ新しいもの）
  const dpFile = path.join(md, 'minecraft-data', 'data', 'dataPaths.json');
  const dp = JSON.parse(fs.readFileSync(dpFile, 'utf8'));
  dp.bedrock[VERSION] = { ...dp.bedrock[BASE], protocol: `bedrock/${VERSION}`, version: `bedrock/${VERSION}` };
  fs.writeFileSync(dpFile, JSON.stringify(dp, null, 2));
  // data.js（minecraft-data が実際に読む表）に 1.26.45 の項を写して足す
  const djFile = path.join(md, 'data.js');
  let dj = fs.readFileSync(djFile, 'utf8');
  if (!dj.includes(`'${VERSION}': {`)) {
    const start = dj.indexOf(`    '${BASE}': {`);
    // その項の終わり（4 字下げの「}」）。最後の項は「,」が無い
    const close = dj.indexOf('\n    }', start);
    if (start < 0 || close < 0) throw new Error(`minecraft-data の data.js に ${BASE} の項が見つかりません`);
    const end = close + '\n    }'.length;
    const block = dj.slice(start, end)
      .replace(`'${BASE}': {`, `'${VERSION}': {`)
      .replace(`bedrock/${BASE}/protocol.json`, `bedrock/${VERSION}/protocol.json`)
      .replace(`bedrock/${BASE}/version.json`, `bedrock/${VERSION}/version.json`);
    dj = `${dj.slice(0, end)},\n${block}${dj.slice(end)}`;
    fs.writeFileSync(djFile, dj);
  }
  return { installed: true, changed: true };
}

module.exports = { ensureProtocol, isInstalled, VERSION, PROTOCOL, PATCHES };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const ok = isInstalled();
    console.log(ok ? `入っています: minecraft-data bedrock ${VERSION}（protocol ${PROTOCOL}）` : `入っていません（node tools/live/protocol-2193.cjs で入れる）`);
    process.exit(ok ? 0 : 1);
  }
  console.log(`minecraft-data に bedrock ${VERSION}（protocol ${PROTOCOL}）を入れます（Mojang の仕様の差分 v${BASE} → v${VERSION}）`);
  const r = ensureProtocol({ quiet: false });
  console.log(r.changed ? '入れました' : 'もう入っています');
}
