// node lab.mjs sim [-a <addon>] [--tests <file>] [--ticks n] [--json]: the addon's tests.txt in a second, with no server — sandbox-be (in
// sandbox-be/: Script API and player movement measured against BDS, run in a virtual world) instead of a real BDS.
// The `##` sections run in order in one sandbox world, as `go` runs them on one server (each also alone: a section that
// passes only alone says an earlier one left state behind): `@A join` (the players are there from tick 0), `@A cmd /x`, `@A chat t`,
// `@A select <item>` + `@A use|useon x y z|eat`, `@A place <block> x y z`, `@A dig x y z`,
// `@A jump`, `@A form <n|button text|[values]>|close`, `scriptevent id msg`, console commands, `wait ms`, `until` (2 s), `restart`
// (the next part runs in the world the last one left, scripts loaded fresh); the output is
// the lab's own shape (`@A <chat>`, `@A title: ..`, `@A form action: title("..") button("..")`, console lines, `E <error>`)
// and the section's expectations (= ~ ! !~) are checked on it. A section with lines the sandbox cannot do (@A walk ...)
// is SKIPPED, never guessed. A hint for the inner loop: `go` on a real BDS stays the verdict.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { remapper } from './build.mjs';
import { literalMiss } from './lint-tests.mjs';
const clockMs = (a) => { const m = /^([+-]?)(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(String(a ?? '')); return m ? (m[1] === '-' ? -1 : 1) * Number(m[2]) * { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[3]] : null; };

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SBX = path.join(TOP, 'sandbox-be');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cmpv = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

// the sandbox's newest version not above the one asked for (its game lags the lab's BDS by a release or two)
export function pickVersions(deps, api) {
  const versions = {}, notes = [];
  for (const d of deps) {
    const avail = api.modules[d.module_name]?.versions; if (!avail) continue;
    const want = String(d.version).replace(/-.*$/, '');
    const beta = String(d.version) === 'beta' ? avail.filter((v) => /-beta$/.test(v)).at(-1) : avail.includes(String(d.version)) ? String(d.version) : null;
    if (beta) { versions[d.module_name] = beta; continue; }   // a beta the sandbox has (Mojang's metadata): as is
    const betas = avail.filter((v) => /-beta$/.test(v)), stable = avail.filter((v) => !/-beta$/.test(v));
    if (/beta/.test(String(d.version))) { const b = betas.at(-1) ?? avail.at(-1); versions[d.module_name] = b; notes.push(`${d.module_name} ${d.version} → ${b} (the newest beta it has)`); continue; }
    if (avail.includes(want)) { versions[d.module_name] = want; continue; }
    const lower = stable.filter((v) => cmpv(v, want) <= 0);   // a stable version asks for stable APIs: never a beta
    versions[d.module_name] = lower.at(-1) ?? stable[0] ?? avail[0];
    notes.push(`${d.module_name} ${want} → ${versions[d.module_name]}`);
  }
  return { versions, notes };
}
export function sections(text) {
  const out = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith('## ')) { cur = { title: l.slice(3).trim(), lines: [] }; out.push(cur); continue; }
    if (!l || l.startsWith('#')) continue;
    if (!cur) { cur = { title: '(top)', lines: [] }; out.push(cur); }
    cur.lines.push(l);
  }
  return out;
}
const EXPECT = /^(=|~|!~|!)\s?(.*)$/;
// one section → a sandbox request (or why it cannot be one)
export function toRequest(sec, { files, entry, versions, ticks = 0, picks = [], sec0 = 0, known = new Set(), waits = [] }) {
  const players = new Set(), actions = [], ui = [], expects = [], joined = [], marks = [], left = new Set(), untils = [];
  // where each player stands and faces (as far as the test says: spawn, walk, goto, tp), for walk's direction
  const where_ = {}, yaw = {}, start = (p) => (where_[p] ??= { x: 0.5 + [...players].indexOf(p) * 2, z: 0.5 });
  let sec_ = sec0;   // a merged run (simCmd): '\u0001<n>' starts section n; its expectations and output window are its own
  let t = 20, skip = null, formN = 0;
  const held = {}, js = [];
  let approx = false;   // `@A select <item>`: what that player holds for use / useon / eat (the sandbox takes the item per action)
  let cmdT = 0;   // when the last command started (an until looks from there, as on the real server)
  for (const l of sec.lines) {
    if (!EXPECT.test(l) && !/^until\b/.test(l) && !l.startsWith('\u0001')) cmdT = t;
    if (l.startsWith('\u0001')) { if (marks.length) t += 5; sec_ = Number(l.slice(1)); marks.push({ sec: sec_, tick: t }); continue; }   // (a section takes time on the real server too: no empty window)
    const e = EXPECT.exec(l);
    if (e) { expects.push({ op: e[1], text: e[2], sec: sec_ }); continue; }
    let m;
    if ((m = /^@(\w+)\s+(\w+)\s*(.*)$/.exec(l))) {
      const [, p, verb, arg] = m; players.add(p);
      if (verb === 'join') {
        if (left.has(p)) { left.delete(p); actions.push({ tick: t, type: 'join', player: p }); joined.push({ p, tick: t + 1, again: false, at: { ...start(p) } }); t += 10; continue; }
        joined.push({ p, tick: t, again: known.has(p) || joined.some((j) => j.p === p) }); continue;
      }
      if (verb === 'leave' && !arg.trim()) { left.add(p); actions.push({ tick: t, type: 'leave', player: p }); t += 10; continue; }
      // walk <dir> [ticks] (measured on BDS 1.26.52.3: 20 ticks forward = 4.3 blocks, forward = +z and left = +x facing as
      // spawned) and goto x z (the real client finds a path; here a straight line): moves in steps, so scripts that watch where
      // a player is see it go by. Not the real physics: a miss in such a section is only UNSURE
      const wm = verb === 'walk' && /^(forward|back|left|right)(?:\s+(\d+))?$/.exec(arg.trim());
      if (wm) {
        const n = Number(wm[2] ?? 20), d = 4.3 / 20, y = ((yaw[p] ?? 0) * Math.PI) / 180, f = { x: -Math.sin(y), z: Math.cos(y) }, l = { x: f.z, z: -f.x };
        const v = { forward: f, back: { x: -f.x, z: -f.z }, left: l, right: { x: -l.x, z: -l.z } }[wm[1]], s0 = start(p);
        for (let k = 0; k < n; k += 4) { const m = Math.min(4, n - k); actions.push({ tick: t + k, type: 'move', player: p, by: { x: v.x * d * m, z: v.z * d * m } }); }
        where_[p] = { x: s0.x + v.x * d * n, z: s0.z + v.z * d * n }; t += n + 2; approx = true; continue;
      }
      const gm = verb === 'goto' && /^(-?[\d.]+)\s+(?:(-?[\d.]+)\s+)?(-?[\d.]+)$/.exec(arg.trim());
      if (gm) {
        const s0 = start(p), to = { x: Number(gm[1]), z: Number(gm[3]) }, dist = Math.hypot(to.x - s0.x, to.z - s0.z), n = Math.max(1, Math.ceil(dist / (4.3 / 20)));
        yaw[p] = (Math.atan2(-(to.x - s0.x), to.z - s0.z) * 180) / Math.PI;
        for (let k = 4; k < n; k += 4) actions.push({ tick: t + k, type: 'move', player: p, to: { x: s0.x + ((to.x - s0.x) * k) / n, z: s0.z + ((to.z - s0.z) * k) / n } });
        actions.push({ tick: t + n, type: 'move', player: p, to }); where_[p] = to; t += n + 6; approx = true; continue;
      }   // (printed as the real client does: `@A joined x y z`, then `@A already joined`)
      if (verb === 'cmd') { actions.push({ tick: t, type: 'command', player: p, command: arg.replace(/^\//, '') }); t += 5; continue; }
      if (verb === 'chat') { actions.push({ tick: t, type: 'chat', player: p, message: arg }); t += 5; continue; }
      if (verb === 'jump') { actions.push({ tick: t, type: 'button', player: p, button: 'Jump', state: 'Pressed' }, { tick: t + 1, type: 'button', player: p, button: 'Jump', state: 'Released' }); t += 5; continue; }
      const at = /^(-?\d+)\s+(-?\d+)\s+(-?\d+)$/.exec(arg.trim()), xyz = at && { x: +at[1], y: +at[2], z: +at[3] }, hand = held[p] ? { item: held[p] } : {};
      if (verb === 'select' && !/^\d+$/.test(arg.trim())) { held[p] = arg.trim(); continue; }
      if (verb === 'use' && !arg.trim()) { actions.push({ tick: t, type: 'useItem', player: p, ...hand }); t += 5; continue; }
      // eat / drink, as the real client's events come: itemStartUse, then after the item's use time (1.6 s unless its use_modifiers
      // say) its consume components, itemCompleteUse, one leaves the hand, itemStopUse
      if (verb === 'eat' && !arg.trim()) {
        const d = Math.max(1, Math.round(20 * Number(itemComp(files, held[p], 'minecraft:use_modifiers')?.use_duration ?? 1.6)));
        actions.push({ tick: t, type: 'startUse', player: p }, { tick: t + d, type: 'consumeItem', player: p, ...hand }, { tick: t + d, type: 'completeUse', player: p }, { tick: t + d, type: 'useUp', player: p }, { tick: t + d, type: 'stopUse', player: p });
        t += d + 8; continue;
      }
      if (verb === 'useon' && xyz) { actions.push({ tick: t, type: 'useItemOn', player: p, at: xyz, ...hand }); t += 5; continue; }
      if (verb === 'dig' && xyz) { actions.push({ tick: t, type: 'breakBlock', player: p, at: xyz }); t += 5; continue; }
      // attack / interact <mob|name>: the first such entity (the real client takes the nearest in view, and its weapon's damage:
      // the sandbox hits for 1), so a miss here is only UNSURE
      if ((verb === 'attack' || verb === 'interact') && xyz) { actions.push(verb === 'interact' ? { tick: t, type: 'useItemOn', player: p, at: xyz, ...hand } : { tick: t, type: 'breakBlock', player: p, at: xyz }); t += 5; continue; }   // (a block: as the real client does it)
      if ((verb === 'attack' || verb === 'interact') && arg.trim()) { const x = arg.trim().split(/\s+/)[0]; actions.push({ tick: t, type: verb === 'attack' ? 'attack' : 'interactWithEntity', player: p, target: /:/.test(x) || /[A-Z]/.test(x) ? x : 'minecraft:' + x, ...(verb === 'attack' ? { damage: weaponDamage(files, held[p]) } : {}) }); approx = true; t += 10; continue; }
      if (verb === 'attack') { actions.push({ tick: t, type: 'swing', player: p }); t += 5; continue; }
      const pl = verb === 'place' && /^(\S+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/.exec(arg.trim());
      if (pl) { actions.push({ tick: t, type: 'placeBlock', player: p, block: pl[1], at: { x: +pl[2], y: +pl[3], z: +pl[4] } }); t += 5; continue; }
      if (verb === 'form') {
        const want = arg.trim();
        if (want === 'close') ui.push({ player: p, canceled: 'UserClosed' });
        else if (/^\d+$/.test(want)) ui.push({ player: p, selection: Number(want) });
        else if (picks[formN] !== undefined) ui.push(typeof picks[formN] === 'object' ? { player: p, formValues: picks[formN].formValues } : { player: p, selection: picks[formN] });
        else ui.push({ player: p, selection: 0, text: want, unresolved: true });
        formN++; t += 5; continue;
      }
      skip ??= `@${p} ${verb}`; continue;
    }
    if ((m = /^wait\s+(\d+)/.exec(l))) { t += Math.ceil(Number(m[1]) / 50); continue; }
    if ((m = /^clock\s+(\S+)/.exec(l))) { const ms = clockMs(m[1]); if (ms === null) skip ??= `clock ${m[1]}`; else { actions.push({ tick: t, type: 'clock', by: ms }); t += 2; } continue; }
    // until <regex> [ms]: as long as the run before showed it took (waits[i], found by simCmd), else 2 s; at most ms (10 s)
    if ((m = /^until\s+(.+?)(?:\s+(\d+))?$/.exec(l))) { const ms = Number(m[2] ?? 10000), i = untils.length; untils.push({ start: t, from: cmdT, re: m[1], max: Math.ceil(ms / 50) }); t += Math.min(waits[i] ?? 40, Math.ceil(ms / 50)); continue; }
    if ((m = /^scriptevent\s+(\S+)\s*(.*)$/.exec(l))) { actions.push({ tick: t, type: 'scriptEvent', id: m[1], message: m[2] }); t += 3; continue; }
    // js <expr>: in the addon's world, as the lab's helper does (p inv mob hit dim world system mc $), its value as a line
    if ((m = /^js\s+(.+)$/.exec(l)) && !/\b(sim|answer|tap)\s*\(|\bgt\./.test(m[1])) { actions.push({ tick: t, type: 'scriptEvent', id: 'lab:js', message: String(js.push(m[1]) - 1) }); t += 3; continue; }
    if (/^(js|restart|trace|events|states|serverping)\b/.test(l)) { skip ??= l.startsWith('js') ? 'js with simulated players' : l.split(/\s+/)[0]; continue; }
    // a console command (give A lab:ruby 3, tp, gamemode ...): its player names come in too
    actions.push({ tick: t, type: 'command', command: l }); t += 3;
    { const tp = /^(?:tp|teleport)\s+([A-Z])\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(l); if (tp) where_[tp[1]] = { x: Number(tp[2]), z: Number(tp[4]) }; }
    for (const w of l.split(/\s+/).slice(1)) if (/^[A-Z]$/.test(w)) players.add(w);
  }
  if (!players.size) players.add('A');
  return { skip, approx, expects, ui, joined, marks, untils, req: { files: js.length ? withJs(files, entry, js) : files, entry, versions, players: [...players].map((name, i) => ({ name, location: { x: 0.5 + i * 2, y: -60, z: 0.5 }, op: true })), actions, ui: ui.map(({ text, unresolved, ...u }) => u), allowErrors: true, limits: { ticks: Math.max(ticks, t + 60) } } };
}
// the section's js lines, compiled ahead (the sandbox has no eval): a module beside the entry, imported by it, that answers
// scriptevent lab:js <n> with the value of line n, in the shape the lab's helper prints (common/helper.js: inv fmt mob hit)
const HELPER = (() => { try { return /const inv=[\s\S]*?const hit=[^\n]*\n/.exec(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'helper.js'), 'utf8'))?.[0] ?? ''; } catch { return ''; } })();
// a custom form answered as the real client does (realplayer.cjs `form`): one value per input in order (`form ["text", true, 2]`;
// labels, headers and dividers take none), a dropdown by its option's text too, one input without brackets (`form 緑`)
export function modalValues(f, want) {
  const ctl = (f.calls ?? []).filter((c) => /^(textField|dropdown|toggle|slider|label|header|divider)$/.test(c.method)), ins = ctl.filter((c) => !/^(label|header|divider)$/.test(c.method));
  let v; try { v = JSON.parse(want); } catch { v = undefined; }
  if (!Array.isArray(v)) { if (ins.length !== 1) return undefined; v = [v ?? String(want).replace(/^["']|["']$/g, '')]; }
  if (v.length !== ins.length) return undefined;
  v = v.map((x, j) => { const c = ins[j]; if (c.method === 'dropdown' && typeof x === 'string') { const o = (c.args[1] ?? []).map(String), k = /^\d+$/.test(x) ? Number(x) : o.indexOf(x); return k >= 0 ? k : x; } if (c.method === 'slider' && typeof x === 'string') return Number(x); if (c.method === 'textField') return String(x); return x; });
  const it = v[Symbol.iterator]();
  return { formValues: ctl.map((c) => (/^(label|header|divider)$/.test(c.method) ? undefined : it.next().value)) };
}
// a pack item's component (bp/items/*.json in the request's files), for the use time of what is eaten
export function itemComp(files, id, comp) {
  if (!id) return undefined;
  for (const [f, body] of Object.entries(files ?? {})) { if (!/(^|\/)items\/.+\.json$/.test(f)) continue; try { const j = JSON.parse(body)['minecraft:item']; if (j?.description?.identifier === (id.includes(':') ? id : 'minecraft:' + id)) return j.components?.[comp]; } catch { /* not JSON */ } }
  return undefined;
}
// what one hit does with the item in hand (Bedrock's attack damage; a pack item's minecraft:damage); the fist: 1
const WEAPON = { wooden_sword: 5, golden_sword: 5, stone_sword: 6, iron_sword: 7, diamond_sword: 8, netherite_sword: 9, wooden_axe: 4, golden_axe: 4, stone_axe: 5, iron_axe: 6, diamond_axe: 7, netherite_axe: 8, trident: 9, mace: 6 };
export function weaponDamage(files, id) {
  if (!id) return 1;
  const own = itemComp(files, id, 'minecraft:damage');
  return typeof own === 'number' ? own + 1 : WEAPON[id.replace(/^minecraft:/, '')] ?? 1;
}
export function withJs(files, entry, list) {
  const AF = Object.getPrototypeOf(async function () {}).constructor;
  const body = (src) => { try { new AF(`return(${src}\n)`); return `return(${src}\n)`; } catch { const s2 = src.trimEnd().replace(/;$/, ''), i = s2.lastIndexOf(';'); if (i > 0) try { const t = `${s2.slice(0, i + 1)}return(${s2.slice(i + 1)}\n)`; new AF(t); return t; } catch { /* below */ } return src; } };   // (an expression; statements whose last one is an expression give its value, as helper.js does; else statements)
  const key = files[entry] !== undefined ? entry : entry.replace(/^scripts\//, ''), dir = path.posix.dirname(key);
  const mod = `import * as mc from "@minecraft/server";\nconst { world, system } = mc, dim = () => world.getDimension("overworld"), $ = {};\nconst p = (n) => (n ? world.getAllPlayers().find((x) => x.name === n) : world.getAllPlayers()[0]);\n${HELPER}`
    + `const F = [${list.map((s) => `async (dim) => { ${body(s)} }`).join(',\n')}];\n`   // (in a js line, dim is the overworld itself, as the lab's helper passes it)
    + 'system.afterEvents.scriptEventReceive.subscribe(async (e) => { if (e.id !== "lab:js") return; try { const r = await F[Number(e.message)](world.getDimension("overworld")); if (r !== undefined) console.warn(fmt(r)); } catch (x) { console.error("js: " + (x?.message ?? x)); } });\n';
  return { ...files, [path.posix.join(dir, '__labsim.js')]: mod, [key]: `${files[key] ?? ''}\nimport "./__labsim.js";\n` };
}
// the sandbox's report as the lines a real run prints
export function render(r, players, withTicks = false) {
  const out = [], rep = r.report ?? {};
  const fmtArg = (a) => (typeof a === 'string' ? JSON.stringify(a) : a && typeof a === 'object' && a.rawtext ? JSON.stringify(a.rawtext.map((x) => x.text ?? x.translate ?? '').join('')) : JSON.stringify(a));
  const ev = [];
  const plain = (t) => String(t ?? '').replace(/§./g, '');   // (the real client prints chat without § codes)
  // a message to everyone (world.sendMessage, /say) is one plain line, as BDS's console prints it (the lab drops each client's
  // identical echo); one to a player is @Name
  // a player's chat (sandbox-be marks it `chat: <sender>`) reaches every client as chat: `@B chat <A> hi`, one line per player as
  // the real client prints it (measured on BDS 1.26.52: "@A chat <A> hi there | @B chat <A> hi there"; scratch selftest filter)
  for (const c of rep.chat ?? []) { if (c.chat) for (const p of players) ev.push([c.tick, `@${p} chat ${plain(c.text)}`]); else if (c.to && players.includes(c.to)) ev.push([c.tick, `@${c.to} ${plain(c.text)}`]); else ev.push([c.tick, plain(c.text)]); }
  for (const l of rep.log ?? []) ev.push([l.tick, l.level === 'error' ? `E ${l.message}` : l.message]);
  for (const f of rep.forms ?? []) { if (!f.calls) continue; const kind = { ActionFormData: 'action', ModalFormData: 'modal', MessageFormData: 'message' }[f.kind] ?? f.kind; ev.push([f.tick, `@${f.to} form ${kind}: ${plain(f.calls.map((c) => `${c.method}(${c.args.length ? c.args.slice(0, 1).map(fmtArg).join(', ') : ''})`).join(' '))}`]); }   // (the real client prints forms without § codes too)
  for (const e of rep.effects ?? []) if (/^(title|actionbar)$/.test(e.kind) && e.text !== undefined) for (const p of e.to ? [e.to] : players) ev.push([e.tick, `@${p} ${e.kind === 'title' ? 'title' : 'actionbar'}: ${plain(e.text)}`]);
  if (r.fatal) ev.push([0, `E ${r.fatal.name}: ${r.fatal.message}`]);
  ev.sort((a, b) => a[0] - b[0]);
  if (withTicks) return ev;
  for (const [, l] of ev) out.push(l);
  return out;
}
export function judge(expects, lines) {
  const bad = [];
  for (const x of expects) {
    if (x.op === '=' && !lines.includes(x.text)) bad.push(`want = ${x.text}`);
    if (x.op === '!' && lines.includes(x.text)) bad.push(`want absent: ${x.text}`);
    let re = null; if (x.op === '~' || x.op === '!~') { try { re = new RegExp(x.text); } catch { bad.push(`bad regex ${x.text}`); continue; } }
    if (x.op === '~' && !lines.some((l) => re.test(l))) { const lm = literalMiss('~', x.text, lines); bad.push(`want ~ ${x.text}${lm ? `  (${lm})` : ''}`); }
    if (x.op === '!~' && lines.some((l) => re.test(l))) bad.push(`want absent ~ ${x.text}: ${lines.find((l) => re.test(l))}`);
  }
  // an E line nobody expected fails, as on the real server
  for (const l of lines.filter((l) => l.startsWith('E '))) if (!expects.some((x) => (x.op === '=' && x.text === l) || (x.op === '~' && (() => { try { return new RegExp(x.text).test(l); } catch { return false; } })()))) bad.push(`unexpected: ${l}`);
  return bad;
}

// a sandbox error's stack → the first frame in the unit's own source (not the kit, not the lab's), via the build's source map
export function srcWhere(dir) {
  const remap = remapper(path.join(TOP, 'bds', '.lab', 'maps', path.basename(dir) + '.json'));
  return (stack) => {
    for (const m of String(stack ?? '').matchAll(/\b(scripts\/[\w./-]+\.js:\d+)/g)) {
      const at = remap(m[1]);
      if (at === m[1] && !/\.js:\d+$/.test(at)) continue;
      if (/(^|\/)(kit\.[jt]s|__lab[\w.]*|lab_features\.js)(:|$)/.test(at)) continue;
      const fm = /^(.+):(\d+)$/.exec(at); let code = '';
      try { const f = path.join(dir, /^src\//.test(fm[1]) ? fm[1] : path.join('bp', fm[1])); code = fs.readFileSync(f, 'utf8').split('\n')[Number(fm[2]) - 1]?.trim() ?? ''; } catch { /* no source */ }
      return { at, code };
    }
    return null;
  };
}
export function throwsOf(r, where) {
  const res = [], seen = new Set();
  for (const l of r.report?.log ?? []) {
    if (l.level !== 'error') continue;
    const w = where(l.error?.stack), key = `${w?.at}|${l.error?.message ?? l.message}`;
    if (seen.has(key)) { res.forEach((t) => { if (t.key === key) t.also.push(`E ${l.message}`); }); continue; }
    seen.add(key); res.push({ key, line: `E ${l.message}`, at: w?.at, code: w?.code, also: [] });
  }
  // every E line of the same throw counts as shown
  return res.flatMap((t) => [t, ...t.also.map((line) => ({ ...t, line, dup: true }))]).map(({ key, also, ...t }) => t);
}
export async function simCmd(args, out = console.log) {
  if (!fs.existsSync(path.join(SBX, 'src', 'index.js'))) { out('ERR sim needs sandbox-be/ (the Script API sandbox) in this bds-lab folder'); return false; }
  const a = [...args], flag = (k) => { const i = a.indexOf(k); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const ticks = Number(flag('--ticks') || 0), json = a.includes('--json'), testsArg = flag('--tests');   // --tests <file>: another tests file (scratch check: hidden tests)
  // sim is a Script API sandbox: Endstone plugins (Python) and LeviLamina mods (LSE) are not Script API addons
  const kind = (process.env.LAB_KIND || (() => { try { return fs.readFileSync(path.join(TOP, '.lab-kind'), 'utf8').trim(); } catch { return 'bds'; } })()).replace(/[^a-z]/g, '');
  if (!a.includes('-a') && (kind === 'end' || kind === 'll')) { out(`ERR sim runs BDS Script API addons only; for ${kind === 'end' ? 'an Endstone plugin' : 'a LeviLamina mod'} \`go\` is the check (${kind === 'end' ? 'about 1 min' : 'about 2 min under Wine'}); between edits \`node lab.mjs check\` catches type errors in seconds`); return false; }
  const unit = flag('-a') ?? process.env.LAB_ADDON ?? (() => { try { return fs.readFileSync(path.join(TOP, 'bds', '.lab', 'addon'), 'utf8').trim(); } catch { return ''; } })();
  const dir = /[\\/]/.test(unit) ? path.resolve(unit) : path.join(TOP, 'bds', 'addons', unit);   // (a folder: any pack, tests)
  if (!unit || !fs.existsSync(path.join(dir, 'bp', 'manifest.json'))) { out(`ERR sim: no addon ${unit ? `"${unit}"` : '(node lab.mjs use <name>, or -a <name>)'} with bp/manifest.json in bds/addons`); return false; }
  // the scripts as `go` would load them (src/ built first)
  if (dir.startsWith(path.join(TOP, 'bds', 'addons') + path.sep) && (fs.existsSync(path.join(dir, 'src', 'main.ts')) || fs.existsSync(path.join(dir, 'src', 'main.js')))) {
    const b = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', 'build', '-a', path.basename(dir)], { cwd: TOP, encoding: 'utf8', env: { ...process.env, LAB_NOTRACE: '1' } });
    if (b.status !== 0) { ((b.stdout ?? '') + (b.stderr ?? '')).trim().split('\n').filter((l) => /^(E|ERR)/.test(l)).slice(0, 12).forEach((l) => out(l)); out('FAIL sim: the build failed (above)'); return false; }
  }
  const m = readJson(path.join(dir, 'bp', 'manifest.json'));
  const mod = (m.modules ?? []).find((x) => x.type === 'script');
  if (!mod?.entry) { out('OK sim: no script module (nothing for the sandbox to run)'); return true; }
  const files = {}; const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(p, r); else if (/\.(js|json)$/.test(e.name) && !/^__lab/.test(e.name)) files[`scripts/${r}`] = fs.readFileSync(p, 'utf8'); } };
  walk(path.join(dir, 'bp', 'scripts'), '');
  // the pack's .mcfunction files: `/function x` and `/schedule` read them in the sandbox
  const fwalk = (d, rel) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) fwalk(p, r); else if (e.name.endsWith('.mcfunction')) files[`functions/${r}`] = fs.readFileSync(p, 'utf8'); } };
  fwalk(path.join(dir, 'bp', 'functions'), '');
  // the pack's items / blocks / entities: their ids, components and custom components (`give @s ns:x`, hasitem, onUse ...)
  const dwalk = (d, rel) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = `${rel}/${e.name}`; if (e.isDirectory()) dwalk(p, r); else if (e.name.endsWith('.json')) files[r] = fs.readFileSync(p, 'utf8'); } };
  for (const k of ['items', 'blocks', 'entities', 'loot_tables']) dwalk(path.join(dir, 'bp', k), k);   // (loot_tables: what the pack's mobs drop)
  const api = readJson(path.join(SBX, 'data', 'script-api.json'));
  const { versions, notes } = pickVersions(m.dependencies ?? [], api);
  const { runSandbox } = await import(pathToFileURL(path.join(SBX, 'src', 'index.js')).href);
  const tf = testsArg ? path.resolve(process.env.LAB_CALLER_CWD ?? process.cwd(), testsArg) : path.join(dir, 'tests.txt');
  if (testsArg && !fs.existsSync(tf)) { out(`ERR sim --tests ${testsArg}: no such file`); return false; }
  const secs = fs.existsSync(tf) ? sections(fs.readFileSync(tf, 'utf8')) : [{ title: 'loads', lines: ['@A join', 'wait 1000'] }];
  const rows = []; const t0 = Date.now(), where = srcWhere(dir);
  // `@A join` prints `@A joined x y z` on the real server (realplayer.cjs), `@A already joined` when that player is in; the
  // sandbox's players are there from tick 0. Lines as [tick, line]
  const shown = (r, q) => [...q.joined.map((j) => { const l = j.at ? { x: j.at.x, y: -60, z: j.at.z } : q.req.players.find((x) => x.name === j.p)?.location ?? { x: 0, y: -60, z: 0 }; return [j.tick, j.again ? `@${j.p} already joined` : `@${j.p} joined ${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)}`]; }), ...render(r, q.req.players.map((p) => p.name), true)].sort((a, b) => a[0] - b[0]);
  // one sandbox run of a section (or of all of them merged); a button named by its text: read the form the first run showed,
  // then run again pressing that button
  // a `@A form <text>` line answers a form by what it says: the text (null for `close` and a number, which need no lookup)
  const formText = (l) => { const m = /^@\w+\s+form\s*(.*)$/.exec(l); if (!m) return undefined; const w = m[1].trim(); return w === 'close' || /^\d+$/.test(w) ? null : w; };
  const formsOf = (r) => (r.report?.forms ?? []).filter((f) => f.calls);
  const answer = (f, text) => { if (f?.kind === 'ModalFormData') return modalValues(f, text); const btns = (f?.calls ?? []).filter((c) => c.method === 'button').map((c) => String(c.args[0] ?? '')); const at = btns.findIndex((b) => b === text || b.includes(text)); return at >= 0 ? at : undefined; };
  const runPart = async (sec, opt) => {
    const prep = (q) => {   // a part after a restart: the world and the players as the server kept them
      if (opt.carry) {
        const carried = Object.entries(opt.carry.players).sort((a, b) => Number(a[1].id) - Number(b[1].id));
        const extra = q.req.players.filter((p) => !opt.carry.players[p.name]);
        let next = Math.max(-4294967296, ...carried.map(([, v]) => Number(v.id)));
        q.req.players = [...carried.map(([name, v]) => ({ name, op: true, ...v })), ...extra.map((p) => ({ ...p, id: String(++next) }))];
        q.req.world = opt.carry.world; if (opt.carry.clock) q.req.clock = opt.carry.clock;   // (the time runs on: Date where it was)
      }
      if (opt.more) q.req.carry = true;
      return q;
    };
    // opt.seed: the answers the same forms got when each section ran alone (a merged run then needs one run, not one per form);
    // kept only up to the first form this run shows differently (state an earlier section left can change a menu)
    let picks = opt.seed ? [...opt.seed] : [], waits = [], q = prep(toRequest(sec, { files, entry: mod.entry, versions, ticks, picks, sec0: opt.sec0, known: opt.known, waits }));
    if (q.skip) return { skip: q.skip };
    const texts = sec.lines.map(formText).filter((x) => x !== undefined);
    // `until`: the line it waits for may come later than 2 s (a 10 s timer). When a run does not show it within those 2 s, one
    // run with every until at its longest (10 s or its ms) shows when each one's line came, and the run that counts waits just
    // that long: what follows comes as soon as on the real server (later timing, cooldowns, stays right)
    const rx = (x) => { const k = /^\(\?i\)/.test(x); try { return new RegExp(k ? x.slice(4) : x, k ? 'i' : ''); } catch { return null; } };
    let r = await runSandbox(q.req);
    if (q.untils.length) {
      const ev0 = shown(r, q), late = q.untils.some((u, i) => { const re = rx(u.re), end = u.start + 40; return re && !ev0.some(([t0, line]) => t0 >= u.from && t0 < end && re.test(line)); });
      if (late) {
        const long = prep(toRequest(sec, { files, entry: mod.entry, versions, ticks, picks, sec0: opt.sec0, known: opt.known, waits: q.untils.map((u) => u.max) }));
        const ev = shown(await runSandbox(long.req), long);
        waits = long.untils.map((u) => { const re = rx(u.re), hit = re ? ev.find(([t0, line]) => t0 >= u.from && re.test(line)) : null; return hit ? Math.max(hit[0] - u.start + 2, 40) : u.max; });
        q = prep(toRequest(sec, { files, entry: mod.entry, versions, ticks, picks, sec0: opt.sec0, known: opt.known, waits }));
        r = await runSandbox(q.req);
      }
    }
    if (opt.seed) {
      const shown_ = formsOf(r), off = picks.findIndex((pk, i) => pk !== undefined && texts[i] != null && JSON.stringify(answer(shown_[i], texts[i])) !== JSON.stringify(pk));
      if (off >= 0) { picks = picks.slice(0, off); q = prep(toRequest(sec, { files, entry: mod.entry, versions, ticks, picks, sec0: opt.sec0, known: opt.known, waits })); r = await runSandbox(q.req); }
    }
    // one at a time, front to back: what a later form shows depends on the answers before it (a menu that opens a list)
    for (let k = 0; k < 8 && q.ui.some((u) => u.unresolved); k++) {
      const forms = formsOf(r), first = q.ui.findIndex((u) => u.unresolved);
      picks = q.ui.map((u, i) => { if (!u.unresolved) return picks[i] ?? u.selection; if (i !== first) return undefined; return answer(forms[i], u.text); });
      if (picks[first] === undefined) break;
      q = prep(toRequest(sec, { files, entry: mod.entry, versions, ticks, picks, sec0: opt.sec0, known: opt.known, waits })); r = await runSandbox(q.req);
    }
    if (q.ui.some((u) => u.unresolved)) return { skip: `a form button "${q.ui.find((u) => u.unresolved).text}" the sandbox did not show` };
    return { q, r, ev: shown(r, q), picks: texts.map((_, i) => picks[i]) };
  };
  // one section (or all of them merged): `restart` splits it into parts; each next part is a fresh load of the scripts (what
  // they held in memory is gone) in the world the last one left (saved properties, inventories, tags, blocks, scores), the
  // players rejoined, as on the real server. Ticks run on across the parts
  const runOne = async (sec, seed) => {
    const parts = [[]], seeds = [[]];
    let nf = 0;
    for (const l of sec.lines) { if (/^restart\b/.test(l.trim())) { parts.push([]); seeds.push([]); } else { parts.at(-1).push(l); if (formText(l) !== undefined) seeds.at(-1).push(seed?.[nf++]); } }
    let carry = null, off = 0, sec0 = 0, known = new Set();
    const all = { ev: [], log: [], expects: [], marks: [], unsupported: {}, inc: false, approx: false, picks: [] };
    for (const [n, lines] of parts.entries()) {
      const one = await runPart({ title: sec.title, lines }, { carry, sec0, known, more: n < parts.length - 1, seed: seed ? seeds[n] : null });
      if (one.skip) return one;
      all.picks.push(...one.picks);
      if (n > 0) for (const name of known) all.ev.push([off, `@${name} rejoined`]);
      all.ev.push(...one.ev.map(([t, l]) => [t + off, l]));
      all.log.push(...(one.r.report?.log ?? []).map((l) => ({ ...l, tick: (l.tick ?? 0) + off })));
      all.expects.push(...one.q.expects); all.marks.push(...one.q.marks.map((m) => ({ ...m, tick: m.tick + off })));
      Object.assign(all.unsupported, one.r.report?.unsupported ?? {});
      all.inc ||= one.r.verdict === 'inconclusive'; all.approx ||= one.q.approx;
      if (n < parts.length - 1) {
        carry = one.r.report?.carry;
        if (!carry) return { skip: 'restart (the sandbox gave no state to restart from)' };
        known = new Set(Object.keys(carry.players)); sec0 = all.marks.at(-1)?.sec ?? sec0;
        off += (one.r.report?.ticks ?? one.q.req.limits.ticks) + 20;
      }
    }
    const report = { log: all.log, unsupported: all.unsupported };
    return { q: { expects: all.expects, marks: all.marks, approx: all.approx }, r: { verdict: all.inc ? 'inconclusive' : 'ok', report }, ev: all.ev.sort((a, b) => a[0] - b[0]), picks: all.picks };
  };
  // each section alone first (what it can do, whether it touched what the sandbox has not measured); they share nothing, so
  // side by side (each sandbox run is its own process)
  const alone = new Array(secs.length);
  { let next = 0; const lane = async () => { while (next < secs.length) { const i = next++; alone[i] = await runOne(secs[i]); } }; await Promise.all(Array.from({ length: Math.max(1, Math.min(4, os.availableParallelism?.() ?? os.cpus().length, secs.length)) }, lane)); }
  for (const [i, sec] of secs.entries()) {
    const a = alone[i];
    if (a.skip) { rows.push({ title: sec.title, status: 'SKIP', why: a.skip }); continue; }
    // inconclusive = it touched something the sandbox has not measured: what it did see still counts when it is what the
    // test wants; a miss is only UNSURE then
    const lines = a.ev.map(([, l]) => l), bad = judge(a.q.expects, lines), inc = a.r.verdict === 'inconclusive' || a.q.approx;
    rows.push({ title: sec.title, status: bad.length ? (inc ? 'UNSURE' : 'FAIL') : 'PASS', bad, lines, unsupported: Object.keys(a.r.report?.unsupported ?? {}), inc, threw: throwsOf(a.r, where) });
  }
  // then as the real test runs them: one world, the sections in order, what one leaves behind (cooldowns, saved data, items,
  // scores, players already in) seen by the next. That result is the verdict; a section that passes alone but not after the
  // ones before it says so (the cause is state an earlier section left)
  const idx = secs.map((s, i) => i).filter((i) => !alone[i].skip);
  if (idx.length > 1) {
    const seed = idx.flatMap((i) => secs[i].lines.filter((l) => formText(l) !== undefined).map((_, k) => alone[i].picks?.[k]));
    const m = await runOne({ title: '(all)', lines: idx.flatMap((i) => [`\u0001${i}`, ...secs[i].lines]) }, seed);
    if (!m.skip) {
      const marks = m.q.marks, skippedBefore = (i) => secs.slice(0, i).some((_, k) => alone[k].skip);
      marks.forEach((mk, j) => {
        const from = j === 0 ? -Infinity : mk.tick, to = marks[j + 1]?.tick ?? Infinity, i = mk.sec, row = rows[i];
        const lines = m.ev.filter(([t]) => t >= from && t < to).map(([, l]) => l);
        const bad = judge(m.q.expects.filter((x) => x.sec === i), lines);
        const threw = throwsOf({ report: { log: (m.r.report?.log ?? []).filter((l) => (l.tick ?? 0) >= from && (l.tick ?? 0) < to) } }, where);
        const was = row.status;
        const inc = row.inc || skippedBefore(i);   // (an earlier section the sandbox could not run: its state is missing here)
        Object.assign(row, { status: bad.length ? (inc ? 'UNSURE' : 'FAIL') : 'PASS', bad, lines, threw, inc, alone: was === 'PASS' && bad.length > 0 });
        if (row.alone && skippedBefore(i)) row.alone = false;
      });
    }
  }
  if (json) { out(JSON.stringify({ unit, versions, notes, rows, ms: Date.now() - t0 })); return !rows.some((x) => x.status === 'FAIL'); }
  // the sandbox stood in for a version it does not have (a beta, or newer than its game): a failure may be the sandbox's own
  const unsure = notes.length > 0;
  if (unsure) for (const x of rows) if (x.status === 'FAIL') x.status = 'UNSURE';
  const cut = (l) => (l.length > 160 ? l.slice(0, 160) + '…' : l);
  for (const x of rows) {
    if (x.status === 'PASS') out(`✔ ${x.title}`);
    else if (x.status === 'UNSURE') { out(`? ${x.title}${x.inc ? ' (it touched what the sandbox has not measured)' : ''}`); x.bad.slice(0, 2).forEach((b) => out(`  ${cut(b)}`)); }
    else if (x.status === 'SKIP') out(`- ${x.title} (skipped: ${x.why})`);
    else {
      // a script error: where in the unit's own source it threw (no `why` needed to find the line); its E lines are not repeated
      const thrown = new Set(x.threw.map((t) => t.line)), bad = x.bad.filter((b) => !thrown.has(b.replace(/^unexpected: /, '')));
      out(`✘ ${x.title}`); bad.slice(0, 4).forEach((b) => out(`  ${cut(b)}`));
      for (const t of x.threw.filter((t) => !t.dup).slice(0, 2)) out(`  threw ${t.at ? `${t.at} ` : ''}${cut(t.line.replace(/^E (\S+: )?/, ''))}${t.code ? `  |  ${cut(t.code)}` : ''}`);
      const rest = x.lines.filter((l) => !thrown.has(l)), cnt = new Map(); for (const l of rest) cnt.set(l, (cnt.get(l) ?? 0) + 1);
      const rep = [...cnt].filter(([, c]) => c >= 3).map(([l]) => l), uniq = [...new Set(rest.filter((l) => cnt.get(l) < 3))];   // (a line repeated every second: once, with its count, after the others)
      (rest.length ? [...uniq.slice(-6), ...rep.map((l) => `${l} ×${cnt.get(l)}`)].slice(-8) : ['(no output)']).forEach((l) => out(`  got ${cut(l)}`));
      if (x.alone) out('  (passes on its own: a section before it left state behind (a cooldown, saved data, items, scores); the real test runs them in one world too)');
      if (x.threw.length) out(`  (values at that line: node lab.mjs why "${x.title}")`); if (x.unsupported.length) out(`  (the sandbox does not have: ${x.unsupported.slice(0, 4).join(', ')}: a FAIL here may be the sandbox's; go decides)`); }
  }
  const n = (s) => rows.filter((x) => x.status === s).length;
  out(`${n('FAIL') ? 'FAIL' : n('UNSURE') ? 'UNSURE' : 'PASS'} sim ${n('PASS')}/${rows.length - n('SKIP')}${n('UNSURE') ? `, ${n('UNSURE')} unsure` : ''}${n('SKIP') ? `, ${n('SKIP')} skipped` : ''} in ${((Date.now() - t0) / 1000).toFixed(1)}s (sandbox, game ${api.game}${notes.length ? `; ${notes.join('; ')}` : ''}): a hint, \`go\` on the real server decides`);
  return !n('FAIL');
}
