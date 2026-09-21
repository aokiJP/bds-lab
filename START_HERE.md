# START_HERE.md — この zip を受け取った AI がすること

Minecraft 統合版のアドオンを作ります。実機の Bedrock Dedicated Server で自動検証できます。
**決まりごとは `AGENTS.md`（40 行）です。ここは順番だけ。**

人からは「作りたいもの」が日本語で伝えられます。確認を求めず、最後まで進めてください。

## 1. 依頼書を書く

`addons/<名前>/TASK.md`。`<名前>` は英数字と `_` だけ。

```markdown
# 依頼書 — <名前>
## 作るもの
（1 段落。何が、どう動けば「できた」なのか）
## 受け入れ条件
- [ ] 実機で確かめられる形で。「なめらか」は不可、「20 tick で 12 ブロック以上進む」は可
## やってはいけないこと
```

あいまいなら、あなたが数値に落とす。推測した箇所は `## 推測した点` に残し、実機に確かめさせる。

## 2. 作って、確かめて、直す

```sh
npm start                 # 用意（実機・型定義・枝）から検証まで
npm run selftest          # 仕組みが壊れていないか（実機もネットワークも不要）
npm run fix               # 実機を上げずに直せるものを直す
npm test                  # 実機で確かめる
npm run status            # 結果を 40 行で見る → 最初の ✘ だけ直す
npm run real -- --all     # 仕上げ。本物のクライアント越しで全部の仕様書を流す
```

`specs/<名前>.spec.mjs` に、受け入れ条件 1 つにつき 1 本。書き方は `types/spec.d.ts`。
API の名前と引数は `npm run api -- <名前>` で確かめる（`types/minecraft/*.d.ts` 全文は読まない）。

## 3. 出す

```sh
npm run ship      # .mcaddon にして Release を更新する（private）
npm run publish   # アドオンだけを public に出す
```

## 実機に何かを伝えたいとき

```js
import { lab } from './lab.js';
lab.note('Δy=1.203');          // 検証の結果に 1 行残る
lab.metric('speed', 0.6);      // 値として残る
lab.fail('上昇していない');      // その仕様書を落とす
lab.command('tp @s 0 -50 0');  // コンソール権限でコマンド
lab.save('dump.txt', '…');     // .bds-lab/from-addon/ に書き出す
```

## 手元で AI の CLI が使えないとき

```sh
npm run prompt              # .bds-lab/handoff/ に指示文と zip ができる
npm run cycle -- <返信.zip>  # 取り込み、検証し、次の指示文を作る
```

返信は**アドオンのフォルダごと**。動かない中身（構文エラー・「以下同じ」）は取り込む前に弾かれ、
いまのアドオンはそのまま残ります。

## 分かったことを残す

```sh
npm run skill -- "見出し" --to pitfall --body "分かったこと。<版> で実測"
```

`vendor/bedrock-server.zip` は Minecraft の利用規約により再配布できません。public には置かないでください。
