// node lab.mjs release [-a <unit>] [--no-go] [--no-ship]: one command from "it works" to "people have it":
//   go (tests + QA on a fresh real server must say DONE) → version +1 (pack --bump) → CHANGELOG.md in the unit, written from
//   TASK.md's ## Changes / ## Maintenance lines not released yet → .mcaddon → ship (GitHub branch + Release) when connected.
// Nothing is released that did not pass; a refused step stops everything after it.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { labKind, currentUnit, unitDir, TOP } from './checkpoint.mjs';

const today = () => new Date().toISOString().slice(0, 10);
/** the lines of TASK.md ## Changes and ## Maintenance that CHANGELOG.md does not have yet */
export function newNotes(task, changelog) {
  const pick = (h) => ((task.split(new RegExp(`^## ${h}\\s*$`, 'm'))[1] ?? '').split(/^## /m)[0]).split('\n').filter((l) => /^- /.test(l)).map((l) => l.replace(/^- (\d{4}-\d\d-\d\d )?/, '').trim());
  return [...pick('Changes'), ...pick('Maintenance')].filter((l) => l && !changelog.includes(l));
}
export async function releaseCmd(args, out = console.log) {
  const k = labKind(), u = currentUnit(k, args), d = unitDir(k, u);
  const lab = (a, stdio = 'pipe') => { const r = spawnSync(process.execPath, [path.join(TOP, k, 'lab.mjs'), ...a, '-a', u], { cwd: path.join(TOP, k), encoding: 'utf8', maxBuffer: 256e6, stdio: stdio === 'pipe' ? 'pipe' : 'inherit', env: { ...process.env, FORCE_COLOR: '0' } }); return { ok: r.status === 0, lines: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean) }; };
  if (!args.includes('--no-go')) {
    out(`release ${u}: go (tests + QA)…`);
    const g = lab(['go']);
    if (!g.ok || !g.lines.some((l) => l.startsWith('DONE '))) { g.lines.filter((l) => /^(✘|E |Q |FAIL)/.test(l)).slice(0, 12).forEach((l) => out('  ' + l)); out(`FAIL release: go did not say DONE, nothing released`); return false; }
  }
  const p = lab(['pack', '--bump']);
  const ver = /\(.*v([\d.]+)\)/.exec(p.lines.at(-1) ?? '')?.[1];
  if (!p.ok || !ver) { p.lines.slice(-4).forEach((l) => out('  ' + l)); out('FAIL release: pack --bump'); return false; }
  const cf = path.join(d, 'CHANGELOG.md'), cl = fs.existsSync(cf) ? fs.readFileSync(cf, 'utf8') : `# ${u}\n`;
  const notes = newNotes(fs.existsSync(path.join(d, 'TASK.md')) ? fs.readFileSync(path.join(d, 'TASK.md'), 'utf8') : '', cl);
  const head = cl.split('\n')[0], rest = cl.split('\n').slice(1).join('\n').replace(/^\n+/, '');
  fs.writeFileSync(cf, `${head}\n\n## ${ver} (${today()})\n${(notes.length ? notes : ['（変更の記録なし）']).map((l) => `- ${l}`).join('\n')}\n${rest ? '\n' + rest : ''}`);
  out(`OK v${ver}: ${p.lines.at(-1)?.replace(/^OK /, '')} | CHANGELOG.md +${notes.length}`);
  if (args.includes('--no-ship')) return true;
  const s = lab(['ship']);
  out(s.ok ? `OK ${s.lines.at(-1)}` : `W ship: ${s.lines.slice(-2).join(' | ')} (node lab.mjs github で GitHub につなぐと Release まで自動)`);
  return true;
}
