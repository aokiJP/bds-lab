#!/usr/bin/env node
// Resource-pack checks the game never reports (BDS does not load RP UI or models; the client just draws them wrong):
// common/model.mjs lintGeo and common/jsonui.mjs lintUi. Each defect is shown failing on the broken file AND passing on
// the fixed one (a check never seen failing proves nothing). The rules of skills bds-models / bds-json-ui cite this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const M = await import(pathToFileURL(path.join(TOP, 'common', 'model.mjs')));
const J = await import(pathToFileURL(path.join(TOP, 'common', 'jsonui.mjs')));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).slice(0, 900)}`); if (!c) fails++; };
const geo = (cubes, tw = 32, th = 32, more = []) => ({ id: 'geometry.t', tw, th, bones: [{ name: 'body', pivot: [0, 0, 0], cubes }, ...more] });
const lint = (g) => M.lintGeo(g).errs;
const pair = (bad, good, re, msg) => { const b = lint(bad), g = lint(good); ok(b.some((e) => re.test(e)) && !g.some((e) => re.test(e)), msg, `broken: ${JSON.stringify(b)}\nfixed: ${JSON.stringify(g)}`); };

// models
pair(geo([{ origin: [0, 0, 0], size: [4, -2, 4], uv: [0, 0] }]), geo([{ origin: [0, 0, 0], size: [4, 2, 4], uv: [0, 0] }]), /collapsed cube/, 'model: a negative size (a Blockbench drag past zero) is a collapsed cube');
pair(geo([{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }, { origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }]), geo([{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }]), /duplicate cube/, 'model: the same cube twice is found');
pair(geo([{ origin: [0, 0, 0], size: [8, 8, 8], uv: [20, 0] }], 32, 32), geo([{ origin: [0, 0, 0], size: [8, 8, 8], uv: [0, 0] }], 32, 32), /UV leaves the 32x32 texture/, 'model: box UV that runs off texture_width/height is found (the face draws garbage)');
// two cubes side by side whose top faces share y=4 and overlap: z-fight; lowered by 0.03: none
pair(geo([{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }, { origin: [2, 0, 0], size: [4, 4, 4], uv: [0, 8] }], 64, 64),
  geo([{ origin: [0, 0, 0], size: [4, 4, 4], uv: [0, 0] }, { origin: [2, -0.03, 0.03], size: [4, 4, 3.94], uv: [0, 8] }], 64, 64), /z-fight/, 'model: two faces on one plane z-fight; moving one 0.02-0.05 clears it');
// a zero-thickness plate (wing): its two faces must be the same size or one paints over the other's cut-out
const plate = (a, b) => geo([{ origin: [0, 0, 0], size: [8, 0, 8], uv: { up: { uv: [0, 0], uv_size: a }, down: { uv: [16, 0], uv_size: b } } }], 64, 64);
pair(plate([8, 8], [4, 4]), plate([8, 8], [8, 8]), /two-faced plate with unequal faces/, 'model: a plate whose two faces differ in size is found');
// rotation: right-handed (-rx, ry, -rz) about the pivot (the game's convention, not the JSON's naive reading)
const p = M.rotate([0, 1, 0], [0, 0, 0], [90, 0, 0]);
ok(Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2] + 1) < 1e-9, 'model: rotation [90,0,0] turns +y to -z (applied as -rx), as the game draws it', JSON.stringify(p));
// x mirror: east is drawn on the LOW-x side
const east = M.facePoint([0, 0, 0], [2, 2, 2], 'east', 0.5, 0.5), west = M.facePoint([0, 0, 0], [2, 2, 2], 'west', 0.5, 0.5);
ok(east[0] === 0 && west[0] === 2, "model: the game draws a cube's east UV on its LOW-x side, west on the high-x side (mirrored in x)", JSON.stringify({ east, west }));
const t = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-rp-'));
const gf = path.join(t, 'm.geo.json');
fs.writeFileSync(gf, JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.m', texture_width: 16, texture_height: 16 }, bones: [{ name: 'b', pivot: [0, 0, 0], cubes: [{ origin: [-1, 0, -1], size: [2, 2, 2], uv: [0, 0] }] }] }] }));
const g0 = M.loadGeos(gf)[0];
ok(g0.id === 'geometry.m' && g0.tw === 16 && lint(g0).length === 0, 'model: loadGeos reads format 1.12 (identifier, texture size); a clean cube has no findings', JSON.stringify(lint(g0)));

// JSON UI
const rp = path.join(t, 'rp');
const put = (f, j) => { fs.mkdirSync(path.dirname(path.join(rp, f)), { recursive: true }); fs.writeFileSync(path.join(rp, f), typeof j === 'string' ? j : JSON.stringify(j)); };
const van = { ns: { common: ['button', 'empty_panel'], server_form: ['long_form', 'main_screen_content'] }, files: { 'server_form.json': 'server_form' }, values: {}, textures: new Set(['textures/ui/white_background']) };
const lu = () => J.lintUi(rp, van);
put('ui/my_hud.json', { namespace: 'my_hud', root: { type: 'panel', controls: [{ 'bg@common.empty_panel': {} }] } });
put('ui/_ui_defs.json', { ui_defs: [] });
ok(lu().some((w) => /my_hud\.json: not listed in rp\/ui\/_ui_defs\.json/.test(w)), 'ui: a file missing from _ui_defs.json is never loaded: found', JSON.stringify(lu()));
put('ui/_ui_defs.json', { ui_defs: ['ui/my_hud.json'] });
ok(!lu().some((w) => /not listed/.test(w)), 'ui: listed in _ui_defs.json: clean', JSON.stringify(lu()));
put('ui/_ui_defs.json', { ui_defs: ['ui/my_hud.json', 'ui/gone.json'] });
ok(lu().some((w) => /ui\/gone\.json does not exist/.test(w)), 'ui: a _ui_defs entry with no file is found');
put('ui/_ui_defs.json', { ui_defs: ['ui/my_hud.json'] });
put('ui/my_hud.json', { namespace: 'my_hud', root: { type: 'panel', controls: [{ 'bg@common.buton': {} }] } });
ok(lu().some((w) => /common\.buton does not exist: did you mean common\.button\?/.test(w)), 'ui: a misspelt @base names the nearest real element', JSON.stringify(lu()));
put('ui/my_hud.json', { namespace: 'my_hud', root: { type: 'panel', controls: [{ 'bg@nope.thing': {} }] } });
ok(lu().some((w) => /namespace "nope" does not exist/.test(w)), 'ui: an unknown namespace is found');
put('ui/my_hud.json', { namespace: 'my_hud', root: { type: 'image', texture: 'textures/ui/made_up' } });
ok(lu().some((w) => /texture textures\/ui\/made_up is in neither this pack nor vanilla/.test(w)), 'ui: an invented textures/ui path is found');
put('textures/ui/made_up.png', 'x');
ok(!lu().some((w) => /made_up/.test(w)), 'ui: the same path with the png in the pack: clean');
put('ui/my_hud.json', { namespace: 'my_hud', root: { type: 'pannel', anchor_from: 'middle' } });
ok(lu().some((w) => /type "pannel" is not one of/.test(w)) && lu().some((w) => /anchor_from "middle"/.test(w)), 'ui: a wrong type / anchor value is found', JSON.stringify(lu()));
put('ui/my_hud.json', { namespace: 'my_hud', root: { type: 'label', bindings: [{ binding_type: 'view', source_property_name: '#x' }] } });
ok(lu().some((w) => /a view binding needs source_property_name and target_property_name/.test(w)), 'ui: a view binding without target_property_name is found');
put('ui/my_hud.json', { namespace: 'my_hud', root: { type: 'panel' } });
put('ui/server_form.json', { namespace: 'my_form', x: { type: 'panel' } });
ok(lu().some((w) => /server_form\.json: namespace "my_form", but the vanilla server_form\.json is "server_form"/.test(w)), 'ui: a vanilla screen file with its own namespace makes a new namespace instead of changing the screen');
put('ui/server_form.json', '// changes the form screen\n{ "namespace": "server_form", "long_form": { "modifications": [ { "array_name": "controls", "operation": "insert_front", "value": [ { "x@common.empty_panel": {} } ] } ] } }');
ok(!lu().some((w) => /server_form/.test(w)), 'ui: server_form.json (with // comments) in the vanilla namespace, a modification inserting a vanilla element: clean', JSON.stringify(lu()));
put('ui/server_form.json', { namespace: 'server_form', long_form: { modifications: [{ array_name: 'controls', operation: 'insert_somewhere', value: [] }] } });
ok(lu().some((w) => /operation "insert_somewhere"/.test(w)), 'ui: an unknown modification operation is found');

fs.rmSync(t, { recursive: true, force: true });
console.log(`${fails ? 'FAIL' : 'PASS'} rp-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
