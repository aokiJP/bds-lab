# TOKENS.md — 改修前の実測値

`node docs/tokens.mjs` の出力です。**改修後は同じコマンドで同じ表を作り、倍率を実測で書きます。**
数え方を変えると倍率がいくらでも作れるので、変えるならこの表も測り直してください。

- 数え方: 日本語 1 文字 ≒ 1 token / それ以外 3.6 文字 ≒ 1 token（実際のトークナイザではありません。前後を同じ物差しで比べるためのものです）
- 測った版: bds-lab 1.0.0 / BDS 1.26.51.1 / `@minecraft/server` 2.11.0-beta.1.26.51-stable / Node 22.22.2
- 測った日: 2026-09-21

## 改修前

```
## a 常駐
  AGENTS.md                                1,760 tok
  START_HERE.md                            3,158 tok
  .bds-lab/handoff/PROMPT.md               2,992 tok  毎ラウンド生成される指示文
  小計                                       7,910 tok  AI が何をするにも先に読む量

## b 資料
  README.md                                4,021 tok  人向け
  skills/ 合計（15 枚）                        10,714 tok
  skills/ 最大の 1 枚                          1,849 tok
  types/minecraft/server.d.ts            250,942 tok  全文を読ませたら文脈が潰れる
  types/minecraft/server-ui.d.ts          19,508 tok
  types/minecraft/server-gametest.d.ts    28,774 tok
  api.json（実機に在る API）                     27,990 tok

## c 結果
  .bds-lab/report.json                     1,949 tok
  .bds-lab/server.log                     30,903 tok

## d 返却
  addons/spectator_probe/ 全文              11,058 tok  今の規則（全文で返す）で毎回返る量
  同 うち最大の 1 ファイル                           2,942 tok
  specs/ 合計（3 本）                           4,938 tok

## e 1 問
  InputInfo の中身を知る                       250,942 tok  今: 引くコマンドが無いので d.ts 全文が上限
  └ そのクラスだけなら                                355 tok  下限。全文の 1/707
  Camera の中身を知る                          250,942 tok  今: 引くコマンドが無いので d.ts 全文が上限
  └ そのクラスだけなら                              1,374 tok  下限。全文の 1/183
  PlayerButtonInputAfterEvent の中身を知る     250,942 tok  今: 引くコマンドが無いので d.ts 全文が上限
  └ そのクラスだけなら                                126 tok  下限。全文の 1/1,992
  入力の符号を確かめる                               2,606 tok  今: 落とし穴と入力の 2 枚を読む

数え方: 日本語 1 文字 ≒ 1 token / それ以外 3.6 文字 ≒ 1 token
```

## ここを削る（目標）

| 何 | 改修前 | 目標 | 倍率 | どうやって |
|---|---|---|---|---|
| 10 問に答えるまで（`docs/QUESTIONS.md`） | **294,564** | **3,000** | **98×** | `npm run api` と落とし穴カード |
| 常駐（AGENTS + START_HERE + 指示文） | **7,910** | **1,000** | 8× | 1 枚に寄せる・残りは参照 |
| 1 ラウンドの結果（report.json + server.log） | **32,852** | **600**（40 行） | 55× | `npm run status` |
| 1 ラウンドの返却（アドオン全文） | **11,058** | **500** | 22× | 差分で返す |
| API 1 件（`InputInfo`） | **250,942** | **300** | 836× | 索引から引く |

1 ラウンドの合計（常駐 + 結果 + 返却 + API 確認 1 回）で見ると、**約 302,762 → 約 2,400（126×）**。
API を引かない回もあるので、**実際の平均は 20〜30 倍**に落ち着くはずです。
そこまで測って、はじめて「100 倍」と書けます。**見込みで書かないでください。**

## 改修後（実測）

```
## a 常駐
  AGENTS.md                                  822 tok
  START_HERE.md                              935 tok
  .bds-lab/handoff/PROMPT.md               2,365 tok  毎ラウンド生成される指示文
  小計                                       4,122 tok  AI が何をするにも先に読む量

## b 資料
  README.md                                4,021 tok  人向け
  skills/ 合計（15 枚）                        11,135 tok
  skills/ 最大の 1 枚                          2,270 tok
  types/minecraft/server.d.ts            250,942 tok  全文を読ませたら文脈が潰れる
  types/minecraft/server-ui.d.ts          19,508 tok
  types/minecraft/server-gametest.d.ts    28,774 tok
  api.json（実機に在る API）                     27,990 tok

## c 結果
  .bds-lab/report.json                     2,188 tok
  .bds-lab/server.log                     31,959 tok

## d 返却
  addons/spectator_probe/ 全文              11,058 tok  今の規則（全文で返す）で毎回返る量
  同 うち最大の 1 ファイル                           2,942 tok
  specs/ 合計（3 本）                           4,938 tok

## e 1 問
  InputInfo の中身を知る                       250,942 tok  今: 引くコマンドが無いので d.ts 全文が上限
  └ そのクラスだけなら                                355 tok  下限。全文の 1/707
  Camera の中身を知る                          250,942 tok  今: 引くコマンドが無いので d.ts 全文が上限
  └ そのクラスだけなら                              1,374 tok  下限。全文の 1/183
  PlayerButtonInputAfterEvent の中身を知る     250,942 tok  今: 引くコマンドが無いので d.ts 全文が上限
  └ そのクラスだけなら                                126 tok  下限。全文の 1/1,992
  入力の符号を確かめる                               3,027 tok  今: 落とし穴と入力の 2 枚を読む

数え方: 日本語 1 文字 ≒ 1 token / それ以外 3.6 文字 ≒ 1 token
```

| 何 | 改修前 | 改修後 | 倍率 | 中身 |
|---|---|---|---|---|
| 10 問に答えるまで（`docs/QUESTIONS.md`） | 294,564 | **2,340** | **126×** | `npm run api` と `npm run skill <語>`。正答は 10/10 のまま |
| API 1 件（`InputInfo`） | 250,942 | **59** | **4,253×** | `npm run api -- InputInfo`（6 行） |
| API 1 件（メンバー指定） | 250,942 | **33** | **7,604×** | `npm run api -- InputInfo.getMovementVector` |
| 1 ラウンドの結果（report + log） | 32,852 | **51** | **644×** | `npm run status`（6 行。落ちていれば最初の 1 件だけ詳しく） |
| 常駐（AGENTS + START_HERE + 指示文） | 7,910 | **4,122** | 1.9× | うち固定部分は 1,757（AGENTS 822 + START_HERE 935）。残りは依頼書と前回の結果で、毎回変わる |
| 1 ラウンドの返却（アドオン全文） | 11,058 | 11,058 | 1× | **未達**。差分返却は未実装（下記） |

1 ラウンドあたり（常駐 + 結果 + API 確認 1 回）で **291,704 → 4,232 ＝ 69 倍**。
API を何度も引く回ほど差が開きます（1 回引くごとに 250,942 → 59）。

### 届かなかったもの

| 何 | なぜ | 次の一手 |
|---|---|---|
| 返却 11,058 → 500 | 差分返却は取り込み側の作り替えが要る。いまは全文返却のまま（ただし**壊れた中身は取り込み前に弾く**ようにした） | `apply.mjs` に検索置換ブロックの適用を足す |
| 常駐 4,122 → 1,000 | 固定部分は 1,757 まで減った。残りは `TASK.md`（依頼書）と前回の失敗で、これは毎回中身が変わる | 依頼書は要約せず渡す。失敗は `npm run status` の 40 行に寄せる |
| skills 1 枚 300 tok | ファイルは分けていない。代わりに `npm run skill <語>` が**当たるカードだけ**出す（193〜414 tok） | 版・出典・最終確認日を frontmatter に（#34） |

## 測り直し方## 測り直し方

```sh
node docs/tokens.mjs                      # この表
node docs/tokens.mjs --json               # 機械で読む
node docs/tokens.mjs --file <path>        # 1 ファイル
node docs/tokens.mjs --cmd "npm run api -- InputInfo"   # 改修後のコマンドの出力を測る
```

`npm run tokens` に配線したあと、**改修前の値が ±10% で再現できること**を最初に確かめてください。
再現しないなら、測り方が変わっています。倍率を書く前に直してください。

## 覚え書き

- `server.d.ts` は 29,715 行・250,942 tok。1 クラス分だけなら `InputInfo` 355 / `PlayerButtonInputAfterEvent` 126 /
  `Camera` 1,374 / `Player` 6,858 tok。**引ければ 700〜2,000 分の 1 で済みます。**
- `server.log` は 30,903 tok。AI に直接読ませてはいけない大きさです。
- `skills/` は 15 枚で 10,714 tok、最大の 1 枚が 1,849 tok（`70-pitfalls.md`）。1 枚 300 tok に割ると 35 枚前後になります。
- 常駐の内訳: `START_HERE.md` 3,158 / 生成される指示文 2,992 / `AGENTS.md` 1,760。
  指示文は毎ラウンド作り直されるのに、中身の多くが固定です。ここは丸ごと削れます。
