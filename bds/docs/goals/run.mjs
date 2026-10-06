#!/usr/bin/env node
// Speedruns (RTA) of the goal planner on a real BDS in a generated world, written to ../GOALS.md. Each goal gets its own fresh copy
// of the world (LAB_WORLD=normal, the seed below), a real client joins at the world spawn with nothing, and `rta_<item>` runs:
// plan, wood, tools, stone, ore, furnace, animals ... until the item is in the inventory or it gives up and says why.
//   node docs/goals/run.mjs [seed] [item...]          (default: the list below, seed 1; --md: only rewrite ../GOALS.md)
//   an item runs rta_<item>; challenge_<name> / quest_<verb> run as they are (`node docs/goals/run.mjs 1 challenge_iron_tools quest_breed_cow`)
//   live log of one run: tail -f docs/goals/.logs/<item>.log
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOP = path.resolve(HERE, '..', '..', '..');
const UNIT = path.join(HERE, '..', 'verbs', 'lab.mjs');   // the plain addon of the verb check: nothing of its own changes the game
const RES = path.join(HERE, 'results.json'), LOGS = path.join(HERE, '.logs');
const results = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, 'utf8')) : {};
const args = process.argv.slice(2);
const seed = /^\d+$/.test(args[0] ?? '') ? args.shift() : '1';
const GOALS = args.includes('--md') ? [] : args.length ? args : ['crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'furnace', 'torch', 'bed', 'bread', 'iron_ingot', 'iron_pickaxe', 'bucket', 'shield', 'cake'];
const MIN = Number(process.env.LAB_RTA_MINUTES) || 40;
fs.mkdirSync(LOGS, { recursive: true });
for (const g of GOALS) {
  const log = path.join(LOGS, `${g}.log`);
  fs.rmSync(log, { force: true });
  const t0 = Date.now();
  const verb = /^(challenge|quest|rta)_/.test(g) ? g : `rta_${g}`;
  const r = spawnSync(process.execPath, [UNIT, 'run', '@A join', 'wait 4000', `@A ${verb}`, "js return 'inventory: '+inv('A').join(' ')", '@A where', '-w', '300'],
    { cwd: path.dirname(UNIT), encoding: 'utf8', maxBuffer: 256e6, timeout: (MIN + 5) * 60000, env: { ...process.env, LAB_WORLD: 'normal', LAB_SEED: seed, LAB_TAIL: log, LAB_RTA_MINUTES: String(MIN), LAB_MAX: '100000000' } });
  const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : r.stdout ?? '';
  const res = /@A (?:rta|challenge|quest)_\S+: (done in (\d+)m(\d+)s.*|stopped after .*)$/m.exec(text);
  const steps = [...text.matchAll(/^@A get: (?!(?:\[[\d:]+\] )?(?:plan for|step failed|got |could not))(?:\[[\d:]+\] )?(.+)$/gm)].map((m) => m[1]);
  const fails = [...text.matchAll(/^@A get: (?:\[[\d:]+\] )?step failed: (.+)$/gm)].map((m) => m[1]);
  const deaths = (text.match(/^@A died/gm) ?? []).length;
  const inv = /^inventory: (.*)$/m.exec(text)?.[1] ?? '';
  const splits = /^@A (?:rta|challenge|quest)_\S+ splits: (.*)$/m.exec(text)?.[1]?.split(' | ') ?? [];
  results[`${seed}:${g}`] = { seed, goal: g, ok: !!res?.[2], sec: res?.[2] ? +res[2] * 60 + +res[3] : null, wall: Math.round((Date.now() - t0) / 1000), steps: steps.length, fails: fails.slice(0, 5), deaths,
    why: res?.[2] ? null : res?.[1] ?? (r.error ? `harness: ${r.error.message}` : 'no result (see the log)'), inv: inv.slice(0, 300), route: steps.slice(0, 40), splits: splits.slice(0, 60), at: new Date().toISOString().slice(0, 16) };
  fs.writeFileSync(RES, JSON.stringify(results, null, 1) + '\n');
  console.log(`${res?.[2] ? '✔' : '✘'} ${verb} (seed ${seed}): ${res?.[1] ?? results[`${seed}:${g}`].why}${deaths ? ` (${deaths} deaths)` : ''}`);
}

// ../GOALS.md from every result kept so far
const ver = (() => { try { return fs.readFileSync(path.join(TOP, 'bds', '.lab', 'bds', 'VERSION'), 'utf8').trim(); } catch { return '?'; } })();
const rows = Object.values(results).sort((a, b) => a.seed - b.seed || (a.sec ?? 1e9) - (b.sec ?? 1e9));
const md = ['# 目標プランナーの RTA（本物の BDS、生成ワールド）', '',
  `\`node docs/goals/run.mjs [seed] [item...]\` が BDS ${ver} を LAB_WORLD=normal（普通の地形、シード指定）で起動し、本物のクライアントが持ち物ゼロでワールドのスポーン地点に入って \`rta_<item>\` を実行した記録（手書きの行は無い）。`,
  'プランナー（common/goal.cjs）が BDS 自身のデータ（common/data/kb.json: レシピ、精錬、ブロックごと・道具ごとのドロップ、モブのドロップ）から手順を組み、goal-exec.cjs が歩く・掘る・作業台を置く・かまどで焼く・倒す・搾る…を実行し、世界が計画どおりでなければその場で計画し直す。見つけるのは「見える」ブロックだけ（空気に面していて視線が通るもの。xray は使わない）。',
  '', '| シード | 目標 | 結果 | タイム | 手順 | 死亡 | 失敗して計画し直した手順 / やめた理由 | 最後の持ち物 |', '|---|---|---|---|---|---|---|---|',
  ...rows.map((x) => `| ${x.seed} | \`${x.goal}\` | ${x.ok ? '✔' : '✘'} | ${x.sec != null ? `${Math.floor(x.sec / 60)}:${String(x.sec % 60).padStart(2, '0')}` : '—'} | ${x.steps} | ${x.deaths} | ${String(x.ok ? x.fails.join('; ') : x.why ?? '').replace(/\|/g, '/').slice(0, 160)} | ${x.inv.replace(/minecraft:/g, '').replace(/\|/g, '/').slice(0, 160)} |`),
  '', '## 目標ごとの最速（ゲーム内時間）', '', '| 目標 | 最速 | シード | 走り方 | 日付 | 成功 / 試行 |', '|---|---|---|---|---|---|',
  ...Object.values(Object.groupBy(rows, (x) => x.goal.replace(/ \(race.*\)$/, ''))).map((xs) => {
    const ok = xs.filter((x) => x.ok).sort((a, b) => a.sec - b.sec), b = ok[0];
    return [b ? b.sec : 1e9, `| \`${xs[0].goal.replace(/ \(race.*\)$/, '')}\` | ${b ? `${Math.floor(b.sec / 60)}:${String(b.sec % 60).padStart(2, '0')}` : '—'} | ${b?.seed ?? '—'} | ${b ? (/\(race/.test(b.goal) ? b.goal.replace(/^.*\((race[^)]*)\)$/, '$1') : 'single') : '—'} | ${b?.at?.slice(0, 10) ?? '—'} | ${ok.length} / ${xs.length} |`];
  }).sort((a, b) => a[0] - b[0]).map((r) => r[1]),
  '', '## 手順（成功した回）', '',
  ...rows.filter((x) => x.ok).flatMap((x) => [`### ${x.goal}（シード ${x.seed}、${Math.floor(x.sec / 60)}:${String(x.sec % 60).padStart(2, '0')}）`, '',
    ...(x.splits?.length ? ['| スプリット | 手順 |', '|---|---|', ...x.splits.map((s) => { const m = /^(\S+) (.*)$/.exec(s); return `| ${m?.[1] ?? ''} | ${m?.[2] ?? s} |`; })] : x.route.map((s, i) => `${i + 1}. ${s}`)), ''])];
fs.writeFileSync(path.join(TOP, 'bds', 'docs', 'GOALS.md'), md.join('\n') + '\n');
