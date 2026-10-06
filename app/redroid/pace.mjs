// When game.mjs's launch reads the screen (OCR) while it waits for the game's title. The cheap signals come first (the
// game's process, its window, logcat's lines: each one call to the device); the screen is read only after them, or once the
// start is past 7/10 of the shortest of the last titleS kept in .lab/title-pace.json (at most 10 s; not at all when the
// launch's timeout is shorter than that + 10 s), and then at widening gaps up to 1.5 s (a screen read is a screencap +
// tesseract on the same 2 cores the game is starting on).
// Knobs: REDROID_OCR_PACE=0 (every 0.5 s from the game's window, as before: to compare), REDROID_TITLE_LOG (a regex: the
// logcat line that says the title is near — which line that is has not been measured; unset = none).
import fs from 'node:fs';
import path from 'node:path';

export const PACE = {
  share: 0.7,          // the screen read from this part of the last titleS on
  firstGapMs: 1000,    // between screen reads: the first gap, then x grow, up to maxGapMs
  grow: 1.5,
  maxGapMs: 1500,      // (not more: the title is seen at most this late)
  maxGateMs: 10_000,   // the gate at most this (slow starts kept must not hold a fast one's reads for long)
  slackMs: 10_000,     // the gate not used when the launch's timeout is shorter than gate + this
  logEveryMs: 2000,    // logcat read at most this often (until what it is read for is seen)
  keep: 5,             // titleS kept (the shortest of them is the one used)
};

/** the gap before the next screen read, after n reads since the gate opened (or since a first-start screen was left) (pure) */
export const gapMs = (n, p = PACE) => Math.min(p.firstGapMs * p.grow ** Math.max(0, n), p.maxGapMs);

/** the gate (pure): ms from the launch on which the screen is read, or null (no gate: from the window).
 *  min(share x prevTitleMs, maxGateMs); null when nothing kept or timeoutMs < gate + slackMs */
export function gateMs(prevTitleMs, timeoutMs = Infinity, p = PACE) {
  if (!(prevTitleMs > 0)) return null;
  const g = Math.min(p.share * prevTitleMs, p.maxGateMs);
  return timeoutMs < g + p.slackMs ? null : g;
}

/** whether to read the screen now (pure). atMs: since the launch; lastOcrMs: when the last read began (null: none since
 *  the gate opened); n: reads since then; prevTitleMs: from the last starts (null: none kept); timeoutMs: the launch's; off: REDROID_OCR_PACE=0
 *  → {ocr, gate: 'window' | 'log' | 'prev' | null} */
export function ocrDue({ atMs, windowSeen, readySeen = false, prevTitleMs = null, timeoutMs = Infinity, lastOcrMs = null, n = 0, off = false }, p = PACE) {
  if (!windowSeen) return { ocr: false, gate: null };
  if (off) return { ocr: true, gate: 'window' };
  const g = gateMs(prevTitleMs, timeoutMs, p);
  const gate = readySeen ? 'log' : g !== null ? (atMs >= g ? 'prev' : null) : 'window';
  if (!gate) return { ocr: false, gate: null };
  return { ocr: lastOcrMs === null || atMs - lastOcrMs >= gapMs(n - 1, p), gate };
}

/** what logcat says (pure): drawn = Android's "Displayed <pkg>/…" (the game's first frame), ready = the REDROID_TITLE_LOG line */
export function logSignals(text, { pkg, readyRe = null } = {}) {
  const lines = String(text ?? '').split(/\r?\n/);
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { drawn: lines.some((l) => new RegExp(`Displayed ${esc}/`).test(l)), ready: Boolean(readyRe) && lines.some((l) => readyRe.test(l)) };
}
/** REDROID_TITLE_LOG as a regex, or null (unset or not a regex) */
export function readyRe(env = process.env) { try { return env.REDROID_TITLE_LOG ? new RegExp(env.REDROID_TITLE_LOG, 'i') : null; } catch { return null; } }

/** the titleS of the last starts (pure on its input) → ms to gate on (the shortest kept), or null */
export const prevTitleMs = (kept, p = PACE) => { const t = (kept?.titles ?? []).filter((s) => s > 0).slice(-p.keep); return t.length ? Math.min(...t) * 1000 : null; };
/** a start's result kept (pure): only a clean one (the title reached, no first-start screen tapped) → the new kept */
export function keepTitle(kept, m, p = PACE) {
  const titles = (kept?.titles ?? []).filter((s) => s > 0);
  if (!(m?.titleS > 0) || m.license !== 'ok' || m.firstRun) return { titles };
  return { titles: [...titles, m.titleS].slice(-p.keep) };
}
/** .lab/title-pace.json → {titles: [numbers]} (anything else in it: as if nothing kept) */
export function readPace(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { titles: Array.isArray(j?.titles) ? j.titles.filter((s) => typeof s === 'number' && Number.isFinite(s)) : [] };
  } catch { return { titles: [] }; }
}
export function writePace(file, kept) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(kept) + '\n'); } catch { /* not kept: the next start reads the screen from its window */ } }
