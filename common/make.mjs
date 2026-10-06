// make "<request>": the lab asks an AI to build it and keeps going until `go` prints DONE (the AI's word is not taken for it).
//   which lab: from the request (an HTTP server, files, SQL, per-player HUD, logins, packets... → Endstone; NBT or LeviLamina
//              named → ll; everything else → a BDS addon), or --lab bds|end|ll (or `node lab.mjs end make ...`)
//   -a <name> "<change>"   change an existing unit instead: its tests keep passing, new sections for the change
//   --harden [n]           (with -a) the AI only adds tests: the lab first finds what the tests miss with no tokens (code no test
//                          runs: gaps; n small bugs no test notices: mutate), the AI appends `## harden:` sections that pass on
//                          the code as it is and catch them, the lab keeps the ones that pass and measures again (`harden` too)
//   --playtest [n]         then another AI plays it on a live server and writes what it breaks as failing tests (tests.lock);
//                          the builder fixes them; n rounds (default 1). `-a <name> --playtest` alone hardens a unit
//   --each <file>          one make per request in the file (split by a line of ---, or one per line), a table at the end
//   --via claude|codex|gemini   an agent CLI on this machine (it reads AGENTS.md itself)
//   --via anthropic|openai      the lab's own minimal agent over the API (4 tools, no harness overhead: the fewest tokens)
//   --via "<command with {prompt}>"  any other agent CLI      --model m  --play-model m  --name n  --turns n  --js --stable
//   --budget <tokens>   stop asking the AI once this many tokens are used (LAB_TOKEN_BUDGET)
//   --until test        done when the unit's tests pass (maintain), instead of go DONE     --context <file>  more prompt text
//                       (LAB_MAKE_CONTEXT: the same for every make, e.g. the autopilot's auto/LESSONS.md)
// A unit that is changed gets a checkpoint first (node lab.mjs undo); LAB_NOTIFY_WEBHOOK gets the result.
// Every run ends with the lab's own `go` and a row in bench/ranking.json (tokens, turns, playtest findings).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const CLIS = {
  // --tools: only the tools a build uses (Claude Code's default set and the person's MCP servers cost ~27k tokens on EVERY
  // turn: measured 36.5k → 9.8k per turn with the same AGENTS.md)
  claude: ['claude', '-p', '{prompt}', '--output-format', 'json', '--strict-mcp-config', '--tools', 'Bash,Read,Write,Edit,Glob,Grep', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash(node lab.mjs:*)', 'Bash(./lab.sh:*)', 'Bash(cat:*)', 'Bash(ls:*)', 'Bash(grep:*)', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
  codex: ['codex', 'exec', '--full-auto', '--skip-git-repo-check', '--json', '{prompt}'],
  gemini: ['gemini', '--yolo', '-p', '{prompt}'],
};
// agent CLIs: their shell runs one allowed command at a time (a `cd` or `&&` needs an approval nobody gives in a headless run)
const CLI_HINT = '\nWrite and change files with your file tools (Write/Edit), not shell heredocs or sed. Run each `node lab.mjs ...` as it is, from this folder (no cd, no &&, no pipes).';
const has = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
const WORD = { bds: 'Minecraft Bedrock addon', end: 'Endstone plugin', ll: 'LeviLamina mod' };
const MAIN = { bds: 'src/main.ts has only the imports', end: 'plugin.py is a template: rewrite it whole', ll: 'src/main.ts is a template: rewrite it whole' };
const DESC = { bds: 'bp/manifest.json header.description', end: 'pyproject.toml description', ll: 'manifest.json description' };

export function pickVia(want) {
  if (want) return want;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return 'openai';
  for (const c of ['claude', 'codex', 'gemini']) if (has(c)) return c;
  return null;
}

// what the request needs that a BDS addon cannot do → the lab that can (first match wins; Endstone is the widest)
const NEEDS = [
  ['ll', /levilamina|legacy ?script|\blse\b|\bnbt\b|legacy ?money|\bll mod/i, 'LeviLamina or NBT'],
  ['end', /endstone/i, 'Endstone'],
  // serving HTTP (answering requests) is Endstone's; sending (webhooks, server-net) a BDS addon does itself
  ['end', (r) => /https?\s*(server|サーバー)|web\s*api|webapi|ブラウザ|browser|ウェブ(ページ|サイト)|web ?(page|site|dashboard)|ダッシュボード|管理画面|(サイト|ページ)で(見|表示|確認)|rest api|エンドポイント|endpoint|\bget \/\w|(http|json|api)[^。\n]{0,40}(返す|返し|返る|答え|応答|公開|受け付け|受け取|取得でき|見られ|見れ)|serves? (http|json|a page)|respond(s)? (to|with)/i.test(r) && !/webhook|ウェブフック|discord|slack|(に|へ)(http|json)?[^。\n]{0,12}(送る|送信|通知|post)|send[^.]{0,30}(to|via) (http|a url|discord|slack)/i.test(r.replace(/(返す|返し|答え)[^。]*$/, '')), 'an HTTP server'],
  ['end', /ファイル(に|へ)(保存|書き|出力|記録)|ファイルを(保存|書き出|出力)|(write|save|export)s? (it |them )?(to |as )?(a )?(file|png|csv)|\.png|\bpng\b|画像(ファイル|を保存|に書き出|として保存)|\bcsv\b|ログファイル|log file/i, 'files'],
  ['end', /\bsql(ite)?\b|データベース|database/i, 'a database'],
  ['end', /\bip ?(address|アドレス)?\b|ipアドレス|\bping\b|応答速度|端末|デバイス|\bdevice\b|(プレイヤー|人|各自)(の|ごと)[^。]*言語|ゲームの言語|\blocale\b|player'?s language/i, "the player's connection, device or language"],
  ['end', /ボスバー|boss ?bar|トースト|toast|(プレイヤー|人)ごと(の|に)[^。]*(サイドバー|スコアボード)|自分(だけ|専用)の(サイドバー|スコアボード)|per.player (sidebar|scoreboard)/i, 'a per-player HUD (boss bar, toast, own sidebar)'],
  ['end', /転送|別(の)?サーバー|ロビー|\blobby\b|\bhub\b|transfer (the )?players?/i, 'moving players to another server'],
  ['end', /ログイン[^。]*(拒否|禁止|断|できない)|期限付き|一時(的な)?ban|temp ?ban|\bban\b|refuse[^.]*log ?in|whitelist|許可リスト/i, 'refusing logins'],
  ['end', /パケット|packet|\bmotd\b|サーバー一覧|server list/i, 'packets or the server list'],
  ['end', /スキン|\bskins?\b|地図に[^。]*(絵|描)|map ?art|マップアート/i, 'skins or drawing on maps'],
  ['end', /pypi|numpy|\bqr ?(code|コード)?\b|pillow|python/i, 'Python libraries'],
  ['end', /バニラ(の)?コマンド[^。]*(検知|禁止|止め|ブロック|記録|ログ|書き換)|\/tell|ミュート|\bmute\b|(打った|入力された|全ての|すべての)コマンド[^。]*(記録|ログ)|command log/i, 'catching vanilla commands'],
];
export function pickLab(req) {
  for (const [lab, re, why] of NEEDS) if (typeof re === 'function' ? re(req) : re.test(req)) return { lab, why };
  return { lab: 'bds', why: 'a behavior/resource pack with scripts does it' };
}

const slug = (req) => (req.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? []).filter((w) => w.length > 2).slice(0, 2).join('_') || `unit_${Date.now().toString(36).slice(-4)}`;
const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
function runLab(L, argv, env = {}, timeout = 1800000) {
  const r = spawnSync(process.execPath, [path.join(L.TOP, 'lab.mjs'), L.F.name, ...argv], { cwd: L.TOP, encoding: 'utf8', timeout, maxBuffer: 64e6, env: { ...process.env, LAB_NOTRACE: '1', ...env } });
  const lines = ((r.stdout ?? '') + (r.stderr ?? '')).trim().split('\n').filter(Boolean);
  return { ok: r.status === 0, lines };
}
// the lab's verdict, in its own process (this one started before the unit existed): `go` prints DONE (default), or with
// --until test (maintain) the unit's tests pass on the server as it is now
let UNTIL = 'go';
function runGo(L, name) {
  if (UNTIL === 'test') { const t = runLab(L, ['test', '-a', name]); return { ok: t.ok && t.lines.some((l) => /^PASS \d/.test(l)), lines: t.lines }; }
  const g = runLab(L, ['go', '-a', name]);
  return { ok: g.ok && g.lines.some((l) => l.startsWith('DONE ')), lines: g.lines };
}
const tokensOf = (u) => (u.in ?? 0) + (u.out ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
const agentsOf = (L) => fs.readFileSync(path.join(L.TOP, 'AGENTS.md'), 'utf8') + (L.F.name === 'bds' ? '' : '\n\n' + fs.readFileSync(path.join(L.TOP, L.F.name, 'AGENTS.md'), 'utf8'));
const unitRel = (L, name) => `${L.F.name}/${L.F.unitDir}/${name}/`;

export async function make(L, args0, { newAddon }) {
  const args = [...args0];
  const flag = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const via0 = flag('--via'), model = flag('--model', process.env.LAB_MODEL), name0 = flag('--name'), turns = Number(flag('--turns', 40));
  const playModel = flag('--play-model', process.env.LAB_PLAY_MODEL) ?? model, each = flag('--each');
  UNTIL = flag('--until', 'go') === 'test' ? 'test' : 'go';
  const budget = Number(flag('--budget', process.env.LAB_TOKEN_BUDGET) || 0);   // tokens: stop asking the AI once this many are used
  // extra prompt text (not written to TASK.md): --context <file> (maintain's failing lines) and LAB_MAKE_CONTEXT (the autopilot's
  // lessons), both when both are given
  const ctxFiles = [flag('--context'), process.env.LAB_MAKE_CONTEXT].filter((f, i, a) => f && fs.existsSync(f) && a.indexOf(f) === i);
  const context = ctxFiles.map((f) => '\n' + fs.readFileSync(f, 'utf8').trim()).join('');
  if (each) return makeEach(L, each, args0);
  const lab0 = flag('--lab'), edit0 = flag('--edit');
  let rounds = 0;
  const pi = args.indexOf('--playtest');
  if (pi >= 0) { rounds = /^\d+$/.test(args[pi + 1] ?? '') ? Number(args[pi + 1]) : 1; args.splice(pi, /^\d+$/.test(args[pi + 1] ?? '') ? 2 : 1); }
  let hardenN = 0;
  const hi = args.indexOf('--harden');
  if (hi >= 0) { hardenN = /^\d+$/.test(args[hi + 1] ?? '') ? Math.max(1, Number(args[hi + 1])) : 6; args.splice(hi, /^\d+$/.test(args[hi + 1] ?? '') ? 2 : 1); }
  const opts = args.filter((a) => /^--(js|stable|no-rp)$/.test(a));
  const req = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  const editName = edit0 ?? L.addonArg ?? null;
  if (hardenN && (!editName || req)) L.die('usage: node lab.mjs make -a <name> --harden [n] [--via ...] (or: node lab.mjs harden [-a <name>] [n]): the AI adds tests to an existing unit, nothing else');
  if (!req && !(editName && (rounds || hardenN))) L.die('usage: node lab.mjs make "<what it does>" [--lab bds|end|ll] [-a <name> (change it; with --playtest and no text: harden it)] [--playtest [n]] [--harden [n]] [--via claude|codex|gemini|anthropic|openai|"<cmd {prompt}>"] [--model m] [--name n] [--js] [--stable]');
  // which lab: named (--lab, `node lab.mjs end make`), the unit's own lab (-a), or what the request needs
  const UNITS = { bds: 'addons', end: 'plugins', ll: 'mods' };
  const home = editName && !L.addonNames().includes(editName) ? Object.keys(UNITS).find((k) => fs.existsSync(path.join(L.TOP, k, UNITS[k], editName))) : null;
  let lab = lab0 ?? home ?? (process.env.LAB_KIND_NAMED || (editName ? L.F.name : null)), why = lab0 ? 'chosen' : home ? `${editName} is there` : lab ? 'named' : '';
  if (!lab) ({ lab, why } = pickLab(req || ''));
  if (!WORD[lab]) L.die(`--lab ${lab}: bds, end or ll`);
  if (lab !== L.F.name) {   // that lab's own process builds it
    L.out(`make: ${WORD[lab]} in ${lab}/ (${home ? why : `the request needs ${why}`}; --lab bds|end|ll chooses)`);
    const r = spawnSync(process.execPath, [path.join(L.TOP, 'lab.mjs'), lab, 'make', ...args0.filter((a, i) => a !== '--lab' && args0[i - 1] !== '--lab'), '--lab', lab, ...(L.addonArg ? ['-a', L.addonArg] : [])], { cwd: L.TOP, stdio: 'inherit' });
    return r.status === 0;
  }
  const via = pickVia(via0);
  if (!via) L.die('make needs an AI: ANTHROPIC_API_KEY (or OPENAI_API_KEY [+ OPENAI_BASE_URL for local/compatible servers]), or the claude / codex / gemini CLI on PATH');
  if (hardenN) return harden(L, { name: editName, n: hardenN, via, model, turns, budget });
  let name, prompt;
  if (editName) {
    name = editName;
    if (!L.addonNames().includes(name)) L.die(`make -a ${name}: no such ${L.F.unitWord ?? 'addon'} in ${L.F.name}/${L.F.unitDir} (${L.addonNames().join(' ') || 'none'})`);
    L.useAddon(name, true);
    try { const cp = await import('./checkpoint.mjs'); const id = cp.save(L.F.name, name, `before make: ${cut(req || 'playtest', 60)}`); L.out(`make: checkpoint ${id} (node lab.mjs undo puts it back)`); } catch { /* best-effort */ }
    const tm = path.join(L.ADDONS, name, 'TASK.md');
    let t = fs.existsSync(tm) ? fs.readFileSync(tm, 'utf8') : '';
    if (req && !/^## Changes/m.test(t)) t = t.trimEnd() + '\n\n## Changes\n';
    if (req) fs.writeFileSync(tm, t.trimEnd() + `\n- ${new Date().toISOString().slice(0, 10)} ${req}\n`);
    prompt = !req ? null : `Change the ${WORD[lab]} in ${unitRel(L, name)} (current; TASK.md has its request and this change under ## Changes): ${req}\nKeep every existing test passing and never weaken one; ${UNTIL === 'test' ? 'never edit or remove an existing tests.txt section' : 'add a \`## \` section for each new or changed behaviour (an old section the change contradicts: rewrite it to the new behaviour)'}. Follow AGENTS.md${lab === 'bds' ? '' : ` and ${lab}/AGENTS.md`} (skip step 1). Finish when \`node lab.mjs ${UNTIL}\` prints ${UNTIL === 'go' ? 'DONE' : 'PASS'}. Final reply: 2 lines in the change's language (what changed, how to use it).${context}`;
  } else {
    name = name0 ?? slug(req);
    while (L.addonNames().includes(name)) name = name.replace(/_\d+$/, '') + '_' + Math.floor(Math.random() * 900 + 100);
    if (lab === 'bds') await newAddon([name, name, req, ...opts]);
    else await L.F.commands.new(L, [name, name, req]);
    prompt = `Build this ${WORD[lab]} in ${unitRel(L, name)} (already created and current: skip step 1${lab === 'bds' ? '' : ` of ${lab}/AGENTS.md, read that file first`}; ${MAIN[lab]}; put what it does, for players, in ${DESC[lab]}). Follow AGENTS.md. Finish when \`node lab.mjs go\` prints DONE. Final reply: 2 lines in the request's language (what it does, how to use it).\nRequest: ${req}${context}`;
  }
  // the skill that fits the request goes into the prompt (what `bds new` prints): the agent's first turn is not spent fetching it
  if (prompt && req && process.env.LAB_NEW_SKILL !== 'off' && fs.existsSync(path.join(L.TOP, 'skills'))) {
    try { const lines = []; (await import('./skill-forge.mjs')).route([req, '--print'], (l) => lines.push(l)); if (lines.length && /^# skill /.test(lines[0])) prompt += `\n\nThe skill for this request (already read for you; do not run skill route again):\n${lines.join('\n')}`; } catch { /* no skills */ }
  }
  const t0 = Date.now();
  const hint = CLIS[via] ? CLI_HINT : '';
  const total = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, turns: 0, cost: null }, phase = { build: 0, playtest: 0 };
  const sum = (u) => (u.in ?? 0) + (u.out ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
  const add = (u, ph = 'build') => { for (const k of ['in', 'out', 'cacheRead', 'cacheWrite', 'turns']) total[k] += u[k] ?? 0; if (u.cost != null) total.cost = (total.cost ?? 0) + u.cost; phase[ph] += sum(u); };
  const over = () => budget > 0 && sum(total) >= budget;
  const where = `the ${WORD[lab]} in ${unitRel(L, name)} (follow AGENTS.md${lab === 'bds' ? '' : ` and ${lab}/AGENTS.md`})`;
  const logs = [];
  // the builder: an agent CLI (its session resumable for fixes) or the lab's own loop (its messages kept)
  let state = null, answer = '';
  const build = async (text) => {
    if (via === 'anthropic' || via === 'openai') {
      const r = await apiLoop(L, { via, model, prompt: text, name, turns, state, tools: BUILD_TOOLS, sys: agentsOf(L) + '\nYou work through the tools only: `lab` runs node lab.mjs from the lab folder; write/edit/read take paths inside the unit folder. Batch: write every file you need before running go.', verify: true, budget: budget ? Math.max(1, budget - sum(total)) : 0 });
      state = r.state; add(r.use); if (r.answer) answer = r.answer; if (r.log) logs.push(r.log);
      return r.use.verified;
    }
    const r = await cliRun(L, via, text + hint, { resume: state?.session, name, model });
    state = { session: r.session ?? state?.session }; add(r.use); if (r.answer) answer = r.answer; if (r.transcript) logs.push(r.transcript);
    return undefined;
  };
  let verified = prompt ? await build(prompt) : undefined;
  let g = verified !== undefined ? { ok: verified, lines: [] } : process.env.LAB_MAKE_VERIFY === 'off' ? { ok: true, lines: ['(verify off)'] } : runGo(L, name);
  if (verified === undefined && !g.ok) {   // an agent CLI that stopped early (or a unit to harden that fails): what go says, twice at most
    for (let k = 0; k < 2 && !g.ok && !over(); k++) { await build(`For ${where}, node lab.mjs go says:\n` + g.lines.slice(-40).join('\n') + '\nFix it until go prints DONE.'); g = runGo(L, name); }
  }
  // playtest rounds: another AI tries to break it; what it breaks comes back as locked failing tests for the builder
  const found = [], disputed = [];
  for (let k = 0; k < rounds && g.ok && !over(); k++) {
    const p = await playtest(L, ['--via', via, ...(playModel ? ['--model', playModel] : [])], { name });
    add(p.use ?? {}, 'playtest'); if (p.log) logs.push(p.log);
    if (!p.found?.length) break;
    found.push(...p.found);
    const titles = p.found.map((x) => `"## ${x}"`).join(', ');
    verified = await build(`A playtester (another AI) played ${where} on a live server and found bugs. They are now failing sections at the end of its tests.txt, locked in tests.lock: ${titles}.\nFix the ${WORD[lab]} until \`node lab.mjs go\` prints DONE. Never edit or remove those sections. One that asks for something the request does not want: \`node lab.mjs dispute "<title>" "<why>"\` (the person reads it).`);
    g = verified !== undefined ? { ok: verified, lines: [] } : runGo(L, name);
    for (let j = 0; j < 2 && !g.ok && verified === undefined; j++) { await build(`For ${where}, node lab.mjs go says:\n` + g.lines.slice(-40).join('\n') + '\nFix it until go prints DONE (the tests.lock sections stay as they are).'); g = runGo(L, name); }
  }
  const dfile = path.join(L.ADDONS, name, 'tests.disputed');
  if (fs.existsSync(dfile)) disputed.push(...L.sectionsOf(dfile).map((x) => x.title));
  if (g.lines.length) g.lines.slice(-12).forEach((l) => L.out(l));
  const ok = g.ok;
  const sec = Math.round((Date.now() - t0) / 1000), tokens = total.in + total.out + total.cacheRead + total.cacheWrite;
  const row = { id: `make-${name}-${Date.now().toString(36)}`, agent: `${via}${model ? ':' + model : ''}`, task: `${editName ? (req ? 'edit' : 'harden') : 'make'}:${cut(req || name, 60)}`, lab, pass: ok, checks: ok ? 'go DONE' : 'go FAIL',
    tokens, fresh: total.in + total.out + total.cacheWrite, steps: total.turns, labCalls: null, labOutTok: null, sec, src: via, playtest: rounds ? { rounds, found: found.length, disputed: disputed.length, tokens: phase.playtest } : undefined, logs, at: new Date().toISOString() };
  const rf = path.join(L.TOP, 'bds', 'bench', 'ranking.json');
  try { const all = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : []; all.push(row); fs.mkdirSync(path.dirname(rf), { recursive: true }); fs.writeFileSync(rf, JSON.stringify(all, null, 1) + '\n'); } catch { /* ranking is best-effort */ }
  if (answer) L.out(answer.trim().split('\n').slice(0, 6).join('\n'));
  if (over()) L.out(`BUDGET ${sum(total).toLocaleString('en')} tokens used (--budget ${budget.toLocaleString('en')}): stopped asking the AI`);
  if (rounds) L.out(`playtest: ${found.length} bug(s) found${found.length ? ': ' + found.map((x) => `"${x}"`).join(', ') : ''}${disputed.length ? ` | disputed (a person decides, TASK.md): ${disputed.map((x) => `"${x}"`).join(', ')}` : ''}`);
  try { const n = await import('./notify.mjs'); await n.notify(`make ${ok ? 'MADE' : 'NOT DONE'}: ${L.F.unitDir}/${name}`, [cut(req || '(harden)', 200), `${tokens.toLocaleString('en')} tokens, ${sec}s, ${row.agent}`], { ok, out: L.out }); } catch { /* best-effort */ }
  L.out(`${ok ? 'MADE' : 'NOT DONE'} ${L.F.unitDir}/${name} via ${row.agent}: ${tokens.toLocaleString('en')} tokens (fresh ${row.fresh.toLocaleString('en')}, out ${total.out.toLocaleString('en')}${rounds ? `; build ${phase.build.toLocaleString('en')}, playtest ${phase.playtest.toLocaleString('en')}` : ''}), ${total.turns} turns, ${sec}s${total.cost != null ? `, $${total.cost.toFixed(3)}` : ''}`);
  return ok;
}

// ---- make -a <name> --harden [n] (node lab.mjs harden): the AI only adds tests, aimed at what the lab measured they miss ----
// 1. no tokens: the tests with coverage (code no test runs, with the test lines that reach it) and n small bugs (mutate) on
//    fresh servers; nothing missed → done without the AI. 2. the AI gets those places and bugs, each with its line, and may only
//    append sections to tests.txt (anything else it changes is put back, old sections stay as they were). 3. the new sections
//    must pass on the code as it is (one that fails is kept out: a bug in the code or a wrong test, printed as SUSPECT); the same
//    bugs and the coverage are measured again, before → after.
export async function harden(L, { name, n = 6, via, model, turns = 40, budget = 0 }) {
  const k = L.F.name, dir = path.join(L.ADDONS, name), tf = path.join(dir, 'tests.txt'), t0 = Date.now();
  if (!L.addonNames().includes(name)) L.die(`harden ${name}: no such ${L.F.unitWord ?? 'addon'} in ${L.F.name}/${L.F.unitDir} (${L.addonNames().join(' ') || 'none'})`);
  L.useAddon(name, true);
  const M = await import('./mutate.mjs'), G = await import('./gaps.mjs'), pct = (c) => /^COV (\d+%)/.exec(c ?? '')?.[1] ?? '?';
  if (!M.unitFiles(dir).files.length) { L.out(`harden ${name}: no scripts of its own (${M.unitFiles(dir).srcDir}/): nothing to measure`); return false; }
  L.out(`harden ${name}: what the tests miss, on fresh servers (coverage, then ${n} small bug(s); no AI yet)...`);
  const m0 = await M.measure(k, name, { n, out: L.out });
  if (!m0.ok) { (m0.base?.lines ?? []).filter((l) => /^(✘|E |FAIL)/.test(l)).slice(0, 6).forEach((l) => L.out('  ' + l)); L.out(`FAIL harden ${name}: its tests fail: they must pass first (node lab.mjs go, or make -a ${name} "<fix>")`); return false; }
  const gaps0 = G.explain(dir, m0.cov), lived = m0.lived;
  if (!gaps0.length && !lived.length) { L.out(`OK harden ${name}: the tests run its code (${pct(m0.cov)}) and caught ${m0.caught}/${m0.tried} bug(s): nothing to add (more bugs: harden ${Math.min(n * 2, 99)})`); return true; }
  try { const cp = await import('./checkpoint.mjs'); const id = cp.save(k, name, 'before harden'); L.out(`harden: checkpoint ${id} (node lab.mjs undo puts it back)`); } catch { /* best-effort */ }
  // what the AI gets: the places and the bugs, each with its code line (nothing to look up first)
  const src = new Map(m0.files), code = (f, l) => (src.get(f)?.split('\n')[l - 1] ?? '').trim().slice(0, 140);
  const places = gaps0.slice(0, 12).map((g) => `  ${G.line(g)}`), bugs = lived.slice(0, 12).map(({ s, what }) => `  ${s.file}:${s.line} ${s.kind === 'call' ? 'without this call' : 'with ' + what}: ${code(s.file, s.line)}`);
  const prompt = [`Strengthen the tests of the ${WORD[k]} in ${unitRel(L, name)} (TASK.md has its request). Only append \`## harden: <what it checks>\` sections at the end of tests.txt; change nothing else (not the code, not an existing section).`,
    'Each new section must pass on the code as it is and check what TASK.md asks for, so that:',
    ...(places.length ? ['- each place no test runs gets run, with expectations on what it does (after → : one way to reach it):', ...places] : []),
    ...(bugs.length ? ['- each of these small bugs would make a section fail (now no test notices it):', ...bugs] : []),
    '`node lab.mjs record "<cmd>" ["<cmd>" ...]` prints what commands print now, as expectations; `node lab.mjs test` runs tests.txt (every section must pass; `node lab.mjs why "<title>"` says why one fails). A section starts from what the sections before it left: set up what it needs (clear A, give A ..., or a player no section uses yet: @C join).',
    'Where the code does not do what TASK.md asks, write no section: name it in your final reply, one line each: BUG <file:line> <what>.'].join('\n');
  // the snapshot: the AI may only add sections to tests.txt
  const skip = (f) => /[\\/](node_modules|dist|__pycache__|\.lab)[\\/]|tsconfig\.json$|\.pyc$/.test(f);
  const snap = new Map(L.files(dir, (f) => !skip(f) && fs.statSync(f).size < 2e6).map((f) => [f, fs.readFileSync(f)]));
  const before = fs.readFileSync(tf, 'utf8'), known = new Set(L.sectionsOf(tf).map((x) => x.title));
  const use = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, turns: 0, cost: null };
  let answer = '', log = null;
  if (via === 'anthropic' || via === 'openai') {
    const r = await apiLoop(L, { via, model, prompt, name, turns, tools: BUILD_TOOLS, sys: agentsOf(L) + '\nYou work through the tools only: `lab` runs node lab.mjs from the lab folder; write/edit/read take paths inside the unit folder. You are hardening the tests: tests.txt is the only file you change.', verify: false, budget, tag: 'harden' });
    Object.assign(use, r.use); answer = r.answer ?? ''; log = r.log;
  } else { L.out(`harden: ${via} is writing the tests (minutes)...`); const r = await cliRun(L, via, prompt + CLI_HINT, { name, model }); Object.assign(use, r.use); answer = r.answer ?? ''; log = r.transcript; }
  // keep the new sections as they are now, after the old tests.txt as it was; everything else goes back
  const al = (fs.existsSync(tf) ? fs.readFileSync(tf, 'utf8') : before).split(/\r?\n/), fresh = (fs.existsSync(tf) ? L.sectionsOf(tf) : []).filter((x) => !known.has(x.title) && x.body.length);
  const restored = [];
  for (const [f, b] of snap) if (f !== tf && (!fs.existsSync(f) || !fs.readFileSync(f).equals(b))) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); restored.push(L.rel(f)); }
  for (const f of L.files(dir, (x) => !snap.has(x) && !skip(x) && fs.statSync(x).size < 2e6)) { fs.rmSync(f, { force: true }); restored.push(L.rel(f) + ' (new)'); }
  if (restored.length) L.out(`harden: put back what it changed besides tests.txt: ${restored.slice(0, 6).join(' ')}`);
  const text = (x) => al.slice(x.start, x.end + 1).join('\n'), write = (xs) => fs.writeFileSync(tf, before.trimEnd() + '\n' + xs.map((x) => '\n' + text(x) + '\n').join(''));
  write(fresh);
  // the new sections must pass on the code as it is: the ones that fail are kept out (again until the rest pass)
  let kept = fresh;
  const suspect = [];
  for (let i = 0; i < 3 && kept.length; i++) {
    const t = M.runTests(k, name, [], { LAB_SECTIONS: '1' });
    const bad = new Set(t.lines.filter((l) => l.startsWith('SECTION FAIL ')).map((l) => l.slice(13))), whyOf = (title) => t.lines.find((l) => l.startsWith(`SECTION WHY ${title} :: `))?.slice(`SECTION WHY ${title} :: `.length).replace(/ @@ /, ' during ') ?? 'fails';
    const now = kept.filter((x) => bad.has(x.title));
    if (!now.length) break;
    suspect.push(...now.map((x) => ({ ...x, why: whyOf(x.title) })));
    kept = kept.filter((x) => !bad.has(x.title)); write(kept);
  }
  for (const x of suspect) { L.out(`SUSPECT "## ${x.title}": fails on the code as it is (${cut(x.why, 140)}): a bug in the code or a wrong test; kept out of tests.txt:`); text(x).split('\n').slice(0, 10).forEach((l) => L.out('  | ' + l)); }
  for (const l of answer.split('\n').filter((y) => /^\s*BUG\b/.test(y)).slice(0, 8)) L.out(`BUG? ${l.trim().replace(/^BUG:?\s*/, '')} (the AI says the code does not do what TASK.md asks)`);
  // the same bugs and the coverage again, with the new sections
  const m1 = kept.length ? await M.measure(k, name, { only: lived.map((x) => x.s), out: L.out }) : null, ok = !!m1?.ok;
  const gaps1 = ok ? G.explain(dir, m1.cov) : gaps0, caught1 = ok ? m0.caught + m1.caught : m0.caught, still = ok ? m1.lived : lived;
  L.out(kept.length ? `harden ${name}: +${kept.length} section(s): ${kept.map((x) => `"## ${x.title}"`).join(', ')}` : `harden ${name}: no new section passed${answer ? ` (the AI said: ${cut(answer.trim().split('\n')[0], 160)})` : ''}`);
  if (lived.length) L.out(`  bugs caught: ${m0.caught}/${m0.tried} → ${caught1}/${m0.tried}${still.length ? ` (still unnoticed: ${still.slice(0, 3).map(({ s, what }) => `${s.file}:${s.line} ${what}`).join(', ')}${still.length > 3 ? ', …' : ''})` : ''}`);
  L.out(`  code the tests run: ${pct(m0.cov)} → ${ok ? pct(m1.cov) : pct(m0.cov)}${gaps1.length ? ` (${gaps1.length} place(s) still unrun: ${G.line(gaps1[0])}${gaps1.length > 1 ? ' …' : ''})` : ''}`);
  if (kept.length && !ok) L.out('W the tests fail on a second run: flaky? node lab.mjs flaky');
  const sec = Math.round((Date.now() - t0) / 1000), tokens = tokensOf(use);
  const row = { id: `harden-${name}-${Date.now().toString(36)}`, agent: `${via}${model ? ':' + model : ''}`, task: `harden:${name}`, lab: k, pass: ok && kept.length > 0, checks: `+${kept.length} sections, bugs ${m0.caught}/${m0.tried}→${caught1}/${m0.tried}, cov ${pct(m0.cov)}→${ok ? pct(m1.cov) : '?'}`,
    tokens, fresh: use.in + use.out + use.cacheWrite, steps: use.turns, labCalls: null, labOutTok: null, sec, src: via, logs: log ? [log] : [], at: new Date().toISOString() };
  const rf = path.join(L.TOP, 'bds', 'bench', 'ranking.json');
  try { const all = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : []; all.push(row); fs.mkdirSync(path.dirname(rf), { recursive: true }); fs.writeFileSync(rf, JSON.stringify(all, null, 1) + '\n'); } catch { /* best-effort */ }
  try { const nt = await import('./notify.mjs'); await nt.notify(`harden ${row.pass ? 'DONE' : 'NOT DONE'}: ${L.F.unitDir}/${name}`, [row.checks, `${tokens.toLocaleString('en')} tokens, ${sec}s, ${row.agent}`], { ok: row.pass, out: L.out }); } catch { /* best-effort */ }
  L.out(`${row.pass ? 'HARDENED' : 'NOT HARDENED'} ${L.F.unitDir}/${name} via ${row.agent}: ${tokens.toLocaleString('en')} tokens, ${use.turns} turns, ${sec}s${use.cost != null ? `, $${use.cost.toFixed(3)}` : ''}`);
  return row.pass;
}

// ---- make --each <file>: one make per request (blocks separated by a line of ---, or one per line), one after another ----
async function makeEach(L, file0, args0) {
  const file = [file0, path.resolve(L.TOP, file0), path.resolve(process.env.INIT_CWD ?? L.TOP, file0)].find((f) => fs.existsSync(f));   // (the lab runs from its own folder)
  if (!file) L.die(`--each ${file0}: no such file`);
  const t = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const reqs = (/^---\s*$/m.test(t) ? t.split(/^---\s*$/m) : t.split('\n')).map((x) => x.replace(/^#.*$/gm, '').trim()).filter(Boolean);
  const VAL = new Set(['--via', '--model', '--play-model', '--lab', '--turns', '--playtest', '--budget', '--until', '--context']), rest = [];
  for (let i = 0; i < args0.length; i++) {   // the flags go to every make; --name and the request do not
    const a = args0[i];
    if (a === '--each' || a === '--name') { i++; continue; }
    if (!a.startsWith('--')) continue;
    rest.push(a);
    if (VAL.has(a) && args0[i + 1] !== undefined && (a !== '--playtest' || /^\d+$/.test(args0[i + 1]))) rest.push(args0[++i]);
  }
  const rows = [];
  for (const [i, req] of reqs.entries()) {
    L.out(`\n== ${i + 1}/${reqs.length}: ${cut(req.split('\n')[0], 80)}`);
    const r = spawnSync(process.execPath, [path.join(L.TOP, 'lab.mjs'), 'make', req, ...rest], { cwd: L.TOP, encoding: 'utf8', maxBuffer: 256e6 });
    const o = ((r.stdout ?? '') + (r.stderr ?? '')).trim();
    o.split('\n').filter((l) => /^(make:|MADE|NOT DONE|playtest:|DONE|FAIL|BUG )/.test(l)).forEach((l) => L.out(l));
    rows.push([req, /^(MADE|NOT DONE) (\S+)/m.exec(o)?.slice(1).join(' ') ?? `exit ${r.status}`, /: ([\d,]+) tokens/.exec(o)?.[1] ?? '?']);
  }
  L.out('\n| # | result | tokens | request |\n|---|---|---|---|');
  rows.forEach(([q, res, tk], i) => L.out(`| ${i + 1} | ${res} | ${tk} | ${cut(q.split('\n')[0], 60)} |`));
  return rows.every(([, res]) => res.startsWith('MADE'));
}

// ---- playtest: another AI plays the unit on a live server as players and writes what it breaks as failing tests ----
const PLAY_MAX = 4;
function surface(L, d) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const src = L.files(path.join(d, 'src'), (f) => /\.(py|[cm]?[jt]s)$/.test(f) && !/kit\.[jt]s$/.test(f)).concat(L.files(path.join(d, 'bp', 'scripts'), (f) => /\.[cm]?js$/.test(f) && !/kit\.js$/.test(f))).map(read).join('\n');
  const cmds = new Set();
  for (const m of src.matchAll(/\bcmd(?:Any)?\(\s*['"]([\w-]+:[\w-]+)['"]\s*,\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*\{([^}]*)\}/g)) cmds.add(`/${m[1]} ${m[2].replace(/\s+/g, ' ').trim()}`.trim());
  for (const m of src.matchAll(/"usages"\s*:\s*\[([^\]]*)\]/g)) for (const u of m[1].matchAll(/"([^"]+)"/g)) cmds.add(u[1]);
  for (const m of src.matchAll(/newCommand\(\s*['"]([\w-]+)['"]/g)) cmds.add('/' + m[1]);
  const ids = [];
  for (const k of ['items', 'blocks', 'entities']) for (const f of L.files(path.join(d, 'bp', k), (x) => x.endsWith('.json'))) { const id = /"identifier"\s*:\s*"([^"]+)"/.exec(read(f))?.[1]; if (id) ids.push(id); }
  const titles = L.sectionsOf(path.join(d, 'tests.txt')).map((s) => s.title);
  return `Commands: ${[...cmds].join(' | ') || 'none found'}\nCustom content: ${ids.join(' ') || 'none'}\nAlready tested (tests.txt sections): ${titles.map((t) => `"${t}"`).join(', ')}`;
}
const playPrompt = (L, dir, max) => `You are the playtester of a ${WORD[L.F.name]} another AI built (in ${unitRel(L, path.basename(dir))}). Break it the way players would: wrong results, anything the request below promises that does not happen, exploits (items for free or duplicated, negative/zero/huge amounts, the same thing twice, two players at once, closing a form or leaving midway, rejoining, a restart), crashes (E lines), a player left without feedback. The lab's QA already runs 3 players, rejoins, /reload, a restart, every command with edge values, closing each command's form and a rejoin gift check: spend your turns on what this request promises and the exploits particular to it.
A live server with it is running. Play with \`node lab.mjs do "<line>" ["<line>" ...]\`: the lines are tests.txt lines (AGENTS.md${L.F.name === 'bds' ? '' : ` and ${L.F.name}/AGENTS.md`}: \`@A join\`, \`@A cmd /x 1\`, \`until form\`, \`@A form 0\`, \`@A chat hi\`, \`give A <item> 3\`, \`${L.F.name === 'end' ? 'py <expr>' : L.F.name === 'll' ? 'lse <expr>' : 'js <expr>'}\`, \`restart\` ...); each call prints what happened. You may read the source.
For each bug you confirm, append to tests.txt one section \`## playtest: <the right behaviour, a few words>\` with the shortest lines that reproduce it and expectations of the RIGHT behaviour, so that it fails now. A section starts from what the sections before left (set up what it needs: \`@A join\` again is fine, \`clear A\`, \`give A ...\`). Only append to tests.txt; change nothing else; do not fix the ${WORD[L.F.name]}. At most ${max} sections, the most serious first; none if it holds up. Reply with one line per bug.
Request (TASK.md):
${fs.readFileSync(path.join(dir, 'TASK.md'), 'utf8').trim()}
${surface(L, dir)}`;

export async function playtest(L, args0, { quiet = false, name: unit } = {}) {
  const args = [...args0];
  const flag = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const via = pickVia(flag('--via')), model = flag('--model', process.env.LAB_MODEL), max = Number(flag('--max', PLAY_MAX)), turns = Number(flag('--turns', 40));
  if (!via) L.die('playtest needs an AI (like make): ANTHROPIC_API_KEY, OPENAI_API_KEY or the claude / codex / gemini CLI');
  const name = unit ?? path.basename(L.ADDON), dir = path.join(L.ADDONS, name), tf = path.join(dir, 'tests.txt');
  // every file of the unit as it is: the playtester may only add sections to tests.txt
  const skip = (f) => /[\\/](node_modules|dist|__pycache__|\.lab)[\\/]|tsconfig\.json$|\.pyc$/.test(f);
  const snap = new Map(L.files(dir, (f) => !skip(f) && fs.statSync(f).size < 2e6).map((f) => [f, fs.readFileSync(f)]));
  const before = fs.readFileSync(tf, 'utf8'), known = new Set(L.sectionsOf(tf).map((s) => s.title));
  L.out(`playtest: ${via} plays ${L.F.unitDir}/${name} on a live server...`);
  const up = runLab(L, ['up', '-a', name]);
  if (!up.ok || up.lines.some((l) => /^E world\/addon did not load/.test(l))) { up.lines.slice(-8).forEach((l) => L.out(l)); L.out('playtest: the live server did not start'); return { found: [], use: {} }; }
  let r;
  try {
    const text = playPrompt(L, dir, max);
    if (via === 'anthropic' || via === 'openai') r = await apiLoop(L, { via, model, prompt: text, name, turns, tools: PLAY_TOOLS, sys: agentsOf(L) + '\nYou are the playtester: `do` plays on the live server, `read` shows a file of the unit, `append_test` adds a section to tests.txt.', verify: false });
    else r = await cliRun(L, via, text + CLI_HINT.replace('Write and change files with your file tools (Write/Edit)', 'Append to tests.txt with your file tools (Edit: after its last line)'), { play: true, name, model });
  } finally { runLab(L, ['down']); }
  // keep only new `## playtest:` sections appended to tests.txt; anything else the playtester changed goes back
  const after = fs.readFileSync(tf, 'utf8'), lines = after.split(/\r?\n/);
  const fresh = L.sectionsOf(tf).filter((s) => !known.has(s.title) && /^playtest:/i.test(s.title) && s.body.length);
  const restored = [];
  for (const [f, b] of snap) if (f !== tf && (!fs.existsSync(f) || !fs.readFileSync(f).equals(b))) { fs.writeFileSync(f, b); restored.push(L.rel(f)); }
  for (const f of L.files(dir, (x) => !snap.has(x) && !skip(x) && fs.statSync(x).size < 2e6)) { fs.rmSync(f, { force: true }); restored.push(L.rel(f) + ' (new)'); }
  if (restored.length) L.out(`playtest: put back what it changed besides tests.txt: ${restored.slice(0, 6).join(' ')}`);
  const block = (s) => { let e = s.end; return lines.slice(s.start, e + 1).join('\n'); };
  fs.writeFileSync(tf, before.trimEnd() + '\n' + fresh.map((s) => '\n' + block(s) + '\n').join(''));
  if (!fresh.length) { L.out(`playtest: no bugs found (${r?.answer ? cut(r.answer.trim().split('\n')[0], 160) : 'no reply'})`); return { found: [], use: r?.use ?? {}, log: r?.log ?? r?.transcript }; }
  // confirm on a fresh server: a section that already passes is not a bug (dropped); the failing ones are locked
  const t = runLab(L, ['test', '-a', name], { LAB_SECTIONS: '1', LAB_NO_LASTFAIL: '1' });
  const bad = new Set(t.lines.filter((l) => l.startsWith('SECTION FAIL ')).map((l) => l.slice(13)));
  // a section that fails only because its own set-up lines are wrong (a console command the server refused) is a broken test,
  // not a bug: the builder could never make it pass
  const whys = (title) => t.lines.filter((l) => l.startsWith(`SECTION WHY ${title} :: `)).map((l) => l.slice(`SECTION WHY ${title} :: `.length));
  const broken = (title) => { const w = whys(title); return w.length > 0 && w.every((x) => / @@ (?!@|js |py |lse |until |wait |restart)\S/.test(x) && /Unknown command|Syntax error|Could not|No targets|Invalid|is not a valid|incorrect argument/i.test(x)); };
  const found = fresh.filter((s) => bad.has(s.title) && !broken(s.title)), dropped = fresh.filter((s) => !bad.has(s.title)), brokenTests = fresh.filter((s) => bad.has(s.title) && broken(s.title));
  if (dropped.length || brokenTests.length) {
    const keep = after.split(/\r?\n/);
    fs.writeFileSync(tf, before.trimEnd() + '\n' + found.map((s) => '\n' + keep.slice(s.start, s.end + 1).join('\n') + '\n').join(''));
  }
  L.writeLock([...L.sectionsOf(L.lockFile(dir)), ...found]);
  if (!quiet) {
    for (const s of found) L.out(`BUG ${s.title}`);
    if (dropped.length) L.out(`not reproduced on a fresh server (dropped): ${dropped.map((s) => `"${s.title}"`).join(', ')}`);
    if (brokenTests.length) L.out(`broken tests (a set-up line the server refused; dropped): ${brokenTests.map((s) => `"${s.title}": ${whys(s.title)[0]?.replace(/ @@ /, ' during ').slice(0, 120)}`).join(' | ')}`);
    L.out(`PLAYTEST ${found.length} bug(s) → tests.txt, locked in tests.lock`);
  }
  return { found: found.map((s) => s.title), use: r?.use ?? {}, log: r?.log ?? r?.transcript };
}

// ---- an agent CLI does the work ----
function cliRun(L, via, prompt, { resume, play, name, model } = {}) {
  let tpl = CLIS[via] ?? via.match(/"[^"]*"|\S+/g).map((x) => x.replace(/^"|"$/g, ''));
  if (!tpl.includes('{prompt}')) L.die(`--via "${via}": the command needs {prompt}`);
  if (!has(tpl[0])) L.die(`${tpl[0]} not found on PATH`);
  if (via === 'claude' && resume) tpl = [...tpl, '--resume', resume];
  if (model && ['claude', 'gemini'].includes(via)) tpl = [...tpl, '--model', model];
  if (model && via === 'codex') tpl = [...tpl.slice(0, -1), '--model', model, tpl.at(-1)];
  if (via === 'claude' && play) tpl = [...tpl.filter((x) => x !== 'Bash(./lab.sh:*)'), '--max-turns', '60'];
  if (!play) L.out(`make: ${tpl[0]} is ${resume ? 'fixing' : 'building'} it (minutes)...`);
  return new Promise((resolve) => {
    // its own session (run from inside an agent, the parent's session id would be inherited: builder and playtester would share it)
    // and its lab and unit pinned (LAB_KIND, LAB_ADDON): another make or a person switching units meanwhile changes nothing for it
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE_CODE_SESSION_ID|CLAUDE_CODE_CHILD_SESSION|CLAUDE_PID|CLAUDE_AFTER_LAST_COMPACT)$/.test(k))), LAB_KIND: L.F.name, ...(name ? { LAB_ADDON: name } : {}) };
    const c = spawn(tpl[0], tpl.slice(1).map((x) => x.replace('{prompt}', () => prompt)), { cwd: L.TOP, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '', se = '';
    c.stdout.on('data', (d) => { so += d; });
    c.stderr.on('data', (d) => { se += d; });
    c.on('close', () => {
      const use = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, turns: 0, cost: null };
      let answer = '', session = null, transcript = null;
      try {   // claude -p --output-format json
        const j = JSON.parse(so.trim().split('\n').filter((l) => l.startsWith('{')).at(-1));
        const u = j.usage ?? {};
        Object.assign(use, { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, turns: j.num_turns ?? 0, cost: j.total_cost_usd ?? null });
        answer = j.result ?? ''; session = j.session_id ?? null;
        if (session) transcript = findTranscript(session, L.TOP);
      } catch {
        for (const l of so.split('\n')) {   // codex --json: the last token_count
          try { const e = JSON.parse(l); const t = (e.payload ?? e.msg ?? e)?.info?.total_token_usage; if (t) Object.assign(use, { in: (t.input_tokens ?? 0) - (t.cached_input_tokens ?? 0), cacheRead: t.cached_input_tokens ?? 0, out: t.output_tokens ?? 0 }); if (/function_call|exec_command/.test(l)) use.turns++; } catch { /* text */ }
        }
        answer = so.trim().split('\n').filter((l) => !l.startsWith('{')).slice(-6).join('\n');
      }
      if (!so.trim() && se.trim()) L.out('make: ' + se.trim().split('\n').slice(-3).join(' | '));
      resolve({ use, answer, session, transcript });
    });
  });
}
// where Claude Code keeps a session's transcript (for bench friction): the folder named after the working directory first
function findTranscript(session, cwd = process.cwd()) {
  const root = path.join(os.homedir(), '.claude', 'projects'), own = path.join(root, cwd.replace(/[^A-Za-z0-9]/g, '-'), session + '.jsonl');
  if (fs.existsSync(own)) return own;
  try { for (const d of fs.readdirSync(root)) { const f = path.join(root, d, session + '.jsonl'); if (fs.existsSync(f)) return f; } } catch { /* none */ }
  return null;
}

// ---- the lab's own agent: a few tools, a short system prompt, prompt caching ----
const BUILD_TOOLS = [
  { name: 'lab', description: 'Run `node lab.mjs <args>` (the bds-lab CLI) from the lab folder. Returns its output.', params: { args: 'string' } },
  { name: 'write', description: 'Write a whole file. path is relative to the unit folder (src/main.ts, tests.txt, bp/..., rp/...).', params: { path: 'string', content: 'string' } },
  { name: 'edit', description: 'Replace one exact, unique string in a file (path relative to the unit folder).', params: { path: 'string', old: 'string', new: 'string' } },
  { name: 'read', description: 'Read a file (path relative to the unit folder; ../../../common/... reaches the lab).', params: { path: 'string' } },
];
const PLAY_TOOLS = [
  { name: 'do', description: 'Play on the live server: tests.txt lines, one per array item (e.g. ["@A join", "@A cmd /lab:shop", "until form", "@A form 0"]). Returns what happened.', params: { lines: 'array' } },
  { name: 'read', description: 'Read a file of the unit (path relative to its folder: tests.txt, TASK.md, src/...).', params: { path: 'string' } },
  { name: 'append_test', description: 'Append one section to tests.txt: title (the right behaviour, a few words) and lines (the reproduction and the expectations of the right behaviour).', params: { title: 'string', lines: 'array' } },
];
const schema = (t) => ({ type: 'object', properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, v === 'array' ? { type: 'array', items: { type: 'string' } } : { type: v }])), required: Object.keys(t.params) });

function runTool(L, dir, call) {
  const inside = (p) => { const f = path.resolve(dir, p); if (!f.startsWith(L.TOP + path.sep)) throw new Error('outside the lab'); return f; };
  const lab = (argv) => {
    const r = spawnSync(process.execPath, [path.join(L.TOP, 'lab.mjs'), L.F.name, ...argv], { cwd: L.TOP, encoding: 'utf8', timeout: 900000, maxBuffer: 64e6, env: { ...process.env, LAB_NOTRACE: '1', LAB_ADDON: path.basename(dir) } });
    const o = ((r.stdout ?? '') + (r.stderr ?? '')).trim();
    return o.length > 6000 ? o.slice(0, 3000) + `\n... (${o.length - 6000} chars cut) ...\n` + o.slice(-3000) : o || `(exit ${r.status})`;
  };
  try {
    if (call.name === 'lab') {
      const argv = (call.input.args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^["']|["']$/g, ''));
      if (['make', 'playtest', 'unlock', 'bg', 'handoff', 'publish', 'github', 'bds', 'end', 'll'].includes(argv[0])) return `not from here: ${argv[0]}`;
      return lab(argv);
    }
    if (call.name === 'do') return lab(['do', ...(Array.isArray(call.input.lines) ? call.input.lines : [String(call.input.lines ?? '')])]);
    if (call.name === 'append_test') {
      const title = String(call.input.title ?? '').replace(/^#+\s*/, '').replace(/^playtest:\s*/i, '').trim(), body = (Array.isArray(call.input.lines) ? call.input.lines : String(call.input.lines ?? '').split('\n')).map((x) => String(x).trim()).filter(Boolean);
      if (!title || !body.length) return 'ERR title and lines are needed';
      const tf = path.join(dir, 'tests.txt');
      fs.writeFileSync(tf, fs.readFileSync(tf, 'utf8').trimEnd() + `\n\n## playtest: ${title}\n${body.join('\n')}\n`);
      return `ok: "## playtest: ${title}" appended`;
    }
    if (call.name === 'write') { const f = inside(call.input.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, call.input.content); return 'ok'; }
    if (call.name === 'edit') {
      const f = inside(call.input.path), s = fs.readFileSync(f, 'utf8'), n = s.split(call.input.old).length - 1;
      if (n !== 1) return `old string found ${n} times: must be exactly once`;
      fs.writeFileSync(f, s.replace(call.input.old, () => call.input.new)); return 'ok';
    }
    if (call.name === 'read') { const t = fs.readFileSync(inside(call.input.path), 'utf8'); return t.length > 12000 ? t.slice(0, 12000) + '\n... (cut)' : t; }
    return 'unknown tool ' + call.name;
  } catch (e) { return 'ERR ' + e.message; }
}

async function post(url, headers, body) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    const t = await r.text();
    if ((r.status === 429 || r.status >= 500) && i < 4) { await new Promise((z) => setTimeout(z, 3000 * 2 ** i)); continue; }
    throw new Error(`${url}: HTTP ${r.status} ${t.slice(0, 300)}`);
  }
}

// one question, one answer, no tools: the small jobs (the missing lines of a language file). Default a small model. { text, tokens }
export async function ask1(via, prompt, { model, max = 4000 } = {}) {
  if (via === 'anthropic') {
    const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const r = await post(`${base}/v1/messages`, { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' }, { model: model ?? process.env.LAB_SMALL_MODEL ?? 'claude-haiku-4-5-20251001', max_tokens: max, messages: [{ role: 'user', content: prompt }] });
    return { text: (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''), tokens: (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0) };
  }
  if (via === 'openai') {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''), mdl = model ?? process.env.LAB_SMALL_MODEL ?? process.env.OPENAI_MODEL;
    if (!mdl) throw new Error('--via openai needs --model <id> (or OPENAI_MODEL)');
    const r = await post(`${base}/chat/completions`, { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? 'none'}` }, { model: mdl, messages: [{ role: 'user', content: prompt }] });
    return { text: r.choices?.[0]?.message?.content ?? '', tokens: (r.usage?.prompt_tokens ?? 0) + (r.usage?.completion_tokens ?? 0) };
  }
  const tpl = { claude: ['claude', '-p'], gemini: ['gemini', '-p'], codex: ['codex', 'exec'] }[via];
  if (!tpl) throw new Error(`--via ${via}: anthropic, openai, claude, gemini or codex`);
  // claude: a bare question (no Claude Code system prompt, tools, settings or MCP servers): measured 32.5k → 1.3k tokens a call;
  // its JSON carries the usage, so the autopilot's token caps count CLI calls too
  const json = via === 'claude', bare = json ? ['--output-format', 'json', '--system-prompt', 'Answer exactly what is asked, in the format asked. No tools.', '--tools', '', '--setting-sources', '', '--strict-mcp-config'] : [];
  const r = spawnSync(tpl[0], [...tpl.slice(1), ...bare, ...(model ? ['--model', model] : []), prompt], { encoding: 'utf8', timeout: 600000, maxBuffer: 64e6 });
  if (r.status !== 0) throw new Error(`${tpl[0]}: ${(r.stderr || r.stdout || '').trim().split('\n').at(-1)}`);
  if (json) try { const j = JSON.parse(r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1)), u = j.usage ?? {}; return { text: j.result ?? '', tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) }; } catch { /* plain text */ }
  return { text: r.stdout, tokens: 0 };
}

// context compaction: once a conversation is over `limit` characters, the bulk of what is no longer current is replaced by a
// one-line note: old tool outputs (earlier go/test runs, files read) and the text of files written earlier (the file on disk is
// the truth). The newest `keep` messages stay whole. Each turn resends the whole conversation (a cache read still counts as
// tokens), so a long build shrinks a lot; it happens rarely (only when over the limit), so the prompt cache is rebuilt rarely.
// Returns the characters dropped (0: nothing to do).
export function compact(msgs, anth, limit = 120000, keep = 6) {
  if (JSON.stringify(msgs).length <= limit) return 0;
  let dropped = 0;
  const shrink = (t, what) => { if (typeof t !== 'string' || t.length <= 400) return t; dropped += t.length - 160; return t.slice(0, 160) + `\n… (${what}: ${t.length} chars dropped to save tokens; run or read it again if needed)`; };
  const shrinkIn = (i) => { if (!i || typeof i !== 'object') return i; const o = { ...i }; for (const k of ['content', 'old', 'new']) if (typeof o[k] === 'string' && o[k].length > 400) { dropped += o[k].length; o[k] = `(${o[k].length} chars; the file on disk has it)`; } return o; };
  for (let i = anth ? 0 : 1; i < msgs.length - keep; i++) {
    const m = msgs[i];
    if (anth && Array.isArray(m.content)) m.content = m.content.map((c) => (c.type === 'tool_result' ? { ...c, content: shrink(c.content, 'old output') } : c.type === 'tool_use' ? { ...c, input: shrinkIn(c.input) } : c));
    else if (!anth && m.role === 'tool') m.content = shrink(m.content, 'old output');
    else if (!anth && m.tool_calls) m.tool_calls = m.tool_calls.map((c) => { try { const a = shrinkIn(JSON.parse(c.function.arguments || '{}')); return { ...c, function: { ...c.function, arguments: JSON.stringify(a) } }; } catch { return c; } });
  }
  return dropped;
}

// one conversation; `state` continues an earlier one (the builder fixing what the playtester found). verify: when the model
// stops, the lab runs go and sends the problems back (3 times at most). Every call is logged for bench friction.
async function apiLoop(L, { via, model, prompt, name, turns, state, tools, sys, verify, budget = 0, tag = null }) {
  const dir = path.join(L.ADDONS, name);
  const use = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, turns: 0, cost: null };
  let answer = '';
  const anth = via === 'anthropic';
  const mdl = model ?? (anth ? 'claude-sonnet-5-5' : process.env.OPENAI_MODEL);
  if (!mdl) L.die('--via openai needs --model <id> (or OPENAI_MODEL)');
  if (verify && !state) L.out(`make: ${via}:${mdl} is building it...`);
  const msgs = state?.msgs ?? (anth ? [] : [{ role: 'system', content: sys }]);
  msgs.push(anth ? { role: 'user', content: [{ type: 'text', text: prompt }] } : { role: 'user', content: prompt });
  const logf = state?.log ?? path.join(L.CACHE, 'make', `${Date.now().toString(36)}-${name}${tag ? '-' + tag : verify ? '' : '-playtest'}.jsonl`);
  fs.mkdirSync(path.dirname(logf), { recursive: true });
  const log = (role, content) => { try { fs.appendFileSync(logf, JSON.stringify({ type: role, message: { role, content } }) + '\n'); } catch { /* best-effort */ } };
  log('user', [{ type: 'text', text: prompt }]);
  let rounds = 0, lastSig = null;
  const limit = Number(process.env.LAB_CTX_LIMIT || 120000);
  for (let t = 0; t < turns; t++) {
    const cut0 = compact(msgs, anth, limit);
    if (cut0 && process.env.LAB_MAKE_LOG) L.out(`  context: ${cut0.toLocaleString('en')} chars of old outputs dropped`);
    if (budget > 0 && tokensOf(use) >= budget) { L.out(`make: token budget reached (${tokensOf(use).toLocaleString('en')})`); break; }
    use.turns++;
    let calls = [];
    if (anth) {
      // cache: the system prompt, and everything up to the newest message (each turn reads the last one back cheaply)
      const last = msgs.at(-1).content.at(-1); last.cache_control = { type: 'ephemeral' };
      const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
      const r = await post(`${base}/v1/messages`, { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' },
        { model: mdl, max_tokens: 16000, system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }], tools: tools.map((x) => ({ name: x.name, description: x.description, input_schema: schema(x) })), messages: msgs });
      delete last.cache_control;
      const u = r.usage ?? {};
      use.in += u.input_tokens ?? 0; use.out += u.output_tokens ?? 0; use.cacheRead += u.cache_read_input_tokens ?? 0; use.cacheWrite += u.cache_creation_input_tokens ?? 0;
      msgs.push({ role: 'assistant', content: r.content }); log('assistant', r.content);
      calls = r.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, input: c.input }));
      const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (text.trim()) answer = text;
    } else {
      const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const r = await post(`${base}/chat/completions`, { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? 'none'}` },
        { model: mdl, messages: msgs, tools: tools.map((x) => ({ type: 'function', function: { name: x.name, description: x.description, parameters: schema(x) } })) });
      const u = r.usage ?? {}, cached = u.prompt_tokens_details?.cached_tokens ?? 0;
      use.in += (u.prompt_tokens ?? 0) - cached; use.cacheRead += cached; use.out += u.completion_tokens ?? 0;
      const m = r.choices[0].message;
      msgs.push(m);
      calls = (m.tool_calls ?? []).map((c) => { let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch { /* bad json → tool error */ } return { id: c.id, name: c.function.name, input }; });
      log('assistant', [...(m.content ? [{ type: 'text', text: m.content }] : []), ...calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input }))]);
      if (m.content?.trim()) answer = m.content;
    }
    if (calls.length) {
      const res = calls.map((c) => { const o = runTool(L, dir, c); if (process.env.LAB_MAKE_LOG) L.out(`  ${c.name} ${JSON.stringify(c.input).slice(0, 120)} → ${o.split('\n').at(-1).slice(0, 100)}`); return [c, o]; });
      if (anth) msgs.push({ role: 'user', content: res.map(([c, o]) => ({ type: 'tool_result', tool_use_id: c.id, content: o })) });
      else for (const [c, o] of res) msgs.push({ role: 'tool', tool_call_id: c.id, content: o });
      log('user', res.map(([c, o]) => ({ type: 'tool_result', tool_use_id: c.id, content: o })));
      use.verified = undefined;
      continue;
    }
    if (!verify) break;
    // the model stopped: check it the lab's way, send the problems back at most 3 times
    const g = process.env.LAB_MAKE_VERIFY === 'off' ? { ok: true, lines: ['(verify off)'] } : runGo(L, name);
    use.verified = g.ok; use.goOut = g.lines;
    if (g.ok || ++rounds > 3) break;
    const fb = `node lab.mjs ${UNTIL} says:\n` + g.lines.slice(-40).join('\n') + '\nFix it.';
    // the same verdict twice in a row after the model said it was done: another round would spend tokens on the same guess
    const sig = g.lines.filter((l) => /^(✘|E |Q |FAIL)/.test(l)).join('\n');
    if (sig && sig === lastSig) { L.out('make: the same failures twice after "done": stopped (the tokens would go to the same guess)'); break; }
    lastSig = sig;
    msgs.push(anth ? { role: 'user', content: [{ type: 'text', text: fb }] } : { role: 'user', content: fb }); log('user', [{ type: 'text', text: fb }]);
  }
  if (verify && use.goOut) use.goOut.slice(-12).forEach((l) => L.out(l));
  return { use, answer, state: { msgs, log: logf }, log: logf };
}
