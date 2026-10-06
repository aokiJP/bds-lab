# AI 並行開発キット（fanout）

目標を 1 行書くだけで、1 つの Claude Code のセッション（司令塔）が AI のサブエージェントを最大 10 個まで並行で動かします。
**人がプロンプトを書くのは「目標の 1 行」と「計画の承認 1 回」だけ**です。

## 入れ方（どちらか）

**A. このプロンプトを Claude Code に貼る**（zip をリポジトリの直下に置いてから）

```
ai-fanout-kit.zip をリポジトリの直下に展開して（既にあるファイルは上書きしない）、
node .fanout/fanout.mjs selftest が ✔ になることを確かめ、node .fanout/fanout.mjs install を実行し、
node .fanout/fanout.mjs actions-off --check が ✔ になることを確かめてから、変更をまとめて 1 つ commit して。
commit メッセージ: 「AI 並行開発キット（fanout）を入れる: 計画 1 枚・決まったプロンプト・範囲の検査・Actions は手動だけ」。
ほかのファイルは変えないで。終わったら install の出力をそのまま見せて。
```

**B. 自分で**

```
unzip -n ai-fanout-kit.zip -d <リポジトリ>
cd <リポジトリ>
node .fanout/fanout.mjs selftest
node .fanout/fanout.mjs install
git add -A && git commit -m "AI 並行開発キット（fanout）を入れる"
```

## 使い方

Claude Code に次の 1 行を書くだけです。

```
/fanout "app/redroid の起動からタイトルまでを短くする"
```

すると司令塔が次の順で進めます（`.claude/skills/fanout/SKILL.md`）。

1. 始める前の確認: commit していない変更がない、Actions が自動で走らない。
2. 計画を立てる: `.fanout/plan.json` に、レーンごとの担当（ファイル、または「ファイル#関数」）・テスト・やることを書き、`check` を通す。
3. **あなたに 1 回だけ承認を求める。**
4. レーンごとに作業フォルダを土台から作り（`worktree`）、プロンプトを計画から作って（`prompt`）、その本文でサブエージェントを並行で起動する。
5. 子が戻るたびに、`status` で担当の外に触っていないかを確かめる。触っていたら子に直させる。
6. 読むだけのレビュー役を起動し、指摘を担当の子に戻す。
7. 司令塔だけが、決まった順番で統合する → 全体のテスト → commit。

`.fanout/examples/redroid.plan.json` は、bds-lab v1.22 の app/redroid を 10 レーン（書く 8 本・読む 2 本）に分けた計画の例です。

## 予定外のことを防ぐ仕組み

| 心配なこと | 防ぐもの |
|---|---|
| 子同士がファイルを上書きし合う | 子ごとに別の作業フォルダと枝（`fanout.mjs worktree <レーン>` が土台から作る）。push もマージも子はしない |
| 子が担当の外まで直してしまう | `fanout.mjs scope`: 土台からの差分が担当のファイル・関数の外にあると ✘。✘ のレーンは統合しない |
| 2 本のレーンが同じ所を担当してしまう | `fanout.mjs check`: ファイル・関数の重なり、共有ファイル、存在しない関数、11 本以上、after の輪があると ✘ |
| プロンプトの書き漏れ・書き違い | プロンプトは `.fanout/LANE.md` から計画で埋めるだけ。埋まらない欄があると出さない |
| 子が止まらずに広げていく | プロンプトに止まる条件（担当の外が要る / 同じ失敗 3 回）と、報告の形を固定 |
| 共有ファイル（README・CHANGES・設定）がぶつかる | 共有ファイルは子に触らせず、司令塔だけが触る |
| GitHub Actions の分を使ってしまう | `install` が全ワークフローを手動（workflow_dispatch）だけにする。`actions-off --check` で確かめる |
| 土台が動いてしまう | `new` は commit していない変更があると断り、土台の SHA を計画に固定する |

## コマンド

```
node .fanout/fanout.mjs install | new "<目標>" | check | prompt <レーン> | scope <レーン> [--head <枝>]
                        record <レーン> <枝> | order | status | actions-off [--check] | selftest
```

## 知っておくこと

- `install` は `.claude/settings.json` の拒否から Agent / Skill / worktree / 質問のツールを外します。これらはサブエージェントに要るものです。bds-lab はターンあたりのトークンを減らすためにこれらを拒否していたので、1 ターンが少し重くなります。元に戻すには、その行を戻してください。
- 関数の範囲は「トップレベルの宣言から次の宣言の手前まで（上のコメントを含む）」という近似で判定しています。新しい関数を足したいレーンには、新しいファイルを担当させてください。
- サブエージェントは全部 1 台のマシンの上で動きます。CPU とメモリを分け合うので、重いテストのレーンを並べすぎないでください。

## モデルの使い分け（Sonnet 5.5 / Opus 5.5）

**レーンは Sonnet 約 6 割・Opus 約 4 割、司令塔は Opus** が既定です（`install` が `.claude/settings.json` に `model: opus` と `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` を書きます）。
`node .fanout/fanout.mjs models` が、レーンごとに使うモデルと理由を出します。司令塔はそれを Agent の `model` に渡します。

| 役 | モデル | 理由 |
|---|---|---|
| 司令塔（計画・統合） | Opus 5.5 | 全体の判断。誤りは全レーンに響く |
| レビュー（読むだけ） | Opus 5.5 | 見逃しがそのまま不具合になる |
| `hard` のレーン | Opus 5.5 | 2 つ以上のファイル・プロセスの待ち合わせ・後始末・並行・権限や秘密 |
| 重いレーン | Opus 5.5 | 上の Opus が 4 割に届かないとき、担当の行数 + details の多い順に上げる |
| 残りの書くレーン | Sonnet 5.5 | 担当と details が具体的なら十分。単価は Opus の半分 |
| 直し | 1 回目はレーンと同じ、2 回通らなければ Opus | 無駄な往復を増やさない |

割合は計画の `"mix": { "opus": 0.4 }` で変えられます。レビューと hard だけで 4 割を超えるときは、そのまま Opus です（Sonnet で直しが増える方が高い）。

## 何体にするか（`node .fanout/fanout.mjs size`）
1 体ごとに起動の分（プロンプト・AGENTS.md・コードを読む: 約 4 万トークン）がかかります。`size` は、仕事の量（行数相当）から、1 本あたり 300〜1500 行相当に収まる中でいちばん安い数（同じ値段なら多いほう）と、読む役（書く 4 本に 1 本、Opus）の数、費用の見積もりを出します。1 体と出たら fanout せず司令塔が自分でやります。
```
node .fanout/fanout.mjs size 1517 221 240    # 仕事のまとまりごとの行数 → 書く 2 + 読む 1 = 3 体
node .fanout/fanout.mjs size                 # 計画の書くレーンから
```
統合した後は `node .fanout/fanout.mjs clean` でレーンの作業フォルダと枝を消してから、全体のテストを回します。

単価（Claude API、1M トークンあたり）: Sonnet 5.5 入力 $2 / 出力 $10、Opus 5.5 入力 $4 / 出力 $20、キャッシュ読みはどちらも $0.20。

redroid の回（全部 Opus、約 29 ドル）にこの使い分けを当てはめると、サブエージェントの分の token のうち約 66%（書くレーン 7 本とその直し）が Sonnet に移ります。単価が半分なので、サブエージェントの費用は約 3 分の 1 減る見込みです（キットの不具合で空振りした第 1 波の約 12% は、直したのでもう出ません）。司令塔の分は変わりません。どちらも見積もりで、Sonnet で同じ質が出るかは測っていません。

