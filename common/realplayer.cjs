'use strict';
// Real Bedrock client (bedrock-protocol over a RakNet-11 client) driven by lab cmds: `@Name <action> ...`.
// Server-authoritative movement: we send inputs + our last server-confirmed position; with
// player-position-acceptance-threshold=0 the server simulates the move and sends corrections we adopt.
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { RakClient } = require('./raknet.cjs');
const { makeVerbs } = require('./verbs.cjs');
const { NetherNetClient } = require('./nethernet.cjs');
// the transport of the next connection (bedrock-protocol creates it with `new RakClient(...)` inside createClient)
let NEXT = { transport: 'raknet' };

const EYE = 1.62;
const F = Math.fround;
const big = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? String(v) : v)));

// network block id = FNV-1a 32 of the little-endian NBT {name, states}
// the script API reports extra alias states (e.g. chest facing_direction) that the network id excludes:
// keep only states minecraft-data lists for the block, with its tag types
let STATES = null;
function netStates(req, version, name, states) {
  if (STATES === null) {
    STATES = new Map();
    try {
      const base = require('node:path').dirname(req.resolve('minecraft-data/minecraft-data/data/dataPaths.json'));
      const dir = JSON.parse(require('node:fs').readFileSync(base + '/dataPaths.json', 'utf8')).bedrock[version].blockStates;
      for (const b of JSON.parse(require('node:fs').readFileSync(`${base}/${dir}/blockStates.json`, 'utf8'))) if (!STATES.has(b.name)) STATES.set(b.name, b.states);
    } catch { /* fall back to all states */ }
  }
  const def = STATES.get(name.replace(/^minecraft:/, ''));
  if (!def) return Object.fromEntries(Object.entries(states).map(([k, v]) => [k, { type: typeof v === 'string' ? 'string' : typeof v === 'boolean' ? 'byte' : 'int', value: typeof v === 'boolean' ? +v : v }]));
  const out = {};
  for (const [k, d] of Object.entries(def)) if (k in states) out[k] = { type: d.type, value: typeof states[k] === 'boolean' ? +states[k] : states[k] };
  return out;
}
function blockHash(req, name, states = {}, version) {
  const nbt = req('prismarine-nbt');
  const st = version ? netStates(req, version, name, states) : {};
  const buf = nbt.writeUncompressed({ type: 'compound', name: '', value: { name: { type: 'string', value: name.includes(':') ? name : 'minecraft:' + name }, states: { type: 'compound', value: st } } }, 'little');
  let h = 0x811c9dc5;
  for (const b of buf) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h | 0;
}

// hash -> { name, states, shape } for every vanilla block state (minecraft-data) + the custom blocks the server declares
const TABLES = new Map();
function fnv(buf) { let h = 0x811c9dc5; for (const b of buf) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h | 0; }
function blockTables(req, version) {
  if (TABLES.has(version)) return TABLES.get(version);
  const nbt = req('prismarine-nbt'), byHash = new Map();
  let md = null; try { md = require('node:module').createRequire(req.resolve('bedrock-protocol'))('minecraft-data')('bedrock_' + version); } catch { /* no data: blocks stay unknown */ }
  const cs = md?.blockCollisionShapes, first = new Map(), firstHash = new Map();
  const plain = (st) => Object.fromEntries(Object.entries(st ?? {}).map(([k, v]) => [k, v?.value ?? v]));
  (md?.blockStates ?? []).forEach((st, i) => {
    if (!first.has(st.name)) first.set(st.name, i);
    const h = fnv(nbt.writeUncompressed({ type: 'compound', name: '', value: { name: { type: 'string', value: 'minecraft:' + st.name }, states: { type: 'compound', value: st.states ?? {} } } }, 'little'));
    if (!firstHash.has('minecraft:' + st.name)) firstHash.set('minecraft:' + st.name, h);
    const ids = cs?.blocks?.[st.name];
    byHash.set(h, { name: 'minecraft:' + st.name, states: plain(st.states), shape: ids ? cs.shapes[ids[i - first.get(st.name)] ?? ids[0]] ?? null : null });
  });
  const t = { byHash, nbt, firstHash };   // (firstHash: a block's first state, what a placement is predicted as)
  TABLES.set(version, t);
  return t;
}
// custom blocks (StartGame block_properties): every permutation of their states, collision box from the definition when sent
function addCustomBlocks(t, props) {
  for (const bp of props ?? []) {
    const v = bp.state?.value ?? {}, list = v.properties?.value?.value ?? [];
    const box = v.components?.value?.['minecraft:collision_box']?.value;
    const shape = box?.enabled?.value === 0 ? [] : box?.origin ? (() => { const o = box.origin.value.value, z = box.size.value.value; return [[(o[0] + 8) / 16, o[1] / 16, (o[2] + 8) / 16, (o[0] + 8 + z[0]) / 16, (o[1] + z[1]) / 16, (o[2] + 8 + z[2]) / 16]]; })() : null;
    let perms = [{}];
    for (const pr of list) {
      const vals = pr.enum?.value?.value ?? [], type = pr.enum?.value?.type === 'string' ? 'string' : pr.enum?.value?.type === 'byte' ? 'byte' : 'int';
      perms = perms.flatMap((o) => vals.map((x) => ({ ...o, [pr.name.value]: { type, value: x } }))).slice(0, 4096);
    }
    for (const st of perms) {
      const h = fnv(t.nbt.writeUncompressed({ type: 'compound', name: '', value: { name: { type: 'string', value: bp.name }, states: { type: 'compound', value: st } } }, 'little'));
      t.byHash.set(h, { name: bp.name, states: Object.fromEntries(Object.entries(st).map(([k, x]) => [k, x.type === 'byte' ? !!x.value : x.value])), shape: shape ?? [[0, 0, 0, 1, 1, 1]] });
    }
  }
}
// a network sub-chunk (format 8/9, palettes of runtime ids): layer 0 as { pal, idx } (index = x*256 + z*16 + y)
function readSubChunk(buf, off = 0) {
  let i = off;
  const vi = () => { let v = 0, sh = 0, b; do { b = buf[i++]; v |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80 && sh < 35); return v >>> 0; };
  const zz = () => { const v = vi(); return (v >>> 1) ^ -(v & 1); };
  const ver = buf[i++];
  if (ver !== 8 && ver !== 9) return null;
  const n = buf[i++], y = ver === 9 ? (buf[i++] << 24) >> 24 : null;
  let layer0 = null;
  for (let l = 0; l < n; l++) {
    const bits = buf[i++] >> 1, idx = new Uint16Array(4096);
    if (bits) {
      const per = Math.floor(32 / bits), mask = (1 << bits) - 1;
      for (let w = 0, words = Math.ceil(4096 / per); w < words; w++) { const word = buf.readUInt32LE(i); i += 4; for (let k = 0; k < per; k++) { const q = w * per + k; if (q < 4096) idx[q] = (word >>> (k * bits)) & mask; } }
    }
    const pal = []; for (let k = 0, m = bits ? zz() : 1; k < m; k++) pal.push(zz());
    if (!layer0) layer0 = { pal, idx };
  }
  return { y, layer0, end: i };
}

function load(req) {
  const rakPath = req.resolve('bedrock-protocol/src/rak');
  class Adapter extends RakClient {
    constructor(o) { super({ host: o.host, port: o.port }); }
    async ping(timeout = 3000) {
      super.ping();
      return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ping timed out')), timeout); this.once('pong', (s) => { clearTimeout(t); res(s); }); });
    }
  }
  // `new Transport(o)`: RakNet, or NetherNet when this join asked for it (a constructor may return another object)
  function Transport(o) { return NEXT.transport === 'nethernet' ? (NEXT.conn = new NetherNetClient({ host: o.host, port: o.port, url: NEXT.url, ca: NEXT.ca, RTC: NEXT.rtc, identity: NEXT.identity, pins: NEXT.pins, expectKey: NEXT.expectKey, log: NEXT.log, name: NEXT.name })) : (NEXT.rak = new Adapter(o)); }
  req.cache[rakPath] = { id: rakPath, filename: rakPath, loaded: true, exports: () => ({ RakClient: Transport, RakServer: class {}, RakTimeout: Error }) };
  return req('bedrock-protocol');
}

// minecraft-data's table for this version decodes a few packets wrong (checked byte by byte against BDS 1.26.51);
// fixed in place before the first client is created, so `saw` shows what the server really sent
const PATCHED = new Set();
function patchProtocol(req, version) {
  if (PATCHED.has(version)) return;
  PATCHED.add(version);
  let t;
  try { t = require('node:module').createRequire(req.resolve('bedrock-protocol'))('minecraft-data')('bedrock_' + version)?.protocol?.types; } catch { return; }
  if (!t) return;
  const field = (pk, name) => t[pk]?.[1]?.find((f) => f.name === name);
  // minecraft-data's 1.26.45 table (protocol 2169) gives optional fields as an `x_presence` bool plus an `option` x. BDS 1.26.45
  // writes/reads them as: absent = one 0 byte, present = 1, 1, value (measured with raw auth inputs: walk, flags, block actions),
  // i.e. an option of an option. The input flags are an option of the list (1, count, flags...). 1.26.51 dropped the outer bool.
  if (field('packet_player_auth_input', 'block_action_presence')) {
    const fix = (ty) => {
      if (!Array.isArray(ty)) return ty;
      if (ty[0] === 'container') {
        const fs = ty[1].filter((f) => !(/_presence$/.test(f.name ?? '') && f.type === 'bool' && ty[1].some((g) => g.name === f.name.replace(/_presence$/, '') && Array.isArray(g.type) && g.type[0] === 'option')));
        return ['container', fs.map((f) => ({ ...f, type: ty[1].some((g) => g.name === f.name + '_presence' && g.type === 'bool') && f.type[0] === 'option' ? ['option', fix(f.type)] : fix(f.type) }))];
      }
      if (ty[0] === 'option') return ['option', fix(ty[1])];
      if (ty[0] === 'array') return ['array', typeof ty[1] === 'object' && !Array.isArray(ty[1]) ? { ...ty[1], type: fix(ty[1].type) } : fix(ty[1])];
      if (ty[0] === 'switch') return ['switch', { ...ty[1], fields: Object.fromEntries(Object.entries(ty[1].fields).map(([k, v]) => [k, fix(v)])) }];
      return ty;
    };
    for (const k of Object.keys(t)) if (JSON.stringify(t[k]).includes('_presence"')) t[k] = fix(t[k]);
  }
  // set_hud: elements and visibility are signed varints (zigzag), not plain varints
  if (t.Element?.[0] === 'mapper') t.Element = ['mapper', { type: 'zigzag32', mappings: t.Element[1].mappings }];
  const vis = field('packet_set_hud', 'visibility'); if (vis) vis.type = ['mapper', { type: 'zigzag32', mappings: { 0: 'hide', 1: 'reset' } }];
  // camera_instruction: fade = optional time (in, wait, out) + optional color; fov carries the ease type as a string
  const fade = field('packet_camera_instruction', 'fade');
  if (fade) fade.type = ['option', ['container', [{ name: 'time', type: ['option', ['container', [{ name: 'fade_in_duration', type: 'lf32' }, { name: 'wait_duration', type: 'lf32' }, { name: 'fade_out_duration', type: 'lf32' }]]] }, { name: 'color_rgb', type: ['option', 'vec3f'] }]]];
  // camera spline: the type is a byte (0 catmull_rom, 1 linear) and key frames carry the ease name without a has-flag
  if (t.CameraSplineInstruction) {
    const key = (v) => ['array', { countType: 'varint', type: ['container', [{ name: 'value', type: v }, { name: 'time', type: 'lf32' }, { name: 'ease_type', type: 'string' }]] }];
    t.CameraSplineInstruction = ['container', [{ name: 'total_time', type: 'lf32' }, { name: 'spline_type', type: ['mapper', { type: 'u8', mappings: { 0: 'catmull_rom', 1: 'linear' } }] }, { name: 'curve', type: ['array', { countType: 'varint', type: 'vec3f' }] },
      { name: 'progress_key_frames', type: key('lf32') }, { name: 'rotation_options', type: key('vec3f') }, { name: 'spline_identifier', type: ['option', 'string'] }, { name: 'load_from_json', type: ['option', 'bool'] }]];
  }
  // data-driven UI data store (CustomForm / MessageBox): decoded byte by byte against BDS 1.26.51 and Mojang's protocol docs.
  // Values are tagged li32 (0 none, 1 bool, 2 int64, 3 double, 4 string, 6 map); the entry kind is a varint, not lu32
  // a path update (`layout[1].toggled`) carries a varint-tagged value: 0 double, 1 bool, 2 string (same in both directions)
  const DSU = [{ name: 'name', type: 'string' }, { name: 'property', type: 'string' }, { name: 'path', type: 'string' },
    { name: 'data_type', type: ['mapper', { type: 'varint', mappings: { 0: 'double', 1: 'bool', 2: 'string' } }] },
    { name: 'data', type: ['switch', { compareTo: 'data_type', fields: { double: 'lf64', bool: 'bool', string: 'string' } }] }, { name: 'update_count', type: 'lu32' }, { name: 'path_update_count', type: 'lu32' }];
  if (t.packet_serverbound_data_store) t.packet_serverbound_data_store = ['container', DSU];
  // closing a data-driven screen: a plain lu32 form id (no presence flag, unlike the table) + the reason as a string
  // (Mojang's docs say uint8; BDS reads a varint-length string: found with raw bytes, `@A raw 343 ...`)
  // FullContainerName: the dynamic id (a bundle's bundle_id) is little-endian (minecraft-data read 2 as 33554432)
  if (t.FullContainerName) t.FullContainerName = ['container', [{ name: 'container_id', type: 'ContainerSlotType' }, { name: 'dynamic_container_id', type: ['option', 'lu32'] }]];
  // RequestPermissions: the level is a compressed int32 (zigzag varint) in Mojang's docs, not a byte (checked: member arrived as -1)
  if (t.packet_request_permissions) t.packet_request_permissions = ['container', [{ name: 'entity_unique_id', type: 'li64' }, { name: 'permission_level', type: ['mapper', { type: 'zigzag32', mappings: { 0: 'visitor', 1: 'member', 2: 'operator', 3: 'custom' } }] }, { name: 'requested_permissions', type: 'RequestPermissions' }]];
  // StructureBlockUpdate: the name is a RedactableString (text + optional filtered text), see Mojang's StructureEditorData
  if (t.packet_structure_block_update) t.packet_structure_block_update = ['container', [{ name: 'position', type: 'BlockCoordinates' }, { name: 'structure_name', type: 'string' }, { name: 'filtered_structure_name', type: ['option', 'string'] },
    { name: 'data_field', type: 'string' }, { name: 'include_players', type: 'bool' }, { name: 'show_bounding_box', type: 'bool' }, { name: 'structure_block_type', type: 'zigzag32' }, { name: 'settings', type: 'StructureBlockSettings' },
    { name: 'redstone_save_mode', type: 'varint' }, { name: 'should_trigger', type: 'bool' }, { name: 'water_logged', type: 'bool' }]];
  // NpcRequest: the 4th field is a plain uint8 index (button to press / skin to wear), not a request-type enum (indexes > 6 did not encode)
  if (t.packet_npc_request) t.packet_npc_request = ['container', [{ name: 'runtime_entity_id', type: 'varint64' }, { name: 'request_type', type: t.packet_npc_request[1][1].type }, { name: 'command', type: 'string' }, { name: 'action_index', type: 'u8' }, { name: 'scene_name', type: 'string' }]];
  if (t.packet_serverbound_data_driven_screen_closed) t.packet_serverbound_data_driven_screen_closed = ['container', [{ name: 'form_id', type: 'lu32' }, { name: 'close_reason', type: 'string' }]];
  if (t.DataStorePropertyValue) {
    t.DataStorePropertyValue = ['container', [{ name: 'type', type: ['mapper', { type: 'li32', mappings: { 0: 'none', 1: 'bool', 2: 'int64', 3: 'double', 4: 'string', 6: 'map' } }] },
      { name: 'value', type: ['switch', { compareTo: 'type', fields: { none: 'void', bool: 'bool', int64: 'li64', double: 'lf64', string: 'string', map: ['array', { countType: 'varint', type: 'DataStoreMapEntry' }] } }] }]];
    t.DataStoreChangeEntry = ['container', [{ name: 'change_type', type: ['mapper', { type: 'varint', mappings: { 0: 'update', 1: 'change', 2: 'removal' } }] },
      { anon: true, type: ['switch', { compareTo: 'change_type', fields: {
        update: ['container', DSU],
        change: ['container', [{ name: 'name', type: 'string' }, { name: 'property', type: 'string' }, { name: 'update_count', type: 'lu32' }, { name: 'new_value', type: 'DataStorePropertyValue' }]],
        removal: ['container', [{ name: 'name', type: 'string' }]] } }] }]];
  }
  if (t.packet_clientbound_update_sound_data) t.packet_clientbound_update_sound_data = ['container', [{ name: 'server_sound_handle', type: 'lu64' }, { name: 'data', type: 'restBuffer' }]];
  // input locks: bit n = InputPermissionCategory n (camera 1 ... move_right 12)
  if (t.InputLockFlags) t.InputLockFlags = ['bitflags', { type: 'varint', flags: { camera: 2, movement: 4, lateral_movement: 16, sneak: 32, jump: 64, mount: 128, dismount: 256, move_forward: 512, move_backward: 1024, move_left: 2048, move_right: 4096 } }];
  // level_event_generic: the event id is a signed varint (1900 queue / 1901 play / 1902 stop custom music ...)
  const lev = field('packet_level_event_generic', 'event_id'); if (lev) lev.type = 'zigzag32';
  // player_update_entity_overrides: target is the entity's unique id (zigzag64) and the "legacy type" is a name string
  if (t.packet_player_update_entity_overrides) t.packet_player_update_entity_overrides = ['container', [{ name: 'entity_unique_id', type: 'zigzag64' }, { name: 'property_index', type: 'varint' },
    { name: 'type', type: ['mapper', { type: 'varint', mappings: { 0: 'clear_all', 1: 'remove', 2: 'set_int', 3: 'set_float' } }] }, { name: 'type_name', type: 'string' }, { name: 'value', type: ['switch', { compareTo: 'type', fields: { set_int: 'li32', set_float: 'lf32' } }] }]];
  const fov = field('packet_camera_instruction', 'fov');
  if (fov) fov.type = ['option', ['container', [{ name: 'field_of_view', type: 'lf32' }, { name: 'ease_time', type: 'lf32' }, { name: 'ease_type', type: 'string' }, { name: 'clear', type: 'bool' }]]];
}

// form JSON (modal_form_request) -> the same one-line shape the sim-player form capture prints
function describeForm(j) {
  const q = (s) => JSON.stringify(typeof s === 'string' ? s : s?.rawtext ? s.rawtext.map((x) => x.text ?? '%' + x.translate).join('') : s ?? '');
  // action forms list buttons in `buttons` (older) or `elements` (buttons mixed with header/label/divider; `form <n>` counts buttons only)
  if (j.type === 'form') return 'action: ' + [`title(${q(j.title)})`, j.content ? `body(${q(j.content)})` : '', ...(j.buttons ?? j.elements ?? []).map((b) => `${b.type && b.type !== 'button' ? b.type : 'button'}(${q(b.text ?? '')})`)].filter(Boolean).join(' ');
  if (j.type === 'modal') return `message: title(${q(j.title)}) body(${q(j.content)}) button1(${q(j.button1)}) button2(${q(j.button2)})`;
  const map = { input: 'textField', toggle: 'toggle', slider: 'slider', step_slider: 'slider', dropdown: 'dropdown', label: 'label', header: 'header', divider: 'divider' };
  return 'modal: ' + [`title(${q(j.title)})`, ...(j.content ?? []).map((c) => `${map[c.type] ?? c.type}(${[c.text, c.placeholder, c.options ?? c.steps].filter((x) => x !== undefined && x !== '').map((x) => (Array.isArray(x) ? JSON.stringify(x) : q(x))).join(',')})`)].join(' ');
}

const TYPE_ALIAS = { villager: 'villager_v2', zombie_villager: 'zombie_villager_v2', evoker: 'evocation_illager', zombified_piglin: 'zombie_pigman', tropical_fish: 'tropicalfish', end_crystal: 'ender_crystal' };
// the effect ids MobEffect carries (Bedrock's numbering)
const EFFECTS = [null, 'speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost', 'nausea', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision', 'hunger', 'weakness', 'poison', 'wither', 'health_boost', 'absorption', 'saturation', 'levitation', 'fatal_poison', 'conduit_power', 'slow_falling', 'bad_omen', 'village_hero', 'darkness', 'trial_omen', 'wind_charged', 'weaving', 'oozing', 'infested', 'raid_omen'];
const ACTIONS = 'raw packs chat typing wake sleep perm settings serversettings crafter structure cmd look lookat turn walk goto sprint jump sneak stick swim crawl fly land glide stop release slot hotbar use useon dig drop swing emote attack interact ride frame dismount pick move quick split spread swap open take put close craft enchant anvil cut carto smith grind loom trade beacon sign book lectern fish creative cmdblock option render inputmode packsetting form npc skin watch message respawn inv status pos target near request packet leave actions';

// names nearest to a mistyped one: shared words first (fly_to_moon → fly_to fly_up ...), then edit distance
function closest(w, names, k = 8) {
  const lev = (a, b) => { let p = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[b.length]; };
  const tw = w.split('_').filter(Boolean);
  const score = (x) => { const tx = x.split('_'); return lev(w, x) - 4 * tw.filter((t) => tx.includes(t)).length - (tx[0] === tw[0] ? 2 : 0); };
  return [...new Set(names)].map((x) => [x, score(x)]).sort((p, q) => p[1] - q[1] || p[0].localeCompare(q[0])).slice(0, k).map((x) => x[0]);
}

// what the client says about itself at login (Player.clientSystemInfo, graphicsMode, inputInfo): `@A join os=android locale=ja_JP ...`
const DEVICE_OS = { android: 1, ios: 2, macos: 3, fireos: 4, gearvr: 5, hololens: 6, windows: 7, win32: 8, dedicated: 9, tvos: 10, playstation: 11, switch: 12, xbox: 13, windowsphone: 14, linux: 15 };
const PLATFORM = { desktop: 0, mobile: 1, console: 2 };
const GRAPHICS = { simple: 0, fancy: 1, advanced: 2, raytraced: 3 };
const INPUT = { mouse: 1, touch: 2, gamepad: 3 };
const skinColor = (v) => { const h = String(v).replace(/^#/, ''); if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) throw new Error('skincolor=#rrggbb'); return '#' + (h.length === 6 ? 'ff' + h : h).toLowerCase(); };
function loginData(o) {
  const d = {};
  const pick = (k, map) => { if (o[k] === undefined) return undefined; const v = map ? map[o[k].toLowerCase()] : Number(o[k]); if (v === undefined || Number.isNaN(v)) throw new Error(`join ${k}=${o[k]}: use ${map ? Object.keys(map).join('|') : 'a number'}`); return v; };
  if (o.locale) d.LanguageCode = o.locale;
  if (o.platform) d.PlatformType = pick('platform', PLATFORM);
  if (o.render) d.MaxViewDistance = pick('render');
  if (o.memory) d.MemoryTier = pick('memory');
  if (o.graphics) d.GraphicsMode = pick('graphics', GRAPHICS);
  if (o.input) d.CurrentInputMode = d.DefaultInputMode = pick('input', INPUT);
  if (o.ui) d.UIProfile = { classic: 0, pocket: 1 }[o.ui];
  if (o.gui) d.GuiScale = pick('gui');
  if (o.skin) { if (!['slim', 'wide'].includes(o.skin)) throw new Error('join skin=slim|wide'); d.ArmSize = o.skin; }   // gametest getPlayerSkin().armSize
  if (o.skincolor) d.SkinColor = skinColor(o.skincolor);
  return d;
}

// lan: { nc, config, guard, endpoint, transport, account, observe, allowChat } — transport=lan joins through nethernet-connect
// (common/nethernet-connect): only peers on this machine / the same LAN / the user's own Tailscale devices, a local world by the
// local world's own method (UDP 7551), a server by its own (NetherNet HTTP / RakNet); account = a signed-in Xbox account (else offline)
async function createRealPlayer({ req, host = '127.0.0.1', port, name, version, emit, blockAt, itemTags, packId, packNames = {}, opts = {}, timeoutMs = 60000, transport = 'raknet', rtc = null, nn = {}, lan = null }) {
  const bp = load(req);
  // transport=raknet|nethernet (default: what the server runs). NetherNet only: identity=verify|strict|warn|off (the server's
  // a=identity: verify = trust on first use like the game, strict = a key not pinned yet is refused), key=<pin> (the server
  // must present this key), signaling=http(s)://host[:port][/path] (a reverse proxy in front of server-port; https = TLS is the
  // trust anchor), ca=<pem file> (trust a test CA for that https). nn.pins = the pin store file (the lab keeps one per cache)
  const tr = opts.transport ?? transport;
  if (!['raknet', 'nethernet', 'lan'].includes(tr)) throw new Error(`join transport=${tr}: raknet|nethernet|lan`);
  if (tr === 'lan' && !lan?.nc) throw new Error('join transport=lan: the server runs another transport (LAB_TRANSPORT=lan, or node lab.mjs lan run)');
  const nnOpts = ['identity', 'key', 'signaling', 'ca'].filter((k) => opts[k] !== undefined);
  if (tr !== 'nethernet' && nnOpts.length) throw new Error(`join ${nnOpts.map((k) => k + '=').join(' ')}: NetherNet options (the server runs raknet; LAB_TRANSPORT=nethernet)`);
  if (opts.identity !== undefined && !['verify', 'strict', 'warn', 'off'].includes(opts.identity)) throw new Error(`join identity=${opts.identity}: verify|strict|warn|off`);
  if (opts.key !== undefined && !/^[0-9a-f]{16}$/.test(opts.key)) throw new Error(`join key=${opts.key}: the 16 hex digits shown as "nethernet: server key <pin>"`);
  if (opts.ca !== undefined && !require('node:fs').existsSync(opts.ca)) throw new Error(`join ca=${opts.ca}: no such file`);
  if (tr === 'nethernet' && !rtc) throw new Error('join transport=nethernet: WebRTC (node-datachannel) is not installed');
  NEXT = { transport: tr, rtc, identity: opts.identity ?? 'verify', expectKey: opts.key ?? null, url: opts.signaling ?? null, ca: opts.ca ?? null, pins: nn.pins ?? null, log: (l) => emit(`@${name} ${l}`), name, conn: null };
  for (const k of ['transport', 'identity', 'key', 'signaling', 'ca']) delete opts[k];
  const known = new Set(['os', 'locale', 'platform', 'render', 'memory', 'graphics', 'input', 'ui', 'gui', 'skin', 'skincolor']);
  for (const k of Object.keys(opts)) if (!known.has(k)) throw new Error(`join: unknown option ${k} (${[...known].join(' ')})`);
  const deviceOS = opts.os === undefined ? undefined : DEVICE_OS[opts.os.toLowerCase()];
  if (opts.os !== undefined && deviceOS === undefined) throw new Error(`join os=${opts.os}: use ${Object.keys(DEVICE_OS).join('|')}`);
  patchProtocol(req, version);
  // a real player is the same player when it comes back: stable device/self-signed ids per name (bedrock-protocol draws new ones
  // every login, which made BDS treat each rejoin as a new player: empty inventory, initialSpawn again, no dynamic properties)
  const sid = (k) => { const h = crypto.createHash('md5').update('bds-lab:' + k + ':' + name).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
  // NetherNet: signaling waits for the server's full ICE gathering (seconds; ~12 s for a Windows server under Wine), so the
  // transport gets a longer connect budget than bedrock-protocol's 9 s default
  const skinData = { DeviceId: sid('device'), SelfSignedId: sid('self'), PlayFabId: sid('playfab').replace(/-/g, '').slice(0, 16), ClientRandomId: parseInt(sid('rand').slice(0, 8), 16), ...loginData(opts) };
  let client, lanConn = null;
  if (tr === 'lan') {
    // through nethernet-connect's guard: it resolves the version, signs in (lan.account) or joins offline, and in observe mode
    // sends nothing that changes the world
    const conn = lan.nc.connectToEndpoint(lan.config, lan.guard, lan.endpoint, {
      transport: lan.transport, account: lan.account ?? null, observe: !!lan.observe, allowChat: lan.allowChat !== false,
      log: (l) => emit(`@${name} ${String(l).trim()}`), clientOptions: { skinData, connectTimeout: 60000, ...(deviceOS ? { deviceOS } : {}) },
    });
    client = conn.client;
    lanConn = conn;
  } else {
    client = bp.createClient({ host, port, username: name, offline: true, skipPing: true, version, followPort: false, conLog: null, raknetBackend: 'raknet-native', ...(tr === 'nethernet' ? { connectTimeout: 60000 } : {}), ...(deviceOS ? { deviceOS } : {}), skinData });
  }
  // NetherNet: the offer's identity is signed with the login's key; DTLS encrypts, so the game layer does not (like a real client)
  if (NEXT.conn) { NEXT.conn.keyPair = client.ecdhKeyPair; client.disableEncryption = true; }
  const bot = new EventEmitter();
  bot.lan = lanConn;   // transport=lan: nethernet-connect's connection (chat() respects observe mode, observer.blocked)
  const say = (s) => emit(`@${name} ${s}`);
  let rid = null, tick = 0n, ready = false, yaw = 0, pitch = 0, teleportAck = false, dead = false;
  let pos = { x: 0.5, y: -60 + EYE, z: 0.5 }, flying = false;   // (flying: asked for with `fly`, until `land`)
  let selfHurtAt = -99, selfOnFire = false;   // (on fire: the server's own flag on this player's entity data)
  let fallV = 0, gliding = false, crawling = false;   // crawling: from `crawl on` until `crawl off` (a 1-block gap, at sneaking pace)   // the vertical speed this client predicts (blocks a tick, + up); gliding: from `glide` until landing
  const controls = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
  let held = { jump: false, sneak: false, sprint: false }, stick = null;   // stick = analog move vector (gamepad / touch)
  const inv = { slots: [], selected: 0, armor: [], offhand: [], ui: [] };   // ui slot 0 = the cursor
  const entities = new Map(); // id -> { id, type, x, y, z }
  // a mob by the name people use, or its id: BDS spawns villagers as villager_v2, the evoker is evocation_illager, ...
  const isType = (e, q) => e.name === q || e.type === q || e.type === 'minecraft:' + q || (TYPE_ALIAS[q] !== undefined && e.type === 'minecraft:' + TYPE_ALIAS[q]);
  const blockActions = [];
  let heldUseOn = null, form = null, digging = null, using = false, inputMode = { 2: 'touch', 3: 'game_pad' }[INPUT[opts.input]] ?? 'mouse', vehicle = null;
  // digLag: ticks from the first hit on a block to the server's answer (a running mean): 1-3 on a near server at 1x, 6-13 at 20x
  // (the network keeps real time). unconfirmed: blocks this client broke by its own count, not yet confirmed (key -> {tick, rid})
  let digLag = 0, digRefused = 0, placeWatch = null;   // placeWatch: LAB_DEBUG_PLACE, the cell the last click should fill
  const unconfirmed = new Map();
  // blocks this client set down by its own word (a `useon ... fast` click: the block under the feet at the top of a jump), as a real
  // client shows them at once and lands on them; the server's word replaces them, none after a while: taken away again
  const predicted = new Map();   // "x,y,z" -> { tick, rid (what was there), pos }
  // lag: ticks from asking the server to its answer (a running mean over digs and inventory requests): what a wait for the server's
  // word is measured in (at 20x the network keeps real time: an answer is 5-15 ticks away instead of 1-2)
  let lag = 0;
  const askedAt = new Map();   // item stack request id -> tick sent
  const noteLag = (n) => { if (n >= 0 && n < 400) lag = lag ? lag * 0.8 + n * 0.2 : n; };
  const pulse = new Set(), holdFlags = new Set();
  const pendingCmd = new Map();

  // a packet this protocol table cannot decode is still shown (id, name, hex) instead of vanishing
  let lastRaw = null, packetNames = {}, watching = null, locks = {}, camLock = null;
  try { const md = require('node:module').createRequire(req.resolve('bedrock-protocol'))('minecraft-data')('bedrock_' + (version ?? '')); packetNames = md?.protocol?.types?.mcpe_packet?.[1]?.[0]?.type?.[1]?.mappings ?? {}; } catch { /* names optional */ }
  const read0 = client.readPacket.bind(client);
  client.readPacket = (buf) => { lastRaw = buf; return read0(buf); };
  const rawName = (b) => { let v = 0, sh = 0, i = 0; for (; i < 5; i++) { v |= (b[i] & 0x7f) << sh; sh += 7; if (!(b[i] & 0x80)) break; } return { id: v & 0x3ff, name: packetNames[v & 0x3ff] ?? '#' + (v & 0x3ff), body: b.subarray(i + 1) }; };
  // start_game that this protocol table cannot read (a Minecraft newer than bedrock-protocol, "borrowed" client): its first
  // fields have kept their shape for years (entity id zigzag64, runtime id varint64, game mode zigzag32), so the player still
  // learns who it is and can act; the rest (spawn, custom block palette) comes from later packets or stays default
  const salvageStart = (b) => {
    let o = 0; const vb = () => { let v = 0n, sh = 0n; for (;;) { const x = b[o++]; v |= BigInt(x & 0x7f) << sh; sh += 7n; if (!(x & 0x80) || o >= b.length) return v; } };
    const zz = (v) => (v >> 1n) ^ -(v & 1n);
    try {
      const entity_id = zz(vb()), runtime_entity_id = vb(), gm = Number(zz(vb()));
      const p = { entity_id, runtime_entity_id, player_gamemode: ['survival', 'creative', 'adventure', 'survival_spectator', 'creative_spectator', 'fallback', 'spectator'][gm] ?? 'survival', salvaged: true };
      client.startGameData = { ...(client.startGameData ?? {}), ...p };
      client.emit('start_game', p);
      say(`(start_game read partly: runtime id ${runtime_entity_id})`);
    } catch { /* leave it */ }
  };
  client.on('error', (e) => {
    if (/Read error/.test(e.message) && lastRaw && rawName(lastRaw).name === 'start_game') { const r = rawName(lastRaw); lastRaw = null; salvageStart(r.body); return; }
    if (/Read error/.test(e.message) && lastRaw) { const r = rawName(lastRaw); lastRaw = null; if (watching && (watching === true || watching.has(r.name))) say(`saw ${r.name} raw ${r.body.toString('hex').slice(0, 400)}`); else if (process.env.LAB_DEBUG) say(`undecodable ${r.name} ${r.body.toString('hex').slice(0, 200)}`); return; }
    say('error: ' + String(e.message).slice(0, 200));
  });
  if (process.env.LAB_DEBUG) client.on('packet', (pk) => { const n = pk.data?.name; if (ready && !/level_chunk|move_entity|set_entity_data|update_attributes|network_chunk|set_entity_motion|level_sound|move_player|update_block|biome|sync_|entity_event|animate|subchunk|network_stack/.test(n)) say('pk ' + n + ' ' + JSON.stringify(big(pk.data.params)).slice(0, 160)); });
  let myUid = null;
  const players = new Map();   // name -> entity unique id (player list: everyone online, near or not)
  let myMode = 'survival', myPerm = 'member';   // what the client knows about itself: game mode and permission (the NPC editor needs creative + operator)
  client.on('start_game', (p) => { rid = p.runtime_entity_id; myUid = p.entity_id; myMode = String(p.player_gamemode ?? myMode); });
  // flying ends where the server says so (back to survival, abilities without it): a `fly` left on made every later step a
  // predicted flight (a glide after a creative flight never started)
  const grounded = (m) => { if (!/creative|spectator/.test(String(m))) flying = false; };
  client.on('set_player_game_type', (p) => { myMode = String(p.gamemode); grounded(myMode); });
  client.on('update_player_game_type', (p) => { if (myUid !== null && BigInt(p.player_unique_id) === BigInt(myUid)) { myMode = String(p.gamemode); grounded(myMode); } });
  client.on('update_abilities', (p) => {
    if (myUid === null || BigInt(p.entity_unique_id) !== BigInt(myUid)) return;
    myPerm = String(p.permission_level);
    // (only when flight is no longer allowed at all: an update sent just before the server took this client's take-off would say
    // "not flying" and end a flight that is starting)
    const L = (p.abilities ?? []).find((l) => l.type === 'base'), has = (set, k) => (!set ? null : Array.isArray(set) ? set.includes(k) : typeof set === 'object' ? !!set[k] : null);
    if (has(L?.allowed, 'may_fly') && has(L?.enabled, 'may_fly') === false) flying = false;   // (the layer sets may_fly, to no)
  });
  client.on('player_list', (p) => { for (const r of [].concat(p.records?.records ?? p.records ?? [])) if (r.type === 'add' && r.username) players.set(r.username, r.entity_unique_id); });
  // leaving the End through its exit portal plays the credits: the player skips them (Esc), then the server respawns them
  client.on('show_credits', (p) => { if (p.status === 0) { say('credits (skipped)'); client.queue('show_credits', { runtime_entity_id: rid, status: 1 }); } });
  // a packet this BDS build's table cannot write (field names differ per protocol) is reported, never thrown into the action
  const send = (n, params, what) => { try { client.queue(n, params); return true; } catch (e) { if (what) say(`${what}: this protocol cannot send ${n} (${String(e.message).split('\n')[0].slice(0, 120)})`); return false; } };
  // what a real client sends by itself; each one switches off quietly the first time this protocol cannot write it
  const autoOff = new Set();
  const auto = (n, params) => { if (autoOff.has(n)) return; if (!send(n, params)) autoOff.add(n); };
  // a boss bar shown to this client: the client registers itself for it (BossEvent RegisterPlayer), like the game does
  client.on('boss_event', (p) => { if (rid !== null && (p.type === 'show_bar' || p.type === 0)) auto('boss_event', { boss_entity_id: p.boss_entity_id, type: 'register_player', player_id: rid }); });
  client.on('server_settings_response', (p) => {   // the settings screen's server page (answered with `form`, like modal forms)
    let j; try { j = JSON.parse(p.data); } catch { j = { type: '?' }; }
    form = { id: p.form_id, j, settings: true };
    say('form settings ' + describeForm(j));
  });
  // resource packs the server offers this client (what a player would download): `@A packs`
  let offered = [];
  // minecraft-data reads this uuid with each 8-byte half reversed: undo it (checked against the manifest bytes)
  const fixUuid = (u) => { const h = String(u).replace(/-/g, ''); if (h.length !== 32) return u; const r = (x) => x.match(/../g).reverse().join(''); const f = r(h.slice(0, 16)) + r(h.slice(16)); return `${f.slice(0, 8)}-${f.slice(8, 12)}-${f.slice(12, 16)}-${f.slice(16, 20)}-${f.slice(20)}`; };
  client.on('resource_packs_info', (p) => { offered = (p.texture_packs ?? []).map((x) => `${packNames[x.uuid] ?? packNames[fixUuid(x.uuid)] ?? fixUuid(x.uuid)} v${x.version} ${Math.round(Number(x.size) / 1024)}KB${x.has_scripts ? ' scripts' : ''}`); });
  const uniq = new Map();
  const addEnt = (p, e) => { entities.set(String(p.runtime_id), { id: p.runtime_id, uid: p.unique_id ?? p.entity_id_self, seen: tick, ...e, ...p.position, y: p.position.y - (e.type === 'minecraft:player' ? EYE : 0) }); uniq.set(String(p.unique_id ?? p.entity_id_self), String(p.runtime_id)); };
  client.on('add_player', (p) => { addEnt(p, { type: 'minecraft:player', name: p.username, held: (itemNames.get(p.held_item?.network_id) ?? '').replace(/^minecraft:/, '') }); npcMeta(entities.get(String(p.runtime_id)), p.metadata); });
  // entity data the client keeps: its box (what the crosshair hits), and an NPC's name and buttons (url_tag)
  // (and what shows on the mob: a creeper swelling - it flashes white on screen - a baby)
  const npcMeta = (e, md) => {
    if (e) for (const m of md ?? []) {
      if (m.key === 'name_raw_text') e.npcName = m.value; if (m.key === 'url_tag') e.npcActions = m.value; if (m.key === 'boundingbox_width') e.bw = m.value; if (m.key === 'boundingbox_height') e.bh = m.value;
      if (m.key === 'flags' && m.value && typeof m.value === 'object') { const lit = !!m.value.ignited; if (lit && !e.lit) e.litAt = Number(tick); e.lit = lit; e.baby = !!m.value.baby; }
    }
  };
  client.on('add_entity', (p) => {
    addEnt(p, { type: String(p.entity_type) });
    const e = entities.get(String(p.runtime_id)); npcMeta(e, p.metadata);
    if (e && /area_effect_cloud/.test(e.type)) { const r = (p.metadata ?? []).find((m) => m.key === 'area_effect_cloud_radius'); if (r) e.radius = Number(r.value); const g = (k) => { const m = (p.metadata ?? []).find((q) => q.key === k); return m ? Number(m.value) : undefined; }; e.cloudRate = g('area_effect_cloud_change_rate'); e.cloudDur = g('area_effect_cloud_duration'); e.cloudT0 = tick; }   // (the dragon's breath: its size)
    if (e?.type === 'minecraft:falling_block') {
      const v = (p.metadata ?? []).find((m) => m.key === 'variant'); if (v) e.fallRid = Number(v.value) | 0;
      // the block it was is gone from its cell (the server says nothing more about that cell: the client moves the falling
      // block itself; kept, the column over a player digging up stood there in this client's map and was dug at, unanswered)
      const x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z), r = world.rid(x, y, z);
      if (r !== undefined && r !== AIR && (e.fallRid === undefined || r === e.fallRid)) world.set(x, y, z, AIR);
    }
  });
  // a falling block (gravel, sand) that came down where this player stands: the server sets it into the player's own cells
  // without a word to this client (measured: gravel on the head, "nothing to dig (air)" until the player suffocated). Like the
  // game's client, which moves the falling block itself, this one puts it where it lands
  const landed = (e) => {
    const x = Math.floor(e.x), z = Math.floor(e.z); let y = Math.floor(e.y + 0.01);
    for (let k = 0; k < 64; k++) { const r = world.rid(x, y - 1, z), b = world.block(x, y - 1, z); if (r === undefined || !b) return; if (r !== AIR && !/water/.test(b.name)) break; y--; }
    const f = pos.y - EYE;
    if (Math.abs(x + 0.5 - pos.x) < 0.8 && Math.abs(z + 0.5 - pos.z) < 0.8 && y + 1 > f + 0.01 && y < f + 1.8 && world.rid(x, y, z) === AIR) {
      world.set(x, y, z, e.fallRid);
      if (process.env.LAB_DEBUG_DIG) say(`dbg a falling ${world.block(x, y, z)?.name} came down on me at ${x},${y},${z}`);
    }
  };
  // a dropped item: the client sees which item and how many lie there (a person reads it off the floating icon)
  client.on('add_item_entity', (p) => { addEnt({ runtime_id: p.runtime_entity_id, unique_id: p.entity_id_self, position: p.position }, { type: 'minecraft:item', item: (itemNames.get(p.item?.network_id) ?? '').replace(/^minecraft:/, ''), count: p.item?.count ?? 1 }); });
  client.on('set_entity_data', (p) => { if (rid !== null && String(p.runtime_entity_id) === String(rid)) { for (const m of p.metadata ?? []) if (m.key === 'flags' && m.value && typeof m.value === 'object') selfOnFire = !!m.value.onfire; }
    const e = entities.get(String(p.runtime_entity_id)); if (e) { npcMeta(e, p.metadata); if (/area_effect_cloud/.test(e.type)) { const r = (p.metadata ?? []).find((m) => m.key === 'area_effect_cloud_radius'); if (r) { e.radius = Number(r.value); e.cloudT0 = tick; e.cloudRate = 0; } } } });
  client.on('remove_entity', (p) => {
    const k = String(p.entity_id_self), rt = uniq.get(k);
    // the vehicle ridden is gone (killed, broken, despawned): no longer in it (no link removal comes for that; left set, every step
    // after would be sent as a vehicle move the server ignores, and the player would never move again)
    if (vehicle !== null && (String(vehicle) === String(rt ?? k) || String(vehicle) === String(BigInt.asUintN(64, BigInt(k))))) { vehicle = null; vpos = null; say('dismounted (the vehicle is gone)'); }
    const fe = entities.get(rt ?? k); if (fe?.fallRid !== undefined) try { landed(fe); } catch { /* land not loaded */ }
    entities.delete(rt ?? k); uniq.delete(k);
  });
  // a killed mob stays visible ~1s (death animation) before remove_entity: forget it as soon as it dies
  let bite = false;
  client.on('entity_event', (p) => { if (p.event_id === 'death_animation') { const d = entities.get(String(p.runtime_entity_id)); if (d) d.dead = true; entities.delete(String(p.runtime_entity_id)); } if (p.event_id === 'fish_hook_hook') bite = true; if (process.env.LAB_DEBUG && /fish/.test(p.event_id)) say('dbg ' + p.event_id); });
  client.on('move_entity', (p) => { const e = entities.get(String(p.runtime_entity_id)); if (e && p.position) Object.assign(e, p.position); });
  // most movement of mobs and dropped items comes as deltas (only the coordinates that changed, absolute values)
  client.on('move_entity_delta', (p) => { const e = entities.get(String(p.runtime_entity_id)); if (!e) return; if (p.x != null) e.x = p.x; if (p.y != null) e.y = p.y - (e.type === 'minecraft:player' ? EYE : 0); if (p.z != null) e.z = p.z; e.moved = tick; });
  client.on('move_player', (p) => {
    if (rid !== null && BigInt(p.runtime_id) === BigInt(rid)) { if (process.env.LAB_DEBUG_MOVE) say(`dbg mp t=${tick} y=${p.position.y.toFixed(2)} mode=${p.mode}`); pos = { ...p.position }; fallV = 0; resetMove(); yaw = p.yaw; pitch = p.pitch; teleportAck = true; }
    else { const e = entities.get(String(p.runtime_id)); if (e) Object.assign(e, p.position, { y: p.position.y - (e.type === 'minecraft:player' ? EYE : 0) }); }
  });
  // the boat this client steers (client-predicted vehicle); vrot is the protocol's vec2f { x: pitch, z: yaw } (a { y } was sent as
  // no yaw at all)
  let vpos = null, vdelta = { x: 0, y: 0, z: 0 }, vrot = { x: 0, z: 0 };
  // walking predicted (walkStep): the horizontal speed, and where this client put itself at each of its last ticks
  let hvel = { x: 0, z: 0 };
  const hist = new Map();
  const resetMove = () => { hvel = { x: 0, z: 0 }; hist.clear(); };
  client.on('correct_player_move_prediction', (p) => {
    if (process.env.LAB_DEBUG_MOVE) say(`dbg corr ${p.prediction_type} t=${tick} srv=${p.tick} y=${p.position.y.toFixed(2)} dy=${p.delta.y.toFixed(2)} g=${p.on_ground} rot=${JSON.stringify(p.rotation)} pos=${p.position.x.toFixed(2)},${p.position.z.toFixed(2)} ms=${Date.now() % 100000}`);
    if (p.prediction_type === 'player' || p.prediction_type === undefined) {
      // laid over what this client predicted for that tick: the difference moves the present (and the ticks predicted since),
      // so the steps taken after that tick are kept, not thrown back to where the server saw it then
      const T = Number(p.tick), was = Number.isFinite(T) ? hist.get(T) : undefined;
      if (was && !dead && !WALKSIM_OFF) {
        const ex = p.position.x - was.x, ey = p.position.y - was.y, ez = p.position.z - was.z;
        if (process.env.LAB_DEBUG_MOVE) say(`dbg corr err ${ex.toFixed(3)} ${ey.toFixed(3)} ${ez.toFixed(3)} vel ${hvel.x.toFixed(3)},${hvel.z.toFixed(3)} srv v ${Number(p.delta?.x).toFixed(3)},${Number(p.delta?.z).toFixed(3)}`);
        pos = { x: pos.x + ex, y: pos.y + ey, z: pos.z + ez };
        for (const [k, v] of hist) if (k > T) hist.set(k, { x: v.x + ex, y: v.y + ey, z: v.z + ez });
        if (Math.hypot(ex, ez) > 0.25) hvel = { x: Number(p.delta?.x) || 0, z: Number(p.delta?.z) || 0 };   // (off: take its speed too)
        if (Math.abs(ey) > 0.25) fallV = p.on_ground ? 0 : Number(p.delta?.y) || 0;
        if (p.on_ground && Math.abs(ey) > 0.05) fallV = 0;
      } else { pos = { ...p.position }; fallV = p.on_ground ? 0 : Number(p.delta?.y) || 0; }
      if (p.on_ground) gliding = false;
    }
    else if (p.prediction_type === 'vehicle' && vpos) { vpos = { ...p.position }; vdelta = { ...p.delta }; vrot = { ...p.rotation }; }
  });
  if (process.env.LAB_PKT) client.on('packet', (d) => { const n = d.data?.name; if (!/move|level_chunk|network_chunk|sound|update_attributes|set_entity_motion|set_entity_data|level_event|animate|player_list|update_block|subchunk|time|biome|tick_sync/.test(n)) say('pkt ' + n + ' ' + JSON.stringify(d.data.params, (k, v) => typeof v === 'bigint' ? String(v) : v).slice(0, 160)); });
  client.on('respawn', (p) => {
    // death: server says 0 (searching); the respawn button sends 2 (client ready); server answers 1 (ready) → player_action respawn
    if (p.state !== 1) return;
    pos = { ...p.position }; resetMove();
    if (dead) { client.queue('player_action', { runtime_entity_id: rid, action: 'respawn', position: { x: 0, y: 0, z: 0 }, result_position: { x: 0, y: 0, z: 0 }, face: -1 }); dead = false; vehicle = null; vpos = null; flying = false; fallV = 0; gliding = false; crawling = false; say('respawned'); }
    else client.queue('respawn', { position: p.position, state: 2, runtime_entity_id: p.runtime_entity_id });
  });
  let changing = false;
  client.on('change_dimension', (p) => {
    // like the real client: stop sending input, show the loading screen, then ack once the new dimension is there
    changing = true;
    pos = { ...p.position }; resetMove();
    dim = p.dimension; world.clear(); cols.clear(); winAt = null;
    const id = p.loading_screen_id;
    client.queue('serverbound_loading_screen', { type: 1, loading_screen_id: id });
    setTimeout(() => {
      client.queue('player_action', { runtime_entity_id: rid, action: 'dimension_change_ack', position: { x: 0, y: 0, z: 0 }, result_position: { x: 0, y: 0, z: 0 }, face: 0 });
      client.queue('serverbound_loading_screen', { type: 2, loading_screen_id: id });
      changing = false;
      say(`dimension ${['overworld', 'nether', 'the_end'][p.dimension] ?? p.dimension}`);
    }, 1500);
  });
  client.on('set_entity_link', (p) => {
    const l = p.link ?? p;
    // the link names actors by their unique id (the local player's is start_game's entity_id, not its runtime id)
    const who = BigInt(l.rider_entity_id ?? 0);
    if (rid === null || (who !== BigInt(rid) && (myUid === null || who !== BigInt(myUid)))) return;
    if (l.type === 'remove' || l.type === 0) { vehicle = null; vpos = null; say('dismounted'); return; }   // (the 1.26 tables give the type as a number: 0 = remove, 1 = rider, 2 = passenger)
    // the link gives the vehicle's unique id; packets about it (leave_vehicle, the predicted vehicle) take its runtime id (a
    // negative unique id written as an unsigned varint never ends)
    const rt = uniq.get(String(l.ridden_entity_id));
    vehicle = rt !== undefined ? BigInt(rt) : BigInt.asUintN(64, BigInt(l.ridden_entity_id));
    const e = entities.get(rt ?? String(l.ridden_entity_id));
    if (/boat/.test(e?.type ?? '')) { vpos = { x: e.x, y: e.y, z: e.z }; vdelta = { x: 0, y: 0, z: 0 }; vrot = { x: 0, z: e.yaw ?? yaw }; }
    say('riding ' + (e?.type ?? 'entity'));
  });
  // the server refuses this client's protocol (join version=...): the status a real client shows as "outdated client/server"
  client.on('play_status', (p) => { if (/failed/.test(String(p.status))) say(`refused: ${p.status} (${String(p.status).includes('client') ? 'this client is older than the server' : 'this client is newer than the server'})`); });
  let deathPos = null;
  // (a dig under way ends with the death: the button let go - a drowned runner went on "digging" on the death screen for two minutes)
  client.on('death_info', (p) => { if (!dead) { dead = true; deathPos = { x: pos.x, y: pos.y - EYE, z: pos.z, dim }; say(`died (${p.cause})`); if (digging) { const d = digging; digging = null; try { d.done(false); } catch { /* none waiting */ } } } });
  // what the player sees without asking: the sky (time, rain), the effect icons, where the spawn is; and the hearts / smoke a mob shows when fed
  let worldTime = null, worldTimeTick = 0n, rain = false, thunder = false, spawnPos = null;
  const effects = new Map(), entEvents = new Map();   // effect name -> { amp, until tick }; entity runtime id -> last entity event
  client.on('set_time', (p) => { worldTime = p.time; worldTimeTick = tick; clockPaused = false; });
  // 1.26+: the time comes as world clocks (sync_world_clocks: the overworld clock's time, paused or not); the first clock with a time
  let clockPaused = false;
  client.on('sync_world_clocks', (p) => {
    const find = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 4) return null; if (typeof o.time === 'number' || typeof o.time === 'bigint') return o; for (const v of Object.values(o)) { const r = find(v, d + 1); if (r) return r; } return null; };
    const c = find(p); if (!c) return;
    worldTime = Number(c.time); worldTimeTick = tick; clockPaused = !!c.paused;
    if (process.env.LAB_DEBUG_TIME) say(`clock ${worldTime} at tick ${tick}`);
  });
  client.on('level_event', (p) => {
    const w0 = thunder ? 'thunder' : rain ? 'rain' : 'clear';
    if (p.event === 'start_rain') rain = true; else if (p.event === 'stop_rain') rain = false; else if (p.event === 'start_thunder') thunder = true; else if (p.event === 'stop_thunder') thunder = false;
    const w1 = thunder ? 'thunder' : rain ? 'rain' : 'clear'; if (w1 !== w0) say(`weather: ${w1}`);
  });
  client.on('mob_effect', (p) => {
    if (rid === null || BigInt(p.runtime_entity_id) !== BigInt(rid)) return;
    const k = EFFECTS[p.effect_id] ?? 'effect_' + p.effect_id;
    if (p.event_id === 'remove') effects.delete(k); else effects.set(k, { amp: p.amplifier, until: tick + BigInt(Math.max(0, p.duration)) });
  });
  client.on('start_game', (p) => { if (p.spawn_position) spawnPos = { ...p.spawn_position }; });
  client.on('set_spawn_position', (p) => { if (p.spawn_type === 'player' || p.spawn_type === 0) spawnPos = { ...p.player_position }; });
  // a hurt flash on anything (the red flash a person sees): when its 10 ticks of not being hurt again began - the next blow timed to
  // land on the tick they end (PvP's "0.5 exactly"), and this player's own (hurtAt) for the knock-back it brings
  client.on('entity_event', (p) => {
    entEvents.set(String(p.runtime_entity_id), p.event_id);
    if (p.event_id === 'hurt_animation') { const e = entities.get(String(p.runtime_entity_id)); if (e) e.hurtAt = Number(tick); if (rid !== null && BigInt(p.runtime_entity_id) === BigInt(rid)) selfHurtAt = Number(tick); }
  });
  const itemNames = new Map();
  client.on('item_registry', (p) => { for (const it of p.itemstates ?? []) itemNames.set(it.runtime_id, it.name); });
  const iname = (it) => (it?.network_id ? `${itemNames.get(it.network_id) ?? '#' + it.network_id}*${it.count}` : null);
  const list = (slots) => slots.map((it, i) => (iname(it) ? `${i}:${iname(it)}` : null)).filter(Boolean).join(' ') || 'empty';
  const attrs = {};
  // LAB_HURT_LOG=1: every drop in health, with what was near (a race's blows taken, to count and to find where they came from)
  client.on('update_attributes', (p) => {
    if (rid === null || BigInt(p.runtime_entity_id) !== BigInt(rid)) return;
    for (const x of p.attributes ?? []) {
      const k = x.name.replace('minecraft:', '');
      if (k === 'health' && process.env.LAB_HURT_LOG && attrs.health !== undefined && x.current < attrs.health - 0.01) {
        const f = { x: pos.x, y: pos.y - EYE, z: pos.z };
        const near = [...entities.values()].filter((e) => e.type !== 'minecraft:item' && e.type !== 'minecraft:player' && Math.hypot(e.x - f.x, e.z - f.z) < 8 && Math.abs(e.y - f.y) < 4)
          .map((e) => ({ e, d: Math.hypot(e.x - f.x, e.z - f.z) })).sort((a, b) => a.d - b.d).slice(0, 4)
          .map(({ e, d }) => `${e.type.replace('minecraft:', '')}${e.lit ? '(lit)' : ''} ${d.toFixed(1)}${Math.abs(e.y - f.y) > 0.5 ? ` dy${(e.y - f.y).toFixed(1)}` : ''}`);
        say(`hurt ${attrs.health.toFixed(1)}->${x.current.toFixed(1)} at ${f.x.toFixed(1)} ${f.y.toFixed(1)} ${f.z.toFixed(1)} t=${tick}${fallV < -0.5 ? ' falling' : ''} near: ${near.join(', ') || 'nothing'}`);
      }
      attrs[k] = x.current;
    }
  });
  const recipes = []; // crafting_table recipes the server sent: { net, out:{id,count}, ings:[{name|tag, meta, count}] }
  const special = { smithing: [], multi: [], stonecutter: [] };
  client.on('crafting_data', (p) => {
    if (p.recipes) {   // older tables (<= 1.26.30): one list of {type, recipe}; shaped input as width x height (the same order flattened)
      const by = { shaped: 'shaped_recipes', shapeless: 'shapeless_recipes', shulker_box: 'shapeless_recipes', multi: 'multi_recipes', smithing_transform: 'smithing_transform_recipes', smithing_trim: 'smithing_trim_recipes' };
      p = { ...p };
      // ingredients were typed by how they name the item (int id, string id, tag...): turn them into the newer {type: valid, descriptor_type}
      const ing = (g) => !g || g.type === 'valid' || g.type === 'invalid' ? g
        : g.type === 'item_tag' ? { type: 'valid', descriptor_type: 'item_tag', tag: g.tag, count: g.count }
        : g.type === 'string_id_meta' || g.type === 'complex_alias' ? { type: 'valid', descriptor_type: 'name', name: g.name, metadata: g.metadata ?? 0, count: g.count }
        : g.type === 'int_id_meta' && g.network_id ? { type: 'valid', descriptor_type: 'name', name: itemNames.get(g.network_id), metadata: g.metadata, count: g.count } : { type: 'invalid' };
      const fix = (r) => ({ ...r, ...(Array.isArray(r.input) ? { input: r.input.flat().map(ing) } : r.input ? { input: ing(r.input) } : {}), ...Object.fromEntries(['template', 'base', 'addition'].filter((k) => r[k]).map((k) => [k, ing(r[k])])) });
      for (const { type, recipe } of p.recipes) if (by[type]) (p[by[type]] ??= []).push(fix(recipe));
    }
    for (const r of p.smithing_transform_recipes ?? []) special.smithing.push({ net: r.network_id, out: r.result, tpl: r.template, base: r.base, add: r.addition, id: r.recipe_id });
    for (const r of p.smithing_trim_recipes ?? []) special.smithing.push({ net: r.network_id, trim: true, tpl: r.template, base: r.input, add: r.addition, id: r.recipe_id });
    for (const r of p.multi_recipes ?? []) special.multi.push({ net: r.network_id, uuid: r.uuid });
    for (const r of [...(p.shaped_recipes ?? []), ...(p.shapeless_recipes ?? [])]) if (r.block === 'stonecutter' && r.output?.[0]) special.stonecutter.push({ net: r.network_id, out: r.output[0], input: r.input, id: r.recipe_id });
    for (const r of [...(p.shaped_recipes ?? []), ...(p.shapeless_recipes ?? [])]) if (r.block === 'cartography_table' && r.output?.[0]) (special.cartography ??= []).push({ net: r.network_id, out: r.output[0], input: r.input, id: r.recipe_id });
    for (const r of [...(p.shaped_recipes ?? []), ...(p.shapeless_recipes ?? [])]) {
      if (r.block !== 'crafting_table' || !r.output?.[0]) continue;
      const ings = new Map();
      for (const i of r.input ?? []) {
        if (i.type !== 'valid' || !['name', 'item_tag'].includes(i.descriptor_type)) continue;
        const k = i.descriptor_type === 'name' ? `n:${i.name}:${i.metadata}` : `t:${i.tag}`;
        const e = ings.get(k) ?? { name: i.name, tag: i.tag, meta: i.metadata, count: 0 };
        e.count += i.count || 1; ings.set(k, e);
      }
      recipes.push({ net: r.network_id, out: { id: r.output[0].network_id, count: r.output[0].count }, ings: [...ings.values()], raw: r.input, rawOut: r.output[0], id: r.recipe_id, shaped: r.width !== undefined, w: r.width, h: r.height });
    }
  });
  let enchantOptions = [], trade = null, signEditor = null;
  const creative = new Map();   // item network id -> creative inventory entry id
  client.on('creative_content', (p) => { for (const e of p.items ?? []) if (e.item?.network_id && !creative.has(e.item.network_id)) creative.set(e.item.network_id, e.entry_id); });
  client.on('open_sign', (p) => { signEditor = { pos: p.position, front: p.is_front }; say(`sign editor ${p.position.x},${p.position.y},${p.position.z} ${p.is_front ? 'front' : 'back'}`); });
  client.on('player_enchant_options', (p) => {
    enchantOptions = p.options ?? [];
    if (enchantOptions.length) say('enchant options: ' + enchantOptions.map((o, i) => `${i}:${o.name.trim()} level ${o.cost} (${[...(o.equip_enchants ?? []), ...(o.held_enchants ?? []), ...(o.self_enchants ?? [])].map((e) => e.id + '/' + e.level).join(',')})`).join(' | '));
  });
  const nbtv = (x) => (x && typeof x === 'object' && 'value' in x && 'type' in x ? nbtv(x.value) : Array.isArray(x) ? x.map(nbtv) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, nbtv(v)])) : x);
  client.on('update_trade', (p) => {
    const offers = nbtv(p.offers)?.Recipes ?? [];
    trade = { offers, window: p.window_id };
    box = { window: p.window_id, type: 'trading', slots: [] };   // the trade screen opens with update_trade, not container_open
    const it = (o) => (o && o.Name ? `${o.Count ?? 1} ${String(o.Name).replace('minecraft:', '')}` : null);
    say('trade offers: ' + offers.map((o, i) => `${i}: ${[it(o.buyA), it(o.buyB)].filter(Boolean).join(' + ')} -> ${it(o.sell)}${o.uses >= o.maxUses ? ' (sold out)' : ''}`).join(' | '));
  });
  let box = null; // open container { window, type, slots }
  const invWaiters = [];
  // a screen asked for: its container_open is the server's answer, lag ticks away (at 20x 5-40). One that comes after this client
  // gave up on it is shut at once (the client thought no screen was open while the server had one: the moves, hits and clicks
  // after it went nowhere - a crafting table marked "would not open" and left behind)
  let boxGaveUp = 0n;
  const boxWait = async (n = 20) => { boxGaveUp = 0n; const m = Math.max(n, Math.ceil(4 * lag) + 10); for (let k = 0; !box && k < m; k++) await ticks(1); if (!box) boxGaveUp = tick + 400n; return !!box; };
  client.on('container_open', (p) => {
    if (boxGaveUp && tick < boxGaveUp) { boxGaveUp = 0n; client.queue('container_close', { window_id: p.window_id, window_type: p.window_type, server: false }); say(`(a ${p.window_type} screen opened too late: shut)`); return; }
    box = { window: p.window_id, type: p.window_type, slots: [], pos: p.coordinates };
  });
  // a mount's inventory (horse, donkey, llama: saddle, armor, chest) opens with UpdateEquip, not ContainerOpen
  client.on('update_equipment', (p) => { box = { window: p.window_id, type: String(p.window_type), slots: [], entity: p.entity_id, size: p.size }; say(`container ${box.type}: the mount's inventory (${p.size} slots)`); });
  const crafterOff = new Map();   // "x,y,z" -> disabled grid slots bitmask (block entity data), the crafter screen greys them out
  const signs = new Map();   // "x,y,z" -> the sign's block entity as last seen: editing one side keeps the other side, colors and glow
  client.on('block_entity_data', (p) => {
    const k = `${p.position.x},${p.position.y},${p.position.z}`, v = p.nbt?.value;
    if (v?.disabled_slots?.value !== undefined) crafterOff.set(k, v.disabled_slots.value);
    if (v?.FrontText) signs.set(k, v);
  });
  client.on('container_close', () => { if (box) say('container closed'); box = null; });
  // what the server changes in the inventory by itself (picking up an item, a bucket filled ...): an old-style transaction to the client
  client.on('inventory_transaction', (p) => {
    const t = p.transaction; if (!t || t.transaction_type !== 'normal') return;
    for (const x of t.actions ?? []) {
      if (x.source_type !== 'container' || !x.new_item) continue;
      if (x.window_id === 0 || x.window_id === 'inventory') inv.slots[x.slot] = x.new_item;
      else if (x.window_id === 119 || x.window_id === 'offhand') inv.offhand[x.slot] = x.new_item;
      else if (x.window_id === 120 || x.window_id === 'armor') inv.armor[x.slot] = x.new_item;
    }
  });
  client.on('inventory_content', (p) => {
    if (p.window_id === 'inventory') { inv.slots = p.input; for (const f of invWaiters.splice(0)) f(); }
    else if (['armor', 'offhand', 'ui'].includes(p.window_id)) inv[p.window_id] = p.input;
    else if (p.container?.container_id === 'dynamic' && p.container.dynamic_container_id != null) bundles.set(p.container.dynamic_container_id, p.input);   // a bundle's contents
    else if (box && p.window_id === box.window) { const t = list(p.input); box.slots = p.input; if (t !== box.shown) say(`container ${box.type}: ${(box.shown = t)}`); }
  });
  const bundles = new Map();   // bundle_id -> contents (slot 0 = the top item, the one a click takes out)
  const bundleId = (it) => it?.extra?.nbt?.nbt?.value?.bundle_id?.value;
  let reqId = -1, movingItem = null;
  // item stack ids: a number (1.26.40+) or, in older tables, a variant {type: 'item_stack_net_id', id}; requests carry the number
  const netId = (x) => (x && typeof x === 'object' ? x.id : x);
  const stackReq = (actions, names = []) => { if (process.env.LAB_PKT) say('send item_stack_request ' + JSON.stringify(actions, (k, v) => (typeof v === 'bigint' ? String(v) : v))); client.queue('item_stack_request', { requests: [{ request_id: reqId, actions, custom_names: names, cause: -1 }] }); askedAt.set(reqId, tick); reqId -= 2; };
  // binary action codes (the legacy byte) for each request action
  const LEGACY = { take: 0, place: 1, swap: 2, drop: 3, destroy: 4, consume: 5, create: 6, lab_table_combine: 9, beacon_payment: 10, mine_block: 11, craft_recipe: 12, craft_recipe_auto: 13, craft_creative: 14, optional: 15, craft_grindstone_request: 16, craft_loom_request: 17, non_implemented: 18, results_deprecated: 19 };
  const slotInfo = (container, slot, item, dyn) => ({ slot_type: { container_id: container, dynamic_container_id: dyn }, slot, stack_id: netId(item?.stack_id) ?? 0 });
  // screens keep their slots in the player's "ui" window at fixed places (crafting 28-40, result 50)
  const UI_SLOTS = {
    anvil: [['anvil_input', 1], ['anvil_material', 2]], enchantment: [['enchanting_input', 14], ['enchanting_lapis', 15]],
    grindstone: [['grindstone_input', 16], ['grindstone_additional', 17]], stonecutter: [['stonecutter_input', 3]],
    loom: [['loom_input', 9], ['loom_dye', 10], ['loom_material', 11]], cartography: [['cartography_input', 12], ['cartography_additional', 13]],
    smithing_table: [['smithing_table_input', 51], ['smithing_table_material', 52], ['smithing_table_template', 53]],
    trading: [['trade2_ingredient1', 4], ['trade2_ingredient2', 5]], beacon: [['beacon_payment', 27]],
  };
  const BLOCK_SLOTS = {
    furnace: ['furnace_ingredient', 'furnace_fuel', 'furnace_output'], blast_furnace: ['blast_furnace_ingredient', 'furnace_fuel', 'furnace_output'],
    smoker: ['smoker_ingredient', 'furnace_fuel', 'furnace_output'], brewing_stand: ['brewing_input', 'brewing_result', 'brewing_result', 'brewing_result', 'brewing_fuel'],
  };
  // minecraft-data reads some ids as zigzag32 that are plain varints on the wire (enchant option ids): undo it
  const unzig = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);
  // a screen's craft: [craft action], then consume the inputs (container, ui slot, count), then take the result from
  // the created-output slot (50) into the first free inventory slot. names = anvil text.
  // a uuid as the protocol tables here write it (each 8-byte half in reverse byte order) from its usual form
  const uuidWire = (u) => { const h = u.replace(/-/g, '').toLowerCase(), rv = (x) => x.match(/../g).reverse().join(''), c = rv(h.slice(0, 16)) + rv(h.slice(16)); return `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20)}`; };
  async function finish(craft, consumes, outCount, names = []) {
    const free = inv.slots.findIndex((x, i) => i < 36 && !x?.network_id);
    const to = free >= 0 ? free : inv.slots.length < 36 ? inv.slots.length : -1;
    if (to < 0) return 'inventory full';
    const id = reqId, r = waitResponse(id);
    stackReq([...craft,
      ...consumes.map(([c, slot, n]) => ({ type_id: 'consume', legacy_type_id: 5, count: n, source: { slot_type: { container_id: c }, slot, stack_id: netId(inv.ui[slot]?.stack_id) ?? 0 } })),
      { type_id: 'place', legacy_type_id: 1, count: outCount, source: { slot_type: { container_id: 'creative_output' }, slot: 50, stack_id: id }, destination: slotInfo(to < 9 ? 'hotbar' : 'inventory', to, null) }], names);
    const st = await r;
    await sync();
    return st;
  }
  const ARMOR = { head: 0, chest: 1, legs: 2, feet: 3 };
  function slotRef(x) {
    if (/^\d+$/.test(x)) { const i = +x; return { c: i < 9 ? 'hotbar' : 'inventory', slot: i, item: inv.slots[i] }; }
    if (x in ARMOR) return { c: 'armor', slot: ARMOR[x], item: inv.armor[ARMOR[x]] };
    if (x === 'offhand') return { c: 'offhand', slot: 1, item: inv.offhand[0] };   // the offhand is slot 1 in stack requests (0 is refused)
    if (x === 'cursor') return { c: 'cursor', slot: 0, item: inv.ui[0] };
    const bm = /^bundle:(\d+)$/.exec(x);   // bundle:<slot of the bundle>: into it / its top item out
    if (bm) {
      const it = inv.slots[+bm[1]], id = bundleId(it);
      if (!/bundle/.test(itemNames.get(it?.network_id) ?? '')) throw new Error(`${x}: slot ${bm[1]} holds no bundle`);
      const list = bundles.get(id) ?? [], last = list.findLastIndex((s) => s?.network_id);
      const free = list.findIndex((s) => !s?.network_id);
      return { c: 'dynamic', dyn: id ?? 0, slot: Math.max(last, 0), item: list[last], list, free: free < 0 ? list.length : free };   // out: the last one put in
    }
    const m = /^box:(\d+)$/.exec(x);
    if (!m) throw new Error(`slot ${x}: use 0-35 | head chest legs feet | offhand | cursor | box:<n> | bundle:<n>`);
    if (!box) throw new Error(`${x}: nothing open (open x y z / interact)`);
    const i = +m[1], ui = UI_SLOTS[box.type];
    if (ui) { if (!ui[i]) throw new Error(`${box.type} has box:0..${ui.length - 1}`); return { c: ui[i][0], slot: ui[i][1], item: inv.ui[ui[i][1]] }; }
    const b = BLOCK_SLOTS[box.type];
    return { c: b ? b[i] ?? 'container' : 'container', slot: i, item: box.slots[i] };
  }
  // what sits in the crafting grid (ui slots 28-31: the 2x2, 32-40: a table's 3x3; the grid is the player's own, whichever screen) is
  // taken out into empty slots of the inventory, else dropped at the feet
  async function clearGrid() {
    const left = []; for (let i = 28; i <= 40; i++) if (inv.ui[i]?.network_id && inv.ui[i].count > 0) left.push(i);
    if (!left.length) return;
    const empty = [...Array(36).keys()].filter((i) => !inv.slots[i]?.network_id);
    const src = (i) => ({ slot_type: { container_id: 'crafting_input' }, slot: i, stack_id: netId(inv.ui[i].stack_id) ?? 0 });
    let st = 'none';
    if (empty.length >= left.length) { const r = waitResponse(reqId); stackReq(left.map((i, j) => ({ type_id: 'place', legacy_type_id: 1, count: inv.ui[i].count, source: src(i), destination: slotInfo(empty[j] < 9 ? 'hotbar' : 'inventory', empty[j], null) }))); st = await r; }
    if (st !== 'ok') { const r = waitResponse(reqId); stackReq(left.map((i) => ({ type_id: 'drop', legacy_type_id: 3, count: inv.ui[i].count, source: src(i), randomly: false }))); st = await r; }
    for (const i of left) inv.ui[i] = undefined;   // (refused both ways: the grid was empty already, what was known of it was old)
    if (st === 'ok') say(`craft: took ${left.length} stack(s) left in the crafting grid back out`);
    await sync();
  }
  const NET = ['ok', 'error', 'invalid action', 'not allowed', 'screen end failed', 'commit failed', 'invalid craft action', 'invalid craft request', 'invalid craft screen', 'invalid craft result'];
  const waiting = new Map();
  let lastResponse = null;
  const waitResponse = (id) => new Promise((res) => { waiting.set(id, res); setTimeout(() => { if (waiting.delete(id)) res('no response'); }, 6000); });
  client.on('item_stack_response', (p) => {
    for (const r of p.responses ?? []) {
      const t0 = askedAt.get(r.request_id); if (t0 !== undefined) { askedAt.delete(r.request_id); noteLag(Number(tick - t0)); }
      if (askedAt.size > 64) askedAt.clear();
      const st = r.status === 'ok' || r.status === 0 ? 'ok' : NET[r.status] ?? `status ${r.status}`;
      const w = waiting.get(r.request_id);
      lastResponse = r;
      // screen slots (anvil, beacon, ...) live in the ui window: the response is the only place their new stack ids appear
      if (st === 'ok') for (const c of r.containers ?? []) {
        if (['hotbar', 'inventory', 'hotbar_and_inventory', 'container', 'armor', 'offhand'].includes(c.slot_type?.container_id)) continue;
        for (const sl of c.slots ?? []) {
          if (!sl.count) { inv.ui[sl.slot] = undefined; continue; }
          const base = inv.ui[sl.slot]?.network_id ? inv.ui[sl.slot] : movingItem;
          if (base) inv.ui[sl.slot] = { ...base, count: sl.count, stack_id: sl.item_stack_id };
        }
      }
      if (w) { waiting.delete(r.request_id); w(st); } else if (st !== 'ok') say(`inventory action rejected (${st})`);
    }
  });
  client.on('inventory_slot', (p) => { if (process.env.LAB_DEBUG) say('dbg slot ' + p.window_id + ' ' + p.slot + ' ' + JSON.stringify(big(p.item)).slice(0, 150)); if (p.container?.container_id === 'dynamic' && p.container.dynamic_container_id != null) { const c = bundles.get(p.container.dynamic_container_id) ?? []; c[p.slot] = p.item; bundles.set(p.container.dynamic_container_id, c); } else if (p.window_id === 'inventory') inv.slots[p.slot] = p.item; else if (['armor', 'offhand', 'ui'].includes(p.window_id)) inv[p.window_id][p.slot] = p.item;
    else if (box && p.window_id === box.window && box.slots) { box.slots[p.slot] = p.item; const t = list(box.slots); if (t !== box.shown) say(`container ${box.type}: ${(box.shown = t)}`); } });   // an open screen's slot (a furnace's output as it cooks)
  const AIR = blockHash(req, 'minecraft:air');
  const at = (p, q) => ['x', 'y', 'z'].every((k) => p[k] === q[k]);
  // ---- the world as this client knows it: like a real client it asks for the sub-chunks around it (request mode) and reads them ----
  const tables = blockTables(req, version);
  let dim = 0;
  const DIM_MIN = { 0: -4, 1: 0, 2: 0 }, DIM_MAX = { 0: 19, 1: 7, 2: 15 };
  // sub-chunks by a numeric key (no string per lookup), the last one used remembered (neighbouring lookups mostly fall in the same
  // one), and each sub-chunk's palette turned into block objects once (blk): a block lookup is a few integer operations
  const subs = new Map(), loose = new Map();   // skey -> { pal, idx, blk }; "x,y,z" -> runtime id where no sub-chunk is known
  const skey = (cx, sy, cz) => ((cx + 2097152) * 4194304 + (cz + 2097152)) * 64 + (sy + 32);
  let lastKey = NaN, lastSub;
  const sub = (x, y, z) => { const k = skey(x >> 4, y >> 4, z >> 4); if (k !== lastKey) { lastKey = k; lastSub = subs.get(k); } return lastSub; };
  const unknownBlocks = new Map();
  const toBlock = (r) => { let b = tables.byHash.get(r); if (b) return b; b = unknownBlocks.get(r); if (!b) unknownBlocks.set(r, (b = { name: '?' + (r >>> 0).toString(16), states: {}, shape: [[0, 0, 0, 1, 1, 1]] })); return b; };
  const world = {
    rid(x, y, z) {
      const c = sub(x, y, z);
      if (c) return c.idx ? c.pal[c.idx[((x & 15) << 8) | ((z & 15) << 4) | (y & 15)]] : c.pal[0];
      return loose.size ? loose.get(`${x},${y},${z}`) : undefined;
    },
    set(x, y, z, r) {
      const c = sub(x, y, z);
      if (!c) { loose.set(`${x},${y},${z}`, r); return; }
      let k = c.pal.indexOf(r); if (k < 0) { k = c.pal.length; c.pal.push(r); }
      c.idx ??= new Uint16Array(4096);   // the first block set in the sky over a column
      c.idx[((x & 15) << 8) | ((z & 15) << 4) | (y & 15)] = k;
    },
    block(x, y, z) {
      const c = sub(x, y, z);
      if (c) { const p = c.idx ? c.idx[((x & 15) << 8) | ((z & 15) << 4) | (y & 15)] : 0; return c.blk[p] ?? (c.blk[p] = toBlock(c.pal[p])); }
      if (!loose.size) return null;
      const r = loose.get(`${x},${y},${z}`); return r === undefined ? null : toBlock(r);
    },
    store(cx, sy, cz, sc) {
      subs.set(skey(cx, sy, cz), { pal: [...sc.pal], idx: sc.idx, blk: [], cx, sy, cz }); lastKey = NaN;
      if (loose.size) for (const k of loose.keys()) { const [x, y, z] = k.split(',').map(Number); if (x >> 4 === cx && y >> 4 === sy && z >> 4 === cz) loose.delete(k); }
    },
    // a column whose sub-chunks have started to come in (its ground is known, wherever the player is: high in the air too)
    column(cx, cz) { return cols.get(`${cx},${cz}`)?.got === true; },
    // the layers above a column's highest sub-chunk are air (the server sends none of them): known air, no block data kept
    sky(cx, sy, cz) { const k = skey(cx, sy, cz); if (!subs.has(k)) { subs.set(k, { pal: [AIR], idx: null, blk: [], cx, sy, cz, sky: true }); lastKey = NaN; } },
    forget(cx, cz) { for (const [k, c] of subs) if (c.cx === cx && c.cz === cz) subs.delete(k); lastKey = NaN; },
    clear() { subs.clear(); loose.clear(); lastKey = NaN; },
    // the known blocks that pass test(block) ({ name, states }), nearest to `from` first: a sub-chunk's palette tells at once whether
    // one is in it, so only those sub-chunks are read (a whole view distance of chunks in a few ms)
    // where(x, y, z): a filter on the place itself, applied before the nearest `max` are kept (the known() of a player that only
    // counts what it could see passes "open to the air": the 96 nearest iron ores were all buried, and the ones on a cave wall a
    // little further off were never looked at)
    find(test, { max = 64, radius = 96, from, where = null } = {}) {
      const ok = new Map(), pass = (r) => { let v = ok.get(r); if (v === undefined) { const b = tables.byHash.get(r); v = !!b && !!test(b); ok.set(r, v); } return v; };
      const fx = Math.floor(from.x), fy = Math.floor(from.y), fz = Math.floor(from.z), r2 = radius * radius, cands = [];
      const gap = (v, lo) => (v < lo ? lo - v : v > lo + 15 ? v - lo - 15 : 0);
      for (const c of subs.values()) {
        if (c.cx === undefined || !c.idx) continue;   // (sky over a column: plain air, not what anyone searches for)
        const d2 = gap(fx, c.cx * 16) ** 2 + gap(fy, c.sy * 16) ** 2 + gap(fz, c.cz * 16) ** 2;
        if (d2 > r2) continue;
        const hit = []; for (let k = 0; k < c.pal.length; k++) if (pass(c.pal[k])) hit.push(k);
        if (hit.length) cands.push([d2, c, new Set(hit)]);
      }
      cands.sort((p, q) => p[0] - q[0]);
      const out = [];
      for (const [d2, c, hit] of cands) {
        if (out.length >= max && d2 > out[max - 1][3]) break;
        const bx = c.cx * 16, by = c.sy * 16, bz = c.cz * 16;
        for (let i = 0; i < 4096; i++) {
          if (!hit.has(c.idx[i])) continue;
          const x = bx + (i >> 8), z = bz + ((i >> 4) & 15), y = by + (i & 15), e2 = (x - fx) ** 2 + (y - fy) ** 2 + (z - fz) ** 2;
          if (e2 <= r2 && (!where || where(x, y, z))) out.push([x, y, z, e2]);
        }
        out.sort((p, q) => p[3] - q[3]); if (out.length > max) out.length = max;
      }
      for (const [k, r] of loose) if (pass(r)) { const [x, y, z] = k.split(',').map(Number), e2 = (x - fx) ** 2 + (y - fy) ** 2 + (z - fz) ** 2; if (e2 <= r2 && (!where || where(x, y, z))) out.push([x, y, z, e2]); }
      return out.sort((p, q) => p[3] - q[3]).slice(0, max).map(([x, y, z, e2]) => ({ x, y, z, d: Math.sqrt(e2), block: this.block(x, y, z) }));
    },
  };
  client.on('start_game', (p) => { dim = typeof p.dimension === 'string' ? ['overworld', 'nether', 'end'].indexOf(p.dimension) : p.dimension ?? 0; addCustomBlocks(tables, p.block_properties); });
  client.on('level_chunk', (p) => {
    world.forget(p.x, p.z); cols.delete(`${p.x},${p.z}`);
    if (p.dimension !== undefined && p.dimension !== dim) return;
    const lo = DIM_MIN[dim] ?? -4;
    if (p.highest_subchunk_count !== undefined && p.highest_subchunk_count !== null) {   // request mode: ask for this column's sub-chunks
      const n = p.highest_subchunk_count < 0 ? (DIM_MAX[dim] ?? 19) - lo + 1 : p.highest_subchunk_count;
      const col = { x: p.x, z: p.z, lo, n, asked: new Set() };
      cols.set(`${p.x},${p.z}`, col);
      if (p.highest_subchunk_count >= 0) for (let sy = lo + n; sy <= (DIM_MAX[dim] ?? 19); sy++) world.sky(p.x, sy, p.z);   // above the top: air
      askColumn(col);
      return;
    }
    cols.set(`${p.x},${p.z}`, { x: p.x, z: p.z, lo, n: 0, asked: new Set(), got: true });
    const buf = Buffer.from(p.payload ?? []);   // older servers: the sub-chunks come inside the chunk
    for (let k = 0, off = 0; k < (p.sub_chunk_count ?? 0); k++) { const sc = readSubChunk(buf, off); if (!sc) break; world.store(p.x, sc.y ?? lo + k, p.z, sc.layer0); off = sc.end; }
  });
  // LAB_SUBCHUNK_WINDOW=w: only the sub-chunks within w (16-block layers) above and below the player are asked for and decoded;
  // more come as it climbs or digs down (the rest of a column is sky or rock nobody looks at). 0 = all of them (a real client).
  // Default: 4 in a generated world (LAB_WORLD=normal: 24 layers a column), all in the flat one
  const WINDOW = process.env.LAB_SUBCHUNK_WINDOW === undefined ? (process.env.LAB_WORLD === 'normal' ? 4 : 0) : Number(process.env.LAB_SUBCHUNK_WINDOW);   // (a flat world is a few layers anyway)
  const cols = new Map();
  let winAt = null;
  const askColumn = (col) => {
    const lo = col.lo, hi = col.lo + col.n - 1, c = Math.floor((pos.y - EYE) / 16);
    const from = WINDOW > 0 ? Math.max(lo, c - WINDOW) : lo, to = WINDOW > 0 ? Math.min(hi, c + WINDOW) : hi, req = [];
    for (let sy = from; sy <= to; sy++) if (!col.asked.has(sy)) { col.asked.add(sy); req.push({ x: 0, y: sy - lo, z: 0 }); }
    if (req.length) client.queue('subchunk_request', { dimension: dim, origin: { x: col.x, y: lo, z: col.z }, requests: req });
  };
  const moveWindow = () => {   // the player moved to another layer: the columns around get the layers now in the window
    if (WINDOW <= 0) return;
    const c = Math.floor((pos.y - EYE) / 16);
    if (c === winAt) return;
    winAt = c;
    const px = pos.x / 16, pz = pos.z / 16;
    for (const [k, col] of cols) {
      const d = Math.max(Math.abs(col.x + 0.5 - px), Math.abs(col.z + 0.5 - pz));
      if (d > 24) cols.delete(k);   // long left behind
      else if (d <= 12) askColumn(col);
    }
  };
  client.on('subchunk', (p) => {
    if (p.dimension !== dim) return;
    const o = p.origin ?? {};
    for (const e of p.entries ?? []) {
      const cx = o.x + e.dx, sy = o.y + e.dy, cz = o.z + e.dz;
      const col = cols.get(`${cx},${cz}`); if (col && /^success/.test(e.result)) col.got = true;
      if (e.result === 'success_all_air') world.store(cx, sy, cz, { pal: [AIR], idx: new Uint16Array(4096) });
      else if (e.result === 'success' && e.payload) { const sc = readSubChunk(Buffer.from(e.payload)); if (sc?.layer0) world.store(cx, sc.y ?? sy, cz, sc.layer0); }
    }
  });
  // the crosshair: the first block (outline) or entity along the view, within reach (Bedrock: mouse/controller 5 blocks, entities 3
  // (5 in creative); touch 6 (12 in creative) for both). Fluids and air are looked through.
  const NOPICK = /^minecraft:(air|water|flowing_water|lava|flowing_lava|light_block.*|structure_void|bubble_column|fire|soul_fire)$/;
  const viewDir = () => { const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180; return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) }; };
  const reach = (what) => (inputMode === 'touch' ? (/creative/.test(myMode) ? 12 : 6) : what === 'entity' && !/creative/.test(myMode) ? 3 : 5);
  // ray against a box [x0,y0,z0,x1,y1,z1] (world coords): entry distance and face (0 down 1 up 2 north 3 south 4 west 5 east)
  const hitBox = (o, d, b) => {
    let t0 = -Infinity, t1 = Infinity, face = -1;
    for (const [a, lo, hi, fNeg, fPos] of [['x', b[0], b[3], 4, 5], ['y', b[1], b[4], 0, 1], ['z', b[2], b[5], 2, 3]]) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo || o[a] > hi) return null; continue; }
      let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a], f = d[a] > 0 ? fNeg : fPos;
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) { t0 = ta; face = f; }
      t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
    return t0 >= 0 ? { t: t0, face } : null;
  };
  const raycast = () => {
    const o = { x: pos.x, y: pos.y, z: pos.z }, d = viewDir(), max = reach('block');
    let best = null;
    // blocks: step through the cells along the ray (Amanatides & Woo)
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const st = { x: Math.sign(d.x), y: Math.sign(d.y), z: Math.sign(d.z) };
    const tMax = { x: d.x ? ((st.x > 0 ? x + 1 : x) - o.x) / d.x : Infinity, y: d.y ? ((st.y > 0 ? y + 1 : y) - o.y) / d.y : Infinity, z: d.z ? ((st.z > 0 ? z + 1 : z) - o.z) / d.z : Infinity };
    const tD = { x: d.x ? Math.abs(1 / d.x) : Infinity, y: d.y ? Math.abs(1 / d.y) : Infinity, z: d.z ? Math.abs(1 / d.z) : Infinity };
    for (let n = 0; n < 64 && !best; n++) {
      const b = world.block(x, y, z);
      if (b && !NOPICK.test(b.name)) {
        for (const s of b.shape?.length ? b.shape : [[0, 0, 0, 1, 1, 1]]) {
          const h = hitBox(o, d, [x + s[0], y + s[1], z + s[2], x + s[3], y + s[4], z + s[5]]);
          if (h && h.t <= max && (!best || h.t < best.t)) best = { kind: 'block', x, y, z, block: b, face: h.face, t: h.t };
        }
      }
      const a = tMax.x < tMax.y ? (tMax.x < tMax.z ? 'x' : 'z') : tMax.y < tMax.z ? 'y' : 'z';
      if (tMax[a] > max) break;
      if (a === 'x') x += st.x; else if (a === 'y') y += st.y; else z += st.z;
      tMax[a] += tD[a];
    }
    // entities: their boxes (players 0.6 x 1.8, others from minecraft-data, else 0.6 x 1)
    const emax = reach('entity');
    for (const e of entities.values()) {
      if (e.type === 'minecraft:item') continue;
      const sz = e.bw > 0 && e.bh > 0 ? { w: e.bw, h: e.bh } : e.type === 'minecraft:player' ? { w: 0.6, h: 1.8 } : ENT_SIZE(e.type);
      const h = hitBox(o, d, [e.x - sz.w / 2, e.y, e.z - sz.w / 2, e.x + sz.w / 2, e.y + sz.h, e.z + sz.w / 2]);
      if (h && h.t <= emax && (!best || h.t < best.t)) best = { kind: 'entity', entity: e, t: h.t };
    }
    if (best?.kind === 'block') best.at = ['x', 'y', 'z'].map((k) => Math.min(1, Math.max(0, o[k] + d[k] * best.t - best[k])));
    return best;
  };
  let entSizes = null;
  const ENT_SIZE = (type) => {
    if (!entSizes) { entSizes = new Map(); try { for (const e of require('node:module').createRequire(req.resolve('bedrock-protocol'))('minecraft-data')('bedrock_' + version).entitiesArray ?? []) entSizes.set('minecraft:' + e.name, { w: e.width ?? 0.6, h: e.height ?? 1 }); } catch { /* defaults */ } }
    return entSizes.get(type) ?? { w: 0.6, h: 1 };
  };
  const FACE_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'];
  // a block this client broke by its own count: the server's word on that spot settles it (air: done; the block again: refused)
  const settle = (q, rid) => {
    const k = `${q.x},${q.y},${q.z}`, u = unconfirmed.get(k);
    predicted.delete(k);
    if (!u) return;
    unconfirmed.delete(k);
    if (rid !== AIR) { digRefused++; if (process.env.LAB_DEBUG_DIG) say(`dbg dig refused by the server at ${k} (${Number(tick - u.tick)} ticks later)`); }
  };
  client.on('update_block', (p) => {
    if (p.layer === 0 || p.layer === undefined) { world.set(p.position.x, p.position.y, p.position.z, p.block_runtime_id | 0); settle(p.position, p.block_runtime_id | 0); }
    if (placeWatch && at(p.position, placeWatch.c)) say(`dbg place: ${p.position.x},${p.position.y},${p.position.z} is ${world.block(p.position.x, p.position.y, p.position.z)?.name} (layer ${p.layer}) ${Number(tick - placeWatch.tick)} ticks after the click`);
    if (process.env.LAB_DEBUG) say(`dbg update_block ${JSON.stringify(p.position)} ${p.block_runtime_id | 0} layer ${p.layer}`);
    if (digging && at(p.position, digging.pos) && (p.block_runtime_id | 0) === AIR) { digging.broken = true; if (process.env.LAB_DEBUG_DIG) say(`dbg dig broken at dig tick ${digging.ticks} phase ${digging.phase} (t=${tick})`); }
  });
  // big /fill and structure changes come as sub-chunk batches or whole chunks, not update_block: keep the map true
  client.on('update_subchunk_blocks', (p) => {
    for (const u of p.blocks ?? []) {
      world.set(u.position.x, u.position.y, u.position.z, u.runtime_id | 0); settle(u.position, u.runtime_id | 0);
      if (digging && at(u.position, digging.pos) && (u.runtime_id | 0) === AIR) digging.broken = true;
    }
  });
  // the server's word on a break: how fast it goes (65535 / ticks: at the first hit, and again after each continue_break or when the
  // speed changes - off the ground, under water). This client adds that speed up each tick like the server does
  client.on('level_event', (p) => {
    const d = digging;
    if (!d || !/^block_(start_break|break_speed)$/.test(String(p.event)) || !p.position || !(p.data > 0)) return;
    if (Math.floor(p.position.x) !== d.pos.x || Math.floor(p.position.y) !== d.pos.y || Math.floor(p.position.z) !== d.pos.z) return;
    const r = p.data / 65535;
    if (d.rate === undefined) {
      d.prog = r * (d.ticks - (d.asked ?? 1) + 1);   // (it counted from the hit: the last one, when the first went unanswered)
      digLag = digLag ? (digLag * 3 + d.ticks) / 4 : d.ticks; noteLag(d.ticks - 1);
      if (process.env.LAB_DEBUG_DIG) say(`dbg dig speed ${Math.ceil(1 / r)} ticks, told at dig tick ${d.ticks} (lag ~${digLag.toFixed(1)}, t=${tick})`);
    }
    if (d.rate !== undefined && Math.abs(r - d.rate) > 1e-9) d.rateChanged = true;   // (off the ground, into water: the count is a guess now)
    d.rate = r; d.need = Math.ceil(1 / r);
  });
  const flat = (r) => (r?.rawtext ?? []).map((x) => x.text ?? (x.translate ? '%' + x.translate + (x.with ? ` [${Array.isArray(x.with) ? x.with.join(', ') : flat(x.with)}]` : '') : x.score ? '%score' : x.selector ?? '')).join('');
  client.on('text', (p) => {
    let raw = String(p.message);
    if (/^json/.test(p.type)) { try { raw = flat(JSON.parse(raw)); } catch { /* keep raw */ } }
    raw = raw.replace(/§./g, '').trim();
    if (/multiplayer\.player\.(joined|left)|commands\.op\.message/.test(raw)) return;
    const params = (p.parameters ?? []).filter(Boolean);
    const msg = (p.needs_translation && !/^json/.test(p.type) && !raw.startsWith('%') ? '%' : '') + raw + (params.length ? ` [${params.join(', ')}]` : '');
    const kind = { chat: 'chat', whisper: 'whisper', tip: 'tip', popup: 'popup', jukebox_popup: 'popup', announcement: 'announce', json_announcement: 'announce' }[p.type];
    say(p.type === 'chat' || p.type === 'whisper' ? `${kind} <${String(p.source_name).replace(/§./g, '')}> ${raw}` : `${kind ? kind + ': ' : ''}${msg}`);
  });
  client.on('set_title', (p) => {
    const k = { set_title: 'title', set_title_json: 'title', set_subtitle: 'subtitle', set_subtitle_json: 'subtitle', action_bar_message: 'actionbar', action_bar_message_json: 'actionbar' }[p.type];
    if (k) say(`${k}: ${p.text}`);
  });
  // `watch on|off|<packet,...>`: print what the server sends this client (`@A saw <packet> {json}`), so a script's effect on the
  // player (sound, particle, camera, title, hud, fog, music, locks...) is checked on the receiving end, not only by the API.
  const NOISY = /^(move_entity|move_entity_delta|move_player|level_chunk|subchunk|network_chunk_publisher_update|tick_sync|set_time|network_stack_latency|biome_definition_list|player_list|update_attributes|set_entity_motion|creative_content|crafting_data|available_commands|item_registry|resource_pack.*|start_game|level_sound_event|animate|update_block|update_subchunk_blocks|current_structure_feature|server_post_move|player_auth_input|client_cache_miss_response|sync_entity_property|block_entity_data|camera_aim_assist_presets|camera_presets|unlocked_recipes|trim_data|feature_registry|jigsaw_structure_data|dimension_data|available_entity_identifiers|server_bound_loading_screen)$/;
  // SoundInstance updates: after the handle, BDS writes the same (kind byte + value) 7 times
  const POST = {
    play_sound: (p) => ({ ...p, coordinates: { x: p.coordinates.x / 8, y: p.coordinates.y / 8, z: p.coordinates.z / 8 } }),   // sent in 1/8 blocks
    clientbound_update_sound_data: (p) => {
      const b = Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data?.data ?? []);
      const k = b[0], f = (o) => Math.round(b.readFloatLE(o) * 100) / 100;
      const u = [() => ({ stop: true }), () => ({ volume: f(1) }), () => ({ pitch: f(1) }), () => ({ fade: { duration: f(1), target_volume: f(5) } }), () => ({ seek_to: f(1) }), () => ({ pause: true }), () => ({ resume: true })][k]?.() ?? { raw: b.toString('hex') };
      return { handle: String(BigInt.asUintN(64, BigInt(Array.isArray(p.server_sound_handle) ? (BigInt(p.server_sound_handle[0]) << 32n) | BigInt(p.server_sound_handle[1] >>> 0) : p.server_sound_handle))), ...u };
    },
  };
  watching = null;   // null = off, true = everything not NOISY, Set = those names (NOISY ones allowed when named)
  client.on('packet', (d) => {
    const n = d.data?.name;
    if (!watching || !ready || !n || (watching === true ? NOISY.test(n) : !watching.has(n))) return;
    let j = JSON.stringify((() => { try { return POST[n] ? POST[n](d.data.params) : d.data.params; } catch { return d.data.params; } })(), (k, v) => (typeof v === 'bigint' ? String(v) : v && typeof v === 'object' && !Array.isArray(v) && '_value' in v ? Object.keys(v).filter((x) => x !== '_value' && v[x] === true) : Array.isArray(v) && v.length === 2 && /handle|entity|unique/.test(k) && v.every(Number.isInteger) ? String(BigInt.asIntN(64, (BigInt(v[0]) << 32n) | BigInt(v[1] >>> 0))) : v?.type === 'Buffer' ? (v.data.length <= 80 ? Buffer.from(v.data).toString("hex") : `<${v.data.length}b>`) : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v));
    say(`saw ${n} ${j.length > (+process.env.LAB_WATCHMAX || 400) ? j.slice(0, 397) + '...' : j}`);
  });
  let npc = null;
  client.on('npc_dialogue', (p) => {
    // an empty "open" closes the dialogue that is up (after a button ran); with none up it answers our interact: the client builds the
    // screen from the NPC's own data (name, buttons in url_tag), or shows the editor to an operator in creative
    if (p.action_type === 'close' || (npc && !p.screen_name && !p.dialogue)) { if (npc) say('npc closed'); npc = null; return; }
    if (!p.screen_name && !p.dialogue) {
      const e = entities.get(String(p.entity_id)) ?? entities.get(uniq.get(String(p.entity_id)) ?? '') ?? [...entities.values()].find((x) => x.uid != null && BigInt.asUintN(64, BigInt(x.uid)) === BigInt.asUintN(64, BigInt(p.entity_id)));
      if (/creative/.test(myMode) && myPerm === 'operator') { npc = { id: p.entity_id, scene: '', buttons: [], editor: true }; return say(`npc editor "${e?.npcName ?? ''}"`); }
      let btns = []; try { btns = JSON.parse(e?.npcActions || '[]'); } catch { /* none */ }
      npc = { id: p.entity_id, scene: '', buttons: btns };
      return say(`npc ${e?.npcName ?? ''} "" scene= buttons=${JSON.stringify(btns.map((b) => b.button_name ?? ''))}`);
    }
    let btns = [];
    try { btns = JSON.parse(p.action_json || '[]'); } catch { /* none */ }
    npc = { id: p.entity_id, scene: p.screen_name, buttons: btns };
    say(`npc ${p.npc_name} "${String(p.dialogue).replace(/\n/g, ' ')}" scene=${p.screen_name} buttons=${JSON.stringify(btns.map((b) => b.button_name ?? b.text ?? '').filter((x, i, l) => x || l.slice(i).some(Boolean)))}`);
  });
  // the server moved this client's hand (Player.selectedSlotIndex): a real client follows
  client.on('mob_equipment', (p) => {
    if (rid !== null && BigInt(p.runtime_entity_id) === BigInt(rid)) { if (p.window_id === 'inventory' && p.selected_slot !== inv.selected) inv.selected = p.selected_slot; return; }
    // what another player or mob holds (in its hand for all to see: an axe coming for the shield, a bow being drawn)
    const e = entities.get(String(p.runtime_entity_id));
    if (e) { const n = (itemNames.get(p.item?.network_id) ?? '').replace(/^minecraft:/, ''); if (p.window_id === 'offhand') e.offhand = n; else e.held = n; }
  });
  client.on('update_client_input_locks', (p) => {
    const l = p.locks ?? {}, was = locks;
    locks = Object.fromEntries(Object.entries(l).filter(([k, v]) => k !== '_value' && v === true));
    if (locks.camera && !was.camera) camLock = { yaw, pitch };
    const on = Object.keys(locks);
    if (on.join() !== Object.keys(was).join()) say(on.length ? `input locked: ${on.join(' ')}` : 'input unlocked');
  });
  client.on('toast_request', (p) => say(`toast: ${p.title} | ${p.message}`));
  client.on('modal_form_request', (p) => {
    let j;
    try { j = JSON.parse(p.data); } catch { j = { type: '?' }; }
    const on = busy();
    if (on) { client.queue('modal_form_response', { form_id: p.form_id, has_response_data: false, has_cancel_reason: true, cancel_reason: 'busy' }); return say(`form busy (${on} open): ${describeForm(j)}`); }
    form = { id: p.form_id, j };
    say('form ' + describeForm(j));
  });
  // ---- data-driven UI (server-ui CustomForm / MessageBox): the client mirrors the server's data store and writes back paths ----
  const ds = new Map();   // property -> { name, value (plain), count, paths: Map(path -> count) }
  const plainDs = (v) => (!v ? null : v.type === 'map' ? Object.fromEntries((v.value ?? []).map((e) => [e.key, plainDs(e.value)])) : v.type === 'int64' ? Number(v.value) : v.type === 'none' ? null : v.value);
  const setPath = (obj, pth, val) => { const keys = pth.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean); let o = obj; for (const k of keys.slice(0, -1)) o = o[k] ??= {}; o[keys.at(-1)] = val; };
  let ddui = null, typing = false;
  // a real client refuses a new form while another screen is up (show() → UserBusy): forms, containers, NPC dialogue, the chat screen
  const busy = () => (form || ddui ? 'form' : box ? String(box.type) : npc ? 'npc' : typing ? 'chat' : '');
  const q = (x) => JSON.stringify(typeof x === 'string' ? x.replace(/§./g, '') : x?.rawtext ? x.rawtext.map((r) => r.text ?? '%' + r.translate).join('') : x ?? '');
  const ddElements = (v) => { const L = v?.layout ?? {}; const n = Number(L.length ?? Object.keys(L).filter((k) => /^\d+$/.test(k)).length); return Array.from({ length: n }, (_, i) => L[i] ?? {}); };
  const ddKind = (e) => Object.keys(e).find((k) => k.endsWith('_visible'))?.replace(/_visible$/, '') ?? '?';
  function describeDd(d) {
    const v = d.value ?? {};
    if (/message_box/.test(d.screen)) return `messagebox: title(${q(v.title)}) body(${q(v.body)}) button1(${q(v.button1?.label)}) button2(${q(v.button2?.label)})`;
    const parts = ddElements(v).map((e, i) => {
      const k = ddKind(e), vis = e.visible === false ? '!hidden' : '';
      if (k === 'button') return `${i}:button(${q(e.label)})${e.disabled ? '!disabled' : ''}${vis}`;
      if (k === 'toggle') return `${i}:toggle(${q(e.label)},${e.toggled})${vis}`;
      if (k === 'textfield') return `${i}:textField(${q(e.label)},${q(e.text)})${vis}`;
      if (k === 'slider') return `${i}:slider(${q(e.label)},${e.value},${e.minValue}..${e.maxValue})${vis}`;
      if (k === 'dropdown') return `${i}:dropdown(${q(e.label)},${e.value},[${Object.values(e.items ?? {}).filter((x) => x && typeof x === 'object').map((x) => q(x.label)).join(',')}])${vis}`;
      if (k === 'label' || k === 'header') return `${i}:${k}(${q(e.text)})${vis}`;
      return `${i}:${k}`;
    });
    return `custom: title(${q(v.title)}) ${parts.join(' ')}${v.closeButton?.visible ? ' closeButton' : ''}`;
  }
  const findDd = () => ddui && (ddui.prop = [...ds.keys()].filter((k) => k.startsWith(ddui.screen.replace(/^minecraft:/, '') + '_data')).sort((x, y) => (y.endsWith('_' + ddui.inst)) - (x.endsWith('_' + ddui.inst))).shift() ?? ddui.prop);
  client.on('clientbound_data_store', (p) => {
    for (const u of p.updates ?? []) {
      if (u.change_type === 'change') ds.set(u.property, { name: u.name, value: plainDs(u.new_value), count: u.update_count, paths: new Map() });
      else if (u.change_type === 'update') { const e = ds.get(u.property); if (e) { setPath(e.value, u.path, u.data); e.paths.set(u.path, u.path_update_count); if (ddui?.prop === u.property) say(`form set ${u.path}=${JSON.stringify(u.data)}`); } }
      else if (u.change_type === 'removal') for (const [k, e] of ds) if (e.name === u.name) ds.delete(k);
    }
  });
  client.on('clientbound_data_driven_ui_show_screen', (p) => {
    const on = busy();
    if (on) { client.queue('serverbound_data_driven_screen_closed', { form_id: p.form_id, close_reason: 'UserBusy' }); return say(`form busy (${on} open): ${p.screen_id.replace(/^minecraft:/, '')}`); }
    ddui = { screen: p.screen_id, form: p.form_id, inst: p.data_instance_id };
    setTimeout(() => { findDd(); const d = ds.get(ddui?.prop); if (d) say('form ' + describeDd({ ...d, screen: ddui.screen })); else say(`form ${ddui?.screen} (no data)`); }, 50);
  });
  client.on('clientbound_close_form', () => {   // uiManager.closeAllForms: every form screen closes
    if (ddui) client.queue('serverbound_data_driven_screen_closed', { form_id: ddui.form, close_reason: 'ProgrammaticCloseAll' });
    if (form) client.queue('modal_form_response', { form_id: form.id, has_response_data: false, has_cancel_reason: true, cancel_reason: 'closed' });
    if (form || ddui) say('form closed by the server');
    form = null; ddui = null;
  });
  client.on('clientbound_data_driven_ui_close_screen', (p) => {   // the client acknowledges like the game does (show() then resolves ServerClosed)
    if (!ddui || (p.form_id != null && p.form_id !== ddui.form)) return;
    client.queue('serverbound_data_driven_screen_closed', { form_id: ddui.form, close_reason: p.form_id != null ? 'ProgrammaticClose' : 'ProgrammaticCloseAll' });
    ddui = null; say('form closed by the server');
  });
  // write one path back like the client does after a click / edit
  const ddWrite = (pth, val) => {
    const d = ds.get(ddui.prop);
    const type = typeof val === 'boolean' ? 'bool' : typeof val === 'number' ? 'double' : 'string';
    const n = (d.paths.get(pth) ?? 0) + 1;
    d.paths.set(pth, n); setPath(d.value, pth, val);
    client.queue('serverbound_data_store', { name: d.name, property: ddui.prop, path: pth, data_type: type, data: val, update_count: d.count, path_update_count: n });
  };
  client.on('command_output', (p) => {
    const cb = pendingCmd.get(p.origin?.uuid);
    if (!cb) return;
    pendingCmd.delete(p.origin.uuid);
    cb(p);
  });
  let radius = null; client.on('chunk_radius_update', (p) => { radius = p.chunk_radius; });
  client.on('disconnect', (p) => say('disconnected: ' + (p.message ?? p.reason ?? '')));
  client.on('close', () => bot.emit('gone'));   // kicked or disconnected: the name can join again
  client.on('packet_violation_warning', (p) => emit(`E @${name} kicked: packet ${p.packet_id} ${p.violation_type}: ${String(p.reason).replace(/\s*\n\s*/g, ' | ').slice(0, 400)}`));

  if (process.env.LAB_DEBUG_JOIN) {   // the login step by step (ms since the client was made) and every stall of this process over 40 ms
    const P = require('node:perf_hooks').performance, t0 = P.now(), ms = () => Math.round(P.now() - t0);
    client.on('packet', (pk) => { if (!ready) say(`dbg join +${ms()} ${pk.data?.name}`); });
    NEXT.rak?.on('closed', (r) => say(`dbg join transport closed (${r}) at +${ms()}`));
    NEXT.rak?.on('dbg', (m) => { if (!ready) say(`dbg join ${m} at +${ms()}`); });
    client.on('close', () => say(`dbg join client closed at +${ms()}`));
    client.on('error', (e) => say(`dbg join error ${e.message} at +${ms()}`));
    let last = P.now();
    const iv = setInterval(() => { const now = P.now(); if (now - last > 50) say(`dbg join stall ${Math.round(now - last - 10)} ms at +${ms()}`); last = now; if (ready) clearInterval(iv); }, 10);
  }
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name} did not spawn`)), timeoutMs);
    client.once('spawn', () => { clearTimeout(t); resolve(); });
    client.once('close', () => { clearTimeout(t); reject(new Error(`${name} connection closed`)); });
  });
  client.queue('serverbound_loading_screen', { type: 1 });
  client.queue('serverbound_loading_screen', { type: 2 });
  ready = true;
  auto('emote_list', { player_id: rid, emote_pieces: ['4c8ae710-df2e-47cd-814d-cc7bf21a3d67', '42fde774-37d4-4422-b374-89ff13a6535a', '9a469a61-c83b-4ba9-b507-bdbe64430582', '17428c4c-3813-4ea1-b3a9-d6a32f83afca'] });
  say(`joined ${Math.floor(pos.x)} ${Math.floor(pos.y - EYE)} ${Math.floor(pos.z)}`);
  // hold slot 0 like a real client does after spawning (also makes the server resend a stale inventory)
  // ask for a fresh inventory (the server may not push items given before the client finished loading)
  const resync = () => client.queue('inventory_transaction', { transaction: { legacy: { legacy_request_id: 0 }, transaction_type: 'inventory_mismatch', actions: [] } });
  setTimeout(resync, 500);
  // resync and wait for the server's copy, so the held item we report is the one the server has (else it refuses the use)
  const sync = () => new Promise((res) => { invWaiters.push(res); resync(); setTimeout(res, Number(process.env.LAB_SYNC_MS) || 500); });   // (LAB_SYNC_MS: a slow server under Wine)

  // the client obeys input locks from the server (Player.inputPermissions) like a real one: locked input is not sent
  const effective = () => {
    const c = { ...controls };
    if (locks.movement) c.forward = c.back = c.left = c.right = c.jump = c.sneak = c.sprint = false;
    if (locks.lateral_movement) c.left = c.right = false;
    for (const [k, d] of [['move_forward', 'forward'], ['move_backward', 'back'], ['move_left', 'left'], ['move_right', 'right'], ['jump', 'jump'], ['sneak', 'sneak']]) if (locks[k]) c[d] = false;
    return c;
  };
  // a block in the way at the feet with room above: what auto-jump (and a human pressing space) climbs; slabs/carpets are stepped up
  const topOf = (x, y, z) => { const b = world.block(x, y, z); return b?.shape?.length ? Math.max(...b.shape.map((q) => q[4])) : 0; };
  const stepAhead = (dx, dz) => {
    const f = { x: pos.x, y: pos.y - EYE, z: pos.z }, fy = Math.floor(f.y + 0.01);
    const ax = Math.floor(f.x + dx * 0.7), az = Math.floor(f.z + dz * 0.7);
    return topOf(ax, fy, az) > 0.6 && topOf(ax, fy + 1, az) === 0 && topOf(ax, fy + 2, az) === 0 && topOf(Math.floor(f.x), fy + 2, Math.floor(f.z)) === 0;
  };
  // A* over the known blocks: stand = two free cells over a floor; up 1 (room to jump), down up to 3, diagonals without cutting corners
  const AVOID = /lava|fire|cactus|sweet_berry|powder_snow|magma|wither_rose/;
  const free = (x, y, z) => { const b = world.block(x, y, z); return !!b && !b.shape?.length && !AVOID.test(b.name); };
  const floorAt = (x, y, z) => { const b = world.block(x, y, z); return !!b && b.shape?.length > 0 && !AVOID.test(b.name); };
  const stand = (x, y, z) => free(x, y, z) && free(x, y + 1, z) && floorAt(x, y - 1, z);
  const pathTo = (tx, tz) => {
    const f = { x: pos.x, y: pos.y - EYE, z: pos.z }, sx = Math.floor(f.x), sy = Math.floor(f.y + 0.01), sz = Math.floor(f.z), gx = Math.floor(tx), gz = Math.floor(tz);
    if (!stand(sx, sy, sz) || Math.hypot(gx - sx, gz - sz) > 64) return null;
    const K = (x, y, z) => `${x},${y},${z}`, g = new Map([[K(sx, sy, sz), 0]]), prev = new Map(), open = [[Math.hypot(gx - sx, gz - sz), sx, sy, sz]];
    let end = null;
    for (let n = 0; open.length && n < 6000; n++) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, x, y, z] = open.splice(bi, 1)[0];
      if (x === gx && z === gz) { end = K(x, y, z); break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (dx && dz && !(free(x + dx, y, z) && free(x + dx, y + 1, z) && free(x, y, z + dz) && free(x, y + 1, z + dz))) continue;
        for (const dy of [0, 1, -1, -2, -3]) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (!stand(nx, ny, nz) || (dy === 1 && !free(x, y + 2, z)) || (dy < 0 && !(free(nx, y, nz) && free(nx, y + 1, nz)))) continue;
          const c = g.get(K(x, y, z)) + (dx && dz ? 1.414 : 1) + (dy === 1 ? 0.5 : 0), k = K(nx, ny, nz);
          if (c < (g.get(k) ?? Infinity)) { g.set(k, c); prev.set(k, K(x, y, z)); open.push([c + Math.hypot(gx - nx, gz - nz), nx, ny, nz]); }
          break;
        }
      }
    }
    if (!end) return null;
    const path = []; for (let k = end; k; k = prev.get(k)) path.unshift(k.split(',').map(Number));
    return path;
  };
  let lastPos = null, hover = null, rowTime = 0;
  const mapsAsked = new Set();
  let autojump = inputMode === 'touch', lastJump = -100n, autoJumping = 0;   // the game's Auto Jump option (on for touch by default)
  const flags = (c = effective()) => {
    const f = [];
    if (autoJumping > 0) { autoJumping--; f.push('jump_down', 'jumping', 'want_up'); if (autoJumping === 1) f.push('start_jumping'); }
    if (stick && !locks.movement) { c = { ...c, forward: stick.z > 0, back: stick.z < 0, left: stick.x > 0, right: stick.x < 0 }; }
    if (c.forward && c.left) f.push('up_left'); else if (c.forward && c.right) f.push('up_right');
    if (c.back && c.left) f.push('down_left'); else if (c.back && c.right) f.push('down_right');
    if (c.forward) f.push('up'); if (c.back) f.push('down'); if (c.left) f.push('left'); if (c.right) f.push('right');
    if (c.jump) { f.push('jump_down', 'jump_current_raw', 'want_up', 'start_jumping', 'jumping'); if (!held.jump) f.push('jump_pressed_raw'); } else if (held.jump) f.push('jump_released_raw');
    if (c.sprint) { f.push('sprint_down', 'sprinting'); if (!held.sprint) f.push('start_sprinting'); } else if (held.sprint) f.push('stop_sprinting');
    if (c.sneak) { f.push('sneak_down', 'sneaking', 'sneak_current_raw', 'want_down'); if (!held.sneak) f.push('start_sneaking', 'sneak_pressed_raw'); } else if (held.sneak) f.push('stop_sneaking', 'sneak_released_raw');
    if (teleportAck) { f.push('handled_teleport'); teleportAck = false; }
    if (blockActions.length) f.push('block_action');
    if (using) f.push('start_using_item');
    if (vpos) { f.push('client_predicted_vehicle'); if (c.forward || c.back || c.left) f.push('paddling_right'); if (c.forward || c.back || c.right) f.push('paddling_left'); }   // rowing: both oars (forward or back), one oar turns
    f.push(...pulse, ...holdFlags); pulse.clear();
    held = { jump: c.jump, sneak: c.sneak, sprint: c.sprint };
    return [...new Set(f)];
  };
  // older protocols (minecraft-data <= 1.26.30) carry the input flags as a bitset of names, newer ones as a list: send what this version reads
  // older tables (<= 1.26.30) describe a craft's result as the recipe's own output item (ItemLegacy), newer ones by name
  let resultsLegacy = false;
  try { resultsLegacy = /"result_items","type":\["array",\{"countType":"varint","type":"ItemLegacy"\}\]/.test(JSON.stringify(require('node:module').createRequire(req.resolve('bedrock-protocol'))('minecraft-data')('bedrock_' + version).protocol.types.ItemStackRequest)); } catch { /* newer */ }
  let flagsAsSet = false;
  try { const tt = require('node:module').createRequire(req.resolve('bedrock-protocol'))('minecraft-data')('bedrock_' + version).protocol.types; flagsAsSet = tt.packet_player_auth_input[1].find((x) => x.name === 'input_data')?.type === 'InputFlag' && tt.InputFlag?.[0] === 'bitflags'; } catch { /* list */ }
  const inputData = (list) => (flagsAsSet ? Object.fromEntries(list.map((n) => [n, true])) : list);
  // one game tick = 50 ms like a real client; LAB_TICK_MS makes offline tests (fake server) run the same sequences faster
  // (fractional for a sped-up server: LAB_SPEED=3 gives 16.67 ms)
  const TICK_MS = Math.max(0.5, Number(process.env.LAB_TICK_MS) || 50);
  const BOATSIM = process.env.LAB_BOATSIM !== '0', WALKSIM_OFF = process.env.LAB_WALKSIM === '0';
  // gravity, predicted like a real client: the server corrects a position that drifts from its own only every few ticks (6 while
  // falling), so without this a fall was seen in jumps of several blocks (a water-bucket clutch poured after landing). Each tick:
  // move by the speed, then speed = (speed - 0.08) * 0.98; stop on the highest collision top under the 0.6-wide footprint, and
  // under a ceiling. Left to the server: water, lava and climbable or sticky cells, levitation, slow falling, gliding, flying,
  // riding, spectators, and cells not loaded (a guess there would drop the player through the unknown)
  const NOFALL = /water|lava|ladder|vine|scaffolding|web|powder_snow|bubble_column|kelp|seagrass|honey_block|slime|sweet_berry/;
  const solidTop = (b, cy) => (!b.shape ? (/air|light_block|structure_void/.test(b.name) ? null : cy + 1) : b.shape.length ? cy + Math.max(...b.shape.map((q) => q[4])) : null);
  // walking, sprinting and jumping, predicted like a real client: the server corrects a walking player only every 6 ticks, and a
  // path followed by a position up to 6 ticks old overshot every turn and zig-zagged back (a third of the speed, and a zombie
  // caught up). Each tick on land: the speed gains the keys' push (walking 0.1 a tick, sprinting x1.3, speed/slowness effects, the
  // ground's grip: ice slides, 0.02 in the air), the move stops at walls and climbs a step up to 0.5625 (a slab, a path block), then
  // the speed shrinks by the grip (0.546 on usual ground, 0.91 in the air). A jump: 0.42 up, and 0.2 ahead when sprinting.
  // Swimming, climbing, cobwebs and the like are left to the server. LAB_WALKSIM=0: none of it (the server's word only)
  const NOWALK = /water|lava|ladder|vine|scaffolding|web|powder_snow|bubble_column|kelp|seagrass|cave_vines|honey_block|soul_sand|sweet_berry/;
  const SLIP = (n) => (/blue_ice/.test(n) ? 0.989 : /ice/.test(n) ? 0.98 : /slime/.test(n) ? 0.8 : 0.6);
  const boxesOf = (b) => (!b.shape ? (/air|light_block|structure_void/.test(b.name) ? [] : [[0, 0, 0, 1, 1, 1]]) : b.shape);
  // the highest top of a collision box inside this box (null: free; Infinity: land not loaded, a wall)
  const boxHit = (x0, y0, z0, x1, y1, z1) => {
    let top = null;
    for (let cx = Math.floor(x0); cx <= Math.floor(x1 - 1e-7); cx++) for (let cy = Math.floor(y0); cy <= Math.floor(y1 - 1e-7); cy++) for (let cz = Math.floor(z0); cz <= Math.floor(z1 - 1e-7); cz++) {
      const b = world.block(cx, cy, cz); if (!b) return Infinity;
      for (const q of boxesOf(b)) if (cx + q[0] < x1 - 1e-7 && cx + q[3] > x0 + 1e-7 && cy + q[1] < y1 - 1e-7 && cy + q[4] > y0 + 1e-7 && cz + q[2] < z1 - 1e-7 && cz + q[5] > z0 + 1e-7) top = Math.max(top ?? -Infinity, cy + q[4]);
    }
    return top;
  };
  const walkStep = (ec, mv, rad) => {
    const f = pos.y - EYE;
    for (const dy of [0, 1]) { const b = world.block(Math.floor(pos.x), Math.floor(f + dy), Math.floor(pos.z)); if (!b || NOWALK.test(b.name)) { hvel = { x: 0, z: 0 }; return; } }
    const sup = boxHit(pos.x - 0.3, f - 0.06, pos.z - 0.3, pos.x + 0.3, f, pos.z + 0.3), ground = fallV === 0 && sup !== null && sup !== Infinity && sup >= f - 0.06;
    const under = world.block(Math.floor(pos.x), Math.floor(f - 0.06), Math.floor(pos.z));
    const food = attrs['player.hunger'] ?? 20, moving = mv.x || mv.z, len = Math.max(1, Math.hypot(mv.x, mv.z));
    const sprint = ec.sprint && mv.z > 0 && food > 6;
    // (the keys' input is 0.98 of a full push, as in the game: measured, sprinting settles at 0.153 a tick after the grip)
    const ix = moving ? ((-Math.sin(rad) * mv.z + Math.cos(rad) * mv.x) / len) * 0.98 : 0, iz = moving ? ((Math.cos(rad) * mv.z + Math.sin(rad) * mv.x) / len) * 0.98 : 0;
    let speed = 0.1 * (sprint ? 1.3 : 1);
    const sp = effects.get('speed'), sl = effects.get('slowness');
    if (sp && sp.until > tick) speed *= 1 + 0.2 * ((Number(sp.amp) || 0) + 1);
    if (sl && sl.until > tick) speed *= Math.max(0, 1 - 0.15 * ((Number(sl.amp) || 0) + 1));
    const fr = ground ? SLIP(under?.name ?? '') * 0.91 : 0.91, acc = ground ? speed * (0.16277136 / (fr * fr * fr)) : sprint ? 0.026 : 0.02;
    hvel = { x: hvel.x + ix * acc, z: hvel.z + iz * acc };
    if ((ec.jump || autoJumping > 0) && ground) {
      const jb = effects.get('jump_boost');
      if (boxHit(pos.x - 0.3, f + 1.8, pos.z - 0.3, pos.x + 0.3, f + 2.25, pos.z + 0.3) === null) { fallV = 0.42 + (jb && jb.until > tick ? 0.1 * ((Number(jb.amp) || 0) + 1) : 0); if (sprint) hvel = { x: hvel.x - Math.sin(rad) * 0.2, z: hvel.z + Math.cos(rad) * 0.2 }; }
    }
    let nx = pos.x + hvel.x, nz = pos.z, fy = f;
    const blocked = (x, y, z) => boxHit(x - 0.3, y, z - 0.3, x + 0.3, y + 1.8, z + 0.3);
    for (const axis of ['x', 'z']) {
      if (axis === 'z') nz = pos.z + hvel.z;
      const t = blocked(nx, fy, nz);
      if (t === null) continue;
      if (ground && t !== Infinity && t - fy <= 0.5625 && blocked(nx, t, nz) === null) { fy = t; continue; }   // a step up
      if (axis === 'x') { nx = pos.x; hvel = { ...hvel, x: 0 }; } else { nz = pos.z; hvel = { ...hvel, z: 0 }; }
    }
    pos = { x: nx, y: fy + EYE, z: nz };
    hvel = { x: hvel.x * fr, z: hvel.z * fr };
    if (Math.abs(hvel.x) < 0.003) hvel.x = 0;
    if (Math.abs(hvel.z) < 0.003) hvel.z = 0;
  };
  const fall = () => {
    if (dead || vehicle !== null || flying || gliding || /spectator/.test(myMode)) { fallV = 0; return; }
    for (const e of ['levitation', 'slow_falling']) { const x = effects.get(e); if (x && x.until > tick) { fallV = 0; return; } }
    const f = pos.y - EYE, corners = [[-0.299, -0.299], [0.299, -0.299], [-0.299, 0.299], [0.299, 0.299]].map(([dx, dz]) => [Math.floor(pos.x + dx), Math.floor(pos.z + dz)]);
    for (const cy of [Math.floor(f), Math.floor(f + 1), Math.floor(f - 0.05)]) { const b = world.block(Math.floor(pos.x), cy, Math.floor(pos.z)); if (!b || NOFALL.test(b.name)) { fallV = 0; return; } }
    // feet inside a block (a seat set a little low, a position not yet corrected): standing, as the game pushes it out; never down through it
    { const b = world.block(Math.floor(pos.x), Math.floor(f), Math.floor(pos.z)), t = b && solidTop(b, Math.floor(f)); if (t !== null && t !== undefined && t > f + 0.02) { fallV = 0; return; } }
    if (fallV > 0) {   // going up (a jump the server started): stop under a ceiling
      for (const [cx, cz] of corners) { const b = world.block(cx, Math.floor(f + 1.8 + fallV), cz); if (!b || (b.shape?.length ?? 1)) { fallV = 0; return; } }
      pos = { ...pos, y: pos.y + fallV }; fallV = (fallV - 0.08) * 0.98; return;
    }
    // down: the highest top between here and where this tick's speed ends (a fence reaches 1.5 up from the cell below)
    const lo = f + fallV - 0.03; let top = null;
    for (const [cx, cz] of corners) for (let cy = Math.floor(f + 0.02); cy >= Math.floor(lo) - 1; cy--) {
      const b = world.block(cx, cy, cz); if (!b) { fallV = 0; return; }
      const t = solidTop(b, cy); if (t !== null && t <= f + 0.02 && t >= lo && (top === null || t > top)) top = t;
    }
    if (top !== null) { if (top < f - 0.001) pos = { ...pos, y: top + EYE }; fallV = 0; return; }
    pos = { ...pos, y: pos.y + fallV }; fallV = (fallV - 0.08) * 0.98;
    if (fallV < -3.92) fallV = -3.92;
  };
  const paced = () => !!globalThis.__labSrvClock && !process.env.LAB_TICK_FIXED;   // (this client ticks with the server's own clock)
  let jumpOff = 0n;   // a tap of the jump key: let go this tick
  // reflexes run inside the tick itself (K.everyTick): a busy client catches up many ticks at once, and a loop that waits a tick
  // at a time sees none of them - a sped-up bridge walked 23 ticks blind off its end
  const tickFns = new Set();
  const tickOnce = () => {
    if (changing) return;
    tick++;
    for (const fn of tickFns) { try { fn(tick); } catch (e) { tickFns.delete(fn); say(`tick reflex error: ${e.message}`); } }
    if (jumpOff && tick >= jumpOff) { controls.jump = false; jumpOff = 0n; }
    if (tick % 10n === 0n) moveWindow();
    if (digging) {
      const d = digging, p = { ...d.pos };
      d.ticks++;
      if (d.t0 === undefined) d.t0 = Date.now();   // (without the server's clock the waits below also hold in real time)
      if (d.rate !== undefined && d.phase === 'go') d.prog += d.rate;
      if (d.phase !== 'confirm' && d.ticks % 2 === 1) swingArm('mine');   // the held button keeps swinging (Mine); BDS starts a new swing at most every 4 ticks
      // how long an answer may take: four times the usual lag, at least a second and a half (a busy server, a sped-up one: its
      // network keeps real time, so an answer is more ticks away; at 20x one came 44 ticks late while the usual was 11)
      const patience = digLag ? Math.max(30, Math.ceil(4 * digLag)) : 80;   // (the first dig of a run: the server is at its busiest)
      if (d.phase === 'start') { blockActions.push({ action: 'start_break', position: p, face: d.face }); d.phase = 'go'; d.asked = d.ticks; d.ta = Date.now(); if (fallV !== 0) d.rateChanged = true; }
      else if (d.phase === 'go') {
        // the server counts the break itself and breaks the block when its count is done (it said how fast: level_event above);
        // this client says it broke (predict_break) when its own count of the same speed is done, as a real client does - never
        // before the server told the speed: a guess of "instant" was refused (at 20x the answer comes 6-13 ticks after the hit)
        // the server may break it by itself (instant break): end the break there, or it keeps "breaking" that spot
        if (d.broken && !d.hold) { blockActions.push({ action: 'abort_break', position: p, face: d.face }); digging = null; d.done(true); }
        else if (d.hold) blockActions.push({ action: 'continue_break', position: p, face: d.face });
        else if (d.stopAt && d.ticks >= d.stopAt) {
          blockActions.push({ action: 'abort_break', position: p, face: d.face });
          digging = null; d.done(false);
        } else if (d.rate !== undefined && d.prog >= 1 + d.rate) {
          blockActions.push({ action: 'predict_break', position: p, face: d.face }, { action: 'stop_break', position: { x: 0, y: 0, z: 0 }, face: 0 });
          if (process.env.LAB_DEBUG_DIG) say(`dbg dig predict at dig tick ${d.ticks} need ${d.need} (t=${tick}, lag ~${digLag.toFixed(1)})`);
          // far from the server (6+ ticks away: a sped-up one), gone at once like a real client (its game time is not spent
          // waiting for the answer); the answer comes later: the block again = refused (it is put back after a while without one)
          // (one at a time: while the last one's answer is still out, this one waits for its own - a block refused under the feet
          // and the next one dug on top of that belief left the map with a hole the server did not have)
          // (and only a plain one: standing on the ground all the way, the speed never changed - a player still falling from the
          // block before counted at the ground's speed while the server counted at the air's, and the block was refused)
          if (digLag >= 6 && !process.env.LAB_DIG_CONFIRM && unconfirmed.size === 0 && !d.rateChanged && fallV === 0) {
            // (and the button let go of that spot: else the server went on breaking there - each gravel that fell into it, one
            // after another, the column coming down on the player's head)
            blockActions.push({ action: 'abort_break', position: p, face: d.face });
            const r = world.rid(p.x, p.y, p.z);
            unconfirmed.set(`${p.x},${p.y},${p.z}`, { tick, rid: r, pos: p });
            world.set(p.x, p.y, p.z, AIR);
            digging = null; d.done(true);
          } else { d.phase = 'confirm'; d.wait = 0; d.tc = Date.now(); }
        } else if (d.rate === undefined && d.ticks - (d.asked ?? 0) > patience + 10 && (paced() || Date.now() - (d.ta ?? d.t0) > 1500)) {
          // no word at all: once more, like a person who clicks again when nothing happens (the server let a hit pass right
          // after a crafting screen closed); then let go (a block that does not break, one out of reach)
          if (process.env.LAB_DEBUG_DIG) say(`dbg dig no answer in ${d.ticks - (d.asked ?? 0)} ticks (t=${tick}) at ${p.x},${p.y},${p.z} ${world.block(p.x, p.y, p.z)?.name} face ${d.face} from eye ${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)} dist ${Math.hypot(p.x + 0.5 - pos.x, p.y + 0.5 - pos.y, p.z + 0.5 - pos.z).toFixed(2)} yaw ${yaw.toFixed(0)} pitch ${pitch.toFixed(0)} fallV ${fallV.toFixed(2)}${d.again ? '' : ': again'}`);
          blockActions.push({ action: 'abort_break', position: p, face: d.face });
          if (!d.again) { d.again = true; lookAt({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 }); d.face = faceToward(p); d.phase = 'start'; }
          else { digging = null; d.done(false); }
        } else blockActions.push({ action: 'continue_break', position: p, face: d.face });
      } else if (d.broken || (++d.wait > patience && (paced() || Date.now() - d.tc > 800)) || d.ticks > d.max * 4) {
        if (process.env.LAB_DEBUG_DIG && !d.broken) say(`dbg dig gave up after ${d.wait} ticks of waiting (t=${tick})`);
        // end the break either way (a real client lifts the button); without it the server keeps breaking this spot
        blockActions.push({ action: 'abort_break', position: p, face: d.face });
        digging = null; d.done(d.broken);
      }
    }
    // a block broken by this client's count with no word from the server long after: it is still there (put it back in the map)
    if (unconfirmed.size && tick % 5n === 0n) for (const [k, u] of unconfirmed) if (Number(tick - u.tick) > Math.max(40, 4 * digLag)) {
      unconfirmed.delete(k);
      if (world.rid(u.pos.x, u.pos.y, u.pos.z) === AIR && u.rid !== undefined) { world.set(u.pos.x, u.pos.y, u.pos.z, u.rid); digRefused++; if (process.env.LAB_DEBUG_DIG) say(`dbg dig no word on ${k}: put back`); }
    }
    if (predicted.size && tick % 5n === 0n) for (const [k, u] of predicted) if (Number(tick - u.tick) > Math.max(40, 4 * digLag)) {
      predicted.delete(k);
      if (u.rid !== undefined) world.set(u.pos.x, u.pos.y, u.pos.z, u.rid);
      if (process.env.LAB_DEBUG_PLACE) say(`dbg place: no word on ${k}: taken away again`);
    }
    if (heldUseOn && tick - heldUseOn.last >= 4n) {
      const u = heldUseOn; u.last = tick;
      if (u.crosshair) { const h = raycast(); if (h?.kind === 'block') Object.assign(u, { b: { x: h.x, y: h.y, z: h.z }, face: h.face, cp: { x: h.at[0], y: h.at[1], z: h.at[2] } }); }
      const r = world.rid(u.b.x, u.b.y, u.b.z);
      useTx({ action_type: 'click_block', trigger_type: 'simulation_tick', block_position: u.b, face: u.face, click_pos: u.cp, block_runtime_id: r === undefined ? 0 : r >>> 0 });   // a repeat, not a new press
    }
    if (process.env.LAB_PKT && blockActions.length) say('send ' + blockActions.map((b) => b.action + '@' + b.position.x + ',' + b.position.y + ',' + b.position.z).join(' '));
    // what the crosshair rests on: a real client tells the server each time the hovered entity changes (Interact MouseOverEntity)
    if (tick % 2n === 0n && entities.size) {
      let h = null; try { h = raycast(); } catch { /* world not loaded yet */ }
      const id = h?.kind === 'entity' ? String(h.entity.id) : null;
      if (id !== hover) {
        hover = id;
        if (id) { const d = viewDir(), at = { x: F(pos.x + d.x * h.t), y: F(pos.y + d.y * h.t), z: F(pos.z + d.z * h.t) }; auto('interact', { action_id: 'mouse_over_entity', target_entity_id: h.entity.id, has_position: true, position: at }); }
      }
    }
    // held filled map: ask for its picture once (MapInfoRequest), as the client does when a map comes into hand
    if (tick % 10n === 0n) {
      const it = inv.slots[inv.selected], mid = it?.extra?.nbt?.nbt?.value?.map_uuid?.value;
      if (mid !== undefined && /filled_map/.test(itemNames.get(it.network_id) ?? '') && !mapsAsked.has(String(mid))) { mapsAsked.add(String(mid)); auto('map_info_request', { map_id: BigInt(mid), client_pixels: [] }); }
    }
    const ec = effective();
    // rowing: the oar animation others see (Animate RowRight/RowLeft with the stroke time), next to the paddling input flags
    if (vpos && tick % 2n === 0n && (ec.forward || ec.left || ec.right)) {
      rowTime += 0.1;
      if (ec.forward || ec.left) auto('animate', { action_id: 'row_right', runtime_entity_id: rid, data: F(rowTime), has_swing_source: false });
      if (ec.forward || ec.right) auto('animate', { action_id: 'row_left', runtime_entity_id: rid, data: F(rowTime), has_swing_source: false });
    }
    const mx = (ec.left ? 1 : 0) - (ec.right ? 1 : 0), mz = (ec.forward ? 1 : 0) - (ec.back ? 1 : 0);
    const mv0 = stick && !locks.movement ? { x: locks.lateral_movement || (stick.x > 0 ? locks.move_left : locks.move_right) ? 0 : stick.x, z: (stick.z > 0 ? locks.move_forward : locks.move_backward) ? 0 : stick.z } : { x: mx, z: mz };
    // in a boat the sideways stick turns it, the other way round from a strafe (measured: left as a strafe turned the boat right)
    const mv = vpos ? { x: -mv0.x, z: mv0.z } : mv0;
    if (locks.camera && camLock) { yaw = camLock.yaw; pitch = camLock.pitch; }
    const rad = (yaw * Math.PI) / 180;
    if (autojump && !vpos && (mv.x || mv.z) && tick - lastJump > 8n) {
      const len = Math.hypot(mv.x, mv.z), dx = (-Math.sin(rad) * mv.z + Math.cos(rad) * mv.x) / len, dz = (Math.cos(rad) * mv.z + Math.sin(rad) * mv.x) / len;
      if (stepAhead(dx, dz)) { autoJumping = 3; lastJump = tick; }
    }
    // riding a client-predicted vehicle (boat): the position sent is the vehicle's; follow the server's corrections and keep its motion
    // (the rider goes where the boat goes: where this client thinks it is, for steering and for looking at things)
    if (vpos) {
      // paddling, predicted like a real client on water (the client says where its boat is and which way it points; the server
      // takes it): an oar turns it 9 degrees a tick, forward pushes it along its heading, the water slows it to 0.9 a tick.
      // Measured on BDS: the boat's yaw as the server shows it (0 = +x, up = clockwise) is the rotation sent, negated; one oar for 5
      // ticks turned it 44 degrees
      const wet = (dy) => /water/.test(world.block(Math.floor(vpos.x), Math.floor(vpos.y + dy), Math.floor(vpos.z))?.name ?? '');
      if (BOATSIM && (wet(0) || wet(-0.5))) {
        const turn = (ec.right ? 1 : 0) - (ec.left ? 1 : 0);
        if (turn) vrot = { x: vrot.x ?? 0, z: (vrot.z ?? 0) - (ec.forward || ec.back ? 5 : 9) * turn };
        const f = (ec.forward ? 0.06 : 0) - (ec.back ? 0.01 : 0), r = (-(vrot.z ?? 0) * Math.PI) / 180;
        vdelta = { x: (vdelta.x + Math.cos(r) * f) * 0.9, y: vdelta.y, z: (vdelta.z + Math.sin(r) * f) * 0.9 };
      }
      vpos = { x: vpos.x + vdelta.x, y: vpos.y + vdelta.y, z: vpos.z + vdelta.z }; pos = { x: vpos.x, y: vpos.y - 0.23 + EYE, z: vpos.z };
    }
    // the step a real client predicts itself: the server takes the client's position while it stays within its tolerance and corrects
    // it only past that, so a slow move (sneaking: 0.065 blocks a tick) or a short hop in flight, never predicted, was taken as
    // standing still. Walking and sprinting are corrected every step and need none. Into a wall it is not predicted (the server
    // would pull it back anyway)
    else if (!dead && (flying || ec.sneak || crawling) && (mv.x || mv.z || (flying && (ec.jump || ec.sneak)))) {
      const len = Math.hypot(mv.x, mv.z) || 1, sp = flying ? (ec.sprint ? 1.0 : 0.5) : 0.065;   // (crawling: the sneaking pace)
      const dx = mv.x || mv.z ? ((-Math.sin(rad) * mv.z + Math.cos(rad) * mv.x) / len) * sp : 0, dz = mv.x || mv.z ? ((Math.cos(rad) * mv.z + Math.sin(rad) * mv.x) / len) * sp : 0;
      const dy = flying ? (ec.jump ? 0.375 : ec.sneak ? -0.375 : 0) : 0;
      const nx = pos.x + dx, ny = pos.y + dy, nz = pos.z + dz, fy = Math.floor(ny - EYE + 0.01);
      const open = (x, y, z) => { const b = world.block(Math.floor(x), y, Math.floor(z)); return !b || !b.shape?.length; };
      const ground = !flying && !open(nx, fy - 1, nz);
      if (open(nx, fy, nz) && (crawling || open(nx, fy + 1, nz)) && (flying || ground)) pos = { x: nx, y: ny, z: nz };   // (sneaking keeps to the edge, as in the game; crawling needs no headroom)
      hvel = { x: 0, z: 0 };
    } else if (!dead && !vpos && !WALKSIM_OFF && !flying && !gliding && !crawling && !ec.sneak && vehicle === null && !/spectator/.test(myMode)) walkStep(ec, mv, rad);
    else hvel = { x: 0, z: 0 };
    if (!vpos) fall();
    hist.set(Number(tick), { ...pos });
    if (hist.size > 80) for (const k of hist.keys()) { if (k < Number(tick) - 60) hist.delete(k); else break; }
    const sent = vpos ?? pos;
    // the velocity this client reports (Pos Delta): how far the server-confirmed position moved over the last tick (spear charges
    // and other speed checks read it; it was always 0)
    const vel = lastPos ? { x: F(pos.x - lastPos.x), y: F(pos.y - lastPos.y), z: F(pos.z - lastPos.z) } : { x: 0, y: 0, z: 0 };
    lastPos = { ...pos };
    client.queue('player_auth_input', {
      pitch, yaw, position: { x: F(sent.x), y: F(sent.y), z: F(sent.z) }, move_vector: mv, head_yaw: yaw, input_data: inputData(flags(ec)), input_mode: inputMode, play_mode: 'normal',
      interaction_model: 'crosshair', interact_rotation: { x: pitch, z: yaw }, tick, delta: vpos ? { ...vdelta } : Math.hypot(vel.x, vel.y, vel.z) < 4 ? vel : { x: 0, y: 0, z: 0 },
      block_action: blockActions.length ? blockActions.splice(0) : undefined,
      ...(vpos ? { vehicle_rotation: vrot, predicted_vehicle: BigInt(vehicle) } : {}),
      analogue_move_vector: mv, camera_orientation: { x: -Math.sin(rad) * Math.cos((pitch * Math.PI) / 180), y: -Math.sin((pitch * Math.PI) / 180), z: Math.cos(rad) * Math.cos((pitch * Math.PI) / 180) }, raw_move_vector: mv,
    });
  };
  // a fixed-step loop like a game client's: the ticks keep their exact average rate when a timer fires late (a long path search)
  // or the step is not a whole millisecond; after a long stall it starts again from now instead of a burst
  const { performance } = require('node:perf_hooks');
  let nextAt = performance.now() + TICK_MS, loopTimer = null, loopStopped = false;
  // paced by the server's own clock when the lab gives one (core.mjs: the server's tick every 10 ticks): a tick here for every tick
  // there, never ahead of it (at most a quarter second guessed past its last word), so a sped-up server that cannot hold the speed
  // asked slows these clients down with it, and a wait of n ticks is n ticks of the world. Without a clock: every 50/k ms
  let paceOff = null, paceSrv = -1;
  const tickWaiters = [];   // [tick, resolve], earliest first
  const wake = () => { while (tickWaiters.length && tickWaiters[0][0] <= tick) tickWaiters.shift()[1](); };
  const step = () => { try { tickOnce(); } catch (e) { if (!pump.warned) { pump.warned = true; say(`tick error: ${e.message}`); } } wake(); };
  const pump = () => {
    if (loopStopped) return;
    const now = performance.now(), C = globalThis.__labSrvClock;
    let wait = TICK_MS;
    if (C && !process.env.LAB_TICK_FIXED) {
      if (C.tick < paceSrv) paceOff = null;   // (a restarted server)
      paceSrv = C.tick;
      // (at most 12 ticks past the server's last word: at 20x a quarter second was 100 ticks, and a dig timed in this client's ticks
      // ended before the server's own count - "block did not break" at every log)
      const est = Math.floor(C.tick + Math.min(((now - C.at) * C.rate) / 1000, 12));
      if (paceOff === null) paceOff = Number(tick) - est;
      let behind = est + paceOff - Number(tick);
      if (behind > 200) { paceOff -= behind - 8; behind = 8; }   // (far behind, this process was busy: skip, do not race)
      for (let k = 0; k < 8 && behind > 0; k++, behind--) step();
      wait = behind > 0 ? 0 : Math.max(1, Math.min(50, 1000 / C.rate));
      nextAt = now + TICK_MS;
    } else {
      for (let k = 0; nextAt <= now && k < 5; k++) { step(); nextAt += TICK_MS; }
      if (now - nextAt > 500) nextAt = now + TICK_MS;
      wait = Math.max(0, nextAt - performance.now());
    }
    loopTimer = setTimeout(pump, wait);
  };
  loopTimer = setTimeout(pump, TICK_MS);
  const loop = { stop() { loopStopped = true; clearTimeout(loopTimer); for (const [, r] of tickWaiters.splice(0)) setTimeout(r, 0); } };

  // n ticks of this client (paced as above), not n x 50 ms of the wall clock. Always through the event loop: 0 ticks = the next turn
  // of it, and once this client has left, n x 50/k ms of the wall clock (a goal still looping after the player left used to spin
  // on promises that resolved at once, and the whole lab process hung at 100% CPU)
  const ticks = (n) => new Promise((r) => {
    const k = Math.max(0, Math.ceil(Number(n) || 0)), at = tick + BigInt(k);
    if (loopStopped) return void setTimeout(r, Math.max(1, k * TICK_MS));
    if (at <= tick) return void setImmediate(r);
    let i = tickWaiters.length; while (i > 0 && tickWaiters[i - 1][0] > at) i--; tickWaiters.splice(i, 0, [at, r]);
  });
  const feet = () => ({ x: pos.x, y: pos.y - EYE, z: pos.z });
  const lookAt = (t) => {
    const dx = t.x - pos.x, dy = t.y - pos.y, dz = t.z - pos.z;
    yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
    pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  };
  const heldItem = () => inv.slots[inv.selected] ?? { network_id: 0 };
  // the face of block b that points toward the player's eye (what a real client clicks)
  const faceToward = (b) => {
    const d = { x: pos.x - (b.x + 0.5), y: pos.y - (b.y + 0.5), z: pos.z - (b.z + 0.5) };
    const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
    if (ay >= ax && ay >= az) return d.y > 0 ? 1 : 0;
    if (ax >= az) return d.x > 0 ? 5 : 4;
    return d.z > 0 ? 3 : 2;
  };
  // arm swings the client announces (Animate + source); the server itself adds UseItem/Interact (item on block), ThrowItem, DropItem
  const swingArm = (source) => client.queue('animate', { action_id: 'swing_arm', runtime_entity_id: rid, data: 0, has_swing_source: true, swing_source: source });
  const useTx = (data) => client.queue('inventory_transaction', { transaction: { legacy: { legacy_request_id: 0 }, transaction_type: 'item_use', actions: [], transaction_data: {
    trigger_type: 'player_input', hotbar_slot: inv.selected, hand: 'main_hand', held_item: heldItem(), player_pos: { ...pos }, client_prediction: 'success', client_cooldown_state: 'off', block_runtime_id: 0, ...data } } });
  const target = (q) => {
    const list = [...entities.values()].filter((e) => (q ? isType(e, q) : e.type !== 'minecraft:item'));
    const f = feet();
    list.sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z, a.y - f.y) - Math.hypot(b.x - f.x, b.z - f.z, b.y - f.y));
    return list[0];
  };
  const hitTx = (e, kind, aimed) => {
    if (!aimed) lookAt({ x: e.x, y: e.y + (e.bh > 0 ? e.bh / 2 : e.type === 'minecraft:player' ? 0.9 : 0.5), z: e.z });   // the middle of its box
    if (kind === 'attack') swingArm('attack');
    client.queue('inventory_transaction', { transaction: { legacy: { legacy_request_id: 0 }, transaction_type: 'item_use_on_entity', actions: [], transaction_data: {
      entity_runtime_id: e.id, action_type: kind, hotbar_slot: inv.selected, held_item: heldItem(), player_pos: { ...pos }, click_pos: { x: 0, y: 0, z: 0 } } } });
  };
  const hold = async (c, n) => { Object.assign(controls, c); await ticks(n); for (const k of Object.keys(c)) controls[k] = false; };
  const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

  // one lab cmd: `@Name <action> args...`
  bot.act = async (action, a) => {
    switch (action) {
      case 'typing': typing = a[0] !== 'off'; return ticks(1);   // hold the chat screen open (a phone player after sending): forms get UserBusy
      case 'chat': client.queue('text', { needs_translation: false, category: 'authored', type: 'chat', source_name: name, message: a.join(' '), xuid: '', platform_chat_id: '', has_filtered_message: false }); return ticks(4);
      case '__sync': {   // the lab's barrier on a slow server: the server answers a same-size chunk radius request after this player's earlier packets
        // (a request plugins never see, unlike a command); resolves true once answered
        const r = radius ?? 8;
        const got = new Promise((res) => { const t = setTimeout(() => res(false), 20000); client.once('chunk_radius_update', () => { clearTimeout(t); res(true); }); });
        client.queue('request_chunk_radius', { chunk_radius: r, max_radius: r });
        return got;
      }
      case 'cmd': {
        const uuid = crypto.randomUUID(), cmd = a.join(' ');
        const p = await new Promise((resolve) => {
          const t = setTimeout(() => { pendingCmd.delete(uuid); resolve(null); }, Number(process.env.LAB_CMD_WAIT_MS) || 1500);   // (a server under Wine answers slower)
          pendingCmd.set(uuid, (x) => { clearTimeout(t); resolve(x); });
          client.queue('command_request', { command: cmd.startsWith('/') ? cmd : '/' + cmd, origin: { type: 'player', uuid, request_id: '', player_entity_id: 0n }, internal: false, version: 'latest' });
        });
        if (!p) return;
        // %key = a translation key (vanilla commands); custom commands reply with plain text, shown as is
        for (const o of p.output ?? []) say(`cmd${o.success ? '' : ' failed'}: ${/^[\w-]+(\.[\w-]+)+$/.test(o.message_id) ? '%' : ''}${o.message_id}${o.parameters?.length ? ` [${o.parameters.join(', ')}]` : ''}`);
        return ticks(2);
      }
      case 'look': yaw = num(a[0], yaw); pitch = num(a[1], pitch); return ticks(2);
      case 'lookat': lookAt({ x: +a[0], y: +a[1], z: +a[2] }); return ticks(2);
      // keys can stay down (`on`) while other actions run: walk forward on → jump → attack ... → walk off / stop
      case 'walk': {
        const dir = a[0] ?? 'forward';
        if (dir === 'off') { controls.forward = controls.back = controls.left = controls.right = false; return ticks(1); }
        if (!['forward', 'back', 'left', 'right'].includes(dir)) throw new Error('walk forward|back|left|right [ticks|on|off] | walk off');
        if (a[1] === 'on' || a[1] === 'off') { controls[dir] = a[1] === 'on'; return ticks(1); }
        return hold({ [dir]: true }, num(a[1], 20));
      }
      case 'sprint': if (a[0] === 'on' || a[0] === 'off') { controls.forward = controls.sprint = a[0] === 'on'; return ticks(1); } return hold({ forward: true, sprint: true }, num(a[0], 20));
      case 'stick': {   // gamepad / touch joystick: stick <x> <z> [ticks|on] (x left+, z forward+, -1..1) | stick off
        if (a[0] === 'off') { stick = null; return ticks(1); }
        const x = Number(a[0]), z = Number(a[1]);
        if (![x, z].every((v) => Number.isFinite(v) && Math.abs(v) <= 1)) throw new Error('stick <x -1..1> <z -1..1> [ticks|on] | stick off');
        stick = { x, z };
        if (a[2] === 'on') return ticks(1);
        await ticks(num(a[2], 20)); stick = null; return ticks(1);
      }
      case 'sneak': if (a[0] === 'on' || a[0] === 'off') { controls.sneak = a[0] === 'on'; return ticks(6); } return hold({ sneak: true }, num(a[0], 20));
      case 'jump': if (a[0] === 'on' || a[0] === 'off') { controls.jump = a[0] === 'on'; return ticks(1); } return hold({ jump: true }, num(a[0], 2)).then(() => ticks(10));
      case 'stop': for (const k of Object.keys(controls)) controls[k] = false; stick = null; if (heldUseOn || digging?.hold || using) return bot.act('release', []); return ticks(1);
      case 'slot': inv.selected = num(a[0], 0); client.queue('mob_equipment', { runtime_entity_id: rid, item: heldItem(), slot: inv.selected, selected_slot: inv.selected, window_id: 'inventory' }); return ticks(2);
      case 'useon': {
        if (!/^-?\d/.test(a[0] ?? '')) {   // useon [hold]: right click whatever the crosshair points at (the face and the exact point hit)
          const h = raycast();
          if (h?.kind !== 'block') return say(`useon: no block under the crosshair${h ? ` (${h.entity.name ?? h.entity.type}: interact)` : ''}`);
          const r = await bot.act('useon', [h.x, h.y, h.z, h.face, ...h.at.map((v) => v.toFixed(3)), ...a.filter((x) => x === 'hold')].map(String));
          if (heldUseOn) heldUseOn.crosshair = true;   // held: each repeat clicks what the crosshair shows then (building a bridge / a tower)
          return r;
        }
        // useon x y z [face] [cx cy cz] [hold] [fast]: face 0-5 or down up north south west east (default up); cx cy cz = the point clicked on
        // the block, 0..1 each (default the face centre): e.g. the upper half of a side face places a top slab / upside-down stairs.
        // fast: clicked this tick, as a person's finger does mid-jump (a block set under the feet at the top of a jump: waiting for the
        // inventory's round trip first - 6 to 13 ticks on a sped-up server - clicked after the landing, into the player: refused)
        const b = { x: +a[0], y: +a[1], z: +a[2] }, FACES = ['down', 'up', 'north', 'south', 'west', 'east'];
        const face = /^\d$/.test(a[3] ?? '') ? +a[3] : FACES.includes(a[3]) ? FACES.indexOf(a[3]) : 1;
        const fast = a.includes('fast');
        const pt = a.slice(/^\d$/.test(a[3] ?? '') || FACES.includes(a[3]) ? 4 : 3).filter((x) => x !== 'hold' && x !== 'fast').map(Number);
        const aim = pt.length === 3 ? { x: b.x + pt[0], y: b.y + pt[1], z: b.z + pt[2] } : { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 };
        lookAt(aim);
        if (!fast) await sync();
        const known = world.rid(b.x, b.y, b.z), blk = known === undefined && blockAt ? await blockAt(b) : null;   // a real client knows it from its chunks
        const brid = known !== undefined ? known >>> 0 : blk ? blockHash(req, blk.id, blk.states, version) >>> 0 : 0;
        if (process.env.LAB_DEBUG) say(`dbg useon known=${known} ${JSON.stringify(blk)}`);
        if (!fast) await ticks(1);
        const cp = pt.length === 3 && pt.every((v) => v >= 0 && v <= 1) ? { x: pt[0], y: pt[1], z: pt[2] } : [{ x: 0.5, y: 0, z: 0.5 }, { x: 0.5, y: 1, z: 0.5 }, { x: 0.5, y: 0.5, z: 0 }, { x: 0.5, y: 0.5, z: 1 }, { x: 0, y: 0.5, z: 0.5 }, { x: 1, y: 0.5, z: 0.5 }][face] ?? { x: 0.5, y: 0.5, z: 0.5 };
        if (pt.length && !(pt.length === 3 && pt.every((v) => v >= 0 && v <= 1))) throw new Error('useon x y z [face] [cx cy cz] [hold]: cx cy cz are 0..1 inside the block');
        const pa = (action) => client.queue('player_action', { runtime_entity_id: rid, action, position: b, result_position: b, face });
        pa('start_item_use_on');
        // held: the client repeats the click every 4 ticks while the button stays down (the Script API sees isFirstEvent=false)
        heldUseOn = a.includes('hold') ? { pa, b, face, cp, last: tick, crosshair: false } : null;
        if (process.env.LAB_DEBUG_PLACE) {
          const o = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][face] ?? [0, 0, 0], c = { x: b.x + o[0], y: b.y + o[1], z: b.z + o[2] }, h = heldItem();
          placeWatch = { tick, c };
          say(`dbg useon ${b.x},${b.y},${b.z} face ${face} -> ${c.x},${c.y},${c.z} (${world.block(c.x, c.y, c.z)?.name}) held ${itemNames.get(h.network_id) ?? 'nothing'} sid ${JSON.stringify(h.stack_id)} slot ${inv.selected} eye ${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)} screen ${box?.type ?? '-'} t=${tick}`);
        }
        useTx({ action_type: 'click_block', block_position: b, face, click_pos: cp, block_runtime_id: brid });
        // fast: the block shown at once where it goes, as a real client predicts it (a plain full block into an empty cell clear of the
        // player): landed on at the top of a jump, not fallen through while the server's word is on its way
        if (fast) {
          const o = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][face] ?? [0, 0, 0], c = { x: b.x + o[0], y: b.y + o[1], z: b.z + o[2] };
          const hn = itemNames.get(heldItem().network_id), hh = hn && tables.firstHash?.get(hn), hb = hh !== undefined && tables.byHash.get(hh);
          const full = hb && (!hb.shape || (hb.shape.length === 1 && hb.shape[0].join() === '0,0,0,1,1,1'));
          const f = pos.y - EYE, clear = !(c.x < pos.x + 0.3 && c.x + 1 > pos.x - 0.3 && c.z < pos.z + 0.3 && c.z + 1 > pos.z - 0.3 && c.y < f + 1.8 && c.y + 1 > f + 1e-3);
          if (full && clear && world.rid(c.x, c.y, c.z) === AIR) { predicted.set(`${c.x},${c.y},${c.z}`, { tick, rid: AIR, pos: c }); world.set(c.x, c.y, c.z, hh); }
        }
        await ticks(2);
        if (heldUseOn) return ticks(3);   // `useon ... hold`: keep the button down until `release`
        pa('stop_item_use_on');
        return ticks(3);
      }
      case 'release': {   // lets go of `useon ... hold`, `dig ... hold`, `use hold`
        if (heldUseOn) { heldUseOn.pa('stop_item_use_on'); heldUseOn = null; }
        if (digging?.hold) { blockActions.push({ action: 'abort_break', position: { ...digging.pos }, face: digging.face }); digging = null; }
        if (using) { using = false; client.queue('inventory_transaction', { transaction: { legacy: { legacy_request_id: 0 }, transaction_type: 'item_release', actions: [], transaction_data: { action_type: 'release', hotbar_slot: inv.selected, held_item: heldItem(), head_pos: { ...pos } } } }); }
        return ticks(4);
      }
      case 'punch': {   // punch x y z [face]: a click on that block's face, no break (a fire on that face is put out, like a person)
        const b = { x: num(a[0]), y: num(a[1]), z: num(a[2]) }, face = num(a[3], 1);
        lookAt({ x: b.x + 0.5, y: b.y + (face === 1 ? 1 : 0.5), z: b.z + 0.5 }); swingArm('attack');
        blockActions.push({ action: 'start_break', position: b, face }); await ticks(1);
        blockActions.push({ action: 'abort_break', position: b, face }); return ticks(1);
      }
      case 'dig': {
        if (!/^-?\d/.test(a[0] ?? '')) {   // dig [ticks|hold]: the block under the crosshair
          const h = raycast();
          if (h?.kind !== 'block') return say('dig: no block under the crosshair');
          return bot.act('dig', [h.x, h.y, h.z, ...a].map(String));
        }
        const b = { x: +a[0], y: +a[1], z: +a[2] };
        lookAt({ x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 });
        if (a[3] === 'hold') { digging = { pos: b, face: faceToward(b), phase: 'start', ticks: 0, hold: true, done() {} }; return ticks(4); }   // keep digging until `release`
        const kb = world.block(b.x, b.y, b.z);
        if (kb ? kb.name === 'minecraft:air' : blockAt && (await blockAt(b))?.id === 'minecraft:air') return say('dig: nothing to dig (air)');
        const stopAt = num(a[3], 0);   // dig x y z [ticks]: stop (abort) after that many ticks
        const broken = await new Promise((done) => { digging = { pos: b, face: faceToward(b), phase: 'start', ticks: 0, max: 400, broken: false, done, stopAt }; });
        if (!broken) say(stopAt ? 'dig: stopped before breaking' : 'dig: block did not break');
        return ticks(2);
      }
      case 'attack': case 'interact': {
        // x y z is a block, not a mob: what the test means is useon (right click) / dig (left click), so that is done
        if (a.length >= 3 && a.slice(0, 3).every((v) => /^~?-?\d+(\.\d+)?$/.test(v))) { say(`${action} ${a.slice(0, 3).join(' ')}: a block, so ${action === 'interact' ? 'useon' : 'dig'} (${action} <mob> is for mobs)`); return bot.act(action === 'interact' ? 'useon' : 'dig', a); }
        if (!a[0]) {   // no name: whatever the crosshair points at, like a click (nothing there: attack swings at the air)
          const h = raycast();
          if (h?.kind !== 'entity') { if (action === 'attack') return bot.act('swing', []); return say('interact: no entity under the crosshair'); }
          await sync();
          hitTx(h.entity, action, true);
          return ticks(4);
        }
        let e = target(a[0]);
        for (let k = 0; !e && k < 40; k++) { await ticks(1); e = target(a[0]); }
        if (!e) return say(`${action}: no ${a[0] ?? 'entity'} in view`);
        if (action === 'interact' && locks.mount && /horse|donkey|mule|camel|pig|strider|boat|minecart|llama|happy_ghast|nautilus/.test(e.type)) return say('interact: mounting is locked by the server (input permission Mount)');
        await sync();
        const fresh = Number(10n - (tick - e.seen)); if (fresh > 0) await ticks(fresh);   // a mob this client just learned about: give it a moment, like a human reacting
        if (process.env.LAB_DEBUG) say(`dbg target ${e.type} id=${e.id} at ${e.x},${e.y},${e.z} me ${JSON.stringify(pos)} tick ${tick} seen ${e.seen} held ${JSON.stringify(big(heldItem())).slice(0,200)}`);
        { const w = (e.bw > 0 ? e.bw : 0.6) / 2, hh = e.bh > 0 ? e.bh : e.type === 'minecraft:player' ? 1.8 : 1;   // a human could not reach it from here: say so (the server decides)
          const c = { x: Math.max(e.x - w, Math.min(pos.x, e.x + w)), y: Math.max(e.y, Math.min(pos.y, e.y + hh)), z: Math.max(e.z - w, Math.min(pos.z, e.z + w)) };
          const dd = Math.hypot(c.x - pos.x, c.y - pos.y, c.z - pos.z); if (dd > reach('entity') + 0.3) say(`${action}: ${e.name ?? e.type} is ${dd.toFixed(1)} blocks away (reach ${reach('entity')})`); }
        hitTx(e, action);
        return ticks(4);
      }
      case 'form': {
        if (!form && ddui) {   // data-driven UI: form <i> clicks a button, form <i> <value> sets toggle/text/slider/dropdown, form close
          findDd();
          const d = ds.get(ddui.prop), v = d?.value ?? {};
          if (!d) return say('form: no data for ' + ddui.screen);
          if (a[0] === 'close' || a.length === 0) { client.queue('serverbound_data_driven_screen_closed', { form_id: ddui.form, close_reason: 'ClientCanceled' }); ddui = null; return ticks(4); }
          if (/message_box/.test(ddui.screen)) {   // form 0 / form 1 = button1 / button2
            const b = a[0] === '1' ? 'button2' : 'button1';
            ddWrite(`${b}.onClick`, (Number(v[b]?.onClick) || 0) + 1);   // a click writes the button, then the box closes (selection 1|2)
            await ticks(1);
            client.queue('serverbound_data_driven_screen_closed', { form_id: ddui.form, close_reason: 'ClientCanceled' }); ddui = null;
            return ticks(4);
          }
          const i = Number(a[0]), e = ddElements(v)[i], k = e && ddKind(e);
          if (!e) return emit(`E @${name} form: no element ${a[0]} (0..${ddElements(v).length - 1})`);
          const raw = a.slice(1).join(' ');
          let val; try { val = JSON.parse(raw); } catch { val = raw; }
          if (k === 'button') ddWrite(`layout[${i}].onClick`, (Number(e.onClick) || 0) + 1);
          else if (k === 'toggle') ddWrite(`layout[${i}].toggled`, raw === '' ? !e.toggled : val === true || val === 1 || val === 'on');
          else if (k === 'textfield') ddWrite(`layout[${i}].text`, String(raw));
          else if (k === 'slider' || k === 'dropdown') ddWrite(`layout[${i}].value`, Number(val));
          else return emit(`E @${name} form: element ${i} is a ${k} (nothing to press)`);
          return ticks(4);
        }
        if (!form) { await ticks(10); if (!form) return emit(`E @${name} form: none open (answer a form after \`until form\`; one the addon did not open cannot be answered)`); }
        const f = form; form = null;
        const v = a.join(' ');
        if (v === '' || v === 'close' || v === 'null') client.queue('modal_form_response', { form_id: f.id, has_response_data: false, has_cancel_reason: true, cancel_reason: 'closed' });
        else {
          let val; try { val = JSON.parse(v); } catch { val = undefined; }
          // a custom form with one input answered without the brackets (form 0 / form 緑): that input's value
          if (f.j.type === 'custom_form' && !Array.isArray(val) && Array.isArray(f.j.content) && f.j.content.filter((c) => !['label', 'header', 'divider'].includes(c.type)).length === 1) val = [val ?? String(v).replace(/^["']|["']$/g, '')];
          // a button can be named by its text too: form "Buy" / form Buy (exact, else the first that contains it)
          if (val === undefined || (typeof val === 'string' && f.j.type !== 'custom_form')) {
            const txt = (t) => (typeof t === 'string' ? t : t?.rawtext ? t.rawtext.map((x) => x.text ?? '%' + x.translate).join('') : String(t ?? ''));
            const want = String(val ?? v).replace(/^["']|["']$/g, ''), clean = (t) => txt(t).replace(/§./g, '');
            const texts = f.j.type === 'modal' ? [f.j.button1, f.j.button2] : f.j.type === 'form' ? (f.j.buttons ?? f.j.elements ?? []).filter((b) => !b.type || b.type === 'button').map((b) => b.text) : null;
            if (!texts) { form = f; return emit(`E @${name} form: a custom form takes its values as JSON, e.g. form ["text", true, 2]`); }
            let i = texts.findIndex((t) => clean(t) === want); if (i < 0) i = texts.findIndex((t) => clean(t).includes(want));
            if (i < 0) { form = f; return emit(`E @${name} form: no button "${want}" (${texts.map((t, k) => `${k}:${clean(t)}`).join(' ')})`); }
            val = i;
          }
          if (f.j.type === 'modal') val = val === 0 || val === true;
          if (f.j.type === 'custom_form' && Array.isArray(val) && Array.isArray(f.j.content)) {
            // values are given for input elements only; labels/headers/dividers get null. A wrong count or kind is refused with the
            // form's inputs listed (a silently misread answer costs a whole debugging round)
            const ins = f.j.content.filter((c) => !['label', 'header', 'divider'].includes(c.type));
            // a dropdown or step slider answered with its option's text (form ["緑"]) → that option's index
            const plain = (t) => (typeof t === 'string' ? t : t?.rawtext ? t.rawtext.map((x) => x.text ?? '%' + x.translate).join('') : String(t ?? '')).replace(/§./g, '');
            val = val.map((x, j) => { const c = ins[j], opts = c?.type === 'dropdown' ? c.options : c?.type === 'step_slider' ? c.steps : null; if (typeof x === 'string' && c && ['slider', 'dropdown', 'step_slider'].includes(c.type) && /^-?\d+(\.\d+)?$/.test(x) && !(opts ?? []).map(plain).includes(x)) return Number(x); if (!opts || typeof x !== 'string') return x; const o = opts.map(plain); let k = o.indexOf(x); if (k < 0) k = o.findIndex((t) => t.includes(x)); return k >= 0 ? k : x; });
            const like = (c) => (c.type === 'toggle' ? 'true' : c.type === 'input' ? '"text"' : c.type === 'dropdown' ? `0..${(c.options ?? []).length - 1}` : c.type === 'slider' ? `${c.min}..${c.max}` : `0..${(c.steps ?? []).length - 1}`);
            const ok = (c, x) => (c.type === 'toggle' ? typeof x === 'boolean' : c.type === 'input' ? typeof x === 'string' : c.type === 'dropdown' ? Number.isInteger(x) && x >= 0 && x < (c.options ?? []).length : typeof x === 'number');
            const bad = val.length !== ins.length ? `${val.length} value(s) for ${ins.length} input(s)` : (() => { const k = ins.findIndex((c, j) => !ok(c, val[j])); return k < 0 ? '' : `value ${k} (${JSON.stringify(val[k])}) does not fit the ${ins[k].type}`; })();
            if (bad) { form = f; return emit(`E @${name} form: ${bad}: one value per input, in order: ${ins.map((c) => `${c.type} "${String(c.text ?? '').replace(/§./g, '').slice(0, 30)}" ${like(c)}`).join(', ')} → e.g. form [${ins.map((c) => (c.type === 'toggle' ? 'true' : c.type === 'input' ? '"text"' : c.type === 'slider' ? c.min : 0)).join(', ')}]`); }
            const it = val[Symbol.iterator]();
            val = f.j.content.map((c) => (['label', 'header', 'divider'].includes(c.type) ? null : it.next().value ?? null));
          }
          client.queue('modal_form_response', { form_id: f.id, has_response_data: true, data: JSON.stringify(val), has_cancel_reason: false });
        }
        return ticks(4);
      }
      case 'respawn': {
        if (!dead) return say('respawn: not dead');
        client.queue('respawn', { position: { x: 0, y: 0, z: 0 }, state: 2, runtime_entity_id: rid });
        for (let k = 0; dead && k < 60; k++) await ticks(1);
        return dead ? say('respawn: server did not respawn') : ticks(10);
      }
      case 'use': {
        await sync(); await ticks(1);
        const hold = a[0] === 'hold' ? -1 : num(a[0], 0);
        useTx({ action_type: 'click_air', block_position: { x: 0, y: 0, z: 0 }, face: 255, click_pos: { x: 0, y: 0, z: 0 } });
        if (!hold) return ticks(4);
        using = true;
        if (hold < 0) return ticks(4);   // `use hold`: keep using until `release`
 await ticks(hold); using = false;
        client.queue('inventory_transaction', { transaction: { legacy: { legacy_request_id: 0 }, transaction_type: 'item_release', actions: [], transaction_data: { action_type: 'release', hotbar_slot: inv.selected, held_item: heldItem(), head_pos: { ...pos } } } });
        return ticks(4);
      }
      case 'drop': {   // drop [n] [slot]: Q on the held item, or (inventory screen open) Q over any slot: 0-35 head chest legs feet offhand
        await sync(); await ticks(1);
        if (a[1] === undefined) {
          const it = heldItem();
          if (!it.network_id) return say('drop: hand is empty');
          stackReq([{ type_id: 'drop', legacy_type_id: 3, count: Math.min(num(a[0], 1), it.count), source: slotInfo('hotbar', inv.selected, it), randomly: false }]);
          await ticks(4); resync(); return ticks(4);
        }
        const opened = !box;
        if (opened) { client.queue('interact', { action_id: 'open_inventory', target_entity_id: rid, has_position: false }); await boxWait(); }
        try {
          const src = slotRef(a[1]);
          if (!src.item?.network_id) return say(`drop: ${a[1]} is empty`);
          const r = waitResponse(reqId);
          stackReq([{ type_id: 'drop', legacy_type_id: 3, count: Math.min(num(a[0], 1), src.item.count), source: slotInfo(src.c, src.slot, src.item, src.dyn), randomly: false }]);
          const st = await r;
          if (st !== 'ok') say(`drop rejected: ${st}`);
        } finally { if (opened && box) { client.queue('container_close', { window_id: box.window, window_type: box.type, server: false }); box = null; } }
        await ticks(2); await sync(); return ticks(2);
      }
      case 'inv': {
        if (a.length) throw new Error('inv only prints the inventory; to give items use the console: give ' + name + ' <item> [count]');
        await sync();
        const worn = [...['head', 'chest', 'legs', 'feet'].map((k, i) => (iname(inv.armor[i]) ? `${k}:${iname(inv.armor[i])}` : null)), iname(inv.offhand[0]) ? `offhand:${iname(inv.offhand[0])}` : null].filter(Boolean);
        return say(`inv ${list(inv.slots)} (holding slot ${inv.selected})${worn.length ? ' worn ' + worn.join(' ') : ''}`);
      }
      case 'packs': return say('packs ' + (offered.length ? offered.join(' | ') : 'none (no resource pack offered)'));
      case 'status': { const f = feet(); return say(`hp ${attrs.health ?? '?'} food ${attrs['player.hunger'] ?? '?'} pos ${f.x.toFixed(1)} ${f.y.toFixed(1)} ${f.z.toFixed(1)} yaw ${yaw.toFixed(0)} pitch ${pitch.toFixed(0)}${dead ? ' dead' : ''}`); }
      case 'goto': {
        // like a person: a path over the blocks this client knows (around walls, up 1-block steps with a jump, down drops up to 3);
        // the position we see is the server's, a few ticks late: walk freely while far, then short steps that settle
        const tx = +a[0], tz = +a[a.length === 3 ? 2 : 1];
        const path = pathTo(tx, tz);
        for (const [wx, , wz] of (path ?? []).slice(1, -1)) {
          for (let k = 0; k < 40; k++) {
            const dx = wx + 0.5 - pos.x, dz = wz + 0.5 - pos.z, d = Math.hypot(dx, dz);
            if (d < 0.7) break;
            yaw = (Math.atan2(-dx, dz) * 180) / Math.PI; controls.forward = true;
            if (tick - lastJump > 8n && stepAhead(dx / d, dz / d)) { lastJump = tick; controls.jump = true; jumpOff = tick + 2n; }
            await ticks(1);
          }
        }
        for (let k = 0; k < num(a[3], 400); k++) {
          const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
          if (d < 0.25) break;
          yaw = (Math.atan2(-dx, dz) * 180) / Math.PI; controls.forward = true;
          if (tick - lastJump > 8n && stepAhead(dx / d, dz / d)) { lastJump = tick; controls.jump = true; jumpOff = tick + 2n; }
          if (d > 1.5) { await ticks(1); continue; }
          await ticks(1); controls.forward = false; await ticks(4);
        }
        controls.forward = false;
        await ticks(4);
        for (let k = 0; k < 20 && fallV !== 0; k++) await ticks(1);   // (a step down into a hole: arrived is standing, not still falling)
        return undefined;
      }
      case 'open': {   // open x y z: a block's screen | open: your own inventory screen (E), until close
        if (!a.length) {
          // riding a horse, donkey, llama...: the key opens the mount's inventory (the client names the mount), else its own
          box = null;
          client.queue('interact', { action_id: 'open_inventory', target_entity_id: vehicle ?? rid, has_position: false });
          await boxWait();
          return box ? ticks(2) : say('open: the inventory did not open');
        }
        box = null;
        await bot.act('useon', a.slice(0, 3).concat(a[3] ?? '1'));
        await boxWait();
        return box ? ticks(4) : say('open: no container opened');
      }
      case 'move': {
        // move <from> <to> [n]: slots are 0-35 (0-8 hotbar), head chest legs feet, offhand, cursor, box:<n> (open container / screen)
        if (a.length < 2) return say('move <from> <to> [n]: 0-35 | head chest legs feet | offhand | cursor | box:<n>');
        const cs = /^box:(\d)$/.exec(a[1]);
        if (cs && box?.type === 'crafter' && box.pos && (crafterOff.get(`${box.pos.x},${box.pos.y},${box.pos.z}`) ?? 0) & (1 << +cs[1])) return say(`move: crafter slot ${cs[1]} is disabled`);
        await sync();
        let opened = false;
        const needScreen = [a[0], a[1]].some((x) => /^(head|chest|legs|feet|cursor|offhand|bundle:\d+)$/.test(x) || (/^\d+$/.test(x) && +x >= 9));   // main inventory, armor, offhand, cursor: inventory screen
        if (needScreen && !box) {   // armor and cursor slots exist while the inventory screen is open
          client.queue('interact', { action_id: 'open_inventory', target_entity_id: rid, has_position: false });
          await boxWait();
          opened = !!box;
        }
        let res;
        try {
          const src = slotRef(a[0]), dst = slotRef(a[1]);
          if (!src.item?.network_id) return say(`move: ${a[0]} is empty`);
          const n = Math.min(num(a[2], src.item.count), src.item.count);
          movingItem = src.item;
          const sameItem = dst.item?.network_id === src.item.network_id;
          const put = (slot, item) => { const r = waitResponse(reqId); stackReq([{ type_id: 'place', legacy_type_id: 1, count: n, source: slotInfo(src.c, src.slot, src.item, src.dyn), destination: slotInfo(dst.c, slot, item, dst.dyn) }]); return r; };
          if (dst.c === 'dynamic') {   // a click on the bundle: onto a stack of the same item if it fits, else the next free place
            const same = dst.list.findIndex((x) => x?.network_id === src.item.network_id);
            res = same >= 0 ? await put(same, dst.list[same]) : 'none';
            if (res !== 'ok') res = await put(dst.free, null);
            if (res === 'ok') say(`moved ${iname(src.item).replace(/\*\d+$/, '')}*${n} ${a[0]} -> ${a[1]}`); else say(`move rejected: ${res === 'status 55' || res === 'status 50' ? 'the bundle is full' : res}`);
          } else {
          const id = reqId, r = waitResponse(id);
          if (dst.item?.network_id && !sameItem) stackReq([{ type_id: 'swap', legacy_type_id: 2, source: slotInfo(src.c, src.slot, src.item, src.dyn), destination: slotInfo(dst.c, dst.slot, dst.item) }]);
          else stackReq([{ type_id: 'place', legacy_type_id: 1, count: n, source: slotInfo(src.c, src.slot, src.item, src.dyn), destination: slotInfo(dst.c, dst.slot, dst.item?.network_id ? dst.item : null) }]);
          res = await r;
          if (res === 'ok') say(`moved ${iname(src.item).replace(/\*\d+$/, '')}*${n} ${a[0]} -> ${a[1]}`);
          else say(`move rejected: ${res}`);
          }
        } finally {
          if (opened && box) { client.queue('container_close', { window_id: box.window, window_type: box.type, server: false }); box = null; }
        }
        await ticks(2); await sync();
        return ticks(2);
      }
      case 'enchant': {   // enchant <0-2>: the option shown in "enchant options" (enchanting table open, item + lapis placed)
        if (box?.type !== 'enchantment') return say('enchant: open an enchanting table first');
        const k = num(a[0], 0), o = enchantOptions[k];
        if (!o) return say('enchant: no such option (move the item to box:0 and lapis to box:1 first)');
        await sync();
        const res = await finish([{ type_id: 'craft_recipe', legacy_type_id: 12, recipe_network_id: unzig(o.option_id), times_crafted: 1 }],
          [['enchanting_lapis', 15, k + 1], ['enchanting_input', 14, 1]], 1);   // option i costs i+1 lapis (and i+1 levels)
        return say(res === 'ok' ? `enchanted: ${o.name.trim()}` : `enchant rejected: ${res}`);
      }
      case 'anvil': {     // anvil [new name...]: rename and/or repair/combine box:0 with box:1 on an open anvil
        if (box?.type !== 'anvil') return say('anvil: open an anvil first');
        await sync();
        const text = a.join(' ');
        const mat = inv.ui[2]?.network_id ? inv.ui[2].count : 0;
        let res;
        // how much material a repair eats depends on the damage: the server refuses any other count, so try 1..4
        for (let n = mat ? 1 : 0; n <= Math.min(mat, 4); n++) {
          res = await finish([{ type_id: 'optional', legacy_type_id: 15, recipe_network_id: 0, filtered_string_index: text ? 0 : -1 }],
            [['anvil_input', 1, 1], ...(n ? [['anvil_material', 2, n]] : [])], 1, text ? [text] : []);
          if (res === 'ok' || !mat) break;
        }
        return say(res === 'ok' ? `anvil done${text ? ': "' + text + '"' : ''}` : `anvil rejected: ${res}`);
      }
      case 'cut': {       // cut <item>: stonecutter open, input in box:0
        if (box?.type !== 'stonecutter') return say('cut: open a stonecutter first');
        await sync();
        const want = (a[0] ?? '').includes(':') ? a[0] : 'minecraft:' + a[0], src = itemNames.get(inv.ui[3]?.network_id);
        const r = special.stonecutter.find((x) => itemNames.get(x.out.network_id) === want && (!src || x.input?.[0]?.name === src));
        if (!r) return say(`cut: no stonecutter recipe ${src ?? '?'} -> ${want}`);
        const res = await finish([{ type_id: 'craft_recipe', legacy_type_id: 12, recipe_network_id: r.net, times_crafted: 1 }], [['stonecutter_input', 3, r.input?.[0]?.count || 1]], r.out.count);
        return say(res === 'ok' ? `cut ${want}*${r.out.count}` : `cut rejected: ${res}`);
      }
      case 'carto': {     // carto: cartography table open, paper in box:0 (+ compass in box:1 = locator map)
        if (box?.type !== 'cartography') return say('carto: open a cartography table first');
        await sync();
        const names = [inv.ui[12], inv.ui[13]].filter((x) => x?.network_id).map((x) => itemNames.get(x.network_id)).sort().join('+');
        let r = (special.cartography ?? []).find((x) => x.input.map((i) => i.name).sort().join('+') === names), out = 1;
        // copying, zooming out, locking and marking a map are the game's special (multi) recipes: known by their fixed ids
        if (!r) {
          const MULTI = { 'minecraft:empty_map+minecraft:filled_map': ['442D85ED-8272-4543-A6F1-418F90DED05D', 'copy', 2], 'minecraft:filled_map+minecraft:paper': ['8B36268C-1829-483C-A0F1-993B7156A8F2', 'zoom', 1],
            'minecraft:filled_map+minecraft:glass_pane': ['602234E4-CAC1-4353-8BB7-B1EBFF70024B', 'lock', 1], 'minecraft:compass+minecraft:filled_map': ['98C84B38-1085-46BD-B1CE-DD38C159E6CC', 'mark', 1] };
          const m = MULTI[names], want = m && uuidWire(m[0]), mr = want && special.multi.find((x) => String(x.uuid).toLowerCase() === want);
          if (mr) { r = { net: mr.net, id: m[1] }; out = m[2]; }
        }
        if (!r) return say(`carto: no cartography recipe for ${names || 'nothing'}`);
        const res = await finish([{ type_id: 'craft_recipe', legacy_type_id: 12, recipe_network_id: r.net, times_crafted: 1 }], [['cartography_input', 12, 1], ...(inv.ui[13]?.network_id ? [['cartography_additional', 13, 1]] : [])], out);
        return say(res === 'ok' ? `carto -> ${r.id.replace('minecraft:cartography_table_', '')}` : `carto rejected: ${res}`);
      }
      case 'smith': {     // smith: smithing table open, base in box:0, material in box:1, template in box:2
        if (box?.type !== 'smithing_table') return say('smith: open a smithing table first');
        await sync();
        const nm = (i) => itemNames.get(inv.ui[i]?.network_id);
        const ok = (ing, n) => !ing || ing.type !== 'valid' || ing.name === n || ing.descriptor_type === 'item_tag';
        const r = special.smithing.find((x) => ok(x.base, nm(51)) && ok(x.add, nm(52)) && ok(x.tpl, nm(53)) && x.base?.name === nm(51) && x.tpl?.name === nm(53))
          ?? special.smithing.find((x) => x.trim && x.tpl?.name === nm(53))
          ?? (/_armor_trim_smithing_template$/.test(nm(53) ?? '') ? special.smithing.find((x) => x.trim) : undefined);   // (trims name the template and the armor by tags)
        if (!r) return say(`smith: no smithing recipe for ${nm(51)} + ${nm(52)} + ${nm(53)}`);
        const res = await finish([{ type_id: 'craft_recipe', legacy_type_id: 12, recipe_network_id: r.net, times_crafted: 1 }], [['smithing_table_input', 51, 1], ['smithing_table_material', 52, 1], ['smithing_table_template', 53, 1]], 1);
        return say(res === 'ok' ? `smithed ${r.trim ? 'trim' : itemNames.get(r.out?.network_id) ?? '?'}` : `smith rejected: ${res}`);
      }
      case 'grind': {     // grind [cost]: grindstone open, item(s) in box:0 and/or box:1 -> disenchant / repair-combine
        // Mojang's protocol docs type the "recipe" field as ItemStackNetIdVariant: it is the input item's stack id, not a recipe id
        if (box?.type !== 'grindstone') return say('grind: open a grindstone first');
        await sync();
        const first = inv.ui[16]?.network_id ? inv.ui[16] : inv.ui[17];
        if (!first?.network_id) return say('grind: put an item in box:0 or box:1 first');
        const cons = [...(inv.ui[16]?.network_id ? [['grindstone_input', 16, 1]] : []), ...(inv.ui[17]?.network_id ? [['grindstone_additional', 17, 1]] : [])];
        const res = await finish([{ type_id: 'craft_grindstone_request', legacy_type_id: 16, recipe_network_id: netId(first.stack_id) ?? 0, times_crafted: 1, cost: num(a[0], 0) }], cons, 1);
        return say(res === 'ok' ? 'ground' : `grind rejected: ${res}`);
      }
      case 'loom': {      // loom <pattern id>: loom open, banner box:0, dye box:1 (pattern item box:2 when needed)
        if (box?.type !== 'loom') return say('loom: open a loom first');
        await sync();
        const res = await finish([{ type_id: 'craft_loom_request', legacy_type_id: 17, pattern: a[0] ?? 'bo', times_crafted: 1 }], [['loom_input', 9, 1], ['loom_dye', 10, 1]], 1);
        return say(res === 'ok' ? `loom pattern ${a[0] ?? 'bo'}` : `loom rejected: ${res}`);
      }
      case 'trade': {     // trade <index|item> | trade pay <item>: villager screen open (interact); pays from the inventory like the client's auto-fill
        if (box?.type !== 'trading' || !trade) return say('trade: interact with a villager first');
        // trade <index> | trade <item> (the offer that gives it) | trade pay <item> (the first offer paid with it)
        const pay = a[0] === 'pay', arg = pay ? a[1] : a[0];
        const want = arg && !/^\d+$/.test(arg) ? (arg.includes(':') ? arg : 'minecraft:' + arg) : null;
        const ok = (x) => x.uses === undefined || x.maxUses === undefined || x.uses < x.maxUses;
        const o = want ? trade.offers.find((x) => ok(x) && (pay ? x.buyA?.Name === want : x.sell?.Name === want)) : trade.offers[num(arg, 0)];
        if (!o) return say(`trade: no offer ${a[0] ?? 0}`);
        await sync();
        const find = (buy) => inv.slots.findIndex((x) => x?.network_id && itemNames.get(x.network_id) === buy.Name && x.count >= (buy.Count ?? 1));
        for (const [buy, k] of [[o.buyA, 0], [o.buyB, 1]]) {
          if (!buy?.Name) continue;
          const i = find(buy);
          if (i < 0) return say(`trade: need ${buy.Count} ${buy.Name}`);
          await bot.act('move', [String(i), 'box:' + k, String(buy.Count ?? 1)]);
        }
        const cons = [['trade2_ingredient1', 4, o.buyA?.Count ?? 1], ...(o.buyB?.Name ? [['trade2_ingredient2', 5, o.buyB.Count ?? 1]] : [])];
        const res = await finish([{ type_id: 'craft_recipe', legacy_type_id: 12, recipe_network_id: o.netId, times_crafted: 1 }], cons, o.sell?.Count ?? 1);
        return say(res === 'ok' ? `traded -> ${o.sell?.Count ?? 1} ${o.sell?.Name}` : `trade rejected: ${res}`);
      }
      case 'beacon': {    // beacon <primary> [secondary]: beacon open, payment item in box:0 (effect names: speed haste resistance jump_boost strength regeneration)
        if (box?.type !== 'beacon') return say('beacon: open a beacon first');
        const EFF = { speed: 1, haste: 3, resistance: 11, jump_boost: 8, strength: 5, regeneration: 10 };
        const pe = EFF[a[0]] ?? num(a[0], 1), se = a[1] ? EFF[a[1]] ?? num(a[1], 0) : 0;
        await sync();
        const id = reqId, r = waitResponse(id);
        stackReq([{ type_id: 'beacon_payment', legacy_type_id: 10, primary_effect: pe, secondary_effect: se },
          { type_id: 'destroy', legacy_type_id: 4, count: 1, source: { slot_type: { container_id: 'beacon_payment' }, slot: 27, stack_id: netId(inv.ui[27]?.stack_id) ?? 0 } }]);   // the payment is destroyed, not consumed
        const st = await r;
        await sync();
        return say(st === 'ok' ? `beacon set ${a[0]}${a[1] ? ' + ' + a[1] : ''}` : `beacon rejected: ${st}`);
      }
      case 'sign': {      // sign [x y z] <text...>: write the sign whose editor is open (placing a sign opens it; useon an existing one too). | = new line
        if (/^-?\d+$/.test(a[0] ?? '') && /^-?\d+$/.test(a[1] ?? '') && /^-?\d+$/.test(a[2] ?? '')) { signEditor = null; await bot.act('useon', a.slice(0, 3)); for (let k = 0; !signEditor && k < 20; k++) await ticks(1); a = a.slice(3); }
        if (!signEditor) return say('sign: no sign editor open (place a sign, or sign x y z <text>)');
        const { pos, front } = signEditor, was = signs.get(`${pos.x},${pos.y},${pos.z}`);
        const base = { Text: { type: 'string', value: '' }, TextOwner: { type: 'string', value: '' }, SignTextColor: { type: 'int', value: -16777216 }, GlowingText: { type: 'byte', value: 0 }, PersistFormatting: { type: 'byte', value: 1 }, HideGlowOutline: { type: 'byte', value: 0 } };
        const keep = (k) => ({ ...base, ...(was?.[k]?.value ?? {}) });   // the side not being edited, and this side's dye / glow, stay as they are
        const side = { ...keep(front ? 'FrontText' : 'BackText'), Text: { type: 'string', value: a.join(' ').replace(/\|/g, '\n') } };
        client.queue('block_entity_data', { position: pos, nbt: { type: 'compound', name: '', value: { id: { type: 'string', value: 'Sign' }, x: { type: 'int', value: pos.x }, y: { type: 'int', value: pos.y }, z: { type: 'int', value: pos.z }, IsWaxed: { type: 'byte', value: 0 },
          FrontText: { type: 'compound', value: front ? side : keep('FrontText') }, BackText: { type: 'compound', value: front ? keep('BackText') : side } } } });
        signEditor = null;
        return ticks(6);
      }
      case 'book': {      // book write <page> <text...> | book sign <title>: the book & quill in the selected slot
        const slot = inv.selected;
        // the server edits only a book the client holds and has opened (right-click): do both first
        await sync();
        client.queue('mob_equipment', { runtime_entity_id: rid, item: heldItem(), slot, selected_slot: slot, window_id: 'inventory' });
        useTx({ action_type: 'click_air', block_position: { x: 0, y: 0, z: 0 }, face: 255, click_pos: { x: 0, y: 0, z: 0 } });   // opening the book: the server then accepts edits
        await ticks(2);
        if (a[0] === 'write') client.queue('book_edit', { inventory_slot: slot, type: 'replace_page', page_number: num(a[1], 0), text: a.slice(2).join(' ').replace(/\|/g, '\n'), photo_name: '' });
        else if (a[0] === 'sign') client.queue('book_edit', { inventory_slot: slot, type: 'sign', title: a.slice(1).join(' '), author: name, xuid: '' });
        else if (a[0] === 'add') client.queue('book_edit', { inventory_slot: slot, type: 'add_page', page_number: num(a[1], 0), text: a.slice(2).join(' ').replace(/\|/g, '\n'), photo_name: '' });
        else if (a[0] === 'delete') client.queue('book_edit', { inventory_slot: slot, type: 'delete_page', page_number: num(a[1], 0) });
        else if (a[0] === 'swap') client.queue('book_edit', { inventory_slot: slot, type: 'swap_pages', page1: num(a[1], 0), page2: num(a[2], 1) });
        else throw new Error('book write|add <page> <text> | book delete <page> | book swap <a> <b> | book sign <title>');
        await ticks(4); await sync();
        return ticks(2);
      }
      case 'lectern': {   // lectern x y z <page>: turn the book on a lectern to a page
        const pos = { x: +a[0], y: +a[1], z: +a[2] };
        lookAt({ x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 });
        client.queue('lectern_update', { page: num(a[3], 0), page_count: num(a[4], 1) || 1, position: pos });
        return ticks(4);
      }
      case 'fish': {      // fish [seconds]: cast the rod in hand, wait for a bite (the bobber dips), reel in, say what came
        const have = () => { const c = {}; for (const s of inv.slots) { const n = s?.network_id ? itemNames.get(s.network_id) : null; if (n) c[n] = (c[n] ?? 0) + (s.count ?? 1); } return c; };
        const before = have();
        bite = false;
        await bot.act('use', []);
        // where the bobber settles (~1.5 s): on land no fish ever bites, though the server may still send the hook event there
        await ticks(30);
        const hook = [...entities.values()].find((e) => e.type === 'minecraft:fishing_hook');
        if (hook) {
          // caught on a player or mob next to it (real players all spawn on 0 -60 0: two casting from there hook each other)
          const on = [...entities.values()].find((e) => e !== hook && !/fishing_hook|^minecraft:item$|xp_orb/.test(e.type) && Math.hypot(e.x - hook.x, e.z - hook.z) < 1.2 && hook.y >= e.y - 0.5 && hook.y <= e.y + 2.5);
          if (on) { await bot.act('use', []); return say(`fish: the bobber caught on ${on.name ?? String(on.type).replace(/^minecraft:/, '')} next to it, not water (players spawn on the same spot: move one first, e.g. tp ${on.name ?? 'B'} 4 -60 0)`); }
          const h = { x: Math.floor(hook.x), y: Math.floor(hook.y), z: Math.floor(hook.z) };
          const bl = world.block(h.x, h.y, h.z) ?? (blockAt ? await blockAt(h) : null), bn = bl?.name ?? bl?.id;
          const under = /water/.test(bn ?? '') ? null : world.block(h.x, h.y - 1, h.z) ?? (blockAt ? await blockAt({ ...h, y: h.y - 1 }) : null), un = under?.name ?? under?.id;
          if (bn && !/water/.test(bn) && !/water/.test(un ?? '')) { await bot.act('use', []); return say(`fish: the bobber landed on ${String(un && /air/.test(bn) ? un : bn).replace(/^minecraft:/, '')} at ${h.x} ${h.y} ${h.z}, not water (a cast flies ~10 blocks ahead: e.g. fill -8 -64 2 8 -61 24 water in front of a player at 0 -60 0 facing +z)`); }
        }
        for (let k = 0; !bite && k < num(a[0], 45) * 20; k++) await ticks(1);
        const got = bite;
        await bot.act('use', []);
        // what came in (the catch flies to the player for a moment)
        let caught = [];
        for (let k = 0; got && k < 40 && !caught.length; k++) { await ticks(1); const now = have(); caught = Object.keys(now).filter((n) => now[n] > (before[n] ?? 0)).map((n) => n.replace(/^minecraft:/, '')); }
        return say(caught.length ? `fish: caught ${caught.join(', ')}` : got ? 'fish: bite, reeled in, nothing came' : 'fish: no bite, reeled in');
      }
      case 'creative': {  // creative <item> [n]: take an item from the creative inventory (creative mode)
        const want = (a[0] ?? '').includes(':') ? a[0] : 'minecraft:' + a[0];
        const netId = [...itemNames].find(([, v]) => v === want)?.[0];
        const entry = creative.get(netId);
        if (entry === undefined) return say(`creative: ${want} is not in the creative inventory`);
        await sync();
        const n = num(a[1], 1);
        const opened = !box;   // the creative menu is part of the inventory screen
        if (opened) { client.queue('interact', { action_id: 'open_inventory', target_entity_id: rid, has_position: false }); await boxWait(); }
        const res = await finish([{ type_id: 'craft_creative', legacy_type_id: 14, item_id: entry, times_crafted: 1 }], [], n);
        if (opened && box) { client.queue('container_close', { window_id: box.window, window_type: box.type, server: false }); box = null; }
        return say(res === 'ok' ? `creative ${want}*${n}` : `creative rejected: ${res}`);
      }
      case 'pick': {      // pick x y z [data] | pick <entity>: pick block / pick entity (middle click)
        if (/^-?\d+$/.test(a[0] ?? '')) client.queue('block_pick_request', { x: +a[0], y: +a[1], z: +a[2], add_user_data: a[3] === 'data', selected_slot: inv.selected });
        else { const e = target(a[0]); if (!e) return say(`pick: no ${a[0]} in view`); client.queue('entity_pick_request', { runtime_entity_id: BigInt.asUintN(64, BigInt(e.uid ?? e.id)), selected_slot: inv.selected, with_data: false }); }   // despite the name, the unique id
        await ticks(6); await sync();
        return ticks(2);
      }
      case 'cmdblock': {  // cmdblock x y z [impulse|repeat|chain] [redstone|always] <command...>: edit a command block (creative + op)
        const pos = { x: +a[0], y: +a[1], z: +a[2] };
        let rest = a.slice(3);
        const mode = ['impulse', 'repeat', 'chain'].includes(rest[0]) ? rest.shift() : 'impulse';
        const needs = rest[0] === 'redstone' ? (rest.shift(), true) : rest[0] === 'always' ? (rest.shift(), false) : false;
        client.queue('command_block_update', { is_block: true, position: pos, mode, needs_redstone: needs, conditional: false, command: rest.join(' '), last_output: '', name: '', filtered_name: '', should_track_output: true, tick_delay: 0, execute_on_first_tick: true });
        return ticks(6);
      }
      case 'request': {   // request <actions json> [custom names json]: any ItemStackRequest; legacy bytes filled in
        // a slot without stack_id gets the one the client knows (hotbar/inventory/armor/offhand/cursor/screen slots)
        const fill = (si) => { if (!si || si.stack_id !== undefined) return si; const c = si.slot_type?.container_id, it = c === 'hotbar' || c === 'inventory' || c === 'hotbar_and_inventory' ? inv.slots[si.slot] : c === 'armor' ? inv.armor[si.slot] : c === 'offhand' ? inv.offhand[0] : c === 'cursor' ? inv.ui[0] : c === 'container' ? box?.slots[si.slot] : inv.ui[si.slot]; return { ...si, stack_id: netId(it?.stack_id) ?? 0 }; };
        await sync();
        const actions = JSON.parse(a[0]).map((x) => ({ legacy_type_id: LEGACY[x.type_id], ...x, ...(x.source ? { source: fill(x.source) } : {}), ...(x.destination ? { destination: fill(x.destination) } : {}) }));
        const id = reqId, r = waitResponse(id);
        stackReq(actions, a[1] ? JSON.parse(a.slice(1).join(' ')) : []);
        const st = await r;
        say(`request ${st}${lastResponse?.containers?.length ? ': ' + lastResponse.containers.map((c) => c.slot_type?.container_id + '[' + (c.slots ?? []).map((sl) => sl.slot + ':' + sl.count + '#' + sl.item_stack_id).join(' ') + ']').join(' ') : ''}`);
        await sync(); return ticks(2);
      }
      case 'raw': {       // raw <packet id> <payload hex>: send exact bytes (protocol experiments; `proto <Packet>` has the layout)
        const id = Number(a[0]), body = Buffer.from(a[1] ?? '', 'hex');
        const hdr = []; let v = id; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; hdr.push(b); } while (v);
        client.sendBuffer(Buffer.concat([Buffer.from(hdr), body]), true);
        return ticks(4);
      }
      case 'packet': {    // packet <name> <json>: send any packet as bedrock-protocol names it
        client.queue(a[0], JSON.parse(a.slice(1).join(' ') || '{}'));
        return ticks(4);
      }
      case 'option': {   // client settings the server can read: option graphics simple|fancy|advanced|raytraced | profanity on|off | touchhotbar on|off
        if (a[0] === 'graphics') { if (!(a[1] in GRAPHICS)) throw new Error('option graphics simple|fancy|advanced|raytraced'); client.queue('update_client_options', { graphics_mode: a[1] === 'raytraced' ? 'ray_traced' : a[1] }); }
        else if (a[0] === 'profanity') client.queue('update_client_options', { filter_profanity: a[1] === 'on' });
        else if (a[0] === 'autojump') autojump = a[1] !== 'off';
        else if (a[0] === 'touchhotbar') { if (a[1] === 'on') holdFlags.add('hotbar_only_touch'); else holdFlags.delete('hotbar_only_touch'); }   // inputInfo.touchOnlyAffectsHotbar
        else throw new Error('option graphics <mode> | option profanity on|off | option touchhotbar on|off | option autojump on|off');
        return ticks(4);
      }
      case 'take': case 'put': {
        if (!box) return say(`${action}: no container open (use open x y z)`);
        const from = num(a[0], 0);
        // furnaces name their slots: 0 ingredient, 1 fuel, 2 output (put <invSlot> [n] [ingredient|fuel])
        const furnace = /furnace|smoker/.test(box.type);
        const fslot = { ingredient: 0, fuel: 1, output: 2 };
        const fkind = (i) => ['furnace_ingredient', 'furnace_fuel', 'furnace_output'][i];
        const boxKind = (i) => (furnace ? fkind(i) : 'container');
        const [src, dst, srcKind, dstKind] = action === 'take' ? [box.slots, inv.slots, boxKind(from), 'hotbar_and_inventory'] : [inv.slots, box.slots, 'hotbar_and_inventory', null];
        const it = src[from];
        if (!it?.network_id) return say(`${action}: slot ${from} is empty`);
        const size = action === 'take' ? 36 : box.slots.length || 27;
        let to = -1;
        if (action === 'put' && furnace) to = fslot[a[2] ?? 'ingredient'] ?? 0;
        else for (let i = 0; i < size; i++) if (!dst[i]?.network_id) { to = i; break; }
        if (to < 0) return say(`${action}: no free slot`);
        const dk = dstKind ?? boxKind(to);
        const n = Math.min(num(a[1], it.count), it.count), what = iname(it).replace(/\*\d+$/, '');
        stackReq([{ type_id: 'place', legacy_type_id: 1, count: n, source: slotInfo(srcKind === 'hotbar_and_inventory' ? (from < 9 ? 'hotbar' : 'inventory') : srcKind, from, it), destination: slotInfo(dk, to, dst[to]?.network_id ? dst[to] : null) }]);
        await ticks(4); resync(); await ticks(4);
        return say(action === 'take' ? `took ${what}*${n} -> slot ${to}` : `put ${what}*${n} -> container slot ${to}`);
      }
      case 'craft': {
        // like a person: (inventory 2x2 or an open crafting table 3x3) put ingredients in the grid, craft, take the result
        const want = (a[0] ?? '').includes(':') ? a[0] : 'minecraft:' + a[0], times = num(a[1], 1);
        const table = box?.type === 'workbench';
        const gw = table ? 3 : 2, base = table ? 32 : 28;
        // the server's copy of the inventory first: a stack made by the last craft has the id the server gave it (a few ticks are
        // not enough on a busy or sped-up server, and a stale id gets the whole request rejected)
        await sync();
        await clearGrid();   // (anything left in the grid by an earlier refused craft: out first, or this craft is refused too)
        const outs = recipes.filter((r) => itemNames.get(r.out.id) === want);
        if (!outs.length) return say(`craft: no crafting recipe makes ${want}`);
        const have = inv.slots.map((it, i) => ({ i, it, name: itemNames.get(it?.network_id), left: it?.network_id ? it.count : 0 }));
        const tags = outs.some((r) => r.raw.some((g) => g.descriptor_type === 'item_tag')) && itemTags ? await itemTags([...new Set(have.filter((h) => h.name).map((h) => h.name))]) : {};
        const fits = (r) => (r.w ?? 1) <= gw && (r.h ?? 1) <= gw && r.raw.filter((g) => g.type === 'valid').length <= gw * gw;
        let plan = null, tooBig = false;
        for (const r of outs) {
          if (!fits(r)) { tooBig = true; continue; }
          const pool = have.map((h) => ({ ...h })), cells = [];
          const ok = r.raw.every((g, k) => {
            if (g.type !== 'valid') return true;
            const cell = r.shaped ? base + Math.floor(k / r.w) * gw + (k % r.w) : base + cells.length;
            const src = [];
            let need = (g.count || 1) * times;
            // one kind of item per grid cell (a cell holds one stack): for a tag (#planks) the first kind with enough of it for this cell
            const fitsG = (h) => h.left && (g.descriptor_type === 'item_tag' ? (tags[h.name] ?? []).includes(g.tag) : h.name === g.name);
            const kinds = [...new Set(pool.filter(fitsG).map((h) => h.name))];
            const kind = kinds.find((nm) => pool.filter((h) => h.name === nm && fitsG(h)).reduce((a, h) => a + h.left, 0) >= need) ?? kinds[0];
            for (const h of pool) {
              if (!need) break;
              if (!fitsG(h) || h.name !== kind) continue;
              const n = Math.min(need, h.left); h.left -= n; need -= n; src.push({ i: h.i, it: h.it, n });
            }
            cells.push({ cell, src, n: (g.count || 1) * times });
            return need === 0;
          });
          if (ok) { plan = { r, cells }; break; }
        }
        if (!plan) return say(tooBig && !table ? `craft: ${want} needs a crafting table (open x y z of one first)` : `craft: missing ingredients for ${want} (needs ${outs[0].ings.map((g) => `${g.count * times} ${g.tag ? '#' + g.tag : g.name}`).join(', ')})`);
        const total = plan.r.out.count * times;
        const usedUp = new Map();
        for (const c of plan.cells) for (const u of c.src) usedUp.set(u.i, (usedUp.get(u.i) ?? 0) + u.n);
        let free = [...Array(36).keys()].find((i) => !inv.slots[i]?.network_id || usedUp.get(i) === inv.slots[i].count);
        if (free === undefined) return say('craft: inventory full');
        let opened = false;
        if (!table) {
          box = null;
          client.queue('interact', { action_id: 'open_inventory', target_entity_id: rid, has_position: false });
          await boxWait();
          opened = true;
        }
        const shut = () => { if (opened && box) client.queue('container_close', { window_id: box.window, window_type: box.type, server: false }); if (opened) box = null; };
        const r1 = waitResponse(reqId);
        stackReq(plan.cells.flatMap((c) => c.src.map((u) => ({ type_id: 'place', legacy_type_id: 1, count: u.n, source: slotInfo(u.i < 9 ? 'hotbar' : 'inventory', u.i, u.it), destination: { slot_type: { container_id: 'crafting_input' }, slot: c.cell, stack_id: 0 } }))));
        const g1 = await r1;
        if (g1 !== 'ok') {
          shut(); await sync();
          if (!a.includes('again')) return bot.act('craft', [a[0], String(times), 'again']);   // once more with the ids just read
          return say('craft rejected (grid): ' + g1);
        }
        const ids = new Map();   // moved stacks get new ids: read them from the server's response
        for (const c of lastResponse?.containers ?? []) if (c.slot_type?.container_id === 'crafting_input') for (const sl of c.slots ?? []) ids.set(sl.slot, sl.item_stack_id);
        const o = plan.r.rawOut;
        // what an ingredient leaves behind (milk for a cake leaves the bucket, honey the bottle): the craft's second result, taken out
        // after the item itself (result 0, then result 1; not taken, the server refuses the whole craft: ResultTransferFailed)
        const REMAIN = { 'minecraft:milk_bucket': 'minecraft:bucket', 'minecraft:water_bucket': 'minecraft:bucket', 'minecraft:lava_bucket': 'minecraft:bucket', 'minecraft:powder_snow_bucket': 'minecraft:bucket', 'minecraft:honey_bottle': 'minecraft:glass_bottle', 'minecraft:dragon_breath': 'minecraft:glass_bottle' };
        let left = 0, leftName = null; for (const c of plan.cells) for (const u of c.src) { const nm2 = REMAIN[itemNames.get(u.it?.network_id)]; if (nm2) { left += u.n; leftName = nm2; } }
        const stacksTo = leftName === 'minecraft:glass_bottle' ? 16 : 1;   // (buckets do not stack: one slot each)
        const emptyAfter = [...Array(36).keys()].filter((i) => i !== free && (!inv.slots[i]?.network_id || usedUp.get(i) === inv.slots[i].count));
        const id2 = reqId, r2 = waitResponse(id2);
        const outSrc = { slot_type: { container_id: 'creative_output' }, slot: 50, stack_id: id2 };
        const leftovers = [];
        for (let k = left, j = 0; k > 0 && j < emptyAfter.length; j++) { const n = Math.min(k, stacksTo); leftovers.push({ type_id: 'place', legacy_type_id: 1, count: n, source: outSrc, destination: slotInfo('hotbar_and_inventory', emptyAfter[j], null) }); k -= n; }
        stackReq([
          { type_id: 'craft_recipe', legacy_type_id: 12, recipe_network_id: plan.r.net, times_crafted: times },
          { type_id: 'results_deprecated', legacy_type_id: 19, result_items: [resultsLegacy ? o : { type: 'name', legacy_type: 1, name: want, metadata: o.metadata ?? 0, count: o.count, block_runtime_id: o.block_runtime_id ?? 0, extra: { has_nbt: 0, can_place_on: [], can_destroy: [] } }], times_crafted: times },
          ...plan.cells.map((c) => ({ type_id: 'consume', legacy_type_id: 5, count: c.n, source: { slot_type: { container_id: 'crafting_input' }, slot: c.cell, stack_id: ids.get(c.cell) ?? 0 } })),
          ...(left ? [{ type_id: 'create', legacy_type_id: 6, result_slot_id: 0 }] : []),
          { type_id: 'place', legacy_type_id: 1, count: total, source: outSrc, destination: slotInfo('hotbar_and_inventory', free, null) },
          ...(left ? [{ type_id: 'create', legacy_type_id: 6, result_slot_id: 1 }, ...leftovers] : []),
        ]);
        const st = await r2;
        if (st !== 'ok') {   // refused: what went into the grid is taken back out (as a person drags it out) into empty slots of the
          // inventory as the server has it now, else dropped at the feet (picked up again): left in the grid, it stays there (the grid
          // is the player's own, whichever table) and every later craft is refused at the grid
          await sync();
          const empty = [...Array(36).keys()].filter((i) => !inv.slots[i]?.network_id);
          const cells = plan.cells.filter((c) => ids.get(c.cell) !== undefined);
          const src = (c) => ({ slot_type: { container_id: 'crafting_input' }, slot: c.cell, stack_id: ids.get(c.cell) });
          let back = 'none';
          if (cells.length && empty.length >= cells.length) { const r3 = waitResponse(reqId); stackReq(cells.map((c, j) => ({ type_id: 'place', legacy_type_id: 1, count: c.n, source: src(c), destination: slotInfo(empty[j] < 9 ? 'hotbar' : 'inventory', empty[j], null) }))); back = await r3; }
          if (cells.length && back !== 'ok') { const r4 = waitResponse(reqId); stackReq(cells.map((c) => ({ type_id: 'drop', legacy_type_id: 3, count: c.n, source: src(c), randomly: false }))); await r4; }
        }
        shut(); await sync();
        return say(st === 'ok' ? `crafted ${want}*${total} -> slot ${free}` : `craft rejected: ${st}`);
      }
      case 'close': {   // Esc: the top screen (chat, a form, else the open container)
        if (typing) { typing = false; if (!box && !form && !ddui) return ticks(1); }
        if (!box && ddui) { client.queue('serverbound_data_driven_screen_closed', { form_id: ddui.form, close_reason: 'ClientCanceled' }); ddui = null; return ticks(4); }
        if (!box && form) { client.queue('modal_form_response', { form_id: form.id, has_response_data: false, has_cancel_reason: true, cancel_reason: 'closed' }); form = null; return ticks(4); }
        // like the client: items left in a screen's own slots (anvil, enchanting, grindstone...) go back to the inventory first
        if (box && UI_SLOTS[box.type]) {
          await sync();
          for (const [c, slot] of UI_SLOTS[box.type]) {
            const it = inv.ui[slot];
            if (!it?.network_id) continue;
            const to = inv.slots.findIndex((x, i) => i < 36 && !x?.network_id);
            if (to < 0) { say(`close: inventory full, ${iname(it)} stays in the ${box.type}`); continue; }
            const r = waitResponse(reqId);
            stackReq([{ type_id: 'place', legacy_type_id: 1, count: it.count, source: { slot_type: { container_id: c }, slot, stack_id: netId(it.stack_id) ?? 0 }, destination: slotInfo(to < 9 ? 'hotbar' : 'inventory', to, null) }]);
            await r; await sync();
          }
        }
        if (box) client.queue('container_close', { window_id: box.window, window_type: box.type, server: false });
        box = null;
        return ticks(4);
      }
      case 'wake': client.queue('player_action', { runtime_entity_id: rid, action: 'stop_sleeping', position: { x: 0, y: 0, z: 0 }, result_position: { x: 0, y: 0, z: 0 }, face: 0 }); return ticks(4);   // "Leave Bed"
      case 'perm': {   // the op's player list: perm <player> visitor|member|operator|custom [flag...]
        const PF = ['build', 'mine', 'doors_and_switches', 'open_containers', 'attack_players', 'attack_mobs', 'operator', 'teleport'];
        const uid = a[0] === name ? myUid : players.get(a[0]), lvl = a[1] ?? 'member';
        if (uid == null) return say(`perm: no player ${a[0]} in the player list`);
        if (!['visitor', 'member', 'operator', 'custom'].includes(lvl) || a.slice(2).some((f) => !PF.includes(f))) return say(`perm <player> visitor|member|operator|custom [${PF.join(' ')}]`);
        const on = lvl === 'custom' ? a.slice(2) : { visitor: [], member: PF.slice(0, 6), operator: PF }[lvl];
        client.queue('request_permissions', { entity_unique_id: BigInt(uid), permission_level: lvl, requested_permissions: Object.fromEntries(on.map((f) => [f, true])) });
        return ticks(6);
      }
      case 'settings': {   // the world settings screen (op): settings gamemode|defaultmode <mode> | difficulty <d> | <gamerule> <value>
        const GM = { survival: 'survival', creative: 'creative', adventure: 'adventure', spectator: 'spectator', default: 'fallback' };
        if (a[0] === 'gamemode' || a[0] === 'defaultmode') {
          if (!GM[a[1]]) return say(`settings ${a[0]} survival|creative|adventure|spectator${a[0] === 'defaultmode' ? '' : '|default'}`);
          client.queue(a[0] === 'gamemode' ? 'set_player_game_type' : 'set_default_game_type', { gamemode: GM[a[1]] });
        } else if (a[0] === 'difficulty') {
          const d = ['peaceful', 'easy', 'normal', 'hard'].indexOf(a[1]);
          if (d < 0) return say('settings difficulty peaceful|easy|normal|hard');
          client.queue('set_difficulty', { difficulty: d });
        } else if (a.length === 2) client.queue('settings_command', { command_line: `/gamerule ${a[0]} ${a[1]}`, suppress_output: true });
        else return say('settings gamemode <m> | defaultmode <m> | difficulty <d> | <gamerule> <value>');
        return ticks(6);
      }
      case 'crafter': {   // crafter x y z <slot 0-8> [off|on]: click a grid slot in the crafter screen (disable it / enable it again)
        const at = { x: Math.floor(+a[0]), y: Math.floor(+a[1]), z: Math.floor(+a[2]) }, slot = num(a[3], -1);
        if (Object.values(at).some(Number.isNaN) || slot < 0 || slot > 8) return say('crafter x y z <slot 0-8> [off|on]');
        const opened = !box;
        if (opened) { await bot.act('open', a.slice(0, 3)); if (!box) return; }
        client.queue('toggle_crafter_slot_request', { position: at, slot, disabled: a[4] !== 'on' });
        await ticks(4);
        if (opened && box) { client.queue('container_close', { window_id: box.window, window_type: box.type, server: false }); box = null; }
        return ticks(2);
      }
      case 'structure': {   // structure x y z save|load|corner|data <name> [sx sy sz [ox oy oz]] [entities] [memory]: the structure block screen (op, creative), then Save / Load; saved as world structure <name>
        const at = { x: Math.floor(+a[0]), y: Math.floor(+a[1]), z: Math.floor(+a[2]) }, mode = a[3], nm = !a[4] ? '' : a[4].includes(':') ? a[4] : 'mystructure:' + a[4];   // the screen names it like /structure does
        const T = { data: 0, save: 1, load: 2, corner: 3 };
        if (Object.values(at).some(Number.isNaN) || !(mode in T)) return say('structure x y z save|load|corner|data <name> [sx sy sz [ox oy oz]] [entities]');
        const n = a.slice(5).filter((x) => /^-?\d+$/.test(x)).map(Number), flags = a.slice(5).filter((x) => !/^-?\d+$/.test(x));
        await bot.act('useon', [...a.slice(0, 3), '1']);   // opening the screen (op, creative)
        const settings = { palette_name: 'default', ignore_entities: !flags.includes('entities'), ignore_blocks: false, non_ticking_players_and_ticking_areas: false,
          size: n.length >= 3 ? { x: n[0], y: n[1], z: n[2] } : { x: 5, y: 5, z: 5 }, structure_offset: n.length >= 6 ? { x: n[3], y: n[4], z: n[5] } : { x: 0, y: -1, z: 0 },
          last_editing_player_unique_id: BigInt(myUid ?? 0), rotation: 'none', mirror: 'none', animation_mode: 'none', animation_duration: 0, integrity: 100, seed: 0, pivot: { x: 0, y: 0, z: 0 } };
        const upd = (trig) => client.queue('structure_block_update', { position: at, structure_name: nm, filtered_structure_name: undefined, data_field: '', include_players: false, show_bounding_box: true,
          structure_block_type: T[mode], settings, redstone_save_mode: flags.includes('memory') ? 0 : 1, should_trigger: trig, water_logged: false });
        upd(false); await ticks(2);   // the screen's fields, then the Save / Load button
        if (mode === 'load') { client.queue('structure_template_data_export_request', { name: nm, position: at, settings, request_type: 'query_saved_structure' }); await ticks(4); }
        if (mode === 'save' || mode === 'load') { upd(true); await ticks(4); }
        if (box?.type === 'structure_editor') { client.queue('container_close', { window_id: box.window, window_type: box.type, server: false }); box = null; }
        return ticks(6);
      }
      case 'swing': pulse.add('missed_swing'); swingArm('attack'); return ticks(4);   // left click on nothing: the client's GameMode::attack swings (source Attack) + MissedSwing
      case 'emote': client.queue('emote', { entity_id: rid, emote_id: a[0] ?? '4c8ae710-df2e-47cd-814d-cc7bf21a3d67', emote_length_ticks: 40, xuid: '', platform_id: '', flags: 'mute_chat' }); pulse.add('emoting'); return ticks(10);
      case 'inputmode': { const m = { mouse: 'mouse', touch: 'touch', gamepad: 'game_pad' }[a[0]]; if (!m) throw new Error('inputmode mouse|touch|gamepad'); inputMode = m; return ticks(4); }
      case 'fly': {
        const ask = (v) => client.queue('request_ability', { ability: 'flying', value_type: 'bool', bool_value: v, float_val: 0 });
        ask(true); pulse.add('start_flying'); flying = true; await ticks(2);
        await hold({ jump: true }, num(a[0], 10));   // rise, then keep hovering until `land`
        return ticks(4);
      }
      case 'land': client.queue('request_ability', { ability: 'flying', value_type: 'bool', bool_value: false, float_val: 0 }); pulse.add('stop_flying'); flying = false; return ticks(20);
      case 'glide': {
        // a real client starts gliding with a jump press while falling; the server then keeps it until landing
        gliding = true; controls.jump = true; pulse.add('start_gliding'); await ticks(1); controls.jump = false;
        for (let k = 0; k < 3; k++) { pulse.add('start_gliding'); await ticks(1); }
        return ticks(num(a[0], 20));
      }
      case 'swim': {
        // sprint forward under water; repeat the start flag until the server switches to swimming
        Object.assign(controls, { forward: true, sprint: true });
        for (let k = 0, n = num(a[0], 30); k < n; k++) { if (k < 10) pulse.add('start_swimming'); await ticks(1); }
        controls.forward = controls.sprint = false; pulse.add('stop_swimming'); return ticks(2);
      }
      case 'crawl': {     // crawl [on|off|ticks]: the server accepts crawling only while something covers the head (1-block gap,
        // closed trapdoor, block placed at head height) - like a real client, keep crawling until told to stand
        if (a[0] === 'off') { pulse.add('stop_crawling'); crawling = false; return ticks(2); }
        pulse.add('start_crawling'); crawling = true;
        if (a[0] === 'on' || a[0] === undefined) return ticks(4);
        await ticks(num(a[0], 20)); pulse.add('stop_crawling'); crawling = false; return ticks(2);
      }
      case 'dismount': {
        if (locks.dismount) return say('dismount: locked by the server (input permission Dismount)');
        if (vehicle !== null) client.queue('interact', { action_id: 'leave_vehicle', target_entity_id: vehicle, has_position: false });
        await hold({ sneak: true }, 4);
        return ticks(4);
      }
      case 'packsetting': {
        const [key, raw, pack] = a;
        let v; try { v = JSON.parse(raw); } catch { v = raw; }
        const type = typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'float' : Array.isArray(v) ? 'string_list' : 'string';
        // the uuid serializer writes each 8-byte half reversed (see fixUuid): pre-flip it so the server gets the real pack id
        client.queue('serverbound_pack_setting_change', { pack_id: fixUuid(pack ?? packId), pack_setting: { name: key, type, value: v } });
        return ticks(4);
      }
      case 'skin': {      // skin slim|wide [#rrggbb]: change skin in game (PlayerSkin; gametest getPlayerSkin shows armSize/skinColor)
        const arm = a[0], col = a[1] ? skinColor(a[1]) : null;
        if (!['slim', 'wide'].includes(arm)) throw new Error('skin slim|wide [#rrggbb]');
        const d = { ...req('minecraft-data')('bedrock_' + version).defaultSkin, ...loginData(opts), ArmSize: arm, ...(col ? { SkinColor: col } : {}) };
        const b64 = (x) => Buffer.from(x ?? '', 'base64'), argb = (c) => (c && c !== '#0' ? parseInt(c.slice(1).padStart(8, 'f'), 16) | 0 : 0);
        const img = (w, h, data) => ({ width: w, height: h, data: b64(data) });
        client.queue('player_skin', { uuid: fixUuid(client.profile?.uuid ?? ''), skin_name: '', old_skin_name: '', is_verified: true, skin: {
          skin_id: d.SkinId, play_fab_id: sid('playfab').replace(/-/g, '').slice(0, 16), skin_resource_pack: b64(d.SkinResourcePatch).toString(), skin_data: img(d.SkinImageWidth, d.SkinImageHeight, d.SkinData),
          animations: (d.AnimatedImageData ?? []).map((x) => ({ skin_image: img(x.ImageWidth, x.ImageHeight, x.Image), animation_type: x.Type, animation_frames: x.Frames, expression_type: x.AnimationExpression })),
          cape_data: img(0, 0, ''), geometry_data: b64(d.SkinGeometryData).toString(), geometry_data_version: b64(d.SkinGeometryDataEngineVersion).toString(), animation_data: b64(d.SkinAnimationData).toString(),
          cape_id: '', full_skin_id: d.SkinId + '-' + arm + (col ?? ''), arm_size: arm, skin_color: argb(d.SkinColor),
          personal_pieces: (d.PersonaPieces ?? []).map((x) => ({ piece_id: x.PieceId, piece_type: x.PieceType.replace(/^persona_/, ''), pack_id: fixUuid(x.PackId), is_default_piece: x.IsDefault, product_id: x.ProductId })),
          piece_tint_colors: (d.PieceTintColors ?? []).map((x) => ({ piece_type: x.PieceType.replace(/^persona_/, ''), colors: x.Colors.map(argb) })),
          premium: false, persona: !!d.PersonaSkin, cape_on_classic: false, primary_user: true, overriding_player_appearance: true, trusted: 'false', profile_hash: '' } });
        return ticks(6);
      }
      case 'message': {   // message <id> <text...>: the client's script message to the server (world.afterEvents.messageReceive)
        if (!a[0]) throw new Error('message <id> <text...>');
        client.queue('script_message', { message_id: a[0], data: a.slice(1).join(' ') });
        return ticks(4);
      }
      case 'watch': {     // watch on | off | <packet>[,<packet>...]: print the packets this client receives (`saw <packet> {json}`)
        watching = a[0] === 'off' ? null : !a[0] || a[0] === 'on' ? true : new Set(a.join(',').split(',').filter(Boolean));
        return ticks(1);
      }
      case 'npc': {       // npc <button index> | npc close: answer the NPC dialogue that is open (buttons run their commands as the player)
        if (!npc) throw new Error('npc: no NPC dialogue is open (interact with an NPC, or /dialogue open)');
        const rt = entities.has(String(npc.id)) ? String(npc.id) : [...uniq.entries()].find(([u]) => BigInt.asUintN(64, BigInt(u)) === BigInt.asUintN(64, BigInt(npc.id)))?.[1] ?? String(npc.id);
        const EDIT = { name: 'set_name', skin: 'set_skin', text: 'set_interaction_text', actions: 'set_actions' };
        if (EDIT[a[0]]) {   // the NPC editor (creative + op): npc name <text> | skin <index> | text <dialogue> | actions <json>
          if (!npc.editor) throw new Error('npc ' + a[0] + ': this is a dialogue, not the editor (creative + op: interact npc)');
          client.queue('npc_request', { runtime_entity_id: BigInt(rt), request_type: EDIT[a[0]], command: a[0] === 'skin' ? '' : a.slice(1).join(' '), action_index: a[0] === 'skin' ? num(a[1], 0) : 0, scene_name: '' });
          return ticks(6);
        }
        if (npc.editor && a[0] !== 'close') throw new Error('npc: the editor is open: npc name|skin|text|actions ... | npc close');
        if (a[0] === 'close') { client.queue('npc_request', { runtime_entity_id: BigInt(rt), request_type: 'execute_closing_commands', command: '', action_index: 0, scene_name: npc.scene }); npc = null; return ticks(10); }
        const i = num(a[0], 0);
        if (!npc.buttons[i]) throw new Error(`npc: button ${i} does not exist (${npc.buttons.length} buttons)`);
        client.queue('npc_request', { runtime_entity_id: BigInt(rt), request_type: 'execute_action', command: '', action_index: i, scene_name: npc.scene });
        return ticks(10);
      }
      // ---- inventory clicks a player makes without a drag-and-drop tool ----
      case 'quick': {     // quick <slot>: shift-click. Container open: between it and the inventory; else hotbar <-> main inventory
        if (!a[0]) throw new Error('quick <slot>: 0-35 | box:<n>');
        await sync();
        const src = slotRef(a[0]);
        if (!src.item?.network_id) return say(`quick: ${a[0]} is empty`);
        const fits = (it) => !it?.network_id || (it.network_id === src.item.network_id && it.count < 64);
        let order;
        if (/^box:/.test(a[0])) order = [...Array(9).keys(), ...Array.from({ length: 27 }, (_, k) => k + 9)].map(String);   // container -> hotbar, then inventory
        else if (box && !UI_SLOTS[box.type] && box.slots?.length) order = box.slots.map((_, k) => 'box:' + k);   // inventory -> the open container (chest, furnace ...)
        else order = +a[0] < 9 ? Array.from({ length: 27 }, (_, k) => String(k + 9)) : [...Array(9).keys()].map(String);   // hotbar <-> main
        const pickFrom = (list) => list.find((d) => { const it = slotRef(d).item; return it?.network_id === src.item.network_id && it.count < 64; }) ?? list.find((d) => fits(slotRef(d).item));
        const dst = order.length ? pickFrom(order) : null;
        if (!dst) return say('quick: no room');
        return bot.act('move', [a[0], dst]);
      }
      case 'split': {     // split <from> <to>: right-click a stack (half of it) and put it down
        if (a.length < 2) throw new Error('split <from> <to>');
        await sync();
        const it = slotRef(a[0]).item;
        if (!it?.network_id) return say(`split: ${a[0]} is empty`);
        return bot.act('move', [a[0], a[1], String(Math.ceil(it.count / 2))]);
      }
      case 'spread': {    // spread <from> <to,to,...>: drag a stack over slots (an even share each, the rest stays)
        if (a.length < 2) throw new Error('spread <from> <to,to,...>');
        await sync();
        const it = slotRef(a[0]).item, to = a[1].split(',').filter(Boolean);
        if (!it?.network_id) return say(`spread: ${a[0]} is empty`);
        const n = Math.floor(it.count / to.length);
        if (!n) return say(`spread: ${it.count} item(s) for ${to.length} slots`);
        for (const d of to) await bot.act('move', [a[0], d, String(n)]);
        return ticks(2);
      }
      case 'swap': {      // swap <a> <b>: pick up one stack, click it onto the other (they trade places)
        if (a.length < 2) throw new Error('swap <a> <b>');
        return bot.act('move', [a[0], a[1]]);
      }
      case 'hotbar': {    // hotbar next|prev: the mouse wheel / bumpers
        const step = a[0] === 'prev' ? 8 : 1;
        return bot.act('slot', [String((inv.selected + step) % 9)]);
      }
      // ---- looking, riding, blocks ----
      case 'turn': {      // turn <dyaw> <dpitch> [ticks]: move the mouse over several ticks (rotation changes tick by tick)
        const dy = num(a[0], 0), dp = num(a[1], 0), n = Math.max(1, num(a[2], 10));
        for (let k = 0; k < n; k++) { yaw += dy / n; pitch = Math.max(-90, Math.min(90, pitch + dp / n)); await ticks(1); }
        return ticks(1);
      }
      case 'ride': return bot.act('interact', a);   // ride [type|name]: get on (horse, boat, minecart, pig with saddle, camel, happy ghast...)
      case 'frame': {     // frame x y z: left-click an item frame: its item drops (ItemFrameDropItem)
        const b = a.length >= 3 ? { x: +a[0], y: +a[1], z: +a[2] } : (() => { const h = raycast(); return h?.kind === 'block' ? { x: h.x, y: h.y, z: h.z } : null; })();
        if (!b) throw new Error('frame x y z (or look at the frame)');
        lookAt({ x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 });
        swingArm('attack');
        send('item_frame_drop_item', { coordinates: b }, 'frame');
        return ticks(6);
      }
      case 'sleep': {     // sleep x y z: use a bed (night or thunder; the server says why not otherwise); wake gets up
        if (a.length < 3) throw new Error('sleep x y z (the bed)');
        await bot.act('useon', [a[0], a[1], a[2], 'up']);
        return ticks(10);
      }
      case 'render': {    // render <chunks>: change the render distance in the video settings (RequestChunkRadius)
        const n = Math.max(2, Math.min(96, num(a[0], 8)));
        send('request_chunk_radius', { chunk_radius: n, max_radius: n }, 'render');
        return ticks(10);
      }
      case 'serversettings': {   // the settings screen's server page: the server may answer with a form (Endstone / LSE plugins do)
        send('server_settings_request', {}, 'serversettings');
        for (let k = 0; k < 20 && !form?.settings; k++) await ticks(1);
        return form?.settings ? ticks(2) : say('serversettings: the server sent no settings form');
      }
      case 'target': {   // what the crosshair points at (as this client sees the world)
        const h = raycast();
        if (!h) return say('target none');
        if (h.kind === 'entity') return say(`target entity ${h.entity.name ?? h.entity.type} ${[h.entity.x, h.entity.y, h.entity.z].map((v) => v.toFixed(1)).join(' ')} dist ${h.t.toFixed(1)}`);
        const st = Object.entries(h.block.states).map(([k, v]) => `${k.replace('minecraft:', '')}=${v}`).join(',');
        return say(`target block ${h.block.name}${st ? '[' + st + ']' : ''} ${h.x} ${h.y} ${h.z} face ${FACE_NAMES[h.face]} at ${h.at.map((v) => +v.toFixed(2)).join(' ')} dist ${h.t.toFixed(1)}`);
      }
      case 'pos': { const f = feet(); return say(`pos ${f.x.toFixed(2)} ${f.y.toFixed(2)} ${f.z.toFixed(2)} yaw ${yaw.toFixed(0)} pitch ${pitch.toFixed(0)}`); }
      case 'near': return say('near ' + [...entities.values()].map((e) => `${e.name ?? e.type}@${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.z)}`).slice(0, 20).join(' '));
      case 'leave': bot.close(); return ticks(20);
      case 'actions': return say('actions ' + ACTIONS + ' | verbs ' + Object.keys(VERBS).join(' '));
      default: {
        if (VERBS[action]) return VERBS[action](a);
        // ~1000 names: suggest the nearest ones instead of printing them all (`@A actions` lists every one)
        const all = [...ACTIONS.split(' '), ...Object.keys(VERBS)];
        throw new Error(`unknown action ${action}. closest: ${closest(String(action), all).join(' ')} (${all.length} in all: @A actions | node lab.mjs help verbs <word>)`);
      }
    }
  };
  // everyday verbs (verbs.cjs): human sequences over the actions above
  const K = { act: (x, y) => bot.act(x, y), name, inv, itemNames, sync, ticks, say, controls, world, feet, box: () => box, dim: () => dim, yaw: () => yaw,
    look: (y, p) => { yaw = y; pitch = p; }, pitch: () => pitch, lookAt: (x, y, z) => lookAt({ x, y, z }), attrs: () => attrs, memo: new Map(),
    all: () => { const f = feet(); return [...entities.values()].sort((x, y) => Math.hypot(x.x - f.x, x.y - f.y, x.z - f.z) - Math.hypot(y.x - f.x, y.y - f.y, y.z - f.z)); },
    nearest: (q) => { const f = feet(); return [...entities.values()].filter((e) => isType(e, q)).sort((x, y) => Math.hypot(x.x - f.x, x.y - f.y, x.z - f.z) - Math.hypot(y.x - f.x, y.y - f.y, y.z - f.z)); },
    // (fast: no inventory round trip first - the weapon was taken in hand and checked before the fight; at 20x each check was
    // 10+ ticks between blows, half the blows a fight should have)
    hit: async (e, kind, fast = false) => { if (!fast) await sync(); hitTx(e, kind); return ticks(fast ? 1 : 4); },
    // v40: what the player knows (screen, sky, effect icons, hearts over a mob), read by the verbs; nothing here sends a packet
    mode: () => myMode, dead: () => dead, riding: () => vehicle !== null, lastDeath: () => deathPos, spawn: () => spawnPos, tick: () => tick,
    digPending: () => unconfirmed.size, digLag: () => digLag, digRefused: () => digRefused,   // blocks broken by this client's count, not yet confirmed
    lag: () => lag,
    hurtAt: () => selfHurtAt,   // the tick this player was last hurt (its flash)
    onFire: () => selfOnFire,   // burning (lava, fire, a flame arrow): the server's flag
    everyTick: (fn) => { tickFns.add(fn); return () => tickFns.delete(fn); },   // fn(tick) before each tick's input goes out
    pending: (x, y, z) => predicted.has(`${x},${y},${z}`),   // a block this client set down that the server has not yet answered for   // ticks to the server's answer (running mean)
    moving: () => Math.hypot(hvel.x, hvel.z) > 0.01 || fallV !== 0,   // still sliding or falling (the walk as this client predicts it)
    time: () => worldTime, timeTick: () => (clockPaused ? tick : worldTimeTick), weather: () => (thunder ? 'thunder' : rain ? 'rain' : 'clear'), players: () => [...players.keys()], offhand: () => inv.offhand[0], armor: () => inv.armor,
    effects: () => [...effects].filter(([, e]) => e.until > tick).map(([k, e]) => ({ name: k, amp: e.amp, secs: Math.round(Number(e.until - tick) / 20) })),
    screen: () => (box ? String(box.type) : form || ddui ? 'form' : npc ? 'npc' : signEditor ? 'sign' : typing ? 'chat' : ''),
    entityEvent: (e) => entEvents.get(String(e.id)), clearEntityEvent: (e) => entEvents.delete(String(e.id)), isType,
    canStand: (x, y, z) => stand(x, y, z), crosshair: () => { try { return raycast(); } catch { return null; } }, reach: (what) => reach(what),
    findBlocks: (test, o = {}) => world.find(test, { ...o, from: o.from ?? feet() }), eyePos: () => ({ ...pos }), inputMode: () => inputMode,
    enchantOptions: () => enchantOptions, trade: () => trade, bundles,
    // the crafting-table recipes the server sent, by item name: [{ count, shaped, w, h, ings: [{ name | tag, count }] }]
    recipesFor: (want) => recipes.filter((r) => itemNames.get(r.out.id) === want).map((r) => ({ count: r.out.count, shaped: r.shaped, w: r.w, h: r.h, ings: r.ings.map((g) => ({ name: g.name, tag: g.tag, count: g.count })) })),
    // every recipe the server sent (crafting grid, stonecutter, smithing), item names resolved: what `recipes_all` lists
    allRecipes: () => [
      ...recipes.map((r) => ({ station: 'crafting_table', out: itemNames.get(r.out.id), meta: r.rawOut?.metadata ?? 0, count: r.out.count, w: r.w ?? 0, h: r.h ?? 0, ings: r.ings.map((g) => ({ name: g.name, tag: g.tag, meta: g.meta ?? 0, count: g.count })) })),
      ...special.stonecutter.map((r) => ({ station: 'stonecutter', out: itemNames.get(r.out.network_id), meta: r.out.metadata ?? 0, count: r.out.count, w: 0, h: 0, ings: [r.input].flat().filter((g) => g?.type === 'valid').map((g) => ({ name: g.name, tag: g.tag, meta: g.metadata ?? 0, count: g.count || 1 })) })),
      ...special.smithing.filter((r) => !r.trim && r.out).map((r) => ({ station: 'smithing_table', out: itemNames.get(r.out.network_id), meta: 0, count: r.out.count ?? 1, w: 0, h: 0, ings: [r.tpl, r.base, r.add].filter((g) => g?.type === 'valid').map((g) => ({ name: g.name, tag: g.tag, meta: g.metadata ?? 0, count: 1 })) })),
    ] };
  const VERBS = makeVerbs(K);
  bot.close = () => { loop.stop(); try { client.close(); } catch { /* closed */ } };
  bot.state = () => big({ pos: feet(), yaw, pitch, dead });
  return bot;
}

module.exports = { createRealPlayer, describeForm, ACTIONS };
