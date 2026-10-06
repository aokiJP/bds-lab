import { world } from '@minecraft/server';
import { onItem, score, cooldown, once, give, item } from './kit';

onItem('lab:wand', {
  onUse(e) {
    const p = e.source;
    if (!cooldown(p, 'wand', 100)) { p.sendMessage('The wand is recharging'); return; }
    p.addEffect('speed', 200, { amplifier: 1 });
    const s = score('wand_uses', 'Wand uses', 'Sidebar');
    s.addScore(p, 1);
    p.sendMessage('Whoosh!');
  },
});
world.afterEvents.playerSpawn.subscribe((e) => {
  if (e.initialSpawn && once(e.player, 'wand')) give(e.player, item('lab:wand', 'Wand'), 1);
});
