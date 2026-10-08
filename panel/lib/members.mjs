// members: who may do what in the lab — its people as GitHub has them (the owner, the collaborators and their roles, the
// invitations not yet taken) changed from the panel by the lab's administrators, and the lab's policy
// (.github/bds-lab-panel.json, lib/policy.mjs) edited as a grid instead of by hand. GitHub stays the gate: inviting, changing
// a role or removing someone is GitHub's own API with the administrator's own sign-in (GitHub refuses anyone else), and the
// policy written is checked first (checkPolicy) — a policy that would not check out is never written. No DOM, no node:.
import { checkPolicy, ACTIONS, GITHUB_ROLES, POLICY_FILE, DEFAULT_POLICY } from './policy.mjs';

export const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** GitHub's roles as a collaborator gets them (the API's names) and in words */
export const PERMISSIONS = ['admin', 'maintain', 'push', 'triage', 'pull'];
export const PERMISSION_WORDS = { admin: '管理者（何でも: メンバー・設定も）', maintain: '保守（設定の一部も）', push: '書き込み（Write）', triage: '整理（issue と PR）', pull: '見るだけ（Read）' };
/** the API's permission name → the role name the policy uses (pure) */
export const roleOfPermission = (p) => ({ admin: 'admin', maintain: 'maintain', push: 'write', write: 'write', triage: 'triage', pull: 'read', read: 'read' })[p] ?? null;

/** a collaborator as GitHub lists them → { login, avatar, permission, role } (pure) */
export function memberOf(c) {
  const p = c?.permissions ?? {};
  const permission = c?.role_name ? ({ write: 'push', read: 'pull' })[c.role_name] ?? c.role_name : p.admin ? 'admin' : p.maintain ? 'maintain' : p.push ? 'push' : p.triage ? 'triage' : 'pull';
  return { login: c.login, avatar: /^https:\/\//.test(String(c.avatar_url ?? '')) ? c.avatar_url : '', permission, role: roleOfPermission(permission) };
}
/** what may be done to this member by this person (pure): never to the owner, never to oneself (GitHub would let an admin
 *  remove their own access — a lab with no administrator left) */
export function canChange(member, { owner, me }) {
  if (!member) return { ok: false, why: '' };
  if (member.login.toLowerCase() === String(owner ?? '').toLowerCase()) return { ok: false, why: '持ち主は変えられません' };
  if (member.login.toLowerCase() === String(me ?? '').toLowerCase()) return { ok: false, why: '自分の役割は、ほかの管理者に変えてもらいます' };
  return { ok: true, why: '' };
}

/** the lab's people → { owner, members: [..], invitations: [{ id, login, permission, at }] } */
export async function readMembers(api, slug, repo) {
  const owner = repo?.owner?.login ?? slug.split('/')[0];
  const cs = (await api.call('GET', `/repos/${slug}/collaborators?affiliation=all&per_page=100`)) ?? [];
  const inv = await api.call('GET', `/repos/${slug}/invitations?per_page=100`).catch(() => []);
  return { owner, members: cs.map(memberOf), invitations: (inv ?? []).map((i) => ({ id: i.id, login: i.invitee?.login ?? '?', permission: i.permissions === 'write' ? 'push' : i.permissions === 'read' ? 'pull' : i.permissions, at: i.created_at })) };
}
/** someone invited, or their role changed → 'invited' (GitHub sent an invitation) | 'changed' */
export async function setMember(api, slug, login, permission) {
  if (!LOGIN.test(String(login ?? ''))) throw new Error('GitHub のユーザー名を入れてください（英数字と -）');
  if (!PERMISSIONS.includes(permission)) throw new Error('役割を選んでください');
  // (a name GitHub does not know: said before anything is sent)
  try { await api.call('GET', `/users/${encodeURIComponent(login)}`); } catch (e) { if (e.status === 404) throw new Error(`${login} という GitHub のユーザーはいません`); throw e; }
  const r = await api.call('PUT', `/repos/${slug}/collaborators/${encodeURIComponent(login)}`, { permission });
  return r && r.id ? 'invited' : 'changed';
}
export const removeMember = (api, slug, login) => api.call('DELETE', `/repos/${slug}/collaborators/${encodeURIComponent(login)}`);
export const cancelInvitation = (api, slug, id) => api.call('DELETE', `/repos/${slug}/invitations/${encodeURIComponent(id)}`);

/** the policy as a grid (pure): for each GitHub role, the actions it lists; confirm; idle minutes; audit */
export function gridOf(policy = DEFAULT_POLICY) {
  const roles = Object.fromEntries(GITHUB_ROLES.map((r) => { const l = policy.roles?.[r] ?? []; return [r, l.includes('*') ? [...ACTIONS] : ACTIONS.filter((a) => l.includes(a))]; }));
  return { roles, confirm: ACTIONS.filter((a) => (policy.confirm ?? []).includes(a) || (policy.confirm ?? []).includes('*')), idleMinutes: policy.idleMinutes ?? 0, audit: policy.audit ?? 'auto', teams: { ...(policy.teams ?? {}) }, extra: Object.fromEntries(Object.entries(policy.roles ?? {}).filter(([r]) => !GITHUB_ROLES.includes(r))) };
}
/** the grid → the policy file's JSON, checked (pure): { json, errors }. admin keeps everything (a lab never locks its
 *  administrators out); the roles named for teams are kept as they were */
export function policyOf(grid) {
  const roles = { ...grid.extra };
  for (const r of GITHUB_ROLES) { const l = r === 'admin' ? ['*'] : ACTIONS.filter((a) => grid.roles[r]?.includes(a)); if (l.length) roles[r] = l; }
  const json = { version: 1, roles, ...(Object.keys(grid.teams ?? {}).length ? { teams: grid.teams } : {}), confirm: ACTIONS.filter((a) => grid.confirm.includes(a)), idleMinutes: Math.max(0, Math.min(1440, Math.round(Number(grid.idleMinutes) || 0))), audit: grid.audit };
  return { json, errors: checkPolicy(json).errors };
}
/** ready-made grids (the GitHub roles below admin; admin always has everything): the owner alone, writers who run, a
 *  trusted team that does all but secrets and members */
export const POLICY_PRESETS = {
  owner: { label: '管理者だけ', roles: {} },
  runners: { label: '書ける人は実行・止めるも', roles: { write: ['dispatch', 'run.cancel'], maintain: ['dispatch', 'hostrun', 'run.cancel', 'audit.read'] } },
  team: { label: '保守の人は秘密とメンバーのほか全部', roles: { write: ['dispatch', 'hostrun', 'run.cancel'], maintain: ACTIONS.filter((a) => !a.startsWith('secrets.') && a !== 'members') } },
};
/** a grid with a preset's roles (pure): what is asked first, idle minutes, the log and the teams' roles stay */
export function applyPreset(grid, id) {
  const p = POLICY_PRESETS[id]; if (!p) throw new Error(`no preset ${id}`);
  return { ...grid, roles: Object.fromEntries(GITHUB_ROLES.map((r) => [r, r === 'admin' ? [...ACTIONS] : ACTIONS.filter((a) => (p.roles[r] ?? []).includes(a))])) };
}
/** where someone invited takes their invitation (GitHub sends it too; this is to pass along) */
export const invitationUrl = (slug) => `https://github.com/${slug}/invitations`;
/** the policy file written on the lab's default branch (checked first; its sha kept so another's change is not overwritten) */
export async function savePolicy(api, slug, grid) {
  const { json, errors } = policyOf(grid);
  if (errors.length) throw new Error(errors.join(' / '));
  const f = await api.file(slug, POLICY_FILE).catch(() => null);
  await api.putFile(slug, POLICY_FILE, JSON.stringify(json, null, 2) + '\n', f?.sha, 'panel: 役割（ポリシー）を変える');
  return json;
}
