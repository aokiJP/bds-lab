// accounts: the GitHub accounts that use the panel in this browser — each with its own token and its own settings (its lab,
// its hosts, how often to look again, its vault key): the author, a lender, a borrower on one phone, switched in a tap. One is
// in use at a time: its token is the only one that talks to GitHub, its settings the only ones read. A remembered account
// lives in localStorage; one not remembered only in this tab (sessionStorage) — its entry, token and settings alike, so a
// shared device forgets it with the tab. An account comes in one of two ways: 'token' (a token typed in) or 'oauth'
// (「GitHub でサインイン」 through the GitHub App: a token that runs out, kept with its refresh token beside it — lib/session.mjs
// renews it). Pure but for the two storages handed in (tests pass plain objects).
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** settings as stored → settings to use (pure): the lab, the hosts (owner/repo only), refresh 5〜600 s, the vault key */
export function cleanCfg(c = {}, defaults = {}) {
  const lab = SLUG.test(String(c.lab ?? '')) ? c.lab : defaults.lab ?? null;
  const hosts = [...new Set((Array.isArray(c.hosts) ? c.hosts : []).filter((h) => SLUG.test(String(h))))];
  const r = Number(c.refresh), refresh = Number.isFinite(r) ? Math.min(600, Math.max(5, Math.round(r))) : 20;
  return { lab, hosts, refresh, vault: typeof c.vault === 'string' ? c.vault : '' };
}
/** how an account signed in, as stored → as used (pure): 'oauth' with its expiry (ms) and refresh token, or 'token' */
export function cleanSession(s = {}) {
  const at = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  if (s?.kind !== 'oauth') return { kind: 'token', expiresAt: null, refresh: null, refreshExpiresAt: null };
  return { kind: 'oauth', expiresAt: at(s.expiresAt), refresh: typeof s.refresh === 'string' && /^[\x21-\x7e]{1,2048}$/.test(s.refresh) ? s.refresh : null, refreshExpiresAt: at(s.refreshExpiresAt) };
}
/** a plain object as a Storage (tests, and a browser that refuses storage: the panel still works for the tab) */
export const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null }; };

/** → { list, get, active, use, token, session, setTokens, cfg, setCfg, add, remove, legacy, dropLegacy } over localStorage and
 *  sessionStorage */
export function accounts({ local, session, prefix = 'bdslab.panel.', defaults = {} } = {}) {
  const K = (k) => prefix + k;
  const read = (s, k, d) => { try { const v = s.getItem(K(k)); return v === null ? d : JSON.parse(v); } catch { return d; } };
  const write = (s, k, v) => { try { s.setItem(K(k), JSON.stringify(v)); } catch { /* storage full or refused */ } };
  const drop = (s, k) => { try { s.removeItem(K(k)); } catch { /* refused */ } };
  const entries = (s) => (Array.isArray(read(s, 'accounts', [])) ? read(s, 'accounts', []) : []).filter((e) => LOGIN.test(String(e?.login ?? '')));
  /** where an account lives: localStorage when remembered, else this tab's sessionStorage */
  const home = (login) => (entries(session).some((e) => e.login === login) ? session : entries(local).some((e) => e.login === login) ? local : null);
  const self = {
    /** every account here: [{ login, avatar, remember, at }] (remembered ones first, in the order they were added) */
    list: () => [...entries(local).map((e) => ({ ...e, remember: true })), ...entries(session).filter((e) => !entries(local).some((x) => x.login === e.login)).map((e) => ({ ...e, remember: false }))],
    get: (login) => self.list().find((e) => e.login === login) ?? null,
    /** the account in use: this tab's choice, else the browser's last, else the first */
    active() { const all = self.list(), want = read(session, 'active', null) ?? read(local, 'active', null); return all.find((e) => e.login === want)?.login ?? all[0]?.login ?? null; },
    use(login) { if (!self.get(login)) return false; write(session, 'active', login); if (home(login) === local) write(local, 'active', login); return true; },
    token: (login) => { const s = home(login); return s ? read(s, `tok.${login}`, null) : null; },
    /** how it signed in: { kind, expiresAt, refresh, refreshExpiresAt } (kept where its token is), null for no such account */
    session: (login) => { const s = home(login); return s ? cleanSession(read(s, `ses.${login}`, {})) : null; },
    /** its tokens renewed (an 'oauth' account after a refresh): the token, and how long it and its refresh token last → done */
    setTokens(login, { token, expiresAt = null, refresh = null, refreshExpiresAt = null } = {}) {
      const s = home(login);
      if (!s || !token) return false;
      write(s, `tok.${login}`, token);
      write(s, `ses.${login}`, cleanSession({ kind: self.session(login).kind, expiresAt, refresh, refreshExpiresAt }));
      return true;
    },
    cfg: (login) => { const s = home(login); return cleanCfg(s ? read(s, `cfg.${login}`, {}) : {}, defaults); },
    setCfg(login, patch) { const s = home(login); if (!s) return null; const c = cleanCfg({ ...self.cfg(login), ...patch }, defaults); write(s, `cfg.${login}`, c); return c; },
    /** an account added or signed in again (its token replaced; its settings kept unless given) → its login. kind 'oauth':
     *  signed in with GitHub (lib/session.mjs fromHandoff: expiresAt, refresh, refreshExpiresAt); 'token': typed in */
    add({ login, avatar = '', token, remember = true, cfg = null, kind = 'token', expiresAt = null, refresh = null, refreshExpiresAt = null }) {
      if (!LOGIN.test(String(login ?? '')) || !token) throw new Error('アカウントの名前とトークンが要ります');
      const was = home(login), keep = was ? read(was, `cfg.${login}`, {}) : {};
      if (was) self.remove(login, { keepActive: true });
      const s = remember ? local : session;
      write(s, 'accounts', [...entries(s).filter((e) => e.login !== login), { login, avatar: /^https:\/\//.test(String(avatar)) ? avatar : '', at: new Date().toISOString() }]);
      write(s, `tok.${login}`, token);
      write(s, `cfg.${login}`, cleanCfg({ ...keep, ...(cfg ?? {}) }, defaults));
      if (kind === 'oauth') write(s, `ses.${login}`, cleanSession({ kind, expiresAt, refresh, refreshExpiresAt }));
      self.use(login);
      return login;
    },
    /** an account forgotten by this browser: its token, refresh token and settings gone (GitHub is not told here: a token
     *  stays valid until it is revoked — lib/session.mjs logout does that for a signed-in one) → the account now in use */
    remove(login, { keepActive = false } = {}) {
      for (const s of [local, session]) { write(s, 'accounts', entries(s).filter((e) => e.login !== login)); drop(s, `tok.${login}`); drop(s, `cfg.${login}`); drop(s, `ses.${login}`); }
      if (!keepActive) for (const s of [local, session]) if (read(s, 'active', null) === login) drop(s, 'active');
      return self.active();
    },
    /** the panel's settings from before accounts (one token, keys without a login): { token, remember, cfg } or null */
    legacy() {
      // (this tab's token was kept as it is, not as JSON)
      const raw = (() => { try { return session.getItem(K('token')); } catch { return null; } })();
      const st = raw === null ? null : read(session, 'token', raw), lt = read(local, 'token', null), token = typeof st === 'string' && st ? st : lt;
      if (!token) return null;
      return { token, remember: Boolean(lt), cfg: cleanCfg({ lab: read(local, 'lab', null), hosts: read(local, 'hosts', []), refresh: read(local, 'refresh', 20), vault: read(local, 'vault', '') }, defaults) };
    },
    dropLegacy() { for (const s of [local, session]) for (const k of ['token', 'lab', 'hosts', 'refresh', 'vault']) drop(s, k); },
  };
  return self;
}
