// @every 20
// node lab.mjs ts save ts/examples/clock.ts: every second, the time of day on everyone's action bar
for (const p of world.getAllPlayers()) p.onScreenDisplay.setActionBar(`time ${world.getTimeOfDay()}`);
