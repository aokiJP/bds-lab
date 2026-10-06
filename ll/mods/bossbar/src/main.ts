// /countdown <seconds> [title]: a boss bar only this player sees, draining to zero, then a title.
// BDS scripts have no boss bar API.
const bars = new Map<string, number>();
const cmd = mc.newCommand('countdown', 'A countdown boss bar', PermType.Any);
cmd.mandatory('seconds', ParamType.Int);
cmd.optional('title', ParamType.RawText);
cmd.overload(['seconds', 'title']);
cmd.setCallback((_c, origin, output, r: { seconds: number; title?: string }) => {
  const pl = origin.player;
  if (!pl) return output.error('players only');
  const total = Math.max(1, Math.min(3600, r.seconds)), title = r.title || 'Countdown', uid = 4242;
  const old = bars.get(pl.xuid || pl.realName);
  if (old !== undefined) clearInterval(old);
  let left = total;
  pl.setBossBar(uid, `${title} ${left}`, 100, 3);
  const id = setInterval(() => {
    left--;
    const now = mc.getPlayer(pl.realName);
    if (!now || left <= 0) {
      clearInterval(id);
      bars.delete(pl.xuid || pl.realName);
      if (now) { now.removeBossBar(uid); now.setTitle('Time!'); now.setTitle(title, 3); }
      return;
    }
    now.setBossBar(uid, `${title} ${left}`, Math.round((left / total) * 100), left / total < 0.3 ? 2 : left / total < 0.6 ? 4 : 3);
  }, 1000) as unknown as number;
  bars.set(pl.xuid || pl.realName, id);
  output.success(`countdown ${total}s`);
});
cmd.setup();
