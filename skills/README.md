# skills — ScriptAPI で作るための手引き

Minecraft 統合版の **ScriptAPI（`@minecraft/server` ほか）** に絞った手引きです。
ビヘイビアパックの JSON も、スクリプトから触るところだけ扱います。

## 引き方（この順に見る）

1. **`10` 〜 `60`** — やりたいことに近い番号を開く。設計と、実機で通る書き方が載っています
2. **`70-pitfalls.md`** — 動かないときはここ。**実機で実測した**ものだけを載せています
3. **`types/minecraft/*.d.ts`** — 引数と戻り値の正。記憶で書かない
4. **`.bds-lab/api.json`** — **この実機に実在する** API。型定義にあっても実機に無いことがあります
5. **`refs/`** — 公式の一次資料（`npm run refs` で GitHub から取り込む）。`90-sources.md` に何がどこにあるか

ここに書いてあるコードも、**そのまま信じないでください。**
版で変わります。必ず 3 と 4 で照合してから書いてください。

| 番号 | 中身 |
|---|---|
| `10-runtime.md` | 実行環境・起動の順番・`system` の使い分け |
| `11-modules.md` | モジュールと版。`manifest.json` の書き方 |
| `20-world.md` | world / dimension / ブロック・座標 |
| `21-entity.md` | エンティティとプレイヤー |
| `22-components.md` | コンポーネント（体力・持ち物・移動など） |
| `30-events.md` | before / after イベント、購読と解除 |
| `31-scriptevent.md` | 外から呼ぶ入口（`/scriptevent`）とカスタムコマンド |
| `40-ui.md` | `@minecraft/server-ui` のフォーム |
| `41-input-camera.md` | 入力の読み取り・入力許可・カメラ |
| `50-gametest.md` | SimulatedPlayer と本物のクライアント |
| `60-performance.md` | 1 tick の予算・`runJob`・重い処理の分け方 |
| `70-pitfalls.md` | 実機で踏んだ落とし穴（版つき） |
| `80-bp-json.md` | エンティティ・アイテム・ブロックの JSON |
| `90-sources.md` | 出どころ（GitHub の公式リポジトリ） |

## 足す

実機でしか分からなかったことは、必ず残してください。

```sh
npm run skill -- "見出し" --to pitfall --body "分かったこと。1.26.51.1 で実測"
```
