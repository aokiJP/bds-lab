// secretmap (the 「秘密」 tab): which workflow uses which secret, read from the workflow files' own text (${{ secrets.NAME }} and
// ${{ secrets['NAME'] }}), so a secret nobody uses and a secret a workflow needs but the lab lacks both show (pure: no DOM,
// no network). The values are never read — GitHub gives none; only the names.

// (GITHUB_TOKEN is GitHub's own, made for every run: it is neither "missing" nor "unused")
export const BUILTIN = ['GITHUB_TOKEN'];
const DOT = /\bsecrets\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const BRACKET = /\bsecrets\s*\[\s*(?:'([^']+)'|"([^"]+)")\s*\]/g;

/** one workflow file's text → the secret names it reads, in order of first use (comment lines are not code) */
export function namesIn(text) {
  const code = String(text ?? '').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'), seen = new Set();
  for (const m of code.matchAll(DOT)) seen.add(m[1]);
  for (const m of code.matchAll(BRACKET)) seen.add(m[1] ?? m[2]);
  return [...seen];
}

/** workflows [{ path, text }] and the lab's secrets [{ name }] (or names; null = may not look) →
 *  { byWorkflow: [{ path, secrets, builtin }], bySecret: { NAME: [paths] }, unused: [names], missing: [{ name, paths }],
 *    known } — known is false when the secrets' names could not be read (then nothing is called unused or missing). Pure */
export function usage(workflows, secrets) {
  const known = Array.isArray(secrets), have = new Set();
  for (const s of known ? secrets : []) { const n = typeof s === 'string' ? s : s?.name; if (typeof n === 'string' && n) have.add(n); }
  const byWorkflow = [], bySecret = {};
  for (const w of Array.isArray(workflows) ? workflows : []) {
    if (!w || typeof w.path !== 'string') continue;
    const all = namesIn(w.text);
    byWorkflow.push({ path: w.path, secrets: all.filter((n) => !BUILTIN.includes(n)), builtin: all.some((n) => BUILTIN.includes(n)) });
    for (const n of all) if (!BUILTIN.includes(n)) (bySecret[n] ??= []).push(w.path);
  }
  byWorkflow.sort((a, b) => (a.path < b.path ? -1 : 1));
  const unused = known ? [...have].filter((n) => !bySecret[n]).sort() : [];
  const missing = known ? Object.keys(bySecret).filter((n) => !have.has(n)).sort().map((name) => ({ name, paths: bySecret[name] })) : [];
  return { byWorkflow, bySecret, unused, missing, known };
}
