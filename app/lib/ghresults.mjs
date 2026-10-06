// A run folder through the GitHub API alone: where artifacts and job logs cannot be fetched (a proxy that allows
// api.github.com only, a phone, an AI in a sandbox), the workflow's second job posts the run as check runs, and
// `app ci` reads them back into a folder: the report, the logs, the logcat lines that matter and every screenshot
// (shrunk to a PNG that fits a check run's text, as base64).
//   payload (the workflow side): checksPayload(runDir) → [{ name, title, summary, text }]
//   back (the reading side):     unpackChecks(checkRuns, dir) → files
// A check run holds about 64 K characters in each of summary and text. Every text is masked (tokens, e-mails, secrets).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pngDecode } from '../../common/extra.mjs';

export const CHECK_PREFIX = 'app: ';
export const LIMIT = 65000;   // characters per summary / text (GitHub: 65535)
const LC = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d+\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?)\s*: (.*)$/;
const CPUROW = /^[+-]?\d+(\.\d+)?% (\d+\/|TOTAL:)|^CPU usage from |^PSI |^(some|full) avg\d+=/;
// the emulator's GL driver complaining (hundreds a second while the game loads): noise here
const GLNOISE = (tag, msg) => /^emuglGLESv2_enc$/.test(tag) || (tag === 'libEGL' && /unimplemented OpenGL ES API/.test(msg));
const SYSTAGS = /^(ActivityManager|ActivityTaskManager|AccountManagerService|SystemServer|SystemServerTiming|PackageManager|Watchdog)$/;

// Scrub anything that could identify a person or the machine, so the output is safe to show on a stream: secrets passed
// in, Google tokens, e-mail addresses (and so the account name in `Account {name=…}`), device / android ids, and home
// paths that carry a username. Errors keep their wording; only these values are replaced.
export function anonymize(s, secrets = []) {
  let t = String(s);
  for (const x of secrets) if (x && x.length >= 6) t = t.split(x).join('<secret>');
  return t
    .replace(/(aas_et|oauth2_4)\/[A-Za-z0-9._=-]+/g, '<token>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/(setCachedDeviceId\(|\bandroid[_-]?id["'=:\s]+|\bGSF[ _]?id["'=:\s]+|\bdevice[_-]?id["'=:\s]+)[0-9a-fA-Fx]{8,}/gi, '$1<id>')
    .replace(/(\/home\/|\/Users\/)[^/\s"':]+/g, '$1<user>');
}
export const mask = anonymize;   // (earlier name)

// only the lines worth showing when something went wrong: results (report headers / step marks), warnings and errors,
// crash and ANR lines. The ordinary progress chatter ("[1/5] …", a passed step's detail) is dropped. Section headers
// are kept only when they still have a line under them.
const ERR = /(^|\s)(W |E |ERR\b|FAIL\b)|Exception|Error|FATAL|\bANR\b|EGL_BAD|signal \d|not responding|denied|Caused by|crash|died|timed out|Traceback|✘/;
const HEADER = /^(=====|#{1,6} |\| )/;
export function errorLines(text) {
  const lines = String(text).split(/\r?\n/), out = [];
  for (const l of lines) {
    if (HEADER.test(l)) { while (out.length && HEADER.test(out.at(-1))) out.pop(); out.push(l); }   // keep only the latest empty header
    else if (ERR.test(l)) out.push(l);
  }
  while (out.length && HEADER.test(out.at(-1))) out.pop();
  return out.join('\n');
}
/** the last part of a text that fits in n characters, cut on a line boundary (pure) */
export function tailFit(s, n = LIMIT) {
  s = String(s);
  if (s.length <= n) return s;
  const cut = s.slice(s.length - n + 40), nl = cut.indexOf('\n');
  return '…（前を省略）\n' + (nl >= 0 ? cut.slice(nl + 1) : cut);
}
const headFit = (s, n = LIMIT) => (String(s).length <= n ? String(s) : String(s).slice(0, n - 20) + '\n…（以下略）');

/**
 * logcat, wider than the digest (pure): with the time and the stack frames, the lines of the app's processes and
 * system_server at W and up, crash tags (AndroidRuntime, DEBUG, libc, crash_dump, tombstoned, Watchdog) and anything
 * naming the app. The ANR CPU table is left out.
 */
export function logcatWide(text, pkg) {
  const rows = [], app = new Set(), sys = new Set();
  for (const l of String(text).split(/\r?\n/)) {
    const m = LC.exec(l);
    if (!m) continue;
    const [, pid, , lv, tag, msg] = m;
    const st = /Start proc (\d+):([\w.:]+)/.exec(msg);
    if (st && st[2].startsWith(pkg)) app.add(st[1]);
    if (SYSTAGS.test(tag)) sys.add(pid);
    rows.push({ l, pid, lv, tag, msg });
  }
  return rows.filter(({ pid, lv, tag, msg }) => !CPUROW.test(msg.trim()) && !GLNOISE(tag, msg) && (
    ((app.has(pid) || sys.has(pid)) && /[WEF]/.test(lv)) ||
    /^(AndroidRuntime|DEBUG|libc|crash_dump\d*|tombstoned|Watchdog)$/.test(tag) ||
    msg.includes(pkg))).map((r) => r.l);
}

/** a screenshot as a small PNG (16 levels a channel, RGB, Sub filter): the largest width whose file fits maxBytes */
export function thumbPng(buf, { maxBytes = 48000, widths = [540, 432, 360, 288, 216, 160, 120] } = {}) {
  const img = pngDecode(buf);
  for (const W of widths) {
    const k = Math.max(1, img.w / W), w = Math.max(1, Math.round(img.w / k)), h = Math.max(1, Math.round(img.h / k));
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      const o = y * (w * 3 + 1);
      raw[o] = 1;   // Sub
      const y0 = Math.floor(y * k), y1 = Math.max(y0 + 1, Math.floor((y + 1) * k));
      let prev = [0, 0, 0];
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * k), x1 = Math.max(x0 + 1, Math.floor((x + 1) * k));
        const s = [0, 0, 0]; let n = 0;
        for (let yy = y0; yy < Math.min(y1, img.h); yy++) for (let xx = x0; xx < Math.min(x1, img.w); xx++) { const p = (yy * img.w + xx) * 4; s[0] += img.data[p]; s[1] += img.data[p + 1]; s[2] += img.data[p + 2]; n++; }
        for (let c = 0; c < 3; c++) { const v = (Math.round(s[c] / Math.max(1, n)) & 0xf0) | 0x08; raw[o + 1 + x * 3 + c] = (v - prev[c]) & 255; prev[c] = v; }
      }
    }
    const png = pngRgb(w, h, zlib.deflateSync(raw, { level: 9 }));
    if (png.length <= maxBytes || W === widths.at(-1)) return { png, w, h, from: { w: img.w, h: img.h } };
  }
}
function pngRgb(w, h, idat) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
/**
 * the check runs for one run folder (pure but for reading the folder):
 *   "app: 結果"    summary = report.md, text = run.txt / logcat digest / dropbox / do.txt / steps.txt / server.log tail
 *   "app: logcat"  summary and text = the wide logcat (older half, newer half)
 *   "app: 画面 NN-name.png" text = the shrunk PNG as base64
 */
export function checksPayload(runDir, { pkg = 'com.mojang.minecraftpe', secrets = [], full = false, shard = null } = {}) {
  const m = (s) => anonymize(s, secrets), res = [];
  // one device of several (the workflow's parallel devices): its checks carry "[k/n]" after the kind
  const tag = shard ? ` [${shard}]` : '';
  const report = read(path.join(runDir, 'report.md')), ok = /^# app: PASS/m.test(report);
  const part = (title, f, n, filter = (x) => x) => { const t = filter(read(path.join(runDir, f)).trim()); return t ? `===== ${title} (${f}) =====\n${tailFit(t, n)}\n` : ''; };
  // default: result + errors only (safe to show on a stream). full=true adds the verbose logs for deep debugging.
  const text = full
    ? [part('準備', 'prepare.txt', 8000), part('GPU とゲーム自身のログ', 'gpu.txt', 12000), part('ライセンス（端末が知っていること）', 'license.txt', 6000), part('Play・Google のサービスのログ', 'license-log.txt', 14000), part('このパソコン（15 秒ごと）', 'host.txt', 5000), part('ゲームの設定（options.txt）', 'game-options.txt', 6000), part('run', 'run.txt', 12000), part('logcat の要約', 'logcat-digest.txt', 14000), part('アプリが終わった前後の logcat', 'logcat-death.txt', 16000), part('Android のクラッシュ記録', 'dropbox.txt', 14000),
      part('do / sh の出力', 'do.txt', 8000), part('手順', 'steps.txt', 6000), part('BDS', 'server.log', 6000), part('adb', 'adb.txt', 4000)].join('\n')
    : [part('準備', 'prepare.txt', 6000), part('ゲームの設定（options.txt）', 'game-options.txt', 7000), part('GPU とゲーム自身のログ', 'gpu.txt', 12000), part('ライセンス（端末が知っていること）', 'license.txt', 6000), part('Play・Google のサービスのログ', 'license-log.txt', 10000), part('このパソコン（15 秒ごと）', 'host.txt', 3000), part('警告・エラー', 'run.txt', 8000, errorLines), part('アプリが終わった前後の logcat', 'logcat-death.txt', 10000), part('クラッシュ記録', 'dropbox.txt', 14000), part('ログ中のエラー', 'logcat-digest.txt', 12000, errorLines)].join('\n');
  res.push({ name: `${CHECK_PREFIX}結果${tag}`, title: `${ok ? 'PASS' : 'FAIL'}${tag} ${path.basename(runDir)}`, summary: headFit(m(report) || '（report.md がありません）'), text: tailFit(m(text)) || '（エラーはありません）' });
  const lc = full ? read(path.join(runDir, 'logcat.txt')) : '';
  if (lc) {
    const wide = tailFit(m(logcatWide(lc, pkg).join('\n')), 2 * LIMIT - 400);
    // two halves on a line boundary: the older in summary, the newer in text
    const cut = wide.length > LIMIT - 200 ? wide.indexOf('\n', wide.length - (LIMIT - 200)) : -1;
    res.push({ name: `${CHECK_PREFIX}logcat${tag}`, title: `logcat（アプリと system_server の W 以上、クラッシュ、${pkg} の行）`,
      summary: cut > 0 ? wide.slice(0, cut) : '（全部 text にあります）', text: cut > 0 ? wide.slice(cut + 1) : wide });
  }
  const shots = path.join(runDir, 'shots');
  if (fs.existsSync(shots)) for (const f of fs.readdirSync(shots).filter((x) => /\.png$/i.test(x)).sort()) {
    let t;
    try { t = thumbPng(fs.readFileSync(path.join(shots, f))); } catch (e) { res.push({ name: `${CHECK_PREFIX}画面${tag} ${f}`, title: `${f}: 読めません`, summary: String(e.message), text: '' }); continue; }
    res.push({ name: `${CHECK_PREFIX}画面${tag} ${f}`, title: `${f} ${t.w}x${t.h}（元 ${t.from.w}x${t.from.h}）`, summary: `${f} を ${t.w}x${t.h} に縮めた PNG（各色 16 段階）。text が base64 です（node lab.mjs app ci fetch <run> で画像に戻ります）`, text: t.png.toString('base64') });
  }
  return res;
}

/**
 * a job that left no run folder (no artifact): what the job API still says (pure). job: { name, steps: [{ name, conclusion,
 * started_at, completed_at }] }, annotations: [{ annotation_level, title, message }] of that job.
 * Exit 143 (SIGTERM) or 137 (SIGKILL) with every later step skipped, Post steps too, is the runner being stopped from
 * outside mid-step (what GitHub does when the machine runs out of memory or disk), not the lab failing; the run's own
 * progress notices ("app [n/5] …", with the machine's load / memory / disk) say how far it got.
 * @returns {{ title: string, lines: string[], summary: string, stopped: boolean }}
 */
export function explainJob(job, annotations = []) {
  const steps = job?.steps ?? [], i = steps.findIndex((s) => s.conclusion === 'failure' || s.conclusion === 'cancelled'), bad = steps[i];
  const secs = bad?.started_at && bad?.completed_at ? Math.round((Date.parse(bad.completed_at) - Date.parse(bad.started_at)) / 1000) : null;
  const code = Number(/Process completed with exit code (\d+)/.exec(annotations.map((a) => a.message).join('\n'))?.[1]) || null;
  const after = i >= 0 ? steps.slice(i + 1).filter((s) => !/^(Complete job|Set up job)$/.test(s.name)) : [];   // (the runner's own)
  const stopped = (code === 143 || code === 137) && after.length > 0 && after.every((s) => s.conclusion === 'skipped');
  const posts = after.some((s) => /^Post /.test(s.name));
  const progress = annotations.filter((a) => a.annotation_level === 'notice' && /^app /.test(a.title ?? ''));
  const errors = annotations.filter((a) => a.annotation_level === 'failure' && !/^Process completed with exit code/.test(a.message ?? ''));
  const dur = secs === null ? '' : `${Math.floor(secs / 60)} 分 ${secs % 60} 秒で`;
  const why = code === 143 ? '終了コード 143（SIGTERM: 外から止められた）' : code === 137 ? '終了コード 137（SIGKILL: 強制終了。メモリ不足のことが多い）' : code ? `終了コード ${code}` : '';
  const lines = [bad ? `「${bad.name}」が ${dur}止まりました${why ? `: ${why}` : ''}` : '失敗した手順が見当たりません（ジョブが始まる前に止まった？）'];
  if (stopped) lines.push(`その後の手順は${posts ? ' always() のものも Post も' : ''}全部 skipped: ランナーごと止められた形です（ラボの失敗ではなく、ランナーの停止。マシンのメモリやディスクが尽きたときによく起きます）。成果物もここで失われました`);
  if (progress.length) lines.push(`最後の進行: ${progress.at(-1).title} ${progress.at(-1).message}`, ...(progress.length > 1 ? [`最初の進行: ${progress[0].title} ${progress[0].message}`] : []));
  else if (stopped) lines.push('進行の notice がありません（notice を出す前の版の実行か、最初の段階より前に止まった）');
  for (const e of errors.slice(0, 3)) lines.push(`エラー: ${e.title ? `${e.title}: ` : ''}${String(e.message).split('\n')[0].slice(0, 300)}`);
  if (stopped) lines.push('次: 同じ設定でもう一度。notice の load / mem / swap / disk の推移で、何が尽きたかを見る（メモリなら APP_SCREEN で画面を小さく・APP_RAM を減らす、ディスクなら APP_DISK）');
  const title = `FAIL ${stopped ? '実行ごと止められました' : '成果物がありません'}${bad ? `（${bad.name}、${dur}${code ? ` exit ${code}` : ''}）` : ''}`.replace(/、）/, '）');
  return { title, lines, summary: lines.map((l) => `- ${l}`).join('\n'), stopped };
}

/** check runs (from the API: { name, output: { title, summary, text } }) back into files under dir (pure but for writing) */
export function unpackChecks(runs, dir) {
  const files = [];
  // "[k/n]" after the kind: one of several devices → its own folder shard-k/
  const put = (sub, f, s) => { const p = path.join(dir, sub, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); files.push(path.posix.join(sub, f.split(path.sep).join('/'))); };
  for (const r of runs) {
    const o = r.output ?? {}, n = String(r.name ?? '');
    const m = new RegExp(`^${CHECK_PREFIX}(結果|logcat|画面)(?: \\[(\\d+)/(\\d+)\\])?(?: (.+))?$`).exec(n);
    if (!m) continue;
    const sub = m[2] ? `shard-${m[2]}` : '';
    if (m[1] === '結果' && !m[4]) { put(sub, 'report.md', `${o.summary ?? ''}\n`); put(sub, 'details.txt', `${o.text ?? ''}\n`); }
    else if (m[1] === 'logcat' && !m[4]) put(sub, 'logcat-wide.txt', `${/^（全部 text/.test(o.summary ?? '') ? '' : (o.summary ?? '') + '\n'}${o.text ?? ''}\n`);
    else if (m[1] === '画面' && m[4]) {
      const f = path.basename(m[4]).replace(/[^\w.-]+/g, '_');
      const b = Buffer.from(String(o.text ?? ''), 'base64');
      if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) put(sub, path.join('shots', f), b);
    }
  }
  if (!fs.existsSync(path.join(dir, 'shots'))) fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  return files;
}
