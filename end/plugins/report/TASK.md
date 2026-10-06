# Report

## Request
通報システムのプラグインを作って。/report <プレイヤー> <理由> で通報をデータベースに保存して、OPは /reports で新しい順に10件見られて、/reports clear <番号> で処理済みにできるようにして。同じ人が同じ相手を1分以内に何度も通報できないようにして。サーバーを再起動しても通報は残るように。

## Acceptance (one tests.txt `## ` section each)
- [x] /report <プレイヤー> <理由> で通報をデータベースに保存して、OPは /reports で新しい順に10件見られて、/reports clear <番号> で処理済みにできるようにして
- [x] 同じ人が同じ相手を1分以内に何度も通報できないようにして
- [x] サーバーを再起動しても通報は残るように

## Guessed
<!-- values decided without asking -->
- /reports lists only unhandled reports (newest 10, plus the unhandled total); handled ones stay in the DB with handled_by.
- Targets: an online player or anyone who has ever joined (case-insensitive); self-reports refused; reason cut at 200 chars.
- Cooldown is per reporter+target, 60 s, read from the DB (so it holds over a restart); other targets/reporters are not limited.
- Online operators get a chat notice for each new report. Messages are Japanese.
- DB: plugins/report/reports.db (SQLite) in the plugin's data folder.
