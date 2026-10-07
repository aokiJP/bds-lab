# app ラボ — 作った JSON UI を、本物のマイクラで表示して撮る

アドオンの見た目（`rp/ui/*.json` の JSON UI）は、サーバー（BDS）では表示されません。ゲームのアプリの中でしか描かれないからです。
このラボは **本物の Minecraft（Android 版）をパソコンの中のスマホ（エミュレータ）で起動し、ラボのサーバーに自動で参加させ、
画面を撮って、ログと一緒に保存します**。人がやるのは、最初の準備と、1 行のコマンドだけです。

```
Google Play ──▶ Minecraft の APK ──▶ パソコンの中のスマホ（エミュレータ）
                                          │ 自動で参加
あなたのアドオン ──▶ ラボのサーバー（BDS）◀─┘
                                          │
       app.txt に書いた手順 ──▶ 押す・待つ・撮る ──▶ app/runs/<日時>/index.html（スクショ）と報告
```

## 言葉

| 言葉 | 意味 |
|---|---|
| APK | Android のアプリのファイル。ここでは Minecraft 本体 |
| エミュレータ | パソコンの中で動く仮想のスマホ。Android Studio に入っている |
| AAS トークン | Google Play から、自分が買った Minecraft をダウンロードするための合言葉。パスワードとは別物で、一度作れば使い回せる |
| BDS | Minecraft の公式サーバー。ラボが自動で用意する |
| JSON UI | リソースパックの `ui/` フォルダに書く、画面の見た目 |
| app.txt | アプリにさせる手順（起動、参加、撮影…）を 1 行ずつ書いたファイル |

## はじめての人へ（5 ステップ）

**1. Android Studio を入れる**（エミュレータのため）
[developer.android.com/studio](https://developer.android.com/studio) から入れて、一度起動して初期設定を終えます。
そのあと、ターミナルで次を設定します（ターミナルを開き直すたびに要るので、`~/.bashrc` や `~/.zshrc` に書いておくと楽です）。

```sh
export ANDROID_HOME=~/Library/Android/sdk     # Mac
export ANDROID_HOME=~/Android/Sdk             # Linux
setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"   # Windows（コマンドプロンプト。開き直すと有効）
```

**2. いまの状態を見る**

```sh
node lab.mjs app
```

✔ と ✘ が並び、最後に **「次にやること」** が 1 行出ます。迷ったら、いつでもこれを実行してください。

**3. 足りないものを用意する**

```sh
node lab.mjs app setup
```

質問に答えていくと、サーバー・Minecraft の APK・エミュレータが順に用意されます。
APK を Google Play から取るときは、途中で AAS トークンを作ります（ブラウザで Google にログインして、表示された値を 1 つ貼るだけ。パスワードは入力しません）。

**4. 見本で試す**

```sh
node lab.mjs app run -a jsonui_demo
```

初回は 10〜20 分ほどかかります（エミュレータの起動と Minecraft のインストール）。2 回目からは速くなります。
最後に `PASS` か `FAIL` と、結果の場所が出ます。

**5. 結果を見る**

`app/runs/<日時>-jsonui_demo/index.html` をブラウザで開きます。撮った画面が並んでいます。
`jsonui_demo` なら、`03-jsonui-form.png` に **金色の帯の付いた独自デザインのフォーム** が写っていれば成功です。

## 自分のアドオンで試す

まず、いつも通り bds ラボでアドオンを完成させておきます（`node lab.mjs bds go -a <名前>` が `DONE`）。

```sh
node lab.mjs app init -a <名前>      # そのアドオンに app.txt の雛形を作る
```

`bds/addons/<名前>/app.txt` を開き、「ここから」の下に **UI を出す手順** を書きます。見本（`bds/addons/jsonui_demo/app.txt`）:

```
launch                                    # アプリを起動（準備済みの端末なら、もうタイトル画面で起動済み）
until title 600000                        # タイトル画面まで待つ（初めての起動はとても重い）
shot title                                # 撮る
join                                      # ラボのサーバーに参加
until joined 300000                       # ワールドに出るまで待つ
until stable 120000
shot world
do scriptevent demo:open                  # サーバーからフォームを出す
until server DEMO shown to 1 30000        # サーバーのログで出たことを確かめる
wait 2000
until stable 30000
shot jsonui-form                          # ← JSON UI の成果
key BACK                                  # 閉じる
until server DEMO .* picked closed 30000
shot closed
absent log (?i)(json|ui).*(parse error|failed to parse)   # UI の読み込みエラーが無いこと
```

```sh
node lab.mjs app run -a <名前>
```

### 押す位置の測り方

確認画面のボタンなどを押したいときは、位置を **画面に対する割合** で書きます（`tap 0.5 0.62` = 横の真ん中、上から 62%）。
解像度が変わっても同じ所を押せます。

```sh
node lab.mjs app run -a <名前> --keep     # 終わってもエミュレータとサーバーを動かしたままにする
node lab.mjs app screen                   # いまの画面を撮る → app/.lab/screen-grid.png
node lab.mjs app tap 0.5 0.62             # 試しに押してみる
node lab.mjs app screen                   # 押した結果を見る
```

`screen-grid.png` には 10% ごとに線と数字（0.1〜0.9）が描かれています。押したい所の数字を読むだけです。
画面を見ながら調べたいときは `node lab.mjs app emu --window` で、エミュレータを窓付きで起動できます。

## app.txt の書き方

1 行に 1 手順。行末の ` # …` はメモ（無視されます）。実行の前に全行の書き方を調べ、誤りがあれば行番号付きで教えます。
実行中は、失敗した手順で止まり、そのときの画面を `fail-line<行番号>.png` に撮ります。

| 手順 | すること |
|---|---|
| `launch` / `stop` | アプリを起動する / 止める |
| `join` | ラボのサーバーに直接参加する |
| `wait 3000` | 3 秒待つ（ミリ秒） |
| `shot 名前` | 画面を撮る → `shots/NN-名前.png`（名前は英数字と `_ . -`） |
| `tap 0.5 0.62` | 押す（割合。1 より大きい数ならピクセル） |
| `swipe 0.2 0.5 0.8 0.5` | なぞる |
| `key BACK` | キーを押す（BACK ENTER ESCAPE TAB DPAD_UP など） |
| `text hello` | 文字を打つ（英数字と記号だけ） |
| `do <コマンド>` | サーバーのコンソールで実行（`scriptevent`、`give`、`js …` など tests.txt と同じ） |
| `until title [ミリ秒]` | ゲームのタイトル画面まで待つ（ゲームが前面・Android のダイアログなし・赤い起動画面でも真っ黒でもない・落ち着いている）。最初の起動の「WELCOME TO MINECRAFT!」（Microsoft サインインの誘い）などは、OCR で読めれば「Maybe later」で抜けて待ち続ける |
| `until joined [ミリ秒]` | ワールドに出るまで待つ（かかった時間が報告の「参加」に出ます） |
| `until stable [ミリ秒]` | 画面が 6 秒変わらなくなるまで待つ（真っ黒の間は待ち続ける） |
| `until server <文字> [ミリ秒]` | サーバーのログにその行が出るまで待つ |
| `until log <文字> [ミリ秒]` | アプリのログにその行が出るまで待つ |
| `… ; every 15000 tap 0.5 0.62` | `until` の後ろに付けると、待つ間 15 秒ごとに押す（出るかどうか分からない確認画面に） |
| `expect server <文字>` / `absent log <文字>` | ここまでのログに、その行が **ある** / **ない** ことを確かめる |
| `pull <端末のパス>` / `push <ファイル> <端末のパス>` | 端末からファイルを取り出す / 送る |
| `sh <コマンド>` | 端末のシェルで実行 |

実機でしかできないこと（ゲームのクライアントの操作と、クライアントにしか出ないエラー）:

| 手順 | すること |
|---|---|
| `section <名前>` | ここから「名前」の区切り。報告に区切りごとの表が出て、クライアントのエラーがどの区切り（画面）で出たかが分かる。区切りのある手順は、失敗してもその区切りの残りを飛ばし、開いている画面を戻るで閉じて、次の区切りから続ける |
| `chat <文字>` | チャットを開いて打って送る（`/` で始めれば、クライアントのプレイヤーとしてのコマンド） |
| `tap text <正規表現>` | 画面の文字を読んで（OCR: tesseract）、その文字を押す（例 `tap text (?i)^settings$`） |
| `until text <正規表現> [ミリ秒]` | 画面にその文字が出るまで待つ（OCR） |
| `key <キー>` | キーを押す（A〜Z、0〜9、F1〜F12、ENTER ESCAPE BACK TAB SPACE SLASH UP DOWN LEFT RIGHT など、または番号）。E でインベントリ、T でチャット |
| `press <キー>[+<キー>…] [ミリ秒]` | キーを押したままにする（`press W 2000` で 2 秒歩く、`press SHIFT+W 1500`）。端末のキーボードへ直接 |
| `hold <x> <y> [ミリ秒]` | 長押し |
| `record start` / `record stop` | 画面を録画（`recordings/rec-N.mp4`） |
| `perf [ミリ秒]` | ゲームのメモリ（MB）と、その間の毎秒のフレーム数 |
| `until clientlog <正規表現> [ミリ秒]` | ゲームのコンテンツログ（JSON UI・パック・スクリプトのエラー。クライアントにしか出ない）にその行が出るまで待つ |
| `expect clientlog <正規表現>` / `absent clientlog <正規表現>` | ここまでのコンテンツログにその行がある / ない |
| `changed [割合]` | いまの画面が `shot world`（何も開いていないワールド）と違う＝画面が本当に開いた（既定 3%） |
| `network delay <ミリ秒\|none>` / `network speed <edge\|umts\|…\|kbps>` | 端末の回線を遅くする（読み込み中の画面や、遅い回線での UI を試す） |
| `size <幅>x<高さ>` / `size reset` | ゲームの画面の大きさ・比率を変える（横向きで。`size 1024x768` = 4:3 のタブレット、`size 2400x1080` = 細長いスマホ）。JSON UI がほかの比率で崩れないか |
| `density <dpi>` / `density reset` | 画素の細かさ（UI の大きさが変わる） |
| `cutout <corner\|double\|hole\|tall\|waterfall\|none>` | スマホの切り欠き（ノッチ・パンチホール）を Android に描かせる。UI がセーフエリアの外にはみ出さないか |
| `expect text <正規表現>` / `absent text <正規表現>` | いまの画面にその文字が **ある** / **ない**（OCR）。例 `absent text \.name$`（訳されていないキーがそのまま出ていない） |
| `mouse tap <x> <y>` / `mouse move <x> <y>` / `mouse scroll <x> <y> <量>` | マウスで押す / ポインタを乗せる（ホバー: ツールチップや光るボタン）/ ホイール（スクロールする画面。下へ正） |
| `pad <A\|B\|X\|Y\|L1\|R1\|START\|UP\|DOWN…>` | ゲームコントローラーのボタン（UI のフォーカスがどう移るか。タッチでは通らない道） |
| `screen off` / `screen on` | 画面を消す / 点ける（ゲームの一時停止と再開） |
| `background` / `foreground` | ホームへ出る / ゲームへ戻る（戻った後の画面・UI の状態） |
| `trim <RUNNING_CRITICAL\|COMPLETE\|…>` | Android がメモリ不足をゲームに知らせる（後始末と、その後の画面） |

ゲームのコンテンツログは、毎回の実行で区切りごとに端末から読みます（root）。ERROR の行があれば実行は FAIL です（報告の
「クライアントのエラー」に、区切りの名前付きで並びます）。失敗にしないなら `--allow-client-errors`。

### JSON UI を全部試す（`app ui`）

```sh
node lab.mjs app ui -a <アドオン>              # アドオンの rp/ui にある画面を全部（開く → 撮る → 閉じる）
node lab.mjs app ui -a <アドオン> --all        # ラボが開ける画面を全部
node lab.mjs app ui -a <アドオン> --screens hud,chest,form-modal
node lab.mjs app ui -a <アドオン> --list       # どのファイルがどの画面で試されるか（実行しない）
node lab.mjs app ui -a <アドオン> --sizes 1024x768,2400x1080 --cutouts tall   # 同じ画面を、ほかの比率とノッチの下でもう一度ずつ
```

`rp/ui/*.json`（と `_ui_defs.json` に書かれたもの）を、それを描く画面に対応させ、画面ごとに区切りを作って順に開きます（`app/lib/uicatalog.mjs`）。
開ける画面: HUD（タイトル・アクションバー・サイドバー・チャットの行・効果）、チャット、インベントリ（クリエイティブとサバイバル）、一時停止、設定、
サーバーのフォーム 3 種（ActionFormData・ModalFormData のドロップダウン・スライダー・テキスト・トグル・MessageFormData。アドオンが
`@minecraft/server-ui` を使っていれば、ラボの `js` で出します）、チェスト・樽・シュルカーボックス・エンダーチェスト・作業台・かまど・溶鉱炉・燻製器・
金床・エンチャントテーブル・醸造台・ビーコン・砥石・機織り機・製図台・石切台・鍛冶台・ディスペンサー・ホッパー・クラフター・コマンドブロック・
ストラクチャーブロック・ジグソーブロック・看板の編集・ベッドで寝ている画面・本と羽根ペン・NPC・取引（行商人）・死んだときの画面・切断されたときの画面。
撮った画面はどれも、紫と黒の市松模様（テクスチャが見つからない）と、訳されていないキー（`item.lab:ruby.name` のような文字。OCR）を探して、見つかれば報告の「気づいたこと」に画面の名前付きで出します（OCR を使わないなら `APP_OCR_KEYS=0`）。
ブロックはプレイヤーの目の前に置き、カメラを向けて画面の真ん中を押して開きます。開き方を知らない画面のファイルは、コンテンツログだけ見ます。

`--sizes` / `--cutouts` を付けると、ふつうの画面を全部撮った後、形ごとに「その形のワールド」を撮り直してから同じ画面を全部もう一度撮り（区切りの名前は `chest--1024x768` のように）、形を戻します（GitHub ではつまみ `APP_UI_SIZES` / `APP_UI_CUTOUTS`）。
GitHub では入力 `mode`（`ui` / `ui-all`）と `devices`（同時に動かす端末の数、1〜4）で、画面を端末に分けて並行に撮ります。結果は 1 つにまとまり、
`app ci fetch` は端末ごとに `shard-<k>/` へ取ってきます。

`<文字>` は正規表現です（`.*` で「何でも」、頭に `(?i)` で大文字小文字を区別しない）。
`until server` / `until log` は、前の `until` が見つけた行の **次から** 探します（同じ行を二度数えない。直前の `do` が出した行は拾える）。
一覧はいつでも `node lab.mjs app help`。

## 結果の見方

`app/runs/<日時>-<アドオン>/` に次のものが入ります。

| ファイル | 中身 |
|---|---|
| `index.html` | **まずこれ**。撮った画面と手順の結果、「次にやること」が 1 ページに |
| `report.md` | 同じ内容の文章版（GitHub ではジョブの要約にも出る） |
| `shots/` | 画面。失敗した所は `fail-line<行>.png`、最後の画面は `99-final.png` |
| `logcat-minecraft.txt` | アプリ側のログのうち Minecraft とクラッシュの行（`logcat.txt` が全部） |
| `logcat-digest.txt` | 失敗したとき最初に読む行: アプリの起動と終了、FATAL・ライセンス・アカウントの行（スタックは省略、繰り返しはまとめる。GitHub では注釈にも出る） |
| `dropbox.txt` | 失敗したときだけ: Android が残したクラッシュの記録（アプリのクラッシュ・ネイティブクラッシュ・ANR、system_server の落ち・Watchdog） |
| `server.log` / `do.txt` | サーバーのログ / `do`・`sh` の出力 |
| `host.txt` | このパソコン（GitHub ならランナー）の負荷・メモリ・スワップ・空きディスク・大きいプロセスを 15 秒ごとに。報告には一番悪かった時が出ます |
| `pulled/` | アプリのコンテンツログなど、端末から取り出したもの |

`FAIL` のときは、最後に **「次:」** で始まる行が出ます。その通りにすれば、たいてい先に進めます。
途中で止まっても（Ctrl+C を含む）、報告は必ず書かれ、起動したサーバーとエミュレータは片付けられます。

## APK を用意する

どちらか一方で十分です。

**Google Play から（おすすめ）**: `node lab.mjs app token`（= `node lab.mjs login google`）。ブラウザが開き、ラボが受け取って閉じるまで自動です。

- `.env`（か `.env.local`）に `GOOGLE_EMAIL` と `GOOGLE_PASSWORD` を書いておけば **全自動**：ログイン画面への入力、「同意する」、途中で出る「パスキーを作成しますか？」などの「後で」まで、ラボが押します。2 段階認証は `GOOGLE_TOTP_SECRET` があれば自動、無ければその画面で答えます
- 書いていなければ、ターミナルで聞きます（パスワードは表示しません。Enter だけならブラウザで自分で入力）
- 同意の画面が出ないまま止まったら、ログイン済みのままトークンの画面を開き直して受け取ります。それでも 45 秒進まなければ、今の画面の名前・ボタン・写真の場所を表示します
- トークンは `.env.local` に自分だけが読める設定で保存。`app run` で無ければ、その場でこの手順が始まります（作り直すときは `--force`）

- ブラウザは Playwright（openAdapter と同じ仕組み）で開きます。入っている Chrome → Edge の順に使い、どちらも無ければ Chromium を一度だけ取得します。メールアドレスもログイン画面に打ったものを自動で読み取るので、聞かれません
- Playwright が使えないとき（npm が無いなど）は、入っているブラウザを直接開く方法に自動で切り替えます（`APP_BROWSER=<場所>` で指定も可）
- 画面の無い Linux（SSH 先のサーバーなど）では窓を出せないので、デスクトップのあるコンピュータで `app token` を実行し、できた `.env.local` をコピーしてください
- 自動がうまくいかないときは `node lab.mjs app token --manual`（開発者ツールから値を 1 つ貼る方法）

**スマホから取り出す**: Minecraft の入った Android スマホを USB でつなぎ（開発者オプションの USB デバッグを有効に）、

```sh
adb shell pm path com.mojang.minecraftpe          # 出てきた場所を全部
adb pull /data/app/…/base.apk ~/minecraft-apk/
adb pull /data/app/…/split_config.arm64_v8a.apk ~/minecraft-apk/
node lab.mjs app apk ~/minecraft-apk
```

どちらでも、APK は git にもラボの zip（`handoff`）にも入りません。

## GitHub で動かす

```sh
node lab.mjs app token                       # まだなら
node lab.mjs app secrets                     # GOOGLE_EMAIL / GOOGLE_AAS_TOKEN を GitHub に登録（gh が要る）
```

GitHub のリポジトリの **Actions → app → Run workflow** で、アドオンの名前を入れて実行します。
終わると、スクショとログが **Artifacts**（14 日保存）に入ります。
成果物を開けない所（API だけ）からも読めるように、最後のジョブ（`report`）が結果をチェック（check run）として出します（既定は**結果とエラーだけ**・**匿名化**済み）。

| 入力 | 意味 |
|---|---|
| `mode` | `run` = アドオンの app.txt / `ui` = アドオンの JSON UI の画面すべて（`app ui`）/ `ui-all` = ラボが開ける画面すべて |
| `devices` | 同時に動かす端末の数（1〜4。`ui` / `ui-all` のとき、画面を端末に分ける。分の消費は台数ぶん） |
| `account` | Google アカウントを端末に書き込む（既定 on。Minecraft の起動時のライセンス確認に要る） |
| `fresh` | 準備済みの端末を使わず作り直す（キャッシュも新しくなる） |
| `screen` / `bds` / `scenario` / `ref` | 画面の大きさ / BDS の版 / mode run のシナリオ / アドオンを取る枝 |
| `lane` / `knobs` | 実験の名前（名前が違う実行は同時に走る。空なら 1 本ずつ）/ ラボの設定 `APP_名前=値` を空白区切りで（例 `APP_INSTALL_VIA=play APP_SETTLE_MS=180000`。秘密・キャッシュ・道具の場所に関わるものは変えられない） |

**速さ（準備済みの端末と、非公開のキャッシュ）**: 最初のジョブ（`prep`）が、Minecraft をタイトル画面まで起動した端末をスナップショットにして
キャッシュします（初回と、Minecraft の更新のあとだけ。10〜30 分）。次の実行からは、端末ジョブがそれを戻すだけで、ゲームは起動済み・
ライセンス確認も済みのタイトル画面から、すぐ参加します。報告の「参加」の行が、参加リンクからワールドに出るまでの秒数です。
キャッシュするもの（APK・BDS・Play ストア・準備済みの端末）は、リポジトリが公開でも非公開でも **AES-256-GCM で暗号化**して置きます
（鍵は Secrets の `APP_CACHE_KEY`、無ければ `GOOGLE_AAS_TOKEN` から作る。トークン自体はどこにも書きません。鍵が無ければキャッシュは
使わず、毎回すべて作ります）。エミュレータ本体とシステムイメージ（Google が公開しているもの。秘密を含まない）もキャッシュします。

**公開リポジトリでも private 並み**: 誰でも見られるもの（ログ・注釈・チェック・issue・成果物）に秘密や画面の中身を出しません。
成果物（報告・スクリーンショット・ログ）は同じ鍵で `results.sealed` に暗号化し、平文は合否・手順の数・秒数・版だけの `summary.json`。
チェックと注釈は合否だけ。`app ci watch <番号>` が取るときに `.env.local` の鍵（Secrets と同じ `APP_CACHE_KEY`、無ければ
`GOOGLE_AAS_TOKEN`）で開きます。鍵が無い実行は中身を成果物に出しません。
**端末の土台**: `account` のとき、ゲームを入れる前の端末（Play ストアを system に入れ、アカウントを書き込み、Google の最初の重い処理が
終わったところ）も別にキャッシュします。Minecraft が更新されたら、端末はゼロからではなくこの土台から作ります（アカウントの書き込みも、
Google への端末の登録もやり直さない。数分で済む）。土台を使わないなら `APP_BASE=0`。

**手元（や AI）から実行して、結果を全部取ってくる**（`gh` が要る。成果物を開けない環境でも、GitHub の API だけで読めます）:

```sh
node lab.mjs app ci -a jsonui_demo                       # 起動して、待たずに戻る（実行はいくつでも同時に走る）
node lab.mjs app ci -a jsonui_demo --wait                # 終わるまで待って app/runs/gh-<番号>/ に取ってくる
node lab.mjs app ci -a jsonui_demo --mode ui-all          # ラボが開ける画面を全部、端末 4 台で手分けして（--devices 1〜8）
node lab.mjs app ci --try "APP_TAP=hold" --try "APP_TAP=motion APP_FAST_UI=0"   # 設定違いを 1 本ずつ同時に（8 本まで）
node lab.mjs app ci watch <番号>                          # 待ってから取る（ci fetch <番号> = 取るだけ）
```

`app/runs/gh-<番号>/` には `report.md`、`details.txt`（**既定は結果とエラーだけ**）、`shots/*.png`（縮小したスクショ）、`annotations.txt`、`steps.txt` が入ります。
実行ごと止められて成果物が無いときは `explain.txt`（どの手順が何分で・どう止まったか、最後に出た進行の notice）も入ります。
出力は**匿名化**されます（メール・トークン・アカウント名・端末やデバイスの ID・ホームパスは伏せる）。配信に映っても困らないよう、端末まわりの表現も控えめにしています（エラーはそのまま）。
全ログ（`logcat-wide.txt` など）が要るときだけ `--full`（または `APP_FULL_LOGS=1`）。
ワークフローの 2 つ目のジョブ（`report`、秘密なし・`checks: write` だけ）が、成果物をチェック（check run）として出しているものです。
調べたいことがあれば、シナリオに `sh <コマンド>`（端末のシェル）を書いて `--scenario` で渡すと、出力が `details.txt` に入ります。
別の枝（`addon/<名前>` など）のアドオンを試すときは、`ref` にその枝の名前を入れます。

### 常駐の端末（復元は 1 回、テストは何度でも）

```sh
node lab.mjs app ci -a jsonui_demo --mode hold             # 端末を戻して起動したまま 60 分（--hold <分> で 300 分まで）
node lab.mjs app live --run <番号> --wait                  # 待つ状態になるまで待つ（数分）
node lab.mjs app live --run <番号> "run"                   # この端末のまま app run（アドオンの app.txt）: 復元なし、BDS を立てて参加まで
node lab.mjs app live --run <番号> --steps my-test.txt     # 手元の手順ファイルをそのまま（コミット不要）
node lab.mjs app live --run <番号> "pull my-branch" "run"  # 枝に push したアドオンを取り直して、もう一度
node lab.mjs app live --run <番号> "last fail"             # その run の報告と、失敗した所の画面（"last list" で一覧）
node lab.mjs app live --run <番号> --no-wait "ui --all"    # 待たずに戻る（返事は --reply <id>）
```

`run` / `ui` は、その端末の上で `app run` / `app ui` を丸ごと走らせます（自分のフォルダ・報告・画面。ジョブの最後に成果物にも入る）。
端末を戻す数分は最初の 1 回だけで、2 回目からは BDS を立てて参加するところから始まります。手順はコメントにも書けます:
`run <<` の次の行から `EOF` の行までが手順です。常駐の端末をもう 1 台なら、もう 1 本 `--mode hold`（並行に走る）。

### CI の端末をその場でさわる（コードを変えず、作り直さず）

```sh
node lab.mjs app ci -a jsonui_demo --hold 60 --no-wait    # 端末を作った後（失敗しても）と確かめた後、60 分そのまま待つ
node lab.mjs app live --run <番号> --wait                  # 待つ状態になるまで待つ
node lab.mjs app live --run <番号> "screen"                # いまの画面（app/runs/live/<番号>-<id>.png）・前の窓・描画の速さ・画面の文字
node lab.mjs app live --run <番号> "tap 0.78 0.84 hold" "wait 3000" "logcat 200 Minecraft|Input"
node lab.mjs app live --run <番号> "options set screen_animations=0" "kill" "launch" "title 5"
node lab.mjs app live --run <番号> "seal"                  # この状態を準備済みの端末としてキャッシュへ（次の実行から使う）
```

命令は数秒で端末に届き、返事（各命令の答えと、その後の画面）がそのまま返ってきます（リポジトリの issue
「app live: 実機をそのまま調べる（ラボが使います）」のコメントでやりとりします）。動くのは、その実行を起動した人の命令だけで、
効くのは端末（adb）だけです（ランナーのシェルではない）。返事は匿名化されます。公開リポジトリでは命令も返事も（画面の PNG も）vault の鍵で封じて書き、手元で開きます（`.env.local` に Secrets と同じ鍵）。命令の一覧は `app live "help"`:
`screen` `tap <x> <y> [tap|hold|motion]` `swipe` `key` `text` `wait` `sh <端末のシェル>` `logcat [行数] [正規表現]`
`input`（Android が入力をどの窓へ送ったか）`windows` `fps` `gpu` `launch` `kill` `options [正規表現] | options set k=v`
`title [分]` `answer`（Android の「応答なし」に答える）`bds up|down|do` `bdslog [行数] [正規表現]`（この runner の BDS のログ）
`relay` `join` `run` `ui` `pull <枝>` `last` `pad A DOWN …`（端末に挿したコントローラー）`world [restart]`
`signin` `code <数字>` `seal` `stop`。

### サインインした端末（フレンドのワールド・アドレスでのサーバー参加）

サインインなしで入れるのは、同じネットワークのワールド（LAN。ラボの BDS はこの形で立てます）だけです。フレンドのワールドと、
アドレス（参加のリンク・サーバーの一覧）での参加には Microsoft のサインインが要ります。リポジトリの Secrets に

- `MS_EMAIL`（このためだけの Microsoft アカウントを勧めます。Minecraft を持っている必要はありません）
- `MS_PASSWORD`（任意。無いか二段階の確認があれば、人の承認を 1 回）

を入れると、次の `app ci` の準備（prep）が端末のゲームをサインインさせてからスナップショットにします（作り直しは 1 回だけ）。
値は端末の標準入力で打ち、コマンドラインにもログにもコメントにも出しません。二段階の確認はライブの issue に出ます:
「Authenticator で承認（番号 42）」なら手元のスマホで承認、「コードを送って」なら
`node lab.mjs app live --run <番号> "code 123456"`（実行した人のコメントだけ受け取る）。常駐の端末なら `signin` で始めて、
終わったら `seal` で残せます。サインインなしで作るなら knobs に `APP_SIGNIN=0`。

**確かめたこと（2026-10-04）**: GitHub の端末で、jsonui_demo の app.txt が本物のアプリで通りました（サインインなし。
BDS は NetherNet の LAN、アプリは PLAY → Worlds の LAN のワールドから入り、アドオンの JSON UI のフォームが画面に出た）。

**新しい人向けの流れ**: ワールドを 1 つも持たない人の Play は、PLAY 画面でなく「Get started → GAME MODE → ワールドを作る」へ
行きます。準備は自分のワールド（「own world」、開かない平らな世界）を 1 つ置いておくので、実行の Play は PLAY 画面を開き、
ラボの BDS を LAN のワールドとして選べます（`APP_SEED_WORLD=0` で置かない。常駐の端末では `world restart`）。

**手元でも同じ**: `node lab.mjs app prepare --account` で準備済みの端末を作っておくと、`app run` / `app ui` はそのスナップショットから
始めます（APK・エミュレータ・画面の大きさなどが変わったら、作り直すまで普通の起動に戻ります。`app prepare --force` で作り直し）。

## うまくいかないとき

`node lab.mjs app` が、足りないものと次にやることを教えてくれます。そのうえで、実行してみないと分からないことを下にまとめます。
どれも起きれば、画面（`fail-line*.png`）とログに残ります。

| 症状 | 考えられること | 対処 |
|---|---|---|
| とても遅い / 起動しない | Linux で KVM が使えない。メモリ・空きディスクが足りない | `node lab.mjs app` の KVM の行の通りに。`app/.lab/emulator.log` も見る |
| スクショが「System UI isn't responding」「Process system isn't responding」 | 端末が重すぎて Android 自体が応答していない（arm64 版を ARM 変換で動かしている、画面が大きい） | ラボがダイアログに「待つ」を押して続けます（報告に回数）。x86_64 版の APK（`app apk fetch` が先に試す）、`APP_SCREEN=720x1560`、`APP_CORES` |
| GitHub で手順の途中で終了コード 143、後の手順が全部 skipped、成果物なし | ランナーごと止められた（メモリやディスクが尽きたとき） | `node lab.mjs app ci fetch <番号>` の `explain.txt` と notice（load / mem / disk の推移）を見る。メモリなら `APP_SCREEN` を小さく・`APP_RAM` を減らす |
| 画面が真っ黒のまま | 描画できていない（GPU の形がゲームに合わない。`swiftshader_indirect` では x86_64 版が真っ黒） | 既定の `swangle_indirect`（ANGLE と SwiftShader の Vulkan）で描けます。手元なら `node lab.mjs app emu --gpu host`（`APP_GPU=host`） |
| ゲームが「WELCOME TO MINECRAFT!」（Sign in now / Maybe later）で止まる | 最初の起動の Microsoft サインインの誘い | 準備が OCR で読んで「Maybe later」を押します（OCR が要る: `tesseract`。GitHub では入れてあります）。押しても変わらなければ押し方を変えて試します（下の「今の状態」） |
| 準備（`app prepare`）が「ライセンス確認（Google Play）で止められました」 | Play が、この端末ではアカウントとゲームを結びつけられなかった（Play の購入ページが出て、ゲームが終わる） | 準備は起動に失敗するたびに、端末が知っていること（ゲームを入れたのは誰か・Google への登録・アカウントのトークンの種類・Play のライブラリとインストール記録。値は出さない）を `license.txt` に、Play と Google のサービスのログを `license-log.txt` に残し、Play のゲームのページを開いてボタン（Install / Update / Open / 値段）を読みます。Update / Install なら Play に入れ直させます（Play が本当の入れ主になる。`APP_LICENSE_FIX=page,play`）。`--account` のときは、はじめから Play がゲームを入れます（既定。adb で入れるなら `APP_INSTALL_VIA=adb`）。値段が出るなら、Play はこの端末でアカウントがゲームを持っていないと見ています |
| ライセンスの画面が出る | Play ストアの無いエミュレータでは購入を確認できないことがある | `APP_SYSIMG="system-images;android-34;google_apis_playstore;x86_64"` にして `app emu --window` で起動し、Google にサインインしておく |
| ライセンスの画面が出る（GitHub など、手でサインインできないとき）。報告に「ライセンス確認（PairIP）で止められました」 | Minecraft は Google Play のライセンス確認（PairIP）を通らないと、その画面を出して終了します。Google APIs のイメージには本物の Play ストアが無く、同じ名前の LicenseChecker が「ライセンスなし」と答えます | 試験的: `node lab.mjs app run -a <アドオン> --account`（GitHub ではワークフローの入力 `account`）。AAS トークンを Google アカウントとしてエミュレータへ直接書き込み（root、Google の公式の手順ではない）、Play ストアを同じアカウントで Google Play から取って system のアプリとして入れます（LicenseChecker は外す。`/system` を書けるよう `-writable-system` で起動）。Play ストアを自分で渡すなら `--vending <apk>`、GitHub では変数 `APP_VENDING_URL` と `APP_VENDING_SHA256`。入れないなら `APP_VENDING=0` |
| サインインを求められて進まない | サインインなしでは外部サーバーに入れない版がある | `app emu --window` で一度サインインしておく（エミュレータの中身は次回も残る。GitHub では難しい） |
| 「サーバーに接続が来ていません」 | 参加用のリンクが効かない | `APP_JOIN_URI` を変える（`{host}` `{port}` が入る） |
| 「接続したが、ワールドに出ていません」 | リソースパックのダウンロード確認で止まっている | ボタンの位置を測り、`until joined 300000 ; every 15000 tap <x> <y>` |
| 「古いサーバー」「古いクライアント」 | アプリとサーバーの版が違う | ラボはアプリの版に合わせようとします。合わなければ `--bds <版>` |
| JSON UI のエラーを見たい | アプリのコンテンツログは、設定で有効にしたときだけ出る | `app emu --window` で起動し、設定のクリエイター欄でコンテンツログのファイル出力を有効にしておく → `pulled/logs-*` |
| どのコマンドでも `process.cwd failed … uv_cwd` | ターミナルが消えたフォルダの中にいる（フォルダを置き換えた）か、Mac がそのフォルダへのアクセスを許していない | `cd ~` → bds-lab へ `cd` し直す。次からの更新は `node lab.mjs update <zip>`（フォルダを消さない）。直らなければ bds-lab を `~/bds-lab` へ移す |
| エミュレータを使っていないのに app が別の端末を操作する | ラボは `emulator-5554` を使います。Android Studio で同じ番号の端末が動いているとそれを使う | その端末を閉じるか、`APP_SERIAL` で番号を変える |

## redroid: エミュレータの代わりに、コンテナの Android で（Linux）

VM を使わず、ホストの Linux カーネルの上のコンテナで本物の Android 14 を動かします。準備した端末（`/data` のフォルダ）を
0.1 秒で戻し、約 10 秒で起動、戻してから約 50 秒でゲームのタイトルまで（2 CPU の GitHub の runner で計測）。あとは `app run` / `app ui` がそのまま動きます。

```
node lab.mjs app redroid doctor              # 足りないものと直し方（docker・binder・sudo・adb …）
node lab.mjs app redroid setup               # 端末のイメージ（redroid + Play ストア・Play 開発者サービス。約 1 分）
node lab.mjs app redroid prep                # 一度だけ（約 8 分）: アカウント → Play がゲームを入れる → タイトルまで
node lab.mjs app run -a jsonui_demo --device redroid      # いつも（app ui も同じ。--keep で端末を動かしたまま）
```

要るもの: Linux、docker、カーネルの binder（`sudo modprobe binder_linux devices=binder,hwbinder,vndbinder`）、パスワード
なしの sudo、adb、python3（タイトルを読むのに tesseract）。prep にだけ Google の認証（`app token`）。`--account` などの
エミュレータのための指定は使えません（アカウントとゲームは準備済みの端末に入っています）。GitHub では
`node lab.mjs app ci --device redroid -a <名前> --wait`（結果は app/runs/gh-<番号>/）。

- `--keep` で残した端末は、次の `--device redroid` がそのまま使います（戻さず起動もせず、ゲームが止まっていれば起動するだけ）。
- GitHub では（公開でも非公開でも、鍵があれば）、準備済みの端末を app と同じ暗号化キャッシュから戻し、prep を飛ばします。作った端末を
  キャッシュへ残すのは `app ci --device redroid --keep` のときだけ（約 1 GB。キャッシュは共有で 10 GB まで）。`--fresh` で作り直し。

詳しく: [redroid/README.md](redroid/README.md)。

## 自分の端末で（スマホ・タブレット: root あり・なし × USB・Wi-Fi）

エミュレータの代わりに、自分の Android 端末で `app run` / `app ui` を通せます。ゲームは端末に Play ストアで入れたものを
使い（ラボは APK もアカウントも入れません）、BDS はそのゲームの版に合わせます。

```
node lab.mjs app device                         # adb に見えている端末（登録していない端末では何も実行しません）
node lab.mjs app device add phone               # 調べて登録 → 使う道とその理由、足りないこと
node lab.mjs app run -a jsonui_demo --device phone
```

道は端末を調べて決まります（`node lab.mjs app device path <名前>` でいつでも調べ直せます）:

| | USB でつなぐ | Wi-Fi でつなぐ |
|---|---|---|
| 参加 | 端末と PC が同じネットワーク（同じ Wi-Fi・USB テザリング・端末のホットスポット）なら、ゲームの LAN のワールドとして入ります。root も中継も要りません | 同じ |
| root なし | 操作は adb の入力（ボタンは長押し）。コンテンツログは外部の保存先から、無ければ logcat から（参考） | 同じ |
| root あり（adbd か su） | 操作はラボのコントローラー（uinput）。コンテンツログは内側の保存先からも | 同じ |

- **Wi-Fi でつなぐ**: Android 11 以上は端末の「ワイヤレス デバッグ」→「ペア設定コードによるデバイスのペア設定」に出る
  IP:ポートで `node lab.mjs app device pair <IP:ポート>`（6 桁のコードはその場で聞いて使うだけで、どこにも残しません）。
  Android 10 以下は USB でつないで `app device tcpip <名前>`。ポートが変わっても、端末のシリアル番号で探してつなぎ直します
- **同じネットワークにならないとき**: 端末の設定で USB テザリング（`app device tether <名前>` で adb から試せます。効かない
  端末もあります）か、端末のホットスポットに PC をつなぐ。ゲスト用の Wi-Fi は端末同士を隔離していることがあります。
  WSL2 は既定で別のネットワークです（Windows の `.wslconfig` に `networkingMode=mirrored`）。参加できないときは PC の
  ファイアウォールで BDS の UDP（7551 と 19132 から）を許可（Windows: プライベート ネットワーク）
- **root のコントローラー**: arm64 の端末用はこの PC で作ります（Android NDK・zig（`pip install ziglang`）・clang と
  ld.lld のどれか）。作れなければ adb の入力で操作します
- run の間だけ、画面を点けたまま・通知の帯をデモ表示・おやすみモードにし、終われば元に戻します（`APP_DEVICE_QUIET=0` で
  変えない。途中で止めたら `app device restore <名前>`）。アプリを止めたり消したり、画面の形や回線を変えたりはしません
  （`size` `density` `cutout` `network` の手順と `app ui --sizes` は使えません）。画面がロックされていたら、解除を待ちます
- 押す位置を測る: `node lab.mjs app screen --device <名前>` / `app tap <x> <y> --device <名前>`

## 対応している OS

| | macOS（Apple Silicon / Intel） | Windows 10/11 | Linux |
|---|---|---|---|
| トークン作り（ブラウザでログイン） | ✔ | ✔ | ✔（デスクトップが要る） |
| APK の取得（apkeep） | ✔ ラボが取得（Homebrew 不要、ハッシュ確認） | ✔ 公式版（ハッシュ確認） | ✔ 公式版（ハッシュ確認） |
| エミュレータ | ✔ arm64 はそのまま速い | ✔ Windows ハイパーバイザー プラットフォームを有効に | ✔ KVM が要る |
| redroid（`--device redroid`） | — | — | ✔ docker と binder が要る |
| 自分の端末（`--device <名前>`） | —（BDS がコンテナの中で、LAN の放送が届きません） | ✔ ファイアウォールで BDS の UDP を許可 | ✔（WSL2 は mirrored のネットワークで） |
| GitHub で動かす | — | — | ✔（ubuntu-latest） |

## 安全のために

- Google のパスワードは、どこにも入力しません。使うのは AAS トークンだけです
- トークンは `.env.local`（自分だけが読める）か GitHub の Secrets にだけ置きます。コマンドの引数にも、エミュレータ・サーバーなど他のプログラムにも渡しません
  - 例外は `--account`（`app account`）を付けたときだけ: トークンをエミュレータの中のアカウント情報へ書き込みます。渡すのは sqlite3 の標準入力だけで、コマンドの引数・画面・ログには出しません（メールアドレスも出しません）。エミュレータの中身には残るので、終わったら `--wipe` か `app emu stop`
- APK・`.so`・トークンは git にも、ラボの zip（`handoff` / `patch`）にも、GitHub の成果物にも入りません。成果物は、アップロードの前に `app guard` が中身まで調べます
- GitHub の app ワークフローは書き込み権限を持たず、既定ブランチからしか動きません
- 自分の端末: 登録した端末にだけ触ります。ペア設定コードは保存せず、APK もアカウントも入れません。変えた設定は終わりに戻し、置いたもの（コントローラー）も消します。画面とログは手元にだけ残ります。使い終わったら端末の「ワイヤレス デバッグ」を切ってください
- 自分で買った Minecraft を、自分の検証のためにだけ使ってください。Google Play をデータセンター（GitHub）から頻繁に使うと、アカウントに制限がかかることがあります

## コマンド一覧

| コマンド | すること |
|---|---|
| `node lab.mjs app` | 状態と、次にやること |
| `node lab.mjs app setup` | 足りないものを対話で用意 |
| `node lab.mjs app run -a <名前>` | 全部やって報告（`--keep` `--window` `--scenario <ファイル>` `--bds <版>` `--apk <フォルダ>` `--wipe` `--allow-client-errors`） |
| `node lab.mjs app ui -a <名前>` | JSON UI の画面を全部開いて撮り、クライアントのエラーを画面ごとに（`--all` `--screens <id,…>` `--shard k/n` `--list`） |
| `node lab.mjs app prepare` | 準備済みの端末（タイトル画面で起動済みのスナップショット）と BDS を作る / キャッシュから戻す（`--account` `--force` `--no-device` `--no-bds`） |
| `node lab.mjs app keys` | Google Play がいま配っている版と、キャッシュの名前（ワークフロー用） |
| `node lab.mjs app init -a <名前>` | app.txt の雛形を作る |
| `node lab.mjs app screen` / `tap` / `key` / `text` | いまの画面を撮る / 操作する（位置を調べるとき） |
| `node lab.mjs app token` | AAS トークンを作る |
| `node lab.mjs app apk fetch` / `apk <フォルダ>` / `apk info` | APK を取る / 手元のものを使う / 版を見る |
| `node lab.mjs app emu` / `emu stop` | エミュレータを起動 / 停止（`--window` で窓付き） |
| `node lab.mjs app secrets` | GitHub に認証を登録 |
| `node lab.mjs app ci -a <名前>` | GitHub で動かし、終わるまで待って結果を取ってくる（`--mode run\|ui\|ui-all` `--devices <1〜4>` `--fresh` `--no-account` `--ref <枝>` `--screen <幅x高さ>` `--full` / `ci fetch <番号>` / `ci watch <番号>`） |
| `node lab.mjs app vending` | 必要な部品を公式イメージから取り出す（`--account` 用、`--cleanup` で後片付け） |
| `node lab.mjs app account` | アカウントの書き込みだけ（`check` で状態） |
| `node lab.mjs app run -a <名前> --device redroid` | エミュレータの代わりに redroid（コンテナの Android、VM なし。Linux）で。`app ui` も同じ。準備は下の「redroid」 |
| `node lab.mjs app redroid doctor` / `setup` / `prep` / `down` / `seal` / `open` | redroid の端末: 足りないもの / イメージを作る / 準備済みの端末を作る（一度だけ） / 止める / 暗号化して 1 ファイルに / そこから戻す |
| `node lab.mjs app ci --device redroid -a <名前>` | GitHub の redroid ワークフローで（`--mode run\|ui` `--bench` `--keep` `--fresh` `--wait` / `ci watch <番号> --device redroid`） |
| `node lab.mjs app device` / `add <名前>` / `path <名前>` / `pair <IP:ポート>` / `connect <IP:ポート>` / `tcpip <名前>` / `tether <名前>` / `restore <名前>` / `forget <名前>` | 自分の端末を登録して、使う道（参加・操作・ログ）を決める（上の「自分の端末で」） |
| `node lab.mjs app run -a <名前> --device <端末の名前>` | 自分の端末で（`app ui` も同じ） |
| `node lab.mjs app guard <フォルダ>` | APK・.so・トークンが混ざっていないか |
| `node lab.mjs app help` | 全部の書き方 |

打ち間違えたオプション（`--nofetch` など）は無視せず、正しい書き方を教えて止まります。

## ファイル

| | |
|---|---|
| `app.mjs` | コマンドの本体 |
| `lib/apk.mjs` | APK の取得（apkeep / gpdl）、トークン、版の読み取り、合うサーバーの版 |
| `lib/android.mjs` | エミュレータと adb |
| `lib/account.mjs` | `--account`（アカウント書き込みと必要な部品。`app vending`） |
| `lib/ghresults.mjs` | GitHub の結果（チェック）への出し入れ、匿名化、結果とエラーの抽出 |
| `lib/scenario.mjs` | app.txt の読み取りと実行（区切り、クライアントのエラーの区切りごとの振り分け） |
| `lib/client.mjs` | ゲームのクライアントの操作: キーの名前、押したままのキー、OCR、コンテンツログ、メモリとフレーム数、録画 |
| `lib/uicatalog.mjs` | JSON UI の画面の一覧と開き方（`app ui`） |
| `lib/warm.mjs` | 準備済みの端末（スナップショット）と、それが何から作られたかの印 |
| `lib/vault.mjs` | 暗号化キャッシュ（AES-256-GCM。公開・非公開とも、鍵があるとき）と、ライブの issue の文を封じる sealText / openText |
| `lib/screen.mjs` | 位置を測る格子 |
| `lib/report.mjs` | 報告と、成果物の検査（guard）、ログの要約 |
| `lib/host.mjs` | このパソコンの負荷・メモリ・ディスクの記録（host.txt、notice） |
| `gpdl/` | Google Play から取る道具（Rust）。`profile.mjs` が x86_64 の端末プロファイルを作る |
| `scenarios/default.txt` | app.txt が無いアドオンで使う手順 |
| `../bds/addons/jsonui_demo/` | 見本のアドオン |
| `redroid/redroid.mjs` | redroid の端末: イメージ、/data の戻し方、起動、doctor |
| `redroid/game.mjs` | redroid でのゲーム: アカウント、Play のインストール、タイトルまでの計測、`app run` / `app ui` |
| `../.github/workflows/app.yml` | GitHub で動かす設定 |
| `../.github/workflows/redroid.yml` | GitHub で redroid を動かす設定（手動か `[redroid ci]`） |
| `../tests/app-offline.mjs` | 試験（偽のスマホと偽のサーバーで全部の流れ。`--real` で本物のサーバーにも参加） |

## 今の状態（GitHub で `--account` を動かして分かったこと。2026-10-03）

- **ランナー**: 標準ランナー（private リポジトリの計測）は 2 CPU・7.8 GB・空きディスク 14 GB（使わない道具を消すと 30 GB ほど）。CPU は
  AMD EPYC 7763 / 9V74 / 9V45 と毎回変わります。KVM あり。端末は Android 14 の Google APIs イメージ（x86_64）。
- **ライセンス確認（PairIP）**: ゲームは起動のたびに Play に問い合わせます。**adb で入れたゲームは、アカウントが買っていても
  「ライセンスなし」**と答えられ、Play の購入ページ（Play Pass の paywall）が出てゲームが終わります（Play のログには
  `Account determined from library ownership` が出る＝Play はアカウントが持っていると知っている。違いは「誰が入れたか」:
  adb は installer が Play でも、インストールを始めたのが shell）。そこで **`--account` のときは Play 自身がゲームを入れます**
  （既定。Play のページの「Install」を押す。4 分ほど）。これで **`License check succeeded` / `allowed reason: LICENSED`** に
  なりました。準備で止まったときは `license.txt`（端末が知っていること）と `license-log.txt`（Play と Google のサービスのログ）が残ります。
- **いちばんの壁は、アカウントを入れた直後の端末の重さ**: Google のサービスの準備と Play の自己更新・アプリの自動更新で、
  2 コアの端末の負荷が 10〜16 のまま 10 分以上続き、その間は System UI も Play のページも応答しません（「System UI isn't
  responding」、Play のインストールが 20 分終わらない、ホーム画面の絵が崩れてエミュレータのプロセスが終わる）。パソコン側の
  メモリは足りていました（空き 2.4 GB、スワップ未使用）。対策: 自動更新の対象になる Google のアプリを止め、**アカウントの後は
  落ち着くまで待ち切る**（`APP_BASE_SETTLE_MS`、既定 25 分）。これは一度だけで、その落ち着いた端末を**端末の土台**として
  キャッシュし、次からはそこから作ります（Minecraft の更新のときも、アカウントの書き込みや Google への端末の登録をやり直さない）。
  落ち着かないまま時間切れになったときは、いちばん忙しかったプロセスを準備の記録に出します。
- **描画**: Play が入れる x86_64 版のゲームは、`swiftshader_indirect` ではライセンスを通った後も画面が真っ黒のままでした
  （フレームは出ているのに、全部黒い）。**`swangle_indirect`（ANGLE と SwiftShader の Vulkan、パソコン側）では描けます**:
  GitHub のランナーで「WELCOME TO MINECRAFT!」（Microsoft サインインの誘い）まで出ました。これを既定の GPU の形にしました
  （`APP_GPU` で変えられます。端末の土台は GPU の形によらず使い回せます）。ゲームが動いているのに 6 分描かないと、準備は
  そう言って止まります（`APP_BLACK_MS`）。
- **見えていなかった原因**: Android の `dumpsys window` は、最後の「応答していません」のときの状態（2 時間残る）を先頭に出します。
  ホーム画面が一度応答しなくなると、ラボはその古い「ホーム画面が前」を読み続け、ゲームが前に出てもタイトルと見ませんでした。
  いまは表示の項（`dumpsys window displays`）だけを読みます。
- **タイトルの見つけ方と、ゲームのボタンの押し方**: メニューの背景（パノラマ）はずっと動くので、「落ち着いた画面」は来ません。
  ゲームが前にいる間は数秒ごとに OCR で読み、最初の起動の画面（WELCOME TO MINECRAFT!）はその「Maybe later」で抜け、
  Play と Settings が読めたらタイトルとします。ソフトウェア描画のゲームは毎秒数フレームなので、`input tap`（押してすぐ離す）を
  1 回の押しと読まないことがあります: 押せなかったら、長めの押し（`APP_TAP_MS`）・motionevent・戻る・↓ と Enter の順に試し、
  効いた押し方を端末の印（`tap`）に残して、その後の実行の押す手順すべてに使います（`APP_TAP` で最初に試す形を指定）。
- **Play のダウンロード**: ランナーの回線が遅いと Play のダウンロードが失敗します（HTTP_DATA_ERROR）。ページにボタンが
  戻ったら押し直します（3 回まで）。
- **参加の道（2026-10-04、CI の端末で確かめたこと）**: 1.26 の BDS は「NetherNet is the only supported transport type」と言い、
  RakNet のままでは本物のアプリはつなげません。アドレスで参加する（参加のリンク・サーバーの一覧）と、127.0.0.1 でも
  「You need to authenticate to Microsoft services」（Guardian）で止まります。そこで実行は、BDS を NetherNet の LAN の形
  （`LAB_TRANSPORT=lan`: 同じネットワークのワールドとして見つかる）で立て、端末に中継（ゲームの 19132）と、LAN の発見の
  放送（UDP 7551: ゲーム自身がこのポートを持つので、出ていく放送を捕まえて BDS へ送り直す `lab-relay --reflect`）を立て、アプリの PLAY → Worlds に出る「LAN world」（lab / Dedicated Server's world）を選んで入ります。
  1.26 の新しい画面（PLAY など、Ore UI）はエミュレータではタップを受けず、**ゲームパッドで動きます**（`input gamepad`）:
  A で PLAY を開き、DOWN でワールドに焦点、A で入る。OCR があれば一押しごとに画面を読んで決め（前の実行が残したエラーや
  切断の画面は B で戻る）、無ければ A・DOWN・A。旧来のリンクの道は `APP_TRANSPORT=raknet`（中継 127.0.0.1:19132 経由、
  `APP_JOIN_VIA=direct` で直接）。
- **新しい人向けの画面**: 1.26 は、はじめての人に「Get started / More options」のタイトルや「Play your way」を出します。
  タップは効きませんが、ゲームパッドは効きます（上）。options.txt の `has_dismissed_new_player_flow:1` で従来のタイトル
  （Dressing Room・Profile）になるので、準備がこれを入れます。
- **ソフトウェア描画の重さ**: 2 CPU のランナーでゲームは毎秒 4〜6 枚しか描けず、一枚に数秒かかると Android が「GPU が止まった」
  （Buffer processing hung up due to stuck fence）として応答なしにし、参加の途中で止まりました。準備は、描き終わらない絵も
  待たずに使う設定（`debug.sf.latch_unsignaled=1`、`APP_LATCH_UNSIGNALED=0` で入れない）で画面合成を起動し直し、ゲームの
  描画を軽く（描画距離 4 チャンク・なめらかな光・雲・空・揺れなし・上限 20 枚/秒など、UI はそのまま。`APP_LIGHT_GFX=0`）します。
- **並行が既定**: `app ci` は実行ごとに別の列で起動して、待たずに戻ります（いくつでも同時に走る）。設定違いは
  `--try "APP_…=…"` を並べれば 1 本ずつ同時に（8 本まで）。同じ `--lane` の名前を付けた実行だけが順番に走ります。
- **キャッシュの上限（10 GB）**: 上限を超えると GitHub は使われていない順に消します。端末を作った実行で、最初に戻した
  エミュレータのキャッシュが消え、次の実行がその端末を起動できませんでした。いまは保存の前に `app tidy` が前の版の部品を外し、
  足りなければ端末の土台を諦めます（エミュレータと準備済みの端末は必ず残す）。エミュレータのキャッシュが無ければ、端末を
  作らない実行でも入れ直して保存します。
- **戻す時間**: 端末のキャッシュ（約 5 GB）は、取る（約 1 分）・展開・暗号を解く（約 1.5 分）に分かれます。暗号を解くのは裏で
  （`app open`）、その間にエミュレータのキャッシュを取ります。
- **まだ確かめられていないこと**: タイトル画面に届いた端末のスナップショットからの起動（数秒の見込み）、参加（Microsoft の
  サインインなしで BDS に入れるか）、ゲームのコンテンツログの有効化（options.txt のキー: `game-options.txt` に出る）。

## 確認済みの範囲

- 試験（`node tests/app-offline.mjs`）: 手順の読み取り、APK の読み取り、トークンの扱い、サーバーの版選び、成果物の検査、
  `app run` の全体（成功、参加できない、サーバーのエラー、サーバーが起動しない、ポートが使用中、途中で止めた、二重に起動した）、
  コマンドの打ち間違い。`--real` では **本物の BDS** にラボの本物のクライアントを参加させ、アプリの代わりに同じ流れを通しています
- **本物の Minecraft アプリとエミュレータでの動作は、作者の環境では確かめられていません**（KVM と APK が無いため）。
  「うまくいかないとき」の表の、ライセンス・サインイン・参加用リンク・確認画面の行は、実際に動かして初めて分かることです。
  最初の数回は `index.html` の画面を見てください
