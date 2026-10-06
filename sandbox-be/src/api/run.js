// runSandbox: コードを仮想の世界で 1 回動かし、報告と判定を返す。
import { normalizeRequest } from './request.js';
import { checkExpectation, verdictOf } from './expect.js';
import { spawnChild } from '../host/spawn.js';

/**
 * コードを仮想の世界で動かす。
 * @param {object} req  README.md の「リクエスト」
 * @returns {Promise<object>}
 */
export async function runSandbox(req) {
  const r = normalizeRequest(req);
  const child = await spawnChild(r);
  const base = {
    ok: false,
    isolation: { process: true, permission: child.permission, codeGeneration: false, node: process.versions.node },
    elapsedMs: child.ms,
  };
  if (child.killed) {
    return { ...base, verdict: 'timeout', killed: child.killed, message: `${r.limits.wallMs}ms を超えたので止めました` };
  }
  if (!child.parsed) {
    const oom = /heap out of memory|Allocation failed/i.test(child.stderr);
    return {
      ...base,
      verdict: 'crashed',
      message: oom ? `メモリの上限（${r.limits.memoryMb}MB）を超えました` : '子プロセスが結果を返さずに終わりました',
      exitCode: child.code,
      signal: child.signal,
      stderr: child.stderr.slice(-4000),
    };
  }
  const out = { ...base, ...child.parsed };
  out.expectations = out.report ? (r.expect ?? []).map((e) => checkExpectation(e, out, r)) : [];
  out.verdict = verdictOf(out, r);
  out.ok = out.verdict === 'pass';
  if (out.report) {
    out.summary = {
      ticks: out.report.ticks,
      errors: out.report.log.filter((l) => l.level === 'error').length,
      warnings: out.report.log.filter((l) => l.level === 'warn').length,
      blocksChanged: out.report.diff.blockCount,
      entitiesAdded: out.report.diff.entities.added.length,
      entitiesRemoved: out.report.diff.entities.removed.length,
      chat: out.report.chat.length,
      unsupported: Object.keys(out.report.unsupported),
    };
  }
  return out;
}
