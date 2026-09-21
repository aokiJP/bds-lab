# 50. SimulatedPlayer と本物のクライアント

この仕組みには、アドオンを動かす相手が 2 通りあります。**書き方は同じ `t` です。**

| | sim（既定） | real（`tags: ['real']`） |
|---|---|---|
| 誰 | サーバーの中の SimulatedPlayer | ネットワーク越しの本物のクライアント |
| 速さ | 数秒 | 十数秒〜 |
| 分かること | API の実在・例外・状態・コンポーネント・ログ | クライアントが送る入力、当たり判定、見え方に効くもの |
| 要るもの | なし | `bedrock-protocol`（npm から自動で入る） |

```sh
npm run check            # sim だけ
npm run real             # tags: ['real'] だけを、本物のクライアントで
npm run real -- --all    # 全部の仕様書を、本物のクライアント越しで
```

## SimulatedPlayer
`@minecraft/server-gametest` の `spawnSimulatedPlayer` で作ります。
この仕組みでは `t.spawn()` がそれです。

できること: 移動・向き・ジャンプ・スニーク・攻撃・アイテム使用・ブロック破壊・コマンド。
できないこと: **入力として読まれること**（`41-input-camera.md`）、画面の操作。

## 両方で使える道具（`types/spec.d.ts` が正）
| `t` | sim | real |
|---|---|---|
| `t.spawn()` | SimulatedPlayer を作る | 仕切り直し |
| `t.move(x, y)` `t.look(yaw, pitch)` `t.jump()` `t.sneak(on)` | サーバー側で動かす | クライアントが入力を送る |
| `t.read('location' \| 'velocity' \| 'movementVector' \| …)` | 実機の中の本当の値 | **同じ**（値は必ず実機が読む） |
| `t.entities(type, radius)` | 実機の中の一覧 | 同じ |
| `t.attack(type)` | `attackEntity` | クライアントが殴る |
| `t.use()` `t.dig(at)` | サーバー側 | クライアント側 |
| `t.give(item, n)` `t.setBlock(at, block)` `t.health()` | コマンド / API | 同じ |
| `t.cmd()` `t.send()` `t.note()` `t.expect*()` | 同じ | 同じ |

**値はいつもサーバーの中で読みます。**入力だけが sim か real かで変わります。
だから「sim で通るのに real で落ちる」ときは、原因はいつも**入力の通り道**にあります。

## 書き分け
```js
export default [
  { name: '…', async run(t) { /* sim */ } },
  { name: '…', tags: ['real'], async run(t) { /* real */ } },
  { name: '…', tags: ['sim', 'real'], async run(t) { /* 両方で流れる */ } },
];
```
