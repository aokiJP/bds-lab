import { world } from '@minecraft/server';
import { give } from './kit';

// drinking the jump potion: jump boost II for 30 s, the bottle comes back
world.afterEvents.itemCompleteUse.subscribe(({ itemStack, source }) => {
  if (itemStack.typeId !== 'lab:jump_potion') return;
  source.addEffect('jump_boost', 600, { amplifier: 1 });
  give(source, 'minecraft:glass_bottle', 1);
  source.sendMessage('You feel springy');
});
