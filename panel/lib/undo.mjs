// undo: one entry of the audit log (lib/audit.mjs) taken back — a variable changed, the policy, the timetable (予約) or who
// hears what (通知) — to what it was before. undoable(entry) says, without asking GitHub, what would be put back and with
// which of the policy's actions (pure); a file is put back to its text in the parent of the commit that changed it (that
// commit found by the entry's time and person), written over the file as a NEW commit with the current sha (nothing is erased,
// a change made elsewhere in between is refused by GitHub, never written over). A variable is put back only when the entry
// carries its value from before (detail.before); a secret's value and what was deleted are never in the log: those say why
// not. Pure but for prepare and apply (GitHub only through `api`, lib/gh.mjs). Undoing is kept in the audit log by the
// panel's guarded, like any other change.
import { POLICY_FILE, checkPolicy } from './policy.mjs';
import { SCHEDULE_FILE, checkSchedule } from './schedule.mjs';
import { NOTIFY_FILE, parsePrefs } from './notifyprefs.mjs';

/** the files that can be put back → { action: the policy's action that guards writing it, words, check(text) → problems } */
export const UNDO_FILES = Object.freeze({
  [POLICY_FILE]: { action: 'members', words: '役割（ポリシー）', check: (t) => checkPolicy(JSON.parse(t)).errors },
  [SCHEDULE_FILE]: { action: 'dispatch', words: '予約', check: (t) => checkSchedule(JSON.parse(t)).errors },
  [NOTIFY_FILE]: { action: 'variables', words: '通知の設定', check: (t) => { parsePrefs(t); return []; } },
});
/** the audit log's actions whose entries may name one of those files (the policy: members or policy; the timetable:
 *  dispatch; the notify file: variables) */
const FILE_ACTIONS = ['variables', 'members', 'policy', 'dispatch'];
const NAME = /^[A-Z_][A-Z0-9_]{0,99}$/;
/** how long before the entry's time the commit may be (the panel writes, then records: seconds apart) and after (clocks) */
export const BEFORE_MS = 10 * 60_000, AFTER_MS = 2 * 60_000;

/** an entry of the audit log → { ok, kind: 'variable' | 'file' | null, name?, path?, before?, action?, why } (pure). ok: it can be
 *  put back (why ''); else why says in words why not. action: the policy's action the undo goes through (ctx.guarded) */
export function undoable(entry) {
  const a = String(entry?.action ?? ''), d = entry?.detail ?? {};
  const no = (why, more = {}) => ({ ok: false, kind: null, ...more, why });
  if (a.startsWith('secrets')) return no('秘密の値は監査ログに残らないので、ここからは戻せません。前の値を知っている人が「秘密」で登録し直してください。');
  const file = typeof d.file === 'string' ? d.file : '';
  if (file && FILE_ACTIONS.includes(a)) {
    const f = UNDO_FILES[file];
    if (!f) return no(`${file} はここでは戻せません（戻せるのは 役割・予約・通知の設定 のファイルだけ）。アドオンのファイルは「アドオン」の「↩️ 前の版に戻す」で。`, { path: file });
    return { ok: true, kind: 'file', path: file, action: f.action, why: '' };
  }
  if (a === 'variables') {
    const name = typeof d.name === 'string' && NAME.test(d.name) ? d.name : '';
    if (!name) return no('どの変数を変えたかが記録にありません。');
    if (typeof d.before !== 'string') return no(`変数 ${name} の前の値が記録にありません（監査ログには変数の名前だけを残しています）。前の値を知っている人が「設定」で入れ直してください。`, { kind: 'variable', name });
    return { ok: true, kind: 'variable', name, before: d.before, action: 'variables', why: '' };
  }
  return no('この操作は取り消せません（取り消せるのは「変数を変えた」「役割（ポリシー）を変えた」「予約を変えた」「通知の設定を変えた」だけ）。');
}

/** the commit an entry made, among the file's commits (GitHub's list: { sha, author: { login }, commit: { author, committer },
 *  parents }) → the one at most BEFORE_MS before the entry's time and AFTER_MS after, by the entry's person when one is, the
 *  nearest in time; null when none (pure) */
export function pickCommit(commits, entry) {
  const at = Date.parse(entry?.at ?? ''), who = String(entry?.actor ?? '').toLowerCase();
  if (!Number.isFinite(at)) return null;
  const xs = (Array.isArray(commits) ? commits : []).map((c) => ({ c, t: Date.parse(c?.commit?.committer?.date ?? c?.commit?.author?.date ?? '') }))
    .filter((x) => Number.isFinite(x.t) && x.t >= at - BEFORE_MS && x.t <= at + AFTER_MS && x.c?.sha);
  const mine = xs.filter((x) => String(x.c.author?.login ?? '').toLowerCase() === who);
  const best = (mine.length ? mine : xs).sort((p, q) => Math.abs(at - p.t) - Math.abs(at - q.t))[0];
  return best ? { sha: String(best.c.sha), parent: best.c.parents?.[0]?.sha ? String(best.c.parents[0].sha) : null, date: new Date(best.t).toISOString() } : null;
}

const split = (t) => (t === null || t === undefined || t === '' ? [] : String(t).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
/** how `to` differs from `from`, line by line (pure) → { added: [lines only in to], removed: [lines only in from] } (a changed
 *  line counts once on each side; order is not looked at) */
export function lineChanges(from, to) {
  const left = new Map();
  for (const l of split(from)) left.set(l, (left.get(l) ?? 0) + 1);
  const added = [];
  for (const l of split(to)) { const n = left.get(l) ?? 0; if (n > 0) left.set(l, n - 1); else added.push(l); }
  const removed = [];
  for (const l of split(from)) { const n = left.get(l) ?? 0; if (n > 0) { removed.push(l); left.set(l, n - 1); } }
  return { added, removed };
}
export const shortSha = (sha) => String(sha ?? '').slice(0, 7);
/** the commit message apply() writes (pure) */
export const undoMessage = (path, sha) => `panel: ${path} を ${shortSha(sha)} の前に戻す（監査ログから取り消し）`;

/** what undoing would do, read from GitHub → { ...undoable(entry), now, before, same, problems, commit? } — now: the current
 *  text or value (null: not there), before: what it would become, same: nothing would change, problems: why the text from
 *  before is not written (not JSON, the policy's or the timetable's errors) — an entry that cannot be undone is handed back
 *  as undoable said, nothing read. A file made by the change (nothing in the commit before) or a commit not found: ok false
 *  and why */
export async function prepare(api, slug, entry) {
  const u = undoable(entry);
  if (!u.ok) return u;
  if (u.kind === 'variable') {
    const now = await api.variable(slug, u.name);
    return { ...u, now, same: now === u.before, problems: [] };
  }
  const at = Date.parse(entry.at);
  const q = `since=${encodeURIComponent(new Date(at - BEFORE_MS).toISOString())}&until=${encodeURIComponent(new Date(at + AFTER_MS).toISOString())}`;
  const list = await api.call('GET', `/repos/${slug}/commits?per_page=30&path=${encodeURIComponent(u.path)}&${q}`);
  const c = pickCommit(list, entry);
  if (!c) return { ...u, ok: false, why: `${u.path} をこのとき変えた commit が見つかりません（履歴が書き換えられたか、変更が保存されなかったか）。GitHub の履歴から戻してください。` };
  const old = c.parent ? await api.file(slug, u.path, c.parent) : null;
  if (old === null) return { ...u, ok: false, commit: c, why: `${u.path} はこの変更で作られました。取り消すとファイルを消すことになるので、ここからは戻せません。` };
  const cur = await api.file(slug, u.path);
  let problems;
  try { problems = UNDO_FILES[u.path].check(old.text); } catch (e) { problems = [`前の版が正しい JSON ではありません（${e.message}）`]; }
  return { ...u, commit: c, now: cur?.text ?? null, before: old.text, same: cur?.text === old.text, problems };
}

/** put back what prepare() read: a file written over as a new commit with the sha read just before (a change made in between
 *  is refused by GitHub), a variable set to its value from before. The same as now: nothing is written → { changed: false } */
export async function apply(api, slug, p) {
  if (!p?.ok) throw new Error(p?.why || '戻せません');
  if (p.problems?.length) throw new Error(`前の版に誤りがあるので戻しません: ${p.problems.join('・')}`);
  if (p.kind === 'variable') {
    if ((await api.variable(slug, p.name)) === p.before) return { changed: false };
    await api.setVariable(slug, p.name, p.before);
    return { changed: true };
  }
  const cur = await api.file(slug, p.path);
  if (cur && cur.text === p.before) return { changed: false, sha: cur.sha };
  const r = await api.putFile(slug, p.path, p.before, cur?.sha ?? undefined, undoMessage(p.path, p.commit?.sha));
  return { changed: true, sha: r?.commit?.sha ?? null };
}
