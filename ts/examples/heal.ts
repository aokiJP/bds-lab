// node lab.mjs ts ts/examples/heal.ts: look after everyone on the server (a one-off admin task, no command block, no reload)
for (const p of world.getAllPlayers()) {
  const h = p.getComponent("minecraft:health");
  h?.resetToMaxValue();
  p.runCommand("effect @s saturation 1 10 true");
}
world.getAllPlayers().length + " player(s) healed"
