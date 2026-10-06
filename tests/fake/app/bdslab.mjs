// a fake bds/lab.mjs for tests/app-offline.mjs: up / do / down / bds, writing server lines to LAB_TAIL like the real live server
import fs from 'node:fs';
const SF = process.env.FAKE_APP_STATE;
// one fake process at a time reads, changes and writes the state (the fake emulator, adb and the fake BDS run at once:
// without it an update could be lost). logcat only reads and runs for long: it takes no lock
const LOCK = `${SF}.lock`;
const takeLock = () => { for (let k = 0; k < 2000; k++) { try { fs.mkdirSync(LOCK); return; } catch { try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 10_000) fs.rmSync(LOCK, { recursive: true, force: true }); } catch { /* gone */ } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); } } };
takeLock(); process.on('exit', () => fs.rmSync(LOCK, { recursive: true, force: true }));
const S = JSON.parse(fs.readFileSync(SF, 'utf8')), save = () => { const t = `${SF}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(S)); fs.renameSync(t, SF); };
const [cmd, ...rest] = process.argv.slice(2);
(S.bds ??= []).push([cmd, ...rest].join(' ') + (process.env.LAB_TEXTUREPACK_REQUIRED ? ' [packs required]' : '') + (process.env.LAB_LAN_VISIBLE ? ' [lan visible]' : '') + (process.env.LAB_PORT ? ` [port ${process.env.LAB_PORT}]` : '') + (process.env.LAB_WATCHDOG_MS ? ` [watchdog ${process.env.LAB_WATCHDOG_MS}]` : '') + (process.env.LAB_TRANSPORT ? ` [transport ${process.env.LAB_TRANSPORT}]` : '') + (process.env.LAB_NO_DEBUGGER ? ' [no debugger]' : '')); save();
const srv = (l) => fs.appendFileSync(S.tail, l + '\n');
if (cmd === 'bds') { if (rest[0]) S.bdsVersion = rest[0]; save(); console.log(`OK bds ${S.bdsVersion ?? '1.26.52.3'} (cache only)`); }
else if (cmd === 'up') {
  if (process.env.FAKE_UP_FAIL) { console.log('E main.ts:3 Cannot find name world'); console.log('FAIL'); process.exit(1); }
  S.tail = process.env.LAB_TAIL; save(); srv('Server started.');
  // like the real live server: .lab/live.json next to lab.mjs, with the port it really took (FAKE_PORT_TAKEN: 19132 was busy)
  fs.mkdirSync(new URL('./.lab/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('./.lab/live.json', import.meta.url), JSON.stringify({ pid: process.pid, port: Number(process.env.FAKE_PORT_TAKEN || process.env.LAB_PORT), ready: true }));
  console.log('OK live (jsonui_demo): node lab.mjs do <cmd>...');
}
else if (cmd === 'down') { fs.rmSync(new URL('./.lab/live.json', import.meta.url), { force: true }); console.log('OK down'); }
else if (cmd === 'do') {
  console.log('> ' + rest[0]);
  if (/demo:open/.test(rest[0])) { S.phase = 'form'; save(); srv('[Scripting] DEMO shown to 1'); console.log('DEMO shown to 1'); }
  // a title on the HUD (the fake screen shows it as a band), cleared by `title @a clear`
  if (/^title @a (title|actionbar) /.test(rest[0])) { S.hud = true; save(); }
  if (/^title @a clear$/.test(rest[0])) { S.hud = false; save(); }
  // a form shown through js, the player killed (the death screen until Respawn is tapped)
  if (/^js .*\.show\(/.test(rest[0])) { S.phase = 'form'; save(); }
  if (/^kill @a$/.test(rest[0])) { S.phase = 'screen'; S.dead = true; save(); }
  // kicked: the disconnect screen (the fake device shows it as an opened screen)
  if (/^kick @a\b/.test(rest[0])) { S.phase = 'screen'; save(); }
  if (/^boom/.test(rest[0])) { console.log('E unknown command'); console.log('FAIL'); process.exit(1); }
  console.log('OK');
}
