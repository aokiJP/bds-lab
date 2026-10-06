import { world } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { cmd, ask, give, count, take } from './kit';

// 3 rubies for new players
world.afterEvents.playerSpawn.subscribe((e) => give(e.player, 'lab:ruby', 3));

cmd('lab:shop', 'Ruby shop', {}, async (p) => {
  const r = await ask(p, new ActionFormData().title('ルビーショップ').button('ダイヤ1個（ルビー2個）'));
  if (r!.selection === 0) {
    if (count(p, 'lab:ruby') < 1) return 'ルビーが足りません';
    take(p, 'lab:ruby', 2);
    give(p, 'minecraft:diamond', 1);
    return 'ダイヤを買いました';
  }
});
