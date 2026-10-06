#!/usr/bin/env node
// The real player's action logic without a server: bedrock-protocol is replaced by a recording client that answers like BDS
// does for the few replies an action waits for (spawn, inventory, item stack responses, settings form). What it proves: each
// action sends the packets a real client sends, in that order, with the right slots/values, and never throws when a packet
// is missing from the protocol table. What it cannot prove: that BDS accepts them (docs/coverage on a real BDS does that).
//   node tests/realplayer-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-offline-'));
const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(T, f)), { recursive: true }); fs.writeFileSync(path.join(T, f), s); };
put('package.json', '{"private":true}');
put('node_modules/prismarine-nbt/package.json', '{"name":"prismarine-nbt","main":"index.js"}');
put('node_modules/prismarine-nbt/index.js', 'exports.writeUncompressed = (x) => Buffer.from(JSON.stringify(x));');
put('node_modules/bedrock-protocol/package.json', '{"name":"bedrock-protocol","main":"index.js"}');
put('node_modules/bedrock-protocol/src/rak.js', 'module.exports = () => ({});');
// the recording client: queue() logs; packets listed in FAKE_MISSING throw like a serializer that does not know them
put('node_modules/bedrock-protocol/index.js', `
const { EventEmitter } = require('node:events');
exports.createClient = (o) => {
  const c = new EventEmitter();
  c.sent = []; c.profile = { uuid: '00112233-4455-6677-8899-aabbccddeeff' };
  const missing = new Set((process.env.FAKE_MISSING || '').split(',').filter(Boolean));
  c.queue = (n, p) => { if (missing.has(n)) throw new Error('SizeOf error for undefined : ' + n); c.sent.push([n, p]); c.emit('queued', n, p); };
  c.readPacket = () => {}; c.close = () => c.emit('close');
  globalThis.__fakeClient = c;
  setTimeout(() => { c.emit('start_game', { runtime_entity_id: 1n, entity_id: 1n, player_gamemode: 'survival', dimension: 'overworld' }); c.emit('spawn'); }, 5);
  return c;
};`);
// a small block table (what minecraft-data gives the real client): every block the catalog sets, plus the ground, so verbs
// that read the world (ripe crops, veins, a chest to open, a crafting table nearby) see blocks like on a server
const CATALOG_ALL = JSON.parse(fs.readFileSync(path.join(TOP, 'common', 'data', 'everyday.json'), 'utf8'));
const CATALOG = CATALOG_ALL.verbs, FAMILIES = CATALOG_ALL.families ?? {};
const parseBlock = (s) => { const m = /^([\w:]+)(?:\[(.*)\])?$/.exec(s); const st = {}; for (const kv of (m[2] ?? '').split(',').filter(Boolean)) { const [k, v] = kv.split('=').map((x) => x.trim().replace(/^"|"$/g, '')); st[k] = v === 'true' || v === 'false' ? { type: 'byte', value: v === 'true' ? 1 : 0 } : /^-?\d+$/.test(v) ? { type: 'int', value: +v } : { type: 'string', value: v }; } return { name: m[1].replace(/^minecraft:/, ''), states: st }; };
const FAKE_BLOCKS = [...new Map(['air', 'grass_block', 'dirt', 'stone', 'crafting_table', 'furnace', ...Object.values(CATALOG).flatMap((e) => Object.values(e.blocks ?? {})), ...Object.values(FAMILIES).flatMap((f) => f.samples.flatMap((x) => Object.values(x.blocks ?? {})))].map((s) => { const b = parseBlock(s); return [JSON.stringify(b), b]; })).values()];
const NOT_SOLID = /^(air|water|lava|fire|short_grass|fern|poppy|dandelion|torch|lever|.*button|.*pressure_plate|trip_wire|wheat|carrots|potatoes|beetroot|reeds|sweet_berry_bush|cave_vines.*|oak_sapling|.*rail|redstone_wire|frame|standing_sign|standing_banner|candle|flower_pot)$/;
put('node_modules/minecraft-data/package.json', '{"name":"minecraft-data","main":"index.js"}');
put('node_modules/minecraft-data/index.js', `const S = ${JSON.stringify(FAKE_BLOCKS)}; const solid = ${NOT_SOLID};
module.exports = () => ({ blockStates: S, blockCollisionShapes: { blocks: Object.fromEntries(S.map((s) => [s.name, [solid.test(s.name) ? 0 : 1]])), shapes: { 0: [], 1: [[0, 0, 0, 1, 1, 1]] } }, entitiesArray: [] });`);
// the runtime id the client derives for a block (FNV-1a of its NBT; the fake prismarine-nbt writes JSON)
const blockId = (b) => { let h = 0x811c9dc5; for (const c of Buffer.from(JSON.stringify({ type: 'compound', name: '', value: { name: { type: 'string', value: 'minecraft:' + b.name }, states: { type: 'compound', value: b.states } } }))) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h | 0; };
const req = createRequire(path.join(T, 'package.json'));
const { createRealPlayer } = createRequire(import.meta.url)(path.join(TOP, 'common', 'realplayer.cjs'));

let good = 0, bad = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✔' : '✘'} ${what}${ok || !detail ? '' : '\n    ' + String(detail).slice(0, 600)}`); ok ? good++ : bad++; };
const lines = [];
const bot = await createRealPlayer({ req, port: 1, name: 'A', version: '1.26.50', emit: (l) => lines.push(l), timeoutMs: 3000 });
const C = globalThis.__fakeClient;
const sent = (n) => C.sent.filter(([k]) => k === n).map(([, p]) => p);
const since = (k) => C.sent.slice(k);
const item = (id, count, sid) => ({ network_id: id, count, stack_id: sid, metadata: 0, block_runtime_id: 0, extra: {} });

// BDS side: inventory content after a mismatch resync, ok for every stack request, a settings form on request
C.emit('item_registry', { itemstates: [{ runtime_id: 5, name: 'minecraft:dirt' }, { runtime_id: 6, name: 'minecraft:stone' }, { runtime_id: 7, name: 'minecraft:filled_map' }] });
let slots = Array.from({ length: 36 }, () => ({ network_id: 0 }));
slots[0] = item(5, 32, 11); slots[1] = item(6, 10, 12);
const pushInv = () => C.emit('inventory_content', { window_id: 'inventory', input: slots });
C.on('queued', (n, p) => {
  if (n === 'inventory_transaction' && p.transaction?.transaction_type === 'inventory_mismatch') setTimeout(pushInv, 2);
  if (n === 'item_stack_request') for (const r of p.requests) setTimeout(() => C.emit('item_stack_response', { responses: [{ status: 'ok', request_id: r.request_id, containers: [] }] }), 2);
  if (n === 'interact' && p.action_id === 'open_inventory') setTimeout(() => C.emit('container_open', { window_id: 'inventory', window_type: 'inventory', coordinates: { x: 0, y: 0, z: 0 } }), 2);
  if (n === 'server_settings_request') setTimeout(() => C.emit('server_settings_response', { form_id: 77, data: JSON.stringify({ type: 'custom_form', title: 'Server', content: [{ type: 'toggle', text: 'PvP' }] }) }), 2);
});
pushInv();
await new Promise((r) => setTimeout(r, 700));

check(lines.some((l) => /^@A joined/.test(l)), 'join: spawned', lines.join('\n'));
const el = sent('emote_list')[0];
check(!!el && el.emote_pieces.length === 4 && String(el.player_id) === '1', 'automatic: EmoteList after spawn (equipped emotes)', JSON.stringify(el, (k, v) => typeof v === 'bigint' ? String(v) : v));

// quick (shift-click): hotbar 0 -> first free main slot 9
let k = C.sent.length;
await bot.act('quick', ['0']);
const q = since(k).filter(([n]) => n === 'item_stack_request').map(([, p]) => p.requests[0].actions[0]);
check(q.length === 1 && q[0].type_id === 'place' && q[0].count === 32 && q[0].source.slot === 0 && q[0].destination.slot === 9 && q[0].destination.slot_type.container_id === 'inventory',
  'quick 0: the whole stack, hotbar -> first free inventory slot (place 32 → 9)', JSON.stringify(q));
// split: half of 10 stone = 5
k = C.sent.length;
await bot.act('split', ['1', '20']);
const sp = since(k).filter(([n]) => n === 'item_stack_request').map(([, p]) => p.requests[0].actions[0]);
check(sp.length === 1 && sp[0].count === 5 && sp[0].destination.slot === 20, 'split 1 20: half the stack (5 of 10)', JSON.stringify(sp));
// spread: 10 over 3 slots = 3 each
k = C.sent.length;
await bot.act('spread', ['1', '21,22,23']);
const sd = since(k).filter(([n]) => n === 'item_stack_request').map(([, p]) => p.requests[0].actions[0]);
check(sd.length === 3 && sd.every((x) => x.count === 3) && sd.map((x) => x.destination.slot).join() === '21,22,23', 'spread 1 21,22,23: an even share each (3+3+3)', JSON.stringify(sd));
// swap: two different stacks trade places
k = C.sent.length;
await bot.act('swap', ['0', '1']);
const sw = since(k).filter(([n]) => n === 'item_stack_request').map(([, p]) => p.requests[0].actions[0]);
check(sw.length === 1 && sw[0].type_id === 'swap', 'swap 0 1: a swap request', JSON.stringify(sw));
// hotbar wheel
k = C.sent.length;
await bot.act('hotbar', ['prev']);
const me = since(k).filter(([n]) => n === 'mob_equipment').map(([, p]) => p.selected_slot);
check(me.join() === '8', 'hotbar prev: wheel from slot 0 wraps to 8 (MobEquipment)', JSON.stringify(me));
// turn: rotation changes tick by tick in the auth input
k = C.sent.length;
await bot.act('turn', ['90', '0', '5']);
const yaws = [...new Set(since(k).filter(([n]) => n === 'player_auth_input').map(([, p]) => Math.round(p.yaw)))];
check(yaws.length >= 4 && Math.max(...yaws) === 90, 'turn 90 0 5: yaw sweeps over ticks to 90', JSON.stringify(yaws));
// render distance
k = C.sent.length;
await bot.act('render', ['12']);
const rc = sent('request_chunk_radius').at(-1);
check(rc?.chunk_radius === 12, 'render 12: RequestChunkRadius', JSON.stringify(rc));
// server settings page -> answered like a modal form
await bot.act('serversettings', []);
check(lines.some((l) => /^@A form settings custom_form/.test(l) || /^@A form settings/.test(l)), 'serversettings: the server page opens as a form', lines.slice(-3).join('\n'));
k = C.sent.length;
await bot.act('form', ['[true]']);
const fr = since(k).find(([n]) => n === 'modal_form_response')?.[1];
check(fr?.form_id === 77 && fr.data === '[true]', 'form [true]: the settings page is answered (ModalFormResponse 77)', JSON.stringify(fr));
// item frame
k = C.sent.length;
await bot.act('frame', ['3', '-60', '0']);
const fd = since(k).map(([n]) => n);
check(fd.includes('animate') && fd.includes('item_frame_drop_item'), 'frame 3 -60 0: swing + ItemFrameDropItem', fd.join(' '));
// boss bar: the client registers itself
C.emit('boss_event', { boss_entity_id: 99n, type: 'show_bar' });
const be = sent('boss_event').at(-1);
check(be?.type === 'register_player' && String(be.boss_entity_id) === '99', 'automatic: BossEvent RegisterPlayer when a boss bar shows', JSON.stringify(be, (x, v) => typeof v === 'bigint' ? String(v) : v));
// hovered entity: Interact MouseOverEntity once per change (entity right in front)
C.emit('add_entity', { runtime_id: 42n, unique_id: 42n, entity_type: 'minecraft:cow', position: { x: 0.5, y: -60, z: 2.5 }, metadata: [] });
await bot.act('lookat', ['0.5', '-59.2', '2.5']);
await new Promise((r) => setTimeout(r, 300));
const mo = sent('interact').filter((p) => p.action_id === 'mouse_over_entity');
check(mo.length === 1 && String(mo[0].target_entity_id) === '42' && mo[0].has_position, 'automatic: Interact MouseOverEntity when the crosshair lands on an entity (once)', JSON.stringify(mo, (x, v) => typeof v === 'bigint' ? String(v) : v));
// held filled map: MapInfoRequest once
slots[2] = { ...item(7, 1, 13), extra: { nbt: { nbt: { value: { map_uuid: { type: 'long', value: 1234n } } } } } };
pushInv();
await bot.act('slot', ['2']);
await new Promise((r) => setTimeout(r, 700));
const mr = sent('map_info_request');
check(mr.length === 1 && String(mr[0].map_id) === '1234', 'automatic: MapInfoRequest once for the held map', JSON.stringify(mr, (x, v) => typeof v === 'bigint' ? String(v) : v));

// ---- verbs (verbs.cjs): the human sequence over measured primitives ----
C.emit('item_registry', { itemstates: [{ runtime_id: 5, name: 'minecraft:dirt' }, { runtime_id: 6, name: 'minecraft:stone' }, { runtime_id: 7, name: 'minecraft:filled_map' },
  { runtime_id: 8, name: 'minecraft:iron_hoe' }, { runtime_id: 9, name: 'minecraft:iron_helmet' }, { runtime_id: 10, name: 'minecraft:wheat' }, { runtime_id: 11, name: 'minecraft:bow' }] });
slots = Array.from({ length: 36 }, () => ({ network_id: 0 }));
slots[0] = item(5, 32, 21); slots[3] = item(8, 1, 22); slots[15] = item(9, 1, 23); slots[16] = item(10, 8, 24); slots[17] = item(11, 1, 25);
pushInv(); await bot.act('slot', ['0']); await new Promise((r) => setTimeout(r, 300));
k = C.sent.length;
await bot.act('till', ['2', '-61', '0']);
let seq = since(k);
const sel = seq.filter(([n]) => n === 'mob_equipment').map(([, p]) => p.selected_slot), tx = seq.filter(([n, p]) => n === 'inventory_transaction' && p.transaction.transaction_type === 'item_use');
check(sel.includes(3) && tx.length >= 1 && tx[0][1].transaction.transaction_data.block_position.y === -61 && tx[0][1].transaction.transaction_data.face === 1,
  'till: hoe in hotbar 3 → hotbar key 3, then right click the top face', JSON.stringify(sel) + ' ' + JSON.stringify(tx.map(([, p]) => p.transaction.transaction_data.face)));
k = C.sent.length;
await bot.act('select', ['bow']);
const mv = since(k).filter(([n]) => n === 'item_stack_request').map(([, p]) => p.requests[0].actions[0]);
const sel2 = since(k).filter(([n]) => n === 'mob_equipment').map(([, p]) => p.selected_slot);
// (into an empty hotbar slot, then its key: the hoe in the selected slot stays in the hotbar)
check(mv.length === 1 && mv[0].source.slot === 17 && mv[0].destination.slot === 1 && sel2.at(-1) === 1, 'select bow: dragged from inventory 17 into the first empty hotbar slot, then its key', JSON.stringify(mv) + ' ' + JSON.stringify(sel2));
k = C.sent.length;
await bot.act('equip', ['iron_helmet']);
const eq = since(k).filter(([n]) => n === 'item_stack_request').map(([, p]) => p.requests[0].actions[0]);
check(eq.length === 1 && eq[0].source.slot === 15 && eq[0].destination.slot_type.container_id === 'armor' && eq[0].destination.slot === 0, 'equip iron_helmet: inventory 15 → armor head', JSON.stringify(eq));
C.emit('add_entity', { runtime_id: 51n, unique_id: 51n, entity_type: 'minecraft:cow', position: { x: 1.5, y: -60, z: 1.5 }, metadata: [] });
C.emit('add_entity', { runtime_id: 52n, unique_id: 52n, entity_type: 'minecraft:cow', position: { x: 2.5, y: -60, z: 1.5 }, metadata: [] });
await new Promise((r) => setTimeout(r, 200));
k = C.sent.length;
await bot.act('breed', ['cow', 'wheat']);
const fed = since(k).filter(([n, p]) => n === 'inventory_transaction' && p.transaction.transaction_type === 'item_use_on_entity').map(([, p]) => String(p.transaction.transaction_data.entity_runtime_id));
check(fed.length === 2 && new Set(fed).size === 2 && fed.every((x) => ['42', '51', '52'].includes(x)), 'breed cow wheat: two different cows fed (right click each)', JSON.stringify(fed));
k = C.sent.length;
await bot.act('bow', ['5']);
seq = since(k).map(([n, p]) => (n === 'inventory_transaction' ? p.transaction.transaction_type : n)).filter((n) => /item_use$|item_release/.test(n));
check(seq[0] === 'item_use' && seq.at(-1) === 'item_release', 'bow 5: draw (use) then let go (release)', seq.join(' '));
k = C.sent.length;
await bot.act('place', ['dirt', '4', '-60', '4']);
const pl = since(k).filter(([n, p]) => n === 'inventory_transaction' && p.transaction.transaction_type === 'item_use').map(([, p]) => p.transaction.transaction_data);
check(pl.length >= 1 && pl[0].block_position.y === -61 && pl[0].face === 1, 'place dirt 4 -60 4: clicks the top of the block below', JSON.stringify(pl[0]?.block_position));
// table verbs: same mechanisms, player's words
C.emit('item_registry', { itemstates: [{ runtime_id: 5, name: 'minecraft:dirt' }, { runtime_id: 12, name: 'minecraft:glass_bottle' }, { runtime_id: 13, name: 'minecraft:water_bucket' }, { runtime_id: 14, name: 'minecraft:potion' }] });
slots = Array.from({ length: 36 }, () => ({ network_id: 0 }));
slots[0] = item(5, 3, 31); slots[20] = item(12, 1, 32); slots[21] = item(13, 1, 33); slots[22] = item(14, 1, 34);
pushInv(); await new Promise((r) => setTimeout(r, 200));
k = C.sent.length;
await bot.act('fill_bottle', ['1', '-61', '1']);
seq = since(k);
check(seq.some(([n, p]) => n === 'item_stack_request' && p.requests[0].actions[0].source.slot === 20) && seq.some(([n, p]) => n === 'inventory_transaction' && p.transaction.transaction_type === 'item_use'), 'fill_bottle: bottle brought to hand, then right click the water', seq.map(([n]) => n).join(' '));
k = C.sent.length;
await bot.act('door', ['2', '-60', '2']);
check(since(k).some(([n, p]) => n === 'inventory_transaction' && p.transaction.transaction_data?.block_position?.x === 2), 'door: a right click on the door block', '');
k = C.sent.length;
await bot.act('bucket_fish', ['cow']);
seq = since(k);
check(seq.some(([n, p]) => n === 'inventory_transaction' && p.transaction.transaction_type === 'item_use_on_entity'), 'bucket_fish: water bucket in hand, right click the mob', seq.map(([n]) => n).join(' '));
k = C.sent.length;
await bot.act('potion', ['4']);
seq = since(k).map(([n, p]) => (n === 'inventory_transaction' ? p.transaction.transaction_type : n)).filter((x) => /item_use$|item_release/.test(x));
check(seq[0] === 'item_use' && seq.at(-1) === 'item_release', 'potion: drink (hold, then release)', seq.join(' '));
k = C.sent.length;
await bot.act('run', ['6']);
const fl = since(k).filter(([n]) => n === 'player_auth_input').map(([, p]) => JSON.stringify(p.input_data));
check(fl.some((f) => /sprint/.test(f) && /up/.test(f)), 'run: forward + sprint keys held', fl.slice(0, 2).join(' '));
C.emit('play_status', { status: 'failed_client' });
check(lines.some((l) => /@A refused: failed_client \(this client is older than the server\)/.test(l)), 'join version=: an outdated protocol is shown as refused (like a real client)', lines.slice(-2).join('\n'));
let err = null; try { await bot.act('fly_to_moon', []); } catch (e) { err = e.message; }
check(/^unknown action fly_to_moon\. closest: (\S+ ){3,}.*\bfly/.test(err ?? '') && /\d{3,} in all: @A actions/.test(err ?? '') && (err ?? '').length < 400,
  'unknown action: the nearest names (not all ~1000), and where the full list is', err);
lines.length = 0; await bot.act('actions', []);
{ const al = lines.find((l) => /^@A actions /.test(l)) ?? '', [acts, verbs] = al.replace('@A actions ', '').split(' | verbs ');
  const clash = verbs?.split(' ').filter((v) => acts.split(' ').includes(v)) ?? ['?'];
  check(!clash.length && acts.split(' ').length > 80, `actions: no verb hides behind a primitive of the same name (${acts.split(' ').length} primitives)`, 'shadowed: ' + clash.join(' ')); }
bot.close();

// NetherNet join without the WebRTC stack: a clear refusal before anything is sent
{ let err = null; try { await createRealPlayer({ req, port: 1, name: 'N', version: '1.26.50', emit: () => {}, opts: { transport: 'nethernet' } }); } catch (e) { err = e.message; }
  check(/transport=nethernet: WebRTC \(node-datachannel\) is not installed/.test(err ?? ''), 'join transport=nethernet without node-datachannel: says what is missing', err); }
// NetherNet-only join options are checked before anything is sent
for (const [opts, re, what] of [[{ identity: 'strict' }, /identity=: NetherNet options \(the server runs raknet/, 'identity= on a raknet server: says it is a NetherNet option'],
  [{ transport: 'nethernet', identity: 'maybe' }, /identity=maybe: verify\|strict\|warn\|off/, 'identity=<typo>: the valid values'],
  [{ transport: 'nethernet', key: 'xyz' }, /key=xyz: the 16 hex digits/, 'key=<not a pin>: what a pin looks like'],
  [{ transport: 'nethernet', ca: '/no/such.pem' }, /ca=\/no\/such.pem: no such file/, 'ca=<missing file>: refused']]) {
  let err = null; try { await createRealPlayer({ req, port: 1, name: 'O', version: '1.26.50', emit: () => {}, opts: { ...opts } }); } catch (e) { err = e.message; }
  check(re.test(err ?? ''), 'join ' + what, err);
}
// a protocol table without some packets: actions say so, automatic ones go quiet, nothing throws
process.env.FAKE_MISSING = 'item_frame_drop_item,emote_list,request_chunk_radius';
const lines2 = [];
const bot2 = await createRealPlayer({ req, port: 1, name: 'B', version: '1.26.50', emit: (l) => lines2.push(l), timeoutMs: 3000 });
await new Promise((r) => setTimeout(r, 300));
let threw = null;
try { await bot2.act('frame', ['1', '2', '3']); await bot2.act('render', ['8']); } catch (e) { threw = e; }
check(!threw && lines2.some((l) => /frame: this protocol cannot send item_frame_drop_item/.test(l)) && lines2.some((l) => /render: this protocol cannot send/.test(l)), 'missing packets: the action says so instead of throwing', (threw?.stack ?? '') + lines2.join('\n'));
check(!lines2.some((l) => /emote_list/.test(l)), 'missing packets: automatic ones switch off quietly', lines2.join('\n'));
bot2.close();
delete process.env.FAKE_MISSING;

// ---- every everyday verb, from the catalog (common/data/everyday.json): the list and the code agree, and each one runs ----
// Parallel workers, each a recording client in a small world that answers like BDS where a verb waits for it: command output,
// the screen of a container block it clicks, a villager's offers, riding links, the sign editor after placing a sign, enchanting
// options, taming hearts, a few crafting recipes. Each verb gets the blocks and mobs its catalog entry names.
const W = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
{
  const cat = CATALOG;
  const { makeVerbs } = createRequire(import.meta.url)(path.join(TOP, 'common', 'verbs.cjs'));
  const code = Object.keys(makeVerbs({ itemNames: new Map(), controls: {}, inv: { slots: [] }, memo: new Map() }));
  // the generated verbs (one per item / block / mob): listed by family in the catalog, with their count
  const { genNames } = createRequire(import.meta.url)(path.join(TOP, 'common', 'verbs-gen.cjs'));
  const GEN = genNames(new Set(code.filter((v) => cat[v])));
  const genSet = new Set(GEN.map(([v]) => v)), perFam = {};
  for (const [, f] of GEN) perFam[f.prefix] = (perFam[f.prefix] ?? 0) + 1;
  const missing = code.filter((v) => !cat[v] && !genSet.has(v)), stale = Object.keys(cat).filter((v) => !code.includes(v)), lostGen = [...genSet].filter((v) => !code.includes(v));
  check(!missing.length && !stale.length && !lostGen.length, `catalog: all ${code.length} verbs listed (${Object.keys(cat).length} by name, ${genSet.size} by family), none extra (100%)`, `not in the catalog: ${missing.slice(0, 40).join(' ')} | no such verb: ${stale.join(' ')} | generated but missing: ${lostGen.slice(0, 20).join(' ')}`);
  const famWrong = Object.entries(FAMILIES).filter(([k, f]) => perFam[k.replace(/<\w+>$/, '')] !== f.count).map(([k, f]) => `${k}: catalog ${f.count}, code ${perFam[k.replace(/<\w+>$/, '')]}`);
  check(!famWrong.length && Object.keys(FAMILIES).length === Object.keys(perFam).length, `catalog: ${Object.keys(FAMILIES).length} families with the right counts (${code.length} verbs in all)`, famWrong.join(' | '));
  const noUse = Object.entries(cat).filter(([k, e]) => !e.use?.startsWith(k) || !e.ja || !e.cat).map(([k]) => k);
  check(!noUse.length, 'catalog: every verb has its syntax (use), a category and a Japanese line (ja)', noUse.join(' '));
  process.env.LAB_TICK_MS = '2';   // the same sequences, 25x faster against the recording client
  const SCREEN = { chest: 'container', trapped_chest: 'container', barrel: 'container', copper_chest: 'container', undyed_shulker_box: 'container', ender_chest: 'container', furnace: 'furnace', smoker: 'smoker',
    blast_furnace: 'blast_furnace', brewing_stand: 'brewing_stand', hopper: 'hopper', dispenser: 'dispenser', dropper: 'dropper', crafter: 'crafter', crafting_table: 'workbench', enchanting_table: 'enchantment',
    anvil: 'anvil', grindstone: 'grindstone', stonecutter_block: 'stonecutter', loom: 'loom', cartography_table: 'cartography', smithing_table: 'smithing_table', beacon: 'beacon', lectern: 'lectern', command_block: 'command_block' };
  const SLOTS = { container: 27, furnace: 3, smoker: 3, blast_furnace: 3, brewing_stand: 5, hopper: 5, dispenser: 9, dropper: 9, crafter: 9 };
  const RIDES = /:(horse|donkey|mule|llama|trader_llama|pig|strider|camel|camel_husk|skeleton_horse|zombie_horse|happy_ghast|nautilus|zombie_nautilus|boat|chest_boat|minecart|cushion)$/;
  const TAMES = /:(wolf|cat|ocelot|parrot|nautilus|zombie_nautilus)$/;
  const OPENS = { 'minecraft:chest_minecart': 'minecart_chest', 'minecraft:hopper_minecart': 'minecart_hopper', 'minecraft:chest_boat': 'chest_boat' };
  const names = [...new Set([...Object.values(cat).flatMap((e) => e.items), 'oak_log', 'oak_planks', 'stick', 'crafting_table', 'coal', 'torch', 'wooden_pickaxe', 'emerald', 'bread', 'wheat', 'apple', 'zombie'])];
  const idOf = (nm) => 100 + names.indexOf(nm);
  const ing = (nm) => (nm ? { type: 'valid', descriptor_type: 'name', name: 'minecraft:' + nm, metadata: 0, count: 1 } : { type: 'invalid' });
  const out = (nm, count) => [{ network_id: idOf(nm), count, metadata: 0, block_runtime_id: 0, extra: { has_nbt: 0, can_place_on: [], can_destroy: [] } }];
  const CRAFTING = { shaped_recipes: [
    { recipe_id: 'stick', width: 1, height: 2, input: [ing('oak_planks'), ing('oak_planks')], output: out('stick', 4), block: 'crafting_table', network_id: 2 },
    { recipe_id: 'crafting_table', width: 2, height: 2, input: [ing('oak_planks'), ing('oak_planks'), ing('oak_planks'), ing('oak_planks')], output: out('crafting_table', 1), block: 'crafting_table', network_id: 3 },
    { recipe_id: 'torch', width: 1, height: 2, input: [ing('coal'), ing('stick')], output: out('torch', 4), block: 'crafting_table', network_id: 4 },
    { recipe_id: 'wooden_pickaxe', width: 3, height: 3, input: [ing('oak_planks'), ing('oak_planks'), ing('oak_planks'), ing(), ing('stick'), ing(), ing(), ing('stick'), ing()], output: out('wooden_pickaxe', 1), block: 'crafting_table', network_id: 5 }],
    shapeless_recipes: [{ recipe_id: 'oak_planks', input: [ing('oak_log')], output: out('oak_planks', 4), block: 'crafting_table', network_id: 1 }] };
  const OFFERS = { Recipes: [{ buyA: { Name: 'minecraft:emerald', Count: 1 }, sell: { Name: 'minecraft:bread', Count: 6 }, uses: 0, maxUses: 12, netId: 7 }, { buyA: { Name: 'minecraft:wheat', Count: 20 }, sell: { Name: 'minecraft:emerald', Count: 1 }, uses: 0, maxUses: 16, netId: 8 }] };
  const base = (y) => ({ name: y <= -62 ? 'dirt' : y === -61 ? 'grass_block' : 'air', states: {} });
  async function worker(entries) {
    const lines = [];
    const p = createRealPlayer({ req, port: 1, name: 'V', version: '1.26.50', emit: (l) => lines.push(l), timeoutMs: 3000 });
    const C = globalThis.__fakeClient;   // set synchronously by createClient, before any other worker runs
    const bot = await p;
    let inv = [], win = 10, nextId = 500, rider = null;
    const ents = new Map(), world = new Map();
    const push = () => C.emit('inventory_content', { window_id: 'inventory', input: inv });
    const paint = (x, y, z, b) => { world.set(`${x},${y},${z}`, b.name); C.emit('update_block', { position: { x, y, z }, block_runtime_id: blockId(b), layer: 0, flags: 0 }); };
    const spawn = (type, x, z) => { const id = BigInt(++nextId); ents.set(String(id), 'minecraft:' + type.replace(/^villager$/, 'villager_v2')); C.emit('add_entity', { runtime_id: id, unique_id: id, entity_type: 'minecraft:' + type, position: { x, y: -60, z }, metadata: [] }); return id; };
    const reply = (n, p) => setTimeout(() => C.emit(n, p), 1);
    C.emit('item_registry', { itemstates: names.map((nm) => ({ runtime_id: idOf(nm), name: 'minecraft:' + nm })) });
    C.emit('crafting_data', CRAFTING);
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) for (let y = -62; y <= -57; y++) paint(x, y, z, base(y));
    for (const [t, x] of [['cow', 1.5], ['cow', 2.5], ['sheep', 3.5], ['wolf', 0.5], ['villager', -1.5], ['armor_stand', -2.5]]) spawn(t, x, 1.5);
    // server-authoritative movement, flat: the keys and stick move the player (walk 0.216 b/tick, sprint 0.28, sneak 0.065), the
    // server's position comes back as a correction (only the position, like correct_player_move_prediction does)
    const at = { x: 0.5, z: 0.5 }, told = { x: 0.5, z: 0.5 };   // told: where the client last said it is (a boat seat moves it too)
    C.on('queued', (n, p) => {
      if (n === 'player_auth_input' && p.position) { told.x = p.position.x; told.z = p.position.z; }
      if (n === 'player_auth_input' && p.move_vector && (p.move_vector.x || p.move_vector.z)) {
        const f = JSON.stringify(p.input_data), v = /sprinting/.test(f) ? 0.28 : /sneaking/.test(f) ? 0.065 : 0.216, r = (p.yaw * Math.PI) / 180, len = Math.hypot(p.move_vector.x, p.move_vector.z);
        at.x = Math.max(-5.5, Math.min(5.5, at.x + (v * (-Math.sin(r) * p.move_vector.z + Math.cos(r) * p.move_vector.x)) / Math.max(1, len)));
        at.z = Math.max(-5.5, Math.min(5.5, at.z + (v * (Math.cos(r) * p.move_vector.z + Math.sin(r) * p.move_vector.x)) / Math.max(1, len)));
        C.emit('correct_player_move_prediction', { prediction_type: 'player', position: { x: at.x, y: -60 + 1.62, z: at.z }, delta: { x: 0, y: 0, z: 0 }, on_ground: true, tick: p.tick });
      }
      if (n === 'inventory_transaction' && p.transaction?.transaction_type === 'inventory_mismatch') setTimeout(push, 1);
      // a hit on a block: the break speed, as BDS says it (level_event block_start_break, 65535 / ticks: here 1 tick, a very soft
      // block); the block breaks when the client says it predicted the break, and a held block item clicked on a face goes into
      // the cell on that side (only the few the goal verbs set down)
      if (n === 'player_auth_input') for (const b of p.block_action ?? []) if (b.action === 'start_break' && world.has(`${b.position.x},${b.position.y},${b.position.z}`)) reply('level_event', { event: 'block_start_break', position: { ...b.position }, data: 65535 });
      if (n === 'player_auth_input') for (const b of p.block_action ?? []) if (b.action === 'predict_break' && world.has(`${b.position.x},${b.position.y},${b.position.z}`)) paint(b.position.x, b.position.y, b.position.z, { name: 'air', states: {} });
      if (n === 'item_stack_request') for (const r of p.requests) {
        reply('item_stack_response', { responses: [{ status: 'ok', request_id: r.request_id, containers: [] }] });
        // a crafting-table recipe: its result lands where the client put it (the ingredients are left alone)
        const cr = r.actions.find((a) => a.type_id === 'craft_recipe'), rec = [...CRAFTING.shaped_recipes, ...CRAFTING.shapeless_recipes].find((x) => x.network_id === cr?.recipe_network_id);
        const to = r.actions.find((a) => a.type_id === 'place' && a.source?.slot_type?.container_id === 'creative_output')?.destination;
        if (rec && to && /hotbar|inventory/.test(to.slot_type?.container_id)) inv[to.slot] = item(rec.output[0].network_id, rec.output[0].count * (cr.times_crafted || 1), 3000 + to.slot);
        if (r.actions.some((a) => a.destination?.slot_type?.container_id === 'enchanting_input')) reply('player_enchant_options', { options: [0, 1, 2].map((k) => ({ cost: k + 1, option_id: k + 1, name: 'lab ', equip_enchants: [], held_enchants: [{ id: 9, level: k + 1 }], self_enchants: [] })) });
      }
      if (n === 'interact' && p.action_id === 'open_inventory') reply('container_open', { window_id: 'inventory', window_type: 'inventory', coordinates: { x: 0, y: 0, z: 0 } });
      if (n === 'interact' && p.action_id === 'leave_vehicle' && rider !== null) { reply('set_entity_link', { link: { ridden_entity_id: rider, rider_entity_id: 1n, type: 'remove' } }); rider = null; }
      if (n === 'command_request') reply('command_output', { origin: { uuid: p.origin.uuid }, output: [{ success: true, message_id: 'commands.lab.ok', parameters: [] }] });
      const d = p.transaction?.transaction_data;
      if (n === 'inventory_transaction' && p.transaction.transaction_type === 'item_use' && d?.action_type === 'click_block') {
        const b = d.block_position, blk = world.get(`${b.x},${b.y},${b.z}`), scr = SCREEN[blk], held = names[(d.held_item?.network_id ?? 0) - 100] ?? '';
        if (/^(crafting_table|furnace|dirt)$/.test(held) && !scr) { const f = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][d.face] ?? [0, 1, 0]; setTimeout(() => paint(b.x + f[0], b.y + f[1], b.z + f[2], { name: held, states: {} }), 1); }
        if (scr && !/_sign$/.test(held)) { const w = ++win; reply('container_open', { window_id: w, window_type: scr, coordinates: b }); if (SLOTS[scr]) reply('inventory_content', { window_id: w, input: Array.from({ length: SLOTS[scr] }, () => ({ network_id: 0 })) }); }
        if (/_sign$/.test(held)) { const f = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][d.face] ?? [0, 1, 0]; reply('open_sign', { position: { x: b.x + f[0], y: b.y + f[1], z: b.z + f[2] }, is_front: true }); }
      }
      if (n === 'inventory_transaction' && p.transaction.transaction_type === 'item_use_on_entity' && d?.action_type === 'interact') {
        const t = ents.get(String(d.entity_runtime_id)) ?? '';
        if (/villager/.test(t)) reply('update_trade', { window_id: ++win, offers: OFFERS });
        if (OPENS[t]) reply('container_open', { window_id: ++win, window_type: OPENS[t], coordinates: { x: 0, y: 0, z: 0 } });
        else if (RIDES.test(t) && rider === null) { rider = BigInt(d.entity_runtime_id); reply('set_entity_link', { link: { ridden_entity_id: rider, rider_entity_id: 1n, type: 'rider' } }); }
        if (TAMES.test(t)) reply('entity_event', { runtime_entity_id: d.entity_runtime_id, event_id: 'tame_success', data: 0 });
      }
    });
    await W.sleep(50);
    const res = [];
    for (const [verb, e] of entries) {
      inv = Array.from({ length: 36 }, () => ({ network_id: 0 }));
      e.items.forEach((nm, i) => { inv[9 + i] = item(idOf(nm), 16, 1000 + i); });   // deep in the inventory: the verb fetches it like a person
      push(); await bot.act('slot', ['0']);
      if (Math.hypot(at.x - 0.5, at.z - 0.5) > 0.01 || Math.hypot(told.x - 0.5, told.z - 0.5) > 0.01) { at.x = 0.5; at.z = 0.5; C.emit('correct_player_move_prediction', { prediction_type: 'player', position: { x: 0.5, y: -60 + 1.62, z: 0.5 }, delta: { x: 0, y: 0, z: 0 }, on_ground: true, tick: 0n }); }
      await bot.act('look', ['0', '0']);
      const painted = Object.entries(e.blocks ?? {}).map(([k, s]) => { const [x, y, z] = k.split(' ').map(Number); paint(x, y, z, parseBlock(s)); return [x, y, z]; });
      const mobs = (e.mobs ?? []).map((t, i) => spawn(t, 0.5 + i, 2.5));
      await W.sleep(15);
      const before = C.sent.length, l0 = lines.length;
      let err = null;
      try { await Promise.race([bot.act(verb, e.args), new Promise((_, j) => setTimeout(() => j(new Error('timed out (20 s)')), 20000))]); } catch (x) { err = x.message; }
      try { await bot.act('stop', []); await bot.act('close', []); if (rider !== null) { C.emit('set_entity_link', { link: { ridden_entity_id: rider, rider_entity_id: 1n, type: 'remove' } }); rider = null; } } catch { /* next */ }
      // did something: a packet besides the per-tick input, a line, or the input itself changed (keys, look, stick)
      const ai = C.sent.slice(0, before).filter(([k]) => k === 'player_auth_input').at(-1)?.[1], sig = (q) => q && JSON.stringify([Math.round(q.yaw), Math.round(q.pitch), q.input_data, q.move_vector]);
      const acted = C.sent.slice(before).some(([k, q]) => k !== 'player_auth_input' || sig(q) !== sig(ai)) || lines.length > l0;
      res.push({ verb, e, err, acted, said: lines.slice(l0).filter((l) => /^@V /.test(l)) });
      for (const [x, y, z] of painted) paint(x, y, z, base(y));
      for (const id of mobs) { ents.delete(String(id)); C.emit('remove_entity', { entity_id_self: id }); }
    }
    bot.close();
    return { res, lines };
  }
  const t0 = Date.now(), N = 6, parts = Array.from({ length: N }, () => []);
  const samples = Object.values(FAMILIES).flatMap((f) => f.samples.map((x) => [x.verb, { cat: f.cat, args: x.args, items: x.items ?? [], blocks: x.blocks, mobs: x.mobs }]));
  [...Object.entries(cat), ...samples].forEach((x, i) => parts[i % N].push(x));
  const done = await Promise.all(parts.map((p) => worker(p)));
  const all = done.flatMap((d) => d.res), fails = all.filter((r) => r.err || !r.acted), byCat = {};
  for (const r of all) byCat[r.e.cat] = (byCat[r.e.cat] ?? 0) + (r.err ? 0 : 1);
  check(!fails.length, `every verb runs with its catalog args and does something: ${all.length - fails.length}/${all.length} in ${((Date.now() - t0) / 1000).toFixed(0)} s (${Object.entries(byCat).map(([k, v]) => k + ' ' + v).join(', ')})`, fails.map((r) => `${r.verb} ${r.e.args.join(' ')}: ${r.err ?? 'did nothing'}`).join('\n    '));
  const said = (v) => all.find((r) => r.verb === v)?.said.join(' | ') ?? '';
  check(/^@V mark home/.test(said('mark')) && /@V hp /.test(said('report')), 'mark / report: remembers a place and reports status (the AI reads these lines)', said('mark') + ' ' + said('report'));
  // the fake world is read like a real one: only the ripe crop is cut, a whole vein, a screen opened on the block given, a known table found
  const expectSaid = [['harvest_ripe', /harvest_ripe: 1 ripe/], ['vein_mine', /vein_mine: 3 blocks/], ['fell_tree', /fell_tree: 3 logs/], ['open_hopper', /open_hopper: open: hopper/], ['find', /find: crafting_table@3,-60,3/],
    ['goto_block', /crafting_table at 4 -60 4/], ['mine_only', /mine_only: 1 dirt/], ['breed_cow', /fed 2 cow/], ['tame_wolf', /tame_wolf: tamed after 1/], ['ride_horse', /ride_horse: riding/], ['held', /held: nothing|held: minecraft:/],
    ['tool_for', /tool_for: stone: iron_pickaxe/], ['best_weapon', /best_weapon: diamond_sword/], ['make_torches', /made torch/], ['make_sticks', /made stick/], ['trade_all', /trade_all: \d+ trades/], ['enchant_item', /enchanted: lab/], ['write_sign', /./]];
  const wrong = expectSaid.filter(([v, re]) => !re.test(said(v))).map(([v, re]) => `${v}: want ${re} got "${said(v)}"`);
  check(!wrong.length, `v40 verbs read the world and screens: ${expectSaid.length - wrong.length}/${expectSaid.length} said what they did`, wrong.join('\n    '));
  // the goal planner on the samples: it planned from what was carried and did it
  const goalSaid = [['get', /get: got 4 oak_planks/], ['get_oak_planks', /get: got 4 oak_planks/], ['get_stick', /get: got 4 stick/], ['craft_torch', /craft_torch: made 4 torch/], ['plan', /plan: 1 cake .*steps/], ['recipes_all', /recipes_all: \d+ of \d+ recipes/], ['hold_bread', /hold_bread: holding bread/], ['rta_stick', /rta_stick: done in/], ['rta', /rta stick\+crafting_table: done in/]];
  const gw = goalSaid.filter(([v, re]) => !re.test(said(v))).map(([v, re]) => `${v}: want ${re} got "${said(v)}"`);
  check(!gw.length, `goal verbs plan and do it: ${goalSaid.length - gw.length}/${goalSaid.length} (get from carried logs, craft, a timed RTA)`, gw.join('\n    '));
  // every generated verb once, dry (says what it would do, does nothing): the name resolves and the planner answers for its thing
  {
    process.env.LAB_GOAL_DRY = '1';
    const t1 = Date.now(), M = 6, chunks = Array.from({ length: M }, () => []);
    GEN.forEach(([v], i) => chunks[i % M].push(v));
    const dryRun = async (list) => {
      const lines = [];
      const p = createRealPlayer({ req, port: 1, name: 'D', version: '1.26.50', emit: (l) => lines.push(l), timeoutMs: 3000 });
      const C = globalThis.__fakeClient; const bot = await p;
      C.emit('item_registry', { itemstates: names.map((nm) => ({ runtime_id: idOf(nm), name: 'minecraft:' + nm })) });
      C.on('queued', (n) => { if (n === 'inventory_transaction') setTimeout(() => C.emit('inventory_content', { window_id: 'inventory', input: [] }), 1); });
      await W.sleep(20);
      const bad = [];
      for (const v of list) {
        const l0 = lines.length;
        try { await Promise.race([bot.act(v, ['dry']), new Promise((_, j) => setTimeout(() => j(new Error('timed out (5 s)')), 5000))]); } catch (x) { bad.push(`${v}: ${x.message}`); continue; }
        const got = lines.slice(l0).find((l) => l.startsWith(`@D ${v}: `));
        if (!got) bad.push(`${v}: said nothing (${lines.slice(l0).join(' | ').slice(0, 120)})`);
        else if (/unknown|TypeError|undefined|NaN/.test(got)) bad.push(`${v}: ${got.slice(0, 160)}`);
      }
      bot.close();
      return bad;
    };
    const bad = (await Promise.all(chunks.map(dryRun))).flat();
    delete process.env.LAB_GOAL_DRY;
    check(!bad.length, `every generated verb answers dry: ${GEN.length - bad.length}/${GEN.length} in ${((Date.now() - t1) / 1000).toFixed(0)} s (${Object.entries(perFam).map(([k, v]) => k + '* ' + v).join(', ')})`, bad.slice(0, 30).join('\n    '));
  }
}

console.log(`\n${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
fs.rmSync(T, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
