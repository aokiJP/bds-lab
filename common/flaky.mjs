// node lab.mjs flaky [-a <unit>] [n=3]: the unit's tests n times on fresh servers; each section's pass count. A section that
// passes sometimes is flaky (timing, randomness, a wait too short): fix the test or the code, never trust one green run.
// maintain uses the same idea: a failure that passes on the second try is FLAKY, not broken (no AI tokens spent on it).
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { labKind, currentUnit, TOP } from './checkpoint.mjs';

export function runSections(k, u, env = {}) {
  const r = spawnSync(process.execPath, [path.join(TOP, k, 'lab.mjs'), 'test', '-a', u], { cwd: path.join(TOP, k), encoding: 'utf8', maxBuffer: 256e6, env: { ...process.env, LAB_SECTIONS: '1', LAB_NOTRACE: '1', FORCE_COLOR: '0', LAB_NO_LASTFAIL: '1', ...env } });
  const lines = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
  const sec = Object.fromEntries(lines.filter((l) => /^SECTION (PASS|FAIL) /.test(l)).map((l) => [l.slice(13), l.startsWith('SECTION PASS')]));
  return { ok: r.status === 0 && lines.some((l) => /^PASS \d/.test(l)), sec, lines };
}

export async function flakyCmd(args, out = console.log) {
  const k = labKind(), u = currentUnit(k, args), n = Math.max(2, Number(args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== '-a')[0] ?? 3));
  const tally = {}; let runsOk = 0;
  for (let i = 1; i <= n; i++) {
    const r = runSections(k, u);
    if (r.ok) runsOk++;
    for (const [t, p] of Object.entries(r.sec)) (tally[t] ??= []).push(p);
    out(`run ${i}/${n}: ${r.ok ? 'PASS' : 'FAIL'}${r.ok ? '' : ' ' + (Object.entries(r.sec).filter(([, p]) => !p).map(([t]) => `"${t}"`).join(', ') || r.lines.filter((l) => /^(E |ERR)/.test(l))[0] || '')}`);
  }
  const flaky = Object.entries(tally).filter(([, v]) => v.some(Boolean) && v.some((x) => !x)), dead = Object.entries(tally).filter(([, v]) => !v.some(Boolean));
  for (const [t, v] of flaky) out(`FLAKY "${t}": passed ${v.filter(Boolean).length}/${v.length} (a wait too short? until <regex> instead of wait; randomness: fix the seed or the expectation)`);
  for (const [t] of dead) out(`FAIL "${t}": every run`);
  // a run that failed before any section ran (build, schema, a crash at load) counts too: it used to say OK when every run
  // failed that way, since no section had a tally to be FAIL in
  const steady = runsOk === n && !flaky.length && !dead.length;
  if (runsOk < n && !flaky.length && !dead.length) out(`FAIL ${u}: ${n - runsOk}/${n} runs failed before a section ran (the line after FAIL above says why)`);
  out(steady ? `OK ${u}: ${n}/${n} runs, every section every time` : `${flaky.length || (runsOk && runsOk < n) ? 'FLAKY' : 'FAIL'} ${u}: ${runsOk}/${n} runs passed`);
  return steady;
}
