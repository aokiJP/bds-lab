#!/usr/bin/env node
// `node lab.mjs status` / `clean` on a fake bds-lab folder: units with their last report or failure, the next step, and what
// clean frees (a finished bench workspace, a server for an older BDS) while it keeps what is current. No server, no network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const X = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-status-'));
const w = (r, s) => { const f = path.join(X, r); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
w('.lab-kind', 'bds\n'); w('bds/.lab/addon', 'good\n'); w('bds/.lab/bds/VERSION', '1.26.52.3');
w('bds/addons/good/tests.txt', '## a\n## b\n'); w('bds/addons/good/bp/manifest.json', '{}');
w('bds/.lab/reports/good.json', JSON.stringify({ ok: true, pass: 2, total: 2, at: new Date().toISOString(), bds: '1.26.52.3' }));
w('bds/addons/bad/tests.txt', '## c\n'); w('bds/.lab/last-fail/bad.json', JSON.stringify({ t: Date.now(), secs: ['c'] }));
w('training/addons/bot/tests.txt', '## x\n');
w('bds/runs/run1/big.bin', 'x'.repeat(1000)); fs.utimesSync(path.join(X, 'bds/runs/run1'), new Date(0), new Date(0)); w('bds/runs/run1.json', '{}');
w('bds/.lab/run/base/VERSION', '1.26.40.1 links2'); w('bds/.lab/run/busy/VERSION', '1.26.40.1 links2'); w('bds/.lab/run/busy.lock', String(process.pid)); w('bds/.lab/run/base2/VERSION', '1.26.52.3 links2');
const run = (a) => { const r = spawnSync(process.execPath, [path.join(REPO, 'lab.mjs'), ...a], { cwd: REPO, encoding: 'utf8', env: { ...process.env, LAB_STATUS_ROOT: X, LAB_DOTENV: 'off', LAB_AUTO_ROOT: X } }); return (r.stdout ?? '') + (r.stderr ?? ''); };
let o = run(['status']);
ok(/current unit good/.test(o) && /servers: bds BDS 1\.26\.52\.3/.test(o), 'the lab, the unit, the server', o);
ok(/✔ bds\/good +2 test section\(s\) +PASS 2\/2/.test(o) && /✘ bds\/bad .*FAIL .*"c"/.test(o), 'each unit with its last result (the report, or the failure since)', o);
ok(/training\/: 1 training addon/.test(o) && /^next: node lab\.mjs bds go -a bad/m.test(o), 'training kept apart; the next step is the failing unit', o);
o = run(['clean']);
ok(!fs.existsSync(path.join(X, 'bds/runs/run1')) && fs.existsSync(path.join(X, 'bds/runs/run1.json')) && !fs.existsSync(path.join(X, 'bds/.lab/run/base')) && fs.existsSync(path.join(X, 'bds/.lab/run/base2')) && fs.existsSync(path.join(X, 'bds/.lab/run/busy')), 'clean: the finished bench folder and the old-BDS server go; the result, the current server and one in use stay', o);
fs.rmSync(X, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} status-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
