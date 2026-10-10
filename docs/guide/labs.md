# 3 つのラボ・本物のアプリ・環境・その他

[README](../../README.md) から分けた詳細です。全体の地図は [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 3 つのラボ

| ラボ | 作るもの | サーバー | 成果物 |
|---|---|---|---|
| `bds/` | アドオン（BP/RP + Script API、TypeScript） | 素の BDS | `.mcaddon` |
| `end/` | Endstone プラグイン（Python / C++） | Endstone | `.whl` |
| `ll/` | LeviLamina mod（TypeScript / C++） | LeviLamina（Linux・macOS は Wine） | `.zip` |
| `app/` | 上のアドオンを本物のアプリで確かめる（JSON UI の画面） | BDS + Android エミュレータ | スクショ・ログ |

`node lab.mjs end ...` / `node lab.mjs ll ...` で切り替えます（最後に使ったラボは記憶されます）。どのラボでも `go` が使えます。

ll を Linux で動かすときの注意：Ubuntu 24.04 などに入っている Wine 9 では、プレイヤーが入るとサーバーの tick がほぼ止まります（5 秒で 2 tick）。そのため ll は、手元の Wine が 10 未満なら持ち運べる Wine 10.15 を `ll/.lab` に自動で取ってきて使います（`LAB_WINE=<wine>` で指定も可）。GitHub のダウンロードが塞がれたネットワークでは `LAB_GITHUB_MIRROR=https://ghfast.top` のようなミラーを指定します。IPv6 の無いカーネル上の Wine では NetherNet 接続だけは使えません（RakNet の本物のクライアントは使えます）。

## 本物のアプリで JSON UI を確かめる（app）

BDS は JSON UI を読まないので、`bds` ラボでは静的な検査までしかできません。`app/` は **Google Play の APK を Android エミュレータで起動し、ラボの BDS に直接参加させて、アプリが描いた画面をスクリーンショットに撮り、ログと一緒に残します**。

```sh
node lab.mjs app                        # いまの状態と、次にやること（はじめてなら node lab.mjs app setup）
node lab.mjs app run -a jsonui_demo     # APK → エミュレータ → BDS → 参加 → 撮影 → app/runs/<日時>-jsonui_demo/
```

手順はアドオンごとの `app.txt` に 1 行ずつ書きます（`launch` `join` `until joined` `do scriptevent …` `shot …`）。GitHub では `.github/workflows/app.yml` を手動で実行すると、スクショとログが成果物になります。bds-lab だけで完結します（APK の取得・トークン作り・エミュレータの用意まで）。はじめての人向けの手順は [app/README.md](../../app/README.md)。

- `node lab.mjs login google`：先に **メールアドレス**（形を確かめ、間違いはその場で聞き直し）、アドレスがあるときだけ **パスワード**（表示なし）を聞き、両方を Google のログイン画面に自動で入れます。アドレスを Enter だけにすると、ブラウザで自分で入力します（パスワードだけでは入れられないので聞きません）。
- `node lab.mjs app apk fetch`：apkeep が何も保存せずに終わったら（`Downloading …` だけで終了コード 0）、利用規約への同意を付けて 1 回やり直し、それでも駄目なら考えられる原因（そのアカウントで Minecraft を買っていない・トークンが別のアカウント・端末プロファイル）と、出力の全文（`app/.lab/apk/apkeep.log`）を示します。
- `node lab.mjs app secrets`：`--repo bds-lab` のように持ち主を省くと、ログイン中の GitHub アカウントを補います。git のフォルダでなければ `<アカウント>/<フォルダ名>` を探します。

## BDS ではできないことの見本（end / ll）

Script API では届かないことを、Endstone（Python）と LeviLamina（TypeScript）で実際に作った見本です。どれも本物のサーバーと本物のクライアントでテストと品質チェックに通っています。AI は `node lab.mjs end help ideas` / `node lab.mjs ll help ideas` で一覧を見て、近いものを読んでから書きます。

| できること | end（`end/plugins/`） | ll（`ll/mods/`） |
|---|---|---|
| サーバーが HTTP で答える Web API（トークン付き POST） | webapi | — |
| プレイヤーごとのボスバー（カウントダウン） | bossbar | bossbar |
| トースト通知（画面上部のカード） | toast | toast |
| プレイヤーごとに違うサイドバー（自分の座標・ping） | sidebar | sidebar |
| IP・ping・端末・言語・クライアント版の取得 | whois | whois |
| 別サーバーへの転送（ロビー） | hub | hub |
| サーバー一覧の表示文（MOTD）をその場で書き換え | motd | motd |
| SQLite の統計とランキング（再起動後も残る） | sqlstats | sqlstats |
| 立入禁止区域（移動そのものをキャンセル） | guard | — |
| 生パケットを見て捨てる（チャット連投対策） | antispam | — |
| スキンを PNG で保存 | skinpng | — |
| 地図にドット絵を描く（自分の顔も） | pixelmap | — |
| PyPI のライブラリで QR コードを地図に | qrmap | — |
| 飛行と歩く速さをプレイヤーごとに | abilities | — |
| プレイヤーごとのゲーム言語で表示（1 回の告知が各自の言語に） | i18n | i18n |
| 期限付き BAN（理由と残り時間を接続画面に出してログインを拒否） | tempban | tempban |
| 地形を上から見た PNG ファイルと地図アイテム | worldpng | — |
| ブラウザで見るライブマップ（地形とプレイヤーの位置が自動で更新） | livemap | — |
| バニラコマンドも含めて打たれたコマンドを検知・取消・書き換え（/tell も封じるミュート、別名、記録） | cmdguard | cmdguard |
| アイテムの NBT を読み書き（壊れない道具） | — | unbreakable |
| チャットを日付ごとのファイルに記録 | — | chatlog |
| mod 間で共有する経済（送金・履歴） | — | money |

テストには `serverping`（クライアントのサーバー一覧と同じ問い合わせ）も使えます。LeviLamina の HttpServer は Wine 上ではポートを開いた直後に例外で止まるため、Web API は Endstone の見本だけにしています。

## 動かす環境

- Node.js 22 以上（無ければ `./lab.sh` / `lab.cmd` が自動で取ってきます）。Linux か Windows（Mac は Docker 系のアプリ 1 つ）。
- 初回だけ BDS・本物のクライアントの部品・TypeScript などを自動で取ってきます。ネットワークが制限された環境では `node lab.mjs doctor` が、足りないものと回避方法（`LAB_BDS_ZIP=<zip>` など）を 1 行ずつ示します。
- 全体の確認：`node lab.mjs doctor && node lab.mjs selftest all`
- 試験の全体（lint・27 本のゲート・CI・実機）は [ARCHITECTURE.md の「品質ゲート」](../ARCHITECTURE.md#品質ゲート)。一括：`node lab.mjs auto gate`。

## ローカルワールドの方式で試す（nethernet-connect）

- `LAB_TRANSPORT=lan node lab.mjs test`：ラボの BDS を「LANプレイヤーに表示」状態で立て、本物のクライアントがローカルワールドと同じ方式（UDP 7551 のLAN検出とシグナリング）で参加します。
- 自分のネットワークにある本物のワールド・サーバーでも試せます。`node lab.mjs lan list` で一覧（同じLANと自分の Tailscale の端末だけ）、`node lab.mjs lan run tests.txt --world "<ワールド名>"` で本物のクライアントを参加させて、クライアント側に見えることを確かめます。ワールドには既定で観戦モード（何も変えない）で入り、このマシンのワールド・BDS は `--snapshot` で取っておいて `lan restore` で元に戻せます。サインインは `lan account add <名前>` で一度だけ。詳しくは `node lab.mjs help lan`。

## その他

- 新しい版への更新：`node lab.mjs update <新しい bds-lab.zip>`。フォルダを消さずに上書きし、`.env` / `.env.local`（鍵・パスワード）・キャッシュ・自分のアドオン／プラグイン／mod はそのまま残します。前のリリースにあって新しいリリースに無いファイルは、手を入れていなければ消します（`common/data/shipped.json` で照らし合わせる。手を入れたものは残す）。
- Mac で `process.cwd failed ... uv_cwd` と出るとき：ターミナルが「消えたフォルダ」の中にいます（フォルダを置き換えた直後など）。`cd ~` の後に bds-lab のフォルダへ `cd` し直してください。直らないときは、ダウンロード・デスクトップ・書類フォルダへのアクセスがターミナルに許可されていません。bds-lab をホーム直下（`~/bds-lab`）へ移すか、システム設定 → プライバシーとセキュリティ →「ファイルとフォルダ」でターミナルを許可してください。

- 最新版への追従：`.github/workflows/latest.yml` が 6 時間ごとに、新しい Minecraft（BDS）・Endstone・LeviLamina が出ていないか調べ、出ていれば全アドオン・プラグイン・mod をその版で試験してパックします。Endstone や LeviLamina がまだ最新の BDS に対応していなければ「対応待ち」として、対応するまで毎回確かめ続けます。結果はバージョンとファイルが変わるまで覚えておくので、同じ確認を繰り返しません。動かないものがあれば、ラボごとに 1 つの issue にまとめて知らせ、全部通れば閉じます（手元では `node common/latest.mjs probe`）。壊れたものは続けて `maintain --pr` が直し、プルリクエストにします。

- GitHub：`node lab.mjs github`（private リポジトリ）→ `ship`（アドオンごとの枝と Release）→ `publish`（アドオンだけ公開）。CI（`.github/workflows/verify.yml`）が push のたびに、アドオンやラボの本体が変わっていれば全アドオンを本物の BDS で試験します（パネルや文書だけの変更・同じ中身では本物のサーバーを動かしません。手で始めるとすべて）。
- 摩擦の分析：`node bds/bench/bench.mjs friction` が AI の作業記録（Claude Code のセッション、`make` の記録、なければラボ自身のコマンド記録）を読み、失敗した `go`、読まなくてよいファイル、調べもの、シェルでの編集、許可待ちで止まったコマンドなどを、かかったトークン順に並べます。AGENTS.md やエラーメッセージを直すときの材料と、直したあとの確認に使います。
  - 例：Endstone の HTTP プラグインを作らせたとき、`go` が「qa 1 problem」と表示したのに `qa` 単体では問題なしと出て、AI が 8 回ほど回り道をしていました（本当の原因は lint の警告）。`go` の表示を「警告で止まった」と分けて出すように直し、同じ依頼を作り直させたところ、813,487 → 303,247 トークン（28 → 13 ターン、455 → 190 秒）に減りました。
- AI プレイテストの採点：`node bds/bench/bench.mjs playtest` は、わざと不具合を入れたアドオン（自分のテストは通る）に `make -a <名前> --playtest` をかけ、隠しテストで「入れた不具合がいくつ消えたか」を数えます。プレイテスト用のプロンプトやモデルを変えたときの比較に使います（例は `bds/bench/playtest/shop/`）。
- トークン節約ベンチマーク：課題は `bds/bench/tasks.json` の 18 個（等級 1〜6。同じ課題が「一から作る」練習 `scratch` の教材です）。`node bds/bench/bench.mjs run <課題|all>` で Claude に解かせて隠しテストで採点します（ほかの AI は `start <AI名> <課題>` → `end <id> --claude|--codex` → `rank`）。合格した中でトークンの少ない順に並び、`make` の結果も同じランキングに載ります。
- コマンドの一覧は `node lab.mjs help ref`、話題ごとの詳細は `node lab.mjs help <player|client|tests|debug|world|model|ui|env|chat|engine>` です。
