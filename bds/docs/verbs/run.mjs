#!/usr/bin/env node
// Runs the everyday verbs (common/data/everyday.json) on a real BDS with the real client and writes ../VERBS.md.
// Each verb starts from the same reset, then gets what its catalog entry names (items deep in the inventory, blocks, mobs held
// still by slowness, `real.setup`), runs, and must show `real.check` (tests.txt lines) and none of the failure phrases below.
//   node docs/verbs/run.mjs [category|verb regex]   results are kept per verb in results.json; VERBS.md is written from all of them
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOP = path.resolve(HERE, '..', '..', '..');
const EVERY = JSON.parse(fs.readFileSync(path.join(TOP, 'common', 'data', 'everyday.json'), 'utf8'));
// the generated verbs by their catalog samples (one or two per family), each with what shows it worked: `families` runs them
const FAM_CHECK = { get_: (v) => ['~ ^@A get: got '], rta_: (v) => [`~ ^@A ${v}: done in`], craft_: (v) => [`~ ^@A ${v}: made`], smelt_: (v) => ['js inv(\'A\').join(\' \')', `~ ${v.slice(6)}`],
  mine_: (v) => ['js inv(\'A\').join(\' \')', `~ ${v.slice(5)}`], find_: (v) => [`~ ^@A ${v}: `], place_: (v) => [`~ ^EV after.playerPlaceBlock (?=.*block=minecraft:${v.slice(6)})`], hold_: (v) => [`~ ^@A ${v}: holding`],
  drop_: (v) => [`~ ^@A ${v}: `], kill_: (v) => [`~ ^EV after.entityDie (?=.*deadEntity=minecraft:${v.slice(5)})`], goto_: (v) => [`~ ^@A ${v}: `], challenge_: (v) => [`~ ^@A ${v}: `], quest_: (v) => [`~ ^@A ${v}: `] };
const FAM = {};
for (const f of Object.values(EVERY.families)) for (const sm of f.samples) {
  const fam = Object.keys(FAM_CHECK).find((k) => sm.verb.startsWith(k)); if (!fam) continue;
  const mobs = /^(kill|goto)_/.test(sm.verb) ? [sm.verb.replace(/^(kill|goto)_/, '')] : [];
  FAM[sm.verb] = { cat: 'generated', use: `${sm.verb} ${sm.args.join(' ')}`.trim(), ja: f.ja, args: sm.args, items: sm.items, blocks: sm.blocks, mobs, real: { free: /^kill_/.test(sm.verb) ? undefined : true, check: FAM_CHECK[fam](sm.verb) } };
}
const CAT = { ...EVERY.verbs, ...FAM };
const KBI = (() => { try { return JSON.parse(fs.readFileSync(path.join(TOP, 'common', 'data', 'kb.json'), 'utf8')).items; } catch { return {}; } })();
const stackOf = (it) => KBI[it]?.[2] || 64;   // replaceitem does not cap a count at the stack size: 16 crossbows would be one bad stack
const RES = path.join(HERE, 'results.json');
const results = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, 'utf8')) : {};
const arg = process.argv[2];
const pick = Object.keys(CAT).filter((v) => !arg || CAT[v].cat === arg || (arg === 'families' && FAM[v]) || new RegExp(`^(${arg})$`).test(v));

// the same start for every verb: flat ground, nothing else alive, default rules (a rule_* verb may have changed one), A healthy
const RULES = { domobloot: true, dotiledrops: true, doentitydrops: true, keepinventory: false, naturalregeneration: true, pvp: true, tntexplodes: true, falldamage: true, firedamage: true, drowningdamage: true,
  freezedamage: true, doimmediaterespawn: false, doinsomnia: false, showdeathmessages: true, showcoordinates: false, mobgriefing: true, dofiretick: false, domobspawning: false, dodaylightcycle: false, doweathercycle: false, randomtickspeed: 1 };
const RESET_CMDS = ['execute in overworld run tp A 0.5 -60 0.5 0 0', 'gamemode survival A', 'clear A', 'effect A clear', 'fill -14 -60 -14 14 -50 14 air', 'fill -14 -63 -14 14 -62 14 dirt',
  'fill -14 -61 -14 14 -61 14 grass_block', 'time set noon', 'weather clear', 'difficulty normal', 'daylock false', 'xp -100000L A', ...Object.entries(RULES).map(([k, v]) => `gamerule ${k} ${v}`),
  'camera A clear', 'hud A reset all', 'effect A saturation 1 255 true', 'effect A regeneration 2 255 true', 'tag A remove hero'];
const RESET_JS = ["q.getComponent('health').resetToMaxValue()", "q.getComponent('player.hunger')?.resetToDefaultValue()", "q.getComponent('player.saturation')?.resetToDefaultValue()", 'q.extinguishFire()', 'q.selectedSlotIndex=0',
  "q.getComponent('cursor_inventory').clear()", "q.getComponent('ender_inventory').container.clearAll()"].map((x) => `try{${x}}catch{}`).join(';');
// everything but the players removed, not killed: a wither still charging up cannot be killed and blew up two verbs later, a
// dying snow golem left snow where the next golem was built, and deaths drop loot; the air filled in again after the wait
const GONE = "for (const e of dim.getEntities()) if (e.typeId !== 'minecraft:player') try { e.remove(); } catch {}";
const RESET = ['@A watch off', '@A stop', '@A close', '@A crawl off', '@A typing off', '@A respawn', '@A dismount', `js ${GONE}; for(const c of ${JSON.stringify(RESET_CMDS)})try{dim.runCommand(c)}catch{}; const q=p('A'); ${RESET_JS}; return 'reset'`, 'wait 400',
  `js ${GONE}; try { dim.runCommand('fill -14 -60 -14 14 -50 14 air'); } catch {} return 'clear'`, '@A look 0 0', '@A slot 0'];
const PROLOGUE = ['@A join', 'wait 500', 'events on', 'states on riding'];
const SUMMON = { evoker: 'evocation_illager', zombified_piglin: 'zombie_pigman', tropical_fish: 'tropicalfish', end_crystal: 'ender_crystal' };
const GROWN = "js const tried = new Set(); let n = 0; for (let pass = 0; pass < 10; pass++) { const kids = dim.getEntities().filter((e) => e.typeId !== 'minecraft:player' && e.typeId !== 'minecraft:happy_ghast' && e.typeId !== 'minecraft:tadpole' && e.getComponent('is_baby')); if (!kids.length) break; for (const e of kids) { n++; let ok = !tried.has(e.id); if (ok) { tried.add(e.id); try { e.triggerEvent('minecraft:ageable_grow_up'); } catch { ok = false; } } if (!ok) { const t = e.typeId, l = e.location; e.remove(); dim.spawnEntity(t, l); } } await new Promise((r) => system.runTimeout(r, 3)); } return 'grown up ' + n";
const INANIMATE = /^(boat|chest_boat|\w*minecart|cushion|tnt|xp_orb|end_crystal|ender_crystal|armor_stand|painting|leash_knot|item)$/;
// a verb that could not do its job says so in one of these ways
const FAILED = ['!~ ^@A \\w+: (no \\w+ (in view|known|opened|screen|recipe)|could not|not riding|needs |missing |fewer than|nothing opened|no trade screen|no furnace|no brewing|no dry ground|no safe)', '!~ ^@A .*(rejected|this protocol cannot send)', '!~ ^@A .*kicked'];
const placeJs = (at, s) => {
  const m = /^([\w:]+)(?:\[(.*)\])?$/.exec(s), [x, y, z] = at.split(' ').map(Number), name = m[1].includes(':') ? m[1] : `minecraft:${m[1]}`;
  const st = Object.fromEntries((m[2] ? m[2].split(',') : []).map((kv) => { const [k, v] = kv.split('=').map((q) => q.trim().replace(/^"|"$/g, '')); return [k, /^-?\d+$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v]; }));
  return `js dim.getBlock({ x: ${x}, y: ${y}, z: ${z} }).setPermutation(mc.BlockPermutation.resolve(${JSON.stringify(name)}, ${JSON.stringify(st)})); return 'block ${name.slice(10)} at ${at}'`;
};

const file = [...PROLOGUE], owner = [];
for (const v of pick) {
  const e = CAT[v], r = e.real ?? {};
  if (r.skip) { results[v] = { ok: null, why: r.skip }; continue; }
  file.push(...RESET, `## ${v}`); owner[file.length] = v;
  const lines = [];
  const give = new Map((r.give ?? []).map(([it, c]) => [it, c]));
  e.items.forEach((it, i) => (give.has(it) ? lines.push(`give A ${it} ${give.get(it)}`) : lines.push(`replaceitem entity A slot.inventory ${i} ${it} ${Math.min(stackOf(it), /dirt|stone|cobblestone|planks|torch|rail|redstone|oak_fence|sand/.test(it) ? 64 : 16)}`)));
  for (const [it, c] of give) if (!e.items.includes(it)) lines.push(`give A ${it} ${c}`);
  // (by the Script API: a /setblock of the block already there, e.g. the grass of the reset floor, prints an E line)
  for (const [k, b] of Object.entries(e.blocks ?? {})) lines.push(placeJs(k, b));
  if (Object.keys(e.blocks ?? {}).length) lines.push('wait 150');   // (the client learns of them a tick or two later: a verb that looks first saw nothing)
  (e.mobs ?? []).forEach((m, i) => lines.push(`summon ${SUMMON[m] ?? m} ${0.5 + i} -60 ${m === 'creeper' ? 5.5 : 2.5}`));   // a creeper 2 blocks away lights its fuse before the verb starts
  // grown up: a summon is a baby now and then (a foal or a baby strider cannot be ridden or saddled, a baby zombie is a smaller, faster
  // target). Its own grow-up event where it has one, else another summon (a spawn event such as spawn_adult is not on every mob, and
  // one it lacks leaves it without the parts that make it breedable or tameable)
  if (e.mobs?.some((m) => !INANIMATE.test(m) && !/^(happy_ghast|tadpole)$/.test(m))) lines.push(GROWN);   // (a tadpole is young by nature: grown up it is a frog)
  // held still: each summoned living thing by its type (an item on the ground, a boat or a minecart cannot take an effect: `effect` on
  // all of @e then prints an error line, and an unmatched E line fails the verb)
  if (e.mobs?.length && !r.free) for (const m of new Set(e.mobs)) if (!INANIMATE.test(m)) lines.push(`effect @e[type=${SUMMON[m] ?? m}] slowness 120 255 true`);
  if (e.mobs?.length) lines.push('wait 600');
  // setup: what the verb needs (a quest gets it by itself); stage: test-only lines after it (a sampler of what the server sees)
  lines.push(...(r.setup ?? []), ...(r.stage ?? []), `@A ${v} ${e.args.join(' ')}`.trim(), 'wait 400', ...(r.check ?? []), ...FAILED);
  for (const l of lines) { file.push(l); owner[file.length] = v; }
}
const tmp = path.join(HERE, '.verbs-run.txt');
fs.writeFileSync(tmp, file.join('\n') + '\n');
const t0 = Date.now();
const r = spawnSync(process.execPath, [path.join(HERE, 'lab.mjs'), 'test', tmp], { cwd: HERE, encoding: 'utf8', env: { ...process.env, LAB_NOTRACE: '1', LAB_MAX: '1000000', LAB_SHOWMATCH: '1', LAB_DUMP: path.join(HERE, 'last-run.txt') }, maxBuffer: 512e6 });
fs.rmSync(tmp, { force: true });
const out = r.stdout.split('\n'), seen = {};
for (let i = 0; i < out.length; i++) {
  const m = /^([✘✔]) (\d+): ?(.*)$/.exec(out[i]); if (!m) continue;
  const v = owner[+m[2]]; if (!v) continue;
  const s = (seen[v] ??= { ok: true, fail: [], saw: [] });
  if (m[1] === '✘') { s.ok = false; s.fail.push(`${m[3]} ${out[i + 1]?.trim() ?? ''} ${out[i + 2]?.trim() ?? ''}`.slice(0, 300)); } else if (/^(EV|ST|@A|=)/.test(m[3]) && s.saw.length < 2) s.saw.push(m[3].slice(0, 160));
}
// an unmatched E line fails its verb without a ✘ line of its own: the test prints those at the end as `E ... (during: <command>)`;
// the dump (one `> <command>` segment per command, in file order) says which verb's command printed it
const steps = [];   // [command, verb] in the order the test runs them (expectations and ## titles are not commands)
file.forEach((l, i) => { if (l && !/^(##|!~|[=~!])/.test(l)) steps.push([l.replace(/^\//, ''), owner[i + 1]]); });
const segOf = [];   // [verb, lines] per segment
try {
  let k = -1, cur = [null, []];   // the reset before a verb belongs to the verb before it (what it left behind shows there)
  for (const l of fs.readFileSync(path.join(HERE, 'last-run.txt'), 'utf8').split('\n')) {
    if (l.startsWith('> ') && steps[k + 1] && l.slice(2) === steps[k + 1][0]) { k++; cur = [steps[k][1] ?? cur[0], []]; segOf.push(cur); } else cur[1].push(l);
  }
} catch { /* no dump: E lines stay unattributed */ }
const used = new Set();
for (const l of out) {
  const m = /^E (.*?)(?: {3}\(during: .*\))?$/.exec(l); if (!m) continue;
  const at = segOf.findIndex(([v, ls], i) => v && !used.has(`${i} ${m[1]}`) && ls.includes(`E ${m[1]}`));
  if (at < 0) continue;
  used.add(`${at} ${m[1]}`);
  const v = segOf[at][0];
  (seen[v] ??= { ok: true, fail: [], saw: [] }).ok = false; seen[v].fail.push(l.trim().slice(0, 300));
}
for (const v of pick) if (seen[v]) results[v] = { ok: seen[v].ok, fail: seen[v].fail.slice(0, 3), saw: seen[v].saw, at: new Date().toISOString().slice(0, 10) };
  else if (!results[v]?.why) results[v] = { ok: false, fail: ['no result (the run stopped before it: see last-run.txt)'] };
fs.writeFileSync(RES, JSON.stringify(results, null, 1) + '\n');
const summary = out.filter((l) => /^(PASS|FAIL) /.test(l)).at(-1) ?? r.stdout.slice(-1500) + r.stderr.slice(-800);
const ran = pick.filter((v) => seen[v]), bad = ran.filter((v) => !seen[v].ok);
console.log(`${summary} | ${ran.length - bad.length}/${ran.length} verbs ok in ${Math.round((Date.now() - t0) / 1000)} s${bad.length ? '\n✘ ' + bad.map((v) => `${v}: ${seen[v].fail[0] ?? ''}`).join('\n✘ ') : ''}`);

// ../VERBS.md from every result kept so far
const ver = (() => { try { return fs.readFileSync(path.join(TOP, 'bds', '.lab', 'bds', 'VERSION'), 'utf8').trim(); } catch { return '?'; } })();
const all = Object.keys(CAT), done = all.filter((v) => results[v]), ok = done.filter((v) => results[v].ok === true), skip = done.filter((v) => results[v].ok === null);
const byCat = {}; for (const v of all) (byCat[CAT[v].cat] ??= []).push(v);
const md = [`# 日常の動作を本物の BDS で動かした結果`, '', `\`node docs/verbs/run.mjs [分類|動作]\` が BDS ${ver} と本物のクライアントで、目録（common/data/everyday.json）の動作を 1 つずつ同じ初期状態から実行した記録（手書きの行は無い）。`,
  '各動作は目録の `items`（持ち物欄の奥に置く）・`blocks`・`mobs`（のろさで止め、子どもは大人にする）・`real.setup` を用意し、`real.stage`（サーバーが見た向き・位置を毎 tick 記録するなど、試験だけの行）の後で実行し、`real.check` の行（EV = Script API のイベント、ST = 状態、@A = クライアントの表示、js の値＝サーバー側で確かめた結果）が出て、失敗の言い回し（no … in view、could not、rejected など）と想定外の E 行が出なければ ✔。手書きの動作はすべて `real.check` を持つ。',
  '', `- 手書きの動作: ✔ ${ok.filter((v) => !FAM[v]).length} / 実行 ${done.filter((v) => !FAM[v]).length - skip.filter((v) => !FAM[v]).length}（実機で確かめられない ${skip.filter((v) => !FAM[v]).length} は理由つきで —）/ 全 ${all.filter((v) => !FAM[v]).length}`,
  `- 生成した動作（${Object.values(EVERY.families).reduce((a, f) => a + f.count, 0)} 個）の見本: ✔ ${ok.filter((v) => FAM[v]).length} / ${Object.keys(FAM).length}（\`node docs/verbs/run.mjs families\`）`, '',
  ...Object.entries(byCat).flatMap(([c, vs]) => [`## ${c}`, '', '| 動作 | 結果 | 使い方 | 内容 | 実測・失敗の理由 |', '|---|---|---|---|---|',
    ...vs.map((v) => { const x = results[v]; const res = !x ? '' : x.ok === null ? '—' : x.ok ? '✔' : '✘'; const note = !x ? '未実行' : x.ok === null ? x.why : x.ok ? (x.saw?.[0] ?? '') : (x.fail?.[0] ?? ''); return `| \`${v}\` | ${res} | \`${CAT[v].use}\` | ${CAT[v].ja} | ${String(note).replace(/\|/g, '/').replace(/`/g, "'").slice(0, 200)} |`; }), ''])];
fs.writeFileSync(path.join(TOP, 'bds', 'docs', 'VERBS.md'), md.join('\n'));
