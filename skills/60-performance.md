# 60. 速さ

## 1 tick の予算
1 tick は 50ms です。スクリプトがそこを食い潰すと、実機全体が遅れます。
`runInterval(fn, 1)` の中で 100 体をなめるような書き方は、それだけで破綻します。

## 重い処理は runJob で割る
```js
function* rebuild() {
  for (const pos of everyBlock) {
    dimension.setBlockType(pos, 'minecraft:stone');
    yield;                     // ここで tick を返す
  }
}
system.runJob(rebuild());
```
`yield` のたびに実機へ制御が戻ります。1 万ブロック置いても止まりません。

## 効く順に
1. **購読を絞る**（`{ entityTypes: [...] }` `{ namespaces: [...] }`）。受けてから捨てるのが一番もったいない
2. **`getEntities` を毎 tick 呼ばない**。5 tick ごと、範囲は最小に
3. **結果を持ち回す**。同じ `getComponent` を 1 tick に何度も呼ばない
4. **分割する**。20 体を毎 tick より、4 体ずつ 5 tick
5. **文字列を作らない**。`console.warn` をループの中で呼ばない

## 測る
```js
const t0 = Date.now();
… 
console.warn(`TAG ms=${Date.now() - t0}`);
```
仕様書からは `lab.metric('ms', n)` で、結果に数値として残せます。
前回との差は `.bds-lab/report.json` の `diff` に出ます。

## 実機の起動も速くする
この仕組みは、一度作った世界を `.bds-lab/world-cache/` に取っておきます。
2 回目からは実機の起動が 1 回で済みます（初回だけ 2 回）。
世界を作り直したいときは、そのフォルダを消してください。
