// tutorial: 「最初のアドオンを 5 分で」 — the steps from nothing to a pack given out, and which one a person stands on now,
// decided from how things are (is there a unit, how did unit.yml's last run end, is there a release). Pure: no DOM, no fetch
// (the screen reads GitHub through lib/gh.mjs and hands the facts in), no node:.
import { latestByUnit } from './releases.mjs';

/** the steps in order: id, a short name, what happens there (words for a beginner) */
export const STEPS = [
  { id: 'name', title: '名前を決める', say: 'アドオンの名前を英小文字で決めます（例 ruby_sword）。あとで変えにくいので、短くわかりやすく。' },
  { id: 'make', title: '作る', say: '「作る」を押すと、GitHub が ひな形を作ります（数分）。自分のパソコンは要りません。' },
  { id: 'try', title: '試す', say: '本物のサーバーで遊んで確かめます（数分）。通れば次へ。通らなければ、理由が出ます。' },
  { id: 'share', title: '配る', say: '仕上げて .mcaddon を作り、リリースに載せると、リンクひとつで友だちに渡せます。' },
  { id: 'done', title: 'できた', say: 'おめでとう！ 最初のアドオンが、配れる形になりました。' },
];
export const stepIndex = (id) => STEPS.findIndex((s) => s.id === id);

/** how the unit's last test on unit.yml ended (pure; runs: GitHub's workflow_runs, newest first). Only a test of this unit
 *  counts — unit.yml's run-name is "unit <job> <unit>": its 「作る」 (job new) or 「仕上げる」 (job go) is not a test, and a run
 *  with no title says nothing of whose it is → 'none' | 'running' | 'passed' | 'failed' */
export function tryState(runs, unit) {
  const mine = (runs ?? []).filter((r) => r && unit && /^unit test \S+$/.test(String(r.display_title ?? '')) && String(r.display_title).slice('unit test '.length) === unit);
  const r = mine[0];
  if (!r) return 'none';
  if (r.status !== 'completed') return 'running';
  return r.conclusion === 'success' ? 'passed' : 'failed';
}

/** the facts → where the person is (pure). state: { unit: name typed ('' none), exists: that unit is in the lab, runs,
 *  released: a release holds its pack } → { id, index, tried, unit } */
export function stepOf(state = {}) {
  const unit = String(state.unit ?? '').trim(), tried = tryState(state.runs, unit);
  let id;
  if (!unit) id = 'name';
  else if (!state.exists) id = 'make';
  else if (state.released) id = 'done';
  else if (tried === 'passed') id = 'share';
  else id = 'try';
  return { id, index: stepIndex(id), tried, unit };
}

/** the lab's facts as stepOf wants them (pure): units = listUnits' summaries, releases = GitHub's list */
export function stateOf({ unit, units, runs, releases } = {}) {
  const u = String(unit ?? '').trim(), mine = (units ?? []).filter((x) => x.name === u);
  const out = mine.length ? latestByUnit(releases, mine) : {};
  return { unit: u, exists: mine.length > 0, runs: runs ?? [], released: Object.values(out).some((x) => x.asset) };
}

/** what else to do once done (pure) */
export const NEXT = [
  'ファイルを直して中身を変える（「アドオン」の「ファイルを直す」）',
  'AI に頼んで変える・増やす',
  'リリースのリンクを友だちに送る',
];
