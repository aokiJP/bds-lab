// workspace: making and changing the lab's units with no computer of one's own — the inputs of unit.yml (GitHub Actions runs
// the lab there: common/unitci.mjs checks them by these same rules), a person's pack put in the repository for it to take in,
// and a unit's files changed through the contents API. The contract with unit.yml (workflow_dispatch inputs):
//   job      new | test | go | sim | import
//   unit     the unit's name (bds/addons/<unit>, UNIT); import: optional — the name to give it (else the pack's own)
//   title    new: what players see (empty: the name)
//   request  new: what the addon does (into TASK.md)
//   file     import: the pack in the repository, incoming/<name> (.mcaddon .mcpack .zip — put there by putIncoming)
//   words    import: what the person asked
// new and import commit the unit to the default branch; go uploads dist/*.mcaddon as the artifact unit-<name>.
// Pure but for the calls to GitHub at the end (through lib/gh.mjs). No DOM, no node:.
import { UNIT } from './units.mjs';

export const WORKFLOW = 'unit.yml';
export const JOBS = ['new', 'test', 'go', 'sim', 'import'];
/** the jobs on a unit that is there already */
export const RUN_JOBS = ['test', 'go', 'sim'];
export const JOB_WORDS = { new: '新しく作る', test: '試験', go: '仕上げ（.mcaddon）', sim: 'すばやい試し（sim）', import: '取り込み' };
/** the most each input may hold (characters) */
export const LIMITS = { title: 80, request: 2000, words: 2000, file: 120 };
export const UNIT_SAY = '名前は英小文字で始まる英小文字・数字・_ の 2〜40 文字（例 ruby_sword）';
/** a person's pack: these kinds, up to this size */
export const IMPORT_TYPES = ['.mcaddon', '.mcpack', '.zip'];
export const MAX_BYTES = 50 * 1024 * 1024;
/** where a pack waits for unit.yml: incoming/<a safe name> — nothing above it, no way out */
export const INCOMING = /^incoming\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(mcaddon|mcpack|zip)$/i;

/** a text for unit.yml (pure) → what is wrong with it, in words; '' when nothing is. Within its length; no control
 *  characters (line: no line break either); not taken by the lab for an option — -- or name= at its start */
export function textProblem(v, { max, line = false, what = '文' }) {
  const s = String(v ?? '');
  if (s.length > max) return `${what}は ${max} 文字まで`;
  if ((line ? /[\u0000-\u001f\u007f]/ : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/).test(s)) return line ? `${what}は 1 行で（使えない文字があります）` : `${what}に使えない文字があります`;
  if (/^\s*(--|[A-Za-z_][\w-]*=)/.test(s)) return `${what}は -- や「名前=」で始められません`;
  return '';
}
/** a new unit → { inputs } for unit.yml, or { error } in words (pure) */
export function newUnitInputs({ unit, title = '', request = '' } = {}) {
  const u = String(unit ?? '').trim(), t = String(title ?? '').trim() || u, q = String(request ?? '').trim();
  if (!UNIT.test(u)) return { error: UNIT_SAY };
  const bad = textProblem(t, { max: LIMITS.title, line: true, what: '題' }) || textProblem(q, { max: LIMITS.request, what: '何をするか' });
  return bad ? { error: bad } : { inputs: { job: 'new', unit: u, title: t, request: q } };
}
/** test / go / sim of a unit → { inputs } for unit.yml, or { error } (pure) */
export function runInputs({ job, unit } = {}) {
  if (!RUN_JOBS.includes(job)) return { error: `仕事は ${RUN_JOBS.join('・')} のどれか` };
  const u = String(unit ?? '').trim();
  return UNIT.test(u) ? { inputs: { job, unit: u } } : { error: UNIT_SAY };
}
/** a person's pack chosen to take in → { name, path (incoming/<name>), message (the commit's), inputs (unit.yml's) }, or
 *  { error } (pure). Only .mcaddon .mcpack .zip, not empty, up to MAX_BYTES; the name made safe — its folders dropped, only
 *  letters, digits and . _ - (others become _), no dot at the start, no .. — so it can only land in incoming/ */
export function importPlan({ fileName, size, words = '', unit = '' } = {}) {
  const base = String(fileName ?? '').split(/[\\/]/).pop().normalize('NFKC'), dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  if (!IMPORT_TYPES.includes(ext)) return { error: `${IMPORT_TYPES.join('・')} のファイルを選んでください` };
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return { error: '空のファイルです' };
  if (n > MAX_BYTES) return { error: `大きすぎます（${MAX_BYTES / 1024 / 1024} MB まで）` };
  const stem = base.slice(0, dot).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[._-]+/, '').slice(0, 80).replace(/[._-]+$/, '') || 'addon';
  const name = `${stem}${ext}`, path = `incoming/${name}`, w = String(words ?? '').trim(), u = String(unit ?? '').trim();
  if (u && !UNIT.test(u)) return { error: UNIT_SAY };
  const bad = textProblem(w, { max: LIMITS.words, what: 'その人の言葉' });
  if (bad) return { error: bad };
  // (cannot fail after the cleaning above: the same check unit.yml makes, said here first)
  if (!INCOMING.test(path) || path.length > LIMITS.file) return { error: 'このファイルの名前は使えません' };
  // ([skip ci]: a pack waiting in incoming/ is no change of the lab's code — the push starts no verify run; unit.yml is started by hand)
  return { name, path, message: `panel: 取り込む ${name}（unit.yml が bds/addons に） [skip ci]`, inputs: { job: 'import', file: path, words: w, ...(u ? { unit: u } : {}) } };
}
/** FileReader's data: URL → its base64 (pure) */
export function base64Of(dataUrl) { const s = String(dataUrl ?? ''), i = s.indexOf(';base64,'); return i < 0 ? '' : s.slice(i + 8); }
/** is this workflow in the lab (pure): workflows as GitHub lists them; not known (not an array) counts as yes — GitHub answers */
export const hasWorkflow = (workflows, file) => !Array.isArray(workflows) || workflows.some((w) => String(w?.path ?? '').endsWith(`/${file}`));

/** the files of a bds unit the editor offers (more: the pack's script, editableFiles) */
export const EDITABLE = ['src/main.ts', 'tests.txt', 'TASK.md', 'bp/manifest.json', 'rp/manifest.json', 'rp/texts/en_US.lang', 'rp/texts/ja_JP.lang'];
/** what is good to know about a file before changing it */
export const EDIT_NOTES = {
  'src/main.ts': 'アドオンの本体（TypeScript）。試験と仕上げのたびに bp/scripts に作り直されます。',
  'tests.txt': '試験（## ごとに 1 つ）。「保存して試験」で本物のサーバーとプレイヤーで確かめます。',
  'bp/manifest.json': 'パックの名前・説明・版・UUID。UUID は変えないでください（遊ぶ人のワールドが別物として読みます）。',
  script: 'パックのスクリプト。src/main.ts があるユニットでは、そこから作られます（直すなら src/main.ts を）。',
};
/** the files of a unit the editor offers (pure): EDITABLE and its pack's script (the manifest's entry; else bp/scripts/main.js) */
export const editableFiles = (unit) => [...new Set([...EDITABLE, unit?.entry || 'bp/scripts/main.js'])];
export const MAX_EDIT = 1_000_000;
/** a file's new text, before it is saved (pure) → { ok, error }: a file this editor offers, up to 1 MB; a manifest still
 *  readable as JSON (with its header); tests.txt not empty */
export function checkEdit(file, text, unit) {
  const s = String(text ?? '');
  if (!editableFiles(unit).includes(file)) return { ok: false, error: `${file} はここでは直せません` };
  if (new TextEncoder().encode(s).length > MAX_EDIT) return { ok: false, error: '1 MB までのファイルだけ直せます' };
  if (/(^|\/)manifest\.json$/.test(file)) {
    let j; try { j = JSON.parse(s.replace(/^﻿/, '')); } catch (e) { return { ok: false, error: `${file} が JSON として読めません（${e.message}）` }; }
    if (!j || typeof j !== 'object' || Array.isArray(j) || !j.header || typeof j.header !== 'object') return { ok: false, error: `${file} に header がありません` };
  }
  if (file === 'tests.txt' && !s.trim()) return { ok: false, error: 'tests.txt が空です（試験が 1 つも無くなります）' };
  return { ok: true, error: '' };
}

// ---- the calls to GitHub (api: lib/gh.mjs; the person's own sign-in) ----
const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s ?? '').replace(/\s/g, '')), (c) => c.charCodeAt(0)));
/** the pack written to incoming/ on the default branch, its bytes as base64 (the contents API's way); one already there by
 *  that name is replaced (its sha) → GitHub's answer */
export async function putIncoming(api, slug, { path, message }, content) {
  if (!INCOMING.test(String(path ?? '')) || String(path).includes('..')) throw new Error('このファイルの名前は使えません');
  if (!content) throw new Error('ファイルが読めませんでした');
  const name = path.slice('incoming/'.length);
  const here = await api.call('GET', `/repos/${slug}/contents/incoming`).catch((e) => { if (e.status === 404) return []; throw e; });
  const sha = (Array.isArray(here) ? here : []).find((x) => x?.type === 'file' && x.name === name)?.sha;
  return api.call('PUT', `/repos/${slug}/contents/${enc(path)}`, { message, content, ...(sha ? { sha } : {}) });
}
/** a person's pack taken in: put in incoming/, then unit.yml started on it (dispatch(workflow, inputs): GitHub's call) → its path */
export async function importUnit(api, slug, plan, content, dispatch) {
  await putIncoming(api, slug, plan, content);
  await dispatch(WORKFLOW, plan.inputs);
  return plan.path;
}
/** a unit's file as the editor takes it → { text, sha }; null when it is not there. One the contents API gives no text of
 *  (over 1 MB) is refused: saving the empty text would wipe it */
export async function readUnitFile(api, slug, path) {
  let j; try { j = await api.call('GET', `/repos/${slug}/contents/${enc(path)}`); } catch (e) { if (e.status === 404) return null; throw e; }
  if (!j || Array.isArray(j) || j.type !== 'file') throw new Error(`${path} はファイルではありません`);
  if (j.encoding !== 'base64') throw new Error(`${path} は大きすぎて、ここでは直せません（1 MB まで）`);
  return { text: fromB64(j.content), sha: j.sha };
}
/** a unit's file saved as a commit on the default branch, over the sha it was read at (another's change since then is not
 *  overwritten: said in words) → { sha (the new one), commit (its page) } */
export async function saveUnitFile(api, slug, path, text, sha, message) {
  try { const r = await api.putFile(slug, path, text, sha, message); return { sha: r?.content?.sha ?? null, commit: r?.commit?.html_url ?? null }; }
  catch (e) { if (e.status === 409 || (e.status === 422 && /sha/i.test(String(e.message)))) throw new Error('ほかの人が先に変えました: 「読み直す」で今のものを読んでから、もう一度'); throw e; }
}
