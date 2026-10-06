// node lab.mjs maintain: keep every unit working on the newest Minecraft, by itself.
// For each lab (bds / end / ll): the lab moves to the newest release, every unit is tested on it, and each one that broke goes
// through these steps until its tests pass again (the old tests are never changed):
//   0. restore   features that an earlier maintain switched off are tried again (Mojang may have fixed it): back on if they pass
//   1. autofix   no AI, no tokens: the @minecraft/* module versions this Minecraft accepts (`mode beta|stable`) — the usual
//                reason a beta addon stops loading after an update
//   2. AI patch  `make -a <unit> --until test` with the failing lines and the part of the API diff it touches (apidiff.mjs), so the
//                AI does not have to explore; it may switch a feature off in features.json with the reason instead of a hack
//   3. limit     the unit has features.json: the features whose tests still fail are switched off (kit feature() / lab_features.js
//                skip them; their sections are skipped): the rest of the unit keeps working, marked LIMITED
//   otherwise    BROKEN: the unit is put back as it was (the attempt is kept as a checkpoint and a .diff)
// A release the lab cannot run yet (the real client does not speak it, no Endstone for it): WAIT, the lab goes back to its BDS.
// Every changed unit: a checkpoint first (node lab.mjs undo), a line in TASK.md ## Maintenance, a .diff in <lab>/.lab/maintain/.
//   --lab bds|end|ll|all   (default: the current lab)      -a <unit[,unit]>   only these
//   --to latest|preview|current|<BDS version>   (default latest; preview = what the NEXT update breaks: a dry run, see --apply)
//   --dry        report only: afterwards every unit and the lab's server are put back      --apply  keep the changes of a preview run
//   --from <BDS version>   what the units last worked on, for the API diff the AI gets (default: the lab's before the update,
//                else each manifest's min_engine_version)
//   --no-ai  --no-limit  --via/--model/--budget/--turns (for make)      --pr  (CI) a branch maintain/<version> and a pull request
//   --schedule daily|weekly|off [--at HH:MM] [--with-preview]   this machine runs it by itself (cron / Task Scheduler);
//                --with-preview also checks each new preview once (--to preview --only-new: what the next update breaks)
// Exit 0 when nothing is BROKEN. LAB_NOTIFY_WEBHOOK gets the table. LAB_LABS_ROOT: another folder of labs (tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = () => process.env.LAB_LABS_ROOT || REPO;
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
const today = () => new Date().toISOString().slice(0, 10);

const lab = (k, args, env = {}, timeout = 60 * 60_000) => {
  const r = spawnSync(process.execPath, [path.join(ROOT(), k, 'lab.mjs'), ...args], { cwd: path.join(ROOT(), k), encoding: 'utf8', timeout, maxBuffer: 256e6, env: { ...process.env, LAB_NOTRACE: '1', FORCE_COLOR: '0', LAB_NO_LASTFAIL: '1', ...env } });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { ok: r.status === 0, text, lines: text.trim().split('\n').filter(Boolean) };
};
const unitDir = (k, u) => path.join(ROOT(), k, UNITS[k], u);
const units = (k) => { try { return fs.readdirSync(path.join(ROOT(), k, UNITS[k])).filter((n) => !n.startsWith('.') && fs.statSync(unitDir(k, n)).isDirectory()).sort(); } catch { return []; } };
const readJ = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const passed = (t) => t.ok && t.lines.some((l) => /^PASS \d/.test(l));
const failLines = (t) => t.lines.filter((l) => /^(✘|  want|  got|E |ERR |SECTION FAIL|SECTION WHY|FAIL)/.test(l)).slice(0, 40);
const failedSections = (t) => t.lines.filter((l) => l.startsWith('SECTION FAIL ')).map((l) => l.slice(13));
// tests.txt sections as { title → body } (only significant lines): the AI must leave the old ones as they are
function sections(file) {
  const m = new Map(); let cur = null;
  try { for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const l = raw.trim(); if (l.startsWith('## ')) { cur = l.slice(3); m.set(cur, []); } else if (cur && l && !l.startsWith('#')) m.get(cur).push(l); } } catch { /* none */ }
  return new Map([...m].map(([k, v]) => [k, v.join('\n')]));
}
const featFile = (k, u) => path.join(unitDir(k, u), 'features.json');
const writeJ = (f, j) => fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
function taskNote(k, u, line) {
  const f = path.join(unitDir(k, u), 'TASK.md');
  let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { t = `# ${u}\n`; }
  if (!/^## Maintenance/m.test(t)) t = t.trimEnd() + '\n\n## Maintenance\n';
  const [head, tail = ''] = t.split(/^## Maintenance\n/m);
  const rest = tail.split(/^(?=## )/m);
  rest[0] = rest[0].trimEnd() + (rest[0].trim() ? '\n' : '') + `- ${today()} ${line}\n` + (rest.length > 1 ? '\n' : '');
  fs.writeFileSync(f, head + '## Maintenance\n' + rest.join(''));
}
// what maintain changed, as one unified diff (git diff --no-index; no git → no file). Build output and the checkpoint's own note are left out.
function diffFile(k, u, cpDir, outFile) {
  const parent = path.dirname(cpDir), tmp = path.join(parent, `.now-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(unitDir(k, u), tmp, { recursive: true, filter: (f) => !/[\\/](node_modules|dist|\.lab|__pycache__)$|tsconfig\.json$/.test(f) });
  const r = spawnSync('git', ['-c', 'core.quotepath=false', 'diff', '--no-index', '--no-color', '--', path.basename(cpDir), path.basename(tmp)], { cwd: parent, encoding: 'utf8', maxBuffer: 64e6 });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.error || r.status > 1 || !r.stdout) return null;
  const src = fs.existsSync(path.join(unitDir(k, u), 'src'));
  const body = r.stdout.split(/^(?=diff --git )/m).filter((c) => c.trim() && !/\.checkpoint\.json/.test(c.split('\n')[0]) && !(src && /\/bp\/scripts\//.test(c.split('\n')[0])))
    .map((c) => c.split(`${path.basename(cpDir)}/`).join(`${u}/`).split(`${path.basename(tmp)}/`).join(`${u}/`)).join('');
  if (!body.trim()) return null;
  fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, body);
  return outFile;
}

async function maintainUnit(k, u, o, ctx) {
  const CP = await import('./checkpoint.mjs');
  const say = (s) => o.out(`  ${s}`);
  const tf = path.join(unitDir(k, u), 'tests.txt');
  const test = () => lab(k, ['test', '-a', u], { LAB_SECTIONS: '1' });
  const fj0 = readJ(featFile(k, u));
  let t = test();
  // 0. restore: switched-off features back on when they pass again
  if (fj0?.off && Object.keys(fj0.off).length && !o.dry) {
    const offBefore = { ...fj0.off };
    writeJ(featFile(k, u), { ...fj0, off: {} });
    const t2 = test();
    if (passed(t2)) { taskNote(k, u, `${ctx.ver}: features back on (${Object.keys(offBefore).join(', ')})`); return { unit: u, status: 'RESTORED', how: `back on: ${Object.keys(offBefore).join(', ')}` }; }
    writeJ(featFile(k, u), fj0);
  }
  if (passed(t)) return { unit: u, status: fj0?.off && Object.keys(fj0.off).length ? 'LIMITED' : 'OK', how: fj0?.off && Object.keys(fj0.off).length ? `off: ${Object.keys(fj0.off).join(', ')}` : '' };
  // the lab itself cannot run here (no server, network blocked): not the unit's fault, so no AI and no changes
  const infra = t.lines.find((l) => /network is blocked|cannot download|BLOCKED|unreachable|ENOTFOUND|EAI_AGAIN|^MISSING|no BDS|did not start|accepts no protocol number/i.test(l) && !/^(✘|  want|  got)/.test(l));
  if (infra && (/accepts no protocol/.test(infra) || !t.lines.some((l) => /^(✘|SECTION)/.test(l)))) return { unit: u, status: 'LABERR', how: infra.slice(0, 200) };
  // the borrowed client (a Minecraft newer than bedrock-protocol) could not do some action: the lab's gap, not the unit's
  const gap = t.lines.filter((l) => /borrowed client: this action/.test(l));
  if (gap.length) return { unit: u, status: 'WAIT', how: `borrowed client cannot yet: ${[...new Set(gap.map((l) => /@\w+ (\w+):/.exec(l)?.[1]).filter(Boolean))].join(', ')} (bedrock-protocol)` };
  // failed once: a second fresh run first (no tokens). Passing now = FLAKY (timing, randomness): said, never "fixed" by an AI
  if (!t.lines.some((l) => /did not load|is not in this BDS/.test(l))) {
    const t2 = test();
    if (passed(t2)) return { unit: u, status: 'FLAKY', how: `failed once, passed on the second run: ${failedSections(t).map((x) => `"${x}"`).join(', ') || failLines(t)[0] || '?'} (node lab.mjs flaky -a ${u})` };
    t = t2;
  }
  const first = failLines(t);
  say(`✘ ${u}: ${first.find((l) => /^(✘|E |ERR )/.test(l)) ?? first[0] ?? 'failed'}`);
  const cp = CP.save(k, u, `before maintain ${ctx.ver}`);
  const cpDir = path.join(ROOT(), k, '.lab', 'checkpoints', u, cp);
  const before = sections(tf);
  const steps = [];
  const finish = (status, how) => {
    const d = diffFile(k, u, cpDir, path.join(ROOT(), k, '.lab', 'maintain', ctx.ver, `${u}.diff`));
    if (status === 'BROKEN' || o.dry) { const att = status === 'BROKEN' ? CP.save(k, u, `maintain attempt ${ctx.ver} (${how})`) : null; CP.restore(k, u, cp); if (att) how += ` | attempt kept: node lab.mjs undo ${att}`; }
    else taskNote(k, u, `${ctx.ver}: ${status}${how ? ' (' + how + ')' : ''}`);
    return { unit: u, status, how, diff: d, cp, fail: status === 'BROKEN' ? first.slice(0, 6) : undefined };
  };
  // 1. autofix: module versions for this Minecraft (bds only)
  const mf = path.join(unitDir(k, u), 'bp', 'manifest.json'), m = readJ(mf);
  const mc = (m?.dependencies ?? []).filter((d) => d.module_name?.startsWith('@minecraft/'));
  if (k === 'bds' && mc.length) {
    const beta = mc.some((d) => String(d.version).includes('beta'));
    const r = lab(k, ['mode', beta ? 'beta' : 'stable', '-a', u]);
    const ch = /: (.*->.*)$/m.exec(r.text)?.[1];
    if (r.ok && ch) {
      steps.push(`modules ${ch}`); say(`autofix: ${ch}`);
      t = test();
      if (passed(t)) return finish('FIXED', `autofix: ${ch}`);
    }
  }
  // 2. the AI patch
  if (!o.noAi && ctx.ai) {
    let api = '';
    // the API changes since the version it last worked on: the lab's own before this update, else what its manifest was made for
    const eng = (readJ(mf) ?? m)?.header?.min_engine_version, from = o.from ?? (ctx.from && ctx.from !== ctx.to ? ctx.from : Array.isArray(eng) ? eng.join('.') : null);
    if (k === 'bds' && from && ctx.to && from !== ctx.to) {
      try { const A = await import('./apidiff.mjs'); const beta = mc.some((d) => String(d.version).includes('beta')); api = (await A.forUnit(unitDir(k, u), from, ctx.to, { stable: !beta })).text; } catch (e) { say(`W apidiff: ${e.message}`); }
    }
    const fj = readJ(featFile(k, u));
    const ctxText = [
      `This ${k === 'bds' ? 'addon' : k === 'end' ? 'Endstone plugin' : 'LeviLamina mod'} worked before the update to ${ctx.ver}${ctx.from ? ` (from ${ctx.from})` : ''} and now fails. Fix its code for the new version.`,
      'Rules: never edit or remove an existing tests.txt section (they are the spec). Change as little as possible. Prefer the replacement API over a workaround.',
      fj ? `If one feature of features.json (${Object.keys(fj.features ?? {}).join(', ')}) cannot work on this version at all, you may switch it off: add "<name>": "<why, one line>" under "off" in features.json (its tests are then skipped) — only as a last resort.` : 'If one part cannot work on this version at all, you may add features.json ({"features": {"<name>": {"tests": ["<## title>"]}}, "off": {"<name>": "<why>"}}) and wrap that part in kit feature(\'<name>\', () => {...}) — only as a last resort.',
      'What failed (node lab.mjs test):', ...failLines(t),
      ...(steps.length ? [`Already done by the lab: ${steps.join('; ')}`] : []),
      ...(api ? ['Script API changes this unit touches (apidiff):', api] : []),
    ].join('\n');
    const cf = path.join(os.tmpdir(), `bdslab-maint-${process.pid}-${u}.txt`); fs.writeFileSync(cf, ctxText);
    say(`AI: ${ctx.ai}${o.model ? ':' + o.model : ''} is fixing it...`);
    const mk = lab(k, ['make', '-a', u, `maintain: make it work on ${ctx.ver}`, '--until', 'test', '--context', cf, ...(o.via ? ['--via', o.via] : []), ...(o.model ? ['--model', o.model] : []), ...(o.budget ? ['--budget', o.budget] : []), ...(o.turns ? ['--turns', o.turns] : [])], { LAB_NOTIFY_WEBHOOK: '' });
    fs.rmSync(cf, { force: true });
    const tok = /: ([\d,]+) tokens/.exec(mk.text)?.[1];
    ctx.tokens += Number((tok ?? '0').replace(/,/g, ''));
    // the spec is the old tests: an attempt that changed one of them is not taken
    const after = sections(tf), bad = [...before].filter(([title, body]) => after.get(title) !== body).map(([title]) => title);
    if (bad.length) { steps.push(`AI changed old tests (${bad.map((x) => `"${x}"`).join(', ')}): refused`); say(`the AI changed old tests (${bad.map((x) => `"${x}"`).join(', ')}): not taken`); CP.restore(k, u, cp); if (steps.length) lab(k, ['mode', mc.some((d) => String(d.version).includes('beta')) ? 'beta' : 'stable', '-a', u]); }
    else {
      t = test();
      if (passed(t)) { const off = Object.keys(readJ(featFile(k, u))?.off ?? {}).filter((n) => !(fj?.off ?? {})[n]); return finish(off.length ? 'LIMITED' : 'FIXED', [...steps, `AI ${tok ?? '?'} tokens`, ...(off.length ? [`off: ${off.join(', ')}`] : [])].join('; ')); }
      steps.push('AI patch did not pass'); say(`AI patch did not pass: ${failLines(t).find((l) => /^(✘|E )/.test(l)) ?? ''}`);
    }
  }
  // 3. limit: switch off the features whose tests fail
  const fj = readJ(featFile(k, u));
  if (!o.noLimit && fj?.features && Object.keys(fj.features).length) {
    const bad = failedSections(t), owner = (title) => Object.entries(fj.features).find(([, f]) => (f.tests ?? []).includes(title))?.[0];
    const offs = [...new Set(bad.map(owner))];
    if (bad.length && !offs.includes(undefined)) {
      const why = (n) => t.lines.find((l) => l.startsWith('SECTION WHY ') && (fj.features[n].tests ?? []).some((x) => l.startsWith(`SECTION WHY ${x} :: `)))?.split(' :: ')[1] ?? 'fails';
      writeJ(featFile(k, u), { ...fj, off: { ...(fj.off ?? {}), ...Object.fromEntries(offs.map((n) => [n, `${ctx.ver}: ${why(n).slice(0, 120)}`])) } });
      t = test();
      if (passed(t)) return finish('LIMITED', [...steps, `off: ${offs.join(', ')}`].join('; '));
      say(`limited mode did not pass either: ${failLines(t).find((l) => /^(✘|E )/.test(l)) ?? ''}`);
    } else if (bad.length) say(`limit: a failing section belongs to no feature (${bad.filter((x) => !owner(x)).map((x) => `"${x}"`).join(', ')})`);
  }
  return finish('BROKEN', [...steps, ...(ctx.ai && !o.noAi ? [] : ['no AI (node lab.mjs login ai)'])].join('; ') || 'could not fix it');
}

// --schedule daily|weekly|off [--at HH:MM]: this machine runs maintain by itself (cron on Linux/macOS, Task Scheduler on
// Windows), with the other flags given; the output goes to <lab>/.lab/maintain/scheduled.log and to LAB_NOTIFY_WEBHOOK
export function schedule(when, at = '04:17', rest = [], out = console.log, what = 'maintain') {
  const WIN = process.platform === 'win32', tag = `bds-lab ${what} ${ROOT()}`;
  const [hh, mm] = String(at).split(':').map(Number);
  const how = what === 'maintain' ? 'maintain --schedule' : `${what} --auto`;
  if (!['daily', 'weekly', 'off'].includes(when) || !(hh >= 0 && hh < 24 && mm >= 0 && mm < 60)) { out(`usage: node lab.mjs ${how} daily|weekly|off [--at HH:MM] [other ${what} flags]`); return false; }
  // upkeep runs maintain inside: a scheduled maintain of this lab would run it twice, so scheduling upkeep replaces it
  const also = what === 'upkeep' ? `bds-lab maintain ${ROOT()}` : null;
  const log = path.join(ROOT(), 'bds', '.lab', 'maintain', 'scheduled.log');
  const withPreview = rest.includes('--with-preview'); rest = rest.filter((a) => a !== '--with-preview');
  const base = `"${process.execPath}" "${path.join(ROOT(), 'lab.mjs')}" ${what}`;
  const cmd = `${base} ${rest.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`.trim() + (withPreview ? ` ; ${base} --to preview --only-new --no-ai` : '');
  if (WIN) {
    const name = `bds-lab ${what} ${Buffer.from(ROOT()).toString('hex').slice(-8)}`;
    if (when === 'off') { const r = spawnSync('schtasks', ['/Delete', '/F', '/TN', name], { encoding: 'utf8' }); out(r.status === 0 ? `OK the scheduled ${what} is off` : 'OK nothing was scheduled'); return true; }
    if (also) spawnSync('schtasks', ['/Delete', '/F', '/TN', `bds-lab maintain ${Buffer.from(ROOT()).toString('hex').slice(-8)}`], { encoding: 'utf8' });
    const r = spawnSync('schtasks', ['/Create', '/F', '/TN', name, '/SC', when === 'daily' ? 'DAILY' : 'WEEKLY', '/ST', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, '/TR', `cmd /c cd /d "${ROOT()}" && ${cmd.replace(' ; ', ' & ')} >> "${log}" 2>&1`], { encoding: 'utf8' });
    out(r.status === 0 ? `OK ${what} runs ${when} at ${at} (Task Scheduler: "${name}"; log: ${path.relative(ROOT(), log)})` : `E schtasks: ${(r.stderr || r.stdout).trim()}`);
    return r.status === 0;
  }
  const cur = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (cur.error) { out(`E no crontab on this machine: run \`node lab.mjs ${what}\` from your own scheduler`); return false; }
  const keep = (cur.status === 0 ? cur.stdout : '').split('\n').filter((l) => l.trim() && !l.includes(`# ${tag}`) && !(also && when !== 'off' && l.includes(`# ${also}`)));
  if (when !== 'off') { fs.mkdirSync(path.dirname(log), { recursive: true }); keep.push(`${mm} ${hh} * * ${when === 'weekly' ? '0' : '*'} cd "${ROOT()}" && ${cmd} >> "${log}" 2>&1 # ${tag}`); }
  const w = spawnSync('crontab', ['-'], { input: keep.join('\n') + '\n', encoding: 'utf8' });
  if (w.status !== 0) { out(`E crontab: ${(w.stderr || '').trim()}`); return false; }
  out(when === 'off' ? `OK the scheduled ${what} is off` : `OK ${what} runs ${when} at ${at} (crontab; log: ${path.relative(ROOT(), log)}; off: node lab.mjs ${how} off)`);
  return true;
}

// a unit on beta modules that also passes on the stable ones is moved to stable: beta APIs change with every update, stable
// ones carry over, so the next update is less likely to break it (tried once per unit and release; put back if it fails)
async function promote(k, u, r, ctx, o) {
  const mf = path.join(unitDir(k, u), 'bp', 'manifest.json'), m = readJ(mf);
  if (!(m?.dependencies ?? []).some((d) => d.module_name?.startsWith('@minecraft/') && String(d.version).includes('beta'))) return;
  const memo = path.join(ROOT(), k, '.lab', 'maintain', 'promote-tried.json'), tried = readJ(memo) ?? {};
  if (tried[u] === ctx.to) return;
  const before = fs.readFileSync(mf);   // (mode changes the manifest only)
  const mode = lab(k, ['mode', 'stable', '-a', u]), t = mode.ok ? lab(k, ['test', '-a', u]) : { ok: false, lines: [] };
  // remembered only when the answer is the unit's (a network or server failure is tried again next time)
  if (!t.lines.some((l) => /network is blocked|cannot download|BLOCKED|unreachable|ENOTFOUND|EAI_AGAIN|^MISSING|no BDS|did not start/i.test(l))) { tried[u] = ctx.to; fs.mkdirSync(path.dirname(memo), { recursive: true }); fs.writeFileSync(memo, JSON.stringify(tried)); }
  if (mode.ok && passed(t)) {
    const after = fs.readFileSync(mf), CP = await import('./checkpoint.mjs');
    if (!r.cp) { fs.writeFileSync(mf, before); r.cp = CP.save(k, u, `before stable ${ctx.ver}`); fs.writeFileSync(mf, after); }   // undo goes back to beta
    r.status = r.status === 'OK' ? 'PROMOTED' : r.status; r.how = [r.how, 'moved to stable APIs (survives updates)'].filter(Boolean).join('; '); taskNote(k, u, `${ctx.ver}: moved to stable APIs`);
  } else { fs.writeFileSync(mf, before); const why = (await import('./build.mjs')).betaWhy([...mode.lines, ...t.lines]); r.beta = why; o.out(`  ${u}: stays on beta: ${why}`); }
}

export async function maintainCmd(args, out = console.log) {
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const sched = flag('--schedule');
  if (sched) { const at = flag('--at') ?? '04:17'; return schedule(sched, at, args, out); }
  const o = { out, labs: flag('--lab'), only: flag('-a'), to: flag('--to') ?? 'latest', from: flag('--from') ?? undefined, via: flag('--via'), model: flag('--model'), budget: flag('--budget'), turns: flag('--turns'),
    noAi: args.includes('--no-ai'), noLimit: args.includes('--no-limit'), noPromote: args.includes('--no-promote'), pr: args.includes('--pr') };
  o.dry = args.includes('--dry') || (o.to === 'preview' && !args.includes('--apply'));
  // --only-new (with --to preview, for a schedule): nothing to do until Mojang puts out a preview not checked yet
  const seenF = path.join(ROOT(), 'bds', '.lab', 'maintain', 'preview-seen');
  let preview = null;
  if (args.includes('--only-new') && o.to === 'preview') {
    try { preview = process.env.LAB_PREVIEW_VERSION || await (await import('./apidiff.mjs')).newestBds(true); } catch { /* offline */ }
    const seen = fs.existsSync(seenF) ? fs.readFileSync(seenF, 'utf8').trim() : '';
    if (!preview || preview === seen) { out(`OK no new preview${preview ? ` (${preview} was checked)` : ''}`); return true; }
  }
  // the quick health checks first (temp folders, stale locks, login leftovers, disk): quiet unless they repaired something
  try { const M = await import('./maint.mjs'); const q = await M.maint({ top: ROOT(), fix: true, only: M.QUICK }); q.lines.forEach((l) => out(l)); } catch { /* upkeep never blocks */ }
  const kinds = o.labs === 'all' ? Object.keys(UNITS) : o.labs ? o.labs.split(',') : [process.env.LAB_KIND || (() => { try { return fs.readFileSync(path.join(ROOT(), '.lab-kind'), 'utf8').trim(); } catch { return 'bds'; } })()].map((x) => (UNITS[x] ? x : 'bds'));
  const { pickVia } = await import('./make.mjs');
  const ai = o.noAi ? null : pickVia(o.via);
  const rows = [], all = { tokens: 0 };
  for (const k of kinds) {
    if (!UNITS[k]) { out(`ERR --lab ${k}: bds, end, ll or all`); return false; }
    // the lab on the target release
    const verOf = (text) => (/OK bds (\d+\.\d+\.\d+\.\d+)/.exec(text) ?? /BDS[^\d\n]*(\d+\.\d+\.\d+\.\d+)/.exec(text) ?? /(\d+\.\d+\.\d+\.\d+)/.exec(text))?.[1] ?? null;
    const A = await import('./apidiff.mjs');
    const from = k === 'bds' ? (process.env.LAB_LABS_ROOT ? verOf(lab(k, ['bds']).text) : A.labBds()) : null;
    let prep = { ok: true, text: '' };
    if (o.to !== 'current') {
      out(`${k}: moving to ${o.to === 'latest' ? 'the newest release' : o.to}...`);
      prep = k === 'bds' ? lab(k, ['bds', ...(o.to === 'latest' ? ['--update'] : o.to === 'preview' ? ['--update', '--preview'] : [o.to])]) : lab(k, ['server', '--update']);
      if (!prep.ok) {
        // not the units' fault: the lab cannot run that release yet (the real client does not speak it, Endstone not out...).
        // The lab goes back to where it was, and it counts as waiting, not broken
        const why = prep.lines.filter((l) => /^(ERR|E )/.test(l)).slice(-2).join(' | ') || prep.lines.slice(-2).join(' | ');
        const wait = /does not speak|not (yet )?support|yet\b|no .* for BDS/i.test(why);
        out(`${wait ? 'W' : 'E'} ${k}: the lab cannot run ${o.to} ${wait ? 'yet' : ''}: ${why}`);
        if (k === 'bds' && from) { const back = lab(k, ['bds', from]); out(`${k}: back to BDS ${from}${back.ok ? '' : ' FAILED: ' + back.lines.slice(-1)}`); }
        rows.push({ lab: k, unit: '(lab)', status: wait ? 'WAIT' : 'BROKEN', how: why.slice(0, 200) });
        continue;
      }
    }
    const to = verOf(prep.text) ?? from;
    const ver = `${k === 'bds' ? 'BDS' : k === 'end' ? 'Endstone/BDS' : 'LeviLamina/BDS'} ${to ?? '?'}`;
    out(`${k}: ${ver}${from && from !== to ? ` (was ${from})` : ''}${o.dry ? ' — dry run: everything is put back afterwards' : ''}${ai ? '' : ' — no AI: autofix and limit only'}`);
    // the lab's own knowledge for the new BDS (versions, module versions, kb.json: refresh.mjs), before the units: no tokens
    if (k === 'bds' && !o.dry && from && to && from !== to) try { const M = await import('./maint.mjs'); const d = await M.maint({ top: ROOT(), fix: true, online: true, only: ['data', 'kb'] }); d.lines.forEach((l) => out(`  ${l}`)); if (d.lines.some((l) => l.startsWith('FIX'))) all.data = true; } catch { /* upkeep never blocks */ }
    const ctx = { ver, from, to, ai, tokens: 0 };
    const list = o.only ? o.only.split(',') : units(k);
    for (const u of list) {
      if (!fs.existsSync(unitDir(k, u))) { out(`  W ${u}: not in ${k}/${UNITS[k]}`); continue; }
      const r = await maintainUnit(k, u, o, ctx);
      if (!o.dry && !o.noPromote && k === 'bds' && ['OK', 'FIXED'].includes(r.status)) await promote(k, u, r, ctx, o);
      rows.push({ lab: k, ver: to, ...r });
      if (r.status === 'LABERR') { out(`✘ ${k}: the lab cannot test here: ${r.how}  (node lab.mjs doctor)`); break; }
      if (r.status !== 'LABERR') out(`${{ OK: '✔', FIXED: '🔧', LIMITED: '🟡', RESTORED: '♻', BROKEN: '✘', WAIT: '⏳', FLAKY: '〰', PROMOTED: '⬆' }[r.status]} ${k}/${u}: ${r.status}${r.how ? ' — ' + r.how : ''}${r.diff ? `  (${path.relative(ROOT(), r.diff).split(path.sep).join('/')})` : ''}`);
      for (const l of r.fail ?? []) out(`    ${l}`);
    }
    all.tokens += ctx.tokens;
    if (o.dry && o.to !== 'current' && from && k === 'bds') { out(`${k}: back to BDS ${from}`); lab(k, ['bds', from]); }
  }
  // the report
  const counts = Object.entries(rows.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})).map(([s, n]) => `${s} ${n}`).join(', ');
  const md = ['# bds-lab maintain', '', `${new Date().toISOString()} | ${counts}${all.tokens ? ` | AI ${all.tokens.toLocaleString('en')} tokens` : ''}${o.dry ? ' | dry run' : ''}`, '', '| lab | unit | result | what |', '|---|---|---|---|',
    ...rows.map((r) => `| ${r.lab} | ${r.unit} | ${r.status} | ${(r.how ?? '').replace(/\|/g, '/')} |`), ''].join('\n');
  const rf = path.join(ROOT(), kinds[0] ?? 'bds', '.lab', 'maintain', 'report.md');
  fs.mkdirSync(path.dirname(rf), { recursive: true }); fs.writeFileSync(rf, md);
  if (process.env.GITHUB_STEP_SUMMARY) try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* not ours */ }
  const broken = rows.filter((r) => r.status === 'BROKEN' || r.status === 'LABERR'), changed = rows.filter((r) => r.cp && ['FIXED', 'LIMITED', 'PROMOTED'].includes(r.status) || r.status === 'RESTORED');
  out(`${broken.length ? 'FAIL' : 'OK'} maintain: ${counts || 'no units'}${all.tokens ? ` (AI ${all.tokens.toLocaleString('en')} tokens)` : ''} → ${path.relative(ROOT(), rf).split(path.sep).join('/')}${changed.length && !o.dry ? ' | 戻すとき: node lab.mjs undo -a <unit>' : ''}`);
  try { const N = await import('./notify.mjs'); await N.notify(`maintain: ${counts || 'no units'}`, rows.filter((r) => r.status !== 'OK').map((r) => `${r.lab}/${r.unit}: ${r.status}${r.how ? ' — ' + r.how : ''}`).slice(0, 20), { ok: !broken.length, out }); } catch { /* best-effort */ }
  if (preview) { fs.mkdirSync(path.dirname(seenF), { recursive: true }); fs.writeFileSync(seenF, preview + '\n'); }
  if (o.pr && (changed.length || all.data) && !o.dry) pullRequest(rows, md, out, all.data);
  return !broken.length;
}

// CI: the fixed units on a branch maintain/<version> and one pull request (updated in place on the next run)
function pullRequest(rows, md, out, data = false) {
  const DRY = Boolean(process.env.LAB_CI_DRY);
  const run = (c, a, input) => { if (DRY) { out(`DRY ${c} ${a.join(' ')}`); return { status: 0, stdout: '' }; } return spawnSync(c, a, { cwd: ROOT(), encoding: 'utf8', input }); };
  const ver = String(rows.find((r) => r.ver)?.ver ?? today()).replace(/[^\w.-]/g, '');
  const branch = `maintain/${ver}`, paths = [...new Set(rows.filter((r) => ['FIXED', 'LIMITED', 'RESTORED', 'PROMOTED'].includes(r.status)).map((r) => `${r.lab}/${UNITS[r.lab]}/${r.unit}`)), ...(data ? ['common/data'] : [])];
  const from = DRY ? null : spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT(), encoding: 'utf8' }).stdout?.trim();
  run('git', ['checkout', '-B', branch]);
  run('git', ['add', '--', ...paths]);
  run('git', ['-c', 'user.name=bds-lab', '-c', 'user.email=bds-lab@users.noreply.github.com', 'commit', '-m', `maintain: ${ver}\n\n${rows.filter((r) => r.status !== 'OK').map((r) => `${r.lab}/${r.unit}: ${r.status} ${r.how ?? ''}`).join('\n')}`]);
  run('git', ['push', '-f', 'origin', branch]);
  const open = run('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number', '-q', '.[0].number']).stdout?.trim();
  if (open) run('gh', ['pr', 'edit', open, '--body-file', '-'], md); else run('gh', ['pr', 'create', '--head', branch, '--title', `maintain: 最新版 ${ver} への対応`, '--body-file', '-'], md);
  if (from && from !== 'HEAD' && from !== branch) run('git', ['checkout', '-q', from]);   // back where it was (a local --pr run stays on its branch)
  out(`PR: ${branch}${open ? ` (#${open} updated)` : ''}`);
}
