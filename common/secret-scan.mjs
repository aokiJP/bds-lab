// What must never leave this machine in a file: API keys, tokens, webhooks, private keys, and the person's own secrets as
// written in .env / .env.local (whatever their shape). Used by `share` (a release that does not pass is not written) and by
// `maint` (the leaks check). Placeholders (.env.example's `sk-ant-...`, `<token>`, xxxx) do not count.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{24,}/],
  ['OpenAI API key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{12,}/],
  ['Slack webhook', /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/],
  ['Discord webhook', /discord(?:app)?\.com\/api\/webhooks\/\d{10,}\/[A-Za-z0-9_-]{30,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Google token', /\b(?:aas_et\/[A-Za-z0-9_-]{20,}|oauth2_4\/[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9_-]{30,})/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{34,}\b/],
  ['Stripe key', /\b[rs]k_live_[A-Za-z0-9]{24,}/],
  ['Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/],
];
const PLACEHOLDER = /^(?:x+|\.{3}|<[^>]*>|your[-_ ].*|changeme|example.*|dummy.*|test|k|none|true|false|on|off|\d{1,6}|https?:\/\/[^/]*\/?)$/i;
// the person's secret values: from .env / .env.local, the keys whose names say secret (and any long value at all)
export function ownSecrets(top) {
  const vals = new Set();
  for (const f of ['.env', '.env.local']) {
    let t = ''; try { t = fs.readFileSync(path.join(top, f), 'utf8'); } catch { continue; }
    for (const l of t.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/.exec(l); if (!m) continue;
      const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (v.length < 8 || PLACEHOLDER.test(v)) continue;
      if (/KEY|TOKEN|SECRET|PASS|WEBHOOK|EMAIL|USER|TOTP|COOKIE|AUTH/i.test(m[1]) || v.length >= 24) vals.add(v);
    }
  }
  return [...vals];
}
const TEXT = /\.(m?js|cjs|ts|json|jsonl|md|txt|ya?ml|sh|command|cmd|py|toml|lua|ini|html|css|cfg|properties|lang|example)$|(^|\/)[^.]+$/;
// text: the file's text (or null for binary). Returns [{what, line}] (the secret itself is never printed)
export function findIn(text, own = []) {
  const hits = [];
  if (text === null) return hits;
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    if (l.length > 20000) l = l.slice(0, 20000);
    for (const [what, re] of PATTERNS) if (re.test(l)) hits.push({ what, line: i + 1 });
    for (const v of own) if (l.includes(v)) hits.push({ what: 'a value from your .env', line: i + 1 });
    const home = os.homedir();
    if (home && home.length > 6 && !/^\/(root|home)\/?$/.test(home) && l.includes(home)) hits.push({ what: `your home folder path (${path.basename(home)})`, line: i + 1, warn: true });
  });
  return hits;
}
export const isText = (rel, buf) => TEXT.test(rel) && buf.length < 4e6 && !buf.subarray(0, 8000).includes(0);
// files: [[rel, Buffer]] → [{rel, what, line, warn?}]. anyText: every small file that is text whatever its name (what goes to
// someone else's machine: a unit's .mcfunction or .lang can hold a key as well as a .js)
export function scan(files, top, { anyText = false } = {}) {
  const own = ownSecrets(top), out = [];
  for (const [rel, buf] of files) {
    if (/(^|\/)\.env\.example$/.test(rel)) { for (const h of findIn(buf.toString('utf8'), own)) if (h.what === 'a value from your .env') out.push({ rel, ...h }); continue; }
    if (!(anyText ? buf.length < 4e6 && !buf.subarray(0, 8000).includes(0) : isText(rel, buf))) continue;
    for (const h of findIn(buf.toString('utf8'), own)) out.push({ rel, ...h });
  }
  return out;
}
