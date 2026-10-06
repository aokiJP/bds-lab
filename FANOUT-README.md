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
