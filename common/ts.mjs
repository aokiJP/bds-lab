// node lab.mjs ts ...: TS REPL (bds/addons/ts_repl, a utility in every live server) driven from here. Code runs in the live world
// now — no restart, no /reload, no /reload all: typed by the game's own TypeScript, run in TS REPL's context, the handlers it
// leaves (subscribe, runInterval) kept per file and swapped when the file runs again. Through BDS's console: TS REPL's AI bridge
// (scriptevent tsrepl:ai / tsrepl:netin in chunks; replies as «TSREPL»{json} lines; the console is trusted as the owner, see
// bds/addons/ts_repl/lab/patch.py). The workspace is ts/ (a .ts file = a TS REPL script; `// @on <event>` / `// @every <ticks>`
// / `// @join` at its top = its trigger). `ts try` runs the same code in sandbox-be instead (no server).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = process.env.LAB_TS_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WS = path.join(TOP, 'ts');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const kind = () => (process.env.LAB_KIND || read(path.join(TOP, '.lab-kind'))?.trim() || 'bds').replace(/[^a-z]/g, '') || 'bds';
const liveFile = () => path.join(TOP, kind(), '.lab', 'live.json');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const live = () => { try { const j = JSON.parse(read(liveFile())); return j.http && alive(j.pid) ? j : null; } catch { return null; } };
const post = async (route, body = {}) => { const j = live(); if (!j) throw new Error('no live server'); return (await fetch(`http://127.0.0.1:${j.http}${route}`, { method: 'POST', body: JSON.stringify(body) })).json(); };
const HIDE = /^> scriptevent tsrepl:|^> \(since last\)$|^OK$|«TSREPL»/;
// a reader of the server's lines that takes nothing away from others (a `do`, another ts): its own mark in the live server's log
function reader() {
  let mark;
  return async () => {
    const r = await post('/peek', mark === undefined ? {} : { from: mark });
    if (r.mark === undefined) return (await post('/do', { cmds: [] })).lines ?? [];   // (a live server from before /peek)
    const first = mark === undefined; mark = r.mark;
    return first ? [] : (r.lines ?? []).filter((l) => !HIDE.test(l) && !parseReply(l));
  };
}

// ---------- the bridge ----------
let seq = 0;
export const parseReply = (line) => { const m = /«TSREPL»(\{.*\})\s*$/.exec(line); if (!m) return null; try { return JSON.parse(m[1]); } catch { return null; } };
export function wire(req, id) {   // one request → the console commands that carry it (BDS cuts /scriptevent at 2048 characters)
  const msg = JSON.stringify({ ...req, id });
  if (msg.length <= 1900) return [`scriptevent tsrepl:ai ${msg}`];
  const parts = []; for (let i = 0; i < msg.length; i += 1400) parts.push(msg.slice(i, i + 1400));
  return parts.map((p, i) => `scriptevent tsrepl:netin ${id}/${i + 1}/${parts.length}/${p}`);
}
// the other lines the live server printed meanwhile (what a resident handler logged, a script error, a player's chat) go to `seen`
async function bridge(req, seen, timeout = 40000) {
  const id = `lab${process.pid.toString(36)}-${++seq}`;
  let reply = null;
  const take = (lines) => { for (const l of lines ?? []) { const r = parseReply(l); if (r) { if (r.id === id) reply = r; continue; } if (!HIDE.test(l)) seen.push(l); } };
  const r = await post('/tsr', { id, cmds: wire(req, id), timeout });   // (the live server waits for the answer by its id)
  take(r.lines); if (r.reply) take([r.reply]);
  if (r.reply === undefined) {   // a live server started before /tsr existed: send, then look for the answer
    take((await post('/do', { cmds: wire(req, id), wait: 50 })).lines);
    for (const t0 = Date.now(); !reply && Date.now() - t0 < timeout;) { await sleep(150); take((await post('/do', { cmds: [] })).lines); }
  }
  return reply ?? { ok: false, error: `no answer from TS REPL in ${timeout / 1000}s: it is not in this live server (LAB_UTILITIES=off? bds/addons/ts_repl missing?) or the code ran too long` };
}
async function ensureLive(out) {
  if (live()) return true;
  out('… no live server yet: node lab.mjs up (once; it stays up while you or a person use it)');
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'up'], { cwd: TOP, encoding: 'utf8', timeout: 600000, env: { ...process.env, FORCE_COLOR: '0' } });
  const last = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean);
  if (!live()) { last.slice(-6).forEach((l) => out(l)); return false; }
  out(last.find((l) => /^OK live/.test(l)) ?? 'OK live');
  return true;
}
// the world's own lines since the last look: the same line repeated (an action bar every second) once, with ×n
const flush = (seen, out, max = 40) => {
  const n = new Map(); for (const l of seen.splice(0)) n.set(l, (n.get(l) ?? 0) + 1);
  const rows = [...n].map(([l, k]) => (k > 1 ? `${l} ×${k}` : l));
  if (rows.length > max) out(`… ${rows.length - max} earlier line(s)`);
  rows.slice(-max).forEach((l) => out(l));
};

// ---------- the workspace: files ↔ scripts ----------
const TRIG = /^\/\/\s*@(on|every|join|startup|command|manual)\b[ \t]*(\S*)[ \t]*(.*)$/m;
export function triggerOf(code) {
  const m = TRIG.exec(code.split('\n').slice(0, 5).join('\n'));
  if (!m) return { kind: 'manual' };
  return { on: { kind: 'event', event: m[2] }, every: { kind: 'interval', ticks: Number(m[2]) || 20 }, join: { kind: 'join' }, startup: { kind: 'startup' }, command: { kind: 'command', command: m[2], description: m[3] }, manual: { kind: 'manual' } }[m[1]];
}
export function header(t) {
  return !t || t.kind === 'manual' ? '' : t.kind === 'event' ? `// @on ${t.event}` : t.kind === 'interval' ? `// @every ${t.ticks}` : t.kind === 'command' ? `// @command ${t.command} ${t.description ?? ''}`.trim() : `// @${t.kind}`;
}
const slotOf = (f) => path.basename(f).replace(/\.[cm]?[jt]s$/, '').replace(/[^\w.-]/g, '_').slice(0, 60);
function fileArg(a) {   // a path as typed, else under ts/ (with or without .ts)
  for (const f of [a, path.join(TOP, a), path.join(WS, a), path.join(WS, a + '.ts')]) if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return path.resolve(f);
  return null;
}
const scriptFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.(ts|js)$/.test(n) && !/\.local\.ts$/.test(n) && fs.statSync(path.join(dir, n)).isFile()).sort() : []);
const rel = (f) => { const r = path.relative(process.cwd(), f); return !r || r.startsWith('..') ? f : r; };
// the slots this lab started (for `ts stop --all`), kept beside the live server's file
const slotsFile = () => path.join(TOP, kind(), '.lab', 'ts-slots.json');
const slotsUsed = () => { try { return JSON.parse(read(slotsFile())) ?? []; } catch { return []; } };
const noteSlot = (s) => { if (!s) return; const l = slotsUsed(); if (!l.includes(s)) { l.push(s); try { fs.writeFileSync(slotsFile(), JSON.stringify(l)); } catch { /* best effort */ } } };

// ---------- printing a reply ----------
function said(r, out, label = '') {
  const d = r.data ?? {};
  // TS REPL's "removed the last run's n handlers" becomes a short note on the result line
  const sw = (d.logs ?? []).map((l) => /^\[tsrepl\] 前の実行ぶんの購読・常駐処理を (\d+) 件外しました/.exec(l)?.[1]).find(Boolean);
  for (const l of d.logs ?? []) if (!/^\[tsrepl\] 前の実行ぶんの購読/.test(l)) out(l);
  if (sw && r.ok && d.output !== undefined) d.output = `${d.output}   (replaced its last run's ${sw} handler(s))`;
  for (const x of d.diagnostics ?? []) out(`E ${label}${label ? ':' : ''}${x.line}:${x.column} TS${x.code} ${x.message}`);
  if (r.ok && d.output !== undefined) out(`= ${String(d.output).split('\n').slice(0, 30).join('\n  ')}`);
  if (!r.ok && !(d.diagnostics ?? []).length) out(`E ${r.error ?? 'failed'}`);
  return r.ok;
}

// ---------- the sandbox (no server): the same code, the same names (world system mc ui player dimension say run) ----------
function tsLib() { for (const t of [path.join(TOP, kind(), '.lab', 'tool', 'package.json'), path.join(TOP, 'bds', '.lab', 'tool', 'package.json')]) { try { return createRequire(t)('typescript'); } catch { /* next */ } } return null; }
export function sandboxModule(code, ts = tsLib()) {
  let js = code, imports = [];
  if (ts) {   // TypeScript → JS; the last expression is the value shown (as TS REPL does); imports go to the top
    const sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.ES2022, true);
    const last = sf.statements.at(-1);
    let body = code;
    if (last && ts.isExpressionStatement(last)) body = code.slice(0, last.getStart(sf)) + 'return (' + code.slice(last.getStart(sf), last.end).replace(/;\s*$/, '') + ');' + code.slice(last.end);
    const out = ts.transpileModule(body.replace(/^\s*import\s[^;]*;?\s*$/gm, (l) => { imports.push(l); return ''; }), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: false });
    js = out.outputText.replace(/^export \{\};\s*$/m, '');
  }
  return `import * as mc from '@minecraft/server';\nimport * as ui from '@minecraft/server-ui';\n${imports.join('\n')}\n`
    + `mc.system.runTimeout(async () => {\n  const world = mc.world, system = mc.system, player = world.getAllPlayers()[0], dimension = player?.dimension ?? world.getDimension('overworld');\n`
    + `  const say = (...a) => world.sendMessage(a.map(String).join(' ')), run = (c) => dimension.runCommand(c);\n`
    + `  try { const v = await (async () => {\n${js}\n})(); console.warn('= ' + (typeof v === 'string' ? v : JSON.stringify(v) ?? String(v))); } catch (e) { console.error(String(e)); }\n}, 5);\n`;
}

// ---------- promote: a script (or file) as an addon unit ----------
export function asAddon(code, trigger = triggerOf(code), ns = 'lab') {
  const imports = []; const body = code.replace(/^\s*import\s[^;]*;?\s*$/gm, (l) => { imports.push(l.trim()); return ''; }).replace(TRIG, '').trim();
  const has = (n) => new RegExp(`\\b(import\\s*\\{[^}]*\\b${n}\\b|(const|let|var|function|class)\\s+${n}\\b|import\\s+\\*\\s+as\\s+${n}\\b)`).test(code);
  const bare = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');   // (names in comments and strings do not count)
  const uses = (n) => new RegExp(`\\b${n}\\b`).test(bare);
  const head = ["import * as __mc from '@minecraft/server';", ...(uses('ui') && !has('ui') ? ["import * as ui from '@minecraft/server-ui';"] : []), ...imports];
  const names = ['world', 'system', 'mc'].filter((n) => uses(n) && !has(n)).map((n) => (n === 'mc' ? 'mc = __mc' : `${n} = __mc.${n}`));
  if (names.length) head.push(`const ${names.join(', ')};`);
  const ind = body.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
  const helpers = "  const dimension = player?.dimension ?? __mc.world.getDimension('overworld');\n  const say = (...a: unknown[]) => __mc.world.sendMessage(a.map(String).join(' ')), run = (c: string) => dimension.runCommand(c);\n";
  const t = trigger ?? { kind: 'manual' };
  const wrap = t.kind === 'event' ? `__mc.world.afterEvents.${t.event}.subscribe((event: any) => {\n  const player = (event.player ?? event.source ?? event.sender ?? __mc.world.getAllPlayers()[0]) as __mc.Player | undefined;\n${helpers}${ind}\n});`
    : t.kind === 'interval' ? `__mc.system.runInterval(() => {\n  const player = __mc.world.getAllPlayers()[0] as __mc.Player | undefined;\n${helpers}${ind}\n}, ${t.ticks});`
    : t.kind === 'join' ? `__mc.world.afterEvents.playerSpawn.subscribe(({ player: p, initialSpawn }) => {\n  if (!initialSpawn) return;\n  const player = p as __mc.Player | undefined;\n${helpers}${ind}\n});`
    : /\.subscribe\(|\.run(Interval|Timeout|Job)\(/.test(bare)
      ? `// it stayed in the world in TS REPL (handlers): here it is set up once, when the world has loaded\n__mc.world.afterEvents.worldLoad.subscribe(() => {\n  const player = undefined as __mc.Player | undefined;\n${helpers}${ind}\n});`
      : `// it ran by hand in TS REPL: here on /scriptevent ${ns}:run, as the player who sent it\n__mc.system.afterEvents.scriptEventReceive.subscribe((e) => {\n  if (e.id !== '${ns}:run') return;\n  const player = e.sourceEntity as __mc.Player | undefined;\n${helpers}${ind}\n});`;
  return `${head.join('\n')}\n\n${wrap}\n`;
}

// ---------- the resident watcher (`ts watch`): what players do, one line each ----------
export const WATCH = `import { world } from "@minecraft/server";
const A: any = world.afterEvents;
const at = (b: any) => Math.floor(b.x) + "," + Math.floor(b.y) + "," + Math.floor(b.z);
const on = (n: string, f: (e: any) => string | undefined) => { try { A[n]?.subscribe((e: any) => { try { const t = f(e); if (t) console.log(t); } catch { } }); } catch { } };
on("playerJoin", (e) => e.playerName + " joined");
on("playerLeave", (e) => e.playerName + " left");
on("chatSend", (e) => e.sender.name + ": " + e.message);
on("playerBreakBlock", (e) => e.player.name + " broke " + e.brokenBlockPermutation.type.id + " " + at(e.block));
on("playerPlaceBlock", (e) => e.player.name + " placed " + e.block.typeId + " " + at(e.block));
on("itemUse", (e) => e.source.name + " used " + e.itemStack.typeId);
on("playerInteractWithBlock", (e) => e.isFirstEvent === false ? undefined : e.player.name + " touched " + e.block.typeId + " " + at(e.block));
on("playerInteractWithEntity", (e) => e.player.name + " touched " + e.target.typeId);
on("entityHurt", (e) => { const d = e.damageSource.damagingEntity; return d?.typeId === "minecraft:player" ? d.name + " hit " + e.hurtEntity.typeId + " -" + e.damage : e.hurtEntity.typeId === "minecraft:player" ? e.hurtEntity.name + " hurt -" + e.damage + " (" + e.damageSource.cause + ")" : undefined; });
on("entityDie", (e) => e.deadEntity.typeId === "minecraft:player" ? e.deadEntity.name + " died (" + e.damageSource.cause + ")" : undefined);
on("playerDimensionChange", (e) => e.player.name + " went to " + e.toDimension.id);
on("playerGameModeChange", (e) => e.player.name + " is now " + e.toGameMode);
"watching";`;

const USAGE = `node lab.mjs ts ... (TS REPL in the live server: no restart, no /reload; help ts)
  ts "<code>" | <file>      run it in the live world now (typed; a file's handlers replace its last run's)   --as <player>
  ts hot <file>...          run again on every save (Ctrl+C: stop)          ts stop [<file>|--all]  remove a file's handlers
  ts check <file|code>      type errors only        ts state  players, tick, saved scripts        ts join  how to join it
  ts save <file> [--name n] keep it in the world (trigger: // @on <event> | @every <ticks> | @join at its top)   ts rm <name>
  ts pull|push [<dir>]      saved scripts ↔ ts/      ts sync [<dir>]  both ways while it runs (edit in your editor or in-game)
  ts watch [--for <s>]      what players do, as it happens       ts try "<code>"|<file>  the same in the sandbox (no server)
  ts promote <file|name> <unit>   an addon unit from it (src/main.ts), then go`;

export async function tsCmd(args, out = console.log) {
  const a = [...args], opt = (k) => { const i = a.indexOf(k); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; }, flag = (k) => { const i = a.indexOf(k); if (i < 0) return false; a.splice(i, 1); return true; };
  const as = opt('--as'), slot0 = opt('--slot'), nameOpt = opt('--name'), all = flag('--all');
  // hot / sync / watch keep going until Ctrl+C in a terminal; anywhere else (an AI's shell) they stop by themselves
  const dur = opt('--for') ?? (process.stdout.isTTY ? null : ['hot', 'sync'].includes(a[0]) ? '60' : a[0] === 'watch' ? '30' : null);
  const sub = a[0], rest = a.slice(1);
  if (!sub) { out(USAGE); return true; }
  if (sub === 'try') return tryCmd(rest, out);
  if (sub === 'promote') return promote(rest, out);
  if (sub === 'join') return join(out);
  if (!(await ensureLive(out))) return false;
  const seen = [];
  const one = async (req, label) => { const r = await bridge(req, seen); flush(seen, out); return said(r, out, label); };
  if (sub === 'state') {
    const r = await bridge({ kind: 'state' }, seen); flush(seen, out);
    if (!r.ok) return said(r, out);
    const d = r.data, f = (n) => Math.floor(n);
    out(`tick ${d.tick} · day ${d.day} · ${d.players.length} player(s)${d.players.length ? ': ' + d.players.map((p) => `${p.name} ${p.dimension.replace('minecraft:', '')} ${f(p.location.x)},${f(p.location.y)},${f(p.location.z)}${p.tags.length ? ' [' + p.tags.join(' ') + ']' : ''}`).join(' · ') : ''}`);
    out(`saved: ${d.scripts.length ? d.scripts.map((s) => `${s.name}${s.trigger?.kind && s.trigger.kind !== 'manual' ? ` (${header(s.trigger).replace('// @', '')})` : ''}${s.disabled ? ' off' : ''}`).join(', ') : 'none'}${d.compilerLoaded ? '' : ' · compiler not loaded yet (the first run takes ~5 s)'}`);
    return true;
  }
  if (sub === 'list') { const r = await bridge({ kind: 'list' }, seen); flush(seen, out); if (r.ok) { r.data.scripts.forEach((s) => out(`${s.name}  ${s.size} chars  ${header(s.trigger).replace('// @', '') || 'manual'}${s.disabled ? '  off' : ''}`)); out(`OK ${r.data.scripts.length} saved script(s)`); } return said(r, out); }
  if (sub === 'check') {
    const f = fileArg(rest[0] ?? ''), code = f ? read(f) : rest.join('\n');
    const r = await bridge({ kind: 'check', code }, seen); flush(seen, out);
    if (!r.ok) return said(r, out);
    const errs = r.data.diagnostics.filter((d) => d.category === 'error');
    errs.forEach((x) => out(`E ${f ? rel(f) + ':' : ''}${x.line}:${x.column} TS${x.code} ${x.message}`));
    out(errs.length ? `FAIL ts check: ${errs.length} type error(s)` : `OK ts check (${r.data.elapsedMs} ms)`);
    return !errs.length;
  }
  if (sub === 'stop') {
    // (the slots: a file's name; --all = every one this lab started, the watcher and what ran with no file)
    const slots = all ? [...slotsUsed(), 'watch', null] : rest.length ? rest.map((x) => slotOf(fileArg(x) ?? x)) : [null];
    if (all) try { fs.rmSync(slotsFile(), { force: true }); } catch { /* none */ }
    let n = 0; for (const s of slots) { const r = await bridge({ kind: 'stop', ...(s ? { slot: s } : {}) }, seen); n += r.data?.cleared ?? 0; }
    flush(seen, out); out(`OK ts stop: ${n} handler(s) removed`); return true;
  }
  if (sub === 'rm') { const ok = await one({ kind: 'delete', name: rest[0] }); if (ok) out(`OK removed ${rest[0]}`); return ok; }
  if (sub === 'save') {
    const f = fileArg(rest[0] ?? ''); if (!f) { out(`E no such file: ${rest[0] ?? '(none)'}`); return false; }
    const code = read(f), name = nameOpt ?? path.basename(f), t = triggerOf(code);
    const ck = await bridge({ kind: 'check', code }, seen);
    const errs = (ck.data?.diagnostics ?? []).filter((d) => d.category === 'error');
    if (errs.length) { flush(seen, out); errs.forEach((x) => out(`E ${rel(f)}:${x.line}:${x.column} TS${x.code} ${x.message}`)); out('FAIL ts save: fix the type errors first'); return false; }
    const ok = await one({ kind: 'save', name, code, trigger: t });
    if (ok) out(`OK saved ${name} in the world (${header(t).replace('// @', '') || 'manual: runs from the workbench or ts'}${t.kind === 'command' || t.kind === 'startup' ? '; a command / startup script takes effect at the next server start' : '; live now'})`);
    return ok;
  }
  if (sub === 'pull' || sub === 'push' || sub === 'sync') return syncCmd(sub, rest[0] ? path.resolve(rest[0]) : WS, seen, out, dur);
  if (sub === 'watch') {
    const r = await bridge({ kind: 'eval', slot: 'watch', code: WATCH }, seen);
    if (!r.ok) { flush(seen, out); return said(r, out); }
    const look = reader(); await look();
    out(`watching (${dur ? dur + ' s' : 'Ctrl+C stops'}): what players do, what the addon prints`);
    const until = Date.now() + 1000 * (Number(dur) || 1e9);
    let stop = false; process.once('SIGINT', () => { stop = true; });
    while (!stop && Date.now() < until) { await sleep(400); for (const l of await look()) out(l.replace(/^\[tsrepl:slot:watch\] /, '· ')); }
    await bridge({ kind: 'stop', slot: 'watch' }, []);
    out('OK ts watch'); return true;
  }
  if (sub === 'hot') {
    const files = rest.map((x) => fileArg(x)); if (!files.length || files.some((f) => !f)) { out(`E no such file: ${rest[files.indexOf(null)] ?? '(none)'}`); return false; }
    const runFile = async (f) => { const r = await bridge({ kind: 'eval', code: read(f), slot: slotOf(f), ...(as ? { as } : {}) }, seen); const t = new Date().toTimeString().slice(0, 8); const lines = []; said(r, (l) => lines.push(l), path.basename(f)); seen.length = 0; out(`[${t}] ${path.basename(f)} ${r.ok ? 'OK' : 'FAIL'}${lines.length === 1 ? ' ' + lines[0] : ''}`); if (lines.length > 1) lines.forEach((l) => out('  ' + l)); };
    for (const f of files) { noteSlot(slotOf(f)); await runFile(f); }
    out(`hot: ${files.map((f) => path.basename(f)).join(' ')} run again on every save (no /reload: only its own handlers are swapped). ${dur ? `${dur} s, then` : 'Ctrl+C:'} stops and removes them`);
    const stamp = new Map(files.map((f) => [f, fs.statSync(f).mtimeMs])), look = reader(); await look();
    let stop = false; process.once('SIGINT', () => { stop = true; });
    const until = dur ? Date.now() + 1000 * Number(dur) : Infinity;
    while (!stop && Date.now() < until) {
      await sleep(300);
      for (const f of files) { let m = 0; try { m = fs.statSync(f).mtimeMs; } catch { continue; } if (m !== stamp.get(f)) { stamp.set(f, m); await sleep(80); await runFile(f); } }
      for (const l of await look()) out(l);
    }
    for (const f of files) await bridge({ kind: 'stop', slot: slotOf(f) }, []);
    out('OK ts hot: stopped, its handlers removed'); return true;
  }
  // run: a file (its own slot: a re-run replaces only its handlers) or the code typed
  const f = fileArg(sub);
  const code = f ? read(f) : [sub, ...rest].join('\n');
  const slot = slot0 ?? (f ? slotOf(f) : null);
  noteSlot(slot);
  const r = await bridge({ kind: 'eval', code, ...(slot ? { slot } : {}), ...(as ? { as } : {}) }, seen);
  flush(seen, out);
  const ok = said(r, out, f ? rel(f) : '');
  out(ok ? `OK ts ${r.data?.ms ?? r.ms ?? 0} ms${slot && /subscribe|runInterval|runTimeout|runJob/.test(code) ? ` · its handlers stay (slot ${slot}; ts stop ${f ? rel(f) : '--slot ' + slot} removes them)` : ''}` : `FAIL ts${r.data?.diagnostics?.length ? `: ${r.data.diagnostics.length} type error(s)` : ''}`);
  return ok;
}

// ---------- pull / push / sync: ts/<name> ↔ the world's saved scripts ----------
async function syncCmd(sub, dir, seen, out, dur) {
  fs.mkdirSync(dir, { recursive: true });
  const list = async () => { const r = await bridge({ kind: 'list' }, seen); return r.ok ? r.data.scripts : null; };
  const pullOne = async (name) => { const r = await bridge({ kind: 'pull', name }, seen); return r.ok ? r.data.code : null; };
  const fileText = (s, code) => { const h = header(s.trigger); return h && !TRIG.test(code.split('\n').slice(0, 5).join('\n')) ? `${h}\n${code}` : code; };
  const safe = (n) => n.replace(/[\\/:*?"<>|]/g, '_');
  const push = async (n) => { const code = read(path.join(dir, n)); const r = await bridge({ kind: 'save', name: n, code, trigger: triggerOf(code) }, seen); if (!r.ok) out(`E ${n}: ${r.error}`); return r.ok; };
  if (sub === 'pull') {
    const ss = await list(); if (!ss) { flush(seen, out); out('FAIL ts pull'); return false; }
    let n = 0; for (const s of ss) { const code = await pullOne(s.name); if (code == null) continue; fs.writeFileSync(path.join(dir, safe(s.name)), fileText(s, code)); n++; }
    flush(seen, out); out(`OK ts pull: ${n} script(s) → ${rel(dir)}`); return true;
  }
  if (sub === 'push') {
    let n = 0, bad = 0; for (const f of scriptFiles(dir)) (await push(f)) ? n++ : bad++;
    flush(seen, out); out(`${bad ? 'FAIL' : 'OK'} ts push: ${n} file(s) → the world's saved scripts${bad ? `, ${bad} refused` : ''} (live now)`); return !bad;
  }
  // sync: the newer side wins; both changed → the world's is kept, yours goes to <name>.local.ts
  const known = new Map();   // name → { text, updated }
  const ss0 = await list(); if (!ss0) { flush(seen, out); out('FAIL ts sync'); return false; }
  for (const s of ss0) { const code = await pullOne(s.name); const f = path.join(dir, safe(s.name)); const local = read(f); if (local == null) fs.writeFileSync(f, fileText(s, code)); known.set(s.name, { text: local ?? fileText(s, code), updated: s.updated ?? 0 }); }
  for (const n of scriptFiles(dir)) if (!known.has(n)) { await push(n); known.set(n, { text: read(path.join(dir, n)), updated: -1 }); }
  out(`sync ${rel(dir)} ↔ the world (${known.size} script(s); ${dur ? dur + ' s' : 'Ctrl+C stops'}): a save here goes in, a change made in-game comes out`);
  let stop = false; process.once('SIGINT', () => { stop = true; });
  const until = Date.now() + 1000 * (Number(dur) || 1e9);
  while (!stop && Date.now() < until) {
    await sleep(1200);
    for (const n of scriptFiles(dir)) { const t = read(path.join(dir, n)), k = known.get(n); if (t != null && t !== k?.text) { if (await push(n)) out(`→ ${n} (into the world)`); known.set(n, { text: t, updated: -1 }); } }
    const ss = await list(); if (!ss) continue;
    for (const s of ss) {
      const k = known.get(s.name);
      if (k && k.updated === -1) { k.updated = s.updated ?? 0; continue; }   // (our own push)
      if (k && (s.updated ?? 0) === k.updated) continue;
      const code = await pullOne(s.name); if (code == null) continue;
      const f = path.join(dir, safe(s.name)), text = fileText(s, code), local = read(f);
      if (local != null && k && local !== k.text) { fs.writeFileSync(f.replace(/(\.[jt]s)?$/, '.local.ts'), local); out(`W ${s.name}: changed here and in-game; kept the game's, yours is ${path.basename(f).replace(/(\.[jt]s)?$/, '.local.ts')}`); }
      fs.writeFileSync(f, text); known.set(s.name, { text, updated: s.updated ?? 0 }); out(`← ${s.name} (changed in-game)`);
    }
    flush(seen, out);
  }
  out('OK ts sync'); return true;
}

// ---------- try: sandbox-be, no server ----------
async function tryCmd(rest, out) {
  const f = fileArg(rest[0] ?? ''), code = f ? read(f) : rest.join('\n');
  if (!code) { out('usage: node lab.mjs ts try "<code>" | <file>'); return false; }
  const SB = path.join(TOP, 'sandbox-be', 'src', 'index.js');
  if (!fs.existsSync(SB)) { out('E sandbox-be/ is not here'); return false; }
  const { runSandbox } = await import(pathToFileURL(SB).href);
  const S = await import(pathToFileURL(path.join(TOP, 'common', 'sim.mjs')).href);
  const r = await runSandbox({ code: sandboxModule(code), players: [{ name: 'A', location: { x: 0.5, y: -60, z: 0.5 }, op: true }], allowErrors: true, limits: { ticks: 60 } });
  const lines = S.render(r, ['A']);
  lines.forEach((l) => out(l));
  const bad = lines.some((l) => l.startsWith('E ')) || r.report?.unsupported && Object.keys(r.report.unsupported).length;
  if (r.report?.unsupported && Object.keys(r.report.unsupported).length) out(`? the sandbox does not do: ${Object.keys(r.report.unsupported).slice(0, 4).join(', ')} (ts "<code>" runs it in the live world)`);
  out(bad ? 'FAIL ts try (sandbox)' : 'OK ts try (sandbox, no server): ts "<code>" runs it in the live world');
  return !bad;
}

// ---------- promote ----------
async function promote(rest, out) {
  const [src, unit] = rest;
  if (!src || !unit || !/^[a-z][a-z0-9_]*$/.test(unit)) { out('usage: node lab.mjs ts promote <file|saved script> <unit name: a-z 0-9 _>'); return false; }
  let code = fileArg(src) ? read(fileArg(src)) : null, trigger = code ? triggerOf(code) : null;
  if (code == null) {
    if (!(await ensureLive(out))) return false;
    const seen = [], r = await bridge({ kind: 'pull', name: src }, seen), l = await bridge({ kind: 'list' }, seen);
    if (!r.ok) { flush(seen, out); return said(r, out); }
    code = r.data.code; trigger = l.data?.scripts?.find((s) => s.name === src)?.trigger ?? triggerOf(code);
  }
  const dir = path.join(TOP, 'bds', 'addons', unit);
  if (fs.existsSync(dir)) { out(`E bds/addons/${unit} exists: pick another name`); return false; }
  const title = unit.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const n = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', 'new', unit, title, `TS REPL script ${path.basename(src)} as an addon`, `desc=${title}: made from the TS REPL script ${path.basename(src)}`], { cwd: TOP, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
  if (n.status !== 0 || !fs.existsSync(dir)) { out(`${n.stdout ?? ''}${n.stderr ?? ''}`.trim().split('\n').slice(-4).join('\n')); out('FAIL ts promote'); return false; }
  fs.writeFileSync(path.join(dir, 'src', 'main.ts'), `// from TS REPL (${path.basename(src)}) by node lab.mjs ts promote\n${asAddon(code, trigger, unit)}`);
  out(`OK bds/addons/${unit}/src/main.ts from ${path.basename(src)} (${header(trigger).replace('// @', '') || (/\.subscribe\(|\.run(Interval|Timeout|Job)\(/.test(code) ? 'its handlers: set up when the world loads' : 'manual → /scriptevent ' + unit + ':run')}). Next: write tests.txt (what it should do), then node lab.mjs go -a ${unit}`);
  return true;
}

// ---------- join: a person's own Minecraft on the live server ----------
function join(out) {
  const j = live();
  if (!j) { out('no live server: node lab.mjs up (then this again)'); return false; }
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  const ver = read(path.join(TOP, kind(), '.lab', 'bds', 'VERSION'))?.trim();
  out(`join the live server (${j.addon}) from your Minecraft${ver ? ` ${ver.split('.').slice(0, 3).join('.')} (a newer Minecraft says "outdated server": node lab.mjs bds --update, then up)` : ''}: Play → Servers → Add Server`);
  out(`  this PC: 127.0.0.1  port ${j.port}${lan.length ? ` · phone / another PC on this network: ${lan[0]}  port ${j.port}` : ''}`);
  if (process.platform === 'win32') out('  (Windows: if 127.0.0.1 does not answer, use the network address, or once as admin: CheckNetIsolation LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe")');
  out('  in the game you are operator and TS REPL is yours (its console item is given on joining; /function tsrepl_start opens it): write and run TypeScript there, ts sync brings it here');
  out('  here: ts watch = what you do, ts state = where everyone is; it stays up while someone is on it');
  return true;
}
