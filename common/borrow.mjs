// Borrowed addons: other people's addons, taken from a distribution site to run, fix and learn from here — never handed out
// again (not in a release, a work zip, a Release, a public repo or a host). What this file holds:
//   - the seen record (auto/borrowed-seen.jsonl): every post looked at, kept or dropped, by its number, the file's sha256 and
//     its packs' UUIDs and versions — numbers and a reason, no content — so the same post or the same content posted again
//     is never taken twice; `--retry` takes again only what a newer BDS may change
//   - a seeded random order (the same seed, the same order), the rules a post states (二次配布・改変 …), the packs' ids
//   - the mark on a borrowed unit (imported.json borrowed, borrowed.json, the original file read-only with its sha256) and the
//     guards that stop share / ship / publish / bundle / host from carrying one
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SEEN = () => process.env.LAB_BORROW_SEEN || path.join(TOP, 'auto', 'borrowed-seen.jsonl');
export const UNIT_PREFIX = 'borrowed_';
// a drop a newer BDS can change (its APIs, its loader); a risky, broken or foreign file stays dropped
export const RETRYABLE = new Set(['brief', 'check', 'sim', 'real']);

// ---------------------------------------------------------------- the seen record
export function readSeen(file = SEEN()) {
  let t = ''; try { t = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return t.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
/** one line more (never rewritten: the history of what was looked at, and why it was kept or dropped) */
export function addSeen(rec, file = SEEN()) {
  const row = { at: new Date().toISOString(), site: 'colony', ...rec };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return row;
}
const packKey = (p) => `${String(p.uuid).toLowerCase()}@${[p.version].flat().join('.')}`;
/** records → the last word on each post; every record of each sha256 and pack (uuid@version) */
export function seenIndex(recs) {
  const posts = new Map(), shas = new Map(), packs = new Map();
  const add = (m, k, r) => { const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); };
  for (const r of recs) {
    if (r.post) posts.set(`${r.site ?? 'colony'}:${r.post}`, r);
    if (r.sha256) add(shas, r.sha256, r);
    for (const p of r.packs ?? []) if (p.uuid) add(packs, packKey(p), r);
  }
  return { posts, shas, packs };
}
/** what was seen of this post or this content → { by: 'post' | 'sha256' | 'pack', rec } or null. except: a post whose own
 *  records do not count (--retry looks at that post again, but never at the same content posted as another one) */
export function seenAs(idx, { site = 'colony', post, sha256, packs = [] } = {}, { except = null } = {}) {
  const pick = (l) => (l ?? []).filter((rec) => !except || String(rec.post) !== String(except)).at(-1);
  if (post && idx.posts.has(`${site}:${post}`)) return { by: 'post', rec: idx.posts.get(`${site}:${post}`) };
  const s = sha256 ? pick(idx.shas.get(sha256)) : null;
  if (s) return { by: 'sha256', rec: s };
  for (const p of packs) { const x = p.uuid ? pick(idx.packs.get(packKey(p))) : null; if (x) return { by: 'pack', rec: x }; }
  return null;
}
/** the posts to look at again after a BDS update: dropped at a stage a newer BDS can change, and only on another BDS */
export function retryable(recs, bds) {
  const last = new Map();
  for (const r of recs) if (r.post) last.set(`${r.site ?? 'colony'}:${r.post}`, r);
  return [...last.values()].filter((r) => r.result === 'dropped' && RETRYABLE.has(r.stage) && r.bds !== bds);
}

// ---------------------------------------------------------------- a seeded order
/** a random number generator from a seed (FNV-1a → mulberry32): the same seed, the same numbers on every machine */
export function rng(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  let a = h || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(list, rand) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const newSeed = () => crypto.randomBytes(4).toString('hex');

// ---------------------------------------------------------------- what a post says before anything is downloaded
/** the version a post's info table states ("対応バージョン: 1.21.50 以降" …) → [major, minor, patch] or null (pure) */
export function statedVersion(info = {}) {
  for (const [k, v] of Object.entries(info)) {
    if (!/バージョン|version|対応/i.test(k)) continue;
    const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v));
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  }
  return null;
}
const cmpV = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };
/** a post worth downloading (pure) → null, or why not. kinds: the download kinds wanted */
export function prefilter(p, { kinds = ['mcaddon', 'mcpack', 'zip'], minVersion = [1, 21, 0] } = {}) {
  if (p.isJava) return 'Java Edition の記事';
  if (!p.buttons?.length) return 'ダウンロードのボタンが無い（本文のリンクだけ）';
  const b = p.buttons.find((x) => kinds.includes(x.kind) && (!x.dest || x.hosted));
  if (!b) return p.buttons.some((x) => kinds.includes(x.kind)) ? 'ダウンロードが知らないサイトにある' : `欲しい種類（${kinds.join('・')}）のボタンが無い（${[...new Set(p.buttons.map((x) => x.kind))].join('・')}）`;
  const v = statedVersion(p.info);
  if (v && minVersion && cmpV(v, minVersion) < 0) return `古い版向け（${v.join('.')}。--min-version ${minVersion.join('.')}）`;
  return null;
}
// the rules a post states about its files (二次配布・転載・改変・クレジット・商用 …): the sentences that say them (pure)
const RULE = /(二次配布|再配布|転載|改変|改造|クレジット|自作発言|商用|配信|動画|無断|利用規約|redistribut|re-?upload|modif|credit|commercial)/i;
export function rulesOf(html) {
  const cut = String(html).search(/<div[^>]+class=["'][^"']*\b(comment-area|comments)\b|id=["']comments["']/i);
  const body = (cut > 0 ? String(html).slice(0, cut) : String(html)).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/?(p|li|ul|ol|div|tr|td|th|table|h\d|section|article)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;|&#x27;/g, "'").replace(/&quot;/g, '"');
  const out = [];
  for (const raw of body.split(/\n|(?<=[。！!])/)) {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (s.length < 4 || s.length > 160 || !RULE.test(s)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

// ---------------------------------------------------------------- the packs inside a file
/** every manifest in an addon file (folders, or .mcpack / .zip inside an .mcaddon) → [{ uuid, version, name, type }] */
export async function packIds(file) {
  const Z = await import(pathToFileURL(path.join(TOP, 'sandbox-be', 'src', 'colony', 'zip.js')).href);
  const out = [];
  const walk = (buf, depth) => {
    let entries; try { entries = Z.listEntries(buf); } catch { return; }
    for (const e of entries) {
      if (e.dir) continue;
      if (/(^|\/)manifest\.json$/i.test(e.name)) {
        try {
          const j = JSON.parse(Z.readByName(buf, entries, e.name).toString('utf8').replace(/^﻿/, '').replace(/^\s*\/\/.*$/gm, ''));
          if (j.header?.uuid) out.push({ uuid: String(j.header.uuid).toLowerCase(), version: [j.header.version].flat().join('.'), name: String(j.header.name ?? '').replace(/§./g, ''), type: (j.modules ?? []).some((m) => m.type === 'resources') ? 'rp' : 'bp', ...((j.modules ?? []).some((m) => m.type === 'script') ? { script: true } : {}) });
        } catch { /* not readable: the import says */ }
      } else if (depth < 2 && /\.(mcpack|zip)$/i.test(e.name)) { try { walk(Z.readByName(buf, entries, e.name), depth + 1); } catch { /* not a zip */ } }
    }
  };
  walk(fs.readFileSync(file), 0);
  return out;
}

// ---------------------------------------------------------------- the mark and the guards
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
/** a unit's mark (imported.json borrowed) → the mark or null */
export function borrowedMark(unitDir) { return readJson(path.join(unitDir, 'imported.json'))?.borrowed ?? null; }
/** a unit is someone else's → its mark, or null. Also without a mark — a unit still being judged, one a killed harvest left,
 *  one whose imported.json was rewritten: its name (borrowed_…) or the original kept in it (.borrowed/) says so */
export function borrowedAs(unitDir) {
  const mark = borrowedMark(unitDir);
  if (mark) return mark;
  if (path.basename(unitDir).startsWith(UNIT_PREFIX) || fs.existsSync(path.join(unitDir, '.borrowed'))) return { pending: true, site: null, url: null, author: null, why: 'name' };
  return null;
}
/** a file path in a lab that belongs to a borrowed unit by its name or its kept original (pure: for lists of files) */
export const borrowedPath = (rel) => /^(bds\/addons|end\/plugins|ll\/mods)\/(borrowed_[^/]*|[^/]+\/\.borrowed)(\/|$)/.test(String(rel));
/** the borrowed units of a lab (bds/addons, end/plugins, ll/mods) → [{ rel, dir, mark }] */
export function borrowedUnits(top = TOP) {
  const out = [];
  for (const k of ['bds/addons', 'end/plugins', 'll/mods']) {
    let names = []; try { names = fs.readdirSync(path.join(top, k)); } catch { continue; }
    for (const n of names) { const dir = path.join(top, k, n), mark = borrowedAs(dir); if (mark) out.push({ rel: `${k}/${n}`, dir, mark }); }
  }
  return out;
}
/** why a borrowed unit may not go out (one line, the same everywhere) */
export const refusal = (what, units) => `${what}: 借りたアドオンは配りません（${units.map((u) => `${u.rel}${u.mark?.url ? ` ← ${u.mark.url}` : ''}${u.mark?.author ? ` by ${u.mark.author}` : ''}`).join('、')}）。作者のものなので、手元で動かして直して学ぶためだけに使います`;
/** the mark written the moment a borrowed unit exists (right after import), before it is judged: a unit being judged — or one a
 *  killed harvest left — is stopped by the guards like a kept one */
export function markPending(unitDir, { site = 'colony', post = null, url = null, title = null, author = null } = {}) {
  const imp = readJson(path.join(unitDir, 'imported.json')) ?? {};
  fs.writeFileSync(path.join(unitDir, 'imported.json'), JSON.stringify({ ...imp, borrowed: { pending: true, site, post, url, title, author, at: new Date().toISOString(), use: 'local only: run, fix and learn here; never handed out' } }, null, 2) + '\n');
}
/** the mark written into a borrowed unit: imported.json borrowed + borrowed.json (the verdict), the original file read-only */
export function markUnit(unitDir, { site = 'colony', post = null, url = null, title = null, author = null, rules = [], file, sha256, packs = [], verdict = {} }) {
  const imp = readJson(path.join(unitDir, 'imported.json')) ?? {};
  const keep = path.join(unitDir, '.borrowed', path.basename(file));
  fs.mkdirSync(path.dirname(keep), { recursive: true });
  fs.copyFileSync(file, keep);
  try { fs.chmodSync(keep, 0o444); } catch { /* a file system without modes */ }
  const mark = { site, post, url, title, author, rules, sha256, original: path.relative(unitDir, keep).split(path.sep).join('/'), at: new Date().toISOString(), use: 'local only: run, fix and learn here; never handed out' };
  fs.writeFileSync(path.join(unitDir, 'imported.json'), JSON.stringify({ ...imp, borrowed: mark }, null, 2) + '\n');
  fs.writeFileSync(path.join(unitDir, 'borrowed.json'), JSON.stringify({ ...mark, packs, verdict }, null, 2) + '\n');
  return mark;
}
/** the original file of a borrowed unit, checked against its sha256 → its path, or throws */
export function originalOf(unitDir) {
  const mark = borrowedMark(unitDir);
  if (!mark) throw new Error(`${path.basename(unitDir)} is not a borrowed unit`);
  const f = path.join(unitDir, mark.original ?? '');
  // (only a file kept in the unit's own .borrowed/: an edited mark pointing elsewhere is not followed)
  if (!path.resolve(f).startsWith(path.resolve(unitDir, '.borrowed') + path.sep)) throw new Error(`the original is not in ${path.basename(unitDir)}/.borrowed (${mark.original})`);
  if (!fs.existsSync(f)) throw new Error(`the original file is gone (${mark.original})`);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  if (mark.sha256 && sha !== mark.sha256) throw new Error(`the original file changed (sha256 ${sha.slice(0, 12)} ≠ ${String(mark.sha256).slice(0, 12)})`);
  return f;
}
