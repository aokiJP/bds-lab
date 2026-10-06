// The run folder → report.md (GitHub job summary too), index.html (screenshots to look at) and result.json.
// guard(): a run folder must hold screenshots and logs only: never the APK, a .so or a secret (same checks as
// bedrock-binary's scripts/guard-binaries.js: the content's magic bytes, not just the name).
import fs from 'node:fs';
import path from 'node:path';
import { anonymize } from './ghresults.mjs';
import { logLevel as clientLevel } from './client.mjs';

const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]), ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const FORBIDDEN_EXT = /\.(apk|apks|xapk|aab|so|dex|zip|mcpack|mcaddon)$/i;
const SECRET_NAME = /(^|\/)(\.env(\.[^/]*)?|apkeep\.ini|.*\.pem)$/;
const SECRET_TEXT = /(aas_et\/[A-Za-z0-9_-]{20,}|oauth2_4\/[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

function* walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }
const head = (f) => { const fd = fs.openSync(f, 'r'); try { const b = Buffer.alloc(4); const n = fs.readSync(fd, b, 0, 4, 0); return b.subarray(0, n); } finally { fs.closeSync(fd); } };

/** @returns {string[]} problems (empty = safe to upload) */
export function guard(dir, secrets = []) {
  const bad = [];
  if (!fs.existsSync(dir)) return bad;
  for (const f of walk(dir)) {
    const r = path.relative(dir, f).split(path.sep).join('/');
    const st = fs.lstatSync(f);
    if (st.isSymbolicLink()) { bad.push(`${r}: symbolic link`); continue; }
    if (FORBIDDEN_EXT.test(r)) { bad.push(`${r}: extension`); continue; }
    if (SECRET_NAME.test(r)) { bad.push(`${r}: a secret's file name`); continue; }
    const h = head(f);
    if (h.equals(ELF)) bad.push(`${r}: ELF inside`);
    else if (h.equals(ZIP)) bad.push(`${r}: ZIP/APK inside`);
    else if (/\.(txt|log|md|json|html)$/i.test(r) && st.size < 64e6) {
      const t = fs.readFileSync(f, 'utf8');
      if (SECRET_TEXT.test(t) || secrets.some((s) => s && s.length >= 12 && t.includes(s))) bad.push(`${r}: a token in the text`);
    }
  }
  return bad;
}

// a logcat -v threadtime line: date time pid tid level tag: message
const LC = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?)\s*: (.*)$/;
const KEY = /FATAL|licen[cs]|\bLVL\b|BadAuthentication|NeedsBrowser|AccountManager|android\.accounts\.|AuthenticatorException|vending/i;
// Android itself going down (system_server restarting takes every app with it): what to read first
const SYSDEATH = /FATAL EXCEPTION IN SYSTEM PROCESS|WATCHDOG KILLING|>>> system_server <<<|Fatal signal \d+|lowmemorykiller|\blmkd\b.*[Kk]ill|Out of memory|System server process \d+ has died|Exit zygote|SystemServer.*(crash|died|restart)/;
// ActivityManager's CPU table after an ANR ("12% 8256/com.x: 10% user + 1.9% kernel", "100% TOTAL: …"): noise here
const CPUROW = /^[+-]?\d+(\.\d+)?% (\d+\/|TOTAL:)|^CPU usage from |^PSI |^(some|full) avg\d+=/;
// the emulator's GL driver complaining (hundreds a second while the game loads): noise here
const GLNOISE = (tag, msg) => /^emuglGLESv2_enc$/.test(tag) || (tag === 'libEGL' && /unimplemented OpenGL ES API/.test(msg));
const SYSTAGS = /^(ActivityManager|ActivityTaskManager|AccountManagerService|SystemServer|SystemServerTiming|PackageManager|Watchdog)$/;
/**
 * the logcat lines worth reading when a run fails (pure), most important first:
 *   1. Android itself dying (system_server: watchdog, its own fatal exception, a native crash, the low-memory killer)
 *   2. the app's start and end
 *   3. system_server's own errors, then the app's warnings/errors and FATAL / license / account / Play Store lines
 * Stack frames are dropped (an exception = its headline and "Caused by"), apps that only died because the system did
 * (DeadSystemException) are one line, repeats are folded into "(×N)", the time is cut. Tokens and e-mails are masked.
 */
export function logcatDigest(text, pkg, { max = 80 } = {}) {
  const rows = [], app = new Set(), sys = new Set();
  for (const l of String(text).split(/\r?\n/)) {
    const m = LC.exec(l);
    if (!m) continue;
    const [, pid, , lv, tag, msg] = m;
    const st = /Start proc (\d+):([\w.:]+)/.exec(msg);
    if (st && st[2].startsWith(pkg)) app.add(st[1]);
    if (SYSTAGS.test(tag)) sys.add(pid);
    rows.push({ pid, lv, tag, msg: msg.trim() });
  }
  // apps that crashed only because system_server died: their AndroidRuntime lines become one list
  const deadSys = new Set(rows.filter((r) => r.tag === 'AndroidRuntime' && /DeadSystemException/.test(r.msg)).map((r) => r.pid));
  const victims = [...new Set(rows.filter((r) => deadSys.has(r.pid) && r.tag === 'AndroidRuntime').map((r) => /^Process: ([\w.:]+)/.exec(r.msg)?.[1]).filter(Boolean))];
  const pkgRe = new RegExp(String(pkg).replace(/\./g, '\\.'));
  const death = [], life = [], mine = [], key = [];
  for (const { pid, lv, tag, msg } of rows) {
    if (/^at [\w$.<>-]+\(|^\.\.\. \d+ more$/.test(msg) || !msg) continue;   // stack frames
    if (/^Zygote$/.test(tag) && /exited due to signal 9/.test(msg)) continue;   // the emulator shutting down
    if (tag === 'AndroidRuntime' && deadSys.has(pid)) continue;   // (listed once below)
    if (CPUROW.test(msg) || GLNOISE(tag, msg)) continue;
    const s = `${pid} ${lv} ${tag}: ${msg}`;
    if (SYSDEATH.test(msg) || (tag === 'Watchdog' && /[EFW]/.test(lv)) || (/^(DEBUG|libc|crash_dump\d*|tombstoned)$/.test(tag) && /[EF]/.test(lv) && /system_server|signal|Abort|Cause:|backtrace:|#0[0-4] /.test(msg))) death.push(s);
    else if (/ActivityManager|ActivityTaskManager|libprocessgroup/.test(tag) && pkgRe.test(msg) && /Start proc|died|Killing|Force finishing|crash|ANR|not responding|kill/i.test(msg)) life.push(s);
    else if (app.has(pid) && /[WEF]/.test(lv)) mine.push(s);
    else if ((sys.has(pid) && /[EF]/.test(lv)) || KEY.test(msg) || (/^(AndroidRuntime|DEBUG|libc|crash_dump\d*)$/.test(tag) && /[EF]/.test(lv))) key.push(s);
  }
  if (victims.length) death.push(`（system_server が落ちた巻き添えで DeadSystemException になったプロセス ${victims.length} 個: ${victims.join(', ')}）`);
  // repeats are folded; lines that differ only in their numbers ("INPUT device id 3", "id 4", …) count as repeats
  const fold = (arr) => {
    const out = [], n = new Map(), key = (s) => s.replace(/^\d+ /, '').replace(/\d+/g, '#');
    for (const s of arr) { const k = key(s); if (n.has(k)) n.get(k).n++; else { const e = { s, n: 1 }; n.set(k, e); out.push(e); } }
    return out.map((e) => (e.n > 1 ? `${e.s} (×${e.n})` : e.s));
  };
  const ends = (arr, h, t) => (arr.length <= h + t ? arr : [...arr.slice(0, h), `…（${arr.length - h - t} 行省略）`, ...arr.slice(-t)]);
  const a = fold(death).slice(0, Math.floor(max / 2)), b = fold(life).slice(-8), c = fold(key);
  const head = [...(a.length ? ['== 落ちた跡（Android とアプリ）==', ...a] : []), ...b, ...(mine.length ? ['== アプリ自身の警告・エラー（落ちる直前が最後）==', ...ends(fold(mine), 5, 25)] : []), ...(c.length ? ['== そのほか（system_server・ライセンス・アカウント）==' ] : [])];
  return [...head, ...c.slice(-Math.max(0, max - head.length))].map((x) => anonymize(x));
}

/**
 * every logcat line (any level, any process) from `before` ms before each end of the app's process to `after` ms after it
 * (pure): what else happened on the device when the game went (another activity on top, a dialog, the license check, a
 * signal). The digest above filters by level and process; this does not. Values masked; at most `max` lines a death
 */
export function deathExcerpt(text, pkg, { before = 10_000, after = 2_000, max = 260 } = {}) {
  const rows = String(text).split(/\r?\n/), at = (l) => { const m = /^(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d+)/.exec(l); return m ? ((((+m[3]) * 60 + (+m[4])) * 60 + (+m[5])) * 1000 + Number(m[6].slice(0, 3).padEnd(3, '0'))) : null; };
  const re = new RegExp(`Process ${String(pkg).replace(/\./g, '\\.')} \\(pid \\d+\\) has died|Force finishing activity ${String(pkg).replace(/\./g, '\\.')}`), out = [];
  let last = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    if (!re.test(rows[i])) continue;
    const t = at(rows[i]);
    if (t === null || t - last < after) continue;
    last = t;
    const pick = rows.filter((l) => { const u = at(l); return u !== null && u >= t - before && u <= t + after && !/emuglGLESv2_enc|unimplemented OpenGL ES API/.test(l); });
    out.push(`== ${rows[i].slice(0, 18)} の前後（${before / 1000} 秒前から ${after / 1000} 秒後まで、${pick.length} 行）==`, ...(pick.length > max ? [...pick.slice(0, 20), `…（${pick.length - max} 行省略）`, ...pick.slice(-(max - 20))] : pick));
  }
  return out.map((l) => anonymize(l));
}

/** the GitHub annotation form of a text (pure): %, CR and LF escaped (the message runs to the end of the line) */
export const ghEscape = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const tailText = (f, n) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim()).slice(-n).join('\n') : '');
/**
 * a run folder as GitHub annotations, so the result can be read through the API alone (where artifacts and job logs
 * cannot be fetched): the report, run.txt, the logcat digest, Android's crash records (dropbox.txt) and the words on each screenshot (ocr(png) →
 * text, optional). Values are masked; each body is capped.
 * @returns {Array<{title:string, body:string}>}
 */
export function annotations(runDir, { ocr = null, secrets = [], bytes = 3800 } = {}) {
  const name = path.basename(runDir), out = [];
  // GitHub cuts an annotation at about 4 KB: a long text goes into parts (up to `parts`, on line boundaries)
  const add = (title, body, parts = 1) => {
    body = anonymize(body, secrets).trim();
    if (!body) return;
    const chunks = [[]];
    for (let l of body.split('\n')) {
      while (Buffer.byteLength(l) > bytes) l = l.slice(0, Math.floor(l.length * 0.9));
      const cur = chunks.at(-1);
      if (Buffer.byteLength([...cur, l].join('\n')) > bytes) chunks.push([l]); else cur.push(l);
    }
    const kept = chunks.slice(0, parts);
    if (chunks.length > parts) kept.at(-1).push('…（以下略）');
    kept.forEach((c, i) => out.push({ title: `${title}${kept.length > 1 ? ` ${i + 1}/${kept.length}` : ''}（${name}）`, body: c.join('\n') }));
  };
  const rep = path.join(runDir, 'report.md');
  add('報告', fs.existsSync(rep) ? fs.readFileSync(rep, 'utf8').replace(/<[^>]+>/g, '') : '');
  add('run.txt', tailText(path.join(runDir, 'run.txt'), 80), 2);
  add('logcat の要約', tailText(path.join(runDir, 'logcat-digest.txt'), 200), 3);
  add('Android のクラッシュ記録（dropbox）', tailText(path.join(runDir, 'dropbox.txt'), 200));
  const shots = path.join(runDir, 'shots');
  if (ocr && fs.existsSync(shots)) {
    const words = fs.readdirSync(shots).filter((f) => /\.png$/i.test(f)).sort().map((f) => {
      let t = ''; try { t = String(ocr(path.join(shots, f)) ?? ''); } catch { t = '（読めませんでした）'; }
      return `[${f}] ${t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' / ') || '（文字なし）'}`;
    });
    add('画面の文字（OCR）', words.join('\n'), 2);
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** r: { ok, addon, app:{versionName, versionCode, abis}, bds:{version, exact}, scenario, results, shots, notes[], started, ended, device } */
export function writeReport(runDir, r) {
  const rel = (f) => path.relative(runDir, f).split(path.sep).join('/');
  const dur = Math.round((r.ended - r.started) / 1000);
  const md = [
    `# app: ${r.ok ? 'PASS' : 'FAIL'} — ${r.addon}`,
    '',
    `| | |`, `|---|---|`,
    `| 結果 | ${r.ok ? 'PASS（すべての手順が通った）' : 'FAIL'} |`,
    `| アプリ | ${r.app?.versionName ? `${r.app.versionName} (${r.app.versionCode})${r.app.abis ? ` ${r.app.abis.join(',')}` : ''}` : '—'} |`,
    `| BDS | ${r.bds?.version ?? '—'}${r.bds && !r.bds.exact ? '（同じ系列の近い版）' : ''} |`,
    `| 端末 | ${r.device ?? '—'} |`,
    ...(r.path ? [`| 道 | ${r.path} |`] : []),
    `| シナリオ | ${r.scenario} |`,
    ...(r.timing?.join ? [`| 参加 | ${(r.timing.join / 1000).toFixed(1)} 秒（参加リンク → ワールドに出るまで）${r.timing.fromStart ? `。端末の起動から ${(r.timing.fromStart / 1000).toFixed(1)} 秒` : ''} |`] : []),
    ...(r.timing?.device ? [`| 準備済みの端末 | ${(r.timing.device / 1000).toFixed(1)} 秒で戻りました（Minecraft はタイトル画面で起動済み） |`] : []),
    `| 時間 | ${dur}s |`,
    '',
    ...(r.fatal ? ['## 途中で止まりました', '', `- ${r.fatal}`, ''] : []),
    ...(r.next?.length ? ['## 次にやること', '', ...r.next.map((n) => `- ${n}`), ''] : []),
    ...(r.sections?.length ? ['## 画面ごと（section）', '', '| 区切り | 結果 | 時間 | クライアントのエラー / 警告 |', '|---|---|---|---|',
      ...r.sections.map((x) => { const e = (x.client ?? []).filter((l) => clientLevel(l) === 'error').length, w = (x.client ?? []).filter((l) => clientLevel(l) === 'warn').length; return `| ${x.name} | ${x.ok ? '✔' : '✘'} | ${((x.ms ?? 0) / 1000).toFixed(1)}s | ${e} / ${w} |`; }), ''] : []),
    ...(r.client ? ['## クライアントのエラー（ゲームのコンテンツログ）', '',
      ...(r.client.source ? [`- 読んだ場所: ${r.client.source}`] : []), ...(r.client.logcat?.length ? r.client.logcat.map((l) => `- （logcat）${l.slice(0, 300)}`) : []),
      ...(!r.client.readable ? ['- 読めませんでした（端末で root になれない）'] : r.client.found === false && r.client.enabled === true ? ['- なし（コンテンツログはオン。ゲームは最初の 1 行でファイルを作る: ファイルが無い = 1 行も出ていない）'] : r.client.found === false ? ['- コンテンツログのファイルがありません（ゲームの設定で出力が無効？）。クライアントのエラーは読めていません'] : r.client.errors.length || r.client.warnings.length
        ? [...r.client.errors.slice(0, 40).map((x) => `- ✘ [${x.section}] ${x.line.slice(0, 300)}`), ...(r.client.errors.length > 40 ? [`- …ほか ${r.client.errors.length - 40} 行`] : []),
          ...r.client.warnings.slice(0, 15).map((x) => `- ⚠ [${x.section}] ${x.line.slice(0, 300)}`), ...(r.client.warnings.length > 15 ? [`- …警告ほか ${r.client.warnings.length - 15} 行`] : [])]
        : [`- なし（コンテンツログ ${r.client.lines} 行を読みました）`]), ''] : []),
    ...(r.perf?.length ? ['## 性能（perf）', '', ...r.perf.map((p) => `- ${p.line} 行目 [${p.section}]: メモリ ${p.mem ?? '?'} MB、${p.fps === null || p.fps === undefined ? '毎秒のフレーム数は不明' : `${p.fps.toFixed(1)} fps`}`), ''] : []),
    ...(r.recordings?.length ? ['## 録画', '', ...r.recordings.map((f) => `- ${f}`), ''] : []),
    '## 手順',
    '',
    ...(r.results.length ? [] : ['- （シナリオまで進みませんでした）']),
    ...r.results.map((x) => `- ${x.ok ? '✔' : '✘'} ${x.line}: \`${x.raw.replace(/`/g, "'")}\`${x.note ? ` — ${x.note.replace(/\n/g, ' ')}` : ''}${x.shot ? `（画面: ${x.shot}）` : ''}`),
    ...(r.notes?.length ? ['', '## 気づいたこと', '', ...r.notes.map((n) => `- ${n}`)] : []),
    '', '## 画面', '',
    ...r.shots.map((f) => `- ${rel(f)}`),
    '', '## ログ', '',
    '- `logcat.txt` … アプリ側（Android）のログ全部、`logcat-minecraft.txt` … そのうち Minecraft の行',
    '- `server.log` … BDS のログ、`do.txt` … `do` / `sh` の出力、`steps.txt` … 手順の結果',
    '- `pulled/` … 端末から取り出したもの（コンテンツログなど）',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'report.md'), md);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>app ${esc(r.addon)} ${r.ok ? 'PASS' : 'FAIL'}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#111;color:#ddd}h1{color:${r.ok ? '#7c7' : '#e66'}}
figure{margin:0 0 28px}img{max-width:100%;border:1px solid #333}figcaption{color:#aaa;margin:6px 0}li.ng{color:#e88}code{color:#fc6}</style>
<h1>${r.ok ? 'PASS' : 'FAIL'} — ${esc(r.addon)}</h1>
<p>アプリ ${esc(r.app?.versionName ?? '—')} / BDS ${esc(r.bds?.version ?? '—')} / ${dur}s${r.timing?.join ? ` / 参加 ${(r.timing.join / 1000).toFixed(1)} 秒` : ''}</p>
${r.fatal ? `<p style="color:#e88">途中で止まりました: ${esc(r.fatal)}</p>` : ''}
${r.next?.length ? `<h2>次にやること</h2><ul>${r.next.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
${r.notes?.length ? `<h2>気づいたこと</h2><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<h2>手順</h2>
<ul>${r.results.map((x) => `<li class="${x.ok ? '' : 'ng'}">${x.ok ? '✔' : '✘'} ${x.line}: <code>${esc(x.raw)}</code> ${esc(x.note ?? '')}</li>`).join('')}</ul>
<h2>画面</h2>
${r.shots.map((f) => `<figure><img src="${esc(rel(f))}" loading="lazy"><figcaption>${esc(path.basename(f))}</figcaption></figure>`).join('\n')}
`;
  fs.writeFileSync(path.join(runDir, 'index.html'), html);
  fs.writeFileSync(path.join(runDir, 'steps.txt'), r.results.map((x) => `${x.ok ? 'OK  ' : 'FAIL'} ${x.line} ${x.raw}${x.note ? `  ${x.note}` : ''}`).join('\n') + '\n');
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({ ...r, shots: r.shots.map(rel) }, null, 2));
  return md;
}
