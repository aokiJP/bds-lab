// node lab.mjs maint [--fix] [--online] [--only a,b]: seventeen checks that keep a lab healthy; --fix repairs what is safe to repair.
// Silent when all is well (one line); otherwise one line per finding: FIX (repaired) / W (needs you, with the command).
// `app run` runs the quick, safe ones by itself (temp, locks, logins, disk); .github/workflows/maint.yml runs all weekly.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const H = 3600_000, GB = 1024 ** 3;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const size = (p) => { let n = 0; try { const st = fs.lstatSync(p); if (!st.isDirectory()) return st.size; for (const e of fs.readdirSync(p)) n += size(path.join(p, e)); } catch { /* gone */ } return n; };
const gb = (n) => `${(n / GB).toFixed(n < GB ? 2 : 1)} GB`;
const rm = (p) => { const n = size(p); fs.rmSync(p, { recursive: true, force: true }); return n; };
const old = (p, ms) => { try { return Date.now() - fs.statSync(p).mtimeMs > ms; } catch { return false; } };
const LABS = ['bds', 'end', 'll'];
// the test suites' own temp folders (a killed run leaves them: once they filled a disk)
const TEMP = /^(bdslab-|app-offline-|device-offline-|lan-offline-|latest-offline-|update-offline-|nc-(acc|bds|snap|worlds)-|nnc-|lab-import-|lab-colony-|mcw-(world|conv)-)/;
const TOKEN_TEXT = /(aas_et\/[A-Za-z0-9_-]{20,}|oauth2_4\/[A-Za-z0-9_-]{20,})/;
const SKIP_DIR = /^(\.git|node_modules|\.lab|\.lab-node|dist|runs)$/;

/** @returns {Array<{id, ok, msg?, fix?:() => string}>} ctx: { top, tmp, now, probe? } */
export const CHECKS = {
  // 1. temp folders the tests left behind (older than an hour: never one that is running)
  temp: (c) => { const d = fs.readdirSync(c.tmp).filter((n) => TEMP.test(n) && old(path.join(c.tmp, n), H)).map((n) => path.join(c.tmp, n)); return d.length ? { ok: false, msg: `試験の一時フォルダ ${d.length} 個`, fix: () => `一時フォルダ ${d.length} 個を削除（${gb(d.reduce((n, p) => n + rm(p), 0))}）` } : { ok: true }; },
  // 2. old app runs: the newest 20 and the last 14 days are kept
  runs: (c) => {
    const dir = path.join(c.top, 'app', 'runs'); if (!fs.existsSync(dir)) return { ok: true };
    const all = fs.readdirSync(dir).map((n) => path.join(dir, n)).sort().reverse();
    const d = all.filter((p, i) => i >= 20 || old(p, 14 * 24 * H));
    return d.length ? { ok: false, msg: `古い app の結果 ${d.length} 個`, fix: () => `古い app の結果 ${d.length} 個を削除（${gb(d.reduce((n, p) => n + rm(p), 0))}）` } : { ok: true };
  },
  // 2b. bench workspaces (bds/runs/<id>/: a whole copy of the lab per run, hundreds of MB each): the result is in
  //     bench/ranking.json and <id>.json; the folder is not needed once the run is an hour old
  bench: (c) => {
    const dir = path.join(c.top, 'bds', 'runs'); if (!fs.existsSync(dir)) return { ok: true };
    const d = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && old(path.join(dir, e.name), H)).map((e) => path.join(dir, e.name));
    return d.length ? { ok: false, msg: `終わったベンチの作業フォルダ ${d.length} 個（結果は bench/ranking.json に残っています）`, fix: () => `ベンチの作業フォルダ ${d.length} 個を削除（${gb(d.reduce((n, p) => n + rm(p), 0))}）` } : { ok: true };
  },
  // 2c. server instances made for another BDS build (an update leaves the old ones: a copy of the server's small files each)
  instances: (c) => {
    const d = [];
    for (const k of LABS) {
      const run = path.join(c.top, k, '.lab', 'run'); let want = ''; try { want = fs.readFileSync(path.join(c.top, k, '.lab', 'bds', 'VERSION'), 'utf8').trim(); } catch { continue; }
      if (!fs.existsSync(run)) continue;
      for (const e of fs.readdirSync(run, { withFileTypes: true })) { if (!e.isDirectory()) continue; const p = path.join(run, e.name); let v = ''; try { v = fs.readFileSync(path.join(p, 'VERSION'), 'utf8').trim(); } catch { /* none */ } let pid = 0; try { pid = Number(fs.readFileSync(p + '.lock', 'utf8')); } catch { /* not running: the lock holds the pid as text */ } if (want && !v.startsWith(want + ' ') && !(pid > 0 && alive(pid))) d.push(p); }
    }
    return d.length ? { ok: false, msg: `古い BDS 用のサーバー置き場 ${d.length} 個`, fix: () => `古い BDS 用のサーバー置き場 ${d.length} 個を削除（${gb(d.reduce((n, p) => n + rm(p), 0))}）` } : { ok: true };
  },
  // 2d. undo history: the newest 20 checkpoints of each unit; those of units that are gone, after 14 days
  checkpoints: (c) => {
    const d = [];
    for (const k of LABS) {
      const root = path.join(c.top, k, '.lab', 'checkpoints'); if (!fs.existsSync(root)) continue;
      const units = { bds: 'addons', end: 'plugins', ll: 'mods' }[k];
      for (const u of fs.readdirSync(root)) {
        const dir = path.join(root, u), ids = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).sort().reverse();
        const gone = !fs.existsSync(path.join(c.top, k, units, u));
        ids.forEach((id, i) => { const p = path.join(dir, id); if (i >= 20 || (gone && old(p, 14 * 24 * H))) d.push(p); });
      }
    }
    return d.length ? { ok: false, msg: `古いチェックポイント ${d.length} 個（各ユニットの新しい 20 個は残します）`, fix: () => `古いチェックポイント ${d.length} 個を削除（${gb(d.reduce((n, p) => n + rm(p), 0))}）` } : { ok: true };
  },
  // 2e. the BDS zip next to the same BDS unpacked: the zip is only needed to unpack it again (CI and `bundle` carry it in git)
  vendor: (c) => {
    const z = path.join(c.top, 'bds', 'vendor', 'bedrock-server.zip'); if (!fs.existsSync(z)) return { ok: true };
    let a = '', b = ''; try { a = fs.readFileSync(path.join(c.top, 'bds', 'vendor', 'bds-version.txt'), 'utf8').trim(); b = fs.readFileSync(path.join(c.top, 'bds', '.lab', 'bds', 'VERSION'), 'utf8').trim(); } catch { return { ok: true }; }
    if (!a || a !== b) return { ok: true };
    // tracked by git (CI and `bundle` carry it, often with LFS): never deleted by --fix, a deleted tracked file breaks CI
    const tracked = (() => { try { return spawnSync('git', ['ls-files', '--error-unmatch', 'bds/vendor/bedrock-server.zip'], { cwd: c.top, stdio: 'ignore' }).status === 0; } catch { return false; } })();
    if (tracked) return { ok: true };
    return { ok: false, warn: true, msg: `BDS ${a} が zip（bds/vendor, ${gb(size(z))}）と展開済み（bds/.lab/bds）の 2 重。手元だけなら zip は要りません（git の LFS で持っているなら消さないで）`, fix: () => `bds/vendor/bedrock-server.zip を削除（${gb(rm(z))}。版の記録 bds-version.txt は残しました）` };
  },
  // 2f. colony (Crafters Colony): pages kept more than an hour are stale; with clean --deep also what was got (downloads,
  //     packs taken out, courses), which a person can get again
  colony: (c) => {
    const dir = path.join(c.top, '.lab', 'colony'); if (!fs.existsSync(dir)) return { ok: true };
    const d = c.deep ? fs.readdirSync(dir).filter((n) => n !== 'throttle.json').map((n) => path.join(dir, n))
      : (() => { try { return fs.readdirSync(path.join(dir, 'cache')).map((n) => path.join(dir, 'cache', n)).filter((p) => old(p, H)); } catch { return []; } })();
    return d.length ? { ok: false, msg: c.deep ? `colony で取ったもの ${d.length} 個（.lab/colony）` : `colony の古いページの控え ${d.length} 個`, fix: () => `colony の${c.deep ? '取ったもの' : '古い控え'} ${d.length} 個を削除（${gb(d.reduce((n, p) => n + rm(p), 0))}）` } : { ok: true };
  },
  // 2g. files an earlier release shipped and the installed one says are gone, still here exactly as shipped: an update done by
  //     an older lab deleted nothing (and `share` would ship them again). An edited one, a unit, a cache, a secret and what
  //     extras.json lists (put back on purpose from the extras zip) are never touched
  leftovers: async (c) => {
    const U = await import('./update.mjs'), d = U.leftovers(c.top);
    return d.length ? { ok: false, msg: `古いリリースにだけあったファイル ${d.length} 個（手を入れていない。前の update が古い版で消さなかったもの: ${d.slice(0, 3).join(' ')}${d.length > 3 ? ' …' : ''}）`, fix: () => `古いリリースにだけあったファイル ${U.removeLeftovers(c.top, d).removed} 個を削除` } : { ok: true };
  },
  // 3. locks and pid files of processes that are gone (a crash leaves them; the next run then refuses or waits)
  locks: (c) => {
    const f = [path.join(c.top, 'app', '.lab', 'run.lock'), path.join(c.top, 'app', '.lab', 'emulator.json'), ...LABS.map((k) => path.join(c.top, k, '.lab', 'live.json'))]
      .filter((p) => { const j = readJson(p); return j && j.pid && !alive(j.pid); });
    return f.length ? { ok: false, msg: `止まったプロセスの記録 ${f.length} 個`, fix: () => { f.forEach((p) => fs.rmSync(p, { force: true })); return `止まったプロセスの記録 ${f.length} 個を削除`; } } : { ok: true };
  },
  // 4. browser profiles of an interrupted Google login (they hold a signed-in session: never left on disk)
  logins: (c) => {
    const dir = path.join(c.top, 'app', '.lab', 'browser'); if (!fs.existsSync(dir)) return { ok: true };
    const d = fs.readdirSync(dir).filter((n) => (n.startsWith('login-') && old(path.join(dir, n), 10 * 60_000)) || (/^stall-.*\.png$/.test(n) && old(path.join(dir, n), 24 * H))).map((n) => path.join(dir, n));   // (+ the pictures of a stalled login, a day later)
    return d.length ? { ok: false, msg: `ログイン途中のブラウザの記録 ${d.length} 個（Google のセッション）`, fix: () => { d.forEach(rm); return `ログイン途中のブラウザの記録 ${d.length} 個を削除`; } } : { ok: true };
  },
  // 5. free disk space (BDS, the emulator and the APK need several GB): after the fixes above, still under 5 GB → say so
  disk: (c) => { try { const s = fs.statfsSync(c.top); const free = s.bavail * s.bsize; return free < 5 * GB ? { ok: false, msg: `空き容量が ${gb(free)}（5 GB 以上を推奨）。不要なら: node lab.mjs cache export 後に各 .lab を削除`, warn: true } : { ok: true }; } catch { return { ok: true }; } },
  // 6. the token file: only you may read it; git must ignore it
  secrets: (c) => {
    const env = path.join(c.top, '.env.local'), gi = path.join(c.top, '.gitignore'), out = [];
    const loose = process.platform !== 'win32' && fs.existsSync(env) && (fs.statSync(env).mode & 0o077) !== 0;
    const ignored = fs.existsSync(gi) && /^\.env\.local$/m.test(fs.readFileSync(gi, 'utf8'));
    if (loose) out.push('.env.local が他の人にも読める');
    if (!ignored) out.push('.gitignore に .env.local が無い');
    return out.length ? { ok: false, msg: out.join('、'), fix: () => { if (loose) fs.chmodSync(env, 0o600); if (!ignored) fs.appendFileSync(gi, '\n.env\n.env.local\n*.apk\n'); return `${out.join('、')} → 直しました`; } } : { ok: true };
  },
  // 7. a token pasted into a file git would commit (not auto-fixed: which file is yours to decide)
  leaks: async (c) => {
    const hits = [];
    const walk = (d, r) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIR.test(e.name) || hits.length > 5) continue;
      const p = path.join(d, e.name), rr = r ? `${r}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, rr);
      else if (e.isFile() && !/^\.env/.test(e.name) && /\.(m?js|cjs|ts|json|jsonl|md|txt|ya?ml|sh|py|toml|lua|ini)$/.test(e.name) && fs.statSync(p).size < 2e6) {
        const t = fs.readFileSync(p, 'utf8'), h = TOKEN_TEXT.test(t) ? [{ what: 'Google token' }] : c.scan ? c.scan.findIn(t, c.own).filter((x) => !x.warn) : [];
        if (h.length) hits.push(`${rr}（${[...new Set(h.map((x) => x.what))].join('・')}）`);
      }
    } };
    try { c.scan = await import('./secret-scan.mjs'); c.own = c.scan.ownSecrets(c.top); } catch { c.scan = null; }
    walk(c.top, '');
    return hits.length ? { ok: false, warn: true, msg: `鍵・トークンらしい文字列: ${hits.join(' ')}（消してください。漏れた鍵は発行元で作り直す。Google のトークンは node lab.mjs app token --force）` } : { ok: true };
  },
  // 8. scripts must stay runnable (an unzip on some systems drops the bit)
  exec: (c) => {
    if (process.platform === 'win32') return { ok: true };
    const f = ['lab.sh', 'setup.sh', 'verify.command', 'tests/fake/app/adb', 'tests/fake/app/browser.mjs'].map((r) => path.join(c.top, r)).filter((p) => fs.existsSync(p) && (fs.statSync(p).mode & 0o100) === 0);
    return f.length ? { ok: false, msg: `実行できないスクリプト ${f.length} 個`, fix: () => { f.forEach((p) => fs.chmodSync(p, 0o755)); return `スクリプト ${f.length} 個を実行可能に`; } } : { ok: true };
  },
  // 9. the Google token's shape (the usual paste mistakes), before a download fails on it
  token: async (c) => {
    const K = await import('../app/lib/apk.mjs');
    K.loadEnv([path.join(c.top, '.env.local')], c.env);
    const p = K.playCredentials(c.env);
    return p.problems.length || p.partial ? { ok: false, warn: true, msg: `Google の認証: ${p.problems.join(' / ') || '片方だけ'}（node lab.mjs app token --force）` } : { ok: true };
  },
  // 10. newer releases (--online): the game server, Endstone, LeviLamina, and the lab's own pinned tools
  updates: async (c) => {
    if (!c.online) return { ok: true, skipped: true };
    const L = await import('./latest.mjs'), K = await import('../app/lib/apk.mjs'), P = await import('../app/lib/playwright-login.mjs');
    const p = c.probe ?? await L.probe(), have = [];
    const bds = (() => { try { return fs.readFileSync(path.join(c.top, 'bds', 'vendor', 'bds-version.txt'), 'utf8').trim(); } catch { return null; } })();
    if (p.bds && bds && L.cmp(p.bds, bds) > 0) have.push(`BDS ${p.bds}（いま ${bds}: node lab.mjs bds ${p.bds}）`);
    const npm = async (n) => { try { return (await (await fetch(`https://registry.npmjs.org/${n}/latest`, { signal: AbortSignal.timeout(15000) })).json()).version; } catch { return null; } };
    const pwv = c.probe?.playwright ?? await npm('playwright-core');
    if (pwv && L.cmp(pwv, P.PW_VERSION) > 0) have.push(`playwright-core ${pwv}（固定 ${P.PW_VERSION}: app/lib/playwright-login.mjs）`);
    const apk = c.probe?.apkeep ?? await (async () => { try { return (await (await fetch('https://formulae.brew.sh/api/formula/apkeep.json', { signal: AbortSignal.timeout(15000) })).json()).versions.stable; } catch { return null; } })();
    if (apk && L.cmp(apk, K.APKEEP_VERSION) > 0) have.push(`apkeep ${apk}（固定 ${K.APKEEP_VERSION}: app/lib/apk.mjs のハッシュも更新）`);
    return have.length ? { ok: false, warn: true, msg: `新しい版: ${have.join(' / ')}` } : { ok: true };
  },
  // 11. two units with the same pack UUIDs (a copied folder, an addon imported twice): a world keeps only one of them. --fix gives
  //     the newer one (by folder age) its own; not automatic: a copy meant as an update of the same pack needs the same UUIDs
  uuids: (c) => {
    const dir = path.join(c.top, 'bds', 'addons'), ids = (u) => ['bp', 'rp'].flatMap((p) => { const j = readJson(path.join(dir, u, p, 'manifest.json')); return j?.header ? [j.header.uuid, ...(j.modules ?? []).map((x) => x.uuid)].filter((x) => x && x !== TEMPLATE_UUID) : []; });
    let names = []; try { names = fs.readdirSync(dir).filter((n) => !n.startsWith('.') && fs.existsSync(path.join(dir, n, 'bp', 'manifest.json'))); } catch { return { ok: true }; }
    const age = (n) => { const st = fs.statSync(path.join(dir, n)); return st.birthtimeMs || st.ctimeMs; };
    const owner = new Map(), dup = [];
    for (const n of names.sort((a, b) => age(a) - age(b) || a.localeCompare(b))) { const mine = ids(n), clash = mine.find((x) => owner.has(x)); if (clash) dup.push([n, owner.get(clash)]); else mine.forEach((x) => owner.set(x, n)); }
    return dup.length ? { ok: false, msg: `同じパック UUID のユニット: ${dup.map(([a, b]) => `${a}（${b} と同じ）`).join('、')}。ワールドには片方しか入りません`, fix: () => { for (const [n] of dup) renewUuids(path.join(dir, n)); return `${dup.map(([a]) => a).join('、')} に新しい UUID（同じものを更新として配るなら node lab.mjs undo）`; } } : { ok: true };
  },
  // 12. the lab's knowledge of the world (common/data/kb.json, the goal planner) is for an older BDS than the lab runs: --fix
  //     rebuilds it on the lab's BDS (one short server session; maintain does it by itself after an update)
  kb: async (c) => {
    const R = await import('./refresh.mjs'), st = R.kbState(c.top);
    return st.stale ? { ok: false, msg: `common/data/kb.json は BDS ${st.kb} のもの（ラボは ${st.bds}）`, fix: () => { const r = R.rebuildKb(c.top); if (!r.ok) throw new Error(r.line); return `kb.json を BDS ${st.bds} で作り直しました（${r.line.replace(/^OK /, '')}）`; } } : { ok: true };
  },
  // 13. (--online) the versions the lab falls back on without network: BDS versions and @minecraft/* modules for the lab's BDS
  data: async (c) => {
    if (!c.online) return { ok: true, skipped: true };
    const R = await import('./refresh.mjs'), A = await import('./apidiff.mjs'), bds = R.labBds(c.top);
    if (!bds) return { ok: true };
    const tmp = path.join(c.tmp, `bdslab-env-data-${process.pid}`);
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(path.join(tmp, 'common', 'data'), { recursive: true });
    for (const f of ['bds-versions.json', 'minecraft-modules.json']) try { fs.copyFileSync(path.join(c.top, 'common', 'data', f), path.join(tmp, 'common', 'data', f)); } catch { /* none */ }
    const preview = (() => { try { return JSON.parse(fs.readFileSync(path.join(c.top, 'common', 'data', 'bds-versions.json'), 'utf8')).linux.preview_versions.includes(bds); } catch { return false; } })();
    let v = '', mods = [];
    const now = {};
    try { v = [R.addVersion(tmp, bds, { preview }), ...(await Promise.all([false, true].map((pv) => A.newestBds(pv).then((x) => (x ? R.addVersion(tmp, x, { preview: pv }) : ''), () => ''))))].filter(Boolean).join(', '); mods = await R.refreshModules(tmp, bds, (n) => A.npmDoc(n)); for (const f of ['bds-versions.json', 'minecraft-modules.json']) try { now[f] = fs.readFileSync(path.join(tmp, 'common', 'data', f)); } catch { /* none */ } } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    const msg = [v && `bds-versions.json ${v}`, mods.length && `minecraft-modules.json ${mods.slice(0, 4).join(', ')}${mods.length > 4 ? ` +${mods.length - 4}` : ''}`].filter(Boolean);
    if (!msg.length) return { ok: true };
    return { ok: false, msg: `古い控え: ${msg.join(' / ')}`, fix: () => { for (const [f, b] of Object.entries(now)) fs.writeFileSync(path.join(c.top, 'common', 'data', f), b); return `BDS ${bds} の知識: ${msg.join(' / ')}`; } };
  },
};
const TEMPLATE_UUID = 'a1b2c3d4-0000-4000-8000-000000000001';
/** new UUIDs for one unit's packs (header + modules), and its own BP → RP dependency follows */
export function renewUuids(unit) {
  const map = new Map(), files = ['bp', 'rp'].map((p) => path.join(unit, p, 'manifest.json')).filter((f) => fs.existsSync(f));
  for (const f of files) { const j = readJson(f); for (const x of [j?.header, ...(j?.modules ?? [])]) if (x?.uuid && x.uuid !== TEMPLATE_UUID) map.set(x.uuid, crypto.randomUUID()); }
  for (const f of files) { let t = fs.readFileSync(f, 'utf8'); for (const [a, b] of map) t = t.split(a).join(b); fs.writeFileSync(f, t); }
  return map.size;
}
export const QUICK = ['temp', 'bench', 'instances', 'locks', 'logins', 'disk'];   // safe and fast: run before heavy work

/** runs the checks; returns { lines, problems } (problems = findings not repaired) */
export async function maint({ top, fix = false, online = false, only = null, tmp = os.tmpdir(), env = { ...process.env }, probe, deep = false } = {}) {
  const lines = []; let problems = 0;
  for (const [id, check] of Object.entries(CHECKS)) {
    if (only && !only.includes(id)) continue;
    let r;
    try { r = await check({ top, tmp, env, online, probe, deep }); } catch (e) { r = { ok: false, warn: true, msg: `調べられません: ${e.message}` }; }
    if (r.ok) continue;
    if (fix && r.fix) { try { lines.push(`FIX ${id}: ${await r.fix()}`); continue; } catch (e) { r.msg += `（直せません: ${e.message}）`; } }
    problems++;
    lines.push(`W ${id}: ${r.msg}${r.fix && !fix ? '（--fix で直します）' : ''}`);
  }
  return { lines, problems };
}

export async function maintCmd(top, args, out = console.log) {
  const fix = args.includes('--fix'), online = args.includes('--online'), oi = args.indexOf('--only'), only = oi >= 0 ? (args[oi + 1] ?? '').split(',') : null;
  const bad = args.filter((a, i) => !['--fix', '--online', '--only'].includes(a) && !(oi >= 0 && i === oi + 1)).concat((only ?? []).filter((x) => !CHECKS[x]));
  if (bad.length) { out(`ERR maint: 知らない指定 ${bad.join(' ')}（使い方: node lab.mjs maint [--fix] [--online] [--only ${Object.keys(CHECKS).join(',')}]）`); return false; }
  const r = await maint({ top, fix, online, only });
  r.lines.forEach((l) => out(l));
  out(r.problems ? `W maint: ${r.problems} 件（上の行）` : `OK maint: ${Object.keys(CHECKS).length} 項目${online ? '' : '（--online で新しい版も）'}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## maint', '', ...r.lines.map((l) => `- ${l}`), r.problems ? '' : '- 問題なし', ''].join('\n'));
  return !r.problems;
}
