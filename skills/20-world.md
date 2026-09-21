# 20. world と dimension

## 入口
```js
import { world, system } from '@minecraft/server';

const overworld = world.getDimension('overworld');   // 'nether' / 'the_end'
```

`world` は 1 つだけ。`dimension` は座標を持つ世界です。ブロックもエンティティも dimension から触ります。

## 座標
`{ x, y, z }` の素のオブジェクトです。クラスではありません。
足す・引くは自分で書くか、`@minecraft/math` の `Vector3Utils` を使います。

- プレイヤーの `location` は**足の位置**。目線は約 +1.62
- ブロックの座標は整数。`Math.floor` してから使う
- `getBlock` は**読み込まれていない区画では例外**（`LocationInUnloadedChunk`）

```js
system.run(() => {
  const block = overworld.getBlock({ x: 0, y: -60, z: 0 });
  if (!block) return;                    // 読み込まれていなければ undefined
  console.warn(`TAG block=${block.typeId}`);
});
```

検証では原点まわりに `tickingarea` を張ってあります（既定 0,0 〜 63,63）。
**その外を触ると落ちます。**場面はこの中に作ってください。

## 置く・壊す
```js
overworld.setBlockType({ x: 0, y: -59, z: 0 }, 'minecraft:stone');
overworld.getBlock(pos)?.setPermutation(perm);
```

## エンティティを探す
```js
const list = overworld.getEntities({ location: pos, maxDistance: 16, type: 'minecraft:zombie' });
```
`getEntities` は**呼ぶたびに配列を作ります。**毎 tick で広い範囲を舐めないでください。

## 保存する
```js
world.setDynamicProperty('score', 12);
const n = world.getDynamicProperty('score');
```
エンティティごとにも持てます（`entity.setDynamicProperty`）。
文字列・数値・真偽・`Vector3` が入ります。大きい物は JSON にして入れますが、**上限があります**。
