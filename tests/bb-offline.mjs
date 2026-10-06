#!/usr/bin/env node
// `node lab.mjs bb` (common/bb.mjs) with no BDS: a fake lab whose BDS profiles are already read, bedrock-binary itself linked in.
// Checked: the summary, packet ids (from each class's getId(): never the enum's order) by name and by number, the one-line diff
// an update prints (new / gone / renumbered packets, new commands, shifted enum ids), Mojang's protocol docs as a second opinion,
// an old profile without ids, the hidden commands as a BDS answered them (has it / needs arguments / not here), what
// `doc /<command>` says for one the docs leave out — and bedrock-binary's own tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
if (!fs.existsSync(path.join(REPO, 'bedrock-binary', 'src', 'cli.js'))) { console.log('PASS bb-offline (no bedrock-binary/ here: nothing to test)'); process.exit(0); }
const X = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-bb-'));
process.env.LAB_BB_ROOT = X; process.env.LAB_KIND = 'bds';
fs.symlinkSync(path.join(REPO, 'bedrock-binary'), path.join(X, 'bedrock-binary'), 'junction');
const bds = path.join(X, 'bds', '.lab', 'bds'), cache = path.join(X, 'bds', '.lab', 'bb');
fs.mkdirSync(path.join(bds, 'resource_packs', 'vanilla', 'texts'), { recursive: true }); fs.mkdirSync(cache, { recursive: true });
fs.writeFileSync(path.join(bds, 'VERSION'), '1.26.60.1\n');
fs.writeFileSync(path.join(bds, 'resource_packs', 'vanilla', 'texts', 'en_US.lang'), 'commands.querytarget.description=Gets information about the given target.\n');
fs.writeFileSync(path.join(X, 'bds', '.lab', 'beta.json'), '{"server":"2.12.0-beta"}');
// packets as bedrock-binary reads them: ids from each class's getId(), not the enum's order (the enum below even puts NewThing
// in the middle: nothing may come out renumbered for that)
const pk = (list, noClass = []) => ({ basis: 'getId', slot: 2, list: list.map(([id, c, name]) => ({ id, class: c, name: name ?? null })), noClass });
const prof = (ver, enumValues, packets, commands, extra = []) => ({ format: 1, version: ver, channel: 'release', binary: { machine: 'x86-64' }, stats: {}, identifiers: { live: [], dead: [] },
  enums: [{ name: 'MinecraftPacketIds', short: 'MinecraftPacketIds', source: 'cereal', ordered: true, values: enumValues }, ...extra], packets,
  commands: commands.map(([name, doc, key]) => ({ name, inOfficialMetadata: doc, descriptionKey: key ?? null })),
  wss: { summary: { eventTypeValues: 56 } }, facts: { scriptModules: [{ name: '@minecraft/server', referenced: true, versions: [] }] } });
const E0 = ['KeepAlive', 'Login', 'PlayStatus', 'Text', 'UpdateBlockProperties'], E1 = ['KeepAlive', 'Login', 'NewThing', 'PlayStatus', 'Text'];
const K0 = pk([[1, 'LoginPacket', 'Login'], [2, 'PlayStatusPacket', 'PlayStatus'], [9, 'TextPacket', 'Text'], [134, 'UpdateBlockPropertiesPacket', 'UpdateBlockProperties'], [200, 'MovedPacket'], [330, 'DataStoreSyncPacket']]);
const K1 = pk([[1, 'LoginPacket', 'Login'], [2, 'PlayStatusPacket', 'PlayStatus'], [9, 'TextPacket', 'Text'], [301, 'MovedPacket'], [330, 'ClientboundDataStorePacket'], [353, 'NewThingPacket', 'NewThing']], [{ name: 'KeepAlive', id: 0 }]);
const cause = (v) => ({ name: 'ActorDamageCause', short: 'ActorDamageCause', source: 'cereal', ordered: true, values: v });
const P0 = prof('1.26.52.3', E0, K0, [['give', true], ['listd', false]], [cause(['none', 'fall', 'fire', 'lava'])]);
const P1 = prof('1.26.60.1', E1, K1, [['give', true], ['listd', false], ['querytarget', false, 'commands.querytarget.description'], ['transferserver', false]], [cause(['none', 'contact', 'fall', 'fire', 'lava'])]);
fs.writeFileSync(path.join(cache, 'release-1.26.52.3.json'), JSON.stringify(P0));
fs.writeFileSync(path.join(cache, 'release-1.26.60.1.json'), JSON.stringify(P1));
const B = await import(pathToFileURL(path.join(REPO, 'common', 'bb.mjs')).href);
const run = async (a) => { const o = []; const r = await B.bbCmd(a, (l) => o.push(String(l))); return { r, t: o.join('\n') }; };

let r = await run([]);
ok(r.r && /^BDS 1\.26\.60\.1 binary: 6 packets \(ids from getId\(\)\) · 2 enums \(2 with their real type name\) · 4 commands \(3 not in Mojang's docs\) · WSS 56 event types$/m.test(r.t) && /server 2\.12\.0-beta/.test(r.t), 'summary: packets, enums, commands, WSS; module versions from the lab\'s own measurement', r.t);
ok(/^binary 1\.26\.52\.3 → 1\.26\.60\.1: packets \+1 \(NewThing\) -1 \(UpdateBlockProperties\) · 1 renumbered · renamed DataStoreSync→ClientboundDataStore · commands \+querytarget transferserver · ids shifted in ActorDamageCause$/m.test(r.t), 'the change since the last version in one line: packets by their getId() ids (a packet put in the middle of the enum renumbers nothing; a new class name on the same id is a rename), new commands, shifted enum ids', r.t);
r = await run(['packets', 'text']);
ok(/^9 \(0x9\) Text$/m.test(r.t), 'packets by name: the id from getId()', r.t);
r = await run(['packets', '0x161']);
ok(/^353 \(0x161\) NewThing$/m.test(r.t), 'packets by hex id', r.t);
r = await run(['packets', '2']);
ok(/^2 \(0x2\) PlayStatus$/m.test(r.t) && r.t.split('\n').length === 2, 'packets by number (only that id)', r.t);
r = await run(['packets', 'keepalive']);
ok(r.r && /^0 \(0x0\) KeepAlive: in MinecraftPacketIds, but no packet class in this BDS/m.test(r.t), 'an enumerator with no packet class says so (with the id its place gives)', r.t);
// an older profile (no ids) on one side: packets compared by name only, and said so
fs.writeFileSync(path.join(X, 'old.json'), JSON.stringify({ ...P0, packets: undefined }));
const sd = await B.shortDiff(path.join(X, 'old.json'), path.join(cache, 'release-1.26.60.1.json'));
ok(/packets \+1 \(NewThing\) -1 \(UpdateBlockProperties\) \(names only: an older profile has no ids\)/.test(sd) && !/renumbered/.test(sd), 'diff with an older profile: names only, no renumbering claimed', sd);
// Mojang's protocol docs (as proto caches them) as a second opinion on the ids
const proto = path.join(X, 'proto');
fs.mkdirSync(path.join(proto, '1.26.60'), { recursive: true });
fs.writeFileSync(path.join(proto, '1.26.60', 'MinecraftPacketIds.json'), JSON.stringify({ 'x-minecraft-version': '1.26.60-beta.1', enum: ['KeepAlive', 'Login', 'PlayStatus', 'Text', 'NewThing'], 'x-enum-binary-value': [0, 1, 2, 9, 353] }));
let dc = B.docsCheck(P1, proto);
ok(dc?.same === 4 && !dc.differ.length, 'Mojang\'s docs agree with every id they list (4)', JSON.stringify(dc));
fs.writeFileSync(path.join(proto, '1.26.60', 'MinecraftPacketIds.json'), JSON.stringify({ enum: ['Login', 'Text'], 'x-enum-binary-value': [1, 10] }));
dc = B.docsCheck(P1, proto);
ok(dc?.same === 1 && dc.differ.join() === 'Text 9≠10', 'a disagreement is named', JSON.stringify(dc));
// the hidden commands as a BDS answered them (lab.mjs run's output shape), then cached
const cls = B.classify(['> listd', 'There are 0/10 players online:', '> querytarget', 'E Syntax error: Unexpected "": at "uerytarget>><<"', '> transferserver', 'E Unknown command: transferserver. Please check that the command exists and that you have permission to use it.'], ['listd', 'querytarget', 'transferserver', 'quiet']);
ok(JSON.stringify(cls) === JSON.stringify({ listd: 'works', querytarget: 'args', transferserver: 'absent', quiet: 'works' }), 'a try on BDS: runs / needs arguments / unknown here (printed nothing: it ran)', JSON.stringify(cls));
fs.writeFileSync(path.join(cache, 'release-1.26.60.1.commands.json'), JSON.stringify(cls));
r = await run(['commands']);
ok(/this BDS runs: listd/.test(r.t) && /with arguments: querytarget \(Gets information about the given target\.\)/.test(r.t) && /not on this BDS .*transferserver/.test(r.t), 'commands: grouped by what this BDS did, with the description from en_US.lang', r.t);
const h = B.hiddenCommand('querytarget', cache, bds);
ok(h?.text === 'Gets information about the given target.' && /needs arguments/.test(h.says) && B.hiddenCommand('give', cache, bds)?.inDocs === true && B.hiddenCommand('nope', cache, bds) === null, 'doc /<command>: the binary\'s description and what this BDS said, from the cache only');
r = await run(['help']);
ok(r.r && /bb packets \[name\|id\]/.test(r.t), 'bb help: the lab\'s own uses');
r = await run(['enum', 'ActorDamageCause']);
ok(/contact/.test(r.t), 'other bedrock-binary commands run on this BDS\'s profile', r.t);
// a profile from an older bedrock-binary (no packet ids) and the binary cannot be read again here: keep using it, say so
fs.writeFileSync(path.join(cache, 'release-1.26.60.1.json'), JSON.stringify({ ...P1, packets: undefined }));
fs.writeFileSync(path.join(bds, 'bedrock_server'), Buffer.concat([Buffer.from('\x7fELF', 'latin1'), Buffer.alloc(60)]));
r = await run([]);
ok(r.r && /^W could not read the BDS 1\.26\.60\.1 binary again .*no packet ids$/m.test(r.t) && /packet ids unreadable/.test(r.t) && !fs.existsSync(path.join(cache, 'release-1.26.60.1.json.new')), 'an old profile that cannot be read again: still used, the missing packet ids said', r.t);
r = await run(['packets', 'text']);
ok(!r.r && /^E no packet ids: the profile was read by an older bedrock-binary/m.test(r.t), 'bb packets then says why there are no ids (never the enum order as ids)', r.t);
// bedrock-binary's own tests (synthetic ELF / APK; no game binary)
const t = spawnSync(process.execPath, ['--test', ...fs.readdirSync(path.join(REPO, 'bedrock-binary', 'test')).filter((f) => f.endsWith('.test.js')).map((f) => path.join('test', f))], { cwd: path.join(REPO, 'bedrock-binary'), encoding: 'utf8', timeout: 300000 });
const pass = /# pass (\d+)/.exec(t.stdout)?.[1], fail = /# fail (\d+)/.exec(t.stdout)?.[1];
ok(t.status === 0 && fail === '0', `bedrock-binary's own tests (${pass ?? '?'} pass)`, t.stdout.split('\n').filter((l) => /^not ok/.test(l)).join('\n'));
fs.rmSync(X, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} bb-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
