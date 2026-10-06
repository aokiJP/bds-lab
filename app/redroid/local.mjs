#!/usr/bin/env node
// redroid.yml's preparation on this Linux machine, in one command (no GitHub Actions): doctor → what is missing, in order
// (binder by modprobe, the image, the prepared device opened from its sealed file or made by prep). Each stage says what it
// does in one line before it does it, and how many seconds it took after.
//   node app/redroid/local.mjs [--dry-run] [--data d] [--file f] [--image t] [--bench [--rounds n]] [--addon a]
//     --dry-run   every stage and its commands, nothing run (doctor's facts are read: that changes nothing)
//     --data      the prepared device (app/redroid/.lab/data)   --file  its sealed file, opened when there (…/.lab/data.bin)
//     --bench     after it, game.mjs bench (restore → boot → the game's title, timed)
// Secrets: GOOGLE_EMAIL + GOOGLE_AAS_TOKEN (+ APP_CACHE_KEY) from the environment, else .env.local / .env (as app.mjs reads
// them); only whether each is there is printed, never a value. The children (game.mjs) get them through the environment.
// (redroid.yml's wait for the app workflow is GitHub's: not here. Exit 1 when something only a person can fix is missing.)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from './redroid.mjs';
import { loadEnv, redact } from '../lib/apk.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), LAB = path.join(HERE, '.lab');
const APPDIR = path.dirname(HERE), TOP = path.dirname(APPDIR);
const now = () => performance.now();
const secs = (ms) => Math.round(ms / 100) / 10;
const SECRET_KEYS = ['GOOGLE_EMAIL', 'GOOGLE_AAS_TOKEN', 'APP_CACHE_KEY'];
const SECRETS = (env = process.env) => SECRET_KEYS.map((k) => env[k]).filter(Boolean);
const rel = (p) => { const r = path.relative(process.cwd(), p); return !r ? '.' : r.startsWith('..') || path.isAbsolute(r) ? p : r; };
// the stages in the order they run (a plan never reorders them)
export const ORDER = ['doctor', 'binder', 'image', 'open', 'prep', 'bench'];
// what local.mjs fixes itself (doctor's other hard rows need a person: their fix is printed and it stops)
const OURS = ['binder', 'イメージ', 'Google の認証', '準備済みの端末'];
const BINDER = 'modprobe binder_linux devices=binder,hwbinder,vndbinder';

/** facts + options → {stages: [{id, say, cmds: [{argv, show}]}], blocked: [{name, detail, fix}]} in ORDER (pure:
 *  tests/rd-local-offline.mjs). f: hostFacts() + {sealed: the sealed file is there, key: a vault key is there, root};
 *  o: {data, file, image, bench, rounds, node, redroid, game, lab, kernel} */
export function plan(f, o) {
  const su = (argv) => (f.root ? argv : ['sudo', '-n', ...argv]);
  const suE = (argv) => (f.root ? argv : ['sudo', '-n', '-E', 'env', `PATH=${o.path ?? ''}`, ...argv]);
  const show = (argv) => argv.map((a) => (/^PATH=/.test(a) ? 'PATH=$PATH' : /[\s;|&{}$()]/.test(a) ? `'${a}'` : a)).join(' ');
  const cmd = (argv, shown) => ({ argv, show: shown ?? show(argv) });
  const stages = [{ id: 'doctor', say: '足りないものを調べる（読むだけ）', cmds: [] }];
  const blocked = R.doctor(f).filter((r) => !r.ok && !r.soft && !OURS.includes(r.name)).map(({ name, detail, fix }) => ({ name, detail, fix }));
  if (!f.binder || !f.overlay || !f.uinput) {
    const mods = [...(f.binder ? [] : [`${BINDER} || { apt-get install -y -qq linux-modules-extra-${o.kernel} && ${BINDER}; }`]), ...(f.overlay ? [] : ['modprobe overlay']), ...(f.uinput ? [] : ['modprobe uinput || true'])];
    const what = [...(f.binder ? [] : ['binder']), ...(f.overlay ? [] : ['overlay']), ...(f.uinput ? [] : ['uinput'])].join(' / ');
    stages.push({ id: 'binder', say: `カーネルの部品（${what}）を modprobe で入れる${f.binder ? '（無くても動くものだけ）' : '（無ければ linux-modules-extra を入れてから）'}`, cmds: [cmd(su(['sh', '-c', mods.join('; ')]))] });
  }
  if (!f.image) stages.push({ id: 'image', say: `イメージ ${o.image} を作る（redroid + MindTheGapps: 取得と docker build）`, cmds: [cmd([o.node, o.redroid, 'setup'], `node ${o.redroidShow} setup`)] });
  if (!f.prepared) {
    if (f.sealed && f.key) stages.push({ id: 'open', say: `準備済みの端末を ${o.fileShow} から戻す（暗号化を解く: 鍵は環境から、表示しません）`, cmds: [
      cmd(suE([o.node, o.game, 'open', '--data', o.data, '--file', o.file]), `${f.root ? '' : 'sudo -E '}node ${o.gameShow} open --data ${o.dataShow} --file ${o.fileShow}`),
      ...(f.root ? [] : [cmd(su(['chown', '-R', o.owner, o.lab]))]),
    ] });
    if (!f.account && !(f.sealed && f.key)) blocked.push({ name: 'Google の認証', detail: 'GOOGLE_EMAIL / GOOGLE_AAS_TOKEN がありません（準備済みの端末も、戻せるファイルもありません）', fix: 'node lab.mjs app token（または .env.local に GOOGLE_EMAIL / GOOGLE_AAS_TOKEN）' });
    stages.push({ id: 'prep', say: `準備済みの端末を作る（アカウント → checkin → Play がゲームを入れる → 初回の起動、約 8 分）${f.sealed && f.key ? ': open で戻せなかったときだけ' : ''}`, cmds: [cmd([o.node, o.game, 'prep', '--data', o.data, '--image', o.image], `node ${o.gameShow} prep --data ${o.dataShow} --image ${o.image}`)] });
  }
  if (o.bench) stages.push({ id: 'bench', say: `戻す → 起動 → ゲームのタイトルまでを ${o.rounds} 回計る`, cmds: [cmd([o.node, o.game, 'bench', '--data', o.data, '--image', o.image, '--rounds', String(o.rounds)], `node ${o.gameShow} bench --data ${o.dataShow} --image ${o.image} --rounds ${o.rounds}`)] });
  return { stages, blocked };
}

/** whether each secret is there, never its value (pure) */
export function secretsLine(env = process.env) {
  return SECRET_KEYS.map((k) => `${k} ${env[k] ? 'あり' : 'なし'}`).join('、') + '（値は出しません）';
}

/** the facts plan() judges: hostFacts() + the sealed file, the vault's key, root */
export function gather(o) {
  return { ...R.hostFacts({ data: o.data, image: o.image }), sealed: fs.existsSync(o.file), key: Boolean(process.env.APP_CACHE_KEY?.trim() || process.env.GOOGLE_AAS_TOKEN?.trim()), root: process.getuid?.() === 0 };
}
function execInherit(argv) {
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', env: process.env, timeout: 60 * 60_000, killSignal: 'SIGKILL' });
  return r.status ?? 1;
}

/** doctor → each stage in order: says what it does, does it, checks it took (binder, image), times it.
 *  facts / exec / log / notice are the machine's unless a test hands its own → {code, ran: [ids], times: {id: s}, blocked} */
export async function local(o, { facts = gather, exec = execInherit, log = (t) => console.log(redact(t, SECRETS())), notice = R.notice } = {}) {
  let f = facts(o);
  const { stages, blocked } = plan(f, o);
  const times = {}, ran = [];
  log(`local: 手元の Linux で redroid の準備${o.dryRun ? '（--dry-run: 何もしません）' : ''}`);
  log(`  秘密: ${secretsLine()}`);
  const wide = (t) => [...t].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
  for (const [i, s] of stages.entries()) {
    log(`→ ${i + 1}/${stages.length} ${s.id}: ${s.say}`);
    if (o.dryRun) { for (const c of s.cmds) log(`    $ ${c.show}`); }
    if (s.id === 'doctor') {
      for (const r of R.doctor(f)) log(`    ${r.ok ? '✔' : r.soft ? '・' : '✘'} ${r.name}${' '.repeat(Math.max(1, 16 - wide(r.name)))}${r.detail}`);
      if (blocked.length) {
        for (const b of blocked) log(`  ✘ ${b.name}: ${b.detail} → ${b.fix}`);
        log(`止まります: ${blocked.map((b) => b.name).join('、')} は人が直すもの（上の → の通りに）${o.dryRun ? '。直った後の段階は上の通り' : ''}`);
        if (!o.dryRun) return { code: 1, ran, times, blocked };
      }
      continue;
    }
    if (o.dryRun) continue;
    if (s.id === 'prep' && (f = facts(o)).prepared) { log('    （open で戻せたので prep は飛ばします）'); continue; }
    if (s.id === 'prep' && !f.account) { log('  ✘ prep: GOOGLE_EMAIL / GOOGLE_AAS_TOKEN がありません（open でも戻せませんでした） → node lab.mjs app token'); return { code: 1, ran, times, blocked }; }
    const t0 = now();
    let status = 0;
    for (const c of s.cmds) { status = exec(c.argv); if (status !== 0 && s.id !== 'open') break; }
    times[s.id] = secs(now() - t0); ran.push(s.id);
    notice(`local: ${s.id}`, `${times[s.id]} 秒${status ? `（終了コード ${status}）` : ''}`);
    // (each stage judged by what doctor sees after it, not only by the exit code)
    if (s.id === 'binder' || s.id === 'image' || s.id === 'prep' || s.id === 'bench') {
      f = facts(o);
      const miss = s.id === 'binder' ? !f.binder : s.id === 'image' ? !f.image : s.id === 'prep' ? !f.prepared : status !== 0;
      if (miss) { log(`  ✘ ${s.id} の後も直っていません: ${R.doctor(f).find((r) => !r.ok && !r.soft)?.fix ?? `終了コード ${status}`}`); return { code: 1, ran, times, blocked }; }
    }
  }
  if (!o.dryRun) notice('local: 合計', `${secs(Object.values(times).reduce((a, b) => a + b * 1000, 0))} 秒（${ran.map((id) => `${id} ${times[id]}`).join('、') || 'やることなし'}）`);
  if (!blocked.length) log(`次にやること: node lab.mjs app run -a ${o.addon} --device redroid`);
  return { code: blocked.length ? 1 : 0, ran, times, blocked };
}

// ---- command line ----
function opts(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) o[args[i].slice(2)] = args[i + 1]?.startsWith('--') || args[i + 1] === undefined ? true : args[++i]; else o._.push(args[i]); }
  return o;
}
/** argv → local()'s options (paths absolute, and how each is shown) */
export function options(argv, env = process.env) {
  const a = opts(argv), str = (v, d) => (typeof v === 'string' ? v : d);
  const data = path.resolve(str(a.data, path.join(LAB, 'data'))), file = path.resolve(str(a.file, path.join(LAB, 'data.bin')));
  const redroid = path.join(HERE, 'redroid.mjs'), game = path.join(HERE, 'game.mjs');
  return {
    dryRun: a['dry-run'] === true, bench: a.bench === true, rounds: Number(a.rounds) || 3, addon: str(a.addon, '<アドオン>'),
    data, file, image: str(a.image, R.GAPPS_TAG), lab: LAB, node: process.execPath, redroid, game, path: env.PATH ?? '',
    kernel: '$(uname -r)', owner: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    dataShow: rel(data), fileShow: rel(file), redroidShow: rel(redroid), gameShow: rel(game),
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  else {
    loadEnv([process.env.APP_ENV_FILE, path.join(TOP, '.env.local'), path.join(APPDIR, '.env.local'), path.join(TOP, '.env')]);
    local(options(argv)).then((r) => { process.exitCode = r.code; }).catch((e) => { console.error(`E ${redact(e.message, SECRETS())}`); process.exit(1); });
  }
}
