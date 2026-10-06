// node lab.mjs gaps [-a <unit>]: the code no test runs, and the test lines that would run it. The handlers of the unit's code
// are found in the source (kit cmd/onItem/onBlock/menu buttons, Script API subscriptions, custom component registrations,
// intervals, plain functions), so each never-run line comes with what triggers it: `src/main.ts:11-15 never ran: onUse of
// lab:wand → give A lab:wand 1 · @A select lab:wand · @A use`. One server run (test --cov). mutate and why use the same map.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** the text with strings, template literals and comments blanked (same length, newlines kept): brackets of code only */
export function maskAll(t) {
  let o = '', st = 'c', q = '';
  const tpl = [];   // template literal nesting: code depth when a ${ opened
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i], n = t[i + 1];
    if (st === 'c') {
      if (c === '/' && n === '/') { st = 'l'; o += '  '; i++; continue; }
      if (c === '/' && n === '*') { st = 'b'; o += '  '; i++; continue; }
      if (c === '"' || c === "'") { st = 's'; q = c; o += c; continue; }
      if (c === '`') { st = 't'; o += c; continue; }
      if (c === '{') depth++;
      if (c === '}') { if (tpl.length && depth === tpl.at(-1)) { tpl.pop(); st = 't'; o += ' '; continue; } depth--; }
      o += c; continue;
    }
    if (c === '\n') { o += '\n'; if (st === 'l' || st === 's') st = 'c'; continue; }
    if (st === 'l') { o += ' '; continue; }
    if (st === 'b') { if (c === '*' && n === '/') { st = 'c'; o += '  '; i++; } else o += ' '; continue; }
    if (c === '\\') { o += n === '\n' ? ' \n' : '  '; i++; continue; }
    if (st === 's') { if (c === q) { st = 'c'; o += c; } else o += ' '; continue; }
    if (st === 't') { if (c === '`') { st = 'c'; o += c; } else if (c === '$' && n === '{') { tpl.push(depth); st = 'c'; o += '  '; i++; } else o += ' '; continue; }
  }
  return o;
}
const CLOSE = { '(': ')', '{': '}', '[': ']' };
/** the index of the bracket closing the one at `i` (masked text), or the end */
export function closeOf(m, i) {
  const st = [];
  for (let k = i; k < m.length; k++) {
    const c = m[k];
    if (CLOSE[c]) st.push(CLOSE[c]);
    else if (c === ')' || c === '}' || c === ']') { if (st.pop() !== c) return k; if (!st.length) return k; }
  }
  return m.length - 1;
}
const S = (id) => (id.startsWith('minecraft:') ? id.slice(10) : id);
export const EVENTS = {
  playerSpawn: '@A join', playerJoin: '@B join', playerLeave: '@B join · @B leave', chatSend: '@A chat hi', itemUse: 'give A ender_pearl 1 · @A select ender_pearl · @A use',
  itemCompleteUse: 'give A bread 1 · @A select bread · @A eat', itemStartUse: 'give A bow 1 · give A arrow 8 · @A select bow · @A use', itemReleaseUse: 'give A bow 1 · give A arrow 8 · @A select bow · @A use',
  playerInteractWithBlock: 'setblock 1 -60 1 chest · @A useon 1 -60 1', playerInteractWithEntity: 'summon villager 2 -60 2 · @A interact villager',
  entityHitEntity: 'summon pig 2 -60 2 · @A attack pig', entityHurt: 'summon pig 2 -60 2 · @A attack pig', entityHitBlock: 'setblock 1 -60 1 dirt · @A dig 1 -60 1',
  entityDie: 'summon pig 2 -60 2 · kill @e[type=pig]', entitySpawn: 'summon pig 2 -60 2', entityRemove: 'summon pig 2 -60 2 · kill @e[type=pig]', entityLoad: 'summon pig 2 -60 2',
  playerBreakBlock: 'setblock 1 -60 1 dirt · @A dig 1 -60 1', playerPlaceBlock: 'give A dirt 1 · @A place dirt 1 -60 1', buttonPush: 'setblock 1 -60 1 stone_button · @A useon 1 -60 1',
  leverAction: 'setblock 1 -60 1 lever · @A useon 1 -60 1', pressurePlatePush: 'setblock 1 -60 1 stone_pressure_plate · @A goto 1 1', tripWireTrip: 'setblock 1 -60 1 tripwire · @A goto 1 1',
  effectAdd: 'effect A speed 5', weatherChange: 'weather rain', gameRuleChange: 'gamerule dodaylightcycle true', explosion: 'summon tnt 3 -60 3 · wait 4500',
  projectileHitEntity: 'summon pig 4 -60 0 · give A snowball 4 · @A select snowball · @A use', projectileHitBlock: 'give A snowball 4 · @A select snowball · @A use',
  playerDimensionChange: 'execute in the_end run tp A 0 64 0', scriptEventReceive: 'scriptevent lab:x hi', playerInventoryItemChange: 'give A dirt 1',
  playerHotbarSelectedSlotChange: 'give A dirt 1 · @A select dirt', playerGameModeChange: 'gamemode creative A', playerEmote: '@A emote', targetBlockHit: 'setblock 3 -60 0 target · give A snowball 4 · @A select snowball · @A use',
  dataDrivenEntityTrigger: 'summon <entity> 2 -60 2 · event entity @e[type=<entity>] <event>', worldLoad: '(at startup)', startup: '(at startup)', worldInitialize: '(at startup)', playerButtonInput: '@A jump',
};
const ITEM_HOOK = { onUse: '@A use', onUseOn: '@A useon 1 -60 1', onConsume: '@A eat', onCompleteUse: '@A eat', onHitEntity: 'summon pig 2 -60 2 · @A attack pig', onBeforeDurabilityDamage: 'summon pig 2 -60 2 · @A attack pig', onMineBlock: 'setblock 1 -60 1 dirt · @A dig 1 -60 1' };
const BLOCK_HOOK = { onPlayerInteract: 'setblock 1 -60 1 <id> · @A useon 1 -60 1', onPlace: 'give A <id> 1 · @A place <id> 1 -60 1', onPlayerBreak: 'setblock 1 -60 1 <id> · @A dig 1 -60 1', onPlayerDestroy: 'setblock 1 -60 1 <id> · @A dig 1 -60 1',
  onStepOn: 'setblock 1 -61 1 <id> · @A goto 1 1', onStepOff: 'setblock 1 -61 1 <id> · @A goto 1 1 · @A goto 4 4', onTick: 'setblock 1 -60 1 <id> · wait 2000', onRandomTick: 'gamerule randomtickspeed 4096 · setblock 1 -60 1 <id> · wait 3000',
  onEntityFallOn: 'setblock 1 -61 1 <id> · tp A 1 -50 1 · wait 1500', onBreak: 'setblock 1 -60 1 <id> · setblock 1 -60 1 air', onRedstoneUpdate: 'setblock 1 -60 1 <id> · setblock 2 -60 1 redstone_block', onBeforePlayerPlace: 'give A <id> 1 · @A place <id> 1 -60 1' };
const ARG = { int: '1', float: '1.5', string: 'x', bool: 'true', player: 'A', entity: '@e[type=pig]', loc: '1 -60 1', item: 'diamond', block: 'stone' };
/** the handlers of one source file: [{ from, to (line numbers), what, how }] */
export function handlers(text) {
  const m = maskAll(text), res = [], lineAt = (() => { const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1); return (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const md = (lo + hi + 1) >> 1; if (starts[md] <= pos) lo = md; else hi = md - 1; } return lo + 1; }; })();
  const add = (a, b, what, how) => res.push({ from: lineAt(a), to: lineAt(b), what, how, size: b - a });
  const str = (i) => /^\s*['"]([^'"]*)['"]/.exec(text.slice(i))?.[1];
  const methods = (open, id, table, kind) => {   // the methods of an object literal { onUse(e) {...}, onPlace: (e) => {...} }
    const end = closeOf(m, open);
    for (const x of m.slice(open + 1, end).matchAll(/(?:^|[,{\s])(\w+)\s*(?::\s*(?:async\s*)?(?:function\s*)?\(|\()/g)) {
      const at = open + 1 + x.index + x[0].indexOf(x[1]), body = m.indexOf('{', at), b = body > 0 && body < end ? closeOf(m, body) : at;
      if (table[x[1]]) add(at, b, `${x[1]} of ${id}`, kind === 'item' ? `give A ${S(id)} 1 · @A select ${S(id)} · ${table[x[1]]}` : table[x[1]].replace(/<id>/g, S(id)));
    }
  };
  for (const x of m.matchAll(/\b(cmd|cmdAny)\s*\(/g)) {
    const open = x.index + x[0].length - 1, id = str(open + 1); if (!id) continue;
    const end = closeOf(m, open), spec = /\{([^{}]*)\}/.exec(text.slice(open, end))?.[1] ?? '';
    const args = [...spec.matchAll(/(['"]?)(\w+)(\??)\1\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)].filter((a) => !a[3]).map((a) => (a[4].startsWith('[') ? /['"]([^'"]*)['"]/.exec(a[4])?.[1] ?? 'x' : ARG[a[4].slice(1, -1)] ?? 'x'));
    // a command that shows a form: the code after it runs once the form is answered
    const form = /\b(menu|ask|confirm|input)\s*\(|\.show\s*\(/.test(m.slice(open, end)) ? ' · until form · @A form 0' : '';
    add(x.index, end, `/${id}`, `@A cmd /${id}${args.length ? ' ' + args.join(' ') : ''}${form}`);
  }
  for (const x of m.matchAll(/\b(onItem|onBlock)\s*\(/g)) {
    const open = x.index + x[0].length - 1, id = str(open + 1), obj = m.indexOf('{', open);
    if (id && obj > 0 && obj < closeOf(m, open)) methods(obj, id, x[1] === 'onItem' ? ITEM_HOOK : BLOCK_HOOK, x[1] === 'onItem' ? 'item' : 'block');
  }
  for (const x of m.matchAll(/\b(item|block)ComponentRegistry\s*\.\s*registerCustomComponent\s*\(/g)) {
    const open = x.index + x[0].length - 1, id = str(open + 1), obj = m.indexOf('{', open);
    if (id && obj > 0 && obj < closeOf(m, open)) methods(obj, id, x[1] === 'item' ? ITEM_HOOK : BLOCK_HOOK, x[1]);
  }
  for (const x of m.matchAll(/\b(world|system)\s*\.\s*(afterEvents|beforeEvents)\s*\.\s*(\w+)\s*\.\s*subscribe\s*\(/g)) add(x.index, closeOf(m, x.index + x[0].length - 1), `${x[2] === 'beforeEvents' ? 'before ' : ''}${x[3]}`, EVENTS[x[3]] ?? `(${x[3]}: help verbs <word>)`);
  for (const x of m.matchAll(/\b(system\s*\.\s*runInterval|every)\s*\(/g)) add(x.index, closeOf(m, x.index + x[0].length - 1), 'an interval', 'wait 2000');
  for (const x of m.matchAll(/\bsystem\s*\.\s*run(Timeout|Job)?\s*\(/g)) add(x.index, closeOf(m, x.index + x[0].length - 1), 'later (system.run)', 'wait 1000');
  for (const x of m.matchAll(/\bready\s*\(/g)) add(x.index, closeOf(m, x.index + x[0].length - 1), 'ready()', '(at startup)');
  // menu(p, 'T', [['Label', fn], ...]): each button's fn is reached by pressing it
  for (const x of m.matchAll(/\bmenu\s*\(/g)) {
    const open = x.index + x[0].length - 1, end = closeOf(m, open); let arr = -1, d = 0;
    for (let k = open + 1; k < end; k++) { const c = m[k]; if (c === '(' || c === '{') d++; else if (c === ')' || c === '}') d--; else if (c === '[' && d === 0) { arr = k; break; } }
    if (arr < 0) continue;
    let k = arr + 1, idx = 0;
    while (k < closeOf(m, arr)) { const el = m.indexOf('[', k); if (el < 0 || el > closeOf(m, arr)) break; const e = closeOf(m, el); add(el, e, `button ${idx} of a menu`, `(open the menu) · @A form ${idx}`); res.at(-1).button = idx; idx++; k = e + 1; }
  }
  // a menu's button inside what opens it (a command, an item, an event): the whole way there
  for (const b of res.filter((h) => h.button !== undefined)) {
    const opener = res.filter((h) => h !== b && h.button === undefined && h.from <= b.from && b.to <= h.to && !h.how.startsWith('(')).sort((a, c) => a.size - c.size)[0];
    if (opener) b.how = `${opener.how.replace(/ · until form · @A form 0$/, '')} · until form · @A form ${b.button}`;
  }
  for (const x of m.matchAll(/\bfunction\s+(\w+)\s*\(|\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^()]*\)|\w+)\s*(?::\s*[\w<>[\]|, ]+)?\s*=>/g)) {
    const body = m.indexOf('{', x.index + x[0].length - 1), nl = m.indexOf('\n', x.index + x[0].length);
    const end = body > 0 && (body < nl || nl < 0) ? closeOf(m, body) : nl < 0 ? m.length : nl;
    add(x.index, end, `${x[1] ?? x[2]}()`, `(call ${x[1] ?? x[2]}(): what in the addon calls it?)`);
  }
  return res;
}
/** the innermost handler of a line */
export const ownerOf = (hs, line) => hs.filter((h) => h.from <= line && line <= h.to).sort((a, b) => a.size - b.size)[0] ?? null;
/** COV 26% ... | src/main.ts 7/13 never ran: 4-5,9 | ... → Map(file → [lines]) */
export function neverRan(cov) {
  const res = new Map();
  for (const x of String(cov).matchAll(/\| (\S+) \d+\/\d+ never ran: ([\d,-]+)/g)) { const ls = []; for (const r of x[2].split(',')) { const [a, b = a] = r.split('-').map(Number); for (let i = a; i <= b; i++) ls.push(i); } res.set(x[1], ls); }
  return res;
}
const ranges = (ls) => { const r = []; for (const l of [...new Set(ls)].sort((a, b) => a - b)) { const last = r.at(-1); if (last && l === last[1] + 1) last[1] = l; else r.push([l, l]); } return r.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(','); };
/** the never-run lines of the unit's own code grouped by handler: [{ file, lines, what, how }] (the kit and blank/closing lines left out) */
export function explain(unit, cov) {
  const out = [];
  for (const [file, ls] of neverRan(cov)) {
    if (/(^|\/)kit\.[jt]s$|lab_features\.js$|__lab/.test(file)) continue;
    let text; try { text = fs.readFileSync(path.join(unit, file), 'utf8'); } catch { continue; }
    const src = text.split('\n'), hs = /\.py$/.test(file) ? pyHandlers(src) : handlers(text), groups = new Map();
    for (const l of ls) {
      if (!/\S/.test(src[l - 1] ?? '') || /^\s*[\])};,]+\s*$/.test(src[l - 1])) continue;
      const h = ownerOf(hs, l), k = h ? `${h.what}\u0000${h.how}` : '\u0000';
      (groups.get(k) ?? groups.set(k, []).get(k)).push(l);
    }
    for (const [k, lines] of groups) { const [what, how] = k.split('\u0000'); out.push({ file, lines, at: `${file}:${ranges(lines)}`, what: what || 'top level', how: how || '(runs at load: nothing ran it?)' }); }
  }
  return out;
}
// Python (Endstone): the def a line is in, and what calls it: on_command → the command (and the branch's name when the line is
// under `if command.name == "x"` / `args[0] == "x"`), @event_handler → that event, else the function
function pyHandlers(src) {
  const res = [], ind = (l) => /^\s*/.exec(l)[0].length;
  for (let i = 0; i < src.length; i++) {
    const m = /^(\s*)def\s+(\w+)\s*\(([^)]*)/.exec(src[i]); if (!m) continue;
    const d = m[1].length; let end = i + 1; while (end < src.length && (!/\S/.test(src[end]) || ind(src[end]) > d)) end++;
    const ev = /@event_handler/.test(src[i - 1] ?? '') ? /:\s*(\w+Event)\b/.exec(m[3])?.[1] : null;
    const what = m[2] === 'on_command' ? 'on_command' : ev ? `@event_handler ${m[2]}` : `def ${m[2]}`;
    const how = m[2] === 'on_command' ? 'a command (a @A cmd /<name> line for that branch)' : ev ? `the ${ev} (do what sets it off in a section)` : `whatever calls ${m[2]}()`;
    res.push({ from: i + 1, to: end, what, how, d, size: end - i });
    // branches inside on_command / a command method: `if command.name == "report"` → that command
    if (m[2] === 'on_command') for (let j = i + 1; j < end; j++) { const b = /^\s*(?:if|elif)\s+.*==\s*["']([\w-]+)["']/.exec(src[j]); if (!b) continue; const bd = ind(src[j]); let e2 = j + 1; while (e2 < end && (!/\S/.test(src[e2]) || ind(src[e2]) > bd)) e2++; res.push({ from: j + 1, to: e2, what: `on_command "${b[1]}"`, how: `@A cmd /${b[1]} ... (or that argument)`, d: bd + 1, size: e2 - j }); }
  }
  return res;
}
export const line = (g) => `${g.at} never ran: ${g.what} → ${g.how}`;

export async function gapsCmd(args, out = console.log) {
  const CP = await import('./checkpoint.mjs');
  const k = CP.labKind(), u = CP.currentUnit(k, args), dir = CP.unitDir(k, u);
  const r = spawnSync(process.execPath, [path.join(CP.TOP, k, 'lab.mjs'), 'test', '--cov', '-a', u], { cwd: path.join(CP.TOP, k), encoding: 'utf8', maxBuffer: 256e6, timeout: 30 * 60_000, env: { ...process.env, LAB_NOTRACE: '1', FORCE_COLOR: '0', LAB_NO_LASTFAIL: '1' } });
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n'), cov = lines.find((l) => l.startsWith('COV ')) ?? '';
  if (!cov) { lines.filter((l) => /^(✘|E |FAIL)/.test(l)).slice(0, 8).forEach((l) => out(l)); out(`FAIL gaps ${u}: no coverage (the tests must run: node lab.mjs go)`); return false; }
  const g = explain(dir, cov);
  g.slice(0, 20).forEach((x) => out(`S ${line(x)}`));
  if (g.length > 20) out(`S … +${g.length - 20}`);
  out(`${g.length ? 'W' : 'OK'} gaps ${u}: ${/^COV (\d+%)/.exec(cov)?.[1] ?? '?'} of the code lines ran${g.length ? `; ${g.length} place(s) no test reaches: a ## section with the → lines (and its expectations) each` : ''}${r.status === 0 ? '' : ' (some tests fail: node lab.mjs go)'}`);
  return !g.length;
}
