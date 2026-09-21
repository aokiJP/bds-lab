# 70. 落とし穴（実機で実測したものだけ）

書いてあるのは、この仕組みが**実際に実機で踏んで確かめた**ものだけです。
版を書いてあるものは、その版で測っています。新しく分かったら必ず足してください。

```sh
npm run skill -- "見出し" --to pitfall --body "分かったこと。<版> で実測"
```

## getAllPlayers() は undefined を含むことがある — 1.26.51.1 で実測
```js
const players = () => world.getAllPlayers().filter(Boolean);
```
配列の長さは 1 なのに中身が `undefined`、という状態が実際に起きます。
`playerSpawn` や `playerGameModeChange` の `ev.player` も `undefined` のことがあります。

## Proxy は実機が弾く — 1.26.51.1 で実測
`new Proxy(world, …)` は `proxy: inconsistent get` で落ちます。
包みたいときは、素の入れ物にプロパティを写してください。

## new Function は capabilities 次第 — 1.26.51.1 で実測
`manifest.json` に `"capabilities": ["script_eval"]` を入れると通ります。
入れないと `Function from string is not supported`。

## camera.setFov の範囲は [30, 110] — 1.26.51.1 で実測
外すと `Custom FOV must be within [30.0, 110.0]` で落ちます。

## minecraft:flying_speed はプレイヤーに付いていない — 1.26.51.1 で実測
`getComponent('minecraft:flying_speed')` は `null`。`minecraft:movement` は付いています（既定 0.1）。

## SimulatedPlayer の移動は inputInfo に載らない — 1.26.51.1 で実測
`moveRelative` で動かしても `inputInfo.getMovementVector()` は `0,0` のまま。
入力許可（LateralMovement）を切っても SimulatedPlayer は動きます。
入力を読んで動く機能は、必ず `tags: ['real']` で確かめてください。

## トップレベルで弾かれる
`restricted-execution mode` と出たら、その処理を `system.run` かイベントの中へ移す。

## スペクテイターで発火するもの／しないもの — 1.26.51.1 で実測
ブロック破壊/設置・攻撃は起きません。**アイテム使用（itemUse）・スニーク・持ち物の変化・
ゲームモード変化は届きます**（SimulatedPlayer で実測。本物のクライアントでは未確認）。
確かめ方は `npm run skill スペクテイター` の測り方カードへ。

## 区画が無い
`LocationInUnloadedChunk` は読み込まれていない場所です。`tickingarea` の中（既定 0,0〜63,63）で試す。

## エンティティが消えている
tick をまたいだ参照は `isValid` を見る。見ないと `InvalidEntityError`。

## chatSend が無い
安定版 2.x にチャットのイベントはありません。`scriptevent` か自作コマンドを使う。

## 相対 import の拡張子
`import "./util"` は版によって `Import [./util] not found` になります。
`./util.js` まで書いてください。`npm run inspect -- --fix` で一括で直せます。

## 1.x のパックは 2.x の実機で読み込まれない
`manifest.json` の `@minecraft/server` が `1.x` のままだと、いまの実機は読み込みません。
古い `.mcaddon` が「何も起きない」ときは、まずここです。`npm run inspect` で分かります。

## BP が RP に依存しているのに RP が無い
`dependencies` に UUID 指定があるのに、その相手がワールドに入っていないと、
**BP ごと読み込まれません。**この仕組みは `.mcaddon` を取り込むとき RP も一緒に入れます。

## 直したのに変わらない
古いファイルが残っています。`npm run dev` はパックのフォルダを消してから入れ直すので、
それでも変わらないなら `import` のパスか `manifest` の `entry` を疑ってください。

## 何も起きていないように見える
`console.warn` を 1 行足して、その処理が呼ばれているかを先に確かめる。
呼ばれていないなら中身ではなく入口が悪い。

## eval で入れ替えると、本体と eval 版が同時に動く
`npm run check`（既定の eval）では、起動時に読まれたパック本体と、eval で入れた版の **2 つが同時に動きます**。console.warn が二重に出るので、仕様書でログの行数を数えるときは必ず数え違えます。さらに本体側からは SimulatedPlayer が見えません（getAllPlayers が 1 件返るのに、その中身は使えない）。実測: 同じ probe:status に対して `visible=0`（本体）と `visible=1`（eval 版）の 2 行が返りました。行数を数える仕様書は、最後の 1 回分だけを読むようにしてください。`npm run check -- --reload` なら本体だけになります。
確かめた実機: 1.26.51.1

## スペクテイターでも届くものがある（SimulatedPlayer 実測）
このファイルの「スペクテイターでは多くが発火しない」は言いすぎでした。SimulatedPlayer をスペクテイターにして測ると、`entityStartSneaking` / `entityStopSneaking` / `itemUse`（before と after）/ `playerInventoryItemChange` / `playerGameModeChange`（after）と、`isSneaking` の変化が届きます。届かなかったのは `playerButtonInput` と `inputInfo`（SimulatedPlayer はそもそも入力を送らないため）。本物のクライアントでどうなるかは別で、`tags: [real]` で確かめてください。測り方は addons/spectator_probe（`/scriptevent probe:start` → 操作 → `probe:report`）。
確かめた実機: 1.26.51.1

## playerGameModeChange の before は「変更前」のモードで届く
`world.beforeEvents.playerGameModeChange` のハンドラの中で `player.getGameMode()` を読むと、まだ **変更前** の値です（Creative→Spectator なら Creative）。after は変更後（Spectator）。「どのモードのときに届いたか」で分類する処理は、before と after で結果が変わります。
確かめた実機: 1.26.51.1

## beforeEvents.chatSend は beta を宣言すれば在る
このファイルの「安定版 2.x にチャットのイベントはありません」は条件つきです。manifest が `@minecraft/server` の beta（テンプレート既定の 2.11.0-beta）を宣言していれば、`world.beforeEvents.chatSend` も `afterEvents.chatSend` も `api.json` に在り、購読も通ります（1.26.51.1 で 42/42 購読成功）。安定版だけを宣言した場合は無いままです。発火するかどうかは別問題なので、使うなら仕様書を 1 本足して実機に読ませてください。
確かめた実機: 1.26.51.1

## 飛ばされた仕様書は通っていない
`real` は `bedrock-protocol` が無い環境では**落ちずに飛ばされ**、結果に「確かめていないもの」として残ります。`npm run status` では `－ 確かめていない N 本` の行です。**通ったものとして扱わないでください。**明示的に `npm run real` を叩いたときだけ、依存が無いことはそのまま失敗になります。
確かめた実機: 1.26.51.1
