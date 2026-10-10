# bds-lab の構成

bds-lab は「頼まれたアドオンを、本物の BDS と本物のクライアントで証明できるまで作る」ための道具一式です。
この文書は、人が全体をつかみ、変更するときに迷わないための地図です（AI が作業中に読むのは `AGENTS.md` だけで足ります）。

## 層

```
入口      lab.mjs                  コマンドの振り分け・bg/wait・patch/apply/verify・update・setup all・cache
            │
ラボ      bds/ end/ ll/             flavor.mjs にそれぞれの違いだけ（BDS アドオン / Endstone / LeviLamina）
          app/                     本物の Minecraft アプリ（Android エミュレータ・redroid・自分の端末）で JSON UI を確かめる
            │
エンジン  common/core.mjs          new・add・build・check・test・go・qa・pack・up/live・run・api・doc …（3 ラボ共通）
          common/*.mjs             下の「モジュールの地図」
            │
道具      sandbox-be/              実機で測った仮想世界（sim・ts try・c2s --check）
          bds/addons/ts_repl/      生きた世界で TypeScript を流す（ts）
          bedrock-binary/          BDS 本体に書かれていて文書に無いもの（bb）
            │
知識      skills/                  SKILL.md（どの AI でも読める手順）・knowledge.json（証拠つきの規則）・rubric.json・routes.json・probes/
          bds/bench/               課題と隠しテスト（tasks.json）・参照解（solution.mjs）＝ベンチと「一から作る」練習の両方
            │
自動      auto/                    自動操縦の記憶（台帳・backlog・教訓・設定）
          .github/workflows/       CI（verify）・Issue から作る（ai-make）・定期保守（maint・latest）・配布（share）
```

## 主な流れ

| 流れ | コマンド | 何が起きるか |
|---|---|---|
| 作る | `bds new` → `add` → `sim` → `go` | 雛形 → 中身（アイテム・ブロック・モブ）→ サンドボックスで 1 秒の下見 → 型検査・実機テスト・品質チェック・`.mcaddon` |
| 一から作る（練習） | `scratch next` → `scratch check <id>` → `--real` | 等級つきの課題を何も見ずに作り、隠しテストをサンドボックス → 実機の順に通す。食い違いは `scratch gaps`（サンドボックスの宿題） |
| 調べる | `api` `doc` `sample` `bb` `ts try` `ts` `scratch probe` | 推測しない：型定義・文書・バニラ・BDS 本体・サンドボックス・生きた世界。`scratch probe` は同じコードを両方で動かして比べる |
| 人のアドオンを直す | `import` → `brief` → `go` | 実行せずに読み、壊れる所を先に挙げ、各入口を 1 回ずつ通す下書きテストを作る |
| テストを鍛える | `gaps` `mutate` `chaos` `record` `why` `shrink` `flaky` `bisect` | どのコードもテストが通っているか、わざと入れた不具合に気づくか、無作為に遊んで壊れないか |
| 保守 | `upkeep`（→ `maint`・`maintain`・`refresh`） | 掃除 → 最新の Minecraft で全ユニットを試験 → 直す → 次の 1 コマンド |
| 配る | `pack` `release` `share` `update` `deploy` | ユニットの配布物・ラボ本体のリリース（秘密の検査と単体での再試験つき）・上書き更新・自分の BDS へ |
| 育つ | `skill learn` → `promote` → `verify`・`skill refine`・`skill bench` | 失敗の記録 → 候補 → 証拠つきの規則 → 実機で再確認。スキル本文は採点と振り分けで測り、悪くなれば戻す |
| 自動 | `auto next` / `auto run` | 仕事を自分で選び、作り、確かめ、レビューを通ったものだけ取り込む（床：STOP・トークンの上限・触れないファイル） |
| ブラウザ・スマホから | 管理パネル（`panel/`、GitHub Pages）＋ サインインのサービス（`auth/`）→ ワークフロー | GitHub でサインイン（ラボの GitHub App）、役割（ポリシー）と監査ログ、「準備」で App・サービス・Pages を整える。アカウントを切り替えて、自分の Actions か貸し手の Actions（hostrun.yml → `host ci`）で走らせ、進み具合・成果物・秘密・端末・貸す条件。終わった実行は notify が Discord に（成果物を添えて） |

## モジュールの地図（common/）

| 区分 | モジュール |
|---|---|
| 入口・環境 | `start.mjs`（初回の一括準備）・`status.mjs`（状況と次の 1 手・`clean`）・`ui.mjs`（ブラウザの操作画面）・`netenv.mjs`（プロキシと証明書）・`runtime.mjs`（ホストかコンテナか）・`secrets.mjs`（.env）・`auth.mjs`（各サービスへのログイン）・`notify.mjs`（スマホへの通知）・`panel-config.mjs`（管理パネルを Pages に: サインインのサービスと App の設定・CSP）・`panel.mjs`（`panel check`: 変えたファイルに要るパネルの試験だけ・`shots`・編集のたびの hook）・`ghapp.mjs`（ワークフローの中で、ラボの GitHub App の 1 時間のトークン）・`schedule.mjs`（`schedule ci|list|check`: 管理パネルの「予約」= .github/bds-lab-schedule.json を、毎時の schedule.yml が時刻どおりに始める）・`unitci.mjs`（`unitci`: 管理パネルの「アドオン」から unit.yml で、ユニットを作る・取り込む・試験・仕上げる。入力は検査してから引数で渡す）・`watch.mjs`（保存のたびに結果） |
| 作る・試す | `core.mjs`（共通エンジン）・`build.mjs`（esbuild と型検査）・`addon-lint.mjs`・`api-hints.mjs`・`dts.mjs`（型定義の索引）・`schema.mjs`（Mojang のスキーマ、バニラで較正）・`lint-tests.mjs`（tests.txt の静的検査）・`trial.mjs`（1 回の試走）・`helper.js`（テスト用にアドオンへ差し込む補助）・`extra.mjs`（doc・sample などの重い道具）・`pixel.mjs`（16×16 のテクスチャ）・`model.mjs`（モデルの描画と検査）・`jsonui.mjs`（JSON UI の検査）・`i18n.mjs`（翻訳の欠け）・`optimize.mjs`（配布物を小さく）・`c2s.mjs`（コマンド → Script API）・`bb.mjs`（BDS 本体の解析）・`refresh.mjs`・`kb-build.mjs`（ラボの知識を新しい Minecraft に合わせる） |
| 本物のプレイヤー | `realplayer.cjs`（本物のクライアント）・`raknet.cjs`・`nethernet.cjs`（通信）・`verbs.cjs`・`verbs-more.cjs`・`verbs-gen.cjs`（約 12,000 の動作）・`goal.cjs`・`goal-exec.cjs`・`challenges.cjs`（目標の計画と実行、RTA）・`debugger.cjs`（スクリプトのデバッガ）・`lan.mjs`（ローカルワールド方式） |
| サンドボックスと生きた世界 | `sim.mjs`（sandbox-be で tests.txt を 1 秒）・`ts.mjs`（TS REPL を外から動かす）・`scratch.mjs`（一から作る練習・食い違いの記録・両方で比べる probe） |
| 原因を探す・テストを鍛える | `why.mjs`・`gaps.mjs`・`mutate.mjs`・`chaos.mjs`・`record.mjs`・`flaky.mjs`・`bisect.mjs`・`checkpoint.mjs`（undo）・`pytb.mjs`（Python の traceback） |
| 持ち込み・保守 | `brief.mjs`（人のアドオンを読む）・`apidiff.mjs`（API の版の差）・`maintain.mjs`・`upkeep.mjs`・`maint.mjs`（19 の健康診断）・`latest.mjs`（定期の全ユニット試験）・`scan.mjs`（アドオンが何をできるか）・`colony.mjs`（クラフターズコロニーの配布ワールド・アドオン: 探す・取る・確かめる・組み直す・変換・導入・ユニットに・地形をサンドボックスのコースに・最新で動くものを借りる harvest）・`borrow.mjs`（借りたアドオン: 見た記録・種で決まる順・記事の決まり・借りた印と、配る道すべての止め）・`hosts.mjs`（貸し手の GitHub の時間: ホストの登録・送る前の検査・走らせる・予算（自分の台帳と GitHub の数の多いほう）・報告・`host ci` = 管理パネルから hostrun.yml で。ひな形は host/template） |
| 配る | `release.mjs`・`github.mjs`・`share.mjs`（ラボ本体のリリース）・`update.mjs`（上書き更新）・`deploy.mjs`（自分の BDS へ、戻せる）・`secret-scan.mjs`（鍵の漏れ止め） |
| AI | `make.mjs`（AI に作らせ go が決める）・`ci.mjs`（GitHub の Issue から）・`auto.mjs`（自動操縦）・`auto-guard.mjs`（AI が決めてはいけない床）・`run-tests.mjs`（オフライン試験を並べて走らせる：ゲート・share の単体再試験）・`verify-plan.mjs`（CI の verify の計画：前に通ったコミットから変わったファイルで、本物の BDS・すべてのオフライン試験・パネルの試験だけ・何もしない を決める）・`verify-state.mjs`（verify が覚える「通ったもの」の形と、ファイルの中身の呼び方: git の blob id・フォルダの名前の一覧） |
| 知識（スキル） | `skills.mjs`（規則の層・インストール・ベンチ）・`skill-forge.mjs`（スキル本文の採点・振り分け・磨き）・`skill-evolve.mjs`（物差しの成長・全 AI 向けの 1 本のプロンプト） |

## 状態の置き場所

| 場所 | 中身 | 配布物に入るか |
|---|---|---|
| `<lab>/.lab/` | サーバー・道具・型定義のキャッシュ、テストの結果、エピソード、`scratch.jsonl`・`scratch-gaps.jsonl`・`probes.jsonl` | 入らない（その PC の経験） |
| `skills/` | スキル・規則・採点の記録 | 入る |
| `auto/` | 自動操縦の台帳・backlog・教訓・設定 | 空の状態で入る（`share` が初期化） |
| `.env` `.env.local` | 鍵とパスワード | 入らない（patch・handoff・update でも運ばない） |
| `bds/addons/` など | ユニット | ラボの見本と、スキルの規則が証拠に挙げるものだけ入る |

## 品質ゲート

| 段 | 何を | いつ |
|---|---|---|
| lint | 全スクリプトの構文・全 JSON・コマンド表と文書の一致・モジュール地図・既知の不具合の型（`tests/lint-offline.mjs`） | ゲート・CI |
| ESLint | 見た目ではなく本物の不具合だけ: 無い名前・計算して使わない値・届かないコード・いつも同じ条件（`tests/eslint.config.mjs`、ラボの依存にはしない: `npx --yes eslint@9 -c tests/eslint.config.mjs .`） | CI |
| ゲート（27 本） | `common/auto-guard.mjs` の `gate`：docs・dev・kit・make・ci・auto・update・share・sim・status・deploy・c2s・upkeep-front・ts・bb・schema・pytb・sample・import・skills・rp・forge・cli・scratch・lint・colony・ui（`ui` と `start`） | `node lab.mjs auto gate`（並列。`--all` で全オフライン試験、`--jobs n`、`--shard i/n` でそのうちの 1 台分: 各試験のふだんの時間で分ける）、自動操縦がラボ本体を変えるたび、`share` の単体再試験、CI（1 台で。分けると分が増える: `common/verify-plan.mjs` SHARDS） |
| CI のその他 | offline・realplayer・nethernet・env・app・latest・maint・upkeep・maintain・login・GitHub の流れ・lan、各ラボの実機試験 | push のたび、変わったものに要る分だけ（`.github/workflows/verify.yml` の計画 `common/verify-plan.mjs`：同じ中身は 2 度試験しない・BDS の実機はそれが使うファイルが変わったときだけ、4 つ（bench・scratch・dev・addons）を別々のランナーで同時に、アドオンのファイルだけならそのアドオンの試験だけ・パネルだけならパネルの試験だけ・オフラインの試験は 1 台のコアで横に並べて）。手で始めるか commit の題（1 行目）に `[full ci]` ですべて（macOS・Endstone・LeviLamina も） |
| 実機 | `tests/dev-bds.mjs`（本物の BDS で約 15 分）・`bds/bench/bench.mjs selftest`・`scratch selftest --real`・`skill verify` | 手元・定期 |

## 安全の床

- **トークン**：AI を呼ぶものは、`--via` か自動操縦の上限の下でしか動きません。`skill bench` に既定の AI はありません。上限（`dailyTokens`・`taskTokens`）は数でなければ 0 として扱います（閉じる側に倒す）。
- **止める**：`auto/STOP` があれば何も動きません。自動操縦が起こした AI は `auto resume` も `auto policy` も使えません（`LAB_AUTO_AGENT`）。
- **レビュー**：レビューの AI に聞けなかった変更は取り込みません。
- **漏れ**：`share` は全ファイルを鍵の形と自分の `.env` の値で調べ、1 つでもあれば何も書きません。
- **戻せる**：`checkpoint`/`undo`（ユニット）、`deploy --undo`（自分の BDS）、`skill refine --revert`（スキル）。
- **ヘルプは実行しない**：どのコマンドも `--help` / `-h` ならヘルプだけを出します。

## トークンの設計

AI が使うトークンの大半は「毎ターン送り直されるもの」です。だから、常に読むものは最小にし、要るものは要る瞬間にコマンドの出力として渡します。

| 置き場所 | 中身 | 量 |
|---|---|---|
| 毎ターン | `.claude/settings.json` で道具を 6 つに絞る（道具の説明も毎ターン送られる）・`AGENTS.md` | 約 1,800 トークン（v1.19 は 2,500） |
| 作り始め | `bds new` / `import` / `make` が、依頼に合うスキルの本文をその場で出す（近いものが 2 つなら両方）。「読むための次の 1 回」が要らない | 1 スキル 400〜900 |
| 失敗したとき | `go` が `why` を自分で走らせる・失敗の下に該当する規則を 1 行だけ（`rule:`） | 数十〜200 |
| 調べるとき | `help <話題> <語>` はその語を含む部分だけ（`help player` 全体は約 3,800） | 数十〜数百 |

数え方：`@anthropic-ai/tokenizer` での概算です（Claude の実際の数とは少しずれます）。AI の作業全体で何トークン減ったかは、ベンチ（`skill bench --via <ai>`）を回すまで分かりません。

## 変えるときの約束

1. 不具合を直したら、直す前に落ちるテストを足す（`tests/cli-offline.mjs` が見本）。
2. モジュールを足したら、先頭に何をするものかを書き、この地図に載せる（`tests/lint-offline.mjs` が確かめる）。
3. コマンドを足したら、`lab.mjs` の表と `common/help.md` に載せる。AI が毎回読む `AGENTS.md` は 1 行でも高いので、足すのは入口だけ。
4. スキルを変えるときは `skill refine <名前>` → 編集 → `--done`（悪くなれば自動で戻る）。規則は `skills/knowledge.json` に証拠つきで。
5. 実機で確かめていないことは「確かめていない」と書く。
