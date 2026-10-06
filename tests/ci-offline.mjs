#!/usr/bin/env node
// The GitHub pipeline (common/ci.mjs) against fake events and a fake Anthropic server, in dry mode (gh and pushes printed):
// an issue labeled `make` builds a unit and answers with a marker; `/make <change>` on it changes that unit; strangers and
// the duplicate `opened` event do nothing.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// these tests make units in this lab: each lab's current-unit marker is put back as it was when they end
const MARKS = ['bds', 'end', 'll'].map((k) => path.join(TOP, k, '.lab', 'addon')), marks0 = MARKS.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } });
process.on('exit', () => MARKS.forEach((f, i) => { try { if (marks0[i] === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, marks0[i]); } catch { /* best effort */ } }));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-ci-'));
let fails = 0;
const ok = (c, m, d = '') => { console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + d.split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const seen = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { seen.push(JSON.parse(b)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ content: [{ type: 'text', text: 'ルビーを配ります。\n参加すると3個もらえます。' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' })); }); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}`;
const kind0 = (() => { try { return fs.readFileSync(path.join(TOP, '.lab-kind'), 'utf8'); } catch { return null; } })();
const ci = (name, ev, extra = {}) => new Promise((res) => {
  const f = path.join(T, `ev-${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(ev));
  const c = spawn(process.execPath, [path.join(TOP, 'common', 'ci.mjs')], { cwd: TOP, env: { ...process.env, GITHUB_EVENT_PATH: f, GITHUB_EVENT_NAME: name, GITHUB_REPOSITORY: 'me/lab', LAB_CI_DRY: '1', LAB_MAKE_VERIFY: 'off', LAB_NETENV: 'off', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: url, LAB_CI_PLAYTEST: '0', ...extra } });
  let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; }); c.on('close', (status) => res({ status, t }));
});
const issue = { number: 7, title: 'make: 初参加でルビー(ci_ruby)を3個配る', body: 'ルビーは lab:ruby', user: { login: 'me' }, author_association: 'OWNER', labels: [{ name: 'make' }] };
fs.rmSync(path.join(TOP, 'bds', 'addons', 'ruby_lab'), { recursive: true, force: true });
let r = await ci('issues', { action: 'opened', issue });
ok(r.status === 0 && /nothing to do/.test(r.t) && !seen.length, 'opened with the label: left to the labeled event (no double run)', r.t);
r = await ci('issues', { action: 'labeled', label: { name: 'make' }, issue });
const m = /<!-- bds-lab-unit (bds)\/([\w-]+) -->/.exec(r.t);
ok(r.status === 0 && m && /DRY gh issue comment 7 --repo me\/lab/.test(r.t) && /DRY .*lab\.mjs bds ship -a /.test(r.t), `labeled make: built, shipped, answered with the unit marker (${m?.[2]})`, r.t);
ok(/ルビーを配ります/.test(r.t) && /アドオン `bds\/addons\//.test(r.t), 'the answer carries the AI summary and the unit path', r.t);
ok(/初参加でルビー\(ci_ruby\)を3個配る\\n\\nルビーは lab:ruby/.test(JSON.stringify(seen[0]?.messages?.[0])), 'the request is the issue title (without "make:") and body');
const name = m?.[2];
fs.writeFileSync(path.join(T, 'comments.json'), JSON.stringify([{ body: `done <!-- bds-lab-unit bds/${name} -->` }]));
seen.length = 0;
r = await ci('issue_comment', { action: 'created', issue, comment: { body: '/make 5個にして', user: { login: 'me', type: 'User' }, author_association: 'COLLABORATOR' } }, { LAB_CI_COMMENTS: path.join(T, 'comments.json') });
ok(r.status === 0 && new RegExp(`changing bds/${name}`).test(r.t) && /Change the Minecraft Bedrock addon/.test(JSON.stringify(seen[0]?.messages?.[0])) && /5個にして/.test(fs.readFileSync(path.join(TOP, 'bds', 'addons', name, 'TASK.md'), 'utf8')), '/make <change>: that unit is changed (edit mode)', r.t);
seen.length = 0;
r = await ci('issue_comment', { action: 'created', issue, comment: { body: '/make もっと', user: { login: 'x', type: 'User' }, author_association: 'NONE' } }, { LAB_CI_COMMENTS: path.join(T, 'comments.json') });
ok(r.status === 0 && /not a collaborator/.test(r.t) && !seen.length, 'a stranger cannot spend the tokens', r.t);
r = await ci('issue_comment', { action: 'created', issue, comment: { body: 'nice', user: { login: 'me', type: 'User' }, author_association: 'OWNER' } });
ok(r.status === 0 && /not a \/make comment/.test(r.t), 'other comments are ignored', r.t);
r = await ci('workflow_dispatch', { inputs: { request: '', unit: `bds/${name}` } }, { LAB_CI_NOMAKE: '1' });
ok(r.status === 0 && new RegExp(`hardening bds/${name} \\(playtest\\)`).test(r.t) && new RegExp(`DRY node lab\\.mjs bds make --via anthropic --playtest 1 -a ${name}`).test(r.t), 'dispatch with a unit and no request: harden it (make -a <unit> --playtest)', r.t);
if (name) fs.rmSync(path.join(TOP, 'bds', 'addons', name), { recursive: true, force: true });
const rf = path.join(TOP, 'bds', 'bench', 'ranking.json');
fs.writeFileSync(rf, JSON.stringify(JSON.parse(fs.readFileSync(rf, 'utf8')).filter((x) => !/^(make|edit):(初参加でルビー|5個にして)/.test(x.task)), null, 1) + '\n');
if (kind0 !== null) fs.writeFileSync(path.join(TOP, '.lab-kind'), kind0);
fs.rmSync(path.join(TOP, '.lab-ci-comment.md'), { force: true });
srv.close(); fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} ci-offline`);
process.exit(fails ? 1 : 0);
