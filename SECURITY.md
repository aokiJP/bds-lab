# セキュリティ

## 秘密の扱い
- 鍵・パスワード・2 段階認証の秘密は `.env` / `.env.local` にだけ置きます。どちらも git・`share` の配布物・`patch`・`handoff`・`update` に入りません。
- パスワード・TOTP の秘密・Google の AAS トークンは環境変数に入れません（サーバーや AI の子プロセスが受け継がないように）。`login` が必要なときにファイルから読みます。
- `share` は出すファイルをすべて、鍵の形（Anthropic・OpenAI・GitHub・Slack・Discord・AWS・Google・npm・GitLab・Hugging Face・Stripe・Telegram・秘密鍵）と、自分の `.env` に書いた値そのもので調べ、1 つでも見つかれば何も書きません。`maint` も同じ検査をします。

## AI に任せる範囲
- AI のトークンを使う処理は、`--via` を明示したときか、自動操縦の上限（`auto/policy.json` の `dailyTokens`・`taskTokens`）の下でだけ動きます。上限が数として読めなければ 0 として止まります。
- 自動操縦が触れないもの：`auto/policy.json`・`auto/STOP`・`common/auto-guard.mjs`・`.github/workflows/auto.yml`・`.env*`。触れた変更は丸ごと戻します。自動操縦が起こした AI は `auto resume`・`auto policy` を使えません。
- 取り込む前に別の AI がレビューします。レビューできなかった変更は取り込みません。

## CI
- GitHub Actions はすべてコミット SHA で固定し、各ワークフローに必要な権限だけを書いています（`tests/lint-offline.mjs` が確かめます）。
- `app.yml` は Google の秘密を APK の取得ステップにだけ渡し、成果物に APK や .so が入っていないかを中身まで調べてから上げます。

## 管理パネル（panel/）とサインイン（auth/）
- **入口**: GitHub が決めます。「GitHub でサインイン」はラボの GitHub App のユーザーのトークン（8 時間、更新はサインインのサービスの
  `/refresh` で。App が入ったリポジトリで、その人に GitHub が許すことだけ）。トークンを打つ入り方も残ります（最初の準備）。
- **サインインのサービス**（`auth/handler.mjs`: Cloudflare Workers か、自分のサーバーの Docker）は何も保存しません。受け渡しの状態は
  署名した 1 つの値（URL の state）と、URL に出ない乱数を持つ HttpOnly・Secure・SameSite=Lax の `__Host-` cookie に分け、10 分で切れます。
  PKCE の verifier はその乱数から作るので、callback のアドレス（code と state）を見た人もトークンに替えられません。戻る先は
  `PANEL_ORIGINS` に書いたアドレス（パスの頭まで: 同じ github.io のほかのリポジトリの Pages には戻しません）だけ。トークンは URL の
  `#` の後ろでだけ渡し（サーバー・ログ・Referer に乗らない）、パネルは受け取ったらすぐアドレスから消します。受け取るのは、その
  タブが始めたサインイン（nonce）のものだけです。`/refresh`・`/logout` はパネルの origin からだけ（CORS）。App の client secret は
  サービスと GitHub の秘密にだけあり、ブラウザに来ません。「出る」はトークンを GitHub で取り消します。
- **パネルのページ**: CSP で、通信は GitHub の API・自分の `config.json`・サインインのサービス（pages.yml が origin だけを足す）だけ、
  フォームは github.com（App の manifest）だけ、スクリプトは自分のものだけ。文字は文字として置き（HTML として読まない）、ほかの
  ページの枠の中では何もしません（GitHub Pages は frame-ancestors のヘッダを送れないため）。秘密の値はその場でリポジトリの公開鍵で
  封じて送り、保存も表示もしません（App を作ったときの鍵と client secret も）。
- **ポリシー**（`.github/bds-lab-panel.json`）: パネルが見せること・することを役割ごとに**狭めるだけ**で、GitHub が許さないことは
  許しません。読めない・正しくないファイルは「何も許さない」として扱います。このファイルを書ける人は GitHub で同じことができるので、
  CODEOWNERS や枝の保護で守ってください。操作がない分数でのサインアウト（`idleMinutes`）・確かめる操作（`confirm`）も書けます。
- **監査ログ**: パネルでの操作を、その人自身のコメントとしてラボの issue（ラベル `bds-lab-audit`、作ったらロック）に残します。書いた人と
  記録の人が違うものは数えず、編集されたものは印を付け、900 件ごとに新しい issue に替えます。秘密の値・トークンは入りません。
  issue はリポジトリの管理者なら消せます: 消せない記録が要るなら GitHub Enterprise の監査ログを使ってください。
- **ワークフロー**: hostrun・secrets は、App があれば App の 1 時間のトークン（そのリポジトリだけ・頼んだ権限だけ、`common/ghapp.mjs`）を
  使い、個人の長いトークンを要りません。ラボにワークフローを置ける人は App の鍵（`APP_PRIVATE_KEY`）を使えます: ラボへの書き込みは
  信頼できる人だけに。貸し手は App を **Only select repositories** でホストだけに入れてください。

## 報告
脆弱性を見つけたら、公開の issue ではなく、リポジトリの「Security」タブの非公開の報告（Private vulnerability reporting）で知らせてください。
