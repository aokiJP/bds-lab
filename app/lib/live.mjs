// live: the CI device kept up after the device build (workflow input `hold`, `app hold`), driven from anywhere through the
// comments of one issue of the (private) repository: `lab@<run> <command>` lines in, `lab-reply@<run> #<id>` replies out
// (text, and the screen as a small PNG in an HTML comment). Nothing to commit, nothing to rebuild: a device stuck on a
// screen is looked at and pressed from here in seconds (`node lab.mjs app live "<command>"`).
// Only the comments of the user who started the run are run (LIVE_USER), and only for this run; commands act on the
// device (adb), never on the runner's own shell.
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
].join('\n');
const VERBS = new Set(['screen', 'tap', 'pad', 'swipe', 'key', 'text', 'wait', 'sh', 'logcat', 'input', 'windows', 'fps', 'gpu', 'files', 'relay', 'join', 'bds', 'launch', 'kill', 'options', 'title', 'run', 'ui', 'pull', 'last', 'bdslog', 'answer', 'signin', 'code', 'world', 'seal', 'stop', 'help']);
/** verbs that take minutes (a whole run on the device): `app live` waits longer for them */
export const LONG = new Set(['run', 'ui', 'title', 'seal', 'pull', 'signin']);

/** a comment's commands for this run (pure): "lab@<run> a\nb" → ['a', 'b'], null when it is not one. A line that ends in
 *  "<<" takes the lines after it as they are (a scenario, its "## section" lines too) up to a line "EOF" (or the end):
 *  one command "run <<\n…" */
export function commandsOf(body, run) {
  const m = new RegExp(`^lab@${String(run).replace(/\D/g, '')}\\s+([\\s\\S]+)$`).exec(String(body ?? '').trim());
  if (!m) return null;
  // (up to a line "---": what a server may add under a comment, e.g. a signature, is not a command)
  const raw = m[1].split(/\n---\s*(\n|$)/)[0].split('\n'), cmds = [];
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
export function replyBody(run, id, text, png = null, limit = 60_000) {
  const b64 = png ? png.toString('base64') : '';
  const room = Math.max(1000, limit - b64.length - 200);
  const t = String(text ?? '').replace(/```/g, "'''");
  const fit = t.length > room ? `…（前を省略）\n${t.slice(t.length - room)}` : t;
  return `${replyHead(run, id)}\n\`\`\`\n${fit}\n\`\`\`${b64 ? `\n<!--png:${b64}-->` : ''}`;
}
/** a reply's parts (pure): { id, text, png } for that run, null when the body is not its reply */
export function replyParts(body, run) {
  const m = new RegExp(`^lab-reply@${run} #(\\d+)\\n`).exec(String(body ?? ''));
  if (!m) return null;
  const png = /<!--png:([A-Za-z0-9+/=]+)-->/.exec(body)?.[1];
  const text = body.slice(m[0].length).replace(/<!--png:[^>]*-->/g, '').replace(/^```\n?|\n?```\s*$/g, '').trim();
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
