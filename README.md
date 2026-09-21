# bds-lab

Minecraft 統合版の**ビヘイビアパック**を、実機の Bedrock Dedicated Server で確かめながら作るテンプレートです。
リソースパック（見た目・音）は扱いません。
AI に書かせ、実機で検証し、直させる。人がやるのは **作りたいものを伝えることだけ** です。

## 使い方

1. Releases から最新の zip を取る（最新の BDS が同梱されています）
2. その zip を AI に渡し、作りたいものを日本語で伝える
3. AI が `START_HERE.md` に従って、仕様書を書き、枝を作り、コードを書き、実機で検証し、直す

人が触るのは zip とプロンプトだけです。

## 自分で動かす場合

```sh
npm install
npm start
```

「何を作りますか」と聞かれるので、日本語で答えてください。そのあとは自動です。
実機の用意、リポジトリの作成、枝の作成、AI による実装と検証まで進みます。

聞かれずに進めたいときは次のように渡せます。

```sh
npm start -- --want "スペクテイターで自由に飛べるカメラ"
```

どのコマンドも、アドオンがまだ無ければこの手順に自動で戻ります。順番を覚える必要はありません。

## 覚えるのは 6 つ

```sh
npm start                             # 作る（何を作るか日本語で答えるだけ）
npm test                              # 実機で確かめる（-- --watch で保存のたびに）
npm run status                        # 前回の結果を 40 行で見る（-- --full で全部）
npm run api -- Player.setGameMode     # API を引く（-- --find <語> で探す）
npm run fix                           # 実機を上げずに直せるものを直す
npm run ship                          # .mcaddon にして出す
```

うまくいかないときは `npm run doctor`、全部のコマンドは `npm run help -- --all`。
`npm run skill <語>` で、実測した落とし穴を語から引けます。

## 既にある .mcaddon を持ち込む

```sh
npm run import -- ~/Downloads/something.mcaddon
npm run inspect -- --fix        # 版の食い違い・import の拡張子・script_eval を直す
npm run check                   # 実機で動かす
npm run real -- --all           # 本物のクライアント越しでも通るか
```

ビヘイビアパックとリソースパックを分けて置き、**両方をワールドに入れて**起動します。
BP が RP の UUID に依存している .mcaddon（よくある形）も、そのまま実機に載ります。

検証は 2 通りの相手で流せます。書き方はどちらも同じ `t` です。

| | sim | real |
|---|---|---|
| 誰 | サーバーの中の SimulatedPlayer | ネットワーク越しの本物のクライアント |
| 入力 | サーバー側で動かす | クライアントが `PlayerAuthInput` を送る |
| 値 | 実機の中で読む | **同じ**（読むのはいつも実機） |
| 使える道具 | `t.move` `t.attack` `t.use` `t.dig` `t.entities` `t.give` `t.setBlock` `t.health` … | 同じ名前で同じ意味 |

## 要るもの

- Node 20 以上
- GitHub のアカウントと `gh`（`brew install gh`）。private リポジトリを使います
- macOS ではコンテナ（OrbStack か Docker Desktop）。Linux 版の BDS をその中で動かします
- BDS の zip（90MB 前後）を GitHub にも置くなら `git-lfs`（`brew install git-lfs`）。無くても手元の検証は動きます

### つまずきやすいところ

| 症状 | 理由と直し方 |
| --- | --- |
| `pnpm run ...` が別の場所の依存を見る | 親の階層に `pnpm-lock.yaml` があると pnpm はそちらを根と見ます。`npm run ...` を使ってください（この道具の内部の取得は npm に `--prefix` を渡して固定してあります） |
| 型定義が入らない | `npm run docs`。registry から `.tgz` を直接取るので、パッケージマネージャの事情には左右されません。ネットワークが無いときだけ失敗します |
| BDS が GitHub に載らない | 45MB を超えていて `git-lfs` が無いときは、わざと載せません。手元の検証には要りません。GitHub 上の CI でも動かすなら `git-lfs` を入れてください |
| real の本が「飛ばした」になる | `bedrock-protocol` が入らない環境です。落ちたのではありません。確かめるには `npm run real`（ネットワークが要ります） |
| 仕組み自体が壊れていないか見たい | `npm run selftest`（実機もネットワークも要らない 29 項目） |
| 取り込んだ .mcaddon が実機で「何も起きない」 | `npm run inspect`。`@minecraft/server` が `1.x` のままだと、いまの実機は読み込みません |
| 実機の起動が遅い | 2 回目からは `.bds-lab/world-cache/` を使って 1 回で上がります。作り直すならそのフォルダを消してください |
| `AI の CLI が見つかりません` で止まる | 異常ではありません。`.bds-lab/handoff/handoff-NN.zip` が出来ているので、それを AI に渡し、返信を `npm run cycle -- <返信.zip>` に食わせてください |
| zip が大きすぎて AI に上げられない | `npm run prompt -- --no-bds`（実機抜き・数百 KB） |
| プロジェクトが重い／どこかに送りたい・バックアップしたい | `npm run archive`（node_modules と展開済みの実機を消して、残りを zip に。`.bds-lab/archive/` に出ます） |

## 誰が動かすのか

| | SimulatedPlayer | RealPlayer |
|---|---|---|
| どこに居る | サーバーの中（偽のプレイヤー） | ネットワーク越し（本物のクライアント） |
| 速さ | 数秒 | 1〜2 分 |
| 分かること | API の実在・例外・状態・コンポーネント | **クライアントが送る入力**（移動ベクトル・Jump/Sneak・入力許可の効き方） |
| 仕様書 | 既定 | `tags: ['real']` を付ける |

```sh
npm run real      # tags: ['real'] の仕様書だけを本物のクライアントで流す
```

**`npm run auto` は毎回どちらも流します。** sim が通ったその場で、同じ実機に本物のクライアントが
入り、real の仕様書を流します。落ちればその理由が次の指示文に載り、AI が直します。
実機は 1 台のままなので、増えるのは接続の数秒だけです（`-- --no-real` で止められます）。

実機は `transport=raknet` を強制するので、この版でも RakNet で入れます。起動時に
「NetherNet を使え」と警告は出ますが、RakNet の口は開いたままです。

入力（移動ベクトル・Jump/Sneak・入力許可の効き方）は sim では再現されません。
そこを確かめられるのは real だけです。

## 仕組み

実機を 1 回だけ起動し、そのまま上げっぱなしにします。コードを直すたびに入れ替えて、
`specs/` に書いた条件を実機で流します。1 サイクルは数秒です。

`main` はテンプレートのままにします。アドオンは `addon/<名前>` の枝にだけ置くので、
GitHub の「Use this template」で複製すると、きれいな状態から始められます。

BDS の zip はリポジトリに直接コミットします。CI がそれを使うので、毎回のダウンロードが要りません。
再配布は Minecraft の利用規約で認められていないため、private なリポジトリでのみ動きます。

## GitHub の扱い

手元の中身が正で、GitHub はその写しです。**合流（merge / rebase）は一切しません。**
以前は合流に失敗すると作業ファイルに衝突マーカーが残り、道具自体が動かなくなっていました。

- 同じ名前の private リポジトリが既にあり、それがこの道具で作ったものなら、そのまま使って上書きします
- この道具が作ったものでなければ、`名前-2` のように別の名前で新しく作ります。既存の中身には触れません
- 合流あとが残っていたら、`npm start` が片づけてから進みます

## Release の持ち方

枝ごとに Release を 1 つだけ作り、以後は更新し続けます。

| 枝 | Release | 置くもの |
|---|---|---|
| `main` | `template` | 作業用の zip（最新の BDS 同梱）だけ |
| `addon/<名前>` | `addon-<名前>` | 最新の `.mcaddon`、最新のソース zip、`history.zip` |

直すたびに前回の `.mcaddon` は `history.zip` に畳まれ、新しい順に最新 40 件だけが残ります。
Release に見えるファイルは常に 3 つで、古いものは 1 つの zip にまとまります。

## AI が間違えにくくする仕掛け

| 仕掛け | 何をするか |
|---|---|
| `skills/` | やりたいこと別の作り方。`npm run skill <語>` で当たるカードだけ引けます |
| 公式の型定義 | `@minecraft/server` ほかの `.d.ts` を同梱し、AI に渡します（引数・戻り値・説明つき） |
| `api.json` | **この実機に実在する** API を毎回書き出します。型定義にあっても実機に無いものを見抜けます |
| 手詰まりの検知 | 同じ落ち方が 3 回続くと「やり方を変えてください」と指示文に足します |
| `specs/` の見張り | AI が受け入れ条件を書き換えたら、その場で知らせ、コミットにも残します |
| 前回との差 | 直前の変更で壊れたものを名指しします |
| 直し方の当たり | よくある実機の例外に、対処を添えます |

## アドオンから検証に話しかける

`scripts/lab.js` を import すると、アドオンから検証の結果に直接書き込めます。

```js
import { lab } from './lab.js';
lab.note('Δy=1.203');
lab.metric('speed', 0.6);
lab.fail('上昇していない');
lab.command('tp @s 0 -50 0');
```

例外は `.js.map` があれば元のソース位置に直して報告します。Rust も外部の binary も要りません。

## BDS の取得

公式の配布 API を見に行き、読めないときは同梱の `data/bds-versions.json` にある版と
CDN の URL から直接落とします。ネットワークが厳しい環境（CI など）でも止まりません。

## 実機で分かっていること（1.26.51.1 で実測）

`skills/70-pitfalls.md` に全部あります。特に効くもの:

| こと | 結果 |
|---|---|
| `world.getAllPlayers()` | **`undefined` を含むことがあります。**`.filter(Boolean)` が要ります |
| `camera.setFov` | 範囲は `[30, 110]`。外すと落ちます |
| `minecraft:flying_speed` | プレイヤーには付いていません（`minecraft:movement` は付いています） |
| SimulatedPlayer の移動 | `inputInfo` に載りません。入力を読む機能は `tags: ['real']` で確かめます |
| `new Proxy` | 実機が `proxy: inconsistent get` で弾きます |
| `new Function` / `eval` | manifest に `"capabilities": ["script_eval"]` があれば**使えます**。差し替えが 1 秒以下で回ります |
| `world.beforeEvents.chatSend` | 安定版の `@minecraft/server` 2.x にありません |
| `transport` | NetherNet 以外は非対応と警告されます |

## 中身

| 場所 | 何 |
|---|---|
| `START_HERE.md` | zip を受け取った AI が最初に読むもの |
| `AGENTS.md` | 開発の決まりごと |
| `addons/` | アドオン（AI が書くところ） |
| `specs/` | 受け入れ条件。実機で流れる仕様書 |
| `src/` `tools/` | 検証の仕組み |
| `src/run/selftest.mjs` | 実機なしで仕組みを確かめる 29 項目（`npm run selftest`） |
| `src/run/import.mjs` | `.mcaddon` / `.mcpack` の取り込み |
| `src/run/inspect.mjs` | 実機を上げずに検める・直す |
| `src/run/update.mjs` | BDS とモジュールの版を追いかける |
| `skills/` | ScriptAPI の手引き（`README.md` から引く） |
| `types/spec.d.ts` | 仕様書を書くときの補完用 |
