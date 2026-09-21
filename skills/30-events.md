# 30. イベント

## 2 種類
| | `beforeEvents` | `afterEvents` |
|---|---|---|
| いつ | 起きる**前** | 起きた**後** |
| 止められるか | `ev.cancel = true` で止められる | 止められない |
| 中でできること | **読むだけ。**ワールドを書き換えると弾かれる | 何でも |

`beforeEvents` の中で書き換えたいときは、`system.run(() => …)` で次の tick に逃がします。

```js
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (ev.block.typeId !== 'minecraft:bedrock') return;
  ev.cancel = true;                                   // ここまでは読むだけ
  system.run(() => ev.player.sendMessage('だめ'));     // 書き換えは次の tick
});
```

## 購読と解除
```js
const handle = world.afterEvents.entityHurt.subscribe(onHurt);
world.afterEvents.entityHurt.unsubscribe(handle);
```

**解除を忘れると、`/reload` のたびに増えます。**
同じ処理が 2 回走る・だんだん重くなる、は大体これです。

## 絞る
購読するときに絞れるものがあります。全部受けてから `if` で捨てるより、ずっと軽いです。

```js
world.afterEvents.entitySpawn.subscribe(fn, { entityTypes: ['minecraft:zombie'] });
system.afterEvents.scriptEventReceive.subscribe(fn, { namespaces: ['myaddon'] });
```

## よく使うもの
| 名前 | いつ |
|---|---|
| `world.afterEvents.playerSpawn` | 入ったとき・生き返ったとき（`ev.initialSpawn`） |
| `world.afterEvents.entityHurt` | 傷ついたとき（`ev.damageSource`） |
| `world.afterEvents.entityDie` | 死んだとき |
| `world.afterEvents.playerBreakBlock` | 壊したあと |
| `world.beforeEvents.itemUse` | 使う前（止められる） |
| `world.afterEvents.playerGameModeChange` | ゲームモードが変わったとき |
| `system.afterEvents.scriptEventReceive` | `/scriptevent` が来たとき |

**`chatSend` は 2.x にありません。**チャットを入口にしないでください（`31-scriptevent.md`）。

`ev.player` や `ev.entity` は `undefined` のことがあります。**必ず見てから使ってください。**
