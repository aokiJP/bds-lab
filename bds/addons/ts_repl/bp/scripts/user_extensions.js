// ===================================================================
//  TS REPL — ユーザー拡張機能
// ===================================================================
//
//  このファイルの **名前は固定** です（scripts/user_extensions.js）。
//  消したり名前を変えたりするとアドオン全体が読み込めなくなります。
//  中身を空にするのは構いません。
//
//  ここに書いたものは、ゲーム内の「拡張機能」一覧にそのまま並びます。
//  読み込みは export を見て判断します。次のどの形でも受け取ります。
//
//    export const extensions = [ { ... }, { ... } ]   ← いちばん普通
//    export default { ... }                           ← 1 つだけのとき
//    export function activate(ctx) { ... }            ← 関数だけでも可
//    export const commands = [ ... ]
//
//  ---- 1 つぶんの形 -------------------------------------------------
//
//  {
//    id:          "hello",            // 必須。英数字と . _ - のみ。他と被らないこと
//    name:        "Hello World",      // 一覧に出る名前
//    publisher:   "you",              // 発行元（省略可）
//    description: "あいさつします",    // 一覧の説明（省略可）
//    default:     true,               // 既定で入れるか（省略時は false）
//
//    // コマンドパレットに並ぶ。押すと run が呼ばれる
//    commands: [
//      { id: "say", title: "Hello: あいさつ", run(ctx) { ctx.say("こんにちは"); } }
//    ],
//
//    activate(ctx)   {},   // 最初に使われたとき 1 回だけ
//    deactivate(ctx) {},   // 切ったとき
//
//    // 状態バーの左寄りに短い文字を出す。毎回描くたびに呼ばれるので軽く。
//    // 文字列を返すと出ます。返さなければ何も出ません。24 字で切られます。
//    statusItem(ctx) { return "\u2764 " + ctx.lines + " 行"; },
//
//    // 対応していない拡張子を、既にある言語に結びつける。
//    // すでに使われている拡張子は取れません（理由が「出力」に出ます）。
//    languages: [
//      { extensions: [".cfgx"], basedOn: "json", name: "My Config" }
//    ]
//  }
//
//  ---- ctx に入っているもの -----------------------------------------
//
//    ctx.say(text)        画面にメッセージを出す
//    ctx.log(text)        「出力」パネルに 1 行足す
//    ctx.file             いま開いているファイル名
//    ctx.language         いまの言語 id（"typescript" / "markdown" / "plaintext" …）
//    ctx.lines            いまの行数
//    ctx.code             いまの中身（文字列）
//    ctx.player           Player（@minecraft/server）
//    ctx.locale           "ja" / "en"
//
//  ---- 約束 ---------------------------------------------------------
//
//  ここで例外が出ても IDE は止まりません。その拡張だけが切られ、
//  理由が「出力」パネルに出ます。
//
//  ゲーム内で書いたファイルを読み込みたいときは、拡張子を `.ext.ts` に
//  して保存し、コマンドパレットの「拡張機能: このファイルを読み込む」を
//  実行してください。書き方はこのファイルとまったく同じです。
//
// ===================================================================

export const extensions = [
  {
    id: "sample.wordy",
    name: "Sample: Line Counter",
    publisher: "tsrepl",
    description: "状態バーに行数を出す、書き方の見本です",
    default: false,
    statusItem(ctx) {
      return "\u2261 " + ctx.lines;
    },
    commands: [
      {
        id: "where",
        title: "Sample: いま開いているファイルを言う",
        run(ctx) {
          ctx.say("\u00a77" + ctx.file + " \u00a78(" + ctx.language + ", " + ctx.lines + " \u884c)");
        }
      }
    ]
  }
];
