// common/latest.mjs without a network or a server: version logic, and `run` against fake labs (LAB_LATEST_LABS).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(path.join(TOP, 'common', 'latest.mjs')).href);
let good = 0, bad = 0;
const check = (c, name, info = '') => { if (c) { good++; console.log(`✔ ${name}`); } else { bad++; console.log(`✘ ${name}\n${String(info).slice(-1500)}`); } };

check(L.cmp('1.26.52.3', '1.26.52.10') < 0 && L.cmp('1.26.60', '1.26.52.3') > 0 && L.cmp('1.26.52', '1.26.52.0') === 0, 'versions compare as numbers');
check(L.supports('1.26.52.1', '1.26.52.3') && !L.supports('1.26.51.9', '1.26.52.3') && L.supports('1.26.60.1', '1.26.52.3') && !L.supports(null, '1.26.52.3'), 'a lab supports the newest when its BDS is of the same family or newer');
check(L.llFamily('26.51.5') === '1.26.51' && L.llFamily('v26.60.0') === '1.26.60' && L.llFamily('x') === null, 'LeviLamina a.b.c is for Minecraft 1.a.b');

// fake labs: <k>/lab.mjs answers `bds <v>` / `server --update` / `test -a <u>` / `pack -a <u>` from FAKE_* variables
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'latest-offline-'));
const fake = `const a = process.argv.slice(2);
if (a[0] === 'bds') { console.log('OK bds ' + a[1] + ' (cache only)'); process.exit(0); }
if (a[0] === 'server') { console.log(process.env.FAKE_SERVER || 'OK Endstone 0.11 | BDS 1.26.52.1'); process.exit(process.env.FAKE_SERVER_FAIL ? 1 : 0); }
const u = a[a.indexOf('-a') + 1];
if (a[0] === 'test') { if ((process.env.FAKE_BAD || '').split(',').includes(u)) { console.log('✘ 4: ## gives > @A cmd /x\\n  want = ok\\n  got nothing\\nFAIL 1/2'); process.exit(1); } console.log('PASS 2/2'); process.exit(0); }
if (a[0] === 'pack') { console.log('OK dist/' + u); process.exit(0); }`;
for (const [k, dir] of [['bds', 'addons'], ['end', 'plugins'], ['ll', 'mods']]) {
  fs.mkdirSync(path.join(T, k, dir, 'one'), { recursive: true }); fs.mkdirSync(path.join(T, k, dir, 'two'), { recursive: true });
  fs.writeFileSync(path.join(T, k, 'lab.mjs'), fake);
}
const run = (k, probe, env = {}) => {
  const f = path.join(T, `probe-${k}-${good + bad}.json`); fs.writeFileSync(f, JSON.stringify(probe));
  const o = path.join(T, 'out.txt'); fs.writeFileSync(o, '');
  const r = spawnSync(process.execPath, [path.join(TOP, 'common', 'latest.mjs'), 'run', k], { encoding: 'utf8', env: { ...process.env, LAB_LATEST_LABS: T, LAB_LATEST_FIXTURE: f, LAB_CI_DRY: '1', GITHUB_OUTPUT: o, GITHUB_STEP_SUMMARY: '', ...env } });
  return { code: r.status, text: r.stdout + r.stderr, result: /result=(\w+)/.exec(fs.readFileSync(o, 'utf8'))?.[1] };
};
let r = run('bds', { bds: '1.26.52.3' });
check(r.code === 0 && r.result === 'ok' && /✔ one/.test(r.text) && /✔ two/.test(r.text) && /DRY gh issue list/.test(r.text), 'bds: every addon on the newest BDS → ok (and an open issue would be closed)', r.text);
r = run('bds', { bds: '1.26.52.3' }, { FAKE_BAD: 'two' });
check(r.code === 1 && r.result === 'fail' && /✘ two .*want = ok/.test(r.text) && /DRY gh issue create/.test(r.text) && /\| two \| ✘/.test(r.text), 'bds: one addon breaks → fail, an issue names it and why', r.text);
r = run('end', { bds: '1.26.60.1', endstone: '0.11.12' }, { FAKE_SERVER: 'OK Endstone 0.11.12 | BDS 1.26.52.3 | Python 3.12' });
check(r.code === 0 && r.result === 'wait' && /Endstone 0\.11\.12 runs BDS 1\.26\.52\.3, the newest is 1\.26\.60\.1/.test(r.text) && !/✔ one/.test(r.text) && !/DRY gh issue/.test(r.text), 'end: Endstone not on the newest BDS yet → wait, nothing tested, no issue', r.text);
r = run('end', { bds: '1.26.60.1', endstone: '0.12.0' }, { FAKE_SERVER: 'OK Endstone 0.12.0 | BDS 1.26.60.1 | Python 3.12' });
check(r.code === 0 && r.result === 'ok' && /✔ two/.test(r.text), 'end: once Endstone supports it → every plugin tested', r.text);
r = run('ll', { bds: '1.26.60.1', ll: '26.51.5' });
check(r.code === 0 && r.result === 'wait' && /LeviLamina 26\.51\.5 is for 1\.26\.51\.x/.test(r.text), 'll: LeviLamina for an older game → wait without installing anything', r.text);
r = run('ll', { bds: '1.26.60.1', ll: '26.60.0' }, { FAKE_SERVER: 'OK LeviLamina 26.60.0 | BDS 1.26.60.1' });
check(r.code === 0 && r.result === 'ok', 'll: a LeviLamina for the newest game → every mod tested', r.text);
r = run('end', { bds: '1.26.60.1', endstone: '0.12.0' }, { FAKE_SERVER: 'pip: no matching distribution', FAKE_SERVER_FAIL: '1' });
check(r.code === 1 && r.result === 'fail' && /did not set up/.test(r.text), 'end: the lab cannot set up → fail with its log', r.text);
r = run('bds', { bds: null });
check(r.code === 0 && r.result === 'retry', 'the newest BDS unknown (Mojang down) → retry, not remembered', r.text);
fs.rmSync(T, { recursive: true, force: true });
console.log(`${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
