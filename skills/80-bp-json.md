# 80. ビヘイビアパックの JSON

スクリプトから触るものだけ。正確な書式は `refs/schemas/`（Mojang 公式のスキーマ）を引いてください。

## エンティティ
`entities/<名前>.json`
```json
{
  "format_version": "1.21.0",
  "minecraft:entity": {
    "description": { "identifier": "myaddon:bot", "is_spawnable": true, "is_summonable": true },
    "components": {
      "minecraft:health": { "value": 20 },
      "minecraft:physics": {},
      "minecraft:collision_box": { "width": 0.6, "height": 1.8 }
    }
  }
}
```
- `identifier` は `名前空間:名前`。**バニラと同じ名前空間（`minecraft:`）を使わないでください**
- `is_summonable` が無いと `/summon` できません
- 見た目はリソースパック側（`entity/*.json`・`models/`・`textures/`）です。
  **BP だけ入れて RP を入れないと、湧いても見えません**

## アイテム・ブロック
`items/*.json` `blocks/*.json`。`format_version` はスキーマの版に合わせます。
古い `format_version` で書くと、新しい実機で components が無視されます。

## 正式な ID を調べる
記憶で書かないでください。`npm run refs` を実行すると `refs/vanilla/metadata/` に
ブロック・アイテム・エンティティの**正式な一覧**が入ります。

```sh
grep -i "netherite" refs/vanilla/metadata/vanilladata_modules/mojang-items.json
```

## スクリプトとつなぐ
JSON 側にタグやコンポーネントを付けておき、スクリプトからは `typeId` と `hasTag` で見分けます。

```js
if (entity.typeId === 'myaddon:bot' && entity.hasTag('active')) { … }
```

## 取り込んだ .mcaddon を直すとき
```sh
npm run inspect            # JSON の壊れ・identifier の重複・版の食い違いを見る
npm run inspect -- --fix   # 版と import の拡張子を直す
```
