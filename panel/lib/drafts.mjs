// drafts (the editor's 「下書き」, ui/workspace.mjs editorView): the text of a file being changed kept in the browser's own storage,
// so a lost connection or a closed tab does not lose it. Pure: the storage is given (localStorage's shape: getItem / setItem /
// removeItem / key / length) — never a DOM, never a request. One draft per account + lab + unit + path; up to 1 MB each; one
// that is 30 days old is forgotten; a file that looks secret (.env, keys, tokens) is never kept.
export const PREFIX = 'bdslab.draft:';
export const MAX_BYTES = 1_000_000;
export const MAX_AGE = 30 * 24 * 3600 * 1000;
export const WAIT = 1000;

/** the key of a draft: account · lab · unit · path (any of them empty: no key, null) */
export function draftKey({ account, slug, unit, path } = {}) {
  const p = [account, slug, unit, path].map((x) => String(x ?? '').trim());
  return p.some((x) => !x) ? null : PREFIX + p.map(encodeURIComponent).join('|');
}
/** a path that holds secrets by its name (pure): .env, keys, tokens, credentials */
export const isSecretPath = (path) => /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore)|id_(rsa|ed25519|ecdsa)|\.npmrc|\.netrc|([^/]*[_.-])?(secrets?|credentials?|tokens?|passwords?)(\.(json|txt|ya?ml|ini|cfg|toml|env))?)$/i.test(String(path ?? ''));
/** a text that holds a secret by its look (GitHub / Discord / Anthropic / private-key shapes) */
export const looksSecret = (text) => /(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(String(text ?? ''));
const bytes = (s) => new TextEncoder().encode(String(s)).length;
/** the browser's storage, or null (private mode, blocked) */
export function browserStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }

/** a draft kept → { ok: true } | { ok: false, why } (the why is in words) */
export function saveDraft(storage, key, { text, baseSha = null, path = '', now = Date.now() } = {}) {
  if (!storage) return { ok: false, why: 'このブラウザには下書きを置く場所がありません' };
  if (!key) return { ok: false, why: '下書きの置き場所が決まりません（ログインとユニットを確かめてください）' };
  if (isSecretPath(path)) return { ok: false, why: '秘密を含みそうなファイルなので、下書きは残しません' };
  if (looksSecret(text)) return { ok: false, why: '秘密のような文字列が入っているので、下書きは残しません' };
  if (bytes(text) > MAX_BYTES) return { ok: false, why: '1 MB を超える下書きは残せません' };
  try { storage.setItem(key, JSON.stringify({ text: String(text), baseSha, at: now })); } catch { return { ok: false, why: 'ブラウザの保存場所がいっぱいです: 古い下書きを捨ててください' }; }
  return { ok: true };
}
/** the draft → { text, baseSha, at } | null (none, broken or older than 30 days: forgotten) */
export function loadDraft(storage, key, now = Date.now()) {
  if (!storage || !key) return null;
  let d = null; try { d = JSON.parse(storage.getItem(key) ?? 'null'); } catch { /* broken: dropped below */ }
  if (d && typeof d.text === 'string' && Number.isFinite(d.at) && now - d.at <= MAX_AGE) return { text: d.text, baseSha: d.baseSha ?? null, at: d.at };
  if (storage.getItem(key) !== null) dropDraft(storage, key);
  return null;
}
export function dropDraft(storage, key) { try { if (storage && key) storage.removeItem(key); } catch { /* nothing to drop */ } }
/** every draft → [{ key, account, slug, unit, path, bytes, at }] newest first (the old ones dropped on the way) */
export function listDrafts(storage, now = Date.now()) {
  if (!storage) return [];
  const keys = []; for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
  const out = [];
  for (const key of keys) {
    const d = loadDraft(storage, key, now); if (!d) continue;
    const [account, slug, unit, path] = key.slice(PREFIX.length).split('|').map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
    out.push({ key, account, slug, unit, path, bytes: bytes(d.text), at: d.at });
  }
  return out.sort((a, b) => b.at - a.at);
}
/** 「いつ」 in words: 3 分前 / 2 時間前 / 5 日前 */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? 'たった今' : s < 3600 ? `${Math.floor(s / 60)} 分前` : s < 86400 ? `${Math.floor(s / 3600)} 時間前` : `${Math.floor(s / 86400)} 日前`;
}
/** the draft is of an older file than GitHub has now (the file was changed on GitHub after the draft was made) */
export const staleDraft = (draft, sha) => Boolean(draft?.baseSha && sha && draft.baseSha !== sha);

/** keystrokes gathered into one save a second: push(key, {text, baseSha, path}) → later saveDraft; flush() saves now;
 *  cancel() forgets what waits. timers: { set, clear } for a test. onSaved(result) hears each save. */
export function draftSaver(storage, { wait = WAIT, timers = {}, onSaved = null } = {}) {
  const set = timers.set ?? ((f, ms) => setTimeout(f, ms)), clear = timers.clear ?? ((t) => clearTimeout(t));
  let timer = null, pending = null;
  const flush = () => {
    if (timer !== null) { clear(timer); timer = null; }
    if (!pending) return null;
    const { key, ...d } = pending; pending = null;
    const r = saveDraft(storage, key, d); onSaved?.(r); return r;
  };
  return {
    push(key, d) { pending = { key, ...d }; if (timer !== null) clear(timer); timer = set(() => { timer = null; flush(); }, wait); },
    flush,
    cancel() { if (timer !== null) { clear(timer); timer = null; } pending = null; },
    get waiting() { return pending !== null; },
  };
}
