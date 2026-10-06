#!/usr/bin/env node
// The AI-driven development tools on a real BDS with real clients, end to end (about 15 minutes; needs `node lab.mjs setup`).
// A small addon with three planted bugs (an item hook without its component, a wrong comparison, an empty hand read) goes
// through: test → why (each bug: the cause it names) → chaos (finds the crash with players the tests do not use, cuts it, checks
// it after the other sections, --append) → why on it → shrink (a noisy section to its smallest, the players it names joined) →
// the bugs fixed → go DONE → gaps → record → harden with a scripted AI over a fake API (only tests.txt may change, a wrong
// section is kept out, the bugs caught before → after) → mutate. node tests/dev-bds.mjs [--keep] (--keep: leave bds/addons/devbds)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url))), NAME = 'devbds', DIR = path.join(TOP, 'bds', 'addons', NAME);
let fails = 0;
const ok = (c, m, d = '') => { console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n    ' + String(d).trim().split('\n').slice(-14).join('\n    ')}`); if (!c) fails++; };
const t0 = Date.now(), secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
// one lab command on this unit (its own process; async so a fake API server here can answer meanwhile)
const lab = (args, env = {}) => new Promise((res) => {
  const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', ...args, ...(args[0] === 'new' ? [] : ['-a', NAME])], { cwd: TOP, env: { ...process.env, LAB_NOTRACE: '1', FORCE_COLOR: '0', ...env } });
  let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; });
  c.on('close', (code) => { console.log(`  (${args[0]} ${code === 0 ? 'ok' : 'exit ' + code}, ${secs()})`); res({ code, t }); });
});
const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(DIR, f)), { recursive: true }); fs.writeFileSync(path.join(DIR, f), t); };
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const curFile = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(curFile) ? fs.readFileSync(curFile, 'utf8') : null, kind0 = (() => { try { return fs.readFileSync(path.join(TOP, '.lab-kind'), 'utf8'); } catch { return null; } })();

const MAIN = `import { Player, system } from '@minecraft/server';
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

// /lab:hi: answers after a tick, and ends on a bare return (QuickJS has no stop there: gaps must not call it never run)
cmd('lab:hi', 'Say hi', {}, async (p) => {
  await system.waitTicks(1);
  p.sendMessage('HI');
  return undefined;
});
`;
const TESTS = `# command, then expectations: = exact line | ~ regex | ! absent | !~ absent regex; '## title' = section
## loads
@A join
~ joined
## the wand sparks
give A lab:wand 1
@A select lab:wand
@A use
~ @A SPARK 1
## pay
@B join
@A chat hi
give B bread 1
@B walk forward 2
wait 200
give A emerald 2
@A cmd /lab:pay 2 B
~ @A PAY 2 to B
## hi
@A cmd /lab:hi
~ @A HI
`;

try {
  // ---- the unit, with its three bugs ----
  fs.rmSync(DIR, { recursive: true, force: true });
  let r = await lab(['new', NAME, 'Dev Bench', 'A wand that sparks, /lab:pay and a shop menu', 'desc=Use the wand to spark; /lab:pay gives emeralds']);
  ok(r.code === 0 && fs.existsSync(path.join(DIR, 'src', 'main.ts')), 'new: the unit', r.t);
  r = await lab(['add', 'item', 'lab:wand', 'Spark Wand', 'ja=火花の杖', 'tex=wand:8844ff', 'max_stack_size=1']);
  ok(r.code === 0 && !('lab:wand' in JSON.parse(read('bp/items/wand.json'))['minecraft:item'].components), 'add: the wand, its component left out (the first bug)', r.t);
  put('src/main.ts', MAIN); put('tests.txt', TESTS);

  // ---- test, then why on each failure ----
  r = await lab(['test']);
  ok(r.code !== 0 && /✘ \d+: ## the wand sparks/.test(r.t) && /✘ \d+: ## pay/.test(r.t), 'test: the wand and the pay sections fail', r.t);
  r = await lab(['why']);
  ok(/why "the wand sparks"/.test(r.t) && /did not run although the section uses it: onUse of lab:wand/.test(r.t) && /next: bp\/items\/wand\.json: add "lab:wand": \{\}/.test(r.t), 'why (no title): the first failing section; the hook never ran, its component is missing', r.t);
  r = await lab(['why', 'pay']);
  ok(/came instead: "@A PAY you have only 2", printed by src\/main\.ts:20/.test(r.t) && /values there: .*a=\{n=2 .*have=2/.test(r.t) && /would print what the test wants: src\/main\.ts:23 \(never ran in this section\)/.test(r.t) && /next: src\/main\.ts:20 printed it instead of src\/main\.ts:23/.test(r.t), 'why pay: the line that printed what came instead, its values, the wanted line never ran', r.t);

  // ---- chaos: the empty-hand crash, with players the tests do not use, checked after the sections ----
  r = await lab(['chaos', '20', '--seed', '7', '--append']);
  const title = /^## (chaos 7: .*)$/m.exec(r.t)?.[1];
  ok(/players C D/.test(r.t) && /FOUND after line \d+ \(@C cmd \/lab:shop\)/.test(r.t) && title && /TypeError: cannot read property 'typeId' of undefined \(src\/main\.ts:29\)$/.test(title) && /OK appended to tests\.txt/.test(r.t) && read('tests.txt').includes(`## ${title}\n@C join\n@C cmd /lab:shop`), 'chaos: found with C and D, cut, failing after the other sections too, appended', r.t);
  if (title) {
    r = await lab(['why', title]);
    ok(/threw src\/main\.ts:29 (Unhandled promise rejection: )?TypeError: cannot read property 'typeId' of undefined/.test(r.t) && /values: .*held=undefined/.test(r.t) && /next: held is undefined at src\/main\.ts:29/.test(r.t) && !/caught|__lab/.test(r.t), 'why on the chaos section: the line, held=undefined, no noise from the lab or caught throws', r.t);
  }
  // ---- shrink: the noisy pay section to its smallest (B, named only in the command, still joins) ----
  r = await lab(['shrink', 'pay']);
  const shrunk = r.t.slice(r.t.indexOf('cut to'));
  ok(/cut to 2 of 7 command\(s\) and 0 of 2 section\(s\)/.test(r.t) && /came instead: @A PAY you have only 2/.test(r.t) && /^@B join$/m.test(shrunk) && /^give A emerald 2$/m.test(shrunk) && !/^@A chat hi$/m.test(shrunk), 'shrink pay: 2 commands, B joined although only named, the same thing came instead', r.t);

  // ---- the three bugs fixed: go DONE ----
  const wand = JSON.parse(read('bp/items/wand.json')); wand['minecraft:item'].components['lab:wand'] = {}; put('bp/items/wand.json', JSON.stringify(wand, null, 2));
  put('src/main.ts', MAIN.replace('if (have <= a.n)', 'if (have < a.n)').replace('${held!.typeId}', "${held?.typeId ?? 'empty hand'}"));
  r = await lab(['go']);
  ok(r.code === 0 && /^DONE /m.test(r.t), 'go: DONE once the bugs are fixed', r.t);
  r = await lab(['gaps']);
  ok(/S src\/main\.ts:33 never ran: \/lab:shop → @A cmd \/lab:shop · until form · @A form 0/.test(r.t) && !/src\/main\.ts:23 never ran/.test(r.t) && !/src\/main\.ts:40 never ran/.test(r.t), 'gaps: the code after the shop form, with the lines that reach it; a function\'s final return (template or constant) counts as run', r.t);
  r = await lab(['record', '@C cmd /lab:pay 0 A']);
  ok(/^@C join$/m.test(r.t) && /^= @C PAY nothing to pay$/m.test(r.t), 'record: the players it names join first; the expectation from what it prints', r.t);

  // ---- harden with a scripted AI: it may only add sections; a wrong one is kept out; bugs caught before → after ----
  const before = read('tests.txt'), mainNow = read('src/main.ts');
  const ADD = [
    '## harden: paying nothing is refused', '@A cmd /lab:pay 0 B', '~ @A PAY nothing to pay',
    '## harden: paying more than you have takes nothing', 'clear A', 'give A emerald 1', '@A cmd /lab:pay 3 B', '~ @A PAY you have only 1', "js inv(p('A')).join()", '~ minecraft:emerald\\*1',
    '## harden: the shop sells a diamond for 3 emeralds', 'clear A', 'give A emerald 3', '@A cmd /lab:shop', 'until form', '@A form 0', 'until SHOP bought', "js inv(p('A')).join()", '~ minecraft:diamond\\*1', '!~ emerald',
    '## harden: a wrong expectation on purpose', '@A cmd /lab:pay 1 B', '~ @A PAY 99 to B'].join('\n');
  const steps = [
    [{ name: 'lab', input: { args: 'record "@C cmd /lab:pay 0 A"' } }],
    [{ name: 'write', input: { path: 'tests.txt', content: before.replace('~ @A SPARK 1', '~ @A SPARK') + '\n' + ADD + '\n' } }, { name: 'edit', input: { path: 'src/main.ts', old: "'PAY nothing to pay'", new: "'PAY nothing'" } }],
    'Added 4 sections.\nBUG src/main.ts:31 the bread button says bought without taking an emerald',
  ];
  const seen = [];
  const srv = http.createServer((q, s) => { let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => { seen.push(JSON.parse(b)); const st = steps[seen.length - 1] ?? 'done';
    s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ content: typeof st === 'string' ? [{ type: 'text', text: st }] : st.map((c, i) => ({ type: 'tool_use', id: `t${seen.length}_${i}`, name: c.name, input: c.input })), usage: { input_tokens: 100, output_tokens: 50 }, stop_reason: typeof st === 'string' ? 'end_turn' : 'tool_use' })); }); });
  await new Promise((z) => srv.listen(0, '127.0.0.1', z));
  r = await lab(['harden', '4', '--via', 'anthropic'], { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}`, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' });
  srv.close();
  const prompt = JSON.stringify(seen[0]?.messages?.[0] ?? '');
  ok(/Strengthen the tests of the Minecraft Bedrock addon in bds\/addons\/devbds/.test(prompt) && /never ran: \/lab:shop/.test(prompt), 'harden: the AI is told the places no test runs (and the bugs no test notices)', prompt.slice(0, 600));
  const after = read('tests.txt');
  ok(after.startsWith(before.trimEnd()) && after.includes('## harden: paying nothing is refused') && after.includes('## harden: the shop sells a diamond for 3 emeralds') && !after.includes('a wrong expectation on purpose') && after.includes('~ @A SPARK 1'), 'harden: new sections kept after the old tests.txt as it was (an old section it edited stays as it was)', after.slice(-900));
  ok(read('src/main.ts') === mainNow && /put back what it changed besides tests\.txt: .*src\/main\.ts/.test(r.t), 'harden: its edit to the code is put back', r.t);
  ok(/SUSPECT "## harden: a wrong expectation on purpose": fails on the code as it is/.test(r.t) && /BUG\? src\/main\.ts:31/.test(r.t), 'harden: a section that fails is kept out (SUSPECT), the AI\'s BUG line is shown', r.t);
  ok(r.code === 0 && /harden devbds: \+3 section\(s\)/.test(r.t) && /code the tests run: \d+% → \d+%/.test(r.t) && /^HARDENED /m.test(r.t), 'harden: +3 sections, the coverage before → after, HARDENED', r.t);
  const rank = JSON.parse(fs.readFileSync(path.join(TOP, 'bds', 'bench', 'ranking.json'), 'utf8'));
  ok(rank.some((x) => x.task === `harden:${NAME}` && x.pass), 'harden: a ranking row');
  r = await lab(['mutate', '3']);
  ok(/coverage: \d+% of code lines ran/.test(r.t) && /(OK|W) mutate devbds: \d+\/\d+ bugs caught/.test(r.t) && read('src/main.ts') === mainNow, 'mutate: 3 bugs tried, the unit put back exactly', r.t);
} finally {
  if (!process.argv.includes('--keep')) fs.rmSync(DIR, { recursive: true, force: true });
  try { fs.rmSync(path.join(TOP, 'bds', 'dist', 'Dev_Bench.mcaddon'), { force: true }); } catch { /* none */ }
  try { const rf = path.join(TOP, 'bds', 'bench', 'ranking.json'), all = JSON.parse(fs.readFileSync(rf, 'utf8')); fs.writeFileSync(rf, JSON.stringify(all.filter((x) => !String(x.task).endsWith(`:${NAME}`)), null, 1) + '\n'); } catch { /* none */ }
  if (cur0 !== null) fs.writeFileSync(curFile, cur0);
  if (kind0 !== null) fs.writeFileSync(path.join(TOP, '.lab-kind'), kind0);
}
console.log(`\n${fails ? 'FAIL' : 'PASS'} dev-bds (${secs()})`);
process.exit(fails ? 1 : 0);
