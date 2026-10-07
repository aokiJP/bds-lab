// app/redroid's wait for the game's title without a device: when the screen is read (pace.mjs, pure) and game.mjs's launch
// against a fake adb and a fake tesseract (sh scripts in a temporary folder: the game's process, window, logcat and screens
// follow the time since `am start`).
// node tests/rd-title-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(TOP, p)).href);
const P = await imp('app/redroid/pace.mjs');
const G = await imp('app/redroid/game.mjs');
const { Adb } = await imp('app/lib/android.mjs');

let pass = 0, fail = 0;
// (a launch that fails: its whole result and the fake device's notes, so a run elsewhere — another OS — shows where it went)
let lastLaunch = null;
const t = async (name, fn) => { lastLaunch = null; try { await fn(); pass++; console.log(`ok   ${name}`); } catch (e) { fail++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').join('\n     ')}\n     ${e.stack?.split('\n')[1] ?? ''}${lastLaunch ? `\n     launch: ${JSON.stringify(lastLaunch).slice(0, 1500)}` : ''}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} want ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-title-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

// ---- pace.mjs (pure) ----
await t('gapMs: 1 s, then x1.5, up to 1.5 s', () => {
  eq([0, 1, 2, 3, 9].map((n) => P.gapMs(n)), [1000, 1500, 1500, 1500, 1500]);
});
await t('ocrDue: nothing before the window', () => {
  eq(P.ocrDue({ atMs: 50_000, windowSeen: false, prevTitleMs: 10_000 }), { ocr: false, gate: null });
  eq(P.ocrDue({ atMs: 50_000, windowSeen: false, off: true }), { ocr: false, gate: null });
});
await t('ocrDue: no titleS kept → from the window, at widening gaps', () => {
  eq(P.ocrDue({ atMs: 3000, windowSeen: true }), { ocr: true, gate: 'window' });
  eq(P.ocrDue({ atMs: 3900, windowSeen: true, lastOcrMs: 3000, n: 1 }).ocr, false);
  eq(P.ocrDue({ atMs: 4000, windowSeen: true, lastOcrMs: 3000, n: 1 }).ocr, true);
  eq(P.ocrDue({ atMs: 5400, windowSeen: true, lastOcrMs: 4000, n: 2 }).ocr, false);
  eq(P.ocrDue({ atMs: 5500, windowSeen: true, lastOcrMs: 4000, n: 2 }).ocr, true);
  eq(P.ocrDue({ atMs: 60_000, windowSeen: true, lastOcrMs: 58_600, n: 20 }).ocr, false, 'the gap stops at 1.5 s');
  eq(P.ocrDue({ atMs: 60_000, windowSeen: true, lastOcrMs: 58_500, n: 20 }).ocr, true);
});
await t('ocrDue: titleS kept → from 7/10 of it, not before', () => {
  eq(P.ocrDue({ atMs: 6_900, windowSeen: true, prevTitleMs: 10_000 }), { ocr: false, gate: null });
  eq(P.ocrDue({ atMs: 7_000, windowSeen: true, prevTitleMs: 10_000 }), { ocr: true, gate: 'prev' });
});
await t('gateMs / ocrDue: the gate at most 10 s (slow starts kept do not hold a fast one)', () => {
  eq(P.gateMs(null), null); eq(P.gateMs(6000), 4200); eq(P.gateMs(60_000), 10_000); eq(P.gateMs(200_000), 10_000);
  eq(P.ocrDue({ atMs: 9_900, windowSeen: true, prevTitleMs: 60_000 }), { ocr: false, gate: null });
  eq(P.ocrDue({ atMs: 10_000, windowSeen: true, prevTitleMs: 60_000 }), { ocr: true, gate: 'prev' }, 'not 42 s');
});
await t('gateMs / ocrDue: a timeout shorter than gate + 10 s → no gate (from the window)', () => {
  eq(P.gateMs(60_000, 30_000), 10_000); eq(P.gateMs(60_000, 20_000), 10_000);
  eq(P.gateMs(60_000, 19_999), null); eq(P.gateMs(6000, 14_000), null); eq(P.gateMs(6000, 14_200), 4200);
  eq(P.ocrDue({ atMs: 1000, windowSeen: true, prevTitleMs: 60_000, timeoutMs: 15_000 }), { ocr: true, gate: 'window' });
  eq(P.ocrDue({ atMs: 1000, windowSeen: true, prevTitleMs: 60_000, timeoutMs: 30_000 }), { ocr: false, gate: null });
});
await t('ocrDue: the logcat line opens it before 7/10; REDROID_OCR_PACE=0 reads at every round', () => {
  eq(P.ocrDue({ atMs: 10_000, windowSeen: true, readySeen: true, prevTitleMs: 50_000 }), { ocr: true, gate: 'log' });
  eq(P.ocrDue({ atMs: 10_000, windowSeen: true, prevTitleMs: 50_000, lastOcrMs: 9900, n: 5, off: true }), { ocr: true, gate: 'window' });
});
await t('logSignals: Displayed of the game only; the ready line only when asked for', () => {
  const log = 'I/ActivityTaskManager(  500): Displayed com.android.vending/.Main: +1s\nI/MinecraftPE( 900): lab near';
  eq(P.logSignals(log, { pkg: 'com.mojang.minecraftpe' }), { drawn: false, ready: false });
  eq(P.logSignals(`${log}\nI/ActivityTaskManager(  500): Displayed com.mojang.minecraftpe/.MainActivity: +3s`, { pkg: 'com.mojang.minecraftpe', readyRe: /lab near/ }), { drawn: true, ready: true });
  eq(P.readyRe({ REDROID_TITLE_LOG: '(' }), null, 'not a regex');
  eq(P.readyRe({}), null);
});
await t('keepTitle / prevTitleMs: only clean starts, the shortest of the last 5', () => {
  let k = { titles: [] };
  eq(P.prevTitleMs(k), null);
  k = P.keepTitle(k, { titleS: 48, license: 'ok' });
  k = P.keepTitle(k, { titleS: 30, license: 'ok', firstRun: 1 });
  k = P.keepTitle(k, { titleS: null, license: 'no（x）' });
  k = P.keepTitle(k, { titleS: null, windowS: 3 });
  eq(k, { titles: [48] });
  for (const s of [60, 55, 52, 51, 50]) k = P.keepTitle(k, { titleS: s, license: 'ok' });
  eq(k, { titles: [60, 55, 52, 51, 50] });
  eq(P.prevTitleMs(k), 50_000);
  eq(P.prevTitleMs({ titles: [70, 0, -1] }), 70_000);
  eq(P.readPace(path.join(tmp, 'none.json')), { titles: [] });
});
await t('readPace: titles not an array → nothing kept; not-number entries dropped', () => {
  const f = path.join(tmp, 'bad-pace.json');
  for (const [txt, want] of [['{"titles":"48"}', []], ['{"titles":{}}', []], ['{"titles":null}', []], ['"48"', []], ['null', []], ['[48]', []], ['{}', []], ['{"titles":[48,"30",null,{},true,-1,52.5]}', [48, -1, 52.5]]]) {
    fs.writeFileSync(f, txt);
    const k = P.readPace(f);
    eq(k, { titles: want }, txt);
    P.prevTitleMs(k); P.keepTitle(k, { titleS: 9, license: 'ok' });
  }
  fs.writeFileSync(f, '{"titles":"48"}'); eq(P.prevTitleMs(P.readPace(f)), null);
  fs.writeFileSync(f, '{"titles":[48,"30",null]}'); eq(P.prevTitleMs(P.readPace(f)), 48_000);
});

// ---- launch against a fake device ----
const dev = path.join(tmp, 'dev'), bin = path.join(tmp, 'bin');
fs.mkdirSync(dev); fs.mkdirSync(bin);
// the fake's clock: ms since `am start` (-1 before it)
const CLOCK = `D=${dev}
# (nanoseconds: BSD date (macOS) has no %N, it prints "N": perl's clock then)
ns() { n=$(date +%s%N); case "$n" in *N) perl -MTime::HiRes=time -e 'printf "%d\\n", time * 1e9';; *) echo "$n";; esac; }
ms() { [ -f "$D/t0" ] || { echo -1; return; }; echo $(( ($(ns) - $(cat "$D/t0")) / 1000000 )); }
cfg() { cat "$D/$1" 2>/dev/null || echo "$2"; }
`;
fs.writeFileSync(path.join(bin, 'adb'), `#!/bin/sh
${CLOCK}
shift 2
E=$(ms)
screen() {
  if [ "$E" -lt "$(cfg win 999999)" ]; then echo none
  elif [ -f "$D/welcome" ] && [ ! -f "$D/tapped" ]; then echo welcome
  elif [ "$E" -ge "$(cfg title 999999)" ]; then echo title
  else echo loading; fi
}
case "$*" in
  "shell am force-stop"*) rm -f "$D/t0" "$D/tapped" ;;
  "logcat -c") : ;;
  "logcat -d -b crash") : ;;
  "logcat -d -v brief")
    echo "$E" >> "$D/logcat.log"
    [ "$E" -ge "$(cfg win 999999)" ] && echo "I/ActivityTaskManager(  500): Displayed com.mojang.minecraftpe/.MainActivity: +2s"
    [ "$E" -ge "$(cfg logline 999999)" ] && echo "I/MinecraftPE( 900): lab title near"
    : ;;
  "shell cmd package resolve-activity"*) echo "com.mojang.minecraftpe/.MainActivity" ;;
  "shell am start"*) ns > "$D/t0"; echo "Status: ok"; echo "TotalTime: 900" ;;
  "shell pidof"*) [ "$E" -ge "$(cfg pid 0)" ] && [ "$E" -lt "$(cfg gone 999999)" ] && echo 1234; : ;;
  *mCurrentFocus*)
    if [ "$E" -ge "$(cfg vending 999999)" ]; then echo "  mCurrentFocus=Window{a1 u0 com.android.vending/com.google.android.finsky.Paywall}"
    elif [ "$E" -ge "$(cfg win 999999)" ]; then echo "  mCurrentFocus=Window{a1 u0 com.mojang.minecraftpe/com.mojang.minecraftpe.MainActivity}"
    else echo "  mCurrentFocus=Window{a0 u0 com.android.launcher3/.Launcher}"; fi ;;
  "exec-out screencap -p") printf '\\211PNG %s %s\\n' "$(screen)" "$(ns)" ;;
  "shell input swipe"*) touch "$D/tapped" ;;
  *) : ;;
esac
`, { mode: 0o755 });
// tesseract: the words of the screen the fake PNG names, as tsv; every read noted (its time since am start)
const TSV = (rows) => ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext', ...rows.map(([text, line, left]) => `5\t1\t1\t1\t${line}\t1\t${left}\t300\t80\t30\t90\t${text}`)].join('\\n');
fs.writeFileSync(path.join(bin, 'tesseract'), `#!/bin/sh
${CLOCK}
[ "$1" = "--version" ] && { echo "tesseract 5"; exit 0; }
ms >> "$D/ocr.log"
# (LC_ALL=C: the fake PNG starts with byte 0x89, not UTF-8 — BSD cut (macOS) in a UTF-8 locale stops on it: Illegal byte sequence)
case "$(LC_ALL=C cut -d' ' -f2 "$1")" in
  title) printf '${TSV([['Get', 1, 600], ['started', 1, 690], ['More', 2, 600], ['options', 2, 690]])}\\n' ;;
  welcome) printf '${TSV([['WELCOME', 1, 600], ['Maybe', 2, 1100], ['later', 2, 1190]])}\\n' ;;
  *) printf '${TSV([['Loading', 1, 600], ['resources', 1, 700]])}\\n' ;;
esac
`, { mode: 0o755 });
process.env.APP_TESSERACT = path.join(bin, 'tesseract');
const adb = new Adb({ bin: path.join(bin, 'adb'), serial: '127.0.0.1:5600' });
const paceFile = path.join(tmp, 'title-pace.json');
/** one start on the fake: the device's times (ms after am start) → launch's result + when OCR read the screen */
async function start(times, { kept, env = {}, timeoutMs = 20_000 } = {}) {
  for (const f of fs.readdirSync(dev)) fs.rmSync(path.join(dev, f));
  for (const [k, v] of Object.entries(times)) fs.writeFileSync(path.join(dev, k), String(v));
  if (kept === null) fs.rmSync(paceFile, { force: true }); else if (kept) fs.writeFileSync(paceFile, JSON.stringify(kept));
  const old = { ...process.env };
  Object.assign(process.env, env);
  try {
    const m = await G.launch(adb, { timeoutMs, paceFile });
    const note = (f) => { try { return fs.readFileSync(path.join(dev, f), 'utf8').slice(-300); } catch { return null; } };
    lastLaunch = { m, t0: note('t0'), logcat: note('logcat.log'), ocr: note('ocr.log'), probe: adb.run(['exec-out', 'screencap', '-p']).stdout?.toString().slice(0, 60) };
    const reads = fs.existsSync(path.join(dev, 'ocr.log')) ? fs.readFileSync(path.join(dev, 'ocr.log'), 'utf8').trim().split('\n').filter(Boolean).map(Number) : [];
    return { m, reads };
  } finally { for (const k of Object.keys(env)) if (k in old) process.env[k] = old[k]; else delete process.env[k]; }
}

await t('launch: nothing kept → reads from the window at widening gaps; the title, and its titleS kept', async () => {
  const { m, reads } = await start({ pid: 0, win: 600, title: 4000 }, { kept: null });
  eq(m.license, 'ok'); ok(m.titleS >= 4 && m.titleS < 7, `titleS ${m.titleS}`);
  ok(m.windowS < 2 && m.drawnS < 3, `windowS ${m.windowS} drawnS ${m.drawnS}`);
  eq(m.ocr.gate, 'window'); ok(m.ocr.fromS < 2, `fromS ${m.ocr.fromS}`);
  ok(reads.length <= 5, `reads ${reads.join(',')} (every 0.5 s would be ~7)`);
  for (let i = 2; i < reads.length; i++) ok(reads[i] - reads[i - 1] >= reads[i - 1] - reads[i - 2] - 100, `gaps widen: ${reads.join(',')}`);
  eq(P.readPace(paceFile), { titles: [m.titleS] });
  ok(!m.why && /Get started/.test(m.words), m.words);
});
await t('launch: titleS kept → no read before 7/10 of it, the same result', async () => {
  const { m, reads } = await start({ pid: 0, win: 600, title: 3000 }, { kept: { titles: [9, 6] } });
  eq(m.license, 'ok'); eq(m.ocr.gate, 'prev'); eq(m.ocr.prevS, 6);
  ok(reads.length >= 1 && reads[0] >= 4200, `first read ${reads[0]} (7/10 of 6 s = 4.2 s)`);
  ok(m.titleS >= 4.2 && m.titleS < 6, `titleS ${m.titleS}`);
  eq(m.ocr.n, reads.length); eq(reads.length, 1, 'the title at the first read');
  eq(P.readPace(paceFile).titles, [9, 6, m.titleS]);
});
await t('launch: the REDROID_TITLE_LOG line opens the reads before 7/10', async () => {
  const { m, reads } = await start({ pid: 0, win: 500, logline: 1500, title: 2000 }, { kept: { titles: [20] }, timeoutMs: 30_000, env: { REDROID_TITLE_LOG: 'lab title near' } });
  eq(m.ocr.gate, 'log'); ok(m.logS >= 1.5 && m.logS < 5, `logS ${m.logS}`);
  ok(reads[0] >= 1500 && reads[0] < 5000, `first read ${reads[0]}`);
  ok(m.titleS && m.titleS < 8, `titleS ${m.titleS}`); eq(m.license, 'ok');
});
await t('launch: a first-start screen is left (firstRun 1) and the title found; that start is not kept', async () => {
  const { m } = await start({ pid: 0, win: 500, title: 0, welcome: 1 }, { kept: { titles: [3] } });
  eq(m.firstRun, 1); eq(m.license, 'ok'); ok(m.titleS > 0, `titleS ${m.titleS}`);
  eq(P.readPace(paceFile), { titles: [3] });
});
await t('launch: a broken title-pace.json ({"titles":"48"}) → read from the window, not stopped', async () => {
  for (const kept of [{ titles: '48' }, { titles: {} }]) {
    const { m } = await start({ pid: 0, win: 500, title: 1500 }, { kept });
    eq(m.license, 'ok'); eq(m.ocr.gate, 'window'); eq(m.ocr.prevS, null);
    eq(P.readPace(paceFile), { titles: [m.titleS] });
  }
});
await t('launch: titleS kept but the timeout shorter than gate + 10 s → no gate, the title found from the window', async () => {
  const { m, reads } = await start({ pid: 0, win: 500, title: 2000 }, { kept: { titles: [60] }, timeoutMs: 15_000 });
  eq(m.license, 'ok'); eq(m.ocr.gate, 'window'); ok(reads[0] < 2000, `first read ${reads[0]}`);
  ok(m.titleS < 5, `titleS ${m.titleS}`);
});
await t("launch: Play's paywall → license no, the screen not read", async () => {
  const { m, reads } = await start({ pid: 0, win: 500, vending: 1500 }, { kept: { titles: [30] } });
  ok(m.license?.startsWith('no（com.android.vending'), m.license); eq(m.titleS, undefined); eq(reads.length, 0);
  ok(m.why && m.why.pid === 1234, JSON.stringify(m.why));
  eq(P.readPace(paceFile), { titles: [30] });
});
await t('launch: the game gone for 4 s → license no', async () => {
  const { m } = await start({ pid: 0, gone: 800 }, { kept: null });
  ok(m.license === 'no（com.android.launcher3/.Launcher）', m.license); eq(m.ocr.n, 0);
});
await t('launch: REDROID_OCR_PACE=0 → read at every round from the window, as before (logcat not read)', async () => {
  const { m, reads } = await start({ pid: 0, win: 500, title: 3500 }, { kept: { titles: [30] }, env: { REDROID_OCR_PACE: '0' } });
  eq(m.license, 'ok'); eq(m.ocr.gate, 'window'); ok(reads[0] < 2000, `first read ${reads[0]}`);
  ok(reads.length >= 4, `reads ${reads.join(',')}`);
  ok(!fs.existsSync(path.join(dev, 'logcat.log')), 'logcat read');
});
await t('launch: no OCR → said at the window (not at 7/10 of titleS)', async () => {
  const { m } = await start({ pid: 0, win: 500, title: 1000 }, { kept: { titles: [30] }, env: { APP_TESSERACT: path.join(tmp, 'no-tesseract') } });
  eq(m.note, 'OCR なし: タイトルは見ていません'); eq(m.titleS, null); ok(m.windowS < 3, `windowS ${m.windowS}`);
});

console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
