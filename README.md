# bds-lab — AI が一人で Minecraft 統合版アドオンを作り、本物のサーバーで確かめる

> **To the AI reading this:** read `AGENTS.md` and follow it (it is short and complete for an addon).
> Network blocked or no terminal (a chat sandbox): run `node lab.mjs help chat` (or read the `## chat` part of `common/help.md`) and work that way: build offline, reply with `node lab.mjs patch` in one code block, and ask the person to paste back what `verify.command` / `verify.cmd` prints. Never ask the person to debug.

作りたいものを日本語で頼むだけで、AI が **本物の Bedrock Dedicated Server（BDS）を立て、本物の Bedrock クライアントを参加させ、テストと品質チェックが通るまで自分で直して、`.mcaddon` まで仕上げます**。人がやるのは頼むことだけです。

## いちばん簡単な始め方

```sh
node lab.mjs start        # 足りないものの確認 → ログイン → サーバーの用意 → 「何を作りますか？」→ AI が作る
```

聞かれたことに Enter で答えていくだけです（Node.js が無ければ `./lab.sh start`。Windows は `lab.cmd` をダブルクリック）。

ターミナルが苦手なら **`node lab.mjs ui`**：ブラウザに操作画面が開きます。作りたいものを書いて「AI に作らせる」、アドオンごとの「テスト」「仕上げ」「点検」「戻す」、「最新版で点検して直す」「次のアップデートを予告」がボタンで押せ、出力もその場に流れます（このPCからだけ開ける画面です）。

**アカウントと鍵は 2 通りのどちらでも**：
- **`.env` に書く**：`.env.example` を `.env` にコピーして、使うものだけ埋めます（AI の鍵、GitHub・Google・Microsoft のメールアドレスとパスワード、2 段階認証の秘密、通知先）。`node lab.mjs login` がそれを読んで、**ブラウザを開き、ログイン画面に自動で入力してボタンまで押します**。
- **何も書かない**：`node lab.mjs login` が端末で聞きます（パスワードは表示されません。Enter でブラウザに自分で入力）。次から聞かないよう `.env.local` に保存するかも選べます。

```sh
node lab.mjs login              # 今の状態（github / google / microsoft / ai / notify）と、足りないものをその場で設定
node lab.mjs login github       # gh の正式なログイン（デバイスコード）をブラウザで自動入力。GH_TOKEN があればブラウザ不要
node lab.mjs login google       # app ラボ用（Google Play から APK）
node lab.mjs login microsoft bot  # lan ラボ用（本物のワールドに入るボットの Xbox アカウント）
node lab.mjs login ai           # ANTHROPIC_API_KEY / OPENAI_API_KEY を確かめて保存
```

- パスワードや 2 段階認証の秘密は、このPCのブラウザでそのサービスのログイン画面に入れるためだけに使います。環境変数・サーバー・AI には渡さず、`.env` / `.env.local` は git にも zip にもパッチにも入りません。
- `GITHUB_TOTP_SECRET` を書けば 2 段階認証の 6 桁も自動です（ただしこのPCを使える人には 2 段階認証が効かなくなるので、自分専用のPCで）。書かなければ、その窓で自分で入れます。画面の無いサーバー（SSH・CI）ではブラウザを隠して動かし、コードだけ端末で聞きます。
- gh（GitHub CLI）が無ければ `.lab-tools/` に自動で取ってきます。

## 迷ったらこの 3 つ

| こんなとき | コマンド |
|---|---|
| いまどうなっている？次は何をする？ | `node lab.mjs status` |
| Minecraft が更新された・何かおかしい・しばらく触っていない | `node lab.mjs upkeep`（点検→片付け→最新版で全部試験・修理→結果と次の 1 コマンド。`--check` は何も変えずに見るだけ） |
| ディスクが足りない | `node lab.mjs clean` |
| 配布ワールド・アドオン（クラフターズコロニー）を試す・直す | `node lab.mjs colony search <言葉>` → `colony get <番号>` → `colony import <番号>`（`help colony`） |
| 他の人のアドオンで、最新で動くものを借りて直して学ぶ（配り直さない） | `node lab.mjs colony harvest`（見たことのないものだけ。`colony borrowed`・`colony diff`） |
| 自分のスマホ・タブレットで JSON UI を確かめる（root あり・なし × USB・Wi-Fi） | `node lab.mjs app device add <名前>` → `app run -a <アドオン> --device <名前>`（[app/README.md](app/README.md)） |
| 知り合いが貸してくれる GitHub Actions の時間で試験を回す | `node lab.mjs host add <owner/repo>` → `host run gate`（[docs/guide/host.md](docs/guide/host.md)） |
| スマホのブラウザで進み具合を見る・実行する（自分の Actions か貸し手の Actions か）・成果物を Discord に・秘密を入れる・端末を動かす・貸す条件を変える | 管理パネル（下の「管理パネル」: リポジトリの GitHub Pages） |

どれも最後の行に「次にやること」を 1 つだけ出します。AI も人も、それをそのまま打てば進みます。

## 管理パネル（ブラウザ・スマホ: 作者と、Actions の時間を貸し借りする人のための）

`panel/` の 1 枚のページで、リポジトリだけで動きます（パソコンもサーバーも要りません）。GitHub Pages
（`.github/workflows/pages.yml`。一度だけ Settings → Pages → Source を「GitHub Actions」に）が
`https://<owner>.github.io/<リポジトリ>/` に置きます。

- **入れる人**: 自分の GitHub のトークンで入ります。GitHub がそのトークンに許していることだけが見え、できます。ラボに書き込める人
  （作者・collaborator）と、ホストの持ち主（貸し手）・ホストに書き込める人（借り手）のほかは「使えません」で止まり、何も読みません。
  ページは GitHub の API のほかには通信できません（CSP）。トークンはそのブラウザの中だけ。
- **いくつものアカウント**: 作者・貸し手・借り手のアカウントを 1 つのブラウザに加え、上で切り替えます。ラボ・ホストの一覧・
  読み直す間隔・APP_CACHE_KEY はアカウントごと（覚えないアカウントはそのタブの間だけ）。貸し手の初めての訪問では、その人の
  ホストを自分で探します。
- **それぞれの設定のまま**: 見るのはそれぞれのリポジトリの秘密の名前・ワークフロー・公開か非公開か・変数、ホストの `.lab-host.json`。
  それに合わせて「できること」と「足りないもの」を出します（例: Discord の 2 つの秘密があれば、端末を Discord で操作できる）。
- **どこの Actions で走らせるか**: 「実行」で、このラボの Actions か、貸し手のホスト（その人の Actions の分）かを選びます。ホストなら
  貸す条件が許す仕事だけ・今月の分（GitHub が数えたホストの実行: 誰の分も）が 80% に届くまで。`.github/workflows/hostrun.yml` が
  ラボをホストに送って走らせ、待てば結果・知らせ・成果物（go の .mcaddon）がこの実行のものになります（秘密 `LAB_HOST_TOKEN`:
  パネルの「秘密」から）。
- **できること**: 概要／進み具合（ラボかホストの実行。動いているものは段ごとに、失敗はその理由の注釈まで。止める・やり直す・
  成果物）／実行（上の切り替え。ワークフローの入力をその YAML から）／成果物（実行ごとの .mcaddon など。Discord に送る）／
  Discord（つなぐ秘密・どの実行を知らせるか・何を添えるか・試し）／秘密（その場でリポジトリの公開鍵で封じて登録・消す）／
  端末（mode hold の端末を Discord と同じボタンで）／貸し借り（借り手: 今月の分と残り・結果・その人の Actions で走らせる。
  貸し手: 1 か月の分・仕事・時間帯・最後の日を変える、今すぐ止める・再開）
- **Discord**: 実行が終わると `.github/workflows/notify.yml` が DM（自分のボット: `DISCORD_BOT_TOKEN` + `DISCORD_USER_ID`）か
  `LAB_NOTIFY_WEBHOOK` に知らせます（結果・落ちたジョブとその理由・実行と成果物とパネルへのボタン、成果物の .mcaddon・.mcpack・
  ワールドは 10 MB まで添えて。このリポジトリのコードの実行だけ: フォークの PR のものは添えません）。どの実行かは変数 `LAB_NOTIFY`
  （既定 auto = 失敗と、手で始めた実行。all / failures / off）、何を添えるかは `LAB_NOTIFY_FILES`（auto / off / `*.zip` など）。
  パネルのボタンはその実行を開きます。端末の操作は [app/README.md](app/README.md)「スマホだけで」。

詳しくは [panel/README.md](panel/README.md)。

## いまの状態を 1 回で見る・空きを作る

```sh
node lab.mjs status        # ラボ・いまのユニット・各ユニットの最後の結果・サーバー・自動操縦・ディスク・道具・次にやること
node lab.mjs clean         # 作り直せるものを消して空きを作る（終わったベンチの作業フォルダ・古い app の結果・試験の一時フォルダ・
                           #   古い BDS 用のサーバー置き場・古いチェックポイント）。--dry で見るだけ、--deep で BDS の zip と colony で取ったものも
```

`maintain` や `app run` の前には、このうち安全なもの（一時フォルダ・終わったベンチ・古い BDS 用の置き場）を自動で片付けます。
ベンチは 1 回ごとにラボを丸ごと写すので（数百 MB）、結果を記録したら写しは消します（`--keep` で残す）。

## 全体像

```
頼む（日本語で）
  │
  ├─ 見本が近い ────── bds-recipes の見本を写して直す
  ├─ 見本が無い ────── bds-from-scratch：依頼を行に分け → api/doc で調べ → sandbox と TS REPL で試し → テストを先に書く
  ├─ 人のアドオン ──── import → brief → 壊れる所を先に直す
  ├─ 配布物 ────────── colony search / get / import（クラフターズコロニーの配布ワールド・アドオン）
  └─ 借りる ────────── colony harvest（最新で動く他の人のアドオンだけ。手元で直して学ぶ、配らない）
  │
  sim（サンドボックス、1 秒）→ go（型検査 → 本物の BDS と本物のクライアントでテスト → 品質チェック → .mcaddon）
  │
  DONE → gaps / mutate / chaos でテストを鍛える → 届ける
  │
  失敗と直しの記録 → 候補 → 証拠つきの規則 → スキルが育つ（実機で再確認、悪くなれば戻す）
```

- 構成・モジュールの地図・品質ゲート・安全の床：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 道具（TS REPL・sandbox-be・bedrock-binary・deploy・c2s・スキーマ検査）：[docs/guide/tools.md](docs/guide/tools.md)
- 使い方と自動化（AI に作らせる・Issue から・チャットだけの AI・配布・自動操縦・保守・品質）：[docs/guide/workflows.md](docs/guide/workflows.md)
- スキルと、一から作る練習：[docs/guide/skills.md](docs/guide/skills.md)・成長の仕組み全体：[skills/GROWTH.md](skills/GROWTH.md)
- 3 つのラボ・本物のアプリ・Endstone / LeviLamina の見本・環境：[docs/guide/labs.md](docs/guide/labs.md)
- GitHub の時間を借りる（知り合いのアカウントの Actions でラボの試験を走らせる）：[docs/guide/host.md](docs/guide/host.md)
- 秘密の扱い・AI に任せる範囲・CI の守り：[SECURITY.md](SECURITY.md)
- 変更の記録：[CHANGES.md](CHANGES.md)

## 一から作る（練習して、学ぶ）

見本に近いものが無い依頼のために、等級つきの課題（18 個、隠しテストつき）で「何も見ずに作る」練習ができます。

```sh
node lab.mjs scratch next              # 次の課題と手順
node lab.mjs scratch check <課題>       # 隠しテストをサンドボックスで（数秒）
node lab.mjs scratch check <課題> --real   # 本物の BDS で（判定）
node lab.mjs scratch gaps              # サンドボックスと実機の食い違い（サンドボックスの宿題になる）
```

学ぶ場所はサンドボックス（sandbox-be）と生きた世界（TS REPL）、判定はいつも本物の BDS です。詳しくは [docs/guide/skills.md](docs/guide/skills.md)。

## 品質

- 27 本のオフライン試験のゲート（`node lab.mjs auto gate`。lint・コマンドの回帰・一から作る教材の検証を含む。並べて走らせて約 2 分）と、オフライン試験の全部（`node lab.mjs auto gate --all`）、push ごとの CI（全オフライン試験と ESLint）、本物の BDS での試験（`node tests/dev-bds.mjs`）。
- AI のトークンを使うものは、明示したときだけ動きます（`--via`、自動操縦の上限。上限が読めなければ 0 として止まる）。どのコマンドも `--help` ではヘルプだけを出します。
- 確かめていないことは「確かめていない」と書きます。

## 訓練用のもの（別配布）

PvP ボット・RTA のスクリプトなど、ふだんの開発に使わない訓練・検証用のもの（`training/`）は本体から外し、`bds-lab-training-<版>.zip` として別に配ります。使うときは bds-lab のフォルダに展開してください（`training/README.md`）。

サンドボックスの学ぶ頭（`sandbox-be/src/play/agent/`）・PvP・目標探しなど、ラボのコマンドから使わない部分は `bds-lab-extras-<版>.zip` にあります。bds-lab の一つ上で展開すれば元の場所に戻ります（一緒に入る extras.json に載ったファイルは、`update` も `maint` も古いファイルとして消しません）。

