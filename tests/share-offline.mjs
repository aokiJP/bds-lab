#!/usr/bin/env node
// `node lab.mjs share` (common/share.mjs) on a fake lab folder: the release carries the lab and its samples and nothing that is
// the person's (units, caches, servers, secrets, autopilot memory); a secret anywhere stops it; versions count up; the same
// tree gives the same zip; a release that does not work alone is not kept; `update` with it keeps what is yours; and the real
// samples.json matches what the docs call samples. No network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, n = 0;
const ok = (c, m, d = '') => { n++; console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'bdslab-share-t-')), X = path.join(T, 'lab');
const w = (r, s, root = X) => { const f = path.join(root, r); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const SECRET = 'sk-ant-api03-' + 'Q'.repeat(40);
w('lab.mjs', "console.log('topics: a b')\n");
w('lab.sh', '#!/bin/sh\n'); fs.chmodSync(path.join(X, 'lab.sh'), 0o755);
w('common/data/samples.json', JSON.stringify({ bds: ['demo'], end: ['s1'], ll: [] }));
w('common/engine.mjs', 'export const x = 1;\n');
w('bds/addons/demo/tests.txt', '## demo\n'); w('bds/addons/mine/tests.txt', '## mine\n');
w('end/plugins/s1/plugin.py', 'x = 1\n'); w('end/plugins/mine2/plugin.py', 'y = 2\n');
w('.env', `ANTHROPIC_API_KEY=${SECRET}\nGITHUB_PASSWORD=hunter2hunter2\n`); w('.env.local', 'GOOGLE_AAS_TOKEN=aas_et/' + 'A'.repeat(30) + '\n'); w('.env.example', 'ANTHROPIC_API_KEY=\n# sk-ant-...\n');
w('bds/.lab/bds/bedrock_server', 'bin'); w('bds/vendor/bedrock-server.zip', 'BDS'); w('bds/vendor/bds-version.txt', '1.26.51.1\n');
w('auto/ledger.jsonl', '{"id":"backlog:x","kind":"backlog","ok":true,"at":"2026-01-01T00:00:00Z"}\n'); w('auto/policy.json', '{"dailyTokens":5}'); w('auto/STOP', 'mine'); w('auto/BACKLOG.md', '- [ ] my private idea\n'); w('auto/.work/x/y', 'z');
w('bds/bench/ranking.json', JSON.stringify([{ id: 'r1', tokens: 5, logs: ['/home/me/.claude/x.jsonl'] }]));
w('common/vendored/dist/src/index.js', 'export {};\n'); w('bds/dist/Old.mcaddon', 'x');
w('dist/old.zip', 'old'); w('.lab-base.json', '{}'); w('.lab-kind', 'end\n'); w('app/runs/r1/shot.png', 'png'); w('github.token', 'x');
const share = (args, env = {}) => { const r = spawnSync(process.execPath, [path.join(REPO, 'lab.mjs'), 'share', ...args], { cwd: REPO, encoding: 'utf8', env: { ...process.env, LAB_SHARE_ROOT: X, LAB_DOTENV: 'off', ...env } }); return { status: r.status, t: (r.stdout ?? '') + (r.stderr ?? '') }; };
const { ZipReader } = await import(pathToFileURL(path.join(REPO, 'bedrock-binary', 'src', 'apk', 'zip.js')).href);
const list = (f) => { const z = new ZipReader(f); try { return Object.fromEntries(z.entries.filter((e) => !e.name.endsWith('/')).map((e) => [e.name.replace(/^bds-lab\//, ''), z.read(e.name).toString('utf8')])); } finally { z.close(); } };

// 1. a secret in a file that would ship: nothing is written
w('common/notes.md', `my key ${SECRET.slice(0, 20)}${SECRET.slice(20)}\n`);
let r = share([]);
ok(r.status !== 0 && /E common\/notes\.md:1: Anthropic API key/.test(r.t) && !r.t.includes(SECRET) && !fs.existsSync(path.join(X, 'dist', 'bds-lab-v1.0.0.zip')), 'a key in a shipped file: FAIL, nothing written, the key never printed', r.t);
w('common/notes.md', 'the password is hunter2hunter2\n');
r = share([]);
ok(r.status !== 0 && /a value from your \.env/.test(r.t), 'a value from .env (any shape) in a shipped file: FAIL', r.t);
w('common/notes.md', `token ghp_${'a1'.repeat(18)}\n`);
r = share([]);
ok(r.status !== 0 && /GitHub token/.test(r.t), 'a GitHub token: FAIL', r.t);
fs.rmSync(path.join(X, 'common', 'notes.md'));

// 2. the release: the lab and its samples; nothing of the person's
r = share([]);
const z1 = path.join(X, 'dist', 'bds-lab-v1.0.0.zip');
ok(r.status === 0 && fs.existsSync(z1) && fs.existsSync(z1 + '.sha256') && /left out 2 unit\(s\) of yours \(bds\/mine end\/mine2\)/.test(r.t), 'share: dist/bds-lab-v1.0.0.zip + .sha256; the person\'s units named as left out', r.t);
let L = list(z1);
ok(L['bds/addons/demo/tests.txt'] && L['end/plugins/s1/plugin.py'] && !Object.keys(L).some((k) => /addons\/mine|plugins\/mine2/.test(k)), 'samples in, the person\'s units out');
ok(!Object.keys(L).some((k) => /(^|\/)\.env$|\.env\.local|\.lab\/|bedrock-server\.zip|^dist\/|^bds\/dist\/|\.lab-base|\.lab-kind|runs\/|github\.token|auto\/\.work|auto\/STOP/.test(k)) && L['.env.example'] !== undefined && L['bds/vendor/bds-version.txt'], 'no secrets, caches, BDS, results, leftovers; .env.example and the pinned version stay', Object.keys(L).join(' '));
ok(L['common/vendored/dist/src/index.js'] !== undefined, 'vendored code under common/ keeps its dist/ (common/nethernet-connect/dist is what `lan` runs)', Object.keys(L).filter((k) => /dist/.test(k)).join(' '));
ok(L['auto/ledger.jsonl'] === '' && JSON.parse(L['auto/policy.json']).dailyTokens === 3000000 && !JSON.parse(L['auto/policy.json']).gate && !/private idea/.test(L['auto/BACKLOG.md']) && !L['bds/bench/ranking.json'].includes('/home/me') && JSON.parse(L['bds/bench/ranking.json'])[0].tokens === 5, 'the autopilot memory is fresh, the bench rows keep their numbers but not local paths');
ok(L.VERSION === '1.0.0\n' && /## v1\.0\.0/.test(L['CHANGES.md']) && fs.readFileSync(path.join(X, 'VERSION'), 'utf8') === '1.0.0\n', 'VERSION and CHANGES.md in the zip and the folder');
const S1 = JSON.parse(L['common/data/shipped.json'] ?? '{}');
ok(S1.version === '1.0.0' && /^[0-9a-f]{12}$/.test(S1.files?.['lab.mjs'] ?? '') && !S1.files['common/data/shipped.json'] && !Object.keys(S1.files).some((k) => /addons\/mine/.test(k)) && JSON.parse(fs.readFileSync(path.join(X, 'common', 'data', 'shipped.json'), 'utf8')).version === '1.0.0',
  'shipped.json: every file the release ships with its sha256 (what `update` compares), in the zip and the folder', JSON.stringify(S1).slice(0, 300));
const zr = new ZipReader(z1); const mode = zr.entries.find((e) => e.name === 'bds-lab/lab.sh'); zr.close();
ok(fs.readFileSync(path.join(X, 'auto', 'ledger.jsonl'), 'utf8').includes('"kind":"share"') && fs.existsSync(path.join(X, 'auto', 'STOP')), 'the folder keeps its own memory (and a share row for the autopilot)');
void mode;

// 3. versions and the same bytes for the same tree
fs.mkdirSync(path.join(X, 'docs'), { recursive: true }); fs.writeFileSync(path.join(X, 'docs', 'old-note.md'), '# an old note\n');
r = share([]); ok(r.status === 0 && fs.existsSync(path.join(X, 'dist', 'bds-lab-v1.0.1.zip')), 'again: v1.0.1', r.t);
fs.rmSync(path.join(X, 'docs', 'old-note.md'));
r = share(['--bump', 'minor']); ok(r.status === 0 && fs.existsSync(path.join(X, 'dist', 'bds-lab-v1.1.0.zip')), '--bump minor: v1.1.0', r.t);
const G = JSON.parse(list(path.join(X, 'dist', 'bds-lab-v1.1.0.zip'))['common/data/shipped.json']).gone['docs/old-note.md'];
ok(G?.since === '1.1.0' && G.sha.length === 1, 'shipped.json: a file the previous release shipped and this one does not is listed as gone, with the release that dropped it', JSON.stringify(G));
const h = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const z2 = path.join(X, 'dist', 'bds-lab-v1.1.0.zip'), h1 = h(z2);
r = share(['--bump', 'none']); ok(r.status === 0 && h(z2) === h1 && fs.readFileSync(z2 + '.sha256', 'utf8').startsWith(h1), 'the same tree, the same zip byte for byte (the sha256 means something)', r.t);
r = share(['--bump', 'none', '--release'], { LAB_CI_DRY: '1' }); ok(/DRY gh release create lab-v1\.1\.0/.test(r.t), '--release: a GitHub Release lab-v<version>', r.t);

// 4. a release that does not work alone is not kept
w('common/data/samples.json', JSON.stringify({ bds: ['demo', 'gone'], end: ['s1'], ll: [] }));
r = share([]);
ok(r.status !== 0 && /a sample is missing: bds\/gone/.test(r.t) && !fs.existsSync(path.join(X, 'dist', 'bds-lab-v1.1.1.zip')) && fs.readFileSync(path.join(X, 'VERSION'), 'utf8') === '1.1.0\n', 'verify fails: the zip is removed, VERSION unchanged', r.t);
w('common/data/samples.json', JSON.stringify({ bds: ['demo'], end: ['s1'], ll: [] }));

// 5. update with the release keeps what is the person's (units, the autopilot's memory and settings)
const U = path.join(T, 'theirs');
w('auto/ledger.jsonl', '{"id":"x"}\n', U); w('auto/policy.json', '{"merge":"pr"}', U); w('bds/addons/mine/tests.txt', 'theirs', U); w('common/engine.mjs', 'old', U); w('lab.mjs', 'old', U);
const { update } = await import(pathToFileURL(path.join(REPO, 'common', 'update.mjs')).href);
update(U, z2, () => {});
ok(fs.readFileSync(path.join(U, 'auto', 'ledger.jsonl'), 'utf8') === '{"id":"x"}\n' && fs.readFileSync(path.join(U, 'auto', 'policy.json'), 'utf8') === '{"merge":"pr"}' && fs.readFileSync(path.join(U, 'common', 'engine.mjs'), 'utf8') === 'export const x = 1;\n' && fs.readFileSync(path.join(U, 'bds/addons/mine/tests.txt'), 'utf8') === 'theirs', 'update <release>: the engine replaced; their ledger, policy and units kept');

// 6. the real samples.json says what the docs call samples, and every one exists
const S = JSON.parse(fs.readFileSync(path.join(REPO, 'common', 'data', 'samples.json'), 'utf8'));
for (const [k, d] of [['end', 'plugins'], ['ll', 'mods']]) {
  const ideas = [...(fs.readFileSync(path.join(REPO, k, 'help.md'), 'utf8').split(/^## /m).find((x) => x.startsWith('ideas')) ?? '').matchAll(/^- ([a-z0-9_]+):/gm)].map((m) => m[1]);
  ok(ideas.length && ideas.every((x) => S[k].includes(x)) && S[k].every((x) => fs.existsSync(path.join(REPO, k, d, x))), `${k}: every \`help ideas\` sample is in samples.json and exists (${ideas.length})`);
  const said = Number(/as (\d+) working (?:plugins|mods)/.exec(fs.readFileSync(path.join(REPO, k, 'AGENTS.md'), 'utf8'))?.[1]);
  ok(said === ideas.length, `${k}/AGENTS.md says how many \`help ideas\` has (${said} = ${ideas.length})`);
}
ok(S.bds.every((x) => fs.existsSync(path.join(REPO, 'bds', 'addons', x))), 'bds samples exist');

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${fails ? 'FAIL' : 'PASS'} share-offline (${n - fails}/${n})`);
process.exit(fails ? 1 : 0);
