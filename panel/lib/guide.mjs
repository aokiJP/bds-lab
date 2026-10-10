// guide: the panel made plain for someone new to it — what each tab is for, the words it uses, what to do next for their
// role, what they want to do found from their own words (「やりたいこと」: Ctrl/⌘+K), why a run failed and how to fix it in
// words, and, for a company, who has access and what they did (an access review). Pure: no DOM, no fetch, no node:.

const TAB_HELP = {
  overview: { title: '概要', what: 'いまの様子をひと目で。やることの一覧（いまやること）、はじめてのガイド、最近の実行と調子がここに出ます。', tips: ['困ったら Ctrl（⌘）+K で「やりたいこと」を入れてください'] },
  runs: { title: '進み具合', what: 'GitHub Actions の実行（ワークフローが動いた 1 回 1 回）の一覧です。落ちたものは「詳しく」で、原因と直し方を言葉で出します。', tips: ['🔎 で名前や枝の言葉で探せます', '動いているものは自動で更新されます'] },
  start: { title: '実行', what: 'ワークフローを始めます。どこの Actions で走らせるか（このラボ・貸し手）を選べます。アイデアから AI がアドオンを作ることもできます。', tips: ['「すぐ始める」のボタンは、よく使う組み合わせです'] },
  units: { title: 'アドオン', what: 'ラボのアドオン（ユニット）の一覧です。新しく作る・人のアドオンを取り込む・ファイルを直す・試験・仕上げ（.mcaddon）を、手元の PC なしで GitHub の Actions（unit.yml）でします。', tips: ['「試験」は本物のサーバーとプレイヤーで tests.txt を流します', '「AI で変える」は、変えたいことを書くだけで AI が直して確かめます'] },
  releases: { title: '配布', what: 'リリース（人に配っている .mcaddon など）の一覧です。大きさとダウンロードの数を見て、リンクを写したり、Discord に知らせたりできます。', tips: ['「リンクを写す」で、そのまま人に渡せます'] },
  schedule: { title: '予約', what: '決めた時刻にワークフローを自動で始めます（何時間ごと・毎日・毎週）。決めたものは .github/bds-lab-schedule.json に入り、毎時の schedule.yml が始めます。', tips: ['時刻は「ちょうど」（03:00 など）。その時の 7 分すぎごろに始まります（GitHub が混むと遅れます）'] },
  stats: { title: '統計', what: '実行の数・通った割合・かかった時間・曜日と時間・貸し手の分を、グラフと表で見ます。ラボの健康度と報告書は「概要」にあります。', tips: ['どのグラフも「数字で見る」で表になります', '期間は 7・30・90 日から選べます'] },
  files: { title: '成果物', what: '実行が作ったファイル（.mcaddon など）です。GitHub で取るか、Discord に送れます。', tips: ['期限切れのものは GitHub が消しています'] },
  discord: { title: 'Discord', what: '実行が終わったときの知らせや、スマホからの操作を Discord につなぎます。', tips: ['まず「試しに送る」で届くか確かめると安心です'] },
  secrets: { title: '秘密', what: 'パスワードや鍵（秘密）を、GitHub の Actions だけが読める形で登録します。値はこのブラウザの中で封じてから送り、誰にも表示されません。', tips: ['同じ名前で登録し直すと新しくなります'] },
  live: { title: '端末', what: '動いている実行の端末を、ボタンや命令で操作します（スマホ向け）。', tips: ['命令が効くのは、その実行を始めた人だけです'] },
  hosts: { title: '貸し借り', what: 'GitHub Actions の時間を貸す人（ラボのフォーク）と、借りる先の一覧です。貸すとずっと貸します。', tips: ['持ち主は「フォークで貸している人」をまとめて管理できます'] },
  members: { title: 'メンバー', what: 'ラボの人（招く・役割を変える・外す）と、役割ごとにパネルでできることの表です。参加のお願いと、アクセスの棚卸しもここです。', tips: ['個人のリポジトリには役割がなく、招くと「書き込み」になります'] },
  setup: { title: '準備', what: 'パネルの土台（Pages・GitHub App・サインインのサービス）を整えます。⚠️ の行のボタンを上から順に押すだけです。', tips: ['App を作ると、みんな「GitHub でサインイン」だけで入れます'] },
  audit: { title: '監査', what: 'パネルで誰が何をしたかの記録です。絞り込み、CSV に書き出しができます。', tips: ['記録はラボの issue に、その人自身のコメントとして残ります'] },
  settings: { title: '設定', what: 'このブラウザの設定（アカウント・読み直す間隔・知らせ）と、うまく動かないときのデバッグです。', tips: ['「デバッグ」の「写す」で、困りごとをそのまま伝えられます'] },
};
export const HELP = Object.freeze(TAB_HELP);

/** the words the panel uses, each in plain words */
export const GLOSSARY = Object.freeze([
  { term: 'GitHub Actions', words: ['actions', 'アクション'], means: 'GitHub のコンピューターで、決めた仕事（試験・ビルド）を動かす仕組み。動いた分の時間はリポジトリの持ち主に付きます（public なら標準のものは無料）。' },
  { term: 'ワークフロー', words: ['workflow', 'yml'], means: 'Actions に何をさせるかを書いたファイル（.github/workflows/ の .yml）。' },
  { term: '実行（run）', words: ['じっこう', 'run', 'ラン', 'ジョブ', 'job'], means: 'ワークフローが 1 回動いたもの。中にジョブ、その中に段（ステップ）があります。' },
  { term: '秘密（Secrets）', words: ['ひみつ', 'secret', 'シークレット', 'パスワード', '鍵'], means: 'Actions だけが読めるパスワードや鍵。登録したら誰にも表示されません。' },
  { term: '変数（Variables）', words: ['へんすう', 'variable', 'ヴァリアブル'], means: 'Actions が読む、秘密ではない設定（例: LAB_HOSTS・LAB_NOTIFY）。' },
  { term: 'フォーク', words: ['fork', 'ふぉーく'], means: 'ラボの写しを自分のアカウントに作ったもの。このラボでは、時間を貸すのに使います。' },
  { term: 'ホスト・貸し手', words: ['かして', 'かす', 'host', '貸し手', 'lender'], means: '自分の Actions の時間をラボに貸すリポジトリと、その持ち主。' },
  { term: 'LAB_HOSTS', words: ['labhosts', '候補'], means: '「空いている貸し手で（auto）」が選ぶ貸し手の一覧（ラボの変数）。' },
  { term: 'GitHub App', words: ['app', 'アプリ'], means: 'ラボ専用の GitHub のアプリ。入れたリポジトリでだけ、決めた権限で動きます。サインインと許可を自動にします。' },
  { term: 'GitHub Pages', words: ['pages', 'ページ'], means: 'このパネルを置いている、GitHub の無料のウェブページ。' },
  { term: 'ポリシー', words: ['やくわり', 'policy', '役割', '決まり'], means: '役割ごとにパネルで許す操作の決まり（.github/bds-lab-panel.json）。GitHub が許さないことは許しません。' },
  { term: '監査ログ', words: ['かんさ', 'audit', '記録'], means: '誰がいつ何をしたかの記録（会社で使うときに）。' },
  { term: 'ユニット', words: ['ゆにっと', 'unit', 'アドオン'], means: 'ラボの中の 1 つのアドオン（bds/addons/<名前>）。試験（tests.txt）と一緒に置いてあります。' },
  { term: 'リリース', words: ['りりーす', 'release', '配布'], means: '人に配るために GitHub に置いた版（.mcaddon などのファイル付き）。期限なしで残ります。' },
  { term: '予約（schedule）', words: ['よやく', 'schedule', 'cron', 'スケジュール'], means: '決めた時刻にワークフローを自動で始める決まり（.github/bds-lab-schedule.json）。' },
  { term: '健康度', words: ['けんこうど', 'health', 'スコア', '点数'], means: 'ラボの調子を 0〜100 点と A〜E で表したもの（準備・実行の成功・秘密の古さ・アクセスなど）。' },
  { term: '成果物（Artifacts）', words: ['せいかぶつ', 'artifact', 'ファイル', 'mcaddon'], means: '実行が作って残したファイル。しばらくすると GitHub が消します。' },
  { term: 'アドオン・BDS', words: ['addon', 'bds', 'マイクラ', 'minecraft'], means: 'Minecraft 統合版の追加の中身と、それを試す公式のサーバー（Bedrock Dedicated Server）。' },
  { term: 'Discord の知らせ', words: ['つうち', 'discord', '通知', 'dm'], means: '実行が終わると、結果と成果物を Discord の DM に送ります（notify）。' },
  { term: '招待', words: ['しょうたい', 'invite', 'invitation', '協力者', 'collaborator'], means: 'リポジトリに人を加えること。相手が受けると入れます。' },
]);

/** what people say they want to do → where in the panel. need: the policy's action the place is for (shown only if allowed) */
export const INTENTS = Object.freeze([
  { id: 'guide', label: 'はじめてのガイドを見る', words: ['はじめて', 'つかいかた', 'はじめて', '初心者', '使い方', 'ガイド', 'チュートリアル', 'ヘルプ', 'わからない'], tab: 'overview', anchor: 'guide' },
  { id: 'make', label: 'アイデアからアドオンを作る（AI）', words: ['つくる', 'つくり', '作る', '作り', 'アドオン', 'アイデア', 'ai', '生成', 'make', '新しい'], tab: 'start', anchor: 'make', need: 'dispatch' },
  { id: 'secrets', label: '秘密（パスワード・鍵）を登録する', words: ['ひみつ', 'かぎ', 'とうろく', '秘密', 'シークレット', 'secret', '鍵', 'トークン', 'パスワード', '登録'], tab: 'secrets', need: 'secrets.put' },
  { id: 'runs', label: '実行の進み具合・結果を見る', words: ['しんちょく', 'けっか', 'しっぱい', '進み', '状況', '結果', 'ログ', 'run', '実行の', '落ちた', '失敗'], tab: 'runs' },
  { id: 'start', label: 'ワークフローを始める', words: ['じっこう', 'はじめ', 'しけん', '始める', '始め', '走らせ', '実行する', '起動', 'dispatch', '試験', 'テスト'], tab: 'start', need: 'dispatch' },
  { id: 'rerun', label: '失敗した実行をやり直す', words: ['やりなおし', 'やりなお', 'やり直', '再実行', 'rerun', 'リトライ', 'もう一度'], tab: 'runs', need: 'dispatch' },
  { id: 'cancel', label: '動いている実行を止める', words: ['とめ', 'ちゅうし', '止め', 'キャンセル', '中止', 'ストップ'], tab: 'runs', need: 'run.cancel' },
  { id: 'units', label: 'アドオンを一覧・取り込む・直す・試験する', words: ['ゆにっと', 'とりこ', 'なおす', 'しあげ', 'ユニット', 'unit', 'アドオン', '取り込', 'インポート', 'import', '直す', '編集', 'mcpack', 'zip', '仕上げ', '一覧', '試験', 'テスト'], tab: 'units' },
  { id: 'releases', label: '配布（リリース）を見る・リンクを渡す', words: ['はいふ', 'りりーす', 'くばる', '配布', 'リリース', 'release', 'ダウンロード数', 'リンク', '公開'], tab: 'releases' },
  { id: 'schedule', label: '決めた時刻に自動で始める（予約）', words: ['よやく', 'じどう', 'まいにち', 'ていき', '予約', '自動', '毎日', '毎晩', '毎週', '毎時', '定期', 'スケジュール', 'schedule', 'cron', '時刻', '時に', '毎朝', '夜中', '深夜'], tab: 'schedule', need: 'dispatch' },
  { id: 'stats', label: '統計・グラフを見る', words: ['とうけい', 'ぐらふ', '統計', 'グラフ', '分析', '成功率', '曜日', 'どれくらい'], tab: 'stats' },
  { id: 'health', label: 'ラボの健康度と報告書（会社向け）', words: ['けんこう', 'ほうこく', '健康', '点数', 'スコア', 'レポート', '報告', 'report', '評価'], tab: 'overview', anchor: 'labhealth' },
  { id: 'bulk', label: '.env から秘密をまとめて登録する', words: ['まとめて', 'いっかつ', '一括', '.env', 'env', 'dotenv', 'たくさん'], tab: 'secrets', anchor: 'bulk', need: 'secrets.put' },
  { id: 'inbox', label: 'お知らせ（🔔）を見る', words: ['おしらせ', 'しんちゃく', 'お知らせ', '通知', 'ベル', '新着', '未読'], tab: 'overview' },
  { id: 'files', label: '成果物（.mcaddon）を取る・送る', words: ['せいかぶつ', '成果物', 'ダウンロード', 'mcaddon', 'ファイル', '配る'], tab: 'files' },
  { id: 'discord', label: 'Discord につなぐ・知らせを受ける', words: ['つうち', 'しらせ', 'discord', 'ディスコード', '通知', '知らせ', 'dm', 'スマホに'], tab: 'discord' },
  { id: 'live', label: 'スマホで端末を操作する', words: ['たんまつ', 'そうさ', '端末', 'スマホ', '操作', '画面', 'ライブ', 'リモート'], tab: 'live' },
  { id: 'lend', label: 'Actions の時間を貸す・借りる', words: ['かす', 'かし', 'かり', 'じかん', '貸す', '貸し', '借り', 'ホスト', 'フォーク', '時間', '分'], tab: 'hosts' },
  { id: 'members', label: 'メンバーを招く・役割を変える', words: ['まねく', 'まねき', 'しょうたい', 'かんりしゃ', '招く', '招き', '招待', 'メンバー', '管理者', '協力者', '人を', '追加'], tab: 'members', need: 'members' },
  { id: 'joins', label: '参加のお願いに答える', words: ['さんか', 'おねがい', '参加', 'お願い', 'リクエスト', '申請'], tab: 'members', need: 'members' },
  { id: 'policy', label: '役割ごとにできることを決める', words: ['やくわり', 'けんげん', 'ポリシー', '役割', '許可', '決まり', '権限'], tab: 'members', anchor: 'policy' },
  { id: 'review', label: 'アクセスの棚卸し（誰が何をできるか）', words: ['たなおろし', '棚卸し', 'アクセス', '見直し', 'レビュー', '一覧', 'コンプライアンス'], tab: 'members', anchor: 'review' },
  { id: 'setup', label: '準備する（App・Pages・サインイン）', words: ['じゅんび', '準備', 'セットアップ', 'app', 'pages', 'サインイン', '初期', '最初'], tab: 'setup' },
  { id: 'audit', label: '誰が何をしたか（監査ログ）', words: ['かんさ', 'きろく', '監査', '記録', '誰が', '履歴'], tab: 'audit', need: 'audit.read' },
  { id: 'debug', label: 'うまく動かない（デバッグ）', words: ['エラー', '動かない', 'バグ', 'デバッグ', 'おかしい', '壊れ'], tab: 'settings', anchor: 'debug' },
  { id: 'accounts', label: 'アカウントを加える・切り替える', words: ['きりかえ', 'アカウント', '切り替え', 'ログイン', '別の'], tab: 'settings' },
  { id: 'update', label: 'パネルを新しい版にする', words: ['こうしん', '更新', '新しい版', '読み直す', 'バージョン'], tab: 'overview' },
]);

// (matching as people type: case, katakana/hiragana and spacing do not matter)
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s・、。,.!?！？「」（）()]/g, '');
/** the places for what was typed, best first (pure) → [{ ...intent, score }]; tabs: the tabs this person sees; may(action) */
export function findIntents(query, { tabs = null, may = () => true, limit = 6 } = {}) {
  const q = norm(query);
  const seen = INTENTS.filter((x) => (!tabs || tabs.includes(x.tab)) && (!x.need || may(x.need)));
  if (!q) return seen.slice(0, limit).map((x) => ({ ...x, score: 0 }));
  return seen.map((x, i) => {
    let score = 0;
    for (const w of [x.label, ...x.words].map(norm)) { if (q.includes(w)) score += 3; else if (q.length >= 2 && w.includes(q)) score += 2; }
    return { ...x, score, i };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map(({ i, ...x }) => x);
}
/** the glossary's terms for what was typed (pure) */
export const findTerms = (query, limit = 3) => { const q = norm(query); return q.length < 2 ? [] : GLOSSARY.filter((g) => [g.term, ...g.words].map(norm).some((w) => w.includes(q) || q.includes(w))).slice(0, limit); };

/** the next steps for this person's role (pure) → { steps: [{ id, title, why, done, tab }], done, total, next }. role: owner |
 *  admin | writer | lender | stranger; facts: what the panel knows (pages, app, auth, discord, ran, lenders, lending, members) */
export function guideSteps(role, f = {}) {
  const S = (id, title, why, done, tab) => ({ id, title, why, done: Boolean(done), tab });
  const lab = [
    S('signin', 'サインインする', 'あなたが誰かを GitHub が決めます。できることは GitHub の権限のとおりです。', true, 'settings'),
    S('pages', 'パネルを公開する（Pages）', 'このパネルをいつでも開けるように、GitHub Pages に置きます。', f.pages, 'setup'),
    S('app', 'GitHub App を作る', 'みんなが「GitHub でサインイン」だけで入れるようにし、ワークフローが個人のトークンなしで動くようにします。', f.app, 'setup'),
    S('auth', 'サインインのサービスを置く', '「GitHub でサインイン」を仕上げる小さなサービスです（Cloudflare なら数クリック）。', f.auth, 'setup'),
    S('discord', 'Discord につなぐ', '実行が終わったら、結果と .mcaddon がスマホに届くようにします。', f.discord, 'discord'),
    S('run', '最初の実行を始める', '「実行」の「すぐ始める」か「アイデアからアドオンを作る」で、1 回動かしてみます。', f.ran, 'start'),
    S('lenders', '貸し手を見つける', 'ほかの人の Actions の時間を借りると、たくさん並べて試せます（管理者はいつも貸します）。', f.lenders, 'hosts'),
  ];
  const steps = role === 'owner' || role === 'admin' ? (role === 'admin' ? [lab[0], S('lend', '時間を貸す（管理者の決まり）', '自分のフォークで、ずっと貸します。', f.lending, 'overview'), ...lab.slice(4, 6)] : lab)
    : role === 'writer' ? [lab[0], lab[5], S('watch', '進み具合を見る', '「進み具合」で、落ちたら原因と直し方を言葉で見られます。', f.watched, 'runs'), lab[4]]
      : [S('fork', 'ラボをフォークする', 'ラボの写しを自分のアカウントに作ります（public・無料）。', f.fork, 'overview'), S('lend', 'フォークで貸す', 'ボタン 1 つで、ずっと貸す設定にします。', f.lending, 'overview'),
        ...(role === 'stranger' ? [S('join', '参加をお願いする（したいなら）', '持ち主に、ラボへの参加をお願いできます。', f.asked, 'overview')] : [])];
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length, next: steps.find((x) => !x.done) ?? null };
}

/** why a run failed, in words, with what to do (pure) → [{ title, fix, tab, prefill }]. annotations: the failed jobs'
 *  ({ message, title }); secrets: the lab's secrets' names (null: unknown); known: the secret names the panel knows */
export function diagnose({ run = {}, jobs = [], annotations = [], secrets = null, known = [] } = {}) {
  const text = [...annotations.map((a) => `${a.title ?? ''} ${a.message ?? ''}`), ...jobs.flatMap((j) => (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => s.name))].join('\n');
  const out = [], add = (title, fix, tab = null, prefill = null) => { if (!out.some((x) => x.title === title)) out.push({ title, fix, tab, prefill }); };
  if (run.conclusion === 'cancelled') add('止められました', '誰かが「止める」を押したか、同じワークフローの次の実行に場所をゆずりました。やり直せば動きます。', 'runs');
  if (run.conclusion === 'startup_failure') add('ワークフローのファイルが読めません', '最近変えた .github/workflows/ の YAML の書き方を確かめてください（字下げ・引用符）。', 'runs');
  const missing = known.filter((n) => new RegExp(`\\b${n}\\b`).test(text) && (!secrets || !secrets.includes(n)));
  for (const n of missing) add(`秘密 ${n} がありません`, `「秘密」で ${n} を登録すると動きます。`, 'secrets', n);
  if (run.conclusion === 'timed_out' || jobs.some((j) => j.conclusion === 'timed_out') || /timed? ?out|maximum execution time|timeout-minutes/i.test(text)) add('時間切れです', '仕事が決めた時間を超えました。仕事を分けるか、貸し手の Actions で走らせてください。', 'start');
  if (/rate limit|secondary rate/i.test(text)) add('GitHub の回数の上限です', 'しばらく（1 時間ほど）待ってから「やり直す」を押してください。', 'runs');
  if (/Resource not accessible|HTTP 403|permission denied|insufficient permission|must have admin/i.test(text)) add('権限が足りません', 'ワークフローか App の権限が足りません。「準備」の「App の権限」と、ワークフローの permissions を確かめてください。', 'setup');
  if (/No space left on device/i.test(text)) add('ランナーのディスクが足りません', '大きなファイルを作りすぎています。キャッシュや成果物を小さくしてください。', null);
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network|npm ERR! network|503|502 Bad Gateway/i.test(text)) add('ネットワークの一時的な失敗です', 'GitHub か配布元の一時的な不調です。「やり直す」で直ることが多いです。', 'runs');
  if (/bedrock-server|minecraft\.net|bds.*(download|404)|zip.*404/i.test(text)) add('Minecraft のサーバー（BDS）を取れません', 'Mojang の配布が変わったかもしれません。「実行」で upkeep（新しい Minecraft に合わせる）を走らせてください。', 'start');
  const tests = [...new Set([...text.matchAll(/tests\/([\w-]+\.mjs)/g)].map((m) => m[1]))];
  if (tests.length || /\bFAIL\b|✘|AssertionError|expected .* got/i.test(text)) add(`試験が落ちました${tests.length ? `（${tests.join('・')}）` : ''}`, '注釈の行が落ちた理由です。直したら「やり直す」。手元なら node lab.mjs panel check か auto gate で同じ試験を走らせられます。', 'runs');
  if (!out.length && run.conclusion === 'failure') add('落ちた理由は注釈にありません', '「GitHub」でログを開き、赤い段を見てください。わからなければ「設定 → デバッグ」の「写す」で伝えてください。', 'settings');
  return out;
}

/** who has access, and what to look at (pure) → { rows: [{ login, kind, role, last, days, flags }], flagged }.
 *  members: [{ login, permission }]; invitations: [{ login, permission, at }]; runs: the lab's newest (triggering_actor);
 *  lending: the administrators' logins that lend always; adminsLend: the policy says they must */
export function accessReview({ members = [], invitations = [], runs = [], owner = '', lending = [], adminsLend = false, now = Date.now(), idleDays = 90, inviteDays = 7 } = {}) {
  const last = new Map();
  for (const r of runs) { const who = String(r.triggering_actor?.login ?? r.actor?.login ?? '').toLowerCase(), at = Date.parse(r.created_at); if (who && Number.isFinite(at) && at > (last.get(who) ?? 0)) last.set(who, at); }
  const days = (t) => (t ? Math.floor((now - t) / 86_400_000) : null), isLending = new Set(lending.map((x) => String(x).toLowerCase()));
  const rows = members.map((m) => {
    const l = String(m.login).toLowerCase(), t = last.get(l) ?? null, d = days(t), flags = [], isOwner = l === String(owner).toLowerCase();
    if (!isOwner && (d === null || d >= idleDays)) flags.push(d === null ? '実行の記録が見えない' : `${d} 日動きなし`);
    if (!isOwner && m.permission === 'admin') { flags.push('管理者（全部できる）'); if (adminsLend && !isLending.has(l)) flags.push('管理者なのに貸していない'); }
    return { login: m.login, kind: isOwner ? '持ち主' : 'メンバー', role: m.permission, last: t ? new Date(t).toISOString().slice(0, 10) : null, days: d, flags };
  });
  for (const i of invitations) { const d = days(Date.parse(i.at)); rows.push({ login: i.login, kind: '招待中', role: i.permission, last: null, days: d, flags: d !== null && d >= inviteDays ? [`招待が ${d} 日そのまま`] : [] }); }
  return { rows, flagged: rows.filter((r) => r.flags.some((f) => f !== '管理者（全部できる）')).length };
}
/** the review as CSV for a spreadsheet (pure; BOM for Excel) */
export function accessCsv(rows) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [['ログイン', '種類', '役割', '最後の実行', '日数', '注意'], ...rows.map((r) => [r.login, r.kind, r.role, r.last ?? '', r.days ?? '', r.flags.join(' / ')])].map((r) => r.map(q).join(',')).join('\n') + '\n';
}
