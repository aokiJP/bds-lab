#!/usr/bin/env node
// maintain + checkpoint/undo without a server or an AI: fake labs (LAB_LABS_ROOT) answer bds / mode / test / make from the
// units' files, so each path is taken for real: OK, autofix (module versions), AI patch, an AI that edits old tests (refused),
// limited mode (features.json), restore (features back on), BROKEN (put back, attempt kept), dry run, undo. node tests/maintain-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'maintain-offline-'));
let good = 0, bad = 0;
const check = (c, name, info = '') => { if (c) { good++; console.log(`✔ ${name}`); } else { bad++; console.log(`✘ ${name}\n${String(info).slice(-2500)}`); } };

const FAKE = String.raw`import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; const __dirname = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2), u = a[a.indexOf('-a') + 1], D = path.join(__dirname, 'addons', u || '-');
const rd = (f, d = '') => { try { return fs.readFileSync(path.join(D, f), 'utf8'); } catch { return d; } };
const st = path.join(__dirname, 'bds-version');
if (a[0] === 'bds' && a[1] === '--update' && process.env.FAKE_NOSPEAK) { fs.writeFileSync(st, '1.26.70.1'); console.log('ERR bedrock-protocol does not speak BDS 1.26.70.1 yet (newest: 1.26.60).'); process.exit(1); }
if (a[0] === 'bds') { if (a[1] === '--update') fs.writeFileSync(st, '1.26.60.1'); else if (/^\d/.test(a[1] || '')) fs.writeFileSync(st, a[1]); console.log('OK bds ' + (fs.existsSync(st) ? fs.readFileSync(st, 'utf8') : '1.26.52.3') + ' (cache only)'); process.exit(0); }
if (a[0] === 'mode') { const f = path.join(D, 'bp', 'manifest.json'), m = JSON.parse(fs.readFileSync(f, 'utf8')); const old = m.dependencies[0].version, v = a[1] === 'stable' ? '2.12.0' : '2.12.0-beta'; m.dependencies[0].version = v; fs.writeFileSync(f, JSON.stringify(m)); console.log(old === v ? 'OK ' + a[1] + ' (already)' : 'OK ' + a[1] + ': server ' + old + '->' + v); process.exit(0); }
if (a[0] === 'test' && u === 'flip') { const c = path.join(__dirname, 'flip-count'); const n = fs.existsSync(c) ? +fs.readFileSync(c, 'utf8') : 0; fs.writeFileSync(c, String(n + 1)); if (n === 0) { console.log('✘ 3: ## core > @A cmd /x\n  want = ok\n  got nothing'); if (process.env.LAB_SECTIONS) console.log('SECTION FAIL core'); console.log('FAIL 0/1'); process.exit(1); } console.log('PASS 1/1'); process.exit(0); }
if (a[0] === 'make') {
  const ctx = fs.readFileSync(a[a.indexOf('--context') + 1], 'utf8');
  fs.appendFileSync(path.join(__dirname, 'make-calls.txt'), u + ' ' + JSON.stringify(ctx.slice(0, 3000)) + '\n');
  if (u === 'aifix') fs.writeFileSync(path.join(D, 'src', 'main.ts'), 'FIXED\n');
  if (u === 'cheater') fs.writeFileSync(path.join(D, 'tests.txt'), '## core\n@A join\n');   // weakens the old test: must be refused
  console.log('MADE addons/' + u + ' via fake: 1,234 tokens'); process.exit(0);
}
if (a[0] === 'test') {
  const off = (() => { try { return Object.keys(JSON.parse(rd('features.json')).off || {}); } catch { return []; } })();
  const secs = [...rd('tests.txt').matchAll(/^## (.*)$/gm)].map((m) => m[1]);
  const bad = new Set();
  const dep = (() => { try { return JSON.parse(rd('bp/manifest.json')).dependencies[0].version; } catch { return ''; } })();
  if (dep && dep !== '2.12.0-beta' && !/stable/.test(u)) { console.log('E world/addon did not load: [Scripting] module @minecraft/server ' + dep + ' not found'); console.log('FAIL'); process.exit(1); }
  if (u === 'aifix' && !rd('src/main.ts').includes('FIXED')) bad.add('core');
  if (u === 'cheater' && !rd('src/main.ts').includes('FIXED')) bad.add('core');
  if (u === 'limitme') bad.add('ml');
  if (u === 'w1' && !rd('src/main.ts').includes('FIXED')) bad.add('core');
  if (u === 'broken') bad.add('core');
  let pass = 0;
  for (const s of secs) { if (off.includes(s)) { console.log('SKIP ## ' + s + ' (feature off: ' + s + ')'); continue; } if (bad.has(s)) console.log('✘ 3: ## ' + s + ' > @A cmd /x\n  want = ok\n  got nothing'); else pass++; }
  if (process.env.LAB_SECTIONS) for (const s of secs) if (!off.includes(s)) { console.log('SECTION ' + (bad.has(s) ? 'FAIL' : 'PASS') + ' ' + s); if (bad.has(s)) console.log('SECTION WHY ' + s + ' :: expect = ok'); }
  const ok = [...bad].every((s) => off.includes(s));
  console.log((ok ? 'PASS ' : 'FAIL ') + pass + '/' + secs.length); process.exit(ok ? 0 : 1);
}
if (a[0] === 'go') { if (u === 'broken') { console.log('✘ 3: ## core\nFAIL'); process.exit(1); } console.log('DONE dist/' + u + '.mcaddon'); process.exit(0); }
if (a[0] === 'pack') { const f = path.join(D, 'ver'); const v = fs.existsSync(f) ? +fs.readFileSync(f, 'utf8') + 1 : 1; fs.writeFileSync(f, String(v)); console.log('OK dist/' + u + '.mcaddon (3 files, v1.0.' + v + ')'); process.exit(0); }
if (a[0] === 'ship') { console.log('ship: addon/' + u + ' + Release'); process.exit(0); }
console.log('fake: ' + a.join(' ')); process.exit(0);`;
fs.mkdirSync(path.join(T, 'bds', 'addons'), { recursive: true });
fs.writeFileSync(path.join(T, 'bds', 'lab.mjs'), FAKE);
const unit = (u, { dep = '2.11.0-beta', tests = '## core\n@A join\n= ok\n', features, src = 'broken\n' } = {}) => {
  const d = path.join(T, 'bds', 'addons', u);
  fs.mkdirSync(path.join(d, 'bp'), { recursive: true }); fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'bp', 'manifest.json'), JSON.stringify({ dependencies: [{ module_name: '@minecraft/server', version: dep }] }));
  fs.writeFileSync(path.join(d, 'tests.txt'), tests); fs.writeFileSync(path.join(d, 'src', 'main.ts'), src); fs.writeFileSync(path.join(d, 'TASK.md'), `# ${u}\n\n## Request\nx\n`);
  if (features) fs.writeFileSync(path.join(d, 'features.json'), JSON.stringify(features));
};
unit('fine', { dep: '2.12.0-beta' });
unit('modfix');
unit('aifix', { dep: '2.12.0-beta' });
unit('cheater', { dep: '2.12.0-beta' });
unit('limitme', { dep: '2.12.0-beta', tests: '## core\n@A join\n## ml\n@A cmd /ml\n', features: { features: { ml: { ja: '学習', tests: ['ml'] } } } });
unit('restoreme', { dep: '2.12.0-beta', features: { features: { x: { tests: ['core'] } }, off: { x: 'BDS 1.26.52: old' } } });
unit('broken', { dep: '2.12.0-beta' });
const env = { ...process.env, LAB_LABS_ROOT: T, LAB_DOTENV: 'off', ANTHROPIC_API_KEY: 'fake', LAB_NOTIFY_WEBHOOK: '', LAB_KIND: 'bds' };
const run = (args, e = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', env: { ...env, ...e }, timeout: 120000 }); return { code: r.status, text: (r.stdout ?? '') + (r.stderr ?? '') }; };
const U = (u, f) => fs.readFileSync(path.join(T, 'bds', 'addons', u, f), 'utf8');

let r = run(['maintain', '--no-limit', '-a', 'fine,modfix,aifix,cheater,broken']);
const line = (u) => r.text.split('\n').find((l) => l.includes(`bds/${u}:`)) ?? '';
check(/moving to the newest release/.test(r.text) && /BDS 1\.26\.60\.1 \(was 1\.26\.52\.3\)/.test(r.text), 'the lab moves to the newest release first', r.text);
check(/✔ bds\/fine: OK/.test(r.text) && !fs.existsSync(path.join(T, 'bds', '.lab', 'checkpoints', 'fine')), 'a unit that passes: OK, untouched (no checkpoint)', r.text);
check(/FIXED — autofix: server 2\.11\.0-beta->2\.12\.0-beta/.test(line('modfix')) && JSON.parse(U('modfix', 'bp/manifest.json')).dependencies[0].version === '2.12.0-beta' && /## Maintenance\n- \d{4}-\d\d-\d\d BDS 1\.26\.60\.1: FIXED/.test(U('modfix', 'TASK.md')), 'module versions: fixed without the AI, noted in TASK.md ## Maintenance', r.text);
const calls = (() => { try { return fs.readFileSync(path.join(T, 'bds', 'make-calls.txt'), 'utf8'); } catch { return ''; } })();

check(!/^modfix /m.test(calls), 'autofix worked: the AI was never asked (0 tokens)', calls);
check(/FIXED — AI 1,234 tokens/.test(line('aifix')) && U('aifix', 'src/main.ts') === 'FIXED\n' && /^aifix .*What failed/m.test(calls), 'the AI patch: it gets what failed, the unit passes, FIXED with its tokens', r.text + calls);
check(/changed old tests \("core"\): not taken/.test(r.text) && /BROKEN/.test(line('cheater')) && U('cheater', 'tests.txt') === '## core\n@A join\n= ok\n', 'an AI that weakens an old test is refused and the unit put back', r.text);
check(/BROKEN — AI patch did not pass \| attempt kept: node lab\.mjs undo /.test(line('broken')) && U('broken', 'src/main.ts') === 'broken\n' && !/## Maintenance/.test(U('broken', 'TASK.md')), 'BROKEN: put back as it was, the attempt kept as a checkpoint', r.text);
check(r.code === 1 && /^FAIL maintain: .*BROKEN 2/m.test(r.text) && fs.existsSync(path.join(T, 'bds', '.lab', 'maintain', 'report.md')), 'exit 1 while something is BROKEN; report.md written', r.text);
check(fs.existsSync(path.join(T, 'bds', '.lab', 'maintain', 'BDS 1.26.60.1', 'aifix.diff')) ? /^-broken\n\+FIXED/m.test(fs.readFileSync(path.join(T, 'bds', '.lab', 'maintain', 'BDS 1.26.60.1', 'aifix.diff'), 'utf8')) : spawnSync('git', ['--version']).status !== 0, 'a .diff of what maintain changed', r.text);

r = run(['maintain', '--to', 'current', '-a', 'limitme,restoreme', '--no-ai']);
check(/LIMITED — off: ml/.test(r.text) && JSON.parse(U('limitme', 'features.json')).off.ml && /LIMITED \(off: ml\)/.test(U('limitme', 'TASK.md')), 'limited mode: the failing feature is switched off (features.json), the rest keeps working', r.text);
check(/♻ bds\/restoreme: RESTORED — back on: x/.test(r.text) && !Object.keys(JSON.parse(U('restoreme', 'features.json')).off).length, 'restore: a switched-off feature that passes again comes back on', r.text);
check(r.code === 0 && !/moving to/.test(r.text), '--to current: no update; exit 0 when nothing is BROKEN', r.text);

// dry run: reports, then puts everything back (units and the BDS version)
unit('drymod');
r = run(['maintain', '--dry', '-a', 'drymod', '--no-ai']);
check(/FIXED/.test(r.text) && JSON.parse(U('drymod', 'bp/manifest.json')).dependencies[0].version === '2.11.0-beta' && /back to BDS 1\.26\.60\.1/.test(r.text), '--dry: the result is shown, the unit and the server are put back', r.text);
r = run(['maintain', '--to', 'preview', '-a', 'drymod', '--no-ai']);
check(/dry run/.test(r.text) && JSON.parse(U('drymod', 'bp/manifest.json')).dependencies[0].version === '2.11.0-beta', '--to preview is a dry run unless --apply', r.text);

// a failure that passes on a second fresh run is FLAKY (no autofix, no AI); a beta unit that passes on stable is PROMOTED
unit('flip', { dep: '2.12.0-beta' });
unit('stableok', { dep: '2.12.0-beta' });
r = run(['maintain', '--to', 'current', '-a', 'flip,stableok,fine']);
check(/〰 bds\/flip: FLAKY — failed once, passed on the second run: "core"/.test(r.text) && !fs.readFileSync(path.join(T, 'bds', 'make-calls.txt'), 'utf8').includes('flip') && r.code === 0, 'flaky: failed once, passed the second time → FLAKY, no AI', r.text);
check(/⬆ bds\/stableok: PROMOTED — moved to stable APIs/.test(r.text) && JSON.parse(U('stableok', 'bp/manifest.json')).dependencies[0].version === '2.12.0' && JSON.parse(U('fine', 'bp/manifest.json')).dependencies[0].version === '2.12.0-beta', 'promotion: stable kept when it passes, beta kept (manifest put back) when not', r.text);
r = run(['undo', '-a', 'stableok']);
check(JSON.parse(U('stableok', 'bp/manifest.json')).dependencies[0].version === '2.12.0-beta', 'undo after a promotion: back on beta', r.text);

// release: go must say DONE; version +1, CHANGELOG from TASK.md's unreleased lines, ship
{
  fs.appendFileSync(path.join(T, 'bds', 'addons', 'modfix', 'TASK.md'), '\n## Changes\n- 2026-10-01 ルビーを5個に\n');
  r = run(['release', '-a', 'modfix']);
  const cl = U('modfix', 'CHANGELOG.md');
  check(r.code === 0 && /OK v1\.0\.1/.test(r.text) && /## 1\.0\.1 \(\d{4}-\d\d-\d\d\)\n- ルビーを5個に\n- BDS 1\.26\.60\.1: FIXED/.test(cl) && /OK ship: addon\/modfix/.test(r.text), 'release: version, CHANGELOG from TASK.md, ship', r.text + cl);
  r = run(['release', '-a', 'modfix', '--no-ship']);
  check(/## 1\.0\.2 .*\n- （変更の記録なし）\n\n## 1\.0\.1/.test(U('modfix', 'CHANGELOG.md')) && !/ship/.test(r.text), 'release again: only new lines (none), newest on top', U('modfix', 'CHANGELOG.md'));
  r = run(['release', '-a', 'broken']);
  check(r.code === 1 && /nothing released/.test(r.text) && !fs.existsSync(path.join(T, 'bds', 'addons', 'broken', 'CHANGELOG.md')), 'release refuses a unit whose go fails', r.text);
}
// preview watch: --only-new does nothing for a preview already checked
r = run(['maintain', '--to', 'preview', '--only-new', '-a', 'fine', '--no-ai'], { LAB_PREVIEW_VERSION: '1.26.70.5' });
const r2 = run(['maintain', '--to', 'preview', '--only-new', '-a', 'fine', '--no-ai'], { LAB_PREVIEW_VERSION: '1.26.70.5' });
check(/moving to preview/.test(r.text) && /OK no new preview \(1\.26\.70\.5 was checked\)/.test(r2.text) && !/moving/.test(r2.text), 'preview watch: each new preview checked once', r.text + r2.text);

// a release the lab cannot run yet: the lab goes back, nothing is touched, it waits (exit 0)
r = run(['maintain', '-a', 'fine', '--no-ai'], { FAKE_NOSPEAK: '1' });
check(r.code === 0 && /W bds: the lab cannot run latest yet/.test(r.text) && /back to BDS 1\.26\.60\.1/.test(r.text) && fs.readFileSync(path.join(T, 'bds', 'bds-version'), 'utf8') === '1.26.60.1' && /WAIT 1/.test(r.text), 'the real client does not speak the new release yet: WAIT, the lab put back', r.text);

// --schedule: one crontab line per lab folder (other lines kept), replaced on the next call, removed with off
if (process.platform !== 'win32') {
  const bin = path.join(T, 'cronbin'), tab = path.join(T, 'crontab.txt'); fs.mkdirSync(bin);
  fs.writeFileSync(tab, '5 5 * * * echo mine\n');
  fs.writeFileSync(path.join(bin, 'crontab'), `#!/bin/sh\nif [ "$1" = "-l" ]; then cat "${tab}"; else cat > "${tab}"; fi\n`, { mode: 0o755 });
  const e = { PATH: bin + path.delimiter + process.env.PATH };
  run(['maintain', '--schedule', 'daily', '--at', '03:30', '--no-ai'], e);
  r = run(['maintain', '--schedule', 'weekly', '--at', '04:45', '--no-ai'], e);
  const t1 = fs.readFileSync(tab, 'utf8');
  check(/OK maintain runs weekly at 04:45/.test(r.text) && t1.includes('echo mine') && (t1.match(/# bds-lab maintain/g) ?? []).length === 1 && /^45 4 \* \* 0 cd ".*" && ".*" ".*lab\.mjs" maintain --no-ai >> ".*scheduled\.log" 2>&1 # bds-lab maintain /m.test(t1), '--schedule: one crontab line (replaced, others kept)', r.text + t1);
  run(['maintain', '--schedule', 'daily', '--with-preview'], e);
  check(/maintain ; ".*" ".*lab\.mjs" maintain --to preview --only-new --no-ai >> /.test(fs.readFileSync(tab, 'utf8')), '--with-preview: the same line also checks each new preview', fs.readFileSync(tab, 'utf8'));
  run(['maintain', '--schedule', 'off'], e);
  check(fs.readFileSync(tab, 'utf8') === '5 5 * * * echo mine\n', '--schedule off removes only that line', fs.readFileSync(tab, 'utf8'));
}

// ui: this machine only (key + Host), the units with their state, only lab commands can be run from the page
{
  const { spawn } = await import('node:child_process');
  fs.mkdirSync(path.join(T, 'bds', '.lab', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(T, 'bds', '.lab', 'reports', 'fine.json'), JSON.stringify({ addon: 'fine', ok: true, pass: 3, total: 3 }));
  const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'ui'], { cwd: TOP, env: { ...env, LAB_UI_PORT: '0', LAB_UI_NO_OPEN: '1' } });
  const url = await new Promise((res) => { let t = ''; c.stdout.on('data', (d) => { t += d; const m = /http:\/\/127\.0\.0\.1:\d+\/\?k=\w+/.exec(t); if (m) res(m[0]); }); setTimeout(() => res(null), 15000); });
  const u = new URL(url), k = u.searchParams.get('k'), base = `http://127.0.0.1:${u.port}`;
  const st = await (await fetch(`${base}/api/state`, { headers: { 'x-lab-key': k } })).json();
  const noKey = (await fetch(`${base}/api/state`)).status, page = await (await fetch(url)).text();
  const bad = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'x-lab-key': k }, body: JSON.stringify({ args: ['handoff'] }) });
  c.kill();
  const fine = st.labs?.[0]?.units?.find((x) => x.name === 'fine'), lim = st.labs?.[0]?.units?.find((x) => x.name === 'limitme');
  check(fine?.last?.ok && fine.last.pass === 3 && lim?.off?.includes('ml') && noKey === 403 && bad.status === 400 && /AI に作らせる/.test(page), 'ui: units with their last result and switched-off features; no key → 403; only lab commands run', JSON.stringify(st).slice(0, 600));
}

// CI: the fixed units on a branch and one pull request
unit('prfix');
r = run(['maintain', '-a', 'prfix', '--no-ai', '--pr'], { LAB_CI_DRY: '1' });
check(/DRY git checkout -B maintain\/1\.26\.60\.1/.test(r.text) && /DRY git add -- bds\/addons\/prfix/.test(r.text) && /DRY gh pr create --head maintain\/1\.26\.60\.1/.test(r.text), '--pr: branch maintain/<version> with the fixed units, one pull request', r.text);

// undo / checkpoint
r = run(['undo', '-a', 'modfix']);
check(r.code === 0 && JSON.parse(U('modfix', 'bp/manifest.json')).dependencies[0].version === '2.11.0-beta' && /やり直す: node lab\.mjs undo (\S+)/.test(r.text), 'undo: the newest checkpoint comes back (and undo can be undone)', r.text);
const redo = /やり直す: node lab\.mjs undo (\S+)/.exec(r.text)?.[1];
r = run(['undo', redo, '-a', 'modfix']);
check(JSON.parse(U('modfix', 'bp/manifest.json')).dependencies[0].version === '2.12.0-beta', 'undo <id>: back to the fixed version', r.text);
fs.writeFileSync(path.join(T, 'bds', 'addons', 'fine', 'extra.txt'), 'new');
r = run(['checkpoint', 'my label', '-a', 'fine']);
const l = run(['undo', '--list', '-a', 'fine']);
check(/OK checkpoint/.test(r.text) && /my label/.test(l.text), 'checkpoint by hand, listed with its label', r.text + l.text);

// apidiff: two declaration files compared, and the lines of a unit that use what changed
{
  const A = await import(new URL('../common/apidiff.mjs', import.meta.url).href);
  const a = 'export class World {\n  /**\n   * @beta\n   */\n  readonly afterEvents: WorldAfterEvents;\n  getPlayers(options?: EntityQueryOptions): Player[];\n  oldThing(): void;\n}\nexport class Gone {\n  x: number;\n}\n';
  const b = 'export class World {\n  readonly afterEvents: WorldAfterEvents;\n  getPlayers(options?: EntityQueryOptions, extra?: boolean): Player[];\n  newThing(): void;\n}\nexport class Fresh {\n  y: number;\n}\n';
  const d = A.diff(a, b);
  check(d.removed.some((x) => x.name === 'World' && x.member === 'oldThing') && d.removed.some((x) => x.name === 'Gone' && !x.member) && d.changed.some((x) => x.member === 'getPlayers' && /extra/.test(x.now))
    && d.added.some((x) => x.member === 'newThing') && d.added.some((x) => x.name === 'Fresh') && d.stable.some((x) => x.member === 'afterEvents'), 'apidiff: removed, changed, added, beta → stable', JSON.stringify(d));
  const ud = path.join(T, 'apid'); fs.mkdirSync(path.join(ud, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ud, 'src', 'main.ts'), "import { world, Gone } from '@minecraft/server';\nconst m = new Map(); m.has(1);\nworld.oldThing();\nconst g: Gone = null as any;\n// world.oldThing() in a comment\n");
  const h = A.impact(d, ud);
  check(h.some((x) => x.line === 3 && /World\.oldThing removed/.test(x.what)) && h.some((x) => x.line === 4 && /Gone \(removed\)/.test(x.what)) && !h.some((x) => x.line === 5 || x.line === 2), 'apidiff: file:line of each use (comments and Map.has are not API uses)', JSON.stringify(h));
}

// watch: a save runs the tests again (the first run FAIL, the fix saved → PASS)
unit('w1', { dep: '2.12.0-beta' });
{
  const { spawn } = await import('node:child_process');
  const w = await new Promise((res) => {
    const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'watch', '-a', 'w1'], { cwd: TOP, env: { ...env, LAB_WATCH_RUNS: '2', LAB_WATCH_DEBOUNCE_MS: '200' } });
    let t = '', saved = false;
    c.stdout.on('data', (d) => { t += d; if (!saved && /FAIL \(/.test(t)) { saved = true; setTimeout(() => fs.writeFileSync(path.join(T, 'bds', 'addons', 'w1', 'src', 'main.ts'), 'FIXED\n'), 300); } });
    c.stderr.on('data', (d) => { t += d; });
    const k = setTimeout(() => c.kill(), 30000);
    c.on('close', (code) => { clearTimeout(k); res({ code, t }); });
  });
  check(w.code === 0 && /FAIL \(/.test(w.t) && /PASS \(/.test(w.t) && /✘ 3: ## core/.test(w.t) && w.t.includes('\x07'), 'watch: tests on start, again after a save; the ✘ lines shown; a bell when it turns PASS', w.t);
}

if (!process.env.KEEP) fs.rmSync(T, { recursive: true, force: true }); else console.log(T);
console.log(`${bad ? 'FAIL' : 'PASS'} ${good}/${good + bad}`);
process.exit(bad ? 1 : 0);
