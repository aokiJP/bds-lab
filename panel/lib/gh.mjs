// gh: GitHub's REST API from the browser with the person's own token (fine-grained: only the repositories and permissions
// they chose; or the user token of the lab's GitHub App, from signing in: what the App and the person may both do). Nothing
// else is ever called: the panel's page allows no other address (its CSP's connect-src). GitHub decides
// what this person may see and do — the panel adds no power of its own.
import { secretPayload } from './seal.mjs';
import { check, kindOf } from './ghrules.mjs';

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

/** → the API's calls. token: the person's; base: GitHub's API (another only for tests); onCall: told of each call when it
 *  ends — { method, path (no query), status, ms } — for the panel's debug view (never the token, a body or an answer) */
export function gh({ token, base = 'https://api.github.com', fetchImpl = (...a) => globalThis.fetch(...a), onCall = null, timeoutMs = 30_000, readRetries = 1, retryDelayMs = 250 } = {}) {
  const state = { remaining: null, reset: null };
  const schedule = globalThis.setTimeout.bind(globalThis), unschedule = globalThis.clearTimeout.bind(globalThis);
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;
  const retries = Number.isInteger(readRetries) && readRetries >= 0 ? Math.min(readRetries, 2) : 1;
  const delay = Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 250;
  // Deadline covers headers AND the body. Abort the underlying request; a race also bounds a broken transport.
  async function request(method, path, body, opts) {
    const control = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => read(await send(method, path, body, { ...opts, signal: control.signal }), path))(),
        new Promise((_, reject) => { timer = schedule(() => {
          const e = new GhError(0, method === 'GET' ? 'GitHub の応答が制限時間内に届きませんでした。時間をおいて読み直してください。' : 'GitHub の応答が制限時間内に届かず、操作が完了したか分かりません。GitHub の実行一覧や変更履歴を確認してから再操作してください。', path);
          e.timeout = true; reject(e); control.abort();
        }, limit); timer?.ref?.(); }),
      ]);
    } finally { unschedule(timer); }
  }
  // (anon: asked without the token — a call whose own argument is the proof, the App manifest's code)
  async function call(method, path, body, opts) {
    // (a write GitHub surely refuses — lib/ghrules.mjs's sure rules — is stopped here, never sent: the same 422 GitHub would
    // give, in plain words, for lib/rescue.mjs's next step; reads are not looked at)
    const k = kindOf(method, path), bad = k ? check(k.kind, { path: k.path, body }, { strictOnly: true }) : [];
    if (bad.length) throw new GhError(422, explain(422, `${bad.join('・')}（送る前に分かったので、GitHub には送っていません）`), path);
    const t0 = Date.now(), tell = (status) => { try { onCall?.({ method, path: String(path).split('?')[0], status, ms: Date.now() - t0 }); } catch { /* a view's trouble is not the call's */ } };
    for (let attempt = 0; ; attempt++) {
      try { const r = await request(method, path, body, opts); tell(r.status); return r.value; }
      catch (error) {
        const e = error instanceof GhError ? error : new GhError(0, method === 'GET' ? 'GitHub につながりません。接続を確かめて読み直してください。' : 'GitHub につながらず、操作が完了したか分かりません。GitHub の実行一覧や変更履歴を確認してから再操作してください。', path);
        // Writes may have reached GitHub even when the response was lost. Never repeat them automatically.
        if (method !== 'GET' || attempt >= retries || ![0, 502, 503, 504].includes(e.status) || e.invalidResponse) { tell(e.status); throw e; }
        await new Promise((resolve) => { const timer = schedule(resolve, delay * (attempt + 1)); timer?.ref?.(); });
      }
    }
  }
  async function send(method, path, body, { anon = false, signal } = {}) {
    const r = await fetchImpl(`${base}${path}`, { method, headers: { ...(anon ? {} : { authorization: `Bearer ${token}` }), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal });
    const rem = r.headers?.get?.('x-ratelimit-remaining'); if (rem !== null && rem !== undefined) { state.remaining = Number(rem); state.reset = Number(r.headers.get('x-ratelimit-reset')); }
    return r;
  }
  async function read(r, path) {
    if (r.status === 204) return { status: r.status, value: null };
    const text = await r.text();
    let j = null, invalid = false; try { j = text ? JSON.parse(text) : null; } catch { invalid = true; }
    // (reset: when the rate limit opens again, in seconds — lib/rescue.mjs says how long to wait)
    if (!r.ok) { const e = new GhError(r.status, explain(r.status, j?.message ?? text.slice(0, 120)), path); e.reset = Number(r.headers?.get?.('x-ratelimit-reset')) || null; throw e; }
    if (invalid) { const e = new GhError(502, 'GitHub の応答を読めませんでした。時間をおいて読み直してください。', path); e.invalidResponse = true; throw e; }
    return { status: r.status, value: j };
  }
  // (a repository whose variables GitHub refused this token once — 403: the sign-in lacks Variables — is not asked again: the
  // same answer, no request, no error in the browser's console every few seconds)
  const noVars = new Map();
  async function vars(r, method, rest, body) {
    if (noVars.has(r)) throw noVars.get(r);
    try { return await call(method, `/repos/${r}/actions/variables${rest}`, body); } catch (e) { if (e.status === 403) noVars.set(r, e); throw e; }
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
    /** a workflow turned on or off (a fork's start off: disabled_fork) */
    enableWorkflow: (r, id) => call('PUT', `/repos/${r}/actions/workflows/${encodeURIComponent(id)}/enable`),
    disableWorkflow: (r, id) => call('PUT', `/repos/${r}/actions/workflows/${encodeURIComponent(id)}/disable`),
    /** a fork's branch brought up to its parent's (GitHub's 「Sync fork」) */
    syncFork: (r, branch) => call('POST', `/repos/${r}/merge-upstream`, { branch }),
    /** the commits that changed a file, the newest first (who changed the policy and when) */
    commits: (r, { path, per = 10 } = {}) => call('GET', `/repos/${r}/commits?per_page=${per}${path ? `&path=${encodeURIComponent(path)}` : ''}`),
    /** the repository's forks, the newest first (up to 100) */
    forks: (r) => call('GET', `/repos/${r}/forks?sort=newest&per_page=100`),
    /** someone made a collaborator (invited; on an organization's repository with that role, on a person's with write) */
    addCollaborator: (r, login, permission = 'push') => call('PUT', `/repos/${r}/collaborators/${encodeURIComponent(login)}`, { permission }),
    /** the invitations to repositories this person has not taken yet, and one taken */
    myInvitations: () => call('GET', '/user/repository_invitations?per_page=100'),
    acceptInvitation: (id) => call('PATCH', `/user/repository_invitations/${encodeURIComponent(id)}`),
    /** a GitHub App as GitHub shows it to anyone: { slug, permissions, … } */
    app: (slug) => call('GET', `/apps/${encodeURIComponent(slug)}`),
    /** the secrets' names (never their values: GitHub gives none) → [names], null when this token may not look */
    async secretNames(r) { try { return ((await call('GET', `/repos/${r}/actions/secrets?per_page=100`)).secrets ?? []).map((s) => s.name); } catch (e) { if (e.status === 403 || e.status === 404) return null; throw e; } },
    secrets: async (r) => (await call('GET', `/repos/${r}/actions/secrets?per_page=100`)).secrets ?? [],
    /** a secret set: sealed here with the repository's public key, so only GitHub's Actions can open it */
    async putSecret(r, name, value, opts) { const k = await call('GET', `/repos/${r}/actions/secrets/public-key`); return call('PUT', `/repos/${r}/actions/secrets/${encodeURIComponent(name)}`, secretPayload(value, k, opts)); },
    deleteSecret: (r, name) => call('DELETE', `/repos/${r}/actions/secrets/${encodeURIComponent(name)}`),
    /** a run's artifacts, or the repository's newest (expired ones too: GitHub keeps their names) */
    artifacts: async (r, { run, per = 30 } = {}) => (await call('GET', `/repos/${r}/actions/${run ? `runs/${run}/` : ''}artifacts?per_page=${per}`)).artifacts ?? [],
    /** the repository variables' names → [names], null when this token may not look */
    async variableNames(r) { try { return ((await vars(r, 'GET', '?per_page=30')).variables ?? []).map((v) => v.name); } catch (e) { if (e.status === 403 || e.status === 404) return null; throw e; } },
    /** a repository variable's value: null when it is not set (403: this token may not read variables) */
    async variable(r, name) { try { return (await vars(r, 'GET', `/${encodeURIComponent(name)}`)).value ?? null; } catch (e) { if (e.status === 404) return null; throw e; } },
    /** a repository variable set (made when it is not there yet) */
    async setVariable(r, name, value) {
      try { return await vars(r, 'PATCH', `/${encodeURIComponent(name)}`, { name, value }); }
      catch (e) { if (e.status === 404) return vars(r, 'POST', '', { name, value }); throw e; }
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
    /** one issue as it is now: { number, state, comments (how many), locked, … } */
    issue: (r, n) => call('GET', `/repos/${r}/issues/${encodeURIComponent(n)}`),
    /** an issue locked, no reason given: only the repository's collaborators may comment on it */
    lockIssue: (r, n) => call('PUT', `/repos/${r}/issues/${encodeURIComponent(n)}/lock`),
    closeIssue: (r, n) => call('PATCH', `/repos/${r}/issues/${encodeURIComponent(n)}`, { state: 'closed' }),
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
