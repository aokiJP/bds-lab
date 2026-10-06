#!/usr/bin/env node
// `node lab.mjs c2s` (common/c2s.mjs) with a stand-in cmd2script (cmdscript-be's interface: commands2script(lines) →
// [{command, code, fidelity, notes}], PRELUDE): the code per command, the approximate ones marked, --check comparing the
// commands and the code in the sandbox; without cmd2script one line says where to put it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-c2s-')), F = path.join(T, 'index.js');
fs.writeFileSync(F, `export const PRELUDE = '';
export function commands2script(lines) { return lines.map((l) => { const m = /^setblock (-?\\d+) (-?\\d+) (-?\\d+) (\\S+)$/.exec(l);
  if (m) return { command: l, code: 'dimension.setBlockType({ x: ' + m[1] + ', y: ' + m[2] + ', z: ' + m[3] + ' }, "minecraft:' + m[4].replace(/^minecraft:/, '') + '");', fidelity: 'exact', notes: [] };
  const s = /^say (.*)$/.exec(l); if (s) return { command: l, code: 'world.sendMessage(' + JSON.stringify('[Server] ' + s[1]) + ');', fidelity: 'approximate', notes: ['the sender name'] };
  return { command: l, code: '// not converted', fidelity: 'none', notes: ['unknown'] }; }); }
`);
const run = (a, env = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'c2s', ...a], { cwd: TOP, encoding: 'utf8', env: { ...process.env, LAB_DOTENV: 'off', ...env } }); return { status: r.status, t: (r.stdout ?? '') + (r.stderr ?? '') }; };
let r = run(['say hi'], { SANDBOX_BE_CMDSCRIPT: path.join(T, 'none.js') });
ok(fs.existsSync(path.join(TOP, 'cmdscript-be')) || (r.status !== 0 && /cmdscript-be/.test(r.t)), 'no cmd2script: where to put it, in one line', r.t);
r = run(['setblock 1 -60 1 stone', '/say hi'], { SANDBOX_BE_CMDSCRIPT: F });
ok(r.status === 0 && /dimension\.setBlockType\(\{ x: 1, y: -60, z: 1 \}, "minecraft:stone"\)/.test(r.t) && /\/\/ say hi +\[approximate: the sender name\]/.test(r.t) && /1 approximate/.test(r.t), 'commands → code, the approximate one marked (a leading / is fine)', r.t);
fs.writeFileSync(path.join(T, 'f.mcfunction'), '# a comment\nsetblock 2 -60 2 stone\n');
r = run(['--file', path.join(T, 'f.mcfunction'), '--check'], { SANDBOX_BE_CMDSCRIPT: F });
ok(r.status === 0 && /x: 2/.test(r.t) && /^OK c2s --check: (same|approximate) in the sandbox/m.test(r.t), 'a .mcfunction file, --check: the sandbox compares the two worlds', r.t);
fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} c2s-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
