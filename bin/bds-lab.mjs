#!/usr/bin/env node
// bds-lab — 実機の Minecraft サーバーでアドオンを作り、確かめる。
//
//   npm start                             作る（何を作るか日本語で答えるだけ）
//   npm test                              実機で確かめる（-- --watch で保存のたびに）
//   npm run status                        前回の結果を 40 行で見る（-- --full で全部）
//   npm run api -- Player.setGameMode     API を引く（-- --find <語> で探す）
//   npm run fix                           実機を上げずに直せるものを直す
//   npm run ship                          .mcaddon にして出す
//
//   うまくいかないとき: npm run doctor
//   全部のコマンド:     npm run help -- --all
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const load = (rel) => import(new URL(rel, import.meta.url).href);   // Windows では絶対パスを import() できない
const argv = process.argv.slice(2);
if (process.env.NODE_OPTIONS) {
  const kept = process.env.NODE_OPTIONS.split(/\s+/).filter((o) => !/^--inspect/.test(o)).join(' ').trim();
  if (kept) process.env.NODE_OPTIONS = kept; else delete process.env.NODE_OPTIONS;
}
const ALIAS = { test: 'check', watch: 'dev', fix: 'inspect', find: 'api', doc: 'docs', 'new': 'init' };
const given = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'help';
let cmd = ALIAS[given] ?? given;
if (cmd === 'check' && process.argv.includes('--watch')) cmd = 'dev';
if (given === 'fix' && !argv.includes('--fix')) argv.push('--fix');
if (given === 'watch' || argv.includes('--watch')) { const i = argv.indexOf('--watch'); if (i >= 0) argv.splice(i, 1); }
const arg1 = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
const has = (k) => argv.includes(k);
const opt = (k, d) => (has(k) ? argv[argv.indexOf(k) + 1] : d);
const say = (...a) => console.log(a.join(' '));

const NEXT = [
  [/gh（GitHub CLI）がありません/, 'brew install gh を実行してから、もう一度同じコマンドを'],
  [/BDS を用意できませんでした/, 'bedrock-server-*.zip を ~/Downloads に置いて、もう一度'],
  [/コンテナ/, 'OrbStack か Docker Desktop を開いてから、もう一度'],
  [/アドオンがありません/, 'npm start を実行してください'],
  [/git リポジトリではありません/, 'npm start を実行すると用意されます'],
  [/bedrock-protocol を入れられませんでした/, 'npm install --prefix . --no-save bedrock-protocol を実行してから、もう一度（ネットワークが要ります）'],
  [/型定義/, 'npm run docs（ネットワークが要ります）。それでも駄目なら types/minecraft/ に手で置いてください'],
];
const die = (m) => {
  const hint = NEXT.find(([re]) => re.test(m))?.[1];
  console.error(`\n✘ ${m}`);
  if (hint) console.error(`  次にすること: ${hint}`);
  else console.error('  詳しく見るなら BDS_LAB_DEBUG=1 を付けて実行してください');
  process.exit(1);
};

// コマンドごとに使えるオプションの一覧。
// スペースを忘れて `--with-vendor--no-clean` のようにくっつけても、
// 黙って既定値に戻るのではなく、ここで「分からない」とはっきり止める。
const READY_FLAGS = ['--addon', '--no-github', '--bds', '--preview'];   // ready() が内部で読むもの。ほとんどのコマンドで使える
const HOW_FLAGS = ['--reload', '--eval'];                                // how() が読むもの
const FLAGS = {
  init: ['--desc', '--no-github', '--bds', '--preview'],
  start: [...READY_FLAGS, ...HOW_FLAGS, '--only', '--want', '--name', '--rounds', '--agent', '--no-push', '--no-release', '--no-real'],
  'bds-release': [],
  docs: [],
  refs: ['--only'],
  skill: ['--to', '--body', '--find'],
  selftest: [],
  doctor: [],
  import: ['--name', '--force'],
  inspect: [...READY_FLAGS, '--fix'],
  update: [],
  run: [...READY_FLAGS, ...HOW_FLAGS, '--only', '--rounds', '--agent', '--no-push', '--no-release', '--no-real', '--public', '--with-token', '--no-bds'],
  auto: [...READY_FLAGS, ...HOW_FLAGS, '--only', '--rounds', '--agent', '--no-push', '--no-release', '--no-real'],
  dev: [...READY_FLAGS, ...HOW_FLAGS, '--only'],
  check: [...READY_FLAGS, ...HOW_FLAGS, '--only', '--json'],
  real: [...READY_FLAGS, '--only', '--all', '--name'],
  prompt: [...READY_FLAGS, '--with-token', '--no-bds'],
  archive: ['--no-clean', '--with-vendor', '--out'],   // ready() を呼ばないので --addon などは対象外
  cycle: [...READY_FLAGS, ...HOW_FLAGS],
  publish: [...READY_FLAGS, '--name', '--yes'],
  ship: [...READY_FLAGS, '--version'],
};
FLAGS.api = ['--find', '--raw'];
FLAGS.status = ['--full'];
FLAGS.help = ['--all'];
FLAGS.check = [...FLAGS.check, '--watch'];
FLAGS.all = FLAGS.run;
for (const [from, to] of Object.entries(ALIAS)) FLAGS[from] = FLAGS[to];
FLAGS.watch = FLAGS.dev;
FLAGS.fix = FLAGS.inspect;
FLAGS.zip = FLAGS.archive;

function checkFlags(command) {
  const allowed = FLAGS[command];
  if (!allowed) return;   // 一覧が無いコマンド（help など）は検めない
  const set = new Set(allowed);
  const unknown = argv.filter((a) => a.startsWith('--') && !set.has(a));
  if (!unknown.length) return;
  console.error(`\n✘ ${command} に無いオプションです: ${unknown.join(' ')}`);
  console.error(`  使えるのは次です: ${allowed.length ? allowed.join(' / ') : '（オプションはありません）'}`);
  console.error('  2 つのオプションがスペース無しでくっついていないか確かめてください（例: --with-vendor --no-clean）');
  process.exit(1);
}

async function ready(name = null) {
  const { ensureProject, listAddons } = await load('../src/run/project.mjs');
  await ensureRuntime();
  if (!name && !listAddons(ROOT).length) {
    say('まだアドオンがありません。はじめの用意をします。');
    say('');
    return null;
  }
  const p = await ensureProject({ ROOT, name, say, github: !has('--no-github'), bdsPin: opt('--bds', null), preview: has('--preview') });
  const given = opt('--addon', null);
  const addonDir = given ? path.resolve(given.includes('/') ? given : path.join(ROOT, 'addons', given)) : p.addonDir;
  return { addonDir, specsDir: path.join(ROOT, 'specs'), bdsDir: p.bds, project: p };
}

async function ensureRuntime() {
  const { chooseRuntime, ensureContainerRuntime } = await load('../tools/bds/launch.mjs');
  if (chooseRuntime() !== 'container') return;
  const r = ensureContainerRuntime({ say });
  if (!r.ok) die(r.reason);
}

const how = () => (has('--reload') ? 'reload' : has('--eval') ? 'eval' : 'auto');
const filter = opt('--only', null);

async function main(force = null) {
  switch (force ?? cmd) {
    case 'init': {
      const { init } = await load('../src/run/project.mjs');
      await ensureRuntime();
      await init({ ROOT, name: arg1, description: opt('--desc', ''), say, github: !has('--no-github'), bdsPin: opt('--bds', null), preview: has('--preview') });
      break;
    }

    case 'start': {
      const { start } = await load('../src/run/project.mjs');
      const res = await start({
        ROOT, say, github: !has('--no-github'),
        want: opt('--want', null), name: opt('--name', null),
        bdsPin: opt('--bds', null), preview: has('--preview'),
        run: async (id) => {
          const r = await ready(id);
          const { auto } = await load('../src/run/auto.mjs');
          return auto({ ROOT, ...r, filter, say, how: how(), rounds: Number(opt('--rounds', '5')), agent: opt('--agent', null), push: !has('--no-push'), release: !has('--no-release'), realToo: !has('--no-real') });
        },
      });
      // AI の CLI が無いのは失敗ではない。zip は出来ているので、手で渡す道に進んでもらう
      const handoffOnly = res?.reason === 'no-agent';
      process.exit(res.ok === false && res.done !== false && !handoffOnly ? 1 : 0);
      break;
    }

    case 'bds-release': {
      const { fetchBds, bundle, publishTemplate } = await load('../src/run/release.mjs');
      const { version } = await fetchBds({ ROOT, say });
      const zipFile = await bundle({ ROOT, say });
      await publishTemplate({ ROOT, zipFile, bdsVersion: version, say });
      break;
    }

    case 'docs': {
      const { syncTypes, LINKS } = await load('../src/run/docs.mjs');
      await syncTypes({ ROOT, say, force: true });
      say('');
      for (const [label, url] of LINKS) say(`  ${label}: ${url}`);
      break;
    }

    case 'refs': {
      const { syncRefs } = await load('../src/run/refs.mjs');
      say('公式と有志の資料を取り込みます（BP に要るものだけ）…');
      const done = await syncRefs({ ROOT, only: opt('--only', null), say });
      say(done.length ? `取り込みました: ${done.join(' / ')}` : '取り込めませんでした');
      break;
    }

    case 'skill': {
      const find = opt('--find', null) ?? (arg1 && !has('--to') && !has('--body') ? arg1 : null);
      if (find) {
        const { findSkill } = await load('../src/run/skills.mjs');
        findSkill({ ROOT, word: find, say });
        break;
      }
      const { addSkill } = await load('../src/run/skills.mjs');
      await addSkill({ ROOT, title: arg1, file: opt('--to', null), body: opt('--body', null), say });
      break;
    }

    case 'import': {
      const file = argv.find((a) => !a.startsWith('--') && a !== cmd);
      if (!file) { console.error('取り込むファイルを渡してください: npm run import -- <x.mcaddon>'); process.exit(1); }
      const { importAddon } = await load('../src/run/import.mjs');
      await importAddon({ ROOT, file, name: opt('--name', null), say, force: has('--force') });
      break;
    }

    case 'inspect': {
      const r = await ready();
      const { inspect, fix } = await load('../src/run/inspect.mjs');
      if (has('--fix')) { fix({ addonDir: r.addonDir, say }); say(''); }
      const out = inspect({ ROOT, addonDir: r.addonDir, say });
      process.exit(out.ok ? 0 : 1);
      break;
    }

    case 'update': {
      const { update } = await load('../src/run/update.mjs');
      const r = await update({ ROOT, say });
      process.exit(r.ok ? 0 : 1);
      break;
    }

    case 'selftest': {
      const { selftest } = await load('../src/run/selftest.mjs');
      const r = await selftest({ say });
      process.exit(r.ok ? 0 : 1);
      break;
    }

    case 'doctor': {
      const { doctor } = await load('../src/run/project.mjs');
      await doctor({ ROOT, say });
      break;
    }

    case 'run': case 'all': {
      const r = await ready(arg1);
      if (!r) return main2('start');
      const step = async (label, fn, { fatal = false } = {}) => {
        say('');
        say(`── ${label}`);
        try { return await fn(); }
        catch (e) { say(`  飛ばします: ${String(e.message ?? e)}`); if (fatal) throw e; return null; }
      };
      const { syncRefs } = await load('../src/run/refs.mjs');
      const { syncTypes } = await load('../src/run/docs.mjs');
      const { auto } = await load('../src/run/auto.mjs');
      const { ship } = await load('../src/run/apply.mjs');
      const { publish } = await load('../src/run/publish.mjs');
      const { makeHandoff } = await load('../src/run/handoff.mjs');

      await step('資料を用意する', () => syncRefs({ ROOT, say }));
      await step('公式の型定義', () => syncTypes({ ROOT, say }));
      const res = await step('AI に書かせて実機で検証する', () => auto({
        ROOT, ...r, filter, say, how: how(),
        rounds: Number(opt('--rounds', '5')), agent: opt('--agent', null),
        push: !has('--no-push'), release: !has('--no-release'), realToo: !has('--no-real'),
      }), { fatal: true });
      if (!res?.ok) {
        // auto が「AI が無い」で止まったときは zip を作り終えている。二重に作らない
        if (res?.reason !== 'no-agent') {
          await step('AI に渡す zip', () => makeHandoff({ ROOT, addonDir: r.addonDir, specsDir: r.specsDir, say, withToken: has('--with-token'), withBds: !has('--no-bds') }));
        }
        process.exit(res?.reason === 'no-agent' ? 0 : 1);
      }
      await step('Release を更新する', () => ship({ ROOT, addonDir: r.addonDir, say }));
      if (has('--public')) await step('public に出す', () => publish({ ROOT, addonDir: r.addonDir, say }));
      say('');
      say('done');
      break;
    }

    case 'auto': {
      const r = await ready(arg1);
      if (!r) return main2('start');
      const { auto } = await load('../src/run/auto.mjs');
      const res = await auto({
        ROOT, ...r, filter, say, how: how(),
        rounds: Number(opt('--rounds', '5')),
        agent: opt('--agent', null),
        push: !has('--no-push'),
        release: !has('--no-release'),
        realToo: !has('--no-real'),
      });
      process.exit(res.ok || res.reason === 'no-agent' ? 0 : 1);
      break;
    }

    case 'dev': {
      const r = await ready(arg1);
      if (!r) return main2('start');
      const { dev } = await load('../src/run/check.mjs');
      await dev({ ROOT, ...r, filter, say, how: how() });
      break;
    }

    case 'check': {
      const r = await ready(arg1);
      if (!r) return main2('start');
      const { check } = await load('../src/run/check.mjs');
      const rep = await check({ ROOT, ...r, filter, say, json: has('--json'), how: how() });
      process.exit(rep.ok ? 0 : 1);
      break;
    }

    case 'real': {
      const r = await ready(arg1);
      if (!r) return main2('start');
      const { real } = await load('../src/run/check.mjs');
      const res = await real({ ROOT, ...r, filter, say, all: has('--all'), name: opt('--name', 'Cam') });
      process.exit(res.ok ? 0 : 1);
      break;
    }

    case 'prompt': {
      const r = await ready(arg1);
      if (!r) return main2('start');
      const { makeHandoff, ensureMaterials } = await load('../src/run/handoff.mjs');
      const missing = await ensureMaterials({ ROOT, say });
      makeHandoff({ ROOT, addonDir: r.addonDir, specsDir: r.specsDir, say, withToken: has('--with-token'), withBds: !has('--no-bds'), missing });
      break;
    }

    case 'archive': case 'zip': {
      const { archive } = await load('../src/run/archive.mjs');
      archive({ ROOT, say, clean: !has('--no-clean'), withVendorZip: has('--with-vendor'), out: opt('--out', null) });
      break;
    }

    case 'cycle': {
      const r = await ready(null);
      if (!r) return main2('start');
      const { cycle } = await load('../src/run/apply.mjs');
      const zip = arg1 ? path.resolve(arg1) : null;
      const rep = await cycle({ ROOT, zipPath: zip, ...r, say, how: how() });
      process.exit(rep.ok ? 0 : 1);
      break;
    }

    case 'publish': {
      const r = await ready(arg1);
      if (!r) return main2('start');
      const { publish } = await load('../src/run/publish.mjs');
      await publish({ ROOT, addonDir: r.addonDir, say, name: opt('--name', null), yes: has('--yes') });
      break;
    }

    case 'ship': {
      const r = await ready(arg1);
      if (!r) return main2('start');
      const { ship } = await load('../src/run/apply.mjs');
      await ship({ ROOT, addonDir: r.addonDir, say, version: opt('--version', null) });
      break;
    }

    case 'api': {
      const { api } = await load('../src/run/api.mjs');
      const find = opt('--find', null);
      if (!arg1 && !find) { say('例: npm run api -- InputInfo / npm run api -- Player.setGameMode / npm run api -- --find 入力'); break; }
      api({ ROOT, query: arg1, raw: has('--raw'), find, say });
      break;
    }

    case 'status': {
      const { status } = await load('../src/run/status.mjs');
      status({ ROOT, full: has('--full'), say });
      break;
    }

    case 'help': {
      if (!has('--all')) { main2('__usage'); break; }
      say('作る     start / init <名前> / auto <名前> / all / cycle <返信.zip> / import <x.mcaddon>');
      say('確かめる  test（check）/ test -- --watch（dev）/ real -- --all / fix（inspect --fix）/ selftest / doctor');
      say('見る     status / status -- --full / api -- <名前> / api -- --find <語> / skill -- "<題>"');
      say('出す     ship / publish / prompt / archive');
      say('整える    docs / refs / update / bds-release');
      say('');
      say('よく使うもの: -- --addon <名前> / --only <語> / --no-github / --eval か --reload');
      break;
    }

    default: {
      // 冒頭の // の固まりだけを使い方として出す（途中のコメントを巻き込まない）
      const head = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1);
      const end = head.findIndex((l) => !l.startsWith('//'));
      say(head.slice(0, end < 0 ? head.length : end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      break;
    }
  }
}

const main2 = (c) => main(c);

checkFlags(cmd);   // main() は 'start' などへ内部でフォールバックすることがあるので、最初に一度だけ、実際に打たれたコマンドで検める
main().catch((e) => die(process.env.BDS_LAB_DEBUG ? (e.stack ?? e.message) : String(e.message ?? e)));
