import { world, system, Player } from '@minecraft/server';
import { cmd, give, score } from './kit';

const FISH = new Set(['minecraft:cod', 'minecraft:salmon', 'minecraft:tropical_fish', 'minecraft:pufferfish']);
const OBJ = 'fishcup';
let endsAt = -1;               // the tick the contest ends (-1: none running)
const reeled = new Map<string, number>();   // player name → the tick they last pulled the rod in

const running = () => endsAt >= 0;

cmd('lab:fish', 'Start a fishing contest', { 'seconds?': 'int' }, (p, a) => {
  if (running()) return 'A contest is already running';
  const secs = Math.max(10, Math.min(600, a.seconds ?? 180));
  world.scoreboard.getObjective(OBJ) && world.scoreboard.removeObjective(OBJ);
  score(OBJ, 'Fish caught', 'Sidebar');
  endsAt = system.currentTick + secs * 20;
  world.sendMessage(`Fishing contest started: ${secs} seconds`);
  system.runTimeout(finish, secs * 20);
  return undefined;
});

// a fish counts when it comes in right after its player pulled the rod in (not one picked up, given or bought)
world.beforeEvents.itemUse.subscribe(({ source, itemStack }) => {
  if (running() && itemStack.typeId === 'minecraft:fishing_rod') reeled.set(source.name, system.currentTick);
});
world.afterEvents.playerInventoryItemChange.subscribe(({ player, itemStack, beforeItemStack }) => {
  if (!running() || !itemStack || !FISH.has(itemStack.typeId)) return;
  if (system.currentTick - (reeled.get(player.name) ?? -999) > 60) return;
  const before = beforeItemStack?.typeId === itemStack.typeId ? beforeItemStack.amount : 0;
  const n = itemStack.amount - before;
  if (n > 0) world.scoreboard.getObjective(OBJ)?.addScore(player, n);
});

function finish() {
  endsAt = -1;
  const o = world.scoreboard.getObjective(OBJ);
  const scores = (o?.getScores() ?? []).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const top = scores[0], winner = top?.participant.getEntity();
  if (!top) world.sendMessage('Fishing contest over: nobody caught a fish');
  else if (winner instanceof Player) {
    give(winner, 'minecraft:diamond', 3);
    world.sendMessage(`Fishing contest over: ${winner.name} wins with ${top.score} fish (3 diamonds)`);
  } else world.sendMessage(`Fishing contest over: ${top.participant.displayName} wins with ${top.score} fish (left before the end: no prize)`);
  if (o) world.scoreboard.removeObjective(o);
}
