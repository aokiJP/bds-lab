import { world, Player } from '@minecraft/server';
import { cmd, menu, give, score, once } from './kit';

const GOODS: [string, string, number][] = [['Bread', 'minecraft:bread', 5], ['Iron Ingot', 'minecraft:iron_ingot', 20], ['Diamond', 'minecraft:diamond', 100]];
const coins = () => score('coins', 'Coins', 'Sidebar');
const bal = (p: Player) => (coins().hasParticipant(p) ? coins().getScore(p) ?? 0 : 0);

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn && once(player, 'coins')) coins().addScore(player, 50);
  else coins().addScore(player, 0);   // keep them on the sidebar
});

cmd('lab:shop', 'Open the shop', {}, async (p) => {
  await menu(p, 'Shop', GOODS.map(([name, id, price]) => [`${name} - ${price} coins`, (q: Player) => {
    if (bal(q) < price) { q.sendMessage(`Not enough coins: ${name} costs ${price}, you have ${bal(q)}`); return; }
    coins().addScore(q, -price);
    give(q, id, 1);
    q.sendMessage(`Bought ${name} for ${price} coins (${bal(q)} left)`);
  }]), `You have ${bal(p)} coins`);
  return undefined;
});

cmd('lab:pay', 'Send coins to a player', { who: 'player', amount: 'int' }, (p, a) => {
  const to: Player[] = a.who ?? [];
  if (to.length !== 1) return 'Name one player';
  const [q] = to;
  if (q.name === p.name) return 'You cannot pay yourself';
  if (a.amount <= 0) return 'The amount must be at least 1';
  if (bal(p) < a.amount) return `Not enough coins: you have ${bal(p)}`;
  coins().addScore(p, -a.amount);
  coins().addScore(q, a.amount);
  q.sendMessage(`${p.name} sent you ${a.amount} coins`);
  return `Sent ${a.amount} coins to ${q.name}`;
});
