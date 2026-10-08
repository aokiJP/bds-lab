// gh: GitHub's REST API from the browser with the person's own token (fine-grained: only the repositories and permissions
// they chose). Nothing else is ever called: the panel's page allows no other address (its CSP's connect-src). GitHub decides
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
  async function call(method, path, body) {
    const r = await fetchImpl(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
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
    issues: (r) => call('GET', `/repos/${r}/issues?state=open&per_page=100`),
    comments: (r, n, since) => call('GET', `/repos/${r}/issues/${n}/comments?per_page=100${since ? `&since=${encodeURIComponent(since)}` : ''}`),
    comment: (r, n, body) => call('POST', `/repos/${r}/issues/${n}/comments`, { body }),
  };
  return self;
}
