#!/usr/bin/env node
// AI-driven development on GitHub (.github/workflows/ai-make.yml runs this):
//   an issue labeled `make` (or titled "make: ...")  → node lab.mjs make "<title + body>" --playtest → ship (branch + Release) → a comment
//   `/make <change>` commented on that issue          → node lab.mjs <lab> make -a <unit> "<change>" --playtest → ship → a comment
//   workflow_dispatch (request, unit?)                  → the same without an issue
// The unit an issue made is remembered in the bot's comment (<!-- bds-lab-unit <lab>/<name> -->). Only the repository's owner,
// members and collaborators can start it (LAB_CI_ANYONE=1: everyone; it spends API tokens). LAB_CI_DRY=1: gh and git pushes
// are printed, not run (tests/ci-offline.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRY = !!process.env.LAB_CI_DRY;
const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' }, BRANCH = { bds: 'addon', end: 'plugin', ll: 'mod' };
const WORD = { bds: 'アドオン', end: 'Endstone プラグイン', ll: 'LeviLamina mod' };
const say = (s) => console.log(s);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: TOP, encoding: 'utf8', maxBuffer: 256e6, ...opts });
// gh / git that change GitHub: printed in dry runs
const remote = (cmd, args) => { if (DRY) { say(`DRY ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`); return { status: 0, stdout: '' }; } return run(cmd, args); };

const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const evName = process.env.GITHUB_EVENT_NAME, repo = process.env.GITHUB_REPOSITORY ?? 'owner/repo';
const trusted = (a) => process.env.LAB_CI_ANYONE || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(a);
const issue = ev.issue ?? null;

// what to do: { text, unit?: 'lab/name' } or a reason to stop
function plan() {
  if (evName === 'workflow_dispatch') return { text: ev.inputs?.request ?? '', unit: ev.inputs?.unit || null };
  if (evName === 'issues') {
    const labels = (issue.labels ?? []).map((l) => l.name), titled = /^make\s*[:：]/i.test(issue.title);
    // opening an issue with the label sends `opened` and `labeled`: only one of them starts it
    const go = ev.action === 'labeled' ? ev.label?.name === 'make' : ev.action === 'opened' && titled && !labels.includes('make');
    if (!go) return { skip: `issues/${ev.action}: not a make request` };
    if (!trusted(issue.author_association)) return { skip: `${issue.user?.login} is not a collaborator` };
    return { text: `${issue.title.replace(/^make\s*[:：]\s*/i, '')}\n\n${issue.body ?? ''}`.trim(), unit: markerOf() };
  }
  if (evName === 'issue_comment') {
    const body = ev.comment?.body ?? '';
    if (!/^\/make\b/.test(body) || ev.comment?.user?.type === 'Bot') return { skip: 'not a /make comment' };
    if (!trusted(ev.comment.author_association)) return { skip: `${ev.comment.user?.login} is not a collaborator` };
    const unit = markerOf();
    const text = body.replace(/^\/make\s*/, '').trim();
    return { text: unit ? text : `${issue.title.replace(/^make\s*[:：]\s*/i, '')}\n\n${issue.body ?? ''}\n\n${text}`.trim(), unit };
  }
  return { skip: `event ${evName}` };
}
// the unit this issue already made (the newest marker in its comments)
function markerOf() {
  if (!issue) return null;
  let list = [];
  if (process.env.LAB_CI_COMMENTS) list = JSON.parse(fs.readFileSync(process.env.LAB_CI_COMMENTS, 'utf8'));   // tests
  else if (!DRY) { const r = run('gh', ['api', `repos/${repo}/issues/${issue.number}/comments`, '--paginate']); try { list = JSON.parse(r.stdout || '[]'); } catch { list = []; } }
  if (!Array.isArray(list)) list = [];   // gh answers an error object ({"message": ...}) when it cannot read the comments
  const m = list.map((c) => /<!-- bds-lab-unit (bds|end|ll)\/([\w-]+) -->/.exec(c.body ?? '')).filter(Boolean).at(-1);
  return m ? `${m[1]}/${m[2]}` : null;
}
function comment(body) {
  if (!issue) return;
  const f = path.join(TOP, '.lab-ci-comment.md');
  fs.writeFileSync(f, body);
  remote('gh', ['issue', 'comment', String(issue.number), '--repo', repo, '--body-file', f]);
  if (DRY) say(body);
}
function summary(s) { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n'); }

const p = plan();
if (p.skip) { say(`ci: nothing to do (${p.skip})`); process.exit(0); }
if (!p.text && !p.unit) { say('ci: empty request'); process.exit(1); }   // (a unit and no text: harden it, the playtester only)
if (!DRY) {   // commits from the workflow
  if (!run('git', ['config', 'user.email']).stdout.trim()) { run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']); run('git', ['config', 'user.name', 'github-actions[bot]']); }
}
let lab = null, name = null;
if (p.unit) {
  [lab, name] = p.unit.split('/');
  // the unit lives on its own branch (main is the template): bring its folder here
  const dir = path.join(lab, UNITS[lab], name);
  if (!fs.existsSync(path.join(TOP, dir))) {
    const f = remote('git', ['fetch', 'origin', `${BRANCH[lab]}/${name}`]);
    if (f.status === 0 && !DRY) run('git', ['checkout', 'FETCH_HEAD', '--', dir]);
  }
  if (!DRY && !fs.existsSync(path.join(TOP, dir))) { comment(`⚠️ \`${dir}\` が見つかりません（ブランチ \`${BRANCH[lab]}/${name}\`）。`); process.exit(1); }
}
const via = process.env.LAB_CI_VIA ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL ? 'openai' : null);
if (!via && !process.env.LAB_CI_VIA) { comment('⚠️ AI の鍵がありません。リポジトリの Settings → Secrets に `ANTHROPIC_API_KEY`（または `OPENAI_API_KEY`）を登録してください。'); process.exit(1); }
const rounds = process.env.LAB_CI_PLAYTEST || '1';
const harden = !p.text && lab;
const args = [path.join(TOP, 'lab.mjs'), ...(lab ? [lab] : []), 'make', ...(p.text ? [p.text] : []), '--via', via, ...(Number(rounds) || harden ? ['--playtest', String(Number(rounds) || 1)] : []), ...(lab ? ['-a', name] : []), ...(process.env.LAB_MODEL ? ['--model', process.env.LAB_MODEL] : [])];
say(`ci: ${harden ? `hardening ${lab}/${name} (playtest)` : lab ? `changing ${lab}/${name}` : 'making'} via ${via}${p.text ? ': ' + p.text.split('\n')[0].slice(0, 100) : ''}`);
if (DRY && process.env.LAB_CI_NOMAKE) { say(`DRY node lab.mjs ${args.slice(1).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`); process.exit(0); }   // tests: the call only
const r = run(process.execPath, args, { env: { ...process.env, LAB_NOTRACE: '1' } });
const outText = ((r.stdout ?? '') + (r.stderr ?? '')).trim();
say(outText);
const made = /^(MADE|NOT DONE) (addons|plugins|mods)\/([\w-]+) via (.+)$/m.exec(outText);
if (made) { lab ??= Object.keys(UNITS).find((k) => UNITS[k] === made[2]); name ??= made[3]; }
const ok = r.status === 0 && made?.[1] === 'MADE';
const lines = outText.split('\n');
const answer = (() => { const i = lines.findIndex((l) => /^(MADE|NOT DONE) /.test(l)), pl = lines.findIndex((l) => /^playtest: \d+ bug/.test(l)); const end = pl >= 0 ? pl : i; const s = lines.slice(Math.max(0, end - 6), end).filter((l) => !/^(DONE|PASS|FAIL|OK|Q |S |E |✘|  |make:|playtest:|BUG |PLAYTEST|pack:)/.test(l)); return s.slice(-2).join('\n'); })();
const play = lines.find((l) => /^playtest: \d+ bug/.test(l)) ?? '';
let links = '';
if (!ok && lab && name && fs.existsSync(path.join(TOP, lab, UNITS[lab], name))) {   // unfinished: the work goes to its branch (no Release), so `/make` continues it
  if (DRY) say(`DRY push ${BRANCH[lab]}/${name} (work in progress)`);
  else { const { makeGit } = await import('./github.mjs'); const G = makeGit(TOP, { units: `${lab}/${UNITS[lab]}`, branch: BRANCH[lab], vendor: 'bds/vendor/bedrock-server.zip', allUnits: Object.entries(UNITS).map(([k, u]) => `${k}/${u}`) }); G.snapshot(name, `${BRANCH[lab]}/${name}: work in progress`); G.push(`${BRANCH[lab]}/${name}`); }
}
if (ok && lab && name) {
  const s = remote(process.execPath, [path.join(TOP, 'lab.mjs'), lab, 'ship', '-a', name]);
  if (!DRY) say(((s.stdout ?? '') + (s.stderr ?? '')).trim());
  links = `- ブランチ: https://github.com/${repo}/tree/${BRANCH[lab]}/${name}\n- 配布物（Release）: https://github.com/${repo}/releases/tag/${BRANCH[lab]}-${name}`;
}
const tail = lines.filter((l) => /^(✘|  want|  got|E |Q |FAIL|DONE|PASS)/.test(l)).slice(-25).join('\n');
const body = ok
  ? `✅ ${WORD[lab]} \`${lab}/${UNITS[lab]}/${name}\` ${harden ? 'を AI プレイテストで鍛えました' : 'ができました'}（本物のサーバーと本物のクライアントでテストと品質チェックに合格）。\n\n${answer ? answer + '\n\n' : ''}${play ? `🧪 ${play.replace(/^playtest: /, 'AI プレイテスト: ')}\n\n` : ''}${links}\n\n${made[0].replace(/^MADE /, '')}\n\n変更したいときは \`/make <変更内容>\` とコメントしてください。\n<!-- bds-lab-unit ${lab}/${name} -->`
  : `❌ 完成しませんでした（${made ? made[0] : `exit ${r.status}`}）。\n\n<details><summary>最後の結果</summary>\n\n\`\`\`\n${tail || lines.slice(-25).join('\n')}\n\`\`\`\n</details>\n\n\`/make <補足>\` とコメントすると続きから直します。${lab && name ? `\n<!-- bds-lab-unit ${lab}/${name} -->` : ''}`;
comment(body);
summary(body);
process.exit(ok ? 0 : 1);
