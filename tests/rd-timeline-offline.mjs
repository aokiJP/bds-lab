#!/usr/bin/env node
// app/redroid/timeline.mjs and game.mjs's bench writing to it, without docker, binder or a device: the stages from a bench
// row, the median, the table against the last run and the median of the runs before, and a whole bench (2 rounds) against a
// fake docker / adb / tesseract / mount on PATH that appends its lines and prints the table once.
// node tests/rd-timeline-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const TL = await imp('app/redroid/timeline.mjs');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}\n     ${e.stack?.split('\n')[1] ?? ''}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-timeline-'));

await t('stagesOf: each stage its own seconds (up and launch count from their own start); null where a mark is missing', () => {
  eq(TL.stagesOf({ round: 1, restoreS: 0.2, runS: 1.5, adbS: 4, bootS: 18.3, pidS: 2.1, windowS: 3, titleS: 28.4, totalS: 48.1 }),
    { restore: 0.2, docker: 1.5, adb: 2.5, boot: 14.3, handoff: 1.2, process: 2.1, window: 0.9, title: 25.4, total: 48.1 });
  eq(TL.stagesOf({ round: 1, restoreS: 0.2, runS: 1.5, adbS: 4, bootS: 18.3, pidS: 2.1, windowS: 3, titleS: null, totalS: null }),
    { restore: 0.2, docker: 1.5, adb: 2.5, boot: 14.3, handoff: null, process: 2.1, window: 0.9, title: null, total: null });
  eq(TL.stagesOf({ round: 1, resident: true, pidS: 1, windowS: 1.5, titleS: 9 }), { process: 1, window: 0.5, title: 7.5, total: 9 });
});

await t('median: odd, even, the non-numbers left out, none → null', () => {
  eq(TL.median([3, 1, 2]), 2); eq(TL.median([4, 1, 2, 3]), 2.5); eq(TL.median([null, 5, undefined, 'x']), 5); eq(TL.median([null]), null); eq(TL.median([]), null);
});

const row = (total, title, extra = {}) => ({ round: 1, restoreS: 0.1, runS: 1, adbS: 3, bootS: 15, pidS: 2, windowS: 3, titleS: title, totalS: total, ...extra });
const history = [
  ...TL.entriesOf([row(50, 34), { round: 1, resident: true, pidS: 1, windowS: 2, titleS: 12 }], { run: 'A' }),
  ...TL.entriesOf([row(48, 32), row(46, 30, { round: 2 })], { run: 'B' }),
  ...TL.entriesOf([row(40, 24)], { run: 'C', load: 1.5 }),
];

await t('entriesOf: one line per row: run, kind (start / resident), round, stages; load only when known', () => {
  eq(history.length, 5);
  eq(history[1].kind, 'resident'); eq(history[0].kind, 'start'); eq(history[3].round, 2);
  ok(!('load' in history[0]) && history[4].load === 1.5, JSON.stringify(history[4]));
  eq(history[1].s, { process: 1, window: 1, title: 10, total: 12 });
});

await t('compare: this run (the median of its rounds) against the last run and the median of the runs before', () => {
  const c = TL.compare(history);
  eq([c.run, c.prev, c.past], ['C', 'B', 2]);
  const total = c.rows.find((r) => r.kind === 'start' && r.stage === 'total');
  // B's rounds 48, 46 → 47; the median of A (50) and B (47) → 48.5
  eq([total.now, total.prev, total.dPrev, total.med, total.dMed], [40, 47, -7, 48.5, -8.5]);
  ok(!c.rows.some((r) => r.kind === 'resident'), 'C had no resident row: none in the table');
  const a = TL.compare(history, 'A');
  eq([a.prev, a.past], [null, 0]);
  ok(a.rows.find((r) => r.stage === 'total').dPrev === null && a.rows.some((r) => r.kind === 'resident'), JSON.stringify(a.rows));
  eq(TL.compare([], 'X').rows, []);
});

await t('table: one header, numbers first, signed differences, a dash where nothing to compare', () => {
  const s = TL.table(TL.compare(history));
  const lines = s.split('\n');
  ok(/今回 C、前回 B、中央値は過去 2 回/.test(lines[0]), lines[0]);
  ok(lines.some((l) => /^\s+40\.0\s+47\.0\s+−7\.0\s+48\.5\s+−8\.5  合計$/.test(l)), s);
  ok(lines.some((l) => /±0\.0.*戻す（overlay）$/.test(l)), s);
  ok(/記録がありません/.test(TL.table(TL.compare([]))), 'empty');
  ok(/—/.test(TL.table(TL.compare(history, 'A'))), 'no previous: dashes');
});

await t('read / append: one JSON a line, appended; a broken line skipped; no file → nothing', () => {
  const f = path.join(tmp, 'sub', 'tl.jsonl');
  eq(TL.read(f), []);
  TL.append(history.slice(0, 2), f); TL.append([], f);
  fs.appendFileSync(f, '{"broken\n');
  TL.append(history.slice(2), f);
  eq(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 6);
  eq(TL.read(f), history);
});

// ---- bench end to end against fake tools ----
const bin = path.join(tmp, 'bin'), log = path.join(tmp, 'calls.log');
fs.mkdirSync(bin);
const tool = (name, body) => { fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
tool('docker', 'exit 0');
tool('mount', 'exit 0');
tool('umount', 'exit 0');
tool('sudo', '[ "$1" = "-n" ] && shift; exec "$@"');
tool('adb', `case "$*" in
  *"connect "*) echo "connected to 127.0.0.1:5600" ;;
  *get-state*) echo device ;;
  *sys.boot_completed*) echo 1 ;;
  *pidof*) echo 4242 ;;
  *mCurrentFocus*) echo "  mCurrentFocus=Window{abc u0 com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity}" ;;
  *resolve-activity*) echo "com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity" ;;
  *screencap*) printf '\\211PNG\\r\\n\\032\\n'; date +%s%N ;;
esac
exit 0`);
tool('tesseract', `[ "$1" = "--version" ] && exit 0
printf 'level\\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n'
printf '5\\t1\\t1\\t1\\t1\\t1\\t100\\t500\\t60\\t30\\t95\\tGet\\n'
printf '5\\t1\\t1\\t1\\t1\\t2\\t170\\t500\\t90\\t30\\t95\\tstarted\\n'`);

await t('bench: each round appends its start and resident lines, the table printed once, the notices as before', async () => {
  Object.assign(process.env, { PATH: `${bin}${path.delimiter}${process.env.PATH}`, ADB: path.join(bin, 'adb'), APP_TESSERACT: path.join(bin, 'tesseract'), GITHUB_ACTIONS: '' });
  const G = await imp('app/redroid/game.mjs');
  const data = path.join(tmp, 'data'), file = path.join(tmp, 'lab', 'timeline.jsonl');
  fs.mkdirSync(data, { recursive: true });
  TL.append(TL.entriesOf([row(60, 40), { round: 1, resident: true, pidS: 1, windowS: 2, titleS: 12 }], { run: '2000-01-01T00:00:00.000Z' }), file);
  const said = [], orig = console.log;
  console.log = (...a) => said.push(a.join(' '));
  let rows;
  try { rows = await G.bench({ data, rounds: 2, timeline: file }); } finally { console.log = orig; }
  const out = said.join('\n');
  eq(rows.length, 4, 'start + resident per round');
  ok(rows[0].titleS !== null && rows[0].totalS !== null && rows[0].bootS !== undefined && rows[0].runS !== undefined && rows[0].adbS !== undefined, JSON.stringify(rows[0]));
  const kept = TL.read(file);
  eq(kept.length, 6, 'the old run (2) and this one (2 rounds × 2)');
  const mine = kept.slice(2);
  ok(new Set(mine.map((e) => e.run)).size === 1 && mine[0].run !== kept[0].run, 'one run id for this bench');
  eq(mine.map((e) => `${e.kind}${e.round}`), ['start1', 'resident1', 'start2', 'resident2']);
  ok(typeof mine[0].s.total === 'number' && typeof mine[0].s.boot === 'number' && typeof mine[1].s.title === 'number', JSON.stringify(mine[0]));
  eq(said.filter((l) => /^段階ごとの時間/.test(l)).length, 1, 'one table');
  ok(/前回 2000-01-01T00:00:00\.000Z、中央値は過去 1 回/.test(out) && /\[常駐の端末でゲームだけ\]/.test(out) && /合計$/m.test(out), out.slice(-1500));
  ok(/起動からタイトルまで（1 回目）/.test(out) && /常駐の端末でゲームだけ起動し直す（2 回目）/.test(out), 'the notices as before');
});

await t('timeline.mjs on its own: the newest run against the rest', async () => {
  const { spawnSync } = await import('node:child_process');
  const f = path.join(tmp, 'cli.jsonl'); TL.append(history, f);
  const r = spawnSync(process.execPath, [path.join(TOP, 'app/redroid/timeline.mjs'), '--file', f], { encoding: 'utf8' });
  ok(r.status === 0 && /今回 C、前回 B/.test(r.stdout), r.stdout + r.stderr);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? 'FAIL' : 'PASS'} rd-timeline-offline (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
