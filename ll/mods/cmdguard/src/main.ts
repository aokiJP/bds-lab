// Sees every command a player types, vanilla ones included, before it runs: /mute <player> [minutes] silences chat AND
// /tell /msg /w /me (a BDS script can only stop chat); short aliases (/day /night /gmc /gms) run the real command; every
// command is written to commands.log with time and place. BDS scripts cannot see or stop vanilla commands.
const WHISPER = ['tell', 'msg', 'w', 'me'];
const ALIASES: Record<string, string> = { day: 'time set day', night: 'time set night', gmc: 'gamemode creative', gms: 'gamemode survival' };
const LOG = './plugins/cmdguard/commands.log';
const muted = new Map<string, number>();
const muteLeft = (name: string): number => Math.max(0, Math.floor(((muted.get(name.toLowerCase()) ?? 0) - Date.now()) / 1000));
const stamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

mc.listen('onPlayerCmd', (pl, cmd) => {
  const line = cmd.replace(/^\//, ''), word = line.split(' ')[0].toLowerCase(), p = pl.blockPos;
  File.writeLine(LOG, `${stamp()} ${pl.realName} ${p.x} ${p.y} ${p.z} /${line}`);
  if (WHISPER.includes(word) && muteLeft(pl.realName)) { pl.tell(`§cYou are muted (${muteLeft(pl.realName)}s left)`); return false; }
  if (ALIASES[word]) { pl.runcmd(ALIASES[word] + line.slice(word.length)); return false; }
});
mc.listen('onChat', (pl) => {
  if (!muteLeft(pl.realName)) return;
  pl.tell(`§cYou are muted (${muteLeft(pl.realName)}s left)`);
  return false;
});

const mute = mc.newCommand('mute', "Silence a player's chat and whispers", PermType.GameMasters);
mute.mandatory('player', ParamType.String);
mute.optional('minutes', ParamType.Float);
mute.overload(['player', 'minutes']);
mute.setCallback((_c, _o, output, r: { player: string; minutes?: number }) => {
  const m = r.minutes ?? 10;
  if (!(m > 0 && m <= 10080)) return output.error('minutes: more than 0, at most a week');
  muted.set(r.player.toLowerCase(), Date.now() + m * 60000);
  output.success(`${r.player} muted for ${+m.toPrecision(6)} min`);
});
mute.setup();

const unmute = mc.newCommand('unmute', 'Let a player talk again', PermType.GameMasters);
unmute.mandatory('player', ParamType.String);
unmute.overload(['player']);
unmute.setCallback((_c, _o, output, r: { player: string }) => { muted.delete(r.player.toLowerCase()); output.success(`${r.player} can talk again`); });
unmute.setup();
