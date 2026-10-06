// fanout の自分のテスト: node .fanout/fanout.mjs selftest（一時フォルダの git で。リポジトリには何も書かない）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as F from './fanout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export async function run() {
  let pass = 0, failed = 0;
  const t = async (name, fn) => { try { await fn(); pass++; console.log(`  ✔ ${name}`); } catch (e) { failed++; console.log(`  ✘ ${name}\n      ${e.message}`); } };
  const ok = (v, msg) => { if (!v) throw new Error(msg ?? 'not ok'); };
  const eq = (a, b) => { const [x, y] = [JSON.stringify(a), JSON.stringify(b)]; if (x !== y) throw new Error(`${x}\n      ≠ ${y}`); };

  await t('globRe: ** は深さを問わず、* は 1 段', () => {
    ok(F.globRe('tests/**').test('tests/a/b.mjs') && F.globRe('tests/*.mjs').test('tests/a.mjs') && !F.globRe('tests/*.mjs').test('tests/a/b.mjs'));
    ok(F.globRe('.github/**').test('.github/workflows/x.yml') && !F.globRe('a.b').test('axb'));
  });
  await t('definitions: 関数・const・class・def の範囲（上のコメントを含む）', () => {
    const src = ['import x from "y";', '', '// up の説明', '/** もう 1 行 */', 'export async function up() {', '  return 1;', '}', '', 'const B = 2;', 'export const isT = (w) =>', '  w;', '', 'class K {}', 'def py():', '  pass'].join('\n');
    eq(F.definitions(src).map((d) => [d.name, d.start, d.end]), [['up', 3, 7], ['B', 9, 9], ['isT', 10, 11], ['K', 13, 13], ['py', 14, 15]]);
  });
  await t('checkPlan: 重なり・共有・無い関数・名前・上限・輪を見つける', () => {
    const text = (f) => (f === 'a.mjs' ? 'function f() {}\nfunction g() {}\n' : null);
    const plan = { goal: 'x', base: 'b', lanes: [
      { name: 'one', goal: 'g', owns: ['a.mjs#f', 'lib/**'], test: 't' },
      { name: 'two', goal: 'g', owns: ['a.mjs#f,h', 'lib/x.mjs', 'README.md'], test: 't', after: ['three'] },
      { name: 'three', goal: 'g', owns: ['b.mjs#z'], test: 't', after: ['two'] },
      { name: 'Bad Name', goal: 'g', readonly: true, owns: ['c.mjs'] },
    ] };
    const bad = F.checkPlan(plan, text).join('\n');
    for (const want of [/a\.mjs の f を one と two/, /a\.mjs に h がありません/, /lib\/\*\* \/ lib\/x\.mjs/, /README\.md は共有/, /b\.mjs が土台にありません/, /輪/, /Bad Name/, /readonly なのに owns/]) ok(want.test(bad), `${want} が無い:\n${bad}`);
    eq(F.checkPlan({ goal: 'x', base: 'b', lanes: [{ name: 'one', goal: 'g', owns: ['a.mjs#f'], test: 't' }, { name: 'two', goal: 'g', owns: ['a.mjs#g'], test: 't', after: ['one'] }] }, text), []);
    ok(F.checkPlan({ goal: 'x', base: 'b', lanes: Array.from({ length: 11 }, (_, i) => ({ name: `l${i}`, goal: 'g', owns: [`f${i}.mjs`], test: 't' })) }).some((b) => /多すぎ/.test(b)));
  });
  await t('assignModels: Opus 4 割（固定の Opus が先、残りは重い順）、Sonnet 6 割。固定が多ければそのまま、mix で変えられる', () => {
    const lane = (name, w, x = {}) => ({ name, goal: 'g', owns: [`${name}.mjs`], test: 't', weight: w, ...x });
    const plan = { lanes: [lane('a', 100), lane('b', 900), lane('c', 300), lane('d', 50), lane('e', 700), lane('r', 0, { readonly: true, owns: undefined }), lane('f', 10), lane('g', 20), lane('h', 30), lane('i', 40)] };
    const m = F.assignModels(plan), opus = [...m].filter(([, x]) => x.model === 'opus').map(([n]) => n).sort();
    eq(opus, ['b', 'c', 'e', 'r']);   // 10 本の 4 割 = 4: レビュー + 重い 3 本
    ok(/比率/.test(m.get('b').why) && /レビュー/.test(m.get('r').why) && m.get('a').model === 'sonnet');
    const many = { lanes: [lane('x', 1, { hard: 'h' }), lane('y', 1, { hard: 'h' }), lane('z', 1)] };
    eq([...F.assignModels(many).values()].map((x) => x.model), ['opus', 'opus', 'sonnet']);   // 目標 1 本でも hard の 2 本は Opus
    eq([...F.assignModels({ ...many, mix: { opus: 1 } }).values()].map((x) => x.model), ['opus', 'opus', 'opus']);
    eq(F.modelOf(lane('a', 100), { plan }).model, 'sonnet'); eq(F.modelOf(lane('b', 900), { plan }).model, 'opus');
    ok(F.checkPlan({ goal: 'x', base: 'b', mix: { opus: 2 }, lanes: [lane('a', 1)] }).some((b) => /mix\.opus/.test(b)));
  });
  await t('laneWork: ファイルの行数・関数の行数・details 40 行、新しいファイル 80 行、weight が勝つ', () => {
    const text = (f) => (f === 'a.mjs' ? 'function f() {\n  return 1;\n}\nfunction g() {}\n' : f === 'b.mjs' ? 'x\ny\n' : null);
    eq(F.laneWork({ owns: ['a.mjs#f'], details: ['d'] }, text), 3 + 40);
    eq(F.laneWork({ owns: ['b.mjs', 'new.mjs'] }, text), 3 + 80);
    eq(F.laneWork({ owns: ['b.mjs'], weight: 7 }, text), 7);
  });
  await t('sizePlan: 小さな仕事は 1 本（並行の起動代が高い）、大きい仕事は 1 本 1500 行までに割る、読む役は書く 4 本に 1 本', () => {
    const one = F.sizePlan([120, 80]);
    eq([one.writes, one.reviews], [1, 0]);
    const mid = F.sizePlan([900, 900, 900, 900]);
    ok(mid.writes >= 2 && mid.writes <= 4 && mid.reviews === 1, JSON.stringify(mid));
    const big = F.sizePlan(Array.from({ length: 12 }, () => 1400));
    ok(big.total <= F.MAX_LANES && big.writes >= 8 && big.reviews === Math.ceil(big.writes / 4), JSON.stringify(big));
    ok(mid.cost > 0 && mid.single > 0 && mid.cost >= mid.single, JSON.stringify(mid));
  });
  await t('brief: 司令塔は Opus、Sonnet 6 割・Opus 4 割、models と size の使い方', () => {
    const b = F.brief();
    ok(/司令塔で、モデルは Opus/.test(b) && /Sonnet 約 6 割・Opus 約 4 割/.test(b) && /fanout\.mjs models/.test(b) && /fanout\.mjs size/.test(b), b);
  });
  await t('modelOf: 既定は sonnet、レビューと hard は opus、計画の指定が勝つ、直しが 2 回通らなければ opus', () => {
    eq(F.modelOf({ name: 'a' }).model, 'sonnet');
    eq(F.modelOf({ name: 'r', readonly: true }).model, 'opus');
    eq(F.modelOf({ name: 'h', hard: '並行の待ち合わせ' }), { model: 'opus', why: '難しい: 並行の待ち合わせ' });
    eq(F.modelOf({ name: 'x', hard: true, model: 'sonnet' }).model, 'sonnet');
    eq([F.modelOf({ name: 'a' }, { round: 1 }).model, F.modelOf({ name: 'a' }, { round: 2 }).model], ['sonnet', 'opus']);
    ok(F.checkPlan({ goal: 'x', base: 'b', lanes: [{ name: 'a', goal: 'g', owns: ['f.mjs'], test: 't', model: 'haiku' }] }).some((b) => /model は/.test(b)));
  });
  await t('order: after の後ろに並ぶ', () => {
    eq(F.order({ lanes: [{ name: 'c', after: ['b'] }, { name: 'a' }, { name: 'b', after: ['a'] }] }), ['a', 'b', 'c']);
  });
  await t('changedLines: -U0 の差分から行番号', () => {
    const d = ['diff --git a/x.mjs b/x.mjs', '--- a/x.mjs', '+++ b/x.mjs', '@@ -3,2 +3,0 @@', '-a', '-b', '@@ -9 +7,2 @@', '-c', '+d', '+e'].join('\n');
    eq(F.changedLines(d), [{ file: 'x.mjs', oldLines: [3, 4, 9], newLines: [7, 8] }]);
  });
  await t('manualOnly / hasAutoTrigger: push・schedule を外し、workflow_dispatch の inputs は残す', () => {
    const y = ['name: v', 'on:', '  push:', '    branches: [main]', '  schedule: [{ cron: "1 * * * *" }]', '  workflow_dispatch:', '    inputs:', '      a:', '        default: x', '  pull_request:', '', 'jobs:', '  j: {}'].join('\n');
    ok(F.hasAutoTrigger(y));
    const n = F.manualOnly(y);
    eq(n, ['name: v', 'on:', '  workflow_dispatch:', '    inputs:', '      a:', '        default: x', '', 'jobs:', '  j: {}'].join('\n'));
    ok(!F.hasAutoTrigger(n));
    ok(!F.hasAutoTrigger(F.manualOnly('on: [push, pull_request]\njobs: {}')) && /workflow_dispatch/.test(F.manualOnly('on: push\njobs: {}')));
    ok(!F.hasAutoTrigger('on: workflow_dispatch\njobs: {}') && !F.hasAutoTrigger('on:\n  workflow_dispatch:\njobs: {}'));
  });
  await t('renderPrompt: 欄がすべて埋まり、読むだけのレーンには書く手順が出ない', () => {
    const tpl = fs.readFileSync(path.join(HERE, 'LANE.md'), 'utf8');
    const plan = { goal: 'G', base: 'abc', rules: ['R1'], lanes: [{ name: 'w', goal: 'WG', owns: ['a.mjs#f'], test: 'node t.mjs', details: ['D1'], worktree: '/wt/w', branch: 'fanout/w' }, { name: 'r', goal: 'RG', readonly: true, reviews: ['V1'], worktree: '/wt/r', branch: 'fanout/r' }] };
    let threw = false; try { F.renderPrompt(plan, { ...plan.lanes[0], worktree: undefined }, tpl); } catch { threw = true; }
    ok(threw, '作業フォルダの無いレーンのプロンプトは出さない');
    const w = F.renderPrompt(plan, plan.lanes[0], tpl), r = F.renderPrompt(plan, plan.lanes[1], tpl);
    ok(/cd \/wt\/w/.test(w) && /fanout\/w/.test(w) && /a\.mjs#f/.test(w) && /D1/.test(w) && /R1/.test(w) && /scope w/.test(w) && !/V1/.test(w) && !/\{\{/.test(w), w);
    ok(/V1/.test(r) && !/scope r/.test(r) && /読むだけ/.test(r) && !/\{\{/.test(r), r);
  });

  // ---- the real thing in a temporary git repository ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-')), sh = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
  const node = (...a) => sh(process.execPath, [path.join(dir, '.fanout', 'fanout.mjs'), ...a]);
  try {
    sh('git', ['init', '-q', '-b', 'main']); sh('git', ['config', 'user.email', 't@t']); sh('git', ['config', 'user.name', 't']);
    fs.cpSync(HERE, path.join(dir, '.fanout'), { recursive: true, filter: (f) => path.basename(f) !== 'plan.json' });
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'v.yml'), 'on:\n  push:\n  workflow_dispatch:\njobs: {}\n');
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(git:*)'], deny: ['Agent', 'Skill', 'WebFetch'] } }));
    fs.writeFileSync(path.join(dir, 'a.mjs'), '// f\nexport function f() {\n  return 1;\n}\n\nexport function g() {\n  return 2;\n}\n');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# repo\n');
    sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'base']);

    await t('install: 拒否から Agent / Skill を外し、Actions を手動だけに、AGENTS.md に規則（2 回目は足さない）', () => {
      const r = node('install'); ok(r.status === 0, r.stderr);
      const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
      eq(s.permissions.deny, ['WebFetch']); ok(s.permissions.allow.includes('Bash(node .fanout/fanout.mjs:*)'));
      ok(!F.hasAutoTrigger(fs.readFileSync(path.join(dir, '.github', 'workflows', 'v.yml'), 'utf8')));
      eq([s.model, s.env.CLAUDE_CODE_SUBAGENT_MODEL], ['opus', 'sonnet']);
      eq(s.hooks.SessionStart, [{ hooks: [{ type: 'command', command: 'node .fanout/fanout.mjs brief' }] }]);
      node('install');
      const s2 = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
      eq(s2.hooks.SessionStart.length, 1);   // 2 回目は足さない
      eq(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').split('fanout:rules').length, 2);
      // an older rules block is replaced (the block runs to the end of AGENTS.md)
      const af = path.join(dir, 'AGENTS.md'), cur = fs.readFileSync(af, 'utf8');
      fs.writeFileSync(af, cur.slice(0, cur.indexOf('<!-- fanout:rules -->')) + '<!-- fanout:rules -->\n古い規則\n');
      ok(/新しくした/.test(node('install').stdout)); ok(!/古い規則/.test(fs.readFileSync(af, 'utf8')) && fs.readFileSync(af, 'utf8').split('fanout:rules').length === 2);
      ok(node('actions-off', '--check').status === 0);
    });
    await t('new: commit していない変更があれば断る → commit 後に計画の雛形', () => {
      ok(node('new', 'x').status === 1);
      sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'install']);
      const r = node('new', '速くする'); ok(r.status === 0, r.stderr);
      const p = F.loadPlan(dir);
      p.lanes = [{ name: 'eff', goal: 'f を直す', owns: ['a.mjs#f', 'tests/eff.mjs'], test: 'node tests/eff.mjs' }, { name: 'gee', goal: 'g を直す', owns: ['a.mjs#g'], test: 'true', after: ['eff'] }];
      fs.writeFileSync(path.join(dir, '.fanout', 'plan.json'), JSON.stringify(p));
      const c = node('check'); ok(c.status === 0 && /eff → gee/.test(c.stdout), c.stdout + c.stderr);
      ok(node('prompt', 'eff').status === 1, '作業フォルダの前はプロンプトを出さない');
    });
    await t('scope: 担当の関数の中は ✔、外の関数・共有・担当外のファイルは ✘（未 commit・新しいファイルも見る）', () => {
      const a = path.join(dir, 'a.mjs'), orig = fs.readFileSync(a, 'utf8');
      fs.writeFileSync(a, orig.replace('return 1;', 'return 10;'));
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true }); fs.writeFileSync(path.join(dir, 'tests', 'eff.mjs'), 'ok\n');
      let r = node('scope', 'eff'); ok(r.status === 0, r.stderr);
      fs.writeFileSync(a, orig.replace('return 1;', 'return 10;').replace('return 2;', 'return 20;'));
      r = node('scope', 'eff'); ok(r.status === 1 && /担当の関数/.test(r.stderr), r.stderr);
      fs.writeFileSync(a, orig.replace('return 1;', 'return 10;')); fs.writeFileSync(path.join(dir, 'README.md'), 'x');
      r = node('scope', 'eff'); ok(r.status === 1 && /README\.md: 共有/.test(r.stderr), r.stderr);
      fs.rmSync(path.join(dir, 'README.md')); fs.writeFileSync(path.join(dir, 'other.mjs'), 'x');
      r = node('scope', 'eff'); ok(r.status === 1 && /other\.mjs: 担当の外/.test(r.stderr), r.stderr);
      fs.rmSync(path.join(dir, 'other.mjs'));
      // a new helper the lane owns, imported at the top: allowed; an import of anything else at the top: outside
      const p0 = F.loadPlan(dir); p0.lanes[0].owns.push('help.mjs'); fs.writeFileSync(path.join(dir, '.fanout', 'plan.json'), JSON.stringify(p0));
      fs.writeFileSync(path.join(dir, 'help.mjs'), 'export const h = 1;\n');
      fs.writeFileSync(a, "import { h } from './help.mjs';\n" + orig.replace('return 1;', 'return h;'));
      r = node('scope', 'eff'); ok(r.status === 0, r.stderr);
      fs.writeFileSync(a, "import { x } from './other.mjs';\n" + orig);
      r = node('scope', 'eff'); ok(r.status === 1 && /担当の関数/.test(r.stderr), r.stderr);
      fs.writeFileSync(a, orig); fs.rmSync(path.join(dir, 'help.mjs'));
    });
    await t('worktree の枝: record → status（commit 済みの枝を土台と比べる）', () => {
      // (a commit after the base, as the orchestrator's own: the lane's folder still starts at the base)
      fs.writeFileSync(path.join(dir, 'later.txt'), 'x'); sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'later']);
      const w = node('worktree', 'eff'); ok(w.status === 0 && /fanout\/eff/.test(w.stdout), w.stdout + w.stderr);
      const wt0 = F.loadPlan(dir).lanes[0].worktree;
      ok(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: wt0, encoding: 'utf8' }).stdout.trim() === F.loadPlan(dir).base, '作業フォルダは土台から');
      ok(!fs.existsSync(path.join(wt0, 'later.txt')));
      ok(/a\.mjs#f/.test(node('prompt', 'eff').stdout) && /cd .*fanout-eff/.test(node('prompt', 'eff').stdout));
      ok(node('worktree', 'eff').status === 0, '2 回目は既にあるものを使う');
      const wt = F.loadPlan(dir).lanes[0].worktree;
      fs.writeFileSync(path.join(wt, 'a.mjs'), fs.readFileSync(path.join(wt, 'a.mjs'), 'utf8').replace('return 1;', 'return 11;'));
      spawnSync('git', ['commit', '-qam', 'eff'], { cwd: wt });
      ok(node('record', 'eff', 'fanout/eff').status === 0);
      const inWt = spawnSync(process.execPath, [path.join(wt, '.fanout', 'fanout.mjs'), 'scope', 'eff'], { cwd: wt, encoding: 'utf8' });
      ok(inWt.status === 0 && /✔ eff/.test(inWt.stdout), `worktree の中の scope（計画は親のもの）: ${inWt.stdout}${inWt.stderr}`);
      const r = node('status'); ok(r.status === 0 && /✔ eff: fanout\/eff（1 commit）/.test(r.stdout) && /gee: 枝なし/.test(r.stdout), r.stdout + r.stderr);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(`${failed ? '✘' : '✔'} fanout selftest: ${pass} 通過、${failed} 失敗`);
  return failed === 0;
}
