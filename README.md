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
| git clone もパソコンもなしで、アドオンを作る・人のアドオンを取り込む・ファイルを直す・試験・仕上げ（.mcaddon）・配る・決めた時刻に自動で | 管理パネルの「アドオン」「配布」「予約」（`unit.yml`・`schedule.yml` が GitHub の Actions で） |

どれも最後の行に「次にやること」を 1 つだけ出します。AI も人も、それをそのまま打てば進みます。

## 管理パネル（ブラウザ・スマホ: 作者と、Actions の時間を貸し借りする人のための）

`panel/` の 1 枚のページで、リポジトリだけで動きます（パソコンは要りません）。GitHub Pages（`.github/workflows/pages.yml`）が
`https://<owner>.github.io/<リポジトリ>/` に置きます。GitHub に置けないのは、「GitHub でサインイン」を仕上げる小さなサービス
（[auth/](auth/README.md): Cloudflare Workers か、自分のサーバーの Docker）だけです。

- **GitHub でサインイン**: ラボの GitHub App を通して、誰でもボタン 1 つで入れます。許可は App の導入で自動に決まり、トークンを作る
  人はいません（できることは、App が入ったリポジトリで GitHub がその人に許すことだけ）。トークンで入る道も残ります（最初の準備）。
- **準備**（はじめに 1 回、ラボの管理者）: 「準備」のタブが上から順に確かめ、ボタンで直します — Pages を有効に、サインインの
  サービスを Cloudflare に置く（`auth-deploy.yml`）、GitHub App を 1 回のクリックで作る（鍵はその場で封じてラボの秘密に、id は変数に）、
  App をラボに入れる、貸し手に渡す App のリンク。
- **アドオン**（手元の PC も git clone も要りません）: 「アドオン」がラボのユニットを GitHub から一覧し（題・説明・版・試験の数・
  最新の .mcaddon）、新しく作る・人のアドオン（.mcaddon・.mcpack・.zip）を取り込む・ファイルを直す（読んだときの sha つきで既定の
  枝に commit: ほかの人の変更を上書きしません）・試験・仕上げ（.mcaddon）・AI で変える、を GitHub の Actions（`unit.yml`）で。
  取り込むパックは専用の枝 `lab-incoming/…` に置き、ユニットにできたら枝を消します（既定の枝の履歴にパックを残しません）。
  既定の枝が守られている（PR が要る）ラボでは、できたユニットを別の枝に置いて「PR を作る」のリンクを出します。
- **配布**: 「配布」でリリースのファイル・大きさ・ダウンロードの数・合計、リンクを写す、Discord に知らせる（notify.yml）。
- **予約**: 「予約」で、決めた時刻にワークフローを自動で始めます（何時間ごと・毎日・毎週、時間帯つき）。予約は
  `.github/bds-lab-schedule.json` に入り、毎時の `schedule.yml` がラボの Actions で始めます（だれのトークンも PC も要りません）。
- **統計と健康度**: 「統計」で実行の数・通った割合・かかった時間・曜日×時間・貸し手の分をグラフと表で（どのグラフも「数字で見る」）。
  「概要」にラボの健康度（0〜100 点・A〜E と、直すと点が上がる 3 つ）と、会社向けの報告書（Markdown、このブラウザの中で作ります）。
- **お知らせとオフライン**: 上の 🔔 に、開いていなかった間のこと（終わった・落ちた実行、参加のお願い、フォークで貸し始めた、新しい版）。
  スマホにも本物の通知（service worker `panel/sw.js`。iPhone はホーム画面に追加すると）、一度開いたパネルはネットがなくても開けます。
- **秘密をまとめて**: 「秘密」に .env を貼ると、名前だけを見せて確かめ、1 つずつこのブラウザで封じて登録します（値は表示も保存もしません）。
- **会社で使う**: `.github/bds-lab-panel.json` で役割ごとにできることを狭め（GitHub の権限は広げません）、確かめる操作・操作がない
  ときのサインアウトを決め、操作を監査ログ（その人自身の issue のコメント、ロック済み）に残して「監査」で絞り込み・CSV。
- **メンバー**: 「メンバー」で GitHub のユーザー名から管理者・書き込み・見るだけとして招く・変える・外す。役割（パネルでできること）もチェックの表で。
- **便利に**: 実行を探す・絞る、概要のすぐやり直すボタン、実行が終わると端末に知らせ、スマホのホーム画面に追加。
- **いくつものアカウント**: 作者・貸し手・借り手のアカウントを 1 つのブラウザに加え、上で切り替えます（設定もアカウントごと）。
- **どこの Actions で走らせるか**: 「実行」で、このラボの Actions か、貸し手のホスト（その人の Actions の分）か。ホストなら
  `hostrun.yml` が送って走らせます（貸し手が App を入れていれば App の 1 時間のトークンで、誰の個人のトークンも要りません）。
- **Discord**: 実行が終わると notify が DM か Webhook に、結果・落ちた理由・ボタンと成果物（.mcaddon など 10 MB まで）を。

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

- 27 本のオフライン試験のゲート（`node lab.mjs auto gate`。lint・コマンドの回帰・一から作る教材の検証を含む。並べて走らせて約 2 分）と、オフライン試験の全部（`node lab.mjs auto gate --all`）、push ごとの CI（前に通ったときに読んだファイルの中身が変わった試験だけ。本物の BDS は PR の最後と既定の枝と毎晩: `common/verify-plan.mjs`）、本物の BDS での試験（`node tests/dev-bds.mjs`）。
- AI のトークンを使うものは、明示したときだけ動きます（`--via`、自動操縦の上限。上限が読めなければ 0 として止まる）。どのコマンドも `--help` ではヘルプだけを出します。
- 確かめていないことは「確かめていない」と書きます。

## 訓練用のもの（別配布）

PvP ボット・RTA のスクリプトなど、ふだんの開発に使わない訓練・検証用のもの（`training/`）は本体から外し、`bds-lab-training-<版>.zip` として別に配ります。使うときは bds-lab のフォルダに展開してください（`training/README.md`）。

サンドボックスの学ぶ頭（`sandbox-be/src/play/agent/`）・PvP・目標探しなど、ラボのコマンドから使わない部分は `bds-lab-extras-<版>.zip` にあります。bds-lab の一つ上で展開すれば元の場所に戻ります（一緒に入る extras.json に載ったファイルは、`update` も `maint` も古いファイルとして消しません）。

