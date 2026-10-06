# bedrock-binary

Minecraft Bedrock の実行ファイル（BDS・Android クライアント）から、公式ドキュメントに無い定義を取り出す（v2.3.0、Node.js 20+、依存ゼロ）。
bds-lab では `node lab.mjs bb ...` がこれを使う（結果はラボのキャッシュ `<lab>/.lab/bb/` に版ごとに残り、リポジトリには置かない）。

- パケット ID（各パケットクラスの `getId()` の機械語から読む。enum の並びは ID ではない）・切断理由などの enum
- 公式メタデータに無いコマンド、`/connect`（WSS）のイベントが実際に発火するか、パーティクル・ダメージ原因などの内部 ID

単体でも動く:

```
npm run bb -- help                       すべてのコマンド（各コマンドに --help）
npm start                                最新の BDS を取得 → 解析 → site/index.html と site/metadata/
npm run bb -- enum <profile> [名前]       enum を調べる
npm run bb -- diff <前の profile> <後>    2 つの版の差
npm run bb -- apk <APK のフォルダ> --scan  Android 版を解析
npm test                                 合成 ELF / APK でのテスト（ゲームのバイナリ不要）
```

信頼性: 版ごとに先頭の値を照合し、合わないモジュールは出さない（理由は `version.json`）。番号には根拠 `id_basis` が付き、飛び番の enum には番号を付けない。
`data/enum-names.json` は型名の辞書（型名の消えたビルドに中身で名前を当てる。`npm run bb -- names` で作り直す）。
