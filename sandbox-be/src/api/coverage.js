// 再現度（公式メタデータの全メンバーのうち、振る舞いまで再現しているもの）。
import fs from 'node:fs';
import path from 'node:path';
import { normalizeRequest } from './request.js';
import { spawnChild } from '../host/spawn.js';
import { DATA_DIR } from '../host/paths.js';

/**
 * メタデータの全メンバーのうち、サンドボックスが振る舞いまで再現しているものを数える。
 * （形だけならすべて実機どおり。ここで数えるのは「呼んで結果が返るか」）
 */
export async function sandboxCoverage() {
  const r = normalizeRequest({ code: '', mode: 'coverage', limits: { ticks: 0 } });
  const child = await spawnChild(r);
  if (!child.parsed?.coverage) throw new Error(child.parsed?.fatal?.message ?? child.stderr ?? '再現度を取れませんでした');
  return child.parsed.coverage;
}

export function readApiSummary() {
  const api = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'script-api.json'), 'utf8'));
  const s = api.modules['@minecraft/server'];
  let fns = 0;
  let props = 0;
  for (const c of Object.values(s.classes)) { fns += Object.keys(c.fns).length + (c.ctor ? 1 : 0); props += Object.keys(c.props).length; }
  return { game: api.game, version: s.versions.filter((v) => !/-beta$/.test(v)).at(-1) ?? s.versions.at(-1), beta: s.versions.filter((v) => /-beta$/.test(v)).at(-1) ?? null, classes: Object.keys(s.classes).length, functions: fns, properties: props };
}
