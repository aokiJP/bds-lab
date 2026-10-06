// node lab.mjs upkeep: the one command for keeping bds-lab working — for a person and for an AI alike. In order:
//   1 点検   the health checks, repairing what is safe (maint --fix: temp folders, locks, logins, leaked tokens, scripts ...)
//   2 片付け what can be rebuilt (finished bench folders, old app results, servers of an older BDS, old checkpoints)
//   3 最新版 every lab on the newest Minecraft / Endstone / LeviLamina, every unit tested there, what broke fixed
//            (module versions → AI patch → limited mode; the old tests are never changed), the lab's knowledge refreshed
//   4 結果   one screen: what changed, what still fails, and the one next command
//   --check            change nothing: the checks, what cleaning would free, whether a newer Minecraft is out
//   --auto daily|weekly|off [--at HH:MM]   this machine does it by itself (cron / Task Scheduler), results to LAB_NOTIFY_WEBHOOK
//   --no-ai            step 3 without an AI (module versions and limited mode only)   --lab bds|end|ll|all (default all)
// The tools it runs stay there for details: maint, clean, maintain, apidiff, flaky, undo (`help upkeep`).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = process.env.LAB_UPKEEP_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lab = (args, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, encoding: 'utf8', maxBuffer: 256e6, timeout: 6 * 3600_000, env: { ...process.env, FORCE_COLOR: '0', LAB_NOTRACE: '1', ...env } });
  return { ok: r.status === 0, lines: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean) };
};
const pick = (lines, re, n = 6) => lines.filter((l) => re.test(l)).slice(0, n);

export async function upkeepCmd(args, out = console.log) {
  const a = [...args], flag = (k) => { const i = a.indexOf(k); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const auto = flag('--auto'), at = flag('--at') ?? '04:17', labs = flag('--lab') ?? 'all', check = a.includes('--check'), noAi = a.includes('--no-ai');
  if (auto) { const M = await import('./maintain.mjs'); return M.schedule(auto, at, [...(noAi ? ['--no-ai'] : []), ...(labs !== 'all' ? ['--lab', labs] : [])], out, 'upkeep'); }
  const t0 = Date.now(), next = [];
  // 1 点検
  const h = lab(['maint', ...(check ? ['--online'] : ['--fix'])]);
  // a check that could not reach the network is not a problem of this lab: said apart, never "要対応"
  const NET = /HTTP \d{3}|ENOTFOUND|EAI_AGAIN|ECONN|fetch failed|timed? ?out|network/i;
  const fixed = pick(h.lines, /^FIX /, 8), all = pick(h.lines, /^W /, 12), net = all.filter((l) => NET.test(l)), warn = all.filter((l) => !NET.test(l));
  out(`1/4 点検: ${warn.length ? `要対応 ${warn.length}` : '問題なし'}${fixed.length ? `（直したもの ${fixed.length}）` : ''}${net.length ? `（ネットワークで調べられなかったもの ${net.length}）` : ''}`);
  [...fixed, ...warn].forEach((l) => out(`    ${l}`));
  for (const l of warn) { const m = /node lab\.mjs [^）)\s][^）)]*/.exec(l); if (m) next.push(m[0].trim()); }
  // 2 片付け
  const c = lab(['clean', ...(check ? ['--dry'] : [])]);
  const cl = c.lines.at(-1) ?? '', freed = /([\d.]+ [MG]B) freed/.exec(cl)?.[1];
  out(`2/4 片付け: ${freed ? `${freed} 空けました` : /would free/.test(cl) ? `空けられるもの ${c.lines.filter((l) => /^(W|FIX) /.test(l)).length} 種類（node lab.mjs clean）` : '空けるものなし'}`);
  // 3 最新版 (+ the units)
  if (check) {
    const v = lab(['maint', '--online', '--only', 'updates']);
    const news = pick(v.lines, /^W /, 6).filter((l) => !NET.test(l)), unreached = pick(v.lines, /^W /, 6).filter((l) => NET.test(l));
    out(`3/4 最新版: ${news.length ? news.map((l) => l.replace(/^W \w+: /, '')).join(' / ') : '新しい版なし'}${unreached.length ? `（調べられなかったもの ${unreached.length}: ${unreached.map((l) => /^W (\w+)/.exec(l)?.[1]).join(' ')}）` : ''}`);
    out('4/4 結果: --check なので何も変えていません。直すなら: node lab.mjs upkeep');
    return !warn.length;
  }
  // bedrock-binary (if here): this BDS's binary read first, so after a move the new one can be compared with it
  const bbHere = fs.existsSync(path.join(TOP, 'bedrock-binary', 'src', 'cli.js'));
  if (bbHere) lab(['bb', '--quiet']);
  const m = lab(['maintain', '--lab', labs, ...(noAi ? ['--no-ai'] : [])]);
  const moved = pick(m.lines, /^(bds|end|ll): (BDS|Endstone|LeviLamina)/, 3), rows = pick(m.lines, /^(✔|🔧|🟡|♻|✘|⏳|〰|⬆) /, 200);
  const bad = rows.filter((l) => /^(✘|⏳)/.test(l)), changed = rows.filter((l) => /^(🔧|🟡|♻|⬆)/.test(l));
  out(`3/4 最新版: ${moved.map((l) => l.replace(/ — .*/, '')).join(' · ') || (m.lines.find((l) => /cannot run|WAIT/.test(l)) ?? '変化なし')}`);
  // what the new server binary changed (packet ids, commands, enum ids): one line, `bb diff` for all of it
  if (bbHere && moved.some((l) => /^bds: .*\(was /.test(l))) { const d = lab(['bb', 'diff', '--short']).lines.find((l) => /^binary /.test(l)); if (d) out(`    ${d} (node lab.mjs bb diff)`); }
  const sum = m.lines.filter((l) => /^(OK|FAIL) maintain: /.test(l)).at(-1)?.replace(/^(OK|FAIL) maintain: /, '').replace(/ → .*$/, '') ?? '';
  out(`4/4 ユニット: ${sum || 'なし'}`);
  [...changed, ...bad].slice(0, 12).forEach((l) => out(`    ${l}`));
  for (const l of bad) { const u = /^✘ (bds|end|ll)\/([\w-]+)/.exec(l); if (u) next.push(`node lab.mjs ${u[1]} why -a ${u[2]}`); }
  if (changed.length) next.push('戻すとき: node lab.mjs undo -a <ユニット>');
  // the skills (skills/knowledge.json): on a new Minecraft each rule's probe runs again on it (a rule the new server
  // contradicts is disputed and leaves SKILL.md); what failed and got fixed since becomes candidates (no tokens)
  if (fs.existsSync(path.join(TOP, 'skills', 'knowledge.json'))) try {
    const K = await import('./skills.mjs'), k = K.knowledge(), bv = (() => { try { return fs.readFileSync(path.join(TOP, 'bds', 'vendor', 'bds-version.txt'), 'utf8').trim(); } catch { return '?'; } })();
    const stale = k.rules.filter((r) => r.status !== 'retired' && r.evidence?.kind === 'probe' && r.verified?.bds !== bv);
    const v = stale.length ? lab(['skill', 'verify', 'probe']) : null, l = lab(['skill', 'learn']);
    const disputed = v ? v.lines.filter((x) => /^✘ /.test(x)) : [];
    out(`    skills: ${v ? `${v.lines.find((x) => /skill verify:/.test(x))?.replace(/^(PASS|FAIL) skill verify: /, '確かめ直し ') ?? '確かめ直し'}` : `規則は BDS ${bv} で確かめ済み`} · ${l.lines.find((x) => /skill learn:/.test(x))?.replace(/^OK skill learn: /, '') ?? ''}`);
    disputed.slice(0, 4).forEach((x) => out(`      ${x}`));
    if (disputed.length) next.push('node lab.mjs skill verify (実機と食い違う規則を直す)');
  } catch { /* no skills here */ }
  out(`${bad.length || warn.length ? 'FAIL' : 'OK'} upkeep (${Math.round((Date.now() - t0) / 1000)}s)${next.length ? ` · 次: ${next[0]}` : ' · 全部動いています'}`);
  return !bad.length;
}
