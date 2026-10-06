#!/usr/bin/env node
// Survival drills on a real BDS: each one sets a real client down in a spot every runner meets sooner or later (zombies at the start
// in the rain, the first night with nothing, an archer in a cave, a creeper, deep water, lava under the floor, a high drop, an empty
// food bar, a pit, a baby zombie, spiders at night, skeletons by day in the rain) and gives it a goal. PASS = the goal done in time
// with no death. Each drill: a fresh copy of the seed's world (the land of the race spots is pregenerated), results in
// survive.json and ../SURVIVE.md, the log in .logs/survive-<name>.log.
//   node docs/goals/survive.mjs [--speed x] [--seed n] [--spot n] [--times k] [name...]      (default: every drill once, x20)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOP = path.resolve(HERE, '..', '..');
const UNIT = path.join(HERE, '..', 'verbs', 'lab.mjs');
const RES = path.join(HERE, 'survive.json'), LOGS = path.join(HERE, '.logs');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const speed = Number(opt('--speed', 20)), seed = String(opt('--seed', '1')), spotNo = Number(opt('--spot', 2)), times = Number(opt('--times', 1));
// where: the fair start picked for race spot n in the pregen (docs/goals/race.mjs --pregen), else the spot itself
const start = (() => {
  const x = spotNo * 320;
  try { const m = JSON.parse(fs.readFileSync(path.join(TOP, '.lab', `race-pregen-${seed}.json`), 'utf8')); return m.picked?.[`${x},0`] ?? [x, 0]; } catch { return [x, 0]; }
})();
const at = (cmd) => `execute at A run ${cmd}`;
const adult = (mob, x, z) => at(`summon ${mob} ~${x} ~2 ~${z} 0 0 minecraft:as_adult`);
// a drill: setup (console commands once A stands at the start with the land loaded; A = the player), threats (summoned as the run
// starts: waiting beside them before it would be a drill of standing still), goal (the `rta` line), minutes (game time it has),
// spawn (monsters spawn as usual: the night ones), check (more to pass than done + no death)
const DRILLS = {
  zombies_rain: { ja: '雨の朝、素手でゾンビ 2 体のそば', setup: ['weather rain 60000'], threats: [adult('zombie', 7, 2), adult('zombie', -6, 5)], goal: 'rta wooden_pickaxe', minutes: 8 },
  skeletons_rain: { ja: '雨の朝、素手で弓のスケルトン 2 体', setup: ['weather rain 60000'], threats: [at('summon skeleton ~14 ~2 ~3'), at('summon skeleton ~-12 ~2 ~-8')], goal: 'rta wooden_pickaxe', minutes: 8 },
  night_empty: { ja: '日没、何も持たずに最初の夜', setup: ['time set 12800'], spawn: true, goal: 'rta wooden_pickaxe', minutes: 14 },
  night_tools: { ja: '夜、石の道具と土とパンで、ゾンビ・スケルトン・クモ', setup: ['time set 14000', 'give A stone_sword', 'give A stone_pickaxe', 'give A dirt 16', 'give A bread 4'], threats: [adult('zombie', 12, 4), at('summon skeleton ~-14 ~2 ~6'), at('summon spider ~5 ~2 ~-13')], spawn: true, goal: 'rta furnace keep', minutes: 14 },
  cave_archers: { ja: '地下の暗い洞窟でスケルトン 2 体', setup: [at('fill ~-5 ~-15 ~-5 ~5 ~-11 ~5 air'), at('tp A ~ ~-15 ~'), 'give A stone_pickaxe', 'give A bread 5', 'give A cobblestone 16'], threats: [at('summon skeleton ~4 ~ ~4'), at('summon skeleton ~-4 ~ ~-3')], goal: 'rta furnace keep', minutes: 8 },
  creeper: { ja: '石のツルハシで掘っているとクリーパー', setup: ['give A stone_pickaxe'], threats: [at('summon creeper ~6 ~2 ~3')], goal: 'rta furnace keep', minutes: 6 },
  // (the pool and the pillar are made beside the player, then it is put there: made round it, the fill pushed it out of its
  // place first and the teleport went from there - into the rock beside the pool, down the side of the pillar)
  deep_water: { ja: '深さ 8 の水の底', setup: [at('fill ~2 ~-9 ~-3 ~8 ~-1 ~3 water'), at('tp A ~5 ~-8 ~')], goal: 'rta crafting_table', minutes: 6 },
  lava_floor: { ja: '足元の 3 下に溶岩の池', setup: ['give A stone_pickaxe', at('fill ~-5 ~-6 ~-5 ~5 ~-4 ~5 lava'), at('fill ~-5 ~-3 ~-5 ~5 ~-2 ~5 stone')], goal: 'rta furnace keep', minutes: 6 },
  high_pillar: { ja: '高さ 24 の土の柱の上', setup: [at('fill ~2 ~ ~ ~2 ~23 ~ dirt'), at('tp A ~2 ~24 ~')], goal: 'rta crafting_table', minutes: 6 },
  hungry: { ja: '満腹度 0 近く、食べ物なし、牛が近く', setup: ['effect A hunger 12 255 true', 'wait 1500', 'effect A clear', at('summon cow ~9 ~2 ~4'), at('summon cow ~-8 ~2 ~6'), at('summon pig ~5 ~2 ~-9')], goal: 'rta stone_pickaxe', minutes: 8, check: (t) => { const f = /^@A hp \S+ food (\d+)/m.exec(t)?.[1]; return f === undefined || Number(f) >= 6 ? null : `food ${f} at the end`; } },
  pit: { ja: '深さ 5 の縦穴の底（素手）', setup: [at('fill ~ ~-5 ~ ~ ~-1 ~ air')], goal: 'rta crafting_table', minutes: 6 },
  baby_zombie: { ja: '木の剣で子どものゾンビ', setup: ['give A wooden_sword'], threats: [at('summon zombie ~6 ~2 ~2 0 0 minecraft:as_baby')], goal: 'rta crafting_table keep', minutes: 6 },
  spiders_night: { ja: '夜、石の剣でクモ 2 体', setup: ['time set 14000', 'give A stone_sword'], threats: [at('summon spider ~7 ~2 ~3'), at('summon spider ~-6 ~2 ~-7')], goal: 'rta crafting_table keep', minutes: 6 },
};
const pick = args.length ? args : Object.keys(DRILLS);
for (const n of pick) if (!DRILLS[n]) { console.log(`no drill ${n}: ${Object.keys(DRILLS).join(' ')}`); process.exit(1); }
fs.mkdirSync(LOGS, { recursive: true });

const run = (cmds, log, env, wallMs) => new Promise((res) => {
  fs.rmSync(log, { force: true });
  const t0 = Date.now();
  const ch = spawn(process.execPath, [UNIT, 'run', ...cmds, '-w', '200'], { cwd: path.dirname(UNIT), env: { ...process.env, ...env, LAB_TAIL: log }, stdio: ['ignore', 'ignore', 'ignore'] });
  const kill = setTimeout(() => ch.kill('SIGTERM'), wallMs);
  ch.on('exit', () => { clearTimeout(kill); res(Math.round((Date.now() - t0) / 1000)); });
});

const results = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, 'utf8')) : {};
let ok = 0, all = 0;
for (let r = 0; r < times; r++) for (const name of pick) {
  const d = DRILLS[name], log = path.join(LOGS, `survive-${name}${times > 1 ? `-${r + 1}` : ''}.log`);
  const cmds = ['@A join', 'gamerule domobspawning false', 'gamerule dodaylightcycle false', 'time set 1000', 'weather clear', 'effect A resistance 100000 4 true', 'effect A slow_falling 100000 0 true',
    `spreadplayers ${start[0]} ${start[1]} 0 1 A`, '@A wait_world 48 180', `spreadplayers ${start[0]} ${start[1]} 0 1 A`, 'wait 1000', 'effect A clear', 'kill @e[family=monster]', 'wait 500',
    ...d.setup, 'gamerule dodaylightcycle true', ...(d.spawn ? ['gamerule domobspawning true'] : []),
    `@A& ${d.goal}`, 'until rta \\S+: start 20000', ...(d.threats ?? []), `waitall ${Math.round(((d.minutes + 1) * 60000) / Math.min(speed, 8)) + 60000}`, '@A report', "js return 'inventory: '+inv('A').join(' ')"];
  const wall = await run(cmds, log, { LAB_WORLD: 'normal', LAB_SEED: seed, LAB_VIEW: '6', LAB_SPEED: String(speed), LAB_DIFFICULTY: 'easy', LAB_RTA_MINUTES: String(d.minutes), LAB_RTA_SPAWNPOINT: '1', LAB_MAX: '100000000' }, ((d.minutes + 3) * 60000) / Math.min(speed, 4) + 180000);
  const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  const res = /^@A rta \S+: (done in (\d+)m(\d+)s.*|stopped after .*)$/m.exec(text);
  const deaths = [...text.matchAll(/^@A died \((.*)\)$/gm)].map((m) => m[1].replace(/^death\./, ''));
  const extra = res?.[2] && !deaths.length && d.check ? d.check(text) : null;
  const pass = !!res?.[2] && !deaths.length && !extra;
  const why = pass ? null : extra ?? (deaths.length ? `died: ${deaths.join(', ')}` : res?.[1] ?? (/did not spawn|connection closed/.test(text) ? 'did not join' : 'no result (see the log)'));
  const fails = [...text.matchAll(/^@A get: (?:\[[\d:]+\] )?step failed: (.+)$/gm)].map((m) => m[1]);
  const notes = [...text.matchAll(/^@A get: (?:\[[\d:]+\] )?((?:hurt|night|died|dead|moving away|running|could not shut|rock here|up out|in fire|hungry|a crowd|fled|keeping away|out of|drowning|falling).*)$/gm)].map((m) => m[1]).slice(0, 12);
  all++; if (pass) ok++;
  const prev = results[`${seed}:${name}`], tries = (r > 0 && prev?.tries ? prev.tries : []).concat([pass ? 1 : 0]);
  results[`${seed}:${name}`] = { name, ja: d.ja, pass, tries, sec: res?.[2] ? +res[2] * 60 + +res[3] : null, deaths, why, fails: fails.slice(0, 5), notes, wall, speed, at: new Date().toISOString().slice(0, 16) };
  fs.writeFileSync(RES, JSON.stringify(results, null, 1) + '\n');
  console.log(`${pass ? '✔' : '✘'} ${name} (${d.ja}): ${pass ? res[1] : why}${fails.length ? ` [${fails.length} replans]` : ''} (${wall} s wall)`);
}
console.log(`survive: ${ok}/${all} passed`);
// ../SURVIVE.md from every drill result kept
const rows = Object.values(results).sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(TOP, 'docs', 'SURVIVE.md'), ['# サバイバルの訓練（本物の BDS、生成ワールド）', '',
  '`node docs/goals/survive.mjs [--speed x] [name...]` が、走者がいつか出会う場面（雨の朝のゾンビ、何も持たない最初の夜、洞窟の弓、クリーパー、深い水、足元の溶岩、高い所、空腹、縦穴、子どものゾンビ、夜のクモ、雨のスケルトン）に本物のクライアントを置き、目標（`rta ...`）を与える。合格 = 時間内に目標を達成し、1 度も死なないこと。', '',
  '| 訓練 | 場面 | 結果（最後の回） | 合格 / 試行 | タイム | 死因 / 理由 | 行動（抜粋） |', '|---|---|---|---|---|---|---|',
  ...rows.map((x) => `| \`${x.name}\` | ${x.ja} | ${x.pass ? '✔' : '✘'} | ${(x.tries ?? [x.pass ? 1 : 0]).reduce((a, b) => a + b, 0)} / ${(x.tries ?? [1]).length} | ${x.sec != null ? `${Math.floor(x.sec / 60)}:${String(x.sec % 60).padStart(2, '0')}` : '—'} | ${String(x.why ?? '').replace(/\|/g, '/').slice(0, 120)} | ${x.notes.slice(0, 4).join('; ').replace(/\|/g, '/').slice(0, 200)} |`), ''].join('\n'));
