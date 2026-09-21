import { world, system } from '@minecraft/server';
import { CONFIG } from './config.js';
import { lab } from './lab.js';

const log = (...a) => console.warn(`__TAG__ ${a.join(' ')}`);

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const [ns, cmd] = ev.id.split(':');
  if (ns !== '__NS__') return;
  // getAllPlayers() は undefined を混ぜて返すことがある。必ず弾いてから使う
  const player = ev.sourceEntity ?? world.getAllPlayers().filter(Boolean)[0];
  switch (cmd) {
    case 'status':
      log('status', `enabled=${CONFIG.enabled}`, player?.name ?? '-');
      lab.metric('enabled', CONFIG.enabled);
      break;
    default: log('unknown', cmd);
  }
}, { namespaces: ['__NS__'] });

log('loaded', 'v0.1.0');
