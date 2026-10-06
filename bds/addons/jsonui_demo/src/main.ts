// JSON UI Demo: a server form whose title starts with the marker DEMO is drawn by this pack's own JSON UI (rp/ui/server_form.json).
// The server only sends the form; how it looks is decided in the client. `node lab.mjs app run` shows it in the real app and takes a screenshot.
import { world, system, Player } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { cmd, cmdAny, ask } from './kit';

export const DEMO = '§d§e§m§o§r';   // invisible colour codes: the JSON UI routes on them

async function menu(p: Player): Promise<string> {
  const f = new ActionFormData()
    .title(DEMO + 'JSON UI Demo')
    .body('This form is drawn by rp/ui/server_form.json.')
    .button('Diamond', 'textures/items/diamond')
    .button('Emerald', 'textures/items/emerald')
    .button('Close');
  const r = await ask(p, f);
  const pick = r === undefined || r.canceled || r.selection === undefined ? 'closed' : ['diamond', 'emerald', 'close'][r.selection];
  console.log(`DEMO ${p.name} picked ${pick}`);
  return pick;
}

// a player opens it
cmd('lab:menu', 'Open the JSON UI demo form', {}, (p) => { void menu(p); return 'DEMO opening'; });
// the console (tests, the app runner) opens it for every player
cmdAny('lab:menuall', 'Open the JSON UI demo form for every player', {}, () => {
  const ps = world.getAllPlayers();
  for (const p of ps) void menu(p);
  return `DEMO shown to ${ps.length}`;
});
system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id !== 'demo:open') return;
  const ps = world.getAllPlayers();
  for (const p of ps) void menu(p);
  console.log(`DEMO shown to ${ps.length}`);
});
