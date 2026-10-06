# ts_repl

## Request
TS REPL v6.11.0（ゲームの中で TypeScript / JavaScript を書いてその場で動かすエディタ）を、便利系アドオンとして bds-lab の BDS で動かす。

## Acceptance (one tests.txt `## ` section each)
- [x] BDS で読み込まれ、初めての人に /function tsrepl_start を案内する
- [x] /function tsrepl_start でコンソールが渡り、ワークベンチが開く
- [x] /function tsrepl_doctor で本人に診断が返る

## Changes
- 2026-10-02 bp/items/console.json: "minecraft:foil"（1.21.120 の形式には無く、無視されていた）→ "minecraft:glint"（コンソールが光る）

- 2026-10-02 bds-lab から外で動かすための変更（`lab/patch.py`、bp/scripts/main.js と source/src に同じものを当てる。何度当てても同じ）:
  BDS のコンソールからの AI ブリッジ要求は持ち主として受ける（スイッチ・トークン不要。プレイヤーやコマンドブロックからは従来どおり）／
  誰もいなくても eval はサーバーとして動く／`slot` ごとに常駐（subscribe・runInterval）を持ち、同じ slot の再実行はその分だけ入れ替える・
  `stop` で外す／常駐が後から出すログは `[tsrepl:slot:<名前>]` で内容ログへ／ブリッジの save・trigger・delete はその場でトリガーを付け直す
  （/reload 不要）／保存のたびに時刻を付け list に出す（同期で変化が分かる）／**不具合修正**: BDS 1.26.52 では world.afterEvents が
  書き換え不可の自前プロパティのため、`import { world }` からの購読がすべて「TypeError: proxy: inconsistent get」で落ちていた
  （購読を見張る Proxy を同じ型の空オブジェクトの上に立てた）

## Notes
- `bp/` `rp/` は配布物（TS-REPL-v6_011_0.mcaddon）そのもの。上流のソース（v6.11.0、`source/`）は配布物と重複するので持たない（`lab/patch.py` は bundle だけに当てる）。
- BDS では `@minecraft/common` を使うため、ラボは試験のたびにサーバーの permissions.json にそれを足す（本番の BDS でも
  `config/default/permissions.json` の allowed_modules に "@minecraft/common" が要る。`node lab.mjs deploy <BDS>` がそれも書く）。
- 便利系アドオン（common/data/samples.json `utility`）: ラボの遊ぶためのサーバー（up/live/serve）と `deploy` で既定で入る。
- テストは 5 節: 読み込み・はじめる・診断・コンソールのアイテム・スクリプトブロック（2026-10-02 に後ろの 2 つを足した。go の S 行）。
- scan の RISK（eval・難読化・/kick /connect）は REPL として当然のもの（書いたコードを動かす）。人が使うサーバーでは権限を絞って使う。
