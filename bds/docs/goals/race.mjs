#!/usr/bin/env node
// Many RTAs at once on real BDS: every player a real client, each set down at its own spot far from the others (its own trees, its
// own caves), all running at the same time; several servers side by side when one is not enough; the servers' clocks sped up.
// Results go into results.json (key seed:goal:race...) and are printed with the servers' measured tick rate.
//   node docs/goals/race.mjs [seed] [options] [goal...]         goal: an item (rta_<item>), challenge_<name>, quest_<verb>
//     --players n    fill n players by repeating the goals (default: one per goal)
//     --servers k    split the players over k servers (default: 1 per 10 players, at most the CPU count)
//     --speed x      LAB_SPEED: each server's clock x times as fast (libfaketime; its 20 ticks/s become 20x) (default 1)
//     --view n       view-distance in chunks (default 6: 96 blocks, what the planner looks at; less land to generate and send)
//     --gap blocks   distance between the players' spots (default 320)
//     --difficulty d easy (default: the usual speedrun setting) | normal | hard     --day   no nights (daylight cycle off)
//     --max          as many players as this machine keeps: servers on 3/4 of the cores, players per server from the capacity
//                    measured in earlier races (.lab/race-capacity.json)
//     --hud          each runner's timer and current step on its screen (for watching with a real client)
//     --seeds a,b,c  servers play different seeds (server k: the k-th, round robin)
//     --spot a,b,c   player i starts at spot number list[i] (1 = the first spot along x; spot n of a race = its Pnn), the rest
//                    after the last: run a spot again alone (e.g. --spot 5 bread: P05's ground from the last race)
//     --same-start   the speedrunners' fair race: every runner on a server of its own, all at the same world spawn (no spreading)
//     --pregen       first generate the land at every spot once and keep it in the seed's template world (chunk generation is
//                    the heaviest work of BDS; loading saved chunks is cheap). Done once per seed / spot layout, then reused.
//                    Each spot is then moved once to a fair start near it (`pick_start`: trees in reach, dry land, animals; not the
//                    sea, not a dark forest), as a runner resets a hopeless spawn; --no-pick keeps the spots as they are
//   live: tail -f docs/goals/.logs/race-<k>.log
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOP = path.resolve(HERE, '..', '..');
const UNIT = path.join(HERE, '..', 'verbs', 'lab.mjs');
const RES = path.join(HERE, 'results.json'), LOGS = path.join(HERE, '.logs');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const gap = Number(opt('--gap', 320)), speed = Number(opt('--speed', process.env.LAB_SPEED || 1)), view = String(opt('--view', process.env.LAB_VIEW || 6));
let nPlayers = Number(opt('--players', 0)), serversOpt = Number(opt('--servers', 0));
const pregen = flag('--pregen'), max = flag('--max'), hud = flag('--hud'), sameStart = flag('--same-start'), seedList = String(opt('--seeds', '')).split(',').filter((x) => /^\d+$/.test(x));   // --hud: every runner's timer and step on its screen (actionbar)
const spotList = String(opt('--spot', '')).split(',').filter((x) => /^\d+$/.test(x)).map(Number);   // --spot 5 / 3,5,9
const difficulty = opt('--difficulty', 'easy'), alwaysDay = flag('--day'), pickSpots = !flag('--no-pick');   // easy: the usual speedrun setting; --day: no nights (daylight cycle off)
const seed = /^\d+$/.test(args[0] ?? '') ? args.shift() : '1';
const SEEDS = seedList.length ? seedList : [seed];   // --seeds 1,2,3: server k plays SEEDS[k % n] (different worlds side by side)
const seedOf = (k) => SEEDS[k % SEEDS.length];
// (the default card: what a start with no village in reach can finish in the time; wheat - bread, breeding - comes from a village's
// hay or a farm that takes longer than a race: `race.mjs 1 bread quest_breed_cow` when wanted)
const BASE = args.length ? args : ['stone_pickaxe', 'iron_pickaxe', 'bucket', 'shield', 'quest_eat_cooked_beef', 'challenge_iron_tools', 'challenge_bingo_1', 'quest_shear', 'challenge_depth_y0', 'challenge_walk_250'];
// --max: as many players as this machine can keep at the chosen speed. A BDS runs its world on one core, so: servers on 3/4 of
// the cores (the clients and the OS get the rest), each with as many players as it kept up with last time (capacity = players x
// speed it held, learned after every race in .lab/race-capacity.json; 40 = 10 players at 4x until measured)
const CAPF = path.join(TOP, '.lab', 'race-capacity.json'), MAXP = 40;   // players on one server at most (each is also a client in the lab's node process)
const cap = (() => { try { return JSON.parse(fs.readFileSync(CAPF, 'utf8')).perServer || 40; } catch { return 40; } })();
if (max) {
  serversOpt ||= Math.max(1, Math.floor(os.cpus().length * 0.75));
  nPlayers ||= serversOpt * Math.min(MAXP, Math.max(1, Math.floor(cap / speed)));
}
const GOALS = nPlayers ? Array.from({ length: nPlayers }, (_, i) => BASE[i % BASE.length]) : BASE;
// --same-start: the fair race of speedrunners (same seed, same spawn): every runner on a server of its own, at the world spawn
const servers = sameStart ? GOALS.length : serversOpt || Math.min(Math.max(1, os.cpus().length), Math.ceil(GOALS.length / 10));
if (sameStart && servers > os.cpus().length) console.log(`--same-start: ${servers} servers on ${os.cpus().length} cores: they will lag (tick rate below), fewer runners or a lower --speed`);
if (max) console.log(`--max: ${os.cpus().length} cores -> ${servers} server(s) x ${Math.ceil(GOALS.length / servers)} players at x${speed} (capacity ${cap} player-speed per server)`);
const MIN = Number(process.env.LAB_RTA_MINUTES) || 40;   // game minutes per RTA (a day and its night: a night dug in is ~9 of them)
const env0 = { ...process.env, LAB_WORLD: 'normal', LAB_VIEW: view, LAB_SPEED: String(speed), LAB_RTA_MINUTES: String(MIN), LAB_RTA_SPAWNPOINT: '1', LAB_DIFFICULTY: difficulty, LAB_MAX: '100000000' };
delete env0.LAB_TICK_MS;   // the lab sets it from LAB_SPEED
fs.mkdirSync(LOGS, { recursive: true });
const verbOf = (g) => (/^(challenge|quest|rta)_/.test(g) ? g : `rta_${g}`);
const pname = (i) => `P${String(i + 1).padStart(2, '0')}`;
// the spots: server k's players along x at z = k * gap
const groups = Array.from({ length: servers }, () => []);
GOALS.forEach((g, i) => groups[i % servers].push(g));
const spotNo = (i) => (i < spotList.length ? spotList[i] : (spotList.at(-1) ?? 0) + i - spotList.length + 1);   // 1-based along x
const spot = (i, k) => [spotNo(i) * gap, k * gap];
// the speed a server of n players can be counted on for (half of what it held before, never above the one asked): the clocks of the
// wall-time safety caps below (the RTAs stop themselves at MIN minutes of game time; a server that cannot hold --speed 50 runs at
// what it can, and a cap from the asked speed cut the RTAs short)
const sure = (n) => Math.max(0.5, Math.min(speed, cap / Math.max(1, n)) * 0.5);
const run = (cmds, log, extraEnv = {}, wallMin = MIN / sure(Math.ceil(GOALS.length / servers)) + 15) => new Promise((res) => {   // extraEnv carries LAB_SEED
  fs.rmSync(log, { force: true });
  const t0 = Date.now();
  const ch = spawn(process.execPath, [UNIT, 'run', ...cmds, '-w', '200'], { cwd: path.dirname(UNIT), env: { ...env0, LAB_TAIL: log, ...extraEnv }, stdio: ['ignore', 'ignore', 'ignore'] });
  const kill = setTimeout(() => ch.kill('SIGTERM'), wallMin * 60000);
  ch.on('exit', () => { clearTimeout(kill); res(Math.round((Date.now() - t0) / 1000)); });
});

// ---- once per seed: the land at every spot generated and kept in that seed's template ----
async function pregenSeed(sd) {
  const marker = path.join(TOP, '.lab', `race-pregen-${sd}.json`);
  const layout = { gap, view, spots: groups.map((g, k) => (seedOf(k) === sd ? g.map((_, i) => spot(i, k)) : [])).flat() };
  const tplDat = path.join(TOP, '.lab', `world-normal-${sd}`, 'level.dat');
  const have = (() => { try { const m = JSON.parse(fs.readFileSync(marker, 'utf8')); return m.mtime === fs.statSync(tplDat).mtimeMs && layout.spots.every(([x, z]) => m.spots.some(([a, b]) => a === x && b === z) && (!pickSpots || m.picked?.[`${x},${z}`])) && Number(m.view) >= Number(view); } catch { return false; } })();
  if (have || !layout.spots.length) return;
  const cmds = [], names = layout.spots.map((_, i) => `pg${i}`);
  names.forEach((n) => cmds.push(`@${n} join`));
  cmds.push('gamerule dodaylightcycle false', 'gamerule domobspawning false', 'time set 1000', 'wait 2000');
  layout.spots.forEach(([x, z], i) => cmds.push(`effect ${names[i]} slow_falling 100000 0 true`, `effect ${names[i]} resistance 100000 4 true`, `spreadplayers ${x} ${z} 0 1 ${names[i]}`, 'wait 500'));
  names.forEach((n) => cmds.push(`@${n}& wait_world ${Number(view) * 16 - 24} 600`));
  cmds.push('waitall 900000');
  if (pickSpots) { names.forEach((n) => cmds.push(`@${n}& pick_start 160`)); cmds.push('waitall 3600000'); }   // (the land it went to see is in the template too)
  // the template keeps the game's own rules (daylight cycle, mob spawning) and a morning without monsters
  cmds.push('kill @e[family=monster]', 'gamerule dodaylightcycle true', 'gamerule domobspawning true', 'time set 0', 'wait 1000', 'template save');
  console.log(`pregen seed ${sd}: generating ${layout.spots.length} spots (view ${view}) ...`);
  const log = path.join(LOGS, `pregen-${sd}.log`);
  const wall = await run(cmds, log, { LAB_SPEED: '1', LAB_SEED: sd }, 100);
  const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const saved = /template saved: .*/.exec(text)?.[0];
  console.log(`pregen seed ${sd}: ${saved ?? `NOT saved (see ${path.relative(TOP, log)})`} in ${wall} s`);
  const picked = {};
  layout.spots.forEach(([x, z], i) => { const m = new RegExp(`^@pg${i} pick_start: at (-?\\d+) (-?\\d+) (.*)$`, 'm').exec(text); if (m) { picked[`${x},${z}`] = [Number(m[1]), Number(m[2])]; console.log(`  spot ${x} ${z} -> ${m[1]} ${m[2]} ${m[3]}`); } });
  if (saved) fs.writeFileSync(marker, JSON.stringify({ ...layout, ...(pickSpots ? { picked } : {}), mtime: fs.statSync(tplDat).mtimeMs }));
}
// where a spot's runner starts: the fair place picked for it in the pregen, else the spot itself
const PICKED = {};
const startOf = (i, k) => {
  const [x, z] = spot(i, k), sd = seedOf(k);
  if (!pickSpots) return [x, z];
  PICKED[sd] ??= (() => { try { return JSON.parse(fs.readFileSync(path.join(TOP, '.lab', `race-pregen-${sd}.json`), 'utf8')).picked ?? {}; } catch { return {}; } })();
  return PICKED[sd][`${x},${z}`] ?? [x, z];
}
if (pregen && !sameStart) for (const sd of SEEDS) await pregenSeed(sd);   // one at a time: each saves its own template

// ---- the race: on each server join all, spread out, start every RTA without waiting, wait for all ----
const runGroup = async (goals, k) => {
  const log = path.join(LOGS, `race-${k}.log`), cmds = [];
  goals.forEach((g, i) => cmds.push(`@${pname(i)} join`));
  // while everyone's ground comes in, the world holds still: noon, no new monsters (a spot can take minutes on a busy server)
  cmds.push('gamerule dodaylightcycle false', 'gamerule domobspawning false', 'time set 1000', 'wait 2000');
  // a spot not generated yet comes in while the player is there: no fall damage, no harm meanwhile (cleared at the start)
  if (!sameStart) goals.forEach((g, i) => { const [x, z] = startOf(i, k); cmds.push(`effect ${pname(i)} slow_falling 100000 0 true`, `effect ${pname(i)} resistance 100000 4 true`, `spreadplayers ${x} ${z} 0 1 ${pname(i)}`, 'wait 300'); });   // until the start clears them
  // everyone's ground loaded first (a far spot still comes in from disk or is generated), then one fair start for all: a fresh
  // morning (day 1000: the sun already burns monsters), no monster left over, the landing effects gone
  goals.forEach((g, i) => cmds.push(`@${pname(i)}& wait_world 48 240`));
  cmds.push('waitall 300000');
  // a spot whose land was not there yet put the player at the top of the world (spreadplayers finds no ground): now that the
  // land is in, set it down on it (instead of a slow fall of 200 blocks)
  if (!sameStart) goals.forEach((g, i) => { const [x, z] = startOf(i, k); cmds.push(`spreadplayers ${x} ${z} 0 1 ${pname(i)}`); });
  cmds.push('wait 1500');
  // (and clear weather: a start in the rain - no monster burns - was ten minutes of running from zombies; the weather goes on from there)
  cmds.push('kill @e[family=monster]', 'effect @a clear', 'time set 1000', 'weather clear', ...(alwaysDay ? [] : ['gamerule dodaylightcycle true']), 'gamerule domobspawning true', 'wait 1000');
  goals.forEach((g, i) => cmds.push(`@${pname(i)}& ${verbOf(g)}${hud ? ' hud' : ''}`));
  // the RTAs stop themselves at MIN game minutes; a lagging server runs slower than `speed`, so the wall-clock cap leaves room for that
  cmds.push(`waitall ${Math.round(((MIN + 3) * 60000) / sure(goals.length) + 120000)}`);
  goals.forEach((g, i) => cmds.push(`js return 'inventory ${pname(i)}: '+inv('${pname(i)}').join(' ')`));
  const wall = await run(cmds, log, { LAB_SEED: seedOf(k) });
  return { goals, log, wall, k };
};
const t0 = Date.now();
console.log(`race: ${GOALS.length} players on ${servers} server(s), seed${SEEDS.length > 1 ? 's' : ''} ${SEEDS.join(',')}, speed x${speed}, view ${view}, ${difficulty}${alwaysDay ? ', always day' : ''}${sameStart ? ', same start (one server each)' : ''}${pregen && !sameStart ? ', pregenerated land' : ''}`);
// while it runs: every 30 s one line per server (finished / stopped / still running, deaths so far, the last tick rate)
const live = setInterval(() => {
  const parts = groups.map((goals, k) => {
    if (!goals.length) return null;
    let text = ''; try { text = fs.readFileSync(path.join(LOGS, `race-${k}.log`), 'utf8'); } catch { return `s${k}: starting`; }
    const fin = (text.match(/^@P\d+ (?:rta|challenge|quest)_\S+: done in/gm) ?? []).length, stop = (text.match(/^@P\d+ (?:rta|challenge|quest)_\S+: stopped after/gm) ?? []).length;
    const deaths = (text.match(/^@P\d+ died/gm) ?? []).length, tps = [...text.matchAll(/^tps ([\d.]+)/gm)].map((m) => m[1]).at(-1) ?? '?';
    return `s${k}: ${fin} done ${stop} stopped ${goals.length - fin - stop} running, ${deaths} deaths, ${tps} tick/s`;
  }).filter(Boolean);
  console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${parts.join(' | ')}`);
}, 30000);
const done = await Promise.all(groups.map((g, k) => (g.length ? runGroup(g, k) : null)).filter(Boolean));
clearInterval(live);
const results = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, 'utf8')) : {};
let ok = 0;
for (const { goals, log, wall, k } of done) {
  const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const tps = [...text.matchAll(/^tps ([\d.]+)/gm)].map((m) => +m[1]);
  const avg = tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : null;
  console.log(`server ${k} (seed ${seedOf(k)}): ${goals.length} players, ${wall} s wall, tick rate ${avg ? `avg ${avg.toFixed(0)} min ${Math.min(...tps).toFixed(0)} max ${Math.max(...tps).toFixed(0)}` : '?'} (full speed ${20 * speed})`);
  // what this server could keep up with: below 90% of the aimed rate it lags (spread the players over more servers or slow down)
  if (avg && avg < 18 * speed) console.log(`  lagging: ${(avg / 20).toFixed(1)}x reached of x${speed}; with ${goals.length} players this machine keeps about --speed ${Math.max(1, Math.floor((avg / 20) * 0.95))} per server, or more servers (--servers ${servers + 1}) if there are free cores (${os.cpus().length} here)`);
  goals.forEach((g, i) => {
    const P = pname(i), v = verbOf(g).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mine = text.split('\n').filter((l) => l.startsWith(`@${P} `) || l.includes(`inventory ${P}:`)).join('\n');
    const res = new RegExp(`^@${P} ${v}: (done in (\\d+)m(\\d+)s.*|stopped after .*)$`, 'm').exec(mine);
    const fails = [...mine.matchAll(new RegExp(`^@${P} get: (?:\\[[\\d:]+\\] )?step failed: (.+)$`, 'gm'))].map((m) => m[1]);
    // (deaths during the run: after its end the runner stands about until the race is over, and the night gets it - not the run's)
    const endAt = res ? mine.indexOf(res[0]) : -1, during = endAt >= 0 ? mine.slice(0, endAt) : mine;
    const deaths = (during.match(new RegExp(`^@${P} died`, 'gm')) ?? []).length;
    const splits = new RegExp(`^@${P} ${v} splits: (.*)$`, 'm').exec(mine)?.[1]?.split(' | ') ?? [];
    if (res?.[2]) ok++;
    results[`${seedOf(k)}:${g}:race${k}-${i}`] = { seed: seedOf(k), goal: `${g} (race x${speed})`, ok: !!res?.[2], sec: res?.[2] ? +res[2] * 60 + +res[3] : null, wall, steps: splits.length, fails: fails.slice(0, 5), deaths,
      why: res?.[2] ? null : res?.[1] ?? 'no result (see the log)', inv: (new RegExp(`inventory ${P}: (.*)$`, 'm').exec(mine)?.[1] ?? '').slice(0, 300), route: [], splits: splits.slice(0, 60), at: new Date().toISOString().slice(0, 16) };
    console.log(`  ${res?.[2] ? '✔' : '✘'} ${P} ${verbOf(g)}: ${res?.[1] ?? 'no result'}${deaths ? ` (${deaths} deaths)` : ''}${fails.length ? ` [${fails.length} replans: ${fails.slice(0, 2).join('; ').slice(0, 120)}]` : ''}`);
  });
}
fs.writeFileSync(RES, JSON.stringify(results, null, 1) + '\n');
// what a server held: kept up (>= 95% of the aimed tick rate) = at least players x speed; lagging = players x the speed it reached
{
  let best = null;
  for (const { goals, log } of done) {
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    const tps = [...text.matchAll(/^tps ([\d.]+)/gm)].map((m) => +m[1]).slice(2);   // after the start (joins, first chunks)
    if (tps.length < 3) continue;
    const avg = tps.reduce((a, b) => a + b, 0) / tps.length;
    // lagging: what it reached; kept up: at least this load, and no evidence against the old figure
    const held = avg < 19 * speed ? goals.length * (avg / 20) * 0.95 : Math.max(goals.length * speed, cap);
    best = best === null ? held : Math.min(best, held);
  }
  if (best !== null) { fs.mkdirSync(path.dirname(CAPF), { recursive: true }); fs.writeFileSync(CAPF, JSON.stringify({ perServer: Math.max(2, Math.round(best)), at: new Date().toISOString().slice(0, 16), speed, players: GOALS.length, servers })); console.log(`capacity: about ${Math.max(2, Math.round(best))} player-speed per server (next --max uses it)`); }
}
// ../GOALS.md with these rows too
spawnSync(process.execPath, [path.join(HERE, 'run.mjs'), '--md'], { cwd: TOP, stdio: 'ignore' });
console.log(`race: ${ok}/${GOALS.length} done, ${Math.round((Date.now() - t0) / 1000)} s wall (game time per RTA in the lines above)`);
