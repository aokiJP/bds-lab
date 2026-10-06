// 拡張: ストラクチャーとカスタムコマンド

// ---- ストラクチャー（メモリ上 / ワールド保存を区別） -------------------------------------
const structures = new $Map(); // id → { id, size, blocks: Map("x|y|z" → perm), water: Set, saveMode, valid }
const badArg = (i, msg) => fail('InvalidArgumentError', `Invalid value passed to argument [${i}]. ${msg}`);
const structId = (id, { check = true } = {}) => {
  const s = $String(id);
  const i = s.indexOf(':');
  if (check && (i <= 0 || s.slice(0, i) === 'minecraft' || i === s.length - 1)) throw badArg(0, 'Invalid or missing namespace.');
  return s;
};
const structObj = (st) => once('Structure', (st._h ??= { st, valid: () => st.valid }));
const ROT = { None: 0, Rotate90: 1, Rotate180: 2, Rotate270: 3 };
IMPL.StructureManager = {
  fns: {
    createEmpty(h, id, size, mode) {
      const k = structId(id);
      if (structures.get(k)?.valid) throw badArg(0, `Structure with identifier '${k}' already exists.`);
      if (size.x < 1 || size.y < 1 || size.z < 1) throw badArg(2, 'All structure dimensions must be greater than 0.');
      const st = { id: k, size: Vec(size), blocks: new $Map(), water: new $Set(), saveMode: mode ?? 'Memory', valid: true };
      structures.set(k, st);
      return structObj(st);
    },
    createFromWorld(h, id, dimension, from, to, o) {
      const k = structId(id);
      if (structures.get(k)?.valid) throw badArg(0, `Structure with identifier '${k}' already exists.`);
      const dim = H.get(dimension).dim;
      const lo = { x: $Math.min(from.x, to.x), y: $Math.min(from.y, to.y), z: $Math.min(from.z, to.z) };
      const hi = { x: $Math.max(from.x, to.x), y: $Math.max(from.y, to.y), z: $Math.max(from.z, to.z) };
      const st = { id: k, size: { x: hi.x - lo.x + 1, y: hi.y - lo.y + 1, z: hi.z - lo.z + 1 }, blocks: new $Map(), water: new $Set(), saveMode: o?.saveMode ?? 'World', valid: true };
      if (o?.includeBlocks !== false) {
        for (let x = lo.x; x <= hi.x; x++) for (let y = lo.y; y <= hi.y; y++) for (let z = lo.z; z <= hi.z; z++) {
          if (!chunkLoaded(dim, x, z)) throw fail('UnloadedChunksError', '未読み込みの区画があります');
          st.blocks.set(`${x - lo.x}|${y - lo.y}|${z - lo.z}`, readBlock(dim, x, y, z));
        }
      }
      if (o?.includeEntities !== false && query({}, { dim }).some((e) => !e.player && ['x', 'y', 'z'].every((c) => e.loc[c] >= lo[c] && e.loc[c] < hi[c] + 1))) {
        log('warn', `[sandbox] ストラクチャー ${k}: エンティティの保存は再現していません（ブロックだけ保存しました）`, { inconclusive: true });
        S.inconclusive++;
      }
      structures.set(k, st);
      return structObj(st);
    },
    get: (h, id) => { const st = structures.get(structId(id, { check: false })); return st?.valid ? structObj(st) : undefined; },
    delete(h, s) {
      const k = typeof s === 'string' ? structId(s, { check: false }) : H.get(s).st.id;
      const st = structures.get(k);
      if (!st?.valid) return false;
      st.valid = false;
      structures.delete(k);
      return true;
    },
    getWorldStructureIds: () => [...structures.values()].filter((s) => s.valid && s.saveMode === 'World' && s.saved !== false).map((s) => s.id),
    getPackStructureIds: () => [...(W.packStructures ?? [])],
    place(h, s, dimension, loc, o) {
      const st = typeof s === 'string' ? structures.get(structId(s, { check: false })) : H.get(s).st;
      if (!st?.valid) throw fail('InvalidStructureError', 'Structure does not exist.');
      const dim = H.get(dimension).dim;
      const rot = ROT[o?.rotation ?? 'None'];
      const mir = o?.mirror ?? 'None';
      const integrity = o?.integrity ?? 1;
      let seed2 = 0;
      for (const ch of $String(o?.integritySeed ?? '')) seed2 = (seed2 * 31 + ch.charCodeAt(0)) >>> 0;
      const rnd = () => { seed2 = (seed2 * 1664525 + 1013904223) >>> 0; return seed2 / 4294967296; };
      if (o?.includeBlocks === false) return;
      const base = { x: $Math.floor(loc.x), y: $Math.floor(loc.y), z: $Math.floor(loc.z) };
      for (const [kk, perm] of st.blocks) {
        let [x, y, z] = kk.split('|').map(Number);
        if (mir === 'X' || mir === 'XZ') z = st.size.z - 1 - z;
        if (mir === 'Z' || mir === 'XZ') x = st.size.x - 1 - x;
        for (let r = 0; r < rot; r++) { const nx = st.size.z - 1 - z; z = x; x = nx; }
        if (integrity < 1 && rnd() > integrity) continue;
        const p = { x: base.x + x, y: base.y + y, z: base.z + z };
        checkLoc(dim, p);
        if (perm.id === 'minecraft:structure_void') continue;
        writeBlock(dim, p.x, p.y, p.z, perm);
      }
      if (rot || mir !== 'None') log('info', '[sandbox] 回転・反転したストラクチャーのブロックの向き（状態）は元のままです');
    },
    // 実機の引数チェックとエラーだけを合わせている。サンドボックスには地形生成が無いので、
    // 生成そのものは必ず失敗する（実機も、置けない場所では同じエラーになる）
    placeJigsaw(h, pool, targetJigsaw, maxDepth, dimension, location, options) {
      void pool; void targetJigsaw; void dimension; void location; void options;
      const d = $Math.trunc($Number(maxDepth));
      if (!(d >= 1 && d <= 20)) throw fail('ArgumentOutOfBoundsError', `Unsupported or out of bounds value passed to function argument [2]. Value: ${maxDepth}, Argument bounds: [1, 20]`);
      bump(S.unsupported, 'StructureManager.placeJigsaw（ジグソーの定義が無いので必ず失敗します）');
      throw fail('PlaceJigsawError', 'Jigsaw structure generation failed.');
    },
    placeJigsawStructure(h, identifier, dimension, location, options) {
      void identifier; void dimension; void location; void options;
      // 実機（vanilla・実験機能なし）では、どの名前でも同じエラーになる
      throw fail('PlaceJigsawError', 'Invalid structure name.');
    },
  },
};
IMPL.Structure = {
  fns: {
    getBlockPermutation(h, p) {
      if (p.x < 0 || p.y < 0 || p.z < 0 || p.x >= h.st.size.x || p.y >= h.st.size.y || p.z >= h.st.size.z) throw badArg(0, `The provided location (${p.x}, ${p.y}, ${p.z}) is outside the structure bounds (${h.st.size.x}, ${h.st.size.y}, ${h.st.size.z}).`);
      const b = h.st.blocks.get(`${p.x}|${p.y}|${p.z}`);
      return b ? permObj(b) : undefined;
    },
    setBlockPermutation(h, p, perm, water) {
      if (p.x < 0 || p.y < 0 || p.z < 0 || p.x >= h.st.size.x || p.y >= h.st.size.y || p.z >= h.st.size.z) throw badArg(0, `The provided location (${p.x}, ${p.y}, ${p.z}) is outside the structure bounds (${h.st.size.x}, ${h.st.size.y}, ${h.st.size.z}).`);
      const k = `${p.x}|${p.y}|${p.z}`;
      if (perm) h.st.blocks.set(k, H.get(perm).perm); else h.st.blocks.delete(k);
      if (water) h.st.water.add(k); else h.st.water.delete(k);
    },
    getIsWaterlogged: (h, p) => h.st.water.has(`${p.x}|${p.y}|${p.z}`),
    saveAs(h, id, mode) {
      const k = structId(id);
      if (structures.get(k)?.valid) throw badArg(0, `Structure with identifier '${k}' already exists.`);
      const st = { ...h.st, id: k, blocks: new $Map(h.st.blocks), water: new $Set(h.st.water), saveMode: mode ?? 'World', valid: true, _h: undefined };
      structures.set(k, st);
      return structObj(st);
    },
    saveToWorld(h) { h.st.saveMode = 'World'; },
  },
  get: { id: (h) => h.st.id, size: (h) => Vec(h.st.size), isValid: (h) => h.st.valid },
};

// ---- カスタムコマンド（startup で登録し、/ns:name で呼べる） -----------------------------
const customEnums = new $Map();
const END_OF_LINE = CUSTOM.END;
const customCommands = new $Map();
let registryOpen = false;
IMPL.StartupEvent = {
  get: {
    customCommandRegistry: () => once('CustomCommandRegistry', HS.ccr),
    blockComponentRegistry: () => once('BlockComponentRegistry', HS.bcr),
    itemComponentRegistry: () => once('ItemComponentRegistry', HS.icr),
    dimensionRegistry: ni('startup.dimensionRegistry（カスタム次元）'),
  },
};
HS.ccr = {}; HS.bcr = {}; HS.icr = {};
const nsName = (n) => checkNamespace(n);
IMPL.CustomCommandRegistry = {
  fns: {
    registerEnum(h, name, values) {
      if (!registryOpen) throw fail('CustomCommandError', 'startup の中でしか登録できません');
      const k = nsName(name, '列挙');
      if (customEnums.has(k)) throw fail('CustomCommandError', `Custom Command Enum '${k}' was already registered.`);
      customEnums.set(k, [...values]);
    },
    registerCommand(h, def, cb) {
      if (!registryOpen) throw fail('CustomCommandError', 'startup の中でしか登録できません');
      const k = nsName(def.name, 'コマンド');
      if (customCommands.has(k)) throw fail('CustomCommandError', `Custom Command '${k}' was already registered.`);
      const unknown = [...(def.mandatoryParameters ?? []), ...(def.optionalParameters ?? [])].filter((p) => p.type === 'Enum' && !customEnums.has(p.name)).map((p) => p.name);
      if (unknown.length) throw fail('CustomCommandError', `Custom Command depends on one or more unknown enums [${unknown.join(', ')}].`);
      customCommands.set(k, { def, cb });
    },
  },
};
// 登録は実機どおりに受け付ける（名前の検査も実機どおり）。ただしサンドボックスは
// ブロック定義（blocks/*.json）を読まないので、登録した処理は呼ばれない。
// 黙って何も起きないと実機と違うことに気づけないので、未再現として印を付ける。
IMPL.BlockComponentRegistry = {
  fns: {
    registerCustomComponent(h, name, h2) {
      if (!registryOpen) throw fail('Error', 'startup の中でしか登録できません');
      nsName(name, 'ブロックのカスタムコンポーネント');
      S.effects.push({ tick: S.tick, kind: 'registerBlockComponent', id: name });
      CUSTOM.blockComps.set(name, h2 ?? {});
      warnUndispatched('block', name, h2);
    },
  },
};
IMPL.ItemComponentRegistry = {
  fns: {
    registerCustomComponent(h, name, h2) {
      if (!registryOpen) throw fail('Error', 'startup の中でしか登録できません');
      nsName(name, 'アイテムのカスタムコンポーネント');
      S.effects.push({ tick: S.tick, kind: 'registerItemComponent', id: name });
      CUSTOM.itemComps.set(name, h2 ?? {});
      warnUndispatched('item', name, h2);
    },
  },
};
CUSTOM.blockComps = new $Map();
CUSTOM.itemComps = new $Map();
/** 呼べる処理はそのまま呼び、まだ呼べない処理だけを未再現として知らせる */
function warnUndispatched(kind, name, comp) {
  const can = kind === 'block' ? DISPATCHED_BLOCK : DISPATCHED_ITEM;
  const rest = $Object.keys(comp ?? {}).filter((k) => !can.includes(k));
  if (rest.length) softNI(`${kind === 'block' ? 'block' : 'item'}ComponentRegistry.registerCustomComponent('${name}') の ${rest.join(' / ')}（まだ呼ばれません）`);
}
CUSTOM.open = (v) => { registryOpen = v; };
CUSTOM.find = (name) => {
  if (customCommands.has(name)) return customCommands.get(name);
  const hits = [...customCommands.entries()].filter(([k]) => k.split(':')[1] === name);
  return hits.length === 1 ? hits[0][1] : null;
};
CUSTOM.run = (cmd, args, src, helpers) => {
  const { def, cb } = cmd;
  const perm = { Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 }[def.permissionLevel] ?? 0;
  if (src.entity?.player && perm > 0 && !src.entity.op) return { ok: false, message: 'You do not have permission to use this command' };
  const params = [...(def.mandatoryParameters ?? []).map((p) => ({ ...p, req: true })), ...(def.optionalParameters ?? [])];
  const vals = [];
  let i = 0;
  for (const p of params) {
    if (i >= args.length) { if (p.req) return { ok: false, syntaxToken: END_OF_LINE }; break; }
    const t = args[i];
    try {
      switch (p.type) {
        case 'Integer': if (!/^-?\d+$/.test(t)) throw new $Error('整数'); vals.push($Number(t)); i++; break;
        case 'Float': if (!$isFinite($Number(t))) throw new $Error('数値'); vals.push($Number(t)); i++; break;
        case 'Boolean': if (t !== 'true' && t !== 'false') throw new $Error('true/false'); vals.push(t === 'true'); i++; break;
        case 'String': vals.push(t); i++; break;
        case 'Location': vals.push(helpers.pos(args, i, src)); i += 3; break;
        case 'EntitySelector': vals.push(helpers.select(t, src).map(entityObj)); i++; break;
        case 'PlayerSelector': vals.push(helpers.select(t, src).filter((e) => e.player).map(entityObj)); i++; break;
        case 'BlockType': { const b = blockTypeId(t); if (!b) throw new $Error('ブロック'); vals.push(blockTypeObj(b)); i++; break; }
        case 'ItemType': { const it = itemId(t); if (!it) throw new $Error('アイテム'); vals.push(itemTypeObj(it)); i++; break; }
        case 'EntityType': { const et = entityTypeId(t); if (!et) throw new $Error('エンティティの種類'); vals.push(IMPL.EntityTypes.static.get(null, et)); i++; break; }
        // 実測: 列挙に無い値もそのまま渡る
        case 'Enum': vals.push(t); i++; break;
        default: throw new $Error(`型 ${p.type}`);
      }
    } catch (e) {
      void e;
      return { ok: false, syntaxToken: t };
    }
  }
  if (i < args.length) return { ok: false, syntaxToken: args[i] };
  const origin = inst('CustomCommandOrigin', { data: { sourceEntity: src.entity ? entityObj(src.entity) : undefined, initiator: src.entity ? entityObj(src.entity) : undefined, sourceBlock: undefined, sourceType: src.entity ? 'Entity' : 'Server' } });
  let r;
  const prevRun = S.running;
  S.running = `customCommand ${def.name}`;
  try {
    // 実測: runCommand から呼んだコールバックは読み取り専用ではない
    r = withMode('normal', () => $apply(cb, undefined, [origin, ...vals]));
  } catch (e) {
    if (e instanceof SandboxNotImplemented) { notImplemented(e); return { ok: false, notImplemented: `custom:${def.name}` }; }
    S.uncaught++;
    log('error', `customCommand ${def.name}: ${errInfo(e).name}: ${errInfo(e).message}`, { error: errInfo(e) });
    return { ok: false, message: errInfo(e).message };
  } finally { S.running = prevRun; }
  if (r && r.status === 1) return { ok: false, message: r.message ?? '' };
  return { ok: true, successCount: 1, message: r?.message ?? '' };
};
