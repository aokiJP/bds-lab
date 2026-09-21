# 41. 入力とカメラ

## 入力を読む
```js
const v = player.inputInfo.getMovementVector();        // { x: 左右, y: 前後 }
const jump = player.inputInfo.getButtonState(InputButton.Jump);   // Pressed / Released
```

**符号は必ず実機で測ってください。**記事と食い違います。
仕様書に 1 本足して `t.note()` で出し、結果を見てから決めます。

```js
// specs/ の中
const mv = await t.read('movementVector');
t.note(`前進中: x=${mv.x} y=${mv.y}`);
```

## 入力を止める
```js
player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
```
カテゴリは版で増減します。`api.json` で在るものを確かめてください。

**SimulatedPlayer には効きません。**入力許可を切っても `moveRelative` で動きます。
入力まわりは必ず `tags: ['real']` の仕様書で確かめてください。

## カメラ
```js
player.camera.setFov(70);          // 範囲は [30, 110]。外すと落ちる（1.26.51.1 で実測）
player.camera.setCamera('minecraft:free', { location, rotation, easeOptions });
player.camera.clear();
```

`minecraft:free` は自由視点です。プレイヤー本体は動きません。
本体も動かしたいなら `teleport` と組み合わせます。

## SimulatedPlayer では確かめられないこと
| | sim | real |
|---|---|---|
| `moveRelative` で動く | ○ | －（クライアントが入力を送る） |
| `inputInfo` に載る | **×（0,0 のまま）** | ○ |
| 入力許可が効く | **×** | ○ |
| カメラの見え方 | 値は読める | 実際の見え方まで |

入力を読んで動く機能は、**必ず real で 1 本**通してください。

## スペクテイター中に読める入力の一覧（測り方つき）
「何が読めるか」を毎回手で確かめる代わりに、addons/spectator_probe を入れて `/scriptevent probe:start` → 操作 → `/scriptevent probe:report` を打つと、入力系イベント 42 本と状態 45 項目について ✔（スペクテイターで届いた）/ △（他のモードでだけ）/ ✘（届かず）の一覧が出ます。`probe:dump` は今の全ての値を 1 行の JSON で、`probe:perm` は入力許可 11 カテゴリを順に無効→有効にして届き方を見ます。`probe:coverage` は、その版で増えたイベントの取りこぼしを教えます。
確かめた実機: 1.26.51.1
