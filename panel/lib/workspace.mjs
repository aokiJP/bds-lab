// workspace: making and changing the lab's units with no computer of one's own — the inputs of unit.yml (GitHub Actions runs
// the lab there: common/unitci.mjs checks them by these same rules), a person's pack put in the repository for it to take in,
// and a unit's files changed through the contents API. The contract with unit.yml (workflow_dispatch inputs):
//   job      new | test | go | sim | import
//   unit     the unit's name (bds/addons/<unit>, UNIT; new and import: one the list shows — unitNameProblem); import: the name
//            to give it — the panel always sends one (the person's, else unitFromFile: unitci makes the same when none comes)
//   title    new: what players see (empty: the name)
//   request  new: what the addon does (into TASK.md)
//   file     import: the pack, incoming/<name> (.mcaddon .mcpack .zip; <name> its own — incomingStamp) on a branch of its own,
//            lab-incoming/<name> (incomingBranch), never on the default branch — put there by putIncoming; unit.yml takes it
//            from that branch and deletes the branch once the unit is made
//   words    import: what the person asked
// new and import commit the unit to the default branch; go uploads dist/*.mcaddon as the artifact unit-<name>.
// Pure but for the calls to GitHub at the end (through lib/gh.mjs). No DOM, no node:.
import { UNIT, isUnitName } from './units.mjs';
import { refusal } from './model.mjs';

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
// (over this, said before it is sent: a long upload from a phone, and GitHub's contents API has refused packs not far above the
// limit — 422 「too large to be processed」 — though it took 49 MB in the lab's own run)
export const BIG_BYTES = 25 * 1024 * 1024;
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
/** what is wrong with the name of a unit to make or take in (pure) → words; '' when nothing is. The lab's rule (UNIT) and the
 *  list's (isUnitName: a zz_ one is a parked unit — never shown, so never made); taking: no _ at its end either (the lab's
 *  import drops one there: the unit made would not be the one asked for) */
export function unitNameProblem(name, { taking = false } = {}) {
  const n = String(name ?? '');
  if (!UNIT.test(n)) return UNIT_SAY;
  if (!isUnitName(n)) return 'zz_ で始まる名前は「アドオン」に出ません（しまったユニットの印）: ほかの名前に';
  return taking && n.endsWith('_') ? '取り込むときの名前は _ で終われません（ラボが外します）' : '';
}
/** a new unit → { inputs } for unit.yml, or { error } in words (pure) */
export function newUnitInputs({ unit, title = '', request = '' } = {}) {
  const u = String(unit ?? '').trim(), t = String(title ?? '').trim() || u, q = String(request ?? '').trim();
  const bad = unitNameProblem(u) || textProblem(t, { max: LIMITS.title, line: true, what: '題' }) || textProblem(q, { max: LIMITS.request, what: '何をするか' });
  return bad ? { error: bad } : { inputs: { job: 'new', unit: u, title: t, request: q } };
}
/** test / go / sim of a unit → { inputs } for unit.yml, or { error } (pure) */
export function runInputs({ job, unit } = {}) {
  if (!RUN_JOBS.includes(job)) return { error: `仕事は ${RUN_JOBS.join('・')} のどれか` };
  const u = String(unit ?? '').trim();
  return UNIT.test(u) ? { inputs: { job, unit: u } } : { error: UNIT_SAY };
}
// (what incomingStamp puts at the end of a pack's stem)
const STAMP = /-\d{8}T\d{4}-[a-z0-9]{4}$/i;
/** what makes a pack's name in incoming/ its own (pure): -<YYYYMMDD>T<HHMM> (UTC) -<4 letters or digits: nonce>, e.g.
 *  -20261008T1203-ab12 — two packs of one name, or one sent twice, never land on one another */
export function incomingStamp(now, nonce) {
  const d = new Date(now), p = (n, k = 2) => String(n).padStart(k, '0');
  const t = Number.isFinite(d.getTime()) ? `${p(d.getUTCFullYear() % 10000, 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}` : '00000000T0000';
  return `-${t}-${String(nonce ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(4, '0').slice(0, 4)}`;
}
/** 4 random letters or digits (crypto's: the browser's and node's alike) */
export const randomNonce = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join('');
/** the branch a pack waits on for unit.yml (pure): lab-incoming/<its name in incoming/> — from "incoming/<name>" or "<name>";
 *  null for a name INCOMING refuses */
export function incomingBranch(file) {
  const name = String(file ?? '').replace(/^incoming\//, '');
  return INCOMING.test(`incoming/${name}`) && !name.includes('..') ? `lab-incoming/${name}` : null;
}
/** the unit a pack becomes when no name is given (pure; importPlan and unitci's plan alike, so the panel and Actions agree —
 *  never the pack's own header.name, which the lab would take: "pack.name", 60 letters, "2048 Game"): its file's stem — no
 *  folder, no .mcaddon .mcpack .zip, no stamp — in lower case, each run of anything but a-z 0-9 one _, none at either end,
 *  40 at most; addon_ before one that would not start with a letter, would be parked (zz_) or is under 2. Always a name the
 *  list shows and the lab's import keeps as it is ("2048 Game.mcaddon" → addon_2048_game) */
export function unitFromFile(file) {
  const stem = String(file ?? '').split(/[\\/]/).pop().normalize('NFKC').replace(/\.(mcaddon|mcpack|zip)$/i, '').replace(STAMP, '');
  const fit = (s) => s.slice(0, 40).replace(/_+$/, '');
  const n = fit(stem.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+/, ''));
  return /^[a-z]/.test(n) && !n.startsWith('zz_') && n.length >= 2 ? n : fit(`addon_${n}`);
}
/** a person's pack chosen to take in → { name (its own: incomingStamp), path (incoming/<name>), branch (lab-incoming/<name>),
 *  unit, message (the commit's), inputs (unit.yml's) }, or { error } (pure given now and nonce; else the clock's and a random
 *  one). Only .mcaddon .mcpack .zip, not empty, up to MAX_BYTES; the name made safe — its folders dropped, only letters,
 *  digits and . _ - (others become _), no dot at the start, no .. — so it can only land in incoming/. unit: the one given,
 *  else unitFromFile — always there, so the lab never names it from the pack */
export function importPlan({ fileName, size, words = '', unit = '', now = Date.now(), nonce = randomNonce() } = {}) {
  const base = String(fileName ?? '').split(/[\\/]/).pop().normalize('NFKC'), dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  if (!IMPORT_TYPES.includes(ext)) return { error: `${IMPORT_TYPES.join('・')} のファイルを選んでください` };
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return { error: '空のファイルです' };
  if (n > MAX_BYTES) return { error: `大きすぎます（${MAX_BYTES / 1024 / 1024} MB まで）` };
  const stem = base.slice(0, dot).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[._-]+/, '').slice(0, 80).replace(/[._-]+$/, '') || 'addon';
  const name = `${stem}${incomingStamp(now, nonce)}${ext}`, path = `incoming/${name}`, w = String(words ?? '').trim(), u = String(unit ?? '').trim();
  const bad = (u ? unitNameProblem(u, { taking: true }) : '') || textProblem(w, { max: LIMITS.words, what: 'その人の言葉' });
  if (bad) return { error: bad };
  // (cannot fail after the cleaning above: the same check unit.yml makes, said here first)
  if (!INCOMING.test(path) || path.length > LIMITS.file) return { error: 'このファイルの名前は使えません' };
  const as = u || unitFromFile(name);
  // ([skip ci]: a pack waiting for unit.yml is no change of the lab's code — the push starts no verify run)
  return { name, path, branch: incomingBranch(name), unit: as, message: `panel: 取り込む ${name}（unit.yml が bds/addons/${as} に） [skip ci]`, inputs: { job: 'import', file: path, unit: as, words: w } };
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
/** a text's line break (pure): its first one — \r\n, \r or \n (none: \n) */
export const eolOf = (text) => /\r\n|\r|\n/.exec(String(text ?? ''))?.[0] ?? '\n';
/** a text with every line break made `eol` (pure): a textarea's text (\n alone) back as its file had it */
export const withEol = (text, eol = '\n') => String(text ?? '').replace(/\r\n|\r|\n/g, eol);
/** the same text but for how its lines break (pure): a textarea gives a file of \r\n back with \n */
export const sameText = (a, b) => withEol(a) === withEol(b);

// ---- the calls to GitHub (api: lib/gh.mjs; the person's own sign-in) ----
const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s ?? '').replace(/\s/g, '')), (c) => c.charCodeAt(0)));
/** a pack's branch deleted (best effort: one that cannot be is left for unit.yml or a person) */
const dropIncoming = (api, slug, branch) => api.call('DELETE', `/repos/${slug}/git/refs/${enc(`heads/${branch}`)}`).catch(() => null);
/** the pack put on a branch of its own: the default branch's head read (base: its name), lab-incoming/<name> made from it,
 *  incoming/<name> written there — its bytes as base64, the contents API's way — so the default branch never holds it and
 *  nothing of it stays in the lab's history once unit.yml deletes the branch. The file refused: the branch deleted again
 *  → GitHub's answer to the file */
export async function putIncoming(api, slug, { path, message }, content, base = 'main') {
  const branch = INCOMING.test(String(path ?? '')) ? incomingBranch(path) : null;
  if (!branch) throw new Error('このファイルの名前は使えません');
  if (!content) throw new Error('ファイルが読めませんでした');
  const sha = (await api.call('GET', `/repos/${slug}/git/ref/${enc(`heads/${base}`)}`))?.object?.sha;
  if (!sha) throw new Error(`既定の枝 ${base} の先頭が読めません`);
  // (GitHub's refusal said in words where its own are terse: a branch a ruleset will not let be made, a pack too large)
  const why = (e) => { const r = refusal(e.status, e.message); return r.kind ? Object.assign(new Error(`${r.say}（${String(e.message).replace(/\s+/g, ' ').trim()}）`), { status: e.status }) : e; };
  try { await api.call('POST', `/repos/${slug}/git/refs`, { ref: `refs/heads/${branch}`, sha }); } catch (e) { throw why(e); }
  try { return await api.call('PUT', `/repos/${slug}/contents/${enc(path)}`, { message, content, branch }); } catch (e) { await dropIncoming(api, slug, branch); throw why(e); }
}
/** a person's pack taken in: put on its branch (putIncoming; base: the default branch), then unit.yml started with it
 *  (dispatch(workflow, inputs): GitHub's call, on the default branch) → its path. unit.yml not started: the branch deleted */
export async function importUnit(api, slug, plan, content, dispatch, base = 'main') {
  await putIncoming(api, slug, plan, content, base);
  try { await dispatch(WORKFLOW, plan.inputs); } catch (e) { await dropIncoming(api, slug, incomingBranch(plan.path)); throw e; }
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
/** a unit's file saved as a commit on the default branch, over the sha it was read at → { sha (the new one), commit (its
 *  page) }. Another's change since then — GitHub: 409 "<path> does not match <sha>", 422 "sha" wasn't supplied — is not
 *  overwritten: said in words. Any other 409 or 422 (a protected default branch answers so too: a ruleset, a pull request
 *  needed) as GitHub said it */
export async function saveUnitFile(api, slug, path, text, sha, message) {
  try { const r = await api.putFile(slug, path, text, sha, message); return { sha: r?.content?.sha ?? null, commit: r?.commit?.html_url ?? null }; }
  catch (e) {
    if (e.status !== 409 && e.status !== 422) throw e;
    const r = refusal(e.status, e.message);
    if (r.kind === 'stale') throw new Error(r.say);
    throw Object.assign(new Error(`${String(e.message).replace(/\s+/g, ' ').trim()} — ${r.kind === 'protected' ? r.say : '既定の枝が守られているかもしれません（PR が要ります）'}`), { status: e.status });
  }
}
