import { world, system } from "@minecraft/server";
system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id !== "probe:score") return;
  const A = world.getPlayers()[0], o = world.scoreboard.addObjective("p1"), o2 = world.scoreboard.addObjective("p2"), r = [o.hasParticipant(A)];
  try { o.getScore(A); r.push("no throw"); } catch (x) { r.push(x.message); }
  o.addScore(A, 2); r.push(o.getScore(A), String(o2.getScore(A)));
  world.sendMessage("score " + r.join(" | "));
});
