# 道具（入っているアドオン・調べる・試す）

[README](../../README.md) から分けた詳細です。全体の地図は [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 入っているアドオンと道具

| 種類 | 場所 | 中身 |
|---|---|---|
| **便利系（全部の BDS に既定で入る）** | `bds/addons/ts_repl` | **TS REPL v6.11.0**（ゲームの中で TypeScript を書いてその場で動かす。`node lab.mjs ts` で外からも：下の「動いている世界でそのまま作る」）。`bp/` `rp/` は配布物そのもの（上流のソースは重複するので持たない。TASK.md） |
| **便利系（道具）** | `sandbox-be/` | **Script API のサンドボックス**（実機で測った仮想世界。Minecraft を起動しない）。`sim`・`c2s --check` が使う |
| **便利系（道具）** | `bedrock-binary/` | **BDS のバイナリから、文書に無い定義を取り出す**（パケット ID・enum・文書に無いコマンド・WSS イベント）。`node lab.mjs bb` が使う |
| 便利系（道具） | `cmdscript-be/`（置けば使える） | **cmd2script**：バニラのコマンド → Script API のコード（`c2s`） |
| 見本 | `bds/addons/jsonui_demo` | app ラボ（本物のアプリで JSON UI）の見本 |
| 見本 | `end/plugins` `ll/mods` | Endstone 19・LeviLamina 13 の見本（`help ideas`） |
| **訓練・検証用** | `training/` | PvP ボット 4 つ・スペクテイターの入力記録・RTA のスクリプト。テスト・点検・自動操縦・配布 zip の対象外（`training/README.md`） |

便利系のアドオンは `common/data/samples.json` の `utility` に名前を書いたものです。ラボが立てる**遊ぶためのサーバー**（`up`・`live`・`serve`。bds / end / ll の 3 ラボとも）には毎回自動で入り、**試験のサーバー**（`go`・`run`・テスト）には入りません（試験に関係ないアドオンが混ざると結果が変わるため。`LAB_UTILITIES=all` で試験にも、`off` でどこにも入れない）。

**サーバーの設定は自動で直します**：BDS の `permissions.json` は `@minecraft/common` と `@minecraft/server-net` を既定で許していないため、それを使うアドオン（TS REPL など）は読み込まれません。ラボは起動のたびに、入れたパックが求めるモジュールをそのサーバーで許可し、beta のモジュールを使うパックがあればワールドの「ベータ API」実験を入れます。

### 自分の BDS に入れる（`deploy`）

```sh
node lab.mjs deploy ~/bedrock-server            # 便利系アドオンを入れて、設定も合わせる（サーバーは止めてから）
node lab.mjs deploy ~/bedrock-server my_addon   # 自分のユニットも一緒に
node lab.mjs deploy ~/bedrock-server --dry      # 何を変えるかだけ見る
node lab.mjs deploy ~/bedrock-server --undo     # 直前の deploy を元に戻す
```

ワールドのパック（`worlds/<ワールド>/behavior_packs` と `world_behavior_packs.json` など。同じ UUID は入れ替え、二重にしない）・`permissions.json` のモジュール許可・`level.dat` のベータ API（ほかの実験やデータはそのまま）を書き換え、変える前のものを `<BDS>/.bdslab-backup/` に全部残します。

### コマンドで言えることはコードに（`c2s` = cmd2script）

```sh
node lab.mjs c2s "give @s diamond 3" "effect @a speed 10 1"   # 同じことをする Script API のコード（src/main.ts に貼る）
node lab.mjs c2s --file bp/functions/start.mcfunction --check  # サンドボックスでコマンドとコードを両方動かし、世界が同じになるか比べる
```

AI もトークンを使わずにコードの下書きが得られます。近似しかできない行は `[approximate: 理由]` と出ます。cmd2script（[cmdscript-be](https://github.com/Au12jp/cmdscript-be)）のフォルダを `bds-lab/cmdscript-be` に置くか、`SANDBOX_BE_CMDSCRIPT=<その src/index.js>` で使えます（無ければ置き方を 1 行で言います）。

## パック JSON の検査（Mojang の bedrock-schemas、バニラで較正）

ビルドのたびに `bp/` `rp/` のすべての JSON を `@minecraft/bedrock-schemas` で調べます（`common/schema.mjs`。ラボのキャッシュに 1 回だけ入れる）。
スキーマそのものはバニラでも誤検出が出るので、バニラ 7,000 余ファイルで較正してあります（`common/data/schema-calibration.json`）。

- **E（ビルドが止まる）**：型・値・必須キーの誤りのうち、バニラがその場所で正しく通っているもの。実機の BDS で「定義ごと読み込まれない」と確かめた範囲の誤り（ブロックの明るさ 0〜15、スタック数 1〜64、1.20 以降のレシピの `unlock`）
- **W**：知らないキー（ゲームは黙って無視する。近いキーを「did you mean」で）・範囲・パターン、バニラが使わない場所の型
- アイテムのコンポーネントは、スキーマが中身を持たないので forms（`doc` と同じ資料）から組み立てて調べます
- `LAB_SCHEMA=off` で止める。Minecraft の更新後の較正し直し：`node common/schema.mjs calibrate <bedrock-samples> <schemas>`

## 動いている世界でそのまま作る（`ts`：TS REPL × sandbox-be、再起動も /reload も無し）

`node lab.mjs up` で立てたサーバーには TS REPL が入っています。`ts` はその TS REPL を外から動かし、**書いたコードをその場で世界に流します**（ゲーム内蔵の本物の TypeScript で型を調べてから。再起動も `/reload` も `/reload all` も要りません）。

```sh
node lab.mjs ts 'world.getAllPlayers().map((p) => p.name)'   # いまの世界で実行して答えを見る
node lab.mjs ts ts/examples/block-log.ts                       # ファイルを流す（もう一度流すと、前の購読だけ外して入れ替え）
node lab.mjs ts hot ts/examples/kills.ts                       # 保存するたびに自動で入れ替え（エディタとゲームを並べて）
node lab.mjs ts join                                           # 自分の Minecraft で入る方法（アドレスとポート）
```

| やりたいこと | コマンド |
|---|---|
| API の動きをすぐ確かめる（テストを書く前に） | `ts "<コード>"`（答えは `= …`、型エラーは `E 行:列 TS番号`） |
| 書きかけの機能を世界で動かし続け、直すたびに入れ替える | `ts <ファイル>` / `ts hot <ファイル>`（ファイルごとに入れ替え。`ts stop` で外す） |
| **作者が自分で入って遊んでみる** | `ts join` のアドレスで参加（全員オペレーター。入った人には TS REPL の権限とコンソールのアイテムが自動で渡る）。人が入っている間はサーバーが止まりません |
| 作者がどう遊んだか・何が起きたかを見る | `ts watch`（参加・チャット・壊した/置いた/触ったブロック・使ったアイテム・攻撃・死亡が 1 行ずつ） |
| ワークスペース（`ts/`）とゲーム内エディタを行き来して直す | `ts sync`（ここで保存 → 世界へ、ゲームで直す → ファイルへ。両方で変わったら `.local.ts` に退避） |
| 世界に常駐させる（再起動しても残る） | `ts save <ファイル>`（先頭に `// @on playerBreakBlock` / `// @every 20` / `// @join`） |
| 保存されたスクリプトをまとめて出し入れ | `ts pull` / `ts push` / `ts list` / `ts rm <名前>` |
| 世界とプレイヤーの様子を 2 行で | `ts state`（tick・プレイヤーの位置とタグ・保存されたスクリプト） |
| 型だけ調べる | `ts check <ファイル>` |
| サーバー無しで先に試す | `ts try "<コード>"`（sandbox-be で約 1 秒。同じ名前 `player` `say` などが使える） |
| 管理の作業（全員を回復、場所の準備など） | `ts ts/examples/heal.ts` のように 1 回流すだけ（コマンドブロック不要） |
| うまくいったものを正式なアドオンにする | `ts promote <ファイル> <ユニット名>` → `bds/addons/<名前>/src/main.ts` ができ、tests.txt を書いて `go` |

見本は `ts/examples/`（hello・heal・block-log・kills・clock・welcome）。カスタムコマンドやカスタムコンポーネント（起動時に登録するもの）と、そのアドオン自身の動的プロパティは、アドオン側（`do` が /reload）で扱います。仕組み：BDS のコンソールから TS REPL の AI ブリッジに送り（コンソールは持ち主として信頼）、答えをコンソールの行で受け取ります。TS REPL への変更は `bds/addons/ts_repl/lab/patch.py`（何度当てても同じ）。

## 文書に無いことを BDS 本体から読む（`bb` = bedrock-binary）

ラボが持っている BDS の実行ファイルを bedrock-binary で読み（約 5 秒、ダウンロード無し）、版ごとに `<ラボ>/.lab/bb/` に残します。

```sh
node lab.mjs bb                    # まとめ：パケット ID・enum・コマンド（文書に無いもの）・WSS・スクリプトのモジュール、前の版からの変化
node lab.mjs bb packets text       # パケット ID（9 (0x9) Text …）。番号でも引ける：bb packets 0x12c
node lab.mjs bb enum ActorDamageCause   # enum の値と番号
node lab.mjs bb commands           # 文書に無いコマンドを、この BDS で 1 回ずつ試して「動く／引数が要る／この BDS には無い」に分ける
node lab.mjs bb diff               # 2 つの版の差（増えた・消えた・番号がずれたパケットや enum）
```

- パケット ID は、各パケットクラスの `getId()` の機械語（`mov eax, 9; ret`）から読みます。`MinecraftPacketIds` の値の並びは ID ではありません（削除された番号は抜け、200〜299 は予約、新しいパケットほど順番が合わない）。1.26.52.3 の 231 個は、Mojang のプロトコル文書に載っている 209 個とすべて一致し、残り 22 個も PrismarineJS の表と一致しました。`proto` が Mojang の文書を取ってあれば、`bb` はそれとも照らし合わせます。
- `doc /querytarget` のように文書に無いコマンドを引くと、バイナリにある説明と、この BDS で試した結果を出します。sandbox-be もそれらを「知らないコマンド」ではなく「未再現」と言います。
- Minecraft が更新されると、`upkeep` が「新しいバイナリで何が変わったか」を 1 行で出します（パケットの番号がずれると、プロトコルのクライアントが黙って壊れるため）。
- `bb site` で検索できるページ、`bb apk` で Android クライアント（`app apk fetch` で取った APK）も読めます。Windows のラボでは、同じ版の Linux 版を 1 回だけ取って読みます（読み終わったら消します）。
- bedrock-binary への直し（2.2.1・2.3.0）：パケット ID を `getId()` から読むようにした（前は値の並びの何番目かで、134 番から後ろがまちがっていた）。名前辞書が、同じビルドで cereal から確定している型名を別の enum にも付けて、同じ名前の enum が 2 つできていた（1.26.52.3 で 12 組。差分や名前での検索が片方を黙って捨てていた）のを直しました。差分では「名前だけが変わった enum」を増減と分けます。

## サーバー無しで 1 秒の下見（`sim`）

```sh
node lab.mjs sim                 # いまのアドオンの tests.txt を sandbox-be で（1 節 0.2〜1 秒）
node lab.mjs watch --sim         # 保存するたびに sim
```

`@A join` `@A cmd` `@A chat` `@A jump` `@A form <番号|ボタンの文字>|close` `@A select` `@A use` `@A useon` `@A place` `@A dig` `@A eat` `scriptevent` コンソールのコマンド `wait` `until` を、本物と同じ形の出力（`@A <チャット>`・`@A form action: title("..") button("..")`・`E <エラー>`）にして期待値と比べます。パックのアイテム・ブロック・エンティティ・`.mcfunction` も読みます。`js <式>` の行も動きます（同じ道具 `p` `inv` `mob` など）。サンドボックスにできない行（`restart`・`@A attack/walk`・模擬プレイヤーを使う `js` など）の節は飛ばし、ベータ版や新しすぎる版のモジュールで落ちた節は `?`（はっきりしない）にします。節はそれぞれ何も無いところから始まります（`go` は 1 つのサーバーで順に回すので、前の節で付けたタグや渡したアイテムに頼る節は、自分でも付けると両方で同じ結果になります）。**最後に決めるのは本物のサーバーの `go` です。**

## 配布ワールド・アドオンを持ってくる（`colony` = クラフターズコロニー）

```sh
node lab.mjs colony search 謎解き           # 探す（新しい順。--sort dl|rating|weekly|monthly|all、--cat <番号|名前>）
node lab.mjs colony show 263966             # 記事: 作者・カテゴリ・情報の表・ダウンロードのボタン
node lab.mjs colony get 263966              # 取る（サイトのボタン、または Dropbox・Google Drive・MediaFire）→ CRC で確かめて中身を言う
node lab.mjs colony import 263966 "直したいこと"   # アドオン（ワールドなら同梱のビヘイビアパック）をユニットに → go
node lab.mjs colony packs 263966 --sim      # 同梱パックをサンドボックスで動かす（古い @minecraft/server は有る版に読み替えて、そう言う）
node lab.mjs colony install 263966          # 自分の Minecraft のワールド一覧へ（Windows は GDK 版の場所を先に）
node lab.mjs colony voxel 263966            # スポーン周りの地形をサンドボックスのコース（course.json）に
```

読み取りだけで、行儀よく（2.5〜5 秒に 1 回・1 時間に 80 回まで、実行をまたいで数える。ページは 1 時間控える）。いいね・閲覧数・コメント・投稿には触りません。他人の zip を展開するので、外へ出る名前（`../`）が 1 つでもあれば何も書かずに止め、古い日本語の zip の Shift_JIS の名前は日本語として読みます。Java 版のワールドは `colony convert <file> --chunker <chunker-cli.jar>`（Chunker、java が要る）、一段深い zip は `colony repack <file>`。ワールドの地形は LevelDB を Mojang の書き方のまま読みます（BDS 1.26.52.3 が書いたテーブルとログで確かめた）。

## AI のトークンを減らす仕組み（実測）

- **AI が使う道具を絞る**：`.claude/settings.json` で、このフォルダの Claude Code が使わない道具（サブエージェント・Web・MCP など）を外しました。道具の説明は毎ターン送り直されるので、1 ターンの土台が **33,065 → 6,146 トークン**。隠しテストで合否を決めるベンチ（`node bds/bench/bench.mjs run <課題>`）で、この環境の同じ AI が **ショップ 281,283 → 76,457**・**投票 148,475 → 63,810**（11 → 5 手）・**スライム 182,642 → 83,750** トークンで合格しました。ほかの道具が要るときは `.claude/settings.json` を消してください。
- **ユニットのフォルダでも `node lab.mjs` が動く**：AI がユニットのフォルダに `cd` したあとに `node lab.mjs go` が見つからず 1 ターン失う、が記録で一番多い無駄でした。各ユニットに中継の `lab.mjs` を置きます（パックには入りません）。
- **フォームの答え方のつまずきを消す**：ドロップダウンを番号ではなく選択肢の文字（`@A form ["緑"]`）で答えても通るようにし、答えられないときの理由は `E` 行として `go` にも出します（以前は `run` にしか出ず、`go` は「〜が出ない」としか言わないので何ターンも迷っていました）。
- **何も確かめないテストで「完成」にしない**：`until` だけで期待値の無い tests.txt が「test 0/0」で通り、`go` が DONE と言ってしまい、AI が何手も迷っていました。`until` も 1 つの確認として数え（PASS n/m）、確認が 1 つも無い tests.txt は失敗にします。
- **Claude CLI 経由の小さな質問**（自動操縦の選択・レビュー・教訓）は Claude Code の前置きを外して送ります（**32,488 → 1,339 トークン**）。`make --via claude` も道具を 6 つに絞りました（1 ターン **36,488 → 9,832**）。
