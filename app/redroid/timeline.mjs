#!/usr/bin/env node
// Where a redroid start spends its time, kept run after run: each bench round as one line of app/redroid/.lab/timeline.jsonl
// (the stages in seconds), and one table that sets this run against the last one and the median of the runs before it.
// Only reads and writes that file. Reached from game.mjs's bench; on its own it shows the newest run against the rest:
//   node app/redroid/timeline.mjs [--file f]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FILE = path.join(HERE, '.lab', 'timeline.jsonl');
const tenth = (x) => Math.round(x * 10) / 10;

// the stages in order (each one's own seconds, not the time since the start) and how the table names them
export const STAGES = {
  start: [['restore', '戻す（overlay）'], ['docker', 'docker run'], ['adb', 'adb がつながる'], ['boot', '起動の完了（boot_completed）'],
    ['handoff', '起動の後 → ゲームの開始'], ['process', 'ゲームのプロセス'], ['window', 'ゲームの画面'], ['title', 'タイトル（OCR）'], ['total', '合計']],
  resident: [['process', 'ゲームのプロセス'], ['window', 'ゲームの画面'], ['title', 'タイトル（OCR）'], ['total', '合計']],
};
const KIND_NAME = { start: '戻す → タイトル', resident: '常駐の端末でゲームだけ' };

/** a bench row (seconds since each part's own start: up's runS/adbS/bootS, launch's pidS/windowS/titleS) → each stage's
 *  own seconds; null where a mark is missing (pure) */
export function stagesOf(row) {
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const d = (a, b) => (n(a) !== null && n(b) !== null ? tenth(a - b) : null);
  const game = { process: n(row.pidS), window: d(row.windowS, row.pidS), title: d(row.titleS, row.windowS) };
  if (row.resident) return { ...game, total: n(row.titleS) };
  return {
    restore: n(row.restoreS), docker: n(row.runS), adb: d(row.adbS, row.runS), boot: d(row.bootS, row.adbS),
    // (what neither part times: the game stopped before its start, the overlay's leftovers)
    handoff: n(row.totalS) !== null && n(row.restoreS) !== null && n(row.bootS) !== null && n(row.titleS) !== null ? tenth(row.totalS - row.restoreS - row.bootS - row.titleS) : null,
    ...game, total: n(row.totalS),
  };
}
/** bench's rows → the lines to keep: {at, run, kind, round, s: stages, license?, load?} (pure) */
export function entriesOf(rows, { run, at = run, load = null } = {}) {
  return rows.map((r) => ({ at, run, kind: r.resident ? 'resident' : 'start', round: r.round, s: stagesOf(r), ...(r.license ? { license: r.license } : {}), ...(load !== null ? { load } : {}) }));
}
/** the middle value of the numbers among xs; null if none (pure) */
export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : tenth((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
}
/** the kept lines → per run (in the order they were written), per kind and stage: the median of its rounds (pure) */
export function byRun(entries) {
  const runs = new Map();
  for (const e of entries) { if (!e?.run || !STAGES[e.kind]) continue; if (!runs.has(e.run)) runs.set(e.run, []); runs.get(e.run).push(e); }
  return [...runs].map(([run, es]) => ({ run, kinds: Object.fromEntries(Object.entries(STAGES).map(([k, st]) => {
    const of = es.filter((e) => e.kind === k);
    return [k, of.length ? Object.fromEntries(st.map(([s]) => [s, median(of.map((e) => e.s?.[s]))])) : null];
  })) }));
}
/** one run against the last run before it and the median of all runs before it → {run, prev, past, rows: [{kind, stage,
 *  label, now, prev, dPrev, med, dMed}]} (pure) */
export function compare(entries, run = byRun(entries).at(-1)?.run) {
  const all = byRun(entries), i = all.findIndex((r) => r.run === run);
  if (i < 0) return { run, prev: null, past: 0, rows: [] };
  const cur = all[i], before = all.slice(0, i), last = before.at(-1) ?? null, rows = [];
  const diff = (a, b) => (a !== null && b !== null ? tenth(a - b) : null);
  for (const [kind, st] of Object.entries(STAGES)) {
    if (!cur.kinds[kind]) continue;
    for (const [stage, label] of st) {
      const now = cur.kinds[kind][stage], prev = last?.kinds[kind]?.[stage] ?? null, med = median(before.map((r) => r.kinds[kind]?.[stage]));
      rows.push({ kind, stage, label, now, prev, dPrev: diff(now, prev), med, dMed: diff(now, med) });
    }
  }
  return { run, prev: last?.run ?? null, past: before.length, rows };
}
/** compare()'s result → the table's lines (numbers first, the stage's name last: Japanese names do not pad evenly) (pure) */
export function table(c) {
  if (!c.rows.length) return '段階ごとの時間: 記録がありません';
  const num = (x) => (x === null ? '—' : x.toFixed(1)), sig = (x) => (x === null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)}`);
  const cols = [['今回', 'now', num], ['前回', 'prev', num], ['差', 'dPrev', sig], ['中央値', 'med', num], ['差', 'dMed', sig]];
  // (a Japanese header takes two columns a character)
  const w = 7, pad = (s) => String(s).padStart(w - [...String(s)].filter((ch) => ch.charCodeAt(0) >= 0x3000).length);
  const out = [`段階ごとの時間（秒、各回の中央値）: 今回 ${c.run}、前回 ${c.prev ?? 'なし'}、中央値は過去 ${c.past} 回`, `${cols.map(([h]) => pad(h)).join('')}  段階`];
  let kind = null;
  for (const r of c.rows) {
    if (r.kind !== kind) { kind = r.kind; out.push(`  [${KIND_NAME[kind]}]`); }
    out.push(`${cols.map(([, k, f]) => pad(f(r[k]))).join('')}  ${r.label}`);
  }
  return out.join('\n');
}

// ---- the file ----
/** the kept lines (a broken line is skipped: a run cut off mid-write loses only itself) */
export function read(file = FILE) {
  let t = '';
  try { t = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return t.split('\n').filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
/** the lines added at the end of the file, one JSON each */
export function append(entries, file = FILE) {
  if (!entries.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), i = a.indexOf('--file');
  console.log(table(compare(read(i >= 0 && a[i + 1] ? path.resolve(a[i + 1]) : FILE))));
}
