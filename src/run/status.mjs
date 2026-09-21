// 前回の検証結果を 40 行以内で見る。server.log を丸ごと読ませないための口。
//   npm run status
//   npm run status -- --full
import fs from 'node:fs';
import path from 'node:path';

const MAX = 40;
const cut = (s, n = 110) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

export function lastReport(ROOT) {
  for (const p of [path.join(ROOT, '.bds-lab', 'report.json'), path.join(ROOT, 'report.json')]) {
    const raw = read(p);
    if (!raw) continue;
    try { return { ...JSON.parse(raw), file: p }; } catch { /* 次へ */ }
  }
  return null;
}

/** 失敗に関係するログだけを拾う。重複は畳み、スタックは 3 行まで */
export function relevantLog(ROOT, { limit = 6 } = {}) {
  const raw = read(path.join(ROOT, '.bds-lab', 'server.log')) ?? read(path.join(ROOT, 'server.log'));
  if (!raw) return [];
  const lines = raw.replace(/\0/g, '').split('\n').slice(-400)
    .map((l) => l.replace(/^\[[^\]]*\]\s*/, '').replace(/^\[Scripting\]\s*/, '').trim())
    .filter(Boolean);
  const bad = /Error|error|例外|failed|Failed|cannot|Cannot|not a function|undefined/;
  const out = [];
  const seen = new Set();
  let stack = 0;
  for (const line of lines) {
    const isStack = /^\s*at /.test(line);
    if (isStack) { if (stack >= 3) continue; stack += 1; } else if (!bad.test(line)) { continue; } else { stack = 0; }
    const key = line.replace(/\d+/g, '#');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.slice(-limit);
}

export function lines(ROOT, { full = false } = {}) {
  const rep = lastReport(ROOT);
  if (!rep) return ['まだ検証していません → npm test'];

  const results = rep.results ?? [];
  const failed = results.filter((r) => !r.ok);
  const flaky = results.filter((r) => r.ok && r.flaky);
  const skipped = rep.skipped ?? [];
  const when = String(rep.at ?? '').replace('T', ' ').slice(0, 16);
  const out = [];

  out.push(`${rep.addon ?? '?'}  ${rep.passed ?? 0}/${rep.total ?? results.length} ${failed.length ? '✘' : '✔'}  実機 ${rep.version ?? '?'}（${rep.how ?? '?'}）  ${when}`);

  if (full) {
    for (const r of results) out.push(`  ${r.ok ? (r.flaky ? '～' : '✔') : '✘'} ${cut(r.name, 90)}`);
  } else {
    if (results.length - failed.length > 0) out.push(`  ✔ 通った ${results.length - failed.length} 本`);
    for (const r of failed.slice(0, 8)) out.push(`  ✘ ${cut(r.name, 90)}`);
  }
  if (flaky.length) out.push(`  ～ ゆらぎ ${flaky.length} 本（2 回目で通った）`);
  if (skipped.length) out.push(`  － 確かめていない ${skipped.length} 本${rep.skippedWhy ? `（${cut(rep.skippedWhy, 60)}）` : ''}`);

  const diff = rep.diff ?? {};
  if (diff.newlyFailed?.length) out.push(`  ⚠ 今回から壊れた: ${diff.newlyFailed.map((n) => cut(n, 40)).join(' / ')}`);
  if (diff.newlyFixed?.length) out.push(`  直った: ${diff.newlyFixed.length} 本`);

  const first = failed[0];
  if (first) {
    out.push('');
    out.push(`最初の失敗: ${cut(first.name, 90)}`);
    if (first.detail) out.push(`  何が: ${cut(first.detail, 160)}`);
    if (first.hint) out.push(`  当たり: ${cut(first.hint, 160)}`);
    for (const n of (first.notes ?? []).slice(0, 3)) out.push(`  ・${cut(n, 110)}`);
    const log = relevantLog(ROOT, { limit: full ? 20 : 4 });
    for (const l of log) out.push(`  log: ${cut(l, 110)}`);
  }

  for (const e of (rep.scriptErrors ?? []).slice(0, 2)) out.push(`  例外: ${cut(typeof e === 'string' ? e : e.message ?? JSON.stringify(e), 110)}`);

  out.push('');
  out.push(first ? '直したら: npm test' : (skipped.length ? '残り: npm run real -- --all' : 'そのまま出せます: npm run ship'));
  if (!full && (failed.length > 1 || results.length > 12)) out.push('全部見る: npm run status -- --full');

  return full ? out : out.slice(0, MAX);
}

export function status({ ROOT, full = false, say = console.log }) {
  for (const l of lines(ROOT, { full })) say(l);
}
