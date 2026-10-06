// node lab.mjs ts hot ts/examples/block-log.ts: stays in the world; save this file and the new version replaces the old one
// (no /reload). What it logs shows in `ts hot`, `ts watch` and `do` as [tsrepl:slot:block-log].
import { world } from "@minecraft/server";
world.afterEvents.playerBreakBlock.subscribe((e) => {
  console.log(`${e.player.name} broke ${e.brokenBlockPermutation.type.id}`);
});
"armed"
