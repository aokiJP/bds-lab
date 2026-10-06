// world: a small world of the player's own, put on the device when it is prepared. 1.26 sends a player with no worlds from
// Play into its new player's flow (Get started → game mode → a world made and opened), never to the PLAY screen where the
// lab's BDS is listed as a LAN world; with one world kept the player is not new (seen on the CI device: Play then opened
// PLAY, "Worlds (1)"). The world is never opened: its level.dat (little-endian NBT, as the game writes it) and its name are
// what the game reads to list it; the game makes the rest when a world is opened. Pure: app.mjs pushes and places them.

export const WORLD_ID = 'lab-ready';
export const WORLD_NAME = 'own world';   // (not the BDS's "lab": the PLAY screen lists both)

// ---- little-endian NBT (Bedrock's), the few tags a level.dat needs ----
const T = { byte: 1, int: 3, long: 4, string: 8, list: 9, compound: 10 };
const str = (s) => { const b = Buffer.from(String(s), 'utf8'), h = Buffer.alloc(2); h.writeUInt16LE(b.length); return Buffer.concat([h, b]); };
function payload(type, v) {
  if (type === 'byte') return Buffer.from([v & 255]);
  if (type === 'int') { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; }
  if (type === 'long') { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; }
  if (type === 'string') return str(v);
  if (type === 'list') { const [et, items] = v, h = Buffer.alloc(5); h[0] = T[et]; h.writeInt32LE(items.length, 1); return Buffer.concat([h, ...items.map((x) => payload(et, x))]); }
  if (type === 'compound') return Buffer.concat([...v.map(([t, n, x]) => Buffer.concat([Buffer.from([T[t]]), str(n), payload(t, x)])), Buffer.from([0])]);
  throw new Error(`nbt: ${type}`);
}
/** a named root compound as little-endian NBT (pure): fields [[type, name, value], …] */
export const nbt = (fields, name = '') => Buffer.concat([Buffer.from([T.compound]), str(name), payload('compound', fields)]);

/** a flat creative world's level.dat (pure): the storage version and length first, then the root compound */
export function levelDat({ name = WORLD_NAME, now = Date.now(), version = [1, 21, 0, 0, 0] } = {}) {
  const layers = JSON.stringify({ biome_id: 1, block_layers: [{ block_name: 'minecraft:bedrock', count: 1 }, { block_name: 'minecraft:dirt', count: 2 }, { block_name: 'minecraft:grass_block', count: 1 }], encoding_version: 6, structure_options: null, world_version: 'version.post_1_18' });
  const root = nbt([
    ['string', 'LevelName', name], ['int', 'GameType', 1], ['int', 'Generator', 2], ['int', 'Difficulty', 0],
    ['long', 'LastPlayed', Math.floor(now / 1000)], ['long', 'RandomSeed', 1], ['long', 'Time', 0], ['long', 'currentTick', 0],
    ['int', 'SpawnX', 0], ['int', 'SpawnY', 32767], ['int', 'SpawnZ', 0], ['int', 'StorageVersion', 10], ['int', 'NetworkVersion', 685],
    ['byte', 'commandsEnabled', 1], ['byte', 'cheatsEnabled', 1], ['byte', 'hasBeenLoadedInCreative', 1], ['byte', 'MultiplayerGame', 1], ['byte', 'LANBroadcast', 1],
    ['string', 'FlatWorldLayers', layers], ['string', 'InventoryVersion', version.slice(0, 3).join('.')],
    ['list', 'lastOpenedWithVersion', ['int', version]], ['list', 'MinimumCompatibleClientVersion', ['int', version]],
  ]);
  const head = Buffer.alloc(8); head.writeInt32LE(10, 0); head.writeInt32LE(root.length, 4);
  return Buffer.concat([head, root]);
}

/** the world's files (pure) → [{ path, data }] under its folder */
export const worldFiles = ({ name = WORLD_NAME, now = Date.now() } = {}) => [
  { path: 'level.dat', data: levelDat({ name, now }) },
  { path: 'levelname.txt', data: Buffer.from(name) },
];

/** the shell line (root, on the device) that puts the pushed folder in the game's own com.mojang folder, owned by the game
 *  and labelled as its files (pure) → one line; prints "world <dir>" where it went. (Only the app's private folder, where
 *  the game keeps its worlds by default: one in its external folder is not listed, and the PLAY screen then says "Some
 *  worlds might be hidden because they are saved on external storage" — seen on the CI device) */
export function placeLine({ pkg, from, id = WORLD_ID }) {
  const roots = [`/data/data/${pkg}/games/com.mojang`];
  const own = `$(stat -c %u:%g /data/data/${pkg})`;
  return roots.map((r) => `if [ -d ${r} ]; then mkdir -p ${r}/minecraftWorlds && rm -rf ${r}/minecraftWorlds/${id} && cp -r ${from} ${r}/minecraftWorlds/${id} && { chown -R ${own} ${r}/minecraftWorlds 2>/dev/null; restorecon -R ${r}/minecraftWorlds 2>/dev/null; echo "world ${r}/minecraftWorlds/${id}"; }; fi`).join('; ') + `; rm -rf ${from}`;
}
