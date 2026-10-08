# 管理パネル（panel/）

作者と、GitHub Actions の時間を貸し借りする人（ホスト: [docs/guide/host.md](../docs/guide/host.md)）のためのページです。
リポジトリだけで動きます: 1 枚の静的なページが、見る人のトークンで GitHub の API と話すだけです（パソコンもサーバーも要りません）。

## 開く

リポジトリの Settings → Pages → Build and deployment → Source を「GitHub Actions」に。あとは既定の枝で `panel/` が変わるたびに
`.github/workflows/pages.yml` が `https://<owner>.github.io/<リポジトリ>/` に置きます（Actions → pages → Run workflow で今すぐ）。
ページ自体は誰でも開けますが、トークンなしでは何も読まず、何もできません。

## 入る

GitHub の Settings → Developer settings → Personal access tokens → **Fine-grained tokens** で作ります（パネルの「トークンを作る」
が入れ物を開きます）。Repository access: ラボのリポジトリと、貸し借りのホストだけ。Repository permissions:

| 権限 | 使うところ |
|---|---|
| Actions: Read and write | 進み具合・実行・止める・やり直す・成果物 |
| Contents: Read and write | ワークフローの入力・ホストの `.lab-host.json`（貸し手が条件を変える） |
| Secrets: Read and write | 秘密の名前の一覧・登録・消す（値は GitHub も返しません） |
| Variables: Read and write | Discord に知らせる実行と、添える成果物（`LAB_NOTIFY`・`LAB_NOTIFY_FILES`） |
| Issues: Read and write | 端末（ライブの issue に命令を書き、返事を読む） |
| Pull requests: Read | 概要の開いている PR |

足りない権限の操作だけ「権限がありません」と出ます（Read だけのトークンなら見るだけのパネルになります）。Fine-grained トークンが
選べるのは 1 つの持ち主（自分か、入っている組織）のリポジトリだけです。ほかの人の個人アカウントにあるホストを借りるときは
**Classic トークン**（`repo`・`workflow`）を使います（パネルはそのホストを「このトークンでは見えません」と教えます）。

**入れる人**: ラボのリポジトリに書き込める人（Write / Maintain / Admin）か、ホストの持ち主（貸し手）か、ホストに書き込める人
（借り手）。ほかのトークンでは「使えません」で止まり、何も読みません（貸し手の初めての訪問では、その人のリポジトリから
`.lab-host.json` のあるものを先に探します）。

## いくつものアカウント

右上の「＋」で、作者・貸し手・借り手などのアカウントを同じブラウザに加え、上の一覧で切り替えます。それぞれのトークンと設定
（ラボのリポジトリ・ホストの一覧・読み直す間隔・APP_CACHE_KEY）は別々で、ほかのアカウントのものは使いません。「覚える」を外した
アカウントは、そのタブを閉じると忘れます。「出る」はそのアカウントだけをこのブラウザから消します（トークンそのものは GitHub で
取り消すまで有効です）。Discord の知らせの「管理パネル」ボタンは、その実行のあるラボのアカウントで、その実行を開きます
（`#runs?repo=<owner/repo>&run=<番号>`）。

## どこの Actions で走らせるか

「実行」の一番上で選びます:

- **このラボ**: ラボ自身の Actions（いままでどおり。ワークフローの入力はその YAML から）。
- **貸し手のホスト**: その人の Actions の分で。貸す条件（`.lab-host.json`）が許す仕事だけ、時間帯・最後の日の中、今月の分が上限の
  80% に届くまで（GitHub が数えたホストの host.yml の実行: ほかの借り手の分も入ります）。始めると、ラボの `.github/workflows/hostrun.yml`
  が `node lab.mjs host ci` で、ラボを `host run` と同じ中身でホストに送り、host.yml を始めます。「結果を待つ」なら、ホストの結果が
  その実行の結果・まとめ・注釈・成果物（`hostrun-result`: go の .mcaddon も）になり、notify が Discord に知らせます。
  要るもの: ラボの秘密 `LAB_HOST_TOKEN`（ホストに push でき、ワークフローを始められるあなたのトークン。Classic: `repo`・`workflow`
  ／ Fine-grained: ホストの Contents・Actions・Workflows を Read and write）。パネルが足りないと言い、「秘密」で入れられます。
  ラボが公開リポジトリなら、待つ間のラボの Actions に分は掛かりません。

## Discord

「Discord」のタブで: つなぐ秘密（`DISCORD_BOT_TOKEN`・`DISCORD_USER_ID`、またはボットのかわりに `LAB_NOTIFY_WEBHOOK`）をその場で
封じて登録、どの実行を知らせるか（変数 `LAB_NOTIFY`: auto / all / failures / off）と、何を添えるか（`LAB_NOTIFY_FILES`: auto =
.mcaddon・.mcpack・.mcworld・.mctemplate / off / `*.zip` のような型）、試しに送る・いちばん新しい成果物を送る・端末をスマホで・
秘密を Discord のフォームで。

notify は、終わった実行の知らせに、その実行の成果物から合うファイルを 10 MB まで添えます（変数 `LAB_NOTIFY_MAX_MB`、Discord の上限
まで。入らないものは名前とサイズを書き、「成果物」のボタンから取れます）。添えるのは、このリポジトリのコードの実行だけです:
フォークからの PR の実行も notify を起こしますが、そのファイルは渡しません。「成果物」のタブ・実行の詳しくの「Discord に送る」は、
その実行を LAB_NOTIFY によらず送ります（notify を `run` の入力で）。

## 守っていること

- トークンは、そのブラウザの中（「覚える」なら localStorage、外せばそのタブの間だけ）。送り先は `api.github.com` だけです:
  ページの CSP（`connect-src https://api.github.com`）がほかへの通信を止めます。スクリプトはページ自身のものだけ、文字は
  文字として置き（HTML として読まない）、インラインのスクリプトもスタイルもありません。アドレスの `#…` から読むのは、タブの
  名前・owner/repo の形・数字だけです。
- 秘密の値は、その場でリポジトリの公開鍵で封じてから送ります（libsodium の sealed box と同じ。`lib/seal.mjs` を libsodium の
  出力で試験）。表示も保存もしません。
- 公開リポジトリの端末: 命令と返事は vault の鍵（`APP_CACHE_KEY`）で封じたまま issue に書かれます。パネルの設定にその鍵を
  入れると、パネルがその場で封じ・開きます（WebCrypto。`lib/vault.mjs` はランナーの app/lib/vault.mjs と同じ形）。
- 端末の命令が効くのは、その実行を始めた人のコメントだけ（ランナーの側で決まっています）。返事として見せるのは、その実行の
  ボット（github-actions[bot]）のコメントだけです。
- hostrun: ホストから戻る言葉（結果の行）は、ラボのランナーで workflow の命令として読まれないように `::stop-commands::` の中で出します。

## 中身

| ファイル | |
|---|---|
| `index.html` `panel.css` `panel.js` | 画面（スマホが先。明るい・暗いどちらも） |
| `lib/accounts.mjs` | このブラウザのアカウント（それぞれのトークンと設定、使っている 1 つ、前の版の 1 つのトークンの引き継ぎ） |
| `lib/model.mjs` | 誰が使えるか・それぞれの設定でできること・ワークフローの入力・進み具合・ホストの条件と分（common/hosts.mjs と同じ判定）・ホストで走らせる入力・アドレス |
| `lib/gh.mjs` | GitHub の API（その人のトークンで） |
| `lib/seal.mjs` | 秘密を封じる（X25519・XSalsa20-Poly1305・BLAKE2b、ライブラリなし） |
| `lib/vault.mjs` `lib/livefmt.mjs` | ライブの issue の行（封じる・開く・読む） |
| `lib/pages.mjs` | 端末のボタン（Discord の DM と同じ表: app/lib/live.mjs も使う） |

試験: `node tests/panel-offline.mjs`（部品・notify と成果物）・`node tests/panel-browser.mjs`（本物のブラウザで: CI の verify が走らせます）・
`node tests/host-offline.mjs`（`host ci`: hostrun の中身）。
