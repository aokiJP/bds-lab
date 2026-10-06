#!/usr/bin/env node
// transport=lan and `node lab.mjs lan ...` without BDS: bedrock-protocol servers on this machine stand in for a local world
// (NetherNet, LAN discovery on UDP 7551, v7 advertisement) and a RakNet server. They answer the login and send player_spawn,
// so the lab's real player (common/realplayer.cjs) joins through common/nethernet-connect for real: discovery, LAN signaling,
// WebRTC/DTLS/SCTP (or RakNet), login, spawn. Checks:
//   - lan list finds both, each with its own method (world: lan / server: raknet)
//   - lan run on the world: joins the local world way; observe mode (default for a world): chat reaches it, movement does not
//   - lan run on the RakNet server with --no-observe: the real player's inputs reach it (the lab's own RakNet client under it)
//   - LAB_TRANSPORT=lan's join path (labJoin): finds the server on this machine by LAN discovery and joins
//   - lan snapshot / restore of a world folder
// First run installs nethernet-connect's dependencies (npm) into $LAB_CACHE/nc (default: <tmp>/bds-lab-lan-test).
//   node tests/lan-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = process.env.LAB_CACHE || path.join(os.tmpdir(), 'bds-lab-lan-test');
const lan = await import(path.join(TOP, 'common', 'lan.mjs'));
let good = 0, bad = 0;
const check = (ok, what, detail = '') => { console.log(`${ok ? '✔' : '✘'} ${what}${ok || !detail ? '' : '\n    ' + String(detail).slice(0, 600)}`); ok ? good++ : bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => { if (e?.code === 'ERR_SOCKET_DGRAM_NOT_RUNNING') return; throw e; });   // jsp-raknet's server after close

// without the vendored nethernet-connect (common/nethernet-connect/dist) nothing here can run: one line that says so — a
// skip (exit 0: `auto gate --all` on a copy without it), or a failure where it must be there (LAB_REQUIRE_LAN=1)
if (!fs.existsSync(path.join(TOP, 'common', 'nethernet-connect', 'dist', 'src', 'index.js'))) {
  const must = process.env.LAB_REQUIRE_LAN === '1';
  console.log(`${must ? '✘' : '-'} common/nethernet-connect/dist is missing: vendor it from the nethernet-connect project (node scripts/vendor.mjs <this lab>)\n${must ? 'FAIL' : 'SKIP'} lan-offline`);
  process.exit(must ? 1 : 0);
}
const { req } = await lan.ncLoad(CACHE);
const bp = req('bedrock-protocol');
const { CURRENT_VERSION } = req('bedrock-protocol/src/options');
const seen = { world: [], rak: [] };
function serve(tag, opts) {
  const s = bp.createServer({ offline: true, version: CURRENT_VERSION, ...opts });
  s.on('connect', (p) => {
    p.on('error', () => {});
    p.on('join', () => { seen[tag].push('join:' + p.profile?.name); p.write('play_status', { status: 'player_spawn' }); });
    p.on('packet', (pk) => { const n = pk?.data?.name; if (['text', 'player_auth_input', 'command_request', 'inventory_transaction'].includes(n)) seen[tag].push(n + (n === 'text' ? ':' + pk.data.params.message : '')); });
  });
  return s;
}
const world = serve('world', { transport: 'nethernet', host: '0.0.0.0', motd: { motd: 'Steve', levelName: 'LanTest World' }, nethernet: { networkId: 424242n } });
const RAK = 19700 + Math.floor(Math.random() * 200);
const rak = serve('rak', { transport: 'raknet', raknetBackend: 'jsp-raknet', host: '127.0.0.1', port: RAK, motd: { motd: 'LanTest RakNet', levelName: 'Rak World' } });
await sleep(1500);

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-offline-'));
const cfg = path.join(T, 'lan.json');
fs.writeFileSync(cfg, JSON.stringify({ lanPolicy: { scope: 'same-host', tailscale: { mode: 'off' } }, discovery: { raknetPorts: [RAK], httpPorts: [] }, restore: { store: path.join(T, 'snaps') }, botBehavior: { discoveryTimeoutMs: 2500 } }));
const lines = [];
const out = (l) => { lines.push(l); if (process.env.LAB_DEBUG) console.log('  ' + l); };

// ---- lan list
lines.length = 0;
await lan.lanCmd(CACHE, ['list', '--config', cfg], out);
check(lines.some((l) => /^ok +world "LanTest World" .* via lan\*/.test(l)) && lines.some((l) => /^ok +server "LanTest RakNet" .* via raknet\*/.test(l)), 'lan list: the local world (lan) and the RakNet server (raknet), each with its own method', lines.join('\n'));

// ---- lan run on the world (observe: default for a world)
const tw = path.join(T, 'world.txt');
fs.writeFileSync(tw, '## the local world way, observing\n@A join\n~ @A joined\n~ @A .*\\[route\\]\n~ @A .*\\[observe\\] player_auth_input\n## chat only\n@A chat hello-lan\nwait 800\n');
lines.length = 0;
const w0 = seen.world.length;
const okW = await lan.lanRun(CACHE, [tw, '--config', cfg, '--offline', '--world', 'LanTest World'], out);
const ws = seen.world.slice(w0);
check(okW && ws.includes('join:A') && ws.includes('text:hello-lan') && !ws.some((x) => /player_auth_input|command_request|inventory_transaction/.test(x)), 'lan run (world, observe): joined, chat reached it, no movement/commands', lines.slice(-8).join('\n') + '\nserver saw: ' + ws.join(', '));

// ---- lan run on the RakNet server, not observing
const tr = path.join(T, 'rak.txt');
fs.writeFileSync(tr, '@B join\n~ @B joined\n@B chat hi-rak\nwait 1500\n');
lines.length = 0;
const r0 = seen.rak.length;
const okR = await lan.lanRun(CACHE, [tr, '--config', cfg, '--offline', '--world', 'LanTest RakNet', '--no-observe'], out);
const rs = seen.rak.slice(r0);
check(okR && rs.includes('join:B') && rs.includes('text:hi-rak') && rs.includes('player_auth_input'), 'lan run (RakNet server, --no-observe): joined over RakNet, the real player\'s inputs reach it', lines.slice(-6).join('\n') + '\nserver saw: ' + rs.slice(0, 8).join(', '));

// ---- server commands are refused in lan run (not the lab's server)
const tc = path.join(T, 'cmd.txt');
fs.writeFileSync(tc, '@C join\nsay hello\n~ ERROR say hello: .*server command\n');
lines.length = 0;
check(await lan.lanRun(CACHE, [tc, '--config', cfg, '--offline', '--world', 'LanTest World'], out), 'lan run refuses server commands (the world is not the lab\'s)', lines.join('\n'));

// ---- LAB_TRANSPORT=lan's join path
lan.labJoinReset();
const J = await lan.labJoin(CACHE, { name: 'D' });
const { createRealPlayer } = createRequire(import.meta.url)(path.join(TOP, 'common', 'realplayer.cjs'));
const emitted = [];
let bot = null, err = '';
try { bot = await createRealPlayer({ req: J.req, lan: J, transport: 'lan', port: 19132, name: 'D', version: CURRENT_VERSION, emit: (l) => emitted.push(l), blockAt: async () => null, itemTags: async () => ({}), opts: {} }); } catch (e) { err = e.message; }
check(!!bot && seen.world.includes('join:D') && emitted.some((l) => /^@D joined/.test(l)) && J.endpoint.levelName === 'LanTest World', 'LAB_TRANSPORT=lan join: found by LAN discovery on this machine, joined the local world way', err || emitted.slice(-6).join(' | '));
bot?.close();

// ---- snapshot / restore of a world folder
const wd = path.join(T, 'worlds', 'abc');
fs.mkdirSync(path.join(wd, 'db'), { recursive: true });
fs.writeFileSync(path.join(wd, 'level.dat'), 'v1');
fs.writeFileSync(path.join(wd, 'levelname.txt'), 'Snap World');
lines.length = 0;
await lan.lanCmd(CACHE, ['snapshot', wd, '--config', cfg], out);
const id = /snapshot (\S+) /.exec(lines.join('\n'))?.[1];
fs.writeFileSync(path.join(wd, 'level.dat'), 'v2');
fs.writeFileSync(path.join(wd, 'db', 'new.ldb'), 'x');
await lan.lanCmd(CACHE, ['restore', id ?? '-', '--config', cfg], out);
check(fs.readFileSync(path.join(wd, 'level.dat'), 'utf8') === 'v1' && !fs.existsSync(path.join(wd, 'db', 'new.ldb')), 'lan snapshot / restore: a world folder back as it was', lines.join('\n'));

world.close(); rak.close();
fs.rmSync(T, { recursive: true, force: true });   // (the test's own temp folder)
console.log(`${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
setTimeout(() => process.exit(bad ? 1 : 0), 500);
