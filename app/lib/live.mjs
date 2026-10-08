// live: the CI device kept up after the device build (workflow input `hold`, `app hold`), driven from anywhere through the
// comments of one issue of the (private) repository: `lab@<run> <command>` lines in, `lab-reply@<run> #<id>` replies out
// (text, and the screen as a small PNG in an HTML comment). Nothing to commit, nothing to rebuild: a device stuck on a
// screen is looked at and pressed from here in seconds (`node lab.mjs app live "<command>"`).
// Only the comments of the user who started the run are run (LIVE_USER), and only for this run; commands act on the
// device (adb), never on the runner's own shell.
// In a repository that is not private everyone reads the issue: the commands, the replies (and their screen) and the numbers of
// a two-step sign-in are sealed there (vault's sealText, AES-256-GCM, the vault key) after a plain head that only says
// which run they are for: `lab@<run> lab-sealed:v1:…`, `lab-reply@<run> #<id>\nlab-sealed:v1:…`. Both sides decide the same way
// (APP_REPO_VISIBILITY: anything but "private" is public); a sealed comment is opened wherever there is the key (private too),
// and one that does not open (wrong key, altered) is no command. Public without a key: nothing is written (never plain).
import { vaultKey, sealText, openText } from './vault.mjs';
import { GAME_VERBS, GAME_HELP } from './play.mjs';
import { button, row, modal, modalValues } from './discord.mjs';
export const ISSUE_TITLE = 'app live: 実機をそのまま調べる（ラボが使います）';
export const HELP = [
  'screen                      いまの画面（返事に画像）・前の窓・描画の速さ・画面の文字（OCR）',
  'tap <x> <y> [tap|hold|motion|panel]   押す（0〜1 は割合。panel: 端末のタッチパネルから）   swipe <x1> <y1> <x2> <y2> [ミリ秒]',
  'key <BACK|ENTER|ESCAPE|DPAD_DOWN|… か番号>   text <文字>   wait <ミリ秒>',
  'pad <A|B|X|Y|UP|DOWN|LEFT|RIGHT|L1|R1|START|SELECT>   ゲームパッドのボタン（1.26 の新しい画面は、タップでなくこれで動く）',
  'sh <コマンド>               端末のシェル（runner のではない）',
  'logcat [行数] [正規表現]    端末のログの最後',
  'input                       Android の入力の行き先（dumpsys input: 前の窓、触れた窓）',
  'windows                     いまの窓（dumpsys window windows の見出し）',
  'fps | gpu                   ゲームの描画の速さ / GPU とゲーム自身のログ',
  'files                       端末の中身の大きさ（runner の AVD のファイルと、端末の /data）: キャッシュを小さくする手がかり',
  'launch | kill               ゲームを起動 / 止める',
  'options [正規表現] | options set <キー>=<値> …   ゲームの options.txt を見る / 書く（次の起動から）',
  'title [分]                  タイトル画面まで待つ（prepare と同じ: 最初の画面は押し方を変えて抜ける）',
  'bds up [ポート] | bds down | bds do <コマンド>   この runner でラボの BDS（実行のアドオン入り）',
  'bdslog [行数] [正規表現]    この runner の BDS のログ（live の bds up のものと、最後の run のもの）',
  'answer                      Android のダイアログ（応答なし・停止）に答える（レイアウトから「待つ」、無ければキー）',
  'relay [BDS のポート]         端末の中継 127.0.0.1:19132 → この runner の BDS（サインインなしで参加できる）',
  'join [ポート] | join <host> <ポート>   参加のリンク（既定: 中継の 127.0.0.1:19132）',
  'run [--scenario <ファイル>] | run <<（次の行から EOF の行までが手順）   この端末のまま app run（復元なし: 数秒で始まる）',
  'ui [--screens <id,id>] [--all] [--sizes …] [--cutouts …]   この端末のまま app ui（JSON UI の画面すべて）',
  'pull <枝>                   アドオンのファイルをその枝から取り直す（push して pull して run: 新しい実行は要らない）',
  'last [画面の名前の正規表現 | list]   いまの端末で最後に走った run / ui の報告と、その画面（既定: 失敗した所、無ければ最後）',
  'signin | code <数字>        ゲームを Microsoft アカウントにサインイン（secrets の MS_EMAIL / MS_PASSWORD。二段階の確認は承認かコード）',
  'world [restart]             自分のワールドを端末に置く（新しい人の流れを避ける。restart: ゲームを起動し直して一覧に）',
  'seal                        いまの状態をスナップショットにして、準備済みの端末として非公開のキャッシュに入れる',
  'stop                        終わる（hold を抜けて、ジョブの残りへ）',
  '--- ゲームを人のように遊ぶ（ワールドの中で。端末のコントローラーのスティック・トリガー・ボタン）',
  ...GAME_HELP,
  '--- app.txt の手順をこの端末のまま（BDS も参加もそのまま。1 行ずつ、または steps << で続けて）',
  'chat <文字>   tap text <正規表現>   until|expect|absent text <正規表現> [ミリ秒]   press <キー>[+<キー>] [ミリ秒]   hold <x> <y> [ミリ秒]',
  'mouse tap|move <x> <y> / mouse scroll <x> <y> <量>   shot <名前>   do <BDS のコマンド>   until server|clientlog <正規表現> [ミリ秒]',
  'perf [ミリ秒]   network delay|speed …   size <幅>x<高さ>|reset   density <dpi>|reset   cutout <形>|none   background   foreground   trim <段階>',
  'screen off|on   step <app.txt の 1 行>（live と同じ名前の手順: step stop / step join / step launch …）',
  'steps <<（次の行から EOF まで app.txt の手順。record start … record stop もこの中で）',
].join('\n');
// app.txt's steps live runs as they are (lib/scenario.mjs on the device as it is): the ones live has no verb of its own for
export const STEP_VERBS = new Set(['shot', 'do', 'until', 'expect', 'absent', 'push', 'chat', 'press', 'hold', 'record', 'perf', 'changed', 'network', 'size', 'density', 'cutout', 'mouse', 'background', 'foreground', 'trim']);
const VERBS = new Set(['screen', 'tap', 'pad', 'swipe', 'key', 'text', 'wait', 'sh', 'logcat', 'input', 'windows', 'fps', 'gpu', 'files', 'relay', 'join', 'bds', 'launch', 'kill', 'options', 'title', 'run', 'ui', 'pull', 'last', 'bdslog', 'answer', 'signin', 'code', 'world', 'seal', 'stop', 'help',
  'step', 'steps', ...STEP_VERBS, ...GAME_VERBS]);
/** verbs that take minutes (a whole run on the device): `app live` waits longer for them */
export const LONG = new Set(['run', 'ui', 'title', 'seal', 'pull', 'signin', 'steps']);
/** how live runs a command line (pure): 'game' (lib/play.mjs), 'step' (one app.txt step: lib/scenario.mjs), 'steps'
 *  (several: steps <<), else 'live' (its own verb) */
export function liveKind(line) {
  const t = String(line ?? '').trim(), [verb, a0] = t.split(/\s+/);
  if (GAME_VERBS.has(verb)) return 'game';
  if (verb === 'steps') return 'steps';
  if (verb === 'step' || STEP_VERBS.has(verb) || (verb === 'tap' && a0 === 'text') || (verb === 'screen' && /^(on|off)$/.test(a0 ?? ''))) return 'step';
  return 'live';
}

const SEALED = 'lab-sealed:v1:';
/** is the repository public (pure): APP_REPO_VISIBILITY set and not "private" */
// (not said in GitHub Actions: taken as public — the safe side; on this machine app live says it from gh repo view)
export const isPublic = (env = process.env) => { const v = String(env.APP_REPO_VISIBILITY ?? '').trim().toLowerCase(); return v ? v !== 'private' : env.GITHUB_ACTIONS === 'true'; };
/** a comment's text after its head → the text: opened when sealed (null: not openable), plain only where the repository is private */
function unseal(rest, env) {
  const t = String(rest ?? '').trim();
  if (t.startsWith(SEALED)) return openText(t.split(/\s/)[0], vaultKey(env));
  return isPublic(env) ? null : String(rest ?? '');
}
/** text → what goes in an issue after the head: sealed when public (null: public and no key, so nothing may be written) */
function enseal(text, env) {
  if (!isPublic(env)) return text;
  const k = vaultKey(env);
  return k ? sealText(text, k) : null;
}
/** the comment a command is sent as (lab@<run> …), sealed when public; null when it cannot be sealed */
export function commandBody(run, text, env = process.env) {
  const b = enseal(String(text), env);
  return b === null ? null : `lab@${String(run).replace(/\D/g, '')} ${b}`;
}
/** a sign-in step's message for the issue (lab-live@<run> …), sealed when public */
export function tellBody(run, text, env = process.env) {
  const b = enseal(String(text), env);
  return `lab-live@${run} ${b === null ? '（公開のリポジトリで鍵がないため、内容は書きません）' : b}`;
}
/** a lab-live@<run> comment's text (opened when sealed), null when it is not that run's or does not open */
export function tellText(body, run, env = process.env) {
  const m = new RegExp(`^lab-live@${String(run).replace(/\D/g, '')} ([\\s\\S]*)$`).exec(String(body ?? ''));
  return m ? (m[1].trim().startsWith(SEALED) ? unseal(m[1], env) : m[1]) : null;
}
/** a comment's "code 123456" for this run (the number of a two-step sign-in), null when it is not one */
export function codeOf(body, run, env = process.env) {
  const cmds = commandsOf(body, run, env);
  const m = cmds && /^code\s+(\d{4,10})\b/.exec(cmds[0] ?? '');
  return m ? m[1] : null;
}
/** a comment's commands for this run (pure): "lab@<run> a\nb" → ['a', 'b'], null when it is not one. A line that ends in
 *  "<<" takes the lines after it as they are (a scenario, its "## section" lines too) up to a line "EOF" (or the end):
 *  one command "run <<\n…" */
export function commandsOf(body, run, env = process.env) {
  const m = new RegExp(`^lab@${String(run).replace(/\D/g, '')}\\s+([\\s\\S]+)$`).exec(String(body ?? '').trim());
  if (!m) return null;
  const text = unseal(m[1], env);
  return text === null ? null : splitCommands(text);
}
/** a text's commands (pure): one a line, `#` lines and blank ones left out, a "<<" line taking the lines after it up to
 *  "EOF" (one command); at most 30. The issue's comments and Discord's messages alike */
export function splitCommands(text) {
  // (up to a line "---": what a server may add under a comment, e.g. a signature, is not a command)
  const raw = String(text ?? '').trim().split(/\n---\s*(\n|$)/)[0].split('\n'), cmds = [];
  for (let i = 0; i < raw.length && cmds.length < 30; i++) {
    const s = raw[i].trim();
    if (!s || s.startsWith('#')) continue;
    if (/<<\s*$/.test(s)) {
      let end = raw.findIndex((l, k) => k > i && /^\s*EOF\s*$/.test(l));
      if (end < 0) end = raw.length;
      cmds.push([s, ...raw.slice(i + 1, end)].join('\n'));
      i = end;
      continue;
    }
    cmds.push(s);
  }
  return cmds;
}
/** "a b <<\nline\nline" → { head: 'a b', text: 'line\nline\n' }; null when there is no "<<" (pure) */
export function heredoc(tail) {
  const m = /^([^\n]*?)\s*<<[ \t]*(?:\n([\s\S]*))?$/.exec(String(tail ?? ''));
  if (!m) return null;
  const text = (m[2] ?? '').replace(/\s+$/, '');
  return { head: m[1].trim(), text: text ? `${text}\n` : '' };
}
/** a command line → { verb, args } (pure), or { error } for an unknown verb */
export function parseCommand(line) {
  const [verb, ...rest] = String(line).trim().split(/\s+/);
  if (!VERBS.has(verb)) return { error: `知らないコマンド: ${verb}（help で一覧）` };
  // (sh and text keep their spaces)
  const tail = String(line).trim().slice(verb.length).trim();
  return { verb, args: rest, tail };
}
export const replyHead = (run, id) => `lab-reply@${run} #${id}`;
/** a reply (pure): its head, the text in a code block, the PNG as base64 in an HTML comment (not shown, read by `app live`) */
export function replyBody(run, id, text, png = null, limit = 60_000, env = process.env) {
  // (public: the text and the screen sealed together — the seal is a third bigger as base64, so a smaller room inside, and a
  //  screen that does not fit is left out: it is on the device, `app live pull`)
  const pub = isPublic(env);
  if (pub) limit = Math.floor((limit * 3) / 4) - 100;
  let note = '';
  if (pub && png && png.toString('base64').length > limit / 2) { png = null; note = '\n（画面は公開の issue には載せません: 手元の app live pull で）'; }
  const b64 = png ? png.toString('base64') : '';
  const room = Math.max(1000, limit - b64.length - 200);
  const t = String(text ?? '').replace(/```/g, "'''");
  // (public: counted in UTF-8 bytes — what the seal grows from; a cut character at the front is dropped)
  const tb = pub ? Buffer.from(t) : null;
  const fit = pub ? (tb.length > room ? `…（前を省略）\n${tb.subarray(tb.length - room).toString('utf8').replace(/^\uFFFD+/, '')}` : t)
    : t.length > room ? `…（前を省略）\n${t.slice(t.length - room)}` : t;
  const inner = `\`\`\`\n${fit}${note}\n\`\`\`${b64 ? `\n<!--png:${b64}-->` : ''}`;
  if (!pub) return `${replyHead(run, id)}\n${inner}`;
  const k = vaultKey(env);
  return `${replyHead(run, id)}\n${k ? sealText(inner, k) : '（公開のリポジトリで鍵がないため、内容は書きません）'}`;
}
/** a reply's parts (pure): { id, text, png } for that run, null when the body is not its reply */
export function replyParts(body, run, env = process.env) {
  const m = new RegExp(`^lab-reply@${run} #(\\d+)\\n`).exec(String(body ?? ''));
  if (!m) return null;
  const rest = unseal(String(body).slice(m[0].length), env);
  if (rest === null) return null;
  const png = /<!--png:([A-Za-z0-9+/=]+)-->/.exec(rest)?.[1];
  const text = rest.replace(/<!--png:[^>]*-->/g, '').replace(/^```\n?|\n?```\s*$/g, '').trim();
  return { id: Number(m[1]), text, png: png ? Buffer.from(png, 'base64') : null };
}

/** the issue comments API (fetch; GitHub's REST through GITHUB_API_URL, the run's GITHUB_TOKEN) */
export function api({ base = 'https://api.github.com', repo, token, fetchImpl = fetch } = {}) {
  const call = async (method, p, body) => {
    const r = await fetchImpl(`${base}/repos/${repo}${p}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'bds-lab' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`GitHub ${method} ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json();
  };
  return {
    /** the live issue's number: the open one with that title, else a new one */
    async issue() {
      for (let page = 1; page <= 3; page++) {
        const list = await call('GET', `/issues?state=open&per_page=100&page=${page}`);
        const hit = list.find((x) => x.title === ISSUE_TITLE && !x.pull_request);
        if (hit) return hit.number;
        if (list.length < 100) break;
      }
      return (await call('POST', '/issues', { title: ISSUE_TITLE, body: 'node lab.mjs app live が使う連絡用です（ワークフローの入力 hold で、端末を動かしたまま待つ実行が、ここへのコメントの命令を実行します）。' })).number;
    },
    comments: (n, since) => call('GET', `/issues/${n}/comments?per_page=100&since=${encodeURIComponent(since)}`),
    comment: (n, body) => call('POST', `/issues/${n}/comments`, { body }),
  };
}

// ---- Discord: the controller of buttons under the screen (app hold with DISCORD_BOT_TOKEN / DISCORD_USER_ID) ----
// 5 rows of 5 (Discord's most): moving, the camera, the hands, the menus' controller, and the rest. A press is one live
// command (its button's id: "lab:<command>"); "#…" opens a form instead
export const PANEL = [
  [['⬆️ 前へ', 'walk forward 1', 1], ['⬅️ 左へ', 'walk left 1', 1], ['⬇️ 後ろへ', 'walk back 1', 1], ['➡️ 右へ', 'walk right 1', 1], ['🦘 ジャンプ', 'jump', 1]],
  [['↩️ 左を見る', 'look left 300'], ['↪️ 右を見る', 'look right 300'], ['🔼 上を見る', 'look up 250'], ['🔽 下を見る', 'look down 250'], ['🏃 走る', 'sprint 2', 1]],
  [['⛏️ 壊す', 'mine 1.5', 3], ['⚔️ 殴る', 'attack', 3], ['✋ 使う・置く', 'use', 3], ['🎒 持ち物', 'inventory', 3], ['🔁 次の物', 'slot next', 3]],
  [['Ⓐ 決定', 'pad A'], ['Ⓑ 戻る', 'pad B'], ['▲', 'pad UP'], ['▼', 'pad DOWN'], ['☰ ポーズ', 'pause']],
  [['◀', 'pad LEFT'], ['▶', 'pad RIGHT'], ['💬 チャット', '#chat', 1], ['⌨️ 命令', '#cmd', 1], ['📷 画面', 'screen', 2]],
];
/** the controller's rows for a message (pure); disabled: shown greyed (the session has ended) */
export const panel = (disabled = false) => PANEL.map((r) => row(...r.map(([label, cmd, style = 2]) => button(label, `lab:${cmd}`, style, disabled))));
/** a press's button id → its command, or a form's name ('#chat', '#cmd'); null when it is not the controller's (pure) */
export function panelCommand(customId) {
  const m = /^lab:(.+)$/s.exec(String(customId ?? ''));
  return m ? m[1] : null;
}
/** the forms behind the controller's chat and command buttons (pure) */
export const FORMS = {
  '#chat': modal('lab-form:chat', 'チャット（/ で始めればコマンド）', [{ id: 'text', label: '言うこと', max: 250, placeholder: 'こんにちは / /give @s diamond 3' }]),
  '#cmd': modal('lab-form:cmd', 'live の命令（1 行 1 つ）', [{ id: 'cmds', label: '命令', long: true, max: 4000, placeholder: 'walk forward 2\nlook right 600\nmine 2\nscreen' }]),
};
/** a submitted form → its commands (pure): the chat form → one `chat …`, the command form → its lines; null when it is not ours */
export function formCommands(customId, values) {
  if (customId === 'lab-form:chat') { const t = String(values?.text ?? '').trim(); return t ? [`chat ${t}`] : []; }
  if (customId === 'lab-form:cmd') return splitCommands(values?.cmds ?? '');
  return null;
}
/** a line typed on a phone, as live reads it (pure): a known verb its keyboard capitalized ("Walk forward 2") in lower case */
export function phoneLine(line) {
  const m = /^(\s*)(\S+)([\s\S]*)$/.exec(String(line ?? ''));
  return m && VERBS.has(m[2].toLowerCase()) ? `${m[1]}${m[2].toLowerCase()}${m[3]}` : String(line ?? '');
}
/** the person's DM as live's way in (b: lib/discord.mjs bot): a message → its commands; a press → answered at once (Discord
 *  waits 3 seconds for that) and its command; the chat / command buttons → their form; a form sent → its commands.
 *  post({ cmds, it? }): it = the press or form (its message is the one changed with the screen after) */
export async function discordJobs(b, post) {
  return b.listen(async (type, d) => {
    if (type === 'MESSAGE_CREATE') { const cmds = splitCommands(d.content).map(phoneLine); if (cmds.length) post({ cmds }); return; }
    if (type !== 'INTERACTION_CREATE') return;
    const it = { id: d.id, token: d.token, application_id: d.application_id };
    if (d.type === 3) {
      const cmd = panelCommand(d.data?.custom_id);
      if (cmd === null) return;
      if (FORMS[cmd]) { await b.respond(d, 9, FORMS[cmd]); return; }
      await b.respond(d, 6);
      post({ cmds: [cmd], it });
    } else if (d.type === 5) {
      const cmds = formCommands(d.data?.custom_id, modalValues(d))?.map(phoneLine) ?? null;
      if (cmds === null) return;
      await b.respond(d, 6);
      if (cmds.length) post({ cmds, it });
    }
  });
}

