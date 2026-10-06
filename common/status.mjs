// node lab.mjs status: where everything stands, in one call (for a person, and for an AI instead of five commands):
// the current lab and unit, every unit with its last test result, the servers, the autopilot, disk use of the caches and
// what to do next. Reads files only: no server, no network, no tokens.
//   node lab.mjs clean [--dry] [--deep]: frees disk the lab can rebuild (finished bench workspaces, old app runs, test temp folders,
//   servers for an older BDS, old checkpoints; --deep: a BDS zip beside the same BDS unpacked): `maint --fix` for those checks
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP = process.env.LAB_STATUS_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } };
const size = (p) => { let n = 0; try { const st = fs.lstatSync(p); if (!st.isDirectory()) return st.size; for (const e of fs.readdirSync(p)) n += size(path.join(p, e)); } catch { /* gone */ } return n; };
const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

export function unitsState(top = TOP) {
  const rows = [];
  for (const [k, d] of Object.entries(UNITS)) {
    let names = []; try { names = fs.readdirSync(path.join(top, k, d)).filter((n) => !n.startsWith('.') && fs.statSync(path.join(top, k, d, n)).isDirectory()).sort(); } catch { continue; }
    for (const u of names) {
      const dir = path.join(top, k, d, u), lf = path.join(top, k, '.lab', 'last-fail', `${u}.json`);
      // the test report each run leaves (<lab>/.lab/reports/<unit>.json, as the browser page reads it); a later failure wins
      let last = 'never tested here', rep = null;
      try { rep = JSON.parse(fs.readFileSync(path.join(top, k, '.lab', 'reports', `${u}.json`), 'utf8')); } catch { /* none */ }
      if (rep) last = `${rep.ok ? 'PASS' : 'FAIL'} ${rep.pass ?? '?'}/${rep.total ?? '?'}${rep.at ? ` ${ago(Date.parse(rep.at))} ago` : ''}${rep.bds ? ` on ${rep.bds}` : ''}`;
      if (fs.existsSync(lf) && (!rep || fs.statSync(lf).mtimeMs > Date.parse(rep.at ?? 0))) { let j = {}; try { j = JSON.parse(fs.readFileSync(lf, 'utf8')); } catch { /* old */ } last = `FAIL ${ago(j.t ?? fs.statSync(lf).mtimeMs)} ago${j.secs?.[0] ? `: "${j.secs[0]}"` : ''}`; }
      const t = read(path.join(dir, 'tests.txt')), n = (t.match(/^## /gm) ?? []).length;
      rows.push({ lab: k, unit: u, sections: n, last, beta: /beta/.test(read(path.join(dir, 'bp', 'manifest.json'))) });
    }
  }
  return rows;
}
export async function statusCmd(args, out = console.log) {
  const kind = read(path.join(TOP, '.lab-kind')) || 'bds', cur = read(path.join(TOP, kind, '.lab', 'addon'));
  const ver = read(path.join(TOP, 'VERSION'));
  out(`bds-lab${ver ? ' v' + ver : ''} | lab ${kind}${cur ? ` | current unit ${cur}` : ''}`);
  const servers = ['bds', 'end', 'll'].map((k) => { const v = read(path.join(TOP, k, '.lab', 'bds', 'VERSION')); return v ? `${k} BDS ${v}` : null; }).filter(Boolean);
  out(`servers: ${servers.join(' · ') || 'none yet (node lab.mjs setup all)'}`);
  const rows = unitsState();
  const fails = rows.filter((r) => r.last.startsWith('FAIL'));
  out(`units: ${rows.length} (${Object.keys(UNITS).map((k) => `${k} ${rows.filter((r) => r.lab === k).length}`).join(', ')})${fails.length ? ` · ${fails.length} failing` : ''}`);
  const show = args.includes('--all') ? rows : rows.filter((r) => r.lab === 'bds' || r.last.startsWith('FAIL'));
  for (const r of show) out(`  ${r.last.startsWith('FAIL') ? '✘' : r.last.startsWith('PASS') ? '✔' : '·'} ${r.lab}/${r.unit}  ${r.sections} test section(s)${r.beta ? ', beta APIs' : ''}  ${r.last}`);
  if (show.length < rows.length) out(`  … ${rows.length - show.length} more (samples; --all lists them)`);
  try {
    const A = await import('./auto.mjs'), G = await import('./auto-guard.mjs');
    const pol = G.policy(TOP), st = G.stopped(TOP), q = A.sense(pol, A.ledger());
    out(`autopilot: ${st ? 'STOPPED' : 'ready'} · today ${A.spentToday().toLocaleString('en')}/${pol.dailyTokens.toLocaleString('en')} tokens · next: ${q[0] ? `${q[0].id} (${q[0].title})` : 'nothing'}`);
  } catch { /* no autopilot */ }
  const caches = [['bds/.lab', 'bds caches'], ['end/.lab', 'end caches'], ['ll/.lab', 'll caches'], ['app/.lab', 'app (emulator, APK)'], ['bds/runs', 'bench workspaces'], ['app/runs', 'app results'], ['bds/vendor', 'BDS zip'], ['.lab', 'patch base']]
    .map(([p, what]) => [what, size(path.join(TOP, p))]).filter(([, n]) => n > 5e6);
  if (caches.length) out(`disk: ${caches.map(([w, n]) => `${w} ${mb(n)}`).join(' · ')} (node lab.mjs clean frees what can be rebuilt)`);
  const util = (() => { try { return JSON.parse(fs.readFileSync(path.join(TOP, 'common', 'data', 'samples.json'), 'utf8')).utility?.bds ?? []; } catch { return []; } })();
  const c2s = [process.env.SANDBOX_BE_CMDSCRIPT, path.join(TOP, 'cmdscript-be', 'src', 'index.js')].some((f) => f && fs.existsSync(f));
  out(`tools: utility addons ${util.join(', ') || 'none'} (in up/live/serve and deploy${util.includes('ts_repl') ? '; ts "<code>" runs code in the live one, help ts' : ''}) · sandbox-be ${fs.existsSync(path.join(TOP, 'sandbox-be', 'src', 'index.js')) ? 'ready (sim)' : 'missing'} · cmd2script ${c2s ? 'ready (c2s)' : 'missing (help c2s)'}${fs.existsSync(path.join(TOP, 'bedrock-binary', 'src', 'cli.js')) ? ' · bedrock-binary ready (bb)' : ''} · lan ${fs.existsSync(path.join(TOP, 'common', 'nethernet-connect', 'dist', 'src', 'index.js')) ? 'ready' : 'missing (common/nethernet-connect/dist is not in this copy: help lan)'}`);
  const training = (() => { try { return fs.readdirSync(path.join(TOP, 'training', 'addons')).length; } catch { return 0; } })();
  if (training) out(`training/: ${training} training addon(s) kept out of tests, upkeep and the autopilot (training/README.md)`);
  out(fails.length ? `next: node lab.mjs ${fails[0].lab} go -a ${fails[0].unit}   (node lab.mjs ${fails[0].lab} why -a ${fails[0].unit} first if the cause is not plain)` : cur ? `next: node lab.mjs go -a ${cur}` : 'next: node lab.mjs bds new <name> "<Title>" "<request>"');
  return true;
}
export async function cleanCmd(args, out = console.log) {
  const M = await import('./maint.mjs');
  const deep = args.includes('--deep');
  const only = ['temp', 'bench', 'runs', 'instances', 'checkpoints', 'colony', 'logins', 'locks', ...(deep ? ['vendor'] : [])];   // (--deep: also the BDS zip, which git may hold, and what colony got)
  const before = size(TOP);
  const r = await M.maint({ top: TOP, fix: !args.includes('--dry'), only, deep });
  r.lines.forEach((l) => out(l));
  const freed = before - size(TOP);
  out(args.includes('--dry') ? `${r.lines.length ? 'would free the above' : 'OK nothing to clean'} (node lab.mjs clean does it)` : `OK clean: ${freed > 0 ? mb(freed) + ' freed' : 'nothing to free'}`);
  return true;
}
