// debug: what the panel did on this device, to find a fault right after a change — the last GitHub calls (method, path,
// status, time: never a token, a body or an answer), the page's errors, and whether this page is the newest the lab
// published (config.json's version against pages.yml's last run). A report to paste anywhere is built from these with
// anything shaped like a token taken out. No DOM, no node:.

const TOKENISH = /gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]+|-----BEGIN[^]*?-----END[^-]*-----|lab-sealed:\S+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]*/g;
/** text with anything shaped like a token, a key or a sealed value replaced (pure) */
export const redact = (s) => String(s ?? '').replace(TOKENISH, '[消しました]');

/** a ring of the last `max` entries: add(x) → x with its time; list() newest first; errors() the failed ones */
export function debugLog(max = 60, now = () => Date.now()) {
  const a = [];
  return {
    add(x) { const e = { at: now(), ...x }; a.push(e); if (a.length > max) a.shift(); return e; },
    list: () => [...a].reverse(),
    errors: () => [...a].reverse().filter((e) => e.kind === 'error' || e.status === 0 || e.status >= 400),
    clear: () => { a.length = 0; },
  };
}

/** this page's version against the lab's pages.yml runs, newest first (pure) → { state, say }:
 *  live (built from the last published commit) · deploying (a newer one is being published) · newer (published: read again) ·
 *  failed (the newest publishing failed) · unknown */
export function versionState(page, runs = []) {
  const short = (s) => String(s ?? '').slice(0, 7);
  if (!page) return { state: 'unknown', say: 'このページの版は分かりません（手元か、版を書かない古い pages.yml）' };
  const last = runs[0];
  if (!last) return { state: 'unknown', say: `このページ: ${short(page)}（pages.yml の実行が見えません）` };
  if (last.head_sha === page) return { state: 'live', say: `このページ: ${short(page)}（いちばん新しい版）` };
  if (last.status !== 'completed') return { state: 'deploying', say: `新しい版 ${short(last.head_sha)} を出しています（このページ: ${short(page)}）` };
  if (last.conclusion === 'success') return { state: 'newer', say: `新しい版 ${short(last.head_sha)} が出ています: 読み直すと使えます（このページ: ${short(page)}）` };
  return { state: 'failed', say: `新しい版 ${short(last.head_sha)} を出すのに失敗しました（${last.conclusion}）: pages.yml を見てください（このページ: ${short(page)}）` };
}

/** the report to paste (pure): where, who in which role, the version, the newest errors and calls — tokens taken out */
export function report({ version = null, versionSay = '', url = '', agent = '', login = '', kind = '', lab = '', role = '', tab = '', remaining = null, log }) {
  const t = (ms) => new Date(ms).toISOString().slice(11, 19);
  const line = (e) => (e.kind === 'error' ? `${t(e.at)} ✘ ${e.message}${e.where ? ` (${e.where})` : ''}` : `${t(e.at)} ${e.status === 0 ? '✘ 届かない' : e.status >= 400 ? `✘ ${e.status}` : e.status} ${e.method} ${e.path} ${e.ms} ms`);
  return redact([
    'bds-lab 管理パネル: デバッグ',
    `版: ${version ?? '?'}${versionSay ? `（${versionSay}）` : ''}`,
    `ページ: ${String(url).split('#')[0]}`, `ブラウザ: ${agent}`,
    `アカウント: ${login || '?'}（${kind === 'oauth' ? 'GitHub でサインイン' : kind ? 'トークン' : '?'}）・ラボ ${lab || '?'}・役割 ${role || '?'}・タブ ${tab || '?'}・GitHub の残り ${remaining ?? '?'}`,
    '', 'エラー:', ...(log.errors().slice(0, 15).map(line)), ...(log.errors().length ? [] : ['（なし）']),
    '', '最近の呼び出し:', ...log.list().filter((e) => e.kind !== 'error').slice(0, 25).map(line),
  ].join('\n'));
}
