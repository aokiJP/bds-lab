#!/usr/bin/env node
// `make` over the API, against fake Anthropic / OpenAI servers that replay a scripted build: the loop runs the tools,
// sends results back, caches, counts tokens, writes the ranking row. No BDS, no network (LAB_MAKE_VERIFY=off skips `go`).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const TOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// these tests make units in this lab: each lab's current-unit marker is put back as it was when they end
const MARKS = ['bds', 'end', 'll'].map((k) => path.join(TOP, k, '.lab', 'addon')), marks0 = MARKS.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } });
process.on('exit', () => MARKS.forEach((f, i) => { try { if (marks0[i] === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, marks0[i]); } catch { /* best effort */ } }));
let fails = 0;
const ok = (c, m, d = '') => { console.log(`${c ? '✔' : '✘'} ${m}${c || !d ? '' : '\n  ' + String(d).split('\n').slice(-12).join('\n  ')}`); if (!c) fails++; };
const MAIN = "import { world } from '@minecraft/server';\nimport { give, once } from './kit';\nworld.afterEvents.playerSpawn.subscribe(({ player }) => { if (once(player, 'r')) give(player, 'lab:ruby', 3); });\n";
const TESTS = '## ruby\n@A join\nwait 300\njs inv(p(\'A\')).join()\n~ lab:ruby\\*3\n';
const script = [
  [{ name: 'lab', input: { args: 'add item lab:ruby "Ruby" ja=ルビー tex=gem:e0115f max_stack_size=16' } }, { name: 'write', input: { path: 'src/main.ts', content: MAIN } }],
  [{ name: 'write', input: { path: 'tests.txt', content: TESTS } }, { name: 'edit', input: { path: 'TASK.md', old: '- [ ] \n', new: '- [ ] 3 rubies on first join\n' } }],
  [{ name: 'read', input: { path: '../../../etc-passwd-escape/../../../../etc/passwd' } }],
  'Rubies are given on first join.\nJoin the world to get 3.',
];
function serve(kind, steps = script) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => {
      const j = JSON.parse(b); seen.push(j);
      const step = steps[seen.length - 1] ?? 'done';
      const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 };
      let body;
      if (kind === 'anthropic') body = { content: typeof step === 'string' ? [{ type: 'text', text: step }] : step.map((c, i) => ({ type: 'tool_use', id: `t${seen.length}_${i}`, name: c.name, input: c.input })), usage, stop_reason: typeof step === 'string' ? 'end_turn' : 'tool_use' };
      else body = { choices: [{ message: typeof step === 'string' ? { role: 'assistant', content: step } : { role: 'assistant', content: null, tool_calls: step.map((c, i) => ({ id: `c${seen.length}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } }], usage: { prompt_tokens: 1100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 1000 } } };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}
const run = (args, env) => new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), ...args], { cwd: TOP, env: { ...process.env, LAB_MAKE_VERIFY: 'off', LAB_NETENV: 'off', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', ...env } }); let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; }); c.on('close', (status) => res({ status, t })); });
const kind0 = (() => { try { return fs.readFileSync(path.join(TOP, '.lab-kind'), 'utf8'); } catch { return null; } })();
for (const kind of ['anthropic', 'openai']) {
  const f = await serve(kind);
  const name = `mk_${kind}`;
  fs.rmSync(path.join(TOP, 'bds', 'addons', name), { recursive: true, force: true });
  const env = { ...process.env, LAB_MAKE_VERIFY: 'off', LAB_NETENV: 'off', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', ...(kind === 'anthropic' ? { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: f.url } : { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: f.url + '/v1', OPENAI_MODEL: 'fake' }) };
  const r = await new Promise((res) => { const c = spawn(process.execPath, [path.join(TOP, 'lab.mjs'), 'bds', 'make', 'Give 3 rubies on first join', '--via', kind, '--name', name], { cwd: TOP, env }); let t = ''; c.stdout.on('data', (d) => { t += d; }); c.stderr.on('data', (d) => { t += d; }); c.on('close', (status) => res({ status, t })); });
  const o = r.t;
  const dir = path.join(TOP, 'bds', 'addons', name);
  ok(r.status === 0 && /^MADE addons\/mk_/m.test(o), `${kind}: make finishes (${o.trim().split('\n').at(-1)})`);
  ok(fs.existsSync(path.join(dir, 'bp', 'items', 'ruby.json')) && fs.readFileSync(path.join(dir, 'rp', 'texts', 'ja_JP.lang'), 'utf8').includes('ルビー'), `${kind}: lab tool ran (add item with ja name)`);
  ok(fs.readFileSync(path.join(dir, 'src', 'main.ts'), 'utf8') === MAIN && fs.readFileSync(path.join(dir, 'tests.txt'), 'utf8') === TESTS, `${kind}: write tool wrote the files`);
  ok(fs.readFileSync(path.join(dir, 'TASK.md'), 'utf8').includes('3 rubies on first join'), `${kind}: edit tool edited TASK.md`);
  const results = JSON.stringify(f.seen.at(-1));
  ok(/outside the lab/.test(results), `${kind}: read outside the lab is refused`);
  ok(f.seen.length === 4, `${kind}: 4 model calls (3 tool rounds + answer), got ${f.seen.length}`);
  if (kind === 'anthropic') {
    ok(f.seen[0].system?.[0]?.cache_control && /bds-lab/.test(f.seen[0].system[0].text), 'anthropic: AGENTS.md as the cached system prompt');
    ok(f.seen[1].messages.at(-1).content.some((c) => c.type === 'tool_result' && c.cache_control), 'anthropic: newest message carries the cache breakpoint');
    ok(f.seen.every((q) => q.messages.filter((m) => JSON.stringify(m).includes('cache_control')).length <= 1), 'anthropic: at most one message breakpoint per call');
    ok(/4,640 tokens/.test(o), `anthropic: tokens summed (${/[\d,]+ tokens/.exec(o)?.[0]})`);
  } else {
    ok(f.seen[0].messages[0].role === 'system' && f.seen[0].tools.length === 4, 'openai: system prompt + 4 function tools');
    ok(f.seen[1].messages.some((m) => m.role === 'tool'), 'openai: tool results sent back');
  }
  ok(/Rubies are given/.test(o), `${kind}: the model's answer is printed`);
  const rank = JSON.parse(fs.readFileSync(path.join(TOP, 'bds', 'bench', 'ranking.json'), 'utf8'));
  ok(rank.some((x) => x.agent.startsWith(kind) && x.task.startsWith('make:')), `${kind}: ranking row written`);
  f.srv.close();
  if (kind === 'anthropic') {
    // edit mode: the same unit, a change; TASK.md records it, the prompt says what to keep
    const e = await serve(kind, ['Changed.']);
    const r2 = await run(['bds', 'make', '-a', name, 'ルビーを5個に増やして', '--via', kind], { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: e.url });
    const first = JSON.stringify(e.seen[0]?.messages?.[0] ?? '');
    ok(r2.status === 0 && /Change the Minecraft Bedrock addon in bds\/addons\/mk_anthropic/.test(first) && /never weaken/.test(first), `edit: make -a changes the unit (${r2.t.trim().split('\n').at(-1)})`);
    ok(/## Changes\n- \d{4}-\d\d-\d\d ルビーを5個に増やして/.test(fs.readFileSync(path.join(dir, 'TASK.md'), 'utf8')), 'edit: TASK.md gets the change under ## Changes');
    e.srv.close();
    // tests.lock: a changed or removed locked section fails before any server starts; dispute moves one out with the reason
    fs.writeFileSync(path.join(dir, 'tests.txt'), TESTS + '\n## playtest: no rubies for a second join\n@A leave\n@A join\n~ lab:ruby\\*3\n');
    fs.writeFileSync(path.join(dir, 'tests.lock'), '# lock\n## playtest: no rubies for a second join\n@A leave\n@A join\n~ lab:ruby\\*3\n');
    fs.writeFileSync(path.join(dir, 'tests.txt'), fs.readFileSync(path.join(dir, 'tests.txt'), 'utf8').replace('~ lab:ruby\\*3\n', '~ lab:ruby\n').replace(/(## playtest[^]*?)~ lab:ruby\\\*3/, '$1~ lab:ruby'));
    const t1 = await run(['bds', 'test', '-a', name], {});
    ok(t1.status !== 0 && /E tests\.lock: "## playtest: no rubies for a second join" was changed/.test(t1.t), `lock: an edited locked section fails the test (${t1.t.trim().split('\n')[0]})`);
    const u = await run(['bds', 'unlock', '--all', '-a', name], {});
    ok(u.status !== 0 && /for a person at a terminal/.test(u.t), 'lock: unlock refuses without a terminal');
    const d = await run(['bds', 'dispute', 'playtest: no rubies for a second join', 'the request gives rubies on every join', '-a', name], {});
    const tt = fs.readFileSync(path.join(dir, 'tests.txt'), 'utf8'), task = fs.readFileSync(path.join(dir, 'TASK.md'), 'utf8');
    ok(d.status === 0 && !/playtest:/.test(tt) && !fs.existsSync(path.join(dir, 'tests.lock')) && /## Disputed[^]*"playtest: no rubies for a second join": the request gives rubies on every join/.test(task) && /disputed: the request gives/.test(fs.readFileSync(path.join(dir, 'tests.disputed'), 'utf8')), 'dispute: out of tests.txt and tests.lock, the reason in TASK.md, the test in tests.disputed');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
// the lab from the request: an HTTP server is Endstone's; make hands over to that lab and builds there
{
  const f = await serve('anthropic', ['Done: GET /status answers.']);
  const name = 'mk_end';
  fs.rmSync(path.join(TOP, 'end', 'plugins', name), { recursive: true, force: true });
  const r = await run(['make', 'HTTPサーバーで /status にプレイヤー数を返す', '--via', 'anthropic', '--name', name], { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: f.url });
  const d = path.join(TOP, 'end', 'plugins', name);
  ok(/make: Endstone plugin in end\/ \(the request needs an HTTP server/.test(r.t) && /^MADE plugins\/mk_end/m.test(r.t), `auto lab: an HTTP server goes to Endstone (${r.t.trim().split('\n').at(-1)})`);
  ok(fs.existsSync(path.join(d, 'pyproject.toml')) && /HTTPサーバーで \/status/.test(fs.readFileSync(path.join(d, 'TASK.md'), 'utf8')), 'auto lab: the plugin is scaffolded with the request in TASK.md');
  ok(/# end lab/.test(f.seen[0]?.system?.[0]?.text ?? '') && /Build this Endstone plugin in end\/plugins\/mk_end\//.test(JSON.stringify(f.seen[0]?.messages?.[0])), 'auto lab: end/AGENTS.md in the system prompt, the plugin path in the prompt');
  f.srv.close();
  fs.rmSync(d, { recursive: true, force: true });
}
// prompt extras: maintain's --context and the autopilot's lessons (LAB_MAKE_CONTEXT) both reach a new build and a change
{
  const f = await serve('anthropic', ['Done.', 'Changed.']);
  const name = 'mk_ctx', c1 = path.join(os.tmpdir(), `mk-ctx-${process.pid}.txt`), c2 = path.join(os.tmpdir(), `mk-les-${process.pid}.txt`);
  fs.writeFileSync(c1, 'FAILING LINES HERE'); fs.writeFileSync(c2, 'LESSON: run why first');
  fs.rmSync(path.join(TOP, 'bds', 'addons', name), { recursive: true, force: true });
  const env = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: f.url, LAB_MAKE_CONTEXT: c2 };
  await run(['bds', 'make', 'Context test item', '--via', 'anthropic', '--name', name], env);
  ok(/LESSON: run why first/.test(JSON.stringify(f.seen[0]?.messages?.[0])), 'a new build reads LAB_MAKE_CONTEXT (the lessons)');
  await run(['bds', 'make', '-a', name, 'Context change', '--via', 'anthropic', '--context', c1], env);
  const m = JSON.stringify(f.seen.at(-1)?.messages?.[0]);
  ok(/FAILING LINES HERE/.test(m) && /LESSON: run why first/.test(m), 'a change reads both --context and LAB_MAKE_CONTEXT');
  f.srv.close(); fs.rmSync(path.join(TOP, 'bds', 'addons', name), { recursive: true, force: true }); fs.rmSync(c1, { force: true }); fs.rmSync(c2, { force: true });
}
if (kind0 !== null) fs.writeFileSync(path.join(TOP, '.lab-kind'), kind0); else fs.rmSync(path.join(TOP, '.lab-kind'), { force: true });
// --each: a file of requests, one make each, a table at the end
{
  const f = await serve('anthropic', ['one', 'two']);
  const list = path.join(TOP, 'bds', '.lab', 'each-test.txt');
  fs.mkdirSync(path.dirname(list), { recursive: true });
  fs.writeFileSync(list, '# my list\nfirst item test\n---\nsecond item test\n');
  const before = new Set(fs.readdirSync(path.join(TOP, 'bds', 'addons')));
  const r = await run(['bds', 'make', '--each', list, '--via', 'anthropic', '--lab', 'bds'], { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: f.url });
  const made = fs.readdirSync(path.join(TOP, 'bds', 'addons')).filter((x) => !before.has(x));
  ok(r.status === 0 && made.length === 2 && /\| 1 \| MADE addons\/\w+ \|/.test(r.t) && /\| 2 \| MADE addons\/\w+ \|/.test(r.t), `--each: two requests, two units, one table (${made.join(' ')})`, r.t);
  for (const d of made) fs.rmSync(path.join(TOP, 'bds', 'addons', d), { recursive: true, force: true });
  fs.rmSync(list, { force: true });
  f.srv.close();
}
// a long build: once over LAB_CTX_LIMIT, old outputs and the text of files written earlier are dropped from what is resent;
// --budget stops asking the AI once the tokens are spent
{
  const big = 'x'.repeat(4000);
  const steps = [...Array.from({ length: 5 }, (_, i) => [{ name: 'write', input: { path: `src/f${i}.ts`, content: big } }, { name: 'read', input: { path: 'TASK.md' } }]), 'done'];
  const f = await serve('anthropic', steps);
  const r = await run(['bds', 'make', 'Compaction test', '--via', 'anthropic', '--name', 'mk_compact'], { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: f.url, LAB_CTX_LIMIT: '9000' });
  const sizes = f.seen.map((q) => JSON.stringify(q.messages).length), last = JSON.stringify(f.seen.at(-1).messages);
  ok(r.status === 0 && /chars; the file on disk has it/.test(last) && sizes.at(-1) - sizes.at(-2) < 1500 && Math.max(...sizes) < 16000, `compaction: old file text dropped, the request stays small (${sizes.join(' ')} chars)`, r.t);
  f.srv.close();
  const f2 = await serve('anthropic', steps);
  const r2 = await run(['bds', 'make', 'Budget test', '--via', 'anthropic', '--name', 'mk_budget', '--budget', '2500'], { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: f2.url });
  ok(f2.seen.length === 3 && /token budget reached/.test(r2.t) && /BUDGET/.test(r2.t), `--budget: stopped after ${f2.seen.length} calls (1,160 tokens each)`, r2.t);
  f2.srv.close();
  for (const n of ['mk_compact', 'mk_budget']) fs.rmSync(path.join(TOP, 'bds', 'addons', n), { recursive: true, force: true });
}
// the lab a request needs (no AI: the lab decides from the words)
{
  const { pickLab } = await import(new URL('../common/make.mjs', import.meta.url).href);
  const cases = [['ルビーを追加して、/lab:shop でダイヤと交換できるようにして', 'bds'], ['日本語と英語に対応したアイテム名で、剣を追加', 'bds'], ['スコアボードのサイドバーにキル数を表示', 'bds'],
    ['Discordのwebhookに参加通知をHTTPで送る', 'bds'], ['外部のAPIからJSONを取得して天気を表示', 'bds'], ['初めて参加したプレイヤーにルビーを3個配る', 'bds'],
    ['HTTPで /online にオンラインのプレイヤー名の一覧をJSONで返す', 'end'], ['サーバーの状態をブラウザで見られるようにして', 'end'], ['プレイヤーごとのサイドバーに座標を表示', 'end'],
    ['各プレイヤーの言語で挨拶する', 'end'], ['荒らしを期限付きでBANできるようにして', 'end'], ['統計をSQLiteに保存してランキング', 'end'], ['/tell も封じるミュート機能', 'end'],
    ['アイテムのNBTを編集するコマンド', 'll'], ['LeviLaminaで経済を作って', 'll']];
  const bad = cases.filter(([r, want]) => pickLab(r).lab !== want);
  ok(!bad.length, `lab from the request: ${cases.length - bad.length}/${cases.length}${bad.length ? ' ✘ ' + bad.map(([r, w]) => `${w}? ${r}`).join(' | ') : ''}`);
}
// clean the ranking rows this test added
const rf = path.join(TOP, 'bds', 'bench', 'ranking.json');
fs.writeFileSync(rf, JSON.stringify(JSON.parse(fs.readFileSync(rf, 'utf8')).filter((x) => !/^make:Give 3 rubies|^edit:ルビーを5個|^make:HTTPサーバーで|^make:(first|second) item test|^make:Context test|^edit:Context change|^make:(Compaction|Budget) test/.test(x.task)), null, 1) + '\n');
console.log(`\n${fails ? 'FAIL' : 'PASS'} make-offline`);
process.exit(fails ? 1 : 0);
