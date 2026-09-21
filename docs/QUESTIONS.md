# QUESTIONS.md — 減らしてよいかを決める 10 問

トークンを減らすのは簡単です。**消せばいい。**だから「減った」だけでは合格にしません。

この 10 問は、bds-lab で作業する AI が実際にぶつかる問いです。改修の前後で、
**答えが変わらないこと**と、**答えに辿り着くまでに読む量が減ったこと**の 2 つで判定します。

- 答えは 1 行。言い換えは可、意味が変われば不正解。
- 「分からない」「実機で確かめる」が正解の問いが 2 つ（Q1・Q2）あります。**断定したら不正解**です。
- 測り方は `node docs/tokens.mjs`。基準値は `docs/TOKENS.md`。

## 判定

| | 改修前（実測） | 目標 | 改修後（実測） |
|---|---|---|---|
| 10 問すべてに答えるまでに読む量（確実な道） | **294,564 tok** | 3,000 tok 以下 | **2,340 tok（126×）** |
| 同上（当てずっぽうが全部当たる理想の道） | 42,094 tok | 同上 | 同上 |
| 正答 | 10 / 10 | 10 / 10 のまま | **10 / 10** |

改修後の引き方（この 10 行で 2,340 tok）:

```sh
npm run api -- InputInfo.getMovementVector   # Q1（符号の注意は npm run skill movementVector）
npm run skill スペクテイター                   # Q2
npm run api -- WorldBeforeEvents.chatSend    # Q3
npm run skill restricted                     # Q4
npm run skill setFov                         # Q5
npm run skill flying_speed                   # Q6
npm run skill import                         # Q7
npm run skill 1.x                            # Q8
npm run api -- InputPermissionCategory       # Q9
npm run skill 飛ばされた                       # Q10
```

「確実な道」は、引くコマンドが無いいま、答えを外さないために読む必要があるものの合計です
（`server.d.ts` 250,942 + `api.json` 27,990 + `skills/` 全部 10,714 + `AGENTS.md` 1,760 + `START_HERE.md` 3,158）。
1 問あたり 29,456 tok。ここを 300 tok にするのが、この改修のいちばん大きい山です。

---

## Q1. `player.inputInfo.getMovementVector()` は何を返すか

**答え**: `Vector2`（`x` と `y`）。**符号は実機で測るまで決めない。**
SimulatedPlayer では常に `0,0` なので、入力を読む機能は `tags: ['real']` でしか確かめられない。

出典: `types/minecraft/server.d.ts` の `InputInfo` / `skills/41-input-camera.md` / 実測（`report.json`）
今の引き方: 355 tok（クラスだけ切り出せた場合）〜 250,942 tok（d.ts 全文）

## Q2. スペクテイターのプレイヤーで `playerButtonInput` は届くか

**答え**: SimulatedPlayer では**届かない**（そもそも入力を送らないため）。
**本物のクライアントでは未確認。**「スペクテイターでは何も発火しない」は誤り
（`itemUse`・スニーク・持ち物の変化・`playerGameModeChange` は届く、と 1.26.51.1 で実測）。

出典: `skills/70-pitfalls.md` / `addons/spectator_probe`
今の引き方: 1,849 tok

## Q3. `world.beforeEvents.chatSend` は使えるか

**答え**: manifest が `@minecraft/server` の **beta**（2.x-beta）を宣言していれば在る。
1.26.51.1 の `api.json` に在り、購読も成功する（42/42）。**安定版だけを宣言した場合は無い。**
`AGENTS.md` の「安定版にチャットのイベントはありません」は、この条件つきで読むこと。

出典: `api.json` / `addons/spectator_probe/scripts/events.js`
今の引き方: 27,990 tok（`api.json` 全文）

## Q4. トップレベルでコンポーネントを読むとどうなるか

**答え**: `restricted-execution mode` で弾かれる。`system.run` かイベントの中へ移す。

出典: `skills/70-pitfalls.md` / `AGENTS.md`
今の引き方: 1,760 tok

## Q5. `camera.setFov` に渡せる値の範囲は

**答え**: `[30, 110]`。外すと例外（`Custom FOV must be within [30.0, 110.0]`）。

出典: `skills/41-input-camera.md` / `skills/70-pitfalls.md`
今の引き方: 757 tok

## Q6. `minecraft:flying_speed` はプレイヤーに付いているか

**答え**: 付いていない（`null`）。`minecraft:movement` は付いている（既定 0.1）。

出典: `skills/70-pitfalls.md`
今の引き方: 1,849 tok

## Q7. 相対 import はどう書くか

**答え**: `./util.js` と拡張子まで書く。`./util` は版によって `Import [./util] not found`。
`npm run inspect -- --fix` で一括で直せる。

出典: `skills/70-pitfalls.md`
今の引き方: 1,849 tok

## Q8. 古い `.mcaddon` が「何も起きない」とき、最初に見るのはどこか

**答え**: `manifest.json` の `@minecraft/server` が `1.x` のままかどうか。1.x は今の実機では読み込まれない。
次に、`dependencies` に UUID 指定があるのに相手のリソースパックが入っていないか（BP ごと読み込まれない）。

出典: `skills/70-pitfalls.md` / `START_HERE.md`
今の引き方: 1,849 tok

## Q9. 入力許可（`InputPermissionCategory`）はいくつあり、`Jump` を切ると何に効くか

**答え**: 11 個（Camera / Movement / LateralMovement / Sneak / Jump / Mount / Dismount / MoveForward /
MoveBackward / MoveLeft / MoveRight）。`Jump` は**飛行の上昇**にも効く。`Sneak` は飛行の下降にも効く。
`Movement` を切るのは jump・sneak・lateral・mount・dismount をまとめて切るのと同じ。

出典: `types/minecraft/server.d.ts` の `InputPermissionCategory`
今の引き方: 493 tok（enum だけ）〜 250,942 tok（d.ts 全文）

## Q10. 「飛ばされた」仕様書は通ったことになるか

**答え**: ならない。`bedrock-protocol` が無い環境では `real` は落ちずに飛ばされ、
結果に「確かめていないもの」として残る。**通ったものとして扱わない。**

出典: `START_HERE.md` / `AGENTS.md`
今の引き方: 3,158 tok

---

## 改修後にやること

1. 各問について、改修後の引き方（`npm run api -- InputInfo` など）とその出力のトークンを
   `node docs/tokens.mjs --cmd "..."` で測る。
2. 答えが変わっていないことを確かめる。**1 問でも答えが変わったら、その改修は失敗。**
3. 結果を `docs/TOKENS.md` の表に書く。

問いを増やすのは歓迎です（新しい落とし穴が見つかったら、ここに 1 問足す）。
**減らすのは禁止**です。答えられなくなった問いを消せば、いくらでも合格できてしまうので。
