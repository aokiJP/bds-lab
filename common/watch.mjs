// node lab.mjs watch [-a <unit>] [--check|--go|--live]: save a file, see the result. Every save in the unit (src, bp, rp,
// tests.txt, features.json) runs, once the saving stops for a moment:
//   (default) test    the unit's tests on a fresh real server: PASS, or the ✘ / E lines that matter
//   --check           build + type check + static checks only (seconds, no server)
//   --sim             tests.txt in the Script API sandbox (sandbox-be/: about a second, no server; a hint, go decides)
//   --go              the whole go (tests, QA, pack)
//   --live            a live server stays up (`up`) and each save goes in with `reload` (players stay; for playing it yourself)
// A save while a run is going queues one more run. The terminal bell rings when it turns from FAIL to PASS. Ctrl+C stops.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { labKind, currentUnit, unitDir, TOP } from './checkpoint.mjs';

const IGNORE = /(^|[\\/])(node_modules|dist|\.lab|__pycache__|build|\.xmake)([\\/]|$)|tsconfig\.json$|lab_features\.js$|\.(swp|tmp)$|~$/;
const KEEP = /^(✘|  want|  got|E |ERR |W |Q |FAIL|PASS|DONE|OK|SKIP|UNSURE|\? |  hint)/;

export async function watchCmd(args, out = console.log) {
  const k = labKind(), u = currentUnit(k, args), dir = unitDir(k, u);
  const mode = args.includes('--live') ? 'live' : args.includes('--go') ? 'go' : args.includes('--check') ? 'check' : args.includes('--sim') ? 'sim' : 'test';
  const hasSrc = fs.existsSync(path.join(dir, 'src'));
  const lab = (a) => [path.join(TOP, k, 'lab.mjs'), ...a, '-a', u];
  const stamp = () => new Date().toTimeString().slice(0, 8);
  let running = false, again = false, last = null, runs = 0;
  const max = Number(process.env.LAB_WATCH_RUNS || 0);   // tests: stop after this many runs
  if (mode === 'live') {
    out(`${stamp()} live server for ${u}...`);
    const r = spawnSync(process.execPath, lab(['up']), { cwd: path.join(TOP, k), encoding: 'utf8' });
    (r.stdout + r.stderr).trim().split('\n').filter((l) => KEEP.test(l) || /live|port|join/i.test(l)).slice(-8).forEach((l) => out('  ' + l));
    const stop = () => { spawnSync(process.execPath, lab(['down']), { cwd: path.join(TOP, k) }); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }
  const run = () => {
    if (running) { again = true; return; }
    running = true; runs++;
    const t0 = Date.now(), cmd = mode === 'live' ? ['reload'] : [mode];
    out(`${stamp()} ${cmd[0]} ${u} ...`);
    const c = spawn(process.execPath, mode === 'sim' ? [path.join(TOP, 'lab.mjs'), 'sim', '-a', u] : lab(cmd), { cwd: mode === 'sim' ? TOP : path.join(TOP, k), env: { ...process.env, FORCE_COLOR: '0' } });
    let text = '';
    c.stdout.on('data', (d) => { text += d; }); c.stderr.on('data', (d) => { text += d; });
    c.on('close', (code) => {
      const lines = text.trim().split('\n').filter((l) => KEEP.test(l));
      const shown = lines.length > 24 ? [...lines.slice(0, 20), `  … ${lines.length - 23} more`, ...lines.slice(-3)] : lines;
      shown.forEach((l) => out('  ' + l));
      const ok = code === 0;
      out(`${stamp()} ${ok ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(1)}s) — watching ${k}/${path.relative(path.join(TOP, k), dir).split(path.sep).join('/')} (Ctrl+C to stop)`);
      if (ok && last === false) process.stdout.write('\x07');
      last = ok; running = false;
      if (max && runs >= max) process.exit(ok ? 0 : 1);
      if (again) { again = false; run(); }
    });
  };
  let timer = null;
  const changed = (f) => {
    if (!f || IGNORE.test(f)) return;
    if (hasSrc && /^bp[\\/]scripts[\\/]/.test(f)) return;   // build output
    clearTimeout(timer); timer = setTimeout(run, Number(process.env.LAB_WATCH_DEBOUNCE_MS || 500));
  };
  try { fs.watch(dir, { recursive: true }, (_, f) => changed(f && String(f))); }
  catch {   // no recursive watch here: poll the modification times
    const snap = () => { const m = new Map(); const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = path.relative(dir, p); if (IGNORE.test(r)) continue; if (e.isDirectory()) walk(p); else m.set(r, fs.statSync(p).mtimeMs); } }; walk(dir); return m; };
    let prev = snap();
    setInterval(() => { const now = snap(); for (const [f, t] of now) if (prev.get(f) !== t) changed(f); for (const f of prev.keys()) if (!now.has(f)) changed(f); prev = now; }, 1000);
  }
  out(`watching ${k}/${path.relative(path.join(TOP, k), dir).split(path.sep).join('/')}: each save → ${mode === 'live' ? 'reload on the live server' : mode} (Ctrl+C to stop)`);
  if (!args.includes('--no-first') && mode !== 'live') run();
  await new Promise(() => {});
}
