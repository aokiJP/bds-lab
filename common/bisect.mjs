// node lab.mjs bisect [-a <unit>] ["<## section title>"] [--good <checkpoint id>]: "it worked before" → the change that broke
// it, found by itself. The unit's checkpoints (make, maintain, mode, add, undo and `checkpoint` take them) are tested on fresh
// servers, back from the newest in growing steps, then by halving (2 runs for a recent break). The answer is the first one that
// fails after the last one that passes, and what changed between them as a diff. The unit is put back exactly as it was, whatever happens. Zero tokens.
import * as CP from './checkpoint.mjs';
import { runSections } from './flaky.mjs';

export async function bisectCmd(args, out = console.log) {
  const k = CP.labKind(), u = CP.currentUnit(k, args), opt = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
  const section = args.find((a, i) => !a.startsWith('-') && !['-a', '--good'].includes(args[i - 1])) ?? null;
  const all = CP.list(k, u);
  if (!all.length) { out(`${u}: no checkpoints yet (make, maintain, mode, add take them; by hand: node lab.mjs checkpoint)`); return false; }
  const name = (i) => (i === all.length ? 'now' : `${all[i].id}${all[i].label ? ` (${all[i].label})` : ''}`);
  let lastWhy = '';
  const judge = (i) => {
    const r = runSections(k, u, { LAB_NO_KITSYNC: '1' }), ok = section ? r.sec[section] === true : r.ok;   // (each checkpoint as it was: no kit update)
    const why = ok ? '' : (section && !(section in r.sec) ? `no section "${section}"` : r.lines.find((l) => /^(✘|E |ERR )/.test(l)) ?? r.lines.filter(Boolean).at(-1) ?? '');
    out(`  ${name(i)}: ${ok ? 'PASS' : 'FAIL'}${why ? ' — ' + (why === lastWhy ? 'the same' : why.slice(0, 140)) : ''}`);
    if (why) lastWhy = why;
    return ok;
  };
  const held = CP.hold(k, u);
  try {
    out(`bisect ${u}${section ? ` "${section}"` : ''}: ${all.length} checkpoint(s), newest last`);
    if (judge(all.length)) { out(`OK ${u} passes now: nothing to look for`); return true; }
    let g = -1, b = all.length;
    if (opt('--good')) {
      g = all.findIndex((x) => x.id === opt('--good'));
      if (g < 0) { out(`ERR no checkpoint ${opt('--good')} (node lab.mjs undo --list)`); return false; }
      CP.restore(k, u, all[g].id);
      if (!judge(g)) { out(`FAIL ${u}: it fails at ${name(g)} too: nothing that passed to compare with`); return false; }
    } else {
      // back from the newest in growing steps (a recent break costs 2 runs); one that fails all the way back (an older state
      // that failed for another reason) → the ones skipped, newest first: any pass → fail pair is a real break
      const seen = new Set(), at = (i) => { seen.add(i); CP.restore(k, u, all[i].id); return judge(i); };
      for (let step = 1; g < 0; step *= 2) { const i = Math.max(0, b - step); if (at(i)) g = i; else { b = i; if (i === 0) break; } }
      for (let i = all.length - 1; g < 0 && i > 0; i--) if (!seen.has(i)) { if (at(i)) g = i; else if (i < b) b = i; }
      if (g < 0) { out(`FAIL ${u}: every checkpoint fails too: nothing that passed to compare with (node lab.mjs undo --list)`); return false; }
      for (let i = g + 1; i < all.length; i++) if (seen.has(i)) { b = i; break; }
      if (!seen.has(b) && b < all.length) b = all.length;
    }
    while (b - g > 1) { const m = (g + b) >> 1; CP.restore(k, u, all[m].id); if (judge(m)) g = m; else b = m; }
    out(`FOUND ${b === all.length ? 'what changed after the newest checkpoint' : name(b)} broke it; ${name(g)} was the last that passed. What changed:`);
    const d = CP.diffDirs(CP.cpDir(k, u, all[g].id), b === all.length ? held.dir : CP.cpDir(k, u, all[b].id));
    const lines = (d ?? '(no git here: node lab.mjs undo --list shows which files differ)').split('\n').filter((l) => !/^(index |similarity|new file mode|deleted file mode)/.test(l));
    lines.slice(0, 80).forEach((l) => out(l));
    if (lines.length > 80) out(`… ${lines.length - 80} more diff lines`);
    out(`back to the one that passed: node lab.mjs undo ${all[g].id}   (the unit is as it was now)`);
    return true;
  } finally { held.back(); }
}
