// panic: the emergency stop worked out — which runs to cancel and which workflows to turn off so nothing starts by itself
// (a schedule, a push, an issue, another run's end: every trigger but a person's own start), and what is kept going with
// the reason (pages.yml: the panel itself; a workflow already off; one started only by hand; one whose file could not be
// read). And the way back: only the workflows the stop turned off, turned on again. Pure: no DOM, no fetch, no storage.

/** the workflows never turned off (and whose runs are never cancelled): the file name → why, in words */
export const KEEP_FILES = Object.freeze({ 'pages.yml': 'パネルを公開するしくみです（止めると、この画面を直して出し直せなくなります）' });
/** the triggers a person starts by hand (or another workflow calls): every other one starts a workflow by itself */
export const MANUAL = Object.freeze(['workflow_dispatch', 'workflow_call']);
/** the states of a run that is still going (or waiting to) */
export const LIVE = Object.freeze(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

const fileOf = (p) => String(p ?? '').split('@')[0].split('/').pop();
const noComment = (s) => String(s).replace(/\s+#.*$/, '').trim();
const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');
/** the keys at the top of a YAML flow mapping's text, `{ a: …, b: { … } }` → ['a', 'b'] */
function flowKeys(s) {
  const inner = s.trim().replace(/^\{/, '').replace(/\}$/, ''), out = [];
  let depth = 0, part = '';
  for (const ch of `${inner},`) {
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { const k = /^\s*([^:]+?)\s*(:|$)/.exec(part); if (k && k[1].trim()) out.push(unquote(k[1])); part = ''; } else part += ch;
  }
  return out;
}

/** a workflow file's text → the names of its triggers (`on:`), e.g. ['schedule', 'workflow_dispatch']; null when no `on:`
 *  is found (pure). Takes `on: push`, `on: [push, issues]`, `on: { push: … }` and the block form */
export function triggersOf(yaml) {
  const lines = String(yaml ?? '').replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^(on|"on"|'on')\s*:/.test(l));
  if (at < 0) return null;
  const rest = noComment(lines[at].replace(/^(on|"on"|'on')\s*:/, ''));
  if (rest.startsWith('[')) return rest.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  if (rest.startsWith('{')) return flowKeys(rest);
  if (rest) return [unquote(rest)];
  const out = [];
  let indent = null;
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const n = l.length - l.trimStart().length;
    if (n === 0) break;
    indent ??= n;
    if (n !== indent) continue;
    const k = /^\s*-\s*(.+)$/.exec(l) ?? /^\s*([^:#]+?)\s*:/.exec(l);
    if (k) out.push(unquote(noComment(k[1])));
  }
  return out;
}

/** what the stop would do (pure). runs: GitHub's workflow runs (those not going are passed over); workflows: GitHub's
 *  workflows, each with `triggers` (triggersOf's answer; null or missing: its file could not be read) →
 *  { cancel: [run ids], disable: [workflow ids], keep: [{ kind: 'run' | 'workflow', id, name, why }] } */
export function plan(runs = [], workflows = []) {
  const cancel = [], disable = [], keep = [];
  const kept = new Map();
  for (const w of workflows ?? []) {
    const file = fileOf(w.path), name = file || String(w.name ?? w.id);
    const k = (why) => { keep.push({ kind: 'workflow', id: w.id, name, why }); };
    if (KEEP_FILES[file]) { kept.set(w.id, KEEP_FILES[file]); k(KEEP_FILES[file]); continue; }
    if (!String(w.path ?? '').startsWith('.github/workflows/')) { k('GitHub が用意したしくみです（ここからは止められません）'); continue; }
    if (w.state && w.state !== 'active') { k('もう止まっています'); continue; }
    if (!Array.isArray(w.triggers)) { k('ファイルを読めなかったので、自動で始まるか分かりません（GitHub で確かめてください）'); continue; }
    if (!w.triggers.some((t) => !MANUAL.includes(t))) { k('人が始めたときだけ動きます（自動では始まりません）'); continue; }
    disable.push(w.id);
  }
  for (const r of runs ?? []) {
    if (!LIVE.includes(r.status)) continue;
    const why = kept.get(r.workflow_id) ?? KEEP_FILES[fileOf(r.path)];
    if (why) { keep.push({ kind: 'run', id: r.id, name: r.display_title ?? r.name ?? String(r.id), why }); continue; }
    cancel.push(r.id);
  }
  return { cancel, disable, keep };
}

/** the way back (pure). record: what the stop kept — { disabled: [{ id, name }] } (or the ids alone); workflows: GitHub's
 *  workflows as they are now (none given: all of them are turned on again) → { enable: [ids], skip: [{ id, name, why }] }.
 *  Only what the stop turned off is ever turned on */
export function restorePlan(record, workflows = null) {
  const list = (Array.isArray(record) ? record : record?.disabled ?? []).map((x) => (typeof x === 'object' && x !== null ? x : { id: x, name: String(x) }));
  const now = workflows ? new Map(workflows.map((w) => [String(w.id), w])) : null;
  const enable = [], skip = [], seen = new Set();
  for (const x of list) {
    if (x.id === undefined || x.id === null || seen.has(String(x.id))) continue;
    seen.add(String(x.id));
    const w = now?.get(String(x.id));
    if (now && !w) { skip.push({ id: x.id, name: x.name, why: 'もうありません（消されました）' }); continue; }
    if (w?.state === 'active') { skip.push({ id: x.id, name: x.name, why: 'もう動いています' }); continue; }
    enable.push(x.id);
  }
  return { enable, skip };
}
