# bds-lab 設計仕様書

AI が単独で Minecraft 統合版アドオンを作り、実機 BDS 上で**本物のプレイヤー（real player）**を使って検証し、`.mcaddon` まで仕上げるための開発基盤。
この文書は人と、深く調べたい AI のためのもの。日常の作業で AI が読むのは `AGENTS.md` だけ。

- 対象: BDS 1.26.51.1 / `@minecraft/server` 2.11.0-beta（既定）・2.10.0（stable） / `@minecraft/server-ui` 2.3.0-beta・2.2.0 / bedrock-protocol 3.60 / TypeScript 6.0 / esbuild 0.28
- 取り込んだ外部資産: Mojang の bedrock-protocol-docs・bedrock-schemas（forms）・bedrock-samples・minecraft-scripting-libraries（math / vanilla-data / gameplay-utilities）・Creator Tools（mct）、minecraft-debugger と同じ BDS の profiler / diagnostics、tutinoko2048/scriptapi-addon-template と Nano191225/scriptup のビルド方針、kaaariyaaa/scriptAPIServerSkill の実行権限の規則（§14・§15）
- イベント・プレイヤー状態・フックの厳密対応表: [`EVENTS.md`](EVENTS.md)（`node docs/coverage/run.mjs` が [`coverage/spec.txt`](coverage/spec.txt) を実機で流して生成する）

---

## 1. 目的と原則

| 原則 | 意味 |
|---|---|
| 実機で確かめる | 通ったと言えるのは実機 BDS で通ったときだけ。推測でのテストは無い |
| real player 優先 | プレイヤーが関わる検証は、ネットワーク越しの本物のクライアントで行う。SimulatedPlayer は人数を増やすときの補助 |
| AI が単独で完結 | 作る→動かす→見る→直す→配布物、の全部に道具がある。人が手を出す場所を残さない |
| トークン最小 | AI が読むのは `AGENTS.md` 1 枚。出力は意味のある行だけ。1 回の起動で複数の確認をまとめる |
| 事実から文書を作る | イベント対応表は実機の実行結果から生成し、手で書かない |
| 1 つの id に 1 つの条件 | どのイベント・状態・フックも、それ専用の発生条件で確かめる。別の id と同じ操作を使い回したり「何か起きたから OK」としない（§12） |

## 2. 全体構成

```
AI ──(node lab.mjs …)──▶ common/core.mjs ──▶ BDS（子プロセス, stdin/stdout）
                              │              ▲  ▲
                              │ 検証用パック │  │ RakNet 11 (UDP)
                              ▼              │  │
                         world コピー ──────┘  common/realplayer.cjs ── bedrock-protocol ── common/raknet.cjs
```

| ファイル | 役割 |
|---|---|
| `AGENTS.md` | AI への唯一の説明書（約 1,350 token）。細部は `node lab.mjs help <topic>`（`common/help.md`）で必要なときだけ出す。`CLAUDE.md` は `@AGENTS.md` の 1 行 |
| `lab.mjs` | 3 行の入口（中身を読ませない） |
| `common/core.mjs` | CLI 本体: 取得・インスタンス・起動・常駐サーバー・出力の整形・テスト・API 索引・サンプル・生成・梱包 |
| `common/build.mjs` | src/ のビルド（esbuild）・型検査（TypeScript）・共有 SDK・ソースマップによる行番号の戻し（§14） |
| `common/extra.mjs` | 使うときだけ読む道具: `doc`（bedrock-schemas の forms と bedrock-samples の metadata）・`example`（Creator Tools 同梱の Mojang のスクリプト例）・`proto`（bedrock-protocol-docs）・`check --deep` / `render` / `view`（Mojang Creator Tools）・PNG の縮小（§15） |
| `common/debugger.cjs` | Mojang の script debugger プロトコル（minecraft-debugger と同じ）のクライアント。`trace`・`trace err`・`cov` の土台（§16） |
| `common/realplayer.cjs` | 本物のクライアント（`@名前 …` の実装） |
| `common/helper.js` | アドオンの写しに差し込む検証用コード（`js`、SimulatedPlayer、フォームの横取り、`events on` / `states on`） |
| `common/github.mjs` | GitHub: private リポジトリ・アドオンごとの枝・Release・公開・作業用 zip（§13） |
| `common/data/bds-versions.json` `common/data/minecraft-modules.json` | BDS の版と CDN の一覧（配布 API が読めないときの控え）、モジュールの版（`new` の manifest） |
| `common/raknet.cjs` | RakNet protocol 11 のクライアント（BDS 1.26 用。npm の JS 実装は 10 まで） |
| `common/ipv6-shim.c` | IPv6 の無いコンテナで BDS の RakNet を起動させる小さな LD_PRELOAD |
| `addons/<名前>/` | AI が書くもの: `src/`（TypeScript。`bp/scripts` に束ねられる）`bp/` `rp/` `tests.txt` `TASK.md`。例として `addons/spectator_probe`（元の bds-lab の試験用アドオン。受け入れ条件を real player で流す `tests.txt` つき） |
| `vendor/bedrock-server.zip` | 使う BDS の zip（落としたものをここに残す。Git LFS で GitHub にも載せる） |
| `.github/workflows/` | `verify.yml`（push ごと: GitHub の流れ・selftest・全アドオンの test と pack）、`bundle.yml`（毎日: 最新の BDS で作業用 zip を作り Release `template` を更新） |
| `bench/` | トークン節約ベンチマーク、`github-smoke.mjs`（偽の gh と手元の bare リポジトリで GitHub の流れを通しで確かめる） |
| `docs/coverage/` | 厳密な検証（`spec.txt` 条件と期待、probe アドオン、`run.mjs` 生成器） |
| `.lab/` | キャッシュ（BDS・インスタンス `run/<名前>/`・テンプレートワールド・型定義・SDK・ビルド道具・クライアント部品・参考資料）。消しても再生成される |

## 3. 実行モデル

1 回の `run` / `test` は必ず次の順で進む。

0. **ビルド**: `src/` があれば esbuild で `bp/<manifest の入口>` に束ね、TypeScript で型検査する。型エラーなら起動しない（§14）
1. **静的検査**（`check` と同じ）: JSON・manifest・UUID・import・テクスチャ/名前/クライアント定義の抜け。エラーなら起動しない
2. **ワールド**: テンプレート（フラット、Beta API 有効、x,z −32..31 の ticking area、mob 湧きなし、昼で固定）を毎回コピー。`-k` で前回を引き継ぐ
3. **パック配置**: `bp/`（と `rp/`）をワールドにコピー。コピー側だけに検証用コードを差し込む（§5）。`bp/` 自体は変えない
4. **起動**: `transport=raknet`、`player-position-acceptance-threshold=0`、`online-mode=false`、空きポートを自動で選ぶ
5. **準備完了の待機**: 別パック `lab_ready` がチャンクの読み込みを確かめて `LAB_READY` を出すまで待つ
6. **コマンド実行**: 1 行ずつ送り、返事を待ってから次へ（§4）
7. **停止**: プレイヤーを切断し `stop`。15 秒で応答が無ければ強制終了
8. **出力の整形**: 意味のある行だけを残す（§6）

BDS は**インスタンス**ごとに動く: `.lab/run/<名前>/` は展開済み BDS へのハードリンクの束（3,000 ファイルで数十ミリ秒、容量は増えない。BDS が書き換える最上位の小さなファイルと config/ だけ本物のコピー）。`run` / `test` は `main`、使用中なら `main1`、`main2`… を取り、常駐サーバーは `live`。だから常駐中でも `test` でき、テストの並列実行もできる。ロックはインスタンスごと（死んだプロセスのロックは自動で外す）。BDS の取得・テンプレート作成・型の取得だけは `.lab/lock` で 1 プロセスずつ。

## 4. コマンド（run / test の 1 行）

| 形 | 動き | 待ち方 |
|---|---|---|
| コンソールコマンド | BDS の stdin に送る | 返事 1 行 + `-w` ミリ秒 |
| `scriptevent ns:id msg` | 同上（`system.afterEvents.scriptEventReceive`） | 同上 |
| `js <code>` | アドオン自身の文脈で async 評価し、値を出す。`$` は js の行どうしで共有されるオブジェクト | `LAB_JS_DONE` が来るまで（最大 30 秒） |
| `events on [名前…]` / `events off` | アドオンの文脈で world.afterEvents / beforeEvents / system.afterEvents を購読し、届くたびに `EV after.<名前> 欄=値 …` を出す（§6） | `LAB_JS_DONE` |
| `states on [キー…]` / `states off` | 毎 tick 全プレイヤーを Script API の名前で読み（Player/Entity の全 getter、引数なしの get 系、inputInfo・inputPermissions・clientSystemInfo、全コンポーネント）、最初に `ST <名前> init …` を 1 行、あとは変わったときだけ `ST <名前> <キー>=<値>` を出す。キーを渡すとそれ（とその下の `キー.…`）だけ | 同上 |
| `wait ms` | 待つ | — |
| `until <正規表現> [ms]` | 直前のコマンドが始まってからの出力にその行が出るまで待つ（既定 10 秒、来なければ `E`）。決め打ちの `wait` の代わり | 行が来るまで |
| `prof start` / `prof stop [n]` | BDS の `script profiler`（minecraft-debugger が使うものと同じ）で CPU を測り、`PROF` の行に関数ごとの自己時間を上位 n 件（src/ の行に戻して）出す | 保存まで |
| `perf [ms]` | `script diagnostics` を ms 間取り、`PERF script_tick 平均/最大 \| level_tick \| script_mem \| entities \| dynprops` の 1 行にする | ms |
| `restart` | 同じワールドで BDS を再起動（保存の確認）。プレイヤーは切断 | `LAB_READY` |
| `@名前 join` | 本物のクライアントを接続（operator） | スポーン完了 |
| `@名前 <動作>` | §7 の動作 | 動作ごとに完了まで |

`tests.txt` は「コマンド行 → その出力への期待行」の並び。`= 完全一致` / `~ 正規表現` / `! 含まない` / `!~ 正規表現に合う行が無い`。期待に一致しなかった `E` 行は失敗。
`## 見出し` の行から先は「区間」になり、期待はその区間で出たすべての行（`wait` 中や後から届いたイベントも）に対して調べる。`!~` と組み合わせて「A は起き、B は起きていない」を書ける。

## 5. 検証用コードの差し込み

コピーしたアドオンの script モジュールの入口を `scripts/__lab_entry.js` に置き換え、`import "./__lab.js"; import "<元の入口>";` とする。

| 理由 | |
|---|---|
| `js` をアドオンと同じ文脈で動かす | 動的プロパティなど、パックごとに分かれた状態を読める |
| SimulatedPlayer を見える場所で作る | 別パックで作った SimulatedPlayer は、他のパックから `undefined` に見える（実測） |
| SimulatedPlayer 向けの出力を拾う | `sendMessage`・フォームの `show()` を、SimulatedPlayer のときだけ横取りして出力に出す |

manifest のコピーには `script_eval` と `@minecraft/server-gametest`（beta）を足す。アドオンが `@minecraft/server-ui` を使うときだけ、フォームの横取りも入れる。

## 6. 出力の規約

| 行 | 意味 |
|---|---|
| `> cmd` | 送ったコマンド |
| そのままの行 | `console.warn`、`world.sendMessage` の本文、コマンドの返事、`js` の値 |
| `E …` | エラー（スクリプト例外・コンテンツログのエラー・ERROR 行・クライアントのキック） |
| `W …` | 警告（コンテンツログの warning・静的検査の警告） |
| `T …` | JS アドオンの型の指摘（`check` のみ。失敗にはしない） |
| `@名前 …` | 本物のクライアントが受け取ったもの（チャット・メッセージ・タイトル・フォーム・コンテナ・コマンド結果） |
| `EV <after\|before\|system>.<名前> 欄=値 …` | `events on` の出力。値は Player→名前、Entity→typeId（落ちているアイテムは `item:<id>*数`）、Block→`id@x,y,z`、BlockPermutation→id、ItemStack→`id*数`、ベクトル→`x,y,z`、入れ子は `{…}` |
| `ST <名前> <キー>=<値>` | `states on` の出力（変化したときだけ） |
| `(xN)` | 直前の行が N 回続いた |
| 最後の行 | `OK` / `FAIL`（run）、`PASS n/m` / `FAIL n/m`（test） |

消すもの: 起動時の案内、テレメトリ、NetherNet の警告、`§` の色コード、参加/退出の定型文、`world.sendMessage` と同じ内容の各クライアントのこだま、コンソールのコマンドで対象のプレイヤーに届く同じ内容の通知（`%commands.give.successRecipient` など）、自分のアドオンのエラーの前の `[アドオン名]` と `at <anonymous>`、モジュールの版の誤りに続く「context を作れない」行（原因の 1 行だけ残す）。スタックの 2 行目以降も src の行に直す。

## 7. real player の仕様

bedrock-protocol（オフラインログイン）＋ RakNet 11。BDS の「サーバー権威の移動」に合わせ、毎 tick `PlayerAuthInput` を送る。
位置は最後にサーバーが確定した値を送り、`player-position-acceptance-threshold=0` によりサーバーが入力から移動を計算して訂正を返す。クライアントはその訂正をそのまま採用する（物理の予測を持たない）。
世界は本物のクライアントと同じく自分で読む: BDS はチャンクを「要求モード」（LevelChunk にブロックを入れず、上限だけ付ける）で送るので、列ごとに SubChunkRequest を送り、届いた SubChunk（形式 9・パレットはブロック状態の FNV ハッシュ）を読み、UpdateBlock / UpdateSubChunkBlocks で書き換える。ハッシュは minecraft-data の全ブロック状態と、StartGame の block_properties（アドオンのブロック。状態の全組み合わせ・当たり判定）から引く。これで照準（光線）・段差・クリックするブロックの番号がサーバーに尋ねずに分かる（知らない場所だけスクリプトに尋ねる）。

| 分類 | 動作 | プロトコル上の実装 |
|---|---|---|
| 這う | `crawl [on\|off\|ticks]` | 頭の上がふさがっているとき（トラップドアを頭上に置くのが人の定番のやり方）だけサーバーが StartCrawling を受け付ける。受け付けると目の高さ 0.3、高さ 1 の隙間を進める。本物のクライアントと同じく、ふさがっている間は StopCrawling を送らない（前は即座に送っていたので、開けた場所で拒否されるか、隙間の手前で立ち上がって止まっていた） |
| 身元 | `join` / `leave` | オフラインログインの DeviceId・SelfSignedId・PlayFabId・ClientRandomId を名前から決まる値にする。bedrock-protocol は毎回新しく作るため、抜けて入り直すと BDS が別人として扱っていた（id が変わり、持ち物・動的プロパティが消え、initialSpawn がまた来る）。今は本物のプレイヤーと同じく同じ人として戻る（`op.rejoin`） |
| 会話 | `chat` `cmd` | Text / CommandRequest（CommandOutput を待つ、1.5 秒）。返事が翻訳キー（`commands.give.success` の形）なら `%キー [引数]`、カスタムコマンドの平文ならそのまま |
| 視点 | `look yaw pitch` `lookat x y z` | AuthInput の yaw/pitch/head_yaw と camera_orientation |
| 移動 | `walk` `goto` `sprint` `jump` `sneak [tick\|on\|off]` `swim` `crawl` `stop` | AuthInput の move_vector と InputData（押した瞬間・離した瞬間の raw フラグも含む）。`goto` は自分のチャンクの上で道を探して（A*: 壁を回る・1 段はジャンプで上る・3 段まで降りる・溶岩や火を避ける）その曲がり角を順にたどり、最後は 1.5 ブロック以内で 1 tick 歩いて止まるを繰り返して 0.25 以内で止まる（道が見つからなければまっすぐ） |
| 飛ぶ | `fly` `land` `glide` | RequestAbility(flying) ＋ start/stop_flying / 落下中にジャンプを押して start_gliding（エリトラ） |
| 次元 | （ポータルに入る・tp） | ChangeDimension を受けたら入力を止め、読み込み画面の開始 → dimension_change_ack → 終了 |
| 手 | `slot` `use [tick\|hold]` `drop [n]` `swing` | MobEquipment / ItemUse(click_air)→（押している間 start_using_item）→ItemRelease / ItemStackRequest(drop) / Animate＋missed_swing |
| ブロック | `useon x y z [面] [hold]` `dig x y z [tick\|hold]` `release` | PlayerAction(start/stop_item_use_on)＋ItemUse(click_block) / AuthInput の block_action: start_break → continue_break（割れる時間はサーバーの block_start_break から計算）→ 壊れても止めても abort_break で終える。`hold` は `release` まで押したまま |
| 生き物 | `attack` `interact` `dismount` | ItemUseOnEntity / Interact(leave_vehicle) |
| 入れ物 | `open x y z` `take` `put [ingredient\|fuel]` `close` | click_block → ContainerOpen、ItemStackRequest(place)、ContainerClose。かまどは材料/燃料/完成品の欄を名前で扱う |
| クラフト | `craft <item> [回数]` | 持ち物画面を開く（Interact open_inventory）→ 材料を 2×2 の枠へ置く（作業台を `open` していれば 3×3）→ craft_recipe ＋ results ＋ consume ＋ 完成品を持ち物へ。レシピはサーバーが送る crafting_data から選び、タグの材料（#planks など）はサーバーに問い合わせて照合する |
| 持ち物 | `move <元> <先> [数]`（0-35・head chest legs feet・offhand・cursor・box:<n>） | ItemStackRequest の place（違う物が入っていれば swap）。防具・オフハンド・カーソル・持ち物の 9 番以降は、持ち物画面を開いている間だけ動かせるので開いて閉じる。オフハンドは slot 1 |
| 特殊な画面 | `enchant` `anvil` `cut` `smith` `carto` `loom` `trade` `beacon` `grind` | 画面の欄は ui ウィンドウの決まった番号（金床 1-2、石切台 3、取引 4-5、機織り機 9-11、製図台 12-13、エンチャント 14-15、砥石 16-17、ビーコン 27、クラフト 28-40、結果 50、鍛冶台 51-53）。どれも [作る動作] ＋ consume ＋ 50 番から持ち物へ place。作る動作: エンチャント＝craft_recipe(選択肢の id)、金床＝optional(0)＋custom_names、石切台・鍛冶台・製図台・取引＝craft_recipe(レシピ/取引の net id)、機織り機＝craft_loom_request、ビーコン＝beacon_payment ＋ **destroy**。閉じるときは画面に残った物を持ち物へ戻してから閉じる |
| 書く | `sign [x y z] <文>` `book write/sign` `lectern x y z <頁>` `cmdblock x y z …` | 看板を置く/触ると届く OpenSign のあと BlockEntityData(FrontText/BackText)。本は持っている本を開いて（click_air）から BookEdit。LecternUpdate。CommandBlockUpdate |
| そのほか | `fish` `creative` `pick` `emote` `inputmode` `option` `packsetting` `respawn` `leave` | 釣り＝投げて EntityEvent(fish_hook_hook) を待って引く。クリエイティブ＝持ち物画面を開いて craft_creative。pick＝BlockPickRequest / EntityPickRequest（生き物は unique id）。option＝UpdateClientOptions（描画品質）と AuthInput の hotbar_only_touch。Respawn(state 2) → サーバーの Respawn(state 1) → PlayerAction(respawn) |
| 参加時 | `join os= platform= locale= render= memory= graphics= input= ui= gui=` | ログインの client data（DeviceOS・PlatformType・LanguageCode・MaxViewDistance・MemoryTier・GraphicsMode・Current/DefaultInputMode）。Player.clientSystemInfo と graphicsMode・inputInfo に出る |
| 画面 | `form <番号\|[値]\|close>` | ModalFormResponse（custom form は label/header/divider に null を補う。action form のボタンは elements からも読む） |
| データ駆動 UI | `form <i> [値]` `form close` | server-ui の CustomForm / MessageBox。クライアントはサーバーの data store（ClientboundDataStore）を写して持ち、押す・書くは ServerboundDataStore で `layout[i].onClick`（+1）・`.toggled`・`.text`・`.value` を書き戻す。MessageBox はボタンを書いてから閉じる（selection 1/2）。閉じる＝ServerboundDataDrivenScreenClosed（理由は文字列 ClientCanceled。サーバーから閉じられたら ProgrammaticClose / closeAllForms は ProgrammaticCloseAll で応える → show() は ServerClosed） |
| 忙しい | （自動）`typing` `close` `open` | 本物のクライアントと同じく、フォーム・入れ物・NPC・チャット画面が開いている間に届いたフォームは断る（ModalFormResponse cancel=busy / 画面を UserBusy で閉じる → show() は UserBusy）。`typing` はチャット画面を開いたまま（スマホで送信後の状態）、`close` は Esc（チャット→フォーム→入れ物の順）、`open`（座標なし）は自分の持ち物画面 |
| 運営（OP） | `perm` `settings` `structure` | プレイヤー一覧の権限（RequestPermissions、レベルは Mojang の docs どおり zigzag varint）、ワールド設定（SettingsCommand の /gamerule・SetDifficulty・SetPlayerGameType・SetDefaultGameType）、ストラクチャーブロックの画面（StructureBlockUpdate：名前は RedactableString＝文字列＋任意の filtered。パレット名 "default" でないと読み込みが何も置かない。名前は /structure と同じく mystructure: を補う。読み込みモードでは画面が QuerySavedStructure で大きさを尋ねる） |
| ブロック・道具 | `crafter x y z <欄> [off\|on]` `move … bundle:<n>` `wake` | クラフターの欄を押す（PlayerToggleCrafterSlotRequest。無効の欄へは画面が置かせないので `move` も断る）。バンドル＝持ち物画面で dynamic コンテナ（bundle_id、FullContainerName の id は little-endian）へ place、同じ物には重ね、入らなければ `the bundle is full`、取り出しは最後に入れた物。ベッドから出る＝PlayerAction(stop_sleeping) |
| 自動 | （エンドの帰還ポータル）（ボート） | クレジットを飛ばす（ShowCredits status 1）。ボートは client-predicted vehicle：入力に client_predicted_vehicle・漕ぐ（前進=両方の櫂、左右=片方）・predicted_vehicle を付け、サーバーの vehicle 訂正の位置と速度をそのまま使って送る（前は 2 秒で 2.6 ブロック、今は 14 ブロック） |
| 看板の裏 | `sign x y z <文>` | 触った面（OpenSign の is_front）だけを書き、反対の面・染料・発光はサーバーから届いた内容のまま送る（前は反対の面を消していた） |
| 状態 | `inv` `status` `pos` `near` `actions` | クライアントが知っている範囲（持ち物・体力・満腹度・位置・見えている生き物）、使える動作の一覧 |
| 受け取る | `watch on\|off\|<パケット,...>` | サーバーがこのクライアントへ送ったものを `saw <パケット> {json}` で出す（`on` は移動・チャンクなど毎 tick 来るもの以外すべて、名前を並べればそれだけ）。スクリプトの Player / 画面 / カメラ / 霧 / 音 / 目印の効果を受け取る側で確かめる。読めないパケットも `saw <名前> raw <16 進>` で出す |
| NPC | `npc <ボタン番号>` `npc close` | NpcDialogue（/dialogue open や NPC を触ると届く）のボタンを NpcRequest(execute_action、ボタン番号は action_type に入る) で押す。ボタンのコマンドは NPC から A を initiator にして動く |
| スクリプトへ | `message <id> <文>` | ScriptMessage（クライアント → サーバー）。`world.afterEvents.messageReceive` が起きる |
| 入力ロック | （自動） | UpdateClientInputLocks を受けたら、本物のクライアントと同じく、止められた入力（移動・横移動・前後左右・ジャンプ・しゃがみ・視点）を送らない。乗る/降りるの禁止中は `interact`（乗り物）と `dismount` を断る。`input locked: …` を出す |
| 持ち替え | （自動） | サーバーが自分の MobEquipment を送ってきたら（`Player.selectedSlotIndex`）その番号を持つ |
| 照準 | `target` / 座標なしの `useon` `dig`、名前なしの `attack` `interact` | 目の位置から視線の向きに、自分のチャンクのブロック（minecraft-data の当たり判定の箱。無いものは 1×1×1、空気・液体・火は素通り）と見えている生き物の箱に光線を飛ばす。届く距離は Bedrock と同じ（マウス・コントローラー: ブロック 5・生き物 3（クリエイティブ 5）、タッチ: 6（クリエイティブ 12））。当たった面と点（0..1）をそのまま ItemUse の face / click_pos に使う |
| 押したまま | `useon [x y z] ... hold` → `release` | 右クリックを押したままにすると 4 tick ごとに ItemUse をくり返す（trigger は SimulationTick。Script API では 2 回目から isFirstEvent=false）。照準で始めたときは、くり返すたびに照準の先を取り直す（歩きながら置き続ける） |
| 押した位置 | `useon x y z <面> cx cy cz` | 面の名前（down up north south west east）と、押した点。側面の上半分なら上付きのハーフブロック・逆さの階段になる（前は面の中心しか押せなかった） |
| キーを押したまま | `walk <向き> on\|off` `sprint on\|off` `jump on\|off` `sneak on\|off` `stick <x> <z> [tick\|on\|off]` | 押しっぱなしのキーは、ほかの動作（跳ぶ・叩く・使う・向きを変える）を重ねても続く（前へ歩きながら跳んで段を上がる、など）。stick はゲームパッド・タッチのスティック（move_vector が小数。inputInfo.getMovementVector に出る） |
| 段差 | `goto`（自動）`option autojump on\|off` | goto は目の前に 1 段の段差（当たり判定の高さ 0.6 超・上 2 マスが空き）があればジャンプを押す。autojump はゲームの「自動ジャンプ」（タッチで参加すると最初から on）。ボタンを押していないので raw のジャンプの印は付けない |
| クリティカル・突進 | `jump on` → `attack`、`use hold` + `sprint on` | 落ちている間に叩けばクリティカル（攻撃は 1〜2 tick で届く。前は持ち物の同期と固定の待ちで 5 tick 遅れ、着地してから当たっていた）。槍の突進はサーバーが Pos Delta の速さで判定する |
| 腕の振り | （自動）`swing` `attack` `dig` | Animate に振りの理由（swing_source の文字列 attack / mine ...）を付ける。理由はクライアントと共通の GameMode のとおり（SimulatedPlayer で確かめた）: 空振り・攻撃 = attack、掘っている間 = mine（2 tick ごとに送り、BDS は 4 tick に 1 回数える）。道具を使う（鍬 UseItem・骨粉 Interact）・投げる・捨てるはサーバーが自分で振る。ブロックを置く・生き物に使うは振らない |
| 見た目 | `join skin=slim\|wide skincolor=#rrggbb` `skin slim\|wide [#rrggbb]` | ログインのスキン（ArmSize・SkinColor → gametest の getPlayerSkin）。ゲーム中の着替えは PlayerSkin（persona の部位名は eyes などの enum 名） |
| NPC の編集 | `npc name\|skin\|actions <値>` | クリエイティブの OP が NPC を触ると編集画面（NpcRequest set_name / set_skin（番号は 4 番目の欄の uint8）/ set_actions（ボタンの JSON。サーバーが text からコマンドを作る））。サバイバルでは NPC 自身のデータ（名前・url_tag のボタン）で会話が開く |
| 本・捨てる | `book add\|delete\|swap` `drop <数> <欄>` | BookEdit の add_page / delete_page / swap_pages。持ち物画面の任意の欄から ItemStackRequest の drop |
| 何でも | `request <json>` `packet <名前> <json>` | 生の ItemStackRequest（legacy の種類と、省いた stack_id を補う）/ 生のパケット。名前の付いた動作が無いことも、これで行える |

実機で見つけ、実装で吸収したこと:

| 事象 | 対応 |
|---|---|
| 最新の BDS は `transport=nethernet` が標準で、RakNet のクライアントを受け付けない | `transport=raknet` を設定する |
| IPv6 が無いと RakNet が起動しない（「ポートが使用中」と誤って出る） | `common/ipv6-shim.c` を必要なときだけビルドして LD_PRELOAD |
| 読み込み完了前にスクリプトが渡したアイテムはクライアントへ送られない | 持ち物を使う動作の前に `inventory_mismatch` を送り、持ち物を取り直す |
| スクリプト API のブロック状態には、ネットワーク上の番号に含まれない別名がある（チェストの `facing_direction`） | サーバーから届いたブロック番号を優先し、無ければ minecraft-data の状態一覧で絞ってから計算する |
| ItemStackRequest の各動作は、種類のバイトを 2 回持つ | Mojang 公式のプロトコル仕様どおりに送る |
| `start_item_use_on` は AuthInput の block_action では送れない（キックされる） | PlayerAction で送る |
| 同じ位置に重なった 2 人は、互いの攻撃を遮る | 実際のゲームの挙動。テストでは離す |
| 次元の移動中も入力を送り続けると `unexpected_packet` でキックされる | 移動中は入力を止め、読み込み画面の id を付けて応答する |
| RakNet を黙って閉じると、サーバーは退出に気づかない（playerLeave が起きない） | 閉じる前に DisconnectNotification を送る |
| 新しい版では、飛ぶには InputData だけでは足りない | RequestAbility(flying) を送る |
| 倒した生き物は死亡アニメの約 1 秒間まだ見えている | death_animation を受けたら候補から外す |
| 大きな出力のあと、すぐ process.exit() すると stdout が途中で切れる（lab 側の不具合だった） | stdout を流し切ってから終了する |
| クラフトの枠は、持ち物画面を開いている間しか存在しない（FailedToValidateDstSlot） | クラフトの前に open_inventory を送り、終わったら閉じる |
| 枠へ動かした材料はスタック番号が変わる（FailedToValidateSrcSlot） | サーバーの応答から新しい番号を読み、consume に使う |
| レシピ本と同じ craft_recipe_auto は、この版では受け付けられなかった（InvalidCraftRequest / ConsumedItemNotAllowed） | 人が手で枠へ置くのと同じ手順（craft_recipe）で行う |
| サーバー権威の採掘では、壊れた後もクライアントが「掘っている」ままだと、同じ場所に置かれた次のブロックをサーバーが勝手に壊し続ける | 壊れても・止めても・拒まれても必ず abort_break を送る（壊れた後の abort では playerCancelBreakingBlock は起きない） |
| 死亡後の復活は Respawn(2) → サーバーの Respawn(1) → PlayerAction(respawn) の順でないと起きない | death_info で死亡を知り、この順で送る |
| 見えている位置はサーバーの訂正で数 tick 遅れるので、`goto` が目標を 1 ブロック以上行き過ぎ、感圧板の上で押す/離すを繰り返した | 近くでは 1 tick 歩いて止まる、を繰り返す |
| 直前に渡されたアイテムがクライアントに届く前に使うと、手持ちが食い違って置けない | 使う前に持ち物を取り直し、届くまで（最大 0.5 秒）待つ |
| 大きな `/fill` の変化は update_block ではなく update_subchunk_blocks で届く。拾わないと、クライアントが古いブロック番号でクリックして置けない | update_subchunk_blocks を読み、チャンクごと送り直されたら覚えている番号を捨てる |
| minecraft-data はエンチャントの選択肢 id を zigzag32 として読むが、実際は普通の varint（-2385 に見えるのは 4769） | 送るときに zigzag を戻す |
| エンチャントのラピスは「選択肢の番号＋1」個（表示の cost ではない。違うと ConsumedTooMuchFromSlot） | 番号から数える |
| 金床の修理で使う材料の数はダメージで決まり、違う数は拒まれる | 1〜4 個を順に試す（拒まれた要求は何も変えない） |
| ビーコンの支払いは consume では ActionRequestNotAllowed、支払いだけでは ItemNotConsumed | beacon_payment のあとに destroy |
| 画面（エンチャント台・砥石など）の欄に置いた物は、閉じても戻らず消えていた | 閉じる前に欄の物を持ち物へ戻す（本物のクライアントと同じ） |
| 画面の欄の新しいスタック番号は ItemStackResponse にしか現れない | 応答から ui の欄の中身と番号を更新する |
| 取引の画面は container_open ではなく update_trade で開く | update_trade で画面を開いたことにする |
| 本の編集は、手に持って開いた（click_air）本にだけ効く | BookEdit の前に持ち替えを知らせ、開く |
| EntityPickRequest の「runtime_entity_id」は実際は unique id（負の値は 64 bit の符号なしに直す） | unique id を送る |
| クリエイティブの持ち物からの取り出しも、持ち物画面を開いている間だけ | 開いて craft_creative、閉じる |
| login の PlatformType は 0 desktop・1 mobile・2 console、GraphicsMode は 0 から数える（bedrock-protocol の注記と違う） | 実測の対応で送る |
| minecraft-data の 1.26.51 の表は、いくつかのパケットを実際と違う形で読む（読めずに捨てる・違う値に見える）。set_hud の要素と表示は符号付き varint（Hotbar=5 が VehicleHealth=10 に見えていた）、camera_instruction の fade は「時間（任意）＋色（任意）」で fov の補間は文字列・spline は種類が 1 バイトでキーフレームに有無フラグが無い、clientbound_update_sound_data は handle のあとに（種類 1 バイト＋値）が 7 回、level_event_generic の番号は符号付き（音楽 1900 予約・1901 再生・1902 停止）、player_update_entity_overrides の相手は unique id（zigzag64）で種類名の文字列を持つ、update_client_input_locks のビットは InputPermissionCategory の番号そのもの、play_sound の座標は 1/8 ブロック単位 | バイト列を実測し、最初のクライアントを作る前に表を直す（`common/realplayer.cjs` の patchProtocol）。直せていないものは `saw … raw` で見える |
| BDS 1.26.51 は、ItemStack を変数に持たずに `getItem(i).getComponent('minecraft:inventory').container` と 1 本の式で使うとネイティブで落ちる（バンドルで実測） | 落ちたことを `E BDS crashed` で即座に出し（以前は何も出ずに OK になり得た）、`check` がその書き方を W で指す |
| 砥石の craft_grindstone_request の id 欄は li32 で、中身はレシピ番号ではなく入力アイテムの stack id（Mojang の bedrock-protocol-docs で ItemStackNetIdVariant。0 や特殊レシピ番号では InvalidCraftResult） | 入力の stack id を入れる |
| クライアントは世界を知らなかった: BDS は LevelChunk を要求モード（ブロック 0 個＋要求の上限）で送るが、SubChunkRequest を一度も送っていなかった。照準・段差・ブロック番号は、そのつどスクリプトに尋ねていた | 本物と同じく列ごとに SubChunkRequest を送って読む。StartGame の dimension は minecraft-data では文字列（overworld）で、数値と比べると全部捨てていた |
| 腕の振り（playerSwingStart）の理由がいつも None だった（Animate に理由を付けていなかった）。MissedSwing の印だけでは何も起きない。掘っても置いても振っていなかった | 理由の文字列（none build mine interact attack useitem throwitem dropitem event）。どの動作で振るかは、クライアントと同じ GameMode のコードで動く SimulatedPlayer で確かめた（attack()→Attack、breakBlock→Mine、鍬→UseItem、骨粉→Interact、置く・餌やり→振らない） |
| NpcRequest の 4 番目の欄を minecraft-data は種類の enum として読むが、実際は uint8 の番号（押したボタン・選んだスキン）。7 以上が送れなかった | 番号のまま送る。中身の無い NpcDialogue(open) は、会話が開いていれば「閉じる」、開いていなければ触った NPC 自身の画面 |
| soundCompleted が起こせなかった: BP の sounds/sound_definitions.json は数字のどの版でも「no parser available」 | format_version を "beta" にすると読まれる（中身は minecraft:server_sound_definitions の配列: sound_event_name・duration_info{mode: real_time\|game_time, seconds}・music_info・tags。欄の名前は BDS のエラーから特定） |
| entityUpgrade が起こせなかった | 生き物の description.entity_version.upgrades と minecraft:entity の upgrades 節（1.26.30 で実験機能を外れた）。版を持たずに保存された生き物（ストラクチャーの中など）を読み込むと走る。新しく出した生き物は最新の版で生まれる |
| ゲーム中の着替え（PlayerSkin）はサーバーが受け付けてほかのプレイヤーに配るが、gametest の getPlayerSkin は参加時のスキンのまま | スクリプトに見える着替えはログイン時（join skin= skincolor=）で確かめる |
| AuthInput の Pos Delta（クライアントが予測した速度）をいつも 0 で送っていたので、速度を見る仕組みが動かなかった（槍の突進が生き物をすり抜けた） | サーバーが確定した位置の 1 tick の差を速度として送る（テレポートのような飛びは 0）。突進が当たる（op.spear） |
| server-ui の MessageBox をスクリプトが変数に持ったまま、そのプレイヤーが抜けて入り直すと、新しい Player の locatorBar.addWaypoint が「An internal engine error occurred」になる（BDS 1.26.51。本物のクライアントでも同じくサーバー側で起きる） | 厳密な検証は区間ごとに `$` を空にする（区間どうしが影響しない）。アドオンでは、フォームの結果が出たら参照を捨てる |

## 8. SimulatedPlayer（補助）

`js sim(name, x, y, z, gameMode)` で gametest の `spawnSimulatedPlayer`。アドオンと同じ文脈で作るので、アドオンから普通のプレイヤーとして見える。
フォームには `js answer(v)` で答える（先に答えを積んでおくこともできる）。ネットワークを通らないので、クライアント側の見え方（届いたメッセージ・画面）の検証には使えない。

## 9. AI の道具の設計

| 道具 | トークンを減らす工夫 |
|---|---|
| `api` | d.ts のコメントを消し、クラス 1 つ・メンバー 1 つ・`world.afterEvents.x` の経路で引く。継承は大きければ名前だけ出す。イベントは受け取るオブジェクトの中身まで一緒に出す |
| `sample` | その BDS 版のバニラ定義（`.brarchive` を直接読む）と、Mojang の公式サンプルの RP を 1 行の JSON で出す。`key/key` で絞れる |
| `add` | アイテム・ブロック・生き物に要るファイルを一度に全部作る。`部品=値` で部品も指定できる |
| `png` | 文字で描いたドット絵を PNG にする |
| `check` | 起動せずに分かる誤りを先に出す（起動 2 秒を節約） |
| 出力 | 繰り返しは `(xN)`、100 行で打ち切り、定型文を消す |

## 10. 品質の保証

| 何を | どうやって |
|---|---|
| 採点の仕組みが正しい | `node bench/bench.mjs selftest`: 空のアドオン＝0 点、模範解答＝満点・`.mcaddon` 作成、例外＝検出 |
| 各イベント・状態・フックが仕様どおりに起きる | `node docs/coverage/run.mjs` が `spec.txt` の全区間を実機で流し、`EVENTS.md` を作る（§12）。結果は EVENTS.md の冒頭 |
| 配布物が壊れていない | `pack` は静的検査を通ったものだけを梱包。CI（`.github/workflows/verify.yml`）が push ごとに全アドオンの `test` と `pack` を回す |
| GitHub の流れが壊れていない | `node bench/github-smoke.mjs`: 偽の `gh` と `git url.insteadOf` で https://github.com/ を手元の bare リポジトリに向け、`github`・`ship` 2 回・`publish` を実際に通す（private・main にアドオンが無い・addon/<名前> の中身・Release の 3 ファイルと history.zip・公開側に BDS も lab も無い・アドオンのフォルダが消えない） |
| 例のアドオンが動く | `node lab.mjs test -a spectator_probe`: 元の仕様書の受け入れ条件 9 本を real player で流す（43 項目） |
| TS の開発環境が動く | `new` → 型エラーで BDS 前に止まる → 実行時エラーが src/ の行で出る → `up` / `do` の再読み込み（スクリプトは /reload、JSON は再起動と再参加）→ `pack`。github-smoke は TS アドオンで ship を通す |

## 11. 既知の限界

- リソースパックの見た目はゲームの描画では確かめられない。モデルは `render`（ゲームと同じ x の鏡像・UV の向きで描く §18）で PNG にして目で見る。JSON UI は静的に解決するだけ（§19）。クライアントに RP が届いたかは `@A packs`
- 再現しないもの（スクリプトから見えないため）: レシピ本の並び（とレシピ本からの自動クラフト。結果は手で並べるクラフトと同じ）、エイムアシストの切り替え、地図・ロードストーンの問い合わせ、効果音（クライアントが鳴らす LevelSoundEvent）
- `packSettingChange`: BDS では誰にも起こせない（1.26.51 で確定）。ServerboundPackSettingChange の受け口（パケットの振り分け 0x8a3d000 から vtable 0xf037bf0 の +0x788 → 0x8908d60）は、送り主の `Player::isHostingPlayer`（ServerPlayer+0xbc2）が true のときだけ設定キャッシュを更新する（更新する関数 0x9986e20 を呼ぶのはこの受け口だけ）。この旗は Player のコンストラクタ（0xbb2d540）の 5 番目の引数でしか立たず、ネットワークのログインから作る経路（0x892a780）は常に 0 を渡す。動いている BDS に Frida を当てて実際の値も読んだ（旗 0・キャッシュあり）。Mojang の protocol-docs どおりの形・UUID の補正込み・Owner 権限でも同じで、本物の人間でも同じ。起こせるのは 1 人プレイや LAN を開いた本人（ホスト）だけ。`@A packsetting` は「送っても何も変わらず切断もされない」ことを確かめる区間（op.packsetting）になり、EVENTS.md ではこの 1 件を「BDS では誰にも起こせないもの」として数を分けた。運営者のやり方 `packset`（ワールドの `world_behavior_pack_settings.json`。形式は BDS のエラーメッセージから特定: `{"format_version":"1.26.40","minecraft:pack_settings":{"settings":[{"pack_id":…,"values":{…}}]}}`、起動時だけ読む）で設定値ごとの動きを確かめる。`soundCompleted`・`entityUpgrade` は起こせるようになった（§7 の表）。`messageReceive` は d.ts に「内部用」とあるが、クライアントの ScriptMessage で起きる（`@A message`）
- PvP の細かい動き（ノックバックの予測など）は持たない。必要なら外部のものを使う
- Windows 版は実装のみで、実機での確認はしていない。macOS では BDS が動かない

## 12. 厳密な検証（docs/coverage/spec.txt）

「イベントが 1 回でも出たら ✔」では、殴っただけで entityDie を、途中まで掘っただけで playerBreakBlock を認めてしまう。そこで id ごとに次を守る。

| 規則 | 例 |
|---|---|
| id ごとに専用の発生条件を 1 つ決め、区間（`## id \| 条件`）として書く。別の id と同じ操作を使い回さない | playerStartBreakingBlock＝黒曜石を押し続けている / playerCancelBreakingBlock＝石を 5 tick で止める / playerBreakBlock＝土を掘り切る |
| 起きるべき行を、欄の値まで正規表現で確かめる（`(?=.*欄=値)` で順不同） | entityDie は `deadEntity=minecraft:pig` かつ `damageSource={cause=entityAttack damagingEntity=A}` |
| 起きてはいけない行を `!~` で確かめる | entityHitEntity（素手で 1 回）では entityDie が無い / playerCancelBreakingBlock では playerBreakBlock が無い |
| 結果の状態を `js` と `=` で確かめる | 止めた石は残っている / 水のポーションは飲み切るとガラス瓶になる |
| before 系は probe アドオンの cancel 規則で「止められること」まで確かめる | 金ブロックは壊せない・置けない、`!secret` のチャットは届かない、tag god の負傷は無効（体力 20 のまま） |
| どの区間も同じ初期状態から始める（`run.mjs` の RESET: 位置・モード・持ち物・効果・タグ・周囲の地形・時刻・天気・体力） | 前の区間の生き物や地形が次の区間の判定に混ざらない |
| BDS では誰にも起こせないものは、理由と確かめ方を書いて残し（`\| 不可: 理由`）、数は分ける | packSettingChange はホストのプレイヤーからしか受け付けない（逆アセンブルと Frida で確認） |
| スクリプトからプレイヤーへの効果は、本物のクライアントが受け取ったもので確かめる（`api.<クラス>.<メンバー>`、`@A watch`） | setHudVisibility(Hide,[Hotbar]) → `saw set_hud {"elements":["HotBar"],"visibility":"hide"}` |
| 網羅は d.ts から数える（区間の無いものは不足として出る） | 全イベント・プレイヤー状態・カスタムコンポーネントのフック・Player まわりのクラスのメソッドと書き込めるプロパティ・CustomCommandParamType/Source の全値 |

実測で分かった API の性質（EVENTS.md の「実測」欄に実際の値がある）:

- `itemStartUseOn` の `block` は使った後の状態（クワで耕すと farmland）。`playerInteractWithEntity` は `beforeItemStack`（使う前）と `itemStack`（使った後）を持つ（バケツ→牛乳）
- 独自アイテムは `minecraft:digger` で掘っても耐久が自動では減らない（攻撃では減る）。掘って減らすなら `onMineBlock` で行う
- `ItemStack` の部品は、`getItem()` の戻り値を変数に持ってから読む。`c.getItem(0).getComponent('durability').damage` のように続けて書くと「Failed to get property」で失敗する
- `before.effectAdd` の `effectType` は表示名（`Poison`、`Regeneration VI`）。`after.effectAdd` の `effect` は Effect（`minecraft:poison`）
- `entityItemDrop` の `items` は落ちたアイテムの実体。`entityItemPickup` の `items` は ItemStack
- `playerJoin` / `playerLeave`（after）は名前と id だけ。実体を読めるのは `before.playerLeave`
- `block.onBreak` はプレイヤーが壊したときも呼ばれる（`entitySource` がそのプレイヤー）。`/setblock` で消したときは `entitySource=-`
- `block.onEntity` は、生き物の JSON イベントの `trigger` で `"target": "block"` を指定したときに届く。対象のブロックは `minecraft:behavior.place_block` の `on_place` なら今置いたブロック
- ワールド時計（`registerClock`）の最大値は 2147483647。昼夜が進んでいる（`dodaylightcycle`）ときだけ進み、最大値で `before.worldClockOnRestart`（`newTime=0`）
- manifest の `settings`（パックの設定）は format_version 3 の manifest でないと登録されない（`world.getPackSettings()` が空になる）
- `setControlScheme` が受け付ける方式はカメラで決まる: first_person / third_person / third_person_front は LockedPlayerRelativeStrafe だけ、follow_orbit はそれに CameraRelative と PlayerRelative、free と fixed_boom は 5 つ全部
- `eatItem` は食べた効果（満腹度）だけで、itemCompleteUse などの使用イベントは起きない
- カスタムコマンドの Enum 引数は、登録していない値もそのまま渡される（BDS 1.26.51）。ItemType / EntityType / BlockType 引数は型の実体（id を持つ）。呼び出し元は Entity（プレイヤー）・Server（スクリプトの runCommand）・Block（コマンドブロック）・NPCDialogue（NPC のボタン: sourceEntity=NPC、initiator=押した人）
- `Waypoint.remove()` の後も `isValid` は true（また足せる）。`FogSettings.getTags()` は新しい順
- `playSound` は SoundInstance を返し、その `setVolume` / `setPitch` / `pause` / `resume` / `seekTo` / `fade` / `stop` は handle 付きの別パケット（clientbound_update_sound_data）で届く。`stopSound`（名前指定）とは別

## 13. GitHub と BDS（元の bds-lab から引き継いだ決まり）

| 決まり | 実装 |
|---|---|
| 手元が正、GitHub は写し。合流（merge / rebase）はしない | push が拒まれたら fetch して force push。残った合流あとは片づける |
| main はテンプレートのまま、アドオンは `addon/<名前>` の枝 | 枝は git の低レベル操作（一時的な index で main の木に `addons/<名前>` を足す）で作る。作業中のフォルダは切り替えないので、**どのアドオンのフォルダも消えない** |
| リポジトリは private。この道具が作ったものだけを使い回す | 変数 `BDS_LAB` の印（または中身）で見分け、違えば `名前-2` を作る |
| BDS の zip は GitHub にも載せる | 45MB を超え git-lfs があれば LFS、無ければ載せない（CI は落とす） |
| Release は枝ごとに 1 つを更新し続ける | `template`＝作業用 zip（BDS 同梱）、`addon-<名前>`＝最新の `.mcaddon`・ソース zip・`history.zip`（それまでの .mcaddon、新しい順に 40 個） |
| 公開はアドオンだけ | `publish` は addons/<名前> と README（TASK.md と最後の test の結果から作る）だけの public リポジトリ。BDS・lab・vendor は入れない（名前と大きさで検査） |
| gh もネットワークも無い環境でも止まらない | 手元の git だけで進める |
| BDS の取得 | `LAB_BDS_ZIP` → `vendor/bedrock-server.zip` → 公式の配布 API → `common/data/bds-versions.json` の CDN → 固定の版。落としたものは `vendor/` に残す。`bds --update` / `bds <版>` / `bds --preview` |

## 14. 開発環境（TypeScript・ライブラリ・常駐サーバー）

| 決まり | 実装 |
|---|---|
| 既定は TypeScript・beta・BP+RP | `new` は `src/main.ts`、`@minecraft/server` と `server-ui` の beta（この BDS 向けに npm で公開された `X.Y.Z-beta.<BDS版>-stable` から決める）、RP と pack_icon、en_US / ja_JP の lang。`--stable` は同じ BDS と同時に出た素の版（npm の公開日時で判定）、`--js` は `bp/scripts` に直接書く従来の形 |
| beta と stable の切り替え | `mode beta\|stable` が manifest の @minecraft/* を一括で差し替える。型も次のビルドで追従する |
| ビルド | esbuild で ESM 1 本に束ねる（target es2023, platform neutral）。ゲームが持つモジュール（server, server-ui, server-gametest, server-net, server-admin, common, debug-utilities …）は外部、それ以外（math, vanilla-data, gameplay-utilities, npm の依存）は同梱。Node の組み込み（fs, path …）を import すると理由つきのエラー（scriptup の依存検査と同じ考え方） |
| 型検査 | TypeScript の API を直接呼ぶ（増分、.lab/tsinfo）。`noLib` + `@bedrock-apis/env-types` で QuickJS に無い `setTimeout` などを型エラーにする（scriptapi-addon-template と同じ）。TS は `E`（起動しない）、`--js` のアドオンは `check` のときだけ `T` |
| 共有 SDK | manifest の依存の組ごとに 1 つ、`.lab/sdk/<hash>/node_modules` に型と Mojang のライブラリを入れる。アドオンごとの node_modules は `lib add` したときだけ。`tsconfig.json` はその SDK を指す形で毎回書く（エディタも同じものを使う） |
| 行番号 | ビルドのソースマップを `.lab/maps/<アドオン>.json` に置き、BDS の `(main.js:123)` を出力の段階で `(src/util.ts:5)` に置き換える（プロファイルの行も同じ） |
| 常駐サーバー | `up` が別プロセスの Engine（`live` インスタンス）を立て、127.0.0.1 の HTTP で `do` を受ける。`do` は前回読み込み以降に src/bp/rp が変わっていれば先にビルドし、scripts だけの変化なら `/reload`（プレイヤーは残る、実測 2 秒）、それ以外は同じワールドで再起動して参加していたプレイヤーを同じ引数で入れ直す（実測 5 秒）。30 分使わなければ自分で止まる |
| VS Code のデバッガ | `debug` が `.vscode/launch.json` にアドオンごとの Mojang minecraft-debugger の設定（listen 19144、TS なら `.lab/debug/<アドオン>/` の .map と bp/scripts）を足す。BDS は `allow-outbound-script-debugging` / `allow-inbound-script-debugging` を有効にして起動するので、`do "script debugger connect 127.0.0.1 19144"` でつながる（接続時に ProtocolEvent が届くのを実測） |
| 1 回ごとの `run` / `test` と同じ出力 | Engine は一括実行と常駐で共通。区間・`until`・`prof`・`perf` もどちらでも使える |

## 15. 参考資料の取り込み（Mojang のリポジトリの使い方）

| 資料 | 使い方 | なぜこの形か |
|---|---|---|
| bedrock-protocol-docs | `proto <Packet\|型\|?語>`: BDS と同じ版のタグ（v1.26.51）の json/ だけを取り、欄の順・型・varint か固定長か・enum の値を 1 行ずつ出す | real player の不具合はパケットの読み書きのずれが原因。実際に砥石（id 欄は入力の stack id）と UUID（上位・下位 64bit がそれぞれ little endian）はこれで解けた |
| bedrock-schemas | `doc <component\|query\|?語>`: forms（欄の型・既定値・範囲・説明・サンプル）を 1 件だけ短く出す。ビルドのたびに全パック JSON を JSON スキーマで検査（`common/schema.mjs`、アイテムのコンポーネントは forms から組み立てる） | スキーマ自体はバニラでも誤検出が出るので、バニラ 7,000 余ファイルで較正（`common/data/schema-calibration.json`）：バニラが破る節点×キーワードは出さない、E はバニラが通る節点の型・値・必須だけ、知らないキー・範囲・パターンは W |
| bedrock-samples | `sample rp/...`（RP のバニラファイル）。BP は BDS の同梱を使う | 版がずれない |
| minecraft-scripting-libraries | `@minecraft/math`・`gameplay-utilities` を SDK に常備し同梱 | 自前のベクトル計算を書かせない |
| minecraft-debugger | AI には同じ仕組み（BDS の `script profiler` / `script diagnostics`）を `prof` / `perf` の 1 行の要約で。人には `debug` で VS Code から常駐サーバーにそのままつなぐ | デバッガの画面は AI に向かない。数字だけ要る |
| Creator Tools（`@minecraft/creator-tools`） | `check --deep`（Mojang の検証。beta 版の古さなど、この環境では誤りになるものは除く）、`render`（モデル＋テクスチャを 256px の PNG に。AI が画像として見る） | 約 300MB なので使うときだけ入れる |
| scriptAPIServerSkill | 実行権限の規則（before イベントは制限つき、起動直後は early-execution）を `api` の印 `no-before` / `early` と AGENTS.md の 2 行にした | 規則を読ませるより、引いた API に印が付いているほうが短い |

## 16. デバッガ（Mojang の script debugger プロトコル）

| 決まり | 実装 |
|---|---|
| 何を使うか | minecraft-debugger（VS Code 拡張）が BDS と話すのと同じプロトコル: 8 桁 16 進の長さ + 改行 + JSON 1 行。要求は DAP の名前（setBreakpoints / stackTrace / scopes / variables / evaluate / continue）、BDS からは ProtocolEvent・StoppedEvent・PrintEvent・StatEvent2。npm の quickjs-debugger は 2 年前の版向けなので使わず、protocol v10 に合わせて自前で持つ（`common/debugger.cjs`、100 行） |
| いつつなぐか | 毎回。`script-debugger-auto-attach=connect` でワールド読み込み時に BDS から lab へつなぐので、アドオンの 1 行目より前にブレークポイントを置ける（`-t file:line`）。再起動・`packset`・常駐の再起動でもつなぎ直し、trace を置き直す |
| `trace <file:line> [式…] [xN]` | 行ごとのブレークポイント。止まるたびに stackTrace → (初回だけ) scopes / variables で名前を集め → helper の `__labv` を 1 回の evaluate で呼んで全変数を整形 → continue。Local と Closure（モジュールの変数を含む）を出し、Global は出さない（巨大で応答が止まる）。2 回目からは変わった変数だけ。値の形は events tap と同じ（Player→名前、Block→id@x,y,z、イベント→欄）。world / system は省く |
| 行の対応 | TS はビルドのソースマップを逆引き（その行の最初の生成行。コードの無い行は次のコード行へ）。止まった行はソースマップで src の行に戻して出す |
| 二重停止 | QuickJS は呼び出しを含む行で、呼び出しの後にもう一度止まる。150ms 以内に同じ値で止まったものは表示しない |
| `trace err` | stopOnException。QuickJS は捕まえた例外でも止まる（実測: 1 tick に 5 回 try/catch すると 20 → 0.7 tick/秒）ので既定は off。止まった行は 1 行前を指すので +1 して出す（エラー自身のスタックと一致） |
| `cov` / `--cov` | 全コード行にブレークポイントを置き、初めて止まったら外す（続行を先にして、外すのはまとめて）。解決できない行・閉じ括弧・import は数えない。止まるたびに時間が変わるので、test では合否を決める普通の実行の後に、別の 1 回で取る |

## 17. 見る・調べる（Mojang のデータの使い方の追加分）

| 道具 | 中身 |
|---|---|
| `view x1 y1 z1 x2 y2 z2` | helper が箱の中のブロック（状態つき）を Creator Tools の IBlockVolume（下から上の層、北から南の行、西から東の文字）にして分けて送り、`mct buildstructure` → `mct renderstructure` で本物のテクスチャの PNG に。800px の画像を 400px に縮めてから渡す（画像トークンを 1/4 に） |
| `example <名前\|?語>` | Creator Tools の npm パッケージにだけ入っている Mojang のスクリプト例（how-to gallery 70 関数、カスタムコマンド・カスタムコンポーネントなど）を関数単位で索引。本文は注釈を抜いて出す。取るのは 40MB の tar から 270KB の .ts/.json だけ |
| `doc` の vanilla | bedrock-samples の metadata（BDS と同じ版のタグ、git ls-remote と raw ファイルで取得。GitHub API は共有アドレスで制限されるため使わない）: ブロックの状態と値・アイテム/エンティティの id・コマンドの全書式（enum の値を展開）・1 tick の中で after イベントが起きる順（アドオンの @minecraft/server の版に合わせる） |
| 未知のコンポーネント | BDS は名前の間違ったコンポーネントを黙って無視する（実測）。forms のアイテム・ブロック・エンティティのコンポーネント名と照合し、近い名前を出す（誤検出の確認: probe と `add` の雛形で 0 件） |
| エラーのヒント | 実測したエラー文（early execution・restricted execution・未ロードのチャンク・ItemStack の連鎖・範囲外の y・不正な id・未処理の Promise・動的プロパティの長さ・コマンドの構文・新しすぎる format_version・値の型）に、直し方を 1 行添える。同じヒントは 1 回だけ |


## 18. モデル（iMasterProX/mcbemodelingmasterAI の方法）

`common/model.mjs` は mcbemodelingmasterAI（MIT）の描画器と検査器の JavaScript 移植（Python/numpy 不要、同じ絵を約 4 倍速で描く）。ゲームは x を鏡に映して描く（east の UV は JSON の低い x 側）、回転は右手系 (-rx, ry, -rz) を X→Y→Z、アニメの回転は元の姿勢に足す、アルファ 50% 未満は抜く。box UV は Blockbench と同じ配置で面ごとの UV に直す（上下の面は反転）。pivot の無い立方体は箱の中心で回す。`render` は自分のエンティティ・アタッチャブル・geometry、`minecraft:<mob>` なら Mojang の bedrock-samples のバニラ（JSON は一度だけ部分 checkout、テクスチャは 1 つずつ。PNG はパレット・16bit、TGA も読む）、`--anim id@秒` でその時刻の姿勢（Molang は数値・math.*・anim_time）。`check` は全 geometry を検査（潰れた立方体・z-fighting（回転した面も、面の重なりの面積で）・テクスチャ外の UV・両面板の大きさ違い・重複）。

## 19. JSON UI（shawtymarco/MCBE-UI）

BDS は RP の UI を読まないので、`check` が静的に解決する（`common/jsonui.mjs`）: `name@ns.element`・grid_item_template・`$..._control` 等の参照を自分の UI と bedrock-samples のバニラ UI（182 名前空間）から探し（無ければ近い名前を示す）、_ui_defs.json の登録漏れ・存在しない登録、バニラ画面の上書きで名前空間を変えてしまう誤り、type/anchor/binding_type などの値（バニラが使う値すべて＋JSON-UI-Web-Editor の一覧）、texture のパス（この RP かバニラ）を確かめる。バニラ自身に当てて誤検出を較正した（Chest-UI では実在しない画像だけを指摘）。`ui build <layout.yaml>` は MCBE-UI の IR（部品の anchor/pos/size と対称・整列の制約）を MCBE-UI 自身のソルバとコンパイラで rp/ui/<screen>.json にし、_ui_defs に登録、解いた配置の図（PNG）を出す。MCBE-UI にはライセンス表記が無いので同梱せず、初回に取ってくる。

## 20. 複数の BDS（shawtymarco/go-multiversion の考え方）

go-multiversion はサーバー側でプロトコルの差を吸収する。lab では逆に、アドオンが古い BDS でも動くかを本物で確かめる: `test --bds <版,...>` / `--matrix`（今の版と、前の 2 系列の最新ビルド。`bds --list`）。版ごとに .lab/v/<版> に別のキャッシュ（サーバー・ワールド・プロトコルのデータ）を作り、版に依らないもの（ビルドの道具・型・samples）はリンクで共有、vendor/ は触らない。real player は BDS の版以下で最も新しい minecraft-data の版（1.26.44 → 1.26.40、同じプロトコル系列）で話す。1.26.36.1 で実測: min_engine_version と beta のモジュール版で読み込めない理由をそのまま出し、直せば PASS。
real player は版ごとの表の違いに合わせる: 1.26.30 系の表は入力の印（InputData）を名前のビット集合で持つ（新しい表は名前の列）。列のまま送っていたので古い版では印が全部 0 になり、ブロック操作の欄も付かず、掘る・しゃがむ・跳ぶが効いていなかった（1.26.36.1 で掘れないことを実測 → 直して PASS）。npm に beta の型が無い修正版（1.26.45）は同じ系列の 1 つ前（1.26.44）の型を使う。
1.26.45（protocol 2169）は minecraft-data の表が実物と違う。生のバイト列を 1.26.45.1 に送って決めた形: 省略できる欄は「無い = 0 の 1 バイト、有る = 1, 1, 値」（option の中にもう 1 つ option。表の `x_presence` の bool + option を、その形に置き換える。AuthInput・TransactionActions・ItemStackResponses のすべて）。入力の印は 1, 個数, 印…（列を包む option。1.26.51 で外れた）。前の版は印の列の option を外していたので、印が 1 つでも付くと `invalid enum value` で切られていた（歩く・掘る・腕の振りすべて）。
1.26.30 系の表（1.26.36）は、持ち物の stack id が {type, id} の組、レシピが種類付きの 1 本の列（形のあるレシピの材料は幅×高さ）、材料の書き方が別（int id / 文字 id / タグ）、クラフトの結果は ItemLegacy。受け取ったものを新しい形にそろえてから使う（移動・クラフトが `FailedToValidateSrcSlot` や「レシピが無い」で失敗していた）。
確かめ方: 歩く・跳ぶ・掘る・置く・腕を振る・持ち物の移動・2x2 と作業台のクラフト・攻撃・しゃがむ/走る・フォーム・食べる・捨てる・チェストへの移動・チャットの 14 区間を `test --matrix` で 1.26.51.1 / 1.26.45.1 / 1.26.36.1 のすべて PASS。モジュールの版が無いときは `E @minecraft/server 2.10.0 is not in this BDS; it has 0.1.0 1.19.0 2.9.0 2.10.0-beta 3.0.0-alpha` の 1 行にまとめる。

## 21. macOS（サーバー側だけをコンテナで動かす: `common/runtime.mjs`）

| 事実 | 対応 |
|---|---|
| BDS に macOS 版は無い。Endstone は Windows / Linux の wheel だけ。LeviLamina は Windows のプログラム | macOS では、サーバー側（BDS・Endstone の venv と起動・lip・Wine・C++ プラグインのビルド）を linux/amd64 のコンテナで動かす。ラボ本体（node: ビルド・型検査・本物のクライアント・デバッガ・テスト・`up`/`do`）は Mac の上のまま |
| パスを渡し合う設計（キャッシュ・インスタンス・venv・Wine の接頭辞・ソースマップ） | リポジトリとキャッシュを**同じ絶対パス**でマウントする。どのパスもコンテナの内外で同じファイルを指すので、フレーバーの処理を書き分けずに済む。作業フォルダがマウントの外なら、それも足す |
| ファイルの持ち主・pip や Wine の設定の置き場 | `--user <uid>:<gid>`、`HOME=<キャッシュ>/home` |
| BDS の UDP ポート | `-p 127.0.0.1:N:N/udp`（IPv4 と IPv6 用の 2 つ）。本物のクライアントはこれまでどおり 127.0.0.1 へつなぐ |
| コンテナには既定で IPv6 が無い | IPv6 シムをコンテナの中の gcc で作って LD_PRELOAD（Linux と同じ仕組み） |
| BDS がラボのデバッガへつなぐ（`trace` / `cov`） | 接続先を `host.docker.internal`（`--add-host host.docker.internal:host-gateway`）、ラボ側の待ち受けを 0.0.0.0 に。VS Code 用の `debug` の案内も同じ宛先を出す |
| 標準入力でコマンドを送る | `docker run -i --init --rm`。止めるときは `stop` を送り、残れば `docker rm -f <名前>`（終了時にも必ず実行） |
| イメージ | ubuntu:24.04 に BDS が要るもの（libcurl4、gcc）。end は Python・venv・cmake・ninja・clang・libc++、ll は Wine・winetricks を足す。Dockerfile の中身のハッシュを tag にし、変えたときだけ作り直す |
| Wine の接頭辞 | 初回だけ `wineboot -i` と `winetricks -q vcrun2022`（LiteLDev の Docker イメージと同じ準備）。Linux でも同じ |
| pyright が venv の python を実行できない（中身は Linux） | macOS では venv の site-packages を直接読む設定（venvPath / venv）を生成して渡す。Python の構文検査は Mac の python3 があればそれで行う（コンテナ起動 1 回ぶんの時間を省く） |
| Apple Silicon | amd64 のイメージは Rosetta（Docker Desktop の設定、OrbStack は標準、colima は `--vz-rosetta`）で動く。無ければ QEMU（遅い） |
| 切り替え | 既定は macOS だけ docker。`LAB_RUNTIME=docker|native`、`LAB_DOCKER`（podman など）、`LAB_DOCKER_MOUNTS` |

確かめ方: `tests/fake/docker` が docker の代わりに引数を検査し（同じパスのマウント・作業フォルダがマウントの中・ポートが 127.0.0.1 の UDP・host.docker.internal・HOME・amd64 固定）、プログラムをそのまま手元で動かす。`tests/offline.mjs` の docker 節が、3 ラボの起動・`py`・`lse`・`up`/`do`/`down`・コンテナが残らないこと・docker が無いときの案内を通す。**本物の Docker Desktop / OrbStack / colima の上では未確認**（この作業環境に Mac とネットワークが無い）。

## 22. real player の追加（v33）

| 操作 | 本物のクライアントが送るもの |
|---|---|
| `quick <slot>` | シフトクリック。コンテナが開いていればコンテナとインベントリの間、なければホットバーとインベントリの間。同じアイテムで空きのある欄、次に空の欄へ（ItemStackRequest place） |
| `split` / `spread` / `swap` | 右クリックで半分・ドラッグで均等に配る（残りは元の欄）・持ち替え |
| `hotbar next|prev` | ホイール（MobEquipment） |
| `turn <dyaw> <dpitch> [ticks]` | 視点を tick ごとに少しずつ回す（PlayerAuthInput の yaw/pitch が滑らかに変わる） |
| `frame [x y z]` | 額縁を左クリック: 腕を振って ItemFrameDropItem |
| `sleep x y z` | ベッドを上面から使う（寝られない理由はサーバーが返す） |
| `render <chunks>` | 描画距離の変更（RequestChunkRadius） |
| `serversettings` | 設定画面を開いたときの ServerSettingsRequest。返ってきたフォームは `form ...` で答える（ModalFormResponse） |
| 自動 | 照準がエンティティに乗るたびに Interact MouseOverEntity（位置つき、変わったときだけ）、参加後に EmoteList、表示されたボスバーに BossEvent RegisterPlayer、ボートを漕ぐ間 Animate RowRight/RowLeft、持った地図 1 枚につき MapInfoRequest 1 回 |

パケットの項目名は bedrock-protocol の表の版ごとに違うことがある。書けないパケットは、操作なら `<操作>: this protocol cannot send <パケット>` と出し、自動のものは黙ってそれだけ止める（例外で操作全体が止まらない）。確かめ方: `tests/realplayer-offline.mjs` が bedrock-protocol を記録するだけの偽物に差し替え、送るパケット・順番・欄・個数を検査する（17 項目）。**BDS がこれらを受け付けるかは実機で未確認**（`docs/coverage` の実機試験に区間を足すのが次の一歩）。PvP の応用（連打の間合い・横移動の駆け引き）は再現の対象外で、必要なら既存の操作の並びで組む。

## 23. v34: 一つの入口・日常の動作・多バージョン・サーバー限定の道具

| 何を | どうしたか |
|---|---|
| どの AI でも迷わず始める | 最上位に `AGENTS.md`（約 170 token: 3 つのラボの選び方だけ）と `lab.mjs`。`node lab.mjs <bds\|end\|ll> <cmd>` はそのラボの lab.mjs に**同じプロセスのまま**なり替わる（`process.argv[1]` と cwd を差し替えてコアを読むだけ。ラボの説明書のパスがそのまま通じる）。選んだラボは `.lab-kind` に覚え、以降はラボ名なしで打てる |
| 説明書の token | end / ll の AGENTS.md を書き直し、道具を増やしながら文字数は 2 割減（4,192→3,241、3,776→3,111）。細部は `help <項目>` へ |
| 日常の動作（約 60） | `common/verbs.cjs`。人と同じく「道具をホットバーの数字キーで選ぶ／無ければ持ち物から選択中の欄へドラッグ」してから、既存の操作（実機で確かめた useon / use / dig / interact / move / 移動キー）を同じ順に送る。新しいパケットを 1 つも足していないので、BDS が受け付けるかの危険は増えない |
| 古い版のクライアント | `@A join version=<x.y.z>`。bedrock-protocol の表は 1.21 以降をすべて残す（Java 版の分は消す）。BDS は自分のプロトコルしか受けず、本物と同じく `play_status failed_client/failed_server` で断る → `@A refused: ...`。`LAB_PROXY` に変換プロキシ（Ouranos・go-multiversion など、`{listen} {server} {version} {serverVersion}` を置き換え）を書くと、サーバーごとに 1 つ起動してそこへつなぐ（再起動でポートが変わるので作り直す） |
| Endstone: パケット | `PacketReceiveEvent` / `PacketSendEvent`（packet_id・payload・取り消し可）を補助プラグインが受け、`LAB_PK` 行で渡す。ラボ側で real player と同じ表（createDeserializer）で読み解いて `PK A> name {..}` にする。`packets drop` は次の n 個を取り消す（欠けたパケットへの強さを試す） |
| Endstone: fuzz | プラグインのコマンドの `usages`（`<n: int>` `[who: str]` `(a\|b)`）から引数を作り、`on_command` を直接呼ぶ。例外は種類と自分のソースの行ごとに 1 回、入力つきで `E FUZZ` |
| Endstone / LeviLamina: lag・watch | サーバースレッドで毎 tick 眠る（TPS が落ちたときの挙動）。式を毎 tick 評価し、変わったときだけ `W 式 = 値`（登録した瞬間の値も出す） |
| LeviLamina: bots | LSE の `mc.spawnSimulatedPlayer`（通信なしのサーバー側プレイヤー、`simulateMoveTo` で歩く）。大人数の負荷・参加退出の処理を、本物のクライアントより安く試す |
| LeviLamina: クラッシュ | CrashLogger が `logs/crash/trace_*.log` に残す記号つきのスタックを、クラッシュ行の下に出す（自分の mod のフレームを先に） |

確かめ方: `tests/offline.mjs`（偽の Endstone に PacketReceive/SendEvent とプラグインのコマンド、偽の LeviLamina に模擬プレイヤーと CrashLogger の記録を足した）、`tests/realplayer-offline.mjs`（動作が送るパケットの順番と中身、25 項目）。**本物の Endstone・LeviLamina・BDS では未確認**: Endstone の Python 側のイベント名・属性名（C++ のヘッダと changelog どおり `packet_id` `payload`）、LSE の `spawnSimulatedPlayer`（文書どおり）、CrashLogger の記録の書式、動作の実機での受け付け（`docs/coverage/spec.txt` に区間を足した）。

## 24. v35: 実機（M1 Mac）で出た不具合と selftest

| 実機で出たこと | 原因 | 直し方 |
|---|---|---|
| `npm install bedrock-protocol failed: EALLOWGIT` | npm 12 から git 由来の依存が既定で禁止（allow-git=none）。bedrock-protocol → prismarine-auth → GitHub 上の prismarine-xbox-services | ラボはオフライン接続しか使わないので、prismarine-auth を「呼ばれたら理由を言って失敗する」代用品に package.json の overrides で差し替え。念のため `npm_config_allow_git=all`（npm 11 以前は無視） |
| `do "@A join"` のエラーが何も出ない | 複数行のメッセージ（npm の出力）を 1 つのログ行として積み、表示側の 1 行ずつの読み取りに合わず捨てていた | 表示の前に必ず改行で分ける（この種のエラーすべてに効く） |
| ll: `lip install ... failed: the default install location cannot be obtained` | コンテナの利用者に passwd も $USER も無く、Wine がユーザーのプロファイルを作れず、Windows 側の %LOCALAPPDATA% が決まらない（と判断。lip のエラー文から） | Wine に USER / USERNAME / USERPROFILE / APPDATA / LOCALAPPDATA を明示。v33 で作った接頭辞は作り直す（目印 `.lab-prefix-v2`）。それでも lip が失敗したら、LiteLDev 公式の `ghcr.io/liteldev/levilamina-server:latest-wine` にサーバーを入れさせ（EULA・VERSION・PACKAGES、/data にキャッシュを渡す）、起動したら止めて、そのフォルダをラボが動かす |
| bds の `up` / `test` は Mac の docker で動いた | — | macOS 対応（§21）の実機確認 |

**selftest**: `node lab.mjs selftest`（最上位から `node lab.mjs selftest all`）。setup → 使い捨ての `labselftest` を `new` → tests.txt = 3 ラボ共通（本物のクライアントの参加・チャット・コマンド・`place` `till` `equip`・古い版での参加）＋ラボ固有（`F.selftest`: bds は js と Script API のイベント、end は py・イベント・パケットの読み解きと落とす・fuzz・lag と perf・watch、ll は mod の読み込み・lse・イベント・bots・watch・lag）→ `.lab/selftest.txt`。本物のクライアントの部品だけが入らないときは、それを書いたうえでクライアントを使わない区間を最後まで流す。作ったプラグインは消し、「今のプラグイン」も元に戻す。私（この作業環境）は本物のサーバーを動かせないので、この報告が直すための材料になる。

**動作 174（v34–v36）**: 表（ON_BLOCK / CLICK / ON_MOB / IN_HAND）で、同じ仕組みを人の言葉で名付けたものと、組み合わせの用事（store / retrieve / brew / chop / dig_down / tunnel / farm / fill）。基本操作 86 と合わせて 260。新しいパケットは足していない。

## 25. NetherNet（WebRTC の通信方式）

根拠: Mojang「NetherNet HTTP Signaling — Partner Onboarding Guide」（bedrock-protocol-docs）、df-mc の nethernet-spec / go-nethernet、BDS 1.26.44 の server.properties（`transport=raknet|nethernet`、`server-ip`・`server-udp-ports` は nethernet のときだけ。1.26.44 の既定は raknet、その後既定が nethernet になったという報告あり）。

| 何を | どうしたか |
|---|---|
| ラボのサーバー | 既定は `transport=raknet` を**明示**（既定が変わっても本物のクライアントの経路は今までどおり）。`LAB_TRANSPORT=nethernet` で `transport=nethernet` と `server-udp-ports=<port+100>-<port+107>`（コンテナでは `127.0.0.1:範囲:範囲` として公開側の住所を知らせる）。docker では信号用の TCP の server-port と UDP の範囲も 127.0.0.1 に公開 |
| 本物のクライアント | `common/nethernet.cjs`。RakNet の部品と同じ口（connect / sendReliable / close / onConnected / onEncapsulated / onCloseConnection / ping）なので、bedrock-protocol にそのまま差し込み、260 の操作がそのまま NetherNet の上で動く。bedrock-protocol が付ける RakNet の 0xfe は送るときに外し、受けるときに付け直す |
| 信号 | `GET /v1/join`（2xx とサーバー情報。ping にも使う）→ ICE を集めきってから（trickle なし）`POST /v1/join/{NetworkID}`（application/sdp、1 回だけ）→ 答え |
| サーバーの身元 | 答えの `a=identity` を本物のクライアントの手順で検証: base64 JSON → assertion → JWT の `cpk`（JWK）で JWT 自身の署名を検証 → `a=fingerprint` 行の正準 JSON に対する切り離し JWS を同じ鍵で検証 → `exp`。通れば鍵の指紋を `@A nethernet: server key <pin>` と出し、`a=identity` を外して setRemoteDescription。欠けていたり改ざんされていたりすれば、本物のクライアントと同じく接続しない（`identity=warn` で続ける、`off` で見ない）。平文 HTTP の TOFU の確認画面はラボでは出さず、指紋を出すだけ |
| データチャネル | `ReliableDataChannel`（順序あり・確実）と `UnreliableDataChannel`（順序なし・再送 0）、STUN/TURN なし。先頭 1 バイト = 残りの断片数（0 で完結）。分割は確実な方だけ、大きさは答えの `a=max-message-size` − 1（既定 262143） |
| WebRTC 本体 | node-datachannel（libdatachannel、macOS/Linux/Windows の完成品）。最初の NetherNet の参加で入れる（完成品の取得に導入スクリプトが要るので、これだけスクリプトを許す） |
| クライアント側の身元 | 送らない（オフラインのラボには Xbox の GameServerToken が無い）。資料では「無いときに受けるかはサーバーの方針」。BDS が `online-mode=false` で受けるかは未確認 |

確かめ方: `tests/nethernet-offline.mjs`（18 項目）。信号サーバーは資料どおりに実際の HTTP で立て、ES384 の鍵で本当に署名した身元を返す（正常・改ざん・欠け・期限切れ・別の鍵）。WebRTC 本体だけ偽物（ここでは node-datachannel を入れられない）。`tests/offline.mjs` の docker 節で `LAB_TRANSPORT=nethernet` の設定と公開ポート。**本物の BDS の NetherNet には未接続**。

## 24. v37: 日常の動作を 238 に、目録と全数試験で 100% を保つ

| 何 | どう |
|---|---|
| 足した動作（64） | 戦闘 7（fight crit shoot throw_at flee hunt shield_block）、生き延びる 6（heal eat_best armor_up clutch extinguish sleep_night）、農業と自然 14（harvest_area replant sapling grow pick_flower fill_cauldron cauldron_bottle wash campfire_cook fish_n compost_all herd tie milk_drink）、持ち物とチェスト 9（unload loot sort discard give_to craft_at cook blast refuel take_output のうち give_to は交流）、建築 8（floor wall line sneak_place light_up stair_down stair_up strip_mine）、移動 14（wander look_around turn_around face sprint_to swim_to mark goback row ride_to elytra_fly riptide peek afk）、交流 5（look_player greet nod trade_with report）。どれも新しいパケットを足さず、既存の操作を人と同じ順に送るだけ |
| 直した不具合 | `IN_HAND` の `milk`（牛乳を飲む）は `??=` のため、先にある `milk`（乳搾り）に隠れて呼べなかった → `milk_drink` |
| 目録 | `common/data/everyday.json`: 全動作の分類・試験用の引数・必要な持ち物。コードと目録が 1 つでも食い違うと試験が落ちるので、数は常に本当 |
| 全数試験 | `tests/realplayer-offline.mjs` が目録の 238 個を 1 つずつ、持ち物を「持ち物欄の奥」に置いた状態で実行し、例外なくパケットを送ることを確かめる（道具を人と同じく取りに行く経路も通る）。`LAB_TICK_MS=2` で同じ手順を 25 倍速で回す（約 90 秒）。わざと引数を欠く・持ち物を欠く・目録から消すの 3 通りで落ちることを確認済み |
| AI 向け | `mark`/`goback`（場所を覚えて戻る）、`report`（体力・視線の先・周りを 3 行で）、`eat_best`（空腹のときだけ食べる）は、状況を読んで次を決める AI のための動作 |
| 実機で未確認 | この版の追加分は偽クライアントでの試験まで。BDS が受け付けるかは、使っている操作（useon/use/dig/interact/move/quick/swap/drop/goto/移動キー）が実機で確かめ済みであることに依る。`node lab.mjs selftest all` で実機の確認を回すこと |

## 25. v39: NetherNet の信頼・取得の診断・実機で分かった修正の移植

| 何 | どう |
|---|---|
| 信頼（ガイド §5.2） | 平文 HTTP では鍵が信頼の単位。初回は固定して受け入れ（`first use: pinned`）、以後は照合（`known`）。固定は `.lab/nethernet-pins.json`。`identity=strict` は未固定の鍵を拒否（初回確認で「いいえ」）、`key=<pin>` は特定の鍵以外を拒否、`identity=` の打ち間違いは有効な値を示して拒否 |
| HTTPS 信号 | `signaling=https://host[:port][/path]`（リバースプロキシ）。TLS が信頼の根拠なので固定しない。`ca=` でテスト用 CA。信頼できない証明書は拒否 |
| 受信の分割 | カウントダウン（N-1…0）が途切れたら、途中の断片と途切れを起こした断片を捨て、次から立て直す（壊れたバッチを渡さない）。確実でない方の断片は捨てる |
| 待ち時間 | 信号は相手の ICE 収集の完了を待つ（Wine 上の Windows 版で約 12 秒）: 信号 30 秒、接続 60 秒 |
| IPv6 シム | IPv6 の無いカーネルで `/proc/net/if_inet6` などを空の表として読ませる（本物があれば触らない、読み取り専用のみ）。無いと Wine の GetAdaptersAddresses が全体で失敗し、NetherNet が候補を 1 つも出さない（504）。NetherNet では偽の IPv6 ソケットは作らない（`LAB_SHIM_NOSOCK=1`）。IPv6 の無い実機で open/openat/fopen・Python・cat から確認 |
| 長い出力 | 先頭・途中の E 行すべて・末尾を出す（末尾が結果を語る）。`LAB_MAX=n` |
| Endstone | venv を作ったランタイム（手元／コンテナ）を記録し、切り替えたら作り直す。`LAB_BDS_ZIP` があれば Endstone の前にサーバーフォルダへ展開 |
| Docker | ホストの CA バンドルとループバック以外のプロキシをコンテナへ渡す（TLS 検査プロキシ下の pip） |
| BDS 取得 | `LAB_BDS_ZIP` はファイルでも URL でも可。公式 CDN の次に旧 Azure CDN（`cdn_mirrors` で追加可）。zip でない応答（プロキシのページ等）は中身の冒頭を示して止まる。全部塞がれていれば「コードでは直せない」と判定し、代わりの 3 手段を示す |
| doctor | `node lab.mjs doctor`: 道具（node・npm・IPv6/コンパイラ・python・wine・docker）と取得元（BDS 版一覧・CDN・npm・PyPI・GitHub API/配布物）を並行で調べ、OK / MISSING / BLOCKED / FAIL と代わりの手段、最後にラボごとの準備可否 |
| join の引数 | 最初の `=` で分ける（URL の値が壊れない） |

## 26. v40–v41: 動作を 11,661 に・何でも手に入れる目標プランナー・RTA

| 何 | どう |
|---|---|
| 動作（v40） | `common/verbs-more.cjs` に 711（食べ物ごとの eat_、繁殖・餌・手懐け・騎乗をモブごと、敵ごとの戦い方、移動 44、コマンドとゲームルール、クエリ、持ち物、クラフト・精錬・醸造、作業台類、農業、採掘、建築、置き方、レッドストーン、乗り物、液体、飾り、画面を開く）。手書きは 951 |
| 生成した動作（v41） | `common/verbs-gen.cjs`: BDS が持つアイテム・ブロック・モブの一覧（kb.json）から、1 つずつ `get_` `rta_` `craft_` `smelt_` `mine_` `find_` `place_` `hold_` `drop_` `kill_` `goto_`。10,710。どれも実際の手順（下のプランナーと既存の操作）で動く。末尾に `dry` で「何をするか」だけ言う |
| 知識 `common/data/kb.json` | `node common/kb-build.mjs` が BDS から作る: アイテム（名前 ja/en・スタック数・タグ・満腹度）、ブロック（名前・置くアイテム・タグ・道具ごとのドロップを LootTableManager で実際に試した結果（作物は育ちきった状態、揺れるドロップは何十回も試して割合）、最低限の道具）、モブのドロップ（エンティティ定義→ドロップ表）、精錬（レシピファイル）、クラフト（本物のクライアントが受け取ったレシピ本 `recipes_all`: ベッド・染料・羊毛などはファイルに無い）、釣り、宝箱。古い名前（muttonRaw、dye:4、reeds…）は今の id に直す |
| プランナー `common/goal.cjs` | 経路: クラフト（2x2 か作業台、石切台）、精錬（燃料も選ぶ）、採掘（必要な道具の段階）、モブを倒す、乳搾り・バケツ・毛刈り・卵・釣り・樹皮剥ぎ・コンクリート固め、落ちている物を拾う。費用（秒）を依存の閉包の上で Bellman-Ford で求め（循環 iron_ingot⇄iron_block も自然に解ける）、安い経路から展開し、その経路の前提が満たせなければ次へ。木の種類は問わない（#planks）。同じブロックの採掘や同じクラフトはまとめる（持ち物を再生して確かめる）。地下へ鉱石を探しに行く計画には先に剣と予備の棒。1,305 のうち 915 はオーバーワールドだけで計画できる（残りはネザー・エンド、蜂の巣、酸化など） |
| 実行 `common/goal-exec.cjs` | 1 手ずつ計画し直しながら実行。歩きは既知のブロック上の A*（段差・3 段までの落下・泳ぎ、必要なら掘り進む・足元に積む）。探し物は「見える」ものだけ（空気に面し視線が通る。一度見たものは覚える。石や土など地中にあるのが当たり前のものは除く。`xray` で全部）。見えなければ地上は歩いて探し、鉱石はよく出る高さまで階段掘りで下り、近くの洞窟へ掘って行き、なければ坑道を掘る（溶岩・水の隣は掘らない）。作業台・かまどは近くに無ければ置いて使い、次の手の前に回収。空腹なら食べ（食べ物が無ければ近くの動物を狩る）、敵は剣で、クリーパーは叩いて押し返し（剣が無ければ逃げる）、死んだら近ければ取り返し、遠ければそこから計画し直す |
| 普通の地形 | `LAB_WORLD=normal`（`LAB_SEED`、既定 1）: 生成ワールドのテンプレートをシードごとに作る。ゲームルールはゲームの既定（昼夜・天候・モブのスポーン）。視界 10 チャンク |
| 実機の記録 | `bds/docs/verbs/run.mjs` → `bds/docs/VERBS.md`（手書きの動作を平らなワールドで）、`bds/docs/goals/run.mjs` → `bds/docs/GOALS.md`（RTA を生成ワールドで、持ち物ゼロから） |
| 実機で見つけて直したこと | 本物のクライアントがモブの移動（`move_entity_delta`）を読んでいなかった（止まっている前提の試験では気づかない）→ 読む。落ちているアイテム（`add_item_entity`）を知らなかった → 何が何個かも含めて持つ（照準・クリックの対象からは外す）。拾ったときの持ち物の変化はサーバーから古い形の `inventory_transaction` で来る → 反映（`sync` しないと数が 0 のままだった）。`__labsave` は 1 tick に 4 KB を超える行を続けて出すと 2 行目以降が失われる → 1,800 文字ずつ tick に分けて出し、全部出てから返す（`view` も同じ経路）。`replaceitem` はスタック上限を超える数をそのまま入れる（クロスボウ 16 個の 1 スタック）→ 実機確認では上限まで |
| 試験 | `tests/realplayer-offline.mjs`: 目録（手書き 951 ＋ 家族 11 と数）とコードの一致、手書き全部と家族の見本を偽サーバーで実行、生成 10,710 を全部 dry で（約 1 分）。PASS 44/44 |
| 限界 | ネザー・エンドへは行かない（ポータル作りは `nether_portal` の動作としてあるが、計画には入れていない）。村の探索は地上の探索の一部（干し草・小麦が見えれば使う）。暗い地下では敵に倒されることがあり、そのときは計画し直すので時間がかかる。記録は GOALS.md |

## 27. v42: 計算の最適化（プランナー・A*・世界の読み取り）とダッシュ

| 何 | どう |
|---|---|
| プランナー `common/goal.cjs` | アイテムごとの依存（レシピの材料・道具・燃料）を一度だけ整数の添字のグラフ（逆向きの辺つき）にし、費用は Float64Array、変わった所だけ worklist で伝える（Bellman-Ford の全体反復をやめた）。道具の段階・野生の有無・タグ・掘る時間はメモ化。1,323 アイテム全部の計画: 16.4 s → 3.6 s（1 回 12.4 ms → 2.7 ms、ケーキ 25 → 4.4 ms、エンダーアイ 30 → 6.8 ms）。計画の中身は前と同じ（1,000 件、9,880 手順が一致） |
| ブロックの分類 `common/goal-exec.cjs` | ブロックの状態ごとに一度だけ正規表現で分類してビット（固体・通れる・水・危険・床・溶岩・濡れ・落ちる・不透明・壊せない）をブロック表のオブジェクトに持たせる。歩く・掘る・見える・届くの判定は整数のビット演算だけ |
| A* | 座標は開始点からの差を 24 bit の整数にまとめて Map のキーに（文字列を作らない）。open リストは typed array の二分ヒープ、古くなった項目は飛ばす。近傍は配列を作らずコールバックで渡す。掘る時間と持っている道具は探索 1 回につき 1 回だけ（前は近傍ごとに持ち物を数え直していた）。掘る探索は掘る 1 マスが歩き 4 マス分なので推定を 2.5 倍にする（重み付き A*）。合成した地形の 72 探索で 15.1 s → 0.86 s（17 倍）、歩きの経路は前と同じ、掘る探索は 20,000 ノード以内に着くものが 0/12 → 10/12 |
| 世界の読み取り `common/realplayer.cjs` | サブチャンクを数値キーで持ち、直前のサブチャンクを覚える（隣のブロックはほぼ同じサブチャンク）。パレットはサブチャンクごとにブロックのオブジェクトの配列にして 1 回だけ引く。1 ブロックの読み取りで文字列を 2 つ作って Map を 2 回引いていたのが、整数演算と配列 2 回に |
| ダッシュ | 道が同じ高さでまっすぐ 2 マス以上続く所ではダッシュ（曲がる前に止める）。満腹度が 12 より上、または食べ物を持っていて 7 より上のときだけ（ダッシュは 1 マス 0.1 の消耗） |
| 階段掘りが止まったとき | 目標の深さよりずっと上で水や溶岩に囲まれて進めない（帯水層）ときは、その深さで横に掘るのではなく、階段を上って降り始めた所に戻り、40 ブロック離れた所から掘り直す（RTA iron_ingot がシード 1 で y=46 から動けなかった） |
| 検証 | v47（§32）でオフライン試験と本物の BDS のレースで確かめた |

## 28. v43: かまどを待たない・畑の予備・並べ替え

| 何 | どう |
|---|---|
| かまどは勝手に焼く | 2 個以上焼くとき、次の手順が焼けた物を使わない集める手順（採掘・狩り・乳搾り・汲む・毛刈り・釣り・卵・拾う・宝箱）なら、入れて閉じてそちらへ行く。焼いている物は持ち物に数えて計画し直し、集める手順は先に、焼けた物が要る手順（クラフト・精錬・ポータルなど）の前にかまどへ戻って取り出す（残りがあれば燃料を足して待つ）。焼いている間はかまどを回収しない。`get` の終わりにも取り出す |
| 計画の並べ替え `compress` | 精錬のすぐ後ろへ、後にある集める手順のうち、その時点で道具（掘るならツルハシの段階、毛刈り・釣りならハサミ・竿）と材料がそろうものを前に出す（持ち物を再生して確かめる）。ケーキ: 鉄 9 個を焼く間にサトウキビ・卵・干し草を集め、戻ってバケツ |
| 畑 | 水のそばに耕せる土が無い（水も無い）ときは、立っている所の周り 6 マスの乾いた土に植える（乾いた耕地でも育つ。遅いだけ）。パンの RTA が「水のそばに植える所が無い」で止まっていた |
| 検証 | プランナーは全 1,323 アイテムの計画を流して 1,000 件・9,880 手順のまま（並べ替えは順番だけ）。実機は v47（§32） |

## 29. v44: RTA 企画 138 種と「どの動作でも RTA」

| 何 | どう |
|---|---|
| 企画 `common/challenges.cjs` | 手で選んだ企画（木・石・鉄の道具、鉄・革の防具を着る、鉄/ダイヤのフル装備、ネザー、ケーキを置いて食べる、パンを食べる、オオカミを手なずける、盾を構える、台所、農家、鉱夫、一晩越す支度、夜の敵の落とし物、レッドストーン入門、エンチャント台、エンダーアイ、ポータル、ランダム 1 品）に、生成した企画: 素材ごとの道具 5 種・防具一式（着る）、全種類集め（苗木・原木・染料 16・コンクリート・羊毛・カーペット・色ガラス・ろうそく・彩釉テラコッタ・ボート・ドア・フェンス・ボタン・看板・板材・葉・種・焼いた肉…、#タグも）、1 スタック（64）× 23、深さ（y=62/32/0/-8/-58、階段掘り）、高さ（y=100/150/200/319、足元に積む）、距離（100/250/500/1000 ブロック）、ビンゴ 30 枚（やさしい 70 品から 5 つ、番号ごとに同じ札）。計 138 |
| クエスト（動作を RTA に） | 目録 `everyday.json` の手書きの動作のうち、要る物が全部手に入り、相手の動物が野生にいて、試験用の準備がコマンド（夜・天気・効果）でないもの 519 個: 持ち物ゼロから要る物を集め（数は動作から見積もる: `make_<x>` は x を 1 回作る材料（タグは一番安い物: 石炭 > 木炭、オーク）、建築は形と見本の引数から（壁 = 長さ × 高さ、ピラミッド = 各段の面積の和、小屋 80 …）、ゴーレムは鉄ブロック 4 + カボチャ 1 など決まった数、繁殖は 2、ほかは 1）、動物を探して近づき、要るブロックを横に置き、座標の引数は平らな試験ワールドからの差としてその場に置き換えて実行 |
| 動詞 | `rta <item>[+...]|<challenge>|<verb>|list [word]`、生成の `challenge_<name>`（138）と `quest_<verb>`（519）。`dry` で何をするかだけ（企画は持ち物ゼロからの手順数と目安の時間） |
| 時間と記録 | どの RTA も同じ計時: 開始で持ち物を空に（keep で今のまま）、手順ごとのスプリット、終わると前回の最速との差（手順ごとに ±秒）、生成ワールド（LAB_WORLD=normal）なら最速をシードごとに `.lab/rta-pb.json`（LAB_RTA_PB で場所）。`hud` か LAB_RTA_HUD=1 で今の手順とタイマーをアクションバーに、終わりにタイトル |
| 複数の物を集める | 1 つ集めた物は次の計画で材料に使わない（取っておく）。次に集めるのは今の持ち物から一番安い物（ツルハシが要る物の前にツルハシで済む物…）。後のクラフトが取っていった分は 2 巡目で集め直す |
| 記録の台本 | `node docs/goals/run.mjs 1 challenge_iron_tools quest_breed_cow` のように企画・クエストもそのまま流せる（結果は GOALS.md） |
| 検証 | 企画・クエストの dry と `rta list` を擬似クライアントで確認。実機（`challenge_iron_tools` `challenge_bingo_1` `challenge_depth_y0` `challenge_walk_250` `quest_shear` `quest_eat_cooked_beef` のレース）は v47（§32） |

## 30. v45: 並列 RTA・時計の早回し・負荷の削減

| 何 | どう |
|---|---|
| 早回し `LAB_SPEED=k` | BDS 本体は無改造のまま、libfaketime（マルチスレッド版 libfaketimeMT）を LD_PRELOAD して時計だけ k 倍にする。BDS は 1 秒に 20 tick のつもりで回るので実際は 20k tick/s。クライアントは 50/k ms ごとに入力を送る（LAB_TICK_MS）。平らなワールド 1 人で 2x=40、4x=80、8x=158、16x=322、32x=640 tick/s を実測（`system.currentTick` を実時間で割る）。生成ワールドで 10 人・4x は平均 75〜77 tick/s（目標 80）、BDS が 1 コアを使い切るのが上限 |
| どこで使えるか | Linux はそのまま（`apt install faketime`）、macOS は lab の docker イメージに libfaketime を入れた（イメージが 1 回作り直される）。Windows 版 BDS には無い（libfaketime は Linux の仕組み） |
| 試験の待ちもゲーム内時間 | 行ごとの待ち（300 ms）・`wait ms`・`perf ms` は、サーバーの tick（ms/50 個）で数える: lab は `scriptevent lab:sync <n> <tick 数>` を送り、helper がその tick 数あとに `LAB_SYNC <n>` を出すまで待つ。1x では前と同じ長さ、k 倍速では k 分の 1、サーバーが遅れれば長く（試験の意味が速さで変わらない）。helper が答えないときと Endstone・LeviLamina は実時間（÷k）。早回しでは、スクリプトの watchdog の限度（hang 10 秒・spike 100 ms・slow 10 ms）と `perf` の時間をその速さで割って実時間に戻す（TS REPL のコンパイル 2.5 秒が x4 では 10 秒の hang に見えていた）。CI の本物の BDS は 4 倍速（アドオン 12 個: 手元で合計 310 → 146 秒。10 倍・20 倍では 1 つずつ落ちた: 再起動後のネザー、5 秒の冷却） |
| ゲーム内時間 | RTA の時間・制限時間・畑や卵やシェルターの待ちは、クライアントの tick（1 tick = 50 ms）で数える。早回しでもラグでも、スピードランで見る「ゲーム内の時間」になる。1 つの RTA 全体に 1 つの締め切り（企画の各部分ごとではない） |
| 1.26 の時刻 | BDS 1.26 は時刻を `set_time` ではなく `sync_world_clocks`（ワールド時計の time / paused）で送る → 読むようにした（前は時刻が常に不明で、夜の判断が一度も働いていなかった）。届いた時の tick から進めて今の時刻にする（`clock` も） |
| 夜 | 生成ワールドで夜、空の下で敵が 2 体以上（または体力 12 以下で敵、または死んだ直後）なら、ベッドを持っていれば置いて寝る（朝になれば回収）、無ければ 2 マス掘り下げて上をふさぎ朝まで待つ（空腹なら食べる）。夜に死んだら、または 3 分で 2 回同じ所で死んだら取りに戻らず、そこから計画し直す |
| 並列 `docs/goals/race.mjs` | 1 台の BDS に最大 10 人（`--players n`、`--servers k` で複数の BDS に分ける。既定は 10 人ごとに 1 台、CPU 数まで）。各自 320 ブロック離れた自分の場所へ（spreadplayers、落下の間は低速落下と耐性）、朝にして敵を消し（公平な朝）、全員の RTA を同時に開始（`@P01& <verb>` = 待たずに開始、`waitall` で全員を待つ間 20 秒ごとに tick/s を記録）。結果に各サーバーの tick/s（平均・最小）と、遅れたときの目安（このマシンで保てる速さ / サーバー数）を出す |
| 事前生成 `--pregen` | BDS で一番重いのはチャンクの生成。レース前に一度、各地点にプレイヤーを置いて地面が読み込まれるまで待ち（`wait_world`）、`template save`（save hold → save query の長さで切って複写 → save resume）でそのシードのテンプレートに保存。以後のレースは生成済みのチャンクを読むだけ。地点の配置は `.lab/race-pregen-<seed>.json` に覚えておき、同じなら使い回す |
| 見える範囲 `LAB_VIEW` | レースの既定は 6 チャンク（96 ブロック = プランナーが見る範囲）。生成・送信するチャンクが 10 チャンクの約 1/3 |
| サブチャンクの窓 `LAB_SUBCHUNK_WINDOW` | クライアントはプレイヤーの高さの上下 4 層（±64 ブロック）のサブチャンクだけを頼んで読み（24 層 → 9 層）、登ったり掘り下がったりすると周りの列に新しい層を頼む。0 = 全部（本物のクライアントと同じ） |
| クライアント側の負荷 | 10 人・4x のプロファイル: node は 75% 待機、UDP 送信 4.5%、GC 3%、ブロック検索 1.6%。重いのは BDS（1 コア 100%）なので、増やすときはサーバーを増やす |
| 走りの改善 | 水の中から掘らない（届く所で乾いた足場を先に探す: 水中の採掘は 5 倍遅い）、`walk_<n>` は乾いた地面が一番続く向きを選んでまっすぐ、`wait_world` 動作（周りの地面が読み込まれるまで）、RTA の計時は地面が読み込まれてから始める |
| 早回しとラグに強くした所 | 掘る: サーバーのひび割れ通知を待つ時間を tick だけでなく実時間でも取る（5 tick かつ 300 ms、確認は 20 tick かつ 800 ms）: 4 倍速や高負荷では通知が数 tick 遅れ、即壊しと誤って「壊れない」になっていた。置いた・壊したの確認も `until`（N tick かつ M ms）に。狩り: 届かない獲物（水の中・崖の上）は次から狙わない（空腹で同じ豚を 20 回追っていた） |
| レースの公平さ | 各自の出発点に `spawnpoint`（LAB_RTA_SPAWNPOINT=1: 死んでも混んだワールドスポーンではなく自分の場所へ）、水の中に置かれたら計時の前に一番近い乾いた陸へ、`walk_<n>` は死んでリスポーンした分を歩いた距離に数えない、難易度は既定で easy（スピードランで普通の設定。`--difficulty normal|hard`）、`--day` で夜なし（日の巡りを止める） |
| 実測（このマシン: 2 コア、BDS 1.26.51、シード 1、事前生成済み） | 1 台 10 人 4 倍速: tick/s 平均 75〜79（目標 80）、BDS が 1 コア 100%、node は 20〜36%。2 台 20 人 3 倍速: 2 台で 2 コアを使い切り tick/s 平均 49〜52（目標 60）、クライアントの待ちが間に合わず失敗が増える → このマシンでは「1 台 10 人・3〜4 倍速」が上限。成功例: iron_pickaxe 5:31、bucket 7:37、shield 7:17、stone_pickaxe 1:10、y=0 まで 7:34（いずれもゲーム内時間、4 倍速なので実時間はその 1/4 前後）。夜の死亡（最多 25 回）と木の無い場所が主な失敗 |
| 走らせながら速さを変える `speed <x>` | lab のコマンド。同じワールドを新しい時計で立て直し、プレイヤーは元の場所へ入り直す（Java の `/tick rate` に当たる）。動いている BDS の時計の速さをその場で変えると（libfaketime の FAKETIME_XRESET）単調時計が戻ることがあり BDS が乱れるので、立て直しにした |
| 台数・人数の自動 `--max` | サーバーは CPU の 3/4（残りはクライアントと OS）、1 台の人数は前回までに測った「保てた人数×速さ」（`.lab/race-capacity.json`、未測定は 40 = 4 倍速で 10 人）÷ 速さ。レースの後、各サーバーの tick/s から保てた量を測り直して書く（遅れたら下げ、保てたら維持）。結果は GOALS.md にも |
| 取り違えの修正 | クラフト: 直前のクラフトでできた束の番号がまだ古いまま使われ、サーバーに「格子への移動」ごと断られていた（status 50、速いほど起きる）→ 始める前にサーバーの持ち物を読み（`sync`）、断られたら読み直して 1 回だけやり直す。持ち替え（grab）も「持っていない」ならサーバーの持ち物を読んでもう一度。反射（食べる・積む・隠れる）の失敗は手順の失敗にしない |
| 戦い | 当てるのは 10 tick に 1 回（当たった直後の 10 tick は無敵なので、6 tick ごとの空振りをやめた）、跳んで落ちる所で当てる会心（1.5 倍。水の中・頭上がふさがっている時・クリーパーは除く）。剣か斧を持っていればゾンビ・クモは 5 ブロックで迎え撃ち、体力が 10 より上ならスケルトンへは 10 ブロックから詰める（素手なら目の前のものだけ）。エンダーマンは向こうから来た時だけ |
| 夜と食べ物 | 夜に地上にいて、計画に地下の採掘（鉱石・掘って行く物、道具あり）があれば先にそれ（夜は鉱山で過ごす）。食べ物が無く満腹度 14 以下なら近く（16、8 以下なら 32 ブロック）の動物を狩る、届かなかった動物は次から狙わない |
| 木 | 原木は葉に隠れて遠くから見えないが、葉は見える: 原木が見えない時は見えている一番近い葉の所へ行ってから探す（何もない所で渦巻きに歩き回っていた） |
| 時計のずれ | クライアントの tick は固定刻みのループ（遅れた分は最大 5 tick まで追いつき、長く止まったら今から数え直す）。3 倍速の 16.67 ms のような端数も平均で合う（前は整数 ms に丸めて 17 ms = 2.94 倍） |
| サブチャンクの窓の既定 | 生成ワールド（LAB_WORLD=normal）だけ上下 4 層、平らなワールドは全部（数層しかない） |
| BDS の選択 | `/tick` は Java 版だけ。Bedrock の改造サーバーでの早回しは LiteLoaderBDS + trapdoor-ll の `/tick acc`（1.20.30 の Windows 版まで）。PocketMine-MP・Nukkit 系・Dragonfly は BDS ではない作り直しで、地形生成・モブの AI・レッドストーンがバニラと違い、RTA の再現には向かない。Endstone・LeviLamina は BDS 本体の上に載るもので、BDS より軽くはならない。よって本物の BDS（1.26.51）を時計の早回し・事前生成・見える範囲の縮小・サーバーの並列で使う |

## 31. v46: レースの形・暗がりと溶岩・最速表

| 何 | どう |
|---|---|
| 1 台の人数 | BDS の既定の `max-players` は 10: 11 人目から入れなかった → lab は 100（`LAB_MAX_PLAYERS`）。`--max` の 1 台の上限は 40 人（その分のクライアントが 1 つの node に乗るため） |
| レースの形 | `--same-start`: スピードランの公平なレース（同じシード・同じスポーン、1 人 1 台、散らさない）。`--seeds 1,2,3`: サーバーごとに違うシード（事前生成もシードごと、1 つずつ）。`--hud`: 各自の画面にタイマーと今の手順。走っている間 30 秒ごとに「終わった / やめた / 走っている人数、死亡数、最後の tick/s」を 1 行 |
| 最速表 | GOALS.md に「目標ごとの最速」（最速・シード・1 人かレースか・日付・成功 / 試行）。レースの後にも書き直す |
| 暗がり | 坑道と階段では 8 ブロックごとに後ろの床へ松明（持っていなければ石炭か木炭と棒で作る。石炭が無ければ手の届く石炭鉱石を掘る）。空の下では置かない。敵が湧くのは暗い所、帰り道もそこ |
| 溶岩 | 溶岩と接している鉱石・ブロックは掘らない（掘ると流れ込む。レースの死因に溶岩 3） |
| ダッシュジャンプ | 同じ高さでまっすぐ 4 マス以上続き、頭上が空いていて水が無く、満腹度が 16 より上なら、着地ごとに跳ぶ（ダッシュより 2〜3 割速い。消耗は倍）。曲がる 2 マス手前でやめる |
| 逃げる | 体力 6 以下で近くに敵、足場にするブロックも無い時は、敵の反対へ走って食べる（クリーパーは別の反射で離れる） |
| 検証 | `--same-start`（2 人・2 台・2 倍速）、`--seeds 1,2`（シード 2 の事前生成込み）、`--hud`、`--max`（2 コアで 1 台 9 人）は本物の BDS で動かした。1 台 11 人以上とレースの中身は v47（§32） |

## 32. v47: 本物の BDS でレースを回して直した所

同じ条件（BDS 1.26.51.1、シード 1、事前生成済み、3 倍速、1 台に 10 人、各 25 ゲーム分、難易度 easy）で 12 回走らせ、ログから死因と止まった所を読んで直した（間に `--spot` で 1 人ずつの再現も）。2 コアのこのマシンで tick/s は平均 56〜58（目標 60）。

| 回 | その回までに入れたこと | 完走 | 死亡 |
|---|---|---|---|
| r14 | 前の版 | 4/10 | 25 |
| r15 | 同じ所で死に続けたら離れる、切り倒した木の葉へ通わない、階段が止まった理由を出す | 5/10 | 17 |
| r16 | 夜の階段はふさいで下り続ける、敵が近ければ狩らない、珍しい物の探索は一辺 64、既定の 10 種の入れ替え | 6/10 | 23 |
| r17 | ＋夕方に武器が無ければ先に隠れる | 1/10 | 26 |
| r18 | 夕方の規則は外した（一晩 9 分を失うだけだった）、ツルハシの作り直し、夜の地下で待つ | 3/10 | 52 |
| r19 | 夜に死んだら朝まで復活しない | 5/10 | 21 |
| r20 | 昼に同じ所で 2 回死んだら離れる、敵のいる洞窟へは下りない | 5/10 | 16 |
| r21 | 地上へは自分の階段を戻る、地下から木や動物を探しに歩かない | 4/10 | 8 |
| r22 | 階段を掘って上がる（`stairUp`） | 3/10 | 16 |
| r23 | 地下では地上の物（木・動物）に登る手間を数える、クエストの食べ物は途中で食べない | 5/10 | 12 |
| r24 | 死んだら歩いている道をやめる、作業台を松明の上に置こうとしない、砂利を掘り抜いて上がる | 5/10 | 15 |
| r25 | 丘の上の木も切る（幹の根元から届くか）、木の見えない所では探索の一辺 64 | 5/10 | 17 |

完走は地点の運に大きく左右される（木の少ない山、暗い森、羊のいない地点）が、最後の 5 回は 5/10 で揃った。死亡は 25 → 12〜17 に（夜に死に続けた回の 52 は無くなった）。最速（シード 1、3 倍速、10 人のレース中）: 作業台 0:06、石のツルハシ 1:14、ステーキを食べる 4:54、盾 5:28、鉄のツルハシ 6:00、バケツ 7:21、250 ブロック歩く 4:53、y=0 まで 10:56、鉄の道具一式 14:14、ビンゴ 1 18:30。

1 台に 12 人（`--players 12 --servers 1 --speed 2`）: 12 人とも入り（`max-players` 100）、tick/s 平均 40（目標 40）、10 人が 3 分以内に作業台。

| 何 | どう |
|---|---|
| 夜に死んだら | 死んだ画面のまま朝（日が昇って 20 秒）まで待ってから復活する。夜のうちに戻ると、出発点の周りに集まった十数体の中へ手ぶらで戻り、死に続けた（r18: 1 人 17 回、1 回のレースで 52 回） |
| 昼に同じ所で 2 回死んだら | 敵の少ない向き・乾いた柔らかい地面の多い向きへ 56 ブロック以上離れ、以後そこを復活点に（`LAB_RTA_SPAWNPOINT=1`）。暗い森（日陰で昼もモンスターが生きている）の地点で効く |
| 階段を下りる途中の夜 | 地上で隠れず（下りる間は `underway`）、3 段下りたら出てきた段と頭の上を 2 ブロックでふさいで下り続ける。夕方（12200〜）でも計画に地下の採掘があれば先にそれ |
| 夜の地下で、次が地上の手順 | 木・動物・砂など地上の物が次なら、地下で閉じこもって朝を待つ（暗い地上へ出て死んでいた）。昼なら先に地上へ出る |
| 地上へ出る `dig_out` | 下りてきた自分の階段を戻る。無ければ（または戻れなければ）階段を掘って上がる: 前の 1 段上と頭の上を掘り、足場が無ければブロックを置き、水・溶岩・上の砂や砂利は避け、ふさがれたら数ブロック横へずれてからまた上がる。葉の下も空とみなす。実機: y=36→68（途中に帯水層）、y=9→67（ツルハシを 2 回作り直して） |
| ツルハシの作り直し | 階段と坑道で石のツルハシが尽きる。掘ってきた丸石と棒（無ければ持っている板か原木から）と持っている作業台（無ければ板 4 枚から）で、その場で新しく作る。実機で確認。死んで無くした時は、採掘の手順が「石以上のツルハシが無い」で計画し直す（前は素手で鉱石へ戻って死んでいた） |
| 洞窟 | 階段の先が落差（洞窟）なら、周り 16 ブロックに敵がいなければ経路探索で洞窟の中へ下りる。止まった時は理由を出す（`stair down stopped at y=40: a drop x65`） |
| 計画: 地下での地上の物 | 地上より 14 以上深い所では、木・砂・花・動物に「登る手間」（1 段 2.5 秒）を足す。石炭鉱石は y=0〜96 のどこでも同じくらい見つかるとした。y=-6 で生の鉄を焼く燃料が「木を切りに地上へ」から「近くの石炭」になった。下にいる時は予備の棒のために木へ戻らない。全 1,323 アイテムの計画は 1,000 件・9,880 手順のまま |
| 木 | 一度向かった葉の所（8 ブロック四方）には二度行かない（切り倒した木の残りの葉へ何度も通っていた） |
| 探索 | 見つかるまで 400 秒以上と見込む物（村の干し草など）は、渦巻きの一辺を 64 に（見える範囲ごとに新しい土地） |
| 夜明け | 閉じこもりから出るのは日が昇って 20 秒後。外にゾンビ・スケルトンがいればもう 30 秒まで待つ |
| 狩り | 12 ブロック以内に敵がいれば、飢えていない限り狩りに行かない |
| 隠れ場所 | 床や持ち上げた壁に置けなかった隙間は、隣のどの面にでも置いてふさぐ（地下で 222 個持っていて 2 つの隙間を閉じられなかった）。作れなかった時は 20 秒は作り直さない |
| クラフトの詰まり | 作る段階で断られた時は、格子に置いた物を元の枠へ戻してから閉じる（格子に残ったままで、以後のクラフトが全部断られていた: 1 人 93 回）。松明作りが断られたら 60 秒は作らない |
| 足場 | 経路を歩く間の足場ブロックの記憶を、反射（逃げる・柱に登る）では使わずその時の持ち物を読む（使い切った土で柱を立てようとしていた） |
| クエスト | 動物を探す前に地下なら地上へ。途中で死んで道具を無くしたら集め直し、間に合わなければ「out of time」「lost shears on the way」と言って止まる（ハサミを無くしたまま「刈る」に進んでいた）。クエストに要る食べ物は、飢えていなければ途中で食べない |
| レース | `--spot 5` で前のレースの P05 の場所から走り直せる（`--spot 3,5,9` で複数）。既定の 10 種から村頼みの 2 つ（パン・牛の繁殖: 小麦は村の干し草か、25 分では育たない畑）を外し、ステーキを食べる・ハサミで刈るに。handoff の zip にレースのログ（`docs/goals/.logs`）は入れない |
| 死んだら道をやめる | 歩いている途中で死ぬと、その道（`travel`）はそこでやめて呼んだ側が決め直す（前は復活点から死んだ洞窟の鉱石まで 4 分半歩いて戻り、また死んだ） |
| 丘の上の木 | 原木は「今の足より 5 上まで」ではなく「幹の根元の地面から 4 以内」なら切りに行く（山の地点で、見えている木を全部除いて 20 分探し回っていた） |
| 作業台・かまどを置く所 | 空気か草・雪など置けば消える物の所だけ（松明の上に 6 回置こうとして RTA が止まった） |
| 地下かどうか | 「上に岩が 4 以上、かつ出発点より 16 以上下」（丘を掘った石切り場から 1 分半かけて地上へ出ようとしていた） |
| 時刻つきのログ | RTA の間の `get:` の行に経過時間（`get: [12:31] ...`）。`race.mjs` と `run.mjs` の読み取りも合わせた |
| 動作の数 | `dig_out` を足して手書き 955、生成 11,402（`quest_dig_out` を含む）、合わせて 12,357 |
| 残り | 暗い森など昼もモンスターの多い地点、村の見えない地点のパン・繁殖、洞窟での死亡（道具を失い、鉄が 25 分に間に合わない）。夜は閉じこもりで 5〜9 分を使う |
| 検証 | `node tests/realplayer-offline.mjs` 44/44 PASS。全 1,323 アイテムの計画は 1,000 件・9,880 手順のまま。本物の BDS で上の 12 回のレース、`--spot` の単独走（P02 鉄のツルハシ、P09 y=0 まで 10:58）、1 台 12 人、`dig_out`（y=36・9 から）、クラフトの再現（石炭・木炭・棒） |

## 33. v48: 手書きの動作をすべて本物の BDS で確かめる・重力の予測・レースの詰め

「全部が本当に動くか」を、本物の BDS 1.26.51.1 と本物のクライアントで 1 回の通し（`docs/verbs/run.mjs` を分類ごと＋生成した動作の見本）で確かめ、落ちた所を直した。直したことの多くは、確かめ方を厳しくして初めて見えた本当の不具合だった。

### 確かめ方の穴（前の「941/955」は甘かった）

| 何 | どう |
|---|---|
| 想定外の E 行 | 試験は E 行を最後に `E ... (during: <命令>)` とまとめて出すのに、`run.mjs` は「`## 動作名` の見出しの下の E 行」を探していて、1 つも動作に結び付いていなかった（`read` は `written_book` を置けずに構文エラーでも ✔）。今は試験の記録（命令ごとの区切り）からどの動作の命令が出した E 行かを引き、その動作を ✘ にする。動作の前のリセットで出た E 行は前の動作のもの |
| 確かめる行の無い動作 70 個 | 「失敗の言い回しが出なければ ✔」だけだった 70 個（向きを変える・ボートを漕ぐ・コマンドなど）に、サーバー側で確かめる `real.check` を付けた。向き・位置・乗り物は `real.stage` の標本（`system.runInterval` で毎 tick サーバーが見た A の向き・位置・乗っている物・滑空を記録し、動作の後で読む）で、コマンドは出力と `js` の値（経験値・スコア・時刻・タグ）で。これで手書きの 955 個すべてが「起きたこと」で判定される |
| `real.stage` | 試験だけの行（標本の開始、牛を少し離す、本に書いておく）。`real.setup`（動作に要る前提）と分けたので、動作を RTA にするクエスト（`quest_<動作>`）は stage を無視する |
| 子ども | 召喚は時々子どもになる（子馬は乗れず鞍も付かない、子ゾンビは小さく速い）。召喚の後に `minecraft:ageable_grow_up` で大人に、その出来事が無い種類は召喚し直す（オタマジャクシは子どもが本来の姿なので除く）。`spawn_adult` で召喚すると、その出来事を持たない種類は繁殖も手懐けもできない体になった |
| リセット | 前の動作の物を `kill` でなく Script API の `remove` で消す（溜めているウィザーは倒せず 2 つ後の動作で爆発、死にかけのスノーゴーレムが次のアイアンゴーレムの腕の下に雪を残した）。待った後にもう一度空気で埋める |
| ブロックの用意 | `/setblock` は同じブロックがあると E 行（「置けなかった」）を出すので Script API で置き、置いた後 150 ms 待つ（クライアントに届く前に動作が周りを見て「何も無い」としていた） |
| js の行 | `/scriptevent` の引数は `>=` `<=` を受け付けない（構文エラー）。確かめる式は `<` `>` だけで書く |

### 確かめて見つかった本物の不具合

| 何 | どう |
|---|---|
| 落下（重力） | クライアントは落ちるのを予測していなかった。サーバーの位置の訂正は 6 tick おきなので、落下が数ブロックずつ飛んで見え、`clutch`（着地の直前に水）は着地の後に水を置いて体力 8。本物のクライアントと同じく、毎 tick 速さ分動いてから速さ =（速さ − 0.08）× 0.98、幅 0.6 の足元の一番高い当たり判定で止まり、天井で止まる。水・溶岩・はしご・つる・足場・クモの巣・粉雪・ハチミツ・スライム、浮遊・低速落下・滑空・飛行・騎乗・スペクテイター・読み込まれていない所はサーバー任せ。足がブロックに埋まっている時は落とさない（ボートの座席の高さで草の中へ沈み続けた） |
| 這う | 1 ブロックの隙間の中はしゃがみと同じ速さ（0.065/tick）で、しかもクライアントが予測しないと動けない（サーバーはその程度の差を「止まっている」とみなす）。頭上の空きが要らない予測にし、`crawl_through` は経路探索（頭上 2 ブロックを求める）でなく隙間へまっすぐ歩く |
| 乗り物の持ち物 | ウマなどに乗ってインベントリキーを押すと、サーバーは ContainerOpen でなく UpdateEquip を送る。それを開いた画面として扱い、開く合図に乗っている相手を名指しする（`mountinv` は「開かなかった」） |
| ボート | 乗っている人の位置をボートの位置に合わせる（`sail_to` は自分の位置が動かないと思って曲がらなかった）。後ろ漕ぎにも両方の櫂の合図 |
| 横に付く物 | はしご・絵画・カカオ豆は上の面をクリックしていて何も付かなかった。人と同じく、自分の側の横の面をクリックする |
| バイオームの場所 | `/locate biome plains` は構文エラー。`minecraft:` を付ける（テンプレートの `$1:ns`） |
| 戦う | 1 振りを当たったものとして数えていた。照準が相手に乗ってから振り、当たった振りだけ数える（小さいクモ・テレポートするエンダーマンで 2 振りとも空振りのことがあった） |
| チェスト付きボート | しゃがみがサーバーに届く前にクリックして乗ってしまった。しゃがんで 3 tick 待ってから |
| 読む | 記入済みの本が無ければ本と羽根ペンを開く |
| 救助（水から陸へ） | 水面へ出た高さから、同じ高さ・1〜2 上・1〜3 下の乾いた足場を探す（池の縁が 2 上で見つからなかった） |
| ボートの向き | 送る向き（`vehicle_rotation`）は vec2f `{ x, z }` なのに `{ y }` で送っていて、向きが無いに等しかった（漕いでも動かない回があった）。横の入力は歩きの横移動と逆に回る（実測: そのままでは「左」で右へ回った）ので反転。漕ぐ時の動き（向きの回転・前への押し・水の減速）もクライアントで予測する |
| `sail_to` | 止まってから片方の櫂でその場で回り、数回まっすぐ漕いで進む向きを読む。どちらの櫂でどちらへ回るかは最初の回転で学ぶ（実測で状態により逆になった）。着いたら漕ぐのをすぐやめる（手前を行き過ぎて円を描いていた） |
| 飛行の取り残し | サバイバルに戻った（ゲームモード、または飛べない能力が来た）ら飛行の予測をやめる（創造モードの飛行の後、滑空が始まらなかった） |
| 一歩下りる | `goto` の終わりは落ち切るまで待つ（穴へ一歩下りた直後の高さを読むと途中だった）。`dig_to_y` は 1 段ごとにサーバーの位置を待つ |
| ポータル | 入り口まで来たら、中に入るまで何度でも踏み込む（位置が数 tick 遅れて見えるので「中にいる」と思って止まり、外にいた） |
| 乗り物の試験 | 馬・ラクダ・ハッピーガストはのろさで止めておき、鞍を付けて乗ってから効果を消す（放しておいたラクダが歩いて行き、鞍が届かなかった）。リセットで乗り物から降りる |
| 計画の循環 | 作っている物は、下の段で持ち物から取らない。鉄インゴット 2 個でバケツ（3 個）を計画すると「1 個を塊 9 個に、塊 9 個を 1 個に」（増えない）になり、レースで鉄を失っていた。全 1,323 アイテムの計画は 1,000 件・9,880 手順のまま |

### レース（シード 1、3 倍速、1 台 10 人、各 40 ゲーム分、難易度 easy）

| 回 | 入れたこと | 完走 | 死亡 |
|---|---|---|---|
| r26・r27 | 前の版（地点選び・40 分） | 5/10・5/10 | 51・67 |
| r28 | 出発点は日陰（木の葉の下）と暗い森を避ける。重力の予測 | 2/10 | 25 |
| r29 | 出発点は 64 以内に木 20 本以上。穴で傷を治す（弓の敵がいる・登る物が無い）。3 分で 3 回死んだら 1 分死んだまま（群れが散る）。取り返しは死んだ所に 3 体以上いれば諦める | 4/10 | 23 |
| r30 | 計画の循環（鉄インゴット 2 個持ちでバケツ → 「1 個を塊 9 個に、塊 9 個を 1 個に」で増えない、を実行して鉄を失った）を直す。ツルハシ無しで岩を素手で掘る時は 30 秒まで待つ。見つからなかった物は覚えている物も使わない（自分で置いた松明を取りに地上へ上がって止まった） | 4/10 | 33 |
| r31 | 作業台を置く所はチェストなどクリックで開く物の上にしない、開かない作業台は避けて次を使う（r30 の P09 は袋に作業台を持ったまま「使える作業台が無い」で止まった）。食べる物が無い時の穴は敵が去るまで（30 秒）、続けては入らない。地下で傷を負ったら自分の階段を数段戻って下をふさぐ。死んだら隠れる作業を止める | 6/10 | 18 |
| r32 | 体力は満腹 18 以上でしか戻らない: 食べ物が 3 つ以上あるか満腹の時だけ「治るまで」待ち、無ければ敵が去るまで。続けて入らない（r31 の P06 は治らない 90 秒を 12 回繰り返して 25 分を失った） | 5/10 | 26 |
| r33 | 最終版（ボート・飛行・`goto`・ポータル・置き直し・餌やりの直しを含む） | 6/10 | 34 |

完走の数は地点と天気と夜の運に大きく左右される（同じ版でも回ごとに ±1〜2）。死因の多くは洞窟の暗がりのスケルトンとゾンビ、雨の日（燃えない）と日陰の敵、魔女。死亡は r27 の 67 から 18〜34 に、最後の 3 回は 6/10・5/10・6/10（最速の更新: ステーキを食べる 3:18、y=0 まで 7:56）。いつも完走するのは石のツルハシ・y=0・250 ブロック歩く、たいてい完走するのは鉄のツルハシ・バケツ。鉄の道具一式（鉄 11 個: r33 は最後のクワで時間切れ）・ビンゴ・盾・ハサミは 40 分に届かないことが多い（鉄を探す洞窟と夜の待ち、羊の見つからない地点）。

| 何 | どう |
|---|---|
| 検証 | 本物の BDS 1.26.51.1 と本物のクライアントで、手書きの動作 955/955（最後の通しで落ちた `wall`・`breed_ocelot` を直して分類ごと通し直し: 建てる 49/49・動物 111/111。`bds/docs/VERBS.md`）、生成した動作の見本 17/17。`node tests/realplayer-offline.mjs` 44/44、`tests/offline.mjs` 66/66、`tests/env-offline.mjs` 36/36、`tests/nethernet-offline.mjs` 31/31。全 1,323 アイテムの計画は 1,000 件・9,880 手順のまま。レース r28〜r33（上の表） |
| 動作の数 | 手書き 955（すべて `real.check` つき）、生成 11,399（手書きの動作のクエストは 517: 確かめるのに前提（本を置いた書見台、懐いたオウムなど）が要るようになった動作は、クエストから外れる）、合わせて 12,354 |
| 残り | レースの完走は 10 種中 4〜6（地点・天気・洞窟の運）。ll ラボはこのマシンでは試せない（wine が無い、GitHub API が塞がれている） |

## 34. v49: x50 の早回し・歩きの予測・遅れても正しい掘る置く・サバイバルの訓練

### 早回し（x10〜x50）

| 何 | どう |
|---|---|
| x50 で入れなかった | 時計を 50 倍にすると BDS の通信層（RakNet、`gettimeofday` で相手を計る）の 10 秒のタイムアウトが実時間 0.2 秒になり、ログインの重い瞬間（2 コアが埋まって別プロセスまで 0.3〜1 秒止まる）で切られていた。`common/speed-shim.c`（libfaketime の前に LD_PRELOAD、lab が cc で作る）で `gettimeofday` だけ実時間に戻し、RakNet がその時刻で眠る `pthread_cond_timedwait` も実時間で待つ（締め切りが「今の実時刻の近く、早回しの時刻よりずっと前」なら実時間のもの）。ゲームの時計（clock_gettime・nanosleep・ほかの待ち）は 50 倍のまま。`LAB_SPEED_SHIM=off` で外す |
| クライアントの RakNet | ソケット・ACK・再送・分割・順序は worker スレッド（`common/raknet.cjs`、`LAB_RAK_WORKER=0` で従来どおり同じスレッド）。本体がログインの大きなパケットを解読している間も ACK が出る。受けたらすぐ ACK（setImmediate）、0.5 秒返事の無い送信は再送、30 秒何も来ない（黙って切られた）なら切断として扱う（前は 60 秒「spawn しない」を待っていた） |
| tick の待ちの不具合 | プレイヤーが抜けた後、`ticks(n)` がその場で解決する約束になり、まだ回っている目標のループがイベントループを塞いで lab のプロセスが CPU 100% で止まっていた。待ちは常にイベントループを通す（0 tick は次の周、抜けた後は n×50/k ms） |
| レースの壁時計の上限 | 指定の速さではなく、そのサーバーが保てた速さ（`.lab/race-capacity.json`）から決める（x50 指定で実際 x9 のサーバーが 40 分の RTA の途中で打ち切られていた） |
| 実測（2 コア、シード 1、事前生成済みの地点） | 誰もいない世界 x50 指定で 974 tick/s（x48.7）。平らなワールドで 1 人 735〜759（x37〜38）。生成ワールドで 1 人（立っているだけ）398（x19.9）、3 人 191（x9.5、晴れ・昼）、雨なら 132。10 人のレース（x10 指定）で平均 45 tick/s（x2.3）。BDS のゲームの計算は 1 スレッドで、それが上限（x50 を指定しても落ちず、出せる最高速で走る）。1 人あたり約 1.4 ms/tick（周り 81 チャンクの tick、モブ、移動の検証）。見える範囲 6→4 で +16%、平和（モブ無し）で +25% |

### 早回しで返事が遠くなる（ネットは実時間のまま: 20 倍で往復 6〜13 tick、時に 40〜70）

| 何 | どう |
|---|---|
| 掘れない（x20 の鉄の RTA で 1 回に 59〜97 回「壊れなかった」） | サーバーの割れの合図（`level_event` block_start_break / block_break_speed、65535÷tick 数）を待たずに 8 tick で「壊れた」と言い（predict_break）、サーバーに断られていた。合図が来るまでは言わない。速さは合図のたびに更新し（空中・水中で変わる）、毎 tick 足していく（サーバーと同じ数え方）。合図が無い時は `4×遅れ`（最初の 1 回は 80 tick）待ち、もう一度叩き直し（人がもう一度クリックするように。作業台を閉じた直後の 1 打が無視された）、それでも無ければ諦める。サーバーは自分の数え終わりで勝手に壊すので、x1 でも同じ動き |
| 壊れたと思って先へ（本物のクライアントと同じ） | 遅れが 6 tick 以上なら、自分の数え終わりで「壊れた」と言ってすぐ次へ（地図は空気に、サーバーの返事は後から: 空気なら確定、元のブロックなら断られた＝戻す、返事が無いまま `4×遅れ` なら戻す）。1 度に 1 つだけ（前のが未確定の間は次は返事を待つ）、地面に立ったまま速さが一度も変わらなかった時だけ（落ちている途中から掘り始めた足元のブロックは断られ、その下を掘った「つもり」で地図に穴が残った）。拾う（`collect`）は未確定が無くなってから。`LAB_DIG_CONFIRM=1` で常に返事待ち |
| 同じ場所を壊し続けた | 先に言った後、そこから手を離す（abort_break）のを送っていなかった。サーバーはその場所を割り続け、上の砂利が 1 つ落ちてくるたびに壊していた |
| 落ちてくる砂利・砂 | サーバーは落ちるブロックの元の場所も、プレイヤーの中に着地した所も知らせない（クライアントが自分で動かす物だから）。落ちるブロックの実体が現れたら元の場所を空気に、消えたら着地点（下が固い最初の所）を予測してブロックに（その人の体の中なら）。頭や足が砂利・砂に埋まったら、頭から掘り出す（`digOut`、反射で最初に）。前は頭の上の「消えたはずの砂利」を 7 分掘り続け、埋まって窒息した |
| 待ち時間を遅れで | 遅れ（`K.lag()`: 掘る合図と持ち物の要求の往復の移動平均）を測り、サーバーの返事を待つ所（`until`）は最低 `3×遅れ+6` tick、画面が開くのを待つ所は `4×遅れ+10`。待ちきれずに後から開いた画面はすぐ閉じる（クライアントは画面なし、サーバーは画面ありのずれで、動かす・叩くが全部無視された）。置いた作業台が見えない時はもう 40 tick 待ち、手から消えていたら落ちた物を拾い直す |
| 置く場所 | 自分の体（とサーバーから見た体、0.1 ずれることがある）から 0.15 離れたマスにだけ置く（体に重なって置かれてすぐ取り消され、作業台がそのまま消えた）。置く前に滑りが止まるのを待つ |
| 同じ所で止まる | 1 つの手順が 2 分半、4 ブロック動かず 2 段上下せず新しい物も手に入らなければ、その手順をあきらめる（見張り。水の中で自分の立っているマスにブロックを置こうとして 5 分）。自分のいるマスには置かない |
| 死んだ手順 | 手順の途中で死んだら失敗として数えず計画し直す（「石のツルハシが無い」で 2 回失敗 → RTA 終了、が 1 回死んだだけで起きていた）。道具が手に無い（壊れた・失った）時は次に良い物か素手で掘る（例外で RTA が止まっていた）。開かなかった作業台は 1 分だけ避け、計画もそれを数えない（計画は「作業台あり」、手順は「使える作業台が無い」で 2 回失敗、終了） |
| 戦い | 1 振りごとに持ち物をサーバーに確かめていて（往復 10 tick 以上）、20 倍では振りが半分になっていた。武器は手に取る時に 1 回だけ確かめ、振りは 11 tick ごと（叩かれた相手は 10 tick 無敵）。手に持っている物を持ち替える時はサーバーに聞かない |

### 歩きの予測

| 何 | どう |
|---|---|
| 見つけたこと | サーバーは歩いているプレイヤーの位置を 6 tick ごとにしか直さない。クライアントは歩きを予測していなかったので、最大 6 tick 古い位置で経路をたどり、曲がるたびに行き過ぎて引き返す蛇行になっていた（ゾンビから逃げる 20 ブロックが 1.8 ブロック/秒、ダッシュの 1/3） |
| 予測 | 本物のクライアントと同じ: 毎 tick、キーの押し（0.98 倍）× 速さ（歩き 0.1、ダッシュ ×1.3、速さ・鈍さの効果）× 地面のすべりで加速、壁で止まり 0.5625 までの段差は上り、地面 0.546（氷 0.89）・空中 0.91 で減速。ジャンプは上に 0.42、ダッシュ中は前に 0.2。水・溶岩・はしご・つる・クモの巣・粉雪・ソウルサンドなどはサーバー任せ。`LAB_WALKSIM=0` で無し |
| 直しの重ね方 | サーバーの訂正は「その tick に自分が予測していた位置」と比べ、差を今の位置（とその後の予測の記録）に足す。その後の歩きは捨てない。差が大きい時（押された時）だけ速さもサーバーのものに |
| 誤差 | ダッシュ・歩き・止まりで訂正ごとの差 0.000〜0.004 ブロック |
| 経路の追い方 | 押されて（殴られたノックバック）セルを通り過ぎたら、戻らずに一番近い先のセルから続ける |

### 敵への対応（`common/goal-exec.cjs` の threatPlan / evade / burrow / sealToward）

| 何 | どう |
|---|---|
| 考え方 | 走者はゾンビと素手で殴り合わない。剣が無ければ距離を取り（ゾンビは 2.3 ブロック/秒、ダッシュは 5.6）、別の所で作業し、剣を作ってから戦う。剣があり体力があれば 1〜2 体は迎え撃つ。追いつかれる相手（子どものゾンビ）は持っている物で戦う |
| 判断 | 18 ブロック以内の敵を見て、近接（ゾンビ・クモ…）は「7 ブロック以内、または次の作業（素手の原木 3 秒など）の間に着く」ものを数える。剣あり・体力 10 以上・2 体まで（15 以上なら 3 体）→ 迎え撃つ。剣があり 1 体だけが 3 ブロック以内なら、傷ついていても戦う（背を向けるとクモは跳ぶ）。地下の 1 マス幅の坑道・階段では体力 8 以上なら戦う（1 体ずつしか来ない）。弓は、道具があり体力 12 以上で 1 体なら詰める、叩いている最中の 1 体が 4 ブロック以内なら片付ける（背を向けて岩へ掘る間に 2 体に撃たれて死んだ） |
| 戦い方 | 噛みつく相手が近くに来たら、下がりながら撃つスケルトンを追うのをやめてそちらへ（クモとゾンビに背中から 9 秒で 20→4）。届かない所へ逃げる相手は 4 秒以上追わない。最初の 1 打は跳ばずにすぐ当て（押し返しで噛みつきを遅らせる）、以後はクリティカル |
| 距離を取る | 16 方向で「開けた地面が続く・敵がいない」向きを選び、ダッシュで 20 ブロック。水には入らない（池の上を通る経路で泳ぎになり 1/3 の速さ、追いつかれた）。1 分半に 3 回逃げたら 56 ブロック先へ |
| 壁（sealToward） | 地下で近接の敵が来たら、相手側の自分の隣の空きマス（足と頭の高さ、4 マスまで）に 1 秒ずつブロックを置いて塞ぐ（岩に 2 マス掘って入るより速い）。置いた所は 90 秒掘らない（階段が次の一歩で開け直していた） |
| 掘り進む前に（breachRisk・watchBreach） | 階段・坑道・縦穴で掘るマスの隣が自分の掘っていない空気（洞窟・ダンジョン）で、その近く 12 ブロックに敵がいれば、その向きは掘らない（壁越しにうめき声が聞こえるように）。スポナーの近くも。掘った後に洞窟の敵が見えたら、剣と体力があって近接 1 体でなければ開けた所をすぐ塞ぐ（階段が 7 体のゾンビのいる部屋に開いていた） |
| 岩に入る（burrow） | 地下で弓に撃たれたら、敵の反対側の岩へ 2 マス掘って入り、入口を 2 ブロックでふさぐ。横に岩が無ければ 6 ブロック以内の岩の壁まで走ってから（洞窟の真ん中で床に掘った穴は矢の押し返しで出され、掘り終わらなかった）。それも無ければ 3 マス掘り下げてふた |
| 洞窟の床で | 壁も作れない（開けすぎ）時は、走って逃げる前に自分の階段を数段戻って下をふさぐ（retreat。暗い洞窟を走って逃げると、追いつかれるか次の敵に出会った） |
| 洞窟に入る | 剣があり体力 16 以上の時だけ、探している鉱石の深さ ±10 の洞窟だけ（鉄の RTA が深層岩の y=-19 の洞窟まで下りて 15 分。`LAB_CAVES=0` で入らない） |

### 夜

| 何 | どう |
|---|---|
| 剣があり元気なら続ける | 剣があり体力 14 以上なら、夜でも地下から上がって地上の手順（原木 1 本など）をする（前は朝まで 8〜12 分待った。レースの 40 分の 1/4）。地上で隠れるのは「剣が無い、または強くない（体力 14 未満・近接 3 体以上・弓 2 体以上・近くのクリーパー）」時と体力 12 以下の時だけ（前は 1 度死んだら武器があっても敵が見えるだけで一晩隠れた） |
| 穴の中で剣を作る | 夜の穴に閉じこもったら、持っている原木・板・棒・丸石で剣を作る（作業台は横の壁に掘ったマスに置き、使ったら持っていく）。剣があり、体力 16 以上・満腹度 10 以上で、外の近接が 1 体以下・クリーパーも近くの弓もいなければ、朝を待たずに出る |
| 穴の底で | ふたを決める前に穴の底へ戻る（矢の押し返しや落ち切らないうちに決めたふたが洞窟の空中になり、置けずに撃たれた） |
| 水 | 頭が水の中で 4 秒たったら浮かび上がる。1 秒上がっても頭が出なければ、上のブロックが届けば壊し、届かなければ 6 ブロック以内で水面が空に開いている柱へ泳いで行く（張り出しの下で 30 秒） |

### 縦穴で下りる

| 何 | どう |
|---|---|
| 縦穴 | 足元から下 4 ブロックが全部固い岩（壊せる・落ちてこない・横に水や溶岩が無い）で、階段を上がる時のブロックを持っていれば、真下に 1 ブロックずつ掘って下りる（階段は 1 段に 3 ブロック掘る。y=68 から 16 まで 3 分半かかっていた）。夜は 3 段下りたら頭の上をふさぐ。戻る時（`toSurface`、傷を治しに戻る時）は、跡が真上に続く所はブロックを足元に置いて上がる。`LAB_NO_SHAFT=1` で使わない |
| 地上の高さ | 地上へ上がる目標の高さは、頭の上の柱の一番上の固いブロックの 1 つ上（無ければ出発点の高さ）。洞窟の中から始まった RTA は「地上＝洞窟の床」で、木を地下で何分も探していた |

### 計画

| 何 | どう |
|---|---|
| 強すぎる相手 | アイアンゴーレム・ウォーデン・ラヴェジャー・ホッキョクグマ・エルダーガーディアン・ボスを倒して得る道は、ほかの道がある限り選ばない（その道の見積もりに 1 時間を足す。レースで羊毛のハサミの鉄をアイアンゴーレムから取りに行き、12 回死んだ）。ネザースターなどそれしかない物は今までどおり計画できる（1,323 中 1,000、9,880 手順） |

### 訓練 `docs/goals/survive.mjs`（本物の BDS、生成ワールド、シード 1 の地点 2、x20）

走者がいつか出会う 13 の場面。合格 = 時間内に目標達成・死亡 0。結果は `docs/SURVIVE.md`（最後の回と通算）。直したことの多くは訓練で見つけた: 高い柱（掘り下げる途中で断られた足元のブロックの下を掘った「つもり」で地図に穴、経路が 1 ノードで行き詰まる）、雨の朝のゾンビ（逃げる経路が池を泳いで追いつかれる）、洞窟の弓（床の穴を矢の押し返しで掘り終われない → 壁まで走って岩へ、叩いている 1 体は片付ける）、夜（穴の中で剣を作って出る）。

### その後（r41〜）: レースの記録から直したこと

| 何 | どう |
|---|---|
| 拾えない物を何度も | 拾いに行って拾えなかった物（木の葉の上の原木、段差の上）を 1 回であきらめず、同じ物へ 12 回歩いていた（`collect` が「あきらめた」印を見ていなかった）。原木 1 本の手順が 2 分半、丸石を拾う手順も同じ。1 回で印を付け、以後は狙わない |
| 届かない木・鉱石 | たどり着けなかった木はその幹ごと、鉱石はその場所を 3 分間狙わない（手順をまたいでも）。前は次の試みも次の手順も同じ木へ歩き、2 分半ずつの足止めで RTA が終わった |
| 深い所の鉱石 | 地上にいて、知っている鉱石が 10 ブロック以上下にある（死ぬ前に地下で見た物）時は、先に縦穴・階段でその高さまで下りる。前は経路探索が 30 ブロックの岩を掘る道を探しきれず、7 個続けて「たどり着けない」で RTA が終わった |
| 原木の余り | 計画の後に地下の鉱石がある時、最初の原木は 2 本多く切る（計画に無い板の使い道: 作業台で作る木の剣、置き直す作業台、かまどの燃料。鉄の後で原木 1 本のために鉱山から地上へ出て夜になり、鉄ごと死んだ。バケツは鉄を 9 分で掘り、原木 1 本と夜で 24 分） |
| 鉱脈と、後で要る分 | 掘った鉱石の鉱脈の残り（手の届く分）も掘る。チャレンジのほかの部品も同じ鉱石が要るなら（鉄の道具 5 種で鉄 11 個を 2〜3 個ずつ）、見えている 12 ブロック以内の分もそのとき掘る。原木も後の部品の分を 6 本まで余分に（夜に棒 1 本のために地上へ出て一晩が終わった） |
| まとめて拾う | 掘った物は 1 つごとに拾いに行かず、5 つたまるか、次に掘る所が 7 ブロック以上離れる前に拾う（石 14 個が約 1 分 → 44 秒） |
| かまどの前 | かまどが焼ける間（1 個 10 秒）、画面を開けたまま立っていた（クリーパー・ゾンビ・スケルトンで 1 回のレースで 3 人。死んだ後も 20 秒待ち続けた）。5 tick ごとに周りを見て、来たら画面を閉じて戦う・距離を取る、その後かまどへ戻る。戻れなければ焼けるのを任せて後で取りに来る。死んだらすぐ抜ける |
| 死んだ所へ拾いに | 敵に囲まれて死んだ（または 3 分に 2 回死んだ）所の 12 ブロック以内の物は 5 分間、計画も拾いもしない（「落ちている剣を拾う」が群れの中へ戻る道だった）。手順の途中で死んだら、次の計画の前にまず復活する（死体の持ち物で計画を立てていた） |
| 縦穴で上がる | 地上へ戻る時、来た道が遠ければ真上に掘ってブロックを足元に置いて上がる（1 段に掘るのは 1 ブロック、階段は 3 ブロック。平らな岩の中 18 段: 階段 63 秒 → 41 秒、ツルハシの減りは 1/3。y=7 から y=106 の山の上の出発点まで階段で 5 分、ツルハシ 2 本で着かなかった）。頭の上は 2 マス空けて跳ぶ（天井 1 マスだとジャンプが短い）。砂利・砂・水・溶岩が上にあれば横に 1 マスずれる |
| 持ち替え | 手に取る物がホットバーに無い時、選んでいるスロットへ引き入れていた。ツルハシと足場のブロックを交互に使うと、毎回同じスロットで入れ替えになり、1 段にサーバーとの往復 2 回（縦穴 1 段 65 tick、90 段で 6 分）。空いているスロット、無ければ一番長く使っていないスロットへ入れてそのキーを押す（1 段 1.9 秒に）。持ち物の確認（往復）は、自分の見ている持ち物に無い時だけ |
| 跳んで置く | 足元に置くのを、決まった tick 数の後ではなく、ジャンプの頂点（1.2 上がった時、または天井で止まった時）でその tick に押す（持ち物の往復を待たずに: 20 倍では往復で着地していた）。置いたブロックはすぐ自分の地図に（本物のクライアントと同じ予測。サーバーの返事で置き換え、返事が無ければ 2 秒で消す）。掘った物が足元に落ちてくる途中なら拾うのを待ってから跳ぶ（拾った瞬間の押しは持ち物がずれて断られた）。跳ぶ前にマスの真ん中へ（2 列にまたがって立つと隣の列の天井でジャンプが止まり、6 回同じ所で跳べなかった）。足や頭の所のつる・草・クモの巣は先に払う（その中では自分のジャンプを予測できず、繁茂した洞窟からの縦穴が 1 段目で止まった）。跳べなかったら押さない。x10 で 6 段 6/6（前は 1 段目のあと着地で位置がずれて止まった） |
| 地下の敵の数え方 | 地下では、岩の向こう（見えない・2 ブロックより遠い）の敵は「近くにいる」に数えない（ふさいだ壁の向こうの溺死ゾンビで、食べ物の無い傷ついた体が階段を戻る・柱に上るを 11 分くり返した）。柱に上って逃げるのは空の下だけ、45 秒に 1 回 |
| 夜の前の食べ物 | 夕方（10500〜12900）か体力 12 未満で、食べ物を持っていなければ、見えている動物を 1 匹取っておく（夜を体力 9 で越え、朝に死んだ） |
| 空の下とは | 頭の上 12 ブロック以内に水があれば「空の下」ではない（湖の底 y=25 で「地上に出た」と止まり、湖底を木へ歩いて溺死ゾンビに囲まれた）。見るのは頭の上 32 ブロックまでではなく、知っている世界の上まで（山の下の大きな洞窟の天井は 32 より上: y=20 で「来た道を戻って地上」と言い、羊を洞窟で探して y=-1 で死んだ） |
| 夜の強さ | 夜に外で続けてよいのは石以上の剣（石・銅・鉄・ダイヤ・ネザライト、鉄とダイヤの斧）がある時。木の剣なら体力 16 以上・近接 1 体まで・クモなしの時だけ（木の剣で羊を探しに出てクモ 2 体に殺され、ハサミも失った）。夜に新しい土地を探し歩くのは、良い剣が無ければ朝まで掘って待ってから。夜の穴を朝を待たずに出るのも良い剣がある時だけ（木の剣で 16 秒で出て、羊を探してゾンビ 2 体とクモに殺された） |
| 水の中で上を掘る | 水の中で浮いていると掘るのは 25 倍遅い（素手の土 19 秒）。いつもの 10 秒の掘りは途中であきらめてやり直しを 7 回くり返し、土の下で溺れた。掘る時間をその分取り（20 秒以上かかる物なら掘らずに開いた水面へ泳ぐ）、上へ泳ぎながら掘る |
| 水の中から掘らない | 頭が水の中にある時、掘るのに 6 秒以上かかりそうな物（水中で浮いていれば 25 倍）は掘らず、まず上がって息をする（湖から石を掘ろうとして 10 秒ごとにあきらめてはやり直し、1 回のレースで 2 人が溺れた）。死んだら掘りかけの物から手を離す（死んだ画面のまま 2 分「掘り」続けていた） |
| 集め直し | 動作のクエスト（ハサミで羊の毛を刈る、など）で、動物を探し終えた時に要る物が手元に無ければ、死んだ時期を問わず集め直す（道具を作っている途中の死は「動物へ向かう途中の死」に数えられず、「ハサミを失った」で 17 分を残して終わった） |
| 夜の 2 度目の死 | 前は同じ夜に 2 度死ぬと朝まで死んだまま待った（7〜8 分）。前の死が復活から 1 分以上たってから（復活点ではなく仕事の途中で）なら、すぐ復活してその場に掘って閉じこもる。復活してすぐ殺された時だけ朝まで待つ |
| 洞窟に入る | 探す深さ ±8、y=-2 より上の洞窟だけ。入ったら中を見て、敵が見えれば開けた所をすぐふさぐ（深い洞窟でクリーパーとゾンビに囲まれ、鉄の道具のツルハシの鉄ごと死んだ） |
| 縦穴の途中の敵 | 縦穴で上を掘るのが敵の対応で中断されたら、その場からもう一度（3 回まで）。前は 1 回であきらめ、横の階段は水に当たって止まった |
| 階段を戻る | 地下で傷ついて自分の階段を戻る時、戻る道の 3 ブロック以内に敵がいれば戻らない（階段を追って下りてきたクリーパーへ歩いて行き、爆発した） |
| 岩の下から地上の手順 | 頭の上に岩が 4 枚以上ある所（穴・丘の下の洞窟）から地上の手順（木・動物）をする時は、先に地上へ出る（前は「鉱山」の深さの時だけ。砂利の穴 7 ブロック下から木へ 4 分歩き続けた） |
| 調べる | `LAB_GOAL_TRACE=1`: 歩く・掘る・拾う・探す・戦うを始めた時と、1 秒以上かかって終わった時に言う（=2 は周りを見る・反射も）。黙って止まる RTA の原因はこれで見つけた |

### レース（シード 1、10 倍速指定、1 台 10 人、各 40 ゲーム分、難易度 easy。実際の速さは平均 x2.3〜2.5）

| 回 | 入れたこと | 完走 | 死亡 |
|---|---|---|---|
| r34 | x50 対応の前 | 4/10 | 35 |
| r35・r36 | 敵への対応（threatPlan・逃げる・岩に入る）、歩きの予測 | 6/10・6/10 | 19・19 |
| r37・r38 | 見えている物だけで探す（fair）の上限の直し、剣を先に（失敗しても 2 分は続ける） | 8/10・7/10 | 16・27 |
| r39 | 掘る・置く・画面・戦いを遅れに合わせる、夜の方針（剣があれば続ける）、壁、見張り | 6/10 | 30 |
| r40 | 縦穴、敵のいる洞窟を避ける、穴の中の剣、坑道で戦う、クリーパーにも壁 | 7/10 | 26 |
| r41・r42 | 鉱脈の残り、まとめて拾う、砂利の下を階段で通らない・埋まったら掘り出す、水の隣の石は掘らない、深い洞窟からは地上へ出てから離れる（復活点は開けた地面だけ）、皮を剥いだ原木も板に、強すぎる相手を狙わない | 6/10・6/10 | 28・20 |
| r43 | かまどの前の見張り、死んだ所へ戻らない、死んだらまず復活、縦穴で上がる・跳んで置く | 7/10 | 14 |
| r44 | 拾えない物を何度も狙わない、届かない木・鉱石を避ける、深い鉱石へ先に下りる、ほかの部品の鉱石・原木も一緒に、岩の向こうの敵を数えない、夜の前の食べ物、水の底は空ではない、岩の下から地上の手順は先に地上へ | 7/10 | 12 |
| r45 | 持ち替え（空き・一番古いスロットへ）、跳ぶ前に真ん中へ、空の下を上まで見る、木の剣の夜、階段を戻る前に敵を見る | 7/10 | 16 |
| r46 | 水の中で上を掘る時間、夜の 2 度目の死、原木の余り、洞窟の深さと中を見る、縦穴の途中の敵 | 8/10 | 16 |
| r47 | 水の中から掘らない、死んだら掘るのをやめる | 8/10 | 14 |
| r48 | 動物を探す前の集め直し、夜の穴を出るのは良い剣の時だけ | 9/10 | 12 |

最速の更新（ゲーム内時間）: バケツ 4:43（前 5:21）、ステーキを食べる 2:06（前 2:42）、ビンゴ 1 8:11（前 16:43）、y=0 まで 4:02（前 5:58、縦穴）。完走できなかったのはどれも鉄が要る目標（鉄のツルハシ・鉄の道具一式・ハサミ）で、原因は洞窟の敵での死（r40 の 26 のうち地下 8、夜の地上 6、昼の地上 8）と、アイアンゴーレムを狙った計画（直した）。完走の数は地点・天気・洞窟の運で ±1〜2 動く。その後: バケツ 3:23（r48、前 4:43）、鉄の道具 5 種 8:55（r47、前 14:14。ほかの部品の鉄も一緒に掘る）、ビンゴ 1 5:29（r46、前 8:11）、鉄のツルハシ 3:45（r45、前 3:54）、y=0 まで 3:20（1 人で。レースでは 3:27）、石のツルハシ 1:14、ステーキ 1:53。r43〜r48 で完走しなかったのは、洞窟と日陰の多い地点（P04 の盾は r48 で初めて完走、P06 の鉄の道具は r47・r48 で完走、P08 のハサミ）がほとんどで、死亡はそこに集まる（r46 の 16 のうち 10）。

### 検証

| 何 | どう |
|---|---|
| 本物の BDS | BDS 1.26.51.1 と本物のクライアントで、変えた所に関わる手書きの動作の分類をすべて通し直した: ブロック 50/50、採掘 15/15、戦い 64/64、目標 3/3、クラフト 98/98、かまど 20/20、置く 23/23、手 42/42（x1）。x20 で丸太 9 本を素手で: 前 3〜6/9 → 9/9（x1・x4 も 9/9）、草 9/9、岩盤は「返事が無い」で諦める。訓練 13 種、レース 7 回。その後（持ち替え・跳んで置く・予測して置くを変えた後）も 8 分類すべてを通し直した（同じ数、全部通る）。縦穴で上がる: 平らな岩 18 段 x10 で 41 秒（階段 63 秒、掘るのは 19 回と 57 回）、砂利と水を横にずれて避けて地上へ、柱 6 段 6/6。レース r41〜r48 |
| オフライン | `node tests/realplayer-offline.mjs` 44/44（偽のサーバーも BDS と同じく割れの合図 level_event を送るようにした）、`tests/offline.mjs` 66/66、`tests/env-offline.mjs` 36/36、`tests/nethernet-offline.mjs` 31/31、計画の総当たり 1,000/1,323・9,880 手順 |
| 残り | 洞窟とそこの敵（弓 2 体、ゾンビの群れ、クリーパー）での死がまだ一番多い。訓練の「何も持たない最初の夜」「夜の 3 体」「洞窟の弓 2 体」は運次第で半分以下。レースの完走は 10 種中 7〜9（r43〜r48: 7・7・7・8・8・9）。夜は良い剣が無ければ 10 分近く穴で待つ（40 分のレースの 1/4）。鉄を探す時間は 1〜7 分と運に大きく左右される |

## 35. v50: 走者と PvP の技（間合い・W タップ・クリーパー・盾・速い橋）

Hypixel などの PvP 勢と RTA 走者の技を調べ、Bedrock（BDS 1.26.51）で本当に効くかを測ってから入れた。調べた元: minecraft.wiki（Knockback, Melee attack, Shield, Creeper, Tutorial:PvP (Bedrock Edition), Tutorial:Bridging, Bedrock Edition exclusive features）、Mojang の bedrock-samples（mob の JSON）、Mojira MCPE-157812（ノックバックの実測）・MCPE-170242、Hypixel フォーラムの橋の速さ比べ。

### 測った値（本物の BDS、本物のクライアント）

| 何 | 値 |
|---|---|
| 剣が届く所 | 目から相手の箱まで 3（マウス。サーバーは 6.2 まで通すが、それは使わない） |
| ゾンビ・ハスクの噛みつき | 中心どうし軸方向 1.36〜1.47、斜め 1.90（箱を 0.8 広げた範囲） |
| クモ | 1.75〜1.83 |
| クリーパーが光る | 軸方向で中心 3.0 は光る、3.3 は光らない（箱のすき間 2.5）。導火線 30 tick、6 離れると止まる、見えなくなると止まる |
| 立って打ったハスクの飛び | 1.63 ブロック（24 tick 後） |
| 走って打った（W タップ）ハスク | 2.21 ブロック（+36%。訓練の中で 12 tick 後 1.39 と 0.96） |
| スケルトン | 3 秒ごと（hard 2 秒）、15 ブロックまで、動かずに撃つ |
| 攻撃の待ち | Bedrock には無い。打たれた mob は 10 tick 無敵なので 10 tick に 1 回 |

### 入れた技

| 技 | 何をする | 結果 |
|---|---|---|
| 間合い（outspacing） | 相手の噛みつきの外、剣の届く端で打ち、無敵の 10 tick は下がる。相手の位置は遅れ（往復の半分＋1 tick）の分だけ先を読む | ゾンビ・ハスク 1〜3 体、溺死ゾンビ、クモ 1〜2 体: 一度も当たらない（x1・x10） |
| W タップ（スプリントリセット） | 打つ直前の 1 tick だけ前＋ダッシュ、打ったら離す。サーバーは走って打たれた mob を遠くへ飛ばす | 飛ぶ距離 +36〜45%。ハスク 2 体 7.4 秒で 0 被弾。打った後は S タップ（後ろを 1 tick）で勢いを消す。使うのは返事が 1〜2 tick で来る時と武器を持つ時だけ（x20 の訓練では前へ出た分だけ噛まれ、4 回中 2 回負けた。切ると 4/4）。クモ（すぐ跳び返る）とアーチャー（遠くから撃つ）には使わない |
| クリティカル | 1 体だけ・平らで開けた所で、跳んで落ちる途中に届いた時に打つ（×1.5） | 石の剣のゾンビが 4 発 → 3 発 |
| クリーパーの打ち逃げ | 光ったかをサーバーの印（ignited、画面では白く点滅）で見る。届いたら打つ（光っても飛ばされる）、光ったら背を向けて 6 の外まで走る、止んだら戻る | 前は x1 でも x10 でも爆発（5〜11 の傷）。今は 1 体を x1・x10 とも無傷で倒す（4 回逃げて 4 回打つ） |
| 盾 | 持っていれば戦いの前に左手へ。アーチャーの次の矢が近い時（前の矢から数えて）しゃがんで構える | 最初の 1 本を止めて、装填の 3 秒で詰める |
| 速い橋（`speed_bridge`） | しゃがまずに走りながら、足元のブロックの前の面に次を置く（Bedrock の fast bridging、スピードブリッジの狙い）。1 回押すごとにサーバーの返事（持ち物の新しい番号）を待つ。返事の来ていない縁ではしゃがんで待つ | 10 ブロック: x1 で 2.0 秒（5 ブロック/秒）、x10 で 2.8 秒。前の `bridge`（しゃがんで 1 つずつ）は 1.3 ブロック/秒。Hypixel の god bridge は 4.5 |
| tick の中の反射（`K.everyTick`） | 忙しいクライアントは何 tick も一度に進むので、1 tick ずつ待つループでは見えない。足元の判断は tick の中で | x10 で橋の先から 23 tick 目隠しで歩いて落ちたのが直った |
| 逃げている途中で追いつかれた時 | 前は逃げている間は反射を止めていた（穴に落ちてゾンビに 5 回噛まれ、クモの次にクリーパーが来て爆発）。噛みつきの届く所まで来た 1 体・光ったクリーパーには向き直って打つ（ノックバックで離す）、それから逃げ続ける | レースの死因を直す |
| 傷の記録（`LAB_HURT_LOG=1`） | 体力が減るたびに、その時近くにいた物（光ったクリーパーは lit） | レースで「一度も当たらない」を数えるため |

### 調べたが入れていない物（理由）

| 技 | 理由 |
|---|---|
| ジャンプリセット | 打たれた時のノックバックを減らす技。当たらないのが目的なので要らない |
| ブロックヒット | Java 1.8 の剣で防ぐ技。Bedrock には無い（盾で代わりにした） |
| god bridge・moonwalk・telly | 1 tick の窓で押す技。Bedrock の fast bridging（上の速い橋）の方が速く確実 |
| ロッドのコンボ・パール | 対人の技。mob には効かない |
| サーバーの甘い間合い（6.2）を使う | マウスの人の手では届かない。リーチ改造と同じなので使わない |

### 訓練（`docs/goals/survive.mjs`、x20）

| 訓練 | 前 | 今 |
|---|---|---|
| `cave_archers`（地下でスケルトン 2 体） | 0 / 2 | ✔ |
| `creeper` | ✔ | ✔ |
| `spiders_night` `baby_zombie` `skeletons_rain` | ✔ | ✔ |
| `zombies_rain`（素手） | 2 / 3 | W タップの条件を付けて 2 / 2（付ける前は 2 / 4） |
| `night_tools`（ゾンビ・スケルトン・クモの群れ） | 1 / 1 | 3 / 4。3 回のうち 1 回は一度も当たらず、2 回は群れの中で 7〜8 回 |

### レース（シード 1、10 倍速指定、1 台 10 人、各 40 ゲーム分、easy、`LAB_HURT_LOG=1`）

| 回 | 版 | 完走 | 死 | うち爆発 | 体力が減った回数 |
|---|---|---|---|---|---|
| r49 | 間合いだけ（クリーパーは避けるだけ） | 8 / 10 | 11 | 2 | — |
| r50 | ＋光った印・W タップ（遅れの条件なし） | 6 / 10 | 14 | 4 | 179 |
| r51 | ＋逃げる途中で追いつかれたら打つ・W タップは遅れの小さい時だけ | 7 / 10 | 7 | 0 | 92 |

r51 で減った物: 残りの傷の多くは戦いの外（群れの中で穴を掘っている間、作業台・かまどの前、素手で逃げている間）。死因は矢 3・ゾンビ 2・溺れ 1・落下 1。

### 残り

- 洞窟グモ（毒・小さく跳ぶ）: 2 体で 3 回噛まれることがある（毒で合わせて 7）。普通のクモは 2 体 0 回、3 体 1 回
- 橋はまだ動作（`speed_bridge`）だけで、道探しは水や谷を橋で渡らない

## 36. v51: プレイヤーと戦う（PvP）・ブロックの技・SimulatedPlayer の対戦相手

### 対戦相手 `addons/pvp_sim`（SimulatedPlayer）
`/scriptevent pvp:spawn <名前> x y z [easy|normal|pro] [持ち物] [wait]`、`pvp:go` `pvp:target` `pvp:stop`。公平に: 間合いは目から相手の箱まで 3、打てるのは相手の無敵 10 tick が明けた時だけ。normal はダッシュで詰めて明けた tick に打ち、打った後 W タップ。pro はさらに回り込み（ストレイフ）、詰めながら跳んでクリティカル、打たれた tick に跳ぶ（ジャンプリセット）。1 撃ごとに `PVP hit A -> Bob 7.0 hp 13.0`。

### 本物のクライアントの `duel <player>`（`common/goal-exec.cjs` pvpFight）

| 技 | やり方 |
|---|---|
| 0.5 ぴったり | 相手の赤い点滅（hurt_animation）から 10 tick の窓を数え、往復の遅れの分だけ早く振って、窓が明けた tick に当てる（mob にも同じ） |
| 先に当てる | ダッシュで突っ込んでくる相手には立ち止まって待ち、相手の歩きから「振りが届く時」の位置（往復＋2.5 tick 先）で振る。見えてから振ると、遅れの無い相手に 1 tick 負けて毎回先に打たれた（normal に 0/2） |
| 間合いを全部使う | 3 の余りを残さない（同じ間合いの相手に毎回先を取られた） |
| 相手のクリティカル返し | 打たれて浮いた相手の返しは空中なのでクリティカル（10.5）。こちらも突っ込まれる時は跳んで、落ちながら当たるように合わせる（入れる前 normal に 2/4、入れた後 4/4） |
| W タップ・S タップ | 相手が打ち返せない時だけ打つ前の 1 tick ダッシュ（等しい競り合いではその 1 tick が負けになる）、打ったら後ろ |
| 崖を背に | 相手が打てない間に、背後の 3 以上の落差をブロックでふさぐ |
| ブロッククラッチ | それでも飛ばされたら、tick の中（K.everyTick）でブロックのキー→縁の側面を押す→武器のキー。穴を背にした決闘 3 回とも落ちなかった（入れる前は 1 回落ちた） |

結果（BDS 1.26.51、鉄の剣どうし、normal 難易度、x1）: easy 3/3、normal 4/4、pro 3/3 勝ち（全 10 戦 30 撃当てて 12 撃受けた）。石の剣で pro の鉄の剣に 1/2。x10 では pro に 2/2、normal と easy に 0/3: 10 倍速は通信が実時間のままなので、実際には数 tick 分のピンがある人と、ピン 0 のサーバー内の相手との勝負になる。

### ブロックの技（mob 相手）

| 技 | 測った値・やり方 |
|---|---|
| クリーパーとの間に 1 ブロック | 2.8 で光らせてから: そのままだと 15 の傷。足の高さに 1 ブロックで 1、頭の高さに 1 ブロックだと視線が切れて導火線が止まり 0（爆発しない）。逃げ切れない時・近すぎる時は足と頭の 2 つを置く。壁で囲まれた所で試して無傷で倒した |
| 2 方向から来たら片方に壁 | 2 体が違う向きから来る時、2 体目の側に 2 段の壁（回り込む間に 1 体ずつ）。置くのに数 tick かかるので、近くに誰もいない・返事の速い時だけ（近くで置くと噛まれた） |
| 落とされたら | 決闘と同じブロッククラッチを mob との戦いでも |

### 訓練（入れた後）
ハスク 3 体 x1・x10、ゾンビ 3 体 x1、クモ 2 体 x10、クリーパー 1 体 x10: 全部 0 回（壁の条件を付ける前はハスクで 2 回噛まれた）。スケルトン 1 体 x10: 1 本（最初の一撃で飛ばした後に撃たれた）。

## 37. v52: PvP Practice Bots（v2.6）の impossible に全キットで勝つ

相手はもらったアドオン `addons/pvp_practice_bots_v2_6`（`/pb:spawnbot impossible <kit> A`、SimulatedPlayer）。こちらは同じキット（`/pb:kit <kit> A`）で `@A duel pvp_bot 300`。試す台本は `/pb:kit` → `@A& duel` → `/pb:spawnbot`（相手はこちらの 8 ブロック先）。取り込みの時、相対 import に `.js` を足しただけ（lab の検査が拡張子なしを通さないため。動きは変えていない）。

### 相手を読んで分かったこと（スクリプトを戻して読んだ）
- impossible: 間合いは足元どうし 3.05（こちらは目から箱まで 3 = 中心で 3.3: こちらの方が 0.25 長い）、2 tick ごとに振る、外れ 2%、クリティカル 55%、打つたびに自分でノックバックを足す（0.4、ダッシュ中 0.65）。
- メイス: 足元に風の弾を撃って跳び、15 tick は打たず、落ちながら「間合い+1」（4.05）で打つ。落下の一撃は 12〜15（盾を上げても、上からの一撃は通った）。回復はリンゴ、強さ II・俊敏 II のスプラッシュ、トーテム。
- クリスタル: こちらとの間 1.5 ブロックに黒曜石とクリスタルを置き、5 tick 後に割る。こちらが低いとリスポーンアンカー。間に壁があれば（頭の高さの線）置かない。自分の爆発で自分も大きく削れる。
- 斧: こちらが盾を構えると斧に持ち替えて盾を壊す。

### 入れたこと（`duel`）
| 何 | やり方 |
|---|---|
| 盾を構え続ける | 左手に盾、相手が斧を持っていない間はしゃがんで構えたまま（打つ tick と食べる時だけ下げる）。impossible の剣を 4 秒受けて無傷（測定） |
| 持ち物を見る | 相手が手に持っている物（mob_equipment）を覚える。メイスか風の弾を一度でも持てばメイス使い |
| メイス使い | 地上の相手から 4.4 以内に入らない（打つ tick を除く）。跳んだのを見たら、その 15 tick の間に詰めて打つ。落ちてくるのを予測して 5.4 以内なら走って離れる |
| バフ | 強さ II・俊敏 II（炎の爆発のあるキットは耐火も）を足元に投げる。切れたら離れている時に投げ直す（強さ II で 1 撃 1.7 → 4.3） |
| 回復 | 13 以下で 4.6 より離れている時にリンゴ（エンチャント付きを先に）。7 以下で近ければ先に走って離れる（近くで食べて 4 発とメイスを受けた） |
| トーテム | クリスタル・カート・メイスのキットでは左手にトーテム。割れたら tick の中で次を入れる（道を歩いている間や食べている間に割れて、次の爆発で死んだ） |
| クリスタル・アンカーの壁 | 近くにクリスタル（7 以内）かアンカー（2 以内）が現れたら、その側の隣のマスに足と頭の 2 ブロック（その tick に押す） |
| 最初のリンゴ | エンチャント付きがあれば、相手が来る前に食べる（耐性・耐火・吸収） |
| 遠い・穴の向こう | 8 以上離れて真っすぐ行けない時だけ道を探して向かう（近くで道を歩くと打ち返せずに削られた） |

### 結果（x1、ダイヤ・ネザライト装備の同じキットどうし）
| 回 | 剣 | 斧 | メイス | UHC | クリスタル | カート |
|---|---|---|---|---|---|---|
| r3（4 回ずつ、時間 120 秒） | 4/4 | 4/4 | 4/4 | 4/4 | 3/4（1 回は時間切れ） | 4/4 |
| r4（3 回ずつ、時間 300 秒） | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| r5・r6 | 6/6 | 6/6 | 5/6 | 6/6 | 5/6 | 6/6 |
| 直した後: メイスだけ 8 回、クリスタルだけ 6 回 | | | 8/8 | | 6/6 | |
| r7（最後、3 回ずつ） | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |

r5・r6 の負け 2 つから直したこと: クリスタル — 道を歩いている間にトーテムが割れて次の爆発で死んだ（トーテムを tick の中で入れ直す、4 tick ごと）、爆発の穴の向こうへ道を歩いてクリスタルの中へ入った（クリスタルのキットでは 16 より遠い時だけ道を歩く）、黒曜石の壁が残って相手がクリスタルを置かなくなり、リンゴで回復され続けて 300 秒の時間切れ（壁はグロウストーン: 爆発を受けて壊れ、相手は次のクリスタルでまた自分を削る）。メイス — 最初に見た時に手がポーションやリンゴだとメイス使いと分からず近づいた（メイスのキット同士なら最初からメイス使い）、近くで食べて落下の一撃（メイス使いには地上で 8 より離れた時だけ、跳んでいる間は食べない）。

r7 の当てた数／受けた数（3 戦の合計）: 剣 39/12、斧 29/5、メイス 33/3、UHC 28/25、クリスタル 128/189（受けたのは相手の爆発が大半。相手自身もそれで削れる）、カート 28/7。前の自作の相手 `pvp_sim` の pro にも変わらず勝つ（2/2）。
