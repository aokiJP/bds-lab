// gh: GitHub's REST API from the browser with the person's own token (fine-grained: only the repositories and permissions
// they chose; or the user token of the lab's GitHub App, from signing in: what the App and the person may both do). Nothing
// else is ever called: the panel's page allows no other address (its CSP's connect-src). GitHub decides
// what this person may see and do — the panel adds no power of its own.
import { secretPayload } from './seal.mjs';

export class GhError extends Error { constructor(status, message, path) { super(message); this.status = status; this.path = path; } }
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (text) => { const b = enc.encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => dec.decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), (c) => c.charCodeAt(0)));
/** what a GitHub error means for the person (pure) */
export function explain(status, message = '') {
  if (status === 401) return 'トークンが受け付けられません（期限切れ・消された・打ち間違い）: 設定で入れ直してください';
  if (status === 403 && /rate limit/i.test(message)) return 'GitHub の回数の上限です: しばらく待ってから';
  if (status === 403) return `このトークンには、その操作の権限がありません（${message}）`;
  if (status === 404) return '見つからないか、このトークンでは見えません（リポジトリをトークンの対象に入れましたか）';
  if (status === 422) return `GitHub が受け付けません: ${message}`;
  return `GitHub: ${status} ${message}`;
}

/** → the API's calls. token: the person's; base: GitHub's API (another only for tests) */
export function gh({ token, base = 'https://api.github.com', fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  const state = { remaining: null, reset: null };
  // (anon: asked without the token — a call whose own argument is the proof, the App manifest's code)
  async function call(method, path, body, { anon = false } = {}) {
    const r = await fetchImpl(`${base}${path}`, { method, headers: { ...(anon ? {} : { authorization: `Bearer ${token}` }), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    const rem = r.headers?.get?.('x-ratelimit-remaining'); if (rem !== null && rem !== undefined) { state.remaining = Number(rem); state.reset = Number(r.headers.get('x-ratelimit-reset')); }
    if (r.status === 204) return null;
    const text = await r.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!r.ok) throw new GhError(r.status, explain(r.status, j?.message ?? text.slice(0, 120)), path);
    return j;
  }
  const self = {
    state, call,
    me: () => call('GET', '/user'),
    repo: (r) => call('GET', `/repos/${r}`),
    /** the repositories this person owns or collaborates on, the most recently pushed first (up to 200) */
    async myRepos() { const a = await call('GET', '/user/repos?affiliation=owner,collaborator&sort=pushed&per_page=100'); return a.length < 100 ? a : [...a, ...(await call('GET', '/user/repos?affiliation=owner,collaborator&sort=pushed&per_page=100&page=2'))]; },
    /** a file's text and sha on the default branch (or ref), null when there is none */
    async file(r, p, ref) { try { const j = await call('GET', `/repos/${r}/contents/${p.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`); return { text: unb64(j.content), sha: j.sha }; } catch (e) { if (e.status === 404) return null; throw e; } },
    putFile: (r, p, text, sha, message) => call('PUT', `/repos/${r}/contents/${p.split('/').map(encodeURIComponent).join('/')}`, { message, content: b64(text), ...(sha ? { sha } : {}) }),
    workflows: async (r) => (await call('GET', `/repos/${r}/actions/workflows?per_page=100`)).workflows ?? [],
    runs: async (r, { per = 20, workflow, created, status } = {}) => (await call('GET', `/repos/${r}/actions/${workflow ? `workflows/${encodeURIComponent(workflow)}/` : ''}runs?per_page=${per}${created ? `&created=${encodeURIComponent(created)}` : ''}${status ? `&status=${status}` : ''}`)).workflow_runs ?? [],
    jobs: async (r, run) => (await call('GET', `/repos/${r}/actions/runs/${run}/jobs?per_page=100`)).jobs ?? [],
    annotations: (r, checkRun) => call('GET', `/repos/${r}/check-runs/${checkRun}/annotations?per_page=50`),
    dispatch: (r, workflow, ref, inputs) => call('POST', `/repos/${r}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { ref, inputs }),
    cancel: (r, run) => call('POST', `/repos/${r}/actions/runs/${run}/cancel`),
    rerunFailed: (r, run) => call('POST', `/repos/${r}/actions/runs/${run}/rerun-failed-jobs`),
    pulls: (r) => call('GET', `/repos/${r}/pulls?state=open&per_page=20`),
    /** the secrets' names (never their values: GitHub gives none) → [names], null when this token may not look */
    async secretNames(r) { try { return ((await call('GET', `/repos/${r}/actions/secrets?per_page=100`)).secrets ?? []).map((s) => s.name); } catch (e) { if (e.status === 403 || e.status === 404) return null; throw e; } },
    secrets: async (r) => (await call('GET', `/repos/${r}/actions/secrets?per_page=100`)).secrets ?? [],
    /** a secret set: sealed here with the repository's public key, so only GitHub's Actions can open it */
    async putSecret(r, name, value, opts) { const k = await call('GET', `/repos/${r}/actions/secrets/public-key`); return call('PUT', `/repos/${r}/actions/secrets/${encodeURIComponent(name)}`, secretPayload(value, k, opts)); },
    deleteSecret: (r, name) => call('DELETE', `/repos/${r}/actions/secrets/${encodeURIComponent(name)}`),
    /** a run's artifacts, or the repository's newest (expired ones too: GitHub keeps their names) */
    artifacts: async (r, { run, per = 30 } = {}) => (await call('GET', `/repos/${r}/actions/${run ? `runs/${run}/` : ''}artifacts?per_page=${per}`)).artifacts ?? [],
    /** a repository variable's value: null when it is not set (403: this token may not read variables) */
    async variable(r, name) { try { return (await call('GET', `/repos/${r}/actions/variables/${encodeURIComponent(name)}`)).value ?? null; } catch (e) { if (e.status === 404) return null; throw e; } },
    /** a repository variable set (made when it is not there yet) */
    async setVariable(r, name, value) {
      try { return await call('PATCH', `/repos/${r}/actions/variables/${encodeURIComponent(name)}`, { name, value }); }
      catch (e) { if (e.status === 404) return call('POST', `/repos/${r}/actions/variables`, { name, value }); throw e; }
    },
    issues: (r) => call('GET', `/repos/${r}/issues?state=open&per_page=100`),
    comments: (r, n, since) => call('GET', `/repos/${r}/issues/${n}/comments?per_page=100${since ? `&since=${encodeURIComponent(since)}` : ''}`),
    comment: (r, n, body) => call('POST', `/repos/${r}/issues/${n}/comments`, { body }),
    /** an issue's comments, oldest first, page after page (up to `pages` pages of 100) */
    async allComments(r, n, { since, pages = 10 } = {}) {
      const out = [];
      for (let p = 1; p <= pages; p++) { const a = await call('GET', `/repos/${r}/issues/${n}/comments?per_page=100&page=${p}${since ? `&since=${encodeURIComponent(since)}` : ''}`); out.push(...(a ?? [])); if (!a || a.length < 100) break; }
      return out;
    },
    /** the issues (and pull requests: GitHub lists both) with a label, open and closed */
    labeledIssues: (r, label, state = 'all') => call('GET', `/repos/${r}/issues?labels=${encodeURIComponent(label)}&state=${state}&per_page=100`),
    createIssue: (r, { title, body = '', labels = [] }) => call('POST', `/repos/${r}/issues`, { title, body, labels }),
    /** a label made; null when it is there already (422) */
    async createLabel(r, { name, color = 'ededed', description = '' }) { try { return await call('POST', `/repos/${r}/labels`, { name, color, description }); } catch (e) { if (e.status === 422) return null; throw e; } },
    /** the App made from its manifest: the code GitHub gave back (an hour) → { id, slug, client_id, client_secret, pem, … }.
     *  Asked without the person's token (the code alone is the proof) */
    appFromManifest: (code) => call('POST', `/app-manifests/${encodeURIComponent(code)}/conversions`, undefined, { anon: true }),
    /** the repository's GitHub Pages: { build_type, html_url, … }, null when it is not turned on */
    async pages(r) { try { return await call('GET', `/repos/${r}/pages`); } catch (e) { if (e.status === 404) return null; throw e; } },
    /** Pages turned on, built by a workflow (pages.yml); one already on (409), or `update`: switched to the workflow */
    async enablePages(r, { update = false } = {}) {
      if (!update) { try { return await call('POST', `/repos/${r}/pages`, { build_type: 'workflow' }); } catch (e) { if (e.status !== 409) throw e; } }
      return call('PUT', `/repos/${r}/pages`, { build_type: 'workflow' });
    },
    /** the installations of the App this person signed in with that they may see (an App's user token only) */
    userInstallations: async () => (await call('GET', '/user/installations?per_page=100')).installations ?? [],
    /** the repositories of one of those installations this person may see (up to 1000) */
    async installationRepos(id) {
      const out = [];
      for (let p = 1; p <= 10; p++) { const a = (await call('GET', `/user/installations/${encodeURIComponent(id)}/repositories?per_page=100&page=${p}`)).repositories ?? []; out.push(...a); if (a.length < 100) break; }
      return out;
    },
    /** a person's membership of an organization's team: { state: 'active' | 'pending', role }, null when not a member (or the
     *  team is not visible to this token) */
    async teamMembership(org, team, user) { try { return await call('GET', `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/memberships/${encodeURIComponent(user)}`); } catch (e) { if (e.status === 404) return null; throw e; } },
  };
  return self;
}
