// livefmt: the live issue's lines as the panel writes and reads them — the same as app/lib/live.mjs on the runner
// (`lab@<run> <commands>` in, `lab-reply@<run> #<id>` out with the text in a code block and the screen as a PNG in an HTML
// comment; in a repository that is not private both sealed with the vault key: lib/vault.mjs). tests/panel-offline.mjs
// holds the two sides to each other.
import { SEALED, sealText, openText } from './vault.mjs';
export const ISSUE_TITLE = 'app live: 実機をそのまま調べる（ラボが使います）';
const digits = (run) => String(run).replace(/\D/g, '');
/** commands → the comment to post; null when the repository is public and there is no key (nothing may be written plain) */
export async function commandBody(run, text, { isPublic, key } = {}) {
  if (!isPublic) return `lab@${digits(run)} ${text}`;
  return key ? `lab@${digits(run)} ${await sealText(text, key)}` : null;
}
async function unseal(rest, { isPublic, key }) {
  const t = String(rest ?? '').trim();
  if (t.startsWith(SEALED)) return openText(t.split(/\s/)[0], key);
  return isPublic ? null : String(rest ?? '');
}
/** a reply comment → { id, text, png (base64 or null) } for that run; null when it is not its reply or does not open */
export async function replyParts(body, run, opts = {}) {
  const m = new RegExp(`^lab-reply@${digits(run)} #(\\d+)\\n`).exec(String(body ?? ''));
  if (!m) return null;
  const rest = await unseal(String(body).slice(m[0].length), opts);
  if (rest === null) return { id: Number(m[1]), text: null, png: null };
  const png = /<!--png:([A-Za-z0-9+/=]+)-->/.exec(rest)?.[1] ?? null;
  return { id: Number(m[1]), text: rest.replace(/<!--png:[^>]*-->/g, '').replace(/^```\n?|\n?```\s*$/g, '').trim(), png };
}
/** a `lab-live@<run> …` line (the run's own news: waiting, ended, a sign-in step) → its text, null when not that run's */
export async function tellText(body, run, opts = {}) {
  const m = new RegExp(`^lab-live@${digits(run)} ([\\s\\S]*)$`).exec(String(body ?? ''));
  if (!m) return null;
  return m[1].trim().startsWith(SEALED) ? unseal(m[1], opts) : m[1];
}
/** the live issue among a repository's open issues → its number, or null */
export const liveIssue = (issues) => (issues ?? []).find((x) => x.title === ISSUE_TITLE && !x.pull_request)?.number ?? null;
