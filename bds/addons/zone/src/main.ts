import { world } from '@minecraft/server';
import { every, once, give } from './kit';
const inside = new Set<string>();
every(5, (p) => {
  const { x, z } = p.location, now = x >= 3 && x <= 6 && z >= 3 && z <= 6;
  if (now && !inside.has(p.name)) p.sendMessage('Welcome to the zone');
  if (now) inside.add(p.name); else inside.delete(p.name);
});
world.afterEvents.playerSpawn.subscribe((e) => {
  if (e.initialSpawn && once(e.player, 'bread')) give(e.player, 'minecraft:bread', 1);
});
