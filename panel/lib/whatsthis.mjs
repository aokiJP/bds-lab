// whatsthis: 「これは何？」— a few plain words beside each button and field of a tab, for the ❓ at its top right. guide.mjs's
// HELP says what a whole tab is for; this says what ONE button or field does. Pure: no DOM, no fetch, no node:.

/** per tab: [a word of the heading / button / label as the screen shows it, what it is in plain words] */
const TIPS_BY_TAB = {
  overview: [
    ['いまやること', 'ラボでいま手を付けると良いことの一覧です。上から順にやると迷いません。'],
    ['ラボの健康度', 'ラボの調子を点数と A〜E で表したものです。点が低いときは理由も出ます。'],
    ['遊び方カード', 'このラボの使い方を 1 枚にまとめたカードです。人に見せるときに使います。'],
    ['お知らせ', 'ラボに起きた出来事の知らせです。新しいものに印が付きます。'],
    ['何がしたい', 'やりたいことを言葉で選ぶと、それができる画面へ連れて行きます。'],
  ],
  runs: [
    ['詳しく', '落ちた実行の原因と直し方を、やさしい言葉で出します。'],
    ['もう一度', '同じ条件でもう一度実行します。GitHub の Actions の時間を使います。'],
    ['取り消す', '動いている実行を途中で止めます。止めた分は戻せません。'],
    ['比べる', '2 つの実行を並べて、どこが違うかを見ます。'],
  ],
  start: [
    ['すぐ始める', 'よく使う組み合わせを、ひと押しで始めます。'],
    ['始める', '選んだワークフローを、選んだ場所の Actions で動かします。'],
    ['枝（ref）', 'どの版のコードで動かすかです。分からなければ main のままで大丈夫です。'],
    ['新しく作る', 'アイデアを書くと、AI がアドオンを作って確かめます。'],
  ],
  units: [
    ['新しく作る', '空のアドオンを 1 つ作ります。名前と題を決めるだけです。'],
    ['ユニット', 'ラボの中の 1 つのアドオンのことです。試験と一緒に置いてあります。'],
    ['試験', '本物のサーバーとプレイヤーで tests.txt を流して、動くか確かめます。'],
    ['AI で変える', '変えたいことを書くと、AI が直して確かめます。'],
  ],
  releases: [
    ['リンクを写す', '配布のリンクを写します。そのまま人に渡せます。'],
    ['Discord で', '配布のお知らせを Discord に送ります。'],
    ['版の比較', '2 つの版のどこが違うかを見ます。'],
  ],
  schedule: [
    ['この予約を足す', '決めた時刻に、ワークフローが自動で始まるようにします。'],
    ['いつ', 'ワークフローを始める時刻です。ちょうどの時刻（03:00 など）を選びます。'],
    ['曜日', '毎週のとき、何曜日に始めるかです。'],
    ['時間帯の地域', '時刻をどの国の時計で読むかです。'],
    ['許す仕事', '予約から始めてよいワークフローです。'],
  ],
  stats: [
    ['数字で見る', 'グラフと同じ数字を、表で見ます。'],
    ['CSV で取り出す', '数字を表計算ソフトで開ける形で保存します。'],
  ],
  files: [
    ['ファイル', '実行が作ったファイルです。期限が来ると GitHub が消します。'],
    ['Discord に送る', 'ファイルを Discord に送ります。'],
  ],
  discord: [
    ['試しに送る', '知らせが Discord に届くか、1 通だけ試します。'],
    ['連絡先', '知らせを送る先です。'],
  ],
  secrets: [
    ['秘密を登録する', 'パスワードや鍵を、封じてから GitHub に預けます。登録したあとは誰にも見えません。'],
    ['名前', '秘密を呼ぶための名前です。同じ名前で登録し直すと新しくなります。'],
    ['値', '秘密そのものです。この画面の外には出ません。'],
  ],
  live: [
    ['動いている端末', 'いま動いている実行の、命令を打つ画面です。'],
    ['命令（1 行 1 つ）', '端末に送る命令です。1 行に 1 つ書きます。'],
  ],
  hosts: [
    ['フォークで貸す', '自分の Actions の時間を、ラボに貸します。'],
    ['1 か月に貸す分', '1 か月に貸してもよい時間の上限です。'],
  ],
  members: [
    ['お願いを出す', '参加したい人が、ラボに入れてほしいと頼みます。'],
    ['棚卸しを作る', '誰がどこまでできるかを一覧にした報告を作ります。'],
  ],
  setup: [
    ['ラボのリポジトリ', 'ラボが置いてある GitHub の場所です。'],
  ],
  connect: [
    ['トークン', '外のサービスに入るための鍵です。このブラウザで封じてから登録します。'],
  ],
  audit: [
    ['監査ログ', 'パネルで誰が何をしたかの記録です。'],
    ['CSV で取り出す', '記録を表計算ソフトで開ける形で保存します。'],
  ],
  settings: [
    ['読み直す', '画面の中身を、どのくらいの間隔で読み直すかです。'],
    ['デバッグ', '困ったときの手がかりです。「写す」で人に伝えられます。'],
    ['写す', '困りごとの様子を、そのままクリップボードに写します。'],
  ],
};
export const TIPS = Object.freeze(Object.fromEntries(Object.entries(TIPS_BY_TAB).map(([k, v]) => [k, Object.freeze(v.map((p) => Object.freeze([...p])))])));

// (marks, spaces and a trailing … or : are not part of the wording: 「🆕 新しく作る」 and 「新しく作る…」 are the same words)
const plain = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}️‍\s…:：]+/gu, '').toLowerCase();

/** the tips that fit what the screen shows: texts (the words of its buttons, headings and labels) → [{ index, tip }] — one per
 *  text, the first matching tip (the longest wording wins), only for things that are on the screen */
export function tipsFor(tab, texts) {
  const tips = (TIPS[tab] ?? []).map(([key, tip]) => ({ key: plain(key), tip })).filter((t) => t.key).sort((a, b) => b.key.length - a.key.length);
  const out = [];
  (Array.isArray(texts) ? texts : []).forEach((text, index) => {
    const p = plain(text);
    if (!p) return;
    const hit = tips.find((t) => p.includes(t.key));
    if (hit) out.push({ index, tip: hit.tip });
  });
  return out;
}
