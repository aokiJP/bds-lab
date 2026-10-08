#!/usr/bin/env node
// The server's side of the game verbs on a real BDS with a real client (app/lib/play.mjs: where, items, face, lookat — the
// very js they send through the lab's `do`, run here by `lab.mjs bds run` with a joined client A): the player's place and
// facing read back, a turn by yaw and pitch, a turn to face a place (the yaw the lab computes for a place agrees with the
// server's), the hand and the inventory. About a minute; needs a BDS (node lab.mjs bds setup). CI's bds job runs it.
// node tests/play-bds.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const P = await import(pathToFileURL(path.join(TOP, 'app', 'lib', 'play.mjs')).href);
if (!fs.existsSync(path.join(TOP, 'bds', '.lab', 'bds', 'VERSION'))) { console.log('skip: no BDS here (node lab.mjs bds setup)'); process.exit(0); }
let fails = 0;
const ok = (c, m, d = '') => { console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : `\n    ${String(d).trim().split('\n').slice(-20).join('\n    ')}`}`); if (!c) { fails++; if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=play-bds::${m.replace(/[\r\n]+/g, ' ')}`); } };
const near = (a, b, tol = 1.5) => Number.isFinite(a) && Math.abs(P.normYaw(a - b)) <= tol;

// one fresh world: A joins, then the verbs' own js, in order
const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', 'run', '-a', 'jsonui_demo',
  '@A join', P.STATE_JS,
  P.faceJs({ yaw: 90, pitch: 10 }), 'wait 600', P.STATE_JS,
  'give A minecraft:diamond 3', 'wait 300', P.ITEMS_JS, P.STATE_JS,
], { cwd: TOP, encoding: 'utf8', timeout: 600_000, env: { ...process.env, FORCE_COLOR: '0', LAB_NOTRACE: '1' } });
const text = `${r.stdout}${r.stderr}`, lines = text.split('\n');
const all = (word) => lines.map((l) => new RegExp(`${word} (.*)$`).exec(l)?.[1]).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return x; } });
const states = all('LAB_STATE'), faces = all('LAB_FACE'), items = all('LAB_ITEMS');
ok(r.status === 0, `bds run: exit ${r.status}`, text);
ok(states.length === 3 && states.every((s) => s && s.name === 'A'), `three states of A read back: ${JSON.stringify(states)}`, text);
const [s0, s1, s2] = states;
if (s0) ok(Math.abs(s0.y - -60) < 1.5 && Math.abs(s0.x) < 2 && Math.abs(s0.z) < 2 && s0.dim === 'minecraft:overworld' && Number.isFinite(s0.hp) && Number.isFinite(s0.max), `where at the spawn: ${P.describeState(s0)}`, JSON.stringify(s0));
ok(faces[0] === 'ok', `face answered: ${JSON.stringify(faces)}`, text);
if (s1) ok(near(s1.yaw, 90) && Math.abs(s1.pitch - 10) <= 1.5 && P.compassOf(s1.yaw) === '西', `face 90 10 turned A west, 10° down: ${P.describeState(s1)}`, JSON.stringify(s1));
ok(Array.isArray(items[0]) && items[0].some((x) => /^\d+:minecraft:diamond\*3$/.test(x)), `items lists the diamonds: ${JSON.stringify(items)}`, text);
if (s2) ok(/^minecraft:diamond\*3$/.test(s2.item ?? '') && Number.isInteger(s2.slot), `where says what A holds: ${P.describeState(s2)}`, JSON.stringify(s2));

// a place to face: the lab's own yaw for it, and the server's after lookat, agree (east of A: -90)
if (s0) {
  const at = { x: s0.x + 10, y: s0.y + 1.62, z: s0.z };
  const r2 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', 'run', '-a', 'jsonui_demo', '@A join', P.faceJs({ at }), 'wait 600', P.STATE_JS],
    { cwd: TOP, encoding: 'utf8', timeout: 600_000, env: { ...process.env, FORCE_COLOR: '0', LAB_NOTRACE: '1' } });
  const t2 = `${r2.stdout}${r2.stderr}`, st = t2.split('\n').map((l) => /LAB_STATE (.*)$/.exec(l)?.[1]).filter(Boolean).map((x) => JSON.parse(x)).at(-1);
  ok(st && near(st.yaw, P.yawTo(st, at), 3) && near(st.yaw, -90, 3) && Math.abs(st.pitch) <= 3 && P.compassOf(st.yaw) === '東', `lookat east: the server's yaw ${st?.yaw} = the lab's ${st ? P.yawTo(st, at) : '?'}`, t2);
}
console.log(fails ? `FAIL play-bds (${fails})` : 'PASS play-bds');
process.exit(fails ? 1 : 0);
