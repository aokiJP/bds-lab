// node lab.mjs scan [-a <unit> | <file.mcaddon|.mcpack|.zip|folder>]: what an addon could do that whoever runs it should know
// first. Zero tokens, no server, nothing of it runs. `import` scans by itself; go says the command-injection lines of your own.
//   RISK  sends data out (server-net), reads the server's secrets (server-admin), changes permissions, bans or moves players
//         (op deop kick ban allowlist transfer stop ...), runs text as code (eval, new Function), code made unreadable on purpose
//         (obfuscated), keeps a hung script alive (watchdogTerminate cancelled), a command built from what a player typed
//   NOTE  the facts around it: hosts, commands it runs, functions run every tick, minified code, embedded data, simulated players
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// a zip entry's name: UTF-8 when its flag says so or the bytes are valid UTF-8; else Shift_JIS (CP932), what an addon zipped on a
// Japanese Windows carries ("テレポート BP/manifest.json"), instead of mojibake that could even make two names one
const UTF8 = new TextDecoder('utf-8', { fatal: true });
let SJIS = null; try { SJIS = new TextDecoder('shift_jis'); } catch { /* a Node without ICU: UTF-8 as before */ }
export function zipName(bytes, flags = 0) {
  if (flags & 0x0800 || bytes.every((b) => b < 0x80)) return Buffer.from(bytes).toString('utf8');
  try { return UTF8.decode(bytes); } catch { return SJIS ? SJIS.decode(bytes) : Buffer.from(bytes).toString('utf8'); }
}
/** the files of a zip as [{ name, data }]; a .mcpack/.zip inside an .mcaddon is opened too */
export function unzipAll(buf, pre = '') {
  const out = [];
  let e = buf.length - 22;
  while (e > 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e <= 0 && buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  let p = buf.readUInt32LE(e + 16);
  for (let n = buf.readUInt16LE(e + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), fl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = zipName(buf.subarray(p + 46, p + 46 + fl), buf.readUInt16LE(p + 8));
    p += 46 + fl + xl + cl;
    if (name.endsWith('/') || name.includes('..')) continue;
    const at = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.subarray(at, at + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    if (/\.(mcpack|zip)$/i.test(name)) { try { out.push(...unzipAll(data, pre + name.replace(/\.(mcpack|zip)$/i, '') + '/')); continue; } catch { /* a file named .zip */ } }
    out.push({ name: pre + name, data });
  }
  return out;
}
function walk(dir, rel = '', acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.lab|dist|\.git)$/.test(e.name)) continue;
    const p = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p, r, acc); else if (e.isFile() && fs.statSync(p).size < 32e6) acc.push({ name: r, data: fs.readFileSync(p) });
  }
  return acc;
}
// the command that really runs: `execute ... run <cmd>` → <cmd>
const verb = (c) => /^\/?([a-z_-]+)/.exec(String(c).trim().replace(/^.*\brun\s+(?!.*\brun\s)/, ''))?.[1] ?? null;
const PERM = new Set(['op', 'deop', 'permission', 'kick', 'ban', 'ban-ip', 'pardon', 'pardon-ip', 'allowlist', 'whitelist', 'transfer', 'transferserver', 'stop', 'setmaxplayers', 'changesetting', 'wsserver', 'connect']);
const PLAYER_TEXT = /\$\{[^}]*\b(message|msg|text|input|formValues|args?|reason|content|chat)\b[^}]*\}/;
const NAME_IN = /(^|[^"'\\])\$\{[^}]*\.(name|nameTag)\s*\}(?!["'])/;
/** a command string a script builds from a player's name or text: [kind, what] or null (also used by go's QA on your own unit) */
export function commandInjection(line) {
  const m = /\brunCommand(?:Async)?\s*\(\s*`([^`]*)`/.exec(line);
  if (!m || /^\/?(say|me|tell|msg|w|tellraw|title|titleraw)\b/.test(m[1].trim())) return null;   // (the rest of a message command is just text)
  if (PLAYER_TEXT.test(m[1])) return ['text', "a player's text goes into a command: quotes, @a or another selector in it change what runs (use the API, or JSON.stringify(text) in quotes)"];
  if (NAME_IN.test(m[1])) return ['name', 'a player name goes into a command unquoted: a name with a space breaks it ("${p.name}" in quotes, or the API: give(p, ...))'];
  return null;
}

/** scans files ([{ name, data }]): { risks: [[what, where]], notes: [[what, where]] } */
export function scanFiles(list) {
  const R = new Map(), N = new Map();
  const add = (M, what, where) => { const a = M.get(what) ?? M.set(what, []).get(what); if (where && a.length < 6 && !a.includes(where)) a.push(where); };
  const cmds = new Map(), hosts = new Set();
  for (const f of list) {
    const base = path.posix.basename(f.name);
    if (base === 'manifest.json') {
      let m; try { m = JSON.parse(f.data.toString('utf8').replace(/^\uFEFF/, '').replace(/\/\/[^\n"]*$/gm, '')); } catch { continue; }
      const mods = (m.dependencies ?? []).map((d) => d.module_name).filter(Boolean);
      if (mods.includes('@minecraft/server-net')) add(R, 'net: can send HTTP requests anywhere (@minecraft/server-net)', f.name);
      if (mods.includes('@minecraft/server-admin')) add(R, "admin: reads the server's secrets and variables, can move players to other servers (@minecraft/server-admin)", f.name);
      if (mods.includes('@minecraft/server-gametest')) add(N, 'spawns simulated players (@minecraft/server-gametest)', f.name);
      continue;
    }
    if (base === 'tick.json') { try { const v = JSON.parse(f.data.toString('utf8')).values ?? []; if (v.length) add(N, `runs functions every tick: ${v.join(', ')}`, f.name); } catch { /* not ours */ } continue; }
    const isScript = /\.[cm]?[jt]s$/.test(base) && !/\.d\.ts$/.test(base), isFn = base.endsWith('.mcfunction');
    if (!isScript && !isFn) continue;
    const text = f.data.toString('utf8'), lines = text.split(/\r?\n/);
    if (isFn) {
      lines.forEach((l, i) => { const c = l.trim().startsWith('#') ? null : verb(l); if (!c) return; cmds.set(c, (cmds.get(c) ?? 0) + 1); if (PERM.has(c)) add(R, `perm: runs /${c} (permissions, bans, moving or stopping players)`, `${f.name}:${i + 1}`); });
      continue;
    }
    const obf = (text.match(/\b_0x[0-9a-f]{4,}\b/g) ?? []).length + (text.match(/\\x[0-9a-f]{2}/gi) ?? []).length;
    if (obf > 40) add(R, 'obfuscated: code made unreadable on purpose (what it does cannot be checked)', f.name);
    else if (lines.some((l) => l.length > 3000)) add(N, 'minified: very long lines (hard to review; fine for a library)', f.name);
    if (/watchdogTerminate/.test(text) && /\.cancel\s*=\s*true/.test(text)) add(R, 'watchdog: cancels the watchdog (a hung or endless script is not stopped)', f.name);
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) if (!/^(www\.)?(minecraft\.net|github\.com|learn\.microsoft\.com|json-schema\.org|feedback\.minecraft\.net)$/i.test(m[1])) hosts.add(m[1].toLowerCase());
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      const at = `${f.name}:${i + 1}`;
      if (/(^|[^.\w$])eval\s*\(|\bnew\s+Function\s*\(|(^|[^.\w$])Function\s*\(\s*['"`]/.test(l)) add(R, 'eval: runs text as code (eval / new Function)', at);
      for (const m of l.matchAll(/\brunCommand(?:Async)?\s*\(\s*(['"`])(.*?)\1/g)) { const c = verb(m[2]); if (!c) continue; cmds.set(c, (cmds.get(c) ?? 0) + 1); if (PERM.has(c)) add(R, `perm: runs /${c} (permissions, bans, moving or stopping players)`, at); }
      const inj = commandInjection(l);
      if (inj) add(inj[0] === 'text' ? R : N, `inject: ${inj[1]}`, at);
      if (/['"`][A-Za-z0-9+/]{600,}={0,2}['"`]/.test(l)) add(N, 'blob: embedded data (base64): what it is cannot be seen', at);
      if (/discord(app)?\.com\/api\/webhooks/.test(l)) add(N, 'posts to a Discord webhook', at);
    });
  }
  if (hosts.size) add([...R.keys()].some((k) => k.startsWith('net:')) ? R : N, `hosts: ${[...hosts].slice(0, 8).join(', ')}`);
  if (cmds.size) add(N, `commands: ${[...cmds.keys()].sort().slice(0, 20).join(' ')}`);
  return { risks: [...R], notes: [...N] };
}
export function scanPath(p) {
  const st = fs.statSync(p);
  return scanFiles(st.isDirectory() ? walk(p) : unzipAll(fs.readFileSync(p)));
}
export function report(r, label, out = console.log, { notes = true } = {}) {
  for (const [w, at] of r.risks) out(`RISK ${w}${at.length ? ` — ${at.join(' ')}` : ''}`);
  if (notes) for (const [w, at] of r.notes) out(`NOTE ${w}${at.length && !/^(commands|hosts):/.test(w) ? ` — ${at.slice(0, 3).join(' ')}` : ''}`);
  out(r.risks.length ? `W scan ${label}: ${r.risks.length} risk(s): read the lines above before running it on a server people use` : `OK scan ${label}: nothing risky${r.notes.length && notes ? ` (${r.notes.length} note${r.notes.length > 1 ? 's' : ''})` : ''}`);
}

export async function scanCmd(args, out = console.log) {
  const f = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-a');
  if (f) { if (!fs.existsSync(f)) { out(`ERR no such file: ${f}`); return false; } const r = scanPath(path.resolve(f)); report(r, path.basename(f), out); return !r.risks.length; }
  const { labKind, currentUnit, unitDir } = await import('./checkpoint.mjs');
  const k = labKind(), u = currentUnit(k, args), r = scanPath(unitDir(k, u));
  report(r, u, out);
  return !r.risks.length;
}
