import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class Failed extends Error {}

const HINTS = [
  [/restricted-execution|early-execution/i, 'トップレベルで呼んでいます。system.run かイベントの中へ移してください'],
  [/is not a function/i, 'その API がこの版に無いか、名前が違います。t.api("…") で在るか確かめてください'],
  [/Native type conversion failed/i, '引数の型が違います（Vector3 に dimension が要る等）。渡す形を確かめてください'],
  [/LocationInUnloadedChunk/i, '区画が読み込まれていません。tickingarea の中（既定は 0,0〜63,63）で試してください'],
  [/InvalidEntityError/i, 'そのエンティティはもう居ません。tick をまたぐ前に取り直してください'],
  [/見つからないモジュール/, 'import 先のパスが違います。拡張子（.js）まで書いてください'],
  [/Import \[.*\] not found/, 'import しているファイルがありません。消したファイルを import していないか、パスを確かめてください'],
  [/subscribe が多すぎます|run 系が多すぎます/, '同じ処理を二重に張っています。購読を 1 か所にまとめてください'],
  [/SyntaxError/, '構文が壊れています。落ちたファイルを丸ごと書き直してください'],
  [/ログに .* が出ませんでした/, 'console.warn の行が出ていません。その処理自体が呼ばれていない可能性が高いです'],
];
export const hintFor = (detail) => HINTS.find(([re]) => re.test(detail ?? ''))?.[1] ?? null;

export function baseCtx({ logsOf, ticks }) {
  const notes = [];
  const t = {
    notes,
    note: (s) => { notes.push(String(s)); },
    near: (a, b, eps = 1e-3) => Math.abs(a - b) <= eps,
    logs: logsOf,
    ticks,
    expect(cond, detail) { if (!cond) throw new Failed(detail ?? '期待が外れました'); return true; },
    async expectLog(re, { within = 20 } = {}) {
      for (let i = 0; i < within; i++) {
        if (logsOf().some((l) => re.test(l))) return true;
        await ticks(1);
      }
      throw new Failed(`ログに ${re} が出ませんでした`);
    },
    async expectNoLog(re) {
      if (logsOf().some((l) => re.test(l))) throw new Failed(`出てはいけないログが出ました: ${re}`);
      return true;
    },
  };
  return { t, notes };
}

/**
 * 仕様書を読む。addon を渡すと、そのアドオンのものと共通のものだけを読む。
 * 実機に入るアドオンは 1 つなので、別のアドオンの仕様書は必ず落ちる（読んではいけない）。
 *   specs/_environment.spec.mjs   … 共通（先頭が _）
 *   specs/<addon>.spec.mjs        … そのアドオン
 *   specs/<addon>/*.spec.mjs      … 同上（増えたら畳む用）
 *   specs/<別のアドオン>.spec.mjs  … 読まない
 */
export async function loadSpecs(dir, opts = {}) {
  if (!fs.existsSync(dir)) return [];
  const { addon = null, others = [] } = typeof opts === 'string' ? { addon: opts } : opts;
  const mine = (f) => {
    if (!addon) return true;
    const base = f.replace(/\.spec\.mjs$/, '');
    return base.startsWith('_') || base === addon || !others.includes(base);
  };
  const found = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.mjs')).filter(mine).sort()
    .map((f) => ({ file: f, abs: path.join(dir, f) }));
  const sub = addon ? path.join(dir, addon) : null;
  if (sub && fs.existsSync(sub)) {
    for (const f of fs.readdirSync(sub).filter((x) => x.endsWith('.spec.mjs')).sort()) {
      found.push({ file: `${addon}/${f}`, abs: path.join(sub, f) });
    }
  }
  const out = [];
  for (const { file, abs } of found) {
    const mod = await import(`${pathToFileURL(abs).href}?t=${Date.now()}`);
    for (const spec of Array.isArray(mod.default) ? mod.default : [mod.default]) out.push({ file, ...spec });
  }
  return out;
}

export async function runSpecs({ specs, makeCtx, tag = 'sim', filter, say = console.log, retry = true }) {
  const results = [];
  // tag が null なら絞らない（real --all のように、全部を別の流し方で通したいとき）
  const wanted = specs.filter((s) => (tag === null || (s.tags ?? ['sim']).includes(tag)) && (!filter || `${s.name} ${s.file}`.includes(filter)));

  for (const spec of wanted) {
    let attempt = 0;
    let ok = false;
    let detail = '';
    let notes = [];
    let ms = 0;
    while (attempt < (retry ? 2 : 1)) {
      attempt++;
      const ctx = await makeCtx();
      const t0 = Date.now();
      try { await spec.run(ctx.t); ok = true; }
      catch (e) { ok = false; detail = e instanceof Failed ? e.message : `例外: ${String(e.message ?? e)}`; }
      ms = Date.now() - t0;
      notes = ctx.notes;
      const fromAddon = ctx.t.fromAddon ? ctx.t.fromAddon() : null;
      if (fromAddon) {
        for (const n of fromAddon.notes) notes.push(n);
        for (const [k, v] of Object.entries(fromAddon.metrics)) notes.push(`${k}=${v}`);
        if (ok && fromAddon.failures.length) { ok = false; detail = `アドオンが失敗を申告しました: ${fromAddon.failures[0]}`; }
      }
      const errs = ctx.t.logs().filter((l) => /^(Error|ReferenceError|TypeError|SyntaxError)/.test(l));
      if (ok && errs.length) { ok = false; detail = `アドオンが例外を投げました: ${errs[0]}`; }
      if (ok) break;
    }
    const flaky = ok && attempt > 1;
    const hint = ok ? null : hintFor(detail);
    results.push({ name: spec.name, why: spec.why ?? '', file: spec.file, tag: tag ?? 'real', ok, flaky, detail: ok ? '' : detail, hint, notes, ms });
    say(`${ok ? (flaky ? '～' : '✔') : '✘'} ${spec.name}${!ok && detail ? ` — ${detail}` : ''}${flaky ? '（2 回目で通りました。ゆらぎ）' : ''}`);
    for (const n of notes) say(`   ・${n}`);
    if (hint) say(`   → ${hint}`);
  }
  const passed = results.filter((r) => r.ok).length;
  return { ok: passed === results.length, total: results.length, passed, results };
}

const at = (ROOT, n) => path.join(ROOT, '.bds-lab', n);

export function diffReports(prev, next) {
  const was = new Map((prev?.results ?? []).map((r) => [r.name, r.ok]));
  return {
    newlyFailed: next.results.filter((r) => !r.ok && was.get(r.name) === true).map((r) => r.name),
    newlyFixed: next.results.filter((r) => r.ok && was.get(r.name) === false).map((r) => r.name),
    stillFailing: next.results.filter((r) => !r.ok && was.get(r.name) !== true).map((r) => r.name),
  };
}

export function readReport(ROOT) {
  try { return JSON.parse(fs.readFileSync(at(ROOT, 'report.json'), 'utf8')); } catch { return null; }
}

export function writeReport({ ROOT, report }) {
  fs.mkdirSync(path.join(ROOT, '.bds-lab'), { recursive: true });
  const prev = readReport(ROOT);
  if (prev) fs.writeFileSync(at(ROOT, 'report.prev.json'), JSON.stringify(prev, null, 2));
  report.diff = diffReports(prev, report);
  fs.writeFileSync(at(ROOT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return at(ROOT, 'report.json');
}

export function summarize(report) {
  const out = [`${report.passed}/${report.total} 通りました（実機 ${report.version ?? '?'}${report.how ? `・${report.how}` : ''}）`];
  const d = report.diff;
  if (d?.newlyFixed?.length) out.push(`直った: ${d.newlyFixed.join(' / ')}`);
  if (d?.newlyFailed?.length) out.push(`⚠ 今回から壊れた: ${d.newlyFailed.join(' / ')}（直前の変更が原因の可能性が高い）`);
  const flaky = report.results.filter((r) => r.flaky).map((r) => r.name);
  if (flaky.length) out.push(`ゆらぎ（2 回目で通った）: ${flaky.join(' / ')}`);
  if (report.skipped?.length) {
    out.push(`飛ばした（本物のクライアント${report.skippedWhy ? `・${report.skippedWhy}` : ''}）: ${report.skipped.join(' / ')}`);
    out.push('  確かめるには npm run real（ネットワークが要ります）');
  }
  for (const r of report.results.filter((x) => !x.ok)) {
    out.push('', `✘ ${r.name}${r.why ? `（${r.why}）` : ''}`);
    out.push(`  ${r.detail}`);
    if (r.hint) out.push(`  → ${r.hint}`);
    for (const n of r.notes ?? []) out.push(`  ・${n}`);
  }
  if (report.scriptErrors?.length) {
    out.push('', 'アドオンが出した例外:');
    for (const e of report.scriptErrors.slice(0, 5)) {
      out.push(`  ${e}`);
      const h = hintFor(e);
      if (h) out.push(`  → ${h}`);
    }
  }
  return out.join('\n');
}
