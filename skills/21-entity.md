# 21. エンティティとプレイヤー

## 取り方
```js
const players = world.getAllPlayers().filter(Boolean);   // ← filter は必須。10-70 を見ること
const one = players.find((p) => p.name === 'Steve');
```

`Player` は `Entity` を継承しています。`Entity` に出来ることは全部出来ます。

## よく使うもの
| したいこと | 書き方 |
|---|---|
| 位置 | `entity.location` |
| 向き | `entity.getRotation()` → `{ x: ピッチ, y: ヨー }` |
| 見ている向き | `entity.getViewDirection()` → 単位ベクトル |
| 速度 | `entity.getVelocity()` |
| 飛ばす | `entity.applyImpulse(v)` / `entity.applyKnockback(...)` |
| 飛ばす（プレイヤー） | プレイヤーには `applyImpulse` が効きません。`knockback` 系を使う |
| 移動 | `entity.teleport(at, { rotation })` |
| 種類 | `entity.typeId`（`minecraft:zombie`） |
| 名前 | `entity.nameTag`（見える名前）/ `player.name`（本名） |
| 生きているか | `entity.isValid`（**tick をまたいだ参照は必ず見る**） |
| コマンド | `entity.runCommand('say hi')` → `{ successCount }` |
| タグ | `entity.addTag('x')` / `hasTag` / `removeTag` |

## tick をまたぐ
エンティティの参照は、次の tick には**もう無効かもしれません。**

```js
const target = ...;
system.runTimeout(() => {
  if (!target.isValid) return;     // これを書かないと InvalidEntityError
  target.applyImpulse({ x: 0, y: 1, z: 0 });
}, 20);
```

保持したいなら、参照ではなく `entity.id`（文字列）を持ち、使うときに引き直してください。

## 湧かせる
```js
const e = overworld.spawnEntity('minecraft:zombie', { x: 0, y: -59, z: 0 });
```
自作のエンティティは、先に `entities/*.json` を書いて BP に入れておきます（`80-bp-json.md`）。

## 落とし穴
- `getAllPlayers()` は `undefined` を混ぜることがあります（`70-pitfalls.md`）
- スペクテイターでは、攻撃・設置・破壊・相互作用が**起きません**
- プレイヤーを消す API はありません。`player.kick` か、ゲームモードで縛ります
