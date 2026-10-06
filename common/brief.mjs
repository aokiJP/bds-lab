// A person's addon, read without running it (import / brief): what it is, the ways into it (events, commands, chat words,
// items it reacts to, script events) with file:line, and a draft tests.txt that runs each way in once, so one `go` shows
// every path that crashes instead of one per round. Static (regexes over the scripts and the pack JSON): a hint for the AI
// that saves it reading every file, never a verdict (go decides).
import fs from 'node:fs';
import path from 'node:path';

const CODE = /\.[cm]?[jt]s$/;
const walk = (d, acc = []) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return acc; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|\.lab)$/.test(e.name)) walk(p, acc); } else acc.push(p); } return acc; };
const json = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, '')); } catch { return null; } };
const uniq = (a) => [...new Set(a)];

/** the scripts the addon runs: src/ (TypeScript, built) or bp/scripts; not the lab's kit or its own injected files */
export function scriptFiles(dir) {
  const base = fs.existsSync(path.join(dir, 'src')) ? path.join(dir, 'src') : path.join(dir, 'bp', 'scripts');
  return walk(base).filter((f) => CODE.test(f) && !/\.d\.ts$/.test(f) && !/(^|[\\/])(kit\.[jt]s|__lab[\w.]*|lab_features\.js|e\.js|r\.js)$/.test(f));
}

/** the ways into the addon, found in its code and pack */
export function surface(dir) {
  const rel = (f) => path.relative(dir, f).split(path.sep).join('/');
  const s = { files: [], lines: 0, minified: false, events: [], commands: [], chat: [], scriptevents: [], items: [], components: [], forms: 0, runCommands: [], dynamic: false, pack: { items: [], blocks: [], entities: [], comps: {} } };
  for (const f of scriptFiles(dir)) {
    const text = fs.readFileSync(f, 'utf8'), ls = text.split('\n'), r = rel(f);
    s.files.push(r); s.lines += ls.length;
    if (ls.some((l) => l.length > 2000)) s.minified = true;
    ls.forEach((l, i) => {
      const at = `${r}:${i + 1}`;
      for (const m of l.matchAll(/\b(afterEvents|beforeEvents)['"]?\]?\s*(?:\.\s*|\[\s*['"])(\w+)['"]?\]?\s*(?:\.\s*|\[\s*['"])subscribe\b/g)) s.events.push({ name: `${m[1] === 'beforeEvents' ? 'before.' : ''}${m[2]}`, at });   // (also minified: no world./system. before it)
      // custom commands: kit cmd('ns:x', ...), customCommandRegistry.registerCommand({ name: 'ns:x' ... })
      // (kit's parameters, when they are on that line: { n: 'int', 'mode?': ['a','b'], who: 'player' } → sample arguments)
      for (const m of l.matchAll(/\bcmd(?:Any)?\(\s*['"`]([\w-]+:[\w-]+)['"`]\s*(?:,\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*\{([^}]*)\})?/g)) s.commands.push({ name: m[1], at, args: sampleArgs(m[2]) });
      for (const m of l.matchAll(/\bname\s*:\s*['"`]([\w-]+:[\w-]+)['"`]/g)) if (/registerCommand|registerEnum|CustomCommand/.test(text)) s.commands.push({ name: m[1], at });
      // chat words the code compares the message with: message === "!home", .startsWith("!tp")
      if (/message|msg|chat|text/i.test(l)) for (const m of l.matchAll(/(?:===?|startsWith\(|case)\s*['"`]([!./#$%&?+\-][\w-]*)/g)) s.chat.push({ word: m[1], at });
      for (const m of l.matchAll(/\bid\s*===?\s*['"`]([\w-]+:[\w-]+)['"`]/g)) if (/scriptEventReceive/.test(text)) s.scriptevents.push({ id: m[1], at });
      for (const m of l.matchAll(/typeId\s*[!=]==?\s*['"`]([\w-]+:[\w./-]+)['"`]/g)) s.items.push({ id: m[1], at });
      // custom components (kit onItem/onBlock, or the registries): a way in through an item or block that carries it; its hooks
      // (onUse, onPlayerInteract ...) from the object that follows, as far as it reads plainly
      for (const m of l.matchAll(/\b(?:(onItem|onBlock)|(item|block)ComponentRegistry\.registerCustomComponent)\(\s*['"`]([\w-]+:[\w-]+)['"`]/g)) {
        // the object literal after the name, to its closing brace (not the next registration's hooks)
        const after = ls.slice(i, i + 60).join('\n').slice(m.index + m[0].length), open = after.indexOf('{');
        let end = after.length; if (open >= 0) for (let k = open, dep = 0; k < after.length; k++) { if (after[k] === '{') dep++; else if (after[k] === '}' && --dep === 0) { end = k; break; } }
        const hooks = open < 0 ? [] : uniq([...after.slice(open, end).matchAll(/\b(on[A-Z]\w+)\s*(?:\(|:)/g)].map((x) => x[1])).slice(0, 6);
        s.components.push({ kind: (m[1] ?? m[2]).toLowerCase().includes('item') ? 'item' : 'block', name: m[3], at, hooks });
      }
      if (/new\s+(Action|Modal|Message)FormData\b/.test(l)) s.forms++;
      for (const m of l.matchAll(/\.runCommand(?:Async)?\(\s*['"`]([^'"`]{1,80})['"`]/g)) s.runCommands.push({ cmd: m[1], at });
      if (/\b[sg]etDynamicProperty\b|\bsave\(|\bload\(/.test(l)) s.dynamic = true;
    });
  }
  // a chat prefix ("!") with sub-commands compared one by one (const cmd = args[0]; cmd === "sethome"): the words a player types
  // are the prefix + each name ("!sethome"); the bare "!" alone is not a way in
  const bare = s.chat.filter((c) => c.word.length === 1);
  if (bare.length) {
    const subs = [];
    for (const f of scriptFiles(dir)) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { for (const m of l.matchAll(/(?:\b(?:cmd|command|sub|action|name|args\[0\]|parts\[0\]|word)\s*===?\s*|\bcase\s+)['"`]([a-z][\w-]{1,20})['"`]/gi)) subs.push({ word: m[1], at: `${rel(f)}:${i + 1}` }); });
    if (subs.length) { s.chat = s.chat.filter((c) => c.word.length > 1); for (const p of new Set(bare.map((b) => b.word))) for (const x of subs) s.chat.push({ word: p + x.word, at: x.at }); }
  }
  for (const [k, key] of [['items', 'minecraft:item'], ['blocks', 'minecraft:block'], ['entities', 'minecraft:entity']]) {
    for (const f of walk(path.join(dir, 'bp', k)).filter((x) => x.endsWith('.json'))) {
      const j = json(f)?.[key], id = j?.description?.identifier; if (!id) continue;
      s.pack[k].push(id);
      // which custom component each item / block carries (in its components or any permutation's): the way to reach that code
      const keys = [...Object.keys(j.components ?? {}), ...(j.permutations ?? []).flatMap((p) => Object.keys(p.components ?? {}))];
      for (const c of keys.filter((x) => !x.startsWith('minecraft:'))) (s.pack.comps[c] ??= []).push(id);
      for (const c of [].concat(j.components?.['minecraft:custom_components'] ?? [])) if (typeof c === 'string') (s.pack.comps[c] ??= []).push(id);
    }
  }
  // an item the code reacts to: one of the pack's or a vanilla one compared in itemUse / itemUseOn handlers
  s.items = s.items.filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
  return s;
}

// file:line,line (one file named once): main.js:10,15 other.js:3
// a value of each mandatory kit parameter type (the optional ones left out): what a player would type
const SAMPLE = { int: '1', float: '1.5', string: 'test', bool: 'true', player: '@s', entity: '@s', loc: '~ ~ ~', item: 'apple', block: 'stone' };
function sampleArgs(spec) {
  if (!spec) return '';
  return [...spec.matchAll(/(['"]?)(\w+)(\??)\1\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)].filter((x) => !x[3]).map((x) => (x[4].startsWith('[') ? (/['"]([^'"]*)['"]/.exec(x[4])?.[1] ?? '') : SAMPLE[x[4].slice(1, -1)] ?? '')).join(' ').trim();
}
const at = (xs, n = 4) => { const by = new Map(); for (const x of xs) { const [, f, ln] = /^(?:bp\/scripts\/|src\/)?(.*):(\d+)$/.exec(x.at) ?? [, x.at, '']; (by.get(f) ?? by.set(f, []).get(f)).push(ln); } return [...by].slice(0, n).map(([f, ls]) => `${f}:${uniq(ls).slice(0, 4).join(',')}`).join(' '); };

/** a tests.txt that runs each way in once (an unexpected E line fails its section): one go shows every crash */
export function draftTests(s) {
  const out = ['# draft from the addon\'s code (node lab.mjs import): each section runs one way in once; a crash there fails it.',
    '# Under each, add what the request wants (= ~ ! !~); drop what the request does not need.', '## loads', '@A join', 'js 1+1', '= 2'];
  const sec = (title, lines) => out.push('', `## ${title}`, ...lines, 'wait 500');
  for (const c of s.commands.filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i)) sec(`/${c.name} runs`, [`@A cmd /${c.name}${c.args ? ' ' + c.args : ''}`]);
  for (const w of uniq(s.chat.map((x) => x.word))) sec(`chat ${w} runs`, [`@A chat ${w}`]);
  for (const id of uniq(s.scriptevents.map((x) => x.id))) sec(`scriptevent ${id} runs`, [`scriptevent ${id}`]);
  const used = s.events.some((e) => /^(before\.)?(itemUse|itemStartUse|itemCompleteUse|itemReleaseUse)$/.test(e.name)), usedOn = s.events.some((e) => /itemUseOn|playerInteractWithBlock/.test(e.name));
  for (const { id } of s.items.filter((x) => !/^minecraft:(player|item|air)$/.test(x.id) && !s.pack.entities.includes(x.id) && !s.pack.blocks.includes(x.id))) {
    if (used) sec(`using ${id} runs`, [`give A ${id}`, 'wait 300', `@A select ${id}`, '@A use', ...(s.forms ? ['until form 3000', '@A form close'] : [])]);   // (a form it opens: closed, as players do)
    else if (usedOn) sec(`using ${id} on a block runs`, [`give A ${id}`, 'wait 300', `@A select ${id}`, '@A useon 0 -61 2']);
  }
  // each custom component through the first item / block that carries it, the way a player meets it
  for (const c of s.components.filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i)) {
    const id = (s.pack.comps[c.name] ?? [])[0]; if (!id) continue;
    const h = new Set(c.hooks);
    if (c.kind === 'item') {
      const act = h.has('onConsume') ? '@A eat' : h.has('onUseOn') && !h.has('onUse') ? '@A useon 0 -61 2' : '@A use';
      sec(`${c.name} on ${id} runs`, [`give A ${id}`, 'wait 300', `@A select ${id}`, act, ...(s.forms ? ['until form 3000', '@A form close'] : [])]);
    } else {
      const lines = [`setblock 2 -60 2 ${id}`, 'wait 300'];
      if (h.has('onPlayerInteract') || !c.hooks.length) lines.push('@A useon 2 -60 2');
      if (h.has('onStepOn') || h.has('onStepOff')) lines.push('setblock 4 -61 4 ' + id, 'tp A 4.5 -60 4.5', 'wait 300', 'tp A 0 -60 0');
      if (h.has('onPlayerBreak') || h.has('onPlayerDestroy')) lines.push('@A dig 2 -60 2');
      if (h.has('onPlace')) lines.push(`give A ${id}`, 'wait 300', `@A place ${id} 3 -60 3`);
      sec(`${c.name} on ${id} runs`, lines);
    }
  }
  if (s.events.some((e) => /playerSpawn|playerJoin/.test(e.name))) sec('a second player joins', ['@B join']);
  if (s.events.some((e) => /playerLeave/.test(e.name))) sec('a player leaves', ['@B leave']);
  if (s.events.some((e) => /entityDie|entityHurt|entityHitEntity/.test(e.name))) sec('a mob is hit and dies', ['summon pig 2 -60 2', 'wait 300', '@A attack pig', 'kill @e[type=pig]']);
  if (s.events.some((e) => /playerBreakBlock|playerPlaceBlock/.test(e.name))) sec('a block is placed and broken', ['give A dirt', 'wait 300', '@A place dirt 2 -60 2', '@A dig 2 -60 2']);
  return out.join('\n') + '\n';
}

/** the brief: what it is and the ways in, one screen */
export function briefLines(dir, s, { name, mods = [], audit = null } = {}) {
  const L = [];
  const mf = (k) => json(path.join(dir, k, 'manifest.json'));
  const bp = mf('bp'), rp = mf('rp'), v = (h) => (Array.isArray(h?.version) ? h.version.join('.') : h?.version ?? '?');
  L.push(`addon ${name}: bp "${String(bp?.header?.name ?? '?').replace(/§./g, '')}" ${v(bp?.header)}${rp ? ` + rp "${String(rp.header?.name ?? '?').replace(/§./g, '')}"` : ''} · scripts ${s.files.length} file(s), ${s.lines} lines${s.minified ? ' (minified: read the brief, not the files)' : ''}${s.pack.items.length + s.pack.blocks.length + s.pack.entities.length ? ` · pack: ${[...s.pack.items, ...s.pack.blocks, ...s.pack.entities].slice(0, 8).join(' ')}` : ''}`);
  if (mods.length) L.push(`modules: ${mods.map((m) => `${m.name} ${m.want}${m.ok ? '' : ` ✗ not in this BDS (it has ${m.has.join(' ')})`}`).join(' · ')}`);
  const ways = [];
  if (s.commands.length) ways.push(`commands ${uniq(s.commands.map((x) => '/' + x.name)).join(' ')} (${at(s.commands)})`);
  if (s.chat.length) ways.push(`chat words ${uniq(s.chat.map((x) => x.word)).join(' ')} (${at(s.chat)})`);
  if (s.scriptevents.length) ways.push(`scriptevent ${uniq(s.scriptevents.map((x) => x.id)).join(' ')}`);
  if (s.items.length) ways.push(`items it checks ${s.items.map((x) => x.id).slice(0, 6).join(' ')} (${at(s.items)})`);
  if (s.components.length) ways.push(`custom components ${uniq(s.components.map((c) => `${c.name} (${c.kind}${(s.pack.comps[c.name] ?? []).length ? ' ' + s.pack.comps[c.name].slice(0, 2).join(' ') : ': no item/block carries it'}${c.hooks.length ? ': ' + c.hooks.join(' ') : ''})`)).join(' ')} (${at(s.components)})`);
  if (ways.length) L.push(`ways in: ${ways.join(' · ')}`);
  if (s.events.length) { const by = new Map(); for (const e of s.events) (by.get(e.name) ?? by.set(e.name, []).get(e.name)).push(e); L.push(`events: ${[...by].slice(0, 14).map(([n, es]) => `${n} ${at(es, 2)}`).join(' · ')}${by.size > 14 ? ` … +${by.size - 14}` : ''}`); }
  const misc = [];
  if (s.forms) misc.push(`${s.forms} form(s)`);
  if (s.runCommands.length) misc.push(`runs commands: ${s.runCommands.slice(0, 4).map((x) => `"${x.cmd}" ${x.at.replace(/^(bp\/scripts|src)\//, '')}`).join(', ')}`);
  misc.push(s.dynamic ? 'saves data (dynamic properties)' : 'saves nothing (all state is lost on restart/reload)');
  L.push(misc.join(' · '));
  if (audit) for (const a of audit) L.push(a);
  return L;
}
