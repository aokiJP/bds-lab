// 出力先の決まりごとと、書き込みの共通処理。
//
//   work/      取得・取り出したバイナリ（git 管理外）
//   profiles/  解析結果の JSON（git 管理）
//   reports/   Markdown レポートと差分（git 管理）
//   site/      metadata/ と検索付きサイト（git 管理外。CI が Pages に出す）
import fs from 'node:fs';
import path from 'node:path';
import { loadProfile } from '../analysis/profile.js';
import { diffProfiles, isEmptyDiff } from '../report/diff.js';
import { renderDiff, renderProfile } from '../report/markdown.js';
import { previousProfile, profilePath } from './versions.js';

export const DEFAULT_DIRS = { work: 'work', profiles: 'profiles', reports: 'reports', site: 'site' };

/** --work などのフラグを反映した出力先 */
export function resolveDirs(flags) {
  const pick = (k) => (typeof flags[k] === 'string' ? flags[k] : DEFAULT_DIRS[k]);
  return { work: pick('work'), profiles: pick('profiles'), reports: pick('reports'), site: DEFAULT_DIRS.site };
}

/** 途中で落ちても壊れたファイルを残さないよう、一時ファイル経由で書く */
export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export const writeJson = (file, obj) => writeFileAtomic(file, JSON.stringify(obj, null, 1));

/**
 * プロファイルを保存し、レポートと前版との差分を書く。
 * @returns {{changed:boolean, profilePath:string, reportPath:string, diffPath:string|null}}
 */
export function recordProfile(profile, dirs) {
  const { channel, version } = profile;
  const out = profilePath(dirs.profiles, channel, version);
  writeJson(out, profile);
  const reportPath = path.join(dirs.reports, `${channel}-${version}.md`);
  writeFileAtomic(reportPath, renderProfile(profile));

  const prev = previousProfile(dirs.profiles, channel, version);
  if (!prev) return { changed: true, profilePath: out, reportPath, diffPath: null };
  const d = diffProfiles(loadProfile(prev.path), profile);
  const diffPath = path.join(dirs.reports, `${channel}-${prev.version}-to-${version}.md`);
  writeFileAtomic(diffPath, renderDiff(d));
  return { changed: !isEmptyDiff(d), profilePath: out, reportPath, diffPath };
}
