# 10. 実行環境と起動の順番

## どこで動くのか
ビヘイビアパックの `manifest.json` に `script` モジュールを書くと、
そのパックが読み込まれたワールドで、**サーバー側の 1 つの JS 環境**として動きます。
ブラウザでも Node でもありません。`fetch` も `setTimeout` も `require` もありません。

使えるのは次だけです。
- ECMAScript の標準（`Math` `JSON` `Map` `Set` `Promise` `async/await` `Proxy 以外`）
- `console.warn` / `console.error`（`console.log` は実機のログに出ません）
- `import` した `@minecraft/*` のモジュール

## 起動の順番（ここを外すと必ず落ちる）
1. スクリプトのトップレベルが走る
2. ワールドが読み込まれる
3. 以降、毎 tick（1 秒に 20 回）

**トップレベルでワールドを触ってはいけません。**
`restricted-execution mode` や `early-execution` で弾かれます。
やっていいのは「購読を張ること」と「定数を作ること」だけです。

```js
import { world, system } from '@minecraft/server';

// ✗ トップレベルでワールドを触る
// world.getDimension('overworld').getBlock({ x: 0, y: 0, z: 0 });

// ✓ 1 tick 後か、イベントの中で触る
system.run(() => {
  world.getDimension('overworld').getBlock({ x: 0, y: 0, z: 0 });
});
```

## system の使い分け
| やりたいこと | 使うもの |
|---|---|
| 次の tick に 1 回 | `system.run(fn)` |
| n tick 後に 1 回 | `system.runTimeout(fn, n)` |
| n tick ごとに繰り返す | `system.runInterval(fn, n)` |
| 止める | `system.clearRun(id)` |
| 重い処理を tick をまたいで少しずつ | `system.runJob(generatorFn())` |
| いまの tick 番号 | `system.currentTick` |

`runInterval(fn, 1)` は毎 tick です。**必ず中身を軽くしてください。**
20 体ぶんの処理を毎 tick 回すより、5 tick ごとに 4 体ずつのほうが速いことがよくあります。

## 読み込み直し
`/reload` でスクリプトが入れ直されますが、**購読は自動では外れません。**
入れ直すたびに二重・三重に張られ、症状が「だんだん重くなる」形で出ます。
購読はモジュールの先頭で 1 回だけ張り、同じ処理を 2 か所から張らないでください。

## 確かめ方
```js
console.warn(`TAG loaded v0.1.0`);     // 読み込まれたことを 1 行残す
```
仕様書（`specs/`）はこの行を見て合否を決めます。状態が変わったら必ず 1 行出してください。
