// bench playtest: how well does the AI loop find and fix bugs nobody told it about? Each case in playtest/<case>/ is an addon
// with planted bugs whose own tests pass (main.ts, tests.txt, TASK.md, setup.txt = lab commands) and hidden.txt: one section per
// planted bug, all failing on the code as given. The case runs `make -a <copy> --playtest` (the playtester plays it, the builder
// fixes what it finds); afterwards the hidden sections say which bugs are gone. A row per case goes to ranking.json.
//   node bench/bench.mjs playtest [<case>] [--via claude] [--model m] [--keep]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function playbench(HERE, TOP, args) {
  const flag = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const via = flag('--via', 'claude'), model = flag('--model'), keep = args.includes('--keep');
  const all = fs.readdirSync(path.join(HERE, 'playtest')).filter((d) => fs.existsSync(path.join(HERE, 'playtest', d, 'hidden.txt')));
  const cases = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : all;
  const lab = (a, env = {}) => { const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', ...a], { cwd: TOP, encoding: 'utf8', maxBuffer: 256e6, env: { ...process.env, LAB_NOTRACE: '1', ...env } }); return { ok: r.status === 0, text: ((r.stdout ?? '') + (r.stderr ?? '')).trim() }; };
  const sections = (t) => new Map(t.split('\n').filter((l) => /^SECTION (PASS|FAIL) /.test(l)).map((l) => [l.slice(13), l.startsWith('SECTION PASS')]));
  let ok = true;
  for (const c of cases) {
    const src = path.join(HERE, 'playtest', c), name = `pt_${c}_${Date.now().toString(36).slice(-5)}`, dir = path.join(TOP, 'bds', 'addons', name);
    const task = fs.readFileSync(path.join(src, 'TASK.md'), 'utf8'), req = /## Request\n([\s\S]*?)\n\n/.exec(task)?.[1] ?? c;
    console.log(`== playtest bench ${c}: ${name}`);
    lab(['new', name, task.split('\n')[0].replace(/^#\s*/, ''), req, `desc=${c} (playtest bench)`]);
    fs.copyFileSync(path.join(src, 'TASK.md'), path.join(dir, 'TASK.md'));
    fs.copyFileSync(path.join(src, 'main.ts'), path.join(dir, 'src', 'main.ts'));
    fs.copyFileSync(path.join(src, 'tests.txt'), path.join(dir, 'tests.txt'));
    for (const l of fs.existsSync(path.join(src, 'setup.txt')) ? fs.readFileSync(path.join(src, 'setup.txt'), 'utf8').split('\n').filter((x) => x.trim() && !x.startsWith('#')) : []) lab([...l.match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, '')), '-a', name]);
    // the case must hold: its own tests pass, every hidden section fails
    const own = lab(['test', '-a', name]), before = sections(lab(['test', '-a', name, path.join(src, 'hidden.txt')], { LAB_SECTIONS: '1' }).text);
    const planted = [...before.keys()];
    if (!own.ok || !planted.length || [...before.values()].some(Boolean)) { console.log(`ERR case ${c} does not hold: own tests ${own.ok ? 'pass' : 'fail'}, hidden ${[...before].map(([t, p]) => `${p ? 'PASS' : 'FAIL'} ${t}`).join(' | ') || 'none'}`); ok = false; continue; }
    const t0 = Date.now();
    const m = lab(['make', '-a', name, '--playtest', '--via', via, ...(model ? ['--model', model] : [])]);
    const after = sections(lab(['test', '-a', name, path.join(src, 'hidden.txt')], { LAB_SECTIONS: '1' }).text);
    const fixed = planted.filter((t) => after.get(t)), found = /playtest: (\d+) bug/.exec(m.text)?.[1] ?? '0';
    const tokens = Number((/: ([\d,]+) tokens/.exec(m.text)?.[1] ?? '0').replace(/,/g, '')), pt = Number((/playtest ([\d,]+)\)/.exec(m.text)?.[1] ?? '0').replace(/,/g, ''));
    m.text.split('\n').filter((l) => /^(BUG |PLAYTEST|playtest:|MADE|NOT DONE|DONE|FAIL)/.test(l)).forEach((l) => console.log('  ' + l));
    for (const t of planted) console.log(`  ${after.get(t) ? '✔ fixed' : '✘ still there'}: ${t}`);
    console.log(`PLAYTEST BENCH ${c}: ${fixed.length}/${planted.length} planted bugs gone, ${found} found by the playtester, ${tokens.toLocaleString('en')} tokens (playtest ${pt.toLocaleString('en')})`);
    const rf = path.join(HERE, 'ranking.json');
    try { const rows = JSON.parse(fs.readFileSync(rf, 'utf8')); rows.push({ id: `playtest-${name}`, agent: `${via}${model ? ':' + model : ''}`, task: `playtest:${c}`, pass: fixed.length === planted.length && m.ok, checks: `${fixed.length}/${planted.length} planted bugs fixed, ${found} found`, tokens, fresh: null, steps: null, labCalls: null, labOutTok: null, sec: Math.round((Date.now() - t0) / 1000), src: via, playtest: { found: Number(found), tokens: pt }, at: new Date().toISOString() }); fs.writeFileSync(rf, JSON.stringify(rows, null, 1) + '\n'); } catch { /* best-effort */ }
    if (!keep) fs.rmSync(dir, { recursive: true, force: true });
    ok = ok && fixed.length === planted.length;
  }
  process.exitCode = ok ? 0 : 1;
}
