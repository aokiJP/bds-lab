# 90. 出どころ

ここに書いてあることの元です。**公式（Mojang / Microsoft）を大前提**にしています。
`npm run refs` で、GitHub から手元の `refs/` に取り込めます（ネットワークと git が要ります）。

## 取り込むもの（`npm run refs`）
| 置き場 | 何 | 出どころ |
|---|---|---|
| `refs/vanilla/` | バニラの正式な ID 一覧（ブロック・アイテム・エンティティ） | `Mojang/bedrock-samples` |
| `refs/schemas/` | BP の JSON スキーマ | `Mojang/bedrock-schemas` |
| `refs/libs/` | `@minecraft/math` `@minecraft/vanilla-data` の実装 | `Mojang/minecraft-scripting-libraries` |
| `refs/docs/` | 公式ドキュメントの原文（ScriptAPI のリファレンス） | `MicrosoftDocs/minecraft-creator` |
| `refs/samples/` | 動く最小構成・書き方の見本 | `microsoft/minecraft-scripting-samples` |
| `refs/gametests/` | GameTest の実例（SimulatedPlayer の使い方） | `microsoft/minecraft-gametests` |
| `refs/wiki/` | 有志の解説（補足） | `Bedrock-OSS/bedrock-wiki` |

個別に取るなら `npm run refs -- --only docs` のように指定します。

## 同梱しているもの（取り込み不要）
| 置き場 | 何 |
|---|---|
| `types/minecraft/*.d.ts` | 公式の型定義。`npm run docs` で npm の registry から直接取ります |
| `types/minecraft/VERSIONS.md` | その型定義がどの版か |
| `.bds-lab/api.json` | **この実機に実在する** API の一覧。`npm run check` が毎回書き出します |
| `data/minecraft-modules.json` | モジュールの版の一覧。`npm run update` で最新に |
| `data/bds-versions.json` | BDS の版の一覧。同上 |

## 公式の読み物（ネットの先）
- ScriptAPI リファレンス — https://learn.microsoft.com/minecraft/creator/scriptapi/
- 版ごとの対応表 — https://learn.microsoft.com/minecraft/creator/documents/scripting/versioning
- 2.x での変更点 — https://learn.microsoft.com/minecraft/creator/documents/scripting/v2-overview
- 実行環境で使えるもの（有志） — https://wiki.bedrock.dev/scripting/api-environment
- 版ごとの型定義（有志のまとめ） — https://jaylydev.github.io/scriptapi-docs/

## 順番
迷ったら **`api.json` →型定義→ `refs/docs` →このスキル→ネットの記事** の順です。
記事はいちばん最後です。版で変わるので、実機で確かめるまで信じないでください。
