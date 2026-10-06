import { world, system } from "@minecraft/server";
let mem = "gone";
system.afterEvents.scriptEventReceive.subscribe((e) => {
  const A = world.getPlayers()[0];
  if (e.id === "probe:set") { mem = "kept"; A.setDynamicProperty("v", "kept"); world.sendMessage("set"); }
  if (e.id === "probe:get") world.sendMessage("variable " + mem + ", dynamic property " + (A.getDynamicProperty("v") ?? "gone"));
});
