// What a Script API addon gets wrong that the type checker does not see, found in the source before any server runs
// (preflight: E/W lines) or as advice (go's QA: S lines). Each finding is a line number and one sentence with the fix.
//   early     world.<method>() at the top level: it throws while the world loads (early execution)
//   before    a change to the world directly inside a world.beforeEvents handler: read-only there, it throws when it fires
//   review    a subscription or an interval started inside a handler (one more each time it runs), entities scanned or a
//             dynamic property written every tick, data keyed by player name (names change)
import { maskAll, closeOf } from './gaps.mjs';

const lines = (t) => { const s = [0]; for (let i = 0; i < t.length; i++) if (t[i] === '\n') s.push(i + 1); return (p) => { let lo = 0, hi = s.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m] <= p) lo = m; else hi = m - 1; } return lo + 1; }; };
const depths = (m) => { const d = new Int32Array(m.length + 1); let k = 0; for (let i = 0; i < m.length; i++) { const c = m[i]; if (c === ')' || c === '}' || c === ']') k--; d[i] = k; if (c === '(' || c === '{' || c === '[') k++; } return d; };
/** function bodies inside [a, b): [[from, to]] (arrows with a block or an expression, function expressions) */
function fnSpans(m, a, b) {
  const res = [];
  for (const x of m.slice(a, b).matchAll(/=>\s*|\bfunction\b[^{]*/g)) {
    const at = a + x.index + x[0].length;
    if (m[at] === '{') res.push([at, closeOf(m, at)]);
    else if (x[0].startsWith('=>')) { let k = at, d = 0; for (; k < b; k++) { const c = m[k]; if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) { if (d === 0) break; d--; } else if ((c === ',' || c === ';') && d === 0) break; } res.push([at, k]); }
  }
  return res;
}
const WRITES = /\.\s*(setBlockType|setType|setPermutation|runCommand|runCommandAsync|addEffect|kill|remove|teleport|tryTeleport|applyDamage|applyKnockback|applyImpulse|spawnEntity|spawnItem|addItem|setItem|setOnFire|setGameMode|addExperience|addLevels|triggerEvent|fillBlocks|addScore|setScore|addTag)\s*\(/g;   // (addScore setScore addTag: refused there, measured by skills/probes/before-readonly; setDynamicProperty and sendMessage are allowed)
const ONCE = /\b(?:world\s*\.\s*afterEvents\s*\.\s*worldLoad|system\s*\.\s*beforeEvents\s*\.\s*startup|world\s*\.\s*afterEvents\s*\.\s*worldInitialize)\s*\.\s*subscribe\s*\(|\bready\s*\(/g;
const HANDLER = /\b(?:world|system)\s*\.\s*(?:afterEvents|beforeEvents)\s*\.\s*\w+\s*\.\s*subscribe\s*\(|\bcmd(?:Any)?\s*\(|\bon(?:Item|Block)\s*\(|\bsystem\s*\.\s*runInterval\s*\(|\bevery\s*\(/g;

/** [{ line, kind: 'early' | 'before' | 'review', msg }] for one source file (TypeScript or JavaScript) */
export function lintScript(text) {
  const m = maskAll(text), at = lines(text), d = depths(m), res = [];
  const imported = /import\s*\{[^}]*\bworld\b[^}]*\}\s*from\s*['"]@minecraft\/server['"]/.test(text);
  // early: world.x(...) at the top level (not in a function, not in an arrow expression on that line)
  if (imported) for (const x of m.matchAll(/\bworld\s*\.\s*(\w+)\s*(?:\(|\.\s*\w+\s*\()/g)) {
    if (d[x.index] !== 0 || /^(afterEvents|beforeEvents)$/.test(x[1])) continue;
    const ln = at(x.index), start = m.lastIndexOf('\n', x.index) + 1;
    if (/=>|\bfunction\b/.test(m.slice(start, x.index))) continue;
    res.push({ line: ln, kind: 'early', msg: `world.${x[1]} at the top level throws while the world loads (early execution): do it in world.afterEvents.worldLoad.subscribe(() => ...) or kit ready(() => ...)` });
  }
  // before: a write directly in a world.beforeEvents handler (not in a function it defines, not after an await)
  for (const x of m.matchAll(/\bworld\s*\.\s*beforeEvents\s*\.\s*(\w+)\s*\.\s*subscribe\s*\(/g)) {
    const open = x.index + x[0].length - 1, end = closeOf(m, open), fns = fnSpans(m, open, end);
    const cb = fns[0]; if (!cb) continue;
    const inner = fnSpans(m, cb[0] + 1, cb[1]).concat([...m.slice(cb[0], cb[1]).matchAll(/\bsystem\s*\.\s*run\w*\s*\(/g)].map((y) => [cb[0] + y.index, closeOf(m, cb[0] + y.index + y[0].length - 1)]));
    const firstAwait = m.slice(cb[0], cb[1]).search(/\bawait\b/);
    for (const w of m.slice(cb[0], cb[1]).matchAll(WRITES)) {
      const p = cb[0] + w.index;
      if (inner.some(([a, b]) => p > a && p < b) || (firstAwait >= 0 && cb[0] + firstAwait < p)) continue;
      res.push({ line: at(p), kind: 'before', msg: `.${w[1]}() inside world.beforeEvents.${x[1]}: the world is read-only there and it throws when the event fires: system.run(() => { ... })` });
    }
  }
  // review: subscriptions / intervals started inside a handler (not one that runs once), every-tick scans and writes, names as keys
  const onceAt = new Set([...m.matchAll(ONCE)].map((x) => x.index)), clears = /\bclearRun\s*\(/.test(m);
  const hs = [...m.matchAll(HANDLER)].filter((x) => !onceAt.has(x.index)).map((x) => ({ open: x.index + x[0].length - 1, end: closeOf(m, x.index + x[0].length - 1) }));
  for (const x of m.matchAll(/\.\s*subscribe\s*\(|\bsystem\s*\.\s*runInterval\s*\(/g)) {
    const open = x.index + x[0].length - 1, isSub = x[0].includes('subscribe');
    if (!hs.some((h) => h.open !== open && open > h.open && open < h.end) || (!isSub && clears)) continue;
    res.push({ line: at(x.index), kind: 'review', msg: isSub ? 'subscribes inside a handler: each time that runs, one more subscriber (the code then runs twice, three times...): subscribe once at the top level' : 'starts an interval inside a handler and nothing clears it: one more each time (system.clearRun it, or start it once)' });
  }
  for (const x of m.matchAll(/\b(?:system\s*\.\s*runInterval|every)\s*\(/g)) {
    const open = x.index + x[0].length - 1, end = closeOf(m, open), call = text.slice(open, end + 1);
    const ticks = x[0].startsWith('every') ? Number(/^\(\s*(\d+)/.exec(call)?.[1] ?? 1) : Number(/,\s*(\d+)\s*\)\s*$/.exec(call)?.[1] ?? 1);
    if (ticks >= 20) continue;
    if (/\bgetEntities\s*\(/.test(m.slice(open, end))) res.push({ line: at(x.index), kind: 'review', msg: `scans entities every ${ticks === 1 ? 'tick' : ticks + ' ticks'}: heavy with many mobs; every 10-20 ticks, or keep the ones you need` });
    if (/\bsetDynamicProperty\s*\(/.test(m.slice(open, end))) res.push({ line: at(x.index), kind: 'review', msg: `writes a dynamic property every ${ticks === 1 ? 'tick' : ticks + ' ticks'} (saved each time): keep it in memory, save every few seconds or on change` });
  }
  for (const x of text.matchAll(/\bsetDynamicProperty\s*\(\s*(?:`[^`]*\$\{[^}]*\.name\}|[^,)]*\.name\b)/g)) res.push({ line: at(x.index), kind: 'review', msg: 'keys saved data by player name (a player can change it): use player.id' });
  // what crashes for a real player and not in a test that sets things up first (skills rules, by id)
  if (!/\bhasParticipant\s*\(/.test(m)) for (const x of m.matchAll(/\.\s*getScore\s*\(/g)) { if (/\btry\b/.test(m.slice(Math.max(0, x.index - 200), x.index))) continue; res.push({ line: at(x.index), kind: 'review', msg: 'getScore throws "Failed to resolve identity" for a player with no score yet (a new player): o.hasParticipant(p) ? o.getScore(p) : 0 (api-score-identity)' }); }
  for (const x of m.matchAll(/\.\s*show\s*\([^()]*\)\s*\.\s*then\s*\(\s*(?:async\s*)?\(?\s*(\w+)/g)) {
    const open = m.indexOf('(', x.index + x[0].indexOf('then')), body = m.slice(open, closeOf(m, open));
    if (new RegExp(`\\b${x[1]}\\s*\\.\\s*(selection|formValues)\\b`).test(body) && !/\bcanceled\b/.test(body)) res.push({ line: at(x.index), kind: 'review', msg: `a closed form (Esc) gives ${x[1]}.canceled with selection / formValues undefined: if (${x[1]}.canceled) return; first (api-form-cancel)` });
  }
  // (a Map / Set nothing adds to or deletes from is a fixed table, not state: `const FISH = new Set(['minecraft:cod', …])`)
  if (!/\b(setDynamicProperty|save)\s*\(/.test(m)) for (const x of m.matchAll(/^(?:const|let|var)\s+(\w+)\s*=\s*new\s+(Map|Set)\s*\(/gm)) if (new RegExp(`\\b${x[1]}\\s*\\.\\s*(add|set|delete|clear)\\s*\\(`).test(m)) res.push({ line: at(x.index), kind: 'review', msg: `${x[1]} (a ${x[2]}) is all the addon keeps and nothing is saved: it is empty after a restart or /reload; keep it in dynamic properties (api-state-persist)` });
  return res.filter((r, i, a) => a.findIndex((y) => y.line === r.line && y.msg === r.msg) === i).sort((a, b) => a.line - b.line);
}
