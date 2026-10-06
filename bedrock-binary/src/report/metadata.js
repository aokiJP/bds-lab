// プロファイルを bedrock-samples の metadata/ と同じ構成・粒度の JSON に落とす。
//
//   metadata/
//     packet_modules/       パケット ID と、パケットの中で使う enum
//     wss_modules/          /connect の封筒と、イベント名が実際に使えるかの判定
//     command_modules/      表に出ていないものを含むコマンドと、発行元・権限
//     vanilladata_modules/  内部 ID（パーティクル、サウンド、エンチャント…）
//     enum_modules/         型名か並びの裏が取れた enum だけ
//     version.json          出所のバイナリと、出した / 出さなかったモジュール
//
// json_schemas / molang_modules / doc_modules に当たるものは作らない。
// 公式に無い、バイナリからしか分からない、しかも使えるものだけを置く。
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG, resolveEnum, cleanValues, findEnum } from './catalog.js';
import { nameConfirmed } from '../analysis/identify.js';

export const MODULE_TYPE = 'binary';
export const METADATA_FORMAT = 2;

// 内部の道具や計測に使う enum。値は正しくても外から使い道が無い
const INTERNAL = /^(Editor::|Sentry|Memory::|cereal::|EAS::|ScriptDiagnostics|GraphicsOverride)/;

// /connect のプロトコルで使われる語。バイナリにあるか、参照されているかを判定する
const WSS_PROTOCOL_WORDS = [
  'header', 'body', 'messagePurpose', 'requestId', 'version',
  'commandRequest', 'commandResponse', 'subscribe', 'unsubscribe', 'event', 'error',
  'eventName', 'commandLine', 'origin', 'statusCode', 'statusMessage',
  'encryption', 'properties', 'measurements', 'triggerSource',
  'agentAction', 'chatSubscribe', 'chatUnsubscribe', 'data', 'input',
];

const source = (profile) => ({
  version: profile.version,
  channel: profile.channel,
  machine: profile.binary.machine,
  build_id: profile.binary.buildId,
  side: profile.channel === 'android' ? 'client' : 'server',
});

/** 識別子がバイナリ上でどう扱われているか。referenced なら実際に読まれる */
function statusOf(profile, name) {
  if (profile._live.has(name)) return 'referenced';
  if (profile._dead.has(name)) return 'string_only';
  return 'absent';
}

function moduleShell(profile, dir, file, type, description) {
  return { dir, file, body: { module_type: MODULE_TYPE, name: file, vanilla_data_type: type, description, source_binary: source(profile), data_items: [] } };
}

function catalogModules(profile, skipped) {
  const out = [];
  for (const m of CATALOG) {
    const mod = moduleShell(profile, m.dir, m.file, m.type, m.description);
    const misses = [];
    const hitGroups = new Set();
    for (const def of m.enums) {
      const r = resolveEnum(profile, def);
      if (r.ok) {
        mod.body.data_items.push(r.item);
        if (def.oneOf) hitGroups.add(def.oneOf);
      } else misses.push({ def, reason: r.reason });
    }
    for (const { def, reason } of misses) {
      if (def.oneOf && hitGroups.has(def.oneOf)) continue;
      skipped.push({ module: `${m.dir}/${m.file}`, key: def.key, reason });
    }
    if (mod.body.data_items.length) out.push(mod);
  }
  return out;
}

/**
 * バイナリから拾った、enum 以外の事実。
 * 値そのものはパック配布物にもあるが、「このバイナリが参照しているか」はここでしか分からない。
 */
function factsModules(profile) {
  const f = profile.facts;
  if (!f) return [];
  const out = [];

  const ns = f.namespaced?.byNamespace?.minecraft;
  if (ns?.total) {
    const m = moduleShell(
      profile, 'vanilladata_modules', 'mojang-binary-identifiers', 'identifier',
      'バイナリにある minecraft: 名前空間の識別子。referenced = このバイナリが実際に読む / ' +
        'string_only = 文字列だけ残っていて使われない。名前の一覧ではなく「生きているか」の表として使う。',
    );
    m.body.summary = { total: ns.total, referenced: ns.referenced, truncated: ns.truncated ?? 0 };
    m.body.data_items = [
      ...ns.live.map((name) => ({ name, status: 'referenced' })),
      ...ns.dead.map((name) => ({ name, status: 'string_only' })),
    ];
    out.push(m);
  }

  if (f.scriptModules?.length) {
    const m = moduleShell(
      profile, 'vanilladata_modules', 'mojang-script-modules', 'script_module',
      'スクリプト API のモジュールと、同じ関数が読んでいる版。manifest の dependencies に書ける版の根拠になる。',
    );
    m.body.data_items = f.scriptModules.map((x) => ({ name: x.name, status: x.referenced ? 'referenced' : 'string_only', versions: x.versions }));
    out.push(m);
  }

  if (f.molang?.total) {
    const m = moduleShell(
      profile, 'vanilladata_modules', 'mojang-molang', 'molang',
      'バイナリにある Molang の語。query.* は参照されているものだけが実際に評価される。',
    );
    m.body.summary = { total: f.molang.total, referenced: f.molang.referenced };
    m.body.data_items = [
      ...f.molang.live.map((name) => ({ name, status: 'referenced' })),
      ...f.molang.dead.map((name) => ({ name, status: 'string_only' })),
    ];
    out.push(m);
  }
  return out;
}

function commandModule(profile) {
  if (!profile.commands?.length) return null;
  const mod = moduleShell(
    profile, 'command_modules', 'mojang-commands', 'command',
    'CommandRegistry への登録から復元したコマンド。公式メタデータに無いものを含む。' +
      '引数の型と権限は整数で埋まっていて復元できないため、公式に載っているものはそちらが正。',
  );
  mod.body.data_items = profile.commands.map((c) => ({
    name: c.name,
    description_key: c.descriptionKey,
    // 配布物の翻訳表に文面があるか。false は「登録はあるが表に出す気が無い」
    has_text: c.hasText,
    in_official_metadata: c.inOfficialMetadata,
    // 同じ登録関数が読んでいる識別子。多くはパラメータの列挙型名
    related_identifiers: c.related,
  }));
  mod.body.undocumented = profile.commands.filter((c) => c.inOfficialMetadata === false).map((c) => c.name);
  return mod;
}

function wssModules(profile, skipped) {
  const w = profile.wss;
  if (!w) return [];
  const side = source(profile).side;

  const protocol = moduleShell(
    profile, 'wss_modules', 'mojang-wss-protocol', 'websocket_protocol',
    side === 'client'
      ? '/connect の封筒とメッセージ種別。クライアント側の実装から、各語が実際に読まれているかを判定した。'
      : '/connect の封筒。購読処理はクライアント側にあるため、サーバーで読まれる語は限られる。',
  );
  protocol.body.envelope_keys = w.envelope;
  protocol.body.data_items = WSS_PROTOCOL_WORDS.map((name) => ({ name, status: statusOf(profile, name) }));

  const events = moduleShell(
    profile, 'wss_modules', 'mojang-wss-events', 'websocket_event',
    'subscribe に渡すイベント名の判定。referenced = このバイナリで実際に読まれる / ' +
      'string_only = 文字列だけ残っていて発火しない / absent = このバイナリに無い。',
  );
  events.body.side = side;
  events.body.data_items = w.knownNames.map((k) => ({
    name: k.name,
    status: k.referenced ? 'referenced' : k.present ? 'string_only' : 'absent',
  }));
  events.body.summary = {
    referenced: events.body.data_items.filter((x) => x.status === 'referenced').length,
    string_only: events.body.data_items.filter((x) => x.status === 'string_only').length,
    absent: events.body.data_items.filter((x) => x.status === 'absent').length,
  };

  const telemetry = moduleShell(
    profile, 'wss_modules', 'mojang-wss-telemetry-types', 'websocket_telemetry',
    'LegacyTelemetryEventPacket が運ぶイベント種別。_OBSOLETE の付いたものは廃止済み。',
  );
  for (const def of [
    { key: 'event_types', match: 'LegacyTelemetryEventPacketPayload::Type', anchors: ['Achievement', 'Interaction'], ids: 'sequential', base: 0 },
  ]) {
    const r = resolveEnum(profile, def);
    if (!r.ok) {
      skipped.push({ module: 'wss_modules/mojang-wss-telemetry-types', key: def.key, reason: r.reason });
      continue;
    }
    // 廃止マーカーを別フィールドに分ける
    r.item.values = r.item.values.map((v) => {
      const name = typeof v === 'string' ? v : v.name;
      const obsolete = /_OBSOLETE$/.test(name);
      const clean = name.replace(/_OBSOLETE$/, '');
      return typeof v === 'string' ? (obsolete ? { name: clean, obsolete } : clean) : { ...v, name: clean, ...(obsolete ? { obsolete } : {}) };
    });
    telemetry.body.data_items.push(r.item);
  }

  return [protocol, events, ...(telemetry.body.data_items.length ? [telemetry] : [])];
}

/** 型名の裏が取れているか、並びが配列で裏取りできた enum だけ */
function enumModule(profile) {
  const mod = moduleShell(
    profile, 'enum_modules', 'mojang-enums', 'enum',
    '型名がリフレクション文字列で確定しているか、並びがポインタ配列で裏取りできた enum。' +
      '番号が付いているのは裏取り済みのものだけ。',
  );
  for (const e of profile.enums) {
    if (!nameConfirmed(e) && !e.ordered) continue;
    if (INTERNAL.test(e.name)) continue;
    const { values } = cleanValues(e.values);
    if (values.length < 3) continue;
    mod.body.data_items.push({
      name: e.name,
      name_source: e.source,
      id_basis: e.ordered ? 'array_verified' : 'names_only',
      count: values.length,
      values: e.ordered ? values.map((v, id) => ({ id, name: v })) : values,
    });
  }
  return mod.body.data_items.length ? mod : null;
}

/**
 * @param {object} profile
 * @param {string} outDir docs/ 相当
 * @returns {Array<{path:string, items:number}>}
 */
export function writeMetadata(profile, outDir) {
  const p = {
    ...profile,
    _live: new Set(profile.identifiers?.live ?? []),
    _dead: new Set(profile.identifiers?.dead ?? []),
  };
  const skipped = [];
  const modules = [
    ...catalogModules(p, skipped),
    commandModule(p),
    ...factsModules(p),
    ...wssModules(p, skipped),
    enumModule(p),
  ].filter(Boolean);

  const dir = path.join(outDir, 'metadata');
  // 前回の生成物に、今回は検証に落ちたモジュールが残らないようにする
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const written = [];
  for (const m of modules) {
    const f = path.join(dir, m.dir, `${m.file}.json`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(m.body, null, 2)}\n`);
    written.push({ path: path.relative(outDir, f).split(path.sep).join('/'), items: m.body.data_items.length });
  }

  const version = {
    format: METADATA_FORMAT,
    latest: {
      version: profile.version,
      channel: profile.channel,
      build_id: profile.binary.buildId,
      machine: profile.binary.machine,
      generated_at: profile.generatedAt,
    },
    modules: written.map((w) => w.path),
    // 先頭の値が想定と違って出さなかったもの。版で enum が変わったか、復元が崩れた
    skipped,
  };
  fs.writeFileSync(path.join(dir, 'version.json'), `${JSON.stringify(version, null, 2)}\n`);
  written.push({ path: 'metadata/version.json', items: written.length });
  // bedrock-samples と同じく、ルートにも latest だけを置く（Pages の利用側が最初に読む）
  fs.writeFileSync(path.join(outDir, 'version.json'), `${JSON.stringify({ latest: version.latest }, null, 2)}\n`);
  return written;
}

export { findEnum };
