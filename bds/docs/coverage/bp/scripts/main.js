// Coverage probe. The lab tap (`events on`, `states on`) prints every Script API event and player state; this addon adds
// what only an addon can have: custom component hooks (`HOOK <kind>.<hook> fields`), startup events (`BOOT ...`),
// and cancel rules that make each before-event observable by what it prevents (`CANCEL before.<event> why`).
import { world, system, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from '@minecraft/server';

const fmt = (v, d = 0) => {
  if (v == null) return '-';
  if (typeof v !== 'object') return String(typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  try {
    if ('permutation' in v && 'x' in v) return `${v.typeId}@${v.x},${v.y},${v.z}`;   // Block
    if (v.typeId === 'minecraft:player') return v.name;
    if ('typeId' in v && 'location' in v) return v.typeId;                        // Entity
    if (v.type?.id && typeof v.getAllStates === 'function') return v.type.id;         // BlockPermutation
    if ('amount' in v && 'typeId' in v) return `${v.typeId}*${v.amount}${v.nameTag ? '"' + v.nameTag + '"' : ''}`; // ItemStack
    if ('x' in v && 'y' in v && 'z' in v) return `${fmt(v.x)},${fmt(v.y)},${fmt(v.z)}`;
    if (typeof v.id === 'string' && !('typeId' in v)) return v.id.replace('minecraft:', '');  // Dimension
  } catch { return '(invalid)'; }
  if (d) return '{..}';
  const out = [];
  for (let o = v; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
    for (const k of Object.getOwnPropertyNames(o)) { if (k === 'constructor' || out.some((x) => x.startsWith(k + '='))) continue; let x; try { x = v[k]; } catch { continue; } if (typeof x !== 'function') out.push(`${k}=${fmt(x, d + 1)}`); }
  return '{' + out.join(' ') + '}';
};
const line = (tag, e) => {
  const f = [];
  for (let o = e; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
    for (const k of Object.getOwnPropertyNames(o)) { if (k === 'constructor' || f.some((x) => x.startsWith(k + '='))) continue; let x; try { x = e[k]; } catch { continue; } if (typeof x !== 'function') f.push(`${k}=${fmt(x)}`); }
  console.warn(tag + (f.length ? ' ' + f.join(' ') : ''));
};

system.beforeEvents.startup.subscribe((ev) => {
  console.warn('BOOT system.startup');
  try { ev.worldClockRegistry.registerClock('probe:clock'); } catch (x) { console.warn('NOCLOCK ' + x); }
  const hooks = (kind, names, extra = {}) => Object.fromEntries(names.map((n) => [n, (e, p) => { line(`HOOK ${kind}.${n}`, e); extra[n]?.(e, p); }]));
  // custom commands: one per parameter type (`/probe:p_<Type> <value>`), `/probe:npc` (for NPC dialogue buttons) and `/probe:fail`
  try {
    const cc = ev.customCommandRegistry;
    cc.registerEnum('probe:color', ['red', 'blue']);
    const arg = (v) => Array.isArray(v) ? '[' + v.map((x) => fmt(x)).join(',') + ']' : fmt(v);
    const run = (name) => (o, ...args) => {
      console.warn(`HOOK command.${name} sourceType=${o.sourceType} sourceEntity=${fmt(o.sourceEntity)} initiator=${fmt(o.initiator)} sourceBlock=${fmt(o.sourceBlock)} args=${args.map(arg).join(' ')}`);
      return name === 'probe:fail' ? { status: CustomCommandStatus.Failure, message: 'probe failed on purpose' } : { status: CustomCommandStatus.Success, message: `ok ${name}` };
    };
    for (const t of Object.values(CustomCommandParamType)) {
      const name = `probe:p_${t.toLowerCase()}`;
      cc.registerCommand({ name, description: `probe ${t}`, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
        mandatoryParameters: [t === 'Enum' ? { name: 'probe:color', type: t } : { name: 'v', type: t }] }, run(name));
    }
    for (const name of ['probe:npc', 'probe:fail', 'probe:opt'])
      cc.registerCommand({ name, description: name, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
        ...(name === 'probe:opt' ? { mandatoryParameters: [{ name: 'a', type: 'Integer' }], optionalParameters: [{ name: 'b', type: 'String' }] } : {}) }, run(name));
  } catch (x) { console.warn('NOCMD ' + x); }
  ev.itemComponentRegistry.registerCustomComponent('probe:tool', hooks('item', ['onBeforeDurabilityDamage', 'onHitEntity', 'onMineBlock', 'onUse', 'onUseOn'], {
    // a wand named "keep" never loses durability: the hook runs before the damage and may change it
    onBeforeDurabilityDamage: (e) => { if (e.itemStack?.nameTag === 'keep') { e.durabilityDamage = 0; console.warn('CANCEL item.onBeforeDurabilityDamage keep'); } },
  }));
  ev.itemComponentRegistry.registerCustomComponent('probe:food', hooks('item', ['onCompleteUse', 'onConsume']));
  ev.itemComponentRegistry.registerCustomComponent('probe:use', hooks('item', ['onCompleteUse']));   // non-food: onConsume is food-only
  ev.blockComponentRegistry.registerCustomComponent('probe:ent', hooks('block', ['onEntity']));   // probe:ghost: entity events sent to a block
  ev.blockComponentRegistry.registerCustomComponent('probe:hooks', hooks('block', ['beforeOnPlayerPlace', 'onBlockStateChange', 'onBreak', 'onEntity', 'onEntityFallOn', 'onPlace', 'onPlayerBreak', 'onPlayerInteract', 'onRandomTick', 'onRedstoneUpdate', 'onStepOff', 'onStepOn', 'onTick'], {
    // placing a pad while sneaking is refused
    beforeOnPlayerPlace: (e) => { if (e.player?.isSneaking) { e.cancel = true; console.warn('CANCEL block.beforeOnPlayerPlace sneaking'); } },
  }));
});
world.afterEvents.worldLoad.subscribe((e) => line('BOOT after.worldLoad', e));
world.afterEvents.entityLoad.subscribe((e) => line('BOOT after.entityLoad', e));

// cancel rules: each one is the observable proof that its before-event ran first and can stop the action
const tag = (en, t) => { try { return en?.hasTag(t); } catch { return false; } };
const rules = {
  chatSend: (e) => e.message.startsWith('!secret') && 'message !secret',
  itemUse: (e) => e.itemStack?.typeId === 'minecraft:egg' && 'egg',
  playerBreakBlock: (e) => e.block.typeId === 'minecraft:gold_block' && 'gold_block',
  playerPlaceBlock: (e) => e.permutationToPlace?.type.id === 'minecraft:gold_block' && 'gold_block',
  playerInteractWithBlock: (e) => e.block.typeId === 'minecraft:barrel' && 'barrel',
  playerInteractWithEntity: (e) => e.target?.typeId === 'minecraft:sheep' && 'sheep',
  entityHurt: (e) => tag(e.hurtEntity, 'god') && 'tag god',
  entityHeal: (e) => tag(e.healedEntity, 'noheal') && 'tag noheal',
  effectAdd: (e) => /poison/i.test(e.effectType) && 'poison',
  entityItemPickup: (e) => { try { return e.item.getComponent('item').itemStack.typeId === 'minecraft:bone' && 'bone'; } catch { return false; } },
  entityTamed: (e) => tag(e.entity, 'notame') && 'tag notame',
  explosion: (e) => (e.source?.location.x ?? 0) > 20 && 'x>20',
  playerGameModeChange: (e) => tag(e.player, 'lockmode') && 'tag lockmode',
  weatherChange: (e) => e.newWeather === 'Thunder' && 'Thunder',
};
for (const [name, why] of Object.entries(rules)) {
  try {
    world.beforeEvents[name].subscribe((e) => { const r = why(e); if (r) { e.cancel = true; console.warn(`CANCEL before.${name} ${r}`); } });
  } catch (x) { console.warn(`NOSUB before.${name} ${x}`); }
}
