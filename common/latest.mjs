#!/usr/bin/env node
// Every update, every unit (.github/workflows/latest.yml, on a schedule):
//   node common/latest.mjs probe          newest BDS (Mojang), Endstone (PyPI), LeviLamina (GitHub) → GITHUB_OUTPUT + JSON
//   node common/latest.mjs run <bds|end|ll>   put that lab on the newest release, then:
//        the release does not run the newest BDS yet → "wait" (exit 0; the next scheduled run looks again, until it does)
//        it does → test + pack every unit on it → "ok" (exit 0) or "fail" (exit 1, an issue says which units)
//        the newest BDS is unknown (Mojang down) → "retry" (exit 0, not remembered)
// The workflow keys a cache on (lab, newest BDS, newest lab release, the units): an ok/wait result is not redone until one
// of them changes; a failure is (next run). LAB_LATEST_FIXTURE=<json>: probe answers from it (tests); LAB_CI_DRY=1: gh printed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = process.env.LAB_LATEST_LABS || path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // (tests: fake labs)
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' }, WORD = { bds: 'アドオン', end: 'Endstone プラグイン', ll: 'LeviLamina mod' };
const out = (s) => console.log(s);
const ver4 = (s) => /(\d+\.\d+\.\d+\.\d+)/.exec(s ?? '')?.[1] ?? null;
const fam = (v) => (v ?? '').split('.').slice(0, 3).join('.');
// a.b.c(.d) compared as numbers; missing parts are 0
export const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); } return 0; };
// the lab runs the newest game when its BDS is of the newest family (1.26.52.x): hotfix builds speak the same protocol
export const supports = (labBds, newest) => Boolean(labBds && newest) && cmp(fam(labBds), fam(newest)) >= 0;
// LeviLamina a.b.c is built for Minecraft 1.a.b (26.51.5 → BDS 1.26.51.x)
export const llFamily = (llv) => { const m = /^v?(\d+)\.(\d+)/.exec(llv ?? ''); return m ? `1.${m[1]}.${m[2]}` : null; };

async function json(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'bds-lab', accept: 'application/json', ...(process.env.GITHUB_TOKEN && url.includes('api.github.com') ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
export async function probe() {
  if (process.env.LAB_LATEST_FIXTURE) return JSON.parse(fs.readFileSync(process.env.LAB_LATEST_FIXTURE, 'utf8'));
  const p = { bds: null, endstone: null, ll: null };
  try { const j = await json('https://net-secondary.web.minecraft-services.net/api/v1.0/download/links'); p.bds = ver4(j.result.links.find((l) => l.downloadType === 'serverBedrockLinux')?.downloadUrl); } catch (e) { out(`W bds: ${e.message}`); }
  try { p.endstone = (await json('https://pypi.org/pypi/endstone/json')).info.version; } catch (e) { out(`W endstone: ${e.message}`); }
  try { p.ll = String((await json('https://api.github.com/repos/LiteLDev/LeviLamina/releases/latest')).tag_name).replace(/^v/, ''); } catch (e) { out(`W levilamina: ${e.message}`); }
  return p;
}

const lab = (k, args, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(TOP, k, 'lab.mjs'), ...args], { cwd: path.join(TOP, k), encoding: 'utf8', maxBuffer: 256e6, env: { ...process.env, LAB_NO_LASTFAIL: '1', ...env } });
  return { ok: r.status === 0, text: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const units = (k) => { try { return fs.readdirSync(path.join(TOP, k, UNITS[k])).filter((n) => !n.startsWith('.') && fs.statSync(path.join(TOP, k, UNITS[k], n)).isDirectory()).sort(); } catch { return []; } };
const put = (file, s) => { if (file) fs.appendFileSync(file, s); };

function gh(args, input) {
  if (process.env.LAB_CI_DRY || !process.env.GITHUB_REPOSITORY) { out(`DRY gh ${args.join(' ')}`); return { status: 0, stdout: '' }; }
  return spawnSync('gh', args, { encoding: 'utf8', input });
}
// one open issue per lab: opened on a failure, commented on the next ones, closed when all pass again
// (LAB_NOTIFY_WEBHOOK hears when it starts failing and when it passes again, not every retry)
async function issue(k, ok, body) {
  const title = `最新版で動かない${WORD[k]}があります（${k}）`;
  const found = gh(['issue', 'list', '--state', 'open', '--search', `in:title "${title}"`, '--json', 'number', '-q', '.[0].number']).stdout.trim();
  if (!ok) found ? gh(['issue', 'comment', found, '--body-file', '-'], body) : gh(['issue', 'create', '--title', title, '--body-file', '-'], body);
  else if (found) gh(['issue', 'close', found, '--comment', '最新版で全部通りました。']);
  if ((!ok && !found) || (ok && found)) {
    const { notify } = await import('./notify.mjs');
    await notify(ok ? `最新版で全部通りました（${k}）` : title, body.split('\n').filter((l) => /^(- |\| \S+ \| ✘)/.test(l)).slice(0, 15), { ok, out });
  }
}

export async function run(k, p) {
  if (!UNITS[k]) throw new Error(`run <bds|end|ll>, not ${k}`);
  const newest = p.bds;
  if (!newest) return { result: 'retry', why: 'the newest BDS is unknown (Mojang did not answer): the next run tries again' };
  // 1. the lab on its newest release
  let prep;
  if (k === 'bds') prep = lab(k, ['bds', newest]);
  else if (k === 'end') prep = lab(k, ['server', '--update'], p.endstone ? { LAB_ENDSTONE: `endstone==${p.endstone}` } : {});
  else {
    if (p.ll && !supports(`${llFamily(p.ll)}.0`, newest)) return { result: 'wait', labBds: `${llFamily(p.ll)}.x`, why: `LeviLamina ${p.ll} is for ${llFamily(p.ll)}.x, the newest BDS is ${newest}` };
    prep = lab(k, ['server', '--update'], p.ll ? { LAB_LL_VERSION: p.ll } : {});
  }
  const labBds = ver4(/BDS[^\d\n]*(\d+\.\d+\.\d+\.\d+)/.exec(prep.text)?.[1] ?? prep.text);
  if (!prep.ok) return { result: 'fail', labBds, why: `the ${k} lab did not set up on its newest release`, log: prep.text.trim().split('\n').slice(-12).join('\n') };
  if (!supports(labBds, newest)) return { result: 'wait', labBds, why: `${k === 'end' ? `Endstone ${p.endstone ?? ''}` : k} runs BDS ${labBds}, the newest is ${newest}` };
  // 2. every unit on it
  const rows = [];
  for (const u of units(k)) {
    const t = lab(k, ['test', '-a', u, ...(k === 'end' ? ['--cov'] : [])]);
    const pk = t.ok ? lab(k, ['pack', '-a', u]) : { ok: false, text: '' };
    const why = t.ok ? (pk.ok ? '' : 'pack: ' + pk.text.trim().split('\n').pop()) : t.text.split('\n').filter((l) => /^(✘|FAIL|ERR|E |  want|  got)/.test(l)).slice(0, 6).join(' / ').slice(0, 400);
    rows.push({ unit: u, ok: t.ok && pk.ok, why });
    out(`${t.ok && pk.ok ? '✔' : '✘'} ${u}${why ? '  ' + why : ''}`);
  }
  return { result: rows.every((r) => r.ok) ? 'ok' : 'fail', labBds, rows };
}

function report(k, p, r) {
  const head = `## ${k}: ${{ ok: '✔ 最新版で全部通りました', wait: '⏳ 最新版への対応待ち（次の定期実行でまた確かめます）', retry: '… 最新版が分かりませんでした（次の定期実行でまた）', fail: '✘ 最新版で動かないものがあります' }[r.result]}`;
  const lines = [head, '', `- 最新の BDS: ${p.bds ?? '?'}${k === 'end' ? ` / Endstone ${p.endstone ?? '?'}` : k === 'll' ? ` / LeviLamina ${p.ll ?? '?'}` : ''}`, `- ラボの BDS: ${r.labBds ?? '?'}`];
  if (r.why) lines.push(`- ${r.why}`);
  if (r.rows) lines.push('', `| ${WORD[k]} | 結果 |`, '|---|---|', ...r.rows.map((x) => `| ${x.unit} | ${x.ok ? '✔' : '✘ ' + x.why.replace(/\|/g, '/')} |`));
  if (r.log) lines.push('', '```', r.log, '```');
  if (r.result === 'fail' && r.rows) lines.push('', `直す: \`node lab.mjs maintain --lab ${k}\`（モジュールの版 → AI のパッチ → 制限モード。GitHub ではこのあと自動でプルリクエストになります）`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, k] = process.argv.slice(2);
  const p = await probe();
  if (cmd === 'probe') {
    out(JSON.stringify(p));
    put(process.env.GITHUB_OUTPUT, `bds=${p.bds ?? ''}\nendstone=${p.endstone ?? ''}\nll=${p.ll ?? ''}\n`);
  } else if (cmd === 'run') {
    const r = await run(k, p);
    const md = report(k, p, r);
    out(md);
    put(process.env.GITHUB_STEP_SUMMARY, md);
    put(process.env.GITHUB_OUTPUT, `result=${r.result}\n`);
    if (r.result === 'ok' || r.result === 'fail') await issue(k, r.result === 'ok', md);
    process.exit(r.result === 'fail' ? 1 : 0);
  } else { out('usage: node common/latest.mjs probe | run <bds|end|ll>'); process.exit(2); }
}
