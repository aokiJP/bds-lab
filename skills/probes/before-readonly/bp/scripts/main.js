import { world, system } from "@minecraft/server";
// a before-event is read-only: a change inside it is refused, the same change in system.run works.
// Each kind of call tried on its own, so the lab knows which ones count as changes (addon-lint WRITES)
world.beforeEvents.itemUse.subscribe((e) => {
  if (e.itemStack.typeId !== "minecraft:stick") return;
  const p = e.source, o = world.scoreboard.getObjective("probe");
  const t = (name, fn) => { try { fn(); world.sendMessage(`${name} ok`); } catch (x) { world.sendMessage(`${name} refused: ${x.message}`); } };
  t("teleport", () => p.teleport({ x: 2, y: -60, z: 2 }));
  t("addScore", () => o.addScore(p, 1));
  t("setScore", () => o.setScore(p, 5));
  t("setDynamicProperty", () => p.setDynamicProperty("probe:x", 1));
  t("worldDynamicProperty", () => world.setDynamicProperty("probe:y", 1));
  t("sendMessage", () => p.sendMessage("hi"));
  t("addTag", () => p.addTag("probe"));
  system.run(() => { p.teleport({ x: 3, y: -60, z: 3 }); world.sendMessage("in system.run ok"); });
});
