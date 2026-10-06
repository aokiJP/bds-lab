// bench friction: where did the AIs lose steps and tokens? Reads agent transcripts (Claude Code sessions, the lab's own make
// logs) and ranks what cost turns without moving the work: failed go/test runs (by their first failure line), reads of files
// AGENTS.md already covers, doc lookups, shell edits, tool errors, blocked commands, repeats. The input for improving
// AGENTS.md / help / error messages, and the check afterwards (same command, fewer rows).
//   node bench/bench.mjs friction [n | all | <transcript.jsonl> ...]   (default: the newest 10 runs with a transcript)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tok = (chars) => Math.ceil(chars / 4);
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? (typeof x.content === 'string' ? x.content : '')).join('\n') : '');
function entries(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
// the lab's own record of a bench run (<run>/<lab>/.lab/trace.jsonl: every lab command, ok, the first problem line): any AI, no transcript
function traceSteps(file) {
  const st = entries(file).map((e) => ({ name: 'lab', input: { args: (e.argv ?? []).join(' ') }, result: e.ok ? 'DONE (trace)' : e.why ?? 'FAIL', error: false }));
  return { steps: st, usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, turns: 0 } };
}
// a transcript as steps: { name, input, result, error, usage (of the assistant message that asked) }
export function steps(file) {
  if (/trace\.jsonl$/.test(file)) return traceSteps(file);
  const out = [], byId = new Map();
  let usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  const seenMsg = new Set();
  for (const e of entries(file)) {
    const m = e.message ?? {};
    if ((e.type === 'assistant' || m.role === 'assistant') && Array.isArray(m.content)) {
      const u = m.usage;
      if (u && !seenMsg.has(m.id ?? e.uuid)) { seenMsg.add(m.id ?? e.uuid); usage.in += u.input_tokens ?? 0; usage.out += u.output_tokens ?? 0; usage.cacheRead += u.cache_read_input_tokens ?? 0; usage.cacheWrite += u.cache_creation_input_tokens ?? 0; usage.turns++; }
      for (const c of m.content) if (c.type === 'tool_use') { const s = { name: c.name, input: c.input ?? {}, result: '', error: false }; byId.set(c.id, s); out.push(s); }
    } else if (Array.isArray(m.content)) {
      for (const c of m.content) if (c.type === 'tool_result' && byId.has(c.tool_use_id)) { const s = byId.get(c.tool_use_id); s.result = text(c.content); s.error = !!c.is_error; }
    }
  }
  return { steps: out, usage };
}
const OWN = /(src\/main\.ts|tests\.txt|TASK\.md|plugin\.py|manifest\.json|pyproject\.toml)$/;
// one step → [category, detail] (null = ordinary work)
export function classify(s) {
  const cmd = s.name === 'Bash' || s.name === 'lab' ? String(s.input.command ?? `node lab.mjs ${s.input.args ?? ''}`) : '';
  const r = s.result ?? '';
  if (/requires approval|was blocked|permission to use|not allowed/i.test(r)) return ['blocked command', cmd.slice(0, 80)];
  const lab = /node lab\.mjs\s+(?:(?:bds|end|ll)\s+)?([\w-]+)/.exec(cmd)?.[1] ?? (s.name === 'do' ? 'do' : null);
  if (lab && ['go', 'test', 'qa'].includes(lab)) {
    if (/^DONE |^PASS (\d|qa)/m.test(r) && !/^FAIL/m.test(r)) return null;
    const first = r.split('\n').find((l) => /^(✘|E |Q |FAIL|ERR)/.test(l)) ?? r.split('\n').at(-1) ?? '';
    const want = r.split('\n').find((l) => /^\s+want /.test(l));
    return [`${lab} failed`, `${first.replace(/\s+\(during: .*\)$/, '').slice(0, 110)}${want ? ' | ' + want.trim().slice(0, 60) : ''}`];
  }
  if (lab && ['api', 'doc', 'sample', 'help', 'example', 'proto'].includes(lab)) return [`lookup: ${lab}`, cmd.replace(/^.*node lab\.mjs\s+(?:(?:bds|end|ll)\s+)?/, '').slice(0, 70)];
  if (s.error || /^(ERR |Error:|error:)/m.test(r.slice(0, 200))) return ['tool error', `${s.name} ${(cmd || JSON.stringify(s.input)).slice(0, 60)} → ${r.split('\n')[0].slice(0, 80)}`];
  if (/\bsed -i\b|<<\s*'?EOF|>\s*[\w./-]+\.(ts|js|txt|json|py)\b/.test(cmd) && !lab) return ['shell edit (not Write/Edit)', cmd.split('\n')[0].slice(0, 80)];
  const file = s.name === 'Read' ? String(s.input.file_path ?? '') : /^\s*(?:cd \S+ && )?(cat|head|tail|less)\s+(?:-\S+\s+)*([^\s|;&]+)/.exec(cmd)?.[2] ?? '';
  if (file && !OWN.test(file)) return [`read ${/kit\.[jt]s$/.test(file) ? 'kit' : /AGENTS\.md$/.test(file) ? 'AGENTS.md' : /help\.md$/.test(file) ? 'help.md' : /common\//.test(file) ? 'lab source' : /\.lab\//.test(file) ? 'lab cache' : 'other file'}`, file.replace(/^.*?(bds|end|ll|common)\//, '$1/').slice(0, 80)];
  return null;
}
function runs(ROOT, want) {
  const rank = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'bench', 'ranking.json'), 'utf8')); } catch { return []; } })();
  const home = path.join(os.homedir(), '.claude', 'projects');
  const bySession = (sid) => { try { for (const d of fs.readdirSync(home)) { const f = path.join(home, d, sid + '.jsonl'); if (fs.existsSync(f)) return f; } } catch { /* none */ } return null; };
  const byRunDir = (id) => { const d = path.join(home, `-${path.join(ROOT, 'runs', id).replace(/^\//, '').replace(/[/_.]/g, '-')}`); try { const f = fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')).map((x) => path.join(d, x)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]; return f ?? null; } catch { return null; } };
  const found = [];
  for (const r of [...rank].reverse()) {
    let files = [...(r.logs ?? []), ...(r.session ? [bySession(r.session)] : []), ...(!r.logs && !r.session && r.id ? [byRunDir(r.id)] : [])].filter((f) => f && fs.existsSync(f));
    if (!files.length && r.id) files = [path.join(ROOT, 'runs', `${r.id}.trace.jsonl`), ...['bds', 'end', 'll'].map((k) => path.join(ROOT, 'runs', r.id, k, '.lab', 'trace.jsonl'))].filter((f) => fs.existsSync(f)).slice(0, 1);   // no transcript: the lab's trace
    if (files.length) found.push({ label: `${r.task}${r.pass ? '' : ' (FAIL)'}`, files, row: r });
  }
  if (want === 'all') return found;
  return found.slice(0, Number(want) || 10);
}
export function friction(ROOT, args) {
  const files = args.filter((a) => a.endsWith('.jsonl'));
  const list = files.length ? files.map((f) => ({ label: path.basename(f), files: [f] })) : runs(ROOT, args[0]);
  if (!list.length) { console.log('no transcripts: run tasks first (node bench/bench.mjs run <task>, node lab.mjs make ...)'); return; }
  const agg = new Map();
  let nSteps = 0, nRuns = 0;
  console.log('run                                  steps  go/test  failed  lookups  tokens(total/fresh)');
  for (const run of list) {
    let st = [], use = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
    for (const f of run.files) { const x = steps(f); st = st.concat(x.steps); for (const k in use) use[k] += x.usage[k]; }
    const labRuns = st.filter((s) => /node lab\.mjs\s+(?:(?:bds|end|ll)\s+)?(go|test|qa)\b/.test(String(s.input.command ?? s.input.args ?? '')));
    let failed = 0, looks = 0;
    const seen = new Map();
    for (const s of st) {
      const key = `${s.name}:${JSON.stringify(s.input)}`;
      const c = classify(s) ?? (seen.has(key) && !/node lab\.mjs\s+(?:(?:bds|end|ll)\s+)?(go|test)/.test(String(s.input.command ?? '')) ? ['repeated the same call', (s.input.command ?? JSON.stringify(s.input)).slice(0, 70)] : null);
      seen.set(key, true);
      if (!c) continue;
      if (/failed$/.test(c[0])) failed++;
      if (/^lookup/.test(c[0])) looks++;
      const a = agg.get(c[0]) ?? { n: 0, chars: 0, eg: new Map() };
      a.n++; a.chars += (s.result ?? '').length + JSON.stringify(s.input).length;
      a.eg.set(c[1], (a.eg.get(c[1]) ?? 0) + 1);
      agg.set(c[0], a);
    }
    nSteps += st.length; nRuns++;
    const total = use.in + use.out + use.cacheRead + use.cacheWrite, fresh = use.in + use.out + use.cacheWrite;
    console.log(`${run.label.slice(0, 36).padEnd(36)} ${String(st.length).padStart(5)} ${String(labRuns.length).padStart(8)} ${String(failed).padStart(7)} ${String(looks).padStart(8)}  ${total.toLocaleString('en')}/${fresh.toLocaleString('en')}`);
  }
  console.log(`\nfriction over ${nRuns} run(s), ${nSteps} steps (most costly first; ~tokens = what the step put into the context):`);
  for (const [k, a] of [...agg].sort((x, y) => y[1].chars - x[1].chars)) {
    console.log(`${String(a.n).padStart(4)}x ~${tok(a.chars).toLocaleString('en').padStart(7)} tok  ${k}`);
    for (const [e, n] of [...a.eg].sort((x, y) => y[1] - x[1]).slice(0, 4)) console.log(`        ${n > 1 ? n + 'x ' : ''}${e}`);
  }
}
