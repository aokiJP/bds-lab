#!/usr/bin/env node
// common/schema.mjs: pack JSON against bedrock-schemas, calibrated on vanilla. Offline part: a small schema package of the
// same shape (file $refs, anyOf, open objects) proves the validator and the calibration rules (a vanilla quirk is never
// reported; E only at a node vanilla passes; unknown keys W with the nearest key; custom components and "1.2.3" / [1,2,3]
// versions accepted). With the real package (LAB_SCHEMA_ROOT, or installed by a build in bds/.lab): every bundled pack the
// calibration trusts is clean, and planted mistakes in an addon are found.
//   node tests/schema-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-schema-'));
let n = 0, fails = 0;
const ok = (c, what, detail = '') => { n++; if (!c) fails++; console.log(`${c ? '✔' : '✘'} ${what}${c || !detail ? '' : '\n    ' + String(detail).split('\n').slice(0, 20).join('\n    ')}`); };
const put = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const node = (args, env = {}) => spawnSync(process.execPath, [path.join(TOP, 'common', 'schema.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

// ---------- a small package: items (with a file $ref, an anyOf, a closed enum, a range) ----------
const PKG = path.join(T, 'pkg'), ROOT = path.join(PKG, 'schemas');
put(path.join(PKG, 'package.json'), { name: '@minecraft/bedrock-schemas', version: '9.9.9' });
put(path.join(ROOT, 'bp/items/index.schema.json'), { type: 'object', required: ['format_version', 'minecraft:item'], properties: {
  format_version: { type: 'string' },
  'minecraft:item': { type: 'object', required: ['description'], properties: { description: { $ref: './item_description.schema.json' }, components: { $ref: './item_components.schema.json' } } } } });
put(path.join(ROOT, 'bp/items/item_description.schema.json'), { type: 'object', required: ['identifier'], properties: {
  identifier: { type: 'string', pattern: '^[a-z0-9_]+:[a-z0-9_]+$' }, menu_category: { type: 'object', properties: { category: { type: 'string', enum: ['construction', 'equipment', 'items', 'nature', 'none'] } } } } });
put(path.join(ROOT, 'bp/items/item_components.schema.json'), { type: 'object', properties: {
  'minecraft:max_stack_size': { anyOf: [{ type: 'integer', minimum: 1, maximum: 64 }, { type: 'object', properties: { value: { type: 'integer', minimum: 1, maximum: 64 } } }] },
  'minecraft:icon': { anyOf: [{ type: 'string' }, { type: 'object', properties: { texture: { type: 'string' } } }] },
  'minecraft:food': { type: 'object', properties: { nutrition: { type: 'integer' }, can_always_eat: { type: 'boolean' } } },
  'minecraft:wearable': { type: 'object', properties: { slot: { type: 'string', enum: ['slot.armor.head'] } } },   // a mistake in the schema: vanilla uses others
  'minecraft:rarity': { type: 'string', enum: ['common', 'rare'] },   // vanilla never uses it here
  'minecraft:missing': { $ref: './not_shipped.schema.json' } } });
put(path.join(ROOT, 'bp/blocks/index.schema.json'), { type: 'object', properties: { format_version: { type: 'string' }, 'minecraft:block': { type: 'object', properties: { filters: { type: 'object', properties: { test: { type: 'string' } } } } } } });
put(path.join(ROOT, 'bp/entities/index.schema.json'), { type: 'object', properties: { x: { type: 'object', properties: { filters: { type: 'object', properties: { all_of: { type: 'array' }, test: { type: 'string' } } } } } } });

// vanilla: a correct item, and one using the slot the schema forgets
const VAN = path.join(T, 'samples');
put(path.join(VAN, 'behavior_pack/items/apple.json'), { format_version: '1.21.0', 'minecraft:item': { description: { identifier: 'minecraft:apple', menu_category: { category: 'nature' } },
  components: { 'minecraft:max_stack_size': 64, 'minecraft:icon': 'apple', 'minecraft:food': { nutrition: 4, can_always_eat: false } } } });
put(path.join(VAN, 'behavior_pack/items/boots.json'), { format_version: '1.21.0', 'minecraft:item': { description: { identifier: 'minecraft:boots' }, components: { 'minecraft:max_stack_size': { value: 1 }, 'minecraft:wearable': { slot: 'slot.armor.feet' } } } });
const CAL = path.join(T, 'cal.json'), env = { LAB_SCHEMA_CAL: CAL, LAB_SCHEMA_ROOT: ROOT };
let r = node(['calibrate', VAN, ROOT], env);
const cal = fs.existsSync(CAL) ? JSON.parse(fs.readFileSync(CAL, 'utf8')) : {};
ok(r.status === 0 && cal.version === '9.9.9' && cal.files === 2, 'calibrate: reads vanilla, records the package version', r.stdout + r.stderr);
ok((cal.quirks ?? []).includes('bp/items/item_components#/properties/minecraft:wearable/properties/slot:enum'), 'calibrate: the enum vanilla breaks is a quirk', JSON.stringify(cal.quirks));
ok(Object.values(cal.trusted ?? {}).flat().includes('/properties/minecraft:food/properties/nutrition'), 'calibrate: a node vanilla passes is trusted');

// an addon with one mistake of each kind
const ADD = path.join(T, 'addon'), BP = path.join(ADD, 'bp');
put(path.join(BP, 'manifest.json'), { format_version: 2, header: { name: 'x', uuid: '00000000-0000-4000-8000-000000000001', version: [1, 0, 0] }, modules: [] });
put(path.join(BP, 'items/ruby.json'), `// comments are allowed in pack JSON
{ "format_version": [1, 21, 0], "minecraft:item": { "description": { "identifier": "lab:Ruby", "menu_category": { "category": "gems" } },
  "components": { "minecraft:max_stack_size": 100, "minecraft:icon": 5, "minecraft:food": { "nutrition": "4", "can_alwayz_eat": true },
    "minecraft:wearable": { "slot": "slot.armor.feet" }, "minecraft:missing": { "anything": 1 }, "lab:glow": {}, "minecraft:rarity": "legendary" } } }`);
put(path.join(BP, 'items/no_desc.json'), { format_version: '1.21.0', 'minecraft:item': { components: {} } });
put(path.join(BP, 'blocks/b.json'), { format_version: '1.21.0', 'minecraft:block': { filters: { all_of: [], tset: 'x' } } });
put(path.join(BP, 'functions/x.json'), { not: 'schema-mapped' });
r = node(['check', BP], env);
const o = r.stdout, line = (re) => o.split('\n').find((l) => re.test(l)) ?? '';
ok(/^E .*food\/nutrition: must be integer \(got "4"\)/m.test(o), 'E: a type error at a node vanilla passes', o);
ok(/^E .*no_desc\.json \/minecraft:item: needs "description"/m.test(o), 'E: a missing required key', o);
ok(/^W .*can_alwayz_eat.*did you mean "can_always_eat"/m.test(o), 'W: an unknown key names the nearest one', o);
ok(/^E .*menu_category\/category: must be one of/m.test(line(/category/)), 'E: a value outside an enum vanilla passes', o);
ok(/^W .*minecraft:rarity: must be one of "common" "rare" \(got "legendary"\)/m.test(line(/rarity/)), 'W: the same at a node vanilla never reaches', o);
ok(/max_stack_size: must be ≤ 64 \(got 100\)/.test(o) && !/max_stack_size: must be object/.test(o), 'anyOf: the branch of the right type explains (range), not every branch', o);
ok(/minecraft:icon: must be string\|object \(got 5\)/.test(o), 'anyOf: a wrong type everywhere is one line with the types', o);
ok(/identifier: must match/.test(o), 'W: a pattern (upper case identifier)', o);
ok(!/slot/.test(o), 'a vanilla quirk (enum the schema forgets) is never reported', o);
ok(!/format_version/.test(o), 'a version as [x,y,z] is accepted', o);
ok(!/lab:glow|anything/.test(o), 'custom components and $refs the package lacks are not findings', o);
ok(!/all_of/.test(o) && /tset.*did you mean "test"/.test(o), 'a key listed under the same name elsewhere (filters → all_of) is not a typo; a real typo still is', o);
ok(!/functions\/x\.json|comments/.test(o) && r.status === 1 && /FAIL$/.test(o.trim()), 'unmapped files skipped, comments stripped, exit 1 on E', o);
// what a real BDS refuses that the schemas leave out: E whatever the calibration says
const RB = path.join(T, 'rules', 'bp');
put(path.join(RB, 'blocks/lamp.json'), { format_version: '1.21.90', 'minecraft:block': { description: { identifier: 'lab:lamp' }, components: { 'minecraft:light_emission': 15 }, permutations: [{ condition: 'q.block_state(\'lab:lit\')', components: { 'minecraft:light_dampening': 20 } }] } });
put(path.join(RB, 'items/a.json'), { format_version: '1.21.90', 'minecraft:item': { description: { identifier: 'lab:a' }, components: { 'minecraft:max_stack_size': { value: 99 } } } });
put(path.join(RB, 'recipes/new.json'), { format_version: '1.20.10', 'minecraft:recipe_shaped': { description: { identifier: 'lab:n' }, tags: ['crafting_table'], pattern: ['a'], key: { a: { item: 'minecraft:stick' } }, result: { item: 'lab:a' } } });
put(path.join(RB, 'recipes/old.json'), { format_version: '1.19.0', 'minecraft:recipe_shapeless': { description: { identifier: 'lab:o' }, tags: ['crafting_table'], ingredients: [{ item: 'minecraft:dirt' }], result: { item: 'lab:a' } } });
put(path.join(RB, 'recipes/ok.json'), { format_version: '1.20.10', 'minecraft:recipe_shapeless': { description: { identifier: 'lab:k' }, tags: ['crafting_table'], ingredients: [{ item: 'minecraft:sand' }], unlock: [{ item: 'minecraft:sand' }], result: { item: 'lab:a' } } });
r = node(['check', RB], env);
ok(/^E .*permutations\/0\/components\/minecraft:light_dampening: must be 0\.\.15 \(got 20\)/m.test(r.stdout) && !/light_emission/.test(r.stdout), 'rule: light levels 0..15, in permutations too', r.stdout);
ok(/^E .*max_stack_size\/value: must be 1\.\.64 \(got 99\)/m.test(r.stdout), 'rule: max_stack_size 1..64, the object form too', r.stdout);
ok(/^E .*new\.json \/minecraft:recipe_shaped: needs "unlock"/m.test(r.stdout) && !/old\.json|ok\.json/.test(r.stdout), 'rule: 1.20+ crafting recipes need unlock; older or with unlock pass', r.stdout);
r = node(['check', path.join(T, 'nothing')], env);
ok(r.status === 0 && /OK$/.test(r.stdout.trim()), 'nothing to check: OK');

// ---------- the real package (calibrated version) ----------
const realCal = JSON.parse(fs.readFileSync(path.join(TOP, 'common', 'data', 'schema-calibration.json'), 'utf8'));
const cached = path.join(TOP, 'bds', '.lab', `schemas-${realCal.version}`, 'node_modules', '@minecraft', 'bedrock-schemas', 'schemas');
const real = process.env.LAB_SCHEMA_ROOT || (fs.existsSync(cached) ? cached : null);
if (!real) console.log(`- real package: skipped (no ${cached}: any build with the network installs it, or set LAB_SCHEMA_ROOT)`);
else {
  const renv = { LAB_SCHEMA_ROOT: real };
  for (const u of ['bds/addons/ts_repl', 'bds/addons/jsonui_demo']) {
    const a = [path.join(TOP, u, 'bp'), ...(fs.existsSync(path.join(TOP, u, 'rp')) ? [path.join(TOP, u, 'rp')] : [])];
    r = node(['check', ...a], renv);
    ok(r.status === 0 && !/^E /m.test(r.stdout), `real: ${u} has no E`, r.stdout);
  }
  const X = path.join(T, 'real');
  put(path.join(X, 'bp/manifest.json'), { format_version: 2, header: { name: 'x', uuid: '00000000-0000-4000-8000-000000000002', version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'data', uuid: '00000000-0000-4000-8000-000000000003', version: [1, 0, 0] }] });
  put(path.join(X, 'bp/items/ruby.json'), { format_version: '1.21.50', 'minecraft:item': { description: { identifier: 'lab:ruby', menu_category: { category: 'items' } },
    components: { 'minecraft:max_stack_size': 16, 'minecraft:icon': 'lab_ruby', 'minecraft:food': { nutrition: 'lots', can_always_eat: true }, 'minecraft:display_name': { value: 'Ruby' } } } });
  put(path.join(X, 'bp/entities/slime.json'), { format_version: '1.21.50', 'minecraft:entity': { description: { identifier: 'lab:slime', is_spawnable: true, is_summonable: true },
    components: { 'minecraft:health': { value: 6, max: 6 }, 'minecraft:breathable': { generatesBubbles: false }, 'minecraft:physics': {} } } });
  r = node(['check', path.join(X, 'bp')], renv);
  ok(/nutrition: must be/.test(r.stdout) && /generatesBubbles.*generates_bubbles/.test(r.stdout), 'real: a wrong type and a camelCase key are found', r.stdout);
  ok(!/display_name|health|physics|min_engine_version|is_spawnable|ruby\.json \/minecraft:item\/description/.test(r.stdout), 'real: nothing said about the correct parts', r.stdout);
}

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} schema-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
