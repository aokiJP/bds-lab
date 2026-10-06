// Toasts (the card that slides in at the top): a welcome, and /notify <text> for everyone. BDS scripts cannot show toasts.
mc.listen('onJoin', (pl) => {
  if (pl.isSimulatedPlayer()) return;
  pl.sendToast('ようこそ', `${pl.realName}さん、${mc.getOnlinePlayers().length}人目のプレイヤーです`);
});
const cmd = mc.newCommand('notify', 'A toast for everyone', PermType.GameMasters);
cmd.mandatory('text', ParamType.RawText);
cmd.overload(['text']);
cmd.setCallback((_c, origin, output, r: { text: string }) => {
  for (const pl of mc.getOnlinePlayers()) pl.sendToast(`§6${origin.name}`, r.text);
  output.success('sent');
});
cmd.setup();
