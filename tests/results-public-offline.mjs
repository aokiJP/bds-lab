#!/usr/bin/env node
// app checks for a public repository, no network (a fake GitHub API on 127.0.0.1, a fake gh on PATH):
//  1. --seal <runs>: not private → each run folder becomes results.sealed (the vault's key) + summary.json in the clear,
//     with no screen text, log line, step text, e-mail or device id; private → nothing changes; no key → nothing but summary.json
//  2. checks (the report job): a sealed run → one check from summary.json alone; an unsealed one → as before (screens too)
//  3. this machine's way back: app ci fetch <run> takes the artifact, opens it with the key, the run is as it was;
//     another key / no key → says what to do, the summary stays
// node tests/results-public-offline.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (c, m, d = '') => { console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-14).join('\n  ')}`); if (!c) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'results-public-'));
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const KEY = 'test-only-results-key-1', EMAIL = 'someone.private@example.com', SCREEN = 'SCREEN-TEXT-ON-THE-TITLE', LOG = 'LOGCAT-LINE-ANDROID-ID-0123456789abcdef', STEP = 'chat my-secret-words';
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), crypto.randomBytes(3000)]);
// a run folder as app run leaves it (two steps passed, the second of three failed)
const makeRun = (root, name = '20261007-120000-demo') => {
  const d = path.join(root, name);
  w(path.join(d, 'report.md'), `# app: FAIL — demo\n\n| | |\n|---|---|\n| 結果 | FAIL |\n| アプリ | 1.21.120.4 (912012004) |\n| BDS | 1.21.120.4 |\n| 時間 | 95s |\n\n## 手順\n\n- ✔ 1: \`join\`\n- ✘ 2: \`${STEP}\` — ${SCREEN} ${EMAIL}\n`);
  w(path.join(d, 'result.json'), JSON.stringify({ ok: false, addon: 'demo', app: { versionName: '1.21.120.4', versionCode: 912012004 }, bds: { version: '1.21.120.4', exact: true }, started: 1000, ended: 96_000, timing: { join: 12_345 }, results: [{ ok: true, line: 3, raw: 'join' }, { ok: false, line: 7, raw: STEP, note: SCREEN }, { ok: true, line: 9, raw: 'wait 1' }], notes: [EMAIL] }));
  w(path.join(d, 'steps.txt'), `OK   3 join\nFAIL 7 ${STEP}  ${SCREEN}\nOK   9 wait 1\n`);
  w(path.join(d, 'run.txt'), `E something failed ${LOG}\n${EMAIL}\n`);
  w(path.join(d, 'logcat.txt'), `${LOG}\n`);
  w(path.join(d, 'shots', '01-title.png'), PNG);
  return d;
};
const tree = (d) => fs.readdirSync(d, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(d, f)).isFile()).sort()
  .map((f) => `${f.split(path.sep).join('/')} ${crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex').slice(0, 16)}`);
// the lab, as the workflow runs it (async: the fake API answers in this process)
const lab = (args, env = {}) => new Promise((res) => {
  const e = { ...process.env, LAB_DOTENV: 'off', GITHUB_ACTIONS: 'true', ...env };
  for (const k of ['GOOGLE_EMAIL', 'GOOGLE_AAS_TOKEN', 'GOOGLE_PASSWORD', 'APP_CACHE_KEY']) if (!(k in env)) delete e[k];
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'app', ...args], { cwd: TOP, env: e });
  let text = ''; c.stdout.on('data', (b) => { text += b; }); c.stderr.on('data', (b) => { text += b; });
  const timer = setTimeout(() => c.kill('SIGKILL'), 120_000);
  c.on('close', (status) => { clearTimeout(timer); res({ status, text }); });
});
const PUB = { APP_REPO_VISIBILITY: 'public', APP_CACHE_KEY: KEY };

// ---- 1. --seal ----
const runs = path.join(tmp, 'runs'), run = makeRun(runs), before = tree(run);
const keep = path.join(tmp, 'original'); fs.cpSync(run, keep, { recursive: true });
let r = await lab(['checks', '--seal', runs], PUB);
ok(r.status === 0 && /OK .*results\.sealed/.test(r.text), 'public with a key: sealed', r.text);
ok(JSON.stringify(fs.readdirSync(run).sort()) === JSON.stringify(['results.sealed', 'summary.json']), 'only results.sealed and summary.json are left', fs.readdirSync(run).join(' '));
const sumText = fs.readFileSync(path.join(run, 'summary.json'), 'utf8'), sum = JSON.parse(sumText);
ok(sum.ok === false && sum.steps === 3 && JSON.stringify(sum.failed) === '[2]' && JSON.stringify(sum.failed_lines) === '[7]' && sum.seconds === 95 && sum.join_seconds === 12.3 && sum.bds === '1.21.120.4' && sum.app === '1.21.120.4' && sum.addon === 'demo' && sum.sealed === true, 'summary.json: the verdict, the steps and which failed, seconds, the versions', sumText);
ok(![EMAIL, SCREEN, LOG, STEP, 'my-secret-words', '0123456789abcdef', '01-title', KEY].some((x) => sumText.includes(x)), 'summary.json: no e-mail, screen text, log line, step text, device id, screenshot or key', sumText);
const sealedBuf = fs.readFileSync(path.join(run, 'results.sealed'));
ok(sealedBuf.subarray(0, 8).toString() === 'BDSLABV1' && ![EMAIL, SCREEN, LOG].some((x) => sealedBuf.includes(Buffer.from(x))), "the vault's form, nothing readable in it");
ok(!r.text.includes(KEY) && !r.text.includes(EMAIL) && !r.text.includes(SCREEN), 'nothing of the key or the run in what it says', r.text);
r = await lab(['checks', '--seal', runs], PUB);
ok(r.status === 0 && JSON.stringify(fs.readdirSync(run).sort()) === '["results.sealed","summary.json"]', 'again: nothing more to seal', r.text);

// private: nothing changes
const privRuns = path.join(tmp, 'priv'), priv = makeRun(privRuns), privBefore = tree(priv);
r = await lab(['checks', '--seal', privRuns], { APP_REPO_VISIBILITY: 'private', APP_CACHE_KEY: KEY });
ok(r.status === 0 && JSON.stringify(tree(priv)) === JSON.stringify(privBefore) && /private/.test(r.text), 'private: nothing changes', r.text);
// public without a key: not uploaded at all (summary.json only)
const noKeyRuns = path.join(tmp, 'nokey'), noKey = makeRun(noKeyRuns);
r = await lab(['checks', '--seal', noKeyRuns], { APP_REPO_VISIBILITY: 'public' });
const nk = JSON.parse(fs.readFileSync(path.join(noKey, 'summary.json'), 'utf8'));
ok(r.status === 0 && /^W .*鍵がありません/m.test(r.text) && JSON.stringify(fs.readdirSync(noKey)) === '["summary.json"]' && nk.sealed === false && nk.steps === 3, 'public without a key: said, the contents gone, summary.json only', r.text);
// internal and a missing visibility are not private either
for (const v of ['internal', undefined]) {
  const d0 = path.join(tmp, `vis-${v}`), d = makeRun(d0);
  r = await lab(['checks', '--seal', d], { APP_REPO_VISIBILITY: v, APP_CACHE_KEY: KEY });
  ok(r.status === 0 && fs.existsSync(path.join(d, 'results.sealed')) && !fs.existsSync(path.join(d, 'report.md')), `${v ?? '(no visibility)'}: sealed (a run folder given itself works too)`, r.text);
}

// ---- 2. checks (report job) through a fake GitHub API ----
const posts = [];
const server = http.createServer((q, s) => {
  let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
    if (q.method === 'POST' && q.url.endsWith('/check-runs')) { posts.push(JSON.parse(b)); s.writeHead(201, { 'content-type': 'application/json' }); s.end('{}'); return; }
    s.writeHead(404); s.end('{}');
  });
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const API = { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_TOKEN: 'fake-token', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc123', GITHUB_RUN_ID: '424242' };
r = await lab(['checks', runs], { ...API, APP_REPO_VISIBILITY: 'public' });
const all = JSON.stringify(posts);
ok(r.status === 0 && posts.length === 1 && /^FAIL .*中身は暗号化/.test(posts[0].output.title), 'a sealed run: one check (no logcat, no screens)', r.text + all);
ok(/手順 3 個、落ちた: 2 番目（7 行目）/.test(posts[0].output.summary) && /1\.21\.120\.4/.test(posts[0].output.summary) && /95s/.test(posts[0].output.summary) && !posts[0].output.text, 'its summary: the verdict, which step, versions, seconds; no text', posts[0]?.output?.summary);
ok(/中身は暗号化されています: 手元で node lab\.mjs app ci watch 424242/.test(posts[0].output.summary), 'one line: where to read it', posts[0]?.output?.summary);
ok(![EMAIL, SCREEN, LOG, STEP, 'my-secret-words', 'base64'].some((x) => all.includes(x)), 'no e-mail, screen text, log line or step text in the check', all);
const sealedChecks = posts.splice(0);
posts.length = 0;
r = await lab(['checks', noKeyRuns], { ...API, APP_REPO_VISIBILITY: 'public' });
ok(r.status === 0 && posts.length === 1 && /中身は出していません/.test(posts[0].output.title) && /鍵が無かった/.test(posts[0].output.summary), 'no key: the check says the contents were not uploaded', JSON.stringify(posts));
posts.length = 0;
r = await lab(['checks', privRuns], { ...API, APP_REPO_VISIBILITY: 'private' });
ok(r.status === 0 && posts.some((p) => /^app: 画面 01-title\.png/.test(p.name)) && posts.some((p) => p.name === 'app: 結果' && /^FAIL 20261007/.test(p.output.title)) && !JSON.stringify(posts).includes('中身は暗号化'), 'not sealed: as before (the report, the screens)', JSON.stringify(posts.map((p) => p.name)));
server.close();

// ---- 3. this machine: app ci fetch <run> (a fake gh) opens the sealed artifact ----
const id = String(900_000_000 + Math.floor(Math.random() * 99_999_999)), gotDir = path.join(TOP, 'app', 'runs', `gh-${id}`);
const art = path.join(tmp, 'artifact'), artName = `app-demo-${id}`;
fs.cpSync(runs, path.join(art, artName), { recursive: true });
w(path.join(tmp, 'checks.jsonl'), sealedChecks.map((p) => JSON.stringify({ name: p.name, external_id: id, output: p.output })).join('\n') + '\n');
const bin = path.join(tmp, 'bin');
w(path.join(bin, 'gh'), `#!${process.execPath}
const fs = require('fs'), path = require('path'), a = process.argv.slice(2), T = ${JSON.stringify(tmp)}, ID = ${JSON.stringify(id)};
if (a[0] === '--version') { console.log('gh version 2.0.0 (fake)'); process.exit(0); }
if (a[0] === 'run' && a[1] === 'download') { const d = a[a.indexOf('-D') + 1]; fs.cpSync(path.join(T, 'artifact'), d, { recursive: true }); process.exit(0); }
if (a[0] === 'api') {
  const u = a[1];
  if (u === 'repos/o/r/actions/runs/' + ID) { console.log(JSON.stringify({ id: Number(ID), head_sha: 'abc123', status: 'completed', conclusion: 'failure' })); process.exit(0); }
  if (u.startsWith('repos/o/r/commits/abc123/check-runs')) { process.stdout.write(fs.readFileSync(path.join(T, 'checks.jsonl'), 'utf8')); process.exit(0); }
  if (u === 'repos/o/r/actions/runs/' + ID + '/jobs') { console.log('{"jobs":[]}'); process.exit(0); }
}
console.error('fake gh: ' + a.join(' ')); process.exit(1);
`);
fs.chmodSync(path.join(bin, 'gh'), 0o755);
const PATHX = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
try {
  r = await lab(['ci', 'fetch', id, '--repo', 'o/r'], { ...PATHX, APP_CACHE_KEY: KEY });
  const back = fs.existsSync(gotDir) ? tree(gotDir) : [];
  ok(r.status === 0 && /暗号化された結果を開きました/.test(r.text), 'the key of .env.local: opened', r.text);
  ok(before.every((l) => back.includes(l)), 'every file as it was (the same bytes): report, logs, the screenshot', `${before.join('\n')}\n----\n${back.join('\n')}`);
  ok(new RegExp(`FAIL app/runs/gh-${id}`).test(r.text) && /✘ 2:/.test(r.text) && !fs.existsSync(path.join(gotDir, '.artifacts')), 'the report read as before, the download folder gone', r.text);
  // another key: says so, the summary stays, nothing of the run
  r = await lab(['ci', 'fetch', id, '--repo', 'o/r'], { ...PATHX, APP_CACHE_KEY: 'another-key' });
  ok(r.status === 0 && /開けません/.test(r.text) && /APP_CACHE_KEY/.test(r.text) && fs.existsSync(path.join(gotDir, 'report.md')) && !fs.existsSync(path.join(gotDir, 'run.txt')) && !fs.existsSync(path.join(gotDir, 'shots', '01-title.png')), 'another key: what to do, only the summary', r.text);
  r = await lab(['ci', 'fetch', id, '--repo', 'o/r'], { ...PATHX });
  ok(r.status === 0 && /開く鍵がありません/.test(r.text) && /\.env\.local/.test(r.text) && !fs.existsSync(path.join(gotDir, 'run.txt')), 'no key: what to do, only the summary', r.text);
  // checks --open by itself (the way redroid's artifacts are opened): in place, the sealed file gone
  const copy = path.join(tmp, 'open-copy'); fs.cpSync(runs, copy, { recursive: true });
  r = await lab(['checks', '--open', copy], { APP_CACHE_KEY: KEY, GITHUB_ACTIONS: undefined });
  const opened = tree(path.join(copy, path.basename(run)));
  ok(r.status === 0 && before.every((l) => opened.includes(l)) && !fs.existsSync(path.join(copy, path.basename(run), 'results.sealed')), 'checks --open: in place, the same files', r.text);
  r = await lab(['checks', '--open', copy], { APP_CACHE_KEY: KEY, GITHUB_ACTIONS: undefined });
  ok(r.status === 0 && /ありません/.test(r.text), 'nothing sealed: said', r.text);
  // redroid's artifact (out/: files right in it) sealed as itself, opened by app ci fetch --device redroid
  const out = path.join(tmp, 'out'); w(path.join(out, 'report.md'), `# app: PASS — demo\n${SCREEN}\n`); w(path.join(out, 'run-01.png'), PNG);
  const outBefore = tree(out);
  r = await lab(['checks', '--seal', out], PUB);
  ok(r.status === 0 && JSON.stringify(fs.readdirSync(out).sort()) === '["results.sealed","summary.json"]' && JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')).ok === true, "redroid's out/: sealed as one folder", r.text);
  fs.rmSync(art, { recursive: true, force: true }); fs.cpSync(out, path.join(art, 'redroid-game'), { recursive: true });
  r = await lab(['ci', 'fetch', id, '--repo', 'o/r', '--device', 'redroid'], { ...PATHX, APP_CACHE_KEY: KEY });
  const rd = path.join(gotDir, 'redroid-game');
  ok(fs.existsSync(rd) && outBefore.every((l) => tree(rd).includes(l)) && /暗号化された結果を開きました/.test(r.text) && r.text.includes(SCREEN), 'redroid: opened in place, its report read', r.text);
} finally { fs.rmSync(gotDir, { recursive: true, force: true }); }
ok(JSON.stringify(tree(keep)) === JSON.stringify(before), '(the copy of the original is untouched)');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `✘ ${fails} failed` : '✔ all passed');
process.exit(fails ? 1 : 0);
