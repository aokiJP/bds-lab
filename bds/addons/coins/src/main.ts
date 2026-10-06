import { cmd, give, load, save } from './kit';

// the day number in the server's local time zone (a new day at local midnight, not at 0:00 UTC)
const today = () => { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); };

cmd('lab:coins', 'Get a coin once a day', {}, (p) => {
  const day = today();
  if (load(p, 'coinDay', -1) === day) return 'Already claimed today';
  save(p, 'coinDay', day);   // saved on the player: still claimed after a restart
  give(p, 'minecraft:gold_nugget', 1);
  return 'You got a coin';
});
