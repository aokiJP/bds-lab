// The reference solution of every bds task in tasks.json (one addon for all of them): `bench selftest` and `scratch selftest`
// prove with it that each hidden test can pass, and that the empty template fails. Not for the AI under test or in practice:
// building from nothing is the point (scratch next says so; .ignore keeps search tools out of this file).
export const SOLUTION = {
  'bp/scripts/main.js': `import { world, system, BlockVolume, ItemStack } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { cmd, ask, take, give, onBlock, onItem, every, load, save, cooldown } from './kit.js';
onBlock('lab:toggle', { onPlayerInteract(e) { const b = e.block; b.setPermutation(b.permutation.withState('lab:lit', !b.permutation.getState('lab:lit'))); } });
every(10, (p) => {
  const l = p.location, b = p.dimension.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y) - 1, z: Math.floor(l.z) });
  if (b?.typeId === 'minecraft:gold_block') { p.addEffect('speed', 40, { amplifier: 1, showParticles: false }); p.onScreenDisplay.setActionBar('SPEED!'); }
});
const COLORS = ['赤', '青', '緑'], none = () => ({ voted: [], n: [0, 0, 0] });
cmd('lab:vote', 'Vote for a color', {}, async (p) => {
  if (load(world, 'votes', none()).voted.includes(p.name)) return 'もう投票しました';
  const r = await ask(p, new ModalFormData().title('好きな色').dropdown('色', COLORS));
  if (!r) return;
  const v = load(world, 'votes', none()); v.voted.push(p.name); v.n[r.formValues[0]]++; save(world, 'votes', v);
  return '投票しました';
});
cmd('lab:result', 'Vote results', {}, () => { const v = load(world, 'votes', none()); return COLORS.map((c, i) => c + ':' + v.n[i]).join(' '); });
cmd('lab:shop', 'Ruby shop', {}, async (p) => {
  const r = await ask(p, new ActionFormData().title('Shop').button('ダイヤ1個（ルビー2個）'));
  if (r?.selection !== 0) return;
  if (!take(p, 'lab:ruby', 2)) return 'ルビーが足りません';
  give(p, 'minecraft:diamond');
});
system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
  const a = message.trim().split(/\\s+/), d = world.getDimension('overworld');
  const box = () => new BlockVolume({ x: +a[0], y: +a[1], z: +a[2] }, { x: +a[3], y: +a[4], z: +a[5] });
  if (id === 'bench:sum') console.warn('SUM ' + a.reduce((s, v) => s + Number(v), 0));
  else if (id === 'bench:fill') console.warn('FILLED ' + d.fillBlocks(box(), a[6]).getCapacity());
  else if (id === 'bench:count') { let n = 0; for (const p of box().getBlockLocationIterator()) if (d.getBlock(p)?.typeId === a[6]) n++; console.warn('COUNT ' + n); }
  else if (id === 'bench:set') { world.setDynamicProperty('kv:' + a[0], a.slice(1).join(' ')); console.warn('SAVED ' + a[0]); }
  else if (id === 'bench:get') console.warn('VALUE ' + (world.getDynamicProperty('kv:' + a[0]) ?? 'none'));
});
// the from-scratch lessons (node lab.mjs scratch): calc countdown wandzap zone filter daily
cmd('lab:add', 'Add two numbers', { a: 'int', b: 'int' }, (p, x) => '= ' + (x.a + x.b));
cmd('lab:countdown', 'Count down', { n: 'int' }, (p, x) => {
  for (let i = 0; i < x.n; i++) system.runTimeout(() => world.sendMessage(String(x.n - i)), i * 20);
  system.runTimeout(() => world.sendMessage('GO!'), x.n * 20);
});
onItem('lab:zap', { onUse(e) { const p = e.source; if (!cooldown(p, 'zap', 60)) { p.sendMessage('クールダウン中'); return; } p.sendMessage('ZAP!'); } });
const inZone = new Set();
every(5, (p) => {
  const l = p.location, inside = l.x >= 10 && l.x < 15 && l.z >= 10 && l.z < 15;
  if (inside && !inZone.has(p.id)) { inZone.add(p.id); p.sendMessage('ゾーンに入りました'); }
  else if (!inside && inZone.delete(p.id)) p.sendMessage('ゾーンを出ました');
});
world.beforeEvents.chatSend.subscribe((e) => { if (/badword/i.test(e.message)) { e.cancel = true; const p = e.sender; system.run(() => p.sendMessage('その言葉は使えません')); } });
cmd('lab:daily', 'Daily gift', {}, (p) => {
  const day = new Date().toISOString().slice(0, 10);
  if (load(p, 'daily', '') === day) return '今日はもう受け取りました';
  save(p, 'daily', day); give(p, 'minecraft:emerald', 1);
  return '受け取りました';
});
world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => { if (initialSpawn) player.getComponent('inventory').container.addItem(new ItemStack('lab:ruby', 3)); });
world.afterEvents.entityDie.subscribe(({ damageSource }) => {
  const k = damageSource.damagingEntity;
  if (k?.typeId !== 'minecraft:player') return;
  (world.scoreboard.getObjective('kills') ?? world.scoreboard.addObjective('kills', 'Kills')).addScore(k, 1);
});
`,
  'bp/loot_tables/entities/gel_slime.json': '{"pools":[{"rolls":1,"entries":[{"type":"item","name":"lab:gel","functions":[{"function":"set_count","count":{"min":1,"max":2}}]}]}]}\n',
};
// scaffolding the solution the way an AI would (add writes every file), then the JSON a task needs beyond it
export const SOLUTION_ADD = [
  ['add', 'item', 'lab:ruby', 'Ruby', 'ja=ルビー', 'tex=gem:e0115f', 'max_stack_size=16'],
  ['add', 'block', 'lab:lamp', 'Lamp', 'ja=ランプ', 'tex=block:f0d060', 'lab:toggle={}'],
  ['add', 'item', 'lab:gel', 'Gel', 'ja=ジェル', 'tex=orb:60d060'],
  ['add', 'item', 'lab:zap_wand', 'Zap Wand', 'ja=ザップの杖', 'tex=wand:a040ff', 'max_stack_size=1', 'lab:zap={}'],
  ['add', 'entity', 'lab:gel_slime', 'Gel Slime', 'ja=ジェルスライム', 'health={"value":6,"max":6}', 'loot={"table":"loot_tables/entities/gel_slime.json"}', 'movement={"value":0.15}'],
];
export const SOLUTION_JSON = {
  'bp/blocks/lamp.json': (j) => { const b = j['minecraft:block']; b.description.states = { 'lab:lit': [false, true] }; b.permutations = [{ condition: "q.block_state('lab:lit')", components: { 'minecraft:light_emission': 15 } }]; },
};

