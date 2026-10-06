import { cmd, input, load, save, onBlock, getState, setState } from './kit';

onBlock('lab:lamp', {
  onPlayerInteract(e) {
    const on = !getState(e.block, 'lab:lit');
    setState(e.block, 'lab:lit', on);
    e.player?.sendMessage(on ? 'Lamp on' : 'Lamp off');
  },
});
cmd('lab:nick', 'Set your nickname', {}, async (p) => {
  const r = await input(p, 'Nickname', { Name: 'text' });
  if (!r) return;
  save(p, 'nick', r.Name);
  return `Nickname set: ${r.Name}`;
});
cmd('lab:whoami', 'Show your nickname', {}, (p) => `You are ${load(p, 'nick', '(none)')}`);
