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

## 報告
脆弱性を見つけたら、公開の issue ではなく、リポジトリの「Security」タブの非公開の報告（Private vulnerability reporting）で知らせてください。
