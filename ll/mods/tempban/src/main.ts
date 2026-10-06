// /tempban <player> <minutes> [reason]: kicks now and refuses the player's login until the time is up, showing the reason
// and the time left on their disconnect screen; kept across restarts (bans.json). /bans lists them, /unban2 lifts one early.
// BDS scripts can kick, but cannot refuse a login or show why.
type Ban = { name: string; reason: string; until: number };
const FILE = './plugins/tempban/bans.json';
let bans: Record<string, Ban> = JSON.parse(File.readFrom(FILE) ?? '{}');
const left = (until: number): string => { const s = Math.max(0, Math.floor((until - Date.now()) / 1000)); return `${Math.floor(s / 60)}m ${s % 60}s`; };
const keep = (): void => { bans = Object.fromEntries(Object.entries(bans).filter(([, b]) => b.until > Date.now())); File.writeTo(FILE, JSON.stringify(bans)); };
const banOf = (name: string): Ban | undefined => { const b = bans[name.toLowerCase()]; return b && b.until > Date.now() ? b : undefined; };

mc.listen('onPreJoin', (pl) => {
  const b = banOf(pl.realName);
  if (!b) return;
  pl.kick(`Banned: ${b.reason} (${left(b.until)} left)`);
  return false;
});

const ban = mc.newCommand('tempban', 'Ban a player for some minutes', PermType.GameMasters);
ban.mandatory('player', ParamType.String);
ban.mandatory('minutes', ParamType.Float);
ban.optional('reason', ParamType.RawText);
ban.overload(['player', 'minutes', 'reason']);
ban.setCallback((_c, _o, output, r: { player: string; minutes: number; reason?: string }) => {
  if (!(r.minutes > 0 && r.minutes <= 525600)) return output.error('minutes: more than 0, at most a year');
  const reason = r.reason?.trim() || 'no reason given', until = Date.now() + r.minutes * 60000;
  bans[r.player.toLowerCase()] = { name: r.player, reason, until };
  keep();
  mc.getPlayer(r.player)?.kick(`Banned: ${reason} (${left(until)} left)`);
  output.success(`${r.player} banned for ${+r.minutes.toPrecision(6)} min: ${reason}`);
});
ban.setup();

const list = mc.newCommand('bans', 'List timed bans', PermType.GameMasters);
list.overload([]);
list.setCallback((_c, _o, output) => { keep(); output.success('timed bans: ' + (Object.values(bans).map((b) => `${b.name}: ${b.reason} (${left(b.until)} left)`).join(' | ') || 'none')); });
list.setup();

const unban = mc.newCommand('unban2', 'Lift a timed ban', PermType.GameMasters);
unban.mandatory('player', ParamType.String);
unban.overload(['player']);
unban.setCallback((_c, _o, output, r: { player: string }) => {
  if (!banOf(r.player)) return output.error(`${r.player} is not banned`);
  delete bans[r.player.toLowerCase()];
  keep();
  output.success(`${r.player} can join again`);
});
unban.setup();
