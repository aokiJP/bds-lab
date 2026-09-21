import { system } from '@minecraft/server';

const send = (op, body) => {
  console.warn(`lab:action ${JSON.stringify({ op, ...body })}`);
};

export const lab = {
  note: (text) => send('note', { text: String(text) }),
  metric: (key, value) => send('metric', { key: String(key), value }),
  fail: (reason) => send('fail', { reason: String(reason) }),
  command: (command) => send('command', { command: String(command).replace(/^\//, '') }),
  reload: () => send('reload', {}),
  save: (name, text) => send('save', { name: String(name), text: String(text) }),
  shell: (command, args = []) => send('shell', { command: String(command), args }),
  every: (ticks, fn) => system.runInterval(fn, ticks),
};

export default lab;
