// An economy other mods share (LegacyMoney): 1 coin per block broken, /balance, /pay <player> <amount> with a history.
// BDS addons cannot share a live API with each other (only scriptevent strings), and have no economy service.
const acct = (pl: Player): string => pl.xuid || `lab-${pl.uuid}`;   // offline servers have no xuid: a stable stand-in
mc.listen('onDestroyBlock', (pl) => { money.add(acct(pl), 1); });
const bal = mc.newCommand('balance', 'Your coins', PermType.Any);
bal.overload([]);
bal.setCallback((_c, origin, output) => {
  const pl = origin.player;
  if (!pl) return output.error('players only');
  output.success(`${pl.realName}: ${money.get(acct(pl))} coins`);
});
bal.setup();
const pay = mc.newCommand('pay', 'Give coins to a player', PermType.Any);
pay.mandatory('to', ParamType.String);
pay.mandatory('amount', ParamType.Int);
pay.overload(['to', 'amount']);
pay.setCallback((_c, origin, output, r: { to: string; amount: number }) => {
  const pl = origin.player, to = mc.getPlayer(r.to);
  if (!pl) return output.error('players only');
  if (!to || to.realName === pl.realName) return output.error(`${r.to}: not another online player`);
  if (!(r.amount > 0)) return output.error('amount: 1 or more');
  if (money.get(acct(pl)) < r.amount) return output.error(`not enough coins (${money.get(acct(pl))})`);
  money.trans(acct(pl), acct(to), r.amount, `pay ${pl.realName} -> ${to.realName}`);
  to.tell(`${pl.realName} sent you ${r.amount} coins`);
  output.success(`paid ${r.amount} to ${to.realName}: ${money.get(acct(pl))} left`);
});
pay.setup();
