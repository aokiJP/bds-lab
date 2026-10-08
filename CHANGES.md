# bds-lab の変更

## 次の版（作業中）
**app ラボを「ほぼクライアント」に: 本物のアプリをコントローラーで人のように遊べる（歩く・見回す・跳ぶ・壊す・置く・持ち物・チャット…）。
スマホの Discord から CI の端末を画面とボタンで動かせ、リポジトリの秘密も Discord のフォームで登録できる（node も PC も要らない）。**

### 管理パネル: 貸す人はずっと貸す・参加のお願い・エラーを減らす
- 貸す人は管理者でも知らない人でも **ずっと** 貸す（全部の仕事・一日中・期限なし・50000 分、止めるボタンなし）。持ち主の「フォークで貸している人」の「⏱ ずっと貸すに」も全員に。
- 知らない人は「🙋 参加をお願いする」（ラボの issue `[bds-lab 参加のお願い] <名前>`、出せないときは GitHub の画面）。持ち主の「メンバー」に並び、選んだ役割で招く・閉じる。「いまやること」にも。
- 招待が 422 で落ちていた: 個人のリポジトリには役割がないので、役割なし（書き込み）で招き直す（`MB.putCollaborator`）。
- 変数を GitHub に断られたら（403）、そのリポジトリには二度と聞かない（毎回のエラーが消える）。「いまやること」に権限の足りなさを 1 行。

### 管理パネル: 管理者はいつも貸す・フォークの全権限を持ち主に・いまやること
- ポリシーの `adminsLend`（このラボはオン）: 持ち主のほかの管理者は自分のフォークで **いつも** 貸す（全部の仕事・一日中・期限
  なし・50000 分）。貸すまでパネルは「まず時間を貸します」だけ（`may` を止める）、貸すと LAB_HOSTS に入れる。メンバーの役割の表に
  切り替え、持ち主の「メンバー」に管理者ごとの貸している印（`M.alwaysLends`・`M.adminLend`）。
- フォークの全権限をラボの持ち主に預ける: 「フォークで貸す」が持ち主を招き（`lendFork`）、ラボの App に administration: write
  （`APP_PERMISSIONS`、前の App は「準備」の「App の権限」が `GET /apps/<slug>` で足りないものとリンクを出す）。持ち主の
  「貸し借り」に「フォークで貸している人」: 招待を受ける・合わせる・全部合わせる・いつも貸すに・LAB_HOSTS に入れる/外す。
- hostrun の `host: auto` が LAB_HOSTS のホストごとにラボの App のトークンを作る（`hostTokens`・`useHost`: gh・git push・
  ダウンロードがそのホストのトークンで。鍵はすぐ消す。App の無いホストは LAB_HOST_TOKEN）。「実行」に「空いている貸し手で（auto）」。
- 「概要」に「いまやること」（`M.todos`）: ポリシーの誤り・続けて落ちる・まだ貸していない管理者・フォークの招待・古い秘密・
  最後の日が近い・LAB_HOSTS にないフォーク・新しい版を、悪いものから。

### 管理パネル: 知らない人は時間を貸すだけ・直したらすぐデバッグ
- 招かれていない人が入ると「使えません」ではなく「時間を貸す」（`ui/lend.mjs`）: **ラボのフォーク**（public・同じ中身）をホストに。
  ラボが `.github/workflows/host.yml`（ひな形と同じ: 試験で照合）を持つのでフォークにも入り、パネルが Sync fork・条件の
  .lab-host.json・host.yml だけを動かす（ラボのほかのワークフローは貸し手のところで止めたまま）。自分のフォークだけ、AI の仕事は
  貸せない。入ってからも概要・貸し借り・設定だけ。ラボは招かれなくても App でフォークに頼める（`M.canBorrow`、hostrun の App
  トークンは permissions を返さないので、作れたことを書き込める印に）。貸し手の「🔄 ラボに合わせる」。
- `node lab.mjs panel check [--quick|--all]`（`common/panel.mjs`）: 変えたファイルに要る ESLint・試験・本物のブラウザだけ。
  `panel shots` でタブごとの画像。Claude Code では編集のたびに `panel hook` が `--quick` を走らせ、落ちたらすぐ伝える（PostToolUse）。
- パネルの「設定」→「デバッグ」: このページの版（pages.yml が config.json に GITHUB_SHA）と出した版、エラーと最近の呼び出し
  （トークンは消す）、貼れる報告。エラーで右上に ⚠。新しい版が出たら「読み直す」。

### 管理パネル: さらに便利に
- 概要に「ワークフローの調子」（最近 50 件: 通った割合・かかる時間・続けての失敗、押すとその実行に: `M.workflowHealth`）。
- 秘密に登録した日。180 日以上そのままのものを並べて知らせる（`M.secretAge`）。
- 「進み具合」で、動いているものが 2 件以上なら全部止める（確かめてから、`run.cancel`）。
- 役割の表にひな形（管理者だけ・書ける人は実行も・保守の人は秘密とメンバーのほか全部: `MB.POLICY_PRESETS`、保存は手で）。
  招待中の人に渡すアドレスを写すボタン。
- キー: 1〜9・0 でタブ、/ で実行を探す、r で読み直す、? で一覧（文字を打っている間は効かない: `M.shortcut`）。

### 管理パネル: メンバーと便利に
- 「メンバー」のタブ（`panel/lib/members.mjs`・`ui/members.mjs`）: GitHub のユーザー名で管理者・保守・書き込み・整理・見るだけとして招く
  （知らない名前は送る前に言う、管理者は確かめる）・役割を変える・外す・招待を取り消す。持ち主と自分は変えない。ポリシーの `members`
  （GitHub の管理者だけ）。役割（ポリシー）をチェックの表で編んで `.github/bds-lab-panel.json` に（検査してから、管理者はいつも全部、
  チームの役割は残す）。監査ログに user・permission。App にはリポジトリの管理の権限を渡さない（貸し手のホストを守る）: App で
  サインインしているときは GitHub の画面へ。
- このラボのポリシー: 持ち主（管理者）だけが何でも。協力者を招いても、表で許すまでは何もできない。
- 便利に: 実行を探す・絞る（名前・枝・人／落ちた・動いている・自分の）、概要に「やり直す」「動いているもの」「落ちたもの」、
  実行が終わると端末に知らせ（ブラウザの通知かパネルの中）とタブの題に動いている数、ホーム画面に追加（manifest・アイコン、CSP は
  manifest-src 'self'）。ホストの実行の成果物は Discord に添えない（貸し手が書き換えられる）。

### 管理パネルの完全版（会社で使える: GitHub でサインイン・許可は App で自動・準備の自動化・役割と監査）
- **GitHub でサインイン**: ラボの GitHub App のユーザーのトークンで、誰でもボタン 1 つで（トークンを作る人はいない。できることは App が
  入ったリポジトリで GitHub がその人に許すことだけ）。小さなサインインのサービス `auth/`（`handler.mjs`: Cloudflare Workers と Node で同じ
  コード、`Dockerfile` で自分のサーバーにも）が OAuth を仕上げる: 何も保存しない。state は署名した値、URL に出ない乱数は `__Host-` の
  HttpOnly cookie にだけ、PKCE の verifier はその乱数から（callback のアドレスを見た人も替えられない）、戻る先は `PANEL_ORIGINS` の
  アドレス（パスの頭まで）だけ、トークンは URL の # で 1 回だけ渡す。パネル（`panel/lib/session.mjs`・`ui/signin.mjs`）はそのタブが
  始めたもの（nonce）だけを受け取り、すぐアドレスから消し、8 時間のトークンを切れる前に `/refresh` で（タブ 1 つずつ）、「出る」で
  GitHub で取り消す。トークンで入る道も残す（最初の準備）。
- **準備**（`panel/lib/setup.mjs`・`ui/setup.mjs`、「準備」のタブ）: Pages・サインインのサービス・App・App の導入・ワークフローを順に
  確かめ、ボタンで直す。App は manifest から 1 回のクリックで（権限は manifest に。鍵・client secret・署名の鍵はその場で封じてラボの秘密に、
  id・名前・client ID は変数に: ブラウザには残らない）。サービスは Cloudflare のトークンを入れれば `auth-deploy.yml` が置き、そのアドレスを
  `LAB_AUTH_URL` に、`pages.yml` がページに渡す（`common/panel-config.mjs`: `config.json` と CSP にその origin だけ）。直すボタンは
  管理者で、しかもポリシーが許すときだけ。
- **役割と監査**（`panel/lib/policy.mjs`・`audit.mjs`・`ui/audit.mjs`）: `.github/bds-lab-panel.json` で役割ごとにできることを狭める
  （GitHub が許さないことは許さない。正しくないファイルは何も許さない）、組織のチームで役割、確かめる操作、操作がないときの
  サインアウト。操作はその人自身のコメントとして監査の issue（ロック・900 件ごとに次へ）に: 他人のふりの記録は数えず、編集は印、
  秘密の値は入らない。「監査」で絞り込み・CSV（式にならないように）。
- **ワークフローは App のトークンで**: `common/ghapp.mjs`（App の JWT → そのリポジトリだけ・頼んだ権限だけの 1 時間のトークン、
  ログに出さず `$GITHUB_ENV` へ）。`hostrun.yml` は貸し手が App を入れたホストに、`secrets.yml` はラボの秘密に、個人の長いトークン
  （LAB_HOST_TOKEN・LAB_SECRETS_TOKEN）なしで。
- パネルはほかのページの枠の中では何もしない（クリックジャッキング）。CSP: 通信は GitHub の API・自分の config・サインインの
  サービスだけ、フォームは github.com だけ。
- 進め方: fanout（signin・admin の 2 レーン + 読むだけのレビュー。レビューの指摘 14 件のうち確実な 6 件と安く直せるものを直し役で
  直した: callback の盗み見・同じ origin のほかの Pages・nonce なしの受け渡し・URL のパス・直すボタンのポリシー・監査の押し出し ほか）。
- 試験: `auth-offline`（10）・`session-offline`（8）・`setup-offline`（10）・`governance-offline`（10）・`appci-offline`（4）、
  `panel-browser` に会社のラボの場面（本物の Chromium と本物のサインインのサービスで: GitHub でサインイン → 更新 → ポリシーが聞く →
  監査ログ → CSV → 準備で Pages と App → 鍵が封じて入る → 出ると取り消し → 書き込みの人には秘密を許さない。全部で 56 の確かめ）。
- 実物でしか確かめられないこと: GitHub の OAuth が PKCE と prompt=select_account を受けるか、App の権限の名前（actions_variables・
  members など）、Pages を App のトークンで変えられるか、Cloudflare に置いた `__Host-` の cookie。

### 管理パネル（panel/: 作者と、GitHub Actions の時間を貸し借りする人のための Web）
- 1 枚の静的なページ（GitHub Pages: `.github/workflows/pages.yml`。リポジトリだけで動く: 手元のサーバー `node lab.mjs panel` はやめた）。見る人の GitHub のトークンで
  GitHub の API とだけ話す（CSP で api.github.com のほかへは通信できない。トークンはそのブラウザの中だけ）。ラボに書き込める人・ホストの持ち主（貸し手）・
  ホストに書き込める人（借り手）のほかは「使えません」で止まり、何も読まない。
- それぞれの設定のまま: リポジトリの秘密の名前・ワークフロー・公開か非公開か、ホストの `.lab-host.json` から「できること」と「足りないもの」。
- 概要・進み具合（動いている実行は段ごとに、失敗は注釈まで。止める・やり直す）・実行（ワークフローの入力をその YAML から。すぐ始める型）・秘密（その場で
  リポジトリの公開鍵で封じて登録: libsodium の sealed box を JavaScript で、libsodium の出力で試験）・端末（Discord と同じボタン。公開リポジトリでは
  APP_CACHE_KEY でその場で封じ・開く: ランナーの vault と同じ形）・貸し借り（借り手: 今月の分と残り。貸し手: 条件を変える・今すぐ止める・再開）。
- Discord: `.github/workflows/notify.yml` + `app notify` が、終わった実行を DM（自分のボット）か LAB_NOTIFY_WEBHOOK に（結果・落ちたジョブと理由・ボタン。
  変数 LAB_NOTIFY: auto / all / failures / off）。端末のボタンの表は `panel/lib/pages.mjs` の 1 つ（Discord もパネルも）。
- **いくつものアカウント**（`panel/lib/accounts.mjs`）: 作者・貸し手・借り手のアカウントを 1 つのブラウザに加え（右上の ＋）、上で切り替える。
  トークンと設定（ラボ・ホストの一覧・読み直す間隔・APP_CACHE_KEY）はアカウントごと。覚えないものはそのタブの間だけ。「出る」はそのアカウントだけを
  消す。前の版の 1 つのトークンは最初のアカウントに引き継ぐ。貸し手の初めての訪問では、その人のホストを先に探す（「使えません」で止めない）。
- **どこの Actions で走らせるか**: 「実行」で、このラボの Actions か、貸し手のホスト（その人の Actions の分）かを選ぶ。ホストなら許された仕事・
  ユニット・結果を待つかを選んで `.github/workflows/hostrun.yml` を始め、ラボのランナーの `node lab.mjs host ci` が `host run` と同じ中身・検査で
  ホストに送る（秘密 `LAB_HOST_TOKEN`: パネルが足りないと言い、「秘密」で入れられる）。待てばホストの結果が、その実行の結果・まとめ・注釈・成果物
  （go の .mcaddon も）になり notify が知らせる。ホストから戻る行は `::stop-commands::` の中で出す（workflow の命令として読まれない）。
  「進み具合」もラボかホストかを選べる。
- **ホストの分は GitHub の数でも**: `host run`（と host ci）は、ホストの今月の分を自分の台帳と、GitHub が数えた host.yml の実行（誰の分も）の
  多いほうで見る。何人かが同じホストを借りても、台帳の無いランナーからでも 80% を超えない。走っている実行があれば始めない。
- **成果物を Discord に**: notify が、終わった実行の成果物から .mcaddon・.mcpack・.mcworld・.mctemplate を 10 MB まで添える（DM と Discord の
  Webhook。入らないものは名前とサイズ、「成果物」のボタン）。変数 `LAB_NOTIFY_FILES`（auto / off / 型）・`LAB_NOTIFY_MAX_MB`。このリポジトリの
  コードの実行だけ: フォークの PR の実行のファイルは渡さない。zip は欲しいファイルだけを、上限つきで開く。notify は hostrun・ai-make の後にも走り、
  手で `run` を入れればその実行を今送る（`app notify --force`）。「管理パネル」のボタンはその実行を開く（`#runs?repo=…&run=…`）。
- パネルの新しいタブ: 「成果物」（実行ごとの成果物、Discord に送る）・「Discord」（つなぐ秘密をその場で封じて登録・どの実行を知らせるか / 何を添えるか
  をリポジトリの変数に・試しに送る・いちばん新しい成果物を送る・端末と秘密のフォーム）。Fine-grained トークンが届かないホスト（ほかの人の個人アカウント）
  には、Classic トークンを使うよう、そのホストのところで言う。
- 試験: `tests/panel-offline.mjs`（14 本: アカウント・ホストで走らせる入力・アドレス・成果物の選び方と取り方・Discord への添付・フォークの実行）、
  `tests/panel-browser.mjs`（本物の Chromium で 40 の確かめ: 入れない人・作者・借り手・貸し手・2 つのアカウントの切り替え・貸し手の Actions で走らせる・
  成果物を Discord に・知らせ方の変数・Discord のリンクから実行を開く。CI の verify で）、`tests/host-offline.mjs`（`host ci` と GitHub の数）。
- `tests/play-bds.mjs`: `do` が繰り返す命令の行を答えと読まない（CI の本物の BDS で、where・items・face の答えそのものは正しく返っていた）。

### ゲームを人のように（app.txt と live）
- 端末のコントローラー（app/relay/lab-pad.c）にスティックとトリガーと「押したまま」: `LX=` `LY=` `RX=` `RY=`（-100〜100%）・`LT=` `RT=`（0〜100%）を
  置いたままにする、`+A` / `-A` でボタンを押す / はなす、`center` で全部はなす。`lab-pad --dry <ファイル> <語>…` は端末なしで入力イベントを
  ファイルに書く（試験が読む）。arm64 でも作れる。
- 手順（`app/lib/play.mjs`）: `walk` `sprint` `jump` `look` `sneak` `attack` `mine` `use` `place` `slot` `inventory` `drop` `cmd` `perspective`
  `pause` `stick` `release`。app.txt でも live でも同じ。スティックが要る手順は、コントローラーが無ければそう言って止まる。
- live（`app live` / issue / Discord）: ゲームの手順に加えて、app.txt の手順をその端末のまま 1 行ずつ（`chat` `tap text` `until text` `press` `hold`
  `mouse` `shot` `do` `perf` `network` `size` …）。`steps <<` で続けて、`step <1 行>` で live と同じ名前の手順。端末へファイルを送る `push` は不可。

### スマホから（Discord）
- `app hold`: 秘密 `DISCORD_BOT_TOKEN` と `DISCORD_USER_ID` があれば、その人の DM に画面と 25 個のボタン。押すたびにそのメッセージの画面が、
  その後の画面に変わる。DM に書いた文は live の命令。チャットと命令はフォームから。issue と同時に使える。Discord の接続は別のスレッドで
  （adb を待つ間も、押した合図に 3 秒以内に答える）。その人の DM だけ（サーバー・ほかの人・ボットは見ない）。
- `.github/workflows/secrets.yml` と `app secrets ask`: Run workflow → DM の「📝 入力する」→ フォームに書いて送る → リポジトリの秘密に
  （`gh secret set`、トークンは秘密 `LAB_SECRETS_TOKEN`: このリポジトリだけ・Secrets の Read and write）。値は届いた時点でログから伏せ、
  どこにも出さない。`名前=値` のメッセージでも（そのメッセージは自分で消す）。
- app.yml の常駐の端末（mode hold）でも `MS_EMAIL` / `MS_PASSWORD` を渡す（`signin` がそこでも使える）。
- 続けて: `move`（歩き続ける）・`turn`（視点を回し続ける）・`mine on|off`・`use on|off`、止めるのは `move stop` / `turn stop` / `release`。
- サーバーに聞く手順: `where`（場所・向き・体力・手のもの）・`items`・`face`・`lookat`・`goto <x> <z>`（向きを合わせて前へ、を繰り返す。進めなければ跳ぶ）。
  ラボのアドオンの js を `do` で送る（その js は `tests/play-bds.mjs` が CI の bds ジョブで本物の BDS と本物のクライアントで確かめる）。
  `do` が先に命令を繰り返す行（`> js …`）を答えと読まない。
- Discord: ボタンは 3 ページ（遊ぶ・メニュー・道具。切り替えは端末を待たずにすぐ）。道具のページからサーバーを立てて参加まで。`clip [秒]` の動画が
  DM に動画で届く。15 分を過ぎた押した合図には新しいメッセージで答える。gateway: 最初の心拍は間隔のうちの乱数の時点で、直せない閉じ方
  （4004 など）はつなぎ直さずに言う、READY の前に閉じたら起動のときに分かる。DM を送れない（50007）などは、何を直すかを添えて言う。
- 試験: `tests/play-offline.mjs`（17 本: コントローラーの入力イベント、手順、続けての手順、サーバーに聞く手順〔歩くと動く偽のサーバーで goto まで〕、Discord の REST と偽の gateway〔ページ・つながらないとき〕、秘密のフォーム、ワークフロー）・`tests/play-bds.mjs`（本物の BDS）と、
  `tests/app-offline.mjs` に偽の Discord（HTTP と WebSocket）で `app hold` を DM とボタンで動かす試験。

## v1.24.0 (2026-10-06)
**v1.23.0 に、v1.22.0 の上で進めていた redroid と fanout の作業を合わせた版。app/redroid を GitHub Actions なしで手元の Linux で回せるようにし、「戻す → 起動 → タイトル」（48〜50 秒）を削る手を入れた。AI の並行開発の仕組み（fanout）も入れた。秒数はまだ実機で計っていない（`node lab.mjs app redroid bench` の表で前と比べる）。**

### redroid（app/redroid/）
- 起動を待つ: 250 ms ごとに adb を起動し直すのをやめ、端末の中のループで待つ（20 秒ずつ、wait-for-device は 3 秒まで）。段階ごとの ms を notice に。前の端末の片付け（コンテナ・run フォルダ）は待たずに裏で、残りは次が掃く。`REDROID_PROFILE=fast`（1040x480@187・10 fps）。
- BDS を端末と並行に: `app run --device redroid` は app run をすぐ始め、BDS を上げてから端末を待つ（`APP_DEVICE_READY_FILE`）。APK は前回の版を先に使い、版が違えば取り出し直してやり直す。
- タイトルを待つ OCR を間引く: 窓が出てから、前回の titleS の 7 割（上限 10 秒）から 1〜1.5 秒おき（`REDROID_OCR_PACE=0` で前の読み方）。
- 準備（prep）: ゲームを先にコンパイル（speed）、バックグラウンドの dexopt を止める（起動の設定 `pm.dexopt.disable_bg_dexopt=true` も）、同梱アプリをもう 1 つ止める。Play・Play 開発者サービス・GSF は触らない。
- 常駐: 手元では run / ui の後も端末を残すのが既定（`--no-keep`）。`app redroid warm`。タイトルに着かなかった端末・途中で止めた端末は残さない。
- `REDROID_BOOST=1`: ゲームの起動中だけゲームを優先し、ライセンスに関わらない Google のもの（gms.ui・gapps）を後回しに。終わったら（Ctrl+C でも）元に戻す。
- `app redroid local [--dry-run]`: redroid.yml がやっていた準備（binder・イメージ・open / prep）を手元で 1 回に。
- `app/redroid/timeline.mjs`: bench の段階ごとの秒を .lab/timeline.jsonl に、前回・中央値との差の表。
- 試験: tests/rd-*-offline.mjs（8 本、偽の docker / adb で）。

### GitHub Actions
- 自動の契機は v1.23.0 のまま（verify は push と pull_request、redroid は app/redroid の push、auto・latest・bundle・maint は schedule、ai-make は issue）。redroid の作業中に一度すべて手動だけにしたが、戻した。fanout の `install` は Actions を変えない（手動だけにしたいときは `install --actions-off`）。

### AI の並行開発（fanout）
- `/fanout "<目標>"`（.claude/skills/fanout/SKILL.md）と `.fanout/fanout.mjs`: 計画 1 枚（担当のファイル・関数）、計画から作るプロンプト、土台から作る作業フォルダ、担当の外を見つける検査（scope）、統合の順。説明は FANOUT-README.md。
- .claude/settings.json: サブエージェントと worktree のツールを拒否から外した（1 ターンが少し重くなる）。
- **fanout がこのリポジトリの作業の既定に**: 司令塔（セッション）は Opus（settings の `model`）、子は Sonnet 約 6 割・Opus 約 4 割（`node .fanout/fanout.mjs models`: レビューと hard を先に、残りは重い順に Opus へ。計画の `mix` で変えられる。渡し忘れは `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`）。起動のたびに SessionStart のフックが進め方（`fanout.mjs brief`）を文脈に入れる。
- `node .fanout/fanout.mjs size [行数…]`: いちばん安く並行できる体数（1 体ごとの起動の分と仕事の量から。1 本 300〜1500 行相当、読む役は書く 4 本に 1 本）と費用の見積もり。1 体と出れば司令塔が自分でやる。

### 配布物の検証を調べられるように（fanout の回: 司令塔 Opus・子 3 体 = Sonnet 2・Opus 1）
- `share` の検証で落ちた試験の出力の全文を `<zip>.verify.log` に（秘密の検査を通し、当たった行は ***。長い行も・環境の秘密の値も伏せる。大きな出力でも書ける）。全部通れば作らず、前の回のものは消す。試験の実行器が落ちたときはその出力を。
- `tests/guards-offline.mjs`: 上の .verify.log と、本物の端末（`--device <名前>`）では `APP_DEVICE_READY_FILE` を読まないこと（統合で決めた振る舞い）を、偽の adb で app run を走らせて確かめる。
- `tests/colony-offline.mjs`: harvest の 2 つの確認が落ちたとき、見た記録（記事・結果・段階・理由）と harvest の出力の最後を出す。
- 分かっていること: `share` の検証の中で colony-offline の harvest の確認が時々落ちる（5 回中 2 回。単独・gate の並びでは 10 回以上通る）。原因は未確定で、次に落ちたら .verify.log に全文が残る。`common/colony.mjs` を非同期に書き換える案は、レビューで後退（止めた記事を「落とした」と記録する等）が見つかったので採らなかった。
- `node .fanout/fanout.mjs clean`: 統合したレーンの作業フォルダと枝を消す（全体のテストの前に。残すとラボの試験が写しまで拾う）。

### GitHub Actions の本物のランナーで見つけて直したもの（手元では通っていた）
- `ts try` の「最後の式の値」: TypeScript をラボの道具フォルダと NODE_PATH でしか探さず、`npm i -g typescript` だけの場所（新しいラボ・CI）では値が出なかった。node の global のフォルダとラボの隣も探す。
- `host run`: 送るために作る一時リポジトリで、git の自動の gc / maintenance が裏で .git に書き続け、消すときに ENOTEMPTY で落ちた。その一時リポジトリでは自動の gc を止め、消すときは少し待ってやり直す。
- BDS を入れる途中を、並べて走る別のラボのプロセスが「入っている」と見て、VERSION の無いまま読んで落ちた（ネットワークのある CI で時々 scratch-offline）。BDS は隣のフォルダに展開してから丸ごと置き換え、「入っている」はサーバーと VERSION の両方で見る（同時に 4 つ入れても全部通る。前のコードは 3 つで 1 つ落ちた）。
- BDS を入れると、版に結びついたキャッシュ（world・types・samples）を消していた。同じ版を入れ直したときや初めて入れたときも消し、並べて走る別の試験がちょうど読んでいる samples の git が失敗して、`check` の rp/ui の検査が落ちた（CI の skills-offline）。消すのは版が変わったときだけにし、検査は読めなければ「vanilla UI は確かめていません」の W 行にする（落ちない）。
- tests/rd-local-offline: root でない場所（CI）では open が `sudo -E` つきになる（正しい）のに、試験が root の形だけを見ていた。

### macOS で全部を通す（GitHub の macos-latest で初めて全部を回して見つかったもの。fanout: 司令塔 Opus・子 3 体 = Opus 2・Sonnet 1）
- app の暗号化キャッシュ（vault）: macOS の tar（bsdtar）は作るときの `--sparse` で落ちていた。GNU tar のときだけ付け、macOS では `._` ファイルを入れない（COPYFILE_DISABLE）。形式は同じなので前に封じたものも開ける。
- `app token`: `APP_LOGIN_HEADLESS=1` を OS によらず「画面なし」に（macOS では画面があると見てブラウザを開いて待っていた）。
- redroid: 裏で古いフォルダを消す `rm --one-file-system`・`mv -T` は GNU だけだった（macOS では残った）。並べて走る試験が同じ端末のロックを取り合っていた（Linux でも起こりうる）→ 試験ごとのロック（REDROID_LOCK）。
- 試験: 偽の Android SDK は手元の CPU（arm64 の Mac では arm64-v8a）に合わせる。偽の adb は `date +%N` の無い date でも動く。redroid の「端末を動かす」確認と型の検査が要る確認は、それができる場所（Linux・docker / TypeScript あり）でだけ。
- Endstone: 前の版の Python を指す venv（OS や toolcache の更新、別の 3.12.x のランナーから戻した CI のキャッシュ）を見分けず、作り直しも失敗して、全プラグインのサーバーが起動で落ちた（`server` は空の版で OK と言っていた）。venv は毎回動くか確かめ、動かなければ消して作り直す。`server` は版が読めなければ OK と言わない。CI のキャッシュの鍵に Python の版。
- macOS で型の検査: docker の無い macOS でも、手元の TypeScript があれば型を検査する（今までは「build tools unavailable」で検査しなかった）。
- end/plugins/webapi の試験: `until こんにちは web` がサーバー自身のログの行で満たされ、プレイヤー A の画面に届く前に確かめて、時々落ちた（CI で 3 回に 1 回）。待つのは確かめるものそのもの（`until @A …`）。
- 試験: cli-offline と offline は同じ `.lab-kind` を読み書きするので並べない。rd-title は落ちたとき launch の結果を全部出す。
- verify: コミットのメッセージに `[full ci]` で、push でも macOS・Endstone・LeviLamina まで走る。プラグイン・mod は 1 つ落ちても全部を試してまとめて言う。

### 公開リポジトリでも private 並みの安全さ（private の前提を消した。fanout: 司令塔 Opus・子 4 体 = Sonnet 2・Opus 2）
- 暗号化キャッシュ（APK・BDS・Play ストア・準備済みの端末・redroid の /data）は、鍵（Secrets の `APP_CACHE_KEY`、無ければ `GOOGLE_AAS_TOKEN`）があれば公開でも使う。形式は変えず、前に封じたキャッシュも開ける。鍵が無ければ使わない。
- 成果物: private でないとき、app と redroid のジョブは上げる前に `node lab.mjs app checks --seal <フォルダ>` で中身を `results.sealed`（AES-256-GCM）にし、平文は `summary.json`（合否・手順の数・落ちた番号・秒数・版）だけ。封じられなければ中身は上げない（上げるのは封じたステップが通ったときだけ）。`app ci watch` が手元の `.env.local` の鍵で開く（`app checks --open <フォルダ>`）。
- 公開されるもの: チェック・注釈・ジョブの要約・app run のログは合否だけ（画面の文字・ログの行・スクリーンショットは封じた成果物に）。封じていない run がチェックに来ても要約だけ。redroid の report も合否だけ。
- ライブの issue（`app live`）: 命令・返事（画面の PNG も）・2 段階の確認の番号を vault の鍵で封じる（`lab-sealed:v1:`、AAD つき、開けないコメントは命令にしない）。手元は `gh repo view` で公開かを確かめ、鍵が無ければ書かずに止まる。Actions で公開かが分からないときは公開として扱う。返事の大きさはバイトで数える（日本語でも 65,536 字に収まる）。
- ワークフロー: app.yml の `PRIVATE` の条件と警告を外した（gpdl・SDK のキャッシュは秘密を含まない）。redroid.yml の private の条件も。hold の 2 つのステップに鍵を渡す。
- `bundle.yml` は private のときだけのまま（Mojang の BDS を配るのは公開では許されないため。安全のためではない）。

### 合わせたところ（v1.23.0 との統合）
- `app run` の始まり: v1.23.0 の自分の端末（`--device <名前>`）と、redroid debug が端末を並行に用意する道（`APP_DEVICE_READY_FILE`）の両方を残した。本物の端末のときは `APP_DEVICE_READY_FILE` を読まない（redroid だけのもの）。
- AGENTS.md: v1.23.0 の「Other」の行（colony harvest・host）に fanout の規則を足した。.gitignore: 借りたアドオン（`bds/addons/borrowed_*/`）と fanout の計画・作業フォルダの両方。
- 別の zip（bds-lab-extras）のファイルはこの版にも入れた（extras.json つき。bds-lab のコマンドからは呼ばれない）。
- 試験: tests/rd-local-offline の偽のトークンが share の秘密の検査に当たってリリースが作れなかった → 文字列を分けた。tests/cli-offline の app token の試験が、環境に本人の GOOGLE_* があると落ちた → この呼び出しでは空にする。
- 確かめたこと: 全オフライン試験 49 本（`node lab.mjs auto gate --all`、rd-*-offline の 8 本を含む）・`node .fanout/fanout.mjs selftest`（16）・share の検証（配布物を単独で展開して gate）。v1.23.0 の配布 zip は履歴の v1.23.0 から 1 バイトも違わず作り直せる。
- まだ確かめていないこと: redroid の秒数の実測（binder のある手元の Linux で `node lab.mjs app redroid bench`）、本物の端末・本物のサイト・本物の貸し手での動き（v1.23.0 から）。

## v1.23.0 (2026-10-06)
**自分の Android 端末（root あり・なし × USB・Wi-Fi）で app ラボを、他の人の配布アドオン（最新の BDS で動くものだけ）を借りて直して学ぶ道を、知り合いが貸してくれる GitHub Actions の時間でラボの試験を。**

### 自分の端末で app ラボ（`node lab.mjs app device …`、`app run|ui --device <名前>`）
- `app device` は adb に見えている端末を並べるだけで、**登録していない端末では何も実行しない**。`device add <名前>` が読むだけのコマンドで調べて（つなぎ方・Android・CPU・root（adbd か su）・ゲームの版・画面・ネットワーク）、使う道を決めて理由と足りないことを言う（`device path` で調べ直し）。
- 参加はゲーム自身の LAN の見つけ方で: 端末と PC が同じネットワーク（Wi-Fi・USB テザリング・端末のホットスポット）なら root も中継も要らない。adb の転送は TCP だけでゲームは UDP なので、同じネットワークが無いときは何をすればよいかを先に言う（テザリング・ホットスポット・ゲスト Wi-Fi の隔離・WSL2 の mirrored・Microsoft のサインイン）。端末から PC へ ping が届くかも見る。
- ゲームは端末に Play ストアで入れたもの（ラボは APK もアカウントも入れない）。BDS はその版に合わせる。
- 操作: root があればエミュレータで確かめたラボのコントローラー（uinput）。**lab-pad を arm64 でも動くように**（x86_64 と arm64 のシステムコール、カーネルのヘッダーを使わない `app/relay/lab-uinput.h`: 試験でカーネルの値と突き合わせる）。arm64 用は Android NDK・zig（`pip install ziglang`）・cross gcc・clang+lld のどれかでこの PC で作る（lab-relay も NDK・zig・cross gcc で arm64 に）。root が無ければ adb の入力で、ボタンは長押し（ゲームは 1 フレームに 1 回ボタンを読む）。
- run の間だけ画面を点けたまま・通知の帯をデモ表示・おやすみモード（`APP_DEVICE_QUIET=0` で変えない）。**変える前の値を先にファイルに書く**ので、途中で殺された run も次の run か `device restore` が元に戻す（読めなかった値には触らない）。ゲームは run が起動したときだけ止め、置いたものは消す。画面の形・回線を変える手順（size density cutout network、`ui --sizes`）は使わない。画面がロックされていれば解除を待つ（PIN は打たない）。
- Wi-Fi: `device pair <IP:ポート>`（Android 11 以上。6 桁のコードはその場で聞いて使うだけで、どこにも残さない: 試験で全ファイルと出力を探す）・`device connect`・`device tcpip`（Android 10 以下）。ワイヤレス デバッグはつなぐたびにポートが変わるので、端末のシリアル番号（mDNS の名前にも入る）で探してつなぎ直す。`device tether`（USB テザリングを adb から試す）・`device restore [--wifi-off]`・`app screen|tap --device <名前>`。
- 報告に「道」（root か・USB か Wi-Fi か・入り方・操作・ログ）と、コンテンツログを読んだ場所（外部の保存先・内側・読めなければ logcat のゲームの行: 参考）を書く。
- 戻すところを固く: 戻せなかった設定（Wi-Fi が切れた等）は記録に残して `device restore` が続きから（全部戻ったときだけ記録を消し、失敗なら終了コード 1）。値は端末のシリアル番号つきで、別の端末には当てない。戻す値が残っている端末は `device forget` しない（端末が無いなら `--force` で値ごと）。読めなかった値・空の値には触らない。デモ表示は SystemUI がまだ受けるうちに先に抜ける。
- 端末の su の形（Magisk などの `su -c`・AOSP の `su 0`）を覚えてその形で動かす。端末の logcat は消さず run の始まりから読み、run の前からあったコンテンツログはこの run のものにしない。許可のダイアログは押さない（人が押すのを待つ）。ラボが置いたものは run がどう終わっても消す。adb には秘密の環境変数を渡さない。
- Wi-Fi: `device tcpip` は Wi-Fi（とホットスポット）のアドレスがあるときだけ切り替える（モバイル回線・VPN には切り替えない）。`device connect`・`pair` が登録していない端末で読むのはシリアル番号だけ。ペア設定のコードは adb の標準入力へ（プロセスの一覧にも出ない）。mDNS で探すのは同じ IP のものだけ。Wi-Fi から USB に戻った端末もシリアル番号で見つけ、`restore --wifi-off` の後は USB で探す。
- 同じネットワークが無いときの案に、Tailscale・VPN などで届くなら `APP_TRANSPORT=raknet APP_HOST=<アドレス>`（アドレスで参加）。

### 他の人のアドオンを借りる（`node lab.mjs colony harvest`）
- アドオンのカテゴリから、**種（--seed）で決まる無作為な**ページと記事を、**一度も見ていないものだけ**取り、最新の BDS でそのまま動くものだけを `bds/addons/borrowed_<記事>` に残す: この BDS に無いモジュールの版が無い（brief）・パックの JSON（check）・下書きの試験（入口を 1 回ずつ）が本物の BDS で E 行なしに通る（sim は目安として記録。`--sim-only` はそう言う）。
- 取る前にふるう: Java・ボタン無し・知らないファイルの置き場・古い版の記事。RISK のあるもの（HTTP の送信・/op・eval・難読化）は動かす前に落とし、スクリプトの無いものは `--any` のときだけ。アクセスは今の礼儀のまま、1 回の上限（`--max-requests 40`）を数えて言う。
- **見た記録 `auto/borrowed-seen.jsonl`**: 記事の番号・ファイルの sha256・パックの UUID と版・残した/落とした・段階・理由（中身は入れない）。同じ記事も、同じファイルの再投稿も二度と取らない。`--retry` は新しい BDS で、落とした中で BDS が変われば変わりうるもの（brief・check・sim・real）だけを試し直す。
- 残したものは作者のもの: imported.json の `borrowed`（記事・作者・**記事に書かれた決まり**（二次配布・改変・クレジット…、コメント欄は読まない））・borrowed.json（判定）・元のファイルを読み取り専用で（sha256 つき）。`colony borrowed`・`colony diff`（元からの差分）・`colony borrow <file>`（ほかのサイトから手で取ったファイルに同じ判定）。
- **配る道はすべて止まる**: `share`（見本に入れても）・`ship`・`publish`・`bundle`（`--skip-borrowed` で除いて作る）・`host`。.gitignore にも入れた。本物の BDS で、動くもの（DONE までの判定）と読み込みで落ちるもの（real で落とす）を確かめた。
- 判定の途中（数分）のユニットにも、取り込んだその時に借りたものの印を付ける。印のほか名前（`borrowed_…`）と元のファイル（`.borrowed/`）でも見分けるので、途中のものも配る道で止まる。Ctrl+C・kill で止めると、判定中のユニットとダウンロードを消し、今のユニットを戻す。
- すでにある `borrowed_<記事>` は消さない（その記事は飛ばす: 手を入れたものかもしれない）。手で借りたものは `borrowed_m_<名前>`。記事の番号は数字だけを受け取る（消すフォルダの名前になるので）。
- .mcpack を束ねた .mcaddon（上に manifest.json が無い、よくある形）もアドオンとして判定する。`--retry` でも別の記事の同じファイル・同じパックは見たものとする。`--fresh` でも記事のページは 1 回だけ取る。
- `colony diff` は他の人の zip の名前（`../`・絶対パス・中の .mcpack の名前）で展開先の外へ書かない。印の original がユニットの `.borrowed/` の外を指していれば従わない。

### GitHub の時間を借りる（`node lab.mjs host …`、docs/guide/host.md）
- 貸し手は自分のアカウントに host/template から private のリポジトリを作り（`host template`）、あなたを collaborator に招き、`.lab-host.json`（1 か月の分・許す仕事・時間帯・最後の日・連絡先）を書く。ラボは**あなた自身の gh のログイン**で使う（アカウントを増やさない・貸し手にログインしない・鍵を受け取らない）。分は貸し手（リポジトリの持ち主）に付く。
- `host add`（書き込めるか・決まりが正しいか・host.yml がひな形と同じか）→ `host run <job> [-a <unit>]`: ラボ（リリースと同じ中身、ラボ自身の CI は入れない）とユニットを `lab/run-<番号>` に送る → host.yml を始める → 待つ → 結果（JSON と伏せ字のログ）→ 請求される分を `auto/host-ledger.jsonl` へ → 枝を消す。途中で切れても `host results` が続きから受け取る。
- 予算: 上限の **80%** で止める（今月の分 + この仕事の見込み）・同じホストで 1 つずつ・許す仕事・時間帯・期限の外では頼まない・月の区切りは貸し手の時間帯で。止まったら理由と、ほかのホストか自分の場の案を出す。
- 送る前の検査: share と同じ秘密の検査、`.env`・鍵・BDS の zip・借りたアドオン・app ラボの結果・大きすぎるファイル → 何も送らずに止まり、ファイルを言う（秘密そのものは出さない）。ホストの側でも既定の枝の `.lab-host.json` で仕事・時間帯・期限を確かめる（host.yml: workflow_dispatch・`contents: read`・SHA 固定・入力は env だけ・actionlint）。
- `host report`（貸し手への月の報告: 数だけ。`--issue` は確かめてから書く）。自動操縦: `auto policy gateOn=auto|<owner/repo>` でラボ自身への変更の gate をホストで（落ちたか使えなければ手元の gate が決める）、`auto gate --on`、`node lab.mjs auto` にホストごとの分。
- 貸し手の側を固く: 403/404 は 2 回続けてから使わなくする（1 回目はその回だけ。また見えれば使う）。レート制限・組織の SSO・回線の不調は貸し手のせいにしない。書き込めない・アーカイブされた・`.lab-host.json` が無いか正しくない → 直るまで止める（前の決まりで続けない: 貸し手が止めたのかもしれない）。
- 実行を「無くした」とするのは GitHub が「無い」と答えたときだけ。見つけた実行の番号は台帳に書き、次からはそれを見に行く。
- ラボ自身の CI は `.lab-github/` に入れて送る（GitHub はそこから何も始めない。ラボの試験はそこも読む）: ホストで gate が通る（送る中身そのもので lint-offline を確かめる）。ホストの gate はあなたの `auto policy` の一覧。
- ユニットのファイルも share が配らないものは送らない。`.env.*`・鍵（.pem .key .p12 .pfx・SSH の鍵）・認証のファイルで止める。秘密の検査は名前によらず小さな文字のファイル全部（.mcfunction も）。host.yml からキャッシュを外した（貸し手の場に前の run のものを残さない）。

### ほか
- BDS が落ちた直後（終わりがまだ見えていないとき）にコマンドを送ると、書き込みの EPIPE でラボごと落ち、「落ちた」と報告できないことがあった（tests/offline.mjs が時々落ちた）: 送り先が無ければ書かない。
- `brief`（`import` の後も）が「この BDS に無いモジュールの版」を、BDS をまだ入れていないラボでも言う（版の表はサーバー無しで分かる。型の検査だけがセットアップを要る）。リリースを展開しただけの場所で、harvest がよその版の beta を残していた。

### 確かめたこと
- オフライン試験 全 40 本（`node lab.mjs auto gate --all`）が通る: device-offline 23・colony-offline 84・host-offline 18・app-offline 98・offline 68 ほか。見直しで直したところ（上の各節の「固く」）にはそれぞれ試験を足した（偽の adb・偽の gh・偽のサイトで。外へは 1 回もつながない）。
- ESLint（バグだけを見る設定）でリポジトリ全体、actionlint で host.yml。ホストへ送る中身そのもので lint-offline が通ること。
- 本物の BDS 1.26.52.3: `tests/dev-bds.mjs`、`colony borrow` の判定（動くものは本物の BDS の試験まで通って残り、読み込みで落ちるものは real で落ちる）。
- arm64: lab-pad と lab-relay を zig・clang+lld で作り、qemu-aarch64 で動かした。lab-pad の uinput の値はカーネルのヘッダーと一致。
- まだ確かめていないこと（あなたの PC で）: 本物の端末での 4 つの道（root あり・なし × USB・Wi-Fi）、本物のサイトでの `colony harvest`、本物の貸し手のリポジトリでの `host run`。

## v1.22.0 (2026-10-06)
**クラフターズコロニーの配布物を扱う `colony` を戻して、本物のワールドが読めるようにした。使われていない部分は別の zip へ、内側のループ（sim・試験・CI）は速く、見本は直した。**

### colony（戻した・コマンドにした）
- 1.21.0 で外した sandbox-be/src/colony/ を戻し、`node lab.mjs colony search|new|cats|show|get|inspect|repack|convert|install|packs|import|voxel` にした（`help colony`）。他の人が配っているワールド・アドオンを探して、取って、中を見て、ラボのユニットにして `go` まで。
- **本物のワールドが読めなかった**: LevelDB の圧縮 4（raw deflate）と内部キー（後ろ 8 バイトの番号と種類）を読めず、BDS 1.26.52.3 が書いたワールドでキーが 0 個だった（→ 746 個）。ログ（WAL）も Mojang の leveldb どおりに読む。Bedrock の level.dat（8 バイトの頭）を Java の NBT と取り違えていた。
- zip: 展開先の外へ出る名前（`../`）は何も書く前に拒む。古い日本の zip の Shift_JIS の名前を読む。CRC を確かめる。
- Windows の新しいゲーム（GDK、1.21.120 から）のワールドの置き場 `%APPDATA%\Minecraft Bedrock\Users\<n>\…` を先に探す。
- サイトへは読むだけ、礼儀正しく: 2.5〜5 秒に 1 回、実行をまたいで 1 時間に 80 回まで、ページは 1 時間とっておく（`--fresh`）。いいね・カウント・コメントは一切しない。試験はサイトに 1 回もつながない（46 項目）。
- `colony voxel`: スポーンの周りの地形をサンドボックスのコースにする（SpawnY 32767 = その場所の地面）。投稿の題・人数・クリアの時間がコースに入る。

### 外したもの（消さずに別 zip `bds-lab-extras-v1.22.0.zip`）
- sandbox-be の学ぶ頭（src/play/agent/ の 9 個）・目標探し・物理の突き合わせ・PvP・bedrock-binary の link-check: どのコマンドからも呼ばれていない（全オフライン試験のカバレッジと参照の検索で確かめた）。bds-lab の一つ上で展開すれば元の場所に戻る。
- app/lib/bb（bedrock-binary の zip・axml の写し）: 本物の bedrock-binary を使う。
- 試験で毎回書き換わる bds/docs/verbs の実行ログと、この機械のキャッシュを指す tsconfig をコミットしない。
- ESLint（バグだけを見る設定、CI にも）・pyflakes・shellcheck・actionlint で、死んだコードと使われない import を消した。
- **`update` が古いリリースのファイルを残さない**: リリースに common/data/shipped.json（入っているファイルとその要約、外したファイル）を入れ、`update` は前のリリースにだけあって手を入れていないファイルを消す（手を入れたもの・自分のアドオン・鍵・extras.json に載ったものは残す）。古い版の `update`（1.21.0 まで）は何も消さないので、その残りは `maint` の新しい項目「古いリリースにだけあったファイル」が知らせ、`maint --fix` か同じ zip でもう一度 `update` で消える（`share` がそれを配り直すこともなくなる）。
- extras の zip は戻したファイルの一覧 extras.json を持つ。`update`・`maint` はそれを消さず、`share` は extras.json を配らない。

### 速く
- **sim が 2〜4 倍速く**: サンドボックスの 1 回の実行 約 700 → 約 400 ms（スクリプトを呼ばない tick の段を、時間切れの見張りつきの 1 回の呼び出しにまとめた: 1 回の実行で 3,500 回 → 約 1,000 回。実測データは読み直さずに渡す）。節の単独の実行を横に並べ、全部をつないだ実行はそれぞれのフォームの答えから始める（見えたボタンで確かめ、違えば答え直す）。teleport_menu 22.7 → 5.0 秒、fishcup 12.0 → 2.6 秒、shop 7.7 → 1.8 秒。結果は見本 12 個で前と同じ。
- `js` の行: アドオンのスクリプトが「この起動か最後の /reload から」あるかで見る（戻ってこなかった /reload の後は `js` 1 行ごとに 30 秒待っていた）。偽のサーバーでの QA 57 → 26 秒。
- 偽のサーバーがラボの同期の合図・プロファイラ・診断に答える（1 回 8 秒の待ちが消えた）: env-offline 404 → 202 秒。
- app ラボの試験: 偽の端末の固定の待ちを `APP_TIME_SCALE` で縮める（期限はそのまま）: app-offline 1205 → 575 秒（98/98）。
- sim-offline 19 → 10 秒、scratch-offline 43 → 31 秒。

### GitHub Actions の分を無駄にしない
- 毎時の自動操縦: 準備（BDS・npm）の前に `auto plan` でやることがあるかを決め、無ければ準備しない。AI の無い harden は選ばない。失敗が続く upkeep は間を空ける（最大 7 日）。
- BDS の同梱（bundle）は、BDS かツリーが変わったときだけ上げ直す（毎日同じものを上げていた）。
- 自動操縦の記録（auto/）だけの push では verify を走らせない。
- CI: オフライン試験を全部 1 つの手順で横に並べ（`auto gate --all`）、落ちた試験の行をそのまま出す。

### 見本と文書
- **coins の「1 日 1 回」が日本では朝 9 時に切り替わっていた**（UTC の日付だった）: サーバーの地方時の日付に。関係のない `/lab:shop` の残りを消し、再起動の後も今日の分は済んだまま・次の日はまたもらえる、を試験に足した（本物の BDS で DONE）。`update` は手元にある見本を自分のものとして残すので、直した coins が欲しいときは bds/addons/coins をよそへ移してから `update`。
- どの見本の TASK.md にも受け入れ条件を書いた（それぞれどの `##` 節が確かめるか）。teleport_menu は、レシピが言うとおり直したところを並べた。
- 見本の使われない import を消した（fishcup・lamp・wand。本物の BDS で DONE）。
- ユニットの tsconfig.json に baseUrl を書かない（TypeScript 6 のエディタと tsc でエラーになり、7 で無くなる。paths はこのファイルからの相対で同じ）。
- QA: 足しも消しもしない Map / Set（`const FISH = new Set([...])`）は「再起動で消える状態」ではない（fishcup で出ていた）。
- `help ideas` に Endstone の report と LeviLamina の warps: スキルの規則が「help ideas にある」と指していたのに一覧に無かった（AGENTS.md の数も 19 → 20、13 → 14。数がずれたら share-offline が落ちる）。
- 文書の古い数: `maint` の健康診断は 19 項目（colony と古いリリースの残りを足した。文書は 13・17 と言っていた）。
- import・scan: 日本の Windows で作った zip の Shift_JIS の名前を読む。
- 試験に人の入口: `ui`（鍵・Host・許すコマンド・出力の流れ）と `start`（端末でないときは手順をコマンドで出す）。ゲートは 27 本。

### 確かめたこと
- オフライン試験 38 本すべて（`auto gate --all`、2 コアで約 15 分）。本物の BDS 1.26.52.3 で `tests/dev-bds.mjs`（go・why・shrink・chaos・gaps・record・harden・mutate の 18 項目、823 秒）と、変えた見本 4 つの `go`。
- ESLint（バグの設定）・pyflakes・shellcheck・actionlint・`bds/bench/github-smoke.mjs`（偽の gh）が通る。
- 確かめていないこと: クラフターズコロニーのサイトそのもの（この環境からはつながらない。試験は偽のサイト）。common/nethernet-connect/dist は今回も無い（`lan` はそれを入れるまで SKIP）。

## v1.21.0 (2026-10-05)
**GitHub の main と 1.20.0 の配布 zip を 1 つにまとめた完全版。** 中身は main（1.20.0 に枝を三方向でまとめたもの）を土台に、1.20.0 の zip にしか無かったものを 1 つずつ確かめて、要るものは残し、どこからも使われていないものは外した。

### 外したもの（1.20.0 の zip にだけあった、どこからも読まれないファイル 14 個）
- sandbox-be/src/colony/（world・tovoxel・leveldb・nbt・subchunk・packs）: 互いに読み合うだけで、本体のどこからも import されない（同じフォルダの site.js・zip.js は使われているので残す）。
- sandbox-be/src/play/agent/（gen・lanes・planner・prior）、play/discover.js・physics-compare.js・play/pvp/: 本体のどこからも使われない訓練用の残り（訓練用は別配布 training/）。
- bedrock-binary/src/report/link-check.js: どこからも使われない。

### 強化
- **ゲートを並列に**（common/run-tests.mjs、新規）: `auto gate`・自動操縦のゲート・`share` の単体再試験が試験を横に並べて走らせる。2 コアの機械で 25 本が **8 分 28 秒 → 1 分 32 秒**。ラボのフォルダを共有する試験（make・ci・app）だけは他と並べず後で 1 本ずつ。`LAB_GATE_JOBS=n`（1 で従来通り）、`auto gate --jobs n`。
- **`auto gate --all`**: ゲートに加えて tests/ のオフライン試験を全部（3 つのラボの通し・app・lan・login・env・…）。所要時間も出す。
- **ネットの無い所の QA が速く**: 本物のプレイヤーの部品（bedrock-protocol）の取り込みが一度失敗したら、その実行の中では次の `@X join` で npm をやり直さない（QA 1 回で 4 回、試験ではもっと npm を待っていた）。
- **app ラボの試験がこの機械の tesseract に左右されない**: tesseract が入った機械では、偽の端末の画面を本物の OCR が読んで（「Wf」など）LAN の参加が外れ、app-offline の 7 項目が落ちていた（CI には tesseract が無いので気づかれなかった）。試験は頼んだときだけ偽の tesseract を使う。
- `app annotate` の OCR が `APP_TESSERACT` を見ていなかった（実行と同じ tesseract を使う）。
- lan-offline: common/nethernet-connect/dist が無いときは失敗ではなく SKIP（`LAB_REQUIRE_LAN=1` で従来どおり失敗）。
- 試験用の偽サーバー: reload の後はラボの eval の助け手として `js` に答える（答えないので `js` 1 行ごとに 30 秒待っていた）。

### main の未リリース分（1.20.0 の上に、このリポジトリの枝をまとめたもの）
**本物の Android アプリでアドオンの JSON UI を確かめる app ラボが、GitHub の非公開の端末で通るようになった（jsonui_demo の app.txt が PASS、Microsoft のサインインなし）。**（枝 claude/relaxed-allen-lw44i9・main・addon/ts_repl を 1.20.0 に三方向でまとめた。設計と実機で測った数字は app/DESIGN.md）

### 実機での参加（app/）
- **1.26 の BDS は NetherNet しか受けず、アドレスでの参加は Microsoft のサインインを求める**。そこで BDS を NetherNet の LAN で立て（`LAB_TRANSPORT=lan`）、アプリは PLAY → Worlds の LAN のワールドから入る。端末の中の中継（app/relay/lab-relay.c）が 19132 を運び、`--reflect` がゲームの UDP 7551 の発見の放送をホストへ送り直す（出ていくパケットは ETH_P_ALL の packet socket にしか見えない: ETH_P_IP では 1 つも拾えていなかった。端末の tcpdump で分かった）。
- **端末に本物のコントローラー**（app/relay/lab-pad.c: uinput の Xbox コントローラー、C ライブラリなしの 10 KB、ラボが cc で作りコミットしない）。ボタンは 500 ms 押し続け、方向はキーイベントで（毎秒 4 コマの端末では、ゲームがボタンと D-pad を 1 コマに 1 回しか見ないので短い押しは消えた）。
- **ワールドの無い人は Play で新しい人の流れへ行く**ので、準備で自分のワールドを 1 つ置く（app/lib/world.mjs: 平らなクリエイティブの level.dat を little-endian NBT で書く）。PLAY では白い焦点の枠で LAN のワールドのカードを選び（「A Play」は両方のカードに出る）、参加の 2 つの質問（オンラインのレーティング、リソースパック）は A。`until joined` は、サーバーの Player Spawned の後もアプリの読み込みの画面が消えるまで待つ（その間に送ったフォームは出なかった）。
- **Microsoft のサインイン**（フレンドのワールド・アドレスでの参加に要る）: 秘密 `MS_EMAIL`（と `MS_PASSWORD`）があれば準備でサインインしてスナップショットに残す（app/lib/signin.mjs）。値は端末の標準入力で打ち、どこにも出さない。二段階の確認はライブの issue で（承認の番号、`code 123456`）。実機での確認はまだ（アカウントが要る）。
- コンテンツログ: 設定 content_log_file:1 でファイルが無いのは「1 行も出ていない」（1.26 は最初の 1 行でファイルを作る）と報告する。

### 速さと CI
- 準備済みの端末（ゲームがタイトル画面のスナップショット）・APK・Play ストア・BDS を、**private のリポジトリだけ**、AES-256-GCM で暗号化してキャッシュ。戻すのは 8〜22 秒、タイトルまで 7 秒。取り出しの時間切れ（10 分）で端末を作り直していたので 30 分に。
- **常駐の端末と `app live`**: CI の端末を issue のコメントの命令で動かす（コミットも作り直しも無し。命令は実行した人のものだけ、効くのは端末だけ）。`run` / `ui` / `pull` / `world` / `signin` / `seal`。終わらない端末のコマンドで固まっていたので adb は期限に SIGKILL。
- Android の応答なしの判定を 5 倍（`ro.hw_timeout_multiplier`、遅い端末向けの Android 自身のつまみ）、画面はエミュレータ側で撮る、OCR を減らす、描画を軽く、など 20 の工夫（それぞれ外すつまみ付き）。
- 試験：app-offline 87 項目（サインインのページ、自分のワールド、LAN の参加の質問と焦点の枠、読み込みの待ち、放送の送り直しを root で、など）。

### 1.20.0 の不具合の修正
- **verify.yml が一度も動いていなかった**：end・ll のジョブの `if` に `hashFiles`（ジョブには使えない）があり、ファイル全体が無効だった（actionlint で確かめた）。手順の中へ移した。あわせて push と PR では Linux（offline と bds）だけ、macOS・Endstone・LeviLamina は手で起動したとき（private のリポジトリで macOS は 10 倍、Windows は 2 倍の分を使う）。
- `skill prompt --budget`：残りのスキルの名前の行を予算に数えていなかった（9000 バイトの指定で 9232）。名前の行も含めて収まるまで最後のスキルを外し、空いたところに入る小さいものを入れる。試験は予算そのもの（≤ 9000）で見る。
- `doc`（語なし）：使い方を出す前に BDS を取りに行き、ネットの無い所では使い方の代わりにダウンロードの失敗を出していた。
- `publish`：アドオンの中の `.lab/`（BDS を取れないときの型の代わり offline-types.d.ts）を写してから「公開しない」と止まり、公開そのものが出来なかった。`node_modules/`・`build/` と同じく写さない（止める網はそのまま）。
- bds/bench/github-smoke.mjs：もう無い bds/AGENTS.md を写そうとして、始まってすぐ落ちていた（verify が動かないので誰も気づかなかった）。いまある help.md・README.md を写す。github・ship・publish の 11 項目が通る。
- verify の lan-offline：要る common/nethernet-connect/dist（nethernet-connect の配布物）がこのリポジトリにも 1.20.0 の zip にも無い。無いあいだは実行の警告として出し（取り込み方つき）、あれば走る。

### その他
- addon ts_repl のリリース。.claude/settings.json は、利用者の allow（`node lab.mjs`・`gh`・`git`）を 1.20.0 の deny と合わせた。

## v1.20.0 (2026-10-04)
**毎ターンのトークンを減らし、要るものは要る瞬間に出す。CI と秘密の扱いを企業向けに固めた。**（トークンは `@anthropic-ai/tokenizer` での概算）

### トークン
- **AGENTS.md 2,539 → 1,818 トークン（-28%）**：毎ターン送り直される唯一の文書。同じ内容を短く言い直し、作業の途中でしか要らないことはコマンドの出力へ移した。スキルの規則のうち AGENTS.md が言っているもの（`entry`）は引き続きスキル側から外れる。
- **`bds new` / `import` が依頼に合うスキルの本文をその場で出す**（近いものが 2 つなら両方）。v1.19 までは候補の名前だけを出して「もう 1 回呼んで読む」になり、その 1 回で会話全体を送り直していた。`make` は同じ本文を AI への最初の指示に入れる。
- **`help <話題> <語>`**：その語を含む部分だけを出す（`help player` 全体 約 3,800 トークン → `help player fish` は数十）。
- **無駄な 1 往復の元を消した**：依頼文を受け入れ条件に分けるとき、英語の `!` `?` で文を切っていたため「使うと ZAP! と伝え」が 2 行に割れ、QA が「受け入れ条件 3 行に対して節が 1 つ」と言って AI がもう 1 周していた。
- `why`：`trace err` の下で返事が節の判定より後に届くと、出ていた行を「代わりに出た」と説明し、本当の失敗（`!` の否定チェック）を見逃していた。出力全体で判定し直す。
- 見本 shop のテストが「0 以下の送金は断る」と言いながら 0 を試していなかった（足した）。

### 企業向け
- **CI の供給網**：GitHub Actions をすべてコミット SHA で固定（タグが動いても走る中身は変わらない）。verify.yml に最小権限（`contents: read`）。lint が「固定されていない action」「権限を書いていないワークフロー」を落とす。
- **SECURITY.md**：秘密の置き場所、AI に任せる範囲（トークン上限・触れないファイル・レビュー）、CI の守り、脆弱性の非公開の報告方法。
- docs/ARCHITECTURE.md に「トークンの設計」（毎ターン・作り始め・失敗時・調べるときに何がどれだけ出るか）。
- 試験：cli-offline 40 項目（help の絞り込み・`bds new` が本文を出す・受け入れ条件の分け方を追加）、lint-offline 20 項目。

## v1.19.0 (2026-10-03)
**不具合の洗い出し（35 件を修正。ほぼすべてに、直す前の版で落ちる回帰テストを付けた）・一から作る練習と、そこから学ぶ仕組み・構成の体系化。**

### 一から作る（新規）
- **`scratch`**（common/scratch.mjs）：等級 1〜6 の課題 18 個（ベンチの課題を教材に兼用。新しく calc・countdown・wandzap・zone・filter・daily を足した）を、何も見ずに作る練習。`scratch next`（依頼文と手順。隠しテストは見せない）→ `scratch check <id>`（隠しテストをサンドボックスで数秒）→ `--real`（本物の BDS で判定）。`scratch stats`・`scratch gaps`。
- **学ぶ場所はサンドボックスと TS REPL**：`scratch probe "<コード>"` は同じコードを sandbox-be（`ts try`）と生きた世界（`ts`）の両方で動かし、一致すれば `--rule` で測った証拠つきの候補規則に、食い違えばサンドボックスの宿題に。課題の判定でも、同じコードでサンドボックスと実機が分かれた節を記録する（`scratch gaps --backlog` で sandbox-be の改良を backlog へ）。
- **課題そのものを証明**：参照解（bds/bench/solution.mjs）が全課題をサンドボックスと実機で通し、空の雛形は全課題で落ちる（`scratch selftest --real`：16/16、BDS 1.26.52.3）。CI の bds ジョブでも毎回回す。
- **新スキル `bds-from-scratch`**（下書き）：見本が近くない依頼を、行に分け → `api`/`doc` で調べ → sandbox と TS REPL で試し → テストを先に書く手順。採点 97%、振り分けの例を追加（dev 100%・held-out 97%）。bds-addon-master から案内。
- **実際に見つかったこと**：課題を実機で証明する途中で、サンドボックスがプレイヤーのチャットを全員宛ての 1 行として出していた（実機は各プレイヤーに `@B chat <A> 本文`）。sandbox-be と sim を直し、規則 `test-broadcast` を広げ、probe を実機で再確認した。課題のテストの誤り（`world.sendMessage` の行に `@A` を付けていた）も参照解の実機試験で見つかった。
- `sim --tests <file>`：別のテストファイルで下見。`skill growth` に「L0 一から作る」の行。

### 不具合の修正（v1.18.0 で再現したもの）
- **トークンとお金**：`skill bench` が `--via` なしでも claude CLI で有料のベンチを始めていた（`--help` でも）。今は `--via` 必須、`--runs`・`--tasks` を先に検査、止めたときは子プロセスごとまとめて止める。`auto policy dailyTokens=abc` が文字列のまま保存され、上限が効かなくなっていた（型を検査し、読めない上限は 0 として止める）。自動操縦のレビュー AI に聞けなかった変更が「検査だけで」取り込まれていた（取り込まない）。自動操縦が起こしたエンジン用 AI が `auto resume`・`auto policy` を使えた。
- **プロンプトの破損と実行**：依頼文や SKILL.md を AI への指示に埋め込むとき `String.replace` の文字列置換を使っていたため、`$&`・`` $` ``・`$'` を含む文が化けていた（make・エンジン用 AI・refine）。`refine --via "<cmd {prompt}>"` は本文中の `$( )` やバッククォートをシェルが実行し得た（正しく引用）。
- **`--help` が命令を実行していた**：`skill verify --help` は全 probe を実機で、`share --help` はリリースを丸ごと作っていた。どのコマンドも `--help`/`-h` ならヘルプだけ。`help <語>` は語全体で探す（`help go` に goto の行が混ざらない）。
- **黙って長く動く・おかしな成功**：`share zzz`・`setup zzz`・`verify <無いユニット>` が数分かけて走っていた。`flaky` は毎回ビルドで落ちても「OK」と言っていた。`skill learn --from <無い場所>` が「OK 0 件」。`skill promote`/`retire` を id なしで「ERR no rule undefined」。`doc` が使い方をスタックトレース付きで、`apply <無いファイル>` が ENOENT で落ちていた。`app token` が画面も端末も資格情報も無いと永久に待っていた。`ui build <layout>` がブラウザの操作画面を開いて戻らなかった。`end status` など、ラボ名を前に付けると 16 個以外の共通コマンドが使い方の表示になっていた。
- **配布と更新**：`share` が bds-recipes の指す見本 10 個を配布物から落としていた（検証済みの規則が証拠に挙げるユニットは必ず入れる）。`update` が古い TS REPL を「自分のユニット」として残し、`ts` と合わなくなり得た（便利系アドオンは常に新しくする）。`maint --fix`（`clean --deep`）が git で管理している BDS の zip を消していた。nethernet-connect の同梱漏れを `status`・`share` が言うようにした。
- **データを守る**：`deploy` が、手で別の名前で入れた同じ UUID のパックを残し、1 つの UUID に 2 つのパックができていた（置き換えて、`--undo` で戻す）。`undo` で 20 個のうち最も古いチェックポイントへ戻ると、直前に取る控えが目的のものを先に消して失敗していた。
- **スキルの練磨**：`skill refine` を 2 回呼ぶと編集後の状態を基準に取り直し、`--done` が悪化を見逃し `--revert` が元に戻せなくなっていた。`--done` の振り分け比較を件数ではなく 1 件ずつに（途中で例を足しても誤判定しない）。skills/history.json の判定文（旧版の誤り「-8% fewer」）を数値から計算し直した。
- **調べる・持ち込む**：`api` がユニット未選択だと gametest しか引かず `api World` が「none」だった。`import`/`brief` がカスタムコンポーネント（`onItem`/`onBlock`/`registerCustomComponent`）を入口として見ておらず、下書きテストがアイテムの onUse やブロックの onPlayerInteract を一度も通っていなかった。`test <file>`・`ui build <file>` の相対パスを、コマンドを打った場所から探すように。`add` が JSON でない値を黙って文字列にし、`max_stack_size=999` を通していた（その場で W / E）。
- 鍵の検査に npm・GitLab・Hugging Face・Stripe・Telegram のトークンと暗号化された秘密鍵を追加。

### 体系化・無駄の削減
- **docs/ARCHITECTURE.md**：層・主な流れ・モジュールの地図（common/ の全 71 ファイル）・状態の置き場所・品質ゲート・安全の床・変えるときの約束。
- **README を 74 KB → 8 KB** に絞り、詳細は docs/guide/（tools・workflows・skills・labs）へ。リンク切れは docs-offline が検査する。
- **訓練用の training/**（PvP ボット・RTA スクリプト、3.8 MB）は本体の配布物に入れず、`bds-lab-training-v1.19.0.zip` として別に配る。
- **品質ゲートを 22 → 25 本に**：`tests/lint-offline.mjs`（全スクリプトの構文・全 JSON・コマンド表と文書・モジュール地図・既知の不具合の型・配布物に入るべきユニット）、`tests/cli-offline.mjs`（上の不具合 36 項目の回帰）、`tests/scratch-offline.mjs`（教材と練習の流れ）。既存の import・deploy・update・auto・sim の試験にも回帰を追加。

## v1.18.0 (2026-10-03)
**スキルを読むトークンを削り、読み違いを減らす**。Claude のトークン数を claude CLI で実測した。
- **`skill <name>` は読む用の形で表示する**：front matter・ビルド用の印・規則 id・AGENTS.md が既に言っている規則（knowledge.json の `entry`）を外す。全 16 スキルで 14,512 → 11,961 トークン（-17.6%）。この数字は entry の除外を入れる前に測ったもので、今はもう少し少ない。`--raw` で元のファイル
- **`skill route "<依頼>"` は持ち主が 1 つにはっきり決まれば、そのスキルを表示する**：読むための 2 回目の呼び出しが要らない（1 回呼ぶたびに会話全体を送り直すため）。近いものが 2 つなら `skill a b` を勧め、1 回で両方を表示する
- **カタログ型スキル**（bds-recipes）は、依頼に合う 3 行だけを表示する（knowledge.json の `tags` で日本語の依頼にも当てる）
- **`skill refine <name> --via <ai> --goal shorter`**：別の AI に同じ内容を短く書かせる。採用するのは、5% 以上小さく、コード・数値・規則 id を 1 つも落とさず、他が悪くならないときだけ。言い換えた規則は id で knowledge.json に戻す
  - 実測：AI に bds-tests を短くさせても 1% も縮まなかった。AGENTS.md（毎ターン 3,409 トークン）も、事実を落とさずに縮められたのは 1% で、文章側はほぼ限界だった。残る削りどころは、呼び出しの回数と、読む量の絞り込みだった
- **AGENTS.md** のスキルの行を route に合わせて短くした
- **品質**：
  - bds-debug に、確かめていないことを言う 1 行を足した（100%）
  - 僅差だった振り分け 2 件を解消
  - ベンチの判定文が「多い」を「-8% fewer」と書いていた誤りを直した
- **初めての実ベンチ**（claude CLI、shop、1 回ずつ）：スキルあり・なしの両方が合格した。トークンはあり 45,894、なし 42,602（+8%：route が表示したスキル分）。1 回きりの結果で傾向とは言えない。そのあと、カタログを絞る変更を入れた
- テスト：forge-offline 55 項目、skills-offline 28 項目

## v1.17.0 (2026-10-03)
**スキルの自己練磨を、別の AI に回させても崩れないようにし、物差しそのものも参考から育つようにした**。v1.16 の仕組み（採点・振り分け・ゲート付きの refine）を、実際に別の AI（claude CLI）に回させて確かめた。そこで見つかった物差しのごまかしを塞ぎ、成長の仕組み全体を skills/GROWTH.md（日本語）に体系化した。
- **`skill refine <name|weakest> --via <claude|codex|gemini|anthropic|openai|auto|"<cmd {prompt_file}>"> [--rounds n]`**：ブリーフと現在の SKILL.md・triggers.txt を 1 問で渡し、答えの ```skill / ```triggers をラボが書いて採点する。別の AI に任せた編集は `--strict`（採点か振り分けが上がらなければ戻す）。戻した理由はブリーフと次のプロンプトへ。2 回続けて戻されたスキルは `weakest` が飛ばす。`weakest` は「文章で上げられる点」の低い順（evidence は probe かテストでしか上がらない：rubric の `text: false`）。何も残っていなければ「プローブ・テスト・ベンチが要る」と言う
- **実際に回した結果（claude CLI、合計約 6 万トークン）**：
  - bds-fix-addon 93→97、bds-forms 93→97、bds-tests-world 93→97、bds-content 97→100 を採用。
  - **物差しのごまかしを発見**：master を磨かせたところ、根拠の無い「(when missed: …)」を 12 か所足し（+35% のバイト数、点は同じ）、v1.16 のゲートは「悪くない」として残した。手で戻したうえで rubric v3 にした（硬い規則が無いスキルは rules-why を 2 点にする、evidence に text:false の印）。AI の編集は strict にし、長くなっただけの編集も戻すようにした。
  - bds-content は同じ失敗（bds-quality の依頼を奪う）を 6 回続けていた。戻された理由を渡すようにしたら、次の 1 回で採用された。
  - bds-forms で AI が書いた「go はサーバー側で押す」は誤り（本物のクライアントが押す）だったので、手で直した。AI の文章は事実の確認が要る。
- **`skill new … --like <skill|repo/skill|path>`**：手本（こちらのスキル、または参考リポジトリのスキル）の章立てを下書きの節にする。埋めていない節は `--done` が戻す。下書きの穴埋めの行は採点に数えない
- **物差しが育つ（L3）**：
  - `skill compare`：こちらと各参考スキル集を、使い回せる項目ごとに並べる。今回 anthropics/skills も参考に加えた（ポータブル項目：mcbejsonuimasterAI 77%・MCBE-UI 67%・anthropics-skills 66%・mcbemodelingmasterAI 65%・こちら 100%）
  - `skill rubric mine`：参考の多くが持ちこちらに無い見出しや「Input:」のような行を、パターンの候補として rubric.json に入れる（`re` を持つ項目はデータとして採点するので、コードを変えずに物差しが増える）
  - `skill rubric calibrate`：既存の項目が今もスキルを見分けているか（name・budget・portable・grounded は必須の関門 `gate`）と、候補に信号があるか。信号は「同じリポジトリの中で、それを持つスキルの他の項目が +5pt 以上」で判定し、既存の項目や、より強い候補と同じものは redundant にする
  - `skill rubric adopt <id>` / `retire <id> "<why>"`：版を上げて履歴を残す
  - 結果：mcbejsonuimasterAI の `## Contract`（Input / Output / Success、75%）は、全体比較だと +10pt に見えたが、同じリポジトリの中では +2pt（もともと良く書かれたリポジトリだっただけ）。**採用しなかった**。このため growth は「参考から足せる厳しい項目はもう無い：基準を上げられるのはベンチだけ」と言う
- **どの AI にも**：
  - `<!-- only:claude,codex -->…<!-- /only -->`：1 つの SKILL.md の中で、その AI だけが読む部分。共通の見え方・採点・他の AI の写しには入らない。`skill <name> --for <ai>` で表示できる。閉じ忘れは `--done` が戻す
  - install 先を追加：Windsurf .windsurf/skills、Cline .cline/skills、Roo .roo/skills、Kiro .kiro/skills、OpenCode .opencode/skills（ホームは各ツールの場所）。Aider は CONVENTIONS.md に振り分けの一覧
  - `skill prompt --for <ai> [--budget bytes] [--skills a,b] [--out file]`：スキルのフォルダを読めない AI（チャット・API）向けに、振り分けの一覧と、使用回数・点の順にスキル本文を予算内で 1 本のシステムプロンプトにする
- **振り分け**：
  - どのスキルにも属さない依頼（天気・詩・ラーメン屋・履歴書など）を 8 件加え、どれにも振らないことを測る。最初は「カレーの作り方」が bds-deliver に、「履歴書の書き方」が bds-tests に、「a short poem」が endstone-plugin に吸われていた
  - 単独の汎用漢字（方・作・書・教 …）の重みを 1/4 にし、依頼文の決まり文句（write・make・want・please …）を外した。この調整は held-out を見たうえで行ったので、調整のあとで新しく書いた held-out 5 件で確かめた（5/5 正解）
  - 僅差（1 位と 2 位の差が 13% 未満）を `--eval` とブリーフに出す。関係の無い編集で順位が入れ替わるのが見えるようにした（実際に skill-forge の編集で bds-quality の依頼が入れ替わった → bds-quality に「DONE の後に確かめる」を足した）
  - 結果：dev 41/41、held-out 29/30
- **自動操縦**：`forge` タスク。文章で上げられる点が 85% 未満のスキルがあるか、held-out の振り分けが 80% 未満なら `skill refine <それ> --via auto --rounds 2`。触れてよい範囲はそのスキルの SKILL.md・triggers.txt と grades.json だけで、knowledge.json・rubric.json・routes.json は不可
- `--done --because "<理由>"`：採点に見えない内容（新しいコマンドの説明など）を手で足すときは理由を書いて記録する（skill-forge の更新で使った）
- skills/GROWTH.md（新規、日本語）：原則 4 つ、層 L0〜L5（体験・規則・スキル・物差し・選択・自動運転）を、測るもの・コマンド・戻す仕組み・記録の表にまとめ、一巡の流れと、実際に起きたこと・まだ測れていないことを書いた
- テスト：forge-offline 28 → 46 項目（only の部分、新しい install 先と Aider、閉じ忘れの差し戻し、どこにも属さない依頼、--like、compare、rubric の mine・calibrate（リポジトリ内の差）・adopt（データの項目として 0 点）・retire、prompt --for の予算、refine --via の差し戻し → 理由を次へ → 採用、規則ブロックの捏造と「良くならない」編集の差し戻し、stuck の飛ばし、auto の forge タスク）。ゲート 22 本すべて PASS

## v1.16.0 (2026-10-03)
**スキルを「システムプロンプト」として 1 から作り、参考の優れたスキル集と比べ、自分で磨き、どれだけ育ったかを測る仕組み**。v1.13–1.15 で育つようになったのは規則（1 行の知見）だけだった。今回はスキルそのもの（説明文・手順・境界・完了条件）と、それを測る物差しまで育つ対象にし、成長を 3 層（L1 規則 / L2 スキル / L3 物差し）に体系化した。どの AI でも読める形を正とし、AI ごとの差分だけを別ファイルにした。
- **common/skill-forge.mjs（新）**：
  - `skill grade [name|all] [--ref <dir|URL>]...`：skills/rubric.json の 15 項目を 0–2 で採点（name・trigger・boundary・procedure・example・rules-why・done・honesty・budget・portable・focus・no-repeat は他のスキル集にも使える項目、grounded・evidence・routed はこのラボだけ）。各項目に「何を見るか・直し方・根拠」（SkillsBench arXiv 2602.12670：人が選んだスキル +16.2pt、モデルが自分で書いたもの -1.3pt、2–3 個 +18.6pt、網羅的なもの -2.9pt、例付きの短い手順が効く／Codex のスキル文書：説明文の先頭に用途と言葉を、一覧は文脈の 2%／参考 3 リポジトリの skill-lint・ルート契約・評価表）。`--ref` は参考のスキル集を同じ物差し（使い回せる項目）で採点し、こちらが低い項目には向こうで 2 点を取った実際の 1 行を見本に出す。「この物差しはこちらが書いたもの：参考より高くても良い証明ではない（ベンチが決める）」と毎回出す
  - `skill route "<依頼文（日本語可）>" [--eval]`：読むべきスキルと一致した言葉（name・説明文・skills/<名前>/triggers.txt・本文の BM25。日本語はカタカナ語をまとめて、漢字は語と 2 字組、ひらがなは除く）。`--eval` は skills/routes.json（dev 38 件・held-out 22 件）で 1 位正解率。held-out は一覧に出さず、スキルに写してはいけない
  - `skill new <name> "<何をする。Use when …>"`：共通の形（説明文・Not for・番号付き手順・Done when / Report・規則ブロック）で下書きと triggers.txt を作る。説明文に「何を」と「Use when」が無ければ拒否。いちばん近い既存スキルを示す（重複の防止）
  - `skill refine <name|weakest>`：スナップショットを取り、弱い項目ごとに直し方と参考の見本、見逃された規則、候補、誤って振り分けられた依頼、読まれた回数を出す。`--done` で採点し直し、**どの項目も・他のどのスキルの点も・dev / held-out の振り分けも悪くならず、3.2 KB 以内で規則ブロックが残っているときだけ採用**、それ以外は自動で元に戻して理由を出す（`--revert` で手動）
  - skills/grades.json：採点が変わるたびに世代（スキルごとの点・振り分け・rubric の版・理由）、refine の採用 / 差し戻し、参考との比較、下書き / 正式の状態
  - 読まれた回数（.lab/skill-reads.jsonl）と、そのスキルを読んだユニット / 読まなかったユニットの「1 ユニットあたりの修正数」
- **成長の 3 層（`skill growth`）**：L1 規則（従来のはしご）、L2 スキル（平均点・振り分け・refine の採用 / 差し戻し・下書き・よく読まれるもの / 読まれないもの）、L3 物差し（ベンチのたびにその時の採点を記録し、採点とベンチの合格率が同じ向きに動いたかを数える。動かなければ「rubric は結果を予測していない：書き直す」）。平均 90% 以上で「物差しが頭打ち：より厳しい項目を足して版を上げ、ベンチで確かめる」を次の一歩に出す
- **AI が書いたスキルは下書き**：`skill new` のスキルは draft。`skill bench --without <name>`（全スキル vs そのスキル抜き：bench.mjs が LAB_SKILLS=without:<name> でそのスキルだけ除く）で悪くならなければ kept。`skill install` は draft とラボ専用（scope lab）を入れない（`--drafts` で入れる）
- **どの AI にも**：`skill install` が各 AI の探す場所に書く（Claude Code .claude/skills、Codex と汎用 .agents/skills、Gemini .gemini/skills、Copilot .github/skills（--global は ~/.copilot/skills）、Cursor .cursor/skills。旧 .codex/skills・Cursor の .mdc から変更）。Gemini・Copilot・AGENTS.md には `skill route` を含む振り分けの一覧。SKILL.md は共通（portable 項目で製品名や絶対パスを検出）、ある AI だけに要ることは skills/<名前>/ai/<AI>.md に書くとその AI の写しにだけ「Only for <AI>」として足す（例：bds-models/ai/codex.md：参考リポジトリの 1 件の対戦で Codex は規則を守っても形の作り直しが要った → 全ポーズを描いて読むこと）。同じフォルダを読む AI（codex と agents）は 1 回で両方の差分
- **skill-forge（新スキル、ラボ専用・下書き）**：スキルを 1 から書く／磨くときの手順（route で重複確認 → new → refine → --done → build --check → master に名前 → bench --without → growth）と、自分で書いたスキルを信用しない理由。bds-addon-master に F（スキルそのもの）と `skill route` を追加、bds-forms を名指し（今まで master から辿れなかった：grade の routed で発見）
- **実際にこの流れで全スキルを磨いた**（この版を作る中で、ラボのコマンドだけで）：
  - 世代 1（rubric v1）：平均 81%、振り分け dev 76%・held-out 36%（日本語の依頼がほぼ外れていた）
  - 1 巡目：全スキルに triggers.txt（日英の言葉）と、Not for（担当外と引き継ぎ先）・Done when / Report・確かめていないことを言う 1 行。差し戻し 4 回（bds-tests が bds-tests-world の依頼を奪った、bds-tests-world の新しい規則行に理由が無い、levilamina-mod の文が endstone-plugin と重なり相手の点を下げた、bds-recipes が 3.2 KB 超え）→ 直して再採用
  - rubric v1 が平均 96% で頭打ち → **v2 で no-repeat（AGENTS.md に既にあることを繰り返さない）を追加して基準を上げ**、2 巡目で 7 スキルの重複行を AGENTS.md への参照に置き換え
  - 結果：平均 96%（rubric v2）、振り分け 1 位正解 dev 100%・held-out 95%、refine 29 回中 25 回採用・4 回差し戻し。参考（使い回せる項目）：mcbemodelingmasterAI 62%・MCBE-UI 63%・mcbejsonuimasterAI 74%、こちら 98%
  - 正直に：物差しはこちらが参考と SkillsBench から書いたもので、高得点は「その形に沿っている」ことしか示さない。held-out は triggers と同じ回に同じ AI が書いたので完全には独立していない。15 の既存スキルは平均 +185 バイト（読むのは 1 回に 1 つ）。AI のアドオン作りが良くなったかはベンチ（AI のトークンが要る）が未実施 → auto/BACKLOG.md に 3 件
- **小さな修正**：refine の採点の都合で見つかった、バッククォートの組をまたいで数える誤り、`beta-only` を禁止の規則と誤認する誤り、`Verify:` を完了条件として数えない誤りを直した（採点器の修正はベースラインを取り直してから磨き始めた）。growth が日付の無いベンチ記録で落ちるのを直した
- テスト：tests/forge-offline.mjs（新規、28 項目、ゲートに：各採点項目が壊れたスキルで 2 未満・直したスキルで 2、日本語の分かち、route の評価と held-out の非表示、new の拒否と雛形、refine の採用と差し戻し（他のスキルの依頼を奪う変更は戻る）、AI ごとの差分、draft とラボ専用を入れない install、bench --without で draft → kept、growth の 3 層と頭打ちと妥当性）。skills-offline の install を新しい場所に。ゲート 21 → 22 本、全部 PASS

## v1.15.0 (2026-10-03)
**場面ごとのスキル体系と、実際に使わせて直した改善**。別の AI（まっさらな状態のサブエージェント）に 4 つの実依頼をラボだけでやらせ（新規アドオン、持ち込みアドオンの修正、Endstone プラグイン、LeviLamina mod：4 つとも DONE）、つまずいた所をスキルとラボの両方で直した。
- **スキルを場面別の手順（プレイブック）に**（11 → 15 個、74 規則）：bds-addon-master が A 新規 / B 持ち込み / C 見た目だけ / D BDS スクリプトの外（Endstone・LeviLamina）/ E 詰まった、を選ばせ、各段で読むスキルだけを名指し（読む量を減らす）
  - **bds-recipes（新）**：よくある依頼 → ラボで go に通っている実物のアドオン（毎日ボーナス daily、1 日 1 回 coins、ホーム home、ショップとお金 shop、クールダウン付きアイテム wand、エリア zone、時間制の大会 fishcup、ブロック lamp、モブとレシピ jelly、フォームの見た目 jsonui_demo、持ち込み修正 teleport_menu）。新規の AI は実物を写して始める（試験では、ラボにあった daily を新規の AI が見つけられずに一から書いていた）。これらのユニットを zip に同梱
  - **bds-deliver（新）**：渡し方（ファイル、Beta APIs、permissions、deploy、Endstone の .whl、LeviLamina の zip）と、相手の言語での正直な報告
  - **bds-tests-world（新）**：移動・釣り・飛び道具・2 人の位置などを bds-tests から分け、bds-tests を軽く
  - **levilamina-mod（新）**：コマンドの作り方、xuid が空のオフライン鯖、plugins/<n>/ のデータと restart、before 系イベントの取り消し、写す元の mod
  - bds-fix-addon を書き直し：brief の「サーバー前に見つかったバグ」を 1 回で全部直す、プレーンな JS は JS のまま、自分たちの item を `add` で直す
  - 証拠の種類に **unit**（ラボのユニットが go に通る＝その形が動く。`skill verify unit` で実機で再確認）
  - **`skill note "<一行>"`**：作業中の驚きを auto/LESSONS.md に → `skill learn` が候補に（AI 自身が知見を足す入口）
  - 新しい規則：クライアントの行の形（§ が消える・末尾の空白が消える・translate は `%key [a, b]`）、`!`/`!~` は節全体を見る、js 行は最後の式の値、`~` は 1 行ずつの JavaScript 正規表現、Endstone の py の値の出方、`deop B` で一般プレイヤーの試験 …
- **持ち込みアドオンの brief**：「bugs found before any server」の 1 行に、world.* のロード時アクセス、before-event 内の書き込み、新しいプレイヤーへの getScore、閉じたフォーム、再起動で消える状態、改名されたコンポーネント（foil → glint など）を規則 id 付きで全部出す（試験では 1 つずつ go で出ていた）。`!` + サブコマンド（cmd === "sethome"）は `!sethome` などの実際の言葉として下書きテストに
- **実機で測って直した**：before-event の中で addScore / setScore / addTag は拒否、setDynamicProperty と sendMessage は通る（probe を拡張、lint もこれに合わせた）
- ラボの修正（試験で見つかったもの）：
  - js 行が「文; 式」の最後の式の値を返す（前は何も出ず undefined）
  - got の行で毎秒のアクションバーのような同じ行は 1 回 ×回数 で後ろに（大事な行が隠れない）
  - why の「printed by」が色コードと末尾空白でテンプレートを外していた
  - status が go の結果ではなく stable の試し実行を出していた
  - `add item` を既存の item（人のもの）に実行すると components を実際にマージ。`ja=` で ja_JP が無ければ足す
  - vanilla のアイコン名（book_normal など）を警告しない。ドキュメントにある icon の texture キーをスキーマが誤って警告していた
  - 起動中の BDS のネイティブクラッシュ（たまに 1 回）は 1 度だけ起動し直し、繰り返すときだけ失敗に
  - tests.txt の正規表現の誤りをサーバー起動前に（Endstone では起動後 1 分で落ちていた）
  - `help <言葉>` が話題に無いとき、その言葉を含む行を出す
  - `bds new` の TASK.md に依頼の文を受け入れ条件の下書きとして入れる
- **Endstone / LeviLamina を育てた**：
  - LeviLamina：GitHub API が使えない回線でも git のタグから lip を取れるように（このセッションで初めて ll が動いた。money mod DONE）。`lse` 行から mod のトップレベルの変数が見える（help の記述どおりに）。sim は ll/end では「go を使う」とはっきり言う
  - Endstone のカバレッジ：sys.monitoring（Python 3.12+）で全スレッドを数える（前はコマンドの中が 1 行も数えられず 21% と出ていた → 90%）。restart をまたいで合算
  - mutate が Python（Endstone）にも。chaos が LeviLamina の mc.newCommand と Endstone の usages（列挙型も）を理解。Python のエラーも chaos が拾う。gaps は Python の def と on_command の分岐ごとに
  - mutate が途中で止められても単位を元に戻す（シグナルで戻し、強制終了なら次のコマンドで戻す）。試験では植えたバグがソースに残っていた。進み具合 n/m と、JSON のインデントの数字は変えない
  - end/AGENTS.md・ll/AGENTS.md：py の値の形、usage の型、`deop B`、restart、tp がブロックの中心に着くこと
  - 試験で作ったものを例として同梱：end/plugins/report（通報：SQLite・クールダウン・OP 一覧）、ll/mods/warps（ワープ）
- テスト：skills-offline 27、import-offline 8、dev-offline に lint 3、offline に正規表現の起動前チェック（bds・end）、sim-offline に js の最後の式

## v1.14.0 (2026-10-03)
**スキルを広げ、育ち方を測れるように**。参考の 3 リポジトリが得意な分野（モデリング、JSON UI）を、ラボのチェッカーで確かめられる規則つきのスキルにし、自己成長を「失敗が起きた瞬間に効く」「効かなかった規則を数える」「他の優れたスキル集から学ぶ」「世代ごとに測る」まで体系化した。
- **新しいスキル 2 つ（11 個、47 規則）**：
  - `bds-models`：x 方向の鏡像（east の UV は低い x 側）、回転の向き、同一平面の面（z-fight）、UV と texture サイズ、翼などの厚さ 0 の板、人が Blockbench で直したファイルの扱い、vanilla を先に見る。iMasterProX/mcbemodelingmasterAI の知見より
  - `bds-json-ui`：_ui_defs への登録、vanilla 画面の名前空間、@参照、存在するテクスチャだけ、modifications で小さく変える、フォームのタイトルの印で切り替える、静的チェックしかできないことを正直に言う。shawtymarco/MCBE-UI、boredape874/mcbejsonuimasterAI の知見より
  - 振り分け（bds-addon-master）に 2 行
- **証拠の強さを明記**：test / probe（ここで再実行）> measured（ここで 1 度見た）> **source**（参考プロジェクトがそう言う。スキルでは `[source]` と表示し、テストか probe ができるまでその印のまま）
- **tests/rp-offline.mjs（新規、20 項目、ゲートに）**：モデルの lint と JSON UI の lint の検出を 1 つずつ、壊したファイルで落ちることと直したファイルで通ることの両方で確かめる（参考リポジトリの「失敗するのを見ていないテストは何も証明しない」）。x の鏡像も関数で確かめ、`model-look` を source から test に
- **必要な瞬間に規則を出す**：規則に `match`（正規表現）を持たせ、E / W / Q / ✘ の行に当てはまる確認済みの規則を、その行の直下に 1 行（1 回の実行で 1 回、`LAB_RULE_HINTS=off` で無し）。スキルを最初に全部読むより安く、失敗したときに要る知識が届く。既存の 11 規則（getScore の identity、before-event、runCommandAsync、chatSend、フォームの canceled、UserBusy、beta 版 …）にも
- **規則が効かなかった回数（misses）**：`skill learn` が、規則があるのに同じ失敗が起き、直された回数をユニットごとに数え直す（何度実行しても同じ）。3 回・2 ユニット以上で「読むだけでは防げない：チェックにするか書き直す」と出す。その失敗から重複した候補は作らない
- **他のスキル集から学ぶ**：`skill learn --from <フォルダ | https://github.com/owner/repo>`（初回は .lab/skill-sources に clone、次から pull）。SKILL.md の行、data/rules.json、data/failure-modes.json から、ラボにまだ無い強い規則（never / always / must / do not …）を source の候補に。続きの断片、問いかけ、そのリポジトリ専用のツールやファイルを指す行、ほぼ同じ規則は飛ばす。参考 3 つで試した：モデリング 60、MCBE-UI 60 の候補（候補は証明されるまで SKILL.md に入らない）
- **`skill growth`**：世代（knowledge.json の `log`、数が変わるたびに 1 行）、証拠の内訳と再確認できる割合、候補・disputed、体験（エピソード、ユニットあたりの修正数を古い半分 → 新しい半分で）、最後の bench、そして部分ごとの次の段（効かなかった規則 → チェックに、disputed → 直す、候補 → 証明、source → テストか probe、bench 未実施 → bench）
- **実機で一巡を確認**（BDS 1.26.52.3）：新しいアドオンで getScore の identity エラー → 直して DONE → エピソードに記録 → `skill learn` が api-score-identity の misses を 1 に。ラボが同じ失敗に自前の hint を出すときは rule の行を出さない（同じことを 2 度言わない）
- `skill promote` は `--evidence source:<URL ファイル>` も受け付ける。AGENTS.md の 1 行に「失敗の下の `rule:` 行に従う」（+12 トークン）。`help skills`・`help model`・`help ui` を更新
- テスト：skills-offline 19 → 26 項目（その場の規則、無効化、disputed は出さない、misses、--from、source の昇格、growth）。ゲート 20 → 21 本

## v1.13.0 (2026-10-03)
**自己成長するスキル**：ラボの知見を、どの AI でも読めるスキルにし、実機の証拠つきで自分で育つ仕組みにした。参考：mcbemodelingmasterAI（Claude）、MCBE-UI（Claude）、mcbejsonuimasterAI（Codex）の構成（AGENTS.md を全 AI 共通の入口に、`skills/<名前>/SKILL.md`（name・description の見出し）、「頼まれたこと → 読むスキル」の振り分け、過去の失敗から来た規則、症状 → 原因 → 直し方、評価課題と採点、必要な 1 つだけ読む）。参考の 3 つに無い点として、規則がそれぞれ再実行できる証拠を持ち、実機で確かめ直され、比較で選ばれる。
- **skills/（9 個、33 規則）**：bds-addon-master（振り分け）、bds-script-api、bds-forms、bds-tests、bds-content、bds-fix-addon、bds-debug、bds-quality、endstone-plugin。中身はこのセッションで実機で確かめた事実（getScore と identity、before-event は読み取り専用、再起動で残るのは dynamic properties だけ、節は 1 つの世界で順に、全員が同じ場所に出る、walk は tick 数、`~` は正規表現、乱数は範囲で、clock、chatSend は beta だけ、runCommandAsync は廃止 …）。各 3.2 KB 以下
- **skills/knowledge.json** が規則の元：規則・見逃したときの症状・証拠（probe / test / measured）・状態（verified / candidate / disputed / retired）。`node lab.mjs skill build` が SKILL.md の規則の行を書く（ゲートが食い違いを落とす）
- **skills/probes/**（6 個）：規則を実機で示す小さなアドオンと tests.txt（before-event、スコアの identity、再起動で残るもの、walk の距離、同じ出現場所、全体メッセージ）。BDS 1.26.52.3 で全部合格
- **自己成長のループ**（トークン不要の部分が多い）：
  1. 体験：test / go のたびに、前回の失敗のうち今回の編集で消えたものとラボが出した直し方の行を `<lab>/.lab/episodes.jsonl` に
  2. 振り返り：`skill learn` が繰り返す失敗と auto/LESSONS.md を規則の候補に（候補は SKILL.md に入らない）
  3. 証明：`skill promote <id> --evidence probe:…|test:…|measured:…`（証拠が無いと拒否）
  4. 確かめ直し：`skill verify [id|probe|all]`。upkeep が新しい Minecraft のたびに probe を流し直し、実機と食い違う規則は disputed になって SKILL.md から外れる
  5. 選抜：`skill bench --via claude|codex|gemini|anthropic|openai`（AI のトークンを使う）がベンチ課題をスキルあり／なしで作り（隠しテストで判定）、合格が減らず、トークンが 1 割以上増えないときだけ残す（skills/history.json）。ベンチの写しは `LAB_SKILLS=off` でスキル抜きに
  6. 剪定：3.2 KB を超えるスキルは build が警告、`skill retire <id> "<理由>"`
- **全 AI 対応**：`node lab.mjs skill`（一覧）、`skill <名前>`（表示、シェルが使える AI ならどれでも）。`skill install claude|codex|cursor` は SKILL.md のフォルダ／Cursor のルールをプロジェクト（--to）かホーム（--global）に、`gemini|copilot|agents` は GEMINI.md・.github/copilot-instructions.md・AGENTS.md に振り分けの節を（何度実行しても 1 つ）
- AGENTS.md に 1 行（+40 トークン）、`help skills`
- テスト：skills-offline 19 項目（新規、ゲートに。ゲート 19 → 20 本）

## v1.12.0 (2026-10-03)
**持ち込んだアドオンを直して完成させる流れを主役に**（新しく作るより「このアドオンを直して・仕上げて」が多いため）。同梱の第三者製アドオンと「アップデートで動かなくなった」典型的なアドオンを持ち込んで、つまずく所を順に潰した。後者は直して実機 BDS 1.26.52.3 で DONE（20 項目）。
- **AGENTS.md に入口**：人のアドオンは `node lab.mjs import <ファイル> "<頼まれたこと>"`（前は AGENTS.md に import が無く、AI は始め方が分からなかった。+104 トークン）。`help import`
- **import**：
  - 相対パスを、ラボを動かした場所から解く（前はラボの中の bds/ からで、`import ./My.mcaddon` が「使い方」エラー）。.mcaddon の中の .mcpack も開く
  - 頼まれたことを TASK.md に、元の版を `imported.json` に
  - **brief（1 画面の要約）**：パックと API の版（✗ = この BDS に無い）、入口（カスタムコマンド・`!home` のようなチャットの言葉・scriptevent・コードが確かめるアイテム・イベント、どれも file:行）、フォームの数、実行するコマンド、何も保存していないか（dynamic properties が無い = 再起動で全部消える）。圧縮されたコードでは「ファイルを読まず brief を」と言う。`node lab.mjs brief` でいつでも
  - **移行監査**：コードをこの BDS の stable と beta の型で検査し、壊れる使い方を一度に全部（`chatSend` は beta だけ、`runCommandAsync` は廃止 → `runCommand`、など行付き）、変更が少ない方の `mode` を勧める。前は go のたびに最初の 1 つしか見えなかった
  - **テストの下書き**：入口ごとに 1 回ずつ動かす節（チャットの言葉、アイテムの使用＋開いたフォームを閉じる、scriptevent、2 人目の参加 …）。予期しない E 行で節が落ちるので、最初の go で落ちる所がすべて出る（試した例：1 回目の go で 4 種類、前は 1 周に 1 つ）
  - **完成品の版**：import の後の最初の pack / DONE は、同じ UUID のまま版を 1 つ上げる（同じ版だと利用者の端末が古いリソースパックを使い続ける）
- **go の出力**：
  - 同じ QA の問題（初参加・再参加・再起動 …）を 1 行に `×4 (during: …)`、数もまとめた数で
  - 自動の why を、スクリプトが読み込まれていないとき（モジュールの版が無い等）は回さない（前は「例外なし、コードは走った」と誤った案内）。素の JS の `main.js:52` の形の行が出ていれば回さない（前は src/ の形しか見ず、25 秒余計にかかっていた）
  - 素の JS の型の注記：この版に無い API の使い方を先に全部、ほかは 3 件と件数（第三者のアドオンで 378 件の雑音に「Potions が無い」が埋もれていた）
- **sim**：
  - チャットのイベント（beta の `world.beforeEvents.chatSend`・`afterEvents.chatSend`、cancel で誰にも届かない）。前は出しておらず、`!home` 式のアドオンが sim では何も反応しなかった
  - フォームの答えをボタン名・値で書いたとき、前から 1 つずつ解く（メニューから開く 2 枚目のフォームが飛ばされていた）
- 下書きで、引数を取るカスタムコマンド（kit の cmd）には必須の引数の見本を入れる（`@A cmd /lab:pay @s 1`）
- 計画のうち残りは auto/BACKLOG.md に `lab:` で（難読化コードの brief --live、sim のクラフト、Endstone の持ち込み）
- テスト：import-offline 6 項目（新規、ゲートに。ゲート 18 → 19 本）、sim-offline 28 → 29 項目

## v1.11.0 (2026-10-03)
新しい依頼を 2 件（Endstone の AFK プラグイン、BDS のコインショップ＋送金）を AGENTS.md だけを頼りに最初から作り、DONE の後の「テストを信頼できるものにする」道具（gaps・mutate）まで回して、つまずいた所を直した（どちらも実機で DONE）。
- **gaps / mutate / coverage の誤検知**：関数の最後の `return undefined;`（ビルド後 `return void 0;`）、`return;`、定数の return を「一度も走っていない」と数えていた（QuickJS はそこに止まる位置を持たない。ログを 1 行足すと走っているのを実機で確認）。AI はこの指摘を受けて、もう走っている行のためにテストを足そうとする。前からあったテンプレートの return と同じ扱いに（分岐の中の return は今まで通り数える）。dev-bds に検査を追加
- **`~` が外れたときの注記**：`^` / `$` だけが原因（`~ ^A is back` に対して実際の行は `@A A is back`）のとき、「エスケープせよ（空）」という意味の通らない文を出していた。今は「行は "@A A is back"：^ は行頭に固定する（外すか行全体を書く）」
- 確認：Endstone の全体メッセージは各プレイヤーが受け取った行（`@A …`）として出る、Endstone の `py plugin.idle_seconds = 3` でしきい値をテストの中で短くできる（5 分待たずに済む）
- テスト：sim-offline 27 → 28 項目、dev-bds に「関数の最後の定数の return」

## v1.10.0 (2026-10-03)
新しい依頼を 2 件（カスタムのモブ＋ドロップ＋作業台のレシピ＋飲む薬、別のディメンションと再起動をまたぐホーム）、AGENTS.md だけを頼りに最初から作り、つまずいた所を直した（どちらも実機 BDS 1.26.52.3 で DONE）。
- **`sample` がバニラのデータのほとんどを見つけられなかった**：BDS 1.26 はレシピ・アイテム・エンティティ・スポーン規則・バイオームなどを `.brarchive` に入れて配っているのに、それを「バイナリ」として飛ばしていた（`sample recipe` → none）。今は `sample recipe` で 821 件のレシピ、`sample recipes/glass_bottle.json` でその中身。テスト `tests/sample-offline.mjs`（ゲートに、ゲート 17 → 18 本）
- **kit の `save<T>(h, key, v)`** が型引数を受け取る（`load<T>` は前から）：`save<Home>(...)` が TS2558 で止まっていた
- **sim と実機の食い違いを 3 つ**：
  - パックのモブが死ぬと、そのモブ自身の loot table のとおり落とす（前はバニラの実測だけで、パックのモブは何も落とさなかった）。パックのアイテムも落とせる
  - `@A attack` が手に持った武器の威力で当たる（ダイヤの剣 8、パックの `minecraft:damage`。前は素手の 1 で、体力 6 のモブが死ななかった）
  - `@A eat` が実機と同じ順：itemStartUse → 使用時間（use_modifiers、既定 1.6 秒）の後に食べ物のコンポーネント・itemCompleteUse → 1 個減る → itemStopUse。前は world の itemCompleteUse が来ず、減りもしなかった。飲んだ薬の効果とビンの戻り方が実機と一致するのを確認
  - `js` 行の `dim` が実機と同じくオーバーワールドそのもの（前は sim だけ関数で `dim.getEntities is not a function`）
- 作業台でのクラフト（`@A craft_at`）は sim ではまだ飛ばす（実機の go では動く：作業台で本物のクライアントが作るのを確認）
- テスト：sim-offline 25 → 27 項目

## v1.9.0 (2026-10-03)
バックログの依頼 2 件（毎日ログインボーナス、釣り大会）を、AI と同じく AGENTS.md だけを頼りに最初から作り、つまずいた所をラボの側で直した（どちらも実機 BDS 1.26.52.3 で DONE、壊した版は sim と go の両方で同じ節が落ちるのを確認）。
- **テストの `clock +1d`**（`+3h` `+90m` `-30s`）：アドオンの Date（Date.now・new Date）がそれだけ進む。ワールドに保存するので /reload と再起動をまたいでも戻らない。前は「次の日」をテストする方法が無く、AI がアドオン本体にテスト用の抜け道を埋めるしかなかった。sim も同じ（sandbox-be の時計に `clock` 操作、再起動の後も時刻が続く）
- **`@A fish` が本当のことを言う**：浮きが地面に落ちても、ほかのプレイヤーに刺さっても「当たり、引き上げた」と言い、何も釣れていないのに分からなかった。今は「浮きが grass_block（x y z）に落ちた、水ではない（約 10 ブロック先：fill -8 -64 2 8 -61 24 water）」「浮きが B に引っかかった（同じ場所に出るので tp B 4 -60 0）」「caught cod」「釣れなかった」を言い分ける。`help verbs fish` に水場の作り方、enchant A lure 3（1 匹 約 8 秒）、ガラクタも釣れるので数を決め打ちしないこと
- **sim の `until <regex> [ms]` が待ち時間を守る**：前は何を待つにも 2 秒で、10 秒のタイマーを待つ節が sim だけ失敗していた。2 秒で見つからないときだけ、行が出た時刻を 1 回の実行で調べ、その分だけ待つ（後ろの操作はその直後：クールダウンの時間はずれない）。実機と同じく直前のコマンドからの出力を見る
- バックログ：「why が走らなかったフックの登録行を添える」は既に行範囲付きで出ているので完了に
- AGENTS.md：tests.txt のコマンドに `clock +1d|+3h`（+28 トークン）
- テスト：sim-offline 23 → 25 項目（clock と再起動、10 秒後の行を待つ until）

## v1.8.0 (2026-10-03)
sim（約 1 秒の下見）が飛ばしていた操作を実機の測定値で動かし、AI が読み違える出力に直し方を添えた（実機 BDS 1.26.52.3 で、正しい版とバグ版の両方で sim と go の判定が一致するのを確認）。
- **sim が `@A walk` / `@A goto` / `@A leave` → `@A join` を実行する**（前は節ごと飛ばしていた）：
  - walk：実機で測った速さと向き（前進 20 tick で +z に 4.3 ブロック、左は +x）。数字はブロック数でなく tick 数（実機と同じ）。4 tick ごとに少しずつ動くので、プレイヤーの位置を見るスクリプト（エリアに入ったら…）がその途中を見る
  - goto x z：直線で（実機は道を探す）。移動を含む節の失敗は `?` UNSURE（物理までは再現しない）
  - leave → join：持ち物・保存データ・タグ・位置を持ったまま戻り、playerSpawn（initialSpawn）がもう一度来る（実機で確認：`@A joined 4 -60 4`）。「再参加でアイテムをもう一度もらえてしまう」不具合が sim でも実機と同じ節で落ちる
  - sandbox-be：`join` 操作（抜けたプレイヤーが戻る）、`move` の相対移動（by）と高さを保つ移動
- **`~` の正規表現で `*` `(` などをエスケープし忘れたとき**（`~ minecraft:bread*2`）：その文字列がそのまま出ているのに外れた、と言い、どの文字をエスケープするかか `=` を使うよう 1 行添える（go・test・sim）。前は want と got が同じに見えるのに失敗し、AI が原因を探し回っていた
- **型エラーに Script API の直し方**：`'string' is not assignable to parameter of type 'ItemStack'` → `new ItemStack('ns:id', n)` か kit give、`possibly 'undefined'` → 先に確かめる（kit inv(p)）、`Property 'x' does not exist on type 'Y'` → `api Y`、`has no exported member` → `api ?X`、`Cannot find name` → import 元
- **Endstone：pyproject に書いた PyPI の依存を go の前に入れる**（入っていないものだけ、1 回）。前は `lib add` で足したときしか入らず、同梱の qrmap（qrcode を使う）が新しいラボでは読み込みに失敗していた
- **Endstone：Python のトレースバックを 1 行に**：サーバーのログでは 1 行ずつの E 行（それぞれに `(during: boot)`）で、10 行で切られて肝心の例外が出ていなかった。今は `E <Endstone がしていたこと>: KeyError: 'size' (plugins/x/src/…/plugin.py:14: SIZE = _CFG["size"])`。連鎖した例外は最後のものとプラグイン自身の最後の行（同じ失敗で 925 → 692 トークン、原因が見える）。「読み込めなかった」の案内も「上のエラー（無ければ entry point と api_version）」に
- 確認：同梱の Endstone プラグイン 19 本すべてが実機 go で DONE（qrmap は上の修正の後）
- テスト：sim-offline 20 → 23 項目、upkeep-offline 36 → 37 項目、pytb-offline 3 項目（新規、ゲートに。ゲート 16 → 17 本）

## v1.7.0 (2026-10-03)
AI が「go → why → 直す」と回すターンを減らし、sim（約 1 秒の下見）が実機と食い違う場面をさらに潰した（どれも実機 BDS 1.26.52.3 で、壊した版と直した版の両方で sim と go の判定が一致するのを確認）。
- **go が失敗したら why を自分で回す**（失敗に src/ の行が出ていないときだけ。約 25 秒）：「代わりに何がどの行から出たか、その時の値、本来出すはずの行が走ったか、次の一手」が go の答えに入る。前は go の後にもう 1 ターン `why` が要った。why の ✘ 行は go の ✘ と重ねない。`LAB_GO_WHY=off` で止まる
- **sim が `restart` を実行する**（前は節ごと飛ばしていた）：再起動の前までを動かし、サーバーが残すもの（世界とプレイヤーの保存データ・持ち物・タグ・置いたブロック・スコアとサイドバー）を引き継いで、スクリプトを読み込み直して続ける（メモリに持っていた値は消え、プレイヤーは `@A rejoined`）。「再起動後も覚えている」の不具合（Map に持っただけ）が sim でも実機と同じ行で落ちる
- sim：カスタムフォーム（`@A form ["Steve", "green", true]`、ドロップダウンは選択肢の文字でも、入力 1 つなら括弧なし）。前は「ボタンが無い」で飛ばしていた。ラベル等の位置は値なし（実機と同じ `null`）
- `@A interact x y z` / `@A attack x y z`（ブロックを指したよくある書き間違い）：実機も sim も useon / dig として行い、そう 1 行で言う。前は実機が `no 2 in view`、why が「コンポーネントを確かめて」と別の方向を指していた
- why：`@A join` が前の節で入ったプレイヤー（`already joined`）のとき、playerSpawn を「走らなかった」と言わない。✘ の got に後の `js` 行の値を混ぜない（非同期で後から届くメッセージは今まで通り拾う）
- go：✘ のブロックで見せた `fix:` を、その E 行の下で繰り返さない
- `add`：知らない tex= は何も書く前に 1 行で止める（前はブロック定義と名前だけ書いて途中で落ち、スタックトレース 4 行も出ていた）
- sandbox-be：レポートに `carry`（再起動で残るもの）、`world.dynamicProperties` / `objectives` / `displaySlots` と、エンティティ・プレイヤーの `dynamicProperties` を初期状態として受け取る
- テスト：sim-offline 17 → 20 項目（restart で残るもの・消えるもの、カスタムフォーム、座標の interact）。同じ期待値を実機 BDS でも流して一致を確認

## v1.6.2 (2026-10-03)
実機 BDS 1.26.52.3 で新しいアドオンを作って `go` を回し、AI が無駄なターンを使う原因を潰した（どれも実機で再現→修正→実機で確認）。
- **QA の誤検知を修正**：フォームを開かないコマンドにも「開いたフォームを閉じる」検査が走り、ラボ自身の `E @QA form: none open` を「アドオンの問題」として出していた（コマンドのあるアドオンのほぼすべてで `qa 1 problem` になり、直しようのない問題を AI に追わせていた）。フォームを開くコマンドの本物の不具合（閉じると ask() が undefined）は今まで通り出る
- QA のエラーが `main.js:131`（ビルド後の行）だった → `src/main.ts:15`（QA は go の別プロセスで、ソースマップを読んでいなかった）
- QA のフォーム検査を端値の呼び出しより前に：端値の呼び出しが開いたままにしたフォームを次のコマンドの検査が閉じ、別のコマンドのせいにしていた（同じ不具合が 2 件、片方は無関係なコマンド名で出ていた）
- **sim を実機に合わせた**：
  - `##` 節を実機と同じく 1 つの世界で順に実行（前は節ごとに新しい世界で、クールダウン・保存データ・アイテムが次の節に残る実機と食い違い、「sim は通るのに go が落ちる」になっていた）。単独なら通るのに通しで落ちる節は「前の節が残した状態」と言う
  - `@A join` が実機と同じ `@A joined x y z`（2 回目は `@A already joined`）を出す。前は何も出さず、`new` が作る `## loads`（`~ joined`）が sim で必ず失敗していた
  - スクリプトのエラーに、投げた src/ の行とそのコードを添える（`threw src/main.ts:6 TypeError: … | const last = hist.day;`）。同じエラーの `E` 行は繰り返さない。前は `E system.run#1: …` だけで、行を知るのに `why` がもう 1 回要った
  - sandbox-be：`ScoreboardObjective.getScore` はスコアを一度も持たないプレイヤーで `Failed to resolve identity for 'A'.` を投げる（実機で測定。`hasParticipant` は false、`addScore` で参加者になる、別の目的で参加済みなら undefined）。前は 0/undefined を返し、実機だけで落ちていた
- 実行時ヒントに `Failed to resolve identity`（addScore か hasParticipant を使う）
- `.ignore`：生成物の表 `bds/docs/EVENTS.md` `VERBS.md`（`help verbs` が引く）を検索から外す（give / inventory / player の検索結果が約 3 割減る）
- `.claude/settings.json`：新しい Claude Code の道具（TaskCreate 系・AskUserQuestion・プランモード・Cron・Worktree・Monitor・LSP など）も外す（毎ターン送られる道具の定義）
- AGENTS.md：節は 1 つの世界で順に実行されること、kit の `inv(e)`（+24 トークン）
- テスト：sim-offline 15 → 17 項目（節の通し実行、join の行、投げた行、スコアボードの実測）

## v1.6.1 (2026-10-02)
- `app token` / `login google`：ログイン中の Ctrl-C で止まらず（Playwright が SIGINT を受けてブラウザだけ閉じていた）、手で貼る方法に進んだうえ「setRawMode EIO」の「ラボの不具合かもしれません」で落ちていた。Ctrl-C でその場で止まる（終了コード 130）。端末を失った後の入力（EIO）はどこでも「中断しました」の 1 行で止まる。入力の実装は `common/secrets.mjs` の 1 つに
- `app apk fetch`：Play が何も返さない（apkeep が何も保存せずに終わる）とき、利用規約に同意してもう一度のあと、ほかの arm64 端末プロファイル（sm_s25u・nothing_p1・sm_s20_plus。apkeep の端末一覧から）でも試す。取れた端末を言い、取れなければ試したものを並べる。`APP_APK_DEVICE` を指定したときはそれだけ
- `app secrets --repo <owner/名前>`：そのリポジトリが GitHub に無いときは「無い」と言い、secrets は GitHub Actions で使うときだけ要ること、作り方（`gh repo create ... --source . --push`）を出す（前は同じ「--repo を付けてください」を繰り返していた）

## v1.6.0 (2026-10-02)
- **パック JSON を Mojang の `@minecraft/bedrock-schemas` で検査**（`common/schema.mjs`、`check` / `go` のビルドのたび）。スキーマはバニラでも誤検出が出るため、bedrock-samples 1.26.50.4 の 7,171 ファイル＋ラボの実機検証済みパックで較正（`common/data/schema-calibration.json`、145 KB）：バニラが破る節点×キーワード 76 件は出さない、E はバニラが通る節点（3,608）の型・enum・必須だけ、知らないキーは W（近いキーを示す。`filters → all_of` のように同名の別の場所で載っているキーは誤字扱いしない）、`"1.2.3"` と `[1,2,3]` の版・独自コンポーネント（`ns:x`）・古い平たい sound_definitions は受ける
- アイテムのコンポーネントはスキーマに中身が無い（`{type: object}` だけ）ので forms/item_components から組み立てる（型・別の型・選択肢 30 以下・必須・サブフォーム）
- 実機 BDS 1.26.52.3 で確かめた、スキーマに無いが定義ごと読み込まれない規則を E に：ブロックの `light_emission` / `light_dampening` 0〜15（permutations も）、`max_stack_size` 1〜64、format_version 1.20 以降の shaped / shapeless レシピの `unlock`。E の型の誤り（nutrition "4"・seconds_to_destroy "slow"・friction "high"・menu_category "gems"・damage_sensor の配列）も実機の内容ログで読み込み失敗を確認
- 同梱の training/mpvpbot で実際の不具合を検出（damage_sensor を配列で書いた 6 体は実機で「child '' not valid here」、`generatesBubbles` などゲームが無視するキー多数、`kz.png` の中身が JPEG）。訓練用の資料なので手は入れていない
- テスト `tests/schema-offline.mjs`（24 項目。実パッケージがあればラボの同梱パックと植えた誤りも）をゲートに。`help schema`
- **軽量化（34.8 MB / 1,384 → 21.7 MB / 1,048 ファイル、zip 9.4 MB → 6.0 MB）**：bedrock-binary の生成物（`profiles/` `reports/`、7.6 MB。上流も「bds-lab の写しには入れない」としている）と単独リポジトリ用の CI・文書・連携例、sandbox-be の CLI・テスト・較正ツール・文書・例（ラボは `src/` `data/` `types/` だけを使う）、TS REPL の上流ソース `source/`（配布物と重複、`share` でも外していた）、ラボ直下と同じ AGENTS.md を読ませるだけの `bds/AGENTS.md` `bds/CLAUDE.md` `bds/GEMINI.md`（AI ツールは親の CLAUDE.md / AGENTS.md を自分で読むので二重に読み込まれていた）
- `.ignore`：検索（ripgrep 系：Claude Code の Grep/Glob・Codex など）が生成物・同梱データ・training/ を見ない
- 不具合修正：sandbox-be の `.gitignore` の `worlds/` が `src/play/worlds/*.js`（実行に要るソース 3 本）まで外していて、git から取ると欠けていた。`bedrock-binary names` が `profiles/` の無い写しで落ちていた。README の表の見出しが二重

## v1.5.0 (2026-10-02)
- bedrock-binary 2.3.0 を同梱（`bedrock-binary/`）。`node lab.mjs bb`：ラボの BDS の実行ファイルをそのまま読み（約 3 秒、ダウンロード無し。Windows のラボは同じ版の Linux 版を 1 回だけ）、文書に無いもの——パケット ID・enum（ダメージ原因・エンティティ種別・切断理由 …）・Mojang の文書に無いコマンド・WSS イベント・スクリプトのモジュール——を引ける（`bb packets` / `bb enum` / `bb strings` / `bb site` / `bb apk`）
- **パケット ID は各パケットクラスの `getId()` の機械語から読む**（`mov eax, 9; ret` の即値。RTTI の型名 → typeinfo → vtable とたどる）。`MinecraftPacketIds` の値の並びは ID ではなかった：削除された番号が抜け（134 から後ろが 1 つずつずれる）、200〜299 は予約、新しいパケットほど順番が合わない。並びの何番目かを ID にしていたため、134 番から後ろの約 100 個がまちがっていた（例：CameraInstruction は 300 なのに 201）。1.26.52.3 の 231 個は、Mojang のプロトコル文書に載っている 209 個とすべて一致し、残り 22 個も PrismarineJS の表と一致（1.21.124.2・1.21.130.28・1.26.51.1・1.26.60.29 でも食い違い 0）。`proto` が Mojang の文書を取ってあれば、`bb` はそれとも照らし合わせる
- `bb diff` / `upkeep`：パケットの増減・番号の変化・同じ番号でクラス名だけ変わったものを getId() の番号で。enum の増減は型名が確かなものだけ数える。本物のバイナリで確認：release 1.26.52.3 → preview 1.26.60.29 は「packets +8（353〜360）、番号の変化 0」
- 古いラボのプロファイル（パケット ID の無いもの）は自動で読み直す。読み直せないときはそのまま使い、ID が無いことを言う。`bb diff <a.json> <b.json>` などの相対パスが bedrock-binary のフォルダ基準になっていたのを直した
- `bb commands`：文書に無いコマンド 25 個を、この BDS で 1 回ずつ試して分ける（実測 1.26.52.3：動く `listd` `clearrealmevents`、引数が要る `querytarget` `gettopsolidblock` `serveridentity` `agent`、この BDS には無い 19 個）。`doc /<コマンド>` も同じことを言い、sandbox-be はそれらを「知らないコマンド」でなく「未再現」と言う
- `upkeep`：Minecraft の更新のあと、新しいバイナリで何が変わったか（パケット、コマンド、番号のずれた enum）を 1 行で（`bb diff --short`）
- bedrock-binary の不具合をほかに 2 つ直した：同じ名前の enum が 2 つできていた（1.26.52.3 で 12 組、差分や名前での検索が片方を捨てていた）、diff が名前の変化を増減として出していた。テスト 104 → 123（本物の clang++ / ld.lld で作った x86-64・arm64 のライブラリからパケット ID を読むものを含む）
- **配布・受け渡しの zip から `common/nethernet-connect/dist`（`lan` が動かすコード）が落ちていた**：`dist/` をすべて「作り直せる出力」として外していたため（`share`・`handoff`・`patch`・`.gitignore`）。`common/` の下の取り込んだコードの `dist/` は残すようにした。この作業フォルダにはもう無いので、`lan` を使うときは nethernet-connect から取り込み直す（`node scripts/vendor.mjs <このラボ>`）
- CI（verify.yml）：ゲートのテスト一式（`node lab.mjs auto gate`：bb・share・auto・sim・ts など 15 本）を回す。前は 9 本が CI で動いていなかった。`lan-offline` は最後に（nethernet-connect が無いと一行でそう言う）
- テスト `tests/bb-offline.mjs`（bb と bedrock-binary 自身のテスト）をゲートに

## v1.4.0 (2026-10-02)
- sim：`js <式>` の行もサンドボックスで動く（サンドボックスには eval が無いので、節の js を先にモジュールにして入れる。道具 `p` `inv` `mob` `hit` と値の形は実機と同じ。実機の test と突き合わせて一致）。`@A attack <mob>` / `@A interact <mob>` も（武器の威力までは再現しないので、合わない節は「はっきりしない」）
- sim：全員へのメッセージ（world.sendMessage・/say）を実機と同じく 1 行で（前は `@A …` で、実機向けに書いたテストと食い違っていた）
- 動いているサーバー：TS REPL のコンパイラを起動時に読み込んでおく（最初の `ts` が約 5 秒 → 0.3 秒）。自分の Minecraft で入った人には TS REPL の権限とコンソールのアイテムを自動で渡す（ラボのボットには渡さない）
- `ts`：TS REPL が居ないときの理由を言う、`ts join` は Minecraft の版が合わないときの直し方も
- AGENTS.md：編集の合間の `sim`（約 1 秒の下見）を 1 文で（全体 +48 バイト）

## v1.3.0 (2026-10-02)
- `node lab.mjs ts`：動いているサーバー（`up`）の TS REPL を外から動かす。書いたコードをその場で世界に流す（ゲーム内蔵の TypeScript で型を調べてから。再起動も /reload も /reload all も無し）。ファイルごとに常駐（subscribe・runInterval）を持ち、もう一度流すとその分だけ入れ替える
- `ts hot`（保存するたびに入れ替え）・`ts stop`・`ts check`・`ts state`・`ts save`（`// @on <event>` / `// @every` / `// @join` で世界に常駐、すぐ効く）・`ts pull` / `push` / `sync`（ワークスペース `ts/` とゲーム内エディタを両方向に）・`ts watch`（作者がどう遊んだかを 1 行ずつ）・`ts join`（自分の Minecraft で入る方法）・`ts try`（同じコードを sandbox-be で、サーバー無し）・`ts promote`（うまくいったスクリプトを正式なアドオンに。実機の go で確認）。見本 `ts/examples/` 6 本
- 動いているサーバー：空いていれば Minecraft と同じポート 19132 で立てる（サーバーリストに登録したまま使える）、`up` が参加先を出す、人が入っている間は止まらない。TS REPL の答えは id で待つので、`ts` を同時に何本動かしても取り違えない（`/tsr`）、`watch` / `hot` は他の `do` の出力を奪わずに読む（`/peek`）
- TS REPL（`bds/addons/ts_repl/lab/patch.py`）：コンソールからの要求を持ち主として受ける・誰もいなくても動く・常駐の入れ替えと後から出るログ・ブリッジでの保存がすぐ効く・保存時刻。**不具合修正**：BDS 1.26.52 で `import { world }` からの購読がすべて「proxy: inconsistent get」で落ちていた。テスト 14 → 24 項目（実機 go で合格）
- 案内：`help ts`、README「動いている世界でそのまま作る」（使い道 12 通り）。AI が毎ターン読む AGENTS.md は 1 行足しただけ（全体は +24 バイト）

## v1.2.0 (2026-10-02)
- 便利系アドオン（`common/data/samples.json` の `utility`：TS REPL）を、ラボの遊ぶためのサーバー（`up`・`live`・`serve`。bds / end / ll とも）に毎回自動で入れる。試験のサーバーには入れない（結果が変わらないように。`LAB_UTILITIES=all|off`）。`status` に道具の状態
- `node lab.mjs deploy <BDS のフォルダ> [<ユニット>]`：自分の BDS に便利系とユニットを入れ、設定も合わせる（ワールドのパック・`permissions.json` のモジュール許可・`level.dat` のベータ API）。変える前を全部残し `--undo` で戻す、`--dry` で見るだけ。実物の BDS で確認
- 自動メンテナンスの入口を `node lab.mjs upkeep` ひとつに：点検 → 片付け → 最新版で全ユニットを試験・修理 → 結果と次の 1 コマンド。`--check` は何も変えない、`--auto daily` で毎日。ネットワークで調べられなかったものは問題と分けて出す。自動操縦の保守もこれ。README の先頭に「迷ったらこの 3 つ」（status / upkeep / clean）
- `node lab.mjs c2s "<コマンド>" ...`：cmd2script（cmdscript-be）でバニラのコマンドから Script API のコード、`--check` でサンドボックスでコマンドとコードの結果を突き合わせる（AI もトークンも使わない。cmdscript-be のフォルダを置くと使える）
- sandbox-be：セレクタ `hasitem`（実機で測った 13 通りと一致）、プレイヤーが打った `give` の知らせ（実測の形）、パックのブロックの give・置くと 1 つ減る・空の手で触れる（実測）、`@minecraft/server 2.11.0-beta`・`@minecraft/server-ui 2.2.0 / 2.3.0-beta` の形、`Player.commandPermissionLevel` の代入、`npm run up`
- sim：`@A select` / `use` / `useon` / `place` / `dig` / `eat` もサンドボックスで（前は飛ばしていた）、パックのアイテム・ブロック・エンティティも渡す、フォームも § を落として実機と同じ形に、安定版の指定にベータの形を当てない。TS REPL は UNSURE 2/3 → PASS 5/5（全節）
- TS REPL：コンソールのアイテムとスクリプトブロックのテストを追加（go の「どのテストも触っていない」が消える）
- ll：ネットワーク無しのビルド（TypeScript だけで束ねる）でも、スクリプトのエラーが `src/main.ts` の行を指す（ソースマップを作る。前は束ねた後の行だった）
- JSON UI Demo：`/lab:menuall`（コンソールから全員に開く）のテストを追加
- スペクテイターの入力記録（spectator_probe）は training/ へ（訓練・検証用）。配布 zip の検証と自動操縦のゲートを 1 つのリストに。`handoff` は dist/（go で作り直せる .mcaddon）を入れない

## v1.1.0 (2026-10-02)
- アドオン：TS REPL v6.11.0 を bds/addons/ts_repl に（配布物そのもの＋上流のソース。重複は省いた）。PvP ボット 4 つと RTA のスクリプトは training/ へ（テスト・点検・自動操縦・配布の対象外）
- sandbox-be を同梱、`node lab.mjs sim`：tests.txt をサーバー無しで 1 節 0.2〜1 秒（`watch --sim` も）
- `node lab.mjs status`（全体の状態を 1 回で）、`node lab.mjs clean`（作り直せるものを消して空きを作る）。maint の点検に「終わったベンチ・古い BDS 用の置き場・古いチェックポイント・BDS の zip と展開の 2 重」
- トークン：`.claude/settings.json` で使わない道具を外す（1 ターンの土台 33,065 → 6,146）。ベンチ：ショップ 281,283 → 76,457、投票 148,475 → 63,810、スライム 182,642 → 83,750（どれも合格）
- 品質：ユニットのフォルダでも `node lab.mjs` が動く／`until` を確認として数え、確認の無い tests.txt は失敗に／フォームのドロップダウンを選択肢の文字で答えられる・入力 1 つのフォームは括弧なしで／答えられないフォームは `E` 行で go に出る／`new` の案内にフォルダからのパス
- BDS：`@minecraft/common` `@minecraft/server-net` を使うアドオンが読み込まれなかった（permissions.json）→ 試験のサーバーで許可。JSON UI の検査がバニラの画面を上書きするファイル・サブフォルダの名前空間を誤って警告していた。名前が日本語やラングキーのパックの .mcaddon が `_` `pack_name` になっていた
- app：`login google` がアドレス → パスワードの順に聞く（アドレスが無ければパスワードは聞かない）、zip.js の警告が質問に割り込んでいた。`app apk fetch` が何も保存せずに終わったとき、規約同意でやり直し・原因・全文の記録。`app secrets --repo <名前>` に持ち主を補う
- ベンチは記録したら作業フォルダ（数百 MB）を消す。パッチ用の控え（.lab/base）を大きい・バイナリのファイルで作らない

## v1.0.0 (2026-10-02)
- 自動操縦 `node lab.mjs auto`：何をやるかを AI が決め、作り・直し・確かめ・レビューし・main にマージし・配布する（11 種類の仕事、台帳から学ぶ点数、教訓、非常停止とトークン上限は人の床）
- 配布 `node lab.mjs share`：自分のユニット・キャッシュ・鍵を含めない bds-lab 本体のリリース zip（鍵の検査、単体で動くかの検証、同じ中身なら同じ zip、GitHub Release）
- トークン削減：Claude CLI の 1 問 32,488 → 1,339、`make --via claude` の 1 ターン 36,488 → 9,832（実測）。自動操縦は迷うときだけ AI に選ばせ、機械的な変更はレビューに AI を使わない
- `update` が自動操縦の記録と設定を上書きしないように
- `maint` の漏れ検査：Google だけでなく Anthropic / OpenAI / GitHub / Slack / Discord / AWS の鍵、秘密鍵、`.env` に書いた値そのものも
- `make`：新しく作るときにも追加の文脈（教訓）が届くように、`--context` と `LAB_MAKE_CONTEXT` の両方が届くように
- `maintain --pr` が元のブランチに戻るように、stable への移行の記録はネットワーク不調で残さないように
- GitHub の Issue から作る（ci.mjs）：gh がエラーを返したときに落ちていた不具合を修正
