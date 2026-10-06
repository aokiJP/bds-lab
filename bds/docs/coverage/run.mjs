#!/usr/bin/env node
// Runs spec.txt on a real BDS (real client A, probe addon, event/state tap) and writes ../EVENTS.md from the results.
//   node docs/coverage/run.mjs [regex]   (regex: run only matching section ids; EVENTS.md is written on full runs only)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;

// every section starts from this state (printed before the `##`, so it never counts toward a section)
const RESET_CMDS = ['execute in overworld run tp A 0.5 -60 0.5', 'gamemode survival A', 'clear A', 'effect A clear', 'tag A remove god', 'tag A remove noheal', 'tag A remove lockmode',
  'op A', 'kill @e[type=!player]', 'fill -14 -60 -22 14 -50 12 air', 'fill -14 -63 -22 14 -62 12 dirt', 'fill -14 -61 -22 14 -61 12 grass_block', 'fill 20 -60 -4 26 -55 4 air', 'fill 20 -61 -4 26 -61 4 grass_block',
  'time set noon', 'gamerule dodaylightcycle false', 'weather clear', 'effect A saturation 1 255 true'];
// everything a section may change on A that the commands above do not undo; `$` (script objects kept by a section) is emptied too:
// a server-ui MessageBox kept alive across A's rejoin made the new Player's locatorBar.addWaypoint throw "internal engine error" (BDS 1.26.51)
const RESET_JS = ['for(const k of Object.keys($))delete $[k]', "q.getComponent('health').resetToMaxValue()", 'q.resetLevel()', 'for(const t of q.getTags())q.removeTag(t)', 'q.clearDynamicProperties()',
  'for(const c of Object.keys(mc.InputPermissionCategory))if(isNaN(+c))q.inputPermissions.setPermissionCategory(mc.InputPermissionCategory[c],true)',
  'q.setControlScheme()', 'q.camera.clear()', "q.nameTag='A'", 'q.chatNamePrefix=undefined', 'q.setSpawnPoint()', "q.getComponent('ender_inventory').container.clearAll()", "q.getComponent('cursor_inventory').clear()",
  'q.extinguishFire()', "for(const k of ['movement','underwater_movement','lava_movement','player.hunger','player.saturation'])q.getComponent(k)?.resetToDefaultValue()", 'q.selectedSlotIndex=0',
  'q.commandPermissionLevel=mc.CommandPermissionLevel.GameDirectors', 'q.chatNameSuffix=undefined', 'q.chatMessagePrefix=undefined', 'for(const t of q.fogSettings.getTags())q.fogSettings.remove(t)',
  'q.locatorBar.removeAllWaypoints()', 'q.onScreenDisplay.resetHudElementsVisibility()', 'q.getAimAssist().set()', 'q.stopAllSounds()', 'q.stopMusic()', 'q.camera.stopShaking()', 'q.camera.setFov()'].map((x) => `try{${x}}catch{}`).join(';') + ';';
const RESET = ['@A watch off', '@A crawl off', '@A typing off', '@A respawn', '@A stop', '@A look 0 0', '@A slot 0', 'trace off',
  `js for(const c of ${JSON.stringify(RESET_CMDS)})dim.runCommand(c); const q=p('A'); ${RESET_JS} return 'reset'`, 'wait 300'];
// the prologue also prints what exists (all event signals, the real client's actions) for the completeness check
const PROLOGUE = ['@A join', 'wait 500', 'events on', 'states on', 'gamerule randomtickspeed 1',
  "js const n=[];for(const[s,p]of[[world.afterEvents,'after'],[world.beforeEvents,'before'],[system.afterEvents,'system']])for(const k of Object.getOwnPropertyNames(Object.getPrototypeOf(s)))if(k!=='constructor')n.push(p+'.'+k);return 'ALL_EVENTS '+n.join(',')",
  '@A actions'];

// parse spec.txt
const sections = [];
for (const raw of fs.readFileSync(path.join(HERE, 'spec.txt'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim();
  if (l.startsWith('## ')) {
    const [id, cond, why] = l.slice(3).split(' | ').map((x) => x.trim());
    sections.push({ id, cond, skip: why?.replace(/^不可:\s*/, ''), lines: [] });
  } else if (sections.length && l && !l.startsWith('#')) sections.at(-1).lines.push(l);
}
const run = sections.filter((s) => !s.skip && (!only || only.test(s.id)));

// build one sectioned test file; remember which file line belongs to which section
const file = [...PROLOGUE];
const owner = [];   // file line (1-based) -> section
for (const s of run) {
  file.push(...RESET);
  file.push(`## ${s.id}`); owner[file.length] = s;
  for (const l of s.lines) { file.push(l); owner[file.length] = s; }
}
const tmp = path.join(HERE, '.spec-run.txt');
fs.writeFileSync(tmp, file.join('\n') + '\n');
const t0 = Date.now();
const r = spawnSync(process.execPath, [path.join(HERE, 'lab.mjs'), 'test', tmp], { cwd: HERE, encoding: 'utf8', env: { ...process.env, LAB_NOTRACE: '1', LAB_MAX: '1000000', LAB_SHOWMATCH: '1', LAB_DUMP: path.join(HERE, 'last-run.txt') }, maxBuffer: 256e6 });
if (r.status && !/^(PASS|FAIL) /m.test(r.stdout)) console.log(r.stdout.slice(-3000) + r.stderr.slice(-2000));
fs.rmSync(tmp, { force: true });

// results per section: failures (✘ with detail) and the first matched line of each `~` (what the API actually reported)
const out = r.stdout.split('\n');
for (let i = 0; i < out.length; i++) {
  const m = /^([✘✔]) (\d+): ?(.*)$/.exec(out[i]);
  if (!m) continue;
  const s = owner[+m[2]];
  if (!s) continue;
  if (m[1] === '✘') (s.fail ??= []).push(`${out[i + 1]?.trim()} / ${out[i + 2]?.trim()}`);
  else if (/^(EV|ST|HOOK|BOOT|CANCEL|@\w+ saw|@\w+ npc) /.test(m[3])) (s.seen ??= []).push(m[3]);
}
const summary = out.filter((l) => /^(PASS|FAIL) /.test(l)).at(-1) ?? 'no result (see last-run.txt)';
// completeness: what exists on this BDS vs what has a section (only meaningful on a full run)
const dump = fs.existsSync(path.join(HERE, 'last-run.txt')) ? fs.readFileSync(path.join(HERE, 'last-run.txt'), 'utf8') : '';
const allEvents = (/^ALL_EVENTS (.*)$/m.exec(dump)?.[1] ?? '').split(',').filter(Boolean).concat('system.startup');
const stateKeys = [...new Set((/^ST A init (.*)$/m.exec(dump)?.[1] ?? '').split(' ').map((kv) => kv.split('=')[0]).filter(Boolean).concat('riding', 'onfire'))];
const actions = (/^@A actions (.*)$/m.exec(dump)?.[1] ?? '').split(' ').filter((a) => a && a !== 'actions');
// what the d.ts of the probe's @minecraft/server version declares: custom component hooks, the player-facing API, custom command enums
const ver = JSON.parse(fs.readFileSync(path.join(HERE, 'bp', 'manifest.json'), 'utf8')).dependencies.find((d) => d.module_name === '@minecraft/server').version;
const dts = [path.join(HERE, '.lab', 'types'), path.join(HERE, '..', '..', '.lab', 'types')].map((d) => path.join(d, `server@${ver}.d.ts`)).find((f) => fs.existsSync(f));
const DTS = dts ? fs.readFileSync(dts, 'utf8') : '';
const body = (kind, name) => { const m = new RegExp(`export (?:declare )?${kind} ${name}\\b[^{]*\\{`).exec(DTS); if (!m) return ''; let d = 1, j = m.index + m[0].length; const i = j; while (d && j < DTS.length) { if (DTS[j] === '{') d++; else if (DTS[j] === '}') d--; j++; } return DTS.slice(i, j - 1).replace(/\/\*\*[\s\S]*?\*\//g, ''); };
const members = (kind, name, rw = true) => { const b = body(kind, name); return [...new Set([...b.matchAll(/^ {4}(?!readonly |private |constructor)(\w+)\??(\(|:)/gm)].filter((m) => rw || m[2] === '(').map((m) => m[1]))]; };
const enumVals = (name) => [...body('enum', name).matchAll(/^\s*(\w+) = /gm)].map((m) => m[1]);
const HOOKS = [...members('interface', 'ItemCustomComponent').map((h) => 'item.' + h), ...members('interface', 'BlockCustomComponent').map((h) => 'block.' + h)];
const API_CLASSES = ['Player', 'ScreenDisplay', 'Camera', 'LocatorBar', 'Waypoint', 'LocationWaypoint', 'EntityWaypoint', 'PlayerWaypoint', 'PlayerAimAssist', 'PlayerInputPermissions', 'FogSettings', 'SoundInstance'];
const STATE_ALIAS = { 'Player.getTotalXp': 'state.totalXp', 'Player.getGameMode': 'state.gameMode', 'Player.getControlScheme': 'state.controlScheme', 'Player.getSpawnPoint': 'state.spawnPoint', 'Player.getItemCooldown': 'state.cooldown.ender_pearl' };
const API = DTS ? API_CLASSES.flatMap((c) => { const m = members('class', c); return m.length ? m.map((x) => `api.${c}.${x}`) : [`api.${c}`]; }).filter((id) => !STATE_ALIAS[id.slice(4)]) : [];
const COMMANDS = DTS ? [...enumVals('CustomCommandParamType').map((v) => 'command.' + v), ...enumVals('CustomCommandSource').map((v) => 'command.source.' + v), 'command.status.Failure', 'command.optional'] : [];
const ids = new Set(sections.map((s) => s.id));
const used = new Set(sections.flatMap((s) => s.lines.map((l) => /^@[A-Z]\S* (\S+)/.exec(l)?.[1]).filter(Boolean)));
const missing = { events: allEvents.filter((e) => !ids.has(e)), states: stateKeys.filter((k) => !ids.has('state.' + k)), hooks: HOOKS.filter((h) => !ids.has(h)), api: API.filter((a) => !ids.has(a)), commands: COMMANDS.filter((c) => !ids.has(c)), actions: actions.filter((a) => !used.has(a) && !ids.has('op.' + a)) };   // op.<action> marked 不可 also accounts for it
const stray = out.filter((l) => /^E /.test(l));
for (const s of run) s.ok = !s.fail && !!/^(PASS|FAIL)/.test(summary);
for (const s of run) if (s.fail) console.log(`✘ ${s.id}\n  ${s.fail.join('\n  ')}`);
if (stray.length) console.log('unexpected errors:\n' + stray.slice(0, 10).join('\n'));
const n = (f) => run.filter(f).length;
console.log(`${n((s) => s.ok)}/${run.length} sections pass, ${sections.filter((s) => s.skip).length} not triggerable, ${Math.round((Date.now() - t0) / 1000)}s | ${summary}`);
if (!only) console.log(`exists on this BDS: events ${allEvents.length}, player state keys ${stateKeys.length}, hooks ${HOOKS.length}, api members ${API.length}, custom command cases ${COMMANDS.length}, client actions ${actions.length} | without a section: ${Object.entries(missing).map(([k, v]) => `${k} ${v.length}${v.length ? ' (' + v.join(' ') + ')' : ''}`).join(', ')}`);
if (only) process.exit(run.every((s) => s.ok) ? 0 : 1);

// ---------- EVENTS.md ----------
const code = (x) => '`' + x.replace(/\|/g, '\\|') + '`';
const how = (s) => s.lines.filter((l) => !/^[=~!]/.test(l)).map(code).join(' → ');
const seen = (s) => (s.seen ?? []).filter((l) => /^(api|command)\./.test(s.id) || l.includes(s.id.replace(/^state\./, ' ').replace(/^(item|block)\./, '$1.')) || l.startsWith('ST ')).slice(0, 2).map((l) => code(l.length > 160 ? l.slice(0, 157) + '...' : l)).join('<br>');
const row = (s) => s.skip ? `| ${code(s.id)} | — | ${s.cond} | 不可: ${s.skip} | |`
  : `| ${code(s.id)} | ${s.ok ? '✔' : '✘'} | ${s.cond} | ${how(s)} | ${s.ok ? seen(s) : 'FAIL: ' + (s.fail ?? []).join(' ').replace(/\|/g, '\\|').slice(0, 200)} |`;
const group = (f) => sections.filter(f).map(row).join('\n');
const isEv = (s) => /^(after|before|system)\./.test(s.id), isSt = (s) => s.id.startsWith('state.'), isHk = (s) => /^(item|block)\./.test(s.id), isOp = (s) => s.id.startsWith('op.'), isApi = (s) => s.id.startsWith('api.'), isCmd = (s) => s.id.startsWith('command.');
// 不可 = no one can fire it on a BDS (reason + proof in the row): counted apart, not as a miss
const cnt = (f) => { const na = sections.filter((s) => f(s) && s.skip).length; return `${sections.filter((s) => f(s) && s.ok).length}/${sections.filter((s) => f(s) && !s.skip).length}**${na ? `（ほかに BDS では誰にも起こせないもの ${na} 件）` : ''}`; };
const HEAD = '| id | 結果 | 条件（この id だけの発生条件） | 起こし方（lab のコマンド） | 実測（そのとき API が渡した値） |\n|---|---|---|---|---|';
fs.writeFileSync(path.join(HERE, '..', 'EVENTS.md'), `# イベント・プレイヤー状態・フックの厳密対応表

\`node docs/coverage/run.mjs\` が実機 BDS で [spec.txt](coverage/spec.txt) を流して生成した表（手書きの行は無い）。
各 id は **それ専用の発生条件** で 1 回ずつ、同じ初期状態から試す（ほかの id と同じ操作を使い回さない）。
不可 = BDS では人にもスクリプトにも起こせない（理由と確かめ方を書いた。数には入れない）。✔ = spec.txt の確認（\`~\` 出るべき行・\`!~\` 出てはいけない行・\`=\` 結果の値）がすべて通った。before 系は cancel したときの効果（after が出ない・状態が変わらない）まで確かめている。
自分のアドオンで同じものを見るには \`events on [名前...]\` と \`states on\`（出力は下の「実測」と同じ形）。

- 生成: ${new Date().toISOString()} / ${summary}
- イベント（world.afterEvents / beforeEvents / system.afterEvents）: **${cnt(isEv)}
- プレイヤー状態（Player / Entity の条件）: **${cnt(isSt)}
- カスタムコンポーネントのフック: **${cnt(isHk)}
- real player の操作（動き・照準・画面・道具）: **${cnt(isOp)}
- スクリプト → クライアント（Player / 画面 / カメラ / 目印 / 霧 / 音のメソッドを呼んだとき、本物のクライアントに届いたもの）: **${cnt(isApi)}
- カスタムコマンド（引数の型・呼び出し元・結果）: **${cnt(isCmd)}
- 網羅チェック（この BDS に在るもの − 区間があるもの）: イベント ${allEvents.length} 中 ${missing.events.length} 件不足、プレイヤー状態 ${stateKeys.length} 中 ${missing.states.length} 件、フック ${HOOKS.length} 中 ${missing.hooks.length} 件、API メンバー ${API.length} 中 ${missing.api.length} 件、カスタムコマンド ${COMMANDS.length} 中 ${missing.commands.length} 件、real player の動作 ${actions.length} 中 ${missing.actions.length} 件${Object.values(missing).some((v) => v.length) ? '（' + Object.entries(missing).filter(([, v]) => v.length).map(([k, v]) => k + ': ' + v.join(' ')).join(' / ') + '）' : '（不足なし）'}

## イベント

${HEAD}
${group(isEv)}

## プレイヤー状態

\`states on\` は最初に \`ST <名前> init …\` を 1 行、あとは変化したときだけ \`ST <名前> <キー>=<値>\` を出す。キーは Script API の名前そのまま（\`state.<キー>\` がその区間）。サーバーやスクリプトしか変えられないもの（権限・タグ・入力許可など）は、その旨を条件に書き、検知できることを確かめている。

${HEAD}
${group(isSt)}

## カスタムコンポーネントのフック

[probe アドオン](coverage/bp/scripts/main.js) が呼ばれるたびに \`HOOK <種類>.<フック> 引数\` を出す。

${HEAD}
${group(isHk)}

## real player の操作（動き・照準・画面・道具）

どれも、操作のあとに Script API から見える結果（持ち物・エンチャント・名前・効果・看板の文字・本の中身など）で確かめる。

${HEAD}
${group(isOp)}

## スクリプト → クライアント

\`@A watch <パケット名,...>\`（\`on\` で全部）で、サーバーがこのクライアントに送ったものを \`@A saw <パケット> {json}\` で出す。d.ts にある Player・ScreenDisplay・Camera・LocatorBar・Waypoint・PlayerAimAssist・PlayerInputPermissions・FogSettings・SoundInstance のメソッドと書き込めるプロパティはすべて区間がある（Player の getter のうちプレイヤー状態のものは上の state.* が担当）。minecraft-data の表が BDS 1.26.51 と食い違うパケット（set_hud・camera_instruction の fade/fov/spline・clientbound_update_sound_data・level_event_generic・player_update_entity_overrides・update_client_input_locks）は、バイト列を実測して直した定義で読んでいる。

${HEAD}
${group(isApi)}

## カスタムコマンド

probe が \`/probe:p_<型>\` を CustomCommandParamType の全部について、ほかに \`/probe:npc\`・\`/probe:fail\`・\`/probe:opt\` を登録し、呼ばれるたびに \`HOOK command.<名前> sourceType=… sourceEntity=… initiator=… sourceBlock=… args=…\` を出す。

${HEAD}
${group(isCmd)}
`);
console.log('-> docs/EVENTS.md');
