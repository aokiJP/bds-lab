#!/usr/bin/env node
// Fake servers for the lab's offline tests (tests/offline.mjs). Not a Minecraft server: enough console behaviour to drive the
// engine end to end.  node fake_server.cjs bds          BDS log format, runs in cwd
//                     node fake_server.cjs ll <dir>     LeviLamina log format; loads plugins/*/manifest.json lse-* mods in a
//                                                       JS context with a small LSE (mc, logger, ll) — enough for the lab helper
// Console extras: fakejoin <name> (onJoin), fakecrash.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mode = process.argv[2] ?? 'bds';
if (process.argv[3]) process.chdir(process.argv[3]);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const now = () => { const d = new Date(); return [d, `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, pad(d.getMilliseconds(), 3)]; };
function log(level, logger, msg) {
  const [d, t, ms] = now();
  for (const line of String(msg).split('\n')) {
    if (mode === 'll') process.stdout.write(`${t}.${ms} ${level} ${logger ? `[${logger}] ` : ''}${line}\n`);
    else process.stdout.write(`[${d.toISOString().slice(0, 10)} ${t}:${ms} ${level}] ${logger ? `[${logger}] ` : ''}${line}\n`);
  }
}
const server = (m) => log('INFO', mode === 'll' ? 'Server' : null, m);

// ---- a very small LegacyScriptEngine
const mods = new Map();   // name -> { listeners, dir }
const players = [];
function makePlayer(name) {
  return { realName: name, name, xuid: '0', gameMode: 0, health: 20, maxHealth: 20, isSneaking: false, blockPos: { x: 0, y: 64, z: 0, dimid: 0 }, direction: { yaw: 0, pitch: 0 },
    tell: (m) => server(`(to ${name}) ${m}`), getInventory: () => ({ getAllItems: () => [] }), getAllTags: () => [], getHand: () => null };
}
function loadMod(name) {
  const dir = path.join('plugins', name), man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (!/^lse-/.test(man.type)) { log('INFO', 'LeviLamina', `Loading native mod ${name} (fake: skipped)`); mods.set(name, { listeners: {}, native: true }); log('INFO', 'LeviLamina', `${name} enabled`); return; }
  const listeners = {};
  const logger = { info: (m) => log('INFO', name, m), warn: (m) => log('WARN', name, m), error: (m) => log('ERROR', name, m), debug: () => {} };
  const mc = {
    listen: (ev, fn) => { (listeners[ev] ??= []).push(fn); return true; },
    newCommand: (n) => ({ overload() {}, setCallback(f) { this.cb = f; }, setup() { log('DEBUG', 'LeviLamina', `command ${n} registered`); } }),
    getOnlinePlayers: () => players, getPlayer: (n) => players.find((p) => p.realName === n),
    runcmdEx: (c) => ({ success: true, output: `ran ${c}` }), getBlock: () => null,
    spawnSimulatedPlayer: (n, x, y, z) => { const p = makePlayer(n); p.blockPos = { x, y, z, dimid: 0 }; p.simulateMoveTo = () => true; p.simulateDisconnect = () => { players.splice(players.indexOf(p), 1); fire('onLeft', p); }; players.push(p); fire('onJoin', p); return p; },
  };
  const ctx = vm.createContext({ mc, logger, ll: { hasExported: () => false }, PermType: { Any: 0, GameMasters: 1, Console: 4 }, setInterval, clearInterval, setTimeout, clearTimeout, console, globalThis: undefined });
  ctx.globalThis = ctx;
  mods.set(name, { listeners, dir });
  try { vm.runInContext(fs.readFileSync(path.join(dir, man.entry), 'utf8'), ctx, { filename: man.entry }); log('INFO', 'LeviLamina', `${name} loaded`); }
  catch (e) { log('ERROR', 'legacy-script-engine-quickjs', `${e.name}: ${e.message}`); for (const s of String(e.stack).split('\n').filter((x) => /^\s+at .*\.js:\d+/.test(x)).slice(0, 3)) log('ERROR', 'legacy-script-engine-quickjs', s.trim()); log('ERROR', 'legacy-script-engine-quickjs', `In Plugin: ${name}`); }
}
const fire = (ev, ...a) => { let pass = true; for (const m of mods.values()) for (const f of m.listeners[ev] ?? []) { try { if (f(...a) === false) pass = false; } catch (e) { log('ERROR', 'legacy-script-engine-quickjs', `${e.message} (in ${ev})`); } } return pass; };

let jsReady = false;
function handle(line) {
  const [w, ...rest] = line.split(' ');
  if (mode === 'll' && !fire('onConsoleCmd', line)) return;
  if (w === 'stop') { server('Stopping server...'); server('Quit correctly'); process.exit(0); }
  if (w === 'say') return server(`[Server] ${rest.join(' ')}`);
  if (w === 'reload') { jsReady = true; log('INFO', mode === 'll' ? 'Scripting' : 'Scripting', 'LAB_JS_READY'); return; }
  // the script profiler and diagnostics capture answer at once with a file, as BDS does (an empty profile, no frames): the lab's
  // `prof` / `perf` (and QA, which runs both) used to wait out 10 s for each reply that never came
  if (mode === 'bds' && line === 'script profiler start') return log('INFO', 'Scripting', 'Profiler started');
  if (mode === 'bds' && line === 'script profiler stop') {
    fs.writeFileSync('fake.cpuprofile', JSON.stringify({ nodes: [{ id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 } }], samples: [], timeDeltas: [], startTime: 0, endTime: 0 }));
    return log('INFO', 'Scripting', "Profile saved to './fake.cpuprofile'");
  }
  if (mode === 'bds' && line === 'script diagnostics startcapture') return log('INFO', 'Scripting', 'Diagnostics capture started');
  if (mode === 'bds' && line === 'script diagnostics stopcapture') {
    fs.writeFileSync('fake-diagnostics.json', '{}\n' + require('node:zlib').gzipSync(JSON.stringify({ stats: [] })).toString('base64') + '\n');
    return log('INFO', 'Scripting', "Diagnostics capture saved to './fake-diagnostics.json'");
  }
  if (w === 'fakecrash') { process.stdout.write('CrashReporter Key: 1234\n'); process.exit(3); }
  if (w === 'fakellcrash') {   // LeviLamina's CrashLogger: a line on the console, the symbolized stack in logs/crash/
    fs.mkdirSync(path.join('logs', 'crash'), { recursive: true });
    const mod = [...mods.keys()][0] ?? 'mod';
    fs.writeFileSync(path.join('logs', 'crash', 'trace_2026-09-24_12-00-00.log'), `Unhandled exception: ACCESS_VIOLATION\n#0 ${mod}.dll!Greet::onUse+0x1c\n#1 bedrock_server_mod.exe!Player::useItem+0x80\n#2 LeviLamina.dll!ll::event::EventBus::publish+0x44\n`);
    log('ERROR', 'CrashLogger', 'Crash detected, trace written to logs/crash'); setTimeout(() => process.exit(3), 100); return;
  }
  if (w === 'fakejoin') { const p = makePlayer(rest[0]); players.push(p); fire('onJoin', p); return; }
  if (w === 'scriptevent') {
    server(`Script event ${rest[0]} has been sent`);
    // once it said its script is ready (after reload), the lab's eval helper answers: done, no value (the engine would
    // otherwise wait out its 30 s for every `js` line)
    if (jsReady && rest[0] === 'lab:js') log('INFO', 'Scripting', 'LAB_JS_DONE');
    // the lab's end-of-command marker: the real helper answers it as soon as the command before it ran (without it the lab waited
    // 8 s once per session, then fell back to plain waits)
    // (with a tick count, that many 50 ms later, like the helper's runTimeout)
    if (mode === 'bds' && rest[0] === 'lab:sync') { const say = () => log('INFO', 'Scripting', `LAB_SYNC ${rest[1] ?? ''}`.trim()); if (Number(rest[2]) > 0) setTimeout(say, Number(rest[2]) * 50); else say(); }
    return;
  }
  if (mode === 'll' && w === 'll') {
    const [op, name] = rest;
    if (op === 'list') { log('INFO', 'LeviLamina', 'Mods:'); for (const n of ['LeviLamina', 'legacy-script-engine-quickjs', ...mods.keys()]) log('INFO', 'LeviLamina', `  ${n}`); return; }
    if (op === 'unload') { mods.delete(name); log('INFO', 'LeviLamina', `Unloading ${name}... disabled`); return; }
    if (op === 'load') { loadMod(name); return; }
  }
  server(`Unknown command: ${w}. Please check that the command exists and that you have permission to use it.`);
}

server(mode === 'll' ? 'LeviLamina 26.51.5 (fake)' : 'Starting Server');
try { const pr = fs.readFileSync('server.properties', 'utf8'); const t = /^transport=(\S+)/m.exec(pr)?.[1]; if (t) server(`transport ${t}${/^server-udp-ports=(\S+)/m.test(pr) ? ' udp ' + /^server-udp-ports=(\S+)/m.exec(pr)[1] : ''}`); } catch { /* none */ }
server('Version: 1.26.51.1');
if (mode === 'll') for (const d of fs.existsSync('plugins') ? fs.readdirSync('plugins') : []) if (fs.existsSync(path.join('plugins', d, 'manifest.json')) && !/^(LeviLamina|legacy-script-engine)/.test(d)) loadMod(d);
server('Server started.');
fire('onServerStarted');
setTimeout(() => log('INFO', 'Scripting', 'LAB_READY'), 300);   // the real one comes seconds later
let buf = '';
process.stdin.setEncoding('utf8').on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (l) handle(l); } });
setInterval(() => fire('onTick'), 50);
