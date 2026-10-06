// node lab.mjs update <zip>: in place, keeps .env.local / caches / your units, never deletes the folder, refuses bad zips
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { crc32 } = await import(pathToFileURL(path.join(TOP, 'bedrock-binary', 'src', 'apk', 'zip.js')).href);
let good = 0, bad = 0;
const check = (c, name, info = '') => { if (c) { good++; console.log(`✔ ${name}`); } else { bad++; console.log(`✘ ${name}\n${info}`); } };
function zip(entries) {
  const L = [], C = []; let off = 0;
  for (const [name, text] of entries) {
    const nb = Buffer.from(name), data = Buffer.from(text), body = zlib.deflateRawSync(data), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    L.push(lh, nb, body); C.push(ch, nb); off += 30 + nb.length + body.length;
  }
  const cd = Buffer.concat(C), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...L, cd, e]);
}
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'update-offline-'));
const lab = path.join(T, 'bds-lab');
// the installed lab: the real update code, an old engine file, the user's token, cache, and their edited sample
fs.mkdirSync(path.join(lab, 'common'), { recursive: true }); fs.mkdirSync(path.join(lab, 'bedrock-binary', 'src', 'apk'), { recursive: true });
fs.copyFileSync(path.join(TOP, 'common', 'update.mjs'), path.join(lab, 'common', 'update.mjs'));
fs.copyFileSync(path.join(TOP, 'bedrock-binary', 'src', 'apk', 'zip.js'), path.join(lab, 'bedrock-binary', 'src', 'apk', 'zip.js'));
fs.copyFileSync(path.join(TOP, 'lab.mjs'), path.join(lab, 'lab.mjs'));
fs.writeFileSync(path.join(lab, 'README.md'), 'old');
fs.writeFileSync(path.join(lab, '.env.local'), 'GOOGLE_AAS_TOKEN="mine"');
fs.mkdirSync(path.join(lab, 'bds', '.lab'), { recursive: true }); fs.writeFileSync(path.join(lab, 'bds', '.lab', 'cache'), 'mine');
fs.mkdirSync(path.join(lab, 'bds', 'addons', 'jsonui_demo'), { recursive: true }); fs.writeFileSync(path.join(lab, 'bds', 'addons', 'jsonui_demo', 'app.txt'), 'my edit');
const labMjs = fs.readFileSync(path.join(TOP, 'lab.mjs'), 'utf8');
const good1 = path.join(T, 'new.zip');
fs.writeFileSync(good1, zip([['bds-lab/lab.mjs', labMjs], ['bds-lab/README.md', 'new'], ['bds-lab/lab.sh', '#!/bin/sh\n'], ['bds-lab/.env.local', 'GOOGLE_AAS_TOKEN="theirs"'], ['bds-lab/bds/.lab/cache', 'theirs'],
  ['bds-lab/bds/addons/jsonui_demo/app.txt', 'sample'], ['bds-lab/bds/addons/new_one/tests.txt', 'added'], ['bds-lab/common/latest.mjs', '// new file']]));
const ino = fs.statSync(lab).ino;
const r = spawnSync(process.execPath, [path.join(lab, 'lab.mjs'), 'update', good1], { cwd: lab, encoding: 'utf8' });
const rd = (p) => fs.readFileSync(path.join(lab, p), 'utf8');
check(r.status === 0 && /更新しました/.test(r.stdout), 'update runs', r.stdout + r.stderr);
check(rd('README.md') === 'new' && rd('common/latest.mjs') === '// new file' && rd('bds/addons/new_one/tests.txt') === 'added', 'engine files replaced, new files and new samples added');
check(rd('.env.local').includes('mine') && rd('bds/.lab/cache') === 'mine' && rd('bds/addons/jsonui_demo/app.txt') === 'my edit', 'the token, caches and your own units are kept');
check(fs.statSync(lab).ino === ino && (process.platform === 'win32' || (fs.statSync(path.join(lab, 'lab.sh')).mode & 0o111) !== 0), 'the folder itself stays (a terminal inside it keeps working); scripts stay runnable');
check(!fs.readdirSync(lab).some((n) => n.includes('.update-')), 'no half-written files left');
const evil = path.join(T, 'evil.zip');
fs.writeFileSync(evil, zip([['bds-lab/lab.mjs', labMjs], ['bds-lab/../outside.txt', 'x']]));
const r2 = spawnSync(process.execPath, [path.join(lab, 'lab.mjs'), 'update', evil], { cwd: lab, encoding: 'utf8' });
check(r2.status === 1 && /おかしなパス/.test(r2.stdout) && !fs.existsSync(path.join(T, 'outside.txt')), 'a zip that writes outside the folder is refused before anything is written', r2.stdout);
// a utility addon (samples.json `utility`: TS REPL) is the lab's own tool: the zip's copy replaces it (ts needs the bridge that
// matches the lab), while a sample of the same name stays the person's
fs.mkdirSync(path.join(lab, 'bds', 'addons', 'ts_repl'), { recursive: true }); fs.writeFileSync(path.join(lab, 'bds', 'addons', 'ts_repl', 'bridge.txt'), 'old bridge');
const good2 = path.join(T, 'new2.zip');
fs.writeFileSync(good2, zip([['bds-lab/lab.mjs', labMjs], ['bds-lab/common/data/samples.json', JSON.stringify({ bds: ['jsonui_demo'], utility: { bds: ['ts_repl'] } })], ['bds-lab/bds/addons/ts_repl/bridge.txt', 'new bridge'], ['bds-lab/bds/addons/jsonui_demo/app.txt', 'sample 2']]));
const r4 = spawnSync(process.execPath, [path.join(lab, 'lab.mjs'), 'update', good2], { cwd: lab, encoding: 'utf8' });
check(r4.status === 0 && rd('bds/addons/ts_repl/bridge.txt') === 'new bridge' && rd('bds/addons/jsonui_demo/app.txt') === 'my edit', 'a utility addon (TS REPL) is replaced by the new one; a sample stays the person\'s', r4.stdout + r4.stderr);
// files an earlier release shipped and this one does not (common/data/shipped.json): an unedited copy goes, an edited one stays,
// a unit or the autopilot's memory never; the gone list of an older release applies to a lab older than it only
{
  const sha12 = (t) => crypto.createHash('sha256').update(Buffer.from(t)).digest('hex').slice(0, 12), w = (r, t) => { fs.mkdirSync(path.dirname(path.join(lab, r)), { recursive: true }); fs.writeFileSync(path.join(lab, r), t); };
  w('VERSION', '1.21.0\n');
  w('app/lib/bb/zip.js', 'old zip'); w('app/lib/bb/axml.js', 'old axml, edited here'); w('sandbox-be/src/play/agent/learner.js', 'agent');
  w('sandbox-be/src/play/discover.js', 'restored from extras'); w('bds/addons/jsonui_demo/old.json', 'a unit file'); w('auto/LESSONS.md', 'mine');
  w('common/data/shipped.json', JSON.stringify({ version: '1.21.0', files: { 'app/lib/bb/zip.js': sha12('old zip'), 'app/lib/bb/axml.js': sha12('old axml'), 'sandbox-be/src/play/agent/learner.js': sha12('agent'), 'bds/addons/jsonui_demo/old.json': sha12('a unit file'), 'auto/LESSONS.md': sha12('mine'), 'lab.mjs': 'x' }, gone: {} }));
  const ship = { version: '1.22.0', files: { 'lab.mjs': 'y' }, gone: { 'sandbox-be/src/play/discover.js': { since: '1.21.0', sha: [sha12('restored from extras')] } } };
  const z3 = path.join(T, 'new3.zip');
  fs.writeFileSync(z3, zip([['bds-lab/lab.mjs', labMjs], ['bds-lab/VERSION', '1.22.0\n'], ['bds-lab/common/data/shipped.json', JSON.stringify(ship)]]));
  const r5 = spawnSync(process.execPath, [path.join(lab, 'lab.mjs'), 'update', z3], { cwd: lab, encoding: 'utf8' });
  const has = (r) => fs.existsSync(path.join(lab, r));
  check(r5.status === 0 && !has('app/lib/bb/zip.js') && has('app/lib/bb/axml.js') && !has('sandbox-be/src/play/agent') && /2 個を削除、手を入れてあった 1 個は残しました/.test(r5.stdout),
    'update: what the old release shipped and the new one does not is deleted when unedited (its empty folder too); an edited copy stays', r5.stdout + r5.stderr);
  check(has('bds/addons/jsonui_demo/old.json') && has('auto/LESSONS.md') && has('sandbox-be/src/play/discover.js'), 'update: never a unit file or the autopilot\'s memory; a file gone since 1.21.0 is not taken from a 1.21.0 lab (restored by hand)');
  // leftovers (an update done by an older lab deletes nothing): maint names them; extras.json (the extras zip's list) protects
  // what was put back on purpose; the same release again tidies them
  const U = await import(pathToFileURL(path.join(TOP, 'common', 'update.mjs')).href);
  const left1 = U.leftovers(lab).join(' ');
  w('extras.json', JSON.stringify({ files: ['sandbox-be/src/play/discover.js'] }));
  const left2 = U.leftovers(lab).join(' ');
  check(left1 === 'sandbox-be/src/play/discover.js' && left2 === '', 'leftovers: a file the installed release says is gone, still as shipped; not one extras.json lists', `${left1} | ${left2}`);
  w('extras.json', JSON.stringify({ files: ['sandbox-be/src/play/pvp/duel.js'] })); w('sandbox-be/src/play/pvp/duel.js', 'duel');
  const z4 = path.join(T, 'new4.zip'), ship4 = { version: '1.22.0', files: { 'lab.mjs': 'y' }, gone: { ...ship.gone, 'sandbox-be/src/play/pvp/duel.js': { since: '1.21.0', sha: [sha12('duel')] } } };
  fs.writeFileSync(z4, zip([['bds-lab/lab.mjs', labMjs], ['bds-lab/VERSION', '1.22.0\n'], ['bds-lab/common/data/shipped.json', JSON.stringify(ship4)]]));
  const r6 = spawnSync(process.execPath, [path.join(lab, 'lab.mjs'), 'update', z4], { cwd: lab, encoding: 'utf8' });
  check(r6.status === 0 && !has('sandbox-be/src/play/discover.js') && has('sandbox-be/src/play/pvp/duel.js') && has('extras.json') && /1 個を削除/.test(r6.stdout), 'update with the same release again: the leftovers go; what extras.json lists stays (and extras.json itself)', r6.stdout + r6.stderr);
}
const notlab = path.join(T, 'x.zip'); fs.writeFileSync(notlab, zip([['a/b.txt', 'x']]));
const r3 = spawnSync(process.execPath, [path.join(lab, 'lab.mjs'), 'update', notlab], { cwd: lab, encoding: 'utf8' });
check(r3.status === 1 && /bds-lab の zip ではありません/.test(r3.stdout), 'not a bds-lab zip → refused', r3.stdout);
fs.rmSync(T, { recursive: true, force: true });
console.log(`${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
