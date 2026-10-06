#!/usr/bin/env node
// The AI-driven development tools without a server, an AI or network: trial's helpers (ddmin, players, joins, what came
// instead), gaps (masking, handlers and the test lines that reach them), why's dossier (got, throws and their values, the line
// that printed what came instead, a missing component, the lab's own errors), record's expectations, chaos (plan, title, first
// error), addon-lint, api-hints, and harden end to end on a fake lab (its tests read the unit's files) with a fake AI.
// The same tools on the real server: tests/dev-bds.mjs. node tests/dev-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-dev-'));
process.env.LAB_LABS_ROOT = path.join(T, 'lab');   // checkpoint.mjs (and every tool through it) works on the fake lab below
const imp = (m) => import(pathToFileURL(path.join(TOP, 'common', m)).href);
let good = 0, bad = 0;
const check = (c, name, info = '') => { if (c) { good++; console.log(`✔ ${name}`); } else { bad++; console.log(`✘ ${name}\n    ${String(info).slice(-1500).split('\n').join('\n    ')}`); } };
const put = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const MAIN = `import { Player } from '@minecraft/server';
import { cmd, give, take, count, onItem, menu, inv } from './kit';

// the wand: each use sparks and says how many sparks this player made
const sparks = new Map<string, number>();
onItem('lab:wand', {
  onUse(e) {
    const p = e.source as Player;
    const n = (sparks.get(p.id) ?? 0) + 1;
    sparks.set(p.id, n);
    p.sendMessage(\`SPARK \${n}\`);
  },
});

// /lab:pay <n> <who>: n of your emeralds to another player
cmd('lab:pay', 'Pay emeralds to a player', { n: 'int', who: 'player' }, (p, a) => {
  const to = a.who[0] as Player;
  if (a.n <= 0) return 'PAY nothing to pay';
  const have = count(p, 'emerald');
  if (have <= a.n) return \`PAY you have only \${have}\`;
  take(p, 'emerald', a.n);
  give(to, 'emerald', a.n);
  return \`PAY \${a.n} to \${to.name}\`;
});

// /lab:shop: what you hold is in the title; buy with emeralds
cmd('lab:shop', 'Open the shop', {}, async (p) => {
  const held = inv(p).getItem(p.selectedSlotIndex);
  const pick = await menu(p, \`Shop (\${held!.typeId})\`, [
    ['Diamond for 3 emeralds', (q) => { if (take(q, 'emerald', 3)) give(q, 'diamond', 1); }],
    ['Bread for 1 emerald', (q) => { if (take(q, 'emerald', 1)) give(q, 'bread', 1); }],
  ]);
  return pick === undefined ? 'SHOP closed' : \`SHOP bought \${pick}\`;
});
`;

// ---------- trial: ddmin, players, joins, what came instead ----------
const Tr = await imp('trial.mjs');
{
  let runs = 0;
  const r = await Tr.ddmin([...'abcdefghij'], async (sub) => { runs++; return sub.includes('c') && sub.includes('h'); }, { maxRuns: 40 });
  check(r.items.join('') === 'ch' && !r.capped && r.runs === runs, `ddmin: the smallest list that still fails (${r.items.join('')} in ${r.runs} runs)`, JSON.stringify(r));
  const c = await Tr.ddmin([...'abcdefghij'], async (sub) => sub.includes('c') && sub.includes('h'), { maxRuns: 2 });
  check(c.capped && c.runs === 2 && c.items.includes('c') && c.items.includes('h'), 'ddmin: stopped at maxRuns says so (capped), still a failing list', JSON.stringify(c));
  const k = await Tr.ddmin([1, 2, 3, 4], async (sub) => sub.includes(4), { keep: [0] });
  check(k.items.join() === '1,4', 'ddmin: kept indexes stay', JSON.stringify(k));
}
check([...Tr.playersIn("@A join\njs inv(p('B'))\n@C& walk forward 2\n## x\ngive D dirt 1")].join() === 'A,B,C', 'playersIn: @X lines and p(\'X\') in js (a console line alone names nobody)');
check(Tr.freshNames(new Set(['A', 'B'])).join() === 'C,D' && Tr.freshNames(new Set()).join() === 'A,B', 'freshNames: the first names the tests do not use');
check(Tr.renamePlayers(['@A cmd /lab:pay 2 A', 'give A x 1', "js p('A').name", '@B& leave', '@a say', 'tp @s ~ ~ ~'], { A: 'C', B: 'D' }).join('|') === "@C cmd /lab:pay 2 C|give C x 1|js p('C').name|@D& leave|@a say|tp @s ~ ~ ~", 'renamePlayers: @A, a whole-word A, p(\'A\'); selectors untouched');
check(Tr.joinsFor(['@A cmd /x', '@B join', '@B use', "js p('C')", '~ @D sees']).join('|') === '@A join|@C join', 'joinsFor: players used before (or without) their own join; expectations are not uses');
check(Tr.joinsFor(['give A emerald 2', '@A cmd /lab:pay 2 B'], new Set(['A', 'B'])).join('|') === '@A join|@B join', 'joinsFor: a player named only in a command joins too (known names)');
{
  const t = { lines: ['✘ 14: ## pay > @A cmd /lab:pay 2 B', '  want ~ @A PAY 2 to B', '  got x', 'FAIL 1/2'], segs: [{ cmd: null, out: [] }, { cmd: '@A cmd /lab:pay 2 B', out: ['EV after.chatSend'] }, { cmd: 'wait 300', out: ['Gave Emerald * 2 to B', '@A PAY you have only 2 (12ms)'] }] };
  check(Tr.cameInstead(t, 'pay', '@A PAY 2 to B') === '@A PAY you have only 2 (Nms)' && Tr.cameInstead(t, 'pay', '@A other') === null, 'cameInstead: the line that came after the command (the same start first; durations normalized), null when that expectation passed');
}
check(Tr.SCRIPT_ERR.test("E Unhandled promise rejection: TypeError: cannot read property 'x' of undefined (src/main.ts:3)") && !Tr.SCRIPT_ERR.test('E until: /form/ not seen in 10000ms') && Tr.sig('E RangeError at 12 (during: wait 300)') === 'E RangeError at N', 'SCRIPT_ERR and sig: script errors only, numbers and the during part normalized');

// ---------- gaps: masking, handlers and how to reach them ----------
const G = await imp('gaps.mjs');
{
  const m = G.maskAll("const s = `a ${ {x: '}'}.x } b`; // }\nf({ y: 1 });");
  check(m.length === "const s = `a ${ {x: '}'}.x } b`; // }\nf({ y: 1 });".length && G.closeOf(m, m.indexOf('f(') + 1) === m.lastIndexOf(')'), 'maskAll: strings, templates (with ${} nesting) and comments blanked, brackets of code kept', JSON.stringify(m));
  const hs = G.handlers(MAIN), by = (w) => hs.find((h) => h.what === w);
  check(by('/lab:pay')?.how === '@A cmd /lab:pay 1 A' && by('/lab:shop')?.how === '@A cmd /lab:shop · until form · @A form 0', 'handlers: a command with arguments from its types; one that shows a form gets the answer too', JSON.stringify(hs.map((h) => [h.what, h.how])));
  check(by('onUse of lab:wand')?.how === 'give A lab:wand 1 · @A select lab:wand · @A use' && by('button 1 of a menu')?.how === '@A cmd /lab:shop · until form · @A form 1', 'handlers: an item hook; a menu button reached through the command that opens it');
  check(G.ownerOf(hs, 30)?.what === 'button 0 of a menu' && G.ownerOf(hs, 28)?.what === '/lab:shop', 'ownerOf: the innermost handler of a line');
  const u = path.join(T, 'gapunit'); put(path.join(u, 'src', 'main.ts'), MAIN);
  const ex = G.explain(u, 'COV 70% of code lines ran | src/kit.ts 3/9 never ran: 1-6 | src/main.ts 18/21 never ran: 7-12,33');
  check(ex.length === 2 && G.line(ex[0]) === 'src/main.ts:7-11 never ran: onUse of lab:wand → give A lab:wand 1 · @A select lab:wand · @A use' && G.line(ex[1]).startsWith('src/main.ts:33 never ran: /lab:shop → '), 'explain: the never-run lines of the unit (not the kit) grouped by what runs them, closing lines left out', JSON.stringify(ex.map(G.line)));
}

// ---------- why: the dossier from one run ----------
const W = await imp('why.mjs');
{
  const lit = W.literals("  if (!take(p, 'emerald', a.n)) return `PAY you have only ${count(p, 'emerald')}`; // `x`");
  check(lit.length === 2 && lit[1].tpl && lit[1].parts.join('|') === 'PAY you have only |', 'literals: strings and templates of a line (the comment after them left out)', JSON.stringify(lit));
  check(W.textsOf('@A form action: title("Shop (x)") button("Buy")').join('|') === '@A form action: title("Shop (x)") button("Buy")|form action: title("Shop (x)") button("Buy")|Shop (x)|Buy', 'textsOf: the line, the message, the texts of a form');
  const files = [['src/main.ts', MAIN]];
  check(W.printers(files, W.textsOf('@A PAY you have only 2'))[0]?.at === 'src/main.ts:20' && W.printers(files, W.textsOf(W.wantText('~', '@A PAY 2 to B')))[0]?.at === 'src/main.ts:23', 'printers: the line whose template makes the text (got and wanted)');
  check(W.wantText('=', 'a.b') === 'a.b' && W.wantText('~', '^SPARK \\d+$') === 'SPARK 1' && W.wantText('~', 'a|b') === null && W.wantText('!', 'x') === null, 'wantText: = as is, a simple ~ unescaped, an alternation or ! gives up');
  const e1 = W.errorOf(["E Unhandled promise rejection: TypeError: cannot read property 'typeId' of undefined (src/main.ts:29)", '  fix: x', '  at src/kit.ts:27', '  at src/kit.ts:46'], 0);
  const e2 = W.errorOf(["E Unhandled promise rejection: InvalidEntityError: Failed to call function 'sendMessage' due to Entity being invalid (has the Entity been removed?). (__lab.js)"], 0);
  check(e1.at === 'src/main.ts:29' && e1.via.join() === 'src/kit.ts:27,src/kit.ts:46' && e2.at === '' && e2.lab, 'errorOf: the unit\'s own line first (kit frames as via); an error only the lab\'s recorder names is marked lab', JSON.stringify([e1, e2]));
  const u = path.join(T, 'whyunit'); put(path.join(u, 'src', 'main.ts'), MAIN);
  put(path.join(u, 'bp', 'items', 'wand.json'), JSON.stringify({ 'minecraft:item': { description: { identifier: 'lab:wand' }, components: { 'minecraft:max_stack_size': 1 } } }));
  const seg = (cmd, ...out) => ({ cmd, out });
  // no throw, the code ran: what came (it lands a command later), the line that printed it, the wanted line never ran
  let d = W.dossier(u, 'pay', '## pay\n@A cmd /lab:pay 2 B\n~ @A PAY 2 to B', { lines: ['✘ 14: ## pay > @A cmd /lab:pay 2 B', '  want ~ @A PAY 2 to B', '  got @B joined', 'FAIL 1/2'],
    segs: [seg(null), seg('@B join', '@B joined 0 -60 0'), seg('trace err'), seg('events on'), seg('cov on'), seg('@A cmd /lab:pay 2 B', 'EV after.playerInventoryItemChange'), seg('wait 300', '@A PAY you have only 2'), seg('cov', 'COV 80% of code lines ran | src/main.ts 18/21 never ran: 21-23'), seg('events off')] }, { values: 'p=A a={n=2 who=[B]} have=2' });
  let o = d.lines.join('\n');
  check(/^✘ @A cmd \/lab:pay 2 B {2}want ~ @A PAY 2 to B {2}\| {2}got @A PAY you have only 2$/m.test(o) && /^came instead: "@A PAY you have only 2", printed by src\/main\.ts:20: if \(have <= a\.n\)/m.test(o) && /^ {2}values there: p=A a=\{n=2 who=\[B\]\} have=2$/m.test(o)
    && /^would print what the test wants: src\/main\.ts:23 \(never ran in this section\)/m.test(o) && /^next: src\/main\.ts:20 printed it instead of src\/main\.ts:23 \(never ran\): the condition that chose/m.test(o) && d.printer?.at === 'src/main.ts:20', 'dossier (no throw): what came after the command, the line that printed it with its values, the wanted line never ran, the condition named', o);
  // a throw: the unit's line with its values; the kit's internal throw and the async machinery's are not shown
  d = W.dossier(u, 'chaos 7', '## chaos 7\n@C join\n@C cmd /lab:shop', { lines: ['SECTION FAIL chaos 7'],
    segs: [seg(null), seg('trace err'), seg('events on'), seg('cov on'), seg('@C join', '@C joined 0 -60 0', 'EV after.playerSpawn'), seg('@C cmd /lab:shop', "X src/main.ts:29 TypeError: cannot read property 'typeId' of undefined | p=C held=undefined", 'X src/kit.ts:28 TypeError: not an object | p=C', "E Unhandled promise rejection: TypeError: cannot read property 'typeId' of undefined (src/main.ts:29)", '  fix: x', '  at src/kit.ts:27'), seg('cov', 'COV 50% | src/main.ts 10/21 never ran: 30-33')] });
  o = d.lines.join('\n');
  check(/^threw src\/main\.ts:29 Unhandled promise rejection: TypeError: cannot read property 'typeId' of undefined {2}\(via src\/kit\.ts:27\)$/m.test(o) && /^ {2}values: p=C held=undefined$/m.test(o) && /^ {2}> {2}29\| +const pick = await menu/m.test(o) && !/kit\.ts:28/.test(o) && /^next: held is undefined at src\/main\.ts:29/m.test(o), 'dossier (a throw): the unit\'s line, its values, the code; no internal kit throw', o);
  // a hook that never ran: its item lacks the component
  d = W.dossier(u, 'the wand sparks', '## the wand sparks\ngive A lab:wand 1\n@A select lab:wand\n@A use\n~ @A SPARK 1', { lines: ['✘ 9: ## the wand sparks > @A use', '  want ~ @A SPARK 1', '  got (nothing)'],
    segs: [seg(null), seg('trace err'), seg('events on'), seg('cov on'), seg('@A use', 'EV after.itemUse'), seg('cov', 'COV 50% | src/main.ts 10/21 never ran: 8-11')] });
  o = d.lines.join('\n');
  check(/^did not run although the section uses it: onUse of lab:wand \(src\/main\.ts:7-12\)$/m.test(o) && /^next: bp\/items\/wand\.json: add "lab:wand": \{\} to its components/m.test(o), 'dossier (a hook that never ran): its item json lacks the component', o);
  // only the lab's recorder is named: it came from the unit calling it at a bad time
  d = W.dossier(u, 'leave', '## leave\n@A leave', { lines: [], segs: [seg(null), seg('trace err'), seg('@A leave', "E Unhandled promise rejection: InvalidEntityError: Failed to call function 'sendMessage' due to Entity being invalid (has the Entity been removed?). (__lab.js)")] });
  o = d.lines.join('\n');
  check(/^threw Unhandled promise rejection: InvalidEntityError/m.test(o) && /^next: .*the call that failed is in the lab's recorder, so it came from your code calling it at a bad time: the entity is gone/m.test(o), 'dossier (the lab\'s recorder named): the cause is the unit\'s call, with the runtime hint', o);
}

// ---------- record: expectations from two runs ----------
const R = await imp('record.mjs');
check(R.expect('a 1', 'a 1') === '= a 1' && R.expect('@A at 1.5 -60', '@A at 2 -60') === '~ ^@A at -?\\d+(\\.\\d+)? -60$' && R.expect('a b', 'a c') === null, 'record expect: the same line =, only numbers differ ~, else nothing');
{
  const s1 = [{ out: [] }, { out: ['@C joined 0 -60 0'] }, { out: ['@C PAY nothing to pay', 'E boom', 'EV after.chatSend'] }];
  const s2 = [{ out: [] }, { out: ['@C joined 0 -60 0'] }, { out: ['@C PAY nothing to pay'] }];
  const r = R.section(['@C join', '@C cmd /lab:pay 0 A'], s1, s2, 1);
  check(JSON.stringify(r.res) === JSON.stringify([['@C join', []], ['@C cmd /lab:pay 0 A', ['= @C PAY nothing to pay']]]) && r.errors.join() === 'E boom', 'record section: set-up lines (joins) get no expectations; errors are said, never recorded', JSON.stringify(r));
}

// ---------- chaos: the plan, the title, the first error ----------
const C = await imp('chaos.mjs');
{
  const u = path.join(T, 'chaosunit'); put(path.join(u, 'src', 'main.ts'), MAIN); put(path.join(u, 'src', 'kit.ts'), "export function cmd(n: string) { world.afterEvents.chatSend.subscribe(() => {}); }\n");
  const s = C.surface(u);
  check(s.cmds.map((c) => c.id).join() === 'lab:pay,lab:shop' && s.acts.some((a) => a.join(' · ') === 'give A lab:wand 1 · @A select lab:wand · @A use') && s.acts.some((a) => a.at(-1) === '@A form 1') && !s.acts.some((a) => a.join().includes('chatSend')), 'surface: its commands, its item hook, its menu buttons (the kit left out)', JSON.stringify(s));
  const p1 = C.plan(s, 25, C.mulberry(7)), p2 = C.plan(s, 25, C.mulberry(7)), p3 = C.plan(s, 25, C.mulberry(8));
  check(p1.join('\n') === p2.join('\n') && p1.join('\n') !== p3.join('\n') && p1[0] === '@A join' && p1.filter((l) => l === 'restart').length <= 1 && p1.some((l) => /^@[AB] cmd \/lab:(pay|shop)/.test(l)), 'plan: the same seed plays the same; at most one restart; its commands are used');
  check(C.titleFor(7, "E Unhandled promise rejection: TypeError: cannot read property \"typeId\" of undefined (src/main.ts:29)   (during: @C cmd /lab:shop)") === "chaos 7: TypeError: cannot read property 'typeId' of undefined (src/main.ts:29)" && C.titleFor(1, 'E ' + 'word '.repeat(40)).length <= 100 && !/\s$/.test(C.titleFor(1, 'E ' + 'word '.repeat(40))), 'titleFor: the error itself, no rejection prefix, no double quotes, cut at a word, nothing trailing');
  check(JSON.stringify(C.firstError([{ out: ['boot'] }, { out: ['ok'] }, { out: ['E until: /x/ not seen in 10ms', "E TypeError: x is not a function (src/main.ts:3)"] }])) === JSON.stringify({ line: 'E TypeError: x is not a function (src/main.ts:3)', at: 1 }), 'firstError: the first script error (not a refused until) and the plan line it came after');
}

// ---------- addon-lint ----------
const AL = await imp('addon-lint.mjs');
{
  const r = AL.lintScript(`import { world, system } from '@minecraft/server';
const all = world.getAllPlayers();
function later() { return world.getAllPlayers(); }
world.afterEvents.playerSpawn.subscribe(() => { world.getDimension('overworld'); });
world.beforeEvents.chatSend.subscribe((e) => {
  e.sender.runCommand('say hi');
  system.run(() => e.sender.runCommand('say ok'));
});
world.afterEvents.itemUse.subscribe((e) => {
  world.afterEvents.chatSend.subscribe(() => {});
  system.runInterval(() => {}, 20);
});
system.runInterval(() => { for (const x of world.getDimension('overworld').getEntities()) x.setDynamicProperty('a', 1); }, 1);
world.afterEvents.playerJoin.subscribe((e) => { world.setDynamicProperty(\`coins:\${e.player.name}\`, 0); });
`);
  const at = (l, k) => r.find((x) => x.line === l && x.kind === k);
  check(at(2, 'early') && !r.some((x) => x.line === 3) && !r.some((x) => x.line === 4), 'lint early: world.* at the top level only (not in a function or a handler)', JSON.stringify(r));
  check(at(6, 'before') && !r.some((x) => x.line === 7 && x.kind === 'before'), 'lint before: a world change in a before-event (not inside system.run)', JSON.stringify(r));
  check(at(10, 'review') && at(11, 'review') && r.filter((x) => x.line === 13).length === 2 && at(14, 'review'), 'lint review: subscribe/interval inside a handler, entities scanned and a property written every tick, data keyed by name', JSON.stringify(r));
}

{
  // what crashes for a real player (skill rules by id), and before-event writes measured on BDS (addScore / addTag refused, setDynamicProperty allowed)
  const r = AL.lintScript(`import { world, system } from '@minecraft/server';
const homes = new Map();
const o = () => world.scoreboard.getObjective('m');
world.afterEvents.playerSpawn.subscribe((e) => { e.player.sendMessage(String(o().getScore(e.player))); });
world.beforeEvents.chatSend.subscribe((e) => {
  o().addScore(e.sender, 1);
  e.sender.sendMessage('x');
});
world.afterEvents.itemUse.subscribe((e) => { form.show(e.source).then((r) => { go(names[r.selection]); }); });
world.afterEvents.playerLeave.subscribe((e) => homes.delete(e.playerId));
`);
  const at = (l, k) => r.find((x) => x.line === l && x.kind === k);
  check(at(2, 'review') && /api-state-persist/.test(at(2, 'review').msg) && at(4, 'review') && /api-score-identity/.test(at(4, 'review').msg) && at(9, 'review') && /api-form-cancel/.test(at(9, 'review').msg), 'lint: lost state, getScore for a new player, a closed form not handled (with their skill rule ids)', JSON.stringify(r));
  check(at(6, 'before') && !r.some((x) => x.line === 7 && x.kind === 'before'), 'lint before: addScore in a before-event is a change (measured); sendMessage is allowed there', JSON.stringify(r));
  const ok2 = AL.lintScript(`import { world } from '@minecraft/server';\nconst o = () => world.scoreboard.getObjective('m');\nconst v = (p) => (o().hasParticipant(p) ? o().getScore(p) : 0);\nf.show(p).then((r) => { if (r.canceled) return; use(r.selection); });\nconst m = new Map(); world.setDynamicProperty('a', JSON.stringify([...m]));\n`);
  check(!ok2.some((x) => /api-(score-identity|form-cancel|state-persist)/.test(x.msg)), 'lint: no finding where hasParticipant, canceled and saving are there', JSON.stringify(ok2));
  const ok3 = AL.lintScript(`import { world } from '@minecraft/server';\nconst FISH = new Set(['minecraft:cod', 'minecraft:salmon']);\nworld.afterEvents.itemUse.subscribe((e) => { if (FISH.has(e.itemStack.typeId)) e.source.sendMessage('fish'); });\n`);
  check(!ok3.some((x) => /api-state-persist/.test(x.msg)), 'lint: a Map / Set nothing adds to or deletes from is a fixed table, not state lost on restart', JSON.stringify(ok3));
}

// ---------- api-hints ----------
const AH = await imp('api-hints.mjs');
{
  const cur = `export class Entity {
    readonly id: string;
    teleport(location: Vector3): void;
}
export class Player extends Entity {
    readonly name: string;
    sendMessage(message: string): void;
}
export class ItemStack {
    readonly typeId: string;
    amount: number;
}
`, beta = cur.replace('    sendMessage(message: string): void;', '    sendMessage(message: string): void;\n    readonly inputInfo: InputInfo;') + 'export class AimAssistRegistry {\n    readonly id: string;\n}\n';
  const errs = ["src/main.ts:3 TS2339 Property 'inputInfo' does not exist on type 'Player'.", "src/main.ts:4 TS2551 Property 'typeID' does not exist on type 'ItemStack'. Did you mean 'typeId'?", "src/main.ts:5 TS2339 Property 'teleport' does not exist on type 'ItemStack'.", "src/main.ts:1 TS2305 Module '\"@minecraft/server\"' has no exported member 'AimAssistRegistry'.", "src/main.ts:6 TS2339 Property 'sendMesage' does not exist on type 'Player'."];
  const h = AH.apiHints(errs, [cur], [beta]);
  check(/inputInfo is beta-only/.test(h.get(errs[0])) && /ItemStack has readonly typeId: string/.test(h.get(errs[1])) && /teleport is on Entity, not ItemStack: Entity\.teleport\(location: Vector3\): void/.test(h.get(errs[2])) && /AimAssistRegistry is beta-only/.test(h.get(errs[3])) && /sendMessage\(message: string\): void/.test(h.get(errs[4])), 'apiHints: beta-only, on another class, the closest members (inherited too), the closest exported names', JSON.stringify([...h]));
  check(AH.RUNTIME_HINTS.find(([re]) => re.test("TypeError: cannot read property 'x' of undefined"))?.[1].startsWith('a value is undefined') && AH.RUNTIME_HINTS.find(([re]) => re.test('InvalidEntityError: x'))?.[1].startsWith('the entity is gone'), 'RUNTIME_HINTS: an undefined value, an entity that is gone');
}

// ---------- harden on a fake lab: measure, a fake AI that also tries to change the code and an old section, keep/drop, measure again ----------
// the fake lab's `test`: a section fails when it wants "PAY 99"; a bug (mutant) in src/main.ts is caught only by a section that
// pays 0 (`a.n <= 0` made `a.n < 0`), or by every section when the unit holds a file `strict` (any change to pristine.ts);
// --cov: line 33 (after the shop's form) never ran unless a section opens the shop, or `strict`
const FAKE = String.raw`import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const a = process.argv.slice(2), u = a[a.indexOf('-a') + 1], D = path.join(path.dirname(fileURLToPath(import.meta.url)), 'addons', u);
if (a[0] !== 'test') { console.log('fake ' + a.join(' ')); process.exit(0); }
const src = fs.readFileSync(path.join(D, 'src', 'main.ts'), 'utf8'), tests = fs.readFileSync(path.join(D, 'tests.txt'), 'utf8'), strict = fs.existsSync(path.join(D, 'strict'));
const secs = tests.split(/^## /m).slice(1).map((x) => ({ title: x.split('\n')[0].trim(), body: x }));
const zero = (b) => /lab:pay 0 /.test(b), changed = strict && src !== fs.readFileSync(path.join(D, 'pristine.ts'), 'utf8');
let fail = 0;
for (const s of secs) {
  const bad = /PAY 99/.test(s.body) || (/a\.n < 0/.test(src) && zero(s.body)) || /BROKEN/.test(src) || changed;
  if (bad) fail++;
  if (process.env.LAB_SECTIONS) { console.log('SECTION ' + (bad ? 'FAIL' : 'PASS') + ' ' + s.title); if (bad) console.log('SECTION WHY ' + s.title + ' :: expect ~ wrong'); }
}
const all = strict || secs.some((s) => /lab:shop/.test(s.body));
if (a.includes('--cov')) console.log('COV ' + (all ? '100% of code lines ran | src/main.ts 21/21' : '95% of code lines ran | src/main.ts 20/21 never ran: 33'));
console.log((fail ? 'FAIL ' : 'PASS ') + (secs.length - fail) + '/' + secs.length); process.exit(fail ? 1 : 0);`;
const L0 = path.join(T, 'lab'), unit = path.join(L0, 'bds', 'addons', 'hu');
put(path.join(L0, 'bds', 'lab.mjs'), FAKE);
put(path.join(L0, 'AGENTS.md'), '# fake lab\n');
const MAINF = MAIN.replace('if (have <= a.n)', 'if (have < a.n)').replace('${held!.typeId}', "${held?.typeId ?? 'empty hand'}");
put(path.join(unit, 'src', 'main.ts'), MAINF); put(path.join(unit, 'src', 'kit.ts'), '// kit\n'); put(path.join(unit, 'TASK.md'), '# hu\n');
const TESTS0 = '## pay\n@A join\n@B join\ngive A emerald 2\n@A cmd /lab:pay 2 B\n~ @A PAY 2 to B\n';
put(path.join(unit, 'tests.txt'), TESTS0);
const steps = [
  [{ name: 'write', input: { path: 'tests.txt', content: TESTS0.replace('~ @A PAY 2 to B', '~ @A PAY') + '\n## harden: paying nothing is refused\n@A cmd /lab:pay 0 B\n~ @A PAY nothing to pay\n\n## harden: wrong on purpose\n@A cmd /lab:pay 1 B\n~ @A PAY 99 to B\n' } },
    { name: 'edit', input: { path: 'src/main.ts', old: "'PAY nothing to pay'", new: "'PAY nothing'" } }, { name: 'write', input: { path: 'src/extra.ts', content: 'export {};\n' } }],
  'Added 2 sections.\nBUG src/main.ts:31 the bread button says bought without an emerald',
];
const seen = [];
const srv = http.createServer((q, s) => { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { seen.push(JSON.parse(b)); const st = steps[seen.length - 1] ?? 'done';
  s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ content: typeof st === 'string' ? [{ type: 'text', text: st }] : st.map((c, i) => ({ type: 'tool_use', id: `t${seen.length}_${i}`, name: c.name, input: c.input })), usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: typeof st === 'string' ? 'end_turn' : 'tool_use' })); }); });
await new Promise((z) => srv.listen(0, '127.0.0.1', z));
process.env.ANTHROPIC_API_KEY = 'k'; process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${srv.address().port}`; process.env.NO_PROXY = '127.0.0.1'; process.env.no_proxy = '127.0.0.1'; process.env.NODE_USE_ENV_PROXY = '';
{
  const outs = [];
  const sectionsOf = (file) => { const secs = []; let cur = null; (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split(/\r?\n/).forEach((raw, i) => { const l = raw.trim(); if (l.startsWith('## ')) { cur = { title: l.slice(3).trim(), body: [], start: i, end: i }; secs.push(cur); return; } if (!cur) return; if (l && !l.startsWith('#')) { cur.body.push(l); cur.end = i; } }); return secs; };
  const files = (d, f = () => true) => { const r = []; const w = (x) => { let es = []; try { es = fs.readdirSync(x, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(x, e.name); if (e.isDirectory()) w(p); else if (f(p)) r.push(p); } }; w(d); return r; };
  const L = { F: { name: 'bds', unitDir: 'addons' }, TOP: L0, ADDONS: path.join(L0, 'bds', 'addons'), CACHE: path.join(L0, 'bds', '.lab'), out: (l) => outs.push(String(l)), die: (m) => { throw new Error(m); }, files, rel: (f) => path.relative(path.join(L0, 'bds'), f).split(path.sep).join('/'), sectionsOf, addonNames: () => fs.readdirSync(path.join(L0, 'bds', 'addons')), useAddon: () => {} };
  const Mk = await imp('make.mjs');
  const ok = await Mk.harden(L, { name: 'hu', n: 3, via: 'anthropic', model: 'fake', turns: 6 });
  const o = outs.join('\n'), after = fs.readFileSync(path.join(unit, 'tests.txt'), 'utf8');
  const asked = seen[0]?.messages?.[0]?.content?.[0]?.text ?? '';
  check(/^Strengthen the tests of the Minecraft Bedrock addon in bds\/addons\/hu\//.test(asked) && /^ {2}src\/main\.ts:33 never ran: \/lab:shop → @A cmd \/lab:shop · until form · @A form 0$/m.test(asked) && /^ {2}src\/main\.ts:18 with `<=` → `<`: if \(a\.n <= 0\) return 'PAY nothing to pay';$/m.test(asked), 'harden: the AI is told the never-run place and the surviving bug, each with its code line', asked);
  check(after === TESTS0 + '\n## harden: paying nothing is refused\n@A cmd /lab:pay 0 B\n~ @A PAY nothing to pay\n', 'harden: tests.txt = the old one as it was + the new section that passes (the edited old section and the failing one are not kept)', after);
  check(fs.readFileSync(path.join(unit, 'src', 'main.ts'), 'utf8') === MAINF && !fs.existsSync(path.join(unit, 'src', 'extra.ts')) && /put back what it changed besides tests\.txt: .*src\/main\.ts.*src\/extra\.ts \(new\)/.test(o), 'harden: the code and a new file put back', o);
  check(/^SUSPECT "## harden: wrong on purpose": fails on the code as it is/m.test(o) && /^ {2}\| ~ @A PAY 99 to B$/m.test(o) && /^BUG\? src\/main\.ts:31 the bread button/m.test(o), 'harden: the failing section shown as SUSPECT with its lines; the AI\'s BUG line shown', o);
  const bc = /^ {2}bugs caught: (\d)\/(\d) → (\d)\/\2\b/m.exec(o);
  check(ok && /^harden hu: \+1 section\(s\): "## harden: paying nothing is refused"$/m.test(o) && bc && Number(bc[3]) === Number(bc[1]) + 1 && /^ {2}code the tests run: 95% → 95% \(1 place\(s\) still unrun: src\/main\.ts:33/m.test(o) && /^HARDENED addons\/hu via anthropic:fake: 30 tokens, 2 turns/m.test(o), 'harden: +1 section, one more bug caught than before, HARDENED with its tokens', o);
  const rank = JSON.parse(fs.readFileSync(path.join(L0, 'bds', 'bench', 'ranking.json'), 'utf8'));
  check(rank.some((x) => x.task === 'harden:hu' && x.pass && /^\+1 sections/.test(x.checks)), 'harden: a ranking row', JSON.stringify(rank));
  // nothing missed: no AI call
  const n0 = seen.length; outs.length = 0;
  put(path.join(unit, 'strict'), ''); put(path.join(unit, 'pristine.ts'), MAINF);
  const ok2 = await Mk.harden(L, { name: 'hu', n: 2, via: 'anthropic', model: 'fake', turns: 6 });
  check(ok2 && seen.length === n0 && /^OK harden hu: the tests run its code \(100%\) and caught 2\/2 bug\(s\): nothing to add/m.test(outs.join('\n')), 'harden: nothing missed → done without asking the AI', outs.join('\n'));
  // tests that fail: refused before any AI call
  fs.rmSync(path.join(unit, 'strict')); fs.writeFileSync(path.join(unit, 'src', 'main.ts'), MAINF + '// BROKEN\n'); outs.length = 0;
  const ok3 = await Mk.harden(L, { name: 'hu', n: 2, via: 'anthropic', model: 'fake', turns: 6 });
  check(!ok3 && seen.length === n0 && /^FAIL harden hu: its tests fail: they must pass first/m.test(outs.join('\n')), 'harden: failing tests are refused first (no AI call)', outs.join('\n'));
}
srv.close();
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${bad ? 'FAIL' : 'PASS'} dev-offline (${good} ok${bad ? `, ${bad} failed` : ''})`);
process.exit(bad ? 1 : 0);
