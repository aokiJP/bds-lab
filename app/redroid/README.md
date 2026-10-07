# app/redroid: コンテナの Android（redroid）で、起動から 30 秒以内にデバッグできる端末

読む人: app/ を速くしたい人（人でも AI でも）。app/ の本体の設計は ../DESIGN.md。

## なぜ redroid か

app/ はいま、エミュレータ（VM）のスナップショットを戻して本物の Minecraft を動かしている: 端末のキャッシュ 7.5 GB を
取って解読するのに 2〜3 分、戻して 16〜33 秒。redroid は VM を使わず、ホストのカーネルの上のコンテナで Android を動かす。
戻すものはスナップショットではなく **/data のフォルダだけ**で、起動は Android の普通の起動。

## app/ からの使い方

redroid は `app run` / `app ui` の端末の一つです（既定はエミュレータ）。

```
node lab.mjs app redroid local [--dry-run]      # 手元の Linux で準備を 1 回で（doctor → binder → イメージ → open / prep）。GitHub Actions は使わない
node lab.mjs app redroid doctor                 # 足りないもの（docker・binder・overlay・sudo・adb・python3・イメージ・準備済みの端末）と直し方
node lab.mjs app redroid setup                  # イメージ bdslab/redroid:gapps（redroid 14 + MindTheGapps）
node lab.mjs app redroid prep                   # 準備済みの端末（app/redroid/.lab/data）を一度だけ: GOOGLE_EMAIL + GOOGLE_AAS_TOKEN が要る
node lab.mjs app redroid warm                   # 端末を起こしてゲームをタイトルで待たせておく（次の run / ui はすぐ始まる）
node lab.mjs app run -a <アドオン> --device redroid [--no-keep] [app run の指定 …]   # = APP_DEVICE=redroid node lab.mjs app run -a …
node lab.mjs app ui  -a <アドオン> --device redroid [--all] [--screens …]
node lab.mjs app redroid down                   # 残した端末を止める
node lab.mjs app redroid seal / open [--file f] # 準備済みの端末を暗号化して 1 ファイルに / そこから戻す（root で）
node lab.mjs app ci --device redroid -a <アドオン> [--mode run|ui] [--bench] [--keep] [--fresh] [--wait]   # GitHub の redroid.yml
node lab.mjs app ci watch|fetch <番号> --device redroid                       # 待って / すぐ、成果物と注釈を app/runs/gh-<番号>/ へ
```

常駐: 手元では run / ui の後も端末を残すのが既定（`--no-keep` で止める。GitHub Actions では `--keep` のときだけ残す）。
残した端末（コンテナが動いていて boot_completed）があれば、次の `--device redroid` は戻さず起動もせずにそれを使い、ゲームが
タイトルに居なければ起動し直すだけ。タイトルまで着かなかった端末・起動の途中で止めた端末は残さない。APK は版（versionCode）が変わったときだけ取り出し直す。常駐の端末を使うのは、
同じ準備済みの端末（--data）と同じイメージから起こしたときだけ（コンテナのラベル bdslab.from / bdslab.image）。

端末を起こすコマンド（prep・bench・run / ui）は 1 台に 1 つずつ（app/redroid/.lab/device.lock: 2 つ目は誰が使っているかを
言って止まる。終わったプロセスの鍵は引き継ぐ）。Ctrl+C やジョブの終わりで止められたら、端末を止めて overlay を外す（--keep なら残す）。

`--device redroid` は、準備した /data を overlay で戻す → 起動 → ゲームがタイトルまで → 端末から APK を取り出す（版と CPU を
読むだけ）→ `app run`（`APP_SERIAL=127.0.0.1:5600` `APP_LIVE_DEVICE=1` `APP_HOST`=docker のブリッジ）→ 端末を止める。
エミュレータのための指定（`--account --vending --apk --wipe --window --no-fetch`）は、理由を言って止まります。

## 約束

- 端末のコンテナの名前は `bdslab-redroid`、adb は 127.0.0.1:5600（エミュレータの 5554/5555 とぶつからない）。
- ワークフロー redroid.yml は、手動（`app ci --device redroid` / Actions の Run workflow）か、main か claude/redroid-* の枝への
  push でコミットの文に `[redroid ci]` があり、app/redroid/ かそのファイルが変わったときだけ走る。
- **キャッシュは頼まれたときだけ保存する**（`--keep` / 入力 keep）。リポジトリのキャッシュは全体で 10 GB、いま 9.2 GB（app の
  端末 7.5 GB、SDK 1.7 GB …）。保存すると古いものから消えるので、app の端末が追い出されて app の準備が 18 分のやり直しになり得る。
  保存するのは準備済みの /data を app の vault で暗号化した 1 ファイル（AES-256-GCM、鍵は APP_CACHE_KEY か GOOGLE_AAS_TOKEN
  から。公開・非公開とも。Android の uid と xattr を保つ: tar --xattrs --numeric-owner）。読むのは毎回（あれば prep を飛ばす）。
- Google アカウントの秘密は game ジョブの準備のステップにだけ渡し、**app ワークフローが動いている間は待つ**
  （同じアカウントを二つの端末で同時に使わない。CI では数分だけ待ち、まだ動いていればアカウントの段階を飛ばす: runner は待つ間も分を使う）。Play の画面の絵（アカウントが写る）は成果物に入れない。
- **CI は自動では走らない**: 2026-10-04 にアカウントの Actions の分（支払いの上限）に達して app を含むすべてのジョブが
  始まらなくなった（この計測で約 240 分）。走らせる前に残りの分を確かめる。
- 成果物は小さな JSON と、ゲームの絵を数枚と、app run の報告だけ（3 日で消える）。同じ枝の前の実行は取り消す。

## 測ったこと（GitHub の runner: 2 CPU、7 GB、カーネル 6.17 azure、2026-10-04）

| | 時間 |
|---|---|
| binder（linux-modules-extra を入れて modprobe） | 数秒〜十数秒 |
| redroid のイメージ取得（Android 14 x86_64、ARM 変換つき） | 15〜21 秒 |
| MindTheGapps 14 x86_64（206 MB、Play 開発者サービス・Play ストア・GSF）を重ねたイメージを作る | 取得 4 秒 + build 17 秒 |
| 初回の起動（空の /data）: adb / boot_completed / ランチャー | 1.8 / 20.7 / 21.5 秒 |
| **2 回目からの起動（準備した /data）**: adb / boot_completed / ランチャー | **1.5 / 10 / 11 秒** |
| /data の戻し方: そのまま / overlay（下を読むだけ、上に書く層）/ cp -a（cp は計っただけで、いまは使わない） | 0 / 0.1〜0.2 / 0.3〜0.5 秒 |
| /data（GApps、ゲームなし）| 241 MB、zstd で 84 MB（まとめる 0.8 秒、開く 0.4 秒） |

| **本物の Minecraft 1.26.52.3 を Play が入れる**（アカウントは止めた端末の /data へホストから書く。installer も initiating も Play） | 61〜117 秒 |
| 準備の全体（初回の起動 → アカウント → checkin → Play がゲームを入れる） | 約 8 分（エミュレータは 18 分） |
| ライセンス確認（PairIP） | **通る**（Play の支払いの画面ではなく、ゲーム自身の画面になる） |
| 戻した端末でゲームを起動: プロセス / 窓 / タイトル | 3〜4 / 3.5〜4.5 / **31〜33 秒**（Google のサービスが 2 CPU を取り合う: 負荷 10 前後） |
| 戻す → 起動 → タイトル（いまの値） | **48〜50 秒**（目標 30 秒: 起動直後の CPU の取り合いを削るのが次） |

GApps なしの redroid は 2 回目から boot_completed まで 13 秒（GApps ありのほうが速いのは、runner の CPU の違いの範囲）。
/data は暗号化されていない（ro.crypto.state なし）ので、止めた端末のアカウントのデータベースをホストから書ける。

描画は ANGLE → SwiftShader Vulkan（GLES 3.1）。エミュレータと同じ種類のソフトウェア描画を、VM なしで。

## 速くするために入れたもの（2026-10、すべて実機では未計測: `app redroid bench` の表で前と比べる）

| どこ | なにを | 戻し方 / つまみ |
|---|---|---|
| 起動を待つ（redroid.mjs up） | 250 ms ごとに adb を起こし直すのをやめ、端末の中のループで boot_completed を待つ（20 秒ずつ）。段階ごとの ms を notice に | — |
| 前の端末の片付け（restore / down） | コンテナとフォルダの削除を待たずに裏で。残りは次の restore / down が掃く | — |
| BDS（game.mjs debug + app.mjs） | app run を端末の起動と同時に始め、BDS を先に上げて端末を待つ（`APP_DEVICE_READY_FILE`、上限 `APP_DEVICE_READY_MS`） | — |
| タイトルを待つ（launch） | OCR を毎 0.5 秒やめる: 窓が出てから、前回の titleS の 7 割（上限 10 秒）から、1〜1.5 秒おき。記録は .lab/title-pace.json | `REDROID_OCR_PACE=0` で前の読み方、`REDROID_TITLE_LOG`（タイトルが近い logcat の行） |
| 準備（prep） | ゲームを先にコンパイル（speed）、バックグラウンドの dexopt を止める（起動の設定 `pm.dexopt.disable_bg_dexopt=true` も）、同梱アプリをもう 1 つ止める | — |
| 常駐 | 手元では残すのが既定、`app redroid warm` | `--no-keep` |
| 優先度（boost.mjs） | ゲームの起動中だけゲームのスレッドを nice -10、ライセンスに関わらない Google のもの（gms.ui・gapps）を 10。終わったら元に戻す | `REDROID_BOOST=1` のときだけ（`REDROID_BOOST_GAME` / `_LOW` / `_LOW_NAMES` / `_EVERY_S` / `_MAX_S`） |
| 画面 | 速さ優先の小さい画面 | `REDROID_PROFILE=fast`（1040x480@187・10 fps） |
| 記録（timeline.mjs） | bench の段階ごとの秒を .lab/timeline.jsonl に、前回・中央値との差の表 | `node app/redroid/timeline.mjs` |

確かめること（実機で）: adb が docker-proxy 越しにつながる速さ、`pm bg-dexopt-job --disable` と起動の設定が Android 14 で効くか、
REDROID_BOOST がライセンス確認（PairIP）を遅らせないか、BDS を重ねたときにタイトルが遅れないか（debug の notice の
runAheadS と titleS）、裏の削除が bench の値をゆがめないか。

## 部品ごとに（app/ を通さずに）

```
node app/redroid/redroid.mjs doctor | setup | gapps <dir> | image --gapps <dir>/ctx
node app/redroid/game.mjs prep --data <dir>         # アカウント → checkin → Play がゲームを入れる → 初回の起動（秘密が要る）
node app/redroid/game.mjs bench --data <dir>        # overlay で戻す → 起動 → ゲームのタイトルまで（と、常駐の端末でゲームだけ）
node app/redroid/game.mjs debug --data <dir> --addon <name> [--mode run|ui] [--keep] [-- <app run の指定>]
node app/redroid/redroid.mjs up --data <dir> --restore overlay   /   down
node app/redroid/local.mjs [--dry-run] [--bench]    # 手元の準備を 1 回で（redroid.yml の手順を、足りないものだけ）
node app/redroid/timeline.mjs                       # いちばん新しい bench を前回・中央値と比べる
```

game.mjs debug は app.mjs に `APP_SERIAL`（起動済みの端末）、`APP_LIVE_DEVICE=1`（インストールも停止もせずに使う）、
`APP_APK_DIR`（端末から取り出した APK: 版と CPU を読むだけ）、`APP_HOST`（docker のブリッジのホスト側）を渡して走らせる。
参加は端末の中継（`lab-relay --reflect`: LAN の発見の放送を 172.17.0.1:7551 への 1 対 1 の送信にする）で、エミュレータと同じ。

binder が要る（Linux: `modprobe binder_linux devices=binder,hwbinder,vndbinder`）。docker と、ホストの sudo（/data の
フォルダは Android の uid のファイルなので）。

## 次の手

1. 戻してからタイトルまでの 48〜50 秒を削る（目標 30 秒）: 同梱アプリは prep で止めてある（QUIET）。常駐の端末は済み（2 回目からは
   起動済みのゲームをそのまま使う）。残りは冷えた起動の CPU の取り合いで、CI で計って詰める（`app ci --device redroid --bench`）。
2. 参加を CI で確かめる: ゲームの LAN の発見（172.17.0.2:7551 → 172.17.255.255:7551、2 秒ごと）はブリッジを渡るが、BDS は
   放送には答えなかった（ブリッジで tcpdump）。いまは app run 自身の中継（`lab-relay --reflect`）で送る（エミュレータと同じ）。
   `app ci --device redroid` の報告（report.md の「参加」）で確かめる。
3. ~~準備した /data をジョブをまたいで持つ~~: 済み（app の vault で暗号化して。保存は `--keep` のときだけ）。
