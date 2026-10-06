// /hub [server]: sends the player to another server (a lobby network). BDS scripts cannot transfer players.
const conf = new JsonConfigFile('./plugins/hub/servers.json', JSON.stringify({ lobby: ['127.0.0.1', 19132], survival: ['127.0.0.1', 19134] }));
const cmd = mc.newCommand('hub', 'Go to another server', PermType.Any);
cmd.optional('server', ParamType.String);
cmd.overload(['server']);
cmd.setCallback((_c, origin, output, r: { server?: string }) => {
  const pl = origin.player;
  if (!pl) return output.error('players only');
  const all = JSON.parse(conf.read()) as Record<string, [string, number]>;
  const name = r.server ?? Object.keys(all)[0];
  if (!all[name]) return output.success(`servers: ${Object.keys(all).join(', ')}`);
  const [host, port] = all[name];
  output.success(`-> ${name} (${host}:${port})`);
  setTimeout(() => { pl.transServer(host, port); }, 100);
});
cmd.setup();
