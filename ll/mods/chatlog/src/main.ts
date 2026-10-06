// Every chat line appended to a dated log file (plugins/chatlog/logs/YYYY-MM-DD.log); /chatlog [n] shows the last lines.
// BDS scripts cannot write files.
File.mkdir('./plugins/chatlog/logs');
const day = (): string => new Date().toISOString().slice(0, 10);
const logFile = (): string => `./plugins/chatlog/logs/${day()}.log`;
mc.listen('onChat', (pl, msg) => {
  File.writeLine(logFile(), `${new Date().toISOString().slice(11, 19)} <${pl.realName}> ${msg}`);
});
const cmd = mc.newCommand('chatlog', 'The last chat lines', PermType.GameMasters);
cmd.optional('n', ParamType.Int);
cmd.overload(['n']);
cmd.setCallback((_c, _o, output, r: { n?: number }) => {
  const lines = (File.readFrom(logFile()) ?? '').trim().split('\n').filter(Boolean);
  output.success(lines.slice(-(r.n ?? 3)).join(' / ') || 'no chat today');
});
cmd.setup();
