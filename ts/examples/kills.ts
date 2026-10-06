// node lab.mjs ts hot ts/examples/kills.ts: a sidebar of mobs each player killed, kept while it runs
import { world, DisplaySlotId } from "@minecraft/server";
const board = world.scoreboard.getObjective("kills") ?? world.scoreboard.addObjective("kills", "Kills");
world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective: board });
world.afterEvents.entityDie.subscribe((e) => {
  const k = e.damageSource.damagingEntity;
  if (k?.typeId === "minecraft:player") board.addScore(k, 1);
});
"sidebar on"
