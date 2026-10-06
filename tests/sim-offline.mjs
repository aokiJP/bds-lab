#!/usr/bin/env node
// `node lab.mjs sim` (common/sim.mjs + sandbox-be/): tests.txt sections run in the Script API sandbox in a second, no server.
// A plain-JS pack in a temp folder: a command that answers, a scriptevent, a form pressed by its button text, an error nobody
// expected, a section the sandbox cannot do (skipped, not guessed), versions newer than the sandbox's game (UNSURE, not FAIL).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
if (!fs.existsSync(path.join(TOP, 'sandbox-be', 'src', 'index.js'))) { console.log('PASS sim-offline (no sandbox-be/ here: nothing to test)'); process.exit(0); }
const S = await import(pathToFileURL(path.join(TOP, 'common', 'sim.mjs')).href);
const api = JSON.parse(fs.readFileSync(path.join(TOP, 'sandbox-be', 'data', 'script-api.json'), 'utf8'));
// versions: exact when the sandbox has them; newer or beta → the newest it has, with a note
let v = S.pickVersions([{ module_name: '@minecraft/server', version: '2.0.0' }], api);
ok(v.versions['@minecraft/server'] === '2.0.0' && !v.notes.length, 'a version the sandbox has: as is');
v = S.pickVersions([{ module_name: '@minecraft/server', version: '9.9.0' }, { module_name: '@minecraft/server-ui', version: '9.9.0-beta' }], api);
const newest = (m, beta) => api.modules[m].versions.filter((x) => /-beta$/.test(x) === beta).at(-1);
ok(v.versions['@minecraft/server'] === newest('@minecraft/server', false) && v.versions['@minecraft/server-ui'] === newest('@minecraft/server-ui', true) && v.notes.length === 2, 'newer stable → its newest stable, newer beta → its newest beta, both said', JSON.stringify(v));
v = S.pickVersions([{ module_name: '@minecraft/server-ui', version: '2.3.0-beta' }], api);
ok(!api.modules['@minecraft/server-ui'].versions.includes('2.3.0-beta') || (v.versions['@minecraft/server-ui'] === '2.3.0-beta' && !v.notes.length), 'a beta the sandbox has: as is', JSON.stringify(v));
const q = S.toRequest({ title: 't', lines: ['@B join', '@B cmd /x:y 3', 'wait 500', 'scriptevent a:b hi', 'give B apple 2', '~ hi'] }, { files: {}, entry: 'scripts/main.js', versions: {} });
ok(q.req.players.map((p) => p.name).join() === 'B' && q.req.actions.map((a) => a.type).join() === 'command,scriptEvent,command' && q.req.actions[0].command === 'x:y 3' && q.req.actions[1].tick > q.req.actions[0].tick + 9, 'lines → players and timed actions', JSON.stringify(q.req.actions));
const jq = S.toRequest({ title: 't', lines: ['js 1+1', '= 2'] }, { files: { 'main.js': 'x' }, entry: 'scripts/main.js' });
ok(!jq.skip && jq.req.actions[0]?.id === 'lab:js' && /return\(1\+1/.test(jq.req.files['__labsim.js']) && /import "\.\/__labsim\.js"/.test(jq.req.files['main.js']) && S.toRequest({ title: 't', lines: ['js sim("B")'] }, { files: {} }).skip === 'js with simulated players', 'js: compiled into a module beside the entry (simulated players: skipped)');
const bx = S.toRequest({ title: 't', lines: ['@A interact 2 -60 2', '@A attack 3 -60 4', '@A interact pig'] }, { files: {} });
ok(bx.req.actions.map((a) => `${a.type}${a.at ? '@' + [a.at.x, a.at.y, a.at.z] : ''}`).join(' ') === 'useItemOn@2,-60,2 breakBlock@3,-60,4 interactWithEntity', 'interact / attack x y z: a block, so useon / dig (as the real client does them); with a name: the mob', JSON.stringify(bx.req.actions));
const mv = S.toRequest({ title: 't', lines: ['@A join', '@A walk forward 20', '@A walk left 8', '@A goto 5 5', '@A leave', '@A join'] }, { files: {} });
const sum = (k) => mv.req.actions.filter((a) => a.type === 'move' && a.by).reduce((n, a) => n + a.by[k], 0);
ok(Math.abs(sum('z') - (4.3 + 0)) < 0.01 && Math.abs(sum('x') - 4.3 * 8 / 20) < 0.01 && mv.req.actions.some((a) => a.type === 'move' && a.to?.x === 5 && a.to?.z === 5) && mv.req.actions.map((a) => a.type).slice(-2).join() === 'leave,join' && mv.approx, 'walk (20 ticks forward = 4.3 blocks +z, left = +x, as measured), goto x z in steps, leave then join (a rejoin); a miss there is UNSURE', JSON.stringify(mv.req.actions.slice(-4)));
const it = S.toRequest({ title: 't', lines: ['@A select lab:wand', '@A use', '@A useon 1 -60 2', '@A place stone 3 -60 4', '@A dig 3 -60 4', '@A eat'] }, { files: {} });
ok(!it.skip && it.req.actions.map((a) => `${a.type}${a.item ? ':' + a.item : ''}${a.block ? ':' + a.block : ''}${a.at ? '@' + [a.at.x, a.at.y, a.at.z] : ''}`).join(' ') === 'useItem:lab:wand useItemOn:lab:wand@1,-60,2 placeBlock:stone@3,-60,4 breakBlock@3,-60,4 startUse consumeItem:lab:wand completeUse useUp stopUse', 'select + use / useon / place / dig / eat → the sandbox actions, holding what was selected', JSON.stringify(it.req.actions));
const lm = S.judge([{ op: '~', text: 'minecraft:bread*2' }], ['["0:minecraft:bread*2"]']);
ok(lm.length === 1 && /is there as plain text, but ~ is a regex where \* is special: escape it \(\\\*\)/.test(lm[0]) && S.judge([{ op: '~', text: 'x*1' }], ['y']).every((b) => !/plain text/.test(b)), 'a ~ that missed although its text is there literally says which regex character to escape (only then)', JSON.stringify(lm));
const an = S.judge([{ op: '~', text: '^A is back' }], ['@A A is back']);
ok(an.length === 1 && /the line is "@A A is back": \^ ties the text to the start of the line/.test(an[0]), 'a ~ that missed only by its ^ anchor shows the whole line and says so (not "escape")', JSON.stringify(an));
ok(S.judge([{ op: '~', text: '^@A hi' }], ['@A hi there']).length === 0 && S.judge([], ['E boom']).length === 1 && S.judge([{ op: '!~', text: 'x' }], ['x']).length === 1, 'expectations and unexpected E lines');
// a real pack in the sandbox
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-sim-')), U = path.join(T, 'demo');
fs.mkdirSync(path.join(U, 'bp', 'scripts'), { recursive: true });
fs.writeFileSync(path.join(U, 'bp', 'manifest.json'), JSON.stringify({ format_version: 2, header: { name: 'd', uuid: '11111111-1111-4111-8111-111111111111', version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'script', language: 'javascript', uuid: '22222222-2222-4222-8222-222222222222', version: [1, 0, 0], entry: 'scripts/main.js' }], dependencies: [{ module_name: '@minecraft/server', version: '2.0.0' }, { module_name: '@minecraft/server-ui', version: '2.0.0' }] }));
fs.writeFileSync(path.join(U, 'bp', 'scripts', 'main.js'), `import { system, world, ItemStack } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id === 'demo:hi') world.sendMessage('hello ' + e.message);
  if (e.id === 'demo:form') { const p = world.getPlayers()[0]; new ActionFormData().title('Shop').button('Ruby').button('Emerald').show(p).then((r) => console.warn('picked ' + r.selection)); }
  if (e.id === 'demo:boom') throw new Error('boom');
  if (e.id === 'demo:day') world.sendMessage('day ' + Math.floor(Date.now() / 86400000) + ' ' + Math.floor(new Date().getTime() / 86400000));
  if (e.id === 'demo:later') system.runTimeout(() => world.sendMessage('later'), 200);
  if (e.id === 'demo:tick') world.sendMessage('tick ' + (system.currentTick < 300 ? 'soon' : 'late ' + system.currentTick));
  if (e.id === 'demo:count') world.sendMessage('count ' + (globalThis.__n = (globalThis.__n ?? 0) + 1));
  if (e.id === 'demo:remember') { const A = world.getPlayers()[0]; world.setDynamicProperty('w', e.message); A.setDynamicProperty('p', e.message); A.addTag('t_' + e.message); globalThis.__mem = e.message; A.getComponent('inventory').container.addItem(new ItemStack('minecraft:apple', 3)); world.scoreboard.addObjective('pts').setScore(A, 5); }
  if (e.id === 'demo:recall') { const A = world.getPlayers()[0]; world.sendMessage(['recall', world.getDynamicProperty('w'), A.getDynamicProperty('p'), A.hasTag('t_hi'), globalThis.__mem ?? 'gone', A.getComponent('inventory').container.getItem(0)?.amount, world.scoreboard.getObjective('pts')?.getScore(A)].join(' ')); }
  if (e.id === 'demo:modal') { const A = world.getPlayers()[0]; new ModalFormData().title('M').label('hello').textField('Name', '').dropdown('Color', ['red', 'green']).toggle('On').show(A).then((r) => world.sendMessage('values ' + JSON.stringify(r.formValues))); }
  if (e.id === 'demo:score') { const o = world.scoreboard.addObjective('s1'), o2 = world.scoreboard.addObjective('s2'), A = world.getPlayers()[0], r = [o.hasParticipant(A)];
    try { o.getScore(A); r.push('no-throw'); } catch (x) { r.push(x.message); } o.addScore(A, 2); r.push(o.getScore(A), String(o2.getScore(A)), o2.hasParticipant(A)); world.sendMessage('score ' + r.join(' | ')); }
});
world.afterEvents.entityHitEntity.subscribe((e) => world.sendMessage('hit ' + e.hitEntity.typeId));
`);
fs.mkdirSync(path.join(U, 'bp', 'items'), { recursive: true }); fs.mkdirSync(path.join(U, 'bp', 'functions'), { recursive: true });
fs.writeFileSync(path.join(U, 'bp', 'items', 'ruby.json'), JSON.stringify({ format_version: '1.21.120', 'minecraft:item': { description: { identifier: 'demo:ruby' }, components: {} } }));
fs.writeFileSync(path.join(U, 'bp', 'functions', 'kit.mcfunction'), 'execute unless entity @s[hasitem={item=demo:ruby}] run give @s demo:ruby 2\n');
fs.writeFileSync(path.join(U, 'tests.txt'), '## score identity\n@A join\n~ ^@A joined -?\\d+ -60 -?\\d+$\nscriptevent demo:score\n= score false | Failed to resolve identity for \'A\'. | 2 | undefined | false\n## hi\n@A join\n~ ^@A already joined$\nscriptevent demo:hi you\n~ ^hello you$\n## js values\n@A join\ngive A diamond 3\nwait 200\njs inv(p("A"))\n~ ^\\["0:minecraft:diamond\\*3"\\]$\njs const n = 2; return n * 21\n= 42\njs const m = 3; m * 2\n= 6\n## pack item\n@A join\n@A cmd /function kit\n~ ^@A %commands.give.successRecipient \\[item.demo:ruby2\\]$\n## form by text\n@A join\nscriptevent demo:form\nuntil form\n~ @A form action: title\\("Shop"\\) button\\("Ruby"\\) button\\("Emerald"\\)\n@A form Emerald\n~ ^picked 1$\n## boom\nscriptevent demo:boom\n~ never\n## attack\n@A join\nsummon pig 2 -60 0\nwait 200\n@A attack pig\n~ ^hit minecraft:pig$\n## cannot\n@A sneak 10\n~ x\n');
const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o = (r.stdout ?? '') + (r.stderr ?? '');
ok(/^✔ score identity$/m.test(o), 'scoreboard as measured on BDS 1.26.52.3: getScore throws "Failed to resolve identity" until the player has a score somewhere, hasParticipant is false, addScore creates it', o);
ok(/^✔ hi$/m.test(o), 'a message to everyone: one plain line (as BDS prints it); `@A join` prints `@A joined x y z` as the real client does (new\'s `## loads` passes)', o);
ok(/^✔ form by text$/m.test(o), 'a form shown as the lab prints it; a button pressed by its text', o);
ok(/^✘ boom$/m.test(o) && /^  threw scripts\/main\.js:6 Error: boom  \|  if \(e\.id === 'demo:boom'\) throw/m.test(o) && !/got E .*boom/.test(o), 'an error nobody expected fails the section, shown once with the line that threw and its code', o);
ok(/^✔ attack$/m.test(o), '@A attack <mob>: the sandbox hits that entity (its events fire)', o);
ok(/^- cannot \(skipped: @A sneak\)$/m.test(o), 'a line the sandbox cannot do: skipped, not guessed', o);
ok(/^✔ pack item$/m.test(o), "the pack's items in the sandbox: a function gives one to the player who typed it (hasitem, give's message)", o);
ok(/^✔ js values$/m.test(o), 'js lines: compiled ahead (no eval in the sandbox), the helpers and the value printed as the lab prints it; statements then an expression give that value', o);
ok(r.status !== 0 && /^FAIL sim 6\/7, 1 skipped in [\d.]+s/m.test(o), 'the summary and the exit code', o);
// sections run in one world, in order, as the real test runs them: what one leaves behind, the next sees; a section that
// passes alone but not after the ones before it says so
const U2 = path.join(T, 'demo2'); fs.cpSync(U, U2, { recursive: true });
fs.writeFileSync(path.join(U2, 'tests.txt'), '## first\n@A join\nscriptevent demo:count\n= count 1\n## carries over\nscriptevent demo:count\n= count 2\n## alone only\n@A join\nscriptevent demo:count\n= count 1\n');
const r2 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U2], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o2 = (r2.stdout ?? '') + (r2.stderr ?? '');
ok(/^✔ first$/m.test(o2) && /^✔ carries over$/m.test(o2) && /^✘ alone only$/m.test(o2) && /^  got @A already joined$/m.test(o2) && /^  got count 3$/m.test(o2) && /passes on its own: a section before it left state behind/.test(o2), 'sections share one world in order (state carries over, `@A already joined`); a section that only passes alone says so', o2);
// restart: a fresh load of the scripts in the world the server kept (saved properties, tags, items, scores), the players rejoined;
// a custom form answered with its values (a dropdown by its option's text), labels taking none
const U3 = path.join(T, 'demo3'); fs.cpSync(U, U3, { recursive: true });
fs.writeFileSync(path.join(U3, 'tests.txt'), '## restart\n@A join\nscriptevent demo:remember hi\nrestart\n@A join\nscriptevent demo:recall\n= recall hi hi true gone 3 5\n~ ^@A rejoined$\n= @A already joined\n## modal\nscriptevent demo:modal\nuntil form\n@A form ["Steve", "green", true]\n= values [null,"Steve",1,true]\n');
const r3 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U3], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o3 = (r3.stdout ?? '') + (r3.stderr ?? '');
ok(/^✔ restart$/m.test(o3), 'restart: saved properties, tags, items and scores kept, what the scripts held in memory gone, players rejoined (as BDS does)', o3);
// clock +1d: the scripts' Date runs a day ahead (Date.now and new Date), and a restart keeps the time where it was
const U5 = path.join(T, 'demo5'); fs.cpSync(U, U5, { recursive: true });
fs.writeFileSync(path.join(U5, 'tests.txt'), '## clock\n@A join\nscriptevent demo:day\n~ ^day 20454 20454$\nclock +1d\nscriptevent demo:day\n~ ^day 20455 20455$\nclock +36h\nrestart\nscriptevent demo:day\n~ ^day 20456 20456$\n');
const r5 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U5], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o5 = (r5.stdout ?? '') + (r5.stderr ?? '');
ok(/^✔ clock$/m.test(o5), 'clock +1d / +36h: Date.now and new Date run ahead; a restart keeps the time', o5);
// until <regex> [ms]: waits as long as the line takes (here 10 s, past the 2 s it used to give), and no longer: what follows comes
// right after it, as on the real server
const U6 = path.join(T, 'demo6'); fs.cpSync(U, U6, { recursive: true });
fs.writeFileSync(path.join(U6, 'tests.txt'), '## late line\n@A join\nscriptevent demo:later\nuntil ^later$ 20000\n~ ^later$\nscriptevent demo:tick\n= tick soon\n');
const r6 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U6], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o6 = (r6.stdout ?? '') + (r6.stderr ?? '');
ok(/^✔ late line$/m.test(o6), 'until waits for a line 10 s later, and what follows comes right after it (not after the 20 s it allows)', o6);
// a pack's mob dies by a sword: its own loot table drops the pack's item; eating a pack food: start, its use time, complete, one less
const U7 = path.join(T, 'demo7'); fs.cpSync(U, U7, { recursive: true });
fs.mkdirSync(path.join(U7, 'bp', 'entities'), { recursive: true }); fs.mkdirSync(path.join(U7, 'bp', 'loot_tables', 'entities'), { recursive: true });
fs.writeFileSync(path.join(U7, 'bp', 'entities', 'blob.json'), JSON.stringify({ format_version: '1.21.40', 'minecraft:entity': { description: { identifier: 'demo:blob', is_spawnable: true, is_summonable: true }, components: { 'minecraft:health': { value: 6, max: 6 }, 'minecraft:physics': {}, 'minecraft:loot': { table: 'loot_tables/entities/blob.json' } } } }));
fs.writeFileSync(path.join(U7, 'bp', 'loot_tables', 'entities', 'blob.json'), JSON.stringify({ pools: [{ rolls: 1, entries: [{ type: 'item', name: 'demo:ruby', weight: 1, functions: [{ function: 'set_count', count: 2 }] }] }] }));
fs.writeFileSync(path.join(U7, 'bp', 'items', 'snack.json'), JSON.stringify({ format_version: '1.21.120', 'minecraft:item': { description: { identifier: 'demo:snack' }, components: { 'minecraft:food': { nutrition: 1, can_always_eat: true }, 'minecraft:use_modifiers': { use_duration: 0.5 } } } }));
fs.appendFileSync(path.join(U7, 'bp', 'scripts', 'main.js'), "for (const k of ['itemStartUse', 'itemCompleteUse', 'itemStopUse']) world.afterEvents[k].subscribe((e) => world.sendMessage(k + ' ' + e.itemStack?.typeId));\n");
fs.writeFileSync(path.join(U7, 'tests.txt'), '## blob\n@A join\ngive A diamond_sword\nsummon demo:blob 0 -60 2\nwait 200\n@A select diamond_sword\n@A attack demo:blob\nwait 500\njs dim.getEntities({ type: "minecraft:item" }).map((e) => e.getComponent("item").itemStack.typeId + "*" + e.getComponent("item").itemStack.amount).join(" ")\n= demo:ruby*2\n## snack\nclear A\ngive A demo:snack 2\nwait 200\n@A select demo:snack\n@A eat\n= itemStartUse demo:snack\n= itemCompleteUse demo:snack\n= itemStopUse demo:snack\njs inv(p("A"))\n= ["0:demo:snack*1"]\n');
const r7 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U7], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o7 = (r7.stdout ?? '') + (r7.stderr ?? '');
ok(/^✔ blob$/m.test(o7), "a pack's mob killed with a diamond sword (its damage, not the fist's) drops what its own loot table says; js lines get dim as the overworld", o7);
ok(/^✔ snack$/m.test(o7), 'eat: itemStartUse, after its use time itemCompleteUse, one leaves the hand, itemStopUse', o7);
// chat commands (beta): world.beforeEvents.chatSend sees what a player says; cancel keeps it from everyone; afterEvents.chatSend.
// A player's chat prints as each client shows it, `@A chat <A> hello` (measured on BDS 1.26.52.3: skills/probes/broadcast)
const U8 = path.join(T, 'demo8'); fs.cpSync(U, U8, { recursive: true });
const beta = api.modules['@minecraft/server'].versions.filter((x) => /-beta$/.test(x)).at(-1);
const m8 = JSON.parse(fs.readFileSync(path.join(U8, 'bp', 'manifest.json'), 'utf8')); m8.dependencies = [{ module_name: '@minecraft/server', version: beta }, ...(m8.dependencies ?? []).filter((d) => d.module_name !== '@minecraft/server')];
fs.writeFileSync(path.join(U8, 'bp', 'manifest.json'), JSON.stringify(m8));
fs.appendFileSync(path.join(U8, 'bp', 'scripts', 'main.js'), "world.beforeEvents.chatSend.subscribe((e) => { if (e.message === '!home') { e.cancel = true; system.run(() => e.sender.sendMessage('home ok')); } });\nworld.afterEvents.chatSend.subscribe((e) => world.sendMessage('heard ' + e.message));\n");
fs.writeFileSync(path.join(U8, 'tests.txt'), '## chat\n@A join\n@A chat !home\n= @A home ok\n!~ <A> !home\n! heard !home\n@A chat hello\n= @A chat <A> hello\n= heard hello\n');
const r8 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U8], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o8 = (r8.stdout ?? '') + (r8.stderr ?? '');
ok(/^✔ chat$/m.test(o8), 'chat commands on beta: beforeEvents.chatSend (cancel keeps it from everyone), afterEvents.chatSend', o8);
// a player who leaves and joins again: BDS keeps the inventory and saved properties, playerSpawn fires with initialSpawn
const U4 = path.join(T, 'demo4'); fs.cpSync(U, U4, { recursive: true });
fs.appendFileSync(path.join(U4, 'bp', 'scripts', 'main.js'), "world.afterEvents.playerSpawn.subscribe((e) => { if (e.initialSpawn) { e.player.getComponent('inventory').container.addItem(new ItemStack('minecraft:bread', 1)); world.sendMessage('spawn ' + e.player.name); } });\n");
fs.writeFileSync(path.join(U4, 'tests.txt'), '## rejoin\n@A join\nwait 200\n@A leave\nwait 200\n@A join\n~ ^@A joined \\d+ -60 \\d+$\nwait 200\njs inv(p("A"))\n~ minecraft:bread\\*2\n');
const r4 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U4], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o4 = (r4.stdout ?? '') + (r4.stderr ?? '');
ok(/^✔ rejoin$/m.test(o4), 'leave + join: the player comes back with what they had, `@A joined x y z`, playerSpawn (initialSpawn) again', o4);
ok(/^✔ modal$/m.test(o3), 'a custom form answered with its values in order (a dropdown by its text; a label takes none)', o3);
// the run of all sections starts from the answers each section's forms got alone; a menu that an earlier section changed (a button
// more) is answered again from what that run shows, never by the old place of the button
const U9 = path.join(T, 'demo9'); fs.cpSync(U, U9, { recursive: true });
fs.appendFileSync(path.join(U9, 'bp', 'scripts', 'main.js'), "system.afterEvents.scriptEventReceive.subscribe((e) => { if (e.id === 'demo:unlock') world.setDynamicProperty('vip', true); if (e.id === 'demo:menu') { const b = world.getDynamicProperty('vip') ? ['Secret', 'Spawn'] : ['Spawn']; const f = new ActionFormData().title('Go'); for (const x of b) f.button(x); f.show(world.getPlayers()[0]).then((r) => world.sendMessage('chose ' + b[r.selection])); } });\n");
fs.writeFileSync(path.join(U9, 'tests.txt'), '## menu\n@A join\nscriptevent demo:menu\nuntil form\n@A form Spawn\n= chose Spawn\n## unlock\nscriptevent demo:unlock\n## menu after unlock\nscriptevent demo:menu\nuntil form\n@A form Spawn\n= chose Spawn\n');
const r9 = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'sim', '-a', U9], { cwd: TOP, encoding: 'utf8', timeout: 120000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o9 = (r9.stdout ?? '') + (r9.stderr ?? '');
ok(r9.status === 0 && /^✔ menu after unlock$/m.test(o9) && /^PASS sim 3\/3/m.test(o9), 'the run of all sections: a button found by its text where that run shows it (an earlier section added one before it)', o9);
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} sim-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
