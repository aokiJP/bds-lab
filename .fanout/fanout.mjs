#!/usr/bin/env node
// fanout: AI 並行開発の土台。司令塔（1 セッション）が計画を 1 枚の JSON に書き、子（サブエージェント）は決まった
// プロンプトで自分の範囲だけを直す。人がプロンプトを書かない・範囲の外を触らせない・Actions を使わない、を仕組みで守る。
//   node .fanout/fanout.mjs install            このリポジトリに入れる（settings の調整・Actions の自動契機を外す・AGENTS.md に規則）
//   node .fanout/fanout.mjs new "<目標>"        計画の雛形 .fanout/plan.json（土台 = いまの HEAD）
//   node .fanout/fanout.mjs check               計画の検査（担当の重なり・共有ファイル・存在しない関数・レーン数）
//   node .fanout/fanout.mjs prompt <レーン>      子に渡すプロンプト（.fanout/LANE.md から作る。人は書かない）
//   node .fanout/fanout.mjs scope <レーン> [--head <ref>]   土台からの差分が担当の中か（作業ツリーの未 commit も見る）
//   node .fanout/fanout.mjs worktree <レーン>     そのレーンの作業フォルダを土台から作る（枝 fanout/<レーン>、計画に記録）
//   node .fanout/fanout.mjs record <レーン> <枝>  子が作った枝を計画に記録
//   node .fanout/fanout.mjs order               統合の順番（after に従う）
//   node .fanout/fanout.mjs status              レーンごとの枝・commit 数・範囲の検査
//   node .fanout/fanout.mjs actions-off [--check]   .github/workflows を手動（workflow_dispatch）だけにする
//   node .fanout/fanout.mjs selftest            この道具自身のテスト（一時フォルダの git で）
// 依存なし（node 18+ と git）。終了コード: 0 = 通った / 1 = 直すものがある。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MAX_LANES = 10;
// 子が触らない（司令塔だけが触る）ファイル。plan.shared で足せる
export const ALWAYS_SHARED = ['.fanout/**', '.github/**', '.claude/**', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'CHANGES.md', 'package.json', 'package-lock.json'];

const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256e6 });
  return { ok: r.status === 0, out: (r.stdout ?? '').replace(/\n$/, ''), err: (r.stderr ?? '').trim() };
};
const topOf = (cwd = process.cwd()) => { const r = git(['rev-parse', '--show-toplevel'], cwd); if (!r.ok) throw new Error('git のリポジトリの中で実行してください'); return r.out; };
const planFile = (top) => path.join(top, '.fanout', 'plan.json');
/** the plan of this checkout, or (inside a lane's worktree, where the git-ignored plan is not) the main checkout's */
function planPath(top) {
  const here = planFile(top);
  if (fs.existsSync(here)) return here;
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], top);
  const main = common.ok ? planFile(path.dirname(common.out)) : here;
  return fs.existsSync(main) ? main : here;
}
export function loadPlan(top) {
  const f = planPath(top);
  if (!fs.existsSync(f)) throw new Error('.fanout/plan.json がありません（node .fanout/fanout.mjs new "<目標>"）');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
const savePlan = (top, p) => fs.writeFileSync(planPath(top), JSON.stringify(p, null, 2) + '\n');

// ---- globs and owns ----
/** glob → RegExp: ** = any depth, * = within one folder, ? = one char (pure) */
export function globRe(g) {
  let s = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { s += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') s += '[^/]*';
    else if (c === '?') s += '[^/]';
    else s += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${s}$`);
}
const matches = (glob, file) => globRe(glob).test(file);
/** "path#fn1,fn2" → {path, fns|null} (pure) */
export function parseOwn(o) {
  const i = o.indexOf('#');
  return i < 0 ? { path: o, fns: null } : { path: o.slice(0, i), fns: o.slice(i + 1).split(',').map((x) => x.trim()).filter(Boolean) };
}

// ---- top-level definitions in a source file (JS/TS/MJS/CJS/Python), with their line ranges ----
const DECL = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^class\s+([A-Za-z_]\w*)/,
];
/** text → [{name, start, end}] 1-based inclusive. A definition starts at its top-level line (comments right above belong to
 *  it) and ends before the next one's comments. Approximate on purpose: what scope checks is "the changed lines are inside
 *  the named definitions", and anything it cannot place is outside (pure) */
export function definitions(text) {
  const lines = text.split('\n'), defs = [];
  for (let i = 0; i < lines.length; i++) {
    for (const re of DECL) { const m = re.exec(lines[i]); if (m) { defs.push({ name: m[1], line: i + 1 }); break; } }
  }
  const isComment = (l) => /^\s*(\/\/|\/\*|\*|#(?!!))/.test(l) && !/^\s*#\s*(include|define)/.test(l);
  const startOf = (line) => { let s = line; while (s > 1 && isComment(lines[s - 2])) s--; return s; };
  return defs.map((d, k) => {
    const start = startOf(d.line), next = defs[k + 1];
    let end = next ? startOf(next.line) - 1 : lines.length;
    while (end > d.line && lines[end - 1].trim() === '') end--;
    return { name: d.name, start, end };
  });
}

// ---- the plan's check ----
/** plan → problems (strings). fileText(path) reads the base's file (null = missing) (pure apart from fileText) */
export function checkPlan(plan, fileText = () => null) {
  const bad = [], lanes = plan.lanes ?? [];
  if (!plan.goal) bad.push('goal（目標）がありません');
  if (!plan.base) bad.push('base（土台の commit）がありません');
  if (!lanes.length) bad.push('lanes が空です');
  if (lanes.length > (plan.maxLanes ?? MAX_LANES)) bad.push(`レーンが ${lanes.length} 本: 多すぎます（上限 ${plan.maxLanes ?? MAX_LANES}）`);
  const names = new Set(), shared = [...ALWAYS_SHARED, ...(plan.shared ?? [])];
  const whole = [], fns = new Map();   // path -> [{lane, fn}]
  for (const l of lanes) {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(l.name ?? '')) bad.push(`レーンの名前「${l.name}」: 英小文字・数字・- で`);
    if (names.has(l.name)) bad.push(`レーンの名前「${l.name}」が重なっています`);
    names.add(l.name);
    if (!l.goal) bad.push(`${l.name}: goal がありません`);
    const owns = l.owns ?? [];
    if (l.readonly) {
      if (owns.length) bad.push(`${l.name}: readonly なのに owns があります`);
      for (const x of l.target ?? []) if (!lanes.some((y) => y.name === x && !y.readonly)) bad.push(`${l.name}: target の ${x} という書くレーンはありません`);
      continue;
    }
    if (!owns.length) bad.push(`${l.name}: owns（触ってよいもの）がありません`);
    if (!l.test) bad.push(`${l.name}: test（自分で回すテストのコマンド）がありません`);
    for (const o of owns) {
      const p = parseOwn(o);
      if (shared.some((g) => matches(g, p.path))) bad.push(`${l.name}: ${p.path} は共有（司令塔だけが触る）`);
      if (p.fns) {
        const text = fileText(p.path);
        if (text == null) bad.push(`${l.name}: ${p.path} が土台にありません（関数の担当は既にあるファイルだけ）`);
        else { const have = new Set(definitions(text).map((d) => d.name)); for (const f of p.fns) if (!have.has(f)) bad.push(`${l.name}: ${p.path} に ${f} がありません`); }
        for (const f of p.fns) { const a = fns.get(p.path) ?? []; a.push({ lane: l.name, fn: f }); fns.set(p.path, a); }
      } else whole.push({ lane: l.name, glob: p.path });
    }
    for (const a of l.after ?? []) if (!lanes.some((x) => x.name === a)) bad.push(`${l.name}: after の ${a} というレーンはありません`);
  }
  // overlaps: a whole-file own against anything else on the same file; the same function twice
  for (let i = 0; i < whole.length; i++) {
    for (let j = i + 1; j < whole.length; j++) {
      const a = whole[i], b = whole[j];
      if (a.lane !== b.lane && (a.glob === b.glob || matches(a.glob, b.glob) || matches(b.glob, a.glob))) bad.push(`${a.lane} と ${b.lane} が ${a.glob} / ${b.glob} を両方持っています`);
    }
    for (const [p, list] of fns) if (matches(whole[i].glob, p) && list.some((x) => x.lane !== whole[i].lane)) bad.push(`${whole[i].lane} が ${p} を丸ごと持ち、${list.filter((x) => x.lane !== whole[i].lane).map((x) => x.lane).join('・')} がその関数を持っています`);
  }
  for (const [p, list] of fns) {
    const seen = new Map();
    for (const { lane, fn } of list) { if (seen.has(fn) && seen.get(fn) !== lane) bad.push(`${p} の ${fn} を ${seen.get(fn)} と ${lane} が両方持っています`); seen.set(fn, lane); }
  }
  // after: no cycles
  try { order(plan); } catch (e) { bad.push(e.message); }
  return bad;
}
/** the lanes in an order where each comes after its `after` (pure; throws on a cycle) */
export function order(plan) {
  const lanes = plan.lanes ?? [], done = [], state = new Map();
  const visit = (l, trail) => {
    if (state.get(l.name) === 2) return;
    if (state.get(l.name) === 1) throw new Error(`after が輪になっています: ${[...trail, l.name].join(' → ')}`);
    state.set(l.name, 1);
    for (const a of l.after ?? []) { const x = lanes.find((y) => y.name === a); if (x) visit(x, [...trail, l.name]); }
    state.set(l.name, 2); done.push(l.name);
  };
  for (const l of lanes) visit(l, []);
  return done;
}

// ---- scope: is a lane's change inside what it owns ----
/** unified diff (-U0) → [{file, oldLines:[n], newLines:[n]}] per file (pure) */
export function changedLines(diff) {
  const out = new Map();
  let cur = null;
  for (const line of diff.split('\n')) {
    let m;
    if ((m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line))) { cur = { file: m[2], oldLines: [], newLines: [] }; out.set(m[2], cur); continue; }
    if ((m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)) && cur) {
      const [os_, oc, ns, nc] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      for (let k = 0; k < oc; k++) cur.oldLines.push(os_ + k);
      for (let k = 0; k < nc; k++) cur.newLines.push(ns + k);
    }
  }
  return [...out.values()];
}
/** a lane + its changed files → problems (pure: texts come in as functions) */
export function scopeProblems(plan, lane, changes, { oldText = () => null, newText = () => null } = {}) {
  const bad = [], shared = [...ALWAYS_SHARED, ...(plan.shared ?? [])];
  if (lane.readonly) return changes.length ? [`${lane.name} は読むだけのレーンです: ${changes.map((c) => c.file).join(', ')} を変えています`] : [];
  const owns = (lane.owns ?? []).map(parseOwn);
  for (const c of changes) {
    if (shared.some((g) => matches(g, c.file))) { bad.push(`${c.file}: 共有ファイル（司令塔だけが触る）`); continue; }
    const mine = owns.filter((o) => matches(o.path, c.file));
    if (!mine.length) { bad.push(`${c.file}: 担当の外`); continue; }
    if (mine.some((o) => !o.fns)) continue;   // the whole file is this lane's
    const allowed = new Set(mine.flatMap((o) => o.fns));
    const inside = (text, nums) => {
      if (text == null) return nums.length ? nums : [];
      const defs = definitions(text).filter((d) => allowed.has(d.name));
      return nums.filter((n) => !defs.some((d) => n >= d.start && n <= d.end));
    };
    const outOld = inside(oldText(c.file), c.oldLines), outNew = inside(newText(c.file), c.newLines);
    if (outOld.length || outNew.length) bad.push(`${c.file}: 担当の関数（${[...allowed].join(', ')}）の外の行を変えています（土台 ${outOld.slice(0, 6).join(',') || '-'} / いま ${outNew.slice(0, 6).join(',') || '-'}）`);
  }
  return bad;
}
function scopeOf(top, plan, lane, head) {
  const base = plan.base;
  // the working tree (uncommitted and untracked too) unless a head ref is named
  const diff = head ? git(['diff', '-U0', '--no-color', '--no-renames', `${base}...${head}`], top) : git(['diff', '-U0', '--no-color', '--no-renames', base], top);
  if (!diff.ok) throw new Error(`git diff に失敗: ${diff.err}`);
  const changes = changedLines(diff.out);
  if (!head) {
    const untracked = git(['ls-files', '--others', '--exclude-standard'], top).out.split('\n').filter(Boolean);
    for (const f of untracked) {
      const t = fs.readFileSync(path.join(top, f), 'utf8');
      changes.push({ file: f, oldLines: [], newLines: t.split('\n').map((_, i) => i + 1) });
    }
  }
  const show = (ref, f) => { const r = git(['show', `${ref}:${f}`], top); return r.ok ? r.out : null; };
  return scopeProblems(plan, lane, changes, {
    oldText: (f) => show(base, f),
    newText: (f) => (head ? show(head, f) : (fs.existsSync(path.join(top, f)) ? fs.readFileSync(path.join(top, f), 'utf8') : null)),
  });
}

// ---- the lane's prompt ----
export function renderPrompt(plan, lane, template) {
  if (!lane.worktree || !lane.branch) throw new Error(`${lane.name}: 作業フォルダがまだありません（node .fanout/fanout.mjs worktree ${lane.name}）`);
  const shared = [...ALWAYS_SHARED, ...(plan.shared ?? [])];
  const list = (a) => (a?.length ? a.map((x) => `- ${x}`).join('\n') : '- （なし）');
  const vars = {
    goal: plan.goal, base: plan.base, name: lane.name, laneGoal: lane.goal,
    owns: lane.readonly ? '- （なし: 読むだけ。ファイルを一切変えない）' : list(lane.owns),
    shared: list(shared), test: lane.test ?? '（なし）', details: list(lane.details), rules: list(plan.rules),
    others: list((plan.lanes ?? []).filter((x) => x.name !== lane.name).map((x) => `${x.name}: ${x.goal}`)),
    mode: lane.readonly ? 'readonly' : 'write',
    worktree: lane.worktree ?? '', branch: lane.branch ?? '',
    reviews: list(lane.reviews),
    branches: list((plan.lanes ?? []).filter((x) => !x.readonly && (!lane.target || lane.target.includes(x.name))).map((x) => (x.branch ? `${x.name}: \`git diff ${plan.base}...${x.branch}\`` : `${x.name}: （枝がまだ記録されていません: 司令塔に聞く）`))),
  };
  let t = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, body) => (k === 'readonly' ? (lane.readonly ? body : '') : k === 'write' ? (lane.readonly ? '' : body) : ''));
  t = t.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
  t = t.replace(/\n{3,}/g, '\n\n');
  const left = /\{\{\w+\}\}/.exec(t);
  if (left) throw new Error(`テンプレートに埋まらない欄があります: ${left[0]}`);
  return t;
}

// ---- GitHub Actions: manual only ----
/** a workflow's text → the same with its `on:` keeping only workflow_dispatch (its inputs kept) (pure) */
export function manualOnly(text) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (i < 0) return text;
  const head = lines[i].replace(/^(on|"on"|'on'):\s*/, '');
  let j = i + 1;
  while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]) || /^\s*#/.test(lines[j]))) j++;
  // keep blank lines that separated `on:` from the next key
  let end = j; while (end > i + 1 && lines[end - 1].trim() === '') end--;
  const block = lines.slice(i + 1, end);
  const keep = [];
  // (a one-line `on: push` / `on: [push, workflow_dispatch]`: nothing to keep, plain workflow_dispatch below)
  if (!head || head.startsWith('#')) {
    const k = block.findIndex((l) => /^\s+workflow_dispatch:/.test(l));
    if (k >= 0) {
      const ind = /^(\s+)/.exec(block[k])[1].length;
      keep.push(block[k]);
      for (let m = k + 1; m < block.length; m++) { const l = block[m]; if (l.trim() === '' || /^\s*#/.test(l)) { keep.push(l); continue; } if (/^(\s*)/.exec(l)[1].length <= ind) break; keep.push(l); }
      while (keep.length && keep.at(-1).trim() === '') keep.pop();
    }
  }
  const out = keep.length ? ['on:', ...keep] : ['on:', '  workflow_dispatch:'];
  return [...lines.slice(0, i), ...out, ...lines.slice(end)].join('\n');
}
const AUTO_TRIGGERS = /^\s+(push|pull_request|pull_request_target|schedule|issues|issue_comment|workflow_run|release|create|delete|repository_dispatch|check_run|check_suite|merge_group|discussion|fork|watch|page_build|deployment)\s*:/m;
export function hasAutoTrigger(text) {
  const t = text.split('\n'), i = t.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (i < 0) return false;
  const head = t[i].replace(/^(on|"on"|'on'):\s*/, '').replace(/#.*/, '').trim();
  if (head) return !/^workflow_dispatch$|^\[\s*workflow_dispatch\s*\]$/.test(head);
  let j = i + 1; const block = [];
  while (j < t.length && (t[j].trim() === '' || /^\s/.test(t[j]))) block.push(t[j++]);
  return AUTO_TRIGGERS.test(block.join('\n'));
}
function actionsOff(top, { check = false } = {}) {
  const dir = path.join(top, '.github', 'workflows'), res = [];
  if (!fs.existsSync(dir)) return res;
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    const p = path.join(dir, f), t = fs.readFileSync(p, 'utf8');
    if (!hasAutoTrigger(t)) { res.push({ file: f, changed: false }); continue; }
    if (!check) { const n = manualOnly(t); fs.writeFileSync(p, n); if (hasAutoTrigger(n)) throw new Error(`${f}: 自動の契機を外せません（手で直してください）`); }
    res.push({ file: f, changed: true });
  }
  return res;
}

// ---- a lane's own working folder: made here from the plan's base (a subagent tool's own worktree may start from the
// default branch instead: the lane's first check stops it) ----
export function laneWorktree(top, plan, lane) {
  const main = path.dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], top).out);
  const wt = path.join(main, '.claude', 'worktrees', `fanout-${lane.name}`), branch = `fanout/${lane.name}`;
  let made = false;
  if (!fs.existsSync(wt)) {
    const exists = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], main).ok;
    const r = git(['worktree', 'add', ...(exists ? [wt, branch] : ['-b', branch, wt, plan.base])], main);
    if (!r.ok) throw new Error(`作業フォルダを作れません: ${r.err}`);
    made = true;
  }
  if (git(['merge-base', '--is-ancestor', plan.base, 'HEAD'], wt).ok === false) throw new Error(`${wt} は土台 ${plan.base.slice(0, 10)} から始まっていません`);
  lane.worktree = wt; lane.branch = branch;
  return { path: wt, branch, made };
}

// ---- install into this repository ----
const AGENTS_MARK = '<!-- fanout:rules -->';
function install(top) {
  const said = [];
  // settings: the orchestrator needs Agent (subagents), worktrees, Skill and questions — a repo that denies them gets them back
  const sf = path.join(top, '.claude', 'settings.json');
  const need = ['Agent', 'Task', 'Skill', 'EnterWorktree', 'ExitWorktree', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'];
  let s = {};
  if (fs.existsSync(sf)) s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  s.permissions ??= {};
  const deny = s.permissions.deny ?? [];
  const removed = deny.filter((d) => need.includes(d));
  s.permissions.deny = deny.filter((d) => !need.includes(d));
  const allow = new Set(s.permissions.allow ?? []);
  for (const a of ['Bash(node .fanout/fanout.mjs:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git merge:*)', 'Bash(git worktree:*)', 'Bash(git branch:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git show:*)', 'Bash(git rev-parse:*)']) allow.add(a);
  s.permissions.allow = [...allow];
  fs.mkdirSync(path.dirname(sf), { recursive: true });
  fs.writeFileSync(sf, JSON.stringify(s, null, 2) + '\n');
  said.push(`.claude/settings.json: ${removed.length ? `拒否から外した ${removed.join(' ')}、` : ''}許可に fanout と git の作業コマンド`);
  // Actions: manual only
  const a = actionsOff(top);
  said.push(`.github/workflows: ${a.filter((x) => x.changed).map((x) => x.file).join(' ') || '（自動で走るものはありませんでした）'} を手動だけに`);
  // AGENTS.md: the rules, once
  const af = path.join(top, 'AGENTS.md'), rules = fs.readFileSync(path.join(HERE, 'RULES.md'), 'utf8');
  const cur = fs.existsSync(af) ? fs.readFileSync(af, 'utf8') : '';
  if (!cur.includes(AGENTS_MARK)) { fs.writeFileSync(af, `${cur.replace(/\n*$/, '\n\n')}${AGENTS_MARK}\n${rules.trim()}\n`); said.push('AGENTS.md: 並行開発の規則を末尾に'); }
  else said.push('AGENTS.md: 規則は入っています');
  // the run's own files never go into git
  const gi = path.join(top, '.gitignore'), g = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  let g2 = g;
  if (!/^\.fanout\/plan\.json$/m.test(g2)) g2 = `${g2.replace(/\n*$/, '\n')}# fanout: その回の計画（司令塔のもの）\n.fanout/plan.json\n`;
  if (!/^\.claude\/worktrees\/$/m.test(g2)) g2 = `${g2.replace(/\n*$/, '\n')}# fanout: レーンの作業フォルダ\n.claude/worktrees/\n`;
  if (g2 !== g) fs.writeFileSync(gi, g2);
  return said;
}

// ---- command line ----
function newPlan(top, goal) {
  if (fs.existsSync(planFile(top))) throw new Error('.fanout/plan.json が既にあります（前の回を終えてから: 消すか名前を変える）');
  const base = git(['rev-parse', 'HEAD'], top).out;
  const dirty = git(['status', '--porcelain'], top).out;
  if (dirty) throw new Error(`作業ツリーに commit していない変更があります: 土台を固めるため、先に commit してください\n${dirty.split('\n').slice(0, 8).join('\n')}`);
  const p = { goal, base, maxLanes: MAX_LANES, shared: [], rules: [], lanes: [] };
  savePlan(top, p);
  return p;
}
async function main([cmd, ...rest]) {
  const top = cmd === 'selftest' ? null : topOf();
  const fail = (msg) => { console.error(`✘ ${msg}`); process.exitCode = 1; };
  switch (cmd) {
    case 'install': for (const l of install(top)) console.log(`✔ ${l}`); console.log('次: commit してから /fanout "<目標>"'); break;
    case 'new': { if (!rest[0]) return fail('目標を書いてください: node .fanout/fanout.mjs new "<目標>"'); const p = newPlan(top, rest.join(' ')); console.log(`✔ .fanout/plan.json（土台 ${p.base.slice(0, 10)}）: lanes を埋めて check`); break; }
    case 'check': {
      const plan = loadPlan(top), bad = checkPlan(plan, (f) => { const r = git(['show', `${plan.base}:${f}`], top); return r.ok ? r.out : null; });
      if (bad.length) { bad.forEach((b) => fail(b)); break; }
      console.log(`✔ 計画は通りました: ${plan.lanes.length} レーン（${plan.lanes.map((l) => l.name + (l.readonly ? '(読)' : '')).join(' ')}）、統合の順 ${order(plan).join(' → ')}`);
      break;
    }
    case 'prompt': {
      const plan = loadPlan(top), lane = plan.lanes.find((l) => l.name === rest[0]);
      if (!lane) return fail(`レーン ${rest[0]} はありません（${plan.lanes.map((l) => l.name).join(' ')}）`);
      const bad = checkPlan(plan, (f) => { const r = git(['show', `${plan.base}:${f}`], top); return r.ok ? r.out : null; });
      if (bad.length) { bad.forEach((b) => fail(b)); return fail('計画が通らないのでプロンプトを出しません'); }
      process.stdout.write(renderPrompt(plan, lane, fs.readFileSync(path.join(HERE, 'LANE.md'), 'utf8')));
      break;
    }
    case 'scope': {
      const plan = loadPlan(top), lane = plan.lanes.find((l) => l.name === rest[0]);
      if (!lane) return fail(`レーン ${rest[0]} はありません`);
      const hi = rest.indexOf('--head'), head = hi >= 0 ? rest[hi + 1] : null;
      const bad = scopeOf(top, plan, lane, head);
      if (bad.length) bad.forEach((b) => fail(b)); else console.log(`✔ ${lane.name}: 変更はすべて担当の中です`);
      break;
    }
    case 'worktree': {
      const plan = loadPlan(top), lane = plan.lanes.find((l) => l.name === rest[0]);
      if (!lane) return fail(`レーン ${rest[0]} はありません`);
      const r = laneWorktree(top, plan, lane); savePlan(top, plan);
      console.log(`✔ ${lane.name}: ${r.path}（枝 ${r.branch}、土台 ${plan.base.slice(0, 10)}${r.made ? '' : '、既にあったもの'}）`);
      break;
    }
    case 'record': {
      const plan = loadPlan(top), lane = plan.lanes.find((l) => l.name === rest[0]);
      if (!lane || !rest[1]) return fail('使い方: record <レーン> <枝>');
      if (!git(['rev-parse', '--verify', rest[1]], top).ok) return fail(`枝 ${rest[1]} がありません`);
      lane.branch = rest[1]; savePlan(top, plan); console.log(`✔ ${lane.name} → ${rest[1]}`);
      break;
    }
    case 'order': console.log(order(loadPlan(top)).join('\n')); break;
    case 'status': {
      const plan = loadPlan(top);
      for (const name of order(plan)) {
        const l = plan.lanes.find((x) => x.name === name);
        if (!l.branch) { console.log(`・ ${name}: 枝なし（まだ）`); continue; }
        const n = git(['rev-list', '--count', `${plan.base}..${l.branch}`], top).out;
        const bad = scopeOf(top, plan, l, l.branch);
        console.log(`${bad.length ? '✘' : '✔'} ${name}: ${l.branch}（${n} commit）${bad.length ? ' ' + bad.join(' / ') : ''}`);
        if (bad.length) process.exitCode = 1;
      }
      break;
    }
    case 'actions-off': {
      const check = rest.includes('--check'), r = actionsOff(top, { check });
      const on = r.filter((x) => x.changed);
      if (check) { if (on.length) fail(`自動で走るワークフロー: ${on.map((x) => x.file).join(' ')}（node .fanout/fanout.mjs actions-off）`); else console.log('✔ 自動で走るワークフローはありません'); }
      else console.log(on.length ? `✔ 手動だけにしました: ${on.map((x) => x.file).join(' ')}` : '✔ 自動で走るワークフローはありません');
      break;
    }
    case 'selftest': { const { run } = await import(path.join(HERE, 'test.mjs').replace(/^/, 'file://')); process.exitCode = (await run()) ? 0 : 1; break; }
    default: console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  }
}
export { git, actionsOff, install, scopeOf, newPlan };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
}
