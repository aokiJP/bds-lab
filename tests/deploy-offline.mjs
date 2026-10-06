#!/usr/bin/env node
// `node lab.mjs deploy <BDS folder>` on a fake BDS folder: the utility addons and the units asked for become world packs, the
// modules they need are allowed, Beta APIs are switched on in level.dat with the world's other experiments kept, everything is
// backed up, a second deploy updates in place, and --undo puts it all back. No server, no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const D = await import(pathToFileURL(path.join(REPO, 'common', 'deploy.mjs')).href);
const S = JSON.parse(fs.readFileSync(path.join(REPO, 'common', 'data', 'samples.json'), 'utf8'));
const util = S.utility?.bds ?? [];
if (!util.length || !util.every((u) => fs.existsSync(path.join(REPO, 'bds', 'addons', u, 'bp', 'manifest.json')))) { console.log('PASS deploy-offline (no utility addon here: nothing to deploy)'); process.exit(0); }
// a level.dat: root { LevelName: "W", experiments { data_driven_items: 1 } }
const tag = (t, name, payload) => { const nb = Buffer.from(name), h = Buffer.alloc(3); h[0] = t; h.writeUInt16LE(nb.length, 1); return Buffer.concat([h, nb, payload]); };
const str = (s) => { const b = Buffer.from(s), h = Buffer.alloc(2); h.writeUInt16LE(b.length); return Buffer.concat([h, b]); };
const root = Buffer.concat([tag(8, 'LevelName', str('W')), tag(10, 'experiments', Buffer.concat([tag(1, 'data_driven_items', Buffer.from([1])), Buffer.from([0])])), Buffer.from([0])]);
const body = Buffer.concat([Buffer.from([10, 0, 0]), root]), head = Buffer.alloc(8); head.writeInt32LE(10, 0); head.writeInt32LE(body.length, 4);
const B = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-deploy-')), W = path.join(B, 'worlds', 'W');
fs.mkdirSync(W, { recursive: true }); fs.mkdirSync(path.join(B, 'config', 'default'), { recursive: true });
fs.writeFileSync(path.join(B, 'server.properties'), 'server-name=x\nlevel-name=W\n');
const level0 = Buffer.concat([head, body]); fs.writeFileSync(path.join(W, 'level.dat'), level0);
const perm0 = JSON.stringify({ allowed_modules: ['@minecraft/server', '@minecraft/server-ui'] }); fs.writeFileSync(path.join(B, 'config', 'default', 'permissions.json'), perm0);
fs.writeFileSync(path.join(W, 'world_behavior_packs.json'), JSON.stringify([{ pack_id: 'mine-1', version: [1, 0, 0] }]));
const run = (a) => { const r = spawnSync(process.execPath, [path.join(REPO, 'lab.mjs'), 'deploy', B, ...a], { cwd: REPO, encoding: 'utf8', env: { ...process.env, LAB_DOTENV: 'off' } }); return { status: r.status, t: (r.stdout ?? '') + (r.stderr ?? '') }; };
let r = run(['--dry']);
ok(r.status === 0 && /DRY/.test(r.t) && !fs.existsSync(path.join(W, 'behavior_packs')), '--dry: says what, writes nothing', r.t);
r = run(['jsonui_demo']);
const bps = JSON.parse(fs.readFileSync(path.join(W, 'world_behavior_packs.json'), 'utf8'));
ok(r.status === 0 && util.every((u) => fs.existsSync(path.join(W, 'behavior_packs', `${u}_BP`, 'manifest.json'))) && fs.existsSync(path.join(W, 'behavior_packs', 'jsonui_demo_BP', 'manifest.json')), 'the utility addons and the unit asked for become world packs', r.t);
ok(bps[0].pack_id === 'mine-1' && bps.length === 1 + util.length + 1, 'world_behavior_packs.json: the packs that were there stay, ours are added', JSON.stringify(bps));
const perm = JSON.parse(fs.readFileSync(path.join(B, 'config', 'default', 'permissions.json'), 'utf8')).allowed_modules;
ok(perm.includes('@minecraft/common') && perm.includes('@minecraft/server'), 'permissions.json: the modules the packs need are allowed', perm.join(' '));
const lv = fs.readFileSync(path.join(W, 'level.dat'));
ok(D.hasBetaApis(lv) && lv.includes(Buffer.from('data_driven_items')) && lv.includes(Buffer.from('LevelName')), 'level.dat: Beta APIs on, the other experiment and tags kept');
ok(lv.readInt32LE(4) === lv.length - 8, 'level.dat: the header length matches');
r = run(['jsonui_demo']);
ok(r.status === 0 && JSON.parse(fs.readFileSync(path.join(W, 'world_behavior_packs.json'), 'utf8')).length === bps.length, 'deploy again: updated in place, no duplicate', r.t);
r = run(['--undo']);
ok(r.status === 0 && fs.existsSync(path.join(W, 'behavior_packs', 'jsonui_demo_BP')), 'undo once: back to the first deploy (its packs)', r.t);
r = run(['--undo']);
ok(r.status === 0 && !fs.existsSync(path.join(W, 'behavior_packs', 'jsonui_demo_BP')) && fs.readFileSync(path.join(W, 'level.dat')).equals(level0) && fs.readFileSync(path.join(B, 'config', 'default', 'permissions.json'), 'utf8') === perm0 && JSON.parse(fs.readFileSync(path.join(W, 'world_behavior_packs.json'), 'utf8')).length === 1, 'undo again: the server folder exactly as it was', r.t);
r = run(['no_such_unit']);
ok(r.status !== 0 && /no such unit: no_such_unit/.test(r.t), 'an unknown unit is refused before anything is written', r.t);
// the same pack installed by hand under another folder name (same uuid): replaced, not left beside ours (two packs, one uuid),
// and --undo brings the person's copy back
{
  const u0 = util[0], m = JSON.parse(fs.readFileSync(path.join(REPO, 'bds', 'addons', u0, 'bp', 'manifest.json'), 'utf8'));
  const hand = path.join(W, 'behavior_packs', 'My Copy BP'); fs.mkdirSync(hand, { recursive: true }); fs.writeFileSync(path.join(hand, 'manifest.json'), JSON.stringify({ ...m, header: { ...m.header, name: 'by hand' } }));
  r = run([]);
  const same = fs.readdirSync(path.join(W, 'behavior_packs')).filter((d) => { try { return JSON.parse(fs.readFileSync(path.join(W, 'behavior_packs', d, 'manifest.json'), 'utf8')).header.uuid === m.header.uuid; } catch { return false; } });
  ok(r.status === 0 && same.length === 1 && !fs.existsSync(hand) && /the same pack \(uuid\) at worlds\/W\/behavior_packs\/My Copy BP replaced/.test(r.t), 'a copy of the same pack under another folder name is replaced (one uuid, one pack)', r.t + '\n' + same.join(' '));
  r = run(['--undo']);
  ok(r.status === 0 && fs.existsSync(path.join(hand, 'manifest.json')) && JSON.parse(fs.readFileSync(path.join(hand, 'manifest.json'), 'utf8')).header.name === 'by hand', '--undo puts the person\'s own copy back', r.t);
}
fs.rmSync(B, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} deploy-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
