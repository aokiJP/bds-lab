import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

// homes are saved on the player (dynamic property), so they survive restarts
const getHome = (p) => { const s = p.getDynamicProperty("home"); try { return typeof s === "string" ? JSON.parse(s) : undefined; } catch { return undefined; } };
const setHome = (p) => { const { x, y, z } = p.location; p.setDynamicProperty("home", JSON.stringify({ x, y, z, dim: p.dimension.id })); };
const goHome = (p) => {
  const h = getHome(p);
  if (!h) { p.sendMessage("§cNo home yet: say !sethome first"); return; }
  p.teleport({ x: h.x, y: h.y, z: h.z }, { dimension: world.getDimension(h.dim ?? "overworld") });
  p.sendMessage("§aWelcome home!");
};

// !sethome / !home in chat (a before-event is read-only: the change runs in system.run)
world.beforeEvents.chatSend.subscribe((ev) => {
  const msg = ev.message.trim(), p = ev.sender;
  if (msg === "!sethome") { ev.cancel = true; system.run(() => { setHome(p); p.sendMessage("§aHome set!"); }); }
  if (msg === "!home") { ev.cancel = true; system.run(() => goHome(p)); }
});

// right click a compass: teleport menu
world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack.typeId !== "minecraft:compass") return;
  const p = ev.source;
  new ActionFormData().title("Teleport").body("Where to?").button("Spawn").button("Home").button("Player").show(p).then((r) => {
    if (r.canceled) return;
    if (r.selection === 0) { p.teleport({ x: 0, y: -60, z: 0 }, { dimension: world.getDimension("overworld") }); p.sendMessage("§eTeleported to spawn"); }
    if (r.selection === 1) goHome(p);
    if (r.selection === 2) {
      const players = world.getPlayers().filter((x) => x.id !== p.id);
      if (!players.length) { p.sendMessage("§cNobody else is online"); return; }
      new ModalFormData().title("To player").dropdown("Player", players.map((x) => x.name)).show(p).then((r2) => {
        if (r2.canceled || !r2.formValues) return;
        const target = players[Number(r2.formValues[0])];
        if (!target?.isValid) { p.sendMessage("§cThat player left"); return; }
        p.teleport(target.location, { dimension: target.dimension });
        p.sendMessage("§eTeleported to " + target.name);
      });
    }
  });
});

// everyone gets one compass (not another on every respawn)
world.afterEvents.playerSpawn.subscribe((ev) => {
  const inv = ev.player.getComponent("inventory")?.container;
  if (!inv) return;
  for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === "minecraft:compass") return;
  ev.player.runCommand("give @s compass");
});
