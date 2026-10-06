#!/usr/bin/env node
// A person's addon brought in to fix or finish (common/brief.mjs + import in core.mjs): the ways in found in its code (chat
// words, events, items it checks, commands, script events) with file:line, a draft tests.txt that runs each way in once, the
// brief, a path given from where the person is, the request kept in TASK.md, imported.json, and the first pack one version up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).split('\n').slice(-16).join('\n  ')}`); if (!c) fails++; };
const BR = await import(pathToFileURL(path.join(TOP, 'common', 'brief.mjs')).href);
// a typical person's addon: chat commands, a compass menu, a spawn gift, nothing saved
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-import-')), P = path.join(T, 'My Pack BP');
fs.mkdirSync(path.join(P, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(P, 'manifest.json'), JSON.stringify({ format_version: 2, header: { name: 'My §aPack', uuid: '11111111-2222-4333-8444-555555555555', version: [1, 4, 0], min_engine_version: [1, 20, 0] }, modules: [{ type: 'data', uuid: '11111111-2222-4333-8444-555555555556', version: [1, 0, 0] }, { type: 'script', language: 'javascript', uuid: '11111111-2222-4333-8444-555555555557', version: [1, 0, 0], entry: 'scripts/main.js' }], dependencies: [{ module_name: '@minecraft/server', version: '1.9.0-beta' }] }));
fs.writeFileSync(path.join(P, 'scripts', 'main.js'), `import { world, system } from "@minecraft/server";
const board = world.scoreboard.getObjective("x");
world.beforeEvents.chatSend.subscribe((ev) => {
  if (ev.message === "!spawn") { ev.cancel = true; system.run(() => ev.sender.runCommandAsync("tp @s 0 -60 0")); }
});
world.afterEvents.itemUse.subscribe((ev) => { if (ev.itemStack.typeId === "minecraft:clock") ev.source.sendMessage("tick"); });
system.afterEvents.scriptEventReceive.subscribe((e) => { if (e.id === "my:reset") world.sendMessage("reset"); });
world.afterEvents.playerSpawn.subscribe((ev) => ev.player.runCommandAsync("give @s clock"));
const cmd = () => {}; cmd('my:give', 'Give some', { n: 'int', who: 'player', 'mode?': ['a', 'b'] }, () => 'ok');
`);
const s2 = (() => { const d = path.join(T, 'unit'); fs.mkdirSync(d); fs.cpSync(P, path.join(d, 'bp'), { recursive: true }); return BR.surface(d); })();
ok(s2.chat.map((x) => x.word).join() === '!spawn' && s2.events.map((e) => e.name).join() === 'before.chatSend,itemUse,scriptEventReceive,playerSpawn' && s2.items[0]?.id === 'minecraft:clock' && s2.scriptevents[0]?.id === 'my:reset' && !s2.dynamic && s2.runCommands.length === 2, 'the ways in, from the code: chat words, events, items it checks, script events, commands it runs, nothing saved', JSON.stringify(s2));
// a chat prefix with sub-commands: the words a player types are prefix + name
const d3 = path.join(T, 'unit3', 'bp', 'scripts'); fs.mkdirSync(d3, { recursive: true });
fs.writeFileSync(path.join(d3, 'main.js'), 'import { world } from "@minecraft/server";\nworld.beforeEvents.chatSend.subscribe((ev) => {\n  const msg = ev.message;\n  if (!msg.startsWith("!")) return;\n  const cmd = msg.slice(1).split(" ")[0];\n  if (cmd === "sethome") {}\n  else if (cmd === "home") {}\n});\n');
const s3 = BR.surface(path.join(T, 'unit3'));
ok(s3.chat.map((x) => x.word).join() === '!sethome,!home', 'chat: a "!" prefix with sub-commands compared one by one gives the words players type (!sethome !home), not "!"', JSON.stringify(s3.chat));
const dt = BR.draftTests(s2);
ok(/## \/my:give runs\n@A cmd \/my:give 1 @s\n/.test(dt) && /## loads\n@A join\njs 1\+1\n= 2/.test(dt) && /## chat !spawn runs\n@A chat !spawn/.test(dt) && /## using minecraft:clock runs\ngive A minecraft:clock\nwait 300\n@A select minecraft:clock\n@A use/.test(dt) && /## scriptevent my:reset runs\nscriptevent my:reset/.test(dt) && /## a second player joins\n@B join/.test(dt), 'the draft tests.txt runs each way in once, a command with sample arguments for its mandatory parameters (and keeps one check, so it is a test)', dt);
const bl = BR.briefLines(path.join(T, 'unit'), s2, { name: 'unit', mods: [{ name: 'server', want: '1.9.0-beta', ok: false, has: ['2.10.0', '2.11.0-beta'] }], audit: ['on stable (...): nothing breaks'] }).join('\n');
ok(/bp "My Pack" 1\.4\.0/.test(bl) && /server 1\.9\.0-beta ✗ not in this BDS \(it has 2\.10\.0 2\.11\.0-beta\)/.test(bl) && /chat words !spawn \(main\.js:4\)/.test(bl) && /saves nothing \(all state is lost on restart\/reload\)/.test(bl) && /on stable/.test(bl), 'the brief: pack, modules this BDS lacks, ways in with lines, what is saved, the audit', bl);
// custom components: a block and an item that carry one are ways in, reached the way a player meets them
{
  const d = path.join(T, 'unitcc'), w = (r, x) => { fs.mkdirSync(path.dirname(path.join(d, r)), { recursive: true }); fs.writeFileSync(path.join(d, r), typeof x === 'string' ? x : JSON.stringify(x)); };
  w('bp/scripts/main.js', "import { system } from '@minecraft/server';\nsystem.beforeEvents.startup.subscribe((e) => {\n  e.blockComponentRegistry.registerCustomComponent('cc:lamp', {\n    onPlayerInteract(ev) { ev.block; },\n  });\n  e.itemComponentRegistry.registerCustomComponent('cc:zap', { onUse(ev) { ev.source; } });\n});\n");
  w('bp/blocks/lamp.json', { format_version: '1.21.90', 'minecraft:block': { description: { identifier: 'cc:lamp_block' }, components: { 'cc:lamp': {} } } });
  w('bp/items/zap.json', { format_version: '1.21.90', 'minecraft:item': { description: { identifier: 'cc:zap_item' }, components: { 'cc:zap': {} } } });
  const sc = BR.surface(d), dtc = BR.draftTests(sc), bl = BR.briefLines(d, sc, { name: 'cc' }).join('\n');
  ok(/custom components cc:lamp \(block cc:lamp_block: onPlayerInteract\)/.test(bl) && /cc:zap \(item cc:zap_item: onUse\)/.test(bl), 'brief: custom components are ways in, with the block/item that carries each and its hooks', bl);
  ok(/## cc:lamp on cc:lamp_block runs\nsetblock 2 -60 2 cc:lamp_block\nwait 300\n@A useon 2 -60 2/.test(dtc) && /## cc:zap on cc:zap_item runs\ngive A cc:zap_item\nwait 300\n@A select cc:zap_item\n@A use/.test(dtc), 'the draft tests reach each one: the block placed and used, the item given and used', dtc);
}

// an addon zipped on a Japanese Windows: Shift_JIS names, no UTF-8 flag — read as Japanese (not mojibake that could merge names)
{
  const SC = await import(pathToFileURL(path.join(TOP, 'common', 'scan.mjs')).href);
  const { crc32 } = await import(pathToFileURL(path.join(TOP, 'bedrock-binary', 'src', 'apk', 'zip.js')).href);
  const ent = (name, data) => ({ name, data: Buffer.from(data) });
  const files = [ent(Buffer.from([0x83, 0x65, 0x83, 0x8c, 0x83, 0x7c, 0x81, 0x5b, 0x83, 0x67, 0x2f, ...Buffer.from('manifest.json')]), '{}'), ent(Buffer.from('ok/a.txt'), 'x')];
  const loc = [], cen = []; let off = 0;
  for (const f of files) {
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc32(f.data), 14); h.writeUInt32LE(f.data.length, 18); h.writeUInt32LE(f.data.length, 22); h.writeUInt16LE(f.name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc32(f.data), 16); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(f.name.length, 28); c.writeUInt32LE(off, 42);
    loc.push(h, f.name, f.data); cen.push(c, f.name); off += 30 + f.name.length + f.data.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  const names = SC.unzipAll(Buffer.concat([...loc, cd, e])).map((x) => x.name);
  ok(names.join() === 'テレポート/manifest.json,ok/a.txt', 'a zip with Shift_JIS names (no UTF-8 flag) reads as Japanese', names.join());
}

// import through the lab, with a path relative to where the person runs it, and a request
const name = `zz_import_test_${process.pid}`, unit = path.join(TOP, 'bds', 'addons', name);
const curFile = path.join(TOP, 'bds', '.lab', 'addon'), cur0 = fs.existsSync(curFile) ? fs.readFileSync(curFile, 'utf8') : null;   // (put back after: the import makes its unit the current one)
const zip = spawnSync('zip', ['-q', '-r', path.join(T, 'my.mcaddon'), 'My Pack BP'], { cwd: T });
const what = zip.status === 0 ? 'my.mcaddon' : 'My Pack BP';
const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', 'import', what, 'the !spawn command broke after the update', '--name', name], { cwd: T, encoding: 'utf8', timeout: 600000, env: { ...process.env, LAB_DOTENV: 'off' } });
const o = (r.stdout ?? '') + (r.stderr ?? '');
try {
  ok(r.status === 0 && fs.existsSync(path.join(unit, 'bp', 'manifest.json')) && new RegExp(`OK bds/addons/${name}/`).test(o), `import ${what} from the person's folder (a relative path), now the current addon`, o);
  ok(/the !spawn command broke after the update/.test(fs.readFileSync(path.join(unit, 'TASK.md'), 'utf8')) && JSON.parse(fs.readFileSync(path.join(unit, 'imported.json'), 'utf8')).bp.join('.') === '1.4.0', 'the request in TASK.md, the versions it came with in imported.json', fs.readFileSync(path.join(unit, 'TASK.md'), 'utf8'));
  ok(/## chat !spawn runs/.test(fs.readFileSync(path.join(unit, 'tests.txt'), 'utf8')) && /ways in: .*chat words !spawn/.test(o), 'the draft tests.txt and the brief come with the import', o);
  ok(/^bugs found before any server .*world\.\* at the top level \(api-early\): main\.js:2/m.test(o), 'the brief lists the bugs found before any server, each with its skill rule (here: world.* at load)', o);
} finally { fs.rmSync(unit, { recursive: true, force: true }); fs.rmSync(T, { recursive: true, force: true }); if (cur0 === null) fs.rmSync(curFile, { force: true }); else fs.writeFileSync(curFile, cur0); }
console.log(`${fails ? 'FAIL' : 'PASS'} import-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
