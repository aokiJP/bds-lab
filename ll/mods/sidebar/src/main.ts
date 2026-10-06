// A sidebar per player: each one sees their own position and ping (Player.setSidebar sends it to that client only).
// BDS has one scoreboard for everybody: its sidebar is the same on every screen.
function paint(pl: Player): void {
  const p = pl.blockPos;
  pl.setSidebar(`§e${pl.realName}`, { '§bX': p.x, '§bY': p.y, '§bZ': p.z, '§aping': pl.getDevice().avgPing }, 1);
}
setInterval(() => { for (const pl of mc.getOnlinePlayers()) if (!pl.isSimulatedPlayer()) paint(pl); }, 500);
mc.listen('onJoin', (pl) => { paint(pl); });
logger.info('sidebar loaded');
