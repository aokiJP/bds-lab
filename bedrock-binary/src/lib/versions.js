// 版番号の比較とプロファイルの置き場所。
import fs from 'node:fs';
import path from 'node:path';

/** 1.21.124.2 と 1.21.124.02 は同じとみなす（APK は 2 桁ゼロ埋め） */
export function compareVersionStrings(a, b) {
  const pa = String(a).split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export const PROFILE_NAME = /^([a-z]+)-(\d+(?:\.\d+)+)\.json$/;

export function profilePath(dir, channel, version) {
  return path.join(dir, `${channel}-${version}.json`);
}

/** 同じ channel の中で、exclude より前の最新プロファイル。無ければ null */
export function previousProfile(dir, channel, exclude) {
  if (!fs.existsSync(dir)) return null;
  const candidates = fs
    .readdirSync(dir)
    .map((f) => ({ f, m: f.match(PROFILE_NAME) }))
    .filter(({ m }) => m && m[1] === channel && compareVersionStrings(m[2], exclude) < 0)
    .sort((x, y) => compareVersionStrings(x.m[2], y.m[2]));
  const last = candidates.at(-1);
  return last ? { path: path.join(dir, last.f), version: last.m[2] } : null;
}

/** work/release/1.21.124.2/bedrock_server のような配置から拾う */
export function inferVersion(p) {
  return p.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function inferChannel(p) {
  if (/[\\/]android[\\/]/.test(p) || /libminecraftpe/.test(p)) return 'android';
  return /preview/.test(p) ? 'preview' : /release/.test(p) ? 'release' : null;
}
