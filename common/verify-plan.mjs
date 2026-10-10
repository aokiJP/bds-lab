// The verify run's plan (.github/workflows/verify.yml, its first job): which of its jobs this push needs, from what changed
// since the last commit verify passed on. The same content is never verified twice (a pull request's head, then its merge; a run
// a newer push cancelled is counted from the last one that passed, so nothing is left out); the real server's job (bds, ~35
// minutes of a runner) runs only when something it runs changed; a change to the management panel alone runs the panel's own
// tests (a few minutes) instead of every offline test (~20).
//   node common/verify-plan.mjs   in the workflow: GITHUB_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_API_URL,
//                                 GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_RUN_ATTEMPT → offline=full|panel|none, tests=…,
//                                 shards=[1,…] nshards=n, browser=true|false, bds=true|false, bdsparts=["bench",…], addons=all|<names>,
//                                 extra=true|false in $GITHUB_OUTPUT, the reason in $GITHUB_STEP_SUMMARY
// By hand (workflow_dispatch) or [full ci] in the commit's title (its first line): every job and the extra ones too (macOS,
// Endstone, LeviLamina: extra=true) — the marker only named in a commit's text starts nothing more (a macOS minute counts as
// 10). No passed commit among the last 400, or anything it cannot read: every job, as before (not the extra ones). It never
// fails the run itself: a plan it cannot make is the whole run.
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
// the other workflows, the lenders' template, the offline and browser tests, this plan and the offline tests' runner)
const BDS_FREE = /^(panel|auth|docs|\.claude|\.fanout|\.devcontainer|host\/template)\/|^\.github\/(?!workflows\/verify\.yml$)|^[^/]+\.md$|^tests\/([\w-]+-(offline|browser)|offline|eslint\.config)\.mjs$|^common\/(verify-plan|run-tests)\.mjs$/;
// (code that loads a panel file and is tested by the panel's own tests: the CLI behind schedule.yml and unit.yml, panel check;
// this plan and its test only name panel files)
const PANEL_SIDE = (f) => f.startsWith('panel/') || PANEL_TESTS.includes(f) || /^common\/(panel|schedule|unitci|verify-plan)\.mjs$|^tests\/verify-plan-offline\.mjs$/.test(f);
// (the real server's work, each part its own job side by side: the bench's selftest, the from-scratch lessons, the AI tools'
// story with a real client (dev-bds, play-bds), every addon's tests and pack. An addon's own files alone need only its tests:
// none of the other parts reads a unit kept in bds/addons — they make their own)
export const BDS_PARTS = ['bench', 'scratch', 'dev', 'addons'];
// (every offline test: on this many runners side by side, each its part — `auto gate --all --shard i/n`, split by the tests'
// usual times: common/run-tests.mjs TIME)
export const SHARDS = 4;
const ADDON = /^bds\/addons\/([A-Za-z0-9_-]+)\//;
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

/** everything asked for (pure): by hand, or [full ci] in the commit's title — not anywhere in its text */
export const fullAsked = (event, message) => event === 'workflow_dispatch' || String(message ?? '').split('\n')[0].includes('[full ci]');

const list = (fs0, n = 3) => `${fs0.slice(0, n).join('、')}${fs0.length > n ? ` ほか ${fs0.length - n} 個` : ''}`;

/** the plan (pure) → { offline: 'full'|'panel'|'none', shards (runners for it), tests: [the panel's tests, the browser apart], browser, bds,
 *  bdsParts: [the real server's parts to run], addons: 'all' | [the addons whose files alone changed], why }.
 *  full: by hand or [full ci]; base: the last commit verify passed on (null: none found); files: changed since base;
 *  present: is this addon still there (one deleted is not tested) */
export function planVerify({ full = false, base = null, files = [], external = new Set(), reason = '', present = () => true } = {}) {
  if (full || !base) return { offline: 'full', shards: SHARDS, tests: [], browser: true, bds: true, bdsParts: BDS_PARTS, addons: 'all', why: reason || (full ? '手で始めた・[full ci]: すべての試験' : `前に通ったコミットが（最近の ${DEPTH} 個に）見つからない: すべての試験`) };
  const by = { nothing: [], panel: [], offline: [], all: [] };
  for (const f of files) by[need(f, external)].push(f);
  const offline = by.all.length || by.offline.length ? 'full' : by.panel.length ? 'panel' : 'none';
  const p = offline === 'panel' ? panelPlan(by.panel).tests : [];
  const tests = p.filter((t) => t !== BROWSER), browser = offline === 'full' || p.includes(BROWSER);
  // (the real server: only the addons whose own files alone changed — or every part, when anything else it uses did)
  const addonOnly = by.all.length > 0 && by.all.every((f) => ADDON.test(f));
  const names = addonOnly ? [...new Set(by.all.map((f) => ADDON.exec(f)[1]))].filter((n) => present(n)).sort() : [];
  const bdsParts = !by.all.length ? [] : addonOnly ? (names.length ? ['addons'] : []) : BDS_PARTS, bds = bdsParts.length > 0;
  const head = files.length ? `前に通った ${base.slice(0, 7)} から ${files.length} 個のファイルが変わった` : `前に通った ${base.slice(0, 7)} と同じ中身`;
  const off = offline === 'full' ? `すべて（${list([...by.all, ...by.offline])}）`
    : offline === 'panel' ? `パネルの分だけ（${tests.length} 本${browser ? '・本物のブラウザ' : ''}: ${list(by.panel)}）` : '要らない';
  const real = !by.all.length ? '流さない（BDS の試験が使うものは変わっていない）'
    : addonOnly ? (names.length ? `アドオン ${list(names, 5)} の試験だけ（ラボの本体は変わっていない）` : '流さない（変わったアドオンはもうない）')
    : `すべて（${list(by.all)}）`;
  return { offline, shards: offline === 'full' ? SHARDS : 1, tests, browser, bds, bdsParts, addons: addonOnly ? names : 'all', why: `${head}。オフラインの試験: ${off}。本物の BDS: ${real}` };
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
    const full = fullAsked(env.GITHUB_EVENT_NAME, message);
    if (full) p = { ...planVerify({ full }), extra: true };
    else {
      const passed = await passedShas({ api: env.GITHUB_API_URL || 'https://api.github.com', repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN }, fetchImpl);
      // (a re-run is asked for: HEAD itself is not its own base)
      const shas = git(['rev-list', `--max-count=${DEPTH}`, 'HEAD'], cwd).split('\n').filter(Boolean).slice(Number(env.GITHUB_RUN_ATTEMPT) > 1 ? 1 : 0);
      const base = shas.find((s) => passed.has(s)) ?? null;
      const files = base ? git(['diff', '--name-only', '--no-renames', base, 'HEAD'], cwd).split('\n').filter(Boolean) : [];
      p = planVerify({ base, files, external: files.some((f) => f.startsWith('panel/')) ? externalPanel(cwd) : new Set(),
        present: (n) => fs.existsSync(path.join(cwd, 'bds', 'addons', n, 'bp', 'manifest.json')) });
    }
  } catch (e) {
    p = planVerify({ full: true, reason: `計画を作れない（${String(e.message).replace(/\s+/g, ' ').slice(0, 200)}）: すべての試験` });
  }
  p.extra = p.extra === true;
  // (a matrix of nothing is an error even for a job that will not run: a skipped job's list is never empty)
  const lines = [`offline=${p.offline}`, `shards=${JSON.stringify(Array.from({ length: p.shards }, (_, k) => k + 1))}`, `nshards=${p.shards}`,
    `tests=${p.tests.join(' ')}`, `browser=${p.browser}`, `bds=${p.bds}`, `bdsparts=${JSON.stringify(p.bdsParts.length ? p.bdsParts : ['none'])}`,
    `addons=${p.addons === 'all' ? 'all' : p.addons.join(' ')}`, `extra=${p.extra}`];
  for (const l of lines) out(l);
  out(p.why);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### verify の計画\n${p.why}\n\nすべて（macOS・Endstone・LeviLamina も）流すには: Actions の verify を手で（Run workflow）か、commit の題（1 行目）に \`[full ci]\`\n`);
  return p;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
