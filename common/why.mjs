// node lab.mjs why [-a <unit>] ["<## section>"]: a failing section taken apart, so the cause is read, not guessed.
// One run (with the sections before it, as the test runs them) with every throw stopped and printed with its local values,
// every Script API event and which lines ran. Printed: what failed and what came instead; where it threw (the unit's own line,
// the code around it, the values); else the line that printed what came instead and the line that would print what the test
// wants (did it run?); the events; the handlers the section uses that never ran; the next step. When nothing threw, a second
// run stops at the line that printed what came instead and shows the values there. No title: the first section that failed.
import fs from 'node:fs';
import path from 'node:path';
import * as CP from './checkpoint.mjs';
import { trial, sectionsOf, SCRIPT_ERR } from './trial.mjs';
import { handlers, ownerOf, neverRan } from './gaps.mjs';
import { RUNTIME_HINTS } from './api-hints.mjs';

const NOISE = /^(EV |ST |X |T\d+ |trace |events (on|off)|states (on|off)|cov( on)?$|COV |PROF |PERF )/;
// the lab's own files in the addon copy (the helper that records what players see): never where the unit's bug is
const LABF = /(^|\/)(__lab[\w.]*|lab_features\.js|e\.js|r\.js)$/;
const own = (f) => !!f && !LABF.test(f) && /\.[cm]?[jt]s$/.test(f);
const kitf = (f) => /(^|\/)kit\.[jt]s$/.test(f);
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** the unit's own script files as [rel, text] (src/ for TypeScript, else bp/scripts; not the kit, not the lab's) */
export function sources(dir) {
  const base = fs.existsSync(path.join(dir, 'src')) ? 'src' : 'bp/scripts', res = [];
  const walk = (d) => { let es = []; try { es = fs.readdirSync(path.join(dir, d), { withFileTypes: true }); } catch { return; }
    for (const e of es) { const r = `${d}/${e.name}`; if (e.isDirectory()) { if (!/^(node_modules|lib)$/.test(e.name)) walk(r); } else if (/\.[cm]?[jt]s$/.test(e.name) && !/\.d\.ts$|^kit\.[jt]s$|^lab_features|^__lab/.test(e.name)) { const f = path.join(dir, r); if (fs.statSync(f).size < 300_000) res.push([r, fs.readFileSync(f, 'utf8')]); } } };
  walk(base);
  return res;
}
/** the string and template literals of one source line: [{ parts, tpl }] (a template's parts are the text between its ${...}) */
export function literals(line) {
  const res = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '"' || c === "'") {
      let j = i + 1, t = '';
      for (; j < line.length && line[j] !== c; j++) { if (line[j] === '\\') { t += line[j + 1] ?? ''; j++; } else t += line[j]; }
      if (t.replace(/\s/g, '').length >= 4) res.push({ parts: [t], tpl: false });
      i = j; continue;
    }
    if (c === '`') {
      const parts = ['']; let j = i + 1;
      for (; j < line.length && line[j] !== '`'; j++) {
        if (line[j] === '\\') { parts[parts.length - 1] += line[j + 1] ?? ''; j++; }
        else if (line[j] === '$' && line[j + 1] === '{') { let d = 1, k = j + 2; for (; k < line.length && d; k++) { if (line[k] === '{') d++; else if (line[k] === '}') d--; } parts.push(''); j = k - 1; }
        else parts[parts.length - 1] += line[j];
      }
      if (j >= line.length) break;   // a template over several lines: left out
      if (parts.join('').replace(/\s/g, '').length >= 3) res.push({ parts, tpl: true });
      i = j;
    }
  }
  return res;
}
/** what a printed line says, as texts a literal could have made: the line, the message without `@A ` / `title: `, form texts */
export function textsOf(l) {
  const t = String(l), res = [t], m = /^@\w+ (?:(?:title|subtitle|actionbar): )?(.*)$/.exec(t);
  if (m) res.push(m[1]);
  if (/^@\w+ form /.test(t)) for (const x of t.matchAll(/"((?:[^"\\]|\\.)*)"/g)) res.push(x[1]);
  return [...new Set(res.map((x) => x.replace(/§./g, '')))].filter(Boolean);
}
/** the source lines that can print one of `texts`, best first: [{ at, file, line, code, score }] (a template that makes the
 *  whole text beats a string inside it; the longer the fixed text, the better) */
export function printers(files, texts) {
  const res = [];
  for (const [file, src] of files) src.split('\n').forEach((code, i) => {
    let best = 0;
    for (const lit0 of literals(code)) {
      // as the game shows it: colour codes gone, the line's trailing spaces trimmed (texts are the same)
      const lit = { ...lit0, parts: lit0.parts.map((x, k, a) => { const y = x.replace(/§./g, ''); return k === a.length - 1 ? y.replace(/\s+$/, '') : y; }) };
      const fixed = lit.parts.join('').length;
      if (!fixed) continue;
      const tt = texts.map((t) => t.replace(/\s+$/, ''));
      if (lit.tpl ? tt.some((t) => new RegExp('^' + lit.parts.map((x) => esc(x).replace(/\s+/g, '\\s*')).join('[\\s\\S]*?') + '\\s*$').test(t)) : tt.some((t) => t.includes(lit.parts[0]))) best = Math.max(best, (lit.tpl || tt.includes(lit.parts[0]) ? 1000 : 0) + fixed);
    }
    if (best) res.push({ at: `${file}:${i + 1}`, file, line: i + 1, code: code.trim(), score: best });
  });
  return res.sort((a, b) => b.score - a.score);
}
/** the text an expectation wants, as far as it can be told without matching the regex: = text, ~ a simple regex unescaped */
export function wantText(op, v) {
  if (op === '=') return v;
  if (op !== '~') return null;
  const t = v.replace(/^\(\?i\)/, '').replace(/^\^/, '').replace(/\$$/, '').replace(/\\d\+?|\[0-9\]\+?/g, '1').replace(/\.[*+?]\??/g, '').replace(/\\(.)/g, '$1');
  return /[|[\]{}]|\(\?/.test(t) ? null : t;
}
/** one script error line with the frames printed under it: { msg, at (the unit's own line), via (the frames), lab (only the lab's own code is named) } */
export function errorOf(all, i) {
  const l = all[i], m = /^E (.*?)(?: \(([^()\s]+)\))?$/.exec(l) ?? [l, l.slice(2)];
  const frames = [];
  for (let j = i + 1; j < all.length && /^\s+\S/.test(all[j]); j++) { const f = /^\s+at (\S+?:\d+)/.exec(all[j]); if (f) frames.push(f[1]); }
  const where = [m[2], ...frames].filter((f) => f && /:\d+$/.test(f) && own(f.replace(/:\d+$/, '')));
  const at = where.find((f) => !kitf(f.replace(/:\d+$/, ''))) ?? where[0] ?? '';
  return { msg: m[1].trim(), at, via: where.filter((f) => f !== at).slice(0, 3), lab: !at && !!m[2] && LABF.test(m[2]) };
}

export function dossier(dir, title, sectionText, r, extra = {}) {
  const res = [], out = (x) => res.push(x), i0 = r.segs.findIndex((g) => g.cmd === 'trace err'), segs = i0 >= 0 ? r.segs.slice(i0) : r.segs, all = segs.flatMap((g) => g.out);
  const files = extra.files ?? sources(dir), cov = all.find((l) => l.startsWith('COV ')) ?? '', never = neverRan(cov);
  const ran = (at) => { const [f, n] = [at.replace(/:\d+$/, ''), Number(/:(\d+)$/.exec(at)?.[1])]; return never.has(f) ? !never.get(f).includes(n) : cov ? true : null; };
  // what failed: the test's ✘ blocks of this section; got = what came from that command on (async output lands later)
  const blocks = r.lines.join('\n').split(/\n(?=✘ |E |SECTION |PASS |FAIL |fixed since)/).filter((b) => b.startsWith('✘ ') && b.includes(`## ${title} >`));
  const fails = []; let absentAt = null;
  for (const b of blocks.slice(0, 3)) {
    const [head, want] = b.split('\n'), cmd = head.replace(/^✘ \d+: ## .*? > /, ''), wm = /^\s*want (!~|[=~!]) (.*)$/.exec(want ?? ''), k = segs.findLastIndex((g) => g.cmd === cmd);
    // from that command on (async output lands later), but not the next js lines' values (only what a player saw there)
    const mine = (k >= 0 ? segs.slice(k) : segs).flatMap((g, j) => (j > 0 && /^js\b/.test(g.cmd ?? '') ? g.out.filter((x) => /^@/.test(x)) : g.out));
    const pool = mine.filter((x) => !NOISE.test(x) && !/^(E |\s)/.test(x) && !/^Item custom component|^Debugger/.test(x));
    const pre = wm ? /^\^?(@?\w+ [^\s\\(]+)/.exec(wm[2])?.[1] : null;
    const got = [...pool.filter((x) => pre && x.startsWith(pre)), ...pool.filter((x) => !pre || !x.startsWith(pre))].filter((x, j, a) => a.indexOf(x) === j);
    fails.push({ cmd, op: wm?.[1], v: wm?.[2], got, line: Number(/^✘ (\d+):/.exec(head)?.[1]), show: `✘ ${cmd}  ${want?.trim() ?? ''}  |  got ${got.length ? got.slice(0, 4).join(' | ') : '(nothing)'}` });
  }
  // the run under trace err judges each line when it comes, and a stop at a caught throw can make a reply land after its
  // section was judged: a presence check the dump shows met is a timing artifact, not the cause. Judged again on everything
  // the commands printed (the dump), and an absence check (! !~) a printed line breaks is the real failure (it pointed the
  // AI at the wrong line: "came instead" for a line that was there)
  {
    const pool = segs.flatMap((g) => g.out).filter((x) => !NOISE.test(x) && !/^(E |\s)/.test(x));
    const rx = (v) => { const i = /^\(\?i\)/.test(v); try { return new RegExp(i ? v.slice(4) : v, i ? 'i' : ''); } catch { return null; } };
    const hit = (op, v) => (op === '=' || op === '!' ? pool.find((x) => x === v) : pool.find((x) => rx(v)?.test(x)));
    for (let j = fails.length - 1; j >= 0; j--) if ((fails[j].op === '=' || fails[j].op === '~') && hit(fails[j].op, fails[j].v)) fails.splice(j, 1);
    const absent = sectionText.split('\n').map((l) => /^\s*(!~|!)\s?(.*)$/.exec(l)).filter(Boolean).map((m) => ({ op: m[1], v: m[2], got: hit(m[1], m[2]) })).filter((x) => x.got);
    for (const f of fails) out(f.show);
    if (!fails.length && absent.length) {
      const a = absent[0], p = printers(files, textsOf(a.got));
      fails.push({ cmd: '', op: a.op, v: a.v, got: [a.got], line: 0 });
      out(`printed what the test says must not appear: "${a.got}" (want ${a.op} ${a.v})${p.length ? `, by ${p[0].at}: ${p[0].code.slice(0, 150)}` : ''}`);
      if (p.length) absentAt = { ...p[0], text: a.got };
    }
  }
  // where it threw: trace err's X lines (the unit's own frames, with the local values), else the script error lines
  // (trace err also stops at throws the code catches, and at the async machinery's own: those count only next to an E line,
  // or as the one caught throw shown when nothing else failed)
  const xs = [], thrown = [], core = (x) => x.replace(/^(Unhandled promise rejection|Uncaught):\s*/i, '');
  for (const l of all) { const m = /^X (\S+:\d+) (.*)$/.exec(l); if (m && own(m[1].replace(/:\d+$/, ''))) { const [msg, ...vars] = m[2].split(' | '); if (!xs.some((t) => t.at === m[1] && t.msg === msg)) xs.push({ at: m[1], msg, vars: vars.join(' '), via: [] }); } }
  all.forEach((l, i) => { if (!SCRIPT_ERR.test(l)) return; const e = errorOf(all, i); if (thrown.some((t) => core(t.msg) === core(e.msg) && t.at === e.at)) return;
    const x = xs.find((y) => (e.at && y.at === e.at) || core(y.msg) === core(e.msg)); thrown.push({ at: e.at || x?.at || '', msg: e.msg, vars: x?.vars ?? '', via: e.via, lab: e.lab && !x }); });
  if (!thrown.length) { const x = xs.find((y) => !kitf(y.at.replace(/:\d+$/, ''))); if (x) thrown.push({ ...x, caught: true }); }
  for (const t of thrown.slice(0, 2)) {
    out(`${t.caught ? 'caught (the code catches it; was that meant?)' : 'threw'} ${t.at ? t.at + ' ' : ''}${t.msg}${t.via.length ? `  (via ${t.via.join(' ← ')})` : ''}`);
    if (t.vars) out(`  values: ${t.vars.length > 220 ? t.vars.slice(0, 220) + '…' : t.vars}`);
    const [f, n] = [t.at.replace(/:\d+$/, ''), Number(/:(\d+)$/.exec(t.at)?.[1])];
    try { const src = fs.readFileSync(path.join(dir, f), 'utf8').split('\n'); for (let k = Math.max(1, n - 2); k <= Math.min(src.length, n); k++) out(`  ${k === n ? '>' : ' '}${String(k).padStart(4)}| ${src[k - 1].slice(0, 160)}`); } catch { /* no source there */ }
  }
  // nothing threw: the line that printed what came instead, and the one that would print what the test wants
  let pAt = null, wAt = null;
  const f0 = fails.find((x) => x.op === '=' || x.op === '~');
  if (!thrown.length && f0) {
    const gotLine = f0.got.find((x) => printers(files, textsOf(x)).length), p = gotLine ? printers(files, textsOf(gotLine)) : [];
    if (p.length) { pAt = { ...p[0], text: gotLine }; out(`came instead: "${gotLine}", printed by ${p[0].at}${p[1] && p[1].score === p[0].score ? ` (or ${p[1].at})` : ''}: ${p[0].code.slice(0, 150)}`); }
    if (extra.values) out(`  values there: ${extra.values}`);
    const wt = wantText(f0.op, f0.v), w = wt ? printers(files, textsOf(wt)) : [];
    if (w.length && w[0].at !== pAt?.at) { wAt = { ...w[0], ran: ran(w[0].at) }; out(`would print what the test wants: ${w[0].at} ${wAt.ran === false ? '(never ran in this section)' : wAt.ran ? '(it ran)' : ''}: ${w[0].code.slice(0, 150)}`); }
  }
  // the events the addon received meanwhile
  const ev = new Map(); for (const l of all) { const m = /^EV (\S+)/.exec(l); if (m) ev.set(m[1], (ev.get(m[1]) ?? 0) + 1); }
  if (ev.size) out(`events: ${[...ev].slice(0, 10).map(([k, n]) => `${k.replace(/^after\./, '')}${n > 1 ? ` ×${n}` : ''}`).join(', ')}${ev.size > 10 ? ', …' : ''}`);
  else if (i0 >= 0) out('events: none reached the addon');
  // handlers the section uses (its command, its item, its event) that did not run in it
  const idle = [];
  // `@A join` for a player already in (an earlier section joined them; the test runs in one world) is no join: spawn/join
  // handlers rightly do not run then
  const joins = segs.filter((g) => /^@\w+ join\b/.test(g.cmd ?? '')), rejoinOnly = joins.length > 0 && joins.every((g) => g.out.some((l) => /already joined/.test(l)));
  for (const [file, ls] of never) {
    if (kitf(file) || LABF.test(file)) continue;
    let text; try { text = fs.readFileSync(path.join(dir, file), 'utf8'); } catch { continue; }
    const hs = handlers(text), seen = new Set(), nv = new Set(ls), src = text.split('\n');
    for (const l of ls) { const h = ownerOf(hs, l); if (!h || seen.has(h)) continue; seen.add(h);
      const body = []; for (let k = h.from + 1; k < h.to; k++) if (/\w/.test(src[k - 1] ?? '')) body.push(k);
      if (!body.length || body.some((k) => !nv.has(k))) continue;   // some of it ran: it was not skipped
      const id = /(?:of |\/)([\w-]+:[\w-]+)/.exec(h.what)?.[1], first = h.how.split(' · ').at(-1);
      if (rejoinOnly && /^@\w+ join$/.test(first ?? '')) continue;
      if ((id && sectionText.includes(id)) || (!id && first && !first.startsWith('(') && sectionText.includes(first.split(' ').slice(0, 2).join(' ')))) idle.push(`${h.what} (${file}:${h.from}-${h.to})`); }
  }
  if (idle.length) out(`did not run although the section uses it: ${idle.slice(0, 4).join(', ')}`);
  // an item/block hook that never ran: does that item/block carry the component? (the usual cause)
  const hook = idle.map((x) => /^on\w+ of ([\w-]+:[\w-]+)/.exec(x)?.[1]).find(Boolean);
  let missing = null;
  if (hook) for (const [d, key] of [['items', 'minecraft:item'], ['blocks', 'minecraft:block']]) {
    let fsx = []; try { fsx = fs.readdirSync(path.join(dir, 'bp', d)).filter((f) => f.endsWith('.json')); } catch { /* none */ }
    for (const f of fsx) { let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, 'bp', d, f), 'utf8'))[key]; } catch { continue; } if (j?.description?.identifier !== hook) continue; const c = j.components ?? {}; if (!(hook in c) && !(c['minecraft:custom_components'] ?? []).includes(hook)) missing = `bp/${d}/${f}: add "${hook}": {} to its components (the hook runs only for an item/block that has it)`; }
  }
  // the likely next step
  const t = thrown.find((x) => !x.lab && !x.caught) ?? thrown.find((x) => !x.caught), undef = t && /(\w+)=undefined\b/.exec(t.vars)?.[1], rh = t && RUNTIME_HINTS.find(([re]) => re.test(t.msg))?.[1];
  out(`next: ${t ? (t.lab && !t.at ? `${t.msg.replace(/\s*\(.*$/, '')}: the call that failed is in the lab's recorder, so it came from your code calling it at a bad time${rh ? ': ' + rh : ''}`
    : /cannot read property|of undefined|of null/.test(t.msg) && undef ? `${undef} is undefined at ${t.at}: check it before use (an empty slot, a missing component, a player who left give undefined)`
      : rh ? `${t.at ? t.at + ': ' : ''}${rh}${/not a function|has no/.test(t.msg) ? ' (beta-only? node lab.mjs mode beta)' : ''}`
        : `fix the throw at ${t.at || 'the first E line'} (the values above are what the code had)`)
    : missing ?? (idle.length ? `${idle[0]} never ran: is its component ("ns:x": {} in the item/block json) / event really there, and does the test do what triggers it?`
      : absentAt ? `${absentAt.at} printed what must not appear: the condition that leads there (on that line or above) lets this case through`
      : pAt ? `${pAt.at} printed it${wAt ? ` instead of ${wAt.at}${wAt.ran === false ? ' (never ran)' : ' (ran too)'}` : ''}: ${wAt?.ran === false ? `the condition that chose ${pAt.at} (on that line or above) is wrong for the values there, or the data it reads is` : 'check the values there against what TASK.md asks; fix the code, or the test if it asks the wrong thing'}`
        : blocks.length ? 'no throw, the code ran: it printed something else than the test wants; compare want/got (node lab.mjs record "<cmd>" shows what it prints now)'
          : 'it passed this time: timing? node lab.mjs flaky')}`);
  return { lines: res, printer: pAt, fails };
}

export async function whyCmd(args, out = console.log) {
  const k = CP.labKind(), u = CP.currentUnit(k, args), dir = CP.unitDir(k, u), text = fs.readFileSync(path.join(dir, 'tests.txt'), 'utf8'), secs = sectionsOf(text);
  let title = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-a');
  if (!title) { try { const lf = JSON.parse(fs.readFileSync(path.join(CP.TOP, k, '.lab', 'last-fail', `${u}.json`), 'utf8')); title = lf.secs?.find((t) => secs.some((x) => x.title === t)); } catch { /* none */ } }
  if (!title) {
    out(`why ${u}: which section fails? one run first...`);
    const r = trial(k, u, text);
    if (r.ok) { out(`OK ${u}: every section passes (a section by name: node lab.mjs why "<title>")`); return true; }
    title = Object.entries(r.sec).find(([, p]) => !p)?.[0];
    if (!title) { r.lines.filter((l) => /^(E |FAIL)/.test(l)).slice(0, 6).forEach((l) => out(l)); return false; }
  }
  const s = secs.find((x) => x.title === title);
  if (!s) { out(`ERR no section "${title}" (${secs.map((x) => x.title).join(' | ')})`); return false; }
  const ls = text.split(/\r?\n/), pre = ls.slice(0, s.from + 1), own = ls.slice(s.from + 1, s.to), sectionText = ls.slice(s.from, s.to).join('\n');
  const body = [...pre, 'trace err', 'events on', 'cov on', ...own, 'wait 300', 'cov', 'events off'];
  out(`why "${title}" (the sections before it run first, as in the test):`);
  const r = trial(k, u, body.join('\n'));
  if (!r.segs.length) { r.lines.filter((l) => /^(E |ERR|FAIL)/.test(l)).slice(0, 8).forEach((l) => out(l)); out('FAIL why: the run did not start (node lab.mjs go says why)'); return false; }
  if (r.sec[title] === true) out(`(it passed in this run: timing, or the order of what happened; node lab.mjs flaky "${title}" runs it a few times)`);
  let d = dossier(dir, title, sectionText, r);
  // nothing threw, a line printed something else: a second run stops at that line, just before the command, for its values
  if (d.printer && d.fails[0]?.line) {
    const at = d.printer.at, n = d.fails[0].line - 1 - 3;   // the expectation's line in tests.txt (3 lines were added above)
    let c = n - 1; while (c > s.from && (/^\s*(!~|[=~!])/.test(ls[c]) || /^\s{2,}\S/.test(ls[c]) || !ls[c].trim() || ls[c].trim().startsWith('#'))) c--;
    if (c > s.from) {
      const r2 = trial(k, u, [...ls.slice(0, c), `trace ${at} x3`, ...ls.slice(c, s.to), 'wait 300'].join('\n'));
      const v = r2.segs.flatMap((g) => g.out).find((l) => new RegExp(`^T\\d+ ${esc(at)} `).test(l) && !/\(same\)$/.test(l));
      if (v) d = dossier(dir, title, sectionText, r, { values: v.replace(/^T\d+ \S+ /, '') });
    }
  }
  d.lines.forEach((l) => out(l));
  return true;
}
