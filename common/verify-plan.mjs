// The verify run's plan (.github/workflows/verify.yml, its first job): which of its jobs this push needs, from what changed
// since the last commit verify passed on. The same content is never verified twice (a pull request's head, then its merge; a run
// a newer push cancelled is counted from the last one that passed, so nothing is left out); the real server's job (bds, ~35
// minutes of a runner) runs only when something it runs changed; a change to the management panel alone runs the panel's own
// tests (a few minutes) instead of every offline test (~20).
//   node common/verify-plan.mjs   in the workflow: GITHUB_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_API_URL,
//                                 GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_RUN_ATTEMPT → offline=full|panel|none, tests=…,
//                                 browser=true|false, bds=true|false in $GITHUB_OUTPUT, the reason in $GITHUB_STEP_SUMMARY
// By hand (workflow_dispatch), [full ci] in the commit, no passed commit among the last 400, or anything it cannot read: every
// job, as before. It never fails the run itself: a plan it cannot make is the whole run.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plan as panelPlan, ALL as PANEL_TESTS } from './panel.mjs';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BROWSER = 'tests/panel-browser.mjs';
const DEPTH = 400;

// (no test reads these: the autopilot's memory — already left out of the trigger — and the change log, which only `share`
// writes)
const NOTHING = /^auto\/|^CHANGES\.md$/;
// (what the real server's job never runs or reads: the panel and its sign-in service, the docs, the AI's and fanout's tools,
// the other workflows, the lenders' template, the offline and browser tests, this plan)
const BDS_FREE = /^(panel|auth|docs|\.claude|\.fanout|\.devcontainer|host\/template)\/|^\.github\/(?!workflows\/verify\.yml$)|^[^/]+\.md$|^tests\/([\w-]+-(offline|browser)|offline|eslint\.config)\.mjs$|^common\/verify-plan\.mjs$/;
// (code that loads a panel file and is tested by the panel's own tests: the CLI behind schedule.yml and unit.yml, panel check;
// this plan and its test only name panel files)
const PANEL_SIDE = (f) => f.startsWith('panel/') || PANEL_TESTS.includes(f) || /^common\/(panel|schedule|unitci|verify-plan)\.mjs$|^tests\/verify-plan-offline\.mjs$/.test(f);
const PANEL_PATH = /panel\/[A-Za-z0-9_./-]+\.(?:mjs|js|json)/g;
const PANEL_PATH_ERE = 'panel/[A-Za-z0-9_./-]+\\.(mjs|js|json)';   // (the same for git grep -E: no (?:)

/** what one changed file needs (pure) → 'nothing' | 'panel' (the panel's own tests) | 'offline' (every offline test) | 'all'
 *  (and the real server's job too). external: panel files code outside the panel loads (externalPanel) — those are 'all' */
export function need(f, external = new Set()) {
  if (NOTHING.test(f)) return 'nothing';
  if (f.startsWith('panel/')) return external.has(f) ? 'all' : 'panel';
  if (PANEL_TESTS.includes(f)) return 'panel';
  return BDS_FREE.test(f) ? 'offline' : 'all';
}

const list = (fs0, n = 3) => `${fs0.slice(0, n).join('、')}${fs0.length > n ? ` ほか ${fs0.length - n} 個` : ''}`;

/** the plan (pure) → { offline: 'full'|'panel'|'none', tests: [the panel's tests, the browser apart], browser, bds, why }.
 *  full: by hand or [full ci]; base: the last commit verify passed on (null: none found); files: changed since base */
export function planVerify({ full = false, base = null, files = [], external = new Set(), reason = '' } = {}) {
  if (full || !base) return { offline: 'full', tests: [], browser: true, bds: true, why: reason || (full ? '手で始めた・[full ci]: すべての試験' : `前に通ったコミットが（最近の ${DEPTH} 個に）見つからない: すべての試験`) };
  const by = { nothing: [], panel: [], offline: [], all: [] };
  for (const f of files) by[need(f, external)].push(f);
  const offline = by.all.length || by.offline.length ? 'full' : by.panel.length ? 'panel' : 'none';
  const p = offline === 'panel' ? panelPlan(by.panel).tests : [];
  const tests = p.filter((t) => t !== BROWSER), browser = offline === 'full' || p.includes(BROWSER), bds = by.all.length > 0;
  const head = files.length ? `前に通った ${base.slice(0, 7)} から ${files.length} 個のファイルが変わった` : `前に通った ${base.slice(0, 7)} と同じ中身`;
  const off = offline === 'full' ? `すべて（${list([...by.all, ...by.offline])}）`
    : offline === 'panel' ? `パネルの分だけ（${tests.length} 本${browser ? '・本物のブラウザ' : ''}: ${list(by.panel)}）` : '要らない';
  const real = bds ? `流す（${list(by.all)}）` : '流さない（BDS の試験が使うものは変わっていない）';
  return { offline, tests, browser, bds, why: `${head}。オフラインの試験: ${off}。本物の BDS: ${real}` };
}

const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`git ${args[0]}: ${String(r.stderr || r.error?.message || r.status).trim().split('\n')[0]}`);
  return r.stdout;
};

/** the panel files that code outside the panel loads, and what they import inside the panel, again and again → Set (reads the
 *  checkout: git grep). A path in a comment line or a .md file is not a load; one in a line of code always is (a string to
 *  load later, too) */
export function externalPanel(cwd = TOP) {
  const r = spawnSync('git', ['grep', '-n', '-I', '-E', PANEL_PATH_ERE], { cwd, encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.status > 1 || r.error) throw new Error(`git grep: ${String(r.stderr || r.error?.message).trim().split('\n')[0]}`);
  const found = new Set();
  for (const line of (r.stdout ?? '').split('\n')) {
    const m = /^([^:]+):\d+:(.*)$/.exec(line);
    if (!m || m[1].endsWith('.md') || PANEL_SIDE(m[1]) || /^\s*(\/\/|\/?\*|#)/.test(m[2])) continue;
    for (const [p] of m[2].matchAll(PANEL_PATH)) found.add(path.posix.normalize(p));
  }
  const todo = [...found];
  while (todo.length) {
    const f = todo.pop();
    let text = '';
    try { text = fs.readFileSync(path.join(cwd, f), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const g = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (g.startsWith('panel/') && !found.has(g)) { found.add(g); todo.push(g); }
    }
  }
  return found;
}

/** the commits verify passed on (its runs of a push or by hand: those tested the very commit) → Set of shas */
export async function passedShas({ api, repo, token }, fetchImpl = fetch) {
  const r = await fetchImpl(`${api}/repos/${repo}/actions/workflows/verify.yml/runs?status=success&per_page=100`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'bds-lab' },
  });
  if (!r.ok) throw new Error(`GitHub が ${r.status} で断りました`);
  const j = await r.json();
  return new Set((j.workflow_runs ?? []).filter((x) => x.event === 'push' || x.event === 'workflow_dispatch').map((x) => x.head_sha).filter(Boolean));
}

/** the plan for the checkout's HEAD → the plan (and $GITHUB_OUTPUT, $GITHUB_STEP_SUMMARY written when set) */
export async function main({ env = process.env, cwd = TOP, fetchImpl = fetch, out = console.log } = {}) {
  let p;
  try {
    let message = '';
    try { message = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))?.head_commit?.message ?? ''; } catch { /* no event: none */ }
    const full = env.GITHUB_EVENT_NAME === 'workflow_dispatch' || message.includes('[full ci]');
    if (full) p = planVerify({ full });
    else {
      const passed = await passedShas({ api: env.GITHUB_API_URL || 'https://api.github.com', repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN }, fetchImpl);
      // (a re-run is asked for: HEAD itself is not its own base)
      const shas = git(['rev-list', `--max-count=${DEPTH}`, 'HEAD'], cwd).split('\n').filter(Boolean).slice(Number(env.GITHUB_RUN_ATTEMPT) > 1 ? 1 : 0);
      const base = shas.find((s) => passed.has(s)) ?? null;
      const files = base ? git(['diff', '--name-only', '--no-renames', base, 'HEAD'], cwd).split('\n').filter(Boolean) : [];
      p = planVerify({ base, files, external: files.some((f) => f.startsWith('panel/')) ? externalPanel(cwd) : new Set() });
    }
  } catch (e) {
    p = planVerify({ full: true, reason: `計画を作れない（${String(e.message).replace(/\s+/g, ' ').slice(0, 200)}）: すべての試験` });
  }
  const lines = [`offline=${p.offline}`, `tests=${p.tests.join(' ')}`, `browser=${p.browser}`, `bds=${p.bds}`];
  for (const l of lines) out(l);
  out(p.why);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### verify の計画\n${p.why}\n\nすべて流すには: Actions の verify を手で（Run workflow）か、commit の文に \`[full ci]\`\n`);
  return p;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
