// audit: who did what in the panel, kept as comments on an issue of the lab (title 「bds-lab 監査ログ」, label
// bds-lab-audit; made with its label the first time, and locked: only the repository's collaborators may comment, so nobody
// else pushes the log out) — each comment a line for people and the entry itself as JSON in an HTML comment. An issue holds
// ROTATE_AT comments at most: then it is closed and the next is made (「bds-lab 監査ログ 2」 …), and every one is read.
// Only fixed keys go in, each of a fixed form: a secret's or a variable's name may, its value never (nor anything shaped
// like a token or a key). An entry counts only when the comment's author — GitHub says who — is the actor
// it names (nobody can write one as someone else), its time is GitHub's (when the comment was made, not what it says), and
// one changed after it was written is marked edited. An issue is not a record nobody can change (the repository's
// administrators may edit or delete comments): GitHub Enterprise's own audit log is that. CSV for a spreadsheet: quoted as
// RFC 4180, and a value never read as a formula. Pure but for auditIssue, record and readAudit (through lib/gh.mjs).
import { SLUG } from './model.mjs';

export const AUDIT_TITLE = 'bds-lab 監査ログ';
export const AUDIT_LABEL = 'bds-lab-audit';
/** the comments an issue of the log holds before the next is made (readAudit reads 1000 of each: never reached) */
export const ROTATE_AT = 900;
const TITLE = /^bds-lab 監査ログ(?: \d{1,6})?$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const ACTION = /^[a-z]+(?:\.[a-z]+){0,3}$/;
// (whatever its key, a value shaped like a token, a key or a sealed line never goes in)
const TOKENISH = /gh[pousr]_[A-Za-z0-9]{10,}|github_pat_|-----BEGIN|lab-sealed:|eyJ[A-Za-z0-9_-]{10,}\./;
/** the detail's keys and the form of each value (a value of another form is left out) */
const DETAIL = {
  workflow: (v) => /^[\w.-]{1,100}\.ya?ml$/.test(v),
  ref: (v) => /^[\w./-]{1,100}$/.test(v) && !v.includes('..'),
  run: (v) => /^\d{1,20}$/.test(v),
  host: (v) => SLUG.test(v),
  job: (v) => /^[\w-]{1,40}$/.test(v),
  unit: (v) => /^[a-z0-9_]{1,60}$/.test(v),
  // (a secret's or a variable's name: its value is never asked for)
  name: (v) => /^[A-Z_][A-Z0-9_]{0,99}$/.test(v),
  inputs: (v) => Array.isArray(v) && v.length <= 30 && v.every((x) => /^[\w-]{1,100}$/.test(x)),
  file: (v) => /^[\w./-]{1,200}$/.test(v) && !v.includes('..'),
  app: (v) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(v),
  until: (v) => /^\d{4}-\d\d-\d\d$/.test(v),
  status: (v) => /^\d{3}$/.test(v),
  result: (v) => v === 'ok' || v === 'fail',
};
export const DETAIL_KEYS = Object.keys(DETAIL);
export const AUDIT_WORDS = { dispatch: 'ワークフローを始めた', hostrun: '貸し手の Actions で走らせた', 'secrets.put': '秘密を登録した', 'secrets.delete': '秘密を消した', variables: '変数を変えた', 'run.cancel': '実行を止めた', 'run.rerun': '失敗したジョブをやり直した', lend: '貸す条件を変えた',
  'setup.app': 'App を作った', 'setup.pages': 'Pages を有効にした', 'setup.auth': 'サインインのサービスの URL を変えた', 'setup.deploy': 'サインインのサービスを置いた' };

/** an entry as it is kept (pure): { v, at, actor, action, target, detail } with only the detail's fixed keys of their forms.
 *  Throws for an actor or an action of a wrong form */
export function entry({ actor, action, target = '', detail = {}, at } = {}) {
  if (!LOGIN.test(String(actor ?? ''))) throw new Error('監査: actor は GitHub のログイン名');
  if (!ACTION.test(String(action ?? '')) || String(action).length > 40) throw new Error('監査: action の形が違います');
  const when = at === undefined || at === null ? new Date() : new Date(at);
  if (!Number.isFinite(when.getTime())) throw new Error('監査: at が日時ではありません');
  const d = {};
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (!Object.hasOwn(DETAIL, k) || v === undefined || v === null) continue;
    const val = Array.isArray(v) ? v.map(String) : String(v);
    if (DETAIL[k](val) && ![].concat(val).some((x) => TOKENISH.test(x))) d[k] = val;
  }
  return { v: 1, at: when.toISOString(), actor: String(actor), action: String(action), target: SLUG.test(String(target ?? '')) ? String(target) : '', detail: d };
}
const detailText = (d) => Object.entries(d ?? {}).map(([k, v]) => `${k}=${[].concat(v).join(',')}`).join(' ');
/** the line people read (pure; the login in a code span: no mention) */
export const line = (e) => `${e.at} \`${e.actor}\` ${AUDIT_WORDS[e.action] ?? e.action}${e.target ? ` ${e.target}` : ''}${Object.keys(e.detail ?? {}).length ? ` \`${detailText(e.detail)}\`` : ''}`;
/** the comment for an entry (pure): made again with entry() (whatever is handed in, only its fixed keys), its line, then the
 *  entry as JSON in an HTML comment (< and > escaped: nothing ends it early) */
export const commentBody = (e) => { const x = entry(e); return `${line(x)}\n<!-- bdslab-audit ${JSON.stringify(x).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`; };

/** the issues that hold the log (the label and the title, numbered or not), the oldest first */
async function auditIssues(api, slug) {
  return (await api.labeledIssues(slug, AUDIT_LABEL, 'all')).filter((x) => TITLE.test(String(x.title ?? '')) && !x.pull_request).sort((a, b) => a.number - b.number);
}
const full = (x) => Number(x?.comments) >= ROTATE_AT;
/** the issue written to now (pure): the oldest open one not full, else the newest open one (full: the next is made), else none */
const current = (xs) => { const open = xs.filter((x) => x.state === 'open'); return open.find((x) => !full(x)) ?? open.at(-1) ?? null; };
/** the log's issue number, null when there is none yet (never makes one) */
export async function findAuditIssue(api, slug) { const xs = await auditIssues(api, slug); return (current(xs) ?? xs.at(-1))?.number ?? null; }
/** a new issue of the log (its title numbered after the first), locked → { n, why } — why: words when it could not be locked
 *  (the record goes on all the same) */
async function makeIssue(api, slug, xs, prev) {
  await api.createLabel(slug, { name: AUDIT_LABEL, color: '5319e7', description: 'bds-lab の管理パネルの監査ログ' });
  const k = xs.length + 1;
  const n = (await api.createIssue(slug, { title: k > 1 ? `${AUDIT_TITLE} ${k}` : AUDIT_TITLE, labels: [AUDIT_LABEL], body: `bds-lab の管理パネルが、誰が何をしたかをここにコメントで残します（パネルの「監査」で絞り込み・CSV）。\n\nコメントを書いた人と記録の人が違うものは数えません。後から編集されたものは「編集あり」と出ます。このコメントは消さないでください。ロックしてあるので、コメントできるのはリポジトリの協力者だけです。${ROTATE_AT} 件で次の issue に移ります。${prev ? `\n\n前の記録: #${prev}` : ''}` })).number;
  try { await api.lockIssue(slug, n); return { n, why: '' }; } catch (e) { return { n, why: `監査の issue #${n} をロックできません（${e.message}）: 協力者でない人もコメントできます（GitHub の issue の画面で Lock conversation を）` }; }
}
const known = new WeakMap();
/** the log's issue to write to → { n, why }: remembered for this client and lab and looked at again before each record; found,
 *  or made with its label and locked; one that is full (ROTATE_AT comments) or closed is left — a full one closed after the
 *  next is made */
async function logIssue(api, slug) {
  const m = known.get(api) ?? new Map();
  known.set(api, m);
  if (m.has(slug)) {
    let x = null;
    try { x = await api.issue(slug, m.get(slug)); } catch { /* gone or not readable: looked for again */ }
    if (x?.state === 'open' && !full(x)) return { n: m.get(slug), why: '' };
    m.delete(slug);
  }
  const xs = await auditIssues(api, slug), cur = current(xs);
  let n = cur && !full(cur) ? cur.number : null, why = '';
  if (!n) {
    ({ n, why } = await makeIssue(api, slug, xs, cur?.number ?? xs.at(-1)?.number ?? null));
    // (closed once the next is there: when it cannot be, the full one is never chosen again all the same)
    if (cur) { try { await api.closeIssue(slug, cur.number); } catch { /* left open: current() passes it by */ } }
  }
  m.set(slug, n);
  return { n, why };
}
/** the log's issue number to write to: found, or made with its label and locked (remembered for this client and lab) */
export async function auditIssue(api, slug) { return (await logIssue(api, slug)).n; }
/** an entry kept: made again with entry() (only its fixed keys go out) and posted as a comment by the person → the entry
 *  (with why, in words, when the log's issue was made and could not be locked) */
export async function record(api, slug, e) {
  const x = entry(e), { n, why } = await logIssue(api, slug);
  await api.comment(slug, n, commentBody(x));
  return why ? { ...x, why } : x;
}
const MARK = /<!-- bdslab-audit (\{[\s\S]*?\}) -->/;
/** the log's comments → its entries (pure): only those whose comment was written by the actor they name, at GitHub's time
 *  of the comment, each { ...entry, id, by, edited, url } */
export function parse(comments) {
  const out = [];
  for (const c of comments ?? []) {
    const m = MARK.exec(String(c?.body ?? ''));
    if (!m) continue;
    let x;
    try { x = entry(JSON.parse(m[1])); } catch { continue; }
    const by = String(c.user?.login ?? '');
    // (nobody writes an entry as someone else: GitHub's author of the comment is the one who did it)
    if (!by || by.toLowerCase() !== x.actor.toLowerCase()) continue;
    const at = Number.isFinite(Date.parse(c.created_at)) ? new Date(c.created_at).toISOString() : x.at;
    out.push({ ...x, at, id: c.id ?? null, by, edited: Boolean(c.updated_at && c.created_at && c.updated_at !== c.created_at), url: /^https:\/\//.test(String(c.html_url ?? '')) ? c.html_url : '' });
  }
  return out;
}
/** the lab's log → { issue, entries } (no issue yet: none and nothing; every issue of the log read — those closed when full,
 *  and any two made at once) */
export async function readAudit(api, slug, { since } = {}) {
  const xs = await auditIssues(api, slug), all = [];
  for (const x of xs) all.push(...parse(await api.allComments(slug, x.number, { since })));
  return { issue: (current(xs) ?? xs.at(-1))?.number ?? null, entries: all.sort((a, b) => a.at.localeCompare(b.at)) };
}

/** entries narrowed (pure): by actor (any case), by action (that one or those under it: 'secrets' = secrets.put and
 *  secrets.delete), since a day or a time */
export function filter(entries, { actor, action, since } = {}) {
  const t = since ? Date.parse(since) : NaN;
  return (entries ?? []).filter((e) => (!actor || e.actor.toLowerCase() === String(actor).toLowerCase()) && (!action || e.action === action || e.action.startsWith(`${action}.`)) && (!Number.isFinite(t) || Date.parse(e.at) >= t));
}
// (a value a spreadsheet would read as a formula, ASCII or full-width, gets a ' before it)
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r＝＋－＠]/.test(s)) s = `'${s}`; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const CSV_COLUMNS = ['at', 'actor', 'action', 'target', 'detail', 'edited', 'url'];
/** entries → CSV (pure; RFC 4180: CRLF, quoted when needed, " doubled; never a formula) */
export const toCsv = (entries) => [CSV_COLUMNS, ...(entries ?? []).map((e) => [e.at, e.actor, e.action, e.target, detailText(e.detail), e.edited ? 'edited' : '', e.url ?? ''])].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
