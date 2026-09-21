# 11. モジュールと版

## manifest.json
```json
{
  "format_version": 2,
  "header": { "name": "…", "uuid": "…", "version": [0, 1, 0], "min_engine_version": [1, 21, 30] },
  "capabilities": ["script_eval"],
  "modules": [
    { "type": "script", "language": "javascript", "uuid": "…", "version": [0, 1, 0], "entry": "scripts/main.js" }
  ],
  "dependencies": [
    { "module_name": "@minecraft/server", "version": "2.10.0" },
    { "module_name": "@minecraft/server-ui", "version": "2.2.0" }
  ]
}
```

- `uuid` は**パックごと・モジュールごとに別のもの**。使い回すと読み込まれません
- `entry` は `scripts/` から始まる相対パス
- `capabilities: ["script_eval"]` を入れると `new Function` が通ります（入れ替えが 1 秒以下になります）

## 版の系統
| 書き方 | 意味 |
|---|---|
| `2.10.0` | 安定版。ワールドの設定は不要 |
| `2.11.0-beta` | beta。**ワールドで Beta APIs（実験機能）を有効にしないと読み込まれません** |

`1.x` と `2.x` は別物です。**`1.x` を書いたパックは、`2.x` しか載っていない実機では読み込まれません。**
古い `.mcaddon` を動かすときは、まずここを疑ってください。

```sh
npm run inspect            # 版の食い違いを、実機を上げずに見つける
npm run inspect -- --fix   # いまの実機に載っている版に書き換える
npm run update             # 版の一覧そのものを最新にする
```

## どのモジュールがあるか
| モジュール | 何 |
|---|---|
| `@minecraft/server` | 本体。world / dimension / entity / block / item |
| `@minecraft/server-ui` | プレイヤーに出すフォーム |
| `@minecraft/server-gametest` | SimulatedPlayer と GameTest（beta のみ） |
| `@minecraft/server-net` | 外への HTTP（BDS 限定・`allow-outbound-script-debugging` などの設定が要る） |
| `@minecraft/server-admin` | サーバーの秘密情報（BDS 限定） |
| `@minecraft/math` `@minecraft/vanilla-data` | Mojang 公開のライブラリ。npm から取って同梱する |

この実機にどれが載っているかは `.bds-lab/api.json` に出ます。`npm run check` で書き出されます。
