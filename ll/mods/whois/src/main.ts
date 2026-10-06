// /whois <player>: address, ping, packet loss, device OS and client id. BDS scripts see none of these.
const cmd = mc.newCommand('whois', 'Who is that player', PermType.GameMasters);
cmd.mandatory('name', ParamType.String);
cmd.overload(['name']);
cmd.setCallback((_c, _o, output, r: { name: string }) => {
  const pl = mc.getPlayer(r.name);
  if (!pl) return output.error(`${r.name} is not online`);
  const d = pl.getDevice();
  output.success(`${pl.realName}: ip ${d.ip} ping ${d.avgPing}ms loss ${d.avgPacketLoss}% | ${d.os} | client ${d.clientId.slice(0, 8)} | op ${pl.isOP()}`);
});
cmd.setup();
