// The server list line written live: players online (mc.setMotd). BDS shows a fixed server name.
function update(): void {
  const n = mc.getOnlinePlayers().filter((p) => !p.isSimulatedPlayer()).length;
  mc.setMotd(`§a${n}人がプレイ中`);
}
mc.listen('onJoin', () => { update(); });
mc.listen('onLeft', () => { setTimeout(update, 50); });
mc.listen('onServerStarted', () => { update(); });
setTimeout(update, 100);
