// policy: what the lab's people may do in the panel, by role — the lab's administrators write it in the lab's default branch,
// .github/bds-lab-panel.json (a company's rules: who may start runs, set or delete secrets, change variables, cancel a run,
// lend; what asks to be confirmed; after how many idle minutes the panel signs out; whether actions go to the audit log).
// A policy only narrows what the panel shows and does. What GitHub does not allow a person is never allowed here, whatever
// the file says: `can` asks GitHub's own role first (the least role GitHub could allow the action to), then the policy — and
// GitHub's API still answers for itself. (Whoever may write this file may do the same things on GitHub directly: protect it
// with CODEOWNERS or a branch rule.) A file that does not check out allows nothing — it was meant to narrow, so it is never
// read as the wider default. Pure but for loadPolicy and teamsOf (through lib/gh.mjs).
//
//   {
//     "roles": { "admin": ["*"], "write": ["dispatch", "run.cancel"], "auditor": ["audit.read"] },   (roles listed: only these)
//     "teams": { "auditors": "auditor" },        (an organization's team slug → its role: the first team listed that a person is in)
//     "confirm": ["secrets.delete", "run.cancel"],
//     "idleMinutes": 30,                         (0: never)
//     "audit": "issue"                           (or "off"; "auto": issue when the lab is not public)
//   }

export const POLICY_FILE = '.github/bds-lab-panel.json';
/** what a policy may allow or ask to confirm */
export const ACTIONS = ['dispatch', 'hostrun', 'secrets.put', 'secrets.delete', 'variables', 'run.cancel', 'lend', 'audit.read'];
export const ACTION_WORDS = { dispatch: 'ワークフローを始める', hostrun: '貸し手の Actions で走らせる', 'secrets.put': '秘密を登録する', 'secrets.delete': '秘密を消す', variables: '変数を変える', 'run.cancel': '実行を止める', lend: '貸す条件を変える', 'audit.read': '監査ログを見る' };
/** GitHub's roles on a repository, least first */
export const GITHUB_ROLES = ['read', 'triage', 'write', 'maintain', 'admin'];
/** the least GitHub role on the repository acted on that could allow each action (the lab; for lend, the lender's host) —
 *  no policy goes below it */
export const GITHUB_NEEDS = { dispatch: 'write', hostrun: 'write', 'secrets.put': 'write', 'secrets.delete': 'write', variables: 'write', 'run.cancel': 'write', lend: 'admin', 'audit.read': 'read' };
const rank = (r) => GITHUB_ROLES.indexOf(r);
const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
/** no file: what the panel did before policies — writers and admins do everything GitHub lets them (lending: a host's
 *  admin), readers nothing; deleting a secret asks first; never signed out for idling; the audit log kept when the lab is not public */
export const DEFAULT_POLICY = freeze({ version: 1, roles: { admin: ['*'], maintain: [...ACTIONS], write: [...ACTIONS], triage: [], read: [] }, teams: {}, confirm: ['secrets.delete'], idleMinutes: 0, audit: 'auto' });
/** a file that does not check out: nothing allowed, everything asks */
export const LOCKED_POLICY = freeze({ version: 1, roles: {}, teams: {}, confirm: [...ACTIONS], idleMinutes: 0, audit: 'auto' });
const KEYS = ['version', 'roles', 'teams', 'confirm', 'idleMinutes', 'audit'];
const ROLE = /^[a-z][a-z0-9_-]{0,39}$/, TEAM = /^[a-z0-9][a-z0-9_.-]{0,99}$/i;
const isObj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const actionList = (x, star) => Array.isArray(x) && x.every((a) => ACTIONS.includes(a) || (star && a === '*'));

/** .github/bds-lab-panel.json's JSON (null: there is none) → { policy, errors } (pure). No file: DEFAULT_POLICY; a file with
 *  errors: LOCKED_POLICY and the errors in words; roles listed replace the default's (a role not listed may do nothing) */
export function checkPolicy(j) {
  if (j === null || j === undefined) return { policy: DEFAULT_POLICY, errors: [] };
  if (!isObj(j)) return { policy: LOCKED_POLICY, errors: [`${POLICY_FILE} が JSON のオブジェクトではありません`] };
  const e = [];
  for (const k of Object.keys(j)) if (!KEYS.includes(k)) e.push(`${k}: 知らない項目です（${KEYS.join(' ')}）`);
  if (j.version !== undefined && j.version !== 1) e.push('version: 1');
  if (j.roles !== undefined) {
    if (!isObj(j.roles)) e.push('roles: { "役割": ["dispatch", …] } の形');
    else for (const [k, v] of Object.entries(j.roles)) {
      if (!ROLE.test(k)) e.push(`roles.${k}: 役割の名前は英小文字・数字・_ -（40 文字まで）`);
      if (!actionList(v, true)) e.push(`roles.${k}: ${ACTIONS.join(' ')} か "*" の並び`);
    }
  }
  const roles = isObj(j.roles) ? j.roles : DEFAULT_POLICY.roles;
  if (j.teams !== undefined) {
    if (!isObj(j.teams)) e.push('teams: { "チーム": "役割" } の形');
    else for (const [k, v] of Object.entries(j.teams)) {
      if (!TEAM.test(k)) e.push(`teams.${k}: 組織のチームの slug（英数字・_ . -）`);
      if (typeof v !== 'string' || !Object.hasOwn(roles, v)) e.push(`teams.${k}: roles にある役割の名前（${Object.keys(roles).join(' ') || 'なし'}）`);
    }
  }
  if (j.confirm !== undefined && !actionList(j.confirm, true)) e.push(`confirm: ${ACTIONS.join(' ')} か "*" の並び`);
  if (j.idleMinutes !== undefined && (!Number.isInteger(j.idleMinutes) || j.idleMinutes < 0 || j.idleMinutes > 1440)) e.push('idleMinutes: 0〜1440 の整数（0: 切らない）');
  if (j.audit !== undefined && !['issue', 'off', 'auto'].includes(j.audit)) e.push('audit: "issue" か "off" か "auto"');
  if (e.length) return { policy: LOCKED_POLICY, errors: e };
  return { policy: freeze({ version: 1, roles: Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, [...new Set(v)]])), teams: { ...(j.teams ?? {}) }, confirm: [...(j.confirm ?? DEFAULT_POLICY.confirm)], idleMinutes: j.idleMinutes ?? 0, audit: j.audit ?? 'auto' }), errors: [] };
}
/** the lab's policy from its default branch → { policy, errors, found } (a file that cannot be read: LOCKED_POLICY, said why) */
export async function loadPolicy(api, slug) {
  let f;
  try { f = await api.file(slug, POLICY_FILE); } catch (e) { return { policy: LOCKED_POLICY, errors: [`${POLICY_FILE} を読めません（${e.message}）`], found: null }; }
  if (!f) return { ...checkPolicy(null), found: false };
  let j;
  try { j = JSON.parse(f.text); } catch { return { policy: LOCKED_POLICY, errors: [`${POLICY_FILE} が JSON ではありません`], found: true }; }
  return { ...checkPolicy(j), found: true };
}

/** GitHub's role from a repository's `permissions` (or a role's name) → 'admin' | 'maintain' | 'write' | 'triage' | 'read' |
 *  null (pure) */
export function repoRoleOf(p) {
  if (typeof p === 'string') return GITHUB_ROLES.includes(p) ? p : null;
  if (!p) return null;
  return p.admin ? 'admin' : p.maintain ? 'maintain' : p.push ? 'write' : p.triage ? 'triage' : p.pull ? 'read' : null;
}
/** a person's role on a repository (pure): GitHub's (repoRole: a name or the repository's `permissions`) unless a team they
 *  are in names another — the first team in the policy's list that they are in. teams: their teams' slugs; null when they
 *  could not be read (then every role they might have counts, and `can` allows only what all of them allow)
 *  → { name, names, repoRole, team } */
export function roleFor({ repoRole, teams = [], policy = DEFAULT_POLICY } = {}) {
  const gh = repoRoleOf(repoRole), mapped = Object.entries(policy?.teams ?? {});
  if (!gh) return { name: null, names: [], repoRole: null, team: null };
  if (teams === null) { const names = [...new Set([...mapped.map(([, r]) => r), gh])]; return { name: names.length === 1 ? names[0] : null, names, repoRole: gh, team: null }; }
  const mine = new Set((teams ?? []).map((t) => String(t).toLowerCase())), hit = mapped.find(([t]) => mine.has(t.toLowerCase()));
  const name = hit ? hit[1] : gh;
  return { name, names: [name], repoRole: gh, team: hit ? hit[0] : null };
}
/** may this role do this (pure): GitHub's role on the repository allows it, and the policy's role (every one it might be)
 *  lists it. role: roleFor's answer, or a GitHub role's name. No policy: DEFAULT_POLICY */
export function can(policy, role, action) {
  const p = policy ?? DEFAULT_POLICY;
  if (!ACTIONS.includes(action)) return false;
  const r = typeof role === 'string' ? roleFor({ repoRole: role, teams: [], policy: p }) : role;
  // (GitHub first: no policy goes past what the repository's own role could be allowed)
  if (!r?.repoRole || rank(repoRoleOf(r.repoRole)) < rank(GITHUB_NEEDS[action])) return false;
  const names = r.names?.length ? r.names : r.name ? [r.name] : [];
  return names.length > 0 && names.every((n) => { const l = Object.hasOwn(p.roles ?? {}, n) ? p.roles[n] : []; return l.includes('*') || l.includes(action); });
}
/** does this action ask "are you sure" first (pure) */
export const needsConfirm = (policy, action) => { const l = (policy ?? DEFAULT_POLICY).confirm ?? []; return l.includes('*') || l.includes(action); };
/** after how many idle minutes the panel signs out (0: never) (pure) */
export const idleMinutes = (policy) => (policy ?? DEFAULT_POLICY).idleMinutes ?? 0;
/** whether actions are kept in the audit issue → 'issue' | 'off' (pure): the policy's, or (auto) when the lab is not public */
export function auditMode(policy, visibility) {
  const a = (policy ?? DEFAULT_POLICY).audit;
  if (a === 'issue' || a === 'off') return a;
  return visibility === 'private' || visibility === 'internal' ? 'issue' : 'off';
}
/** the policy's teams this person is active in, in the lab's organization → [slugs]; null when a team could not be read
 *  (this token may not see the organization's members: roleFor then counts every role they might have) */
export async function teamsOf(api, org, login, policy) {
  const out = [];
  for (const t of Object.keys(policy?.teams ?? {})) {
    try { if ((await api.teamMembership(org, t, login))?.state === 'active') out.push(t); } catch { return null; }
  }
  return out;
}
