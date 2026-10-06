import { world, system, ItemStack } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { cmd, cmdAny, onItem, onBlock, getState, setState, ready, ask, count, take, give, once, load, save, score, every, cooldown, menu, confirm, input, item } from './kit';

cmd('kit:shop', 'shop', {}, (p) => {
  if (!p) return;
  ask(p, new ActionFormData().title('Shop').button('Diamond (2 emerald)')).then((r) => {
    if (!r) return p.sendMessage('KIT closed');
    if (!take(p, 'minecraft:emerald', 2)) return p.sendMessage('KIT poor');
    give(p, 'minecraft:diamond'); p.sendMessage('KIT bought');
  });
});
cmd('kit:name', 'ask a name', {}, (p) => { if (p) ask(p, new ModalFormData().textField('Name', 'name')).then((r) => p.sendMessage('KIT name ' + r?.formValues?.[0])); });
cmd('kit:args', 'args', { n: 'int', 'mode?': ['up', 'down'] }, (p, a) => `KIT args ${a.n} ${a.mode ?? '-'}`);
cmd('kit:op', 'op only', {}, () => 'KIT op ran', true);
cmd('kit:give', 'give many', { n: 'int' }, (p, a) => { if (p) give(p, 'minecraft:stick', a.n); return 'KIT count ' + (p ? count(p, 'minecraft:stick') : 0); });
cmdAny('kit:save', 'save', { v: 'string' }, (p, a) => { save(world, 'kv', { v: a.v }); return 'KIT saved'; });
cmd('kit:load', 'load', {}, () => 'KIT load ' + load(world, 'kv', { v: 'none' }).v);
onItem('kit:ping', { onUse: (e) => e.source.sendMessage('KIT used ' + (cooldown(e.source, 'ping', 40) ? 'ready' : 'wait')) });
world.afterEvents.playerSpawn.subscribe(({ player }) => { if (once(player, 'welcome')) { give(player, 'minecraft:emerald', 3); player.sendMessage('KIT welcome'); } });
ready(() => { score('kit', 'Kit', 'Sidebar'); console.warn('KIT ready'); });
every(20, (p) => score('kit').setScore(p, count(p, 'minecraft:emerald')));
onBlock('kit:toggle', { onPlayerInteract: (e) => { setState(e.block, 'kit:lit', !getState(e.block, 'kit:lit')); console.warn('KIT lit ' + getState(e.block, 'kit:lit')); } });
cmd('kit:menu', 'menu', {}, (p) => { menu(p, 'Menu', [['Alpha', (q) => q.sendMessage('KIT menu alpha')], ['Beta', (q) => q.sendMessage('KIT menu beta')]], 'pick one').then((i) => p.sendMessage('KIT menu index ' + i)); });
cmd('kit:confirm', 'confirm', {}, (p) => { confirm(p, 'Sure?', 'Ask').then((v) => p.sendMessage('KIT confirm ' + v)); });
cmd('kit:input', 'input', {}, (p) => { input(p, 'Input', { Name: 'text', Count: 'number', Level: [1, 10], Mode: ['gift', 'sell'], On: 'toggle' }).then((o) => p.sendMessage('KIT input ' + JSON.stringify(o))); });
cmd('kit:item', 'item', {}, (p) => { give(p, item('minecraft:diamond', 'Gem', ['shiny', 'rare'], 2)); return 'KIT item given'; });
cmd('kit:pay', 'bare item ids', { n: 'int' }, (p, a) => (take(p, 'emerald', a.n) ? 'KIT paid, left ' + count(p, 'emerald') : 'KIT short ' + count(p, 'emerald')));
cmd('kit:later', 'a reply after a form', {}, async (p) => { await confirm(p, 'Wait?'); return 'KIT later'; });
