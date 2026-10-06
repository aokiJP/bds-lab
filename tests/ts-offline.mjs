#!/usr/bin/env node
// `node lab.mjs ts` (common/ts.mjs) with no BDS: a fake live server answers /tsr, /peek and /do the way the real one carries
// TS REPL's bridge (scriptevent tsrepl:ai / tsrepl:netin → «TSREPL»{json}). Checked: the request split under BDS's 2048-character
// /scriptevent limit, run / type errors / state / save with the file's trigger / stop --all / pull-push / watch through its own
// reader, the trigger header both ways, the sandbox (ts try) on sandbox-be, promote's addon code, and TS REPL's bds-lab patch.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const X = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-ts-'));
process.env.LAB_TS_ROOT = X; process.env.LAB_KIND = 'bds';   // (ts.mjs reads its root when loaded: this lab is the fake one)
const T = await import(pathToFileURL(path.join(REPO, 'common', 'ts.mjs')).href);

// the wire: short requests in one /scriptevent, long ones in tsrepl:netin chunks that join back to the request
const short = T.wire({ kind: 'eval', code: '1+1' }, 'x1'), long = T.wire({ kind: 'eval', code: 'a'.repeat(5000) }, 'x2');
const joined = long.map((c) => c.replace(/^scriptevent tsrepl:netin x2\/\d+\/\d+\//, '')).join('');
ok(short.length === 1 && short[0].startsWith('scriptevent tsrepl:ai {') && long.length === 4 && long.every((c) => c.length < 2048) && JSON.parse(joined).code.length === 5000, 'requests fit /scriptevent (2048): one line, or netin chunks that join back', long.map((c) => c.length).join(' '));
ok(T.parseReply('[Scripting] «TSREPL»{"id":"a","ok":true}')?.id === 'a' && T.parseReply('«TSREPL»{bad') === null, 'answers are read from «TSREPL» lines');
for (const [h, t] of [['// @on playerBreakBlock', { kind: 'event', event: 'playerBreakBlock' }], ['// @every 40', { kind: 'interval', ticks: 40 }], ['// @join', { kind: 'join' }], ['', { kind: 'manual' }]]) ok(JSON.stringify(T.triggerOf(`${h}\nx()`)) === JSON.stringify(t) && T.header(t) === h, `trigger header ${h || '(none)'} ↔ ${t.kind}`);

// a fake live server: TS REPL's answers by kind, the world's lines for /peek
const saved = new Map(), seen = [], world = []; let armed = false;
fs.mkdirSync(path.join(X, 'bds', '.lab'), { recursive: true });
const answer = (q) => {
  if (q.kind === 'eval') return /: string = 5/.test(q.code) ? { ok: false, kind: 'error', data: { diagnostics: [{ line: 1, column: 7, code: 2322, message: "Type 'number' is not assignable to type 'string'." }] }, error: '型エラー 1 件' } : { ok: true, kind: 'eval', data: { output: q.slot === 'watch' ? 'watching' : '3', logs: ['hi'], ms: 4 } };
  if (q.kind === 'state') return { ok: true, data: { tick: 9, day: 0, players: [{ name: 'Ann', dimension: 'minecraft:overworld', location: { x: 1.5, y: -60, z: 2.5 }, tags: ['tsrepl.owner'] }], scripts: [...saved].map(([name, v]) => ({ name, trigger: v.trigger })), compilerLoaded: true } };
  if (q.kind === 'check') return { ok: true, data: { diagnostics: [], elapsedMs: 3 } };
  if (q.kind === 'save') { saved.set(q.name, { code: q.code, trigger: q.trigger, updated: Date.now() }); return { ok: true, data: { saved: q.name } }; }
  if (q.kind === 'list') return { ok: true, data: { scripts: [...saved].map(([name, v]) => ({ name, size: v.code.length, trigger: v.trigger, updated: v.updated })) } };
  if (q.kind === 'pull') return saved.has(q.name) ? { ok: true, data: { name: q.name, code: saved.get(q.name).code } } : { ok: false, error: 'none' };
  if (q.kind === 'stop') return { ok: true, data: { cleared: q.slot ? 1 : 0 } };
  return { ok: false, error: 'kind ' + q.kind };
};
const parts = new Map();
const srv = http.createServer((req, res) => { let d = ''; req.on('data', (c) => { d += c; }); req.on('end', () => {
  const b = JSON.parse(d || '{}');
  if (req.url === '/peek' && b.from !== undefined && armed) { armed = false; world.push('[tsrepl:slot:watch] Ann broke minecraft:stone 1,-61,2'); }   // (a player acts once the watcher is in)
  if (req.url === '/peek') return res.end(JSON.stringify({ lines: b.from === undefined ? [] : world.slice(b.from), mark: world.length }));
  if (req.url !== '/tsr') return res.end(JSON.stringify({ lines: [] }));
  let q = null;
  for (const c of b.cmds) { seen.push(c); const m = /^scriptevent tsrepl:ai (.*)$/.exec(c), k = /^scriptevent tsrepl:netin ([^/]+)\/(\d+)\/(\d+)\/(.*)$/.exec(c);
    if (m) q = JSON.parse(m[1]); else if (k) { const p = parts.get(k[1]) ?? []; p[k[2] - 1] = k[4]; parts.set(k[1], p); if (p.filter((x) => x !== undefined).length === Number(k[3])) q = JSON.parse(p.join('')); } }
  if (q?.slot === 'watch' && q.kind === 'eval') armed = true;
  res.end(JSON.stringify({ reply: q ? `«TSREPL»${JSON.stringify({ id: q.id, ...answer(q) })}` : null, lines: ['@Ann actionbar: tick', '@Ann actionbar: tick'] }));
}); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
fs.writeFileSync(path.join(X, 'bds', '.lab', 'live.json'), JSON.stringify({ http: srv.address().port, pid: process.pid, port: 19132, addon: 'demo' }));
const run = async (a) => { const o = []; const r = await T.tsCmd(a, (l) => o.push(String(l))); return { r, t: o.join('\n') }; };
let r = await run(['1 + 2']);
ok(r.r && /^hi$/m.test(r.t) && /^= 3$/m.test(r.t) && /^OK ts 4 ms$/m.test(r.t) && /^@Ann actionbar: tick ×2$/m.test(r.t), 'run: its logs, = the value, OK; the world\'s repeated lines once with ×n', r.t);
r = await run(['const x: string = 5']);
ok(!r.r && /^E 1:7 TS2322 Type 'number'/m.test(r.t) && /^FAIL ts: 1 type error/m.test(r.t), 'a type error: E line:col TScode, FAIL (it did not run)', r.t);
fs.mkdirSync(path.join(X, 'ts'));
fs.writeFileSync(path.join(X, 'ts', 'log.ts'), '// @on playerBreakBlock\nconsole.log("x")\n');
fs.writeFileSync(path.join(X, 'ts', 'res.ts'), 'world.afterEvents.playerJoin.subscribe(() => {});\n');
r = await run(['res']);
ok(r.r && /its handlers stay \(slot res; ts stop/.test(r.t) && seen.some((c) => /"slot":"res"/.test(c)), 'a file under ts/ by its name: its own slot (a re-run replaces only its handlers)', r.t);
r = await run(['save', 'log']);
ok(r.r && saved.get('log.ts')?.trigger?.event === 'playerBreakBlock' && /OK saved log\.ts in the world \(on playerBreakBlock; live now\)/.test(r.t), 'save: the file\'s // @on header is its trigger, live at once', r.t);
r = await run(['state']);
ok(/^tick 9 · day 0 · 1 player\(s\): Ann overworld 1,-60,2 \[tsrepl\.owner\]$/m.test(r.t) && /^saved: log\.ts \(on playerBreakBlock\)/m.test(r.t), 'state: players (where, tags) and saved scripts in two lines', r.t);
r = await run(['stop', '--all']);
ok(/OK ts stop: 2 handler\(s\) removed/.test(r.t) && seen.some((c) => /"kind":"stop","slot":"res"/.test(c)) && seen.some((c) => /"kind":"stop","slot":"watch"/.test(c)), 'stop --all: every slot this lab started, and the watcher', r.t);
const W = path.join(X, 'pulled');
r = await run(['pull', W]);
ok(r.r && fs.readFileSync(path.join(W, 'log.ts'), 'utf8').startsWith('// @on playerBreakBlock'), 'pull: saved scripts → files (header kept)', r.t);
fs.writeFileSync(path.join(W, 'new.ts'), '// @every 10\nsay(1)\n');
r = await run(['push', W]);
ok(r.r && saved.get('new.ts')?.trigger?.ticks === 10 && /OK ts push: 2 file/.test(r.t), 'push: files → saved scripts with their triggers', r.t);
r = await run(['watch', '--for', '1']);
ok(r.r && /^· Ann broke minecraft:stone 1,-61,2$/m.test(r.t), 'watch: what players do, through its own reader (/peek)', r.t);
r = await run(['join']);
ok(/127\.0\.0\.1 {2}port 19132/.test(r.t) && /tsrepl_start/.test(r.t), 'join: the address, the port and the first command in the game', r.t);
srv.close();

// the sandbox (no server) and promote's addon code
if (fs.existsSync(path.join(REPO, 'sandbox-be', 'src', 'index.js'))) {
  delete process.env.LAB_TS_ROOT;
  const T2 = await import(pathToFileURL(path.join(REPO, 'common', 'ts.mjs')).href + '?2');
  const o = []; const rr = await T2.tsCmd(['try', 'say("hi " + player.name); 6 * 7'], (l) => o.push(l));
  ok(rr && o.includes('hi A') && o.includes('= 42'), 'try: the same names (player, say) in sandbox-be; the last expression is the value', o.join('\n'));
}
const ev = T.asAddon('// @on playerBreakBlock\nsay(player?.name)\n'), man = T.asAddon('say("x")', undefined, 'demo'), res = T.asAddon('import { world } from "@minecraft/server";\nworld.afterEvents.playerJoin.subscribe(() => {});');
ok(/afterEvents\.playerBreakBlock\.subscribe\(\(event: any\)/.test(ev) && /const say = /.test(ev) && /e\.id !== 'demo:run'/.test(man) && /worldLoad\.subscribe/.test(res) && (res.match(/import \{ world \}/g) ?? []).length === 1 && !/const world = /.test(res), 'promote: an event script subscribes, a one-off runs on /scriptevent <unit>:run, a resident one at world load; its own imports kept once');
// TS REPL's bds-lab patch: in place, and running it again changes nothing
if (spawnSync('python3', ['--version']).status === 0) {
  const p = spawnSync('python3', [path.join(REPO, 'bds', 'addons', 'ts_repl', 'lab', 'patch.py')], { encoding: 'utf8' });
  ok(p.status === 0 && /OK TS REPL: bds-lab changes in place/.test(p.stdout) && !/patched/.test(p.stdout), 'TS REPL carries the bds-lab patch (console = owner, slots, late logs, live triggers, shields); a second run changes nothing', p.stdout + p.stderr);
}
fs.rmSync(X, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} ts-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
