#!/usr/bin/env node
// `node lab.mjs upkeep` (common/upkeep.mjs), the one front door to upkeep, on a fake lab whose lab.mjs answers maint / clean /
// maintain from a script: the four steps in order, network trouble told apart from real problems, the fixed and the still
// broken units listed, the one next command, --check changing nothing, --auto handing over to the scheduler.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const X = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-upkeep-'));
const script = { 'maint --fix': ['FIX temp: 一時フォルダ 2 個を削除', 'W leaks: 鍵らしい文字列: a.txt（消してください）'], 'maint --online': ['W updates: https://api.github.com/x: HTTP 401'],
  'maint --online --only updates': ['W updates: BDS 1.26.60.1 が出ています'], clean: ['OK clean: 120 MB freed'], 'clean --dry': ['W bench: 1 個', 'would free the above (node lab.mjs clean does it)'],
  'maintain --lab all': ['bds: BDS 1.26.60.1 (was 1.26.52.3)', '✔ bds/a: OK', '🔧 bds/b: FIXED — autofix: 2.10.0 -> 2.11.0', '✘ bds/c: BROKEN — could not fix it', 'FAIL maintain: OK 1, FIXED 1, BROKEN 1 → bds/.lab/maintain/report.md'] };
fs.writeFileSync(path.join(X, 'lab.mjs'), `const S = ${JSON.stringify(script)}; const a = process.argv.slice(2).join(' '); require('fs').appendFileSync(__dirname + '/calls.txt', a + '\\n'); console.log((S[a] ?? ['OK']).join('\\n'));`);
fs.renameSync(path.join(X, 'lab.mjs'), path.join(X, 'lab.cjs')); fs.writeFileSync(path.join(X, 'lab.mjs'), "import './lab.cjs';\n");
const run = (a) => { const r = spawnSync(process.execPath, [path.join(REPO, 'lab.mjs'), 'upkeep', ...a], { cwd: REPO, encoding: 'utf8', env: { ...process.env, LAB_UPKEEP_ROOT: X, LAB_DOTENV: 'off' } }); return { status: r.status, t: (r.stdout ?? '') + (r.stderr ?? '') }; };
let r = run([]);
const calls = fs.readFileSync(path.join(X, 'calls.txt'), 'utf8').trim().split('\n');
ok(calls.join('|') === 'maint --fix|clean|maintain --lab all', 'in order: health (repairing), cleaning, the newest Minecraft with every unit', calls.join('|'));
ok(/^1\/4 点検: 要対応 1（直したもの 1）$/m.test(r.t) && /^2\/4 片付け: 120 MB 空けました$/m.test(r.t) && /^3\/4 最新版: bds: BDS 1\.26\.60\.1 \(was 1\.26\.52\.3\)$/m.test(r.t), 'each step in one line a person can read', r.t);
ok(/^4\/4 ユニット: OK 1, FIXED 1, BROKEN 1$/m.test(r.t) && /🔧 bds\/b: FIXED/.test(r.t) && /✘ bds\/c: BROKEN/.test(r.t) && !/✔ bds\/a/.test(r.t), 'units: the count, then only what changed or still fails', r.t);
ok(r.status !== 0 && /^FAIL upkeep .* · 次: node lab\.mjs bds why -a c$/m.test(r.t), 'the one next command: why for the unit still broken', r.t);
fs.writeFileSync(path.join(X, 'calls.txt'), '');
r = run(['--check']);
const c2 = fs.readFileSync(path.join(X, 'calls.txt'), 'utf8').trim().split('\n');
ok(!c2.some((c) => /--fix|^clean$|^maintain/.test(c)) && /ネットワークで調べられなかったもの 1/.test(r.t) && /^1\/4 点検: 問題なし/m.test(r.t) && /BDS 1\.26\.60\.1 が出ています/.test(r.t) && /何も変えていません/.test(r.t), '--check: nothing changed; a network failure is not a problem of the lab', r.t + c2.join('|'));
// bedrock-binary here: this BDS's binary read before maintain, and after a move what the new one changed, in one line
fs.mkdirSync(path.join(X, 'bedrock-binary', 'src'), { recursive: true }); fs.writeFileSync(path.join(X, 'bedrock-binary', 'src', 'cli.js'), '');
script['bb --quiet'] = ['OK bb 1.26.52.3']; script['bb diff --short'] = ['binary 1.26.52.3 → 1.26.60.1: packets +1 (NewThing) · commands +newcmd'];
fs.writeFileSync(path.join(X, 'lab.cjs'), `const S = ${JSON.stringify(script)}; const a = process.argv.slice(2).join(' '); require('fs').appendFileSync(__dirname + '/calls.txt', a + '\\n'); console.log((S[a] ?? ['OK']).join('\\n'));`);
fs.writeFileSync(path.join(X, 'calls.txt'), '');
r = run([]);
const c3 = fs.readFileSync(path.join(X, 'calls.txt'), 'utf8').trim().split('\n');
ok(c3.join('|') === 'maint --fix|clean|bb --quiet|maintain --lab all|bb diff --short' && /^ {4}binary 1\.26\.52\.3 → 1\.26\.60\.1: packets \+1 \(NewThing\) · commands \+newcmd \(node lab\.mjs bb diff\)$/m.test(r.t), 'bedrock-binary: the old binary read before the move, what the new one changed after it', c3.join('|') + '\n' + r.t);
// --auto: a fake crontab (a file); upkeep replaces this lab's scheduled maintain (it runs maintain itself), others are kept
if (process.platform !== 'win32') {
  const bin = path.join(X, 'bin'), tab = path.join(X, 'crontab.txt'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'crontab'), `#!/bin/sh\nif [ "$1" = "-l" ]; then [ -f "${tab}" ] && cat "${tab}" && exit 0; exit 1; fi\ncat > "${tab}"\n`, { mode: 0o755 });
  fs.writeFileSync(tab, `17 4 * * * cd "${REPO}" && node lab.mjs maintain # bds-lab maintain ${REPO}\n0 1 * * * echo other # someone else\n`);
  const auto = (a) => { const x = spawnSync(process.execPath, [path.join(REPO, 'lab.mjs'), 'upkeep', '--auto', ...a], { cwd: REPO, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, LAB_UPKEEP_ROOT: X, LAB_DOTENV: 'off' } }); return (x.stdout ?? '') + (x.stderr ?? ''); };
  let o = auto(['daily', '--at', '05:10']), t = fs.readFileSync(tab, 'utf8');
  ok(/^10 5 \* \* \* .*lab\.mjs" upkeep .*# bds-lab upkeep /m.test(t) && !/# bds-lab maintain /.test(t) && /# someone else/.test(t) && /OK upkeep runs daily at 05:10 .*off: node lab\.mjs upkeep --auto off/.test(o), '--auto daily: one crontab line at that time, the lab\'s own maintain line replaced, others kept', o + t);
  o = auto(['off']); t = fs.readFileSync(tab, 'utf8');
  ok(!/# bds-lab upkeep /.test(t) && /# someone else/.test(t) && /OK the scheduled upkeep is off/.test(o), '--auto off: its line gone, the rest kept', o + t);
}
fs.rmSync(X, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} upkeep-front-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
