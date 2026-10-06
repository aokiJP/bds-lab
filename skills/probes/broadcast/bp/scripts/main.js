import { world, system } from "@minecraft/server";
system.afterEvents.scriptEventReceive.subscribe((e) => { if (e.id === "probe:say") world.sendMessage("hello everyone"); if (e.id === "probe:tell") world.getPlayers()[0].sendMessage("hello A"); });
