# 22. コンポーネント

エンティティの「持ち物」や「体力」のような、付いていたり付いていなかったりするものです。

```js
const hp = entity.getComponent('minecraft:health');
if (hp) console.warn(`TAG hp=${hp.currentValue}/${hp.effectiveMax}`);
```

**`getComponent` は `system.run` かイベントの中で呼んでください。**トップレベルは弾かれます。

## よく使うもの
| id | 読むもの |
|---|---|
| `minecraft:health` | `currentValue` / `effectiveMax` / `setCurrentValue()` |
| `minecraft:inventory` | `container`（`getItem(i)` / `setItem(i, stack)` / `size`） |
| `minecraft:equippable` | 装備（`getEquipment(slot)`） |
| `minecraft:movement` | 移動の速さ（プレイヤーは既定 0.1） |
| `minecraft:rideable` | 乗る・乗せる |
| `minecraft:projectile` | 矢などの飛び方 |

**`minecraft:flying_speed` はプレイヤーに付いていません**（`getComponent` は `null`）。
飛行の速さを変える手としては使えません。1.26.51.1 で実測。

## 付いているかを先に確かめる
版によって付いたり消えたりします。**必ず `null` を見てください。**

```js
const c = entity.getComponent('minecraft:movement');
if (!c) { console.warn('TAG movement なし'); return; }
```

この実機に何が在るかは `.bds-lab/api.json` に書き出されています。
仕様書からは `t.component('minecraft:health')` で実機に直接聞けます。
