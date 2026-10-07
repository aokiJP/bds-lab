# app/ の設計: 本物の Minecraft を GitHub の 2 CPU で、速く、公開リポジトリでも秘密を出さずに

読む人: このラボの app/ を直す人（人でも AI でも）。使い方は README.md、AI 向けの短い要約は AGENTS.md。

## 1. 何をするか、何に縛られるか

- 本物の Minecraft（Android 版、Google Play のもの）をエミュレータで動かし、ラボの BDS（アドオン入り）に入れて、
  JSON UI の画面・クライアントにしか出ないエラー（コンテンツログ）・操作の結果を取る。
- 動く場所は GitHub Actions の標準 runner: **private では 2 vCPU・7.8 GB、公開リポジトリでは 4 vCPU・16 GB、GPU なし**（KVM はある。設計は小さい方に合わせる）、ジョブは 6 時間まで、
  キャッシュはリポジトリ全体で 10 GB（超えると使われていない順に消える）。
- APK・BDS・端末（ゲーム入りのスナップショット）はキャッシュに AES-256-GCM で暗号化して置く（公開・非公開とも。鍵は Secrets から）。
  公開リポジトリでは成果物とライブの issue も同じ鍵で封じ、注釈・チェックは合否だけ
  （lib/vault.mjs。public では何も読み書きしない）。成果物には APK・.so・トークンを入れない（`app guard` が中身まで見る）。

## 2. 流れ

```
prep（1 台）: Play の今の版 → キャッシュの名前 → 無ければ端末を作る（fresh AVD → アカウント → Play から入れる → タイトル →
              スナップショット → 暗号化して保存）
app（N 台、並行）: 端末と BDS のキャッシュを取る → 裏で解読 → エミュレータ本体とシステムイメージを取る → スナップショットから
              起動（16〜33 秒）→ BDS（NetherNet LAN）→ 中継 → 手順（app.txt / JSON UI の画面すべて）→ 報告・画面
report: 成果物を check run に（秘密なし。API だけで報告・ログ・画面が読める）
```

常駐（`--mode hold`）: 戻すのは 1 回だけ。あとは issue のコメント（公開リポジトリでは封じて）（`app live`）で `run` / `ui` / `pull <枝>` /
`last` を何度でも（その端末のまま `app run`。始まるまで数秒）。端末を直接さわる命令（screen / tap / pad / key / sh / logcat …）も
同じ道で、それぞれ何秒かかったかを返す。

## 3. 実機で測った費用（CI の端末、負荷 2.5、2026-10-04）

| 操作（端末の中） | 時間 | 結論 |
|---|---|---|
| `screencap -p`（PNG） | **2,500 ms** | 端末で撮らない: エミュレータ側（ホスト）で撮る |
| `screencap`（生） | 1,510 ms | 読み出し自体が重い（ソフトウェア GPU から） |
| `uiautomator dump` | 3,050 ms | 使うのはダイアログに答えるときだけ |
| `input keyevent` | 120 ms | Java を起こすが、思ったより安い |
| `dumpsys window displays` | 100 ms | 毎回の見張りに使ってよい |
| `sendevent` | 70 ms | タッチパネルからの押し（panel） |
| `pidof` | 60 ms | |

ゲームの描画は毎秒 4〜6 枚（SwiftShader を ANGLE 越し、`-gpu swangle_indirect`）。端末の AVD は 9.5 GB（userdata の
qcow2 が 6.5 GB、その中で使われているのは 3.1 GB: 残りは消したファイルの古い中身）、RAM のスナップショット 2.65 GB。

## 4. 参加の道（なぜ LAN で、なぜゲームパッドか）

1. 1.26 の BDS: 「NetherNet is the only supported transport type」。RakNet のままでは本物のアプリは入れない。
2. アドレスで入る（参加のリンク、サーバーの一覧）と、127.0.0.1 でも「You need to authenticate to Microsoft services」
   （Guardian）。サインインなしで入れるのは、**同じネットワークのワールド**（LAN）として見つけたときだけ。
3. そこで BDS を NetherNet の LAN の形で立てる（`LAB_TRANSPORT=lan`: 発見は UDP 7551、シグナリングも LAN の中）。エミュレータの
   中からの放送はホストに届かず、7551 はゲーム自身が持っていて他は聞けない。そこで端末（root）で、出ていく放送を AF_PACKET
   （ETH_P_ALL: 出ていくパケットはすべてのプロトコルのソケットにしか見せない。ETH_P_IP のものは CI の端末で何も見なかった）で
   捕まえ、ゲームの住所とポートのまま 10.0.2.2:7551 への 1 対 1 の送信として送り直す（app/relay/lab-relay.c の `--reflect`、
   `cc -static`）: エミュレータの NAT はゲームの普通の送信として運び、BDS の答えはゲームのソケットへ 10.0.2.2:7551 から返る。
   19132 は普通の中継。
4. アプリでは PLAY → Worlds に「LAN world」（lab / Dedicated Server's world）として出る。1.26 の新しい画面（Ore UI）は
   エミュレータでは**タップを受けないが、ゲームパッドは受ける**: A で PLAY、DOWN でワールド、A で入る。
   OCR があれば一押しごとに画面を読んで次を決め、前の実行が残したエラー・切断の画面は B で戻る。
   シェルが差し込むキー（`input gamepad`、デバイス -1）は届いたり届かなかったりした。そこで端末に**本物のコントローラー**を
   挿す: `app/relay/lab-pad.c`（uinput の「Xbox Wireless Controller」、C ライブラリなしの 10 KB、ラボが `cc` で作り、
   コミットしない）。押す・90 ms 保つ・離すを FIFO の 1 語ずつ（`A DOWN wait500 A`）。Android は GAMEPAD|JOYSTICK と分類し、
   CI の端末で B が GAME MODE の画面を抜けた。
5. ワールドを持たない新しい人の Play は PLAY 画面でなく新しい人向けの流れへ行く。そこで準備のとき、ゲームを止めた間に
   **自分のワールドを 1 つ置く**（`app/lib/world.mjs`: 平らなクリエイティブの level.dat を little-endian NBT で書き、ゲームの
   com.mojang のフォルダへ。開かないので地形は作らない）。次の起動から「戻ってきた人」になる（`APP_SEED_WORLD=0` で置かない）。
6. フレンドのワールドと、アドレスでのサーバー参加には Microsoft のサインインが要る。秘密 `MS_EMAIL`（と `MS_PASSWORD`）が
   あれば、準備が端末のゲームをサインインさせてからスナップショットにする（`app/lib/signin.mjs`）: メニューの Sign In へ
   コントローラーで焦点を合わせて A → Xbox のライブラリの WebView（普通の Android の画面なのでタップと文字入力が効く）→
   ページを OCR の言葉で見分ける（start / email / password / approve / code / stay / profile / error）。値は端末の
   標準入力で打ち、コマンドラインにもログにも出さない。二段階の確認はライブの issue に出る（承認の番号、またはコードを
   `app live "code 123456"` で返す。実行した人のコメントだけ受け取る）。スナップショットにはサインインの状態が残り、
   スタンプに `signin` が付く（秘密を入れた日から別のキャッシュ）。
7. 旧来の道（`APP_TRANSPORT=raknet`）は残す: リンク・質問（Unknown External Server → Continue、Online play is not rated →
   Proceed。OCR が緑のボタンの白い字を読めなくても、問いの文から 1.26 のボタンの位置を押す）。

### いまの状態（2026-10-04 11:25）: **jsonui_demo の app.txt が本物のアプリで通った（PASS）**

常駐の端末（run 37197181375、準備で自分のワールドと ANR の 5 倍を入れた端末）で `run`: タイトル → PLAY → LAN の
ワールド → 参加の 2 つの質問 → `Player Spawned`（アプリの読み込みをさらに 42 秒待った）→ サーバーがフォームを送る →
**アドオンの rp/ui/server_form.json で描かれたフォーム**（「JSON UI Demo」、ダイヤとエメラルドのボタン）が画面に出て
（ワールドとの違い 90.5%）、BACK で閉じ、サーバーが「closed」を受け取った。20 手順すべて通過、参加は 102.8 秒（負荷 6/2 CPU）。

- その前の普通の `app ci`（run 37192511875）は参加まで自動で 37.6 秒、そこで止まった: サーバーの「Player Spawned」は
  アプリがまだ「Generating World / Loading Resources」（サーバーのパック）のときに出て、その間に送ったフォームは出ない。
  → `until joined` はアプリの読み込みの画面が消えるまで待つ。
- 同じ実行で、端末ジョブが準備済みの端末（5.9 GB）を時間内に取り出せず（キャッシュの 1 区切り 10 分）、35 分かけて作り
  直した → `SEGMENT_DOWNLOAD_TIMEOUT_MINS=30`。
- コンテンツログ: ゲームの設定 content_log_file:1、外部のフォルダ logs/ は空。1.26 は最初の 1 行でファイルを作るので、
  空は「何も出ていない」。報告もそう言う（設定が 0 のときだけ「読めていない」）。

### その前（2026-10-04 09:10）: **本物のアプリが、サインインなしでラボの BDS に入った**

常駐の端末（run 37189904173）で、手で一つずつ: 自分のワールド → タイトル → Play → PLAY に「LAN world / lab / Dedicated
Server's world」（`--reflect` が発見を 10.0.2.2:7551 へ、BDS が 176 バイトで答えた）→ カードへ → A → 「Online play is not
rated」で Proceed → 「Download Resource Packs?」で Download Everything & Join → BDS に `Player connected` と
`Player Spawned: Alex`、画面はワールド（ラボの歓迎の文と TS REPL のアイテム）。分かった押し方:

- **方向はキーイベント**（`input gamepad keyevent KEYCODE_DPAD_*`: 列に入るので落ちない）。コントローラーの D-pad は
  ハット（状態）で、ゲームはそれを 1 フレームに 1 回見るだけ。毎秒 4 枚では 90 ms の押しが見落とされた。
- **ボタンはコントローラーで長めに**（lab-pad の既定 500 ms）。シェルの BUTTON_A も 90 ms の A も届いてはいる
  （`dumpsys input` に出る）のに効かず、600 ms 押すと効いた。
- 参加の 2 つの質問は、進むボタンにはじめから焦点がある（緑）: A。
- タイトルのボタンの白い字は OCR が読めない。読めるのは「©Mojang AB」と肌の名前（Alex）: それでタイトルとする。

### その前（2026-10-04 08:45、常駐の端末 2 回で確かめたこと）

- **自分のワールドで新しい人の流れを抜けた**: `world restart` の後の Play は PLAY 画面（「Worlds (1)」、own world の
  カード）を開いた。外部ストレージにも置くと「Some worlds might be hidden…」の帯が出るので、ゲームの private の
  フォルダだけに置く。「Play your way」は A（Continue）では何度でも戻ってきて、B（Close）で閉じた。
- **LAN モードの BDS は RakNet の ping に答えない**（端末から 10.0.2.2:19132 へ直接も中継経由も `lab-relay --ping` で
  答えなし）。前に一覧に出たのは RakNet の BDS（入れない）。NetherNet の LAN の発見は UDP 7551 だけ。
- **ゲームは 7551 の発見を 2 秒ごとに送っていた**（端末の tcpdump: wlan0 から 10.0.2.255、eth0 から 10.255.255.255、
  dummy0 から ff02::1）。中継の `--reflect` は ETH_P_IP の packet socket で、出ていくパケットを一度も見ていなかった →
  ETH_P_ALL に直し、同じ放送の 2 本（ネットワークごと、チェックサムが違う）を 1 本にした。手元の root で確かめた
  （古いものは何も返さない、新しいものは送り主の住所とポートのまま届く: tests/app-offline.mjs）。
- 2 CPU で「応答なし」がゲームと Android 自身に何度も出た → 準備の枠組みの起動し直しで `ro.hw_timeout_multiplier=5`
  （Android の遅い端末用のつまみ。Cuttlefish と同じ）。`hide_error_dialogs` は使わない（ダイアログを隠すと Android は
  ANR でアプリを殺す）。
- live のセッションが二度、終わらない端末のコマンド（FIFO への echo、`nc`）で固まった: spawnSync は期限に SIGTERM を
  送るが adb は生き残り、spawnSync は待ち続ける → adb と BDS のラボは期限に SIGKILL。
- PLAY では自分のワールドのカードにも「A Play」が出る。焦点は白い枠（タブ・ボタン・カード）なので、LAN のワールドの
  カードに枠があるときだけ A（`focusRing`）。
- 次: この 3 つ（--reflect、Play your way、枠）を入れた常駐の端末で、PLAY に LAN のワールドが出て入れるか → 上の通り入れた。

### その前（2026-10-04 04:45）

- 確かめた: BDS を NetherNet の LAN で立てると、アプリの PLAY → Worlds に「LAN world」として出る（RakNet の ping の答え経由、
  中継 19132）。新しい画面はゲームパッドで動く。前の実行の画面は B で戻る。タイトルはスナップショットの言葉で 10 秒。
- 確かめた: ゲームは UDP 7551 を自分で持つ（中継は bind できない）→ 出ていく放送を捕まえて送り直す `--reflect` にした。
  CI で起動はしたが、PLAY を開けた状態でまだ試せていない（下の操作の問題）。
- 分かった操作の注意: ゲームパッドの最初の一押しは焦点を出すだけ（Get started の上）。新しい人向けのタイトルでは
  DOWN・DOWN・A で More options（クラシックのメニュー）。Get started の先（GAME MODE）は B も ESC も効かない画面がある
  → 入らないこと。クラシックのメニューの焦点は配置で動く（緑の Play を確かめてから A）。
- 準備でクラシックのメニュー（Play が緑）をスナップショットにできた（05:18）。ところが**ワールドの無い新しい人の Play は
  PLAY 画面でなく新しい人向けの流れ（Get started → Play your way / GAME MODE → ワールドを作る）へ行く**ので、実行は
  ワールド作りの画面で止まった。has_dismissed_new_player_flow:1 では止まらない。
- 本物のコントローラー（lab-pad）は CI の端末で効いた（B で GAME MODE を抜けた）。サインインのページ（「Let's get you
  signed in」→ Microsoft の「Sign in to continue to Minecraft」）までコントローラーとタップで行けた。
- 次: 準備で自分のワールドを置いた端末で、Play → PLAY 画面 → LAN の BDS へ（`--reflect` の発見を含めて）確かめる。
  キャッシュの端末のままなら live の `world restart` で同じことを試せる。options.txt の A/B 試験
  `new_player_flow_v3_abc_test_group`（いま 3）は控え。サインインした端末（秘密 `MS_EMAIL`）なら、アドレスでの参加と
  フレンドのワールドも開く。残る大きな道は redroid（コンテナの Android はホストと同じネットワークにいて、放送がそのまま届く）。

## 5. 速くする工夫（どれも既定で入っていて、つまみで外せる）

| # | 工夫 | 効くところ | つまみ |
|---|---|---|---|
| 1 | 準備済みの端末: タイトル画面のゲームごとスナップショット、キャッシュに暗号化 | 起動 18 分 → 16〜33 秒 | `--fresh` |
| 2 | キャッシュの解読を裏で: 端末の解読と、エミュレータ本体のダウンロードを重ねる | 1〜2 分 | — |
| 3 | 常駐の端末（mode hold）: 戻すのは 1 回、テストは live の `run` で何度でも | 2 回目から数秒で始まる | `--mode hold` |
| 4 | 並行が既定: 実行ごとに別の列、`--try` で設定違いを同時に 8 本 | 待ち時間 | `--lane` |
| 5 | キャッシュの整理: 保存の前に古い版を外し、上限なら端末の土台を諦める（エミュレータを消させない） | 次の実行が作り直しにならない | — |
| 6 | **画面はエミュレータ側で撮る**: 実行の始めに両方を一度ずつ撮って比べ、同じ絵ならホストの絵（端末の CPU を使わない） | 1 枚 2.5 秒の端末の負荷 | `APP_SHOT=adb\|emu` |
| 7 | **OCR を減らす**: 1 スレッド（2 CPU を取り合わない）、同じ絵は二度読まない、変わらない画面は前の言葉、押したら読み直す | 1 回数秒 × 何十回 | `OMP_THREAD_LIMIT` |
| 8 | **タイトルはスナップショットの言葉で**: 戻ったばかりでまだ何もしていなければ、パノラマが落ち着くのを待たない | 実行ごとに 30 秒強 | — |
| 9 | **ゲームの描画を軽く**: 描画距離 4 チャンク、なめらかな光・雲・空・揺れなし、上限 20 枚/秒、ファイル監視なし（UI は同じ） | ゲームの CPU、ANR | `APP_LIGHT_GFX=0` |
| 10 | **画面合成が待たない**: `debug.sf.latch_unsignaled=1` で一度だけ Android の枠組みを起動し直す（スナップショットが持つ） | 「GPU が止まった」応答なしで参加が止まる | `APP_LATCH_UNSIGNALED=0` |
| 11 | AVD のゼロを穴に（止めた後 `fallocate --dig-holes`）。空きのゼロ埋めは既定で切る: エミュレータの /data はファイルシステムの下で暗号化されていて（dm-crypt）、ゼロは暗号文として書かれる（CI で画像が 6.5 → 7.9 GB に増えた）。fstrim も届かない | キャッシュが運ぶ量 | `APP_ZERO_FREE=1` |
| 12 | BDS を軽く: スクリプトのデバッガをつながない、watchdog は 60 秒（エミュレータが CPU を取っても「Hang」で BDS を止めない） | BDS の負荷と、止まる事故 | `APP_DEBUGGER=1`、`APP_WATCHDOG_MS` |
| 13 | 本物のコントローラー（uinput の lab-pad）で新しい画面を動かす: 押し方を 6 通り試して 12 回押す無駄も、届かない差し込みのキーもない。何語でも 1 回の adb で FIFO へ | 数十秒〜 | `APP_PAD_WAIT_MS`、`APP_PAD_BIN` |
| 14 | 端末の中の中継（19132 / 7551）: ホストのネットワークの形に左右されない | 参加そのもの | `APP_JOIN_VIA=direct` |
| 15 | BDS とエミュレータを同時に用意（スナップショットから戻る間に BDS が起きる） | 10〜30 秒 | — |
| 16 | 同梱の Google アプリを止め、同期を切る（Play 開発者サービス・Play ストアは残す） | 端末の CPU | `APP_KEEP_APPS=1` |
| 17 | live の各命令に時間: 測りながら直す（上の表はこれで取った） | 次の工夫を選ぶ | — |
| 18 | 失敗したセクションだけ捨てて次へ（BACK で世界に戻す）: 1 回の実行で全部の画面 | やり直しの回数 | — |
| 19 | 自分のワールドを準備で置く（新しい人向けの流れを通らない: ワールドを作って入る数分がない） | 実行ごとの参加 | `APP_SEED_WORLD=0` |
| 20 | サインインはスナップショットに: 1 回だけ（二段階の確認も 1 回）、実行ごとはサインイン済みの端末から | 実行ごとの数十秒と人の手 | `APP_SIGNIN=0` |

## 6. 参考にした公開プロジェクト（何を取り、何を取らなかったか）

- **ReactiveCircus/android-emulator-runner**（GitHub Actions でエミュレータ）: AVD スナップショットのキャッシュ、`-no-window -no-audio
  -no-boot-anim`、アニメーションを切る、KVM の udev ルール → 取り入れた（キャッシュは暗号化して）。
- **google/android-emulator-container-scripts**（エミュレータの gRPC）: ホスト側の画面取得（縮小して取れる）と入力 → 画面は
  エミュレータ側で撮る（#6、コンソールの `screenrecord screenshot`）。縮小した絵を直接取る gRPC は次の候補。
- **remote-android/redroid**（＋ GApps を足す redroid-script）: VM を使わず、ホストのカーネルの上のコンテナで Android。
  **GitHub の runner で動いた**（当時の probe ワークフロー、2026-10-04。いまは redroid.yml）: カーネル 6.17 azure は binder をモジュールで持ち
  （`linux-modules-extra` を入れて modprobe、binderfs も可）、Android 14 の x86_64（ARM 変換つき）がイメージ取得 15 秒・
  **起動 16 秒**、描画は ANGLE → SwiftShader Vulkan（GLES 3.1、いまのエミュレータと同じ種類を VM なしで）、screencap 1.8 秒。
  スナップショットを戻す（端末のキャッシュ 2〜3 分 + 起動 24〜33 秒）代わりに、/data だけを暗号化キャッシュに置けば済む。
  残る壁: Google Play 開発者サービスと Play ストア（ゲームのライセンス確認 PairIP が要る）を入れること。
- **Waydroid / Anbox**（LXC の Android）: Wayland のセッションが要り、CI には向かない。
- **google/android-cuttlefish**（crosvm の VM）: Google の CI 向けだが、描画は同じくソフトウェア。今のエミュレータと大差なし。
- **openstf/minicap・minitouch**（速い画面と入力）: 入力の考え方（/dev/input へ直接）は `panel` の押し方として取り入れた。
  minicap は新しい Android に追いついていない。
- **Genymobile/scrcpy**（H.264 の画面転送）: GPU のエンコーダが無いとソフトウェアで圧縮するので、2 CPU では重すぎる。
- **openatx/uiautomator2**（常駐のエージェント）: uiautomator の dump は 3 秒（測定）。ダイアログに答えるときだけ使う。

## 7. 自分の端末（root あり・なし × USB・Wi-Fi）

本物の端末は、エミュレータと違って「人のもの」です。設計はそこから決めました。

- **触るのは登録した端末だけ**: `app device`（一覧）は adb に見えている端末を並べるだけで、登録していない端末では何も実行
  しない。`add` が読むだけのコマンド（getprop・id・dumpsys package・wm size・ip addr。root の確かめに su を 1 回）で調べ、
  `app/.lab/devices/<名前>.json` に残す。
- **参加はゲームのネットワークで、adb とは別**: adb の転送（forward / reverse）は TCP だけで、ゲームは UDP（RakNet・
  NetherNet・LAN の放送 7551）。なので「adb が USB か Wi-Fi か」と「ゲームが BDS に届くか」は別の問題として扱う。端末と PC
  が同じネットワーク（Wi-Fi・USB テザリング・ホットスポット）なら、ゲームの LAN の見つけ方がそのまま届き、root も中継も
  要らない。NetherNet は LAN の放送の後、ICE でお互いのアドレスへ UDP を張るので、adb の上の 1 本の UDP の筒では足りない
  （だから USB だけの道は作らず、テザリングを案内する）。
- **root が変えるのは操作とログだけ**: root があれば、エミュレータで確かめたコントローラー（lab-pad、uinput）で押す。
  lab-pad は C ライブラリを使わず、x86_64 と arm64 のシステムコールを持つ（`app/relay/lab-uinput.h` はカーネルのヘッダーを
  使わない写し: 試験でカーネルの値と突き合わせる）。arm64 用は NDK・zig・cross gcc・clang+lld のどれかで作る。root が無ければ
  `input gamepad keyevent`（ボタンは `--longpress`: ゲームは 1 フレームに 1 回ボタンを読む）。反射（lab-relay --reflect）は
  放送だけを落とす Wi-Fi 向けの手で、`APP_DEVICE_REFLECT=1` のときだけ。
- **変えたものは戻す**: run の間だけ、画面を点けたまま（stay_on・screen_off_timeout）・通知の帯のデモ表示・おやすみモード。
  変える前の値を先にファイルへ書くので、途中で殺された run も次の run か `app device restore` が戻す。ゲームは run が起動
  したときだけ止め、置いたもの（コントローラー・中継・ログの写し）は消す。画面の形・回線を変える手順は使わない。
- **Wi-Fi は戻ってくる**: ワイヤレス デバッグはつなぐたびにポートが変わるので、端末のシリアル番号（ro.serialno、mDNS の
  名前 adb-<番号>-… にも入る）で探してつなぎ直す。ペア設定コードは adb pair の 1 回にだけ使い、どこにも書かない。

確かめたこと（偽の端末: tests/device-offline.mjs）: 4 通りの道の選び方と案内、登録しない端末に何も実行しないこと、ペア設定
コードがどのファイルにも出力にも残らないこと、run の後に設定が元の値（無かったものは無いまま）に戻ること、su の端末で
コントローラーを su で起こして後で消すこと、殺された run の後始末。arm64 の lab-pad と lab-relay は zig と clang+lld で作り、
qemu で動かした。本物の端末での 4 通りの表（道・入り方・操作・時間・失敗と直し）は、手元の端末で通してからここに載せる。

## 8. 次の手（効きそうな順）

1. redroid の端末（起動 16 秒は確かめた）: GApps（Play 開発者サービス・Play ストア）を足したイメージと、アカウント・
   ゲーム入りの /data を暗号化キャッシュへ。ライセンス確認が通れば、戻すのはエミュレータの数分の一。
2. gRPC の getScreenshot で縮小した絵（見張り用）と原寸（記録用）を分ける。
3. RAM を 3 GB → 2.5 GB（スナップショットが小さく、戻すのが速い）: ゲームが落ちないか確かめてから。
4. 常駐の端末で、アドオンが変わらない限り BDS を立てたまま次の `run` へ。
