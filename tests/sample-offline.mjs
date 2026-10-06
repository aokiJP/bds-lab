#!/usr/bin/env node
// `node lab.mjs sample`: BDS 1.26 ships most vanilla data (recipes, items, entities, spawn rules, biomes...) inside .brarchive
// files; they were skipped as binary, so `sample recipe` answered "none". With the lab's BDS here (setup done): they are found and
// read. Without it: nothing to test.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bds = path.join(TOP, 'bds', '.lab', 'bds', 'behavior_packs', 'vanilla', '__brarchive', 'recipes.brarchive');
if (!fs.existsSync(bds)) { console.log('PASS sample-offline (no set-up BDS here: nothing to test)'); process.exit(0); }
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c ? '' : '\n  ' + String(d).slice(0, 600)}`); if (!c) fails++; };
const run = (...a) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', 'sample', ...a], { cwd: TOP, encoding: 'utf8', timeout: 120000 }); return (r.stdout ?? '') + (r.stderr ?? ''); };
const list = run('recipe');
ok(/recipes\/acacia_boat\.json/.test(list), 'sample recipe lists the recipes from recipes.brarchive', list);
const one = run('recipes/glass_bottle.json');
ok(/"minecraft:recipe_shaped"/.test(one) && /"minecraft:glass_bottle"/.test(one), 'sample recipes/glass_bottle.json prints that recipe', one);
console.log(`${fails ? 'FAIL' : 'PASS'} sample-offline ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
