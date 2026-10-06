import { world } from '@minecraft/server';
import { give, load, save } from './kit';

// the day number in the server's local time zone
const today = () => { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); };

world.afterEvents.playerSpawn.subscribe(({ player: p, initialSpawn }) => {
  if (!initialSpawn) return;
  const day = today(), last = load(p, 'bonusDay', -1);
  if (last === day) return;
  const streak = last === day - 1 ? load(p, 'streak', 0) + 1 : 1;
  save(p, 'bonusDay', day);
  save(p, 'streak', streak);
  const n = streak % 7 === 0 ? 5 : 1;
  give(p, 'minecraft:emerald', n);
  p.sendMessage(`Login bonus: ${n} emerald (day ${streak} in a row)`);
});
