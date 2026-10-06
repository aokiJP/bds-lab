// バイナリからしか分からない定義を、bedrock-samples の metadata/ と同じ粒度のモジュールに切り分ける。
//
// 方針は「使えるものだけ出す」。復元した enum には末尾に構造体名やフィールド名が混ざり、
// 番号も連番とは限らない。そこで各モジュールに
//   anchors  先頭の値。版ごとにここが一致しなければ、そのモジュールは出さない
//   ids      番号の根拠。sequential（連番と分かっているもの）/ bit（ビット位置）/ names（名前だけ使える）
//   base     sequential の先頭の番号（PlayerActionType は -1 始まり、など）
//   stop     ここに来たら値の列は終わり（後ろはフィールド名）
// を持たせ、検証に通ったものだけを書き出す。
//
// ids を names にしているものは、プロトコル上の番号が飛び飛びと分かっているもの。
// 名前の一覧としては正確なので出すが、番号は付けない。

/** 値の列の終わりを示す定型語。番兵（Count など）とペイロード型名 */
const SENTINEL = /^(Count|_?COUNT|Num[A-Z]\w*|TOTAL_\w+|[A-Z]\w*Payload|[A-Z]\w*PacketPayload)$/;

const style = (v) => (/^[A-Z0-9_]+$/.test(v) ? 'upper' : /^[A-Z]/.test(v) ? 'pascal' : 'lower');

/**
 * 復元した値の列から、実際の enum 値だけを取り出す。
 * @returns {{values:string[], trimmedHead:string[], trimmedTail:string[]}}
 */
export function cleanValues(raw, { stop = [], dropHead = [], styleCut = true } = {}) {
  const stops = stop.map((s) => (s instanceof RegExp ? s : new RegExp(`^${s}$`, 'i')));
  let start = 0;
  // 先頭が型名（…Payload や …Data）のことがある。登録関数が最初に型名を読むため
  while (start < raw.length && (SENTINEL.test(raw[start]) || dropHead.includes(raw[start]))) start++;

  const head = raw.slice(0, start);
  const out = [];
  const anchorStyle = raw[start] !== undefined ? style(raw[start]) : null;
  for (let i = start; i < raw.length; i++) {
    const v = raw[i];
    if (SENTINEL.test(v) || stops.some((re) => re.test(v))) break;
    // 表記の系統が変わったら別物（lowerCamel の enum の後ろに Pascal の型名が続く、など）
    if (styleCut && style(v) !== anchorStyle) break;
    out.push(v);
  }
  return { values: out, trimmedHead: head, trimmedTail: raw.slice(start + out.length) };
}

/**
 * dir: metadata/ 以下のディレクトリ、file: モジュール名、type: vanilla_data_type 相当
 * enums: 1 モジュールに入れる enum の定義
 */
export const CATALOG = [
  // ---- packet_modules ---------------------------------------------------
  {
    dir: 'packet_modules', file: 'mojang-packet-ids', type: 'packet_id',
    description: 'パケット ID。プロトコル実装で最初に要る表。',
    // 番号は値の並びではなく getId() から（profile.packets）。並びは削除された番号で抜け、新しいほど順番も合わない
    enums: [{ key: 'packet_ids', match: 'MinecraftPacketIds', anchors: ['KeepAlive', 'Login', 'PlayStatus'], ids: 'getId' }],
  },
  {
    dir: 'packet_modules', file: 'mojang-login-flow', type: 'packet_enum',
    description: 'ログインから切断までの状態と理由。接続失敗の原因特定に使う。',
    enums: [
      { key: 'play_status', match: 'PlayStatus', anchors: ['LoginSuccess', 'LoginFailed_ClientOld'], ids: 'sequential', base: 0 },
      { key: 'disconnect_reason', match: 'Connection::DisconnectFailReason', anchors: ['Unknown', 'CantConnectNoInternet'], ids: 'sequential', base: 0 },
      { key: 'respawn_state', match: 'PlayerRespawnState', anchors: ['SearchingForSpawn', 'ReadyToSpawn'], ids: 'sequential', base: 0, stop: ['Position', 'State'] },
    ],
  },
  {
    dir: 'packet_modules', file: 'mojang-player-input', type: 'packet_enum',
    description: 'PlayerAuthInput のビットと PlayerAction の種別。サーバー側の移動・操作判定に使う。',
    enums: [
      { key: 'auth_input_flags', match: 'PlayerAuthInputPacketPayload::InputData', dropHead: ['PlayerAuthInputData'], anchors: ['Ascend', 'Descend'], ids: 'bit', base: 0 },
      { key: 'player_action', match: 'PlayerActionType', anchors: ['Unknown', 'StartDestroyBlock'], ids: 'sequential', base: -1 },
      { key: 'input_mode', match: 'InputMode', anchors: ['Undefined', 'Mouse', 'Touch'], ids: 'sequential', base: 0 },
    ],
  },
  {
    dir: 'packet_modules', file: 'mojang-inventory', type: 'packet_enum',
    description: 'ItemStackRequest の操作種別と、サーバーが返す失敗理由。インベントリ同期の不具合調査に使う。',
    enums: [
      { key: 'item_stack_request_action', match: 'ItemStackRequestActionType', anchors: ['Take', 'Place', 'Swap'], ids: 'sequential', base: 0, stop: [/^ItemStackRequest/] },
      { key: 'item_stack_net_result', match: 'ItemStackNetResult', anchors: ['Success', 'Error'], ids: 'sequential', base: 0 },
    ],
  },
  {
    dir: 'packet_modules', file: 'mojang-display', type: 'packet_enum',
    description: 'テキスト・タイトル・ボスバーなど、表示系パケットの種別。',
    enums: [
      { key: 'text_type', match: 'TextPacketType', anchors: ['raw', 'chat', 'translate'], ids: 'sequential', base: 0 },
      { key: 'title_type', match: 'SetTitlePacketPayload::TitleType', anchors: ['Clear', 'Reset', 'Title'], ids: 'sequential', base: 0, stop: ['Xuid'] },
      { key: 'boss_event', match: 'BossEventUpdateType', anchors: ['Add', 'PlayerAdded', 'Remove'], ids: 'sequential', base: 0 },
      { key: 'mob_effect_event', match: 'MobEffectPacketPayload::Event', anchors: ['Invalid', 'Add', 'Update'], ids: 'sequential', base: 0, stop: ['Tick', 'Ambient'] },
      { key: 'interact_action', match: 'InteractPacketPayload::Action', anchors: ['Invalid', 'StopRiding'], ids: 'names', stop: ['Position'] },
      { key: 'animate_action', match: 'AnimatePacketPayload::Action', anchors: ['NoAction', 'Swing'], ids: 'names', stop: ['Data'] },
    ],
  },
  {
    dir: 'packet_modules', file: 'mojang-actor-data', type: 'packet_enum',
    description: 'アクターのメタデータ（SynchedActorData）の値の型。',
    enums: [{ key: 'data_item_type', match: 'DataItemType', anchors: ['Byte', 'Short', 'Int'], ids: 'sequential', base: 0 }],
  },

  // ---- wss_modules は専用の組み立て（buildWss）------------------------------

  // ---- command_modules --------------------------------------------------
  {
    dir: 'command_modules', file: 'mojang-command-context', type: 'command_enum',
    description: 'コマンドの発行元と権限レベル。/connect 経由のコマンドは AutomationPlayer 扱いになる。',
    enums: [
      { key: 'origin_type', match: 'CommandOriginType', anchors: ['Player', 'CommandBlock'], ids: 'sequential', base: 0 },
      { key: 'permission_level', match: 'CommandPermissionLevel', anchors: ['Any', 'GameDirectors', 'Admin'], ids: 'sequential', base: 0 },
    ],
  },

  // ---- vanilladata_modules ----------------------------------------------
  {
    dir: 'vanilladata_modules', file: 'mojang-actor-events', type: 'actor_event',
    description: 'ActorEvent の名前。番号は飛び飛びなので名前の一覧として使う。',
    enums: [{ key: 'actor_events', match: 'ActorEvent', anchors: ['NONE', 'JUMP', 'HURT'], ids: 'names' }],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-actor-types', type: 'actor_type',
    description: 'ActorType の内部名。番号はビットフラグの組み合わせなので名前だけ使う。スクリプトの型判定の手がかりになる。',
    enums: [{ key: 'actor_types', match: 'ActorType', anchors: ['Undefined', 'Mob', 'PathfinderMob'], ids: 'names' }],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-particle-types', type: 'particle_type',
    description: 'LevelEvent で送るパーティクル種別。',
    enums: [{ key: 'particle_types', match: 'ParticleType', anchors: ['none', 'bubble'], ids: 'sequential', base: 0 }],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-level-sound-events', type: 'level_sound_event',
    description:
      'LevelSoundEvent。enum 本体（Pascal 表記、ItemUseOn = 0）が取れたビルドでは番号つき。' +
      '小文字の名前表は enum の一部しか持たない対応表なので、名前だけ出す。',
    enums: [
      { key: 'level_sound_events', oneOf: 'level_sound', match: 'LevelSoundEvent', anchors: ['ItemUseOn', 'Hit', 'Step'], ids: 'sequential', base: 0, stop: ['Undefined'], caseSensitive: true },
      { key: 'level_sound_names', oneOf: 'level_sound', match: 'LevelSoundEvent', anchors: ['hit', 'step', 'fly'], ids: 'names', stop: ['undefined'], caseSensitive: true },
    ],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-damage-causes', type: 'damage_cause',
    description: 'ダメージ原因。スクリプトの EntityDamageCause や /damage の cause と同じ語。',
    enums: [{ key: 'damage_causes', match: 'ActorDamageCause', anchors: ['none', 'override', 'contact'], ids: 'sequential', base: -1, stop: ['all'] }],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-containers', type: 'container',
    description: 'コンテナ種別と、ItemStackRequest で使うコンテナ名。',
    enums: [
      { key: 'container_types', match: 'ContainerType', anchors: ['NONE', 'INVENTORY', 'CONTAINER'], ids: 'names' },
      { key: 'container_names', match: 'ContainerEnumName', anchors: ['AnvilInputContainer'], ids: 'sequential', base: 0 },
    ],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-enchantments', type: 'enchantment',
    description: 'エンチャントの内部番号。NBT の ench.id に入る値。',
    enums: [{ key: 'enchant_types', match: 'Enchant::Type', anchors: ['Protection', 'FireProtection'], ids: 'sequential', base: 0 }],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-map-decorations', type: 'map_decoration',
    description: '地図に描かれるマーカーの種別。',
    enums: [{ key: 'map_decorations', match: 'MapDecoration::Type', anchors: ['MarkerWhite', 'MarkerGreen'], ids: 'sequential', base: 0 }],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-platforms', type: 'platform',
    description: 'BuildPlatform の名前。Login の DeviceOS の読み取りに使う。番号は 1 始まりで欠番があるため名前のみ。',
    // iOS / OSX / tvOS と表記が揺れるので、表記の系統では切らない
    enums: [{ key: 'build_platforms', match: 'BuildPlatform', anchors: ['Google', 'iOS'], ids: 'names', styleCut: false }],
  },
  {
    dir: 'vanilladata_modules', file: 'mojang-game-types', type: 'game_type',
    description: 'ゲームモードの内部名。Default と WorldDefault を含む。番号は飛び飛びのため名前のみ。',
    enums: [{ key: 'game_types', match: 'GameType', anchors: ['Undefined', 'Survival', 'Creative'], ids: 'names' }],
  },
];

/** enum の名前一致。名前空間つき・短い名前のどちらでも引けるようにする */
export function findEnum(enums, match) {
  const short = match.split('::').pop();
  return (
    enums.find((e) => e.name === match) ??
    enums.find((e) => e.name.endsWith(`::${match}`)) ??
    enums.find((e) => (e.short ?? e.name) === short && e.source === 'shape')
  );
}

/**
 * 突き合わせに使う値の列の候補。
 * 形から推定した enum は先頭の値を型名と取り違えていることがあるので、
 * 「値だけ」と「頭を戻したもの」の両方を試す（src/analysis/identify.js の説明を参照）。
 */
function variants(e) {
  const out = [e.values];
  const head = e.head ?? (e.provisional || e.source === 'shape' ? [e.name] : []);
  if (head.length) out.push([...head, ...e.values]);
  return out;
}

/** 掃除済みの値が anchors で始まるか。既定は大文字小文字を区別しない */
function matchAnchors(values, def) {
  const norm = (xs) => (def.caseSensitive ? xs : xs.map((x) => x.toLowerCase()));
  return norm(values.slice(0, def.anchors.length)).join() === norm(def.anchors).join();
}

/** 型名が頭に何個ついているか分からないので、ここまでは剥がして試す */
const MAX_HEAD = 3;

/**
 * anchors に合う並びが見つかればそれを返す。合わなければ既定（値だけ）の掃除結果。
 *
 * 登録関数は enum の値の前に「構造体名」「enum の型名」を続けて読むことがある
 * （RespawnPacketPayload, PlayerRespawnState, SearchingForSpawn, ...）。
 * 何個ついているかはビルドによって変わるので、先頭を 0〜3 個ずらして anchors で答え合わせする。
 * anchors は完全一致なので、ずらして当たったものは偶然ではない。
 */
function clean(e, def) {
  let first = null;
  for (const values of variants(e)) {
    for (let skip = 0; skip <= MAX_HEAD && skip < values.length; skip++) {
      const c = cleanValues(values.slice(skip), def);
      if (!first) first = c;
      if (def.anchors?.length && matchAnchors(c.values, def)) {
        return { ...c, trimmedHead: [...values.slice(0, skip), ...c.trimmedHead] };
      }
    }
  }
  return first;
}

/**
 * 1 つの enum 定義をプロファイルに当てて、使える形にする。
 *
 * まず名前で引き、先頭の値で検証する。名前で見つからないか検証に落ちたら、
 * 全 enum の中から先頭の値が anchors と一致するものを探す。cereal の型名が消えた
 * ビルドでは形から推定した名前がでたらめなので、値のほうが確かな手がかりになる。
 *
 * @returns {{ok:true, item:object} | {ok:false, reason:string}}
 */
export function resolveEnum(profile, def) {
  if (def.ids === 'getId') {
    const pk = profile.packets;
    if (pk?.basis === 'getId' && pk.list.length) {
      const values = pk.list.map((p) => ({ id: p.id, name: p.name ?? p.class.replace(/Packet$/, ''), class: p.class }));
      return { ok: true, item: { key: def.key, name: def.match, name_source: 'rtti', id_basis: 'code_getid', count: values.length, values } };
    }
    def = { ...def, ids: 'names' }; // getId() の番号が無い古いプロファイル: 名前の一覧だけ（並びは番号ではない）
  }
  let found = null;
  let reason = null;

  const named = findEnum(profile.enums, def.match);
  if (named) {
    const c = clean(named, def);
    if (matchAnchors(c.values, def)) found = { e: named, c, via: 'name' };
    else reason = `${def.match} の先頭が想定と違います（${c.values.slice(0, 3).join(', ')}）`;
  } else {
    reason = `${def.match} がプロファイルにありません`;
  }

  if (!found && def.anchors.length >= 2) {
    const hits = [];
    for (const e of profile.enums) {
      const c = clean(e, def);
      if (matchAnchors(c.values, def)) hits.push({ e, c, via: 'anchors' });
    }
    if (hits.length) {
      // 同じ値の列が複数の関数から拾われることがある。いちばん長いものを採る
      hits.sort((a, b) => b.c.values.length - a.c.values.length || Number(b.e.ordered) - Number(a.e.ordered));
      found = hits[0];
    }
  }
  if (!found) return { ok: false, reason };

  const { e, c, via } = found;
  const values = c.values;
  const base = def.base ?? 0;
  // 番号の根拠。ポインタ配列で並びが確定していれば最優先
  const basis = def.ids === 'names' ? 'names_only' : e.ordered ? 'array_verified' : 'declaration_order';
  const item = {
    key: def.key,
    name: via === 'name' ? e.name : def.match,
    name_source: via === 'name' ? e.source : 'anchors',
    id_basis: basis,
    count: values.length,
  };
  if (def.ids === 'names') item.values = values;
  else if (def.ids === 'bit') item.values = values.map((v, i) => ({ bit: base + i, name: v }));
  else item.values = values.map((v, i) => ({ id: base + i, name: v }));
  if (c.trimmedHead.length || c.trimmedTail.length) item.trimmed = { head: c.trimmedHead, tail: c.trimmedTail.slice(0, 12) };
  return { ok: true, item };
}
