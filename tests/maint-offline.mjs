// common/maint.mjs: each check finds its problem, --fix repairs what is safe, a healthy lab prints one line
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(path.join(TOP, 'common', 'maint.mjs')).href);
let good = 0, bad = 0;
const check = (c, name, info = '') => { if (c) { good++; console.log(`✔ ${name}`); } else { bad++; console.log(`✘ ${name}\n${info}`); } };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'maint-t-')), top = path.join(T, 'lab'), tmp = path.join(T, 'tmp');
const mk = (p, text = 'x', ageH = 0) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); if (ageH) { const t = new Date(Date.now() - ageH * 3600_000); fs.utimesSync(p, t, t); fs.utimesSync(path.dirname(p), t, t); } };
const oldDir = (p, ageH) => { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'f'), 'x'); const t = new Date(Date.now() - ageH * 3600_000); fs.utimesSync(p, t, t); };
// a sick lab
oldDir(path.join(tmp, 'bdslab-env-old'), 3); oldDir(path.join(tmp, 'app-offline-now'), 0); oldDir(path.join(tmp, 'unrelated-old'), 9);
for (let i = 0; i < 23; i++) oldDir(path.join(top, 'app', 'runs', `2026${String(i).padStart(4, '0')}-x`), 1);
mk(path.join(top, 'app', '.lab', 'run.lock'), JSON.stringify({ pid: 999999 }));
mk(path.join(top, 'bds', '.lab', 'live.json'), JSON.stringify({ pid: process.pid }));   // alive: kept
oldDir(path.join(top, 'app', '.lab', 'browser', 'login-abc'), 1);
mk(path.join(top, '.env.local'), 'GOOGLE_EMAIL="a@b.co"\nGOOGLE_AAS_TOKEN="oauth2_4/' + 'pasted-the-wrong-one-xxxxxxxx"\n'); fs.chmodSync(path.join(top, '.env.local'), 0o644);
mk(path.join(top, '.gitignore'), 'node_modules\n');
mk(path.join(top, 'notes.md'), 'my token aas_' + 'et/' + 'A'.repeat(30));
mk(path.join(top, 'lab.sh'), '#!/bin/sh\n'); fs.chmodSync(path.join(top, 'lab.sh'), 0o644);
// leftovers of an update an older lab did: what the installed release says is gone, still as shipped (an edited one and what
// extras.json lists stay)
const sha12 = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 12);
mk(path.join(top, 'common', 'data', 'shipped.json'), JSON.stringify({ version: '1.22.0', files: { 'lab.mjs': 'x' }, gone: { 'app/lib/bb/zip.js': { since: '1.22.0', sha: [sha12('old zip')] }, 'app/lib/bb/axml.js': { since: '1.22.0', sha: [sha12('old axml')] }, 'sandbox-be/src/play/discover.js': { since: '1.21.0', sha: [sha12('put back')] } } }));
mk(path.join(top, 'app', 'lib', 'bb', 'zip.js'), 'old zip'); mk(path.join(top, 'app', 'lib', 'bb', 'axml.js'), 'old axml, edited');
mk(path.join(top, 'sandbox-be', 'src', 'play', 'discover.js'), 'put back'); mk(path.join(top, 'extras.json'), JSON.stringify({ files: ['sandbox-be/src/play/discover.js'] }));

let r = await M.maint({ top, tmp, env: {} });
const ids = r.lines.map((l) => l.split(':')[0]);
check(['W temp', 'W runs', 'W leftovers', 'W locks', 'W logins', 'W secrets', 'W leaks', 'W exec', 'W token'].every((x) => ids.includes(x)), 'every problem found (without --fix nothing changes)', r.lines.join('\n'));
check(r.lines.some((l) => /^W leftovers: 古いリリースにだけあったファイル 1 個.*app\/lib\/bb\/zip\.js/.test(l)), 'leftovers: the unedited one only (not the edited one, not what extras.json lists)', r.lines.join('\n'));
check(fs.existsSync(path.join(tmp, 'bdslab-env-old')) && fs.existsSync(path.join(top, 'app', '.lab', 'run.lock')), 'without --fix nothing is touched');
r = await M.maint({ top, tmp, env: {}, fix: true });
check(!fs.existsSync(path.join(tmp, 'bdslab-env-old')) && fs.existsSync(path.join(tmp, 'app-offline-now')) && fs.existsSync(path.join(tmp, 'unrelated-old')), 'temp: only old test folders go (a running test and others stay)');
check(fs.readdirSync(path.join(top, 'app', 'runs')).length === 20, 'runs: the newest 20 kept');
check(!fs.existsSync(path.join(top, 'app', '.lab', 'run.lock')) && fs.existsSync(path.join(top, 'bds', '.lab', 'live.json')), 'locks: a dead one removed, a live one kept');
check(!fs.existsSync(path.join(top, 'app', '.lab', 'browser', 'login-abc')), 'logins: a signed-in profile never left');
check((fs.statSync(path.join(top, '.env.local')).mode & 0o777) === 0o600 && /^\.env\.local$/m.test(fs.readFileSync(path.join(top, '.gitignore'), 'utf8')), 'secrets: .env.local 0600 and ignored');
check((fs.statSync(path.join(top, 'lab.sh')).mode & 0o100) !== 0, 'exec: scripts runnable again');
check(!fs.existsSync(path.join(top, 'app', 'lib', 'bb', 'zip.js')) && fs.existsSync(path.join(top, 'app', 'lib', 'bb', 'axml.js')) && fs.existsSync(path.join(top, 'sandbox-be', 'src', 'play', 'discover.js')), 'leftovers --fix: the unedited copy goes; the edited one and the one put back stay');
check(r.lines.some((l) => /^W leaks: .*notes\.md/.test(l)) && r.lines.some((l) => /^W token: .*oauth_token/.test(l)) && r.problems === 2, 'leaks and a wrong token: reported with the fix command, not auto-edited', r.lines.join('\n'));
fs.rmSync(path.join(top, 'notes.md')); fs.writeFileSync(path.join(top, '.env.local'), 'GOOGLE_EMAIL="a@b.co"\nGOOGLE_AAS_TOKEN="aas_et/' + 'k'.repeat(40) + '"\n'); fs.chmodSync(path.join(top, '.env.local'), 0o600);
r = await M.maint({ top, tmp, env: {}, fix: true });
check(r.problems === 0 && r.lines.length === 0, 'a healthy lab: no findings', r.lines.join('\n'));
r = await M.maint({ top, tmp, env: {}, online: true, only: ['updates'], probe: { bds: '9.0.0.0', playwright: '99.0.0', apkeep: '9.9.9' } });
check(/^W updates: 新しい版: .*playwright-core 99\.0\.0.*apkeep 9\.9\.9/.test(r.lines[0] ?? ''), 'updates (--online): newer pinned tools reported', r.lines.join('\n'));
const c = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'maint', '--bogus'], { encoding: 'utf8' });
check(c.status === 1 && /知らない指定 --bogus/.test(c.stdout), 'cli: a typo is an error', c.stdout);
fs.rmSync(T, { recursive: true, force: true });
console.log(`${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
